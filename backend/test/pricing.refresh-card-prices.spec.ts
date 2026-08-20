import {
  PricingService,
  MAX_FRESH_REPRICE_CARDS,
} from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { PokemonTcgIoProvider } from '../src/modules/pricing/providers/pokemontcg-io.provider';
import {
  PokeTraceProvider,
  PokemonPriceTrackerProvider,
} from '../src/modules/pricing/providers/graded-sealed.providers';
import { PokemonPriceTrackerBulkProvider } from '../src/modules/pricing/providers/pokemonpricetracker-bulk.provider';
import { FreshCardPriceResult } from '../src/modules/pricing/pricing.types';

/**
 * v1.26 (P-7 ⑤, §4.24e) — `PricingService.refreshCardPrices`: fetch FRESCO puntual + upsert de
 * `PriceReference`, con manejo de cuota y FALLA-SEGURA money-safe. Cubre:
 *  - fetch fresco (PPT primario) → upsert vía persistMarketReference; refreshed = carta con ref nueva.
 *  - cadena PRIMARIO→FALLBACK: pokemontcg.io solo se llama para las cartas que PPT NO precia.
 *  - dailyLimited del PPT se propaga; el fallback igual intenta.
 *  - error de proveedor → NO tumba (se intenta el siguiente); sin ref → carta pending, sin upsert.
 *  - money-safety: market<=0 NUNCA se persiste; USD sin FX se OMITE (no inventa MXN).
 *  - cap: nunca más de MAX_FRESH_REPRICE_CARDS cartas por llamada.
 */

type CardRow = { id: string; externalId: string; tcgplayerId: string | null; availableFinishes: string[] };

function buildHarness(opts: {
  cards: CardRow[];
  pptResult?: FreshCardPriceResult | (() => Promise<FreshCardPriceResult>);
  tcgIoResult?: FreshCardPriceResult | (() => Promise<FreshCardPriceResult>);
  fxThrows?: boolean;
}) {
  const upserts: any[] = [];
  const prisma: any = {
    card: {
      findMany: jest.fn(async ({ where }: any) => opts.cards.filter((c) => where.id.in.includes(c.id))),
    },
    priceReference: {
      findUnique: jest.fn(async () => null),
      upsert: jest.fn(async ({ create }: any) => {
        upserts.push(create);
        return { id: `ref-${upserts.length}`, ...create };
      }),
    },
  };

  const fx = {
    getCurrent: jest.fn(async () => {
      if (opts.fxThrows) throw new Error('Banxico down');
      return { rate: 18, bufferPct: 3, source: 'manual', effectiveDate: '2026-08-20' };
    }),
  } as unknown as FxService;

  const asFn = (r: any) => (typeof r === 'function' ? r : jest.fn(async () => r));
  const pptFetch = jest.fn(asFn(opts.pptResult ?? { rows: [], requestOk: false, dailyLimited: false }));
  const tcgFetch = jest.fn(asFn(opts.tcgIoResult ?? { rows: [], requestOk: false, dailyLimited: false }));

  const tcgIo = { source: 'pokemontcg_io', supports: () => true, fetchPrice: jest.fn(), fetchFreshForCards: tcgFetch } as unknown as PokemonTcgIoProvider;
  const pptBulk = { source: 'pokemonpricetracker', fetchFreshForCards: pptFetch } as unknown as PokemonPriceTrackerBulkProvider;

  const svc = new PricingService(
    prisma as PrismaService,
    {} as SettingsService,
    fx,
    tcgIo,
    {} as PokemonPriceTrackerProvider,
    {} as PokeTraceProvider,
    pptBulk,
  );
  return { svc, prisma, upserts, pptFetch, tcgFetch, fx };
}

const card = (over: Partial<CardRow> = {}): CardRow => ({
  id: 'c1', externalId: 'sv8-1', tcgplayerId: '555', availableFinishes: ['normal'], ...over,
});

describe('PricingService.refreshCardPrices (P-7 ⑤)', () => {
  it('PPT primario trae ref FRESCA → upsert y refreshed', async () => {
    const h = buildHarness({
      cards: [card()],
      pptResult: { rows: [{ cardId: 'c1', finish: 'normal', marketCents: 500, currency: 'USD', source: 'pokemonpricetracker' }], requestOk: true, dailyLimited: false },
    });
    const res = await h.svc.refreshCardPrices(['c1']);
    expect(res.refreshed).toEqual(['c1']);
    expect(res.pending).toEqual([]);
    expect(h.upserts).toHaveLength(1);
    // USD → priceMxnCents = usdToMxnCents(500, 18, 3) > 0; persistido con priceUsdCents.
    expect(h.upserts[0]).toMatchObject({ cardId: 'c1', finish: 'normal', priceUsdCents: 500, source: 'pokemonpricetracker' });
    expect(h.upserts[0].priceMxnCents).toBeGreaterThan(0);
    // El fallback NO se llama (PPT ya precio la carta).
    expect(h.tcgFetch).not.toHaveBeenCalled();
  });

  it('FALLBACK pokemontcg.io solo para cartas que PPT NO precia', async () => {
    const h = buildHarness({
      cards: [card({ id: 'c1' }), card({ id: 'c2' })],
      pptResult: { rows: [{ cardId: 'c1', finish: 'normal', marketCents: 500, currency: 'USD', source: 'pokemonpricetracker' }], requestOk: true, dailyLimited: false },
      tcgIoResult: { rows: [{ cardId: 'c2', finish: 'normal', marketCents: 700, currency: 'USD', source: 'pokemontcg_io' }], requestOk: true, dailyLimited: false },
    });
    const res = await h.svc.refreshCardPrices(['c1', 'c2']);
    expect(res.refreshed.sort()).toEqual(['c1', 'c2']);
    // El fallback recibió SOLO c2 (c1 ya priceada por PPT).
    expect(h.tcgFetch).toHaveBeenCalledTimes(1);
    const fallbackArg = h.tcgFetch.mock.calls[0][0];
    expect(fallbackArg.map((r: any) => r.cardId)).toEqual(['c2']);
  });

  it('dailyLimited del PPT se propaga; el fallback igual rescata la carta', async () => {
    const h = buildHarness({
      cards: [card()],
      pptResult: { rows: [], requestOk: true, dailyLimited: true },
      tcgIoResult: { rows: [{ cardId: 'c1', finish: 'normal', marketCents: 700, currency: 'USD', source: 'pokemontcg_io' }], requestOk: true, dailyLimited: false },
    });
    const res = await h.svc.refreshCardPrices(['c1']);
    expect(res.dailyLimited).toBe(true);
    expect(res.refreshed).toEqual(['c1']);
  });

  it('error del proveedor NO tumba: se intenta el siguiente; sin ref → pending, sin upsert', async () => {
    const boom = jest.fn(async () => { throw new Error('provider blew up'); });
    const h = buildHarness({
      cards: [card()],
      pptResult: boom as any,
      tcgIoResult: { rows: [], requestOk: false, dailyLimited: false },
    });
    const res = await h.svc.refreshCardPrices(['c1']);
    expect(res.refreshed).toEqual([]);
    expect(res.pending).toEqual(['c1']);
    expect(h.upserts).toHaveLength(0); // money-safe: NUNCA se inventa/persiste un precio.
    expect(h.tcgFetch).toHaveBeenCalled(); // el fallback SÍ se intentó.
  });

  it('money-safe: market<=0 NUNCA se persiste (queda pending)', async () => {
    const h = buildHarness({
      cards: [card()],
      pptResult: { rows: [{ cardId: 'c1', finish: 'normal', marketCents: 0, currency: 'USD', source: 'pokemonpricetracker' }], requestOk: true, dailyLimited: false },
    });
    const res = await h.svc.refreshCardPrices(['c1']);
    expect(h.upserts).toHaveLength(0);
    expect(res.pending).toEqual(['c1']);
  });

  it('money-safe: fila USD sin FX (getCurrent falla) se OMITE — no inventa MXN', async () => {
    const h = buildHarness({
      cards: [card()],
      fxThrows: true,
      pptResult: { rows: [{ cardId: 'c1', finish: 'normal', marketCents: 500, currency: 'USD', source: 'pokemonpricetracker' }], requestOk: true, dailyLimited: false },
    });
    const res = await h.svc.refreshCardPrices(['c1']);
    expect(h.upserts).toHaveLength(0);
    expect(res.pending).toEqual(['c1']);
  });

  it('MXN se persiste aun sin FX (no requiere conversión)', async () => {
    const h = buildHarness({
      cards: [card()],
      fxThrows: true,
      pptResult: { rows: [{ cardId: 'c1', finish: 'normal', marketCents: 9000, currency: 'MXN', source: 'pokemonpricetracker' }], requestOk: true, dailyLimited: false },
    });
    const res = await h.svc.refreshCardPrices(['c1']);
    expect(res.refreshed).toEqual(['c1']);
    expect(h.upserts[0]).toMatchObject({ priceMxnCents: 9000, priceUsdCents: null });
  });

  it('cap: nunca más de MAX_FRESH_REPRICE_CARDS cartas por llamada', async () => {
    const many = Array.from({ length: MAX_FRESH_REPRICE_CARDS + 10 }, (_, i) => card({ id: `c${i}`, tcgplayerId: `${i}` }));
    const h = buildHarness({ cards: many, pptResult: { rows: [], requestOk: true, dailyLimited: false } });
    await h.svc.refreshCardPrices(many.map((c) => c.id));
    // card.findMany se llama SOLO con las primeras MAX cartas (cap antes de tocar la BD/proveedor).
    const findManyArg = (h.prisma.card.findMany as jest.Mock).mock.calls[0][0];
    expect(findManyArg.where.id.in).toHaveLength(MAX_FRESH_REPRICE_CARDS);
    const providerArg = h.pptFetch.mock.calls[0][0];
    expect(providerArg.length).toBe(MAX_FRESH_REPRICE_CARDS);
  });

  it('finishes por defecto = availableFinishes de la carta; explícitos sobreescriben', async () => {
    const h = buildHarness({ cards: [card({ availableFinishes: ['normal', 'reverse_holo'] })], pptResult: { rows: [], requestOk: true, dailyLimited: false } });
    await h.svc.refreshCardPrices(['c1']);
    expect(h.pptFetch.mock.calls[0][0][0].finishes).toEqual(['normal', 'reverse_holo']);

    const h2 = buildHarness({ cards: [card({ availableFinishes: ['normal', 'reverse_holo'] })], pptResult: { rows: [], requestOk: true, dailyLimited: false } });
    await h2.svc.refreshCardPrices(['c1'], ['normal']);
    expect(h2.pptFetch.mock.calls[0][0][0].finishes).toEqual(['normal']);
  });
});

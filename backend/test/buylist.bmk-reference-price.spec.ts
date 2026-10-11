import { ConfigService } from '@nestjs/config';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';
import { GATE_ADDRESS_ID, buylistGateMocks } from './helpers/buylist-create-gate';
import { usersStubM61 } from './helpers/m61-mock-defaults';

/**
 * v1.89⟨bmk⟩ (API_CONTRACT §BMK.2 / §BMK.8, ARCHITECTURE §4.BMK) — **EMISOR DE `referencePrice`** en el
 * cotizador de venta (`POST /buylist/quote` y `/quote/batch`).
 *
 * Regla normativa (BMK.2):
 *   priced ⇔ línea cotizada (`quotedPriceCents != null`) ∧ mercado != null ∧ mercado > 0
 *   si no ⇒ `{ status: "pending" }` SIN la clave `priceMxnCents`.
 *
 * - BMK-B1: guardarraíl (rareza premium que cae al bin) ⇒ `precio_pendiente` y `referencePrice` pending,
 *   en `/quote` y en `/quote/batch` (antes salía `priced` con el mercado sospechoso).
 * - BMK-B2: override con mercado 0 ⇒ `cotizada` y `referencePrice` pending (antes `priced` con 0).
 *   Se hace sobre el DOBLE de `getReference`: que el lector real pueda devolver `priced` con 0 es NO MEDIDO
 *   (la ingesta exige `market > 0`; ver BACKEND_NOTES §86).
 * - BMK-B3 (criterio 852, candado): en cada peldaño cotizado y en dos acabados con mercados distintos,
 *   `referencePrice.priceMxnCents` de la cotización === `marketMxnCents` que `createRequest` congela.
 * - BMK-B4 (criterio 857): por ausencia — este fichero solo AÑADE; ninguna aserción existente se edita.
 */

const pii = new PiiCryptoService(new ConfigService({}));
const VALID_CLABE = '012345678901234567';

type OverrideRow = {
  sellOverrideCents?: number | null;
  buyOverrideCents?: number | null;
  bountyEnabled?: boolean;
  bountyPriceCents?: number | null;
};

/** Mercado POR ACABADO (`undefined`/`null` ⇒ la referencia sale `pending`). */
type MarketByFinish = Partial<Record<'normal' | 'reverse_holo', number | null>>;

function buildSvc(opts: {
  rarity?: string;
  market: MarketByFinish;
  overridesByKey?: Record<string, OverrideRow>;
  /** INE ya en el perfil: una solicitud con una línea `precio_pendiente` lo exige (C15). */
  ineOnFile?: boolean;
}) {
  const overridesByKey = opts.overridesByKey ?? {};
  const keyOf = (k: { cardId: string; productType: string; gradeKey: string; finish: string }) =>
    `${k.cardId}|${k.productType}|${k.gradeKey}|${k.finish}`;
  const pricing = {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    gradeKeyFor: jest.fn(({ rawCondition }: { rawCondition?: string }) => `raw:${rawCondition ?? 'NM'}`),
    tryGradeKeyFor: jest.fn(({ rawCondition }: { rawCondition?: string }) => `raw:${rawCondition ?? 'NM'}`),
    getReference: jest.fn(async (_c: string, _p: string, _g: string, finish: 'normal' | 'reverse_holo') => {
      const m = opts.market[finish];
      return m == null ? { status: 'pending' } : { status: 'priced', referenceMxnCents: m };
    }),
    escalatePending: jest.fn().mockResolvedValue(undefined),
    settlePendingForVariant: jest.fn().mockResolvedValue(undefined),
    getVariantOverridesBatch: jest.fn(async (keys: any[]) => {
      const m = new Map<string, OverrideRow>();
      for (const k of keys) if (overridesByKey[keyOf(k)]) m.set(keyOf(k), overridesByKey[keyOf(k)]);
      return m;
    }),
    getVariantOverride: jest.fn(
      async (cardId: string, productType: string, gradeKey: string, finish: string) =>
        overridesByKey[keyOf({ cardId, productType, gradeKey, finish })] ?? null,
    ),
  } as unknown as PricingService;
  const settings = {
    getRaw: jest.fn(async () => ({})),
    getNumber: jest.fn(async (key: string) => {
      if (key === 'buylist_cap_per_request_cents') return 100_000_000;
      if (key === 'buylist_cap_per_month_cents') return 100_000_000;
      if (key === 'ine_threshold_cents') return 100_000_000;
      return 0;
    }),
  } as unknown as SettingsService;
  const card = {
    id: 'c1',
    rarity: opts.rarity ?? 'Common',
    rarityCanonical: null,
    availableFinishes: ['normal', 'reverse_holo'],
  };
  const prisma: any = {
    card: {
      findUnique: jest.fn(async () => card),
      findMany: jest.fn(async () => [card]),
    },
    ...buylistGateMocks('user-1'),
    kycProfile: {
      findUnique: jest
        .fn()
        .mockResolvedValue(opts.ineOnFile ? { ineFrontKey: 'kyc/front', ineBackKey: 'kyc/back' } : null),
      upsert: jest.fn(),
    },
    sellRequest: {
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }: any) => ({
        id: 'sr-1',
        status: data.status,
        quotedTotalCents: data.quotedTotalCents,
        ineRequired: data.ineRequired,
        items: (data.items.create as any[]).map((it, i) => ({
          id: `it-${i}`,
          cardId: it.cardId,
          card: { id: it.cardId, name: 'X', number: '1' },
          productType: it.productType,
          rawCondition: it.rawCondition ?? null,
          finish: it.finish,
          rarity: it.rarity,
          priceBasis: it.priceBasis,
          quotedPriceCents: it.quotedPriceCents,
          approvedPriceCents: null,
          itemStatus: it.itemStatus,
          inventoryItemId: null,
        })),
      })),
    },
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
  };
  const svc = new BuylistService(
    prisma as PrismaService,
    pricing,
    settings,
    usersStubM61() as unknown as UsersService,
    pii,
  );
  return { svc, prisma };
}

const KN = 'c1|raw|raw:NM|normal';
const line = (finish: 'normal' | 'reverse_holo') => ({
  cardId: 'c1',
  productType: 'raw' as never,
  rawCondition: 'NM' as never,
  finish: finish as never,
});

describe('BMK-B1 — guardarraíl (premium al bin) ⇒ precio_pendiente SIN mercado', () => {
  // Mercado MX$1.00 (100 c) ⇒ curva 30 % = 30 c < bin 100 c ⇒ `floor` ⇒ rareza premium ⇒ `premium_at_floor`.
  const opts = { rarity: 'Illustration Rare', market: { normal: 100 } };

  it('POST /buylist/quote', async () => {
    const { svc } = buildSvc(opts);
    const res = await svc.publicQuote('c1', 'raw' as never, 'NM' as never, 'normal' as never);
    expect(res.quote.status).toBe('precio_pendiente');
    expect(res.quote.quotedPriceCents).toBeNull();
    expect(res.referencePrice).toEqual({ status: 'pending' });
    expect('priceMxnCents' in res.referencePrice).toBe(false);
  });

  it('POST /buylist/quote/batch', async () => {
    const { svc } = buildSvc(opts);
    const { results } = await svc.batchQuote([line('normal')]);
    const r = results[0] as any;
    expect(r.ok).toBe(true);
    expect(r.quote.status).toBe('precio_pendiente');
    expect(r.referencePrice).toEqual({ status: 'pending' });
  });

  it('bounty TOPADO en premium al bin (§M2-B.11 punto 8) ⇒ también pending', async () => {
    const { svc } = buildSvc({
      ...opts,
      overridesByKey: { [KN]: { bountyEnabled: true, bountyPriceCents: 50_000 } },
    });
    const res = await svc.publicQuote('c1', 'raw' as never, 'NM' as never, 'normal' as never);
    expect(res.quote.status).toBe('precio_pendiente');
    expect(res.referencePrice).toEqual({ status: 'pending' });
  });

  it('la solicitud NO cambia: createRequest sigue congelando el mercado (100) de la línea pendiente', async () => {
    const { svc, prisma } = buildSvc({
      ...opts,
      // una segunda línea cotizada para que la solicitud tenga total (la pendiente aporta 0)
      market: { normal: 100, reverse_holo: 10_000 },
      ineOnFile: true,
    });
    await svc.createRequest('user-1', [line('normal'), line('reverse_holo')], VALID_CLABE, undefined, GATE_ADDRESS_ID);
    const created = (prisma.sellRequest.create as jest.Mock).mock.calls[0][0].data.items.create;
    expect(created[0]).toMatchObject({ itemStatus: 'precio_pendiente', marketMxnCents: 100 });
  });
});

describe('BMK-B2 — override con mercado 0 ⇒ cotizada SIN mercado', () => {
  const opts = { market: { normal: 0 }, overridesByKey: { [KN]: { buyOverrideCents: 30_000 } } };

  it('POST /buylist/quote', async () => {
    const { svc } = buildSvc(opts);
    const res = await svc.publicQuote('c1', 'raw' as never, 'NM' as never, 'normal' as never);
    expect(res.quote).toEqual({ status: 'cotizada', quotedPriceCents: 30_000, currency: 'MXN' });
    expect(res.priceBasis).toBe('override');
    expect(res.referencePrice).toEqual({ status: 'pending' });
  });

  it('POST /buylist/quote/batch', async () => {
    const { svc } = buildSvc(opts);
    const r = (await svc.batchQuote([line('normal')])).results[0] as any;
    expect(r.quote).toEqual({ status: 'cotizada', quotedPriceCents: 30_000, currency: 'MXN' });
    expect(r.referencePrice).toEqual({ status: 'pending' });
  });

  it('bounty con mercado 0 ⇒ cotizada SIN mercado', async () => {
    const { svc } = buildSvc({
      market: { normal: 0 },
      overridesByKey: { [KN]: { bountyEnabled: true, bountyPriceCents: 20_000 } },
    });
    const res = await svc.publicQuote('c1', 'raw' as never, 'NM' as never, 'normal' as never);
    expect(res.quote.status).toBe('cotizada');
    expect(res.referencePrice).toEqual({ status: 'pending' });
  });
});

describe('BMK-B3 — criterio 852: el mercado cotizado === el congelado en la solicitud', () => {
  const cases: Array<{
    name: string;
    basis: string;
    market: MarketByFinish;
    overridesByKey?: Record<string, OverrideRow>;
  }> = [
    { name: 'market (curva)', basis: 'market', market: { normal: 10_000 } },
    { name: 'floor (bin, rareza no premium)', basis: 'floor', market: { normal: 100 } },
    { name: 'override', basis: 'override', market: { normal: 10_000 }, overridesByKey: { [KN]: { buyOverrideCents: 30_000 } } },
    { name: 'bounty', basis: 'bounty', market: { normal: 10_000 }, overridesByKey: { [KN]: { bountyEnabled: true, bountyPriceCents: 7_500 } } },
    { name: 'bounty topado', basis: 'bounty', market: { normal: 10_000 }, overridesByKey: { [KN]: { bountyEnabled: true, bountyPriceCents: 15_000 } } },
  ];

  it.each(cases)('peldaño $name', async ({ basis, market, overridesByKey }) => {
    const q = await buildSvc({ market, overridesByKey }).svc.publicQuote(
      'c1', 'raw' as never, 'NM' as never, 'normal' as never,
    );
    const b = (await buildSvc({ market, overridesByKey }).svc.batchQuote([line('normal')])).results[0] as any;
    const { svc, prisma } = buildSvc({ market, overridesByKey });
    await svc.createRequest('user-1', [line('normal')], VALID_CLABE, undefined, GATE_ADDRESS_ID);
    const created = (prisma.sellRequest.create as jest.Mock).mock.calls[0][0].data.items.create[0];

    expect(q.priceBasis).toBe(basis);
    expect(q.quote.status).toBe('cotizada');
    expect(created.itemStatus).toBe('cotizada');
    expect(created.marketMxnCents).toEqual(expect.any(Number));
    expect(q.referencePrice).toEqual({ status: 'priced', priceMxnCents: created.marketMxnCents });
    expect(b.referencePrice).toEqual({ status: 'priced', priceMxnCents: created.marketMxnCents });
    // y el importe tampoco cambia entre superficies
    expect(q.quote.quotedPriceCents).toBe(created.quotedPriceCents);
  });

  it('bounty topado paga el mercado (comprobación del fixture: el peldaño es el que dice ser)', async () => {
    const { svc } = buildSvc({
      market: { normal: 10_000 },
      overridesByKey: { [KN]: { bountyEnabled: true, bountyPriceCents: 15_000 } },
    });
    const res = await svc.publicQuote('c1', 'raw' as never, 'NM' as never, 'normal' as never);
    expect(res.quote.quotedPriceCents).toBe(10_000);
  });

  it('dos acabados de la misma carta con mercados distintos: cada uno el SUYO', async () => {
    const market = { normal: 10_000, reverse_holo: 25_000 };
    const { results } = await buildSvc({ market }).svc.batchQuote([line('normal'), line('reverse_holo')]);
    const { svc, prisma } = buildSvc({ market });
    await svc.createRequest('user-1', [line('normal'), line('reverse_holo')], VALID_CLABE, undefined, GATE_ADDRESS_ID);
    const created = (prisma.sellRequest.create as jest.Mock).mock.calls[0][0].data.items.create;

    expect(created.map((c: any) => c.marketMxnCents)).toEqual([10_000, 25_000]);
    expect((results[0] as any).referencePrice).toEqual({ status: 'priced', priceMxnCents: 10_000 });
    expect((results[1] as any).referencePrice).toEqual({ status: 'priced', priceMxnCents: 25_000 });
    const single = await buildSvc({ market }).svc.publicQuote(
      'c1', 'raw' as never, 'NM' as never, 'reverse_holo' as never,
    );
    expect(single.referencePrice).toEqual({ status: 'priced', priceMxnCents: 25_000 });
  });
});

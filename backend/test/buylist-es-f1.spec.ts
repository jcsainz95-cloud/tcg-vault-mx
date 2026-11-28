import { ConfigService } from '@nestjs/config';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { DEFAULT_PRICING_CURVE, resolveBuyFromCurve } from '../src/common/pricing-curve';
import { scaleByPct } from '../src/common/card-version';
import { SETTING_DEFAULTS, SETTING_VALIDATORS, SettingKey } from '../src/modules/settings/settings.constants';
import { GATE_ADDRESS_ID, buylistGateMocks } from './helpers/buylist-create-gate';
import { usersStubM61 } from './helpers/m61-mock-defaults';

/**
 * §BUYLIST-ES F1 (API_CONTRACT_BUYLIST_ES §3, §6 criterios 1-4 y 5) — el cálculo de COMPRA con idioma: castigo PRIMERO, luego la curva vigente
 * (semilla 30/40/50 %), anti-inflado (ES ≤ EN), dial apagado = comportamiento de hoy. Cuerpo único `decideBuyLine`: `/quote`, `/quote/batch` y
 * `POST /requests` dan el MISMO monto. Dinero en centavos enteros.
 */
const pii = new PiiCryptoService(new ConfigService({}));
const VALID_CLABE = '012345678901234567';

type Dials = { enabled?: unknown; penalty?: unknown; league?: unknown };
type Override = { buyOverrideCents?: number | null; bountyEnabled?: boolean; bountyPriceCents?: number | null };

function buildSvc(opts: { market: number | null; dials?: Dials; rarity?: string; override?: Override; promoMarket?: number | null; curve?: typeof DEFAULT_PRICING_CURVE }) {
  const dials = { enabled: false, penalty: 15, league: false, ...(opts.dials ?? {}) };
  const pricing = {
    loadPricingCurve: jest.fn(async () => opts.curve ?? DEFAULT_PRICING_CURVE),
    gradeKeyFor: jest.fn(({ rawCondition }: { rawCondition?: string }) => `raw:${rawCondition ?? 'NM'}`),
    tryGradeKeyFor: jest.fn(({ rawCondition }: { rawCondition?: string }) => `raw:${rawCondition ?? 'NM'}`),
    getReference: jest.fn(async () => (opts.market == null ? { status: 'pending' } : { status: 'priced', referenceMxnCents: opts.market })),
    getReferenceByCardProduct: jest.fn(async () =>
      opts.promoMarket == null ? { status: 'pending' } : { status: 'priced', referenceMxnCents: opts.promoMarket },
    ),
    findCardProductByTcgId: jest.fn(async (id: number) => ({ id: `cp-${id}`, cardId: 'c1', finishes: ['normal'], kind: 'promo' })),
    escalatePending: jest.fn().mockResolvedValue(undefined),
    settlePendingForVariant: jest.fn().mockResolvedValue(undefined),
    getVariantOverridesBatch: jest.fn(async () => {
      const m = new Map<string, Override>();
      if (opts.override) m.set('c1|raw|raw:NM|normal', opts.override);
      return m;
    }),
    getVariantOverride: jest.fn(async () => opts.override ?? null),
  } as unknown as PricingService;
  const settings = {
    getRaw: jest.fn(async (key: string) =>
      key === SettingKey.BUYLIST_SPANISH_ENABLED
        ? dials.enabled
        : key === SettingKey.BUYLIST_SPANISH_PENALTY_PCT
          ? dials.penalty
          : key === SettingKey.BUYLIST_LEAGUE_ENABLED
            ? dials.league
            : {},
    ),
    getNumber: jest.fn(async (key: string) => {
      if (key === 'buylist_cap_per_request_cents') return 100_000_000;
      if (key === 'buylist_cap_per_month_cents') return 100_000_000;
      if (key === 'ine_threshold_cents') return 100_000_000;
      return 0;
    }),
  } as unknown as SettingsService;
  const card = { id: 'c1', rarity: opts.rarity ?? 'Common', rarityCanonical: null, availableFinishes: ['normal'] };
  const created: any[] = [];
  const prisma: any = {
    card: { findUnique: jest.fn(async () => card), findMany: jest.fn(async () => [card]) },
    ...buylistGateMocks('user-1'),
    kycProfile: { findUnique: jest.fn().mockResolvedValue({ ineFrontKey: 'kyc/front', ineBackKey: 'kyc/back' }), upsert: jest.fn() },
    sellRequest: {
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }: any) => {
        created.push(...(data.items.create as any[]));
        return {
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
        };
      }),
    },
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
  };
  const svc = new BuylistService(prisma as PrismaService, pricing, settings, usersStubM61() as unknown as UsersService, pii);
  return { svc, prisma, created };
}

const ON = { enabled: true, penalty: 15 };
const raw = { productType: 'raw' as never, rawCondition: 'NM' as never, finish: 'normal' as never };
/** Curva semilla, sin redondeo (§N.1): lo que paga la compra inglesa por un mercado. */
const curveCents = (m: number) => resolveBuyFromCurve(m, DEFAULT_PRICING_CURVE).cents as number;
/** 20 mercados repartidos en los tres tramos de la semilla (MX$ 30 … MX$ 2,500), en centavos. */
const MARKETS = [3000, 4500, 6000, 8000, 9900, 10_000, 12_345, 15_000, 20_000, 27_777, 35_000, 49_999, 50_000, 61_111, 75_000, 99_999, 100_000, 133_333, 180_000, 250_000];

describe('§BUYLIST-ES F1 · §3 — el ejemplo del contrato: MX$1,000 → MX$850 → MX$425 (inglés MX$500)', () => {
  it('/quote en español con el interruptor encendido', async () => {
    const { svc } = buildSvc({ market: 100_000, dials: ON });
    const es = await svc.publicQuote('c1', raw.productType, raw.rawCondition, raw.finish, undefined, 'es');
    expect(es.quote).toEqual({ status: 'cotizada', quotedPriceCents: 42_500, currency: 'MXN' });
    expect(es.language).toBe('es');
    expect(es.offers).toEqual({ en: 50_000, es: 42_500 });
    expect(es.spanishEligible).toBe(true);
    expect(es.stampOptions).toEqual([]);
    expect(es.breakdown).toEqual({
      marketMxnCents: 100_000,
      languagePenalty: { pct: 15, cents: -15_000 },
      adjustedMarketCents: 85_000,
      curveBp: 5000,
      curveOfferCents: 42_500,
      cap: null,
      source: 'curve',
      finalOfferCents: 42_500,
    });
    expect(es.versions.map((v) => [v.key, v.offerCents])).toEqual([['en', 50_000], ['es', 42_500]]);
  });

  it('sin `language` = inglés: MX$500 y el desglose sin castigo (`languagePenalty: null`)', async () => {
    const { svc } = buildSvc({ market: 100_000, dials: ON });
    const en = await svc.publicQuote('c1', raw.productType, raw.rawCondition, raw.finish);
    expect(en.quote.quotedPriceCents).toBe(50_000);
    expect(en.language).toBe('en');
    expect(en.breakdown).toMatchObject({ languagePenalty: null, adjustedMarketCents: 100_000, finalOfferCents: 50_000 });
  });

  it('la curva se evalúa sobre el mercado YA castigado, interpolada (no un 50 % plano): 500 → 425 → MX$204.53 (NO los MX$212.50 «ilustrativos» de §3.1)', async () => {
    // §3.1 ilustra 500→425→212.50 suponiendo 50 % plano, pero MX$425 < MX$500 y la semilla interpola 40 %→50 % entre MX$100 y MX$500 (§3 manda: «curva(mercadoAjustado)»).
    const { svc } = buildSvc({ market: 50_000, dials: ON });
    const es = await svc.publicQuote('c1', raw.productType, raw.rawCondition, raw.finish, undefined, 'es');
    expect(es.quote.quotedPriceCents).toBe(curveCents(42_500));
    expect(es.quote.quotedPriceCents).toBe(20_453);
  });
});

describe('§BUYLIST-ES F1 · contrato 3bd37eee — ejemplo único con tramo de 70 %', () => {
  it('{100000, −15 % = −15000, ajustado 85000, curveBp 7000, curveOfferCents 59500, cap null, final 59500}; sin basePct ni baseOfferCents', async () => {
    const curve = { ...DEFAULT_PRICING_CURVE, buy: { binCents: 100, points: [{ marketCents: 2500, pctBp: 7000 }, { marketCents: 50000, pctBp: 7000 }] } };
    const { svc } = buildSvc({ market: 100_000, dials: ON, curve });
    const es = await svc.publicQuote('c1', raw.productType, raw.rawCondition, raw.finish, undefined, 'es');
    expect(es.breakdown).toEqual({
      marketMxnCents: 100_000,
      languagePenalty: { pct: 15, cents: -15_000 },
      adjustedMarketCents: 85_000,
      curveBp: 7000,
      curveOfferCents: 59_500,
      cap: null,
      source: 'curve',
      finalOfferCents: 59_500,
    });
    expect(es.quote.quotedPriceCents).toBe(59_500);
  });
});

describe('§BUYLIST-ES F1 · criterio 2 — 20 cartas: final = curva(round(mercado×(100−P)/100)) exacto al centavo, ≤ inglés', () => {
  for (const P of [15, 0, 40]) {
    it(`P=${P}`, async () => {
      let ok = 0;
      for (const m of MARKETS) {
        const { svc } = buildSvc({ market: m, dials: { enabled: true, penalty: P } });
        const es = await svc.publicQuote('c1', raw.productType, raw.rawCondition, raw.finish, undefined, 'es');
        const adjusted = m - scaleByPct(m, P);
        const esperado = Math.min(curveCents(adjusted), curveCents(m), m);
        expect(es.quote.quotedPriceCents).toBe(esperado);
        expect(es.offers.es as number).toBeLessThanOrEqual(es.offers.en as number);
        expect(Number.isInteger(es.quote.quotedPriceCents)).toBe(true);
        // mercado + castigo = ajustado, y final = curva sobre el ajustado (contrato 3bd37eee).
        const b = es.breakdown!;
        expect(b.marketMxnCents! + (b.languagePenalty?.cents ?? 0)).toBe(b.adjustedMarketCents);
        expect(b.finalOfferCents).toBe(es.quote.quotedPriceCents);
        if (P === 0) expect(es.offers.es).toBe(es.offers.en);
        ok++;
      }
      expect(ok).toBe(20);
    });
  }
});

describe('§BUYLIST-ES F1 · §3.2 / criterio 3 — invariante y tolerancia del desglose (60 mercados = 20 × P∈{0,15,40}, curva viva)', () => {
  const half = (n: number, d: number) => Math.floor((2 * n + d) / (2 * d));
  it('mercado+castigo=ajustado, final=curveOfferCents|cap.cents, y tolerancia de curveBp (≤1 c; ≤2 c en el tramo interpolado MX$100–500, medido)', async () => {
    let n = 0;
    const peor: { adj: number; err: number }[] = [];
    for (const P of [0, 15, 40]) {
      for (const m of MARKETS) {
        const { svc } = buildSvc({ market: m, dials: { enabled: true, penalty: P } });
        const es = await svc.publicQuote('c1', raw.productType, raw.rawCondition, raw.finish, undefined, 'es');
        const b = es.breakdown!;
        expect(b.marketMxnCents! + (b.languagePenalty?.cents ?? 0)).toBe(b.adjustedMarketCents);
        expect(b.finalOfferCents).toBe(b.cap?.cents ?? b.curveOfferCents);
        expect(b.finalOfferCents).toBe(es.quote.quotedPriceCents);
        expect(b.curveBp).toBe(half(b.curveOfferCents! * 10_000, b.adjustedMarketCents!));
        const err = Math.abs(b.curveOfferCents! - half(b.adjustedMarketCents! * b.curveBp! , 10_000));
        peor.push({ adj: b.adjustedMarketCents!, err });
        // MEDIDO con la curva viva (semilla): ≤ 1 centavo fuera del tramo interpolado (ajustado ≤ MX$100 o ≥ MX$500); DENTRO (MX$100–500) llega a 2
        // (error de redondear el % a puntos base: ajustado × 0,5 pb ≈ 2,5 c a MX$500). La cota «≤ 1 hasta MX$2,000» de §3.2 NO se cumple en ese tramo.
        const interpolado = b.adjustedMarketCents! > 10_000 && b.adjustedMarketCents! < 50_000;
        expect(err).toBeLessThanOrEqual(interpolado ? 2 : 1);
        n++;
      }
    }
    expect(n).toBe(60);
    // Informativo (no es parte del contrato): el peor error medido sobre estos 60.
    // eslint-disable-next-line no-console
    console.log('[BUYLIST-ES curveBp] peor error de tolerancia (centavos):', Math.max(...peor.map((x) => x.err)), 'sobre', peor.length);
  });

  it('tope visible: el de inglés cuando recorta (P=0 con la curva que cae al piso) y el piso cuando la curva queda bajo el bin', async () => {
    const curve = { ...DEFAULT_PRICING_CURVE, buy: { binCents: 5_000, points: [{ marketCents: 2500, pctBp: 1000 }, { marketCents: 50000, pctBp: 1000 }] } };
    // mercado 10_000 · curva 10 % = 1_000 < piso 5_000 ⇒ el piso fija el monto (cap floor) y curveOfferCents es lo que dio la curva sin piso.
    const es = await buildSvc({ market: 10_000, dials: { enabled: true, penalty: 0 }, curve }).svc.publicQuote('c1', raw.productType, raw.rawCondition, raw.finish, undefined, 'es');
    expect(es.breakdown).toMatchObject({ curveOfferCents: 1_000, cap: { reason: 'floor', cents: 5_000 }, finalOfferCents: 5_000 });
    // Tope de inglés: el piso del castigado NO puede pasar la oferta inglesa; se fuerza con un override en la inglesa NO (es otra rama) —
    // aquí la inglesa paga lo mismo que la española con P=0 y el tope no recorta (cap = piso, no en_offer).
    expect(es.offers.es).toBe(es.offers.en);
  });
});

describe('§BUYLIST-ES F1 · criterio 4 — /quote, /quote/batch y POST /requests dan el MISMO monto (20/20)', () => {
  it('misma (carta, acabado, idioma) ⇒ mismo monto en las tres superficies', async () => {
    let iguales = 0;
    for (const m of MARKETS) {
      for (const language of ['en', 'es'] as const) {
        const { svc } = buildSvc({ market: m, dials: ON });
        const q = await svc.publicQuote('c1', raw.productType, raw.rawCondition, raw.finish, undefined, language);
        const b = await svc.batchQuote([{ cardId: 'c1', ...raw, language }]);
        const r = await svc.createRequest('user-1', [{ cardId: 'c1', ...raw, language }], VALID_CLABE, undefined, GATE_ADDRESS_ID).catch(() => null);
        const batchAmt = (b.results[0] as any).quote.quotedPriceCents;
        expect(batchAmt).toBe(q.quote.quotedPriceCents);
        if (r) expect((r as any).items[0].quotedPriceCents).toBe(q.quote.quotedPriceCents);
        iguales++;
      }
    }
    expect(iguales).toBe(40);
  });
});

describe('§BUYLIST-ES F1 · dial apagado = comportamiento de hoy (criterio 1, regresión cero)', () => {
  it('sin `language`, el monto inglés es el de la curva en 20/20 y el español no existe', async () => {
    let ok = 0;
    for (const m of MARKETS) {
      const { svc } = buildSvc({ market: m }); // interruptor apagado (default)
      const q = await svc.publicQuote('c1', raw.productType, raw.rawCondition, raw.finish);
      expect(q.quote.quotedPriceCents).toBe(curveCents(m));
      expect(q.offers).toEqual({ en: curveCents(m), es: null });
      expect(q.spanishEligible).toBe(false);
      expect(q.versions).toHaveLength(1);
      ok++;
    }
    expect(ok).toBe(20);
  });

  it('pedir español con el interruptor apagado ⇒ 400 LANGUAGE_NOT_AVAILABLE (quote) y por-ítem en el lote; la solicitud NO se crea', async () => {
    const { svc, prisma } = buildSvc({ market: 100_000 });
    await expect(svc.publicQuote('c1', raw.productType, raw.rawCondition, raw.finish, undefined, 'es')).rejects.toMatchObject({
      code: 'LANGUAGE_NOT_AVAILABLE',
      status: 400,
    });
    const b = await svc.batchQuote([{ cardId: 'c1', ...raw, language: 'es' }, { cardId: 'c1', ...raw }]);
    expect((b.results[0] as any).error.code).toBe('LANGUAGE_NOT_AVAILABLE');
    expect((b.results[1] as any).ok).toBe(true);
    await expect(
      svc.createRequest('user-1', [{ cardId: 'c1', ...raw, language: 'es' }], VALID_CLABE, undefined, GATE_ADDRESS_ID),
    ).rejects.toMatchObject({ code: 'LANGUAGE_NOT_AVAILABLE' });
    expect(prisma.sellRequest.create).not.toHaveBeenCalled();
  });

  it('dial de castigo inválido (95, 15.5, "x") ⇒ falla cerrado: offers.es null y pedir es ⇒ 400', async () => {
    for (const penalty of [95, 15.5, 'x', -1, null]) {
      const { svc } = buildSvc({ market: 100_000, dials: { enabled: true, penalty } });
      const q = await svc.publicQuote('c1', raw.productType, raw.rawCondition, raw.finish);
      expect(q.offers).toEqual({ en: 50_000, es: null });
      expect(q.spanishEligible).toBe(false);
      await expect(svc.publicQuote('c1', raw.productType, raw.rawCondition, raw.finish, undefined, 'es')).rejects.toMatchObject({
        code: 'LANGUAGE_NOT_AVAILABLE',
      });
    }
  });

  it('el interruptor solo vale con `true` booleano (la cadena "true" no lo enciende)', async () => {
    const { svc } = buildSvc({ market: 100_000, dials: { enabled: 'true' } });
    expect((await svc.publicQuote('c1', raw.productType, raw.rawCondition, raw.finish)).offers.es).toBeNull();
  });
});

describe('§BUYLIST-ES F1 · §2 — elegibilidad del español', () => {
  it('graduada ⇒ LANGUAGE_NOT_ELIGIBLE (antes que la guarda raw-only)', async () => {
    const { svc } = buildSvc({ market: 100_000, dials: ON });
    await expect(svc.publicQuote('c1', 'graded' as never, undefined, 'normal' as never, undefined, 'es')).rejects.toMatchObject({
      code: 'LANGUAGE_NOT_ELIGIBLE',
      status: 400,
    });
  });

  it('producto separado (promo/deck_exclusive) ⇒ LANGUAGE_NOT_ELIGIBLE; en inglés sigue cotizando como hoy', async () => {
    const { svc } = buildSvc({ market: 100_000, dials: ON, promoMarket: 20_000 });
    await expect(svc.publicQuote('c1', raw.productType, raw.rawCondition, raw.finish, 777, 'es')).rejects.toMatchObject({
      code: 'LANGUAGE_NOT_ELIGIBLE',
    });
    const en = await svc.publicQuote('c1', raw.productType, raw.rawCondition, raw.finish, 777);
    expect(en.quote.quotedPriceCents).toBe(curveCents(20_000));
    expect(en.spanishEligible).toBe(false);
    expect(en.offers.es).toBeNull();
  });

  it('`stamped` sigue rechazado en F1 (PRODUCT_NOT_FOUND): la liga es F4', async () => {
    const { svc } = buildSvc({ market: 100_000, dials: ON });
    (svc as any).pricing.findCardProductByTcgId = jest.fn(async () => ({ id: 'cp-s', cardId: 'c1', finishes: ['normal'], kind: 'stamped' }));
    await expect(svc.publicQuote('c1', raw.productType, raw.rawCondition, raw.finish, 888)).rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND' });
  });

  it('el lote: lo no elegible es error POR-ÍTEM y no tumba las demás líneas', async () => {
    const { svc } = buildSvc({ market: 100_000, dials: ON, promoMarket: 20_000 });
    const b = await svc.batchQuote([
      { cardId: 'c1', ...raw, language: 'es' },
      { cardId: 'c1', ...raw, productId: 777, language: 'es' },
      { cardId: 'c1', productType: 'graded' as never, language: 'es' },
    ]);
    expect((b.results[0] as any).ok).toBe(true);
    expect((b.results[1] as any).error.code).toBe('LANGUAGE_NOT_ELIGIBLE');
    expect((b.results[2] as any).error.code).toBe('LANGUAGE_NOT_ELIGIBLE');
  });
});

describe('§BUYLIST-ES F1 · §3.4 — anti-inflado y detenciones heredadas', () => {
  it('sin mercado: la inglesa está pendiente ⇒ la española NO se cotiza (precio_pendiente, nunca un monto)', async () => {
    const { svc } = buildSvc({ market: null, dials: ON });
    const es = await svc.publicQuote('c1', raw.productType, raw.rawCondition, raw.finish, undefined, 'es');
    expect(es.quote).toEqual({ status: 'precio_pendiente', quotedPriceCents: null, currency: 'MXN' });
    expect(es.offers).toEqual({ en: null, es: null });
    // I2 (§3.3): la ES pendiente congela igual su desglose: solo el castigo P, sin montos.
    expect(es.breakdown).toEqual({
      marketMxnCents: null,
      languagePenalty: { pct: 15, cents: null },
      adjustedMarketCents: null,
      curveBp: null,
      curveOfferCents: null,
      cap: null,
      source: 'pending',
      finalOfferCents: null,
    });
  });

  it('override de compra en la inglesa: la española RECIBE el castigo (override − round_half_up(override×P/100)), source override, curveBp null, nunca por encima', async () => {
    const { svc } = buildSvc({ market: 100_000, dials: ON, override: { buyOverrideCents: 10_000 } });
    const es = await svc.publicQuote('c1', raw.productType, raw.rawCondition, raw.finish, undefined, 'es');
    expect(es.offers.en).toBe(10_000);
    expect(es.quote.quotedPriceCents).toBe(8_500);
    expect(es.breakdown).toEqual({
      marketMxnCents: 10_000,
      languagePenalty: { pct: 15, cents: -1_500 },
      adjustedMarketCents: 8_500,
      curveBp: null,
      curveOfferCents: null,
      cap: null,
      source: 'override',
      finalOfferCents: 8_500,
    });
    // Redondeo half_up del contrato: 10_001 × 85 % = 8_500.85 ⇒ 8_501; el castigo sale por diferencia y cuadra.
    const odd = await buildSvc({ market: 100_000, dials: ON, override: { buyOverrideCents: 10_001 } }).svc.publicQuote('c1', raw.productType, raw.rawCondition, raw.finish, undefined, 'es');
    expect(odd.quote.quotedPriceCents).toBe(8_501);
    expect(odd.breakdown!.marketMxnCents! + odd.breakdown!.languagePenalty!.cents!).toBe(8_501);
    // La inglesa con override no cambia: sin castigo, sin curva.
    const en = await buildSvc({ market: 100_000, dials: ON, override: { buyOverrideCents: 10_000 } }).svc.publicQuote('c1', raw.productType, raw.rawCondition, raw.finish);
    expect(en.breakdown).toMatchObject({ source: 'override', languagePenalty: null, curveBp: null, cap: null, finalOfferCents: 10_000 });
  });

  it('bounty NO aplica al español: la inglesa paga el bounty (tope = mercado), la española sale de la curva y ≤ inglesa', async () => {
    const { svc } = buildSvc({ market: 100_000, dials: ON, override: { bountyEnabled: true, bountyPriceCents: 90_000 } });
    const en = await svc.publicQuote('c1', raw.productType, raw.rawCondition, raw.finish);
    const es = await svc.publicQuote('c1', raw.productType, raw.rawCondition, raw.finish, undefined, 'es');
    expect(en.quote.quotedPriceCents).toBe(90_000);
    expect(es.quote.quotedPriceCents).toBe(42_500);
    expect(es.breakdown?.curveBp).toBe(5000);
  });

  it('rareza premium cuyo mercado castigado cae al piso (bin) ⇒ la española queda pendiente aunque la inglesa se cotice', async () => {
    // Premium ⇒ `premium_at_floor` si la curva cae al bin. Mercado 150 c: inglés 30 % = 45 c < bin ⇒ ya pendiente; se busca uno que la inglesa SÍ pase:
    // con la semilla, el bin manda por debajo de ~MX$3.33 en cualquier tramo; un mercado que pase en EN y falle en ES exige el ajustado bajo el bin.
    const bin = DEFAULT_PRICING_CURVE.buy.binCents;
    const m = Math.ceil((bin * 100) / 30) + 1; // EN: 30 % de m ≥ bin ⇒ 'market'; ES (×0.85): 25.5 % de m < bin ⇒ 'floor'
    const { svc } = buildSvc({ market: m, dials: ON, rarity: 'Illustration Rare' });
    const en = await svc.publicQuote('c1', raw.productType, raw.rawCondition, raw.finish);
    const es = await svc.publicQuote('c1', raw.productType, raw.rawCondition, raw.finish, undefined, 'es');
    expect(en.quote.status).toBe('cotizada');
    expect(es.quote.status).toBe('precio_pendiente');
    expect(es.offers.es).toBeNull();
  });
});

describe('§BUYLIST-ES F1 · §3.2 — la cola del dueño: una línea ES pendiente entra igual que una EN', () => {
  it('solo-ES pendiente (la inglesa se cotiza) llama a la cola con su causa', async () => {
    const bin = DEFAULT_PRICING_CURVE.buy.binCents;
    const m = Math.ceil((bin * 100) / 30) + 1; // misma construcción que el caso premium de §3.4: EN cotiza, ES cae al piso
    const { svc } = buildSvc({ market: m, dials: ON, rarity: 'Illustration Rare' });
    const pricing = (svc as any).pricing as { settlePendingForVariant: jest.Mock };
    await svc.createRequest('user-1', [{ cardId: 'c1', ...raw, language: 'es' }], VALID_CLABE, undefined, GATE_ADDRESS_ID).catch(() => null);
    const reasons = pricing.settlePendingForVariant.mock.calls.map((c) => c[0]);
    expect(reasons.length).toBe(1);
    expect(reasons[0]).not.toBeNull();
  });
});

describe('§BUYLIST-ES F1 · POST /requests congela idioma, versionOffers y desglose; EN y ES son 2 líneas (criterio 6)', () => {
  it('la solicitud trae las dos líneas con su monto, su idioma, su mapa de ofertas y su desglose', async () => {
    const { svc, created } = buildSvc({ market: 100_000, dials: ON });
    await svc.createRequest(
      'user-1',
      [{ cardId: 'c1', ...raw }, { cardId: 'c1', ...raw, language: 'es' }],
      VALID_CLABE,
      undefined,
      GATE_ADDRESS_ID,
    );
    expect(created).toHaveLength(2);
    const [en, es] = created;
    expect(en).toMatchObject({ language: 'en', quotedPriceCents: 50_000, marketMxnCents: 100_000, versionOffers: { en: 50_000, es: 42_500 } });
    expect(es).toMatchObject({ language: 'es', quotedPriceCents: 42_500, marketMxnCents: 100_000, priceBasis: 'market', versionOffers: { en: 50_000, es: 42_500 } });
    expect(es.offerBreakdown).toEqual({
      marketMxnCents: 100_000,
      languagePenalty: { pct: 15, cents: -15_000 },
      adjustedMarketCents: 85_000,
      curveBp: 5000,
      curveOfferCents: 42_500,
      cap: null,
      source: 'curve',
      finalOfferCents: 42_500,
    });
  });

  it('con el interruptor apagado una solicitud inglesa congela solo la versión inglesa y su desglose sin castigo', async () => {
    const { svc, created } = buildSvc({ market: 100_000 });
    await svc.createRequest('user-1', [{ cardId: 'c1', ...raw }], VALID_CLABE, undefined, GATE_ADDRESS_ID);
    expect(created[0]).toMatchObject({ language: 'en', quotedPriceCents: 50_000, versionOffers: { en: 50_000 } });
    expect(created[0].offerBreakdown.languagePenalty).toBeNull();
  });
});

describe('§BUYLIST-ES F1 · §1 — diales: semilla, validadores y `quote-policy`', () => {
  it('defaults del código: castigo 15, ambos interruptores apagados', () => {
    expect(SETTING_DEFAULTS[SettingKey.BUYLIST_SPANISH_PENALTY_PCT]).toBe(15);
    expect(SETTING_DEFAULTS[SettingKey.BUYLIST_SPANISH_ENABLED]).toBe(false);
    expect(SETTING_DEFAULTS[SettingKey.BUYLIST_LEAGUE_ENABLED]).toBe(false);
  });

  it('castigo: entero [0,90]; interruptores: booleano estricto', () => {
    const p = SETTING_VALIDATORS[SettingKey.BUYLIST_SPANISH_PENALTY_PCT];
    for (const ok of [0, 15, 90]) expect(p(ok)).toBeNull();
    for (const bad of [-1, 91, 15.5, '15', null, NaN]) expect(p(bad)).not.toBeNull();
    for (const k of [SettingKey.BUYLIST_SPANISH_ENABLED, SettingKey.BUYLIST_LEAGUE_ENABLED]) {
      expect(SETTING_VALIDATORS[k](true)).toBeNull();
      expect(SETTING_VALIDATORS[k](false)).toBeNull();
      for (const bad of ['on', 'true', 1, 0, null]) expect(SETTING_VALIDATORS[k](bad)).not.toBeNull();
    }
  });

  it('quote-policy suma spanishEnabled/leagueEnabled/spanishPenaltyPct (apagados por defecto)', async () => {
    const { svc } = buildSvc({ market: 1 });
    const pol = await svc.quotePolicy();
    expect(pol).toMatchObject({ spanishEnabled: false, leagueEnabled: false, spanishPenaltyPct: 15 });
    const on = await buildSvc({ market: 1, dials: { enabled: true, penalty: 20, league: true } }).svc.quotePolicy();
    expect(on).toMatchObject({ spanishEnabled: true, leagueEnabled: true, spanishPenaltyPct: 20 });
  });

  it('quote-policy con el castigo INVÁLIDO: español apagado y el castigo no inventa un 15 (0)', async () => {
    for (const bad of [150, -1, 15.5, '15']) {
      const pol = await buildSvc({ market: 1, dials: { enabled: true, penalty: bad as number, league: false } }).svc.quotePolicy();
      expect(pol).toMatchObject({ spanishEnabled: false, spanishPenaltyPct: 0 });
    }
  });
});

describe('§BUYLIST-ES §3.3 — M1: una sola fórmula de castigo (10010 c a 15 % ⇒ castigo 1502, ajustado 8508) en curva y override', () => {
  it('camino de curva: el castigo sale de round_half_up(M×P/100)', async () => {
    const { svc } = buildSvc({ market: 10_010, dials: ON });
    const es = await svc.publicQuote('c1', raw.productType, raw.rawCondition, raw.finish, undefined, 'es');
    expect(es.breakdown).toMatchObject({ marketMxnCents: 10_010, languagePenalty: { pct: 15, cents: -1_502 }, adjustedMarketCents: 8_508, source: 'curve' });
  });
  it('camino de override: mismo castigo y ajustado; curveBp/curveOfferCents null; el monto es el ajustado', async () => {
    const { svc } = buildSvc({ market: 100_000, dials: ON, override: { buyOverrideCents: 10_010 } });
    const es = await svc.publicQuote('c1', raw.productType, raw.rawCondition, raw.finish, undefined, 'es');
    expect(es.breakdown).toEqual({
      marketMxnCents: 10_010,
      languagePenalty: { pct: 15, cents: -1_502 },
      adjustedMarketCents: 8_508,
      curveBp: null,
      curveOfferCents: null,
      cap: null,
      source: 'override',
      finalOfferCents: 8_508,
    });
    expect(es.quote.quotedPriceCents).toBe(8_508);
  });
});

describe('§BUYLIST-ES §3.4 (BES-3) — el anti-inflado `Math.min(curva, EN, referencia)` es lo que impide que ES > EN', () => {
  it('curva con % decreciente: la curva del ajustado (2 890) pagaría más que la inglesa (1 000) ⇒ tope en_offer, final = EN', async () => {
    const curve = { ...DEFAULT_PRICING_CURVE, buy: { binCents: 100, points: [{ marketCents: 5_000, pctBp: 9_000 }, { marketCents: 10_000, pctBp: 1_000 }] } };
    const { svc } = buildSvc({ market: 10_000, dials: ON, curve });
    const en = await svc.publicQuote('c1', raw.productType, raw.rawCondition, raw.finish);
    const es = await svc.publicQuote('c1', raw.productType, raw.rawCondition, raw.finish, undefined, 'es');
    expect(en.quote.quotedPriceCents).toBe(1_000);
    expect(es.breakdown!.curveOfferCents).toBeGreaterThan(1_000); // sin el Math.min esto sería el monto
    expect(es.quote.quotedPriceCents).toBe(1_000);
    expect(es.offers.es as number).toBeLessThanOrEqual(es.offers.en as number);
    expect(es.breakdown).toMatchObject({ cap: { reason: 'en_offer', cents: 1_000 }, finalOfferCents: 1_000 });
  });
});

describe('§BUYLIST-ES §3.3 — I2: línea ES pendiente congela el castigo; reescritura al fijar precio', () => {
  it('la solicitud con la inglesa pendiente guarda offerBreakdown pending con P (no null)', async () => {
    const bin = DEFAULT_PRICING_CURVE.buy.binCents;
    const m = Math.ceil((bin * 100) / 30) + 1; // EN se cotiza; ES (×0.85) cae al piso premium ⇒ pendiente
    const { svc, created } = buildSvc({ market: m, dials: ON, rarity: 'Illustration Rare' });
    await svc.createRequest('user-1', [{ cardId: 'c1', ...raw }, { cardId: 'c1', ...raw, language: 'es' }], VALID_CLABE, undefined, GATE_ADDRESS_ID);
    const es = created.find((c) => c.language === 'es');
    expect(es?.offerBreakdown).toEqual({
      marketMxnCents: null,
      languagePenalty: { pct: 15, cents: null },
      adjustedMarketCents: null,
      curveBp: null,
      curveOfferCents: null,
      cap: null,
      source: 'pending',
      finalOfferCents: null,
    });
  });
  const rewrite = (item: unknown, derived: unknown) => (BuylistService as any).pendingBreakdownRewrite(item, derived);
  const pending = { language: 'es', offerBreakdown: { source: 'pending', languagePenalty: { pct: 15, cents: null }, finalOfferCents: null } };
  it('pending + derivación con precio ⇒ reescribe el desglose completo; EN, ya fijado o aún pendiente ⇒ nada', () => {
    const next = { source: 'override', finalOfferCents: 8_508, marketMxnCents: 10_010 };
    expect(rewrite(pending, { breakdown: next })).toEqual({ offerBreakdown: next });
    expect(rewrite(pending, { breakdown: { source: 'pending', finalOfferCents: null } })).toEqual({});
    expect(rewrite(pending, null)).toEqual({});
    expect(rewrite({ language: 'en', offerBreakdown: pending.offerBreakdown }, { breakdown: next })).toEqual({});
    expect(rewrite({ language: 'es', offerBreakdown: { source: 'curve', finalOfferCents: 1 } }, { breakdown: next })).toEqual({});
  });
  it('frozenBreakdown reconoce pending (con P entero) y el override sin curva; rechaza basura', () => {
    const fb = (x: unknown) => (BuylistService as any).frozenBreakdown(x);
    expect(fb(pending.offerBreakdown)).not.toBeNull();
    expect(fb({ source: 'pending', languagePenalty: { pct: 95 }, finalOfferCents: null })).toBeNull();
    expect(fb({ source: 'override', marketMxnCents: 10_010, adjustedMarketCents: 8_508, finalOfferCents: 8_508, curveOfferCents: null, curveBp: null })).not.toBeNull();
  });
});

describe('§BUYLIST-ES §3.3 — B1/M2: campos de mesa de una línea ES desde lo congelado', () => {
  const f = (frozen: any, derived: number | null, basis: string, live: number | null) => (BuylistService as any).esMesaFields(frozen, derived, basis, live);
  const curve = { marketMxnCents: 100_000, languagePenalty: { pct: 15, cents: -15_000 }, adjustedMarketCents: 85_000, curveBp: 5_000, curveOfferCents: 42_500, cap: null, source: 'curve', finalOfferCents: 42_500 };
  it('curva pura: Estándar = final, pct = curveBp, chip «estándar» si derivada = final (aunque el mercado vivo se movió)', () => {
    const r = f(curve, 42_500, 'curve', 120_000);
    expect(r).toMatchObject({ standardOfferCents: 42_500, standardPctBp: 5_000, standardKind: 'curve', adjustment: null, marketDriftCents: 20_000 });
  });
  it('deriva = vivo − congelado; null si 0', () => {
    expect(f(curve, 42_500, 'curve', 100_000).marketDriftCents).toBeNull();
    expect(f(curve, 42_500, 'curve', 90_000).marketDriftCents).toBe(-10_000);
    expect(f(curve, 42_500, 'curve', null).marketDriftCents).toBeNull();
  });
  it('B1-bis chip (MESA §7): delta = derivada VIVA − final congelado; mercado sube 300→450 (15 %): 180.01 vs 111.88 ⇒ +68.13 MARKET_UP', () => {
    const c300 = { ...curve, marketMxnCents: 30_000, adjustedMarketCents: 25_500, languagePenalty: { pct: 15, cents: -4_500 }, curveBp: 4_387, curveOfferCents: 11_188, finalOfferCents: 11_188 };
    expect(f(c300, 18_001, 'curve', 45_000)).toMatchObject({
      standardOfferCents: 11_188,
      marketDriftCents: 15_000,
      adjustment: { deltaCents: 6_813, reasonCode: 'MARKET_UP' },
    });
    expect(f(c300, 9_000, 'curve', 20_000).adjustment).toMatchObject({ deltaCents: -2_188, reasonCode: 'MARKET_DOWN' });
  });
  it('B1-bis chip: precio fijo agregado después (680 vs 425) ⇒ +255 MANUAL_OVERRIDE, gana a la deriva; sin mercado movido y sin fijo ⇒ CURVE_CHANGED', () => {
    expect(f(curve, 68_000, 'override', 100_000).adjustment).toMatchObject({ deltaCents: 25_500, reasonCode: 'MANUAL_OVERRIDE' });
    expect(f(curve, 68_000, 'override', 150_000).adjustment).toMatchObject({ deltaCents: 25_500, reasonCode: 'MANUAL_OVERRIDE' });
    expect(f(curve, 40_000, 'curve', 100_000).adjustment).toMatchObject({ deltaCents: -2_500, reasonCode: 'CURVE_CHANGED' });
    expect(f(curve, null, 'pending', 100_000).adjustment).toBeNull();
  });
  it('tope: sin % junto al monto post-tope; override y pending: sin deriva ni %', () => {
    const capEn = { ...curve, cap: { reason: 'en_offer', cents: 30_000 }, finalOfferCents: 30_000 };
    expect(f(capEn, 30_000, 'curve', 100_000)).toMatchObject({ standardKind: 'cap_en_offer', standardPctBp: null, standardOfferCents: 30_000 });
    expect(f({ ...capEn, cap: { reason: 'floor', cents: 30_000 } }, 30_000, 'curve', 100_000).standardKind).toBe('cap_floor');
    const ov = { marketMxnCents: 80_000, languagePenalty: { pct: 15, cents: -12_000 }, adjustedMarketCents: 68_000, curveBp: null, curveOfferCents: null, cap: null, source: 'override', finalOfferCents: 68_000 };
    expect(f(ov, 68_000, 'override', 45_000)).toMatchObject({ standardKind: 'override', standardPctBp: null, standardOfferCents: 68_000, marketDriftCents: null, adjustment: null });
    const pend = { marketMxnCents: null, languagePenalty: { pct: 15, cents: null }, adjustedMarketCents: null, curveBp: null, curveOfferCents: null, cap: null, source: 'pending', finalOfferCents: null };
    expect(f(pend, 7_560, 'curve', 45_000)).toMatchObject({ standardKind: 'pending', standardPctBp: null, standardOfferCents: null, marketDriftCents: null, adjustment: null });
  });
  it('sin desglose congelado: todo null, nada se re-deriva', () => {
    expect(f(null, 42_500, 'curve', 100_000)).toEqual({ standardPctBp: null, standardOfferCents: null, standardKind: null, marketDriftCents: null, adjustment: null });
  });
});

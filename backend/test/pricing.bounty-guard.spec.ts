import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { composeVariantPricing } from '../src/modules/pricing/variant-pricing';
import { deriveBountyState } from '../src/modules/pricing/bounty-state';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { buildGradeKey, tryBuildGradeKey } from '../src/modules/pricing/pricing.types';
import { DEFAULT_PRICING_CURVE, resolveBuyFromCurve } from '../src/common/pricing-curve';
import { bountyGuardBasis, quoteAcquisitionWithGuard, VariantPriceControls } from '../src/common/money';
import { variantKey } from '../src/common/variant-key';
import { stripComments } from './helpers/strip-comments';
import { callArgCounts, countIdentUses, identCensus, methodBody, topLevelBody } from './helpers/ident-census';
import { DEFAULT_SALE_PREMIUM_FLOOR_POLICY } from '../src/common/pricing-curve';
// v1.80.8.5 (`M2-PF`): el composer exige la política de VENTA; aquí, el seed del dial (sin fila).
const SALE_SEED = DEFAULT_SALE_PREMIUM_FLOOR_POLICY;

/**
 * v1.80.2 — EL TOPE DEL BOUNTY NO SE SALTA EL GUARDARRAÍL PREMIUM (API_CONTRACT §M2-B.11 punto 8,
 * ancla `M2-B11-8`; ARCHITECTURE §4.36.5(a) y §4.36.6e).
 *
 * Pruebas BG-1…BG-5 del contrato (unidad, seam de compra) y la versión sin infra de BG-6/BG-7
 * (vitrina y consola). La versión con Postgres real por HTTP vive en
 * `test/integration/bounty-guard.e2e-spec.ts`.
 *
 * ⚠️ ANTI-VACUIDAD (exigido por el contrato): cada prueba afirma como PRECONDICIÓN qué resolvió la
 * CURVA (`floor` o `market`) con el mismo resolvedor que corre en producción. Sin esa precondición,
 * un cambio de la curva por defecto podría dejar la prueba pasando sin ejercitar la esquina.
 */

const CURVE = DEFAULT_PRICING_CURVE; // bin MX$1 (100): mercado 100 ⇒ bin; mercado 100000 ⇒ 50 %
const CHASE = 'Special Illustration Rare'; // premium en el catálogo canónico
const BULK = 'Common'; // NO premium

const bounty = (cents: number): VariantPriceControls => ({ bountyEnabled: true, bountyPriceCents: cents });
const curveBasis = (m: number | null) => resolveBuyFromCurve(m, CURVE).basis;

/** Seam de COMPRA real (`decideBuyLine` vía `publicQuote`) con la BD mockeada. Mismo patrón que E4. */
function buylistFor(rarity: string, referenceMxnCents: number | null, override?: Record<string, unknown>) {
  const prisma = {
    card: {
      findUnique: jest.fn(async () => ({ id: 'c1', rarity, rarityCanonical: rarity, availableFinishes: ['normal'] })),
    },
  } as unknown as PrismaService;
  const pricing = {
    loadPricingCurve: jest.fn(async () => CURVE),
    gradeKeyFor: jest.fn(() => 'raw:NM'),
    tryGradeKeyFor: jest.fn(() => 'raw:NM'),
    getReference: jest.fn(async () =>
      referenceMxnCents == null ? { status: 'pending' } : { status: 'priced', referenceMxnCents },
    ),
    getVariantOverride: jest.fn(async () => override ?? null),
    escalatePending: jest.fn(),
    settlePendingForVariant: jest.fn(async () => undefined),
  } as unknown as PricingService;
  const settings = { getRaw: jest.fn(), getNumber: jest.fn(async () => 0) } as unknown as SettingsService;
  return new BuylistService(prisma, pricing, settings, {} as UsersService, new PiiCryptoService(new ConfigService({})));
}

async function quote(rarity: string, market: number | null, b: number) {
  return buylistFor(rarity, market, { bountyEnabled: true, bountyPriceCents: b }).publicQuote('c1', 'raw', 'NM', 'normal');
}

describe('bountyGuardBasis — la regla pura (§M2-B.11 punto 8)', () => {
  it('topado (pago < bounty) ⇒ el basis de la CURVA', () => {
    expect(bountyGuardBasis(900000, 100, 'floor')).toBe('floor');
    expect(bountyGuardBasis(120000, 100000, 'market')).toBe('market');
  });
  it('sin tope (bounty < mercado) o EMPATE ⇒ `bounty` (la exención de §4.36.5 sigue)', () => {
    expect(bountyGuardBasis(250, 300, 'floor')).toBe('bounty');
    expect(bountyGuardBasis(300, 300, 'floor')).toBe('bounty');
  });
  it('sin mercado / mercado degenerado (H-1) ⇒ `bounty`, sin mirar la curva', () => {
    expect(bountyGuardBasis(900000, null, 'pending')).toBe('bounty');
    expect(bountyGuardBasis(900000, 0, 'pending')).toBe('bounty');
    expect(bountyGuardBasis(900000, -1, 'floor')).toBe('bounty');
  });
  it('no recibe rareza: criterio 84 hecho tipo (la firma tiene exactamente 3 parámetros)', () => {
    expect(bountyGuardBasis.length).toBe(3);
  });
});

describe('BG-1 — el caso de backend: chase, mercado MX$1, bounty MX$9,000 ⇒ precio_pendiente', () => {
  it('precondición (BC-5 intacta): el monto sigue topado y `basis` sigue `bounty`; `guardBasis` = floor', () => {
    expect(curveBasis(100)).toBe('floor');
    expect(quoteAcquisitionWithGuard(100, CURVE, bounty(900000))).toMatchObject({
      priceCents: 100,
      basis: 'bounty',
      guardBasis: 'floor',
      marketMxnCents: 100,
    });
  });
  it('POST /buylist/quote (seam): `precio_pendiente`, `quotedPriceCents = null`, basis `pending`', async () => {
    const q = await quote(CHASE, 100, 900000);
    expect(q.quote.status).toBe('precio_pendiente');
    expect(q.quote.quotedPriceCents).toBeNull();
    expect(q.priceBasis).toBe('pending');
  });
});

describe('BG-2 — sin premium no se retiene', () => {
  it('mismos números, rareza NO premium ⇒ cotiza 100 `bounty`', async () => {
    expect(curveBasis(100)).toBe('floor');
    const q = await quote(BULK, 100, 900000);
    expect(q.quote.quotedPriceCents).toBe(100);
    expect(q.priceBasis).toBe('bounty');
  });
});

describe('BG-3 — sin tope no se retiene', () => {
  it('premium, curva floor, mercado 300 / bounty 250 ⇒ 250 `bounty`', async () => {
    expect(curveBasis(300)).toBe('floor');
    expect(quoteAcquisitionWithGuard(300, CURVE, bounty(250))).toMatchObject({ basis: 'bounty', guardBasis: 'bounty' });
    const q = await quote(CHASE, 300, 250);
    expect(q.quote.quotedPriceCents).toBe(250);
    expect(q.priceBasis).toBe('bounty');
  });
  it('EMPATE mercado 300 = bounty 300 ⇒ 300 `bounty` (el `<` es estricto)', async () => {
    expect(curveBasis(300)).toBe('floor');
    const q = await quote(CHASE, 300, 300);
    expect(q.quote.quotedPriceCents).toBe(300);
    expect(q.priceBasis).toBe('bounty');
  });
});

describe('BG-4 — tope con mercado SANO no se retiene', () => {
  it('premium, mercado 100000 (curva `market`), bounty 120000 ⇒ 100000 `bounty`', async () => {
    expect(curveBasis(100000)).toBe('market');
    expect(quoteAcquisitionWithGuard(100000, CURVE, bounty(120000))).toMatchObject({
      priceCents: 100000,
      basis: 'bounty',
      guardBasis: 'market',
    });
    const q = await quote(CHASE, 100000, 120000);
    expect(q.quote.quotedPriceCents).toBe(100000);
    expect(q.priceBasis).toBe('bounty');
  });
});

describe('BG-5 — sin mercado no se retiene', () => {
  it('premium, mercado `null` ⇒ 900000 `bounty`', async () => {
    expect(curveBasis(null)).toBe('pending');
    const q = await quote(CHASE, null, 900000);
    expect(q.quote.quotedPriceCents).toBe(900000);
    expect(q.priceBasis).toBe('bounty');
  });
  it('premium, mercado `0` (H-1: ausente) ⇒ 900000 `bounty`', async () => {
    expect(curveBasis(0)).toBe('pending');
    const q = await quote(CHASE, 0, 900000);
    expect(q.quote.quotedPriceCents).toBe(900000);
    expect(q.priceBasis).toBe('bounty');
  });
});

describe('guardBasis en los peldaños 2–4 = el basis de siempre', () => {
  it('override ⇒ `override`; curva ⇒ su basis; pendiente ⇒ `pending`; bounty NO efectivo ⇒ la curva', () => {
    expect(quoteAcquisitionWithGuard(100, CURVE, { buyOverrideCents: 50 })).toMatchObject({ basis: 'override', guardBasis: 'override' });
    expect(quoteAcquisitionWithGuard(100, CURVE)).toMatchObject({ basis: 'floor', guardBasis: 'floor' });
    expect(quoteAcquisitionWithGuard(null, CURVE)).toMatchObject({ basis: 'pending', guardBasis: 'pending' });
    // bounty 50 < curva 100 y < mercado 300 ⇒ rebasado ⇒ peldaño 3
    expect(quoteAcquisitionWithGuard(300, CURVE, bounty(50))).toMatchObject({ basis: 'floor', guardBasis: 'floor' });
  });
});

// ---------------------------------------------------------------------------------------------
// Consola / binder (sin infra) — los cinco valores del punto 8 y `state` intacto.
// ---------------------------------------------------------------------------------------------

function m30(over: Record<string, unknown> = {}): any {
  return {
    id: 'vpo-1',
    cardId: 'c1',
    productType: 'raw',
    gradeKey: 'raw:NM',
    finish: 'normal',
    sellOverrideCents: null,
    buyOverrideCents: null,
    bountyEnabled: true,
    bountyPriceCents: 900000,
    bountyTargetQty: 2,
    bountyAcquiredQty: 0,
    bountyCompletedAt: null,
    bountyUnpublishedAt: null,
    updatedBy: 'admin-1',
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...over,
  };
}
const priced = (cents: number) => ({ status: 'priced', referenceMxnCents: cents }) as any;

describe('BG-6 (consola, sin infra) — fila retenida', () => {
  it('chase topada contra el bin ⇒ source pending, effective null, premiumAtFloor, payout null, capped false, state activa', () => {
    expect(curveBasis(100)).toBe('floor');
    const dto = composeVariantPricing(priced(100), CURVE, m30(), CHASE, SALE_SEED);
    expect(dto.buy).toMatchObject({ source: 'pending', effectiveCents: null, premiumAtFloor: true });
    expect(dto.bounty).toMatchObject({ effective: true, payoutCents: null, cappedByMarket: false });
    expect(deriveBountyState(dto.bounty!, null)).toBe('activa');
  });
  it('canario de no-vaciar: la MISMA fila no premium sigue pagando 100 topado', () => {
    const dto = composeVariantPricing(priced(100), CURVE, m30(), BULK, SALE_SEED);
    expect(dto.buy).toMatchObject({ source: 'bounty', effectiveCents: 100, premiumAtFloor: false });
    expect(dto.bounty).toMatchObject({ payoutCents: 100, cappedByMarket: true });
  });
});

// ---------------------------------------------------------------------------------------------
// Vitrina (sin infra) — filtra retenidas DESPUÉS de calcular el pago y ANTES de ordenar/cortar.
// ---------------------------------------------------------------------------------------------

function vitrinaOf(rows: any[], markets: Record<string, number>) {
  return new BuylistService(
    { variantPriceOverride: { findMany: jest.fn(async () => rows) } } as unknown as PrismaService,
    {
      gradeKeyFor: (i: any) => buildGradeKey(i),
      tryGradeKeyFor: (i: any) => tryBuildGradeKey(i),
      loadPricingCurve: jest.fn(async () => CURVE),
      getReferencesBatch: jest.fn(async (keys: any[]) => {
        const m = new Map<string, any>();
        for (const k of keys) if (markets[k.cardId] != null) m.set(variantKey(k), priced(markets[k.cardId]));
        return m;
      }),
    } as unknown as PricingService,
    { getNumber: jest.fn(async () => 100_000_000) } as unknown as SettingsService,
    {} as UsersService,
    new PiiCryptoService(new ConfigService({})),
  );
}
const showcaseRow = (cardId: string, bountyPriceCents: number, rarity: string) => ({
  ...m30({ id: `vpo-${cardId}`, cardId, bountyPriceCents }),
  card: { name: `Carta ${cardId}`, number: '1', rarity, rarityCanonical: rarity, imageSmallUrl: null, set: { name: 'Set' } },
});

describe('BG-6 (vitrina, sin infra)', () => {
  it('la retenida AUSENTE y la sana PRESENTE', async () => {
    expect(curveBasis(100)).toBe('floor');
    const svc = vitrinaOf([showcaseRow('ret', 900000, CHASE), showcaseRow('sana', 120000, CHASE)], {
      ret: 100,
      sana: 100000,
    });
    const { data } = await svc.publicBounties();
    expect(data.map((d) => [d.cardId, d.bountyPriceCents])).toEqual([['sana', 100000]]);
  });

  it('el filtro va ANTES del corte a 50: 50 sanas que pagan 50 + 1 retenida que pagaría 100 ⇒ las 50 sanas', async () => {
    // Sana: mercado 50, bounty 60 ⇒ efectiva (≥ mercado, Q1), paga 50, rareza no premium.
    expect(curveBasis(50)).toBe('floor');
    const rows = [showcaseRow('ret', 900000, CHASE)];
    const markets: Record<string, number> = { ret: 100 };
    for (let i = 0; i < 50; i++) {
      rows.push(showcaseRow(`s${i}`, 60, BULK));
      markets[`s${i}`] = 50;
    }
    const { data } = await vitrinaOf(rows, markets).publicBounties();
    expect(data).toHaveLength(50);
    expect(data.some((d) => d.cardId === 'ret')).toBe(false);
  });

  it('sin tope la chase premium con curva en el bin SÍ se publica (exención vigente)', async () => {
    expect(curveBasis(300)).toBe('floor');
    const { data } = await vitrinaOf([showcaseRow('c', 250, CHASE)], { c: 300 }).publicBounties();
    expect(data.map((d) => d.bountyPriceCents)).toEqual([250]);
  });
});

// ---------------------------------------------------------------------------------------------
// Candado de forma: ningún llamador de COMPRA puede obtener el monto con controles sin `guardBasis`.
//
// ⭐ v1.80.2.2 (D-2 del techlead, 2026-09-29): convertido al patrón VK-6 — censo CERRADO de quién
// toca `quoteAcquisitionFromCurve` en CÓDIGO (comentarios fuera, imports contados; instrumento
// compartido `helpers/ident-census.ts`, el mismo que BC-9(b) en `money.bounty-cap.spec.ts`), más la
// aserción de que fuera de `money.ts` ninguna llamada lleva TERCER argumento (controles). Antes era un
// escaneo léxico del árbol entero que solo miraba el nº de argumentos: un llamador nuevo de DOS
// argumentos no lo ponía rojo; ahora sí, hasta que se añada con su razón.
// ---------------------------------------------------------------------------------------------

const SRC_ROOT = path.resolve(__dirname, '..', 'src');
const FROM_CURVE_IDENT = /\bquoteAcquisitionFromCurve\b/g;

/** LA LISTA CERRADA: nº de apariciones en código + por qué puede llamar a la versión SIN guardBasis. */
const FROM_CURVE_ALLOWED: Record<string, { n: number; why: string }> = {
  'common/money.ts': {
    n: 2,
    why: 'DEFINICIÓN (el ÚNICO cuerpo de la precedencia de compra) + la llamada interna de `quoteAcquisitionWithGuard`.',
  },
  'modules/pricing/variant-controls.service.ts': {
    n: 2,
    why:
      'Import + el gate `422 BOUNTY_BELOW_RULE` del alta (Q1): llamada de DOS argumentos (sin controles) para ' +
      'obtener `curveQuoteCents`/`marketMxnCents`; ahí el bounty no puede ganar y `guardBasis` sería `= basis`.',
  },
};

describe('candado — los llamadores de COMPRA con controles pasan por `quoteAcquisitionWithGuard`', () => {
  const read = (rel: string) => stripComments(fs.readFileSync(path.join(SRC_ROOT, rel), 'utf8'));

  it('censo CERRADO de `quoteAcquisitionFromCurve` en código (un llamador nuevo ⇒ rojo hasta que traiga su razón)', () => {
    const expected = Object.fromEntries(Object.entries(FROM_CURVE_ALLOWED).map(([f, { n }]) => [f, n]));
    expect(identCensus(SRC_ROOT, FROM_CURVE_IDENT)).toEqual(expected);
    for (const [f, { why }] of Object.entries(FROM_CURVE_ALLOWED)) {
      expect({ f, len: why.trim().length > 20 }).toEqual({ f, len: true });
    }
  });

  it('fuera de money.ts, NINGUNA llamada a `quoteAcquisitionFromCurve` lleva tercer argumento (controles)', () => {
    for (const f of Object.keys(FROM_CURVE_ALLOWED).filter((x) => x !== 'common/money.ts')) {
      const counts = callArgCounts(read(f), 'quoteAcquisitionFromCurve');
      expect({ f, calls: counts.length > 0, max: Math.max(...counts) }).toEqual({ f, calls: true, max: 2 });
    }
  });

  /**
   * ⭐ v1.80.2.2 — INVERTIDA (errata D-3): antes afirmaba que `buylist.service.ts` contiene
   * `bountyGuardBasis(` (la vitrina re-montaba el veredicto a mano). Ahora el cuerpo de `publicBounties`
   * contiene `quoteAcquisitionWithGuard(` y NO `bountyGuardBasis(`; el composer, igual.
   */
  it('los llamadores conocidos usan la versión con guardBasis: `publicBounties` y `composeVariantPricing`', () => {
    const publicBody = methodBody(read('modules/buylist/buylist.service.ts'), 'async publicBounties(');
    expect(publicBody).toMatch(/\bquoteAcquisitionWithGuard\(/);
    expect(publicBody).not.toMatch(/\bbountyGuardBasis\(/);
    const composer = topLevelBody(read('modules/pricing/variant-pricing.ts'), 'export function composeVariantPricing(');
    expect(composer).toMatch(/\bquoteAcquisitionWithGuard\(/);
    expect(composer).not.toMatch(/\bbountyGuardBasis\(/);
  });

  it('🐤 canario: una llamada con controles SÍ se detecta; una de dos argumentos no; en un comentario, nada', () => {
    expect(callArgCounts('quoteAcquisitionFromCurve(m, curve, override)', 'quoteAcquisitionFromCurve')).toEqual([3]);
    expect(callArgCounts('quoteAcquisitionFromCurve(m, f(a, b))', 'quoteAcquisitionFromCurve')).toEqual([2]);
    expect(countIdentUses('// quoteAcquisitionFromCurve(m, curve, o)\n/* quoteAcquisitionFromCurve */', FROM_CURVE_IDENT)).toBe(0);
    // Un import también cuenta (primer síntoma de un llamador nuevo).
    expect(countIdentUses("import { quoteAcquisitionFromCurve } from '../../common/money';", FROM_CURVE_IDENT)).toBe(1);
    // …y una inyección en un fichero que NO está en la lista pondría el censo rojo.
    const vault = read('modules/vault/vault.service.ts');
    expect(countIdentUses(vault, FROM_CURVE_IDENT)).toBe(0);
    expect(countIdentUses(`${vault}\nconst __c = quoteAcquisitionFromCurve(1, curve);`, FROM_CURVE_IDENT)).toBe(1);
  });
});

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { SealedCatalogService } from '../src/modules/catalog/sealed-catalog.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { DEFAULT_PRICING_CURVE, DEFAULT_SALE_PREMIUM_FLOOR_POLICY } from '../src/common/pricing-curve';
import { DISABLED_GRADED_ESTIMATE_CONFIG } from '../src/common/graded-estimate';
import * as money from '../src/common/money';
import { computeSealedSalePrice, displayPriceCentsOf } from '../src/common/money';
import type { IvaDials } from '../src/common/money';
import { stripComments } from './helpers/strip-comments';
import { onWire } from './helpers/dto-keys';

/**
 * §MIV (API_CONTRACT v1.90⟨miv⟩, ARCHITECTURE §4.MIV, BACKEND_NOTES §88) — **el valor de mercado CON IVA en la tienda.**
 *
 * Palabras del dueño (`HECHOS.md:160`, 2026-10-10): mercado MX$1,000 → mostrar **MX$1,160** junto a su precio
 * **MX$1,334**. Solo presentación: `referenceValue` sigue NETO, ningún importe cambia (criterio 866).
 *
 * Pruebas MIV-B1…B10 del contrato (§MIV.7). MIV-B11 es «por ausencia»: el resto de la suite de dinero verde sin
 * editar ninguna aserción existente.
 */

// `marketDisplayCentsOf` se lee por índice para que este fichero COMPILE contra el árbol sin §MIV y el rojo de B1 sea
// «la función no existe» (lo que dice el contrato), no un error de compilación que tumbe las once pruebas a la vez.
const marketDisplayCentsOf = (m: number, r: number): number => {
  const fn = (money as Record<string, unknown>).marketDisplayCentsOf;
  if (typeof fn !== 'function') throw new Error('marketDisplayCentsOf no existe en common/money.ts');
  return (fn as (m: number, r: number) => number)(m, r);
};

const NEUTRAL: IvaDials = { ivaTransferPct: 100, ivaRatePct: 16 };

// ------------------------------------------------------------------------------------------------ fixtures de carta
const CARD = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  externalId: 'sv8-1',
  name: 'Pikachu',
  number: '1',
  numberSort: 1,
  numberPrefix: '',
  rarity: 'Illustration Rare',
  rarityCanonical: 'illustration_rare',
  supertype: 'Pokémon',
  subtypes: [],
  setId: 's1',
  imageSmallUrl: null,
  imageLargeUrl: null,
  availableFinishes: ['normal'],
  set: { id: 's1', name: 'Surging Sparks', releaseDate: '2024/11/08' },
  ...over,
});

const ITEM = (over: Record<string, unknown> = {}) => ({
  id: 'i1',
  cardId: 'c1',
  productType: 'raw',
  rawCondition: 'NM',
  sealedSubtype: null,
  sealedCondition: null,
  sealedProductName: null,
  sealedImageUrl: null,
  gradingCompany: null,
  gradeValue: null,
  certNumber: null,
  status: 'listed',
  finish: 'normal',
  ownerType: 'platform',
  folio: 'INV-000001',
  listPriceCents: null,
  tcgplayerProductId: null,
  createdAt: new Date('2026-08-01'),
  card: CARD(),
  ...over,
});

/** Mercado MX$1,000 — el ejemplo del dueño. */
const MARKET = 100000;

type Ref = { status: 'priced'; referenceMxnCents: number } | { status: 'pending' };

function pricingMock(ref: Ref = { status: 'priced', referenceMxnCents: MARKET }) {
  return {
    loadSalePremiumFloorPolicy: jest.fn(async () => DEFAULT_SALE_PREMIUM_FLOOR_POLICY),
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    loadGradedEstimateConfig: jest.fn(async () => DISABLED_GRADED_ESTIMATE_CONFIG),
    getGradedEstimatesBatch: jest.fn(async () => new Map()),
    getPublishedSlabGradesBatch: jest.fn(async () => new Map()),
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    computeSalePriceForItem: jest.fn(PricingService.prototype.computeSalePriceForItem),
    gradeKeyFor: jest.fn((i: { productType: string; rawCondition?: string }) =>
      i.productType === 'raw' ? `raw:${i.rawCondition ?? 'NM'}` : 'graded:PSA:10',
    ),
    tryGradeKeyFor: jest.fn((i: { productType: string; rawCondition?: string }) =>
      i.productType === 'raw' ? `raw:${i.rawCondition ?? 'NM'}` : 'graded:PSA:10',
    ),
    getReference: jest.fn(async () => ref),
    getReferencesBatch: jest.fn(async (items: Array<Record<string, unknown>>) => {
      const m = new Map<string, unknown>();
      for (const it of items) m.set(`${it.cardId}|${it.productType}|${it.gradeKey}|${it.finish}`, ref);
      return m;
    }),
    getPricedRawFinishesBatch: jest.fn(async () => new Map()),
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    getVariantOverride: jest.fn(async () => null),
    getSeparateProductsByCard: jest.fn(async () => new Map()),
    gateSealedMarketCents: (r: { status?: string; referenceMxnCents?: number } | undefined, on: boolean) =>
      on && r?.status === 'priced' ? (r.referenceMxnCents ?? null) : null,
    getSealedMarketRef: jest.fn(async () => ({ status: 'pending' })),
    loadSealedSpreads: jest.fn(async () => ({ spreadPctBySubtype: { box: 18 }, fallbackPct: 25, sourceOn: true })),
    sealedMarketGradeKeyForItem: jest.fn((i: { tcgplayerProductId: number | null }) =>
      i.tcgplayerProductId != null ? `sealed:tcg:${i.tcgplayerProductId}` : null,
    ),
    resolveSealedSalePrice: (
      item: { listPriceCents: number | null; sealedSubtype: string | null },
      r: { status?: string; referenceMxnCents?: number } | undefined,
      ctx: { sourceOn: boolean; spreadPctBySubtype: Record<string, number>; fallbackPct: number },
    ) =>
      computeSealedSalePrice(
        item.listPriceCents,
        item.sealedSubtype as never,
        ctx.sourceOn && r?.status === 'priced' ? (r.referenceMxnCents ?? null) : null,
        ctx.spreadPctBySubtype,
        ctx.fallbackPct,
      ),
  } as unknown as PricingService;
}

/** Doble de `SettingsService` cuyos diales se leen de `box.dials` EN CADA LLAMADA (B5 los cambia entre lecturas). */
function dialsBox(initial: IvaDials = NEUTRAL) {
  const box = { dials: initial };
  const getIvaDials = jest.fn(async () => box.dials);
  return { box, getIvaDials };
}

function cardService(items: Array<Record<string, unknown>>, opts: { ref?: Ref; dials?: ReturnType<typeof dialsBox> } = {}) {
  const prisma = {
    inventoryItem: { findMany: jest.fn(async () => items), count: jest.fn(async () => items.length) },
    card: { findUnique: jest.fn(async () => CARD()) },
  } as unknown as PrismaService;
  const d = opts.dials ?? dialsBox();
  return new CatalogService(prisma, pricingMock(opts.ref), { getIvaDials: d.getIvaDials } as never);
}

// ------------------------------------------------------------------------------------------------ fixtures de sellado
const SEALED = (over: Record<string, unknown> = {}) =>
  ITEM({
    id: 's1',
    productType: 'sealed',
    rawCondition: null,
    sealedSubtype: 'box',
    sealedCondition: 'mint',
    sealedProductName: 'Surging Sparks Booster Box',
    tcgplayerProductId: 555,
    listPriceCents: null,
    sealedProduct: null,
    ...over,
  });

function sealedService(
  items: Array<Record<string, unknown>>,
  opts: {
    ref?: Ref;
    dials?: ReturnType<typeof dialsBox>;
    trend?: 'on' | 'off';
    history?: Array<{ capturedDate: Date; priceMxnCents: number }>;
  } = {},
) {
  const prisma = {
    inventoryItem: {
      findMany: jest.fn(async () => items),
      count: jest.fn(async () => items.length),
      findFirst: jest.fn(async () => items[0] ?? null),
    },
    sealedProduct: { findMany: jest.fn(async () => []) },
    priceReference: { findMany: jest.fn(async () => opts.history ?? []) },
  } as unknown as PrismaService;
  const d = opts.dials ?? dialsBox();
  const settings = {
    getBool: jest.fn(async () => false),
    getNumber: jest.fn(async () => 0),
    getString: jest.fn(async (key: string) => (key === 'sealed_value_trend' ? (opts.trend ?? 'off') : 'off')),
    getIvaDials: d.getIvaDials,
  } as unknown as SettingsService;
  const pricing = pricingMock(opts.ref ?? { status: 'priced', referenceMxnCents: 200000 });
  const catalog = new CatalogService(prisma, pricing, { getIvaDials: d.getIvaDials } as never);
  return { svc: new SealedCatalogService(prisma, pricing, settings, catalog), dials: d, prisma };
}

// ================================================================================================ MIV-B1
describe('MIV-B1 — `marketDisplayCentsOf(M, r)` = M + round(M·r/100) (common/money.ts)', () => {
  it.each([
    [100000, 16, 116000],
    [12345, 16, 14320],
    [4, 16, 5],
    [3, 16, 3],
    [0, 16, 0],
    [100000, 8, 108000],
    [100000, 0, 100000],
  ])('(%i, %i) → %i', (m, r, esperado) => {
    expect(marketDisplayCentsOf(m, r)).toBe(esperado);
  });

  it('es la MISMA cifra que `displayPriceCentsOf(M, 100, r)` para todo M ∈ [0, 20000], r ∈ {0,1,8,10,16,100}', () => {
    const fallos: string[] = [];
    for (const r of [0, 1, 8, 10, 16, 100]) {
      for (let m = 0; m <= 20000; m++) {
        const a = marketDisplayCentsOf(m, r);
        const b = displayPriceCentsOf(m, 100, r);
        if (a !== b) fallos.push(`(${m},${r}) ${a}≠${b}`);
      }
    }
    expect(fallos.slice(0, 5)).toEqual([]);
  });

  it('la firma recibe la TASA (dos números), ⛔ no `IvaDials` (P-MIV-5 sostenida por la firma)', () => {
    expect((money as Record<string, unknown>).marketDisplayCentsOf).toEqual(expect.any(Function));
    expect(((money as Record<string, unknown>).marketDisplayCentsOf as (...a: unknown[]) => unknown).length).toBe(2);
  });
});

// ================================================================================================ MIV-B2
describe('MIV-B2 — ficha de carta, mercado MX$1,000 con basis `market`', () => {
  it('`referenceDisplayCents` 116000, `referenceValue` NETO 100000 y `displayPriceCents` 133400 (igual que antes)', async () => {
    const { listings } = await cardService([ITEM()]).getCard('c1');
    const g = onWire(listings[0]) as Record<string, any>;
    expect(g.priceBasis).toBe('market');
    expect(g.referenceDisplayCents).toBe(116000);
    expect(g.referenceValue.referenceMxnCents).toBe(100000);
    expect(g.displayPriceCents).toBe(133400);
  });

  it('la tasa es la del dial de la petición, ⛔ no un 16 fijo: `iva_pct` 8 ⇒ 108000', async () => {
    const dials = dialsBox({ ivaTransferPct: 100, ivaRatePct: 8 });
    const { listings } = await cardService([ITEM()], { dials }).getCard('c1');
    expect(onWire(listings[0]).referenceDisplayCents).toBe(108000);
    expect(onWire(listings[0]).ivaRatePct).toBe(8);
  });
});

// ================================================================================================ MIV-B3
describe('MIV-B3 — `iff` en el JSON: la clave viaja ⇔ `priceBasis === "market"` (carta y sellado)', () => {
  it('carta `market` ⇒ CON la clave', async () => {
    const { listings } = await cardService([ITEM()]).getCard('c1');
    expect(onWire(listings[0])).toHaveProperty('referenceDisplayCents');
  });

  it('carta `override` (pieza con precio a mano) y referencia `priced` ⇒ SIN la clave (ni null, ni 0)', async () => {
    const { listings } = await cardService([ITEM({ listPriceCents: 1000 })]).getCard('c1');
    const g = onWire(listings[0]);
    expect(g.priceBasis).toBe('override');
    expect(g).not.toHaveProperty('referenceDisplayCents');
    expect(g.referenceValue).not.toHaveProperty('referenceMxnCents');
  });

  it('carta `override` con referencia `pending` ⇒ SIN la clave', async () => {
    const { listings } = await cardService([ITEM({ listPriceCents: 1000 })], { ref: { status: 'pending' } }).getCard('c1');
    expect(onWire(listings[0])).not.toHaveProperty('referenceDisplayCents');
  });

  it('carta: el grupo con override más barato manda ⇒ SIN la clave aunque otra pieza vaya por mercado', async () => {
    const { listings } = await cardService([ITEM(), ITEM({ id: 'i2', listPriceCents: 1000 })]).getCard('c1');
    expect(onWire(listings[0]).priceBasis).toBe('override');
    expect(onWire(listings[0])).not.toHaveProperty('referenceDisplayCents');
  });

  it('sellado con spread (`market`) ⇒ CON la clave', async () => {
    const { group } = await sealedService([SEALED()]).svc.sealedDetail('s1');
    expect(onWire(group)).toHaveProperty('referenceDisplayCents');
  });

  it('sellado con `listPriceCents` manual y referencia `priced` ⇒ SIN la clave (la fuga que D2 cerró)', async () => {
    const { group } = await sealedService([SEALED({ listPriceCents: 999000 })]).svc.sealedDetail('s1');
    const g = onWire(group);
    expect(g.priceBasis).toBe('override');
    expect(g).not.toHaveProperty('referenceDisplayCents');
    expect(g.referenceValue).not.toHaveProperty('referenceMxnCents');
  });

  it('sellado con `listPriceCents` manual y referencia `pending` ⇒ SIN la clave', async () => {
    const { group } = await sealedService([SEALED({ listPriceCents: 999000 })], { ref: { status: 'pending' } }).svc.sealedDetail('s1');
    expect(onWire(group)).not.toHaveProperty('referenceDisplayCents');
  });
});

// ================================================================================================ MIV-B4
describe('MIV-B4 — P-MIV-5: el mercado lleva el IVA COMPLETO, ⛔ nunca el dial de traslación', () => {
  it('diales {t: 50, r: 16}, mercado 100000 ⇒ 116000; el precio sí refleja el 50 %', async () => {
    const dials = dialsBox({ ivaTransferPct: 50, ivaRatePct: 16 });
    const { listings } = await cardService([ITEM()], { dials }).getCard('c1');
    const g = onWire(listings[0]);
    expect(g.referenceDisplayCents).toBe(116000);
    // `L` = 115000 (curva ×1.15) ⇒ `P` = 115000 + round(115000·50·16/10000) = 124200.
    expect(g.displayPriceCents).toBe(124200);
  });

  it('sellado con {t: 50, r: 16}, mercado 200000 ⇒ 232000', async () => {
    const dials = dialsBox({ ivaTransferPct: 50, ivaRatePct: 16 });
    const { group } = await sealedService([SEALED()], { dials }).svc.sealedDetail('s1');
    expect(onWire(group).referenceDisplayCents).toBe(232000);
  });
});

// ================================================================================================ MIV-B5
describe('MIV-B5 — criterio 862: cambiar `iva_pct` cambia la cifra en la siguiente lectura, sin publicar de nuevo', () => {
  it('carta: misma pieza, 16 ⇒ 116000 y luego 8 ⇒ 108000', async () => {
    const dials = dialsBox({ ivaTransferPct: 100, ivaRatePct: 16 });
    const svc = cardService([ITEM()], { dials });
    expect(onWire((await svc.getCard('c1')).listings[0]).referenceDisplayCents).toBe(116000);
    dials.box.dials = { ivaTransferPct: 100, ivaRatePct: 8 };
    expect(onWire((await svc.getCard('c1')).listings[0]).referenceDisplayCents).toBe(108000);
  });

  it('sellado: misma pieza, 16 ⇒ 232000 y luego 8 ⇒ 216000', async () => {
    const dials = dialsBox({ ivaTransferPct: 100, ivaRatePct: 16 });
    const { svc } = sealedService([SEALED()], { dials });
    expect(onWire((await svc.sealedDetail('s1')).group).referenceDisplayCents).toBe(232000);
    dials.box.dials = { ivaTransferPct: 100, ivaRatePct: 8 };
    expect(onWire((await svc.sealedDetail('s1')).group).referenceDisplayCents).toBe(216000);
  });
});

// ================================================================================================ MIV-B6
describe('MIV-B6 — ficha de sellado con spread y mercado MX$2,000', () => {
  it('`referenceDisplayCents` 232000; `referenceValue` NETO 200000; `fromPriceCents` igual que antes', async () => {
    const { group } = await sealedService([SEALED()]).svc.sealedDetail('s1');
    const g = onWire(group) as Record<string, any>;
    expect(g.priceBasis).toBe('market');
    expect(g.referenceDisplayCents).toBe(232000);
    expect(g.referenceValue.referenceMxnCents).toBe(200000);
    // box 18 % ⇒ `L` = 236000 ⇒ `P` = 236000 + round(236000·100·16/10000) = 273760.
    expect(g.fromPriceCents).toBe(273760);
  });
});

// ================================================================================================ MIV-B7
describe('MIV-B7 — tendencia de sellado: `displayValueMxnCents` y `displayAbsMxnCents`', () => {
  const serie = (values: number[]) =>
    values.map((v, i) => ({ capturedDate: new Date(Date.UTC(2026, 9, 1 + i)), priceMxnCents: v }));

  it('serie neta [190000, 200000] ⇒ displays [220400, 232000], abs display 11600; neto, pct y direction intactos', async () => {
    const { svc } = sealedService([SEALED()], { trend: 'on', history: serie([190000, 200000]) });
    const res = onWire(await svc.sealedValueHistory('s1', '1m')) as Record<string, any>;
    expect(res.points.map((p: any) => p.valueMxnCents)).toEqual([190000, 200000]);
    expect(res.points.map((p: any) => p.displayValueMxnCents)).toEqual([220400, 232000]);
    expect(res.change).toEqual({ absMxnCents: 10000, pct: 5.26, direction: 'up', displayAbsMxnCents: 11600 });
  });

  it('serie [1, 4] ⇒ displays [1, 5] y abs display 4 (resta de displays, ⛔ no display de la resta = 3); pct 300', async () => {
    const { svc } = sealedService([SEALED()], { trend: 'on', history: serie([1, 4]) });
    const res = onWire(await svc.sealedValueHistory('s1', '1m')) as Record<string, any>;
    expect(res.points.map((p: any) => p.displayValueMxnCents)).toEqual([1, 5]);
    expect(res.change.displayAbsMxnCents).toBe(4);
    expect(res.change.absMxnCents).toBe(3);
    expect(res.change.pct).toBe(300);
  });

  it('serie vacía ⇒ `displayAbsMxnCents` 0', async () => {
    const { svc } = sealedService([SEALED()], { trend: 'on', history: [] });
    const res = onWire(await svc.sealedValueHistory('s1', '1m')) as Record<string, any>;
    expect(res.points).toEqual([]);
    expect(res.change).toEqual({ absMxnCents: 0, pct: null, direction: 'flat', displayAbsMxnCents: 0 });
  });

  it('la tasa es la del dial: `iva_pct` 8 con [190000, 200000] ⇒ [205200, 216000], abs 10800', async () => {
    const dials = dialsBox({ ivaTransferPct: 50, ivaRatePct: 8 });
    const { svc } = sealedService([SEALED()], { trend: 'on', history: serie([190000, 200000]), dials });
    const res = onWire(await svc.sealedValueHistory('s1', '1m')) as Record<string, any>;
    expect(res.points.map((p: any) => p.displayValueMxnCents)).toEqual([205200, 216000]);
    expect(res.change.displayAbsMxnCents).toBe(10800);
  });

  it('CONJUNTO EXACTO de claves de punto y de `change`', async () => {
    const { svc } = sealedService([SEALED()], { trend: 'on', history: serie([190000, 200000]) });
    const res = onWire(await svc.sealedValueHistory('s1', '1m')) as Record<string, any>;
    expect(Object.keys(res).sort()).toEqual(['change', 'points', 'product', 'range']);
    expect(Object.keys(res.points[0]).sort()).toEqual(['date', 'displayValueMxnCents', 'pricedCardCount', 'valueMxnCents']);
    expect(Object.keys(res.change).sort()).toEqual(['absMxnCents', 'direction', 'displayAbsMxnCents', 'pct']);
  });
});

// ================================================================================================ MIV-B8
describe('MIV-B8 — con `sealed_value_trend=off` la ruta responde 404 sin leer diales', () => {
  it('`404 FEATURE_DISABLED` y `getIvaDials` NO se llama', async () => {
    const { svc, dials } = sealedService([SEALED()], { trend: 'off', history: [] });
    await expect(svc.sealedValueHistory('s1', '1m')).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
    expect(dials.getIvaDials).not.toHaveBeenCalled();
  });
});

// ================================================================================================ MIV-B9
const SRC = join(__dirname, '..', 'src');
function ficherosTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return ficherosTs(full);
    return e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') ? [full] : [];
  });
}

describe('MIV-B9 — censo de llamadores de `marketDisplayCentsOf` (código, sin comentarios)', () => {
  it('solo la DEFINE `common/money.ts` y solo la LLAMAN las dos fichas del catálogo', () => {
    const usos = ficherosTs(SRC)
      .filter((f) => /\bmarketDisplayCentsOf\b/.test(stripComments(readFileSync(f, 'utf8'))))
      .map((f) => relative(SRC, f).split('\\').join('/'))
      .sort();
    expect(usos).toEqual([
      'common/money.ts',
      'modules/catalog/catalog.service.ts',
      'modules/catalog/sealed-catalog.service.ts',
    ]);
  });

  it('las rutas de set (`set-value.service.ts`) NO cambian: ni `display*` ni la función', () => {
    const code = stripComments(readFileSync(join(SRC, 'modules', 'catalog', 'set-value.service.ts'), 'utf8'));
    expect(code).not.toMatch(/displayValueMxnCents|displayAbsMxnCents|marketDisplayCentsOf/);
  });
});

// ================================================================================================ MIV-B10
describe('MIV-B10 — las REJILLAS no traen la clave', () => {
  it('rejilla de singles (`GroupedListingSummaryDTO`)', async () => {
    const res = await cardService([ITEM()]).listCards({ page: 1, pageSize: 20 } as never);
    expect(res.data.length).toBeGreaterThan(0);
    expect(onWire(res.data[0])).not.toHaveProperty('referenceDisplayCents');
  });

  it('rejilla de sellado (`SealedGroupSummaryDTO`)', async () => {
    const res = await sealedService([SEALED()]).svc.listSealed({ page: 1, pageSize: 20 } as never);
    expect(res.data.length).toBeGreaterThan(0);
    expect(onWire(res.data[0])).not.toHaveProperty('referenceDisplayCents');
  });

  it('`ListingDTO` por pieza (`units[]` de la ficha de carta y `listings[]` del sellado) NO la trae', async () => {
    const card = await cardService([ITEM()]).getCard('c1');
    expect(card.units.length).toBeGreaterThan(0);
    for (const u of card.units) expect(onWire(u)).not.toHaveProperty('referenceDisplayCents');
    const sealed = await sealedService([SEALED()]).svc.sealedDetail('s1');
    expect(sealed.listings.length).toBeGreaterThan(0);
    for (const l of sealed.listings) expect(onWire(l)).not.toHaveProperty('referenceDisplayCents');
  });
});

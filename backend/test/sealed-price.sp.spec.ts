import { readFileSync, readdirSync } from 'node:fs';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { InventoryController } from '../src/modules/inventory/inventory.controller';
import { join, relative } from 'node:path';
import {
  computeSealedSaleOf,
  displayPriceCentsOf,
  listEquivalentCentsOf,
  manualSaleOf,
  saleDisplayCentsOf,
} from '../src/common/money';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { assertSealedPriceWriters, canSetSealedSalePrice } from '../src/modules/inventory/sealed-price.policy';
import { SealedPriceService, sealedMarginOf } from '../src/modules/inventory/sealed-price.service';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { stripComments } from './helpers/strip-comments';
import { identCensus } from './helpers/ident-census';
import { ivaDialsStub } from './helpers/iva-dials';

/**
 * sealed-price.sp.spec.ts — 💰 v1.83 / v1.83.1 `API_CONTRACT §M11-SP` (SP.8) + `§M11-SP.12.14`, las pruebas PURAS y
 * ESTÁTICAS del precio del sellado por producto. Las de Postgres real y HTTP (SP-2, SP-4…SP-12, SP-16…SP-18) viven en
 * `test/integration/sealed-price.e2e-spec.ts`.
 *
 * - SP-1  (+v1.83.1): precedencia producto > pieza > automático > pendiente; raw no lee el producto; `P` fijo del dueño
 *          con `L` equivalente por dial; legado por pieza deriva `P`.
 * - SP-3:  `manualSaleOf` EXIGE `sealedProduct` en el tipo (`@ts-expect-error` que solo compila si falta).
 * - SP-9:  la tabla de §M11-SP.4 sobre el predicado único (`assertSealedPriceWriters`).
 * - SP-10 (margen): los vectores de §M11-SP.12.5 sobre `sealedMarginOf` y consultas CONSTANTES de la hoja (1 vs 50).
 * - SP-13: censo de escrituras de `ownerDisplayPriceCents` en `src/`.
 * - SP-14: tabla de `canSetSealedSalePrice` (hoy `super_admin`, D-SP-1; convergencia con `isOwner` al fusionar).
 * - SP-15: ida y vuelta `L → P → L` exhaustiva + aleatoria + extremos; `P = 700/1200` sin `L` (e3).
 * - SP-17 (consultas): el conteo de A-1 es UN `groupBy` por página, con 1 y con 50 filas.
 * - SP-19: censo de `displayPriceCentsOf(` en `src/modules` (ventas solo por `saleDisplayCentsOf`).
 * - D-8 (techlead): la relectura del `PUT` sin producto ⇒ `404 NOT_FOUND`, nunca `data: undefined`.
 */

const D_100_16 = { ivaTransferPct: 100, ivaRatePct: 16 };
const D_50_16 = { ivaTransferPct: 50, ivaRatePct: 16 };
const SPREADS = { box: 18 } as Record<string, number>;
const SRC = join(__dirname, '..', 'src');

const sealed = (listPriceCents: number | null, owner: number | null | undefined) => ({
  productType: 'sealed',
  listPriceCents,
  sealedProduct: owner === undefined ? null : { ownerDisplayPriceCents: owner },
});

// ================================================================================================ SP-1
describe('💰 SP-1 — precedencia del precio de VENTA del sellado (pura, `money.ts`)', () => {
  it('producto 2000 y pieza 1000 ⇒ el del PRODUCTO (peldaño 1)', () => {
    expect(manualSaleOf(sealed(1000, 2000))).toEqual({ origin: 'product', displayCents: 2000 });
  });
  it('producto `null` y pieza 1000 ⇒ la PIEZA (legado, peldaño 2)', () => {
    expect(manualSaleOf(sealed(1000, null))).toEqual({ origin: 'piece', listCents: 1000 });
  });
  it('ambos `null` con mercado ⇒ mercado × spread (`automatic`)', () => {
    const r = computeSealedSaleOf(manualSaleOf(sealed(null, null)), 'box', 100_000, SPREADS, 25, D_100_16);
    expect(r).toEqual({
      salePriceCents: 118_000,
      status: 'priced',
      source: 'subtype_spread',
      appliedSpreadPct: 18,
      origin: 'automatic',
      fixedDisplayCents: null,
    });
  });
  it('producto `0` (H-1: ausente) ⇒ cae a la pieza; sin pieza ⇒ al automático', () => {
    expect(manualSaleOf(sealed(1000, 0))).toEqual({ origin: 'piece', listCents: 1000 });
    const r = computeSealedSaleOf(manualSaleOf(sealed(null, 0)), 'box', 100_000, SPREADS, 25, D_100_16);
    expect(r.origin).toBe('automatic');
  });
  it('raw con pieza 1000 y un `sealedProduct` con 2000 ⇒ la PIEZA (⛔ raw nunca lee el producto)', () => {
    expect(
      manualSaleOf({ productType: 'raw', listPriceCents: 1000, sealedProduct: { ownerDisplayPriceCents: 2000 } }),
    ).toEqual({ origin: 'piece', listCents: 1000 });
    expect(
      manualSaleOf({ productType: 'graded', listPriceCents: null, sealedProduct: { ownerDisplayPriceCents: 2000 } }),
    ).toBeNull();
  });
  it('sin precio ni mercado ⇒ `pending` (jamás un precio inventado)', () => {
    const r = computeSealedSaleOf(null, 'box', null, SPREADS, 25, D_100_16);
    expect(r).toMatchObject({ salePriceCents: null, status: 'pending', origin: 'pending', fixedDisplayCents: null });
  });

  it('v1.83.1 — producto `P = 700`: `fixedDisplayCents 700` con `L` equivalente 603 (100,16) y 648 (50,16); se cobra 700', () => {
    const a = computeSealedSaleOf(manualSaleOf(sealed(1000, 700)), 'box', 100_000, SPREADS, 25, D_100_16);
    expect(a).toEqual({
      salePriceCents: 603,
      status: 'priced',
      source: 'override',
      appliedSpreadPct: null,
      origin: 'product',
      fixedDisplayCents: 700,
    });
    const b = computeSealedSaleOf(manualSaleOf(sealed(1000, 700)), 'box', 100_000, SPREADS, 25, D_50_16);
    expect([b.salePriceCents, b.fixedDisplayCents]).toEqual([648, 700]);
    // EL camino a P: el del dueño TAL CUAL, en los dos diales (no 699 ni 700±1).
    expect(saleDisplayCentsOf({ listPriceCents: a.salePriceCents as number, fixedDisplayCents: a.fixedDisplayCents }, D_100_16)).toBe(700);
    expect(saleDisplayCentsOf({ listPriceCents: b.salePriceCents as number, fixedDisplayCents: b.fixedDisplayCents }, D_50_16)).toBe(700);
  });
  it('v1.83.1 — legado `listPriceCents 1000` con (50,16) ⇒ `P = 1080` (derivación de siempre)', () => {
    const r = computeSealedSaleOf(manualSaleOf(sealed(1000, null)), 'box', null, SPREADS, 25, D_50_16);
    expect(r).toMatchObject({ salePriceCents: 1000, origin: 'piece', fixedDisplayCents: null });
    expect(saleDisplayCentsOf({ listPriceCents: 1000, fixedDisplayCents: null }, D_50_16)).toBe(1080);
  });
  it('el resolvedor del servicio (`resolveSealedSalePrice`) aplica la misma precedencia con los diales que recibe', () => {
    const pricing = new PricingService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    const ref = { status: 'priced' as const, referenceMxnCents: 100_000, source: 'manual' as const };
    const ctx = { spreadPctBySubtype: SPREADS, fallbackPct: 25, sourceOn: true };
    const r = pricing.resolveSealedSalePrice({ ...sealed(1000, 2000), sealedSubtype: 'box' }, ref, ctx, D_100_16);
    expect(r).toMatchObject({ origin: 'product', fixedDisplayCents: 2000, salePriceCents: 1724 });
  });
});

// ================================================================================================ SP-3
describe('SP-3 — `manualSaleOf` EXIGE `sealedProduct` en el tipo (estático)', () => {
  it('un objeto sin `sealedProduct` NO compila (el `@ts-expect-error` solo es válido si el tipo lo exige)', () => {
    const sinInclude = { productType: 'sealed', listPriceCents: 1000 };
    // @ts-expect-error — SP-3: una lectura que olvide `SEALED_SALE_PRICE_INCLUDE` no puede decidir un precio.
    expect(manualSaleOf(sinInclude)).toEqual({ origin: 'piece', listCents: 1000 });
  });
});

// ================================================================================================ SP-15
describe('💰 SP-15 — ida y vuelta `L → P → L` exacta; `P → L → P` NO (y por eso no se recorre)', () => {
  const ts = [0, 37, 50, 100];
  const rs = [0, 8, 16];

  it('exhaustivo: L ∈ [1, 200000] × t ∈ {0,37,50,100} × r ∈ {0,8,16}', () => {
    let fallos = 0;
    let primero: unknown = null;
    for (const t of ts) {
      for (const r of rs) {
        const d = { ivaTransferPct: t, ivaRatePct: r };
        for (let L = 1; L <= 200_000; L++) {
          if (listEquivalentCentsOf(displayPriceCentsOf(L, t, r), d) !== L) {
            fallos++;
            if (primero == null) primero = { L, t, r };
          }
        }
      }
    }
    expect({ fallos, primero }).toEqual({ fallos: 0, primero: null });
  });

  it('10⁵ `L` al azar hasta 10⁸ (semilla fija) en todas las combinaciones', () => {
    let seed = 0x5eed_1083;
    const rnd = () => {
      seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
      return seed / 0x1_0000_0000;
    };
    let fallos = 0;
    for (let i = 0; i < 100_000; i++) {
      const L = 1 + Math.floor(rnd() * 100_000_000);
      const t = ts[i % ts.length];
      const r = rs[i % rs.length];
      if (listEquivalentCentsOf(displayPriceCentsOf(L, t, r), { ivaTransferPct: t, ivaRatePct: r }) !== L) fallos++;
    }
    expect(fallos).toBe(0);
  });

  it('extremos: L = 1, L = 10⁸ y `t·r = 10⁴` (100, 100)', () => {
    for (const [t, r] of [[100, 100], [100, 16], [0, 16], [37, 8]]) {
      for (const L of [1, 2, 99_999_999, 100_000_000]) {
        expect(listEquivalentCentsOf(displayPriceCentsOf(L, t, r), { ivaTransferPct: t, ivaRatePct: r })).toBe(L);
      }
    }
    // P ≥ 1 ⇒ L equivalente ≥ 1 (t·r ≤ 10⁴).
    expect(listEquivalentCentsOf(1, { ivaTransferPct: 100, ivaRatePct: 100 })).toBeGreaterThanOrEqual(1);
  });

  it('(e3) con (100,16) NINGÚN `L` da `P = 700` ni `P = 1200` ⇒ guardar `L` no podría cobrar lo que el dueño tecleó', () => {
    const alcanzables = new Set<number>();
    for (let L = 1; L <= 2_000; L++) alcanzables.add(displayPriceCentsOf(L, 100, 16));
    expect([alcanzables.has(700), alcanzables.has(1200), alcanzables.has(699), alcanzables.has(701)]).toEqual([false, false, true, true]);
    // Canario de la prohibición de recorrer `P → L → P`: 700 ⇒ 603 ⇒ 699.
    expect(displayPriceCentsOf(listEquivalentCentsOf(700, D_100_16), 100, 16)).toBe(699);
  });
});

// ================================================================================== SP-10 (margen)
describe('💰 SP-10 — margen informativo sobre el NETO FISCAL `N` (vectores de §M11-SP.12.5)', () => {
  it.each([
    [145_000, 16, 90_000, 125_000, 35_000, 2_800],
    [129_900, 16, 100_000, 111_983, 11_983, 1_070],
    [700, 16, 500, 603, 103, 1_708],
    [150_000, 8, 110_000, 138_889, 28_889, 2_080],
  ])('P=%i r=%i avg=%i ⇒ N=%i cents=%i bps=%i', (P, r, avg, N, cents, bps) => {
    expect(sealedMarginOf(P, avg, r)).toEqual({ netCents: N, margin: { cents, bps } });
  });
  it('sin `P` o sin costo ⇒ `margin: null` (⛔ nunca un 0 inventado)', () => {
    expect(sealedMarginOf(null, 1000, 16)).toEqual({ netCents: null, margin: null });
    expect(sealedMarginOf(1160, null, 16)).toEqual({ netCents: 1000, margin: null });
  });
});

// ================================================================================================ SP-9
describe('💰 SP-9 — la regla de §M11-SP.4 (personal da de alta sin precio), tabla entera', () => {
  const OWNER = { role: 'super_admin' };
  const OP = { role: 'vault_operator' };
  const code = (fn: () => void) => {
    try {
      fn();
      return 'ok';
    } catch (e) {
      const ex = e as { code?: string; getStatus?: () => number; details?: unknown };
      return `${ex.getStatus?.()} ${ex.code}`;
    }
  };

  it('sellado LIGADO + `listPriceCents` ⇒ 422 SEALED_PRICE_IS_PER_PRODUCT para CUALQUIER rol, con `details`', () => {
    for (const actor of [OWNER, OP, null]) {
      expect(code(() => assertSealedPriceWriters([{ productType: 'sealed', listPriceCents: 1, sealedProductId: 'sp-1' }], actor))).toBe(
        '422 SEALED_PRICE_IS_PER_PRODUCT',
      );
    }
    expect(() =>
      assertSealedPriceWriters([{ productType: 'sealed', listPriceCents: 1, sealedProductId: 'sp-1', itemId: 'it-1' }], OWNER),
    ).toThrow(expect.objectContaining({ details: { sealedProductId: 'sp-1', itemId: 'it-1' } }));
  });
  it('sellado SIN producto + `listPriceCents`: dueño ⇒ pasa; operador / sin actor ⇒ 403', () => {
    expect(code(() => assertSealedPriceWriters([{ productType: 'sealed', listPriceCents: 1, sealedProductId: null }], OWNER))).toBe('ok');
    expect(code(() => assertSealedPriceWriters([{ productType: 'sealed', listPriceCents: 1 }], OP))).toBe('403 FORBIDDEN');
    expect(code(() => assertSealedPriceWriters([{ productType: 'sealed', listPriceCents: 1 }], undefined))).toBe('403 FORBIDDEN');
  });
  it('`manualMarketMxnCents` de sellado: solo el dueño (HECHOS 2026-10-05 (1))', () => {
    expect(code(() => assertSealedPriceWriters([{ productType: 'sealed', sealedProductId: 'sp-1', manualMarketMxnCents: 5 }], OP))).toBe('403 FORBIDDEN');
    expect(code(() => assertSealedPriceWriters([{ productType: 'sealed', sealedProductId: 'sp-1', manualMarketMxnCents: 5 }], OWNER))).toBe('ok');
  });
  it('raw / graded con operador ⇒ SIN cambio (P-PRE-1, por ausencia)', () => {
    expect(code(() => assertSealedPriceWriters([{ productType: 'raw', listPriceCents: 1 }, { productType: 'graded', listPriceCents: 9 }], OP))).toBe('ok');
  });
  it('lote: UNA línea mala tumba el lote entero (la regla mira todas las líneas antes de escribir)', () => {
    const lines = [
      { productType: 'raw', listPriceCents: 1 },
      { productType: 'sealed', sealedProductId: 'sp-1' },
      { productType: 'sealed', listPriceCents: 7, sealedProductId: 'sp-2' },
    ];
    expect(code(() => assertSealedPriceWriters(lines, OWNER))).toBe('422 SEALED_PRICE_IS_PER_PRODUCT');
  });
  it('sin precio ni mercado a mano ⇒ pasa (el personal da de alta SIN precio)', () => {
    expect(code(() => assertSealedPriceWriters([{ productType: 'sealed', sealedProductId: 'sp-1' }], OP))).toBe('ok');
  });
});

// ================================================================================================ SP-14
describe('SP-14 (pre-fusión) — `canSetSealedSalePrice`: hoy súper-admin (D-SP-1)', () => {
  it.each([
    ['super_admin', true],
    ['vault_operator', false],
    ['customer', false],
    [undefined, false],
  ])('rol %p ⇒ %p', (role, expected) => {
    expect(canSetSealedSalePrice(role === undefined ? undefined : { role })).toBe(expected);
  });
  it('falla cerrado sin actor', () => {
    expect(canSetSealedSalePrice(null)).toBe(false);
  });
});

// ================================================================================================ SP-13
describe('SP-13 — censo: `ownerDisplayPriceCents` se ESCRIBE solo en el servicio del `PUT`', () => {
  it('ningún otro fichero de `src/` pone la columna en un `data:` de Prisma, ni la toca por SQL crudo', () => {
    expect(identCensus(SRC, /data:\s*\{[^{}]*\bownerDisplayPriceCents\b/g)).toEqual({
      'modules/inventory/sealed-price.service.ts': 1,
    });
    expect(identCensus(SRC, /"ownerDisplayPriceCents"/g)).toEqual({});
  });
});

// ================================================================================================ SP-19
function ficherosTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return ficherosTs(full);
    return e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') ? [full] : [];
  });
}
describe('SP-19 — censo: `displayPriceCentsOf(` a pelo solo para el preview del dial; las ventas por `saleDisplayCentsOf`', () => {
  it('en `src/modules`, `displayPriceCentsOf(` solo aparece en el preview del dial (M10)', () => {
    const usos = ficherosTs(join(SRC, 'modules'))
      .filter((f) => /\bdisplayPriceCentsOf\(/.test(stripComments(readFileSync(f, 'utf8'))))
      .map((f) => relative(SRC, f).split('\\').join('/'))
      .sort();
    expect(usos).toEqual(['modules/settings/iva-transfer.ts']);
  });
  it('los TRES sitios de venta derivan `P` por `saleDisplayCentsOf` (checkout, catálogo, rejilla de sellado)', () => {
    for (const f of ['orders/orders.service.ts', 'catalog/catalog.service.ts', 'catalog/sealed-catalog.service.ts']) {
      const code = stripComments(readFileSync(join(SRC, 'modules', f), 'utf8'));
      expect({ f, usa: /\bsaleDisplayCentsOf\(/.test(code) }).toEqual({ f, usa: true });
    }
  });
});

// =========================================================================== SP-10 / SP-17 (consultas)
/** Doble de Prisma que CUENTA llamadas por delegado (la hoja y el listado) — consultas constantes, ⛔ N+1. */
function countingPrisma(products: any[], items: any[]) {
  const calls: string[] = [];
  const hit = (k: string) => calls.push(k);
  const prisma: any = {
    sealedProduct: {
      findMany: jest.fn(async () => (hit('sealedProduct.findMany'), products)),
      count: jest.fn(async () => (hit('sealedProduct.count'), products.length)),
    },
    inventoryItem: {
      count: jest.fn(async () => (hit('inventoryItem.count'), 0)),
      groupBy: jest.fn(async () => (hit('inventoryItem.groupBy'), [])),
      findMany: jest.fn(async (args: any) => {
        hit('inventoryItem.findMany');
        return args?.distinct ? [] : items;
      }),
    },
    card: { findMany: jest.fn(async () => (hit('card.findMany'), [])) },
    location: {},
  };
  return { prisma, calls };
}
const pricingCounting = (calls: string[]) =>
  ({
    loadSealedSpreads: jest.fn(async () => (calls.push('pricing.loadSealedSpreads'), { spreadPctBySubtype: {}, fallbackPct: 25, sourceOn: true })),
    getReferencesBatch: jest.fn(async () => (calls.push('pricing.getReferencesBatch'), new Map())),
    resolveSealedSalePrice: PricingService.prototype.resolveSealedSalePrice,
    gateSealedMarketCents: PricingService.prototype.gateSealedMarketCents,
  }) as unknown as PricingService;

describe('SP-10 — la hoja hace las MISMAS consultas con 1 y con 50 productos', () => {
  const product = (i: number) => ({
    id: `sp-${i}`,
    name: `P${i}`,
    subtype: 'etb',
    imageUrl: null,
    active: true,
    setId: `set-${i}`,
    tcgplayerProductId: 1000 + i,
    ownerDisplayPriceCents: i % 2 === 0 ? 129_900 : null,
    set: { id: `set-${i}`, name: 'S', series: null, releaseDate: null },
  });
  async function calls(n: number) {
    const { prisma, calls: c } = countingPrisma(Array.from({ length: n }, (_, i) => product(i)), []);
    const svc = new SealedPriceService(prisma, pricingCounting(c), ivaDialsStub() as never, {} as InventoryService);
    await svc.priceSheet({ scope: 'on_hand', page: 1, pageSize: 50 }, { role: 'vault_operator' });
    return c.sort();
  }
  it('conteo idéntico (1 vs 50)', async () => {
    expect(await calls(50)).toEqual(await calls(1));
  });
});

describe('SP-17 — `sealedProductPieces` del listado: UN `groupBy` por página (1 vs 50 filas)', () => {
  const row = (i: number) => ({
    id: `it-${i}`,
    folio: `F${i}`,
    cardId: 'c1',
    card: { id: 'c1', rarity: 'Sealed', rarityCanonical: 'Sealed' },
    productType: 'sealed',
    ownerType: 'platform',
    status: 'in_stock',
    listPriceCents: null,
    sealedSubtype: 'etb',
    finish: 'normal',
    tcgplayerProductId: null,
    sealedProductId: `sp-${i % 3}`,
    sealedProduct: { ownerDisplayPriceCents: 129_900 },
    location: null,
    createdAt: new Date(0),
  });
  async function groupBys(n: number) {
    const rows = Array.from({ length: n }, (_, i) => row(i));
    const { prisma, calls } = countingPrisma([], rows);
    const pricing = {
      ...pricingCounting(calls),
      loadPricingCurve: jest.fn(async () => ({})),
      loadSalePremiumFloorPolicy: jest.fn(async () => ({})),
      getVariantOverridesBatch: jest.fn(async () => new Map()),
      sealedMarketGradeKeyForItem: jest.fn(() => null),
    } as unknown as PricingService;
    const svc = new InventoryService(prisma, pricing, ivaDialsStub() as never);
    const res: any = await svc.listItems({ page: 1, pageSize: 50 });
    return { groupBy: calls.filter((c) => c === 'inventoryItem.groupBy').length, first: res.data[0] };
  }
  it('1 y 50 filas ⇒ exactamente 1 `groupBy`; la fila trae el conteo del producto y ⛔ no la relación', async () => {
    const one = await groupBys(1);
    const fifty = await groupBys(50);
    expect([one.groupBy, fifty.groupBy]).toEqual([1, 1]);
    expect(fifty.first).toMatchObject({
      sealedProductId: 'sp-0',
      sealedProductPieces: { inStock: 0, listed: 0, reserved: 0 },
      sealedPriceOrigin: 'product',
      sealedProductDisplayPriceCents: 129_900,
      resolvedDisplayPriceCents: 129_900,
      resolvedSalePriceCents: 111_983,
    });
    expect('sealedProduct' in fifty.first).toBe(false);
  });
});

// ================================================================================================ SP-4

describe('💰 SP-4 (unitaria) — «solo el dueño» en las DOS puntas: `@Roles` de MÉTODO y el predicado en el servicio', () => {
  it('el `PUT` lleva `@Roles(super_admin)` de método, y gana al de clase (`getAllAndOverride`)', () => {
    const handler = InventoryController.prototype.setSealedSalePrice;
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(['super_admin']);
    expect(new Reflector().getAllAndOverride(ROLES_KEY, [handler, InventoryController])).toEqual(['super_admin']);
    // La hoja hereda la clase (`vault_operator+`): el personal VE costo y margen (HECHOS 2026-10-05 (2)).
    expect(Reflect.getMetadata(ROLES_KEY, InventoryController.prototype.sealedPriceSheet)).toBeUndefined();
  });
  it('el servicio rechaza a un no-dueño ANTES de leer o escribir nada (403), aunque el guard no estuviera', async () => {
    const prisma: any = { $transaction: jest.fn(), sealedProduct: { findUnique: jest.fn() } };
    const settings: any = { getIvaDials: jest.fn() };
    const svc = new SealedPriceService(prisma, {} as PricingService, settings, {} as InventoryService);
    for (const role of ['vault_operator', 'customer', undefined]) {
      await expect(svc.setSalePrice('sp-1', { displayPriceCents: 700, expectedDisplayPriceCents: null }, { id: 'u', role })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(settings.getIvaDials).not.toHaveBeenCalled();
  });
});

// ================================================================================================ D-8
describe('D-8 (gate de techlead) — el producto desaparece entre el commit y la relectura ⇒ 404 explícito', () => {
  it('relectura `null` ⇒ `404 NOT_FOUND`, ⛔ nunca `200` con `data: undefined`', async () => {
    const tx: any = {
      // Doble clic idempotente: la tx lee el producto y no escribe nada (el camino más corto hasta la relectura).
      sealedProduct: { findUnique: jest.fn(async () => ({ id: 'sp-1', ownerDisplayPriceCents: 700 })) },
    };
    const prisma: any = {
      $transaction: jest.fn(async (fn: (t: any) => Promise<unknown>) => fn(tx)),
      // La relectura DESPUÉS del commit: el producto ya no está.
      sealedProduct: { findUnique: jest.fn(async () => null) },
      inventoryItem: { findMany: jest.fn(async () => []) },
    };
    const settings: any = { getIvaDials: jest.fn(async () => D_100_16) };
    const inventory = { reevaluateForPublication: jest.fn(async () => []) } as unknown as InventoryService;
    const svc = new SealedPriceService(prisma, {} as PricingService, settings, inventory);
    await expect(
      svc.setSalePrice('sp-1', { displayPriceCents: 700, expectedDisplayPriceCents: 700 }, { id: 'u', role: 'super_admin' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(prisma.sealedProduct.findUnique).toHaveBeenCalledTimes(1);
  });
});

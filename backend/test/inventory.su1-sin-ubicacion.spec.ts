import { InventoryService } from '../src/modules/inventory/inventory.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { DEFAULT_PRICING_CURVE, DEFAULT_SALE_PREMIUM_FLOOR_POLICY } from '../src/common/pricing-curve';
import { ivaDialsStub } from './helpers/iva-dials';

/**
 * ⭐⭐ Errata SU-1 (API_CONTRACT §M1-SU, ARCHITECTURE §4.65; HECHOS «La ubicación (cajón) NO es
 * requisito para publicar, por ahora», 2026-10-07) — pruebas SU-B1, SU-B2 y SU-B3 de la tabla SU.6.
 *
 * Todas ROJAS sobre `8c72c556` salvo SU-B3 (ii), que vigila que quitar el cajón no se lleve por
 * delante la guarda de identidad de slab (`assertPublishableGuards`).
 * SU-B4 (`PUT …/sale-price`) vive en `integration/sealed-price.e2e-spec.ts`; SU-B5 en
 * `buylist.bl25-bl26.spec.ts`; SU-B6 (el script del rezago) en `integration/reevaluate-unlocated.e2e-spec.ts`.
 */

const settings = { ...ivaDialsStub(), getNumber: jest.fn() } as unknown as SettingsService;

interface ItemOpts {
  id: string;
  locationId?: string | null;
  status?: string;
  priced?: boolean;
  productType?: 'raw' | 'graded';
  certNumber?: string | null;
  gradingCompany?: string | null;
  gradeValue?: string | null;
  listPriceCents?: number | null;
}

function item(o: ItemOpts) {
  return {
    id: o.id,
    folio: `INV-${o.id}`,
    cardId: `card-${o.id}`,
    card: { id: `card-${o.id}`, rarity: 'Rare', rarityCanonical: 'rare' },
    productType: o.productType ?? 'raw',
    rawCondition: o.productType === 'graded' ? null : 'NM',
    certNumber: o.certNumber ?? null,
    gradingCompany: o.gradingCompany ?? null,
    gradeValue: o.gradeValue ?? null,
    finish: 'normal',
    ownerType: 'platform',
    status: o.status ?? 'in_stock',
    locationId: o.locationId === undefined ? null : o.locationId,
    listPriceCents: o.listPriceCents ?? null,
    cardProductId: null,
    sealedProductId: null,
    sealedProductName: null,
    sealedSubtype: null,
    acquisitionType: 'buylist',
    sourceSellRequestItemId: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    __priced: o.priced === true,
  };
}

/** La clave de variante que `pricing` derivaría: sin slab completo, una graded NO tiene clave. */
function gradeKeyOf(i: any): string | null {
  if (i.productType === 'graded') {
    return i.gradingCompany && i.gradeValue ? `graded:${i.gradingCompany}:${i.gradeValue}` : null;
  }
  return 'raw:NM';
}

function build(items: ReturnType<typeof item>[]) {
  const rows = items;
  const prisma: any = {
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
    inventoryItem: {
      findMany: jest.fn(async ({ where }: any) =>
        where?.id?.in ? rows.filter((r) => where.id.in.includes(r.id)) : rows,
      ),
      findUnique: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        const r = rows.find((x) => x.id === where.id) as Record<string, unknown>;
        Object.assign(r, data);
        return r;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const r = rows.find((x) => x.id === where.id);
        if (!r) return { count: 0 };
        Object.assign(r, data);
        return { count: 1 };
      }),
    },
    pendingPriceEntry: { findMany: jest.fn(async () => []) },
  };
  const pricing = {
    loadSalePremiumFloorPolicy: jest.fn(async () => DEFAULT_SALE_PREMIUM_FLOOR_POLICY),
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    loadSealedSpreads: jest.fn(async () => ({ spreadPctBySubtype: {}, fallbackPct: 0, sourceOn: false })),
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    gradeKeyFor: jest.fn((i: any) => gradeKeyOf(i)),
    tryGradeKeyFor: jest.fn((i: any) => gradeKeyOf(i)),
    getReferencesBatch: jest.fn(async (list: any[]) => {
      const m = new Map();
      for (const d of list) {
        const row = rows.find((r) => r.cardId === d.cardId);
        if (row?.__priced) {
          m.set(`${d.cardId}|${d.productType}|${d.gradeKey}|${d.finish}`, {
            status: 'priced',
            referenceMxnCents: 200000,
          });
        }
      }
      return m;
    }),
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    getPricedRawFinishesBatch: jest.fn(async () => new Map()),
    settlePendingForVariant: jest.fn(async (reason: unknown) => (reason == null ? undefined : 'ppe-1')),
    escalatePending: jest.fn(async () => 'ppe-1'),
  } as unknown as PricingService;
  const svc = new InventoryService(prisma as PrismaService, pricing, settings);
  return { svc, prisma, pricing, rows };
}

// =============================================================================================
describe('SU-B1 · `reevaluateForPublication` publica una raw sin ubicación con precio', () => {
  it('raw `in_stock`, SIN cajón, con precio ⇒ `published` y la pieza `listed`', async () => {
    const { svc, rows } = build([item({ id: 'a', priced: true })]);
    const [res] = await svc.reevaluateForPublication(['a']);
    expect(res).toEqual({ inventoryItemId: 'a', outcome: 'published', missing: [] });
    expect(rows[0].status).toBe('listed');
    // El cajón no se inventa: publicar no es ubicar.
    expect(rows[0].locationId).toBeNull();
  });

  it('raw `in_stock`, SIN cajón, SIN precio ⇒ `price_pending`, `missing` EXACTAMENTE `["price"]`, escala a M2', async () => {
    const { svc, rows, pricing } = build([item({ id: 'a' })]);
    const [res] = await svc.reevaluateForPublication(['a']);
    expect(res.outcome).toBe('price_pending');
    expect(res.missing).toEqual(['price']);
    expect(res.pendingPriceEntryId).toBe('ppe-1');
    expect(pricing.settlePendingForVariant).toHaveBeenCalled();
    expect(rows[0].status).toBe('in_stock');
  });

  it('el resultado `missing_location` ya no se produce (SU.2: el vocabulario queda dormido)', async () => {
    const { svc } = build([
      item({ id: 'a', priced: true }),
      item({ id: 'b' }),
      item({ id: 'c', priced: true, status: 'reserved' }),
    ]);
    const res = await svc.reevaluateForPublication(['a', 'b', 'c']);
    expect(res.map((r) => r.outcome)).toEqual(['published', 'price_pending', 'not_publishable']);
    for (const r of res) expect(r.missing).not.toContain('location');
  });
});

// =============================================================================================
describe('SU-B2 · `pending-publish` ya no señala la falta de cajón', () => {
  it('(i) sin ubicación CON precio ⇒ fuera de la cola', async () => {
    const { svc } = build([item({ id: 'a', priced: true })]);
    const res: any = await svc.pendingPublish({ page: 1, pageSize: 20 });
    expect(res.total).toBe(0);
    expect(res.data).toEqual([]);
  });

  it('(ii) sin ubicación SIN precio ⇒ en la cola con `missing` EXACTAMENTE `["price"]`', async () => {
    const { svc } = build([item({ id: 'a' })]);
    const res: any = await svc.pendingPublish({ page: 1, pageSize: 20 });
    expect(res.total).toBe(1);
    expect(res.data[0].inventoryItemId).toBe('a');
    expect(res.data[0].missing).toEqual(['price']);
  });

  it('(iii) `?missing=location` ⇒ `data: []`, `total: 0` aunque haya piezas sin cajón (con y sin precio)', async () => {
    const { svc } = build([item({ id: 'a' }), item({ id: 'b', priced: true }), item({ id: 'c', locationId: 'loc-1' })]);
    const res: any = await svc.pendingPublish({ page: 1, pageSize: 20, missing: 'location' });
    expect(res.data).toEqual([]);
    expect(res.total).toBe(0);
    expect(res.page).toBe(1);
    expect(res.pageSize).toBe(20);
  });

  it('`?missing=price` sigue contando las sin precio, con y sin cajón', async () => {
    const { svc } = build([item({ id: 'a' }), item({ id: 'b', priced: true }), item({ id: 'c', locationId: 'loc-1' })]);
    const res: any = await svc.pendingPublish({ page: 1, pageSize: 20, missing: 'price' });
    expect(res.data.map((r: any) => r.inventoryItemId)).toEqual(['a', 'c']);
    expect(res.total).toBe(2);
  });
});

// =============================================================================================
describe('SU-B3 · gradeada sin ubicación: el cajón se va, la guarda de slab se queda', () => {
  it('(i) con cert + slab + precio ⇒ `published`', async () => {
    const { svc, rows } = build([
      item({ id: 'g', productType: 'graded', certNumber: 'PSA-123', gradingCompany: 'PSA', gradeValue: '10', priced: true }),
    ]);
    const [res] = await svc.reevaluateForPublication(['g']);
    expect(res.outcome).toBe('published');
    expect(rows[0].status).toBe('listed');
  });

  it('(ii) sin slab (aunque traiga cert y precio MANUAL) ⇒ NO se publica', async () => {
    // El precio manual corta la derivación (`resolvePublishSalePrice`, M-1): lo único que impide publicar es la
    // guarda de identidad de slab de `assertPublishableGuards`. Si se pierde, esta prueba cae.
    const { svc, rows } = build([
      item({ id: 'g', productType: 'graded', certNumber: 'PSA-123', listPriceCents: 99_900, locationId: 'loc-1' }),
      item({ id: 'h', productType: 'graded', certNumber: 'PSA-124', listPriceCents: 99_900 }),
    ]);
    const res = await svc.reevaluateForPublication(['g', 'h']);
    for (const r of res) expect(r.outcome).not.toBe('published');
    expect(rows.map((r) => r.status)).toEqual(['in_stock', 'in_stock']);
  });

  it('(ii-b) sin cert ⇒ NO se publica (la otra guarda de graded tampoco se mueve)', async () => {
    const { svc, rows } = build([
      item({ id: 'g', productType: 'graded', gradingCompany: 'PSA', gradeValue: '10', priced: true }),
    ]);
    const [res] = await svc.reevaluateForPublication(['g']);
    expect(res.outcome).not.toBe('published');
    expect(rows[0].status).toBe('in_stock');
  });
});

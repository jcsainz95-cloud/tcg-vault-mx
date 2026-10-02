import { Prisma } from '@prisma/client';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { BusinessException } from '../src/common/business.exception';
import { assertOperable } from '../src/modules/inventory/item-location.rules';

/**
 * ⭐ INV-SP-8 (API_CONTRACT §M1 errata v1.80.2.3, `#M1-patch-price-guard`; regla de fusión
 * `#M1-merge-rule`) — *«ninguna pieza que no sea de plataforma en venta recibe `listPriceCents`
 * desde M1»*. Hermana de INV-SP-7 (`inventory.patch-status-guard.spec.ts`).
 *
 * *El defecto (QA, stack real, `fae5a44`):* con un cuerpo sin `status` (o con `status` igual al
 * actual) el `PATCH` iba por un `update({ where: { id } })` plano y escribía `listPriceCents` en
 * CUALQUIER pieza: la carta de un cliente en custodia o una pieza dada de baja recibían un precio de
 * venta y el operador un `200`. Norma: `listPriceCents` SOLO sobre plataforma `in_stock | listed`
 * (el MISMO allowlist de `mark`/`status`, `assertOperable(item, 'price')`); cualquier otra pieza ⇒
 * `422 ITEM_NOT_ADJUSTABLE {status, ownerType}` y NINGÚN campo del mismo `PATCH` escrito. Escritura
 * condicionada a lo leído (`guardedItemUpdate`): la pieza cambia entre lectura y escritura ⇒ `409`.
 *
 * Mutaciones del contrato (N=1, deterministas): (M1) quitar `assertOperable(item,'price')` ⇒ 1, 2, 5,
 * 6, 7 rojas; (M2) meter `reserved` en el allowlist de `'price'` ⇒ 5 roja; (M3) escritura sin
 * condición ⇒ 9 roja.
 */

type Row = {
  id: string;
  folio: string;
  productType: 'raw' | 'graded' | 'sealed';
  status: string;
  ownerType: 'platform' | 'customer';
  ownerUserId: string | null;
  ownershipStatus: 'pending' | 'settled' | null;
  locationId: string | null;
  certNumber: string | null;
  listPriceCents: number | null;
  cardId: string;
};

const SEEDED_PRICE = 777;

function platform(status: string): Row {
  return {
    id: 'p',
    folio: 'INV-p',
    productType: 'raw',
    status,
    ownerType: 'platform',
    ownerUserId: null,
    ownershipStatus: null,
    locationId: 'shelf-1',
    certNumber: null,
    listPriceCents: SEEDED_PRICE,
    cardId: 'card-1',
  };
}
function customer(over: Partial<Row> = {}): Row {
  return {
    ...platform('in_custody'),
    id: 'c',
    folio: 'INV-c',
    ownerType: 'customer',
    ownerUserId: 'ana',
    ownershipStatus: 'settled',
    locationId: 'drawer-ana-1',
    ...over,
  };
}

function build(target: Row) {
  const rows: Row[] = [target];
  const writes: string[] = [];
  const matches = (r: Row, where: Record<string, any>) =>
    Object.entries(where).every(([k, v]) => v === undefined || (r as any)[k] === v);
  const client = (inTx: boolean): any => ({
    $executeRaw: jest.fn(async () => 1),
    inventoryItem: {
      findUnique: jest.fn(async ({ where, include }: any) => {
        const r = rows.find((x) => x.id === where.id);
        if (!r) return null;
        return include
          ? { ...r, card: include.card ? { id: r.cardId, set: {} } : undefined, location: null, movements: [] }
          : { ...r };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const r = rows.find((x) => x.id === where.id);
        if (!r || !matches(r, where)) {
          throw new Prisma.PrismaClientKnownRequestError('Record to update not found.', {
            code: 'P2025',
            clientVersion: 'test',
          });
        }
        writes.push(`update${inTx ? '@tx' : ''}`);
        Object.assign(r, data);
        return { ...r };
      }),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    shipmentItem: { findMany: jest.fn(async () => []) },
    inventoryMovement: {
      create: jest.fn(async ({ data }: any) => {
        writes.push(`movement${inTx ? '@tx' : ''}`);
        return data;
      }),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        writes.push(`audit${inTx ? '@tx' : ''}`);
        return data;
      }),
    },
  });
  const tx = client(true);
  const prisma: any = client(false);
  prisma.$transaction = jest.fn(async (fn: any) => fn(tx));
  const svc = new InventoryService(
    prisma as PrismaService,
    { getReference: jest.fn() } as unknown as PricingService,
    { getNumber: jest.fn() } as unknown as SettingsService,
  );
  return { svc, prisma, tx, rows, writes };
}

async function err(p: Promise<unknown>): Promise<BusinessException> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(BusinessException);
  return e as BusinessException;
}

// =============================================================================================
describe('INV-SP-8 — `PATCH {listPriceCents}` solo sobre plataforma en venta', () => {
  it('1 · cliente `in_custody` ⇒ 422 ITEM_NOT_ADJUSTABLE {in_custody, customer}, precio intacto', async () => {
    const { svc, rows, writes } = build(customer());
    const e = await err(svc.updateItem('c', { listPriceCents: 12345 }));
    expect(e.code).toBe('ITEM_NOT_ADJUSTABLE');
    expect(e.getStatus()).toBe(422);
    expect(e.details).toEqual({ status: 'in_custody', ownerType: 'customer' });
    expect(rows[0].listPriceCents).toBe(SEEDED_PRICE);
    expect(writes).toEqual([]);
  });

  it('2 · plataforma `withdrawn` ⇒ 422 {withdrawn, platform}, precio intacto', async () => {
    const { svc, rows, writes } = build(platform('withdrawn'));
    const e = await err(svc.updateItem('p', { listPriceCents: 12345 }));
    expect(e.code).toBe('ITEM_NOT_ADJUSTABLE');
    expect(e.getStatus()).toBe(422);
    expect(e.details).toEqual({ status: 'withdrawn', ownerType: 'platform' });
    expect(rows[0].listPriceCents).toBe(SEEDED_PRICE);
    expect(writes).toEqual([]);
  });

  it('3 · plataforma `in_stock` ⇒ 200, precio escrito dentro de la tx y condicionado a lo leído; `status` sigue `in_stock`', async () => {
    const { svc, rows, tx, writes } = build(platform('in_stock'));
    const res: any = await svc.updateItem('p', { listPriceCents: 12345 });
    expect(res.listPriceCents).toBe(12345);
    expect(rows[0]).toMatchObject({ status: 'in_stock', listPriceCents: 12345 });
    expect(writes).toEqual(['update@tx']); // sin movimiento y sin bitácora nueva (v1.80.2.3 p.4)
    expect(tx.inventoryItem.update).toHaveBeenCalledWith({
      where: { id: 'p', status: 'in_stock', ownerType: 'platform', ownerUserId: null },
      data: { listPriceCents: 12345 },
    });
  });

  it('4 · plataforma `listed` ⇒ 200 (re-precio de una publicada)', async () => {
    const { svc, rows } = build(platform('listed'));
    await svc.updateItem('p', { listPriceCents: 4321 });
    expect(rows[0]).toMatchObject({ status: 'listed', listPriceCents: 4321 });
  });

  it('5 · plataforma `reserved` ⇒ 422 {reserved, platform} (la línea del pedido ya congeló su precio)', async () => {
    const { svc, rows, writes } = build(platform('reserved'));
    const e = await err(svc.updateItem('p', { listPriceCents: 12345 }));
    expect(e.code).toBe('ITEM_NOT_ADJUSTABLE');
    expect(e.details).toEqual({ status: 'reserved', ownerType: 'platform' });
    expect(rows[0].listPriceCents).toBe(SEEDED_PRICE);
    expect(writes).toEqual([]);
  });

  it.each(['picking', 'shipped', 'delivered', 'lost', 'damaged'])(
    '6 · plataforma `%s` ⇒ 422 ITEM_NOT_ADJUSTABLE, precio intacto',
    async (status) => {
      const { svc, rows, writes } = build(platform(status));
      const e = await err(svc.updateItem('p', { listPriceCents: 12345 }));
      expect(e.code).toBe('ITEM_NOT_ADJUSTABLE');
      expect(e.getStatus()).toBe(422);
      expect(e.details).toEqual({ status, ownerType: 'platform' });
      expect(rows[0].listPriceCents).toBe(SEEDED_PRICE);
      expect(writes).toEqual([]);
    },
  );

  it.each(['picking', 'reserved', 'delivered', 'lost'])(
    '6b · cliente `%s` ⇒ 422 {ownerType:"customer"} (cualquier estado)',
    async (status) => {
      const { svc, rows, writes } = build(customer({ status }));
      const e = await err(svc.updateItem('c', { listPriceCents: 12345 }));
      expect(e.details).toEqual({ status, ownerType: 'customer' });
      expect(rows[0].listPriceCents).toBe(SEEDED_PRICE);
      expect(writes).toEqual([]);
    },
  );

  it('7 · todo o nada: cliente + {listPriceCents, certNumber} ⇒ 422 y `certNumber` intacto', async () => {
    const { svc, rows, writes } = build(customer());
    await err(svc.updateItem('c', { listPriceCents: 12345, certNumber: 'X' }));
    expect(rows[0]).toMatchObject({ certNumber: null, listPriceCents: SEEDED_PRICE });
    expect(writes).toEqual([]);
  });

  it('7b · `status` y `listPriceCents` juntos sobre `withdrawn` ⇒ UN 422, nada escrito', async () => {
    const { svc, rows, writes } = build(platform('withdrawn'));
    const e = await err(svc.updateItem('p', { status: 'in_stock', listPriceCents: 12345 }));
    expect(e.code).toBe('ITEM_NOT_ADJUSTABLE');
    expect(e.details).toEqual({ status: 'withdrawn', ownerType: 'platform' });
    expect(rows[0]).toMatchObject({ status: 'withdrawn', listPriceCents: SEEDED_PRICE });
    expect(writes).toEqual([]);
  });

  it('8a · lo que NO cambia: cliente + {certNumber} (sin precio) ⇒ 200, identidad escrita (sin guarda)', async () => {
    const { svc, rows } = build(customer());
    await svc.updateItem('c', { certNumber: 'X' });
    expect(rows[0]).toMatchObject({ certNumber: 'X', listPriceCents: SEEDED_PRICE, status: 'in_custody' });
  });

  it('8b · lo que NO cambia: plataforma `picking` + {status:"listed", listPriceCents} ⇒ pipeline v1.51 (ITEM_NOT_PUBLISHABLE)', async () => {
    const { svc, rows } = build(platform('picking'));
    const e = await err(svc.updateItem('p', { status: 'listed', listPriceCents: 12345 }));
    expect(e.code).toBe('ITEM_NOT_PUBLISHABLE');
    expect(rows[0].listPriceCents).toBe(SEEDED_PRICE);
  });

  it('9 · TOCTOU: la pieza pasa a `reserved` entre lectura y escritura ⇒ 409 CONFLICT, nada escrito', async () => {
    const { svc, rows, tx } = build(platform('listed'));
    tx.inventoryItem.findUnique.mockImplementationOnce(async () => {
      const snap = { ...rows[0] };
      rows[0].status = 'reserved';
      return snap;
    });
    const e = await err(svc.updateItem('p', { listPriceCents: 12345 }));
    expect(e.getStatus()).toBe(409);
    expect(e.code).toBe('CONFLICT');
    expect(rows[0]).toMatchObject({ status: 'reserved', listPriceCents: SEEDED_PRICE });
  });
});

describe("INV-SP-8 — `assertOperable(item, 'price')` (item-location.rules.ts, mismo allowlist que mark/status)", () => {
  const base = { ownerUserId: null, ownershipStatus: null } as const;
  it.each(['in_stock', 'listed'])('plataforma %s ⇒ "platform"', (status) => {
    expect(assertOperable({ ...base, ownerType: 'platform', status } as any, 'price')).toBe('platform');
  });
  it.each(['reserved', 'picking', 'shipped', 'delivered', 'lost', 'damaged', 'withdrawn'])(
    'plataforma %s ⇒ ITEM_NOT_ADJUSTABLE',
    (status) => {
      expect(() => assertOperable({ ...base, ownerType: 'platform', status } as any, 'price')).toThrow(
        BusinessException,
      );
    },
  );
  it('cliente en custodia liquidada ⇒ ITEM_NOT_ADJUSTABLE (sin rama de cliente)', () => {
    expect(() =>
      assertOperable(
        { ownerType: 'customer', ownerUserId: 'ana', ownershipStatus: 'settled', status: 'in_custody' } as any,
        'price',
      ),
    ).toThrow(BusinessException);
  });
});

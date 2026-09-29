import { Prisma } from '@prisma/client';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { BusinessException } from '../src/common/business.exception';

/**
 * 🔒 v1.80.3 §M4-SHIP.17.1 (2) (SEC-SHIP-A1, D-SHIP-6) — `PATCH /admin/inventory/items/:id` con
 * `status` gana la MISMA guarda de estado y de dueño que `move`/`mark` (`item-location.rules.ts`).
 *
 * *El defecto (leído por seguridad en production, `inventory.service.ts:2403-2407` de entonces):*
 * `{status:'in_stock'}` iba por un `update({ where: { id } })` plano ⇒ **sí existía** un
 * `lost → in_stock` (se borraba la merma firmada), un `picking → in_stock` (una pieza vendida y
 * cobrada volvía al estante) y un `in_custody → in_stock` (la carta de un cliente pasaba a ser de la
 * tienda). Norma: solo plataforma `in_stock | listed`; lectura → guarda (`422 ITEM_NOT_ADJUSTABLE`)
 * → escritura CONDICIONADA a lo leído (`count 0` ⇒ `409 CONFLICT`); los demás campos del mismo
 * `PATCH` en la MISMA transacción. `status:'listed'` sigue por el pipeline de v1.51 (ya guardado).
 * Invariante INV-SP-7: una pieza `lost | damaged` no vuelve a `in_stock | listed` por ningún verbo
 * del operador. Estas pruebas fallan contra el `updateItem` anterior.
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
  cardId: string;
};

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

function build(target: Row, opts: { activeWithdrawal?: boolean } = {}) {
  const rows: Row[] = [target];
  const log: string[] = [];
  const matches = (r: Row, where: Record<string, any>) =>
    Object.entries(where).every(([k, v]) => v === undefined || (r as any)[k] === v);
  const client = (inTx: boolean): any => ({
    $executeRaw: jest.fn(async () => 1),
    inventoryItem: {
      findUnique: jest.fn(async ({ where, include }: any) => {
        const r = rows.find((x) => x.id === where.id);
        if (!r) return null;
        log.push(`read${inTx ? '@tx' : ''}`);
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
        log.push(`update${inTx ? '@tx' : ''}`);
        Object.assign(r, data);
        return { ...r };
      }),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    shipmentItem: {
      findMany: jest.fn(async ({ where }: any) =>
        opts.activeWithdrawal && where.inventoryItemId.in.includes(target.id)
          ? [{ inventoryItemId: target.id, shipmentRequest: { id: 'sh-1', status: 'picking' } }]
          : [],
      ),
    },
    inventoryMovement: {
      create: jest.fn(async ({ data }: any) => {
        log.push(`movement${inTx ? '@tx' : ''}`);
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
  return { svc, prisma, tx, rows, log };
}

async function err(p: Promise<unknown>): Promise<BusinessException> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(BusinessException);
  return e as BusinessException;
}

const TERMINAL = ['shipped', 'delivered', 'lost', 'damaged', 'withdrawn'];

// =============================================================================================
describe('PATCH {status:"in_stock"} — pieza de PLATAFORMA (D-SHIP-6)', () => {
  it('listed → in_stock (despublicar): escribe dentro de la transacción, condicionado a lo leído', async () => {
    const { svc, rows, tx, log } = build(platform('listed'));
    const res: any = await svc.updateItem('p', { status: 'in_stock' });
    expect(rows[0].status).toBe('in_stock');
    expect(res.status).toBe('in_stock');
    expect(log.filter((l) => l.startsWith('update'))).toEqual(['update@tx']);
    expect(tx.inventoryItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'p', status: 'listed', ownerType: 'platform', ownerUserId: null }),
        data: expect.objectContaining({ status: 'in_stock' }),
      }),
    );
    // ⛔ Sin `InventoryMovement` para `listed ↔ in_stock` (visibilidad de catálogo, no movimiento físico).
    expect(log.some((l) => l.startsWith('movement'))).toBe(false);
  });

  it('in_stock → in_stock NO escribe `status`; los demás campos sí, en la misma escritura', async () => {
    const { svc, rows, tx } = build(platform('in_stock'));
    await svc.updateItem('p', { status: 'in_stock', certNumber: 'C-1' });
    expect(rows[0].status).toBe('in_stock');
    expect(rows[0].certNumber).toBe('C-1');
    const call = tx.inventoryItem.update.mock.calls[0][0];
    expect(call.data).toEqual({ certNumber: 'C-1' });
    expect(call.where).toMatchObject({ id: 'p', status: 'in_stock', ownerType: 'platform' });
  });

  it('listed → in_stock con otros campos: TODO en una sola escritura transaccional (todo o nada)', async () => {
    const { svc, rows, tx, log } = build(platform('listed'));
    await svc.updateItem('p', { status: 'in_stock', certNumber: 'C-2' });
    expect(rows[0]).toMatchObject({ status: 'in_stock', certNumber: 'C-2' });
    expect(log.filter((l) => l.startsWith('update'))).toEqual(['update@tx']);
    expect(tx.inventoryItem.update.mock.calls[0][0].data).toEqual({ status: 'in_stock', certNumber: 'C-2' });
  });

  it.each(['reserved', 'picking', ...TERMINAL])(
    '⛔ %s → in_stock ⇒ 422 ITEM_NOT_ADJUSTABLE {status, ownerType}, sin escribir (INV-SP-7 para lost/damaged)',
    async (status) => {
      const { svc, rows, tx, prisma } = build(platform(status));
      const e = await err(svc.updateItem('p', { status: 'in_stock' }));
      expect(e.code).toBe('ITEM_NOT_ADJUSTABLE');
      expect(e.getStatus()).toBe(422);
      expect(e.details).toMatchObject({ status, ownerType: 'platform' });
      expect(rows[0].status).toBe(status);
      expect(tx.inventoryItem.update).not.toHaveBeenCalled();
      expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
    },
  );

  it('⛔ picking → in_stock con otros campos: tampoco escribe los otros campos (todo o nada)', async () => {
    const { svc, rows, tx, prisma } = build(platform('picking'));
    await err(svc.updateItem('p', { status: 'in_stock', certNumber: 'C-3' }));
    expect(rows[0].certNumber).toBeNull();
    expect(tx.inventoryItem.update).not.toHaveBeenCalled();
    expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
  });

  it('⚠️ TOCTOU: la pieza cambia entre la lectura y la escritura ⇒ 409 CONFLICT, nada escrito', async () => {
    const { svc, rows, tx } = build(platform('listed'));
    // Entre la lectura de la guarda y el `update`, un checkout reserva la pieza.
    tx.inventoryItem.findUnique.mockImplementationOnce(async () => {
      const snap = { ...rows[0] };
      rows[0].status = 'reserved';
      return snap;
    });
    const e = await err(svc.updateItem('p', { status: 'in_stock', certNumber: 'C-4' }));
    expect(e.getStatus()).toBe(409);
    expect(e.code).toBe('CONFLICT');
    expect(rows[0]).toMatchObject({ status: 'reserved', certNumber: null });
  });

  it('pieza inexistente ⇒ 404', async () => {
    const { svc } = build(platform('in_stock'));
    expect((await err(svc.updateItem('fantasma', { status: 'in_stock' }))).getStatus()).toBe(404);
  });
});

// =============================================================================================
describe('PATCH {status:"in_stock"} — pieza DEL CLIENTE: nunca (D-SHIP-6)', () => {
  it.each([
    ['in_custody liquidada, fuera de retiro', {}, {}],
    ['in_custody, propiedad pending', { ownershipStatus: 'pending' as const }, {}],
    ['in_custody, en un retiro cobrado', {}, { activeWithdrawal: true }],
    ['picking (retiro cobrado)', { status: 'picking' }, {}],
    ['delivered', { status: 'delivered' }, {}],
    ['lost (INV-SP-7)', { status: 'lost' }, {}],
  ])('⛔ cliente %s ⇒ 422 ITEM_NOT_ADJUSTABLE {ownerType:"customer"}, sin escribir', async (_n, over, opts) => {
    const { svc, rows, tx, prisma } = build(customer(over), opts);
    const before = { ...rows[0] };
    const e = await err(svc.updateItem('c', { status: 'in_stock' }));
    expect(e.code).toBe('ITEM_NOT_ADJUSTABLE');
    expect(e.getStatus()).toBe(422);
    expect(e.details).toMatchObject({ status: before.status, ownerType: 'customer' });
    expect(rows[0]).toEqual(before);
    expect(tx.inventoryItem.update).not.toHaveBeenCalled();
    expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
    // Como `mark` tras D-SHIP-5: la guarda es por dueño; no se consulta el retiro (no hay rama cliente).
    expect(tx.shipmentItem.findMany).not.toHaveBeenCalled();
  });
});

// =============================================================================================
describe('PATCH — lo que NO cambia', () => {
  it('sin `status` en el body: la guarda no corre (acotada al cambio de estado); los campos se escriben', async () => {
    const { svc, rows } = build(platform('lost'));
    await svc.updateItem('p', { certNumber: 'C-5' });
    expect(rows[0]).toMatchObject({ status: 'lost', certNumber: 'C-5' });
  });

  it('status:"listed" sobre plataforma `picking` sigue por el pipeline de v1.51 ⇒ 422 ITEM_NOT_PUBLISHABLE', async () => {
    const { svc, rows } = build(platform('picking'));
    const e = await err(svc.updateItem('p', { status: 'listed' }));
    expect(e.code).toBe('ITEM_NOT_PUBLISHABLE');
    expect(rows[0].status).toBe('picking');
  });
});

import { InventoryService } from '../src/modules/inventory/inventory.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';
import {
  INVENTORY_PUBLISH_PORT,
  InventoryPublishPort,
} from '../src/modules/inventory/inventory-publish.port';
import * as fs from 'fs';
import * as path from 'path';

/**
 * v1.51.18 — **BL-25: `INVENTORY_PUBLISH_PORT`, el puerto de DISPARO.**
 *
 * Lo que estos tests fijan, y el primero es el que define lo que el puerto ES:
 *  1. **⚠️ Es un DISPARO, no una escritura.** El llamador dice *«reevalúa»*, **jamás «publica»**: la
 *     firma **no acepta estado destino, ni precio, ni `status`**, así que un llamador con un bug —o
 *     malicioso— **no puede publicar una pieza impublicable**. Se verifica **por la forma**, que es la
 *     única manera de verificar una ausencia.
 *  2. **Idempotente y no-op sobre lo impublicable**: llamarlo de más no hace nada.
 *  3. **No lanza por una pieza**: devuelve qué pasó con cada una, para que el llamador registre
 *     **sin re-derivar** la regla.
 *  4. **Un solo cuerpo de publicación**: el disparador (b) —ubicación— **no pasa por el puerto**, pero
 *     corre exactamente el mismo pipeline.
 */

const settings = { getNumber: jest.fn() } as unknown as SettingsService;

interface ItemOpts {
  id: string;
  locationId?: string | null;
  status?: string;
  ownerType?: string;
  priced?: boolean;
}

function item(o: ItemOpts) {
  return {
    id: o.id,
    folio: `INV-${o.id}`,
    cardId: `card-${o.id}`,
    card: { id: `card-${o.id}`, rarity: 'Rare', rarityCanonical: 'rare' },
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'normal',
    ownerType: o.ownerType ?? 'platform',
    status: o.status ?? 'in_stock',
    locationId: o.locationId === undefined ? null : o.locationId,
    listPriceCents: null,
    sealedProductId: null,
    sealedSubtype: null,
    acquisitionType: 'buylist',
    createdAt: new Date('2026-09-01T00:00:00Z'),
    __priced: o.priced === true,
  };
}

function build(items: ReturnType<typeof item>[]) {
  const rows = items;
  const prisma: any = {
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
    inventoryMovement: { create: jest.fn(async () => ({})) },
    pendingPriceEntry: { findMany: jest.fn(async () => []) },
  };
  const pricing = {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    loadSealedSpreads: jest.fn(async () => ({ spreadPctBySubtype: {}, fallbackPct: 0, sourceOn: false })),
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    gradeKeyFor: jest.fn(() => 'raw:NM'),
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
  return { svc, prisma, pricing, rows, port: svc as unknown as InventoryPublishPort };
}

// =============================================================================================
describe('⚠️⚠️ (1) es un puerto de DISPARO: la autoridad NO cruza la frontera', () => {
  it('la firma acepta SOLO ids — no hay estado destino, ni precio, ni `status` que pasar', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'modules', 'inventory', 'inventory-publish.port.ts'),
      'utf8',
    );
    const sig = src.slice(src.indexOf('reevaluateForPublication('));
    const params = sig.slice(sig.indexOf('(') + 1, sig.indexOf(')'));
    // Verificar una AUSENCIA solo se puede hacer por la forma. Si alguien añadiera un parámetro de
    // estado, el puerto dejaría de ser de disparo y pasaría a ser de escritura — que es justo lo que
    // §4.39f prohíbe exportar.
    expect(params).toBe('inventoryItemIds: string[]');
    expect(params).not.toMatch(/status|price|listed|publish[A-Z]/i);
  });

  it('⚠️ una pieza IMPUBLICABLE no se publica por mucho que la disparen', async () => {
    const { port, rows } = build([
      item({ id: 'a', locationId: 'loc-1', priced: true, status: 'reserved' }),
    ]);
    const [res] = await port.reevaluateForPublication(['a']);
    // Las guardas están del otro lado: el llamador **no puede** forzar esto.
    expect(res.outcome).toBe('not_publishable');
    expect(rows[0].status).toBe('reserved');
  });

  it('⚠️ inventario que NO es de plataforma tampoco se publica (nunca se vende lo ajeno)', async () => {
    const { port, rows } = build([
      item({ id: 'a', locationId: 'loc-1', priced: true, ownerType: 'customer', status: 'in_custody' }),
    ]);
    const [res] = await port.reevaluateForPublication(['a']);
    expect(res.outcome).toBe('not_publishable');
    expect(rows[0].status).toBe('in_custody');
  });

  it('sin precio resoluble NO publica, pero SÍ escala: un pendiente visible', async () => {
    const { port, pricing, rows } = build([item({ id: 'a', locationId: 'loc-1' })]);
    const [res] = await port.reevaluateForPublication(['a']);
    expect(res.outcome).toBe('price_pending');
    expect(res.missing).toEqual(['price']);
    expect(res.pendingPriceEntryId).toBe('ppe-1');
    expect(pricing.settlePendingForVariant).toHaveBeenCalled();
    expect(rows[0].status).toBe('in_stock');
  });

  it('⚠️ sin UBICACIÓN no publica y NO escala nada: el hueco es de captura, no de mercado', async () => {
    const { port, pricing } = build([item({ id: 'a', priced: true })]);
    const [res] = await port.reevaluateForPublication(['a']);
    expect(res.outcome).toBe('missing_location');
    // Escalar aquí ensuciaría la cola de M2 con piezas cuyo precio SÍ resuelve.
    expect(pricing.settlePendingForVariant).not.toHaveBeenCalled();
  });

  it('con todo en orden publica, y por la guarda ATÓMICA', async () => {
    const { port, prisma, rows } = build([item({ id: 'a', locationId: 'loc-1', priced: true })]);
    const [res] = await port.reevaluateForPublication(['a']);
    expect(res.outcome).toBe('published');
    expect(res.missing).toEqual([]);
    expect(rows[0].status).toBe('listed');
    expect(prisma.inventoryItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['in_stock', 'listed'] } }),
      }),
    );
  });
});

// =============================================================================================
describe('⚠️ (2) idempotente, en lote, y no-op sobre lo que ya está', () => {
  it('una pieza ya `listed` es un no-op: no se re-publica ni se re-resuelve', async () => {
    const { port, prisma, pricing } = build([
      item({ id: 'a', locationId: 'loc-1', priced: true, status: 'listed' }),
    ]);
    const [res] = await port.reevaluateForPublication(['a']);
    expect(res.outcome).toBe('already_listed');
    expect(prisma.inventoryItem.updateMany).not.toHaveBeenCalled();
    expect(pricing.settlePendingForVariant).not.toHaveBeenCalled();
  });

  it('llamarlo DOS veces deja el mismo estado (idempotencia observable)', async () => {
    const { port, rows } = build([item({ id: 'a', locationId: 'loc-1', priced: true })]);
    expect((await port.reevaluateForPublication(['a']))[0].outcome).toBe('published');
    expect((await port.reevaluateForPublication(['a']))[0].outcome).toBe('already_listed');
    expect(rows[0].status).toBe('listed');
  });

  it('en LOTE: una pieza mala no impide que las buenas se publiquen', async () => {
    const { port, rows } = build([
      item({ id: 'a', locationId: 'loc-1', priced: true }),
      item({ id: 'b', locationId: 'loc-1' }),
      item({ id: 'c', locationId: 'loc-1', priced: true, status: 'reserved' }),
      item({ id: 'd', priced: true }),
    ]);
    const res = await port.reevaluateForPublication(['a', 'b', 'c', 'd']);
    const by = new Map(res.map((r) => [r.inventoryItemId, r.outcome]));
    expect(by.get('a')).toBe('published');
    expect(by.get('b')).toBe('price_pending');
    expect(by.get('c')).toBe('not_publishable');
    expect(by.get('d')).toBe('missing_location');
    expect(rows[0].status).toBe('listed');
  });

  it('un id inexistente devuelve `not_found` — NO lanza y no tumba el lote', async () => {
    const { port } = build([item({ id: 'a', locationId: 'loc-1', priced: true })]);
    const res = await port.reevaluateForPublication(['a', 'fantasma']);
    expect(res.find((r) => r.inventoryItemId === 'fantasma')?.outcome).toBe('not_found');
    expect(res.find((r) => r.inventoryItemId === 'a')?.outcome).toBe('published');
  });

  it('ids duplicados o vacíos no producen trabajo duplicado ni consultas de más', async () => {
    const { port, prisma } = build([item({ id: 'a', locationId: 'loc-1', priced: true })]);
    const res = await port.reevaluateForPublication(['a', 'a', '', 'a']);
    expect(res).toHaveLength(1);
    expect(prisma.inventoryItem.updateMany).toHaveBeenCalledTimes(1);
  });

  it('lista vacía ⇒ no toca la BD siquiera', async () => {
    const { port, prisma } = build([item({ id: 'a' })]);
    expect(await port.reevaluateForPublication([])).toEqual([]);
    expect(prisma.inventoryItem.findMany).not.toHaveBeenCalled();
  });
});

// =============================================================================================
describe('⚠️ (3) UN solo cuerpo de publicación: el disparador (b) no duplica la regla', () => {
  it('`move` y el puerto producen EXACTAMENTE el mismo desenlace', async () => {
    const viaMove = build([item({ id: 'a', priced: true })]);
    await viaMove.svc.moveItem('a', { toLocationId: 'loc-1' }, 'op-1');

    const viaPort = build([item({ id: 'a', locationId: 'loc-1', priced: true })]);
    await viaPort.port.reevaluateForPublication(['a']);

    expect(viaMove.rows[0].status).toBe('listed');
    expect(viaPort.rows[0].status).toBe('listed');
  });

  it('⚠️ el disparador (b) NO usa el puerto: `inventory` no le da la vuelta a su propio módulo', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'modules', 'inventory', 'inventory.service.ts'),
      'utf8',
    );
    // `inventory` no se inyecta su propio token: llamaría a su propia puerta desde fuera (§4.39m.5).
    expect(src).not.toContain(`Inject(${INVENTORY_PUBLISH_PORT})`);
    expect(src).not.toContain("@Inject('INVENTORY_PUBLISH_PORT')");
  });

  it('el pipeline es el de siempre: sin precio no se lista, con precio sí (por las dos vías)', async () => {
    const a = build([item({ id: 'a' })]);
    await a.svc.moveItem('a', { toLocationId: 'loc-1' }, 'op-1');
    expect(a.rows[0].status).toBe('in_stock');

    const b = build([item({ id: 'a', locationId: 'loc-1' })]);
    expect((await b.port.reevaluateForPublication(['a']))[0].outcome).toBe('price_pending');
    expect(b.rows[0].status).toBe('in_stock');
  });
});

// =============================================================================================
describe('⚠️ (4) la RED: lo que el puerto deja atrás sigue en `pending-publish`', () => {
  it('un disparo que no publica deja la pieza EN LA COLA — nunca invisible', async () => {
    const { svc, port } = build([item({ id: 'a', locationId: 'loc-1' })]);
    await port.reevaluateForPublication(['a']);
    const cola: any = await svc.pendingPublish({ page: 1, pageSize: 20 });
    // *La cola ES la red del disparo* ⇒ no se retira ni se estrecha sin sustituirla (§4.39m.5).
    expect(cola.total).toBe(1);
    expect(cola.data[0].missing).toEqual(['price']);
  });

  it('y lo que SÍ publica sale de la cola', async () => {
    // Empieza EN la cola (le falta la caja) y sale cuando el disparo la encuentra completa.
    const { svc, port, rows } = build([item({ id: 'a', priced: true })]);
    const antes: any = await svc.pendingPublish({ page: 1, pageSize: 20 });
    expect(antes.total).toBe(1);
    expect(antes.data[0].missing).toEqual(['location']);
    (rows[0] as Record<string, unknown>).locationId = 'loc-1';
    expect((await port.reevaluateForPublication(['a']))[0].outcome).toBe('published');
    expect((await svc.pendingPublish({ page: 1, pageSize: 20 })).total).toBe(0);
  });
});

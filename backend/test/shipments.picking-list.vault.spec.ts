import { ShipmentsService } from '../src/modules/shipments/shipments.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { VaultPreparationOrderDTO } from '../src/modules/vault/vault-preparation.view';
import { vaultReadMocks, vpItem, vpRow } from './helpers/vault-placement-fixtures';

/**
 * ⭐⭐ API_CONTRACT §M4-VAULT.3/.4 — la cubeta `vault` de «Pedidos a preparar» (mitad UNIDAD).
 *
 * La cola lee DOS fuentes y `PreparationOrderDTO` es una unión discriminada por `destination`. Aquí:
 * la forma de la fila `vault`, `placeability` (el predicado `P` en lectura), los conteos de preparación,
 * la propuesta de cajón (`customerDrawers`), el nombre (prueba 26), las invariantes (409 de la cola
 * entera) y el orden de la cola mezclada. La mitad contra Postgres real:
 * `test/integration/vault-placement-verbs.e2e-spec.ts`.
 */

function makeService(
  placements: ReturnType<typeof vpRow>[],
  opts: Parameters<typeof vaultReadMocks>[1] = {},
  shipments: any[] = [],
) {
  const prisma = {
    ...vaultReadMocks(placements, opts),
    shipmentRequest: { findMany: jest.fn().mockResolvedValue(shipments) },
  };
  const service = new ShipmentsService(
    prisma as unknown as PrismaService,
    {} as SettingsService,
    {} as StripeService,
  );
  return { prisma, service };
}

async function onlyVault(
  placements: ReturnType<typeof vpRow>[],
  opts: Parameters<typeof vaultReadMocks>[1] = {},
): Promise<VaultPreparationOrderDTO> {
  const { service } = makeService(placements, opts);
  const res = await service.pickingList(undefined, 'vault');
  expect(res.data).toHaveLength(1);
  expect(res.data[0].destination).toBe('vault');
  return res.data[0] as VaultPreparationOrderDTO;
}

const DRAWER_X = { id: 'loc-x', label: 'C02-F01-S01', zone: 'customer_custody' };
const DRAWER_Z = { id: 'loc-z', label: 'C01-F09-S09', zone: 'customer_custody' };

describe('fila `vault` — la forma (§M4-VAULT.3)', () => {
  it('lleva placementId, orderId, requestedAt = createdAt, customer inequívoco y SIN shipTo', async () => {
    const o = await onlyVault([vpRow()]);
    expect(o).toMatchObject({
      destination: 'vault',
      placementId: 'vp-1',
      orderId: 'ord-v1',
      orderNumber: 'TCG-000900',
      requestedAt: '2026-09-20T10:00:00.000Z',
      customer: {
        userId: 'u-1',
        email: 'maria@example.com',
        fullName: 'María de la Luz Pérez Gómez',
        lastName: 'Gómez',
      },
      suggestedLocation: { source: 'none' },
      preparation: { status: 'in_progress', total: 1, pending: 1, picked: 0, missing: 0, blocked: 0 },
    });
    expect(o).not.toHaveProperty('shipTo');
    expect(o).not.toHaveProperty('shipmentId');
    expect(o.items[0]).toEqual({
      placementItemId: 'vpi-inv-1',
      orderItemId: 'oi-inv-1',
      inventoryItemId: 'inv-1',
      folio: 'F-inv-1',
      quantity: 1,
      card: { name: 'Pikachu', setName: 'Base', finish: 'normal', conditionLabel: 'NM', imageSmallUrl: null },
      currentLocation: { kind: 'assigned', label: 'C01-F01-S01' },
      currentZone: 'platform_stock',
      prepStatus: 'pending',
      placeability: { kind: 'placeable' },
    });
  });

  it('pieza sin ubicación ⇒ currentLocation unassigned y currentZone null', async () => {
    const o = await onlyVault([vpRow({ items: [vpItem({ location: null })] })]);
    expect(o.items[0].currentLocation).toEqual({ kind: 'unassigned' });
    expect(o.items[0].currentZone).toBeNull();
  });

  it('orderNumber en blanco ⇒ null (nullIfBlank, misma grafía que ship)', async () => {
    const o = await onlyVault([vpRow({ orderNumber: '  ' })]);
    expect(o.orderNumber).toBeNull();
  });

  it('solo colocaciones `pending` (el `where` de la fuente) y orden createdAt asc en el motor', async () => {
    const { prisma, service } = makeService([]);
    await service.pickingList();
    const arg = (prisma.vaultPlacement.findMany as jest.Mock).mock.calls[0][0];
    expect(arg.where).toEqual({ status: 'pending' });
    expect(arg.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
  });

  it('`?date=` se aplica a VaultPlacement.createdAt (misma ventana de día UTC)', async () => {
    const { prisma, service } = makeService([]);
    await service.pickingList('2026-09-20');
    expect((prisma.vaultPlacement.findMany as jest.Mock).mock.calls[0][0].where).toEqual({
      status: 'pending',
      createdAt: { gte: new Date('2026-09-20T00:00:00.000Z'), lt: new Date('2026-09-21T00:00:00.000Z') },
    });
  });
});

describe('placeability — el predicado P en lectura (§M4-VAULT.3/.5)', () => {
  it('pieza en retiro COBRADO (picking|guia|enviado) ⇒ blocked/in_withdrawal', async () => {
    const o = await onlyVault([vpRow()], {
      withdrawals: [{ inventoryItemId: 'inv-1', shipmentRequest: { id: 'sh-1', status: 'guia' } }],
    });
    expect(o.items[0].placeability).toEqual({ kind: 'blocked', reason: 'in_withdrawal' });
  });

  it('la consulta de retiros pide SOLO picking|guia|enviado (⛔ `solicitado` no bloquea)', async () => {
    const { prisma, service } = makeService([vpRow()]);
    await service.pickingList();
    const where = (prisma.shipmentItem.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.shipmentRequest).toEqual({ status: { in: ['picking', 'guia', 'enviado'] } });
    expect(where.inventoryItemId).toEqual({ in: ['inv-1'] });
  });

  it.each([
    ['status withdrawn', { status: 'withdrawn' }],
    ['de otro cliente', { ownerUserId: 'u-otro' }],
    ['de la plataforma (contracargo)', { ownerType: 'platform', ownerUserId: null, ownershipStatus: null }],
    ['titularidad pending (anomalía de settle)', { ownershipStatus: 'pending', status: 'reserved' }],
  ])('%s ⇒ blocked/not_in_custody', async (_n, over) => {
    const o = await onlyVault([vpRow({ items: [vpItem(over as any)] })]);
    expect(o.items[0].placeability).toEqual({ kind: 'blocked', reason: 'not_in_custody' });
  });

  it('⛔ una carta bloqueada NO se omite: se muestra (el operador no la busca)', async () => {
    const o = await onlyVault([
      vpRow({ items: [vpItem({ id: 'a' }), vpItem({ id: 'b', status: 'lost' })] }),
    ]);
    expect(o.items.map((i) => i.inventoryItemId).sort()).toEqual(['a', 'b']);
  });
});

describe('preparation — conteos y sello (§M4-VAULT.3/.10)', () => {
  it('partición: picked/missing por su marca; pending = colocable sin marcar; blocked = bloqueada sin marcar', async () => {
    const o = await onlyVault([
      vpRow({
        items: [
          vpItem({ id: 'p1', prepStatus: 'picked' }),
          vpItem({ id: 'm1', prepStatus: 'missing' }),
          vpItem({ id: 'n1' }),
          vpItem({ id: 'b1', status: 'lost' }),
        ],
      }),
    ]);
    expect(o.preparation).toEqual({
      status: 'in_progress',
      total: 4,
      pending: 1,
      picked: 1,
      missing: 1,
      blocked: 1,
    });
  });

  it('preparada ⇒ status prepared con preparedAt y preparedBy (name = nullIfBlank del OPERADOR)', async () => {
    const o = await onlyVault(
      [vpRow({ preparedAt: new Date('2026-09-21T09:00:00Z'), preparedByUserId: 'op-9', items: [vpItem({ prepStatus: 'picked' })] })],
      { operators: [{ id: 'op-9', name: 'Oper Nueve' }] },
    );
    expect(o.preparation).toEqual({
      status: 'prepared',
      preparedAt: '2026-09-21T09:00:00.000Z',
      preparedBy: { userId: 'op-9', name: 'Oper Nueve' },
      total: 1,
      pending: 0,
      picked: 1,
      missing: 0,
      blocked: 0,
    });
  });
});

describe('suggestedLocation — un cliente = un cajón (§M4-VAULT.4, prueba 5 mitad unidad)', () => {
  it('0 cajones ⇒ none', async () => {
    const o = await onlyVault([vpRow()]);
    expect(o.suggestedLocation).toEqual({ source: 'none' });
  });

  it('1 cajón ⇒ existing_customer_vault con zona y conteo', async () => {
    const o = await onlyVault([vpRow()], {
      drawerGroups: [{ ownerUserId: 'u-1', locationId: 'loc-x', _count: { _all: 3 } }],
      locations: [DRAWER_X],
    });
    expect(o.suggestedLocation).toEqual({
      source: 'existing_customer_vault',
      location: { id: 'loc-x', label: 'C02-F01-S01', zone: 'customer_custody', customerPieceCount: 3 },
    });
  });

  it('≥2 cajones ⇒ multiple_drawers con TODOS, por label (⛔ por nº de piezas), SIN propuesta', async () => {
    const o = await onlyVault([vpRow()], {
      drawerGroups: [
        { ownerUserId: 'u-1', locationId: 'loc-x', _count: { _all: 9 } },
        { ownerUserId: 'u-1', locationId: 'loc-z', _count: { _all: 1 } },
      ],
      locations: [DRAWER_X, DRAWER_Z],
    });
    expect(o.suggestedLocation).toEqual({
      source: 'multiple_drawers',
      locations: [
        { id: 'loc-z', label: 'C01-F09-S09', zone: 'customer_custody', customerPieceCount: 1 },
        { id: 'loc-x', label: 'C02-F01-S01', zone: 'customer_custody', customerPieceCount: 9 },
      ],
    });
    expect(o.suggestedLocation).not.toHaveProperty('location');
  });

  it('⚠️ el filtro de ZONA es portante y `isActive` NO filtra (el where de customerDrawers)', async () => {
    const { prisma, service } = makeService([vpRow()]);
    await service.pickingList();
    const where = (prisma.inventoryItem.groupBy as jest.Mock).mock.calls[0][0].where;
    expect(where).toEqual({
      ownerType: 'customer',
      ownerUserId: { in: ['u-1'] },
      ownershipStatus: 'settled',
      status: 'in_custody',
      location: { zone: 'customer_custody' },
    });
  });

  it('cajón con etiqueta en blanco NO cuenta (regla 5)', async () => {
    const o = await onlyVault([vpRow()], {
      drawerGroups: [{ ownerUserId: 'u-1', locationId: 'loc-b', _count: { _all: 1 } }],
      locations: [{ id: 'loc-b', label: '  ', zone: 'customer_custody' }],
    });
    expect(o.suggestedLocation).toEqual({ source: 'none' });
  });

  it('carga agrupada por cliente: UNA consulta de cajones para varias filas (sin N+1)', async () => {
    const { prisma, service } = makeService([
      vpRow({ id: 'vp-a', userId: 'u-a' }),
      vpRow({ id: 'vp-b', userId: 'u-b' }),
    ]);
    await service.pickingList();
    expect(prisma.inventoryItem.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.shipmentItem.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.vaultPlacement.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('prueba 26 — «Nombre y apellido»', () => {
  it('cliente derived ⇒ fullName null, lastName null, email presente', async () => {
    const o = await onlyVault([vpRow({ name: 'juan.perez95', nameSource: 'derived', email: 'juan.perez95@gmail.com' })]);
    expect(o.customer).toEqual({
      userId: 'u-1',
      email: 'juan.perez95@gmail.com',
      fullName: null,
      lastName: null,
    });
  });

  it('nombre compuesto ⇒ fullName IDÉNTICO y completo (⛔ recortado a un token ni reordenado)', async () => {
    const o = await onlyVault([vpRow({ name: 'María de la Luz Pérez Gómez', nameSource: 'user' })]);
    expect(o.customer.fullName).toBe('María de la Luz Pérez Gómez');
  });

  it('⛔ asimetría declarada: la fuente `ship` NO lee nameSource (sigue emitiendo User.name)', async () => {
    const { prisma, service } = makeService([]);
    await service.pickingList();
    const include = (prisma.shipmentRequest.findMany as jest.Mock).mock.calls[0][0].include;
    expect(include.user).toEqual({ select: { name: true } });
  });
});

describe('invariantes de la fila `vault` — 409 de la cola ENTERA (§M4-VAULT.3)', () => {
  it.each([
    ['fulfillmentMode direct_ship', { fulfillmentMode: 'direct_ship' }],
    ['userId null', { userId: null }],
  ])('%s ⇒ 409 CONFLICT con el placementId en el mensaje, en CUALQUIER cubeta', async (_n, over) => {
    for (const dest of [undefined, 'vault', 'ship']) {
      const { service } = makeService([vpRow({ id: 'vp-rota', ...(over as any) })]);
      await expect(service.pickingList(undefined, dest)).rejects.toMatchObject({
        code: 'CONFLICT',
        message: expect.stringContaining('vp-rota'),
      });
    }
  });
});

describe('orden de la cola MEZCLADA (§M4-VAULT.3)', () => {
  const ship = (id: string, at: string) => ({
    id,
    orderId: null,
    requestedAt: new Date(at),
    addressSnapshot: { line1: 'x', city: 'c', state: 's', postalCode: '1', country: 'MX', phone: '1' },
    order: null,
    user: { name: 'Cliente Envío' },
    items: [],
  });

  it('requestedAt asc sobre las dos fuentes; empate exacto ⇒ ship antes que vault; dentro, por id en unidades de código', async () => {
    const T = '2026-09-20T10:00:00.000Z';
    const { service } = makeService(
      [
        vpRow({ id: 'vp-b', createdAt: new Date(T) }),
        vpRow({ id: 'vp-a', createdAt: new Date(T) }),
        vpRow({ id: 'vp-old', createdAt: new Date('2026-09-19T00:00:00.000Z') }),
      ],
      {},
      [ship('sh-z', T), ship('sh-new', '2026-09-21T00:00:00.000Z'), ship('sh-y', T)],
    );
    const res = await service.pickingList();
    expect(
      res.data.map((o) => (o.destination === 'ship' ? o.shipmentId : o.placementId)),
    ).toEqual(['vp-old', 'sh-y', 'sh-z', 'vp-a', 'vp-b', 'sh-new']);
  });

  it('las cartas de la fila `vault` van por ubicación (§M4P-ORDER), unassigned al final', async () => {
    const o = await onlyVault([
      vpRow({
        items: [
          vpItem({ id: 'sin', location: null }),
          vpItem({ id: 'b', location: { id: 'l2', label: 'C02', zone: 'platform_stock' } }),
          vpItem({ id: 'a', location: { id: 'l1', label: 'C01', zone: 'platform_stock' } }),
        ],
      }),
    ]);
    expect(o.items.map((i) => i.inventoryItemId)).toEqual(['a', 'b', 'sin']);
  });
});

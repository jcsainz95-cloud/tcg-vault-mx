import { ShipmentsService } from '../src/modules/shipments/shipments.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { StripeService } from '../src/modules/payments/stripe.service';

function build(shipment: any, itemStatus: string, fulfillmentMode: string | null = 'direct_ship') {
  const state = { status: itemStatus };
  const movements: any[] = [];
  const tx: any = {
    shipmentRequest: { update: jest.fn(async ({ data }: any) => ({ id: shipment.id, ...data })) },
    shipmentItem: { findMany: jest.fn(async () => [{ inventoryItemId: 'item-1' }]) },
    inventoryItem: {
      findUnique: jest.fn(async () => ({ id: 'item-1', status: state.status })),
      update: jest.fn(async ({ data }: any) => {
        state.status = data.status;
        return {};
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (where.status && state.status !== where.status) return { count: 0 };
        state.status = data.status;
        return { count: 1 };
      }),
    },
    inventoryMovement: {
      create: jest.fn(async ({ data }: any) => {
        movements.push(data);
        return data;
      }),
    },
  };
  const prisma: any = {
    shipmentRequest: { findUnique: jest.fn(async () => shipment) },
    // v1.21.2 (D4): el comportamiento se decide leyendo `Order.fulfillmentMode` de la orden
    // vinculada, no por la mera presencia de `orderId`.
    order: {
      findUnique: jest.fn(async () => (fulfillmentMode === null ? null : { fulfillmentMode })),
    },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  const svc = new ShipmentsService(
    prisma as PrismaService,
    {} as SettingsService,
    {} as StripeService,
  );
  return { svc, tx, prisma, movements, state };
}

const guestShipment = (status: string) => ({ id: 'shp-guest', orderId: 'order-1', userId: null, status });
const vaultShipment = (status: string) => ({ id: 'shp-vault', orderId: null, userId: 'user-1', status });

/**
 * M4 con DOS naturalezas (§M4 v1.21 / ARCHITECTURE §4.21c-d): misma cola, misma máquina de
 * estados, misma captura de guía; lo único que ramifica es la transición terminal del item.
 */
describe('ShipmentsService.updateStatus — envío DIRECTO de invitado (orderId != null)', () => {
  it('al pasar a `enviado`: el item va picking → shipped (+ movimiento)', async () => {
    const { svc, state, movements } = build(guestShipment('guia'), 'picking');
    await svc.updateStatus('shp-guest', 'enviado');
    expect(state.status).toBe('shipped');
    expect(movements[0]).toMatchObject({
      itemId: 'item-1',
      fromStatus: 'picking',
      toStatus: 'shipped',
      reason: 'sale',
    });
  });

  it('al pasar a `entregado`: el item va shipped → delivered, NUNCA `withdrawn`', async () => {
    const { svc, state, movements } = build(guestShipment('enviado'), 'shipped');
    await svc.updateStatus('shp-guest', 'entregado');
    expect(state.status).toBe('delivered');
    expect(state.status).not.toBe('withdrawn');
    expect(movements[0]).toMatchObject({ fromStatus: 'shipped', toStatus: 'delivered', reason: 'sale' });
    // `withdrawal` mentiría en los reportes de custodia: este pedido nunca estuvo en bóveda.
    expect(movements.some((m) => m.reason === 'withdrawal')).toBe(false);
  });

  it('el item conserva su titularidad de PLATAFORMA en ambas transiciones', async () => {
    const { svc, tx } = build(guestShipment('guia'), 'picking');
    await svc.updateStatus('shp-guest', 'enviado');
    const data = tx.inventoryItem.updateMany.mock.calls[0][0].data;
    expect(data).toEqual({ status: 'shipped' });
    expect(data).not.toHaveProperty('ownerType');
    expect(data).not.toHaveProperty('ownerUserId');
  });

  it('es idempotente: una pieza que ya avanzó no duplica movimiento', async () => {
    const { svc, movements } = build(guestShipment('enviado'), 'delivered');
    await svc.updateStatus('shp-guest', 'entregado');
    expect(movements).toHaveLength(0);
  });

  it('las etapas intermedias (picking→guia) NO tocan el inventario', async () => {
    const { svc, movements, state } = build(guestShipment('picking'), 'picking');
    await svc.updateStatus('shp-guest', 'guia');
    expect(movements).toHaveLength(0);
    expect(state.status).toBe('picking');
  });

  it('respeta la misma máquina de estados (transición inválida ⇒ CONFLICT)', async () => {
    const { svc } = build(guestShipment('picking'), 'picking');
    await expect(svc.updateStatus('shp-guest', 'entregado')).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('D4 — el discriminador canónico es `Order.fulfillmentMode` (§4.21d, caso viii de §4.21h)', () => {
  it('lee el modo de la ORDEN vinculada, no la mera presencia de `orderId`', async () => {
    const { svc, prisma } = build(guestShipment('guia'), 'picking');
    await svc.updateStatus('shp-guest', 'enviado');
    expect(prisma.order.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'order-1' } }),
    );
  });

  it('un `fulfillmentMode` no soportado LANZA: nunca cae en la rama de envío directo', async () => {
    // `vault` con `orderId != null` es combinación imposible por invariante: corrupción de datos.
    const { svc, movements, state } = build(guestShipment('guia'), 'picking', 'vault');
    await expect(svc.updateStatus('shp-guest', 'enviado')).rejects.toMatchObject({ code: 'CONFLICT' });
    // Y NO se aplicó ninguna transición "por si acaso".
    expect(movements).toHaveLength(0);
    expect(state.status).toBe('picking');
  });

  it('si la orden vinculada no existe, también lanza (no asume envío directo)', async () => {
    const { svc } = build(guestShipment('guia'), 'picking', null);
    await expect(svc.updateStatus('shp-guest', 'enviado')).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('un retiro de bóveda (`orderId == null`) NI SIQUIERA consulta la orden', async () => {
    const { svc, prisma } = build(vaultShipment('enviado'), 'in_custody');
    await svc.updateStatus('shp-vault', 'entregado');
    expect(prisma.order.findUnique).not.toHaveBeenCalled();
  });
});

describe('ShipmentsService.updateStatus — retiro de BÓVEDA (orderId == null) — SIN CAMBIOS v1.17', () => {
  it('al pasar a `entregado`: in_custody → withdrawn con reason `withdrawal`', async () => {
    const { svc, state, movements } = build(vaultShipment('enviado'), 'in_custody');
    await svc.updateStatus('shp-vault', 'entregado');
    expect(state.status).toBe('withdrawn');
    expect(movements[0]).toMatchObject({ toStatus: 'withdrawn', reason: 'withdrawal' });
  });

  it('al pasar a `enviado` NO toca el item (solo `entregado` escribe, como en v1.17)', async () => {
    const { svc, state, movements } = build(vaultShipment('guia'), 'in_custody');
    await svc.updateStatus('shp-vault', 'enviado');
    expect(state.status).toBe('in_custody');
    expect(movements).toHaveLength(0);
  });

  it('nunca marca `delivered` un retiro de bóveda', async () => {
    const { svc, movements } = build(vaultShipment('enviado'), 'in_custody');
    await svc.updateStatus('shp-vault', 'entregado');
    expect(movements.some((m) => m.toStatus === 'delivered')).toBe(false);
  });
});

describe('GET /shipments — un envío de invitado (userId=null) no es de nadie (riesgo #1 de M-25)', () => {
  function buildRead(shipment: any) {
    const prisma: any = {
      shipmentRequest: {
        findUnique: jest.fn(async () => shipment),
        findMany: jest.fn(async ({ where }: any) => {
          // Simula el filtro POSITIVO de Postgres: `userId = X` nunca casa con NULL.
          return [shipment].filter((s) => s.userId === where.userId);
        }),
      },
    };
    const svc = new ShipmentsService(prisma as PrismaService, {} as SettingsService, {} as StripeService);
    return { svc, prisma };
  }

  it('GET /shipments/:id de un envío de invitado ⇒ NOT_FOUND para cualquier cliente', async () => {
    const { svc } = buildRead({ id: 'shp-guest', userId: null, orderId: 'order-1', items: [] });
    await expect(svc.getMine('user-1', 'shp-guest')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('GET /shipments filtra POSITIVAMENTE por userId: el de invitado no aparece', async () => {
    const { svc, prisma } = buildRead({ id: 'shp-guest', userId: null, orderId: 'order-1', items: [] });
    const res = await svc.listMine('user-1');
    expect(res.data).toEqual([]);
    expect(prisma.shipmentRequest.findMany.mock.calls[0][0].where).toEqual({ userId: 'user-1' });
    // Nunca una consulta del tipo "userId distinto de".
    expect(JSON.stringify(prisma.shipmentRequest.findMany.mock.calls[0][0].where)).not.toContain('not');
  });

  it('un userId vacío no degenera en "traer todo"', async () => {
    const { svc } = buildRead({ id: 'shp-guest', userId: null, orderId: 'order-1', items: [] });
    await expect(svc.listMine('')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(svc.getMine('', 'shp-guest')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

/**
 * 🔒💰 C-B2 — aislamiento del pago (API_CONTRACT §MKT.H.6/.11). La medición NUNCA puede hacer fallar, bloquear ni cambiar
 * el pago ni la solicitud:
 *  (1) con `enqueuePurchase` LANZANDO, `onPaymentSucceeded` liquida igual (CAS ganado, piezas movidas) y no relanza —
 *      en las dos ramas (bóveda y `direct_ship`);
 *  (2) el encolado ocurre DESPUÉS del commit de la liquidación (fuera de `$transaction`) y después de `AV-2`;
 *  (3) el perdedor de la carrera (`settled = false`) no encola;
 *  (4) `POST /checkout/session` / `/checkout/guest/session` / `POST /buylist/requests`: con el contexto o el encolado
 *      lanzando, la respuesta es la misma (201); `measurement` basura pasa el `ValidationPipe` sin 400 y da lo mismo que sin él.
 * Canario: mover el encolado dentro del `$transaction` o quitar el `try/catch` ⇒ rojo.
 */
import { ValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { OrdersController } from '../src/modules/orders/orders.controller';
import { GuestOrdersController } from '../src/modules/orders/guest-orders.controller';
import { BuylistController } from '../src/modules/buylist/buylist.controller';
import { SessionDto } from '../src/modules/orders/dto/orders.dto';
import { GuestSessionDto } from '../src/modules/orders/dto/guest-checkout.dto';
import { CreateRequestDto } from '../src/modules/buylist/dto/buylist.dto';
import { MeasurementService } from '../src/modules/measurement/measurement.service';
import { fakeConfig, fullEnv } from './helpers/measurement-fixtures';

const piOf = (id: string, amount: number) => ({ id, amount, amount_received: amount, currency: 'mxn' }) as never;

function paymentsWorld(opts: { won: 0 | 1; mode: 'vault' | 'direct_ship'; enqueue: jest.Mock }) {
  const ops: string[] = [];
  let inTx = false;
  const rec = (op: string, impl: (a: unknown) => unknown = () => ({})) =>
    jest.fn(async (a: unknown) => {
      ops.push(inTx ? `tx:${op}` : op);
      return impl(a);
    });
  const tx = {
    order: { update: rec('order.update'), updateMany: rec('order.updateMany', () => ({ count: opts.won })) },
    inventoryItem: {
      findUnique: rec('inventoryItem.findUnique', (a) => ({ id: (a as { where: { id: string } }).where.id, status: 'reserved', ownerUserId: 'u1' })),
      updateMany: rec('inventoryItem.updateMany', () => ({ count: 1 })),
    },
    inventoryMovement: { create: rec('inventoryMovement.create') },
    shipmentRequest: { findFirst: rec('shipmentRequest.findFirst', () => null), create: rec('shipmentRequest.create') },
    vaultPlacement: {
      createMany: rec('vaultPlacement.createMany', () => ({ count: 1 })),
      findUniqueOrThrow: rec('vaultPlacement.findUniqueOrThrow', () => ({ id: 'vp1' })),
    },
    vaultPlacementItem: { createMany: rec('vaultPlacementItem.createMany', () => ({ count: 1 })) },
    accessoryStockMovement: { createMany: rec('accessoryStockMovement.createMany') },
  };
  const mail = { send: jest.fn(async () => void ops.push('mail.send')) };
  const guestMail = { sendConfirmation: jest.fn(async () => void ops.push('guestMail.send')) };
  const prisma = {
    order: {
      findUnique: jest.fn(async () => ({
        id: 'o1',
        orderNumber: 'TCG-000001',
        userId: 'u1',
        guestEmail: null,
        locale: 'es',
        fulfillmentMode: opts.mode,
        status: 'pending',
        totalCents: 1000,
        stripePaymentIntentId: 'pi_1',
        shippingAddressSnapshot: { line1: 'x' },
        items: [{ id: 'oi1', inventoryItemId: 'item1', cardSnapshot: {} }],
        accessoryLines: [],
      })),
    },
    user: { findUnique: jest.fn(async () => ({ email: 'ash@pallet.mx', locale: 'es', anonymizedAt: null })) },
    shipmentRequest: { findUnique: jest.fn(async () => null), updateMany: jest.fn() },
    $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => {
      inTx = true;
      try {
        return await cb(tx);
      } finally {
        inTx = false;
        ops.push('commit');
      }
    }),
  };
  const enqueue = jest.fn(async (id: string) => {
    ops.push(inTx ? 'tx:enqueuePurchase' : 'enqueuePurchase');
    return opts.enqueue(id);
  });
  const measurement = { enqueuePurchase: enqueue } as unknown as MeasurementService;
  const svc = new PaymentsService(
    prisma as never,
    { getCardDetails: jest.fn(async () => ({ brand: 'visa', last4: '4242' })) } as never,
    guestMail as never,
    { log: jest.fn(async () => undefined) } as never,
    mail as never,
    undefined,
    undefined,
    undefined,
    undefined,
    measurement,
  );
  return { svc, ops, tx, enqueue };
}

describe.each<['vault' | 'direct_ship']>([['vault'], ['direct_ship']])('C-B2 · rama %s', (mode) => {
  it('(1) encolado LANZANDO ⇒ onPaymentSucceeded resuelve, el CAS liquidó y la pieza se movió', async () => {
    const w = paymentsWorld({ won: 1, mode, enqueue: jest.fn().mockRejectedValue(new Error('BD caída')) });
    await expect(w.svc.onPaymentSucceeded(piOf('pi_1', 1000))).resolves.toBeUndefined();
    expect(w.tx.order.updateMany).toHaveBeenCalledTimes(1);
    expect(w.tx.order.updateMany.mock.calls[0][0]).toMatchObject({ data: { status: 'settled' } });
    expect(w.tx.inventoryItem.updateMany).toHaveBeenCalledTimes(1);
    expect(w.enqueue).toHaveBeenCalledWith('o1');
  });
  it('(1b) encolado lanzando de forma SÍNCRONA ⇒ tampoco propaga', async () => {
    const w = paymentsWorld({
      won: 1,
      mode,
      enqueue: jest.fn(() => {
        throw new Error('sync');
      }),
    });
    await expect(w.svc.onPaymentSucceeded(piOf('pi_1', 1000))).resolves.toBeUndefined();
  });
  it('(2) el encolado va FUERA de la transacción, después del commit y del aviso AV-2', async () => {
    const w = paymentsWorld({ won: 1, mode, enqueue: jest.fn().mockResolvedValue(1) });
    await w.svc.onPaymentSucceeded(piOf('pi_1', 1000));
    expect(w.ops).not.toContain('tx:enqueuePurchase');
    const i = w.ops.indexOf('enqueuePurchase');
    expect(i).toBeGreaterThan(w.ops.lastIndexOf('commit'));
    expect(i).toBeGreaterThan(w.ops.indexOf('mail.send'));
  });
  it('(3) el perdedor de la carrera (CAS 0 filas) NO encola', async () => {
    const w = paymentsWorld({ won: 0, mode, enqueue: jest.fn().mockResolvedValue(1) });
    await w.svc.onPaymentSucceeded(piOf('pi_1', 1000));
    expect(w.enqueue).not.toHaveBeenCalled();
  });
});

describe('C-B2 (4) · las tres peticiones que crean pedido o solicitud', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false });
  const meta = (metatype: unknown): ArgumentMetadata => ({ type: 'body', metatype: metatype as never, data: '' });
  const garbage: unknown[] = ['basura', 42, [1, 2], { consent: 'x' }, { consent: { analytics: true, ads: true }, noticeVersion: 'v 1' }, null];

  /** Resultado del pipe reducido a lo observable: ok, o la lista de mensajes del 400. */
  const outcome = async (body: Record<string, unknown>, dto: unknown) => {
    try {
      const v = (await pipe.transform(body, meta(dto))) as Record<string, unknown>;
      const { measurement: _m, ...rest } = v;
      return { ok: true, rest: JSON.stringify(rest) };
    } catch (e) {
      return { ok: false, msg: JSON.stringify((e as { getResponse?: () => unknown }).getResponse?.() ?? String(e)) };
    }
  };
  const bases: [string, Record<string, unknown>, unknown][] = [
    ['SessionDto', { inventoryItemIds: ['i1'] }, SessionDto],
    ['GuestSessionDto', { inventoryItemIds: ['i1'], email: 'a@b.mx', acceptedTerms: true }, GuestSessionDto],
    ['CreateRequestDto', { items: [{ cardId: 'c1', rawCondition: 'NM', quantity: 1 }], addressId: 'a1' }, CreateRequestDto],
  ];

  it.each(garbage.map((g) => [JSON.stringify(g), g]))('ValidationPipe: measurement=%s ⇒ el MISMO resultado que sin él (nunca un 400 por este campo)', async (_n, g) => {
    for (const [name, base, dto] of bases) {
      const without = await outcome(base, dto);
      const withIt = await outcome({ ...base, measurement: g }, dto);
      expect({ name, ...withIt }).toEqual({ name, ...without });
    }
    // Y el de cuenta, que con este cuerpo es válido, pasa.
    expect((await outcome({ inventoryItemIds: ['i1'], measurement: g }, SessionDto)).ok).toBe(true);
  });

  const on = () => {
    const svc = new MeasurementService({} as never, fakeConfig(fullEnv()));
    jest.spyOn(svc, 'saveContext').mockRejectedValue(new Error('contexto caído'));
    jest.spyOn(svc, 'enqueueLead').mockRejectedValue(new Error('cola caída'));
    return svc;
  };
  const res = () => ({ status: jest.fn() });
  const full = { consent: { analytics: true, ads: true }, noticeVersion: 'v1', fbp: 'fb.1.1712345678901.1234567890' };

  it('POST /checkout/session: contexto lanzando ⇒ 201 y el mismo cuerpo; basura ⇒ mismas columnas que sin measurement', async () => {
    const result = { orderId: 'o1', reused: false };
    const orders = { createSession: jest.fn(async () => result) };
    const c = new OrdersController(orders as never, {} as never, on());
    const r = res();
    await expect(c.session('u1', { inventoryItemIds: ['i1'], measurement: full } as never, r as never)).resolves.toBe(result);
    expect(r.status).toHaveBeenCalledWith(201);
    await c.session('u1', { inventoryItemIds: ['i1'], measurement: 'basura' } as never, res() as never);
    await c.session('u1', { inventoryItemIds: ['i1'] } as never, res() as never);
    expect(orders.createSession.mock.calls[1]).toEqual(orders.createSession.mock.calls[2]);
  });

  it('POST /checkout/guest/session: contexto lanzando ⇒ 201', async () => {
    const result = { orderId: 'o1', reused: false };
    const guest = { createSession: jest.fn(async () => result) };
    const c = new GuestOrdersController(guest as never, on());
    const r = res();
    await expect(c.session({ measurement: full } as never, '1.2.3.4', r as never)).resolves.toBe(result);
    expect(r.status).toHaveBeenCalledWith(201);
  });

  it('POST /buylist/requests: contexto y encolado lanzando ⇒ devuelve la solicitud creada', async () => {
    const created = { sellRequestId: 's1', status: 'cotizada' };
    const buylist = { createRequest: jest.fn(async () => created) };
    const c = new BuylistController(buylist as never, {} as never, {} as never, on());
    await expect(c.create('u1', { items: [], measurement: full } as never)).resolves.toBe(created);
  });

  it('TL-MKT2-D1 · los tres pasan por `afterCreate` (un solo camino); el REUSO no lo llama', async () => {
    const svc = new MeasurementService({} as never, fakeConfig(fullEnv()));
    const after = jest.spyOn(svc, 'afterCreate').mockResolvedValue(undefined);
    const save = jest.spyOn(svc, 'saveContext');
    const lead = jest.spyOn(svc, 'enqueueLead');
    const fresh = { orderId: 'o1', reused: false };
    await new OrdersController({ createSession: jest.fn(async () => fresh) } as never, {} as never, svc).session('u1', { inventoryItemIds: ['i1'], measurement: full } as never, res() as never);
    await new GuestOrdersController({ createSession: jest.fn(async () => fresh) } as never, svc).session({ measurement: full } as never, '1.2.3.4', res() as never);
    await new BuylistController({ createRequest: jest.fn(async () => ({ sellRequestId: 's1' })) } as never, {} as never, {} as never, svc).create('u1', { items: [], measurement: full } as never);
    expect(after.mock.calls.map((c) => [c[0], c[2]])).toEqual([[{ orderId: 'o1' }, undefined], [{ orderId: 'o1' }, undefined], [{ sellRequestId: 's1' }, { lead: true }]]);
    expect([save, lead].map((m) => m.mock.calls.length)).toEqual([0, 0]);
    after.mockClear();
    await new OrdersController({ createSession: jest.fn(async () => ({ orderId: 'o1', reused: true })) } as never, {} as never, svc).session('u1', { inventoryItemIds: ['i1'], measurement: full } as never, res() as never);
    expect(after).not.toHaveBeenCalled();
  });

  it('TL-MKT2-D1 · `afterCreate` con la BD lanzando por dentro (contexto y cola) ⇒ resuelve sin lanzar y el log no cita el error', async () => {
    const boom = jest.fn(async () => {
      throw new Error('SECRETO-EN-EL-MENSAJE');
    });
    const prisma = { measurementContext: { createMany: boom, findUnique: boom }, sellRequest: { findUnique: boom } };
    const svc = new MeasurementService(prisma as never, fakeConfig(fullEnv()));
    const warn = jest.spyOn((svc as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn').mockImplementation(() => undefined);
    await expect(svc.afterCreate({ sellRequestId: 's1' }, svc.prepare(full), { lead: true })).resolves.toBeUndefined();
    await expect(svc.afterCreate({ orderId: 'o1' }, svc.prepare(full))).resolves.toBeUndefined();
    expect(boom).toHaveBeenCalled();
    expect(warn.mock.calls.flat().join('\n')).not.toContain('SECRETO');
  });
});

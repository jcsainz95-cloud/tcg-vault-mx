/**
 * 💰 TD-AN-6 (techlead sobre `76dd1ee9`) — `bucketFigures` sumaba en `total.pnl` TODAS las llaves de `pnlBuckets`, también
 * una fuera de los cubos, que ninguna fila tiene: Σ filas ≠ total sin que nadie lo dijera. Ahora es la MISMA comprobación
 * que `accOf` (los pedidos): una llave ajena lanza. Inalcanzable con el `keyOf` de hoy, así que se prueba con un doble de
 * `pnlBuckets` que devuelve una llave fuera del periodo. Determinista (N=1, dicho así).
 */
import { SalesAnalyticsService } from '../src/modules/sales-analytics/sales-analytics.service';
import { zeroPnl } from '../src/modules/admin/pnl-core';

const stray = new Map<string, ReturnType<typeof zeroPnl>>();

jest.mock('../src/modules/admin/pnl-core', () => {
  const actual = jest.requireActual('../src/modules/admin/pnl-core');
  return {
    ...actual,
    refundRowsInPeriod: jest.fn(async () => []),
    pnlBuckets: jest.fn(async () => stray),
  };
});

const prisma = {
  order: { findMany: jest.fn(async () => []) },
  sellRequest: { findMany: jest.fn(async () => []) },
};

describe('TD-AN-6 — total.pnl solo suma llaves de cubos', () => {
  const svc = new SalesAnalyticsService(prisma as never);

  beforeEach(() => stray.clear());

  it('CONTROL: con la llave del propio día, la fila y el total llevan el mismo P&L', async () => {
    stray.set('2021-03-01', { ...zeroPnl(), shippingRevenueCents: 700 });
    const f = await svc.dayFigures('2021-03-01');
    expect(f.shipping.chargedNetCents).toBe(700); // el doble SÍ llega a la fila
  });

  it('una llave de pnlBuckets fuera de los cubos ⇒ lanza (⛔ no se suma al total en silencio)', async () => {
    stray.set('2021-03-01', { ...zeroPnl(), incomeCents: 1000 });
    stray.set('2021-02-28', { ...zeroPnl(), incomeCents: 500 });
    await expect(svc.dayFigures('2021-03-01')).rejects.toThrow(/llave de pnl fuera de los cubos \(2021-02-28\)/);
  });

  it('TD-AN-7: la lectura de pedidos R-2 pide los tres estados de un pedido cobrado', async () => {
    await svc.dayFigures('2021-03-01');
    const calls = prisma.order.findMany.mock.calls as unknown as Array<[{ where: { status: unknown } }]>;
    const arg = calls[calls.length - 1][0];
    expect(arg.where.status).toEqual({ in: ['settled', 'refunded', 'chargeback'] });
  });
});

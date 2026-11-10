/**
 * D9 (docs/specs/D9_COMISION.md §3 «P&L», P3-A) — el costo de Stripe del P&L por convención de la fila:
 *  - FEE_INCLUDED con `stripeFeeCents` ⇒ ese costo REAL;
 *  - FEE_INCLUDED sin `stripeFeeCents` ⇒ el ESTIMADO con los diales (nunca 0 silencioso);
 *  - FEE_ON_TOP (migrada) ⇒ `processingFeeCents` como siempre (los meses viejos no se reescriben).
 * La venta cuenta COMPLETA: `incomeCents` = base gravable del subtotal exhibido (C2: 10500 ⇒ 9052). N=1 por caso, determinista.
 */
import { pnlBuckets } from '../src/modules/admin/pnl-core';

const AT = new Date('2026-11-12T12:00:00Z');
const base = { fulfillmentMode: 'vault', settledAt: AT, ivaRatePct: 16, priceConvention: 'IVA_INCLUSIVE', shippingFeeCents: 0, ivaCents: 1448, items: [], accessoryLines: [] };

function db(orders: Record<string, unknown>[], shipments: Record<string, unknown>[] = []) {
  const cfg = jest.fn(async () => [
    { key: 'stripe_fee_pct', valueJson: 0.036 },
    { key: 'stripe_fee_fixed_cents', valueJson: 300 },
    { key: 'iva_pct', valueJson: 16 },
  ]);
  return {
    d: {
      order: { findMany: jest.fn(async () => orders) },
      configSetting: { findMany: cfg },
      shipmentCostAdjustment: { findMany: jest.fn(async () => []) },
      paymentRefund: { findMany: jest.fn(async () => []) },
      manualRefund: { findMany: jest.fn(async () => []) },
      shipmentRequest: { findMany: jest.fn(async () => shipments) },
      sellRequest: { findMany: jest.fn(async () => []) },
    },
    cfg,
  };
}
const all = async (d: unknown) => (await pnlBuckets(d as never, undefined, () => 'all')).get('all')!;

describe('D9 · P&L: venta completa y Stripe como gasto, por convención de la fila', () => {
  it('FEE_INCLUDED con costo real ⇒ gasto = stripeFeeCents; el ingreso es la base de 10500 (9052) y NO se lee la config', async () => {
    const { d, cfg } = db([{ ...base, feeConvention: 'FEE_INCLUDED', subtotalCents: 10500, processingFeeCents: 0, totalCents: 10500, stripeFeeCents: 777 }]);
    const p = await all(d);
    expect(p.incomeCents).toBe(9052);
    expect(p.stripeFeesCents).toBe(777);
    expect(cfg).not.toHaveBeenCalled();
  });
  it('FEE_INCLUDED sin costo real ⇒ estimado con los diales: C2 total 20500 ⇒ 1204 (no 0)', async () => {
    const { d } = db([{ ...base, feeConvention: 'FEE_INCLUDED', subtotalCents: 10500, shippingFeeCents: 10000, processingFeeCents: 0, totalCents: 20500, stripeFeeCents: null }]);
    expect((await all(d)).stripeFeesCents).toBe(1204);
  });
  it('FEE_ON_TOP (migrada) ⇒ processingFeeCents como siempre, aunque traiga un stripeFeeCents', async () => {
    const { d, cfg } = db([{ ...base, feeConvention: 'FEE_ON_TOP', subtotalCents: 10000, processingFeeCents: 4617, totalCents: 14617, stripeFeeCents: 5 }]);
    expect((await all(d)).stripeFeesCents).toBe(4617);
    expect(cfg).not.toHaveBeenCalled();
  });
  it('retiro de bóveda FEE_INCLUDED sin costo real ⇒ estimado de su propio cobro: 10000 ⇒ 766 (el fijo también lo absorbe la tienda)', async () => {
    const { d } = db([], [{ pickingAt: AT, feeConvention: 'FEE_INCLUDED', shippingFeeCents: 10000, ivaCents: 1379, processingFeeCents: 0, totalCents: 10000, stripeFeeCents: null, priceConvention: 'IVA_INCLUSIVE', shippingCostCents: 0, shippingCostIvaCents: 0, labelSource: 'skydropx', insuranceCostCents: 0 }]);
    const p = await all(d);
    expect(p.stripeFeesCents).toBe(766);
    expect(p.shippingRevenueCents).toBe(10000 - 1379);
  });
  it('mezcla de meses: la suma respeta la convención de CADA fila', async () => {
    const { d } = db([
      { ...base, feeConvention: 'FEE_ON_TOP', subtotalCents: 10000, processingFeeCents: 400, totalCents: 10400, stripeFeeCents: null },
      { ...base, feeConvention: 'FEE_INCLUDED', subtotalCents: 10500, processingFeeCents: 0, totalCents: 10500, stripeFeeCents: 900 },
    ]);
    expect((await all(d)).stripeFeesCents).toBe(1300);
  });
});

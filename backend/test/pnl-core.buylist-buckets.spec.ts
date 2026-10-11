/**
 * pnl-core.buylist-buckets.spec.ts — 💰 fusión analítica + #78 (API_CONTRACT §BSD.16 y §15.8, ARCHITECTURE §4.64.4).
 *
 * `pnlBuckets` lleva los cuatro renglones del buylist que #78 metió en `pnl()`, cada uno en el cubo de SU fecha:
 *  - tarifa retenida, margen por solicitud y «sin costo capturado» ⇒ `paidAt` de la solicitud `pagada`;
 *  - guía de Skydropx de entrada ⇒ `labelPurchasedAt`;
 *  - guía manual con costo ⇒ `coalesce(guideSentAt, shipmentConfirmedAt)`.
 * Y la ganancia de cada cubo suma lo retenido y resta las guías de ESE cubo. El doble devuelve filas fijas (las fechas del
 * `where` las cubre la integración: `sales-analytics.e2e-spec.ts` «AN-B-15 por día»). Determinista: N=1, dicho así.
 */
import { pnlBuckets } from '../src/modules/admin/pnl-core';

const D = (ymd: string) => new Date(`${ymd}T18:00:00.000Z`);
const keyOf = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : 'sin-fecha');

function db() {
  const inbound = { labelSource: 'skydropx', providerCancelConfirmedAt: null, shippingCostCents: 25000, shippingCostIvaCents: 3448 };
  return {
    order: { findMany: jest.fn(async () => []) },
    shipmentCostAdjustment: { findMany: jest.fn(async () => []) },
    paymentRefund: { findMany: jest.fn(async () => []) },
    manualRefund: { findMany: jest.fn(async () => []) },
    shipmentRequest: {
      findMany: jest.fn(async ({ where }: { where: { kind?: string } }) =>
        where.kind === 'buylist_inbound' ? [{ ...inbound, labelPurchasedAt: D('2021-03-04') }] : [],
      ),
    },
    sellRequest: {
      findMany: jest.fn(async ({ where }: { where: { status?: string } }) =>
        where.status === 'pagada'
          ? [
              // retenido 58 000 − 40 000 = 18 000; su guía manual cuesta 15 000 ⇒ margen 3 000, en el día del pago
              { paidAt: D('2021-03-05'), approvedTotalCents: 58000, offerGrossCents: 58000, quotedTotalCents: 58000, payoutNetCents: 40000, guideSentAt: D('2021-03-02'), guideActualCostCents: 15000, inboundShipment: null },
              // guía manual entregada sin costo ⇒ «sin capturar» en el día del pago
              { paidAt: D('2021-03-06'), approvedTotalCents: null, offerGrossCents: null, quotedTotalCents: null, payoutNetCents: null, guideSentAt: D('2021-03-03'), guideActualCostCents: null, inboundShipment: null },
            ]
          : [
              { guideActualCostCents: 15000, guideSentAt: D('2021-03-02'), shipmentConfirmedAt: D('2021-03-05'), inboundShipment: null },
              { guideActualCostCents: 7000, guideSentAt: null, shipmentConfirmedAt: D('2021-03-07'), inboundShipment: null },
              // con guía de Skydropx de entrada ⇒ ⛔ no cuenta como manual (la cuenta (a))
              { guideActualCostCents: 99999, guideSentAt: D('2021-03-01'), shipmentConfirmedAt: null, inboundShipment: { labelSource: 'skydropx' } },
            ],
      ),
    },
  };
}

describe('💰 pnlBuckets — el buylist de #78, cada renglón en el cubo de su fecha (N=1, determinista)', () => {
  it('retenido/margen/sin-capturar por `paidAt`; Skydropx por `labelPurchasedAt`; manual por coalesce(guideSentAt, shipmentConfirmedAt)', async () => {
    const out = await pnlBuckets(db() as never, undefined, keyOf);
    const pick = (k: string) => {
      const b = out.get(k);
      return b && {
        retained: b.buylistShippingFeeRetainedCents,
        cost: b.buylistGuideCostCents,
        margin: b.buylistGuideMarginCents,
        missing: b.buylistGuideCostMissingCount,
        profit: b.profitCents,
      };
    };
    expect(pick('2021-03-02')).toEqual({ retained: 0, cost: 15000, margin: 0, missing: 0, profit: -15000 });
    expect(pick('2021-03-04')).toEqual({ retained: 0, cost: 21552, margin: 0, missing: 0, profit: -21552 });
    expect(pick('2021-03-05')).toEqual({ retained: 18000, cost: 0, margin: 3000, missing: 0, profit: 18000 });
    expect(pick('2021-03-06')).toEqual({ retained: 0, cost: 0, margin: 0, missing: 1, profit: 0 });
    expect(pick('2021-03-07')).toEqual({ retained: 0, cost: 7000, margin: 0, missing: 0, profit: -7000 });
    // la manual con guía de Skydropx de entrada no abre cubo (ni el 03-01 ni con su costo)
    expect(out.has('2021-03-01')).toBe(false);
    expect([...out.keys()].sort()).toEqual(['2021-03-02', '2021-03-04', '2021-03-05', '2021-03-06', '2021-03-07']);
  });

  it('un solo cubo («all», lo que hace M7): los cuatro renglones y la ganancia son la suma de los cubos', async () => {
    const all = (await pnlBuckets(db() as never, undefined, () => 'all')).get('all')!;
    expect(all.buylistShippingFeeRetainedCents).toBe(18000);
    expect(all.buylistGuideCostCents).toBe(15000 + 21552 + 7000);
    expect(all.buylistGuideMarginCents).toBe(3000);
    expect(all.buylistGuideCostMissingCount).toBe(1);
    expect(all.profitCents).toBe(18000 - 15000 - 21552 - 7000);
  });

  it('la lectura de guías de entrada lleva `INBOUND_ONLY` y la de envío de venta `OUTBOUND_ONLY` (censo BSD-B23)', async () => {
    const d = db();
    await pnlBuckets(d as never, undefined, () => 'all');
    const kinds = d.shipmentRequest.findMany.mock.calls.map(([a]) => (a as { where: { kind?: string } }).where.kind).sort();
    expect(kinds).toEqual(['buylist_inbound', 'outbound']);
  });
});

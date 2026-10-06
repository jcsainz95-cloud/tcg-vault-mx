/**
 * bsd-b4-pnl.e2e-spec.ts — 💰 rev BSD-1, errata BSD-1.2, bloque B-4 (API_CONTRACT §BSD.16) contra Postgres REAL y por HTTP
 * (`GET /admin/finance/pnl` y `GET /admin/finance/export.csv?report=pnl`, súper-admin). Propiedad: backend.
 *
 * Lo que el doble de `test/bsd.b4-pnl.spec.ts` no puede medir: que los `where` de Prisma seleccionen lo que dicen (la clase
 * `INBOUND_ONLY`, `labelSource`, las fechas de cada renglón, la relación `inboundShipment`) y que los CHECK de la tabla
 * admitan las filas que el P&L supone. BSD-B32/B33/B34/B36 con las cifras del contrato, en UN periodo propio de la corrida
 * (un mes de un año lejano, distinto por corrida) y por DIFERENCIA contra la lectura previa: la BD compartida puede tener
 * otras filas y no estorban. Determinista: N=1, dicho como tal (no hay carrera ni reloj).
 * BSD-B43 (errata BSD-1.4 punto 12): el periodo de (b) es `coalesce(guideSentAt, shipmentConfirmedAt)`, en un año propio
 * (Y + 1) y por diferencia; la suma de los doce meses es la diferencia del P&L SIN periodo.
 */
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

const RUN = `b4${Date.now().toString(36)}`;
const Y = 2300 + (Date.now() % 600);
const FROM = `${Y}-03-01T00:00:00.000Z`;
const TO = `${Y}-03-31T23:59:59.999Z`;
const IN = new Date(`${Y}-03-15T12:00:00.000Z`);
const OUT = new Date(`${Y}-02-10T12:00:00.000Z`);
const SNAPSHOT = { recipientName: 'Tienda', line1: 'Calle 1', city: 'CDMX', state: 'CDMX', postalCode: '01000', country: 'MX', phone: '5500000000' };

const NEW_KEYS = ['buylistShippingFeeRetainedCents', 'buylistGuideCostCents', 'buylistGuideMarginCents', 'buylistGuideCostMissingCount'] as const;

describe('💰 BSD-B32…B36 — guía y tarifa del buylist en el P&L (Postgres real, HTTP)', () => {
  let h: E2EHarness;
  let token: string;
  let sellerId: string;
  const srIds: string[] = [];
  const shipIds: string[] = [];
  let seq = 0;

  const pnl = async () => {
    const r = await h.api('GET', `/admin/finance/pnl?from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`, { token });
    expect(r.status).toBe(200);
    return (r.body?.data ?? r.body) as Record<string, number>;
  };

  async function request(over: Record<string, unknown>) {
    const sr = await h.prisma.sellRequest.create({ data: { userId: sellerId, ...over } as any });
    srIds.push(sr.id);
    return sr;
  }
  /** Solicitud PAGADA: `payoutNetCents = max(0, bruto − tarifa)`, como lo sella `paySpei`. */
  const paidReq = (gross: number, fee: number, over: Record<string, unknown> = {}) =>
    request({
      status: 'pagada',
      quotedTotalCents: gross,
      offerGrossCents: gross,
      approvedTotalCents: gross,
      offerShippingFeeCents: fee,
      payoutNetCents: Math.max(0, gross - fee),
      paidAt: IN,
      closedAt: IN,
      guideSentAt: IN,
      shipmentCarrier: 'DHL',
      shipmentTrackingNumber: `T-${RUN}-${++seq}`,
      ...over,
    });
  const acceptedReq = (over: Record<string, unknown> = {}) =>
    request({ status: 'aceptada', acceptedAt: IN, quotedTotalCents: 150000, offerGrossCents: 150000, offerShippingFeeCents: 18000, ...over });

  /** Guía de Skydropx de ENTRADA bien formada (CHECK `shipment_kind_link` y los de M-66), con su costo congelado. */
  async function skydropxInbound(sellRequestId: string, gross: number, iva: number, over: Record<string, unknown> = {}) {
    seq += 1;
    const row = await h.prisma.shipmentRequest.create({
      data: {
        kind: 'buylist_inbound',
        sellRequestId,
        userId: null,
        orderId: null,
        status: 'guia',
        addressSnapshot: SNAPSHOT,
        shippingFeeCents: 0,
        priceConvention: 'IVA_INCLUSIVE',
        labelSource: 'skydropx',
        providerShipmentId: `prov-${RUN}-${seq}`,
        providerRateId: `rate-${RUN}-${seq}`,
        chosenRateJson: {},
        rateChosenByUserId: sellerId,
        rateChosenAt: IN,
        labelPurchasedAt: IN,
        packageCode: '4G',
        declaredValueCents: 150000,
        insuredValueCents: 0,
        carrier: 'DHL',
        trackingNumber: `SDX-${RUN}-${seq}`,
        shippingCostCents: gross,
        shippingCostIvaCents: iva,
        ...over,
      } as any,
    });
    shipIds.push(row.id);
    return row;
  }

  let before: Record<string, number>;
  let after: Record<string, number>;

  beforeAll(async () => {
    h = await E2EHarness.create();
    token = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    const u = await h.prisma.user.create({ data: { email: `b4.${RUN}@e2e.local`, name: 'Vendedor B4', role: 'customer', emailVerified: true } });
    sellerId = u.id;

    before = await pnl();

    // BSD-B34: tarifa 18 000 con guía neta 12 931 (⇒ +5 069) y con guía neta 21 552 (⇒ −3 552)
    const a = await paidReq(150000, 18000);
    await skydropxInbound(a.id, 15000, 2069);
    const b = await paidReq(150000, 18000);
    await skydropxInbound(b.id, 25000, 3448);
    // una guía de una solicitud NO pagada, comprada en el periodo: cuesta y no retiene (8 621)
    const c = await acceptedReq();
    await skydropxInbound(c.id, 10000, 1379);
    // BSD-B32: cancelada CON confirmación (fuera de (a)) y lo no devuelto (1 000) en «ajustes de paquetería»
    const d = await acceptedReq({ status: 'expirada', closedAt: IN });
    const dRow = await skydropxInbound(d.id, 25000, 3448, {
      status: 'cancelado',
      providerCanceledAt: IN,
      providerCancelReason: 'auto_close',
      providerCancelConfirmedAt: IN,
    });
    await h.prisma.shipmentCostAdjustment.create({
      data: { shipmentRequestId: dRow.id, kind: 'other', providerChargeId: `chg-${RUN}`, providerChargeType: 'cancel_fee', amountCents: 1000, ivaCents: 0, ivaSource: 'manual', chargedAt: IN },
    });
    // BSD-B33: bruto 10 000 < tarifa 18 000 ⇒ retenido 10 000; guía MANUAL sin costo ⇒ contador +1
    await paidReq(10000, 18000);
    // manual con costo, no pagada: (b) 15 000 por `guideSentAt`
    await acceptedReq({ guideSentAt: IN, shipmentCarrier: 'DHL', shipmentTrackingNumber: `M-${RUN}-1`, guideActualCostCents: 15000 });
    // FUERA del periodo: pagada por `paidAt`, manual por `guideSentAt`, Skydropx por `labelPurchasedAt`
    await paidReq(150000, 18000, { paidAt: OUT, closedAt: OUT });
    await acceptedReq({ guideSentAt: OUT, shipmentCarrier: 'DHL', shipmentTrackingNumber: `M-${RUN}-2`, guideActualCostCents: 7000 });
    // con guía de Skydropx de entrada Y costo manual capturado: NO cuenta como manual (su guía es la de Skydropx)
    const i = await acceptedReq({ guideSentAt: IN, shipmentCarrier: 'DHL', shipmentTrackingNumber: `M-${RUN}-3`, guideActualCostCents: 99999 });
    await skydropxInbound(i.id, 10000, 1379, { labelPurchasedAt: OUT, rateChosenAt: OUT });

    after = await pnl();
  });

  afterAll(async () => {
    if (h) {
      await h.prisma.shipmentCostAdjustment.deleteMany({ where: { shipmentRequestId: { in: shipIds } } });
      await h.prisma.shipmentRequest.deleteMany({ where: { id: { in: shipIds } } });
      await h.prisma.sellRequest.deleteMany({ where: { id: { in: srIds } } });
      if (sellerId) await h.prisma.user.deleteMany({ where: { id: sellerId } });
      await h.close();
    }
  });

  const delta = (k: string) => after[k] - before[k];

  it('BSD-B32 — (a) neta y sin las canceladas con confirmación + (b) manual por guideSentAt; «ajustes» +1 000; envío de venta igual', () => {
    expect(delta('buylistGuideCostCents')).toBe(12931 + 21552 + 8621 + 15000);
    expect(delta('shippingAdjustmentsCents')).toBe(1000);
    expect(delta('shippingCostCents')).toBe(1000); // solo el ajuste: ninguna guía de entrada entra como envío de venta
    expect(delta('shippingRevenueCents')).toBe(0);
    expect(delta('shippingCostMissingCount')).toBe(0);
  });

  it('BSD-B33 — retenido = bruto − payoutNet por `paidAt`: 18 000 + 18 000 + 10 000 (el bruto menor que la tarifa retiene el bruto)', () => {
    expect(delta('buylistShippingFeeRetainedCents')).toBe(46000);
  });

  it('BSD-B34 — margen POR SOLICITUD pagada: +5 069 − 3 552 + 10 000 = 11 517; la manual sin costo se cuenta', () => {
    expect(delta('buylistGuideMarginCents')).toBe(5069 - 3552 + 10000);
    expect(delta('buylistGuideCostMissingCount')).toBe(1);
  });

  it('profitCents = lo de antes + retenido − guías (y − el ajuste, que ya restaba)', () => {
    expect(delta('profitCents')).toBe(46000 - (12931 + 21552 + 8621 + 15000) - 1000);
  });

  it('BSD-B43 (errata BSD-1.4 punto 12) — (b) por `coalesce(guideSentAt, shipmentConfirmedAt)`: confirmada en marzo sin guía ⇒ marzo; Σ meses = total', async () => {
    // Un año PROPIO (Y + 1): no toca las cifras de las pruebas de arriba (marzo de Y). Por DIFERENCIA (BD compartida).
    const Y2 = Y + 1;
    const at = (m: number, d: number) => new Date(Date.UTC(Y2, m - 1, d, 12));
    const pnlOf = async (from?: Date, to?: Date) => {
      const q = from && to ? `?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}` : '';
      const r = await h.api('GET', `/admin/finance/pnl${q}`, { token });
      expect(r.status).toBe(200);
      return ((r.body?.data ?? r.body) as Record<string, number>).buylistGuideCostCents;
    };
    const months = async () => {
      const out: number[] = [];
      for (let m = 1; m <= 12; m++) out.push(await pnlOf(new Date(Date.UTC(Y2, m - 1, 1)), new Date(Date.UTC(Y2, m, 1) - 1)));
      return out;
    };
    const m0 = await months();
    const t0 = await pnlOf();
    // Pagadas con costo manual capturado AL CONFIRMAR y SIN `guideSentAt` (lo que `adminConfirmShipment` acepta: `guideMissing`).
    await paidReq(150000, 18000, { guideSentAt: null, shipmentCarrier: null, shipmentTrackingNumber: null, shipmentConfirmedAt: at(3, 20), paidAt: at(3, 25), closedAt: at(3, 25), guideActualCostCents: 9000 });
    await paidReq(150000, 18000, { guideSentAt: null, shipmentCarrier: null, shipmentTrackingNumber: null, shipmentConfirmedAt: at(7, 1), paidAt: at(7, 2), closedAt: at(7, 2), guideActualCostCents: 4100 });
    // Con `guideSentAt` manda `guideSentAt` (enero), aunque se confirmara en febrero.
    await paidReq(150000, 18000, { guideSentAt: at(1, 5), shipmentConfirmedAt: at(2, 5), paidAt: at(2, 6), closedAt: at(2, 6), guideActualCostCents: 7000 });
    const m1 = await months();
    const t1 = await pnlOf();
    const dm = m1.map((v, i) => v - m0[i]);
    expect(dm[2]).toBe(9000); // marzo
    expect([dm[0], dm[1], dm[6]]).toEqual([7000, 0, 4100]);
    expect(t1 - t0).toBe(9000 + 4100 + 7000);
    expect(dm.reduce((a, b) => a + b, 0)).toBe(t1 - t0); // ningún costo se queda sin mes
  });

  it('BSD-B36 — CSV por HTTP: los cuatro al final, en el orden del objeto, con las mismas cifras', async () => {
    const r = await h.api('GET', `/admin/finance/export.csv?report=pnl&from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`, { token });
    expect(r.status).toBe(200);
    const [header, row] = r.text.trim().split('\n');
    const cols = header.split(',');
    expect(cols.slice(-4)).toEqual([...NEW_KEYS]);
    expect(cols.slice(1)).toEqual(Object.keys(after));
    const now = await pnl();
    expect(row.split(',')).toEqual(['pnl', ...Object.values(now).map(String)]);
  });
});

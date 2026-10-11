/**
 * sdx-d2c-cancel-release.e2e-spec.ts — 💰🔒 D2c de Skydropx, segunda mitad: `label/cancel`, la cancelación automática desde los
 * dos escritores de `cancelado`, `label/release` y la verificación de solo lectura (`recoverInFlightLabel`) con la adopción
 * por folio. Postgres REAL, app Nest completa por HTTP, proveedor DOBLE (⛔ nunca la red: PS-99), llave de entorno
 * SUSTITUIDA (⛔ nadie pone `SKYDROPX_ALLOW_SPEND`). Propiedad: backend.
 *
 * Cubre: PS-82 (cancelar / re-emitir, SEC-SDX-11, cancelar y comprar a la vez N=10), PS-83 (cancelación automática por
 * contracargo y por reembolso total; fallo ⇒ `label_cancel_failed` y reintento por el verbo), PS-74 (b) («Liberar»:
 * too_early, adopted, released, 403, 400, has_provider_id; liberar y comprar a la vez N=10), PS-117 (conducta: 0 `purchase`
 * al liberar), PS-118 (c) (`confirmConflict`), PS-120 (cancelar con el dial apagado; liberar como operador ⇒ 403),
 * PS-129 (adopción por folio: fuera de ventana, folio ajeno, duplicado, control positivo y folio solo en el detalle),
 * PS-137 (liberación entre el 7b.1 y el 7b.2 ⇒ 0 `purchase`, N=10), PS-141 (recompra tras cancelar y AG-4 por envío).
 */
import { E2EHarness } from './helpers/e2e-app';
import { R, ShipPrepDb } from './helpers/ship-prep-db';
import { buyBody, createLabelWorld, dial, errCode, purchaseOn, ready, restoreDials } from './helpers/label-db';
import { FakeShippingProvider } from '../../src/modules/shipping-provider/fake-shipping-provider';
import { PurchaseInput } from '../../src/modules/shipping-provider/shipping-provider.port';
import { ManualLabelClock } from '../../src/modules/shipments/label-clock';
import { LabelVerifyConfig } from '../../src/modules/shipments/label-verify.constants';
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';

const RUN = `d2cr${Date.now().toString(36)}`;
const MIN = 60_000;
const N = 10;
const NOTE = 'Lo comprobé en el panel de Skydropx: no hay envío con esta referencia.';

describe('💰🔒 D2c — cancelar, cancelación automática y «Liberar» (§19.8, §19.18.4, §19.27–§19.29)', () => {
  let h: E2EHarness;
  let db: ShipPrepDb;
  let fake: FakeShippingProvider;
  let clock: ManualLabelClock;
  let spend: { on: boolean };
  let cfg: LabelVerifyConfig;
  let bandeja: MailMessage[];

  const quote = (id: string, token = db.opToken): Promise<R> => h.api('POST', `/admin/shipments/${id}/quote`, { token, json: {} });
  const buy = (id: string, json: unknown, token = db.opToken): Promise<R> => {
    clock.advance(1);
    return h.api('POST', `/admin/shipments/${id}/label`, { token, json });
  };
  const cancel = (id: string, json: unknown = { reason: 'Re-emitir con otra paquetería' }, token = db.opToken): Promise<R> =>
    h.api('POST', `/admin/shipments/${id}/label/cancel`, { token, json });
  const release = (id: string, json: unknown = { note: NOTE }, token = db.adminToken): Promise<R> =>
    h.api('POST', `/admin/shipments/${id}/label/release`, { token, json });
  const detail = (id: string, token = db.opToken): Promise<R> => h.api('GET', `/admin/shipments/${id}`, { token });
  const row = (id: string) => h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id } });
  const purchases = (shipmentId?: string) =>
    fake
      .callsOf('purchase')
      .map((c) => c.input as { input: PurchaseInput })
      .filter((c) => !shipmentId || c.input.idempotencyKey.startsWith(`label:${shipmentId}:`));
  const audits = (id: string, action: string) => h.prisma.auditLog.findMany({ where: { entityId: id, action }, orderBy: { createdAt: 'asc' } });
  const pickRate = (q: any, pred: (r: any) => boolean = () => true) =>
    q.rates.find((r: any) => r.deliveryKind !== 'branch' && r.marginCents >= 0 && !r.hidden && pred(r)) ?? q.rates.find(pred);

  const readyQuoted = async () => {
    const d = await db.mkDirect({ prices: [50000, 30000] });
    await ready(db, d.shipment.id);
    const q = await quote(d.shipment.id);
    expect(q.status).toBe(200);
    return { d, id: d.shipment.id, q: q.body, rate: pickRate(q.body) };
  };
  const labeled = async () => {
    const s = await readyQuoted();
    const r = await buy(s.id, buyBody(s.q, s.rate));
    expect(errCode(r)).toBe('200');
    expect(r.body.outcome).toBe('labeled');
    return { ...s, row: await row(s.id) };
  };
  /** Un reclamo «en vuelo» (la compra salió y no respondió); `created` ⇒ Skydropx sí lo creó (con número). */
  const inFlight = async (created: boolean, trackingNumber?: string | null) => {
    const s = await readyQuoted();
    fake.purchaseOutcomes.push({ kind: 'in_flight', created, ...(trackingNumber !== undefined ? { trackingNumber } : {}) });
    const r = await buy(s.id, buyBody(s.q, s.rate));
    expect(r.body.outcome).toBe('in_flight');
    const r0 = await row(s.id);
    return { ...s, since: r0.labelProcessingSince as Date, folio: r0.folio };
  };

  beforeAll(async () => {
    ({ h, db, fake, clock, spend, cfg } = await createLabelWorld(RUN));
    await purchaseOn(h, 'operators');
    await dial(h, 'operator_label_cap_24h_cents', 1_000_000_000);
    const port = h.app.get<MailPort>(MAIL_PORT);
    jest.spyOn(port, 'send').mockImplementation(async (msg: MailMessage) => {
      bandeja.push(msg);
      return {};
    });
  });

  afterAll(async () => {
    await h.prisma.spendAlert.deleteMany({ where: { OR: [{ subjectUserId: { in: [db.operatorId, db.adminId] } }, { shipmentRequestId: { in: db.shipments } }, { dedupKey: { startsWith: 'ag7:' } }] } });
    await restoreDials(h);
    await db.cleanup();
    await h?.close();
  });

  beforeEach(async () => {
    fake.calls.length = 0;
    fake.purchaseOutcomes.length = 0;
    fake.cancelOutcomes.length = 0;
    fake.balanceSequence.length = 0;
    fake.recentExtra.length = 0;
    fake.recentOverride = null;
    fake.purchaseBarrier = null;
    fake.onPurchase = null;
    fake.onBalance = null;
    fake.balanceCents = 10_000_000;
    fake.forgetQuotations();
    clock.set(new Date());
    spend.on = true;
    cfg.adoptionEnabled = false;
    bandeja = [];
    await dial(h, 'shipping_label_purchase', 'operators');
  });

  afterEach(async () => {
    await h.prisma.shipmentRequest.updateMany({
      where: { id: { in: db.shipments }, labelProcessingSince: { not: null }, providerShipmentId: null },
      data: { labelProcessingSince: null, providerRateId: null },
    });
    // Los reclamos de esta prueba no cuentan en la siguiente (TG-1 con el tope alto no muerde, pero se deja limpio).
    await h.prisma.$executeRaw`UPDATE "ShipmentLabelAttempt" SET since = since - interval '25 hours' WHERE since > ${new Date(Date.now() - 25 * 60 * MIN)}`;
  });

  // ================================================================ PS-82 — cancelar / re-emitir

  describe('PS-82 — `label/cancel` (re-emitir antes de que la recojan)', () => {
    it('`created` ⇒ cancel UNA vez; `guia → picking` con `preparedAt`; par, URLs, sellos y costo a NULL/0; libro `reissue`; cero AV-6; re-comprar ⇒ AV-4 con el par nuevo', async () => {
      const s = await labeled();
      bandeja = [];
      const r = await cancel(s.id);
      expect(errCode(r)).toBe('200');
      expect(r.body.outcome).toBe('cancelled');
      expect(fake.callsOf('cancel').map((c) => (c.input as any).providerShipmentId)).toEqual([s.row.providerShipmentId]);
      const s1 = await row(s.id);
      expect(s1).toEqual(
        expect.objectContaining({
          status: 'picking',
          labelSource: null,
          providerShipmentId: null,
          carrier: null,
          trackingNumber: null,
          labelUrl: null,
          trackingUrl: null,
          carrierStatus: null,
          labelProcessingSince: null,
          providerCanceledAt: null,
          providerCancelReason: null,
          providerCancelConfirmedAt: null,
          labelPurchasedAt: null,
          shippingCostCents: 0,
          shippingCostIvaCents: 0,
          insuranceCostCents: 0,
          shippingIvaSource: null,
        }),
      );
      expect(s1.preparedAt).toEqual(s.row.preparedAt);
      const [log] = await audits(s.id, 'shipment.label_cancelled');
      expect(log.before).toEqual(expect.objectContaining({ providerShipmentId: s.row.providerShipmentId, trackingNumber: s.row.trackingNumber }));
      expect(log.after).toEqual({ reason: 'Re-emitir con otra paquetería', refundedCents: null });
      expect(await h.prisma.shipmentPaidLabel.findUnique({ where: { providerShipmentId: s.row.providerShipmentId as string } })).toEqual(
        expect.objectContaining({ cancelKind: 'reissue', cancelledByUserId: db.operatorId, unrefundedCents: null }),
      );
      expect(bandeja).toHaveLength(0); // ⛔ AV-6
      const q2 = await quote(s.id);
      expect(q2.status).toBe(200);
      const again = await buy(s.id, buyBody(q2.body, pickRate(q2.body)));
      expect(errCode(again)).toBe('200');
      const s2 = await row(s.id);
      expect(s2.providerShipmentId).not.toBe(s.row.providerShipmentId);
      expect(bandeja).toHaveLength(1);
      expect(JSON.stringify(bandeja[0])).toContain(s2.trackingNumber as string);
    });

    it('`picked_up` ⇒ 409 {already_picked_up}; guía manual ⇒ 409 {not_provider}; motivo corto ⇒ 400', async () => {
      const s = await labeled();
      await h.prisma.shipmentRequest.update({ where: { id: s.id }, data: { carrierStatus: 'picked_up' } });
      const r = await cancel(s.id);
      expect(errCode(r)).toBe('409:LABEL_NOT_CANCELLABLE');
      expect(r.body.error.details).toEqual({ reason: 'already_picked_up', carrierStatus: 'picked_up' });
      const m = await db.mkDirect();
      await ready(db, m.shipment.id);
      expect((await db.tracking(m.shipment.id)).status).toBe(201);
      const r2 = await cancel(m.shipment.id);
      expect(errCode(r2)).toBe('409:LABEL_NOT_CANCELLABLE');
      expect(r2.body.error.details).toEqual({ reason: 'not_provider' });
      expect(errCode(await cancel(s.id, { reason: 'x' }))).toBe('400:VALIDATION_ERROR');
      expect(fake.callsOf('cancel')).toHaveLength(0);
    });

    it('el doble RECHAZA ⇒ sello revertido y 422; la guía sigue viva', async () => {
      const s = await labeled();
      fake.cancelOutcomes.push({ ok: false, code: 'not_cancellable', message: 'no' });
      const r = await cancel(s.id);
      expect(errCode(r)).toBe('422:SHIPPING_PROVIDER_REJECTED');
      const s1 = await row(s.id);
      expect(s1).toEqual(expect.objectContaining({ status: 'guia', providerShipmentId: s.row.providerShipmentId, providerCanceledAt: null, providerCancelReason: null }));
    });

    it('SEC-SDX-11: `refundedCents = cobrado − 2500` ⇒ ajuste `other` de 2500 con `cancel:<id>` y AG-8 🔴; `refundedCents:null` ⇒ sin ajuste', async () => {
      const s = await labeled();
      fake.cancelOutcomes.push({ ok: true, refundedCents: s.row.shippingCostCents - 2500 });
      expect(errCode(await cancel(s.id))).toBe('200');
      const adj = await h.prisma.shipmentCostAdjustment.findMany({ where: { shipmentRequestId: s.id } });
      expect(adj).toEqual([expect.objectContaining({ kind: 'other', amountCents: 2500, providerChargeId: `cancel:${s.row.providerShipmentId}` })]);
      const paid = await h.prisma.shipmentPaidLabel.findUniqueOrThrow({ where: { providerShipmentId: s.row.providerShipmentId as string } });
      expect(paid.unrefundedCents).toBe(2500);
      expect(await h.prisma.spendAlert.count({ where: { dedupKey: `ag8:${paid.id}` } })).toBe(1);
      const t = await labeled();
      expect(errCode(await cancel(t.id))).toBe('200');
      expect(await h.prisma.shipmentCostAdjustment.count({ where: { shipmentRequestId: t.id } })).toBe(0);
    });

    it('PS-120: con el dial de compra `disabled` y el proveedor `off`, cancelar SIGUE funcionando (SEC-SDX-12)', async () => {
      const s = await labeled();
      await dial(h, 'shipping_label_purchase', 'disabled');
      await dial(h, 'shipping_provider', 'off');
      try {
        expect(errCode(await cancel(s.id))).toBe('200');
      } finally {
        await dial(h, 'shipping_provider', 'skydropx');
      }
    });

    it('PS-141 / AG-4 (ii): guía → cancelar → guía → cancelar ⇒ AG-4 `ag4:s:` 🔴 con cancelledCount 2; la 3.ª ⇒ 403 {limit:"reissue"}', async () => {
      const s = await labeled();
      expect(errCode(await cancel(s.id))).toBe('200');
      const q2 = await quote(s.id);
      expect(errCode(await buy(s.id, buyBody(q2.body, pickRate(q2.body))))).toBe('200');
      expect(errCode(await cancel(s.id))).toBe('200');
      const ag4 = await h.prisma.spendAlert.findMany({ where: { dedupKey: `ag4:s:${s.id}` } });
      expect(ag4).toHaveLength(1);
      expect(ag4[0].facts).toEqual(expect.objectContaining({ cancelledCount: 2, unknownRefunds: 2 }));
      const q3 = await quote(s.id);
      fake.calls.length = 0;
      const r = await buy(s.id, buyBody(q3.body, pickRate(q3.body)));
      expect(errCode(r)).toBe('403:LABEL_PURCHASE_LIMIT');
      expect(r.body.error.details).toEqual({ limit: 'reissue' });
      expect(purchases()).toHaveLength(0);
    });

    it(`cancelar y comprar a la vez ⇒ nunca dos guías vivas (N = ${N})`, async () => {
      let good = 0;
      const bad: string[] = [];
      for (let i = 0; i < N; i += 1) {
        const s = await labeled();
        const other = pickRate(s.q, (x) => x.rateId !== s.rate.rateId);
        const rs = await Promise.all([cancel(s.id), buy(s.id, buyBody(s.q, other))]);
        const s1 = await row(s.id);
        const livePaid = await h.prisma.shipmentPaidLabel.count({ where: { shipmentRequestId: s.id, cancelledAt: null } });
        const live = s1.providerShipmentId !== null && s1.providerCanceledAt === null ? 1 : 0;
        const coherent = (s1.labelSource === 'skydropx') === (s1.providerShipmentId !== null);
        if (livePaid <= 1 && live <= 1 && coherent && rs.every((r) => r.status < 500)) good += 1;
        else bad.push(JSON.stringify({ livePaid, live, coherent, codes: rs.map(errCode) }));
      }
      expect({ proportion: `${good}/${N}`, bad }).toEqual({ proportion: `${N}/${N}`, bad: [] });
    }, 300_000);
  });

  // ================================================================ PS-83 — cancelación automática

  describe('PS-83 — cancelación automática desde los dos escritores de `cancelado` (C-SDX-5)', () => {
    const dispute = (pi: string) =>
      h.sendStripeWebhook({ id: `evt_${RUN}_${Math.random().toString(36).slice(2)}`, type: 'charge.dispute.created', data: { object: { object: 'dispute', payment_intent: pi } } });

    it('contracargo de un directo con guía `created` ⇒ `cancelado`, sello `auto_close`, `cancel` UNA vez y confirmado; libro `auto_close` sin persona', async () => {
      const s = await labeled();
      fake.calls.length = 0;
      expect((await dispute(s.d.pi)).status).toBeLessThan(300);
      const s1 = await row(s.id);
      expect(s1).toEqual(expect.objectContaining({ status: 'cancelado', providerCancelReason: 'auto_close', providerShipmentId: s.row.providerShipmentId }));
      expect(s1.providerCanceledAt).not.toBeNull();
      expect(s1.providerCancelConfirmedAt).not.toBeNull();
      expect(fake.callsOf('cancel').map((c) => (c.input as any).providerShipmentId)).toEqual([s.row.providerShipmentId]);
      expect(await h.prisma.shipmentPaidLabel.findUnique({ where: { providerShipmentId: s.row.providerShipmentId as string } })).toEqual(
        expect.objectContaining({ cancelKind: 'auto_close', cancelledByUserId: null }),
      );
      // `label/cancel` sobre él ⇒ `already_cancelled` (sellado y confirmado), sin red.
      fake.calls.length = 0;
      const again = await cancel(s.id);
      expect(errCode(again)).toBe('200');
      expect(again.body.outcome).toBe('already_cancelled');
      expect(fake.callsOf('cancel')).toHaveLength(0);
    });

    it('contracargo con la guía YA en tránsito ⇒ `cancelado`, SIN `cancel`, alerta `label_live_on_cancelled`', async () => {
      const s = await labeled();
      await h.prisma.shipmentRequest.update({ where: { id: s.id }, data: { carrierStatus: 'in_transit' } });
      fake.calls.length = 0;
      await dispute(s.d.pi);
      expect((await row(s.id)).status).toBe('cancelado');
      expect(fake.callsOf('cancel')).toHaveLength(0);
      expect((await detail(s.id)).body.labelAlert?.kind).toBe('label_live_on_cancelled');
    });

    it('reembolso total (`charge.refunded`) ⇒ ídem: sello y `cancel` una vez', async () => {
      const s = await labeled();
      fake.calls.length = 0;
      expect((await db.chargeRefunded(s.d.pi, s.d.order.totalCents)).status).toBe(200);
      const s1 = await row(s.id);
      expect(s1).toEqual(expect.objectContaining({ status: 'cancelado', providerCancelReason: 'auto_close' }));
      expect(fake.callsOf('cancel')).toHaveLength(1);
    });

    it('el doble FALLA al cancelar ⇒ sello puesto sin confirmar, `label_cancel_failed` a los 2 min; el verbo reintenta ⇒ `cancel` llamado y confirmado', async () => {
      const s = await labeled();
      fake.cancelOutcomes.push({ ok: false, code: 'busy', message: 'later' });
      await dispute(s.d.pi);
      const s1 = await row(s.id);
      expect(s1.providerCanceledAt).not.toBeNull();
      expect(s1.providerCancelConfirmedAt).toBeNull();
      clock.set(new Date(Date.now() + 3 * MIN));
      expect((await detail(s.id)).body.labelAlert?.kind).toBe('label_cancel_failed');
      fake.calls.length = 0;
      const r = await cancel(s.id);
      expect(errCode(r)).toBe('200');
      expect(fake.callsOf('cancel')).toHaveLength(1);
      const s2 = await row(s.id);
      expect(s2.status).toBe('cancelado');
      expect(s2.providerCancelConfirmedAt).not.toBeNull();
    });
  });

  // ================================================================ PS-74 (b) / PS-117 / PS-118 (c) — «Liberar»

  describe('«Liberar» (§19.18.4 con §19.26.3 y §19.27.6)', () => {
    it('a los 10 min ⇒ 409 too_early {retryAfterSeconds}; operador ⇒ 403; sin nota ⇒ 400; sin reclamo ⇒ not_in_progress', async () => {
      const s = await inFlight(false);
      clock.set(new Date(s.since.getTime() + 10 * MIN));
      const r = await release(s.id);
      expect(errCode(r)).toBe('409:LABEL_NOT_RELEASABLE');
      expect(r.body.error.details).toEqual({ reason: 'too_early', retryAfterSeconds: 300 });
      expect((await release(s.id, { note: NOTE }, db.opToken)).status).toBe(403);
      clock.set(new Date(s.since.getTime() + 16 * MIN));
      expect(errCode(await release(s.id, {}))).toBe('400:VALIDATION_ERROR');
      const t = await readyQuoted();
      const r2 = await release(t.id);
      expect(r2.body.error.details).toEqual({ reason: 'not_in_progress' });
    });

    it('PS-74 (b) / PS-117: Skydropx NO lo creó ⇒ a los 16 min `released` con la nota, reclamo NULL, intento `released_unverified`, 0 `purchase`; luego se compra de nuevo', async () => {
      const s = await inFlight(false);
      clock.set(new Date(s.since.getTime() + 16 * MIN));
      fake.calls.length = 0;
      const r = await release(s.id);
      expect(errCode(r)).toBe('200');
      expect(r.body.outcome).toBe('released');
      expect(r.body.verdict).toEqual({ outcome: 'uncertain', reason: 'not_calibrated' });
      expect(purchases()).toHaveLength(0);
      expect(fake.calls.map((c) => c.op).every((op) => ['recentShipments', 'balance', 'getShipment'].includes(op))).toBe(true);
      const s1 = await row(s.id);
      expect(s1).toEqual(expect.objectContaining({ labelProcessingSince: null, providerRateId: null, chosenRateJson: null }));
      const [log] = await audits(s.id, 'shipment.label_released');
      expect(log.after).toEqual(expect.objectContaining({ note: NOTE, via: 'manual' }));
      expect((await h.prisma.shipmentLabelAttempt.findMany({ where: { shipmentRequestId: s.id } })).map((a) => a.outcome)).toEqual(['released_unverified']);
      const q2 = await quote(s.id);
      expect(errCode(await buy(s.id, buyBody(q2.body, pickRate(q2.body))))).toBe('200');
    });

    it('PS-74 (b): Skydropx SÍ lo creó (con nuestro folio) ⇒ `adopted`: id puesto, `guia`, UN AV-4, `label_adopted`, libro `adopted`, 0 `purchase` nuevas', async () => {
      cfg.adoptionEnabled = true;
      const s = await inFlight(true);
      clock.set(new Date(s.since.getTime() + 16 * MIN));
      fake.calls.length = 0;
      bandeja = [];
      const r = await release(s.id);
      expect(errCode(r)).toBe('200');
      expect(r.body.outcome).toBe('adopted');
      expect(r.body.verdict).toEqual({ outcome: 'found', reason: null });
      expect(purchases()).toHaveLength(0);
      const s1 = await row(s.id);
      expect(s1.status).toBe('guia');
      expect(s1.providerShipmentId).toMatch(/^fake-shipment-/);
      expect(await audits(s.id, 'shipment.label_adopted')).toHaveLength(1);
      expect(await h.prisma.shipmentPaidLabel.findUnique({ where: { providerShipmentId: s1.providerShipmentId as string } })).toEqual(expect.objectContaining({ origin: 'adopted', chargedCents: s1.shippingCostCents }));
      expect(bandeja).toHaveLength(1);
    });

    it('sobre un envío con id ⇒ 409 {has_provider_id}', async () => {
      const s = await readyQuoted();
      fake.purchaseOutcomes.push({ kind: 'processing' });
      expect((await buy(s.id, buyBody(s.q, s.rate))).body.outcome).toBe('processing');
      clock.set(new Date(Date.now() + 16 * MIN));
      expect((await release(s.id)).body.error.details).toEqual({ reason: 'has_provider_id' });
    });

    it('PS-118 (c): con `label_conflict` registrado ⇒ sin `confirmConflict` 409 {provider_conflict, otherShipmentId}; con él ⇒ released; 0 `purchase`', async () => {
      const a = await labeled();
      const b = await readyQuoted();
      fake.purchaseOutcomes.push({ kind: 'labeled', providerShipmentId: a.row.providerShipmentId as string });
      expect((await buy(b.id, buyBody(b.q, b.rate))).body.error.details.reason).toBe('provider_id_taken');
      const since = (await row(b.id)).labelProcessingSince as Date;
      clock.set(new Date(since.getTime() + 16 * MIN));
      fake.calls.length = 0;
      const r = await release(b.id);
      expect(errCode(r)).toBe('409:LABEL_NOT_RELEASABLE');
      expect(r.body.error.details).toEqual({ reason: 'provider_conflict', otherShipmentId: a.id });
      const ok = await release(b.id, { note: NOTE, confirmConflict: true });
      expect(errCode(ok)).toBe('200');
      expect(ok.body.outcome).toBe('released');
      expect(ok.body.verdict).toEqual({ outcome: 'uncertain', reason: 'conflict' });
      expect(purchases()).toHaveLength(0);
    });

    it(`liberar y comprar a la vez ⇒ a lo sumo una guía viva y nunca dos \`purchase\` (N = ${N})`, async () => {
      let good = 0;
      const bad: string[] = [];
      for (let i = 0; i < N; i += 1) {
        const s = await inFlight(false);
        clock.set(new Date(s.since.getTime() + 16 * MIN));
        fake.calls.length = 0;
        const rs = await Promise.all([release(s.id), buy(s.id, buyBody(s.q, s.rate))]);
        const n = purchases(s.id).length;
        const live = await h.prisma.shipmentPaidLabel.count({ where: { shipmentRequestId: s.id, cancelledAt: null } });
        if (n <= 1 && live <= 1 && rs.every((r) => r.status < 500)) good += 1;
        else bad.push(JSON.stringify({ n, live, codes: rs.map(errCode) }));
      }
      expect({ proportion: `${good}/${N}`, bad }).toEqual({ proportion: `${N}/${N}`, bad: [] });
    }, 300_000);
  });

  // ================================================================ PS-129 — la adopción por folio exacto

  describe('PS-129 — se adopta SOLO por folio exacto, en la ventana, sin duplicados', () => {
    const listed = (over: Partial<{ id: string; createdAt: Date | null; ref: string | null; carrier: string | null; cp: string | null }>, base: { since: Date; carrier: string }) => ({
      providerShipmentId: over.id ?? `y-${RUN}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: over.createdAt === null ? null : (over.createdAt ?? new Date(base.since.getTime() + 30_000)).toISOString(),
      carrierName: over.carrier === undefined ? base.carrier : over.carrier,
      totalCents: null,
      postalCodeTo: over.cp === undefined ? '01000' : over.cp,
      source: 'api',
      hasError: false,
      providerReference: over.ref === undefined ? null : over.ref,
    });
    const runRelease = async (s: Awaited<ReturnType<typeof inFlight>>) => {
      clock.set(new Date(s.since.getTime() + 16 * MIN));
      fake.calls.length = 0;
      const r = await release(s.id);
      expect(purchases()).toHaveLength(0);
      return r;
    };

    it.each<[string, (s: { since: Date; carrier: string; ref: string }) => ReturnType<typeof listed>[], string]>([
      ['(a) folio exacto con createdAt = T+20 min (fuera de ventana)', (b) => [listed({ ref: b.ref, createdAt: new Date(b.since.getTime() + 20 * MIN) }, b)], 'released'],
      ['(c) folio exacto con createdAt nulo', (b) => [listed({ ref: b.ref, createdAt: null }, b)], 'released'],
      ['(d) todo igual pero SIN folio (y sin folio en el detalle)', (b) => [listed({ ref: null }, b)], 'released'],
      ['(e) folio de OTRO envío', (b) => [listed({ ref: 'ENV-999998-01' }, b)], 'released'],
      ['(f) folio del intento 01 cuando el vigente es el 02', (b) => [listed({ ref: b.ref.replace(/-\d{2}$/, '-99') }, b)], 'released'],
    ])('%s ⇒ NO adopta', async (_n, make, expected) => {
      cfg.adoptionEnabled = true;
      const s = await inFlight(false);
      const ref = (await h.prisma.shipmentLabelAttempt.findFirstOrThrow({ where: { shipmentRequestId: s.id } })).providerReference as string;
      for (const e of make({ since: s.since, carrier: s.rate.carrierName, ref })) fake.addListed(e as any);
      const r = await runRelease(s);
      expect(r.body.outcome).toBe(expected);
      expect((await row(s.id)).providerShipmentId).toBeNull();
    });

    it('(g) dos con nuestro folio exacto ⇒ `uncertain(duplicate)` y NO adopta', async () => {
      cfg.adoptionEnabled = true;
      const s = await inFlight(false);
      const ref = (await h.prisma.shipmentLabelAttempt.findFirstOrThrow({ where: { shipmentRequestId: s.id } })).providerReference as string;
      const b = { since: s.since, carrier: s.rate.carrierName };
      fake.addListed(listed({ ref }, b) as any);
      fake.addListed(listed({ ref }, b) as any);
      const r = await runRelease(s);
      expect(r.body.verdict).toEqual({ outcome: 'uncertain', reason: 'duplicate' });
      expect(r.body.outcome).toBe('released');
    });

    it('control positivo: folio exacto, T+30 s, misma paquetería y CP ⇒ adopta; y con el folio SOLO en el detalle ⇒ adopta', async () => {
      cfg.adoptionEnabled = true;
      const s = await inFlight(false);
      const ref = (await h.prisma.shipmentLabelAttempt.findFirstOrThrow({ where: { shipmentRequestId: s.id } })).providerReference as string;
      const y = listed({ ref }, { since: s.since, carrier: s.rate.carrierName });
      fake.addListed(y as any, { trackingNumber: `TN-${RUN}-1`, carrierStatus: 'created' });
      const r = await runRelease(s);
      expect(r.body.outcome).toBe('adopted');
      expect((await row(s.id)).providerShipmentId).toBe(y.providerShipmentId);

      const t = await inFlight(false);
      const ref2 = (await h.prisma.shipmentLabelAttempt.findFirstOrThrow({ where: { shipmentRequestId: t.id } })).providerReference as string;
      const z = listed({ ref: null }, { since: t.since, carrier: t.rate.carrierName });
      fake.addListed(z as any, { providerReference: ref2, trackingNumber: `TN-${RUN}-2`, carrierStatus: 'created' });
      const r2 = await runRelease(t);
      expect(r2.body.outcome).toBe('adopted');
      expect((await row(t.id)).providerShipmentId).toBe(z.providerShipmentId);
    });

    it('con la adopción APAGADA (constante inyectada en `false`) ⇒ nunca adopta', async () => {
      cfg.adoptionEnabled = false;
      const s = await inFlight(true);
      const r = await runRelease(s);
      expect(r.body.outcome).toBe('released');
    });
  });

  // ================================================================ PS-137 — una liberación entre el 7b.1 y el 7b.2

  it(`PS-137 — una liberación entre el 7b.1 y el 7b.2 ⇒ CERO \`purchase\` (N = ${N})`, async () => {
    let good = 0;
    const bad: string[] = [];
    for (let i = 0; i < N; i += 1) {
      const s = await readyQuoted();
      let calls = 0;
      let rel: R | null = null;
      fake.calls.length = 0;
      fake.onBalance = async () => {
        calls += 1;
        if (calls !== 2) return; // la 2.ª lectura es la del 7b.1 (tras el reclamo)
        // «not_sent» forzado por reloj: el reclamo aún sin `sentAt` y pasada la vida máxima ⇒ «Liberar» lo suelta.
        clock.advance(16 * MIN);
        rel = await release(s.id);
      };
      const r = await buy(s.id, buyBody(s.q, s.rate));
      fake.onBalance = null;
      const n = purchases(s.id).length;
      const relOut = (rel as R | null)?.body?.outcome ?? errCode(rel as unknown as R);
      if (n === 0 && relOut === 'released' && r.status === 409) good += 1;
      else bad.push(JSON.stringify({ n, rel: relOut, buy: errCode(r), verdict: (rel as R | null)?.body?.verdict }));
      clock.set(new Date());
    }
    expect({ proportion: `${good}/${N}`, bad }).toEqual({ proportion: `${N}/${N}`, bad: [] });
  }, 300_000);
});

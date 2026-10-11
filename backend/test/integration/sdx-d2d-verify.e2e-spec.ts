/**
 * sdx-d2d-verify.e2e-spec.ts — ⭐💰 D2d: la compra en vuelo se verifica SOLA desde el job `shipment-label-processing`
 * (API_CONTRACT §19.27.4–.7, §19.28.4–.5, §19.28.9, §19.29.1.3–.4) contra Postgres REAL, app completa, proveedor DOBLE
 * (⛔ nunca la red: PS-99), constantes INYECTADAS (§19.27.8: ⛔ no se cambia `label-verify.constants.ts`). Propiedad: backend.
 *
 * Cubre: la cadencia (primera mirada a la vida máxima, cola cada 10 min), PS-124 (encontrada ⇒ adopta sin comprar; con
 * error ⇒ «rechazo con id»; envío `cancelado` ⇒ §19.18.3; tardía ⇒ en la cola), PS-125 (lo ambiguo nunca se adopta),
 * PS-126 (no cobró ⇒ se libera sola, SOLO con la evidencia negativa encendida), PS-127 (contaminación ⇒ incierto),
 * PS-133 (contaminación ampliada y cable trampa), PS-134 (a) (`not_sent`) y (c) (7b real comiteado ⇒ el job NO libera),
 * y el duplicado (dos filas `origin:'duplicate'`).
 *
 * ⚠️ El saldo «no vota» si en la ventana hay débitos/reembolsos ajenos: la base de pruebas es compartida, así que cada prueba
 * corre con el reloj en un día FUTURO propio (las filas de otras suites quedan fuera de toda ventana) y los retrasos de
 * `T_DEBIT_LAG`/`T_REFUND_LAG` se inyectan cortos (3 h) para poder medirlos.
 */
import { E2EHarness } from './helpers/e2e-app';
import { R, ShipPrepDb } from './helpers/ship-prep-db';
import { buyBody, createLabelWorld, dial, errCode, purchaseOn, ready, restoreDials } from './helpers/label-db';
import { FakeShippingProvider } from '../../src/modules/shipping-provider/fake-shipping-provider';
import { PurchaseInput, RecentProviderShipment } from '../../src/modules/shipping-provider/shipping-provider.port';
import { ManualLabelClock } from '../../src/modules/shipments/label-clock';
import { LabelVerifyConfig } from '../../src/modules/shipments/label-verify.constants';
import { ShipmentLabelProcessingJob } from '../../src/modules/shipments/label-processing.job';
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';

const RUN = `d2dv${Date.now().toString(36)}`;
const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;

describe('⭐💰 D2d — la compra en vuelo se verifica sola (§19.27–§19.29)', () => {
  let h: E2EHarness;
  let db: ShipPrepDb;
  let fake: FakeShippingProvider;
  let clock: ManualLabelClock;
  let cfg: LabelVerifyConfig;
  let bandeja: MailMessage[];
  let jobSvc: ShipmentLabelProcessingJob;
  /** Cada prueba vive en su propio día futuro (ver la cabecera). */
  let dayN = 400;

  const quote = (id: string): Promise<R> => h.api('POST', `/admin/shipments/${id}/quote`, { token: db.opToken, json: {} });
  const buy = (id: string, json: unknown): Promise<R> => {
    clock.advance(1);
    return h.api('POST', `/admin/shipments/${id}/label`, { token: db.opToken, json });
  };
  const row = (id: string) => h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id } });
  const audits = (id: string, action: string) => h.prisma.auditLog.findMany({ where: { entityId: id, action }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const purchases = () => fake.callsOf('purchase').map((c) => c.input as { input: PurchaseInput });
  const pickRate = (q: any) => q.rates.find((r: any) => r.deliveryKind !== 'branch' && r.marginCents >= 0 && !r.hidden) ?? q.rates[0];
  /** Corre el job con el reloj en `since + offset`. */
  const runAt = async (since: Date, offsetMs: number) => {
    clock.set(new Date(since.getTime() + offsetMs));
    return jobSvc.run();
  };
  const listed = (over: Partial<RecentProviderShipment> & { since: Date; carrier: string }): RecentProviderShipment => ({
    providerShipmentId: over.providerShipmentId ?? `y-${RUN}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: over.createdAt === undefined ? new Date(over.since.getTime() + 30_000).toISOString() : over.createdAt,
    carrierName: over.carrierName === undefined ? over.carrier : over.carrierName,
    totalCents: over.totalCents ?? null,
    postalCodeTo: over.postalCodeTo === undefined ? '01000' : over.postalCodeTo,
    source: 'api',
    hasError: over.hasError ?? false,
    providerReference: over.providerReference === undefined ? null : over.providerReference,
  });

  /** Una compra «en vuelo» (salió y no respondió). `created` ⇒ Skydropx SÍ la creó (aparece en el listado con nuestro folio). */
  const inFlight = async (created: boolean, trackingNumber?: string | null) => {
    dayN += 3;
    clock.set(new Date(Date.now() + dayN * D));
    const d = await db.mkDirect({ prices: [50000, 30000] });
    await ready(db, d.shipment.id);
    const q = await quote(d.shipment.id);
    expect(q.status).toBe(200);
    const rate = pickRate(q.body);
    fake.purchaseOutcomes.push({ kind: 'in_flight', created, ...(trackingNumber !== undefined ? { trackingNumber } : {}) });
    const r = await buy(d.shipment.id, buyBody(q.body, rate));
    expect(r.body.outcome).toBe('in_flight');
    const r0 = await row(d.shipment.id);
    const att = await h.prisma.shipmentLabelAttempt.findUniqueOrThrow({ where: { shipmentRequestId_since: { shipmentRequestId: d.shipment.id, since: r0.labelProcessingSince as Date } } });
    // Desde aquí, el doble cuenta SOLO lo que hace la verificación (la `purchase` del arreglo no cuenta).
    fake.calls.length = 0;
    return { id: d.shipment.id, d, since: r0.labelProcessingSince as Date, rate, ref: att.providerReference as string, attemptId: att.id, to: d.order.guestEmail as string };
  };

  beforeAll(async () => {
    ({ h, db, fake, clock, cfg } = await createLabelWorld(RUN));
    await purchaseOn(h, 'operators');
    await dial(h, 'operator_label_cap_24h_cents', 1_000_000_000);
    jobSvc = h.app.get(ShipmentLabelProcessingJob);
    const port = h.app.get<MailPort>(MAIL_PORT);
    jest.spyOn(port, 'send').mockImplementation(async (msg: MailMessage) => {
      bandeja.push(msg);
      return {};
    });
  });

  afterAll(async () => {
    await h.prisma.spendAlert.deleteMany({ where: { OR: [{ shipmentRequestId: { in: db.shipments } }, { subjectUserId: { in: [db.operatorId, db.adminId] } }, { dedupKey: { startsWith: 'ag7:' } }] } });
    await restoreDials(h);
    await db.cleanup();
    await h?.close();
  });

  beforeEach(async () => {
    fake.calls.length = 0;
    fake.purchaseOutcomes.length = 0;
    fake.balanceSequence.length = 0;
    fake.recentExtra.length = 0;
    fake.createdShipments.length = 0;
    fake.recentOverride = null;
    fake.purchaseBarrier = null;
    fake.onPurchase = null;
    fake.balanceCents = 10_000_000;
    fake.forgetQuotations();
    cfg.adoptionEnabled = false;
    cfg.negativeVerified = false;
    cfg.tDebitLagMs = 3 * H;
    cfg.tRefundLagMs = 3 * H;
    bandeja = [];
  });

  afterEach(async () => {
    // Los reclamos de esta prueba no siguen vivos en la siguiente (el job mira TODOS los reclamos en vuelo).
    await h.prisma.shipmentRequest.updateMany({
      where: { id: { in: db.shipments }, labelProcessingSince: { not: null }, providerShipmentId: null },
      data: { labelProcessingSince: null, providerRateId: null },
    });
  });

  // ================================================================ cadencia

  describe('la cadencia (§19.27.5 con §19.28.4)', () => {
    it('antes de since + PURCHASE_MAX_LIFE ⇒ no mira; luego cada minuto; a T_UNKNOWN escribe `label_verify_uncertain` UNA vez; en la cola, cada 10 min', async () => {
      const s = await inFlight(false);
      fake.calls.length = 0;
      await runAt(s.since, 2 * MIN);
      expect(fake.callsOf('recentShipments')).toHaveLength(0);
      await runAt(s.since, cfg.purchaseMaxLifeMs);
      expect(fake.callsOf('recentShipments')).toHaveLength(1);
      await runAt(s.since, cfg.purchaseMaxLifeMs + MIN);
      expect(fake.callsOf('recentShipments')).toHaveLength(2);
      await runAt(s.since, cfg.tUnknownMs + MIN);
      await runAt(s.since, cfg.tUnknownMs + 2 * MIN); // < 10 min desde la última mirada de cola ⇒ no mira
      const n = fake.callsOf('recentShipments').length;
      await runAt(s.since, cfg.tUnknownMs + 12 * MIN);
      expect(fake.callsOf('recentShipments').length).toBe(n + 1);
      const unc = await audits(s.id, 'shipment.label_verify_uncertain');
      expect(unc.map((u) => (u.after as any).reason)).toEqual(['not_calibrated']);
      expect((unc[0].after as any).actor).toBe('system:label-verify');
      // El DTO: `labelAlert.reason` = el de la bitácora.
      const dto = await h.api('GET', `/admin/shipments/${s.id}`, { token: db.adminToken });
      expect(dto.body.labelAlert).toEqual(expect.objectContaining({ kind: 'label_unknown', reason: 'not_calibrated', canRelease: true }));
      expect(purchases()).toHaveLength(0);
    });
  });

  // ================================================================ PS-124 — encontrada ⇒ se adopta, sin comprar

  describe('PS-124 — encontrada ⇒ se adopta (folio exacto), ⛔ 0 purchase', () => {
    it('Y (nuestro folio) y X (id ya de otro envío): adopta Y en la primera mirada; con número ⇒ guia y UN AV-4; bitácora `recent_list` con actor de sistema', async () => {
      cfg.adoptionEnabled = true;
      const s = await inFlight(true, `TN-${RUN}-124`);
      const y = fake.createdShipments.find((c) => c.providerReference === s.ref)!;
      expect(y).toBeDefined();
      // X: un id YA CONOCIDO (una guía pagada de OTRO envío, en el libro) que además lleva nuestro folio: si los `knownIds`
      // contaran como candidatos, saldrían DOS con nuestro folio (duplicado) y no se adoptaría nada.
      const xId = `x-${RUN}`;
      await h.prisma.shipmentPaidLabel.create({ data: { providerShipmentId: xId, shipmentRequestId: db.shipments[0], origin: 'response', chargedCents: 1 } });
      fake.addListed(listed({ since: s.since, carrier: s.rate.carrierName, providerShipmentId: xId, providerReference: s.ref }));
      fake.calls.length = 0;
      const r = await runAt(s.since, cfg.purchaseMaxLifeMs);
      expect(r.inFlight.adopted).toBe(1);
      const st = await row(s.id);
      expect(st).toEqual(expect.objectContaining({ status: 'guia', providerShipmentId: y.providerShipmentId, trackingNumber: `TN-${RUN}-124`, labelProcessingSince: null }));
      const [ad] = await audits(s.id, 'shipment.label_adopted');
      expect(ad.actorUserId).toBeNull();
      expect(ad.after).toEqual(expect.objectContaining({ via: 'recent_list', providerShipmentId: y.providerShipmentId, actor: 'system:label-verify' }));
      expect(bandeja.filter((m) => m.to === s.to)).toHaveLength(1);
      expect(purchases()).toHaveLength(0);
      expect(await h.prisma.shipmentPaidLabel.findUnique({ where: { providerShipmentId: y.providerShipmentId } })).toEqual(expect.objectContaining({ origin: 'adopted', attemptId: s.attemptId }));
      // Otra corrida ⇒ nada más (ya no hay reclamo en vuelo).
      await runAt(s.since, cfg.purchaseMaxLifeMs + MIN);
      expect(bandeja.filter((m) => m.to === s.to)).toHaveLength(1);
    });

    it('Y con error (rechazo con id) ⇒ «guía en proceso» con el id persistido (processing)', async () => {
      cfg.adoptionEnabled = true;
      const s = await inFlight(false);
      const y = listed({ since: s.since, carrier: s.rate.carrierName, providerReference: s.ref, hasError: true });
      fake.addListed(y, { error: { code: 'X', message: 'error' } });
      await runAt(s.since, cfg.purchaseMaxLifeMs);
      const st = await row(s.id);
      expect(st).toEqual(expect.objectContaining({ status: 'picking', providerShipmentId: y.providerShipmentId, trackingNumber: null }));
      expect(st.labelProcessingSince).not.toBeNull();
      expect(purchases()).toHaveLength(0);
    });

    it('S ya `cancelado` (contracargo durante la compra) ⇒ §19.18.3: guía persistida con auto_close y `cancel` UNA vez; bitácora con `via:recent_list_folio`', async () => {
      cfg.adoptionEnabled = true;
      const s = await inFlight(true, `TN-${RUN}-124c`);
      const y = fake.createdShipments.find((c) => c.providerReference === s.ref)!;
      await h.prisma.shipmentRequest.update({ where: { id: s.id }, data: { status: 'cancelado' } });
      await runAt(s.since, cfg.purchaseMaxLifeMs);
      const st = await row(s.id);
      expect(st).toEqual(expect.objectContaining({ status: 'cancelado', providerShipmentId: y.providerShipmentId, providerCancelReason: 'auto_close', trackingNumber: null, labelProcessingSince: null }));
      expect(fake.callsOf('cancel').map((c) => (c.input as any).providerShipmentId)).toEqual([y.providerShipmentId]);
      const [lc] = await audits(s.id, 'shipment.label_cancelled');
      expect(lc.after).toEqual(expect.objectContaining({ reason: 'auto_close', via: 'recent_list_folio', actor: 'system:label-verify' }));
      expect(purchases()).toHaveLength(0);
    });

    it('sin folio que cuadre y S `cancelado` ⇒ 0 adopción, 0 cancel (log `inflight_unattributed_on_cancelled`)', async () => {
      cfg.adoptionEnabled = true;
      const s = await inFlight(false);
      fake.addListed(listed({ since: s.since, carrier: s.rate.carrierName, totalCents: s.rate.breakdown.totalCents, providerReference: null }));
      await h.prisma.shipmentRequest.update({ where: { id: s.id }, data: { status: 'cancelado' } });
      await runAt(s.since, cfg.tUnknownMs + MIN);
      expect((await row(s.id)).providerShipmentId).toBeNull();
      expect(fake.callsOf('cancel')).toHaveLength(0);
    });

    it('TARDÍA: Y aparece solo a T+40 min ⇒ adoptada en una corrida de cola; antes, `uncertain` a T_UNKNOWN', async () => {
      cfg.adoptionEnabled = true;
      const s = await inFlight(true, `TN-${RUN}-late`);
      fake.recentOverride = () => ({ readable: true, coversFrom: true, shipments: [] });
      await runAt(s.since, cfg.purchaseMaxLifeMs);
      await runAt(s.since, cfg.tUnknownMs + MIN);
      expect((await audits(s.id, 'shipment.label_verify_uncertain')).map((u) => (u.after as any).reason)).toEqual(['not_calibrated']);
      fake.recentOverride = null;
      await runAt(s.since, 40 * MIN);
      expect((await row(s.id)).trackingNumber).toBe(`TN-${RUN}-late`);
      expect(purchases()).toHaveLength(0);
    });
  });

  // ================================================================ PS-125 — lo ambiguo nunca se adopta

  describe('PS-125 — lo ambiguo nunca se adopta; a T_UNKNOWN el motivo y `labelAlert.reason`', () => {
    it.each<[string, (s: Awaited<ReturnType<typeof inFlight>>) => Promise<void>, string]>([
      ['(b) nuestro folio con OTRA paquetería', async (s) => fake.addListed(listed({ since: s.since, carrier: s.rate.carrierName, carrierName: 'otra', providerReference: s.ref })), 'ambiguous'],
      ['(c) nuestro folio con OTRO CP', async (s) => fake.addListed(listed({ since: s.since, carrier: s.rate.carrierName, postalCodeTo: '99999', providerReference: s.ref })), 'ambiguous'],
      ['(d) solo la paquetería legible (sin total, sin CP, sin folio en el listado ni en el detalle)', async (s) => fake.addListed(listed({ since: s.since, carrier: s.rate.carrierName, postalCodeTo: null })), 'not_calibrated'],
      ['(e) S con `label_conflict`', async (s) => {
        await h.prisma.auditLog.create({ data: { action: 'shipment.label_conflict', entityType: 'ShipmentRequest', entityId: s.id, after: { otherShipmentId: null }, createdAt: new Date(s.since.getTime() + 1000) } });
      }, 'conflict'],
    ])('%s ⇒ no adopta; `label_verify_uncertain` con su motivo', async (_n, arrange, reason) => {
      cfg.adoptionEnabled = true;
      const s = await inFlight(false);
      await arrange(s);
      await runAt(s.since, cfg.purchaseMaxLifeMs);
      await runAt(s.since, cfg.tUnknownMs + MIN);
      expect((await row(s.id)).providerShipmentId).toBeNull();
      expect((await audits(s.id, 'shipment.label_verify_uncertain')).map((u) => (u.after as any).reason)).toEqual([reason]);
      const dto = await h.api('GET', `/admin/shipments/${s.id}`, { token: db.adminToken });
      expect(dto.body.labelAlert).toEqual(expect.objectContaining({ kind: 'label_unknown', reason }));
      expect(purchases()).toHaveLength(0);
    });

    it('(a) DOS con nuestro folio exacto ⇒ `uncertain(duplicate)` en el acto, dos filas `origin:duplicate` y dos `label_orphan`; la conciliación NO cancela (sin guía viva en S) y avisa AG-9 🔴', async () => {
      cfg.adoptionEnabled = true;
      const s = await inFlight(true);
      fake.addListed(listed({ since: s.since, carrier: s.rate.carrierName, providerReference: s.ref }), { trackingNumber: 'TN-DUP-2', carrierStatus: 'created' });
      const r = await runAt(s.since, cfg.purchaseMaxLifeMs);
      expect(r.inFlight.duplicates).toBe(2);
      expect((await audits(s.id, 'shipment.label_verify_uncertain')).map((u) => (u.after as any).reason)).toEqual(['duplicate']);
      const paid = await h.prisma.shipmentPaidLabel.findMany({ where: { shipmentRequestId: s.id } });
      expect(paid.map((p) => [p.origin, p.attemptId])).toEqual([['duplicate', s.attemptId], ['duplicate', s.attemptId]]);
      expect((await audits(s.id, 'shipment.label_orphan')).map((a) => (a.after as any).cause)).toEqual(['duplicate', 'duplicate']);
      expect(fake.callsOf('cancel')).toHaveLength(0);
      const ag9 = await h.prisma.spendAlert.findMany({ where: { shipmentRequestId: s.id, kind: 'label_charged_unexplained' } });
      expect(ag9.map((a) => [(a.facts as any).cause, a.severity]).sort()).toEqual([['duplicate', 'immediate'], ['duplicate', 'immediate']]);
      expect((await row(s.id)).providerShipmentId).toBeNull();
      expect(purchases()).toHaveLength(0);
    });
  });

  // ================================================================ PS-126 / PS-127 / PS-133 — la evidencia negativa

  describe('PS-126 — no cobró ⇒ se libera sola (constante INYECTADA en true)', () => {
    it('listado vacío con coversFrom, saldo = foto, lecturas a T+5 y T+7 ⇒ liberado a T+7 (`auto_verified`), 0 purchase/cancel; después el operador compra con UN purchase', async () => {
      cfg.negativeVerified = true;
      const s = await inFlight(false);
      await runAt(s.since, 5 * MIN);
      expect((await row(s.id)).labelProcessingSince).not.toBeNull();
      await runAt(s.since, 7 * MIN);
      const st = await row(s.id);
      expect(st).toEqual(expect.objectContaining({ labelProcessingSince: null, providerRateId: null, chosenRateJson: null, providerShipmentId: null }));
      const [rel] = await audits(s.id, 'shipment.label_released');
      expect(rel.after).toEqual(expect.objectContaining({ via: 'auto_verified', actor: 'system:label-verify', firstCleanAt: expect.any(String), lastCleanAt: expect.any(String) }));
      expect(await h.prisma.shipmentLabelAttempt.findUnique({ where: { id: s.attemptId } })).toEqual(expect.objectContaining({ outcome: 'not_charged', outcomeReason: 'auto_verified' }));
      expect(purchases()).toHaveLength(0);
      expect(fake.callsOf('cancel')).toHaveLength(0);
      const q = await quote(s.id);
      expect(errCode(await buy(s.id, buyBody(q.body, pickRate(q.body))))).toBe('200');
      expect(purchases()).toHaveLength(1);
    });

    it.each<[string, (s: Awaited<ReturnType<typeof inFlight>>) => Promise<void>]>([
      ['una sola lectura limpia', async (s) => {
        await runAt(s.since, 5 * MIN);
      }],
      ['limpia T+5, sucia T+6 (saldo −7625), limpia T+7', async (s) => {
        await runAt(s.since, 5 * MIN);
        fake.balanceCents = 10_000_000 - 7625;
        await runAt(s.since, 6 * MIN);
        fake.balanceCents = 10_000_000;
        await runAt(s.since, 7 * MIN);
      }],
      ['coversFrom:false en las dos lecturas', async (s) => {
        fake.recentOverride = () => ({ readable: true, coversFrom: false, shipments: [] });
        await runAt(s.since, 5 * MIN);
        await runAt(s.since, 7 * MIN);
      }],
      ['reclamo renovado entre lecturas (otro since) ⇒ el CAS de since exacto no suelta el nuevo', async (s) => {
        await runAt(s.since, 5 * MIN);
        const ns = new Date(s.since.getTime() + 1);
        await h.prisma.$executeRaw`UPDATE "ShipmentLabelAttempt" SET since = ${ns} WHERE id = ${s.attemptId}`;
        await h.prisma.shipmentRequest.update({ where: { id: s.id }, data: { labelProcessingSince: ns } });
        await runAt(s.since, 7 * MIN);
      }],
    ])('NO libera: %s', async (_n, play) => {
      cfg.negativeVerified = true;
      const s = await inFlight(false);
      await play(s);
      expect((await row(s.id)).labelProcessingSince).not.toBeNull();
      expect(await audits(s.id, 'shipment.label_released')).toHaveLength(0);
    });

    it('con la constante en false (el default): nunca se libera y a T+15 sale `not_calibrated`', async () => {
      const s = await inFlight(false);
      for (const m of [5, 7, 9]) await runAt(s.since, m * MIN);
      await runAt(s.since, cfg.tUnknownMs + MIN);
      expect((await row(s.id)).labelProcessingSince).not.toBeNull();
      expect(await audits(s.id, 'shipment.label_verify_clean')).toHaveLength(0);
      expect((await audits(s.id, 'shipment.label_verify_uncertain')).map((u) => (u.after as any).reason)).toEqual(['not_calibrated']);
    });
  });

  describe('PS-127 / PS-133 — contaminación ⇒ incierto (constante en true)', () => {
    const play = async (s: Awaited<ReturnType<typeof inFlight>>) => {
      await runAt(s.since, 5 * MIN);
      await runAt(s.since, 7 * MIN);
      await runAt(s.since, cfg.tUnknownMs + MIN);
    };
    const reasonOf = async (id: string) => (await audits(id, 'shipment.label_verify_uncertain')).map((u) => (u.after as any).reason);

    it('el saldo bajó EXACTAMENTE lo cotizado y el listado vacío ⇒ NO libera; `charged_not_found` + AG-9 (a) 🔴 una vez', async () => {
      cfg.negativeVerified = true;
      const s = await inFlight(false);
      fake.balanceCents = 10_000_000 - s.rate.priceCents;
      await play(s);
      await runAt(s.since, cfg.tUnknownMs + 12 * MIN);
      expect((await row(s.id)).labelProcessingSince).not.toBeNull();
      expect(await reasonOf(s.id)).toEqual(['charged_not_found']);
      const ag9 = await h.prisma.spendAlert.findMany({ where: { dedupKey: `ag9:nf:${s.attemptId}` } });
      expect(ag9).toEqual([expect.objectContaining({ severity: 'immediate', occurrenceCount: 1 })]);
    });

    it('el saldo SUBIÓ (recarga) ⇒ `balance_moved`', async () => {
      cfg.negativeVerified = true;
      const s = await inFlight(false);
      fake.balanceCents = 10_000_000 + 50_000;
      await play(s);
      expect(await reasonOf(s.id)).toEqual(['balance_moved']);
      expect((await row(s.id)).labelProcessingSince).not.toBeNull();
    });

    it.each<[string, (s: Awaited<ReturnType<typeof inFlight>>) => Promise<void>]>([
      ['un `label_cancelled` de OTRO envío en la ventana', async (s) => {
        await h.prisma.auditLog.create({ data: { action: 'shipment.label_cancelled', entityType: 'ShipmentRequest', entityId: db.shipments[0], after: {}, createdAt: new Date(s.since.getTime() + MIN) } });
      }],
      ['otro `label_requested` posterior a since (insertado directo)', async (s) => {
        await h.prisma.auditLog.create({ data: { action: 'shipment.label_requested', entityType: 'ShipmentRequest', entityId: db.shipments[0], after: {}, createdAt: new Date(s.since.getTime() + MIN) } });
      }],
      ['PS-133: un `label_cancelled` de otro envío a since − 2 h (reembolso tardío, dentro de T_REFUND_LAG)', async (s) => {
        await h.prisma.auditLog.create({ data: { action: 'shipment.label_cancelled', entityType: 'ShipmentRequest', entityId: db.shipments[0], after: {}, createdAt: new Date(s.since.getTime() - 2 * H) } });
      }],
      ['PS-133: un `label_purchase_sent` de otro envío a since − 1 h (débito tardío, dentro de T_DEBIT_LAG)', async (s) => {
        await h.prisma.auditLog.create({ data: { action: 'shipment.label_purchase_sent', entityType: 'ShipmentRequest', entityId: db.shipments[0], after: {}, createdAt: new Date(s.since.getTime() - H) } });
      }],
    ])('saldo igual pero %s ⇒ NO libera (el saldo no vota)', async (_n, contaminate) => {
      cfg.negativeVerified = true;
      const s = await inFlight(false);
      await contaminate(s);
      await play(s);
      expect((await row(s.id)).labelProcessingSince).not.toBeNull();
      expect(await audits(s.id, 'shipment.label_released')).toHaveLength(0);
      expect(await reasonOf(s.id)).toEqual(['unreadable']);
    });

    it('`balance` con 5xx en todas las lecturas ⇒ `unreadable`; sin la fila `label_purchase_sent` ⇒ `unreadable`', async () => {
      cfg.negativeVerified = true;
      const s = await inFlight(false);
      fake.onBalance = async () => {
        throw new Error('5xx');
      };
      await play(s);
      fake.onBalance = null;
      expect(await reasonOf(s.id)).toEqual(['unreadable']);
      const t = await inFlight(false);
      await h.prisma.auditLog.deleteMany({ where: { entityId: t.id, action: 'shipment.label_purchase_sent' } });
      await play(t);
      expect(await reasonOf(t.id)).toEqual(['unreadable']);
      expect((await row(t.id)).labelProcessingSince).not.toBeNull();
    });

    it('PS-133 cable trampa: `label_verify_clean` y luego `found` ⇒ `inflight_negative_violated`; y OTRO S con dos lecturas limpias ⇒ NO se libera (`not_calibrated`)', async () => {
      cfg.negativeVerified = true;
      cfg.adoptionEnabled = true;
      const s = await inFlight(false);
      await runAt(s.since, 5 * MIN);
      expect(await audits(s.id, 'shipment.label_verify_clean')).toHaveLength(1);
      fake.addListed(listed({ since: s.since, carrier: s.rate.carrierName, providerReference: s.ref }), { trackingNumber: 'TN-TRIP', carrierStatus: 'created' });
      await runAt(s.since, 6 * MIN);
      expect((await row(s.id)).trackingNumber).toBe('TN-TRIP');
      expect(await audits(s.id, 'shipment.inflight_negative_violated')).toHaveLength(1);
      const t = await inFlight(false);
      // El cable trampa vive 30 días: este S está en otro día futuro, así que la violación se mueve a su ventana.
      await h.prisma.$executeRaw`UPDATE "AuditLog" SET "createdAt" = ${new Date(t.since.getTime() - D)} WHERE action = 'shipment.inflight_negative_violated' AND "entityId" = ${s.id}`;
      await play(t);
      expect((await row(t.id)).labelProcessingSince).not.toBeNull();
      expect(await audits(t.id, 'shipment.label_verify_clean')).toHaveLength(0);
      expect(await reasonOf(t.id)).toEqual(['not_calibrated']);
    });
  });

  // ================================================================ PS-134 — I-SENT

  describe('PS-134 — «no salió» es un hecho local (I-SENT)', () => {
    it('(a) reclamo SIN 7b.2 (el proceso murió antes) ⇒ `pending` antes de la vida máxima; a since + PURCHASE_MAX_LIFE ⇒ liberado `auto_not_sent` con la constante en false, 0 purchase', async () => {
      const s = await inFlight(false);
      await h.prisma.$executeRaw`UPDATE "ShipmentLabelAttempt" SET "sentAt" = NULL, "providerReference" = NULL, "attemptNo" = NULL WHERE id = ${s.attemptId}`;
      await h.prisma.auditLog.deleteMany({ where: { entityId: s.id, action: 'shipment.label_purchase_sent' } });
      await runAt(s.since, cfg.purchaseMaxLifeMs - 1000);
      expect((await row(s.id)).labelProcessingSince).not.toBeNull();
      await runAt(s.since, cfg.purchaseMaxLifeMs);
      expect((await row(s.id)).labelProcessingSince).toBeNull();
      const [rel] = await audits(s.id, 'shipment.label_released');
      expect(rel.after).toEqual(expect.objectContaining({ via: 'auto_not_sent', actor: 'system:label-verify' }));
      expect(await h.prisma.shipmentLabelAttempt.findUnique({ where: { id: s.attemptId } })).toEqual(expect.objectContaining({ outcome: 'not_charged', outcomeReason: 'not_sent' }));
      expect(purchases()).toHaveLength(0);
    });

    it('(c) contra Postgres con el 7b REAL: reclamo, 7b comiteado, `purchase` del doble COLGADA, reloj en since + 180 s ⇒ el job NO libera (0 not_sent)', async () => {
      dayN += 3;
      clock.set(new Date(Date.now() + dayN * D));
      const d = await db.mkDirect({ prices: [50000, 30000] });
      await ready(db, d.shipment.id);
      const q = await quote(d.shipment.id);
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let entered!: () => void;
      const inside = new Promise<void>((r) => (entered = r));
      fake.purchaseBarrier = async () => {
        entered();
        await gate;
      };
      const pending = buy(d.shipment.id, buyBody(q.body, pickRate(q.body)));
      await inside;
      const st = await row(d.shipment.id);
      const since = st.labelProcessingSince as Date;
      const att = await h.prisma.shipmentLabelAttempt.findUniqueOrThrow({ where: { shipmentRequestId_since: { shipmentRequestId: d.shipment.id, since } } });
      expect(att.sentAt).not.toBeNull();
      fake.purchaseBarrier = null;
      await runAt(since, 180_000);
      expect((await row(d.shipment.id)).labelProcessingSince).toEqual(since);
      expect(await audits(d.shipment.id, 'shipment.label_released')).toHaveLength(0);
      release();
      const r = await pending;
      expect(errCode(r)).toBe('200');
    });
  });
});

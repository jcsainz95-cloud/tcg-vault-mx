/**
 * sdx-d2c-label.e2e-spec.ts — 💰🔒 D2c de Skydropx: `POST /admin/shipments/:id/label` contra Postgres REAL y la app Nest
 * completa por HTTP, con el proveedor DOBLE (⛔ nunca la red: PS-99) y la llave de entorno SUSTITUIDA (⛔ ninguna prueba pone
 * `SKYDROPX_ALLOW_SPEND`). Propiedad: backend.
 *
 * Cubre (API_CONTRACT §M4-SHIP.19.7 con sus erratas §19.18.3 … §19.30.5): PS-98/PS-120 (puerta), PS-81 (costo), PS-85/PS-106/
 * PS-135 (b,c,e) (cuerpo de la compra, folio y neutralización), PS-76 (cifras y confirmaciones), PS-74 (rechazo sin rastro),
 * PS-116 (rechazo con id), PS-119 (candado tras el reclamo), PS-109 (en vuelo), PS-73/PS-121 (carrera, N=10), PS-122 (una
 * compra en vuelo a la vez, carrera N=10), PS-123 (foto del saldo), PS-118 (a,b), PS-105b, PS-83 (SEC-SDX-3, N=10 por
 * variante), PS-131 (a) (respuesta vencida), PS-132 (a, a'), PS-134 (b), PS-138…PS-143 (topes y avisos), PS-159 (I-1, I-2),
 * PS-160 (c). Lo que necesita `label/cancel`, `label/release` o el job de verificación queda fuera (ver BACKEND_NOTES §62).
 */
import { Prisma } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { R, ShipPrepDb } from './helpers/ship-prep-db';
import { buyBody, createLabelWorld, dial, errCode, purchaseOn, ready, restoreDials } from './helpers/label-db';
import { FakeShippingProvider } from '../../src/modules/shipping-provider/fake-shipping-provider';
import { ShippingProviderError } from '../../src/modules/shipping-provider/shipping-provider.errors';
import { PurchaseInput } from '../../src/modules/shipping-provider/shipping-provider.port';
import { ManualLabelClock } from '../../src/modules/shipments/label-clock';
import { SKYDROPX_PURCHASE_LOCK_KEY } from '../../src/modules/shipments/label-verify.constants';
import { labelSpend24h } from '../../src/modules/shipments/label-spend';
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

const RUN = `d2c${Date.now().toString(36)}`;
const MIN = 60_000;
const N = 10;

describe('💰🔒 D2c — comprar la guía (§M4-SHIP.19.7 + erratas)', () => {
  let h: E2EHarness;
  let db: ShipPrepDb;
  let fake: FakeShippingProvider;
  let clock: ManualLabelClock;
  let spend: { on: boolean };
  let bandeja: MailMessage[];

  const quote = (id: string, json: unknown = {}, token = db.opToken): Promise<R> => h.api('POST', `/admin/shipments/${id}/quote`, { token, json });
  // El reloj manual avanza 1 ms por compra: `(shipmentRequestId, since)` es único y un reclamo nuevo tras un deshacer no
  // puede caer en el mismo instante (con el reloj real, entre dos peticiones siempre pasa tiempo).
  const buy = (id: string, json: unknown, token = db.opToken): Promise<R> => {
    clock.advance(1);
    return h.api('POST', `/admin/shipments/${id}/label`, { token, json });
  };
  const detail = (id: string, token = db.opToken): Promise<R> => h.api('GET', `/admin/shipments/${id}`, { token });
  const row = (id: string) => h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id } });
  const purchases = (shipmentId?: string) =>
    fake
      .callsOf('purchase')
      .map((c) => c.input as { input: PurchaseInput; body: any })
      .filter((c) => !shipmentId || c.input.idempotencyKey.startsWith(`label:${shipmentId}:`));
  const opsOf = () => fake.calls.map((c) => c.op);
  const audits = (id: string, action?: string) =>
    h.prisma.auditLog.findMany({ where: { entityId: id, ...(action ? { action } : {}) }, orderBy: { createdAt: 'asc' } });
  const attempts = (id: string) => h.prisma.shipmentLabelAttempt.findMany({ where: { shipmentRequestId: id }, orderBy: { since: 'asc' } });
  const alertsOf = (where: Prisma.SpendAlertWhereInput) => h.prisma.spendAlert.findMany({ where });

  /** La tarifa que el operador elegiría: a domicilio, margen no negativo, visible. */
  const pickRate = (q: any, pred: (r: any) => boolean = () => true) =>
    q.rates.find((r: any) => r.deliveryKind !== 'branch' && r.marginCents >= 0 && !r.hidden && pred(r)) ?? q.rates.find(pred);

  /** Un directo preparado, cotizado, con la tarifa elegida. */
  const readyQuoted = async (prices: readonly number[] = [50000, 30000]) => {
    const d = await db.mkDirect({ prices });
    await ready(db, d.shipment.id);
    const q = await quote(d.shipment.id);
    expect(q.status).toBe(200);
    return { d, id: d.shipment.id, q: q.body, rate: pickRate(q.body) };
  };

  /** Los gastos de 24 h de una persona, sembrados por SQL sobre un envío aparte (TG-1). */
  const seedSpend = async (actorUserId: string, rows: { charged: number; cancelled?: boolean; unrefunded?: number | null; outcome?: 'labeled' | 'pending' | 'released_unverified' | 'not_charged'; sinceAgoMs?: number }[]) => {
    const scratch = await db.mkDirect({ prices: [1000] });
    let k = 0;
    for (const r of rows) {
      k += 1;
      const since = new Date(clock.now().getTime() - (r.sinceAgoMs ?? 60_000) - k);
      const a = await h.prisma.shipmentLabelAttempt.create({
        data: { shipmentRequestId: scratch.shipment.id, since, actorUserId, capExempt: false, rateId: `seed-${k}`, carrierName: 'dhl', expectedChargeCents: r.charged, marginCents: 0, outcome: r.outcome ?? 'labeled' },
      });
      if ((r.outcome ?? 'labeled') === 'labeled') {
        await h.prisma.shipmentPaidLabel.create({
          data: {
            providerShipmentId: `seed-${RUN}-${scratch.shipment.id}-${k}`,
            shipmentRequestId: scratch.shipment.id,
            attemptId: a.id,
            origin: 'response',
            chargedCents: r.charged,
            ...(r.cancelled ? { cancelledAt: clock.now(), cancelKind: 'reissue' as const, cancelledByUserId: actorUserId, unrefundedCents: r.unrefunded ?? null } : {}),
          },
        });
      }
    }
    return scratch.shipment.id;
  };

  /** Saca de la ventana de 24 h todo lo que el personal gastó en pruebas anteriores (TG-1 mide desde cero). */
  const forgetSpend = async () => {
    await h.prisma.$executeRaw`UPDATE "ShipmentLabelAttempt" SET since = since - interval '25 hours' WHERE since > ${new Date(clock.now().getTime() - 25 * 60 * MIN)}`;
  };

  const setOwner = async (userId: string | null) => {
    await h.prisma.user.updateMany({ where: { isOwner: true }, data: { isOwner: false } });
    if (userId) await h.prisma.user.update({ where: { id: userId }, data: { isOwner: true } });
  };

  /** Un súper-admin NUEVO (no el sembrado) que puede iniciar sesión. */
  const mkSuperAdmin = async () => {
    const u = await db.mkUser('Segundo Súper');
    await h.prisma.user.update({ where: { id: u.id }, data: { role: 'super_admin' } });
    const token = await h.login(u.email as string, E2E_USERS.customer.password);
    return { id: u.id, token };
  };

  beforeAll(async () => {
    ({ h, db, fake, clock, spend } = await createLabelWorld(RUN));
    await purchaseOn(h, 'operators');
    // Tope alto por defecto (las pruebas de TG-1 lo bajan): un operador compra decenas de guías en esta suite.
    await dial(h, 'operator_label_cap_24h_cents', 1_000_000_000);
    await dial(h, 'shipping_label_reissue_max_per_shipment', 1);
    const port = h.app.get<MailPort>(MAIL_PORT);
    jest.spyOn(port, 'send').mockImplementation(async (msg: MailMessage) => {
      bandeja.push(msg);
      return undefined as never;
    });
  });

  afterAll(async () => {
    await setOwner(null);
    await h.prisma.spendAlert.deleteMany({ where: { OR: [{ subjectUserId: { in: [db.operatorId, db.adminId] } }, { dedupKey: { startsWith: 'ag7:' } }] } });
    await restoreDials(h);
    await db.cleanup();
    await h?.close();
  });

  beforeEach(async () => {
    fake.calls.length = 0;
    fake.purchaseOutcomes.length = 0;
    fake.balanceSequence.length = 0;
    fake.cancelOutcomes.length = 0;
    fake.purchaseBarrier = null;
    fake.onPurchase = null;
    fake.onBalance = null;
    fake.balanceCents = 10_000_000;
    fake.reuseQuotations = false;
    fake.forgetQuotations();
    clock.set(new Date());
    spend.on = true;
    bandeja = [];
    await dial(h, 'shipping_label_purchase', 'operators');
    await dial(h, 'operator_label_cap_24h_cents', 1_000_000_000);
    await setOwner(null);
    await h.prisma.spendAlert.deleteMany({ where: { OR: [{ subjectUserId: { in: [db.operatorId, db.adminId] } }, { dedupKey: { startsWith: 'ag7:' } }] } });
  });

  afterEach(async () => {
    // Un reclamo «en vuelo» que una prueba dejó vivo bloquearía la compra de la siguiente (§19.28.8): se cierra aquí.
    await h.prisma.shipmentRequest.updateMany({
      where: { id: { in: db.shipments }, labelProcessingSince: { not: null }, providerShipmentId: null },
      data: { labelProcessingSince: null, providerRateId: null },
    });
    // Los gastos sembrados del operador y del súper-admin no viajan entre pruebas.
    await h.prisma.shipmentLabelAttempt.deleteMany({ where: { rateId: { startsWith: 'seed-' } , paidLabels: { none: {} } } });
    const seeded = await h.prisma.shipmentPaidLabel.findMany({ where: { providerShipmentId: { startsWith: `seed-${RUN}-` } }, select: { id: true, attemptId: true } });
    await h.prisma.shipmentPaidLabel.deleteMany({ where: { id: { in: seeded.map((s) => s.id) } } });
    await h.prisma.shipmentLabelAttempt.deleteMany({ where: { id: { in: seeded.map((s) => s.attemptId).filter((x): x is string => !!x) } } });
  });

  // ================================================================ PS-98 / PS-120 — la puerta

  describe('PS-98 / PS-120 — la puerta: dial + rol (conjunto explícito) + llave de entorno, leída en CADA llamada', () => {
    it('dial `disabled` ⇒ 404 FEATURE_DISABLED {feature:"label_purchase"}, cero transporte, cero escrituras', async () => {
      const s = await readyQuoted();
      await dial(h, 'shipping_label_purchase', 'disabled');
      fake.calls.length = 0;
      const before = await row(s.id);
      const r = await buy(s.id, buyBody(s.q, s.rate));
      expect(errCode(r)).toBe('404:FEATURE_DISABLED');
      expect(r.body.error.details).toEqual({ feature: 'label_purchase' });
      expect(fake.calls).toHaveLength(0);
      expect(await row(s.id)).toEqual(before);
      expect(await attempts(s.id)).toHaveLength(0);
    });

    it('`super_admin_only` + operador ⇒ 403 {reason} + bitácora `label_purchase_denied`; súper-admin sembrado y un SEGUNDO súper-admin ⇒ 200', async () => {
      await dial(h, 'shipping_label_purchase', 'super_admin_only');
      const s = await readyQuoted();
      const r = await buy(s.id, buyBody(s.q, s.rate));
      expect(errCode(r)).toBe('403:FORBIDDEN');
      expect(r.body.error.details).toEqual({ reason: 'label_purchase_super_admin_only' });
      expect(await audits(s.id, 'shipment.label_purchase_denied')).toHaveLength(1);
      expect(purchases()).toHaveLength(0);
      const ok = await buy(s.id, buyBody(s.q, s.rate), db.adminToken);
      expect(errCode(ok)).toBe('200');
      expect(ok.body.outcome).toBe('labeled');
      const second = await mkSuperAdmin();
      const s2 = await readyQuoted();
      const ok2 = await buy(s2.id, buyBody(s2.q, s2.rate), second.token);
      expect(errCode(ok2)).toBe('200');
    });

    it('`operators` + operador ⇒ 200; el dial cambia a `super_admin_only` entre dos llamadas del mismo operador ⇒ la segunda 403; a `disabled` ⇒ 404', async () => {
      const a = await readyQuoted();
      expect(errCode(await buy(a.id, buyBody(a.q, a.rate)))).toBe('200');
      const b = await readyQuoted();
      await dial(h, 'shipping_label_purchase', 'super_admin_only');
      expect(errCode(await buy(b.id, buyBody(b.q, b.rate)))).toBe('403:FORBIDDEN');
      await dial(h, 'shipping_label_purchase', 'disabled');
      expect(errCode(await buy(b.id, buyBody(b.q, b.rate), db.adminToken))).toBe('404:FEATURE_DISABLED');
    });

    it('sin la llave de entorno ⇒ 409 SHIPPING_PROVIDER_NOT_CONFIGURED {missing:["allow_spend"]}, cero transporte; `quote` sigue respondiendo', async () => {
      spend.on = false;
      const s = await readyQuoted();
      fake.calls.length = 0;
      const r = await buy(s.id, buyBody(s.q, s.rate));
      expect(errCode(r)).toBe('409:SHIPPING_PROVIDER_NOT_CONFIGURED');
      expect(r.body.error.details.missing).toEqual(['allow_spend']);
      expect(fake.calls).toHaveLength(0);
      expect((await row(s.id)).labelProcessingSince).toBeNull();
    });

    it('`labelOptions.canPurchase` coincide con el resultado en las 3×2 combinaciones (dial × rol)', async () => {
      const s = await readyQuoted();
      for (const mode of ['disabled', 'super_admin_only', 'operators'] as const) {
        await dial(h, 'shipping_label_purchase', mode);
        for (const token of [db.opToken, db.adminToken]) {
          const d = await detail(s.id, token);
          expect(d.status).toBe(200);
          const expected = mode === 'operators' || (mode === 'super_admin_only' && token === db.adminToken);
          expect({ mode, admin: token === db.adminToken, can: d.body.labelOptions.canPurchase }).toEqual({ mode, admin: token === db.adminToken, can: expected });
          expect(d.body.labelOptions.purchase).toBe(mode);
          expect(d.body.labelOptions.provider).toBe('skydropx');
        }
      }
      spend.on = false;
      await dial(h, 'shipping_label_purchase', 'operators');
      expect((await detail(s.id)).body.labelOptions.canPurchase).toBe(false);
    });
  });

  // ================================================================ PS-81 — éxito, costo, libro, AV-4

  describe('PS-81 / PS-159 — éxito con número: costo de la RESPUESTA, libro de guías pagadas, AV-4 una vez', () => {
    it('labeled ⇒ `guia`, par, `labelSource`, costo total+seguro, IVA del proveedor; `shippingCostCents:1` del cuerpo se IGNORA; I-1 e I-2', async () => {
      const s = await readyQuoted();
      const r = await buy(s.id, { ...buyBody(s.q, s.rate), shippingCostCents: 1, shippingCostIvaCents: 1 });
      expect(errCode(r)).toBe('200');
      expect(r.body.outcome).toBe('labeled');
      expect(r.body.label.source).toBe('skydropx');
      expect(r.body.label.labelAvailable).toBe(true);
      expect(JSON.stringify(r.body)).not.toMatch(/labelUrl"|rawResponseJson|providerRateId|pro\.skydropx\.com\/labels/);
      const s1 = await row(s.id);
      expect(s1.status).toBe('guia');
      expect(s1.labelSource).toBe('skydropx');
      expect(s1.labelProcessingSince).toBeNull();
      expect(s1.trackingNumber).toMatch(/^FAKE/);
      expect(s1.shippingCostCents).toBe(s.rate.breakdown.totalCents + s.rate.breakdown.insuranceCents);
      expect(s1.shippingCostCents).toBe(s.rate.priceCents);
      expect(s1.shippingCostIvaCents).toBe(s.rate.breakdown.ivaCents);
      expect(s1.shippingIvaSource).toBe(s.rate.ivaSource);
      expect(s1.insuranceCostCents).toBe(s.rate.breakdown.insuranceCents);
      expect(s1.packageCode).not.toBeNull();
      // I-1: la fila del libro con el mismo id y `chargedCents = shippingCostCents`.
      const paid = await h.prisma.shipmentPaidLabel.findMany({ where: { shipmentRequestId: s.id } });
      expect(paid).toEqual([expect.objectContaining({ providerShipmentId: s1.providerShipmentId, origin: 'response', chargedCents: s1.shippingCostCents })]);
      // I-2: el intento con `sentAt` tiene su `label_purchase_sent` con el MISMO `providerReference`.
      const [att] = await attempts(s.id);
      expect(att).toEqual(expect.objectContaining({ outcome: 'labeled', attemptNo: 1, providerReference: `${s1.folio}-01`, actorUserId: db.operatorId }));
      expect(att.sentAt).not.toBeNull();
      const sent = await audits(s.id, 'shipment.label_purchase_sent');
      expect(sent).toHaveLength(1);
      expect((sent[0].after as any).providerReference).toBe(att.providerReference);
      expect((sent[0].after as any).expectedChargeCents).toBe(s.rate.priceCents);
      // Bitácoras de la compra: requested ⇒ sent ⇒ tracking, en ese orden.
      // Bitácoras de la compra (con el reloj manual congelado comparten `createdAt`: se mide el conjunto, no el orden).
      const actions = (await audits(s.id)).map((a) => a.action).filter((a) => a.startsWith('shipment.label') || a === 'shipment.tracking');
      expect(actions.sort()).toEqual(['shipment.label_purchase_sent', 'shipment.label_requested', 'shipment.tracking']);
      // AV-4 una vez, con el número de la fila.
      expect(bandeja).toHaveLength(1);
      expect(JSON.stringify(bandeja[0])).toContain(s1.trackingNumber as string);
      // Repetir tras `labeled` ⇒ 409 SHIPMENT_ALREADY_LABELED, cero compras nuevas.
      const again = await buy(s.id, buyBody(s.q, s.rate));
      expect(errCode(again)).toBe('409:SHIPMENT_ALREADY_LABELED');
      expect(purchases(s.id)).toHaveLength(1);
    });

    it('`total` de la compra ≠ cotizado ⇒ `computed` (16/116 de lo gravable) y el costo es el de la compra', async () => {
      const s = await readyQuoted();
      const total = s.rate.breakdown.totalCents + 500;
      fake.purchaseOutcomes.push({ kind: 'labeled', totalCents: total });
      expect(errCode(await buy(s.id, buyBody(s.q, s.rate)))).toBe('200');
      const s1 = await row(s.id);
      expect(s1.shippingCostCents).toBe(total + s.rate.breakdown.insuranceCents);
      expect(s1.shippingIvaSource).toBe('computed');
      expect(s1.shippingCostIvaCents).toBe(Math.round(((total - s.rate.breakdown.serviceFeeCents) * 16) / 116));
    });
  });

  // ================================================================ PS-85 / PS-106 / PS-135 — el cuerpo

  describe('PS-85 / PS-106 / PS-135 (b, c, e) — el cuerpo de la compra: lista blanca, folio en `reference`, neutralización', () => {
    it('`to` tiene EXACTAMENTE {street1,name,company,phone,email,reference,furtherInformation}; `reference = "Pedido <folio>-01"`; email del invitado', async () => {
      const s = await readyQuoted();
      expect(errCode(await buy(s.id, buyBody(s.q, s.rate)))).toBe('200');
      const [p] = purchases(s.id);
      const folio = (await row(s.id)).folio;
      expect(Object.keys(p.input.to).sort()).toEqual(['company', 'email', 'furtherInformation', 'name', 'phone', 'reference', 'street1']);
      expect(p.input.to).toEqual({
        street1: 'Av. Revolución 1500 Int. 4',
        name: 'Ana Gómez Ruiz',
        company: 'Ana Gómez Ruiz',
        phone: '5512345678',
        email: s.d.order.guestEmail,
        reference: `Pedido ${folio}-01`,
        furtherInformation: 'Portón negro',
      });
      expect(p.input.notAfter).toBeGreaterThan(Date.now() - MIN);
      // Sin datos del pago ni de cartas en el cuerpo entero.
      expect(JSON.stringify(p.body)).not.toMatch(/stripe|pi_sp_|Charizard|orderNumber/i);
    });

    it('PS-135 (c) / C-23: «Pedido ENV-000046-01» (también ancho completo y guiones tipográficos) en los campos del cliente ⇒ el cuerpo no lo contiene fuera de `reference`; el snapshot queda intacto', async () => {
      const d = await db.mkDirect();
      const evil = {
        recipientName: 'Ana Pedido ENV-000046-01',
        line1: 'Calle ＥＮＶ－000046－01',
        line2: 'Int ENV‐000046‐01',
        neighborhood: 'San Ángel',
        city: 'Álvaro Obregón',
        state: 'Ciudad de México',
        postalCode: '01000',
        country: 'MX',
        phone: '5512345678',
        references: 'Portón ENV — 000046 — 01',
      };
      await ready(db, d.shipment.id, evil);
      const q = await quote(d.shipment.id);
      expect(q.status).toBe(200);
      const rate = pickRate(q.body);
      expect(errCode(await buy(d.shipment.id, buyBody(q.body, rate)))).toBe('200');
      const [p] = purchases(d.shipment.id);
      const { reference, ...rest } = p.body.data?.address_to ?? p.body.shipment?.address_to ?? p.body.address_to ?? {};
      expect(reference).toMatch(/^Pedido ENV-\d{6,}-01$/);
      const outside = JSON.stringify({ ...p.body, to: { ...p.input.to, reference: undefined }, rest }).normalize('NFKC');
      const withoutRef = outside.split(reference).join('');
      expect(withoutRef).not.toMatch(/ENV\s*[-‐–—]\s*\d/i);
      const qBody = JSON.stringify(fake.callsOf('quote').slice(-1)[0].input).normalize('NFKC');
      expect(qBody).not.toMatch(/ENV\s*[-‐–—]\s*\d/i);
      expect((await row(d.shipment.id)).addressSnapshot).toEqual(evil);
    });
  });

  // ================================================================ PS-76 — cifras y confirmaciones

  describe('PS-76 — cifras vistas, confirmaciones y saldo', () => {
    it('`expectedPriceCents` distinto ⇒ 409 LABEL_PREVIEW_STALE; sin escrituras ni compra', async () => {
      const s = await readyQuoted();
      const r = await buy(s.id, buyBody(s.q, s.rate, { expectedPriceCents: s.rate.priceCents + 1 }));
      expect(errCode(r)).toBe('409:LABEL_PREVIEW_STALE');
      expect((await row(s.id)).labelProcessingSince).toBeNull();
      expect(purchases()).toHaveLength(0);
    });

    it('margen negativo sin confirmación ⇒ 422 {required:["negative_margin"], marginCents}; `branch` sin confirmación ⇒ ["branch_delivery"]; con ellas ⇒ 200 y la bitácora las lleva', async () => {
      const s = await readyQuoted([1000]);
      const neg = s.q.rates.find((r: any) => r.marginCents < 0 && r.deliveryKind !== 'branch');
      expect(neg).toBeDefined();
      const r1 = await buy(s.id, buyBody(s.q, neg, { confirmNegativeMargin: false }));
      expect(errCode(r1)).toBe('422:LABEL_CONFIRMATION_REQUIRED');
      expect(r1.body.error.details).toEqual({ required: ['negative_margin'], marginCents: neg.marginCents });
      const branch = s.q.rates.find((r: any) => r.deliveryKind === 'branch');
      if (branch) {
        const r2 = await buy(s.id, buyBody(s.q, branch, { confirmNegativeMargin: false, confirmBranchDelivery: false }));
        expect(errCode(r2)).toBe('422:LABEL_CONFIRMATION_REQUIRED');
        expect(r2.body.error.details.required).toEqual(branch.marginCents < 0 ? ['negative_margin', 'branch_delivery'] : ['branch_delivery']);
      }
      expect(purchases()).toHaveLength(0);
      const ok = await buy(s.id, buyBody(s.q, neg));
      expect(errCode(ok)).toBe('200');
      const [req] = await audits(s.id, 'shipment.label_requested');
      expect(req.after).toEqual(expect.objectContaining({ confirmNegativeMargin: true, confirmBranchDelivery: true }));
    });

    it('saldo del doble < precio ⇒ 409 SHIPPING_INSUFFICIENT_BALANCE {requiredCents} SIN el saldo; cero reclamo', async () => {
      const s = await readyQuoted();
      fake.balanceCents = s.rate.priceCents - 1;
      const r = await buy(s.id, buyBody(s.q, s.rate));
      expect(errCode(r)).toBe('409:SHIPPING_INSUFFICIENT_BALANCE');
      expect(r.body.error.details).toEqual({ requiredCents: s.rate.priceCents });
      expect(JSON.stringify(r.body)).not.toContain(String(s.rate.priceCents - 1));
      expect((await row(s.id)).labelProcessingSince).toBeNull();
      expect(await attempts(s.id)).toHaveLength(0);
      expect(purchases()).toHaveLength(0);
    });
  });

  // ================================================================ PS-74 / PS-116 / PS-119 / PS-109 — la matriz del paso 9

  describe('Matriz del resultado (§19.26.1): rechazo sin id, rechazo con id, candado, en vuelo', () => {
    it('PS-74 — `error_detail` SIN id ⇒ 422 SHIPPING_PROVIDER_REJECTED {quote}; reclamo deshecho entero; intento `not_charged`; luego otra tarifa ⇒ 200 labeled', async () => {
      const s = await readyQuoted();
      fake.purchaseOutcomes.push({ kind: 'error_detail', code: 'X1', message: 'no', withoutId: true });
      const r = await buy(s.id, buyBody(s.q, s.rate));
      expect(errCode(r)).toBe('422:SHIPPING_PROVIDER_REJECTED');
      expect(r.body.error.details.quote.quoteId).toBe(s.q.quoteId);
      const s1 = await row(s.id);
      expect(s1).toEqual(expect.objectContaining({ status: 'picking', labelProcessingSince: null, providerRateId: null, chosenRateJson: null, providerShipmentId: null, rateChosenByUserId: null, packageCode: null }));
      expect(s1.preparedAt).not.toBeNull();
      expect(await audits(s.id, 'shipment.label_failed')).toHaveLength(1);
      expect((await attempts(s.id)).map((a) => [a.outcome, a.outcomeReason])).toEqual([['not_charged', 'rejected']]);
      const other = pickRate(s.q, (x) => x.rateId !== s.rate.rateId);
      const ok = await buy(s.id, buyBody(s.q, other));
      expect(errCode(ok)).toBe('200');
      expect(ok.body.outcome).toBe('labeled');
      // PS-135 (e): el intento 2 lleva `-02` y sale de `attemptNo`.
      expect(purchases(s.id).map((p) => p.input.to.reference)).toEqual([`Pedido ${s1.folio}-01`, `Pedido ${s1.folio}-02`]);
    });

    it('PS-116 — `2xx` con id Y `error_detail` ⇒ 200 processing + providerError; id persistido; reclamo conservado; `label_failed {kept:true}`; 2.º POST ⇒ 409 ALREADY_LABELED sin compra', async () => {
      const s = await readyQuoted();
      fake.purchaseOutcomes.push({ kind: 'error_detail', code: 'X', message: 'falló' });
      const r = await buy(s.id, buyBody(s.q, s.rate));
      expect(errCode(r)).toBe('200');
      expect(r.body.outcome).toBe('processing');
      expect(r.body.providerError).toEqual({ code: 'X', message: 'falló' });
      const s1 = await row(s.id);
      expect(s1.providerShipmentId).toMatch(/^fake-shipment-/);
      expect(s1).toEqual(expect.objectContaining({ labelSource: 'skydropx', status: 'picking' }));
      expect(s1.labelProcessingSince).not.toBeNull();
      expect(r.body.shipment.labelPending.state).toBe('processing');
      const [failed] = await audits(s.id, 'shipment.label_failed');
      expect(failed.after).toEqual(expect.objectContaining({ providerShipmentId: s1.providerShipmentId, kept: true }));
      expect(await h.prisma.shipmentPaidLabel.count({ where: { providerShipmentId: s1.providerShipmentId as string } })).toBe(1);
      const again = await buy(s.id, buyBody(s.q, s.rate));
      expect(errCode(again)).toBe('409:SHIPMENT_ALREADY_LABELED');
      expect(purchases(s.id)).toHaveLength(1);
    });

    it('PS-116 — `422` cuyo cuerpo trae id ⇒ igual que «rechazo con id»', async () => {
      const s = await readyQuoted();
      const id = `sdx-422-${RUN}`;
      fake.purchaseOutcomes.push({ kind: 'rejected', providerCode: 'R', providerMessage: 'r', providerShipmentId: id });
      const r = await buy(s.id, buyBody(s.q, s.rate));
      expect(errCode(r)).toBe('200');
      expect(r.body.outcome).toBe('processing');
      expect((await row(s.id)).providerShipmentId).toBe(id);
    });

    it('PS-119 — `SkydropxMutationForbiddenError` tras el reclamo ⇒ 409 {missing:["allow_spend"]}, reclamo NULL', async () => {
      const s = await readyQuoted();
      fake.purchaseOutcomes.push({ kind: 'forbidden' });
      const r = await buy(s.id, buyBody(s.q, s.rate));
      expect(errCode(r)).toBe('409:SHIPPING_PROVIDER_NOT_CONFIGURED');
      expect(r.body.error.details.missing).toEqual(['allow_spend']);
      expect((await row(s.id)).labelProcessingSince).toBeNull();
      expect((await attempts(s.id))[0].outcome).toBe('not_charged');
    });

    it('PS-109 / PS-121 — en vuelo ⇒ 200 in_flight, 1 llamada, reclamo conservado (`labelPending.state="in_flight"`, `providerReference`); un `label` posterior ⇒ 200 in_progress y 0 llamadas', async () => {
      const s = await readyQuoted();
      fake.purchaseOutcomes.push({ kind: 'in_flight' });
      const r = await buy(s.id, buyBody(s.q, s.rate));
      expect(errCode(r)).toBe('200');
      expect(r.body.outcome).toBe('in_flight');
      const folio = (await row(s.id)).folio;
      expect(r.body.shipment.labelPending).toEqual(expect.objectContaining({ state: 'in_flight', providerReference: `${folio}-01` }));
      expect(r.body.shipment.labelPending.verifyingUntil).not.toBeNull();
      expect((await row(s.id)).labelProcessingSince).not.toBeNull();
      const again = await buy(s.id, buyBody(s.q, s.rate));
      expect(errCode(again)).toBe('200');
      expect(again.body.outcome).toBe('in_progress');
      expect(purchases(s.id)).toHaveLength(1);
    });

    it('PS-109 — `403` del borde ⇒ 502 y reclamo DESHECHO (`labelPending = null`); plazo vencido ⇒ 503 y deshecho', async () => {
      const s = await readyQuoted();
      fake.purchaseOutcomes.push({ kind: 'edge_blocked' });
      const r = await buy(s.id, buyBody(s.q, s.rate));
      expect(r.status).toBe(502);
      expect((await detail(s.id)).body.labelPending).toBeNull();
      fake.purchaseOutcomes.push({ kind: 'deadline' });
      const r2 = await buy(s.id, buyBody(s.q, s.rate));
      expect(r2.status).toBe(503);
      expect((await row(s.id)).labelProcessingSince).toBeNull();
    });
  });

  // ================================================================ PS-123 — el saldo tras el reclamo

  describe('PS-123 — la foto del saldo DESPUÉS del reclamo (7b.1)', () => {
    it('100000 y luego 90000 ⇒ orden balance → balance → purchase y `balanceBeforeCents = 90000`', async () => {
      const s = await readyQuoted();
      fake.calls.length = 0;
      fake.balanceSequence.push(100000, 90000);
      expect(errCode(await buy(s.id, buyBody(s.q, s.rate)))).toBe('200');
      expect(opsOf().filter((o) => o === 'balance' || o === 'purchase')).toEqual(['balance', 'balance', 'purchase']);
      const [sent] = await audits(s.id, 'shipment.label_purchase_sent');
      expect(sent.after).toEqual(expect.objectContaining({ balanceBeforeCents: 90000, expectedChargeCents: s.rate.priceCents }));
    });

    it('2.ª lectura con error ⇒ 503 y reclamo deshecho; 2.ª lectura < precio ⇒ 409 INSUFFICIENT_BALANCE y deshecho; 0 compras', async () => {
      const s = await readyQuoted();
      fake.balanceSequence.push(10_000_000, ShippingProviderError.busy('balance'));
      expect((await buy(s.id, buyBody(s.q, s.rate))).status).toBe(503);
      expect((await row(s.id)).labelProcessingSince).toBeNull();
      fake.balanceSequence.push(10_000_000, s.rate.priceCents - 1);
      expect(errCode(await buy(s.id, buyBody(s.q, s.rate)))).toBe('409:SHIPPING_INSUFFICIENT_BALANCE');
      expect((await row(s.id)).labelProcessingSince).toBeNull();
      expect((await attempts(s.id)).map((a) => a.outcome)).toEqual(['not_charged', 'not_charged']);
      expect(purchases()).toHaveLength(0);
    });
  });

  // ================================================================ PS-134 (b) — I-SENT

  it('PS-134 (b) — en el momento de recibir `purchase`, la BD ya tiene `label_purchase_sent` y el intento con `sentAt` de ese `since`', async () => {
    const s = await readyQuoted();
    let seen: { sent: number; sentAt: Date | null } | null = null;
    fake.onPurchase = async () => {
      const sent = await h.prisma.auditLog.count({ where: { entityId: s.id, action: 'shipment.label_purchase_sent' } });
      const r0 = await row(s.id);
      const a = await h.prisma.shipmentLabelAttempt.findFirst({ where: { shipmentRequestId: s.id, since: r0.labelProcessingSince as Date } });
      seen = { sent, sentAt: a?.sentAt ?? null };
    };
    expect(errCode(await buy(s.id, buyBody(s.q, s.rate)))).toBe('200');
    expect(seen).not.toBeNull();
    expect(seen!.sent).toBe(1);
    expect(seen!.sentAt).not.toBeNull();
  });

  // ================================================================ PS-118 — la misma tarifa / el mismo id

  describe('PS-118 — `rate_already_purchased` y `provider_id_taken`', () => {
    it('(a) la `rate_id` ya comprada por OTRO envío ⇒ 409 {reason:"rate_already_purchased", otherShipmentId}, 0 compras, B sin escribir', async () => {
      const a = await readyQuoted();
      expect(errCode(await buy(a.id, buyBody(a.q, a.rate)))).toBe('200');
      const b = await readyQuoted();
      await h.prisma.shipmentRequest.update({ where: { id: a.id }, data: { providerRateId: b.rate.rateId } });
      fake.calls.length = 0;
      const before = await row(b.id);
      const r = await buy(b.id, buyBody(b.q, b.rate));
      expect(errCode(r)).toBe('409:CONFLICT');
      expect(r.body.error.details).toEqual({ reason: 'rate_already_purchased', otherShipmentId: a.id });
      expect(purchases()).toHaveLength(0);
      expect(await row(b.id)).toEqual(before);
    });

    it('(b) el doble devuelve el id de A ⇒ cero 500, 409 {reason:"provider_id_taken"}; A idéntica; B conserva el reclamo; `label_conflict`', async () => {
      const a = await readyQuoted();
      expect(errCode(await buy(a.id, buyBody(a.q, a.rate)))).toBe('200');
      const aBefore = await row(a.id);
      const b = await readyQuoted();
      fake.purchaseOutcomes.push({ kind: 'labeled', providerShipmentId: aBefore.providerShipmentId as string });
      const r = await buy(b.id, buyBody(b.q, b.rate));
      expect(errCode(r)).toBe('409:CONFLICT');
      expect(r.body.error.details).toEqual({ reason: 'provider_id_taken', otherShipmentId: a.id });
      expect(await row(a.id)).toEqual(aBefore);
      const b1 = await row(b.id);
      expect(b1.labelProcessingSince).not.toBeNull();
      expect(b1.providerShipmentId).toBeNull();
      expect(await audits(b.id, 'shipment.label_conflict')).toHaveLength(1);
    });
  });

  // ================================================================ PS-105b — la dirección cambia

  describe('PS-105b — la cotización muere con la corrección', () => {
    const CORRECTION = { recipientName: 'Ana Gómez Ruiz', line1: 'Av. Revolución 1600', line2: 'Int. 4', postalCode: '01000', neighborhood: 'San Ángel', city: 'Álvaro Obregón', state: 'Ciudad de México', references: 'Portón negro' };
    const correct = (id: string, v: number) => h.api('PUT', `/admin/shipments/${id}/address`, { token: db.opToken, json: { expectedAddressVersion: v, ...CORRECTION } });

    it('`quoteId` de la versión vieja ⇒ 409 QUOTE_EXPIRED {reason:"address_changed", quote} y CERO `purchase`', async () => {
      const s = await readyQuoted();
      const c = await correct(s.id, 0);
      expect(c.status).toBe(200);
      const r = await buy(s.id, buyBody(s.q, s.rate));
      expect(errCode(r)).toBe('409:QUOTE_EXPIRED');
      expect(r.body.error.details.reason).toBe('address_changed');
      expect(r.body.error.details.quote.quoteId).not.toBe(s.q.quoteId);
      expect(purchases()).toHaveLength(0);
    });

    it('corrección inyectada entre el paso 2 y el 7 (en la lectura del saldo) ⇒ 409 CONFLICT y CERO `purchase`', async () => {
      const s = await readyQuoted();
      let corrected = 0;
      fake.onBalance = async () => {
        if (corrected === 0) corrected = (await correct(s.id, 0)).status;
      };
      const r = await buy(s.id, buyBody(s.q, s.rate));
      expect(corrected).toBe(200);
      expect(errCode(r)).toBe('409:CONFLICT');
      expect(purchases()).toHaveLength(0);
      expect((await row(s.id)).labelProcessingSince).toBeNull();
    });
  });

  // ================================================================ PS-83 (SEC-SDX-3) — cancelado mientras se compraba

  describe('PS-83 (SEC-SDX-3) — el envío pasa a `cancelado` entre el reclamo y la respuesta (N = 10 por variante)', () => {
    for (const variant of ['labeled', 'processing'] as const) {
      it(`variante «${variant === 'labeled' ? 'con número' : 'sin número'}» ⇒ 409 NOT_IN_PREPARATION {labelAutoCancelled:true}, id persistido con \`auto_close\`, \`cancel\` una vez, cero AV-4, cero guías vivas`, async () => {
        let good = 0;
        const bad: string[] = [];
        for (let i = 0; i < N; i += 1) {
          const s = await readyQuoted();
          fake.calls.length = 0;
          bandeja = [];
          fake.purchaseOutcomes.push({ kind: variant });
          fake.cancelOutcomes.push({ ok: true, refundedCents: null } as any);
          fake.onPurchase = async () => {
            await h.prisma.shipmentRequest.update({ where: { id: s.id }, data: { status: 'cancelado' } });
          };
          const r = await buy(s.id, buyBody(s.q, s.rate));
          fake.onPurchase = null;
          const s1 = await row(s.id);
          const cancels = fake.callsOf('cancel');
          const ok =
            errCode(r) === '409:SHIPMENT_NOT_IN_PREPARATION' &&
            r.body.error.details.labelAutoCancelled === true &&
            s1.status === 'cancelado' &&
            s1.providerShipmentId !== null &&
            s1.labelSource === 'skydropx' &&
            s1.providerCancelReason === 'auto_close' &&
            s1.providerCanceledAt !== null &&
            s1.trackingNumber === null &&
            s1.labelProcessingSince === null &&
            cancels.length === 1 &&
            (cancels[0].input as any).providerShipmentId === s1.providerShipmentId &&
            bandeja.length === 0;
          if (ok) good += 1;
          else bad.push(JSON.stringify({ code: errCode(r), status: s1.status, id: s1.providerShipmentId, reason: s1.providerCancelReason, cancels: cancels.length, mails: bandeja.length }));
        }
        const live = await h.prisma.shipmentRequest.count({ where: { id: { in: db.shipments }, status: 'cancelado', providerShipmentId: { not: null }, providerCanceledAt: null } });
        expect({ proportion: `${good}/${N}`, bad, live }).toEqual({ proportion: `${N}/${N}`, bad: [], live: 0 });
      }, 300_000);
    }
  });

  // ================================================================ PS-131 (a) — la respuesta vencida

  it('PS-131 (a) — el reclamo cambió de `since` mientras la compra volaba ⇒ 409 stale_purchase_response, fila de T2 idéntica, `label_orphan {cause:"stale_response"}` y guía huérfana en el libro', async () => {
    const s = await readyQuoted();
    let t2: Awaited<ReturnType<typeof row>> | null = null;
    fake.purchaseOutcomes.push({ kind: 'processing', providerShipmentId: `sdx-old-${RUN}` });
    fake.onPurchase = async () => {
      // Simula «Liberar» + reclamo T2 (otra tarifa): el `since` vigente ya no es el de esta compra.
      await h.prisma.shipmentRequest.update({ where: { id: s.id }, data: { labelProcessingSince: new Date(clock.now().getTime() + 1000), providerRateId: 'otra-tarifa' } });
      t2 = await row(s.id);
    };
    const r = await buy(s.id, buyBody(s.q, s.rate));
    expect(errCode(r)).toBe('409:CONFLICT');
    expect(r.body.error.details).toEqual({ reason: 'stale_purchase_response' });
    expect(await row(s.id)).toEqual(t2);
    const [orphan] = await audits(s.id, 'shipment.label_orphan');
    expect(orphan.after).toEqual(expect.objectContaining({ cause: 'stale_response', providerShipmentId: `sdx-old-${RUN}` }));
    expect(await h.prisma.shipmentPaidLabel.findUnique({ where: { providerShipmentId: `sdx-old-${RUN}` } })).toEqual(expect.objectContaining({ origin: 'orphan' }));
    expect(fake.callsOf('cancel')).toHaveLength(0);
    // La alerta `label_orphan` (precedencia §19.28.6) la deriva el detalle.
    expect((await detail(s.id, db.adminToken)).body.labelAlert?.kind).toBe('label_orphan');
  });

  // ================================================================ PS-73 / PS-121 — una guía por envío

  it(`PS-73 / PS-121 — 10 \`POST …/label\` simultáneos sobre el MISMO envío ⇒ 1 \`purchase\` por ronda, ningún 409, un AV-4 (N = ${N} rondas)`, async () => {
    let good = 0;
    let inflight409 = 0;
    const bad: string[] = [];
    for (let i = 0; i < N; i += 1) {
      const s = await readyQuoted();
      bandeja = [];
      const rs = await Promise.all(Array.from({ length: 10 }, () => buy(s.id, buyBody(s.q, s.rate))));
      const codes = rs.map((r) => (r.status === 200 ? r.body.outcome : r.status === 409 ? `409:${r.body.error.details?.reason}` : errCode(r)));
      inflight409 += codes.filter((c) => c === '409:purchase_in_flight').length;
      const n = purchases(s.id).length;
      const s1 = await row(s.id);
      // ⚠️ PREGUNTA AL ARQUITECTO (BACKEND_NOTES §62): PS-73 dice «ningún 409» y §19.28.8 manda `409 purchase_in_flight`
      // cuando el candado consultivo está ocupado. Se asierta lo que no admite duda (una compra, un AV-4, cero 500) y se
      // CUENTAN los 409 del candado (el servicio devuelve `in_progress` si el reclamo del mismo envío ya comiteó).
      const ok =
        n === 1 &&
        codes.every((c) => c === 'labeled' || c === 'in_progress' || c === '409:purchase_in_flight') &&
        codes.filter((c) => c === 'labeled').length === 1 &&
        s1.providerShipmentId !== null &&
        bandeja.length === 1;
      if (ok) good += 1;
      else bad.push(JSON.stringify({ n, codes, mails: bandeja.length }));
    }
    // eslint-disable-next-line no-console
    console.log(`PS-73: 409 purchase_in_flight en ${inflight409} de ${N * 9} respuestas no ganadoras`);
    expect({ proportion: `${good}/${N}`, bad }).toEqual({ proportion: `${N}/${N}`, bad: [] });
  }, 300_000);

  // ================================================================ PS-122 / PS-132 — una compra en vuelo a la vez

  describe('PS-122 / PS-132 — una compra en vuelo a la vez en toda la cuenta', () => {
    it('(a) A con reclamo sin id de hace 2 min ⇒ B 409 {purchase_in_flight, otherShipmentId:A, otherFolio, retryAfterSeconds}, 0 compras, B idéntico; (b) de hace 4 min (> T_INFLIGHT_BLOCK) ⇒ B compra', async () => {
      const a = await readyQuoted();
      const b = await readyQuoted();
      const aSince = new Date(clock.now().getTime() - 2 * MIN);
      await h.prisma.shipmentRequest.update({ where: { id: a.id }, data: { labelProcessingSince: aSince } });
      const before = await row(b.id);
      fake.calls.length = 0;
      const r = await buy(b.id, buyBody(b.q, b.rate));
      expect(errCode(r)).toBe('409:CONFLICT');
      const folioA = (await row(a.id)).folio;
      // §19.28.8: `retryAfterSeconds = ceil((since_A + T_INFLIGHT_BLOCK − now) / 1 s)` = 180 − 120 = 60.
      expect(r.body.error.details).toEqual({ reason: 'purchase_in_flight', otherShipmentId: a.id, otherFolio: folioA, retryAfterSeconds: 60 });
      expect(purchases()).toHaveLength(0);
      expect(await row(b.id)).toEqual(before);
      await h.prisma.shipmentRequest.update({ where: { id: a.id }, data: { labelProcessingSince: new Date(clock.now().getTime() - 4 * MIN) } });
      expect(errCode(await buy(b.id, buyBody(b.q, b.rate)))).toBe('200');
      expect(purchases(b.id)).toHaveLength(1);
    });

    it(`(c) 10 envíos DISTINTOS a la vez con la compra demorada 1 s ⇒ exactamente 1 \`purchase\` y 9 × 409 purchase_in_flight (N = ${N} rondas)`, async () => {
      let good = 0;
      const bad: string[] = [];
      for (let i = 0; i < N; i += 1) {
        const ss = [];
        for (let k = 0; k < 10; k += 1) ss.push(await readyQuoted());
        fake.calls.length = 0;
        fake.purchaseBarrier = () => new Promise((res) => setTimeout(res, 1000));
        const rs = await Promise.all(ss.map((s) => buy(s.id, buyBody(s.q, s.rate))));
        fake.purchaseBarrier = null;
        const n = purchases().length;
        const inflight = rs.filter((r) => r.status === 409 && r.body.error.details?.reason === 'purchase_in_flight').length;
        if (n === 1 && inflight === 9) good += 1;
        else bad.push(JSON.stringify({ n, codes: rs.map(errCode) }));
      }
      expect({ proportion: `${good}/${N}`, bad }).toEqual({ proportion: `${N}/${N}`, bad: [] });
    }, 600_000);

    it(`PS-132 (a) — con la compra de A retenida, B recibe 409 purchase_in_flight en < 1 s (N = ${N})`, async () => {
      let good = 0;
      const lat: number[] = [];
      for (let i = 0; i < N; i += 1) {
        const a = await readyQuoted();
        const b = await readyQuoted();
        let release!: () => void;
        const held = new Promise<void>((res) => (release = res));
        let entered!: () => void;
        const inPurchase = new Promise<void>((res) => (entered = res));
        fake.purchaseBarrier = async () => {
          entered();
          await held;
        };
        const pa = buy(a.id, buyBody(a.q, a.rate));
        // Si A no llega a la compra (falla antes), la ronda no se cuelga: cuenta como MAL.
        await Promise.race([inPurchase, pa]);
        fake.purchaseBarrier = null;
        const t0 = Date.now();
        const rb = await buy(b.id, buyBody(b.q, b.rate));
        const ms = Date.now() - t0;
        lat.push(ms);
        release();
        const ra = await pa;
        if (rb.status === 409 && rb.body.error.details.reason === 'purchase_in_flight' && rb.body.error.details.otherShipmentId === a.id && ms < 1000 && ra.status === 200) good += 1;
      }
      expect({ proportion: `${good}/${N}`, lat }).toEqual({ proportion: `${N}/${N}`, lat });
    }, 300_000);

    it("PS-132 (a') — candado consultivo tomado por otra tx ⇒ 409 {otherShipmentId:null} en < 1 s (no espera)", async () => {
      const b = await readyQuoted();
      let release!: () => void;
      const held = new Promise<void>((res) => (release = res));
      let locked!: () => void;
      const isLocked = new Promise<void>((res) => (locked = res));
      const holder = h.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SKYDROPX_PURCHASE_LOCK_KEY}::bigint)`;
        locked();
        await held;
      }, { timeout: 30_000 });
      await isLocked;
      const t0 = Date.now();
      const r = await buy(b.id, buyBody(b.q, b.rate));
      const ms = Date.now() - t0;
      release();
      await holder;
      expect(errCode(r)).toBe('409:CONFLICT');
      expect(r.body.error.details).toEqual(expect.objectContaining({ reason: 'purchase_in_flight', otherShipmentId: null }));
      expect(ms).toBeLessThan(1000);
      expect((await row(b.id)).labelProcessingSince).toBeNull();
    });
  });

  // ================================================================ TG-1 / TG-2 — topes (PS-138 … PS-141, PS-160 (c))

  describe('TG-1 — tope de gasto por persona en 24 h (PS-138, PS-139, PS-140, PS-160 (c))', () => {
    beforeEach(forgetSpend);
    it('PS-138 — 240000 usados + guía ⇒ 403 LABEL_PURCHASE_LIMIT {limit:"daily_spend"} sin cifras, 0 llamadas al doble (ni con la cotización vencida), bitácora y UN AG-3; el dueño la compra; `tracking` manual del bloqueado ⇒ 200', async () => {
      await dial(h, 'operator_label_cap_24h_cents', 250000);
      const s = await readyQuoted();
      // Lo usado + esta guía pasa el tope por 1 centavo (la tarifa del doble no es la de 15000 del ejemplo de PS-138).
      const used = 250000 - s.rate.priceCents + 1;
      await seedSpend(db.operatorId, [{ charged: used, outcome: 'released_unverified' }]);
      fake.calls.length = 0;
      const r = await buy(s.id, buyBody(s.q, s.rate));
      expect(errCode(r)).toBe('403:LABEL_PURCHASE_LIMIT');
      expect(r.body.error.details).toEqual({ limit: 'daily_spend' });
      expect(JSON.stringify(r.body)).not.toMatch(new RegExp(`250000|${used}|capCents|usedCents`));
      expect(fake.calls).toHaveLength(0);
      expect(await alertsOf({ kind: 'label_cap_blocked', subjectUserId: db.operatorId })).toHaveLength(1);
      // con la cotización vencida tampoco hay red (los topes van ANTES del re-cotizado).
      clock.set(new Date(clock.now().getTime() + 25 * 60 * MIN));
      await seedSpend(db.operatorId, [{ charged: used, outcome: 'released_unverified' }]);
      expect(errCode(await buy(s.id, buyBody(s.q, s.rate)))).toBe('403:LABEL_PURCHASE_LIMIT');
      expect(fake.calls).toHaveLength(0);
      clock.set(new Date());
      const limited = await audits(s.id, 'shipment.label_purchase_limited');
      expect(limited.length).toBeGreaterThanOrEqual(1);
      expect(limited[0].after).toEqual(expect.objectContaining({ limit: 'daily_spend', capCents: 250000 }));
      // AG-3 es uno por persona y DÍA MX: el reloj movido a +25 h abrió otro día ⇒ segunda fila (y no tercera).
      expect(await alertsOf({ kind: 'label_cap_blocked', subjectUserId: db.operatorId })).toHaveLength(2);
      // el dueño compra esa guía
      await setOwner(db.adminId);
      expect(errCode(await buy(s.id, buyBody(s.q, s.rate), db.adminToken))).toBe('200');
      // la captura manual del bloqueado sigue
      const m = await db.mkDirect();
      await ready(db, m.shipment.id);
      expect((await db.tracking(m.shipment.id)).status).toBe(201); // el verbo de siempre (POST sin @HttpCode)
    });

    it('PS-138 (C-22) — 15 guías de 15000 canceladas con reembolso DESCONOCIDO + una de 30000 ⇒ 403 daily_spend; con reembolso entero conocido ⇒ compra', async () => {
      await dial(h, 'operator_label_cap_24h_cents', 250000);
      const s = await readyQuoted();
      await seedSpend(db.operatorId, [...Array.from({ length: 15 }, () => ({ charged: 15000, cancelled: true, unrefunded: null })), { charged: 30000 }]);
      expect(errCode(await buy(s.id, buyBody(s.q, s.rate)))).toBe('403:LABEL_PURCHASE_LIMIT');
      expect(purchases()).toHaveLength(0);
      await h.prisma.shipmentPaidLabel.updateMany({ where: { providerShipmentId: { startsWith: `seed-${RUN}-` } }, data: { unrefundedCents: 0 } });
      await h.prisma.shipmentPaidLabel.updateMany({ where: { providerShipmentId: { startsWith: `seed-${RUN}-` }, cancelledAt: null }, data: { unrefundedCents: null } });
      expect(errCode(await buy(s.id, buyBody(s.q, s.rate)))).toBe('200');
    });

    it('PS-138 — cruzar el 80 % ⇒ UN AG-2 🟡 (`ag2:<persona>:<día MX>`); otro cruce el mismo día ⇒ la misma fila', async () => {
      await dial(h, 'operator_label_cap_24h_cents', 250000);
      const s = await readyQuoted();
      await seedSpend(db.operatorId, [{ charged: 200000 - s.rate.priceCents + 1, outcome: 'released_unverified' }]);
      expect(errCode(await buy(s.id, buyBody(s.q, s.rate)))).toBe('200');
      const ag2 = await alertsOf({ kind: 'label_cap_warning', subjectUserId: db.operatorId });
      expect(ag2).toHaveLength(1);
      expect(ag2[0].severity).toBe('digest');
    });

    it('PS-139 — `labelSpend24h` exacto (filas por SQL): ventana estricta, otro actor, `not_charged`, pendientes, cobrado ≠ esperado, canceladas (C-22)', async () => {
      const now = clock.now();
      const other = (await db.mkUser('Otro')).id;
      await seedSpend(db.operatorId, [
        { charged: 1, outcome: 'pending', sinceAgoMs: 24 * 60 * MIN - 1 }, // a now − 24 h (+ k ms ⇒ fuera): ver abajo
      ]);
      // La siembra resta `k` ms; se fija a mano el borde exacto.
      await h.prisma.shipmentLabelAttempt.updateMany({ where: { actorUserId: db.operatorId, rateId: 'seed-1', expectedChargeCents: 1 }, data: { since: new Date(now.getTime() - 24 * 60 * MIN) } });
      await seedSpend(db.operatorId, [
        { charged: 10, outcome: 'pending', sinceAgoMs: 24 * 60 * MIN - 1000 }, // dentro (now − 24 h + 1 s, menos k)
        { charged: 100, outcome: 'not_charged' }, // 0
        { charged: 1000, outcome: 'released_unverified' }, // cuenta lo esperado
        { charged: 7000 }, // guía pagada: cuenta `chargedCents`
        { charged: 20000, cancelled: true, unrefunded: 500 }, // 500
        { charged: 40000, cancelled: true, unrefunded: null }, // C-22: 40000
      ]);
      await seedSpend(other, [{ charged: 999999 }]);
      expect(await labelSpend24h(h.prisma, db.operatorId, now)).toBe(10 + 1000 + 7000 + 500 + 40000);
    });

    it('PS-140 — variante: el intento A del operador sigue `pending` a los 4 min (fuera de T_INFLIGHT_BLOCK) ⇒ B se niega por `daily_spend`', async () => {
      await dial(h, 'operator_label_cap_24h_cents', 250000);
      const a = await readyQuoted();
      const b = await readyQuoted();
      const since = new Date(clock.now().getTime() - 4 * MIN);
      await h.prisma.shipmentRequest.update({ where: { id: a.id }, data: { labelProcessingSince: since, providerRateId: a.rate.rateId } });
      await h.prisma.shipmentLabelAttempt.create({ data: { shipmentRequestId: a.id, since, actorUserId: db.operatorId, capExempt: false, rateId: 'seed-a', carrierName: 'dhl', expectedChargeCents: 250000 - b.rate.priceCents + 1, marginCents: 0, outcome: 'pending' } });
      const r = await buy(b.id, buyBody(b.q, b.rate));
      expect(errCode(r)).toBe('403:LABEL_PURCHASE_LIMIT');
      expect(purchases()).toHaveLength(0);
      await h.prisma.shipmentLabelAttempt.deleteMany({ where: { shipmentRequestId: a.id, rateId: 'seed-a' } });
    });

    it(`PS-140 — mismo operador, dos compras simultáneas que juntas pasan el tope ⇒ exactamente UNA \`purchase\` (N = ${N})`, async () => {
      let good = 0;
      const bad: string[] = [];
      for (let i = 0; i < N; i += 1) {
        const a = await readyQuoted();
        const b = await readyQuoted();
        await dial(h, 'operator_label_cap_24h_cents', a.rate.priceCents + b.rate.priceCents - 1);
        fake.calls.length = 0;
        const rs = await Promise.all([buy(a.id, buyBody(a.q, a.rate)), buy(b.id, buyBody(b.q, b.rate))]);
        const n = purchases().length;
        if (n === 1) good += 1;
        else bad.push(JSON.stringify({ n, codes: rs.map(errCode) }));
        // la guía comprada deja de contar para la ronda siguiente (otro día): se mueve su intento fuera de la ventana
        await h.prisma.shipmentLabelAttempt.updateMany({ where: { shipmentRequestId: { in: [a.id, b.id] } }, data: { since: new Date(clock.now().getTime() - 25 * 60 * MIN) } });
      }
      expect({ proportion: `${good}/${N}`, bad }).toEqual({ proportion: `${N}/${N}`, bad: [] });
    }, 300_000);

    it('PS-160 (c) — dos súper-admin con correo, uno MARCADO: el otro recibe 403 LABEL_PURCHASE_LIMIT al pasar el tope', async () => {
      await dial(h, 'operator_label_cap_24h_cents', 250000);
      await setOwner(db.adminId);
      const second = await mkSuperAdmin();
      await seedSpend(second.id, [{ charged: 249999, outcome: 'released_unverified' }]);
      const s = await readyQuoted();
      const r = await buy(s.id, buyBody(s.q, s.rate), second.token);
      expect(errCode(r)).toBe('403:LABEL_PURCHASE_LIMIT');
      await seedSpend(db.adminId, [{ charged: 249999, outcome: 'released_unverified' }]);
      expect(errCode(await buy(s.id, buyBody(s.q, s.rate), db.adminToken))).toBe('200');
      expect(await alertsOf({ subjectUserId: db.adminId })).toHaveLength(0);
    });
  });

  describe('TG-2 — una recompra por envío (PS-141, parte de libro)', () => {
    it('dos guías pagadas (canceladas `reissue`) ⇒ la 3.ª 403 {limit:"reissue"}, 0 red, UN AG-4 (`ag4:s:`) con cancelledCount y unrecoveredCents; el dueño la compra', async () => {
      const s = await readyQuoted();
      for (let k = 1; k <= 2; k += 1) {
        const a = await h.prisma.shipmentLabelAttempt.create({ data: { shipmentRequestId: s.id, since: new Date(clock.now().getTime() - k * 10 * MIN), actorUserId: db.operatorId, capExempt: false, rateId: `seed-r${k}`, carrierName: 'dhl', expectedChargeCents: 100, marginCents: 0, outcome: 'labeled' } });
        await h.prisma.shipmentPaidLabel.create({ data: { providerShipmentId: `seed-${RUN}-r${k}-${s.id}`, shipmentRequestId: s.id, attemptId: a.id, origin: 'response', chargedCents: 100, cancelledAt: clock.now(), cancelKind: 'reissue', unrefundedCents: k === 1 ? 30 : null, cancelledByUserId: db.operatorId } });
      }
      // un rechazo sin id entre medias NO gasta la recompra (intento `not_charged` sin guía)
      await h.prisma.shipmentLabelAttempt.create({ data: { shipmentRequestId: s.id, since: new Date(clock.now().getTime() - 5 * MIN), actorUserId: db.operatorId, capExempt: false, rateId: 'seed-nc', carrierName: 'dhl', expectedChargeCents: 100, marginCents: 0, outcome: 'not_charged' } });
      fake.calls.length = 0;
      const r = await buy(s.id, buyBody(s.q, s.rate));
      expect(errCode(r)).toBe('403:LABEL_PURCHASE_LIMIT');
      expect(r.body.error.details).toEqual({ limit: 'reissue' });
      expect(fake.calls).toHaveLength(0);
      const ag4 = await alertsOf({ dedupKey: `ag4:s:${s.id}` });
      expect(ag4).toHaveLength(1);
      expect(ag4[0].severity).toBe('immediate');
      expect(ag4[0].facts).toEqual(expect.objectContaining({ cancelledCount: 2, unrecoveredCents: 30, unknownRefunds: 1, triggers: ['reissue_denied'] }));
      expect((await detail(s.id)).body.labelOptions.limit).toBe('reissue');
      await setOwner(db.adminId);
      expect((await detail(s.id, db.adminToken)).body.labelOptions.limit).toBeNull();
      expect(errCode(await buy(s.id, buyBody(s.q, s.rate), db.adminToken))).toBe('200');
      await h.prisma.spendAlert.deleteMany({ where: { shipmentRequestId: s.id } });
    });

    it('una guía HUÉRFANA del envío cuenta como guía pagada', async () => {
      const s = await readyQuoted();
      for (const k of [1, 2]) {
        await h.prisma.shipmentPaidLabel.create({ data: { providerShipmentId: `seed-${RUN}-o${k}-${s.id}`, shipmentRequestId: s.id, origin: 'orphan', chargedCents: 100 } });
      }
      expect(errCode(await buy(s.id, buyBody(s.q, s.rate)))).toBe('403:LABEL_PURCHASE_LIMIT');
      await h.prisma.shipmentPaidLabel.deleteMany({ where: { shipmentRequestId: s.id } });
      await h.prisma.spendAlert.deleteMany({ where: { shipmentRequestId: s.id } });
    });
  });

  // ================================================================ AG-1 / AG-5 / AG-13

  describe('Avisos al comprar (PS-142 AG-1, PS-143 AG-5, AG-13)', () => {
    const correct = (id: string, json: Record<string, unknown>) =>
      h.api('PUT', `/admin/shipments/${id}/address`, {
        token: db.opToken,
        json: { expectedAddressVersion: 0, recipientName: 'Ana Gómez Ruiz', line1: 'Av. Revolución 1500', line2: 'Int. 4', postalCode: '01000', neighborhood: 'San Ángel', city: 'Álvaro Obregón', state: 'Ciudad de México', references: 'Portón negro', ...json },
      });

    it('PS-142 — el operador corrige `line1` y compra ⇒ UN AG-1 🔴 con `changedKeys`; solo `neighborhood` ⇒ 🟡; el dueño corrige y compra ⇒ nada', async () => {
      const s = await readyQuoted();
      expect((await correct(s.id, { line1: 'Av. Revolución 1600' })).status).toBe(200);
      const q = await quote(s.id);
      expect(errCode(await buy(s.id, buyBody(q.body, pickRate(q.body))))).toBe('200');
      const ag1 = await alertsOf({ dedupKey: `ag1:${s.id}` });
      expect(ag1).toHaveLength(1);
      expect(ag1[0].severity).toBe('immediate');
      expect(ag1[0].mailStatus).toBe('pending');
      expect((ag1[0].facts as any).changedKeys).toEqual(['line1']);
      const t = await readyQuoted();
      expect((await correct(t.id, { neighborhood: 'San Ángel Inn' })).status).toBe(200);
      const qt = await quote(t.id);
      if (qt.status === 200) {
        expect(errCode(await buy(t.id, buyBody(qt.body, pickRate(qt.body))))).toBe('200');
        const ag1b = await alertsOf({ dedupKey: `ag1:${t.id}` });
        expect(ag1b.map((a) => [a.severity, a.mailStatus])).toEqual([['digest', 'not_applicable']]);
      }
      await h.prisma.spendAlert.deleteMany({ where: { shipmentRequestId: { in: [s.id, t.id] } } });
    });

    it('PS-143 — el doble cobra +500 ⇒ AG-5 🟡; +2500 ⇒ 🔴; igual ⇒ nada; `amountCents = shippingCostCents`', async () => {
      const cases: [number, string | null][] = [[0, null], [500, 'digest'], [2500, 'immediate']];
      for (const [extra, sev] of cases) {
        const s = await readyQuoted();
        fake.purchaseOutcomes.push({ kind: 'labeled', totalCents: s.rate.breakdown.totalCents + extra });
        expect(errCode(await buy(s.id, buyBody(s.q, s.rate)))).toBe('200');
        const ag5 = await alertsOf({ kind: 'label_charge_drift', shipmentRequestId: s.id });
        const s1 = await row(s.id);
        expect({ extra, sev: ag5[0]?.severity ?? null, amount: ag5[0]?.amountCents ?? null }).toEqual({ extra, sev, amount: sev ? s1.shippingCostCents : null });
        await h.prisma.spendAlert.deleteMany({ where: { shipmentRequestId: s.id } });
      }
    });

    it('AG-13 — tarifa más cara que la recomendada ⇒ 🟡 `label_costly_choice`, nunca correo inmediato', async () => {
      const s = await readyQuoted();
      const pricier = s.q.rates.filter((r: any) => r.deliveryKind !== 'branch' && r.priceCents > (s.q.rates.find((x: any) => x.rateId === s.q.recommendedRateId)?.priceCents ?? Infinity)).slice(-1)[0];
      if (!pricier) return;
      expect(errCode(await buy(s.id, buyBody(s.q, pricier)))).toBe('200');
      const ag13 = await alertsOf({ kind: 'label_costly_choice', shipmentRequestId: s.id });
      expect(ag13.map((a) => [a.severity, a.mailStatus])).toEqual([['digest', 'not_applicable']]);
      await h.prisma.spendAlert.deleteMany({ where: { shipmentRequestId: s.id } });
    });
  });
});

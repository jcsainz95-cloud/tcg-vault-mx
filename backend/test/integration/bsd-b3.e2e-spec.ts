/**
 * bsd-b3.e2e-spec.ts — 💰 rev BSD-1, paso B-3 (API_CONTRACT §BSD.4.5, §BSD.6, §BSD.7, §BSD.8, §BSD.15, §BSD.17 puntos 1 y 4)
 * contra Postgres REAL y la app Nest real. Propiedad: backend.
 *
 * Proveedor = el DOBLE (`FakeShippingProvider`, ⛔ nunca la red: PS-99; `SKYDROPX_ALLOW_SPEND` vacía); correo = un puerto que
 * CAPTURA; reloj de avisos = uno MANUAL en una hora propia (el cupo de correos al dueño es por hora y la base es compartida).
 *
 * | Prueba | Qué afirma |
 * |---|---|
 * | BSD-B14 | Declinar y regla 2 con guía de entrada «creada»: `cancel` llamado, libro `auto_close`, SIN tarea; el doble niega ⇒ tarea con el número |
 * | BSD-B15 | `decline-accepted`: 400/éxito/409×3/403, bitácora con motivo, UN BSD-M1 sin el motivo |
 * | BSD-B16 | Declinar ∥ comprar, N = 10 rondas: nunca cerrada con guía viva; nunca BSD-M1 y AV-7 a la vez |
 * | BSD-B17 | Regla 8 con reloj: 6 d 23 h abierta; 7 d cerrada cruzando fin de semana; dial 10; guía manual, Skydropx, reclamo, «en proceso» |
 * | BSD-B3 (mitad) | Ancladas por el relleno: a +0 no cierra, a +7 d cierra las tres |
 * | BSD-B18 | Regla 8 ∥ comprar, N = 10 rondas, con BARRERA de candado de fila (orden forzado, no tirada de dados) |
 * | BSD-B19 | Sin culpa: `not_continued`, `declinedBy = null`, el DTO del vendedor lo trae |
 * | BSD-B20 | Regla 9: un AG-23 y un correo al dueño aunque el barrido corra 3 veces; personal sin correo; `guideDueSoon`/`guideDueInDays=2`; tras guía, false; C-7 silenciado |
 * | BSD-B29 | `confirm-shipment` con guía de Skydropx y costo ⇒ `400 provider_cost`; fila `solicitado` ⇒ `cancelado`; en `guia` no se toca |
 * | BSD-B30 | Regla 10: cancelación sin confirmar > 1 h ⇒ tarea; a 30 min, no |
 * | BSD-B31 | Declinar ∥ comprar ∥ barrido, N = 30 rondas: CERO `40P01` (la mutación «orden invertido» interbloquea ~1 de cada 6 rondas: 30 la cazan casi siempre) |
 * | BSD-B37/B38 | Rechazar en `aceptada` ⇒ `422 REQUEST_NOT_RECEIVED {remedy:'decline_accepted'}`, y la guarda vive en el `WHERE` |
 * | BSD-B39 (mitad B-3) | Reclamo de entrada viejo ⇒ `labelAlert` en la ficha, el filtro y el contador; la lista de M4 no la trae |
 * | §BSD.4.5 | Captura a mano con guía viva de entrada ⇒ `409 SHIPMENT_ALREADY_LABELED`; con reclamo ⇒ `409 LABEL_IN_PROGRESS` |
 *
 * ⚠️ «Comprar» (B16/B18/B31) es un SUSTITUTO FIEL AL CONTRATO del motor de B-2 (§BSD.3/§BSD.4.7: reclamo con I-BSD-4 y CAS
 * `status='solicitado'`, persistencia con `writeSellRequestGuide` y `casZero` rama (3)), porque la compra de la guía de entrada
 * la construye B-2 en paralelo. Lo que estas pruebas miden es el lado de B-3 (candados, predicados, I-BSD-1); cuando B-2
 * entregue, se repiten contra `POST /admin/shipments/:id/label` (anotado en `BACKEND_NOTES §78.B3`).
 */
import { randomBytes } from 'crypto';
import { Role } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { CaptureMail, ManualSpendClock, markOwner, neutralizeOtherAlerts } from './helpers/spend-db';
import { dial, restoreDials } from './helpers/label-db';
import { diferida, esperarBloqueoDeFila } from './helpers/row-lock-barrier';
import { AuthService } from '../../src/modules/auth/auth.service';
import { MAIL_PORT } from '../../src/modules/mail/mail.port';
import { SPEND_ALERTS_CLOCK } from '../../src/modules/spend-alerts/spend-alerts.constants';
import { FakeShippingProvider } from '../../src/modules/shipping-provider/fake-shipping-provider';
import { SHIPPING_PROVIDER_SELECTION } from '../../src/modules/shipping-provider/shipping-provider.module';
import { ShippingProviderSelection } from '../../src/modules/shipping-provider/shipping-provider.factory';
import { BuylistSweepJobService } from '../../src/jobs/buylist-sweep.service';
import { BuylistService } from '../../src/modules/buylist/buylist.service';
import { writeSellRequestGuide } from '../../src/modules/buylist/sell-request-guide';

const RUN = randomBytes(4).toString('hex');
const DAY = 24 * 3600 * 1000;
const H = 3600 * 1000;
/** Un «ahora» PASADO para el barrido: sus reglas no alcanzan filas de otras suites (todas nacen con fechas reales). */
const PAST_NOW = new Date('2026-09-11T18:00:00.000Z'); // viernes; −7 d = el viernes anterior (cruza un fin de semana)
/** Lo que el CHECK `shipment_provider_id_requires_purchase` exige junto a un `providerShipmentId` (lo escribe el reclamo). */
const purchase = (at: Date = new Date()) => ({
  providerRateId: 'rate-b3',
  chosenRateJson: { priceCents: 15000, carrierLabel: 'Estafeta' },
  rateChosenByUserId: operator.id,
  rateChosenAt: at,
  labelPurchasedAt: at,
  packageCode: '4G',
  declaredValueCents: 250000,
  insuredValueCents: 150000,
});
const SNAPSHOT = { recipientName: 'Vendedor B3', line1: 'Calle Privada 12', city: 'CDMX', state: 'CDMX', postalCode: '01000', country: 'MX', phone: '5500001111' };

let h: E2EHarness;
const mail = new CaptureMail();
const fake = new FakeShippingProvider();
let spendClock: ManualSpendClock;
let sweep: BuylistSweepJobService;
let svc: BuylistService;
let operator: { id: string; token: string };
let admin: { id: string; token: string };
let owner: { id: string; email: string };
let previousOwnerId: string | null = null;
let cardId: string;
let seq = 0;

beforeAll(async () => {
  spendClock = new ManualSpendClock(new Date(Date.UTC(2033, 0, 1) + (randomBytes(3).readUIntBE(0, 3) % 100_000) * H));
  const sel: ShippingProviderSelection = { port: fake, kind: 'fake', urlHosts: ['pro.skydropx.com'], client: null };
  h = await E2EHarness.create((b) =>
    b.overrideProvider(MAIL_PORT).useValue(mail).overrideProvider(SHIPPING_PROVIDER_SELECTION).useValue(sel).overrideProvider(SPEND_ALERTS_CLOCK).useValue(spendClock),
  );
  sweep = h.app.get(BuylistSweepJobService);
  svc = h.app.get(BuylistService);
  const auth = h.app.get(AuthService);
  const staff = async (role: Role, tag: string) => {
    const u = await h.prisma.user.create({ data: { role, name: `${tag} ${RUN}`, email: `b3-${tag}-${RUN}@e2e.local`, emailVerified: true, phone: '5512340000', locale: 'es' } });
    return { id: u.id, email: u.email!, token: (await auth.issueTokens(u)).accessToken };
  };
  operator = await staff(Role.vault_operator, 'op');
  admin = await staff(Role.super_admin, 'admin');
  owner = await staff(Role.super_admin, 'owner');
  previousOwnerId = (await h.prisma.user.findFirst({ where: { isOwner: true }, select: { id: true } }))?.id ?? null;
  await markOwner(h, owner.id);
  cardId = (await h.prisma.card.findFirstOrThrow({ select: { id: true } })).id;
  await dial(h, 'buylist_guide_close_calendar_days', 7);
  await dial(h, 'buylist_guide_warn_days_before_close', 2);
  await dial(h, 'spend_alerts_disabled', []);
}, 120_000);

/**
 * La base es COMPARTIDA con el resto de la suite: lo que esta prueba deja vivo contamina a otras (medido: un reclamo de
 * entrada sin resolver es «otra compra en vuelo» para TODA la cuenta ⇒ 409 en las compras de `sdx-*`; las `aceptada` viejas
 * empujan fuera de la primera página la cola `awaitingGuide` de `buylist-cycle`). Se neutraliza todo lo de los vendedores
 * de B-3 (de esta corrida y de las anteriores).
 */
async function neutralizeLeftovers(): Promise<void> {
  const mine = `SELECT sr.id FROM "SellRequest" sr JOIN "User" u ON u.id = sr."userId" WHERE u.email LIKE 'b3-seller-%'`;
  await h.prisma.$executeRawUnsafe(
    `UPDATE "ShipmentRequest" SET "labelProcessingSince" = NULL,
            "providerCanceledAt" = CASE WHEN "providerShipmentId" IS NOT NULL THEN COALESCE("providerCanceledAt", now()) END,
            "providerCancelReason" = CASE WHEN "providerShipmentId" IS NOT NULL THEN COALESCE("providerCancelReason", 'auto_close') END,
            "providerCancelConfirmedAt" = CASE WHEN "providerShipmentId" IS NOT NULL THEN COALESCE("providerCancelConfirmedAt", now()) END,
            "status" = 'cancelado'
      WHERE "sellRequestId" IN (${mine})`,
  );
  await h.prisma.$executeRawUnsafe(
    `UPDATE "SellRequest" SET "status" = 'expirada', "expiredReason" = 'not_continued', "closedAt" = now(),
            "guideCancellationPendingAt" = NULL
      WHERE "closedAt" IS NULL AND id IN (${mine})`,
  );
}

afterAll(async () => {
  if (h) {
    await neutralizeLeftovers();
    await restoreDials(h);
    await markOwner(h, previousOwnerId);
    await h.close();
  }
});

beforeEach(() => {
  mail.reset();
  fake.cancelOutcomes.length = 0;
});

// ======================================================================================= fixtures

async function seller() {
  seq += 1;
  const u = await h.prisma.user.create({
    data: { role: 'customer', name: `Vendedora ${RUN} ${seq}`, email: `b3-seller-${RUN}-${seq}@e2e.local`, emailVerified: true, phone: '5511112222', locale: 'es' },
  });
  const token = (await h.app.get(AuthService).issueTokens(u)).accessToken;
  return { id: u.id, email: u.email!, token };
}

type Over = Record<string, unknown>;
async function accepted(over: Over = {}, items: Over[] = [{}]) {
  const s = await seller();
  const sr = await h.prisma.sellRequest.create({
    data: {
      userId: s.id,
      status: 'aceptada',
      acceptedAt: new Date(PAST_NOW.getTime() - 8 * DAY),
      offerSentAt: new Date(PAST_NOW.getTime() - 9 * DAY),
      offerGrossCents: 150000,
      offerShippingFeeCents: 18000,
      offerNetCents: 132000,
      pickupAddressSnapshot: SNAPSHOT,
      ...over,
    },
  });
  for (const it of items) {
    await h.prisma.sellRequestItem.create({
      data: { sellRequestId: sr.id, cardId, productType: 'raw', rawCondition: 'NM', offerDecision: 'buy', offeredPriceCents: 150000, quotedPriceCents: 150000, ...it },
    });
  }
  return { sr, s };
}

async function inbound(sellRequestId: string, over: Over = {}) {
  return h.prisma.shipmentRequest.create({
    data: {
      kind: 'buylist_inbound',
      sellRequestId,
      userId: null,
      orderId: null,
      status: 'solicitado',
      addressSnapshot: SNAPSHOT,
      shippingFeeCents: 0,
      priceConvention: 'IVA_INCLUSIVE',
      ...over,
    },
  });
}

/** Una guía de Skydropx VIVA de entrada (fila `guia` + libro pagado + par en la solicitud, I-BSD-2). */
async function liveSkydropxGuide(sellRequestId: string, over: Over = {}) {
  const pid = `sdx-b3-${RUN}-${randomBytes(4).toString('hex')}`;
  const tracking = `TRK${randomBytes(4).toString('hex')}`;
  const row = await inbound(sellRequestId, {
    status: 'guia',
    labelSource: 'skydropx',
    providerShipmentId: pid,
    carrier: 'estafeta',
    trackingNumber: tracking,
    ...purchase(),
    shippingCostCents: 15000,
    ...over,
  });
  await h.prisma.shipmentPaidLabel.create({ data: { providerShipmentId: pid, shipmentRequestId: row.id, origin: 'response', chargedCents: 15000 } });
  await h.prisma.sellRequest.update({
    where: { id: sellRequestId },
    data: { shipmentCarrier: 'Estafeta', shipmentTrackingNumber: tracking, guideSentAt: new Date(), shipDeadlineAt: new Date(Date.now() + 3 * DAY) },
  });
  return { row, pid, tracking };
}

const sr = (id: string) => h.prisma.sellRequest.findUniqueOrThrow({ where: { id } });
const shr = (id: string) => h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id } });
const mailsTo = (email: string) => mail.sent.filter((m) => m.to === email);
const isNotContinued = (m: { subject: string }) => /No continuaremos con tu solicitud de venta/.test(m.subject);
const decline = (id: string, reason = 'el operador decidió no seguir', token = operator.token) =>
  h.api('POST', `/admin/buylist/${id}/decline-accepted`, { token, json: { reason } });

// ============================================================ «comprar»: sustituto fiel al contrato del motor de B-2
const CAS0 = Symbol('cas0');
async function claim(srId: string, shId: string): Promise<Date | null> {
  return h.prisma.$transaction(async (tx) => {
    // I-BSD-4: PRIMERO la solicitud, después la fila de entrada.
    await tx.$queryRaw`SELECT id FROM "SellRequest" WHERE id = ${srId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "ShipmentRequest" WHERE id = ${shId} FOR UPDATE`;
    const s = await tx.sellRequest.findUniqueOrThrow({ where: { id: srId } });
    if (s.status !== 'aceptada' || s.closedAt || s.shipmentTrackingNumber || s.sellerShippedDeclaredAt || s.shipmentConfirmedAt) return null;
    const since = new Date();
    const r = await tx.shipmentRequest.updateMany({ where: { id: shId, status: 'solicitado', labelProcessingSince: null }, data: { labelProcessingSince: since } });
    return r.count === 1 ? since : null;
  });
}
/** La respuesta de Skydropx llega: o queda la guía (AV-7 saldría), o `casZero` rama (3) la cancela, o queda VIVA sin solicitud. */
async function persist(srId: string, shId: string, since: Date): Promise<'labeled' | 'cancelled' | 'orphan_live'> {
  const pid = `sdx-b3-buy-${RUN}-${randomBytes(4).toString('hex')}`;
  try {
    return await h.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "SellRequest" WHERE id = ${srId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "ShipmentRequest" WHERE id = ${shId} FOR UPDATE`;
      const moved = await tx.shipmentRequest.updateMany({
        where: { id: shId, status: 'solicitado', labelProcessingSince: since },
        data: { status: 'guia', labelSource: 'skydropx', providerShipmentId: pid, carrier: 'estafeta', trackingNumber: `T${pid}`, ...purchase(), labelProcessingSince: null },
      });
      if (moved.count !== 1) throw CAS0;
      const g = await writeSellRequestGuide(tx, srId, 'Estafeta', `T${pid}`, new Date(), 'skydropx', 3);
      if (g.count !== 1) throw CAS0;
      return 'labeled' as const;
    });
  } catch (e) {
    if (e !== CAS0) throw e;
  }
  return h.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "SellRequest" WHERE id = ${srId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "ShipmentRequest" WHERE id = ${shId} FOR UPDATE`;
    const row = await tx.shipmentRequest.findUniqueOrThrow({ where: { id: shId } });
    const cancelled = row.status === 'cancelado';
    await tx.shipmentRequest.update({
      where: { id: shId },
      data: {
        labelSource: 'skydropx',
        providerShipmentId: pid,
        ...purchase(),
        labelProcessingSince: null,
        // rama (3): fila cerrada por I-BSD-1 ⇒ la guía se cancela sola. Sin I-BSD-1, queda VIVA sobre una solicitud cerrada.
        ...(cancelled ? { providerCanceledAt: new Date(), providerCancelReason: 'auto_close' } : {}),
      },
    });
    return cancelled ? ('cancelled' as const) : ('orphan_live' as const);
  });
}
async function buy(srId: string, shId: string, jitterMs = 0): Promise<'not_claimed' | 'labeled' | 'cancelled' | 'orphan_live'> {
  const since = await claim(srId, shId);
  if (!since) return 'not_claimed';
  if (jitterMs > 0) await new Promise((r) => setTimeout(r, jitterMs)); // «la red»
  return persist(srId, shId, since);
}
const jitter = () => Math.floor(Math.random() * 25);

/** La invariante de dinero de §BSD.2/I-BSD-1: una solicitud CERRADA no tiene guía viva de entrada sin cancelar. */
async function closedWithLiveGuide(srId: string, shId: string): Promise<boolean> {
  const s = await sr(srId);
  const r = await shr(shId);
  return s.closedAt !== null && r.providerShipmentId !== null && r.providerCanceledAt === null;
}

// =================================================================================================================== B15
describe('💰 BSD-B15 — `POST /admin/buylist/:id/decline-accepted`', () => {
  it('motivo < 3 tras trim ⇒ 400 {field:reason} y nada cambia', async () => {
    const { sr: r } = await accepted();
    const res = await decline(r.id, '  a ');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'VALIDATION_ERROR', details: { field: 'reason' } });
    expect((await sr(r.id)).status).toBe('aceptada');
  });

  it('éxito ⇒ `expirada`/`not_continued`/`declinedBy`/`closedAt`, fila de entrada `cancelado`, bitácora CON motivo, UN BSD-M1 SIN motivo; el segundo ⇒ 409', async () => {
    const { sr: r, s } = await accepted();
    const row = await inbound(r.id);
    const reason = `motivo interno ${RUN} que no sale`;
    const res = await decline(r.id, reason);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'expirada', expiredReason: 'not_continued', declinedBy: operator.id, declineAcceptedAllowed: false, inboundShipment: { id: row.id, status: 'cancelado' } });
    const after = await sr(r.id);
    expect(after).toMatchObject({ status: 'expirada', expiredReason: 'not_continued', declinedBy: operator.id, guideCancellationPendingAt: null });
    expect(after.closedAt).not.toBeNull();
    expect((await shr(row.id)).status).toBe('cancelado');
    const audit = await h.prisma.auditLog.findFirstOrThrow({ where: { action: 'buylist.request.decline_accepted', entityId: r.id } });
    expect(audit).toMatchObject({ actorUserId: operator.id, entityType: 'SellRequest', after: { reason, expiredReason: 'not_continued' } });
    const ms = mailsTo(s.email);
    expect(ms.map((m) => m.subject)).toEqual(['No continuaremos con tu solicitud de venta']);
    expect(`${ms[0].html}${ms[0].text}`).not.toContain(reason);
    const again = await decline(r.id);
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: 'DECLINE_NOT_ALLOWED', details: { status: 'expirada', reason: 'status' } });
    expect(mailsTo(s.email)).toHaveLength(1);
  });

  it('cliente ⇒ 403; «ya lo mandé» ⇒ 409 seller_declared_shipped; `en_transito` ⇒ 409 status; confirmada ⇒ 409 shipment_confirmed', async () => {
    const { sr: a, s } = await accepted();
    expect((await decline(a.id, 'motivo valido', s.token)).status).toBe(403);
    const { sr: b } = await accepted({ sellerShippedDeclaredAt: new Date() });
    const rb = await decline(b.id);
    expect([rb.status, rb.body.error?.details]).toEqual([409, { status: 'aceptada', reason: 'seller_declared_shipped' }]);
    const { sr: c } = await accepted({ status: 'en_transito', shipmentConfirmedAt: new Date() });
    const rc = await decline(c.id);
    expect([rc.status, rc.body.error?.details]).toEqual([409, { status: 'en_transito', reason: 'status' }]);
    const { sr: d } = await accepted({ shipmentConfirmedAt: new Date() });
    const rd = await decline(d.id);
    expect([rd.status, rd.body.error?.details]).toEqual([409, { status: 'aceptada', reason: 'shipment_confirmed' }]);
    for (const x of [a, b, c, d]) expect((await sr(x.id)).closedAt).toBeNull();
  });

  it('`declineAcceptedAllowed` en el DTO dice lo MISMO que la guarda', async () => {
    const { sr: a } = await accepted();
    const { sr: b } = await accepted({ sellerShippedDeclaredAt: new Date() });
    const ga = await h.api('GET', `/admin/buylist/${a.id}`, { token: operator.token });
    const gb = await h.api('GET', `/admin/buylist/${b.id}`, { token: operator.token });
    expect([ga.body.declineAcceptedAllowed, gb.body.declineAcceptedAllowed]).toEqual([true, false]);
    expect((await decline(b.id)).status).toBe(409);
    expect((await decline(a.id)).status).toBe(200);
  });
});

// =================================================================================================================== B14
describe('💰 BSD-B14 — cierre con guía de entrada de Skydropx «creada»', () => {
  it('declinar: `port.cancel` llamado, libro `auto_close`, confirmada, SIN tarea (y `labelPdfAvailable` del vendedor pasa de true a false)', async () => {
    const { sr: r, s } = await accepted();
    const g = await liveSkydropxGuide(r.id);
    // BSD-1.1 C-1: campo plano, el MISMO valor en lista y detalle.
    const pdf = async () => {
      const det = await h.api('GET', `/buylist/requests/${r.id}`, { token: s.token });
      const list = await h.api('GET', '/buylist/requests', { token: s.token });
      return [det.body.labelPdfAvailable, list.body.data.find((x: { sellRequestId: string }) => x.sellRequestId === r.id)?.labelPdfAvailable];
    };
    expect(await pdf()).toEqual([true, true]);
    const before = fake.callsOf('cancel').length;
    expect((await decline(r.id)).status).toBe(200);
    expect(fake.callsOf('cancel').slice(before).map((c) => (c.input as { providerShipmentId: string }).providerShipmentId)).toEqual([g.pid]);
    const row = await shr(g.row.id);
    expect(row).toMatchObject({ status: 'cancelado', providerCancelReason: 'auto_close' });
    expect(row.providerCanceledAt).not.toBeNull();
    expect(row.providerCancelConfirmedAt).not.toBeNull();
    expect((await h.prisma.shipmentPaidLabel.findUniqueOrThrow({ where: { providerShipmentId: g.pid } })).cancelKind).toBe('auto_close');
    expect((await sr(r.id)).guideCancellationPendingAt).toBeNull();
    expect(await pdf()).toEqual([false, false]);
  });

  it('el doble NIEGA la cancelación ⇒ tarea «cancelar guía no usada» con el número a la vista', async () => {
    const { sr: r } = await accepted();
    const g = await liveSkydropxGuide(r.id);
    fake.cancelOutcomes.push({ ok: false, code: 'not_cancellable', message: 'prueba' });
    expect((await decline(r.id)).status).toBe(200);
    const after = await sr(r.id);
    expect(after.guideCancellationPendingAt).not.toBeNull();
    expect(after.shipmentTrackingNumber).toBe(g.tracking);
    expect((await shr(g.row.id)).providerCancelConfirmedAt).toBeNull();
    const queue = await h.api('GET', '/admin/buylist/guides/pending-cancellation?page=1&pageSize=100', { token: operator.token });
    expect(queue.status).toBe(200);
    expect(JSON.stringify(queue.body)).toContain(g.tracking);
  });

  it('regla 2 (plazo de envío vencido) con guía de Skydropx: cancela, `not_shipped`, SIN tarea', async () => {
    const { sr: r, s } = await accepted();
    const g = await liveSkydropxGuide(r.id);
    await h.prisma.sellRequest.update({ where: { id: r.id }, data: { shipDeadlineAt: new Date(PAST_NOW.getTime() - H) } });
    await sweep.run(PAST_NOW);
    const after = await sr(r.id);
    expect(after).toMatchObject({ status: 'expirada', expiredReason: 'not_shipped', guideCancellationPendingAt: null });
    expect(await shr(g.row.id)).toMatchObject({ status: 'cancelado', providerCancelReason: 'auto_close' });
    expect(mailsTo(s.email)).toHaveLength(1); // el 3b de siempre
  });

  it('regla 2 con guía MANUAL: la tarea se abre como hoy (criterio 549)', async () => {
    const { sr: r } = await accepted({ shipmentCarrier: 'DHL', shipmentTrackingNumber: `MAN${RUN}`, guideSentAt: new Date(PAST_NOW.getTime() - 4 * DAY), shipDeadlineAt: new Date(PAST_NOW.getTime() - H) });
    await sweep.run(PAST_NOW);
    expect(await sr(r.id)).toMatchObject({ status: 'expirada', expiredReason: 'not_shipped', guideCancellationPendingAt: PAST_NOW });
  });
});

// =================================================================================================================== B17 + B19 + B3
describe('💰 BSD-B17 — regla 8: días NATURALES, y lo que NO se cierra', () => {
  it('7 d (cruzando fin de semana) ⇒ cerrada `not_continued` + UN BSD-M1; 6 d 23 h ⇒ abierta; guía manual / Skydropx / reclamo / «en proceso» ⇒ abiertas', async () => {
    const at = (ms: number) => new Date(PAST_NOW.getTime() - ms);
    const { sr: siete, s: s7 } = await accepted({ acceptedAt: at(7 * DAY) });
    const { sr: casi } = await accepted({ acceptedAt: at(7 * DAY - H) });
    const { sr: manual } = await accepted({ acceptedAt: at(7 * DAY), shipmentCarrier: 'DHL', shipmentTrackingNumber: `M${RUN}`, guideSentAt: at(DAY) });
    const { sr: sdx } = await accepted({ acceptedAt: at(7 * DAY) });
    await liveSkydropxGuide(sdx.id);
    const { sr: reclamo } = await accepted({ acceptedAt: at(7 * DAY) });
    await inbound(reclamo.id, { labelProcessingSince: at(H) });
    const { sr: proceso } = await accepted({ acceptedAt: at(7 * DAY) });
    await inbound(proceso.id, { labelProcessingSince: at(H), providerShipmentId: `sdx-b3-proc-${RUN}`, labelSource: 'skydropx', ...purchase(at(H)) });
    const res = await sweep.run(PAST_NOW);
    expect(res.notContinued).toBeGreaterThanOrEqual(1);
    expect(await sr(siete.id)).toMatchObject({ status: 'expirada', expiredReason: 'not_continued', declinedBy: null, closedAt: PAST_NOW });
    expect(mailsTo(s7.email).filter(isNotContinued)).toHaveLength(1);
    for (const x of [casi, manual, sdx, reclamo, proceso]) expect([x.id, (await sr(x.id)).status]).toEqual([x.id, 'aceptada']);
    // Una segunda pasada no manda un segundo correo (la transición terminal es `count === 1`).
    await sweep.run(PAST_NOW);
    expect(mailsTo(s7.email).filter(isNotContinued)).toHaveLength(1);
  });

  it('dial 10 ⇒ a los 8 d sigue abierta; a los 10 d, cerrada', async () => {
    await dial(h, 'buylist_guide_close_calendar_days', 10);
    try {
      const { sr: ocho } = await accepted({ acceptedAt: new Date(PAST_NOW.getTime() - 8 * DAY) });
      const { sr: diez } = await accepted({ acceptedAt: new Date(PAST_NOW.getTime() - 10 * DAY) });
      await sweep.run(PAST_NOW);
      expect((await sr(ocho.id)).status).toBe('aceptada');
      expect((await sr(diez.id)).status).toBe('expirada');
    } finally {
      await dial(h, 'buylist_guide_close_calendar_days', 7);
    }
  });

  it('BSD-B3 (mitad B-3): tres ancladas por el relleno (una aceptada hace 20 días) ⇒ a +0 ninguna; a +7 d las tres', async () => {
    const T = new Date(PAST_NOW.getTime() - 30 * DAY);
    const ids = [];
    for (const acceptedAt of [new Date(T.getTime() - 20 * DAY), new Date(T.getTime() - DAY), T]) {
      ids.push((await accepted({ acceptedAt, inboundGuideClockStartedAt: T })).sr.id);
    }
    await sweep.run(T);
    for (const id of ids) expect((await sr(id)).status).toBe('aceptada');
    await sweep.run(new Date(T.getTime() + 7 * DAY));
    for (const id of ids) expect(await sr(id)).toMatchObject({ status: 'expirada', expiredReason: 'not_continued' });
  });

  it('BSD-B19: sin culpa — el DTO del vendedor trae `not_continued`; `declinedBy = null`', async () => {
    const { sr: r, s } = await accepted({ acceptedAt: new Date(PAST_NOW.getTime() - 7 * DAY) });
    await sweep.run(PAST_NOW);
    expect(await sr(r.id)).toMatchObject({ expiredReason: 'not_continued', declinedBy: null });
    const mine = await h.api('GET', `/buylist/requests/${r.id}`, { token: s.token });
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ status: 'expirada', expiredReason: 'not_continued' });
    expect(mine.body).not.toHaveProperty('declinedBy');
    expect(mine.body).not.toHaveProperty('inboundGuideClockStartedAt');
  });
});

// =================================================================================================================== B18
describe('💰 BSD-B18 — regla 8 ∥ comprar, con BARRERA (N = 10 rondas)', () => {
  it('el reclamo que gana el candado de la solicitud EXCLUYE la fila del cierre: 10/10 rondas sin cerrada-con-compra', async () => {
    const malas: string[] = [];
    for (let i = 0; i < 10; i++) {
      const { sr: r } = await accepted({ acceptedAt: new Date(PAST_NOW.getTime() - 8 * DAY) });
      const row = await inbound(r.id);
      const suelta = diferida();
      const bloqueo = diferida();
      // La prueba toma el candado de la solicitud (como el reclamo de la compra, I-BSD-4) y lo retiene.
      const barrera = h.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "SellRequest" WHERE id = ${r.id} FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM "ShipmentRequest" WHERE id = ${row.id} FOR UPDATE`;
          bloqueo.abrir();
          await suelta.promesa;
          // El reclamo se escribe con el candado tomado y se commitea al soltar.
          await tx.shipmentRequest.update({ where: { id: row.id }, data: { labelProcessingSince: new Date() } });
        },
        { timeout: 30_000 },
      );
      await bloqueo.promesa;
      const pasada = sweep.run(PAST_NOW);
      await esperarBloqueoDeFila(h.prisma, 'SellRequest');
      suelta.abrir();
      await barrera;
      await pasada;
      const s = await sr(r.id);
      if (s.closedAt !== null) malas.push(`ronda ${i}: cerrada con reclamo vivo`);
    }
    expect(malas).toEqual([]);
  }, 180_000);
});

// =================================================================================================================== B16
describe('💰 BSD-B16 — declinar ∥ comprar (N = 10 rondas)', () => {
  it('por ronda: cerrada SIN guía viva, o con guía y abierta; nunca BSD-M1 y AV-7 a la vez', async () => {
    const malas: string[] = [];
    const orden: Record<string, number> = {};
    for (let i = 0; i < 10; i++) {
      const { sr: r, s } = await accepted();
      const row = await inbound(r.id);
      let compra: Awaited<ReturnType<typeof buy>>;
      let dec: number;
      const modo = i % 3; // 0: reclamo ANTES de declinar (determinista) · 1: declinar antes · 2: a la vez
      if (modo === 0) {
        const since = await claim(r.id, row.id);
        dec = (await decline(r.id)).status;
        compra = since ? await persist(r.id, row.id, since) : 'not_claimed';
      } else if (modo === 1) {
        dec = (await decline(r.id)).status;
        compra = await buy(r.id, row.id);
      } else {
        const [d, b] = await Promise.all([new Promise((ok) => setTimeout(ok, jitter())).then(() => decline(r.id)), buy(r.id, row.id, jitter())]);
        dec = d.status;
        compra = b;
      }
      orden[`${modo}:${dec}:${compra}`] = (orden[`${modo}:${dec}:${compra}`] ?? 0) + 1;
      const bsdM1 = mailsTo(s.email).filter(isNotContinued).length;
      const av7 = compra === 'labeled' ? 1 : 0;
      if (await closedWithLiveGuide(r.id, row.id)) malas.push(`ronda ${i} (${modo}): cerrada con guía viva`);
      // ⚠️ «nunca BSD-M1 y AV-7» (§BSD.11) choca con BSD-B14/§BSD.6: declinar DESPUÉS de una compra ya avisada es legal (la
      // guía se cancela `auto_close` y sale BSD-M1). Lo que no puede pasar es que los dos salgan con la guía VIVA: si la
      // compra ganó y el declinar llegó después, la guía tiene que quedar cancelada. (Discrepancia reportada al arquitecto.)
      if (bsdM1 > 0 && av7 > 0 && (await shr(row.id)).providerCanceledAt === null) malas.push(`ronda ${i} (${modo}): BSD-M1 y AV-7 con la guía viva`);
      if (compra === 'orphan_live') malas.push(`ronda ${i} (${modo}): guía viva sin solicitud abierta`);
      if (dec === 200 && (await sr(r.id)).status !== 'expirada') malas.push(`ronda ${i}: 200 sin cierre`);
    }
    // eslint-disable-next-line no-console
    console.log(`BSD-B16 desenlaces (modo:decline:compra ⇒ n): ${JSON.stringify(orden)}`);
    expect(malas).toEqual([]);
  }, 180_000);
});

// =================================================================================================================== B31
describe('💰 BSD-B31 — declinar ∥ comprar ∥ barrido (N = 30 rondas): cero interbloqueos', () => {
  it('ningún `40P01` (deadlock) en ninguna de las tres ramas', async () => {
    const logger = (sweep as unknown as { logger: { error: (m: string) => void } }).logger;
    const errores: string[] = [];
    const spy = jest.spyOn(logger, 'error').mockImplementation((m: string) => {
      errores.push(String(m));
    });
    const deadlocks: string[] = [];
    try {
      // 30 rondas: medido sobre la mutación «candado de la fila de entrada ANTES que el de la solicitud» en `decline-accepted`,
      // el interbloqueo sale en 5 de 30 rondas (3 corridas × 10): con 10 rondas por corrida la prueba la cazó 2 de 3 veces.
      for (let i = 0; i < 30; i++) {
        const { sr: r } = await accepted({ acceptedAt: new Date(PAST_NOW.getTime() - 8 * DAY) });
        const row = await inbound(r.id);
        const [d, b, w] = await Promise.allSettled([
          new Promise((ok) => setTimeout(ok, jitter())).then(() => decline(r.id)),
          buy(r.id, row.id, jitter()),
          new Promise((ok) => setTimeout(ok, jitter())).then(() => sweep.run(PAST_NOW)),
        ]);
        const textos = [
          d.status === 'fulfilled' ? d.value.text : String(d.reason),
          b.status === 'fulfilled' ? '' : String(b.reason),
          w.status === 'fulfilled' ? '' : String(w.reason),
        ];
        for (const t of textos) if (/deadlock|40P01/i.test(t)) deadlocks.push(`ronda ${i}: ${t.slice(0, 160)}`);
        if (await closedWithLiveGuide(r.id, row.id)) deadlocks.push(`ronda ${i}: cerrada con guía viva (no es 40P01, pero tampoco puede pasar)`);
      }
      for (const e of errores) if (/deadlock|40P01/i.test(e)) deadlocks.push(`barrido: ${e.slice(0, 160)}`);
    } finally {
      spy.mockRestore();
    }
    expect(deadlocks).toEqual([]);
  }, 240_000);
});

// =================================================================================================================== B20 + C-7
describe('💰 BSD-B20 — regla 9: AG-23 al dueño (y BSD-1.1 C-7/C-8)', () => {
  it('día 5 ⇒ UN aviso y UN correo al dueño aunque el barrido corra 3 veces; nadie más; `guideDueSoon` y `guideDueInDays = 2`; con guía ⇒ false', async () => {
    await neutralizeOtherAlerts(h);
    const now = new Date();
    const ancla = new Date(now.getTime() - 5 * DAY - H);
    const { sr: r } = await accepted({ acceptedAt: ancla });
    // Tres pasadas dentro de la ventana del aviso (5 d 1 h, 5 d 14 h, 6 d 3 h): abarcan > 24 h ⇒ al menos DOS días MX distintos.
    // Una llave «por día» daría dos o tres avisos; la del contrato (`ag23:<id>:<ancla ISO>`) da uno.
    for (const dt of [0, 13 * H, 26 * H]) await sweep.run(new Date(now.getTime() + dt));
    const alerts = await h.prisma.spendAlert.findMany({ where: { kind: 'buylist_guide_due', dedupKey: { startsWith: `ag23:${r.id}:` } } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ dedupKey: `ag23:${r.id}:${ancla.toISOString()}`, severity: 'immediate', muted: false });
    expect(alerts[0].facts).toEqual({ sellRequestId: r.id, closesAt: new Date(ancla.getTime() + 7 * DAY).toISOString(), offerGrossCents: 150000 });
    // (La base es compartida: otras solicitudes en su ventana —de corridas anteriores— también avisan; se cuentan las de ÉSTA.)
    const ag23 = mail.sent.filter((m) => m.subject.startsWith('Solicitud de venta sin guía') && m.html.includes(r.id));
    expect(ag23.map((m) => m.to)).toEqual([owner.email]);
    expect(mail.sent.filter((m) => m.subject.startsWith('Solicitud de venta sin guía') && m.to !== owner.email)).toEqual([]);
    const dto = await h.api('GET', `/admin/buylist/${r.id}`, { token: operator.token });
    expect(dto.body).toMatchObject({ guideDueSoon: true, guideDueInDays: 2, guideDueAt: new Date(ancla.getTime() + 7 * DAY).toISOString() });
    expect(dto.body).not.toHaveProperty('inboundGuideClockStartedAt');
    const counts = await svc.workQueueCounts(now);
    expect(counts.buylistGuideDueSoon).toBeGreaterThanOrEqual(1);
    // C-3: el tablero lleva el contador HERMANO (⛔ `workQueue.buylist` sigue siendo un número), para los dos roles.
    const tablero = await h.api('GET', '/admin/dashboard', { token: operator.token });
    expect(tablero.status).toBe(200);
    expect(typeof tablero.body.workQueue.buylist).toBe('number');
    expect(tablero.body.workQueue.buylistGuideDueSoon).toBe(counts.buylistGuideDueSoon);
    // Con guía (a mano) la marca desaparece sola.
    const g = await h.api('POST', `/admin/buylist/${r.id}/guide`, { token: operator.token, json: { carrier: 'DHL', trackingNumber: `G${RUN}` } });
    expect(g.status).toBe(200);
    const dto2 = await h.api('GET', `/admin/buylist/${r.id}`, { token: operator.token });
    expect(dto2.body).toMatchObject({ guideDueSoon: false, guideDueInDays: null, guideDueAt: null });
  });

  it('C-7: AG-23 silenciado ⇒ la fila nace `muted` y SIN correo; la marca de M5 sigue (es derivada)', async () => {
    await neutralizeOtherAlerts(h);
    await dial(h, 'spend_alerts_disabled', ['AG-23']);
    try {
      const now = new Date();
      const { sr: r } = await accepted({ acceptedAt: new Date(now.getTime() - 5 * DAY - 2 * H) });
      await sweep.run(now);
      const a = await h.prisma.spendAlert.findFirstOrThrow({ where: { dedupKey: { startsWith: `ag23:${r.id}:` } } });
      expect(a).toMatchObject({ muted: true, mailStatus: 'not_applicable' });
      expect(mail.sent.filter((m) => m.subject.startsWith('Solicitud de venta sin guía') && m.html.includes(r.id))).toEqual([]);
      const dto = await h.api('GET', `/admin/buylist/${r.id}`, { token: operator.token });
      expect(dto.body.guideDueSoon).toBe(true);
    } finally {
      await dial(h, 'spend_alerts_disabled', []);
    }
  });
});

// =================================================================================================================== B29
describe('💰 BSD-B29 — `confirm-shipment` con la guía de entrada', () => {
  it('guía de Skydropx VIVA + `guideActualCostCents` ⇒ 400 provider_cost (nada cambia); sin costo ⇒ 200 y la fila `guia` NO se toca', async () => {
    const { sr: r } = await accepted();
    const g = await liveSkydropxGuide(r.id);
    const bad = await h.api('POST', `/admin/buylist/${r.id}/confirm-shipment`, { token: operator.token, json: { guideActualCostCents: 9000 } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatchObject({ code: 'VALIDATION_ERROR', details: { field: 'guideActualCostCents', reason: 'provider_cost' } });
    expect((await sr(r.id)).status).toBe('aceptada');
    const ok = await h.api('POST', `/admin/buylist/${r.id}/confirm-shipment`, { token: operator.token, json: {} });
    expect(ok.status).toBe(200);
    expect((await sr(r.id)).status).toBe('en_transito');
    expect((await shr(g.row.id)).status).toBe('guia');
  });

  it('fila de entrada en `solicitado` ⇒ `cancelado` al confirmar (I-BSD-1)', async () => {
    const { sr: r } = await accepted();
    const row = await inbound(r.id);
    const ok = await h.api('POST', `/admin/buylist/${r.id}/confirm-shipment`, { token: operator.token, json: { guideActualCostCents: 9000 } });
    expect(ok.status).toBe(200);
    expect((await shr(row.id)).status).toBe('cancelado');
    expect((await sr(r.id)).guideActualCostCents).toBe(9000); // sin guía de Skydropx, el costo manual SÍ entra
  });
});

// =================================================================================================================== B30
describe('💰 BSD-B30 — regla 10: reconciliación de cancelaciones', () => {
  it('cancelada en Skydropx hace > 1 h sin confirmación ⇒ abre la tarea; a 30 min, no', async () => {
    const mk = async (ago: number) => {
      const { sr: r } = await accepted({ status: 'expirada', expiredReason: 'not_continued', closedAt: new Date(PAST_NOW.getTime() - ago) });
      await inbound(r.id, {
        status: 'cancelado',
        labelSource: 'skydropx',
        providerShipmentId: `sdx-b3-r10-${RUN}-${ago}`,
        ...purchase(new Date(PAST_NOW.getTime() - ago - H)),
        providerCanceledAt: new Date(PAST_NOW.getTime() - ago),
        providerCancelReason: 'auto_close',
      });
      return r.id;
    };
    const vieja = await mk(2 * H);
    const reciente = await mk(30 * 60 * 1000);
    const res = await sweep.run(PAST_NOW);
    expect(res.cancelTasksOpened).toBeGreaterThanOrEqual(1);
    expect((await sr(vieja)).guideCancellationPendingAt).toEqual(PAST_NOW);
    expect((await sr(reciente)).guideCancellationPendingAt).toBeNull();
  });
});

// =================================================================================================================== B37/B38
describe('💰 BSD-B37/B38 — en `aceptada` no se rechaza: se declina (BSD-1.3 punto 1)', () => {
  const REMEDY = { code: 'REQUEST_NOT_RECEIVED' };
  it('B37: rechazar la última carta viva ⇒ 422 {remedy}, sigue `aceptada`, sin correo, fila de entrada `solicitado`', async () => {
    const { sr: r, s } = await accepted();
    const row = await inbound(r.id);
    const item = await h.prisma.sellRequestItem.findFirstOrThrow({ where: { sellRequestId: r.id } });
    const res = await h.api('PATCH', `/admin/buylist/items/${item.id}/decision`, { token: operator.token, json: { decision: 'reject', reason: 'llegó dañada' } });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ ...REMEDY, details: { sellRequestId: r.id, status: 'aceptada', remedy: 'decline_accepted' } });
    expect((await sr(r.id)).status).toBe('aceptada');
    expect((await h.prisma.sellRequestItem.findUniqueOrThrow({ where: { id: item.id } })).itemStatus).toBe('cotizada');
    expect(mailsTo(s.email)).toEqual([]);
    expect((await shr(row.id)).status).toBe('solicitado');
  });

  it('B37 (la guarda en el WHERE): una `aceptada` con TODAS sus cartas ya rechazadas (dato heredado) NO se auto-cierra', async () => {
    const { sr: r } = await accepted({}, [{ itemStatus: 'rechazada', rejectedAt: new Date(), rejectionReason: 'heredado' }]);
    const row = await inbound(r.id);
    await (svc as unknown as { maybeAutoRejectRequest(id: string): Promise<void> }).maybeAutoRejectRequest(r.id);
    expect((await sr(r.id)).status).toBe('aceptada');
    expect((await shr(row.id)).status).toBe('solicitado');
  });

  it('B38: `POST …/reject` ⇒ el mismo 422', async () => {
    const { sr: r } = await accepted({}, [{ itemStatus: 'rechazada', rejectedAt: new Date(), rejectionReason: 'heredado' }]);
    const res = await h.api('POST', `/admin/buylist/${r.id}/reject`, { token: operator.token, json: { reason: 'todas rechazadas' } });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ ...REMEDY, details: { sellRequestId: r.id, status: 'aceptada', remedy: 'decline_accepted' } });
    expect((await sr(r.id)).status).toBe('aceptada');
  });

  it('B38 (la guarda en el WHERE): el aviso leyó una fila VIEJA (aún `ofertada`) y se aceptó después ⇒ el WHERE la frena: 422 y sigue `aceptada`', async () => {
    const { sr: r } = await accepted({}, [{ itemStatus: 'rechazada', rejectedAt: new Date(), rejectionReason: 'heredado' }]);
    const real = h.prisma.sellRequest.findUnique.bind(h.prisma.sellRequest);
    const spy = jest.spyOn(h.prisma.sellRequest, 'findUnique').mockImplementationOnce((async (args: { where: { id: string } }) => {
      const row = await real(args as never);
      return row ? { ...row, status: 'ofertada' } : row;
    }) as never);
    try {
      await expect(svc.rejectRequest(r.id)).rejects.toMatchObject({ response: { code: 'REQUEST_NOT_RECEIVED', details: { remedy: 'decline_accepted' } } });
    } finally {
      spy.mockRestore();
    }
    expect((await sr(r.id)).status).toBe('aceptada');
  });

  it('`isRejectable` es `false` en `aceptada` (el botón de M5 no promete un cierre que da 422)', async () => {
    const { sr: r } = await accepted({}, [{ itemStatus: 'rechazada', rejectedAt: new Date(), rejectionReason: 'heredado' }]);
    const dto = await h.api('GET', `/admin/buylist/${r.id}`, { token: operator.token });
    expect(dto.body.isRejectable).toBe(false);
  });
});

// =================================================================================================================== B39
describe('💰 BSD-B39 (mitad B-3) — la guía de entrada ATASCADA se ve en M5 y en su contador', () => {
  it('reclamo en vuelo más viejo que el umbral ⇒ `labelAlert` en la ficha (canRelease para súper-admin), en `?inboundLabelAlert=true` y en el contador; ⛔ no en la lista de M4', async () => {
    const { sr: r } = await accepted();
    const row = await inbound(r.id, { labelProcessingSince: new Date(Date.now() - 20 * 60 * 1000) });
    const ficha = await h.api('GET', `/admin/buylist/${r.id}`, { token: admin.token });
    expect(ficha.body.inboundShipment).toMatchObject({ id: row.id, status: 'solicitado', labelProcessing: true, labelAlert: { kind: 'label_unknown', canRelease: true } });
    expect(ficha.body.inboundShipment).not.toHaveProperty('labelUrl');
    // §BSD.5: `inboundLabelOptions` en el detalle, por el MISMO `labelOptionsFor` del motor (proveedor apagado aquí ⇒ no compra).
    expect(ficha.body.inboundLabelOptions).toMatchObject({ canPurchase: false });
    expect(['off', 'skydropx']).toContain(ficha.body.inboundLabelOptions.provider);
    const fichaOp = await h.api('GET', `/admin/buylist/${r.id}`, { token: operator.token });
    expect(fichaOp.body.inboundShipment.labelAlert).toMatchObject({ kind: 'label_unknown', canRelease: false });
    const lista = await h.api('GET', `/admin/buylist?inboundLabelAlert=true&pageSize=100`, { token: operator.token });
    expect(lista.status).toBe(200);
    expect(lista.body.data.map((x: { id: string }) => x.id)).toContain(r.id);
    expect(lista.body.data.every((x: { inboundShipment: { labelAlert: unknown } | null }) => x.inboundShipment?.labelAlert)).toBe(true);
    const { sr: limpia } = await accepted();
    await inbound(limpia.id);
    const lista2 = await h.api('GET', `/admin/buylist?inboundLabelAlert=true&pageSize=100`, { token: operator.token });
    expect(lista2.body.data.map((x: { id: string }) => x.id)).not.toContain(limpia.id);
    const wq = await svc.workQueueCounts();
    expect(wq.buylistInboundLabelAlert).toBeGreaterThanOrEqual(1);
    const tablero = await h.api('GET', '/admin/dashboard', { token: admin.token });
    expect(tablero.body.workQueue.buylistInboundLabelAlert).toBe(wq.buylistInboundLabelAlert);
    const m4 = await h.api('GET', `/admin/shipments?pageSize=100`, { token: operator.token });
    expect(JSON.stringify(m4.body)).not.toContain(row.id);
  });
});

// =================================================================================================================== §BSD.4.5
describe('💰 §BSD.4.5 — la captura a mano frente a la guía de entrada', () => {
  it('con guía viva de Skydropx ⇒ 409 SHIPMENT_ALREADY_LABELED {skydropx, shipmentId}; con reclamo ⇒ 409 LABEL_IN_PROGRESS; fila inerte ⇒ 200', async () => {
    const { sr: a } = await accepted();
    const g = await liveSkydropxGuide(a.id);
    const ra = await h.api('POST', `/admin/buylist/${a.id}/guide`, { token: operator.token, json: { carrier: 'DHL', trackingNumber: `X${RUN}` } });
    expect([ra.status, ra.body.error?.code, ra.body.error?.details]).toEqual([409, 'SHIPMENT_ALREADY_LABELED', { labelSource: 'skydropx', shipmentId: g.row.id }]);
    const { sr: b } = await accepted();
    await inbound(b.id, { labelProcessingSince: new Date() });
    const rb = await h.api('POST', `/admin/buylist/${b.id}/guide`, { token: operator.token, json: { carrier: 'DHL', trackingNumber: `Y${RUN}` } });
    expect([rb.status, rb.body.error?.code]).toEqual([409, 'LABEL_IN_PROGRESS']);
    const { sr: c } = await accepted();
    await inbound(c.id);
    const rc = await h.api('POST', `/admin/buylist/${c.id}/guide`, { token: operator.token, json: { carrier: 'DHL', trackingNumber: `Z${RUN}` } });
    expect(rc.status).toBe(200);
  });
});

// =================================================================================================================== §BSD.4.5 domicilio
describe('💰 §BSD.4.5 — el domicilio de origen y la fila de entrada', () => {
  const addr = async (userId: string, over: Over = {}) =>
    h.prisma.address.create({
      data: { userId, recipientName: 'Ana Vendedora', line1: 'Av. Nueva 99', neighborhood: 'Centro', city: 'Álvaro Obregón', state: 'Ciudad de México', postalCode: '01000', country: 'MX', phone: '5500002222', references: 'Portón verde', ...over },
    });

  it('vendedor: la copia gana `recipientName`/`references`; la fila en `solicitado` toma la copia (⛔ `addressId`), versión +1 y revisión del vendedor', async () => {
    const { sr: r, s } = await accepted();
    const row = await inbound(r.id);
    const a = await addr(s.id);
    const res = await h.api('PATCH', `/buylist/requests/${r.id}/pickup-address`, { token: s.token, json: { addressId: a.id } });
    expect(res.status).toBe(200);
    expect((await sr(r.id)).pickupAddressSnapshot).toMatchObject({ recipientName: 'Ana Vendedora', references: 'Portón verde', addressId: a.id });
    const after = await shr(row.id);
    expect(after.addressVersion).toBe(1);
    // La copia ÚNICA de §BSD.4.1 (`inboundAddressSnapshotOf`, B-2): todas las claves, `line2` ausente ⇒ `null`.
    expect(after.addressSnapshot).toEqual({
      recipientName: 'Ana Vendedora',
      line1: 'Av. Nueva 99',
      line2: null,
      neighborhood: 'Centro',
      city: 'Álvaro Obregón',
      state: 'Ciudad de México',
      postalCode: '01000',
      country: 'MX',
      phone: '5500002222',
      references: 'Portón verde',
    });
    const rev = await h.prisma.shipmentAddressRevision.findFirstOrThrow({ where: { shipmentRequestId: row.id } });
    expect(rev).toMatchObject({ fromVersion: 0, correctedByUserId: s.id });
    expect(rev.changedKeys).toEqual(expect.arrayContaining(['recipientName', 'line1', 'references']));
  });

  it('vendedor con compra EN CURSO ⇒ 409 PICKUP_ADDRESS_LOCKED {reason:label_in_progress}; la fila no cambia', async () => {
    const { sr: r, s } = await accepted();
    const row = await inbound(r.id, { labelProcessingSince: new Date() });
    const a = await addr(s.id);
    const res = await h.api('PATCH', `/buylist/requests/${r.id}/pickup-address`, { token: s.token, json: { addressId: a.id } });
    expect([res.status, res.body.error?.code, res.body.error?.details]).toEqual([409, 'PICKUP_ADDRESS_LOCKED', { reason: 'label_in_progress' }]);
    expect((await shr(row.id)).addressVersion).toBe(0);
  });

  it('admin: con guía de Skydropx viva ⇒ 409 SHIPMENT_ALREADY_LABELED; con reclamo ⇒ 409 LABEL_IN_PROGRESS; sin nada ⇒ 200 y re-sincroniza', async () => {
    const { sr: a, s: sa } = await accepted();
    const g = await liveSkydropxGuide(a.id);
    const ra = await h.api('PATCH', `/admin/buylist/${a.id}/pickup-address`, { token: operator.token, json: { addressId: (await addr(sa.id)).id } });
    expect([ra.status, ra.body.error?.code, ra.body.error?.details]).toEqual([409, 'SHIPMENT_ALREADY_LABELED', { labelSource: 'skydropx', shipmentId: g.row.id }]);
    const { sr: b, s: sb } = await accepted();
    await inbound(b.id, { labelProcessingSince: new Date() });
    const rb = await h.api('PATCH', `/admin/buylist/${b.id}/pickup-address`, { token: operator.token, json: { addressId: (await addr(sb.id)).id } });
    expect([rb.status, rb.body.error?.code]).toEqual([409, 'LABEL_IN_PROGRESS']);
    const { sr: c, s: sc } = await accepted();
    const rowC = await inbound(c.id);
    const rc = await h.api('PATCH', `/admin/buylist/${c.id}/pickup-address`, { token: operator.token, json: { addressId: (await addr(sc.id, { line1: 'Calle Admin 1' })).id } });
    expect(rc.status).toBe(200);
    const after = await shr(rowC.id);
    expect(after.addressVersion).toBe(1);
    expect((after.addressSnapshot as { line1: string }).line1).toBe('Calle Admin 1');
    expect((await h.prisma.shipmentAddressRevision.findFirstOrThrow({ where: { shipmentRequestId: rowC.id } })).correctedByUserId).toBe(sc.id);
  });
});

/**
 * buylist-rastreo.e2e-spec.ts — §BUYLIST-RASTREO (docs/DECISIONES.md, criterios 1-9 y R1-R8) contra Postgres REAL y la app Nest real.
 * Proveedor = el DOBLE (`FakeShippingProvider`, ⛔ nunca la red); correo = un puerto que CAPTURA. Propiedad: backend.
 *
 * Cada prueba usa un vendedor propio y dispara el sondeo POR ENVÍO (`run({shipmentId})`) para no tocar filas de otras suites;
 * el barrido corre con un «ahora» PASADO (`PAST_NOW`) para que sus reglas solo alcancen las filas de esta suite.
 */
import { randomBytes } from 'crypto';
import { Role } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { CaptureMail } from './helpers/spend-db';
import { dial, restoreDials } from './helpers/label-db';
import { AuthService } from '../../src/modules/auth/auth.service';
import { MAIL_PORT } from '../../src/modules/mail/mail.port';
import { FakeShippingProvider } from '../../src/modules/shipping-provider/fake-shipping-provider';
import { SHIPPING_PROVIDER_SELECTION } from '../../src/modules/shipping-provider/shipping-provider.module';
import { ShippingProviderSelection } from '../../src/modules/shipping-provider/shipping-provider.factory';
import { BuylistSweepJobService } from '../../src/jobs/buylist-sweep.service';
import { ShipmentCarrierService } from '../../src/modules/shipments/carrier-status.service';
import { ShipmentTrackingPollJob } from '../../src/modules/shipments/tracking-poll.job';

const RUN = randomBytes(4).toString('hex');
const DAY = 24 * 3600 * 1000;
const H = 3600 * 1000;
const PAST_NOW = new Date('2026-09-11T18:00:00.000Z');
const SNAPSHOT = { recipientName: 'Vendedor RT', line1: 'Calle Privada 12', city: 'CDMX', state: 'CDMX', postalCode: '01000', country: 'MX', phone: '5500001111' };

let h: E2EHarness;
const mail = new CaptureMail();
const fake = new FakeShippingProvider();
let sweep: BuylistSweepJobService;
let poll: ShipmentTrackingPollJob;
let operator: { id: string; token: string };
let cardId: string;
let seq = 0;

const purchase = () => ({
  providerRateId: 'rate-rt',
  chosenRateJson: { priceCents: 15000, carrierLabel: 'Estafeta' },
  rateChosenByUserId: operator.id,
  rateChosenAt: new Date(),
  labelPurchasedAt: new Date(),
  packageCode: '4G',
  declaredValueCents: 250000,
  insuredValueCents: 150000,
});

beforeAll(async () => {
  const sel: ShippingProviderSelection = { port: fake, kind: 'fake', urlHosts: ['pro.skydropx.com'], client: null };
  h = await E2EHarness.create((b) => b.overrideProvider(MAIL_PORT).useValue(mail).overrideProvider(SHIPPING_PROVIDER_SELECTION).useValue(sel));
  sweep = h.app.get(BuylistSweepJobService);
  poll = h.app.get(ShipmentTrackingPollJob);
  const u = await h.prisma.user.create({ data: { role: Role.vault_operator, name: `op ${RUN}`, email: `rt-op-${RUN}@e2e.local`, emailVerified: true, phone: '5512340000', locale: 'es' } });
  operator = { id: u.id, token: (await h.app.get(AuthService).issueTokens(u)).accessToken };
  cardId = (await h.prisma.card.findFirstOrThrow({ select: { id: true } })).id;
  await dial(h, 'shipping_provider', 'skydropx');
}, 120_000);

afterAll(async () => {
  if (h) {
    // Lo que esta suite deja vivo contamina a otras (guías vivas de entrada): se neutraliza todo lo de sus vendedores.
    await h.prisma.$executeRawUnsafe(
      `UPDATE "ShipmentRequest" SET "providerCanceledAt" = COALESCE("providerCanceledAt", now()), "providerCancelReason" = COALESCE("providerCancelReason",'auto_close'),
              "providerCancelConfirmedAt" = COALESCE("providerCancelConfirmedAt", now()), "status" = 'cancelado'
        WHERE "sellRequestId" IN (SELECT sr.id FROM "SellRequest" sr JOIN "User" u ON u.id = sr."userId" WHERE u.email LIKE 'rt-seller-%')`,
    );
    // Las `expirada` de la reapertura traen la tarea «cancelar guía no usada»: se limpia para no empujar fuera de la 1.ª página (100) la cola de
    // otras suites (BSD-B14 la lee).
    await h.prisma.$executeRawUnsafe(
      `UPDATE "SellRequest" SET "guideCancellationPendingAt" = NULL WHERE "userId" IN (SELECT id FROM "User" WHERE email LIKE 'rt-seller-%')`,
    );
    await restoreDials(h);
    await h.close();
  }
});

beforeEach(() => mail.reset());

type Over = Record<string, unknown>;

/** Solicitud + guía de entrada de Skydropx viva + el estado que el doble reportará. */
async function fixture(opts: { sr?: Over; row?: Over; carrier?: { status: string; at?: string } | null; kind?: 'live' | 'manual' } = {}) {
  seq += 1;
  const u = await h.prisma.user.create({
    data: { role: 'customer', name: `Vendedora ${RUN} ${seq}`, email: `rt-seller-${RUN}-${seq}@e2e.local`, emailVerified: true, phone: '5511112222', locale: 'es' },
  });
  const token = (await h.app.get(AuthService).issueTokens(u)).accessToken;
  const sr = await h.prisma.sellRequest.create({
    data: {
      userId: u.id,
      status: 'aceptada',
      acceptedAt: new Date(PAST_NOW.getTime() - 8 * DAY),
      offerSentAt: new Date(PAST_NOW.getTime() - 9 * DAY),
      offerGrossCents: 150000,
      offerShippingFeeCents: 18000,
      offerNetCents: 132000,
      pickupAddressSnapshot: SNAPSHOT,
      shipmentCarrier: 'Estafeta',
      shipmentTrackingNumber: `TRK${randomBytes(4).toString('hex')}`,
      guideSentAt: new Date(PAST_NOW.getTime() - 5 * DAY),
      shipDeadlineAt: new Date(PAST_NOW.getTime() - 1 * DAY),
      ...opts.sr,
    },
  });
  await h.prisma.sellRequestItem.create({
    data: { sellRequestId: sr.id, cardId, productType: 'raw', rawCondition: 'NM', offerDecision: 'buy', offeredPriceCents: 150000, quotedPriceCents: 150000 },
  });
  const pid = `sdx-rt-${RUN}-${randomBytes(4).toString('hex')}`;
  const live = (opts.kind ?? 'live') === 'live';
  const row = await h.prisma.shipmentRequest.create({
    data: {
      kind: 'buylist_inbound',
      sellRequestId: sr.id,
      userId: null,
      orderId: null,
      status: 'guia',
      addressSnapshot: SNAPSHOT,
      shippingFeeCents: 0,
      priceConvention: 'IVA_INCLUSIVE',
      feeConvention: 'FEE_ON_TOP',
      labelSource: live ? 'skydropx' : 'manual',
      ...(live ? { providerShipmentId: pid, carrier: 'estafeta', trackingNumber: sr.shipmentTrackingNumber, ...purchase(), shippingCostCents: 15000 } : {}),
      ...opts.row,
    },
  });
  if (live) {
    await h.prisma.shipmentPaidLabel.create({ data: { providerShipmentId: pid, shipmentRequestId: row.id, origin: 'response', chargedCents: 15000 } });
    if (opts.carrier !== null) {
      const c = opts.carrier ?? { status: 'in_transit' };
      // El doble: la guía existe en el proveedor con ese estado (sintético, con `updated_at` fijo ⇒ llave estable).
      (fake as unknown as { shipments: Map<string, unknown> }).shipments.set(pid, {
        providerShipmentId: pid,
        carrierName: 'estafeta',
        trackingNumber: row.trackingNumber,
        rawLabelUrl: null,
        rawTrackingUrl: null,
        totalCents: 15000,
        insuranceCents: 0,
        error: null,
        carrierStatus: c.status,
        unknownCarrierStatus: null,
        statusUpdatedAt: c.at ?? '2026-11-20T15:00:00.000Z',
        events: [],
        providerReference: null,
        raw: { id: pid },
      });
    }
  }
  return { u, token, sr, row, pid };
}

const sr = (id: string) => h.prisma.sellRequest.findUniqueOrThrow({ where: { id } });
const shr = (id: string) => h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id } });
const audits = (id: string, action: string) => h.prisma.auditLog.count({ where: { entityId: id, action } });
const MONEY = ['offerGrossCents', 'offerShippingFeeCents', 'offerNetCents', 'payoutNetCents', 'approvedTotalCents', 'paidAt', 'guideActualCostCents'] as const;
const money = async (id: string) => {
  const r = await sr(id);
  return MONEY.map((k) => r[k]);
};
const pollOne = (shipmentId: string) => poll.run({ shipmentId });

describe('§BUYLIST-RASTREO — sondeo de la guía de entrada', () => {
  it('C1: en tránsito ⇒ en_transito por sistema, 1 auditoría; N=5 sondeos más ⇒ 0 cambios', async () => {
    const f = await fixture({ sr: { shipDeadlineAt: new Date(Date.now() + 2 * DAY) } });
    const before = await money(f.sr.id);
    await pollOne(f.row.id);
    const after = await sr(f.sr.id);
    expect(after.status).toBe('en_transito');
    expect(after.shipmentConfirmedBy).toBe('system:carrier');
    expect(after.shipmentConfirmedAt).not.toBeNull();
    expect(await audits(f.sr.id, 'buylist.shipment.confirm')).toBe(1);
    const a = await h.prisma.auditLog.findFirstOrThrow({ where: { entityId: f.sr.id, action: 'buylist.shipment.confirm' } });
    expect(a.actorUserId).toBeNull();
    expect((a.after as { source: string }).source).toBe('carrier');
    const snap = JSON.stringify(after);
    for (let i = 0; i < 5; i++) await pollOne(f.row.id);
    expect(JSON.stringify(await sr(f.sr.id))).toBe(snap);
    expect(await audits(f.sr.id, 'buylist.shipment.confirm')).toBe(1);
    expect(await money(f.sr.id)).toEqual(before); // criterio 3: ningún movimiento de dinero
    expect(mail.sent.filter((m) => m.to === f.u.email)).toHaveLength(0);
  });

  it('C1b: recolectado y último tramo también mueven; `created` NO', async () => {
    for (const [status, moves] of [['picked_up', true], ['last_mile', true], ['created', false]] as const) {
      const f = await fixture({ carrier: { status } });
      await pollOne(f.row.id);
      expect((await sr(f.sr.id)).status).toBe(moves ? 'en_transito' : 'aceptada');
    }
  });

  it('C3: entregado ⇒ en_transito, NUNCA recibida; el dinero no cambia; el DTO trae deliveredAt', async () => {
    const f = await fixture({ carrier: { status: 'delivered' } });
    const before = await money(f.sr.id);
    await pollOne(f.row.id);
    const after = await sr(f.sr.id);
    expect(after.status).toBe('en_transito');
    expect(after.receivedAt).toBeNull();
    expect(await money(f.sr.id)).toEqual(before);
    const det = await h.api('GET', `/admin/buylist/${f.sr.id}`, { token: operator.token });
    expect(det.body.inboundCarrier).toMatchObject({ status: 'delivered', estimatedDeliveryAt: null, pollError: false });
    expect(det.body.inboundCarrier.deliveredAt).toBe('2026-11-20T15:00:00.000Z');
    expect(Object.keys(det.body.inboundCarrier).sort()).toEqual(['deliveredAt', 'estimatedDeliveryAt', 'pollError', 'polledAt', 'stalledDays', 'status', 'statusAt']);
    const mine = await h.api('GET', `/buylist/requests/${f.sr.id}`, { token: f.token });
    expect(mine.body.inboundCarrier).toMatchObject({ status: 'delivered' });
    // un entregado deja de sondearse
    const calls = fake.callsOf('getShipment').length;
    await poll.run();
    expect(fake.callsOf('getShipment').filter((c) => c.input === f.pid)).toHaveLength(fake.callsOf('getShipment').slice(0, calls).filter((c) => c.input === f.pid).length);
  });

  it('C6: incidencia / devuelto ⇒ estado igual, ningún correo al vendedor', async () => {
    for (const status of ['exception', 'in_return']) {
      const f = await fixture({ carrier: { status } });
      await pollOne(f.row.id);
      expect((await sr(f.sr.id)).status).toBe('aceptada');
      expect(mail.sent.filter((m) => m.to === f.u.email)).toHaveLength(0);
      expect(await audits(f.sr.id, 'buylist.shipment.confirm')).toBe(0);
    }
  });

  it('C5a: proveedor caído ⇒ 0 cambios en la solicitud, sin auditoría, el job no lanza y no sella el sondeo', async () => {
    const f = await fixture({ carrier: null });
    const snap = JSON.stringify(await sr(f.sr.id));
    const r = await pollOne(f.row.id);
    expect(r.errors).toBe(1);
    expect(JSON.stringify(await sr(f.sr.id))).toBe(snap);
    expect(await audits(f.sr.id, 'buylist.shipment.confirm')).toBe(0);
    expect((await shr(f.row.id)).carrierPolledAt).toBeNull();
  });

  it('guía del vendedor por su cuenta (sin guía nuestra) NO se sondea', async () => {
    const f = await fixture({ kind: 'manual' });
    const r = await pollOne(f.row.id);
    expect(r.polled).toBe(0);
    await poll.run();
    expect((await shr(f.row.id)).carrierPolledAt).toBeNull();
    expect((await shr(f.row.id)).carrierStatus).toBeNull();
    expect((await sr(f.sr.id)).status).toBe('aceptada');
  });

  it('solicitud cerrada ⇒ su guía deja de sondearse', async () => {
    const f = await fixture({ sr: { status: 'expirada', expiredReason: 'not_continued', closedAt: new Date() } });
    const before = fake.callsOf('getShipment').filter((c) => c.input === f.pid).length;
    await poll.run();
    expect(fake.callsOf('getShipment').filter((c) => c.input === f.pid)).toHaveLength(before);
  });

  it('el job sin `shipmentId` recoge la guía de entrada viva (reparación del primer ciclo, N=3)', async () => {
    const fs = [await fixture(), await fixture(), await fixture()];
    await poll.run();
    for (const f of fs) expect((await sr(f.sr.id)).status).toBe('en_transito');
  });
});

describe('§BUYLIST-RASTREO — barrido (regla 2)', () => {
  it('C2: plazo vencido + paquete en movimiento ⇒ en_transito (no expirada), 0 correos 3b, 0 tareas de guía muerta', async () => {
    const f = await fixture();
    await sweep.run(PAST_NOW);
    const after = await sr(f.sr.id);
    expect(after.status).toBe('en_transito');
    expect(after.expiredReason).toBeNull();
    expect(after.guideCancellationPendingAt).toBeNull();
    expect(mail.sent.filter((m) => m.to === f.u.email)).toHaveLength(0);
  });

  it('C2b: con movimiento YA registrado en la fila, la regla 2 no cierra aunque el proveedor no conteste', async () => {
    const f = await fixture({ carrier: null, sr: { shipDeadlineAt: new Date(PAST_NOW.getTime() - 3 * DAY) }, row: { carrierStatus: 'in_transit', carrierStatusAt: new Date(PAST_NOW.getTime() - H), carrierPolledAt: new Date(PAST_NOW.getTime() - H) } });
    await sweep.run(PAST_NOW);
    expect((await sr(f.sr.id)).status).toBe('aceptada');
    expect((await sr(f.sr.id)).closedAt).toBeNull();
  });

  it('C5b: proveedor caído 25 h con plazo vencido ⇒ pospone; a las 48 h ⇒ cierra; con sondeo reciente y sin movimiento ⇒ cierra', async () => {
    const stale = new Date(PAST_NOW.getTime() - 25 * H);
    const a = await fixture({ carrier: null, row: { carrierPolledAt: stale }, sr: { shipDeadlineAt: new Date(PAST_NOW.getTime() - 1 * DAY) } });
    const b = await fixture({ carrier: null, row: { carrierPolledAt: stale }, sr: { shipDeadlineAt: new Date(PAST_NOW.getTime() - 49 * H) } });
    const c = await fixture({ carrier: { status: 'created' }, row: { carrierPolledAt: new Date(PAST_NOW.getTime() - H) }, sr: { shipDeadlineAt: new Date(PAST_NOW.getTime() - 1 * DAY) } });
    await sweep.run(PAST_NOW);
    expect((await sr(a.sr.id)).status).toBe('aceptada');
    expect((await sr(b.sr.id)).status).toBe('expirada');
    // `c`: el sondeo previo (real) leyó `created`; su `carrierPolledAt` quedó en el reloj real (> PAST_NOW) ⇒ no está viejo ⇒ cierra.
    expect((await sr(c.sr.id)).status).toBe('expirada');
  });
});

describe('§BUYLIST-RASTREO — reapertura automática (dueño: B), R1-R8', () => {
  const closed = (days: number, over: Over = {}) => ({
    status: 'expirada',
    expiredReason: 'not_shipped',
    closedAt: new Date(Date.now() - days * DAY),
    shipDeadlineAt: new Date(Date.now() - (days + 1) * DAY),
    guideCancellationPendingAt: new Date(Date.now() - days * DAY),
    ...over,
  });
  /** `scanOffsetH` = cuándo se vio el PRIMER escaneo respecto del plazo de envío (−2 h = a tiempo). */
  const reopenFixture = (days = 3, srOver: Over = {}, rowOver: Over = {}, scanOffsetH = -2) => {
    const sr0 = closed(days, srOver);
    const at = new Date((sr0.shipDeadlineAt as Date).getTime() + scanOffsetH * H).toISOString();
    return fixture({ sr: sr0, row: { status: 'cancelado', ...rowOver }, carrier: { status: 'in_transit', at } });
  };

  it('R1+R7: reabre a en_transito, fila → guia, tarea cerrada, 1 auditoría before/after, 1 correo; 2.º ciclo 0/0/0; dinero idéntico', async () => {
    const f = await reopenFixture();
    const before = await money(f.sr.id);
    await pollOne(f.row.id);
    const after = await sr(f.sr.id);
    expect(after.status).toBe('en_transito');
    expect(after.closedAt).toBeNull();
    expect(after.expiredReason).toBeNull();
    expect(after.shipmentConfirmedBy).toBe('system:carrier');
    expect(after.guideCancellationPendingAt).toBeNull();
    expect((await shr(f.row.id)).status).toBe('guia');
    const a = await h.prisma.auditLog.findMany({ where: { entityId: f.sr.id, action: 'buylist.reopen_by_carrier' } });
    expect(a).toHaveLength(1);
    expect(a[0].actorUserId).toBeNull();
    expect(a[0].before).toMatchObject({ status: 'expirada', expiredReason: 'not_shipped', inboundStatus: 'cancelado' });
    expect(a[0].after).toMatchObject({ status: 'en_transito', carrierStatus: 'in_transit', actor: 'system:carrier' });
    const mails = mail.sent.filter((m) => m.to === f.u.email);
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toMatch(/Corrección/);
    expect(mails[0].text).not.toMatch(/\$|\d{3}\s?MXN|Estafeta|TRK/);
    expect(await money(f.sr.id)).toEqual(before); // R7
    const snap = JSON.stringify(await sr(f.sr.id));
    await pollOne(f.row.id);
    await sweep.run(PAST_NOW);
    expect(JSON.stringify(await sr(f.sr.id))).toBe(snap);
    expect(await audits(f.sr.id, 'buylist.reopen_by_carrier')).toBe(1);
    expect(mail.sent.filter((m) => m.to === f.u.email)).toHaveLength(1);
  });

  const stays = async (f: Awaited<ReturnType<typeof reopenFixture>>) => {
    const snap = JSON.stringify(await sr(f.sr.id));
    await pollOne(f.row.id);
    await poll.run();
    expect(JSON.stringify(await sr(f.sr.id))).toBe(snap);
    expect((await sr(f.sr.id)).status).toBe('expirada');
    expect(await audits(f.sr.id, 'buylist.reopen_by_carrier')).toBe(0);
    expect(mail.sent.filter((m) => m.to === f.u.email)).toHaveLength(0);
  };

  it('R2: guía cancelada ante el proveedor ⇒ no reabre', async () => {
    const f = await reopenFixture(3, {}, { providerCanceledAt: new Date(), providerCancelReason: 'auto_close' });
    // El sondeo ni la mira; pero aunque un evento llegara por otra vía, la regla del propio reabrir lo niega.
    const now = new Date();
    await h.app.get(ShipmentCarrierService).applyCarrierStatus(f.row.id, {
      status: 'in_transit', occurredAt: now, observedAt: now, providerEventKey: 'r2-direct', synthetic: false,
    });
    await stays(f);
  });
  it('R3: con dinero (payoutNetCents sellado) ⇒ no reabre', async () => {
    await stays(await reopenFixture(3, { payoutNetCents: 132000 }));
  });
  it('R4: cierre de 31 días ⇒ no reabre', async () => {
    await stays(await reopenFixture(31));
  });
  it('R5: solicitud sustituta abierta del mismo vendedor ⇒ no reabre', async () => {
    const f = await reopenFixture();
    await h.prisma.sellRequest.create({ data: { userId: f.u.id, status: 'cotizada' } });
    await stays(f);
  });
  it('R6: reabrir excede el tope AML mensual ⇒ no reabre', async () => {
    await dial(h, 'buylist_cap_per_month_cents', 1000);
    try {
      await stays(await reopenFixture());
    } finally {
      await restoreDials(h);
      await dial(h, 'shipping_provider', 'skydropx');
    }
  });
  it('G3-2/I-8: escaneo DESPUÉS del plazo + 24 h ⇒ NO reabre (`shipped_late`); justo dentro de las 24 h ⇒ sí reabre; el correo dice «la paquetería registró tu paquete a tiempo»', async () => {
    await stays(await reopenFixture(3, {}, {}, 25));
    await stays(await reopenFixture(10, {}, {}, 24 * 5)); // envío hecho días después del cierre
    const ok = await reopenFixture(3, {}, {}, 23);
    await pollOne(ok.row.id);
    expect((await sr(ok.sr.id)).status).toBe('en_transito');
    expect(mail.sent.find((m) => m.to === ok.u.email)?.text).toMatch(/la paquetería registró tu paquete a tiempo/);
    expect(mail.sent.find((m) => m.to === ok.u.email)?.text).not.toMatch(/sí llegó/);
  });
  it('I-9: con inventario ya convertido de sus líneas ⇒ NO reabre', async () => {
    const f = await reopenFixture();
    const item = await h.prisma.sellRequestItem.findFirstOrThrow({ where: { sellRequestId: f.sr.id } });
    const inv = await h.prisma.inventoryItem.create({
      data: { folio: `RT-${RUN}-${seq}`, cardId, productType: 'raw', rawCondition: 'NM', finish: 'normal', ownerType: 'platform', status: 'in_stock', acquisitionType: 'compra', acquisitionCostCents: 1000, sourceSellRequestItemId: item.id },
    });
    try {
      await stays(f);
    } finally {
      await h.prisma.inventoryItem.delete({ where: { id: inv.id } });
    }
  });
  it('R8: correo fallido ⇒ queda reabierta y NO hay segundo intento', async () => {
    const f = await reopenFixture();
    mail.failNext = 1;
    await pollOne(f.row.id);
    expect((await sr(f.sr.id)).status).toBe('en_transito');
    await pollOne(f.row.id);
    expect(mail.sent.filter((m) => m.to === f.u.email)).toHaveLength(0);
    expect(mail.failNext).toBe(0); // se intentó UNA vez
  });
});

describe('§BUYLIST-RASTREO — tras gates (I-1, I-7, I-9, m-2)', () => {
  it('I-9 candado `status`: una solicitud que ya pasó de `aceptada` (recibida) NO se mueve ni se reabre por un escaneo', async () => {
    const f = await fixture({ sr: { status: 'recibida', receivedAt: new Date() } });
    const now = new Date();
    await h.app.get(ShipmentCarrierService).applyCarrierStatus(f.row.id, { status: 'in_transit', occurredAt: now, observedAt: now, providerEventKey: 'rt-recibida', synthetic: false });
    expect((await sr(f.sr.id)).status).toBe('recibida');
    expect((await sr(f.sr.id)).shipmentConfirmedBy).toBeNull();
    expect(await audits(f.sr.id, 'buylist.shipment.confirm')).toBe(0);
  });

  it('I-1: `shipmentConfirmedBy` viaja en el DTO ADMIN («system:carrier») y NO en el del vendedor; I-7: pollError false en recibida', async () => {
    const f = await fixture();
    await pollOne(f.row.id);
    const adm = await h.api('GET', `/admin/buylist/${f.sr.id}`, { token: operator.token });
    expect(adm.body.shipmentConfirmedBy).toBe('system:carrier');
    expect(adm.body.inboundCarrier).toHaveProperty('stalledDays', null);
    const mine = await h.api('GET', `/buylist/requests/${f.sr.id}`, { token: f.token });
    expect(mine.body).not.toHaveProperty('shipmentConfirmedBy');
    const stale = await fixture({ sr: { status: 'recibida', receivedAt: new Date() }, row: { carrierStatus: 'in_transit', carrierStatusAt: new Date(Date.now() - 20 * DAY), carrierPolledAt: new Date(Date.now() - 20 * DAY) } });
    const d = await h.api('GET', `/admin/buylist/${stale.sr.id}`, { token: operator.token });
    expect(d.body.inboundCarrier).toMatchObject({ pollError: false, stalledDays: null });
  });

  it('G3-3: en_transito sin escaneo nuevo hace ≥ 10 días ⇒ `stalledDays` en la ficha', async () => {
    const f = await fixture({ sr: { status: 'en_transito', shipmentConfirmedAt: new Date(Date.now() - 12 * DAY), shipmentConfirmedBy: 'system:carrier' }, row: { carrierStatus: 'in_transit', carrierStatusAt: new Date(Date.now() - 12 * DAY), carrierPolledAt: new Date() } });
    const d = await h.api('GET', `/admin/buylist/${f.sr.id}`, { token: operator.token });
    expect(d.body.inboundCarrier.stalledDays).toBeGreaterThanOrEqual(11);
  });

  it('m-2: 30 guías de entrada que FALLAN: ≤ 25 por corrida y la siguiente corrida toma OTRAS (no tapan el lote)', async () => {
    const fs = [] as Awaited<ReturnType<typeof fixture>>[];
    for (let i = 0; i < 30; i++) fs.push(await fixture({ carrier: null, sr: { shipDeadlineAt: new Date(Date.now() + 5 * DAY) } }));
    const mine = new Set(fs.map((f) => f.pid));
    const seen = () => new Set(fake.callsOf('getShipment').map((c) => c.input as string).filter((x) => mine.has(x)));
    const r1 = await poll.run();
    const s1 = new Set(seen());
    expect(s1.size).toBeGreaterThan(0);
    expect(r1.polled).toBeLessThanOrEqual(50);
    expect(s1.size).toBeLessThanOrEqual(25);
    await poll.run();
    expect(seen().size).toBeGreaterThan(s1.size); // la 2.ª corrida llegó a guías que la 1.ª no tocó
  });

  it('B-3 + G4-1: con el proveedor de rastreo APAGADO `inboundCarrier` es null (admin y vendedor); encendido, el vendedor NO recibe `stalledDays`', async () => {
    const f = await fixture({ sr: { status: 'en_transito', shipmentConfirmedAt: new Date(Date.now() - 12 * DAY), shipmentConfirmedBy: 'system:carrier' }, row: { carrierStatus: 'in_transit', carrierStatusAt: new Date(Date.now() - 12 * DAY), carrierPolledAt: new Date() } });
    const seller = () => h.api('GET', `/buylist/requests/${f.sr.id}`, { token: f.token });
    const admin = () => h.api('GET', `/admin/buylist/${f.sr.id}`, { token: operator.token });
    expect((await seller()).body.inboundCarrier).not.toBeNull();
    expect(Object.keys((await seller()).body.inboundCarrier)).not.toContain('stalledDays');
    expect((await admin()).body.inboundCarrier.stalledDays).toBeGreaterThanOrEqual(11);
    await dial(h, 'shipping_provider', 'off');
    try {
      expect((await admin()).body.inboundCarrier).toBeNull();
      expect((await seller()).body.inboundCarrier).toBeNull();
    } finally {
      await dial(h, 'shipping_provider', 'skydropx');
    }
  });

  it('I-14: el PRIMER escaneo decide la reapertura (no el del evento que la dispara): picked_up a tiempo bloqueado por sustituta; luego `delivered` tarde ⇒ reabre', async () => {
    const f = await fixture({ sr: { status: 'expirada', expiredReason: 'not_shipped', closedAt: new Date(Date.now() - 3 * DAY), shipDeadlineAt: new Date(Date.now() - 4 * DAY), guideCancellationPendingAt: new Date() }, row: { status: 'cancelado' }, carrier: null });
    const deadline = new Date(Date.now() - 4 * DAY).getTime();
    const setState = (status: string, at: number) =>
      (fake as unknown as { shipments: Map<string, unknown> }).shipments.set(f.pid, {
        providerShipmentId: f.pid, carrierName: 'estafeta', trackingNumber: f.row.trackingNumber, rawLabelUrl: null, rawTrackingUrl: null, totalCents: 15000, insuranceCents: 0, error: null,
        carrierStatus: status, unknownCarrierStatus: null, statusUpdatedAt: new Date(at).toISOString(), providerReference: null, raw: {}, events: [],
      });
    const substitute = await h.prisma.sellRequest.create({ data: { userId: f.u.id, status: 'cotizada' } });
    setState('picked_up', deadline - 2 * H); // a tiempo, pero hay solicitud sustituta ⇒ no reabre (y el escaneo queda registrado)
    await pollOne(f.row.id);
    expect((await sr(f.sr.id)).status).toBe('expirada');
    await h.prisma.sellRequest.delete({ where: { id: substitute.id } });
    setState('delivered', deadline + 3 * DAY); // llega TARDE el siguiente evento: decide el primero (a tiempo)
    await pollOne(f.row.id);
    expect((await sr(f.sr.id)).status).toBe('en_transito');
    expect(await audits(f.sr.id, 'buylist.reopen_by_carrier')).toBe(1);
  });

  it('m-14: una reapertura rechazada deja UNA fila de bitácora `buylist.reopen_skipped` con su motivo (consultable sin logs)', async () => {
    const f = await fixture({ sr: { status: 'expirada', expiredReason: 'not_shipped', closedAt: new Date(Date.now() - 3 * DAY), shipDeadlineAt: new Date(Date.now() - 6 * DAY), guideCancellationPendingAt: new Date() }, row: { status: 'cancelado' }, carrier: { status: 'in_transit', at: new Date(Date.now() - 2 * DAY).toISOString() } });
    await pollOne(f.row.id);
    await pollOne(f.row.id);
    const rows = await h.prisma.auditLog.findMany({ where: { action: 'buylist.reopen_skipped', entityId: f.sr.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].after).toMatchObject({ reason: 'shipped_late' });
    expect((await sr(f.sr.id)).status).toBe('expirada');
  });
});

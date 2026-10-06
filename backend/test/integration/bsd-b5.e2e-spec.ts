/**
 * bsd-b5.e2e-spec.ts — 💰 errata BSD-1.4 (`API_CONTRACT §BSD.18`, `ARCHITECTURE §4.BSD (n)`) contra Postgres REAL y la app Nest
 * completa por HTTP, con el proveedor DOBLE (⛔ nunca la red: PS-99) y la llave de gasto SUSTITUIDA (⛔ ninguna prueba pone
 * `SKYDROPX_ALLOW_SPEND`). Propiedad: backend.
 *
 * | ID | Qué afirma | Mutación que la pone roja |
 * |---|---|---|
 * | BSD-B40 (b) | AV-7 MANUAL: capturar A y luego B (las dos comitean); el post-commit de A ⇒ 0 correos; el de B ⇒ 1 con B | quitar `shipmentTrackingNumber` de `guideNoticeSealWhere` |
 * | BSD-B40 (c) | AV-7 de ENTRADA: solicitud cerrada antes de `notifyLabeled` ⇒ 0 correos (cierre real, y el estado `aceptada ∧ closedAt` que solo el predicado frena) | quitar `closedAt` del predicado |
 * | BSD-B41 | `not_continued`: lista y detalle del cliente sin ninguna clave `*Cents` distinta de `null` (recorrido recursivo); `labelPdfAvailable=false`; el DTO admin no cambia | quitar `not_continued` del conjunto |
 * | BSD-B46 | dos solicitudes (bruto 150 000, tarifa 18 000) con guías de entrada de 15 000 y 25 000 ⇒ `paySpei` deja `payoutNetCents = 132000` en las dos | restar `shippingCostCents` de la fila de entrada en el neto de `paySpei` |
 * | Punto 14 | re-emitir deja la fila de entrada con `labelSource` nulo; una guía MANUAL posterior cuenta por (b) y no por (a); el margen usa la manual | — (medición) |
 * | BSD-B16 (ruta real) | declinar ∥ `POST /admin/shipments/:id/label`, N = 12 rondas en 4 modos: (i) cerrada ⇒ fila `cancelado` y sin guía viva; (ii) BSD-M1 y AV-7 ⇒ guía sellada `auto_close` | `decline-accepted` sin `closeInboundShipment`; sin `assertInboundOpenForLabel` en la relectura de `claim` |
 * | BSD-B18 (ruta real) | regla 8 ∥ compra, N = 10 rondas con BARRERA: el reclamo que gana el candado de la solicitud la excluye del cierre | regla 8 sin los candados de `closeWithGuideTask` |
 * | BSD-B31 (ruta real) | declinar ∥ compra ∥ barrido, N = 30 rondas: cero `40P01` y nunca cerrada con guía viva | orden de candados invertido en `decline-accepted` |
 *
 * Las tres carreras se repiten aquí contra la RUTA REAL (§BSD.18 punto 9): `precheck` → `claim` → red → `persistLabeled` →
 * post-commit de AV-7. El sustituto de `bsd-b3.e2e-spec.ts` se queda como prueba rápida y ⛔ no cuenta como la medición.
 * Proporciones, original y mutado, con su N: `BACKEND_NOTES §78.B5`.
 */
import { Prisma } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { R, ShipPrepDb } from './helpers/ship-prep-db';
import { READY_ADDRESS, buyBody, createLabelWorld, dial, errCode, purchaseOn, restoreDials } from './helpers/label-db';
import { diferida, esperarBloqueoDeFila } from './helpers/row-lock-barrier';
import { FakeShippingProvider } from '../../src/modules/shipping-provider/fake-shipping-provider';
import { ManualLabelClock } from '../../src/modules/shipments/label-clock';
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';
import { BuylistService } from '../../src/modules/buylist/buylist.service';
import { BuylistSweepJobService } from '../../src/jobs/buylist-sweep.service';
import { InboundGuideNoticeService } from '../../src/modules/shipments/inbound-guide-notice.service';

const RUN = `b5${Date.now().toString(36)}`;
const DAY = 24 * 60 * 60 * 1000;
/** Un «ahora» PASADO para el barrido: sus reglas no alcanzan filas de otras suites (todas nacen con fechas reales). */
const PAST_NOW = new Date('2026-09-11T18:00:00.000Z');

const STORE = {
  name: 'TCG HUNT',
  company: 'TCG HUNT SA de CV',
  street1: 'Verapaz 123',
  postalCode: '14210',
  areaLevel1: 'Ciudad de México',
  areaLevel2: 'Tlalpan',
  areaLevel3: 'Pedregal de San Nicolás',
  phone: '5511112222',
  email: 'tienda@e2e.local',
  reference: 'Portón gris',
};
const PICKUP = { ...READY_ADDRESS, addressId: 'addr-e2e-b5' };

/** Toda cifra `*Cents` de un DTO, por ruta (recorrido recursivo). */
function cents(v: unknown, path = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (Array.isArray(v)) v.forEach((x, i) => cents(x, `${path}[${i}]`, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (/Cents$/.test(k)) out[`${path}.${k}`] = x;
      else cents(x, `${path}.${k}`, out);
    }
  }
  return out;
}

describe('💰 BSD-1.4 — errata de B-2/B-3/B-4 (§BSD.18)', () => {
  let h: E2EHarness;
  let db: ShipPrepDb;
  let fake: FakeShippingProvider;
  let clock: ManualLabelClock;
  let bandeja: MailMessage[];
  let svc: BuylistService;
  let sweep: BuylistSweepJobService;
  let notice: InboundGuideNoticeService;
  const srIds: string[] = [];

  const open = (srId: string): Promise<R> => h.api('POST', `/admin/buylist/${srId}/inbound-shipment`, { token: db.opToken, json: {} });
  const quote = (id: string, json: unknown = {}): Promise<R> => h.api('POST', `/admin/shipments/${id}/quote`, { token: db.opToken, json });
  const buy = (id: string, json: unknown, token = db.opToken): Promise<R> => {
    clock.advance(1);
    return h.api('POST', `/admin/shipments/${id}/label`, { token, json });
  };
  const decline = (srId: string, reason = 'el operador decidió no seguir'): Promise<R> =>
    h.api('POST', `/admin/buylist/${srId}/decline-accepted`, { token: db.opToken, json: { reason } });
  const row = (id: string) => h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id } });
  const sr = (id: string) => h.prisma.sellRequest.findUniqueOrThrow({ where: { id } });
  const mailsTo = (email: string) => bandeja.filter((m) => m.to === email);
  const isAv7 = (m: MailMessage) => /guía prepagada/.test(m.subject);
  const isBsdM1 = (m: MailMessage) => /No continuaremos con tu solicitud de venta/.test(m.subject);
  const recommendedOf = (q: any) => q.rates.find((r: any) => r.rateId === q.recommendedRateId);

  const mkAccepted = async (over: Partial<Prisma.SellRequestUncheckedCreateInput> = {}) => {
    const seller = await db.mkUser('Vendedora B5');
    const s = await h.prisma.sellRequest.create({
      data: {
        userId: seller.id,
        status: 'aceptada',
        acceptedAt: new Date(),
        offerState: 'sent',
        offerSentAt: new Date(Date.now() - DAY),
        quotedTotalCents: 150000,
        offerGrossCents: 150000,
        offerShippingFeeCents: 18000,
        offerNetCents: 132000,
        pickupAddressSnapshot: PICKUP as Prisma.InputJsonValue,
        ...over,
        items: {
          create: [{ cardId: db.cardId, productType: 'raw', rawCondition: 'NM', quotedPriceCents: 150000, offerDecision: 'buy', offeredPriceCents: 150000 }],
        },
      },
    });
    srIds.push(s.id);
    return { sr: s, seller };
  };

  /** Solicitud aceptada + fila de entrada abierta + cotizada; la tarifa = la recomendada. */
  const readyInbound = async (over: Partial<Prisma.SellRequestUncheckedCreateInput> = {}) => {
    const a = await mkAccepted(over);
    const o = await open(a.sr.id);
    expect(errCode(o)).toBe('200');
    const id = o.body.shipment.id as string;
    const q = await quote(id);
    expect(errCode(q)).toBe('200');
    return { ...a, id, q: q.body, rate: recommendedOf(q.body) };
  };

  /** La solicitud llega, se verifica y se aprueba entera (lo que `paySpei` exige), sin tocar la oferta. */
  const makePayable = async (srId: string) => {
    await h.prisma.sellRequestItem.updateMany({ where: { sellRequestId: srId }, data: { itemStatus: 'aprobada', approvedPriceCents: 150000 } });
    await h.prisma.sellRequest.update({
      where: { id: srId },
      data: { status: 'aprobada', receivedAt: new Date(), verifiedAt: new Date(), approvedTotalCents: 150000, shipmentConfirmedAt: new Date() },
    });
  };

  /** (i)/(ii) de BSD-B16 y la invariante de §BSD.2 (I-BSD-1) sobre UNA ronda. Devuelve los defectos (vacío = bien). */
  const roundDefects = async (tag: string, srId: string, shId: string, email: string): Promise<string[]> => {
    const bad: string[] = [];
    const s = await sr(srId);
    const r = await row(shId);
    const sealedAutoClose = r.providerShipmentId !== null && r.providerCanceledAt !== null && r.providerCancelReason === 'auto_close';
    if (s.closedAt !== null) {
      if (r.status !== 'cancelado') bad.push(`${tag}: cerrada con fila de entrada «${r.status}»`);
      if (r.providerShipmentId !== null && !sealedAutoClose) bad.push(`${tag}: cerrada con guía VIVA`);
      if (r.labelProcessingSince !== null) bad.push(`${tag}: cerrada con reclamo vivo`);
    }
    const ms = mailsTo(email);
    if (ms.some(isBsdM1) && ms.some(isAv7) && !sealedAutoClose) bad.push(`${tag}: BSD-M1 y AV-7 con la guía viva`);
    return bad;
  };

  beforeAll(async () => {
    ({ h, db, fake, clock } = await createLabelWorld(RUN));
    await purchaseOn(h, 'operators');
    await dial(h, 'skydropx_origin_snapshot', STORE);
    await dial(h, 'operator_label_cap_24h_cents', 1_000_000_000);
    await dial(h, 'shipping_label_reissue_max_per_shipment', 5);
    await dial(h, 'buylist_guide_close_calendar_days', 7);
    await dial(h, 'buylist_cap_per_month_cents', 1_000_000_000);
    svc = h.app.get(BuylistService);
    sweep = h.app.get(BuylistSweepJobService);
    notice = h.app.get(InboundGuideNoticeService);
    const port = h.app.get<MailPort>(MAIL_PORT);
    jest.spyOn(port, 'send').mockImplementation(async (msg: MailMessage) => {
      bandeja.push(msg);
      return {};
    });
  });

  afterAll(async () => {
    const p = h.prisma;
    const inbound = (await p.shipmentRequest.findMany({ where: { sellRequestId: { in: srIds } }, select: { id: true } })).map((r) => r.id);
    await p.shipmentPaidLabel.deleteMany({ where: { shipmentRequestId: { in: inbound } } });
    await p.shipmentLabelAttempt.deleteMany({ where: { shipmentRequestId: { in: inbound } } });
    await p.shipmentCostAdjustment.deleteMany({ where: { shipmentRequestId: { in: inbound } } });
    await p.shipmentAddressRevision.deleteMany({ where: { shipmentRequestId: { in: inbound } } });
    await p.spendAlert.deleteMany({ where: { OR: [{ shipmentRequestId: { in: inbound } }, { subjectUserId: { in: [db.operatorId, db.adminId] } }] } });
    await p.shipmentQuote.deleteMany({ where: { shipmentRequestId: { in: inbound } } });
    await p.shipmentRequest.deleteMany({ where: { id: { in: inbound } } });
    await p.auditLog.deleteMany({ where: { entityId: { in: [...srIds, ...inbound] } } });
    await p.sellRequestItem.deleteMany({ where: { sellRequestId: { in: srIds } } });
    await p.sellRequest.deleteMany({ where: { id: { in: srIds } } });
    await restoreDials(h);
    await db.cleanup();
    await h?.close();
  });

  beforeEach(async () => {
    fake.calls.length = 0;
    fake.purchaseOutcomes.length = 0;
    fake.cancelOutcomes.length = 0;
    fake.purchaseBarrier = null;
    fake.onPurchase = null;
    fake.onBalance = null;
    fake.balanceCents = 10_000_000;
    fake.reuseQuotations = false;
    fake.forgetQuotations();
    clock.set(new Date());
    bandeja = [];
    await dial(h, 'shipping_provider', 'skydropx');
    await dial(h, 'shipping_label_purchase', 'operators');
  });

  afterEach(async () => {
    // Un reclamo «en vuelo» que una prueba dejó vivo bloquearía la compra de la siguiente (§19.28.8).
    await h.prisma.shipmentRequest.updateMany({
      where: { sellRequestId: { in: srIds }, labelProcessingSince: { not: null }, providerShipmentId: null },
      data: { labelProcessingSince: null, providerRateId: null },
    });
  });

  // ================================================================ BSD-B40 (b) — AV-7 manual

  describe('BSD-B40 — UN predicado de sello de AV-7 (`guideNoticeSealWhere`, con el número)', () => {
    it('(b) manual: capturar A y corregir a B (las dos comitean); el post-commit de A ⇒ 0 correos; el de B ⇒ 1 correo con B', async () => {
      const { sr: s, seller } = await mkAccepted();
      // El post-commit de cada captura se RETIENE (el orden «A tarde» se fuerza, no se sortea) y se reproduce después con la
      // implementación real, con los MISMOS argumentos que le pasó `adminGuide`.
      const real = (svc as any).claimAndNotifySellRequest.bind(svc);
      const held: unknown[][] = [];
      const spy = jest.spyOn(svc as any, 'claimAndNotifySellRequest').mockImplementation(async (...args: unknown[]) => {
        held.push(args);
      });
      try {
        const a = await h.api('POST', `/admin/buylist/${s.id}/guide`, { token: db.opToken, json: { carrier: 'DHL', trackingNumber: `A-${RUN}` } });
        const b = await h.api('POST', `/admin/buylist/${s.id}/guide`, { token: db.opToken, json: { carrier: 'DHL', trackingNumber: `B-${RUN}` } });
        expect([errCode(a), errCode(b)]).toEqual(['200', '200']);
      } finally {
        spy.mockRestore();
      }
      expect(held).toHaveLength(2);
      expect((await sr(s.id)).shipmentTrackingNumber).toBe(`B-${RUN}`);
      await real(...held[0]); // el de A, tarde
      expect(mailsTo(seller.email as string)).toHaveLength(0);
      await real(...held[1]); // el de B
      const ms = mailsTo(seller.email as string);
      expect(ms).toHaveLength(1);
      expect(ms[0].text).toContain(`B-${RUN}`);
      expect(ms[0].text).not.toContain(`A-${RUN}`);
      expect((await sr(s.id)).guideNoticeSentAt).not.toBeNull();
    });

    /** Compra la guía de entrada con el AV-7 RETENIDO; devuelve el post-commit para reproducirlo cuando la prueba diga. */
    const buyHoldingNotice = async () => {
      const s = await readyInbound();
      const real = notice.notifyLabeled.bind(notice);
      const held: string[] = [];
      const spy = jest.spyOn(notice, 'notifyLabeled').mockImplementation(async (id: string) => {
        held.push(id);
      });
      try {
        const r = await buy(s.id, buyBody(s.q, s.rate));
        expect([errCode(r), r.body.outcome]).toEqual(['200', 'labeled']);
      } finally {
        spy.mockRestore();
      }
      expect(held).toEqual([s.id]);
      return { ...s, replay: () => real(s.id) };
    };

    it('(c) entrada: «Declinar» cierra la solicitud antes de `notifyLabeled` ⇒ 0 AV-7 (sale BSD-M1)', async () => {
      const s = await buyHoldingNotice();
      expect(errCode(await decline(s.sr.id))).toBe('200');
      await s.replay();
      const ms = mailsTo(s.seller.email as string);
      expect(ms.filter(isAv7)).toHaveLength(0);
      expect(ms.filter(isBsdM1)).toHaveLength(1);
      expect((await sr(s.sr.id)).guideNoticeSentAt).toBeNull();
    });

    it('(c) entrada: `closedAt` sellado con `status` aún `aceptada` (lo que solo el predicado frena) ⇒ 0 AV-7', async () => {
      // Ningún escritor de hoy deja este estado (todo cierre mueve `status`); es la defensa que el contrato pide en el
      // predicado, y por eso su canario usa la fila tal cual: `labelPdfAvailableOf` solo mira `status`, así que el ÚNICO
      // muro que queda es `closedAt: null` en `guideNoticeSealWhere`.
      const s = await buyHoldingNotice();
      await h.prisma.sellRequest.update({ where: { id: s.sr.id }, data: { closedAt: new Date() } });
      await s.replay();
      expect(mailsTo(s.seller.email as string)).toHaveLength(0);
      expect((await sr(s.sr.id)).guideNoticeSentAt).toBeNull();
    });

    it('CONTROL: sin cierre, el mismo post-commit retenido SÍ manda UN AV-7 (la prueba no pasa por un correo que nunca sale)', async () => {
      const s = await buyHoldingNotice();
      await s.replay();
      await s.replay();
      expect(mailsTo(s.seller.email as string).filter(isAv7)).toHaveLength(1);
    });
  });

  // ================================================================ BSD-B41

  describe('BSD-B41 — portal en `not_continued`: el servidor redacta los montos (como `no_offer`)', () => {
    it('lista y detalle del cliente ⇒ toda `*Cents` es `null` (recursivo); `labelPdfAvailable=false`; el DTO admin no cambia', async () => {
      const s = await readyInbound();
      expect(errCode(await buy(s.id, buyBody(s.q, s.rate)))).toBe('200');
      const token = await db.loginCustomer(s.seller.email as string);
      const adminBefore = cents((await h.api('GET', `/admin/buylist/${s.sr.id}`, { token: db.opToken })).body);
      // CONTROL: antes del cierre el portal SÍ trae cifras (la prueba no pasa por un DTO vacío).
      const detail0 = await h.api('GET', `/buylist/requests/${s.sr.id}`, { token });
      expect(Object.values(cents(detail0.body)).filter((v) => v !== null && v !== undefined).length).toBeGreaterThan(0);
      expect(errCode(await decline(s.sr.id))).toBe('200');
      expect(await sr(s.sr.id)).toMatchObject({ status: 'expirada', expiredReason: 'not_continued' });
      const detail = await h.api('GET', `/buylist/requests/${s.sr.id}`, { token });
      const list = await h.api('GET', '/buylist/requests', { token });
      expect([errCode(detail), errCode(list)]).toEqual(['200', '200']);
      const mine = list.body.data.find((x: { sellRequestId: string }) => x.sellRequestId === s.sr.id);
      expect(mine).toBeDefined();
      const notNull = (o: Record<string, unknown>) => Object.entries(o).filter(([, v]) => v !== null);
      expect(notNull(cents(detail.body))).toEqual([]);
      expect(notNull(cents(mine))).toEqual([]);
      // El MISMO `null` explícito que `no_offer` (la clave viaja, el valor no).
      expect(detail.body).toHaveProperty('quotedTotalCents', null);
      expect(mine).toHaveProperty('quotedTotalCents', null);
      expect(detail.body.items[0]).toHaveProperty('quotedPriceCents', null);
      expect([detail.body.labelPdfAvailable, mine.labelPdfAvailable]).toEqual([false, false]);
      // La proyección ADMIN no cambia: el dato no se pierde.
      const adminAfter = cents((await h.api('GET', `/admin/buylist/${s.sr.id}`, { token: db.opToken })).body);
      expect(adminAfter).toEqual(adminBefore);
    });
  });

  // ================================================================ BSD-B46

  describe('BSD-B46 — el neto se calcula al pagar y no ve la guía de entrada', () => {
    it('bruto 150 000, tarifa 18 000, guías de 15 000 y 25 000 ⇒ `payoutNetCents = 132000` en las dos', async () => {
      const a = await readyInbound();
      const b = await readyInbound();
      fake.purchaseOutcomes.push({ kind: 'labeled', totalCents: 15000 });
      expect(errCode(await buy(a.id, buyBody(a.q, a.rate)))).toBe('200');
      fake.purchaseOutcomes.push({ kind: 'labeled', totalCents: 25000 });
      expect(errCode(await buy(b.id, buyBody(b.q, b.rate)))).toBe('200');
      // Dos guías de costo DISTINTO (el doble suma el seguro al total: lo que importa es que difieran y que no se vean).
      const [ca, cb] = [(await row(a.id)).shippingCostCents, (await row(b.id)).shippingCostCents];
      expect(ca).toBeGreaterThan(0);
      expect(cb - ca).toBe(10000);
      for (const x of [a, b]) {
        await makePayable(x.sr.id);
        await svc.paySpei(x.sr.id, `SPEI-${RUN}-${x.sr.id.slice(0, 6)}`, db.adminId);
        expect(await sr(x.sr.id)).toMatchObject({ status: 'pagada', payoutNetCents: 132000 });
      }
    });
  });

  // ================================================================ Punto 14 — `applyReissue` y el P&L

  describe('Punto 14 — re-emitir deja `labelSource` nulo; la guía manual posterior cuenta por (b)', () => {
    it('Skydropx (14 000) → re-emitir → manual con costo 9 000 ⇒ (a) no la cuenta, (b) sí; margen = 18 000 − 9 000', async () => {
      const day = new Date();
      const from = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate())).toISOString();
      const to = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + 1) - 1).toISOString();
      const pnl = async () => {
        const r = await h.api('GET', `/admin/finance/pnl?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { token: db.adminToken });
        expect(r.status).toBe(200);
        return (r.body?.data ?? r.body) as Record<string, number>;
      };
      const s = await readyInbound();
      const p0 = await pnl();
      fake.purchaseOutcomes.push({ kind: 'labeled', totalCents: 14000 });
      expect(errCode(await buy(s.id, buyBody(s.q, s.rate)))).toBe('200');
      const live = await row(s.id);
      const p1 = await pnl();
      expect(p1.buylistGuideCostCents - p0.buylistGuideCostCents).toBe(live.shippingCostCents - live.shippingCostIvaCents);
      clock.advance(60_000);
      const c = await h.api('POST', `/admin/shipments/${s.id}/label/cancel`, { token: db.opToken, json: { reason: 'Re-emitir punto 14' } });
      expect([errCode(c), c.body.outcome]).toEqual(['200', 'cancelled']);
      // MEDIDO: `applyReissue` deja la fila sin guía — `labelSource`, `labelPurchasedAt` y el costo a nulo/0.
      const after = await row(s.id);
      expect({ ls: after.labelSource, at: after.labelPurchasedAt, cost: after.shippingCostCents, status: after.status }).toEqual({ ls: null, at: null, cost: 0, status: 'solicitado' });
      const p2 = await pnl();
      // La guía cancelada sale de (a); lo no devuelto (si hubo) vive en «ajustes» (§BSD.16.3).
      expect(p2.buylistGuideCostCents - p0.buylistGuideCostCents).toBe(0);
      // La guía manual posterior (permitida: ya no hay guía de Skydropx viva) y el costo al confirmar.
      const g = await h.api('POST', `/admin/buylist/${s.sr.id}/guide`, { token: db.opToken, json: { carrier: 'DHL', trackingNumber: `MAN-${RUN}` } });
      expect(errCode(g)).toBe('200');
      const conf = await h.api('POST', `/admin/buylist/${s.sr.id}/confirm-shipment`, { token: db.opToken, json: { guideActualCostCents: 9000 } });
      expect(errCode(conf)).toBe('200');
      const p3 = await pnl();
      expect(p3.buylistGuideCostCents - p0.buylistGuideCostCents).toBe(9000);
      await makePayable(s.sr.id);
      await svc.paySpei(s.sr.id, `SPEI-${RUN}-p14`, db.adminId);
      const p4 = await pnl();
      expect(p4.buylistShippingFeeRetainedCents - p0.buylistShippingFeeRetainedCents).toBe(18000);
      expect(p4.buylistGuideMarginCents - p0.buylistGuideMarginCents).toBe(18000 - 9000);
      expect(p4.buylistGuideCostMissingCount - p0.buylistGuideCostMissingCount).toBe(0);
    });
  });

  // ================================================================ BSD-B16 contra la ruta real

  describe('BSD-B16 (ruta real) — declinar ∥ `POST /admin/shipments/:id/label`', () => {
    it('N = 12 rondas, 4 modos: (i) cerrada ⇒ fila `cancelado` sin guía viva; (ii) BSD-M1 y AV-7 ⇒ guía sellada `auto_close`', async () => {
      const malas: string[] = [];
      const desenlaces: Record<string, number> = {};
      for (let i = 0; i < 12; i++) {
        const s = await readyInbound();
        bandeja = [];
        const modo = i % 4;
        let dec: R;
        let compra: R;
        if (modo === 0) {
          // El reclamo YA comiteó y la compra está «en la red»: declinar ahí, y luego vuelve la respuesta (`casZero`).
          const enRed = diferida();
          const suelta = diferida();
          fake.purchaseBarrier = async () => {
            enRed.abrir();
            await suelta.promesa;
          };
          const p = buy(s.id, buyBody(s.q, s.rate));
          await enRed.promesa;
          dec = await decline(s.sr.id);
          suelta.abrir();
          compra = await p;
          fake.purchaseBarrier = null;
        } else if (modo === 1) {
          // Declinar ANTES de comprar.
          dec = await decline(s.sr.id);
          compra = await buy(s.id, buyBody(s.q, s.rate));
        } else if (modo === 2) {
          // Declinar ENTRE `precheck` y `claim` (la ventana que mide la relectura de la guarda en `claim`).
          let first = true;
          let inside: Promise<R> | null = null;
          fake.onBalance = async () => {
            if (!first) return;
            first = false;
            inside = decline(s.sr.id);
            await inside;
          };
          compra = await buy(s.id, buyBody(s.q, s.rate));
          fake.onBalance = null;
          dec = await (inside as unknown as Promise<R>);
        } else {
          // A la vez, con desfase al azar.
          const j = () => new Promise((ok) => setTimeout(ok, Math.floor(Math.random() * 25)));
          [dec, compra] = await Promise.all([j().then(() => decline(s.sr.id)), j().then(() => buy(s.id, buyBody(s.q, s.rate)))]);
        }
        const key = `${modo}:${errCode(dec)}:${errCode(compra)}${compra.body?.outcome ? `/${compra.body.outcome}` : ''}`;
        desenlaces[key] = (desenlaces[key] ?? 0) + 1;
        if (dec.status >= 500 || compra.status >= 500) malas.push(`ronda ${i} (${modo}): 5xx ${key}`);
        if (dec.status === 200 && (await sr(s.sr.id)).status !== 'expirada') malas.push(`ronda ${i} (${modo}): 200 sin cierre`);
        malas.push(...(await roundDefects(`ronda ${i} (${modo})`, s.sr.id, s.id, s.seller.email as string)));
      }
      // eslint-disable-next-line no-console
      console.log(`BSD-B16 (ruta real) desenlaces modo:decline:compra ⇒ n: ${JSON.stringify(desenlaces)}`);
      expect(malas).toEqual([]);
    }, 240_000);
  });

  // ================================================================ BSD-B18 contra la ruta real

  describe('BSD-B18 (ruta real) — regla 8 ∥ compra, con BARRERA', () => {
    it('N = 10 rondas: el reclamo que tiene el candado de la solicitud la EXCLUYE del cierre (compra `labeled`, solicitud abierta)', async () => {
      const malas: string[] = [];
      for (let i = 0; i < 10; i++) {
        const s = await readyInbound({ acceptedAt: new Date(PAST_NOW.getTime() - 8 * DAY) });
        const tomada = diferida();
        const suelta = diferida();
        let barrera: Promise<unknown> | null = null;
        let first = true;
        // Entre `precheck` y `claim` (la lectura del saldo): la prueba toma la FILA DE ENTRADA y la retiene. El `claim` toma
        // la solicitud (I-BSD-4) y se queda esperando la fila CON la solicitud tomada: ése es el instante que B-3 forzaba.
        fake.onBalance = async () => {
          if (!first) return;
          first = false;
          barrera = h.prisma.$transaction(
            async (tx) => {
              await tx.$queryRaw`SELECT id FROM "ShipmentRequest" WHERE id = ${s.id} FOR UPDATE`;
              tomada.abrir();
              await suelta.promesa;
            },
            { timeout: 30_000 },
          );
          await tomada.promesa;
        };
        const compra = buy(s.id, buyBody(s.q, s.rate));
        await esperarBloqueoDeFila(h.prisma, 'ShipmentRequest'); // el `claim`, con la solicitud tomada
        const pasada = sweep.run(PAST_NOW);
        await esperarBloqueoDeFila(h.prisma, 'SellRequest'); // la regla 8, esperando la solicitud
        suelta.abrir();
        await barrera;
        const r = await compra;
        await pasada;
        fake.onBalance = null;
        const after = await sr(s.sr.id);
        if (after.closedAt !== null) malas.push(`ronda ${i}: cerrada aunque el reclamo ganó el candado (${errCode(r)} ${r.body?.outcome ?? ''})`);
        else if (r.body?.outcome !== 'labeled') malas.push(`ronda ${i}: compra ${errCode(r)} ${r.body?.outcome ?? ''}`);
        malas.push(...(await roundDefects(`ronda ${i}`, s.sr.id, s.id, s.seller.email as string)));
      }
      expect(malas).toEqual([]);
    }, 240_000);
  });

  // ================================================================ BSD-B31 contra la ruta real

  describe('BSD-B31 (ruta real) — declinar ∥ compra ∥ barrido', () => {
    it('N = 30 rondas: ningún `40P01` (deadlock) en ninguna de las tres ramas, y nunca cerrada con guía viva', async () => {
      const logger = (sweep as unknown as { logger: { error: (m: string) => void } }).logger;
      const errores: string[] = [];
      const spy = jest.spyOn(logger, 'error').mockImplementation((m: string) => {
        errores.push(String(m));
      });
      const malas: string[] = [];
      try {
        for (let i = 0; i < 30; i++) {
          const s = await readyInbound({ acceptedAt: new Date(PAST_NOW.getTime() - 8 * DAY) });
          bandeja = [];
          const j = () => new Promise((ok) => setTimeout(ok, Math.floor(Math.random() * 25)));
          const [d, b, w] = await Promise.allSettled([
            j().then(() => decline(s.sr.id)),
            j().then(() => buy(s.id, buyBody(s.q, s.rate))),
            j().then(() => sweep.run(PAST_NOW)),
          ]);
          const textos = [
            d.status === 'fulfilled' ? JSON.stringify(d.value.body ?? '') : String(d.reason),
            b.status === 'fulfilled' ? JSON.stringify(b.value.body ?? '') : String(b.reason),
            w.status === 'fulfilled' ? '' : String(w.reason),
          ];
          for (const t of textos) if (/deadlock|40P01/i.test(t)) malas.push(`ronda ${i}: ${t.slice(0, 160)}`);
          for (const x of [d, b]) if (x.status === 'fulfilled' && x.value.status >= 500) malas.push(`ronda ${i}: 5xx ${JSON.stringify(x.value.body).slice(0, 160)}`);
          malas.push(...(await roundDefects(`ronda ${i}`, s.sr.id, s.id, s.seller.email as string)));
        }
        for (const e of errores) if (/deadlock|40P01/i.test(e)) malas.push(`barrido: ${e.slice(0, 160)}`);
      } finally {
        spy.mockRestore();
      }
      expect(malas).toEqual([]);
    }, 300_000);
  });
});

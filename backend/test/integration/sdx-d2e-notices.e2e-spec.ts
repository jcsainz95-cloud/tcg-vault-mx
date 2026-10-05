/**
 * sdx-d2e-notices.e2e-spec.ts — ⭐ D2e: los correos al cliente del transportista y lo que el cliente ve, contra Postgres REAL,
 * app Nest completa por HTTP, proveedor DOBLE (⛔ nunca la red: PS-99), llave de compra SUSTITUIDA (⛔ nadie pone
 * `SKYDROPX_ALLOW_SPEND`) y el puerto `CARRIER_NOTICES` **REAL** (a diferencia de D2d, que lo sustituía por un registro): aquí
 * se cuenta la BANDEJA. Propiedad: backend.
 *
 * Cubre (API_CONTRACT §M4-SHIP.19.12, §19.19.15 fila D2e, §19.33.1/.2/.4; DESIGN_SYSTEM §43.11–§43.12c):
 *  - `C-AV-3b` (guía Skydropx: guía, salida, en sucursal, intentos, Entregado; repetido ⇒ 0; exception/in_return ⇒ 0) y
 *    `C-AV-3a` (guía manual: 2 correos y 0 al entregar a mano).
 *  - PS-75 reescrita (§19.33.1): (b) la CARRERA con el lote real y barrera — AV-17 una vez, `deliveredAt` el del `PATCH`, N=10;
 *    (c) `entregado` a mano ⇒ sondeo y `refresh-tracking` con CERO llamadas al doble y CERO AV-17.
 *  - PS-78 (corregida y ampliada §19.33.2): `delivered` de hace 8 d ⇒ `deliveredAt ≈ now`, AV-17 sin plazo y con «Escríbenos»;
 *    estado desconocido ⇒ `exception` con `detail`, alerta, `?alert=true`, cero correos, llave propia.
 *  - PS-72 ampliada (§19.33.4): `in_transit` fechado 5 s ANTES de la compra avanza desde `created`.
 *  - PS-87 (lo construible: registrado ⇒ `/orders/<id>`, retiro ⇒ `/shipments/<id>`; el invitado: BACKEND_NOTES §67 P-D2E-1).
 *  - PS-88 (`trackingUrl` solo si vino, exacta en AV-4/5/17/18 y en las tres superficies; URL hostil ⇒ NULL + bitácora).
 *  - PS-89 (línea de tiempo pública en `guest/track`, `/orders/:id`, `/shipments/:id`).
 */
import { E2EHarness } from './helpers/e2e-app';
import { R, ShipPrepDb } from './helpers/ship-prep-db';
import { buyBody, dial, errCode, purchaseOn, ready, restoreDials } from './helpers/label-db';
import { FakeShippingProvider } from '../../src/modules/shipping-provider/fake-shipping-provider';
import { SHIPPING_PROVIDER_SELECTION } from '../../src/modules/shipping-provider/shipping-provider.module';
import { ShippingProviderSelection } from '../../src/modules/shipping-provider/shipping-provider.factory';
import { ProviderShipmentState } from '../../src/modules/shipping-provider/shipping-provider.port';
import { ManualLabelClock, SHIPMENTS_LABEL_CLOCK } from '../../src/modules/shipments/label-clock';
import { LABEL_SPEND_KEY } from '../../src/modules/shipments/label-purchase.service';
import { DEFAULT_LABEL_VERIFY_CONFIG, LABEL_VERIFY_CONFIG } from '../../src/modules/shipments/label-verify.constants';
import { OrderAccessTokenService } from '../../src/modules/orders/order-access-token.service';
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

const RUN = `d2e${Date.now().toString(36)}`;
const H = 3_600_000;
const D = 24 * H;
const N = 10;
const ORIGIN = 'https://app.d2e.test';
const TRACK_OK = 'https://pro.skydropx.com/tracking/D2E-OK';

describe('⭐ D2e — correos del transportista al cliente y lo que el cliente ve (§19.12)', () => {
  let h: E2EHarness;
  let db: ShipPrepDb;
  let fake: FakeShippingProvider;
  let clock: ManualLabelClock;
  let bandeja: MailMessage[];
  const spend = { on: true };
  const savedOrigin = process.env.APP_PUBLIC_URL;

  const quote = (id: string): Promise<R> => h.api('POST', `/admin/shipments/${id}/quote`, { token: db.opToken, json: {} });
  const buy = (id: string, json: unknown): Promise<R> => {
    clock.advance(1);
    return h.api('POST', `/admin/shipments/${id}/label`, { token: db.opToken, json });
  };
  const refresh = (id: string): Promise<R> => {
    clock.advance(1000);
    return h.api('POST', `/admin/shipments/${id}/refresh-tracking`, { token: db.opToken, json: {} });
  };
  const job = (name: string, json: unknown = {}): Promise<R> => h.api('POST', `/admin/jobs/${name}`, { token: db.adminToken, json });
  const row = (id: string) => h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id } });
  const events = (id: string) => h.prisma.shipmentCarrierEvent.findMany({ where: { shipmentRequestId: id }, orderBy: [{ occurredAt: 'asc' }, { observedAt: 'asc' }] });
  const audits = (id: string, action: string) => h.prisma.auditLog.findMany({ where: { entityId: id, action }, orderBy: { createdAt: 'asc' } });
  const pickRate = (q: any) => q.rates.find((r: any) => r.deliveryKind !== 'branch' && r.marginCents >= 0 && !r.hidden) ?? q.rates[0];
  const iso = (ms: number) => new Date(ms).toISOString();
  const patchStatus = (id: string, to: string) => h.api('PATCH', `/admin/shipments/${id}/status`, { token: db.opToken, json: { to } });

  const AV = {
    4: /guía de envío|tracking number/i,
    5: /va en camino|on its way/i,
    17: /^(Tu paquete fue entregado|Your package was delivered)$/,
    18: /^(Tu paquete está en sucursal|Your package is at the branch)$/,
    19: /^(La paquetería intentó entregar tu paquete|The carrier tried to deliver your package)$/,
  } as const;
  const mails = (to: string, re?: RegExp) => bandeja.filter((m) => m.to === to && (!re || re.test(m.subject)));
  const body = (m: MailMessage) => [m.subject, m.html, m.text ?? ''].join('\n');

  /** Una guía de Skydropx comprada por el doble para el envío dado (`ageMs` antes de «ahora»; el reloj vuelve). */
  const buyFor = async (shipmentId: string, ageMs = 2 * H) => {
    const back = clock.now().getTime();
    clock.set(new Date(back - ageMs));
    await ready(db, shipmentId);
    const q = await quote(shipmentId);
    expect(q.status).toBe(200);
    const r = await buy(shipmentId, buyBody(q.body, pickRate(q.body)));
    expect(errCode(r)).toBe('200');
    expect(r.body.outcome).toBe('labeled');
    const s = await row(shipmentId);
    clock.set(new Date(back));
    return s;
  };
  /** Pedido directo de INVITADO con guía de Skydropx. */
  const labeled = async (ageMs = 2 * H) => {
    const d = await db.mkDirect({ prices: [50000, 30000] });
    const s = await buyFor(d.shipment.id, ageMs);
    return { id: d.shipment.id, psid: s.providerShipmentId as string, to: d.order.guestEmail as string, d, row: s };
  };
  /** Todas las demás guías vivas recién sondeadas: el lote del job toma SOLO las de la prueba. */
  const isolateBatch = async (keep: string[]) => {
    await h.prisma.shipmentRequest.updateMany({ where: { labelSource: 'skydropx', id: { notIn: keep } }, data: { carrierPolledAt: clock.now() } });
  };

  beforeAll(async () => {
    process.env.APP_PUBLIC_URL = ORIGIN;
    fake = new FakeShippingProvider();
    fake.reuseQuotations = false;
    fake.defaultLabelUrl = 'https://pro.skydropx.com/labels/x.pdf';
    clock = new ManualLabelClock(new Date());
    fake.now = () => clock.now();
    const sel: ShippingProviderSelection = { port: fake, kind: 'fake', urlHosts: ['pro.skydropx.com'], client: null };
    // ⛔ CARRIER_NOTICES NO se sustituye: el puerto real (D2e) es lo que se mide.
    h = await E2EHarness.create((b) =>
      b
        .overrideProvider(SHIPPING_PROVIDER_SELECTION)
        .useValue(sel)
        .overrideProvider(SHIPMENTS_LABEL_CLOCK)
        .useValue(clock)
        .overrideProvider(LABEL_SPEND_KEY)
        .useValue({ turned: () => spend.on })
        .overrideProvider(LABEL_VERIFY_CONFIG)
        .useValue({ ...DEFAULT_LABEL_VERIFY_CONFIG, adoptionEnabled: false }),
    );
    db = new ShipPrepDb(h, RUN);
    await db.init();
    await purchaseOn(h, 'operators');
    await dial(h, 'operator_label_cap_24h_cents', 1_000_000_000);
    const port = h.app.get<MailPort>(MAIL_PORT);
    jest.spyOn(port, 'send').mockImplementation(async (msg: MailMessage) => {
      bandeja.push(msg);
      return {};
    });
  });

  afterAll(async () => {
    if (savedOrigin === undefined) delete process.env.APP_PUBLIC_URL;
    else process.env.APP_PUBLIC_URL = savedOrigin;
    if (h) {
      await h.prisma.spendAlert.deleteMany({ where: { OR: [{ shipmentRequestId: { in: db.shipments } }, { subjectUserId: { in: [db.operatorId, db.adminId] } }, { dedupKey: { startsWith: 'ag7:' } }] } });
      await restoreDials(h);
      await db.cleanup();
      await h.close();
    }
  });

  beforeEach(async () => {
    fake.calls.length = 0;
    fake.purchaseOutcomes.length = 0;
    fake.balanceCents = 10_000_000;
    fake.defaultTrackingUrl = null;
    fake.forgetQuotations();
    clock.set(new Date());
    bandeja = [];
    await dial(h, 'shipping_provider', 'skydropx');
  });

  afterEach(async () => {
    await h.prisma.$executeRaw`UPDATE "ShipmentLabelAttempt" SET since = since - interval '25 hours' WHERE since > ${new Date(Date.now() - 25 * H)}`;
  });

  // ================================================================ C-AV-3b / C-AV-3a

  describe('C-AV-3b — guía SKYDROPX: guía, salida, en sucursal, intentos y Entregado; nada de más', () => {
    it('el recorrido completo cuenta la bandeja EXACTA: AV-4 1 · AV-5 1 · AV-18 1 · AV-19 2 · AV-17 1, y nada más', async () => {
      const s = await labeled(10 * D);
      const t = clock.now().getTime();
      expect(mails(s.to, AV[4])).toHaveLength(1);
      fake.pushEvent(s.psid, 'picked_up', iso(t - 9 * D));
      await refresh(s.id);
      fake.pushEvent(s.psid, 'delivered_to_branch', iso(t - 8 * D), { branchName: 'Sucursal Centro' });
      await refresh(s.id);
      await refresh(s.id); // el MISMO evento otra vez ⇒ 0
      expect((await row(s.id)).status).toBe('enviado'); // ⛔ en sucursal NO es entregado
      fake.pushEvent(s.psid, 'delivery_attempt', iso(t - 7 * D));
      await refresh(s.id);
      fake.pushEvent(s.psid, 'delivery_attempt', iso(t - 7 * D)); // repetido en el historial ⇒ 0
      await refresh(s.id);
      fake.pushEvent(s.psid, 'delivery_attempt', iso(t - 6 * D)); // otro intento ⇒ 1 más
      await refresh(s.id);
      fake.pushEvent(s.psid, 'exception', iso(t - 5 * D), { detail: 'Dirección incompleta' });
      await refresh(s.id);
      fake.pushEvent(s.psid, 'delivered', iso(t - 4 * D));
      await refresh(s.id);
      await refresh(s.id);
      expect(mails(s.to, AV[5])).toHaveLength(1);
      expect(mails(s.to, AV[18])).toHaveLength(1);
      expect(mails(s.to, AV[19])).toHaveLength(2);
      expect(mails(s.to, AV[17])).toHaveLength(1);
      expect(mails(s.to)).toHaveLength(6);
      expect(mails(s.to, AV[18])[0].text).toContain('Sucursal Centro');
      const [a1, a2] = mails(s.to, AV[19]);
      expect(a1.subject).toBe(a2.subject);
      expect(a1.text).not.toBe(a2.text);
      const r = await row(s.id);
      expect(r.status).toBe('entregado');
      expect(r.deliveredNoticeSentAt).not.toBeNull();
      expect(r.branchNoticeSentAt).not.toBeNull();
      expect(r.lastDeliveryAttemptAt!.toISOString()).toBe(iso(t - 6 * D));
    });

    it('`in_return` / `destroyed` / `retained` / `canceled` ⇒ CERO correos al cliente (mudos, criterio 242)', async () => {
      const s = await labeled();
      bandeja = [];
      for (const st of ['retained', 'in_return', 'destroyed', 'canceled'] as const) {
        fake.pushEvent(s.psid, st, iso(clock.now().getTime() - H));
        await refresh(s.id);
      }
      expect(mails(s.to)).toHaveLength(0);
    });

    it('sin destinatario (cuenta anonimizada, §R.5.a) ⇒ cero correos y el sello NO se quema (el aviso sigue pendiente)', async () => {
      const cust = await db.mkUser('Cliente Anonimizado D2e');
      const d = await db.mkDirect({ userId: cust.id, prices: [50000, 30000] });
      const s = await buyFor(d.shipment.id);
      await h.prisma.user.update({ where: { id: cust.id }, data: { anonymizedAt: new Date() } });
      bandeja = [];
      fake.pushEvent(s.providerShipmentId as string, 'delivered_to_branch', iso(clock.now().getTime() - H), { branchName: 'X' });
      await refresh(s.id);
      expect((await row(s.id)).branchNoticeSentAt).toBeNull();
      expect(bandeja).toHaveLength(0);
    });
  });

  describe('C-AV-3a — guía MANUAL: exactamente guía + salida, y CERO al entregar a mano (intacto)', () => {
    it('tracking ⇒ 1 · enviado ⇒ 1 · entregado ⇒ 0', async () => {
      const d = await db.mkDirect();
      await ready(db, d.shipment.id);
      expect((await db.tracking(d.shipment.id)).status).toBe(201);
      expect(errCode(await patchStatus(d.shipment.id, 'enviado'))).toBe('200');
      expect(errCode(await patchStatus(d.shipment.id, 'entregado'))).toBe('200');
      const to = d.order.guestEmail as string;
      expect(mails(to, AV[4])).toHaveLength(1);
      expect(mails(to, AV[5])).toHaveLength(1);
      expect(mails(to, AV[17])).toHaveLength(0);
      expect(mails(to)).toHaveLength(2);
    });
  });

  // ================================================================ PS-75 reescrita (§19.33.1)

  describe('PS-75 (§19.33.1) — AV-17 cuelga del EVENTO; el sondeo no se amplía', () => {
    it(`(b) CARRERA: lote tomado con el envío \`enviado\`, \`PATCH entregado\` confirmado ANTES de aplicar (barrera), luego \`delivered\` ⇒ AV-17 UNA vez y \`deliveredAt\` el del PATCH — N=${N} rondas`, async () => {
      let ok = 0;
      const detail: string[] = [];
      for (let round = 0; round < N; round += 1) {
        const s = await labeled();
        fake.pushEvent(s.psid, 'picked_up', iso(clock.now().getTime() - H));
        await refresh(s.id);
        expect((await row(s.id)).status).toBe('enviado');
        fake.pushEvent(s.psid, 'delivered', iso(clock.now().getTime() - 60_000));
        bandeja = [];
        await isolateBatch([s.id]);
        await h.prisma.shipmentRequest.update({ where: { id: s.id }, data: { carrierPolledAt: null } });
        // 🔒 La barrera: el lote YA se leyó (el envío venía `enviado`); antes de que `applyCarrierStatus` tome el candado, el
        // operador marca `entregado` a mano y la respuesta llega. Solo entonces el doble devuelve la lectura.
        const orig = fake.getShipment.bind(fake);
        let patched: R | null = null;
        let manualDeliveredAt: Date | null = null;
        fake.getShipment = async (psid: string): Promise<ProviderShipmentState> => {
          if (psid === s.psid && !patched) {
            patched = await patchStatus(s.id, 'entregado');
            manualDeliveredAt = (await row(s.id)).deliveredAt;
          }
          return orig(psid);
        };
        try {
          clock.advance(60_000);
          const r = await job('shipment-tracking-poll');
          expect(errCode(r)).toBe('200');
        } finally {
          fake.getShipment = orig;
        }
        // Y una segunda corrida del lote: el envío ya cerrado NO se vuelve a consultar.
        fake.calls.length = 0;
        clock.advance(60 * 60_000);
        await job('shipment-tracking-poll');
        const st = await row(s.id);
        const res = {
          patch: patched ? errCode(patched) : 'none',
          av17: mails(s.to, AV[17]).length,
          status: st.status,
          sameDeliveredAt: !!manualDeliveredAt && st.deliveredAt?.getTime() === (manualDeliveredAt as Date).getTime(),
          carrierStatus: st.carrierStatus,
          reads: fake.callsOf('getShipment').filter((c) => c.input === s.psid).length,
        };
        const good = res.patch === '200' && res.av17 === 1 && res.status === 'entregado' && res.sameDeliveredAt && res.carrierStatus === 'delivered' && res.reads === 0;
        if (good) ok += 1;
        else detail.push(JSON.stringify(res));
      }
      // eslint-disable-next-line no-console
      console.log(`PS-75 (b) carrera: ${ok}/${N} rondas con AV-17 una vez y deliveredAt del PATCH ${detail.join(' ')}`);
      expect(ok).toBe(N);
    });

    it('(c) `entregado` a mano y luego el sondeo y `refresh-tracking` ⇒ CERO llamadas al doble y CERO AV-17', async () => {
      const s = await labeled();
      expect(errCode(await patchStatus(s.id, 'enviado'))).toBe('200');
      expect(errCode(await patchStatus(s.id, 'entregado'))).toBe('200');
      fake.pushEvent(s.psid, 'delivered', iso(clock.now().getTime() - 60_000));
      await isolateBatch([s.id]);
      await h.prisma.shipmentRequest.update({ where: { id: s.id }, data: { carrierPolledAt: null } });
      fake.calls.length = 0;
      bandeja = [];
      expect(errCode(await job('shipment-tracking-poll'))).toBe('200');
      expect(errCode(await refresh(s.id))).toBe('200');
      expect(fake.callsOf('getShipment')).toHaveLength(0);
      expect(mails(s.to, AV[17])).toHaveLength(0);
      expect(await events(s.id)).toHaveLength(0);
    });
  });

  // ================================================================ PS-78 corregida y ampliada

  describe('PS-78 — AV-17 sin plazo; estado desconocido como `exception` (§19.33.2)', () => {
    it('`delivered` de hace 8 d ⇒ deliveredAt ≈ now, carrierStatusAt = la fecha del transportista, AV-17 SIN plazo y CON «Escríbenos»', async () => {
      const s = await labeled(10 * D);
      const t = clock.now().getTime();
      fake.pushEvent(s.psid, 'delivered', iso(t - 8 * D));
      await refresh(s.id);
      const r = await row(s.id);
      expect(r.status).toBe('entregado');
      expect(r.carrierStatusAt!.toISOString()).toBe(iso(t - 8 * D));
      expect(Math.abs(r.deliveredAt!.getTime() - clock.now().getTime())).toBeLessThan(5_000);
      const [m] = mails(s.to, AV[17]);
      expect(m).toBeDefined();
      expect(body(m)).not.toMatch(/disput|aclaraci|\d+ d[ií]as|\d+ days|plazo|deadline|claim/i);
      expect(body(m)).not.toMatch(/\$\d/);
      expect(m.text).toContain('¿Problema con tu pedido? Escríbenos a');
      expect(m.text).toContain(s.d.order.orderNumber as string);
      // La fecha de la prosa es la del TRANSPORTISTA (hace 8 d), no la nuestra.
      const fecha = new Intl.DateTimeFormat('es-MX', { dateStyle: 'full', timeStyle: 'short', timeZone: 'America/Mexico_City' }).format(new Date(t - 8 * D));
      expect(m.text).toContain(`La paquetería confirmó la entrega el ${fecha}.`);
    });

    it('el doble devuelve "estado_raro" ⇒ UNA fila `exception` con su detail, carrierAlert, ?alert=true, CERO correos, bitácora una vez; repetir ⇒ cero filas; `in_transit` ⇒ alerta apagada', async () => {
      const s = await labeled();
      const t = clock.now().getTime() - H;
      fake.setShipment(s.psid, { carrierStatus: null, unknownCarrierStatus: 'estado_raro', events: [{ status: null, rawStatus: 'estado_raro', occurredAt: iso(t) }] });
      bandeja = [];
      const r1 = await refresh(s.id);
      expect(errCode(r1)).toBe('200');
      expect(r1.body.carrierAlert).toEqual({ status: 'exception', detail: 'Estado no reconocido: estado_raro', at: iso(t) });
      expect((await events(s.id)).map((e) => [e.status, e.detail, e.providerEventKey])).toEqual([
        ['exception', 'Estado no reconocido: estado_raro', `unknown:estado_raro:${iso(t)}`],
      ]);
      const list = await h.api('GET', `/admin/shipments?alert=true&pageSize=100&q=${s.id}`, { token: db.opToken });
      expect(list.body.data.map((x: any) => x.id)).toContain(s.id);
      await refresh(s.id);
      expect(await events(s.id)).toHaveLength(1);
      expect(await audits(s.id, 'shipment.carrier_status_unknown')).toHaveLength(1);
      expect(mails(s.to)).toHaveLength(0);
      expect((await row(s.id)).status).toBe('guia');
      // Un `exception` REAL del MISMO instante es OTRO evento (⛔ la llave del desconocido nunca es `exception:<instante>`).
      fake.setShipment(s.psid, {
        carrierStatus: 'exception',
        unknownCarrierStatus: null,
        events: [
          { status: null, rawStatus: 'estado_raro', occurredAt: iso(t) },
          { status: 'exception', rawStatus: 'exception', occurredAt: iso(t), detail: 'Real' },
        ],
      });
      await refresh(s.id);
      expect((await events(s.id)).map((e) => e.detail).sort()).toEqual(['Estado no reconocido: estado_raro', 'Real']);
      fake.pushEvent(s.psid, 'in_transit', iso(clock.now().getTime()));
      const r3 = await refresh(s.id);
      expect(r3.body.carrierAlert).toBeNull();
    });
  });

  // ================================================================ PS-72 ampliada (§19.33.4)

  describe('PS-72 (§19.33.4) — `created` es el mínimo del orden', () => {
    it('compra a las T, `in_transit` fechado T − 5 s ⇒ carrierStatus `in_transit`, carrierStatusAt = T − 5 s, `enviado` y UN AV-5', async () => {
      const s = await labeled();
      expect(s.row.carrierStatus).toBe('created');
      const T = s.row.carrierStatusAt!.getTime();
      bandeja = [];
      fake.pushEvent(s.psid, 'in_transit', iso(T - 5_000));
      await refresh(s.id);
      await refresh(s.id);
      const r = await row(s.id);
      expect(r.carrierStatus).toBe('in_transit');
      expect(r.carrierStatusAt!.toISOString()).toBe(iso(T - 5_000));
      expect(r.status).toBe('enviado');
      expect(mails(s.to, AV[5])).toHaveLength(1);
    });
  });

  // ================================================================ PS-87 / PS-88 / PS-89

  describe('PS-87/PS-88/PS-89 — la liga del cliente, la URL de rastreo y la línea de tiempo en las TRES superficies', () => {
    const SEQ = ['created', 'picked_up', 'last_mile', 'delivery_attempt', 'delivered_to_branch', 'delivered'] as const;

    it('registrado ⇒ CTA a `/orders/<id>`; retiro ⇒ `/shipments/<id>`; con `trackingUrl` ⇒ AV-4/5/17/18 llevan ESA URL; las tres superficies traen `trackingUrl` y `timeline`', async () => {
      fake.defaultTrackingUrl = TRACK_OK;
      const tokens = h.app.get(OrderAccessTokenService);
      // (1) pedido de INVITADO
      const g = await labeled(10 * D);
      // (2) pedido de cliente REGISTRADO
      const cust = await db.mkUser('Cliente D2e');
      const custEmail = cust.email as string;
      const custToken = await h.login(custEmail, E2E_USERS.customer.password);
      const reg = await db.mkDirect({ userId: cust.id, prices: [50000, 30000] });
      await buyFor(reg.shipment.id, 10 * D);
      // (3) retiro de bóveda del mismo cliente
      const v = await db.mkVaultOrder(cust.id, { placement: 'placed' });
      const w = await db.mkWithdrawal(cust.id, v.pieces.map((p) => p.id), 'picking');
      await buyFor(w.shipment.id, 10 * D);
      const t = clock.now().getTime();
      const ids = [g.id, reg.shipment.id, w.shipment.id];
      // Los cinco primeros pasos hasta `delivered_to_branch` (publicStatus sigue `enviado` durante at_branch), luego `delivered`.
      for (const id of ids) {
        const psid = (await row(id)).providerShipmentId as string;
        SEQ.slice(0, 5).forEach((st, i) =>
          fake.pushEvent(psid, st, iso(t - (9 - i) * D), st === 'delivered_to_branch' ? { branchName: 'Sucursal Norte' } : st === 'delivery_attempt' ? { detail: 'Cliente ausente' } : {}),
        );
        await refresh(id);
      }
      const clear = (await tokens.issue(g.d.order.id, { rotate: false })).clear;
      const gt1 = await h.api('POST', '/orders/guest/track', { json: { token: clear } });
      expect(gt1.status).toBe(200);
      const shippedStatus = gt1.body.status;
      for (const id of ids) {
        const psid = (await row(id)).providerShipmentId as string;
        fake.pushEvent(psid, 'delivered', iso(t - 3 * D));
        await refresh(id);
      }
      // ---- PS-87: el enlace del correo por destinatario (registrado / retiro)
      const regMails = mails(custEmail);
      const toOrder = regMails.filter((m) => m.text?.includes(`${ORIGIN}/es/orders/${reg.order.id}`));
      const toShip = regMails.filter((m) => m.text?.includes(`${ORIGIN}/es/shipments/${w.shipment.id}`));
      expect(toOrder.filter((m) => AV[17].test(m.subject) || AV[18].test(m.subject) || AV[19].test(m.subject))).toHaveLength(3);
      expect(toShip.filter((m) => AV[17].test(m.subject) || AV[18].test(m.subject) || AV[19].test(m.subject))).toHaveLength(3);
      expect(regMails.some((m) => /cuenta\/pedidos|boveda\/envios/.test(body(m)))).toBe(false);
      // ---- PS-88: AV-4/5/17/18 llevan ESA URL exacta (los tres destinatarios)
      for (const to of [g.to, custEmail]) {
        for (const n of [4, 5, 17, 18] as const) {
          const ms = mails(to, AV[n]);
          expect(ms.length).toBeGreaterThan(0);
          for (const m of ms) expect(m.text).toContain(TRACK_OK);
        }
      }
      // ---- PS-88/PS-89: las tres superficies
      const gt = await h.api('POST', '/orders/guest/track', { json: { token: clear } });
      const od = await h.api('GET', `/orders/${reg.order.id}`, { token: custToken });
      const sd = await h.api('GET', `/shipments/${w.shipment.id}`, { token: custToken });
      expect([gt.status, od.status, sd.status]).toEqual([200, 200, 200]);
      const surfaces = { guest: gt.body.shipping, order: od.body.shipment, shipment: sd.body };
      const providerKinds = ['label_created', 'in_transit', 'out_for_delivery', 'delivery_attempt', 'at_branch', 'delivered'];
      const shippedAt = { guest: (await row(g.id)).shippedAt, order: (await row(reg.shipment.id)).shippedAt, shipment: (await row(w.shipment.id)).shippedAt };
      for (const [name, x] of Object.entries(surfaces)) {
        expect({ name, trackingUrl: x.trackingUrl }).toEqual({ name, trackingUrl: TRACK_OK });
        // Los seis del transportista con su kind fijo y en orden; `shipped` = `shippedAt` (§19.12) en su lugar por `at`.
        expect({ name, kinds: x.timeline.map((e: any) => e.kind).filter((k: string) => k !== 'shipped') }).toEqual({ name, kinds: providerKinds });
        expect({ name, shipped: x.timeline.filter((e: any) => e.kind === 'shipped') }).toEqual({ name, shipped: [{ kind: 'shipped', at: shippedAt[name as keyof typeof shippedAt]!.toISOString() }] });
        const ats = x.timeline.map((e: any) => Date.parse(e.at));
        expect(ats).toEqual([...ats].sort((a, b) => a - b));
        for (const e of x.timeline) expect(Object.keys(e).sort()).toEqual(e.kind === 'at_branch' ? ['at', 'branchName', 'kind'] : ['at', 'kind']);
        expect(x.timeline.find((e: any) => e.kind === 'at_branch').branchName).toBe('Sucursal Norte');
        const json = JSON.stringify(x);
        for (const forbidden of ['Cliente ausente', 'providerShipmentId', 'carrierStatus', 'labelUrl', 'rawResponseJson', 'detail']) {
          expect({ name, forbidden, present: json.includes(forbidden) }).toEqual({ name, forbidden, present: false });
        }
      }
      // ⛔ Título por `publicStatus` (§4-G.5 sin cambio): durante at_branch era el de «enviado».
      expect(gt1.body.shipping.timeline.map((e: any) => e.kind)).toContain('at_branch');
      expect(gt1.body.status).toBe(shippedStatus);
      // Token de OTRO pedido ⇒ SUS eventos, no éstos.
      const other = await labeled();
      const otherClear = (await tokens.issue(other.d.order.id, { rotate: false })).clear;
      const go = await h.api('POST', '/orders/guest/track', { json: { token: otherClear } });
      expect(go.body.shipping.timeline).toEqual([]);
    });

    it('`trackingUrl` null ⇒ ningún correo ni DTO la trae; hostil (`http://evil…`, `javascript:`) ⇒ trackingUrl NULL, ningún `href`, bitácora `provider_url_rejected`', async () => {
      for (const bad of [null, 'http://evil.example/t', 'javascript:alert(1)']) {
        fake.defaultTrackingUrl = bad;
        bandeja = [];
        const s = await labeled();
        expect(s.row.trackingUrl).toBeNull();
        fake.pushEvent(s.psid, 'picked_up', iso(clock.now().getTime() - H));
        await refresh(s.id);
        fake.pushEvent(s.psid, 'delivered_to_branch', iso(clock.now().getTime() - 30 * 60_000), { branchName: 'X' });
        await refresh(s.id);
        fake.pushEvent(s.psid, 'delivered', iso(clock.now().getTime() - 60_000));
        await refresh(s.id);
        expect(mails(s.to).length).toBeGreaterThanOrEqual(4);
        for (const m of mails(s.to)) {
          expect(body(m)).not.toMatch(/evil\.example|javascript:|Rastre(o|ar mi paquete) en la paquetería|Track(ing)? (my package )?with the carrier/);
        }
        const clear = (await h.app.get(OrderAccessTokenService).issue(s.d.order.id, { rotate: false })).clear;
        const gt = await h.api('POST', '/orders/guest/track', { json: { token: clear } });
        expect('trackingUrl' in gt.body.shipping).toBe(false);
        if (bad) {
          const rej = await audits(s.id, 'shipment.provider_url_rejected');
          expect(rej.length).toBeGreaterThanOrEqual(1);
          expect(JSON.stringify(rej.map((a) => a.after))).not.toContain(bad);
        }
      }
    });
  });
});

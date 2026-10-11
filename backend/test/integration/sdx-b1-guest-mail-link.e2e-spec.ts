/**
 * sdx-b1-guest-mail-link.e2e-spec.ts — 🔒 B-1 (errata v1.80.12.16, `API_CONTRACT §M4-SHIP.19.35.1`, PS-87 reescrita,
 * SDX-R14 de §19.35.6, `ARCHITECTURE §4.60 (ab)`): la liga del INVITADO en los avisos al cliente. Contra Postgres REAL, app
 * Nest completa por HTTP, proveedor DOBLE (⛔ nunca la red ni una compra real: PS-99), llave de compra SUSTITUIDA y el puerto
 * `CARRIER_NOTICES` REAL; se cuenta la BANDEJA y las filas de `OrderAccessToken`. Propiedad: backend.
 *
 * La regla (§19.35.1): pedido con `order.userId = null` ∧ `guestEmail` ⇒ un token NUEVO de 90 días por correo, **SIN rotar**,
 * emitido SOLO tras ganar el sello y tener destinatario; bitácora `order.tracking_link.reissue` actor `system:mail`
 * `{notice, rotated:false}` sin claro ni hash; la emisión ⛔ no consulta el cupo del reenvío; reclamado/registrado ⇒
 * `/orders/<id>`; retiro ⇒ `/shipments/<id>`; pedido de más de 365 días ⇒ sin CTA. El reenvío sigue revocando todos.
 *
 * PS-87 (a)…(h) y sus cuatro mutaciones (cada una pone roja la letra que nombra):
 *   `rotate: true` ⇒ (a) · emitir con `userId ≠ null` ⇒ (b) · emitir en `resolveRecipient` ⇒ (d) · consultar el cupo ⇒ (g).
 * Además: `AV-12` (su propio camino, el MISMO cuerpo), `AV-4` manual y `AV-6`.
 */
import { Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import { R, ShipPrepDb } from './helpers/ship-prep-db';
import { buyBody, dial, errCode, purchaseOn, ready, restoreDials } from './helpers/label-db';
import { FakeShippingProvider } from '../../src/modules/shipping-provider/fake-shipping-provider';
import { SHIPPING_PROVIDER_SELECTION } from '../../src/modules/shipping-provider/shipping-provider.module';
import { ShippingProviderSelection } from '../../src/modules/shipping-provider/shipping-provider.factory';
import { ManualLabelClock, SHIPMENTS_LABEL_CLOCK } from '../../src/modules/shipments/label-clock';
import { LABEL_SPEND_KEY } from '../../src/modules/shipments/label-purchase.service';
import { DEFAULT_LABEL_VERIFY_CONFIG, LABEL_VERIFY_CONFIG } from '../../src/modules/shipments/label-verify.constants';
import { ShipmentsService } from '../../src/modules/shipments/shipments.service';
import { OrderAccessTokenService } from '../../src/modules/orders/order-access-token.service';
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';
import { SettingKey } from '../../src/modules/settings/settings.constants';

const RUN = `b1${Date.now().toString(36)}`;
const H = 3_600_000;
const D = 24 * H;
const ORIGIN = 'https://app.b1.test';
const TOKEN_RE = /\/(?:es|en)\/pedido\?token=([A-Za-z0-9_%-]+)/g;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('🔒 B-1 — la liga del invitado en los avisos: token nuevo SIN rotar (§19.35.1, PS-87 reescrita)', () => {
  let h: E2EHarness;
  let db: ShipPrepDb;
  let fake: FakeShippingProvider;
  let clock: ManualLabelClock;
  let tokens: OrderAccessTokenService;
  let bandeja: MailMessage[];
  let logged: string[];
  const spend = { on: true };
  const savedOrigin = process.env.APP_PUBLIC_URL;
  const logSpies: jest.SpyInstance[] = [];

  const quote = (id: string): Promise<R> => h.api('POST', `/admin/shipments/${id}/quote`, { token: db.opToken, json: {} });
  const buy = (id: string, json: unknown): Promise<R> => {
    clock.advance(1);
    return h.api('POST', `/admin/shipments/${id}/label`, { token: db.opToken, json });
  };
  const refresh = (id: string): Promise<R> => {
    clock.advance(1000);
    return h.api('POST', `/admin/shipments/${id}/refresh-tracking`, { token: db.opToken, json: {} });
  };
  const row = (id: string) => h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id } });
  const pickRate = (q: any) => q.rates.find((r: any) => r.deliveryKind !== 'branch' && r.marginCents >= 0 && !r.hidden) ?? q.rates[0];
  const iso = (ms: number) => new Date(ms).toISOString();
  const track = (token: string) => h.api('POST', '/orders/guest/track', { json: { token } });
  const tokenRows = (orderId: string) => h.prisma.orderAccessToken.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
  const reissues = (orderId: string) =>
    h.prisma.auditLog.findMany({ where: { entityType: 'Order', entityId: orderId, action: 'order.tracking_link.reissue' }, orderBy: { createdAt: 'asc' } });

  const AV = {
    4: /guía de envío|tracking number/i,
    5: /va en camino|on its way/i,
    6: /cancelad|cancel/i,
    12: /Reembolso de (?!tu pedido)|Refund for (?!your order)/,
    18: /^(Tu paquete está en sucursal|Your package is at the branch)$/,
    19: /^(La paquetería intentó entregar tu paquete|The carrier tried to deliver your package)$/,
  } as const;
  const mails = (to: string, re?: RegExp) => bandeja.filter((m) => m.to === to && (!re || re.test(m.subject)));
  const body = (m: MailMessage) => [m.subject, m.html, m.text ?? ''].join('\n');
  /** Los tokens en claro que lleva UN correo (texto y html; deben coincidir). */
  const tokensIn = (m: MailMessage): string[] => [...new Set([...body(m).matchAll(TOKEN_RE)].map((x) => decodeURIComponent(x[1])))];
  const oneToken = (m: MailMessage): string => {
    const t = tokensIn(m);
    expect({ subject: m.subject, tokens: t.length }).toEqual({ subject: m.subject, tokens: 1 });
    return t[0];
  };

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

  beforeAll(async () => {
    process.env.APP_PUBLIC_URL = ORIGIN;
    fake = new FakeShippingProvider();
    fake.reuseQuotations = false;
    fake.defaultLabelUrl = 'https://pro.skydropx.com/labels/x.pdf';
    clock = new ManualLabelClock(new Date());
    fake.now = () => clock.now();
    const sel: ShippingProviderSelection = { port: fake, kind: 'fake', urlHosts: ['pro.skydropx.com'], client: null };
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
    await dial(h, SettingKey.OPERATOR_REFUND_CAP_24H_CENTS, 1_000_000_000);
    tokens = h.app.get(OrderAccessTokenService);
    const port = h.app.get<MailPort>(MAIL_PORT);
    jest.spyOn(port, 'send').mockImplementation(async (msg: MailMessage) => {
      bandeja.push(msg);
      return {};
    });
    // El log CAPTURADO (todo lo que el servidor escribe por `Logger` o `console`): ⛔ ningún token en claro.
    const capture = (...args: unknown[]) => {
      logged.push(args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };
    for (const m of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      logSpies.push(jest.spyOn(Logger.prototype, m).mockImplementation(capture as never));
    }
    for (const m of ['log', 'warn', 'error', 'info', 'debug'] as const) {
      logSpies.push(jest.spyOn(console, m).mockImplementation(capture as never));
    }
  });

  afterAll(async () => {
    for (const s of logSpies) s.mockRestore();
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
    logged = [];
    await dial(h, 'shipping_provider', 'skydropx');
  });

  afterEach(async () => {
    await h.prisma.$executeRaw`UPDATE "ShipmentLabelAttempt" SET since = since - interval '25 hours' WHERE since > ${new Date(Date.now() - 25 * H)}`;
  });

  it('(a) invitado sin reclamar: AV-4, AV-5 y AV-18 llevan cada uno un `/pedido?token=Xᵢ` DISTINTO; el del settle y todos los Xᵢ abren `guest/track`; filas = settle + 3; tres `reissue` `system:mail` sin claro ni hash; el log no trae ningún Xᵢ — y (f) tras `resend-link` todos ⇒ 410 TOKEN_REVOKED', async () => {
    const d = await db.mkDirect({ prices: [50000, 30000] });
    const to = d.order.guestEmail as string;
    // El token del settle (`sendConfirmation`: `rotate:false`).
    const settle = (await tokens.issue(d.order.id, { rotate: false })).clear;
    const s = await buyFor(d.shipment.id, 10 * D);
    const t = clock.now().getTime();
    fake.pushEvent(s.providerShipmentId as string, 'picked_up', iso(t - 9 * D));
    await refresh(s.id);
    fake.pushEvent(s.providerShipmentId as string, 'delivered_to_branch', iso(t - 8 * D), { branchName: 'Sucursal Centro' });
    await refresh(s.id);

    const [m4, m5, m18] = [mails(to, AV[4]), mails(to, AV[5]), mails(to, AV[18])];
    expect([m4.length, m5.length, m18.length]).toEqual([1, 1, 1]);
    const xs = [oneToken(m4[0]), oneToken(m5[0]), oneToken(m18[0])];
    expect(new Set([settle, ...xs]).size).toBe(4);
    for (const m of [m4[0], m5[0], m18[0]]) expect(m.text).toContain(`${ORIGIN}/es/pedido?token=`);
    // ⛔ El enlace de la confirmación SIGUE sirviendo (T.8): sin rotación.
    for (const x of [settle, ...xs]) {
      const r = await track(x);
      expect({ x: x.slice(0, 6), status: r.status }).toEqual({ x: x.slice(0, 6), status: 200 });
    }
    const rows = await tokenRows(d.order.id);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.revokedAt === null)).toBe(true);
    // 90 días (§4-G.7 TTL) para los de correo.
    for (const r of rows.slice(1)) expect(Math.round((r.expiresAt.getTime() - r.createdAt.getTime()) / D)).toBe(90);
    const audits = await reissues(d.order.id);
    expect(audits).toHaveLength(3);
    expect(audits.map((a) => (a.after as any)?.notice)).toEqual(['AV-4', 'AV-5', 'AV-18']);
    for (const a of audits) {
      expect(a.actorUserId).toBeNull();
      expect(a.after).toMatchObject({ actor: 'system:mail', rotated: false });
      const json = JSON.stringify([a.before, a.after]);
      for (const x of xs) {
        expect(json).not.toContain(x);
        expect(json).not.toContain(sha(x));
      }
    }
    const log = logged.join('\n');
    for (const x of [settle, ...xs]) expect(log).not.toContain(x);

    // ---- (f) el interruptor sigue: el reenvío revoca TODOS (incluidos los de los avisos).
    const rs = await h.api('POST', '/orders/guest/resend-link', { json: { token: settle } });
    expect(rs.status).toBe(202);
    for (let i = 0; i < 100 && (await tokenRows(d.order.id)).length < 5; i += 1) await new Promise((r) => setTimeout(r, 50));
    const after = await tokenRows(d.order.id);
    expect(after).toHaveLength(5);
    expect(after.slice(0, 4).every((r) => r.revokedAt !== null)).toBe(true);
    for (const x of [settle, ...xs]) {
      const r = await track(x);
      expect({ x: x.slice(0, 6), status: r.status, code: r.body?.error?.code }).toEqual({ x: x.slice(0, 6), status: 410, code: 'TOKEN_REVOKED' });
    }
  });

  it('(b) RECLAMADO (conserva `guestEmail`) ⇒ el correo va a `guestEmail` con `/orders/<id>` y CERO filas nuevas; el token viejo sigue 410', async () => {
    const cust = await db.mkUser('Cliente B1 Reclamo');
    const d = await db.mkDirect({ prices: [50000, 30000] });
    const to = d.order.guestEmail as string;
    const old = (await tokens.issue(d.order.id, { rotate: false })).clear;
    // El reclamo (§4-G claim): `userId`, `claimedAt` y revoca TODOS.
    await h.prisma.order.update({ where: { id: d.order.id }, data: { userId: cust.id, claimedAt: new Date() } });
    await tokens.revokeAll(d.order.id);
    const before = (await tokenRows(d.order.id)).length;
    const s = await buyFor(d.shipment.id, 10 * D);
    fake.pushEvent(s.providerShipmentId as string, 'picked_up', iso(clock.now().getTime() - 9 * D));
    await refresh(s.id);
    const ms = [...mails(to, AV[4]), ...mails(to, AV[5])];
    expect(ms).toHaveLength(2);
    for (const m of ms) {
      expect(m.text).toContain(`${ORIGIN}/es/orders/${d.order.id}`);
      expect(tokensIn(m)).toEqual([]);
    }
    expect((await tokenRows(d.order.id)).length).toBe(before);
    expect(await reissues(d.order.id)).toHaveLength(0);
    const r = await track(old);
    expect([r.status, r.body?.error?.code]).toEqual([410, 'TOKEN_REVOKED']);
  });

  it('(c) registrado ⇒ `/orders/<id>`; retiro ⇒ `/shipments/<id>`; CERO filas', async () => {
    const cust = await db.mkUser('Cliente B1 Registrado');
    const email = cust.email as string;
    const reg = await db.mkDirect({ userId: cust.id, prices: [50000, 30000] });
    const v = await db.mkVaultOrder(cust.id, { placement: 'placed' });
    const w = await db.mkWithdrawal(cust.id, v.pieces.map((p) => p.id), 'picking');
    const total0 = await h.prisma.orderAccessToken.count();
    await buyFor(reg.shipment.id, 10 * D);
    await buyFor(w.shipment.id, 10 * D);
    const m4 = mails(email, AV[4]);
    expect(m4).toHaveLength(2);
    expect(m4.filter((m) => m.text?.includes(`${ORIGIN}/es/orders/${reg.order.id}`))).toHaveLength(1);
    expect(m4.filter((m) => m.text?.includes(`${ORIGIN}/es/shipments/${w.shipment.id}`))).toHaveLength(1);
    for (const m of m4) expect(tokensIn(m)).toEqual([]);
    expect(await h.prisma.orderAccessToken.count()).toBe(total0);
    expect(await tokenRows(reg.order.id)).toHaveLength(0);
  });

  it('(d) la compra de la guía (`recipientEmailOf`) ⇒ CERO filas; la compra deja SOLO la fila del AV-4 que sí salió', async () => {
    const d = await db.mkDirect({ prices: [50000, 30000] });
    const svc = h.app.get(ShipmentsService);
    for (let i = 0; i < 3; i += 1) expect(await svc.recipientEmailOf(d.shipment)).toBe(d.order.guestEmail);
    expect(await tokenRows(d.order.id)).toHaveLength(0);
    await buyFor(d.shipment.id);
    const m4 = mails(d.order.guestEmail as string, AV[4]);
    expect(m4).toHaveLength(1);
    const rows = await tokenRows(d.order.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(sha(oneToken(m4[0])));
  });

  it('(e) sello perdido (el aviso ya salió) ⇒ CERO filas y cero correos', async () => {
    const d = await db.mkDirect({ prices: [50000, 30000] });
    const s = await buyFor(d.shipment.id, 10 * D);
    fake.pushEvent(s.providerShipmentId as string, 'delivered_to_branch', iso(clock.now().getTime() - 8 * D), { branchName: 'Sucursal Sur' });
    await refresh(s.id);
    await refresh(s.id); // el MISMO evento otra vez
    expect(mails(d.order.guestEmail as string, AV[18])).toHaveLength(1);
    const n = (await tokenRows(d.order.id)).length;
    // Una fila por correo que salió (AV-4, AV-5 por la salida que implica el evento, AV-18) — ni una más.
    expect(n).toBe(mails(d.order.guestEmail as string).length);
    expect(n).toBe(3);
    bandeja = [];
    const svc = h.app.get(ShipmentsService);
    // Disparos directos con el sello ya tomado: AV-4 (`trackingNoticeSentAt`) y AV-18 (`branchNoticeSentAt`).
    await svc.notifyLabelCaptured(s.id);
    await svc.notifyCarrierNotice(s.id, 'AV-18', { occurredAt: new Date(clock.now().getTime() - 8 * D), branchName: 'Sucursal Sur' } as never);
    expect(bandeja).toHaveLength(0);
    expect(await tokenRows(d.order.id)).toHaveLength(n);
    expect(await reissues(d.order.id)).toHaveLength(n);
  });

  it('(e) CARRERA: 5 disparos SIMULTÁNEOS del mismo AV-18 ⇒ UN correo y UNA fila (el sello decide antes que el token) — N=10 rondas', async () => {
    const svc = h.app.get(ShipmentsService);
    const N = 10;
    const out: string[] = [];
    for (let round = 0; round < N; round += 1) {
      const d = await db.mkDirect({ prices: [50000] });
      await buyFor(d.shipment.id);
      const to = d.order.guestEmail as string;
      const before = (await tokenRows(d.order.id)).length; // la del AV-4
      bandeja = [];
      const ev = { status: 'delivered_to_branch', occurredAt: new Date(clock.now().getTime() - H), observedAt: clock.now(), branchName: 'X', providerEventKey: `k${round}` };
      await Promise.all(Array.from({ length: 5 }, () => svc.notifyCarrierNotice(d.shipment.id, 'AV-18', ev as never)));
      const rows = (await tokenRows(d.order.id)).length - before;
      out.push(`${mails(to, AV[18]).length}/${rows}`);
    }
    // `console` está capturado (el candado del log): la proporción sale por stdout directo.
    process.stdout.write(`[B-1 carrera AV-18] ${out.filter((x) => x === '1/1').length}/${N} rondas con 1 correo y 1 fila · ${out.join(' ')}\n`);
    expect(out.filter((x) => x === '1/1')).toHaveLength(N);
  });

  it('(g) con 5 filas en 24 h (cupo del reenvío agotado) AV-19 sale CON liga; `resendQuotaExceeded` sigue contando todas', async () => {
    const d = await db.mkDirect({ prices: [50000, 30000] });
    const s = await buyFor(d.shipment.id, 10 * D); // fila 1 (AV-4)
    for (let i = 0; i < 4; i += 1) await tokens.issue(d.order.id, { rotate: false });
    expect(await tokenRows(d.order.id)).toHaveLength(5);
    expect(await tokens.resendQuotaExceeded(d.order.id)).toBe(true);
    fake.pushEvent(s.providerShipmentId as string, 'delivery_attempt', iso(clock.now().getTime() - 7 * D));
    await refresh(s.id);
    const m19 = mails(d.order.guestEmail as string, AV[19]);
    expect(m19).toHaveLength(1);
    const x = oneToken(m19[0]);
    expect((await track(x)).status).toBe(200);
    expect(await tokenRows(d.order.id)).toHaveLength(6);
    expect(await tokens.resendQuotaExceeded(d.order.id)).toBe(true);
  });

  it('(h) pedido de más de 365 días ⇒ SIN CTA y cero filas', async () => {
    const d = await db.mkDirect({ prices: [50000, 30000] });
    await h.prisma.order.update({ where: { id: d.order.id }, data: { createdAt: new Date(Date.now() - 366 * D) } });
    await buyFor(d.shipment.id);
    const [m] = mails(d.order.guestEmail as string, AV[4]);
    expect(m).toBeDefined();
    expect(tokensIn(m)).toEqual([]);
    expect(body(m)).not.toContain(`${ORIGIN}/es/orders/`);
    expect(body(m)).not.toContain(`${ORIGIN}/es/pedido`);
    expect(await tokenRows(d.order.id)).toHaveLength(0);
    expect(await reissues(d.order.id)).toHaveLength(0);
  });

  it('AV-4 manual (`setTracking`), AV-5 a mano y AV-6: el invitado recibe su liga, cada una abre su pedido', async () => {
    const d = await db.mkDirect({ prices: [50000, 30000] });
    const to = d.order.guestEmail as string;
    await ready(db, d.shipment.id);
    expect((await db.tracking(d.shipment.id)).status).toBe(201);
    expect(errCode(await db.status(d.shipment.id, 'enviado'))).toBe('200');
    const xs = [oneToken(mails(to, AV[4])[0]), oneToken(mails(to, AV[5])[0])];
    // AV-6: un envío de pedido aún `solicitado` que se cancela.
    const c = await db.mkDirect({ prices: [50000] });
    await h.prisma.shipmentRequest.update({ where: { id: c.shipment.id }, data: { status: 'solicitado', pickingAt: null } });
    expect(errCode(await db.status(c.shipment.id, 'cancelado'))).toBe('200');
    const m6 = mails(c.order.guestEmail as string, AV[6]);
    expect(m6).toHaveLength(1);
    xs.push(oneToken(m6[0]));
    for (const x of xs) expect((await track(x)).status).toBe(200);
    expect((await reissues(d.order.id)).map((a) => (a.after as any)?.notice)).toEqual(['AV-4', 'AV-5']);
    expect((await reissues(c.order.id)).map((a) => (a.after as any)?.notice)).toEqual(['AV-6']);
  });

  it('AV-12 (su propio camino, el MISMO cuerpo): invitado ⇒ `/pedido?token=X` que abre su pedido + `reissue` AV-12; registrado ⇒ `/orders/<id>` y cero filas', async () => {
    const run = async (userId: string | null) => {
      const d = await db.mkDirect({ userId, prices: [50000, 30000] });
      const line300 = d.lines.find((l) => l.inventoryItemId === d.pieces[1].id)!;
      expect((await db.mark(d.shipment.id, line300.id, { status: 'missing', missingReason: 'not_found' })).status).toBe(200);
      expect((await db.mark(d.shipment.id, d.lines.find((l) => l.inventoryItemId === d.pieces[0].id)!.id, { status: 'picked' })).status).toBe(200);
      const r = await db.prepare(d.shipment.id, 31458);
      expect([r.status, r.body.outcome]).toEqual([200, 'prepared']);
      return d;
    };
    const g = await run(null);
    const [m] = mails(g.order.guestEmail as string, AV[12]);
    expect(m).toBeDefined();
    const x = oneToken(m);
    expect(body(m)).not.toContain(`/orders/${g.order.id}`);
    expect((await track(x)).status).toBe(200);
    expect(await tokenRows(g.order.id)).toHaveLength(1);
    const audits = await reissues(g.order.id);
    expect(audits.map((a) => a.after)).toEqual([expect.objectContaining({ actor: 'system:mail', notice: 'AV-12', rotated: false })]);
    expect(JSON.stringify(audits.map((a) => a.after))).not.toContain(x);
    expect(logged.join('\n')).not.toContain(x);

    const cust = await db.mkUser('Cliente B1 AV-12');
    const reg = await run(cust.id);
    const [mr] = mails(cust.email as string, AV[12]);
    expect(mr).toBeDefined();
    expect(mr.text).toContain(`${ORIGIN}/es/orders/${reg.order.id}`);
    expect(tokensIn(mr)).toEqual([]);
    expect(await tokenRows(reg.order.id)).toHaveLength(0);
  });
});

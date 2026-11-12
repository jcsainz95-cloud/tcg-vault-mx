import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { MAIL_PORT } from '../../src/modules/mail/mail.port';
import { SupplierAccessService } from '../../src/modules/supply/supplier-access.service';
import { SupplyExpiryService } from '../../src/modules/supply/supply-expiry.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import { GoogleTokenVerifier } from '../../src/modules/auth/google-token-verifier';

/** §PROV F1 — correcciones de los gates (qa RECHAZADO, seguridad-lead condiciones). Postgres real. */
const SET = 'e2e-supply-gate-set';
const CA = 'e2e-supg-a';
const MARKET = 10000;

describe('E2E §PROV F1 — correcciones de gate', () => {
  let h: E2EHarness;
  const mails: { to: string; text: string }[] = [];
  let admin: string;
  let operator: string;
  const code = (r: { body: any }) => r.body?.error?.code;
  const A = (m: string, p: string, token: string, json?: unknown, headers?: Record<string, string>) =>
    h.api(m as any, p, { token, json, headers });
  const tokenOf = (to: string) => decodeURIComponent(/token=([^\s&]+)/.exec([...mails].reverse().find((x) => x.to === to)!.text)![1]);
  async function invite(email: string, name: string) {
    const r = await A('POST', '/admin/suppliers/invite', admin, { businessName: name, email });
    const acc = await h.api('POST', '/auth/supplier/accept-invite', { json: { token: tokenOf(email), password: 'Proveedor123!' } });
    expect(acc.status).toBe(200);
    return { token: (acc.body as any).accessToken as string, refresh: (acc.body as any).refreshToken as string, id: r.body.supplier.id as string, userId: (acc.body as any).user.id as string };
  }
  const mkRequest = async (body: Record<string, unknown> = {}) => {
    const r = await A('POST', '/admin/supply-requests', admin, { cardId: CA, finish: 'normal', minCondition: 'NM', qty: 2, ...body });
    expect(r.status).toBe(201);
    return r.body as any;
  };
  async function agreed(token: string, qty = 2) {
    const r = await mkRequest({ qty });
    const o = await A('POST', `/supplier/requests/${r.id}/offers`, token, { qty, condition: 'NM' });
    const acc = await A('POST', `/admin/supply-offers/${o.body.id}/respond`, admin, { action: 'accept' });
    expect(acc.status).toBe(200);
    return { reqId: r.id as string, offerId: o.body.id as string, pid: acc.body.purchase.id as string };
  }

  beforeAll(async () => {
    h = await E2EHarness.create((b) =>
      b.overrideProvider(MAIL_PORT).useValue({ send: async (m: any) => { mails.push({ to: m.to, text: m.text }); return {}; } }),
    );
    await seedE2E(h.prisma);
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    operator = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    await h.prisma.cardSet.create({ data: { id: SET, externalId: SET, name: 'E2E Supply Gate' } });
    await h.prisma.card.create({ data: { id: CA, externalId: CA, setId: SET, name: 'Supply Gate', number: '1', rarity: 'Rare', availableFinishes: ['normal'] } });
    await h.prisma.priceReference.create({
      data: { cardId: CA, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'manual', priceMxnCents: MARKET, capturedDate: new Date(), isManualOverride: true, refKind: 'market' },
    });
  });

  afterAll(async () => {
    const p = h?.prisma;
    if (p) {
      await p.inventoryItem.deleteMany({ where: { cardId: CA } });
      await p.supplyPurchaseUnit.deleteMany({});
      await p.supplyPurchase.deleteMany({});
      await p.supplyOfferEvent.deleteMany({});
      await p.supplyOffer.deleteMany({});
      await p.supplyRequest.deleteMany({});
      await p.supplierInvite.deleteMany({});
      const sups = await p.supplier.findMany({ select: { userId: true } });
      await p.supplier.deleteMany({});
      await p.user.deleteMany({ where: { id: { in: sups.map((s) => s.userId!).filter(Boolean) } } });
      await p.priceReference.deleteMany({ where: { cardId: CA } });
      await p.card.deleteMany({ where: { setId: SET } });
      await p.cardSet.deleteMany({ where: { id: SET } });
    }
    await h?.close();
  });

  let sA: Awaited<ReturnType<typeof invite>>;
  let sB: Awaited<ReturnType<typeof invite>>;

  it('contraseña: mustChangePassword ⇒ sesión restringida a POST /supplier/me/password; /auth/change-password es 403', async () => {
    sA = await invite('ga@e2e.local', 'Gate A');
    sB = await invite('gb@e2e.local', 'Gate B');
    await h.prisma.user.update({ where: { id: sA.userId }, data: { mustChangePassword: true } });
    const lg = await h.api('POST', '/auth/login', { json: { email: 'ga@e2e.local', password: 'Proveedor123!' } });
    expect(lg.status).toBe(200);
    expect((lg.body as any).user.mustChangePassword).toBe(true);
    const t = (lg.body as any).accessToken;
    expect(code(await A('GET', '/supplier/requests', t))).toBe('PASSWORD_CHANGE_REQUIRED');
    expect(code(await A('POST', '/auth/change-password', t, { currentPassword: 'x', newPassword: 'y' }))).toBe('FORBIDDEN_ROLE');
    expect(code(await A('POST', '/supplier/me/password', t, { currentPassword: 'mal', newPassword: 'Nueva12345!' }))).toBe('INVALID_CREDENTIALS');
    expect(code(await A('POST', '/supplier/me/password', t, { currentPassword: 'Proveedor123!', newPassword: '123' }))).toBe('WEAK_PASSWORD');
    expect((await A('POST', '/supplier/me/password', t, { currentPassword: 'Proveedor123!', newPassword: 'Nueva12345!' })).status).toBe(204);
    expect((await A('GET', '/supplier/me', t)).status).toBe(401); // las sesiones previas caen: se vuelve a entrar
    const again = await h.api('POST', '/auth/login', { json: { email: 'ga@e2e.local', password: 'Nueva12345!' } });
    expect((again.body as any).user.mustChangePassword).toBe(false);
    sA.token = (again.body as any).accessToken;
    expect((await A('GET', '/supplier/requests', sA.token)).status).toBe(200);
  });

  it('/admin/users* no lista ni abre cuentas supplier (por id ⇒ 404)', async () => {
    const list = await A('GET', '/admin/users?q=ga@e2e.local', admin);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain('ga@e2e.local');
    for (const [m, path, body] of [
      ['GET', `/admin/users/${sA.userId}`, undefined],
      ['POST', `/admin/users/${sA.userId}/reset-password`, {}],
      ['PATCH', `/admin/users/${sA.userId}/status`, { status: 'blocked' }],
      ['DELETE', `/admin/users/${sA.userId}`, undefined],
    ] as const) {
      const r = await A(m, path, admin, body);
      expect([m, path, r.status]).toEqual([m, path, 404]);
    }
    expect((await A('GET', `/admin/users/${sA.userId}`, operator)).status).toBe(404);
    expect((await h.prisma.user.findUniqueOrThrow({ where: { id: sA.userId } })).status).toBe('active');
  });

  it('solicitudes: PATCH en filled ⇒ 409; % limpia el fijo y el fijo limpia el %', async () => {
    const r = await mkRequest({ qty: 1 });
    const patched = await A('PATCH', `/admin/supply-requests/${r.id}`, admin, { fixedUnitCents: 8000 });
    expect(patched.body).toMatchObject({ unitCents: 8000, fixedPrice: true, pctBps: null });
    const back = await A('PATCH', `/admin/supply-requests/${r.id}`, admin, { pctBps: 6000 });
    expect(back.body).toMatchObject({ unitCents: 6000, fixedPrice: false, pctBps: 6000 });
    const o = await A('POST', `/supplier/requests/${r.id}/offers`, sA.token, { qty: 1, condition: 'NM' });
    await A('POST', `/admin/supply-offers/${o.body.id}/respond`, admin, { action: 'accept' });
    expect((await h.prisma.supplyRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('filled');
    for (const body of [{ qtyWanted: 5 }, { status: 'closed' }, { pctBps: 5000 }]) {
      const res = await A('PATCH', `/admin/supply-requests/${r.id}`, admin, body);
      expect([res.status, code(res)]).toEqual([409, 'INVALID_STATE']);
    }
  });

  it('todo devuelto ⇒ cancelled/all_returned, libera reserva, /pay 422; nada recibido ⇒ none_received; ajuste a 0 se rechaza; auditoría con el rol real', async () => {
    const a = await agreed(sA.token);
    await A('POST', `/admin/supply-purchases/${a.pid}/receive`, operator, { units: [{ n: 1, condition: 'NM' }, { n: 2, condition: 'NM' }] });
    const zero = await A('POST', `/admin/supply-purchases/${a.pid}/verify`, operator, { units: [{ n: 1, result: 'adjusted', adjustBps: 1 }, { n: 2, result: 'returned' }] });
    expect([zero.status, code(zero)]).toEqual([400, 'VALIDATION_ERROR']);
    const v = await A('POST', `/admin/supply-purchases/${a.pid}/verify`, operator, { units: [{ n: 1, result: 'returned' }, { n: 2, result: 'returned' }] });
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ status: 'cancelled', reason: 'all_returned', payableCents: 0 });
    expect(v.body.inventoryItemIds).toEqual([]);
    expect(await h.prisma.supplyRequest.findUniqueOrThrow({ where: { id: a.reqId } })).toMatchObject({ qtyReserved: 0, qtyReceived: 0, status: 'open' });
    expect(await h.prisma.inventoryItem.count({ where: { supplyPurchaseId: a.pid } })).toBe(0);
    const pay = await A('POST', `/admin/supply-purchases/${a.pid}/pay`, admin, { method: 'cash' });
    expect([pay.status, code(pay)]).toEqual([422, 'NOTHING_TO_PAY']);
    const audit = await h.prisma.auditLog.findFirst({ where: { action: 'supply.purchase.verify', entityId: a.pid } });
    expect(audit?.actorRole).toBe('vault_operator');

    const b = await agreed(sB.token);
    await A('POST', `/admin/supply-purchases/${b.pid}/receive`, operator, { units: [] });
    const vb = await A('POST', `/admin/supply-purchases/${b.pid}/verify`, operator, { units: [] });
    expect(vb.body).toMatchObject({ status: 'cancelled', reason: 'none_received', payableCents: 0 });
    expect((await h.prisma.supplyRequest.findUniqueOrThrow({ where: { id: b.reqId } })).qtyReserved).toBe(0);
    expect(code(await A('POST', `/admin/supply-purchases/${b.pid}/pay`, admin, { method: 'cash' }))).toBe('NOTHING_TO_PAY');
    // el proveedor lo ve cancelado con motivo
    expect((await A('GET', `/supplier/purchases/${b.pid}`, sB.token)).body).toMatchObject({ status: 'cancelled', reason: 'none_received' });
  });

  it('eventos del sistema salen como actor «system», no «owner»', async () => {
    const r = await mkRequest({ qty: 1 });
    const o = await A('POST', `/supplier/requests/${r.id}/offers`, sA.token, { qty: 1, condition: 'NM' });
    await h.prisma.supplyOffer.update({ where: { id: o.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await h.app.get(SupplyExpiryService).run();
    const det = await A('GET', `/supplier/offers/${o.body.id}`, sA.token);
    expect(det.body.status).toBe('expired');
    expect(det.body.events.map((e: any) => e.actor)).toEqual(['supplier', 'system']);
  });

  it('suspensión: 403 SUPPLIER_SUSPENDED en login, refresh, accept-invite, reset-password, Google y me; invalida invitaciones y ofertas; reactivar exige reinvitar', async () => {
    const s = await invite('gs@e2e.local', 'Gate S');
    const r = await mkRequest({ qty: 1 });
    const o = await A('POST', `/supplier/requests/${r.id}/offers`, s.token, { qty: 1, condition: 'NM' });
    // un enlace de restablecimiento ya emitido (forgot-password mientras estaba activa) y una invitación abierta
    await h.api('POST', '/auth/forgot-password', { json: { email: 'gs@e2e.local' } });
    await h.app.get(AuthService).backgroundIdle();
    const resetTok = tokenOf('gs@e2e.local');
    await A('PATCH', `/admin/suppliers/${s.id}`, admin, { resetPassword: true });
    const openInvite = tokenOf('gs@e2e.local');

    const sus = await A('PATCH', `/admin/suppliers/${s.id}`, admin, { status: 'suspended' });
    expect(sus.body.status).toBe('suspended');
    const login = await h.api('POST', '/auth/login', { json: { email: 'gs@e2e.local', password: 'Proveedor123!' } });
    expect([login.status, code(login)]).toEqual([403, 'SUPPLIER_SUSPENDED']);
    const refresh = await h.api('POST', '/auth/refresh', { json: { refreshToken: s.refresh } });
    expect([refresh.status, code(refresh)]).toEqual([403, 'SUPPLIER_SUSPENDED']);
    const acc = await h.api('POST', '/auth/supplier/accept-invite', { json: { token: openInvite, password: 'OtraClave123!' } });
    expect([acc.status, code(acc)]).toEqual([403, 'SUPPLIER_SUSPENDED']);
    const rst = await h.api('POST', '/auth/reset-password', { json: { token: resetTok, password: 'OtraClave123!' } });
    expect([rst.status, code(rst)]).toEqual([403, 'SUPPLIER_SUSPENDED']);
    const google = h.app.get(GoogleTokenVerifier);
    const spy = jest.spyOn(google, 'verify').mockResolvedValue({ sub: 'g-sub-1', email: 'gs@e2e.local', emailVerified: true, name: 'X' } as any);
    const g = await h.api('POST', '/auth/google', { json: { idToken: 'x'.repeat(30) } });
    spy.mockRestore();
    expect(g.status).toBe(403);
    await expect(h.app.get(SupplierAccessService).me(s.userId)).rejects.toMatchObject({ code: 'SUPPLIER_SUSPENDED' });
    expect((await h.prisma.supplyOffer.findUniqueOrThrow({ where: { id: o.body.id } })).status).toBe('expired');
    expect(await h.prisma.supplierInvite.count({ where: { supplierId: s.id, usedAt: null } })).toBe(0);
    // forgot-password no manda correo a una tienda suspendida
    const before = mails.length;
    await h.api('POST', '/auth/forgot-password', { json: { email: 'gs@e2e.local' } });
    await new Promise((res) => setTimeout(res, 300));
    expect(mails.length).toBe(before);
    // reactivar NO revive la invitación vieja; hay que reinvitar (resetPassword)
    expect((await A('PATCH', `/admin/suppliers/${s.id}`, admin, { status: 'active' })).body.status).toBe('active');
    expect(code(await h.api('POST', '/auth/supplier/accept-invite', { json: { token: openInvite, password: 'OtraClave123!' } }))).toBe('INVITE_INVALID');
    await A('PATCH', `/admin/suppliers/${s.id}`, admin, { resetPassword: true });
    expect((await h.api('POST', '/auth/supplier/accept-invite', { json: { token: tokenOf('gs@e2e.local'), password: 'OtraClave123!' } })).status).toBe(200);
    expect((await h.api('POST', '/auth/login', { json: { email: 'gs@e2e.local', password: 'OtraClave123!' } })).status).toBe(200);
  });
});

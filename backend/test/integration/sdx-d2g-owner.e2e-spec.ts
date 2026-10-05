/**
 * sdx-d2g-owner.e2e-spec.ts — 🔒💰 «el vigilado no apaga su vigilancia» (API_CONTRACT §19.30.2, C-21 (a)(b)(c); §19.29.8), por HTTP
 * real contra Postgres REAL. Propiedad: backend (D2g).
 *
 *  - PS-155 (ajustes): el operador ⇒ `403 MONEY_OUT_FORBIDDEN` + bitácora en `GET/PUT /admin/settings`; la dueña cambia un dial ⇒
 *    bitácora antes/después; tope en 0 ⇒ `422`; AG-21/AG-22 en `spendAlertsDisabled` ⇒ `422`.
 *  - PS-161 (C-21 (a)): V (o W, heredado con correo SIN marca) mueve un dial del dueño ⇒ `403 OWNER_ONLY_SETTING {keys}`, NADA
 *    escrito (tampoco otra clave del mismo cuerpo), `settings.owner_only_denied`, AG-22 🔴; el formulario entero con esas claves
 *    IGUALES y otra distinta ⇒ `200` y solo se escribe la otra; carrera dueña ∥ V con el valor viejo ⇒ queda el de la dueña
 *    (N = 10 rondas, proporción en el título).
 *  - PS-162 (C-21 (b)): la cuenta del dueño no se restablece, bloquea ni borra desde otra cuenta.
 *  - PS-163 (C-21 (c)): AG-22 por acto sobre PERSONAL; nada sobre clientes ni cuando actúa la dueña.
 */
import { createSpendWorld, Person, SpendWorld } from './helpers/spend-db';
import { AuthService } from '../../src/modules/auth/auth.service';

let w: SpendWorld;
const touchedKeys = ['operator_label_cap_24h_cents', 'shipping_label_reissue_max_per_shipment', 'shipping_tracking_poll_minutes', 'spend_alerts_disabled', 'spend_alert_label_cap_warn_pct'];
let savedDials: { key: string; valueJson: unknown; updatedBy: string | null }[] = [];

beforeAll(async () => {
  w = await createSpendWorld();
  savedDials = (await w.h.prisma.configSetting.findMany({ where: { key: { in: touchedKeys } } })).map((r) => ({ key: r.key, valueJson: r.valueJson, updatedBy: r.updatedBy }));
});
afterAll(async () => {
  if (w) {
    await w.h.prisma.configSetting.deleteMany({ where: { key: { in: touchedKeys } } });
    for (const d of savedDials) await w.h.prisma.configSetting.create({ data: { key: d.key, valueJson: d.valueJson as object, updatedBy: d.updatedBy } });
  }
  await w?.close();
});

const api = (method: string, path: string, token: string, json?: unknown) => w.h.api(method, path, { token, json });
const dialValue = async (key: string) => (await w.h.prisma.configSetting.findUnique({ where: { key } }))?.valueJson;
const ag22 = (actorId: string, act: string) =>
  w.h.prisma.spendAlert.findMany({ where: { kind: 'staff_control_by_non_owner', subjectUserId: actorId, dedupKey: { startsWith: `ag22:${actorId}:${act}:` } } });

describe('PS-155 — los ajustes: operador fuera con bitácora; validadores', () => {
  it.each([
    ['GET', '/admin/settings'],
    ['PUT', '/admin/settings'],
    ['GET', '/admin/audit-log'],
  ])('operador: %s %s ⇒ 403 MONEY_OUT_FORBIDDEN + `money_out.blocked`', async (method, path) => {
    const t0 = new Date();
    const r = await api(method, path, w.op.token, method === 'PUT' ? { operatorLabelCap24hCents: 100000000 } : undefined);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('MONEY_OUT_FORBIDDEN');
    expect(await w.h.prisma.auditLog.count({ where: { action: 'money_out.blocked', actorUserId: w.op.id, createdAt: { gte: t0 } } })).toBe(1);
  });

  it('la dueña cambia un dial ⇒ 200 y bitácora `settings.update` con antes/después; 0 en el tope ⇒ 422; AG-21/AG-22 apagados ⇒ 422', async () => {
    const t0 = new Date();
    const r = await api('PUT', '/admin/settings', w.owner.token, { operatorLabelCap24hCents: 300000 });
    expect(r.status).toBe(200);
    expect(r.body.operatorLabelCap24hCents).toBe(300000);
    const log = await w.h.prisma.auditLog.findFirst({ where: { action: 'settings.update', actorUserId: w.owner.id, createdAt: { gte: t0 } } });
    expect((log?.before as Record<string, unknown>).operatorLabelCap24hCents).not.toBe(300000);
    expect(log?.after).toEqual({ operatorLabelCap24hCents: 300000 });
    expect((await api('PUT', '/admin/settings', w.owner.token, { operatorLabelCap24hCents: 0 })).status).toBe(422);
    for (const code of ['AG-21', 'AG-22']) {
      const bad = await api('PUT', '/admin/settings', w.owner.token, { spendAlertsDisabled: [code] });
      expect(bad.status).toBe(422);
      expect(bad.body.error.details.errors).toHaveProperty('spendAlertsDisabled');
    }
    expect(await dialValue('operator_label_cap_24h_cents')).toBe(300000);
  });
});

describe('PS-161 / C-21 (a) — los diales del dueño solo los mueve el dueño', () => {
  it.each([['V (súper-admin sin correo)', 'v'], ['W (súper-admin con correo y SIN marca)', 'w']] as const)(
    '%s mueve el tope ⇒ 403 OWNER_ONLY_SETTING {keys}, NADA escrito (tampoco la otra clave), bitácora y AG-22 🔴',
    async (_label, who) => {
      const actor: Person = w[who];
      const before = { cap: await dialValue('operator_label_cap_24h_cents'), poll: await dialValue('shipping_tracking_poll_minutes') };
      const t0 = new Date();
      const r = await api('PUT', '/admin/settings', actor.token, { operatorLabelCap24hCents: 100000000, spendAlertLabelCapWarnPct: 99, shippingTrackingPollMinutes: 77 });
      expect(r.status).toBe(403);
      expect(r.body.error).toMatchObject({ code: 'OWNER_ONLY_SETTING', details: { keys: ['operatorLabelCap24hCents', 'spendAlertLabelCapWarnPct'] } });
      expect({ cap: await dialValue('operator_label_cap_24h_cents'), poll: await dialValue('shipping_tracking_poll_minutes') }).toEqual(before);
      const log = await w.h.prisma.auditLog.findFirst({ where: { action: 'settings.owner_only_denied', actorUserId: actor.id, createdAt: { gte: t0 } } });
      expect(log?.after).toEqual({ keys: ['operatorLabelCap24hCents', 'spendAlertLabelCapWarnPct'] });
      const alerts = await ag22(actor.id, 'owner_setting_denied');
      expect(alerts).toHaveLength(1);
      expect(alerts[0].severity).toBe('immediate');
      // S-GAS-9 / PS-169: `facts.keys` en camelCase e IGUALES a las del `403`.
      expect((alerts[0].facts as { keys: string[] }).keys).toEqual(r.body.error.details.keys);
      expect(alerts[0].dedupKey).toContain(':operatorLabelCap24hCents,spendAlertLabelCapWarnPct:');
    },
  );

  it('V manda el formulario ENTERO con las claves del dueño iguales y otra distinta ⇒ 200, solo se escribe la otra', async () => {
    const form = (await api('GET', '/admin/settings', w.v.token)).body; // V VE los diales (Z.0.2)
    expect(form).toHaveProperty('operatorLabelCap24hCents');
    const r = await api('PUT', '/admin/settings', w.v.token, { ...form, shippingTrackingPollMinutes: 45 });
    expect(r.status).toBe(200);
    expect(await dialValue('shipping_tracking_poll_minutes')).toBe(45);
    const cap = await w.h.prisma.configSetting.findUnique({ where: { key: 'operator_label_cap_24h_cents' } });
    expect(cap?.updatedBy).not.toBe(w.v.id);
    // `spendAlertsDisabled` es un conjunto: reordenado sigue siendo «igual».
    await api('PUT', '/admin/settings', w.owner.token, { spendAlertsDisabled: ['AG-2', 'AG-13'] });
    expect((await api('PUT', '/admin/settings', w.v.token, { spendAlertsDisabled: ['AG-13', 'AG-2'], shippingTrackingPollMinutes: 46 })).status).toBe(200);
    expect((await w.h.prisma.configSetting.findUnique({ where: { key: 'spend_alerts_disabled' } }))?.updatedBy).toBe(w.owner.id);
    await api('PUT', '/admin/settings', w.owner.token, { spendAlertsDisabled: [] });
  });

  it('CARRERA: la dueña sube el tope mientras V guarda el formulario con el valor VIEJO ⇒ queda el de la dueña (N = 10)', async () => {
    const N = 10;
    let ok = 0;
    for (let i = 0; i < N; i++) {
      const old = 250000 + i;
      await api('PUT', '/admin/settings', w.owner.token, { operatorLabelCap24hCents: old });
      const target = 400000 + i;
      const [a, b] = await Promise.all([
        api('PUT', '/admin/settings', w.owner.token, { operatorLabelCap24hCents: target }),
        api('PUT', '/admin/settings', w.v.token, { operatorLabelCap24hCents: old, shippingTrackingPollMinutes: 30 + i }),
      ]);
      const final = await dialValue('operator_label_cap_24h_cents');
      if (a.status === 200 && [200, 403].includes(b.status) && final === target) ok += 1;
    }
    // eslint-disable-next-line no-console
    console.log(`PS-161 carrera: ${ok}/${N} rondas con el tope de la dueña intacto (autor: backend D2g)`);
    expect(ok).toBe(N);
  });

  it('sin dueño (nadie marcado) ⇒ NADIE mueve los diales del dueño, ni la antigua dueña (falla cerrado)', async () => {
    await w.h.prisma.$executeRawUnsafe(`UPDATE "User" SET "isOwner" = false WHERE "isOwner"`);
    try {
      const r = await api('PUT', '/admin/settings', w.owner.token, { operatorLabelCap24hCents: 123456 });
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('OWNER_ONLY_SETTING');
    } finally {
      await w.h.prisma.$executeRawUnsafe(`UPDATE "User" SET "isOwner" = true WHERE id = $1`, w.owner.id);
    }
  });
});

describe('PS-162 / C-21 (b) — la cuenta del dueño está protegida', () => {
  it('V: reset-password, status y DELETE sobre la dueña ⇒ 403 OWNER_ACCOUNT_PROTECTED, intactos, bitácora `owner_protected` y AG-22 🔴', async () => {
    const before = await w.h.prisma.user.findUniqueOrThrow({ where: { id: w.owner.id } });
    const t0 = new Date();
    const calls: [string, string, unknown, string][] = [
      ['POST', `/admin/users/${w.owner.id}/reset-password`, undefined, 'reset_password'],
      ['PATCH', `/admin/users/${w.owner.id}/status`, { status: 'blocked' }, 'status'],
      ['DELETE', `/admin/users/${w.owner.id}`, undefined, 'delete'],
    ];
    for (const [m, p, body, attempted] of calls) {
      const r = await api(m, p, w.v.token, body);
      expect([r.status, r.body.error.code]).toEqual([403, 'OWNER_ACCOUNT_PROTECTED']);
      // «sin `details`»: el filtro global serializa la ausencia como `{}` (`all-exceptions.filter.ts:47`).
      expect(r.body.error.details ?? {}).toEqual({});
      const log = await w.h.prisma.auditLog.findFirst({ where: { action: 'user.admin_action_denied', actorUserId: w.v.id, entityId: w.owner.id, createdAt: { gte: t0 }, after: { path: ['attempted'], equals: attempted } } });
      expect(log?.after).toEqual({ attempted, reason: 'owner_protected' });
    }
    const after = await w.h.prisma.user.findUniqueOrThrow({ where: { id: w.owner.id } });
    expect([after.passwordHash, after.status, after.tokenVersion, after.deletedAt, after.isOwner]).toEqual([before.passwordHash, before.status, before.tokenVersion, null, true]);
    const alerts = await ag22(w.v.id, 'owner_account_denied');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('immediate');
    expect(alerts[0].occurrenceCount).toBe(3);
  });

  it('la dueña se bloquea a sí misma ⇒ 403; restablece SU contraseña ⇒ 200; V restablece a un operador ⇒ 200', async () => {
    expect((await api('PATCH', `/admin/users/${w.owner.id}/status`, w.owner.token, { status: 'blocked' })).body.error.code).toBe('OWNER_ACCOUNT_PROTECTED');
    expect((await w.h.prisma.user.findUniqueOrThrow({ where: { id: w.owner.id } })).status).toBe('active');
    const self = await api('POST', `/admin/users/${w.owner.id}/reset-password`, w.owner.token);
    expect(self.status).toBe(200);
    // La sesión de la dueña se revocó (tokenVersion++): token nuevo para lo que sigue.
    w.owner.token = (await w.h.app.get(AuthService).issueTokens(await w.h.prisma.user.findUniqueOrThrow({ where: { id: w.owner.id } }))).accessToken;
    await w.h.prisma.user.update({ where: { id: w.owner.id }, data: { mustChangePassword: false } });
    const op = await api('POST', `/admin/users/${w.op.id}/reset-password`, w.v.token);
    expect(op.status).toBe(200);
    w.op.token = (await w.h.app.get(AuthService).issueTokens(await w.h.prisma.user.findUniqueOrThrow({ where: { id: w.op.id } }))).accessToken;
    await w.h.prisma.user.update({ where: { id: w.op.id }, data: { mustChangePassword: false } });
    // El listado de la respuesta de `status` trae `isOwner`.
    const st = await api('PATCH', `/admin/users/${w.op.id}/status`, w.v.token, { status: 'active' });
    expect(st.status).toBe(200);
    expect(st.body.isOwner).toBe(false);
  });

  it('borrar a la dueña desde su propia cuenta ⇒ 409 CANNOT_DELETE_SELF (primero), sin cambio', async () => {
    const r = await api('DELETE', `/admin/users/${w.owner.id}`, w.owner.token);
    expect([r.status, r.body.error.code]).toEqual([409, 'CANNOT_DELETE_SELF']);
  });
});

describe('PS-163 / C-21 (c) — AG-22: lo que un no dueño hace con cuentas de PERSONAL avisa', () => {
  const mkStaff = (token: string, role: 'vault_operator' | 'super_admin', tag: string) =>
    api('POST', '/admin/users', token, { username: `d2g-${tag}-${w.run}`, name: `Alta ${tag} ${w.run}`, role, password: 'Correcta-Larga-123!' });

  it('V crea un operador ⇒ AG-22 🟡 `staff_created`; crea un súper-admin ⇒ 🔴; restablece a un súper-admin ⇒ 🔴', async () => {
    const a = await mkStaff(w.v.token, 'vault_operator', 'opv');
    expect(a.status).toBe(201);
    const b = await mkStaff(w.v.token, 'super_admin', 'sav');
    expect(b.status).toBe(201);
    const created = await ag22(w.v.id, 'staff_created');
    const sev = new Map(created.map((x) => [(x.facts as { target: { userId: string } }).target.userId, x.severity]));
    expect(sev.get(a.body.user.id)).toBe('digest');
    expect(sev.get(b.body.user.id)).toBe('immediate');
    expect(created.find((x) => (x.facts as { target: { userId: string } }).target.userId === b.body.user.id)?.facts).toEqual({
      act: 'staff_created',
      target: { userId: b.body.user.id, name: `Alta sav ${w.run}`, role: 'super_admin' },
      keys: null,
    });
    expect((await api('POST', `/admin/users/${b.body.user.id}/reset-password`, w.v.token)).status).toBe(200);
    const reset = (await ag22(w.v.id, 'staff_password_reset')).filter((x) => (x.facts as { target: { userId: string } }).target.userId === b.body.user.id);
    expect(reset.map((x) => x.severity)).toEqual(['immediate']);
    // estado y borrado sobre personal ⇒ 🟡
    expect((await api('PATCH', `/admin/users/${a.body.user.id}/status`, w.v.token, { status: 'blocked' })).status).toBe(200);
    const onA = (xs: { facts: unknown; severity: string }[]) => xs.filter((x) => (x.facts as { target: { userId: string } }).target.userId === a.body.user.id).map((x) => x.severity);
    expect(onA(await ag22(w.v.id, 'staff_status_changed'))).toEqual(['digest']);
    expect((await api('DELETE', `/admin/users/${a.body.user.id}`, w.v.token)).status).toBe(200);
    expect(onA(await ag22(w.v.id, 'staff_deleted'))).toEqual(['digest']);
  });

  it('la dueña crea un súper-admin ⇒ NADA; V restablece a un CLIENTE ⇒ NADA', async () => {
    const before = await w.h.prisma.spendAlert.count({ where: { kind: 'staff_control_by_non_owner' } });
    expect((await mkStaff(w.owner.token, 'super_admin', 'sao')).status).toBe(201);
    expect((await api('POST', `/admin/users/${w.customer.id}/reset-password`, w.v.token)).status).toBe(200);
    expect(await w.h.prisma.spendAlert.count({ where: { kind: 'staff_control_by_non_owner' } })).toBe(before);
    expect(await ag22(w.owner.id, 'staff_created')).toHaveLength(0);
  });

  it('el operador no crea cuentas (403 + `user.admin_action_denied`, sin AG-22: el rechazo es del guard)', async () => {
    const r = await mkStaff(w.op.token, 'vault_operator', 'opx');
    expect(r.status).toBe(403);
    expect(await w.h.prisma.spendAlert.count({ where: { kind: 'staff_control_by_non_owner', subjectUserId: w.op.id } })).toBe(0);
  });
});

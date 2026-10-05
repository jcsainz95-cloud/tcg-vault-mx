/**
 * sdx-d2g-panel.e2e-spec.ts — 💰 el panel de avisos y `isOwner`, por HTTP real contra Postgres REAL (API_CONTRACT §19.29.9 con
 * §19.30.2 (4)–(5), §19.30.3, §19.31.8). Propiedad: backend (D2g).
 *
 *  - PS-152: el operador ⇒ `403 MONEY_OUT_FORBIDDEN` + `money_out.blocked` en TODAS las rutas (también los `GET`); el súper-admin
 *    marca visto ⇒ `seen.by`; C-21 (d): un no dueño no marca lo suyo ni AG-21 (`skipped`), y un `null` no se pierde.
 *  - PS-155 (parte panel) / PS-169: un tipo apagado ⇒ fila `muted`, `mailStatus='not_applicable'`, visible con `?muted=true`;
 *    `SpendAlertDTO.muted`; `summary.mutedCount` y `byKind` SIN silenciados.
 *  - §19.30.3: `isOwner` en `GET /users/me` y en `GET /admin/users`.
 */
import { SpendAlertsService, SpendFacts } from '../../src/modules/spend-alerts/spend-alerts.service';
import { createSpendWorld, mkSkydropxShipment, SpendWorld } from './helpers/spend-db';

let w: SpendWorld;
let alerts: SpendAlertsService;
beforeAll(async () => {
  w = await createSpendWorld();
  alerts = w.h.app.get(SpendAlertsService);
});
afterAll(async () => {
  await w.h.prisma.configSetting.deleteMany({ where: { key: 'spend_alerts_disabled', updatedBy: w.owner.id } });
  await w?.close();
});

const api = (method: string, path: string, token: string, json?: unknown) => w.h.api(method, path, { token, json });
let n = 0;
async function raise(kind: Parameters<SpendAlertsService['raise']>[1]['kind'], over: { subjectUserId?: string | null; severity?: 'immediate' | 'digest'; facts?: SpendFacts; shipmentRequestId?: string } = {}) {
  n += 1;
  const r = await alerts.raise(
    w.h.prisma,
    { kind, severity: over.severity ?? 'immediate', dedupKey: `panel:${w.run}:${n}`, subjectUserId: over.subjectUserId ?? null, shipmentRequestId: over.shipmentRequestId, facts: over.facts ?? {} },
    w.clock.now(),
  );
  return r!.id;
}

describe('PS-152 — el operador no ve ni marca avisos (403 MONEY_OUT_FORBIDDEN AUDITADO en todas las rutas)', () => {
  it.each([
    ['GET', '/admin/spend-alerts'],
    ['GET', '/admin/spend-alerts/summary'],
    ['GET', '/admin/spend-alerts/00000000-0000-4000-8000-000000000000'],
    ['POST', '/admin/spend-alerts/seen'],
  ])('%s %s ⇒ 403 MONEY_OUT_FORBIDDEN + `money_out.blocked`', async (method, path) => {
    const t0 = new Date();
    const r = await api(method, path, w.op.token, method === 'POST' ? { ids: ['00000000-0000-4000-8000-000000000000'] } : undefined);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('MONEY_OUT_FORBIDDEN');
    const logs = await w.h.prisma.auditLog.findMany({ where: { action: 'money_out.blocked', actorUserId: w.op.id, createdAt: { gte: t0 } } });
    expect(logs).toHaveLength(1);
  });
});

describe('PS-152 — lista, detalle y «visto»', () => {
  it('la dueña lista con `Cache-Control: no-store`; el DTO trae code, subject (personal), shipment {folio, kind}, mail y muted', async () => {
    const s = await mkSkydropxShipment(w);
    const id = await raise('label_cap_blocked', { subjectUserId: w.op.id, shipmentRequestId: s.shipmentId, facts: { priceCents: 15000, usedCents: 1, capCents: 2 } });
    const r = await api('GET', `/admin/spend-alerts?subjectUserId=${w.op.id}`, w.owner.token);
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    const dto = r.body.data.find((x: { id: string }) => x.id === id);
    expect(dto).toMatchObject({
      code: 'AG-3',
      kind: 'label_cap_blocked',
      severity: 'immediate',
      subject: { userId: w.op.id, name: w.op.name },
      shipment: { id: s.shipmentId, folio: s.folio, kind: 'vault_withdrawal' },
      order: null,
      mail: { status: 'pending', at: null },
      muted: false,
      seen: null,
    });
    const one = await api('GET', `/admin/spend-alerts/${id}`, w.owner.token);
    expect(one.body).toEqual(dto);
    expect((await api('GET', '/admin/spend-alerts/00000000-0000-4000-8000-000000000000', w.owner.token)).status).toBe(404);
  });

  it('el súper-admin marca visto ⇒ la fila sigue, con `seen.by`; idempotente; bitácora `spend_alert.seen`', async () => {
    const id = await raise('label_charged_unexplained', { facts: { cause: 'orphan_fuse' } });
    const t0 = new Date();
    const r = await api('POST', '/admin/spend-alerts/seen', w.owner.token, { ids: [id] });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ updated: 1, skipped: 0 });
    expect((await api('POST', '/admin/spend-alerts/seen', w.owner.token, { ids: [id] })).body).toEqual({ updated: 0, skipped: 0 });
    const dto = (await api('GET', `/admin/spend-alerts/${id}`, w.owner.token)).body;
    expect(dto.seen).toMatchObject({ by: { userId: w.owner.id, name: w.owner.name } });
    const log = await w.h.prisma.auditLog.findFirst({ where: { action: 'spend_alert.seen', actorUserId: w.owner.id, createdAt: { gte: t0 } } });
    expect(log?.after).toEqual({ count: 1, skipped: 0 });
  });

  it('C-21 (d): V (no dueño) sobre un aviso suyo ⇒ updated 0, skipped 1 (sigue sin ver); de sistema ⇒ 1; AG-21 ⇒ skipped; un `null` y uno de OTRA persona en el mismo lote ⇒ los dos', async () => {
    const own = await raise('staff_control_by_non_owner', { subjectUserId: w.v.id, facts: { act: 'staff_created' } });
    const sys = await raise('label_charged_unexplained', { facts: { cause: 'orphan_fuse' } });
    const ag21 = await raise('owner_account_changed', { facts: { cause: 'no_owner' } });
    const other = await raise('label_cap_blocked', { subjectUserId: w.op.id });
    const sys2 = await raise('provider_balance_low', { facts: { balanceCents: 1, thresholdCents: 2 } });
    expect((await api('POST', '/admin/spend-alerts/seen', w.v.token, { ids: [own] })).body).toEqual({ updated: 0, skipped: 1 });
    expect((await w.h.prisma.spendAlert.findUniqueOrThrow({ where: { id: own } })).seenAt).toBeNull();
    expect((await api('POST', '/admin/spend-alerts/seen', w.v.token, { ids: [sys] })).body).toEqual({ updated: 1, skipped: 0 });
    expect((await api('POST', '/admin/spend-alerts/seen', w.v.token, { ids: [ag21] })).body).toEqual({ updated: 0, skipped: 1 });
    expect((await api('POST', '/admin/spend-alerts/seen', w.v.token, { ids: [sys2, other] })).body).toEqual({ updated: 2, skipped: 0 });
    // El heredado con correo y sin marca (W) es tan vigilado como V: no marca AG-21.
    expect((await api('POST', '/admin/spend-alerts/seen', w.w.token, { ids: [ag21] })).body).toEqual({ updated: 0, skipped: 1 });
    // La dueña marca todo, también lo de V y AG-21.
    expect((await api('POST', '/admin/spend-alerts/seen', w.owner.token, { ids: [own, ag21] })).body).toEqual({ updated: 2, skipped: 0 });
  });

  it('`ids` fuera de forma ⇒ 400 VALIDATION_ERROR {field:"ids"} (vacío, no uuid, > 200)', async () => {
    for (const ids of [[], ['x'], Array.from({ length: 201 }, () => '00000000-0000-4000-8000-000000000000'), 'x']) {
      const r = await api('POST', '/admin/spend-alerts/seen', w.owner.token, { ids });
      expect(r.status).toBe(400);
      expect(r.body.error.details).toMatchObject({ field: 'ids' });
    }
  });
});

describe('PS-155 / PS-169 — un tipo apagado crea la fila SILENCIADA; `muted`, `?muted=`, `mutedCount` y `byKind` sin silenciados', () => {
  it('AG-9 apagado ⇒ fila `muted` con `not_applicable`; visible con `?muted=true`, fuera con `?muted=false`; el resumen la cuenta aparte', async () => {
    const put = await api('PUT', '/admin/settings', w.owner.token, { spendAlertsDisabled: ['AG-9'] });
    expect(put.status).toBe(200);
    try {
      const id = await raise('label_charged_unexplained', { facts: { cause: 'orphan_fuse' }, subjectUserId: null });
      const row = await w.h.prisma.spendAlert.findUniqueOrThrow({ where: { id } });
      expect([row.muted, row.mailStatus]).toEqual([true, 'not_applicable']);
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(row.firstOccurredAt);
      const on = await api('GET', `/admin/spend-alerts?muted=true&kind=label_charged_unexplained&from=${day}&to=${day}&pageSize=100`, w.owner.token);
      expect(on.body.data.map((x: { id: string }) => x.id)).toContain(id);
      expect(on.body.data.every((x: { muted: boolean }) => x.muted === true)).toBe(true);
      const off = await api('GET', `/admin/spend-alerts?muted=false&kind=label_charged_unexplained&from=${day}&to=${day}&pageSize=100`, w.owner.token);
      expect(off.body.data.map((x: { id: string }) => x.id)).not.toContain(id);
      // El resumen: mutedCount = silenciados del rango; byKind SOLO los no silenciados.
      const sum = (await api('GET', `/admin/spend-alerts/summary?from=${day}&to=${day}`, w.owner.token)).body;
      const mutedInDb = await w.h.prisma.spendAlert.count({ where: { muted: true, firstOccurredAt: { gte: new Date(`${day}T06:00:00Z`), lt: new Date(new Date(`${day}T06:00:00Z`).getTime() + 86400_000) } } });
      expect(sum.mutedCount).toBe(mutedInDb);
      const ag9 = sum.byKind.find((k: { code: string }) => k.code === 'AG-9');
      const ag9NotMuted = await w.h.prisma.spendAlert.count({
        where: { kind: 'label_charged_unexplained', muted: false, firstOccurredAt: { gte: new Date(`${day}T06:00:00Z`), lt: new Date(new Date(`${day}T06:00:00Z`).getTime() + 86400_000) } },
      });
      expect((ag9?.immediate ?? 0) + (ag9?.digest ?? 0)).toBe(ag9NotMuted);
      // AG-21/AG-22 no se pueden apagar: su fila nunca sale silenciada aunque el dial los nombrara.
      const ag22 = await raise('staff_control_by_non_owner', { subjectUserId: w.v.id, facts: { act: 'staff_deleted' } });
      expect((await w.h.prisma.spendAlert.findUniqueOrThrow({ where: { id: ag22 } })).muted).toBe(false);
    } finally {
      expect((await api('PUT', '/admin/settings', w.owner.token, { spendAlertsDisabled: [] })).status).toBe(200);
    }
  });
});

describe('§0-Q — los ejes de la lista (`?kind` E, `?severity` E, `?unseen` L, `?muted` L) y los no-enums', () => {
  it('fuera de dominio ⇒ 400 con `allowed`; vacío/espacios ⇒ sin filtro; `?subjectUserId` no uuid y fechas fuera de forma ⇒ 400 {field}', async () => {
    for (const [q, field] of [['kind=banana', 'kind'], ['severity=red', 'severity'], ['unseen=false', 'unseen'], ['muted=yes', 'muted']]) {
      const r = await api('GET', `/admin/spend-alerts?${q}`, w.owner.token);
      expect(r.status).toBe(400);
      expect(r.body.error.details).toMatchObject({ field, allowed: expect.any(Array) });
    }
    expect((await api('GET', '/admin/spend-alerts?kind=%20&severity=&unseen=%20&muted=', w.owner.token)).status).toBe(200);
    for (const [q, field] of [['subjectUserId=abc', 'subjectUserId'], ['from=2026-13-01', 'from'], ['to=ayer', 'to'], ['from=2026-10-05&to=2026-10-04', 'from'], ['pageSize=101', 'pageSize']]) {
      const r = await api('GET', `/admin/spend-alerts?${q}`, w.owner.token);
      expect(r.status).toBe(400);
      expect(r.body.error.details).toMatchObject({ field });
    }
  });

  it('`?unseen=true` deja fuera lo visto; `?severity=digest` solo 🟡', async () => {
    const seen = await raise('label_cap_warning', { subjectUserId: w.op.id, severity: 'digest' });
    const unseen = await raise('label_cap_warning', { subjectUserId: w.op.id, severity: 'digest' });
    await api('POST', '/admin/spend-alerts/seen', w.owner.token, { ids: [seen] });
    const r = await api('GET', `/admin/spend-alerts?unseen=true&severity=digest&subjectUserId=${w.op.id}&pageSize=100`, w.owner.token);
    const ids = r.body.data.map((x: { id: string }) => x.id);
    expect(ids).toContain(unseen);
    expect(ids).not.toContain(seen);
    expect(r.body.data.every((x: { severity: string }) => x.severity === 'digest')).toBe(true);
  });
});

describe('§19.30.3 — `isOwner` en `GET /users/me` y en el listado de usuarios', () => {
  it('la dueña ⇒ true; V, W (con correo y sin marca), el operador y el cliente ⇒ false', async () => {
    expect((await api('GET', '/users/me', w.owner.token)).body.isOwner).toBe(true);
    for (const p of [w.v, w.w, w.op, w.customer]) expect((await api('GET', '/users/me', p.token)).body.isOwner).toBe(false);
    const list = await api('GET', `/admin/users?q=${w.run}&pageSize=100`, w.owner.token);
    const byId = new Map(list.body.data.map((u: { id: string; isOwner: boolean }) => [u.id, u.isOwner]));
    expect(byId.get(w.owner.id)).toBe(true);
    for (const p of [w.v, w.w, w.op, w.customer]) expect(byId.get(p.id)).toBe(false);
  });
});

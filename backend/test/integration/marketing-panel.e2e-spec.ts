/**
 * marketing-panel.e2e-spec.ts — ⭐ CANDADO por HTTP contra Postgres REAL de la pantalla del panel por sesión y
 * del acceso del analista (API_CONTRACT §MKT.G.2/.3/.6, §MKT.G.9 (1)(3)(4)(5)(7)). Propiedad: backend; la ejecuta QA
 * (`npm run test:integration`). Sin mocks de guards, pipes, filtro ni Prisma.
 *
 * | §MKT.G.9 | Qué fija |
 * |---|---|
 * | 1 | `panel` (sesión) y `aggregates` (token) dan el MISMO cuerpo para la misma pantalla y periodo |
 * | 3 | token `marketing-reader` en `panel`, `periods` y `tokens` ⇒ 401; sesión `vault_operator` CON fila `marketing_read` en `tokens` ⇒ 403 (y en `panel` ⇒ 200) |
 * | 4 | emitir ⇒ `aggregates` 200 con ese token ⇒ revocar ⇒ `aggregates` 401, mismo proceso |
 * | 5 | `GET …/tokens`, `…/revoke` y la fila de `AuditLog` sin `token`/`tokenHash` |
 * | 7 | `GET …/panel` deja una fila `MarketingAccessLog` con `actorUserId` y `filters.surface='panel'` |
 */
import { Permission } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

jest.setTimeout(60_000);

function allKeys(v: unknown, acc: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => allKeys(x, acc));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (acc.push(k), allKeys(x, acc));
  return acc;
}

describe('E2E — §MKT.G panel por sesión + tokens del analista', () => {
  let h: E2EHarness;
  let adminJwt: string;
  let operatorJwt: string;
  let operatorId: string;
  const tokenIds: string[] = [];
  let analystToken: string;

  beforeAll(async () => {
    h = await E2EHarness.create();
    adminJwt = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    operatorJwt = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    operatorId = (await h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.operator.email }, select: { id: true } })).id;
    // Fila explícita de marketing_read para el operador (D-MKT-PANEL-1: hoy no hay ruta que la cree).
    await h.prisma.userPermission.upsert({
      where: { userId_permission: { userId: operatorId, permission: Permission.marketing_read } },
      create: { userId: operatorId, permission: Permission.marketing_read },
      update: {},
    });
    const r = await h.api('POST', '/admin/marketing/tokens', { token: adminJwt, json: { label: 'e2e analista' } });
    expect(r.status).toBe(201);
    expect(r.headers['cache-control']).toBe('no-store');
    analystToken = r.body.token;
    tokenIds.push(r.body.id);
  }, 180_000);

  afterAll(async () => {
    if (!h) return;
    await h.prisma.userPermission.deleteMany({ where: { userId: operatorId, permission: Permission.marketing_read } });
    await h.prisma.marketingAccessLog.deleteMany({ where: { tokenId: { in: tokenIds } } });
    await h.prisma.auditLog.deleteMany({ where: { entityType: 'MarketingApiToken', entityId: { in: tokenIds } } });
    await h.prisma.marketingApiToken.deleteMany({ where: { id: { in: tokenIds } } });
    await h.close();
  });

  it('(1) panel = aggregates para cada pantalla, mes cerrado fijo; no-store', async () => {
    // Un mes cerrado seguro: dos meses antes del mes en curso.
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - 2);
    const month = d.toISOString().slice(0, 7);
    for (const s of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const viaSesion = await h.api('GET', `/admin/marketing/panel?pantalla=${s}&month=${month}`, { token: adminJwt });
      const viaToken = await h.api('GET', `/admin/marketing/aggregates?pantalla=${s}&month=${month}`, { token: analystToken });
      expect([s, viaSesion.status, viaToken.status]).toEqual([s, 200, 200]);
      expect(viaSesion.headers['cache-control']).toBe('no-store');
      expect(viaSesion.body).toEqual(viaToken.body);
    }
  });

  it('(3) token marketing-reader en panel, periods y tokens ⇒ 401', async () => {
    for (const [m, p] of [
      ['GET', '/admin/marketing/panel?pantalla=a'],
      ['GET', '/admin/marketing/periods'],
      ['GET', '/admin/marketing/tokens'],
      ['POST', '/admin/marketing/tokens'],
      ['POST', `/admin/marketing/tokens/${tokenIds[0]}/revoke`],
    ] as const) {
      const r = await h.api(m, p, { token: analystToken, json: m === 'POST' ? { label: 'x' } : undefined });
      expect([m, p, r.status]).toEqual([m, p, 401]);
    }
  });

  it('(3) vault_operator CON marketing_read: tokens ⇒ 403; panel y periods ⇒ 200', async () => {
    for (const [m, p] of [
      ['GET', '/admin/marketing/tokens'],
      ['POST', '/admin/marketing/tokens'],
      ['POST', `/admin/marketing/tokens/${tokenIds[0]}/revoke`],
    ] as const) {
      const r = await h.api(m, p, { token: operatorJwt, json: m === 'POST' ? { label: 'x' } : undefined });
      expect([m, p, r.status]).toEqual([m, p, 403]);
    }
    expect((await h.api('GET', '/admin/marketing/panel?pantalla=h', { token: operatorJwt })).status).toBe(200);
    expect((await h.api('GET', '/admin/marketing/periods', { token: operatorJwt })).status).toBe(200);
  });

  it('(7) cada GET …/panel deja una fila MarketingAccessLog con actorUserId y surface=panel', async () => {
    const adminId = (await h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.admin.email }, select: { id: true } })).id;
    const before = new Date();
    const r = await h.api('GET', '/admin/marketing/panel?pantalla=f', { token: adminJwt });
    expect(r.status).toBe(200);
    const rows = await h.prisma.marketingAccessLog.findMany({ where: { actorUserId: adminId, screen: 'f', at: { gte: before } } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tokenId: null, format: 'json', filters: expect.objectContaining({ surface: 'panel', kind: 'week' }) });
    await h.prisma.marketingAccessLog.deleteMany({ where: { id: rows[0].id } });
  });

  it('(4)(5) emitir ⇒ aggregates 200 ⇒ revocar ⇒ aggregates 401; nada lleva token/tokenHash', async () => {
    const issued = await h.api('POST', '/admin/marketing/tokens', { token: adminJwt, json: { label: 'e2e rotacion' } });
    expect(issued.status).toBe(201);
    tokenIds.push(issued.body.id);
    const t = issued.body.token as string;

    expect((await h.api('GET', '/admin/marketing/aggregates?pantalla=h', { token: t })).status).toBe(200);
    const rev = await h.api('POST', `/admin/marketing/tokens/${issued.body.id}/revoke`, { token: adminJwt });
    expect(rev.status).toBe(200);
    expect(rev.body.status).toBe('revoked');
    expect((await h.api('GET', '/admin/marketing/aggregates?pantalla=h', { token: t })).status).toBe(401);

    const again = await h.api('POST', `/admin/marketing/tokens/${issued.body.id}/revoke`, { token: adminJwt });
    expect(again.status).toBe(200);
    expect(again.body.revokedAt).toBe(rev.body.revokedAt);

    const list = await h.api('GET', '/admin/marketing/tokens', { token: adminJwt });
    expect(list.status).toBe(200);
    const audit = await h.prisma.auditLog.findMany({ where: { entityType: 'MarketingApiToken', entityId: issued.body.id } });
    expect(audit.map((a) => a.action).sort()).toEqual(['marketing.token.issue', 'marketing.token.revoke']);
    for (const json of [list.body, rev.body, again.body, audit]) {
      const keys = allKeys(JSON.parse(JSON.stringify(json)));
      expect(keys).not.toContain('token');
      expect(keys).not.toContain('tokenHash');
      expect(JSON.stringify(json)).not.toContain(t);
    }
    expect((await h.api('POST', '/admin/marketing/tokens/00000000-0000-0000-0000-000000000000/revoke', { token: adminJwt })).status).toBe(404);
  });
});

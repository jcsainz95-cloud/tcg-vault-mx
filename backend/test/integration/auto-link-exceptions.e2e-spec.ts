/**
 * auto-link-exceptions.e2e-spec.ts — 💰 §AUTO-ENLACE fase 3 contra Postgres REAL y la app por HTTP. Propiedad: backend.
 *  GET /admin/catalog/link-exceptions (motivo, candidatos mejor primero, canConfirm, nextAttemptAt, solo lectura local) y
 *  POST …/confirm (persiste `confirmed`, liga y precia en la misma llamada, auditoría, 429, 422, 404, fallo del proveedor ⇒ no persiste nada;
 *  el job y la regla automática respetan la confirmación; si el grupo confirmado desaparece ⇒ group_none).
 */
import { randomUUID } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { CatalogAutoLinkService } from '../../src/modules/catalog/catalog-auto-link.service';
import { TcgcsvCatalogClient } from '../../src/modules/pricing/providers/tcgcsv-singles.provider';
import { FxService } from '../../src/modules/pricing/fx.service';

jest.setTimeout(180_000);

describe('E2E — §AUTO-ENLACE fase 3 link-exceptions + confirm', () => {
  let h: E2EHarness;
  let admin: string;
  let operator: string;
  let job: CatalogAutoLinkService;
  const run = randomUUID().slice(0, 8);
  const setIds: string[] = [];
  const cardIds: string[] = [];
  const failing = new Set<number>();
  // Grupos sintéticos 920001..920003: 3 productos «Carta <g>-<n>» con número n.
  const G1 = 920001;
  const G2 = 920002;
  const G3 = 920003;
  let groupsList: { groupId: number; name: string; publishedOn?: string }[] = [];
  const synth = (g: number) => [1, 2, 3].map((n) => ({ productId: g * 10 + n, name: `Carta ${g}-${n}`, number: String(n) }));

  async function mkSet(tag: string, name: string, pptSetId: string | null, cardGroup: number | null, n = 3, prefix: number = G1): Promise<string> {
    const s = await h.prisma.cardSet.create({ data: { externalId: `ax-${tag}-${run}`, name, pptSetId, releaseDate: '2020/01/01', ...(cardGroup ? { cardGroupId: cardGroup, cardGroupVia: 'confirmed' } : {}) } });
    setIds.push(s.id);
    for (let i = 1; i <= n; i++) {
      const c = await h.prisma.card.create({ data: { externalId: `ax-${tag}-${run}-${i}`, setId: s.id, name: `Carta ${prefix}-${i}`, number: String(i), availableFinishes: ['normal'] } });
      cardIds.push(c.id);
    }
    return s.id;
  }
  const clear = async () => h.prisma.auditLog.deleteMany({ where: { action: { in: ['catalog.auto_link_claim', 'catalog.auto_link', 'catalog.auto_link_run', 'catalog.link_repair', 'catalog.group_confirm_claim', 'catalog.group_confirmed'] } } });
  const list = async () => (await h.api<{ summary: Record<string, unknown>; sets: any[] }>('GET', '/admin/catalog/link-exceptions', { token: admin }));
  const confirm = (setId: string, groupId: unknown, token = admin) => h.api<any>('POST', `/admin/catalog/link-exceptions/${setId}/confirm`, { token, json: { groupId } });

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    operator = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    job = h.app.get(CatalogAutoLinkService);
    const client = h.app.get(TcgcsvCatalogClient);
    jest.spyOn(client, 'listGroups').mockImplementation(async () => groupsList as never);
    jest.spyOn(client, 'getProducts').mockImplementation(async (g: number) => {
      if (failing.has(g)) throw new Error('boom 503 secret-detail');
      return g >= G1 && g <= G3 ? synth(g) : [];
    });
    jest.spyOn(client, 'getPrices').mockImplementation(async (g: number) => (g >= G1 && g <= G3 ? (synth(g).map((p) => ({ productId: p.productId, subTypeName: 'Normal', marketPrice: 2 })) as never) : []));
    jest.spyOn(h.app.get(FxService), 'getCurrent').mockResolvedValue({ rate: 18, bufferPct: 0, source: 'banxico', effectiveDate: '2026-11-25' } as never);
    await clear();
  });

  afterAll(async () => {
    if (h) {
      const inSets = (await h.prisma.card.findMany({ where: { setId: { in: setIds } }, select: { id: true } })).map((c) => c.id);
      cardIds.push(...inSets.filter((id) => !cardIds.includes(id)));
      await h.prisma.priceReference.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.cardProduct.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.card.deleteMany({ where: { id: { in: cardIds } } });
      await h.prisma.cardSet.deleteMany({ where: { id: { in: setIds } } });
      await clear();
      await h.close();
    }
  });

  it('GET: solo super_admin; motivo group_ambiguous con candidatos (mejor primero), canConfirm, nextAttemptAt y summary; 0 llamadas a proveedores', async () => {
    const name = `Exc Alfa ${run}`;
    groupsList = [{ groupId: G1, name, publishedOn: '2020-01-05T00:00:00' }, { groupId: G2, name, publishedOn: '2020-02-05T00:00:00' }, { groupId: G3, name: `Exc Alfa ${run} Extra` }];
    const sid = await mkSet('A', name, null, null);
    const f = (await h.api('GET', '/admin/catalog/link-exceptions', { token: operator })).status;
    expect(f).toBe(403);
    const r = await job.run({ retryDelayMs: 0 }); // el job intenta, no resuelve (empate real) y deja motivo + candidatos
    expect(r.sets.find((s) => s.setId === sid)).toMatchObject({ linked: 0, reason: 'group_ambiguous' });
    const calls = (h.app.get(TcgcsvCatalogClient).listGroups as jest.Mock).mock.calls.length;
    const res = await list();
    expect((h.app.get(TcgcsvCatalogClient).listGroups as jest.Mock).mock.calls.length).toBe(calls); // solo lectura local
    expect(res.status).toBe(200);
    const mine = res.body.sets.find((s) => s.setId === sid);
    expect(mine).toMatchObject({ reason: 'group_ambiguous', canConfirm: true, unlinked: 3, total: 3, tries: 1 });
    expect(mine.candidates.length).toBeGreaterThanOrEqual(2);
    expect(mine.candidates.length).toBeLessThanOrEqual(5);
    expect(mine.candidates.map((c: any) => c.score)).toEqual([...mine.candidates.map((c: any) => c.score)].sort((a: number, b: number) => b - a));
    expect(mine.candidates[0]).toMatchObject({ groupId: G1, name });
    expect(Date.parse(mine.nextAttemptAt)).toBeGreaterThan(Date.now());
    expect(mine.lastAttemptAt).toEqual(expect.any(String));
    expect(res.body.summary).toMatchObject({ autoLinkEnabled: true, waitingDecision: 0 });
    expect(JSON.stringify(res.body)).not.toMatch(/token|secret|password/i);
  });

  it('POST confirm: persiste `confirmed`, liga y precia en la misma llamada, audita, el job la respeta; repetir = 429; 2.ª tras el cupo = idempotente (0 escrituras)', async () => {
    const sid = (await h.prisma.cardSet.findFirstOrThrow({ where: { externalId: `ax-A-${run}` } })).id;
    expect((await confirm(sid, G1, operator)).status).toBe(403);
    const r = await confirm(sid, G1);
    expect([r.status, JSON.stringify(r.body)]).toEqual([200, expect.anything()]);
    expect(r.body).toMatchObject({ setId: sid, groupUsed: { groupId: G1, name: `Exc Alfa ${run}`, via: 'confirmed' }, linked: 3, priced: 3, collisions: 0, conflicts: 0 });
    const row = await h.prisma.cardSet.findUniqueOrThrow({ where: { id: sid }, select: { cardGroupId: true, cardGroupVia: true } });
    expect(row).toEqual({ cardGroupId: G1, cardGroupVia: 'confirmed' });
    expect(await h.prisma.card.count({ where: { setId: sid, cardProducts: { none: {} } } })).toBe(0);
    const au = await h.prisma.auditLog.findFirstOrThrow({ where: { action: 'catalog.group_confirmed', entityId: sid } });
    expect(au.actorUserId).not.toBeNull();
    expect(au.before).toEqual({ groupId: null, via: null });
    expect(au.after).toMatchObject({ groupId: G1, via: 'confirmed', linked: 3 });
    expect((await confirm(sid, G1)).status).toBe(429);
    await h.prisma.auditLog.deleteMany({ where: { action: 'catalog.group_confirm_claim', entityId: sid } });
    const snap = JSON.stringify(await h.prisma.priceReference.findMany({ where: { card: { setId: sid } }, orderBy: { id: 'asc' } }));
    const again = await confirm(sid, G1);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ linked: 0 });
    expect(JSON.stringify(await h.prisma.priceReference.findMany({ where: { card: { setId: sid } }, orderBy: { id: 'asc' } }))).toBe(snap);
    // Ya sin cartas sin ligar ⇒ sale de la lista.
    expect((await list()).body.sets.some((s) => s.setId === sid)).toBe(false);
  });

  it('el job NO pisa un grupo confirmado: pptSetId apunta a G3 pero manda el confirmado G2; la columna sigue `confirmed`', async () => {
    await clear();
    const sid = await mkSet('B', `Exc Beta ${run}`, String(G3), G2, 3, G2);
    const r = await job.run({ retryDelayMs: 0 });
    expect(r.sets.find((s) => s.setId === sid)).toMatchObject({ linked: 3 });
    const cps = await h.prisma.cardProduct.findMany({ where: { card: { setId: sid } }, select: { tcgplayerProductId: true } });
    expect(cps.map((c) => c.tcgplayerProductId).sort()).toEqual(synth(G2).map((p) => p.productId).sort());
    expect(await h.prisma.cardSet.findUniqueOrThrow({ where: { id: sid }, select: { cardGroupId: true, cardGroupVia: true } })).toEqual({ cardGroupId: G2, cardGroupVia: 'confirmed' });
  });

  it('el grupo `auto` se guarda informativo al ligar por regla y se recalcula (no manda); idempotente', async () => {
    await clear();
    const sid = await mkSet('C', `Exc Gamma ${run}`, String(G3), null, 3, G3);
    const r = await job.run({ retryDelayMs: 0 });
    expect(r.sets.find((s) => s.setId === sid)).toMatchObject({ linked: 3 });
    expect(await h.prisma.cardSet.findUniqueOrThrow({ where: { id: sid }, select: { cardGroupId: true, cardGroupVia: true } })).toEqual({ cardGroupId: G3, cardGroupVia: 'auto' });
  });

  it('confirm: 404 set, 400 uuid inválido, 422 GROUP_NOT_FOUND (no persiste), 400 groupId no entero', async () => {
    await clear();
    const sid = await mkSet('D', `Exc Delta ${run}`, null, null);
    expect((await confirm(randomUUID(), G1)).status).toBe(404);
    expect((await confirm('no-uuid', G1)).status).toBe(400);
    const nf = await confirm(sid, 999_999_991);
    expect(nf.status).toBe(422);
    expect(nf.body.code ?? nf.body.error?.code).toBe('GROUP_NOT_FOUND');
    expect([400, 422]).toContain((await confirm(sid, 'x')).status);
    expect([400, 422]).toContain((await confirm(sid, 1.5)).status);
    expect(await h.prisma.cardSet.findUniqueOrThrow({ where: { id: sid }, select: { cardGroupId: true, cardGroupVia: true } })).toEqual({ cardGroupId: null, cardGroupVia: null });
    expect(await h.prisma.auditLog.count({ where: { action: 'catalog.group_confirmed', entityId: sid } })).toBe(0);
  });

  it('fallo del proveedor al ligar ⇒ 503 UPSTREAM_ERROR con mensaje fijo, NO persiste el grupo, devuelve el cupo (reintento inmediato posible)', async () => {
    await clear();
    const sid = await mkSet('E', `Exc Epsilon ${run}`, null, null, 3, G1);
    failing.add(G1);
    const bad = await confirm(sid, G1);
    expect(bad.status).toBe(503);
    expect(JSON.stringify(bad.body)).not.toMatch(/secret-detail|boom/);
    expect(await h.prisma.cardSet.findUniqueOrThrow({ where: { id: sid }, select: { cardGroupId: true, cardGroupVia: true } })).toEqual({ cardGroupId: null, cardGroupVia: null });
    expect(await h.prisma.auditLog.count({ where: { action: 'catalog.group_confirmed', entityId: sid } })).toBe(0);
    failing.clear();
    expect((await confirm(sid, G1)).status).toBe(200);
  });

  it('si el grupo confirmado deja de existir en listGroups ⇒ reason `group_none` y vuelve a la lista (sin caer a otra fuente)', async () => {
    await clear();
    const sid = await mkSet('F', `Exc Zeta ${run}`, String(G2), 999_999_777, 3, G2);
    const r = await job.run({ retryDelayMs: 0 });
    expect(r.sets.find((s) => s.setId === sid)).toMatchObject({ linked: 0, reason: 'group_none' });
    const mine = (await list()).body.sets.find((s) => s.setId === sid);
    expect(mine).toMatchObject({ reason: 'group_none', canConfirm: true });
  });

  it('motivos sin botón: promo_route (dpp) y not_in_provider (Futsal) salen en la lista; Futsal no cuenta en unlinkedCards; sin intentos', async () => {
    await clear();
    const before = (await list()).body.summary.unlinkedCards as number;
    const fut = await h.prisma.cardSet.create({ data: { externalId: `fut-${run}`, name: `Pokémon Futsal Collection ${run}` } });
    setIds.push(fut.id);
    const c = await h.prisma.card.create({ data: { externalId: `fut-${run}-1`, setId: fut.id, name: 'Futsal Pikachu', number: '1', availableFinishes: ['normal'] } });
    cardIds.push(c.id);
    const res = await list();
    const row = res.body.sets.find((s) => s.setId === fut.id);
    expect(row).toMatchObject({ reason: 'not_in_provider', canConfirm: false, nextAttemptAt: null });
    expect(res.body.summary.unlinkedCards).toBe(before); // no cuenta
  });
});

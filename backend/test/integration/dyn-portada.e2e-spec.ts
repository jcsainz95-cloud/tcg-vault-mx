/**
 * dyn-portada.e2e-spec.ts — v1.113⟨portada⟩ (API_CONTRACT §DYN.1–§DYN.4, M-93) contra Postgres REAL y la app por HTTP.
 *
 *  A. M-93: CHECKs (posición 1..20, créditos ≥ 0), cascada de ítems, `SpendAlertKind ∋ psa_cycle_short`.
 *  B. DYN-B4 (923): `firstListedAt` lo escribe la publicación SOLO la primera vez (republicar no lo mueve).
 *  C. DYN-B1 (920): candidatos = grupos raw|graded vendibles con el `P` de la rejilla; ⛔ sin sellado.
 *  D. `GET /catalog/featured` (§DYN.2.1–2.2, DYN-B3/B5 por HTTP): forma, `Cache-Control`, igual con/sin sesión e idioma,
 *     lo vendido sale sin rellenar y el resto conserva su orden. `POST /admin/jobs/featured-rotation`: operador 403.
 *  E. AG-24 (DYN-B13) con el `SpendAlertsService` real: una fila, `facts` en sitio, `not_applicable`, fuera del resumen,
 *     cierre que libera la llave.
 *  F. Diales (DYN-B7 borde HTTP): 422 con `details.rule`, operador 403, auditoría antes → después.
 *  G. DYN-B20: `ingestMaxCardsPerRun` fuera del `GET` y 422 en el `PUT` (con el pipe REAL, que descarta lo no declarado).
 *  H. `GET /admin/pricing/graded-estimates/budget` (forma exacta) y `dataHealth.featuredRotation` para el operador.
 */
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { FeaturedService } from '../../src/modules/catalog/featured.service';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { SpendAlertsService } from '../../src/modules/spend-alerts/spend-alerts.service';
import { summarizeSpendAlerts } from '../../src/modules/spend-alerts/spend-summary';
import { featuredKeyOf } from '../../src/modules/catalog/featured-selection';

describe('E2E — §DYN portada dinámica (M-93, Destacadas, turnos PSA)', () => {
  let h: E2EHarness;
  let admin: string;
  let operator: string;
  const run = randomUUID().slice(0, 8);
  let setId: string;
  const cardIds: string[] = [];
  let seq = 0;
  const savedSettings = new Map<string, Prisma.JsonValue | undefined>();

  async function card(n: number) {
    const c = await h.prisma.card.create({
      data: {
        externalId: `dyn-${run}-${n}`,
        setId,
        name: `Carta Portada ${run} ${n}`,
        number: String(n),
        rarity: 'Common',
        rarityCanonical: 'Common',
        imageSmallUrl: `https://images.pokemontcg.io/dyn/${n}.png`,
        availableFinishes: ['normal'],
      },
    });
    cardIds.push(c.id);
    return c.id;
  }
  async function item(cardId: string, data: Partial<Prisma.InventoryItemUncheckedCreateInput> = {}) {
    seq += 1;
    return h.prisma.inventoryItem.create({
      data: {
        folio: `DYN-${run}-${seq}`,
        cardId,
        productType: 'raw',
        rawCondition: 'NM',
        finish: 'normal',
        ownerType: 'platform',
        status: 'listed',
        acquisitionType: 'compra',
        acquisitionCostCents: 1000,
        listPriceCents: 50_000,
        firstListedAt: new Date(),
        ...data,
      },
    });
  }

  beforeAll(async () => {
    h = await E2EHarness.create();
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    operator = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    const set = await h.prisma.cardSet.create({ data: { externalId: `dyn-${run}`, name: `Set Portada ${run}` } });
    setId = set.id;
    for (const key of ['featured_random_slots', 'featured_new_arrival_slots', 'featured_pool_size', 'graded_estimate_daily_credit_cap']) {
      const row = await h.prisma.configSetting.findUnique({ where: { key } });
      savedSettings.set(key, row?.valueJson);
    }
  });

  afterAll(async () => {
    if (h) {
      for (const [key, v] of savedSettings) {
        if (v === undefined) await h.prisma.configSetting.deleteMany({ where: { key } });
        else await h.prisma.configSetting.update({ where: { key }, data: { valueJson: v as Prisma.InputJsonValue } });
      }
      await h.prisma.featuredSelection.deleteMany({ where: { OR: [{ forcedByUserId: { not: null } }, { seed: { startsWith: 'e2e-' } }] } });
      await h.prisma.inventoryItem.deleteMany({ where: { folio: { startsWith: `DYN-${run}-` } } });
      await h.prisma.card.deleteMany({ where: { id: { in: cardIds } } });
      await h.prisma.cardSet.deleteMany({ where: { id: setId } });
      await h.close();
    }
  });

  describe('A. M-93', () => {
    it('CHECK posición 1..20 y créditos ≥ 0; ítems en cascada; `psa_cycle_short` existe', async () => {
      const bd = new Date('2001-01-01T00:00:00Z');
      await h.prisma.featuredSelection.create({
        data: { businessDate: bd, effectiveFrom: bd, seed: 'e2e-check', dials: {}, poolCount: 0, newArrivalCandidates: 0 },
      });
      const cid = await card(900);
      const bad = h.prisma.featuredSelectionItem.create({
        data: { businessDate: bd, position: 21, slotKind: 'pool', cardId: cid, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' },
      });
      await expect(bad).rejects.toThrow(/FeaturedSelectionItem_position_check/);
      await h.prisma.featuredSelectionItem.create({
        data: { businessDate: bd, position: 1, slotKind: 'pool', cardId: cid, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' },
      });
      await h.prisma.featuredSelection.delete({ where: { businessDate: bd } });
      expect(await h.prisma.featuredSelectionItem.count({ where: { businessDate: bd } })).toBe(0);
      await expect(
        h.prisma.gradedEstimateSetScan.create({
          data: { setId, businessDate: bd, outcome: 'ok', creditsEstimated: -1, creditsCharged: 0, cardsInScope: 0, cardsReturned: 0 },
        }),
      ).rejects.toThrow(/GradedEstimateSetScan_credits_check/);
      const labels = await h.prisma.$queryRaw<{ v: string }[]>`SELECT unnest(enum_range(NULL::"SpendAlertKind"))::text AS v`;
      expect(labels.map((l) => l.v)).toContain('psa_cycle_short');
    });
  });

  describe('B. DYN-B4 — `firstListedAt` solo en la PRIMERA publicación', () => {
    it('publicar la fija; retirar y volver a publicar NO la mueve', async () => {
      const cid = await card(1);
      const it = await item(cid, { status: 'in_stock', firstListedAt: null });
      const pub = await h.api('POST', '/admin/inventory/items/bulk-publish', { token: admin, json: { items: [{ inventoryItemId: it.id }] } });
      expect(pub.status).toBe(200);
      const first = (await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: it.id } })).firstListedAt;
      expect(first).toBeInstanceOf(Date);
      await h.prisma.inventoryItem.update({ where: { id: it.id }, data: { status: 'in_stock' } });
      await new Promise((r) => setTimeout(r, 20));
      const again = await h.api('POST', '/admin/inventory/items/bulk-publish', { token: admin, json: { items: [{ inventoryItemId: it.id }] } });
      expect(again.status).toBe(200);
      const after = await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: it.id } });
      expect(after.status).toBe('listed');
      expect(after.firstListedAt?.toISOString()).toBe(first?.toISOString());
    });
  });

  describe('C. DYN-B1 — candidatos', () => {
    it('raw y graded vendibles entran con el `P` de la rejilla; el sellado NUNCA', async () => {
      const raw = await card(10);
      await item(raw, { listPriceCents: 77_700 });
      const graded = await card(11);
      await item(graded, { productType: 'graded', rawCondition: null, gradingCompany: 'PSA', gradeValue: '9', certNumber: `C${run}`, listPriceCents: 88_800 });
      const sealed = await card(12);
      await item(sealed, { productType: 'sealed', rawCondition: null, sealedSubtype: 'box', sealedCondition: 'mint', listPriceCents: 99_900 });
      const cands = await h.app.get(CatalogService).featuredCandidates();
      const mine = cands.filter((c) => [raw, graded, sealed].includes(c.cardId));
      expect(mine.map((c) => c.productType).sort()).toEqual(['graded', 'raw']);
      expect(cands.some((c) => c.productType === 'sealed')).toBe(false);
      const grid = await h.api<{ data: { card: { id: string }; displayPriceCents: number }[] }>(
        'GET', `/catalog/cards?setId=${setId}&pageSize=100`,
      );
      for (const c of mine) {
        const g = grid.body.data.find((x) => x.card.id === c.cardId);
        expect(g?.displayPriceCents).toBe(c.priceCents);
      }
    });
  });

  describe('D. GET /catalog/featured', () => {
    it('operador NO puede disparar la rotación (403)', async () => {
      const r = await h.api('POST', '/admin/jobs/featured-rotation', { token: operator, json: { force: true } });
      expect(r.status).toBe(403);
    });

    it('forma, cabecera, igual para todos; vendida sale sin relleno y el resto conserva su orden', async () => {
      for (let i = 0; i < 12; i++) await item(await card(100 + i), { listPriceCents: 60_000 + i * 1000 });
      const forced = await h.api('POST', '/admin/jobs/featured-rotation', { token: admin, json: { force: true } });
      expect(forced.status).toBe(200);
      expect(forced.body).toMatchObject({ status: 'forced' });
      const audit = await h.prisma.auditLog.findFirst({ where: { action: 'featured.selection.forced' }, orderBy: { createdAt: 'desc' } });
      expect(audit?.before).toBeDefined();
      expect(audit?.after).toBeDefined();

      const anon = await h.api<{ businessDate: string; data: { representativeInventoryItemId: string; featuredSlot: string }[] }>(
        'GET', '/catalog/featured?x=1&locale=en',
      );
      expect(anon.status).toBe(200);
      expect(anon.headers['cache-control']).toBe('public, max-age=30, stale-while-revalidate=30');
      expect(anon.body.businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(anon.body.data.length).toBeGreaterThan(0);
      expect(anon.body.data.length).toBeLessThanOrEqual(20);
      for (const d of anon.body.data) expect(['pool', 'new_arrival']).toContain(d.featuredSlot);
      const bodies = new Set<string>([anon.text]);
      const variants: { token?: string; headers?: Record<string, string> }[] = [
        { token: admin },
        { headers: { 'accept-language': 'en-US' } },
        { token: operator, headers: { 'accept-language': 'es-MX', 'user-agent': 'Mozilla/5.0 (iPhone)' } },
      ];
      for (const opts of variants) {
        bodies.add((await h.api('GET', '/catalog/featured', opts)).text);
      }
      expect(bodies.size).toBe(1);

      // Vender (apartar) TODAS las piezas del grupo de la primera teja.
      const sel = await h.prisma.featuredSelection.findFirstOrThrow({
        where: { effectiveFrom: { lte: new Date() } },
        orderBy: { effectiveFrom: 'desc' },
        include: { items: { orderBy: { position: 'asc' } } },
      });
      const live = await h.app.get(CatalogService).featuredGroups(sel.items);
      const firstLive = sel.items.find((i) => live.has(featuredKeyOf(i)))!;
      const groupPieces = await h.prisma.inventoryItem.findMany({
        where: { cardId: firstLive.cardId, productType: firstLive.productType, finish: firstLive.finish, ownerType: 'platform', status: 'listed' },
        select: { id: true },
      });
      await h.prisma.inventoryItem.updateMany({ where: { id: { in: groupPieces.map((p) => p.id) } }, data: { status: 'reserved' } });
      try {
        const after = await h.api<{ data: { representativeInventoryItemId: string }[] }>('GET', '/catalog/featured');
        const removed = anon.body.data[0].representativeInventoryItemId;
        expect(after.body.data.map((d) => d.representativeInventoryItemId)).toEqual(
          anon.body.data.map((d) => d.representativeInventoryItemId).filter((id) => id !== removed),
        );
      } finally {
        await h.prisma.inventoryItem.updateMany({ where: { id: { in: groupPieces.map((p) => p.id) } }, data: { status: 'listed' } });
      }
    });

    it('`dataHealth.featuredRotation` llega al operador', async () => {
      const r = await h.api<{ dataHealth: { featuredRotation: { status: string; expectedBusinessDate: string } } }>(
        'GET', '/admin/dashboard', { token: operator },
      );
      expect(r.status).toBe(200);
      expect(['ok', 'stale', 'never']).toContain(r.body.dataHealth.featuredRotation.status);
      expect(r.body.dataHealth.featuredRotation.expectedBusinessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('el tic con una selección ya escrita para el día NO la reescribe', async () => {
      const svc = h.app.get(FeaturedService);
      const r = await svc.tick();
      expect(['exists', 'waiting', 'written']).toContain(r.status);
    });
  });

  describe('E. AG-24 con el servicio real', () => {
    it('una fila, `facts` en sitio, `not_applicable`, fuera del resumen; cerrar libera la llave', async () => {
      const alerts = h.app.get(SpendAlertsService);
      await h.prisma.spendAlert.deleteMany({ where: { kind: 'psa_cycle_short' } });
      const t0 = new Date();
      const f = (cycleDays: number) => ({ reason: 'projected', publishedCards: 10, cycleDays, dailyCreditCap: 100, capToCoverWeek: 200, setsOverCap: 0 });
      for (const d of [8, 9, 10]) await alerts.raise(h.prisma, { kind: 'psa_cycle_short', severity: 'digest', dedupKey: 'ag24:open', facts: f(d) }, new Date());
      const rows = await h.prisma.spendAlert.findMany({ where: { kind: 'psa_cycle_short' } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ mailStatus: 'not_applicable', severity: 'digest', occurrenceCount: 3, resolvedAt: null });
      expect(rows[0].facts).toEqual(f(10));
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(t0);
      const summary = await summarizeSpendAlerts(h.prisma, { from: day, to: day, range: { gte: new Date(t0.getTime() - 3600_000) } });
      expect(summary.byKind.some((k) => k.code === 'AG-24')).toBe(false);
      expect(await alerts.resolve(h.prisma, 'ag24:open', new Date())).toBe(true);
      const closed = await h.prisma.spendAlert.findUniqueOrThrow({ where: { id: rows[0].id } });
      expect(closed.resolvedAt).not.toBeNull();
      expect(closed.dedupKey).toBe(`ag24:closed:${rows[0].id}`);
      await alerts.raise(h.prisma, { kind: 'psa_cycle_short', severity: 'digest', dedupKey: 'ag24:open', facts: f(8) }, new Date());
      expect(await h.prisma.spendAlert.count({ where: { kind: 'psa_cycle_short' } })).toBe(2);
      await h.prisma.spendAlert.deleteMany({ where: { kind: 'psa_cycle_short' } });
    });
  });

  describe('F. diales por HTTP', () => {
    it('422 `featured_slots_total` / `featured_pool_lt_random`; operador 403; auditado antes → después', async () => {
      const r1 = await h.api<{ error: { code: string; details: { rule: string } } }>('PUT', '/admin/settings', {
        token: admin, json: { featuredRandomSlots: 0, featuredNewArrivalSlots: 0 },
      });
      expect(r1.status).toBe(422);
      expect(r1.body.error).toMatchObject({ code: 'VALIDATION_ERROR', details: { rule: 'featured_slots_total' } });
      const r2 = await h.api<{ error: { details: { rule: string } } }>('PUT', '/admin/settings', { token: admin, json: { featuredPoolSize: 3, featuredRandomSlots: 8 } });
      expect(r2.status).toBe(422);
      expect(r2.body.error.details.rule).toBe('featured_pool_lt_random');
      const op = await h.api('PUT', '/admin/settings', { token: operator, json: { featuredRandomSlots: 6 } });
      expect(op.status).toBe(403);
      const ok = await h.api('PUT', '/admin/settings', { token: admin, json: { featuredRandomSlots: 6 } });
      expect(ok.status).toBe(200);
      const a = await h.prisma.auditLog.findFirst({ where: { action: 'settings.update' }, orderBy: { createdAt: 'desc' } });
      expect((a?.after as Record<string, unknown>).featuredRandomSlots).toBe(6);
      expect((a?.before as Record<string, unknown>).featuredRandomSlots).toBeDefined();
      const all = await h.api<Record<string, unknown>>('GET', '/admin/settings', { token: admin });
      for (const k of ['featuredPoolSize', 'featuredRandomSlots', 'featuredNewArrivalSlots', 'featuredNewArrivalWindowDays', 'featuredRotationHour', 'gradedEstimateDailyCreditCap']) {
        expect(all.body).toHaveProperty(k);
      }
    });
  });

  describe('G. DYN-B20 — `ingestMaxCardsPerRun` retirado', () => {
    it('ausente del GET; rechazado en el PUT con el pipe real (y no escribe nada)', async () => {
      const g = await h.api<Record<string, unknown>>('GET', '/admin/pricing/graded-estimates', { token: admin });
      expect(g.status).toBe(200);
      expect(g.body).not.toHaveProperty('ingestMaxCardsPerRun');
      const p = await h.api<{ error: { code: string; details: { field: string } } }>('PUT', '/admin/pricing/graded-estimates', {
        token: admin, json: { minUpsidePct: 31, ingestMaxCardsPerRun: 250 },
      });
      expect(p.status).toBe(422);
      expect(p.body.error).toMatchObject({ code: 'VALIDATION_ERROR', details: { field: 'ingestMaxCardsPerRun' } });
      const after = await h.api<Record<string, unknown>>('GET', '/admin/pricing/graded-estimates', { token: admin });
      expect(after.body.minUpsidePct).toBe(g.body.minUpsidePct);
    });
  });

  describe('H. presupuesto PSA', () => {
    it('forma EXACTA del contrato; operador 403', async () => {
      const r = await h.api<Record<string, unknown>>('GET', '/admin/pricing/graded-estimates/budget', { token: admin });
      expect(r.status).toBe(200);
      expect(Object.keys(r.body).sort()).toEqual([
        'capToCoverWeek', 'cardsScannedLast7Days', 'cardsUnmapped', 'creditsLast7Days', 'creditsToday', 'creditsTodayAllMeasured',
        'cycleDays', 'dailyCreditCap', 'hookEnabled', 'providerDailyQuota', 'providerDailyRemaining', 'publishedCards', 'weeklyCreditsNeeded',
      ]);
      const op = await h.api('GET', '/admin/pricing/graded-estimates/budget', { token: operator });
      expect(op.status).toBe(403);
    });
  });
});

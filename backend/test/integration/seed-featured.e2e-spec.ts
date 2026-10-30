/**
 * seed-featured.e2e-spec.ts — el seed E2E deja Destacadas VIGENTES (`GET /catalog/featured` con datos) sin esperar al primer tic
 * de `featured-rotation` (hasta 15 min, medido por frontend: `data: []` en un stack recién sembrado; tenía que forzarlo con
 * `POST /admin/jobs/featured-rotation {force:true}`). §DYN.2 no dice nada de un arranque del job, así que lo hace el seed.
 *
 *  1. Sin ninguna selección, tras sembrar: `GET /catalog/featured` trae datos, del día de portada que se sirve, y la salud
 *     dice `ok` (no `never`).
 *  2. Re-sembrar no duplica: una sola selección para ese día, la misma composición (determinista).
 *  3. Una selección CALCULADA por la app para ese día (tic o `force`) no la pisa el seed.
 *  4. El tic ve la del seed como existente (no reescribe el día); `force` la sustituye.
 *
 * Determinista (N=1): no hay reloj ni carrera; el día se lee con las mismas funciones que la app.
 */
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { seedE2E } from '../../prisma/seed-e2e';
import { FeaturedService } from '../../src/modules/catalog/featured.service';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { SettingKey } from '../../src/modules/settings/settings.constants';

describe('E2E — seed: Destacadas vigentes al sembrar (sin esperar al tic)', () => {
  let h: E2EHarness;
  let admin: string;
  let day: string;
  const dbDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
  type Featured = { businessDate: string | null; data: { representativeInventoryItemId: string; featuredSlot: string }[] };

  beforeAll(async () => {
    h = await E2EHarness.create();
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    const hour = await h.app.get(SettingsService).getNumber(SettingKey.FEATURED_ROTATION_HOUR);
    day = FeaturedService.servedDayAt(new Date(), hour);
  });

  afterAll(async () => {
    if (h) {
      // Deja el estado que deja el seed (lo que encuentra la siguiente suite o el stack).
      await h.prisma.featuredSelection.deleteMany({});
      await seedE2E(h.prisma);
      await h.close();
    }
  });

  it('sin ninguna selección, sembrar deja Destacadas con datos del día que se sirve; salud `ok`', async () => {
    await h.prisma.featuredSelection.deleteMany({});
    expect((await h.api<Featured>('GET', '/catalog/featured')).body).toEqual({ businessDate: null, data: [] });
    await seedE2E(h.prisma);
    const r = await h.api<Featured>('GET', '/catalog/featured');
    expect(r.status).toBe(200);
    expect(r.body.businessDate).toBe(day);
    expect(r.body.data.length).toBeGreaterThan(0);
    for (const d of r.body.data) expect(['pool', 'new_arrival']).toContain(d.featuredSlot);
    expect((await h.app.get(FeaturedService).health()).status).toBe('ok');
  });

  it('tester-e2e IMPORTANTE-1: recién sembrado, ≤ 10 lugares y 2 `new_arrival` (con `firstListedAt` en la ventana)', async () => {
    const r = await h.api<Featured>('GET', '/catalog/featured');
    const slots = r.body.data.map((d) => d.featuredSlot);
    expect(slots.length).toBeLessThanOrEqual(10);
    expect(slots.filter((s) => s === 'new_arrival')).toHaveLength(2);
    const sel = await h.prisma.featuredSelection.findUniqueOrThrow({ where: { businessDate: dbDate(day) }, include: { items: true } });
    expect(sel.items.length).toBeLessThanOrEqual(10);
    const lst = await h.prisma.inventoryItem.findMany({ where: { folio: { startsWith: 'E2E-LST-' } }, select: { firstListedAt: true } });
    expect(lst.filter((i) => i.firstListedAt == null)).toHaveLength(0);
  });

  it('re-sembrar no duplica y da la misma composición', async () => {
    const before = await h.prisma.featuredSelection.findMany({ include: { items: { orderBy: { position: 'asc' } } } });
    await seedE2E(h.prisma);
    const after = await h.prisma.featuredSelection.findMany({ include: { items: { orderBy: { position: 'asc' } } } });
    expect(after).toHaveLength(1);
    expect(after[0].businessDate).toEqual(dbDate(day));
    const shape = (s: typeof after) => s[0].items.map((i) => [i.position, i.slotKind, i.cardId, i.productType, i.gradeKey, i.finish]);
    expect(shape(after)).toEqual(shape(before));
  });

  it('el tic la ve como existente; `force` la sustituye y el seed ya no pisa la calculada', async () => {
    const tick = await h.app.get(FeaturedService).tick();
    if (tick.businessDate === day) expect(tick.status).toBe('exists');
    const forced = await h.api('POST', '/admin/jobs/featured-rotation', { token: admin, json: { force: true } });
    expect(forced.status).toBeLessThan(300);
    const computed = await h.prisma.featuredSelection.findUniqueOrThrow({ where: { businessDate: dbDate(day) } });
    expect(computed.forcedByUserId).not.toBeNull();
    await seedE2E(h.prisma);
    const still = await h.prisma.featuredSelection.findUniqueOrThrow({ where: { businessDate: dbDate(day) } });
    expect(still.seed).toBe(computed.seed);
    expect(still.forcedByUserId).toBe(computed.forcedByUserId);
  });
});

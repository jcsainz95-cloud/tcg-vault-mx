/**
 * §GSHOP.A (m101, docs/specs/GOOGLE_SHOPPING_E_INDEXACION.md) contra Postgres REAL: `IndexInspectionService` (job `gsc-index-inspect`) y la
 * lectura de AV7. Fuente de Google y sitemap son dobles; la BD, la migración m101 y las consultas son las reales.
 * Mutaciones que deben ponerlo rojo: quitar el presupuesto diario; no ordenar por antigüedad (NULL primero); no borrar las filas que salen del
 * sitemap; contar la racha en cada tick (sin separación de 5 días); tratar un 403 como «sin problemas»; no marcar `notifiedAt`.
 */
import { PrismaService } from '../../src/prisma/prisma.service';
import { IndexInspectionService } from '../../src/modules/marketing/index-inspection.service';
import type { UrlInspectOutcome } from '../../src/modules/marketing/marketing-external-sources';
import { GSC_INSPECT_DAILY_BUDGET, GSC_INSPECT_FLAG, GSC_INSPECT_STATE_KEY, DAY_MS } from '../../src/modules/marketing/index-inspection';

const ORIGIN = 'https://gshop.test';
const okFields = { verdict: 'PASS', coverageState: 'Submitted and indexed', pageFetchState: 'SUCCESSFUL', robotsTxtState: 'ALLOWED', indexingState: 'INDEXING_ALLOWED', googleCanonical: null, userCanonical: null, lastCrawlTime: null };
const ok = (over: Record<string, string | null> = {}): UrlInspectOutcome => ({ kind: 'ok', fields: { ...okFields, ...over } as never });

describe('§GSHOP.A · IndexInspectionService contra Postgres', () => {
  const prisma = new PrismaService();
  let cards: string[] = [];
  let calls: string[] = [];
  let script: (url: string, n: number) => UrlInspectOutcome = () => ok();
  let configured = true;
  const waits: number[] = [];

  const external = {
    searchConsoleConfigured: () => configured,
    searchConsoleOrigin: () => ORIGIN,
    urlInspect: async (url: string) => {
      calls.push(url);
      return script(url, calls.length);
    },
  };
  const catalog = { sitemapCardEntries: async () => cards.map((id) => ({ type: 'card', id, lastmod: '' })) };
  const sealed = { sitemapSealedEntries: async () => [] };
  const svc = new IndexInspectionService(prisma, external as never, catalog as never, sealed as never);
  svc.sleep = async (ms) => void waits.push(ms);

  // Lunes 2026-11-02 09:00 UTC = 03:00 CDMX (día CDMX 2026-11-02, inicio 06:00Z).
  const t0 = new Date('2026-11-02T09:00:00Z');
  const at = (days: number, hoursAfter = 0) => new Date(t0.getTime() + days * DAY_MS + hoursAfter * 3600_000);
  const KEY_PAGES = 10;

  const reset = async () => {
    await prisma.indexInspection.deleteMany({});
    await prisma.configSetting.deleteMany({ where: { key: { in: [GSC_INSPECT_FLAG, GSC_INSPECT_STATE_KEY] } } });
    calls = [];
    waits.length = 0;
    script = () => ok();
    configured = true;
    svc['av7Cache'] = null;
  };

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await reset();
    await prisma.$disconnect();
  });
  beforeEach(reset);

  it('m101 creó la tabla con su PK por url, el índice por lastCheckedAt y flagStreak por defecto 0', async () => {
    const idx = await prisma.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE tablename = 'IndexInspection'`;
    expect(idx.map((i) => i.indexname).sort()).toEqual(['IndexInspection_lastCheckedAt_idx', 'IndexInspection_pkey']);
    await prisma.indexInspection.create({ data: { url: `${ORIGIN}/x`, kind: 'card', firstSeenAt: t0 } });
    expect((await prisma.indexInspection.findUniqueOrThrow({ where: { url: `${ORIGIN}/x` } })).flagStreak).toBe(0);
  });

  it('presupuesto: 2 ticks el mismo día no pasan de 250 consultas; al día siguiente retoma las no revisadas (k/N)', async () => {
    cards = Array.from({ length: 300 }, (_, i) => `c${String(i).padStart(3, '0')}`);
    const a = await svc.tick(at(0));
    const b = await svc.tick(at(0, 1));
    expect(a.inspected).toBe(GSC_INSPECT_DAILY_BUDGET);
    expect(b.outcome).toBe('budget');
    expect(calls).toHaveLength(GSC_INSPECT_DAILY_BUDGET);
    expect(new Set(calls).size).toBe(GSC_INSPECT_DAILY_BUDGET); // ninguna URL dos veces
    const next = await svc.tick(at(1));
    // 310 filas (300 + 10 clave): día 1 revisó 250; día 2 revisa primero las 60 nuevas (NULL) y luego las más viejas.
    expect(next.inspected).toBe(GSC_INSPECT_DAILY_BUDGET);
    const never = await prisma.indexInspection.count({ where: { lastCheckedAt: null } });
    expect(never).toBe(0);
    console.log(`PRESUPUESTO: día1 ${a.inspected}/250, 2.º tick mismo día ${b.inspected}, día2 ${next.inspected}/250, sin revisar ${never}/310`);
  });

  it('orden: las páginas clave no revisadas hoy primero; NULL antes que lo ya revisado; luego la más vieja', async () => {
    cards = ['a', 'b', 'c'];
    await svc.tick(at(0)); // todas revisadas el día 0 (3 + 10 filas)
    await prisma.indexInspection.update({ where: { url: `${ORIGIN}/es/catalog/b` }, data: { lastCheckedAt: at(-20) } });
    await prisma.indexInspection.update({ where: { url: `${ORIGIN}/es/catalog/a` }, data: { lastCheckedAt: at(-5) } });
    cards = ['a', 'b', 'c', 'nuevo'];
    calls = [];
    await svc.tick(at(1));
    const keys = calls.slice(0, KEY_PAGES);
    expect(keys.every((u) => !u.includes('/catalog/'))).toBe(true);
    expect(calls.slice(KEY_PAGES)[0]).toBe(`${ORIGIN}/es/catalog/nuevo`); // NULL primero
    expect(calls.slice(KEY_PAGES + 1, KEY_PAGES + 3)).toEqual([`${ORIGIN}/es/catalog/b`, `${ORIGIN}/es/catalog/a`]); // más vieja primero
  });

  it('una ficha que sale del sitemap pierde su fila (una carta vendida no genera 404) y un 404 suyo no avisa', async () => {
    cards = ['a', 'vendida'];
    script = (u) => (u.endsWith('/vendida') ? ok({ verdict: 'FAIL', coverageState: 'Not found (404)', pageFetchState: 'NOT_FOUND' }) : ok());
    await svc.tick(at(0));
    expect((await prisma.indexInspection.findUniqueOrThrow({ where: { url: `${ORIGIN}/es/catalog/vendida` } })).flag).toBe('NOT_FOUND');
    cards = ['a'];
    await svc.tick(at(1)); // el sitemap ya no la lista
    expect(await prisma.indexInspection.findUnique({ where: { url: `${ORIGIN}/es/catalog/vendida` } })).toBeNull();
    const av7 = await svc.av7Input(at(1, 2));
    expect(av7).toEqual({ missing: null, summary: null });
  });

  it('un sitemap vacío (backend caído) NO borra nada', async () => {
    cards = ['a', 'b'];
    await svc.tick(at(0));
    const before = await prisma.indexInspection.count();
    cards = [];
    // las páginas clave siguen en el universo; las fichas no se borran por un sitemap sin fichas
    const r = await svc.tick(at(1));
    expect(r.outcome).not.toBe('no_universe'); // las claves existen siempre
    expect(await prisma.indexInspection.count()).toBeLessThanOrEqual(before);
  });

  it('429: backoff 2-4-8 s por URL, se corta el tick, las filas quedan sin tocar y el siguiente tick retoma', async () => {
    cards = ['a', 'b', 'c'];
    script = () => ({ kind: 'rate_limited', errClass: 'http=429 reason=RESOURCE_EXHAUSTED' });
    const r = await svc.tick(at(0));
    expect(r.outcome).toBe('rate_limited');
    expect(r.inspected).toBe(0);
    expect([...new Set(waits)].sort((x, y) => x - y)).toEqual([2000, 4000, 8000]); // 2-4-8 s (dos URLs en paralelo)
    expect(await prisma.indexInspection.count({ where: { lastCheckedAt: { not: null } } })).toBe(0);
    // el tope del día queda en lo ya hecho (0) ⇒ más ticks de HOY no consultan
    calls = [];
    expect((await svc.tick(at(0, 1))).outcome).toBe('budget');
    expect(calls).toHaveLength(0);
    // otro día, ya sin 429: retoma todo
    script = () => ok();
    const n = await svc.tick(at(1));
    expect(n.inspected).toBe(13);
  });

  it('5xx transitorio: reintenta con backoff y, si se recupera, la URL se registra', async () => {
    cards = ['a'];
    let fails = 2;
    script = () => (fails-- > 0 ? { kind: 'transient', errClass: 'http=503' } : ok());
    const r = await svc.tick(at(0));
    expect(r.outcome).toBe('done');
    expect([...new Set(waits)].sort((x, y) => x - y)).toEqual([2000]); // 2 fallos, uno por URL en paralelo: un solo escalón
    expect(r.inspected).toBe(11);
  });

  it('403: el job se detiene ese día sin más consultas, y AV7 dice «No se evaluó…» (nunca «sin problemas»)', async () => {
    cards = ['a', 'b'];
    script = () => ({ kind: 'forbidden', errClass: 'http=403' });
    const r = await svc.tick(at(0));
    expect(r.outcome).toBe('forbidden');
    const callsFirst = calls.length;
    expect(callsFirst).toBeLessThanOrEqual(2); // concurrencia 2: no se insiste
    expect((await svc.tick(at(0, 1))).outcome).toBe('denied_today');
    expect(calls).toHaveLength(callsFirst);
    const av7 = await svc.av7Input(at(0, 2));
    expect(av7.summary).toBeNull();
    expect(av7.missing).toContain('sin permiso de Search Console');
    // al día siguiente se reintenta y, si ya hay permiso, el aviso de permiso se limpia
    script = () => ok();
    await svc.tick(at(1));
    svc['av7Cache'] = null;
    expect((await svc.av7Input(at(1, 2))).missing).toBeNull();
  });

  it('interruptor `gsc_index_inspect`=off ⇒ no consulta; sin cuenta/propiedad ⇒ no hace nada', async () => {
    cards = ['a'];
    await prisma.configSetting.create({ data: { key: GSC_INSPECT_FLAG, valueJson: 'off' } });
    expect((await svc.tick(at(0))).outcome).toBe('off');
    expect(calls).toHaveLength(0);
    expect((await svc.av7Input(at(0, 1))).missing).toContain('apagada');
    await prisma.configSetting.delete({ where: { key: GSC_INSPECT_FLAG } });
    configured = false;
    expect((await svc.tick(at(0))).outcome).toBe('not_configured');
    expect(calls).toHaveLength(0);
  });

  it('racha: dos ticks seguidos NO bastan para una duplicada; 5 días después sí; avisa una vez y no se repite en 28 días', async () => {
    cards = ['dup', 'b'];
    script = (u) => (u.endsWith('/dup') ? ok({ verdict: 'NEUTRAL', coverageState: 'Duplicate, Google chose different canonical than user' }) : ok());
    const dupUrl = `${ORIGIN}/es/catalog/dup`;
    await svc.tick(at(0));
    // días 1-4: cada día se revisa de nuevo (se fuerza la fila vieja para que el tick la tome)
    for (const day of [1, 2, 3, 4]) {
      await prisma.indexInspection.updateMany({ data: { lastCheckedAt: at(day - 1) } });
      await svc.tick(at(day));
    }
    let row = await prisma.indexInspection.findUniqueOrThrow({ where: { url: dupUrl } });
    expect([row.flag, row.flagStreak]).toEqual(['DUP_NO_CANON', 1]);
    svc['av7Cache'] = null;
    expect((await svc.av7Input(at(4, 2))).summary).toBeNull();
    await prisma.indexInspection.updateMany({ data: { lastCheckedAt: at(4) } });
    await svc.tick(at(5));
    row = await prisma.indexInspection.findUniqueOrThrow({ where: { url: dupUrl } });
    expect(row.flagStreak).toBe(2);
    // cobertura: ≥ 50 % revisado en 7 días ⇒ se evalúa
    svc['av7Cache'] = null;
    const av7 = await svc.av7Input(at(5, 2));
    expect(av7.missing).toBeNull();
    expect(av7.summary).toMatchObject({ total: 1, groups: [{ flag: 'DUP_NO_CANON', count: 1, examples: ['/es/catalog/dup'] }] });
    // el correo lo marca; ni 7 ni 27 días después se repite; a los 28 vuelve
    expect(await svc.markNotified(at(5, 3))).toBe(1);
    for (const days of [12, 32]) {
      await prisma.indexInspection.updateMany({ data: { lastCheckedAt: at(5) } }); // mantiene la cobertura
      svc['av7Cache'] = null;
      expect((await svc.av7Input(at(days))).summary).toBeNull();
    }
    await prisma.indexInspection.updateMany({ data: { lastCheckedAt: at(5 + 28) } });
    svc['av7Cache'] = null;
    expect((await svc.av7Input(at(5 + 28, 3))).summary?.total).toBe(1);
    // si Google lo limpia (PASS), la racha y el aviso se olvidan
    script = () => ok();
    await prisma.indexInspection.updateMany({ data: { lastCheckedAt: at(10) } });
    await svc.tick(at(40));
    row = await prisma.indexInspection.findUniqueOrThrow({ where: { url: dupUrl } });
    expect([row.flag, row.flagStreak, row.notifiedAt]).toEqual([null, 0, null]);
  });

  it('cobertura < 50 % del universo en 7 días ⇒ «No se evaluó» (no «sin problemas»)', async () => {
    cards = Array.from({ length: 40 }, (_, i) => `c${i}`);
    await svc.tick(at(0));
    await prisma.indexInspection.updateMany({ where: { url: { endsWith: '5' } }, data: { lastCheckedAt: at(-30) } });
    await prisma.indexInspection.updateMany({ where: { NOT: { url: { endsWith: '5' } } }, data: { lastCheckedAt: at(-30) } });
    svc['av7Cache'] = null;
    expect((await svc.av7Input(at(0, 2))).missing).toContain('menos de la mitad');
  });

  it('un 404 a la 1.ª vez avisa (NOT_FOUND) y solo si la URL sigue en el sitemap al armar el aviso', async () => {
    cards = ['rota', 'b'];
    script = (u) => (u.endsWith('/rota') ? ok({ verdict: 'FAIL', coverageState: 'Not found (404)', pageFetchState: 'NOT_FOUND' }) : ok());
    await svc.tick(at(0));
    svc['av7Cache'] = null;
    expect((await svc.av7Input(at(0, 2))).summary?.groups[0]).toMatchObject({ flag: 'NOT_FOUND', count: 1 });
    cards = ['b']; // salió del sitemap antes de armar el aviso
    svc['av7Cache'] = null;
    expect((await svc.av7Input(at(0, 3))).summary).toBeNull();
  });
});

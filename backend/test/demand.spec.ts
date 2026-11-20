/**
 * demand.spec.ts — §DEMANDA F1+F2 (API_CONTRACT_DEMANDA §9), pruebas unitarias sin infra: umbral 4/5 personas y 1/2 días con la MISMA
 * función de c6, diales (seed y dominio), orden y desempate, inyección de fórmulas en el CSV, validación de `sort`/`limit`,
 * regla de `demand-match` (único / exacto / varios / ninguno), y el DTO de `search-miss` con `cardId?` (campo extra ⇒ 204 sin escritura).
 * La conducta contra Postgres vive en `integration/demand-gaps.e2e-spec.ts`.
 */
import { qualifyingCounts, qualifyingSearchMisses, MarketingSearchMissService } from '../src/modules/marketing/marketing-search-miss.service';
import { MarketingSearchMissController } from '../src/modules/marketing/marketing-search-miss.controller';
import { csvText, sortRows, DemandGapsService, DemandRowDTO } from '../src/modules/demand/demand-gaps.service';
import { DemandSearchService, isBotUserAgent, SEARCH_DEMAND_VERIFY_MAX_ENTRIES } from '../src/modules/demand/demand-search.service';
import { decideMatch } from '../src/modules/demand/demand-match.service';
import { SETTING_DEFAULTS, SETTING_DTO_MAP, SETTING_VALIDATORS, SettingKeyType } from '../src/modules/settings/settings.constants';

describe('§DEMANDA · umbral (la MISMA función pura de c6)', () => {
  const rows = (...p: number[]) => p.map((people, i) => ({ key: 'c', day: `2027-05-${10 + i}`, people }));
  it('4 personas ⇒ no sale; 5 personas en 1 solo día ⇒ no sale; 5 en 2 días con ≥ 2 ⇒ sale', () => {
    expect(qualifyingCounts(rows(2, 2))).toEqual([]); // 4 personas
    expect(qualifyingCounts(rows(5))).toEqual([]); // 1 día
    expect(qualifyingCounts(rows(4, 1))).toEqual([]); // 1 día con ≥ 2
    expect(qualifyingCounts(rows(3, 2))).toEqual([{ key: 'c', people: 5, days: 2 }]);
  });
  it('dos filas del MISMO día (registro directo + término asociado) suman antes de contar días', () => {
    const r = [
      { key: 'c', day: '2027-05-10', people: 1 },
      { key: 'c', day: '2027-05-10', people: 1 },
      { key: 'c', day: '2027-05-11', people: 3 },
    ];
    expect(qualifyingCounts(r)).toEqual([{ key: 'c', people: 5, days: 2 }]);
  });
  it('c6 no cambió: el envoltorio sigue dando el mismo resultado sin días', () => {
    expect(qualifyingSearchMisses([{ termNormalized: 't', people: 3 }, { termNormalized: 't', people: 2 }])).toEqual([{ term: 't', people: 5, days: 2 }]);
  });
});

describe('§DEMANDA · diales', () => {
  const T = [
    { dto: 'demandWWishlist', db: 'demand_w_wishlist', seed: 3, ok: [0, 3, 100], bad: [-1, 101, 1.5, '3'] },
    { dto: 'demandWSearch', db: 'demand_w_search', seed: 1, ok: [0, 1, 100], bad: [-1, 101, '1'] },
    { dto: 'demandSearchWindowDays', db: 'demand_search_window_days', seed: 30, ok: [7, 30, 90], bad: [6, 91, 30.5] },
  ];
  it.each(T)('$dto ⇒ $db, seed $seed, dominio', ({ dto, db, seed, ok, bad }) => {
    expect(SETTING_DTO_MAP[dto]).toBe(db);
    expect(SETTING_DEFAULTS[db as SettingKeyType]).toBe(seed);
    const v = SETTING_VALIDATORS[db as SettingKeyType];
    for (const x of ok) expect(v(x)).toBeNull();
    for (const x of bad) expect(typeof v(x)).toBe('string');
  });
});

describe('§DEMANDA · orden', () => {
  const row = (key: string, score: number, marketCents: number | null): DemandRowDTO => ({
    key, kind: 'card', cardId: key, term: null, cardName: key, setName: 's', finish: null, imageSmallUrl: null, signals: [], score, marketCents, buylistTodayCents: null,
  });
  it('score ↓; empate por mercado ↓ (null al final) y luego key; estable entre corridas', () => {
    const a = [row('b', 5, null), row('c', 5, 100), row('a', 5, 100), row('d', 9, null)];
    sortRows(a, 'score', 'desc');
    expect(a.map((r) => r.key)).toEqual(['d', 'a', 'c', 'b']);
    const b = [...a].reverse();
    sortRows(b, 'score', 'desc');
    expect(b.map((r) => r.key)).toEqual(['d', 'a', 'c', 'b']);
  });
  it('sort=market: los null SIEMPRE al final, también en asc; null no es 0', () => {
    const a = [row('x', 1, null), row('y', 1, 50), row('z', 1, 20)];
    sortRows(a, 'market', 'asc');
    expect(a.map((r) => r.key)).toEqual(['z', 'y', 'x']);
    sortRows(a, 'market', 'desc');
    expect(a.map((r) => r.key)).toEqual(['y', 'z', 'x']);
  });
});

describe('§DEMANDA · CSV: inyección de fórmulas', () => {
  it.each(['=cmd|calc', '+1', '-1', '@SUM(A1)', '\tx', '\rx'])('%j ⇒ prefijo comilla simple', (v) => {
    expect(csvText(v).startsWith(`"'`)).toBe(true);
  });
  it('texto normal y comillas dobladas', () => {
    expect(csvText('Pikachu "ex"')).toBe('"Pikachu ""ex"""');
    expect(csvText('')).toBe('""');
  });
});

describe('§DEMANDA · query de demand-gaps', () => {
  const svc = new DemandGapsService({} as never, {} as never, {} as never, {} as never, {} as never);
  it('defaults', () => expect(svc.parseQuery({})).toEqual({ sort: 'score', dir: 'desc', limit: 100 }));
  it.each([{ sort: 'x' }, { dir: 'up' }, { limit: '0' }, { limit: '201' }, { limit: 'abc' }, { limit: '1.5' }, { limit: '-1' }])('%j ⇒ 400', (q) => {
    expect(() => svc.parseQuery(q)).toThrow(expect.objectContaining({ status: 400 }));
  });
  it('ORDEN: limit vacío o solo espacios ≡ ausente (default); ` 5` es mal formado ⇒ 400', () => {
    expect(svc.parseQuery({ limit: '' }).limit).toBe(100);
    expect(svc.parseQuery({ limit: ' ' }).limit).toBe(100);
    expect(() => svc.parseQuery({ limit: ' 5' })).toThrow(expect.objectContaining({ status: 400 }));
  });
  it('válidos', () => expect(svc.parseQuery({ sort: 'market', dir: 'asc', limit: '200' })).toEqual({ sort: 'market', dir: 'asc', limit: 200 }));
});

describe('§DEMANDA · demand-match: la regla', () => {
  const r = (id: string, name: string) => ({ id, name });
  it('0 ⇒ none; 1 ⇒ matched; varios sin igualdad ⇒ ambiguous; varios con UN nombre idéntico ⇒ matched', () => {
    expect(decideMatch('pikachu', [])).toEqual({ status: 'none', cardId: null });
    expect(decideMatch('pikachu vmax', [r('1', 'Pikachu VMAX')])).toEqual({ status: 'matched', cardId: '1' });
    expect(decideMatch('pikachu', [r('1', 'Pikachu V'), r('2', 'Pikachu VMAX')])).toEqual({ status: 'ambiguous', cardId: null });
    expect(decideMatch('pikachu', [r('1', 'Pikachu'), r('2', 'Pikachu VMAX')])).toEqual({ status: 'matched', cardId: '1' });
    expect(decideMatch('pikachu', [r('1', 'Pikachu'), r('2', 'PIKACHU')])).toEqual({ status: 'ambiguous', cardId: null }); // dos iguales ⇒ no se adivina
  });
});

describe('§DEMANDA F2 · POST /marketing/search-miss con cardId?', () => {
  const mk = () => {
    const record = jest.fn(async () => true);
    return { record, ctl: new MarketingSearchMissController({ record } as unknown as MarketingSearchMissService) };
  };
  const req = { ip: '1.1.1.1', headers: { 'user-agent': 'ua' } } as never;
  it('el DTO acepta cardId y lo pasa al servicio (no se descarta en silencio)', async () => {
    const { ctl, record } = mk();
    await ctl.searchMiss({ term: 'pikachu', kind: 'card', cardId: '11111111-1111-4111-8111-111111111111' }, req);
    expect(record).toHaveBeenCalledTimes(1);
    expect((record.mock.calls[0] as unknown[])[3]).toBe('11111111-1111-4111-8111-111111111111');
  });
  it('sin cardId sigue igual; con un campo extra o cardId > 36 ⇒ 204 sin escritura', async () => {
    const a = mk();
    await a.ctl.searchMiss({ term: 'pikachu', kind: 'card' }, req);
    expect(a.record).toHaveBeenCalledTimes(1);
    for (const body of [{ term: 'p', kind: 'card', extra: 1 }, { term: 'pikachu', kind: 'card', cardId: 'x'.repeat(37) }, { term: 'pikachu', kind: 'card', cardId: 5 }]) {
      const b = mk();
      await expect(b.ctl.searchMiss(body as never, req)).resolves.toBeUndefined();
      expect(b.record).not.toHaveBeenCalled();
    }
  });
});

describe('§DEMANDA F2 · servicio: verificación del cardId (fakes)', () => {
  const UUID = '22222222-2222-4222-8222-222222222222';
  const UA = 'Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0';
  function build(opts: { exists?: boolean; stocked?: boolean; flagOff?: boolean }) {
    const exec: unknown[][] = [];
    const prisma = {
      card: { findUnique: jest.fn(async () => (opts.exists === false ? null : { id: UUID })) },
      configSetting: {
        findUnique: jest.fn(async () => (opts.flagOff ? { valueJson: 'off' } : null)),
        findUniqueOrThrow: jest.fn(async () => ({ valueJson: 'sal' })),
      },
      $executeRaw: jest.fn(async (...a: unknown[]) => (exec.push(a), 1)),
      $queryRaw: jest.fn(async () => []),
      $transaction: jest.fn(async (qs: Promise<unknown>[]) => Promise.all(qs)),
    };
    const catalog = { cardIdsWithSellable: jest.fn(async () => (opts.stocked ? new Set([UUID]) : new Set<string>())) };
    const vocab = { allows: jest.fn(async () => true) };
    const demand = new DemandSearchService(prisma as never, catalog as never);
    const svc = new MarketingSearchMissService(prisma as never, vocab as never, demand);
    const wroteDemand = () => exec.some((a) => String((a[0] as string[]).join('?')).includes('SearchDemandSeen"') && String((a[0] as string[]).join('?')).includes('INSERT'));
    const wroteText = () => exec.some((a) => String((a[0] as string[]).join('?')).includes('INSERT INTO "SearchNoResultSeen"'));
    return { svc, demand, prisma, catalog, vocab, exec, wroteDemand, wroteText };
  }
  it('0 stock ⇒ cuenta en SearchDemandSeen y NO guarda el término', async () => {
    const t = build({ stocked: false });
    expect(await t.svc.record('pikachu', { ip: 'a', userAgent: UA }, new Date(), UUID)).toBe(true);
    expect(t.wroteDemand()).toBe(true);
    expect(t.wroteText()).toBe(false);
  });
  it('con stock ⇒ no cuenta nada (ni demanda ni texto)', async () => {
    const t = build({ stocked: true });
    expect(await t.svc.record('pikachu', { ip: 'a', userAgent: UA }, new Date(), UUID)).toBe(false);
    expect(t.wroteDemand()).toBe(false);
    expect(t.wroteText()).toBe(false);
  });
  it('inexistente o no-uuid ⇒ camino de texto idéntico a hoy', async () => {
    const t = build({ exists: false });
    await t.svc.record('pikachu', { ip: 'a', userAgent: UA }, new Date(), UUID);
    expect(t.wroteDemand()).toBe(false);
    expect(t.wroteText()).toBe(true);
    const u = build({});
    await u.svc.record('pikachu', { ip: 'a', userAgent: UA }, new Date(), 'no-es-uuid');
    expect(u.prisma.card.findUnique).not.toHaveBeenCalled();
    expect(u.wroteText()).toBe(true);
  });
  it('interruptor apagado ⇒ nada', async () => {
    const t = build({ flagOff: true });
    expect(await t.svc.record('pikachu', { ip: 'a', userAgent: UA }, new Date(), UUID)).toBe(false);
    expect(t.wroteDemand()).toBe(false);
  });
  it('caché: 100 peticiones con el mismo cardId ⇒ UNA verificación', async () => {
    const t = build({});
    for (let i = 0; i < 100; i++) await t.svc.record('pikachu', { ip: `i${i}`, userAgent: UA }, new Date(), UUID);
    expect(t.prisma.card.findUnique).toHaveBeenCalledTimes(1);
    expect(t.catalog.cardIdsWithSellable).toHaveBeenCalledTimes(1);
  });
  it('DM-1: el hash de la persona es SOLO de la IP — 30 user-agent con la misma IP ⇒ UN mismo h; otra IP ⇒ otro h', async () => {
    const t = build({});
    for (let i = 0; i < 30; i++) await t.svc.record('x', { ip: '9.9.9.9', userAgent: `Mozilla/5.0 variante-${i}` }, new Date(), UUID);
    await t.svc.record('x', { ip: '8.8.8.8', userAgent: UA }, new Date(), UUID);
    const hs = t.exec
      .filter((a) => (a[0] as string[]).join('?').includes('INSERT INTO "SearchDemandSeen"'))
      .map((a) => a.find((v) => typeof v === 'string' && /^[0-9a-f]{16}$/.test(v)) as string);
    expect(hs).toHaveLength(31);
    expect(new Set(hs.slice(0, 30)).size).toBe(1);
    expect(new Set(hs).size).toBe(2);
  });
  it('robots: UA vacío o de bot ⇒ no cuenta ni verifica ni cae al texto; un navegador sí', async () => {
    for (const ua of ['', '   ', undefined, 'Googlebot/2.1', 'Mozilla/5.0 (compatible; bingbot)', 'curl/8.0', 'python-requests/2', 'HeadlessChrome', 'Slackbot-LinkExpanding link preview', 'Wget/1.2', 'Apache-HttpClient/4', 'Yahoo! Slurp', 'SomeSpider']) {
      const t = build({});
      expect(await t.svc.record('pikachu', { ip: 'a', userAgent: ua }, new Date(), UUID)).toBe(false);
      expect(t.prisma.card.findUnique).not.toHaveBeenCalled();
      expect(t.wroteDemand()).toBe(false);
      expect(t.wroteText()).toBe(false);
      expect(isBotUserAgent(ua)).toBe(true);
    }
    expect(isBotUserAgent(UA)).toBe(false);
    const ok = build({});
    expect(await ok.svc.record('pikachu', { ip: 'a', userAgent: UA }, new Date(), UUID)).toBe(true);
  });
  it('caché: tope de entradas con evicción del más antiguo, sin barrer (O(1)); vuelve a verificar solo al evictado', async () => {
    const t = build({});
    const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const now = new Date();
    for (let i = 0; i < SEARCH_DEMAND_VERIFY_MAX_ENTRIES + 1; i++) await t.demand.classify(id(i), UA, now);
    expect(t.demand.cacheSize()).toBe(SEARCH_DEMAND_VERIFY_MAX_ENTRIES);
    const before = t.prisma.card.findUnique.mock.calls.length;
    await t.demand.classify(id(SEARCH_DEMAND_VERIFY_MAX_ENTRIES), UA, now); // el más reciente sigue en caché
    expect(t.prisma.card.findUnique.mock.calls.length).toBe(before);
    await t.demand.classify(id(0), UA, now); // el más antiguo fue evictado
    expect(t.prisma.card.findUnique.mock.calls.length).toBe(before + 1);
  });
});

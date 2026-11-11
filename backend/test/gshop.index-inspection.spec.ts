import {
  CRAWLED_MIN_AGE_MS,
  DAY_MS,
  RENOTIFY_AFTER_MS,
  classifyInspection,
  isNoticeable,
  nextFlagState,
  summarizeAv7,
  type InspectionFields,
  type NoticeRow,
} from '../src/modules/marketing/index-inspection';
import { KEY_PAGE_FALLBACK } from '../src/modules/marketing/index-inspection.service';
import { evaluateAlerts, alertsWithSources, type AlertInputs } from '../src/modules/marketing/marketing-alerts';
import { AV_TEXT } from '../src/modules/marketing/marketing-alerts.text';

/**
 * §GSHOP.A (docs/specs/GOOGLE_SHOPPING_E_INDEXACION.md) — clasificación pura, rachas, supresión de ruido y texto/gravedad de AV7.
 */
const F = (o: Partial<InspectionFields>): InspectionFields => ({ verdict: null, coverageState: null, pageFetchState: null, robotsTxtState: null, indexingState: null, googleCanonical: null, userCanonical: null, ...o });
const T0 = new Date('2026-11-02T10:00:00Z');
const d = (n: number, from = T0) => new Date(from.getTime() + n * DAY_MS);

describe('classifyInspection (tabla del spec §A)', () => {
  const cases: [string, Partial<InspectionFields>, string | null][] = [
    ['404', { verdict: 'FAIL', pageFetchState: 'NOT_FOUND' }, 'NOT_FOUND'],
    ['soft 404 (minúsculas)', { verdict: 'FAIL', pageFetchState: 'soft_404' }, 'NOT_FOUND'],
    ['robots', { verdict: 'FAIL', robotsTxtState: 'DISALLOWED' }, 'BLOCKED'],
    ['indexing BLOCKED_BY_META_TAG', { verdict: 'NEUTRAL', indexingState: 'BLOCKED_BY_META_TAG' }, 'BLOCKED'],
    ['fetch bloqueado', { verdict: 'FAIL', pageFetchState: 'BLOCKED_ROBOTS_TXT' }, 'BLOCKED'],
    ['403', { verdict: 'FAIL', pageFetchState: 'ACCESS_FORBIDDEN' }, 'BLOCKED'],
    ['5xx', { verdict: 'FAIL', pageFetchState: 'SERVER_ERROR' }, 'FETCH_ERROR'],
    ['redirect', { verdict: 'FAIL', pageFetchState: 'REDIRECT_ERROR' }, 'FETCH_ERROR'],
    ['duplicada (Centiskorch)', { verdict: 'NEUTRAL', coverageState: 'Duplicate, Google chose different canonical than user', pageFetchState: 'SUCCESSFUL' }, 'DUP_NO_CANON'],
    ['canónicas distintas', { verdict: 'NEUTRAL', coverageState: 'Indexed', googleCanonical: 'https://x/a', userCanonical: 'https://x/b' }, 'DUP_NO_CANON'],
    ['canónicas iguales, ausente una ⇒ no es duplicada', { verdict: 'NEUTRAL', coverageState: 'Indexed', googleCanonical: 'https://x/a', userCanonical: null }, null],
    ['rastreada sin indexar', { verdict: 'NEUTRAL', coverageState: 'Crawled - currently not indexed' }, 'CRAWLED_NOT_INDEXED'],
    ['descubierta sin indexar', { verdict: 'NEUTRAL', coverageState: 'discovered - currently not indexed' }, 'CRAWLED_NOT_INDEXED'],
    ['PASS', { verdict: 'PASS', coverageState: 'Submitted and indexed' }, null],
    ['PASS gana aun con canónicas distintas', { verdict: 'PASS', googleCanonical: 'a', userCanonical: 'b' }, null],
    ['Submitted and indexed sin verdict', { coverageState: 'Submitted and indexed' }, null],
    ['cadena desconocida con FAIL ⇒ FETCH_ERROR (nunca en silencio)', { verdict: 'FAIL', pageFetchState: 'ALGO_NUEVO' }, 'FETCH_ERROR'],
    ['cadena desconocida con NEUTRAL ⇒ sin flag', { verdict: 'NEUTRAL', coverageState: 'URL is unknown to Google' }, null],
  ];
  it.each(cases)('%s', (_n, f, want) => {
    expect(classifyInspection(F(f))).toBe(want);
  });
});

describe('nextFlagState: la racha cuenta revisiones separadas ≥ 5 días', () => {
  it('flag nuevo ⇒ racha 1 y aviso previo olvidado; sin flag ⇒ se limpia', () => {
    expect(nextFlagState(null, 'DUP_NO_CANON', T0)).toMatchObject({ flag: 'DUP_NO_CANON', flagStreak: 1, flagSince: T0, resetNotified: true });
    expect(nextFlagState({ flag: 'DUP_NO_CANON', flagSince: T0, flagStreak: 3 }, null, d(9))).toEqual({ flag: null, flagSince: null, flagStreak: 0, resetNotified: true });
  });
  it('dos ticks seguidos NO suben la racha; 5 días después sí; 10 días para la 3.ª', () => {
    const s1 = nextFlagState(null, 'FETCH_ERROR', T0);
    const sameDay = nextFlagState(s1, 'FETCH_ERROR', new Date(T0.getTime() + 3600_000));
    expect(sameDay.flagStreak).toBe(1);
    const day4 = nextFlagState(s1, 'FETCH_ERROR', d(4));
    expect(day4.flagStreak).toBe(1);
    const day5 = nextFlagState(s1, 'FETCH_ERROR', d(5));
    expect(day5).toMatchObject({ flagStreak: 2, flagSince: T0, resetNotified: false });
    expect(nextFlagState(day5, 'FETCH_ERROR', d(9)).flagStreak).toBe(2);
    expect(nextFlagState(day5, 'FETCH_ERROR', d(10)).flagStreak).toBe(3);
  });
  it('un flag distinto reinicia la racha', () => {
    const s = nextFlagState({ flag: 'FETCH_ERROR', flagSince: T0, flagStreak: 4 }, 'BLOCKED', d(30));
    expect(s).toMatchObject({ flag: 'BLOCKED', flagStreak: 1, flagSince: d(30), resetNotified: true });
  });
});

describe('isNoticeable: cuándo se avisa', () => {
  const row = (o: Partial<NoticeRow>): NoticeRow => ({ url: 'https://x/es/catalog/a', kind: 'card', flag: 'NOT_FOUND', flagStreak: 1, firstSeenAt: d(-60), notifiedAt: null, ...o });
  const now = d(0);
  it('NOT_FOUND y BLOCKED a la 1.ª vez', () => {
    expect(isNoticeable(row({ flag: 'NOT_FOUND' }), now)).toBe(true);
    expect(isNoticeable(row({ flag: 'BLOCKED' }), now)).toBe(true);
  });
  it('FETCH_ERROR y DUP_NO_CANON exigen racha ≥ 2', () => {
    for (const flag of ['FETCH_ERROR', 'DUP_NO_CANON']) {
      expect(isNoticeable(row({ flag, flagStreak: 1 }), now)).toBe(false);
      expect(isNoticeable(row({ flag, flagStreak: 2 }), now)).toBe(true);
    }
  });
  it('CRAWLED_NOT_INDEXED exige racha ≥ 2 Y ≥ 21 días en el sitemap', () => {
    expect(isNoticeable(row({ flag: 'CRAWLED_NOT_INDEXED', flagStreak: 2, firstSeenAt: new Date(now.getTime() - CRAWLED_MIN_AGE_MS + 1000) }), now)).toBe(false);
    expect(isNoticeable(row({ flag: 'CRAWLED_NOT_INDEXED', flagStreak: 2, firstSeenAt: new Date(now.getTime() - CRAWLED_MIN_AGE_MS) }), now)).toBe(true);
    expect(isNoticeable(row({ flag: 'CRAWLED_NOT_INDEXED', flagStreak: 1 }), now)).toBe(false);
  });
  it('no se repite en 28 días (salvo el mismo día del reenvío); pasados 28 días vuelve', () => {
    const e = { forEmail: true };
    expect(isNoticeable(row({ notifiedAt: d(-7) }), now, e)).toBe(false);
    expect(isNoticeable(row({ notifiedAt: new Date(now.getTime() - 3600_000) }), now, e)).toBe(true);
    expect(isNoticeable(row({ notifiedAt: new Date(now.getTime() - RENOTIFY_AFTER_MS) }), now, e)).toBe(true);
  });
  it('el PANEL sigue mostrando mientras el problema persista: notifiedAt solo filtra el correo', () => {
    expect(isNoticeable(row({ notifiedAt: d(-7) }), now)).toBe(true);
    expect(isNoticeable(row({ notifiedAt: d(-7) }), now, { forEmail: false })).toBe(true);
    expect(isNoticeable(row({ notifiedAt: d(-7) }), now, { forEmail: true })).toBe(false);
  });
  it('sin flag o flag desconocido ⇒ no', () => {
    expect(isNoticeable(row({ flag: null }), now)).toBe(false);
    expect(isNoticeable(row({ flag: 'OTRA' }), now)).toBe(false);
  });
});

describe('AV7: resumen, texto, gravedad, y «sin elementos ⇒ sin aviso»', () => {
  const now = d(0);
  const r = (flag: string, i: number, o: Partial<NoticeRow> = {}): NoticeRow => ({ url: `https://t.mx/es/catalog/${flag}-${i}`, kind: 'card', flag, flagStreak: 2, firstSeenAt: d(-90), notifiedAt: null, ...o });
  const base: Omit<AlertInputs, 'indexIssues'> = { checkoutStarts: null, paidOrders: 0, groups: null, items: null, scPages: null, buylist: [], searchMisses: null, exact: true };

  it('agrupa por problema, ≤ 3 ejemplos por categoría y «y N más»; el texto cita conteos y URLs', () => {
    const rows = [...[1, 2].map((i) => r('NOT_FOUND', i, { flagStreak: 1 })), r('DUP_NO_CANON', 1), ...[1, 2, 3, 4, 5].map((i) => r('CRAWLED_NOT_INDEXED', i))];
    const s = summarizeAv7(rows, now)!;
    expect(s.total).toBe(8);
    expect(s.groups.map((g) => [g.flag, g.count, g.examples.length])).toEqual([['NOT_FOUND', 2, 2], ['DUP_NO_CANON', 1, 1], ['CRAWLED_NOT_INDEXED', 5, 3]]);
    const t = AV_TEXT.AV7(s.total, s.groups);
    expect(t.evidencia).toContain('Google tiene problemas con 8 fichas: 2 no existen (404), 1 duplicada sin canónica, 5 rastreadas sin indexar.');
    expect(t.evidencia).toContain('/es/catalog/NOT_FOUND-1');
    expect(t.evidencia).toContain('y 2 más');
  });
  it('NOT_FOUND/BLOCKED ⇒ gravedad alta; el resto ⇒ media; va tras AV6 en r2', () => {
    const alta = evaluateAlerts({ ...base, indexIssues: summarizeAv7([r('NOT_FOUND', 1, { flagStreak: 1 })], now) });
    expect(alta.map((a) => [a.regla, a.gravedad])).toEqual([['AV7', 'alta']]);
    const media = evaluateAlerts({ ...base, indexIssues: summarizeAv7([r('DUP_NO_CANON', 1)], now) });
    expect(media[0]).toMatchObject({ regla: 'AV7', gravedad: 'media' });
  });
  it('sin elementos ⇒ sin aviso (solo «Sin avisos»); una fuente sin medir cambia «Sin avisos» por «No se pudo evaluar»', () => {
    const none = evaluateAlerts({ ...base, indexIssues: summarizeAv7([r('FETCH_ERROR', 1, { flagStreak: 1 })], now) });
    expect(none.map((a) => a.regla)).toEqual(['—']);
    expect(none[0].titulo).toBe('Sin avisos esta semana');
    const out = alertsWithSources(none, ['la indexación: sin permiso de Search Console']);
    expect(out.map((a) => a.titulo)).toEqual(['No se pudo evaluar esta semana por completo', 'No se evaluó la indexación: sin permiso de Search Console']);
  });
});

describe('páginas clave de respaldo vs fuente (sitemap.ts del front)', () => {
  it('KEY_PAGE_FALLBACK = STATIC_PATHS del front (locale es) + /card-show', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../frontend/src/app/sitemap.ts'), 'utf8') as string;
    const block = /const STATIC_PATHS = \[([\s\S]*?)\] as const/.exec(src)![1];
    const paths = [...block.matchAll(/'([^']*)'/g)].map((m) => `/es${m[1]}`);
    expect([...KEY_PAGE_FALLBACK].sort()).toEqual([...paths, '/card-show'].sort());
  });
});

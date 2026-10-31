import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * §E1/§E4/§E6/§E7 — el sitemap lista las páginas de contenido y robots.txt NO las bloquea (ni a
 * `llms.txt`). El backend del feed se simula caído: el sitemap debe salir igual con lo estático.
 */
const getSitemap = vi.fn();
const getDecksMeta = vi.fn();
vi.mock('@/lib/api', () => ({ getSitemap: () => getSitemap(), getDecksMeta: () => getDecksMeta() }));

import sitemap from './sitemap';
import robots from './robots';

/** Semántica de robots.txt de Google: prefijo con `*` comodín y `$` fin. */
function blockedBy(pattern: string, path: string): boolean {
  const re = new RegExp(
    '^' +
      pattern
        .split('*')
        .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*'),
  );
  return re.test(path);
}

const CONTENT_PATHS = [
  '/es/preguntas',
  '/es/como-funciona',
  '/es/guias',
  '/es/guias/que-es-nm',
  '/es/guias/carta-pirata-5-senales',
  '/es/guias/como-guardar-tus-cartas',
  '/es/guias/que-es-una-sir',
];

/** Hora de la petición en estas pruebas (reloj falso del `beforeEach`). */
const REQUEST_TIME = '2026-10-18T18:00:00.000Z';

/**
 * C6 — NINGUNA entrada del sitemap (fijas, `/card-show`, contenido y fichas) lleva la hora de la petición. Recorre la
 * lista entera en vez de nombrar rutas: una página fija nueva con `lastModified: now` queda roja sin tocar la prueba.
 */
function expectNoEntryAtRequestTime(entries: { url: string; lastModified?: string | Date }[]) {
  expect(entries.length).toBeGreaterThan(0);
  const atRequestTime = entries
    .filter((e) => e.lastModified !== undefined && new Date(e.lastModified).toISOString() === REQUEST_TIME)
    .map((e) => e.url);
  expect(atRequestTime).toEqual([]);
}

describe('sitemap.xml + robots.txt (§E1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(REQUEST_TIME));
    getSitemap.mockReset();
    getSitemap.mockRejectedValue(new Error('backend caído'));
    getDecksMeta.mockReset();
    getDecksMeta.mockRejectedValue(new Error('backend caído'));
  });

  it('incluye portada, catálogo y las páginas de contenido con URL absoluta; el contenido con su lastmod', async () => {
    const entries = await sitemap();
    vi.useRealTimers();
    const urls = entries.map((e) => e.url);
    for (const p of ['/es', '/es/catalog', ...CONTENT_PATHS]) {
      expect(urls).toContain(`https://tcghunt.mx${p}`);
    }
    for (const p of CONTENT_PATHS) {
      expect(entries.find((e) => e.url === `https://tcghunt.mx${p}`)?.lastModified).toBeTruthy();
    }
  });

  /*
   * C6 (BRIEF_MKT Ola 2) — `lastmod` REAL en las páginas fijas: nunca la hora de la petición. Con el feed, la portada y el
   * catálogo llevan la publicación de carta más reciente, sellado la de sellado y decks-meta su `updatedAt`; sin fuente,
   * la entrada sale SIN `lastmod` (no con «ahora»). Mutación que lo pone rojo: volver a `lastModified: now`.
   */
  it('C6: las páginas fijas llevan el lastmod de lo que muestran, nunca la hora de la petición', async () => {
    getSitemap.mockResolvedValue({
      generatedAt: '2026-10-18T17:59:00.000Z',
      items: [
        { type: 'card', id: 'c1', lastmod: '2026-10-10T08:00:00.000Z' },
        { type: 'card', id: 'c2', lastmod: '2026-10-12T09:30:00.000Z' },
        { type: 'sealed', id: 's1', lastmod: '2026-10-11T10:00:00.000Z' },
      ],
    });
    getDecksMeta.mockResolvedValue({ data: [], updatedAt: '2026-10-05T00:00:00.000Z', source: 'x' });
    const entries = await sitemap();
    vi.useRealTimers();
    const lm = (p: string) => entries.find((e) => e.url === `https://tcghunt.mx/es${p}`)?.lastModified;
    expect(lm('')).toBe('2026-10-12T09:30:00.000Z');
    expect(lm('/catalog')).toBe('2026-10-12T09:30:00.000Z');
    expect(lm('/sellado')).toBe('2026-10-11T10:00:00.000Z');
    expect(lm('/decks-meta')).toBe('2026-10-05T00:00:00.000Z');
    expect(lm('/privacidad')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const p of ['/buylist', '/accesorios', '/terminos']) expect(lm(p)).toBeUndefined();
    // `/card-show` no tiene fecha real en el código (content/card-show.ts no publica revisión): sale SIN lastmod.
    expect(entries.find((e) => e.url === 'https://tcghunt.mx/card-show')).toBeDefined();
    expect(entries.find((e) => e.url === 'https://tcghunt.mx/card-show')?.lastModified).toBeUndefined();
    expectNoEntryAtRequestTime(entries);
  });

  it('C6: sin backend, las fijas salen sin lastmod (salvo privacidad), no con la hora de la petición', async () => {
    const entries = await sitemap();
    vi.useRealTimers();
    const fixed = entries.filter((e) => /\/es(\/(catalog|sellado|accesorios|decks-meta|buylist|terminos))?$/.test(e.url));
    expect(fixed).toHaveLength(7);
    for (const e of fixed) expect(e.lastModified).toBeUndefined();
    expect(entries.find((e) => e.url === 'https://tcghunt.mx/card-show')?.lastModified).toBeUndefined();
    expectNoEntryAtRequestTime(entries);
  });

  it('C7: lista la canónica del Card Show SIN prefijo de idioma, una sola vez y sin la variante /es', async () => {
    const entries = await sitemap();
    vi.useRealTimers();
    const urls = entries.map((e) => e.url);
    expect(urls.filter((u) => u === 'https://tcghunt.mx/card-show')).toHaveLength(1);
    expect(urls.filter((u) => /\/(es|en)\/card-show/.test(u))).toEqual([]);
  });

  it('robots.txt no bloquea ninguna página de contenido ni /llms.txt, y sí la cuenta', () => {
    vi.useRealTimers();
    const r = robots();
    const rules = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    const disallow = ([] as string[]).concat(rules.disallow ?? []);
    for (const p of [...CONTENT_PATHS, '/en/preguntas', '/llms.txt', '/es', '/es/catalog']) {
      expect(disallow.filter((d) => blockedBy(d, p))).toEqual([]);
    }
    // El matcher sí muerde: lo privado queda bloqueado.
    expect(disallow.some((d) => blockedBy(d, '/es/account'))).toBe(true);
    expect(r.sitemap).toBe('https://tcghunt.mx/sitemap.xml');
  });
});

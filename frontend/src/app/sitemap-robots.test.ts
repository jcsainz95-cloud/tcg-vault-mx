import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * §E1/§E4/§E6/§E7 — el sitemap lista las páginas de contenido y robots.txt NO las bloquea (ni a
 * `llms.txt`). El backend del feed se simula caído: el sitemap debe salir igual con lo estático.
 */
const getSitemap = vi.fn();
vi.mock('@/lib/api', () => ({ getSitemap: () => getSitemap() }));

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

describe('sitemap.xml + robots.txt (§E1)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-18T18:00:00Z'));
    getSitemap.mockReset();
    getSitemap.mockRejectedValue(new Error('backend caído'));
  });

  it('incluye portada, catálogo y las páginas de contenido con URL absoluta y lastmod', async () => {
    const entries = await sitemap();
    vi.useRealTimers();
    const urls = entries.map((e) => e.url);
    for (const p of ['/es', '/es/catalog', ...CONTENT_PATHS]) {
      expect(urls).toContain(`https://tcghunt.mx${p}`);
    }
    for (const e of entries) expect(e.lastModified).toBeTruthy();
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

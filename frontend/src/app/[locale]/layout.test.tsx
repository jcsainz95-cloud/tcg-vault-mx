import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `next/font/google` solo existe bajo el compilador de Next: en vitest se sustituye por el
 * mismo contrato que consume el layout (un objeto con `variable`). No se está testeando la
 * fuente, se está testeando el `<head>`.
 */
vi.mock('next/font/google', () => {
  const font = () => ({ variable: '--font-stub', className: 'font-stub' });
  return { Archivo: font, JetBrains_Mono: font, Montserrat: font };
});
vi.mock('next/font/local', () => ({
  default: () => ({ variable: '--font-stub', className: 'font-stub' }),
}));
// `@/i18n/navigation` arrastra `createNavigation` de next-intl, que en ESM puro no resuelve
// `next/navigation` fuera del compilador de Next. Es el mismo stub que usa el resto de la
// suite; nada de lo que este test asegura pasa por la navegación.
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: () => {} }),
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
// El provider real infiere el `locale` del contexto de servidor de Next, que aquí no existe.
// Pasarela transparente: lo que este test mira es el `<head>`, que va FUERA del provider.
vi.mock('next-intl', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('next-intl')),
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('next-intl/server', () => ({
  getMessages: async () => ({}),
  getTranslations: async () => (key: string) => key,
}));

import LocaleLayout from './layout';

/**
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * CANDADO del `preconnect` de `171f24b` (M-1). La conducta era correcta y QA la verificó a
 * mano contra el HTML servido, pero NADA la sujetaba: borrar las dos líneas del `<head>` no
 * ponía un solo test en rojo, y una mejora invisible para la suite es una mejora que el
 * siguiente refactor deshace sin enterarse.
 *
 * Qué protege: TODAS las imágenes de carta vienen de un TERCERO. Sin `preconnect`, el
 * navegador solo empieza DNS + TCP + TLS al descubrir el primer `<img>`, y paga ese handshake
 * completo antes del primer byte de píxel.
 *
 * SON DOS HOSTS (el conjunto cerrado de `next.config.mjs`/`SET_IMAGE_HOSTS`): el histórico
 * `images.pokemontcg.io` y el vigente `images.scrydex.com` (arte de los sets nuevos desde
 * 2026-09). El segundo se añadió al cerrar el hueco de perf de imágenes: preconectar solo el
 * CDN viejo dejaba frío el handshake justo para las cartas más recientes. Si alguien quita uno
 * de los dos, este candado se pone rojo.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */
async function head(locale = 'es') {
  const tree = await LocaleLayout({ children: null, params: Promise.resolve({ locale }) });
  return renderToStaticMarkup(tree);
}

describe('LocaleLayout · <head> (PERF, candado)', () => {
  it('adelanta la conexión al CDN histórico: preconnect + dns-prefetch de respaldo', async () => {
    const html = await head();
    expect(html).toContain('<link rel="preconnect" href="https://images.pokemontcg.io"/>');
    expect(html).toContain('<link rel="dns-prefetch" href="https://images.pokemontcg.io"/>');
  });

  it('adelanta la conexión al CDN vigente (scrydex): las cartas nuevas también se calientan', async () => {
    const html = await head();
    // Hueco de perf cerrado: el arte de los sets nuevos vive en images.scrydex.com y antes
    // pagaba el handshake frío entero al aparecer su primer <img>.
    expect(html).toContain('<link rel="preconnect" href="https://images.scrydex.com"/>');
    expect(html).toContain('<link rel="dns-prefetch" href="https://images.scrydex.com"/>');
  });

  it('SIN `crossorigin`: un <img> normal no se pide en modo CORS y abriría otra conexión', async () => {
    const html = await head();
    // NINGÚN preconnect lleva crossorigin, no solo el primero.
    for (const tag of html.match(/<link rel="preconnect"[^>]*>/g) ?? []) {
      expect(tag).not.toContain('crossorigin');
    }
  });

  it('solo ESOS dominios: preconectar a hosts que quizá no se usen desperdicia conexiones', async () => {
    const html = await head();
    // Exactamente los dos hosts del conjunto cerrado (next.config/SET_IMAGE_HOSTS): ni uno más.
    expect(html.match(/rel="preconnect"/g)).toHaveLength(2);
    // El CDN de sellado vive bajo el pliegue (SealedShelf): ahí `lazy` + conexión tardía es
    // el comportamiento correcto, no una omisión.
    expect(html).not.toContain('tcgplayer-cdn.tcgplayer.com');
  });
});

/**
 * CANDADO de P-FONTS-CJK. `Zen_Old_Mincho` de `next/font/google` ignora `subsets: ['latin']`
 * (familia CJK troceada por Google): generaba 366 woff2 y el layout precargaba 242. Se sirve
 * un subconjunto latino local. Si alguien vuelve a importar una familia CJK de Google, o el
 * subconjunto crece hasta volver a ser la fuente entera, esto se pone rojo.
 */
describe('LocaleLayout · fuentes (PERF, candado P-FONTS-CJK)', () => {
  const here = join(process.cwd(), 'src/app/[locale]');
  const fontsDir = join(process.cwd(), 'src/app/fonts/zen-old-mincho');

  it('no importa familias CJK de next/font/google (troceo de ~122 ficheros por peso)', () => {
    const src = readFileSync(join(here, 'layout.tsx'), 'utf8');
    const googleImport = src.match(/import\s*\{([^}]*)\}\s*from\s*'next\/font\/google'/)?.[1] ?? '';
    expect(googleImport).not.toMatch(/Mincho|Gothic|Noto_Sans_JP|Noto_Serif_JP|Maru|Kaku|_JP|_SC|_TC|_KR/);
  });

  it('sirve Zen Old Mincho como 3 woff2 latinos pequeños (400/500/600), con su licencia OFL', () => {
    const files = readdirSync(fontsDir);
    const woff2 = files.filter((f) => f.endsWith('.woff2')).sort();
    expect(woff2).toEqual([
      'zen-old-mincho-latin-400.woff2',
      'zen-old-mincho-latin-500.woff2',
      'zen-old-mincho-latin-600.woff2',
    ]);
    // La fuente completa pesa ~5 MB por peso; el subconjunto latino ~16 KB.
    for (const f of woff2) expect(statSync(join(fontsDir, f)).size).toBeLessThan(64 * 1024);
    expect(files).toContain('OFL.txt');
  });
});

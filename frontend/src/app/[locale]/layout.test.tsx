import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * `next/font/local` solo existe bajo el compilador de Next: en vitest se sustituye por el mismo
 * contrato que consume el layout (un objeto con `variable`). El stub GUARDA los argumentos de cada
 * llamada para que el candado de §109.fonts compruebe familias, pesos, `display` y variables.
 */
type LocalFontArgs = {
  src: { path: string; weight: string; style: string }[];
  display: string;
  variable: string;
  declarations?: { prop: string; value: string }[];
  fallback?: string[];
  adjustFontFallback?: string | false;
};
const fontCalls = vi.hoisted(() => [] as LocalFontArgs[]);
vi.mock('next/font/local', () => ({
  default: (args: LocalFontArgs) => {
    fontCalls.push(args);
    return { variable: `var-class${args.variable}`, className: 'font-stub' };
  },
}));
// El layout importa la hoja de tramos no latinos; en vitest el CSS no aporta nada al `<head>`.
vi.mock('../fonts/google-subsets.css', () => ({}));
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

// LIVE-3: el layout lee la petición (nonce) para forzar el render dinámico.
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-nonce': 'TESTNONCE' }) }));
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
    // Desde §109.fonts no queda NINGÚN import de next/font/google (candado de abajo); este se
    // conserva por si alguien lo reintroduce: lo primero que no debe volver es una familia CJK.
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

/**
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * CANDADO de §109.fonts (FRONTEND_NOTES). `next/font/google` descargaba las fuentes en CADA
 * `next build` y el build caía de forma intermitente (`An error occurred in \`next/font\`.
 * TypeError: Cannot read properties of null (reading '1')`, CI de la #84; 2 de 5 builds en la
 * medición de devops). Ahora son ficheros del repo con sha256 fijado, servidos por
 * `next/font/local` (tramo latin, precargado) + `src/app/fonts/google-subsets.css` (tramos no
 * latinos y métricas de respaldo). Se mide además que el build pasa SIN red.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */
describe('LocaleLayout · fuentes sin red en el build (candado §109.fonts)', () => {
  const srcDir = join(process.cwd(), 'src');
  const fontsRoot = join(srcDir, 'app/fonts');

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  }

  it('ningún fichero de src/ importa ni mockea next/font/google (descarga de un tercero en build)', () => {
    const culpables = walk(srcDir)
      .filter((p) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p))
      .filter((p) => /(from\s*|import\(\s*|require\(\s*|vi\.mock\(\s*)['"]next\/font\/google['"]/.test(readFileSync(p, 'utf8')))
      .map((p) => relative(srcDir, p));
    expect(culpables).toEqual([]);
  });

  it('expone EXACTAMENTE las cuatro variables de siempre, todas con display swap', async () => {
    const html = await head();
    const vars = fontCalls.map((c) => c.variable).sort();
    expect(vars).toEqual(['--font-brand', '--font-mono', '--font-sans', '--font-serif']);
    for (const c of fontCalls) {
      expect(c.display).toBe('swap');
      expect(html).toContain(`var-class${c.variable}`);
    }
  });

  const LATIN =
    'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
  const byVar = (v: string) => fontCalls.find((c) => c.variable === v)!;
  const decl = (c: LocalFontArgs, prop: string) => c.declarations?.find((d) => d.prop === prop)?.value;

  it.each([
    ['--font-sans', "'Archivo'", ['400', '500', '600', '700'], 'archivo/archivo-latin.woff2'],
    ['--font-mono', "'JetBrains Mono'", ['400', '500'], 'jetbrains-mono/jetbrains-mono-latin.woff2'],
    ['--font-brand', "'Montserrat'", ['700'], 'montserrat/montserrat-700-latin.woff2'],
  ])('%s: misma familia, pesos y tramo latin que daba next/font/google', (v, family, weights, file) => {
    const c = byVar(v);
    expect(decl(c, 'font-family')).toBe(family);
    expect(decl(c, 'unicode-range')).toBe(LATIN);
    expect(c.src.map((s) => s.weight)).toEqual(weights);
    for (const s of c.src) {
      expect(s.path).toBe(`../fonts/${file}`);
      expect(s.style).toBe('normal');
    }
    // Las métricas de respaldo son las de Google (en google-subsets.css), no las de fontkit.
    expect(c.adjustFontFallback).toBe(false);
    expect(c.fallback).toEqual([`'${family.slice(1, -1)} Fallback'`]);
  });

  it('Archivo conserva font-stretch 100% (Google lo declaraba: la familia tiene eje de anchura)', () => {
    expect(decl(byVar('--font-sans'), 'font-stretch')).toBe('100%');
  });

  /*
   * Bytes fijados: los MISMOS que servía fonts.gstatic.com (comparado sha a sha con el
   * `.next/static/media` del build con `next/font/google`). Si un fichero cambia, este candado se
   * pone rojo: actualizarlo es una decisión consciente (FRONTEND_NOTES §109.fonts).
   */
  const SHA256: Record<string, string> = {
    'archivo/OFL.txt': '108b4e57c9c796d3d38d0428ca7ee39de47ad93187302718d9b2d8864b9b716b',
    'archivo/archivo-latin-ext.woff2': 'a999e009fdcd0f939c138e04043b3b2ad083b26252b644e8f94c083d48b77af0',
    'archivo/archivo-latin.woff2': '7150c0ec5ad356453013d11affec1fbab95de0dd2dcecb043b4f1cb7f87c4ba4',
    'archivo/archivo-vietnamese.woff2': '2518e8eb97cd2b36dbf380d085e47bbc0df5c32fc6adc32fe1ca6edce192cee0',
    'jetbrains-mono/OFL.txt': 'b2fe5e8987594e9ffd1d2ca52a2f5d73eb8335243893c5d6254b5ad69269591d',
    'jetbrains-mono/jetbrains-mono-cyrillic-ext.woff2': '9343de2ca5d9549f792e7962375af8efb0f320c7643bfd36c884b5a30e5c396f',
    'jetbrains-mono/jetbrains-mono-cyrillic.woff2': '4995a9a43ac659ec32fcd8b463755cd6a07b31a6e6b3894a6a153b661cf490e2',
    'jetbrains-mono/jetbrains-mono-greek.woff2': '49c3da6c9a2b279b0f1f860f5cfb1f5dc38d88a5c7be9c9b1837bbc4e3db6111',
    'jetbrains-mono/jetbrains-mono-latin-ext.woff2': '9c38cb2d0d2d93c1ee6e21fa78db76f13ea7e15e15cc64214c7ca89b6aaa35c4',
    'jetbrains-mono/jetbrains-mono-latin.woff2': '2c32b9b3ee358c119e210f6f5195f9bd34894d78a785ff2e95d60e718e400af4',
    'jetbrains-mono/jetbrains-mono-vietnamese.woff2': 'd44eb1936043a56038eb02dd70b243f379bef65783f94ec12f277550720411f1',
    'montserrat/OFL.txt': '8b7141c03fa4f8d44e6345d5d4931709290f0f67875e452e95ac1fd3a027802e',
    'montserrat/montserrat-700-cyrillic-ext.woff2': 'ac546836f896a172f9361e19e7b27993483f3c4c3832a52de69138b1d6500cf0',
    'montserrat/montserrat-700-cyrillic.woff2': 'c2e32221aabf8f4c530ad3cc0ceb82b415f519d9ba81542f9908a272863131b0',
    'montserrat/montserrat-700-latin-ext.woff2': 'd074d0a4403893475caf4f7f23fb039590da59c6065b8bfd756a431195a1c1b5',
    'montserrat/montserrat-700-latin.woff2': 'cbcba0f7387dfa1ddb2e375f4ee04ea0dd733c94f0d0f4015baf425dcf9c1580',
    'montserrat/montserrat-700-vietnamese.woff2': '1140ab317ea365d8ff783238cd7d522a04ae6411ed2cd1191176189741cef3d0',
  };

  it('los ficheros de fuente y sus OFL son exactamente los fijados (ni uno más, ni uno cambiado)', () => {
    const found = ['archivo', 'jetbrains-mono', 'montserrat']
      .flatMap((d) => readdirSync(join(fontsRoot, d)).map((f) => `${d}/${f}`))
      .sort();
    expect(found).toEqual(Object.keys(SHA256).sort());
    for (const [rel, sha] of Object.entries(SHA256)) {
      const got = createHash('sha256').update(readFileSync(join(fontsRoot, rel))).digest('hex');
      expect(got, rel).toBe(sha);
    }
  });

  it('las licencias son SIL OFL 1.1 (permite redistribuir empaquetada con software)', () => {
    for (const d of ['archivo', 'jetbrains-mono', 'montserrat']) {
      expect(readFileSync(join(fontsRoot, d, 'OFL.txt'), 'utf8')).toContain('SIL Open Font License, Version 1.1');
    }
  });

  it('google-subsets.css: cada fichero NO latino referenciado, sin URL externa, y las 3 caras Fallback de Google', () => {
    const css = readFileSync(join(fontsRoot, 'google-subsets.css'), 'utf8');
    expect(css).not.toMatch(/url\(\s*['"]?(https?:)?\/\//);
    const urls = [...css.matchAll(/url\('\.\/([^']+)'\)/g)].map((m) => m[1]);
    const nonLatin = Object.keys(SHA256).filter((k) => k.endsWith('.woff2') && !k.endsWith('-latin.woff2'));
    expect([...new Set(urls)].sort()).toEqual(nonLatin.sort());
    // 4 pesos × 2 tramos (Archivo) + 2 × 5 (JetBrains Mono) + 1 × 4 (Montserrat).
    expect(urls).toHaveLength(22);
    expect(css).not.toMatch(/-latin\.woff2/);
    expect(css).toContain(
      "@font-face {font-family: 'Archivo Fallback';src: local(\"Arial\");ascent-override: 88.96%;descent-override: 21.28%;line-gap-override: 0.00%;size-adjust: 98.70%}",
    );
    expect(css).toContain(
      "@font-face {font-family: 'JetBrains Mono Fallback';src: local(\"Arial\");ascent-override: 75.79%;descent-override: 22.29%;line-gap-override: 0.00%;size-adjust: 134.59%}",
    );
    expect(css).toContain(
      "@font-face {font-family: 'Montserrat Fallback';src: local(\"Arial\");ascent-override: 85.79%;descent-override: 22.25%;line-gap-override: 0.00%;size-adjust: 112.83%}",
    );
  });
});

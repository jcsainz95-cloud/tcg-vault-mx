/**
 * 🔒 CANDADO D-IMG-5 — `images.remotePatterns` no puede volver a admitir un host arbitrario.
 *
 * ## Por qué existe este fichero
 * El 2026-08-23 entró en `next.config.mjs` un `{ protocol: 'https', hostname: '**' }`. Sobrevivió
 * **dos semanas** en producción sin que lo señalara NADIE: no está en `SECURITY_NOTES`, ni en
 * `PENTEST_NOTES`, ni en `TECH_DEBT`, ni en `FRONTEND_NOTES`. Lo encontró el blue team en el cierre
 * de release del 2026-09-08 (hallazgo **A-1**), agravando un `next@15.5.23` vulnerable a
 * **GHSA-2xp9-vwfh-vxw4** (RCE sin autenticar en el optimizador de imágenes, vía AVIF): el comodín
 * es *justo* la precondición del aviso, porque deja que un tercero elija QUÉ imagen —y de qué
 * servidor— procesa nuestro despliegue.
 *
 * Una revisión humana ya falló una vez. Por eso el guardarraíl es un test, no una nota.
 *
 * ## Qué mide, y por qué así
 * Mide **CONDUCTA, no texto**. Un test que hiciera `expect(fuente).not.toContain("'**'")` sería
 * teatro: pasa en verde con `hostname: '*'`, con `'**.io'`, con un `images.domains` heredado, o con
 * el comodín construido por concatenación. Aquí se hace la única pregunta que importa —
 * **«¿esta configuración aceptaría una URL de un host que controla el atacante?»**— y se hace con
 * `hasRemoteMatch`, **el mismo matcher que Next ejecuta en `/_next/image`**. Si el matcher dice que
 * sí, el optimizador diría que sí.
 *
 * Se evalúa la **política efectiva**, que son DOS campos, no uno: `remotePatterns` y el legacy
 * `images.domains`. Reintroducir el agujero por `domains` es igual de fácil y el candado también
 * lo cubre.
 *
 * ⚠️ Este control es **independiente de que hoy exista o no `next/image`** en el árbol. `/_next/image`
 * lo sirve el servidor de Next **siempre**, lo importe o no un componente nuestro: hoy el arte de
 * carta y los logos de set son Nivel B (`<img>` crudo, ARCHITECTURE §4.41.7), así que el comodín
 * era *inerte de cara al render* pero **NUNCA inerte de cara al endpoint**.
 *
 * ## Si este test se pone rojo
 * NO lo relajes ni lo borres. Cerrarlo tiene una sola forma correcta: si necesitas un host nuevo,
 * **añade el host exacto** a `remotePatterns` — detrás del backend, nunca por delante (§5.3.4) —
 * y añádelo también a `HOSTS_QUE_DEBEN_PASAR` de abajo, con su procedencia.
 */
import { describe, expect, it } from 'vitest';
import { hasRemoteMatch } from 'next/dist/shared/lib/match-remote-pattern.js';
import { imageConfigDefault } from 'next/dist/shared/lib/image-config.js';
import { ImageOptimizerCache } from 'next/dist/server/image-optimizer.js';

// El config REAL, tal cual lo carga Next (pasa por el plugin de next-intl). Importarlo —en vez de
// redeclarar los patrones aquí— es lo que hace que el candado vigile el fichero de verdad: una
// copia local se quedaría en verde mientras `next.config.mjs` se pudre.
import nextConfig from '../../next.config.mjs';

type RemotePatternish = Parameters<typeof hasRemoteMatch>[1][number];

const images = (nextConfig as { images?: { remotePatterns?: unknown; domains?: unknown } }).images;

const remotePatterns = (images?.remotePatterns ?? []) as RemotePatternish[];
const domains = (images?.domains ?? []) as string[];

/** ¿Aceptaría el optimizador de Next esta URL con la config vigente? */
function optimizerWouldAccept(url: string): boolean {
  return hasRemoteMatch(domains, remotePatterns, new URL(url));
}

/**
 * Los dos hosts legítimos, con su procedencia. Espejo de `SET_IMAGE_HOSTS`
 * (`backend/src/modules/catalog/catalog-sync.service.ts`). Desde PEN-DYN-1 cada URL tiene además la
 * forma REAL del arte de carta (medida el 2026-10-30 contra la API del proveedor, FRONTEND_NOTES §DYN.6).
 */
const HOSTS_QUE_DEBEN_PASAR = [
  // CDN histórico: arte de ~19 818 cartas y logos de todos los sets hasta 2026-08.
  'https://images.pokemontcg.io/sv8/logo.png',
  'https://images.pokemontcg.io/base1/4_hires.png',
  // CDN vigente desde 2026-09 (sets me2pt5/me3/me4/me5 en adelante). Ya servía arte de 661 cartas
  // en producción antes de admitirse en la lista del backend (ARCHITECTURE §4.41.1 hecho 8).
  'https://images.scrydex.com/pokemon/me3-1/large',
];

describe('D-IMG-5 · images.remotePatterns no admite hosts arbitrarios', () => {
  it('la config expone una política de imagen inspeccionable (si esto falla, el resto no mide nada)', () => {
    // Guarda de integridad del propio candado: si alguien renombra o borra `images.remotePatterns`,
    // `hasRemoteMatch` recibiría `[]` y TODO pasaría a denegado ⇒ los asserts de abajo seguirían
    // verdes por la razón equivocada y el candado se volvería decorativo sin avisar.
    expect(Array.isArray(remotePatterns)).toBe(true);
    expect(remotePatterns.length).toBeGreaterThan(0);
  });

  it('🔴 RECHAZA un host arbitrario controlado por el atacante', () => {
    const hostilURLs = [
      // El caso canónico del aviso: el atacante sirve el AVIF desde su propio servidor.
      'https://evil.example/payload.avif',
      'https://attacker.test/x.png',
      // Sufijo controlado por el atacante sobre un host bueno (rompe cualquier `startsWith`).
      'https://images.pokemontcg.io.evil.example/x.png',
      'https://images.scrydex.com.evil.example/x.png',
      // Subdominio de un host bueno: es OTRO endpoint, nunca verificado (rompe `endsWith`).
      'https://cdn.images.pokemontcg.io/x.png',
      'https://cdn.images.scrydex.com/x.png',
      // Host bueno como subdominio del malo.
      'https://images.pokemontcg.io.attacker.test/x.png',
      // SSRF a la red interna / metadatos de la nube.
      'https://169.254.169.254/latest/meta-data/',
      'https://localhost/x.png',
      'https://127.0.0.1/x.png',
      // userinfo: el host REAL es el de después de la `@`.
      'https://images.pokemontcg.io@evil.example/x.png',
      // Puerto distinto = endpoint distinto.
      'https://images.pokemontcg.io:8443/x.png',
    ];

    for (const url of hostilURLs) {
      expect(optimizerWouldAccept(url), `el optimizador NO debe aceptar ${url}`).toBe(false);
    }
  });

  it('🔴 RECHAZA hosts aleatorios (un comodín no se puede esconder de esto)', () => {
    // Property-style: hosts irrepetibles generados en tiempo de ejecución. Ningún literal que
    // alguien pueda haber añadido a la allowlist «para que el test pase» los cubre; solo un
    // comodín real los aceptaría. Es la prueba que un assert sobre el texto del fichero no da.
    for (let i = 0; i < 250; i += 1) {
      const host = `h${Math.random().toString(36).slice(2)}${i}.example`;
      const url = `https://${host}/img.avif`;
      expect(optimizerWouldAccept(url), `el optimizador NO debe aceptar ${url}`).toBe(false);
    }
  });

  it('🔴 RECHAZA http:// incluso en los hosts admitidos (solo https, §5.3.4)', () => {
    expect(optimizerWouldAccept('http://images.pokemontcg.io/sv8/logo.png')).toBe(false);
    expect(optimizerWouldAccept('http://images.scrydex.com/pokemon/me3-1/large')).toBe(false);
  });

  it('✅ SIGUE ACEPTANDO los dos hosts legítimos de logos de set', () => {
    // La otra mitad del candado: impide «arreglar» un rojo vaciando la lista. Cerrar de más
    // rompería los logos de los sets nuevos (me2pt5/me3/me4/me5+) el día que alguna superficie
    // suba a Nivel A, que es exactamente el fallo que este proyecto ya conoce.
    for (const url of HOSTS_QUE_DEBEN_PASAR) {
      expect(optimizerWouldAccept(url), `el optimizador DEBE aceptar ${url}`).toBe(true);
    }
  });

  it('🔴 el legacy images.domains no reabre el agujero por la puerta de atrás', () => {
    // `domains` está deprecado, pero Next lo sigue honrando y acepta el host ENTERO sin patrón.
    // Si alguien lo reintroduce, la política efectiva se ensancha sin tocar `remotePatterns`.
    expect(domains).toEqual([]);
  });
});

/**
 * 🔒 PEN-DYN-1 (pentest §DYN, 2026-10-30) — un origen por imagen, no uno por URL.
 *
 * Sin `search` ni `pathname`, `/_next/image?url=…/4_hires.png?v=<n>` daba una imagen de origen NUEVA por cada `v`
 * (10/10 `MISS`, medido por el pentester contra `next start`): transformaciones facturables sin tope. `search: ''` ⇒
 * cero query; `pathname` ⇒ solo la forma del arte de carta. Las URLs legítimas son reales: el catálogo del proveedor
 * (las formas de `images.small`/`images.large`, incluidas las rarezas `!_hires` y `question_hires` de ex10), el
 * seed (`backend/prisma/seed.ts`) y los mocks (`lib/mock/*`). Mutación medida: quitar `search: ''` ⇒ rojo.
 */
describe('PEN-DYN-1 · remotePatterns: sin query y solo la forma del arte de carta', () => {
  const LEGITIMAS = [
    // pokemontcg.io: `/<set>/<número>.png` y `_hires`, más logo/símbolo del set.
    'https://images.pokemontcg.io/base1/4.png',
    'https://images.pokemontcg.io/base1/4_hires.png',
    'https://images.pokemontcg.io/sv3pt5/199_hires.png',
    'https://images.pokemontcg.io/swsh12pt5gg/GG70_hires.png',
    'https://images.pokemontcg.io/ex10/!_hires.png',
    'https://images.pokemontcg.io/ex10/question_hires.png',
    'https://images.pokemontcg.io/cel25/logo.png',
    'https://images.pokemontcg.io/sv8/symbol.png',
    // scrydex: `/pokemon/<set>-<número>/large|small` (la líder usa `imageLargeUrl ?? imageSmallUrl`).
    'https://images.scrydex.com/pokemon/me3-1/large',
    'https://images.scrydex.com/pokemon/me3-1/small',
    'https://images.scrydex.com/pokemon/me2pt5-12/large',
    // El arnés DYN-D3 de devops (`scripts/home-perf/run.sh`, IMG_REMOTO + `<externalId>[_hires].png` del seed E2E).
    'https://images.scrydex.com/e2e/e2e-charizard_hires.png',
    'https://images.scrydex.com/e2e/e2e-charizard.png',
  ];

  it('✅ acepta las formas reales del arte de carta', () => {
    for (const url of LEGITIMAS) expect(optimizerWouldAccept(url), `DEBE aceptar ${url}`).toBe(true);
  });

  it('🔴 rechaza cualquier query string sobre una URL legítima (el vector medido: ?v=<n>)', () => {
    for (const url of LEGITIMAS) {
      for (const q of ['?v=1', '?v=2', '?utm_source=mail', '?a', `?${Math.random().toString(36).slice(2)}`]) {
        expect(optimizerWouldAccept(`${url}${q}`), `NO debe aceptar ${url}${q}`).toBe(false);
      }
    }
  });

  it('🔴 rechaza rutas fuera de la forma (otra ruta del CDN, alias por %-codificación, otro tamaño)', () => {
    const fuera = [
      // Ruta arbitraria del CDN (la otra mitad del vector: «cualquier ruta del CDN también vale»).
      'https://images.pokemontcg.io/x',
      'https://images.pokemontcg.io/a/b/c.png',
      'https://images.pokemontcg.io/base1/4.png/x',
      'https://images.pokemontcg.io/base1/4.jpg',
      'https://images.pokemontcg.io//4.png',
      // %-codificación: el CDN sirve `/base1/%34.png` igual que `/base1/4.png` (200, medido) ⇒ alias.
      'https://images.pokemontcg.io/base1/%34.png',
      'https://images.pokemontcg.io/base%31/4.png',
      'https://images.scrydex.com/pokemon/me3-%31/large',
      // scrydex: otro tamaño, logo, mayúsculas, raíz, barra final.
      'https://images.scrydex.com/pokemon/me3-1/medium',
      'https://images.scrydex.com/pokemon/me3-logo/logo',
      'https://images.scrydex.com/pokemon/ME3-1/large',
      'https://images.scrydex.com/pokemon/me3-1/large/',
      'https://images.scrydex.com/me3/logo.png',
      'https://images.scrydex.com/x.png',
      'https://images.scrydex.com/e2e/a/b.png',
    ];
    for (const url of fuera) expect(optimizerWouldAccept(url), `NO debe aceptar ${url}`).toBe(false);
  });

  it('cada patrón fija `search` y `pathname` (si un patrón nuevo los omite, empata cualquier query o ruta)', () => {
    for (const p of remotePatterns) {
      expect(p.search, `search de ${p.hostname}`).toBe('');
      expect(typeof p.pathname === 'string' && p.pathname !== '**', `pathname de ${p.hostname}`).toBe(true);
    }
  });
});

/**
 * 🔒 DYN-F8 (b) · API_CONTRACT §DYN.6.6, ARCHITECTURE §4.DYN (f) 7 (opción A del dueño, `HECHOS` 2026-10-30) — los
 * parámetros del optimizador (reglas de coste 1–3 de §5.3.3: a lo sumo 2 transformaciones por imagen origen). Se mide
 * con `ImageOptimizerCache.validateParams`, el MISMO portero que corre `/_next/image` (`next` 15.5.28 admite
 * `qualities`: esquema `config-schema.js:580` y `image-optimizer.js:691`). La versión contra `next start` es
 * `e2e/lead-image.spec.ts` (b). Mutación medida: añadir 1080 a los anchos ⇒ rojo.
 */
describe('DYN-F8 (b) · parámetros del optimizador', () => {
  const img = (nextConfig as unknown as { images: Record<string, unknown> }).images;
  const conf = { images: { ...imageConfigDefault, ...img } };
  const ask = (w: number, q: number) =>
    (
      ImageOptimizerCache as unknown as {
        validateParams: (
          req: { headers: Record<string, string> },
          query: Record<string, string>,
          c: unknown,
          isDev: boolean,
        ) => { errorMessage?: string; mimeType?: string };
      }
    ).validateParams(
      { headers: { accept: 'image/avif,image/webp,*/*' } },
      { url: 'https://images.scrydex.com/pokemon/me5-88/large', w: String(w), q: String(q) },
      conf,
      false,
    );

  it('formats = solo WebP; anchos = {384, 640}; qualities = [75]; minimumCacheTTL ≥ 30 días', () => {
    expect(img.formats).toEqual(['image/webp']);
    expect(new Set([...(img.deviceSizes as number[]), ...(img.imageSizes as number[])])).toEqual(new Set([384, 640]));
    expect(img.qualities).toEqual([75]);
    expect(img.minimumCacheTTL as number).toBeGreaterThanOrEqual(2_592_000);
  });

  it('el portero de /_next/image: 384 y 640 con q=75 pasan (WebP aunque se pida AVIF); w=1080 o q=90 ⇒ rechazo', () => {
    for (const w of [384, 640]) {
      const r = ask(w, 75);
      expect(r.errorMessage, `w=${w}`).toBeUndefined();
      expect(r.mimeType).toBe('image/webp');
    }
    expect(ask(1080, 75).errorMessage).toMatch(/width/);
    expect(ask(640, 90).errorMessage).toMatch(/quality/);
  });
});

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import createNextIntlPlugin from 'next-intl/plugin';
import { measurementCspConnectFor, measurementModeOf } from './src/security/measurement-origins.mjs';
import { imageOptimizerKillSwitchOf } from './src/lib/image-optimizer-switch.mjs';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// Directorio de build parametrizable. Lo usa el `webServer` de Playwright para hornear su
// bundle de MOCKS (`NEXT_PUBLIC_USE_MOCKS=true`) en `.next-e2e-mock[-<agente>]` en vez de pisar el
// `.next` del stack que devops pueda tener corriendo: dos artefactos con banderas distintas
// no pueden compartir carpeta sin convertir un `next start` ajeno en modo fixtures.
const distDir = process.env.NEXT_DIST_DIR || '.next';

/**
 * Hallazgo #1 de QA (2026-09-11) — **`next build` con un `distDir` distinto de `.next` reescribía
 * `tsconfig.json`**: `verifyTypeScriptSetup` (`next/dist/lib/typescript/writeConfigurationDefaults.js`)
 * exige que el `include` del tsconfig que usa el build contenga `${distDir}/types/…` (la entrada de tipos generados del build), y si no
 * está lo AÑADE y re-serializa el fichero entero (reformateo + una entrada por cada `.next-e2e-mock-*`
 * que haya horneado cada agente). El `include` commiteado arrastraba `.next-e2e-mock/types` desde
 * `46d76cc` por eso mismo.
 *
 * Remedio: el build de un `distDir` alternativo usa SU PROPIO tsconfig (`typescript.tsconfigPath`),
 * generado aquí en cada arranque y que **ya trae** lo que Next querría añadir — `extends` del principal
 * (compilerOptions + plugin `next` resueltos por herencia, así `hasNextPlugin` es true), el `include` del
 * principal con `.next/types` sustituido por `${distDir}/types`, y `exclude`. Con todo presente,
 * `writeConfigurationDefaults` no tiene ninguna «suggestedAction» y **no escribe nada**; y aunque
 * escribiera, escribiría en el generado, que está en `.gitignore` (`/tsconfig.next-*.json`), nunca en el
 * commiteado. El `tsconfig.json` del repo queda con `.next/types` y nada más.
 *
 * No aplica al build normal (`distDir === '.next'`): ahí Next usa `tsconfig.json`, cuyo `include` ya
 * contiene `.next/types/…` (la entrada de tipos generados), y tampoco escribe. Candado: `next.config.tsconfig-path.test.ts`.
 */
export function tsconfigPathForDistDir(dir, { baseDir = dirname(fileURLToPath(import.meta.url)) } = {}) {
  if (!dir || dir === '.next') return 'tsconfig.json';
  const base = JSON.parse(readFileSync(join(baseDir, 'tsconfig.json'), 'utf8'));
  const baseInclude = Array.isArray(base.include) ? base.include : [];
  const distTypes = `${dir}/types/**/*.ts`;
  const include = baseInclude
    .filter((entry) => entry !== '.next/types/**/*.ts' && entry !== distTypes)
    .concat(distTypes);
  const generated = {
    // Generado por next.config.mjs para NEXT_DIST_DIR=<dir>. No se edita ni se commitea.
    extends: './tsconfig.json',
    include,
    exclude: Array.isArray(base.exclude) ? base.exclude : ['node_modules'],
  };
  const name = `tsconfig.${dir.replace(/^\.+/, '')}.json`;
  const target = join(baseDir, name);
  const content = JSON.stringify(generated, null, 2) + '\n';
  let current = null;
  try {
    current = readFileSync(target, 'utf8');
  } catch {
    current = null;
  }
  if (current !== content) writeFileSync(target, content);
  return name;
}

/**
 * §MKT.H.1 / ARCHITECTURE §14.1 — el interruptor de la Fase 2 se hornea SIEMPRE como literal
 * normalizado (`off` | `on`), también cuando la variable no está: así el compilador evalúa
 * `process.env.NEXT_PUBLIC_MEASUREMENT_MODE === 'on'` en cada sitio y, con `off`, no recorre la rama
 * del cargador (candado C-F1). Los IDs se hornean tal cual (cadena vacía si faltan); `lib/measurement`
 * valida su forma. `TH_MEASUREMENT_CSP_CONNECT` = orígenes de `connect-src` solo con `on` (C-F7).
 *
 * @param {Record<string, string | undefined>} [env]
 */
export const measurementBuildEnv = (env = process.env) => {
  const mode = measurementModeOf(env.NEXT_PUBLIC_MEASUREMENT_MODE);
  return {
    NEXT_PUBLIC_MEASUREMENT_MODE: mode,
    NEXT_PUBLIC_GA4_MEASUREMENT_ID: mode === 'on' ? (env.NEXT_PUBLIC_GA4_MEASUREMENT_ID ?? '') : '',
    NEXT_PUBLIC_META_PIXEL_ID: mode === 'on' ? (env.NEXT_PUBLIC_META_PIXEL_ID ?? '') : '',
    TH_MEASUREMENT_CSP_CONNECT: measurementCspConnectFor(mode),
    // Solo builds de MOCKS (E2E con `on`, nunca se publican): versión de aviso de prueba para poder
    // recorrer el banner sin `measurementDisclosure`. Desde el 2026-10-26 el aviso real declara, y su versión
    // gana (`notice-version.ts`): esta solo cuenta si la declaración vuelve a null. Un build real hornea ''.
    NEXT_PUBLIC_MEASUREMENT_E2E_NOTICE_VERSION:
      mode === 'on' && env.NEXT_PUBLIC_USE_MOCKS === 'true' ? (env.NEXT_PUBLIC_MEASUREMENT_E2E_NOTICE_VERSION ?? '') : '',
  };
};

/**
 * TL D7 (2026-10-19) · C-D1 MÍNIMA en `next.config.mjs`: la puerta completa (`prebuild`) solo corre con
 * `npm run build`; esta corre con CUALQUIER `next build` (y `next dev`/`start`). Modo `on` + declaración
 * nula o incompleta en `measurement-disclosure.ts` ⇒ la configuración lanza y el build falla.
 * Se lee el fichero como TEXTO (un `.mjs` no importa `.ts`). Exención única: bundles de MOCKS
 * (`NEXT_PUBLIC_USE_MOCKS=true`, E2E con `on`) FUERA de Vercel (`VERCEL_ENV` ni `production` ni `preview`,
 * TL-MKT2b-e), que no se publican y hornean su versión de prueba.
 * Alcance (QA menor 1, límite aceptado): solo la DECLARACIÓN (`measurement-disclosure.ts`); los términos del texto
 * los mide la puerta completa (`prebuild`), que es por donde pasan Vercel y `Dockerfile.frontend`. Ver FRONTEND_NOTES.
 * Devuelve el problema o `null`. Candado: `src/lib/next-config-measurement-gate.test.ts`.
 *
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [source] texto de `measurement-disclosure.ts`
 */
export function measurementDisclosureProblem(
  env = process.env,
  source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'src/content/legal/measurement-disclosure.ts'), 'utf8'),
) {
  if (measurementModeOf(env.NEXT_PUBLIC_MEASUREMENT_MODE) !== 'on') return null;
  // TL-MKT2b-e (2026-10-19): la exención de MOCKS vale solo FUERA de un despliegue de Vercel. Un build de Vercel
  // (`production` o `preview`, ambos con URL pública) con `USE_MOCKS=true` no es un E2E: pasa por la puerta.
  const vercelDeploy = env.VERCEL_ENV === 'production' || env.VERCEL_ENV === 'preview';
  if (env.NEXT_PUBLIC_USE_MOCKS === 'true' && !vercelDeploy) return null;
  const decl = source.match(/export const MEASUREMENT_DISCLOSURE\b[^=]*=\s*([^;]*);/);
  if (!decl) return 'no se encontró `export const MEASUREMENT_DISCLOSURE` en measurement-disclosure.ts';
  const value = decl[1].trim();
  if (value === 'null' || value === 'undefined') return 'measurementDisclosure es null: el aviso no declara la medición';
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const field = (name, re) => {
    const m = value.match(new RegExp(`\\b${name}\\s*:\\s*['"]([^'"]*)['"]`));
    return m && re.test(m[1]) ? null : name;
  };
  // v1.111: `legalReviewOn` y `legalReviewWaivedByOwnerOn` son 'AAAA-MM-DD' o `null`, las dos claves siempre
  // escritas (una clave ausente cuenta como mal formada) y EXACTAMENTE una con fecha (misma regla que
  // `measurementNoticeProblems` en measurement-gate.ts).
  const dates = {};
  const dateOrNull = (name) => {
    const m = value.match(new RegExp(`\\b${name}\\s*:\\s*(null\\b|'([^']*)'|"([^"]*)")`));
    if (!m) return name;
    if (m[1] === 'null') return (dates[name] = false), null;
    return DATE.test(m[2] ?? m[3] ?? '') ? ((dates[name] = true), null) : name;
  };
  const bad = [
    field('version', /^[A-Za-z0-9._-]{1,32}$/),
    field('approvedByOwnerOn', DATE),
    dateOrNull('legalReviewOn'),
    dateOrNull('legalReviewWaivedByOwnerOn'),
  ].filter(Boolean);
  if (bad.length > 0) return `measurementDisclosure mal formado: ${bad.join(', ')}`;
  if (dates.legalReviewOn && dates.legalReviewWaivedByOwnerOn) return MEASUREMENT_REVIEW_BOTH;
  if (!dates.legalReviewOn && !dates.legalReviewWaivedByOwnerOn) return MEASUREMENT_REVIEW_NONE;
  return null;
}

/** Mismos textos que `measurement-gate.ts` (paridad en `next-config-measurement-gate.test.ts`). */
export const MEASUREMENT_REVIEW_BOTH =
  'measurementDisclosure con las dos fechas (legalReviewOn y legalReviewWaivedByOwnerOn): debe llevar exactamente una';
export const MEASUREMENT_REVIEW_NONE =
  'measurementDisclosure sin fecha en legalReviewOn ni en legalReviewWaivedByOwnerOn: debe llevar exactamente una';

const disclosureProblem = measurementDisclosureProblem();
if (disclosureProblem) {
  // ⛔ Sin valores de variables (C-F17): solo el modo y el problema de texto.
  throw new Error(`MEASUREMENT_NOTICE_REQUIRED mode=on (next.config): ${disclosureProblem}. Publica el aviso revisado o pon NEXT_PUBLIC_MEASUREMENT_MODE=off.`);
}

/**
 * PERF portada (§DYN.3) — los fixtures de MOCK fuera del bundle de producción.
 *
 * `lib/api.ts` y `lib/marketing-api.ts` importan `lib/mock/*` de forma estática y deciden en cada
 * función con `config.useMocks` (una propiedad de objeto, que el minificador no puede plegar): los
 * fixtures viajaban a todo visitante (chunk de ~51 KB gzip en la portada, medido 2026-10-29).
 *
 * Remedio en dos piezas, las dos de build:
 *  1. `NEXT_PUBLIC_USE_MOCKS` se hornea SIEMPRE como literal `'true'|'false'` (también si falta), así
 *     `config.useMocks` vale lo mismo en servidor y cliente y no puede encenderse en runtime sobre un
 *     build que no trae los fixtures.
 *  2. Con mocks apagados, cada módulo de `src/lib/mock/` (no las pruebas; `.ts`/`.tsx`, también en subcarpetas)
 *     se resuelve a un módulo vacío (`resolve.alias` → `false`). Es seguro porque solo `api.ts` y
 *     `marketing-api.ts` importan `lib/mock`, y toda referencia suya queda bajo `(MOCKS_BUILD && config.useMocks)`;
 *     un módulo vacío no da avisos de «export not found».
 * Candados: `src/test/mock-boundary.test.ts` (R1: quién importa `lib/mock` y que toda referencia esté guardada) y
 * `scripts/check-home-bundle.mjs` (postbuild: el centinela de `lib/mock` en ningún chunk de `.next/static`).
 */
/** @param {Record<string, string | undefined>} [env] */
export const useMocksBuild = (env = process.env) => (env.NEXT_PUBLIC_USE_MOCKS === 'true' ? 'true' : 'false');

/**
 * Alias `false` para cada módulo de `src/lib/mock` (recursivo; `.ts` y `.tsx`; nunca una prueba): la ruta sin
 * extensión (como se importa), la ruta con su extensión y, para un `index`, la carpeta.
 */
export function mockModuleAliases({ baseDir = dirname(fileURLToPath(import.meta.url)) } = {}) {
  const aliases = {};
  const walk = (dir) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, f.name);
      if (f.isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.tsx?$/.test(f.name) || /\.(test|spec)\.tsx?$/.test(f.name) || f.name.endsWith('.d.ts')) continue;
      const base = p.replace(/\.tsx?$/, '');
      aliases[base] = false;
      aliases[p] = false;
      if (/^index\.tsx?$/.test(f.name)) aliases[dir] = false;
    }
  };
  walk(join(baseDir, 'src/lib/mock'));
  return aliases;
}

/**
 * §DYN.6.6 / ARCHITECTURE §4.DYN (f) 7 (opción A del dueño, `HECHOS` 2026-10-30) — parámetros del optimizador
 * (`/_next/image`), que hoy solo usa la foto de la teja LÍDER de Destacadas (`CardImage` con `optimized`).
 * Reglas de coste 1–3 de §5.3.3: a lo sumo 2 transformaciones por imagen origen.
 *  - `formats` solo WebP: AVIF cuesta más CPU por transformación y fue el vector de GHSA-2xp9-vwfh-vxw4.
 *  - anchos permitidos 384 y 640 (la caja de celular, 212 px CSS × DPR 3 ≈ 636): otro `w` ⇒ 400.
 *  - `qualities: [75]`: otro `q` ⇒ 400. La clave existe en `next` 15.5.28 (esquema `config-schema.js` y
 *    `ImageOptimizerCache.validateParams`, leído y probado el 2026-10-30).
 *  - `minimumCacheTTL` 30 días: la URL de una carta no cambia.
 * Candado: `src/lib/next-image-remote-patterns.test.ts` (DYN-F8 b). Ver `docs/FRONTEND_NOTES.md` §DYN.
 */
export const IMAGE_OPTIMIZER = {
  formats: ['image/webp'],
  imageSizes: [384],
  deviceSizes: [640],
  qualities: [75],
  minimumCacheTTL: 2592000,
};

/**
 * Lista de orígenes del optimizador (ver el comentario largo en `images` abajo: procedencia, `port: ''`, PEN-DYN-1).
 * Candado: `src/lib/next-image-remote-patterns.test.ts`.
 */
export const REMOTE_PATTERNS = [
  {
    protocol: 'https',
    hostname: 'images.pokemontcg.io',
    port: '',
    pathname: '/+([a-z0-9])/+([A-Za-z0-9!_-]).png',
    search: '',
  },
  {
    protocol: 'https',
    hostname: 'images.scrydex.com',
    port: '',
    pathname: '/pokemon/+([a-z0-9])-+([A-Za-z0-9])/@(large|small)',
    search: '',
  },
  {
    protocol: 'https',
    hostname: 'images.scrydex.com',
    port: '',
    pathname: '/e2e/+([a-z0-9-])?(_hires).png',
    search: '',
  },
];

/**
 * Interruptor de emergencia, ARCHITECTURE §4.DYN (f) 7 (v1.114.5, residual de PEN-DYN-1): con
 * `NEXT_PUBLIC_IMAGE_OPTIMIZER_KILL_SWITCH=on` en el BUILD, `remotePatterns` queda VACÍO ⇒ `/_next/image` responde 400
 * a todo origen remoto; la otra mitad (la líder a nivel B) la lee `CardImage` vía `leadImageOptimized()`. Apagado por
 * defecto. Módulo y valores: `src/lib/image-optimizer-switch.mjs`. Candado: `next-image-remote-patterns.test.ts`.
 *
 * @param {Record<string, string | undefined>} [env]
 */
export const remotePatternsFor = (env = process.env) =>
  imageOptimizerKillSwitchOf(env.NEXT_PUBLIC_IMAGE_OPTIMIZER_KILL_SWITCH) === 'on' ? [] : REMOTE_PATTERNS;

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  distDir,
  env: {
    ...measurementBuildEnv(),
    NEXT_PUBLIC_USE_MOCKS: useMocksBuild(),
    // §4.DYN (f) 7: horneado SIEMPRE como `on`|`off` (un valor raro hace fallar aquí), igual en servidor y cliente.
    NEXT_PUBLIC_IMAGE_OPTIMIZER_KILL_SWITCH: imageOptimizerKillSwitchOf(process.env.NEXT_PUBLIC_IMAGE_OPTIMIZER_KILL_SWITCH),
  },
  webpack(config) {
    if (useMocksBuild() === 'false') {
      config.resolve.alias = { ...config.resolve.alias, ...mockModuleAliases() };
    }
    return config;
  },
  typescript: { tsconfigPath: tsconfigPathForDistDir(distDir) },
  reactStrictMode: true,
  // SEC-HDR-1 (2026-09-29): anti-clickjacking. La sesión vive en localStorage, así que sin esto el
  // panel admin se cargaría autenticado dentro de un iframe hostil. `frame-ancestors` restringe
  // QUIÉN nos embebe, no a quién embebemos. Solo esa directiva de CSP: la completa es SEC-HDR-2.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  },
  images: {
    // D-IMG-5 (ARCHITECTURE §5.3.4) — CERRADO. Aquí vivía `{ protocol: 'https', hostname: '**' }`,
    // un comodín que aceptaba CUALQUIER host. `remotePatterns` gobierna el optimizador
    // (`/_next/image?url=…`), que es un endpoint público del servidor **exista o no** un
    // `next/image` en el árbol: con el comodín, cualquiera en internet podía hacer que NUESTRO
    // despliegue descargara, procesara y sirviera una imagen de SU servidor. Eso es (a) un proxy
    // de imágenes abierto —transformaciones facturables, ancho de banda, reputación de IP— y (b)
    // exactamente la precondición de GHSA-2xp9-vwfh-vxw4 (RCE sin autenticar por AVIF en el
    // optimizador), parcheado aparte subiendo `next` a 15.5.24.
    //
    // La lista NO se inventa aquí: es el ESPEJO de `SET_IMAGE_HOSTS`
    // (`backend/src/modules/catalog/catalog-sync.service.ts`), el conjunto cerrado de hosts que el
    // backend puede llegar a persistir en `CardSet.logoUrl`. Regla de §5.3.4: `remotePatterns` se
    // amplía **detrás** del backend, nunca por delante. Los dos hosts, con su procedencia:
    //   · images.pokemontcg.io — CDN histórico (logos de todos los sets hasta 2026-08).
    //   · images.scrydex.com   — CDN vigente desde 2026-09 (sets me2pt5/me3/me4/me5 en adelante).
    //     NO es opcional: omitirlo rompería los logos de los sets nuevos el día que alguna
    //     superficie suba a Nivel A. Ya servía arte de 661 cartas en producción (§4.41.1 hecho 8).
    //
    // `protocol: 'https'` en ambas y sin comodines de esquema (§5.3.4). Hoy el narrowing es
    // INOBSERVABLE —cero `next/image` en el árbol; el arte de carta y los logos de set son Nivel B
    // (`<img>` crudo, §4.41.7), que `remotePatterns` no toca—, y por eso se cierra ahora: la
    // ventana barata es antes de que exista la primera línea de Nivel A, no después.
    //
    // 🔒 CANDADO: `next.config.remote-patterns.test.ts` verifica por CONDUCTA (con el propio
    // matcher de Next) que un host arbitrario NO empata. Si alguien reintroduce un comodín, ese
    // test se pone rojo. No lo relajes para admitir un host: añade el host.
    // `port: ''` NO es decorativo y lo descubrió el candado, no una lectura: en el matcher de Next
    // (`shared/lib/match-remote-pattern.js`) el puerto solo se compara **si el patrón lo define**
    // (`if (pattern.port !== undefined)`), así que omitirlo empata CUALQUIER puerto y
    // `https://images.pokemontcg.io:8443/…` pasaba. `''` significa «sin puerto» ⇒ solo el 443 por
    // defecto. Es la misma regla que el backend ya impone en `SET_IMAGE_HOSTS` («`host`, no
    // `hostname`: incluye el puerto»): otro puerto es OTRO endpoint, y ninguno se ha verificado.
    //
    // PEN-DYN-1 (pentest §DYN, 2026-10-30) — `search: ''` y `pathname` acotado. Sin ellos, cada
    // `?v=<n>` o cada ruta del CDN era una imagen de origen NUEVA (10/10 `MISS` medidos por el
    // pentester): una transformación facturable por URL, sin tope. `search: ''` ⇒ cero query
    // (el matcher de Next compara `url.search` exacto). Los `pathname` son las formas REALES del arte
    // de carta, medidas el 2026-10-30 contra la API del proveedor (todas las URLs `images.small`/
    // `images.large` del catálogo, ver FRONTEND_NOTES §DYN.6) y el seed:
    //   · pokemontcg.io  `/<set>/<número>.png` y `/<set>/<número>_hires.png` (también cubre
    //     `/<set>/logo.png`/`symbol.png`). Sin `%`: `/base1/%34.png` es un alias de `/base1/4.png`
    //     (200, medido) y multiplicaría los orígenes.
    //   · scrydex        `/pokemon/<set>-<número>/large|small` (la líder usa `imageLargeUrl ??
    //     imageSmallUrl`; `/medium` no lo persiste nadie). Los logos de scrydex
    //     (`/pokemon/<set>-logo/logo`) NO pasan: son Nivel B y no hay consumidor en el optimizador.
    //   · scrydex `/e2e/<id>[_hires].png` — SOLO el arnés DYN-D3 de devops (`scripts/home-perf/
    //     run.sh` reescribe el seed a `https://images.scrydex.com/e2e/`). El CDN real responde 400
    //     a esa ruta (medido), y el optimizador no transforma un no-2xx: coste cero. Se retira
    //     cuando el arnés use la forma `/pokemon/…` (solicitud a devops).
    // ⚠ Residual medido: scrydex responde 200 con una imagen genérica a CUALQUIER id con la forma
    // (`/pokemon/me3-99999/large`), así que la forma acota la superficie pero no la cuenta. Ver el
    // informe de PEN-DYN-1 en FRONTEND_NOTES §DYN.6. Lo acepta el arquitecto (v1.114.5) con un interruptor de
    // emergencia, APAGADO por defecto: `remotePatternsFor()` arriba y `src/lib/image-optimizer-switch.mjs`.
    remotePatterns: remotePatternsFor(),
    ...IMAGE_OPTIMIZER,
  },
};

export default withNextIntl(nextConfig);

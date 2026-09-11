import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import createNextIntlPlugin from 'next-intl/plugin';

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

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  distDir,
  typescript: { tsconfigPath: tsconfigPathForDistDir(distDir) },
  reactStrictMode: true,
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
    remotePatterns: [
      { protocol: 'https', hostname: 'images.pokemontcg.io', port: '' },
      { protocol: 'https', hostname: 'images.scrydex.com', port: '' },
    ],
  },
};

export default withNextIntl(nextConfig);

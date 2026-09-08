import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Directorio de build parametrizable. Lo usa el `webServer` de Playwright para hornear su
  // bundle de MOCKS (`NEXT_PUBLIC_USE_MOCKS=true`) en `.next-e2e-mock` en vez de pisar el
  // `.next` del stack que devops pueda tener corriendo: dos artefactos con banderas distintas
  // no pueden compartir carpeta sin convertir un `next start` ajeno en modo fixtures.
  distDir: process.env.NEXT_DIST_DIR || '.next',
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

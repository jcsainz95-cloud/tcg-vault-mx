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
    remotePatterns: [
      { protocol: 'https', hostname: 'images.pokemontcg.io' },
      { protocol: 'https', hostname: '**' },
    ],
  },
};

export default withNextIntl(nextConfig);

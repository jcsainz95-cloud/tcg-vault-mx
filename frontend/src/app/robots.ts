import type { MetadataRoute } from 'next';
import { siteAbsoluteUrl } from '@/lib/seo';

/**
 * ⭐ v1.96⟨mkt-tienda⟩ (§E1) — `robots.txt`. Permite TODO salvo las zonas privadas o transaccionales
 * (cuenta, carrito/checkout, pedidos, bóveda, pedido de invitado con token, auth, admin) y la API.
 * El resto (portada, catálogo, sellado, fichas, cotizador, guías, legal) se indexa. Incluye la línea
 * `Sitemap:`.
 *
 * Los patrones usan un comodín de segmento para cubrir los dos prefijos de locale (`/es/…`, `/en/…`,
 * por `localePrefix: 'always'`). `/api/` no está bajo locale (es el backend / rutas internas).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/*/account', // cuenta / perfil
        '/*/checkout', // checkout (con y sin cuenta)
        '/*/compra', // confirmación / carrito
        '/*/orders', // mis órdenes
        '/*/shipments', // envíos
        '/*/vault', // bóveda
        '/*/pedido', // ver pedido de invitado (con token)
        '/*/login',
        '/*/register',
        '/*/forgot-password',
        '/*/reset-password',
        '/*/verify-email',
        '/*/admin', // panel admin (incluye /admin/marketing)
        '/api/', // API
      ],
    },
    sitemap: siteAbsoluteUrl('/sitemap.xml'),
  };
}

import type { MetadataRoute } from 'next';
import { routing } from '@/i18n/routing';
import { getSitemap } from '@/lib/api';
import { siteAbsoluteUrl } from '@/lib/seo';

/**
 * ⭐ v1.96⟨mkt-tienda⟩ (§E1) — `sitemap.xml` del App Router. Lista:
 *  - las páginas ESTÁTICAS públicas existentes (portada, catálogo, sellado, accesorios, meta decks,
 *    cotizador, términos, privacidad) — las dinámicas (fichas) las da el backend;
 *  - una entrada por ficha A LA VENTA (carta y sellado) desde `GET /catalog/sitemap` (§MKT.B).
 *
 * Todas con `lastmod`. Las URL usan el locale por defecto (`es`), que es el canonical de cada ficha
 * (`localePrefix: 'always'`). ⛔ Las páginas de §E4/§E6 (`/como-funciona`, `/preguntas`, `/guias`) NO
 * se listan aún: no existen en esta ola (necesitan contenido de marketing).
 *
 * Resiliente: si el backend no responde, se devuelven al menos las estáticas (nunca un 500 que deje
 * sin sitemap). Como el feed no es dato personal y cambia poco, se revalida cada hora.
 */
export const revalidate = 3600;

const STATIC_PATHS = [
  '', // portada
  '/catalog',
  '/sellado',
  '/accesorios',
  '/decks-meta',
  '/buylist',
  '/terminos',
  '/privacidad',
] as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const locale = routing.defaultLocale;
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = STATIC_PATHS.map((path) => ({
    url: siteAbsoluteUrl(`/${locale}${path}`),
    lastModified: now,
    changeFrequency: path === '' || path === '/catalog' || path === '/sellado' ? 'daily' : 'weekly',
  }));

  let dynamicEntries: MetadataRoute.Sitemap = [];
  try {
    const feed = await getSitemap();
    dynamicEntries = feed.items.map((item) => ({
      url:
        item.type === 'card'
          ? siteAbsoluteUrl(`/${locale}/catalog/${encodeURIComponent(item.id)}`)
          : siteAbsoluteUrl(`/${locale}/sellado/${encodeURIComponent(item.id)}`),
      lastModified: item.lastmod,
      changeFrequency: 'daily',
    }));
  } catch {
    // Backend no disponible: el sitemap sale solo con las estáticas (mejor que un 500).
    dynamicEntries = [];
  }

  return [...staticEntries, ...dynamicEntries];
}

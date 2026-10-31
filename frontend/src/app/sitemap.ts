import type { MetadataRoute } from 'next';
import { routing } from '@/i18n/routing';
import { getDecksMeta, getSitemap } from '@/lib/api';
import { staticLastModified } from '@/lib/sitemap-lastmod';
import { siteAbsoluteUrl } from '@/lib/seo';
import { contentSitemapPaths } from '@/lib/seo-content';

/**
 * ⭐ v1.96⟨mkt-tienda⟩ (§E1) — `sitemap.xml` del App Router. Lista:
 *  - las páginas ESTÁTICAS públicas existentes (portada, catálogo, sellado, accesorios, meta decks,
 *    cotizador, términos, privacidad) — las dinámicas (fichas) las da el backend;
 *  - una entrada por ficha A LA VENTA (carta y sellado) desde `GET /catalog/sitemap` (§MKT.B).
 *
 * `lastmod` REAL o ninguno (C6, `lib/sitemap-lastmod.ts`; antes las fijas llevaban la hora de la petición). Las URL
 * usan el locale por defecto (`es`), que es el canonical de cada ficha (`localePrefix: 'always'`). Las páginas de contenido de §E4/§E6 (`/preguntas`, `/como-funciona`,
 * `/guias`, `/guias/<slug>`) salen de `contentSitemapPaths()` (`lib/seo-content.ts`) con su fecha de
 * revisión/publicación como `lastmod`; una página sin contenido vigente (FAQ vencidas) NO se lista.
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

  const [feed, decks] = await Promise.all([
    getSitemap().catch(() => null),
    getDecksMeta().catch(() => null),
  ]);
  const lastmods = staticLastModified(feed, decks?.updatedAt);

  const staticEntries: MetadataRoute.Sitemap = STATIC_PATHS.map((path) => ({
    url: siteAbsoluteUrl(`/${locale}${path}`),
    ...(lastmods[path] ? { lastModified: lastmods[path] } : {}),
    changeFrequency: path === '' || path === '/catalog' || path === '/sellado' ? 'daily' : 'weekly',
  }));

  const contentEntries: MetadataRoute.Sitemap = contentSitemapPaths(now).map((c) => ({
    url: siteAbsoluteUrl(`/${locale}${c.path}`),
    lastModified: c.lastModified,
    changeFrequency: 'monthly',
  }));

  // Backend no disponible: el sitemap sale solo con las estáticas (mejor que un 500).
  const dynamicEntries: MetadataRoute.Sitemap = (feed?.items ?? []).map((item) => ({
    url:
      item.type === 'card'
        ? siteAbsoluteUrl(`/${locale}/catalog/${encodeURIComponent(item.id)}`)
        : siteAbsoluteUrl(`/${locale}/sellado/${encodeURIComponent(item.id)}`),
    lastModified: item.lastmod,
    changeFrequency: 'daily',
  }));

  // C7 (ARCHITECTURE §4.CARDSHOW.a): la landing del Card Show es canónica FUERA del i18n — sin `/es`.
  const cardShowEntry: MetadataRoute.Sitemap = [
    { url: siteAbsoluteUrl('/card-show'), lastModified: now, changeFrequency: 'weekly' },
  ];

  return [...staticEntries, ...cardShowEntry, ...contentEntries, ...dynamicEntries];
}

import type { MetadataRoute } from 'next';
import { routing } from '@/i18n/routing';
import { fresh } from '@/lib/snapshot-cache';
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
 * (Antes: «resiliente», con solo las estáticas si el backend caía; ya NO: un sitemap recortado hace que Google des-indexe fichas.)
 * Misma frescura que el feed de Google: dinámico con memoria de servidor de 60 s y tope duro (`lib/snapshot-cache.ts`);
 * `revalidate` no tiene tope de edad. Con el backend caído FALLA (5xx): nunca publica un sitemap recortado sin fichas.
 */
export const dynamic = 'force-dynamic';
const TTL_MS = 60_000;

const STATIC_PATHS = [
  '', // portada
  '/catalog',
  '/sellado',
  '/accesorios',
  '/decks-meta',
  '/buylist',
  '/terminos',
  '/privacidad',
  '/nosotros', // MKT-CONV.4 (B2, criterio 944)
] as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return fresh('sitemap', TTL_MS, buildSitemap);
}

async function buildSitemap(): Promise<MetadataRoute.Sitemap> {
  const locale = routing.defaultLocale;
  const now = new Date();

  const [feed, decks] = await Promise.all([
    getSitemap(),
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

  const dynamicEntries: MetadataRoute.Sitemap = feed.items.map((item) => ({
    url:
      item.type === 'card'
        ? siteAbsoluteUrl(`/${locale}/catalog/${encodeURIComponent(item.id)}`)
        : siteAbsoluteUrl(`/${locale}/sellado/${encodeURIComponent(item.id)}`),
    lastModified: item.lastmod,
    changeFrequency: 'daily',
  }));

  // C7 (ARCHITECTURE §4.CARDSHOW.a): la landing del Card Show es canónica FUERA del i18n — sin `/es`.
  // C6: SIN `lastmod` — `content/card-show.ts` no publica fecha de revisión, y la hora de la petición no es una fecha real.
  const cardShowEntry: MetadataRoute.Sitemap = [{ url: siteAbsoluteUrl('/card-show'), changeFrequency: 'weekly' }];

  return [...staticEntries, ...cardShowEntry, ...contentEntries, ...dynamicEntries];
}

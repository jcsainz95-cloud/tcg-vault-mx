/**
 * ARCHITECTURE §13.8 (d) (v1.115⟨mkt-conv2⟩, TL-MKT2-7) — canonical, `hreflang` y `robots` del catálogo paginado. Puro
 * (sin `'use client'`): lo usa `generateMetadata` de `catalog/page.tsx`.
 *
 * - Sin filtros y `?page=n` con n ≥ 2 ⇒ canonical PROPIO `/{locale}/catalog?page=n` (apuntar a la 1 le dice a Google que
 *   la n es un duplicado y deja de seguir sus fichas), `hreflang` con la misma `page`.
 * - `page` 1, ausente o inválida ⇒ `/catalog`.
 * - Con filtro, búsqueda, intención de sellado u orden distinto del de defecto ⇒ `/catalog` (no se indexan combinaciones).
 * - Fuera de rango (la vista pinta `catalog.pageOutOfRange`) ⇒ `noindex, follow` y canonical `/catalog`.
 *
 * «Filtro» = lo que `parseUrlFilters` acepta (un valor inválido se ignora y la página servida es la del catálogo sin
 * filtro, así que tampoco cuenta); los parámetros ajenos (`utm_*`, `from`…) no son filtros.
 */
import type { CatalogFilters } from '@/lib/api';
import { DEFAULT_CATALOG_SORT, parseUrlFilters, sealedIntentOf, type UrlParams } from './catalog-url';

/** Lo que hace falta de la página leída en el servidor para saber si `page` existe. */
export interface CatalogPageCount {
  total: number;
  pageSize: number;
}

export interface CatalogSeo {
  /** Ruta sin idioma que va en canonical y `hreflang`: `/catalog` o `/catalog?page=n`. */
  path: string;
  /** `true` ⇒ `robots: noindex, follow` (página fuera de rango). */
  noindex: boolean;
}

/** ¿Los filtros piden algo distinto del catálogo entero en su orden por defecto? (la página no cuenta). */
export function hasCatalogFilters(f: CatalogFilters): boolean {
  return (
    !!f.q ||
    !!f.setId ||
    !!f.productType ||
    !!f.condition ||
    !!f.finish ||
    (f.rarity?.length ?? 0) > 0 ||
    f.minPriceCents != null ||
    f.maxPriceCents != null ||
    (f.sort != null && f.sort !== DEFAULT_CATALOG_SORT)
  );
}

/**
 * `count`: total y tamaño de página de la lectura del servidor; `null` = no llegó a tiempo (backend lento o caído): no
 * se puede saber si la página existe ⇒ se trata como existente (sin `noindex`), que es lo que el HTML pinta entonces
 * (el esqueleto y la carga en cliente, no «esta página ya no tiene cartas»).
 */
export function catalogSeoOf(sp: UrlParams, count: CatalogPageCount | null): CatalogSeo {
  const filters = parseUrlFilters(sp);
  const page = filters.page ?? 1;
  const totalPages = count ? Math.max(1, Math.ceil(count.total / Math.max(1, count.pageSize))) : Infinity;
  if (page > 1 && page > totalPages) return { path: '/catalog', noindex: true };
  if (page < 2 || sealedIntentOf(sp) || hasCatalogFilters(filters)) return { path: '/catalog', noindex: false };
  return { path: `/catalog?page=${page}`, noindex: false };
}

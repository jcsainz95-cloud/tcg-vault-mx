/**
 * v1.113⟨portada⟩ (API_CONTRACT §DYN.6.2) — las dos lecturas de la portada que se piden en el SERVIDOR y en el cliente:
 * Destacadas (`GET /catalog/featured`) y la vitrina «Joyas para gradear» (`GET /catalog/cards` filtrado). Viven en un
 * módulo SIN `'use client'` porque las importan las dos mitades: la página de servidor (`page.tsx`, que hidrata
 * react-query con ellas) y los hooks de cliente. Una constante de un módulo `'use client'` importada desde un
 * componente de servidor no es su valor, es una referencia de cliente. ⛔ Ninguna petición nueva de forma: los mismos
 * dos endpoints en servidor y cliente, con la MISMA clave de consulta.
 */
import type { CatalogFilters } from '@/lib/api';
import type { FeaturedResponse } from '@/types/contract';

/** Clave de Destacadas del día. Sin parámetros: la selección es la misma para todos (I-2). */
export const FEATURED_QUERY_KEY = ['featured'] as const;

/** Cap de la vitrina (§O.3(3)); es también el `pageSize` que se le pide al servidor. */
export const GEMS_PAGE_SIZE = 8;

/** Los filtros de la vitrina, idénticos en servidor y cliente (§DYN.6.2). */
export const GEMS_FILTERS: CatalogFilters = {
  gradingHighlight: true,
  sort: 'grading_showcase',
  pageSize: GEMS_PAGE_SIZE,
};

export const GEMS_QUERY_KEY = ['catalog', { home: true, gradingHighlight: true }] as const;

/** §DYN.6.2: caché de datos de Next en el servidor (segundos) y etiquetas por endpoint. */
export const HOME_SSR_REVALIDATE_S = 30;
/** §DYN.6.2: tope de la lectura en servidor. Sin datos a tiempo, el HTML sale con el marco y el cliente rellena. */
export const HOME_SSR_BUDGET_MS = 400;

/**
 * La foto líder de Destacadas (candidata a LCP, §DYN.6.2: «la `<img>` líder presente»): la de la teja 1, grande si la hay
 * — la misma que pinta `FeaturedCarousel` (`imageLargeUrl ?? imageSmallUrl`). `null` sin datos o sin foto.
 */
export function leadImageOf(featured: FeaturedResponse | null | undefined): string | null {
  const lead = featured?.data[0];
  return lead ? (lead.card.imageLargeUrl ?? lead.card.imageSmallUrl ?? null) : null;
}

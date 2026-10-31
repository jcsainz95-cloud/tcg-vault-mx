/**
 * ⭐ v1.96⟨mkt-tienda⟩ (§A3/§A4) — lecturas de ficha para SSR/ISR. `generateMetadata` y el componente
 * de página comparten la MISMA llamada gracias a `cache()` de React (una sola petición por render),
 * y ambas toleran el fallo: si el backend no responde (o la pieza no existe), devuelven `null` y la
 * página sigue viva renderizando su vista cliente, que muestra su propio estado de carga/error
 * (react-query). Así el HTML del servidor trae og/title/JSON-LD cuando hay dato, sin romper la ruta
 * cuando no lo hay.
 *
 * Usa las MISMAS funciones del cliente de API (`getCardDetail`/`getSealedGroupDetail`): respetan
 * `NEXT_PUBLIC_API_BASE_URL` por entorno y el modo MOCK (Playwright/dev). En SSR no hay token
 * (`getToken()` devuelve `null` fuera del navegador) y estos endpoints son `@Public`.
 */
import { cache } from 'react';
import {
  getCardDetail,
  getCatalog,
  getPublicShippingRuleForServer,
  getSealedGroupDetail,
  type CatalogFilters,
  type CatalogSort,
} from '@/lib/api';
import { withBudget } from '@/lib/home-ssr';
import type {
  GroupedListingDetailResponse,
  GroupedListingListResponse,
  PublicShippingRuleDTO,
  SealedGroupDetailResponse,
} from '@/types/contract';

export const loadCardDetailForSSR = cache(
  async (cardId: string): Promise<GroupedListingDetailResponse | null> => {
    try {
      return await getCardDetail(cardId);
    } catch {
      return null;
    }
  },
);

export const loadSealedDetailForSSR = cache(
  async (inventoryItemId: string): Promise<SealedGroupDetailResponse | null> => {
    try {
      return await getSealedGroupDetail(inventoryItemId);
    } catch {
      return null;
    }
  },
);

/**
 * C2 (BRIEF_MKT Ola 2) — tope de la lectura del catálogo en el servidor. Sin datos a tiempo, el HTML sale con el
 * esqueleto y la vista cliente pide sola (lo de antes). Más holgado que el de la portada (400 ms): aquí el listado ES
 * el contenido de la página, y la lectura tardía no se aprovecha (sin caché de datos: precio y stock del momento).
 */
export const CATALOG_SSR_BUDGET_MS = 1200;

/**
 * Página del catálogo para el SSR, con los MISMOS filtros y el MISMO orden por defecto que pide la vista cliente
 * (`CatalogView`), para que el resultado sea el `initialData` de su clave. Sin caché de datos de Next (`no-store`, el
 * defecto de `fetch` en Next 15): el precio que se pinta es el del momento, el mismo que se cobra. Nunca lanza.
 */
export async function loadCatalogPageForSSR(
  filters: CatalogFilters,
  defaultSort: CatalogSort,
  budgetMs: number = CATALOG_SSR_BUDGET_MS,
): Promise<GroupedListingListResponse | null> {
  return withBudget(getCatalog({ ...filters, sort: filters.sort ?? defaultSort }), budgetMs);
}

/** C5 — tope de la lectura de la regla de envío para el JSON-LD; sin ella a tiempo, `shippingDetails` se omite. */
export const SHIPPING_RULE_SSR_BUDGET_MS = 400;

/**
 * C5 (BRIEF_MKT Ola 2) — la regla de envío pública (`GET /checkout/shipping-rule`) para el `shippingDetails` del JSON-LD
 * de las fichas. Caché de datos de Next de 300 s (el contrato la declara `max-age=300`) y `cache()` de React (una
 * lectura por render). Nunca lanza: `null` ⇒ el campo se omite.
 */
export const loadShippingRuleForSSR = cache(
  async (): Promise<PublicShippingRuleDTO | null> =>
    withBudget(
      getPublicShippingRuleForServer({ next: { revalidate: 300, tags: ['shipping-rule'] } }),
      SHIPPING_RULE_SSR_BUDGET_MS,
    ),
);

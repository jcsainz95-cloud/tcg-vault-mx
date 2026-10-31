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
import { withAbortBudget, withBudget } from '@/lib/ssr-budget';
import { HOME_SSR_REVALIDATE_S } from '@/lib/home-queries';
import type {
  GroupedListingDetailResponse,
  GroupedListingListResponse,
  PublicShippingRuleDTO,
  SealedGroupDetailResponse,
} from '@/types/contract';

/**
 * C2 (BRIEF_MKT Ola 2) — tope de la lectura del catálogo en el servidor. Sin datos a tiempo, el HTML sale con el
 * esqueleto y la vista cliente pide sola (lo de antes). Más holgado que el de la portada (400 ms): aquí el listado ES
 * el contenido de la página.
 */
export const CATALOG_SSR_BUDGET_MS = 1200;

/**
 * I-1 de QA sobre `561ad425` (TL-MKT2-1) — tope de las lecturas de FICHA (carta y sellado) en el servidor: el mismo
 * criterio que el catálogo (la lectura ES el contenido de la página). Al vencer, el fetch se ABORTA y la ficha sale con
 * su carga en cliente (`initialData` ausente ⇒ react-query pide y pinta su estado de carga/error). Antes esperaban sin
 * tope: con el backend congelado la ficha no respondía en 30 s.
 */
export const DETAIL_SSR_BUDGET_MS = CATALOG_SSR_BUDGET_MS;

export const loadCardDetailForSSR = cache(
  async (cardId: string): Promise<GroupedListingDetailResponse | null> =>
    withAbortBudget((signal) => getCardDetail(cardId, { signal }), DETAIL_SSR_BUDGET_MS),
);

export const loadSealedDetailForSSR = cache(
  async (inventoryItemId: string): Promise<SealedGroupDetailResponse | null> =>
    withAbortBudget((signal) => getSealedGroupDetail(inventoryItemId, { signal }), DETAIL_SSR_BUDGET_MS),
);

/**
 * R2 (techlead sobre `561ad425`) — ventana de la caché de datos de Next para la lista pública del catálogo: la misma
 * que la portada (30 s). ARCHITECTURE §4.DYN (f) 3: «≤ 60 s en listas públicas, exacto al pagar» (el checkout re-cotiza
 * y responde `409 ITEM_UNAVAILABLE`); tras hidratar, react-query revalida en el cliente.
 */
export const CATALOG_SSR_REVALIDATE_S = HOME_SSR_REVALIDATE_S;

/**
 * Página del catálogo para el SSR, con los MISMOS filtros y el MISMO orden por defecto que pide la vista cliente
 * (`CatalogView`), para que el resultado sea el `initialData` de su clave. Caché de datos de Next de
 * `CATALOG_SSR_REVALIDATE_S` con etiqueta `catalog` (antes `no-store`: una lectura al API por visita). Nunca lanza.
 */
export async function loadCatalogPageForSSR(
  filters: CatalogFilters,
  defaultSort: CatalogSort,
  budgetMs: number = CATALOG_SSR_BUDGET_MS,
): Promise<GroupedListingListResponse | null> {
  return withBudget(
    getCatalog(
      { ...filters, sort: filters.sort ?? defaultSort },
      { next: { revalidate: CATALOG_SSR_REVALIDATE_S, tags: ['catalog'] } },
    ),
    budgetMs,
  );
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

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
import { asApiError } from '@/lib/api-client';
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

/**
 * C3 (criterio 951) — la ficha NO EXISTE: el backend respondió `404` (carta o grupo de sellado inexistente). Distinto de
 * `null` (no se sabe: backend caído o lento), que deja la ficha viva con su carga en cliente. Con este valor la página
 * llama a `notFound()` ⇒ 404 real con su propio título, no un 200 con la cabecera de la portada.
 */
export const DETAIL_NOT_FOUND = 'not_found' as const;
export type DetailRead<T> = T | null | typeof DETAIL_NOT_FOUND;

/** `404` del backend ⇒ `DETAIL_NOT_FOUND`; cualquier otro fallo sigue siendo un fallo (⇒ `null` en el tope). */
async function notFoundAware<T>(p: Promise<T>): Promise<T | typeof DETAIL_NOT_FOUND> {
  try {
    return await p;
  } catch (e) {
    if (asApiError(e)?.status === 404) return DETAIL_NOT_FOUND;
    throw e;
  }
}

export const loadCardDetailForSSR = cache(
  async (cardId: string): Promise<DetailRead<GroupedListingDetailResponse>> =>
    withAbortBudget((signal) => notFoundAware(getCardDetail(cardId, { signal })), DETAIL_SSR_BUDGET_MS),
);

/**
 * Sellado: el backend responde `404` tanto si la pieza no existe como si su grupo ya no tiene piezas vendibles
 * (`sealed-catalog.service.ts` `sealedDetail`) ⇒ un sellado agotado es hoy un 404 (solicitud al arquitecto en
 * FRONTEND_NOTES §MKT-CONV2).
 */
export const loadSealedDetailForSSR = cache(
  async (inventoryItemId: string): Promise<DetailRead<SealedGroupDetailResponse>> =>
    withAbortBudget(
      (signal) => notFoundAware(getSealedGroupDetail(inventoryItemId, { signal })),
      DETAIL_SSR_BUDGET_MS,
    ),
);

/**
 * R2 (techlead sobre `561ad425`) — ventana de la caché de datos de Next para la lista pública del catálogo: la misma
 * que la portada (30 s). ARCHITECTURE §4.DYN (f) 3: «≤ 60 s en listas públicas, exacto al pagar» (el checkout re-cotiza
 * y responde `409 ITEM_UNAVAILABLE`). La caché es stale-while-revalidate: vencida la ventana, la PRIMERA visita recibe
 * la copia vieja (y Next relee en segundo plano). Por eso la página viaja con su edad (`ageMs`) y la vista revalida
 * tras hidratar si ya no es fresca (B-R2 de QA sobre `e066b0b5`).
 */
export const CATALOG_SSR_REVALIDATE_S = HOME_SSR_REVALIDATE_S;

/** La página leída en el servidor y su edad al renderizar. */
export interface CatalogSsrPage {
  data: GroupedListingListResponse;
  /**
   * Milisegundos desde que el BACKEND respondió esta lectura (su cabecera `Date`, que la caché de datos de Next guarda
   * con el cuerpo) hasta el render. Una copia cacheada trae su hora real, no la de hoy. `null` = no se sabe (sin
   * cabecera, modo MOCK) ⇒ la vista la trata como vieja y revalida.
   */
  ageMs: number | null;
}

/** Edad de una respuesta por su cabecera `Date` (resolución de 1 s, redondea hacia «más vieja»); `null` si no hay. */
export function responseAgeMs(dateHeader: string | null | undefined, now: number = Date.now()): number | null {
  if (!dateHeader) return null;
  const readAt = Date.parse(dateHeader);
  if (Number.isNaN(readAt)) return null;
  return Math.max(0, now - readAt);
}

/**
 * Página del catálogo para el SSR, con los MISMOS filtros y el MISMO orden por defecto que pide la vista cliente
 * (`CatalogView`), para que el resultado sea el `initialData` de su clave. Caché de datos de Next de
 * `CATALOG_SSR_REVALIDATE_S` con etiqueta `catalog`. Tope `budgetMs` que ABORTA el fetch al vencer (TL-MKT3-1; antes
 * `withBudget` dejaba el socket colgado contra un backend congelado). Nunca lanza.
 */
export async function loadCatalogPageForSSR(
  filters: CatalogFilters,
  defaultSort: CatalogSort,
  budgetMs: number = CATALOG_SSR_BUDGET_MS,
): Promise<CatalogSsrPage | null> {
  let date: string | null = null;
  const data = await withAbortBudget(
    (signal) =>
      getCatalog(
        { ...filters, sort: filters.sort ?? defaultSort },
        {
          next: { revalidate: CATALOG_SSR_REVALIDATE_S, tags: ['catalog'] },
          signal,
          onHeaders: (h) => {
            date = h.get('date');
          },
        },
      ),
    budgetMs,
  );
  return data ? { data, ageMs: responseAgeMs(date) } : null;
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

/**
 * v1.113⟨portada⟩ (API_CONTRACT §DYN.6.2, ARCHITECTURE §4.DYN (f) 1-2) — lecturas de la portada en el SERVIDOR.
 *
 * Mismo patrón tolerante que `catalog-ssr.ts`: las MISMAS funciones del cliente de API (respetan
 * `NEXT_PUBLIC_API_BASE_URL` y el modo MOCK; en servidor no hay token y los dos endpoints son `@Public`), y un fallo NO
 * rompe la ruta: devuelve `null` y la vista cliente se rellena sola.
 *
 * Dos cosas propias de la portada:
 *  - **Caché de datos de Next** (`revalidate: 30`, etiquetas `featured` / `showcase`): solo se cachean DATOS; el HTML se
 *    sigue renderizando por petición para conservar el nonce de la CSP (§DYN.6.3).
 *  - **Tope de 400 ms**: si el API tarda, se responde sin esperar (`null` ⇒ el marco con su alto reservado, criterio
 *    937). La petición NO se aborta: si llega tarde, llena la caché de datos y la siguiente visita ya la tiene.
 */
import { getCatalog, getFeatured } from '@/lib/api';
import type { FeaturedResponse, GroupedListingListResponse } from '@/types/contract';
import {
  GEMS_FILTERS,
  HOME_SSR_BUDGET_MS,
  HOME_SSR_REVALIDATE_S,
} from '@/lib/home-queries';

export interface HomeSsrData {
  featured: FeaturedResponse | null;
  gems: GroupedListingListResponse | null;
}

// TL-MKT2-1: el tope genérico vive en `lib/ssr-budget.ts`; se re-exporta aquí para los importadores existentes.
import { withBudget } from '@/lib/ssr-budget';
export { withBudget };

export async function loadHomeForSSR(budgetMs: number = HOME_SSR_BUDGET_MS): Promise<HomeSsrData> {
  const [featured, gems] = await Promise.all([
    withBudget(getFeatured({ next: { revalidate: HOME_SSR_REVALIDATE_S, tags: ['featured'] } }), budgetMs),
    withBudget(getCatalog(GEMS_FILTERS, { next: { revalidate: HOME_SSR_REVALIDATE_S, tags: ['showcase'] } }), budgetMs),
  ]);
  return { featured, gems };
}

export { leadImageOf } from '@/lib/home-queries';

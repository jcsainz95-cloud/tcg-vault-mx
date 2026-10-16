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
import { getCardDetail, getSealedGroupDetail } from '@/lib/api';
import type { GroupedListingDetailResponse, SealedGroupDetailResponse } from '@/types/contract';

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

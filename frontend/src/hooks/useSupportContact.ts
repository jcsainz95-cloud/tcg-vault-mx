'use client';

import { useQuery } from '@tanstack/react-query';
import { getSupportContact } from '@/lib/api';
import { SUPPORT_CONTACT_FALLBACK } from '@/app/[locale]/(storefront)/checkout/support-contact';

/** `Cache-Control: max-age=300` del contrato (§PNL.1) ⇒ la misma ventana en el cliente. */
const SUPPORT_CONTACT_STALE_MS = 5 * 60 * 1000;

/**
 * El buzón de soporte para TODA la tienda (DESIGN_SYSTEM §60.1 a · contrato v1.82 §PNL.1).
 *
 * - Una sola consulta compartida (`['support-contact']`, 5 min).
 * - **Mientras carga:** `contact = null` y `loading = true` — ⛔ no se pinta el valor fijo (un
 *   parpadeo de un correo a otro es peor que esperar 300 ms).
 * - **Error:** `SUPPORT_CONTACT_FALLBACK`, sin aviso. Es el ÚNICO uso del valor fijo.
 */
export function useSupportContact(): { contact: string | null; loading: boolean } {
  const query = useQuery({
    queryKey: ['support-contact'],
    queryFn: getSupportContact,
    staleTime: SUPPORT_CONTACT_STALE_MS,
    retry: false,
  });
  if (query.isError) return { contact: SUPPORT_CONTACT_FALLBACK, loading: false };
  const contact = query.data?.contact?.trim();
  if (query.isLoading || query.isPending) return { contact: null, loading: true };
  return { contact: contact ? contact : SUPPORT_CONTACT_FALLBACK, loading: false };
}

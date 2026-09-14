'use client';

import { useQuery } from '@tanstack/react-query';
import { getMePendings } from '@/lib/api';
import { useSession } from '@/lib/session';

/** Clave única de la campana. Se exporta porque quien RESUELVE un pendiente tiene que invalidarla. */
export const PENDINGS_QUERY_KEY = ['me-pendings'] as const;

/**
 * `GET /me/pendings` (contrato §R.2) para la campana del portal.
 *
 * **Tres decisiones y su porqué, porque las tres son criterio:**
 *
 * 1. ⛔ **`enabled` solo con sesión lista y autenticada.** Sin sesión el endpoint contesta `401`
 *    (§R.2.2) y ⛔ **no hay variante tokenizada para el invitado**: para él el pendiente **no
 *    existe**, no es que se le esconda (criterio **203**). Preguntar igualmente sería pedir un
 *    `401` por cada visita anónima a la portada.
 * 2. ⛔ **`retry: false`.** Un `401` reintentado es ruido, y aquí el fallo **no se le cuenta al
 *    cliente**: la campana que no se pudo resolver **no se pinta** (ver `PendingsBell`). *Un
 *    indicador de estado que se rompe a la vista es peor que uno que calla.*
 * 3. ⭐ **`refetchOnWindowFocus: true`, contra el default global.** Es la mitad (c) del criterio
 *    **202**: *resuelto el pendiente, desaparece*. El cliente resuelve su identidad en otra
 *    pestaña —o el operador la aprueba— y al volver a ésta la campana tiene que apagarse sola.
 *    Con el default (`false`) seguiría encendida hasta un recargado completo, que es **justo** el
 *    «indicador vacío» que §R.2 existe para evitar.
 *
 * ⛔ **Este `GET` no escribe nada.** No se llama en respuesta a abrir la campana, no marca leído y
 * no sella: no hay nada que marcar porque **el pendiente se deriva** (§R.2.0).
 */
export function usePendings() {
  const { isAuthenticated, ready } = useSession();
  return useQuery({
    queryKey: PENDINGS_QUERY_KEY,
    queryFn: getMePendings,
    enabled: ready && isAuthenticated,
    retry: false,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
}

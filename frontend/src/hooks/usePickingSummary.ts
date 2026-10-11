'use client';

import { useQuery } from '@tanstack/react-query';
import { getPickingListSummary } from '@/lib/api';
import { useSession } from '@/lib/session';

/** Clave única del contador; quien prepara, coloca o resuelve un caso la invalida. */
export const PICKING_SUMMARY_KEY = ['admin-picking-summary'] as const;

/**
 * `GET /admin/shipments/picking-list/summary` (contrato `§M4-SHIP.11`): el **contador DERIVADO** que
 * hace de aviso de pedido nuevo. El contrato fija la cadencia — **al cargar, al volver el foco y cada
 * 60 s con la pestaña visible** — y esa cadencia se cumple aquí, en un solo sitio, para el badge del
 * menú, las pestañas de «Pedidos por preparar» y el tablero.
 *
 * ⛔ Sin campana, sin sonido, sin «nuevo» que se quede encendido: el número **es** el aviso (criterio
 * 232). `refetchIntervalInBackground: false` ⇒ con la pestaña oculta no se sondea (§M4-SHIP.11).
 * Solo se monta en superficies `(admin)` (el shell ya garantiza la sesión con rol de back-office).
 *
 * ⭐ M-5 (QA sobre `da6d910e`): con la contraseña temporal pendiente el shell sigue pintando el menú
 * en `/admin/account/password`, y el servidor responde `403 PASSWORD_CHANGE_REQUIRED` a todo lo que
 * no esté en su lista blanca. Pedir el contador ahí es un `403` seguro y ruido en la consola: ⛔ no
 * se pide mientras la sesión local diga `mustChangePassword: true` (ni antes de leerla). Al cambiar la
 * contraseña, `patchStoredUser` emite el evento de sesión y la consulta arranca sola.
 */
export function usePickingSummary(enabled = true) {
  const { user, ready } = useSession();
  return useQuery({
    queryKey: PICKING_SUMMARY_KEY,
    queryFn: getPickingListSummary,
    enabled: enabled && ready && user?.mustChangePassword !== true,
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
  });
}

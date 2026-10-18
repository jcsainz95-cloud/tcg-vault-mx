'use client';

import { createContext, useContext } from 'react';
import { asApiError } from '@/lib/api-client';

/**
 * `403` del panel (§MKT-UX.11): la sesión es válida pero no tiene permiso. Cualquier pieza (datos, descarga,
 * anotación, llave) que lo reciba lo avisa aquí y la vista entera pasa al estado «sin permiso», descartando lo que
 * hubiera en pantalla. ⛔ `403 PASSWORD_CHANGE_REQUIRED` no es esto: lo intercepta `api-client` y redirige.
 */
export function isForbidden(e: unknown): boolean {
  const err = asApiError(e);
  return err?.status === 403 && err.code !== 'PASSWORD_CHANGE_REQUIRED';
}

export const ForbiddenCtx = createContext<(e: unknown) => boolean>(() => false);

/** Devuelve `report(e)`: `true` si era un 403 (y la vista ya pasó a «sin permiso»). */
export function useReportForbidden() {
  return useContext(ForbiddenCtx);
}

'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPostalCode } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import { isPostalCode, matchNeighborhood } from '@/lib/address-rules';
import type { PostalCodeDTO } from '@/types/contract';

export interface PostalCodeLookup {
  /** El CP tiene 5 dígitos: solo entonces se consulta (`DESIGN_SYSTEM §43.2b`). */
  cpComplete: boolean;
  /** Consultando el CP actual (no hay respuesta para ESTE CP todavía). */
  loading: boolean;
  /** `404`/`422 POSTAL_CODE_UNKNOWN`: el CP no está en el catálogo. */
  unknown: boolean;
  /** Cualquier otro fallo (red, `5xx`, `429`): se puede reintentar. */
  failed: boolean;
  retry: () => void;
  /** La respuesta para EXACTAMENTE el CP actual (⛔ nunca la de un CP anterior). */
  data: PostalCodeDTO | null;
  /** Las colonias que se ofrecen: `allowedOverride` (la lista de un `422`) manda sobre la consultada. */
  neighborhoods: string[];
}

export interface PostalCodeLookupOptions {
  /** `422 NEIGHBORHOOD_NOT_IN_POSTAL_CODE {allowed}`: la lista del servidor manda sobre la consultada. */
  allowedOverride?: string[] | null;
  /** La colonia elegida hoy (para reconciliarla con la lista que llega). */
  selected?: string;
  /**
   * Llega la lista de ESTE CP: `match` = la colonia elegida si está en la lista (su grafía canónica)
   * o `''` si no (vuelve al placeholder). La pantalla decide qué más toma de `data` (la libreta y el
   * invitado, municipio y estado; la ventana del operador solo la colonia).
   */
  onResolved?: (data: PostalCodeDTO, match: string) => void;
}

/**
 * **Colonia de lista por CP** (`API_CONTRACT §M4-SHIP.19.5`, `GET /geo/postal-codes/:cp`). UN cuerpo para
 * las tres pantallas que capturan dirección: la libreta (y el alta inline del buylist), el checkout de
 * invitado y el paso 1 de «Capturar guía». Una consulta por CP (caché `['postal-code', cp]`, sin
 * reintentos automáticos, `staleTime: Infinity`: el catálogo SEPOMEX no cambia en una sesión).
 */
export function usePostalCodeLookup(cp: string, options: PostalCodeLookupOptions = {}): PostalCodeLookup {
  const { allowedOverride = null, selected = '', onResolved } = options;
  const cpComplete = isPostalCode(cp);
  const query = useQuery({
    queryKey: ['postal-code', cp],
    queryFn: () => getPostalCode(cp),
    enabled: cpComplete,
    retry: false,
    staleTime: Infinity,
  });
  const data = cpComplete && query.data && query.data.postalCode === cp ? query.data : null;
  const code = asApiError(query.error)?.code ?? '';
  const unknown = cpComplete && !data && query.isError && (code === 'POSTAL_CODE_UNKNOWN' || code === 'NOT_FOUND');
  const failed = cpComplete && !data && query.isError && !unknown;
  const neighborhoods = !cpComplete ? [] : (allowedOverride ?? data?.neighborhoods ?? []);

  // La colonia elegida que NO está en la lista del CP nuevo vuelve al placeholder (UX-SDX-23); si está
  // con otra grafía, se toma la canónica. Una vez por respuesta: el efecto solo mira `data`.
  const latest = useRef({ selected, onResolved });
  latest.current = { selected, onResolved };
  useEffect(() => {
    if (!data) return;
    latest.current.onResolved?.(data, matchNeighborhood(latest.current.selected, data.neighborhoods));
  }, [data]);

  return {
    cpComplete,
    loading: cpComplete && !data && query.isFetching,
    unknown,
    failed,
    retry: () => void query.refetch(),
    data,
    neighborhoods,
  };
}

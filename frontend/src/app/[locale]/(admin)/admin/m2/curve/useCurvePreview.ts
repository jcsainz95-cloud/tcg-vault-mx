'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { previewPricingCurve } from '@/lib/api';
import type { CurvePreviewResponse, CurvePreviewRowDTO, PricingCurveDTO } from '@/types/contract';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';

/**
 * Mercados de la **prueba de mesa normativa** (ARCHITECTURE §4.36.1), en centavos. Son las filas
 * fijas de la tabla de referencia (§21.5b) y el test de aceptación visible del previsualizador:
 * con los diales iniciales, la tabla tiene que reproducir EXACTAMENTE esas cifras.
 * (Son MERCADOS de entrada — datos de la sonda, no resultados: aquí no se hardcodea ningún precio.)
 */
export const REFERENCE_MARKETS_CENTS = [
  114, 1000, 2500, 5000, 8000, 8600, 8700, 10000, 30000, 50000,
];

/** Cap del contrato: `marketsCents` admite 1..50 sondas por llamada. */
const MAX_PROBES = 50;

export interface CurvePreviewState {
  data: CurvePreviewResponse | undefined;
  /** Fila por mercado (centavos) — el server deduplica y ordena, aquí solo se indexa. */
  byMarket: Map<number, CurvePreviewRowDTO>;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  /** El borrador no es evaluable todavía (campos vacíos): no hay nada que pedir. */
  unavailable: boolean;
}

/**
 * Única fuente de los números del previsualizador (DESIGN_SYSTEM §21.5d + ARCHITECTURE §4.36.8a):
 * **el servidor calcula, el cliente pinta**. Aquí NO se interpola, no se aplica el `max` con la
 * constante ni se redondea — duplicar esa fórmula haría que el dueño calibrara la curva contra un
 * cálculo distinto del que va a cobrar, que es el bug de P-48 en espejo.
 *
 * El request lleva **solo el borrador**: la columna VIGENTE la resuelve el servidor con SU curva
 * almacenada (si el cliente pudiera devolverle la guardada, un cliente rancio pintaría una
 * «vigente» que no lo es, y esa columna es justo contra la que el dueño mide su cambio).
 */
export function useCurvePreview(
  draft: PricingCurveDTO | null,
  extraMarketsCents: number[],
): CurvePreviewState {
  const marketsCents = useMemo(() => {
    const set = new Set<number>(REFERENCE_MARKETS_CENTS);
    for (const m of extraMarketsCents) if (Number.isFinite(m) && m >= 0) set.add(Math.round(m));
    return [...set].sort((a, b) => a - b).slice(0, MAX_PROBES);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraMarketsCents.join(',')]);

  // Se debouncea la ENTRADA completa (borrador + sondas): la probeta anuncia su resultado al
  // terminar de escribir, no en cada tecla (§21.10), y no se dispara una llamada por pulsación.
  const payload = useMemo(
    () => (draft ? { draft, marketsCents } : null),
    [draft, marketsCents],
  );
  const debounced = useDebouncedValue(payload, 350);

  const query = useQuery({
    queryKey: ['pricing-curve-preview', debounced ? JSON.stringify(debounced) : 'none'],
    queryFn: () => previewPricingCurve(debounced!),
    enabled: debounced != null,
    // Un dry-run es lectura pura y barata de repetir; no se cachea entre borradores distintos
    // (la clave ya incluye el borrador) ni se reintenta en bucle si el backend aún no lo expone.
    retry: false,
    staleTime: 30_000,
  });

  const byMarket = useMemo(() => {
    const map = new Map<number, CurvePreviewRowDTO>();
    for (const row of query.data?.rows ?? []) map.set(row.marketCents, row);
    return map;
  }, [query.data]);

  return {
    data: query.data,
    byMarket,
    // Mientras el debounce alcanza al borrador, la vista sigue en «cargando» en vez de
    // parpadear a vacío con cada tecla.
    isLoading: query.isLoading || (payload != null && debounced !== payload && !query.data),
    isError: query.isError,
    error: query.error,
    refetch: () => void query.refetch(),
    unavailable: draft == null,
  };
}

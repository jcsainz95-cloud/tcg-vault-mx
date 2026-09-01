'use client';

import { useQuery } from '@tanstack/react-query';
import { getBuylistQuotePolicy } from '@/lib/api';

/**
 * Mínimo de compra del cotizador (contrato §6 · `GET /buylist/quote-policy`, v1.51.4 · D43).
 *
 * **Qué es y qué NO es.** Es UN entero del servidor (`minimumRequestCents`) y la ÚNICA cifra de
 * dinero que el cotizador público conoce. NO hay tarifa de envío que leer: bajo D43 el envío se
 * dice EN PALABRAS (`buylist.quote.shippingNote`) y la tarifa **no viaja al navegador**.
 *
 * **Por qué se pide AL MONTAR y no se guarda.** El contrato lo norma: la respuesta es cacheable
 * `public, max-age=300`, así que el peor caso de una caché vieja es un botón apagado hasta 5
 * minutos a alguien que ya califica. Por eso `gcTime: 0` + `refetchOnMount: 'always'`: el dato
 * vive lo que dura el cotizador montado, nunca en un store de vida larga entre navegaciones.
 *
 * **Degradación FAIL-OPEN (y es deliberada).** Si la llamada falla (red, 5xx, 429) el front NO
 * conoce el mínimo ⇒ `minimumRequestCents` queda `undefined`, **no se pinta faltante, no se
 * inventa ningún número y el CTA sigue habilitado**. Apagar el botón sería fail-closed:
 * bloquearía a un vendedor legítimo por un error de red cuando la puerta real —el
 * `422 BUYLIST_MINIMUM_NOT_MET` de `POST /buylist/requests`— ya protege el invariante y responde
 * con el número exacto. *La pantalla informa; la puerta decide.*
 */
export function useQuotePolicy(): { minimumRequestCents?: number } {
  const query = useQuery({
    queryKey: ['buylist-quote-policy'],
    queryFn: getBuylistQuotePolicy,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    // Un reintento y ya: si no llega, la degradación fail-open es un estado LEGÍTIMO, no un
    // error que la pantalla tenga que anunciar (§23.9: la nota sigue ahí y el CTA sigue vivo).
    retry: 1,
  });
  // `query.data` es undefined mientras carga y también si falló: los dos casos se tratan igual
  // (no hay mínimo conocido ⇒ no hay faltante ⇒ no hay gate de cliente).
  return { minimumRequestCents: query.data?.minimumRequestCents };
}

/**
 * La ÚNICA resta autorizada en el cliente (contrato §6): `faltante = mínimo − total`.
 * Devuelve `null` cuando no se conoce el mínimo (fail-open) o cuando el total ya lo alcanza
 * —borde INCLUSIVO: exactamente el mínimo SÍ procede (criterio 158a)—.
 *
 * ⛔ La otra resta (`neto ≈ total − tarifa`) está PROHIBIDA y además es imposible: la tarifa no
 * viaja en ningún DTO público.
 */
export function minimumShortfallCents(
  minimumRequestCents: number | undefined,
  totalCents: number,
): number | null {
  if (minimumRequestCents == null) return null;
  if (totalCents >= minimumRequestCents) return null;
  return minimumRequestCents - totalCents;
}

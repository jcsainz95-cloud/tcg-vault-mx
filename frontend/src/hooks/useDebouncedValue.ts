import { useEffect, useState } from 'react';

/**
 * Devuelve `value` con un retardo de `delayMs` desde su último cambio.
 *
 * Patrón de uso (P-5, hallazgo de techlead): el estado del input se actualiza INMEDIATO para
 * mantener la UX responsiva, pero sólo el VALOR DEBOUNCED — el que devuelve este hook — debe
 * alimentar el `queryKey`/params de la query server-side. Así se evita un fetch por pulsación
 * en los buscadores/montos que disparan red (M3, «Cerradas» de M5).
 *
 * No debouncea el filtrado client-side (pestañas operativas de M5): eso sigue usando el valor
 * inmediato del input.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}

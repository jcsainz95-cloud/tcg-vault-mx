'use client';

import { useCallback } from 'react';
import { createLocalStore, useStoredValue } from './local-store';

const KEY = 'tcg.cart';
const EVENT = 'tcg.cart.changed';
/**
 * Expiración del carrito: 30 días EXACTOS desde la última modificación (nota de
 * frontend del contrato §4, v1.21.3-quote-prune). Complementa la poda de piezas
 * muertas del quote, no la sustituye. Se expira con `>` estricto: a los 30 días
 * cumplidos el carrito sigue vivo; a los 30 días y un milisegundo, no.
 */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function sanitizeIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * Formato de storage v2: `{ ids, updatedAt }`. El formato v1 era un array JSON plano de ids
 * (sin timestamp) y se migra SUAVEMENTE al leer (nunca se descarta un carrito por formato).
 *
 * v1.67 (Stream A): la lectura/escritura/caducidad viven en `lib/local-store.ts`, compartidas
 * con el carrito de venta (`tcg.sellCart`). Este módulo solo aporta la forma (`ids`) y el API.
 */
const store = createLocalStore<string[]>({
  key: KEY,
  field: 'ids',
  event: EVENT,
  maxAgeMs: MAX_AGE_MS,
  sanitize: sanitizeIds,
  empty: () => [],
  // Formato v1 (legado): array plano ⇒ válido siempre; migra a v2 al leer.
  migrateLegacy: (raw) => (Array.isArray(raw) ? sanitizeIds(raw) : undefined),
});

const read = () => store.read().value;
const write = (ids: string[]) => store.write(ids);

/** Carrito local por inventoryItemId (pieza única). Sin wallet ni backend. */
export function useCart() {
  const ids = useStoredValue(store, () => []);

  const add = useCallback((id: string) => {
    const current = read();
    if (!current.includes(id)) write([...current, id]);
  }, []);

  const remove = useCallback((id: string) => {
    write(read().filter((x) => x !== id));
  }, []);

  /**
   * Poda varios ids de una vez (v1.21.3-quote-prune: los `unavailableItems` del
   * quote). Misma semántica de storage que `remove`; idempotente — si ninguno de
   * los ids sigue en el carrito no escribe ni emite, para poder llamarse desde un
   * efecto sin ciclar la re-cotización.
   */
  const prune = useCallback((toRemove: string[]) => {
    if (toRemove.length === 0) return;
    const current = read();
    const next = current.filter((x) => !toRemove.includes(x));
    if (next.length !== current.length) write(next);
  }, []);

  const clear = useCallback(() => write([]), []);

  return { ids, add, remove, prune, clear, count: ids.length };
}

'use client';

import { useCallback, useEffect, useState } from 'react';

const KEY = 'tcg.cart';
const EVENT = 'tcg.cart.changed';
/**
 * Expiración del carrito: 30 días EXACTOS desde la última modificación (nota de
 * frontend del contrato §4, v1.21.3-quote-prune). Complementa la poda de piezas
 * muertas del quote, no la sustituye. Se expira con `>` estricto: a los 30 días
 * cumplidos el carrito sigue vivo; a los 30 días y un milisegundo, no.
 */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Formato de storage v2: los ids + epoch ms de la última modificación.
 * El formato v1 era un array JSON plano de ids (sin timestamp).
 */
interface StoredCart {
  ids: string[];
  updatedAt: number;
}

function sanitizeIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
}

/** Persiste en formato v2 refrescando el timestamp. NO emite evento (para poder usarse dentro de `read`). */
function persist(ids: string[]) {
  const record: StoredCart = { ids, updatedAt: Date.now() };
  window.localStorage.setItem(KEY, JSON.stringify(record));
}

/**
 * Lee el carrito tolerando ambos formatos:
 * - v2 `{ ids, updatedAt }`: si la última modificación fue hace MÁS de 30 días,
 *   el carrito se limpia (queda vacío).
 * - v1 (array plano) o v2 sin timestamp válido: migración SUAVE — se trata como
 *   carrito válido y se re-persiste en v2 con timestamp de ahora, en esta misma
 *   lectura. NUNCA se descarta un carrito por cambio de formato.
 */
function read(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw == null) return [];
    const parsed: unknown = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      // Formato v1 (legado): válido siempre; migra a v2 al leer.
      const ids = sanitizeIds(parsed);
      persist(ids);
      return ids;
    }

    if (parsed && typeof parsed === 'object' && 'ids' in parsed) {
      const { ids, updatedAt } = parsed as Partial<StoredCart>;
      const clean = sanitizeIds(ids);
      if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) {
        // Timestamp ausente/corrupto: mismo trato que el formato legado (no se descarta).
        persist(clean);
        return clean;
      }
      if (Date.now() - updatedAt > MAX_AGE_MS) {
        // Carrito con más de 30 días sin tocar: se limpia.
        persist([]);
        return [];
      }
      return clean;
    }

    return [];
  } catch {
    return [];
  }
}

function write(ids: string[]) {
  persist(ids);
  window.dispatchEvent(new Event(EVENT));
}

/** Carrito local por inventoryItemId (pieza única). Sin wallet ni backend. */
export function useCart() {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    setIds(read());
    const handler = () => setIds(read());
    window.addEventListener(EVENT, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(EVENT, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

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

'use client';

import { useEffect, useState } from 'react';

/**
 * Helper COMPARTIDO de persistencia en `localStorage` con caducidad, para los carritos
 * (ARCHITECTURE §4.47.6: «el mismo patrón que `lib/cart.ts`», parametrizado por clave y TTL).
 *
 * Contrato del registro persistido: `{ [field]: T, updatedAt: epochMs }`. Reglas (las de
 * `lib/cart.ts` v1.21.3, ahora en un solo sitio):
 * - **Caducidad con `>` estricto** desde la última MODIFICACIÓN: a los N días cumplidos el valor
 *   sigue vivo; a los N días y un milisegundo, no. Leer NO refresca el timestamp.
 * - **Migración suave**: un registro sin timestamp válido, o un formato legado reconocido por
 *   `migrateLegacy`, se conserva y se re-persiste con timestamp de ahora. NUNCA se descarta un
 *   valor por cambio de formato.
 * - **Tolerancia a corrupción**: JSON inválido o forma desconocida ⇒ valor vacío (sin lanzar).
 * - **Reactividad**: `write`/`clear` emiten `event` en `window`; `useStoredValue` se suscribe a
 *   ese evento Y a `storage` (otras pestañas).
 *
 * Consumidores: `lib/cart.ts` (carrito de compra, `tcg.cart`) y el carrito de venta de Stream A
 * (`tcg.sellCart`, `(storefront)/buylist/useSellCart.ts`).
 */
export interface LocalStoreOptions<T> {
  /** Clave de `localStorage`. */
  key: string;
  /** Nombre del campo que guarda el valor dentro del registro (`ids`, `lines`…). */
  field: string;
  /** Evento propio para sincronizar componentes de la misma pestaña. */
  event: string;
  /** Vida máxima desde la última modificación (ms). */
  maxAgeMs: number;
  /** Limpia el valor leído (arrays con basura, tipos inesperados…). Debe ser total. */
  sanitize: (raw: unknown) => T;
  /** Valor vacío (se persiste al caducar). */
  empty: () => T;
  /**
   * Reconoce un formato ANTERIOR al registro `{ [field], updatedAt }` y lo convierte. Devuelve
   * `undefined` si `raw` no es legado. Ej.: el carrito de compra v1 era un array plano de ids.
   */
  migrateLegacy?: (raw: unknown) => T | undefined;
}

export interface LocalStore<T> {
  readonly key: string;
  readonly event: string;
  /** Lee aplicando caducidad y migración. Seguro en SSR (devuelve `empty()`). */
  read(): T;
  /** Persiste refrescando `updatedAt` y emite `event`. */
  write(value: T): void;
  /** Persiste `empty()` (refresca timestamp) y emite `event`. */
  clear(): void;
  /** Persiste SIN emitir (para usarse dentro de `read`). */
  persist(value: T): void;
}

export function createLocalStore<T>(opts: LocalStoreOptions<T>): LocalStore<T> {
  const { key, field, event, maxAgeMs, sanitize, empty, migrateLegacy } = opts;

  function persist(value: T) {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, JSON.stringify({ [field]: value, updatedAt: Date.now() }));
  }

  function read(): T {
    if (typeof window === 'undefined') return empty();
    try {
      const raw = window.localStorage.getItem(key);
      if (raw == null) return empty();
      const parsed: unknown = JSON.parse(raw);

      const legacy = migrateLegacy?.(parsed);
      if (legacy !== undefined) {
        persist(legacy);
        return legacy;
      }

      if (parsed && typeof parsed === 'object' && field in (parsed as Record<string, unknown>)) {
        const record = parsed as Record<string, unknown>;
        const clean = sanitize(record[field]);
        const updatedAt = record.updatedAt;
        if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) {
          // Timestamp ausente/corrupto: mismo trato que el formato legado (no se descarta).
          persist(clean);
          return clean;
        }
        if (Date.now() - updatedAt > maxAgeMs) {
          const e = empty();
          persist(e);
          return e;
        }
        return clean;
      }

      return empty();
    } catch {
      return empty();
    }
  }

  function write(value: T) {
    persist(value);
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(event));
  }

  return {
    key,
    event,
    read,
    write,
    clear: () => write(empty()),
    persist,
  };
}

/**
 * Valor reactivo de un `LocalStore`: lee al montar (nunca en SSR ni en el primer render, para no
 * romper la hidratación) y se re-lee con el evento propio y con `storage` (otras pestañas).
 */
export function useStoredValue<T>(store: LocalStore<T>, initial: () => T): T {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    setValue(store.read());
    const handler = () => setValue(store.read());
    window.addEventListener(store.event, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(store.event, handler);
      window.removeEventListener('storage', handler);
    };
  }, [store]);

  return value;
}

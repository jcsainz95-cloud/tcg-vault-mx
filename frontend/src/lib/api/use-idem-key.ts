import { useRef } from 'react';

/**
 * Idempotency-Key estable por INTENTO de acción: se reutiliza en los reintentos (doble clic, red caída) y se
 * renueva solo cuando el intento termina bien (`renew()`), para que la siguiente acción sea otra operación.
 */
export function useIdemKey() {
  const ref = useRef<string | null>(null);
  return {
    get: (): string => (ref.current ??= globalThis.crypto.randomUUID()),
    renew: () => {
      ref.current = null;
    },
  };
}

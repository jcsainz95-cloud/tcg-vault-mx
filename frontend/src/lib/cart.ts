'use client';

import { useCallback, useEffect, useState } from 'react';

const KEY = 'tcg.cart';
const EVENT = 'tcg.cart.changed';

function read(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

function write(ids: string[]) {
  window.localStorage.setItem(KEY, JSON.stringify(ids));
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

  const clear = useCallback(() => write([]), []);

  return { ids, add, remove, clear, count: ids.length };
}

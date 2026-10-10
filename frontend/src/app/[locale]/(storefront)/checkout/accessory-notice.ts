'use client';

import { useSyncExternalStore } from 'react';
import type { BundleReason } from '@/types/contract';

/**
 * Avisos de la cotización sobre accesorios y paquetes (`DESIGN_SYSTEM §AC-UX.5`, AC-F18): «el carrito se corrige
 * solo con lo que dice el servidor y el aviso lo cuenta». Mini-store de módulo por la misma razón que
 * `unavailable-notice.ts`: sobrevive a la re-cotización que la propia corrección dispara y al desmonte de la vista
 * (si el carrito queda vacío, el padre pinta el vacío y el aviso sigue ahí). Se limpia al cerrarlo o al salir.
 */
export type AccessoryNotice =
  | { kind: 'removed'; reason: 'not_found' | 'inactive' | 'sold_out'; accessoryId: string; name: string | null }
  | { kind: 'insufficient'; accessoryId: string; name: string | null; availableQty: number }
  | { kind: 'bundle'; reason: Exclude<BundleReason, 'duplicate'>; slug: string | null; deckName: string | null };

const keyOf = (n: AccessoryNotice) =>
  n.kind === 'bundle' ? `b:${n.slug ?? '∅'}:${n.reason}` : n.kind === 'insufficient' ? `i:${n.accessoryId}:${n.availableQty}` : `r:${n.accessoryId}:${n.reason}`;

let notices: AccessoryNotice[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Acumula (sin duplicar por llave). Idempotente: re-empujar lo mismo no emite. */
export function pushAccessoryNotices(items: AccessoryNotice[]) {
  const known = new Set(notices.map(keyOf));
  const fresh = items.filter((n) => !known.has(keyOf(n)));
  if (fresh.length === 0) return;
  notices = [...notices, ...fresh];
  emit();
}
export function clearAccessoryNotices() {
  if (notices.length === 0) return;
  notices = [];
  emit();
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const snapshot = () => notices;
export function useAccessoryNotices(): AccessoryNotice[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

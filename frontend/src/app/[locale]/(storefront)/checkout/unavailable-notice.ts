'use client';

import { useSyncExternalStore } from 'react';
import type { OrderItemPreview, UnavailableCartItemDTO } from '@/types/contract';

/**
 * v1.68.1 (§4-R.5) — qué SÍ se poda: lo que el quote lista como no disponible **menos** cualquier
 * pieza que ese mismo quote devuelva en `items[]` con `reservedByYou: true`. Esa pieza está
 * reservada por una orden PROPIA (viva o vencida sin barrer) y es exactamente la que
 * `POST /checkout/session` reutiliza (`200`) o sustituye (`201`): podarla del carrito es perder la
 * reserva por un dato contradictorio. Candado: `CheckoutRetry.test.tsx` («no poda `reservedByYou`»).
 */
export function pruneCandidates(
  unavailable: UnavailableCartItemDTO[],
  items: Pick<OrderItemPreview, 'inventoryItemId' | 'reservedByYou'>[] | undefined,
): UnavailableCartItemDTO[] {
  const keep = new Set((items ?? []).filter((i) => i.reservedByYou === true).map((i) => i.inventoryItemId));
  return keep.size === 0 ? unavailable : unavailable.filter((u) => !keep.has(u.inventoryItemId));
}

/**
 * Aviso de piezas podadas del carrito (v1.21.3-quote-prune, contrato §4/§4-G.1).
 *
 * Vive en un mini-store de módulo (no en estado de componente) a propósito:
 * 1. Debe SOBREVIVIR a la re-cotización — tras la poda el carrito cambia, el quote
 *    se re-dispara y el siguiente fetch trae `unavailableItems: []`; el aviso no
 *    puede depender de la respuesta vigente del query.
 * 2. Debe sobrevivir al DESMONTE de la vista que lo produjo: si TODO el carrito
 *    murió, `CheckoutView` desmonta `GuestCheckoutView` (o su propio layout) y pinta
 *    el EmptyState — el aviso tiene que seguir ahí, junto al carrito vacío.
 * Se limpia cuando el usuario lo cierra o cuando navega fuera del checkout
 * (cleanup de `CheckoutView`).
 */
let notice: UnavailableCartItemDTO[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Acumula piezas podadas (dedupe por inventoryItemId). Idempotente: re-push del mismo id es no-op. */
export function pushUnavailableNotice(items: UnavailableCartItemDTO[]) {
  if (items.length === 0) return;
  const known = new Set(notice.map((n) => n.inventoryItemId));
  const fresh = items.filter((i) => !known.has(i.inventoryItemId));
  if (fresh.length === 0) return;
  notice = [...notice, ...fresh];
  emit();
}

export function clearUnavailableNotice() {
  if (notice.length === 0) return;
  notice = [];
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => notice;

export function useUnavailableNotice(): UnavailableCartItemDTO[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

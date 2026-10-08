'use client';

import { useCallback, useMemo } from 'react';
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

/** §AC.4: tope de cantidad por renglón de accesorio (DTO 1..99). */
export const ACCESSORY_MAX_QTY = 99;

/** Un accesorio del carrito: id + unidades. El precio NO se guarda (lo da la cotización, I-AC-3). */
export interface CartAccessory {
  id: string;
  qty: number;
}
/**
 * Un deck metido con «Agregar de jalón» (§AC.8). `token` es el `pullToken` firmado por el servidor; viaja
 * SOLO en el cuerpo de `quote`/`session`. `withEnergyBundle: false` sirve para que el carrito OFREZCA el paquete.
 * `deckName` es opcional y solo nombra el deck en los avisos (§AC-UX.5).
 */
export interface CartDeckPull {
  token: string;
  slug: string;
  withEnergyBundle: boolean;
  deckName?: string;
}
/** Carrito v3 (AC-F1): `{ ids, accessories, deckPulls }` + `updatedAt` en el registro. */
export interface CartV3 {
  ids: string[];
  accessories: CartAccessory[];
  deckPulls: CartDeckPull[];
}

function sanitizeIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
}

const clampQty = (n: number) => Math.min(ACCESSORY_MAX_QTY, Math.max(0, Math.trunc(n)));

function sanitizeAccessories(value: unknown): CartAccessory[] {
  if (!Array.isArray(value)) return [];
  const out: CartAccessory[] = [];
  for (const x of value) {
    if (!x || typeof x !== 'object') continue;
    const { id, qty } = x as Record<string, unknown>;
    if (typeof id !== 'string' || typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1) continue;
    if (out.some((a) => a.id === id)) continue;
    out.push({ id, qty: Math.min(qty, ACCESSORY_MAX_QTY) });
  }
  return out;
}

function sanitizeDeckPulls(value: unknown): CartDeckPull[] {
  if (!Array.isArray(value)) return [];
  const out: CartDeckPull[] = [];
  for (const x of value) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    if (typeof r.token !== 'string' || typeof r.slug !== 'string' || !r.token || !r.slug) continue;
    if (out.some((p) => p.slug === r.slug)) continue;
    out.push({
      token: r.token,
      slug: r.slug,
      withEnergyBundle: r.withEnergyBundle === true,
      ...(typeof r.deckName === 'string' ? { deckName: r.deckName } : {}),
    });
  }
  return out;
}

const EMPTY = (): CartV3 => ({ ids: [], accessories: [], deckPulls: [] });

/**
 * Formato de storage v3 (AC-F1, §AC): `{ ids, accessories, deckPulls, updatedAt }`, plano. Migración suave:
 * - v1 (array plano de ids) ⇒ v3 al leer (como v1→v2);
 * - v2 `{ ids, updatedAt }` ⇒ se lee como v3 con `accessories: []`, `deckPulls: []`, CONSERVANDO su `updatedAt`
 *   (la caducidad de 30 días no se reinicia por cambiar de formato). Nunca se descarta un carrito por formato.
 */
const store = createLocalStore<CartV3>({
  key: KEY,
  field: 'ids',
  event: EVENT,
  maxAgeMs: MAX_AGE_MS,
  flat: true,
  sanitize: (raw) => {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    return { ids: sanitizeIds(r.ids), accessories: sanitizeAccessories(r.accessories), deckPulls: sanitizeDeckPulls(r.deckPulls) };
  },
  empty: EMPTY,
  // Formato v1 (legado): array plano ⇒ válido siempre; migra a v3 al leer.
  migrateLegacy: (raw) => (Array.isArray(raw) ? { ...EMPTY(), ids: sanitizeIds(raw) } : undefined),
});

const read = () => store.read().value;
const write = (next: CartV3) => store.write(next);

/**
 * Carrito local: piezas únicas (`ids`), accesorios por cantidad y decks con su `pullToken`. Sin backend:
 * el precio de todo lo pone la cotización del servidor.
 */
export function useCart() {
  const cart = useStoredValue(store, EMPTY);

  const add = useCallback((id: string) => {
    const current = read();
    if (!current.ids.includes(id)) write({ ...current, ids: [...current.ids, id] });
  }, []);

  const remove = useCallback((id: string) => {
    const current = read();
    write({ ...current, ids: current.ids.filter((x) => x !== id) });
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
    const next = current.ids.filter((x) => !toRemove.includes(x));
    if (next.length !== current.ids.length) write({ ...current, ids: next });
  }, []);

  /** Suma `qty` unidades (tope 99). */
  const addAccessory = useCallback((id: string, qty = 1) => {
    const current = read();
    const found = current.accessories.find((a) => a.id === id);
    const nextQty = clampQty((found?.qty ?? 0) + qty);
    if (nextQty < 1) return;
    const accessories = found
      ? current.accessories.map((a) => (a.id === id ? { id, qty: nextQty } : a))
      : [...current.accessories, { id, qty: nextQty }];
    write({ ...current, accessories });
  }, []);

  /** Fija la cantidad; 0 quita el renglón. Idempotente (no escribe si no cambia). */
  const setAccessoryQty = useCallback((id: string, qty: number) => {
    const current = read();
    const q = clampQty(qty);
    const found = current.accessories.find((a) => a.id === id);
    if (q < 1) {
      if (found) write({ ...current, accessories: current.accessories.filter((a) => a.id !== id) });
      return;
    }
    if (found?.qty === q) return;
    const accessories = found
      ? current.accessories.map((a) => (a.id === id ? { id, qty: q } : a))
      : [...current.accessories, { id, qty: q }];
    write({ ...current, accessories });
  }, []);

  const removeAccessory = useCallback((id: string) => {
    const current = read();
    if (current.accessories.some((a) => a.id === id)) {
      write({ ...current, accessories: current.accessories.filter((a) => a.id !== id) });
    }
  }, []);

  /** Guarda o actualiza el deck por `slug` (el token nuevo manda; el nombre se conserva si no viene). */
  const upsertDeckPull = useCallback((pull: CartDeckPull) => {
    const current = read();
    const prev = current.deckPulls.find((p) => p.slug === pull.slug);
    const deckName = pull.deckName ?? prev?.deckName;
    const merged: CartDeckPull = {
      token: pull.token,
      slug: pull.slug,
      withEnergyBundle: pull.withEnergyBundle,
      ...(deckName ? { deckName } : {}),
    };
    const deckPulls = prev ? current.deckPulls.map((p) => (p.slug === pull.slug ? merged : p)) : [...current.deckPulls, merged];
    write({ ...current, deckPulls });
  }, []);

  const setBundle = useCallback((slug: string, withEnergyBundle: boolean) => {
    const current = read();
    const prev = current.deckPulls.find((p) => p.slug === slug);
    if (!prev || prev.withEnergyBundle === withEnergyBundle) return;
    write({ ...current, deckPulls: current.deckPulls.map((p) => (p.slug === slug ? { ...p, withEnergyBundle } : p)) });
  }, []);

  const removeDeckPull = useCallback((slug: string) => {
    const current = read();
    if (current.deckPulls.some((p) => p.slug === slug)) {
      write({ ...current, deckPulls: current.deckPulls.filter((p) => p.slug !== slug) });
    }
  }, []);

  const clear = useCallback(() => write(EMPTY()), []);

  const { ids, accessories, deckPulls } = cart;
  const derived = useMemo(() => {
    const bundles = deckPulls.filter((p) => p.withEnergyBundle).length;
    const units = accessories.reduce((s, a) => s + a.qty, 0);
    return { count: ids.length + units + bundles, isEmpty: ids.length === 0 && accessories.length === 0 && bundles === 0 };
  }, [ids, accessories, deckPulls]);

  return {
    ids,
    accessories,
    deckPulls,
    add,
    remove,
    prune,
    addAccessory,
    setAccessoryQty,
    removeAccessory,
    upsertDeckPull,
    setBundle,
    removeDeckPull,
    clear,
    ...derived,
  };
}

// ---------- «La oferta del paquete, una vez» (§AC-UX.8b) ----------
/**
 * Los `slug` cuya oferta de paquete ya respondió el cliente («Agregar paquete» o «No, gracias»). Llave APARTE
 * del carrito (`tcg.cart.bundleOfferSeen`) para no tocar la forma v3 que fija AC-F1.
 */
const SEEN_KEY = 'tcg.cart.bundleOfferSeen';
const SEEN_EVENT = 'tcg.cart.bundleOfferSeen.changed';
const seenStore = createLocalStore<string[]>({
  key: SEEN_KEY,
  field: 'slugs',
  event: SEEN_EVENT,
  maxAgeMs: MAX_AGE_MS,
  sanitize: sanitizeIds,
  empty: () => [],
});

export function readBundleOfferSeen(): string[] {
  return seenStore.read().value;
}
export function markBundleOfferSeen(slug: string) {
  const current = readBundleOfferSeen();
  if (!current.includes(slug)) seenStore.write([...current, slug]);
}
export function useBundleOfferSeen(): string[] {
  return useStoredValue(seenStore, () => []);
}

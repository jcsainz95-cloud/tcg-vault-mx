import { WISHLIST_DEMAND_SORTS, type WishlistDemandParams, type WishlistDemandSort } from '@/types/contract';

/**
 * Estado en la URL de la pestaña «Lista de compra» (`DESIGN_SYSTEM §WSH-UX.7 a`): `sort` y `dir`. Módulo SIN
 * `'use client'` porque lo usa también `page.tsx` (componente de servidor), igual que `salesParams.ts`.
 */
export interface BuyListUrlState {
  sort?: WishlistDemandSort;
  dir: 'asc' | 'desc';
}

type Raw = string | string[] | undefined;
const one = (v: Raw) => (Array.isArray(v) ? v[0] : v);

/** `sort`/`dir` de la URL; fuera de dominio ⇒ se ignoran ANTES de pedir (AN-UX.1: el `400` no debe verse). */
export function parseBuyListUrl(sp: Record<string, Raw>): BuyListUrlState {
  const s = one(sp.sort);
  const d = one(sp.dir);
  const sort = s && (WISHLIST_DEMAND_SORTS as readonly string[]).includes(s) ? (s as WishlistDemandSort) : undefined;
  return { sort, dir: sort && d === 'asc' ? 'asc' : 'desc' };
}

/** Lo que viaja al servidor: «Recomendado» = sin `sort` (orden por defecto, criterio 820). */
export function toBuyListParams(s: BuyListUrlState): WishlistDemandParams {
  return s.sort ? { sort: s.sort, dir: s.dir } : {};
}

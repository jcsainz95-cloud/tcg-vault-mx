/**
 * wishlist-math.ts — rev v1.87⟨wishlist⟩ (API_CONTRACT §WSH.3, ARCHITECTURE §4.WSH (e)). **La aritmética PURA de la lista de
 * deseos**: el máximo del cliente, si cabe, el «puedes pagar hasta» del dueño y el margen comprando a mercado.
 *
 * ⭐ **Enteros y UN solo redondeo por cifra.** Cada cifra es `half(numerador / denominador)` sobre el cociente EXACTO
 * (aritmética `BigInt`, sin `1.16` en coma flotante). Redondear el «sin IVA» intermedio a centavos y luego dividir entre
 * `1.15` da $787.10 donde el criterio 827 exige $787.11 (canario de §WSH.9).
 *
 * ⛔ Este fichero no decide precios de venta: el precio normal (`normalDisplayCents`) llega YA resuelto por el seam único
 * de venta (`PricingService.decideSalePrice` + `displayPriceCentsOf`). Aquí solo se compara y se acota.
 */
import { displayPriceCentsOf, IvaDials } from './money';

export const WISHLIST_PCTS = [5, 10, 16] as const;
export type WishlistPct = (typeof WISHLIST_PCTS)[number];
export type WishlistIvaMode = 'with_iva' | 'without_iva';
export type WishlistMarginBasis = 'cost' | 'sale';
export const WISHLIST_IVA_MODES: readonly WishlistIvaMode[] = ['with_iva', 'without_iva'];
export const WISHLIST_MARGIN_BASES: readonly WishlistMarginBasis[] = ['cost', 'sale'];

/** Los dos diales de IVA de la tienda (`settings.getIvaDials()`): `r` = tasa, `t` = traslación. El MISMO tipo de `money.ts`. */
export type WishlistIvaDials = IvaDials;

export function isWishlistPct(v: unknown): v is WishlistPct {
  return typeof v === 'number' && (WISHLIST_PCTS as readonly number[]).includes(v);
}

/**
 * `half(num/den)`: redondeo a la mitad **hacia arriba** del cociente EXACTO, para `num ≥ 0`, `den > 0` enteros.
 * `BigInt` para que ningún producto intermedio pierda exactitud.
 */
export function halfDiv(num: number, den: number): number {
  if (!Number.isInteger(num) || !Number.isInteger(den) || den <= 0 || num < 0) {
    throw new RangeError(`halfDiv: se esperaban enteros num ≥ 0, den > 0 (num=${num}, den=${den})`);
  }
  const n = BigInt(num);
  const d = BigInt(den);
  return Number((2n * n + d) / (2n * d));
}

/**
 * `maxDisplay(M, p)` — el máximo del cliente, CON IVA dentro (como lo ve él).
 *  - `with_iva`: el % ya incluye el IVA ⇒ `half(M·(100+p)/100)`.
 *  - `without_iva`: el % «como si fuera precio de lista» ⇒ `displayPriceCentsOf(half(M·(100+p)/100), t, r)`.
 */
export function maxDisplay(marketCents: number, p: WishlistPct, mode: WishlistIvaMode, dials: WishlistIvaDials): number {
  const base = halfDiv(marketCents * (100 + p), 100);
  return mode === 'with_iva' ? base : displayPriceCentsOf(base, dials.ivaTransferPct, dials.ivaRatePct);
}

/** `fits(P, M, p)` — `null` sin mercado (⛔ nunca `false` por falta de dato). */
export function fits(
  priceDisplayCents: number,
  marketCents: number | null,
  p: WishlistPct,
  mode: WishlistIvaMode,
  dials: WishlistIvaDials,
): boolean | null {
  if (marketCents == null) return null;
  return priceDisplayCents <= maxDisplay(marketCents, p, mode, dials);
}

/** `tope(p)` — el máximo del cliente acotado por el precio normal de la tienda (con IVA), si lo hay. */
export function tope(maxDisplayCents: number, normalDisplayCents: number | null): number {
  return normalDisplayCents == null ? maxDisplayCents : Math.min(maxDisplayCents, normalDisplayCents);
}

/**
 * `ceiling(p)` — «puedes pagar hasta», SIN IVA:
 *  - `cost`: `half(tope·10000 / ((100+r)·(100+m)))` — margen `m` % sobre lo que pagas.
 *  - `sale`: `half(tope·(100−m) / (100+r))` — margen `m` % sobre la venta.
 */
export function ceiling(topeCents: number, basis: WishlistMarginBasis, marginPct: number, ivaRatePct: number): number {
  return basis === 'cost'
    ? halfDiv(topeCents * 10000, (100 + ivaRatePct) * (100 + marginPct))
    : halfDiv(topeCents * (100 - marginPct), 100 + ivaRatePct);
}

/**
 * `marginAtMarket` — cuánto ganas (o pierdes) si la compras a mercado y la vendes al tope del nivel más alto:
 * `cents = half(tope·100/(100+r)) − M`; `pct` en PUNTOS porcentuales con un decimal (Q-WSH-UX-8):
 * `sign(cents) · half(|cents|·1000/M) / 10` (redondeo simétrico, un solo redondeo). `M ≤ 0` ⇒ `null`.
 */
export function marginAtMarket(
  topeTopCents: number,
  marketCents: number,
  ivaRatePct: number,
): { cents: number; pct: number } | null {
  if (!(marketCents > 0)) return null;
  const cents = halfDiv(topeTopCents * 100, 100 + ivaRatePct) - marketCents;
  const tenths = halfDiv(Math.abs(cents) * 1000, marketCents);
  const pct = cents < 0 ? -tenths / 10 : tenths / 10;
  return { cents, pct: pct === 0 ? 0 : pct };
}

export interface DemandTierInput {
  maxPct: WishlistPct;
  accounts: number;
}

export interface DemandTierOut {
  maxPct: WishlistPct;
  accounts: number;
  maxDisplayCents: number | null;
  ceilingCents: number | null;
}

export interface DemandRowMathInput {
  marketCents: number | null;
  /** P del precio normal de la tienda (seam de venta), `null` si la decisión es `pending` o sin mercado. */
  normalDisplayCents: number | null;
  tiers: DemandTierInput[];
  ivaMode: WishlistIvaMode;
  dials: WishlistIvaDials;
  targetMarginPct: number;
  marginBasis: WishlistMarginBasis;
}

export interface DemandRowMathOut {
  /** Solo niveles con ≥ 1 cuenta, orden 16 → 10 → 5. */
  tiers: DemandTierOut[];
  mainCeilingCents: number | null;
  marginAtMarket: { cents: number; pct: number } | null;
  buyersAtNormalPrice: number | null;
}

/** Las cifras de UNA fila de la lista de compra (§WSH.8). Sin mercado ⇒ todo `null` (ni 0; 807, 820). */
export function demandRowMath(input: DemandRowMathInput): DemandRowMathOut {
  const M = input.marketCents;
  const present = [...input.tiers].filter((t) => t.accounts > 0).sort((a, b) => b.maxPct - a.maxPct);
  if (M == null || !(M > 0)) {
    return {
      tiers: present.map((t) => ({ maxPct: t.maxPct, accounts: t.accounts, maxDisplayCents: null, ceilingCents: null })),
      mainCeilingCents: null,
      marginAtMarket: null,
      buyersAtNormalPrice: null,
    };
  }
  const tiers = present.map((t) => {
    const max = maxDisplay(M, t.maxPct, input.ivaMode, input.dials);
    const tp = tope(max, input.normalDisplayCents);
    return {
      maxPct: t.maxPct,
      accounts: t.accounts,
      maxDisplayCents: max,
      ceilingCents: ceiling(tp, input.marginBasis, input.targetMarginPct, input.dials.ivaRatePct),
    };
  });
  const top = tiers[0];
  const topTope = top ? tope(top.maxDisplayCents, input.normalDisplayCents) : null;
  return {
    tiers,
    mainCeilingCents: top ? top.ceilingCents : null,
    marginAtMarket: topTope == null ? null : marginAtMarket(topTope, M, input.dials.ivaRatePct),
    buyersAtNormalPrice:
      input.normalDisplayCents == null
        ? null
        : tiers.filter((t) => t.maxDisplayCents >= (input.normalDisplayCents as number)).reduce((a, t) => a + t.accounts, 0),
  };
}

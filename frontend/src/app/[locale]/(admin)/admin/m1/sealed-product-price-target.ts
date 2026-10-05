import type { SealedPriceOrigin, SealedProductPiecesDTO } from '@/types/contract';

/** Lo que panel (S-2) y cola traen del producto en cada fila ligada (§M11-SP.12.7). */
export interface SealedProductPriceRow {
  sealedProductDisplayPriceCents?: number | null;
  sealedPriceOrigin?: SealedPriceOrigin;
  resolvedDisplayPriceCents?: number | null;
  sealedProductPieces?: SealedProductPiecesDTO;
}

export interface SealedProductPriceTargetOf {
  /** Alguna fila trae `sealedProductDisplayPriceCents` (aunque sea `null`) ⇒ hay `expected` y se ofrece el editor. */
  hasExpected: boolean;
  /** El `P` del dueño pintado (el `expectedDisplayPriceCents` del `PUT`, §M11-SP.13.7). */
  ownerDisplayPriceCents: number | null;
  /** Lo que se pinta en «Ahora» / la cifra del bloque, con IVA. */
  displayPriceCents: number | null;
  effectiveOrigin: 'product' | 'automatic' | 'pending';
  pieces: SealedProductPiecesDTO | null;
}

/**
 * Techlead D-6 — **un** cálculo de la cifra del producto para el bloque del panel y la fila de la cola (y la línea
 * «Ahora» del editor): precio del dueño ⇒ `product`; si no, el `resolvedDisplayPriceCents` de una pieza `automatic`
 * ⇒ `automatic`; si no, `pending` sin cifra. ⛔ El `P` de una pieza con precio propio antiguo (`piece`) o pendiente no
 * es la cifra del producto (antes la cola lo pintaba como «sin precio tuyo; se vende a {P} (tuyo)»). ⛔ Nunca
 * `resolvedSalePriceCents` (es `L`).
 */
export function productPriceTargetOf(rows: readonly SealedProductPriceRow[]): SealedProductPriceTargetOf {
  const withExpected = rows.find((r) => r.sealedProductDisplayPriceCents !== undefined);
  const owner = withExpected?.sealedProductDisplayPriceCents ?? null;
  const auto = rows.find((r) => r.sealedPriceOrigin === 'automatic' && r.resolvedDisplayPriceCents != null);
  const pieces = rows.find((r) => r.sealedProductPieces != null)?.sealedProductPieces ?? null;
  return {
    hasExpected: withExpected !== undefined,
    ownerDisplayPriceCents: owner,
    displayPriceCents: owner ?? auto?.resolvedDisplayPriceCents ?? null,
    effectiveOrigin: owner != null ? 'product' : auto ? 'automatic' : 'pending',
    pieces,
  };
}

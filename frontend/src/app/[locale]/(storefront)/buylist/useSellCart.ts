'use client';

import { useCallback, useMemo, useState } from 'react';
import type { ProductType, RawCondition, Finish, BuylistQuoteResponse } from '@/types/contract';
import type { BuylistRequestItem } from '@/components/domain/BuylistKycForm';

/**
 * Referencia mínima de carta que necesita el carrito (nombre + id para el submit). `raw`
 * la puebla desde `MasterSetCardCellDTO` (binder de Master Set, sin los campos de catálogo
 * que no usa el carrito: setName/rarity/subtypes/…); graded/sealed siguen viniendo del
 * `CardDTO` completo del picker plano — un `CardDTO` cumple esta forma sin cambios.
 */
export interface QuoterCardRef {
  id: string;
  name: string;
  number: string;
  imageSmallUrl?: string;
}

/**
 * Una línea del carrito de venta. Snapshotea el ESTIMADO de la cotización
 * (`quote`) que se le muestra al usuario; el monto autoritativo lo re-deriva el
 * backend al crear la solicitud (SEC-A1). `quantity` se expande a N entradas de
 * `items` al enviar (el modelo es 1 item por carta física).
 *
 * v1.6-finish: la IDENTIDAD de línea es (cardId + productType + finish): la MISMA
 * carta en distinto acabado es una línea distinta; la MISMA (carta, tipo, acabado)
 * incrementa la cantidad en vez de duplicar (dedup — hallazgo menor de QA).
 */
export interface CartLine {
  id: string;
  card: QuoterCardRef;
  productType: ProductType;
  rawCondition?: RawCondition;
  finish: Finish;
  quote: BuylistQuoteResponse;
  quantity: number;
}

/** Línea entrante (sin id/cantidad: los asigna el merge con dedup). */
export type NewCartLine = Omit<CartLine, 'id' | 'quantity'>;

let lineSeq = 0;

/**
 * Merge con dedup por (cardId + productType + finish): la misma línea suma cantidad,
 * una combinación nueva agrega línea. Reusado por el add por-acabado y por el bulk.
 */
function mergeCartLine(prev: CartLine[], line: NewCartLine): CartLine[] {
  const idx = prev.findIndex(
    (l) => l.card.id === line.card.id && l.productType === line.productType && l.finish === line.finish,
  );
  if (idx >= 0) {
    return prev.map((l, i) => (i === idx ? { ...l, quantity: l.quantity + 1 } : l));
  }
  lineSeq += 1;
  return [...prev, { id: `line-${lineSeq}`, ...line, quantity: 1 }];
}

/**
 * Estado del carrito de venta (TL-C3/FE-13: extracción MECÁNICA de BuylistView, sin cambio
 * de comportamiento): líneas + dedup (`mergeCartLine`) + cantidades + detalle expandible por
 * línea + totales derivados. Todos los handlers son estables (`useCallback` con setState
 * funcional) para que los callbacks derivados (p. ej. `onAddToSellCart` del binder) puedan
 * memorizarse sin re-render en cascada (SC-D3).
 */
export function useSellCart() {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [expandedLines, setExpandedLines] = useState<Record<string, boolean>>({});

  const addLine = useCallback((line: NewCartLine) => {
    setCart((prev) => mergeCartLine(prev, line));
  }, []);

  /** Bulk: agrega varias líneas de golpe (mismo dedup, un solo setState). */
  const addLines = useCallback((lines: NewCartLine[]) => {
    setCart((prev) => lines.reduce((acc, l) => mergeCartLine(acc, l), prev));
  }, []);

  const setQuantity = useCallback((lineId: string, quantity: number) => {
    const clean = Number.isFinite(quantity) ? Math.max(1, Math.floor(quantity)) : 1;
    setCart((prev) => prev.map((l) => (l.id === lineId ? { ...l, quantity: clean } : l)));
  }, []);

  const removeLine = useCallback((lineId: string) => {
    setCart((prev) => prev.filter((l) => l.id !== lineId));
    // Nit (ronda TL Stream C): poda la entrada de expansión de la línea quitada — antes
    // quedaba huérfana en `expandedLines` para siempre.
    setExpandedLines((prev) => {
      if (!(lineId in prev)) return prev;
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
  }, []);

  const clearCart = useCallback(() => {
    setCart([]);
    setExpandedLines({});
  }, []);

  const toggleLineDetail = useCallback((lineId: string) => {
    setExpandedLines((prev) => ({ ...prev, [lineId]: !prev[lineId] }));
  }, []);

  // Total ESTIMADO: suma quotedPriceCents × cantidad. Las líneas en precio
  // pendiente no aportan (el backend fija su monto al recibir) y se EXPLICAN
  // debajo del total en vez de sumar MX$0.00 en silencio.
  const totalEstimatedCents = useMemo(
    () => cart.reduce((sum, l) => sum + (l.quote.quote.quotedPriceCents ?? 0) * l.quantity, 0),
    [cart],
  );
  const pendingCardCount = useMemo(
    () =>
      cart
        .filter((l) => l.quote.quote.status === 'precio_pendiente')
        .reduce((n, l) => n + l.quantity, 0),
    [cart],
  );
  const cartCount = useMemo(() => cart.reduce((n, l) => n + l.quantity, 0), [cart]);

  // Expansión cantidad → items: N entradas por línea (1 item por carta física).
  const requestItems: BuylistRequestItem[] = useMemo(
    () =>
      cart.flatMap((l) =>
        Array.from({ length: l.quantity }, () => ({
          cardId: l.card.id,
          productType: l.productType,
          rawCondition: l.rawCondition,
          // v1.6-finish: cada item lleva su acabado; el backend snapshotea SellRequestItem.finish.
          finish: l.finish,
        })),
      ),
    [cart],
  );

  return {
    cart,
    expandedLines,
    addLine,
    addLines,
    setQuantity,
    removeLine,
    clearCart,
    toggleLineDetail,
    totalEstimatedCents,
    pendingCardCount,
    cartCount,
    requestItems,
  };
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  RawCondition,
  Finish,
  BuylistQuoteResponse,
  BuylistQuoteItemDTO,
  BuylistQuotePayload,
} from '@/types/contract';
import type { BuylistRequestItem } from '@/components/domain/BuylistKycForm';
import { batchQuote, BUYLIST_QUOTE_BATCH_MAX } from '@/lib/api';
import { createLocalStore } from '@/lib/local-store';

/**
 * Referencia mínima de carta que necesita el carrito (nombre + id para el submit). La puebla
 * `MasterSetCardCellDTO` (binder de Master Set, sin los campos de catálogo que no usa el
 * carrito: setName/rarity/subtypes/…); un `CardDTO` cumple esta forma sin cambios.
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
 * v1.6-finish: la IDENTIDAD de línea es (cardId + finish): la MISMA carta en distinto
 * acabado es una línea distinta; la MISMA (carta, acabado) incrementa la cantidad en vez
 * de duplicar (dedup — hallazgo menor de QA).
 *
 * v1.30 (§4.29): la identidad gana `productId` → (cardId + finish + productId ?? base).
 * Un PRODUCTO SEPARADO (deck_exclusive/promo) es su propia línea con su propio precio: dos líneas
 * con el mismo (cardId, finish) pero distinto `productId` son DISTINTAS y NO se fusionan; una carta
 * base (sin productId) sigue igual que hoy. `card.name` guarda el nombre del PRODUCTO cuando aplica.
 *
 * v1.53 (§4.40): `productType` sale de la LLAVE de identidad porque ya no discrimina nada — el
 * cotizador compra raw y solo raw. El campo se conserva (viaja en el DTO de la solicitud) pero con
 * tipo literal `'raw'`.
 */
export interface CartLine {
  id: string;
  card: QuoterCardRef;
  /** v1.53 (§4.40, contrato §6): el buylist es raw-only. Viaja tal cual a POST /buylist/requests. */
  productType: 'raw';
  rawCondition?: RawCondition;
  finish: Finish;
  /**
   * v1.30 (§4.29): TCGplayer `productId` cuando la línea es un producto separado; ausente = línea
   * de set_base. Entra a la llave de dedup y viaja a POST /buylist/requests.
   */
  productId?: number;
  quote: BuylistQuoteResponse;
  quantity: number;
}

/** Línea entrante (sin id/cantidad: los asigna el merge con dedup). */
export type NewCartLine = Omit<CartLine, 'id' | 'quantity'>;

/**
 * Tope defensivo de cantidad por línea. No hay un límite de stock explícito en el
 * cotizador (la venta es 1 item por carta física y el monto lo re-deriva el backend),
 * así que este cap protege la UI de valores absurdos: sin él, `Array.from({ length })`
 * en `requestItems` revienta con `RangeError: Invalid array length` (arrays JS topan en
 * 2³²−1) y la página entera muere («Application error»). 999 cartas físicas iguales en
 * una sola línea de venta es ya muy por encima de cualquier caso real. IMP-A.
 */
export const MAX_LINE_QUANTITY = 999;

/** Normaliza una cantidad tecleada/derivada a un entero sano en [1, MAX_LINE_QUANTITY]. */
export function clampQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) return 1;
  return Math.min(MAX_LINE_QUANTITY, Math.max(1, Math.floor(quantity)));
}

// ---------------------------------------------------------------------------------------------
// Persistencia (P-55 · DESIGN_SYSTEM §33.11 · ARCHITECTURE §4.47.6)
//
// `localStorage['tcg.sellCart'] = { lines: CartLine[], updatedAt }` con el MISMO helper y las
// MISMAS reglas que el carrito de compra (`lib/local-store.ts`): caducidad de 30 días EXACTOS
// desde la última modificación (`>` estricto), migración suave, tolerancia a corrupción y evento
// propio. NADA viaja al servidor: es una lista de intención, no una solicitud (SEC-A1).
//
// ⛔ El `quote` persistido es SOLO PINTURA y se considera caduco en cuanto se rehidrata: al montar
// con líneas guardadas se RE-COTIZA con `POST /buylist/quote/batch` (≤50 por lote) y se sustituye
// cada `quote`; una línea `ok:false` se PODA. Mientras tanto no se puede enviar la solicitud
// (regla 7 de §33.0: «nunca inventes un precio»). Ver `requote` abajo.
// ---------------------------------------------------------------------------------------------

export const SELL_CART_KEY = 'tcg.sellCart';
export const SELL_CART_EVENT = 'tcg.sellCart.changed';
/** 30 días exactos, `>` estricto (ARCHITECTURE §4.47.6; la misma caducidad que `tcg.cart`). */
export const SELL_CART_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const FINISHES: Finish[] = ['normal', 'reverse_holo', 'holofoil', 'first_edition_holofoil'];

/** Limpia las líneas leídas del storage: solo sobreviven las que tienen lo mínimo para recotizar. */
function sanitizeLines(raw: unknown): CartLine[] {
  if (!Array.isArray(raw)) return [];
  const out: CartLine[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const l = x as Record<string, unknown>;
    const card = l.card as Record<string, unknown> | undefined;
    if (!card || typeof card.id !== 'string' || typeof card.name !== 'string') continue;
    if (typeof l.finish !== 'string' || !FINISHES.includes(l.finish as Finish)) continue;
    const quote = l.quote as BuylistQuoteResponse | undefined;
    if (!quote || typeof quote !== 'object' || !quote.quote || typeof quote.quote !== 'object') continue;
    out.push({
      id: typeof l.id === 'string' ? l.id : `line-restored-${out.length + 1}`,
      card: {
        id: card.id,
        name: card.name,
        number: typeof card.number === 'string' ? card.number : '',
        ...(typeof card.imageSmallUrl === 'string' ? { imageSmallUrl: card.imageSmallUrl } : {}),
      },
      productType: 'raw',
      ...(typeof l.rawCondition === 'string' ? { rawCondition: l.rawCondition as RawCondition } : {}),
      finish: l.finish as Finish,
      ...(typeof l.productId === 'number' ? { productId: l.productId } : {}),
      quote,
      quantity: clampQuantity(typeof l.quantity === 'number' ? l.quantity : 1),
    });
  }
  return out;
}

const store = createLocalStore<CartLine[]>({
  key: SELL_CART_KEY,
  field: 'lines',
  event: SELL_CART_EVENT,
  maxAgeMs: SELL_CART_MAX_AGE_MS,
  sanitize: sanitizeLines,
  empty: () => [],
});

let lineSeq = 0;

/** Tras restaurar, el contador de ids arranca por encima de los ids guardados (sin colisiones). */
function bumpLineSeq(lines: CartLine[]) {
  for (const l of lines) {
    const m = /^line-(\d+)$/.exec(l.id);
    if (m) lineSeq = Math.max(lineSeq, Number(m[1]));
  }
}

/**
 * Merge con dedup por (cardId + finish + productId ?? base): la misma línea suma cantidad, una
 * combinación nueva agrega línea. v1.30 (§4.29): dos líneas con el mismo (cardId, finish) pero
 * distinto `productId` NO se fusionan (producto separado = línea propia). v1.53 (§4.40):
 * `productType` sale de la llave — con raw-only era una constante en ambos lados de la igualdad.
 */
function mergeCartLine(prev: CartLine[], line: NewCartLine): CartLine[] {
  const idx = prev.findIndex(
    (l) =>
      l.card.id === line.card.id &&
      l.finish === line.finish &&
      (l.productId ?? null) === (line.productId ?? null),
  );
  if (idx >= 0) {
    // IMP-A: aun sumando de a 1, mantén la cantidad dentro del tope defensivo.
    return prev.map((l, i) =>
      i === idx ? { ...l, quantity: clampQuantity(l.quantity + 1) } : l,
    );
  }
  lineSeq += 1;
  return [...prev, { id: `line-${lineSeq}`, ...line, quantity: 1 }];
}

/** Total estimado: suma quotedPriceCents × cantidad (las pendientes no aportan). */
function estimatedTotal(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + (l.quote.quote.quotedPriceCents ?? 0) * l.quantity, 0);
}

/** Convierte el payload por-ítem del batch (mismo shape que el quote por-carta) en el `quote` de línea. */
function payloadToQuote(p: BuylistQuotePayload, prev: BuylistQuoteResponse): BuylistQuoteResponse {
  return {
    rarity: p.rarity ?? prev.rarity,
    finish: p.finish,
    ...(p.productId != null ? { productId: p.productId } : {}),
    priceBasis: p.priceBasis,
    quote: p.quote,
    referencePrice: p.referencePrice,
    paymentNotice: p.paymentNotice,
  };
}

/** Qué pasó al rehidratar (§33.11): lo pinta el dueño con `role="status"`. */
export type SellCartRestore =
  | { kind: 'none' }
  | { kind: 'expired' }
  | {
      kind: 'restored';
      /** Cartas (suma de cantidades) que había en la lista guardada. */
      count: number;
      /** Totales antes/después SOLO si algún `quotedPriceCents` cambió; si no, `null`. */
      repriced: { beforeCents: number; afterCents: number } | null;
      /** Líneas (cartas) podadas por venir `ok:false` al recotizar. */
      droppedCount: number;
    };

/** Estado de la re-cotización obligatoria al rehidratar. `pending` bloquea el envío. */
export type RequoteStatus = 'idle' | 'pending' | 'failed' | 'done';

/**
 * Estado del carrito de venta (TL-C3/FE-13: extracción MECÁNICA de BuylistView, sin cambio
 * de comportamiento): líneas + dedup (`mergeCartLine`) + cantidades + detalle expandible por
 * línea + totales derivados. Todos los handlers son estables (`useCallback` con setState
 * funcional) para que los callbacks derivados (p. ej. `onAddToSellCart` del binder) puedan
 * memorizarse sin re-render en cascada (SC-D3).
 *
 * v1.67 (Stream A · P-55): el carrito PERSISTE en `localStorage` y, al rehidratar, se RE-COTIZA
 * antes de poder enviar (ver cabecera de persistencia arriba).
 */
export function useSellCart() {
  const [cart, setCartState] = useState<CartLine[]>([]);
  const cartRef = useRef<CartLine[]>([]);
  const [expandedLines, setExpandedLines] = useState<Record<string, boolean>>({});
  const [restore, setRestore] = useState<SellCartRestore>({ kind: 'none' });
  const [requoteStatus, setRequoteStatus] = useState<RequoteStatus>('idle');
  const requoteRun = useRef(0);

  // Toda mutación pasa por aquí: estado + persistencia (escribir en cada cambio, §33.11).
  const commit = useCallback((next: CartLine[] | ((prev: CartLine[]) => CartLine[])) => {
    const value = typeof next === 'function' ? next(cartRef.current) : next;
    cartRef.current = value;
    setCartState(value);
    store.write(value);
  }, []);

  /**
   * Re-cotiza `lines` con `POST /buylist/quote/batch` (≤50 por lote; más líneas ⇒ varios lotes) y
   * sustituye cada `quote`. `ok:false` ⇒ la línea se PODA. Si el batch falla entero (red), el
   * carrito se conserva con los estimados guardados y el estado queda `failed` (el envío sigue
   * bloqueado; hay «Reintentar»). Aplica el resultado por `id` sobre el carrito ACTUAL, así una
   * línea agregada mientras se recotizaba no se pierde.
   */
  const requote = useCallback(
    async (lines: CartLine[], count: number) => {
      if (lines.length === 0) return;
      const run = ++requoteRun.current;
      setRequoteStatus('pending');
      try {
        const items: BuylistQuoteItemDTO[] = lines.map((l) => ({
          cardId: l.card.id,
          productType: 'raw',
          ...(l.rawCondition ? { rawCondition: l.rawCondition } : {}),
          finish: l.finish,
          ...(l.productId != null ? { productId: l.productId } : {}),
        }));
        const fresh = new Map<string, BuylistQuoteResponse>();
        const dropped = new Set<string>();
        for (let offset = 0; offset < items.length; offset += BUYLIST_QUOTE_BATCH_MAX) {
          const chunk = items.slice(offset, offset + BUYLIST_QUOTE_BATCH_MAX);
          const res = await batchQuote(chunk);
          for (const r of res.results) {
            const line = lines[offset + r.index];
            if (!line) continue;
            if (r.ok) fresh.set(line.id, payloadToQuote(r, line.quote));
            else dropped.add(line.id);
          }
        }
        // Una línea sin resultado (respuesta incompleta) se trata como caída: no se afirma su precio.
        for (const l of lines) if (!fresh.has(l.id) && !dropped.has(l.id)) dropped.add(l.id);
        if (run !== requoteRun.current) return; // llegó otra corrida más nueva

        const beforeCents = estimatedTotal(lines);
        let changed = false;
        const survivors = lines
          .filter((l) => !dropped.has(l.id))
          .map((l) => {
            const q = fresh.get(l.id)!;
            if (q.quote.quotedPriceCents !== l.quote.quote.quotedPriceCents) changed = true;
            return { ...l, quote: q };
          });
        const afterCents = estimatedTotal(survivors);
        const droppedCount = lines.filter((l) => dropped.has(l.id)).reduce((n, l) => n + l.quantity, 0);

        commit((prev) =>
          prev.filter((l) => !dropped.has(l.id)).map((l) => (fresh.has(l.id) ? { ...l, quote: fresh.get(l.id)! } : l)),
        );
        setExpandedLines((prev) => {
          const next = { ...prev };
          for (const id of dropped) delete next[id];
          return next;
        });
        setRestore({
          kind: 'restored',
          count,
          repriced: changed ? { beforeCents, afterCents } : null,
          droppedCount,
        });
        setRequoteStatus('done');
      } catch {
        if (run !== requoteRun.current) return;
        setRequoteStatus('failed');
      }
    },
    [commit],
  );

  // Rehidratación al montar (nunca en SSR ni en el primer render: evita mismatch de hidratación).
  useEffect(() => {
    // La caducidad la decide el helper compartido (F2-4): `expired` = había un carrito NO vacío con más
    // de 30 días y se descartó ⇒ «Tu lista de venta caducó y la vaciamos» (§33.11.1).
    const { value: lines, expired } = store.read();
    if (expired) {
      setRestore({ kind: 'expired' });
      return;
    }
    if (lines.length === 0) return;
    bumpLineSeq(lines);
    cartRef.current = lines;
    setCartState(lines);
    const count = lines.reduce((n, l) => n + l.quantity, 0);
    setRestore({ kind: 'restored', count, repriced: null, droppedCount: 0 });
    void requote(lines, count);
    // Solo al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Otras pestañas: se re-lee sin re-escribir (el evento propio lo emite `commit` de esta pestaña).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== SELL_CART_KEY) return;
      const lines = store.read().value;
      cartRef.current = lines;
      setCartState(lines);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const retryRequote = useCallback(() => {
    const lines = cartRef.current;
    void requote(lines, lines.reduce((n, l) => n + l.quantity, 0));
  }, [requote]);

  const addLine = useCallback(
    (line: NewCartLine) => {
      commit((prev) => mergeCartLine(prev, line));
    },
    [commit],
  );

  const setQuantity = useCallback(
    (lineId: string, quantity: number) => {
      // IMP-A: clampa a [1, MAX_LINE_QUANTITY]. Un valor gigante tecleado en el stepper
      // llegaba crudo hasta `requestItems` (Array.from length) y mataba la página.
      const clean = clampQuantity(quantity);
      commit((prev) => prev.map((l) => (l.id === lineId ? { ...l, quantity: clean } : l)));
    },
    [commit],
  );

  const removeLine = useCallback(
    (lineId: string) => {
      commit((prev) => prev.filter((l) => l.id !== lineId));
      // Nit (ronda TL Stream C): poda la entrada de expansión de la línea quitada — antes
      // quedaba huérfana en `expandedLines` para siempre.
      setExpandedLines((prev) => {
        if (!(lineId in prev)) return prev;
        const next = { ...prev };
        delete next[lineId];
        return next;
      });
    },
    [commit],
  );

  // «Vaciar la lista» y el éxito al enviar: vacía el estado Y borra la clave (§33.11).
  const clearCart = useCallback(() => {
    requoteRun.current += 1; // cancela una recotización en vuelo
    setRequoteStatus('idle');
    setRestore({ kind: 'none' });
    commit([]);
    setExpandedLines({});
  }, [commit]);

  const toggleLineDetail = useCallback((lineId: string) => {
    setExpandedLines((prev) => ({ ...prev, [lineId]: !prev[lineId] }));
  }, []);

  // Total ESTIMADO: suma quotedPriceCents × cantidad. Las líneas en precio
  // pendiente no aportan (el backend fija su monto al recibir) y se EXPLICAN
  // debajo del total en vez de sumar MX$0.00 en silencio.
  const totalEstimatedCents = useMemo(() => estimatedTotal(cart), [cart]);
  const pendingCardCount = useMemo(
    () =>
      cart
        .filter((l) => l.quote.quote.status === 'precio_pendiente')
        .reduce((n, l) => n + l.quantity, 0),
    [cart],
  );
  const cartCount = useMemo(() => cart.reduce((n, l) => n + l.quantity, 0), [cart]);

  // P-42 · sombreado del grid: llaves de identidad (misma que el dedup, sin la cantidad) de lo que
  // YA está en el carro. El binder pregunta `isInCart(cardId, finish, productId?)` para destacar la
  // teja ya agregada; `productId` distingue un producto separado de la carta base. v1.53 (§4.40):
  // `productType` sale de la llave (era `raw` en los dos lados) y la firma queda IDÉNTICA a la que
  // el binder ya declara (`MasterSetPanel`/`MasterSetBinder`), sin adaptador intermedio.
  const inCartKeys = useMemo(
    () => new Set(cart.map((l) => `${l.card.id}::${l.finish}::${l.productId ?? ''}`)),
    [cart],
  );
  const isInCart = useCallback(
    (cardId: string, finish: Finish, productId?: number) =>
      inCartKeys.has(`${cardId}::${finish}::${productId ?? ''}`),
    [inCartKeys],
  );

  // Expansión cantidad → items: N entradas por línea (1 item por carta física).
  const requestItems: BuylistRequestItem[] = useMemo(
    () =>
      cart.flatMap((l) =>
        // IMP-A: `length` SIEMPRE clampado — última barrera contra `RangeError:
        // Invalid array length` si una cantidad absurda llegara por cualquier vía.
        Array.from({ length: clampQuantity(l.quantity) }, () => ({
          cardId: l.card.id,
          productType: l.productType,
          rawCondition: l.rawCondition,
          // v1.6-finish: cada item lleva su acabado; el backend snapshotea SellRequestItem.finish.
          finish: l.finish,
          // v1.30 (§4.29): línea de producto separado → viaja su productId (snapshot server-side).
          ...(l.productId != null ? { productId: l.productId } : {}),
        })),
      ),
    [cart],
  );

  return {
    cart,
    expandedLines,
    addLine,
    setQuantity,
    removeLine,
    clearCart,
    toggleLineDetail,
    totalEstimatedCents,
    pendingCardCount,
    cartCount,
    isInCart,
    requestItems,
    /** Qué pasó al rehidratar (para los `role="status"` de §33.11). */
    restore,
    /** `pending` ⇒ el CTA de enviar queda deshabilitado con `aria-busy` y el total se pinta «—». */
    requoteStatus,
    requoting: requoteStatus === 'pending',
    requoteFailed: requoteStatus === 'failed',
    retryRequote,
  };
}

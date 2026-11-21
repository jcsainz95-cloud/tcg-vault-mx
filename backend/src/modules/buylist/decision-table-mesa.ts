/**
 * BUYLIST-MESA (docs/API_CONTRACT_BUYLIST_MESA.md) — campos ADITIVOS por línea de la mesa de decisión.
 *
 * Función PURA: no decide dinero, solo EXPLICA lo que el seam único (`decideBuyLine`) ya decidió. El
 * precio de la oferta es `decision.quotedPriceCents` —el mismo que congela `POST …/offer`—; aquí solo
 * se compara contra la curva pura y contra la cotización. Todo en centavos enteros MXN.
 */
import type { PriceBasis } from '../../common/pricing-curve';

export type AdjustmentReasonCode =
  | 'STOCK_CAP'
  | 'MANUAL_OVERRIDE'
  | 'BOUNTY'
  | 'FLOOR'
  | 'NO_MARKET';

export type SinceQuoteReasonCode = 'BOUNTY' | 'MANUAL_OVERRIDE' | 'MARKET_UP' | 'MARKET_DOWN' | 'CURVE_CHANGED';

export interface MesaDecisionInput {
  /** `decision.quote.marketMxnCents` (mercado de HOY). */
  marketMxnCents: number | null;
  /** `decision.quote.curveQuoteCents`: la curva de compra PURA sobre ese mercado. */
  curveQuoteCents: number | null;
  /** `decision.quotedPriceCents`: lo que `POST …/offer` congelará. `null` = sin precio. */
  derivedPriceCents: number | null;
  priceBasis: PriceBasis;
  /** Snapshot de la cotización (`SellRequestItem.quotedPriceCents` / `.marketMxnCents`). */
  quotedPriceCents: number | null;
  quotedMarketMxnCents: number | null;
  /** MESA-2: motivo capturado del override, si existe (hoy sin fuente persistida ⇒ omitido). */
  overrideReason?: string | null;
}

export interface MesaFields {
  marketMxnCents: number | null;
  standardPctBp: number | null;
  standardOfferCents: number | null;
  adjustment: { deltaCents: number; reasonCode: AdjustmentReasonCode; reasonText: string } | null;
  sinceQuote: {
    quotedCents: number;
    deltaCents: number;
    reasonCode: SinceQuoteReasonCode;
    reasonText: string;
  } | null;
}

/** `170.84` desde centavos enteros, sin pasar por coma flotante. Con miles: `1,170.84`. */
export function mxn(cents: number): string {
  const abs = Math.abs(cents);
  const pesos = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${cents < 0 ? '-' : ''}MX$${pesos}.${(abs % 100).toString().padStart(2, '0')}`;
}

const isPresent = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0;

export function mesaFields(i: MesaDecisionInput): MesaFields {
  const market = isPresent(i.marketMxnCents) ? i.marketMxnCents : null;
  const standard = market != null && i.curveQuoteCents != null ? i.curveQuoteCents : null;
  const standardPctBp = standard != null && market != null ? Math.round((standard * 10000) / market) : null;
  const derived = i.derivedPriceCents;

  let adjustment: MesaFields['adjustment'] = null;
  if (derived != null && i.priceBasis !== 'pending') {
    // Sin estándar (no hay mercado) no hay contra qué restar: el ajuste es el monto entero.
    const deltaCents = derived - (standard ?? 0);
    if (deltaCents !== 0) {
      // Prioridad del contrato: MANUAL_OVERRIDE, BOUNTY, STOCK_CAP, FLOOR, NO_MARKET. Hoy el precio
      // derivado no incorpora tope de stock (la posición solo aconseja, D6), así que STOCK_CAP no se
      // emite; `basis` es único, por lo que la prioridad se resuelve por él.
      const sinMercado = standard == null ? ' (sin precio de mercado de referencia)' : '';
      const why = (i.overrideReason ?? '').trim();
      const motivo = why ? ` — motivo: ${why}` : '';
      if (i.priceBasis === 'override') {
        adjustment = {
          deltaCents,
          reasonCode: 'MANUAL_OVERRIDE',
          reasonText: `Precio fijado por el staff para esta carta${motivo}${sinMercado}`,
        };
      } else if (i.priceBasis === 'bounty') {
        adjustment = {
          deltaCents,
          reasonCode: 'BOUNTY',
          reasonText: `Bounty vigente: pagamos ${mxn(derived)}${sinMercado}`,
        };
      } else if (i.priceBasis === 'floor') {
        adjustment = {
          deltaCents,
          reasonCode: 'FLOOR',
          reasonText: `Se aplicó el piso mínimo de compra de ${mxn(derived)}`,
        };
      } else if (standard == null) {
        adjustment = {
          deltaCents,
          reasonCode: 'NO_MARKET',
          reasonText: 'Sin precio de mercado de referencia',
        };
      }
    }
  }

  let sinceQuote: MesaFields['sinceQuote'] = null;
  if (derived != null && i.quotedPriceCents != null && derived !== i.quotedPriceCents) {
    const then = i.quotedMarketMxnCents;
    const deltaCents = derived - i.quotedPriceCents;
    let reasonCode: SinceQuoteReasonCode = 'CURVE_CHANGED';
    let reasonText = 'la tabla de compra cambió desde que se cotizó';
    if (i.priceBasis === 'override') {
      reasonCode = 'MANUAL_OVERRIDE';
      reasonText = 'precio fijado por el staff para esta carta';
    } else if (i.priceBasis === 'bounty') {
      reasonCode = 'BOUNTY';
      reasonText = 'bounty activo';
    } else if (isPresent(then) && market != null && then !== market) {
      reasonCode = market > then ? 'MARKET_UP' : 'MARKET_DOWN';
      reasonText = `el mercado ${market > then ? 'subió' : 'bajó'} de ${mxn(then)} a ${mxn(market)} desde que se cotizó`;
    }
    sinceQuote = { quotedCents: i.quotedPriceCents, deltaCents, reasonCode, reasonText };
  }

  return { marketMxnCents: market, standardPctBp, standardOfferCents: standard, adjustment, sinceQuote };
}

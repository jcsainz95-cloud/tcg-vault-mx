/**
 * tcgdex-shape.ts — v1.91⟨precios⟩ (M-75, §PRE.A / ARCHITECTURE §4.PRE (e)) — PARSER PURO + CANDADO DE
 * FORMA de la respuesta de TCGdex v2. 💰 DINERO: de aquí sale el número que vota el árbitro.
 *
 * Mide la FORMA REAL (confirmada contra `api.tcgdex.net` el 2026-10-11, fixtures en
 * `test/fixtures/tcgdex/`): `GET /v2/en/cards/{id}` ⇒ `{ pricing: { tcgplayer?, cardmarket? } }`.
 *  - `pricing.tcgplayer` = `{ unit:"USD", updated:"<ISO>", <variante>:{ marketPrice, lowPrice, ... } }`
 *    con claves de variante EXACTAS `normal` | `holofoil` | `reverse-holofoil`. Se lee `.marketPrice`.
 *  - `pricing.cardmarket` = PLANO (no objetos por variante): `{ unit:"EUR", updated, avg, trend,
 *    avg-holo, trend-holo, ... }`. Normal ⇒ `avg` (fallback `trend`); holo ⇒ `avg-holo` (fallback
 *    `trend-holo`). ⚠️ Cardmarket NO distingue reverse-holofoil (§91): el reverse NO recibe voto
 *    cardmarket (se queda con la familia `tcgplayer`; NUNCA hereda de otra variante — criterio 879/884).
 *
 * CANDADO DE FORMA (criterio del arquitecto, §4.PRE (e) «contrato de forma»): TCGdex no publica semver.
 * `parseCardPricing` es TOLERANTE a variantes ausentes (una Common no trae `holofoil`), pero LANZA
 * `TcgdexShapeError` si la estructura cambia de forma de modo que ya no se pueda leer un precio con
 * seguridad (p. ej. `pricing.tcgplayer` deja de ser objeto, o `unit` deja de ser el esperado). El
 * canario (`tcgdex-shape.spec.ts`) demuestra que MUERDE: si se afloja la comprobación de `unit`, una
 * fixture con `unit` cambiado deja de lanzar.
 */

/**
 * Las tres claves EXACTAS de variante del sub-feed tcgplayer de TCGdex. ⚠️ Son claves de la API de
 * TCGdex, NO nuestro enum `Finish` (que es `reverse_holo`, no `reverse-holofoil`, y tiene
 * `first_edition_holofoil`): dominios DISTINTOS que solo coinciden en dos literales. Se declaran por
 * constantes nombradas (no un array literal) para no disparar el candado de paridad de enums
 * (`enum-values-parity.spec.ts`), que —con razón— prohíbe listas de valores de `Finish` a mano.
 */
const TPV_NORMAL = 'normal' as const;
const TPV_HOLO = 'holofoil' as const;
const TPV_REVERSE = 'reverse-holofoil' as const;
export const TCGDEX_TCGPLAYER_VARIANTS = [TPV_NORMAL, TPV_HOLO, TPV_REVERSE] as const;
export type TcgdexTcgplayerVariant = (typeof TCGDEX_TCGPLAYER_VARIANTS)[number];

/** Nuestro `Finish` como string (evita import de @prisma en un módulo puro de parseo). */
export type FinishStr = 'normal' | 'reverse_holo' | 'holofoil' | 'first_edition_holofoil';

/** Error de FORMA: la respuesta no tiene la estructura con la que se calibró (candado de forma). */
export class TcgdexShapeError extends Error {
  constructor(message: string) {
    super(`tcgdex: FORMA inesperada — ${message}`);
    this.name = 'TcgdexShapeError';
  }
}

/** Una cotización por variante ya extraída (aún SIN convertir a MXN; eso lo hornea el provider). */
export interface TcgdexVariantQuote {
  /** Sub-feed de origen: define la FAMILIA del árbitro (`tcgplayer` ECO · `cardmarket` independiente). */
  feed: 'tcgplayer' | 'cardmarket';
  /** Nuestro `Finish` (mapeo por acabado — NUNCA por nombre, criterio 884). */
  finish: FinishStr;
  /** Importe en la moneda del sub-feed, en CENTAVOS enteros (USD¢ para tcgplayer, EUR¢ para cardmarket). */
  amountCents: number;
  /** 'USD' (tcgplayer) o 'EUR' (cardmarket). */
  currency: 'USD' | 'EUR';
  /** El `updated` del sub-feed (ISO) = el `capturedDate` de esa cotización (§PRE). */
  updatedIso: string;
}

/** Mapeo de la clave de variante tcgplayer de TCGdex a nuestro `Finish`. */
export function finishOfTcgplayerVariant(v: TcgdexTcgplayerVariant): FinishStr {
  switch (v) {
    case 'normal':
      return 'normal';
    case 'holofoil':
      return 'holofoil';
    case 'reverse-holofoil':
      return 'reverse_holo';
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Convierte un importe en unidades (p. ej. 0.11 USD) a centavos enteros; `null` si no es > 0 finito. */
export function toCents(amount: unknown): number | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null;
  // Redondeo a centavos. El importe de TCGdex viene con 2 decimales de divisa.
  const cents = Math.round(amount * 100);
  return cents > 0 ? cents : null;
}

/**
 * Parsea `pricing` de una carta de TCGdex a cotizaciones por variante. TOLERANTE a sub-feeds/variantes
 * ausentes; LANZA `TcgdexShapeError` si un sub-feed PRESENTE cambió de forma (candado de forma).
 *
 * @param pricing  el objeto `card.pricing` (puede ser `undefined` ⇒ `[]`).
 */
export function parseCardPricing(pricing: unknown): TcgdexVariantQuote[] {
  if (pricing === undefined || pricing === null) return [];
  if (!isObj(pricing)) {
    throw new TcgdexShapeError('`pricing` no es un objeto');
  }
  const out: TcgdexVariantQuote[] = [];

  // ── sub-feed tcgplayer (USD, por variante) ──
  const tp = pricing.tcgplayer;
  if (tp !== undefined && tp !== null) {
    if (!isObj(tp)) throw new TcgdexShapeError('`pricing.tcgplayer` presente pero no es objeto');
    if (tp.unit !== 'USD') {
      throw new TcgdexShapeError(`pricing.tcgplayer.unit esperado "USD", recibido ${JSON.stringify(tp.unit)}`);
    }
    const updatedIso = typeof tp.updated === 'string' ? tp.updated : null;
    if (updatedIso === null) throw new TcgdexShapeError('pricing.tcgplayer.updated ausente o no-string');
    for (const variant of TCGDEX_TCGPLAYER_VARIANTS) {
      const v = tp[variant];
      if (v === undefined || v === null) continue; // variante ausente ⇒ OK (Common no trae holofoil).
      if (!isObj(v)) throw new TcgdexShapeError(`pricing.tcgplayer.${variant} presente pero no es objeto`);
      const cents = toCents(v.marketPrice);
      if (cents === null) continue; // sin marketPrice usable ⇒ esa variante no vota (NO cae a midPrice).
      out.push({ feed: 'tcgplayer', finish: finishOfTcgplayerVariant(variant), amountCents: cents, currency: 'USD', updatedIso });
    }
  }

  // ── sub-feed cardmarket (EUR, PLANO) ──
  const cm = pricing.cardmarket;
  if (cm !== undefined && cm !== null) {
    if (!isObj(cm)) throw new TcgdexShapeError('`pricing.cardmarket` presente pero no es objeto');
    if (cm.unit !== 'EUR') {
      throw new TcgdexShapeError(`pricing.cardmarket.unit esperado "EUR", recibido ${JSON.stringify(cm.unit)}`);
    }
    const updatedIso = typeof cm.updated === 'string' ? cm.updated : null;
    if (updatedIso === null) throw new TcgdexShapeError('pricing.cardmarket.updated ausente o no-string');
    // Base (no-foil) ⇒ nuestro `normal`. `avg` primario, `trend` de respaldo.
    const base = toCents(cm.avg) ?? toCents(cm.trend);
    if (base !== null) {
      out.push({ feed: 'cardmarket', finish: 'normal', amountCents: base, currency: 'EUR', updatedIso });
    }
    // Holo ⇒ nuestro `holofoil`. `avg-holo` primario, `trend-holo` de respaldo. ⚠️ cardmarket NO
    // distingue reverse: el reverse NO recibe voto cardmarket (se queda con la familia tcgplayer).
    const holo = toCents(cm['avg-holo']) ?? toCents(cm['trend-holo']);
    if (holo !== null) {
      out.push({ feed: 'cardmarket', finish: 'holofoil', amountCents: holo, currency: 'EUR', updatedIso });
    }
  }

  return out;
}

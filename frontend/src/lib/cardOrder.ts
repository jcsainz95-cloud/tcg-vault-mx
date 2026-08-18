/**
 * Orden natural por número de carta (contrato v1.22-variantes-orden).
 *
 * El ORDEN LO DA EL BACKEND: `GET /buylist/cards` y el binder de Master Set ordenan en SQL por
 * `(numberPrefix, numberSort, number, id)` ANTES de paginar. El front NO re-implementa ese orden
 * ni lo inventa (el `numberSort: idx` sintético que se calculaba con el índice del arreglo queda
 * derogado): solo lo REPRODUCE cuando filtra localmente, usando las claves del propio DTO.
 *
 * Tolerancia de despliegue: mientras la migración M-26 no esté aplicada en el backend que sirve
 * la vista, `numberSort`/`numberPrefix` pueden llegar `undefined`. En ese caso se derivan en
 * cliente con la MISMA regla del contrato (`deriveNumberParts`) para no degradar el orden a
 * lexicográfico ("10" antes que "2"). Cuando los campos llegan, mandan ellos.
 */

/** Sentinela que empuja los promos/subsets (prefijo alfabético) al final, igual que el backend. */
const PROMO_SENTINEL = 1_000_000;

export interface NumberOrderKeys {
  numberPrefix: string;
  numberSort: number;
}

/** Regla del contrato §M1/§6: numérico puro → prefijo "" + entero; promo → prefijo + sentinela. */
export function deriveNumberParts(number: string): NumberOrderKeys {
  const raw = number.trim();
  if (/^[0-9]+$/.test(raw)) return { numberPrefix: '', numberSort: parseInt(raw, 10) };
  const numberPrefix = raw.replace(/[0-9]/g, '').toUpperCase();
  const digits = raw.replace(/\D/g, '');
  return { numberPrefix, numberSort: PROMO_SENTINEL + (digits ? parseInt(digits, 10) : 0) };
}

/** Cualquier DTO con número de carta (CardDTO, MasterSetCardCellDTO). */
export interface NumberedCardLike {
  number: string;
  numberSort?: number;
  numberPrefix?: string;
}

function keysOf(card: NumberedCardLike): NumberOrderKeys {
  const hasPrefix = typeof card.numberPrefix === 'string';
  const hasSort = typeof card.numberSort === 'number' && Number.isFinite(card.numberSort);
  if (hasPrefix && hasSort) {
    return { numberPrefix: card.numberPrefix as string, numberSort: card.numberSort as number };
  }
  return deriveNumberParts(card.number);
}

/**
 * Comparador (numberPrefix asc → numberSort asc → number asc) — equivalente exacto al ORDER BY
 * del servidor (sin el `id asc` final, que solo desempata la paginación server-side).
 */
export function compareCardNumber(a: NumberedCardLike, b: NumberedCardLike): number {
  const ka = keysOf(a);
  const kb = keysOf(b);
  if (ka.numberPrefix !== kb.numberPrefix) return ka.numberPrefix < kb.numberPrefix ? -1 : 1;
  if (ka.numberSort !== kb.numberSort) return ka.numberSort - kb.numberSort;
  if (a.number === b.number) return 0;
  return a.number < b.number ? -1 : 1;
}

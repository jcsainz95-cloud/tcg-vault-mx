/**
 * folio-neutralize.ts — 🔒 C-23 / SDX-Z-4 (API_CONTRACT §M4-SHIP.19.30.5, que sustituye la lista fija de §19.29.1.2): el
 * folio no se puede FORJAR con texto del cliente. UN cuerpo, puro.
 *
 * Antes de los DOS puertos (`QuoteInput.to` al cotizar y `PurchaseInput.to` al comprar, con `except = ['reference']`),
 * el servicio recorre TODA llave de texto del destino (recursivo en objetos y arreglos; ⛔ nunca una lista de campos a
 * incluir), la pasa a NFKC y sustituye `ENV<guion>` seguido de dígito por `ENV ` (guion fuera). Guiones: ASCII y los
 * tipográficos U+2010…U+2015, U+2212, U+FE58, U+FE63, U+FF0D. Lo guardado en `ShipmentRequest.addressSnapshot` NO cambia:
 * solo cambia lo que viaja. El remitente (`from`, nuestro) no se toca.
 */
const DASH = '[-\\u2010-\\u2015\\u2212\\uFE58\\uFE63\\uFF0D]';
const FOLIO_LIKE = new RegExp(`E\\s*N\\s*V\\s*${DASH}(?=\\s*\\d)`, 'giu');

export function neutralizeFolioPattern(text: string): string {
  return text.normalize('NFKC').replace(FOLIO_LIKE, 'ENV ');
}

function walk(value: unknown, except: ReadonlySet<string>, key: string | null): unknown {
  if (typeof value === 'string') return key !== null && except.has(key) ? value : neutralizeFolioPattern(value);
  if (Array.isArray(value)) return value.map((v) => walk(v, except, null));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = walk(v, except, k);
    return out;
  }
  return value;
}

/** Copia `to` con TODA llave de texto neutralizada salvo las de `except` (solo en el primer nivel: `reference`). */
export function neutralizeOutboundAddress<T extends object>(to: T, except: readonly string[] = []): T {
  return walk(to, new Set(except), null) as T;
}

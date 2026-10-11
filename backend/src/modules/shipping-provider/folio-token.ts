/**
 * folio-token.ts — 🔒💰 el token del folio que viaja en la compra y con el que se adopta una guía en vuelo
 * (API_CONTRACT §M4-SHIP.19.28.1 con el formato de §19.29.1.1–.2, C-15/C-18). UN cuerpo, puro. Vive en
 * `shipping-provider/` porque lo usan el servicio (al armar la compra) y el adaptador (al leer el listado).
 *
 *  - Token = `<folio>-<NN>` (`ENV-000045-01`): folio `ENV-` + ≥ 6 dígitos, intento de DOS dígitos `01…99`.
 *  - Lo que viaja en `address_to.reference`: `"Pedido " + token`.
 *  - `folioTokenOf(text)`: trim + mayúsculas; acepta SOLO el texto entero `^PEDIDO ENV-(\d{6,})-(\d{2})$` y devuelve
 *    `ENV-<g1>-<g2>`; cualquier otra cosa (prefijo, sufijo, dos tokens, intento de 1 o 3 dígitos) ⇒ `null`.
 *    ⛔ Sin NFKC (§19.30.5): el `reference` lo escribimos nosotros en ASCII; ser más estricto aquí es la defensa.
 */
export const FOLIO_ATTEMPT_MAX = 99;

const TOKEN_TEXT = /^PEDIDO ENV-(\d{6,})-(\d{2})$/;

export function providerReferenceOf(folio: string, attemptNo: number): string {
  if (!/^ENV-\d{6,}$/.test(folio)) throw new Error(`folio con forma inválida: ${folio}`);
  if (!Number.isInteger(attemptNo) || attemptNo < 1 || attemptNo > FOLIO_ATTEMPT_MAX) {
    throw new Error(`intento fuera de 1..${FOLIO_ATTEMPT_MAX}: ${attemptNo}`);
  }
  return `${folio}-${String(attemptNo).padStart(2, '0')}`;
}

/** El texto que viaja en `address_to.reference` (§19.28.1). */
export function referenceTextOf(providerReference: string): string {
  return `Pedido ${providerReference}`;
}

export function folioTokenOf(text: string | null | undefined): string | null {
  if (typeof text !== 'string') return null;
  const m = TOKEN_TEXT.exec(text.trim().toUpperCase());
  return m ? `ENV-${m[1]}-${m[2]}` : null;
}

/**
 * address-place-key.ts — la CLAVE DE LUGAR de una dirección (API_CONTRACT §4-G.9c, v1.116; ARCHITECTURE §4.47.4). PURO.
 *
 * Dos direcciones son «la misma» si coinciden en el LUGAR (CP, calle, interior, colonia), no en el destinatario: al pasar la
 * dirección de un pedido de invitado a la libreta, si ya hay una con esta clave gana la del cliente aunque el nombre o el
 * teléfono sean otros. Cada parte: recortada, espacios colapsados, minúsculas y sin acentos; `null`/ausente = vacío.
 */
export interface PlaceKeyInput {
  postalCode?: unknown;
  line1?: unknown;
  line2?: unknown;
  neighborhood?: unknown;
}

/** Separador que no aparece en texto capturado (U+001F): `a|b` + `c` no choca con `a` + `b|c`. */
const SEP = '\u001f';

function part(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function addressPlaceKey(a: PlaceKeyInput): string {
  return [a.postalCode, a.line1, a.line2, a.neighborhood].map(part).join(SEP);
}

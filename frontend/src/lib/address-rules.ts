/**
 * Reglas de FORMA de una dirección MX que comparten la libreta (`POST/PATCH /users/me/addresses`,
 * contrato §1) y el checkout de invitado (`GuestAddressInput`, §4-G.1) desde la fase C
 * (`API_CONTRACT §M4-SHIP.19.5`, criterio 235): CP `^\d{5}$`, teléfono `^\d{10}$`, `references` ≤ 70 y
 * colonia OBLIGATORIA de la lista del CP.
 *
 * Por qué vive aquí y no en cada formulario: antes la libreta pedía «CP ≥ 3, teléfono ≥ 7» y el
 * invitado «5 y 10» — dos reglas para una sola dirección. El servidor es la autoridad (vuelve a
 * validar todo); esto solo evita un viaje que va a volver `400` sin `details.field` (el
 * `ValidationPipe` no lo emite, `BACKEND_NOTES §58.2` punto 2) y que por eso no se podría pintar bajo
 * el campo.
 */

export const POSTAL_CODE_RE = /^\d{5}$/;
export const PHONE_RE = /^\d{10}$/;
/** `references` ≤ 70: viaja como `further_information` de la guía (§19.5); Skydropx no acepta más. */
export const REFERENCES_MAX = 70;
/**
 * `line2` (número interior / depto.) 0..200 — errata v1.80.12.3 (`API_CONTRACT §M4-SHIP.19.23.4`): el
 * `0..120` de §19.20.1 era de transcripción; manda `GuestAddressInput` (`ADDRESS_LIMITS.line2 = 200`,
 * `backend/src/modules/users/address-rules.ts:17`). Medido antes de este cambio: el frontend NO fijaba
 * ninguna cota para `line2` (ni `maxLength` ni validación) en libreta, invitado ni «Capturar guía».
 */
export const LINE2_MAX = 200;

export function isPostalCode(value: string): boolean {
  return POSTAL_CODE_RE.test(value.trim());
}

/**
 * N-3: normaliza un teléfono MX a sus 10 dígitos nacionales. Acepta lo que la gente teclea de
 * verdad — `55 4017 0606`, `(55) 4017-0606`, `+52 55 4017 0606`, `+521 55...` — quitando
 * separadores y la lada de país 52/521.
 */
export function normalizeMxPhone(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('52')) d = d.slice(2); // +52 55...
  else if (d.length === 13 && d.startsWith('521')) d = d.slice(3); // +521 55... (móvil legacy)
  return d;
}

export function isMxPhone(raw: string): boolean {
  return PHONE_RE.test(normalizeMxPhone(raw));
}

/**
 * La MISMA normalización con la que el servidor compara la colonia (`normalizeColonia`,
 * `backend/src/modules/shipping-provider/geo/postal-code.ts:53`): sin acentos, espacios colapsados,
 * mayúsculas. Solo sirve para PRESELECCIONAR en la lista una colonia guardada antes con otra grafía;
 * lo que se manda es siempre el valor canónico de la lista.
 */
export function normalizeColonia(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/**
 * La colonia de `list` que corresponde a `value` (comparación tras `normalizeColonia`), o `''` si
 * no está. `''` ⇒ el `Select` vuelve al placeholder y hay que elegir (⛔ sin texto libre, §T.2).
 */
export function matchNeighborhood(value: string | null | undefined, list: readonly string[]): string {
  if (!value || value.trim() === '') return '';
  const key = normalizeColonia(value);
  return list.find((n) => normalizeColonia(n) === key) ?? '';
}

/**
 * v1.80 (P-71, DESIGN_SYSTEM §37.3, contrato «Reglas del valor»): el código corto IMPRESO del set.
 *
 * Una sola forma en toda la tienda: **`TWM 130`** — código + ESPACIO NO SEPARABLE + número, como los
 * jugadores escriben una lista. Sin código ⇒ lo de siempre, `#130`. ⛔ Nunca un guion, «N/A», «null»
 * ni una sigla deducida del nombre o del `externalId` («sv6» no es un código impreso): sin dato, no
 * se finge — misma regla que el precio.
 *
 * El valor llega del servidor ya normalizado (`trim`, vacío ⇒ `null`) y **tal como lo guardó el
 * sync**: aquí NO se pasa a mayúsculas. La defensa de abajo contra `''`/espacios es solo para no
 * pintar «  130» si un emisor viola la norma; no es una segunda normalización.
 */

/**
 * Espacio no separable (U+00A0): «TWM 130» nunca se parte en dos renglones. Va como escape y no como
 * carácter pegado: en un editor los dos se ven igual y el literal invisible es el que se rompe sin
 * que nadie lo note (un «guardar» que normaliza espacios lo convierte en un espacio normal).
 */
export const NBSP = '\u00A0';

/** El código si es exhibible; `null` si no hay (o si un emisor mandara vacío). */
export function displaySetCode(code: string | null | undefined): string | null {
  if (code == null) return null;
  return code.trim() === '' ? null : code;
}

/**
 * «TWM 130» con código; `#130` sin él. `number` vacío (sellado, promos sin número) ⇒ solo el
 * código, o `''` si tampoco hay código (el llamador decide si pinta algo).
 */
export function formatCardCode(code: string | null | undefined, number: string): string {
  const c = displaySetCode(code);
  const n = number.trim();
  if (c) return n ? `${c}${NBSP}${n}` : c;
  return n ? `#${n}` : '';
}

/**
 * «Buscar set» (contrato §M1 / §6 `GET /buylist/sets`, v1.80): casa si el NOMBRE **o** el CÓDIGO
 * contienen la consulta, sin distinguir mayúsculas. Un set con código `null` solo casa por nombre.
 * Es la MISMA regla que aplica el servidor en los índices de master set; el cotizador la aplica en
 * el cliente sobre `GET /buylist/sets`.
 */
export function setMatchesQuery(name: string, code: string | null | undefined, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  if (name.toLowerCase().includes(q)) return true;
  const c = displaySetCode(code);
  return c != null && c.toLowerCase().includes(q);
}

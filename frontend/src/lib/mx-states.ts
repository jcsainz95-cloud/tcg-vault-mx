/**
 * Las 32 entidades federativas para el `<select>` de **Estado** cuando la dirección se escribe a mano
 * (`DESIGN_SYSTEM §43.18m.4`, FC-24; `API_CONTRACT §M4-SHIP.19.25.1`: con el CP fuera del catálogo
 * `state` es texto 1..120 y se guarda tal cual).
 *
 * - `label`: el nombre corto de §43.18m.4, en orden alfabético `es` (no se traduce: son nombres propios).
 * - `value`: el NOMBRE OFICIAL de la entidad tal como lo trae SEPOMEX en `d_estado`, que es lo que el
 *   catálogo guarda en `PostalCode.state` (`scripts/geo/sepomex-parse.ts:54`; p. ej. «Michoacán de Ocampo»,
 *   `scripts/geo/import-sepomex.test.ts:38`). Así una dirección escrita a mano y una de la lista se leen
 *   igual en la guía (`area_level1`), que es el ideal de §43.18m.4. El contrato no fija otra cosa (texto
 *   libre 1..120): si algún día la fija, manda el contrato.
 */
export interface MxState {
  value: string;
  label: string;
}

export const MX_STATES: readonly MxState[] = [
  { value: 'Aguascalientes', label: 'Aguascalientes' },
  { value: 'Baja California', label: 'Baja California' },
  { value: 'Baja California Sur', label: 'Baja California Sur' },
  { value: 'Campeche', label: 'Campeche' },
  { value: 'Chiapas', label: 'Chiapas' },
  { value: 'Chihuahua', label: 'Chihuahua' },
  { value: 'Ciudad de México', label: 'Ciudad de México' },
  { value: 'Coahuila de Zaragoza', label: 'Coahuila' },
  { value: 'Colima', label: 'Colima' },
  { value: 'Durango', label: 'Durango' },
  { value: 'México', label: 'Estado de México' },
  { value: 'Guanajuato', label: 'Guanajuato' },
  { value: 'Guerrero', label: 'Guerrero' },
  { value: 'Hidalgo', label: 'Hidalgo' },
  { value: 'Jalisco', label: 'Jalisco' },
  { value: 'Michoacán de Ocampo', label: 'Michoacán' },
  { value: 'Morelos', label: 'Morelos' },
  { value: 'Nayarit', label: 'Nayarit' },
  { value: 'Nuevo León', label: 'Nuevo León' },
  { value: 'Oaxaca', label: 'Oaxaca' },
  { value: 'Puebla', label: 'Puebla' },
  { value: 'Querétaro', label: 'Querétaro' },
  { value: 'Quintana Roo', label: 'Quintana Roo' },
  { value: 'San Luis Potosí', label: 'San Luis Potosí' },
  { value: 'Sinaloa', label: 'Sinaloa' },
  { value: 'Sonora', label: 'Sonora' },
  { value: 'Tabasco', label: 'Tabasco' },
  { value: 'Tamaulipas', label: 'Tamaulipas' },
  { value: 'Tlaxcala', label: 'Tlaxcala' },
  { value: 'Veracruz de Ignacio de la Llave', label: 'Veracruz' },
  { value: 'Yucatán', label: 'Yucatán' },
  { value: 'Zacatecas', label: 'Zacatecas' },
];

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

/**
 * El `value` de la entidad que corresponde a `raw` (por valor oficial o por etiqueta corta, sin acentos
 * ni mayúsculas), o `null` si no corresponde a ninguna. Sirve para PRELLENAR el `<select>` con lo que ya
 * traía la dirección (o la respuesta `200` sin colonias); ⛔ nunca reescribe lo que el usuario mandará
 * si no casa: quien monta conserva el texto original como opción extra (no se pierde un dato guardado).
 */
export function matchMxState(raw: string | null | undefined): string | null {
  if (!raw || raw.trim() === '') return null;
  const key = fold(raw);
  const hit = MX_STATES.find((s) => fold(s.value) === key || fold(s.label) === key);
  return hit ? hit.value : null;
}

/**
 * Las opciones del `<select>`: las 32 y, si `current` no es ninguna (p. ej. un estado guardado con otra
 * grafía), `current` al principio tal cual — un `<select>` controlado con un valor sin opción enseñaría
 * otro distinto del que se manda.
 */
export function mxStateOptions(current: string): MxState[] {
  const c = current.trim();
  if (c === '' || MX_STATES.some((s) => s.value === c)) return [...MX_STATES];
  return [{ value: c, label: c }, ...MX_STATES];
}

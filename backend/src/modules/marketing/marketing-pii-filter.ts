/**
 * marketing-pii-filter.ts — 🔒 FILTRO PII server-side del texto de marketing que viene de un humano
 * (ARCHITECTURE §13.4.3 c6 / §13.4.6 h1; API_CONTRACT §MKT.E). PURO (sin IO).
 *
 * El admin es de CONFIANZA, pero el filtro cierra el **error honesto**: pegar el nombre de un cliente,
 * su `@usuario`, su correo, un teléfono o un CURP/RFC en una etiqueta que acabará en una gráfica y en
 * el export. Es el MISMO filtro que c6 (términos de búsqueda sin resultado): una sola definición para
 * que no diverjan. `containsPii(x) === true` ⇒ el llamador RECHAZA (no guarda) con `422 VALIDATION_ERROR`.
 *
 * Descarta si el texto:
 *  - contiene `@` (arroba de usuario) o un correo;
 *  - tras quitar separadores (espacios/`.`/`-`/`/`) deja una **racha de ≥7 dígitos** o **≥10 dígitos en total**
 *    (teléfonos, CLABE, tarjetas…);
 *  - encaja con **CURP** `[a-z]{4}\d{6}[hm][a-z]{5}[a-z0-9]\d` o **RFC** `[a-z&ñ]{3,4}\d{6}[a-z0-9]{3}`.
 *
 * ⚠️ Falso positivo aceptado: una etiqueta legítima con muchos dígitos se rechaza; el admin la reescribe.
 * Preferimos eso a filtrar PII de menos (misma doctrina que los `utm_*`; seguridad lo revisa).
 */

/** CURP: 4 letras + 6 dígitos (fecha) + H/M + 5 letras + 1 alfanumérico + 1 dígito. */
const CURP = /[a-z]{4}\d{6}[hm][a-z]{5}[a-z0-9]\d/;
/** RFC (persona física/moral): 3-4 letras + 6 dígitos (fecha) + 3 alfanuméricos (homoclave). */
const RFC = /[a-z&ñ]{3,4}\d{6}[a-z0-9]{3}/;
/** Correo electrónico (el `@` ya lo cubre, pero dejamos la forma explícita documentada). */
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

/**
 * Normaliza para detectar dígitos/CURP/RFC: minúsculas, sin acentos, SIN separadores
 * (espacio, `.`, `-`, `/`, `\`). Igual que c6 «quitar espacios/guiones/puntos/`/` antes de filtrar».
 */
function normalizeForPii(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s./\\-]/g, '');
}

/** ¿El texto contiene PII según el filtro c6/h1? `true` ⇒ el llamador NO lo guarda. */
export function containsPii(value: string | null | undefined): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value.includes('@') || EMAIL.test(value)) return true;
  const stripped = normalizeForPii(value);
  if (/\d{7,}/.test(stripped)) return true; // racha ≥7 dígitos
  if ((stripped.match(/\d/g) ?? []).length >= 10) return true; // ≥10 dígitos en total
  if (CURP.test(stripped)) return true;
  if (RFC.test(stripped)) return true;
  return false;
}

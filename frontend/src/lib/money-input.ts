/**
 * 💰 **EL conversor de pesos tecleados a centavos del front** (TL-ENV-F2, techlead; cerrada en el stream de descuentos).
 *
 * Había 7 `function pesosToCents` en `app/` (m2 ×2, m3, m4, m5 ×2, códigos) más `pesosInputToCents` (accesorios) y
 * `toCents` (filtros de la tienda), y cada uno trataba el vacío a su manera: `0`, `null`, `undefined` o `NaN`. Un vacío
 * leído como `0` es un regalo (la clase de R1). Ahora hay UNO, con tres salidas que no se confunden:
 *
 * - `''` (o solo espacios) ⇒ `null` — el campo está vacío (opcional = «sin límite», o «falta»);
 * - mal formado ⇒ `NaN` — se marca inválido, ⛔ nunca se envía;
 * - si no ⇒ centavos enteros ≥ 0.
 *
 * Forma aceptada: dígitos con comas de miles opcionales y hasta 2 decimales (`1,250.50`, `150`, `12.5`, `.5`, `12.`).
 * ⛔ Sin signo (un importe tecleado nunca es negativo), sin exponente (`1e3`), sin `$`, sin 3 decimales (`12.345` es un
 * error de tecleo, no un redondeo). Aritmética de ENTEROS: `0.29` ⇒ 29 (con `Math.round(n × 100)` también, pero aquí no
 * hay flotante que discutir). ⛔ No es cálculo de precio: es cambio de unidad de lo que se escribió (§AC.11).
 */
export function pesosToCents(raw: string): number | null {
  const v = raw.trim().replace(/,/g, '');
  if (v === '') return null;
  const m = /^(\d*)(?:\.(\d{0,2}))?$/.exec(v);
  if (!m || (m[1] === '' && (m[2] ?? '') === '')) return Number.NaN;
  return Number(m[1] || '0') * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/** Para los campos que no distinguen «vacío» de «mal formado» (los dos bloquean): `null` en ambos casos. */
export function pesosToCentsOrNull(raw: string): number | null {
  const c = pesosToCents(raw);
  return c === null || Number.isNaN(c) ? null : c;
}

/** Centavos ⇒ el texto del campo (`12345` ⇒ `'123.45'`); `null`/`undefined` ⇒ `''` (campo vacío). */
export function centsToPesosInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  const int = Math.trunc(cents / 100);
  const dec = String(Math.abs(cents % 100)).padStart(2, '0');
  return `${int}.${dec}`;
}

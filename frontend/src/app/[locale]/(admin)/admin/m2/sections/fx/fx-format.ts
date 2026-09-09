/**
 * Formato y aritmética de la tarjeta de FX (`DESIGN_SYSTEM §30.3`). **Puro y sin React**: es el
 * único sitio donde se decide cómo se escribe un número de esta tarjeta, para que la cifra grande,
 * las dos columnas, el salto y los dos diálogos **no puedan discrepar entre sí**.
 *
 * ⛔ **Lo que este módulo NO hace, y es la mitad de su razón de existir** (§30.3b):
 *  - **No aplica el colchón** a ninguna tasa ni al salto. Se aplica **aguas abajo** y es **el mismo
 *    en las dos ramas**: meterlo aquí inventaría un salto que no existe.
 *  - **No calcula ninguna «tasa efectiva»** (`tasa × (1 + colchón)`). Sería **un tercer número
 *    emitido por la pantalla** que puede discrepar del motor de precios.
 *  - **No deriva la frescura** (`ageDays > 5`) ni ninguna otra cosa que el servidor ya resuelve.
 */

/** El signo menos de las cifras de esta tarjeta es **U+2212**, no el guion ASCII (§30.3c). */
export const MINUS_SIGN = '−';

/**
 * Tasa CRUDA a **cuatro decimales, siempre** (`19.0000`, no `19`) — §30.3b. El override se guarda
 * a esa precisión y **recortar decimales en una comparación de dinero inventa una igualdad que no
 * existe**.
 */
export function formatRate(value: number): string {
  return value.toFixed(4);
}

/** Firma una cifra: `−` es U+2212, `+` es el ASCII normal, y el cero no lleva signo. */
function signed(value: number, decimals: number): string {
  const fixed = Math.abs(value).toFixed(decimals);
  if (Number(fixed) === 0) return fixed;
  return `${value < 0 ? MINUS_SIGN : '+'}${fixed}`;
}

/** El porcentaje del salto, con su signo y **dos decimales** (§30.3c). Sin el símbolo `%`. */
export function formatSignedPct(pct: number): string {
  return signed(pct, 2);
}

/**
 * El porcentaje **con su símbolo**, para los copys que lo interpolan enteros (`confirm.effect`,
 * `ack.prices`): las cifras entre llaves llegan **ya formateadas** (§9.3, §30.15) y el texto
 * ⛔ **no concatena unidades**.
 */
export function formatSignedPctWithUnit(pct: number): string {
  return `${formatSignedPct(pct)} %`;
}

/** El colchón, de solo lectura y con un decimal: `3.0 %` (§30.2). */
export function formatBufferPct(pct: number): string {
  return `${pct.toFixed(1)} %`;
}

/**
 * El salto entre la tasa **vigente** y la que **regiría** tras el cambio (§30.3c). Lo deriva la
 * interfaz —⛔ **no es un campo del contrato**— porque un tercer número emitido por el servidor
 * podría discrepar de la resta que el humano tiene delante.
 *
 * ```
 * delta = destino − vigente                       // 4 decimales
 * pct   = (destino − vigente) / vigente × 100     // 2 decimales
 * ```
 *
 * Devuelve `null` cuando **no hay segunda tasa** con la que comparar (o cuando la vigente es 0 y
 * el porcentaje no existe): ahí la línea **no es un número**, es la frase de `jump.unavailable`.
 * ⛔ **Nunca se compone un salto contra el valor de respaldo en la tarjeta en reposo.**
 */
export interface FxJump {
  /** `destino − vigente`, con signo y cuatro decimales. */
  deltaText: string;
  /** El porcentaje con signo y dos decimales, **sin** el símbolo `%`. */
  pctText: string;
  /** El porcentaje crudo, para los copys que lo interpolan con unidad. */
  pct: number;
  /** Las dos tasas son idénticas ⇒ se dice «no se movería nada» (⛔ no se esconde la línea). */
  isZero: boolean;
}

export function computeFxJump(current: number | null | undefined, target: number | null | undefined): FxJump | null {
  if (typeof current !== 'number' || !Number.isFinite(current) || current === 0) return null;
  if (typeof target !== 'number' || !Number.isFinite(target)) return null;
  const delta = target - current;
  const pct = (delta / current) * 100;
  return {
    deltaText: signed(delta, 4),
    pctText: formatSignedPct(pct),
    pct,
    // La igualdad se juzga **sobre la cifra pintada** (4 decimales): si las dos columnas enseñan
    // el mismo número, la línea del salto no puede decir que hay uno.
    isZero: Number(Math.abs(delta).toFixed(4)) === 0,
  };
}

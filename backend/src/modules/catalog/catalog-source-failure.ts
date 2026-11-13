/**
 * ¿El fallo de un set es del SERVICIO EXTERNO (pokemontcg.io caído: 5xx, 429, timeout, red) y no nuestro? Decide el texto llano del
 * correo de la alerta de 48 h («la causa es la fuente»). Pura y sin I/O. Un fallo de base de datos, de validación o de TCGCSV NO cuenta.
 */
const SOURCE_DOWN = /pokemontcg\.io[^\n]*HTTP (5\d\d|429)\b|timeout|timed out|aborted|fetch failed|ECONN(RESET|REFUSED)|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up/i;

export function isSourceOutageMessage(message: string): boolean {
  return SOURCE_DOWN.test(message);
}

/** `true` ⇔ hay fallos y TODOS son de la fuente externa (si alguno es nuestro, no se le echa la culpa a pokemontcg.io). */
export function allFailuresFromSource(failures: readonly { message: string }[]): boolean {
  return failures.length > 0 && failures.every((f) => isSourceOutageMessage(f.message));
}

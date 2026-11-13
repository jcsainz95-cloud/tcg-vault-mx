/**
 * ¿El fallo de un set es del SERVICIO EXTERNO pokemontcg.io (5xx, 429, timeout o red de SU cliente) y no nuestro? Decide el texto llano del
 * correo de la alerta de 48 h («la causa es la fuente»). Pura y sin I/O.
 *
 * ⭐ El patrón está LIGADO al cliente: `PokemonTcgIoClient` prefija TODOS sus errores con `pokemontcg.io` (HTTP, timeout y red), y aquí solo
 * cuenta un mensaje que EMPIEZA así. Un timeout nuestro (transacción de Prisma expirada, «lock timeout», «Timed out fetching a new connection
 * from the connection pool»), un `aborted` de TCGCSV o un error de base de datos NO lo es y no se le echa la culpa a pokemontcg.io.
 */
const SOURCE_DOWN = /^pokemontcg\.io\b[^\n]*(HTTP (5\d\d|429)\b|timeout|network)/i;

export function isSourceOutageMessage(message: string): boolean {
  return SOURCE_DOWN.test(message);
}

/** `true` ⇔ hay fallos y TODOS son de la fuente externa (si alguno es nuestro, no se le echa la culpa a pokemontcg.io). */
export function allFailuresFromSource(failures: readonly { message: string }[]): boolean {
  return failures.length > 0 && failures.every((f) => isSourceOutageMessage(f.message));
}

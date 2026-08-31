/**
 * v1.51-d (TL-GE7) — **LAS MARCAS DE LOG DEL CAMINO GRADED, EN UN SOLO SITIO.**
 *
 * ### El defecto de CLASE que este módulo cierra (no una instancia: la clase)
 * Van tres pases sobre el mismo bug y cada uno cerró instancias dejando otra viva (R1, R1-ter,
 * R1-quater, y dos más que QA encontró por su cuenta). El invariante que se rompía **no** es «el tipo
 * permite un estado imposible» —eso lo cerró `GradedRunOutcome`— sino:
 *
 * > **el mensaje cita una evidencia que en ese estado no existe.**
 *
 * Mientras esa cita fuera **prosa libre** verificada a mano, cada rama nueva podía volver a inventarse
 * una línea de log; y como el operador *sí* va a buscar lo que el bloque le manda buscar, una cita
 * falsa cuesta exactamente lo que costaba la causa falsa: mandarlo a la reparación equivocada.
 *
 * ### La regla, en dos piezas
 *  1. **Una sola constante por línea.** El que EMITE la línea (`PokemonPriceTrackerBulkProvider`,
 *     `PptSetMapper`, `PriceIngestService`) y el que la CITA (`gradedPhase2Verdict`) leen la MISMA
 *     constante. Nunca dos literales que «se parecen»: si la línea cambia de texto, cambia en los dos
 *     lados a la vez o no cambia en ninguno.
 *  2. **Citar es declarar.** `citarLineaViva()` afirma *«esta línea está en el log de ESTA corrida»* y
 *     `citarLineaAusente()` afirma lo contrario. Son afirmaciones VERIFICABLES, no adornos: el
 *     guardián (`test/graded-run.harness.ts` → `verificarCitasDelVeredicto`) las comprueba contra los
 *     logs realmente capturados en cada corrida real de la suite.
 *
 * ### Por qué las marcas llevan `…`
 * Muchas líneas tienen una parte variable en medio (el `externalId` del set, un contador). La marca la
 * declara con `…` y sirve para las DOS cosas: `emitirLineaGraded()` la rellena para emitir, y el
 * guardián la trata como comodín para verificar. Así la cita y la emisión no pueden divergir: son la
 * misma cadena.
 */

/** El hueco de una marca: parte variable de la línea (id de set, contador, …). */
export const HUECO = '…';

/**
 * Las líneas del camino graded que el veredicto puede citar. **Prefijos invariables**: se citan tal
 * cual y se emiten con `emitirLineaGraded()`, que rellena los `…` y deja que el emisor añada la cola
 * variable (detalle, pista, muestra) que no forma parte de la cita.
 */
export const GRADED_LOG_LINES = {
  /** Provider, causa #4: sin llave no se emite NI UNA petición. */
  missingApiKey: 'PPT graded: falta POKEMONPRICETRACKER_API_KEY',
  /** Provider, causa #5: el set llegó sin `pptSetId` ⇒ no se pide nada (jamás se cae al externalId). */
  setWithoutPptSetId: `PPT graded: set ${HUECO} sin pptSetId → no se pide nada`,
  /** Provider: se EMITIÓ la petición y falló (401/403/404/red). Solo existe si hubo petición. */
  requestFailed: 'PPT graded: EL REQUEST FALLÓ',
  /** Provider: 429 `daily`. Es su PROPIA línea — no cae en `requestFailed` (que es el `else`). */
  dailyStop: `PPT graded: 429 DAILY en el set ${HUECO} → PARADA.`,
  /** Mapper: el catálogo remoto SÍ se consultó y estos sets no empataron ⇒ hay que mapearlos. */
  mapperUnmatched: `PptSetMapper: ${HUECO} sets SIN mapeo a PokemonPriceTracker`,
  /**
   * Mapper: el catálogo remoto **no se pudo consultar** (cuota diaria o fallo de red) ⇒ el mapeo ni se
   * intentó. NO es lo mismo que «sin mapeo», y confundirlos es R1-quater.
   */
  mapperUnavailable: 'PptSetMapper: NO SE PUDO CONSULTAR /api/v2/sets',
  /** Orquestador: el prefijo de TODAS sus líneas (incluido el resumen final de la corrida). */
  ingest: 'graded-estimate-ingest',
} as const;

/** Una marca de log del camino graded. Solo estas se pueden citar. */
export type GradedLogLine = (typeof GRADED_LOG_LINES)[keyof typeof GRADED_LOG_LINES];

/**
 * Rellena los `…` de una marca con los valores reales, **en orden**, y devuelve el prefijo listo para
 * `logger`. La cola variable (detalle, pista, muestra) la concatena el emisor: no es parte de la cita.
 *
 * Exige exactamente tantos valores como huecos: un desajuste es un error de programación que se ve
 * aquí y no en el log de producción.
 */
export function emitirLineaGraded(marca: GradedLogLine, ...valores: string[]): string {
  const trozos = marca.split(HUECO);
  const huecos = trozos.length - 1;
  if (huecos !== valores.length) {
    throw new Error(
      `emitirLineaGraded: la marca "${marca}" tiene ${huecos} hueco(s) y se pasaron ${valores.length} valor(es).`,
    );
  }
  return trozos.reduce((acc, trozo, i) => (i === 0 ? trozo : `${acc}${valores[i - 1]}${trozo}`), '');
}

/**
 * **CITA VIVA** — afirma que esta línea EXISTE en el log de esta corrida. El guardián lo verifica.
 * Las comillas angulares son la marca de la afirmación: si aparece `«…»` en un bloque `VEREDICTO-PSA`,
 * el operador tiene derecho a encontrar esa línea con un `grep`.
 */
export function citarLineaViva(marca: GradedLogLine): string {
  return `«${marca}»`;
}

/** El sufijo fijo de una cita AUSENTE. Literal compartido: el guardián lo usa para reconocerlas. */
export const SUFIJO_CITA_AUSENTE = ' (NO existe en esta corrida)';

/**
 * **CITA AUSENTE** — afirma que esta línea NO existe, para que nadie la busque. Va con comillas
 * rectas y sufijo fijo (no angulares) porque es la afirmación CONTRARIA, y el guardián también la
 * verifica: si la línea sí estaba, la cita miente igual de caro.
 */
export function citarLineaAusente(marca: GradedLogLine): string {
  return `"${marca}"${SUFIJO_CITA_AUSENTE}`;
}

/**
 * ¿La cita (con `…` como comodín) aparece en esta línea de log? Los trozos deben aparecer TODOS y
 * EN ORDEN dentro de la misma línea.
 */
export function citaCoincideConLinea(cita: string, linea: string): boolean {
  let desde = 0;
  for (const trozo of cita.split(HUECO)) {
    if (trozo === '') continue;
    const i = linea.indexOf(trozo, desde);
    if (i < 0) return false;
    desde = i + trozo.length;
  }
  return true;
}

/** Extrae las CITAS VIVAS (`«…»`) de un texto. */
export function extraerCitasVivas(texto: string): string[] {
  return [...texto.matchAll(/«([^»]+)»/g)].map((m) => m[1]);
}

/** Extrae las CITAS AUSENTES (`"…" (NO existe en esta corrida)`) de un texto. */
export function extraerCitasAusentes(texto: string): string[] {
  const escapado = SUFIJO_CITA_AUSENTE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...texto.matchAll(new RegExp(`"([^"]+)"${escapado}`, 'g'))].map((m) => m[1]);
}

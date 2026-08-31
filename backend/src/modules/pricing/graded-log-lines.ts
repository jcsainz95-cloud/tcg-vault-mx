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
 *     `PptSetMapper`) y el que la CITA (`gradedPhase2Verdict`) leen la MISMA constante. Nunca dos
 *     literales que «se parecen»: si la línea cambia de texto, cambia en los dos lados a la vez o no
 *     cambia en ninguno.
 *
 *     ⚠️ **Alcance exacto de esa promesa (R-3 del cuarto pase, precisión).** Vale para las marcas del
 *     PROVIDER y del MAPPER, que son las que el veredicto cita. **NO** vale para `ingest`: ese prefijo
 *     lo escribe `PriceIngestService` como literal crudo en ~20 sitios y solo la CITA pasa por la
 *     constante. No es un defecto —el guardián verifica las citas contra los logs REALES de la
 *     corrida, así que una divergencia se vería en rojo igual—, pero decir «incluido
 *     `PriceIngestService`» era falso y aquí no se afirma lo que no se cumple.
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

/** Escapa un literal para meterlo en un `RegExp` sin que sus metacaracteres actúen. */
function escaparRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Los PREFIJOS invariables del camino graded. Toda marca del provider empieza por el primero y toda
 * marca del mapper por el segundo, así que vigilar los dos prefijos vigila también cualquier redacción
 * PARCIAL de una línea («PPT graded: el request falló», «PptSetMapper: no se pudo…»).
 */
export const PREFIJOS_DE_LINEA_GRADED = ['PPT graded:', 'PptSetMapper:'] as const;

/**
 * Las AGUJAS del complemento del invariante: los prefijos, más el trozo fijo inicial de toda marca que
 * no cuelgue de ninguno de ellos (hoy solo `graded-estimate-ingest`). Se filtran las que ya quedan
 * cubiertas por un prefijo para que el informe nombre una sola cosa por mención.
 */
export const AGUJAS_DE_MENCION = [
  ...new Set<string>([
    ...PREFIJOS_DE_LINEA_GRADED,
    ...Object.values(GRADED_LOG_LINES)
      .map((m) => m.split(HUECO)[0])
      .filter((t) => !PREFIJOS_DE_LINEA_GRADED.some((p) => t.startsWith(p))),
  ]),
];

/** Borra del texto todo lo que YA es una cita MARCADA (viva `«…»` o ausente `"…" (NO existe…)`). */
function quitarCitasMarcadas(texto: string): string {
  return texto
    .replace(new RegExp(`"[^"]*"${escaparRegExp(SUFIJO_CITA_AUSENTE)}`, 'g'), ' ')
    .replace(/«[^»]*»/g, ' ');
}

/**
 * ⛑️ **R-2 — EL COMPLEMENTO DEL INVARIANTE: mencionar una línea OBLIGA a citarla.**
 *
 * ### El agujero que cierra
 * El invariante directo (`verificarCitasDelVeredicto`) solo ve lo que lleva marcador: `«…»` o
 * `"…" (NO existe en esta corrida)`. Nada impedía escribir en un `headline`/`nextStep`
 * `Revisa las líneas "PPT graded: EL REQUEST FALLÓ" del log` con comillas cualesquiera y **sin
 * marcador** — y el guardián sería CIEGO a eso. No es hipotético: ésa es literalmente la redacción del
 * defecto R1 original, la que ha vuelto cuatro veces. La red se rodeaba escribiendo el bug con las
 * mismas palabras que tuvo la primera vez.
 *
 * ### La regla
 * En el texto del bloque `VEREDICTO-PSA`, **ninguna** ocurrencia de una marca de `GRADED_LOG_LINES`
 * (ni de sus prefijos `PPT graded:` / `PptSetMapper:`) puede quedar FUERA de un marcador de cita. O se
 * pasa por `citarLineaViva`/`citarLineaAusente` —y entonces el invariante directo la verifica contra
 * los logs reales— o no se nombra la línea. No hay tercera opción.
 *
 * Devuelve las agujas encontradas sin marcar. **Vacío = correcto.**
 */
export function mencionesSinMarcar(texto: string): string[] {
  const resto = quitarCitasMarcadas(texto);
  return AGUJAS_DE_MENCION.filter((aguja) => resto.includes(aguja));
}

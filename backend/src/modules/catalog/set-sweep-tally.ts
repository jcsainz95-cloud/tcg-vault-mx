import { BusinessException } from '../../common/business.exception';

/**
 * <!-- CANON-IMPL: reparto-del-barrido · única fuente EN CÓDIGO · API_CONTRACT §M2-CS.0 -->
 *
 * ⭐ EL REPARTO DE UN BARRIDO DE SETS, en UN solo sitio para los DOS barridos
 * (`sync-all` y `refresh-variants-all`).
 *
 * Por qué existe este archivo (y por qué no se copia su lógica en ningún otro):
 * `API_CONTRACT §M2-CS.0` declara que los dos barridos reportan **el mismo tipo de hecho** —qué le
 * pasó a cada set del universo encolado— y por tanto **reportan con la misma forma**. Lo que
 * legítimamente difiere es *qué escribe cada uno* (cartas vs. variantes/precios), y eso vive en
 * cada barrido con su propio nombre. El reparto **no difiere y no puede diferir**, así que sale de
 * aquí. `ARCHITECTURE §0-B.3 regla 8`: dos implementaciones del mismo reparto son dos verdades que
 * se desincronizan en silencio — que es exactamente cómo `setsOk` acabó mintiendo en un barrido
 * mientras el otro ya contaba bien sus `noop`.
 *
 * ## El defecto que este módulo cierra (D2 a escala de lote)
 *
 * `refresh-variants-all` contaba `setsOk += 1` para **todo set que no lanzara excepción**. Un set
 * cuyo nombre no empareja con TCGCSV corre limpio, escribe **cero** variantes y **cero** precios, y
 * sumaba a `setsOk`. En un lote de cien sets el dueño leía «todo bien» y había sets sin tocar.
 * «No reventó» **no es** «salió bien»: esa igualdad es el defecto, no un atajo.
 *
 * ## Vocabulario (§M2-CS.0, tabla normativa)
 *
 *  - `setsTotal`   — sets ENCOLADOS. Contexto; nunca la primera cifra de un aviso.
 *  - `setsWritten` — ⭐ sets con **≥1 escritura real**. **Éste es el ÚNICO nombre de «cuántos toqué».**
 *  - `setsNoop`    — sets intentados, **sin error y sin escribir nada** (cero MEDIDO, no cero de relleno).
 *  - `setsFailed`  — sets cuyo intento **lanzó**.
 *  - `failures[]`  — `{ setId, code, message }` por set fallido.
 *
 * ⛔ **Prohibido un segundo vocabulario para «cuántos toqué»**: no nace `setsProcessed`,
 * `setsHandled` ni `setsDone`. Más granularidad se añade como **desglose de `setsWritten`** (con su
 * invariante de suma escrita), **nunca** como un total paralelo.
 */

/**
 * Fallo de un set dentro de un barrido.
 *
 * `code` es **`string | null`** a propósito (§M2-CS.0): es el `code` de la `BusinessException` que
 * lanzó, y **`null`** cuando el fallo no traía ninguno. ⛔ No se inventa un `"UNKNOWN"` ni se
 * sustituye por un `UPSTREAM_ERROR` de relleno — atribuirle al fallo un código que nadie emitió es
 * la misma familia de mentira que contar un `noop` como bueno: convierte un «no lo sé» en un dato.
 *
 * Ojo: esto NO choca con `I-CS3` («ninguna cifra del summary es null»). `code` no es una cifra;
 * es un identificador que el contrato declara nullable de forma explícita.
 */
export type SweepFailure = {
  setId: string;
  code: string | null;
  message: string;
};

/** El reparto de un barrido (§M2-CS.0). Lo comparten los DOS barridos, tal cual. */
export type SetSweepTally = {
  /** sets encolados en el barrido. */
  setsTotal: number;
  /** ⭐ sets en los que esta corrida escribió algo (≥1 escritura real). «Cuántos toqué». */
  setsWritten: number;
  /** sets intentados, sin error y sin escribir nada. */
  setsNoop: number;
  /** sets cuyo intento lanzó. */
  setsFailed: number;
  /** detalle por set fallido. */
  failures: SweepFailure[];
};

/**
 * Reparto en ceros para arrancar un barrido.
 *
 * Los ceros de aquí son legítimos **porque el barrido va a contar**: el «no lo medí» del contrato
 * no se expresa con un objeto en ceros sino con `summary: null`, y esa decisión la toma el llamador
 * (no este módulo). Ver §M2-CS.1: «⛔ Nunca un `summary` en ceros para rellenar».
 */
export function emptySetSweepTally(setsTotal = 0): SetSweepTally {
  return {
    setsTotal,
    setsWritten: 0,
    setsNoop: 0,
    setsFailed: 0,
    failures: [],
  };
}

/**
 * Registra un intento que **NO lanzó**, repartiéndolo según si escribió o no.
 *
 * `wrote` es la ÚNICA pregunta que decide entre `setsWritten` y `setsNoop`, y cada barrido la
 * contesta con sus propias cifras de escritura (cartas para `sync-all`; variantes o precios para
 * `refresh-variants-all`). Lo que este módulo garantiza es que la pregunta se hace **siempre**:
 * antes, el camino de éxito no la hacía nunca y todo intento limpio contaba como bueno.
 */
export function recordSweepAttempt(tally: SetSweepTally, wrote: boolean): void {
  if (wrote) tally.setsWritten += 1;
  else tally.setsNoop += 1;
}

/**
 * `code` del fallo para `failures[]`: el de la `BusinessException`, o **`null`** si no traía uno.
 * ⛔ No se inventa un código (§M2-CS.0).
 */
export function sweepFailureCode(error: unknown): string | null {
  return error instanceof BusinessException ? String(error.code) : null;
}

/** Registra un intento que **lanzó**: suma a `setsFailed` y deja su renglón en `failures[]`. */
export function recordSweepFailure(tally: SetSweepTally, setId: string, error: unknown): void {
  tally.setsFailed += 1;
  tally.failures.push({
    setId,
    code: sweepFailureCode(error),
    message: error instanceof Error ? error.message : String(error),
  });
}

/**
 * Sets **intentados** = `setsWritten + setsNoop + setsFailed`.
 *
 * `I-CS1` dice que esto es exactamente `done`. La diferencia contra `setsTotal` son sets **no
 * intentados** (barrido cortado a media) y se DERIVA de `total - done` (`I-CS2`): ⛔ no se emite
 * como campo, la cuenta ya vive en `total`/`done`.
 */
export function sweepAttempted(tally: SetSweepTally): number {
  return tally.setsWritten + tally.setsNoop + tally.setsFailed;
}

/**
 * ⛔ **`setsOk` — DEPRECADO, con su significado CONGELADO** (§M2-CS.2).
 *
 * `setsOk === setsWritten + setsNoop`. Se emite **derivado** —no como contador propio— y ésa es la
 * clave: un campo congelado que se calcula no puede desviarse de su definición por mucho que el
 * barrido cambie. Congelarlo **no es arreglarlo**: sigue sumando los `noop` a los buenos, sigue
 * siendo la cifra que mentía, y por eso:
 *
 *  - ⛔ **ningún consumidor puede usarlo para un veredicto** — el veredicto se calcula con
 *    `setsWritten` / `setsNoop` / `setsFailed`;
 *  - ⛔ **no se redefine** (redefinir un campo vivo es peor que retirarlo: los consumidores no se
 *    enteran del cambio de significado);
 *  - se **retira del shape en la rev siguiente**, cuando frontend confirme cero consumidores.
 */
export function deprecatedSetsOk(tally: SetSweepTally): number {
  return tally.setsWritten + tally.setsNoop;
}

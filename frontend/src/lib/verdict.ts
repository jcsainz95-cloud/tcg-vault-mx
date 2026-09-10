/**
 * ⭐⭐ NORMA DE HONESTIDAD DEL AVISO DE RESULTADO — `DESIGN_SYSTEM §32.4`.
 *
 * **Transversal, no de M2**: extiende §8.1/§8.3 y vale para el aviso de resultado de CUALQUIER
 * acción de cualquier panel. M2 es donde se descubrió, no donde acaba.
 *
 * La norma en una frase: **un aviso de resultado puede afirmar exactamente lo que la corrida
 * midió, y ni una palabra más.** Ni el código HTTP, ni la ausencia de excepción, ni el hecho de
 * que «terminó» son trabajo realizado.
 *
 * Por qué este módulo existe y no es un `? :` en la vista: el defecto que lo origina —el dueño
 * apretó un botón, la pantalla dijo «191 cartas procesadas · 0 precios» **en verde** y no se
 * había escrito nada— nació de derivar el tono de `mutation.isSuccess`. Con el cálculo aquí, en
 * una función pura y sin acceso al estado de la mutación, **la vista no tiene de dónde sacar un
 * verde que no venga de una cifra** (H10, y §32.12 punto 4).
 */

/** El vocabulario de veredictos es CERRADO. Son seis, y **solo uno es verde** (§32.4a). */
export type Verdict =
  /** Corrieron todas las fases, ≥1 cifra de escritura > 0 y ninguna desconocida. */
  | 'done'
  /** Corrió bien y no había nada que hacer — y se puede DEMOSTRAR. ⛔ No es verde. */
  | 'noChanges'
  /** Algo se escribió y algo quedó sin hacer, falló, quedó pendiente o no se pudo medir. */
  | 'partial'
  /** Corrió sin error y no escribió nada, HABIENDO trabajo que hacer. ⭐ El caso de D2. */
  | 'notDone'
  /** La llamada falló, o ninguna fase llegó a correr. */
  | 'failed'
  /** Terminó pero el sistema no puede reportar qué escribió. Va SIEMPRE con «—». */
  | 'unknown';

export type VerdictTone = 'success' | 'info' | 'warning' | 'danger';

/**
 * Una cifra de ESCRITURA: la cuenta que ESTA corrida hizo, o `null` = **no se midió** (H4).
 *
 * ⛔ `0` y `null` no son intercambiables y ésa es toda la sección: *un cero que en realidad es un
 * «no lo sé» es la misma mentira con mejor presentación*.
 */
export type WriteFigure = number | null;

/**
 * Los HECHOS con los que se calcula un veredicto. Nótese lo que **no** hay aquí: ni `isSuccess`,
 * ni `status`, ni `ok`. Si un dato no puede expresarse como una de estas cuatro cosas, no puede
 * decidir el tono de un aviso (H10).
 */
export interface VerdictFacts {
  /**
   * Paso 1 — **ninguna fase corrió**, o la única fase que había falló. ⛔ No es «alguna fase
   * falló»: una fase caída junto a otra que sí corrió es `PARCIAL` (regla dura 4 + H7).
   */
  nothingRan: boolean;
  /**
   * Las cifras de ESCRITURA de la corrida (H1/H2). Una cifra de LECTURA o de contexto
   * —«cartas del set», «sets encolados», `setsTotal`— **no entra aquí**: no es trabajo.
   * ⛔ Tampoco entra `setsOk` (§M2-CS.2): suma los `noop` a los buenos.
   */
  writes: WriteFigure[];
  /** Paso 3 — alguna fase falló, quedó trabajo pendiente, o el barrido no terminó lo encolado. */
  failedOrPending: boolean;
  /**
   * Paso 4 — ¿**había** trabajo que hacer? `false` **solo** si se puede demostrar que no (p. ej.
   * cero sets nuevos desde el corte). En la duda, `true`: «no había nada» es una afirmación, y
   * afirmarla sin poder probarla es exactamente lo que esta sección prohíbe.
   */
  hadWork: boolean;
}

/** `true` si la cifra es un «no lo sé» (H4). */
export function isUnknownFigure(f: WriteFigure): boolean {
  return f == null;
}

/**
 * EL ALGORITMO, en el orden exacto de §32.4a. **Si dos condiciones casan, manda la de arriba.**
 *
 * ```
 * 1. ninguna fase corrió, o la única fase falló         → FALLÓ
 * 2. alguna cifra de escritura es DESCONOCIDA           → PARCIAL   (si algo sí se midió y es >0)
 *                                                       → NO SE SABE (si no se midió nada)
 * 3. alguna fase falló, o quedó trabajo pendiente       → PARCIAL
 * 4. todas las cifras de escritura son 0
 *      4a. y HABÍA trabajo que hacer                    → NO SE HIZO
 *      4b. y NO había nada que hacer (demostrable)      → SIN CAMBIOS
 * 5. resto                                              → HECHO
 * ```
 *
 * ⚠ **El paso 2 va ANTES del 4 a propósito.** Sin ese orden, «no lo medí» se colapsa con «fue
 * cero», que es exactamente D2. *Un cero que no se midió no es un cero.*
 *
 * Y el paso 5 no es un `else` ciego: `HECHO` **exige** al menos una cifra de escritura > 0 (H1).
 * Una corrida que llega hasta aquí sin haber medido ni una cifra terminó sin excepción y sin
 * recibo ⇒ `NO SE SABE`, nunca verde.
 */
export function computeVerdict(facts: VerdictFacts): Verdict {
  const { nothingRan, writes, failedOrPending, hadWork } = facts;

  // 1 — nada corrió.
  if (nothingRan) return 'failed';

  // 2 — hay un «no lo sé» entre las cifras. ANTES que el 4: no se colapsa con un cero.
  const wroteSomething = writes.some((w) => typeof w === 'number' && w > 0);
  if (writes.some(isUnknownFigure)) return wroteSomething ? 'partial' : 'unknown';

  // 3 — algo falló o quedó a medias.
  if (failedOrPending) return 'partial';

  // 4 — todo lo que se midió es cero. Sólo aplica si de verdad se midió algo.
  const measured = writes.filter((w): w is number => typeof w === 'number');
  if (measured.length > 0 && measured.every((w) => w === 0)) {
    return hadWork ? 'notDone' : 'noChanges';
  }

  // 5 — resto. H1: sin una cifra de escritura > 0 NO hay verde.
  return wroteSomething ? 'done' : 'unknown';
}

/**
 * El tono del `Banner`. **El color es el segundo canal, jamás el primero** (§32.4a): el portador
 * del veredicto es la VERSALITA. `warning` y `danger` comparten bermellón en este sistema y se
 * distinguen por la palabra, que es justo por lo que el veredicto es texto y no un punto de color.
 *
 * ⭐ `notDone` y `noChanges` **nunca** usan el token de éxito (H2).
 */
export function verdictTone(verdict: Verdict): VerdictTone {
  switch (verdict) {
    case 'done':
      return 'success';
    case 'noChanges':
    case 'unknown':
      return 'info';
    case 'partial':
    case 'notDone':
      return 'warning';
    case 'failed':
      return 'danger';
  }
}

/** §32.10: el aviso es `role="status"` (aria-live polite) salvo `FALLÓ`, que es `role="alert"`. */
export function verdictRole(verdict: Verdict): 'status' | 'alert' {
  return verdict === 'failed' ? 'alert' : 'status';
}

/**
 * H4 — **lo desconocido se pinta «—»**, en `tabular`, nunca `0` y nunca omitido en silencio
 * (omitir también miente: el lector asume que no aplicaba).
 */
export const UNKNOWN_FIGURE = '—';

export function formatFigure(value: WriteFigure | undefined): string {
  return value == null ? UNKNOWN_FIGURE : String(value);
}

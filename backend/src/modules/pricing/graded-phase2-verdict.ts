/**
 * v1.50.3-g (§4.38h.1-quater) — **EL VEREDICTO DE LA FASE 2, en un bloque que se lee sin bucear.**
 *
 * ### El problema que resuelve
 * La corrida del ingest de estimados PSA deja ~2 000 líneas de log (el barrido de precios raw es el
 * grueso). La única frase que de verdad importa —*«¿qué formato entregó PokemonPriceTracker y eso hace
 * viable la fase 2 o no?»*— existía, pero repartida entre un contador al final (`shapes vistos:`) y un
 * `warn` por carta, ahogados en el ruido. Un dato que hay que **reconstruir** leyendo el log no es un
 * veredicto: es materia prima. Y el dueño paga créditos por cada corrida, así que la respuesta tiene
 * que salir entera de la PRIMERA.
 *
 * Aquí se calcula ese veredicto como **función pura** —misma entrada, misma conclusión, testeable sin
 * red ni BD— y se imprime como un bloque con marca fija (`grep VEREDICTO-PSA`) que dice, en este orden:
 * qué formato llegó, cuántas cartas de cada uno, **qué significa en una frase**, y qué hacer ahora.
 *
 * ### Por qué es un LOG y no una superficie de admin
 * Exponerlo por `GET /admin/...` sería **cambio de contrato** ⇒ regla 9, decisión del ARQUITECTO. Se
 * deja escalado, no improvisado. El log cubre la necesidad del dueño hoy (una corrida manual, mirada
 * por una persona con acceso a los logs) sin tocar `docs/API_CONTRACT.md`.
 *
 * ### Lo que este módulo NO hace
 * No escribe, no decide, no toca dinero. **S2 sigue NO PERSISTIBLE** (§4.38h.1-bis): el veredicto lo
 * REPORTA; jamás lo relaja.
 *
 * ### v1.51-b — tres correcciones al propio diagnóstico (R1, TL-GE1, TL-GE2/R2)
 * El veredicto existe para que nadie tenga que deducir por qué el ingest no trajo nada. Un veredicto
 * que se equivoca de causa es peor que no tenerlo, así que:
 *  · **R1** — `enabled` desaparece como entrada y lo sustituye la PARADA (`dial_off` /
 *    `ingest_config_invalid` / `no_scope`), cada una con SU titular y SU acción. Antes las tres
 *    compartían el titular del dial apagado: con la config corrupta y el dial ENCENDIDO, el bloque
 *    decía «enciende el dial» y mandaba al operador a la reparación equivocada.
 *  · **TL-GE1** — el coste se calcula sobre `metadata.apiCallsConsumed` de las llamadas graded, no
 *    sobre el contador diario del singleton (que el barrido RAW pisa). Sin atribución ⇒ **sin número**.
 *  · **TL-GE2/R2** — «conteo inducido» se define UNA vez (`shapeCountIsInduced`) y la consume también
 *    el ingest, que tenía su propia definición divergente.
 *
 * ### v1.51-c — el mismo defecto de R1, en sus dos últimas madrigueras (R1-ter, TL-GE6)
 *  · **R1-ter** — la rama «ninguna petición respondió OK» seguía mandando a leer *«las líneas “PPT
 *    graded: EL REQUEST FALLÓ”»* **también cuando NO HUBO NINGUNA PETICIÓN** (sin API key, o set sin
 *    `pptSetId`): esas líneas no existen en esos dos casos, que son justo las causas #4 y #5 del mapa
 *    y la hipótesis principal de las cartas sin dato en producción. Hoy el provider distingue «no se
 *    pidió» de «se pidió y falló» (`noRequestReason`), el veredicto tiene una rama por causa y —cuando
 *    la causa es `pptSetId`— **nombra los sets afectados**.
 *  · **TL-GE6** — la entrada era plana (`stopReason` + `shapeCounts` + `forcedFormat` como hermanos),
 *    o sea que el compilador solo exigía **aridad**, no corrección: un `stopReason: null` en una salida
 *    temprana futura compilaba y reproducía R1 palabra por palabra, y `invalidConfigKeys` tenía default
 *    `[]` (degradaba en silencio a «no identificada(s)»). Hoy la entrada es una **unión discriminada**
 *    (`GradedRunOutcome`): una corrida o **PARÓ** —y entonces trae su motivo, y si es config inválida
 *    trae al menos UNA clave por tipo— o **OBSERVÓ** —y entonces trae conteos y formato—. Los estados
 *    mixtos ya no son expresables.
 *
 * ### v1.51-d — se cierra la CLASE, no la instancia (TL-GE7, R1-quater, QA)
 * Tres pases cerraron instancias de R1 y cada uno dejó una viva. El invariante que se rompe **no** es
 * «el tipo permite un estado imposible» (eso ya está cerrado) sino **«el mensaje cita una evidencia
 * que en ese estado no existe»**, y mientras esa cita fuera prosa libre volvía a aparecer. Por eso
 * este pase empieza por el GUARDIÁN y solo después toca las instancias:
 *  · **TL-GE7 (el guardián)** — las líneas del camino graded viven en `graded-log-lines.ts`; el que
 *    las EMITE y el que las CITA leen la misma constante, y `citarLineaViva()`/`citarLineaAusente()`
 *    convierten la cita en una **afirmación verificable**. El guardián
 *    (`test/graded-run.harness.ts`) comprueba, en cada corrida REAL de la suite, que toda línea
 *    citada entre `«…»` aparece en los logs de ESA corrida (y que las citadas como ausentes no).
 *  · **QA (429 daily)** — la rama «se pidió y falló» mandaba SIEMPRE a «EL REQUEST FALLÓ», pero con
 *    cuota diaria agotada el provider emite `429 DAILY … → PARADA` (otra rama, otro literal). Cada
 *    titular tiene ahora su cita.
 *  · **R1-quater** — `set_without_ppt_set_id` eran DOS causas fundidas: «se comprobó y no empata» y
 *    «no se pudo comprobar» (cuota/red al pedir `/api/v2/sets`). La segunda se publicaba como la
 *    primera ⇒ causa falsa, acción equivocada y cita a una línea inexistente. `GradedRequestTally`
 *    las separa (`setsUnmatched` vs `mapper.available:false`) y el tipo exige causa + sets.
 *  · **QA (cota inferior)** — «SETS NO PEDIDOS: N del alcance» se leía como total y era un mínimo (el
 *    recorrido se corta por tope de sonda, cuota o escalada). `sweepComplete` marca la parcialidad.
 *  · **techlead §2** — la parada `no_scope` se atrapaba POR DESCARTE. Ahora se discrimina por
 *    `reason` y el `else` es un `never`: un motivo nuevo deja de compilar en vez de heredar en
 *    silencio el titular del inventario vacío.
 */

import { GRADED_LOG_LINES, citarLineaAusente, citarLineaViva } from './graded-log-lines';

/** Marca fija del bloque. Va en TODAS sus líneas para que un `grep` devuelva el bloque entero. */
export const GRADED_VERDICT_TAG = 'VEREDICTO-PSA';

export type GradedPhase2Verdict =
  /** El proveedor sirve S1 (`ebay.salesByGrade`): la fase 2 **funciona** con este plan. */
  | 'VIABLE'
  /** El proveedor NO puede sostener la fase 2 con este plan. Decisión de producto/costo (regla 9). */
  | 'NO_VIABLE'
  /** No hay observación suficiente para afirmar ninguna de las dos. **Nunca se rellena adivinando.** */
  | 'INDETERMINADO';

/**
 * v1.51-b (R1) — **POR QUÉ la corrida paró ANTES de preguntarle nada al proveedor.**
 *
 * ### El defecto que este tipo cierra
 * Antes había UN solo booleano (`enabled`) haciendo de «¿por qué no pasó nada?», y `result.enabled` se
 * ponía a `true` **después** de dos salidas tempranas. Consecuencia medida en producción: con el dial
 * en `on` pero la config del ingest corrupta, el veredicto recibía `enabled: false` y publicaba *«el
 * dial está en off — enciéndelo»*. El operador miraba el dial, lo veía encendido, y el único artefacto
 * que existe para decirle por qué el ingest escribe cero filas le mentía sobre la causa. La segunda
 * salida (sin inventario en alcance) salía con `enabled: true, requestOk: false` y mandaba *«revisa las
 * líneas “PPT graded: EL REQUEST FALLÓ” del log»* — líneas que no existen, porque no hubo petición.
 *
 * ### La regla
 * Un diagnóstico que nombra una causa falsa es PEOR que no tener diagnóstico: manda al operador a
 * corregir algo que ya está bien y deja la causa real intacta. Por eso cada parada tiene su propio
 * motivo, su propio titular y su propio `nextStep`, y `enabled` deja de existir como entrada: el dial
 * apagado es UNA de estas paradas, no la explicación por defecto de todas.
 */
export type GradedStopReason =
  /** Dial `grading_hook_enabled` = `off`: ni una petición, ni una fila. Es una DECISIÓN, no un fallo. */
  | 'dial_off'
  /** Dial `on` pero clave(s) del ingest PRESENTE(S)-e-INVÁLIDA(S) ⇒ fail-closed antes de pedir nada. */
  | 'ingest_config_invalid'
  /** Dial `on`, config válida, pero CERO cartas con inventario RAW publicado: no hay qué preguntar. */
  | 'no_scope';

/**
 * v1.51-c (R1-ter) — **cuántas peticiones se EMITIERON de verdad, y por qué las demás no.**
 *
 * Es lo que separa *«el proveedor falló»* de *«no se le preguntó»*. `requestOk: false` no distinguía
 * las dos cosas, así que el veredicto mandaba a leer una línea de log (`EL REQUEST FALLÓ`) que en los
 * casos «sin llave» y «set sin `pptSetId`» **no existe** — el mismo defecto de R1, en las dos causas
 * más probables del cero de producción.
 */
/**
 * v1.51-d (R1-quater) — **¿se pudo consultar el catálogo de sets del proveedor en esta corrida?**
 *
 * Es la pieza que separa las dos causas que `pptSetId == null` fundía en una. Va como unión
 * discriminada por la misma razón que `GradedRunOutcome`: «no estuvo disponible» **sin** decir por qué
 * ni para qué sets es una cadena no accionable, y un default vacío la dejaría degradar en silencio.
 */
export type GradedMapperOutcome =
  /** `GET /api/v2/sets` respondió: lo que no empató, no empató de verdad. */
  | { available: true }
  /**
   * `GET /api/v2/sets` **no** respondió ⇒ de estos sets no sabemos si tienen mapeo o no. Exige la
   * causa y **al menos un set nombrado**: sin eso el operador no puede hacer nada con el dato.
   */
  | {
      available: false;
      cause: 'daily_limit' | 'request_failed';
      sets: readonly [string, ...string[]];
    };

export interface GradedRequestTally {
  /** Sets en los que se EMITIÓ al menos una petición HTTP (haya respondido OK o no). */
  attempted: number;
  /** `POKEMONPRICETRACKER_API_KEY` ausente ⇒ ningún set llegó a pedirse. */
  missingApiKey: boolean;
  /**
   * `externalId` de los sets que **ni se pidieron** porque el catálogo de PPT SÍ se consultó y NO
   * empataron. Se NOMBRAN porque es la única forma de que la acción sea directa: «algún set no está
   * mapeado» no se puede arreglar; «`sv8` no está mapeado» sí.
   *
   * v1.51-d (R1-quater): esta lista ya NO incluye los sets cuyo mapeo **ni se intentó** (ver `mapper`).
   * Mezclarlos publicaba la causa #8 (cuota) disfrazada de la #5 (sin mapeo) y mandaba al operador a
   * mapear a mano sets que probablemente ya empatan.
   */
  setsUnmatched: readonly string[];
  /** R1-quater: ¿el catálogo remoto estuvo disponible? Si no, sus sets están SIN COMPROBAR. */
  mapper: GradedMapperOutcome;
  /**
   * QA (v1.51-d) — **¿el recorrido cubrió todo el alcance?** El bucle del ingest se corta por tope de
   * sonda, por cuota diaria o por escalada, y el alcance mismo puede venir recortado por
   * `ingestMaxCardsPerRun`. Cuando esto es `false`, `setsUnmatched` y `mapper.sets` son **cotas
   * inferiores**, y el bloque tiene que decirlo: «1 set(s) del alcance» leído como total, habiendo 20
   * sin mapear, contesta al revés la única pregunta que el dueño quiere contestar.
   */
  sweepComplete: boolean;
}

/**
 * v1.51-c (TL-GE6) — **cómo terminó la corrida: PARÓ u OBSERVÓ. No hay tercera, ni mezcla.**
 *
 * ### Qué defecto cierra este tipo (y por qué la firma anterior NO lo cerraba)
 * R1 puso `stopReason: GradedStopReason | null` como parámetro obligatorio y lo declaró «el candado
 * que impide la reincidencia». El techlead verificó que ese candado es de **ARIDAD**: obliga a *pasar
 * un argumento*, no a pasar **el correcto**. Una salida temprana futura con `…, null)` compila
 * perfectamente y reproduce R1 palabra por palabra. Y `invalidConfigKeys` tenía default `[]`, así que
 * una salida `ingest_config_invalid` que olvidara las claves degradaba en silencio a «no
 * identificada(s)» — exactamente la cadena no accionable que R1 vino a eliminar.
 *
 * Con la unión discriminada esos dos estados **no son expresables**:
 *  · una corrida que PARÓ no tiene `shapeCounts` ni `forcedFormat` que fingir (no se le habló al
 *    proveedor, así que no hay nada que contar ni ningún formato que haya actuado);
 *  · una corrida que OBSERVÓ no puede «olvidar» declarar por qué paró, porque no paró;
 *  · `ingest_config_invalid` exige una lista **NO VACÍA** por tipo (`[string, ...string[]]`): la clave
 *    se nombra o no compila.
 */
/**
 * v1.51-e (A7, sugerencia del techlead **verificada**) — las paradas SIN carga adicional, en UN miembro.
 *
 * Aquí vivía un mapped type distributivo que convertía cada motivo en su propio miembro de la unión.
 * La razón declarada era que «TypeScript filtra MIEMBROS de una unión, no reduce la unión de literales
 * dentro de un miembro», así que el `never` de cierre de `stoppedVerdict` no compilaría. **Eso era
 * cierto del objeto `o` y falso del discriminante `o.reason`**: TypeScript SÍ estrecha el acceso a
 * propiedad `o.reason` por flujo de control, así que descartando los tres motivos uno a uno se llega a
 * `never` sin necesidad de distribuir nada.
 *
 * Se comprobó compilando las dos cosas antes de cambiar nada: (a) la versión de abajo con el
 * `const sinRama: never = o.reason` compila; (b) añadir un motivo a `GradedStopReason` **rompe la
 * compilación** con `Type '"…"' is not assignable to type 'never'`. Garantía IDÉNTICA, cuatro líneas de
 * tipos crípticos menos.
 */
type GradedSimpleStop = {
  kind: 'stopped';
  reason: Exclude<GradedStopReason, 'ingest_config_invalid'>;
};

export type GradedRunOutcome =
  /**
   * Paradas SIN carga adicional: `dial_off` (cero peticiones, cero filas, cero créditos) y `no_scope`
   * (dial `on`, config válida, cero cartas con inventario RAW publicado).
   */
  | GradedSimpleStop
  /** Dial `on` + clave(s) del ingest PRESENTE(S)-e-INVÁLIDA(S). **Al menos una, nombrada.** */
  | { kind: 'stopped'; reason: 'ingest_config_invalid'; invalidConfigKeys: readonly [string, ...string[]] }
  /**
   * La corrida **NO paró antes de tiempo**: llegó al bucle de sets, así que hay algo que contar sobre
   * las peticiones (`requests`) aunque no haya nada que contar sobre el proveedor.
   *
   * ⚠️ v1.51-d (techlead §7) — el docstring anterior decía «se llegó a hablar (o al menos a intentar
   * hablar) con el proveedor», y eso NO es cierto en todos los `observed`: «todos los sets del alcance
   * sin `pptSetId`» llega aquí con `requests.attempted: 0`, o sea sin ni una petición emitida. La
   * conducta era correcta —esa rama es justo la que R1-ter abrió— y no se toca: lo que estaba mal era
   * la descripción. **No se monta una tercera variante** por un comentario impreciso; se arregla el
   * comentario. Quien quiera saber si de verdad se le habló al proveedor lo tiene en `requests`, que
   * es el dato explícito.
   */
  | {
      kind: 'observed';
      /** ¿Alguna respuesta llegó OK? Sin esto no hay observación, solo un fallo de plomería. */
      requestOk: boolean;
      /** R1-ter: cuántas peticiones se emitieron y por qué las demás no. */
      requests: GradedRequestTally;
      shapeCounts: { s1: number; s2: number };
      /** `POKEMONPRICETRACKER_GRADED_FORMAT` visto en la corrida. Distinto de `auto` ⇒ INDUCIDO. */
      forcedFormat: 'auto' | 'sales_by_grade' | 'graded_prices';
    };

export interface GradedPhase2VerdictInput {
  /** ¿La corrida fue SONDA (solo lectura) o INGEST (podía escribir)? Cambia qué significa «0 escritas». */
  probe: boolean;
  /**
   * v1.51-c (TL-GE6) — **PARÓ u OBSERVÓ**, con lo que cada caso necesita y sin lo que no puede tener.
   * Va PRIMERO en la cadena de precedencia: sin petición no hay observación posible, así que ninguna
   * conclusión sobre el proveedor puede sostenerse por encima de una parada.
   */
  outcome: GradedRunOutcome;
  sets: number;
  cardsInScope: number;
  /** Cartas DEVUELTAS por el proveedor en toda la corrida (`fetchedRaw`), el denominador del coste. */
  cardsReturned: number;
  written: number;
  dailyLimited: boolean;
  escalationReason: string | null;
  /**
   * v1.51-b (TL-GE1) — **créditos ATRIBUIBLES a las llamadas graded de ESTA corrida**, o `null` si no se
   * pudieron aislar.
   *
   * Antes esto se calculaba como `creditsBefore − creditsAfter` sobre `PptApiClient.lastDailyRemaining`,
   * que es **estado del singleton del proceso**: lo pisa CUALQUIER respuesta de PPT, incluido el barrido
   * de precios RAW que corre justo antes (y, con Redis, en workers del mismo proceso). O sea, la línea
   * de coste le cobraba a la sonda créditos ajenos — y con el umbral duro de `>= 0.5 crédito/carta`
   * podía disparar una escalada de PRESUPUESTO falsa. Como este número es precondición del primer
   * `off → on` (§4.38r.3.1.1), tiene que ser real o no estar.
   *
   * Ahora se suma `metadata.apiCallsConsumed` **de las respuestas graded y solo de ellas**. Si alguna
   * respuesta no lo trajo, el total no es atribuible ⇒ `null` ⇒ **no se reporta coste**. Una línea que
   * dice honestamente «no se pudo aislar» vale infinitamente más que un número contaminado que gobierna
   * una decisión de dinero.
   */
  creditsSpent: number | null;
}

/**
 * v1.51-b (TL-GE2/R2) — **la ÚNICA definición de «conteo inducido», exportada para que no haya dos.**
 *
 * Había dos: ésta (que exime a la sonda) y `shapeVerdictInduced` en `price-ingest.service.ts` (que no la
 * eximía). Con `probe=true` y `GRADED_FORMAT` fijado, la MISMA corrida emitía «no se escala» por una y
 * «NO_VIABLE, ESCALA AL ARQUITECTO» por la otra — dos veredictos contradictorios sobre la misma
 * evidencia, uno de ellos capaz de disparar una decisión de arquitectura y presupuesto.
 *
 * La regla, en una frase: un conteo es INDUCIDO cuando lo produjo nuestro propio override, no el
 * proveedor. La SONDA está EXENTA por construcción: clasifica con `detectGradedShape`, que ignora
 * `GRADED_FORMAT` a propósito, así que su conteo sí es evidencia sobre PPT.
 */
export function shapeCountIsInduced(i: {
  probe: boolean;
  forcedFormat: 'auto' | 'sales_by_grade' | 'graded_prices';
}): boolean {
  return !i.probe && i.forcedFormat !== 'auto';
}

export interface GradedPhase2VerdictReport {
  verdict: GradedPhase2Verdict;
  /** LA frase. Una sola, en español, que contesta «¿la fase 2 funciona o no?». */
  headline: string;
  /** Qué hacer ahora. Una sola acción, la siguiente. */
  nextStep: string;
  /** Bloque listo para `logger`, ya con la marca en cada línea. */
  lines: string[];
}

/** Lista de sets legible: nombra hasta 6 y dice cuántos faltan (un log de 200 ids no se lee). */
function nombrarSets(ids: readonly string[]): string {
  return ids.length <= 6 ? ids.join(', ') : `${ids.slice(0, 6).join(', ')}, … (+${ids.length - 6} más)`;
}

type Render = (verdict: GradedPhase2Verdict, headline: string, nextStep: string) => GradedPhase2VerdictReport;

/** Cómo se nombra la parcialidad del recorrido allí donde se dan cifras de sets. */
const COTA_INFERIOR =
  ' ⚠️ COTA INFERIOR: el recorrido NO cubrió todo el alcance de esta corrida (se cortó por el tope de ' +
  'sonda, por la cuota diaria, por una escalada, o el alcance ya venía recortado por ' +
  '`graded_estimate_ingest_max_cards_per_run`), así que puede haber MÁS sets en el mismo estado que ' +
  'este bloque no llegó a ver. El número es un mínimo, no un total.';

/** Frase estándar del catálogo caído, con su causa y su acción. Una sola definición para las dos ramas. */
function motivoCatalogoCaido(cause: 'daily_limit' | 'request_failed'): { qué: string; acción: string } {
  return cause === 'daily_limit'
    ? {
        qué: 'la CUOTA DIARIA del proveedor ya estaba agotada al pedir `GET /api/v2/sets` (el barrido de ' +
          'precios RAW corre en la MISMA corrida y consume del mismo contador)',
        acción:
          'Espera al reinicio de la cuota (00:00 UTC) y vuelve a correr — o corre el ingest de estimados ' +
          'ANTES del barrido RAW. NO vayas a mapear nada a mano todavía: no sabemos que falte mapeo.',
      }
    : {
        qué: 'la petición `GET /api/v2/sets` FALLÓ (red, credencial o plan)',
        acción:
          'Revisa la conectividad y `POKEMONPRICETRACKER_API_KEY` contra `GET /api/v2/sets` y vuelve a ' +
          'correr. NO vayas a mapear nada a mano todavía: el mapeo ni se llegó a comprobar.',
      };
}

/**
 * v1.51-c (R1-ter) / v1.51-d (R1-quater, QA) — **«no respondió OK» son CINCO cosas distintas, y solo
 * una manda al log del fallo.**
 *
 * Las tres primeras (`sin llave`, `catálogo caído`, `set sin pptSetId`) son causas del mapa
 * (`BACKEND_NOTES.md` §0.16.2) en las que la línea «PPT graded: EL REQUEST FALLÓ» **no existe**: el
 * provider devuelve `empty` *antes* de emitir nada. Mandar ahí al operador es el defecto (b) de R1
 * textualmente idéntico.
 *
 * Y de las dos en las que SÍ hubo petición, la del **429 diario** tampoco emite esa línea: el provider
 * la atrapa en su propia rama (`429 DAILY … → PARADA`) y `EL REQUEST FALLÓ` es el `else`. Cada titular
 * cita, por eso, la constante de SU línea — y el guardián lo verifica corrida a corrida.
 */
function noRequestOkVerdict(req: GradedRequestTally, dailyLimited: boolean, r: Render): GradedPhase2VerdictReport {
  const sinMapeo = req.setsUnmatched;
  const parcial = req.sweepComplete ? '' : COTA_INFERIOR;
  if (req.attempted === 0) {
    if (req.missingApiKey) {
      return r(
        'INDETERMINADO',
        'NO HUBO NI UNA PETICIÓN: falta `POKEMONPRICETRACKER_API_KEY`, así que ningún set del alcance ' +
          'llegó a pedirse. El proveedor no falló — no se le habló.',
        'Pon POKEMONPRICETRACKER_API_KEY en el entorno del backend (Railway ⇒ redeploy) y vuelve a ' +
          `correr. La línea que SÍ existe en este log es ${citarLineaViva(GRADED_LOG_LINES.missingApiKey)}; ` +
          `la de ${citarLineaAusente(GRADED_LOG_LINES.requestFailed)}: no hubo petición que pudiera fallar.`,
      );
    }
    // ⚠️ R1-quater — VA ANTES QUE `setsUnmatched` A PROPÓSITO. Si el catálogo no se pudo consultar, la
    // acción «ve a mapear estos sets» es la equivocada (puede que ya empaten) y la causa publicada
    // sería falsa. La disponibilidad del catálogo es precondición de poder afirmar «no está mapeado».
    if (!req.mapper.available) {
      const { qué, acción } = motivoCatalogoCaido(req.mapper.cause);
      const sets = req.mapper.sets;
      // ⛑️ QA (v1.51-e) — **LA INSTANCIA #6.** Esta rama afirmaba INCONDICIONALMENTE dos cosas que solo
      // son ciertas si NO hay además sets sin mapear: «NO es que falte mapeo», y que la línea
      // `PptSetMapper: … sets SIN mapeo` no existe en esta corrida. Los dos estados COEXISTEN sin
      // esfuerzo —`loadRemoteSets` cachea solo el ÉXITO, así que un fallo transitorio en el set A y un
      // éxito en el set B dan `mapper.available:false` **y** `setsUnmatched:[B]` a la vez—, y entonces
      // el bloque citaba la MISMA línea como viva (en `SETS NO PEDIDOS`) y como ausente (en el `AHORA`),
      // y le daba al operador la acción equivocada para el set que sí necesita mapeo. Las dos
      // afirmaciones se condicionan; cuando conviven, se publican las DOS causas con sus DOS acciones.
      if (sinMapeo.length > 0) {
        return r(
          'INDETERMINADO',
          `NO HUBO NI UNA PETICIÓN, y hay DOS causas a la vez: (1) ${qué}, así que de ${sets.length} ` +
            `set(s) (${nombrarSets(sets)}) NO SE PUDO COMPROBAR si tienen \`pptSetId\`; y (2) otros ` +
            `${sinMapeo.length} set(s) (${nombrarSets(sinMapeo)}) SÍ se comprobaron y NO tienen ` +
            '`pptSetId` mapeado. Son causas DISTINTAS y piden acciones DISTINTAS.' +
            parcial,
          `${acción} Para los que SÍ se comprobaron, mapea el \`pptSetId\` de ${nombrarSets(sinMapeo)}. ` +
            `Las líneas que SÍ existen aquí son ${citarLineaViva(GRADED_LOG_LINES.mapperUnavailable)} ` +
            `(los sin comprobar), ${citarLineaViva(GRADED_LOG_LINES.mapperUnmatched)} (los sin mapeo) y ` +
            `${citarLineaViva(GRADED_LOG_LINES.setWithoutPptSetId)} (consecuencia de ambas, no causa). ` +
            `La que NO está es ${citarLineaAusente(GRADED_LOG_LINES.requestFailed)}: no hubo petición ` +
            'que pudiera fallar.',
        );
      }
      return r(
        'INDETERMINADO',
        `NO HUBO NI UNA PETICIÓN, y NO es que falte mapeo: ${qué}, así que de ${sets.length} set(s) del ` +
          `alcance (${nombrarSets(sets)}) NO SE PUDO COMPROBAR si tienen \`pptSetId\`. Sin ese id no se ` +
          'pide nada, pero la causa es la consulta caída, no el mapeo.' +
          parcial,
        `${acción} La línea que SÍ existe aquí es ` +
          `${citarLineaViva(GRADED_LOG_LINES.mapperUnavailable)}, y también ` +
          `${citarLineaViva(GRADED_LOG_LINES.setWithoutPptSetId)} (consecuencia, no causa). NO están en ` +
          `este log ni ${citarLineaAusente(GRADED_LOG_LINES.mapperUnmatched)} —el mapeo ni se ` +
          `intentó— ni ${citarLineaAusente(GRADED_LOG_LINES.requestFailed)}.`,
      );
    }
    if (sinMapeo.length > 0) {
      return r(
        'INDETERMINADO',
        `NO HUBO NI UNA PETICIÓN: ${sinMapeo.length} set(s) del alcance NO tienen \`pptSetId\` mapeado ` +
          `(${nombrarSets(sinMapeo)}) y sin él no se pide nada (jamás se cae al externalId). Las cartas de ` +
          'esos sets no se pidieron NUNCA: por eso no tienen dato.' +
          parcial,
        `Mapea el \`pptSetId\` de ${nombrarSets(sinMapeo)}. Lo resuelve \`PptSetMapper\` por NOMBRE contra ` +
          '`GET /api/v2/sets` de PPT y solo persiste lo que empata sin ambigüedad ⇒ busca en el log ' +
          `${citarLineaViva(GRADED_LOG_LINES.mapperUnmatched)} para ver cuál no empató y por qué. ` +
          `La línea que SÍ existe aquí es ${citarLineaViva(GRADED_LOG_LINES.setWithoutPptSetId)}; la de ` +
          `${citarLineaAusente(GRADED_LOG_LINES.requestFailed)}: no hubo petición.`,
      );
    }
    return r(
      'INDETERMINADO',
      'NO HUBO NI UNA PETICIÓN al proveedor, y la corrida no registró ninguna de las causas conocidas ' +
        '(ni falta de llave, ni catálogo de sets caído, ni set sin `pptSetId`).',
      `No busques ${citarLineaAusente(GRADED_LOG_LINES.requestFailed)}: no hubo petición que pudiera ` +
        `fallar. Revisa las líneas ${citarLineaViva(GRADED_LOG_LINES.ingest)} de esta corrida; si el ` +
        'alcance no estaba vacío y aun así ningún set llegó a pedir, es un hueco del propio ' +
        'diagnóstico ⇒ repórtalo (no lo adivines).',
    );
  }
  // Aquí SÍ se emitieron peticiones y ninguna respondió OK. Cuál es «la línea del fallo» depende de si
  // lo que cortó fue la CUOTA DIARIA (rama propia del provider) o cualquier otro error (el `else`).
  // Si además hubo sets que ni se pidieron, se dicen — son cartas sin dato por otra causa.
  const colas: string[] = [];
  if (sinMapeo.length > 0) {
    colas.push(
      ` ⚠️ Además, ${sinMapeo.length} set(s) del alcance NI SE PIDIERON por no tener \`pptSetId\` ` +
        `(${nombrarSets(sinMapeo)}): esas cartas no tienen dato por una causa DISTINTA, y para ellas no ` +
        'hay ninguna línea de fallo que buscar.',
    );
  }
  if (!req.mapper.available) {
    const { acción } = motivoCatalogoCaido(req.mapper.cause);
    colas.push(
      ` ⚠️ Además, de ${req.mapper.sets.length} set(s) (${nombrarSets(req.mapper.sets)}) NO SE PUDO ` +
        `COMPROBAR el mapeo (ver ${citarLineaViva(GRADED_LOG_LINES.mapperUnavailable)}): eso NO es ` +
        `«sin mapeo». ${acción}`,
    );
  }
  const cola = colas.join('') + parcial;
  return r(
    'INDETERMINADO',
    dailyLimited
      ? 'La cuota diaria del proveedor se agotó antes de obtener una sola respuesta: no hubo observación.'
      : `Se emitieron peticiones en ${req.attempted} set(s) y NINGUNA respondió OK (llave, red o plan): ` +
        'no hubo observación.',
    // ⛑️ QA (v1.51-d) — ESTE `nextStep` era INCONDICIONAL mientras el titular sí tenía rama para
    // `dailyLimited`: con la cuota agotada mandaba a un `grep` que no devuelve nada, porque
    // `PptDailyLimitError` emite su propia línea y NO cae en «EL REQUEST FALLÓ» (que es el `else`).
    // No se cita aquí «EL REQUEST FALLÓ»: con la cuota agotada puede existir (si algún set falló antes
    // por otra causa) o no existir, y el veredicto no tiene cómo saberlo ⇒ no se afirma ninguna de las
    // dos cosas. Se cita la línea que SIEMPRE está cuando `dailyLimited` es cierto.
    (dailyLimited
      ? 'Espera al reinicio de la cuota (00:00 UTC) y vuelve a correr — o corre el ingest de estimados ' +
        `ANTES del barrido de precios RAW, que consume del mismo contador. La línea que SÍ existe es ` +
        `${citarLineaViva(GRADED_LOG_LINES.dailyStop)} (trae \`resetsAt\` y el remaining).`
      : `Revisa las líneas ${citarLineaViva(GRADED_LOG_LINES.requestFailed)} del log (traen el status y ` +
        'la pista) y vuelve a correr.') + cola,
  );
}

/**
 * v1.51-d (techlead §2) — **las paradas, discriminadas por `reason`, con un `never` de cierre.**
 *
 * ### Qué se cierra aquí
 * `no_scope` se atrapaba con un `else if (o.kind === 'stopped')`, o sea **por descarte**. Documentarlo
 * fue mejor que prometer una exhaustividad que no había, pero seguía dejando que un motivo NUEVO
 * cayera en silencio con el titular del *inventario RAW vacío*: causa falsa + acción equivocada, que
 * es el defecto (b) de R1 textualmente. Con la discriminación explícita más el `never`, añadir un
 * motivo a `GradedStopReason` **rompe la compilación** hasta que alguien le escriba su rama.
 *
 * Conducta HOY: idéntica. `GradedStopReason` es cerrado y las tres ramas cubren sus tres valores.
 */
function stoppedVerdict(
  o: Extract<GradedRunOutcome, { kind: 'stopped' }>,
  r: Render,
): GradedPhase2VerdictReport {
  if (o.reason === 'dial_off') {
    return r(
      'INDETERMINADO',
      'No se preguntó nada: el dial `grading_hook_enabled` está en `off`. Es una decisión, no un fallo.',
      'Enciende el dial con PUT /admin/settings {"gradingHookEnabled":"on"} —es el ÚNICO del gancho: encenderlo TAMBIÉN publica las cifras y empieza a gastar créditos— y vuelve a disparar POST /admin/jobs/price-ingest con body {}.',
    );
  }
  if (o.reason === 'ingest_config_invalid') {
    // ⚠️ EL CASO QUE MENTÍA. El dial está ENCENDIDO; lo que para el ingest es una clave corrupta. Se
    // NOMBRA la clave: «la config es inválida» no es accionable, `graded_estimate_min_sample_count` sí.
    // TL-GE6: el tipo exige al menos UNA clave, así que aquí ya no existe «no identificada(s)».
    const keys = o.invalidConfigKeys.join(', ');
    return r(
      'INDETERMINADO',
      `No se preguntó nada, y NO es el dial: \`grading_hook_enabled\` está en \`on\`. Lo que para el ingest es la config, con clave(s) PRESENTE(S)-e-INVÁLIDA(S): ${keys}.`,
      `Corrige ${keys} con PUT /admin/pricing/graded-estimates (o borra la fila para volver al seed) y vuelve a disparar POST /admin/jobs/price-ingest con body {}. NO toques el dial: apagarlo y encenderlo no cambia nada aquí.`,
    );
  }
  if (o.reason === 'no_scope') {
    return r(
      'INDETERMINADO',
      'No se preguntó nada: el dial está en `on` y la config es válida, pero NINGUNA carta tiene inventario RAW publicado, así que el alcance del ingest quedó VACÍO.',
      'Publica al menos una pieza RAW (InventoryItem ownerType=platform, status=listed, productType=raw) de una carta con `pptSetId` mapeado y vuelve a correr. No busques nada en el log del proveedor: no hubo ninguna petición.',
    );
  }
  // ⛑️ EL CANDADO. Si alguien añade un motivo a `GradedStopReason` sin darle rama, esta línea deja de
  // compilar. En tiempo de ejecución NO se lanza (un diagnóstico no puede tumbar el job) ni se hereda
  // un titular ajeno: se dice exactamente lo que se sabe, que es el nombre del motivo.
  //
  // v1.51-e (A7): el candado va sobre el DISCRIMINANTE (`o.reason`), no sobre el objeto. Es el mismo
  // `never`, con la misma fuerza, y permite que `GradedSimpleStop` sea un miembro normal en vez de un
  // mapped type distributivo. Verificado compilando el contraejemplo: un motivo nuevo NO compila.
  const motivoSinRama: never = o.reason;
  const nombre = motivoSinRama as string;
  return r(
    'INDETERMINADO',
    `No se preguntó nada: la corrida PARÓ con el motivo \`${nombre}\`, que NO tiene rama propia en el ` +
      'veredicto ⇒ no se sabe qué significa y NO se hereda el titular de ninguna otra parada.',
    `Es un hueco del propio diagnóstico: dale su rama a \`${nombre}\` en \`gradedPhase2Verdict\` ` +
      '(titular + acción + la línea de log que SÍ existe). No busques nada en el log del proveedor: una ' +
      'parada ocurre antes de cualquier petición.',
  );
}

/**
 * El veredicto, en orden de PRECEDENCIA. La regla que gobierna el orden: primero todo lo que impide
 * observar (no se puede concluir sobre el proveedor si no llegamos a preguntarle), y solo después lo
 * que la observación dice. Un veredicto que no puede sostener su evidencia se emite como
 * `INDETERMINADO` — **jamás** se rellena con la hipótesis más probable.
 */
export function gradedPhase2Verdict(i: GradedPhase2VerdictInput): GradedPhase2VerdictReport {
  const o = i.outcome;
  const observed = o.kind === 'observed' ? o.shapeCounts.s1 + o.shapeCounts.s2 : 0;
  // Conteo INDUCIDO por nuestro propio override (v1.50.3-c): no habla del proveedor. Una sola
  // definición, compartida con el ingest (TL-GE2/R2) — ver `shapeCountIsInduced`.
  const induced = o.kind === 'observed' && shapeCountIsInduced({ probe: i.probe, forcedFormat: o.forcedFormat });

  const r: Render = (verdict, headline, nextStep) => ({ verdict, headline, nextStep, lines: [] });

  let out: GradedPhase2VerdictReport;
  // ── R1: las TRES paradas ANTES de preguntar, cada una con SU causa nombrada ─────────────────────
  // Van primero y separadas porque comparten un síntoma («cero filas escritas») y NO comparten
  // remedio: encender un dial que ya está encendido, corregir una clave, o publicar inventario. Un
  // titular que confunde una con otra manda al operador a la reparación equivocada.
  //
  // v1.51-d (techlead §2): el reparto entre paradas vive en `stoppedVerdict`, con un `never` al final
  // (antes `no_scope` se atrapaba POR DESCARTE, así que un motivo nuevo heredaba en silencio su
  // titular — el defecto (b) de R1 palabra por palabra). Aquí el `if` es sobre `kind`, y eso además
  // estrecha `o` a `observed` para todo el resto de la cadena.
  if (o.kind === 'stopped') {
    out = stoppedVerdict(o, r);
  } else if (i.escalationReason === 'ebay_not_supported_with_set_sweep') {
    out = r(
      'NO_VIABLE',
      'El proveedor RECHAZÓ pedir el bloque de eBay junto con el barrido del set: con este plan no hay forma de leer ventas PSA por set.',
      'ESCALA AL ARQUITECTO (regla 9): la alternativa es «una petición por carta», que cambia el modelo de coste y de barrido.',
    );
  } else if (!o.requestOk) {
    // R1-ter: «no respondió OK» ≠ «no se preguntó». Cada causa manda a la línea de log que SÍ existe.
    out = noRequestOkVerdict(o.requests, i.dailyLimited, r);
  } else if (i.cardsReturned === 0) {
    out = r(
      'INDETERMINADO',
      'El proveedor respondió pero no devolvió ni una carta: no hay nada que clasificar.',
      'Comprueba que el set en alcance tenga `pptSetId` mapeado y que haya inventario RAW publicado.',
    );
  } else if (observed === 0) {
    out = r(
      'INDETERMINADO',
      `El proveedor devolvió ${i.cardsReturned} carta(s) y NINGUNA trae bloque PSA: no se puede distinguir «estas cartas no tienen ventas PSA» de «el plan no incluye el bloque de eBay».`,
      'Repite con otro set de cartas caras y muy vendidas; si sigue sin bloque PSA, el plan no expone ventas PSA ⇒ escala al arquitecto.',
    );
  } else if (o.shapeCounts.s1 > 0 && o.shapeCounts.s2 === 0) {
    out = r(
      'VIABLE',
      `LA FASE 2 FUNCIONA: ${o.shapeCounts.s1} de ${observed} carta(s) con bloque PSA llegaron en S1 (\`ebay.salesByGrade.psaN\`, objeto con count + fecha de última venta), que es el shape PERSISTIBLE.`,
      i.probe
        ? 'Quita POKEMONPRICETRACKER_GRADED_PROBE y vuelve a disparar el job: la misma corrida ya escribirá los estimados.'
        : `Ya se escribieron ${i.written} referencia(s) — y con el dial ÚNICO (v1.51) YA ESTÁN PUBLICADAS: no queda ningún interruptor por encender. Revísalas en GET /admin/pricing/graded-estimates/review y, si alguna cifra está mal, BÓRRALA (DELETE del estimado); apagar el dial por una fila para además la actualización de todas las demás.`,
    );
  } else if (o.shapeCounts.s1 > 0) {
    out = r(
      'VIABLE',
      `LA FASE 2 FUNCIONA PARCIALMENTE: ${o.shapeCounts.s1} carta(s) llegaron en S1 (persistible) y ${o.shapeCounts.s2} en S2 (\`gradedPrices\` escalar, NO persistible: no trae ni muestra ni fecha de venta).`,
      'Es un estado normal (no toda carta tiene ventas PSA en eBay): las S2 se saltan y las S1 se ingestan. No hay nada que arreglar.',
    );
  } else if (induced) {
    out = r(
      'INDETERMINADO',
      `Las ${o.shapeCounts.s2} carta(s) con bloque PSA se contaron como S2, pero la corrida fue con POKEMONPRICETRACKER_GRADED_FORMAT="${o.forcedFormat}": el conteo refleja lo que le pedimos mirar al proveedor, no lo que sirve.`,
      'Vuelve a correr con POKEMONPRICETRACKER_GRADED_FORMAT sin fijar (auto) para obtener un veredicto sobre el PROVEEDOR.',
    );
  } else {
    out = r(
      'NO_VIABLE',
      `LA FASE 2 NO ES VIABLE CON ESTE PROVEEDOR/PLAN: las ${o.shapeCounts.s2} carta(s) con bloque PSA llegaron TODAS en S2 (\`gradedPrices.psaN\`, un número pelado). Sin \`count\` ni fecha de última venta, ese dato NO puede pasar el gate de confianza — y ninguna configuración lo arregla.`,
      'ESCALA AL ARQUITECTO (regla 9): la decisión (dejar la captura manual, pagar el plan que exponga `salesByGrade`, o buscar otro proveedor) es de producto y de costo. La captura manual sigue funcionando mientras tanto.',
    );
  }

  out.lines = renderLines(i, out, observed);
  return out;
}

function renderLines(
  i: GradedPhase2VerdictInput,
  out: GradedPhase2VerdictReport,
  observed: number,
): string[] {
  const o = i.outcome;
  const spent = i.creditsSpent;
  // COSTE: se REPORTA lo medido y se marca explícitamente la duda abierta. La premisa del diseño («el
  // coste es proporcional al inventario real») convive con un request que pide `fetchAllInSet=true`,
  // o sea el SET ENTERO. Si el proveedor cobra por carta DEVUELTA, la premisa es falsa. Esta línea es
  // la que lo resuelve con evidencia en vez de con una discusión.
  //
  // v1.51-b (TL-GE1): la evidencia tiene que ser ATRIBUIBLE. Cuatro estados, ninguno inventado:
  //  (1) la corrida paró antes de pedir nada ⇒ el coste es CERO por construcción, y decirlo cierra la
  //      duda «¿me cobraron por la corrida que no hizo nada?»;
  //  (2) hubo llamadas pero PPT no reportó `metadata.apiCallsConsumed` en todas ⇒ NO se reporta número;
  //  (3) v1.51-c (QA-GE2): hay suma atribuible pero **CERO cartas devueltas** ⇒ el cociente no existe y,
  //      sobre todo, no hay NINGUNA observación de la que sacar el modelo de cobro. Antes esto imprimía
  //      «0 crédito(s) por 0 carta(s) … Compatible con “se cobra por PETICIÓN”»: una conclusión sacada
  //      de cero observaciones, justo lo que este bloque existe para erradicar;
  //  (4) hay suma atribuible y cartas devueltas ⇒ se reporta, y solo entonces se juzga el «por carta».
  const perCard = spent != null && i.cardsReturned > 0 ? (spent / i.cardsReturned).toFixed(2) : null;
  const costLine =
    o.kind === 'stopped'
      ? 'COSTE: 0 créditos — la corrida PARÓ antes de hacer ninguna petición al proveedor.'
      : spent == null
        ? 'COSTE: NO SE PUDO AISLAR el gasto de esta corrida ⇒ no se reporta ningún número. El proveedor no ' +
          'expuso `metadata.apiCallsConsumed` en todas las respuestas graded, y el contador diario ' +
          '(`dailyRemaining`) NO sirve aquí: es estado compartido del proceso y lo pisa el barrido de precios ' +
          'RAW que corre en la misma corrida, así que restarlo cobraría créditos ajenos a esta sonda. ' +
          'Apunta el crédito del panel de PPT antes y después si necesitas la cifra.'
        : perCard == null
          ? `COSTE: ${spent} crédito(s) atribuible(s), pero el proveedor NO devolvió NI UNA carta ` +
            `(${i.cardsInScope} en alcance) ⇒ NO SE PUEDE MEDIR el coste por carta devuelta, y con CERO ` +
            'observaciones tampoco se puede concluir NADA sobre el modelo de cobro. Vuelve a correr con ' +
            'un set que sí devuelva cartas si lo que quieres medir es el coste.'
          : `COSTE MEDIDO: ${spent} crédito(s) por ${i.cardsReturned} carta(s) DEVUELTAS ` +
            `(${i.cardsInScope} en alcance) ⇒ ${perCard} por carta devuelta. ` +
            (Number(perCard) >= 0.5
              ? '⚠️ Cobra por carta DEVUELTA, no por carta nuestra: con `fetchAllInSet=true` se paga el SET ENTERO ' +
                'y la premisa «coste proporcional al inventario real» NO se sostiene ⇒ anótalo y escálalo.'
              : 'Compatible con «se cobra por PETICIÓN»: el barrido por set no escala con el tamaño del set.');

  // Con una PARADA no hay nada que contar: fingir un desglose de shapes «0/0/0 sobre 0» invitaría a
  // leerlo como una observación del proveedor cuando ni siquiera se le habló (R1).
  const arrivedLine =
    o.kind === 'stopped'
      ? `QUÉ LLEGÓ: nada — la corrida no llegó a preguntarle al proveedor (parada: ${o.reason}).`
      : `QUÉ LLEGÓ: ${o.shapeCounts.s1} carta(s) en S1 (ebay.salesByGrade, PERSISTIBLE) / ${o.shapeCounts.s2} en S2 ` +
        `(gradedPrices escalar, NO persistible) / ${Math.max(0, i.cardsReturned - observed)} sin bloque PSA, ` +
        `sobre ${i.cardsReturned} carta(s) devueltas por el proveedor en ${i.sets} set(s).`;

  // R1-ter — LOS SETS QUE NI SE PIDIERON. Van como líneas propias (no solo en el `AHORA:`) porque son
  // compatibles con un veredicto VIABLE: la corrida puede haber escrito estimados de un set y, a la
  // vez, no haber pedido NUNCA los otros. Ésa es exactamente la pregunta abierta en producción
  // («escribe, pero muchas cartas siguen sin dato») y sin esto había que deducirlo del log del mapper.
  //
  // v1.51-d — son DOS líneas, no una (R1-quater): «se comprobó y no empata» pide MAPEAR; «no se pudo
  // comprobar» pide REINTENTAR, y fundirlas publicaba la segunda con la acción de la primera. Y las
  // dos llevan la marca de COTA INFERIOR cuando el recorrido no cubrió el alcance (QA): un número
  // parcial leído como total contesta al revés la pregunta que el dueño quiere contestar.
  const parcial = o.kind === 'observed' && !o.requests.sweepComplete ? COTA_INFERIOR : '';
  const skippedSetsLine =
    o.kind === 'observed' && o.requests.setsUnmatched.length > 0
      ? `SETS NO PEDIDOS: ${o.requests.setsUnmatched.length} set(s) del alcance recorrido NO tienen ` +
        `\`pptSetId\` mapeado (${nombrarSets(o.requests.setsUnmatched)}) ⇒ sus cartas NO se pidieron y ` +
        'por eso no tienen dato. Se mapea por NOMBRE contra `GET /api/v2/sets` (ver ' +
        `${citarLineaViva(GRADED_LOG_LINES.mapperUnmatched)}).${parcial}`
      : null;
  const uncheckedSetsLine =
    o.kind === 'observed' && !o.requests.mapper.available
      ? `SETS SIN COMPROBAR: de ${o.requests.mapper.sets.length} set(s) ` +
        `(${nombrarSets(o.requests.mapper.sets)}) NO SE PUDO consultar el catálogo del proveedor ` +
        `(${o.requests.mapper.cause === 'daily_limit' ? 'cuota diaria agotada' : 'la petición falló'}) ⇒ ` +
        'NO se sabe si tienen `pptSetId`; sus cartas no se pidieron por eso, no por falta de mapeo. Ver ' +
        `${citarLineaViva(GRADED_LOG_LINES.mapperUnavailable)}.${parcial}`
      : null;
  // La parcialidad se dice AUNQUE no haya sets pendientes: «cero sets sin mapear» sobre un recorrido
  // que se cortó es igual de engañoso que un total inflado.
  const sweepLine =
    o.kind === 'observed' && !o.requests.sweepComplete
      ? `ALCANCE RECORRIDO: PARCIAL — se miraron ${i.sets} set(s) y el recorrido se cortó antes de ` +
        'cubrir el alcance completo. Cualquier cifra de sets de este bloque es un MÍNIMO.'
      : null;

  const modeLine =
    `MODO: ${
      i.probe
        ? 'SONDA de SOLO LECTURA — cero escrituras en PriceReference (la sonda no construye filas).'
        : `INGEST — ${i.written} referencia(s) escritas.`
    }` +
    // Con una parada, `GRADED_FORMAT` no actuó sobre nada: imprimirlo (antes se imprimía `auto`
    // cableado) sugiere una observación que no existe.
    (o.kind === 'observed' ? ` GRADED_FORMAT=${o.forcedFormat}` : '') +
    (i.dailyLimited ? ' · ⚠️ la corrida topó la CUOTA DIARIA (observación parcial)' : '');

  return [
    '════════════════════════════════════════════════════════════════════',
    `VEREDICTO: ${out.verdict} — ${out.headline}`,
    arrivedLine,
    ...(skippedSetsLine ? [skippedSetsLine] : []),
    ...(uncheckedSetsLine ? [uncheckedSetsLine] : []),
    ...(sweepLine ? [sweepLine] : []),
    modeLine,
    costLine,
    `AHORA: ${out.nextStep}`,
    '════════════════════════════════════════════════════════════════════',
  ].map((l) => `[${GRADED_VERDICT_TAG}] ${l}`);
}

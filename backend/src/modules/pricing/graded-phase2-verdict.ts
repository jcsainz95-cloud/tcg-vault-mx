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
 */

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
export interface GradedRequestTally {
  /** Sets en los que se EMITIÓ al menos una petición HTTP (haya respondido OK o no). */
  attempted: number;
  /** `POKEMONPRICETRACKER_API_KEY` ausente ⇒ ningún set llegó a pedirse. */
  missingApiKey: boolean;
  /**
   * `externalId` de los sets que **ni se pidieron** por no tener `pptSetId` mapeado. Se NOMBRAN porque
   * es la única forma de que la acción sea directa: «algún set no está mapeado» no se puede arreglar;
   * «`sv8` no está mapeado» sí.
   */
  setsWithoutPptSetId: readonly string[];
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
export type GradedRunOutcome =
  /**
   * Paradas SIN carga adicional: `dial_off` (cero peticiones, cero filas, cero créditos) y `no_scope`
   * (dial `on`, config válida, cero cartas con inventario RAW publicado).
   */
  | { kind: 'stopped'; reason: Exclude<GradedStopReason, 'ingest_config_invalid'> }
  /** Dial `on` + clave(s) del ingest PRESENTE(S)-e-INVÁLIDA(S). **Al menos una, nombrada.** */
  | { kind: 'stopped'; reason: 'ingest_config_invalid'; invalidConfigKeys: readonly [string, ...string[]] }
  /** Se llegó a hablar (o al menos a intentar hablar) con el proveedor: aquí sí hay observación. */
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

/**
 * v1.51-c (R1-ter) — **«no respondió OK» son TRES cosas distintas y solo una manda al log del fallo.**
 *
 * Las dos primeras (`sin llave`, `set sin pptSetId`) son las causas #4 y #5 del mapa de causas
 * (`BACKEND_NOTES.md` §0.16.2) y en ninguna de las dos existe la línea «PPT graded: EL REQUEST FALLÓ»:
 * el provider devuelve `empty` **antes** de emitir nada. Mandar ahí al operador es el defecto (b) de R1
 * textualmente idéntico — y «set sin `pptSetId`» es hoy la hipótesis principal de las cartas sin dato
 * en producción, así que era el caso más caro de equivocar.
 */
function noRequestOkVerdict(req: GradedRequestTally, dailyLimited: boolean, r: Render): GradedPhase2VerdictReport {
  const sinSet = req.setsWithoutPptSetId;
  if (req.attempted === 0) {
    if (req.missingApiKey) {
      return r(
        'INDETERMINADO',
        'NO HUBO NI UNA PETICIÓN: falta `POKEMONPRICETRACKER_API_KEY`, así que ningún set del alcance ' +
          'llegó a pedirse. El proveedor no falló — no se le habló.',
        'Pon POKEMONPRICETRACKER_API_KEY en el entorno del backend (Railway ⇒ redeploy) y vuelve a ' +
          'correr. La línea que SÍ existe en este log es «PPT graded: falta POKEMONPRICETRACKER_API_KEY»; ' +
          'la de «EL REQUEST FALLÓ» NO existe en esta corrida: no hubo petición que pudiera fallar.',
      );
    }
    if (sinSet.length > 0) {
      return r(
        'INDETERMINADO',
        `NO HUBO NI UNA PETICIÓN: ${sinSet.length} set(s) del alcance NO tienen \`pptSetId\` mapeado ` +
          `(${nombrarSets(sinSet)}) y sin él no se pide nada (jamás se cae al externalId). Las cartas de ` +
          'esos sets no se pidieron NUNCA: por eso no tienen dato.',
        `Mapea el \`pptSetId\` de ${nombrarSets(sinSet)}. Lo resuelve \`PptSetMapper\` por NOMBRE contra ` +
          '`GET /api/v2/sets` de PPT y solo persiste lo que empata sin ambigüedad ⇒ busca en el log ' +
          '«PptSetMapper: … sets SIN mapeo a PokemonPriceTracker» para ver cuál no empató y por qué. ' +
          'La línea que SÍ existe aquí es «PPT graded: set … sin pptSetId → no se pide nada»; la de ' +
          '«EL REQUEST FALLÓ» NO existe: no hubo petición.',
      );
    }
    return r(
      'INDETERMINADO',
      'NO HUBO NI UNA PETICIÓN al proveedor, y la corrida no registró ninguna de las causas conocidas ' +
        '(ni falta de llave, ni set sin `pptSetId`).',
      'No busques «EL REQUEST FALLÓ» en el log: no hubo petición que pudiera fallar. Revisa las líneas ' +
        '«PPT graded» y «graded-estimate-ingest» de esta corrida; si el alcance no estaba vacío y aun ' +
        'así ningún set llegó a pedir, es un hueco del propio diagnóstico ⇒ repórtalo (no lo adivines).',
    );
  }
  // Aquí SÍ se emitieron peticiones y ninguna respondió OK: la línea del fallo existe y es donde hay
  // que mirar. Si además hubo sets que ni se pidieron, se dicen — son cartas sin dato por otra causa.
  const cola =
    sinSet.length > 0
      ? ` ⚠️ Además, ${sinSet.length} set(s) del alcance NI SE PIDIERON por no tener \`pptSetId\` ` +
        `(${nombrarSets(sinSet)}): esas cartas no tienen dato por una causa DISTINTA, y para ellas no hay ` +
        'ninguna línea de fallo que buscar.'
      : '';
  return r(
    'INDETERMINADO',
    dailyLimited
      ? 'La cuota diaria del proveedor se agotó antes de obtener una sola respuesta: no hubo observación.'
      : `Se emitieron peticiones en ${req.attempted} set(s) y NINGUNA respondió OK (llave, red o plan): ` +
        'no hubo observación.',
    'Revisa las líneas «PPT graded: EL REQUEST FALLÓ» del log (traen el status y la pista) y vuelve a ' +
      `correr.${cola}`,
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
  if (o.kind === 'stopped' && o.reason === 'dial_off') {
    out = r(
      'INDETERMINADO',
      'No se preguntó nada: el dial `grading_hook_enabled` está en `off`. Es una decisión, no un fallo.',
      'Enciende el dial con PUT /admin/settings {"gradingHookEnabled":"on"} —es el ÚNICO del gancho: encenderlo TAMBIÉN publica las cifras y empieza a gastar créditos— y vuelve a disparar POST /admin/jobs/price-ingest con body {}.',
    );
  } else if (o.kind === 'stopped' && o.reason === 'ingest_config_invalid') {
    // ⚠️ EL CASO QUE MENTÍA. El dial está ENCENDIDO; lo que para el ingest es una clave corrupta. Se
    // NOMBRA la clave: «la config es inválida» no es accionable, `graded_estimate_min_sample_count` sí.
    // TL-GE6: el tipo exige al menos UNA clave, así que aquí ya no existe «no identificada(s)».
    const keys = o.invalidConfigKeys.join(', ');
    out = r(
      'INDETERMINADO',
      `No se preguntó nada, y NO es el dial: \`grading_hook_enabled\` está en \`on\`. Lo que para el ingest es la config, con clave(s) PRESENTE(S)-e-INVÁLIDA(S): ${keys}.`,
      `Corrige ${keys} con PUT /admin/pricing/graded-estimates (o borra la fila para volver al seed) y vuelve a disparar POST /admin/jobs/price-ingest con body {}. NO toques el dial: apagarlo y encenderlo no cambia nada aquí.`,
    );
  } else if (o.kind === 'stopped') {
    // `no_scope` — la última parada, y por eso ésta es la rama «cualquier otra parada». ⚠️ Honestidad
    // sobre lo que el tipo garantiza y lo que no: `GradedStopReason` es cerrado, así que HOY aquí solo
    // puede caer `no_scope`; pero si mañana se le añade un motivo, **caerá aquí en silencio** con el
    // titular del alcance vacío (el compilador no lo impide: la condición es `kind`, no `reason`).
    // Quien añada un motivo tiene que añadir su rama ANTES de ésta.
    out = r(
      'INDETERMINADO',
      'No se preguntó nada: el dial está en `on` y la config es válida, pero NINGUNA carta tiene inventario RAW publicado, así que el alcance del ingest quedó VACÍO.',
      'Publica al menos una pieza RAW (InventoryItem ownerType=platform, status=listed, productType=raw) de una carta con `pptSetId` mapeado y vuelve a correr. No busques nada en el log del proveedor: no hubo ninguna petición.',
    );
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

  // R1-ter — LOS SETS QUE NI SE PIDIERON. Va como línea propia (no solo en el `AHORA:`) porque es
  // compatible con un veredicto VIABLE: la corrida puede haber escrito estimados de un set y, a la vez,
  // no haber pedido NUNCA los otros. Ésa es exactamente la pregunta abierta en producción («escribe,
  // pero muchas cartas siguen sin dato») y sin esta línea había que deducirla del log del mapper.
  const skippedSetsLine =
    o.kind === 'observed' && o.requests.setsWithoutPptSetId.length > 0
      ? `SETS NO PEDIDOS: ${o.requests.setsWithoutPptSetId.length} set(s) del alcance NO tienen \`pptSetId\` ` +
        `mapeado (${nombrarSets(o.requests.setsWithoutPptSetId)}) ⇒ sus cartas NO se pidieron y por eso ` +
        'no tienen dato. Se mapea por NOMBRE contra `GET /api/v2/sets` (ver «PptSetMapper: … SIN mapeo»).'
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
    modeLine,
    costLine,
    `AHORA: ${out.nextStep}`,
    '════════════════════════════════════════════════════════════════════',
  ].map((l) => `[${GRADED_VERDICT_TAG}] ${l}`);
}

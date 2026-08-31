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

export interface GradedPhase2VerdictInput {
  /** ¿La corrida fue SONDA (solo lectura) o INGEST (podía escribir)? Cambia qué significa «0 escritas». */
  probe: boolean;
  /** Dial `graded_estimate_ingest_enabled`: en `off` no se pidió nada y no hay nada que concluir. */
  enabled: boolean;
  /** ¿Alguna respuesta del proveedor llegó OK? Sin esto no hay observación, solo un fallo de plomería. */
  requestOk: boolean;
  sets: number;
  cardsInScope: number;
  /** Cartas DEVUELTAS por el proveedor en toda la corrida (`fetchedRaw`), el denominador del coste. */
  cardsReturned: number;
  shapeCounts: { s1: number; s2: number };
  written: number;
  dailyLimited: boolean;
  escalationReason: string | null;
  /** `POKEMONPRICETRACKER_GRADED_FORMAT` visto en la corrida. Distinto de `auto` ⇒ conteo INDUCIDO. */
  forcedFormat: 'auto' | 'sales_by_grade' | 'graded_prices';
  /** Crédito diario antes / después de la corrida (COSTE MEDIDO, no supuesto). */
  creditsBefore: number | null;
  creditsAfter: number | null;
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

/**
 * El veredicto, en orden de PRECEDENCIA. La regla que gobierna el orden: primero todo lo que impide
 * observar (no se puede concluir sobre el proveedor si no llegamos a preguntarle), y solo después lo
 * que la observación dice. Un veredicto que no puede sostener su evidencia se emite como
 * `INDETERMINADO` — **jamás** se rellena con la hipótesis más probable.
 */
export function gradedPhase2Verdict(i: GradedPhase2VerdictInput): GradedPhase2VerdictReport {
  const observed = i.shapeCounts.s1 + i.shapeCounts.s2;
  // Conteo INDUCIDO por nuestro propio override (v1.50.3-c): no habla del proveedor. La SONDA está
  // exenta porque clasifica por observación pura (ignora `GRADED_FORMAT` a propósito, ver
  // `detectGradedShape`), así que su conteo sí es evidencia sobre PPT.
  const induced = !i.probe && i.forcedFormat !== 'auto';

  const r = (verdict: GradedPhase2Verdict, headline: string, nextStep: string): GradedPhase2VerdictReport => ({
    verdict,
    headline,
    nextStep,
    lines: [],
  });

  let out: GradedPhase2VerdictReport;
  if (!i.enabled) {
    out = r(
      'INDETERMINADO',
      'No se preguntó nada: el dial `graded_estimate_ingest_enabled` está en `off` (o la config del ingest es inválida).',
      'Enciende el dial con PUT /admin/pricing/graded-estimates y vuelve a disparar POST /admin/jobs/price-ingest con body {}.',
    );
  } else if (i.escalationReason === 'ebay_not_supported_with_set_sweep') {
    out = r(
      'NO_VIABLE',
      'El proveedor RECHAZÓ pedir el bloque de eBay junto con el barrido del set: con este plan no hay forma de leer ventas PSA por set.',
      'ESCALA AL ARQUITECTO (regla 9): la alternativa es «una petición por carta», que cambia el modelo de coste y de barrido.',
    );
  } else if (!i.requestOk) {
    out = r(
      'INDETERMINADO',
      i.dailyLimited
        ? 'La cuota diaria del proveedor se agotó antes de obtener una sola respuesta: no hubo observación.'
        : 'Ninguna petición al proveedor llegó a responder OK (llave, red o pptSetId): no hubo observación.',
      'Revisa las líneas «PPT graded: EL REQUEST FALLÓ» del log (traen el status y la pista) y vuelve a correr.',
    );
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
  } else if (i.shapeCounts.s1 > 0 && i.shapeCounts.s2 === 0) {
    out = r(
      'VIABLE',
      `LA FASE 2 FUNCIONA: ${i.shapeCounts.s1} de ${observed} carta(s) con bloque PSA llegaron en S1 (\`ebay.salesByGrade.psaN\`, objeto con count + fecha de última venta), que es el shape PERSISTIBLE.`,
      i.probe
        ? 'Quita POKEMONPRICETRACKER_GRADED_PROBE y vuelve a disparar el job: la misma corrida ya escribirá los estimados.'
        : `Ya se escribieron ${i.written} referencia(s). Revisa una en la ficha y, cuando convenza, enciende \`graded_estimates_enabled\` (exhibición).`,
    );
  } else if (i.shapeCounts.s1 > 0) {
    out = r(
      'VIABLE',
      `LA FASE 2 FUNCIONA PARCIALMENTE: ${i.shapeCounts.s1} carta(s) llegaron en S1 (persistible) y ${i.shapeCounts.s2} en S2 (\`gradedPrices\` escalar, NO persistible: no trae ni muestra ni fecha de venta).`,
      'Es un estado normal (no toda carta tiene ventas PSA en eBay): las S2 se saltan y las S1 se ingestan. No hay nada que arreglar.',
    );
  } else if (induced) {
    out = r(
      'INDETERMINADO',
      `Las ${i.shapeCounts.s2} carta(s) con bloque PSA se contaron como S2, pero la corrida fue con POKEMONPRICETRACKER_GRADED_FORMAT="${i.forcedFormat}": el conteo refleja lo que le pedimos mirar al proveedor, no lo que sirve.`,
      'Vuelve a correr con POKEMONPRICETRACKER_GRADED_FORMAT sin fijar (auto) para obtener un veredicto sobre el PROVEEDOR.',
    );
  } else {
    out = r(
      'NO_VIABLE',
      `LA FASE 2 NO ES VIABLE CON ESTE PROVEEDOR/PLAN: las ${i.shapeCounts.s2} carta(s) con bloque PSA llegaron TODAS en S2 (\`gradedPrices.psaN\`, un número pelado). Sin \`count\` ni fecha de última venta, ese dato NO puede pasar el gate de confianza — y ninguna configuración lo arregla.`,
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
  const spent = i.creditsBefore != null && i.creditsAfter != null ? i.creditsBefore - i.creditsAfter : null;
  // COSTE: se REPORTA lo medido y se marca explícitamente la duda abierta. La premisa del diseño («el
  // coste es proporcional al inventario real») convive con un request que pide `fetchAllInSet=true`,
  // o sea el SET ENTERO. Si el proveedor cobra por carta DEVUELTA, la premisa es falsa. Esta línea es
  // la que lo resuelve con evidencia en vez de con una discusión.
  const perCard = spent != null && i.cardsReturned > 0 ? (spent / i.cardsReturned).toFixed(2) : null;
  const costLine =
    spent == null
      ? 'COSTE: el proveedor no expuso `dailyRemaining` en esta corrida → NO se puede medir (no se estima a ojo). ' +
        'Apunta el crédito del panel de PPT antes y después de la corrida.'
      : `COSTE MEDIDO: ${spent} crédito(s) por ${i.cardsReturned} carta(s) DEVUELTAS ` +
        `(${i.cardsInScope} en alcance) ⇒ ${perCard ?? 'n/d'} por carta devuelta. ` +
        (perCard != null && Number(perCard) >= 0.5
          ? '⚠️ Cobra por carta DEVUELTA, no por carta nuestra: con `fetchAllInSet=true` se paga el SET ENTERO ' +
            'y la premisa «coste proporcional al inventario real» NO se sostiene ⇒ anótalo y escálalo.'
          : 'Compatible con «se cobra por PETICIÓN»: el barrido por set no escala con el tamaño del set.');

  return [
    '════════════════════════════════════════════════════════════════════',
    `VEREDICTO: ${out.verdict} — ${out.headline}`,
    `QUÉ LLEGÓ: ${i.shapeCounts.s1} carta(s) en S1 (ebay.salesByGrade, PERSISTIBLE) / ${i.shapeCounts.s2} en S2 ` +
      `(gradedPrices escalar, NO persistible) / ${Math.max(0, i.cardsReturned - observed)} sin bloque PSA, ` +
      `sobre ${i.cardsReturned} carta(s) devueltas por el proveedor en ${i.sets} set(s).`,
    `MODO: ${
      i.probe
        ? 'SONDA de SOLO LECTURA — cero escrituras en PriceReference (la sonda no construye filas).'
        : `INGEST — ${i.written} referencia(s) escritas.`
    } GRADED_FORMAT=${i.forcedFormat}${i.dailyLimited ? ' · ⚠️ la corrida topó la CUOTA DIARIA (observación parcial)' : ''}`,
    costLine,
    `AHORA: ${out.nextStep}`,
    '════════════════════════════════════════════════════════════════════',
  ].map((l) => `[${GRADED_VERDICT_TAG}] ${l}`);
}

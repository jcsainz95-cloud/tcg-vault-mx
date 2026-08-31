import { GRADED_VERDICT_TAG } from '../src/modules/pricing/graded-phase2-verdict';
import {
  GRADED_LOG_LINES,
  citaCoincideConLinea,
  citarLineaAusente,
  citarLineaViva,
  emitirLineaGraded,
} from '../src/modules/pricing/graded-log-lines';
import { SettingKey } from '../src/modules/settings/settings.constants';
import {
  CARD,
  FX,
  ON,
  capturarLogs,
  esperarVeredictoCitable,
  mockPages,
  pageS1,
  resp401,
  resp429Daily,
  verificarCitasDelVeredicto,
  wireJob,
} from './graded-run.harness';

/**
 * ⛑️ **v1.51-d (TL-GE7) — EL GUARDIÁN DEL INVARIANTE «la línea que cito existe en esta corrida».**
 *
 * ### Por qué este archivo existe (y por qué era el encargo #1)
 * Van TRES pases sobre el mismo defecto y cada uno cerró instancias dejando otra viva: R1 cerró dos,
 * R1-ter una tercera, y el techlead encontró la cuarta mientras QA encontraba la quinta. Lo que se
 * rompe **no** es «el tipo permite un estado imposible» —eso lo cerró `GradedRunOutcome`— sino:
 *
 * > **el mensaje cita una evidencia que en ese estado no existe.**
 *
 * Mientras esa cita fuera prosa libre revisada a mano, la instancia número seis estaba garantizada.
 * Aquí se mecaniza: se corre el job de verdad (provider REAL, mapper REAL, `fetch` mockeado), se
 * capturan **todos** los logs de esa corrida y se exige que cada línea que el bloque `VEREDICTO-PSA`
 * cita entre `«…»` aparezca en ellos — y que las citadas como ausentes, no.
 *
 * Un test que solo mira el veredicto no puede ver esto: la cita y la línea viven en archivos
 * distintos, y por eso llevan tres pases desincronizándose.
 */

const CARD_B = {
  id: 'c2',
  setId: 's2',
  externalId: 'sv7-1',
  number: '1',
  set: { id: 's2', externalId: 'sv7', name: 'Stellar Crown' },
};
const CARD_C = {
  id: 'c3',
  setId: 's3',
  externalId: 'sv6-1',
  number: '1',
  set: { id: 's3', externalId: 'sv6', name: 'Twilight Masquerade' },
};

const HOY = new Date().toISOString().slice(0, 10);
/** Página S1 para una carta concreta (la resolución carta↔fila es por `externalId`). */
const pageS1De = (externalId: string, number: string) => ({
  data: [
    {
      id: externalId,
      cardNumber: number,
      ebay: { salesByGrade: { psa10: { count: 7, medianPrice: 60, lastSaleDate: HOY } } },
    },
  ],
  total: 1,
  count: 1,
  hasMore: false,
});

/** Catálogo `/api/v2/sets` que SOLO conoce «Surging Sparks» ⇒ los demás quedan sin mapeo REAL. */
const CATALOGO_PARCIAL = { data: [{ tcgPlayerNumericId: 1407, name: 'Surging Sparks', releaseDate: '2024/11/08' }] };
/** `/api/v2/sets` que devuelve 429 `daily`: el catálogo NO se pudo consultar (R1-quater). */
const CATALOGO_CUOTA_AGOTADA = resp429Daily();

afterEach(() => jest.restoreAllMocks());

// =================================================================================================
describe('TL-GE7 — el guardián es capaz de cazar (si no, no sirve de nada)', () => {
  /**
   * Un guardián que nunca puede fallar es decoración. Estos dos casos son sintéticos a propósito:
   * fijan lo que el guardián considera una violación, sin depender de ninguna rama del veredicto.
   */
  it('detecta una CITA VIVA cuya línea no está en los logs de la corrida', () => {
    const r = verificarCitasDelVeredicto([
      `[${GRADED_VERDICT_TAG}] AHORA: Revisa las líneas ${citarLineaViva(GRADED_LOG_LINES.requestFailed)}.`,
      'graded-estimate-ingest: 1 set(s), 1 carta(s) en alcance.',
    ]);
    expect(r.vivasHuerfanas).toEqual([GRADED_LOG_LINES.requestFailed]);
  });

  it('detecta una CITA AUSENTE cuya línea SÍ está (la mentira contraria, igual de cara)', () => {
    const r = verificarCitasDelVeredicto([
      `[${GRADED_VERDICT_TAG}] AHORA: ${citarLineaAusente(GRADED_LOG_LINES.requestFailed)}.`,
      `${emitirLineaGraded(GRADED_LOG_LINES.requestFailed)} para el set sv8: HTTP 401.`,
    ]);
    expect(r.ausentesQueSiExisten).toEqual([GRADED_LOG_LINES.requestFailed]);
  });

  it('NO se deja engañar por el propio bloque: una cita no se encuentra a sí misma', () => {
    const r = verificarCitasDelVeredicto([
      `[${GRADED_VERDICT_TAG}] AHORA: ${citarLineaViva(GRADED_LOG_LINES.dailyStop)}`,
      `[${GRADED_VERDICT_TAG}] Y otra vez: ${citarLineaViva(GRADED_LOG_LINES.dailyStop)}`,
    ]);
    expect(r.vivasHuerfanas).toEqual([GRADED_LOG_LINES.dailyStop]);
  });

  it('los `…` de una marca son comodín: casan con la parte variable real de la línea', () => {
    expect(
      citaCoincideConLinea(
        GRADED_LOG_LINES.setWithoutPptSetId,
        emitirLineaGraded(GRADED_LOG_LINES.setWithoutPptSetId, 'sv8') + ' (jamás se cae al externalId).',
      ),
    ).toBe(true);
    expect(citaCoincideConLinea(GRADED_LOG_LINES.setWithoutPptSetId, 'PPT graded: otra cosa')).toBe(false);
  });

  it('`emitirLineaGraded` exige tantos valores como huecos (un desajuste se ve aquí, no en prod)', () => {
    expect(() => emitirLineaGraded(GRADED_LOG_LINES.setWithoutPptSetId)).toThrow(/hueco/);
  });
});

// =================================================================================================
/**
 * **EL INVARIANTE, sobre corridas REALES.** Cada caso monta una corrida completa y pasa TODOS sus logs
 * por el guardián. Si alguien añade mañana una rama al veredicto con una cita inventada, el caso que
 * la ejercite se pone rojo aquí sin que nadie tenga que acordarse de comprobarlo a mano.
 */
describe('TL-GE7 — toda línea citada por el VEREDICTO-PSA existe en la corrida que lo emitió', () => {
  it('VIABLE — el set está mapeado y el proveedor sirve S1', async () => {
    const logs = capturarLogs();
    mockPages([pageS1()], [], [CATALOGO_PARCIAL]);
    const { ingest, create } = wireJob({}, ON, [{ cardId: 'c1' }], null, { mapperReal: true });
    const res = await ingest.ingestGradedEstimates(FX);

    expect(res.verdict).toBe('VIABLE');
    expect(create).toHaveBeenCalledTimes(1); // ⚠️ la RUTA VIVA de producción, intacta
    esperarVeredictoCitable(logs, 'VIABLE con set mapeado');
  });

  it('set SIN MAPEO real (el catálogo respondió y no empató) — manda al log del mapper, que existe', async () => {
    const logs = capturarLogs();
    mockPages([], [], [{ data: [] }]); // catálogo vacío ⇒ «Surging Sparks» no empata
    const { ingest } = wireJob({}, ON, [{ cardId: 'c1' }], null, { mapperReal: true });
    const res = await ingest.ingestGradedEstimates(FX);

    expect(res.verdict).toBe('INDETERMINADO');
    const { bloque } = esperarVeredictoCitable(logs, 'set sin mapeo');
    expect(bloque.join('\n')).toContain('NO tienen `pptSetId` mapeado');
  });

  it('⛑️ R1-quater — el catálogo NO se pudo consultar: causa propia, línea propia, acción propia', async () => {
    const logs = capturarLogs();
    mockPages([], [], [CATALOGO_CUOTA_AGOTADA]);
    const { ingest, create } = wireJob({}, ON, [{ cardId: 'c1' }], null, { mapperReal: true });
    const res = await ingest.ingestGradedEstimates(FX);
    const bloque = logs.filter((l) => l.includes(GRADED_VERDICT_TAG)).join('\n');

    expect(res.verdict).toBe('INDETERMINADO');
    expect(create).not.toHaveBeenCalled();
    // ⛑️ LA REGRESIÓN: aquí se publicaba «N sets NO tienen pptSetId mapeado … ve a mapearlos» y se
    // citaba «PptSetMapper: … sets SIN mapeo», línea que esta rama NO emite. Causa falsa (era la
    // cuota), acción equivocada (no hay nada que mapear) y cita inexistente: los tres defectos de R1.
    expect(bloque).toContain('NO SE PUDO COMPROBAR');
    expect(bloque).toContain('cuota diaria agotada');
    expect(bloque).not.toContain('ve a mapearlos');
    expect(bloque).not.toContain('NO tienen `pptSetId` mapeado');
    expect(bloque).toContain(citarLineaAusente(GRADED_LOG_LINES.mapperUnmatched));
    esperarVeredictoCitable(logs, 'catálogo caído por cuota');
  });

  it('⛑️ R1-quater — un fallo NO-diario de `/api/v2/sets` da la misma clase de veredicto, otra acción', async () => {
    const logs = capturarLogs();
    mockPages([], [], [resp401()]);
    const { ingest } = wireJob({}, ON, [{ cardId: 'c1' }], null, { mapperReal: true });
    await ingest.ingestGradedEstimates(FX);
    const bloque = logs.filter((l) => l.includes(GRADED_VERDICT_TAG)).join('\n');

    expect(bloque).toContain('la petición falló');
    expect(bloque).toContain('NO SE PUDO COMPROBAR');
    esperarVeredictoCitable(logs, 'catálogo caído por fallo de red');
  });

  it('⛑️ QA — 429 DAILY: la línea que existe es la del 429, NO «EL REQUEST FALLÓ»', async () => {
    const logs = capturarLogs();
    mockPages([resp429Daily()], [], [CATALOGO_PARCIAL]);
    const { ingest } = wireJob({}, ON, [{ cardId: 'c1' }], null, { mapperReal: true });
    const res = await ingest.ingestGradedEstimates(FX);
    const bloque = logs.filter((l) => l.includes(GRADED_VERDICT_TAG)).join('\n');

    expect(res.dailyLimited).toBe(true);
    expect(res.verdict).toBe('INDETERMINADO');
    expect(bloque).toContain('La cuota diaria del proveedor se agotó');
    // ⛑️ LA REGRESIÓN: el `nextStep` era INCONDICIONAL y mandaba a «PPT graded: EL REQUEST FALLÓ»,
    // que `PptDailyLimitError` NO emite (tiene su propia rama en el provider; esa otra es el `else`).
    expect(bloque).not.toContain(citarLineaViva(GRADED_LOG_LINES.requestFailed));
    expect(bloque).toContain(citarLineaViva(GRADED_LOG_LINES.dailyStop));
    esperarVeredictoCitable(logs, '429 daily');
  });

  it('el request falla de verdad (401) ⇒ ahí SÍ se cita «EL REQUEST FALLÓ» (no se rompió el caso bueno)', async () => {
    const logs = capturarLogs();
    mockPages([resp401()], [], [CATALOGO_PARCIAL]);
    const { ingest } = wireJob({}, ON, [{ cardId: 'c1' }], null, { mapperReal: true });
    await ingest.ingestGradedEstimates(FX);

    const { bloque } = esperarVeredictoCitable(logs, '401 del proveedor');
    expect(bloque.join('\n')).toContain(citarLineaViva(GRADED_LOG_LINES.requestFailed));
  });

  it('sin `POKEMONPRICETRACKER_API_KEY` — cero peticiones y la cita es la de la llave', async () => {
    const logs = capturarLogs();
    mockPages([pageS1()]);
    const { ingest } = wireJob({ POKEMONPRICETRACKER_API_KEY: undefined });
    await ingest.ingestGradedEstimates(FX);

    const { bloque } = esperarVeredictoCitable(logs, 'sin API key');
    expect(bloque.join('\n')).toContain(citarLineaViva(GRADED_LOG_LINES.missingApiKey));
  });

  it('las tres PARADAS emiten bloque y no citan ninguna línea del proveedor (no hubo petición)', async () => {
    for (const [contexto, config, inventario] of [
      ['dial_off', {}, [{ cardId: 'c1' }]],
      [
        'ingest_config_invalid',
        { ...ON, [SettingKey.GRADED_ESTIMATE_INGEST_MAX_CARDS_PER_RUN]: 2000 },
        [{ cardId: 'c1' }],
      ],
      ['no_scope', ON, []],
    ] as [string, Record<string, unknown>, { cardId: string }[]][]) {
      const logs = capturarLogs();
      mockPages([pageS1()]);
      const { ingest } = wireJob({}, config, inventario);
      await ingest.ingestGradedEstimates(FX);
      esperarVeredictoCitable(logs, contexto);
      jest.restoreAllMocks();
    }
  });
});

// =================================================================================================
/**
 * **QA — el caso MIXTO, que es literalmente el estado de producción.** «Escribe estimados» y «muchas
 * cartas siguen sin dato» son ciertas a la vez, y hasta ahora eso solo estaba probado a nivel de
 * función pura: el test de corrida real cableaba UN set. Aquí hay dos, uno mapeado y otro no.
 */
describe('QA — corrida REAL mixta: un set mapeado escribiendo y otro sin mapear', () => {
  it('VIABLE + SETS NO PEDIDOS en la MISMA corrida (con el mapper real emitiendo su línea)', async () => {
    const logs = capturarLogs();
    // El catálogo solo conoce «Surging Sparks» ⇒ `s1` mapea y `s2` no. Una sola página de cartas: la
    // del set mapeado (del otro NO se pide nada, que es justo lo que hay que demostrar).
    const spy = mockPages([pageS1De(CARD.externalId, CARD.number)], [], [CATALOGO_PARCIAL]);
    const { ingest, create } = wireJob({}, ON, [{ cardId: 'c1' }, { cardId: 'c2' }], null, {
      mapperReal: true,
      cartas: [CARD, CARD_B],
    });

    const res = await ingest.ingestGradedEstimates(FX);
    const bloque = logs.filter((l) => l.includes(GRADED_VERDICT_TAG)).join('\n');

    expect(res.verdict).toBe('VIABLE');
    expect(res.written).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
    // Una sola petición de cartas: la del set mapeado. Del otro NO se pidió nada.
    const urlsDeCartas = spy.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/api/v2/cards'));
    expect(urlsDeCartas).toHaveLength(1);
    expect(urlsDeCartas[0]).toContain('setId=1407');

    expect(bloque).toContain('VEREDICTO: VIABLE');
    expect(bloque).toContain('SETS NO PEDIDOS: 1 set(s)');
    expect(bloque).toContain('sv7');
    // El recorrido SÍ fue completo aquí: los dos sets del alcance se miraron ⇒ sin marca de cota.
    expect(bloque).not.toContain('COTA INFERIOR');
    expect(bloque).not.toContain('ALCANCE RECORRIDO: PARCIAL');
    esperarVeredictoCitable(logs, 'mixto: uno escribe, otro sin mapear');
  });
});

// =================================================================================================
/**
 * **QA — «SETS NO PEDIDOS: N» era una COTA INFERIOR redactada como total.** El bucle se corta (tope de
 * sonda, cuota, escalada) y aun así el bloque decía «N set(s) **del alcance**». Una corrida SONDA podía
 * imprimir «1 set(s)» habiendo veinte sin mapear, sin ninguna marca de parcialidad.
 */
describe('QA — la parcialidad del recorrido se MARCA', () => {
  it('⛑️ la sonda para al primer set con bloque PSA ⇒ el bloque avisa de que la cifra es un mínimo', async () => {
    const logs = capturarLogs();
    // Orden: `s2` (sin mapeo) → `s1` (mapeado, trae S1) → `s3` (sin mapeo, NUNCA se llega a mirar).
    const spy = mockPages([pageS1De(CARD.externalId, CARD.number)], [], [CATALOGO_PARCIAL]);
    const { ingest } = wireJob({ POKEMONPRICETRACKER_MARKET_FORMAT: undefined }, ON, [
      { cardId: 'c2' }, { cardId: 'c1' }, { cardId: 'c3' },
    ], null, { mapperReal: true, cartas: [CARD_B, CARD, CARD_C] });

    const res = await ingest.ingestGradedEstimates(FX);
    const bloque = logs.filter((l) => l.includes(GRADED_VERDICT_TAG)).join('\n');

    expect(res.probe).toBe(true);
    expect(spy.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/api/v2/cards'))).toHaveLength(1);
    // Se vio UNO sin mapear (sv7) y quedó otro (sv6) sin mirar siquiera: el número es un mínimo.
    expect(bloque).toContain('SETS NO PEDIDOS: 1 set(s)');
    expect(bloque).toContain('sv7');
    expect(bloque).not.toContain('sv6');
    // ⛑️ LA REGRESIÓN: «1 set(s) del alcance», sin ninguna marca de que el recorrido se cortó.
    expect(bloque).toContain('COTA INFERIOR');
    expect(bloque).toContain('ALCANCE RECORRIDO: PARCIAL');
    esperarVeredictoCitable(logs, 'sonda que corta el recorrido');
  });

  it('el alcance recortado por `ingestMaxCardsPerRun` también cuenta como recorrido PARCIAL', async () => {
    const logs = capturarLogs();
    mockPages([pageS1De(CARD.externalId, CARD.number)], [], [CATALOGO_PARCIAL]);
    const { ingest } = wireJob({}, { ...ON, [SettingKey.GRADED_ESTIMATE_INGEST_MAX_CARDS_PER_RUN]: 1 }, [
      { cardId: 'c1' }, { cardId: 'c2' },
    ], null, { mapperReal: true, cartas: [CARD, CARD_B] });

    const res = await ingest.ingestGradedEstimates(FX);
    const bloque = logs.filter((l) => l.includes(GRADED_VERDICT_TAG)).join('\n');

    expect(res.cardsInScope).toBe(1);
    expect(bloque).toContain('ALCANCE RECORRIDO: PARCIAL');
    esperarVeredictoCitable(logs, 'alcance recortado por el tope de cartas');
  });

  it('el contraste: una corrida que recorre TODO el alcance no lleva marca de parcialidad', async () => {
    const logs = capturarLogs();
    mockPages([pageS1De(CARD.externalId, CARD.number)], [], [CATALOGO_PARCIAL]);
    const { ingest } = wireJob({}, ON, [{ cardId: 'c1' }], null, { mapperReal: true });
    await ingest.ingestGradedEstimates(FX);
    const bloque = logs.filter((l) => l.includes(GRADED_VERDICT_TAG)).join('\n');

    expect(bloque).not.toContain('ALCANCE RECORRIDO: PARCIAL');
    expect(bloque).not.toContain('COTA INFERIOR');
  });
});

// =================================================================================================
/**
 * El guardián solo sirve si las marcas son de verdad **compartidas**. Estos dos casos fijan eso: si
 * alguien vuelve a escribir el literal a mano en el emisor, la línea deja de casar con la marca y el
 * resto del archivo se pone rojo.
 */
describe('TL-GE7 — emisor y cita leen la MISMA constante', () => {
  it('la línea del 429 diario que emite el provider casa con la marca que cita el veredicto', async () => {
    const logs = capturarLogs();
    mockPages([resp429Daily()], [], [CATALOGO_PARCIAL]);
    const { ingest } = wireJob({}, ON, [{ cardId: 'c1' }], null, { mapperReal: true });
    await ingest.ingestGradedEstimates(FX);

    const emitida = logs.filter((l) => !l.includes(GRADED_VERDICT_TAG));
    expect(emitida.some((l) => citaCoincideConLinea(GRADED_LOG_LINES.dailyStop, l))).toBe(true);
  });

  it('la línea del catálogo caído que emite el mapper casa con la marca que cita el veredicto', async () => {
    const logs = capturarLogs();
    mockPages([], [], [CATALOGO_CUOTA_AGOTADA]);
    const { ingest } = wireJob({}, ON, [{ cardId: 'c1' }], null, { mapperReal: true });
    await ingest.ingestGradedEstimates(FX);

    const emitida = logs.filter((l) => !l.includes(GRADED_VERDICT_TAG));
    expect(emitida.some((l) => citaCoincideConLinea(GRADED_LOG_LINES.mapperUnavailable, l))).toBe(true);
    // Y la OTRA marca del mapper NO se emitió: es justo la que R1-quater citaba en falso.
    expect(emitida.some((l) => citaCoincideConLinea(GRADED_LOG_LINES.mapperUnmatched, l))).toBe(false);
  });
});

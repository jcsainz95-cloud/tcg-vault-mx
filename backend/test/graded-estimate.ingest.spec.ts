import { ConfigService } from '@nestjs/config';
import { CardSet } from '@prisma/client';
import { PokemonPriceTrackerBulkProvider } from '../src/modules/pricing/providers/pokemonpricetracker-bulk.provider';
import { PptApiClient } from '../src/modules/pricing/providers/ppt-api.client';

/**
 * v1.50.2 — **FASE 2 DESBLOQUEADA: el parser AUTO-CONFIRMANTE de estimados PSA** (§4.38h).
 *
 * ### El razonamiento que este archivo protege
 * v1.50 dejó el ingest **manual** invocando **P-6** («no construir un parser sobre un esquema no
 * confirmado»), porque la documentación del proveedor **se contradice** entre
 * `data[i].ebay.salesByGrade.psaN` (objeto) y `gradedPrices.psaN` (escalar). El humano cuestionó ese
 * bloqueo y **tenía razón**: lo que P-6 prohíbe es **codificar contra un esquema que se ASUME**. Un
 * parser que **no asume nada**, **prueba** las dos hipótesis y **se niega a escribir** lo que no
 * identifica positivamente como monto **no viola P-6: lo satisface por construcción** — la primera
 * corrida real confirma el formato **con cero datos malos en la BD**.
 *
 * Por eso las pruebas de este archivo son, casi todas, pruebas de **lo que NO se escribe**.
 */

const SET = { id: 'local-sv8', externalId: 'sv8', name: 'Surging Sparks' } as unknown as CardSet;

function cfg(over: Record<string, string | undefined> = {}): ConfigService {
  const env: Record<string, string | undefined> = {
    POKEMONPRICETRACKER_API_KEY: 'k',
    POKEMONPRICETRACKER_MARKET_FORMAT: 'usd_dollars', // confirmado por el PO para ESTE proveedor
    ...over,
  };
  return { get: (k: string) => env[k] } as unknown as ConfigService;
}

function provider(c: ConfigService = cfg()): PokemonPriceTrackerBulkProvider {
  return new PokemonPriceTrackerBulkProvider(c, new PptApiClient(c));
}

/** fetch mockeado: una respuesta OK por llamada, en orden. */
function mockPages(pages: unknown[]) {
  const spy = jest.fn(async () => {
    const body = pages.shift() ?? { data: [], total: 0, count: 0, limit: 200, offset: 0, hasMore: false };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  });
  global.fetch = spy as unknown as typeof fetch;
  return spy;
}

/**
 * v1.50.3 (§4.38m.2) — **GATE DE EVIDENCIA**. El parser ya no escribe una fila sin saber CUÁNDO fue la
 * última venta: `lastSaleDate` ausente/no parseable o más vieja que `freshnessDays` ⇒ NO se escribe.
 * Por eso todos los fixtures de camino feliz la traen, y hay un bloque dedicado a los que no.
 */
const TODAY = '2026-08-28';
const FRESHNESS_DAYS = 30;
const EVIDENCIA_FRESCA = '2026-08-20'; // 8 días
const EVIDENCIA_VIEJA = '2026-05-01'; // muy fuera de la ventana

/** Bloque S1 de camino feliz: stats + `count` + evidencia FRESCA. */
const s1 = (over: Record<string, unknown> = {}) => ({
  count: 7,
  medianPrice: 60,
  lastSaleDate: EVIDENCIA_FRESCA,
  ...over,
});

/** Página con UNA entrada: la forma S1 (`ebay.salesByGrade`). */
const pageS1 = (psa10: unknown, psa9?: unknown) => ({
  data: [
    {
      id: 'sv8-104',
      cardNumber: '104',
      ebay: { salesByGrade: { psa10, ...(psa9 !== undefined ? { psa9 } : {}) } },
    },
  ],
  total: 1,
  count: 1,
  hasMore: false,
});

/** Página con UNA entrada: la forma S2 (`gradedPrices` escalar). */
const pageS2 = (psa10: unknown) => ({
  data: [{ id: 'sv8-104', cardNumber: '104', gradedPrices: { psa10 } }],
  total: 1,
  count: 1,
  hasMore: false,
});

const call = (p = provider()) =>
  p.fetchGradedEstimatesForSet({
    set: SET,
    providerSetId: 'sv8',
    grades: ['10', '9'],
    minSampleCount: 3,
    sourceStat: 'median',
    freshnessDays: FRESHNESS_DAYS,
    today: TODAY,
  });

describe('§4.38h.1 — S1 `ebay.salesByGrade.psaN` (objeto): se escribe SOLO con identificación positiva', () => {
  it('objeto con `medianPrice` y `count` suficiente ⇒ UNA fila, en USD (INV-FX: la unidad no se pierde)', async () => {
    mockPages([pageS1(s1({ averagePrice: 95, smartMarketPrice: 71 }))]);
    const res = await call();
    expect(res.rows).toEqual([
      {
        externalId: 'sv8-104',
        number: '104',
        gradeValue: '10',
        amountCents: 6_000, // 60 USD → 6000 centavos de DÓLAR, no de peso
        currency: 'USD',
        count: 7,
        // v1.50.3 (§4.38m.2): la fecha de la ÚLTIMA VENTA viaja para log/`AuditLog`. NO se persiste
        // (`PriceReference` no tiene columna sin DDL; la lleva M-43); una fila solo llega hasta aquí si
        // YA pasó el gate de evidencia, así que su presencia ES la prueba de que se midió.
        evidenceDate: EVIDENCIA_FRESCA,
        source: 'pokemonpricetracker',
      },
    ]);
  });

  it('se publica la MEDIANA, no el promedio (una venta atípica desplaza el promedio)', async () => {
    mockPages([pageS1(s1({ averagePrice: 95, smartMarketPrice: 71 }))]);
    const res = await call();
    expect(res.rows[0].amountCents).toBe(6_000); // 60 (mediana), NO 95 (promedio) ni 71 (smart)
  });

  it('el dial `sourceStat` cambia el campo leído sin tocar código (`average`)', async () => {
    mockPages([pageS1(s1({ averagePrice: 95 }))]);
    const res = await provider().fetchGradedEstimatesForSet({
      set: SET,
      providerSetId: 'sv8',
      grades: ['10'],
      minSampleCount: 3,
      sourceStat: 'average',
      freshnessDays: FRESHNESS_DAYS,
      today: TODAY,
    });
    expect(res.rows[0].amountCents).toBe(9_500);
  });

  it('los grados son INDEPENDIENTES: PSA 10 válido + PSA 9 con muestra baja ⇒ solo PSA 10', async () => {
    mockPages([pageS1(s1(), s1({ count: 1, medianPrice: 30 }))]);
    const res = await call();
    expect(res.rows.map((r) => r.gradeValue)).toEqual(['10']);
    expect(res.drops).toEqual([
      expect.objectContaining({ reason: 'sample_too_small', count: 1 }),
    ]);
  });
});

describe('§4.38h.1 — el gate de ORIGEN CONFIABLE se aplica AL ESCRIBIR (§4.38k.1)', () => {
  it('`count` por debajo de `minSampleCount` ⇒ NO se escribe, y queda TRAZA con la muestra', async () => {
    mockPages([pageS1(s1({ count: 2 }))]);
    const res = await call();
    expect(res.rows).toEqual([]);
    expect(res.drops[0]).toMatchObject({ reason: 'sample_too_small', count: 2 });
    // La traza es OBLIGATORIA (§4.38h.4) porque el descarte es INVISIBLE aguas abajo: la fila no
    // existe, así que el `preview` de admin lo vería como `NO_PSA10` y el operador no sabría por qué.
    expect(res.drops[0].sample).toContain('psa10');
  });

  it('S2 (escalar) NO trae `count` ⇒ DESCONOCIDO ⇒ fail-closed: no se escribe nada', async () => {
    mockPages([pageS2(60)]);
    const res = await call();
    // «Desconocido» NO es «suficiente». Es la aplicación literal de la doctrina.
    expect(res.rows).toEqual([]);
    expect(res.drops[0]).toMatchObject({ reason: 'sample_too_small', count: null });
  });

  it('`POKEMONPRICETRACKER_GRADED_MIN_COUNT=0` es la ESCOTILLA: el operador acepta el riesgo a sabiendas', async () => {
    mockPages([pageS2(60)]);
    const res = await call(provider(cfg({ POKEMONPRICETRACKER_GRADED_MIN_COUNT: '0' })));
    // ⚠️ v1.50.3 (§4.38m.2) — **la escotilla del `count` ya NO alcanza para que S2 escriba.** El GATE DE
    // EVIDENCIA es una segunda condición independiente, y el shape S2 (`gradedPrices.psaN` ESCALAR) no
    // trae fecha de última venta por construcción ⇒ `evidence_unknown` ⇒ no se escribe. Consecuencia
    // declarada, no accidente: bajo la doctrina fail-closed («desconocido no es fresco») un shape que no
    // puede probar la antigüedad de su evidencia no puede alimentar una afirmación comercial.
    //
    // Lo que la escotilla SIGUE haciendo es lo suyo: desactivar el gate de MUESTRA (el drop deja de ser
    // `sample_too_small`). Que ahora tope con el de evidencia se ve en el `reason`, no en un silencio.
    expect(res.rows).toEqual([]);
    expect(res.drops).toEqual([expect.objectContaining({ reason: 'evidence_unknown', count: null })]);
  });
});

describe('§4.38h.1 — ante CUALQUIER OTRA FORMA: cero escrituras + muestra cruda', () => {
  it.each([
    ['array', [60]],
    ['string', '60'],
    ['null', null],
    ['objeto desconocido', { precio: 60 }],
    ['NaN', s1({ medianPrice: Number.NaN })],
    ['negativo', s1({ medianPrice: -60 })],
    ['cero', s1({ medianPrice: 0 })],
  ])('%s ⇒ NO se persiste nada y se registra la muestra', async (_n, psa10) => {
    mockPages([pageS1(psa10)]);
    const res = await call();
    expect(res.rows).toEqual([]);
    expect(res.drops).toHaveLength(1);
    expect(res.drops[0].sample.length).toBeGreaterThan(0);
  });

  it('un ESCALAR bajo `salesByGrade` no se acepta «por tolerancia»: sería asumir qué stat es', async () => {
    mockPages([pageS1(60)]);
    const res = await call();
    expect(res.rows).toEqual([]);
    expect(res.drops[0].reason).toBe('unrecognized_shape');
  });
});

describe('§4.38h.1 — el OVERRIDE del operador MANDA sobre la autodetección', () => {
  it('`_GRADED_FORMAT=graded_prices` con respuesta S1 ⇒ NO se escribe (no cae al otro shape)', async () => {
    mockPages([pageS1(s1())]);
    const res = await call(provider(cfg({ POKEMONPRICETRACKER_GRADED_FORMAT: 'graded_prices' })));
    // Caer al shape detectado derrotaría la intención EXPLÍCITA que el override existe para expresar.
    expect(res.rows).toEqual([]);
    expect(res.drops[0].reason).toBe('unrecognized_shape');
  });

  it('`_GRADED_FORMAT=sales_by_grade` con respuesta S2 ⇒ tampoco escribe', async () => {
    mockPages([pageS2(60)]);
    const res = await call(provider(cfg({ POKEMONPRICETRACKER_GRADED_FORMAT: 'sales_by_grade' })));
    expect(res.rows).toEqual([]);
  });

  it('`_GRADED_FIELD` pisa al dial `sourceStat` (es el operador quien manda)', async () => {
    mockPages([pageS1(s1({ smartMarketPrice: 71 }))]);
    const res = await call(provider(cfg({ POKEMONPRICETRACKER_GRADED_FIELD: 'smartMarketPrice' })));
    expect(res.rows[0].amountCents).toBe(7_100);
  });
});

/**
 * §4.38m.2 (v1.50.3) — **GATE DE EVIDENCIA: la OTRA mitad del criterio 109.**
 *
 * ### La divergencia que cierra (nadie la había escrito, y era permisiva)
 * El criterio 109 y §O.7 miden la frescura del dato automático contra *«la antigüedad de la EVIDENCIA de
 * mercado, **no la fecha en que jalamos el archivo**»*. Nuestro `stale()` de lectura mide contra
 * `capturedDate`, que para una fila del ingest **es** la fecha en que jalamos el archivo.
 *
 * **El fallo concreto:** el proveedor deja de recibir ventas de una carta pero **sigue sirviendo la
 * misma mediana**; cada corrida reescribe la fila con `capturedDate = hoy` ⇒ **la cifra parece fresca
 * para siempre**. Es literalmente el «feed rancio» contra el que el dial existe, disfrazado de fresco
 * **por nuestro propio job**.
 *
 * **Cierre sin DDL:** gatear en la ESCRITURA (misma técnica que `minSampleCount`). Una fila solo puede
 * refrescar su `capturedDate` mientras su evidencia esté fresca; cuando la evidencia envejece el ingest
 * deja de reescribirla, `capturedDate` se **congela** y la regla de lectura la vence dentro de
 * `freshnessDays`. **Cota honesta: ≤ 2× freshnessDays**, no los 30 literales — el cierre exacto es la
 * columna `evidenceDate` de M-43.
 */
describe('§4.38m.2 — GATE DE EVIDENCIA en la ESCRITURA (criterio 109 para el dato automático)', () => {
  it('evidencia FRESCA ⇒ escribe, y la fecha viaja en la fila (es la prueba de que se midió)', async () => {
    mockPages([pageS1(s1({ lastSaleDate: EVIDENCIA_FRESCA }))]);
    const res = await call();
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].evidenceDate).toBe(EVIDENCIA_FRESCA);
  });

  it('evidencia VIEJA ⇒ NO se escribe, con traza `evidence_too_old` (es el «fresco para siempre»)', async () => {
    mockPages([pageS1(s1({ lastSaleDate: EVIDENCIA_VIEJA }))]);
    const res = await call();
    expect(res.rows).toEqual([]);
    expect(res.drops).toEqual([expect.objectContaining({ reason: 'evidence_too_old' })]);
    // La muestra lleva la FECHA que se rechazó: sin ella el operador no puede distinguir «el proveedor
    // dejó de recibir ventas» de «el campo se llama de otra forma».
    expect(res.drops[0].sample).toContain(EVIDENCIA_VIEJA);
  });

  it('el BORDE: exactamente `freshnessDays` días pasa; un día más, no', async () => {
    // TODAY = 2026-08-28, freshnessDays = 30 ⇒ 2026-07-29 son 30 días (pasa), 2026-07-28 son 31 (no).
    mockPages([pageS1(s1({ lastSaleDate: '2026-07-29' }))]);
    expect((await call()).rows).toHaveLength(1);
    mockPages([pageS1(s1({ lastSaleDate: '2026-07-28' }))]);
    expect((await call()).rows).toEqual([]);
  });

  it.each([
    ['ausente', undefined],
    ['null', null],
    ['string vacío', '   '],
    ['no parseable', 'ayer por la tarde'],
    ['objeto', { date: '2026-08-20' }],
    ['booleano', true],
  ])('evidencia %s ⇒ NO se escribe: «desconocido» NO es «fresco» (fail-closed)', async (_n, value) => {
    mockPages([pageS1({ count: 7, medianPrice: 60, ...(value === undefined ? {} : { lastSaleDate: value }) })]);
    const res = await call();
    expect(res.rows).toEqual([]);
    expect(res.drops).toEqual([expect.objectContaining({ reason: 'evidence_unknown' })]);
    // La traza nombra el CAMPO buscado: es lo que permite descubrir el nombre real sin adivinar (P-6).
    expect(res.drops[0].sample).toContain('lastSaleDate');
  });

  it('acepta ISO-8601 completo y epoch en ms (el proveedor no promete un solo formato)', async () => {
    mockPages([pageS1(s1({ lastSaleDate: '2026-08-20T13:45:00.000Z' }))]);
    expect((await call()).rows[0].evidenceDate).toBe('2026-08-20');
    mockPages([pageS1(s1({ lastSaleDate: Date.UTC(2026, 7, 20) }))]);
    expect((await call()).rows[0].evidenceDate).toBe('2026-08-20');
  });

  it('el NOMBRE del campo es un dial de operador (`_GRADED_EVIDENCE_FIELD`), no un alias adivinado', async () => {
    // P-6: no se sondean alias a ciegas — un nombre inventado que casualmente contenga una fecha
    // abriría justo la puerta que este gate cierra. Si PPT lo llama distinto, se corrige SIN deploy.
    mockPages([pageS1({ count: 7, medianPrice: 60, ultimaVenta: EVIDENCIA_FRESCA })]);
    expect((await call()).drops[0].reason).toBe('evidence_unknown');

    mockPages([pageS1({ count: 7, medianPrice: 60, ultimaVenta: EVIDENCIA_FRESCA })]);
    const p = provider(cfg({ POKEMONPRICETRACKER_GRADED_EVIDENCE_FIELD: 'ultimaVenta' }));
    expect((await call(p)).rows).toHaveLength(1);
  });

  it('el gate de evidencia es INDEPENDIENTE del de muestra: pasar uno no exime del otro', async () => {
    // Muestra suficiente + evidencia vieja ⇒ se cae por evidencia (no «ya pasó un gate, adelante»).
    mockPages([pageS1(s1({ count: 99, lastSaleDate: EVIDENCIA_VIEJA }))]);
    expect((await call()).drops[0].reason).toBe('evidence_too_old');
    // Muestra baja + evidencia fresca ⇒ se cae por muestra. El orden de evaluación no cambia el veredicto.
    mockPages([pageS1(s1({ count: 1 }))]);
    expect((await call()).drops[0].reason).toBe('sample_too_small');
  });
});

describe('§4.38h — cuota, moneda y ESCALADA (regla 9)', () => {
  it('pide `includeEbay=true` JUNTO a `fetchAllInSet=true` (el modelo de coste del barrido por set)', async () => {
    const spy = mockPages([pageS1(s1())]);
    await call();
    const url = String((spy.mock.calls[0] as unknown[])[0]);
    expect(url).toContain('includeEbay=true');
    expect(url).toContain('fetchAllInSet=true');
    expect(url).toContain('setId=sv8');
    // La API key va en el header, JAMÁS en la URL ni en el log (§4.15). Se comprueba con una clave
    // distintiva para que la aserción no sea trivialmente cierta por ser 'k' una letra común.
    const conClaveVisible = mockPages([pageS1(s1())]);
    await call(provider(cfg({ POKEMONPRICETRACKER_API_KEY: 'SUPER-SECRETO-123' })));
    expect(String((conClaveVisible.mock.calls[0] as unknown[])[0])).not.toContain('SUPER-SECRETO-123');
  });

  it('SIN formato de moneda explícito ⇒ SAMPLE-ONLY: no se persiste nada (fail-closed de dinero)', async () => {
    mockPages([pageS1(s1())]);
    const res = await call(provider(cfg({ POKEMONPRICETRACKER_MARKET_FORMAT: undefined })));
    expect(res.rows).toEqual([]);
  });

  it('sin `pptSetId` NO se pide nada (jamás se cae al `externalId`, que PPT no reconoce)', async () => {
    const spy = mockPages([pageS1(s1())]);
    const res = await provider().fetchGradedEstimatesForSet({
      set: SET,
      providerSetId: null,
      grades: ['10'],
      minSampleCount: 3,
      sourceStat: 'median',
      freshnessDays: FRESHNESS_DAYS,
      today: TODAY,
    });
    expect(res.rows).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  /**
   * ⛔ **La escalada del arquitecto, implementada como comportamiento y no como comentario.** Si
   * `includeEbay=true` no combina con `fetchAllInSet=true`, el modelo pasa a **una petición por carta**
   * (2 créditos × carta) e invalida el barrido por set: eso obliga a un ingest **curado por lista**,
   * que es decisión de **arquitectura y de costo**. El provider **no lo fuerza**: reporta y para.
   */
  it('si el proveedor RECHAZA la combinación (4xx) ⇒ escala, y NO cae a «una petición por carta»', async () => {
    const spy = jest.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'includeEbay is not supported with fetchAllInSet' }),
      text: async () => 'includeEbay is not supported with fetchAllInSet',
    }));
    global.fetch = spy as unknown as typeof fetch;
    const res = await call();
    expect(res.escalate).toMatchObject({ reason: 'ebay_not_supported_with_set_sweep' });
    expect(res.rows).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(1); // una sola petición: NO se reintenta por carta
  });

  /**
   * v1.50.2 (techlead) — **la escalada tiene que poder sostener su veredicto.**
   *
   * El predicado era «cualquier 4xx distinto de 429», así que un **401/403** (clave mala, vencida o sin
   * el plan de eBay) y un **404** (`pptSetId` cacheado que ya no existe) llegaban al arquitecto como
   * «el proveedor no admite el parámetro». Ese veredicto dispara un rediseño de arquitectura y de
   * presupuesto —el ingest curado por lista, 2 créditos × carta— que en esos tres casos **no hacía
   * falta**: lo que había que hacer era rotar la clave o re-mapear el set.
   *
   * Cada uno vuelve a lo que era: un **fallo de request normal** (no se escribe nada, los estimados
   * previos quedan intactos, la corrida sigue con los demás sets).
   */
  it.each([401, 403, 404])('un HTTP %i NO es «no admite el parámetro»: fallo normal, SIN escalada', async (status) => {
    const spy = jest.fn(async () => ({
      ok: false,
      status,
      json: async () => ({ error: 'nope' }),
      text: async () => 'nope',
    }));
    global.fetch = spy as unknown as typeof fetch;
    const res = await call();
    expect(res.escalate).toBeNull();
    expect(res.requestOk).toBe(false);
    // Money-safe intacto: sin escalada tampoco se escribe nada por este camino.
    expect(res.rows).toEqual([]);
  });

  it('un 400/422 SÍ escala: ahí el proveedor está rechazando la COMBINACIÓN de parámetros', async () => {
    for (const status of [400, 422]) {
      global.fetch = jest.fn(async () => ({
        ok: false,
        status,
        json: async () => ({ error: 'includeEbay is not supported with fetchAllInSet' }),
        text: async () => 'includeEbay is not supported with fetchAllInSet',
      })) as unknown as typeof fetch;
      const res = await call();
      expect(res.escalate).toMatchObject({ reason: 'ebay_not_supported_with_set_sweep' });
    }
  });

  it('si el request PASA pero NINGUNA entrada trae bloque PSA ⇒ escala con la muestra cruda', async () => {
    // No podemos distinguir «este set no tiene ventas PSA» de «el proveedor IGNORÓ includeEbay», y
    // adivinar entre esas dos es exactamente lo que P-6 prohíbe ⇒ lo resuelve un humano, con la
    // muestra delante, y mientras tanto NO se escribe nada por este camino.
    mockPages([{ data: [{ id: 'sv8-104', cardNumber: '104', prices: { market: 12 } }], total: 1, hasMore: false }]);
    const res = await call();
    expect(res.escalate).toMatchObject({ reason: 'no_graded_block_in_response' });
    expect(res.escalate!.detail).toContain('sv8');
    expect(res.rows).toEqual([]);
  });

  /**
   * §4.38h.1 — el truncado de la muestra pasó de **800 a 4000**. No es cosmético: con 800 el bloque
   * PSA queda **cortado** y el diagnóstico produce un **falso negativo** («el proveedor no manda PSA»
   * cuando sí lo manda). Es el mismo dato con el que se confirma el shape en la primera corrida.
   */
  it('la muestra cruda NO se corta a 800 chars: el bloque PSA tiene que caber entero', async () => {
    const relleno = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`campoLargoDeRelleno${i}`, 'x'.repeat(20)]),
    );
    const page = {
      data: [
        {
          id: 'sv8-104',
          cardNumber: '104',
          ...relleno, // empuja el bloque PSA más allá del carácter 800
          ebay: { salesByGrade: { psa10: { count: 1, medianPrice: 60 } } },
        },
      ],
      total: 1,
      hasMore: false,
    };
    expect(JSON.stringify(page.data[0]).indexOf('salesByGrade')).toBeGreaterThan(800);
    mockPages([page]);
    const res = await call();
    // Descartada por muestra insuficiente (count 1 < 3), pero la TRAZA conserva el bloque PSA entero.
    expect(res.drops[0].sample).toContain('medianPrice');
  });
});

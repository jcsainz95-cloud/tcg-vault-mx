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
  });

describe('§4.38h.1 — S1 `ebay.salesByGrade.psaN` (objeto): se escribe SOLO con identificación positiva', () => {
  it('objeto con `medianPrice` y `count` suficiente ⇒ UNA fila, en USD (INV-FX: la unidad no se pierde)', async () => {
    mockPages([pageS1({ count: 7, medianPrice: 60, averagePrice: 95, smartMarketPrice: 71 })]);
    const res = await call();
    expect(res.rows).toEqual([
      {
        externalId: 'sv8-104',
        number: '104',
        gradeValue: '10',
        amountCents: 6_000, // 60 USD → 6000 centavos de DÓLAR, no de peso
        currency: 'USD',
        count: 7,
        source: 'pokemonpricetracker',
      },
    ]);
  });

  it('se publica la MEDIANA, no el promedio (una venta atípica desplaza el promedio)', async () => {
    mockPages([pageS1({ count: 7, medianPrice: 60, averagePrice: 95, smartMarketPrice: 71 })]);
    const res = await call();
    expect(res.rows[0].amountCents).toBe(6_000); // 60 (mediana), NO 95 (promedio) ni 71 (smart)
  });

  it('el dial `sourceStat` cambia el campo leído sin tocar código (`average`)', async () => {
    mockPages([pageS1({ count: 7, medianPrice: 60, averagePrice: 95 })]);
    const res = await provider().fetchGradedEstimatesForSet({
      set: SET,
      providerSetId: 'sv8',
      grades: ['10'],
      minSampleCount: 3,
      sourceStat: 'average',
    });
    expect(res.rows[0].amountCents).toBe(9_500);
  });

  it('los grados son INDEPENDIENTES: PSA 10 válido + PSA 9 con muestra baja ⇒ solo PSA 10', async () => {
    mockPages([pageS1({ count: 7, medianPrice: 60 }, { count: 1, medianPrice: 30 })]);
    const res = await call();
    expect(res.rows.map((r) => r.gradeValue)).toEqual(['10']);
    expect(res.drops).toEqual([
      expect.objectContaining({ reason: 'sample_too_small', count: 1 }),
    ]);
  });
});

describe('§4.38h.1 — el gate de ORIGEN CONFIABLE se aplica AL ESCRIBIR (§4.38k.1)', () => {
  it('`count` por debajo de `minSampleCount` ⇒ NO se escribe, y queda TRAZA con la muestra', async () => {
    mockPages([pageS1({ count: 2, medianPrice: 60 })]);
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
    expect(res.rows).toEqual([
      expect.objectContaining({ gradeValue: '10', amountCents: 6_000, count: null, currency: 'USD' }),
    ]);
  });
});

describe('§4.38h.1 — ante CUALQUIER OTRA FORMA: cero escrituras + muestra cruda', () => {
  it.each([
    ['array', [60]],
    ['string', '60'],
    ['null', null],
    ['objeto desconocido', { precio: 60 }],
    ['NaN', { count: 7, medianPrice: Number.NaN }],
    ['negativo', { count: 7, medianPrice: -60 }],
    ['cero', { count: 7, medianPrice: 0 }],
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
    mockPages([pageS1({ count: 7, medianPrice: 60 })]);
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
    mockPages([pageS1({ count: 7, medianPrice: 60, smartMarketPrice: 71 })]);
    const res = await call(provider(cfg({ POKEMONPRICETRACKER_GRADED_FIELD: 'smartMarketPrice' })));
    expect(res.rows[0].amountCents).toBe(7_100);
  });
});

describe('§4.38h — cuota, moneda y ESCALADA (regla 9)', () => {
  it('pide `includeEbay=true` JUNTO a `fetchAllInSet=true` (el modelo de coste del barrido por set)', async () => {
    const spy = mockPages([pageS1({ count: 7, medianPrice: 60 })]);
    await call();
    const url = String((spy.mock.calls[0] as unknown[])[0]);
    expect(url).toContain('includeEbay=true');
    expect(url).toContain('fetchAllInSet=true');
    expect(url).toContain('setId=sv8');
    // La API key va en el header, JAMÁS en la URL ni en el log (§4.15). Se comprueba con una clave
    // distintiva para que la aserción no sea trivialmente cierta por ser 'k' una letra común.
    const conClaveVisible = mockPages([pageS1({ count: 7, medianPrice: 60 })]);
    await call(provider(cfg({ POKEMONPRICETRACKER_API_KEY: 'SUPER-SECRETO-123' })));
    expect(String((conClaveVisible.mock.calls[0] as unknown[])[0])).not.toContain('SUPER-SECRETO-123');
  });

  it('SIN formato de moneda explícito ⇒ SAMPLE-ONLY: no se persiste nada (fail-closed de dinero)', async () => {
    mockPages([pageS1({ count: 7, medianPrice: 60 })]);
    const res = await call(provider(cfg({ POKEMONPRICETRACKER_MARKET_FORMAT: undefined })));
    expect(res.rows).toEqual([]);
  });

  it('sin `pptSetId` NO se pide nada (jamás se cae al `externalId`, que PPT no reconoce)', async () => {
    const spy = mockPages([pageS1({ count: 7, medianPrice: 60 })]);
    const res = await provider().fetchGradedEstimatesForSet({
      set: SET,
      providerSetId: null,
      grades: ['10'],
      minSampleCount: 3,
      sourceStat: 'median',
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

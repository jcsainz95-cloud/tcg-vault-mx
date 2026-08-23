import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { SettingKey } from '../src/modules/settings/settings.constants';

/**
 * v1.44-graded-estimate — COMPOSICIÓN del gancho en el storefront (ARCHITECTURE §4.35-0/c/e/f,
 * API_CONTRACT §2). Se cablean los servicios REALES (Settings + Pricing + Catalog) sobre un Prisma en
 * memoria, para que lo que se prueba sea la ruta de request completa y no un mock de la decisión.
 *
 * La partición que gobierna todo: **INFORMAR ≠ PROMOVER**.
 *   - ficha  → `gradedEstimates`  (nivel CARTA, SIN gate)
 *   - teja/vitrina → `gradingHighlight` (nivel GRUPO, CON gate de curaduría)
 */

const TODAY = new Date();
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
/** Fecha reciente en UTC: siempre dentro de la ventana de frescura (30 días). */
const RECENT = new Date(TODAY.getTime() - 2 * 86_400_000);
const OLD = new Date(TODAY.getTime() - 120 * 86_400_000);

// ---------------------------------------------------------------- Prisma en memoria

function matchWhere(row: any, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (k === 'OR') {
      if (!(v as any[]).some((sub) => matchWhere(row, sub))) return false;
      continue;
    }
    if (k === 'AND') {
      if (!(v as any[]).every((sub) => matchWhere(row, sub))) return false;
      continue;
    }
    if (k === 'cardProduct') {
      if (row.cardProductId == null) return false; // fila genérica: no es de un CardProduct
      continue;
    }
    const rv = (row as Record<string, unknown>)[k];
    if (v === null) {
      if (rv != null) return false;
      continue;
    }
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if ('in' in o) {
        if (!(o.in as unknown[]).includes(rv)) return false;
        continue;
      }
      if ('gt' in o) {
        if (!(typeof rv === 'number' && rv > (o.gt as number))) return false;
        continue;
      }
      if ('not' in o) {
        if (rv === o.not) return false;
        continue;
      }
      return false;
    }
    if (rv !== v) return false;
  }
  return true;
}

function card(id: string, over: Partial<any> = {}) {
  return {
    id,
    externalId: `sv8-${id}`,
    name: `Card ${id}`,
    number: '1',
    numberSort: 1,
    numberPrefix: '',
    rarity: 'Illustration Rare',
    rarityCanonical: 'Illustration Rare',
    supertype: 'Pokémon',
    subtypes: [],
    setId: 's1',
    imageSmallUrl: null,
    imageLargeUrl: null,
    availableFinishes: ['normal'],
    set: { id: 's1', name: 'Surging Sparks', releaseDate: '2024/11/08' },
    ...over,
  };
}

function item(id: string, cardId: string, over: Partial<any> = {}) {
  return {
    id,
    cardId,
    productType: 'raw',
    rawCondition: 'NM',
    sealedSubtype: null,
    sealedCondition: null,
    gradingCompany: null,
    gradeValue: null,
    certNumber: null,
    status: 'listed',
    ownerType: 'platform',
    finish: 'normal',
    tcgplayerProductId: null,
    listPriceCents: 100_000, // MX$1,000 — override manual por pieza (precio determinista)
    createdAt: new Date('2026-08-01'),
    card: card(cardId),
    ...over,
  };
}

function psaRef(cardId: string, gradeValue: '10' | '9', mxnCents: number, capturedDate = RECENT, over: Partial<any> = {}) {
  return {
    cardId,
    productType: 'graded',
    gradeKey: `graded:PSA:${gradeValue}`,
    finish: 'normal',
    priceMxnCents: mxnCents,
    priceUsdCents: null,
    isManualOverride: true,
    source: 'manual',
    capturedDate,
    cardProductId: null,
    ...over,
  };
}

function wire(items: any[], refs: any[], config: Record<string, unknown> = {}) {
  const configStore = new Map<string, unknown>(Object.entries(config));
  const priceRefFindMany = jest.fn(async (args: any) => refs.filter((r) => matchWhere(r, args.where)));
  const invFindMany = jest.fn(async (args: any) => items.filter((i) => matchWhere(i, args.where)));
  const prisma = {
    configSetting: {
      findUnique: jest.fn(async ({ where: { key } }: any) =>
        configStore.has(key) ? { key, valueJson: configStore.get(key) } : null,
      ),
      upsert: jest.fn(async ({ where: { key }, create, update }: any) => {
        configStore.set(key, configStore.has(key) ? update.valueJson : create.valueJson);
        return { key };
      }),
    },
    priceReference: { findMany: priceRefFindMany },
    variantPriceOverride: { findMany: jest.fn(async () => []) },
    inventoryItem: { findMany: invFindMany },
    card: {
      findUnique: jest.fn(async ({ where }: any) => items.find((i) => i.cardId === where.id)?.card ?? null),
    },
    cardSet: { findUnique: jest.fn(async () => null), findMany: jest.fn(async () => []) },
  } as unknown as PrismaService;
  const settings = new SettingsService(prisma);
  const fx = { getCurrent: jest.fn(async () => null) } as unknown as FxService;
  const pricing = new PricingService(prisma, settings, fx, {} as any, {} as any, {} as any);
  const catalog = new CatalogService(prisma, pricing);
  return { catalog, pricing, prisma, priceRefFindMany, configStore };
}

/** Dial maestro ENCENDIDO (en producción arranca en `off`, seed fail-closed). */
const ON = { [SettingKey.GRADED_ESTIMATES_ENABLED]: 'on' };

// ---------------------------------------------------------------- Escenarios

// Carta A: raw a MX$1,000 con PSA 10 = MX$9,000 y PSA 9 = MX$5,000.
//   escalón [500k,1M) ⇒ costo MX$1,800 ; umbral = ceil((100000+180000)×1.30) = 364000 ; 500000 >= 364000
//   ⇒ PASA el gate (ficha + teja + vitrina).
const A_ITEMS = [item('ia', 'ca')];
const A_REFS = [psaRef('ca', '10', 900_000), psaRef('ca', '9', 500_000)];

describe('Ficha vs teja — la partición INFORMAR ≠ PROMOVER (§4.35-0)', () => {
  it('camino feliz: la ficha trae PSA 10 y PSA 9; la teja trae SOLO el grado del badge', async () => {
    const { catalog } = wire(A_ITEMS, A_REFS, ON);
    const ficha: any = await catalog.getCard('ca');

    expect(ficha.gradedEstimates).toHaveLength(2);
    expect(ficha.gradedEstimates.map((e: any) => e.gradeValue)).toEqual(['10', '9']); // PSA 10 primero
    expect(ficha.gradedEstimates[0]).toEqual({
      gradingCompany: 'PSA',
      gradeValue: '10',
      gradeKey: 'graded:PSA:10',
      estimate: { status: 'priced', referenceMxnCents: 900_000, capturedDate: isoDay(RECENT) },
    });
    // El grupo de la MISMA respuesta trae su `gradingHighlight` (gateado) — son campos distintos.
    expect(ficha.listings[0].gradingHighlight).toHaveLength(1);
    expect(ficha.listings[0].gradingHighlight[0].gradeValue).toBe('10');

    const list: any = await catalog.listCards({ page: 1, pageSize: 20 });
    expect(list.data[0].gradingHighlight[0].estimate.referenceMxnCents).toBe(900_000);
  });

  it('NO pasa el gate (upside insuficiente) ⇒ la FICHA muestra las dos cifras y la TEJA no muestra nada', async () => {
    const refs = [psaRef('ca', '10', 900_000), psaRef('ca', '9', 300_000)]; // 300000 < umbral 364000
    const { catalog } = wire(A_ITEMS, refs, ON);

    const ficha: any = await catalog.getCard('ca');
    expect(ficha.gradedEstimates.map((e: any) => e.gradeValue)).toEqual(['10', '9']);
    expect('gradingHighlight' in ficha.listings[0]).toBe(false); // presencia ⇔ elegibilidad

    const list: any = await catalog.listCards({ page: 1, pageSize: 20 });
    expect('gradingHighlight' in list.data[0]).toBe(false);
  });

  it('criterio 80 — con PSA 10 y SIN PSA 9: ficha SÍ (una cifra), destacado NO', async () => {
    const { catalog } = wire(A_ITEMS, [psaRef('ca', '10', 900_000)], ON);
    const ficha: any = await catalog.getCard('ca');
    expect(ficha.gradedEstimates).toHaveLength(1);
    expect('gradingHighlight' in ficha.listings[0]).toBe(false);
  });

  it('sin ningún estimado ⇒ AMBOS campos se OMITEN (nunca `[]`, nunca $0, nunca «pendiente»)', async () => {
    const { catalog } = wire(A_ITEMS, [], ON);
    const ficha: any = await catalog.getCard('ca');
    expect('gradedEstimates' in ficha).toBe(false);
    expect('gradingHighlight' in ficha.listings[0]).toBe(false);
    const list: any = await catalog.listCards({ page: 1, pageSize: 20 });
    expect('gradingHighlight' in list.data[0]).toBe(false);
  });

  it('un estimado RANCIO no se dibuja ni informa (ventana de frescura, dial seed 30 días)', async () => {
    const refs = [psaRef('ca', '10', 900_000, OLD), psaRef('ca', '9', 500_000, OLD)];
    const { catalog } = wire(A_ITEMS, refs, ON);
    const ficha: any = await catalog.getCard('ca');
    expect('gradedEstimates' in ficha).toBe(false);
    expect('gradingHighlight' in ficha.listings[0]).toBe(false);
  });

  it('criterio 87 — un grupo GRADEADO nunca trae el gancho, y su ficha no trae `gradedEstimates`', async () => {
    const slab = item('ig', 'ca', {
      productType: 'graded',
      rawCondition: null,
      gradingCompany: 'PSA',
      gradeValue: '10',
      certNumber: '123',
      listPriceCents: 900_000,
    });
    const { catalog } = wire([slab], A_REFS, ON);
    const ficha: any = await catalog.getCard('ca');
    expect(ficha.listings[0].productType).toBe('graded');
    expect('gradingHighlight' in ficha.listings[0]).toBe(false);
    // Sin ningún grupo RAW publicado la ficha NO expone estimados (aunque el dato exista).
    expect('gradedEstimates' in ficha).toBe(false);
  });

  it('§4.35a — dos acabados publicados: MISMAS cifras en la ficha, gate POR GRUPO en la teja', async () => {
    // `normal` a MX$1,000 (pasa) y `reverse_holo` a MX$30,000 (el umbral se le va muy arriba: no pasa).
    const items = [
      item('i-normal', 'ca', { finish: 'normal' }),
      item('i-rh', 'ca', { finish: 'reverse_holo', listPriceCents: 3_000_000, id: 'i-rh' }),
    ];
    const { catalog } = wire(items, A_REFS, ON);
    const ficha: any = await catalog.getCard('ca');

    // El estimado es de la CARTA: la ficha muestra UN solo par de cifras.
    expect(ficha.gradedEstimates).toHaveLength(2);
    const byFinish = Object.fromEntries(ficha.listings.map((l: any) => [l.finish, l]));
    expect('gradingHighlight' in byFinish['normal']).toBe(true);
    expect('gradingHighlight' in byFinish['reverse_holo']).toBe(false);
  });
});

describe('SEC-A1 — el cliente no recibe NINGÚN insumo del cálculo (§4.35e)', () => {
  it('el JSON público no contiene multiplier / upside / costo / umbral / minUpsidePct / eligible / source', async () => {
    const { catalog } = wire(A_ITEMS, A_REFS, ON);
    const json = JSON.stringify([await catalog.getCard('ca'), await catalog.listCards({ page: 1, pageSize: 20 })]);
    for (const forbidden of [
      'multiplier',
      'upsideMxnCents',
      'netUpside',
      'gradingCost',
      'minUpsidePct',
      'threshold',
      'eligible',
      'reason',
      'isManualOverride',
      '"source"',
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });
});

describe('INDISTINGUIBILIDAD fase 1 ⇄ fase 2 (§4.35g) — el criterio de éxito', () => {
  it('la MISMA clave escrita como `manual` y como `pokemonpricetracker` produce un JSON IDÉNTICO', async () => {
    const manual = [
      psaRef('ca', '10', 900_000, RECENT, { source: 'manual', isManualOverride: true }),
      psaRef('ca', '9', 500_000, RECENT, { source: 'manual', isManualOverride: true }),
    ];
    const ingest = [
      psaRef('ca', '10', 900_000, RECENT, { source: 'pokemonpricetracker', isManualOverride: false }),
      psaRef('ca', '9', 500_000, RECENT, { source: 'pokemonpricetracker', isManualOverride: false }),
    ];
    const fase1 = wire(A_ITEMS, manual, ON);
    const fase2 = wire(A_ITEMS, ingest, ON);

    const jsonFicha1 = JSON.stringify(await fase1.catalog.getCard('ca'));
    const jsonFicha2 = JSON.stringify(await fase2.catalog.getCard('ca'));
    expect(jsonFicha1).toEqual(jsonFicha2); // byte a byte

    const jsonList1 = JSON.stringify(await fase1.catalog.listCards({ page: 1, pageSize: 20 }));
    const jsonList2 = JSON.stringify(await fase2.catalog.listCards({ page: 1, pageSize: 20 }));
    expect(jsonList1).toEqual(jsonList2);
  });
});

describe('Dial maestro `gradedEstimatesEnabled` (seed `off`, fail-closed) — §M10', () => {
  it('con `off` no se emite NINGUNO de los dos campos y NO se consulta la tabla de estimados', async () => {
    const { catalog, priceRefFindMany } = wire(A_ITEMS, A_REFS); // sin ON: el seed manda (off)
    const ficha: any = await catalog.getCard('ca');
    expect('gradedEstimates' in ficha).toBe(false);
    expect('gradingHighlight' in ficha.listings[0]).toBe(false);
    // Ni una sola query con la clave del gancho (el backend «ni siquiera evalúa nada»).
    const gradedQueries = priceRefFindMany.mock.calls.filter((c: any) => c[0]?.where?.productType === 'graded');
    expect(gradedQueries).toHaveLength(0);
  });

  it('con `off`, `?gradingHighlight=true` devuelve `{ data: [], total: 0 }` — no es un error', async () => {
    const { catalog } = wire(A_ITEMS, A_REFS);
    const res = await catalog.listCards({ page: 1, pageSize: 20, gradingHighlight: 'true' });
    expect(res).toMatchObject({ data: [], total: 0 });
  });

  it('criterio 90 — encender/apagar la feature NO cambia NINGÚN precio de venta ni la valuación', async () => {
    const off: any = await wire(A_ITEMS, A_REFS).catalog.listCards({ page: 1, pageSize: 20 });
    const on: any = await wire(A_ITEMS, A_REFS, ON).catalog.listCards({ page: 1, pageSize: 20 });
    const strip = (g: any) => {
      const { gradingHighlight: _ignored, ...rest } = g;
      return rest;
    };
    expect(on.data.map(strip)).toEqual(off.data.map(strip));
    expect(on.data[0].salePriceCents).toBe(100_000);
    expect(on.data[0].gradingHighlight).toBeDefined(); // …y el gancho SÍ apareció con el dial on
  });
});

describe('Doctrina (b) — las filas PSA son INFORMATIVAS (§4.35b)', () => {
  it('no entran en la evidencia de acabados (`displayFinishes`) ni convierten el grupo en graded', async () => {
    const { catalog, priceRefFindMany } = wire(A_ITEMS, A_REFS, ON);
    const ficha: any = await catalog.getCard('ca');
    expect(ficha.card.displayFinishes).toEqual(['normal']);
    expect(ficha.listings[0].productType).toBe('raw'); // el productType lo fija la pieza física
    expect(ficha.listings[0].stockCount).toBe(1); // los estimados no cuentan como stock
    // La query de evidencia de acabados sigue acotada a `raw`/`raw:NM` (jamás ve las filas PSA).
    const finishQuery = priceRefFindMany.mock.calls.find((c: any) => c[0]?.distinct != null);
    expect(finishQuery?.[0].where).toMatchObject({ productType: 'raw', gradeKey: 'raw:NM' });
  });

  it('no fijan el precio de venta ni la referencia de mercado del grupo raw', async () => {
    const { catalog } = wire(A_ITEMS, A_REFS, ON);
    const list: any = await catalog.listCards({ page: 1, pageSize: 20 });
    expect(list.data[0].salePriceCents).toBe(100_000); // el override manual por pieza, no los MX$9,000
    expect(list.data[0].referenceValue.status).toBe('pending'); // no hay `raw:NM`: sigue pendiente
  });
});

describe('Vitrina «Joyas para gradear» — `GET /catalog/cards` filtrado (§4.35f)', () => {
  // Tres cartas destacables con ganancia neta creciente + una que no pasa el gate.
  const items = [
    item('i1', 'c1'),
    item('i2', 'c2'),
    item('i3', 'c3'),
    item('i4', 'c4'),
  ];
  const refs = [
    psaRef('c1', '10', 900_000), psaRef('c1', '9', 500_000), // neta = 220000
    psaRef('c2', '10', 900_000), psaRef('c2', '9', 800_000), // neta = 520000
    psaRef('c3', '10', 900_000), psaRef('c3', '9', 400_000), // neta = 120000
    psaRef('c4', '10', 900_000), psaRef('c4', '9', 300_000), // NO pasa el gate
  ];

  it('`?gradingHighlight=true` devuelve SOLO los grupos destacados', async () => {
    const { catalog } = wire(items, refs, ON);
    const res: any = await catalog.listCards({ page: 1, pageSize: 20, gradingHighlight: 'true' });
    expect(res.data.map((g: any) => g.card.id).sort()).toEqual(['c1', 'c2', 'c3']);
    expect(res.total).toBe(3);
    expect(res.data.every((g: any) => g.gradingHighlight != null)).toBe(true);
  });

  it('`sort=grading_showcase` ordena por GANANCIA NETA sobre PSA 9 (desc), sin exponer la clave', async () => {
    const { catalog } = wire(items, refs, ON);
    const res: any = await catalog.listCards({
      page: 1,
      pageSize: 8,
      gradingHighlight: 'true',
      sort: 'grading_showcase',
    });
    expect(res.data.map((g: any) => g.card.id)).toEqual(['c2', 'c1', 'c3']);
    expect(JSON.stringify(res)).not.toContain('netUpside');
  });

  it('`sort=grading_showcase` SIN el filtro ⇒ 400 GRADING_SORT_REQUIRES_FILTER (fail-closed)', async () => {
    const { catalog, prisma } = wire(items, refs, ON);
    await expect(
      catalog.listCards({ page: 1, pageSize: 8, sort: 'grading_showcase' }),
    ).rejects.toMatchObject({ code: 'GRADING_SORT_REQUIRES_FILTER' });
    // Se rechaza ANTES de tocar la base (un sort inválido no cuesta una lectura).
    expect((prisma as any).inventoryItem.findMany).not.toHaveBeenCalled();
  });

  it('`?gradingHighlight=false` (o cualquier otro valor) ⇒ 400 VALIDATION_ERROR', async () => {
    const { catalog } = wire(items, refs, ON);
    for (const value of ['false', '1', 'yes']) {
      await expect(
        catalog.listCards({ page: 1, pageSize: 8, gradingHighlight: value }),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    }
  });

  it('sin cartas elegibles ⇒ `{ data: [], total: 0 }` (la señal de «no renderizar la vitrina»)', async () => {
    const { catalog } = wire([item('i4', 'c4')], [psaRef('c4', '10', 900_000), psaRef('c4', '9', 300_000)], ON);
    const res: any = await catalog.listCards({ page: 1, pageSize: 8, gradingHighlight: 'true' });
    expect(res).toMatchObject({ data: [], total: 0 });
  });

  it('el listado normal (sin filtro) NO cambia de forma: siguen todos los grupos', async () => {
    const { catalog } = wire(items, refs, ON);
    const res: any = await catalog.listCards({ page: 1, pageSize: 20 });
    expect(res.total).toBe(4);
  });

  it('SIN N+1: el gancho añade UNA sola query de estimados, sea cual sea el nº de grupos', async () => {
    const { catalog, priceRefFindMany } = wire(items, refs, ON);
    await catalog.listCards({ page: 1, pageSize: 20 });
    const gradedQueries = priceRefFindMany.mock.calls.filter((c: any) => c[0]?.where?.productType === 'graded');
    expect(gradedQueries).toHaveLength(1);
    expect(gradedQueries[0][0].where.cardId).toEqual({ in: ['c1', 'c2', 'c3', 'c4'] });
  });
});

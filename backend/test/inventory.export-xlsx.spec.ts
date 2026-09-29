import * as ExcelJS from 'exceljs';
import {
  InventoryService,
  INVENTORY_EXPORT_COLUMNS,
} from '../src/modules/inventory/inventory.service';
import { InventoryController } from '../src/modules/inventory/inventory.controller';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';

/**
 * P-31 — export de inventario a Excel (GET /admin/inventory/export.xlsx):
 *  - genera un .xlsx REAL (firma ZIP `PK`) re-abrible por ExcelJS, con las columnas esperadas;
 *  - una fila por PIEZA/folio (modelo folio-por-pieza);
 *  - money-safe: sin precio → celda VACÍA (nunca 0); con precio → valor MXN;
 *  - respeta los filtros opcionales setId/productType (where a la query);
 *  - el controller manda Content-Type xlsx + Content-Disposition attachment.
 */

const settings = { getNumber: jest.fn(async () => 70) } as unknown as SettingsService;

/**
 * Doble de `PricingService` para el export.
 *
 * v1.80.2.2 (API_CONTRACT §M2-SK SK-5, errata «séptimo lector», ancla `M2-SK-5-7`; nota de fixture):
 * `valuationKeyFor` y `valuationCentsOf` se toman **del prototipo real** (con sus dos dependencias
 * puras, `tryGradeKeyFor` y `gateSealedMarketCents`) para que VK-8 mida la REGLA y no el doble; solo
 * se dobla la lectura de BD (`getReferencesBatch`, `loadSealedSpreads` con el `sourceOn` del caso).
 */
function buildPricing(refs: Map<string, any>, sourceOn = true): PricingService {
  return {
    getReferencesBatch: jest.fn(async () => refs),
    loadSealedSpreads: jest.fn(async () => ({ spreadPctBySubtype: {}, fallbackPct: 25, sourceOn })),
    tryGradeKeyFor: PricingService.prototype.tryGradeKeyFor,
    gateSealedMarketCents: PricingService.prototype.gateSealedMarketCents,
    valuationKeyFor: PricingService.prototype.valuationKeyFor,
    valuationCentsOf: PricingService.prototype.valuationCentsOf,
  } as unknown as PricingService;
}

/** Todas las peticiones (aplanadas) que el export mandó al lote de referencias. */
function batchRequests(pricing: PricingService): { cardId: string; gradeKey: string; finish: string }[] {
  return (pricing.getReferencesBatch as jest.Mock).mock.calls.flatMap((c: any[]) => c[0]);
}

const CARD = (over: any = {}) => ({
  name: 'Tropius',
  number: '7',
  rarity: 'Common',
  set: { name: 'Pitch Black' },
  ...over,
});

const ITEM = (over: any = {}) => ({
  id: 'i1',
  folio: 'INV-000001',
  cardId: 'c1',
  productType: 'raw',
  rawCondition: 'NM',
  sealedCondition: null,
  gradingCompany: null,
  gradeValue: null,
  certNumber: null,
  finish: 'normal',
  listPriceCents: null,
  acquisitionType: 'aportacion_en_especie',
  acquisitionCostCents: null,
  tcgplayerProductId: null,
  status: 'in_stock',
  location: { label: 'CAJA1/F1/S1' },
  card: CARD(),
  ...over,
});

/**
 * `existingSetIds`: por defecto (`null`) TODO `setId` se considera EXISTENTE (preserva los tests que
 * pasan un `setId` de filtro sin montar catálogo). Con un array, solo esos ids existen — el resto
 * hace que `cardSet.findUnique` devuelva `null` (H7: filtro `setId` desconocido → 400).
 */
function buildPrisma(items: any[], overrides: any[] = [], existingSetIds: string[] | null = null) {
  let lastFindWhere: any = null;
  const prisma: any = {
    inventoryItem: {
      findMany: jest.fn(async (args: any) => {
        lastFindWhere = args.where;
        return items;
      }),
    },
    variantPriceOverride: {
      findMany: jest.fn(async () => overrides),
    },
    // H7 (v1.36): el export valida el filtro `setId` contra CardSet antes de consultar.
    cardSet: {
      findUnique: jest.fn(async ({ where }: any) =>
        existingSetIds == null || existingSetIds.includes(where.id) ? { id: where.id } : null,
      ),
    },
    __lastFindWhere: () => lastFindWhere,
  };
  return prisma;
}

const colIndex = (key: string) =>
  INVENTORY_EXPORT_COLUMNS.findIndex((c) => c.key === key) + 1;

async function loadSheet(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return wb.getWorksheet('Inventario')!;
}

describe('InventoryService.exportInventoryXlsx — .xlsx válido y money-safe (P-31)', () => {
  it('genera un ZIP/.xlsx real con la fila de encabezados esperada', async () => {
    const prisma = buildPrisma([ITEM()]);
    const svc = new InventoryService(prisma as PrismaService, buildPricing(new Map()), settings);
    const buffer = await svc.exportInventoryXlsx({});
    // Firma de un archivo ZIP (contenedor OOXML .xlsx): bytes 'P' 'K' (0x50 0x4B).
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);

    const ws = await loadSheet(buffer);
    const headers = (ws.getRow(1).values as any[]).slice(1);
    expect(headers).toEqual(INVENTORY_EXPORT_COLUMNS.map((c) => c.header));
  });

  it('una fila por pieza con los datos de carta/set/estado; sin precio → celda vacía (no 0)', async () => {
    // Item raw SIN costo, SIN precio de venta y SIN referencia de mercado.
    const prisma = buildPrisma([ITEM()]);
    const svc = new InventoryService(prisma as PrismaService, buildPricing(new Map()), settings);
    const ws = await loadSheet(await svc.exportInventoryXlsx({}));

    expect(ws.rowCount).toBe(2); // encabezado + 1 pieza
    const row = ws.getRow(2);
    expect(row.getCell(colIndex('folio')).value).toBe('INV-000001');
    expect(row.getCell(colIndex('card')).value).toBe('Tropius');
    expect(row.getCell(colIndex('set')).value).toBe('Pitch Black');
    expect(row.getCell(colIndex('number')).value).toBe('7');
    expect(row.getCell(colIndex('finish')).value).toBe('normal');
    expect(row.getCell(colIndex('condition')).value).toBe('NM');
    expect(row.getCell(colIndex('status')).value).toBe('in_stock');
    expect(row.getCell(colIndex('quantity')).value).toBe(1);
    // MONEY-SAFE: sin dato → celda vacía (null/undefined), jamás 0 inventado.
    expect(row.getCell(colIndex('costMxn')).value == null).toBe(true);
    expect(row.getCell(colIndex('marketMxn')).value == null).toBe(true);
    expect(row.getCell(colIndex('sellMxn')).value == null).toBe(true);
    expect(row.getCell(colIndex('buyMxn')).value == null).toBe(true);
  });

  it('con precios STORED: mercado (PriceReference), venta (listPriceCents) y compra (buyOverride) en MXN', async () => {
    const refs = new Map<string, any>([
      ['c1|raw|raw:NM|normal', { status: 'priced', referenceMxnCents: 12345 }],
    ]);
    const prisma = buildPrisma(
      [ITEM({ listPriceCents: 5000, acquisitionCostCents: 3500 })],
      [
        {
          cardId: 'c1',
          productType: 'raw',
          gradeKey: 'raw:NM',
          finish: 'normal',
          buyOverrideCents: 2000,
          sellOverrideCents: null,
        },
      ],
    );
    const svc = new InventoryService(prisma as PrismaService, buildPricing(refs), settings);
    const ws = await loadSheet(await svc.exportInventoryXlsx({}));
    const row = ws.getRow(2);
    expect(row.getCell(colIndex('costMxn')).value).toBe(35);
    expect(row.getCell(colIndex('marketMxn')).value).toBe(123.45);
    expect(row.getCell(colIndex('buyMxn')).value).toBe(20);
    // venta = listPriceCents por pieza (gana sobre el override de venta).
    expect(row.getCell(colIndex('sellMxn')).value).toBe(50);
  });

  it('referencia PENDING no se exporta como precio → celda de mercado vacía (money-safe)', async () => {
    const refs = new Map<string, any>([['c1|raw|raw:NM|normal', { status: 'pending' }]]);
    const prisma = buildPrisma([ITEM()]);
    const svc = new InventoryService(prisma as PrismaService, buildPricing(refs), settings);
    const ws = await loadSheet(await svc.exportInventoryXlsx({}));
    expect(ws.getRow(2).getCell(colIndex('marketMxn')).value == null).toBe(true);
  });

  it('respeta el filtro productType y setId (where a la query, ownerType=platform siempre)', async () => {
    const prisma = buildPrisma([ITEM()]);
    const svc = new InventoryService(prisma as PrismaService, buildPricing(new Map()), settings);
    await svc.exportInventoryXlsx({ productType: 'sealed', setId: 'set-9' });
    expect(prisma.__lastFindWhere()).toMatchObject({
      ownerType: 'platform',
      productType: 'sealed',
      card: { setId: 'set-9' },
    });
  });

  // H7 (deuda saldada, v1.36): antes un `setId` inexistente devolvía export VACÍO en silencio.
  it('H7 · setId inexistente → 400 VALIDATION_ERROR (no export vacío en silencio)', async () => {
    const prisma = buildPrisma([ITEM()], [], ['set-real']); // solo 'set-real' existe
    const svc = new InventoryService(prisma as PrismaService, buildPricing(new Map()), settings);
    await expect(svc.exportInventoryXlsx({ setId: 'set-fantasma' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
    });
    // No llegó a consultar el inventario (falla temprano, paridad con publishAll/bulk-ops).
    expect(prisma.inventoryItem.findMany).not.toHaveBeenCalled();
  });

  it('H7 · setId EXISTENTE aplica el filtro y exporta normal', async () => {
    const prisma = buildPrisma([ITEM()], [], ['set-real']);
    const svc = new InventoryService(prisma as PrismaService, buildPricing(new Map()), settings);
    const ws = await loadSheet(await svc.exportInventoryXlsx({ setId: 'set-real' }));
    expect(ws.rowCount).toBe(2); // encabezado + 1 pieza
    expect(prisma.__lastFindWhere()).toMatchObject({ card: { setId: 'set-real' } });
  });

  // Candado de marca: el autor del .xlsx es la marca COMERCIAL 'TCG HUNT' (DESIGN_SYSTEM §17.4),
  // no el nombre interno del repo ('tcg-vault-mx' / 'TCG Vault MX'). H8 (v1.36) invirtió esta
  // aserción citando un PROJECT.md que tenía mal la marca; queda fijada en el sentido correcto.
  it('workbook.creator = «TCG HUNT» (marca comercial, no el nombre interno «TCG Vault MX»)', async () => {
    const prisma = buildPrisma([ITEM()]);
    const svc = new InventoryService(prisma as PrismaService, buildPricing(new Map()), settings);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await svc.exportInventoryXlsx({})) as unknown as ExcelJS.Buffer);
    expect(wb.creator).toBe('TCG HUNT');
    expect(wb.creator).not.toBe('TCG Vault MX');
  });

  it('graded: condición legible = empresa + grado; sellado usa clave de mercado por productId', async () => {
    const refs = new Map<string, any>([
      ['c2|sealed|sealed:tcg:999|normal', { status: 'priced', referenceMxnCents: 250000 }],
    ]);
    const prisma = buildPrisma([
      ITEM({
        id: 'g1',
        folio: 'INV-G1',
        productType: 'graded',
        rawCondition: null,
        gradingCompany: 'PSA',
        gradeValue: '10',
        certNumber: 'CERT-1',
        card: CARD({ name: 'Charizard' }),
      }),
      ITEM({
        id: 's1',
        cardId: 'c2',
        folio: 'INV-S1',
        productType: 'sealed',
        rawCondition: null,
        sealedCondition: 'mint',
        tcgplayerProductId: 999,
        card: CARD({ name: 'ETB' }),
      }),
    ]);
    const svc = new InventoryService(prisma as PrismaService, buildPricing(refs), settings);
    const ws = await loadSheet(await svc.exportInventoryXlsx({}));
    // graded en fila 2.
    expect(ws.getRow(2).getCell(colIndex('condition')).value).toBe('PSA 10');
    expect(ws.getRow(2).getCell(colIndex('certNumber')).value).toBe('CERT-1');
    // sellado en fila 3: mercado por clave sealed:tcg:<productId>.
    expect(ws.getRow(3).getCell(colIndex('condition')).value).toBe('mint');
    expect(ws.getRow(3).getCell(colIndex('marketMxn')).value).toBe(2500);
  });
});

/**
 * v1.80.2.2 — **VK-8: el export es el SÉPTIMO lector de patrimonio** (API_CONTRACT §M2-SK SK-5, errata
 * «séptimo lector», ancla `M2-SK-5-7`; ARCHITECTURE §4.50.6 D-SK-4). Valúa el sellado por la MISMA
 * puerta que los otros seis (`valuationKeyFor` + `valuationCentsOf`): sin mapeo ⇒ vacía (jamás la
 * fila legada `'sealed'`, que es de COLA y puede ser el precio de otra caja); mapeado ⇒ `sealed:tcg:<id>`
 * con acabado `normal` sea cual sea el `finish` de la pieza; y el gate del dial (`tcgcsv` solo con el
 * dial encendido; `manual` sobrevive). VK-8d (control) son los casos de arriba, que siguen verdes.
 */
describe('VK-8 · export .xlsx = séptimo lector de SK-5 (v1.80.2.2, MONEY)', () => {
  const SEALED_UNMAPPED = () =>
    ITEM({
      id: 's-unmapped',
      cardId: 'c3',
      folio: 'INV-S3',
      productType: 'sealed',
      rawCondition: null,
      sealedCondition: 'mint',
      tcgplayerProductId: null,
      listPriceCents: 1500,
      card: CARD({ name: 'Blíster sin mapeo' }),
    });
  const SEALED_MAPPED = (over: any = {}) =>
    ITEM({
      id: 's-mapped',
      cardId: 'c2',
      folio: 'INV-S2',
      productType: 'sealed',
      rawCondition: null,
      sealedCondition: 'mint',
      tcgplayerProductId: 999,
      card: CARD({ name: 'ETB' }),
      ...over,
    });

  it('VK-8a · sellado SIN mapeo + fila legada `sealed` priced 80000 ⇒ `Mercado` VACÍA y jamás se pide `gradeKey:"sealed"`; `Venta` = listPriceCents (SK-4)', async () => {
    const refs = new Map<string, any>([
      ['c3|sealed|sealed|normal', { status: 'priced', referenceMxnCents: 80000, source: 'manual' }],
    ]);
    const pricing = buildPricing(refs);
    const svc = new InventoryService(buildPrisma([SEALED_UNMAPPED()]) as PrismaService, pricing, settings);
    const ws = await loadSheet(await svc.exportInventoryXlsx({}));
    const row = ws.getRow(2);
    expect(row.getCell(colIndex('marketMxn')).value == null).toBe(true); // hoy: 800 (la caja de otro)
    expect(batchRequests(pricing).filter((r) => r.gradeKey === 'sealed')).toEqual([]);
    expect(row.getCell(colIndex('sellMxn')).value).toBe(15); // el precio de la pieza sigue saliendo
  });

  it('VK-8b · sellado MAPEADO con finish `holofoil` + ref bajo `normal` (manual 250000) ⇒ `Mercado` 2500; el lote pide `finish:"normal"`; la celda `finish` sigue `holofoil`', async () => {
    const refs = new Map<string, any>([
      ['c2|sealed|sealed:tcg:999|normal', { status: 'priced', referenceMxnCents: 250000, source: 'manual' }],
    ]);
    const pricing = buildPricing(refs, false); // dial apagado: `manual` sobrevive igual
    const svc = new InventoryService(
      buildPrisma([SEALED_MAPPED({ finish: 'holofoil' })]) as PrismaService,
      pricing,
      settings,
    );
    const ws = await loadSheet(await svc.exportInventoryXlsx({}));
    const row = ws.getRow(2);
    expect(row.getCell(colIndex('marketMxn')).value).toBe(2500); // hoy: vacía (busca con `holofoil`)
    expect(batchRequests(pricing)).toEqual([
      { cardId: 'c2', productType: 'sealed', gradeKey: 'sealed:tcg:999', finish: 'normal' },
    ]);
    expect(row.getCell(colIndex('finish')).value).toBe('holofoil'); // control: cambia la búsqueda, no el dato
  });

  it.each([
    ['tcgcsv', false, null, 'fuente automática con el dial APAGADO ⇒ vacía (hoy: 2500)'],
    ['tcgcsv', true, 2500, 'fuente automática con el dial ENCENDIDO ⇒ 2500'],
    ['manual', false, 2500, 'override manual con el dial apagado ⇒ 2500 (control: sobrevive al dial)'],
  ] as [string, boolean, number | null, string][])(
    'VK-8c · ref source=%s, sourceOn=%s ⇒ Mercado %p (%s)',
    async (source, sourceOn, expected) => {
      const refs = new Map<string, any>([
        ['c2|sealed|sealed:tcg:999|normal', { status: 'priced', referenceMxnCents: 250000, source }],
      ]);
      const pricing = buildPricing(refs, sourceOn);
      const svc = new InventoryService(buildPrisma([SEALED_MAPPED()]) as PrismaService, pricing, settings);
      const ws = await loadSheet(await svc.exportInventoryXlsx({}));
      const cell = ws.getRow(2).getCell(colIndex('marketMxn')).value;
      if (expected == null) expect(cell == null).toBe(true);
      else expect(cell).toBe(expected);
      // El dial se lee UNA vez por export (no por fila, y no cero: hay sellado que gatear).
      expect((pricing.loadSealedSpreads as jest.Mock).mock.calls.length).toBe(1);
    },
  );
});

describe('InventoryController.exportXlsx — cabeceras de descarga (P-31)', () => {
  function buildRes() {
    return { setHeader: jest.fn(), send: jest.fn() } as any;
  }

  it('manda Content-Type xlsx + Content-Disposition attachment + el buffer', async () => {
    const buf = Buffer.from('PK-fake');
    const inventory = { exportInventoryXlsx: jest.fn(async () => buf) };
    const ctrl = new InventoryController(inventory as any, {} as any, {} as any);
    const res = buildRes();
    await ctrl.exportXlsx(res, undefined, undefined);
    expect(inventory.exportInventoryXlsx).toHaveBeenCalledWith({
      setId: undefined,
      productType: undefined,
    });
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const disp = res.setHeader.mock.calls.find((c: any[]) => c[0] === 'Content-Disposition');
    expect(disp[1]).toMatch(/^attachment; filename="inventario-\d{4}-\d{2}-\d{2}\.xlsx"$/);
    expect(res.send).toHaveBeenCalledWith(buf);
  });

  it('productType inválido → 400 VALIDATION_ERROR (no llama al servicio)', async () => {
    const inventory = { exportInventoryXlsx: jest.fn() };
    const ctrl = new InventoryController(inventory as any, {} as any, {} as any);
    await expect(ctrl.exportXlsx(buildRes(), undefined, 'bogus')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
    });
    expect(inventory.exportInventoryXlsx).not.toHaveBeenCalled();
  });
});

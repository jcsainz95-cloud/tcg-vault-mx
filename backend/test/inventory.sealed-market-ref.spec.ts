import { InventoryService } from '../src/modules/inventory/inventory.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SETTING_VALIDATORS, SettingKey } from '../src/modules/settings/settings.constants';

/**
 * v1.19-sealed-tcgcsv (API_CONTRACT §M1) — Campos READ-ONLY del item sellado:
 * `tcgplayerProductId`/`tcgplayerGroupId` (columnas M-23, fluyen solas) + `sealedMarketRef`
 * (PriceInfo de la referencia TCGCSV): en LISTADOS por lote (getReferencesBatch, sin N+1) y
 * en el detalle. `null` sin mapeo o sin ingest. + Validación del dial `sealedPriceSource`.
 */

const BASE = {
  folio: 'INV-1',
  card: {},
  location: null,
  createdAt: new Date(),
};

function build(rows: unknown[], refsMap: Map<string, unknown>) {
  const prisma = {
    inventoryItem: {
      findMany: jest.fn().mockResolvedValue(rows),
      count: jest.fn().mockResolvedValue(rows.length),
      findUnique: jest.fn().mockResolvedValue(rows[0] ?? null),
    },
  } as unknown as PrismaService;
  const pricing = {
    getReferencesBatch: jest.fn().mockResolvedValue(refsMap),
    getReference: jest.fn().mockResolvedValue({ status: 'pending' }),
  } as unknown as PricingService;
  const svc = new InventoryService(prisma, pricing, {} as SettingsService);
  return { svc, prisma, pricing };
}

describe('InventoryService.listItems — sealedMarketRef por LOTE (sin N+1)', () => {
  it('sealed mapeado → PriceInfo del batch; sealed sin mapeo → null; raw → sin el campo', async () => {
    const rows = [
      { ...BASE, id: 'i-1', cardId: 'c-1', productType: 'sealed', tcgplayerProductId: 610894, tcgplayerGroupId: 23821 },
      { ...BASE, id: 'i-2', cardId: 'c-1', productType: 'sealed', tcgplayerProductId: null, tcgplayerGroupId: null },
      { ...BASE, id: 'i-3', cardId: 'c-2', productType: 'raw', tcgplayerProductId: null, tcgplayerGroupId: null },
    ];
    const priced = {
      status: 'priced',
      referenceMxnCents: 491310,
      source: 'tcgcsv',
      capturedDate: '2026-08-17',
    };
    const refs = new Map([['c-1|sealed|sealed:tcg:610894|normal', priced]]);
    const { svc, pricing } = build(rows, refs as never);

    const res = await svc.listItems({ page: 1, pageSize: 20 } as never);

    // UNA sola llamada por página (por lote), solo con los sealed MAPEADOS.
    expect(pricing.getReferencesBatch).toHaveBeenCalledTimes(1);
    expect(pricing.getReferencesBatch).toHaveBeenCalledWith([
      { cardId: 'c-1', productType: 'sealed', gradeKey: 'sealed:tcg:610894', finish: 'normal' },
    ]);
    expect(res.data[0]).toMatchObject({ id: 'i-1', sealedMarketRef: priced });
    expect(res.data[1]).toMatchObject({ id: 'i-2', sealedMarketRef: null });
    expect(res.data[2]).not.toHaveProperty('sealedMarketRef');
  });

  it('mapeado pero SIN ingest aún (sin fila en el batch) → sealedMarketRef null', async () => {
    const rows = [
      { ...BASE, id: 'i-1', cardId: 'c-1', productType: 'sealed', tcgplayerProductId: 12345, tcgplayerGroupId: 1 },
    ];
    const { svc } = build(rows, new Map());
    const res = await svc.listItems({ page: 1, pageSize: 20 } as never);
    expect(res.data[0]).toMatchObject({ sealedMarketRef: null });
  });
});

describe('InventoryService.getItem — sealedMarketRef en el detalle', () => {
  it('sealed mapeado con referencia → PriceInfo (source tcgcsv)', async () => {
    const item = {
      ...BASE,
      id: 'i-1',
      cardId: 'c-1',
      productType: 'sealed',
      tcgplayerProductId: 610894,
      tcgplayerGroupId: 23821,
      movements: [],
    };
    const { svc, pricing } = build([item], new Map());
    (pricing.getReference as jest.Mock).mockResolvedValue({
      status: 'priced',
      referenceMxnCents: 491310,
      source: 'tcgcsv',
      capturedDate: '2026-08-17',
    });
    const res = (await svc.getItem('i-1')) as { sealedMarketRef?: unknown };
    expect(pricing.getReference).toHaveBeenCalledWith('c-1', 'sealed', 'sealed:tcg:610894', 'normal');
    expect(res.sealedMarketRef).toMatchObject({ status: 'priced', source: 'tcgcsv' });
  });

  it('sealed sin mapeo → sealedMarketRef null SIN consultar referencias', async () => {
    const item = {
      ...BASE,
      id: 'i-1',
      cardId: 'c-1',
      productType: 'sealed',
      tcgplayerProductId: null,
      tcgplayerGroupId: null,
      movements: [],
    };
    const { svc, pricing } = build([item], new Map());
    const res = (await svc.getItem('i-1')) as { sealedMarketRef?: unknown };
    expect(res.sealedMarketRef).toBeNull();
    expect(pricing.getReference).not.toHaveBeenCalled();
  });

  it('mapeado pero referencia pending (sin ingest) → null (contrato §M1)', async () => {
    const item = {
      ...BASE,
      id: 'i-1',
      cardId: 'c-1',
      productType: 'sealed',
      tcgplayerProductId: 610894,
      tcgplayerGroupId: 23821,
      movements: [],
    };
    const { svc } = build([item], new Map()); // getReference mock default: pending
    const res = (await svc.getItem('i-1')) as { sealedMarketRef?: unknown };
    expect(res.sealedMarketRef).toBeNull();
  });
});

describe('Dial sealedPriceSource (`sealed_price_source`) — validación M10 (§4.19e)', () => {
  const validate = SETTING_VALIDATORS[SettingKey.SEALED_PRICE_SOURCE];

  it('acepta tcgcsv y off', () => {
    expect(validate('tcgcsv')).toBeNull();
    expect(validate('off')).toBeNull();
  });

  it('rechaza cualquier otro valor (→ 422 VALIDATION_ERROR vía PUT /admin/settings)', () => {
    expect(validate('on')).toMatch(/must be one of/);
    expect(validate('')).toMatch(/must be one of/);
    expect(validate(1)).toMatch(/must be one of/);
    expect(validate(null)).toMatch(/must be one of/);
  });
});

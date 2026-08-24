import { ConfigService } from '@nestjs/config';
import { AdminService } from '../src/modules/admin/admin.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { buildGradeKey, sealedMarketGradeKey } from '../src/modules/pricing/pricing.types';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';

/**
 * v1.28 (P-24, §4.26f / API_CONTRACT §M7, ADITIVO) — `GET /admin/finance/inventory-value` gana
 * `breakdown { raw, sealed, graded }`:
 *  - INVARIANTE del contrato: top-level = Σ del breakdown (los campos previos NO cambian de
 *    semántica; el dashboard sigue espejando el top-level).
 *  - Valuación por pieza money-safe: sin precio ⇒ excluida del total + `pendingPriceCount`
 *    (nunca 0 inventado). Sellado por `sealedMarketRef` (norma §4.26f) con fallback al gradeKey
 *    legacy `'sealed'` (override manual preexistente). Graded por su referencia de grado.
 *  - Referencias en UN lote (getReferencesBatch), no una query por pieza.
 *  - CSV `report=inventory` gana columnas espejo ADITIVAS AL FINAL.
 */

function buildHarness(items: any[], refsByKey: Record<string, number>) {
  const findMany = jest.fn(async () => items);
  const prisma: any = { inventoryItem: { findMany } };
  const getReferencesBatch = jest.fn(async (keys: any[]) => {
    const map = new Map<string, any>();
    for (const k of keys) {
      const id = `${k.cardId}|${k.productType}|${k.gradeKey}|${k.finish}`;
      if (refsByKey[id] != null) {
        map.set(id, { status: 'priced', referenceMxnCents: refsByKey[id] });
      }
    }
    return map;
  });
  const pricing = {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    // v2.1.1 (§4.36.5b): el seam de VENTA devuelve una DECISIÓN (monto + veredicto). El mock usa
    // el CUERPO REAL (`PricingService.prototype`): es puro y no toca `this`, así que el test no
    // puede divergir de producción ni reimplementar la matemática.
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    gradeKeyFor: (i: any) => buildGradeKey(i),
    sealedMarketGradeKeyForItem: (i: any) =>
      i.tcgplayerProductId != null ? sealedMarketGradeKey(i.tcgplayerProductId) : null,
    getReferencesBatch,
  } as unknown as PricingService;
  const service = new AdminService(
    prisma as PrismaService,
    pricing,
    new PiiCryptoService(new ConfigService({})),
    {} as any,
  );
  return { service, findMany, getReferencesBatch };
}

const raw = (over: any = {}) => ({
  cardId: 'c-raw',
  productType: 'raw',
  finish: 'normal',
  rawCondition: 'NM',
  gradingCompany: null,
  gradeValue: null,
  acquisitionCostCents: 1000,
  tcgplayerProductId: null,
  ...over,
});

describe('inventoryValue — breakdown P-24 (top-level = Σ breakdown)', () => {
  it('bucketiza por productType y el top-level es EXACTAMENTE la suma de los buckets', async () => {
    const h = buildHarness(
      [
        raw(), // valuada 5000
        raw({ cardId: 'c-raw2', finish: 'reverse_holo', acquisitionCostCents: 2000 }), // pendiente
        raw({
          cardId: 'c-psa',
          productType: 'graded',
          gradingCompany: 'PSA',
          gradeValue: '10',
          acquisitionCostCents: 30000,
        }), // valuada 90000 (referencia por grado — override manual §M2 P-20)
        raw({
          cardId: 'c-etb',
          productType: 'sealed',
          acquisitionCostCents: 40000,
          tcgplayerProductId: 555,
        }), // valuada 250000 vía sealedMarketRef
        raw({
          cardId: 'c-box',
          productType: 'sealed',
          acquisitionCostCents: null,
          tcgplayerProductId: null,
        }), // sin mapeo ni legacy → pendiente
      ],
      {
        'c-raw|raw|raw:NM|normal': 5000,
        'c-psa|graded|graded:PSA:10|normal': 90000,
        'c-etb|sealed|sealed:tcg:555|normal': 250000,
      },
    );
    const res = await h.service.inventoryValue();

    expect(res.breakdown.raw).toEqual({
      atReferenceCents: 5000,
      atCostCents: 3000,
      pieceCount: 2,
      pendingPriceCount: 1,
    });
    expect(res.breakdown.graded).toEqual({
      atReferenceCents: 90000,
      atCostCents: 30000,
      pieceCount: 1,
      pendingPriceCount: 0,
    });
    expect(res.breakdown.sealed).toEqual({
      atReferenceCents: 250000,
      atCostCents: 40000,
      pieceCount: 2,
      pendingPriceCount: 1,
    });
    // INVARIANTE del contrato: top-level = Σ breakdown.
    expect(res.atReferenceCents).toBe(5000 + 90000 + 250000);
    expect(res.atCostCents).toBe(3000 + 30000 + 40000);
    expect(res.pendingPriceCount).toBe(2);
    // Sin N+1: UN solo lote de referencias por request.
    expect(h.getReferencesBatch).toHaveBeenCalledTimes(1);
  });

  it('sellado NO mapeado con override manual LEGACY (gradeKey `sealed`) conserva su valuación (fallback)', async () => {
    const h = buildHarness(
      [raw({ cardId: 'c-tin', productType: 'sealed', tcgplayerProductId: null, acquisitionCostCents: 0 })],
      { 'c-tin|sealed|sealed|normal': 80000 },
    );
    const res = await h.service.inventoryValue();
    expect(res.breakdown.sealed.atReferenceCents).toBe(80000);
    expect(res.breakdown.sealed.pendingPriceCount).toBe(0);
  });

  it('sellado mapeado SIN ingest cae al legacy y, si tampoco hay, cuenta pendiente (nunca 0 inventado)', async () => {
    const h = buildHarness(
      [
        raw({ cardId: 'c-a', productType: 'sealed', tcgplayerProductId: 1, acquisitionCostCents: 0 }),
        raw({ cardId: 'c-b', productType: 'sealed', tcgplayerProductId: 2, acquisitionCostCents: 0 }),
      ],
      { 'c-a|sealed|sealed|normal': 12345 }, // c-a: sin mercado pero con legacy · c-b: nada
    );
    const res = await h.service.inventoryValue();
    expect(res.breakdown.sealed.atReferenceCents).toBe(12345);
    expect(res.breakdown.sealed.pendingPriceCount).toBe(1);
  });

  it('inventario vacío → breakdown en ceros y top-level en ceros (sin llamar al lote)', async () => {
    const h = buildHarness([], {});
    const res = await h.service.inventoryValue();
    expect(res).toMatchObject({ atReferenceCents: 0, atCostCents: 0, pendingPriceCount: 0 });
    expect(res.breakdown.raw.pieceCount).toBe(0);
    expect(h.getReferencesBatch).not.toHaveBeenCalled();
  });
});

describe('export.csv report=inventory — columnas espejo del breakdown (aditivas al final)', () => {
  it('cabecera con raw_/sealed_/graded_ al FINAL y fila con los mismos valores del response', async () => {
    const h = buildHarness(
      [raw(), raw({ cardId: 'c-psa', productType: 'graded', gradingCompany: 'PSA', gradeValue: '9', acquisitionCostCents: 500 })],
      { 'c-raw|raw|raw:NM|normal': 5000 },
    );
    const csv = await h.service.exportCsv('inventory');
    const [header, row] = csv.trim().split('\n');
    expect(header).toBe(
      'atReferenceCents,atCostCents,pendingPriceCount,' +
        'raw_atReferenceCents,raw_atCostCents,raw_pieceCount,raw_pendingPriceCount,' +
        'sealed_atReferenceCents,sealed_atCostCents,sealed_pieceCount,sealed_pendingPriceCount,' +
        'graded_atReferenceCents,graded_atCostCents,graded_pieceCount,graded_pendingPriceCount',
    );
    expect(row).toBe('5000,1500,1,5000,1000,1,0,0,0,0,0,0,500,1,1');
  });
});

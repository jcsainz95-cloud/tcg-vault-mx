import { ConfigService } from '@nestjs/config';
import { AdminService } from '../src/modules/admin/admin.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { buildGradeKey, tryBuildGradeKey, sealedMarketGradeKey } from '../src/modules/pricing/pricing.types';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';
import { REAL_VALUATION_GATE } from './helpers/valuation-gate';

/**
 * v1.28 (P-24, §4.26f / API_CONTRACT §M7, ADITIVO) — `GET /admin/finance/inventory-value` gana
 * `breakdown { raw, sealed, graded }`:
 *  - INVARIANTE del contrato: top-level = Σ del breakdown (los campos previos NO cambian de
 *    semántica; el dashboard sigue espejando el top-level).
 *  - Valuación por pieza money-safe: sin precio ⇒ excluida del total + `pendingPriceCount`
 *    (nunca 0 inventado). Sellado SOLO por `sealedMarketRef` (norma §4.26f); v1.70 (§M2-SK SK-2)
 *    retira el fallback al gradeKey legacy `'sealed'` (clave de cola, no de precio). Graded por su referencia de grado.
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
    tryGradeKeyFor: (i: any) => tryBuildGradeKey(i),
    // v1.80.1 (SK-5): la puerta de valuación REAL (los lectores ya no llaman `tryGradeKeyFor`).
    ...REAL_VALUATION_GATE,
    // SK-5: dial ENCENDIDO — estas pruebas no son del dial (ese lo cubren VK-2/VK-5); con él encendido la
    // valuación del sellado es la de antes de SK-5 para refs sin `source`.
    loadSealedSpreads: jest.fn(async () => ({ spreadPctBySubtype: {}, fallbackPct: 25, sourceOn: true })),
    sealedMarketGradeKeyForItem: (i: any) =>
      i.tcgplayerProductId != null ? sealedMarketGradeKey(i.tcgplayerProductId) : null,
    getReferencesBatch,
    // D-4 (v1.80.2.2): el helper REAL del dial del sellado (delega en `loadSealedSpreads` si el lote trae sellado).
    sealedSourceOnFor: PricingService.prototype.sealedSourceOnFor,
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

  // ⚠️ v1.70 (P-83 · API_CONTRACT §M2-SK norma **SK-2**) — **se RETIRA el fallback a `'sealed'`.**
  // Estos dos casos afirmaban lo contrario («conserva su valuación (fallback)» / «cae al legacy»):
  // el contrato los invierte. `'sealed'` no identifica al producto (un ETB y un blíster anclados a la
  // misma `Card` comparten fila), así que sumar esa fila al total es valuar una caja con el precio de
  // otra. Efecto declarado: esas piezas pasan de `atReferenceCents` a `pendingPriceCount`.
  it("SK-2: sellado NO mapeado con fila legada bajo 'sealed' ⇒ PENDIENTE, jamás suma al total", async () => {
    const h = buildHarness(
      [raw({ cardId: 'c-tin', productType: 'sealed', tcgplayerProductId: null, acquisitionCostCents: 0 })],
      { 'c-tin|sealed|sealed|normal': 80000 },
    );
    const res = await h.service.inventoryValue();
    expect(res.breakdown.sealed.atReferenceCents).toBe(0);
    expect(res.breakdown.sealed.pendingPriceCount).toBe(1);
    expect(res.atReferenceCents).toBe(0);
    expect(res.pendingPriceCount).toBe(1);
    // Ni siquiera se PIDE la llave de cola: una lectura de dinero no la consulta. Sin clave de
    // mercado no hay nada que pedir al lote (mismo idioma que la graduada sin identidad).
    expect(h.getReferencesBatch).not.toHaveBeenCalled();
  });

  it("SK-2: sellado MAPEADO sin ingest NO cae al legacy 'sealed' — cuenta pendiente (nunca 0 ni precio ajeno)", async () => {
    const h = buildHarness(
      [
        raw({ cardId: 'c-a', productType: 'sealed', tcgplayerProductId: 1, acquisitionCostCents: 0 }),
        raw({ cardId: 'c-b', productType: 'sealed', tcgplayerProductId: 2, acquisitionCostCents: 0 }),
        raw({ cardId: 'c-c', productType: 'sealed', tcgplayerProductId: 3, acquisitionCostCents: 0 }),
      ],
      {
        'c-a|sealed|sealed|normal': 12345, // c-a: sin mercado, solo la fila legada ⇒ pendiente
        'c-c|sealed|sealed:tcg:3|normal': 7000, // c-c: su mercado ⇒ valuada
        'c-c|sealed|sealed|normal': 99999, //       …y la legada NO gana ni se suma
      },
    );
    const res = await h.service.inventoryValue();
    expect(res.breakdown.sealed.atReferenceCents).toBe(7000);
    expect(res.breakdown.sealed.pendingPriceCount).toBe(2);
    // Ninguna clave pedida al lote es la de cola.
    const asked = (h.getReferencesBatch.mock.calls as any[]).flatMap(([ks]) => ks as any[]);
    expect(asked.some((k) => k.productType === 'sealed' && k.gradeKey === 'sealed')).toBe(false);
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

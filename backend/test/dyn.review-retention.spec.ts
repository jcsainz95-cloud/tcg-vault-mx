/**
 * dyn.review-retention.spec.ts — 💰 v1.114⟨portada⟩ (API_CONTRACT §DYN.5.9): la retención del candado en la ENTRADA del cuerpo de
 * venta, sin BD. `PricingService.saleRetentionFor` (qué variantes retienen y con qué referencia) y su uso en
 * `SaleDecisionService` (con lote y sin lote: el MISMO camino). La conducta de punta a punta, contra Postgres, vive en
 * `test/integration/dyn-review-retention.e2e-spec.ts` (DYN-B23…B26).
 */
import { PricingService, PriceInfo } from '../src/modules/pricing/pricing.service';
import { SaleDecisionService, SaleItem } from '../src/modules/pricing/sale-decision.service';

type Key = { cardId: string; productType: 'raw' | 'graded' | 'sealed'; gradeKey: string; finish: 'normal' | 'holofoil' };

function pricingWith(cases: unknown[], manualKeys: string[] = []) {
  const pricing = Object.create(PricingService.prototype) as PricingService & Record<string, unknown>;
  const findMany = jest.fn().mockResolvedValue(cases);
  (pricing as unknown as { prisma: unknown }).prisma = { priceReviewCase: { findMany } };
  const tier = jest.fn().mockResolvedValue({ refs: new Map(), manualKeys: new Set(manualKeys) });
  (pricing as unknown as { getReferencesBatchWithTier: unknown }).getReferencesBatchWithTier = tier;
  return { pricing, findMany, tier };
}

const K1: Key = { cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' };
const K2: Key = { cardId: 'c2', productType: 'raw', gradeKey: 'raw:NM', finish: 'holofoil' };
const caseOf = (k: Key, baselineMxnCents: number | null, iso: string) => ({ ...k, baselineMxnCents, createdAt: new Date(iso) });

describe('PricingService.saleRetentionFor — qué entra al cuerpo con caso vigente', () => {
  it('sin casos vigentes ⇒ mapa vacío y sin la segunda lectura (coste normal: UNA consulta)', async () => {
    const { pricing, findMany, tier } = pricingWith([]);
    expect((await pricing.saleRetentionFor([K1, K2])).size).toBe(0);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(tier).not.toHaveBeenCalled();
  });

  it('lee `open` y `kept`, sin producto separado ni sellado, el más reciente gana', async () => {
    const { pricing, findMany } = pricingWith([caseOf(K1, 100, '2026-10-20T10:00:00Z'), caseOf(K1, 184, '2026-10-28T10:00:00Z')]);
    const out = await pricing.saleRetentionFor([K1]);
    const where = findMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ['open', 'kept'] });
    expect(where.cardProductId).toBeNull();
    expect(where.sealedProductId).toBeNull();
    expect(findMany.mock.calls[0][0].orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
    expect(out.get('c1|raw|raw:NM|normal')).toEqual({ status: 'priced', referenceMxnCents: 184, capturedDate: '2026-10-28' });
  });

  it('caso sin base ⇒ `pending` (⇒ PRICE_PENDING)', async () => {
    const { pricing } = pricingWith([caseOf(K2, null, '2026-10-28T10:00:00Z')]);
    expect((await pricing.saleRetentionFor([K2])).get('c2|raw|raw:NM|holofoil')).toEqual({ status: 'pending' });
  });

  it('override tier 0 ⇒ fuera (gana el override); la lectura de tier solo pide las variantes con caso', async () => {
    const { pricing, tier } = pricingWith([caseOf(K1, 184, '2026-10-28T10:00:00Z')], ['c1|raw|raw:NM|normal']);
    expect((await pricing.saleRetentionFor([K1, K2])).size).toBe(0);
    expect(tier).toHaveBeenCalledWith([K1]);
  });

  it('el sellado no tiene candado: ni se consulta', async () => {
    const { pricing, findMany } = pricingWith([]);
    const sealed: Key = { cardId: 'c3', productType: 'sealed', gradeKey: 'sealed:tcg:1', finish: 'normal' };
    expect((await pricing.saleRetentionFor([sealed])).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('SaleDecisionService — la retención entra por las dos cargas (lote y pieza suelta)', () => {
  const item = { id: 'i1', folio: 'F1', cardId: 'c1', productType: 'raw', rawCondition: 'NM', finish: 'normal', card: {} } as unknown as SaleItem;
  const held: PriceInfo = { status: 'priced', referenceMxnCents: 184, capturedDate: '2026-10-28' };
  function pricingStub() {
    return {
      tryGradeKeyFor: () => 'raw:NM',
      getReferencesBatch: jest.fn().mockResolvedValue(new Map([['c1|raw|raw:NM|normal', { status: 'priced', referenceMxnCents: 10_221 }]])),
      getReference: jest.fn().mockResolvedValue({ status: 'priced', referenceMxnCents: 10_221 }),
      saleRetentionFor: jest.fn().mockResolvedValue(new Map([['c1|raw|raw:NM|normal', held]])),
    };
  }

  it('`loadReferences` (lote): la referencia del caso sustituye a la mediana con el pico', async () => {
    const p = pricingStub();
    const d = new SaleDecisionService(p as unknown as PricingService);
    expect((await d.loadReferences([item])).get('c1|raw|raw:NM|normal')).toEqual(held);
  });

  it('`referenceOf` sin lote: la del caso, sin leer la referencia viva', async () => {
    const p = pricingStub();
    const d = new SaleDecisionService(p as unknown as PricingService);
    expect(await d.referenceOf(item)).toEqual(held);
    expect(p.getReference).not.toHaveBeenCalled();
  });

  it('sin caso: la referencia de siempre', async () => {
    const p = { ...pricingStub(), saleRetentionFor: jest.fn().mockResolvedValue(new Map()) };
    const d = new SaleDecisionService(p as unknown as PricingService);
    expect(await d.referenceOf(item)).toEqual({ status: 'priced', referenceMxnCents: 10_221 });
    expect((await d.loadReferences([item])).get('c1|raw|raw:NM|normal')).toEqual({ status: 'priced', referenceMxnCents: 10_221 });
  });
});

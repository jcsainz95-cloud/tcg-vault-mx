/**
 * IDS-B33…B37 (API_CONTRACT §2 «Compra sugerida por versión»): `buySuggestedCents` de `InventoryVersionsService.versionsFor`.
 * Decider REAL (`versionReferences`, `referenceIn`); solo se sustituyen el lote y la decisión de venta (no se mide aquí).
 * Curva 40 % en 9 000 → 50 % en 12 000 (plana fuera), bin 1¢: R 12 000 ⇒ 6 000, y 9 000 ⇒ 3 600 (distingue pct-antes-de-curva).
 */
import { DEFAULT_PRICING_CURVE, PricingCurve } from '../../common/pricing-curve';
import { SaleDecisionBatch, SaleDecisionService } from '../pricing/sale-decision.service';
import { cardProductRefKey } from '../pricing/pricing.service';
import { variantKey } from '../../common/variant-key';
import { scaleByPct } from '../../common/card-version';
import { InventoryVersionsService } from './inventory-versions.service';

const CURVE: PricingCurve = {
  ...DEFAULT_PRICING_CURVE,
  buy: { binCents: 1, points: [{ marketCents: 9000, pctBp: 4000 }, { marketCents: 12000, pctBp: 5000 }] },
};
const NONE = { mode: 'none', rarities: [] } as const;
const CARD = { id: 'c1', set: null, availableFinishes: ['normal'], rarity: 'Common', rarityCanonical: 'Common' };
const STAMP_ROW = { id: 'cp1', tcgplayerProductId: 620000001, stampType: 'league_cup', stampLabel: 'League', finishes: ['normal'], kind: 'stamped' };

type Opts = { rEn?: number | null; rP?: number | null; pct?: number | null; override?: { buyOverrideCents: number } | null };

async function combos(o: Opts) {
  const pricing = { tryGradeKeyFor: () => 'raw:NM' } as never;
  const decider = new SaleDecisionService(pricing);
  const rEn = o.rEn === undefined ? 12000 : o.rEn;
  const rP = o.rP === undefined ? 20000 : o.rP;
  const refs = new Map();
  if (rEn != null) refs.set(variantKey({ cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' }), { status: 'priced', referenceMxnCents: rEn });
  const stampedRefs = new Map();
  if (rP != null) stampedRefs.set(cardProductRefKey({ cardProductId: 'cp1', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' }), { status: 'priced', referenceMxnCents: rP });
  const stamp = { productId: 620000001, internalId: 'cp1', type: 'league_cup', label: 'League', finishes: ['normal'] };
  const overrides = new Map();
  if (o.override) overrides.set(variantKey({ cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' }), { ...o.override, bountyEnabled: false });
  const batch = {
    curve: CURVE,
    premiumFloorPolicy: NONE,
    sealedSpreads: null,
    refs,
    variantOverrides: overrides,
    stamps: new Map([[620000001, stamp]]),
    stampedRefs,
    spanishPct: o.pct === undefined ? 75 : o.pct,
  } as unknown as SaleDecisionBatch;
  jest.spyOn(decider, 'loadBatch').mockResolvedValue(batch);
  jest.spyOn(decider, 'decide').mockResolvedValue({ unitPriceCents: 1 } as never);
  const prisma = {
    card: { findUnique: jest.fn().mockResolvedValue(CARD) },
    cardProduct: { findMany: jest.fn().mockResolvedValue([STAMP_ROW]) },
    stampedProductCandidate: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const svc = new InventoryVersionsService(prisma as never, decider, { getIvaDials: jest.fn().mockResolvedValue({}) } as never, {} as never, {} as never);
  const res = await svc.versionsFor('c1');
  const get = (language: 'en' | 'es', league: boolean) => res.combos.find((c) => c.language === language && (c.stamp != null) === league)!.buySuggestedCents;
  return { get, res };
}

describe('InventoryVersionsService — buySuggestedCents (IDS-B33…B37)', () => {
  it('IDS-B33: compra inglesa 6000 ⇒ español 4500 (curva primero, scaleByPct después)', async () => {
    const { get } = await combos({});
    expect(get('en', false)).toBe(6000);
    expect(get('es', false)).toBe(4500);
  });

  it('IDS-B33: redondeo de scaleByPct (mitad hacia arriba), no truncado', async () => {
    const { get } = await combos({ rEn: 12002, pct: 75 }); // compra 6001 ⇒ 4500.75 ⇒ 4501
    expect(get('en', false)).toBe(6001);
    expect(get('es', false)).toBe(scaleByPct(6001, 75));
    expect(get('es', false)).toBe(4501);
  });

  it('IDS-B34: pct 50 ⇒ 3000 (lee el setting, no un 75 fijo)', async () => {
    expect((await combos({ pct: 50 })).get('es', false)).toBe(3000);
  });

  it('IDS-B35: liga con mercado propio ⇒ B(R_P) ≠ B(R_en)', async () => {
    const { get } = await combos({ rEn: 12000, rP: 20000 });
    expect(get('en', true)).toBe(10000);
    expect(get('en', true)).not.toBe(get('en', false));
  });

  it('IDS-B36: sin referencia ⇒ null (no 0) en es, liga y es+liga', async () => {
    const a = await combos({ rEn: null, rP: null });
    expect([a.get('en', false), a.get('es', false), a.get('en', true), a.get('es', true)]).toEqual([null, null, null, null]);
    const b = await combos({ rP: null }); // hay inglés, no hay mercado de liga
    expect([b.get('en', false), b.get('es', false), b.get('en', true), b.get('es', true)]).toEqual([6000, 4500, null, null]);
  });

  it('IDS-B36: pct inválido ⇒ null en español, el inglés no se toca', async () => {
    const { get } = await combos({ pct: null });
    expect([get('en', false), get('es', false), get('es', true), get('en', true)]).toEqual([6000, null, null, 10000]);
  });

  it('IDS-B37: es+liga = scaleByPct(B(R_P), pct)', async () => {
    const { get } = await combos({ rP: 20000, pct: 75 });
    expect(get('es', true)).toBe(scaleByPct(10000, 75));
    expect(get('es', true)).toBe(7500);
  });

  it('override de compra: solo (en, sin liga); el resto, curva pura', async () => {
    const { get } = await combos({ override: { buyOverrideCents: 9999 } });
    expect(get('en', false)).toBe(9999);
    expect(get('es', false)).toBe(4500);
    expect(get('en', true)).toBe(10000);
    expect(get('es', true)).toBe(7500);
  });
});

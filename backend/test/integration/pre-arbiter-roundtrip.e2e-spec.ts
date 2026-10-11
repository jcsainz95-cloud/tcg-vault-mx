/**
 * pre-arbiter-roundtrip.e2e-spec.ts — 💰 M-75/M-76 §PRE — EL ROUND-TRIP DEL ARREGLO CONTRA POSTGRES
 * REAL (BLOQ-1 de QA). Propiedad: backend.
 *
 * Cierra la brecha que ningún unitario podía cachar: la COEXISTENCIA de las fuentes del árbitro bajo el
 * índice único real de `PriceReference`. Reproduce el estado del bug del dueño (Archaludon de Prismatic:
 * residuo aplanado `pokemontcg_io` ~MX$102, SIN cobertura tcgcsv), escribe `tcgdex`($0.11) y
 * `cardmarket`(€0.10) con el ESCRITOR REAL (`persistArbiterReference`, ambos `cardProductId=null`, mismo
 * día) y demuestra:
 *   1. AMBAS filas COEXISTEN (sin P2002) — lo que M-76 habilitó al meter `source` a la `@@unique`.
 *   2. `getReferencesBatch` (lectura viva) devuelve la MEDIANA en CENTAVOS, NO los MX$102 del residuo.
 *   3. `arbiterDetailForKeys` ve `familyCount=2` (tcgplayer + cardmarket) y `consensus=true`.
 *   4. El candado (`decideLock`) ⇒ **publica** (sin abrir caso): las 2 familias concuerdan en «barato».
 */
import { randomUUID } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { decideLock, DEFAULT_PRICE_JUMP_FACTOR } from '../../src/common/robust-market';

describe('💰 §PRE round-trip (M-75/M-76, Postgres real) — Archaludon MX$102 → centavos AUTOMÁTICO', () => {
  let h: E2EHarness;
  let pricing: PricingService;

  const setId = `pre-set-${randomUUID()}`;
  const cardId = `pre-card-${randomUUID()}`;
  const pid = 980000000 + Math.floor(Math.random() * 9000000);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const key = { cardId, productType: 'raw' as const, gradeKey: 'raw:NM', finish: 'holofoil' as const };

  beforeAll(async () => {
    h = await E2EHarness.create();
    pricing = h.app.get(PricingService);
    await h.prisma.cardSet.create({ data: { id: setId, externalId: `pre-ext-${randomUUID()}`, name: 'PRE Prismatic' } });
    await h.prisma.card.create({
      data: { id: cardId, externalId: `pre-card-ext-${randomUUID()}`, setId, name: 'Archaludon', number: '070/131', tcgplayerId: String(pid) },
    });
    // El RESIDUO aplanado: pokemontcg_io a MX$102.21 (el bug). cardProductId=null, HOY. NO admitido por el árbitro.
    await h.prisma.priceReference.create({
      data: { cardId, productType: 'raw', gradeKey: 'raw:NM', finish: 'holofoil', source: 'pokemontcg_io', priceMxnCents: 10221, capturedDate: today, isManualOverride: false, refKind: 'market' },
    });
  });

  afterAll(async () => {
    await h.prisma.priceReference.deleteMany({ where: { cardId } });
    await h.prisma.card.deleteMany({ where: { id: cardId } });
    await h.prisma.cardSet.deleteMany({ where: { id: setId } });
    await h.close();
  });

  it('1 · tcgdex + cardmarket COEXISTEN en cardProductId=null el mismo día (M-76: sin P2002)', async () => {
    // tcgdex $0.11 USD ≈ MX$2 (horneado); cardmarket €0.10 ≈ MX$2 (congelado). El escritor REAL.
    await pricing.persistArbiterReference({ source: 'tcgdex', cardId, finish: 'holofoil', productType: 'raw', gradeKey: 'raw:NM', marketCents: 11, currency: 'USD', priceMxnCents: 204, capturedDate: today.toISOString().slice(0, 10), cardProductId: null, fxRate: 18.5, fxBufferPct: 0 });
    await pricing.persistArbiterReference({ source: 'cardmarket', cardId, finish: 'holofoil', productType: 'raw', gradeKey: 'raw:NM', marketCents: 10, currency: 'EUR', priceMxnCents: 202, capturedDate: today.toISOString().slice(0, 10), cardProductId: null });
    const rows = await h.prisma.priceReference.findMany({ where: { cardId, finish: 'holofoil', cardProductId: null } });
    const bySrc = new Map(rows.map((r) => [r.source, r.priceMxnCents]));
    // Las TRES conviven: residuo + tcgdex + cardmarket (M-76 habilitó la coexistencia por `source`).
    expect(bySrc.get('tcgdex')).toBe(204);
    expect(bySrc.get('cardmarket')).toBe(202);
    expect(bySrc.get('pokemontcg_io')).toBe(10221);
    expect(rows).toHaveLength(3);
  });

  it('2 · getReferencesBatch devuelve la MEDIANA en centavos (NO los MX$102 del residuo)', async () => {
    const batch = await pricing.getReferencesBatch([key]);
    const info = batch.get(`${cardId}|raw|raw:NM|holofoil`)!;
    expect(info.status).toBe('priced');
    expect(info.referenceMxnCents).toBe(Math.round((204 + 202) / 2)); // 203, NO 10221
    expect(info.referenceMxnCents!).toBeLessThan(1000);
    expect(info.source).not.toBe('pokemontcg_io');
  });

  it('3 · el árbitro ve familyCount=2 (tcgplayer + cardmarket) y consensus=true', async () => {
    const detail = await pricing.arbiterDetailForKeys([key]);
    const d = detail.get(`${cardId}|raw|raw:NM|holofoil`)!;
    expect(d.result.familyCount).toBe(2);
    expect(d.result.consensus).toBe(true);
    expect(d.result.robustMarketMxnCents).toBe(203);
  });

  it('4 · el candado PUBLICA (sin caso): 2 familias concuerdan en «barato», aunque la base fuera MX$102', async () => {
    const detail = await pricing.arbiterDetailForKeys([key]);
    const d = detail.get(`${cardId}|raw|raw:NM|holofoil`)!;
    // Base = el residuo inflado (peor caso): salto grande, PERO 2 familias concuerdan ⇒ publica.
    const decision = decideLock(d.result, 10221, DEFAULT_PRICE_JUMP_FACTOR);
    expect(decision.outcome).toBe('publish');
    expect(decision.openCase).toBe(false);
    expect(decision.publishMxnCents).toBe(203);
  });
});

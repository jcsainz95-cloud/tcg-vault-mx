/**
 * pre-frozen-baseline.e2e-spec.ts — 💰 M-75 §PRE cuestión D (ARCHITECTURE §4.PRE (c)) — LA BASE SE
 * CONGELA mientras hay `PriceReviewCase open`. Postgres real. Propiedad: backend.
 *
 * El agujero que techlead midió: si la base fuera SIEMPRE `resolveRobustMarket(quotes < hoy)`, un pico
 * de UNA sola fuente que persiste DOS barridos haría que el día 2 las quotes de ayer YA incluyeran el
 * pico ⇒ base≈pico ⇒ jumpFactor≈1 ⇒ publica y auto-supersede el caso que el día 1 retuvo. La partición
 * (base congelada = `caso.baselineMxnCents` mientras hay caso `open`) lo cierra: el día 2 la base sigue
 * siendo el valor sano PRE-pico y el caso SIGUE en revisión.
 */
import { randomUUID } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { decideLock, DEFAULT_PRICE_JUMP_FACTOR } from '../../src/common/robust-market';

describe('💰 §PRE cuestión D (Postgres real) — base CONGELADA mientras el caso está open', () => {
  let h: E2EHarness;
  let pricing: PricingService;

  const setId = `preD-set-${randomUUID()}`;
  const cardId = `preD-card-${randomUUID()}`;
  const pid = 970000000 + Math.floor(Math.random() * 9000000);
  const vkey = `${cardId}|raw|raw:NM|holofoil`;
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const key = { cardId, productType: 'raw' as const, gradeKey: 'raw:NM', finish: 'holofoil' as const };
  const SANO = 184; // valor sano pre-pico
  const PICO = 10000; // pico de fuente única (×54 sobre el sano)

  beforeAll(async () => {
    h = await E2EHarness.create();
    pricing = h.app.get(PricingService);
    await h.prisma.cardSet.create({ data: { id: setId, externalId: `preD-ext-${randomUUID()}`, name: 'PRE-D set' } });
    await h.prisma.card.create({ data: { id: cardId, externalId: `preD-card-ext-${randomUUID()}`, setId, name: 'Pico', number: '001/131', tcgplayerId: String(pid) } });
  });

  afterAll(async () => {
    await h.prisma.priceReviewCase.deleteMany({ where: { cardId } });
    await h.prisma.priceReference.deleteMany({ where: { cardId } });
    await h.prisma.card.deleteMany({ where: { id: cardId } });
    await h.prisma.cardSet.deleteMany({ where: { id: setId } });
    await h.close();
  });

  it('SIN caso open ⇒ base = robusta de ayer (comportamiento normal)', async () => {
    // Ayer tcgdex sano (MXN congelado ⇒ determinista, sin recomputar FX). Sin caso ⇒ base = robusta(<hoy) = SANO.
    await h.prisma.priceReference.create({
      data: { cardId, productType: 'raw', gradeKey: 'raw:NM', finish: 'holofoil', source: 'tcgdex', priceUsdCents: null, priceMxnCents: SANO, capturedDate: yesterday, isManualOverride: false, refKind: 'market' },
    });
    const detail = await pricing.arbiterDetailForKeys([key]);
    expect(detail.get(vkey)!.baselineMxnCents).toBe(SANO);
  });

  it('CON caso open ⇒ base = caso.baselineMxnCents CONGELADA, aunque las quotes de ayer ya traigan el pico', async () => {
    // El día 1 abrió un caso con baseline=SANO. Ahora (día 2) el pico persiste: hay una fila tcgdex de
    // AYER con el PICO (si la base se recomputara, saldría ≈ pico). Con el caso open, debe quedar SANO.
    await h.prisma.priceReference.updateMany({
      where: { cardId, finish: 'holofoil', source: 'tcgdex', capturedDate: yesterday },
      data: { priceMxnCents: PICO, priceUsdCents: null }, // ayer ya es el pico (MXN congelado)
    });
    await h.prisma.priceReviewCase.create({
      data: { cardId, productType: 'raw', gradeKey: 'raw:NM', finish: 'holofoil', axis: 'sell', proposedMxnCents: PICO, baselineMxnCents: SANO, jumpFactorMilli: 54_000, sourceCount: 1, familyCount: 1, consensus: false, quotesSnapshot: [], status: 'open' },
    });
    // Hoy el pico persiste (fila tcgdex de HOY con el pico; MXN congelado ⇒ valor determinista).
    await h.prisma.priceReference.create({
      data: { cardId, productType: 'raw', gradeKey: 'raw:NM', finish: 'holofoil', source: 'tcgdex', priceUsdCents: null, priceMxnCents: PICO, capturedDate: today, isManualOverride: false, refKind: 'market' },
    });

    const detail = await pricing.arbiterDetailForKeys([key]);
    const d = detail.get(vkey)!;
    // ⭐ CONGELADA: base = SANO (del caso), NO el PICO que ya está en las quotes de ayer.
    expect(d.baselineMxnCents).toBe(SANO);
    // ⇒ el candado SIGUE en revisión (salto grande, fuente única): NO auto-supersede.
    const decision = decideLock(d.result, d.baselineMxnCents, DEFAULT_PRICE_JUMP_FACTOR);
    expect(decision.outcome).toBe('review');
    expect(decision.openCase).toBe(true);
  });
});

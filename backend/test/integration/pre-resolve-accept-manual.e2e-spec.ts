/**
 * pre-resolve-accept-manual.e2e-spec.ts — 💰 M-75 §PRE.F cuestiones A y B (Postgres real). Backend.
 *
 *  A (techlead, DINERO): `resolve(manual)` reclama el caso ANTES de escribir el override, en UNA
 *    transacción ⇒ un 2º POST `manual` (doble submit) devuelve 409 y el PERDEDOR **no escribe precio**.
 *  B (arquitecto, §4.PRE (d)): `accept` promueve una `PriceReference` ROBUSTA **NO-manual** (⛔ nunca
 *    `source='manual'`) ⇒ el barrido SIGUE arbitrando la variante (no la congela).
 */
import { randomUUID } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import { PriceReviewService } from '../../src/modules/pricing/price-review.service';

describe('💰 §PRE.F resolve — A (manual no escribe dos veces) y B (accept no congela)', () => {
  let h: E2EHarness;
  let review: PriceReviewService;
  let actorId: string;

  const setId = `preF-set-${randomUUID()}`;

  beforeAll(async () => {
    h = await E2EHarness.create();
    review = h.app.get(PriceReviewService);
    await h.prisma.cardSet.create({ data: { id: setId, externalId: `preF-ext-${randomUUID()}`, name: 'PRE-F set' } });
    const admin = await h.prisma.user.findFirstOrThrow({ where: { role: 'super_admin' }, select: { id: true } });
    actorId = admin.id;
  });

  afterAll(async () => {
    const ids = (await h.prisma.card.findMany({ where: { setId }, select: { id: true } })).map((c) => c.id);
    await h.prisma.priceReviewCase.deleteMany({ where: { cardId: { in: ids } } });
    await h.prisma.priceReference.deleteMany({ where: { cardId: { in: ids } } });
    await h.prisma.card.deleteMany({ where: { setId } });
    await h.prisma.cardSet.deleteMany({ where: { id: setId } });
    await h.close();
  });

  async function freshCard(): Promise<string> {
    const id = `preF-card-${randomUUID()}`;
    await h.prisma.card.create({ data: { id, externalId: `preF-cx-${randomUUID()}`, setId, name: 'C', number: '1', tcgplayerId: String(960000000 + Math.floor(Math.random() * 9000000)) } });
    return id;
  }
  async function openCase(cardId: string, proposed: number) {
    return h.prisma.priceReviewCase.create({
      data: { cardId, productType: 'raw', gradeKey: 'raw:NM', finish: 'holofoil', axis: 'sell', proposedMxnCents: proposed, baselineMxnCents: 184, jumpFactorMilli: 54_000, sourceCount: 2, familyCount: 2, consensus: false, quotesSnapshot: [{ source: 'tcgdex', family: 'tcgplayer', priceMxnCents: proposed, capturedDate: '2026-10-11', stale: false }], status: 'open' },
    });
  }

  it('A · segundo POST manual ⇒ 409 y el perdedor NO escribe precio (el override queda en el 1º valor)', async () => {
    const cardId = await freshCard();
    const c = await openCase(cardId, 9999);
    const first = await review.resolve(c.id, 'manual', 5000, actorId);
    expect(first.status).toBe('manual');
    // 2º POST manual con OTRO precio ⇒ 409 (guard reclama primero, tx revierte, no escribe).
    await expect(review.resolve(c.id, 'manual', 7777, actorId)).rejects.toMatchObject({ code: 'CONFLICT' });
    // El override vivo sigue siendo 5000 (del ganador); ⛔ NO hay fila manual con 7777.
    const manualRows = await h.prisma.priceReference.findMany({ where: { cardId, source: 'manual' } });
    expect(manualRows).toHaveLength(1);
    expect(manualRows[0].priceMxnCents).toBe(5000);
    expect(manualRows.some((r) => r.priceMxnCents === 7777)).toBe(false);
  });

  it('B · accept promueve una PriceReference NO-manual (source admitida, isManualOverride=false) ⇒ el barrido la sigue arbitrando', async () => {
    const cardId = await freshCard();
    const c = await openCase(cardId, 203);
    const res = await review.resolve(c.id, 'accept', undefined, actorId);
    expect(res.status).toBe('accepted');
    const refs = await h.prisma.priceReference.findMany({ where: { cardId } });
    expect(refs).toHaveLength(1);
    const ref = refs[0];
    // ⭐ NO-manual: isManualOverride=false, source ≠ 'manual', refKind='market', valor = proposed.
    expect(ref.isManualOverride).toBe(false);
    expect(ref.source).not.toBe('manual');
    expect(ref.source).toBe('tcgdex'); // la representativa de la mediana (de quotesSnapshot)
    expect(ref.refKind).toBe('market');
    expect(ref.priceMxnCents).toBe(203);
    // El caso quedó con resolvedPriceRefId = la fila escrita.
    const resolved = await h.prisma.priceReviewCase.findUniqueOrThrow({ where: { id: c.id } });
    expect(resolved.resolvedPriceRefId).toBe(ref.id);
    expect(resolved.resolvedAction).toBe('accept');
  });
});

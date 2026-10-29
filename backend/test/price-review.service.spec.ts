/**
 * price-review.service.spec.ts — v1.91⟨precios⟩ (M-75, §PRE.D/E/F) — guardas de la cola de revisión.
 * 💰 DINERO. Unit test con prisma mockeado (sin DB): 409 de doble resolución, 422 de action inválida,
 * 422 de `manual` sin precio, y la apertura/supersesión de casos del barrido.
 */
import { PriceReviewService, ReviewVariantKey } from '../src/modules/pricing/price-review.service';
import { RobustResult, LockDecision } from '../src/common/robust-market';

function makeService(prismaOverrides: any = {}, listingPrices?: any) {
  const prisma: any = {
    priceReviewCase: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'case-new' }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(0),
      ...(prismaOverrides.priceReviewCase ?? {}),
    },
    card: { findMany: jest.fn().mockResolvedValue([]) },
    // v1.91 errata (A): resolve() corre en UNA transacción (guard-first). El mock ejecuta el callback
    // con el mismo cliente (tx = prisma), así los `tx.priceReviewCase.*` caen en los mismos jest.fn.
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
  };
  const audit: any = { log: jest.fn().mockResolvedValue(undefined) };
  const pricing: any = {
    applyManualOverride: jest.fn().mockResolvedValue({ ref: { id: 'ref-1' }, before: null }),
    // v1.91 errata (B): accept promueve una PriceReference robusta NO-manual (no congela).
    promoteRobustReference: jest.fn().mockResolvedValue({ ref: { id: 'ref-accept' } }),
  };
  const svc = new PriceReviewService(prisma, audit, pricing, listingPrices);
  return { svc, prisma, audit, pricing };
}

const KEY: ReviewVariantKey = { cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'holofoil' };

const ROBUST_SINGLE: RobustResult = {
  robustMarketMxnCents: 10221,
  sourceCount: 1,
  familyCount: 1,
  consensus: false,
  medianSource: 'tcgdex',
  freshestCapturedDate: '2026-10-11',
  quotes: [{ source: 'tcgdex', family: 'tcgplayer', priceMxnCents: 10221, capturedDate: '2026-10-11', stale: false }],
};
const DECISION_REVIEW: LockDecision = {
  outcome: 'review',
  publishMxnCents: null,
  conservedMxnCents: 184,
  jumpFactorMilli: 55549,
  openCase: true,
};
const DECISION_PUBLISH: LockDecision = {
  outcome: 'publish',
  publishMxnCents: 205,
  conservedMxnCents: null,
  jumpFactorMilli: 2000,
  openCase: false,
};

describe('recordArbiterDecision — abre y cierra casos (§PRE.D)', () => {
  it('openCase y no existe ⇒ crea un caso open con la foto de las cotizaciones', async () => {
    const { svc, prisma } = makeService();
    const id = await svc.recordArbiterDecision(KEY, 'sell', ROBUST_SINGLE, DECISION_REVIEW);
    expect(id).toBe('case-new');
    expect(prisma.priceReviewCase.create).toHaveBeenCalledTimes(1);
    const data = prisma.priceReviewCase.create.mock.calls[0][0].data;
    expect(data.proposedMxnCents).toBe(10221);
    expect(data.baselineMxnCents).toBe(184);
    expect(data.jumpFactorMilli).toBe(55549);
    expect(data.status).toBe('open');
    expect(data.axis).toBe('sell');
  });

  it('openCase y ya existe con MISMO proposed ⇒ idempotente (no crea otro)', async () => {
    const { svc, prisma } = makeService({
      priceReviewCase: { findFirst: jest.fn().mockResolvedValue({ id: 'case-old', proposedMxnCents: 10221 }) },
    });
    const id = await svc.recordArbiterDecision(KEY, 'sell', ROBUST_SINGLE, DECISION_REVIEW);
    expect(id).toBe('case-old');
    expect(prisma.priceReviewCase.create).not.toHaveBeenCalled();
  });

  it('openCase y existe con proposed DISTINTO ⇒ supersede el viejo y crea otro', async () => {
    const { svc, prisma } = makeService({
      priceReviewCase: { findFirst: jest.fn().mockResolvedValue({ id: 'case-old', proposedMxnCents: 999 }) },
    });
    await svc.recordArbiterDecision(KEY, 'sell', ROBUST_SINGLE, DECISION_REVIEW);
    expect(prisma.priceReviewCase.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'superseded' }) }),
    );
    expect(prisma.priceReviewCase.create).toHaveBeenCalledTimes(1);
  });

  it('!openCase (mercado asentado) y existe caso open ⇒ lo cierra superseded (automático)', async () => {
    const { svc, prisma } = makeService({
      priceReviewCase: { findFirst: jest.fn().mockResolvedValue({ id: 'case-old', proposedMxnCents: 10221 }) },
    });
    const id = await svc.recordArbiterDecision(KEY, 'sell', ROBUST_SINGLE, DECISION_PUBLISH);
    expect(id).toBeNull();
    expect(prisma.priceReviewCase.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'superseded' }) }),
    );
    expect(prisma.priceReviewCase.create).not.toHaveBeenCalled();
  });
});

describe('resolve — guardas (§PRE.F)', () => {
  it('action inválida ⇒ 422 PRICE_REVIEW_INVALID_ACTION', async () => {
    const { svc } = makeService();
    await expect(svc.resolve('id1', 'bogus' as any, undefined, 'u1')).rejects.toMatchObject({
      code: 'PRICE_REVIEW_INVALID_ACTION',
    });
  });

  it('manual sin manualPriceMxnCents ⇒ 422 VALIDATION_ERROR', async () => {
    const { svc } = makeService();
    await expect(svc.resolve('id1', 'manual', undefined, 'u1')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('caso inexistente ⇒ NOT_FOUND', async () => {
    const { svc } = makeService();
    await expect(svc.resolve('nope', 'keep', undefined, 'u1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('keep sobre caso open ⇒ status kept, audita, no toca precio', async () => {
    const { svc, prisma, audit, pricing } = makeService({
      priceReviewCase: {
        findUnique: jest.fn().mockResolvedValue({ id: 'id1', status: 'open', cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'holofoil', proposedMxnCents: 10221, baselineMxnCents: 184 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });
    const res = await svc.resolve('id1', 'keep', undefined, 'u1');
    expect(res.status).toBe('kept');
    expect(pricing.applyManualOverride).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalled();
  });

  it('💰 doble resolución (count!==1) ⇒ 409 CONFLICT con el estado real', async () => {
    const { svc } = makeService({
      priceReviewCase: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: 'id1', status: 'open', cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'holofoil', proposedMxnCents: 10221, baselineMxnCents: 184 })
          .mockResolvedValueOnce({ status: 'kept', resolvedAt: new Date('2026-10-11') }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }), // ya no estaba open
      },
    });
    await expect(svc.resolve('id1', 'keep', undefined, 'u1')).rejects.toMatchObject({
      code: 'CONFLICT',
      details: expect.objectContaining({ status: 'kept' }),
    });
  });

  it('💰 accept ⇒ promueve una PriceReference NO-manual (NO congela) y status accepted — errata B', async () => {
    const { svc, pricing } = makeService({
      priceReviewCase: {
        findUnique: jest.fn().mockResolvedValue({ id: 'id1', status: 'open', cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'holofoil', proposedMxnCents: 10221, baselineMxnCents: 184, quotesSnapshot: [{ source: 'tcgdex', family: 'tcgplayer', priceMxnCents: 10221, capturedDate: '2026-10-11', stale: false }] }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
    });
    const res = await svc.resolve('id1', 'accept', undefined, 'u1');
    expect(res.status).toBe('accepted');
    // ⭐ errata B: accept usa `promoteRobustReference` (NO-manual, source representativa), NO `applyManualOverride`.
    expect(pricing.promoteRobustReference).toHaveBeenCalledWith(
      expect.objectContaining({ cardId: 'c1', priceMxnCents: 10221, source: 'tcgdex' }),
    );
    expect(pricing.applyManualOverride).not.toHaveBeenCalled();
  });

  it('💰 manual ⇒ delega en applyManualOverride con el precio a mano y status manual', async () => {
    const { svc, pricing } = makeService({
      priceReviewCase: {
        findUnique: jest.fn().mockResolvedValue({ id: 'id1', status: 'open', cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'holofoil', proposedMxnCents: 10221, baselineMxnCents: 184 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });
    const res = await svc.resolve('id1', 'manual', 250, 'u1');
    expect(res.status).toBe('manual');
    expect(pricing.applyManualOverride).toHaveBeenCalledWith(expect.objectContaining({ priceMxnCents: 250 }));
  });

  it('💰 errata E · accept sobre caso con proposedMxnCents=0 ⇒ 422 y NO escribe fila de mercado $0', async () => {
    const { svc, pricing, prisma } = makeService({
      priceReviewCase: {
        findUnique: jest.fn().mockResolvedValue({ id: 'id1', status: 'open', cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'holofoil', proposedMxnCents: 0, baselineMxnCents: 184, quotesSnapshot: [] }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });
    await expect(svc.resolve('id1', 'accept', undefined, 'u1')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    // ⛔ money-safe: NO se promueve ninguna fila (ni se reclama el caso: la guarda va ANTES de la tx).
    expect(pricing.promoteRobustReference).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.priceReviewCase.updateMany).not.toHaveBeenCalled();
  });

  it('💰 errata E · keep SÍ es válido sobre un caso con proposedMxnCents=0 (conserva el último sano)', async () => {
    const { svc, pricing } = makeService({
      priceReviewCase: {
        findUnique: jest.fn().mockResolvedValue({ id: 'id1', status: 'open', cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'holofoil', proposedMxnCents: 0, baselineMxnCents: 184 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });
    const res = await svc.resolve('id1', 'keep', undefined, 'u1');
    expect(res.status).toBe('kept');
    expect(pricing.promoteRobustReference).not.toHaveBeenCalled();
    expect(pricing.applyManualOverride).not.toHaveBeenCalled();
  });
});

describe('💰 v1.114 (§DYN.5.9) — el caso VIGENTE es `open` o `kept`', () => {
  const VIGENTE = { in: ['open', 'kept'] };

  it('recordArbiterDecision deduplica contra `open` Y `kept` (no solo `open`)', async () => {
    const { svc, prisma } = makeService();
    await svc.recordArbiterDecision(KEY, 'sell', ROBUST_SINGLE, DECISION_REVIEW);
    expect(prisma.priceReviewCase.findFirst.mock.calls[0][0].where.status).toEqual(VIGENTE);
  });

  it('un `kept` con el MISMO candidato ⇒ nada (no nace otro `open`)', async () => {
    const { svc, prisma } = makeService({
      priceReviewCase: { findFirst: jest.fn().mockResolvedValue({ id: 'case-kept', status: 'kept', proposedMxnCents: 10221 }) },
    });
    expect(await svc.recordArbiterDecision(KEY, 'sell', ROBUST_SINGLE, DECISION_REVIEW)).toBe('case-kept');
    expect(prisma.priceReviewCase.create).not.toHaveBeenCalled();
    expect(prisma.priceReviewCase.updateMany).not.toHaveBeenCalled();
  });

  it('un `kept` con OTRO candidato que dispara ⇒ el vigente a `superseded` (guarda sobre open|kept) y nace un `open`', async () => {
    const { svc, prisma } = makeService({
      priceReviewCase: { findFirst: jest.fn().mockResolvedValue({ id: 'case-kept', status: 'kept', proposedMxnCents: 999 }) },
    });
    await svc.recordArbiterDecision(KEY, 'sell', ROBUST_SINGLE, DECISION_REVIEW);
    expect(prisma.priceReviewCase.updateMany).toHaveBeenCalledWith({
      where: { id: 'case-kept', status: VIGENTE },
      data: expect.objectContaining({ status: 'superseded' }),
    });
    expect(prisma.priceReviewCase.create.mock.calls[0][0].data).toMatchObject({ status: 'open', baselineMxnCents: 184 });
  });

  it('un `kept` cuyo candidato ya no dispara ⇒ `superseded` (fin de la retención)', async () => {
    const { svc, prisma } = makeService({
      priceReviewCase: { findFirst: jest.fn().mockResolvedValue({ id: 'case-kept', status: 'kept', proposedMxnCents: 10221 }) },
    });
    expect(await svc.recordArbiterDecision(KEY, 'sell', ROBUST_SINGLE, DECISION_PUBLISH)).toBeNull();
    expect(prisma.priceReviewCase.updateMany).toHaveBeenCalledWith({
      where: { id: 'case-kept', status: VIGENTE },
      data: expect.objectContaining({ status: 'superseded' }),
    });
  });

  it('abrir o renovar encola `review_open` de la variante (solo piezas con fila); mismo candidato o asentado ⇒ no', async () => {
    const lp = { enqueueVariant: jest.fn().mockResolvedValue(undefined) };
    const opened = makeService({}, lp);
    await opened.svc.recordArbiterDecision(KEY, 'sell', ROBUST_SINGLE, DECISION_REVIEW);
    expect(lp.enqueueVariant).toHaveBeenCalledWith(
      'review_open',
      { cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'holofoil' },
      { onlyWithRow: true },
    );
    lp.enqueueVariant.mockClear();
    const renewed = makeService({ priceReviewCase: { findFirst: jest.fn().mockResolvedValue({ id: 'o', proposedMxnCents: 999 }) } }, lp);
    await renewed.svc.recordArbiterDecision(KEY, 'sell', ROBUST_SINGLE, DECISION_REVIEW);
    expect(lp.enqueueVariant).toHaveBeenCalledTimes(1);
    lp.enqueueVariant.mockClear();
    const same = makeService({ priceReviewCase: { findFirst: jest.fn().mockResolvedValue({ id: 'o', proposedMxnCents: 10221 }) } }, lp);
    await same.svc.recordArbiterDecision(KEY, 'sell', ROBUST_SINGLE, DECISION_REVIEW);
    const settled = makeService({ priceReviewCase: { findFirst: jest.fn().mockResolvedValue({ id: 'o', proposedMxnCents: 10221 }) } }, lp);
    await settled.svc.recordArbiterDecision(KEY, 'sell', ROBUST_SINGLE, DECISION_PUBLISH);
    expect(lp.enqueueVariant).not.toHaveBeenCalled();
  });

  it('un caso de producto separado (cardProductId) no encola: el cuerpo de venta no lo lee', async () => {
    const lp = { enqueueVariant: jest.fn() };
    const { svc } = makeService({}, lp);
    await svc.recordArbiterDecision({ ...KEY, cardProductId: 'cp1' }, 'sell', ROBUST_SINGLE, DECISION_REVIEW);
    expect(lp.enqueueVariant).not.toHaveBeenCalled();
  });

  it('gate de compra: `vigenteCaseVariantKeySet` lee `open` y `kept`', async () => {
    const findMany = jest.fn().mockResolvedValue([{ cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'holofoil' }]);
    const { svc } = makeService({ priceReviewCase: { findMany } });
    const set = await svc.vigenteCaseVariantKeySet([KEY]);
    expect(set.has('c1|raw|raw:NM|holofoil')).toBe(true);
    expect(findMany.mock.calls[0][0].where.status).toEqual(VIGENTE);
  });

  it('`resolve` sigue exigiendo `open`: un `kept` no se puede aceptar (409)', async () => {
    const { svc, prisma } = makeService({
      priceReviewCase: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: 'id1', status: 'kept', cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'holofoil', proposedMxnCents: 10221, baselineMxnCents: 184 })
          .mockResolvedValueOnce({ status: 'kept', resolvedAt: new Date('2026-10-29') }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    });
    await expect(svc.resolve('id1', 'accept', undefined, 'u1')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(prisma.priceReviewCase.updateMany.mock.calls[0][0].where).toEqual({ id: 'id1', status: 'open' });
  });
});

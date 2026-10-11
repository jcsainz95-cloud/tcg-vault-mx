/**
 * price-review.service.spec.ts — v1.91⟨precios⟩ (M-75, §PRE.D/E/F) — guardas de la cola de revisión.
 * 💰 DINERO. Unit test con prisma mockeado (sin DB): 409 de doble resolución, 422 de action inválida,
 * 422 de `manual` sin precio, y la apertura/supersesión de casos del barrido.
 */
import { PriceReviewService, ReviewVariantKey } from '../src/modules/pricing/price-review.service';
import { RobustResult, LockDecision } from '../src/common/robust-market';

function makeService(prismaOverrides: any = {}) {
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
  };
  const audit: any = { log: jest.fn().mockResolvedValue(undefined) };
  const pricing: any = {
    applyManualOverride: jest.fn().mockResolvedValue({ ref: { id: 'ref-1' }, before: null }),
  };
  const svc = new PriceReviewService(prisma, audit, pricing);
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

  it('💰 accept ⇒ publica el propuesto como override tier 0 (vía existente) y status accepted', async () => {
    const { svc, pricing } = makeService({
      priceReviewCase: {
        findUnique: jest.fn().mockResolvedValue({ id: 'id1', status: 'open', cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'holofoil', proposedMxnCents: 10221, baselineMxnCents: 184 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
    });
    const res = await svc.resolve('id1', 'accept', undefined, 'u1');
    expect(res.status).toBe('accepted');
    expect(pricing.applyManualOverride).toHaveBeenCalledWith(
      expect.objectContaining({ cardId: 'c1', priceMxnCents: 10221 }),
    );
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
});

describe('openCaseVariantKeys — qué variantes están bloqueadas', () => {
  it('devuelve las claves de variante con caso open', async () => {
    const { svc } = makeService({
      priceReviewCase: {
        findMany: jest.fn().mockResolvedValue([
          { cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'holofoil', cardProductId: null, sealedProductId: null },
        ]),
      },
    });
    const set = await svc.openCaseVariantKeys([KEY]);
    expect(set.has('c1|raw|raw:NM|holofoil|∅|∅')).toBe(true);
  });
});

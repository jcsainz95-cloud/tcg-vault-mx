/**
 * 🔒 CANDADO — d4: conteo anónimo del cotizador (Brief 2 §2 d4, §6 criterio «d»; ARCHITECTURE §13.4.3).
 * 3 cálculos de la misma carta ⇒ 3 incrementos de `(día × cardId)`, SIN usuario, SIN IP.
 */
import { MarketingQuoteCounterService } from '../src/modules/marketing/marketing-quote-counter.service';

function mockPrisma() {
  const upsert = jest.fn().mockResolvedValue({});
  return { prisma: { buylistQuoteDailyCount: { upsert } } as never, upsert };
}

describe('MarketingQuoteCounterService.increment', () => {
  it('3 cálculos de la misma carta ⇒ 3 upsert con increment 1, misma (día, cardId)', async () => {
    const { prisma, upsert } = mockPrisma();
    const svc = new MarketingQuoteCounterService(prisma);
    const now = new Date('2026-10-16T18:00:00.000Z'); // 12:00 CDMX
    await svc.increment('card-xyz', now);
    await svc.increment('card-xyz', now);
    await svc.increment('card-xyz', now);
    expect(upsert).toHaveBeenCalledTimes(3);
    const arg = upsert.mock.calls[0][0];
    expect(arg.where.day_cardId.cardId).toBe('card-xyz');
    expect(arg.create).toEqual({ day: expect.any(Date), cardId: 'card-xyz', count: 1 });
    expect(arg.update).toEqual({ count: { increment: 1 } });
  });

  it('⛔ no guarda NADA del usuario ni de la IP (solo day + cardId + count)', async () => {
    const { prisma, upsert } = mockPrisma();
    const svc = new MarketingQuoteCounterService(prisma);
    await svc.increment('c1', new Date('2026-10-16T18:00:00.000Z'));
    const arg = upsert.mock.calls[0][0];
    const createKeys = Object.keys(arg.create).sort();
    expect(createKeys).toEqual(['cardId', 'count', 'day']);
    const blob = JSON.stringify(arg).toLowerCase();
    expect(blob).not.toContain('user');
    expect(blob).not.toContain('ip');
  });

  it('el día es el día civil de México (CDMX), no UTC', async () => {
    const { prisma, upsert } = mockPrisma();
    const svc = new MarketingQuoteCounterService(prisma);
    // 2026-10-17 04:00 UTC = 2026-10-16 22:00 CDMX ⇒ el día debe ser el 16, no el 17.
    await svc.increment('c1', new Date('2026-10-17T04:00:00.000Z'));
    const day: Date = upsert.mock.calls[0][0].create.day;
    expect(day.toISOString().slice(0, 10)).toBe('2026-10-16');
  });

  it('un fallo de BD NO propaga (best-effort: no tumba la cotización)', async () => {
    const upsert = jest.fn().mockRejectedValue(new Error('db down'));
    const svc = new MarketingQuoteCounterService({ buylistQuoteDailyCount: { upsert } } as never);
    await expect(svc.increment('c1')).resolves.toBeUndefined();
  });
});

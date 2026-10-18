import { ConfigService } from '@nestjs/config';
import { CardShowBudgetService } from '../src/modules/card-show/card-show-budget.service';
import {
  CardShowCounterStore,
  MemoryCardShowCounterStore,
} from '../src/modules/card-show/card-show-counter.store';

function budgetWith(store: CardShowCounterStore, hour = 10, day = 20): CardShowBudgetService {
  const config = {
    get: (k: string) => (k === 'CARD_SHOW_CONFIRM_BUDGET_HOUR' ? String(hour) : k === 'CARD_SHOW_CONFIRM_BUDGET_DAY' ? String(day) : undefined),
  } as unknown as ConfigService;
  return new CardShowBudgetService(store, config);
}

/** §CARDSHOW.7 (C1) — presupuesto global de envíos (staging HOUR=10, DAY=20). */
describe('CARDSHOW · presupuesto global (C1)', () => {
  it('11 reservas/1 h ⇒ 10 permitidas; la 11.ª cortada; 1 alerta al 50 % (5.ª) y 1 al corte', async () => {
    const now = 1_700_000_000_000;
    const store = new MemoryCardShowCounterStore(() => now);
    const svc = budgetWith(store, 10, 20);
    const decisions = [];
    for (let i = 0; i < 11; i += 1) decisions.push(await svc.tryReserve(now));
    const allowed = decisions.filter((d) => d.allowed).length;
    expect(allowed).toBe(10);
    expect(decisions[10].allowed).toBe(false);
    expect(decisions[10].failClosed).toBe(false);
    // exactamente UNA alerta de 50 % (en la 5.ª reserva) y UNA de corte (en la 11.ª).
    expect(decisions.filter((d) => d.crossed50).length).toBe(1);
    expect(decisions[4].crossed50).toBe(true);
    expect(decisions.filter((d) => d.cut).length).toBe(1);
    expect(decisions[10].cut).toBe(true);
  });

  it('Redis caído ⇒ fail-CLOSED: allowed=false, failClosed=true, 0 cuentas', async () => {
    const throwing: CardShowCounterStore = {
      hit: async () => { throw new Error('redis down'); },
      count: async () => { throw new Error('redis down'); },
      ttlMs: async () => { throw new Error('redis down'); },
      reserveBudget: async () => { throw new Error('redis down'); },
      reserve: async () => { throw new Error('redis down'); },
      claimOnce: async () => { throw new Error('redis down'); },
      setFlag: async () => undefined,
      clearFlag: async () => undefined,
      flag: async () => false,
    };
    const svc = budgetWith(throwing, 10, 20);
    const d = await svc.tryReserve(Date.now());
    expect(d.allowed).toBe(false);
    expect(d.failClosed).toBe(true);
  });
});

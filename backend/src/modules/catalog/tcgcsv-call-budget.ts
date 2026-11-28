/**
 * §AUTO-ENLACE fase 2 — presupuesto de llamadas a TCGCSV de UNA corrida de `catalog-auto-link` (DECISIONES §AUTO-ENLACE 1 y 4).
 *  - Tope de llamadas (incluye el reintento y `listGroups`): llegado el tope, ninguna llamada más (`BudgetExhaustedError`).
 *  - 1 reintento por llamada, con espera; cada intento cuenta contra el tope.
 *  - Disyuntor: `breakerAt` llamadas que fallan SEGUIDAS (ya con su reintento) ⇒ la corrida se aborta (`CircuitOpenError`).
 *  - Plazo (30 min): pasado el plazo, ninguna llamada más (`DeadlineError`).
 * No decide nada de dinero: solo cuenta y corta. Las escrituras de un set ocurren DESPUÉS de bajar sus datos ⇒ un corte nunca deja un set a medias.
 */
export class BudgetExhaustedError extends Error {
  constructor() {
    super('tcgcsv_budget_exhausted');
  }
}
export class CircuitOpenError extends Error {
  constructor() {
    super('tcgcsv_circuit_open');
  }
}
export class DeadlineError extends Error {
  constructor() {
    super('tcgcsv_deadline');
  }
}

export interface TcgcsvCallBudgetOptions {
  max: number;
  breakerAt?: number;
  retryDelayMs?: number;
  /** Instante (ms epoch) a partir del cual no se hacen más llamadas. */
  deadlineAt?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class TcgcsvCallBudget {
  used = 0;
  /** Llamadas fallidas seguidas (cada una ya con su reintento). */
  consecutiveFailures = 0;
  private readonly max: number;
  private readonly breakerAt: number;
  private readonly retryDelayMs: number;
  private readonly deadlineAt: number | undefined;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(o: TcgcsvCallBudgetOptions) {
    this.max = o.max;
    this.breakerAt = o.breakerAt ?? 3;
    this.retryDelayMs = o.retryDelayMs ?? 2000;
    this.deadlineAt = o.deadlineAt;
    this.now = o.now ?? Date.now;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get remaining(): number {
    return Math.max(0, this.max - this.used);
  }

  get tripped(): boolean {
    return this.consecutiveFailures >= this.breakerAt;
  }

  private guard(): void {
    if (this.tripped) throw new CircuitOpenError();
    if (this.deadlineAt != null && this.now() >= this.deadlineAt) throw new DeadlineError();
    if (this.used >= this.max) throw new BudgetExhaustedError();
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    this.guard();
    this.used += 1;
    try {
      const r = await fn();
      this.consecutiveFailures = 0;
      return r;
    } catch (first) {
      // 1 reintento con espera, solo si el tope y el plazo lo permiten (el propio intento cuenta).
      try {
        await this.sleep(this.retryDelayMs);
        this.guard();
      } catch {
        this.consecutiveFailures += 1;
        throw first;
      }
      this.used += 1;
      try {
        const r = await fn();
        this.consecutiveFailures = 0;
        return r;
      } catch (second) {
        this.consecutiveFailures += 1;
        throw second;
      }
    }
  }
}

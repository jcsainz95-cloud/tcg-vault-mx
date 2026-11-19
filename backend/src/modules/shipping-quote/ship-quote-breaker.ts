/**
 * ship-quote-breaker.ts — disyuntor del cotizador en vivo (DECISIONES punto 4): `maxFailures` fallos en `windowMs` ⇒ abierto
 * `openMs` (todo va directo a la tabla). Por proceso. PURO con reloj inyectado.
 */
export class ShipQuoteBreaker {
  private failures: number[] = [];
  private openUntil = 0;

  constructor(
    private readonly maxFailures = 5,
    private readonly windowMs = 60_000,
    private readonly openMs = 120_000,
  ) {}

  isOpen(nowMs: number): boolean {
    return nowMs < this.openUntil;
  }

  recordFailure(nowMs: number): void {
    this.failures = this.failures.filter((t) => nowMs - t < this.windowMs);
    this.failures.push(nowMs);
    if (this.failures.length >= this.maxFailures) {
      this.openUntil = nowMs + this.openMs;
      this.failures = [];
    }
  }

  recordSuccess(): void {
    this.failures = [];
  }
}

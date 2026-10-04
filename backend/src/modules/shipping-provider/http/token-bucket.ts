/**
 * token-bucket.ts — ≤ `SKYDROPX_RPS` peticiones por segundo POR PROCESO, delante de TODA petición a la API de
 * Skydropx: token, cotización, cada consulta del sondeo, compra, rastreo y descarga de etiqueta al host de la API
 * (API_CONTRACT §M4-SHIP.19.19.3 (3)).
 *
 * Forma: cubeta de capacidad **1** que se rellena cada `1000/rps` ms — es decir, entre dos salidas hay al menos
 * `1000/rps` ms (con `rps = 2`, ≥ 500 ms: lo que PS-93 aserta). Una capacidad igual a `rps` permitiría ráfagas de 2
 * en el mismo milisegundo, que cumplen «2 por segundo» en promedio pero no el espaciado medido (la medición usó
 * ≥ 0.6 s entre peticiones, PROD §0). La reserva del turno es SÍNCRONA: N llamadas concurrentes reciben N turnos
 * distintos sin carrera.
 */
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))),
};

export class TokenBucket {
  private readonly intervalMs: number;
  private nextSlotAt = Number.NEGATIVE_INFINITY;

  constructor(
    ratePerSecond: number,
    private readonly clock: Clock,
  ) {
    const rps = Number.isFinite(ratePerSecond) && ratePerSecond > 0 ? ratePerSecond : 2;
    this.intervalMs = 1000 / rps;
  }

  /** Espera su turno. Resuelve cuando la petición puede salir. */
  async acquire(): Promise<void> {
    const now = this.clock.now();
    const slot = Math.max(now, this.nextSlotAt);
    this.nextSlotAt = slot + this.intervalMs;
    const wait = slot - now;
    if (wait > 0) await this.clock.sleep(wait);
  }
}

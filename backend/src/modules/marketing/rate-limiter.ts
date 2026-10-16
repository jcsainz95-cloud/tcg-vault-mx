/**
 * rate-limiter.ts — 🔒 ventanas deslizantes en memoria para el token `marketing-reader`
 * (Brief 2 §7.2, PM-M1; ARCHITECTURE §13.4.2). PURO (reloj inyectado).
 *
 * - **60 peticiones/hora por token** ⇒ 429 al pasarlas.
 * - **10 fallos de token por IP en 10 min** ⇒ bloqueo temporal de esa IP (429) mientras dure la ventana.
 *
 * Almacén en memoria por instancia (devops puede moverlo a Redis en multi-instancia, igual que el
 * throttler global). No requiere tabla (ARCHITECTURE §13.4.2).
 */

export class SlidingWindowCounter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number,
    private readonly limit: number,
  ) {}

  private prune(key: string, nowMs: number): number[] {
    const cutoff = nowMs - this.windowMs;
    const kept = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (kept.length > 0) this.hits.set(key, kept);
    else this.hits.delete(key);
    return kept;
  }

  /** Nº de eventos vigentes en la ventana para `key`. */
  count(key: string, nowMs: number): number {
    return this.prune(key, nowMs).length;
  }

  /** Registra un evento en `now`. */
  record(key: string, nowMs: number): void {
    const kept = this.prune(key, nowMs);
    kept.push(nowMs);
    this.hits.set(key, kept);
  }

  /**
   * Registra y dice si, TRAS registrar, se superó el límite. Para el límite por token: devuelve true
   * cuando esta petición ya es la (limit+1)-ésima o posterior dentro de la ventana.
   */
  recordAndExceeded(key: string, nowMs: number): boolean {
    this.record(key, nowMs);
    return this.count(key, nowMs) > this.limit;
  }

  /** ¿`key` ya alcanzó el límite (p. ej. IP con ≥N fallos)? */
  atLimit(key: string, nowMs: number): boolean {
    return this.count(key, nowMs) >= this.limit;
  }
}

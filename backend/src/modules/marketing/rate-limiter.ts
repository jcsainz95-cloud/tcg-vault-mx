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

/** Cota dura de claves vigiladas por contador (MKT-TL1). */
export const DEFAULT_MAX_KEYS = 10_000;

/**
 * MKT-TL1 (memoria acotada): (1) **barrido** de todas las claves caducadas como mucho una vez por ventana (una IP
 * que no vuelve se borra igual); (2) **cota dura** `maxKeys`: al entrar una clave nueva con el Map lleno se expulsa
 * la MÁS VIEJA (orden de inserción del Map). ⚠️ Con miles de IPs distintas dentro de la misma ventana, la expulsión
 * puede olvidar los fallos de una IP vieja: quien rota IPs ya esquiva el bloqueo por IP de todas formas; lo que no
 * puede es tumbar el proceso por memoria.
 */
export class SlidingWindowCounter {
  private readonly hits = new Map<string, number[]>();
  private lastSweep = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly windowMs: number,
    private readonly limit: number,
    private readonly maxKeys: number = DEFAULT_MAX_KEYS,
  ) {}

  /** Nº de claves vigiladas (para el candado de memoria). */
  size(): number {
    return this.hits.size;
  }

  private sweep(nowMs: number): void {
    if (nowMs - this.lastSweep < this.windowMs) return;
    this.lastSweep = nowMs;
    const cutoff = nowMs - this.windowMs;
    for (const [key, ts] of this.hits) if (ts[ts.length - 1] <= cutoff) this.hits.delete(key);
  }

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
    this.sweep(nowMs);
    const kept = this.prune(key, nowMs);
    kept.push(nowMs);
    if (!this.hits.has(key)) {
      while (this.hits.size >= this.maxKeys) {
        const oldest = this.hits.keys().next().value as string;
        this.hits.delete(oldest);
      }
    }
    // delete + set ⇒ la clave pasa al final del orden de inserción (la expulsión es por última actividad).
    this.hits.delete(key);
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

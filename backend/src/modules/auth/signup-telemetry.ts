/**
 * v1.117⟨cuenta-correo⟩ (API_CONTRACT §CTA.4 «Telemetría») — el `409 EMAIL_TAKEN` del alta es un oráculo de existencia
 * aceptado por el dueño; se acota con los throttlers y se OBSERVA aquí: cuando una IP pasa de 10 `409` en 24 h, UN
 * `logger.warn` agregado con 12 caracteres del HMAC de la IP (como C7). ⛔ Ni correo ni IP en claro. Sin bloqueo extra.
 *
 * En memoria del proceso (por réplica), como el `ThrottlerModule`: es una señal para que seguridad mida, no una compuerta.
 * Tamaño acotado: solo guarda IPs con algún `409` en las últimas 24 h y poda al registrar.
 */
export const SIGNUP_CONFLICT_WARN_THRESHOLD = 10;
const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_TRACKED_IPS = 10_000;

export class SignupConflictTelemetry {
  private readonly hits = new Map<string, { at: number[]; warned: boolean }>();

  constructor(
    /** HMAC de la IP (hex). Solo se imprimen sus 12 primeros caracteres. */
    private readonly fingerprint: (ip: string) => string,
    private readonly logger: { warn(msg: string): void },
  ) {}

  record(ip: string | null | undefined, now = Date.now()): void {
    if (!ip) return;
    const fp = this.fingerprint(ip);
    const cur = this.hits.get(fp) ?? { at: [], warned: false };
    cur.at = cur.at.filter((t) => now - t < WINDOW_MS);
    if (cur.at.length === 0) cur.warned = false;
    cur.at.push(now);
    if (!this.hits.has(fp) && this.hits.size >= MAX_TRACKED_IPS) this.prune(now);
    this.hits.set(fp, cur);
    if (cur.at.length > SIGNUP_CONFLICT_WARN_THRESHOLD && !cur.warned) {
      cur.warned = true;
      this.logger.warn(
        `SIGNUP_EMAIL_TAKEN_BURST ip=${fp.slice(0, 12)} count=${cur.at.length} window=24h (alta con solo el correo, §CTA.4)`,
      );
    }
  }

  private prune(now: number): void {
    for (const [k, v] of this.hits) {
      if (v.at.every((t) => now - t >= WINDOW_MS)) this.hits.delete(k);
    }
    // Si aun así está lleno, se suelta la más vieja (Map conserva el orden de inserción).
    if (this.hits.size >= MAX_TRACKED_IPS) {
      const first = this.hits.keys().next();
      if (!first.done) this.hits.delete(first.value);
    }
  }
}

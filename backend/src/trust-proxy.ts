/**
 * trust-proxy.ts — `trust proxy` de Express, en UN sitio que `main.ts` y el arnés E2E comparten y que
 * una prueba puede importar (`main.ts` no: arranca el servidor al importarse). C7-18 (v1.80).
 *
 * `1` = un solo salto de proxy (el edge de Railway, sin Cloudflare delante del backend —
 * DEVOPS_NOTES §23.2/§25.3). Con `1`, `req.ip` es la ÚLTIMA entrada de `X-Forwarded-For` (la que
 * añade el edge), y eso es lo que usa el tracker del throttler por IP.
 * ⛔ **Nunca `true`**: con `true`, `req.ip` es la PRIMERA entrada, la que escribe el cliente — el
 * atacante elegiría su propio cubo del throttler con una cabecera (`SECURITY_NOTES` `P-RL-1`).
 * Si devops mete otro proxy delante, se ajusta el número de saltos aquí.
 */
export const TRUST_PROXY_HOPS = 1;

export function applyTrustProxy(app: { set(setting: string, value: unknown): unknown }): void {
  app.set('trust proxy', TRUST_PROXY_HOPS);
}

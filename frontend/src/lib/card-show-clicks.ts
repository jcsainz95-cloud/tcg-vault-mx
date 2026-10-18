/**
 * Contador de clics de PRIMERA PARTE del Card Show (API_CONTRACT §CARDSHOW.13, ARCHITECTURE
 * §4.CARDSHOW.j).
 *
 * ⛔ Sin cookie, sin IP, sin user-agent. ⛔ NO es GA4/GTM/Meta (eso es §MKT, otro frente): aquí NO
 * se carga ningún script de terceros. Solo un `POST /api/v1/card-show/click` propio vía
 * `navigator.sendBeacon` (o `fetch` con `keepalive` de respaldo), con `{ destino, mesa?, utm_source,
 * utm_content }`. El `/card-show/ir/:destino` (redirección contada) es la alternativa para enlaces
 * salientes.
 */
import { config } from './config';

export interface ClickPayload {
  destino: string;
  mesa?: number;
}

/** Lee `utm_source`/`utm_content` de la URL actual (nada más: §CARDSHOW.13). */
function utmFromLocation(): { utm_source?: string; utm_content?: string } {
  if (typeof window === 'undefined') return {};
  const q = new URLSearchParams(window.location.search);
  const out: { utm_source?: string; utm_content?: string } = {};
  const s = q.get('utm_source');
  const c = q.get('utm_content');
  if (s) out.utm_source = s;
  if (c) out.utm_content = c;
  return out;
}

/** Cuenta un clic de primera parte. No bloquea la navegación y nunca lanza. */
export function trackClick({ destino, mesa }: ClickPayload): void {
  if (typeof window === 'undefined') return;
  const body = JSON.stringify({ destino, ...(mesa !== undefined ? { mesa } : {}), ...utmFromLocation() });
  const endpoint = config.apiBaseUrl + '/card-show/click';
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      // sendBeacon sobrevive a la navegación de salida; el tipo es texto plano para no disparar
      // un preflight CORS (el backend lee el cuerpo como JSON igual).
      const ok = navigator.sendBeacon(endpoint, new Blob([body], { type: 'text/plain;charset=UTF-8' }));
      if (ok) return;
    }
    void fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      cache: 'no-store',
    }).catch(() => {});
  } catch {
    /* la medición es una mejora, no un requisito: un fallo no afecta la landing */
  }
}

/** URL de redirección contada para un enlace saliente (`GET /card-show/ir/:destino` ⇒ 302). */
export function trackedHref(destino: string): string {
  return config.apiBaseUrl + '/card-show/ir/' + encodeURIComponent(destino);
}

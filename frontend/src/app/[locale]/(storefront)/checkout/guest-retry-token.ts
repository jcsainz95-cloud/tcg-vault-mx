/**
 * `checkoutToken` del INVITADO para el reintento (contrato v1.68, §4-R.3).
 *
 * Es la ÚNICA llave con la que un invitado recupera su propia reserva tras un intento caído: viaja
 * como `retryOfCheckoutToken` en el body de `POST /checkout/guest/session` y el servidor responde
 * `200 reused` (mismo pedido, mismo PI) o `201` con `supersededOrderIds`. Sin él, su propia reserva
 * cuenta como ajena (`409 ITEM_UNAVAILABLE`) hasta que venza el TTL.
 *
 * Reglas del contrato que este módulo hace cumplir:
 *  - **`sessionStorage`** (ámbito pestaña), ⛔ nunca `localStorage` compartido (§4-G.2/§4-R.3).
 *  - Se envía **solo** en el body, nunca en URL.
 *  - Caduca con `checkoutTokenExpiresAt` (120 min): un token vencido no se manda — el servidor lo
 *    trataría como «sin reclamo» y la respuesta sería la misma que sin token.
 *  - Se borra al confirmar el pago: un pedido pagado ya no se «reintenta».
 *  - v1.68.1: se guarda también el CORREO con el que se emitió, porque el QUOTE exige token + email
 *    (§4-R.5) y tras recargar la pestaña el formulario está vacío: sin el correo guardado, el primer
 *    quote iría sin reclamo, la reserva propia saldría «ajena» y el front la podaría antes de que el
 *    invitado pudiera reescribirlo. Es su propio correo, en su propia pestaña.
 */

export const GUEST_RETRY_TOKEN_KEY = 'tcg.guestCheckoutRetry';

interface StoredRetryToken {
  token: string;
  /** ISO — `checkoutTokenExpiresAt` de la respuesta que lo emitió. */
  expiresAt: string;
  /** Correo normalizado con el que se creó el pedido (v1.68.1); ausente en sobres anteriores. */
  email?: string;
}

export interface GuestRetry {
  token: string;
  email: string;
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function saveGuestRetryToken(token: string, expiresAt: string, email?: string): void {
  if (!token) return;
  const normalized = email?.trim().toLowerCase();
  const payload: StoredRetryToken = { token, expiresAt, ...(normalized ? { email: normalized } : {}) };
  try {
    storage()?.setItem(GUEST_RETRY_TOKEN_KEY, JSON.stringify(payload));
  } catch {
    /* sin sessionStorage (modo privado estricto): el reintento simplemente no reclama */
  }
}

/** El token vigente, o `null` si no hay, está malformado o ya venció (y entonces se purga). */
export function readGuestRetryToken(now = Date.now()): string | null {
  return readGuestRetry(now)?.token ?? null;
}

/**
 * Token + correo para el QUOTE (§4-R.5: los dos o ninguno). `email: ''` cuando el sobre es anterior
 * a v1.68.1 (sin correo): el llamador decide si ya tiene un correo confirmado que poner.
 */
export function readGuestRetry(now = Date.now()): GuestRetry | null {
  const raw = storage()?.getItem(GUEST_RETRY_TOKEN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredRetryToken>;
    if (typeof parsed.token !== 'string' || parsed.token === '') {
      clearGuestRetryToken();
      return null;
    }
    const exp = typeof parsed.expiresAt === 'string' ? new Date(parsed.expiresAt).getTime() : NaN;
    if (!Number.isFinite(exp) || exp <= now) {
      clearGuestRetryToken();
      return null;
    }
    return { token: parsed.token, email: typeof parsed.email === 'string' ? parsed.email : '' };
  } catch {
    clearGuestRetryToken();
    return null;
  }
}

export function clearGuestRetryToken(): void {
  try {
    storage()?.removeItem(GUEST_RETRY_TOKEN_KEY);
  } catch {
    /* nada que borrar */
  }
}

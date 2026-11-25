/**
 * §CELULAR-ALTA (`docs/API_CONTRACT_CELULAR.md` §6.2/§6.9): punto único del paso «Completa tu cuenta» de Google y de
 * los eventos `signup_phone_*`. SUPUESTOS por confirmar con backend: forma de `pendingSignup` y `POST /auth/google/complete`
 * (ver `GooglePendingSignup` en `types/contract.ts`).
 *
 * ⛔ El `signupToken` vive SOLO en `sessionStorage` (vida de la pestaña; el servidor lo vence a los 15 min): nunca en la
 * URL, en `localStorage`, en medición ni en logs. ⛔ Los eventos llevan `method`, jamás el celular.
 */
import { track, type BrowserEvent } from '../measurement/track';

const KEY = 'tcg.googleSignup';

export interface GoogleSignupStash {
  signupToken: string;
  email: string;
  name: string;
}

export function stashGoogleSignup(p: { signupToken: string; email: string; name: string }): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ signupToken: p.signupToken, email: p.email, name: p.name }));
  } catch {
    /* sin almacenamiento ⇒ la pantalla dirá «vuelve a empezar» */
  }
}

export function readGoogleSignup(): GoogleSignupStash | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<GoogleSignupStash>;
    return typeof v.signupToken === 'string' && v.signupToken ? { signupToken: v.signupToken, email: v.email ?? '', name: v.name ?? '' } : null;
  } catch {
    return null;
  }
}

export function clearGoogleSignup(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* nada */
  }
}

export type SignupPhoneMethod = 'password' | 'google' | 'checkout';

/** `signup_phone_shown` / `signup_phone_done` por método. Lista cerrada de parámetros: solo `method`. */
export function trackSignupPhone(stage: 'shown' | 'done', method: SignupPhoneMethod): void {
  track(`signup_phone_${stage}` as BrowserEvent, { method });
}

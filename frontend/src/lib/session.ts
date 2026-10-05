'use client';

import { useEffect, useState } from 'react';
import type { UserDTO } from '@/types/contract';

/**
 * Sesión de cliente. El access token vive en `tcg.accessToken` (api-client);
 * aquí guardamos el `user` de `AuthResponse` (contrato §1) para pintar el header
 * sin volver a pegarle al backend. Sigue el mismo patrón que `useCart`:
 * localStorage + un evento para reactividad entre componentes/pestañas.
 */
const USER_KEY = 'tcg.user';
const EVENT = 'tcg.session.changed';

export function getStoredUser(): UserDTO | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as UserDTO) : null;
  } catch {
    return null;
  }
}

/** Persiste (o limpia) el usuario y notifica a los `useSession` montados. */
export function setStoredUser(user: UserDTO | null) {
  if (typeof window === 'undefined') return;
  if (user) window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  else window.localStorage.removeItem(USER_KEY);
  window.dispatchEvent(new Event(EVENT));
}

/**
 * Aplica un parche parcial al usuario en sesión (si hay uno) y notifica.
 * Se usa, p. ej., para marcar `emailVerified=true` tras verificar el correo
 * sin re-consultar `GET /users/me`. No-op si no hay sesión local.
 */
export function patchStoredUser(patch: Partial<UserDTO>) {
  const current = getStoredUser();
  if (!current) return;
  setStoredUser({ ...current, ...patch });
}

/**
 * QA2-1 (2026-09-11; FE-34 de TECH_DEBT extendida a `/account`): al cerrar sesión, `logout()` vacía la
 * sesión ANTES de que el llamador navegue, y los guards (`PrivateRouteGuard`, `AdminShell`) ven
 * `ready && !isAuthenticated` y ganan la carrera con `/login?next=<ruta recién cerrada>`. Medido 6/6
 * contra el stack real (`/es/account` → `login?next=%2Faccount`; `/es/admin` → `login?next=%2Fadmin`).
 *
 * La señal: `logout()` marca «logout intencional» y, mientras dure la ventana, los guards NO redirigen
 * (pintan su carga y dejan que el llamador aterrice donde decidió: `/login` en el panel y la página de
 * contraseña, `/` en la sección «Sesión» de la tienda — DS §33.6g). Un vaciado por 401 (refresh muerto)
 * NO marca nada: ahí el `next` sigue siendo correcto. Ventana temporal y no «consumo» porque el efecto
 * del guard puede correr más de una vez antes de que el `router.replace` del llamador tome efecto.
 */
let intentionalLogoutAt = 0;
const INTENTIONAL_LOGOUT_WINDOW_MS = 10_000;

/** La llama `logout()` (lib/api.ts) antes de tocar la red y de vaciar la sesión. */
export function markIntentionalLogout() {
  intentionalLogoutAt = Date.now();
}

/** `true` mientras un logout intencional está en curso (ventana desde `markIntentionalLogout`). */
export function isLogoutInProgress(now: number = Date.now()): boolean {
  return intentionalLogoutAt > 0 && now - intentionalLogoutAt < INTENTIONAL_LOGOUT_WINDOW_MS;
}

/** Solo para tests. */
export function resetIntentionalLogoutForTests() {
  intentionalLogoutAt = 0;
}

/**
 * LIVE-2 pantalla (API_CONTRACT v1.84 §14.2 «Frontend», v1.84.2 §14.15 E2-4; DESIGN_SYSTEM §81.2 F-3;
 * FRONTEND_NOTES §94): el `401` de `POST /auth/refresh` con `details.reason === 'session_max_age'`
 * (tope absoluto de vida de la sesión) deja esta marca. Los guards (`PrivateRouteGuard`, `AdminShell`)
 * siguen redirigiendo como hoy a `/login?next=<ruta>` —no se tocan—, y es el LOGIN (`AuthForm`) quien
 * la consume y añade `reason=session_max_age` a su URL para pintar «Tu sesión caducó por seguridad».
 *
 * De UN SOLO USO (la consume el primer login que la lee) y con ventana: si el refresh muere en una
 * página pública (sin guard, §81.6 N-2) y el usuario entra al login mucho después, el aviso ya no se
 * afirma. Vive en memoria del módulo, como `markIntentionalLogout`: solo la pestaña que recibió el
 * motivo puede afirmarlo (§81.2.6); otras pestañas llegan al login como hoy.
 */
let sessionMaxAgeAt = 0;
const SESSION_MAX_AGE_MARK_WINDOW_MS = 10_000;

/** La llama el interceptor de refresh (`lib/api-client.ts`) al leer `reason: 'session_max_age'`. */
export function markSessionMaxAgeLogout(now: number = Date.now()) {
  sessionMaxAgeAt = now;
}

/** `true` si hay una marca vigente; la borra en cualquier caso (un solo uso). */
export function consumeSessionMaxAgeLogout(now: number = Date.now()): boolean {
  const at = sessionMaxAgeAt;
  sessionMaxAgeAt = 0;
  return at > 0 && now - at >= 0 && now - at < SESSION_MAX_AGE_MARK_WINDOW_MS;
}

/** Solo para tests. */
export function resetSessionMaxAgeLogoutForTests() {
  sessionMaxAgeAt = 0;
}

export interface SessionState {
  user: UserDTO | null;
  isAuthenticated: boolean;
  /**
   * `false` durante SSR y en el PRIMER render de cliente; pasa a `true` tras el
   * efecto de montaje. El header debe pintar el estado deslogueado mientras
   * `ready` sea `false` para evitar mismatch de hidratación de Next.
   */
  ready: boolean;
}

/** Hook reactivo de sesión de cliente (perfil + estado autenticado). */
export function useSession(): SessionState {
  const [user, setUser] = useState<UserDTO | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setUser(getStoredUser());
    setReady(true);
    const handler = () => setUser(getStoredUser());
    window.addEventListener(EVENT, handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener(EVENT, handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  return { user, isAuthenticated: !!user, ready };
}

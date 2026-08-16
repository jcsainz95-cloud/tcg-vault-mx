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

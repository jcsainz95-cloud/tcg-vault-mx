'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from '@/i18n/navigation';
import { useSession } from '@/lib/session';
import { logout } from '@/lib/api';

/** Umbral de inactividad tras el cual se cierra la sesión (5 minutos). */
export const INACTIVITY_LOGOUT_MS = 5 * 60 * 1000;

/** Eventos de actividad del usuario que reinician el temporizador. */
const ACTIVITY_EVENTS = [
  'mousemove',
  'mousedown',
  'keydown',
  'scroll',
  'touchstart',
] as const;

/**
 * Cierra la sesión automáticamente tras `INACTIVITY_LOGOUT_MS` sin actividad, para
 * TODOS los usuarios (storefront + admin, cualquier rol). Se monta alto (dentro de
 * `Providers`) para cubrir toda la app.
 *
 * - Se reinicia con `mousemove/mousedown/keydown/scroll/touchstart` y al volver la
 *   pestaña visible (`visibilitychange`).
 * - Solo actúa cuando hay sesión activa (`isAuthenticated`).
 * - Al expirar ejecuta `logout()` (limpia token+user server/local) y redirige a
 *   `/login?reason=inactivity`. El `logout()` emite el evento de sesión, así que
 *   otras pestañas también quedan deslogueadas (sync entre pestañas).
 */
export function InactivityProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useSession();
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;

    function clearTimer() {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    async function triggerLogout() {
      clearTimer();
      await logout();
      router.replace({ pathname: '/login', query: { reason: 'inactivity' } });
    }

    function reset() {
      clearTimer();
      timerRef.current = setTimeout(() => void triggerLogout(), INACTIVITY_LOGOUT_MS);
    }

    function onVisibility() {
      // Al volver a la pestaña contamos actividad y reiniciamos el temporizador.
      if (document.visibilityState === 'visible') reset();
    }

    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, reset, { passive: true });
    }
    document.addEventListener('visibilitychange', onVisibility);
    reset(); // arranca el temporizador al montar / al iniciar sesión

    return () => {
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, reset);
      document.removeEventListener('visibilitychange', onVisibility);
      clearTimer();
    };
  }, [isAuthenticated, router]);

  return <>{children}</>;
}

'use client';

import { useEffect } from 'react';

/**
 * Primitiva ligera de "mantener viva la sesión" durante operaciones largas de la app.
 *
 * Vive en su propio módulo (sin dependencias de router/next-intl) para poder usarse desde
 * cualquier pantalla sin arrastrar el árbol de navegación. El `InactivityProvider`
 * (`@/lib/inactivity`) escucha `ACTIVITY_PING_EVENT` y reinicia su temporizador de inactividad.
 */

/**
 * Evento sintético de "actividad" que la app emite cuando trabaja POR el usuario en una
 * operación larga (p. ej. un barrido de catálogo): no es un clic real, pero cuenta como
 * actividad para NO cerrar la sesión por inactividad mientras la operación corre.
 */
export const ACTIVITY_PING_EVENT = 'app:activity-ping';

/** Emite un ping de actividad → reinicia el temporizador de inactividad del `InactivityProvider`. */
export function pingActivity() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ACTIVITY_PING_EVENT));
  }
}

/**
 * Mantiene viva la sesión mientras `active` sea true, emitiendo un ping de actividad de
 * inmediato y luego cada `intervalMs` (default 60 s ≪ 5 min del umbral de inactividad).
 * Úsalo en pantallas con operaciones largas que corren sin interacción del usuario
 * (barridos, importaciones) para que el auto-logout por inactividad NO interrumpa la
 * operación. Al pasar a `active=false` (operación terminada) el temporizador de inactividad
 * vuelve a comportarse normal.
 */
export function useKeepSessionAlive(active: boolean, intervalMs = 60_000) {
  useEffect(() => {
    if (!active) return;
    pingActivity(); // ping inmediato al empezar
    const id = setInterval(pingActivity, intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
}

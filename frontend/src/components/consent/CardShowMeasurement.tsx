'use client';

import { useEffect, useMemo, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { measurementActive, measurementIdsFromEnv } from '@/lib/measurement/mode';
import { consentForRoute, isMeasuredPath, sendsPageView } from '@/lib/measurement/routes';
import { documentCookieJar, readConsent } from '@/lib/measurement/consent';
import { flushPendingEvents, setRuntimeConsent, track } from '@/lib/measurement/track';
import { measurementLoadedInDocument, useHardNavigationGuard } from './hard-navigation';
import { noticeVersionForBuild } from './notice-version';

/**
 * ARCHITECTURE §14.4 (D-MKT2-9) · API_CONTRACT §MKT.H.11 C-F9 — la medición del árbol raíz de `/card-show`.
 *
 * `/card-show` vive fuera de `[locale]`, así que el `MeasurementProvider` de la tienda no la envuelve. Este
 * montaje es deliberadamente MENOR:
 *  - con el modo `off` horneado no pinta nada ni entra código (C-F1: el `import()` del cargador va bajo la
 *    guarda literal);
 *  - ⛔ **sin banner**: la landing no pregunta. Solo honra una elección YA guardada en `th_consent` (misma
 *    versión del aviso; misma cookie de la tienda, `Path=/`). Sin elección ⇒ nada se carga (Consent Mode
 *    básico: nada antes de elegir). El banner propio de la landing no está diseñado (DESIGN_SYSTEM MKT2-UX no
 *    lo cubre): solicitud a ux-ui/arquitecto en FRONTEND_NOTES §MKT2;
 *  - solo GA4 y solo `page_view` (sin eventos de formulario: nombre, teléfono, menores). Meta NUNCA carga
 *    aquí aunque el visitante la haya aceptado en la tienda (P-CS-MEDIR-1, por defecto no): `consentForRoute`;
 *  - navegación dura hacia `confirm`/`cancel`/`unsubscribe` (llevan token) con la misma guarda que la tienda.
 */
export function CardShowMeasurement() {
  return process.env.NEXT_PUBLIC_MEASUREMENT_MODE === 'on' ? <ActiveCardShowMeasurement /> : null;
}

function ActiveCardShowMeasurement() {
  const ids = useMemo(measurementIdsFromEnv, []);
  const noticeVersion = useMemo(noticeVersionForBuild, []);
  const active = measurementActive('on', ids) && noticeVersion !== null && ids.ga4 !== null;
  const pathname = usePathname() ?? '';
  const measured = isMeasuredPath(pathname);
  const routerGuarded = useHardNavigationGuard(active);
  const lastHref = useRef('');

  useEffect(() => {
    if (!active || !noticeVersion || !measured || !routerGuarded) return;
    const stored = readConsent(documentCookieJar(), noticeVersion);
    if (!stored) {
      setRuntimeConsent(null);
      return;
    }
    const allowed = consentForRoute({ analytics: stored.analytics, ads: stored.ads }, pathname);
    setRuntimeConsent(allowed);
    if (!allowed.analytics) return;
    let cancelled = false;
    if (process.env.NEXT_PUBLIC_MEASUREMENT_MODE === 'on') {
      void import('@/lib/measurement/loader').then((m) => {
        if (cancelled) return;
        m.loadMeasurement(ids, allowed);
        flushPendingEvents();
        const href = window.location.href;
        if (sendsPageView(window.location.pathname) && href !== lastHref.current) {
          track('page_view', { page_location: href, page_referrer: lastHref.current || document.referrer });
          lastHref.current = href;
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [active, noticeVersion, measured, routerGuarded, ids, pathname]);

  // C-F5 (3/3): al llegar a una ruta excluida con etiquetas en el documento, documento nuevo.
  useEffect(() => {
    if (!active || measured) return;
    if (measurementLoadedInDocument()) window.location.reload();
  }, [active, measured, pathname]);

  return null;
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { INACTIVE, MeasurementContext, type MeasurementContextValue, type PreferencesOrigin } from './measurement-context';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Toaster, useToasts } from '@/components/ui/Toast';
import { MEASUREMENT_DISCLOSURE } from '@/content/legal/measurement-disclosure';
import { measurementActive, measurementIdsFromEnv } from '@/lib/measurement/mode';
import { isMeasuredPath, sendsPageView } from '@/lib/measurement/routes';
import {
  clearCookies,
  cookiesToClear,
  documentCookieJar,
  parseCookies,
  readConsent,
  revokedFrom,
  todayIso,
  writeConsent,
  writeFirstUtmOnce,
  type ConsentChoice,
} from '@/lib/measurement/consent';
import { hasAnyUtm, utmFromSearch, type FirstUtmValues } from '@/lib/measurement/utm';
import { flushPendingEvents, setRuntimeConsent, track } from '@/lib/measurement/track';
import { sendBannerResponse, type BannerResponse } from '@/lib/measurement/request';
import { ConsentPreferencesDialog } from './ConsentPreferencesDialog';

/**
 * ARCHITECTURE §14.3/§14.4 · DESIGN_SYSTEM MKT2-UX.2/.3/.7 — el proveedor de la Fase 2.
 *
 * Con el modo `off` horneado (`process.env.NEXT_PUBLIC_MEASUREMENT_MODE !== 'on'`) solo pinta sus
 * hijos: ni banner, ni enlace, ni cookies, ni `banner-response`, ni cargador (CK-1). Con `on` pero sin
 * ningún ID válido, o sin `measurementDisclosure`, tampoco (fail-closed, §14.1).
 *
 * Con `on`:
 *  - lee `th_consent` (si es de otra versión del aviso, vuelve a preguntar);
 *  - guarda los `utm_*` válidos de la URL en MEMORIA de la pestaña (sin cookie ni storage) hasta que
 *    haya analítica;
 *  - en rutas de la lista blanca carga las etiquetas que la elección permite (`loader.ts`, que solo
 *    entra al bundle con `on`) y manda `page_view` manual (no en checkout);
 *  - NAVEGACIÓN DURA (D-MKT2-2, C-F5): con etiquetas en el documento, un clic o una navegación hacia
 *    una ruta fuera de la lista blanca recarga el documento entero, que llega sin terceros.
 */

export { useMeasurement } from './measurement-context';

/** Versión del aviso que declara la medición. Ver `noticeVersionForBuild`. */
function noticeVersionForBuild(): string | null {
  if (MEASUREMENT_DISCLOSURE) return MEASUREMENT_DISCLOSURE.version;
  // Solo en builds de MOCKS (E2E con `on`): `next.config.mjs` hornea esta variable únicamente si
  // `NEXT_PUBLIC_USE_MOCKS=true`. Un build real sin aviso sigue inactivo (y su `npm run build` no pasa
  // la puerta C-D1).
  const e2e = process.env.NEXT_PUBLIC_MEASUREMENT_E2E_NOTICE_VERSION;
  return e2e ? e2e : null;
}


/**
 * API_CONTRACT §MKT.H.13 (v1.105): la respuesta que cuenta es la del RESULTADO, venga del botón o de la
 * segunda capa — los dos sí ⇒ `accept`, los dos no ⇒ `necessary_only`, mixta ⇒ `custom`.
 */
export function bannerResponseFor(choice: ConsentChoice): BannerResponse {
  if (choice.analytics && choice.ads) return 'accept';
  if (!choice.analytics && !choice.ads) return 'necessary_only';
  return 'custom';
}

/** ¿Hay código de medición de terceros en ESTE documento? (C-F5). */
export function measurementLoadedInDocument(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { gtag?: unknown; fbq?: unknown };
  return Boolean(w.gtag || w.fbq || document.querySelector('script[data-th-measurement]'));
}

function focusMain(): void {
  const main = document.getElementById('main');
  if (!main) return;
  if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
  main.focus();
}

export function MeasurementProvider({ children }: { children: ReactNode }) {
  return process.env.NEXT_PUBLIC_MEASUREMENT_MODE === 'on' ? (
    <ActiveMeasurementProvider>{children}</ActiveMeasurementProvider>
  ) : (
    <>{children}</>
  );
}

function ActiveMeasurementProvider({ children }: { children: ReactNode }) {
  const ids = useMemo(measurementIdsFromEnv, []);
  const noticeVersion = useMemo(noticeVersionForBuild, []);
  const active = measurementActive('on', ids) && noticeVersion !== null;
  const pathname = usePathname() ?? '';
  const measured = isMeasuredPath(pathname);
  const t = useTranslations('consent');
  const { toasts, push, dismiss } = useToasts();

  const [hydrated, setHydrated] = useState(false);
  const [consent, setConsent] = useState<ConsentChoice | null>(null);
  const [dialogOrigin, setDialogOrigin] = useState<PreferencesOrigin | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const tabUtm = useRef<FirstUtmValues>({});
  const landedAt = useRef<Date>(new Date());
  const answered = useRef(false);
  const bannerShown = useRef(false);
  const noResponseSent = useRef(false);
  const trigger = useRef<HTMLElement | null>(null);
  const lastHref = useRef<string>('');

  // Lectura inicial: la cookie solo existe en el cliente (MKT2-UX.2 «hidratación sin parpadeo»).
  useEffect(() => {
    if (!active || !noticeVersion) return;
    const jar = documentCookieJar();
    const stored = readConsent(jar, noticeVersion);
    const utm = utmFromSearch(window.location.search);
    if (hasAnyUtm(utm)) tabUtm.current = utm;
    if (stored) {
      const choice = { analytics: stored.analytics, ads: stored.ads };
      setConsent(choice);
      setRuntimeConsent(choice);
      answered.current = true;
      if (choice.analytics) writeFirstUtmOnce(jar, tabUtm.current, landedAt.current);
    } else {
      setRuntimeConsent(null);
    }
    setHydrated(true);
  }, [active, noticeVersion]);

  // UTM que llegan después en la misma pestaña (navegación de cliente): memoria; con analítica, cookie.
  useEffect(() => {
    if (!active || !hydrated) return;
    const utm = utmFromSearch(window.location.search);
    if (!hasAnyUtm(utm)) return;
    if (!hasAnyUtm(tabUtm.current)) {
      tabUtm.current = utm;
      landedAt.current = new Date();
    }
    if (consent?.analytics) writeFirstUtmOnce(documentCookieJar(), tabUtm.current, landedAt.current);
  }, [active, hydrated, pathname, consent]);

  useEffect(() => {
    if (!hydrated) return;
    setRuntimeConsent(active ? consent : null);
  }, [active, consent, hydrated]);

  // Cargador + `page_view`, solo en la lista blanca y con elección.
  useEffect(() => {
    if (!active || !consent || !measured) return;
    if (!consent.analytics && !consent.ads) return;
    let cancelled = false;
    if (process.env.NEXT_PUBLIC_MEASUREMENT_MODE === 'on') {
      void import('@/lib/measurement/loader').then((m) => {
        if (cancelled) return;
        m.loadMeasurement(ids, consent);
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
  }, [active, consent, measured, ids, pathname]);

  // C-F5 · navegación dura hacia rutas excluidas (1/2): clics en enlaces, ANTES que el router de Next.
  useEffect(() => {
    if (!active) return;
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      let url: URL;
      try {
        url = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (isMeasuredPath(url.pathname) || !measurementLoadedInDocument()) return;
      e.preventDefault();
      e.stopPropagation();
      window.location.assign(url.href);
    }
    window.addEventListener('click', onClick, true);
    return () => window.removeEventListener('click', onClick, true);
  }, [active]);

  // C-F5 (2/3): navegación por código. `useRouter()` (también el de next-intl) devuelve el MISMO
  // objeto que `window.next.router`; se envuelven `push`/`replace` para que una ruta excluida se pida
  // como documento nuevo ANTES de pintarse (sin esto, la ruta excluida llegaba a renderizarse un
  // instante con las etiquetas vivas: medido con N=10, 60/60 rojos en el E2E de C-F5).
  useEffect(() => {
    if (!active) return;
    type Nav = (href: string, options?: unknown) => void;
    const router = (window as unknown as { next?: { router?: { push?: Nav; replace?: Nav } } }).next?.router;
    if (!router?.push || !router.replace) return;
    const origPush = router.push;
    const origReplace = router.replace;
    const hardTarget = (href: string): string | null => {
      try {
        const url = new URL(href, window.location.href);
        if (url.origin !== window.location.origin || isMeasuredPath(url.pathname)) return null;
        return measurementLoadedInDocument() ? url.href : null;
      } catch {
        return null;
      }
    };
    router.push = (href, options) => {
      const target = hardTarget(href);
      if (target) window.location.assign(target);
      else origPush(href, options);
    };
    router.replace = (href, options) => {
      const target = hardTarget(href);
      if (target) window.location.replace(target);
      else origReplace(href, options);
    };
    return () => {
      router.push = origPush;
      router.replace = origReplace;
    };
  }, [active]);

  // C-F5 (3/3): red de seguridad (p. ej. una redirección del servidor): al llegar, recarga el documento.
  useEffect(() => {
    if (!active || measured) return;
    if (measurementLoadedInDocument()) window.location.reload();
  }, [active, measured, pathname]);

  const bannerVisible = active && hydrated && consent === null && !answered.current && measured;
  useEffect(() => {
    if (bannerVisible) bannerShown.current = true;
  }, [bannerVisible]);

  // §MKT.H.3 `no_response` (v1.105, MKT.H.13): una vez por DOCUMENTO, al ocultarse, si el banner se vio y no
  // se respondió. La marca vive solo en memoria: antes de elegir no se escribe nada en el dispositivo.
  useEffect(() => {
    if (!active) return;
    function onHide() {
      if (document.visibilityState !== 'hidden') return;
      if (!bannerShown.current || answered.current || noResponseSent.current) return;
      noResponseSent.current = true;
      sendBannerResponse('no_response', tabUtm.current.medium);
    }
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [active]);

  const save = useCallback(
    (choice: ConsentChoice, response: BannerResponse | null, opts: { focus: 'main' | 'trigger'; toast: boolean }) => {
      if (!noticeVersion) return;
      const jar = documentCookieJar();
      const prev = consent;
      writeConsent(jar, { ...choice, noticeVersion, savedOn: todayIso(new Date()) });
      if (response) sendBannerResponse(response, tabUtm.current.medium);
      answered.current = true;
      if (choice.analytics) writeFirstUtmOnce(jar, tabUtm.current, landedAt.current);
      else tabUtm.current = {};

      const revoked = revokedFrom(prev, choice);
      if (revoked.analytics || revoked.ads) {
        clearCookies(jar, cookiesToClear(parseCookies(jar.read()).keys(), revoked));
        const w = window as unknown as { gtag?: (...a: unknown[]) => void };
        if (revoked.analytics && w.gtag) w.gtag('consent', 'update', { analytics_storage: 'denied' });
        setRuntimeConsent(choice);
        window.location.reload();
        return;
      }
      setConsent(choice);
      setDialogOrigin(null);
      setAnnouncement('');
      // La región viva ya está montada: cambiar su texto en el siguiente cuadro hace que se anuncie.
      window.requestAnimationFrame(() => setAnnouncement(t('saved')));
      if (opts.toast) push({ variant: 'success', message: t('saved'), duration: 5000 });
      window.setTimeout(() => {
        if (opts.focus === 'main') focusMain();
        else if (trigger.current && document.contains(trigger.current)) trigger.current.focus();
        else focusMain();
      }, 0);
    },
    [consent, noticeVersion, push, t],
  );

  const value = useMemo<MeasurementContextValue>(
    () =>
      active
        ? {
            active: true,
            consent,
            bannerVisible,
            accept: () => save({ analytics: true, ads: true }, 'accept', { focus: 'main', toast: false }),
            necessaryOnly: () => save({ analytics: false, ads: false }, 'necessary_only', { focus: 'main', toast: false }),
            openPreferences: (origin, el) => {
              trigger.current = el;
              setDialogOrigin(origin);
            },
          }
        : INACTIVE,
    [active, consent, bannerVisible, save],
  );

  if (!active) return <>{children}</>;

  return (
    <MeasurementContext.Provider value={value}>
      {children}
      {/* MKT2-UX.3: región viva montada DE ANTEMANO (si nace con el texto, no se anuncia). */}
      <div role="status" aria-live="polite" className="sr-only" data-testid="consent-status">
        {announcement}
      </div>
      {dialogOrigin && (
        <ConsentPreferencesDialog
          initial={consent ?? { analytics: false, ads: false }}
          onCancel={() => {
            setDialogOrigin(null);
            window.setTimeout(() => {
              if (trigger.current && document.contains(trigger.current)) trigger.current.focus();
            }, 0);
          }}
          onSave={(choice) =>
            save(choice, dialogOrigin === 'banner' && !answered.current ? bannerResponseFor(choice) : null, {
              focus: dialogOrigin === 'banner' ? 'main' : 'trigger',
              toast: true,
            })
          }
        />
      )}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </MeasurementContext.Provider>
  );
}

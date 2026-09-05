'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { config } from '@/lib/config';
import { loginWithGoogle } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { Banner } from '@/components/ui/Banner';
import type { Role } from '@/types/contract';

/** Logo "G" multicolor oficial de Google (SVG, no se recolorea). */
function GoogleG({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Tipos mínimos de Google Identity Services (GIS) que consumimos.
 * Ya NO se declara `prompt()`: ver el bloque de decisión más abajo.
 * ------------------------------------------------------------------ */

type GoogleCredentialResponse = { credential?: string };

type GsiButtonOptions = {
  type?: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  text?: 'signin' | 'signin_with' | 'signup_with' | 'continue_with';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  logo_alignment?: 'left' | 'center';
  width?: number;
  locale?: string;
  click_listener?: () => void;
};

type GoogleIdApi = {
  accounts: {
    id: {
      initialize: (opts: {
        client_id: string;
        callback: (r: GoogleCredentialResponse) => void;
      }) => void;
      renderButton: (parent: HTMLElement, options: GsiButtonOptions) => void;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleIdApi;
  }
}

/* ------------------------------------------------------------------ *
 * POR QUÉ `renderButton()` Y NO `prompt()`  (D-1 / D-2)
 *
 * Verificado el 2026-09-05 leyendo el código que Google sirve HOY en
 * https://accounts.google.com/gsi/client (no la documentación de memoria;
 * developers.google.com no es alcanzable desde este entorno):
 *
 * 1) `prompt()` es el aviso automático (One Tap) y consulta un enfriamiento
 *    guardado en la cookie `g_state` (`disable_auto_prompt`, escalera
 *    [0, 2h, 24h, 7d, 28d]). Si aplica, la librería NO muestra nada y solo
 *    notifica `isNotDisplayed()`/`suppressed_by_user`. Ese camino de
 *    enfriamiento NO existe en el flujo del botón renderizado.
 * 2) Bajo FedCM, `prompt()` deja de emitir el "display moment": la librería
 *    llama directo a `navigator.credentials.get()` y, si el navegador bloquea
 *    el inicio de sesión de terceros, la promesa se rechaza
 *    ("FedCM get() rejects with NetworkError") y lo único que sale es un
 *    `console` de GIS. Por eso la propia librería avisa: «Your client
 *    application uses one of the Google One Tap prompt UI status methods that
 *    may stop functioning when FedCM becomes mandatory»
 *    (guía: /identity/gsi/web/guides/fedcm-migration#display_moment y
 *    #skipped_moment). Ese aviso desaparece al dejar de pasar moment listener.
 * 3) El clic del botón renderizado entra por otra rama: FedCM en modo
 *    *active* (garantiza UI ante gesto del usuario) o, si FedCM no aplica,
 *    la ventana emergente clásica. En ninguna de las dos se consulta el
 *    enfriamiento de One Tap.
 *
 * Aun así, GIS NO nos notifica el rechazo de FedCM en el flujo de botón, así
 * que el componente pone su propia red de seguridad (`CLICK_FEEDBACK_MS`):
 * todo clic termina en ventana de Google, en éxito, o en un mensaje nuestro.
 * ------------------------------------------------------------------ */

const GSI_SRC = 'https://accounts.google.com/gsi/client';
/** Si la librería no está lista en este tiempo, se considera no disponible (bloqueador/CSP/red). */
const GSI_LOAD_TIMEOUT_MS = 10_000;
/** Tras un clic sin ventana ni credencial, se explica qué hacer en vez de callar. */
const CLICK_FEEDBACK_MS = 6_000;
/** GIS acepta `width` en px y lo topa en 400. */
const GSI_BUTTON_MAX_WIDTH = 400;
const GSI_BUTTON_FALLBACK_WIDTH = 320;

/* --- Estado a nivel de MÓDULO (D-3) ---------------------------------
 * `google.accounts.id.initialize()` es un singleton global: la última llamada
 * gana y las anteriores quedan huérfanas ("initialize() is called multiple
 * times... only the last initialized instance will be used"). Con el estado en
 * un `useRef` cada instancia montada (AuthForm + InlineAuthPanel) inyectaba el
 * script y volvía a inicializar, y la credencial podía entregarse a un callback
 * muerto. Ahora el script se inyecta y se inicializa UNA vez por página, con un
 * despachador estable que reparte la credencial a la instancia que la pidió.
 * ------------------------------------------------------------------ */

type CredentialHandler = (r: GoogleCredentialResponse) => void;

let gisLoad: Promise<GoogleIdApi> | null = null;
/** Instancia que originó el flujo en curso (la que hizo clic). */
let activeHandler: CredentialHandler | null = null;
/** Todas las instancias montadas, por si la credencial llega sin flujo activo. */
const mountedHandlers = new Set<CredentialHandler>();

function dispatchCredential(r: GoogleCredentialResponse) {
  const target = activeHandler;
  activeHandler = null;
  if (target) {
    target(r);
    return;
  }
  mountedHandlers.forEach((h) => h(r));
}

function loadGoogleIdentity(clientId: string): Promise<GoogleIdApi> {
  if (gisLoad) return gisLoad;
  gisLoad = new Promise<GoogleIdApi>((resolve, reject) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      reject(new Error('GIS_NO_DOM'));
      return;
    }
    let settled = false;
    const finish = (api: GoogleIdApi | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!api) {
        // Permite reintentar en un remontaje posterior (p. ej. el bloqueador se apagó).
        gisLoad = null;
        reject(new Error('GIS_LOAD_FAILED'));
        return;
      }
      api.accounts.id.initialize({ client_id: clientId, callback: dispatchCredential });
      resolve(api);
    };
    const timer = setTimeout(() => finish(undefined), GSI_LOAD_TIMEOUT_MS);
    const ready = () => finish(window.google?.accounts?.id ? window.google : undefined);

    if (window.google?.accounts?.id) {
      finish(window.google);
      return;
    }
    let script = document.querySelector<HTMLScriptElement>('script[data-gsi-client="true"]');
    if (!script) {
      script = document.createElement('script');
      script.src = GSI_SRC;
      script.async = true;
      script.defer = true;
      script.dataset.gsiClient = 'true';
      document.head.appendChild(script);
    }
    script.addEventListener('load', ready);
    script.addEventListener('error', () => finish(undefined));
  });
  return gisLoad;
}

/**
 * Botón propio §6.7 (regla neutra, logo G oficial, 48px, radio 0). Se usa en
 * modo mock, mientras carga GIS y como respaldo cuando Google no está disponible.
 */
function OwnButton({
  label,
  busy,
  onClick,
  disabled,
}: {
  label: string;
  busy: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={busy || undefined}
      className={
        // Alternativa neutra: solo regla, sin relleno ni versalitas — no compite con el CTA de tinta.
        'inline-flex min-h-[48px] w-full items-center justify-center gap-2.5 border border-border-strong px-4 text-[13px] font-medium text-text transition-colors hover:border-text disabled:cursor-not-allowed disabled:text-muted'
      }
    >
      {busy ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <GoogleG />}
      <span>{label}</span>
    </button>
  );
}

/** Solo para pruebas: limpia el singleton de módulo entre casos. */
export function __resetGoogleIdentityForTests() {
  gisLoad = null;
  activeHandler = null;
  mountedHandlers.clear();
}

/**
 * Modo de operación. `mock` es OPT-IN EXPLÍCITO por configuración: un fallo de
 * carga de Google jamás degrada a mock, porque eso mandaba un `idToken` falso
 * al backend real y el usuario veía "token inválido" en vez de la verdad.
 */
type Mode = 'mock' | 'real' | 'unconfigured';
type SdkState = 'loading' | 'ready' | 'failed';
type Notice = 'unavailable' | 'blocked';

export interface GoogleSignInButtonProps {
  /** Se invoca tras un login exitoso con el `role` del usuario (para redirigir). */
  onSuccess: (role?: Role) => void;
}

/**
 * Botón "Continuar con Google" (DESIGN_SYSTEM §6.7).
 * - Modo real: Google dibuja su propio botón (`renderButton`) y al recibir el
 *   `credential` (ID token) se llama `POST /auth/google` (API_CONTRACT §auth).
 * - Modo mocks (`NEXT_PUBLIC_USE_MOCKS=true`): botón propio §6.7 que simula el canje.
 * - Sin librería o sin client id: botón propio §6.7 + mensaje honesto, nunca token falso.
 * Email/contraseña sigue siendo la acción primaria; este botón es alternativa neutra.
 */
export function GoogleSignInButton({ onSuccess }: GoogleSignInButtonProps) {
  const t = useTranslations('auth.google');
  const tErr = useTranslations('error');
  const locale = useLocale();

  const mode: Mode = config.useMocks ? 'mock' : config.googleClientId ? 'real' : 'unconfigured';

  const [sdk, setSdk] = useState<SdkState>('loading');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<GoogleIdApi | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  const clearFeedbackTimer = useCallback(() => {
    if (feedbackTimer.current) {
      clearTimeout(feedbackTimer.current);
      feedbackTimer.current = null;
    }
  }, []);

  const exchange = useCallback(
    async (idToken: string) => {
      setBusy(true);
      try {
        const res = await loginWithGoogle(idToken);
        onSuccessRef.current(res.user.role);
      } catch (e) {
        const code = e instanceof ApiClientError ? e.code : 'GOOGLE_TOKEN_INVALID';
        setErrorCode(code);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  /** Recibe la credencial de GIS (vía el despachador de módulo). */
  const handleCredential = useCallback(
    (r: GoogleCredentialResponse) => {
      clearFeedbackTimer();
      setNotice(null);
      if (r.credential) {
        void exchange(r.credential);
        return;
      }
      // Respuesta sin credencial: es un fallo real, se dice.
      setBusy(false);
      setErrorCode('GOOGLE_TOKEN_INVALID');
    },
    [clearFeedbackTimer, exchange],
  );

  // Registro de la instancia en el despachador de módulo.
  useEffect(() => {
    const handler: CredentialHandler = (r) => handleCredential(r);
    mountedHandlers.add(handler);
    return () => {
      mountedHandlers.delete(handler);
      if (activeHandler === handler) activeHandler = null;
    };
  }, [handleCredential]);

  useEffect(() => clearFeedbackTimer, [clearFeedbackTimer]);

  // Carga (única por página) de Google Identity Services, solo en modo real.
  useEffect(() => {
    if (mode !== 'real') return;
    let cancelled = false;
    setSdk('loading');
    loadGoogleIdentity(config.googleClientId).then(
      (api) => {
        if (cancelled) return;
        apiRef.current = api;
        setSdk('ready');
      },
      () => {
        if (cancelled) return;
        // La librería no cargó: se anuncia solo, sin esperar a que el usuario pique.
        setSdk('failed');
        setNotice('unavailable');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [mode]);

  /**
   * Todo clic sobre el botón de Google arranca aquí: feedback inmediato y red
   * de seguridad. Si Google no abre nada (FedCM bloqueado por el navegador,
   * ventana emergente bloqueada), a los `CLICK_FEEDBACK_MS` se explica qué hacer.
   */
  const onGoogleButtonClick = useCallback(() => {
    setErrorCode(null);
    setNotice(null);
    setBusy(true);
    activeHandler = handleCredential;
    clearFeedbackTimer();
    feedbackTimer.current = setTimeout(() => {
      feedbackTimer.current = null;
      setBusy(false);
      setNotice('blocked');
    }, CLICK_FEEDBACK_MS);
  }, [clearFeedbackTimer, handleCredential]);

  // Dibuja (y redibuja al cambiar el ancho) el botón oficial de Google.
  useEffect(() => {
    if (mode !== 'real' || sdk !== 'ready') return;
    const parent = containerRef.current;
    const api = apiRef.current;
    if (!parent || !api) return;

    let lastWidth = -1;
    const draw = () => {
      const measured = Math.round(parent.getBoundingClientRect().width) || GSI_BUTTON_FALLBACK_WIDTH;
      const width = Math.min(GSI_BUTTON_MAX_WIDTH, measured);
      if (width === lastWidth) return;
      lastWidth = width;
      parent.replaceChildren();
      api.accounts.id.renderButton(parent, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        shape: 'rectangular',
        text: 'continue_with',
        logo_alignment: 'center',
        locale,
        width,
        click_listener: onGoogleButtonClick,
      });
    };
    draw();

    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(parent);
    return () => ro.disconnect();
  }, [mode, sdk, locale, onGoogleButtonClick]);

  const googleUnavailable = mode === 'unconfigured' || (mode === 'real' && sdk === 'failed');
  const ownLabel = busy ? t('connecting') : t('cta');

  return (
    <div className="flex flex-col gap-2">
      {mode === 'mock' && (
        // MOCK: solo con NEXT_PUBLIC_USE_MOCKS=true. Nunca por fallo de carga.
        <OwnButton label={ownLabel} busy={busy} disabled={busy} onClick={() => void exchange('mock-google-id-token')} />
      )}

      {mode === 'real' && sdk === 'loading' && <OwnButton label={ownLabel} busy={busy} disabled />}

      {googleUnavailable && (
        // Sin librería: el clic informa; jamás canjea un idToken inventado.
        <OwnButton label={ownLabel} busy={busy} disabled={busy} onClick={() => setNotice('unavailable')} />
      )}

      {mode === 'real' && (
        // Contenedor del botón oficial de Google. Conserva la ranura de 48px de §6.7
        // aunque el botón que dibuja Google mida menos (ver FRONTEND_NOTES).
        <div
          ref={containerRef}
          data-testid="google-gsi-button"
          hidden={sdk !== 'ready'}
          className="flex min-h-[48px] w-full items-center justify-center"
        />
      )}

      {/*
        §6.7 pide anunciar "Conectando…" con aria-live. Cuando el botón lo dibuja Google
        no podemos meter el spinner DENTRO de él (es un iframe de otro origen), así que el
        estado se hace visible aquí; con el botón propio ya va en su label y basta el anuncio.
      */}
      <p
        className={
          busy && mode === 'real' && sdk === 'ready'
            ? 'flex items-center justify-center gap-2 text-xs text-muted'
            : 'sr-only'
        }
        aria-live="polite"
        role="status"
      >
        {busy && mode === 'real' && sdk === 'ready' && (
          <Loader2 size={14} className="animate-spin" aria-hidden />
        )}
        {busy ? t('connecting') : ''}
      </p>

      {notice && (
        <Banner variant={notice === 'unavailable' ? 'danger' : 'warning'} role="alert">
          {t(notice)}
        </Banner>
      )}

      {errorCode && (
        <Banner variant="danger" role="alert">
          {tErr.has(errorCode) ? tErr(errorCode) : tErr('INTERNAL')}
        </Banner>
      )}
    </div>
  );
}

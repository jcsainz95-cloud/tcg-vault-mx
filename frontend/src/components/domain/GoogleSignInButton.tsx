'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { config } from '@/lib/config';
import { loginWithGoogle } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { retryAfterMinutes } from '@/lib/password-attempts';
import { stashGoogleSignup } from '@/lib/api/google-signup';
import { Banner } from '@/components/ui/Banner';
import type { Role, UserDTO } from '@/types/contract';

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

type GoogleCredentialResponse = { credential?: string };
type GoogleIdApi = {
  accounts: {
    id: {
      initialize: (opts: { client_id: string; callback: (r: GoogleCredentialResponse) => void }) => void;
      prompt?: () => void;
      renderButton?: (parent: HTMLElement, opts: Record<string, unknown>) => void;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleIdApi;
  }
}

export interface GoogleSignInButtonProps {
  /**
   * Se invoca tras un login exitoso con el `role` y el `user` devueltos (para redirigir).
   * v1.67 (§33.8 paso 2): el `user` trae `mustChangePassword` — una cuenta local que el admin
   * reseteó puede entrar por Google y debe aterrizar igualmente en la página de contraseña.
   */
  onSuccess: (role?: Role, user?: UserDTO) => void;
  /**
   * §CELULAR-ALTA §6.2: destino (ruta interna) al terminar «Completa tu cuenta» cuando el correo de Google NO tiene
   * cuenta. Ausente ⇒ la ruta actual (el checkout sigue con el carrito, que vive en localStorage).
   */
  next?: string;
  /**
   * Navegación al paso «Completa tu cuenta» (la pantalla de auth pasa su `router.push`). Ausente (p. ej. dentro del
   * checkout, que no navega con router propio) ⇒ navegación completa a `/<locale>/completa-cuenta`: el carrito vive en
   * localStorage y el token en sessionStorage, ambos sobreviven.
   */
  onPendingSignup?: (path: string) => void;
}

/**
 * Botón "Continuar con Google" (DESIGN_SYSTEM §6.7).
 * - Con backend + NEXT_PUBLIC_GOOGLE_CLIENT_ID usa Google Identity Services: al
 *   recibir el `credential` (ID token) llama POST /auth/google.
 * - En modo mocks (o sin client id) simula el login sin backend (Vercel).
 * Email/contraseña sigue siendo la acción primaria; este botón es alternativa neutra.
 */
export function GoogleSignInButton({ onSuccess, next, onPendingSignup }: GoogleSignInButtonProps) {
  const locale = useLocale();
  const t = useTranslations('auth.google');
  const tAuth = useTranslations('auth');
  const tErr = useTranslations('error');
  const [loading, setLoading] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  /**
   * DESIGN_SYSTEM §37.13 v4.9.1 · contrato v1.80.8.1: `/auth/google` solo emite `429 RATE_LIMITED` (throttle
   * por IP) ⇒ cualquier 429 aquí se pinta con `auth.rateLimitedByIp*`, ⛔ sin enlace a restablecer (no levanta
   * un tope por IP) y ⛔ sin reintento automático. `minutes` = `retryAfterMinutes` (`null` sin cifra usable).
   */
  const [rateLimited, setRateLimited] = useState<{ minutes: number | null } | null>(null);
  /** GIS inicializado y con `renderButton`: el botón oficial se superpone, transparente, sobre el de marca. */
  const [overlayReady, setOverlayReady] = useState(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const scriptLoaded = useRef(false);
  /** Guarda de vuelo: una sola credencial en tránsito (evita doble envío si GIS repite el callback). */
  const inFlight = useRef(false);
  /** El callback de GIS se registra una vez; siempre llama a la última versión de `exchange`. */
  const exchangeRef = useRef<(idToken: string) => Promise<void>>(async () => {});

  const realMode = !config.useMocks && !!config.googleClientId;

  async function exchange(idToken: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const res = await loginWithGoogle(idToken);
      if ('pendingSignup' in res) {
        // Correo SIN cuenta: no hay sesión. El token se guarda en sessionStorage (⛔ nunca en la URL) y se pide el celular.
        stashGoogleSignup(res.pendingSignup);
        const here = window.location.pathname.replace(new RegExp(`^/${locale}(?=/|$)`), '') || '/';
        const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : here;
        const path = `/completa-cuenta?next=${encodeURIComponent(dest)}`;
        if (onPendingSignup) onPendingSignup(path);
        else window.location.assign(`/${locale}${path}`);
        return;
      }
      onSuccess(res.user.role, res.user);
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 429) {
        setRateLimited({ minutes: retryAfterMinutes(e.details) });
        return;
      }
      const code = e instanceof ApiClientError ? e.code : 'GOOGLE_TOKEN_INVALID';
      setErrorCode(code);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }
  exchangeRef.current = exchange;

  // Carga perezosa de Google Identity Services solo en modo real.
  useEffect(() => {
    if (!realMode || scriptLoaded.current) return;
    function init() {
      const gid = window.google?.accounts.id;
      if (!gid) return;
      gid.initialize({
        client_id: config.googleClientId,
        callback: (r) => {
          if (r.credential) void exchangeRef.current(r.credential);
          else setErrorCode('GOOGLE_TOKEN_INVALID');
        },
      });
      scriptLoaded.current = true;
      // Sin `renderButton` no hay botón oficial: el botón de marca queda solo con One Tap (teclado).
      if (typeof gid.renderButton === 'function') setOverlayReady(true);
    }
    if (window.google) {
      init();
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = init;
    document.head.appendChild(s);
  }, [realMode]);

  // El botón oficial de GIS se pinta desde el primer render con GIS listo. El clic del usuario cae en su
  // iframe (gesto real ⇒ popup válido en Safari iOS, sin depender de One Tap ni de sus avisos).
  useEffect(() => {
    const host = overlayRef.current;
    if (!overlayReady || !host) return;
    window.google?.accounts.id.renderButton?.(host, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'continue_with',
      shape: 'rectangular',
      width: Math.min(400, Math.max(200, host.parentElement?.clientWidth || 280)),
      locale,
    });
  }, [overlayReady, locale]);

  function onClick() {
    setErrorCode(null);
    setRateLimited(null);
    if (realMode) {
      // Solo llega aquí con teclado/lector de pantalla (el puntero cae en el botón oficial superpuesto)
      // o si GIS aún no cargó. One Tap es un extra opcional; si no se muestra, no pasa nada.
      window.google?.accounts.id.prompt?.();
      return;
    }
    // MOCK: simula el canje del idToken (sin backend, funciona en Vercel).
    void exchange('mock-google-id-token');
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative mx-auto w-full max-w-[400px]">
        <button
          type="button"
          onClick={onClick}
          disabled={loading}
          aria-busy={loading || undefined}
          className={
            // Alternativa neutra: solo regla, sin relleno ni versalitas — no compite con el CTA de tinta.
            'inline-flex min-h-[48px] w-full items-center justify-center gap-2.5 border border-border-strong px-4 text-[13px] font-medium text-text transition-colors hover:border-text disabled:cursor-not-allowed disabled:text-muted'
          }
        >
          {loading ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <GoogleG />}
          <span aria-live="polite">{loading ? t('connecting') : t('cta')}</span>
        </button>
        {overlayReady && (
          // Botón oficial de GIS (40 px) estirado a los 48 px del de marca; transparente pero tocable.
          // Con `loading` deja de recibir toques (una credencial a la vez) sin desmontarse.
          <div
            data-testid="google-overlay"
            aria-hidden
            className={`absolute inset-0 flex items-center justify-center overflow-hidden opacity-[0.01] ${loading ? 'pointer-events-none' : ''}`}
          >
            <div ref={overlayRef} style={{ transform: 'scaleY(1.2)' }} className="w-full" />
          </div>
        )}
      </div>
      {rateLimited && (
        <div data-testid="google-rate-limited">
          <Banner variant="warning" role="alert">
            {rateLimited.minutes !== null
              ? tAuth('rateLimitedByIpRetryIn', { minutes: rateLimited.minutes })
              : tAuth('rateLimitedByIp')}
          </Banner>
        </div>
      )}
      {errorCode && (
        <Banner variant="danger">
          {tErr.has(errorCode) ? tErr(errorCode) : tErr('INTERNAL')}
        </Banner>
      )}
    </div>
  );
}

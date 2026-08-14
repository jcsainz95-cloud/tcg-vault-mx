'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { config } from '@/lib/config';
import { loginWithGoogle } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { Banner } from '@/components/ui/Banner';

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
      prompt: () => void;
    };
  };
};
declare global {
  interface Window {
    google?: GoogleIdApi;
  }
}

export interface GoogleSignInButtonProps {
  onSuccess: () => void;
}

/**
 * Botón "Continuar con Google" (DESIGN_SYSTEM §6.7).
 * - Con backend + NEXT_PUBLIC_GOOGLE_CLIENT_ID usa Google Identity Services: al
 *   recibir el `credential` (ID token) llama POST /auth/google.
 * - En modo mocks (o sin client id) simula el login sin backend (Vercel).
 * Email/contraseña sigue siendo la acción primaria; este botón es alternativa neutra.
 */
export function GoogleSignInButton({ onSuccess }: GoogleSignInButtonProps) {
  const t = useTranslations('auth.google');
  const tErr = useTranslations('error');
  const [loading, setLoading] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const scriptLoaded = useRef(false);

  const realMode = !config.useMocks && !!config.googleClientId;

  async function exchange(idToken: string) {
    try {
      await loginWithGoogle(idToken);
      onSuccess();
    } catch (e) {
      const code = e instanceof ApiClientError ? e.code : 'GOOGLE_TOKEN_INVALID';
      setErrorCode(code);
    } finally {
      setLoading(false);
    }
  }

  // Carga perezosa de Google Identity Services solo en modo real.
  useEffect(() => {
    if (!realMode || scriptLoaded.current) return;
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = () => {
      window.google?.accounts.id.initialize({
        client_id: config.googleClientId,
        callback: (r) => {
          if (r.credential) void exchange(r.credential);
          else {
            setErrorCode('GOOGLE_TOKEN_INVALID');
            setLoading(false);
          }
        },
      });
      scriptLoaded.current = true;
    };
    document.head.appendChild(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realMode]);

  function onClick() {
    setErrorCode(null);
    setLoading(true);
    if (realMode && window.google) {
      // GIS invoca el callback con el credential (ID token).
      window.google.accounts.id.prompt();
      return;
    }
    // MOCK: simula el canje del idToken (sin backend, funciona en Vercel).
    void exchange('mock-google-id-token');
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        aria-busy={loading || undefined}
        className={
          'inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-md border border-border-strong bg-surface px-4 text-base font-medium text-text transition-colors hover:bg-surface-2 focus-visible:shadow-[0_0_0_3px_var(--color-focus-ring)] active:scale-[.98] disabled:opacity-45 disabled:cursor-not-allowed'
        }
      >
        {loading ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <GoogleG />}
        <span aria-live="polite">{loading ? t('connecting') : t('cta')}</span>
      </button>
      {errorCode && (
        <Banner variant="danger">
          {tErr.has(errorCode) ? tErr(errorCode) : tErr('INTERNAL')}
        </Banner>
      )}
    </div>
  );
}

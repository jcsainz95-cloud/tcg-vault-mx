'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Loader2, MailX } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { verifyEmail } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { useSession } from '@/lib/session';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { useResendVerification } from '@/hooks/useResendVerification';

type State = 'idle' | 'verifying' | 'success' | 'invalid' | 'error';

/**
 * Pantalla de verificación de correo (contrato POST /auth/verify-email, `public`).
 * Se abre desde el link del correo con `?token=`; al montar, si hay token, lo consume.
 * - Éxito → mensaje "correo verificado" + link a la tienda / login.
 * - 422 EMAIL_VERIFY_TOKEN_INVALID → token inválido/expirado, con CTA para reenviar
 *   (solo si hay sesión: el reenvío es AUTENTICADO).
 */
export function VerifyEmailView({ token }: { token?: string }) {
  const t = useTranslations('verifyEmail');
  const { isAuthenticated, ready } = useSession();
  const { status: resendStatus, resend } = useResendVerification();
  const [state, setState] = useState<State>(token ? 'verifying' : 'idle');
  // Evita doble ejecución (StrictMode monta dos veces en dev).
  const ran = useRef(false);

  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    verifyEmail(token)
      .then(() => setState('success'))
      .catch((e) => {
        const code = e instanceof ApiClientError ? e.code : undefined;
        setState(code === 'EMAIL_VERIFY_TOKEN_INVALID' ? 'invalid' : 'error');
      });
  }, [token]);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-h2 font-bold">{t('title')}</h1>

      {state === 'idle' && <p className="text-sm text-muted">{t('noToken')}</p>}

      {state === 'verifying' && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 size={18} className="animate-spin" aria-hidden />
          {t('verifying')}
        </p>
      )}

      {state === 'success' && (
        <>
          <Banner variant="success" role="status" title={t('successTitle')}>
            <span className="flex items-center gap-2">
              <CheckCircle2 size={16} aria-hidden />
              {t('successBody')}
            </span>
          </Banner>
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-fg"
          >
            {t('goToStore')}
          </Link>
        </>
      )}

      {(state === 'invalid' || state === 'error') && (
        <>
          <Banner variant="danger" role="alert" title={t('invalidTitle')}>
            <span className="flex items-center gap-2">
              <MailX size={16} aria-hidden />
              {state === 'invalid' ? t('invalidBody') : t('genericError')}
            </span>
          </Banner>

          {/* El reenvío es AUTENTICADO: solo se ofrece con sesión. */}
          {ready && isAuthenticated ? (
            resendStatus === 'sent' ? (
              <Banner variant="success" role="status">
                {t('sent')}
              </Banner>
            ) : (
              <div className="flex flex-col gap-2">
                <Button
                  variant="secondary"
                  loading={resendStatus === 'sending'}
                  onClick={resend}
                  className="self-start"
                >
                  {resendStatus === 'sending' ? t('sending') : t('resendCta')}
                </Button>
                {resendStatus === 'rateLimited' && (
                  <p className="text-sm text-warning">{t('rateLimited')}</p>
                )}
                {resendStatus === 'error' && (
                  <p className="text-sm text-danger">{t('resendError')}</p>
                )}
              </div>
            )
          ) : (
            <p className="text-sm text-muted">
              {t('loginToResend')}{' '}
              <Link href="/login" className="text-primary hover:underline">
                {t('goToLogin')}
              </Link>
            </p>
          )}
        </>
      )}
    </div>
  );
}

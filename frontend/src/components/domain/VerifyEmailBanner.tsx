'use client';

import { useTranslations } from 'next-intl';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { useSession } from '@/lib/session';
import { useResendVerification } from '@/hooks/useResendVerification';

/**
 * Banner persistente "verifica tu correo" del shell de la tienda (contrato §1, v1.5).
 * Se muestra cuando el usuario logueado tiene `emailVerified=false`. La verificación NO
 * bloquea la navegación (el bloqueo real de acciones sensibles lo hace el backend con
 * `403 EMAIL_NOT_VERIFIED`), por eso es un aviso `warning`, no un error. CTA "Reenviar
 * correo de verificación" → POST /auth/verify-email/resend (autenticado) con feedback.
 *
 * `ready` evita el mismatch de hidratación: mientras la sesión no está lista no se pinta.
 */
export function VerifyEmailBanner() {
  const t = useTranslations('verifyEmail');
  const { user, ready } = useSession();
  const { status, resend } = useResendVerification();

  // Solo clientes sin verificar. Google entra con emailVerified=true (no afectado).
  if (!ready || !user || user.emailVerified !== false) return null;

  return (
    // Dirección 5a: franja de papel con regla; el aviso lo marca la nota, no un fondo de color.
    <div className="border-b border-border">
      <div className="mx-auto max-w-7xl px-5 py-3 sm:px-6 lg:px-11">
        <Banner
          variant="warning"
          role="status"
          title={t('bannerTitle')}
          className="p-0"
          action={
            status === 'sent' ? (
              <span className="shrink-0 whitespace-nowrap text-sm font-medium text-success">
                {t('sent')}
              </span>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                loading={status === 'sending'}
                onClick={resend}
                className="shrink-0 whitespace-nowrap"
              >
                {status === 'sending' ? t('sending') : t('resendCta')}
              </Button>
            )
          }
        >
          {t('bannerBody')}
          {status === 'rateLimited' && (
            <span className="mt-1 block text-warning">{t('rateLimited')}</span>
          )}
          {status === 'error' && <span className="mt-1 block text-danger">{t('resendError')}</span>}
        </Banner>
      </div>
    </div>
  );
}

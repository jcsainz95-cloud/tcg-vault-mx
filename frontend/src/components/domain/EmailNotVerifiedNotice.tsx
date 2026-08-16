'use client';

import { useTranslations } from 'next-intl';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { useResendVerification } from '@/hooks/useResendVerification';

/**
 * Aviso claro para el `403 EMAIL_NOT_VERIFIED` (contrato §0/§4/§5/§6, v1.5): cuando el
 * backend rechaza una acción sensible (comprar/vender/retirar) porque el correo no está
 * verificado, se muestra este banner en vez de un error genérico, con CTA de reenvío
 * (POST /auth/verify-email/resend). Reutilizable en checkout, buylist y retiros.
 */
export function EmailNotVerifiedNotice() {
  const t = useTranslations('verifyEmail');
  const { status, resend } = useResendVerification();

  return (
    <Banner
      variant="danger"
      role="alert"
      title={t('blockedTitle')}
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
      {t('blockedBody')}
      {status === 'rateLimited' && <span className="mt-1 block">{t('rateLimited')}</span>}
      {status === 'error' && <span className="mt-1 block">{t('resendError')}</span>}
    </Banner>
  );
}

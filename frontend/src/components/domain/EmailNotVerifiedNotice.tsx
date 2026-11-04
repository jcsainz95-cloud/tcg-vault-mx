'use client';

import { useTranslations } from 'next-intl';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { useResendVerification } from '@/hooks/useResendVerification';
import { useSession } from '@/lib/session';
import { resendSendsAccountSetup } from './account/resend-kind';

/**
 * Aviso claro para el `403 EMAIL_NOT_VERIFIED` (contrato §0/§4/§5/§6, v1.5): cuando el
 * backend rechaza una acción sensible (vender, retirar, reclamar pedidos; comprar ya no, §CTA.5) porque el correo no
 * está verificado, se muestra este banner en vez de un error genérico, con CTA de reenvío
 * (POST /auth/verify-email/resend). La etiqueta dice el correo que sale (§CTA-UX.6 (9)): cuenta pendiente ⇒ «Termina
 * tu cuenta».
 */
export function EmailNotVerifiedNotice() {
  const t = useTranslations('verifyEmail');
  const { status, resend } = useResendVerification();
  const { user } = useSession();
  const setupPending = resendSendsAccountSetup(user);

  return (
    <Banner
      variant="danger"
      role="alert"
      title={t('blockedTitle')}
      action={
        status === 'sent' ? (
          <span className="shrink-0 whitespace-nowrap text-sm font-medium text-success">
            {setupPending ? t('sentSetup') : t('sent')}
          </span>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            loading={status === 'sending'}
            onClick={resend}
            className="shrink-0 whitespace-nowrap"
          >
            {status === 'sending' ? t('sending') : setupPending ? t('resendSetupCta') : t('resendCta')}
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

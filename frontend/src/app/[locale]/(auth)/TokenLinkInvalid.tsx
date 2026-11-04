'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { forgotPassword } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { useSession } from '@/lib/session';
import { useResendVerification } from '@/hooks/useResendVerification';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { buttonClassName } from '@/components/ui/button-classes';
import { Banner } from '@/components/ui/Banner';

/**
 * Enlace usado, caducado o sin token en las páginas con token (DESIGN_SYSTEM §CTA-UX.3 «Vencido, usado o sin enlace» y
 * «Mandar otro»; §CTA-UX.3b: `/verify-email` usa el MISMO estado). El servidor no distingue el motivo: un solo estado.
 * «Mandar otro»: con sesión, `verify-email/resend` (el servidor elige «Termina tu cuenta» o «Verifica tu correo» según
 * la cuenta, §CTA.5); sin sesión, correo + `forgot-password` (respuesta genérica, no revela si el correo existe).
 * Hasta que la sesión esté resuelta no se pinta ninguna acción (sin parpadeo). Textos en `accountSetup.*`.
 * M-1 (QA sobre `36f93c98`): con sesión de una cuenta YA verificada (`user.emailVerified` guardado al entrar), `resend`
 * es un no-op que responde `{ok:true}` (`resendVerification`: «ya verificado → no reenvía»), así que «Mandar otro»
 * diría «enviado» sin correo. En ese caso no se ofrece: se dice que el correo ya está confirmado e «Ir a mi cuenta».
 */
export function TokenLinkInvalid({ title, testId }: { title: string; testId: string }) {
  const t = useTranslations('accountSetup');
  const tv = useTranslations('verifyEmailPage');
  const { user, isAuthenticated, ready } = useSession();
  const { status: resendStatus, resend } = useResendVerification();
  const [email, setEmail] = useState('');
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'rateLimited'>('idle');

  async function sendByEmail(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSendState('sending');
    try {
      await forgotPassword(email.trim());
      setSendState('sent');
    } catch (err) {
      // Como `forgot-password`: solo el tope se distingue; lo demás se trata como enviado (no hay oráculo).
      setSendState(err instanceof ApiClientError && err.code === 'RATE_LIMITED' ? 'rateLimited' : 'sent');
    }
  }

  return (
    <div className="flex flex-col gap-5" data-testid={testId}>
      <h1 className="text-h2 font-bold">{title}</h1>
      <Banner variant="warning" role="alert" title={t('invalidTitle')}>
        {t('invalidBody')}
      </Banner>

      {!ready ? null : isAuthenticated ? (
        user?.emailVerified ? (
          <div className="flex flex-col gap-4" data-testid="token-link-already-verified">
            <Banner variant="success" role="status">
              {t('alreadyVerified')}
            </Banner>
            <Link href="/account" className={buttonClassName({ variant: 'primary', className: 'w-full' })}>
              {tv('goToAccount')}
            </Link>
          </div>
        ) : resendStatus === 'sent' ? (
          <Banner variant="success" role="status">
            {t('sent')}
          </Banner>
        ) : (
          <div className="flex flex-col gap-2">
            <Button variant="secondary" loading={resendStatus === 'sending'} onClick={resend} className="self-start">
              {resendStatus === 'sending' ? t('sending') : t('sendAnother')}
            </Button>
            {resendStatus === 'rateLimited' && (
              <Banner variant="warning" role="alert">
                {t('rateLimited')}
              </Banner>
            )}
            {resendStatus === 'error' && (
              <Banner variant="danger" role="alert">
                {t('genericError')}
              </Banner>
            )}
          </div>
        )
      ) : sendState === 'sent' ? (
        <Banner variant="success" role="status">
          {t('sentGeneric')}
        </Banner>
      ) : (
        <form onSubmit={sendByEmail} className="flex flex-col gap-4" data-testid="account-setup-resend-by-email">
          <Input
            label={t('email')}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Button type="submit" variant="secondary" loading={sendState === 'sending'} className="self-start">
            {sendState === 'sending' ? t('sending') : t('sendAnother')}
          </Button>
          {sendState === 'rateLimited' && (
            <Banner variant="warning" role="alert">
              {t('rateLimited')}
            </Banner>
          )}
        </form>
      )}
    </div>
  );
}

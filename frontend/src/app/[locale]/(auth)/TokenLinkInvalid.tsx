'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useSession } from '@/lib/session';
import { useResendVerification } from '@/hooks/useResendVerification';
import { useForgotPassword } from '@/hooks/useForgotPassword';
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
 * diría «enviado» sin correo. En ese caso no se ofrece: se dice que el correo ya está confirmado e «Ir a mi cuenta», y
 * el h1 pasa a `titleVerified` (neutro, §CTA-UX.3b: «Termina tu cuenta» / «Confirma tu correo» contradiría «ya está»).
 * TL-CTA-9: «Mandar otro» sin sesión con 5xx o red ⇒ `Banner danger` `accountSetup.sendError`, el correo se queda.
 */
export function TokenLinkInvalid({
  title,
  titleVerified,
  testId,
}: {
  title: string;
  /** h1 neutro del estado «sesión con correo ya verificado» (§CTA-UX.3b). */
  titleVerified: string;
  testId: string;
}) {
  const t = useTranslations('accountSetup');
  const tv = useTranslations('verifyEmailPage');
  const { user, isAuthenticated, ready } = useSession();
  const { status: resendStatus, resend } = useResendVerification();
  const [email, setEmail] = useState('');
  const { status: sendState, send } = useForgotPassword();

  function sendByEmail(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void send(email.trim());
  }

  // m-1 (QA sobre `153f7c40`): con la cuenta ya verificada el aviso «El enlace ya se usó o caducó… Pide otro» contradice
  // «no necesitas otro enlace»; no se pinta. Tampoco antes de resolver la sesión, para no enseñarlo y quitarlo
  // (§CTA-UX.3b: «no se pinta hasta saber el estado»). El h1 neutro, también solo con la sesión resuelta.
  const alreadyVerified = ready && isAuthenticated && !!user?.emailVerified;

  return (
    <div className="flex flex-col gap-5" data-testid={testId}>
      <h1 className="text-h2 font-bold">{alreadyVerified ? titleVerified : title}</h1>
      {ready && !alreadyVerified && (
        <Banner variant="warning" role="alert" title={t('invalidTitle')}>
          {t('invalidBody')}
        </Banner>
      )}

      {!ready ? null : isAuthenticated ? (
        alreadyVerified ? (
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
          {sendState === 'error' && (
            <Banner variant="danger" role="alert">
              {t('sendError')}
            </Banner>
          )}
        </form>
      )}
    </div>
  );
}

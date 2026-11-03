'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { verifyEmail } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { useSession } from '@/lib/session';
import { useStripTokenFromUrl } from '@/lib/token-url';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { buttonClassName } from '@/components/ui/button-classes';
import { Banner } from '@/components/ui/Banner';
import { MIN_PASSWORD } from '@/components/domain/account/account-limits';
import { TokenLinkInvalid } from '../TokenLinkInvalid';

type Mode = 'password' | 'newPassword';
type State = 'form' | 'success' | 'invalidToken';
type FormError = { kind: 'wrongPassword' } | { kind: 'banner'; variant: 'warning' | 'danger'; message: string };

/**
 * `/verify-email` («Confirma tu correo»; API_CONTRACT §1 «Verificación de correo» v1.117.2, D-CTA-12, CTA-F9;
 * DESIGN_SYSTEM §CTA-UX.3b). ⛔ **Cargar la página no canjea** (PT-CTA-8): pinta un formulario y canjear es enviarlo.
 * El enlace prueba el buzón; el cuerpo prueba o fija la credencial (I-7):
 *  - modo «contraseña actual» (por defecto) ⇒ `{ token, password }`; `401` no consume el token y cuenta como fallo C7;
 *  - modo «contraseña nueva» (quien no creó la cuenta o no la recuerda) ⇒ `{ token, newPassword }`; revoca sesiones y
 *    responde sin sesión ⇒ «Entrar» siempre a `/login`.
 * Ninguna salida abre sesión. Token vencido/usado/sin token ⇒ el mismo estado y «Mandar otro» que `/account-setup`.
 * D-CTA-10: el token sale de la barra al montar (`useStripTokenFromUrl`) y la ruta se sirve con `no-referrer`.
 */
export function VerifyEmailView({ token }: { token?: string }) {
  useStripTokenFromUrl();
  const t = useTranslations('verifyEmailPage');
  const tv = useTranslations('verifyEmail');
  const { isAuthenticated } = useSession();
  const [state, setState] = useState<State>(token ? 'form' : 'invalidToken');
  const [mode, setMode] = useState<Mode>('password');
  const [doneMode, setDoneMode] = useState<Mode>('password');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ newPassword?: string; confirm?: string }>({});
  const [formError, setFormError] = useState<FormError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const passwordRef = useRef<HTMLInputElement>(null);
  const newPasswordRef = useRef<HTMLInputElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  // Foco tras un cambio provocado por el usuario (nunca al cargar: §CTA-UX.3b «al cargar el foco no se mueve»).
  const pendingFocus = useRef<'password' | 'newPassword' | 'success' | null>(null);
  const wrongId = useId();

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    if (target === 'password') passwordRef.current?.focus();
    else if (target === 'newPassword') newPasswordRef.current?.focus();
    else successRef.current?.querySelector<HTMLElement>('a,button')?.focus();
  });

  function switchMode(next: Mode) {
    // Estado local: misma ruta y token; no navega ni envía; no conserva lo tecleado.
    setMode(next);
    setPassword('');
    setNewPassword('');
    setConfirm('');
    setFieldErrors({});
    setFormError(null);
    pendingFocus.current = next;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token || submitting) return;
    setFormError(null);
    setFieldErrors({});
    if (mode === 'password') {
      if (password === '') return;
    } else {
      // Valida antes de enviar: no gasta el enlace.
      if (newPassword.length < MIN_PASSWORD) {
        pendingFocus.current = 'newPassword';
        return setFieldErrors({ newPassword: t('weak') });
      }
      if (newPassword !== confirm) return setFieldErrors({ confirm: t('mismatch') });
    }

    setSubmitting(true);
    try {
      await verifyEmail(mode === 'password' ? { token, password } : { token, newPassword });
      setDoneMode(mode);
      setState('success');
      pendingFocus.current = 'success';
    } catch (err) {
      const code = err instanceof ApiClientError ? err.code : undefined;
      if (code === 'EMAIL_VERIFY_TOKEN_INVALID') {
        setState('invalidToken');
      } else if (code === 'INVALID_CREDENTIALS' && mode === 'password') {
        setPassword('');
        setFormError({ kind: 'wrongPassword' });
        pendingFocus.current = 'password';
      } else if (code === 'TOO_MANY_PASSWORD_ATTEMPTS' || code === 'RATE_LIMITED') {
        setFormError({ kind: 'banner', variant: 'warning', message: t('tooManyAttempts') });
      } else if (code === 'USER_BLOCKED') {
        setFormError({ kind: 'banner', variant: 'danger', message: t('blocked') });
      } else if (code === 'VALIDATION_ERROR' && mode === 'newPassword') {
        setFieldErrors({ newPassword: t('weak') });
        pendingFocus.current = 'newPassword';
      } else {
        setFormError({ kind: 'banner', variant: 'danger', message: t('genericError') });
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (state === 'invalidToken') return <TokenLinkInvalid title={t('title')} testId="verify-email-invalid" />;

  if (state === 'success') {
    // Modo contraseña: la sesión que hubiera sigue viva (tokenVersion no cambia) ⇒ con sesión, «Ir a mi cuenta».
    // Modo nueva: el servidor revocó las sesiones de esa cuenta ⇒ siempre «Entrar».
    const toAccount = doneMode === 'password' && isAuthenticated;
    return (
      <div className="flex flex-col gap-5" data-testid="verify-email-success" ref={successRef}>
        <h1 className="text-h2 font-bold">{t('title')}</h1>
        <Banner variant="success" role="status" title={t('successTitle')}>
          <span className="block">{doneMode === 'password' ? t('successPassword') : t('successNewPassword')}</span>
          <span className="mt-1 block">{tv('successBody')}</span>
        </Banner>
        <Link
          href={toAccount ? '/account' : '/login'}
          className={buttonClassName({ variant: 'primary', className: 'w-full' })}
        >
          {toAccount ? t('goToAccount') : t('signIn')}
        </Link>
      </div>
    );
  }

  const wrong = formError?.kind === 'wrongPassword';
  const switchClass =
    'inline-flex min-h-[44px] items-center self-start text-left text-sm text-text underline underline-offset-4';

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4" data-testid="verify-email-form" data-mode={mode}>
      <h1 className="text-h2 font-bold">{t('title')}</h1>
      <p className="text-sm text-muted">{mode === 'password' ? t('passwordLead') : t('newPasswordLead')}</p>

      {wrong && (
        // `Banner` no acepta `id`: el envoltorio da el destino del `aria-describedby` del campo.
        <div id={wrongId}>
          <Banner variant="danger" role="alert" title={t('wrongPasswordTitle')}>
            {t('wrongPasswordBody')}
          </Banner>
        </div>
      )}
      {formError?.kind === 'banner' && (
        <Banner variant={formError.variant} role="alert">
          {formError.message}
        </Banner>
      )}

      {mode === 'password' ? (
        <>
          <Input
            ref={passwordRef}
            label={t('password')}
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            aria-invalid={wrong ? true : undefined}
            aria-describedby={wrong ? wrongId : undefined}
          />
          <Button type="submit" loading={submitting} disabled={password === ''} className="w-full">
            {submitting ? t('submitting') : t('submit')}
          </Button>
          <button type="button" className={switchClass} onClick={() => switchMode('newPassword')}>
            {t('toNewPassword')}
          </button>
        </>
      ) : (
        <>
          <Input
            ref={newPasswordRef}
            label={t('newPassword')}
            name="newPassword"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            hint={t('policyHint')}
            error={fieldErrors.newPassword}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
          <Input
            label={t('confirm')}
            name="confirm"
            type="password"
            autoComplete="new-password"
            error={fieldErrors.confirm}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
          <Button type="submit" loading={submitting} className="w-full">
            {submitting ? t('submittingNew') : t('submitNew')}
          </Button>
          <button type="button" className={switchClass} onClick={() => switchMode('password')}>
            {t('toPassword')}
          </button>
        </>
      )}
    </form>
  );
}

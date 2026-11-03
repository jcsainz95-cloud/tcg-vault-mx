'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { accountSetup } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { useStripTokenFromUrl } from '@/lib/token-url';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { buttonClassName } from '@/components/ui/button-classes';
import { Banner } from '@/components/ui/Banner';
import { MAX_NAME, MIN_PASSWORD } from '@/components/domain/account/account-limits';
import { TokenLinkInvalid } from '../TokenLinkInvalid';

type State = 'form' | 'success' | 'invalidToken';
type Field = 'name' | 'password' | 'confirm';

/**
 * «Termina tu cuenta» (API_CONTRACT §CTA.4 `POST /auth/account-setup` y §CTA.6; criterios 971 y 974).
 * Nombre y contraseña con el token del correo. ⛔ Sin sesión al terminar (como `reset-password`): «Listo» y enlace a
 * entrar con correo y contraseña. Token usado, caducado o inválido (`422 ACCOUNT_SETUP_TOKEN_INVALID`, que no distingue
 * el motivo) ⇒ «El enlace ya se usó o caducó» y «Mandar otro»: con sesión, `verify-email/resend` (el servidor emite
 * otro «Termina tu cuenta» a una cuenta pendiente, §CTA.5); sin sesión, pide el correo y llama a `forgot-password`
 * (respuesta genérica: no revela si el correo existe).
 *
 * Aspecto: DESIGN_SYSTEM §CTA-UX.3 (columna de `(auth)` como `reset-password`; «Entrar» con las clases de `Button`
 * primary; tope y error de «Mandar otro» como `Banner`). Textos en `accountSetup.*`.
 */
export function AccountSetupView({ token }: { token?: string }) {
  // D-CTA-10 (1): el token sale de la barra antes de cualquier petición (lo conserva la prop).
  useStripTokenFromUrl();
  const t = useTranslations('accountSetup');
  const [state, setState] = useState<State>(token ? 'form' : 'invalidToken');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    const trimmed = name.trim();
    // El servidor valida el cuerpo ANTES de tocar el token (§CTA.4 paso 1); aquí se ahorra el viaje.
    if (trimmed.length < 1 || trimmed.length > MAX_NAME) return setErrors({ name: t('nameRequired') });
    if (password.length < MIN_PASSWORD) return setErrors({ password: t('weak') });
    if (password !== confirm) return setErrors({ confirm: t('mismatch') });

    setSubmitting(true);
    try {
      await accountSetup({ token: token!, name: trimmed, password });
      setState('success');
    } catch (err) {
      const code = err instanceof ApiClientError ? err.code : undefined;
      if (code === 'ACCOUNT_SETUP_TOKEN_INVALID') setState('invalidToken');
      else if (code === 'VALIDATION_ERROR') {
        const field = err instanceof ApiClientError ? err.details?.field : undefined;
        setErrors(field === 'name' ? { name: t('nameRequired') } : { password: t('weak') });
      } else if (code === 'USER_BLOCKED') setFormError(t('blocked'));
      else if (code === 'RATE_LIMITED') setFormError(t('rateLimited'));
      else setFormError(t('genericError'));
    } finally {
      setSubmitting(false);
    }
  }

  if (state === 'success') {
    return (
      <div className="flex flex-col gap-5" data-testid="account-setup-success">
        <h1 className="text-h2 font-bold">{t('title')}</h1>
        <Banner variant="success" role="status" title={t('successTitle')}>
          {t('successBody')}
        </Banner>
        <Link
          href="/login"
          className={buttonClassName({ variant: 'primary', className: 'w-full' })}
        >
          {t('goToLogin')}
        </Link>
      </div>
    );
  }

  if (state === 'invalidToken') return <TokenLinkInvalid title={t('title')} testId="account-setup-invalid" />;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4" data-testid="account-setup-form">
      <h1 className="text-h2 font-bold">{t('title')}</h1>
      <p className="text-sm text-muted">{t('subtitle')}</p>

      {formError && (
        <Banner variant="danger" role="alert">
          {formError}
        </Banner>
      )}

      <Input
        label={t('name')}
        name="name"
        autoComplete="name"
        maxLength={MAX_NAME}
        error={errors.name}
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <Input
        label={t('password')}
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={MIN_PASSWORD}
        hint={t('policyHint')}
        error={errors.password}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <Input
        label={t('confirm')}
        name="confirm"
        type="password"
        autoComplete="new-password"
        error={errors.confirm}
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        required
      />
      <Button type="submit" loading={submitting} className="w-full">
        {submitting ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
}

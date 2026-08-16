'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { resetPassword } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';

// Política de fuerza igual al registro (contrato §1: password MinLength 8).
const MIN_PASSWORD = 8;

type State = 'form' | 'success' | 'invalidToken';

/**
 * Pantalla de restablecimiento de contraseña (contrato POST /auth/reset-password, `public`).
 * Se abre desde el link del correo con `?token=`. Formulario de nueva contraseña con
 * confirmación y política de fuerza igual al registro.
 * - Éxito → mensaje + link a login (el backend revoca sesiones; el usuario re-inicia sesión).
 * - 422 RESET_TOKEN_INVALID → token inválido/expirado, con CTA a "solicitar otro"
 *   (forgot-password).
 */
export function ResetPasswordView({ token }: { token?: string }) {
  const t = useTranslations('resetPassword');
  const [state, setState] = useState<State>(token ? 'form' : 'invalidToken');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFieldError(null);
    setFormError(null);

    if (password.length < MIN_PASSWORD) {
      setFieldError(t('weak'));
      return;
    }
    if (password !== confirm) {
      setFieldError(t('mismatch'));
      return;
    }

    setSubmitting(true);
    try {
      await resetPassword({ token: token!, password });
      setState('success');
    } catch (err) {
      const code = err instanceof ApiClientError ? err.code : undefined;
      if (code === 'RESET_TOKEN_INVALID') {
        setState('invalidToken');
      } else if (code === 'VALIDATION_ERROR') {
        setFieldError(t('weak'));
      } else {
        setFormError(t('genericError'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (state === 'success') {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-h2 font-bold">{t('title')}</h1>
        <Banner variant="success" role="status" title={t('successTitle')}>
          {t('successBody')}
        </Banner>
        <Link
          href="/login"
          className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-fg"
        >
          {t('goToLogin')}
        </Link>
      </div>
    );
  }

  if (state === 'invalidToken') {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-h2 font-bold">{t('title')}</h1>
        <Banner variant="danger" role="alert" title={t('invalidTitle')}>
          {t('invalidBody')}
        </Banner>
        <Link
          href="/forgot-password"
          className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-fg"
        >
          {t('requestAnother')}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <h1 className="text-h2 font-bold">{t('title')}</h1>
      <p className="text-sm text-muted">{t('subtitle')}</p>

      {formError && (
        <Banner variant="danger" role="alert">
          {formError}
        </Banner>
      )}

      <Input
        label={t('newPassword')}
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={MIN_PASSWORD}
        hint={t('policyHint')}
        error={fieldError ?? undefined}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <Input
        label={t('confirmPassword')}
        name="confirm"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        required
      />
      <Button type="submit" loading={submitting} className="w-full">
        {submitting ? t('submitting') : t('submit')}
      </Button>
      <Link href="/login" className="text-center text-sm text-primary hover:underline">
        {t('backToLogin')}
      </Link>
    </form>
  );
}

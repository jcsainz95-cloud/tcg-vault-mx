'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { setPassword } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { useErrorMessage } from '@/components/ui/QueryState';
import { MIN_PASSWORD } from './PasswordForm';

type Field = 'name' | 'new' | 'confirm';
const MAX_NAME = 120;

export interface SetPasswordFormProps {
  /** `200`: `setPassword()` ya reemplazó los dos tokens y parcheó la sesión local. */
  onSuccess: () => void;
  /** `422 ACCOUNT_SETUP_NOT_PENDING`: la cuenta ya no está pendiente (otra pestaña, el enlace del correo): la página relee. */
  onNotPending: () => void;
}

/**
 * «Ponle contraseña a tu cuenta» (API_CONTRACT §CTA.4 `POST /auth/set-password`, criterio 972): nombre (opcional) y
 * contraseña nueva **sin la actual** — la cuenta nació en el carrito con solo el correo y no tiene ninguna. Solo se
 * monta con `accountSetupPending === true` (lo decide `PasswordPage`); con contraseña puesta, cambiarla pide la actual
 * (`PasswordForm`). ⛔ No verifica el correo: los pedidos de invitado siguen esperando el enlace (974).
 * Mismo patrón que `PasswordForm` (validación al enviar, foco al campo fallido); textos en `account.password.setup*`.
 */
export function SetPasswordForm({ onSuccess, onNotPending }: SetPasswordFormProps) {
  const t = useTranslations('account.password');
  const getMessage = useErrorMessage();
  const [name, setName] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<{ kind: 'rate' | 'other'; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [focusField, setFocusField] = useState<{ field: Field; n: number } | null>(null);
  const refs: Record<Field, React.RefObject<HTMLInputElement>> = {
    name: useRef<HTMLInputElement>(null),
    new: useRef<HTMLInputElement>(null),
    confirm: useRef<HTMLInputElement>(null),
  };

  useEffect(() => {
    if (!focusField) return;
    refs[focusField.field].current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusField]);

  function fail(field: Field, message: string) {
    setErrors({ [field]: message });
    setFocusField((f) => ({ field, n: (f?.n ?? 0) + 1 }));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    if (name.trim().length > MAX_NAME) return fail('name', t('setupNameTooLong'));
    if (next.length < MIN_PASSWORD) return fail('new', t('weak'));
    if (next !== confirm) return fail('confirm', t('mismatch'));

    setSubmitting(true);
    try {
      await setPassword({ newPassword: next, ...(name.trim() ? { name: name.trim() } : {}) });
      setNext('');
      setConfirm('');
      onSuccess();
    } catch (err) {
      const code = err instanceof ApiClientError ? err.code : 'INTERNAL';
      if (code === 'ACCOUNT_SETUP_NOT_PENDING') onNotPending();
      else if (code === 'VALIDATION_ERROR') {
        const field = err instanceof ApiClientError ? err.details?.field : undefined;
        if (field === 'name') fail('name', t('setupNameTooLong'));
        else fail('new', t('weak'));
      } else if (code === 'RATE_LIMITED') setFormError({ kind: 'rate', message: t('rateLimited') });
      else setFormError({ kind: 'other', message: getMessage(err) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4" data-testid="set-password-form">
      {formError && (
        <Banner variant={formError.kind === 'rate' ? 'warning' : 'danger'} role="alert">
          {formError.message}
        </Banner>
      )}
      <Input
        ref={refs.name}
        label={t('setupName')}
        name="name"
        autoComplete="name"
        maxLength={MAX_NAME}
        hint={t('setupNameHint')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={errors.name}
      />
      <Input
        ref={refs.new}
        label={t('new')}
        name="newPassword"
        type="password"
        autoComplete="new-password"
        minLength={MIN_PASSWORD}
        hint={t('policy')}
        value={next}
        onChange={(e) => setNext(e.target.value)}
        error={errors.new}
        required
      />
      <Input
        ref={refs.confirm}
        label={t('confirm')}
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        error={errors.confirm}
        required
      />
      <Button type="submit" loading={submitting} disabled={next === '' || confirm === ''} className="mt-2 w-full sm:w-auto">
        {submitting ? t('submitting') : t('setupSubmit')}
      </Button>
    </form>
  );
}

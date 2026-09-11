'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { changePassword } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { useErrorMessage } from '@/components/ui/QueryState';
import type { ChangePasswordResponse } from '@/types/contract';

/** Política vigente del contrato §1 (`MIN_PASSWORD_LENGTH`), la misma de register/reset. */
export const MIN_PASSWORD = 8;

type Field = 'current' | 'new' | 'confirm';

export interface PasswordFormProps {
  /** Rótulo del campo 1: «Contraseña actual» (normal) o «Contraseña temporal» (bloqueo, §33.8). */
  currentLabel: string;
  /** Rótulo del botón: «Cambiar contraseña» o «Guardar y continuar». */
  submitLabel: string;
  /** Rótulo del botón en curso. */
  submittingLabel: string;
  /** Se invoca con el `200` del contrato: tokens ya reemplazados y sesión local ya parcheada. */
  onSuccess: (res: ChangePasswordResponse) => void;
  /**
   * `422 PASSWORD_NOT_SET` no debería ocurrir (la página decide por `hasPassword`), pero si llega,
   * la página cambia a la variante «Crear» en el sitio (§33.7). El formulario solo avisa.
   */
  onPasswordNotSet?: () => void;
}

/**
 * Formulario de `POST /auth/change-password` (DESIGN_SYSTEM §33.7 variante A; contrato v1.67).
 * Tres campos, validación en el `submit` (no al teclear), foco al campo fallido (P-4), errores del
 * servidor mapeados por `details.field`. ⛔ Sin reglas de complejidad que el servidor no exija; sin
 * «mostrar contraseña» propio (§33.15.7).
 */
export function PasswordForm({
  currentLabel,
  submitLabel,
  submittingLabel,
  onSuccess,
  onPasswordNotSet,
}: PasswordFormProps) {
  const t = useTranslations('account.password');
  const getMessage = useErrorMessage();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<{ kind: 'rate' | 'other'; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [focusField, setFocusField] = useState<{ field: Field; n: number } | null>(null);

  const refs: Record<Field, React.RefObject<HTMLInputElement>> = {
    current: useRef<HTMLInputElement>(null),
    new: useRef<HTMLInputElement>(null),
    confirm: useRef<HTMLInputElement>(null),
  };

  // Foco al campo fallido (P-4): se dispara por evento (contador), no por el mero valor del error.
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

    // Orden de §33.7: longitud → coincidencia → distinta de la actual.
    if (next.length < MIN_PASSWORD) return fail('new', t('weak'));
    if (next !== confirm) return fail('confirm', t('mismatch'));
    if (next === current) return fail('new', t('sameAsCurrent'));

    setSubmitting(true);
    try {
      const res = await changePassword({ currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setConfirm('');
      onSuccess(res);
    } catch (err) {
      const code = err instanceof ApiClientError ? err.code : 'INTERNAL';
      if (code === 'CURRENT_PASSWORD_INCORRECT') fail('current', getMessage(err));
      else if (code === 'PASSWORD_SAME_AS_CURRENT') fail('new', t('sameAsCurrent'));
      else if (code === 'VALIDATION_ERROR') fail('new', t('weak'));
      else if (code === 'PASSWORD_NOT_SET') onPasswordNotSet?.();
      else if (code === 'RATE_LIMITED') setFormError({ kind: 'rate', message: t('rateLimited') });
      else setFormError({ kind: 'other', message: getMessage(err) });
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = current !== '' && next !== '' && confirm !== '';

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {formError && (
        <Banner variant={formError.kind === 'rate' ? 'warning' : 'danger'} role="alert">
          {formError.message}
        </Banner>
      )}
      <Input
        ref={refs.current}
        label={currentLabel}
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        error={errors.current}
        required
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
      <Button type="submit" loading={submitting} disabled={!canSubmit} className="mt-2 w-full sm:w-auto">
        {submitting ? submittingLabel : submitLabel}
      </Button>
    </form>
  );
}

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { login, register } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { useErrorMessage } from '@/components/ui/QueryState';
import { GoogleSignInButton } from '@/components/domain/GoogleSignInButton';

export interface InlineAuthPanelProps {
  variant: 'login' | 'register';
  /** correo ya capturado como invitado (se preserva al cambiar de vía, criterio 46) */
  defaultEmail?: string;
  /** nombre sugerido (el del destinatario del envío) — `name` es requerido por §1 */
  defaultName?: string;
  /** etiqueta del botón principal (el upsell usa "Crear cuenta y guardar en bóveda") */
  submitLabel?: string;
  /** cambio de formulario DENTRO del mismo panel (no navega, no pierde datos) */
  onSwitchVariant?: () => void;
  switchLabel?: string;
  /**
   * Copy NEUTRO para `409 EMAIL_TAKEN` (criterio 56 · §15.4/§15.5): dentro del checkout
   * nunca se afirma que el correo ya tiene cuenta; se ofrecen las dos salidas.
   */
  neutralEmailTaken: string;
  /** el padre re-cotiza y continúa el flujo donde estaba (nunca navega) */
  onSuccess: () => void;
}

/**
 * Panel de identidad INLINE del checkout (DESIGN_SYSTEM §15.2 y §15.4).
 *
 * Por qué NO se reusa `components/domain/AuthForm`: ese componente **navega** al terminar
 * (`router.push(destForRole(...))`) y no expone un `onSuccess`, así que dentro del checkout
 * expulsaría al usuario de `/checkout` — justo lo que §15.2 prohíbe ("se renderizan inline,
 * no navegan"). Este panel usa las MISMAS funciones de API (`login`/`register` de lib/api,
 * contrato §1) y el MISMO `GoogleSignInButton` (§6.7); no duplica lógica de sesión: la
 * persistencia la sigue haciendo `persistSession` dentro de lib/api. Ver FRONTEND_NOTES.
 */
export function InlineAuthPanel({
  variant,
  defaultEmail,
  defaultName,
  submitLabel,
  onSwitchVariant,
  switchLabel,
  neutralEmailTaken,
  onSuccess,
}: InlineAuthPanelProps) {
  const t = useTranslations('auth');
  const getMessage = useErrorMessage();
  const [email, setEmail] = useState(defaultEmail ?? '');
  const [name, setName] = useState(defaultName ?? '');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (variant === 'login') await login({ email, password });
      else await register({ email, password, name });
      onSuccess();
    } catch (err) {
      // 409 EMAIL_TAKEN → mensaje neutro con dos salidas (nunca "ese correo ya existe").
      if (err instanceof ApiClientError && err.code === 'EMAIL_TAKEN') setError(neutralEmailTaken);
      else setError(getMessage(err));
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col">
      {error && (
        <Banner variant="warning" role="status" className="mb-6">
          {error}
        </Banner>
      )}

      <div className="[&>*]:mt-6 first:[&>*]:mt-0">
        {variant === 'register' && (
          <Input
            label={t('name')}
            name="name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        )}
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
        <Input
          label={t('password')}
          name="password"
          type="password"
          autoComplete={variant === 'login' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>

      <Button type="submit" variant="primary" loading={loading} className="mt-8 w-full">
        {loading ? t('loading') : (submitLabel ?? (variant === 'login' ? t('loginCta') : t('registerCta')))}
      </Button>

      {/* Divisor "o / or": Google es alternativa neutra, no compite como CTA (§6.7). */}
      <div className="mt-7 flex items-center gap-4" aria-hidden>
        <span className="h-px flex-1 bg-border-strong" />
        <span className="font-mono text-[11px] text-muted">{t('dividerOr')}</span>
        <span className="h-px flex-1 bg-border-strong" />
      </div>
      <div className="mt-5">
        <GoogleSignInButton onSuccess={() => onSuccess()} />
      </div>

      {onSwitchVariant && switchLabel && (
        <button
          type="button"
          onClick={onSwitchVariant}
          className="mt-7 self-start border-b border-accent pb-0.5 text-sm text-accent hover:border-text hover:text-text"
        >
          {switchLabel}
        </button>
      )}
    </form>
  );
}

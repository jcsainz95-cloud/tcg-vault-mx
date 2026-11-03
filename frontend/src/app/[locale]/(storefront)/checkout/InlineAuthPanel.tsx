'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { forgotPassword, login, registerEmailOnly } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { useErrorMessage } from '@/components/ui/QueryState';
import { GoogleSignInButton } from '@/components/domain/GoogleSignInButton';
import { PrivacySiteNote } from '@/components/legal/PrivacyNoticeLink';
import type { Locale } from '@/types/contract';

export interface InlineAuthPanelProps {
  variant: 'login' | 'register';
  /** correo ya capturado como invitado (se preserva al cambiar de vía, criterio 46) */
  defaultEmail?: string;
  /** etiqueta del botón principal (el upsell usa "Crear cuenta y guardar en bóveda") */
  submitLabel?: string;
  /** cambio de formulario DENTRO del mismo panel (no navega, no pierde datos) */
  onSwitchVariant?: () => void;
  switchLabel?: string;
  /** el padre re-cotiza y continúa el flujo donde estaba (nunca navega) */
  onSuccess: () => void;
}

/**
 * Panel de identidad INLINE del checkout (DESIGN_SYSTEM §15.2 y §15.4).
 *
 * §CTA (API_CONTRACT §CTA.4, criterios 969/970, v1.117): «Crear cuenta» pide **solo el correo**
 * (`POST /auth/register/email-only`) más la leyenda del 504; ⛔ ni nombre, ni contraseña, ni celular. La contraseña y
 * el nombre llegan después, por el correo «Termina tu cuenta» o desde «Mi cuenta». Con `409 EMAIL_TAKEN` (P-CTA-3, el
 * dueño: se revela) se ofrece **«Ingresar a cuenta»** —la entrada de este mismo panel con el correo ya escrito: no
 * navega, así que al entrar el checkout sigue con el carrito intacto— y **«¿Olvidaste tu contraseña?»**
 * (`forgot-password` con ese correo, sin salir). ⛔ El `409` no guarda sesión (lo garantiza `registerEmailOnly`).
 *
 * Por qué NO se reusa `components/domain/AuthForm`: ese componente **navega** al terminar
 * (`router.push(destForRole(...))`) y no expone un `onSuccess`, así que dentro del checkout
 * expulsaría al usuario de `/checkout` — justo lo que §15.2 prohíbe ("se renderizan inline,
 * no navegan"). Este panel usa las MISMAS funciones de API (lib/api, contrato §1/§CTA) y el MISMO
 * `GoogleSignInButton` (§6.7); no duplica lógica de sesión: la persistencia la sigue haciendo
 * `persistSession` dentro de lib/api. Ver FRONTEND_NOTES.
 */
export function InlineAuthPanel({
  variant,
  defaultEmail,
  submitLabel,
  onSwitchVariant,
  switchLabel,
  onSuccess,
}: InlineAuthPanelProps) {
  const t = useTranslations('auth');
  const te = useTranslations('auth.emailOnly');
  const locale = useLocale() as Locale;
  const getMessage = useErrorMessage();
  const [email, setEmail] = useState(defaultEmail ?? '');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetState, setResetState] = useState<'idle' | 'sending' | 'sent' | 'rateLimited'>('idle');
  /**
   * N-13 · cuando el alta devuelve `409 EMAIL_TAKEN` ofrecemos entrar con el MISMO correo, sin sacar al usuario de
   * `/checkout` (§15.2). Marcamos el caso para pintar «Ingresar a cuenta» y, donde el padre NO controla la variante
   * vía `onSwitchVariant` (línea T4 del checkout de invitado y confirmación de pedido), conmutamos a login con un
   * override local. En el upsell —que ya controla la variante— delegamos en `onSwitchVariant` para no tener dos
   * switches en pugna.
   */
  const [emailTaken, setEmailTaken] = useState(false);
  const [variantOverride, setVariantOverride] = useState<'login' | 'register' | null>(null);
  const [focusPasswordOnLogin, setFocusPasswordOnLogin] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  const activeVariant = variantOverride ?? variant;

  // Si el padre reasigna la variante (p. ej. el switch del upsell), el override local deja
  // de mandar: así nunca conviven dos fuentes de verdad contradictorias.
  useEffect(() => {
    setVariantOverride(null);
  }, [variant]);

  // Al conmutar a login por EMAIL_TAKEN, el correo ya está escrito: enfocamos lo único que
  // falta, la contraseña.
  useEffect(() => {
    if (activeVariant === 'login' && focusPasswordOnLogin) {
      passwordRef.current?.focus();
      setFocusPasswordOnLogin(false);
    }
  }, [activeVariant, focusPasswordOnLogin]);

  function offerLogin() {
    // Conserva el correo (vive en el estado del panel) y limpia el aviso del alta fallida.
    setError(null);
    setEmailTaken(false);
    setResetState('idle');
    setFocusPasswordOnLogin(true);
    if (onSwitchVariant) onSwitchVariant();
    else setVariantOverride('login');
  }

  /** «¿Olvidaste tu contraseña?» del `409`: `forgot-password` con ese correo, sin salir (respuesta genérica). */
  async function sendReset() {
    setResetState('sending');
    try {
      await forgotPassword(email.trim());
      setResetState('sent');
    } catch (err) {
      setResetState(err instanceof ApiClientError && err.code === 'RATE_LIMITED' ? 'rateLimited' : 'sent');
    }
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setEmailTaken(false);
    setResetState('idle');
    setLoading(true);
    try {
      if (activeVariant === 'login') await login({ email, password });
      else await registerEmailOnly({ email: email.trim(), locale });
      onSuccess();
    } catch (err) {
      // 409 EMAIL_TAKEN (970, P-CTA-3): el correo tiene cuenta ⇒ «Ingresar a cuenta» y «¿Olvidaste tu contraseña?».
      if (err instanceof ApiClientError && err.code === 'EMAIL_TAKEN' && activeVariant === 'register') {
        setError(te('taken'));
        setEmailTaken(true);
      } else {
        setError(getMessage(err));
      }
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col">
      {error && (
        <Banner variant="warning" role="status" className="mb-6">
          <span data-testid="inline-auth-error">{error}</span>
          {/* 970: «Ingresar a cuenta» = login INLINE con el correo puesto (no abandona el checkout, §15.2) y
              «¿Olvidaste tu contraseña?» = `forgot-password` aquí mismo. Solo en el alta. */}
          {emailTaken && activeVariant === 'register' && (
            <span className="mt-2 flex flex-wrap items-center gap-x-6">
              <button
                type="button"
                onClick={offerLogin}
                className="inline-flex min-h-[44px] items-center text-left text-sm text-text underline underline-offset-4 hover:text-accent"
              >
                {te('login')}
              </button>
              {resetState === 'sent' ? (
                <span role="status" className="text-sm text-muted">
                  {te('resetSent')}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={sendReset}
                  disabled={resetState === 'sending'}
                  className="inline-flex min-h-[44px] items-center text-left text-sm text-text underline underline-offset-4 hover:text-accent"
                >
                  {t('forgotPassword')}
                </button>
              )}
              {resetState === 'rateLimited' && (
                <span role="alert" className="block w-full text-sm text-warning">
                  {te('resetRateLimited')}
                </span>
              )}
            </span>
          )}
        </Banner>
      )}

      <div className="[&>*]:mt-6 first:[&>*]:mt-0">
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
        {/* 969: el alta del carrito NO pide contraseña (llega después, por el correo o desde «Mi cuenta»). */}
        {activeVariant === 'login' && (
          <Input
            ref={passwordRef}
            label={t('password')}
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        )}
      </div>

      <Button type="submit" variant="primary" loading={loading} className="mt-8 w-full">
        {loading
          ? t('loading')
          : (activeVariant === 'login' ? t('loginCta') : (submitLabel ?? t('registerCta')))}
      </Button>

      {/* 969 + 504 (LIVE-8 sitio 2a): la leyenda de Términos y Aviso, bajo «Crear cuenta» y ANTES de Google. */}
      {activeVariant === 'register' && (
        <PrivacySiteNote site="register" className="mt-4 text-[13px] leading-[1.6] text-muted" />
      )}

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

'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { updateMyEmail } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { useResendVerification } from '@/hooks/useResendVerification';
import { SUPPORT_CONTACT_FALLBACK } from '@/app/[locale]/(storefront)/checkout/support-contact';
import type { UserDTO } from '@/types/contract';
import { SectionShell } from './SectionShell';
import { resendSendsAccountSetup } from './resend-kind';

/**
 * b · Correo y verificación (`#email`, DESIGN_SYSTEM §33.6b). Una sola cuenta SÍ edita su correo aquí: la nacida en el
 * carrito con solo el correo y aún sin verificar (`accountSetupPending` en `true` y `emailVerified` en `false`; §CTA.4
 * `PATCH /users/me/email`, CTA-F5): «Corregir mi correo» abre `EmailCorrection` y el servidor manda «Termina tu cuenta»
 * al correo nuevo. Las demás NO lo editan (`UpdateMeDto` no lo acepta y cambiarlo rompe la prueba de titularidad del
 * reclamo): nota con `mailto:` al contacto de soporte del proyecto (nunca un literal nuevo, §7.11). Para el staff: solo
 * el valor y el pill (su cuenta la dio de alta el admin; sin reenvío).
 */
export function EmailSection({ user, canResend }: { user: UserDTO; canResend: boolean }) {
  // §CTA (P-CTA-2, provisional): el predicado de «corregible» de arriba. TL-CTA-4: pendiente de moverse a
  // `lib/account-state.ts` (`canCorrectEmail(user)`).
  const correctable = canResend && user.accountSetupPending === true && user.emailVerified === false;
  const t = useTranslations('account.email');
  const tv = useTranslations('verifyEmail');
  const { status, resend } = useResendVerification();
  const verified = user.emailVerified !== false;
  // §CTA-UX.6 (9): el botón dice el correo que sale (pendiente ⇒ «Termina tu cuenta»).
  const setupPending = resendSendsAccountSetup(user);
  const contact = SUPPORT_CONTACT_FALLBACK;

  return (
    <SectionShell id="email" title={t('title')}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <p className="break-all text-base text-text">{user.email}</p>
        <span
          className={
            verified
              ? 'font-mono text-[11px] uppercase tracking-label text-success'
              : 'font-mono text-[11px] uppercase tracking-label text-accent'
          }
        >
          {verified ? t('verified') : t('unverified')}
        </span>
      </div>

      {!verified && canResend && (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-sm text-muted">{t('unverifiedBody')}</p>
          {status === 'sent' ? (
            <p role="status" className="text-sm font-medium text-success">
              {setupPending ? tv('sentSetup') : tv('sent')}
            </p>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              loading={status === 'sending'}
              onClick={resend}
              className="w-full sm:w-auto"
            >
              {status === 'sending' ? tv('sending') : setupPending ? t('resendSetupCta') : tv('resendCta')}
            </Button>
          )}
          {status === 'rateLimited' && (
            <p role="alert" className="font-mono text-xs text-accent">
              {tv('rateLimited')}
            </p>
          )}
          {status === 'error' && (
            <p role="alert" className="font-mono text-xs text-accent">
              {tv('resendError')}
            </p>
          )}
        </div>
      )}

      {correctable && <EmailCorrection current={user.email ?? ''} />}

      <p className="mt-4 text-xs text-muted">
        {/* `{contact}` es un placeholder de VALOR en el catálogo (copiado tal cual de §33.13); se parte
            la cadena traducida en el hueco para que el correo sea un `mailto:` sin retocar el copy. */}
        {(() => {
          const SENTINEL = '\u0000';
          const [before, after] = t('changeNote', { contact: SENTINEL }).split(SENTINEL);
          return (
            <>
              {before}
              <a href={`mailto:${contact}`} className="text-text underline-offset-2 hover:underline">
                {contact}
              </a>
              {after}
            </>
          );
        })()}
      </p>
    </SectionShell>
  );
}

/**
 * Corregir el correo mal tecleado (§CTA.4 `PATCH /users/me/email`, CTA-F5). Textos en `account.email.correct*`.
 * Foco (DESIGN_SYSTEM §CTA-UX.4): el enlace y el formulario se reemplazan uno al otro, así que el foco se lleva a mano
 * — al abrir, al campo; al cancelar o guardar, de vuelta a «Corregir mi correo» — para que no caiga al `body`.
 * Solo tras una acción del usuario (`focusTarget`), nunca al montar la página.
 */
function EmailCorrection({ current }: { current: string }) {
  const t = useTranslations('account.email');
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(current);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [focusTarget, setFocusTarget] = useState<'field' | 'opener' | null>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!focusTarget) return;
    (focusTarget === 'field' ? fieldRef : openerRef).current?.focus();
    setFocusTarget(null);
  }, [focusTarget, open]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setState('saving');
    try {
      const user = await updateMyEmail(value.trim());
      qc.setQueryData(['me'], user);
      setState('saved');
      setOpen(false);
      setFocusTarget('opener');
    } catch (err) {
      const code = err instanceof ApiClientError ? err.code : undefined;
      setState('idle');
      if (code === 'EMAIL_TAKEN') setError(t('correctTaken'));
      else if (code === 'RATE_LIMITED') setError(t('correctRateLimited'));
      else if (code === 'VALIDATION_ERROR') setError(t('correctInvalid'));
      else if (code === 'ACCOUNT_SETUP_NOT_PENDING') {
        setError(t('correctNotPending'));
        void qc.invalidateQueries({ queryKey: ['me'] });
      } else setError(t('correctError'));
    }
  }

  if (!open) {
    return (
      <div className="mt-4 flex flex-col gap-2">
        {state === 'saved' && (
          <p role="status" className="text-sm font-medium text-success">
            {t('correctSaved')}
          </p>
        )}
        <button
          ref={openerRef}
          type="button"
          onClick={() => {
            setValue(current);
            setOpen(true);
            setFocusTarget('field');
          }}
          className="inline-flex min-h-[44px] items-center self-start text-sm text-text underline underline-offset-4 hover:text-accent"
        >
          {t('correctOpen')}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-4 flex flex-col gap-3" data-testid="email-correction">
      <Input
        ref={fieldRef}
        label={t('correctLabel')}
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        spellCheck={false}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        error={error ?? undefined}
        hint={t('correctHint')}
        required
      />
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" size="sm" loading={state === 'saving'} className="w-full sm:w-auto">
          {t('correctSubmit')}
        </Button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
            setFocusTarget('opener');
          }}
          className="inline-flex min-h-[44px] items-center text-sm text-muted hover:text-text"
        >
          {t('correctCancel')}
        </button>
      </div>
    </form>
  );
}

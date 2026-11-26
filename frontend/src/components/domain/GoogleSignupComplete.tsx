'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { completeGoogleSignup } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { clearGoogleSignup, readGoogleSignup, trackSignupPhone, type GoogleSignupStash } from '@/lib/api/google-signup';
import { normalizeMxPhone, normalizePhoneInput, shouldShowPhoneError } from '@/lib/phone';
import { homeForRole, safeNext as safeNextOf } from '@/lib/account-routes';
import { Link, useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Banner } from '@/components/ui/Banner';

/**
 * §CELULAR-ALTA §6.2 · paso «Completa tu cuenta» tras volver de Google con un correo SIN cuenta. Pide el celular y llama
 * `POST /auth/google/complete { signupToken, phone }`. El token viene de `sessionStorage` (⛔ no de la URL). Token vencido
 * (15 min, `401 SIGNUP_EXPIRED`) o ausente ⇒ mensaje claro y volver a empezar con Google. Sin SMS. ⛔ El celular no va a medición.
 */
export function GoogleSignupComplete({ next }: { next?: string }) {
  const t = useTranslations('auth.phoneSignup');
  const router = useRouter();
  const [stash, setStash] = useState<GoogleSignupStash | null | undefined>(undefined);
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blurred, setBlurred] = useState(false);
  const shown = useRef(false);

  useEffect(() => {
    setStash(readGoogleSignup());
  }, []);
  useEffect(() => {
    if (stash && !shown.current) {
      shown.current = true;
      trackSignupPhone('shown', 'google');
    }
  }, [stash]);

  const normalized = normalizeMxPhone(phone);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stash) return;
    if (!normalized) {
      setError(t('error'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await completeGoogleSignup({ signupToken: stash.signupToken, phone: normalized });
      clearGoogleSignup();
      trackSignupPhone('done', 'google');
      router.replace(safeNextOf(next) ?? homeForRole(res.user.role));
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'SIGNUP_EXPIRED') {
        clearGoogleSignup();
        setExpired(true);
      } else if (err instanceof ApiClientError && err.status === 422) {
        setError(t('error'));
      } else {
        setError(t('failed'));
      }
      setBusy(false);
    }
  }

  if (stash === undefined) return null;
  if (stash === null || expired) {
    return (
      <div className="flex flex-col gap-6" data-testid="google-signup-expired">
        <h1 className="font-serif text-[30px] leading-[1.1] text-text lg:text-[38px]">{t('title')}</h1>
        <Banner variant="warning" role="alert">
          {t('expired')}
        </Banner>
        <Link href="/login" className="inline-flex min-h-[44px] items-center text-sm text-text underline underline-offset-4 hover:text-accent">
          {t('restart')}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6" data-testid="google-signup-form">
      <div>
        <h1 className="font-serif text-[30px] leading-[1.1] text-text lg:text-[38px]">{t('title')}</h1>
        <p id="google-signup-help" className="mt-4 text-base leading-relaxed text-muted">
          {t('help')}
        </p>
        {stash.email && (
          <p className="mt-2 font-mono text-xs text-muted" data-testid="google-signup-email">
            {stash.email}
          </p>
        )}
      </div>
      <div aria-live="polite">
        <Input
          label={t('label')}
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          prefix="+52"
          autoFocus
          aria-describedby="google-signup-help"
          value={phone}
          onChange={(e) => {
            setError(null);
            setPhone(normalizePhoneInput(e.target.value));
          }}
          onBlur={() => setBlurred(true)}
          error={error ?? (shouldShowPhoneError(phone, blurred) ? t('error') : undefined)}
        />
      </div>
      <Button type="submit" size="lg" disabled={!normalized} loading={busy}>
        {t('button')}
      </Button>
      <Link
        href="/login"
        onClick={() => clearGoogleSignup()}
        className="inline-flex min-h-[44px] items-center justify-center text-sm text-muted underline underline-offset-4 hover:text-text"
      >
        {t('cancel')}
      </Link>
    </form>
  );
}

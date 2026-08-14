'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Link } from '@/i18n/navigation';
import { login, register } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { GoogleSignInButton } from './GoogleSignInButton';

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const t = useTranslations('auth');
  const tErr = useTranslations('error');
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorCode(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    try {
      // Email/contraseña es la acción PRIMARIA (contrato §1 /auth/login|register).
      if (mode === 'login') {
        await login({ email, password });
      } else {
        await register({
          email,
          password,
          name: String(form.get('name') ?? ''),
          phone: String(form.get('phone') ?? '') || undefined,
        });
      }
      router.push('/');
    } catch (err) {
      setErrorCode(err instanceof ApiClientError ? err.code : 'INTERNAL');
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <h1 className="text-h2 font-bold">{mode === 'login' ? t('loginTitle') : t('registerTitle')}</h1>
      <Banner variant="info">{t('mockNotice')}</Banner>
      {errorCode && (
        <Banner variant="danger" role="alert">
          {tErr.has(errorCode) ? tErr(errorCode) : tErr('INTERNAL')}
        </Banner>
      )}
      {mode === 'register' && (
        <>
          <Input label={t('name')} name="name" autoComplete="name" required />
          <Input label={t('phone')} name="phone" type="tel" inputMode="tel" autoComplete="tel" />
        </>
      )}
      <Input label={t('email')} name="email" type="email" autoComplete="email" required />
      <Input
        label={t('password')}
        name="password"
        type="password"
        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        required
      />
      <Button type="submit" loading={loading} className="w-full">
        {loading ? t('loading') : mode === 'login' ? t('loginCta') : t('registerCta')}
      </Button>

      {/* Divisor "o / or" — Google es alternativa neutra, no compite como CTA */}
      <div className="flex items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted">{t('dividerOr')}</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <GoogleSignInButton onSuccess={() => router.push('/')} />

      <Link
        href={mode === 'login' ? '/register' : '/login'}
        className="text-center text-sm text-primary hover:underline"
      >
        {mode === 'login' ? t('toRegister') : t('toLogin')}
      </Link>
    </form>
  );
}

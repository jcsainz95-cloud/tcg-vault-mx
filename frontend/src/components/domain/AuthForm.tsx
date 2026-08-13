'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Link } from '@/i18n/navigation';
import { setToken } from '@/lib/api-client';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const t = useTranslations('auth');
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // MOCK: pendiente backend (contrato §1 /auth/login|register). Guarda sesión local.
    setLoading(true);
    await new Promise((r) => setTimeout(r, 600));
    setToken('mock.session.token');
    setLoading(false);
    router.push('/');
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <h1 className="text-h2 font-bold">{mode === 'login' ? t('loginTitle') : t('registerTitle')}</h1>
      <Banner variant="info">{t('mockNotice')}</Banner>
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
      <Link
        href={mode === 'login' ? '/register' : '/login'}
        className="text-center text-sm text-primary hover:underline"
      >
        {mode === 'login' ? t('toRegister') : t('toLogin')}
      </Link>
    </form>
  );
}

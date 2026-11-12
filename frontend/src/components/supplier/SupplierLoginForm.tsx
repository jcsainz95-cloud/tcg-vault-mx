'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from '@/i18n/navigation';
import { login, logout } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

/** Login propio del portal. Mismo `POST /auth/login`; solo entra el rol `supplier` (§0 del anexo). */
export function SupplierLoginForm() {
  const t = useTranslations('supplier.login');
  const te = useTranslations('supplier.errors');
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [notSupplier, setNotSupplier] = useState(false);

  const m = useMutation({
    mutationFn: () => login({ email: email.trim(), password }),
    onSuccess: async (res) => {
      if (res.user.role !== 'supplier') {
        // Sesión ajena al portal: se cierra, no se reutiliza.
        await logout();
        setNotSupplier(true);
        return;
      }
      router.replace('/proveedores');
    },
  });

  const code = asApiError(m.error)?.code;
  const errText = notSupplier
    ? t('notSupplier')
    : m.isError
      ? code && te.has(code)
        ? te(code)
        : t('failed')
      : null;

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        setNotSupplier(false);
        m.mutate();
      }}
    >
      <h1 className="font-serif text-3xl text-text">{t('title')}</h1>
      <p className="text-sm text-muted">{t('body')}</p>
      {errText && <Banner variant="danger">{errText}</Banner>}
      <Input label={t('email')} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <Input label={t('password')} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      <Button type="submit" loading={m.isPending}>{t('submit')}</Button>
      <p className="text-xs text-muted">{t('noSignup')}</p>
    </form>
  );
}

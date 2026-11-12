'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from '@/i18n/navigation';
import { acceptSupplierInvite } from '@/lib/api/suppliers';
import { asApiError } from '@/lib/api-client';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

/** Activación por invitación (`POST /auth/supplier/accept-invite`): token de un solo uso, 72 h. */
export function SupplierActivateForm({ token }: { token: string }) {
  const t = useTranslations('supplier.activate');
  const te = useTranslations('supplier.errors');
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const mismatch = again.length > 0 && again !== password;

  const m = useMutation({
    mutationFn: () => acceptSupplierInvite({ token, password }),
    onSuccess: () => router.replace('/proveedores'),
  });

  if (!token) return <Banner variant="danger">{t('noToken')}</Banner>;
  const code = asApiError(m.error)?.code;

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!mismatch) m.mutate();
      }}
    >
      <h1 className="font-serif text-3xl text-text">{t('title')}</h1>
      <p className="text-sm text-muted">{t('body')}</p>
      {m.isError && <Banner variant="danger">{code && te.has(code) ? te(code) : t('failed')}</Banner>}
      <Input label={t('password')} type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
      <Input label={t('again')} type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} error={mismatch ? t('mismatch') : undefined} />
      <Button type="submit" loading={m.isPending} disabled={mismatch || password.length < 8}>{t('submit')}</Button>
    </form>
  );
}

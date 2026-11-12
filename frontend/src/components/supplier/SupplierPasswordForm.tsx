'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from '@/i18n/navigation';
import { changeSupplierPassword } from '@/lib/api/suppliers';
import { patchStoredUser, getStoredUser } from '@/lib/session';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ApiErrorBanner } from './ApiErrorBanner';

/** `/proveedores/cambiar-contrasena`: `POST /supplier/me/password` (no `/auth/change-password`, prohibido al rol). */
export function SupplierPasswordForm() {
  const t = useTranslations('supplier.password');
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const forced = getStoredUser()?.mustChangePassword === true;
  const mismatch = again.length > 0 && again !== next;

  const m = useMutation({
    mutationFn: () => changeSupplierPassword({ currentPassword: current, newPassword: next }),
    onSuccess: () => {
      patchStoredUser({ mustChangePassword: false });
      router.replace('/proveedores');
    },
  });

  return (
    <form
      className="mx-auto flex max-w-md flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!mismatch) m.mutate();
      }}
    >
      <h1 className="font-serif text-3xl text-text">{t('title')}</h1>
      {forced && <Banner variant="warning">{t('forced')}</Banner>}
      <ApiErrorBanner error={m.error} />
      <Input label={t('current')} type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
      <Input label={t('next')} type="password" autoComplete="new-password" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} />
      <Input label={t('again')} type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} error={mismatch ? t('mismatch') : undefined} />
      <Button type="submit" loading={m.isPending} disabled={mismatch || next.length < 8 || !current}>{t('submit')}</Button>
    </form>
  );
}

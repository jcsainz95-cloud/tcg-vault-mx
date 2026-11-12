'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { QueryState } from '@/components/ui/QueryState';
import { Skeleton } from '@/components/ui/Skeleton';
import { ApiErrorBanner } from '@/components/supplier/ApiErrorBanner';
import { useRole } from '@/lib/role';
import { formatDateTimeMx } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import { inviteSupplier, listSuppliers, patchSupplier, type SupplierRow, type SupplierStatus } from '@/lib/api/suppliers';

const TONE = { invited: 'info', active: 'success', suspended: 'danger' } as const;

/** Tiendas aliadas: invitar (admin), suspender/reactivar (admin), reenviar enlace (admin). */
export function SuppliersTab() {
  const t = useTranslations('admin.suppliers.stores');
  const { isSuperAdmin } = useRole();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['admin', 'suppliers'], queryFn: () => listSuppliers() });
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const inv = useMutation({
    mutationFn: () => inviteSupplier({ businessName: name.trim(), email: email.trim(), ...(phone.trim() ? { phone: phone.trim() } : {}) }),
    onSuccess: () => {
      setName('');
      setEmail('');
      setPhone('');
      void qc.invalidateQueries({ queryKey: ['admin', 'suppliers'] });
    },
  });

  return (
    <div className="flex flex-col gap-6">
      {isSuperAdmin && (
        <form
          className="grid gap-4 border-l-2 border-accent pl-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            inv.mutate();
          }}
        >
          <h2 className="font-serif text-xl sm:col-span-2">{t('inviteTitle')}</h2>
          <Input label={t('businessName')} required value={name} onChange={(e) => setName(e.target.value)} />
          <Input label={t('email')} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input label={t('phone')} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <div className="sm:col-span-2 flex flex-col gap-3">
            <ApiErrorBanner error={inv.error} />
            {inv.isSuccess && <Banner variant="success">{t('invited')}</Banner>}
            <Button type="submit" className="self-start" loading={inv.isPending}>{t('invite')}</Button>
          </div>
        </form>
      )}
      <QueryState isLoading={query.isLoading} isError={query.isError} error={query.error} onRetry={() => query.refetch()} loading={<Skeleton className="h-32 w-full" />}>
        {query.data && query.data.data.length === 0 ? (
          <EmptyState title={t('emptyTitle')} body={t('emptyBody')} />
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {query.data?.data.map((s) => (
              <li key={s.id} className="py-4">
                <StoreRow s={s} canEdit={isSuperAdmin} />
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </div>
  );
}

function StoreRow({ s, canEdit }: { s: SupplierRow; canEdit: boolean }) {
  const t = useTranslations('admin.suppliers.stores');
  const ts = useTranslations('admin.suppliers.supplierStatus');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (body: { status?: 'active' | 'suspended'; resetPassword?: true }) => patchSupplier(s.id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'suppliers'] }),
  });
  const next: SupplierStatus | null = s.status === 'active' ? 'suspended' : s.status === 'suspended' ? 'active' : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <p className="font-serif text-lg text-text">{s.businessName}</p>
        <Badge tone={TONE[s.status]}>{ts(s.status)}</Badge>
      </div>
      <p className="text-sm text-muted">
        {s.email}
        {s.phone ? ` · ${s.phone}` : ''} · {t('openOffers', { count: s.openOffers })}
        {s.activatedAt ? ` · ${t('activatedAt', { date: formatDateTimeMx(s.activatedAt, locale) })}` : ''}
      </p>
      <ApiErrorBanner error={m.error} />
      {canEdit && (
        <div className="flex flex-wrap gap-3">
          {next && (
            <Button variant="secondary" size="sm" loading={m.isPending} onClick={() => m.mutate({ status: next })}>
              {next === 'suspended' ? t('deactivate') : t('reactivate')}
            </Button>
          )}
          {s.status !== 'suspended' && (
            <Button variant="ghost" size="sm" loading={m.isPending} onClick={() => m.mutate({ resetPassword: true })}>
              {s.status === 'invited' ? t('resend') : t('resetPassword')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

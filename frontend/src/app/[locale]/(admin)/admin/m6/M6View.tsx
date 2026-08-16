'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  getAdminUsers,
  getAdminUser,
  updateUserKyc,
  updateUserStatus,
  type AdminUsersFilters,
} from '@/lib/api';
import type { AdminUserSummaryDTO, KycStatus } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents, formatDate } from '@/lib/format';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Banner } from '@/components/ui/Banner';
import { Badge } from '@/components/ui/Badge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { QueryState } from '@/components/ui/QueryState';
import { EmptyState } from '@/components/ui/EmptyState';

const KYC_STATUSES: KycStatus[] = ['none', 'pending', 'verified', 'rejected'];
const PAGE_SIZE = 20;

export function M6View() {
  const t = useTranslations('admin.m6');
  const tm = useTranslations('admin');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();

  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | 'active' | 'blocked'>('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filters: AdminUsersFilters = {
    q: q || undefined,
    status: status || undefined,
    page,
    pageSize: PAGE_SIZE,
  };
  const users = useQuery({
    queryKey: ['admin-users', filters],
    queryFn: () => getAdminUsers(filters),
  });

  const detail = useQuery({
    queryKey: ['admin-user', selectedId],
    queryFn: () => getAdminUser(selectedId!),
    enabled: !!selectedId,
  });
  const d = detail.data;
  const currentKyc = d?.kycProfile;

  // --- Edición de KYC ---
  // Borrador: solo las keys que el admin tocó explícitamente. Lo que no está en el
  // borrador cae al valor del servidor (kycStatus) o queda vacío (topes). Así "Guardar
  // KYC" nunca degrada el kycStatus cargado salvo que el admin lo cambie a propósito.
  const [kycDraft, setKycDraft] = useState<{
    kycStatus?: KycStatus;
    capRequest?: string;
    capMonth?: string;
  }>({});

  // El borrador no cruza entre usuarios: se reinicia al cambiar de usuario seleccionado.
  useEffect(() => {
    setKycDraft({});
  }, [selectedId]);

  const kycStatus: KycStatus = kycDraft.kycStatus ?? currentKyc?.kycStatus ?? 'none';
  const capRequest = kycDraft.capRequest ?? '';
  const capMonth = kycDraft.capMonth ?? '';

  const kycMutation = useMutation({
    mutationFn: () =>
      updateUserKyc(selectedId!, {
        kycStatus,
        capPerRequestCents: capRequest ? Math.round(Number(capRequest) * 100) : undefined,
        capPerMonthCents: capMonth ? Math.round(Number(capMonth) * 100) : undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-user', selectedId] });
    },
  });

  // --- Bloqueo/activación ---
  const [blockTarget, setBlockTarget] = useState<'active' | 'blocked' | null>(null);
  const statusMutation = useMutation({
    mutationFn: (next: 'active' | 'blocked') => updateUserStatus(selectedId!, next),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-user', selectedId] });
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      setBlockTarget(null);
    },
  });

  const columns: Column<AdminUserSummaryDTO>[] = [
    { key: 'name', header: t('table.name'), render: (u) => <span className="font-medium">{u.name}</span> },
    { key: 'email', header: t('table.email'), render: (u) => <span className="tabular text-muted">{u.email}</span> },
    { key: 'role', header: t('table.role'), render: (u) => <Badge tone="neutral">{u.role}</Badge> },
    {
      key: 'status',
      header: t('table.status'),
      render: (u) =>
        u.status === 'blocked' ? (
          <Badge tone="danger" shape="soft">{t('blocked')}</Badge>
        ) : (
          <Badge tone="success" shape="soft">{t('active')}</Badge>
        ),
    },
    { key: 'createdAt', header: t('table.created'), render: (u) => formatDate(u.createdAt, locale) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (u) => (
        <Button size="sm" variant="secondary" onClick={() => openDetail(u.id)}>
          {t('view')}
        </Button>
      ),
    },
  ];

  function openDetail(id: string) {
    setSelectedId(id);
  }

  const totalPages = users.data ? Math.max(1, Math.ceil(users.data.total / PAGE_SIZE)) : 1;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-h1 font-bold">{t('title')}</h1>
        <p className="text-sm text-muted">{t('subtitle')}</p>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3">
        <Input
          label={t('searchLabel')}
          className="w-64"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
          placeholder={tm('searchGlobal')}
        />
        <Select
          label={t('table.status')}
          className="w-40"
          options={[
            { value: '', label: tc('all') },
            { value: 'active', label: t('active') },
            { value: 'blocked', label: t('blocked') },
          ]}
          value={status}
          onChange={(e) => { setStatus(e.target.value as '' | 'active' | 'blocked'); setPage(1); }}
        />
        <Button variant="ghost" onClick={() => users.refetch()}>
          <Search size={18} /> {tc('search')}
        </Button>
      </div>

      {/* Tabla de usuarios */}
      <QueryState
        isLoading={users.isLoading}
        isError={users.isError}
        error={users.error}
        onRetry={() => users.refetch()}
      >
        {users.data && users.data.data.length > 0 ? (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-border bg-surface p-2">
              <DataTable columns={columns} rows={users.data.data} rowKey={(u) => u.id} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">
                {t('pageInfo', { page: users.data.page, totalPages, total: users.data.total })}
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft size={16} /> {t('prev')}
                </Button>
                <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  {t('next')} <ChevronRight size={16} />
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <EmptyState title={t('emptyTitle')} body={t('emptyBody')} />
        )}
      </QueryState>

      {/* Ficha 360° (modal) */}
      <Modal
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
        title={t('detailTitle')}
        footer={
          <Button variant="secondary" onClick={() => setSelectedId(null)}>
            {tc('close')}
          </Button>
        }
      >
        <QueryState
          isLoading={detail.isLoading}
          isError={detail.isError}
          error={detail.error}
          onRetry={() => detail.refetch()}
        >
          {d && (
            <div className="flex flex-col gap-5">
              {/* Identidad */}
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-h3 font-semibold">{d.name}</span>
                  {d.status === 'blocked' ? (
                    <Badge tone="danger">{t('blocked')}</Badge>
                  ) : (
                    <Badge tone="success">{t('active')}</Badge>
                  )}
                  <Badge tone="neutral">{d.role}</Badge>
                  {d.authProvider && <Badge tone="info">{d.authProvider}</Badge>}
                </div>
                <span className="tabular text-sm text-muted">{d.email}</span>
              </div>

              {/* KYC (CLABE/RFC enmascarados) */}
              <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{t('kycTitle')}</span>
                  {currentKyc && <StatusBadge domain="kyc" value={currentKyc.kycStatus} />}
                </div>
                {currentKyc ? (
                  <>
                    <dl className="grid grid-cols-2 gap-2 text-sm">
                      <dt className="text-muted">{t('clabe')}</dt>
                      <dd className="tabular">{currentKyc.clabeMasked ?? '—'}</dd>
                      <dt className="text-muted">{t('rfc')}</dt>
                      <dd className="tabular">{currentKyc.rfcMasked ?? '—'}</dd>
                      <dt className="text-muted">{t('ineOnFile')}</dt>
                      <dd>{currentKyc.ineOnFile ? t('yes') : t('no')}</dd>
                      <dt className="text-muted">{t('capRequest')}</dt>
                      <dd className="tabular">{currentKyc.capPerRequestCents != null ? formatMoneyCents(currentKyc.capPerRequestCents, locale) : '—'}</dd>
                      <dt className="text-muted">{t('capMonth')}</dt>
                      <dd className="tabular">{currentKyc.capPerMonthCents != null ? formatMoneyCents(currentKyc.capPerMonthCents, locale) : '—'}</dd>
                    </dl>
                    <p className="text-xs text-muted">{t('maskedNote')}</p>

                    {/* Editar KYC */}
                    <div className="mt-2 flex flex-col gap-3 border-t border-border pt-3">
                      <Select
                        label={t('kycStatusLabel')}
                        options={KYC_STATUSES.map((s) => ({ value: s, label: t(`kycStatusOption.${s}`) }))}
                        value={kycStatus}
                        onChange={(e) => setKycDraft((prev) => ({ ...prev, kycStatus: e.target.value as KycStatus }))}
                      />
                      <div className="flex gap-3">
                        <Input label={t('capRequest')} type="text" inputMode="decimal" prefix="MX$" className="w-full" value={capRequest} onChange={(e) => setKycDraft((prev) => ({ ...prev, capRequest: e.target.value }))} placeholder={currentKyc.capPerRequestCents != null ? String(currentKyc.capPerRequestCents / 100) : ''} />
                        <Input label={t('capMonth')} type="text" inputMode="decimal" prefix="MX$" className="w-full" value={capMonth} onChange={(e) => setKycDraft((prev) => ({ ...prev, capMonth: e.target.value }))} placeholder={currentKyc.capPerMonthCents != null ? String(currentKyc.capPerMonthCents / 100) : ''} />
                      </div>
                      <Button size="sm" variant="secondary" loading={kycMutation.isPending} onClick={() => kycMutation.mutate()}>
                        {t('saveKyc')}
                      </Button>
                      {kycMutation.isSuccess && <Banner variant="success" role="status">{t('kycSaved')}</Banner>}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted">{t('noKyc')}</p>
                )}
              </div>

              {/* Resumen 360° */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <SummaryCount label={t('orders')} value={d.orders?.length ?? 0} />
                <SummaryCount label={t('sellRequests')} value={d.sellRequests?.length ?? 0} />
                <SummaryCount label={t('disputes')} value={d.disputes?.length ?? 0} />
                <SummaryCount label={t('vaultItems')} value={d.ownedItems?.length ?? 0} />
              </div>

              {/* Direcciones */}
              {d.addresses && d.addresses.length > 0 && (
                <div className="flex flex-col gap-1 text-sm">
                  <span className="font-semibold">{t('addresses')}</span>
                  {d.addresses.map((a) => (
                    <span key={a.id} className="text-muted">
                      {a.line1}, {a.city}, {a.state} {a.postalCode} ({a.country})
                    </span>
                  ))}
                </div>
              )}

              {/* Bloquear / activar */}
              <div className="flex items-center justify-between border-t border-border pt-3">
                <span className="text-xs text-muted">{tm('moneyOutNote')}</span>
                {d.status === 'blocked' ? (
                  <Button variant="secondary" onClick={() => setBlockTarget('active')}>
                    {t('unblock')}
                  </Button>
                ) : (
                  <Button variant="destructive" onClick={() => setBlockTarget('blocked')}>
                    {t('block')}
                  </Button>
                )}
              </div>
            </div>
          )}
        </QueryState>
      </Modal>

      {/* Confirmación de bloqueo/activación */}
      <Modal
        open={!!blockTarget}
        onClose={() => setBlockTarget(null)}
        title={blockTarget === 'blocked' ? t('block') : t('unblock')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setBlockTarget(null)}>
              {tc('cancel')}
            </Button>
            <Button
              variant={blockTarget === 'blocked' ? 'destructive' : 'primary'}
              loading={statusMutation.isPending}
              onClick={() => blockTarget && statusMutation.mutate(blockTarget)}
            >
              {blockTarget === 'blocked' ? t('block') : t('unblock')}
            </Button>
          </>
        }
      >
        <p>{blockTarget === 'blocked' ? t('blockQuestion') : t('unblockQuestion')}</p>
      </Modal>
    </div>
  );
}

function SummaryCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="tabular text-h3 font-semibold">{value}</p>
    </div>
  );
}

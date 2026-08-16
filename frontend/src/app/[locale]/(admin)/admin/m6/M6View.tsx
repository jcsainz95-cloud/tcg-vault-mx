'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Search, ChevronLeft, ChevronRight, KeyRound, Trash2, Copy, Check, UserPlus } from 'lucide-react';
import {
  getAdminUsers,
  getAdminUser,
  updateUserKyc,
  updateUserStatus,
  resetUserPassword,
  deleteUser,
  createAdminUser,
  getAdminUserOrders,
  getAdminUserBuylist,
  getAdminUserShipments,
  getAdminUserDisputes,
  getAdminUserAudit,
  type AdminUsersFilters,
  type CreateAdminUserInput,
  type UserHistoryParams,
} from '@/lib/api';
import type {
  AdminUserSummaryDTO,
  AdminUserOwnedItemRef,
  AdminCreatedUserDTO,
  UserAuditEntryDTO,
  KycStatus,
  Role,
  Paginated,
  ResetPasswordResponse,
  DeleteUserResponse,
} from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { ApiClientError } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/session';
import { useRole } from '@/lib/role';
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
import { FinishBadge } from '@/components/domain/FinishBadge';

const KYC_STATUSES: KycStatus[] = ['none', 'pending', 'verified', 'rejected'];
const CREATE_ROLES: Role[] = ['customer', 'vault_operator', 'super_admin'];
const PAGE_SIZE = 20;
const HISTORY_PAGE_SIZE = 10;

export function M6View() {
  const t = useTranslations('admin.m6');
  const tm = useTranslations('admin');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const { isSuperAdmin } = useRole();

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

  // --- Reset de contraseña (super_admin): la temp password se muestra UNA sola vez ---
  const session = useSession();
  const isSelf = !!session.user && session.user.id === selectedId;
  const [resetResult, setResetResult] = useState<ResetPasswordResponse | null>(null);
  const resetMutation = useMutation({
    mutationFn: () => resetUserPassword(selectedId!),
    onSuccess: (res) => setResetResult(res),
  });

  // --- Crear usuario (super_admin): alta por rol; la temp password (si se autogenera) se
  // muestra UNA sola vez con el MISMO patrón/panel que el reset M-15. ---
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateAdminUserInput>({ email: '', name: '', role: 'customer' });
  const [createResult, setCreateResult] = useState<AdminCreatedUserDTO | null>(null);
  const createMutation = useMutation({
    mutationFn: () =>
      createAdminUser({
        email: createForm.email.trim(),
        name: createForm.name.trim(),
        role: createForm.role,
        // Vacío ⇒ el backend autogenera la temporal y la devuelve una vez.
        password: createForm.password?.trim() ? createForm.password.trim() : undefined,
      }),
    onSuccess: (res) => {
      setCreateOpen(false);
      setCreateResult(res);
      qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });

  function openCreate() {
    setCreateForm({ email: '', name: '', role: 'customer', password: '' });
    createMutation.reset();
    setCreateOpen(true);
  }

  // Traduce el errorCode del contrato a copy claro (409 EMAIL_TAKEN / 422 VALIDATION_ERROR / 403).
  function createErrorMessage(err: unknown): string {
    const code = err instanceof ApiClientError ? err.code : undefined;
    if (code === 'EMAIL_TAKEN') return t('create.errorEmailTaken');
    if (code === 'VALIDATION_ERROR') return t('create.errorValidation');
    if (code === 'FORBIDDEN') return t('create.errorForbidden');
    return t('create.errorGeneric');
  }

  // --- Eliminar usuario (super_admin): híbrido hard/soft; 409 CANNOT_DELETE_SELF ---
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteResult, setDeleteResult] = useState<DeleteUserResponse | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteMutation = useMutation({
    mutationFn: () => deleteUser(selectedId!),
    onSuccess: (res) => {
      setDeleteResult(res);
      qc.invalidateQueries({ queryKey: ['admin-user', selectedId] });
      qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (err) => {
      const code = err instanceof ApiClientError ? err.code : undefined;
      setDeleteError(code === 'CANNOT_DELETE_SELF' ? t('deleteSelfError') : t('deleteError'));
    },
  });

  // El borrador de reset/borrado no cruza entre usuarios.
  useEffect(() => {
    setResetResult(null);
    setDeleteResult(null);
    setDeleteError(null);
    setDeleteOpen(false);
  }, [selectedId]);

  const columns: Column<AdminUserSummaryDTO>[] = [
    { key: 'name', header: t('table.name'), render: (u) => <span className="font-medium">{u.name}</span> },
    { key: 'email', header: t('table.email'), render: (u) => <span className="tabular text-muted">{u.email}</span> },
    { key: 'role', header: t('table.role'), render: (u) => <Badge tone="neutral">{u.role}</Badge> },
    {
      key: 'status',
      header: t('table.status'),
      render: (u) => <UserStatusBadge status={u.status} t={t} />,
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
        {/* Alta de usuario: solo super_admin (patrón useRole; el backend es la autoridad). */}
        {isSuperAdmin && (
          <Button variant="primary" className="ml-auto" onClick={openCreate}>
            <UserPlus size={18} /> {t('create.button')}
          </Button>
        )}
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
                  <UserStatusBadge status={d.status} t={t} />
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

              {/* Historial 360° por pestañas (lazy-load por endpoint filtrado por userId) */}
              <UserHistoryTabs userId={d.id} ownedItems={d.ownedItems ?? []} locale={locale} />

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
              {d.status !== 'deleted' && (
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
              )}

              {/* Gestión de cuenta (super_admin): reset de contraseña + eliminar */}
              {d.status !== 'deleted' && (
                <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
                  <span className="text-sm font-semibold">{t('accountTitle')}</span>
                  {/* Reset de contraseña */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="max-w-md text-xs text-muted">{t('resetHint')}</p>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={resetMutation.isPending}
                      onClick={() => resetMutation.mutate()}
                    >
                      <KeyRound size={16} /> {t('resetPassword')}
                    </Button>
                  </div>
                  {resetMutation.isError && (
                    <Banner variant="danger" role="alert">{t('resetError')}</Banner>
                  )}
                  {/* Eliminar usuario */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                    <p className="max-w-md text-xs text-muted">{t('deleteHint')}</p>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={isSelf}
                      onClick={() => { setDeleteError(null); setDeleteResult(null); setDeleteOpen(true); }}
                    >
                      <Trash2 size={16} /> {t('deleteUser')}
                    </Button>
                  </div>
                  {isSelf && <p className="text-xs text-muted">{t('deleteSelfHint')}</p>}
                </div>
              )}
            </div>
          )}
        </QueryState>
      </Modal>

      {/* Modal de contraseña temporal — se muestra UNA sola vez */}
      <Modal
        open={!!resetResult}
        onClose={() => setResetResult(null)}
        title={t('resetTitle')}
        footer={
          <Button onClick={() => setResetResult(null)}>{tc('close')}</Button>
        }
      >
        {resetResult && (
          <TempPasswordPanel
            tempPassword={resetResult.tempPassword}
            mustChangePassword={resetResult.mustChangePassword}
          />
        )}
      </Modal>

      {/* Crear usuario (super_admin) — formulario de alta por rol */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t('create.title')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button
              loading={createMutation.isPending}
              disabled={!createForm.email.trim() || !createForm.name.trim()}
              onClick={() => createMutation.mutate()}
            >
              {t('create.submit')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Input
            label={t('create.email')}
            type="email"
            autoComplete="off"
            value={createForm.email}
            onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
          />
          <Input
            label={t('create.name')}
            value={createForm.name}
            onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
          />
          <Select
            label={t('create.role')}
            options={CREATE_ROLES.map((r) => ({ value: r, label: t(`create.roleOption.${r}`) }))}
            value={createForm.role}
            onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value as Role }))}
          />
          <Input
            label={t('create.password')}
            type="text"
            autoComplete="off"
            hint={t('create.passwordHint')}
            value={createForm.password ?? ''}
            onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
          />
          {createForm.role === 'super_admin' && (
            <Banner variant="warning" role="status">{t('create.superAdminWarning')}</Banner>
          )}
          {createMutation.isError && (
            <Banner variant="danger" role="alert">{createErrorMessage(createMutation.error)}</Banner>
          )}
        </div>
      </Modal>

      {/* Resultado del alta — éxito + temp password (si se autogeneró) UNA sola vez */}
      <Modal
        open={!!createResult}
        onClose={() => setCreateResult(null)}
        title={t('create.successTitle')}
        footer={<Button onClick={() => setCreateResult(null)}>{tc('close')}</Button>}
      >
        {createResult && (
          <div className="flex flex-col gap-4">
            <Banner variant="success" role="status">
              {t('create.successBody', {
                email: createResult.user.email,
                role: t(`create.roleOption.${createResult.user.role}`),
              })}
            </Banner>
            {createResult.tempPassword ? (
              <TempPasswordPanel
                tempPassword={createResult.tempPassword}
                mustChangePassword={createResult.mustChangePassword}
              />
            ) : (
              <p className="text-sm text-muted">{t('create.providedPasswordNote')}</p>
            )}
          </div>
        )}
      </Modal>

      {/* Modal de eliminación — confirmación y resultado (hard/soft) */}
      <Modal
        open={deleteOpen}
        onClose={() => { setDeleteOpen(false); if (deleteResult) setSelectedId(null); }}
        title={t('deleteUser')}
        footer={
          deleteResult ? (
            <Button onClick={() => { setDeleteOpen(false); setSelectedId(null); }}>{tc('close')}</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setDeleteOpen(false)}>{tc('cancel')}</Button>
              <Button variant="destructive" loading={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>
                {t('deleteConfirm')}
              </Button>
            </>
          )
        }
      >
        {deleteResult ? (
          <Banner variant="success" role="status">
            {deleteResult.mode === 'hard' ? t('deleteResultHard') : t('deleteResultSoft')}
          </Banner>
        ) : (
          <div className="flex flex-col gap-3">
            <p>{t('deleteQuestion')}</p>
            <p className="text-sm text-muted">{t('deleteModeNote')}</p>
            {deleteError && <Banner variant="danger" role="alert">{deleteError}</Banner>}
          </div>
        )}
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

function UserStatusBadge({
  status,
  t,
}: {
  status: 'active' | 'blocked' | 'deleted';
  t: (key: string) => string;
}) {
  if (status === 'deleted') return <Badge tone="neutral" shape="soft">{t('deleted')}</Badge>;
  if (status === 'blocked') return <Badge tone="danger" shape="soft">{t('blocked')}</Badge>;
  return <Badge tone="success" shape="soft">{t('active')}</Badge>;
}

/**
 * Panel de contraseña temporal reutilizable (patrón M-15): la temporal se muestra UNA sola
 * vez con aviso, botón de copiar y nota de cambio obligatorio. Lo comparten el reset de
 * contraseña y el resultado del alta de usuario (cuando la password se autogenera).
 */
function TempPasswordPanel({
  tempPassword,
  mustChangePassword,
}: {
  tempPassword: string;
  mustChangePassword: boolean;
}) {
  const t = useTranslations('admin.m6');
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(tempPassword);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <Banner variant="warning">{t('resetOnce')}</Banner>
      <div className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-muted">{t('tempPassword')}</span>
        <div className="flex items-center gap-2">
          <code className="tabular flex-1 rounded-md border border-border bg-surface-2 px-3 py-2 text-base font-semibold">
            {tempPassword}
          </code>
          <Button size="sm" variant="secondary" onClick={copy} aria-label={t('copy')}>
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? t('copied') : t('copy')}
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted">{t('resetShareNote')}</p>
      {mustChangePassword && <p className="text-sm text-muted">{t('resetMustChangeNote')}</p>}
    </div>
  );
}

// ---- Historial 360° por pestañas (v1.7-admin-users) ----
type HistoryTab = 'purchases' | 'sales' | 'shipments' | 'disputes' | 'vault' | 'activity';
const HISTORY_TABS: HistoryTab[] = ['purchases', 'sales', 'shipments', 'disputes', 'vault', 'activity'];

/**
 * Pestañas de historial: cada pestaña de endpoint se carga LAZY (solo se monta la activa,
 * así la query se dispara al abrir la pestaña) y filtra por `userId`. La pestaña Bóveda usa
 * el resumen `ownedItems` que ya trae la ficha 360° (no hay endpoint admin de holdings por
 * usuario en el contrato).
 */
function UserHistoryTabs({
  userId,
  ownedItems,
  locale,
}: {
  userId: string;
  ownedItems: AdminUserOwnedItemRef[];
  locale: AppLocale;
}) {
  const t = useTranslations('admin.m6');
  const [tab, setTab] = useState<HistoryTab>('purchases');
  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-border">
        {HISTORY_TABS.map((k) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn(
              '-mb-px rounded-t-md px-3 py-2 text-sm font-medium',
              tab === k ? 'border-b-2 border-primary text-text' : 'text-muted hover:text-text',
            )}
          >
            {t(`tabs.${k}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'purchases' && (
          <PaginatedHistory
            queryKey={['admin-user-orders', userId]}
            queryFn={(p) => getAdminUserOrders(userId, p)}
            rowKey={(o) => o.id}
            columns={[
              { key: 'id', header: t('table.folio'), render: (o) => <span className="tabular font-medium">{o.id}</span> },
              { key: 'status', header: t('table.status'), render: (o) => <StatusBadge domain="order" value={o.status} /> },
              { key: 'total', header: t('table.total'), align: 'right', render: (o) => formatMoneyCents(o.totalCents, locale) },
              { key: 'createdAt', header: t('table.date'), render: (o) => formatDate(o.createdAt, locale) },
            ]}
          />
        )}
        {tab === 'sales' && (
          <PaginatedHistory
            queryKey={['admin-user-buylist', userId]}
            queryFn={(p) => getAdminUserBuylist(userId, p)}
            rowKey={(b) => b.id}
            columns={[
              { key: 'id', header: t('table.folio'), render: (b) => <span className="tabular font-medium">{b.id}</span> },
              { key: 'status', header: t('table.status'), render: (b) => <StatusBadge domain="sellRequest" value={b.status} /> },
              { key: 'total', header: t('table.quoted'), align: 'right', render: (b) => formatMoneyCents(b.quotedTotalCents, locale) },
              { key: 'createdAt', header: t('table.date'), render: (b) => formatDate(b.createdAt, locale) },
            ]}
          />
        )}
        {tab === 'shipments' && (
          <PaginatedHistory
            queryKey={['admin-user-shipments', userId]}
            queryFn={(p) => getAdminUserShipments(userId, p)}
            rowKey={(s) => s.id}
            columns={[
              { key: 'id', header: t('table.folio'), render: (s) => <span className="tabular font-medium">{s.id}</span> },
              { key: 'status', header: t('table.status'), render: (s) => <StatusBadge domain="shipment" value={s.status} /> },
              { key: 'tracking', header: t('table.tracking'), render: (s) => <span className="tabular text-muted">{s.carrier ? `${s.carrier} · ${s.trackingNumber ?? '—'}` : '—'}</span> },
              { key: 'createdAt', header: t('table.date'), render: (s) => formatDate(s.createdAt, locale) },
            ]}
          />
        )}
        {tab === 'disputes' && (
          <PaginatedHistory
            queryKey={['admin-user-disputes', userId]}
            queryFn={(p) => getAdminUserDisputes(userId, p)}
            rowKey={(d) => d.id}
            columns={[
              { key: 'id', header: t('table.folio'), render: (d) => <span className="tabular font-medium">{d.id}</span> },
              { key: 'status', header: t('table.status'), render: (d) => <StatusBadge domain="dispute" value={d.status} /> },
              { key: 'type', header: t('table.type'), render: (d) => (d.type ? t(`disputeType.${d.type}`) : '—') },
              { key: 'createdAt', header: t('table.date'), render: (d) => formatDate(d.createdAt, locale) },
            ]}
          />
        )}
        {tab === 'vault' && <VaultTab items={ownedItems} locale={locale} />}
        {tab === 'activity' && <ActivityTab userId={userId} locale={locale} />}
      </div>
    </div>
  );
}

/**
 * Tabla de historial paginada y lazy: dispara la query al montarse (al abrir la pestaña),
 * filtrando por `userId`. Reusa DataTable + QueryState del proyecto.
 */
function PaginatedHistory<T>({
  queryKey,
  queryFn,
  columns,
  rowKey,
}: {
  queryKey: unknown[];
  queryFn: (params: UserHistoryParams) => Promise<Paginated<T>>;
  columns: Column<T>[];
  rowKey: (row: T) => string;
}) {
  const t = useTranslations('admin.m6');
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: [...queryKey, page],
    queryFn: () => queryFn({ page, pageSize: HISTORY_PAGE_SIZE }),
  });
  const totalPages = query.data ? Math.max(1, Math.ceil(query.data.total / HISTORY_PAGE_SIZE)) : 1;
  return (
    <QueryState
      isLoading={query.isLoading}
      isError={query.isError}
      error={query.error}
      onRetry={() => query.refetch()}
    >
      {query.data && query.data.data.length > 0 ? (
        <div className="flex flex-col gap-2">
          <DataTable columns={columns} rows={query.data.data} rowKey={rowKey} />
          {query.data.total > HISTORY_PAGE_SIZE && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">
                {t('pageInfo', { page: query.data.page, totalPages, total: query.data.total })}
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
          )}
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-muted">{t('historyEmpty')}</p>
      )}
    </QueryState>
  );
}

/**
 * Pestaña Bóveda (v1.8-ronda-c · BE-10): usa el resumen `ownedItems` de la ficha 360°, ahora
 * enriquecido con `productType`, `finish` y `referenceValue` (PriceInfo por-acabado, mismo shape
 * que la bóveda del cliente). Por item se muestra acabado (FinishBadge, mismo mapeo que Compra/
 * bóveda) y valor de referencia; los `pending` se pintan con el estado honesto "PRECIO PENDIENTE"
 * (StatusBadge domain=price, warning outline), NUNCA $0 ni un valor falso. El total del pie suma
 * SOLO los `priced`; los `pending` se excluyen y se indican aparte (paridad con VaultView §7.3).
 */
function VaultTab({ items, locale }: { items: AdminUserOwnedItemRef[]; locale: AppLocale }) {
  const t = useTranslations('admin.m6');
  const tcat = useTranslations('catalog');
  if (items.length === 0) return <p className="py-6 text-center text-sm text-muted">{t('historyEmpty')}</p>;

  // Total: suma de los `priced`; los `pending` (sin precio del día) se excluyen del total
  // y se cuentan aparte, igual que el portafolio del cliente (`pendingPriceCount`).
  const pricedTotalCents = items.reduce(
    (sum, i) => sum + (i.referenceValue.status === 'priced' ? i.referenceValue.referenceMxnCents ?? 0 : 0),
    0,
  );
  const pendingCount = items.filter((i) => i.referenceValue.status === 'pending').length;

  return (
    <div className="flex flex-col gap-3">
      <DataTable
        columns={[
          { key: 'folio', header: t('table.folio'), render: (i: AdminUserOwnedItemRef) => <span className="tabular font-medium">{i.folio}</span> },
          {
            key: 'card',
            header: t('table.card'),
            render: (i: AdminUserOwnedItemRef) => (
              <div className="flex flex-col items-start gap-1">
                <span lang="en">{i.card.name}</span>
                <FinishBadge finish={i.finish} productType={i.productType} />
              </div>
            ),
          },
          { key: 'ownership', header: t('table.ownership'), render: (i: AdminUserOwnedItemRef) => <StatusBadge domain="ownership" value={i.ownershipStatus} /> },
          {
            key: 'value',
            header: tcat('marketValue'),
            align: 'right',
            render: (i: AdminUserOwnedItemRef) =>
              i.referenceValue.status === 'priced' && i.referenceValue.referenceMxnCents != null ? (
                <span className="tabular font-medium">{formatMoneyCents(i.referenceValue.referenceMxnCents, locale)}</span>
              ) : (
                <StatusBadge domain="price" value="pending" />
              ),
          },
        ]}
        rows={items}
        rowKey={(i) => i.inventoryItemId}
      />
      {/* Valor total de la bóveda del usuario: suma de los `priced`; los `pending` se excluyen y se indican aparte. */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-border pt-3">
        <div className="flex flex-col gap-1">
          <span className="eyebrow">{t('vaultTotal')}</span>
          {pendingCount > 0 && (
            <span className="font-mono text-[11px] text-accent">{t('vaultPending', { count: pendingCount })}</span>
          )}
        </div>
        <span className="tabular text-lg font-medium text-text">{formatMoneyCents(pricedTotalCents, locale)}</span>
      </div>
    </div>
  );
}

/**
 * Pestaña Actividad (GET /admin/users/:id/audit?scope=target): action / actorRole / fecha.
 * El `ip` SOLO se muestra si el backend lo envía (proyección super_admin); para vault_operator
 * no viene y la columna se omite (respeto estricto de la proyección por rol, §M6).
 */
function ActivityTab({ userId, locale }: { userId: string; locale: AppLocale }) {
  const t = useTranslations('admin.m6');
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['admin-user-audit', userId, page],
    queryFn: () => getAdminUserAudit(userId, { scope: 'target', page, pageSize: HISTORY_PAGE_SIZE }),
  });
  const rows = query.data?.data ?? [];
  const showIp = rows.some((r) => r.ip != null);
  const totalPages = query.data ? Math.max(1, Math.ceil(query.data.total / HISTORY_PAGE_SIZE)) : 1;
  const columns: Column<UserAuditEntryDTO>[] = [
    { key: 'action', header: t('table.action'), render: (r) => <span className="tabular">{r.action}</span> },
    { key: 'actorRole', header: t('table.actorRole'), render: (r) => <Badge tone="neutral">{r.actorRole}</Badge> },
    { key: 'createdAt', header: t('table.date'), render: (r) => formatDate(r.createdAt, locale) },
    ...(showIp
      ? [{ key: 'ip', header: t('table.ip'), render: (r: UserAuditEntryDTO) => <span className="tabular text-muted">{r.ip ?? '—'}</span> }]
      : []),
  ];
  return (
    <QueryState
      isLoading={query.isLoading}
      isError={query.isError}
      error={query.error}
      onRetry={() => query.refetch()}
    >
      {rows.length > 0 ? (
        <div className="flex flex-col gap-2">
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} />
          {(query.data?.total ?? 0) > HISTORY_PAGE_SIZE && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">
                {t('pageInfo', { page: query.data!.page, totalPages, total: query.data!.total })}
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
          )}
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-muted">{t('historyEmpty')}</p>
      )}
    </QueryState>
  );
}

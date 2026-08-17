'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getAdminDisputes, resolveDispute } from '@/lib/api';
import { useRole } from '@/lib/role';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Banner } from '@/components/ui/Banner';
import { CardImage } from '@/components/ui/CardImage';
import { GradedCertChip } from '@/components/ui/GradedCertChip';
import { CertNumberField } from '@/components/ui/CertNumberField';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { DisputeEvidenceContact } from '@/components/domain/DisputeEvidenceContact';
import type { DisputeDTO, ResolveDisputeInput } from '@/types/contract';

/** Estados terminales: la disputa ya no admite resolución. */
const RESOLVED = new Set(['resuelta_recompra', 'rechazada']);

export function M8View() {
  const t = useTranslations('admin.m8');
  const tm = useTranslations('admin');
  const tc = useTranslations('common');
  const { isSuperAdmin } = useRole();
  const qc = useQueryClient();
  const getError = useErrorMessage();
  const query = useQuery({ queryKey: ['admin-disputes'], queryFn: getAdminDisputes });
  // Selección por id (no por objeto): tras invalidar, `active` refleja el estado fresco.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const active: DisputeDTO | null =
    query.data?.find((d) => d.id === selectedId) ?? query.data?.[0] ?? null;

  // Confirmación previa (repurchase mueve dinero) + nota obligatoria para la bitácora.
  const [confirmTarget, setConfirmTarget] = useState<
    { disputeId: string; resolution: ResolveDisputeInput['resolution'] } | null
  >(null);
  const [note, setNote] = useState('');
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<
    { disputeId: string; kind: 'success' | 'error'; message: string } | null
  >(null);

  // Resolución (contrato §M8 · POST /admin/disputes/:id/resolve).
  const resolveMutation = useMutation({
    mutationFn: (vars: { disputeId: string; input: ResolveDisputeInput }) =>
      resolveDispute(vars.disputeId, vars.input),
    onSuccess: (_d, vars) => {
      closeConfirm();
      setFeedback({
        disputeId: vars.disputeId,
        kind: 'success',
        message:
          vars.input.resolution === 'repurchase' ? t('resolvedRepurchase') : t('resolvedReject'),
      });
      void qc.invalidateQueries({ queryKey: ['admin-disputes'] });
    },
    // El error se muestra DENTRO del modal (mensaje real del backend / copy del código).
    onError: (e) => setResolveError(getError(e)),
  });

  function openConfirm(disputeId: string, resolution: ResolveDisputeInput['resolution']) {
    setConfirmTarget({ disputeId, resolution });
    setNote('');
    setResolveError(null);
    setFeedback(null);
  }
  function closeConfirm() {
    setConfirmTarget(null);
    setNote('');
    setResolveError(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-h1 font-bold">{t('title')}</h1>

      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        <div className="grid gap-6 lg:grid-cols-[280px,1fr]">
          <div className="flex flex-col gap-2">
            {(query.data ?? []).map((d) => (
              <button
                key={d.id}
                onClick={() => setSelectedId(d.id)}
                className={
                  active?.id === d.id
                    ? 'rounded-lg border border-primary bg-surface-2 p-3 text-left'
                    : 'rounded-lg border border-border bg-surface p-3 text-left hover:bg-surface-2'
                }
              >
                <div className="flex items-center justify-between">
                  <span className="tabular text-sm font-medium">{d.id}</span>
                  <StatusBadge domain="dispute" value={d.status} />
                </div>
                <p className="mt-1 text-xs text-muted" lang="en">
                  {d.item?.card.name} · {d.item?.folio}
                </p>
              </button>
            ))}
          </div>

          {active && (
            <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-5">
              {/* v1.2: sin comparador de fotos; evidencia por correo a soporte (§7.11) */}
              <div className="flex flex-wrap items-start gap-4">
                {active.item && (
                  <div className="w-24 shrink-0">
                    {/* imagen de catálogo remota (v1.2) */}
                    <CardImage src={active.item.card.imageSmallUrl} alt={active.item.card.name} />
                  </div>
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <p className="text-sm font-semibold" lang="en">
                    {active.item?.card.name} · {active.item?.folio}
                  </p>
                  {/* Base de resolución de gradeada: empresa + grado + certificado */}
                  {active.item?.productType === 'graded' && (
                    <div className="flex flex-col gap-2">
                      <GradedCertChip
                        gradingCompany={active.item.gradingCompany}
                        gradeValue={active.item.gradeValue}
                        certNumber={active.item.certNumber}
                      />
                      {active.item.certNumber && (
                        <CertNumberField certNumber={active.item.certNumber} />
                      )}
                    </div>
                  )}
                  <p className="text-sm text-muted">{active.description}</p>
                </div>
              </div>

              {/* La evidencia del cliente llega por correo; el admin coteja el hilo */}
              <DisputeEvidenceContact email={active.evidenceContact} reference={active.id} />

              {feedback?.disputeId === active.id && (
                <Banner
                  variant={feedback.kind === 'success' ? 'success' : 'danger'}
                  role={feedback.kind === 'success' ? 'status' : 'alert'}
                  title={feedback.kind === 'error' ? tc('errorTitle') : undefined}
                >
                  {feedback.message}
                </Banner>
              )}

              {!RESOLVED.has(active.status) && (
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="accent"
                    disabled={!isSuperAdmin}
                    title={!isSuperAdmin ? tm('masked') : undefined}
                    onClick={() => openConfirm(active.id, 'repurchase')}
                  >
                    {t('resolveRepurchase')}
                  </Button>
                  <Button variant="secondary" onClick={() => openConfirm(active.id, 'reject')}>
                    {t('resolveReject')}
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted">{tm('moneyOutNote')}</p>
            </div>
          )}
        </div>
      </QueryState>

      {/* Confirmación con nota obligatoria (queda en bitácora / cierre de la disputa) */}
      <Modal
        open={!!confirmTarget}
        onClose={closeConfirm}
        title={confirmTarget?.resolution === 'repurchase' ? t('resolveRepurchase') : t('resolveReject')}
        footer={
          <>
            <Button variant="secondary" onClick={closeConfirm}>
              {tc('cancel')}
            </Button>
            <Button
              variant={confirmTarget?.resolution === 'repurchase' ? 'accent' : 'destructive'}
              disabled={note.trim() === ''}
              loading={resolveMutation.isPending}
              onClick={() =>
                confirmTarget &&
                resolveMutation.mutate({
                  disputeId: confirmTarget.disputeId,
                  input: { resolution: confirmTarget.resolution, note: note.trim() },
                })
              }
            >
              {t('resolveConfirm')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            {confirmTarget?.resolution === 'repurchase'
              ? t('repurchaseQuestion')
              : t('rejectQuestion')}
          </p>
          <Input
            label={t('noteLabel')}
            hint={t('noteHint')}
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {confirmTarget?.resolution === 'repurchase' && (
            <p className="text-xs text-muted">{tm('moneyOutNote')}</p>
          )}
          {resolveError && (
            <Banner variant="danger" role="alert" title={tc('errorTitle')}>
              {resolveError}
            </Banner>
          )}
        </div>
      </Modal>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  getAdminBuylist,
  receiveBuylistRequest,
  verifyBuylistRequest,
  decideBuylistItem,
  convertBuylistItemToInventory,
  revealBuylistClabe,
  paySpeiBuylist,
} from '@/lib/api';
import { useRole } from '@/lib/role';
import type { AppLocale } from '@/i18n/routing';
import type { SellItemDTO } from '@/types/contract';
import { formatMoneyCents } from '@/lib/format';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PipelineStepper } from '@/components/ui/PipelineStepper';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { FinishBadge } from '@/components/domain/FinishBadge';
import { useBuylistSteps } from '@/lib/pipelines';

/** Convierte pesos (texto) a centavos enteros; inválido/vacío → null. */
function pesosToCents(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed.replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** Estados terminales de item: ya no admiten decisión. */
const ITEM_TERMINAL = new Set(['pagada', 'convertida_inventario']);

export function M5View() {
  const t = useTranslations('admin.m5');
  const tm = useTranslations('admin');
  const tc = useTranslations('common');
  const te = useTranslations('error');
  const locale = useLocale() as AppLocale;
  const steps = useBuylistSteps();
  const { isSuperAdmin } = useRole();
  const qc = useQueryClient();
  const getError = useErrorMessage();
  const query = useQuery({ queryKey: ['admin-buylist'], queryFn: getAdminBuylist });

  // Feedback de la última acción, anclado a SU solicitud (éxito o mensaje real del backend).
  const [feedback, setFeedback] = useState<
    { requestId: string; kind: 'success' | 'error'; message: string } | null
  >(null);

  // CLABE revelada: SOLO estado local efímero de esta vista (nunca query-cache/estado
  // global) y solo bajo demanda — cada reveal queda auditado server-side (contrato §M5).
  const [revealed, setRevealed] = useState<{ requestId: string; clabe: string } | null>(null);

  function refresh() {
    void qc.invalidateQueries({ queryKey: ['admin-buylist'] });
  }
  function ok(requestId: string, message: string) {
    setFeedback({ requestId, kind: 'success', message });
    refresh();
  }
  function fail(requestId: string, error: unknown) {
    setFeedback({ requestId, kind: 'error', message: getError(error) });
  }

  // --- Recibir / Verificar (contrato POST /admin/buylist/:id/receive|verify) ---
  const receiveMutation = useMutation({
    mutationFn: (id: string) => receiveBuylistRequest(id),
    onSuccess: (_d, id) => ok(id, t('feedback.received')),
    onError: (e, id) => fail(id, e),
  });
  const verifyMutation = useMutation({
    mutationFn: (id: string) => verifyBuylistRequest(id),
    onSuccess: (_d, id) => ok(id, t('feedback.verified')),
    onError: (e, id) => fail(id, e),
  });

  // --- Decisión por carta (contrato PATCH /admin/buylist/items/:itemId/decision) ---
  const [adjustTarget, setAdjustTarget] = useState<{ requestId: string; item: SellItemDTO } | null>(null);
  const [adjustPrice, setAdjustPrice] = useState('');
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const adjustCents = pesosToCents(adjustPrice);

  const decisionMutation = useMutation({
    mutationFn: (vars: {
      requestId: string;
      itemId: string;
      decision: 'approve' | 'adjust' | 'reject';
      approvedPriceCents?: number;
    }) =>
      decideBuylistItem(vars.itemId, {
        decision: vars.decision,
        approvedPriceCents: vars.approvedPriceCents,
      }),
    onSuccess: (_d, vars) => {
      if (vars.decision === 'adjust') closeAdjust();
      ok(
        vars.requestId,
        vars.decision === 'approve'
          ? t('feedback.approved')
          : vars.decision === 'adjust'
            ? t('feedback.adjusted')
            : t('feedback.rejected'),
      );
    },
    onError: (e, vars) => {
      // El ajuste muestra el error DENTRO del modal (p. ej. 422 APPROVED_PRICE_CAP_EXCEEDED).
      if (vars.decision === 'adjust') setAdjustError(getError(e));
      else fail(vars.requestId, e);
    },
  });

  function openAdjust(requestId: string, item: SellItemDTO) {
    setAdjustTarget({ requestId, item });
    setAdjustPrice(item.quotedPriceCents != null ? String(item.quotedPriceCents / 100) : '');
    setAdjustError(null);
  }
  function closeAdjust() {
    setAdjustTarget(null);
    setAdjustPrice('');
    setAdjustError(null);
  }

  // --- Conversión a inventario (contrato POST .../convert-to-inventory) ---
  const convertMutation = useMutation({
    mutationFn: (vars: { requestId: string; itemId: string }) =>
      convertBuylistItemToInventory(vars.itemId),
    onSuccess: (d, vars) =>
      ok(
        vars.requestId,
        d.alreadyConverted
          ? t('feedback.alreadyConverted')
          : t('feedback.converted', { folio: d.folio ?? d.inventoryItemId ?? '' }),
      ),
    onError: (e, vars) => fail(vars.requestId, e),
  });

  // --- Reveal de CLABE (contrato GET .../reveal-clabe · super_admin, auditado) ---
  // Mutation (no query): la CLABE en claro no debe quedar en el cache de react-query.
  const revealMutation = useMutation({
    mutationFn: (id: string) => revealBuylistClabe(id),
    onSuccess: (d, id) => {
      setRevealed({ requestId: id, clabe: d.clabe });
      setFeedback(null);
    },
    onError: (e, id) => fail(id, e),
  });

  // --- Pago SPEI (contrato POST .../pay-spei · super_admin, money-out) ---
  const [payTarget, setPayTarget] = useState<string | null>(null);
  const [speiReference, setSpeiReference] = useState('');
  const [payError, setPayError] = useState<string | null>(null);
  const payMutation = useMutation({
    mutationFn: (vars: { requestId: string; speiReference: string }) =>
      paySpeiBuylist(vars.requestId, vars.speiReference),
    onSuccess: (_d, vars) => {
      closePay();
      // Higiene: al registrar el pago se descarta cualquier CLABE revelada en pantalla.
      setRevealed(null);
      ok(vars.requestId, t('feedback.paid'));
    },
    onError: (e) => setPayError(getError(e)),
  });
  function openPay(requestId: string) {
    setPayTarget(requestId);
    setSpeiReference('');
    setPayError(null);
  }
  function closePay() {
    setPayTarget(null);
    setSpeiReference('');
    setPayError(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-h1 font-bold">{t('title')}</h1>
      <p className="text-sm text-muted">{t('cherryPick')}</p>

      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {(query.data ?? []).map((req) => {
          const canPay =
            isSuperAdmin && (req.status === 'aprobada' || req.status === 'verificacion');
          return (
            <div key={req.id} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="tabular text-sm font-medium">{req.id}</span>
                  <StatusBadge domain="sellRequest" value={req.status} />
                  <span className="tabular text-xs text-muted">{req.userId}</span>
                </div>
                <span className="tabular text-sm">{formatMoneyCents(req.quotedTotalCents, locale)}</span>
              </div>

              <PipelineStepper steps={steps} current={req.status} />

              {/* Acciones a nivel solicitud: recepción física y verificación */}
              <div className="flex flex-wrap gap-2">
                {req.status === 'cotizada' && (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={receiveMutation.isPending && receiveMutation.variables === req.id}
                    onClick={() => receiveMutation.mutate(req.id)}
                  >
                    {t('receive')}
                  </Button>
                )}
                {req.status === 'recibida' && (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={verifyMutation.isPending && verifyMutation.variables === req.id}
                    onClick={() => verifyMutation.mutate(req.id)}
                  >
                    {t('verify')}
                  </Button>
                )}
              </div>

              <div className="flex flex-col divide-y divide-border">
                {req.items.map((it) => {
                  const decisionPending =
                    decisionMutation.isPending && decisionMutation.variables?.itemId === it.id;
                  const decidable = !ITEM_TERMINAL.has(it.itemStatus);
                  return (
                    <div key={it.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-sm font-medium" lang="en">
                          {it.card.name}
                        </span>
                        <FinishBadge finish={it.finish} productType={it.productType} />
                        <span className="tabular text-xs text-muted">
                          {formatMoneyCents(it.quotedPriceCents ?? 0, locale)}
                        </span>
                        {it.approvedPriceCents != null && (
                          <span className="tabular text-xs text-success">
                            {t('approvedLabel')}: {formatMoneyCents(it.approvedPriceCents, locale)}
                          </span>
                        )}
                        <StatusBadge domain="sellItem" value={it.itemStatus} />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {decidable && (
                          <>
                            <Button
                              size="sm"
                              variant="secondary"
                              loading={decisionPending && decisionMutation.variables?.decision === 'approve'}
                              onClick={() =>
                                decisionMutation.mutate({ requestId: req.id, itemId: it.id, decision: 'approve' })
                              }
                            >
                              {t('approve')}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => openAdjust(req.id, it)}>
                              {t('adjust')}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              loading={decisionPending && decisionMutation.variables?.decision === 'reject'}
                              onClick={() =>
                                decisionMutation.mutate({ requestId: req.id, itemId: it.id, decision: 'reject' })
                              }
                            >
                              {t('reject')}
                            </Button>
                          </>
                        )}
                        {it.itemStatus !== 'convertida_inventario' && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={it.itemStatus !== 'aprobada'}
                            title={it.itemStatus !== 'aprobada' ? t('convertNeedsApproval') : undefined}
                            loading={
                              convertMutation.isPending && convertMutation.variables?.itemId === it.id
                            }
                            onClick={() => convertMutation.mutate({ requestId: req.id, itemId: it.id })}
                          >
                            {t('convert')}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* CLABE revelada bajo demanda: solo esta solicitud, solo hasta ocultarla */}
              {revealed?.requestId === req.id && (
                <Banner variant="warning" role="status" title={t('clabeLabel')}>
                  <span className="tabular font-medium text-text">{revealed.clabe}</span>
                  <p className="text-xs">{t('clabeNotice')}</p>
                </Banner>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-muted">{tm('moneyOutNote')}</span>
                <div className="flex flex-wrap gap-2">
                  {revealed?.requestId === req.id ? (
                    <Button size="sm" variant="ghost" onClick={() => setRevealed(null)}>
                      {t('hideClabe')}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!isSuperAdmin}
                      title={!isSuperAdmin ? tm('masked') : undefined}
                      loading={revealMutation.isPending && revealMutation.variables === req.id}
                      onClick={() => revealMutation.mutate(req.id)}
                    >
                      {t('revealClabe')}
                    </Button>
                  )}
                  <Button
                    variant="accent"
                    size="sm"
                    disabled={!canPay || req.status === 'pagada'}
                    title={!isSuperAdmin ? tm('masked') : undefined}
                    onClick={() => openPay(req.id)}
                  >
                    {t('paySpei')}
                  </Button>
                </div>
              </div>

              {feedback?.requestId === req.id && (
                <Banner
                  variant={feedback.kind === 'success' ? 'success' : 'danger'}
                  role={feedback.kind === 'success' ? 'status' : 'alert'}
                  title={feedback.kind === 'error' ? tc('errorTitle') : undefined}
                >
                  {feedback.message}
                </Banner>
              )}
              {!isSuperAdmin && <Banner variant="warning">{te('MONEY_OUT_FORBIDDEN')}</Banner>}
            </div>
          );
        })}
      </QueryState>

      {/* Modal de ajuste de precio por carta (decision=adjust + approvedPriceCents) */}
      <Modal
        open={!!adjustTarget}
        onClose={closeAdjust}
        title={t('adjustTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={closeAdjust}>
              {tc('cancel')}
            </Button>
            <Button
              disabled={adjustCents == null}
              loading={decisionMutation.isPending && decisionMutation.variables?.decision === 'adjust'}
              onClick={() =>
                adjustTarget &&
                adjustCents != null &&
                decisionMutation.mutate({
                  requestId: adjustTarget.requestId,
                  itemId: adjustTarget.item.id,
                  decision: 'adjust',
                  approvedPriceCents: adjustCents,
                })
              }
            >
              {t('adjustConfirm')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {adjustTarget && (
            <p className="text-sm text-muted">
              <span lang="en" className="font-medium text-text">{adjustTarget.item.card.name}</span>
              {' · '}
              {t('quoted')}:{' '}
              <span className="tabular">
                {formatMoneyCents(adjustTarget.item.quotedPriceCents ?? 0, locale)}
              </span>
            </p>
          )}
          <Input
            label={t('adjustPriceLabel')}
            type="text"
            inputMode="decimal"
            prefix="MX$"
            value={adjustPrice}
            onChange={(e) => setAdjustPrice(e.target.value)}
          />
          {adjustCents != null && (
            <p className="text-xs text-muted">= {formatMoneyCents(adjustCents, locale)}</p>
          )}
          <p className="text-xs text-muted">{t('adjustHint')}</p>
          {adjustError && (
            <Banner variant="danger" role="alert" title={tc('errorTitle')}>
              {adjustError}
            </Banner>
          )}
        </div>
      </Modal>

      {/* Modal de pago SPEI manual (referencia obligatoria; queda en bitácora) */}
      <Modal
        open={!!payTarget}
        onClose={closePay}
        title={t('paySpeiTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={closePay}>
              {tc('cancel')}
            </Button>
            <Button
              variant="accent"
              disabled={speiReference.trim() === ''}
              loading={payMutation.isPending}
              onClick={() =>
                payTarget && payMutation.mutate({ requestId: payTarget, speiReference: speiReference.trim() })
              }
            >
              {t('paySpeiConfirm')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {payTarget && (
            <p className="text-sm text-muted">
              <span className="tabular font-medium text-text">{payTarget}</span>
            </p>
          )}
          <Input
            label={t('speiReferenceLabel')}
            type="text"
            value={speiReference}
            onChange={(e) => setSpeiReference(e.target.value)}
          />
          <p className="text-xs text-muted">{tm('moneyOutNote')}</p>
          {payError && (
            <Banner variant="danger" role="alert" title={tc('errorTitle')}>
              {payError}
            </Banner>
          )}
        </div>
      </Modal>
    </div>
  );
}

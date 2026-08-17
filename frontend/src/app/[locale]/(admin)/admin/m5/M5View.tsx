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
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import type { AppLocale } from '@/i18n/routing';
import type { SellItemDTO, SellRequestStatus } from '@/types/contract';
import { formatMoneyCents } from '@/lib/format';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PipelineStepper } from '@/components/ui/PipelineStepper';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { CardImage } from '@/components/ui/CardImage';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { EmptyState } from '@/components/ui/EmptyState';
import { FinishBadge } from '@/components/domain/FinishBadge';
import { useBuylistSteps } from '@/lib/pipelines';

/**
 * Pestañas por ETAPA de la solicitud (G3): en vez de una pila plana con las 7 acciones
 * siempre visibles, se agrupa por `status` para que el operador vea solo la cola de su
 * etapa. Cada solicitud aparece en la pestaña de su `status`.
 */
type M5Tab = 'por_recibir' | 'verificando' | 'por_pagar' | 'cerradas';
const M5_TABS: { key: M5Tab; statuses: SellRequestStatus[] }[] = [
  { key: 'por_recibir', statuses: ['cotizada'] },
  { key: 'verificando', statuses: ['recibida', 'verificacion'] },
  { key: 'por_pagar', statuses: ['aprobada'] },
  { key: 'cerradas', statuses: ['pagada', 'rechazada', 'abandonada'] },
];

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

  // --- Pestañas por etapa + buscador (folio/usuario) ---
  const [tab, setTab] = useState<M5Tab | null>(null);
  const [search, setSearch] = useState('');
  const all = query.data ?? [];
  const searchTerm = search.trim().toLowerCase();
  // Buscador global por folio o usuario (usa la clave i18n `admin.searchGlobal`).
  const filtered =
    searchTerm === ''
      ? all
      : all.filter(
          (r) =>
            r.id.toLowerCase().includes(searchTerm) || r.userId.toLowerCase().includes(searchTerm),
        );
  const counts = Object.fromEntries(
    M5_TABS.map((tb) => [tb.key, filtered.filter((r) => tb.statuses.includes(r.status)).length]),
  ) as Record<M5Tab, number>;
  // Etapa activa: la elegida por el operador o, por defecto, la primera con solicitudes.
  const firstNonEmpty = M5_TABS.find((tb) => counts[tb.key] > 0)?.key ?? M5_TABS[0].key;
  const activeTab: M5Tab = tab ?? firstNonEmpty;
  const activeStatuses = M5_TABS.find((tb) => tb.key === activeTab)!.statuses;
  const visible = filtered.filter((r) => activeStatuses.includes(r.status));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-h1 font-bold">{t('title')}</h1>
      <p className="text-sm text-muted">{t('cherryPick')}</p>

      {/* Buscador por folio/usuario (clave i18n admin.searchGlobal) */}
      <div className="max-w-sm">
        <Input
          label={t('searchLabel')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tm('searchGlobal')}
        />
      </div>

      {/* Pestañas por etapa: cada una muestra el conteo de solicitudes en esa etapa. */}
      <div role="tablist" aria-label={t('title')} className="flex flex-wrap gap-1 border-b border-border">
        {M5_TABS.map((tb) => (
          <button
            key={tb.key}
            role="tab"
            type="button"
            aria-selected={activeTab === tb.key}
            onClick={() => setTab(tb.key)}
            className={cn(
              '-mb-px flex items-center gap-2 px-3 py-2 text-sm font-medium focus-visible:shadow-focus focus-visible:outline-none',
              activeTab === tb.key ? 'border-b-2 border-primary text-text' : 'text-muted hover:text-text',
            )}
          >
            {t(`tabs.${tb.key}`)}
            <span className="tabular text-xs text-muted">{counts[tb.key]}</span>
          </button>
        ))}
      </div>

      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {query.data &&
          (visible.length === 0 ? (
            <EmptyState title={searchTerm !== '' ? t('emptySearch') : t('emptyTab')} />
          ) : (
            visible.map((req) => {
          const canPay =
            isSuperAdmin && (req.status === 'aprobada' || req.status === 'verificacion');
          // Solo se muestran las acciones de la ETAPA actual de la solicitud:
          //  - decidir carta (aprobar/ajustar/rechazar) solo tras recibir/verificar;
          //  - revelar CLABE / pagar SPEI solo en verificación o por-pagar.
          const canDecide = req.status === 'recibida' || req.status === 'verificacion';
          const showMoneyOut = req.status === 'verificacion' || req.status === 'aprobada';
          return (
            <div key={req.id} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular text-sm font-medium">{req.id}</span>
                  <StatusBadge domain="sellRequest" value={req.status} />
                  {/* Vendedor: la cola admin no trae el nombre resuelto; se muestra el
                      userId como ENLACE a su ficha 360° en M6 (?user=<id>, sin endpoint nuevo). */}
                  <Link
                    href={{ pathname: '/admin/m6', query: { user: req.userId } }}
                    aria-label={t('sellerLink', { id: req.userId })}
                    className="tabular text-xs text-muted underline-offset-2 hover:text-text hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                  >
                    {t('seller')}: {req.userId}
                  </Link>
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
                        {/* Imagen de catálogo por ítem: único referente visual para verificar
                            la carta física contra la que llegó a la bóveda. */}
                        <CardImage src={it.card.imageSmallUrl} alt={it.card.name} className="w-10 shrink-0" />
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
                        {canDecide && decidable && (
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

              {/* Acciones de dinero saliente: solo en la etapa de verificación / por-pagar. */}
              {showMoneyOut && (
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
              )}

              {req.status === 'pagada' && (
                <p className="text-xs text-success">{t('paidNote')}</p>
              )}

              {feedback?.requestId === req.id && (
                <Banner
                  variant={feedback.kind === 'success' ? 'success' : 'danger'}
                  role={feedback.kind === 'success' ? 'status' : 'alert'}
                  title={feedback.kind === 'error' ? tc('errorTitle') : undefined}
                >
                  {feedback.message}
                </Banner>
              )}
              {showMoneyOut && !isSuperAdmin && (
                <Banner variant="warning">{te('MONEY_OUT_FORBIDDEN')}</Banner>
              )}
            </div>
          );
            })
          ))}
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

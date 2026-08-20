'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  getAdminBuylist,
  getAdminRejectedBuylistItems,
  receiveBuylistRequest,
  verifyBuylistRequest,
  rejectBuylistRequest,
  decideBuylistItem,
  convertBuylistItemToInventory,
  revealBuylistClabe,
  paySpeiBuylist,
} from '@/lib/api';
import { useRole } from '@/lib/role';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import type { AppLocale } from '@/i18n/routing';
import type { AdminBuylistDTO, SellItemDTO, SellRequestStatus } from '@/types/contract';
import { formatMoneyCents, formatDate } from '@/lib/format';
import { Badge } from '@/components/ui/Badge';
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
 * etapa. Cada solicitud aparece en la pestaña de su `status`. La pestaña «Rechazadas»
 * (v1.18) es TRANSVERSAL: no filtra solicitudes, consume su propio endpoint paginado.
 */
// Pestañas OPERATIVAS (etapas vivas): siguen su fetch client-side sobre la página actual. Las
// pestañas TRANSVERSALES «Cerradas» (v1.25) y «Rechazadas» (v1.18) son server-side paginadas.
type M5OpTab = 'por_recibir' | 'verificando' | 'por_pagar';
type M5TabAll = M5OpTab | 'cerradas' | 'rechazadas';
const M5_OP_TABS: { key: M5OpTab; statuses: SellRequestStatus[] }[] = [
  { key: 'por_recibir', statuses: ['cotizada'] },
  { key: 'verificando', statuses: ['recibida', 'verificacion'] },
  { key: 'por_pagar', statuses: ['aprobada'] },
];
/**
 * Estados terminales que agrupa la pestaña «Cerradas» (v1.25-buylist-orders-pagination). Se pide
 * server-side como `status=pagada,rechazada,abandonada` (CSV) en UNA llamada paginada.
 */
const M5_CLOSED_STATUSES: SellRequestStatus[] = ['pagada', 'rechazada', 'abandonada'];
const M5_CLOSED_STATUS_CSV = M5_CLOSED_STATUSES.join(',');
const M5_PAGE_SIZE = 25;

/** Límites del motivo de rechazo (contrato §M5: 3–500 chars; 400 si no cumple). */
const REJECT_REASON_MIN = 3;
const REJECT_REASON_MAX = 500;

/**
 * Fase del ítem rechazado derivada de `now` vs los plazos del SERVER (contrato §M5: la
 * fase no se persiste ni se expone como campo; la deriva el front). Legacy sin fechas
 * (rechazos pre-M-22) → 'unknown'.
 */
type RejectPhase = 'return' | 'abandon' | 'expired' | 'unknown';
function rejectPhase(
  returnDeadlineAt: string | null,
  abandonDeadlineAt: string | null,
  now: number = Date.now(),
): RejectPhase {
  if (!returnDeadlineAt || !abandonDeadlineAt) return 'unknown';
  if (now <= new Date(returnDeadlineAt).getTime()) return 'return';
  if (now <= new Date(abandonDeadlineAt).getTime()) return 'abandon';
  return 'expired';
}

const PHASE_TONE: Record<RejectPhase, 'warning' | 'danger' | 'neutral'> = {
  return: 'warning',
  abandon: 'danger',
  expired: 'neutral',
  unknown: 'neutral',
};

/** Identidad visible del vendedor: nombre + correo (v1.18); cae al UUID si falta el join. */
function sellerLabel(req: Pick<AdminBuylistDTO, 'userId' | 'seller'>): string {
  return req.seller ? `${req.seller.name} · ${req.seller.email}` : req.userId;
}

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

/**
 * Estados terminales de la SOLICITUD (pestaña «Cerradas» = M5_CLOSED_STATUSES): ya no admiten
 * el cierre explícito «Rechazar solicitud» (contrato §M5 · v1.24: idempotente si ya `rechazada`,
 * 409 si `pagada`/`abandonada`). La UI simplemente no ofrece el botón sobre estos.
 */
const REQUEST_TERMINAL = new Set<SellRequestStatus>(['pagada', 'rechazada', 'abandonada']);

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
  // Operativas: fetch de la página actual del server (las etapas vivas siguen filtrando en memoria).
  const query = useQuery({ queryKey: ['admin-buylist'], queryFn: () => getAdminBuylist() });

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

  // Rechazo con motivo obligatorio (v1.18): mini-diálogo antes de enviar la decisión.
  const [rejectTarget, setRejectTarget] = useState<{ requestId: string; item: SellItemDTO } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState<string | null>(null);
  const rejectReasonTrimmed = rejectReason.trim();
  const rejectReasonValid =
    rejectReasonTrimmed.length >= REJECT_REASON_MIN && rejectReasonTrimmed.length <= REJECT_REASON_MAX;

  const decisionMutation = useMutation({
    mutationFn: (vars: {
      requestId: string;
      itemId: string;
      decision: 'approve' | 'adjust' | 'reject';
      approvedPriceCents?: number;
      reason?: string;
    }) =>
      decideBuylistItem(
        vars.itemId,
        vars.decision === 'reject'
          ? { decision: 'reject', reason: vars.reason }
          : { decision: vars.decision, approvedPriceCents: vars.approvedPriceCents },
      ),
    onSuccess: (_d, vars) => {
      if (vars.decision === 'adjust') closeAdjust();
      if (vars.decision === 'reject') {
        closeReject();
        // La carta rechazada aparece en la pestaña transversal «Rechazadas».
        void qc.invalidateQueries({ queryKey: ['admin-buylist-rejected'] });
      }
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
      // El ajuste/rechazo muestran el error DENTRO de su modal (p. ej. 422
      // APPROVED_PRICE_CAP_EXCEEDED o el 400 VALIDATION_ERROR del motivo).
      if (vars.decision === 'adjust') setAdjustError(getError(e));
      else if (vars.decision === 'reject') setRejectError(getError(e));
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

  function openReject(requestId: string, item: SellItemDTO) {
    setRejectTarget({ requestId, item });
    setRejectReason('');
    setRejectError(null);
  }
  function closeReject() {
    setRejectTarget(null);
    setRejectReason('');
    setRejectError(null);
  }

  // --- Cierre explícito de la solicitud (contrato §M5 · POST /admin/buylist/:id/reject, v1.24) ---
  // Cierra a `rechazada` una solicitud atorada cuyos ítems YA están todos rechazados (bug P-4).
  // Confirmación destructiva en modal (DESIGN_SYSTEM §7.6: «rechazar buylist»); `reason` opcional.
  const [rejectRequestTarget, setRejectRequestTarget] = useState<AdminBuylistDTO | null>(null);
  const [rejectRequestReason, setRejectRequestReason] = useState('');
  const [rejectRequestError, setRejectRequestError] = useState<string | null>(null);
  const rejectRequestMutation = useMutation({
    mutationFn: (vars: { requestId: string; reason?: string }) =>
      rejectBuylistRequest(vars.requestId, { reason: vars.reason }),
    onSuccess: (_d, vars) => {
      closeRejectRequest();
      // Tras cerrar, la solicitud cae en la pestaña «Cerradas» (status `rechazada`).
      ok(vars.requestId, t('feedback.requestRejected'));
    },
    // El 422 REQUEST_HAS_NON_REJECTED_ITEMS (quedan ítems vivos) se muestra DENTRO del modal.
    onError: (e) => setRejectRequestError(getError(e)),
  });
  function openRejectRequest(req: AdminBuylistDTO) {
    setRejectRequestTarget(req);
    setRejectRequestReason('');
    setRejectRequestError(null);
  }
  function closeRejectRequest() {
    setRejectRequestTarget(null);
    setRejectRequestReason('');
    setRejectRequestError(null);
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

  // --- Pestañas por etapa + buscador (folio/vendedor) ---
  const [tab, setTab] = useState<M5TabAll | null>(null);
  const [search, setSearch] = useState('');
  const all = query.data?.data ?? [];
  const searchTerm = search.trim().toLowerCase();
  // Buscador global por folio o vendedor —id, nombre o correo— (clave i18n `admin.searchGlobal`).
  // En las pestañas OPERATIVAS filtra client-side; en «Cerradas» alimenta el `q` server-side.
  const filtered =
    searchTerm === ''
      ? all
      : all.filter(
          (r) =>
            r.id.toLowerCase().includes(searchTerm) ||
            r.userId.toLowerCase().includes(searchTerm) ||
            (r.seller?.name.toLowerCase().includes(searchTerm) ?? false) ||
            (r.seller?.email.toLowerCase().includes(searchTerm) ?? false),
        );
  const counts = Object.fromEntries(
    M5_OP_TABS.map((tb) => [tb.key, filtered.filter((r) => tb.statuses.includes(r.status)).length]),
  ) as Record<M5OpTab, number>;
  // Etapa activa: la elegida por el operador o, por defecto, la primera con solicitudes.
  const firstNonEmpty = M5_OP_TABS.find((tb) => counts[tb.key] > 0)?.key ?? M5_OP_TABS[0].key;
  const activeTab: M5TabAll = tab ?? firstNonEmpty;
  const activeStatuses = M5_OP_TABS.find((tb) => tb.key === activeTab)?.statuses ?? [];
  const visible = filtered.filter((r) => activeStatuses.includes(r.status));

  // --- Pestaña «Cerradas» (v1.25-buylist-orders-pagination · GET /admin/buylist server-side) ---
  // Query dedicada y paginada (mismo patrón que «Rechazadas»): pide `status` CSV + filtros
  // (fecha/monto) + `q` (del buscador global). Solo se pide al abrir la pestaña.
  const [closedPage, setClosedPage] = useState(1);
  const [closedFrom, setClosedFrom] = useState('');
  const [closedTo, setClosedTo] = useState('');
  const [closedMinPesos, setClosedMinPesos] = useState('');
  const [closedMaxPesos, setClosedMaxPesos] = useState('');
  // Debounce (P-5): el filtrado client-side de las pestañas OPERATIVAS sigue usando el `search`
  // inmediato (arriba), pero lo que alimenta la RED de «Cerradas» (buscador global + montos) sólo
  // entra por su VALOR DEBOUNCED, para no disparar un fetch por pulsación. Las fechas no se debouncean.
  const debouncedClosedSearch = useDebouncedValue(search);
  const debouncedClosedMinPesos = useDebouncedValue(closedMinPesos);
  const debouncedClosedMaxPesos = useDebouncedValue(closedMaxPesos);
  const closedMinCents = pesosToCents(debouncedClosedMinPesos);
  const closedMaxCents = pesosToCents(debouncedClosedMaxPesos);
  // El buscador global alimenta `q` server-side cuando la pestaña activa es «Cerradas».
  const closedQ = debouncedClosedSearch.trim() === '' ? undefined : debouncedClosedSearch.trim();
  const closedFilters = {
    status: M5_CLOSED_STATUS_CSV,
    page: closedPage,
    pageSize: M5_PAGE_SIZE,
    q: closedQ,
    from: closedFrom || undefined,
    to: closedTo || undefined,
    minCents: closedMinCents ?? undefined,
    maxCents: closedMaxCents ?? undefined,
  };
  const closedQuery = useQuery({
    queryKey: [
      'admin-buylist-closed',
      closedPage,
      closedQ ?? '',
      closedFrom,
      closedTo,
      closedMinCents ?? '',
      closedMaxCents ?? '',
    ],
    queryFn: () => getAdminBuylist(closedFilters),
    enabled: activeTab === 'cerradas',
  });
  const closedTotalPages =
    closedQuery.data && closedQuery.data.pageSize > 0
      ? Math.max(1, Math.ceil(closedQuery.data.total / closedQuery.data.pageSize))
      : 1;
  // Cualquier cambio de filtro vuelve a la página 1 (evita quedar en una página inexistente).
  function resetClosedPage() {
    setClosedPage(1);
  }

  // --- Pestaña «Rechazadas» (contrato §M5 · GET /admin/buylist/rejected-items) ---
  // Query aparte (transversal a solicitudes), paginada server-side; solo se pide al abrirla.
  const [rejectedPage, setRejectedPage] = useState(1);
  const rejectedQuery = useQuery({
    queryKey: ['admin-buylist-rejected', rejectedPage],
    queryFn: () => getAdminRejectedBuylistItems({ page: rejectedPage }),
    enabled: activeTab === 'rechazadas',
  });
  const rejectedTotalPages =
    rejectedQuery.data && rejectedQuery.data.pageSize > 0
      ? Math.max(1, Math.ceil(rejectedQuery.data.total / rejectedQuery.data.pageSize))
      : 1;

  /** Salta desde una fila rechazada a su solicitud (folio al buscador, etapa automática). */
  function jumpToRequest(sellRequestId: string) {
    setSearch(sellRequestId);
    setTab(null);
  }

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

      {/* Pestañas por etapa: cada operativa muestra el conteo de solicitudes en esa etapa.
          «Cerradas» (v1.25) y «Rechazadas» (v1.18) son transversales, server-side paginadas; su
          conteo es el `total` del query dedicado (solo tras cargar). */}
      <div role="tablist" aria-label={t('title')} className="flex flex-wrap gap-1 border-b border-border">
        {M5_OP_TABS.map((tb) => (
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
        <button
          role="tab"
          type="button"
          aria-selected={activeTab === 'cerradas'}
          onClick={() => setTab('cerradas')}
          className={cn(
            '-mb-px flex items-center gap-2 px-3 py-2 text-sm font-medium focus-visible:shadow-focus focus-visible:outline-none',
            activeTab === 'cerradas' ? 'border-b-2 border-primary text-text' : 'text-muted hover:text-text',
          )}
        >
          {t('tabs.cerradas')}
          {closedQuery.data && (
            <span className="tabular text-xs text-muted">{closedQuery.data.total}</span>
          )}
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={activeTab === 'rechazadas'}
          onClick={() => setTab('rechazadas')}
          className={cn(
            '-mb-px flex items-center gap-2 px-3 py-2 text-sm font-medium focus-visible:shadow-focus focus-visible:outline-none',
            activeTab === 'rechazadas' ? 'border-b-2 border-primary text-text' : 'text-muted hover:text-text',
          )}
        >
          {t('tabs.rechazadas')}
          {rejectedQuery.data && (
            <span className="tabular text-xs text-muted">{rejectedQuery.data.total}</span>
          )}
        </button>
      </div>

      {activeTab === 'rechazadas' ? (
        <QueryState
          isLoading={rejectedQuery.isLoading}
          isError={rejectedQuery.isError}
          error={rejectedQuery.error}
          onRetry={() => rejectedQuery.refetch()}
        >
          {rejectedQuery.data && (
            <div className="flex flex-col gap-4">
              {/* PROJECT criterio 16 / contrato §M5: una carta rechazada (no-NM) JAMÁS se
                  convierte a inventario vendible → esta pestaña no ofrece esa acción. */}
              <p className="text-xs text-muted">{t('rejected.intro')}</p>
              {rejectedQuery.data.data.length === 0 ? (
                <EmptyState title={t('rejected.empty')} />
              ) : (
                <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface px-4">
                  {rejectedQuery.data.data.map((row) => {
                    const phase = rejectPhase(row.returnDeadlineAt, row.abandonDeadlineAt);
                    return (
                      <div key={row.id} className="flex flex-col gap-2 py-4">
                        <div className="flex flex-wrap items-center gap-3">
                          <CardImage src={row.card.imageSmallUrl} alt={row.card.name} className="w-10 shrink-0" />
                          <span className="text-sm font-medium" lang="en">
                            {row.card.name}
                          </span>
                          <span className="text-xs text-muted" lang="en">
                            {row.card.setName} · #{row.card.number}
                          </span>
                          <FinishBadge finish={row.finish} productType={row.productType} />
                          {/* La cotización original NO se paga: fuera del total (tachada). */}
                          {row.quotedPriceCents != null && (
                            <span className="tabular text-xs text-muted line-through">
                              {formatMoneyCents(row.quotedPriceCents, locale)}
                            </span>
                          )}
                          <Badge tone={PHASE_TONE[phase]} shape="outline">
                            {t(`rejected.phase.${phase}`)}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                          {/* Vendedor legible (nombre + correo); UUID relegado al tooltip. */}
                          <Link
                            href={{ pathname: '/admin/m6', query: { user: row.seller?.id ?? '' } }}
                            title={row.seller?.id}
                            aria-label={t('sellerLink', { id: row.seller?.name ?? row.seller?.id ?? '' })}
                            className="underline-offset-2 hover:text-text hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                          >
                            {t('seller')}: {row.seller ? `${row.seller.name} · ${row.seller.email}` : '—'}
                          </Link>
                          <span>
                            {t('rejected.rejectedAtLabel')}:{' '}
                            <span className="tabular">{row.rejectedAt ? formatDate(row.rejectedAt, locale) : '—'}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => jumpToRequest(row.sellRequestId)}
                            className="tabular underline-offset-2 hover:text-text hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                          >
                            {t('rejected.viewRequest', { id: row.sellRequestId })}
                          </button>
                        </div>
                        {row.reason && (
                          <p className="text-sm">
                            <span className="text-muted">{t('rejected.reasonLabel')}:</span> {row.reason}
                          </p>
                        )}
                        {/* Plazos del server (7d devolución a costo del usuario / 30d abandono). */}
                        {row.returnDeadlineAt && row.abandonDeadlineAt ? (
                          <p className="text-xs text-muted">
                            {t('rejected.returnUntil', { date: formatDate(row.returnDeadlineAt, locale) })}
                            {' · '}
                            {t('rejected.abandonAt', { date: formatDate(row.abandonDeadlineAt, locale) })}
                          </p>
                        ) : (
                          <p className="text-xs text-muted">{t('rejected.noDeadlines')}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {/* Paginación simple server-side (page/pageSize/total del contrato). */}
              {rejectedTotalPages > 1 && (
                <div className="flex items-center gap-3">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={rejectedPage <= 1}
                    onClick={() => setRejectedPage((p) => Math.max(1, p - 1))}
                  >
                    {t('rejected.prev')}
                  </Button>
                  <span className="tabular text-xs text-muted">
                    {t('rejected.pageInfo', { page: rejectedQuery.data.page, totalPages: rejectedTotalPages })}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={rejectedPage >= rejectedTotalPages}
                    onClick={() => setRejectedPage((p) => p + 1)}
                  >
                    {t('rejected.next')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </QueryState>
      ) : activeTab === 'cerradas' ? (
        <div className="flex flex-col gap-4">
          {/* Filtros server-side de «Cerradas» (v1.25). El buscador global de arriba alimenta `q`. */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <Input
                label={t('filters.dateFrom')}
                type="date"
                value={closedFrom}
                onChange={(e) => {
                  setClosedFrom(e.target.value);
                  resetClosedPage();
                }}
              />
            </div>
            <div className="w-40">
              <Input
                label={t('filters.dateTo')}
                type="date"
                value={closedTo}
                onChange={(e) => {
                  setClosedTo(e.target.value);
                  resetClosedPage();
                }}
              />
            </div>
            <div className="w-32">
              <Input
                label={t('filters.minAmount')}
                type="text"
                inputMode="decimal"
                prefix="MX$"
                value={closedMinPesos}
                onChange={(e) => {
                  setClosedMinPesos(e.target.value);
                  resetClosedPage();
                }}
              />
            </div>
            <div className="w-32">
              <Input
                label={t('filters.maxAmount')}
                type="text"
                inputMode="decimal"
                prefix="MX$"
                value={closedMaxPesos}
                onChange={(e) => {
                  setClosedMaxPesos(e.target.value);
                  resetClosedPage();
                }}
              />
            </div>
          </div>

          <QueryState
            isLoading={closedQuery.isLoading}
            isError={closedQuery.isError}
            error={closedQuery.error}
            onRetry={() => closedQuery.refetch()}
          >
            {closedQuery.data &&
              (closedQuery.data.data.length === 0 ? (
                <EmptyState title={t('closed.empty')} />
              ) : (
                <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface px-4">
                  {closedQuery.data.data.map((req) => (
                    <div key={req.id} className="flex flex-col gap-2 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="tabular text-sm font-medium">{req.id}</span>
                          <StatusBadge domain="sellRequest" value={req.status} />
                          <Link
                            href={{ pathname: '/admin/m6', query: { user: req.userId } }}
                            title={req.userId}
                            aria-label={t('sellerLink', { id: req.seller?.name ?? req.userId })}
                            className="text-xs text-muted underline-offset-2 hover:text-text hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                          >
                            {t('seller')}: {sellerLabel(req)}
                          </Link>
                          <span className="tabular text-xs text-muted">
                            {t('created')}: {formatDate(req.createdAt, locale)}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="tabular text-sm">
                            {t('quoted')}: {formatMoneyCents(req.quotedTotalCents, locale)}
                          </span>
                          {req.approvedTotalCents != null && (
                            <span className="tabular text-sm text-success">
                              {t('approvedTotal')}: {formatMoneyCents(req.approvedTotalCents, locale)}
                            </span>
                          )}
                        </div>
                      </div>
                      {/* Resumen read-only de los ítems (etapa terminal: sin acciones). */}
                      <div className="flex flex-col gap-1">
                        {req.items.map((it) => (
                          <div key={it.id} className="flex flex-wrap items-center gap-2 text-xs text-muted">
                            <span className="font-medium text-text" lang="en">
                              {it.card.name}
                            </span>
                            <FinishBadge finish={it.finish} productType={it.productType} />
                            <StatusBadge domain="sellItem" value={it.itemStatus} />
                            <span
                              className={cn(
                                'tabular',
                                it.itemStatus === 'rechazada' && 'line-through',
                              )}
                            >
                              {formatMoneyCents(it.quotedPriceCents ?? 0, locale)}
                            </span>
                            {it.approvedPriceCents != null && (
                              <span className="tabular text-success">
                                {t('approvedLabel')}: {formatMoneyCents(it.approvedPriceCents, locale)}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            {/* Paginación server-side (page/pageSize/total del contrato v1.25). */}
            {closedQuery.data && closedTotalPages > 1 && (
              <div className="mt-4 flex items-center gap-3">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={closedPage <= 1}
                  onClick={() => setClosedPage((p) => Math.max(1, p - 1))}
                >
                  {t('closed.prev')}
                </Button>
                <span className="tabular text-xs text-muted">
                  {t('closed.pageInfo', { page: closedQuery.data.page, totalPages: closedTotalPages })}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={closedPage >= closedTotalPages}
                  onClick={() => setClosedPage((p) => p + 1)}
                >
                  {t('closed.next')}
                </Button>
              </div>
            )}
          </QueryState>
        </div>
      ) : (
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
          // «Rechazar solicitud» (v1.24): cierre explícito del hueco de estado (bug P-4). El
          // endpoint SÓLO cierra si TODOS los ítems ya están `rechazada`; para no ofrecer un
          // botón que siempre daría 422, se muestra exactamente en esa precondición y nunca
          // sobre una solicitud ya terminal (`pagada`/`rechazada`/`abandonada`).
          const allItemsRejected =
            req.items.length > 0 && req.items.every((it) => it.itemStatus === 'rechazada');
          const canRejectRequest = !REQUEST_TERMINAL.has(req.status) && allItemsRejected;
          return (
            <div key={req.id} className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular text-sm font-medium">{req.id}</span>
                  <StatusBadge domain="sellRequest" value={req.status} />
                  {/* Vendedor legible (v1.18: seller.name + seller.email del server); el UUID
                      queda en el tooltip. Sigue enlazando a su ficha 360° en M6 (?user=<id>). */}
                  <Link
                    href={{ pathname: '/admin/m6', query: { user: req.userId } }}
                    title={req.userId}
                    aria-label={t('sellerLink', { id: req.seller?.name ?? req.userId })}
                    className="text-xs text-muted underline-offset-2 hover:text-text hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                  >
                    {t('seller')}: {sellerLabel(req)}
                  </Link>
                  {/* Fecha de creación (orden createdAt desc lo aplica el server; no se re-ordena). */}
                  <span className="tabular text-xs text-muted">
                    {t('created')}: {formatDate(req.createdAt, locale)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="tabular text-sm">
                    {t('quoted')}: {formatMoneyCents(req.quotedTotalCents, locale)}
                  </span>
                  {/* Total aprobado RECOMPUTADO por el backend (excluye rechazadas, SEC-A1:
                      la UI nunca suma dinero por su cuenta). */}
                  {req.approvedTotalCents != null && (
                    <span className="tabular text-sm text-success">
                      {t('approvedTotal')}: {formatMoneyCents(req.approvedTotalCents, locale)}
                    </span>
                  )}
                </div>
              </div>

              <PipelineStepper steps={steps} current={req.status} />

              {/* Acciones a nivel solicitud: recepción física, verificación y cierre explícito */}
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
                {/* Cierre explícito «Rechazar solicitud» (v1.24 · POST .../reject): sólo cuando
                    TODOS los ítems ya están rechazados y la solicitud NO es terminal. Resuelve la
                    solicitud atorada en «Verificando» del caso reportado por el PO (bug P-4). */}
                {canRejectRequest && (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => openRejectRequest(req)}
                  >
                    {t('rejectRequest')}
                  </Button>
                )}
              </div>

              <div className="flex flex-col divide-y divide-border">
                {req.items.map((it) => {
                  const decisionPending =
                    decisionMutation.isPending && decisionMutation.variables?.itemId === it.id;
                  const decidable = !ITEM_TERMINAL.has(it.itemStatus);
                  const isRejected = it.itemStatus === 'rechazada';
                  return (
                    <div key={it.id} className="flex flex-col gap-1 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-3">
                        {/* Imagen de catálogo por ítem: único referente visual para verificar
                            la carta física contra la que llegó a la bóveda. */}
                        <CardImage src={it.card.imageSmallUrl} alt={it.card.name} className="w-10 shrink-0" />
                        <span className="text-sm font-medium" lang="en">
                          {it.card.name}
                        </span>
                        <FinishBadge finish={it.finish} productType={it.productType} />
                        {/* Ítem rechazado: cotización tachada — NO suma en el total aprobado. */}
                        <span className={cn('tabular text-xs text-muted', isRejected && 'line-through')}>
                          {formatMoneyCents(it.quotedPriceCents ?? 0, locale)}
                        </span>
                        {it.approvedPriceCents != null && (
                          <span className="tabular text-xs text-success">
                            {t('approvedLabel')}: {formatMoneyCents(it.approvedPriceCents, locale)}
                          </span>
                        )}
                        <StatusBadge domain="sellItem" value={it.itemStatus} />
                        {isRejected && (
                          <Badge tone="danger" shape="outline">
                            {t('rejectedOutOfTotal')}
                          </Badge>
                        )}
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
                            {/* v1.18: el rechazo exige MOTIVO (3–500) → abre el mini-diálogo. */}
                            <Button size="sm" variant="ghost" onClick={() => openReject(req.id, it)}>
                              {t('reject')}
                            </Button>
                          </>
                        )}
                        {/* Convertir a inventario: SOLO para aprobadas. Un ítem `rechazada`
                            (no-NM) NUNCA es convertible (contrato §M5, PROJECT criterio 16),
                            ni siquiera vencidos sus plazos: el botón no se ofrece. */}
                        {it.itemStatus !== 'convertida_inventario' && !isRejected && (
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
                    {/* Detalle del rechazo dentro de la solicitud: motivo + plazos (server). */}
                    {isRejected && (
                      <div className="flex flex-col gap-0.5 pl-14 text-xs text-muted">
                        {it.rejectionReason && (
                          <p>
                            {t('rejected.reasonLabel')}: {it.rejectionReason}
                          </p>
                        )}
                        {it.rejectedAt && (
                          <p>
                            {t('rejected.rejectedAtLabel')}:{' '}
                            <span className="tabular">{formatDate(it.rejectedAt, locale)}</span>
                          </p>
                        )}
                        {it.returnDeadlineAt && it.abandonDeadlineAt && (
                          <p>
                            {t('rejected.returnUntil', { date: formatDate(it.returnDeadlineAt, locale) })}
                            {' · '}
                            {t('rejected.abandonAt', { date: formatDate(it.abandonDeadlineAt, locale) })}
                          </p>
                        )}
                      </div>
                    )}
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
      )}

      {/* Cierre explícito de la solicitud (v1.24 · POST /admin/buylist/:id/reject). Confirmación
          destructiva (DESIGN_SYSTEM §7.6: «rechazar buylist»): resumen de consecuencia + motivo
          OPCIONAL (interno, sin correo) + botón `destructive` a la derecha. No mueve dinero. */}
      <Modal
        open={!!rejectRequestTarget}
        onClose={closeRejectRequest}
        title={t('rejectRequestTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={closeRejectRequest}>
              {tc('cancel')}
            </Button>
            <Button
              variant="destructive"
              loading={rejectRequestMutation.isPending}
              onClick={() =>
                rejectRequestTarget &&
                rejectRequestMutation.mutate({
                  requestId: rejectRequestTarget.id,
                  reason: rejectRequestReason.trim() || undefined,
                })
              }
            >
              {t('rejectRequestConfirm')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {rejectRequestTarget && (
            <p className="text-sm text-muted">
              <span className="tabular font-medium text-text">{rejectRequestTarget.id}</span>
              {' · '}
              {sellerLabel(rejectRequestTarget)}
            </p>
          )}
          <p className="text-sm">{t('rejectRequestConsequence')}</p>
          {/* Motivo OPCIONAL (0–500): interno al AuditLog, NO PII, no se envía correo. */}
          <Input
            label={t('rejectRequestReasonLabel')}
            hint={t('rejectRequestReasonHint')}
            type="text"
            maxLength={REJECT_REASON_MAX}
            value={rejectRequestReason}
            onChange={(e) => setRejectRequestReason(e.target.value)}
          />
          {rejectRequestError && (
            <Banner variant="danger" role="alert" title={tc('errorTitle')}>
              {rejectRequestError}
            </Banner>
          )}
        </div>
      </Modal>

      {/* Modal de rechazo con motivo obligatorio (v1.18 · decision=reject + reason 3–500).
          El motivo llega al vendedor por CORREO junto con sus plazos (aviso en el copy). */}
      <Modal
        open={!!rejectTarget}
        onClose={closeReject}
        title={t('rejectTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={closeReject}>
              {tc('cancel')}
            </Button>
            <Button
              variant="accent"
              disabled={!rejectReasonValid}
              loading={decisionMutation.isPending && decisionMutation.variables?.decision === 'reject'}
              onClick={() =>
                rejectTarget &&
                rejectReasonValid &&
                decisionMutation.mutate({
                  requestId: rejectTarget.requestId,
                  itemId: rejectTarget.item.id,
                  decision: 'reject',
                  reason: rejectReasonTrimmed,
                })
              }
            >
              {t('rejectConfirm')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {rejectTarget && (
            <p className="text-sm text-muted">
              <span lang="en" className="font-medium text-text">{rejectTarget.item.card.name}</span>
              {' · '}
              {t('quoted')}:{' '}
              <span className="tabular">
                {formatMoneyCents(rejectTarget.item.quotedPriceCents ?? 0, locale)}
              </span>
            </p>
          )}
          {/* Validación en cliente ANTES de enviar (espeja el 3–500 del backend). */}
          <Input
            label={t('rejectReasonLabel')}
            hint={t('rejectReasonHint')}
            error={rejectReason !== '' && !rejectReasonValid ? t('rejectReasonInvalid') : undefined}
            type="text"
            maxLength={REJECT_REASON_MAX}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
          <p className="text-xs text-muted">{t('rejectNotifyNote')}</p>
          {rejectError && (
            <Banner variant="danger" role="alert" title={tc('errorTitle')}>
              {rejectError}
            </Banner>
          )}
        </div>
      </Modal>

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

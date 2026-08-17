'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import { Link } from '@/i18n/navigation';
import { formatMoneyCents } from '@/lib/format';
import {
  createDispute,
  createShipment,
  getDisputes,
  getHoldings,
  getShipmentQuote,
  getShipments,
  listAddresses,
} from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type {
  CreateDisputeResponse,
  ShipmentCreateResponse,
  ShipmentDTO,
} from '@/types/contract';
import { PipelineStepper } from '@/components/ui/PipelineStepper';
import { AmountBreakdown } from '@/components/ui/AmountBreakdown';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Modal } from '@/components/ui/Modal';
import { Banner } from '@/components/ui/Banner';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { EmptyState } from '@/components/ui/EmptyState';
import { AddressManager } from '@/components/domain/AddressManager';
import { StripePaymentModal } from '@/components/domain/StripePaymentModal';
import { EmailNotVerifiedNotice } from '@/components/domain/EmailNotVerifiedNotice';
import { DisputeEvidenceContact } from '@/components/domain/DisputeEvidenceContact';
import { WithdrawalBadge } from '@/components/domain/WithdrawalBadge';
import { useShipmentSteps } from '@/lib/pipelines';

/** Ventana de 7 días (desde `entregado`) para abrir disputa (contrato §7). */
const DISPUTE_WINDOW_MS = 7 * 24 * 3600 * 1000;

/** Item de un envío entregado marcado para disputa (identidad + productType para el UI-gate). */
type DisputeTargetItem = ShipmentDTO['items'][number];

/**
 * 6h — Selección de cartas liquidadas con casilla y folio; las no elegibles se
 * apartan tras una regla bermellón en vez de encerrarlas en una caja de color, y
 * el stepper del envío es una línea de tiempo tipográfica (ver PipelineStepper).
 *
 * WS-F · F3 — Retiro REAL: el selector de país + `addr-mock` se reemplaza por un picker real de
 * direcciones (`AddressManager`), la cotización y la creación usan el `address.id` seleccionado, y
 * "Solicitar retiro" crea la `ShipmentRequest` (`POST /shipments`) → cobra por Stripe con el
 * `StripePaymentModal`. La regla MX-only sale de `address.country` (el backend valida
 * `ADDRESS_NOT_MX`). Maneja `403 EMAIL_NOT_VERIFIED` y `422 ITEM_NOT_SETTLED`.
 */
/** Resumen de una línea de la dirección del snapshot del retiro (ciudad, estado). */
function addressSummary(snapshot: ShipmentDTO['addressSnapshot']): string {
  if (!snapshot) return '';
  const rec = snapshot as Record<string, unknown>;
  return [rec.city, rec.state].filter((v): v is string => typeof v === 'string').join(', ');
}

export function ShipmentsView() {
  const t = useTranslations('shipments');
  const ts = useTranslations('shipmentStage');
  const locale = useLocale() as AppLocale;
  const getMessage = useErrorMessage();
  const shipmentSteps = useShipmentSteps();
  const searchParams = useSearchParams();
  // VaultView "Retirar" por-fila preselecciona el ítem vía ?item=<inventoryItemId>.
  const preselected = searchParams.get('item');
  const [selected, setSelected] = useState<string[]>(preselected ? [preselected] : []);
  const [addressId, setAddressId] = useState<string | undefined>(undefined);

  const [creating, setCreating] = useState(false);
  const [shipment, setShipment] = useState<ShipmentCreateResponse | null>(null);
  const [emailNotVerified, setEmailNotVerified] = useState(false);
  const [reqError, setReqError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const holdingsQuery = useQuery({ queryKey: ['holdings'], queryFn: getHoldings });
  const shipmentsQuery = useQuery({ queryKey: ['shipments'], queryFn: getShipments });
  const addressesQuery = useQuery({ queryKey: ['addresses'], queryFn: listAddresses });
  // F6 · Disputas del cliente (contrato §7 · GET /disputes). Cruza contra los envíos entregados
  // para (a) no ofrecer "Abrir disputa" en un ítem que ya tiene una abierta y (b) listar "Mis disputas".
  const disputesQuery = useQuery({ queryKey: ['disputes'], queryFn: getDisputes });

  // Ids con disputa ACTIVA (abierta/en_revision): oculta el botón para evitar duplicar.
  const activeDisputeItemIds = useMemo(
    () =>
      new Set(
        (disputesQuery.data ?? [])
          .filter((d) => d.status === 'abierta' || d.status === 'en_revision')
          .map((d) => d.inventoryItemId),
      ),
    [disputesQuery.data],
  );

  // --- Modal de creación de disputa (F6) ---
  const [disputeItem, setDisputeItem] = useState<DisputeTargetItem | null>(null);
  const [disputeDesc, setDisputeDesc] = useState('');
  const [disputeCreated, setDisputeCreated] = useState<CreateDisputeResponse | null>(null);

  const disputeMutation = useMutation({
    mutationFn: (item: DisputeTargetItem) =>
      createDispute({ inventoryItemId: item.inventoryItemId, description: disputeDesc.trim() }),
    onSuccess: (res) => {
      setDisputeCreated(res);
      void queryClient.invalidateQueries({ queryKey: ['disputes'] });
    },
  });

  function openDispute(item: DisputeTargetItem) {
    setDisputeItem(item);
    setDisputeDesc('');
    setDisputeCreated(null);
    disputeMutation.reset();
  }
  function closeDispute() {
    setDisputeItem(null);
    setDisputeDesc('');
    setDisputeCreated(null);
  }

  /**
   * UI-gate de elegibilidad para abrir disputa (contrato §7), para no chocar contra un 403/422 como
   * primer feedback. El backend sigue siendo la autoridad. Gate: envío `entregado`, dentro de la
   * ventana de 7 días (si hay `deliveredAt`), ítem NO gradeado (si se conoce el productType), y sin
   * disputa activa. Cuando falta el dato (`deliveredAt`/`productType`), no bloqueamos por ese eje:
   * la guarda server-side decide.
   */
  function canOpenDispute(shipment: ShipmentDTO, item: DisputeTargetItem): boolean {
    if (shipment.status !== 'entregado') return false;
    if (item.productType === 'graded') return false;
    if (activeDisputeItemIds.has(item.inventoryItemId)) return false;
    if (shipment.deliveredAt && Date.now() > new Date(shipment.deliveredAt).getTime() + DISPUTE_WINDOW_MS) {
      return false;
    }
    return true;
  }

  // v1.17: `withdrawable` es la fuente ÚNICA de verdad (settled && sin envío activo). Un item settled
  // pero ya EN RETIRO no es seleccionable (evita el 409 ITEM_IN_ANOTHER_SHIPMENT); cae en "no elegibles".
  const settledItems = useMemo(
    () => (holdingsQuery.data?.data ?? []).filter((h) => h.withdrawable),
    [holdingsQuery.data],
  );
  const pendingItems = useMemo(
    () => (holdingsQuery.data?.data ?? []).filter((h) => !h.withdrawable),
    [holdingsQuery.data],
  );

  // Dirección seleccionada (para la regla MX-only y para pasar su id a quote/create).
  const selectedAddress = useMemo(
    () => (addressesQuery.data ?? []).find((a) => a.id === addressId),
    [addressesQuery.data, addressId],
  );
  const isMx = selectedAddress?.country === 'MX';

  const quoteQuery = useQuery({
    queryKey: ['shipment-quote', selected, addressId],
    queryFn: () => getShipmentQuote(selected, addressId!),
    enabled: selected.length > 0 && !!addressId && isMx,
  });

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function requestWithdrawal() {
    if (!addressId) return;
    setCreating(true);
    setReqError(null);
    setEmailNotVerified(false);
    try {
      const res = await createShipment(selected, addressId);
      setShipment(res);
    } catch (e) {
      if (e instanceof ApiClientError && e.code === 'EMAIL_NOT_VERIFIED') {
        setEmailNotVerified(true);
      } else {
        // Incluye 422 ITEM_NOT_SETTLED / ADDRESS_NOT_MX / 409 ITEM_IN_ANOTHER_SHIPMENT.
        setReqError(getMessage(e));
      }
    } finally {
      setCreating(false);
    }
  }

  function onConfirmed() {
    // El cobro quedó autorizado; la solicitud avanza a picking cuando el webhook liquida. Limpiamos
    // la selección y refrescamos "mis envíos" para ver la nueva solicitud en `solicitado`.
    setShipment(null);
    setSelected([]);
    shipmentsQuery.refetch();
    holdingsQuery.refetch();
  }

  const canRequest = isMx && selected.length > 0 && !!addressId;

  return (
    <div>
      <div className="gutter pb-6 pt-10 lg:pt-[46px]">
        <h1 className="font-serif text-[28px] leading-[1.12] text-text lg:text-[40px]">{t('title')}</h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">{t('subtitle')}</p>
      </div>

      <div className="grid border-t border-border lg:grid-cols-[1fr_400px]">
        <div className="gutter border-b border-border pb-12 pt-6 lg:border-b-0 lg:border-r">
          <p className="rule-note mb-5 text-[13px] leading-[1.7] text-muted">{t('onlySettledNotice')}</p>

          <QueryState
            isLoading={holdingsQuery.isLoading}
            isError={holdingsQuery.isError}
            error={holdingsQuery.error}
            onRetry={() => holdingsQuery.refetch()}
          >
            <div>
              {settledItems.map((h) => {
                const checked = selected.includes(h.inventoryItemId);
                return (
                  <label
                    key={h.inventoryItemId}
                    className="flex cursor-pointer items-center gap-4 border-t border-border py-4 last:border-b"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(h.inventoryItemId)}
                      aria-label={`${t('selectItem')} ${h.folio}`}
                      className="h-4 w-4 shrink-0 cursor-pointer appearance-none border border-border-strong checked:border-text checked:bg-text"
                    />
                    <span className="tabular font-mono text-xs text-muted">{h.folio}</span>
                    <span className="flex-1 text-[15px] text-text" lang="en">
                      {h.card.name}
                    </span>
                    <StatusBadge domain="ownership" value={h.ownershipStatus} />
                  </label>
                );
              })}

              {pendingItems.length > 0 && (
                <div className="rule-note mt-8">
                  <p className="font-mono text-[11px] font-medium uppercase tracking-label text-accent">
                    {t('ineligibleTitle')}
                  </p>
                  {pendingItems.map((h) => (
                    <div key={h.inventoryItemId} className="mt-3 flex items-center gap-4 text-sm text-muted">
                      <span className="tabular font-mono text-xs">{h.folio}</span>
                      <span className="flex-1" lang="en">
                        {h.card.name}
                      </span>
                      {/* v1.17: si está EN RETIRO, mostramos el badge + deep-link; si no, la titularidad. */}
                      {h.shipmentState !== null ? (
                        <WithdrawalBadge stage={h.shipmentState} activeShipmentId={h.activeShipmentId} />
                      ) : (
                        <StatusBadge domain="ownership" value={h.ownershipStatus} />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </QueryState>
        </div>

        <aside className="gutter h-fit pb-12 pt-6 lg:px-10">
          {/* Picker real de direcciones (contrato §1). Reemplaza el selector de país + addr-mock. */}
          <AddressManager selectable selectedId={addressId} onSelect={setAddressId} />

          {selectedAddress && !isMx && (
            <p className="rule-note mt-5 text-[13px] leading-[1.7] text-accent" role="alert">
              {getMessage(new ApiClientError(422, { code: 'ADDRESS_NOT_MX', message: '' }))}
            </p>
          )}

          <p className="mt-5 text-xs leading-[1.65] text-muted">
            {t('flatFeeNotice')} {t('onlyMx')}
          </p>

          {canRequest && (
            <div className="mt-6 border-t border-border pt-4">
              <QueryState
                isLoading={quoteQuery.isLoading}
                isError={quoteQuery.isError}
                error={quoteQuery.error}
                onRetry={() => quoteQuery.refetch()}
              >
                {quoteQuery.data && (
                  <AmountBreakdown breakdown={quoteQuery.data.breakdown} variant="shipment" />
                )}
              </QueryState>
            </div>
          )}

          {emailNotVerified && (
            <div className="mt-6">
              <EmailNotVerifiedNotice />
            </div>
          )}
          {reqError && (
            <p role="alert" className="mt-6 font-mono text-xs text-accent">
              {reqError}
            </p>
          )}

          <Button
            variant="accent"
            loading={creating}
            disabled={!canRequest}
            onClick={requestWithdrawal}
            className="mt-6 w-full"
          >
            {t('requestWithdrawal')}
          </Button>
        </aside>
      </div>

      <section className="gutter border-t border-border pb-14 pt-10">
        <h2 className="font-serif text-[20px] leading-tight text-text lg:text-[28px]">{t('myShipments')}</h2>
        <div className="mt-5">
          <QueryState
            isLoading={shipmentsQuery.isLoading}
            isError={shipmentsQuery.isError}
            error={shipmentsQuery.error}
            onRetry={() => shipmentsQuery.refetch()}
          >
            {(shipmentsQuery.data?.length ?? 0) === 0 ? (
              <EmptyState title={t('noShipments')} />
            ) : (
              shipmentsQuery.data!.map((s) => (
                <div key={s.id} className="border-t border-border pt-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="flex flex-wrap items-center gap-3">
                      {/* Deep-link al detalle/rastreo del retiro (contrato §5 · GET /shipments/:id). */}
                      <Link
                        href={`/shipments/${s.id}`}
                        className="tabular font-mono text-[13px] text-text underline decoration-dotted underline-offset-4 hover:text-accent focus-visible:shadow-focus"
                      >
                        {s.id}
                      </Link>
                      <StatusBadge domain="shipment" value={s.status} />
                      {/* Etapa legible (tabla cliente §5), segundo canal textual del estado. */}
                      <span className="font-mono text-[11px] text-muted">{ts(s.status)}</span>
                    </span>
                    {s.trackingNumber && (
                      <span className="font-mono text-[11px] text-muted">
                        {s.carrier} · {t('tracking')} {s.trackingNumber}
                      </span>
                    )}
                  </div>

                  {/* Dirección + total del retiro (contrato §5: addressSnapshot / montos). */}
                  {(addressSummary(s.addressSnapshot) || s.totalCents != null) && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted">
                      {addressSummary(s.addressSnapshot) && <span>{addressSummary(s.addressSnapshot)}</span>}
                      {addressSummary(s.addressSnapshot) && s.totalCents != null && <span aria-hidden>·</span>}
                      {s.totalCents != null && (
                        <span className="tabular">
                          {t('withdrawalTotal')}: {formatMoneyCents(s.totalCents, locale)}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="mt-5">
                    <PipelineStepper steps={shipmentSteps} current={s.status} />
                  </div>

                  {/* Cartas incluidas en el retiro (folio, nombre, set): visibles en TODA etapa
                      (rastreo, contrato §5). En un envío ENTREGADO, cada ítem elegible ofrece
                      "Abrir disputa" inline (F6); un ítem con disputa activa muestra "Disputa abierta". */}
                  {(s.items?.length ?? 0) > 0 && (
                    <ul className="mt-5">
                      {s.items.map((it) => {
                        const isDelivered = s.status === 'entregado';
                        const eligible = isDelivered && canOpenDispute(s, it);
                        const disputed = activeDisputeItemIds.has(it.inventoryItemId);
                        return (
                          <li
                            key={it.inventoryItemId}
                            className="flex items-center gap-3 border-t border-border py-3 text-[13px] first:border-t-0"
                          >
                            <span className="tabular font-mono text-[11px] text-muted">{it.folio}</span>
                            <span className="min-w-0 flex-1 truncate text-text" lang="en">
                              {it.card.name}
                            </span>
                            <span
                              className="hidden truncate font-mono text-[11px] text-muted sm:block"
                              lang="en"
                            >
                              {it.card.setName}
                            </span>
                            {eligible ? (
                              <Button size="sm" variant="ghost" onClick={() => openDispute(it)}>
                                {t('dispute.open')}
                              </Button>
                            ) : isDelivered && disputed ? (
                              <span className="font-mono text-[11px] text-muted">
                                {t('dispute.alreadyOpen')}
                              </span>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              ))
            )}
          </QueryState>
        </div>
      </section>

      {/* F6: Mis disputas */}
      <section className="gutter border-t border-border pb-14 pt-10">
        <h2 className="font-serif text-[20px] leading-tight text-text lg:text-[28px]">
          {t('dispute.myDisputes')}
        </h2>
        <div className="mt-5">
          <QueryState
            isLoading={disputesQuery.isLoading}
            isError={disputesQuery.isError}
            error={disputesQuery.error}
            onRetry={() => disputesQuery.refetch()}
          >
            {(disputesQuery.data?.length ?? 0) === 0 ? (
              <EmptyState title={t('dispute.noDisputes')} />
            ) : (
              disputesQuery.data!.map((d) => (
                <div
                  key={d.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-4"
                >
                  <span className="flex items-center gap-3">
                    <span className="tabular font-mono text-[13px] text-text">{d.id}</span>
                    <StatusBadge domain="dispute" value={d.status} />
                  </span>
                  {d.deadlineAt && (
                    <span className="font-mono text-[11px] text-muted">
                      {t('dispute.deadline')} {new Date(d.deadlineAt).toLocaleDateString(locale)}
                    </span>
                  )}
                </div>
              ))
            )}
          </QueryState>
        </div>
      </section>

      {/* F6: modal de creación de disputa */}
      <Modal
        open={disputeItem !== null}
        onClose={closeDispute}
        title={t('dispute.title')}
        footer={
          disputeCreated ? (
            <Button onClick={closeDispute}>{t('dispute.done')}</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={closeDispute}>
                {t('dispute.cancel')}
              </Button>
              <Button
                loading={disputeMutation.isPending}
                disabled={disputeDesc.trim().length < 10}
                onClick={() => disputeItem && disputeMutation.mutate(disputeItem)}
              >
                {t('dispute.submit')}
              </Button>
            </>
          )
        }
      >
        <div className="flex flex-col gap-4">
          {disputeItem && (
            <p className="text-sm text-muted">
              <span className="tabular font-mono text-xs">{disputeItem.folio}</span>{' '}
              <span lang="en" className="text-text">
                {disputeItem.card.name}
              </span>
            </p>
          )}
          {disputeCreated ? (
            // Tras el 201: contacto de soporte (evidenceContact) + plazo de la disputa.
            <div className="flex flex-col gap-3">
              <DisputeEvidenceContact
                email={disputeCreated.evidenceContact}
                reference={disputeCreated.disputeId}
              />
              <p className="text-xs text-muted">
                {t('dispute.deadline')}{' '}
                {new Date(disputeCreated.deadlineAt).toLocaleDateString(locale)}
              </p>
            </div>
          ) : (
            <>
              <label className="flex flex-col">
                <span className="eyebrow">{t('dispute.descLabel')}</span>
                <textarea
                  rows={4}
                  value={disputeDesc}
                  onChange={(e) => setDisputeDesc(e.target.value)}
                  placeholder={t('dispute.descPlaceholder')}
                  className="mt-3 w-full resize-none border-b border-border-strong bg-transparent pb-3 text-base text-text outline-none placeholder:text-muted focus:border-text focus:shadow-focus"
                />
              </label>
              <p className="font-mono text-[11px] leading-[1.6] text-muted">{t('dispute.descHint')}</p>
              {disputeMutation.isError && (
                <Banner variant="danger" role="alert" title={t('dispute.errorTitle')}>
                  {getMessage(disputeMutation.error)}
                </Banner>
              )}
            </>
          )}
        </div>
      </Modal>

      <StripePaymentModal
        open={!!shipment}
        onClose={() => setShipment(null)}
        clientSecret={shipment?.stripe.clientSecret ?? null}
        returnUrl={typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : ''}
        title={t('payTitle')}
        amountLabel={shipment ? formatMoneyCents(shipment.breakdown.totalCents, locale) : undefined}
        onConfirmed={onConfirmed}
      />
    </div>
  );
}

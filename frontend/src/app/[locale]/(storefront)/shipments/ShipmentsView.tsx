'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { createShipment, getHoldings, getShipmentQuote, getShipments, listAddresses } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type { ShipmentCreateResponse } from '@/types/contract';
import { PipelineStepper } from '@/components/ui/PipelineStepper';
import { AmountBreakdown } from '@/components/ui/AmountBreakdown';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { EmptyState } from '@/components/ui/EmptyState';
import { AddressManager } from '@/components/domain/AddressManager';
import { StripePaymentModal } from '@/components/domain/StripePaymentModal';
import { EmailNotVerifiedNotice } from '@/components/domain/EmailNotVerifiedNotice';
import { useShipmentSteps } from '@/lib/pipelines';

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
export function ShipmentsView() {
  const t = useTranslations('shipments');
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

  const holdingsQuery = useQuery({ queryKey: ['holdings'], queryFn: getHoldings });
  const shipmentsQuery = useQuery({ queryKey: ['shipments'], queryFn: getShipments });
  const addressesQuery = useQuery({ queryKey: ['addresses'], queryFn: listAddresses });

  const settledItems = useMemo(
    () => (holdingsQuery.data?.data ?? []).filter((h) => h.ownershipStatus === 'settled'),
    [holdingsQuery.data],
  );
  const pendingItems = useMemo(
    () => (holdingsQuery.data?.data ?? []).filter((h) => h.ownershipStatus !== 'settled'),
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
                      <StatusBadge domain="ownership" value={h.ownershipStatus} />
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
                    <span className="flex items-center gap-3">
                      <span className="tabular font-mono text-[13px] text-text">{s.id}</span>
                      <StatusBadge domain="shipment" value={s.status} />
                    </span>
                    {s.trackingNumber && (
                      <span className="font-mono text-[11px] text-muted">
                        {s.carrier} · {t('tracking')} {s.trackingNumber}
                      </span>
                    )}
                  </div>
                  <div className="mt-5">
                    <PipelineStepper steps={shipmentSteps} current={s.status} />
                  </div>
                </div>
              ))
            )}
          </QueryState>
        </div>
      </section>

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

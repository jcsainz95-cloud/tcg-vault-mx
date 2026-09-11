'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import { Link, useRouter } from '@/i18n/navigation';
import { formatMoneyCents } from '@/lib/format';
import { createShipment, getHoldings, getShipmentQuote, listAddresses, updateAddress } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { useSession } from '@/lib/session';
import type { ShipmentCreateResponse } from '@/types/contract';
import { AmountBreakdown } from '@/components/ui/AmountBreakdown';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { AddressManager } from '@/components/domain/AddressManager';
import { StripePaymentModal } from '@/components/domain/StripePaymentModal';
import { EmailNotVerifiedNotice } from '@/components/domain/EmailNotVerifiedNotice';
import { WithdrawalBadge } from '@/components/domain/WithdrawalBadge';
import { VAULT_WITHDRAWALS_HREF, WITHDRAWAL_REQUESTED_KEY } from '../vault/vaultTabs';

/** Contrato §1 (v1.67): `recipientName` trim 1..120. */
const RECIPIENT_MAX = 120;

/**
 * 6h — Selección de cartas liquidadas con casilla y folio; las no elegibles se
 * apartan tras una regla bermellón en vez de encerrarlas en una caja de color.
 *
 * WS-F · F3 — Retiro REAL: picker real de direcciones (`AddressManager`), la cotización y la
 * creación usan el `address.id` seleccionado, y "Pagar envío y solicitar" crea la `ShipmentRequest`
 * (`POST /shipments`) → cobra por Stripe con el `StripePaymentModal`. La regla MX-only sale de
 * `address.country` (el backend valida `ADDRESS_NOT_MX`). Maneja `403 EMAIL_NOT_VERIFIED` y
 * `422 ITEM_NOT_SETTLED`.
 *
 * §33.4 (Stream A): esta pantalla es SOLO «Solicitar retiro». «Mis retiros» y «Mis disputas» se
 * mudaron a la pestaña «Retiros» de la bóveda (`vault/WithdrawalsList`), y tras pagar se navega a
 * `/vault?tab=retiros` — donde el usuario va a mirar de ahora en adelante.
 *
 * §33.10b / F10 (contrato v1.67, `M-52`): ningún envío sale sin destinatario. Si la dirección
 * elegida no tiene `recipientName` (fila anterior a M-52), el CTA queda deshabilitado con motivo y
 * se captura el nombre INLINE → `PATCH /users/me/addresses/:id { recipientName }` → la cotización
 * se pide sola y el CTA se habilita. Si aun así el servidor responde `422 RECIPIENT_NAME_REQUIRED`
 * (quote o create), se abre la misma captura para ESA `addressId` y se reintenta — hermano de
 * `PHONE_REQUIRED`. ⛔ Nunca se manda `User.name` por el usuario (puede ser el fabricado).
 */
export function ShipmentsView() {
  const t = useTranslations('shipments');
  const locale = useLocale() as AppLocale;
  const getMessage = useErrorMessage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useSession();
  // VaultView "Retirar" por-pieza preselecciona el ítem vía ?item=<inventoryItemId>.
  const preselected = searchParams.get('item');
  const [selected, setSelected] = useState<string[]>(preselected ? [preselected] : []);
  const [addressId, setAddressId] = useState<string | undefined>(undefined);

  const [creating, setCreating] = useState(false);
  const [shipment, setShipment] = useState<ShipmentCreateResponse | null>(null);
  const [emailNotVerified, setEmailNotVerified] = useState(false);
  const [reqError, setReqError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const holdingsQuery = useQuery({ queryKey: ['holdings'], queryFn: getHoldings });
  const addressesQuery = useQuery({ queryKey: ['addresses'], queryFn: listAddresses });

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

  // --- F10 · destinatario de la dirección elegida ---------------------------------------------
  // `serverSaysMissing` = el servidor respondió RECIPIENT_NAME_REQUIRED para ESA dirección aunque el
  // DTO local dijera otra cosa (caché vieja): manda el servidor.
  const [serverSaysMissing, setServerSaysMissing] = useState<string | null>(null);
  const recipientOnFile = (selectedAddress?.recipientName ?? '').trim();
  const recipientMissing =
    !!selectedAddress && (recipientOnFile === '' || serverSaysMissing === selectedAddress.id);
  const [recipientDraft, setRecipientDraft] = useState('');
  // Prellenado permitido SOLO en el front y SOLO si el nombre no es el fabricado por el sistema
  // (contrato §1 «Pre-relleno permitido»: `nameSource !== 'derived'`). Una sesión guardada sin
  // `nameSource` (anterior a v1.67) no puede saberlo ⇒ no se prellena: el usuario lo teclea.
  useEffect(() => {
    if (!recipientMissing) return;
    const source = user?.nameSource;
    const proposable = source === 'user' || source === 'google';
    setRecipientDraft(proposable && user?.name ? user.name : '');
    // Solo al cambiar de dirección (o al descubrir que falta): no pisa lo que el usuario teclea.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAddress?.id, recipientMissing]);
  const recipientClean = recipientDraft.trim();
  const recipientValid = recipientClean.length >= 1 && recipientClean.length <= RECIPIENT_MAX;

  const saveRecipient = useMutation({
    mutationFn: ({ id, recipientName }: { id: string; recipientName: string }) =>
      updateAddress(id, { recipientName }),
    onSuccess: (_saved, vars) => {
      setServerSaysMissing((cur) => (cur === vars.id ? null : cur));
      // El picker y `selectedAddress` se refrescan; la cotización se pide sola al habilitarse.
      void queryClient.invalidateQueries({ queryKey: ['addresses'] });
    },
  });

  const quoteQuery = useQuery({
    queryKey: ['shipment-quote', selected, addressId],
    queryFn: () => getShipmentQuote(selected, addressId!),
    // No se pide una cotización que el servidor va a rechazar por falta de destinatario.
    enabled: selected.length > 0 && !!addressId && isMx && !recipientMissing,
    retry: false,
  });
  // El servidor manda: si la cotización vuelve 422 RECIPIENT_NAME_REQUIRED, se abre la captura.
  useEffect(() => {
    const e = quoteQuery.error;
    if (e instanceof ApiClientError && e.code === 'RECIPIENT_NAME_REQUIRED' && addressId) {
      setServerSaysMissing(addressId);
    }
  }, [quoteQuery.error, addressId]);

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
      } else if (e instanceof ApiClientError && e.code === 'RECIPIENT_NAME_REQUIRED') {
        // Hermano de PHONE_REQUIRED: captura inline del destinatario de ESA dirección y reintento.
        const detailId =
          typeof e.details?.addressId === 'string' ? (e.details.addressId as string) : addressId;
        setServerSaysMissing(detailId);
        void queryClient.invalidateQueries({ queryKey: ['addresses'] });
        setReqError(t('recipient.required'));
      } else {
        // Incluye 422 ITEM_NOT_SETTLED / ADDRESS_NOT_MX / 409 ITEM_IN_ANOTHER_SHIPMENT.
        setReqError(getMessage(e));
      }
    } finally {
      setCreating(false);
    }
  }

  function onConfirmed() {
    // El cobro quedó autorizado; la solicitud avanza a picking cuando el webhook liquida. §33.4: el
    // usuario aterriza en la pestaña «Retiros» de su bóveda con «Retiro solicitado. Aquí verás su
    // avance.» (marca de una sola lectura en sessionStorage).
    setShipment(null);
    setSelected([]);
    void queryClient.invalidateQueries({ queryKey: ['shipments'] });
    void queryClient.invalidateQueries({ queryKey: ['holdings'] });
    try {
      window.sessionStorage.setItem(WITHDRAWAL_REQUESTED_KEY, '1');
    } catch {
      /* sin sessionStorage: se navega igual, sin el aviso */
    }
    router.push(VAULT_WITHDRAWALS_HREF);
  }

  const canRequest = isMx && selected.length > 0 && !!addressId && !recipientMissing;
  const shipToName = recipientMissing ? '' : recipientOnFile;

  return (
    <div>
      <div className="gutter pb-6 pt-10 lg:pt-[46px]">
        {/* §33.4: se llega desde la bóveda y se vuelve a ella. */}
        <Link
          href={VAULT_WITHDRAWALS_HREF}
          className="font-mono text-[11px] uppercase tracking-label text-muted hover:text-text"
        >
          ← {t('backToVault')}
        </Link>
        <h1 className="mt-4 font-serif text-[28px] leading-[1.12] text-text lg:text-[40px]">{t('title')}</h1>
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

          {/* F10 · destinatario que falta en la dirección elegida: motivo + captura inline + PATCH. */}
          {selectedAddress && isMx && recipientMissing && (
            <div className="rule-note mt-5" data-testid="recipient-capture">
              <p id="recipient-required" className="font-mono text-[11px] leading-[1.6] text-accent">
                {t('recipient.required')}
              </p>
              <div className="mt-4">
                <Input
                  label={t('recipient.label')}
                  hint={t('recipient.hint')}
                  autoComplete="name"
                  maxLength={RECIPIENT_MAX}
                  required
                  value={recipientDraft}
                  onChange={(e) => setRecipientDraft(e.target.value)}
                  error={saveRecipient.isError ? getMessage(saveRecipient.error) : undefined}
                />
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                disabled={!recipientValid}
                loading={saveRecipient.isPending}
                onClick={() =>
                  saveRecipient.mutate({ id: selectedAddress.id, recipientName: recipientClean })
                }
              >
                {t('recipient.save')}
              </Button>
            </div>
          )}

          <p className="mt-5 text-xs leading-[1.65] text-muted">
            {t('flatFeeNotice')} {t('onlyMx')}
          </p>

          {canRequest && (
            <div className="mt-6 border-t border-border pt-4">
              {/* §33.10b: el mismo dato que va a la etiqueta, leído una última vez antes de pagar. */}
              {shipToName && selectedAddress && (
                <p className="mb-3 font-mono text-[11px] text-muted" data-testid="ship-to">
                  {t('shipTo', { name: shipToName, city: selectedAddress.city, state: selectedAddress.state })}
                </p>
              )}
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
            // §15.9: ningún control apagado y mudo — el motivo está enlazado cuando falta el destinatario.
            aria-describedby={selectedAddress && isMx && recipientMissing ? 'recipient-required' : undefined}
            onClick={requestWithdrawal}
            className="mt-6 w-full"
          >
            {t('requestWithdrawal')}
          </Button>
        </aside>
      </div>

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

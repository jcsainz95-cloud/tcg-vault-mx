'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { PICKING_SUMMARY_KEY } from '@/hooks/usePickingSummary';
import { chargebackInventory, getAdminOrder, reclaimVault, refundToManual, retryRefund } from '@/lib/api';
import { asApiError } from '@/lib/api-client';
import { useRole } from '@/lib/role';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Textarea } from '@/components/ui/Textarea';
import { AmountBreakdown } from '@/components/ui/AmountBreakdown';
import { formatDateTimeMx, formatMoneyCents } from '@/lib/format';
import { historicalCardName } from '@/lib/historical-card';
import { cn } from '@/lib/cn';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import type { AdminOrderDetailDTO, ChargebackInventoryRequest, PaymentRefundDTO, VaultPieceDTO } from '@/types/contract';
import { ADMIN_ORDER_KEY, RefundOrderDialog } from '../RefundOrderDialog';
import { VaultPiecesList } from '../VaultPiecesList';

const DASH = '—';
const TAG = 'font-mono text-[11px] uppercase tracking-[0.06em]';
const LABEL = `${TAG} text-muted`;

/**
 * **Detalle M3 de una orden** (`DESIGN_SYSTEM §37.10/§37.11a`). Cliente (el comprador), cartas, envíos de este
 * pedido (enlace a «Pedidos por preparar»), reembolsos del libro y —solo súper-admin— transferencias SPEI y
 * «Pasar a transferencia» sobre una fila `failed`; en una compra a bóveda, `vaultPieces` con «Reclamar»
 * (`reclaim-vault`, v1.80.6 con selección por carta) y la confirmación física (`chargeback-inventory`).
 */
export function M3OrderDetailView({ orderId }: { orderId: string }) {
  const t = useTranslations('admin.m3');
  const td = useTranslations('admin.m3.detail');
  const tv = useTranslations('admin.m3.vaultRefund');
  const tr = useTranslations('admin.m3.refunds');
  const tsh = useTranslations('admin.m3.shipments');
  const tRole = useTranslations('admin.m3.role');
  const tRefund = useTranslations('status.paymentRefund');
  const tManual = useTranslations('admin.manualRefunds');
  const tManualStatus = useTranslations('status.manualRefund');
  const tShipStatus = useTranslations('status.shipment');
  const tOrders = useTranslations('orders');
  const tc = useTranslations('common');
  const tm = useTranslations('admin');
  const locale = useLocale() as AppLocale;
  const { isSuperAdmin } = useRole();
  const getError = useErrorMessage('operator');
  const qc = useQueryClient();

  const query = useQuery({ queryKey: [...ADMIN_ORDER_KEY, orderId], queryFn: () => getAdminOrder(orderId) });
  const o = query.data ?? null;

  const [refundOpen, setRefundOpen] = useState(false);
  const [notice, setNotice] = useState<{ role: 'status' | 'alert'; text: string; link?: { href: string; label: string } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reclaimOpen, setReclaimOpen] = useState<VaultPieceDTO[] | null>(null);
  const [reclaimPicked, setReclaimPicked] = useState<string[]>([]);
  const [reclaimUnpacked, setReclaimUnpacked] = useState(false);
  const [reclaimNote, setReclaimNote] = useState('');
  const [invOutcome, setInvOutcome] = useState<ChargebackInventoryRequest['outcome'] | ''>('');
  const [invNote, setInvNote] = useState('');
  const [toManualTarget, setToManualTarget] = useState<PaymentRefundDTO | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (reclaimOpen || toManualTarget) cancelRef.current?.focus();
  }, [reclaimOpen, toManualTarget]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ADMIN_ORDER_KEY });
    void qc.invalidateQueries({ queryKey: ['admin-orders'] });
    void qc.invalidateQueries({ queryKey: ['admin-preparation-queue'] });
    void qc.invalidateQueries({ queryKey: PICKING_SUMMARY_KEY });
  };

  const isVault = o?.fulfillmentMode === 'vault';
  const packed = (o?.vaultPieces ?? []).filter((p) => p.state === 'in_packed_withdrawal');
  const pendingConfirm = (o?.vaultPieces ?? []).filter((p) => p.pendingConfirmation);

  const reclaim = useMutation({
    mutationFn: (v: { note: string; confirmUnpacked: boolean; inventoryItemIds?: string[] }) => reclaimVault(orderId, v),
    onMutate: () => setError(null),
    onSuccess: (res) => {
      setReclaimOpen(null);
      setReclaimNote('');
      setReclaimUnpacked(false);
      setNotice({ role: 'status', text: res.reclaimed.length > 0 ? tv('reclaim.done', { count: res.reclaimed.length }) : tv('reclaim.nothing') });
      refresh();
    },
    onError: (e) => {
      setReclaimOpen(null);
      const err = asApiError(e);
      if (err?.status === 409 && err.code === 'CONFLICT' && err.details?.reason === 'not_closed') setError(tv('reclaim.notClosed'));
      else if (err?.status === 409 && err.code === 'CONFLICT' && err.details?.reason === 'not_vault') setError(tv('reclaim.notVault'));
      else setError(getError(e));
    },
  });

  const inventory = useMutation({
    mutationFn: (body: ChargebackInventoryRequest) => chargebackInventory(orderId, body),
    onMutate: () => setError(null),
    onSuccess: (res) => {
      setInvNote('');
      setInvOutcome('');
      setNotice({ role: 'status', text: tv('inventory.done', { outcome: res.outcome }) });
      refresh();
    },
    onError: (e) => {
      const err = asApiError(e);
      if (err?.status === 409 && err.code === 'CONFLICT') {
        setError(o?.chargebackNeedsManual ? tv('inventory.conflict') : tv('inventory.alreadyResolved'));
        refresh();
      } else setError(getError(e));
    },
  });

  const toManual = useMutation({
    mutationFn: (refundId: string) => refundToManual(refundId),
    onMutate: () => setError(null),
    onSuccess: (res) => {
      setToManualTarget(null);
      setNotice({ role: 'status', text: tManual('toManual.done', { link: res.id }), link: { href: `/admin/manual-refunds/${res.id}`, label: tr('viewTransfer') } });
      refresh();
    },
    onError: (e) => {
      setToManualTarget(null);
      const err = asApiError(e);
      if (err?.status === 409 && err.code === 'REFUND_NOT_CONVERTIBLE') {
        const status = err.details?.status;
        setError(typeof status === 'string' ? tManual('toManual.notConvertibleStatus', { status: tRefund.has(status) ? tRefund(status) : status }) : tManual('toManual.notConvertibleKind'));
      } else if (err?.status === 409 && err.code === 'CASE_ORIGIN_NOT_SETTLED') {
        setError(tManual('toManual.originNotSettled', { status: String(err.details?.originStatus ?? 'refunded'), disputed: err.details?.reason === 'charge_disputed' ? 'yes' : 'no' }));
      } else setError(getError(e));
    },
  });

  const retry = useMutation({
    mutationFn: (refundId: string) => retryRefund(refundId),
    onSuccess: (res) => {
      setNotice({ role: 'status', text: tRefund(res.status) });
      refresh();
    },
    onError: (e) => setError(getError(e)),
  });

  const customerName = o?.customer?.fullName?.trim() || (o?.customer ? t('nameMissing') : o?.guestEmail ? t('guest') : DASH);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/m3" className="font-mono text-[11px] uppercase tracking-label text-muted hover:text-text">
          ← {td('back')}
        </Link>
      </div>
      <QueryState isLoading={query.isLoading} isError={query.isError} error={query.error} onRetry={() => query.refetch()}>
        {o && (
          <div className="flex flex-col gap-6">
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <h1 className="text-h1 font-bold">{td('title', { ref: o.orderNumber ?? o.id })}</h1>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <StatusBadge domain="order" value={o.status} />
                  {o.fulfillmentMode && <span className={cn(TAG, 'text-muted')}>{td(`mode.${o.fulfillmentMode}`)}</span>}
                  <span className="tabular text-muted">{formatDateTimeMx(o.createdAt, locale)}</span>
                </div>
                <p className="text-sm text-text" data-testid="m3-customer">
                  <span className={LABEL}>{td('customer')}</span> {customerName}
                  {o.customer?.email && <span className="text-muted"> · {o.customer.email}</span>}
                  {!o.customer && o.guestEmail && <span className="text-muted"> · {o.guestEmail}</span>}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <p className="tabular text-lg font-semibold text-text">{formatMoneyCents(o.totalCents, locale)}</p>
                {o.status === 'settled' && (
                  <Button variant="destructive" size="sm" disabled={!isSuperAdmin} title={!isSuperAdmin ? tm('masked') : undefined} onClick={() => setRefundOpen(true)} data-testid="m3-refund-cta">
                    {t('refund')}
                  </Button>
                )}
              </div>
            </header>

            {notice && (
              <Banner key={notice.text} variant="info" role={notice.role} dismissible>
                <p className="text-sm text-text" data-testid="m3-notice">
                  {notice.text}
                </p>
                {notice.link && (
                  <Link href={notice.link.href} className="text-text underline underline-offset-4 hover:text-accent">
                    {notice.link.label}
                  </Link>
                )}
              </Banner>
            )}
            {error && (
              <Banner variant="danger" role="alert" title={tc('errorTitle')}>
                {error}
              </Banner>
            )}
            {o.chargebackNeedsManual && (
              <Banner variant="warning" role="status" title={td('needsManual')}>
                {td('needsManualBody')}
              </Banner>
            )}

            <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
              <div className="flex flex-col gap-8">
                <section className="flex flex-col gap-2">
                  <h2 className="text-h2 font-semibold">{td('items')}</h2>
                  <ul className="flex flex-col divide-y divide-border border-y border-border">
                    {(o.items ?? []).map((it) => {
                      const { text: name } = historicalCardName(it.card, tOrders('item.unknownCard'));
                      return (
                        <li key={it.inventoryItemId} className="flex flex-wrap items-baseline justify-between gap-2 py-3 text-sm text-text">
                          <span lang="en">{name}</span>
                          <span className="tabular">{formatMoneyCents(it.unitPriceCents, locale)}</span>
                          {it.refund && (
                            <span className="basis-full tabular text-muted">{td('itemRefunded', { amount: formatMoneyCents(it.refund.amountCents, locale), status: tRefund(it.refund.status) })}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>

                {/* §37.10b — solo órdenes `vault`. */}
                {isVault && o.vaultPieces && o.vaultPieces.length > 0 && (
                  <section className="flex flex-col gap-3" data-testid="m3-vault-pieces">
                    <h2 className="text-h2 font-semibold">{tv('piecesTitle')}</h2>
                    <VaultPiecesList
                      pieces={o.vaultPieces}
                      actions={(p) =>
                        p.state === 'in_packed_withdrawal' && isSuperAdmin ? (
                          <Button size="sm" variant="secondary" className="self-start" onClick={() => openReclaim([p])}>
                            {tv('reclaim.cta')}
                          </Button>
                        ) : null
                      }
                    />
                    {isSuperAdmin && packed.length > 1 && (
                      <Button variant="secondary" className="self-start" onClick={() => openReclaim(packed)}>
                        {tv('reclaim.ctaAll')}
                      </Button>
                    )}
                  </section>
                )}

                {/* Confirmación física (`chargeback-inventory`): directo `refunded`/`chargeback` o `vault` `refunded`. */}
                {o.chargebackNeedsManual && (o.fulfillmentMode === 'direct_ship' || (isVault && o.status === 'refunded')) && (
                  <section className="flex flex-col gap-3" data-testid="m3-inventory-form">
                    <h2 className="text-h2 font-semibold">{tv('inventory.title')}</h2>
                    <fieldset className="flex flex-col gap-2">
                      <legend className={cn(LABEL, 'mb-1')}>{isVault ? tv('inventory.legend') : tv('inventory.legendDirect')}</legend>
                      <label className="flex items-start gap-3 text-sm text-text">
                        <input type="radio" name="inv-outcome" className="mt-0.5 h-5 w-5 accent-text" checked={invOutcome === 'recuperada'} onChange={() => setInvOutcome('recuperada')} />
                        <span>
                          {tv('inventory.recovered')}
                          {isVault && <span className="block text-muted">{tv('inventory.recoveredHint')}</span>}
                        </span>
                      </label>
                      <label className="flex items-start gap-3 text-sm text-text">
                        <input type="radio" name="inv-outcome" className="mt-0.5 h-5 w-5 accent-text" checked={invOutcome === 'no_recuperada'} onChange={() => setInvOutcome('no_recuperada')} />
                        {tv('inventory.notRecovered')}
                      </label>
                      {/* ⛔ «Re-expedir» no se pinta en bóveda (una compra a bóveda no tiene envío que re-expedir). */}
                      {!isVault && o.disputeOutcome === 'won' && (
                        <label className="flex items-start gap-3 text-sm text-text">
                          <input type="radio" name="inv-outcome" className="mt-0.5 h-5 w-5 accent-text" checked={invOutcome === 'reexpedir'} onChange={() => setInvOutcome('reexpedir')} />
                          {tv('inventory.reship')}
                        </label>
                      )}
                    </fieldset>
                    <Textarea label={tv('inventory.note')} value={invNote} maxLength={500} counter={{ max: 500 }} onChange={(e) => setInvNote(e.target.value)} />
                    <Button
                      variant="primary"
                      className="self-start"
                      disabled={!invOutcome || invNote.trim().length < 3 || (isVault && pendingConfirm.length === 0)}
                      loading={inventory.isPending}
                      onClick={() => invOutcome && inventory.mutate({ outcome: invOutcome, note: invNote.trim() })}
                      data-testid="m3-inventory-confirm"
                    >
                      {tv('inventory.confirm')}
                    </Button>
                  </section>
                )}

                <section className="flex flex-col gap-2" data-testid="m3-shipments">
                  <h2 className="text-h2 font-semibold">{tsh('title')}</h2>
                  {!o.shipments || o.shipments.length === 0 ? (
                    <p className="text-sm text-muted">{tsh('none')}</p>
                  ) : (
                    <ul className="flex flex-col divide-y divide-border border-y border-border">
                      {o.shipments.map((s) => (
                        <li key={s.id} className="flex flex-wrap items-center gap-3 py-3 text-sm text-text">
                          <span className="tabular font-mono">{s.id}</span>
                          <StatusBadge domain="shipment" value={s.status} />
                          <span className="text-muted">{s.preparedAt ? tsh('prepared', { date: formatDateTimeMx(s.preparedAt, locale) }) : tsh('notPrepared')}</span>
                          {s.trackingNumber && <span className="tabular text-muted">{tsh('tracking', { carrier: s.carrier ?? DASH, number: s.trackingNumber })}</span>}
                          <Link href={s.status === 'picking' ? '/admin/m4' : '/admin/m4?tab=envios'} className="underline underline-offset-4 hover:text-accent">
                            {tsh('view')}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="flex flex-col gap-2" data-testid="m3-refunds">
                  <h2 className="text-h2 font-semibold">{tr('title')}</h2>
                  <p className="tabular text-sm text-text">
                    {tr('byStripe', { amount: formatMoneyCents(o.refundedCents ?? 0, locale) })}
                    {isSuperAdmin && typeof o.manualRefundedCents === 'number' && <> · {tr('byTransfer', { amount: formatMoneyCents(o.manualRefundedCents, locale) })}</>}
                  </p>
                  {!o.refunds || o.refunds.length === 0 ? (
                    <p className="text-sm text-muted">{tr('none')}</p>
                  ) : (
                    <ul className="flex flex-col divide-y divide-border border-y border-border">
                      {o.refunds.map((r) => (
                        <li key={r.id} className="flex flex-wrap items-center gap-3 py-3 text-sm text-text" data-testid={`m3-refund-${r.id}`}>
                          <span className="tabular">
                            {tr('row', {
                              kind: tr(`kind.${r.kind}`),
                              amount: formatMoneyCents(r.amountCents, locale),
                              status: tRefund(r.status),
                              name: r.requestedBy.name?.trim() || DASH,
                              role: tRole(r.requestedBy.role),
                              date: formatDateTimeMx(r.requestedAt, locale),
                            })}
                          </span>
                          {r.status === 'requested' && (isSuperAdmin || (r.kind !== 'order_full' && r.kind !== 'case_refund')) && (
                            <Button size="sm" variant="ghost" loading={retry.isPending && retry.variables === r.id} onClick={() => retry.mutate(r.id)}>
                              {tr('retry')}
                            </Button>
                          )}
                          {isSuperAdmin && r.kind === 'case_refund' && r.status === 'failed' && (
                            <Button size="sm" variant="secondary" onClick={() => setToManualTarget(r)} data-testid={`m3-to-manual-${r.id}`}>
                              {tManual('toManual.cta')}
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {isSuperAdmin && o.manualRefunds && (
                    <>
                      <h3 className={cn(LABEL, 'mt-2')}>{tr('transfers')}</h3>
                      {o.manualRefunds.length === 0 ? (
                        <p className="text-sm text-muted">{tr('transfersNone')}</p>
                      ) : (
                        <ul className="flex flex-col divide-y divide-border border-y border-border">
                          {o.manualRefunds.map((m) => (
                            <li key={m.id} className="flex flex-wrap items-center gap-3 py-3 text-sm text-text">
                              <span className="tabular">{formatMoneyCents(m.amountCents, locale)}</span>
                              <span className={cn(TAG, 'text-muted')}>{tManualStatus(m.status)}</span>
                              <Link href={`/admin/manual-refunds/${m.id}`} className="underline underline-offset-4 hover:text-accent">
                                {tr('viewTransfer')}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </section>
              </div>
              <aside className="h-fit">{o.breakdown && <AmountBreakdown breakdown={o.breakdown} variant="purchase" />}</aside>
            </div>
          </div>
        )}
      </QueryState>

      <RefundOrderDialog
        order={o}
        open={refundOpen}
        onClose={() => setRefundOpen(false)}
        onDone={(res) => {
          setRefundOpen(false);
          setNotice({ role: 'status', text: t('refundDone', { orderId: res.orderId }) });
        }}
      />

      {/* §37.10c — «Reclamar» (v1.80.6: casilla por carta para acotar `inventoryItemIds`). */}
      <Modal
        open={reclaimOpen !== null}
        onClose={() => setReclaimOpen(null)}
        title={tv('reclaim.title', { count: reclaimOpen?.length ?? 1 })}
        footer={
          <>
            <Button ref={cancelRef} variant="secondary" onClick={() => setReclaimOpen(null)}>
              {tc('cancel')}
            </Button>
            <Button
              variant="secondary"
              disabled={!reclaimUnpacked || reclaimNote.trim().length < 3}
              loading={reclaim.isPending}
              onClick={() =>
                reclaim.mutate({
                  note: reclaimNote.trim(),
                  confirmUnpacked: true,
                  ...(reclaimOpen && reclaimPicked.length > 0 && reclaimPicked.length < packed.length ? { inventoryItemIds: reclaimPicked } : {}),
                })
              }
              data-testid="m3-reclaim-confirm"
            >
              {tv('reclaim.confirm')}
            </Button>
          </>
        }
      >
        {reclaimOpen && (
          <div className="flex flex-col gap-3 text-sm text-text">
            <p>{tv('reclaim.body', { count: reclaimOpen.length, items: reclaimOpen.map((p) => `${p.cardName} · ${p.folio}`).join(', ') })}</p>
            {packed.length > 1 && (
              <fieldset className="flex flex-col gap-1">
                <legend className={cn(LABEL, 'mb-1')}>{tv('reclaim.pick')}</legend>
                {packed.map((p) => (
                  <label key={p.inventoryItemId} className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-text"
                      checked={reclaimPicked.includes(p.inventoryItemId)}
                      onChange={(e) => setReclaimPicked((cur) => (e.target.checked ? [...cur, p.inventoryItemId] : cur.filter((x) => x !== p.inventoryItemId)))}
                    />
                    <span lang="en">{p.cardName}</span> <span className="tabular font-mono text-muted">{p.folio}</span>
                  </label>
                ))}
                <p className="text-muted">{tv('reclaim.pickHint')}</p>
              </fieldset>
            )}
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-0.5 h-5 w-5 accent-text" checked={reclaimUnpacked} onChange={(e) => setReclaimUnpacked(e.target.checked)} data-testid="m3-reclaim-unpacked" />
              {tv('reclaim.unpacked', { count: reclaimPicked.length > 0 ? reclaimPicked.length : reclaimOpen.length })}
            </label>
            <Textarea label={tv('reclaim.note')} value={reclaimNote} maxLength={500} counter={{ max: 500 }} onChange={(e) => setReclaimNote(e.target.value)} />
          </div>
        )}
      </Modal>

      {/* §37.9c — «Pasar a transferencia (SPEI)» sobre una fila `failed` de un caso. */}
      <Modal
        open={toManualTarget !== null}
        onClose={() => setToManualTarget(null)}
        title={tManual('toManual.title', { amount: formatMoneyCents(toManualTarget?.amountCents ?? 0, locale) })}
        footer={
          <>
            <Button ref={cancelRef} variant="secondary" onClick={() => setToManualTarget(null)}>
              {tc('cancel')}
            </Button>
            <Button variant="secondary" loading={toManual.isPending} onClick={() => toManualTarget && toManual.mutate(toManualTarget.id)}>
              {tManual('toManual.confirm')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text">{tManual('toManual.body')}</p>
      </Modal>
    </div>
  );

  function openReclaim(pieces: VaultPieceDTO[]) {
    setReclaimOpen(pieces);
    setReclaimPicked(pieces.length === packed.length ? [] : pieces.map((p) => p.inventoryItemId));
    setReclaimUnpacked(false);
    setReclaimNote('');
    setError(null);
  }
}

export type { AdminOrderDetailDTO };

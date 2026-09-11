'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import { Link } from '@/i18n/navigation';
import { formatMoneyCents } from '@/lib/format';
import { createDispute, getDisputes, getShipments } from '@/lib/api';
import type { CreateDisputeResponse, ShipmentDTO } from '@/types/contract';
import { PipelineStepper } from '@/components/ui/PipelineStepper';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Modal } from '@/components/ui/Modal';
import { Banner } from '@/components/ui/Banner';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { EmptyState } from '@/components/ui/EmptyState';
import { DisputeEvidenceContact } from '@/components/domain/DisputeEvidenceContact';
import { useShipmentSteps } from '@/lib/pipelines';

/** Ventana de 7 días (desde `entregado`) para abrir disputa (contrato §7). */
const DISPUTE_WINDOW_MS = 7 * 24 * 3600 * 1000;

/** Item de un envío entregado marcado para disputa (identidad + productType para el UI-gate). */
type DisputeTargetItem = ShipmentDTO['items'][number];

/**
 * Resumen de una línea de la dirección del snapshot del retiro. §33.10c: antepone el
 * destinatario cuando el snapshot lo trae («{name} · {city}, {state}»); un snapshot anterior a
 * v1.67 (ocho campos, sin nombre) se resume solo por ciudad y estado — sin marcar nada al cliente,
 * que no puede arreglar un envío ya creado.
 */
export function addressSummary(snapshot: ShipmentDTO['addressSnapshot']): string {
  if (!snapshot) return '';
  const rec = snapshot as Record<string, unknown>;
  const str = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
  const place = [rec.city, rec.state].filter(str).join(', ');
  const name = str(rec.recipientName) ? rec.recipientName.trim() : '';
  return [name, place].filter(Boolean).join(' · ');
}

const REQUEST_CTA_CLASS =
  'inline-flex min-h-[44px] items-center border border-text px-6 text-[11px] font-medium uppercase tracking-label text-text hover:bg-text hover:text-primary-fg';

/**
 * §33.4 — «Mis retiros» + «Mis disputas», EXTRAÍDOS de `ShipmentsView` (antes `:320-450`) sin
 * cambio funcional, para vivir en la pestaña «Retiros» de la bóveda (`/vault?tab=retiros`):
 * «un retiro es una acción sobre la bóveda». Arriba, el CTA «Solicitar retiro» → `/shipments`,
 * que ahora es SOLO la pantalla de solicitar.
 *
 * Rastreo (contrato §5 · GET /shipments): folio del retiro (deep-link al detalle), `StatusBadge`,
 * etapa legible, guía, dirección resumida (con destinatario, §33.10c), total, stepper e ítems; en
 * un envío ENTREGADO cada ítem elegible ofrece «Abrir disputa» (F6, contrato §7).
 */
export function WithdrawalsList() {
  const t = useTranslations('shipments');
  const tv = useTranslations('vault');
  const ts = useTranslations('shipmentStage');
  const locale = useLocale() as AppLocale;
  const getMessage = useErrorMessage();
  const shipmentSteps = useShipmentSteps();
  const queryClient = useQueryClient();

  const shipmentsQuery = useQuery({ queryKey: ['shipments'], queryFn: getShipments });
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

  return (
    <div>
      <section className="gutter pb-14 pt-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="font-serif text-[20px] leading-tight text-text lg:text-[28px]">{t('myShipments')}</h2>
          <Link href="/shipments" className={REQUEST_CTA_CLASS}>
            {tv('requestWithdrawal')}
          </Link>
        </div>
        <div className="mt-5">
          <QueryState
            isLoading={shipmentsQuery.isLoading}
            isError={shipmentsQuery.isError}
            error={shipmentsQuery.error}
            onRetry={() => shipmentsQuery.refetch()}
          >
            {(shipmentsQuery.data?.length ?? 0) === 0 ? (
              <EmptyState
                title={t('noShipments')}
                action={
                  <Link href="/shipments" className={REQUEST_CTA_CLASS}>
                    {tv('requestWithdrawal')}
                  </Link>
                }
              />
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

                  {/* Destinatario + dirección + total del retiro (contrato §5: addressSnapshot / montos). */}
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
    </div>
  );
}

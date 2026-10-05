'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import { Link } from '@/i18n/navigation';
import { formatMoneyCents } from '@/lib/format';
import { getDisputes, getShipments } from '@/lib/api';
import type { ShipmentDTO } from '@/types/contract';
import { PipelineStepper } from '@/components/ui/PipelineStepper';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { QueryState } from '@/components/ui/QueryState';
import { EmptyState } from '@/components/ui/EmptyState';
import { SupportContact } from '@/components/domain/SupportContact';
import { useSupportContact } from '@/hooks/useSupportContact';
import { OrderItemStatusLine } from '@/components/domain/OrderItemStatusLine';
import { useShipmentSteps } from '@/lib/pipelines';

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
 * etapa legible, guía, dirección resumida (con destinatario, §33.10c), total, stepper e ítems.
 *
 * v1.82 §PNL.1 / DESIGN_SYSTEM §60.1: ⛔ ya no hay «Abrir disputa» ni su modal. Un retiro ENTREGADO
 * lleva UNA sección «¿Problema con tu retiro? Escríbenos» bajo sus cartas. «Mis disputas» solo se
 * pinta si el cliente tiene alguna (lectura de las que existan; sin vacío).
 */
export function WithdrawalsList() {
  const t = useTranslations('shipments');
  const tv = useTranslations('vault');
  const ts = useTranslations('shipmentStage');
  const locale = useLocale() as AppLocale;
  const shipmentSteps = useShipmentSteps();

  const shipmentsQuery = useQuery({ queryKey: ['shipments'], queryFn: getShipments });
  // Lectura en transición (PNL-1): solo para pintar «Mis disputas» si el cliente tiene alguna.
  const disputesQuery = useQuery({ queryKey: ['disputes'], queryFn: getDisputes });
  const disputes = disputesQuery.data ?? [];
  const support = useSupportContact();

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
                      (rastreo, contrato §5). */}
                  {(s.items?.length ?? 0) > 0 && (
                    <ul className="mt-5">
                      {s.items.map((it) => (
                        <li
                          key={it.inventoryItemId}
                          className="flex flex-wrap items-center gap-3 border-t border-border py-3 text-[13px] first:border-t-0"
                        >
                          <span className="tabular font-mono text-[11px] text-muted">{it.folio}</span>
                          <span className="min-w-0 flex-1 truncate text-text" lang="en">
                            {it.card.name}
                          </span>
                          {/* §37.7 / §37.8f / §60.2: la carta que no salió, se repone o se reembolsó lo dice aquí. */}
                          <OrderItemStatusLine refund={it.refund} replacement={it.replacement} className="basis-full" />
                          <span className="hidden truncate font-mono text-[11px] text-muted sm:block" lang="en">
                            {it.card.setName}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* §60.1 b: «Escríbenos» — una por retiro, solo ENTREGADO (antes no aparece). */}
                  {s.status === 'entregado' && (
                    <SupportContact email={support.contact} reference={s.id} kind="withdrawal" className="mt-5" />
                  )}
                </div>
              ))
            )}
          </QueryState>
        </div>
      </section>

      {/* §60.1 c: «Mis disputas» SOLO si tiene alguna — con cero, ni título ni vacío. */}
      {disputes.length > 0 && (
        <section className="gutter border-t border-border pb-14 pt-10">
          <h2 className="font-serif text-[20px] leading-tight text-text lg:text-[28px]">
            {t('dispute.myDisputes')}
          </h2>
          <div className="mt-5">
            {disputes.map((d) => (
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
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getAdminPreparationQueue } from '@/lib/api';
import { useSession } from '@/lib/session';
import { QueryState } from '@/components/ui/QueryState';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { FinishMark } from '@/components/domain/FinishMark';
import { formatDate } from '@/lib/format';
import { sortPreparationItems, sortPreparationOrders } from '@/lib/preparation-order';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import type { PreparationDestination, PreparationOrderDTO } from '@/types/contract';
import { useZonedLabel } from '../prep-shared';

const DASH = '—';

/**
 * **La hoja de preparación** (`DESIGN_SYSTEM §37.11c`). Solo CSS `@media print` (`print:hidden` en lo que no
 * va al papel), sin librerías, sin endpoint nuevo: lee la misma cola. Por pedido: número (o «Retiro de
 * bóveda»), cliente, dirección (envío) o cajón (bóveda), y las cartas en el orden de la pantalla con
 * **casilla** · folio · nombre · set · acabado · condición · ubicación con zona.
 *
 * ⛔ **Sin precios, sin correo, sin teléfono, sin importes de reembolso, sin marcas ya hechas** — el papel es
 * para palomear a mano (criterio 232, candado PS-UI-12). La miniatura no se imprime.
 */
export function PrintSheetView({ destination, shipmentId, placementId }: { destination?: PreparationDestination; shipmentId?: string; placementId?: string }) {
  const t = useTranslations('admin.m4.prep');
  const ts = useTranslations('admin.m4.prep.ship');
  const tm4 = useTranslations('admin.m4');
  const locale = useLocale() as AppLocale;
  const zoned = useZonedLabel();
  const { user } = useSession();
  const queue = useQuery({ queryKey: ['admin-preparation-queue', 'print', destination ?? ''], queryFn: () => getAdminPreparationQueue({ destination }) });
  const orders = sortPreparationOrders(queue.data ?? []).filter((o) =>
    shipmentId ? o.destination === 'ship' && o.shipmentId === shipmentId : placementId ? o.destination === 'vault' && o.placementId === placementId : true,
  );
  const today = formatDate(new Date().toISOString(), locale);

  return (
    <div className="flex flex-col gap-6 print:gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/admin/m4" className="font-mono text-[11px] uppercase tracking-label text-muted hover:text-text">
          ← {ts('print.back')}
        </Link>
        <Button variant="secondary" onClick={() => window.print()}>
          {ts('print.cta')}
        </Button>
      </div>
      <header>
        <h1 className="font-serif text-2xl text-text">{ts('print.title', { date: today })}</h1>
      </header>
      <QueryState isLoading={queue.isLoading} isError={queue.isError} error={queue.error} onRetry={() => queue.refetch()}>
        {orders.length === 0 ? (
          <EmptyState title={ts('print.empty')} />
        ) : (
          <ol className="flex flex-col gap-8">
            {orders.map((o: PreparationOrderDTO) => {
              const key = o.destination === 'ship' ? o.shipmentId : o.placementId;
              const name = o.customer.fullName?.trim() || t('nameMissing.tag');
              return (
                <li key={key} className="break-inside-avoid border-t border-border pt-4" data-testid={`print-order-${key}`}>
                  <h2 className="flex flex-wrap items-baseline gap-2">
                    {o.orderNumber ? <span className="tabular text-lg font-semibold text-text">{o.orderNumber}</span> : <span className="font-serif text-lg text-text">{t('withdrawal')}</span>}
                    <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">{t(`destination.${o.destination}`)}</span>
                  </h2>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-text">
                    <dt className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">{ts('print.customer')}</dt>
                    <dd>{name}</dd>
                    {o.destination === 'ship' ? (
                      <>
                        <dt className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">{ts('print.address')}</dt>
                        <dd>
                          {o.shipTo.recipientName ? `${o.shipTo.recipientName} · ` : ''}
                          {[o.shipTo.line1, o.shipTo.line2, o.shipTo.neighborhood].map((p) => p?.trim()).filter(Boolean).join(', ')} · {tm4('postalCode')} {o.shipTo.postalCode} · {o.shipTo.city}, {o.shipTo.state}
                        </dd>
                      </>
                    ) : (
                      <>
                        <dt className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">{ts('print.drawer')}</dt>
                        <dd>
                          {o.suggestedLocation.source === 'existing_customer_vault'
                            ? zoned(o.suggestedLocation.location.zone, o.suggestedLocation.location.label)
                            : o.suggestedLocation.source === 'multiple_drawers'
                              ? o.suggestedLocation.locations.map((l) => zoned(l.zone, l.label)).join(' · ')
                              : ts('print.noDrawer')}
                        </dd>
                      </>
                    )}
                  </dl>
                  <table className="mt-3 w-full border-collapse text-sm text-text">
                    <thead>
                      <tr className="border-y border-border font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                        <th className="py-2 pr-3 text-left" aria-label={ts('print.check')}>
                          <span aria-hidden>☐</span>
                        </th>
                        <th className="py-2 pr-3 text-left">{t('folio')}</th>
                        <th className="py-2 pr-3 text-left">{ts('print.card')}</th>
                        <th className="py-2 pr-3 text-left">{t('set')}</th>
                        <th className="py-2 pr-3 text-left">{t('location')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(o.destination === 'ship' ? sortPreparationItems(o.items) : sortPreparationItems(o.items)).map((it) => {
                        const itemKey = 'shipmentItemId' in it ? it.shipmentItemId : it.placementItemId;
                        const zone = 'currentZone' in it ? it.currentZone : null;
                        const located = it.currentLocation.kind === 'assigned';
                        return (
                          <tr key={itemKey} className="border-b border-border">
                            <td className="py-2 pr-3 align-top">
                              <span aria-hidden className="inline-block h-4 w-4 border border-text" />
                            </td>
                            <td className="tabular py-2 pr-3 align-top font-mono text-[12px]">{it.folio}</td>
                            <td className="py-2 pr-3 align-top">
                              <span lang="en">{it.card.name}</span>
                              <span className="ml-2 inline-flex items-center gap-1">
                                <FinishMark finish={it.card.finish} band={false} /> <span>{it.card.conditionLabel}</span>
                              </span>
                            </td>
                            <td className="py-2 pr-3 align-top" lang="en">
                              {it.card.setName ?? DASH}
                            </td>
                            <td className="tabular py-2 pr-3 align-top">
                              {located ? (zone ? zoned(zone, it.currentLocation.kind === 'assigned' ? it.currentLocation.label : '') : it.currentLocation.kind === 'assigned' ? it.currentLocation.label : '') : t('unassigned')}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </li>
              );
            })}
          </ol>
        )}
      </QueryState>
      <footer className="border-t border-border pt-3 font-mono text-[11px] text-muted">{ts('print.by', { name: user?.name?.trim() || DASH })}</footer>
    </div>
  );
}

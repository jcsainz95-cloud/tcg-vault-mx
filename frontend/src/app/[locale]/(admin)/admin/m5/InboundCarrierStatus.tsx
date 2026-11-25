'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import { formatDateTimeMx } from '@/lib/format';
import type { AdminBuylistDTO } from '@/types/contract';
import { formatShortDayMx, movedBySystem, readInboundCarrier } from '@/lib/buylist-inbound-carrier';

/**
 * §BUYLIST-RASTREO — estado de la paquetería de la guía de entrada + «marcado en tránsito por el sistema».
 * Ausente ⇒ `null` (no pinta nada). `compact` = una sola línea para la cinta («En camino · llega lun 30 nov»).
 */
export function InboundCarrierStatus({ req, compact = false }: { req: AdminBuylistDTO; compact?: boolean }) {
  const t = useTranslations('admin.m5.carrier');
  const locale = useLocale() as AppLocale;
  const c = readInboundCarrier(req);
  const auto = movedBySystem(req);
  if (!c && !auto) return null;

  const label = c?.kind ? t(c.kind) : null;
  const eta = c?.estimatedDeliveryAt && c.kind !== 'delivered' ? formatShortDayMx(c.estimatedDeliveryAt, locale) : '';
  const headline = label ? (eta ? t('withEta', { status: label, date: eta }) : label) : null;

  return (
    <div className="flex flex-col gap-0.5" data-testid="m5-inbound-carrier">
      {headline && (
        <p
          className={c?.kind === 'incident' ? 'text-sm font-medium text-accent' : 'text-sm font-medium text-text'}
          data-testid="m5-inbound-carrier-line"
        >
          {headline}
        </p>
      )}
      {c?.statusAt && (
        <p className="tabular text-xs text-muted">{t('updated', { when: formatDateTimeMx(c.statusAt, locale) })}</p>
      )}
      {!compact && c?.kind === 'delivered' && <p className="text-xs text-text">{t('deliveredWaiting')}</p>}
      {!compact && c?.kind === 'incident' && <p className="text-xs text-accent">{t('incidentNote')}</p>}
      {!compact && c?.kind === 'returning' && <p className="text-xs text-accent">{t('returningNote')}</p>}
      {c?.pollError && <p className="text-xs text-muted">{t('pollError')}</p>}
      {auto && (
        <p className="text-xs text-muted" data-testid="m5-auto-transit">
          {t('autoTransit')}
        </p>
      )}
    </div>
  );
}

'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatDateTimeMx } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { AppLocale } from '@/i18n/routing';
import { CUSTOMER_TIMELINE_KINDS, type CustomerTimelineEventDTO } from '@/types/contract';

/**
 * Lo que el CLIENTE ve del rastreo de Skydropx (`DESIGN_SYSTEM §43.11`, SK10 · contrato `§M4-SHIP.19.12`), en
 * las cuatro superficies (pedido registrado, `/pedido` del invitado, detalle del retiro y su fila en la bóveda).
 *
 * - **Liga** solo si el DTO trae `trackingUrl`: ⛔ nunca construida con la guía (la regla de
 *   `PublicOrderTracking` — «Sin URL de rastreo inventada» — sigue siendo la regla).
 * - **Movimientos** solo con ≥ 1 evento, el más reciente arriba; un `kind` fuera de los siete del contrato
 *   NO se pinta (no puede llegar: el servidor no lo manda; si llegara, no se enseña un rótulo crudo).
 */
export function TrackingLink({ url, labelKey = 'orders.shipment.trackingLink', className }: { url?: string | null; labelKey?: 'orders.shipment.trackingLink' | 'track.trackingLink'; className?: string }) {
  const t = useTranslations();
  const tl = useTranslations('status.timeline');
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="tracking-link"
      className={cn('text-sm text-text underline underline-offset-4 hover:text-accent', className)}
    >
      {t(labelKey)}
      <span className="sr-only"> {tl('newTab')}</span>
    </a>
  );
}

export function ShipmentTimeline({ events, className }: { events?: CustomerTimelineEventDTO[] | null; className?: string }) {
  const t = useTranslations('status.timeline');
  const locale = useLocale() as AppLocale;
  const known = (events ?? []).filter((e) => (CUSTOMER_TIMELINE_KINDS as readonly string[]).includes(e.kind));
  if (known.length === 0) return null;
  const ordered = [...known].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return (
    <div className={className} data-testid="shipment-timeline">
      <h3 className="eyebrow">{t('title')}</h3>
      <ol className="mt-2 flex flex-col gap-1">
        {ordered.map((e, i) => (
          <li key={`${e.kind}-${e.at}-${i}`} className="text-sm text-text">
            {t('line', {
              label: e.kind === 'at_branch' && e.branchName ? t('atBranchNamed', { branch: e.branchName }) : t(e.kind),
              datetime: formatDateTimeMx(e.at, locale),
            })}
          </li>
        ))}
      </ol>
    </div>
  );
}

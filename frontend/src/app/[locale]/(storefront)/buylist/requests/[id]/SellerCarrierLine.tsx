'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import type { SellRequestDTO } from '@/types/contract';
import { formatShortDayMx, readInboundCarrier } from '@/lib/buylist-inbound-carrier';

/** §BUYLIST-RASTREO (vendedor): una línea en llano del estado de la paquetería. Sin actor ni costo. Ausente ⇒ nada. */
export function SellerCarrierLine({ data }: { data: Pick<SellRequestDTO, 'inboundCarrier'> }) {
  const t = useTranslations('buylistCarrier');
  const locale = useLocale() as AppLocale;
  const c = readInboundCarrier(data);
  if (!c?.kind) return null;
  const eta = c.kind === 'onTheWay' && c.estimatedDeliveryAt ? formatShortDayMx(c.estimatedDeliveryAt, locale) : '';
  const text = c.kind === 'onTheWay' && eta ? t('onTheWayEta', { date: eta }) : t(c.kind);
  return (
    <section className="gutter mt-6" data-testid="seller-carrier-line">
      <p className="text-sm text-text">{text}</p>
    </section>
  );
}

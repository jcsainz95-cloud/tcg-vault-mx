'use client';

import { useTranslations } from 'next-intl';
import type { SellRequestDTO } from '@/types/contract';
import { readInboundCarrier } from '@/lib/buylist-inbound-carrier';

/** §BUYLIST-RASTREO (vendedor): una línea en llano del estado de la paquetería. Sin actor ni costo. Ausente ⇒ nada. */
export function SellerCarrierLine({ data }: { data: Pick<SellRequestDTO, 'inboundCarrier'> }) {
  const t = useTranslations('buylistCarrier');
  const c = readInboundCarrier(data);
  if (!c?.kind) return null;
  const text = t(c.kind);
  return (
    <section className="gutter mt-6" data-testid="seller-carrier-line">
      <p className="text-sm text-text">{text}</p>
    </section>
  );
}

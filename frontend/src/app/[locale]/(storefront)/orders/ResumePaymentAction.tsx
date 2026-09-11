'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { getOrder } from '@/lib/api';
import { useCart } from '@/lib/cart';
import type { AppLocale } from '@/i18n/routing';
import { Button } from '@/components/ui/Button';
import {
  formatReservationTime,
  remainingMs,
} from '../checkout/reservation-clock';

/**
 * «Reanudar pago» (contrato v1.68, §4-R.5). **No hay endpoint de reanudar: reanudar ES
 * reintentar.** Un pedido `pending` con `reservedUntil` en el futuro sigue siendo del cliente; el
 * front carga `items[].inventoryItemId` de `GET /orders/:id` en el carrito y vuelve a `/checkout`,
 * donde `POST /checkout/session` responde `200 reused` (misma orden, mismo PaymentIntent).
 *
 * Se ofrece SOLO si `status === 'pending'` **y** el servidor mandó `reservedUntil` parseable:
 * sin ese dato no se promete nada. Vencida (`reservedUntil <= now`, v1.68.1 §4-R.2 «propia
 * VENCIDA»): se dice que venció y **se sigue ofreciendo** — la sesión la SUSTITUYE (`201`), nunca
 * la trata como ajena; si el barrido ya la liberó, la sesión crea una orden nueva igual.
 *
 * El carrito se SUSTITUYE (no se fusiona): el reuso exige que el conjunto sea exactamente el del
 * pedido; fusionar produciría una SUSTITUCIÓN (`201`) y cancelaría el intento que se quería
 * reanudar. Se avisa en la propia acción.
 */
export interface ResumableOrder {
  id: string;
  status: string;
  reservedUntil?: string;
}

export function ResumePaymentAction({ order, className }: { order: ResumableOrder; className?: string }) {
  const t = useTranslations('orders.resume');
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const cart = useCart();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  if (order.status !== 'pending') return null;
  const left = remainingMs(order.reservedUntil);
  if (left === null) return null;

  async function resume() {
    setLoading(true);
    setFailed(false);
    try {
      const detail = await getOrder(order.id);
      const ids = detail.items.map((it) => it.inventoryItemId);
      cart.clear();
      for (const id of ids) cart.add(id);
      router.push('/checkout');
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  const expired = left <= 0;
  return (
    <div className={className} data-testid="resume-payment">
      <p className="font-mono text-[11px] text-muted" data-testid={expired ? 'resume-expired' : undefined}>
        {expired ? t('expired') : t('reservedUntil', { time: formatReservationTime(order.reservedUntil, locale) })}
      </p>
      <Button
        size="sm"
        variant="secondary"
        loading={loading}
        onClick={resume}
        title={t('cartReplaced')}
        className="mt-2"
      >
        {t('cta')}
      </Button>
      {failed && (
        <p role="alert" className="mt-2 font-mono text-[11px] text-accent">
          {t('error')}
        </p>
      )}
    </div>
  );
}

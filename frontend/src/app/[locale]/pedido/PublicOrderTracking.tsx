'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import type { GuestOrderTrackingDTO } from '@/types/contract';
import { formatDate, formatMoneyCents } from '@/lib/format';
import { AmountBreakdown } from '@/components/ui/AmountBreakdown';
import { Button } from '@/components/ui/Button';
import { CardImage } from '@/components/ui/CardImage';
import { PipelineStepper } from '@/components/ui/PipelineStepper';
import { ListingSpec } from '@/components/domain/ListingSpec';
import { DisputeEvidenceContact } from '@/components/domain/DisputeEvidenceContact';
import { TRACKING_STATUS_KEY, TRACKING_STATUS_TONE, TRACKING_STEPS, stepForStatus } from './tracking-status';

export interface PublicOrderTrackingProps {
  data: GuestOrderTrackingDTO;
  /** hora del último fetch correcto (frescura, §15.6 · 8) */
  updatedAt: Date;
  isRefreshing: boolean;
  onRefresh: () => void;
  /** abre el formulario neutro de reenvío (§15.7), misma respuesta y mismo límite */
  onResendLink: () => void;
}

/**
 * `PublicOrderTracking` (DESIGN_SYSTEM §15.6, criterios 50, 51, 52) — **superficie de
 * seguridad**.
 *
 * Es una PUERTA SIN CONTRASEÑA: quien tenga el enlace ve la página. Por eso:
 *  - Se pinta EXCLUSIVAMENTE lo que trae el DTO del contrato (§4-G.3) y, de eso, solo la
 *    lista cerrada de §15.6. En particular NO se pintan `emailMasked`,
 *    `shipping.recipientNameMasked` ni `shipping.postalCodeMasked`, aunque el DTO los
 *    traiga: el diseño elige el extremo conservador ("a lo mucho" ⇒ mostrar menos cumple).
 *  - No hay NINGUNA acción que escriba en el pedido: ni cancelar, ni cambiar dirección, ni
 *    reembolsar, ni pedir factura. Las tres acciones permitidas son de solo lectura
 *    (copiar, refrescar, pedir enlace nuevo) más el enlace de "crear cuenta".
 *  - Ningún identificador interno llega a esta pantalla: el DTO no trae `orderId`, `userId`,
 *    `inventoryItemId` ni folios, y este componente no los inventa.
 */
export function PublicOrderTracking({
  data,
  updatedAt,
  isRefreshing,
  onRefresh,
  onResendLink,
}: PublicOrderTrackingProps) {
  const t = useTranslations('track');
  const tRoot = useTranslations();
  const locale = useLocale() as AppLocale;
  const [copied, setCopied] = useState<'order' | 'tracking' | null>(null);

  const step = stepForStatus(data.status);
  const statusLabel = tRoot(TRACKING_STATUS_KEY[data.status]);

  async function copy(value: string, what: 'order' | 'tracking') {
    try {
      await navigator.clipboard?.writeText(value);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* sin clipboard: el valor sigue visible y seleccionable */
    }
  }

  const stepDates: Partial<Record<string, string>> = {
    pagado: data.paidAt,
    enviado: data.shipping.shippedAt,
    entregado: data.shipping.deliveredAt,
  };

  return (
    <div className="gutter max-w-3xl py-12">
      {/* 1 · Número de pedido — único identificador en pantalla. */}
      <p className="eyebrow">{t('orderLabel')}</p>
      <div className="mt-3 flex flex-wrap items-baseline gap-4">
        <h1 data-testid="tracking-order-number" className="font-mono text-[26px] leading-none text-text">
          {data.orderNumber}
        </h1>
        <Button variant="ghost" size="sm" onClick={() => copy(data.orderNumber, 'order')}>
          {copied === 'order' ? t('copied') : t('copyOrderNumber')}
        </Button>
        <span aria-live="polite" className="sr-only">
          {copied ? t('copied') : ''}
        </span>
      </div>

      {/* 2 · Estado. */}
      <section aria-labelledby="tracking-status" className="mt-10 border-t border-border pt-8">
        <h2 id="tracking-status" className="eyebrow">
          {t('statusLabel')}
        </h2>
        <p
          data-testid="tracking-status-label"
          className={`mt-3 font-mono text-[11px] uppercase tracking-label ${TRACKING_STATUS_TONE[data.status]}`}
        >
          {statusLabel}
        </p>
        {step ? (
          <div className="mt-5">
            <PipelineStepper
              current={step}
              steps={TRACKING_STEPS.map((key) => {
                const date = stepDates[key];
                return {
                  key,
                  label: date
                    ? `${tRoot(TRACKING_STATUS_KEY[key])} · ${formatDate(date, locale)}`
                    : tRoot(TRACKING_STATUS_KEY[key]),
                };
              })}
            />
          </div>
        ) : (
          // Reembolsado / cancelado / en revisión: sin detalles del proceso (§15.6).
          <p className="mt-4 text-sm leading-relaxed text-muted">{t('supportNote')}</p>
        )}
      </section>

      {/* 3 · Guía (solo cuando existe). Sin URL de rastreo inventada: texto copiable. */}
      <section aria-labelledby="tracking-label-section" className="mt-10 border-t border-border pt-8">
        <h2 id="tracking-label-section" className="eyebrow">
          {t('trackingLabel')}
        </h2>
        {data.shipping.trackingNumber ? (
          <div className="mt-3 flex flex-wrap items-baseline gap-4">
            <span className="text-sm text-text">{data.shipping.carrier}</span>
            <span className="font-mono text-[15px] text-text">{data.shipping.trackingNumber}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => copy(data.shipping.trackingNumber ?? '', 'tracking')}
            >
              {copied === 'tracking' ? t('copied') : t('copyTracking')}
            </Button>
          </div>
        ) : (
          <p className="mt-3 font-mono text-[11px] uppercase tracking-label text-muted">
            {t('trackingPending')}
          </p>
        )}
      </section>

      {/* 4 · Artículos — sin folio de inventario ni ningún id interno. */}
      <section aria-labelledby="tracking-items" className="mt-10 border-t border-border pt-8">
        <h2 id="tracking-items" className="eyebrow">
          {t('itemsLabel')}
        </h2>
        <ul className="mt-4">
          {data.items.map((item, i) => (
            <li key={`${item.setName}-${item.number}-${i}`} className="flex items-center gap-5 border-b border-border py-4">
              <div className="w-14 shrink-0">
                <CardImage src={item.imageSmallUrl} alt={item.name} className="p-1" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-serif text-[17px] font-medium leading-tight text-text" lang="en">
                  {item.name}
                </p>
                <p className="mt-1.5 font-mono text-[11px] text-muted" lang="en">
                  {item.setName} · #{item.number}
                </p>
                <ListingSpec
                  className="mt-1.5"
                  productType={item.productType}
                  rawCondition={item.rawCondition}
                  sealedSubtype={item.sealedSubtype}
                  finish={item.finish}
                  gradingCompany={item.gradingCompany}
                  gradeValue={item.gradeValue}
                  compact
                />
              </div>
              <span className="tabular text-[17px] font-medium text-text">
                {formatMoneyCents(item.unitPriceCents, locale)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* 5 · Total pagado — el mismo desglose que recibió por correo, en solo lectura. */}
      <section aria-labelledby="tracking-total" className="mt-10 border-t border-border pt-8">
        <h2 id="tracking-total" className="eyebrow">
          {t('totalPaidLabel')}
        </h2>
        <div className="mt-4 max-w-[420px]">
          <AmountBreakdown breakdown={data.breakdown} variant="purchase" />
        </div>
      </section>

      {/* 6 · Pago: una sola línea. Nada más que marca + terminación (criterio 51). */}
      {data.payment?.last4 && (
        <section aria-labelledby="tracking-payment" className="mt-10 border-t border-border pt-8">
          <h2 id="tracking-payment" className="eyebrow">
            {t('paymentLabel')}
          </h2>
          <p className="mt-3 font-mono text-[13px] uppercase tracking-label text-text">
            {t('paidWithCard', { last4: data.payment.last4 })}
          </p>
        </section>
      )}

      {/* 7 · Envío: ciudad y estado. Sin calle, número, colonia, CP ni destinatario. */}
      <section className="mt-10 border-t border-border pt-8">
        <p className="text-sm text-text">
          {t('shipToLabel', { city: data.shipping.city, state: data.shipping.state })}
        </p>
      </section>

      {/* 8 · Frescura + acciones de SOLO LECTURA. */}
      <div className="mt-10 flex flex-wrap items-center gap-4 border-t border-border pt-8">
        <p className="text-xs text-muted">
          {t('updatedAt', {
            time: new Intl.DateTimeFormat(locale === 'es' ? 'es-MX' : 'en-US', {
              hour: '2-digit',
              minute: '2-digit',
            }).format(updatedAt),
          })}
        </p>
        <Button variant="ghost" size="sm" loading={isRefreshing} onClick={onRefresh}>
          {t('refresh')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onResendLink}>
          {t('resendCta')}
        </Button>
      </div>

      {/* Disputa / error de plataforma: por correo a soporte citando el nº de pedido
          (criterio 56b). La página no abre disputas: no escribe en el pedido. */}
      <section aria-labelledby="tracking-trouble" className="mt-10 border-t border-border pt-8">
        <h2 id="tracking-trouble" className="eyebrow">
          {t('troubleWithOrder')}
        </h2>
        <div className="mt-4">
          <DisputeEvidenceContact
            email={data.support.evidenceContact}
            reference={data.orderNumber}
          />
        </div>
      </section>

      {/* Reclamo (enlace secundario): NO prellena ni muestra el correo — la página no lo
          conoce en pantalla (§15.6 · 4). */}
      {data.claim.available && (
        <section className="mt-10 border-t border-border pt-8">
          <Link href="/register" className="text-sm text-accent underline underline-offset-4 hover:text-text">
            {t('createAccountCta')}
          </Link>
          <p className="mt-2 text-xs leading-relaxed text-muted">{t('createAccountHint')}</p>
        </section>
      )}
    </div>
  );
}

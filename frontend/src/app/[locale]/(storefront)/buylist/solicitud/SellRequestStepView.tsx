'use client';

import { useEffect, useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { BuylistKycForm } from '@/components/domain/BuylistKycForm';
import { BuylistPendingLineLabel, BuylistPendingLinesNote } from '@/components/domain/BuylistPendingLinesNote';
import { FinishMark } from '@/components/domain/FinishMark';
import { SellRequirementsPanel } from '@/components/domain/SellRequirementsPanel';
import { useSellRequirements } from '@/hooks/useSellRequirements';
import { EditorialLink } from '../../_shared/EditorialLink';
import { useSellCart } from '../useSellCart';
import { useQuotePolicy, minimumShortfallCents } from '../useQuotePolicy';
import { CartTotalFigure } from '../CartTotalFigure';

/**
 * `/buylist/solicitud` — el PASO de crear la solicitud de venta (resumen + CLABE + INE + dirección de origen).
 *
 * ARCHITECTURE §14.4 (D-MKT2-8, v1.109): era el modal de `BuylistView`; se mudó a una ruta EXCLUIDA de la
 * medición para que `/buylist` (el cotizador) pueda medirse sin que su documento pinte CLABE ni INE. Se llega
 * con navegación dura (`../request-step.ts`) y el carrito llega por `localStorage` (`useSellCart`): al montar
 * se rehidrata y se RE-COTIZA, y el formulario no se pinta hasta tener precios frescos (§33.11.2: «no se envía
 * con precios que la pantalla no volvió a pedir»).
 *
 * Contenido y textos: los MISMOS del modal (resumen, total con `CartTotalFigure`, vigencia, `BuylistKycForm`);
 * ⛔ sin copia nueva. Estados: cargando (sesión/carrito/precios), sin sesión o correo sin verificar (el panel de
 * requisitos de siempre), lista vacía, recotización fallida (reintentar), bajo el mínimo (de vuelta al
 * cotizador), creada (aviso de siempre + «Mis solicitudes»).
 */
export function SellRequestStepView() {
  const t = useTranslations('buylist');
  const tc = useTranslations('common');
  const tSellCart = useTranslations('sellCart');
  const locale = useLocale() as AppLocale;
  const queryClient = useQueryClient();
  const headingId = useId();

  const { cart, clearCart, totalEstimatedCents, pendingCardCount, requestItems, requoting, requoteFailed, retryRequote } =
    useSellCart();
  const sellReq = useSellRequirements(totalEstimatedCents);
  const { minimumRequestCents } = useQuotePolicy();
  const [created, setCreated] = useState(false);
  // La rehidratación de `useSellCart` corre en su efecto de montaje (nunca en SSR): hasta el primer efecto, una
  // lista vacía no significa «vacía», significa «todavía no leída».
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const noFreshPrice = requoting || requoteFailed;
  const belowMinimum = cart.length > 0 && minimumShortfallCents(minimumRequestCents, totalEstimatedCents) != null;

  const backToQuoter = <EditorialLink href="/buylist">{tc('back')}</EditorialLink>;

  let body: React.ReactNode;
  if (created) {
    // §23.14.4c: el aviso de siempre («no mandes nada todavía») y el camino a «Mis solicitudes».
    body = (
      <div className="flex flex-col gap-5">
        <p className="rule-note text-sm text-text" role="status">
          {t('created')}
        </p>
        <EditorialLink href="/orders?tab=ventas">{t('viewMyRequests')} →</EditorialLink>
      </div>
    );
  } else if (!hydrated || !sellReq.ready) {
    body = <p className="text-sm text-muted" role="status">{tc('loading')}</p>;
  } else if (!sellReq.isAuthenticated || sellReq.emailBlocked) {
    body = (
      <div className="flex flex-col gap-5">
        <SellRequirementsPanel req={sellReq} />
        {backToQuoter}
      </div>
    );
  } else if (cart.length === 0 || requestItems.length === 0) {
    body = (
      <div className="flex flex-col gap-5">
        <p className="text-sm text-muted">{t('cartEmpty')}</p>
        {backToQuoter}
      </div>
    );
  } else if (requoting || sellReq.kycLoading || sellReq.ineVerdictPending) {
    // Precios frescos y el veredicto de INE para ESTE total antes del formulario (lee `ineExpected` al montar).
    body = <p className="text-sm text-muted" role="status" aria-busy="true">{tc('loading')}</p>;
  } else if (requoteFailed) {
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <p role="alert" className="font-mono text-[11px] leading-[1.6] text-accent">
          {tSellCart('requoteFailed')}
        </p>
        <Button size="sm" variant="secondary" onClick={retryRequote}>
          {tSellCart('retry')}
        </Button>
      </div>
    );
  } else if (belowMinimum || !sellReq.canSubmit) {
    // El CTA del cotizador ya no habría dejado llegar aquí (mínimo D43); la puerta real es el `422` del servidor.
    body = <div className="flex flex-col gap-5">{backToQuoter}</div>;
  } else {
    body = (
      <>
        {/* Resumen de la venta ANTES de confirmar: qué cartas, cuánto (estimado) y la vigencia del estimado. */}
        <div className="mb-6">
          <p className="eyebrow">{t('summaryTitle')}</p>
          <ul className="mt-3">
            {cart.map((l) => {
              const pending = l.quote.quote.status === 'precio_pendiente';
              const unitCents = l.quote.quote.quotedPriceCents ?? 0;
              return (
                <li key={l.id} className="flex items-baseline justify-between gap-3 border-b border-border py-2 text-sm">
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-text">
                    <span lang="en" className="min-w-0 truncate">
                      {l.card.name}
                    </span>
                    <span className="font-mono text-[10px] text-muted">×{l.quantity}</span>
                    {/* P-14 (§18.5): el mismo FinishMark que en el carrito. */}
                    <FinishMark finish={l.finish} className="translate-y-[1px]" />
                  </span>
                  <span className="tabular shrink-0">
                    {pending ? <BuylistPendingLineLabel /> : formatMoneyCents(unitCents * l.quantity, locale)}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="flex items-baseline justify-between gap-3 pt-3">
            <span className="text-[13px] font-medium text-text">{t('quote.money.cardsValue')}</span>
            {/* §37.1b: la MISMA función que el cajón y la barra. */}
            <CartTotalFigure
              noFreshPrice={noFreshPrice}
              totalEstimatedCents={totalEstimatedCents}
              pendingCardCount={pendingCardCount}
              size="summary"
              testIdScope="sell-request"
            />
          </div>
          {/* §23.3h: el paso de crear también explica su propia aritmética. */}
          <BuylistPendingLinesNote count={pendingCardCount} className="mt-2" />
          <p className="mt-3 font-mono text-[11px] leading-[1.6] text-muted">{t('trustValidity')}</p>
        </div>

        <BuylistKycForm
          items={requestItems}
          minimumRequestCents={minimumRequestCents}
          totalEstimatedCents={totalEstimatedCents}
          pendingCardCount={pendingCardCount}
          ineExpected={sellReq.ineExpected}
          clabeMasked={sellReq.clabeMasked}
          clabeOnFile={sellReq.clabeOnFile}
          ineOnFile={sellReq.ineOnFile}
          kycStatus={sellReq.kyc?.kycStatus}
          rejectionReason={sellReq.kyc?.rejectionReason}
          onCreated={() => {
            setCreated(true);
            clearCart();
            void queryClient.invalidateQueries({ queryKey: ['sell-requests'] });
            // La solicitud pudo registrar la CLABE en KYC → refresca el checklist.
            void queryClient.invalidateQueries({ queryKey: ['kyc'] });
          }}
        />
        <div className="mt-6">{backToQuoter}</div>
      </>
    );
  }

  return (
    <section aria-labelledby={headingId} className="gutter max-w-[720px] pb-14 pt-10 lg:pt-[46px]" data-testid="sell-request-step">
      <h1 id={headingId} className="mb-6 font-serif text-[30px] leading-[1.1] text-text lg:text-[40px]">
        {t('requestTitle')}
      </h1>
      {body}
    </section>
  );
}

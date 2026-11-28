'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import type { SellItemDTO } from '@/types/contract';
import { BuylistBreakdown } from '@/components/domain/BuylistBreakdown';
import { declaredVersion, hasVersionMismatch, receivedVersion, versionName } from '@/lib/buylist-version';
import { formatMoneyCents } from '@/lib/format';

/**
 * §BUYLIST-ES §4.2/§4.4 · lo que ve el vendedor cuando la carta llegó en una versión distinta a la declarada (idioma o
 * liga). Tres desenlaces, TODOS con montos que manda el servidor (el front no calcula ni compara dinero):
 *  - baja pendiente/resuelta (`revision.proposedCents`): «llegó como … nueva oferta X (antes Y)»; los botones aceptar/rechazar
 *    son los de F2c (`SellerFlujoLines`), no se duplican aquí;
 *  - alza (sin propuesta, con `receivedBreakdown`): «Te pagamos X por tu carta (versión)» con `approvedPriceCents`;
 *  - sin precio: «No pudimos valorar esta versión; te recogemos la carta».
 * Siempre «Llegó como …; declaraste …» y el desglose de `receivedBreakdown` (BES-4: nunca un monto de tope).
 */
export function SellerVersionOutcome({ line }: { line: SellItemDTO }) {
  const t = useTranslations('sellerFlujo.version');
  const locale = useLocale() as AppLocale;
  if (!hasVersionMismatch(line)) return null;
  const declared = declaredVersion(line);
  const received = receivedVersion(line);
  const withStamp = declared.stamp != null || received.stamp != null;
  const nameOf = (k: 'en' | 'es' | 'normal' | 'league') => t(`name.${k}`);
  const dName = versionName(declared, nameOf, withStamp);
  const rName = versionName(received, nameOf, withStamp);
  const money = (c: number) => formatMoneyCents(c, locale);
  const rev = line.revision && line.revision.proposedCents != null && line.revision.previousCents != null ? line.revision : null;
  const rb = line.receivedBreakdown ?? null;
  const paid = line.approvedPriceCents ?? rb?.finalOfferCents ?? null;
  let outcome: string;
  let kind: 'lower' | 'higher' | 'unavailable';
  if (rev) {
    kind = 'lower';
    outcome = t('lower', {
      card: line.card.name,
      received: rName,
      declared: dName,
      amount: money(rev.proposedCents!),
      before: money(rev.previousCents!),
    });
  } else if (paid != null) {
    kind = 'higher';
    outcome = t('higher', { amount: money(paid), card: line.card.name, version: rName });
  } else {
    kind = 'unavailable';
    outcome = t('unavailable');
  }
  return (
    <div className="mt-2 flex flex-col gap-1 border-l border-border-strong pl-3 text-[13px]" data-testid={`seller-version-${line.id}`} data-kind={kind}>
      <p className="text-muted" data-testid={`seller-version-arrived-${line.id}`}>
        {t('arrivedAs', { received: rName, declared: dName })}
      </p>
      <p className="text-text" data-testid={`seller-version-outcome-${line.id}`}>
        {outcome}
      </p>
      {kind !== 'unavailable' && <BuylistBreakdown breakdown={rb} audience="client" className="text-[12px]" />}
    </div>
  );
}

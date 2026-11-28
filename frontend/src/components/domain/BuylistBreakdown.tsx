'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import type { BuylistBreakdownDTO } from '@/types/contract';
import { formatMoneyCents } from '@/lib/format';

/**
 * §BUYLIST-ES §3 · desglose de una línea EN EL ORDEN del dueño (HECHOS 2026-11-27): mercado → −idioma →
 * mercado ajustado → % de la curva → oferta. Todo lo manda el servidor (centavos enteros); el front solo lo pinta.
 * Solo existe para líneas con castigo de idioma (`languagePenalty != null`): una línea en inglés ya tiene su
 * mercado y su estándar en otras columnas, así que devuelve `null` y la pantalla queda como hoy.
 *
 * Defensa de coherencia: el importe del castigo se pinta SOLO si cuadra con lo que se ve en pantalla
 * (`mercado + castigo = mercado ajustado`); si el servidor lo expresara sobre otra base, se pinta el % sin cifra
 * en vez de un renglón que no suma.
 */
export function BuylistBreakdown({
  breakdown,
  offerLabel,
  className,
}: {
  breakdown: BuylistBreakdownDTO | null | undefined;
  /** «Te pagamos» (vendedor) u «Oferta» (mesa del dueño). */
  offerLabel?: 'offer' | 'offerAdmin';
  className?: string;
}) {
  const t = useTranslations('buylist.breakdown');
  const locale = useLocale() as AppLocale;
  if (!breakdown || !breakdown.languagePenalty) return null;
  const { languagePenalty: pen } = breakdown;
  const showPenaltyCents = breakdown.marketMxnCents + pen.cents === breakdown.adjustedMarketCents;
  const money = (c: number) => formatMoneyCents(c, locale);
  const rows: { key: string; label: string; value: string; strong?: boolean }[] = [
    { key: 'market', label: t('market'), value: money(breakdown.marketMxnCents) },
    {
      key: 'language',
      label: t('language', { pct: pen.pct }),
      value: showPenaltyCents ? money(pen.cents) : '',
    },
    { key: 'adjusted', label: t('adjusted'), value: money(breakdown.adjustedMarketCents) },
    { key: 'base', label: t('base', { pct: breakdown.basePct }), value: '' },
    {
      key: 'offer',
      label: t(offerLabel ?? 'offer'),
      value: money(breakdown.finalOfferCents),
      strong: true,
    },
  ];
  return (
    <dl
      aria-label={t('title')}
      data-testid="buylist-breakdown"
      className={className ?? 'mt-2 border-l border-border-strong pl-3 text-[12px]'}
    >
      {rows.map((r) => (
        <div key={r.key} data-row={r.key} className="flex items-baseline justify-between gap-3 py-0.5">
          <dt className="text-muted">{r.label}</dt>
          <dd className={`tabular font-mono ${r.strong ? 'font-medium text-text' : 'text-muted'}`}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

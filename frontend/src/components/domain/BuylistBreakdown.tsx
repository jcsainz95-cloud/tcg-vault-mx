'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import type { BuylistBreakdownDTO } from '@/types/contract';
import { formatMoneyCents } from '@/lib/format';

/**
 * §BUYLIST-ES §3 · desglose de una línea EN EL ORDEN del dueño (HECHOS 2026-11-27): mercado → −idioma →
 * mercado ajustado → curva (monto del servidor) → tope → oferta. Todo lo manda el servidor (centavos enteros); el front solo lo pinta.
 * Solo existe para líneas con castigo de idioma (`languagePenalty != null`): una línea en inglés ya tiene su
 * mercado y su estándar en otras columnas, así que devuelve `null` y la pantalla queda como hoy.
 * El contrato garantiza que `mercado + castigo = ajustado`, así que el importe del castigo se pinta siempre.
 */
/** §BUYLIST-ES §3.2 · % informativo de la curva (puntos base → %): 2 decimales y «≈ » si no es entero. Mismo texto en mesa y desglose. */
export function formatCurvePct(bp: number, locale: AppLocale): string {
  return `${bp % 100 === 0 ? '' : '≈ '}${(bp / 100).toLocaleString(locale === 'es' ? 'es-MX' : 'en-US', { maximumFractionDigits: 2 })}`;
}

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
  const te = useTranslations('buylist.es');
  const locale = useLocale() as AppLocale;
  if (!breakdown || !breakdown.languagePenalty || breakdown.source === 'pending') return null;
  const { languagePenalty: pen } = breakdown;
  const money = (c: number) => formatMoneyCents(c, locale);
  const bp = breakdown.curveBp;
  // Presentación del % (puntos base del servidor → %); no es dinero.
  const pctText = bp == null ? '' : formatCurvePct(bp, locale);
  const override = breakdown.source === 'override';
  // §3.3 M6: con precio fijo la cadena es «Precio fijo · Idioma −P % · Te pagamos» (sin Mercado, Ajustado ni Curva).
  const rows: { key: string; label: string; value: string; strong?: boolean }[] = override
    ? [
        { key: 'fixed', label: te('fixedPrice'), value: money(breakdown.marketMxnCents) },
        {
          key: 'language',
          label: t('language', { pct: pen.pct }),
          value: `−${money(Math.abs(pen.cents))}`,
        },
      ]
    : [
        { key: 'market', label: t('market'), value: money(breakdown.marketMxnCents) },
        {
          key: 'language',
          label: t('language', { pct: pen.pct }),
          // Signo «−» (U+2212) igual que la etiqueta; el contrato manda el castigo negativo, se pinta su magnitud.
          value: `−${money(Math.abs(pen.cents))}`,
        },
        { key: 'adjusted', label: t('adjusted'), value: money(breakdown.adjustedMarketCents) },
        {
          key: 'base',
          // `curveBp` puede venir `null`: la fila se pinta sin cifra, nunca «null %».
          label: bp == null ? t('baseNone') : t('base', { pct: pctText }),
          value: breakdown.curveOfferCents != null ? money(breakdown.curveOfferCents) : '—',
        },
      ];
  if (breakdown.cap) {
    rows.push({
      key: 'cap',
      label: t(breakdown.cap.reason === 'floor' ? 'capFloor' : 'capEn'),
      value: money(breakdown.cap.cents),
    });
  }
  rows.push({
    key: 'offer',
    label: t(offerLabel ?? 'offer'),
    value: money(breakdown.finalOfferCents),
    strong: true,
  });
  return (
    <dl
      aria-label={t('title')}
      data-testid="buylist-breakdown"
      className={className ?? 'mt-2 border-l border-border-strong pl-3 text-[12px]'}
    >
      {rows.map((r) => (
        <div key={r.key} data-row={r.key} className="flex items-baseline justify-between gap-x-3 py-0.5">
          <dt className="min-w-0 text-muted">{r.label}</dt>
          <dd className={`tabular shrink-0 whitespace-nowrap font-mono ${r.strong ? 'font-medium text-text' : 'text-muted'}`}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

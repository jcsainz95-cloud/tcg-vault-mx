'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getPublicBounties } from '@/lib/api';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { Link } from '@/i18n/navigation';

const MAX_ROWS = 5;

/**
 * «Lo que más buscamos hoy» (makeover 1a §7): tabla de bounties públicos. CONDICIONAL:
 * solo se renderiza si GET /buylist/bounties regresa elementos (misma regla de honestidad
 * que TopBountiesShelf: sin bounties o con error, la sección desaparece — es vitrina).
 * «Pagamos» = bountyPriceCents del server; «Buscadas» = remainingQty/targetQty reales.
 * Condición: la buylist solo compra NM (política global del contrato), por eso la
 * columna pinta la constante honesta "NM" — no existe condición por-bounty en el DTO.
 */
export function BountyBoard() {
  const t = useTranslations('home');
  const locale = useLocale() as AppLocale;

  const bounties = useQuery({
    queryKey: ['public-bounties'],
    queryFn: getPublicBounties,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const rows = (bounties.data?.data ?? []).slice(0, MAX_ROWS);
  if (bounties.isLoading || bounties.isError || rows.length === 0) return null;

  return (
    <section className="border-t border-border" aria-label={t('bounties.title')}>
      <div className="gutter flex items-baseline justify-between gap-4 pb-2 pt-10 lg:pt-12">
        <h2 className="font-serif text-[22px] leading-tight text-text lg:text-[29px]">
          {t('bounties.title')}
        </h2>
        <Link
          href="/buylist"
          className="text-[11px] font-medium uppercase tracking-label text-muted hover:text-text"
        >
          {t('bounties.viewAll')}
        </Link>
      </div>
      <p className="gutter max-w-[520px] pb-5 text-sm leading-[1.6] text-muted">
        {t('bounties.subtitle')}
      </p>

      <div className="gutter pb-12 lg:pb-14">
        <div className="hidden grid-cols-[2fr_1fr_1fr_1fr] gap-5 border-b border-border-strong pb-2.5 sm:grid">
          <span className="eyebrow">{t('bounties.colCard')}</span>
          <span className="eyebrow">{t('bounties.colCondition')}</span>
          <span className="eyebrow text-right">{t('bounties.colWePay')}</span>
          <span className="eyebrow text-right">{t('bounties.colWanted')}</span>
        </div>
        {rows.map((b) => {
          const wanted = b.remainingQty ?? b.targetQty;
          return (
            <div
              key={`${b.cardId}:${b.finish}`}
              className="grid grid-cols-[1fr_auto] items-baseline gap-x-5 border-b border-border py-[15px] sm:grid-cols-[2fr_1fr_1fr_1fr]"
            >
              <span lang="en" className="min-w-0 font-serif text-[15px] leading-snug text-text lg:text-[17px]">
                {b.name} · {b.setName} #{b.number}
              </span>
              <span className="hidden font-mono text-xs text-muted sm:block">
                {t('bounties.conditionNm')}
              </span>
              <span className="tabular text-right font-mono text-[14px] text-text lg:text-[15px]">
                {formatMoneyCents(b.bountyPriceCents, locale)}
              </span>
              <span className="tabular hidden text-right font-mono text-xs text-muted sm:block">
                {wanted != null ? wanted : '—'}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

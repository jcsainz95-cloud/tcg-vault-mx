'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getPublicBounties } from '@/lib/api';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { Shelf } from '../_shared/Shelf';

const MAX_ROWS = 5;

/**
 * «Lo que más buscamos hoy» (makeover 1a §7): tabla de bounties públicos. CONDICIONAL:
 * solo se renderiza si GET /buylist/bounties regresa elementos (misma regla de honestidad
 * que TopBountiesShelf: sin bounties o con error, la sección desaparece — es vitrina).
 * «Pagamos» = bountyPriceCents del server. NO se expone la cantidad buscada/restante al
 * cliente (fuga de inventario/demanda): la columna «Buscadas» se retiró intencionalmente.
 * Condición: la buylist solo compra NM (política global del contrato), por eso la
 * columna pinta la constante honesta "NM" — no existe condición por-bounty en el DTO.
 *
 * Semántica de tabla (§20.7): grid con `role="table"`/`row`/`columnheader`/`cell`
 * (la retícula visual responsiva se mantiene; el orden de lectura coincide).
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
    <Shelf
      title={t('bounties.title')}
      subtitle={t('bounties.subtitle')}
      subtitleClassName="max-w-[520px] pb-5"
      className="border-t border-border"
      headerClassName="pb-2 pt-10 lg:pt-12"
      viewAllHref="/buylist"
      viewAllLabel={t('bounties.viewAll')}
    >
      <div className="gutter pb-12 lg:pb-14">
        <div role="table" aria-label={t('bounties.title')}>
          <div
            role="row"
            className="hidden grid-cols-[2fr_1fr_1fr] gap-5 border-b border-border-strong pb-2.5 sm:grid"
          >
            <span role="columnheader" className="eyebrow">
              {t('bounties.colCard')}
            </span>
            <span role="columnheader" className="eyebrow">
              {t('bounties.colCondition')}
            </span>
            <span role="columnheader" className="eyebrow text-right">
              {t('bounties.colWePay')}
            </span>
          </div>
          {rows.map((b) => {
            return (
              <div
                key={`${b.cardId}:${b.finish}`}
                role="row"
                className="grid grid-cols-[1fr_auto] items-baseline gap-x-5 border-b border-border py-[15px] sm:grid-cols-[2fr_1fr_1fr]"
              >
                <span
                  role="cell"
                  lang="en"
                  className="min-w-0 font-serif text-[15px] leading-snug text-text lg:text-[17px]"
                >
                  {b.name} · {b.setName} #{b.number}
                </span>
                <span role="cell" className="hidden font-mono text-xs text-muted sm:block">
                  {t('bounties.conditionNm')}
                </span>
                <span role="cell" className="tabular text-right font-mono text-[14px] text-text lg:text-[15px]">
                  {formatMoneyCents(b.bountyPriceCents, locale)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </Shelf>
  );
}

'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getPublicBounties } from '@/lib/api';
import type { PublicBountyDTO } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import { FinishBand } from '@/components/domain/FinishMark';
import { HuntMarkMicro } from '@/components/domain/LogoTcgHunt';
import { Shelf } from '../_shared/Shelf';

const MAX_TILES = 4;

/**
 * «Top Bounties» (home): vitrina de bounties públicos con IMAGEN de la carta, consistente con
 * la de /buylist (TopBountiesShelf). CONDICIONAL: solo se renderiza si GET /buylist/bounties
 * regresa elementos (misma regla de honestidad que TopBountiesShelf: sin bounties o con error,
 * la sección desaparece — es vitrina). «Pagamos» = bountyPriceCents del server.
 *
 * NO se expone la cantidad buscada/restante al cliente (fuga de inventario/demanda): la tarjeta
 * NO pinta remainingQty/targetQty (se retiró intencionalmente en e3f76e2/df50e60).
 *
 * Reutiliza el patrón visual de la tarjeta de bounty de TopBountiesShelf (FinishBand + imagen +
 * chip ☩ BOUNTY + nombre + set·número + precio héroe «Pagamos»), pero como es la home cada
 * tarjeta es un Link a /buylist (no lleva el CTA «Cotizar esta carta», que necesita el cotizador
 * de BuylistView) y el estante conserva su marco (título + «ver todo»).
 */
export function BountyBoard() {
  const t = useTranslations('home');

  const bounties = useQuery({
    queryKey: ['public-bounties'],
    queryFn: getPublicBounties,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const tiles = (bounties.data?.data ?? []).slice(0, MAX_TILES);
  if (bounties.isLoading || bounties.isError || tiles.length === 0) return null;

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
      <div className="gutter grid grid-cols-2 gap-6 pb-12 lg:grid-cols-4 lg:gap-8 lg:pb-14">
        {tiles.map((b) => (
          <BountyTile key={`${b.cardId}:${b.finish}`} bounty={b} />
        ))}
      </div>
    </Shelf>
  );
}

/**
 * Tarjeta de bounty de la home: mismo lenguaje visual que TopBountiesShelf.BountyCard, envuelta
 * en un Link a /buylist. NO revela remainingQty/targetQty.
 */
function BountyTile({ bounty }: { bounty: PublicBountyDTO }) {
  const t = useTranslations('home');
  const locale = useLocale() as AppLocale;

  return (
    <Link href="/buylist" className="flex h-full flex-col">
      <FinishBand finish={bounty.finish} />
      <div className="relative aspect-[5/7] w-full bg-surface-2">
        {bounty.imageSmallUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bounty.imageSmallUrl}
            alt={bounty.name}
            loading="lazy"
            className="h-full w-full object-contain"
          />
        )}
        {/* Chip con scrim de tinta (§7.2b): texto papel sobre tinta. */}
        <span className="absolute left-1 top-1 flex items-center gap-1 bg-[color:var(--color-ink)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-on-ink)]">
          <HuntMarkMicro size={12} /> {t('bounties.badge')}
        </span>
      </div>
      <p lang="en" className="mt-2.5 line-clamp-2 font-serif text-[15px] leading-tight text-text">
        {bounty.name}
      </p>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-muted">
        <span lang="en">{bounty.setName}</span>
        <span aria-hidden> · </span>
        <span className="tabular-nums">#{bounty.number}</span>
      </p>
      {/* Precio héroe: dinero que TE pagamos → verde (semántica "positivo"). */}
      <p className="mt-2 flex flex-col">
        <span className="text-xs text-muted">{t('bounties.wePay')}</span>
        <span className="font-mono text-lg font-semibold tabular-nums text-success">
          {formatMoneyCents(bounty.bountyPriceCents, locale)}
        </span>
      </p>
    </Link>
  );
}

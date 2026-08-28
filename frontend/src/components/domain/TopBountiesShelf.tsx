'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getPublicBounties } from '@/lib/api';
import type { PublicBountyDTO } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { FinishBand } from '@/components/domain/FinishMark';
import { HuntMarkMicro } from '@/components/domain/LogoTcgHunt';

/**
 * «Top Bounties» — P-22 (DESIGN_SYSTEM §16.7c). Vitrina pública ARRIBA de /buylist, antes del
 * selector de set. Consume GET /buylist/bounties (cap 50; se pintan las primeras 12).
 * Reglas de honestidad: sin bounties activos la sección NO se renderiza (nunca un shelf vacío);
 * en error se OCULTA (es vitrina, no bloquea el flujo de venta). La cantidad restante NO se
 * muestra al cliente (no revelar cuántas piezas se compran). El pago sigue siendo tras recibir
 * y verificar (PAY_AFTER_RECEIPT).
 */
export function TopBountiesShelf({
  onQuote,
}: {
  /** CTA «Cotizar esta carta»: precarga la carta/variante en el cotizador (dueño: BuylistView). */
  onQuote?: (bounty: PublicBountyDTO) => void;
}) {
  const t = useTranslations('buylist.bounties');

  const bounties = useQuery({
    queryKey: ['public-bounties'],
    queryFn: getPublicBounties,
    staleTime: 5 * 60_000,
    retry: false,
  });

  // Error = se oculta la sección; vacía = no se renderiza.
  if (bounties.isError) return null;
  if (bounties.data && bounties.data.data.length === 0) return null;

  const items = bounties.data?.data.slice(0, 12);

  return (
    <section className="gutter border-b border-border pb-8 pt-7" aria-label={t('title')}>
      <p className="eyebrow">{t('eyebrow')}</p>
      <h2 className="mt-2 font-serif text-[24px] leading-tight text-text lg:text-[30px]">
        {t('title')}
      </h2>
      <p className="mt-2 max-w-[560px] text-sm leading-relaxed text-muted">{t('subtitle')}</p>

      {bounties.isLoading ? (
        <div className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-3">
              <Skeleton className="aspect-[5/7] w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-6 w-1/2" />
            </div>
          ))}
        </div>
      ) : (
        <ul className="-mx-1 mt-6 flex snap-x gap-6 overflow-x-auto px-1 pb-2 lg:grid lg:grid-cols-4 lg:overflow-visible">
          {items?.map((b) => (
            <li key={`${b.cardId}:${b.finish}`} className="w-44 shrink-0 snap-start lg:w-auto">
              <BountyCard bounty={b} onQuote={onQuote} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Tarjeta de bounty (variante del CardTile §7.1): chip ☩ BOUNTY sobre scrim de tinta + precio héroe. */
export function BountyCard({
  bounty,
  onQuote,
}: {
  bounty: PublicBountyDTO;
  onQuote?: (bounty: PublicBountyDTO) => void;
}) {
  const t = useTranslations('buylist.bounties');
  const locale = useLocale() as AppLocale;

  return (
    <article className="flex h-full flex-col">
      <FinishBand finish={bounty.finish} />
      <div className="relative aspect-[5/7] w-full bg-surface-2">
        {bounty.imageSmallUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bounty.imageSmallUrl}
            alt=""
            aria-hidden
            loading="lazy"
            className="h-full w-full object-contain"
          />
        )}
        {/* Chip con scrim de tinta (§7.2b): texto papel sobre tinta (~15:1). */}
        <span className="absolute left-1 top-1 flex items-center gap-1 bg-[color:var(--color-ink)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-on-ink)]">
          {/* Glifo micro oficial de la mira (§16.7b armonizado con §17.1d). */}
          <HuntMarkMicro size={12} /> {t('badge')}
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
        <span className="text-xs text-muted">{t('wePay')}</span>
        <span className="font-mono text-lg font-semibold tabular-nums text-success">
          {formatMoneyCents(bounty.bountyPriceCents, locale)}
        </span>
      </p>
      {/* La cantidad restante NO se revela al cliente en la vitrina pública (decisión del
          dueño: no exponer cuántas piezas se están comprando). El dato sigue en el DTO y en
          la consola de admin. */}
      <div className="mt-auto pt-3">
        <Button variant="secondary" size="sm" className="w-full" onClick={() => onQuote?.(bounty)}>
          {t('cta')}
        </Button>
      </div>
    </article>
  );
}

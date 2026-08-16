'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getCardDetail } from '@/lib/api';
import type { CardDTO, ListingDTO } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatDate, formatMoneyCents } from '@/lib/format';
import { useCart } from '@/lib/cart';
import { Link } from '@/i18n/navigation';
import { CardImage } from '@/components/ui/CardImage';
import { ListingSpec } from '@/components/domain/ListingSpec';
import { CertNumberField } from '@/components/ui/CertNumberField';
import { Button } from '@/components/ui/Button';
import { QueryState } from '@/components/ui/QueryState';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';

export function CardDetailView({ cardId }: { cardId: string }) {
  const cart = useCart();
  const [tab, setTab] = useState<'description' | 'condition'>('description');

  const query = useQuery({ queryKey: ['card', cardId], queryFn: () => getCardDetail(cardId) });

  return (
    <QueryState
      isLoading={query.isLoading}
      isError={query.isError}
      error={query.error}
      onRetry={() => query.refetch()}
      loading={
        <div className="gutter grid gap-10 py-14 lg:grid-cols-2">
          <Skeleton className="aspect-[5/7] w-full max-w-sm" />
          <div className="flex flex-col gap-4">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-32 w-full" />
          </div>
        </div>
      }
    >
      {query.data && (
        <Detail
          card={query.data.card}
          listings={query.data.listings}
          tab={tab}
          setTab={setTab}
          onAdd={(l) => cart.add(l.inventoryItemId)}
        />
      )}
    </QueryState>
  );
}

/** Celda de la ficha: etiqueta mono arriba, dato debajo, reglas alrededor. */
function Fact({
  label,
  children,
  note,
  className,
}: {
  label: string;
  children: React.ReactNode;
  note?: string;
  className?: string;
}) {
  return (
    <div className={cn('border-b border-border py-6', className)}>
      <div className="eyebrow">{label}</div>
      <div className="mt-2.5">{children}</div>
      {note && <div className="mt-2 font-mono text-[11px] leading-none text-muted">{note}</div>}
    </div>
  );
}

/**
 * 6b — La carta ocupa media pantalla contra papel; a la derecha, la ficha en dos
 * columnas de datos, la explicación de referencia vs. venta como nota al margen y
 * los ejemplares disponibles como renglones de catálogo, no como tarjetas.
 */
function Detail({
  card,
  listings,
  tab,
  setTab,
  onAdd,
}: {
  card: CardDTO;
  listings: ListingDTO[];
  tab: 'description' | 'condition';
  setTab: (v: 'description' | 'condition') => void;
  onAdd: (l: ListingDTO) => void;
}) {
  const t = useTranslations('card');
  const tcat = useTranslations('catalog');
  const tFinish = useTranslations('finish');
  const tc = useTranslations('common');
  const tprice = useTranslations('price');
  const locale = useLocale() as AppLocale;
  const primary = listings[0];

  // La ficha ya no tiene pestaña "Fotos" (v1.2): imagen de catálogo remota, sin fotos propias.
  const tabs = [
    { key: 'description' as const, label: t('tabDescription') },
    { key: 'condition' as const, label: t('tabCondition') },
  ];

  const captured = primary?.referenceValue.capturedDate
    ? formatDate(primary.referenceValue.capturedDate, locale)
    : undefined;

  return (
    <div>
      <nav
        aria-label="Breadcrumb"
        className="gutter flex items-center gap-3 border-b border-border py-5 font-mono text-xs tracking-[0.06em] text-muted"
      >
        <Link href="/catalog" className="hover:text-text">
          {t('backToCatalog')}
        </Link>
        <span aria-hidden>›</span>
        <span className="text-text" aria-current="page" lang="en">
          {card.name}
        </span>
      </nav>

      <div className="grid lg:grid-cols-2">
        {/* El arte contra su pozo de papel, a media pantalla. */}
        <div className="flex items-center justify-center border-b border-border bg-surface-2 px-6 py-10 lg:border-b-0 lg:border-r lg:px-11 lg:py-14">
          {/* imagen de catálogo remota de pokemontcg.io (v1.2, sin fotos propias) */}
          <CardImage src={card.imageLargeUrl} alt={card.name} className="w-full max-w-[420px] bg-transparent p-0" />
        </div>

        <div className="gutter py-10 lg:py-14">
          <h1 className="font-serif text-[32px] leading-[1.05] text-text lg:text-[46px]" lang="en">
            {card.name}
          </h1>
          <p className="mt-3 font-mono text-xs uppercase tracking-[0.1em] text-muted" lang="en">
            {card.setName} · #{card.number} · {card.rarity}
          </p>

          {primary && (
            <>
              {/* Ficha en dos columnas: precio de venta contra valor de mercado. */}
              <div className="mt-9 grid border-t border-border sm:grid-cols-2">
                <Fact label={tcat('salePrice')} note={tc('withoutIva')}>
                  <span className="tabular text-3xl font-medium leading-none text-text">
                    {primary.salePriceCents != null
                      ? formatMoneyCents(primary.salePriceCents, locale)
                      : tcat('notForSale')}
                  </span>
                </Fact>
                <Fact
                  label={tcat('marketValue')}
                  note={captured}
                  className="sm:border-l sm:pl-7"
                >
                  <span className="tabular text-3xl font-medium leading-none text-text">
                    {primary.referenceValue.referenceMxnCents != null
                      ? formatMoneyCents(primary.referenceValue.referenceMxnCents, locale)
                      : '—'}
                  </span>
                </Fact>
                <Fact label={t('condition')}>
                  <span className="text-base text-text">
                    {primary.productType === 'raw'
                      ? tcat('condition.nm.label')
                      : primary.productType === 'graded'
                        ? `${primary.gradingCompany ?? ''} ${primary.gradeValue ?? ''}`.trim()
                        : t('productType.sealed')}
                  </span>
                </Fact>
                <Fact label={tFinish('label')} className="sm:border-l sm:pl-7">
                  <span className="text-base text-text">{tFinish(primary.finish)}</span>
                </Fact>
              </div>

              {/* Gradeada: certificado verificable (§7.2c) — texto copiable, sin inventar URL */}
              {primary.productType === 'graded' && primary.certNumber && (
                <div className="mt-6">
                  <CertNumberField certNumber={primary.certNumber} />
                </div>
              )}
            </>
          )}

          <p className="rule-note mt-7 text-[13px] leading-[1.65] text-muted">{t('referenceExplainer')}</p>

          {/* Ejemplares disponibles: renglones de catálogo, no tarjetas. */}
          <h2 className="mt-10 font-serif text-[22px] leading-tight text-text">{t('instances')}</h2>
          <div className="mt-4 border-t border-border">
            {listings.map((l) => (
              <div
                key={l.inventoryItemId}
                className="flex flex-wrap items-center justify-between gap-4 border-b border-border py-4"
              >
                <div className="min-w-0">
                  {/* v1.6-finish: cada ejemplar puede diferir en acabado (listings separados). */}
                  <ListingSpec
                    productType={l.productType}
                    rawCondition={l.rawCondition}
                    sealedSubtype={l.sealedSubtype}
                    finish={l.finish}
                    gradingCompany={l.gradingCompany}
                    gradeValue={l.gradeValue}
                    certNumber={l.certNumber}
                    className={l.sellable ? undefined : 'text-muted'}
                  />
                  <div className="mt-2">
                    {l.salePriceCents != null ? (
                      <span className="tabular text-[17px] font-medium leading-none text-text">
                        {formatMoneyCents(l.salePriceCents, locale)}
                      </span>
                    ) : (
                      <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-accent">
                        {tprice('pendingLabel')} · {tprice('pendingHint')}
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  variant={l.sellable ? 'primary' : 'secondary'}
                  size="sm"
                  disabled={!l.sellable}
                  onClick={() => onAdd(l)}
                >
                  {l.sellable ? tcat('buyNow') : tcat('notForSale')}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Pestañas: subrayado bermellón, sin caja ni relleno. */}
      <div className="gutter border-t border-border pb-16 pt-0">
        <div role="tablist" className="flex gap-8 border-b border-border">
          {tabs.map((tb) => (
            <button
              key={tb.key}
              role="tab"
              aria-selected={tab === tb.key}
              onClick={() => setTab(tb.key)}
              className={cn(
                'py-5 text-xs font-medium uppercase tracking-label',
                tab === tb.key
                  ? 'text-text shadow-[inset_0_-1px_0_var(--color-accent)]'
                  : 'text-muted hover:text-text',
              )}
            >
              {tb.label}
            </button>
          ))}
        </div>
        <div className="max-w-[720px] pt-6 text-[15px] leading-[1.7] text-muted">
          {tab === 'description' && (
            <p lang="en">
              {card.supertype} — {card.subtypes.join(', ')} · {card.setName}
            </p>
          )}
          {tab === 'condition' &&
            (primary?.productType === 'raw' ? (
              <div className="flex flex-col gap-2">
                <p className="font-medium text-text">
                  {t('condition')}: {tcat('condition.nm.label')}
                </p>
                <p>{tcat('condition.nm.desc')}</p>
              </div>
            ) : primary?.productType === 'graded' ? (
              // Gradeada: el slab (empresa+grado+cert) es la garantía; sin foto (§7.2c).
              <div className="flex flex-col gap-3">
                <p className="font-medium text-text">
                  {t('gradedGuarantee', {
                    company: primary.gradingCompany ?? '',
                    grade: primary.gradeValue ?? '',
                  })}
                </p>
                {primary.certNumber && <CertNumberField certNumber={primary.certNumber} />}
              </div>
            ) : (
              <p>
                {t('condition')}: {primary?.sealedSubtype ?? '—'}
              </p>
            ))}
        </div>
      </div>
    </div>
  );
}

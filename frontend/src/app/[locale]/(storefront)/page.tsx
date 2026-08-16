'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getCatalog, getHoldings } from '@/lib/api';
import type { AppLocale } from '@/i18n/routing';
import type { HoldingDTO } from '@/types/contract';
import { formatMoneyCents } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Link } from '@/i18n/navigation';
import { CardImage } from '@/components/ui/CardImage';
import { PortfolioGlance } from '@/components/domain/PortfolioTrendChart';
import { Skeleton } from '@/components/ui/Skeleton';

const FEATURED = 4;

/**
 * Home en la dirección 5a: la home no vende, informa. Abre con la promesa y el
 * valor de tu bóveda —cifra, tendencia y reparto por set— y solo después enseña
 * catálogo. Etiquetas verticales al margen, reglas finísimas y un solo bermellón.
 *
 * Dos piezas del mockup NO se implementaron porque el contrato no las respalda y
 * fabricarlas sería inventar datos de mercado:
 *  - el ticker de movimientos por carta (no hay variación por carta en el contrato,
 *    solo `change` del portafolio completo en /vault/portfolio/history);
 *  - el "avance de sets" 89/102 (CardSetDTO no expone cuántas cartas tiene un set).
 * En su lugar, el panel reparte el valor por set, que sí se deriva de holdings.
 * Si el backend expone esos datos, aquí es donde entran.
 */
export default function HomePage() {
  const t = useTranslations('home');
  const tv = useTranslations('vault');
  const tc = useTranslations('common');
  const tn = useTranslations('nav');
  const locale = useLocale() as AppLocale;
  const { isAuthenticated, ready } = useSession();
  const authed = ready && isAuthenticated;

  const holdings = useQuery({ queryKey: ['holdings'], queryFn: getHoldings, enabled: authed });
  const catalog = useQuery({ queryKey: ['catalog', { home: true }], queryFn: () => getCatalog({}) });

  // Valor por set del portafolio: misma derivación que en Mi bóveda (suma de
  // referenceMxnCents por set; las pendientes sin valor no aportan).
  const setValues = useMemo(() => {
    const byId = new Map<string, { setId: string; setName: string; valueCents: number }>();
    for (const h of (holdings.data?.data ?? []) as HoldingDTO[]) {
      const g = byId.get(h.card.setId) ?? { setId: h.card.setId, setName: h.card.setName, valueCents: 0 };
      g.valueCents += h.referenceValue.referenceMxnCents ?? 0;
      byId.set(h.card.setId, g);
    }
    const rows = [...byId.values()].sort((a, b) => b.valueCents - a.valueCents).slice(0, 3);
    const max = rows[0]?.valueCents ?? 0;
    return rows.map((r) => ({ ...r, share: max > 0 ? r.valueCents / max : 0 }));
  }, [holdings.data]);

  const featured = (catalog.data?.data ?? []).filter((l) => l.sellable).slice(0, FEATURED);

  return (
    <div>
      <div className="grid lg:grid-cols-[56px_1fr_1fr]">
        {/* Etiqueta vertical al margen: marca la sección sin un fondo de color. */}
        <div className="hidden justify-center border-r border-border py-9 lg:flex">
          <span aria-hidden className="vertical-label text-xs uppercase text-muted">
            {t('vaultLabel')}
          </span>
        </div>

        <div className="gutter border-b border-border py-14 lg:border-b-0 lg:border-r lg:px-12 lg:py-[88px]">
          <h1 className="font-serif text-[34px] leading-[1.24] tracking-[-0.005em] text-text lg:text-[58px] lg:leading-[1.14]">
            {t('heroTitle')}
          </h1>
          <p className="mt-5 max-w-[460px] text-base leading-[1.75] text-muted lg:mt-7">
            {t('heroSubtitle')}
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-7 lg:mt-12">
            <Link
              href="/catalog"
              className="inline-flex h-[54px] items-center justify-center bg-primary px-8 text-xs font-medium uppercase tracking-[0.18em] text-primary-fg hover:bg-primary-hover"
            >
              {t('ctaCatalog')}
            </Link>
            <Link
              href="/buylist"
              className="inline-flex h-[54px] items-center justify-center border border-text px-8 text-xs font-medium uppercase tracking-[0.18em] text-text sm:h-auto sm:border-0 sm:border-b sm:border-accent sm:px-0 sm:pb-1.5"
            >
              {t('ctaBuylist')}
            </Link>
          </div>
        </div>

        {/* Panel de bóveda: cifras reales del portafolio, o la promesa si no hay sesión. */}
        <div className="flex flex-col border-b border-border">
          <div className="gutter flex items-center justify-between border-b border-border py-3.5">
            <span className="eyebrow">{t('yourVault')}</span>
            <span className="eyebrow">MXN · {tc('withoutIva')}</span>
          </div>

          {authed ? (
            <>
              <div className="gutter border-b border-border py-9">
                <PortfolioGlance fallbackCents={holdings.data?.portfolio.totalValueMxnCents} />
              </div>
              <div className="gutter py-7">
                <div className="eyebrow">{tv('valueBySet')}</div>
                <div className="mt-5 flex flex-col gap-5">
                  {holdings.isLoading && <Skeleton className="h-16 w-full" />}
                  {setValues.map((s) => (
                    <div key={s.setId}>
                      <div className="flex justify-between text-[13px] text-text">
                        <span lang="en">{s.setName}</span>
                        <span className="tabular font-mono text-[11px] text-muted">
                          {formatMoneyCents(s.valueCents, locale)}
                        </span>
                      </div>
                      {/* La regla mide la proporción del set frente al de mayor valor. */}
                      <div className="mt-2.5 h-px bg-border-strong">
                        <div
                          className="h-px bg-text"
                          style={{ width: `${Math.round(s.share * 100)}%` }}
                          aria-hidden
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="gutter flex flex-1 flex-col py-9">
              {[t('trustAuth'), t('trustCustody'), t('trustPrice')].map((line, i) => (
                <p
                  key={i}
                  className="border-b border-border py-4 text-[15px] leading-relaxed text-text first:pt-0 last:border-b-0"
                >
                  {line}
                </p>
              ))}
              {/* mt-auto ancla la invitación al pie de la columna: sin sesión el panel
                  se queda corto frente al hero y colgaba en el aire. */}
              <Link
                href="/login"
                className="mt-auto self-start border-b border-accent pb-1.5 pt-8 text-xs font-medium uppercase tracking-label text-text"
              >
                {tn('login')}
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Catálogo después de los números: la numeración en bermellón ordena la lectura. */}
      <div className="gutter flex flex-col gap-3 pb-6 pt-14 sm:flex-row sm:items-baseline sm:justify-between lg:pt-16">
        <h2 className="font-serif text-2xl leading-tight text-text lg:text-[30px]">
          {t('featuredTitle')}
        </h2>
        <Link
          href="/catalog"
          className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted hover:text-text"
        >
          {t('viewAllCatalog')}
        </Link>
      </div>
      <div className="gutter grid grid-cols-2 gap-6 pb-16 lg:grid-cols-4 lg:gap-10 lg:pb-20">
        {catalog.isLoading &&
          Array.from({ length: FEATURED }).map((_, i) => (
            <Skeleton key={i} className="aspect-[5/7] w-full" />
          ))}
        {featured.map((l, i) => (
          <Link key={l.inventoryItemId} href={`/catalog/${l.card.id}`} className="block">
            <CardImage src={l.card.imageSmallUrl} alt={l.card.name} />
            <div className="mt-4 flex items-baseline gap-2">
              <span className="font-mono text-[10px] leading-none text-accent">
                {String(i + 1).padStart(2, '0')}
              </span>
              <p className="font-serif text-base font-medium leading-snug text-text" lang="en">
                {l.card.name}
              </p>
            </div>
            <p className="mt-1.5 font-mono text-[11px] leading-snug text-muted" lang="en">
              {l.card.setName} · #{l.card.number}
            </p>
            <p className="tabular mt-3 text-[17px] font-medium leading-none text-text">
              {l.salePriceCents != null ? formatMoneyCents(l.salePriceCents, locale) : '—'}
            </p>
          </Link>
        ))}
      </div>

      {/* Banda de tinta: el buylist cierra la home con el único botón bermellón. */}
      <div className="grid bg-ink lg:grid-cols-[56px_1fr_auto] lg:items-center">
        <div className="hidden justify-center self-stretch border-r border-on-ink-rule py-9 lg:flex">
          <span aria-hidden className="vertical-label text-xs uppercase text-on-ink-muted">
            {t('buylistLabel')}
          </span>
        </div>
        <div className="gutter py-12 lg:px-12 lg:py-14">
          <h2 className="font-serif text-[26px] leading-tight text-on-ink lg:text-[34px]">
            {t('sellTitle')}
          </h2>
          <p className="mt-4 max-w-[460px] text-[15px] leading-[1.7] text-on-ink-nav">{t('sellBody')}</p>
        </div>
        <div className="gutter pb-12 lg:px-12 lg:py-14">
          <Link
            href="/buylist"
            className="inline-flex h-[54px] items-center justify-center whitespace-nowrap bg-accent px-8 text-xs font-medium uppercase tracking-[0.18em] text-accent-fg hover:brightness-95"
          >
            {t('sellCta')}
          </Link>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getCatalogFacets, getHoldings } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Link } from '@/i18n/navigation';
import { PortfolioGlance } from '@/components/domain/PortfolioTrendChart';
import { EditorialLink } from './_shared/EditorialLink';
import { useHomeQuoter, HomeQuoterPanel } from './_home/HomeQuoter';
import { FeaturedCarousel } from './_home/FeaturedCarousel';
import { SealedShelf } from './_home/SealedShelf';
import { GradedShelf } from './_home/GradedShelf';
import { BountyBoard } from './_home/BountyBoard';

/**
 * Home del storefront — makeover 1a «Conservadora» (papel y tinta, rojo con avaricia).
 * Orden del artboard: hero + cotizador → piezas destacadas → sellado → gradeadas →
 * bounties (condicional) → cómo funciona la bóveda → banda de tinta del buylist.
 *
 * Piezas del diseño ajustadas por honestidad de datos (ver FRONTEND_NOTES):
 *  - los chips «Sets buscados» salen de GET /catalog/facets (sets con inventario real);
 *  - el cotizador del hero cotiza CONTRA el server (SEC-A1): búsqueda /buylist/cards +
 *    /buylist/quote; «Continuar mi cotización» navega a /buylist (llevar el estado al
 *    useSellCart de BuylistView tocaría el módulo buylist — fuera de este makeover);
 *  - «Queda 1» en catálogo de sueltas/gradeadas es literal (1 publicación = 1 copia);
 *    el stock agregado real solo existe en sellado (availableCount).
 *
 * Funcionalidad previa conservada: con sesión, el vistazo del portafolio
 * (PortfolioGlance) vive en una banda propia bajo el header — el diseño 1a no la
 * dibuja, pero es el gancho del usuario recurrente. FeaturedSetGlance (§7.18, rama
 * anónima) se RETIRA de la home: su lugar lo ocupa el cotizador del hero.
 */
export default function HomePage() {
  const t = useTranslations('home');
  const { isAuthenticated, ready } = useSession();
  const authed = ready && isAuthenticated;

  // Fallback de cifra para el glance (misma fuente que la home anterior).
  const holdings = useQuery({ queryKey: ['holdings'], queryFn: getHoldings, enabled: authed });
  // Chips del hero: sets REALES con inventario publicado (facetas de Compra).
  const facets = useQuery({
    queryKey: ['catalog-facets'],
    queryFn: getCatalogFacets,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const heroSets = (facets.data?.sets ?? []).slice(0, 4);

  // Estado del mini-cotizador IZADO aquí: el panel se pinta en la columna del hero (lg)
  // y como sección propia (móvil) compartiendo las mismas líneas.
  const quoter = useHomeQuoter();

  return (
    <div>
      {/* Banda del portafolio para sesión iniciada (funcionalidad conservada). */}
      {authed && (
        <div className="gutter flex flex-col gap-4 border-b border-border py-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 flex-1">
            <span className="eyebrow">{t('yourVault')}</span>
            <div className="mt-3">
              <PortfolioGlance fallbackCents={holdings.data?.portfolio.totalValueMxnCents} />
            </div>
          </div>
          <EditorialLink href="/vault" className="shrink-0 self-start sm:self-end">
            {t('vaultLink')}
          </EditorialLink>
        </div>
      )}

      {/* Hero 2 columnas: promesa + cotizador (el cotizador baja a sección propia en móvil). */}
      <div className="grid border-b border-border lg:grid-cols-[1fr_392px]">
        <div className="gutter py-10 lg:border-r lg:border-border lg:py-[52px] lg:pr-12">
          <span className="eyebrow">{t('heroKicker')}</span>
          <h1 className="mt-4 max-w-[660px] font-serif text-[31px] leading-[1.22] tracking-[-0.005em] text-text [text-wrap:pretty] lg:mt-[18px] lg:text-[50px] lg:leading-[1.14]">
            {t('heroTitle')}
          </h1>
          <p className="mt-4 max-w-[470px] text-[15px] leading-[1.7] text-muted lg:mt-5 lg:text-base lg:leading-[1.75]">
            {t('heroSubtitle')}
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-7 lg:mt-8">
            <Link
              href="/catalog"
              className="inline-flex h-[54px] items-center justify-center bg-primary px-[30px] text-[11px] font-medium uppercase tracking-[0.18em] text-primary-fg hover:bg-primary-hover"
            >
              {t('ctaShop')}
            </Link>
            {/* Móvil: botón outline a ancho completo; sm+: link editorial subrayado (§20.2). */}
            <EditorialLink
              href="/sellado"
              className="inline-flex h-[54px] items-center justify-center border border-text px-8 pb-0 sm:h-auto sm:border-0 sm:border-b sm:border-accent sm:px-0 sm:pb-1.5 sm:pt-1.5 sm:hover:border-text"
            >
              {t('ctaSealed')}
            </EditorialLink>
          </div>
          {/* Chips de sets reales; sin dato razonable, no se pintan (honestidad). */}
          {heroSets.length > 0 && (
            <div className="mt-8 hidden flex-wrap items-baseline gap-x-3.5 gap-y-2.5 sm:flex">
              <span className="eyebrow">{t('setsWanted')}</span>
              {heroSets.map((s) => (
                <Link
                  key={s.id}
                  href={`/catalog?setId=${encodeURIComponent(s.id)}`}
                  lang="en"
                  className="border-b border-border-strong pb-0.5 text-[13px] leading-none text-text hover:border-accent"
                >
                  {s.name}
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="hidden lg:flex">
          <HomeQuoterPanel state={quoter} />
        </div>
      </div>

      <FeaturedCarousel />

      {/* Cotizador como sección propia en móvil (artboard 390px). */}
      <div className="border-t border-border lg:hidden">
        <HomeQuoterPanel state={quoter} withTrust={false} />
      </div>

      <SealedShelf />
      <GradedShelf />
      <BountyBoard />

      {/* Cómo funciona la bóveda: 3 pasos estáticos. */}
      <section className="gutter border-t border-border pb-12 pt-10 lg:pb-14 lg:pt-12" aria-label={t('how.title')}>
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
          <h2 className="font-serif text-[22px] leading-tight text-text lg:text-[29px]">
            {t('how.title')}
          </h2>
          <span className="eyebrow">{t('how.tag')}</span>
        </div>
        <div className="mt-7 grid gap-7 sm:grid-cols-3 sm:gap-8 lg:mt-8 lg:gap-10">
          {([1, 2, 3] as const).map((n) => (
            <div key={n} className="border-t-2 border-text pt-4">
              <span className="font-mono text-[11px] leading-none text-accent">
                {`0${n}`}
              </span>
              <p className="mt-2.5 font-serif text-lg leading-snug text-text lg:text-xl">
                {t(`how.step${n}Title`)}
              </p>
              <p className="mt-2.5 text-sm leading-[1.7] text-muted">{t(`how.step${n}Body`)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Banda de tinta: el buylist cierra la home con el único botón rojo. */}
      <div className="grid bg-ink lg:grid-cols-[40px_1fr_auto] lg:items-center">
        <div className="hidden justify-center self-stretch border-r border-on-ink-rule py-9 lg:flex">
          <span aria-hidden className="vertical-label text-xs uppercase text-on-ink-muted">
            {t('buylistLabel')}
          </span>
        </div>
        <div className="gutter py-10 lg:px-12 lg:py-[52px]">
          <h2 className="font-serif text-[24px] leading-tight text-on-ink lg:text-[33px]">
            {t('sellTitle')}
          </h2>
          <p className="mt-3.5 max-w-[470px] text-[15px] leading-[1.7] text-on-ink-nav">
            {t('sellBody')}
          </p>
        </div>
        <div className="gutter pb-10 lg:px-12 lg:py-[52px]">
          <Link
            href="/buylist"
            className="inline-flex h-[54px] w-full items-center justify-center whitespace-nowrap bg-accent px-8 text-[11px] font-medium uppercase tracking-[0.18em] text-accent-fg hover:brightness-95 sm:w-auto"
          >
            {t('sellCta')}
          </Link>
        </div>
      </div>
    </div>
  );
}

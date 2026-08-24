'use client';

import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { StoreTabs } from '@/components/domain/StoreTabs';
import { getSealedGroups, type SealedFilters, type SealedSort } from '@/lib/api';
import {
  SEALED_SUBTYPES,
  type SealedCondition,
  type SealedGroupSummaryDTO,
  type SealedSubtype,
} from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import { CardImage } from '@/components/ui/CardImage';
import { Select } from '@/components/ui/Select';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState } from '@/components/ui/QueryState';
import { StockBadge, stockVariantFromCount } from '../_shared/StockBadge';
import { Paginator } from '../_shared/Paginator';

const SORTS: SealedSort[] = ['newest', 'price_asc', 'price_desc'];
/** pageSize del contrato (§2, default del backend); fallback del total de páginas. */
const DEFAULT_PAGE_SIZE = 20;
const CONDITIONS: SealedCondition[] = ['mint', 'minor_box_damage'];

/**
 * Extrae la dirección de contacto anti-buylist del propio copy i18n (`sealed.buylistCallout.body`)
 * para que el texto que lee el usuario y el `mailto:` del botón NO puedan divergir: el buzón vive
 * en una sola fuente (el string traducido). Si el copy no trae un correo, se cae a un fallback seguro.
 */
const SEALED_BUYLIST_FALLBACK_EMAIL = 'contacto@tcghunt.mx';
function extractEmail(text: string): string {
  return text.match(/[\w.+-]+@[\w.-]+\.\w+/)?.[0] ?? SEALED_BUYLIST_FALLBACK_EMAIL;
}

/**
 * Ventana de tienda del producto SELLADO (contrato §2-S · GET /catalog/sealed).
 * UNA sola banda filtrable por set/presentación/condición que muestra SOLO lo que hay en stock,
 * agrupando piezas idénticas (producto TCGCSV + condición) en una teja con su cantidad real.
 *
 * Makeover 1a «Conservadora»: la banda de sellado del sistema — fondo de pozo
 * (surface-2) y TEJAS HORIZONTALES (miniatura cuadrada + nombre en mincho +
 * precio tabular + «N en stock»/«Último» reales del endpoint), como la sección
 * «Producto sellado» del home 1a. SOLO VENTA: el call-out mailto lo deja explícito (§2-S).
 */
export function SealedShopView() {
  const t = useTranslations('sealed');
  const tSub = useTranslations('status.sealedSubtype');
  const [filters, setFilters] = useState<SealedFilters>({});

  const query = useQuery({
    queryKey: ['sealed-groups', filters],
    queryFn: () => getSealedGroups(filters),
  });

  const total = query.data?.total ?? 0;
  // Paginación sobria (§20.12, D3): mismo Paginator compartido del catálogo.
  const page = filters.page ?? 1;
  const totalPages = Math.max(1, Math.ceil(total / (query.data?.pageSize ?? DEFAULT_PAGE_SIZE)));
  // Ancla del scroll al paginar: la barra de resultados, no el tope de la página.
  const resultsRef = useRef<HTMLDivElement>(null);

  function goToPage(p: number) {
    setFilters((f) => ({ ...f, page: p <= 1 ? undefined : p }));
    // jsdom no implementa scrollIntoView; el guard evita romper los tests.
    resultsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  // Sets presentes en los grupos cargados (para poblar el filtro sin un endpoint extra). Con
  // paginación es una aproximación del universo; el filtro `setId` viaja igual al backend.
  const presentSets = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of query.data?.data ?? []) {
      if (!map.has(g.card.setId)) map.set(g.card.setId, g.card.setName);
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [query.data]);

  return (
    <div>
      {/* Encabezado editorial: título en mincho + subtítulo; pestañas de la Tienda debajo. */}
      <div className="gutter flex flex-col gap-3 pb-6 pt-9 lg:pt-10">
        <h1 className="font-serif text-[30px] leading-[1.1] text-text lg:text-[40px]">{t('title')}</h1>
        <p className="max-w-xl text-[15px] leading-relaxed text-muted">{t('subtitle')}</p>
      </div>

      <StoreTabs />

      {/* Call-out anti-buylist (§2-S): SOLO VENTA. Reventa por correo, nunca por la plataforma. */}
      <div className="gutter">
        <div className="rule-note my-5 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-text">{t('buylistCallout.title')}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">{t('buylistCallout.body')}</p>
          </div>
          <a
            href={`mailto:${extractEmail(t('buylistCallout.body'))}`}
            className="mt-2 inline-flex min-h-[44px] shrink-0 items-center self-start border border-text px-5 text-[11px] font-medium uppercase tracking-label text-text hover:bg-text hover:text-primary-fg sm:self-auto"
          >
            {t('buylistCallout.cta')}
          </a>
        </div>
      </div>

      {/* Filtros: set / presentación / condición / orden. */}
      <div className="gutter grid grid-cols-2 gap-4 border-t border-border py-6 sm:grid-cols-4">
        <Select
          label={t('filters.set')}
          value={filters.setId ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, setId: e.target.value || undefined, page: undefined }))}
          options={[
            { value: '', label: t('filters.allSets') },
            ...presentSets.map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
        <Select
          label={t('filters.subtype')}
          value={filters.sealedSubtype ?? ''}
          onChange={(e) =>
            setFilters((f) => ({ ...f, sealedSubtype: (e.target.value || undefined) as SealedSubtype | undefined, page: undefined }))
          }
          options={[
            { value: '', label: t('filters.allSubtypes') },
            ...SEALED_SUBTYPES.map((s) => ({ value: s, label: tSub(s) })),
          ]}
        />
        <Select
          label={t('filters.condition')}
          value={filters.condition ?? ''}
          onChange={(e) =>
            setFilters((f) => ({ ...f, condition: (e.target.value || undefined) as SealedCondition | undefined, page: undefined }))
          }
          options={[
            { value: '', label: t('filters.allConditions') },
            ...CONDITIONS.map((c) => ({ value: c, label: t(`condition.${c}`) })),
          ]}
        />
        <Select
          label={t('sort.label')}
          value={filters.sort ?? ''}
          placeholder="—"
          options={SORTS.map((s) => ({ value: s, label: t(`sort.${s}`) }))}
          onChange={(e) => setFilters((f) => ({ ...f, sort: (e.target.value || undefined) as SealedSort, page: undefined }))}
        />
      </div>

      <div ref={resultsRef} className="gutter flex items-center gap-3 border-b border-border py-4">
        <p className="tabular font-mono text-[11px] text-muted">{t('resultsCount', { count: total })}</p>
      </div>

      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
        loading={
          <div className="gutter grid grid-cols-2 gap-5 py-9 sm:grid-cols-3 lg:gap-[34px] xl:grid-cols-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        }
      >
        {(query.data?.data.length ?? 0) === 0 ? (
          <EmptyState title={t('emptyTitle')} body={t('emptyBody')} />
        ) : (
          /* Banda de sellado sobre pozo (home 1a): tejas horizontales en retícula. */
          <>
            <div className="border-b border-border bg-surface-2">
              <div className="gutter grid gap-x-8 gap-y-7 py-9 sm:grid-cols-2 xl:grid-cols-3">
                {query.data!.data.map((group) => (
                  <SealedGroupTile key={`${group.representativeItemId}-${group.sealedCondition}`} group={group} />
                ))}
              </div>
            </div>
            {/* Con una sola página el Paginator no se renderiza (§20.12). */}
            {totalPages > 1 && (
              <div className="py-10">
                <Paginator page={page} totalPages={totalPages} onPage={goToPage} />
              </div>
            )}
          </>
        )}
      </QueryState>
    </div>
  );
}

/**
 * Teja HORIZONTAL agregada del sellado (§7.1b + banda 1a): miniatura cuadrada
 * (object-contain, la caja no se recorta), nombre en mincho, renglón mono con
 * set · presentación (+ condición si trae detalle), precio «desde» tabular y el
 * distintivo real de stock. Toda la teja enlaza a la ficha por `representativeItemId`.
 */
function SealedGroupTile({ group }: { group: SealedGroupSummaryDTO }) {
  const t = useTranslations('sealed');
  const tSub = useTranslations('status.sealedSubtype');
  const locale = useLocale() as AppLocale;
  const href = `/sellado/${group.representativeItemId}`;

  return (
    <Link href={href} className="flex items-start gap-4 border-t border-border-strong pt-4">
      {/* Miniatura cuadrada sobre papel: imagen de catálogo remota, sin recortes. */}
      <CardImage
        src={group.imageUrl ?? undefined}
        alt={group.productName}
        className="aspect-auto h-[88px] w-[88px] shrink-0 border border-border bg-surface p-1.5"
      />
      <div className="min-w-0">
        <p className="font-serif text-base leading-[1.3] text-text" lang="en">
          {group.productName}
        </p>
        <p className="mt-1.5 font-mono text-[10px] uppercase leading-snug tracking-[0.08em] text-muted">
          <span lang="en">{group.card.setName}</span>
          {group.sealedSubtype && <> · {tSub(group.sealedSubtype)}</>}
          {group.sealedCondition === 'minor_box_damage' && (
            <>
              {' · '}
              <span className="text-accent">{t('condition.minor_box_damage')}</span>
            </>
          )}
        </p>
        <p className="tabular mt-3 text-base font-medium leading-none text-text">
          {formatMoneyCents(group.fromPriceCents, locale)}
        </p>
        <p className="mt-1.5 font-mono text-[10px] leading-none text-muted">
          {t('fromPrice')} · {t('withoutIva')}
        </p>
        <StockBadge
          variant={stockVariantFromCount(group.availableCount)}
          count={group.availableCount}
          className="mt-2"
        />
      </div>
    </Link>
  );
}

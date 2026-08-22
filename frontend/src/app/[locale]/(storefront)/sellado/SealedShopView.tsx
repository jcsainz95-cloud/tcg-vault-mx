'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { StoreTabs } from '@/components/domain/StoreTabs';
import { getSealedGroups, type SealedFilters, type SealedSort } from '@/lib/api';
import type { SealedCondition, SealedGroupDTO, SealedSubtype } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import { CardImage } from '@/components/ui/CardImage';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState } from '@/components/ui/QueryState';

const SORTS: SealedSort[] = ['newest', 'price_asc', 'price_desc'];
const SUBTYPES: SealedSubtype[] = ['box', 'etb', 'bundle', 'tin', 'blister'];
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
 * UNA sola cuadrícula filtrable por set/presentación/condición que muestra SOLO lo que hay en stock,
 * agrupando piezas idénticas (producto TCGCSV + condición) en una tarjeta con «N disponibles».
 * SOLO VENTA: no hay buylist de sellado — un call-out mailto lo deja explícito (§2-S).
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
      <StoreTabs />
      {/* Encabezado editorial: título en mincho + subtítulo. */}
      <div className="gutter flex flex-col gap-3 pb-6 pt-10 lg:pt-[46px]">
        <h1 className="font-serif text-[30px] leading-[1.1] text-text lg:text-[40px]">{t('title')}</h1>
        <p className="max-w-xl text-[15px] leading-relaxed text-muted">{t('subtitle')}</p>
      </div>

      {/* Call-out anti-buylist (§2-S): SOLO VENTA. Reventa por correo, nunca por la plataforma. */}
      <div className="gutter">
        <div className="rule-note flex flex-col gap-1.5 border-y border-border py-5 sm:flex-row sm:items-center sm:justify-between">
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
      <div className="gutter grid grid-cols-2 gap-4 border-b border-border py-6 sm:grid-cols-4">
        <Select
          label={t('filters.set')}
          value={filters.setId ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, setId: e.target.value || undefined }))}
          options={[
            { value: '', label: t('filters.allSets') },
            ...presentSets.map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
        <Select
          label={t('filters.subtype')}
          value={filters.sealedSubtype ?? ''}
          onChange={(e) =>
            setFilters((f) => ({ ...f, sealedSubtype: (e.target.value || undefined) as SealedSubtype | undefined }))
          }
          options={[
            { value: '', label: t('filters.allSubtypes') },
            ...SUBTYPES.map((s) => ({ value: s, label: tSub(s) })),
          ]}
        />
        <Select
          label={t('filters.condition')}
          value={filters.condition ?? ''}
          onChange={(e) =>
            setFilters((f) => ({ ...f, condition: (e.target.value || undefined) as SealedCondition | undefined }))
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
          onChange={(e) => setFilters((f) => ({ ...f, sort: (e.target.value || undefined) as SealedSort }))}
        />
      </div>

      <div className="gutter flex items-center gap-3 border-b border-border py-4">
        <p className="text-[13px] text-muted">{t('resultsCount', { count: total })}</p>
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
          <div className="gutter grid grid-cols-2 gap-5 pb-16 pt-9 sm:grid-cols-3 lg:gap-[34px] xl:grid-cols-4">
            {query.data!.data.map((group) => (
              <SealedGroupCard key={`${group.representativeItemId}-${group.sealedCondition}`} group={group} />
            ))}
          </div>
        )}
      </QueryState>
    </div>
  );
}

/**
 * Tarjeta AGREGADA del grid de sellado (§7.1b): imagen TCGCSV (u object-contain), nombre, badge
 * «Sellado» + subtipo + condición, «N disponibles» y precio «desde». Enlaza a la ficha por
 * `representativeItemId`.
 */
function SealedGroupCard({ group }: { group: SealedGroupDTO }) {
  const t = useTranslations('sealed');
  const tSub = useTranslations('status.sealedSubtype');
  const locale = useLocale() as AppLocale;
  const href = `/sellado/${group.representativeItemId}`;

  return (
    <div className="flex flex-col">
      <Link href={href} className="block">
        <CardImage src={group.imageUrl ?? undefined} alt={group.productName} />
      </Link>

      <p className="mt-3.5 font-serif text-base font-medium leading-tight text-text" lang="en">
        <Link href={href}>{group.productName}</Link>
      </p>
      <p className="mt-1.5 font-mono text-[11px] leading-snug text-muted" lang="en">
        {group.card.setName}
      </p>

      {/* Fila de calidad bajo la imagen (§7.1b): «Sellado» + subtipo + condición, sin caja sobre el arte. */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] uppercase tracking-[0.06em] text-text">
        <Badge tone="info" shape="soft">
          {t('badge')}
        </Badge>
        {group.sealedSubtype && <span className="text-muted">· {tSub(group.sealedSubtype)}</span>}
        {group.sealedCondition === 'minor_box_damage' && (
          <span className="text-accent">· {t('condition.minor_box_damage')}</span>
        )}
      </div>

      <div className="mt-3">
        <p className="font-mono text-[10px] uppercase tracking-label text-muted">{t('fromPrice')}</p>
        <p className="tabular mt-1 text-lg font-medium leading-none text-text">
          {formatMoneyCents(group.fromPriceCents, locale)}
        </p>
        <p className="mt-1 font-mono text-[11px] text-muted">{t('withoutIva')}</p>
      </div>

      <div className="mt-auto pt-3.5">
        <Link
          href={href}
          className="flex min-h-[44px] w-full items-center justify-center border border-text px-4 text-[11px] font-medium uppercase tracking-label text-text hover:bg-text hover:text-primary-fg"
        >
          {t('available', { count: group.availableCount })}
        </Link>
      </div>
    </div>
  );
}

'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search, Check } from 'lucide-react';
import type { CatalogFacetsDTO, ProductType, SealedSubtype, Finish } from '@/types/contract';
import type { CatalogFilters } from '@/lib/api';
import { groupRarities, type RarityGroup } from '@/lib/rarity-groups';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { cn } from '@/lib/cn';

export interface ShopFiltersProps {
  facets?: CatalogFacetsDTO;
  filters: CatalogFilters;
  onChange: (next: CatalogFilters) => void;
}

const RARITY_PREVIEW = 8;

/**
 * Filtros de Compra (DESIGN_SYSTEM §7.16): rareza (multi-select buscable/agrupable,
 * taxonomía abierta, se manda la rareza cruda), set con año, tipo de producto
 * (+ subtipo de sellado), y precio. El orden (sort) vive en la vitrina, sobre el grid.
 */
export function ShopFilters({ facets, filters, onChange }: ShopFiltersProps) {
  const t = useTranslations('shop');
  const tType = useTranslations('shop.type');
  const tSub = useTranslations('status.sealedSubtype');

  return (
    <div className="flex flex-col gap-6">
      <RarityFilter facets={facets} filters={filters} onChange={onChange} />
      <SetFilter facets={facets} filters={filters} onChange={onChange} />

      {/* Tipo de producto (segmented / chips) */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-text">{tType('label')}</legend>
        <div className="flex flex-wrap gap-2">
          <TypeChip
            active={!filters.productType}
            label={tType('all')}
            onClick={() => onChange({ ...filters, productType: undefined, sealedSubtype: undefined })}
          />
          {(['raw', 'graded', 'sealed'] as ProductType[]).map((pt) => (
            <TypeChip
              key={pt}
              active={filters.productType === pt}
              label={tType(pt)}
              onClick={() =>
                onChange({
                  ...filters,
                  productType: pt,
                  sealedSubtype: pt === 'sealed' ? filters.sealedSubtype : undefined,
                })
              }
            />
          ))}
        </div>
        {filters.productType === 'raw' && (
          <p className="text-xs text-muted">{tType('rawSublabel')}</p>
        )}
        {filters.productType === 'sealed' && (facets?.sealedSubtypes.length ?? 0) > 0 && (
          <Select
            label={tType('subtypeLabel')}
            placeholder="—"
            options={(facets?.sealedSubtypes ?? []).map((s) => ({ value: s, label: tSub(s) }))}
            value={filters.sealedSubtype ?? ''}
            onChange={(e) =>
              onChange({ ...filters, sealedSubtype: (e.target.value || undefined) as SealedSubtype })
            }
          />
        )}
      </fieldset>

      <FinishFilter facets={facets} filters={filters} onChange={onChange} />

      <PriceFilter facets={facets} filters={filters} onChange={onChange} />
    </div>
  );
}

function TypeChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-[44px] items-center rounded-full border px-3 text-sm font-medium transition-colors',
        active
          ? 'border-primary bg-primary text-primary-fg'
          : 'border-border-strong bg-surface text-text hover:bg-surface-2',
      )}
    >
      {label}
    </button>
  );
}

// ---- Rareza: multi-select buscable + agrupable (taxonomía abierta) ----
function RarityFilter({ facets, filters, onChange }: ShopFiltersProps) {
  const t = useTranslations('shop.rarity');
  const tGroup = useTranslations('shop.rarity.groups');
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);
  const selected = filters.rarity ?? [];

  const grouped = useMemo(() => groupRarities(facets?.rarities ?? []), [facets?.rarities]);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    let groups = grouped;
    if (q) {
      groups = grouped
        .map((g) => ({ ...g, rarities: g.rarities.filter((r) => r.toLowerCase().includes(q)) }))
        .filter((g) => g.rarities.length > 0);
    }
    return groups;
  }, [grouped, search]);

  const totalVisible = filteredGroups.reduce((n, g) => n + g.rarities.length, 0);
  const collapse = !search && !showAll && totalVisible > RARITY_PREVIEW;

  function toggle(rarity: string) {
    const next = selected.includes(rarity)
      ? selected.filter((r) => r !== rarity)
      : [...selected, rarity];
    onChange({ ...filters, rarity: next.length ? next : undefined });
  }

  // Limita la vista previa a RARITY_PREVIEW rarezas cuando está colapsado.
  let shown = 0;
  const groupsToRender = collapse
    ? filteredGroups
        .map((g) => {
          if (shown >= RARITY_PREVIEW) return { ...g, rarities: [] as string[] };
          const room = RARITY_PREVIEW - shown;
          const slice = g.rarities.slice(0, room);
          shown += slice.length;
          return { ...g, rarities: slice };
        })
        .filter((g) => g.rarities.length > 0)
    : filteredGroups;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text">
          {selected.length > 0 ? t('count', { count: selected.length }) : t('label')}
        </span>
      </div>
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
        <input
          type="search"
          aria-label={t('search')}
          placeholder={t('search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-11 w-full rounded-md border border-border-strong bg-surface pl-9 pr-3 text-base text-text focus-visible:border-primary"
        />
      </div>

      {totalVisible === 0 ? (
        <p className="text-xs text-muted">{t('noMatches')}</p>
      ) : (
        <div role="listbox" aria-label={t('label')} aria-multiselectable className="flex max-h-72 flex-col gap-3 overflow-y-auto">
          {groupsToRender.map((g) => (
            <RarityGroupSection
              key={g.group}
              label={tGroup(g.group)}
              rarities={g.rarities}
              selected={selected}
              onToggle={toggle}
            />
          ))}
        </div>
      )}

      {collapse && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="self-start text-xs font-medium text-primary hover:underline"
        >
          {t('seeAll')}
        </button>
      )}
    </div>
  );
}

function RarityGroupSection({
  label,
  rarities,
  selected,
  onToggle,
}: {
  label: string;
  rarities: string[];
  selected: string[];
  onToggle: (r: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-subtle">{label}</p>
      {rarities.map((r) => {
        const checked = selected.includes(r);
        return (
          <label
            key={r}
            role="option"
            aria-selected={checked}
            className="flex min-h-[36px] cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-surface-2"
          >
            <span
              className={cn(
                'flex h-5 w-5 shrink-0 items-center justify-center rounded border',
                checked ? 'border-primary bg-primary text-primary-fg' : 'border-border-strong bg-surface',
              )}
            >
              {checked && <Check size={14} aria-hidden />}
            </span>
            <input
              type="checkbox"
              className="sr-only"
              checked={checked}
              onChange={() => onToggle(r)}
            />
            {/* rareza cruda EN (dato de catálogo, no se traduce) */}
            <span lang="en">{r}</span>
          </label>
        );
      })}
    </div>
  );
}

// ---- Set con año: combobox buscable, "Nombre (2024)", orden año desc ----
function SetFilter({ facets, filters, onChange }: ShopFiltersProps) {
  const t = useTranslations('shop.set');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const sets = facets?.sets ?? [];
    const q = search.trim().toLowerCase();
    // el contrato ya los entrega ordenados por año desc
    return q
      ? sets.filter((s) => s.name.toLowerCase().includes(q) || String(s.year ?? '').includes(q))
      : sets;
  }, [facets?.sets, search]);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-text">{t('label')}</span>
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
        <input
          type="search"
          aria-label={t('search')}
          placeholder={t('search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-11 w-full rounded-md border border-border-strong bg-surface pl-9 pr-3 text-base text-text focus-visible:border-primary"
        />
      </div>
      <div role="listbox" aria-label={t('label')} className="flex max-h-56 flex-col overflow-y-auto">
        <button
          type="button"
          role="option"
          aria-selected={!filters.setId}
          onClick={() => onChange({ ...filters, setId: undefined })}
          className={cn(
            'flex min-h-[40px] items-center rounded-md px-2 text-left text-sm hover:bg-surface-2',
            !filters.setId && 'font-semibold text-primary',
          )}
        >
          {t('any')}
        </button>
        {filtered.map((s) => {
          const active = filters.setId === s.id;
          return (
            <button
              key={s.id}
              type="button"
              role="option"
              aria-selected={active}
              onClick={() => onChange({ ...filters, setId: active ? undefined : s.id })}
              className={cn(
                'flex min-h-[40px] items-center justify-between gap-2 rounded-md px-2 text-left text-sm hover:bg-surface-2',
                active && 'bg-surface-2 font-semibold text-primary',
              )}
            >
              {/* nombre del set EN (dato de catálogo) + año como realce */}
              <span lang="en">{s.name}</span>
              {s.year != null && <span className="tabular text-xs text-muted">({s.year})</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---- Acabado: chips de acabado (v1.6-finish), alimentado por facets.finishes ----
const FINISH_ORDER: Finish[] = ['normal', 'reverse_holo', 'holofoil', 'first_edition_holofoil'];

function FinishFilter({ facets, filters, onChange }: ShopFiltersProps) {
  const t = useTranslations('shop.finish');
  const tFinish = useTranslations('finish');
  // Ordena los acabados presentes en el inventario publicado según FINISH_ORDER.
  const finishes = FINISH_ORDER.filter((f) => (facets?.finishes ?? []).includes(f));
  if (finishes.length === 0) return null;

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-text">{t('label')}</legend>
      <div className="flex flex-wrap gap-2">
        <TypeChip
          active={!filters.finish}
          label={t('all')}
          onClick={() => onChange({ ...filters, finish: undefined })}
        />
        {finishes.map((f) => (
          <TypeChip
            key={f}
            active={filters.finish === f}
            label={tFinish(f)}
            onClick={() => onChange({ ...filters, finish: filters.finish === f ? undefined : f })}
          />
        ))}
      </div>
    </fieldset>
  );
}

// ---- Precio: rango min/max en MX$ (se envía en centavos) ----
function PriceFilter({ facets, filters, onChange }: ShopFiltersProps) {
  const t = useTranslations('shop.price');

  const toPesos = (cents?: number) => (cents == null ? '' : String(Math.round(cents / 100)));
  const toCents = (pesos: string): number | undefined => {
    const n = Number(pesos.replace(/[^\d.]/g, ''));
    return pesos.trim() === '' || Number.isNaN(n) ? undefined : Math.round(n * 100);
  };

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-text">{t('label')}</legend>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">{t('min')}</span>
          <div className="flex items-center rounded-md border border-border-strong bg-surface px-2">
            <span className="text-sm text-muted">MX$</span>
            <input
              type="text"
              inputMode="decimal"
              aria-label={t('min')}
              value={toPesos(filters.minPriceCents)}
              placeholder={toPesos(facets?.price.minCents)}
              onChange={(e) => onChange({ ...filters, minPriceCents: toCents(e.target.value) })}
              className="tabular h-10 w-full bg-transparent px-1 text-base text-text outline-none"
            />
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">{t('max')}</span>
          <div className="flex items-center rounded-md border border-border-strong bg-surface px-2">
            <span className="text-sm text-muted">MX$</span>
            <input
              type="text"
              inputMode="decimal"
              aria-label={t('max')}
              value={toPesos(filters.maxPriceCents)}
              placeholder={toPesos(facets?.price.maxCents)}
              onChange={(e) => onChange({ ...filters, maxPriceCents: toCents(e.target.value) })}
              className="tabular h-10 w-full bg-transparent px-1 text-base text-text outline-none"
            />
          </div>
        </label>
      </div>
    </fieldset>
  );
}

export type { RarityGroup };

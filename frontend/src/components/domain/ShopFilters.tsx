'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CatalogFacetsDTO, ProductType, SealedSubtype } from '@/types/contract';
import type { CatalogFilters } from '@/lib/api';
import { groupRarities, type RarityGroup } from '@/lib/rarity-groups';
import { FINISH_ORDER } from '@/lib/finish';
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
 * (+ subtipo de sellado), acabado y precio. El orden (sort) vive sobre el grid.
 *
 * 6a — Dirección 5a: el panel de tarjetas se vuelve un índice tipográfico. Cada
 * bloque se separa con una regla fina, los buscadores pierden la caja y las
 * casillas son cuadrados de 14px que se rellenan de tinta. Ninguna pastilla.
 */
export function ShopFilters({ facets, filters, onChange }: ShopFiltersProps) {
  const tType = useTranslations('shop.type');
  const tSub = useTranslations('status.sealedSubtype');

  return (
    <div>
      <RarityFilter facets={facets} filters={filters} onChange={onChange} />

      <FilterSection>
        <SetFilter facets={facets} filters={filters} onChange={onChange} />
      </FilterSection>

      <FilterSection>
        <fieldset>
          <legend className="text-[13px] font-medium leading-none text-text">{tType('label')}</legend>
          <div className="mt-3.5 flex flex-wrap gap-2">
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
            <p className="mt-3 font-mono text-[11px] text-muted">{tType('rawSublabel')}</p>
          )}
          {filters.productType === 'sealed' && (facets?.sealedSubtypes.length ?? 0) > 0 && (
            <div className="mt-5">
              <Select
                label={tType('subtypeLabel')}
                placeholder="—"
                options={(facets?.sealedSubtypes ?? []).map((s) => ({ value: s, label: tSub(s) }))}
                value={filters.sealedSubtype ?? ''}
                onChange={(e) =>
                  onChange({ ...filters, sealedSubtype: (e.target.value || undefined) as SealedSubtype })
                }
              />
            </div>
          )}
        </fieldset>
      </FilterSection>

      <FinishFilter facets={facets} filters={filters} onChange={onChange} />

      <FilterSection>
        <PriceFilter facets={facets} filters={filters} onChange={onChange} />
      </FilterSection>
    </div>
  );
}

/** Bloque de filtro: regla fina arriba y aire, nunca una caja. */
function FilterSection({ children }: { children: React.ReactNode }) {
  return <div className="mt-8 border-t border-border pt-6">{children}</div>;
}

/** Buscador de bloque: solo la regla inferior, sin icono de lupa. */
function RuleSearch({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <input
      type="search"
      aria-label={label}
      placeholder={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="mt-3 w-full border-b border-border-strong bg-transparent pb-2.5 text-[13px] text-text outline-none placeholder:text-muted focus:border-text focus-visible:shadow-focus"
    />
  );
}

function TypeChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-[44px] items-center border px-3.5 text-xs font-medium transition-colors',
        active ? 'border-text bg-text text-primary-fg' : 'border-border-strong text-text hover:border-text',
      )}
    >
      {label}
    </button>
  );
}

/**
 * Casilla del índice: cuadrado de 14px que se rellena de tinta al marcarse.
 * Es el <input> real con `appearance-none` en vez de un span decorativo sobre un
 * input sr-only, que interceptaba el clic y lo dejaba inalcanzable con puntero.
 */
function RuleCheckbox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      className="h-3.5 w-3.5 shrink-0 cursor-pointer appearance-none border border-border-strong checked:border-text checked:bg-text"
    />
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
    <div>
      <span className="text-[13px] font-medium leading-none text-text">
        {selected.length > 0 ? t('count', { count: selected.length }) : t('label')}
      </span>
      <RuleSearch label={t('search')} value={search} onChange={setSearch} />

      {totalVisible === 0 ? (
        <p className="mt-4 font-mono text-[11px] text-muted">{t('noMatches')}</p>
      ) : (
        <div role="listbox" aria-label={t('label')} aria-multiselectable className="max-h-96 overflow-y-auto">
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
          className="mt-3.5 text-xs font-medium text-accent hover:text-text"
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
    <div>
      <p className="mb-2 mt-5 text-[10px] font-medium uppercase leading-none tracking-[0.16em] text-muted">
        {label}
      </p>
      <div className="flex flex-col">
        {rarities.map((r) => {
          const checked = selected.includes(r);
          return (
            <label
              key={r}
              role="option"
              aria-selected={checked}
              className="flex min-h-[36px] cursor-pointer items-center gap-2.5 text-[13px] text-text"
            >
              <RuleCheckbox checked={checked} onChange={() => onToggle(r)} />
              {/* rareza cruda EN (dato de catálogo, no se traduce) */}
              <span lang="en">{r}</span>
            </label>
          );
        })}
      </div>
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
    <div>
      <span className="text-[13px] font-medium leading-none text-text">{t('label')}</span>
      <RuleSearch label={t('search')} value={search} onChange={setSearch} />
      <div role="listbox" aria-label={t('label')} className="mt-4 flex max-h-72 flex-col overflow-y-auto">
        <button
          type="button"
          role="option"
          aria-selected={!filters.setId}
          onClick={() => onChange({ ...filters, setId: undefined })}
          className={cn(
            'flex min-h-[40px] items-center text-left text-[13px]',
            !filters.setId ? 'font-medium text-accent' : 'text-text hover:text-accent',
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
                'flex min-h-[40px] items-center justify-between gap-2 text-left text-[13px]',
                active ? 'font-medium text-accent' : 'text-text hover:text-accent',
              )}
            >
              {/* nombre del set EN (dato de catálogo) + año como realce */}
              <span lang="en">{s.name}</span>
              {s.year != null && <span className="tabular font-mono text-[11px] text-muted">({s.year})</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---- Acabado: chips de acabado (v1.6-finish), alimentado por facets.finishes ----
function FinishFilter({ facets, filters, onChange }: ShopFiltersProps) {
  const t = useTranslations('shop.finish');
  const tFinish = useTranslations('finish');
  // Ordena los acabados presentes en el inventario publicado según FINISH_ORDER.
  const finishes = FINISH_ORDER.filter((f) => (facets?.finishes ?? []).includes(f));
  if (finishes.length === 0) return null;

  return (
    <FilterSection>
      <fieldset>
        <legend className="text-[13px] font-medium leading-none text-text">{t('label')}</legend>
        <div className="mt-3.5 flex flex-wrap gap-2">
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
    </FilterSection>
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
    <fieldset>
      <legend className="text-[13px] font-medium leading-none text-text">{t('label')}</legend>
      <div className="mt-3.5 grid grid-cols-2 gap-3.5">
        {(
          [
            ['min', filters.minPriceCents, facets?.price.minCents] as const,
            ['max', filters.maxPriceCents, facets?.price.maxCents] as const,
          ]
        ).map(([kind, value, placeholder]) => (
          <label key={kind} className="flex flex-col">
            <span className="font-mono text-[11px] leading-none text-muted">{t(kind)}</span>
            <span className="mt-2 flex items-baseline gap-1 border-b border-border-strong pb-2 focus-within:border-text focus-within:shadow-focus">
              <span className="shrink-0 text-sm text-text">MX$</span>
              <input
                type="text"
                inputMode="decimal"
                aria-label={t(kind)}
                value={toPesos(value)}
                placeholder={toPesos(placeholder)}
                onChange={(e) =>
                  onChange(
                    kind === 'min'
                      ? { ...filters, minPriceCents: toCents(e.target.value) }
                      : { ...filters, maxPriceCents: toCents(e.target.value) },
                  )
                }
                className="tabular w-full min-w-0 bg-transparent text-sm text-text outline-none placeholder:text-muted"
              />
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export type { RarityGroup };

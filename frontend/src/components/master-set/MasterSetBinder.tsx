'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ChevronLeft } from 'lucide-react';
import {
  getMasterSetBinder,
  getAdminVaultMasterSetBinder,
  getVaultMasterSetBinder,
} from '@/lib/api';
import type {
  Finish,
  MasterSetBinderResponse,
  MasterSetCardCellDTO,
  MasterSetSummaryDTO,
} from '@/types/contract';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState } from '@/components/ui/QueryState';
import type { MasterSetViewMode } from './mode';

const FINISH_ORDER: Finish[] = ['normal', 'reverse_holo', 'holofoil', 'first_edition_holofoil'];
type PieceFilter = 'all' | 'with' | 'gaps';

interface Props {
  mode: MasterSetViewMode;
  /** Requerido en `user_vault_admin`. */
  userId?: string;
  set: MasterSetSummaryDTO;
  onBack: () => void;
  onOpenCell: (cell: MasterSetCardCellDTO) => void;
}

/** Endpoint por modo (contrato v1.18: mismo shape de binder, distinto scope). */
function fetchBinder(
  mode: MasterSetViewMode,
  userId: string | undefined,
  setId: string,
): Promise<MasterSetBinderResponse> {
  if (mode === 'user_vault_self') return getVaultMasterSetBinder(setId);
  if (mode === 'user_vault_admin') return getAdminVaultMasterSetBinder(userId ?? '', setId);
  return getMasterSetBinder(setId);
}

/**
 * Binder COMPARTIDO del set (§4.18f): cuadrícula por número. Confía en el ORDEN NATURAL del
 * backend (numéricos primero, promos al final): NO re-ordena por número en cliente (contrato
 * §M1). Los filtros (acabado, con/sin huecos, secret rares) son LOCALES y preservan ese orden.
 * v1.18: cada celda muestra sus CASILLAS POR ACABADO (variants[], universo = availableFinishes)
 * y el contador «X/Y» cuenta variantes.
 */
export function MasterSetBinder({ mode, userId, set, onBack, onOpenCell }: Props) {
  const t = useTranslations('masterSet');
  const tFinish = useTranslations('finish');
  const [finishFilter, setFinishFilter] = useState<'' | Finish>('');
  const [pieceFilter, setPieceFilter] = useState<PieceFilter>('all');
  const [onlySecret, setOnlySecret] = useState(false);

  const binder = useQuery({
    queryKey: ['master-set-binder', mode, userId ?? null, set.setId],
    queryFn: () => fetchBinder(mode, userId, set.setId),
  });

  const cells = useMemo(() => {
    const all = binder.data?.cells ?? [];
    // Filtros LOCALES sobre la respuesta completa; NO se re-ordena (se conserva el orden natural).
    return all.filter((c) => {
      if (finishFilter && !c.variants.some((v) => v.finish === finishFilter && v.covered)) return false;
      if (pieceFilter === 'with' && c.coveredVariantCount === 0) return false;
      if (pieceFilter === 'gaps' && c.coveredVariantCount >= c.expectedVariantCount) return false;
      if (onlySecret && !c.isSecretRare) return false;
      return true;
    });
  }, [binder.data, finishFilter, pieceFilter, onlySecret]);

  // v1.18: contador del set POR VARIANTE, derivado del binder (suma de expected/covered).
  const variantTotals = useMemo(() => {
    const all = binder.data?.cells ?? [];
    const expected = all.reduce((s, c) => s + c.expectedVariantCount, 0);
    const covered = all.reduce((s, c) => s + c.coveredVariantCount, 0);
    const pct = expected === 0 ? 0 : Math.round((covered / expected) * 1000) / 10;
    return { expected, covered, pct };
  }, [binder.data]);

  const owner = binder.data?.owner;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack} aria-label={t('backToIndex')}>
            <ChevronLeft size={18} /> {t('backToIndex')}
          </Button>
          <h2 lang="en" className="text-h2">
            {set.name}
          </h2>
        </div>
        {binder.data && (
          <span className="font-mono tabular-nums text-xs text-muted">
            {t('completionValue', {
              owned: variantTotals.covered,
              total: variantTotals.expected,
              pct: variantTotals.pct,
            })}
          </span>
        )}
      </div>

      {/* Dueño de la bóveda (scope user_vault; email solo en la vista admin). */}
      {mode === 'user_vault_admin' && owner && (
        <p className="font-mono text-xs text-muted">
          {t('ownerVault', { name: owner.name })}
          {owner.email ? ` · ${owner.email}` : ''}
        </p>
      )}

      {/* Filtros LOCALES (no vuelven a pegarle al backend). */}
      <div className="flex flex-wrap items-end gap-3">
        <Select
          label={t('filterFinish')}
          className="w-44"
          options={[
            { value: '', label: t('filterAll') },
            ...FINISH_ORDER.map((f) => ({ value: f, label: tFinish(f) })),
          ]}
          value={finishFilter}
          onChange={(e) => setFinishFilter(e.target.value as '' | Finish)}
        />
        <Select
          label={t('filterPieces')}
          className="w-48"
          options={[
            { value: 'all', label: t('filterAll') },
            { value: 'with', label: t('filterWithPieces') },
            { value: 'gaps', label: t('filterGaps') },
          ]}
          value={pieceFilter}
          onChange={(e) => setPieceFilter(e.target.value as PieceFilter)}
        />
        <label className="flex items-center gap-2 pb-3 text-sm">
          <input
            type="checkbox"
            checked={onlySecret}
            onChange={(e) => setOnlySecret(e.target.checked)}
            className="h-5 w-5 accent-[color:var(--color-accent)]"
          />
          {t('filterSecretRares')}
        </label>
      </div>

      <QueryState
        isLoading={binder.isLoading}
        isError={binder.isError}
        error={binder.error}
        onRetry={() => binder.refetch()}
      >
        {binder.data &&
          (cells.length === 0 ? (
            <EmptyState title={t('emptyBinderTitle')} body={t('emptyBinderBody')} />
          ) : (
            <ul
              className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
              aria-label={t('binderGridLabel')}
            >
              {cells.map((cell) => (
                <li key={cell.cardId}>
                  <BinderCell cell={cell} onOpen={() => onOpenCell(cell)} />
                </li>
              ))}
            </ul>
          ))}
      </QueryState>
    </div>
  );
}

function BinderCell({ cell, onOpen }: { cell: MasterSetCardCellDTO; onOpen: () => void }) {
  const t = useTranslations('masterSet');
  const tFinish = useTranslations('finish');
  // Hueco TOTAL = ninguna variante cubierta → imagen atenuada + borde punteado (grid visual).
  const isGap = cell.coveredVariantCount === 0;
  // Drift de catálogo (contrato v1.18): piezas con acabado FUERA del universo se VEN pero no
  // cuentan en expected/covered.
  const driftCounts = cell.countsByFinish.filter(
    (cf) => !cell.variants.some((v) => v.finish === cf.finish),
  );
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full flex-col gap-2 border p-2 text-left transition-colors focus-visible:shadow-focus focus-visible:outline-none ${
        isGap ? 'border-dashed border-border-strong bg-surface' : 'border-border bg-surface hover:bg-surface-2'
      }`}
    >
      <div className="relative">
        {/* Imagen de catálogo remota: lazy + content-visibility para binders grandes. */}
        <div
          className="aspect-[5/7] w-full overflow-hidden bg-surface-2"
          style={{ contentVisibility: 'auto', containIntrinsicSize: '140px 196px' } as React.CSSProperties}
        >
          {cell.imageSmallUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cell.imageSmallUrl}
              alt=""
              aria-hidden
              loading="lazy"
              className={`h-full w-full object-contain ${isGap ? 'opacity-30' : ''}`}
            />
          ) : null}
        </div>
        {/* Badge secret rare (solo display) con scrim de tinta (§7.2b). */}
        {cell.isSecretRare && (
          <span className="absolute right-1 top-1 bg-[color:var(--color-ink)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[color:var(--color-on-ink)]">
            {t('secretRare')}
          </span>
        )}
      </div>
      <div className="flex items-baseline justify-between gap-1">
        <span className="font-mono tabular-nums text-xs text-muted">#{cell.number}</span>
        {isGap ? (
          <span className="font-mono text-[10px] uppercase tracking-wide text-accent">{t('gap')}</span>
        ) : (
          /* v1.18: el contador de la celda cuenta VARIANTES cubiertas del universo. */
          <span className="font-mono tabular-nums text-xs">
            {t('variantCount', { covered: cell.coveredVariantCount, expected: cell.expectedVariantCount })}
          </span>
        )}
      </div>
      <span lang="en" className="line-clamp-1 text-sm">
        {cell.name}
      </span>
      {/* v1.18: CASILLAS POR ACABADO — una por variante del universo; «HUECO» por acabado. */}
      <div className="flex flex-wrap gap-1">
        {cell.variants.map((v) =>
          v.covered ? (
            <span
              key={v.finish}
              className="border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide"
              aria-label={t('finishChipAria', { finish: tFinish(v.finish), count: v.count })}
            >
              {tFinish(v.finish)} · <span className="tabular-nums">{v.count}</span>
            </span>
          ) : (
            <span
              key={v.finish}
              className="border border-dashed border-border-strong px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-accent"
              aria-label={t('finishGapAria', { finish: tFinish(v.finish) })}
            >
              {tFinish(v.finish)} · {t('gap')}
            </span>
          ),
        )}
        {driftCounts.map((cf) => (
          <span
            key={`drift-${cf.finish}`}
            className="border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted"
            aria-label={t('driftChipAria', { finish: tFinish(cf.finish), count: cf.count })}
            title={t('driftNote')}
          >
            {tFinish(cf.finish)} · <span className="tabular-nums">{cf.count}</span> ⚠
          </span>
        ))}
      </div>
    </button>
  );
}

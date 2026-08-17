'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Trash2, Package } from 'lucide-react';
import { batchCreateItems, getLocations } from '@/lib/api';
import type {
  MasterSetCardCellDTO,
  MasterSetSummaryDTO,
  BatchInventoryItemInput,
  BatchInventoryLineResult,
} from '@/types/contract';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { MasterSetIndex } from './MasterSetIndex';
import { MasterSetBinder } from './MasterSetBinder';
import { CellDrawer } from './CellDrawer';
import { PerLineErrors } from './PerLineErrors';
import { localUid, type CaptureLine } from './capture';
import type { MasterSetViewMode } from './mode';

interface Props {
  /** Scope/capacidades de la vista (§4.18f). Default: M1 (plataforma). */
  mode?: MasterSetViewMode;
  /** Requerido en `user_vault_admin` (bóveda de ESE cliente). */
  userId?: string;
  /**
   * Solo `user_vault_self`: agrega la pieza `buyable` de una variante faltante al carrito
   * de COMPRA del storefront (el checkout sigue siendo el flujo normal, §4).
   */
  onBuyMissing?: (inventoryItemId: string) => void;
}

/**
 * Orquestador COMPARTIDO de la vista Master Set (§4.18f): índice ⇆ binder y drawer por
 * celda en los TRES modos. El CARRITO DE CAPTURA por lote (#12), la publicación y el
 * ajuste por levantamiento físico SOLO se montan en modo `platform` (M1); los modos
 * `user_vault_*` son lectura (y compra de faltantes en la vista del propio cliente).
 */
export function MasterSetPanel({ mode = 'platform', userId, onBuyMissing }: Props) {
  const t = useTranslations('masterSet');
  const queryClient = useQueryClient();
  const isPlatform = mode === 'platform';

  const [selectedSet, setSelectedSet] = useState<MasterSetSummaryDTO | null>(null);
  const [openCell, setOpenCell] = useState<MasterSetCardCellDTO | null>(null);
  const [cart, setCart] = useState<CaptureLine[]>([]);

  // Ubicaciones: solo el alta rápida de M1 las usa (endpoint admin).
  const locations = useQuery({ queryKey: ['locations'], queryFn: getLocations, enabled: isPlatform });

  const submit = useMutation({
    mutationFn: () => {
      const items: BatchInventoryItemInput[] = cart.map((l) => ({
        cardId: l.cardId,
        productType: l.productType,
        rawCondition: l.rawCondition,
        finish: l.productType === 'raw' ? l.finish : undefined,
        gradingCompany: l.gradingCompany,
        gradeValue: l.gradeValue,
        certNumber: l.certNumber,
        locationId: l.locationId,
        acquisitionType: l.acquisitionType,
        acquisitionPct: l.acquisitionPct,
        qty: l.qty,
      }));
      // batchKey nuevo por submit: idempotencia server-side (un reenvío no duplica).
      return batchCreateItems({ batchKey: localUid('batch'), items });
    },
    onSuccess: () => {
      // Refresca agregados (índice + binder abierto): las piezas nuevas cambian conteos.
      invalidateAggregates();
      setCart([]);
    },
  });

  function invalidateAggregates() {
    void queryClient.invalidateQueries({ queryKey: ['master-sets'] });
    void queryClient.invalidateQueries({ queryKey: ['master-set-binder'] });
    void queryClient.invalidateQueries({ queryKey: ['cell-pieces'] });
  }

  function addToCart(line: CaptureLine) {
    setCart((prev) => [...prev, line]);
    submit.reset();
  }

  function removeLine(key: string) {
    setCart((prev) => prev.filter((l) => l.key !== key));
  }

  const batchResults: BatchInventoryLineResult[] = submit.data?.results ?? [];
  const totalPieces = cart.reduce((s, l) => s + l.qty, 0);

  return (
    <div className="flex flex-col gap-6">
      {selectedSet ? (
        <MasterSetBinder
          mode={mode}
          userId={userId}
          set={selectedSet}
          onBack={() => setSelectedSet(null)}
          onOpenCell={(cell) => setOpenCell(cell)}
        />
      ) : (
        <MasterSetIndex mode={mode} userId={userId} onOpenSet={(s) => setSelectedSet(s)} />
      )}

      {/* Carrito de captura por lote (#12): SOLO M1 (modo platform). */}
      {isPlatform && cart.length > 0 && (
        <section className="border border-border-strong bg-surface-2 p-4" aria-label={t('cartTitle')}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-h3">
              <Package size={18} aria-hidden /> {t('cartTitle')}
            </h3>
            <span className="font-mono tabular-nums text-xs text-muted">
              {t('cartSummary', { lines: cart.length, pieces: totalPieces })}
            </span>
          </div>
          <ul className="mb-3 flex flex-col gap-1">
            {cart.map((l) => (
              <li key={l.key} className="flex items-center gap-3 border-b border-border py-1 text-sm">
                <span className="font-mono tabular-nums text-xs text-muted">×{l.qty}</span>
                <span lang="en" className="min-w-0 flex-1 truncate">
                  {l.cardName} · #{l.number}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wide text-muted">
                  {l.productType}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => removeLine(l.key)}
                  aria-label={t('cartRemove')}
                >
                  <Trash2 size={16} />
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => submit.mutate()} loading={submit.isPending} disabled={submit.isPending}>
              {t('cartSubmit', { count: totalPieces })}
            </Button>
            <Button variant="secondary" onClick={() => setCart([])} disabled={submit.isPending}>
              {t('cartClear')}
            </Button>
          </div>
        </section>
      )}

      {/* Resultado del lote: tolerante por-línea. */}
      {isPlatform && submit.data && (
        <div className="flex flex-col gap-2">
          <Banner
            variant={submit.data.summary.failedLines > 0 ? 'warning' : 'success'}
            role="status"
          >
            {t('batchResult', {
              created: submit.data.summary.createdItems,
              failed: submit.data.summary.failedLines,
            })}
            {submit.data.idempotentReplay ? ` · ${t('batchReplay')}` : ''}
          </Banner>
          <PerLineErrors
            lines={batchResults.map((r, i) => ({
              ok: r.ok,
              label: r.ok ? r.folios.join(', ') : t('lineLabel', { index: i + 1 }),
              code: r.ok ? undefined : r.error.code,
              message: r.ok ? undefined : r.error.message,
            }))}
          />
        </div>
      )}
      {isPlatform && submit.isError && (
        <Banner variant="danger" role="alert">
          {t('batchError')}
        </Banner>
      )}

      {openCell && (
        <CellDrawer
          mode={mode}
          cell={openCell}
          locations={locations.data ?? []}
          onClose={() => setOpenCell(null)}
          onAddToCart={addToCart}
          onPublished={invalidateAggregates}
          onAdjusted={invalidateAggregates}
          onBuyMissing={onBuyMissing}
        />
      )}
    </div>
  );
}

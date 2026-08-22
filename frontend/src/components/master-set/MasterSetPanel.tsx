'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Trash2, Package } from 'lucide-react';
import { batchCreateItems, getLocations } from '@/lib/api';
import type {
  MasterSetCardCellDTO,
  MasterSetSummaryDTO,
  MasterSetVariantDTO,
  CardProductDTO,
  Finish,
  BuylistQuoteResponse,
  BatchInventoryItemInput,
  BatchInventoryLineResult,
} from '@/types/contract';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { MasterSetIndex } from './MasterSetIndex';
import { MasterSetBinder } from './MasterSetBinder';
import { CellDrawer } from './CellDrawer';
import { PerLineErrors } from './PerLineErrors';
import { localUid, type CaptureBatchState, type CaptureLine } from './capture';
import type { MasterSetViewMode } from './mode';

interface Props {
  /** Scope/capacidades de la vista (§4.20f). Default: M1 (plataforma). */
  mode?: MasterSetViewMode;
  /** Requerido en `user_vault_admin` (bóveda de ESE cliente). */
  userId?: string;
  /**
   * Solo `user_vault_self`: agrega la pieza `buyable` de una variante faltante al carrito
   * de COMPRA del storefront (el checkout sigue siendo el flujo normal, §4).
   */
  onBuyMissing?: (inventoryItemId: string) => void;
  /**
   * Solo `quoter`: clic en una casilla de acabado ya cotizada agrega esa combinación
   * (carta, acabado) al carrito de VENTA del cotizador (BuylistView es dueño del carrito).
   */
  onAddToSellCart?: (cell: MasterSetCardCellDTO, variant: MasterSetVariantDTO) => void;
  /**
   * v1.30 (§4.29), solo `quoter`: clic en «Agregar» de un PRODUCTO SEPARADO (deck_exclusive/promo)
   * lo agrega al carrito de VENTA como LÍNEA PROPIA por su `productId` (precio propio, no fusionado
   * con la carta base). `quote` = cotización resuelta server-side (eco del productId).
   */
  onAddProductToSellCart?: (
    cell: MasterSetCardCellDTO,
    product: CardProductDTO,
    finish: Finish,
    quote: BuylistQuoteResponse,
  ) => void;
  /**
   * v1.28 (P-17, solo M1): drill-down POR VARIANTE. Si viene, el clic en una casilla del binder
   * NO abre el CellDrawer por-carta: delega en el dueño (M1View monta el VariantDrawer). Cuando
   * el set abierto cambia se notifica con `onSetOpened` (alcance «Solo este set» de publicar-todo).
   */
  onOpenVariant?: (cell: MasterSetCardCellDTO, variant: MasterSetVariantDTO) => void;
  onSetOpened?: (set: MasterSetSummaryDTO | null) => void;
}

/**
 * Orquestador COMPARTIDO de la vista Master Set (§4.20f): índice ⇆ binder y drawer por
 * celda en los TRES modos. El CARRITO DE CAPTURA por lote (#12), la publicación y el
 * ajuste por levantamiento físico SOLO se montan en modo `platform` (M1); los modos
 * `user_vault_*` son lectura (y compra de faltantes en la vista del propio cliente).
 */
export function MasterSetPanel({
  mode = 'platform',
  userId,
  onBuyMissing,
  onAddToSellCart,
  onAddProductToSellCart,
  onOpenVariant,
  onSetOpened,
}: Props) {
  const t = useTranslations('masterSet');
  const queryClient = useQueryClient();
  const isPlatform = mode === 'platform';

  const [selectedSet, setSelectedSet] = useState<MasterSetSummaryDTO | null>(null);
  const [openCell, setOpenCell] = useState<MasterSetCardCellDTO | null>(null);
  const [cart, setCart] = useState<CaptureLine[]>([]);

  // batchKey ESTABLE por SESIÓN DE CARRITO (techlead #1): se fija UNA vez al empezar a llenar el
  // carrito y SOLO se regenera tras un éxito confirmado (o al vaciar el carrito). Si el request
  // expira por red pero SÍ se procesó y el operador reintenta, el reintento reusa la MISMA key →
  // el backend lo trata como replay (guardia anti-duplicado) → NO se duplican piezas. Generar la
  // key dentro del mutationFn en cada mutate() derrotaría esa idempotencia.
  const batchKeyRef = useRef<string | null>(null);
  function ensureBatchKey(): string {
    if (batchKeyRef.current === null) batchKeyRef.current = localUid('batch');
    return batchKeyRef.current;
  }

  // Ubicaciones: solo el alta rápida de M1 las usa (endpoint admin).
  const locations = useQuery({ queryKey: ['locations'], queryFn: getLocations, enabled: isPlatform });

  // El lote a enviar viaja como ARGUMENTO de la mutación (no se lee del state dentro del
  // mutationFn): así «dar de alta» en el mismo clic que «agregar» envía la línea recién
  // capturada y no la foto anterior del state (React agrupa el setState del mismo tick).
  const submit = useMutation({
    mutationFn: (lines: CaptureLine[]) => {
      const items: BatchInventoryItemInput[] = lines.map((l) => ({
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
      // Reusa la key de la sesión (un reenvío por timeout NO cambia la key → replay idempotente).
      return batchCreateItems({ batchKey: ensureBatchKey(), items });
    },
    onSuccess: () => {
      // Refresca agregados (índice + binder abierto): las piezas nuevas cambian conteos.
      invalidateAggregates();
      // Sesión cerrada con éxito → la próxima captura arranca con una batchKey NUEVA.
      batchKeyRef.current = null;
      setCart([]);
    },
  });

  function invalidateAggregates() {
    void queryClient.invalidateQueries({ queryKey: ['master-sets'] });
    void queryClient.invalidateQueries({ queryKey: ['master-set-binder'] });
    void queryClient.invalidateQueries({ queryKey: ['cell-pieces'] });
  }

  /** Encola la línea en el LOTE pendiente (alta por lote; se confirma con `submitBatch`). */
  function queueLine(line: CaptureLine) {
    // Fija la key de la sesión al empezar a llenar el lote (si aún no existe).
    ensureBatchKey();
    setCart((prev) => [...prev, line]);
    submit.reset();
  }

  /**
   * Alta INMEDIATA (T3): encola la línea Y envía el lote en el mismo clic. Reusa la MISMA
   * `batchKey` de la sesión (`ensureBatchKey`), así que un reintento por timeout sigue siendo
   * un replay idempotente en el backend — la idempotencia no se toca.
   */
  function queueAndSubmit(line: CaptureLine) {
    ensureBatchKey();
    const lines = [...cart, line];
    setCart(lines);
    submit.mutate(lines);
  }

  function submitBatch() {
    if (cart.length === 0) return;
    submit.mutate(cart);
  }

  function removeLine(key: string) {
    setCart((prev) => prev.filter((l) => l.key !== key));
  }

  function clearBatch() {
    // Vaciar el lote termina la sesión → nueva batchKey en la próxima captura.
    batchKeyRef.current = null;
    setCart([]);
    submit.reset();
  }

  const batchResults: BatchInventoryLineResult[] = submit.data?.results ?? [];
  const totalPieces = cart.reduce((s, l) => s + l.qty, 0);

  // Estado del lote compartido con el drawer: el desenlace del alta se pinta DENTRO del modal
  // (el panel lo sigue pintando para cuando el drawer está cerrado).
  const batch: CaptureBatchState = {
    lines: cart,
    totalPieces,
    isPending: submit.isPending,
    isError: submit.isError,
    error: submit.error,
    result: submit.data ?? null,
    queue: queueLine,
    queueAndSubmit,
    submit: submitBatch,
    clear: clearBatch,
    removeLine,
  };

  return (
    <div className="flex flex-col gap-6">
      {selectedSet ? (
        <MasterSetBinder
          mode={mode}
          userId={userId}
          set={selectedSet}
          onBack={() => {
            setSelectedSet(null);
            onSetOpened?.(null);
          }}
          onOpenCell={(cell) => setOpenCell(cell)}
          onAddVariant={onAddToSellCart}
          onAddProduct={onAddProductToSellCart}
          onOpenVariant={onOpenVariant}
        />
      ) : (
        <MasterSetIndex
          mode={mode}
          userId={userId}
          onOpenSet={(s) => {
            setSelectedSet(s);
            onSetOpened?.(s);
          }}
        />
      )}

      {/* Lote de alta al inventario (#12): SOLO M1 (modo platform). El carrito NO aplica a admin:
          aquí se acumulan líneas de ALTA y se confirman por lote (también desde el drawer). */}
      {isPlatform && cart.length > 0 && (
        <section className="border border-border-strong bg-surface-2 p-4" aria-label={t('batchTitle')}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-h3">
              <Package size={18} aria-hidden /> {t('batchTitle')}
            </h3>
            <span className="font-mono tabular-nums text-xs text-muted">
              {t('batchSummary', { lines: cart.length, pieces: totalPieces })}
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
                  aria-label={t('batchRemove')}
                >
                  <Trash2 size={16} />
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button onClick={submitBatch} loading={submit.isPending} disabled={submit.isPending}>
              {t('batchSubmit', { count: totalPieces })}
            </Button>
            <Button variant="secondary" onClick={clearBatch} disabled={submit.isPending}>
              {t('batchClear')}
            </Button>
          </div>
        </section>
      )}

      {/* Resultado del lote: tolerante por-línea. Con el drawer ABIERTO el desenlace lo pinta el
          pie del modal (T3) — aquí se omite para no duplicar el aviso (ni el anuncio aria-live). */}
      {isPlatform && submit.data && !openCell && (
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
      {/* Error del lote: idem — con el drawer abierto se pinta (traducido) en el pie del modal. */}
      {isPlatform && submit.isError && !openCell && (
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
          batch={isPlatform ? batch : undefined}
          onPublished={invalidateAggregates}
          onAdjusted={invalidateAggregates}
          onBuyMissing={onBuyMissing}
        />
      )}
    </div>
  );
}

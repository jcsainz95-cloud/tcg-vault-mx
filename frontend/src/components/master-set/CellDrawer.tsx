'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getAdminInventory, bulkPublishItems, createInventoryAdjustment } from '@/lib/api';
import type {
  AcquisitionType,
  AdjustmentReason,
  Finish,
  GradingCompany,
  InventoryAdjustmentRequest,
  InventoryStatus,
  MasterSetCardCellDTO,
  ProductType,
  VaultLocationDTO,
  BulkPublishLineResult,
} from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Banner } from '@/components/ui/Banner';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { PerLineErrors } from './PerLineErrors';
import { FINISH_ORDER } from '@/lib/finish';
import { localUid, type CaptureBatchState, type CaptureLine } from './capture';
import type { MasterSetViewMode } from './mode';

// En el binder solo hay cartas numeradas → alta rápida de raw o gradeada (sellado se gestiona
// en la pestaña "Piezas"). El acabado solo aplica a raw; graded es siempre normal.
const PRODUCT_TYPES: ProductType[] = ['raw', 'graded'];
const ACQ: AcquisitionType[] = ['aportacion_en_especie', 'compra'];
const GRADING_COMPANIES: GradingCompany[] = ['PSA', 'CGC'];
const ADJUST_REASONS: AdjustmentReason[] = ['encontrada', 'perdida', 'danada', 'error_captura'];
// Solo estos status de ORIGEN son publicables (contrato §M1 v1.16.1 / ITEM_NOT_PUBLISHABLE):
// `in_stock` → publica; `listed` → no-op idempotente. Cualquier otro lo rechaza el backend.
// El guardarraíl server-side se queda; deshabilitar aquí es solo UX (no ofrecer lo que va a fallar).
const PUBLISHABLE_STATUSES: InventoryStatus[] = ['in_stock', 'listed'];

interface Props {
  mode: MasterSetViewMode;
  cell: MasterSetCardCellDTO;
  /** Solo modo platform (ubicaciones del alta rápida). */
  locations?: VaultLocationDTO[];
  onClose: () => void;
  /**
   * Solo modo platform: LOTE de alta al inventario (estado + acciones, dueño = MasterSetPanel).
   * El drawer lo pinta DENTRO del modal para que el alta sea concluyente y visible sin cerrar
   * ni hacer scroll (el segundo paso vivía debajo de la cuadrícula, tapado por el overlay).
   */
  batch?: CaptureBatchState;
  /** Solo modo platform: refresca agregados tras publicar. */
  onPublished?: () => void;
  /** Solo modo platform: refresca agregados tras un ajuste por levantamiento físico. */
  onAdjusted?: () => void;
  /**
   * Solo modo user_vault_self: agrega la pieza `buyable` (inventoryItemId) al carrito de
   * COMPRA del storefront. El binder NO crea órdenes: el checkout es el flujo normal (§4).
   */
  onBuyMissing?: (inventoryItemId: string) => void;
}

/**
 * Drawer COMPARTIDO de celda (§4.20f). Todas las vistas muestran las CASILLAS POR ACABADO
 * (variants[] v1.20). Las acciones dependen del modo: captura/publicación/ajuste SOLO en
 * `platform` (M1); CTA de compra de faltantes SOLO en `user_vault_self`; `user_vault_admin`
 * es lectura pura. Sin venta directa manual en ningún modo (contrato §M1 v1.20).
 */
export function CellDrawer({
  mode,
  cell,
  locations = [],
  onClose,
  batch,
  onPublished,
  onAdjusted,
  onBuyMissing,
}: Props) {
  return (
    <Modal
      open
      onClose={onClose}
      title={`${cell.name} · #${cell.number}`}
      /* El lote pendiente vive en el PIE FIJO del modal: siempre visible mientras el operador
         captura, sin scroll y sin cerrar nada (T3). */
      footer={mode === 'platform' && batch ? <BatchFooter batch={batch} /> : undefined}
    >
      <div className="flex flex-col gap-6">
        <VariantSlots cell={cell} mode={mode} onBuyMissing={onBuyMissing} />
        {mode === 'platform' && (
          <>
            <QuickAddSection cell={cell} locations={locations} batch={batch} />
            <PlatformPiecesSection cell={cell} onPublished={onPublished} onAdjusted={onAdjusted} />
          </>
        )}
      </div>
    </Modal>
  );
}

/**
 * Pie del drawer de M1 (T3): resultado del alta y lote pendiente, SIEMPRE a la vista.
 *
 * Antes: «Agregar al carrito» encolaba la línea y el botón que REALMENTE daba de alta vivía
 * debajo de toda la cuadrícula del binder, tapado por el overlay del modal → para el operador
 * «no pasaba nada». Ahora el desenlace (piezas creadas / error / lote pendiente + su botón de
 * confirmación) se pinta en el pie fijo del propio modal.
 */
function BatchFooter({ batch }: { batch: CaptureBatchState }) {
  const t = useTranslations('masterSet');
  const errorMessage = useErrorMessage();
  const result = batch.result;
  const hasLines = batch.lines.length > 0;

  if (!hasLines && !result && !batch.isError) return null;

  return (
    <div className="flex w-full flex-col gap-2 border-t border-border pt-3">
      {/* Error VISIBLE junto al botón que falló (antes se pintaba al fondo de la página). */}
      {batch.isError && (
        <Banner variant="danger" role="alert">
          {errorMessage(batch.error)}
        </Banner>
      )}
      {result && !hasLines && (
        <Banner variant={result.summary.failedLines > 0 ? 'warning' : 'success'} role="status">
          {t('batchResult', {
            created: result.summary.createdItems,
            failed: result.summary.failedLines,
          })}
          {result.idempotentReplay ? ` · ${t('batchReplay')}` : ''}
        </Banner>
      )}
      {result && (
        <PerLineErrors
          lines={result.results.map((r, i) => ({
            ok: r.ok,
            label: r.ok ? r.folios.join(', ') : t('lineLabel', { index: i + 1 }),
            code: r.ok ? undefined : r.error.code,
            message: r.ok ? undefined : r.error.message,
          }))}
        />
      )}
      {hasLines && (
        <>
          <p className="font-mono text-xs uppercase tracking-wide text-muted">
            {t('batchPending')} · {t('batchSummary', { lines: batch.lines.length, pieces: batch.totalPieces })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={batch.submit} loading={batch.isPending} disabled={batch.isPending}>
              {t('batchSubmit', { count: batch.totalPieces })}
            </Button>
            <Button variant="secondary" onClick={batch.clear} disabled={batch.isPending}>
              {t('batchClear')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Casillas por acabado (todas las vistas) — v1.22: UNA CASILLA DE IMAGEN POR VARIANTE REAL, en
 * el orden del array (`normal` izquierda → `reverse_holo` derecha), todas con la MISMA imagen de
 * catálogo de la carta (pokemontcg.io publica una sola imagen; el contrato NO lleva imagen por
 * acabado). Cubierta → conteo; faltante → HUECO (marco punteado + arte atenuado). En la vista del
 * cliente (iii) una variante faltante con `buyable` ofrece el CTA de COMPRA (un clic agrega la
 * pieza al carrito del storefront); `buyable=null` → "No disponible" (no clicable).
 */
function VariantSlots({
  cell,
  mode,
  onBuyMissing,
}: {
  cell: MasterSetCardCellDTO;
  mode: MasterSetViewMode;
  onBuyMissing?: (inventoryItemId: string) => void;
}) {
  const t = useTranslations('masterSet');
  const tFinish = useTranslations('finish');
  const locale = useLocale() as AppLocale;
  const [addedId, setAddedId] = useState<string | null>(null);

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-h3">{t('variantsTitle')}</h3>
      <ul
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, cell.variants.length)}, minmax(0, 1fr))` }}
      >
        {cell.variants.map((v) => (
          <li key={v.finish} className="flex flex-col gap-1">
            <span
              className={`block aspect-[5/7] w-full overflow-hidden border bg-surface-2 ${
                v.covered ? 'border-border' : 'border-dashed border-border-strong'
              }`}
            >
              {cell.imageSmallUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cell.imageSmallUrl}
                  alt=""
                  aria-hidden
                  loading="lazy"
                  className={`h-full w-full object-contain ${v.covered ? '' : 'opacity-30'}`}
                />
              ) : null}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wide">{tFinish(v.finish)}</span>
            {v.covered ? (
              <span className="font-mono tabular-nums text-xs">
                {t('totalCount', { count: v.count })}
              </span>
            ) : (
              <>
                <span className="font-mono text-[10px] uppercase tracking-wide text-accent">
                  {t('gap')}
                </span>
                {/* CTA de compra: SOLO vista (iii); el DTO ya omitió `buyable` en scopes admin. */}
                {mode === 'user_vault_self' &&
                  (v.buyable ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        onBuyMissing?.(v.buyable!.inventoryItemId);
                        setAddedId(v.buyable!.inventoryItemId);
                      }}
                    >
                      {t('buyCta', { price: formatMoneyCents(v.buyable.salePriceCents, locale) })}
                    </Button>
                  ) : (
                    <span className="font-mono text-[10px] uppercase tracking-wide text-muted">
                      {t('notAvailable')}
                    </span>
                  ))}
              </>
            )}
          </li>
        ))}
      </ul>
      {addedId && (
        <Banner variant="success" role="status">
          {t('buyAdded')}
        </Banner>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------
// Secciones SOLO de M1 (modo platform): alta rápida, publicación por lote y ajuste.
// ---------------------------------------------------------------------------------------

/**
 * Alta rápida al INVENTARIO (M1 admin). Regla de producto: **el carrito NO aplica a admin** —
 * cliente (Mi bóveda) → carrito de compra; cotizador (Vender) → carrito de venta; admin → ALTA
 * al inventario. Por eso el copy de esta sección habla de alta/inventario/lote.
 *
 * Dos acciones, ninguna ambigua (T3):
 *  - **Dar de alta al inventario** (primaria): encola la línea Y envía el lote en el MISMO clic
 *    → el operador ve el folio creado (o el error) sin cerrar el modal ni hacer scroll.
 *  - **Agregar al lote** (secundaria): conserva el alta por LOTE (P-5) para capturar varias
 *    cartas y confirmarlas de una sola vez desde el pie del modal.
 */
function QuickAddSection({
  cell,
  locations,
  batch,
}: {
  cell: MasterSetCardCellDTO;
  locations: VaultLocationDTO[];
  batch?: CaptureBatchState;
}) {
  const t = useTranslations('masterSet');
  const tp = useTranslations('admin.m1');
  const tFinish = useTranslations('finish');
  const tc = useTranslations('common');

  const availableFinishes = FINISH_ORDER.filter((f) => cell.availableFinishes.includes(f));
  const [productType, setProductType] = useState<ProductType>('raw');
  const [finish, setFinish] = useState<Finish>(availableFinishes[0] ?? 'normal');
  const [acq, setAcq] = useState<AcquisitionType>('aportacion_en_especie');
  const [pct, setPct] = useState('70');
  const [qty, setQty] = useState('1');
  const [gradingCompany, setGradingCompany] = useState<GradingCompany>('PSA');
  const [gradeValue, setGradeValue] = useState('10');
  const [certNumber, setCertNumber] = useState('');
  const [locationId, setLocationId] = useState('');
  const [queued, setQueued] = useState(false);

  const gradedCertMissing = productType === 'graded' && certNumber.trim() === '';
  const qtyNum = Math.max(1, Math.floor(Number(qty) || 1));

  function buildLine(): CaptureLine {
    return {
      key: localUid('line'),
      cardId: cell.cardId,
      cardName: cell.name,
      number: cell.number,
      productType,
      finish: productType === 'raw' ? finish : 'normal',
      rawCondition: productType === 'raw' ? 'NM' : undefined,
      gradingCompany: productType === 'graded' ? gradingCompany : undefined,
      gradeValue: productType === 'graded' ? gradeValue : undefined,
      certNumber: productType === 'graded' ? certNumber.trim() : undefined,
      locationId: locationId || undefined,
      acquisitionType: acq,
      acquisitionPct: acq === 'aportacion_en_especie' ? Number(pct) : undefined,
      qty: productType === 'graded' ? 1 : qtyNum,
    };
  }

  /** Alta INMEDIATA (primaria): encola + envía. El desenlace lo pinta el pie del modal. */
  function intakeNow() {
    if (!batch) return;
    setQueued(false);
    batch.queueAndSubmit(buildLine());
    setCertNumber('');
  }

  /** Alta por LOTE (secundaria): solo encola; se confirma desde el pie del modal. */
  function queueLine() {
    if (!batch) return;
    batch.queue(buildLine());
    setQueued(true);
    setCertNumber('');
  }

  return (
    <section className="flex flex-col gap-3 border-t border-border pt-4">
      <h3 className="text-h3">{t('quickIntakeTitle')}</h3>
      <Select
        label={tp('productType')}
        options={PRODUCT_TYPES.map((p) => ({ value: p, label: tp(`productTypeLabel.${p}`) }))}
        value={productType}
        onChange={(e) => setProductType(e.target.value as ProductType)}
      />
      {productType === 'raw' && availableFinishes.length > 1 && (
        <Select
          label={tp('finish')}
          options={availableFinishes.map((f) => ({ value: f, label: tFinish(f) }))}
          value={finish}
          onChange={(e) => setFinish(e.target.value as Finish)}
        />
      )}
      {productType === 'graded' && (
        <>
          <Select
            label={tp('gradingCompany')}
            options={GRADING_COMPANIES.map((g) => ({ value: g, label: g }))}
            value={gradingCompany}
            onChange={(e) => setGradingCompany(e.target.value as GradingCompany)}
          />
          <Input
            label={tp('gradeValue')}
            inputMode="decimal"
            value={gradeValue}
            onChange={(e) => setGradeValue(e.target.value)}
          />
          <Input
            label={tp('certNumberRequired')}
            inputMode="numeric"
            value={certNumber}
            onChange={(e) => setCertNumber(e.target.value)}
            error={gradedCertMissing ? tp('certNumberError') : undefined}
          />
        </>
      )}
      <Select
        label={tp('acquisitionType')}
        options={ACQ.map((a) => ({ value: a, label: tp(`acquisitionLabel.${a}`) }))}
        value={acq}
        onChange={(e) => setAcq(e.target.value as AcquisitionType)}
      />
      {acq === 'aportacion_en_especie' && (
        <Input label={tp('acquisitionPct')} inputMode="numeric" value={pct} onChange={(e) => setPct(e.target.value)} />
      )}
      {productType === 'raw' && (
        <Input label={t('qty')} type="number" min={1} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
      )}
      {locations.length > 0 && (
        <Select
          label={tp('location')}
          options={[{ value: '', label: tc('all') }, ...locations.map((l) => ({ value: l.id, label: l.label }))]}
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
        />
      )}
      {/* Sin lote cableado NO hay alta posible: se dice, no se finge éxito (antes `setAdded(true)`
          corría aunque el callback fuera undefined → éxito falso). */}
      {batch ? (
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={intakeNow}
            disabled={gradedCertMissing || batch.isPending}
            loading={batch.isPending}
          >
            {t('addToInventory')}
          </Button>
          <Button variant="secondary" onClick={queueLine} disabled={gradedCertMissing || batch.isPending}>
            {t('addToBatch')}
          </Button>
        </div>
      ) : (
        <Banner variant="danger" role="alert">
          {t('intakeUnavailable')}
        </Banner>
      )}
      {queued && (
        <Banner variant="success" role="status">
          {t('addedToBatch')}
        </Banner>
      )}
    </section>
  );
}

/**
 * Piezas EXISTENTES de la carta (solo M1): publicar por lote + ajuste por levantamiento
 * físico. Comparten la query de piezas (`ownerType=platform`).
 */
function PlatformPiecesSection({
  cell,
  onPublished,
  onAdjusted,
}: {
  cell: MasterSetCardCellDTO;
  onPublished?: () => void;
  onAdjusted?: () => void;
}) {
  const t = useTranslations('masterSet');
  const tFinish = useTranslations('finish');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();

  const pieces = useQuery({
    queryKey: ['cell-pieces', cell.cardId],
    queryFn: () => getAdminInventory({ cardId: cell.cardId, ownerType: 'platform', pageSize: 100 }),
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // batchKey ESTABLE por SESIÓN DE PUBLICACIÓN (techlead #1): se fija una vez y solo se regenera
  // tras un éxito confirmado. Un reintento por timeout reusa la MISMA key → replay idempotente en
  // el backend → no se re-publica ni se duplica. Generarla en cada mutate() lo derrotaría.
  const publishKeyRef = useRef<string | null>(null);
  function ensurePublishKey(): string {
    if (publishKeyRef.current === null) publishKeyRef.current = localUid('pub');
    return publishKeyRef.current;
  }

  const publish = useMutation({
    mutationFn: () =>
      bulkPublishItems({
        batchKey: ensurePublishKey(),
        items: [...selected].map((inventoryItemId) => ({ inventoryItemId })),
      }),
    onSuccess: () => {
      setSelected(new Set());
      // Sesión cerrada con éxito → la próxima publicación arranca con una batchKey NUEVA.
      publishKeyRef.current = null;
      void pieces.refetch();
      onPublished?.();
    },
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const publishResults: BulkPublishLineResult[] = publish.data?.results ?? [];

  // ---- Ajuste por levantamiento físico (contrato §M1 v1.20.1) ----
  const ta = useTranslations('masterSet.adjust');
  const availableFinishes = FINISH_ORDER.filter((f) => cell.availableFinishes.includes(f));
  const [reason, setReason] = useState<AdjustmentReason>('encontrada');
  const [adjustItemId, setAdjustItemId] = useState('');
  const [adjustFinish, setAdjustFinish] = useState<Finish>(availableFinishes[0] ?? 'normal');
  const [adjustQty, setAdjustQty] = useState('1');
  const [note, setNote] = useState('');
  // batchKey ESTABLE por intento de `encontrada` (v1.20.1, mismo patrón que el alta por lote):
  // se genera al montar y SOLO rota tras un submit exitoso. Un doble submit / retry del mismo
  // intento reusa la MISMA clave → el backend hace replay idempotente y no duplica piezas.
  const [adjustBatchKey, setAdjustBatchKey] = useState(() => localUid('adj'));

  // Solo piezas platform en {in_stock, listed} son ajustables (422 ITEM_NOT_ADJUSTABLE resto).
  const adjustablePieces = useMemo(
    () => (pieces.data?.data ?? []).filter((p) => p.status === 'in_stock' || p.status === 'listed'),
    [pieces.data],
  );
  const noteMissing = reason !== 'encontrada' && note.trim() === '';
  const pieceMissing = reason !== 'encontrada' && adjustItemId === '';

  const adjust = useMutation({
    mutationFn: () => {
      const payload: InventoryAdjustmentRequest =
        reason === 'encontrada'
          ? {
              reason,
              item: {
                cardId: cell.cardId,
                productType: 'raw',
                rawCondition: 'NM',
                finish: adjustFinish,
                // Default del contrato explícito: aportación en especie (costo server-side).
                acquisitionType: 'aportacion_en_especie',
                qty: Math.max(1, Math.floor(Number(adjustQty) || 1)),
              },
              ...(note.trim() ? { note: note.trim() } : {}),
              // Idempotencia v1.20.1: clave estable del intento (SOLO en `encontrada`).
              batchKey: adjustBatchKey,
            }
          : { reason, inventoryItemId: adjustItemId, note: note.trim() };
      return createInventoryAdjustment(payload);
    },
    onSuccess: (data) => {
      setNote('');
      setAdjustItemId('');
      // El intento se consumió (fresco o replay): la siguiente intención usa clave nueva.
      setAdjustBatchKey(localUid('adj'));
      if (!data.idempotentReplay) {
        // Solo un procesamiento NUEVO cambia agregados; un replay muestra el MISMO éxito
        // (Banner desde adjust.data) sin refrescar doble ni duplicar avisos.
        void pieces.refetch();
        onAdjusted?.();
      }
    },
  });

  return (
    <>
      {/* ---- Publicar piezas de ESTA carta (bulk-publish) ---- */}
      <section className="flex flex-col gap-3 border-t border-border pt-4">
        <h3 className="text-h3">{t('publishPiecesTitle')}</h3>
        <QueryState
          isLoading={pieces.isLoading}
          isError={pieces.isError}
          error={pieces.error}
          onRetry={() => pieces.refetch()}
        >
          {pieces.data &&
            (pieces.data.data.length === 0 ? (
              <p className="text-sm text-muted">{t('noPieces')}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {pieces.data.data.map((piece) => {
                  // UX: no ofrecer publicar piezas en un status no publicable (evita el
                  // ITEM_NOT_PUBLISHABLE seguro). El backend sigue siendo la autoridad.
                  const publishable = PUBLISHABLE_STATUSES.includes(piece.status);
                  return (
                    <li key={piece.id}>
                      <label
                        className={`flex items-center gap-3 border border-border px-3 py-2 text-sm ${
                          publishable ? '' : 'cursor-not-allowed opacity-60'
                        }`}
                        title={publishable ? undefined : t('notPublishableHint')}
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(piece.id)}
                          onChange={() => toggle(piece.id)}
                          disabled={!publishable}
                          className="h-5 w-5 accent-[color:var(--color-accent)] disabled:cursor-not-allowed"
                        />
                        <span className="font-mono tabular-nums text-xs">{piece.folio}</span>
                        {piece.finish && (
                          <span className="font-mono text-[10px] uppercase tracking-wide text-muted">
                            {tFinish(piece.finish)}
                          </span>
                        )}
                        <span className="ml-auto">
                          <StatusBadge domain="inventory" value={piece.status} />
                        </span>
                      </label>
                      {!publishable && (
                        <p className="px-3 pt-0.5 text-[10px] text-muted">{t('notPublishableHint')}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            ))}
        </QueryState>

        <Button
          onClick={() => publish.mutate()}
          disabled={selected.size === 0 || publish.isPending}
          loading={publish.isPending}
        >
          {t('publishSelected', { count: selected.size })}
        </Button>

        {/* Render tolerante por-línea: ITEM_NOT_PUBLISHABLE / PRICE_PENDING no tumban el resto. */}
        {publish.data && (
          <div className="flex flex-col gap-2">
            <Banner variant={publish.data.summary.failedLines > 0 ? 'warning' : 'success'} role="status">
              {t('publishResult', {
                published: publish.data.summary.published,
                failed: publish.data.summary.failedLines,
              })}
            </Banner>
            <PerLineErrors
              lines={publishResults.map((r) => ({
                ok: r.ok,
                label: r.inventoryItemId,
                code: r.ok ? undefined : r.error.code,
                message: r.ok ? undefined : r.error.message,
              }))}
            />
          </div>
        )}
        {publish.isError && (
          <Banner variant="danger" role="alert">
            {tc('errorGeneric')}
          </Banner>
        )}
      </section>

      {/* ---- Ajuste por levantamiento físico (v1.20.1): motivo OBLIGATORIO; sin venta manual ---- */}
      <section className="flex flex-col gap-3 border-t border-border pt-4">
        <h3 className="text-h3">{ta('title')}</h3>
        <Select
          label={ta('reasonLabel')}
          options={ADJUST_REASONS.map((r) => ({ value: r, label: ta(`reason.${r}`) }))}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value as AdjustmentReason);
            adjust.reset();
          }}
        />
        {reason === 'encontrada' ? (
          <>
            {availableFinishes.length > 1 && (
              <Select
                label={t('filterFinish')}
                options={availableFinishes.map((f) => ({ value: f, label: tFinish(f) }))}
                value={adjustFinish}
                onChange={(e) => setAdjustFinish(e.target.value as Finish)}
              />
            )}
            <Input
              label={ta('qty')}
              type="number"
              min={1}
              inputMode="numeric"
              value={adjustQty}
              onChange={(e) => setAdjustQty(e.target.value)}
            />
            <Input label={ta('noteOptional')} value={note} onChange={(e) => setNote(e.target.value)} />
          </>
        ) : (
          <>
            {adjustablePieces.length === 0 ? (
              <p className="text-sm text-muted">{ta('noAdjustablePieces')}</p>
            ) : (
              <Select
                label={ta('pieceLabel')}
                options={[
                  { value: '', label: '—' },
                  ...adjustablePieces.map((p) => ({
                    value: p.id,
                    label: `${p.folio}${p.finish ? ` · ${tFinish(p.finish)}` : ''}`,
                  })),
                ]}
                value={adjustItemId}
                onChange={(e) => setAdjustItemId(e.target.value)}
              />
            )}
            <Input
              label={ta('noteRequired')}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              error={noteMissing && adjust.isError ? ta('noteError') : undefined}
            />
          </>
        )}
        <Button
          onClick={() => adjust.mutate()}
          disabled={adjust.isPending || noteMissing || pieceMissing}
          loading={adjust.isPending}
        >
          {ta('submit')}
        </Button>
        {adjust.data && (
          <Banner variant="success" role="status">
            {ta('success', { folios: adjust.data.folios.join(', ') })}
          </Banner>
        )}
        {adjust.isError && (
          <Banner variant="danger" role="alert">
            {errorMessage(adjust.error)}
          </Banner>
        )}
      </section>
    </>
  );
}

'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getAdminInventory, bulkPublishItems } from '@/lib/api';
import type {
  AcquisitionType,
  Finish,
  GradingCompany,
  InventoryStatus,
  MasterSetCardCellDTO,
  ProductType,
  VaultLocationDTO,
  BulkPublishLineResult,
} from '@/types/contract';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Banner } from '@/components/ui/Banner';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { QueryState } from '@/components/ui/QueryState';
import { PerLineErrors } from './PerLineErrors';
import { FINISH_ORDER } from '@/lib/finish';
import { localUid, type CaptureLine } from './capture';

// En el binder solo hay cartas numeradas → alta rápida de raw o gradeada (sellado se gestiona
// en la pestaña "Piezas"). El acabado solo aplica a raw; graded es siempre normal.
const PRODUCT_TYPES: ProductType[] = ['raw', 'graded'];
const ACQ: AcquisitionType[] = ['aportacion_en_especie', 'compra'];
const GRADING_COMPANIES: GradingCompany[] = ['PSA', 'CGC'];
// Solo estos status de ORIGEN son publicables (contrato §M1 v1.16.1 / ITEM_NOT_PUBLISHABLE):
// `in_stock` → publica; `listed` → no-op idempotente. Cualquier otro lo rechaza el backend.
// El guardarraíl server-side se queda; deshabilitar aquí es solo UX (no ofrecer lo que va a fallar).
const PUBLISHABLE_STATUSES: InventoryStatus[] = ['in_stock', 'listed'];

interface Props {
  cell: MasterSetCardCellDTO;
  locations: VaultLocationDTO[];
  onClose: () => void;
  onAddToCart: (line: CaptureLine) => void;
  onPublished: () => void;
}

export function CellDrawer({ cell, locations, onClose, onAddToCart, onPublished }: Props) {
  const t = useTranslations('admin.m1.masterSet');
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
  const [added, setAdded] = useState(false);

  // Piezas EXISTENTES de esta carta (para publicar por lote). ownerType=platform.
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
      onPublished();
    },
  });

  const gradedCertMissing = productType === 'graded' && certNumber.trim() === '';
  const qtyNum = Math.max(1, Math.floor(Number(qty) || 1));

  function addLine() {
    const line: CaptureLine = {
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
    onAddToCart(line);
    setAdded(true);
    setCertNumber('');
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const publishResults: BulkPublishLineResult[] = publish.data?.results ?? [];

  return (
    <Modal open onClose={onClose} title={`${cell.name} · #${cell.number}`}>
      <div className="flex flex-col gap-6">
        {/* ---- Alta rápida → carrito de captura (#12) ---- */}
        <section className="flex flex-col gap-3">
          <h3 className="text-h3">{t('quickAddTitle')}</h3>
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
          <Button onClick={addLine} disabled={gradedCertMissing}>
            {t('addToCart')}
          </Button>
          {added && (
            <Banner variant="success" role="status">
              {t('addedToCart')}
            </Banner>
          )}
        </section>

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
      </div>
    </Modal>
  );
}

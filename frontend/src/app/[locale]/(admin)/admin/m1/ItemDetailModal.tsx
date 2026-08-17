'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowRightLeft, Megaphone, TriangleAlert } from 'lucide-react';
import {
  getAdminInventoryItem,
  updateInventoryItem,
  moveInventoryItem,
  markInventoryItem,
} from '@/lib/api';
import type { InventoryMovementDTO, VaultLocationDTO } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatDate, formatMoneyCents } from '@/lib/format';
import { FinishBadge } from '@/components/domain/FinishBadge';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PriceTag } from '@/components/ui/PriceTag';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';

export interface ItemDetailModalProps {
  itemId: string | null;
  onClose: () => void;
  locations: VaultLocationDTO[];
}

/**
 * Detalle por pieza (contrato §M1 · GET /admin/inventory/items/:id): folio + acabado +
 * estado + ubicación + historial de movimientos, con las acciones de gestión del operador:
 *  - Publicar / retirar de venta (PATCH :id → status listed|in_stock + listPriceCents manual).
 *  - Mover a otra ubicación (POST :id/move).
 *  - Marcar perdida/dañada (POST :id/mark, nota obligatoria).
 * Cada acción confirma con Banner, muestra el error REAL del contrato y refresca
 * ['admin-inventory'] + el detalle.
 */
export function ItemDetailModal({ itemId, onClose, locations }: ItemDetailModalProps) {
  const t = useTranslations('admin.m1');
  const tc = useTranslations('common');
  // Etiquetas de estado de inventario ya existentes (catálogo global `status.inventory`).
  const tInv = useTranslations('status.inventory');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const getError = useErrorMessage();

  const detail = useQuery({
    queryKey: ['admin-inventory-item', itemId],
    queryFn: () => getAdminInventoryItem(itemId!),
    enabled: !!itemId,
  });
  const item = detail.data;

  // --- Publicar / retirar de venta ---
  // El operador captura el precio en PESOS; se convierte a centavos con Math.round.
  // Es un precio de venta MANUAL (override), no una derivación en cliente (SEC-A1).
  const [price, setPrice] = useState('');
  const priceCents = price.trim() === '' ? undefined : Math.round(Number(price) * 100);
  const priceInvalid = price.trim() !== '' && (!Number.isFinite(priceCents!) || priceCents! < 0);
  // Sellado publicable exige precio manual: sin listPriceCents previo ni capturado, se bloquea.
  const sealedNeedsPrice =
    item?.productType === 'sealed' && priceCents == null && item.listPriceCents == null;

  const publish = useMutation({
    mutationFn: (status: 'listed' | 'in_stock') =>
      updateInventoryItem(itemId!, {
        status,
        ...(priceCents != null ? { listPriceCents: priceCents } : {}),
      }),
    onSuccess: () => {
      setPrice('');
      void qc.invalidateQueries({ queryKey: ['admin-inventory'] });
      void qc.invalidateQueries({ queryKey: ['admin-inventory-item', itemId] });
    },
  });

  // --- Mover de ubicación ---
  const [toLocationId, setToLocationId] = useState('');
  const [moveNote, setMoveNote] = useState('');
  const move = useMutation({
    mutationFn: () => moveInventoryItem(itemId!, { toLocationId, note: moveNote || undefined }),
    onSuccess: () => {
      setToLocationId('');
      setMoveNote('');
      void qc.invalidateQueries({ queryKey: ['admin-inventory'] });
      void qc.invalidateQueries({ queryKey: ['admin-inventory-item', itemId] });
    },
  });

  // --- Marcar perdida / dañada (nota OBLIGATORIA por contrato) ---
  const [markKind, setMarkKind] = useState<'lost' | 'damaged'>('lost');
  const [markNote, setMarkNote] = useState('');
  // §7.6: las acciones destructivas exigen confirmación (M3/M8 ya confirman) → paso extra.
  const [markConfirmOpen, setMarkConfirmOpen] = useState(false);
  const mark = useMutation({
    mutationFn: () => markInventoryItem(itemId!, { mark: markKind, note: markNote.trim() }),
    onSuccess: () => {
      setMarkNote('');
      setMarkConfirmOpen(false);
      void qc.invalidateQueries({ queryKey: ['admin-inventory'] });
      void qc.invalidateQueries({ queryKey: ['admin-inventory-item', itemId] });
    },
  });

  // El estado de las acciones no cruza entre piezas.
  useEffect(() => {
    setPrice('');
    setToLocationId('');
    setMoveNote('');
    setMarkKind('lost');
    setMarkNote('');
    setMarkConfirmOpen(false);
    publish.reset();
    move.reset();
    mark.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  const locationLabel = (id?: string | null) =>
    id ? (locations.find((l) => l.id === id)?.label ?? id) : '—';

  // Solo tiene sentido mover/marcar piezas operables; una vendida/enviada/perdida no.
  const canPublish = item?.status === 'in_stock';
  const canUnlist = item?.status === 'listed';
  const canOperate = item?.status === 'in_stock' || item?.status === 'listed';

  return (
    <>
    <Modal
      open={!!itemId}
      onClose={onClose}
      title={t('detail.title')}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {tc('close')}
        </Button>
      }
    >
      <QueryState
        isLoading={detail.isLoading}
        isError={detail.isError}
        error={detail.error}
        onRetry={() => detail.refetch()}
      >
        {item && (
          <div className="flex flex-col gap-5">
            {/* Cabecera: folio + carta + acabado + estado + ubicación */}
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="tabular text-h3 font-semibold">{item.folio}</span>
                <StatusBadge domain="inventory" value={item.status} />
                {item.finish && <FinishBadge finish={item.finish} productType={item.productType} />}
              </div>
              <p className="text-sm">
                <span lang="en" className="font-medium">{item.card.name}</span>{' '}
                <span lang="en" className="text-muted">· {item.card.setName}</span>
              </p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted">{t('table.type')}</dt>
                {/* §9.2: nunca el enum crudo → label legible. */}
                <dd>{t(`productTypeLabel.${item.productType}`)}</dd>
                <dt className="text-muted">{t('table.location')}</dt>
                <dd className="tabular">{item.location?.label ?? '—'}</dd>
                {item.productType === 'graded' && (
                  <>
                    <dt className="text-muted">{t('gradeValue')}</dt>
                    <dd className="tabular">{item.gradingCompany} {item.gradeValue}</dd>
                    <dt className="text-muted">{t('detail.certNumber')}</dt>
                    <dd className="tabular">{item.certNumber ?? '—'}</dd>
                  </>
                )}
                <dt className="text-muted">{t('table.reference')}</dt>
                <dd>
                  {item.referenceValue ? (
                    <PriceTag reference={item.referenceValue} mode="reference" />
                  ) : (
                    '—'
                  )}
                </dd>
                <dt className="text-muted">{t('listPrice')}</dt>
                <dd className="tabular">
                  {item.listPriceCents != null ? formatMoneyCents(item.listPriceCents, locale) : '—'}
                </dd>
              </dl>
            </div>

            {/* Confirmaciones de acción (Banner) */}
            {publish.isSuccess && (
              <Banner variant="success" role="status">
                {publish.variables === 'listed'
                  ? t('publish.success', { folio: item.folio })
                  : t('publish.unlistSuccess', { folio: item.folio })}
              </Banner>
            )}
            {move.isSuccess && (
              <Banner variant="success" role="status">
                {t('move.success', { label: move.data?.location?.label ?? '' })}
              </Banner>
            )}
            {mark.isSuccess && (
              <Banner variant="success" role="status">
                {t('mark.success', { mark: t(`mark.${markKind}`) })}
              </Banner>
            )}

            {/* Publicar / retirar de venta */}
            {(canPublish || canUnlist) && (
              <section className="flex flex-col gap-3 rounded-lg border border-border p-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Megaphone size={16} aria-hidden /> {t('publish.title')}
                </h3>
                {canPublish && (
                  <>
                    <Input
                      label={t('publish.priceLabel')}
                      type="text"
                      inputMode="decimal"
                      prefix="MX$"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      error={priceInvalid ? t('publish.priceInvalid') : undefined}
                    />
                    <p className="text-xs text-muted">
                      {item.productType === 'sealed'
                        ? t('publish.priceRequiredSealed')
                        : t('publish.priceHint')}
                    </p>
                  </>
                )}
                {publish.isError && (
                  <Banner variant="danger" role="alert" title={t('publish.error')}>
                    {getError(publish.error)}
                  </Banner>
                )}
                <div className="flex gap-2">
                  {canPublish && (
                    <Button
                      onClick={() => publish.mutate('listed')}
                      disabled={publish.isPending || priceInvalid || sealedNeedsPrice}
                      loading={publish.isPending}
                    >
                      {t('publish.action')}
                    </Button>
                  )}
                  {canUnlist && (
                    <Button
                      variant="secondary"
                      onClick={() => publish.mutate('in_stock')}
                      disabled={publish.isPending}
                      loading={publish.isPending}
                    >
                      {t('publish.unlist')}
                    </Button>
                  )}
                </div>
              </section>
            )}

            {/* Mover de ubicación */}
            {canOperate && (
              <section className="flex flex-col gap-3 rounded-lg border border-border p-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <ArrowRightLeft size={16} aria-hidden /> {t('move.title')}
                </h3>
                <Select
                  label={t('move.target')}
                  placeholder={t('move.targetPlaceholder')}
                  options={locations
                    .filter((l) => l.id !== item.location?.id)
                    .map((l) => ({ value: l.id, label: `${l.label} · ${t(`zone.${l.zone}`)}` }))}
                  value={toLocationId}
                  onChange={(e) => setToLocationId(e.target.value)}
                />
                <Input
                  label={t('move.note')}
                  value={moveNote}
                  onChange={(e) => setMoveNote(e.target.value)}
                />
                {move.isError && (
                  <Banner variant="danger" role="alert" title={t('move.error')}>
                    {getError(move.error)}
                  </Banner>
                )}
                <div>
                  <Button
                    variant="secondary"
                    onClick={() => move.mutate()}
                    disabled={!toLocationId || move.isPending}
                    loading={move.isPending}
                  >
                    {t('move.action')}
                  </Button>
                </div>
              </section>
            )}

            {/* Marcar perdida / dañada */}
            {canOperate && (
              <section className="flex flex-col gap-3 rounded-lg border border-border p-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <TriangleAlert size={16} aria-hidden /> {t('mark.title')}
                </h3>
                <Banner variant="warning">{t('mark.warning')}</Banner>
                <Select
                  label={t('mark.kind')}
                  options={[
                    { value: 'lost', label: t('mark.lost') },
                    { value: 'damaged', label: t('mark.damaged') },
                  ]}
                  value={markKind}
                  onChange={(e) => setMarkKind(e.target.value as 'lost' | 'damaged')}
                />
                <Input
                  label={t('mark.note')}
                  required
                  value={markNote}
                  onChange={(e) => setMarkNote(e.target.value)}
                />
                {mark.isError && (
                  <Banner variant="danger" role="alert" title={t('mark.error')}>
                    {getError(mark.error)}
                  </Banner>
                )}
                <div>
                  <Button
                    variant="destructive"
                    onClick={() => setMarkConfirmOpen(true)}
                    disabled={markNote.trim() === '' || mark.isPending}
                    loading={mark.isPending}
                  >
                    {t('mark.action')}
                  </Button>
                </div>
              </section>
            )}

            {/* Historial de movimientos */}
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">{t('detail.movements')}</h3>
              {item.movements.length === 0 ? (
                <p className="text-sm text-muted">{t('detail.noMovements')}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {item.movements.map((m: InventoryMovementDTO) => (
                    <li
                      key={m.id}
                      className="flex flex-col gap-0.5 rounded-md border border-border px-3 py-2 text-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{t(`movementReason.${m.reason}`)}</span>
                        <span className="tabular text-xs text-muted">
                          {formatDate(m.createdAt, locale)}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
                        {(m.fromLocationId || m.toLocationId) && (
                          <span className="tabular">
                            {locationLabel(m.fromLocationId)} → {locationLabel(m.toLocationId)}
                          </span>
                        )}
                        {m.fromStatus && m.toStatus && m.fromStatus !== m.toStatus && (
                          <span>
                            {tInv(m.fromStatus)} → {tInv(m.toStatus)}
                          </span>
                        )}
                        {m.note && <span>{m.note}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </QueryState>
    </Modal>

      {/* Confirmación de acción destructiva (§7.6): marcar perdida/dañada mueve el item a
          reposición y queda en bitácora; se pide confirmar antes de disparar la mutación. */}
      <Modal
        open={markConfirmOpen}
        onClose={() => setMarkConfirmOpen(false)}
        title={t('mark.confirmTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setMarkConfirmOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button variant="destructive" loading={mark.isPending} onClick={() => mark.mutate()}>
              {t('mark.confirmCta', { mark: t(`mark.${markKind}`) })}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p>{t('mark.confirmQuestion', { mark: t(`mark.${markKind}`) })}</p>
          {mark.isError && (
            <Banner variant="danger" role="alert" title={t('mark.error')}>
              {getError(mark.error)}
            </Banner>
          )}
        </div>
      </Modal>
    </>
  );
}

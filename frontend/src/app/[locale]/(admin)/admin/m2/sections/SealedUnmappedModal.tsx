'use client';

import { useId, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { ExternalLink } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import {
  getAdminInventory,
  listSealedProducts,
  updateInventoryItem,
  updateSealedItemMapping,
} from '@/lib/api';
import type { InventoryItemDTO, PendingPriceEntryDTO, SealedProductDTO } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Banner } from '@/components/ui/Banner';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { SealedProductPicker } from '../../m1/SealedProductPicker';
import { pesosToCents, sanitizeDecimalInput, isSaveableRuleValue } from './shared';

/**
 * §M2-SK — las DOS salidas de una fila de sellado SIN MAPEAR en la cola de precio pendiente.
 *
 * `'sealed'` es una clave de COLA, nunca de PRECIO: una fila con `productType='sealed'` y
 * `gradeKey==='sealed'` no tiene clave de mercado, así que el «Fijar precio» de mercado terminaría en
 * `422 SEALED_MARKET_KEY_REQUIRED` (SK-3). Lo que sí existe, y es real:
 *   (1) **Ligar a su presentación** — `PUT /admin/pricing/sealed/items/:itemId/mapping` con
 *       `applyToSiblings:true` sobre la primera pieza sin mapeo de la fila (las demás copias del mismo
 *       `(cardId, sealedSubtype)` reciben el mismo mapeo; nunca se pisa un mapeo existente). Es la cura
 *       de raíz: desde el siguiente barrido la pieza se valúa bajo `sealed:tcg:<productId>`.
 *   (2) **Fijar el precio de esta pieza** — `PATCH /admin/inventory/items/:id { listPriceCents }` en
 *       cada pieza sin mapeo de la fila **que sea de la plataforma y esté en venta** (techlead T-1,
 *       2026-09-29: `ownerType='platform'` ∧ `status ∈ {in_stock, listed}`, el MISMO predicado que los
 *       ajustes de inventario, `contract.ts` «Solo piezas ownerType=platform con status ∈ {in_stock,
 *       listed} son ajustables»). Vendidas, en proceso, terminales y piezas de clientes en custodia NO
 *       reciben precio: se listan aparte como «N piezas no se tocan». (SK-4: precedencia #1 de §K; vive
 *       en la fila de la pieza ⇒ no puede cruzarse con otro producto). NO publica (M1).
 *
 * La fila de la cola no trae `inventoryItemId` (agrupa una CLASE de piezas), así que las piezas se
 * resuelven aquí con `GET /admin/inventory/items?cardId=&productType=sealed&pageSize=100` y se filtran
 * a las que NO tienen `tcgplayerProductId` y comparten `sealedSubtype` con la fila. Sin piezas ⇒ se
 * dice (fila legada anterior a P-79(d): la pieza ya está mapeada y la cierra el siguiente barrido).
 * Si el servidor dice `total > data.length`, la lista se CORTÓ (cap de 100, misma clase que FE-21): se
 * avisa y el precio NO se fija a ciegas, porque el conjunto en pantalla no es el conjunto real.
 */

export type SealedUnmappedMode = 'link' | 'price';

/** §M2-SK: fila de sellado SIN mapear ⇔ `productType='sealed'` ∧ `gradeKey === 'sealed'`. */
export function isSealedUnmapped(e: Pick<PendingPriceEntryDTO, 'productType' | 'gradeKey'>): boolean {
  return e.productType === 'sealed' && e.gradeKey === 'sealed';
}

/** Piezas de la fila: selladas, SIN mapeo, y de la misma presentación (si la fila la trae). */
export function unmappedPiecesFor(
  entry: Pick<PendingPriceEntryDTO, 'sealedSubtype'>,
  items: InventoryItemDTO[],
): InventoryItemDTO[] {
  return items.filter(
    (i) =>
      i.productType === 'sealed' &&
      i.tcgplayerProductId == null &&
      (entry.sealedSubtype == null || i.sealedSubtype === entry.sealedSubtype),
  );
}

/**
 * T-1: una pieza recibe precio de venta desde aquí SOLO si es de la plataforma y está en venta. Es el
 * predicado de «ajustable» del contrato (`ownerType=platform` ∧ `status ∈ {in_stock, listed}`): una pieza
 * vendida/en proceso/terminal o de un cliente en custodia no es nuestra para ponerle precio.
 */
export function isPlatformOnSale(i: Pick<InventoryItemDTO, 'ownerType' | 'status'>): boolean {
  return i.ownerType === 'platform' && (i.status === 'in_stock' || i.status === 'listed');
}

/** Partición del conjunto sin mapeo para «Fijar el precio»: las que se tocan y las que NO (y se dicen). */
export function splitPriceable(unmapped: InventoryItemDTO[]): {
  priceable: InventoryItemDTO[];
  skipped: InventoryItemDTO[];
} {
  const priceable: InventoryItemDTO[] = [];
  const skipped: InventoryItemDTO[] = [];
  for (const i of unmapped) (isPlatformOnSale(i) ? priceable : skipped).push(i);
  return { priceable, skipped };
}

/** Una pieza en la lista: folio · dueño · estado · precio de pieza si lo tiene. Dueño y estado SIEMPRE visibles (T-1). */
function PieceRow({ piece: p }: { piece: InventoryItemDTO }) {
  const t = useTranslations('admin.m2.pending.sealedUnmapped');
  const tStatus = useTranslations('status.inventory');
  const locale = useLocale() as AppLocale;
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className="tabular text-text">{p.folio}</span>
      <span>· {p.ownerType === 'platform' ? t('ownerPlatform') : t('ownerCustomer')}</span>
      <span>· {tStatus(p.status)}</span>
      {p.listPriceCents != null && <span className="tabular">· {formatMoneyCents(p.listPriceCents, locale)}</span>}
    </li>
  );
}

function displayName(e: PendingPriceEntryDTO): string {
  if (e.sealedProductName) return e.sealedProductName;
  return e.cardName ?? e.card?.name ?? e.cardId;
}

export interface SealedUnmappedModalProps {
  entry: PendingPriceEntryDTO;
  mode: SealedUnmappedMode;
  onClose: () => void;
}

export function SealedUnmappedModal({ entry, mode, onClose }: SealedUnmappedModalProps) {
  const t = useTranslations('admin.m2.pending.sealedUnmapped');
  const tPending = useTranslations('admin.m2.pending');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const getError = useErrorMessage('operator');
  const name = displayName(entry);
  const piecesLabelId = useId();
  const skippedLabelId = useId();

  const pieces = useQuery({
    queryKey: ['sealed-unmapped-pieces', entry.cardId],
    queryFn: () => getAdminInventory({ cardId: entry.cardId, productType: 'sealed', pageSize: 100 }),
  });
  const unmapped = useMemo(
    () => (pieces.data ? unmappedPiecesFor(entry, pieces.data.data) : []),
    [entry, pieces.data],
  );
  const { priceable, skipped } = useMemo(() => splitPriceable(unmapped), [unmapped]);
  // T-1 (2): cap silencioso (FE-21). `total` lo dice el servidor; si llegó menos, el conjunto está cortado.
  const fetchedCount = pieces.data?.data.length ?? 0;
  const totalCount = pieces.data?.total ?? 0;
  const truncated = pieces.data != null && totalCount > fetchedCount;
  const setId = unmapped[0]?.card.setId ?? null;

  // ---- (1) Ligar a su presentación ---------------------------------------------------------------
  const products = useQuery({
    queryKey: ['sealed-products', setId],
    queryFn: () => listSealedProducts({ setId: setId! }),
    enabled: mode === 'link' && setId != null,
  });
  const [selected, setSelected] = useState<SealedProductDTO | null>(null);
  const [linkDone, setLinkDone] = useState<{ count: number; product: string } | null>(null);
  const link = useMutation({
    mutationFn: async (p: SealedProductDTO) => {
      const res = await updateSealedItemMapping(unmapped[0].id, {
        tcgplayerProductId: p.tcgplayerProductId,
        tcgplayerGroupId: p.tcgplayerGroupId,
        applyToSiblings: true,
      });
      return { count: 1 + res.siblingsUpdated, product: p.cleanName ?? p.name };
    },
    onSuccess: (done) => {
      setLinkDone(done);
      void qc.invalidateQueries({ queryKey: ['pending-prices'] });
      void qc.invalidateQueries({ queryKey: ['sealed-unmapped-pieces'] });
      void qc.invalidateQueries({ queryKey: ['sealed-sets'] });
      void qc.invalidateQueries({ queryKey: ['sealed-set-detail'] });
    },
  });

  // ---- (2) Fijar el precio de esta pieza ----------------------------------------------------------
  const [priceValue, setPriceValue] = useState('');
  const [priceDone, setPriceDone] = useState<{ count: number; cents: number } | null>(null);
  // S-L1 money-safe: vacío o mal formado ("1.2.3") castearía a NaN→0 ⇒ MX$0. Mismo guard que el override.
  const priceInvalid = !isSaveableRuleValue(priceValue);
  // T-1: solo plataforma en venta, y nunca sobre una lista cortada.
  const canPrice = priceable.length > 0 && !priceInvalid && !truncated;
  const price = useMutation({
    mutationFn: async () => {
      const listPriceCents = pesosToCents(priceValue);
      await Promise.all(priceable.map((p) => updateInventoryItem(p.id, { listPriceCents })));
      return { count: priceable.length, cents: listPriceCents };
    },
    onSuccess: (done) => {
      setPriceDone(done);
      void qc.invalidateQueries({ queryKey: ['pending-prices'] });
      void qc.invalidateQueries({ queryKey: ['sealed-unmapped-pieces'] });
      void qc.invalidateQueries({ queryKey: ['sealed-sets'] });
      void qc.invalidateQueries({ queryKey: ['sealed-set-detail'] });
    },
  });

  const inventoryLink = (
    <Link href="/admin/m1?tab=sealed" className="inline-flex items-center gap-1 text-sm font-medium underline">
      {t('openInventory')} <ExternalLink size={14} />
    </Link>
  );

  const finished = mode === 'link' ? linkDone != null : priceDone != null;
  const busy = link.isPending || price.isPending;

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'link' ? t('linkTitle') : t('priceTitle')}
      footer={
        finished ? (
          <Button onClick={onClose}>{tc('close')}</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              {tc('cancel')}
            </Button>
            {mode === 'link' ? (
              <Button
                disabled={unmapped.length === 0 || !selected}
                loading={link.isPending}
                onClick={() => selected && unmapped.length > 0 && link.mutate(selected)}
              >
                {t('linkConfirm', { count: unmapped.length })}
              </Button>
            ) : (
              <Button disabled={!canPrice} loading={price.isPending} onClick={() => canPrice && price.mutate()}>
                {t('priceConfirm', { count: priceable.length })}
              </Button>
            )}
          </>
        )
      }
    >
      <div className="flex flex-col gap-3">
        <QueryState
          isLoading={pieces.isLoading}
          isError={pieces.isError}
          error={pieces.error}
          onRetry={() => pieces.refetch()}
        >
          {truncated && !finished && (
            <Banner variant="warning" role="alert" title={t('truncatedTitle')}>
              <p>{t('truncatedBody', { shown: fetchedCount, total: totalCount })}</p>
            </Banner>
          )}
          {unmapped.length === 0 && !finished ? (
            <div className="flex flex-col gap-2">
              <Banner variant="info" role="status">
                <p>{t('noPieces')}</p>
              </Banner>
              {inventoryLink}
            </div>
          ) : mode === 'link' ? (
            linkDone ? (
              <Banner variant="success" role="status">
                {t('linkDone', { count: linkDone.count, product: linkDone.product })}
              </Banner>
            ) : (
              <>
                <p className="text-sm text-muted">
                  {t('linkLead', { name, count: unmapped.length })}
                </p>
                <QueryState
                  isLoading={products.isLoading}
                  isError={products.isError}
                  error={products.error}
                  onRetry={() => products.refetch()}
                >
                  {products.data && !products.data.needsSync && products.data.data.length > 0 ? (
                    <SealedProductPicker
                      data={products.data.data}
                      setName={products.data.set.name}
                      selectedId={selected?.id ?? null}
                      onSelect={setSelected}
                    />
                  ) : (
                    <div className="flex flex-col gap-2">
                      <Banner variant="warning" role="alert">
                        <p>{t('linkNoCatalog')}</p>
                      </Banner>
                      {inventoryLink}
                    </div>
                  )}
                </QueryState>
                {link.isError && (
                  <Banner variant="danger" role="alert" title={tc('errorTitle')}>
                    {getError(link.error)}
                  </Banner>
                )}
              </>
            )
          ) : priceDone ? (
            <Banner variant="success" role="status">
              {t('priceDone', { count: priceDone.count, amount: formatMoneyCents(priceDone.cents, locale) })}
            </Banner>
          ) : (
            <>
              <p className="text-sm text-muted">{t('priceLead', { name, count: priceable.length })}</p>
              {priceable.length === 0 ? (
                <Banner variant="info" role="status">
                  <p>{t('noPriceable')}</p>
                </Banner>
              ) : (
                <div className="flex flex-col gap-1">
                  <span className="eyebrow" id={piecesLabelId}>
                    {t('pieces')}
                  </span>
                  <ul
                    aria-labelledby={piecesLabelId}
                    className="flex flex-col gap-1 font-mono text-[11px] text-muted"
                  >
                    {priceable.map((p) => (
                      <PieceRow key={p.id} piece={p} />
                    ))}
                  </ul>
                </div>
              )}
              {/* T-1: las que NO se tocan se dicen con su dueño/estado; no se esconden. */}
              {skipped.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted" id={skippedLabelId}>
                    {t('skipped', { count: skipped.length })}
                  </span>
                  <ul
                    aria-labelledby={skippedLabelId}
                    className="flex flex-col gap-1 font-mono text-[11px] text-muted opacity-70"
                  >
                    {skipped.map((p) => (
                      <PieceRow key={p.id} piece={p} />
                    ))}
                  </ul>
                </div>
              )}
              <Input
                label={t('priceLabel')}
                type="text"
                inputMode="decimal"
                prefix="MX$"
                value={priceValue}
                // S-L1 money-safe: solo dígitos + UN punto (idéntico saneo que el override).
                onChange={(e) => setPriceValue(sanitizeDecimalInput(e.target.value))}
              />
              {priceValue !== '' && priceInvalid && (
                <Banner variant="warning" role="alert">
                  {/* Mismo aviso que el override de mercado: el valor no se fija. */}
                  {tPending('overrideInvalidValue')}
                </Banner>
              )}
              {priceValue !== '' && !priceInvalid && (
                <p className="text-xs text-muted">= {formatMoneyCents(pesosToCents(priceValue), locale)}</p>
              )}
              {price.isError && (
                <Banner variant="danger" role="alert" title={tc('errorTitle')}>
                  {getError(price.error)}
                </Banner>
              )}
            </>
          )}
        </QueryState>
      </div>
    </Modal>
  );
}

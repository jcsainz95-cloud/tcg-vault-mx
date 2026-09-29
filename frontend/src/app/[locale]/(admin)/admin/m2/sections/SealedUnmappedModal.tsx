'use client';

import { useMemo, useState } from 'react';
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
 *       CADA pieza sin mapeo de la fila (SK-4: precedencia #1 de §K; vive en la fila de la pieza ⇒ no
 *       puede cruzarse con otro producto). NO publica: publicar sigue siendo un acto aparte (M1).
 *
 * La fila de la cola no trae `inventoryItemId` (agrupa una CLASE de piezas), así que las piezas se
 * resuelven aquí con `GET /admin/inventory/items?cardId=&productType=sealed` y se filtran a las que
 * NO tienen `tcgplayerProductId` y comparten `sealedSubtype` con la fila. Sin piezas ⇒ se dice (fila
 * legada anterior a P-79(d): la pieza ya está mapeada y la cierra el siguiente barrido).
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
  const tStatus = useTranslations('status.inventory');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const getError = useErrorMessage('operator');
  const name = displayName(entry);

  const pieces = useQuery({
    queryKey: ['sealed-unmapped-pieces', entry.cardId],
    queryFn: () => getAdminInventory({ cardId: entry.cardId, productType: 'sealed', pageSize: 100 }),
  });
  const unmapped = useMemo(
    () => (pieces.data ? unmappedPiecesFor(entry, pieces.data.data) : []),
    [entry, pieces.data],
  );
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
  const price = useMutation({
    mutationFn: async () => {
      const listPriceCents = pesosToCents(priceValue);
      await Promise.all(unmapped.map((p) => updateInventoryItem(p.id, { listPriceCents })));
      return { count: unmapped.length, cents: listPriceCents };
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
              <Button
                disabled={unmapped.length === 0 || priceInvalid}
                loading={price.isPending}
                onClick={() => unmapped.length > 0 && !priceInvalid && price.mutate()}
              >
                {t('priceConfirm', { count: unmapped.length })}
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
              <p className="text-sm text-muted">{t('priceLead', { name, count: unmapped.length })}</p>
              <div className="flex flex-col gap-1">
                <span className="eyebrow">{t('pieces')}</span>
                <ul className="flex flex-col gap-1 font-mono text-[11px] text-muted">
                  {unmapped.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-2">
                      <span className="tabular text-text">{p.folio}</span>
                      <span>· {tStatus(p.status)}</span>
                      {p.listPriceCents != null && (
                        <span className="tabular">· {formatMoneyCents(p.listPriceCents, locale)}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
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

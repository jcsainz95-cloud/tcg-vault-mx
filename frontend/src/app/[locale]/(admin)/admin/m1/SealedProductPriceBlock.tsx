'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatMoneyCents } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import type { InventoryItemDTO } from '@/types/contract';
import { Link } from '@/i18n/navigation';
import { SealedProductPriceEditor, type SealedProductPriceSaved } from './SealedProductPriceEditor';
import { SealedPriceSavedNotice, SHEET_ANCHOR_HREF } from './SealedPriceSavedNotice';
import { productPriceTargetOf } from './sealed-product-price-target';

/**
 * Bloque «Precio del producto · N piezas» del panel de la presentación (`DESIGN_SYSTEM §70.3 (a)`), **una vez** encima
 * de la lista de piezas, por producto ligado.
 *
 * - **Cifra (todas con IVA):** `sealedProductDisplayPriceCents` + «tuyo»; si es `null`, el `resolvedDisplayPriceCents`
 *   de una pieza `automatic` + «automático»; si ninguna tiene precio, «Sin precio: no se vende». ⛔ Nunca
 *   `resolvedSalePriceCents` (es `L`).
 * - **`N`:** `sealedProductPieces` de cualquier fila del producto (el mismo agregado en todas, §M11-SP.12.7). ⛔ No se
 *   cuentan las filas del panel (el panel es por condición; el producto no).
 * - **Editor (solo el dueño):** el `expected` es el `sealedProductDisplayPriceCents` de una fila S-2 que lo traiga
 *   (§M11-SP.13.7). Si ninguna lo trae (p. ej. todas `reserved`), ⛔ no se ofrece el editor: enlace a la hoja.
 */
export function SealedProductPriceBlock({
  productId,
  name,
  rows,
  canSet,
  onChanged,
}: {
  productId: string;
  name: string;
  /** Filas del panel ligadas a ESTE producto. */
  rows: InventoryItemDTO[];
  canSet: boolean;
  onChanged?: () => void;
}) {
  const t = useTranslations('admin.sealedProductPrice');
  const tSheet = useTranslations('admin.m11.priceSheet');
  const locale = useLocale() as AppLocale;
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<SealedProductPriceSaved | null>(null);
  const [seq, setSeq] = useState(0);

  // Techlead D-6: la misma cuenta que la fila de la cola (`productPriceTargetOf`).
  const target = productPriceTargetOf(rows);
  const owner = target.ownerDisplayPriceCents;
  const counts = target.pieces;
  const n = counts ? counts.inStock + counts.listed + counts.reserved : null;

  const figure =
    target.effectiveOrigin === 'product' && owner != null ? (
      <>
        <span className="tabular font-mono">{formatMoneyCents(owner, locale)}</span> · {tSheet('origin.product')} · {t('withVat')}
      </>
    ) : target.effectiveOrigin === 'automatic' && target.displayPriceCents != null ? (
      <>
        <span className="tabular font-mono">{formatMoneyCents(target.displayPriceCents, locale)}</span> ·{' '}
        {tSheet('origin.automatic')} · {t('withVat')}
      </>
    ) : (
      <span className="text-accent">{tSheet('origin.pending')}</span>
    );

  const staffLink = (
    <Link href={SHEET_ANCHOR_HREF} className="w-fit text-xs text-text underline underline-offset-4 hover:text-accent">
      {canSet ? t('errors.perProductLink') : t('staffNote')}
    </Link>
  );

  return (
    <div className="flex flex-col gap-1 border-b border-border pb-3" data-testid={`sealed-product-block-${productId}`}>
      <p className="eyebrow">{n != null ? t('blockTitle', { n }) : t('blockTitleNoCount')}</p>
      <p className="text-sm text-text">{figure}</p>
      {canSet && target.hasExpected ? (
        <SealedProductPriceEditor
          product={{
            id: productId,
            name,
            ownerDisplayPriceCents: owner,
            displayPriceCents: target.displayPriceCents,
            effectiveOrigin: target.effectiveOrigin,
            pieces: counts,
          }}
          triggerVariant="product"
          editing={editing}
          onEditingChange={setEditing}
          onDone={(s) => {
            setSaved(s);
            setSeq((x) => x + 1);
            onChanged?.();
          }}
        />
      ) : (
        staffLink
      )}
      {saved && <SealedPriceSavedNotice key={seq} saved={saved} />}
    </div>
  );
}

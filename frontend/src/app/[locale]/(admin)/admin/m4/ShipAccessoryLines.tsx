'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import type { MissingReason, PreparationItemStatus, ShipAccessoryLineDTO, ShipmentBoxDTO, SetShipPrepAccessoryLineRequest } from '@/types/contract';
import { formatMoneyCents } from '@/lib/format';
import { sortByEnergyType } from '@/lib/accessories';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { AccessoryPhoto } from '@/components/domain/accessories/AccessoryPhoto';
import { QuantityStepper } from '@/components/domain/accessories/QuantityStepper';
import { LABEL, TAG } from './prep-shared';

/**
 * 💰 Preparación con accesorios (`API_CONTRACT §AC.9` + v1.86.1, `DESIGN_SYSTEM §AC-UX.12`). ⛔ Ninguna cifra se
 * calcula aquí: el importe de «faltan k» es `refund.amountByQtyCents[k−1]` del servidor. Marcar no mueve dinero
 * ni existencias (el dinero se mueve en «Pedido preparado», con `refundPreviewCents` leído).
 */

/** Caja congelada (§AC.7): medidas y peso de los accesorios; `review` ⇒ «REVISAR CAJA» (solo aviso, no retiene). */
export function ShipBoxBlock({ box, shipmentId }: { box: ShipmentBoxDTO; shipmentId: string }) {
  const t = useTranslations('admin.m4.prep.ship.accessory');
  // Peso en kg con un decimal (cambio de unidad de un dato del servidor, no dinero). Se redondea en enteros
  // (hectogramos) porque `toFixed` sobre 1.45 da «1.4» por la coma flotante.
  const hg = Math.round(box.contentWeightG / 100);
  const kg = `${Math.trunc(hg / 10)}.${hg % 10}`;
  return (
    <div data-testid={`prep-box-${shipmentId}`} className="flex flex-col gap-1">
      <p className="text-sm text-text">
        {t('box', { label: box.label, dims: `${box.lengthCm}×${box.widthCm}×${box.heightCm}`, kg })}
      </p>
      {box.review && (
        <>
          <p className={cn(TAG, 'text-accent')}>{t('review')}</p>
          <p className="text-sm text-text">{t('reviewBody')}</p>
        </>
      )}
    </div>
  );
}

export function ShipAccessoryRow({
  line,
  editable,
  busy,
  error,
  locale,
  onMark,
}: {
  line: ShipAccessoryLineDTO;
  editable: boolean;
  busy: boolean;
  error: string | null;
  locale: AppLocale;
  onMark: (body: SetShipPrepAccessoryLineRequest) => void;
}) {
  const t = useTranslations('admin.m4.prep.ship.accessory');
  const ts = useTranslations('admin.m4.prep.ship');
  const ta = useTranslations('accessories');
  const nameId = useId();
  const [missOpen, setMissOpen] = useState(false);
  const [k, setK] = useState(1);
  const [reason, setReason] = useState<MissingReason>('not_found');
  const isBundle = line.kind === 'energy_bundle';
  // v1.86.3 (§AC.19.5): en paquete `name = deckName`; el título lo pone la pantalla por `kind`.
  const title = isBundle ? t('bundleTitle', { deck: line.deckName ?? line.name }) : line.name;
  const locked = line.refunded || line.refund.kind === 'refunded';
  const aria = (action: string) => t('actionAria', { action, name: title, n: line.quantity });
  const mark = (status: PreparationItemStatus, missingQty?: number, missingReason?: MissingReason) =>
    onMark(status === 'missing' ? { status, missingQty, missingReason } : { status });
  const preview = line.refund.kind === 'refundable' ? line.refund.amountByQtyCents[k - 1] : undefined;

  return (
    <li
      data-testid={`prep-acc-${line.id}`}
      data-prep-status={line.prepStatus}
      className={cn(
        'flex flex-col gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0 sm:flex-row sm:gap-4',
        line.prepStatus === 'picked' && 'border-l-2 border-l-text pl-3',
        line.prepStatus === 'missing' && 'border-l-2 border-l-accent pl-3',
      )}
    >
      <div className="flex shrink-0 items-start gap-3 sm:w-32">
        {line.photo ? (
          <AccessoryPhoto src={line.photo.thumbUrl} alt="" fallbackText={title} className="h-12 w-12" />
        ) : (
          <div className="h-12 w-12 border border-dashed border-border" aria-hidden />
        )}
        <span className="tabular font-mono text-[20px] leading-none text-text">{t('qty', { n: line.quantity })}</span>
      </div>

      {editable && !locked && (
        <div className="order-last flex flex-col gap-2 sm:order-none sm:w-44 sm:shrink-0 print:hidden">
          <div role="group" aria-labelledby={nameId} className="flex flex-wrap gap-3 sm:flex-col sm:gap-2">
            {line.prepStatus !== 'pending' ? (
              <Button size="sm" variant="ghost" className="min-h-[44px]" aria-label={aria(t('undo'))} loading={busy} onClick={() => mark('pending')}>
                {t('undo')}
              </Button>
            ) : isBundle ? (
              <>
                <Button size="sm" variant="secondary" className="min-h-[44px]" aria-label={aria(t('pickBundle'))} disabled={busy} onClick={() => mark('picked')}>
                  {t('pickBundle')}
                </Button>
                {/* P-AC-3: el paquete entero, siempre `missingQty: 1`. */}
                <Button size="sm" variant="ghost" className="min-h-[44px]" aria-label={aria(t('missBundle'))} disabled={busy} onClick={() => mark('missing', 1, 'not_found')}>
                  {t('missBundle')}
                </Button>
                <Button size="sm" variant="ghost" className="min-h-[44px]" aria-label={aria(t('damaged'))} disabled={busy} onClick={() => mark('missing', 1, 'damaged')}>
                  {t('damaged')}
                </Button>
              </>
            ) : line.quantity === 1 ? (
              <>
                <Button size="sm" variant="secondary" className="min-h-[44px]" aria-label={aria(t('pick'))} disabled={busy} onClick={() => mark('picked')}>
                  {t('pick')}
                </Button>
                <Button size="sm" variant="ghost" className="min-h-[44px]" aria-label={aria(t('miss'))} disabled={busy} onClick={() => mark('missing', 1, 'not_found')}>
                  {t('miss')}
                </Button>
                <Button size="sm" variant="ghost" className="min-h-[44px]" aria-label={aria(t('damaged'))} disabled={busy} onClick={() => mark('missing', 1, 'damaged')}>
                  {t('damaged')}
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="secondary" className="min-h-[44px]" aria-label={aria(t('pickMany'))} disabled={busy} onClick={() => mark('picked')}>
                  {t('pickMany')}
                </Button>
                <Button size="sm" variant="ghost" className="min-h-[44px]" aria-label={aria(t('missSome'))} aria-expanded={missOpen} disabled={busy} onClick={() => setMissOpen((v) => !v)}>
                  {t('missSome')}
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p id={nameId} className="text-[15px] text-text">
          {title}
        </p>
        {isBundle && line.components.length > 0 && (
          <ul className="flex flex-col">
            {sortByEnergyType(line.components).map((c) => (
              <li key={c.energyType} className="tabular font-mono text-sm text-text">
                {ta('energyQty', { type: ta(`energyType.${c.energyType}`), qty: c.quantity })}
              </li>
            ))}
          </ul>
        )}
        {isBundle && line.prepStatus === 'pending' && editable && <p className="text-xs text-muted">{t('bundlePartHelp')}</p>}
        {/* AC-F17 (v1.86.1): la pantalla SUGIERE; ⛔ no marca nada sola. */}
        {isBundle && line.deckAllMissing && line.prepStatus === 'pending' && (
          <p className="text-sm text-accent">{t('deckAllMissing')}</p>
        )}
        {line.settledWithoutStock && (
          <div className="flex flex-col gap-0.5">
            <p className={cn(TAG, 'text-accent')}>{t('noStock')}</p>
            <p className="text-sm text-text">{t('noStockBody')}</p>
          </div>
        )}

        {line.prepStatus === 'picked' && <p className={cn(TAG, 'text-text')}>{t('picked')}</p>}
        {line.prepStatus === 'missing' && (
          <p className={cn(TAG, 'flex flex-wrap gap-2 text-accent')}>
            {!isBundle && line.quantity > 1 ? (
              <span>{t('missingOf', { k: line.missingQty, n: line.quantity })}</span>
            ) : (
              line.missingReason !== 'damaged' && <span>{t('missing')}</span>
            )}
            {line.missingReason === 'damaged' && <span>{t('damagedTag')}</span>}
          </p>
        )}

        {missOpen && line.prepStatus === 'pending' && (
          <div className="flex flex-col gap-3 border-l-2 border-border pl-3">
            <QuantityStepper label={t('howMany')} value={k} min={1} max={line.quantity} onChange={setK} compact />
            <fieldset className="flex flex-col gap-1">
              <legend className={LABEL}>{t('reasonLegend')}</legend>
              {(['not_found', 'damaged'] as const).map((r) => (
                <label key={r} className="flex min-h-[44px] items-center gap-3 text-sm text-text">
                  <input type="radio" name={`${nameId}-reason`} checked={reason === r} onChange={() => setReason(r)} />
                  {r === 'not_found' ? t('reasonNotFound') : t('reasonDamaged')}
                </label>
              ))}
            </fieldset>
            {preview !== undefined && (
              <p className="tabular text-sm text-text">{t('refundPreview', { amount: formatMoneyCents(preview, locale) })}</p>
            )}
            <div className="flex gap-3">
              <Button size="sm" variant="secondary" className="min-h-[44px]" loading={busy} onClick={() => mark('missing', k, reason)}>
                {t('markCta')}
              </Button>
              <Button size="sm" variant="ghost" className="min-h-[44px]" onClick={() => setMissOpen(false)}>
                {t('cancel')}
              </Button>
            </div>
          </div>
        )}

        {line.prepStatus === 'missing' && line.refund.kind === 'refundable' && (
          <p className="tabular text-sm text-text print:hidden">{t('refundPreview', { amount: formatMoneyCents(line.refund.amountCents, locale) })}</p>
        )}
        {line.prepStatus === 'missing' && line.refund.kind === 'not_refundable' && (
          <p className="text-sm text-text print:hidden">{ts(`item.notRefundable.${line.refund.reason}`)}</p>
        )}
        {locked && (
          <div className="flex flex-col gap-0.5 print:hidden">
            {line.refund.kind === 'refunded' && (
              <p className="tabular text-sm text-text">{t('refundDone', { amount: formatMoneyCents(line.refund.refund.amountCents, locale) })}</p>
            )}
            <p className="text-sm text-text">{t('refundedLocked')}</p>
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-text">
            {error}
          </p>
        )}
      </div>
    </li>
  );
}

/** Línea del diálogo de «Pedido preparado» para un renglón de accesorio faltante (importe del servidor). */
export function accessoryDialogLine(
  l: ShipAccessoryLineDTO,
  t: (key: string, values?: Record<string, string | number>) => string,
  locale: AppLocale,
): string {
  const damaged = l.missingReason === 'damaged';
  const name = l.kind === 'energy_bundle' ? t('bundleTitle', { deck: l.deckName ?? l.name }) : l.name;
  if (l.refund.kind !== 'refundable') return t('dialogNotRefundable', { name, k: l.missingQty, n: l.quantity });
  const amount = formatMoneyCents(l.refund.amountCents, locale);
  if (l.kind === 'energy_bundle') return t(damaged ? 'dialogBundleDamaged' : 'dialogBundle', { deck: l.deckName ?? l.name, amount });
  return t(damaged ? 'dialogLineDamaged' : 'dialogLine', { name: l.name, k: l.missingQty, n: l.quantity, amount });
}

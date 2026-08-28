'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import type { CurvePreviewRowDTO } from '@/types/contract';
import { formatMoneyCents } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import type { CurveDiffEntry } from './curve-draft';

const IMPACT_LIMIT = 5;

export interface CurveDiffDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  saving: boolean;
  diff: CurveDiffEntry[];
  /** Filas del dry-run: la tabla de impacto es la de referencia reducida a lo que cambia. */
  rows: CurvePreviewRowDTO[];
}

/**
 * Confirmación de guardado (DESIGN_SYSTEM §21.6b). **Se abre siempre, incluso con un solo cambio**:
 * el `PUT` reemplaza TODA la curva y repricia el catálogo entero.
 *
 * El diff es mono, una línea por cambio, con `eje · punto · antes → después` — nunca un JSON. La
 * tabla de impacto son las filas de referencia que cambian (tope 5 + «y N más»), con las cifras del
 * dry-run del servidor. CTA `primary`, no `destructive`: guardar no destruye nada; lo que exige
 * cuidado es su ALCANCE, y eso lo comunica el diff.
 */
export function CurveDiffDialog({
  open,
  onClose,
  onConfirm,
  saving,
  diff,
  rows,
}: CurveDiffDialogProps) {
  const t = useTranslations('admin.m2.curve.diff');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;

  const changedRows = rows.filter(
    (r) => (r.deltaCents.sale ?? 0) !== 0 || (r.deltaCents.buy ?? 0) !== 0,
  );
  const shown = changedRows.slice(0, IMPACT_LIMIT);
  const more = changedRows.length - shown.length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('title')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {tc('cancel')}
          </Button>
          <Button onClick={onConfirm} loading={saving}>
            {t('cta')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <ul className="flex flex-col gap-1">
          {diff.map((d, i) => (
            <li key={`${d.axis}-${d.marketCents ?? 'const'}-${i}`} className="font-mono text-[11px] text-text">
              <DiffLine entry={d} locale={locale} />
            </li>
          ))}
        </ul>

        {changedRows.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <p className="eyebrow">
              {t('impactTitle', { changed: changedRows.length, total: rows.length })}
            </p>
            <table className="w-full border-collapse text-left">
              <thead>
                <tr>
                  <th scope="col" className="eyebrow py-1 font-normal">
                    {t('marketCol')}
                  </th>
                  <th scope="col" className="eyebrow py-1 font-normal">
                    {t('saleCol')}
                  </th>
                  <th scope="col" className="eyebrow py-1 font-normal">
                    {t('buyCol')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.marketCents}>
                    <th
                      scope="row"
                      className="tabular-nums py-1 pr-3 font-mono text-[11px] font-normal text-text"
                    >
                      {formatMoneyCents(r.marketCents, locale)}
                    </th>
                    <td className="tabular-nums py-1 pr-3 font-mono text-[11px] text-text">
                      <Transition
                        from={r.saved.sale.priceCents}
                        to={r.draft.sale.priceCents}
                        locale={locale}
                      />
                    </td>
                    <td className="tabular-nums py-1 font-mono text-[11px] text-text">
                      <Transition
                        from={r.saved.buy.priceCents}
                        to={r.draft.buy.priceCents}
                        locale={locale}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {more > 0 && <p className="font-mono text-[11px] text-muted">{t('impactMore', { count: more })}</p>}
          </div>
        )}

        <p className="text-[13px] leading-relaxed text-muted">{t('effectNote')}</p>
        <p className="text-xs text-muted">{t('auditNote')}</p>
      </div>
    </Modal>
  );
}

function DiffLine({ entry, locale }: { entry: CurveDiffEntry; locale: AppLocale }) {
  const t = useTranslations('admin.m2.curve.diff');
  const axisLabel = t(`axis.${entry.axis}`);
  const market =
    entry.marketCents != null ? formatMoneyCents(entry.marketCents, locale) : null;
  if (entry.kind === 'added') {
    return <>{t('lineAdded', { axis: axisLabel, market: market ?? '', after: entry.after ?? '' })}</>;
  }
  if (entry.kind === 'removed') {
    return (
      <>{t('lineRemoved', { axis: axisLabel, market: market ?? '', before: entry.before ?? '' })}</>
    );
  }
  if (market == null) {
    return (
      <>
        {t('lineConstant', {
          axis: axisLabel,
          before: entry.before ?? '',
          after: entry.after ?? '',
        })}
      </>
    );
  }
  return (
    <>
      {t('lineChanged', {
        axis: axisLabel,
        market,
        before: entry.before ?? '',
        after: entry.after ?? '',
      })}
    </>
  );
}

function Transition({
  from,
  to,
  locale,
}: {
  from: number | null;
  to: number | null;
  locale: AppLocale;
}) {
  return (
    <>
      {from != null ? formatMoneyCents(from, locale) : '—'} → {to != null ? formatMoneyCents(to, locale) : '—'}
    </>
  );
}

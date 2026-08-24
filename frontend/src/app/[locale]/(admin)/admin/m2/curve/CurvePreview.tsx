'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import type { CurvePreviewLegDTO, CurvePreviewRowDTO } from '@/types/contract';
import { formatMoneyCents } from '@/lib/format';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { PriceBasisTag } from '@/components/domain/PriceBasisTag';
import { useErrorMessage } from '@/components/ui/QueryState';
import { cn } from '@/lib/cn';
import { bpToMultiplier, bpToPct, sanitizeDecimal } from './curve-draft';

export interface CurvePreviewProps {
  probeRaw: string;
  onProbeChange: (raw: string) => void;
  probeRow: CurvePreviewRowDTO | undefined;
  rows: CurvePreviewRowDTO[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  /** Mercados (centavos) implicados por el `422` del servidor: se resaltan (§21.4b-3). */
  offendingMarkets: Set<number>;
  /** Aviso de forma de curva (§21.5b): observación de intención de negocio, NUNCA un error. */
  shapeWarning: boolean;
}

/**
 * Previsualización (DESIGN_SYSTEM §21.5). **Requisito de producto, no adorno**: una tabla de puntos
 * es abstracta y el peso no — el dueño no puede calibrar lo que no ve.
 *
 * Todas las cifras vienen del **dry-run del servidor** (`POST /admin/pricing/curve/preview`,
 * ARCHITECTURE §4.36.8a), incluida la **memoria de cálculo** (`appliedBp`, `rawCents`,
 * `constantCents`, `baseCents`, `roundingStepCents`). Aquí no se multiplica, no se interpola y no se
 * redondea nada: si el dueño calibrara contra un cálculo que no es el que va a cobrar, sería el bug
 * de P-48 en espejo. Sin servidor, la probeta dice que no puede mostrar precios — jamás inventa uno.
 */
export function CurvePreview({
  probeRaw,
  onProbeChange,
  probeRow,
  rows,
  isLoading,
  isError,
  error,
  onRetry,
  offendingMarkets,
  shapeWarning,
}: CurvePreviewProps) {
  const t = useTranslations('admin.m2.curve.preview');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const getError = useErrorMessage();

  return (
    <div className="flex flex-col gap-8">
      {/* ---- (a) La probeta ---- */}
      <section
        aria-labelledby="curve-probe-title"
        className="flex flex-col gap-3 border-t border-border pt-4"
      >
        <h3 id="curve-probe-title" className="eyebrow">
          {t('probeTitle')}
        </h3>
        <label className="flex flex-col gap-2" htmlFor="curve-probe-market">
          <span className="eyebrow">{t('probeMarketLabel')}</span>
          <span className="flex items-baseline gap-1.5 border-b border-border-strong pb-1 focus-within:shadow-focus">
            <span className="shrink-0 font-mono text-[11px] text-muted">MX$</span>
            <input
              id="curve-probe-market"
              className="tabular-nums w-28 bg-transparent font-mono text-[13px] text-text outline-none"
              inputMode="decimal"
              value={probeRaw}
              onChange={(e) => onProbeChange(sanitizeDecimal(e.target.value))}
            />
          </span>
        </label>

        {isError ? (
          <Banner
            variant="danger"
            role="alert"
            title={t('unavailableTitle')}
            action={
              <Button size="sm" variant="secondary" onClick={onRetry}>
                {tc('retry')}
              </Button>
            }
          >
            {getError(error)}
          </Banner>
        ) : probeRaw.trim() === '' ? (
          <p className="text-xs text-muted">{t('empty')}</p>
        ) : isLoading && !probeRow ? (
          <p className="text-xs text-muted">{tc('loading')}</p>
        ) : probeRow ? (
          <div className="flex flex-col gap-3" aria-live="polite">
            <div className="grid grid-cols-[auto_1fr_1fr] items-baseline gap-x-4 gap-y-3">
              <span />
              <span className="eyebrow">{t('current')}</span>
              <span className="eyebrow">{t('draft')}</span>
              <ProbeAxis
                label={t('saleLabel')}
                saved={probeRow.saved.sale}
                draft={probeRow.draft.sale}
                deltaCents={probeRow.deltaCents.sale}
                locale={locale}
              />
              <ProbeAxis
                label={t('buyLabel')}
                saved={probeRow.saved.buy}
                draft={probeRow.draft.buy}
                deltaCents={probeRow.deltaCents.buy}
                locale={locale}
              />
            </div>
            {/* Memoria de cálculo: es lo que convierte la pantalla en algo auditable a ojo. */}
            <div className="flex flex-col gap-1 border-t border-border pt-3">
              <MathLine
                axis="sale"
                marketCents={probeRow.marketCents}
                leg={probeRow.draft.sale}
                locale={locale}
              />
              <MathLine
                axis="buy"
                marketCents={probeRow.marketCents}
                leg={probeRow.draft.buy}
                locale={locale}
              />
            </div>
            {probeRow.draft.sale.basis === 'floor' && (
              <p className="text-xs text-muted">{t('floorWinsNote')}</p>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted">{t('empty')}</p>
        )}
      </section>

      {/* ---- (b) La tabla de referencia ---- */}
      <section
        aria-labelledby="curve-reference-title"
        className="flex flex-col gap-3 border-t border-border pt-4"
      >
        <h3 id="curve-reference-title" className="eyebrow">
          {t('referenceTitle')}
        </h3>
        <p className="text-xs text-muted">{t('referenceHint')}</p>
        {isError ? (
          <p className="text-xs text-muted">{t('unavailableShort')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">{t('referenceCaption')}</caption>
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="eyebrow py-2 font-normal">
                    {t('marketCol')}
                  </th>
                  <th scope="col" className="eyebrow py-2 font-normal">
                    {t('saleCurrentCol')}
                  </th>
                  <th scope="col" className="eyebrow py-2 font-normal">
                    {t('saleDraftCol')}
                  </th>
                  <th scope="col" className="eyebrow py-2 font-normal">
                    {t('buyCurrentCol')}
                  </th>
                  <th scope="col" className="eyebrow py-2 font-normal">
                    {t('buyDraftCol')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.marketCents}
                    data-testid="curve-reference-row"
                    className={cn(
                      'border-b border-border',
                      offendingMarkets.has(row.marketCents) && 'border-l-2 border-l-accent',
                    )}
                  >
                    <th
                      scope="row"
                      className="tabular-nums py-2 pr-3 font-mono text-[12px] font-normal text-text"
                    >
                      {formatMoneyCents(row.marketCents, locale)}
                    </th>
                    <Cell cents={row.saved.sale.priceCents} changed={false} locale={locale} />
                    <Cell
                      cents={row.draft.sale.priceCents}
                      changed={(row.deltaCents.sale ?? 0) !== 0}
                      deltaCents={row.deltaCents.sale}
                      locale={locale}
                    />
                    <Cell cents={row.saved.buy.priceCents} changed={false} locale={locale} />
                    <Cell
                      cents={row.draft.buy.priceCents}
                      changed={(row.deltaCents.buy ?? 0) !== 0}
                      deltaCents={row.deltaCents.buy}
                      locale={locale}
                    />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {shapeWarning && (
          <p className="font-mono text-[11px] text-muted" role="status">
            {t('shapeHint')}
          </p>
        )}
      </section>
    </div>
  );
}

function ProbeAxis({
  label,
  saved,
  draft,
  deltaCents,
  locale,
}: {
  label: string;
  saved: CurvePreviewLegDTO;
  draft: CurvePreviewLegDTO;
  deltaCents: number | null;
  locale: AppLocale;
}) {
  return (
    <>
      <span className="eyebrow self-start">{label}</span>
      <span className="flex flex-col gap-1">
        <span className="tabular-nums font-mono text-[13px] text-text">
          {saved.priceCents != null ? formatMoneyCents(saved.priceCents, locale) : '—'}
        </span>
        <PriceBasisTag basis={saved.basis} />
      </span>
      <span className="flex flex-col gap-1">
        <span className="tabular-nums flex items-baseline gap-2 font-mono text-[13px] text-text">
          {draft.priceCents != null ? formatMoneyCents(draft.priceCents, locale) : '—'}
          {/* Sin color: subir un precio de venta no es «bueno» ni «malo» por sí mismo. */}
          {deltaCents != null && deltaCents !== 0 && (
            <span className="tabular-nums text-[11px] text-text">
              {deltaCents > 0 ? '+' : '−'}
              {formatMoneyCents(Math.abs(deltaCents), locale).replace(/^MX\$\s?/, '')}
            </span>
          )}
        </span>
        <PriceBasisTag basis={draft.basis} />
      </span>
    </>
  );
}

/**
 * Memoria de cálculo del BORRADOR (la columna que el dueño está decidiendo). Todos los números
 * salen del dry-run: multiplicador/porcentaje aplicado, producto ANTES de redondear, comparación
 * con la constante y paso de redondeo usado.
 */
function MathLine({
  axis,
  marketCents,
  leg,
  locale,
}: {
  axis: 'sale' | 'buy';
  marketCents: number;
  leg: CurvePreviewLegDTO;
  locale: AppLocale;
}) {
  const t = useTranslations('admin.m2.curve.preview');
  if (leg.basis === 'pending' || leg.appliedBp == null || leg.rawCents == null) {
    return (
      <p className="font-mono text-[11px] text-muted">
        {axis === 'sale' ? t('saleMathPending') : t('buyMathPending')}
      </p>
    );
  }
  const money = (c: number) => formatMoneyCents(c, locale);
  const bare = (c: number) => money(c).replace(/^MX\$\s?/, '');
  const factor = axis === 'sale' ? `${bpToMultiplier(leg.appliedBp)}×` : `${bpToPct(leg.appliedBp)}%`;
  if (axis === 'sale') {
    return (
      <p className="tabular-nums font-mono text-[11px] text-muted">
        {leg.constantWon
          ? t('saleMathFloor', {
              market: bare(marketCents),
              factor,
              raw: bare(leg.rawCents),
              constant: money(leg.constantCents),
              result: money(leg.priceCents ?? leg.constantCents),
            })
          : t('saleMath', {
              market: bare(marketCents),
              factor,
              raw: bare(leg.rawCents),
              result: money(leg.priceCents ?? 0),
              step: leg.roundingStepCents != null ? money(leg.roundingStepCents) : '—',
            })}
      </p>
    );
  }
  return (
    <p className="tabular-nums font-mono text-[11px] text-muted">
      {t('buyMath', {
        market: bare(marketCents),
        factor,
        raw: bare(leg.rawCents),
        constant: money(leg.constantCents),
      })}
    </p>
  );
}

function Cell({
  cents,
  changed,
  deltaCents,
  locale,
}: {
  cents: number | null;
  changed: boolean;
  deltaCents?: number | null;
  locale: AppLocale;
}) {
  return (
    <td className="py-2 pr-3">
      <span
        className={cn(
          'tabular-nums font-mono text-[12px]',
          changed ? 'text-text' : 'text-muted',
        )}
      >
        {cents != null ? formatMoneyCents(cents, locale) : '—'}
        {changed && deltaCents != null && deltaCents !== 0 && (
          <span className="ml-2 text-[11px] text-text">
            {deltaCents > 0 ? '+' : '−'}
            {formatMoneyCents(Math.abs(deltaCents), locale).replace(/^MX\$\s?/, '')}
          </span>
        )}
      </span>
    </td>
  );
}

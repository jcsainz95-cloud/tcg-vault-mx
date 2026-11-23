'use client';

import { useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { DownloadCloud, ReceiptText, TrendingUp } from 'lucide-react';
import {
  getPnl,
  getIvaReport,
  exportFinanceCsv,
  type FinanceRange,
  type FinanceCsvReport,
} from '@/lib/api';
import type { IvaByOrderEntryDTO, PnlComparisonDTO } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents, formatDate, formatDateLongMx } from '@/lib/format';
import { downloadTextFile } from '@/lib/download';
import { Button } from '@/components/ui/Button';
import { PeriodSelector, useInvalidPeriodFallback, useReportPeriod } from '@/components/domain/PeriodSelector';
import { ComparisonNote } from '@/components/domain/ComparisonNote';
import { CompareCells, CompareHeader, COL_AMOUNT, COL_PAD } from './CompareCells';
import { financeRange, periodFor, type ReportPeriod } from '@/lib/reports/period';
import { Banner } from '@/components/ui/Banner';
import { StatCard } from '@/components/ui/StatCard';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { QueryState } from '@/components/ui/QueryState';
import { EmptyState } from '@/components/ui/EmptyState';

/**
 * Renglón con signo del P&L (§43.23.1/.4): forma parte de la fórmula. El signo visible es `aria-hidden` y se OYE por el
 * `sr-only` («suma»/«resta», `srSign`) que va antes del rótulo. `data-sign` y `pnl-amount` son el enganche de UX-PNL-1.
 */
function PnlLine({ label, value, sign, srSign }: { label: string; value: string; sign: '+' | '−'; srSign: string }) {
  const tone = sign === '−' ? 'text-danger' : 'text-text';
  return (
    <div data-testid="pnl-line" data-sign={sign} className="flex items-start justify-between gap-3 py-1.5">
      <span className="flex min-w-0 flex-1 items-start gap-2 text-sm">
        <span aria-hidden="true" className={`w-4 shrink-0 tabular font-semibold ${sign === '−' ? 'text-danger' : 'text-muted'}`}>{sign}</span>
        <span className="sr-only">{srSign}</span>
        <span className="text-muted">{label}</span>
      </span>
      <span data-testid="pnl-amount" className={`tabular font-medium ${tone}`}>{value}</span>
    </div>
  );
}

/**
 * Sub-renglón «Incluye…» (§43.23.2): desglose de «Costo de envío», ⛔ NO parte de la fórmula. Sin signo (ni visible ni
 * `sr-only`), sin `data-sign`, monto `text-muted font-normal` (⛔ nunca `text-danger`: no resta nada por sí mismo).
 */
function PnlIncluded({ label, value }: { label: string; value: string }) {
  return (
    <div data-testid="pnl-included" className="flex items-start justify-between gap-3 pb-1 pl-6 text-xs">
      <span className="text-muted">{label}</span>
      <span data-testid="pnl-amount" className="tabular font-normal text-muted">{value}</span>
    </div>
  );
}

/**
 * §M10-IVA.8-bis (C) — renglón de SUBTOTAL del estado de resultados (Margen bruto, EBITDA, …). ⛔ NO es `pnl-line` y su
 * monto ⛔ NO es `pnl-amount`: el candado de la fórmula (UX-PNL-1) suma SOLO los `pnl-amount` dentro de los `pnl-line`, y
 * un subtotal NO forma parte de esa suma (es un total de ellos). La cifra viene del servidor tal cual — ⛔ el cliente no re-suma.
 */
function PnlSubtotal({ label, value, strong, cmp, pad }: { label: string; value: string; strong?: boolean; cmp?: React.ReactNode; pad?: boolean }) {
  return (
    <div
      data-testid="pnl-subtotal"
      className={`flex items-start justify-between gap-x-3 border-t border-dashed border-border py-1.5 ${cmp ? 'flex-wrap sm:flex-nowrap' : ''} ${pad ? COL_PAD : ''} ${strong ? 'font-semibold' : 'font-medium'}`}
    >
      <span className="min-w-0 flex-1 text-sm text-text">{label}</span>
      <span data-testid="pnl-subtotal-amount" className={`tabular text-text ${cmp ? COL_AMOUNT : ''}`}>{value}</span>
      {cmp}
    </div>
  );
}

/**
 * §M10-IVA.8-bis (C), v1.95.2 — encabezado de GRUPO del waterfall (VENTAS, DEVOLUCIONES Y REEMBOLSOS, COSTO DE VENTA).
 * Solo rótulo (eyebrow); ⛔ sin monto y ⛔ sin `pnl-line`/`pnl-amount` (no forma parte de la suma de la fórmula, UX-PNL-1).
 */
function StmtGroup({ label, current, cmp }: { label: string; current?: string; cmp?: React.ReactNode }) {
  if (!cmp) {
    return (
      <p data-testid="stmt-group" className="eyebrow mt-2 text-muted first:mt-0">
        {label}
      </p>
    );
  }
  // F2a: el total del grupo (del servidor, `comparison.figures`) abre las columnas; NO es `stmt-amount` ni `pnl-amount`.
  return (
    <div className="mt-2 flex flex-wrap items-start justify-between gap-x-3 first:mt-0 sm:flex-nowrap">
      <p data-testid="stmt-group" className="eyebrow min-w-0 flex-1 text-muted">
        {label}
      </p>
      <span data-testid="cmp-current" className={`tabular text-xs text-muted ${COL_AMOUNT}`}>{current}</span>
      {cmp}
    </div>
  );
}

/**
 * §M10-IVA.8-bis (C), v1.95.2 — renglón-concepto del waterfall (indentado bajo su grupo). Es **presentación**: ⛔ NO es
 * `pnl-line` (el candado UX-PNL-1 suma SOLO los `pnl-line` de la lista plana de arriba; un concepto del `statement`
 * duplicaría esa suma). `deduct` marca los que se muestran como **resta explícita** (devoluciones y tarifa retenida):
 * glifo `−` `aria-hidden` + `sr-only` «resta», monto en `text-danger` y `data-sign="−"`. Los demás van sin signo.
 */
function StmtLine({ label, value, deduct, srSign, cmp, pad }: { label: string; value: string; deduct?: boolean; srSign?: string; cmp?: React.ReactNode; pad?: boolean }) {
  return (
    <div
      data-testid="stmt-line"
      {...(deduct ? { 'data-sign': '−' } : {})}
      className={`flex items-start justify-between gap-x-3 py-1 pl-4 ${cmp ? 'flex-wrap sm:flex-nowrap' : ''} ${pad ? COL_PAD : ''}`}
    >
      <span className="flex min-w-0 flex-1 items-start gap-2 text-sm">
        <span aria-hidden="true" className="w-4 shrink-0 tabular font-semibold text-danger">
          {deduct ? '−' : ''}
        </span>
        {deduct && <span className="sr-only">{srSign}</span>}
        <span className="text-muted">{label}</span>
      </span>
      <span data-testid="stmt-amount" className={`tabular font-medium ${deduct ? 'text-danger' : 'text-text'} ${cmp ? COL_AMOUNT : ''}`}>{value}</span>
      {cmp}
    </div>
  );
}

/**
 * Finanzas (`/admin/m7`). §REPORTES-CEO F1: «Volumen y ticket» se fue a Ventas y el valor de inventario/custodia a
 * Reportes › Inventario (una sola casa por cifra); aquí quedan el P&L, el IVA y las exportaciones de dinero.
 * `initialPeriod` llega de la URL (`?preset=` o `?preset=custom&from=&to=`, días de México); «Todo» = sin rango (histórico).
 */
export function M7View({ initialPeriod = periodFor('month') }: { initialPeriod?: ReportPeriod } = {}) {
  const t = useTranslations('admin.m7');
  const tModules = useTranslations('admin.modules'); // §37.2: h1 = rótulo del menú
  const tc = useTranslations('common');
  const tr = useTranslations('admin.reports');
  const locale = useLocale() as AppLocale;
  const adds = t('pnl.signAdds');
  const subtracts = t('pnl.signSubtracts');

  const [period, setPeriod] = useReportPeriod(initialPeriod);
  const range: FinanceRange = financeRange(period);

  const pnl = useQuery({ queryKey: ['finance-pnl', range], queryFn: () => getPnl(range) });
  const fallback = useInvalidPeriodFallback(pnl.error, period, setPeriod);
  const iva = useQuery({ queryKey: ['finance-iva', range], queryFn: () => getIvaReport(range) });
  // §REPORTES-CEO F2a: contra el MISMO tramo del periodo anterior. Todo lo manda el servidor; `null` («Todo») ⇒ sin columnas.
  const cmp = pnl.data?.comparison ?? null;
  const cell = (k: keyof PnlComparisonDTO['figures']) => (cmp ? <CompareCells d={cmp.figures[k]} basis={cmp.basis} /> : undefined);

  const exportMutation = useMutation({
    mutationFn: async (report: FinanceCsvReport) => {
      const csv = await exportFinanceCsv({ report, from: range.from, to: range.to, source: 'finance' });
      const suffix = [range.from, range.to].filter(Boolean).join('_') || 'all';
      downloadTextFile(`tcgvault_${report}_${suffix}.csv`, csv);
      return report;
    },
  });

  const ivaColumns: Column<IvaByOrderEntryDTO>[] = useMemo(
    () => [
      { key: 'orderId', header: t('iva.order'), render: (o) => <span className="tabular">{o.orderId}</span> },
      { key: 'iva', header: t('iva.amount'), align: 'right', render: (o) => <span className="tabular">{formatMoneyCents(o.ivaCents, locale)}</span> },
      { key: 'date', header: t('iva.date'), render: (o) => <span className="tabular text-muted">{o.settledAt ? formatDate(o.settledAt, locale) : '—'}</span> },
    ],
    [t, locale],
  );

  return (
    <div className="flex flex-col gap-10">
      <h1 className="text-h1 font-bold">{tModules('m7')}</h1>

      {/* Periodo único (§REPORTES-CEO §2): aplica al P&L, al IVA y a las exportaciones */}
      <PeriodSelector value={period} onChange={fallback.onChange} />
      {fallback.notice && (
        <Banner variant="warning" role="status">
          {tr('period.fallback')}
        </Banner>
      )}
      {pnl.data && (
        <ComparisonNote preset={period.preset} period={pnl.data.period ?? period} previous={pnl.data.previousPeriod} comparison={pnl.data.comparison} testId="pnl-compare" />
      )}

      {/* P&L con el desglose de la fórmula */}
      <section className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold">{t('pnl.title')}</h2>
        <p className="text-sm text-muted">{t('pnl.formula')}</p>
        <QueryState isLoading={pnl.isLoading} isError={pnl.isError} error={pnl.error} onRetry={() => pnl.refetch()}>
          {pnl.data && (
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
              <div className="flex flex-col divide-y divide-border">
                {/*
                 * 💰 §M4-SHIP.19.36.1 / §43.23.1 — los OCHO renglones con signo son la fórmula de arriba, en el orden del
                 * servidor, y se pintan SIEMPRE (también en 0: un «MX$0.00» con signo es un dato). Los «Incluye…» van
                 * bajo «Costo de envío» en el MISMO hijo del `divide-y`, y solo si `> 0` (⛔ no `??`: criterio 202(c)).
                 */}
                <PnlLine sign="+" srSign={adds} label={t('pnl.income')} value={formatMoneyCents(pnl.data.incomeCents, locale)} />
                <PnlLine sign="+" srSign={adds} label={t('pnl.shippingRevenue')} value={formatMoneyCents(pnl.data.shippingRevenueCents, locale)} />
                <PnlLine sign="−" srSign={subtracts} label={t('pnl.cogs')} value={formatMoneyCents(pnl.data.cogsCents, locale)} />
                {/* 💰 rev BSD-1 (§BSD.16, DESIGN_SYSTEM §BSD-UX.11a): justo debajo de «Costo de lo vendido» (son del bloque de
                    COSTO DE COMPRAS, ⛔ ingresos), cada uno su propio renglón con signo, SIEMPRE (también en 0). Montos tal
                    cual (⛔ la pantalla no niega, suma ni compara). */}
                <PnlLine sign="+" srSign={adds} label={t('pnl.buylistFeeRetained')} value={formatMoneyCents(pnl.data.buylistShippingFeeRetainedCents, locale)} />
                <PnlLine sign="−" srSign={subtracts} label={t('pnl.buylistGuideCost')} value={formatMoneyCents(pnl.data.buylistGuideCostCents, locale)} />
                {(() => {
                  const est = pnl.data.stripeFeeEstimatedOrders ?? 0;
                  const money = formatMoneyCents(pnl.data.stripeFeesCents, locale);
                  return (
                    <div>
                      <PnlLine sign="−" srSign={subtracts} label={t('pnl.stripeFees')} value={est > 0 ? `~${money}` : money} />
                      {est > 0 && (
                        <PnlIncluded
                          label={t('pnl.stripeFeesEstimated', { count: est, amount: formatMoneyCents(pnl.data.stripeFeeEstimatedCents ?? 0, locale) })}
                          value=""
                        />
                      )}
                    </div>
                  );
                })()}
                <div>
                  <PnlLine sign="−" srSign={subtracts} label={t('pnl.shippingCost')} value={formatMoneyCents(pnl.data.shippingCostCents, locale)} />
                  {pnl.data.shippingAdjustmentsCents > 0 && (
                    <PnlIncluded label={t('pnl.shippingAdjustments')} value={formatMoneyCents(pnl.data.shippingAdjustmentsCents, locale)} />
                  )}
                  {pnl.data.shippingInsuranceCents > 0 && (
                    <PnlIncluded label={t('pnl.shippingInsurance')} value={formatMoneyCents(pnl.data.shippingInsuranceCents, locale)} />
                  )}
                </div>
                <PnlLine sign="−" srSign={subtracts} label={t('pnl.refunds')} value={formatMoneyCents(pnl.data.refundsCents, locale)} />
                <PnlLine sign="−" srSign={subtracts} label={t('pnl.refundedFees')} value={formatMoneyCents(pnl.data.refundedFeesCents, locale)} />
                <PnlLine sign="−" srSign={subtracts} label={t('pnl.compensations')} value={formatMoneyCents(pnl.data.compensationsCents, locale)} />
              </div>
              {/*
               * ⭐ **§M10-IVA.8 — `shippingCostMissingCount`: UNA SEÑAL PARA UN HUMANO, NO UN
               * IMPORTE.** `ShipmentRequest.shippingCostCents` es `@default(0)`, así que en las
               * filas existentes **«costó cero» y «no se capturó» son indistinguibles**. El
               * contador **señala** esa ambigüedad; ⛔ no la resuelve, ⛔ no se suma a ninguna línea
               * y ⛔ no lleva signo. *Un cero silencioso convierte el ingreso de ese envío en
               * ganancia fantasma.*
               *
               * ⛔ **Y no se pinta cuando vale 0** — si no hay nada que revisar, no hay aviso:
               * la clase de defecto del criterio **202(c)** (*«falla si queda un indicador
               * vacío»*). El `> 0` es la condición, no un `??`.
               */}
              {/*
               * 💰 rev BSD-1 (§BSD-UX.11b) — el MARGEN de las guías de vendedores: una NOTA, no un renglón (⛔ `pnl-line`,
               * ⛔ `data-sign`, ⛔ «suma»/«resta»): ya está dentro de los dos renglones de arriba. El número es el del
               * SERVIDOR (⛔ tarifa − guía en el cliente, ⛔ `Math.abs`). Se pinta si hubo tarifa o si el margen no es 0
               * (la condición solo decide si pintar; no calcula nada).
               */}
              {(pnl.data.buylistShippingFeeRetainedCents > 0 || pnl.data.buylistGuideMarginCents !== 0) && (
                <div data-testid="pnl-buylist-margin" className="flex flex-col gap-1 border-t border-dashed border-border pt-2">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-xs text-muted">{t('pnl.buylistGuideMargin')}</span>
                    <span
                      data-testid="pnl-buylist-margin-amount"
                      className={`tabular text-xs font-medium ${pnl.data.buylistGuideMarginCents < 0 ? 'text-danger' : 'text-text'}`}
                    >
                      {formatMoneyCents(pnl.data.buylistGuideMarginCents, locale)}
                    </span>
                  </div>
                  <p className="text-xs text-muted">{t('pnl.buylistGuideMarginHelp')}</p>
                  {pnl.data.buylistGuideMarginCents < 0 && (
                    <p className="text-xs text-danger" data-testid="pnl-buylist-margin-negative">
                      {t('pnl.buylistGuideMarginNegative')}
                    </p>
                  )}
                </div>
              )}
              {pnl.data.shippingCostMissingCount > 0 && (
                <div data-testid="shipping-cost-missing">
                  <Banner variant="warning" role="status">
                    {t('pnl.shippingCostMissing', { count: pnl.data.shippingCostMissingCount })}
                  </Banner>
                </div>
              )}
              {/* 💰 rev BSD-1 (§BSD-UX.11d): solo si `> 0` (⛔ `??`); SIN enlace (BSD-1.4 punto 15: no hay verbo para corregirlas). */}
              {pnl.data.buylistGuideCostMissingCount > 0 && (
                <div data-testid="pnl-buylist-guide-missing">
                  <Banner variant="warning" role="status">
                    {t('pnl.buylistGuideCostMissing', { count: pnl.data.buylistGuideCostMissingCount })}
                  </Banner>
                </div>
              )}
              {/*
               * §M10-IVA.8-bis (C) — estado de resultados con SUBTOTALES. ADITIVO: solo se pinta si el servidor manda
               * `statement` (backend sin fusionar ⇒ el P&L degrada a la lista plana de arriba, sin romperse). ⛔ El cliente
               * NO re-suma: cada subtotal y el bloque IVA vienen del JSON tal cual. El IVA es MEMO (⛔ no resta del resultado).
               */}
              {pnl.data.statement && (
                <div data-testid="pnl-statement" className="mt-1 flex flex-col gap-1 border-t border-border pt-3">
                  <p className="eyebrow text-muted">{t('statement.title')}</p>
                  {/*
                   * §M10-IVA.8-bis (C), v1.95.2 — estado de resultados estándar e-commerce, en WATERFALL:
                   * VENTAS → (− devoluciones) → VENTAS NETAS → (− costo de venta) → MARGEN BRUTO → EBITDA → IVA (memo) →
                   * RESULTADO NETO. Es PRESENTACIÓN: ⛔ el cliente NO re-suma — cada subtotal y la cifra del grupo vienen del
                   * JSON tal cual. Los conceptos de VENTAS y de COSTO salen de los campos planos de `pnl.data`; los demás,
                   * del `statement`. Devoluciones y la tarifa retenida (crédito que resta del costo) se pintan como resta.
                   */}
                  {/* ── VENTAS ─────────────────────────────────────────────────────────── */}
                  {cmp && <CompareHeader />}
                  <StmtGroup label={t('statement.salesGroup')} />
                  <StmtLine label={t('pnl.income')} value={formatMoneyCents(pnl.data.incomeCents, locale)}  pad={!!cmp} />
                  <StmtLine label={t('pnl.shippingRevenue')} value={formatMoneyCents(pnl.data.shippingRevenueCents, locale)}  pad={!!cmp} />
                  <PnlSubtotal label={t('statement.salesGroup')} value={formatMoneyCents(pnl.data.statement.salesCents, locale)} cmp={cell('salesCents')} />
                  {/* ── (−) DEVOLUCIONES Y REEMBOLSOS (contra-ingreso) ─────────────────── */}
                  <StmtGroup
                    label={t('statement.returnsGroup')}
                    current={cmp ? formatMoneyCents(cmp.figures.returnsAndRefundsCents.cents, locale) : undefined}
                    cmp={cell('returnsAndRefundsCents')}
                  />
                  <StmtLine deduct srSign={subtracts} label={t('pnl.refunds')} value={formatMoneyCents(pnl.data.statement.returnsAndRefunds.refundsCents, locale)}  pad={!!cmp} />
                  <StmtLine deduct srSign={subtracts} label={t('pnl.refundedFees')} value={formatMoneyCents(pnl.data.statement.returnsAndRefunds.refundedFeesCents, locale)}  pad={!!cmp} />
                  <StmtLine deduct srSign={subtracts} label={t('pnl.compensations')} value={formatMoneyCents(pnl.data.statement.returnsAndRefunds.compensationsCents, locale)}  pad={!!cmp} />
                  <PnlSubtotal label={t('statement.netRevenue')} value={formatMoneyCents(pnl.data.statement.netRevenueCents, locale)} cmp={cell('netRevenueCents')} />
                  {/* ── (−) COSTO DE VENTA ─────────────────────────────────────────────── */}
                  <StmtGroup label={t('statement.costOfSalesGroup')} />
                  <StmtLine label={t('pnl.cogs')} value={formatMoneyCents(pnl.data.statement.costOfSales.cogsCents, locale)} cmp={cell('cogsCents')} />
                  <StmtLine label={t('pnl.stripeFees')} value={formatMoneyCents(pnl.data.statement.costOfSales.stripeFeesCents, locale)} cmp={cell('stripeFeesCents')} />
                  <StmtLine label={t('pnl.shippingCost')} value={formatMoneyCents(pnl.data.statement.costOfSales.shippingCostCents, locale)} cmp={cell('shippingCostCents')} />
                  <StmtLine label={t('pnl.buylistGuideCost')} value={formatMoneyCents(pnl.data.statement.costOfSales.buylistGuideCostCents, locale)}  pad={!!cmp} />
                  {/* CRÉDITO: la tarifa retenida RESTA del costo del grupo (§ DECISIÓN (2)); se pinta como resta explícita. */}
                  <StmtLine deduct srSign={subtracts} label={t('pnl.buylistFeeRetained')} value={formatMoneyCents(pnl.data.statement.costOfSales.buylistShippingFeeRetainedCents, locale)}  pad={!!cmp} />
                  <PnlSubtotal label={t('statement.grossMargin')} value={formatMoneyCents(pnl.data.statement.grossMarginCents, locale)} cmp={cell('grossMarginCents')} />
                  {/* ── = EBITDA (= margen bruto: no hay opex fija modelada) ───────────── */}
                  <PnlSubtotal label={t('statement.ebitda')} value={formatMoneyCents(pnl.data.statement.ebitdaCents, locale)} strong  pad={!!cmp} />
                  {/* Ayuda honesta: el margen bruto es margen de CONTRIBUCIÓN; ⛔ no incluye gastos fijos (no se modelan). */}
                  <p data-testid="stmt-contribution-help" className="pt-1 text-xs text-muted">{t('statement.contributionHelp')}</p>
                  {/* ⛔⛔ Bloque IVA: informativo, NO es un gasto. ⛔ Nunca se resta del EBITDA ni del resultado. */}
                  <div data-testid="pnl-iva-memo" className="mt-2 flex flex-col gap-1 rounded-md border border-dashed border-border bg-surface-2/40 p-3">
                    <p className="text-xs font-medium text-muted">{t('statement.ivaMemoTitle')}</p>
                    <div className="flex items-start justify-between gap-3 text-xs">
                      <span className="text-muted">{t('statement.ivaCollected')}</span>
                      <span className="tabular text-text">{formatMoneyCents(pnl.data.statement.iva.ivaCollectedCents, locale)}</span>
                    </div>
                    <div className="flex items-start justify-between gap-3 text-xs">
                      <span className="text-muted">{t('statement.ivaRefunded')}</span>
                      <span className="tabular text-text">{formatMoneyCents(pnl.data.statement.iva.ivaRefundedCents, locale)}</span>
                    </div>
                    <div className="flex items-start justify-between gap-3 text-xs font-medium">
                      <span className="text-text">{t('statement.ivaNet')}</span>
                      <span data-testid="pnl-iva-net" className="tabular text-text">{formatMoneyCents(pnl.data.statement.iva.ivaNetCents, locale)}</span>
                    </div>
                  </div>
                </div>
              )}
              <div className="mt-1 flex items-center justify-between border-t-2 border-border-strong pt-3">
                <span className="flex items-center gap-2 font-semibold">
                  <TrendingUp size={18} className={pnl.data.profitCents >= 0 ? 'text-success' : 'text-danger'} />
                  {pnl.data.statement ? t('statement.netResult') : t('pnl.profit')}
                </span>
                {/* ⛔ GAS-4: `profitCents` del servidor, tal cual — nunca la suma de lo pintado (UX-PNL-3). */}
                <span data-testid="pnl-profit" className={`tabular text-h2 font-bold ${pnl.data.profitCents >= 0 ? 'text-success' : 'text-danger'}`}>
                  {formatMoneyCents(pnl.data.profitCents, locale)}
                </span>
              </div>
              {cmp && pnl.data.statement && (
                <div data-testid="cmp-net" className="-mt-2 flex justify-end">
                  <CompareCells d={cmp.figures.netResultCents} basis={cmp.basis} inline />
                </div>
              )}
              {pnl.data.feeIncludedSince && formatDateLongMx(pnl.data.feeIncludedSince, locale) && (
                <p data-testid="pnl-fee-included-since" className="text-xs text-muted">
                  {t('pnl.feeIncludedSince', { date: formatDateLongMx(pnl.data.feeIncludedSince, locale) })}
                </p>
              )}
              <div>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={exportMutation.isPending && exportMutation.variables === 'pnl'}
                  onClick={() => exportMutation.mutate('pnl')}
                >
                  <DownloadCloud size={16} /> {t('export.pnl')}
                </Button>
              </div>
            </div>
          )}
        </QueryState>
      </section>

      {/* IVA acumulado — desglose por orden + export */}
      <section className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold">{t('iva.title')}</h2>
        <p className="text-sm text-muted">{t('iva.subtitle')}</p>
        <QueryState isLoading={iva.isLoading} isError={iva.isError} error={iva.error} onRetry={() => iva.refetch()}>
          {iva.data && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard
                label={t('iva.collected')}
                value={formatMoneyCents(iva.data.ivaCollectedCents, locale)}
                sub={t('iva.note')}
                icon={<ReceiptText size={18} />}
              />
            </div>
          )}
        </QueryState>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            loading={exportMutation.isPending && exportMutation.variables === 'iva'}
            onClick={() => exportMutation.mutate('iva')}
          >
            <DownloadCloud size={16} /> {t('export.iva')}
          </Button>
        </div>
        {exportMutation.isError && <Banner variant="danger" role="alert">{tc('errorGeneric')}</Banner>}
        <QueryState isLoading={iva.isLoading} isError={iva.isError} error={iva.error} onRetry={() => iva.refetch()}>
          {iva.data &&
            (iva.data.byOrder.length > 0 ? (
              <div className="rounded-lg border border-border bg-surface p-2">
                <DataTable columns={ivaColumns} rows={iva.data.byOrder} rowKey={(o) => o.orderId} />
              </div>
            ) : (
              <EmptyState title={t('iva.empty')} />
            ))}
        </QueryState>
      </section>
    </div>
  );
}

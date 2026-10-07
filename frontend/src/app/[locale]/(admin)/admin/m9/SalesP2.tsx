'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { AppLocale } from '@/i18n/routing';
import type { SalesBestDaysDTO, SalesMixCellDTO, SalesMixDTO, SalesReportDTO } from '@/types/contract';
import { formatMoneyCents } from '@/lib/format';
import { StatCard } from '@/components/ui/StatCard';
import { BarSeries, Segmented, type Bar } from './SalesBarChart';
import { SALES_GRID } from './SalesSummary';
import { fmtIsoWeekday, money, shortMoney, signedMoney } from './salesFormat';
import type { SalesChartMetric } from './salesParams';

/**
 * Totales P2 del periodo (`§AN-UX.8c`). Cada celda existe SOLO si su clave llega (⛔ `?? 0`, UX-AN-13/19).
 * «Resultado del envío» = `resultNetCents` tal cual (⛔ cobrado − costo en el navegador, AN-F-5).
 */
export function SalesP2Totals({ data }: { data: SalesReportDTO }) {
  const t = useTranslations('admin.m9.sales.p2');
  const locale = useLocale() as AppLocale;
  const fm = (n: number) => formatMoneyCents(n, locale);
  const { shipping, buylist, profitCents, chargebacks } = data.totals;
  if (!shipping || !buylist || profitCents === undefined) return null;
  const undated = data.chargebacksUndatedCount;
  return (
    <section data-testid="sales-p2-totals" className={SALES_GRID}>
      <StatCard label={t('shippingCharged')} value={fm(shipping.chargedNetCents)} />
      <StatCard
        label={t('shippingCost')}
        value={fm(shipping.costNetCents)}
        sub={
          (shipping.adjustmentsCents > 0 || shipping.costMissingCount > 0) && (
            <span className="flex flex-col gap-0.5">
              {shipping.adjustmentsCents > 0 && <span>{t('includesAdjustments', { amount: fm(shipping.adjustmentsCents) })}</span>}
              {shipping.costMissingCount > 0 && (
                <span>
                  <span aria-hidden>⚠ </span>
                  {t('costMissing', { count: shipping.costMissingCount })}
                </span>
              )}
            </span>
          )
        }
      />
      {shipping.resultNetCents !== undefined && (
        <StatCard
          label={t('shippingResult')}
          value={<span data-testid="sales-card-shippingResult">{signedMoney(shipping.resultNetCents, locale)}</span>}
          sub={
            <span className="flex flex-col gap-0.5">
              <span>{t('shippingResultHelp')}</span>
              {shipping.costMissingCount > 0 && (
                <span>
                  <span aria-hidden>⚠ </span>
                  {t('shippingResultMaybeLower')}
                </span>
              )}
            </span>
          }
        />
      )}
      <StatCard
        label={t('buylistPaid')}
        value={fm(buylist.paidNetCents)}
        sub={
          <span className="flex flex-col gap-0.5">
            <span>{t('buylistCount', { count: buylist.paidCount })}</span>
            {buylist.paidWithoutPayoutCount > 0 && (
              <span>
                <span aria-hidden>⚠ </span>
                {t('payoutMissing', { count: buylist.paidWithoutPayoutCount })}
              </span>
            )}
          </span>
        }
      />
      <StatCard label={t('profit')} value={money(profitCents, locale)} sub={t('profitHelp')} />
      {chargebacks !== undefined && (
        <StatCard
          label={t('chargebacks')}
          value={<span data-testid="sales-card-chargebacks">{t('chargebacksCount', { count: chargebacks.count })}</span>}
          sub={
            <span className="flex flex-col gap-0.5">
              <span>{fm(chargebacks.amountCents)}</span>
              <span>
                {t('chargebacksOutcome', {
                  open: chargebacks.byOutcome.open.count,
                  won: chargebacks.byOutcome.won.count,
                  lost: chargebacks.byOutcome.lost.count,
                })}
              </span>
              <span>{t('chargebacksHelp')}</span>
              {undated !== undefined && undated > 0 && (
                <span data-testid="sales-card-chargebacks-undated">
                  <span aria-hidden>⚠ </span>
                  {t('chargebacksUndated', { count: undated })}
                </span>
              )}
            </span>
          }
        />
      )}
    </section>
  );
}

/** «Cuándo se vende» (`§AN-UX.8a`, criterio 620): por día de la semana (7) y por hora MX (24). */
export function SalesWhen({ bestDays, totalOrders }: { bestDays: SalesBestDaysDTO; totalOrders: number }) {
  const t = useTranslations('admin.m9.sales');
  const locale = useLocale() as AppLocale;
  const [metric, setMetric] = useState<SalesChartMetric>('orders');
  const v = (x: { orders: number; chargedCents: number }) => (metric === 'orders' ? x.orders : x.chargedCents);
  const label = (x: { orders: number; chargedCents: number }) => (metric === 'orders' ? String(x.orders) : shortMoney(x.chargedCents, locale));
  const tip = (name: string, x: { orders: number; chargedCents: number }) =>
    `${name} · ${t('delta.orders', { diff: x.orders })} · ${formatMoneyCents(x.chargedCents, locale)}`;

  const wd: Bar[] = bestDays.byWeekday.map((d) => {
    const name = fmtIsoWeekday(d.weekday, locale);
    return { key: String(d.weekday), axis: name, tooltip: tip(name, d), value: v(d), valueLabel: label(d) };
  });
  const hr: Bar[] = bestDays.byHour.map((h) => {
    const hh = String(h.hour).padStart(2, '0');
    return { key: hh, axis: hh, tooltip: tip(t('when.hourRange', { from: hh }), h), value: v(h), valueLabel: label(h) };
  });
  const bestOf = <T extends { orders: number; chargedCents: number }>(xs: T[]) => xs.reduce((a, b) => (v(b) > v(a) ? b : a), xs[0]);
  const bw = bestOf(bestDays.byWeekday);
  const bh = bestOf(bestDays.byHour);
  const tick = (x: number) => (metric === 'orders' ? String(Math.round(x * 10) / 10) : shortMoney(x, locale));

  const table = (rows: Array<{ name: string; orders: number; chargedCents: number }>, first: string) => (
    <details className="text-sm">
      <summary className="cursor-pointer text-xs text-muted underline-offset-2 hover:underline">{t('when.asTable')}</summary>
      <table className="mt-2 w-full border-collapse">
        <thead>
          <tr className="border-y border-border">
            <th scope="col" className="eyebrow py-2 text-left font-medium">
              {first}
            </th>
            <th scope="col" className="eyebrow py-2 pr-5 text-right font-medium">
              {t('mix.colOrders')}
            </th>
            <th scope="col" className="eyebrow py-2 text-right font-medium">
              {t('mix.colCharged')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-b border-border">
              <th scope="row" className="py-2 text-left font-normal">
                {r.name}
              </th>
              <td className="tabular py-2 pr-5 text-right">{r.orders}</td>
              <td className="tabular py-2 text-right">{formatMoneyCents(r.chargedCents, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );

  return (
    <section aria-labelledby="sales-when-h" data-testid="sales-when" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="sales-when-h" className="text-h2 font-semibold">
          {t('when.title')}
        </h2>
        <Segmented
          label={t('chart.metricLabel')}
          value={metric}
          options={[
            { value: 'orders', label: t('chart.metricOrders') },
            { value: 'charged', label: t('chart.metricCharged') },
          ]}
          onChange={setMetric}
        />
      </div>
      {totalOrders < 30 && <p className="text-xs text-muted">{t('when.fewData')}</p>}
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="eyebrow">{t('when.byWeekday')}</h3>
          <BarSeries
            bars={wd}
            testId="sales-weekday-bar"
            heightClass="h-[140px]"
            formatTick={tick}
            ariaLabel={`${t('when.byWeekday')}: ${fmtIsoWeekday(bw.weekday, locale, 'long')}, ${label(bw)}`}
          />
          {table(
            bestDays.byWeekday.map((d) => ({ name: fmtIsoWeekday(d.weekday, locale, 'long'), orders: d.orders, chargedCents: d.chargedCents })),
            t('when.byWeekday'),
          )}
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="eyebrow">{t('when.byHour')}</h3>
          <BarSeries
            bars={hr}
            testId="sales-hour-bar"
            heightClass="h-[140px]"
            formatTick={tick}
            labelEvery={3}
            ariaLabel={`${t('when.byHour')}: ${t('when.hourRange', { from: String(bh.hour).padStart(2, '0') })}, ${label(bh)}`}
          />
          {table(
            bestDays.byHour.map((h) => ({ name: t('when.hourRange', { from: String(h.hour).padStart(2, '0') }), orders: h.orders, chargedCents: h.chargedCents })),
            t('when.byHour'),
          )}
        </div>
      </div>
    </section>
  );
}

const KNOWN_METHODS = ['card', 'oxxo', 'customer_balance'] as const;

/** «Cómo y a quién se vende» (`§AN-UX.8b`, criterio 621). Barra de proporción DECORATIVA; ⛔ porcentaje escrito. */
export function SalesMix({ mix, totalOrders, totalPieces }: { mix: SalesMixDTO; totalOrders: number; totalPieces: number }) {
  const t = useTranslations('admin.m9.sales.mix');
  const locale = useLocale() as AppLocale;
  const fm = (n: number) => formatMoneyCents(n, locale);
  const bar = (part: number, whole: number) => (
    <span aria-hidden className="mt-1 block h-[3px] bg-border">
      <span className="block h-full bg-text" style={{ width: whole > 0 ? `${(part / whole) * 100}%` : '0%' }} />
    </span>
  );
  const ordersTable = (caption: string, rows: Array<{ key: string; name: string; cell: SalesMixCellDTO }>, testId: string) => (
    <table className="w-full border-collapse" data-testid={testId}>
      <caption className="eyebrow pb-2 text-left">{caption}</caption>
      <thead>
        <tr className="border-y border-border">
          <th scope="col" className="sr-only">
            {caption}
          </th>
          <th scope="col" className="eyebrow py-2 pr-5 text-right font-medium">
            {t('colOrders')}
          </th>
          <th scope="col" className="eyebrow py-2 text-right font-medium">
            {t('colCharged')}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-b border-border">
            <th scope="row" className="py-2 text-left text-sm font-normal">
              {r.name}
              {bar(r.cell.orders, totalOrders)}
            </th>
            <td className="tabular py-2 pr-5 text-right text-sm">{r.cell.orders}</td>
            <td className="tabular py-2 text-right text-sm">{fm(r.cell.chargedCents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const methodName = (m: string | null) =>
    m === null ? t('method.none') : (KNOWN_METHODS as readonly string[]).includes(m) ? t(`method.${m}`) : t('method.other', { method: m });
  const pm = mix.byPaymentMethod;
  const nonNull = pm?.filter((r) => r.method !== null) ?? [];
  const pt = mix.byProductType;

  return (
    <section aria-labelledby="sales-mix-h" data-testid="sales-mix" className="flex flex-col gap-4">
      <h2 id="sales-mix-h" className="text-h2 font-semibold">
        {t('title')}
      </h2>
      <div className="grid gap-8 lg:grid-cols-2">
        {ordersTable(
          t('destination'),
          [
            { key: 'direct_ship', name: t('directShip'), cell: mix.byDestination.direct_ship },
            { key: 'vault', name: t('vault'), cell: mix.byDestination.vault },
          ],
          'sales-mix-destination',
        )}
        {ordersTable(
          t('buyer'),
          [
            { key: 'account', name: t('account'), cell: mix.byBuyer.account },
            { key: 'guest', name: t('guest'), cell: mix.byBuyer.guest },
          ],
          'sales-mix-buyer',
        )}
        {pm && (
          <div className="flex flex-col gap-2">
            {ordersTable(
              t('payment'),
              pm.map((r) => ({ key: r.method ?? '∅', name: methodName(r.method), cell: r })),
              'sales-mix-payment',
            )}
            {pm.some((r) => r.method === null) && <p className="text-xs text-muted">{t('noneNote')}</p>}
            {nonNull.length === 1 && nonNull[0].method === 'card' && <p className="text-xs text-muted">{t('cardOnly')}</p>}
          </div>
        )}
        {pt && (
          <div className="flex flex-col gap-2">
            <table className="w-full border-collapse" data-testid="sales-mix-product-type">
              <caption className="eyebrow pb-2 text-left">{t('productType')}</caption>
              <thead>
                <tr className="border-y border-border">
                  <th scope="col" className="sr-only">
                    {t('productType')}
                  </th>
                  <th scope="col" className="eyebrow py-2 pr-5 text-right font-medium">
                    {t('colPieces')}
                  </th>
                  <th scope="col" className="eyebrow py-2 text-right font-medium">
                    {t('colNet')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {(['raw', 'graded', 'sealed'] as const).map((k) => {
                  const c = pt[k];
                  return (
                    <tr key={k} className={`border-b border-border ${c.pieces === 0 ? 'text-muted' : ''}`}>
                      <th scope="row" className="py-2 text-left text-sm font-normal">
                        {t(k)}
                        {bar(c.pieces, totalPieces)}
                      </th>
                      <td className="tabular py-2 pr-5 text-right text-sm">{c.pieces}</td>
                      <td className="tabular py-2 text-right text-sm">{fm(c.netCents)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-xs text-muted">{t('productTypeNote')}</p>
          </div>
        )}
      </div>
    </section>
  );
}

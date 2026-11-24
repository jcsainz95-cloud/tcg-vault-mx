/**
 * reports-finance.service.ts — 💰 §REPORTES-CEO F2b (API_CONTRACT_REPORTES §3 y §3b): `GET /admin/reports/finance/pnl` y
 * `.../pnl/series` (día/semana y consolidados de calendario). Solo lectura; solo `super_admin` (el controlador).
 * ⛔ Ninguna fórmula nueva de dinero: las cifras salen de `pnlLinesBuckets` (`pnl-lines.ts`), que lee lo mismo que `pnlBuckets`.
 */
import { Injectable } from '@nestjs/common';
import { BusinessException } from '../../common/business.exception';
import { toMexicoCityDateKey } from '../../common/business-days';
import { PrismaService } from '../../prisma/prisma.service';
import { RefundReportsService } from '../payments/refunds/refund-reports.service';
import { isYmd, prevYmd } from '../spend-alerts/mx-day';
import { firstDataDay } from '../sales-analytics/first-data-day';
import {
  bucketKeyOf,
  bucketsOf,
  comparisonBasis,
  daysBetween,
  isToDate,
  mxRange,
  previousRange,
  shiftUnitBack,
  todayMx,
  type PeriodKind,
  type Ymd,
} from '../sales-analytics/sales-period';
import { AdminService } from './admin.service';
import { deltaOf, type CentsDelta } from './pnl-core';
import {
  columnOf,
  LineCounters,
  LineMemo,
  LineSet,
  PnlColumn,
  pnlLinesBuckets,
  RENGLONES,
  Renglon,
  renglonOf,
  totalOf,
  zeroLineSet,
  addLineSets,
} from './pnl-lines';
import { LineKey, PNL_LINES } from './pnl-allocation';

export const SERIES_LINE_VALUES: readonly (LineKey | 'all')[] = [...PNL_LINES, 'all'];
export const SERIES_GROUP_BY_VALUES = ['day', 'week', 'month', 'quarter', 'semester', 'year'] as const;
export type SeriesGroupBy = (typeof SERIES_GROUP_BY_VALUES)[number];
type CalendarUnit = 'month' | 'quarter' | 'semester' | 'year';
const UNIT_MONTHS: Record<CalendarUnit, number> = { month: 1, quarter: 3, semester: 6, year: 12 };
const TZ = 'America/Mexico_City' as const;
const SERIES_MAX_DAYS = 366;

type Comparison = {
  basis: 'complete' | 'partial' | 'none';
  dataSince: Ymd | null;
  total: Record<Renglon, CentsDelta>;
  byLine: Record<LineKey, Record<Renglon, CentsDelta>>;
};

const ymdOfMonthTotal = (t: number): Ymd => `${String(Math.floor(t / 12)).padStart(4, '0')}-${String((t % 12) + 1).padStart(2, '0')}-01`;
const lastDayOfMonthTotal = (t: number): Ymd => prevYmd(ymdOfMonthTotal(t + 1));

function badRequest(field: string, message: string): never {
  throw BusinessException.badRequest('VALIDATION_ERROR', message, { field });
}

/** Contrato §2/§3: forma inválida ⇒ 400; fecha inexistente o año fuera de 2020..2100 ⇒ 422 con `details.field`. */
function readYmd(raw: unknown, field: string): Ymd {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) badRequest(field, `${field} must be YYYY-MM-DD`);
  const year = Number(raw.slice(0, 4));
  if (!isYmd(raw) || year < 2020 || year > 2100) throw BusinessException.validation('VALIDATION_ERROR', `invalid ${field} date`, { field });
  return raw;
}

const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

@Injectable()
export class ReportsFinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: AdminService,
  ) {}

  /** `from`/`to` ambos o ninguno. */
  private readPeriod(from: unknown, to: unknown): { from: Ymd; to: Ymd } | null {
    if (blank(from) && blank(to)) return null;
    if (blank(from)) badRequest('from', 'from and to go together');
    if (blank(to)) badRequest('to', 'from and to go together');
    const f = readYmd(from, 'from');
    const t = readYmd(to, 'to');
    if (f > t) throw BusinessException.validation('VALIDATION_ERROR', 'from must be earlier than or equal to to', { field: 'from' });
    return { from: f, to: t };
  }

  private async fiscalStartMonth(): Promise<number> {
    const row = await this.prisma.configSetting.findUnique({ where: { key: 'fiscal_year_start_month' } });
    const v = row?.valueJson;
    return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 12 ? v : 1;
  }

  private compare(cur: LineSet, prev: LineSet, basis: { basis: 'complete' | 'partial' | 'none'; dataSince: Ymd | null }): Comparison {
    const deltas = (a: PnlColumn, b: PnlColumn) => Object.fromEntries(RENGLONES.map((r) => [r, deltaOf(renglonOf(a, r), renglonOf(b, r))])) as Record<Renglon, CentsDelta>;
    const byLine = Object.fromEntries(PNL_LINES.map((l) => [l, deltas(columnOf(cur[l]), columnOf(prev[l]))])) as Record<LineKey, Record<Renglon, CentsDelta>>;
    return {
      basis: basis.basis,
      dataSince: basis.dataSince,
      total: deltas(columnOf(totalOf(cur), true), columnOf(totalOf(prev), true)),
      byLine,
    };
  }

  private ownOf(set: LineSet) {
    return {
      sealed: columnOf(set.sealed),
      raw: columnOf(set.raw),
      graded: columnOf(set.graded),
      accessory: columnOf(set.accessory),
      unassigned: columnOf(set.unassigned),
      total: columnOf(totalOf(set), true),
    };
  }

  /** Lee un rango (o el histórico si `rng` es `undefined`) como un solo cubo. */
  private async readOne(rng: { gte: Date; lt: Date } | undefined, opts: Parameters<typeof pnlLinesBuckets>[3] = {}): Promise<LineSet> {
    const m = await pnlLinesBuckets(this.prisma, rng, () => 'all', opts);
    return m.get('all') ?? zeroLineSet();
  }

  /** `GET /admin/reports/finance/pnl?from&to&kind` (contrato §3). */
  async report(q: { from?: unknown; to?: unknown; kind?: PeriodKind }) {
    const per = this.readPeriod(q.from, q.to);
    const rng = per ? mxRange(per.from, per.to) : undefined;
    const estimate = { orders: 0, cents: 0 };
    const counters: LineCounters = { costMissingCount: 0, allocationMismatchOrders: 0 };
    const memoSums: LineMemo = { insuranceCents: 0, adjustmentsCents: 0, retainedFeeCents: 0, guideCostCents: 0 };
    const [cur, iva, firstDay, chargebacks, purchases, shrink] = await Promise.all([
      this.readOne(rng, { estimate, counters, memo: memoSums }),
      this.admin.ivaReport(per?.from, per?.to),
      firstDataDay(this.prisma),
      this.prisma.order.findMany({ where: { status: 'chargeback', settledAt: rng ?? { not: null } }, select: { totalCents: true } }),
      this.prisma.sellRequest.findMany({ where: { status: 'pagada', ...(rng ? { paidAt: rng } : {}) }, select: { payoutNetCents: true } }),
      this.prisma.inventoryMovement.findMany({
        where: RefundReportsService.shrinkageWhere(rng ? { createdAt: rng } : {}),
        select: { item: { select: { acquisitionCostCents: true } } },
      }),
    ]);
    const own = this.ownOf(cur);
    const memo = {
      iva: { collectedCents: iva.ivaCollectedCents, refundedCents: iva.ivaRefundedCents, netCents: iva.ivaNetCents },
      inventoryPurchasesCents: purchases.reduce((s, r) => s + (r.payoutNetCents ?? 0), 0),
      chargebacks: { orders: chargebacks.length, cents: chargebacks.reduce((s, o) => s + o.totalCents, 0) },
      shrinkageCents: shrink.reduce((s, m) => s + (m.item.acquisitionCostCents ?? 0), 0),
      shipping: { insuranceCents: memoSums.insuranceCents, adjustmentsCents: memoSums.adjustmentsCents },
      buylist: { retainedFeeCents: memoSums.retainedFeeCents, guideCostCents: memoSums.guideCostCents },
    };
    let period = null;
    let previousPeriod = null;
    let previous = null;
    let comparison: Comparison | null = null;
    if (per) {
      const pr = previousRange(q.kind, per.from, per.to);
      // `range()` no acepta años < 2020 (contrato §2): un tramo anterior que los toca se lee desde 2020-01-01 (no hay datos
      // antes) y, si cae entero antes, es un P&L vacío (`basis:'none'`). `previousPeriod` conserva las fechas reales.
      const FLOOR = '2020-01-01';
      const entirelyBefore = pr.to < FLOOR;
      const qFrom = pr.from < FLOOR ? FLOOR : pr.from;
      const prevSet = entirelyBefore ? zeroLineSet() : await this.readOne(mxRange(qFrom, pr.to));
      period = { from: per.from, to: per.to, kind: pr.kind, days: daysBetween(per.from, per.to) + 1, timezone: TZ, toDate: isToDate(pr.kind, per.from, per.to) };
      previousPeriod = { from: pr.from, to: pr.to, clamped: pr.clamped };
      previous = { own: this.ownOf(prevSet), total: columnOf(totalOf(prevSet), true) };
      const basis = comparisonBasis(firstDay, pr);
      const cmp = this.compare(cur, prevSet, basis);
      comparison = { basis: cmp.basis, dataSince: cmp.dataSince, total: cmp.total, byLine: cmp.byLine } as Comparison;
    }
    return {
      period,
      previousPeriod,
      firstDataDay: firstDay,
      own,
      marketplace: { available: false as const, gmvCents: null, commissionCents: null },
      total: own.total,
      memo,
      previous,
      comparison,
      costMissingCount: counters.costMissingCount,
      stripeFeeEstimatedOrders: estimate.orders,
      allocationMismatchOrders: counters.allocationMismatchOrders,
    };
  }

  /** `GET /admin/reports/finance/pnl/series` (día/semana, §3) o consolidados de calendario (§3b). */
  async series(
    q: { from?: unknown; to?: unknown; groupBy?: SeriesGroupBy; line?: LineKey | 'all'; count?: unknown; asOf?: unknown },
    now: Date = new Date(),
  ) {
    const groupBy = q.groupBy ?? 'day';
    if (groupBy === 'day' || groupBy === 'week') return this.seriesDays(q, groupBy);
    return this.seriesCalendar(q, groupBy, now);
  }

  private async seriesDays(q: { from?: unknown; to?: unknown; line?: LineKey | 'all' }, groupBy: 'day' | 'week') {
    const per = this.readPeriod(q.from, q.to);
    if (!per) badRequest('from', `groupBy=${groupBy} needs from and to`);
    const days = daysBetween(per.from, per.to) + 1;
    if (groupBy === 'day' && days > SERIES_MAX_DAYS) badRequest('groupBy', `groupBy=day over ${SERIES_MAX_DAYS} days: use week`);
    const line = q.line ?? 'all';
    const buckets = bucketsOf(per.from, per.to, groupBy);
    const map = await pnlLinesBuckets(this.prisma, mxRange(per.from, per.to), (d) => bucketKeyOf(d as Date, groupBy, per.from));
    const pick = (s: LineSet, withFixed: boolean) => columnOf(line === 'all' ? totalOf(s) : s[line], withFixed && line === 'all');
    let total = zeroLineSet();
    const outBuckets = buckets.map((b) => {
      const s = map.get(b.from) ?? zeroLineSet();
      total = addLineSets(total, s);
      return { from: b.from, to: b.to, column: pick(s, false) };
    });
    return {
      period: { from: per.from, to: per.to, kind: 'span' as PeriodKind, days, timezone: TZ, toDate: false, groupBy, line },
      buckets: outBuckets,
      total: pick(total, true),
    };
  }

  private async seriesCalendar(q: { count?: unknown; asOf?: unknown }, unit: CalendarUnit, now: Date) {
    let count = 4;
    if (!blank(q.count)) {
      const c = typeof q.count === 'number' ? q.count : typeof q.count === 'string' && /^\d+$/.test(q.count.trim()) ? Number(q.count) : NaN;
      if (!Number.isInteger(c) || c < 1 || c > 12) badRequest('count', 'count must be an integer in 1..12');
      count = c;
    }
    const today = todayMx(now);
    const asOf = blank(q.asOf) ? today : readYmd(q.asOf, 'asOf');
    if (asOf > today) badRequest('asOf', 'asOf must not be after today (America/Mexico_City)');
    const s = await this.fiscalStartMonth();
    const n = UNIT_MONTHS[unit];
    const y = Number(asOf.slice(0, 4));
    const m = Number(asOf.slice(5, 7));
    const offset = (m - s + 12) % 12; // meses transcurridos del año fiscal
    const curStart = y * 12 + (m - 1) - (offset % n);
    const specs: { from: Ymd; to: Ymd; closed: boolean }[] = [];
    for (let k = count; k >= 0; k--) {
      const startT = curStart - k * n;
      const from = ymdOfMonthTotal(startT);
      const end = lastDayOfMonthTotal(startT + n - 1);
      specs.push(k === 0 ? { from, to: asOf, closed: asOf >= end } : { from, to: end, closed: true });
    }
    const withPrev = specs.map((b) => ({ ...b, prev: shiftUnitBack(unit, b.from, b.to) }));
    // Un solo escaneo sobre [min(previous.from), asOf]: por día MX; cada rango (cubo y su tramo anterior) se suma de los días.
    const scanFrom = withPrev.reduce((mn, b) => (b.prev.from < mn ? b.prev.from : mn), withPrev[0].from);
    const perDay = await pnlLinesBuckets(this.prisma, mxRange(scanFrom, asOf), (d) => (d ? toMexicoCityDateKey(d) : ''));
    const sumRange = (from: Ymd, to: Ymd): LineSet => {
      let acc = zeroLineSet();
      for (const [k, v] of perDay) if (k >= from && k <= to) acc = addLineSets(acc, v);
      return acc;
    };
    const firstDay = await firstDataDay(this.prisma);
    const buckets = withPrev.map((b) => {
      const cur = sumRange(b.from, b.to);
      const prevSet = sumRange(b.prev.from, b.prev.to);
      const cmp = this.compare(cur, prevSet, comparisonBasis(firstDay, b.prev));
      const own = this.ownOf(cur);
      return {
        from: b.from,
        to: b.to,
        kind: unit,
        toDate: isToDate(unit, b.from, b.to),
        days: daysBetween(b.from, b.to) + 1,
        own,
        total: own.total,
        comparison: {
          basis: cmp.basis,
          dataSince: cmp.dataSince,
          previous: { from: b.prev.from, to: b.prev.to, clamped: b.prev.clamped },
          total: cmp.total,
          byLine: cmp.byLine,
        },
      };
    });
    return { asOf, fiscalYearStartMonth: s, unit, buckets };
  }
}


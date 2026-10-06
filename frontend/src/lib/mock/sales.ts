/**
 * MOCK · SERVIDOR FALSO de la analítica de ventas del dueño (`docs/API_CONTRACT.md §15`, rev v1.85⟨ventas⟩).
 * // MOCK: pendiente de backend real (`modules/sales-analytics/` se está construyendo en paralelo).
 *
 * Replica la conducta OBSERVABLE del contrato:
 * - `403 FORBIDDEN` para quien no sea `super_admin` (§15.1, criterio 613).
 * - Los `400 VALIDATION_ERROR` de §15.2, con `details.field`/`allowed` y ⛔ sin `details.value`.
 * - Presets resueltos «en el servidor» con días de México; periodo anterior = los mismos N días antes de `from`.
 * - Cubos `day|week|month` (semana lunes–domingo, recortados al periodo), TODOS, también los de cero.
 * - `totals` = Σ de los días (no cambia con `groupBy`); ticket y piezas/pedido sobre los totales; `null` con 0 pedidos.
 * - `Delta.pct` entero, mitad lejos de cero, `null` si el anterior es 0 o alguno es `null`.
 *
 * ⚠️ Esto es el ÚNICO sitio del front donde se suman y dividen cifras de ventas, y existe solo porque hace de
 * servidor (como `spend-alerts.ts`). La pantalla pinta el DTO tal cual (AN-1); ningún componente importa de aquí.
 *
 * Datos: pedidos sintéticos DETERMINISTAS por día (hash del `YYYY-MM-DD`), así la misma URL da la misma pantalla.
 * Fase del servidor (para ver la pantalla con y sin P2): `localStorage['tcg.salesPhase'] = 'A' | 'B' | 'C'`
 * (default `'C'`, todo). Ningún dato de cliente sale de aquí: las llaves de cliente son internas.
 */
import type {
  SalesBestDaysDTO,
  SalesDeltaDTO,
  SalesFiguresDTO,
  SalesGroupBy,
  SalesMixDTO,
  SalesPreset,
  SalesReportDTO,
  SalesReportParams,
  SalesRowDTO,
  SalesTodayDTO,
  SalesTopCardDTO,
  SalesTopSealedDTO,
  SalesTopSetDTO,
  SalesTopSort,
  Finish,
  ProductType,
} from '@/types/contract';
import { ApiFixtureError } from './fixtures';
import { mockCallerRole } from './m4-ship';

const PRESETS: readonly SalesPreset[] = ['today', 'yesterday', 'last7', 'last30', 'this_month', 'last_month', 'custom'];
const GROUP_BYS: readonly SalesGroupBy[] = ['day', 'week', 'month'];
const TOP_SORTS: readonly SalesTopSort[] = ['net', 'pieces'];
const MAX_DAYS = 366;
/** Desde este día el servidor falso «guarda» el método de pago (M-AN-1); antes ⇒ `null`. */
const PAYMENT_METHOD_SINCE = '2026-09-15';

// ---------------------------------------------------------------- días de México

export function mockTodayMx(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(now);
}
function toDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00Z`);
}
function ymdOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(ymd: string, n: number): string {
  const d = toDate(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return ymdOf(d);
}
function daysBetween(from: string, to: string): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86_400_000) + 1;
}
/** 1 = lunes … 7 = domingo. */
function isoWeekday(ymd: string): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  const d = toDate(ymd).getUTCDay();
  return (d === 0 ? 7 : d) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
}
function isYmd(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = toDate(v);
  return !Number.isNaN(d.getTime()) && ymdOf(d) === v;
}

// ---------------------------------------------------------------- datos sintéticos

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

interface CatalogEntry {
  kind: 'card' | 'sealed';
  cardId: string;
  name: string;
  number: string;
  setId: string;
  setName: string;
  finish: Finish;
  productType: ProductType;
  sealedProductId: string | null;
  unitNetCents: number;
  /** Lo que cobra el renglón (IVA y comisión dentro), DATO del simulador: ⛔ ningún factor de IVA en el front. */
  unitChargedCents: number;
}
const CATALOG: CatalogEntry[] = [
  { kind: 'card', cardId: 'sv3pt5-199', name: 'Charizard ex', number: '199/165', setId: 'sv3pt5', setName: '151', finish: 'reverse_holo', productType: 'raw', sealedProductId: null, unitNetCents: 140000, unitChargedCents: 167300 },
  { kind: 'card', cardId: 'sv3pt5-199', name: 'Charizard ex', number: '199/165', setId: 'sv3pt5', setName: '151', finish: 'holofoil', productType: 'raw', sealedProductId: null, unitNetCents: 125000, unitChargedCents: 149375 },
  { kind: 'card', cardId: 'base1-58', name: 'Pikachu', number: '58/102', setId: 'base1', setName: 'Base', finish: 'normal', productType: 'graded', sealedProductId: null, unitNetCents: 210000, unitChargedCents: 250950 },
  { kind: 'card', cardId: 'sv3pt5-25', name: 'Pikachu', number: '025/165', setId: 'sv3pt5', setName: '151', finish: 'normal', productType: 'raw', sealedProductId: null, unitNetCents: 3500, unitChargedCents: 4182 },
  { kind: 'card', cardId: 'sv4pt5-232', name: 'Mew ex', number: '232/091', setId: 'sv4pt5', setName: 'Paldean Fates', finish: 'holofoil', productType: 'raw', sealedProductId: null, unitNetCents: 52000, unitChargedCents: 62140 },
  { kind: 'card', cardId: 'swsh7-215', name: 'Umbreon VMAX', number: '215/203', setId: 'swsh7', setName: 'Evolving Skies', finish: 'holofoil', productType: 'graded', sealedProductId: null, unitNetCents: 690000, unitChargedCents: 824550 },
  { kind: 'card', cardId: 'sv2-254', name: 'Iono', number: '254/193', setId: 'sv2', setName: 'Paldea Evolved', finish: 'holofoil', productType: 'raw', sealedProductId: null, unitNetCents: 24000, unitChargedCents: 28680 },
  { kind: 'card', cardId: 'sv1-81', name: 'Miraidon ex', number: '081/198', setId: 'sv1', setName: 'Scarlet & Violet', finish: 'normal', productType: 'raw', sealedProductId: null, unitNetCents: 8000, unitChargedCents: 9560 },
  { kind: 'card', cardId: 'sv6-130', name: 'Greninja ex', number: '130/167', setId: 'sv6', setName: 'Twilight Masquerade', finish: 'reverse_holo', productType: 'raw', sealedProductId: null, unitNetCents: 15000, unitChargedCents: 17925 },
  { kind: 'card', cardId: 'swsh12-186', name: 'Lugia V', number: '186/195', setId: 'swsh12', setName: 'Silver Tempest', finish: 'holofoil', productType: 'raw', sealedProductId: null, unitNetCents: 98000, unitChargedCents: 117110 },
  { kind: 'card', cardId: 'sv5-24', name: 'Gouging Fire', number: '024/162', setId: 'sv5', setName: 'Temporal Forces', finish: 'normal', productType: 'raw', sealedProductId: null, unitNetCents: 2500, unitChargedCents: 2988 },
  { kind: 'card', cardId: 'sv3-125', name: 'Charizard ex', number: '125/197', setId: 'sv3', setName: 'Obsidian Flames', finish: 'holofoil', productType: 'raw', sealedProductId: null, unitNetCents: 36000, unitChargedCents: 43020 },
  { kind: 'sealed', cardId: 'sp-151-etb', name: 'Elite Trainer Box', number: '', setId: 'sv3pt5', setName: '151', finish: 'normal', productType: 'sealed', sealedProductId: 'sp-151-etb', unitNetCents: 180000, unitChargedCents: 215100 },
  { kind: 'sealed', cardId: 'sp-pf-bundle', name: 'Booster Bundle', number: '', setId: 'sv4pt5', setName: 'Paldean Fates', finish: 'normal', productType: 'sealed', sealedProductId: 'sp-pf-bundle', unitNetCents: 72000, unitChargedCents: 86040 },
  { kind: 'sealed', cardId: 'sp-legacy-tin', name: 'Lata de colección (sin producto)', number: '', setId: 'swsh12', setName: 'Silver Tempest', finish: 'normal', productType: 'sealed', sealedProductId: null, unitNetCents: 45000, unitChargedCents: 53775 },
];

/** Envío a domicilio: 150.00 sin IVA, 174.00 cobrado (dato del simulador). */
const SHIP_CHARGED_CENTS = 17400;

interface MockOrder {
  day: string;
  hour: number;
  customer: string;
  guest: boolean;
  direct: boolean;
  method: string | null;
  refunded: boolean;
  items: CatalogEntry[];
  netCents: number;
  chargedCents: number;
  shipNetCents: number;
  shipCostCents: number | null;
}

function ordersOfDay(day: string): MockOrder[] {
  const h = hash(day);
  // ~1 de cada 3 días sin ventas (con pocas ventas, ver los días vacíos ES la información).
  const count = h % 3 === 0 ? 0 : (h >>> 3) % 5;
  const out: MockOrder[] = [];
  for (let i = 0; i < count; i++) {
    const s = hash(`${day}#${i}`);
    const nItems = 1 + (s % 3);
    const items: CatalogEntry[] = [];
    for (let k = 0; k < nItems; k++) items.push(CATALOG[hash(`${day}#${i}#${k}`) % CATALOG.length]);
    const direct = s % 5 < 3;
    const netCents = items.reduce((a, it) => a + it.unitNetCents, 0);
    const shipNetCents = direct ? 15000 : 0;
    const methodRoll = (s >>> 5) % 10;
    out.push({
      day,
      hour: 9 + ((s >>> 7) % 15),
      customer: `c${(s >>> 9) % 40}`,
      guest: (s >>> 11) % 4 === 0,
      direct,
      method: day < PAYMENT_METHOD_SINCE ? null : methodRoll < 8 ? 'card' : methodRoll === 8 ? 'oxxo' : 'link',
      refunded: (s >>> 13) % 15 === 0,
      items,
      netCents,
      chargedCents: items.reduce((a, it) => a + it.unitChargedCents, 0) + (direct ? SHIP_CHARGED_CENTS : 0),
      shipNetCents,
      shipCostCents: direct ? ((s >>> 15) % 7 === 0 ? null : 11800) : null,
    });
  }
  return out;
}

/** Reembolsos de ejemplo: monto al cliente y su parte sin IVA, como DATOS (⛔ dividir por la tasa en el front). */
const REFUND_AMOUNTS: Array<{ amountCents: number; netCents: number }> = [
  { amountCents: 40000, netCents: 34483 },
  { amountCents: 50000, netCents: 43103 },
  { amountCents: 60000, netCents: 51724 },
  { amountCents: 70000, netCents: 60345 },
];

interface DayRefund {
  channel: 'card' | 'spei';
  amountCents: number;
  netCents: number;
}
function refundsOfDay(day: string): DayRefund[] {
  const h = hash(`refund:${day}`);
  if (h % 7 !== 0) return [];
  const r = REFUND_AMOUNTS[h % REFUND_AMOUNTS.length];
  return [{ channel: h % 2 === 0 ? 'card' : 'spei', ...r }];
}

// ---------------------------------------------------------------- cifras

type Additive = Omit<SalesFiguresDTO, 'avgTicketCents' | 'piecesPerOrder'>;

function zeroAdditive(): Required<Additive> {
  return {
    orders: 0,
    chargedCents: 0,
    netSalesCents: 0,
    refunds: { count: 0, amountCents: 0, netCents: 0, byChannel: { card: { count: 0, amountCents: 0 }, spei: { count: 0, amountCents: 0 } } },
    netSalesAfterRefundsCents: 0,
    pieces: 0,
    shipping: { chargedNetCents: 0, costNetCents: 0, costMissingCount: 0, adjustmentsCents: 0, resultNetCents: 0 },
    buylist: { paidCount: 0, paidNetCents: 0, paidWithoutPayoutCount: 0 },
    profitCents: 0,
    chargebacks: { count: 0, amountCents: 0, byOutcome: { open: { count: 0, amountCents: 0 }, won: { count: 0, amountCents: 0 }, lost: { count: 0, amountCents: 0 } } },
  };
}

function dayAdditive(day: string): Required<Additive> {
  const f = zeroAdditive();
  for (const o of ordersOfDay(day)) {
    f.orders += 1;
    f.chargedCents += o.chargedCents;
    f.netSalesCents += o.netCents;
    f.pieces += o.items.length;
    f.shipping.chargedNetCents += o.shipNetCents;
    if (o.direct) {
      if (o.shipCostCents === null) f.shipping.costMissingCount += 1;
      else f.shipping.costNetCents += o.shipCostCents;
    }
  }
  for (const r of refundsOfDay(day)) {
    f.refunds.count += 1;
    f.refunds.amountCents += r.amountCents;
    f.refunds.netCents += r.netCents;
    f.refunds.byChannel[r.channel].count += 1;
    f.refunds.byChannel[r.channel].amountCents += r.amountCents;
  }
  const h = hash(`p2:${day}`);
  if (h % 11 === 0) {
    f.shipping.adjustmentsCents += 2500;
    f.shipping.costNetCents += 2500; // «ya van dentro del costo de guías»
  }
  if (h % 4 === 0) {
    f.buylist.paidCount += 1;
    f.buylist.paidNetCents += 180000;
  }
  if (h % 13 === 0) {
    f.buylist.paidCount += 1;
    f.buylist.paidWithoutPayoutCount += 1;
  }
  if (h % 17 === 0) {
    const amountCents = 95000;
    const outcome = (['open', 'won', 'lost'] as const)[(h >>> 5) % 3];
    f.chargebacks.count += 1;
    f.chargebacks.amountCents += amountCents;
    f.chargebacks.byOutcome[outcome].count += 1;
    f.chargebacks.byOutcome[outcome].amountCents += amountCents;
  }
  f.shipping.resultNetCents = f.shipping.chargedNetCents - f.shipping.costNetCents;
  f.netSalesAfterRefundsCents = f.netSalesCents - f.refunds.netCents;
  f.profitCents = Math.round(f.netSalesAfterRefundsCents * 0.3) + f.shipping.chargedNetCents - f.shipping.costNetCents;
  return f;
}

function addInto(acc: Required<Additive>, f: Required<Additive>): void {
  acc.orders += f.orders;
  acc.chargedCents += f.chargedCents;
  acc.netSalesCents += f.netSalesCents;
  acc.refunds.count += f.refunds.count;
  acc.refunds.amountCents += f.refunds.amountCents;
  acc.refunds.netCents += f.refunds.netCents;
  for (const ch of ['card', 'spei'] as const) {
    acc.refunds.byChannel[ch].count += f.refunds.byChannel[ch].count;
    acc.refunds.byChannel[ch].amountCents += f.refunds.byChannel[ch].amountCents;
  }
  acc.netSalesAfterRefundsCents += f.netSalesAfterRefundsCents;
  acc.pieces += f.pieces;
  acc.shipping.chargedNetCents += f.shipping.chargedNetCents;
  acc.shipping.costNetCents += f.shipping.costNetCents;
  acc.shipping.costMissingCount += f.shipping.costMissingCount;
  acc.shipping.adjustmentsCents += f.shipping.adjustmentsCents;
  acc.shipping.resultNetCents = (acc.shipping.resultNetCents ?? 0) + (f.shipping.resultNetCents ?? 0);
  acc.chargebacks.count += f.chargebacks.count;
  acc.chargebacks.amountCents += f.chargebacks.amountCents;
  for (const k of ['open', 'won', 'lost'] as const) {
    acc.chargebacks.byOutcome[k].count += f.chargebacks.byOutcome[k].count;
    acc.chargebacks.byOutcome[k].amountCents += f.chargebacks.byOutcome[k].amountCents;
  }
  acc.buylist.paidCount += f.buylist.paidCount;
  acc.buylist.paidNetCents += f.buylist.paidNetCents;
  acc.buylist.paidWithoutPayoutCount += f.buylist.paidWithoutPayoutCount;
  acc.profitCents += f.profitCents;
}

/** Ticket y piezas/pedido SOBRE los totales del cubo (§15.4), ⛔ nunca promediando filas. */
function finish(a: Required<Additive>): Required<SalesFiguresDTO> {
  return {
    ...a,
    avgTicketCents: a.orders === 0 ? null : Math.floor(a.chargedCents / a.orders + 0.5),
    piecesPerOrder: a.orders === 0 ? null : Math.round((a.pieces * 10) / a.orders) / 10,
  };
}

function figuresOf(from: string, to: string): Required<SalesFiguresDTO> {
  const acc = zeroAdditive();
  for (let d = from; d <= to; d = addDays(d, 1)) addInto(acc, dayAdditive(d));
  return finish(acc);
}

function delta(curr: number | null, prev: number | null): SalesDeltaDTO {
  if (curr === null || prev === null) return { diff: null, pct: null };
  const diff = Math.round((curr - prev) * 10) / 10;
  if (prev === 0) return { diff, pct: null };
  const raw = (diff / prev) * 100;
  return { diff, pct: Math.sign(raw) * Math.round(Math.abs(raw)) };
}

function buckets(from: string, to: string, groupBy: SalesGroupBy): Array<{ from: string; to: string }> {
  if (groupBy === 'day') {
    const out: Array<{ from: string; to: string }> = [];
    for (let d = from; d <= to; d = addDays(d, 1)) out.push({ from: d, to: d });
    return out;
  }
  const out: Array<{ from: string; to: string }> = [];
  let start = from;
  while (start <= to) {
    let end: string;
    if (groupBy === 'week') end = addDays(start, 7 - isoWeekday(start));
    else {
      const d = toDate(start);
      end = ymdOf(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
    }
    if (end > to) end = to; // recortado al periodo
    out.push({ from: start, to: end });
    start = addDays(end, 1);
  }
  return out;
}

// ---------------------------------------------------------------- top, clientes, P2

function topLists(from: string, to: string, sort: SalesTopSort): SalesReportDTO['top'] {
  const cards = new Map<string, SalesTopCardDTO>();
  const sets = new Map<string, SalesTopSetDTO>();
  const sealed = new Map<string, SalesTopSealedDTO>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    for (const o of ordersOfDay(d)) {
      if (o.refunded) continue; // reembolso completo: fuera de «lo más vendido» (§15.3)
      for (const it of o.items) {
        if (it.kind === 'card') {
          const k = `${it.cardId}|${it.productType}|${it.finish}`;
          const c = cards.get(k) ?? { cardId: it.cardId, name: it.name, number: it.number, setName: it.setName, finish: it.finish, productType: it.productType, pieces: 0, netCents: 0 };
          c.pieces += 1;
          c.netCents += it.unitNetCents;
          cards.set(k, c);
        } else {
          const k = it.sealedProductId ?? `name:${it.name}`;
          const s = sealed.get(k) ?? { sealedProductId: it.sealedProductId, name: it.name, setName: it.sealedProductId ? it.setName : null, pieces: 0, netCents: 0 };
          s.pieces += 1;
          s.netCents += it.unitNetCents;
          sealed.set(k, s);
        }
        const st = sets.get(it.setId) ?? { setId: it.setId, setName: it.setName, pieces: 0, netCents: 0 };
        st.pieces += 1;
        st.netCents += it.unitNetCents;
        sets.set(it.setId, st);
      }
    }
  }
  const cmp = <T extends { pieces: number; netCents: number }>(name: (x: T) => string) => (a: T, b: T) => {
    const [p, q] = sort === 'net' ? [b.netCents - a.netCents, b.pieces - a.pieces] : [b.pieces - a.pieces, b.netCents - a.netCents];
    return p || q || name(a).localeCompare(name(b));
  };
  return {
    sort,
    cards: [...cards.values()].sort(cmp<SalesTopCardDTO>((x) => x.name)).slice(0, 10),
    sets: [...sets.values()].sort(cmp<SalesTopSetDTO>((x) => x.setName)).slice(0, 10),
    sealed: [...sealed.values()].sort(cmp<SalesTopSealedDTO>((x) => x.name)).slice(0, 10),
  };
}

function customersOf(from: string, to: string): SalesReportDTO['customers'] {
  const inPeriod = new Set<string>();
  for (let d = from; d <= to; d = addDays(d, 1)) for (const o of ordersOfDay(d)) inPeriod.add(o.customer);
  // MOCK: la historia «anterior a from» se mira 180 días hacia atrás (el servidor real mira toda).
  const before = new Set<string>();
  for (let d = addDays(from, -180); d < from; d = addDays(d, 1)) for (const o of ordersOfDay(d)) before.add(o.customer);
  let returning = 0;
  for (const c of inPeriod) if (before.has(c)) returning += 1;
  return { new: inPeriod.size - returning, returning, distinct: inPeriod.size };
}

function bestDaysOf(from: string, to: string): SalesBestDaysDTO {
  const byWeekday = ([1, 2, 3, 4, 5, 6, 7] as const).map((weekday) => ({ weekday, orders: 0, chargedCents: 0 }));
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0, chargedCents: 0 }));
  for (let d = from; d <= to; d = addDays(d, 1)) {
    for (const o of ordersOfDay(d)) {
      const w = byWeekday[isoWeekday(d) - 1];
      w.orders += 1;
      w.chargedCents += o.chargedCents;
      byHour[o.hour].orders += 1;
      byHour[o.hour].chargedCents += o.chargedCents;
    }
  }
  return { byWeekday, byHour };
}

function mixOf(from: string, to: string, withMethod: boolean): SalesMixDTO {
  const cell = () => ({ orders: 0, chargedCents: 0 });
  const mix: SalesMixDTO = {
    byDestination: { vault: cell(), direct_ship: cell() },
    byBuyer: { account: cell(), guest: cell() },
  };
  const methods = new Map<string | null, { method: string | null; orders: number; chargedCents: number }>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    for (const o of ordersOfDay(d)) {
      const dest = mix.byDestination[o.direct ? 'direct_ship' : 'vault'];
      dest.orders += 1;
      dest.chargedCents += o.chargedCents;
      const buyer = mix.byBuyer[o.guest ? 'guest' : 'account'];
      buyer.orders += 1;
      buyer.chargedCents += o.chargedCents;
      const m = methods.get(o.method) ?? { method: o.method, orders: 0, chargedCents: 0 };
      m.orders += 1;
      m.chargedCents += o.chargedCents;
      methods.set(o.method, m);
    }
  }
  if (withMethod) mix.byPaymentMethod = [...methods.values()].sort((a, b) => b.orders - a.orders);
  // AN-1.1 (§15.11.2): TODOS los pedidos (también `refunded`); en el mock cada renglón ya es su parte exacta.
  const piece = () => ({ pieces: 0, netCents: 0 });
  const byType = { raw: piece(), graded: piece(), sealed: piece() };
  for (let d = from; d <= to; d = addDays(d, 1)) {
    for (const o of ordersOfDay(d)) {
      for (const it of o.items) {
        byType[it.productType].pieces += 1;
        byType[it.productType].netCents += it.unitNetCents;
      }
    }
  }
  mix.byProductType = byType;
  return mix;
}

// ---------------------------------------------------------------- fase y permisos

type Phase = 'A' | 'B' | 'C';
export function mockSalesPhase(): Phase {
  if (typeof window === 'undefined') return 'C';
  const v = window.localStorage.getItem('tcg.salesPhase');
  return v === 'A' || v === 'B' ? v : 'C';
}

/** Una clave de una fase que el servidor aún no construye NO viaja (ausente, ⛔ no `0`; §15.4 AN-1.1). */
function stripP2(f: Required<SalesFiguresDTO>, phase: Phase): SalesFiguresDTO {
  if (phase === 'C') return f;
  const { shipping, buylist: _b, profitCents: _p, chargebacks: _c, ...rest } = f;
  if (phase === 'A') return rest;
  return { ...rest, shipping, buylist: f.buylist, profitCents: f.profitCents };
}

function requireSuperAdmin(): void {
  if (mockCallerRole() !== 'super_admin') {
    throw new ApiFixtureError(403, 'FORBIDDEN', 'Only super_admin may read sales analytics');
  }
}

function invalid(details: Record<string, unknown>): never {
  throw new ApiFixtureError(400, 'VALIDATION_ERROR', 'Invalid sales report parameters', details);
}

/** Vacío o solo espacios = ausente (§15.2). */
function present(v: string | undefined): string | undefined {
  return v === undefined || v.trim() === '' ? undefined : v;
}

interface Resolved {
  preset: SalesPreset;
  from: string;
  to: string;
  groupBy: SalesGroupBy;
  topSort: SalesTopSort;
}

function resolve(params: SalesReportParams, today: string): Resolved {
  const preset = present(params.preset);
  const groupBy = present(params.groupBy);
  const topSort = present(params.topSort);
  if (preset !== undefined && !PRESETS.includes(preset as SalesPreset)) invalid({ field: 'preset', allowed: PRESETS });
  if (groupBy !== undefined && !GROUP_BYS.includes(groupBy as SalesGroupBy)) invalid({ field: 'groupBy', allowed: GROUP_BYS });
  if (topSort !== undefined && !TOP_SORTS.includes(topSort as SalesTopSort)) invalid({ field: 'topSort', allowed: TOP_SORTS });
  const rawFrom = present(params.from);
  const rawTo = present(params.to);
  const g = (groupBy ?? 'day') as SalesGroupBy;
  const s = (topSort ?? 'net') as SalesTopSort;
  if (rawFrom !== undefined || rawTo !== undefined) {
    if (rawFrom !== undefined && !isYmd(rawFrom)) invalid({ field: 'from' });
    if (rawTo !== undefined && !isYmd(rawTo)) invalid({ field: 'to' });
    if (rawFrom === undefined) invalid({ field: 'from' });
    if (rawTo === undefined) invalid({ field: 'to' });
    if (preset !== undefined && preset !== 'custom') invalid({ field: 'preset', allowed: PRESETS });
    const from = rawFrom as string;
    const to = rawTo as string;
    if (from > to) invalid({ field: 'from' });
    if (to > today) invalid({ field: 'to' });
    if (daysBetween(from, to) > MAX_DAYS) invalid({ field: 'from' });
    return { preset: 'custom', from, to, groupBy: g, topSort: s };
  }
  const p = (preset ?? 'last7') as SalesPreset;
  const first = `${today.slice(0, 7)}-01`;
  switch (p) {
    case 'today':
      return { preset: p, from: today, to: today, groupBy: g, topSort: s };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { preset: p, from: y, to: y, groupBy: g, topSort: s };
    }
    case 'last30':
      return { preset: p, from: addDays(today, -29), to: today, groupBy: g, topSort: s };
    case 'this_month':
      return { preset: p, from: first, to: today, groupBy: g, topSort: s };
    case 'last_month': {
      const end = addDays(first, -1);
      return { preset: p, from: `${end.slice(0, 7)}-01`, to: end, groupBy: g, topSort: s };
    }
    case 'custom':
      // `custom` sin fechas: no hay periodo que resolver.
      return invalid({ field: 'from' });
    default:
      return { preset: 'last7', from: addDays(today, -6), to: today, groupBy: g, topSort: s };
  }
}

// ---------------------------------------------------------------- endpoints

/** `GET /admin/reports/sales` (§15.4). */
export function mockSalesReport(params: SalesReportParams, now: Date = new Date()): SalesReportDTO {
  requireSuperAdmin();
  const today = mockTodayMx(now);
  const r = resolve(params, today);
  const phase = mockSalesPhase();
  const days = daysBetween(r.from, r.to);
  const prevTo = addDays(r.from, -1);
  const prevFrom = addDays(r.from, -days);
  const totals = figuresOf(r.from, r.to);
  const prev = figuresOf(prevFrom, prevTo);
  const rows: SalesRowDTO[] = buckets(r.from, r.to, r.groupBy).map((b) => ({ from: b.from, to: b.to, ...stripP2(figuresOf(b.from, b.to), phase) }));
  const report: SalesReportDTO = {
    period: { preset: r.preset, from: r.from, to: r.to, days, timezone: 'America/Mexico_City' },
    previousPeriod: { from: prevFrom, to: prevTo },
    groupBy: r.groupBy,
    totals: stripP2(totals, phase),
    previousTotals: stripP2(prev, phase),
    comparison: {
      orders: delta(totals.orders, prev.orders),
      chargedCents: delta(totals.chargedCents, prev.chargedCents),
      netSalesCents: delta(totals.netSalesCents, prev.netSalesCents),
      refundsAmountCents: delta(totals.refunds.amountCents, prev.refunds.amountCents),
      netSalesAfterRefundsCents: delta(totals.netSalesAfterRefundsCents, prev.netSalesAfterRefundsCents),
      avgTicketCents: delta(totals.avgTicketCents, prev.avgTicketCents),
      piecesPerOrder: delta(totals.piecesPerOrder, prev.piecesPerOrder),
    },
    rows,
    top: topLists(r.from, r.to, r.topSort),
    customers: customersOf(r.from, r.to),
  };
  if (phase !== 'A') {
    report.bestDays = bestDaysOf(r.from, r.to);
    report.mix = mixOf(r.from, r.to, phase === 'C');
  }
  if (phase === 'C') report.chargebacksUndatedCount = 2;
  return report;
}

/** `GET /admin/reports/sales/today` (§15.5): hoy vs el mismo día de la semana pasada COMPLETO. */
export function mockSalesToday(now: Date = new Date()): SalesTodayDTO {
  requireSuperAdmin();
  const today = mockTodayMx(now);
  const ref = addDays(today, -7);
  const a = figuresOf(today, today);
  const b = figuresOf(ref, ref);
  return {
    today: { day: today, orders: a.orders, chargedCents: a.chargedCents },
    sameWeekdayLastWeek: { day: ref, orders: b.orders, chargedCents: b.chargedCents },
    comparison: { orders: delta(a.orders, b.orders), chargedCents: delta(a.chargedCents, b.chargedCents) },
  };
}

/** `centsToPesosCell` (§15.7, AN-1.1): aritmética ENTERA, punto decimal, sin miles ni `$`. */
export function mockCentsToPesosCell(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

const CSV_A = ['from', 'to', 'orders', 'chargedMxn', 'netSalesMxn', 'refundsCount', 'refundsAmountMxn', 'refundsNetMxn', 'netSalesAfterRefundsMxn', 'pieces', 'avgTicketMxn', 'piecesPerOrder'];
const CSV_B = ['shippingChargedNetMxn', 'shippingCostNetMxn', 'shippingResultNetMxn', 'shippingCostMissingCount', 'buylistPaidCount', 'buylistPaidNetMxn', 'profitMxn'];
const CSV_C = ['chargebacksCount', 'chargebacksAmountMxn'];

/** `GET /admin/reports/sales/export.csv` (§15.7 AN-1.1): dinero en PESOS con 2 decimales, `null` = celda vacía, ⛔ sin datos de clientes. */
export function mockSalesCsv(params: SalesReportParams, now: Date = new Date()): { text: string; filename: string } {
  const rep = mockSalesReport({ ...params, topSort: undefined }, now);
  const phase = mockSalesPhase();
  const mxn = (v: number | null | undefined) => (v === null || v === undefined ? '' : mockCentsToPesosCell(v));
  const n = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));
  const line = (from: string, to: string, f: SalesFiguresDTO) => {
    const cells: string[] = [
      from, to, n(f.orders), mxn(f.chargedCents), mxn(f.netSalesCents), n(f.refunds.count), mxn(f.refunds.amountCents),
      mxn(f.refunds.netCents), mxn(f.netSalesAfterRefundsCents), n(f.pieces), mxn(f.avgTicketCents),
      f.piecesPerOrder === null ? '' : f.piecesPerOrder.toFixed(1),
    ];
    if (phase !== 'A') {
      cells.push(
        mxn(f.shipping?.chargedNetCents), mxn(f.shipping?.costNetCents), mxn(f.shipping?.resultNetCents), n(f.shipping?.costMissingCount),
        n(f.buylist?.paidCount), mxn(f.buylist?.paidNetCents), mxn(f.profitCents),
      );
    }
    if (phase === 'C') cells.push(n(f.chargebacks?.count), mxn(f.chargebacks?.amountCents));
    return cells.join(',');
  };
  const header = [...CSV_A, ...(phase !== 'A' ? CSV_B : []), ...(phase === 'C' ? CSV_C : [])];
  const lines = [header.join(','), ...rep.rows.map((r) => line(r.from, r.to, r)), line('total', '', rep.totals)];
  return {
    text: `${lines.join('\n')}\n`,
    filename: `ventas_${rep.period.from}_${rep.period.to}_${rep.groupBy}.csv`,
  };
}

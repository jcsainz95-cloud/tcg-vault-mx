/**
 * demand-gaps.service.ts — §DEMANDA F1+F2 (API_CONTRACT_DEMANDA §1-§2). «Demanda sin stock»: cartas que los clientes guardan o
 * buscan y NO tenemos, más los términos sin carta identificada (cuarentena). Lectura en vivo, `super_admin`.
 *
 * ⛔ Sin datos personales: la respuesta se construye con una LISTA BLANCA de claves (`toRow`); jamás userId, correo, IP ni hash.
 * ⛔ Módulo no financiero: no escribe nada (solo lee wishlist, búsquedas, catálogo y precios por sus seams).
 * El umbral de búsquedas es la MISMA función pura de c6 (`qualifyingCounts`).
 */
import { Injectable, Logger } from '@nestjs/common';
import { Finish, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { CatalogService } from '../catalog/catalog.service';
import { WishlistDemandService, WishlistDemandRowDTO } from '../wishlist/wishlist-demand.service';
import { MarketingSearchMissService, qualifyingCounts } from '../marketing/marketing-search-miss.service';
import { parseEnumFilter } from '../../common/enum-filter';
import { BusinessException } from '../../common/business.exception';
import { toMexicoCityDateKey } from '../../common/business-days';
import { addDays } from '../sales-analytics/sales-period';
import {
  DEMAND_CSV_MAX_ROWS,
  DEMAND_DIRS,
  DEMAND_LIMIT_DEFAULT,
  DEMAND_LIMIT_MAX,
  DEMAND_LIMIT_VALUES,
  DEMAND_MATCH_LAST_OK_KEY,
  DEMAND_SORTS,
  DemandDials,
  DemandSort,
  readDemandDials,
} from './demand.constants';

export interface DemandSignalDTO {
  kind: 'wishlist' | 'search';
  count: number;
  unit: 'clientes' | 'personas';
  windowDays: number | null;
  days?: number;
}
export interface DemandRowDTO {
  key: string;
  kind: 'card' | 'term';
  cardId: string | null;
  term: string | null;
  cardName: string;
  setName: string | null;
  finish: Finish | null;
  imageSmallUrl: string | null;
  signals: DemandSignalDTO[];
  score: number;
  marketCents: number | null;
  buylistTodayCents: number | null;
}
export interface DemandGapsResponse {
  generatedAt: string;
  windowDays: number;
  totalRows: number;
  sources: { wishlist: 'ok' | 'error'; search: 'ok' | 'off' | 'error'; matchedAt: string | null };
  rows: DemandRowDTO[];
}
export interface DemandQuery {
  sort: DemandSort;
  dir: 'asc' | 'desc';
  limit: number;
}

interface Acc {
  key: string;
  kind: 'card' | 'term';
  cardId: string | null;
  term: string | null;
  wishlist: number;
  finish: Finish | null;
  marketCents: number | null;
  buylistTodayCents: number | null;
  searchPeople: number;
  searchDays: number;
}

const dayDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

@Injectable()
export class DemandGapsService {
  private readonly logger = new Logger(DemandGapsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly catalog: CatalogService,
    private readonly wishlist: WishlistDemandService,
    private readonly searchMiss: MarketingSearchMissService,
  ) {}

  /** `sort`/`dir` por la puerta de enums (400) y `limit` entero 1..200 en forma canónica (sin ceros a la izquierda: `005`/`0200` ⇒ 400); cualquier otro valor ⇒ 400. */
  parseQuery(q: { sort?: unknown; dir?: unknown; limit?: unknown }, maxLimit = DEMAND_LIMIT_MAX): DemandQuery {
    const sort = parseEnumFilter('sort', q.sort, DEMAND_SORTS) ?? 'score';
    const dir = parseEnumFilter('dir', q.dir, DEMAND_DIRS) ?? 'desc';
    let limit = DEMAND_LIMIT_DEFAULT;
    // Clase ORDEN (§0-Q punto 6): vacío o solo espacios ≡ ausente ⇒ el default; ` 5` (espacio con token) es entrada mal formada ⇒ 400.
    if (q.limit !== undefined && q.limit !== null && !(typeof q.limit === 'string' && q.limit.trim() === '')) {
      const n = typeof q.limit === 'string' && /^[1-9]\d{0,5}$/.test(q.limit) ? Number(q.limit) : NaN;
      if (!Number.isInteger(n) || n < 1 || n > maxLimit) {
        throw BusinessException.badRequest('VALIDATION_ERROR', 'invalid limit', { field: 'limit', allowed: DEMAND_LIMIT_VALUES.slice(0, maxLimit) });
      }
      limit = n;
    }
    return { sort, dir, limit };
  }

  async report(q: { sort?: unknown; dir?: unknown; limit?: unknown }, now: Date): Promise<DemandGapsResponse> {
    return this.build(this.parseQuery(q), now);
  }

  /** CSV: mismos `sort`/`dir`; TODAS las filas (tope 1000). El CSV IGNORA `limit` (ni siquiera lo lee: el controller no lo declara). */
  async csv(q: { sort?: unknown; dir?: unknown }, now: Date): Promise<{ filename: string; body: string }> {
    const parsed = this.parseQuery(q);
    const r = await this.build({ ...parsed, limit: DEMAND_CSV_MAX_ROWS }, now);
    const pesos = (c: number | null) => (c == null ? '' : (c / 100).toFixed(2));
    const lines = [
      'tipo,card_id,termino,carta,set,acabado,clientes_wishlist,personas_busqueda,dias_busqueda,score,mercado,buylist_hoy',
      ...r.rows.map((row) => {
        const wl = row.signals.find((s) => s.kind === 'wishlist');
        const se = row.signals.find((s) => s.kind === 'search');
        return [
          row.kind === 'card' ? 'carta' : 'termino',
          csvText(row.cardId ?? ''),
          csvText(row.term ?? ''),
          csvText(row.cardName),
          csvText(row.setName ?? ''),
          csvText(row.finish ?? ''),
          wl ? String(wl.count) : '0',
          se ? String(se.count) : '0',
          se?.days != null ? String(se.days) : '0',
          String(row.score),
          pesos(row.marketCents),
          pesos(row.buylistTodayCents),
        ].join(',');
      }),
    ];
    return { filename: `demanda-sin-stock-${toMexicoCityDateKey(new Date(r.generatedAt))}.csv`, body: `${lines.join('\n')}\n` };
  }

  private async build(q: DemandQuery, now: Date): Promise<DemandGapsResponse> {
    const dials = await readDemandDials(this.settings);
    const sources: DemandGapsResponse['sources'] = { wishlist: 'ok', search: 'ok', matchedAt: null };
    const acc = new Map<string, Acc>();
    const slot = (key: string, kind: 'card' | 'term', cardId: string | null, term: string | null): Acc => {
      let a = acc.get(key);
      if (!a) {
        a = { key, kind, cardId, term, wishlist: 0, finish: null, marketCents: null, buylistTodayCents: null, searchPeople: 0, searchDays: 0 };
        acc.set(key, a);
      }
      return a;
    };

    try {
      await this.readWishlist(slot);
    } catch (e) {
      sources.wishlist = 'error';
      this.logger.warn(`demand-gaps: fuente wishlist falló (${e instanceof Error ? e.constructor.name : 'error'})`);
    }
    try {
      if (!(await this.searchMiss.isEnabled())) sources.search = 'off';
      else await this.readSearch(slot, dials, now);
    } catch (e) {
      sources.search = 'error';
      this.logger.warn(`demand-gaps: fuente búsquedas falló (${e instanceof Error ? e.constructor.name : 'error'})`);
    }
    // 500 solo si fallan ambas (el filtro global lo vuelve INTERNAL).
    if (sources.wishlist === 'error' && sources.search === 'error') throw new Error('demand-gaps: ambas fuentes fallaron');

    sources.matchedAt = await this.matchedAt();
    const rows = await this.finish([...acc.values()], dials);
    sortRows(rows, q.sort, q.dir);
    return {
      generatedAt: now.toISOString(),
      windowDays: dials.searchWindowDays,
      totalRows: rows.length,
      sources,
      rows: rows.slice(0, q.limit),
    };
  }

  /** Wishlist: filas (carta, acabado) SIN pieza vendible del reporte existente; clientes = cuentas DISTINTAS por carta (sin doble conteo entre acabados). */
  private async readWishlist(slot: (k: string, kind: 'card' | 'term', c: string | null, t: string | null) => Acc): Promise<void> {
    const report = await this.wishlist.report({}, new Date());
    if (report.rows.length === 0) return;
    const byCard = new Map<string, WishlistDemandRowDTO[]>();
    for (const r of report.rows) byCard.set(r.cardId, [...(byCard.get(r.cardId) ?? []), r]);
    const keys = report.rows.map((r) => `${r.cardId}|${r.finish}`);
    // Cuentas distintas por carta SOBRE las piezas sin pieza vendible; el userId no sale de esta consulta (solo el conteo).
    const counts = await this.prisma.$queryRaw<{ cardId: string; n: number }[]>(Prisma.sql`
      SELECT wi."cardId", count(DISTINCT wi."userId")::int AS n
      FROM "WishlistItem" wi JOIN "User" u ON u."id" = wi."userId"
      WHERE u."status"::text = 'active' AND (wi."cardId" || '|' || wi."finish"::text) = ANY(${keys}::text[])
      GROUP BY wi."cardId"`);
    for (const c of counts) {
      const rowsOfCard = byCard.get(c.cardId) ?? [];
      if (rowsOfCard.length === 0 || c.n < 1) continue;
      // El acabado con MÁS clientes (desempate estable por nombre de acabado); su mercado y buylist.
      const top = [...rowsOfCard].sort((a, b) => b.wantedCount - a.wantedCount || a.finish.localeCompare(b.finish))[0];
      const a = slot(c.cardId, 'card', c.cardId, null);
      a.wishlist = c.n;
      a.finish = top.finish;
      a.marketCents = top.marketCents;
      a.buylistTodayCents = top.buylistTodayCents;
    }
  }

  /** Búsquedas: `SearchDemandDaily` por carta + `SearchNoResultDaily` de términos ya asociados; el resto de términos que pasan umbral = filas «término». */
  private async readSearch(slot: (k: string, kind: 'card' | 'term', c: string | null, t: string | null) => Acc, dials: DemandDials, now: Date): Promise<void> {
    const today = toMexicoCityDateKey(now);
    const from = dayDate(addDays(today, -(dials.searchWindowDays - 1)));
    const to = dayDate(today);
    const inWindow = { day: { gte: from, lte: to } };
    const ymd = (d: Date) => d.toISOString().slice(0, 10);

    const cardRows = await this.prisma.searchDemandDaily.findMany({ where: inWindow, select: { cardId: true, day: true, people: true } });
    const termRows = await this.prisma.searchNoResultDaily.findMany({ where: inWindow, select: { termNormalized: true, day: true, people: true } });
    const matches = await this.prisma.demandTermMatch.findMany({ select: { termNormalized: true, cardId: true, status: true } });
    const matchedTo = new Map(matches.filter((m) => m.status === 'matched' && m.cardId).map((m) => [m.termNormalized, m.cardId as string]));

    // 1) Carta: personas por (carta, día) = su registro directo + las de términos asociados a ella.
    const perCard: { key: string; day: string; people: number }[] = cardRows.map((r) => ({ key: r.cardId, day: ymd(r.day), people: r.people }));
    for (const r of termRows) {
      const cardId = matchedTo.get(r.termNormalized);
      if (cardId) perCard.push({ key: cardId, day: ymd(r.day), people: r.people });
    }
    for (const q of qualifyingCounts(perCard)) {
      const a = slot(q.key, 'card', q.key, null);
      a.searchPeople = q.people;
      a.searchDays = q.days;
    }
    // 2) Término sin carta: el MISMO lector de c6 (PII + vocabulario al leer) y umbral; los ya asociados a una carta no repiten fila.
    const terms = await this.searchMiss.readQualifying(ymd(from), ymd(to));
    if (terms === null) throw new Error('demand-gaps: lectura de términos falló');
    for (const t of terms) {
      if (matchedTo.has(t.term)) continue;
      const a = slot(`term:${t.term}`, 'term', null, t.term);
      a.searchPeople = t.people;
      a.searchDays = t.days;
    }
  }

  private async matchedAt(): Promise<string | null> {
    try {
      const row = await this.prisma.configSetting.findUnique({ where: { key: DEMAND_MATCH_LAST_OK_KEY }, select: { valueJson: true } });
      const v = row?.valueJson;
      return typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null;
    } catch {
      return null;
    }
  }

  /** Quita las cartas con ≥ 1 pieza vendible hoy, completa nombre/set/imagen y arma la fila (LISTA BLANCA). */
  private async finish(list: Acc[], dials: DemandDials): Promise<DemandRowDTO[]> {
    const cardIds = list.filter((a) => a.kind === 'card' && a.cardId).map((a) => a.cardId as string);
    const stocked = await this.catalog.cardIdsWithSellable(cardIds);
    const kept = list.filter((a) => a.kind === 'term' || !stocked.has(a.cardId as string));
    const cards = await this.prisma.card.findMany({
      where: { id: { in: kept.filter((a) => a.kind === 'card').map((a) => a.cardId as string) } },
      select: { id: true, name: true, imageSmallUrl: true, set: { select: { name: true } } },
    });
    const cardById = new Map(cards.map((c) => [c.id, c]));
    const rows: DemandRowDTO[] = [];
    for (const a of kept) {
      const card = a.kind === 'card' ? cardById.get(a.cardId as string) : undefined;
      if (a.kind === 'card' && !card) continue; // carta borrada del catálogo: no hay qué mostrar
      rows.push(toRow(a, card, dials));
    }
    return rows;
  }
}

/** ⛔ Lista blanca: exactamente estas claves. */
function toRow(a: Acc, card: { id: string; name: string; imageSmallUrl: string | null; set: { name: string } } | undefined, dials: DemandDials): DemandRowDTO {
  const signals: DemandSignalDTO[] = [];
  if (a.wishlist > 0) signals.push({ kind: 'wishlist', count: a.wishlist, unit: 'clientes', windowDays: null });
  if (a.searchPeople > 0) signals.push({ kind: 'search', count: a.searchPeople, unit: 'personas', windowDays: dials.searchWindowDays, days: a.searchDays });
  const isCard = a.kind === 'card';
  return {
    key: a.key,
    kind: a.kind,
    cardId: isCard ? a.cardId : null,
    term: isCard ? null : a.term,
    cardName: isCard ? (card as { name: string }).name : (a.term as string),
    setName: isCard ? (card as { set: { name: string } }).set.name : null,
    finish: isCard ? a.finish : null,
    imageSmallUrl: isCard ? ((card as { imageSmallUrl: string | null }).imageSmallUrl ?? null) : null,
    signals,
    score: Math.round((dials.wWishlist * a.wishlist + dials.wSearch * a.searchPeople) * 100) / 100,
    marketCents: isCard ? a.marketCents : null,
    buylistTodayCents: isCard ? a.buylistTodayCents : null,
  };
}

/** Orden: `sort` (nulos al final) y, en empate, `marketCents` ↓ (null al final) y `key`. Determinista. */
export function sortRows(rows: DemandRowDTO[], sort: DemandSort, dir: 'asc' | 'desc'): void {
  const val: Record<DemandSort, (r: DemandRowDTO) => number | null> = {
    score: (r) => r.score,
    wishlist: (r) => r.signals.find((s) => s.kind === 'wishlist')?.count ?? 0,
    search: (r) => r.signals.find((s) => s.kind === 'search')?.count ?? 0,
    market: (r) => r.marketCents,
  };
  const sign = dir === 'asc' ? 1 : -1;
  const nullsLast = (a: number | null, b: number | null, s: number) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : s * (a - b));
  rows.sort(
    (a, b) =>
      nullsLast(val[sort](a), val[sort](b), sign) ||
      nullsLast(a.marketCents, b.marketCents, -1) ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
}

/** Celda de texto del CSV: entre comillas, comillas dobladas y SIN fórmulas (`= + - @ TAB CR` al inicio ⇒ prefijo `'`). */
export function csvText(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}

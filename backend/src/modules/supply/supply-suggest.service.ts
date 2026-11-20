import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Finish, Prisma, SupplySuggestion } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { parseEnumFilter } from '../../common/enum-filter';
import { runSerializable } from '../../common/serializable-retry';
import { MONEY_REF_WHERE } from '../pricing/pricing.service';
import { SupplyPricingService } from './supply-pricing.service';
import { DEFAULT_PCT_BPS, REQUEST_TTL_MS, SUPPLY_SETTINGS_ID, effectiveUnitCents } from './supply.constants';
import { pageOf } from './supply.dto';
import { CardWithSet, cardView } from './supply-views';
import {
  SUGGEST_MIN_MARKET_CENTS, SUPPLY_SUGGEST_LOCK_KEY, SUPPLY_SYSTEM_USER_ID, SuggestReason, SuggestReasonView, allocateBudget, multForRank, normalizeReasons, isBasicEnergy,
  isMarketJump, MAX_COPIES, needsFromDecks, normalizeSuggestMult, SUGGEST_CFG_KEYS, SuggestMult, netTarget, pickFinish, sortByPriority, suggestedUnitCents, weekStartMx, Need,
} from './supply-suggest.logic';

export interface SuggestRunResult {
  candidates: number;
  published: number;
  raised: number;
  drafts: number;
  skipped: number;
  budgetSkipped: number;
  autoPublish: boolean;
}

type Tx = Prisma.TransactionClient;
type Req = { id: string; cardId: string; finish: Finish; source: string; status: string; qtyWanted: number; qtyReserved: number; qtyReceived: number; pctBps: number | null; fixedCents: number | null; createdAt: Date };
/** Cantidad PENDIENTE de una solicitud abierta (lo reservado ya es un acuerdo y lo recibido ya llegó). */
const pendingOf = (r: { qtyWanted: number; qtyReserved: number; qtyReceived: number }) => Math.max(0, r.qtyWanted - r.qtyReserved - r.qtyReceived);
/** Acuerdos SIN PAGAR: ocupan necesidad aunque su solicitud ya esté cerrada o vencida (`verified` ya es stock y `paid` también; `cancelled` no cuenta). */
const UNPAID_PURCHASE = ['agreed', 'collected'] as const;
/** Señal interna: el mercado de una solicitud nacida tras la precarga; el publish sale de la tx, lo precarga y reintenta (nunca pide mercado con el candado). */
class MissingMarket extends Error { constructor(readonly keys: { cardId: string; finish: Finish }[]) { super('missing market'); } }

/**
 * §PROV-F4 — job `supply-suggest` (diario 05:00 CDMX + tras cada refresco de meta decks). Idempotente y sin estado: cada corrida recalcula todo
 * desde `MetaDeckCard`/`Card` (set o deck nuevo entra solo). Una solicitud publicada NO gasta dinero (solo invita ofertas); el dinero sale al
 * ACEPTAR (`autoAccept` apagado) y al pagar. Tope duro 100 % del mercado; sin mercado ⇒ `skipped/no_market` y se reintenta al día siguiente.
 */
@Injectable()
export class SupplySuggestService {
  private readonly logger = new Logger(SupplySuggestService.name);
  constructor(private readonly prisma: PrismaService, private readonly pricing: SupplyPricingService) {}

  // ---------------------------------------------------------------- lecturas

  private async settings(db: Tx | PrismaService = this.prisma) {
    const s = await db.supplySettings.findUnique({ where: { id: SUPPLY_SETTINGS_ID } });
    return {
      autoPublish: s?.autoPublish ?? false,
      defaultPctBps: Math.min(10000, s?.defaultPctBps ?? DEFAULT_PCT_BPS),
      openBudgetCents: s?.openBudgetCents ?? 0,
      lastRunAt: s?.lastSuggestRunAt ?? null,
    };
  }

  /**
   * Exposición ABIERTA a la vez (centavos; DECISIONES §PROV-F4.6): Σ precio unitario × cantidad PENDIENTE (pedido − reservado − recibido) de TODAS las
   * solicitudes `open` no vencidas, de cualquier `source` (las manuales cuentan). Los aumentos de `qtyWanted` ya van dentro al leer tras el cambio.
   */
  async openExposure(now: Date, db: Tx | PrismaService = this.prisma, pre?: Map<string, number | null>, strict = false): Promise<number> {
    const reqs = await db.supplyRequest.findMany({
      where: { status: 'open', expiresAt: { gt: now } },
      select: { id: true, cardId: true, finish: true, qtyWanted: true, qtyReserved: true, qtyReceived: true, pctBps: true, fixedCents: true },
    });
    const live = reqs.filter((r) => pendingOf(r) > 0);
    if (live.length === 0) return 0;
    // Mercado: lo precargado FUERA de la transacción (`prefetchMarkets`); solo lo que falte se lee aquí (raro: solicitud nacida entre la precarga y el candado).
    const needMarket = live.filter((r) => r.fixedCents == null && !pre?.has(`${r.cardId}|${r.finish}`));
    if (strict && needMarket.length) throw new MissingMarket(needMarket.map((r) => ({ cardId: r.cardId, finish: r.finish })));
    const fetched = needMarket.length ? await this.pricing.marketCentsBatch(needMarket.map((r) => ({ cardId: r.cardId, finish: r.finish }))) : new Map<string, number | null>();
    const markets = new Map<string, number | null>([...(pre ?? []), ...fetched]);
    const snaps = await db.supplySuggestion.findMany({ where: { requestId: { in: live.map((r) => r.id) } }, select: { requestId: true, unitCents: true } });
    let total = 0;
    for (const r of live) {
      const unit = effectiveUnitCents(r, markets.get(`${r.cardId}|${r.finish}`) ?? null) ?? snaps.find((x) => x.requestId === r.id)?.unitCents ?? 0;
      total += unit * pendingOf(r);
    }
    return total;
  }

  /**
   * Precarga el mercado de las solicitudes abiertas (+ `extra`) ANTES de abrir la transacción con candado: el pricing usa el pool, y una
   * transacción que espera el candado no debe pedir una segunda conexión (con el pool lleno, el que tiene el candado no podría avanzar).
   */
  private async prefetchMarkets(now: Date, extra: { cardId: string; finish: Finish }[] = []): Promise<Map<string, number | null>> {
    const open = await this.prisma.supplyRequest.findMany({ where: { status: 'open', expiresAt: { gt: now }, fixedCents: null }, select: { cardId: true, finish: true } });
    const uniq = new Map([...open, ...extra].map((i) => [`${i.cardId}|${i.finish}`, { cardId: i.cardId, finish: i.finish }]));
    return this.pricing.marketCentsBatch([...uniq.values()]);
  }

  async settingsReadout(now = new Date()) {
    const s = await this.settings();
    return { openExposureCents: await this.openExposure(now), lastRunAt: s.lastRunAt };
  }

  /** Cartas/acabados con salto de mercado > 30 % contra la captura anterior (cuarentena; se reevalúa solo cada día). */
  private async marketJumps(items: { cardId: string; finish: Finish }[], now: Date, db: Tx | PrismaService = this.prisma): Promise<Set<string>> {
    const out = new Set<string>();
    if (!items.length) return out;
    const hist = await db.priceReference.findMany({
      where: { cardId: { in: [...new Set(items.map((c) => c.cardId))] }, productType: 'raw', gradeKey: 'raw:NM', ...MONEY_REF_WHERE, isManualOverride: false, capturedDate: { gte: new Date(now.getTime() - 14 * 86400_000) } },
      select: { cardId: true, finish: true, priceMxnCents: true, capturedDate: true },
      orderBy: { capturedDate: 'desc' },
    });
    for (const c of items) {
      const rows = hist.filter((h) => h.cardId === c.cardId && h.finish === c.finish);
      const days = [...new Set(rows.map((r) => r.capturedDate.toISOString()))];
      if (days.length >= 2) {
        const latest = rows.find((r) => r.capturedDate.toISOString() === days[0])!.priceMxnCents;
        const prev = rows.find((r) => r.capturedDate.toISOString() === days[1])!.priceMxnCents;
        if (isMarketJump(prev, latest)) out.add(`${c.cardId}|${c.finish}`);
      }
    }
    return out;
  }

  /** Multiplicadores por puesto de `ConfigSetting` (ausente/inválido ⇒ defaults del código; §PROV-F4.2). */
  private async suggestMult(db: Tx | PrismaService): Promise<SuggestMult> {
    return normalizeSuggestMult(await db.configSetting.findMany({ where: { key: { in: [...SUGGEST_CFG_KEYS] } }, select: { key: true, valueJson: true } }));
  }

  // ---------------------------------------------------------------- el job

  async run(now: Date = new Date()): Promise<SuggestRunResult> {
    const weekStart = weekStartMx(now);

    // [1] Necesidades: metadecks vigentes (decks publicados y no pausados; solo líneas casadas). La fuente «rotación» no existe.
    const decks = await this.prisma.metaDeck.findMany({ where: { published: true, pausedByOperator: false, currentListId: { not: null } }, select: { slug: true, rank: true, currentListId: true } });
    const slugByList = new Map(decks.map((d) => [d.currentListId as string, d.slug]));
    const rankByList = new Map(decks.map((d) => [d.currentListId as string, d.rank]));
    const lines = slugByList.size
      ? await this.prisma.metaDeckCard.findMany({
          where: { listId: { in: [...slugByList.keys()] }, matchStatus: 'matched', matchedCardId: { not: null } },
          select: { listId: true, matchedCardId: true, quantity: true },
        })
      : [];
    const deckNeeds = needsFromDecks(lines.map((l) => ({ cardId: l.matchedCardId as string, quantity: l.quantity, deckSlug: slugByList.get(l.listId) as string, rank: rankByList.get(l.listId) ?? null })), await this.suggestMult(this.prisma));
    const needs = deckNeeds;

    // [2] Cartas (sin energías básicas) y mercado del día por acabado.
    const cards = needs.size
      ? await this.prisma.card.findMany({ where: { id: { in: [...needs.keys()] } }, select: { id: true, name: true, supertype: true, subtypes: true, availableFinishes: true } })
      : [];
    const eligible = cards.filter((c) => !isBasicEnergy(c));
    const markets = await this.pricing.marketCentsBatch(eligible.flatMap((c) => c.availableFinishes.map((f) => ({ cardId: c.id, finish: f }))));

    interface Cand { cardId: string; finish: Finish; need: number; priorityRank: number; reasons: SuggestReason[]; marketCents: number | null; quarantined: boolean }
    const cands: Cand[] = [];
    for (const c of eligible) {
      const n = needs.get(c.id) as Need;
      const pick = pickFinish(c.availableFinishes, (f) => markets.get(`${c.id}|${f}`) ?? null);
      if (pick.marketCents != null && pick.marketCents < SUGGEST_MIN_MARKET_CENTS) continue; // no vale la pena recogerla
      cands.push({ cardId: c.id, finish: pick.finish as Finish, need: n.need, priorityRank: n.priorityRank, reasons: n.reasons, marketCents: pick.marketCents, quarantined: false });
    }
    // Dato dudoso: salto de mercado > 30 % contra la captura anterior ⇒ cuarentena (no se publica; mañana se reevalúa).
    const jumps = await this.marketJumps(cands.filter((c) => c.marketCents != null).map((c) => ({ cardId: c.cardId, finish: c.finish })), now);
    for (const c of cands) if (jumps.has(`${c.cardId}|${c.finish}`)) c.quarantined = true;

    // [3] Escritura bajo candado + SERIALIZABLE con reintento.
    const pre = await this.prefetchMarkets(now);
    const out = await runSerializable(
      this.prisma,
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SUPPLY_SUGGEST_LOCK_KEY})`;
        // `autoPublish`, tope y exposición se leen AQUÍ, bajo el candado compartido con el publish manual (no antes).
        return this.apply(tx, cands, await this.settings(tx), now, weekStart, pre);
      },
      { label: 'supply-suggest', timeout: 120_000, maxWait: 30_000 },
    );
    this.logger.log(`supply-suggest: ${JSON.stringify(out)}`);
    return out;
  }

  private async apply(
    tx: Tx,
    cands: { cardId: string; finish: Finish; need: number; priorityRank: number; reasons: SuggestReason[]; marketCents: number | null; quarantined: boolean }[],
    st: { autoPublish: boolean; defaultPctBps: number; openBudgetCents: number },
    now: Date,
    weekStart: Date,
    pre: Map<string, number | null>,
  ): Promise<SuggestRunResult> {
    const cardIds = [...new Set(cands.map((c) => c.cardId))];
    const stockRows = cardIds.length
      ? await tx.inventoryItem.groupBy({ by: ['cardId'], where: { cardId: { in: cardIds }, productType: 'raw', ownerType: 'platform', status: { in: ['in_stock', 'listed'] } }, _count: { _all: true } })
      : [];
    const stock = new Map(stockRows.map((r) => [r.cardId, r._count._all]));
    const reqs: Req[] = cardIds.length
      ? await tx.supplyRequest.findMany({
          where: { cardId: { in: cardIds }, status: { in: ['open', 'filled'] }, expiresAt: { gt: now } },
          select: { id: true, cardId: true, finish: true, source: true, status: true, qtyWanted: true, qtyReserved: true, qtyReceived: true, pctBps: true, fixedCents: true, createdAt: true },
        })
      : [];
    // Acuerdos sin pagar de CUALQUIER solicitud (abierta, cerrada o vencida) por carta (DECISIONES §PROV-F4.2).
    const purRows = cardIds.length
      ? await tx.supplyPurchase.groupBy({ by: ['cardId'], where: { cardId: { in: cardIds }, status: { in: [...UNPAID_PURCHASE] } }, _sum: { qty: true } })
      : [];
    const unpaid = new Map(purRows.map((r) => [r.cardId, r._sum.qty ?? 0]));
    const liveRows = await tx.supplySuggestion.findMany({ where: { status: { in: ['draft', 'skipped'] } } });
    const rowOf = new Map<string, SupplySuggestion>(liveRows.map((r) => [`${r.cardId}|${r.finish}`, r]));
    const touched = new Set<string>();
    const res: SuggestRunResult = { candidates: cands.length, published: 0, raised: 0, drafts: 0, skipped: 0, budgetSkipped: 0, autoPublish: st.autoPublish };

    const upsertLive = async (key: string, c: { cardId: string; finish: Finish }, data: Omit<Prisma.SupplySuggestionUncheckedCreateInput, 'cardId' | 'finish'>) => {
      const row = rowOf.get(key);
      if (row) {
        const u = await tx.supplySuggestion.update({ where: { id: row.id }, data });
        rowOf.set(key, u);
        return u;
      }
      const cr = await tx.supplySuggestion.create({ data: { cardId: c.cardId, finish: c.finish, ...data } });
      rowOf.set(key, cr);
      return cr;
    };

    interface Pending { key: string; c: (typeof cands)[number]; qty: number; unit: number; own: Req | null; pctBps: number }
    const pending: Pending[] = [];

    for (const c of cands) {
      const key = `${c.cardId}|${c.finish}`;
      touched.add(key);
      const row = rowOf.get(key);
      // Descarte del operador esta semana: se respeta (la semana siguiente se reevalúa).
      if (row && row.status === 'skipped' && row.skipReason == null && row.updatedAt >= weekStart) continue;

      const cardReqs = reqs.filter((r) => r.cardId === c.cardId);
      const manualSame = cardReqs.some((r) => r.finish === c.finish && r.source !== 'suggested');
      const own = cardReqs.find((r) => r.finish === c.finish && r.source === 'suggested') ?? null;
      const incomingOther = cardReqs.filter((r) => r !== own).reduce((a, r) => a + pendingOf(r), 0) + (unpaid.get(c.cardId) ?? 0);
      const target = netTarget(c.need, stock.get(c.cardId) ?? 0, incomingOther);
      const ownRemaining = own ? pendingOf(own) : 0;
      const qty = own ? target - ownRemaining : target;
      const base = { reasons: c.reasons as unknown as Prisma.InputJsonValue, marketCents: c.marketCents };

      if (qty <= 0) {
        if (row) { await upsertLive(key, c, { ...base, suggestedQty: row.suggestedQty, unitCents: row.unitCents, status: 'skipped', skipReason: 'covered' }); res.skipped++; }
        continue;
      }
      if (manualSame) {
        // Ya hay una solicitud manual abierta de esa carta/acabado: no se crea otra ni se toca la manual (siempre ganan las manuales).
        await upsertLive(key, c, { ...base, suggestedQty: qty, unitCents: null, status: 'skipped', skipReason: 'covered' });
        res.skipped++;
        continue;
      }
      if (c.marketCents == null || c.quarantined) {
        await upsertLive(key, c, { ...base, suggestedQty: qty, unitCents: null, status: 'skipped', skipReason: c.marketCents != null && c.quarantined ? 'market_jump' : 'no_market' });
        res.skipped++;
        continue;
      }
      const unit = suggestedUnitCents(c.marketCents, st.defaultPctBps);
      if (unit == null) {
        await upsertLive(key, c, { ...base, suggestedQty: qty, unitCents: null, status: 'skipped', skipReason: 'no_market' });
        res.skipped++;
        continue;
      }
      if (!st.autoPublish) {
        await upsertLive(key, c, { ...base, suggestedQty: qty, unitCents: unit, status: 'draft', skipReason: null });
        res.drafts++;
        continue;
      }
      pending.push({ key, c, qty, unit, own, pctBps: st.defaultPctBps });
    }

    // Cupo ABIERTO a la vez: exposición viva ahora (manuales incluidas, bajo el candado); reparto por prioridad.
    if (pending.length) {
      const spent = await this.openExposure(now, tx, pre);
      const remaining = Math.max(0, st.openBudgetCents - spent);
      const ordered = sortByPriority(pending.map((p) => ({ key: p.key, qty: p.qty, unitCents: p.unit, rank: p.c.priorityRank })));
      const alloc = allocateBudget(ordered, remaining);
      const give = new Map(alloc.publish.map((p) => [p.key, p.qty]));
      for (const p of pending) {
        const qty = give.get(p.key);
        if (qty == null) {
          await upsertLive(p.key, p.c, { reasons: p.c.reasons as unknown as Prisma.InputJsonValue, marketCents: p.c.marketCents, suggestedQty: p.qty, unitCents: p.unit, status: 'draft', skipReason: 'budget' });
          res.budgetSkipped++;
          continue;
        }
        // Tope duro 100 %: el precio publicado jamás supera el mercado (por construcción y comprobado).
        if (p.c.marketCents == null || p.unit > p.c.marketCents) throw new Error('supply-suggest: precio sobre el mercado (tope 100 %)');
        let requestId: string;
        if (p.own) {
          const u = await tx.supplyRequest.updateMany({ where: { id: p.own.id, status: { in: ['open', 'filled'] } }, data: { qtyWanted: { increment: qty }, status: 'open' } });
          if (u.count !== 1) continue; // cambió bajo nuestros pies: mañana se reevalúa
          requestId = p.own.id;
          res.raised++;
        } else {
          const r = await tx.supplyRequest.create({
            data: { cardId: p.c.cardId, finish: p.c.finish, minCondition: 'NM', qtyWanted: qty, pctBps: p.pctBps, fixedCents: null, expiresAt: new Date(now.getTime() + REQUEST_TTL_MS), createdById: SUPPLY_SYSTEM_USER_ID, source: 'suggested' },
          });
          requestId = r.id;
          res.published++;
        }
        await upsertLive(p.key, p.c, { reasons: p.c.reasons as unknown as Prisma.InputJsonValue, marketCents: p.c.marketCents, suggestedQty: qty, unitCents: p.unit, status: 'published', skipReason: null, requestId });
        rowOf.delete(p.key); // ya no es una fila viva: la próxima necesidad crea otra
      }
    }

    // Filas vivas que ya no son candidatas (carta fuera de los decks, cubierta, etc.): quedan `skipped/covered`.
    for (const [key, row] of rowOf) {
      if (touched.has(key)) continue;
      if (row.status === 'skipped' && row.skipReason === 'covered') continue;
      if (row.status === 'skipped' && row.skipReason == null && row.updatedAt >= weekStart) continue;
      await tx.supplySuggestion.update({ where: { id: row.id }, data: { status: 'skipped', skipReason: 'covered' } });
    }
    await tx.supplySettings.updateMany({ where: { id: SUPPLY_SETTINGS_ID }, data: { lastSuggestRunAt: now } });
    return res;
  }

  // ---------------------------------------------------------------- endpoints

  async list(q: { status?: string; page?: string; pageSize?: string }) {
    const { page, pageSize, skip } = pageOf(q);
    const status = parseEnumFilter('status', q.status, ['draft', 'published', 'skipped'] as const);
    const where: Prisma.SupplySuggestionWhereInput = status ? { status } : {};
    const [rows, total, st] = await Promise.all([
      this.prisma.supplySuggestion.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip, take: pageSize, include: { card: { include: { set: true } } } }),
      this.prisma.supplySuggestion.count({ where }),
      this.settings(),
    ]);
    const reasonsOf = await this.readReasons(rows);
    return {
      data: rows.map((r) => ({
        id: r.id,
        card: cardView(r.card as CardWithSet, r.finish),
        finish: r.finish,
        suggestedQty: r.suggestedQty,
        pctBps: st.defaultPctBps,
        unitCents: r.unitCents,
        marketCents: r.marketCents,
        reasons: reasonsOf.get(r.id) ?? [],
        status: r.status,
        skipReason: r.skipReason as 'no_market' | 'budget' | 'covered' | 'market_jump' | null,
        requestId: r.requestId,
        createdAt: r.createdAt,
      })),
      page, pageSize, total,
    };
  }

  /**
   * Normaliza `reasons` al leer (sin migración): filas viejas sin rank/copies/mult se completan desde el deck VIGENTE (puesto, copias en su lista actual,
   * mult con los ConfigSetting de hoy); si el deck no existe, no está publicado, está pausado o su rank<1, los tres quedan `null` (nunca mezcla).
   */
  private async readReasons(rows: { id: string; cardId: string; reasons: unknown }[]): Promise<Map<string, SuggestReasonView[]>> {
    const out = new Map(rows.map((r) => [r.id, normalizeReasons(r.reasons)]));
    const slugs = new Set<string>();
    for (const rs of out.values()) for (const x of rs) if (x.ref && (x.rank == null || x.copies == null || x.mult == null)) slugs.add(x.ref);
    if (!slugs.size) return out;
    const decks = await this.prisma.metaDeck.findMany({ where: { slug: { in: [...slugs] }, published: true, pausedByOperator: false, rank: { gte: 1 }, currentListId: { not: null } }, select: { slug: true, rank: true, currentListId: true } });
    const cardIds = [...new Set(rows.map((r) => r.cardId))];
    const lines = await this.prisma.metaDeckCard.findMany({ where: { listId: { in: decks.map((d) => d.currentListId as string) }, matchStatus: 'matched', matchedCardId: { in: cardIds } }, select: { listId: true, matchedCardId: true, quantity: true } });
    const mult = await this.suggestMult(this.prisma);
    const deckBySlug = new Map(decks.map((d) => [d.slug, d]));
    const copiesOf = (listId: string, cardId: string) => {
      const q = lines.filter((l) => l.listId === listId && l.matchedCardId === cardId).reduce((a, l) => a + Math.max(0, l.quantity), 0);
      return q > 0 ? Math.min(MAX_COPIES, q) : null;
    };
    for (const r of rows) {
      out.set(r.id, (out.get(r.id) ?? []).map((x) => {
        if (x.rank != null && x.copies != null && x.mult != null) return x;
        const d = x.ref ? deckBySlug.get(x.ref) : undefined;
        // Sin deck vigente válido (existe, publicado, no pausado, rank≥1) los tres a null: nunca mezcla de datos guardados y vivos.
        if (!d || d.rank == null || d.rank < 1) return { ...x, rank: null, copies: null, mult: null };
        const rank = x.rank ?? d.rank;
        return { ...x, rank, copies: x.copies ?? copiesOf(d.currentListId as string, r.cardId), mult: x.mult ?? multForRank(rank, mult) };
      }));
    }
    return out;
  }

  /**
   * Atajo manual (DECISIONES §PROV-F4.6b): MISMAS reglas que el job. Idempotency-Key obligatoria (misma key + mismo cuerpo ⇒ la misma solicitud; otro
   * cuerpo ⇒ 422), dedupe por (carta, acabado), cuarentena, cupo abierto y tope 100 %; todo en UNA transacción con el candado del job.
   */
  async publish(id: string, dto: { qty?: number; pctBps?: number }, key: string, actorId: string, now = new Date()) {
    if (dto.pctBps != null && dto.pctBps > 10000) throw BusinessException.validation('ABOVE_MARKET_CAP', 'Percentage above 100% of market');
    const hash = createHash('sha256').update(JSON.stringify({ id, qty: dto.qty ?? null, pctBps: dto.pctBps ?? null })).digest('hex');
    // Lecturas de mercado FUERA de la transacción (ver `prefetchMarkets`).
    const pre0 = await this.prisma.supplySuggestion.findUnique({ where: { id }, select: { cardId: true, finish: true } });
    let extra: { cardId: string; finish: Finish }[] = pre0 ? [pre0] : [];
    for (let attempt = 0; ; attempt++) {
      const pre = await this.prefetchMarkets(now, extra);
      try {
        return await this.publishTx(id, dto, key, actorId, now, hash, pre);
      } catch (e) {
        if (e instanceof MissingMarket) {
          if (attempt < 4) { extra = [...extra, ...e.keys]; continue; }
          throw BusinessException.retriable('MARKET_UNAVAILABLE', 'Market prices are not ready; retry shortly');
        }
        throw e;
      }
    }
  }

  /** Necesidad VIVA de una carta bajo el candado: necesidad de metadecks − stock − lo que ya viene (solicitudes abiertas de otros acabados + acuerdos sin pagar). */
  private async liveNeed(tx: Tx, cardId: string, now: Date): Promise<{ net: number; reasons: SuggestReason[] }> {
    const decks = await tx.metaDeck.findMany({ where: { published: true, pausedByOperator: false, currentListId: { not: null } }, select: { slug: true, rank: true, currentListId: true } });
    const slugByList = new Map(decks.map((d) => [d.currentListId as string, d.slug]));
    const rankByList = new Map(decks.map((d) => [d.currentListId as string, d.rank]));
    const lines = slugByList.size
      ? await tx.metaDeckCard.findMany({ where: { listId: { in: [...slugByList.keys()] }, matchStatus: 'matched', matchedCardId: cardId }, select: { listId: true, matchedCardId: true, quantity: true } })
      : [];
    const nd = needsFromDecks(lines.map((l) => ({ cardId: l.matchedCardId as string, quantity: l.quantity, deckSlug: slugByList.get(l.listId) as string, rank: rankByList.get(l.listId) ?? null })), await this.suggestMult(tx)).get(cardId);
    const need = nd?.need ?? 0;
    const reasons = nd?.reasons ?? [];
    if (need <= 0) return { net: 0, reasons };
    const stock = await tx.inventoryItem.count({ where: { cardId, productType: 'raw', ownerType: 'platform', status: { in: ['in_stock', 'listed'] } } });
    const reqs = await tx.supplyRequest.findMany({ where: { cardId, status: { in: ['open', 'filled'] }, expiresAt: { gt: now } }, select: { qtyWanted: true, qtyReserved: true, qtyReceived: true } });
    const unpaid = (await tx.supplyPurchase.aggregate({ where: { cardId, status: { in: [...UNPAID_PURCHASE] } }, _sum: { qty: true } }))._sum.qty ?? 0;
    return { net: Math.max(0, netTarget(need, stock, reqs.reduce((a, r) => a + pendingOf(r), 0) + unpaid)), reasons };
  }

  private publishTx(id: string, dto: { qty?: number; pctBps?: number }, key: string, actorId: string, now: Date, hash: string, pre: Map<string, number | null>) {
    return runSerializable(this.prisma, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SUPPLY_SUGGEST_LOCK_KEY})`;
      const prior = await tx.supplySuggestion.findUnique({ where: { publishKey: key } });
      if (prior) {
        if (prior.publishHash === hash && prior.requestId) return prior.requestId; // repetición: la MISMA respuesta
        throw BusinessException.validation('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key already used with a different request');
      }
      const row = await tx.supplySuggestion.findUnique({ where: { id } });
      if (!row) throw BusinessException.notFound();
      if (row.status === 'published') throw BusinessException.conflict('ALREADY_PUBLISHED', 'Suggestion already published');
      const market = pre.get(`${row.cardId}|${row.finish}`) ?? null;
      if (market == null) throw BusinessException.conflict('QUARANTINED', 'No market price today', { skipReason: 'no_market' });
      if ((await this.marketJumps([{ cardId: row.cardId, finish: row.finish }], now, tx)).has(`${row.cardId}|${row.finish}`)) {
        throw BusinessException.conflict('QUARANTINED', 'Market moved more than 30% since yesterday', { skipReason: 'market_jump' });
      }
      const dup = await tx.supplyRequest.findFirst({ where: { cardId: row.cardId, finish: row.finish, status: 'open', expiresAt: { gt: now } }, select: { id: true } });
      if (dup) throw BusinessException.conflict('ALREADY_COVERED', 'There is already an open request for this card and finish', { requestId: dup.id });
      const { net: live, reasons: liveReasons } = await this.liveNeed(tx, row.cardId, now);
      if (live <= 0) throw BusinessException.conflict('ALREADY_COVERED', 'The need for this card is already covered', { skipReason: 'covered' });
      const st = await this.settings(tx);
      const pct = dto.pctBps ?? st.defaultPctBps;
      const unit = effectiveUnitCents({ pctBps: pct, fixedCents: null }, market);
      if (unit == null) throw BusinessException.validation('FIXED_PRICE_REQUIRED', 'Price resolves to zero: use a fixed unit price');
      this.pricing.assertWithinCap(unit, market);
      const maxQty = Math.min(row.suggestedQty, live);
      const qty = dto.qty ?? maxQty;
      if (qty > maxQty) throw BusinessException.badRequest('VALIDATION_ERROR', 'qty above the suggested quantity');
      const openCents = await this.openExposure(now, tx, pre, true);
      if (openCents + unit * qty > st.openBudgetCents) throw BusinessException.conflict('BUDGET_EXCEEDED', 'Open budget exceeded', { openCents, budgetCents: st.openBudgetCents });
      const cas = await tx.supplySuggestion.updateMany({ where: { id, status: { in: ['draft', 'skipped'] } }, data: { status: 'published', skipReason: null, suggestedQty: qty, unitCents: unit, marketCents: market, reasons: liveReasons as unknown as Prisma.InputJsonValue } });
      if (cas.count !== 1) throw BusinessException.conflict('ALREADY_PUBLISHED', 'Suggestion already published');
      const r = await tx.supplyRequest.create({
        data: { cardId: row.cardId, finish: row.finish, minCondition: 'NM', qtyWanted: qty, pctBps: pct, fixedCents: null, expiresAt: new Date(now.getTime() + REQUEST_TTL_MS), createdById: actorId, source: 'suggested' },
      });
      await tx.supplySuggestion.update({ where: { id }, data: { requestId: r.id, publishKey: key, publishHash: hash } });
      return r.id;
    }, { label: 'supply-suggest.publish', timeout: 60_000, maxWait: 30_000 });
  }

  async skip(id: string): Promise<void> {
    const row = await this.prisma.supplySuggestion.findUnique({ where: { id } });
    if (!row) throw BusinessException.notFound();
    if (row.status === 'published') throw BusinessException.conflict('ALREADY_PUBLISHED', 'Suggestion already published');
    await this.prisma.supplySuggestion.updateMany({ where: { id, status: { in: ['draft', 'skipped'] } }, data: { status: 'skipped', skipReason: null } });
  }
}

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
  SUGGEST_MIN_MARKET_CENTS, SUPPLY_SUGGEST_LOCK_KEY, SUPPLY_SYSTEM_USER_ID, SuggestReason, allocateBudget, isBasicEnergy,
  isMarketJump, mergeNeeds, needsFromDecks, netTarget, pickFinish, sortByPriority, suggestedUnitCents, weekStartMx, Need,
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

/** Fuente «rotación» (lista «qué comprar», HECHOS 2026-10-04): NO existe aún en el código (NO MEDIDO que haya ranking persistido) ⇒ aporta 0 filas. Se cablea aquí. */
async function rotationNeeds(): Promise<Map<string, Need>> {
  return new Map();
}

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

  private async settings() {
    const s = await this.prisma.supplySettings.findUnique({ where: { id: SUPPLY_SETTINGS_ID } });
    return {
      autoPublish: s?.autoPublish ?? false,
      defaultPctBps: Math.min(10000, s?.defaultPctBps ?? DEFAULT_PCT_BPS),
      weeklyBudgetCents: s?.weeklyBudgetCents ?? 0,
      lastRunAt: s?.lastSuggestRunAt ?? null,
    };
  }

  /** Exposición potencial de la semana (centavos): Σ precio × (pedido − recibido) de las sugeridas vivas + lo ya recibido de las cerradas. */
  async weekExposure(now: Date, db: Tx | PrismaService = this.prisma): Promise<number> {
    const start = weekStartMx(now);
    const reqs = await db.supplyRequest.findMany({
      where: { source: 'suggested', createdAt: { gte: start } },
      select: { id: true, cardId: true, finish: true, status: true, qtyWanted: true, qtyReceived: true, pctBps: true, fixedCents: true },
    });
    if (reqs.length === 0) return 0;
    const markets = await this.pricing.marketCentsBatch(reqs.map((r) => ({ cardId: r.cardId, finish: r.finish })));
    const snaps = await db.supplySuggestion.findMany({ where: { requestId: { in: reqs.map((r) => r.id) } }, select: { requestId: true, unitCents: true } });
    let total = 0;
    for (const r of reqs) {
      const unit = effectiveUnitCents(r, markets.get(`${r.cardId}|${r.finish}`) ?? null) ?? snaps.find((s) => s.requestId === r.id)?.unitCents ?? 0;
      const live = r.status === 'open' || r.status === 'filled';
      total += unit * (live ? Math.max(0, r.qtyWanted - r.qtyReceived) : r.qtyReceived);
    }
    return total;
  }

  async settingsReadout(now = new Date()) {
    const s = await this.settings();
    return { weekSpentCents: await this.weekExposure(now), weekStartsAt: weekStartMx(now), lastRunAt: s.lastRunAt };
  }

  // ---------------------------------------------------------------- el job

  async run(now: Date = new Date()): Promise<SuggestRunResult> {
    const st = await this.settings();
    const weekStart = weekStartMx(now);

    // [1] Necesidades: metadecks vigentes (decks publicados y no pausados; solo líneas casadas) ∪ rotación.
    const decks = await this.prisma.metaDeck.findMany({ where: { published: true, pausedByOperator: false, currentListId: { not: null } }, select: { slug: true, currentListId: true } });
    const slugByList = new Map(decks.map((d) => [d.currentListId as string, d.slug]));
    const lines = slugByList.size
      ? await this.prisma.metaDeckCard.findMany({
          where: { listId: { in: [...slugByList.keys()] }, matchStatus: 'matched', matchedCardId: { not: null } },
          select: { listId: true, matchedCardId: true, quantity: true },
        })
      : [];
    const deckNeeds = needsFromDecks(lines.map((l) => ({ cardId: l.matchedCardId as string, quantity: l.quantity, deckSlug: slugByList.get(l.listId) as string })));
    const needs = mergeNeeds(deckNeeds, await rotationNeeds());

    // [2] Cartas (sin energías básicas) y mercado del día por acabado.
    const cards = needs.size
      ? await this.prisma.card.findMany({ where: { id: { in: [...needs.keys()] } }, select: { id: true, name: true, supertype: true, subtypes: true, availableFinishes: true } })
      : [];
    const eligible = cards.filter((c) => !isBasicEnergy(c));
    const markets = await this.pricing.marketCentsBatch(eligible.flatMap((c) => c.availableFinishes.map((f) => ({ cardId: c.id, finish: f }))));

    interface Cand { cardId: string; finish: Finish; need: number; reasons: SuggestReason[]; marketCents: number | null; quarantined: boolean }
    const cands: Cand[] = [];
    for (const c of eligible) {
      const n = needs.get(c.id) as Need;
      const pick = pickFinish(c.availableFinishes, (f) => markets.get(`${c.id}|${f}`) ?? null);
      if (pick.marketCents != null && pick.marketCents < SUGGEST_MIN_MARKET_CENTS) continue; // no vale la pena recogerla
      cands.push({ cardId: c.id, finish: pick.finish as Finish, need: n.need, reasons: n.reasons, marketCents: pick.marketCents, quarantined: false });
    }
    // Dato dudoso: salto de mercado > 30 % contra la captura anterior ⇒ cuarentena (no se publica; mañana se reevalúa).
    const priced = cands.filter((c) => c.marketCents != null);
    if (priced.length) {
      const hist = await this.prisma.priceReference.findMany({
        where: { cardId: { in: priced.map((c) => c.cardId) }, productType: 'raw', gradeKey: 'raw:NM', ...MONEY_REF_WHERE, isManualOverride: false, capturedDate: { gte: new Date(now.getTime() - 14 * 86400_000) } },
        select: { cardId: true, finish: true, priceMxnCents: true, capturedDate: true },
        orderBy: { capturedDate: 'desc' },
      });
      for (const c of priced) {
        const rows = hist.filter((h) => h.cardId === c.cardId && h.finish === c.finish);
        const days = [...new Set(rows.map((r) => r.capturedDate.toISOString()))];
        if (days.length >= 2) {
          const latest = rows.find((r) => r.capturedDate.toISOString() === days[0])!.priceMxnCents;
          const prev = rows.find((r) => r.capturedDate.toISOString() === days[1])!.priceMxnCents;
          if (isMarketJump(prev, latest)) c.quarantined = true;
        }
      }
    }

    // [3] Escritura bajo candado + SERIALIZABLE con reintento.
    const out = await runSerializable(
      this.prisma,
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SUPPLY_SUGGEST_LOCK_KEY})`;
        return this.apply(tx, cands, st, now, weekStart);
      },
      { label: 'supply-suggest', timeout: 120_000, maxWait: 30_000 },
    );
    this.logger.log(`supply-suggest: ${JSON.stringify(out)}`);
    return out;
  }

  private async apply(
    tx: Tx,
    cands: { cardId: string; finish: Finish; need: number; reasons: SuggestReason[]; marketCents: number | null; quarantined: boolean }[],
    st: { autoPublish: boolean; defaultPctBps: number; weeklyBudgetCents: number },
    now: Date,
    weekStart: Date,
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
      const incomingOther = cardReqs.filter((r) => r !== own).reduce((a, r) => a + Math.max(0, r.qtyWanted - r.qtyReceived), 0);
      const target = netTarget(c.need, stock.get(c.cardId) ?? 0, incomingOther);
      const ownRemaining = own ? Math.max(0, own.qtyWanted - own.qtyReceived) : 0;
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
        await upsertLive(key, c, { ...base, suggestedQty: qty, unitCents: null, status: 'skipped', skipReason: 'no_market' });
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

    // Presupuesto semanal: exposición ya comprometida esta semana; reparto por prioridad.
    if (pending.length) {
      const spent = await this.weekExposure(now, tx);
      const remaining = Math.max(0, st.weeklyBudgetCents - spent);
      const ordered = sortByPriority(pending.map((p) => ({ key: p.key, qty: p.qty, unitCents: p.unit, signals: new Set(p.c.reasons.map((r) => r.kind)).size })));
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
    return {
      data: rows.map((r) => ({
        id: r.id,
        card: cardView(r.card as CardWithSet, r.finish),
        finish: r.finish,
        suggestedQty: r.suggestedQty,
        pctBps: st.defaultPctBps,
        unitCents: r.unitCents,
        marketCents: r.marketCents,
        reasons: r.reasons as unknown as SuggestReason[],
        status: r.status,
        skipReason: r.skipReason as 'no_market' | 'budget' | 'covered' | null,
        requestId: r.requestId,
        createdAt: r.createdAt,
      })),
      page, pageSize, total,
    };
  }

  /** Atajo manual: publica la sugerida YA (sin presupuesto: es decisión del dueño); mismo tope 100 % y mismos errores que crear. */
  async publish(id: string, dto: { qty?: number; pctBps?: number }, actorId: string, now = new Date()) {
    if (dto.pctBps != null && dto.pctBps > 10000) throw BusinessException.validation('ABOVE_MARKET_CAP', 'Percentage above 100% of market');
    const requestId = await runSerializable(this.prisma, async (tx) => {
      const row = await tx.supplySuggestion.findUnique({ where: { id } });
      if (!row) throw BusinessException.notFound();
      if (row.status === 'published') throw BusinessException.conflict('ALREADY_PUBLISHED', 'Suggestion already published');
      const market = (await this.pricing.marketCentsBatch([{ cardId: row.cardId, finish: row.finish }])).get(`${row.cardId}|${row.finish}`) ?? null;
      if (market == null) throw BusinessException.validation('FIXED_PRICE_REQUIRED', 'No market price: a fixed unit price is required');
      const pct = dto.pctBps ?? (await this.settings()).defaultPctBps;
      const unit = effectiveUnitCents({ pctBps: pct, fixedCents: null }, market);
      if (unit == null) throw BusinessException.validation('FIXED_PRICE_REQUIRED', 'Price resolves to zero: use a fixed unit price');
      this.pricing.assertWithinCap(unit, market);
      const qty = dto.qty ?? row.suggestedQty;
      const cas = await tx.supplySuggestion.updateMany({ where: { id, status: { in: ['draft', 'skipped'] } }, data: { status: 'published', skipReason: null, suggestedQty: qty, unitCents: unit, marketCents: market } });
      if (cas.count !== 1) throw BusinessException.conflict('ALREADY_PUBLISHED', 'Suggestion already published');
      const r = await tx.supplyRequest.create({
        data: { cardId: row.cardId, finish: row.finish, minCondition: 'NM', qtyWanted: qty, pctBps: pct, fixedCents: null, expiresAt: new Date(now.getTime() + REQUEST_TTL_MS), createdById: actorId, source: 'suggested' },
      });
      await tx.supplySuggestion.update({ where: { id }, data: { requestId: r.id } });
      return r.id;
    }, { label: 'supply-suggest.publish' });
    return requestId;
  }

  async skip(id: string): Promise<void> {
    const row = await this.prisma.supplySuggestion.findUnique({ where: { id } });
    if (!row) throw BusinessException.notFound();
    if (row.status === 'published') throw BusinessException.conflict('ALREADY_PUBLISHED', 'Suggestion already published');
    await this.prisma.supplySuggestion.updateMany({ where: { id, status: { in: ['draft', 'skipped'] } }, data: { status: 'skipped', skipReason: null } });
  }
}

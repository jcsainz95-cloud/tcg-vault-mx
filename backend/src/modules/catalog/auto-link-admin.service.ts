import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BusinessException } from '../../common/business.exception';
import { ListingPriceService } from '../pricing/listing-price.service';
import { withPriceWriteShared } from '../pricing/price-write-lock';
import { safeErrorTag } from '../shipments/guest-mail-link';
import { LINK_REPAIR_GATE_NAMESPACE, LINK_REPAIR_MANUAL_COOLDOWN_MS } from './card-link-repair.service';

export const UNLINK_QUARANTINE_DAYS = 30;
export const UNLINK_LOOKBACK_DAYS = 7;
export const UNLINK_MAX_CARDS = 600;
const RUNS_MAX = 200;
const UNLINK_CLAIM = 'catalog.auto_unlink_claim';
export const UNLINK_ACTION = 'catalog.auto_unlink';

export interface AutoLinkRunView {
  runId: string;
  at: string;
  setsTried: number;
  linked: number;
  priced: number;
  held: number;
  /** Código del motivo (`lock_taken`, `call_cap`…) o `null` si no abortó (contrato §10.8). */
  aborted: string | null;
  sets: {
    setId: string;
    name: string;
    groupId: number | null;
    via: 'auto' | 'b3' | 'promo_table' | 'confirmed' | null;
    linked: number;
    priced: number;
    held: number;
    finishesAdded: number;
    sample: { cardName: string; number: string; finish: string; newPriceCents: number; previousPriceCents: number | null }[];
  }[];
}

type Json = Record<string, unknown>;
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * §AUTO-ENLACE §9.6 (iii)-(iv) — ver lo que hizo una corrida del job (solo lectura sobre `AuditLog`) y revertir UN set.
 */
@Injectable()
export class AutoLinkAdminService {
  private readonly logger = new Logger(AutoLinkAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly listingPrice?: ListingPriceService,
  ) {}

  /** `GET /admin/catalog/auto-link-runs?days=7`. */
  async runs(daysRaw?: number): Promise<{ runs: AutoLinkRunView[] }> {
    const days = daysRaw == null ? 7 : Math.trunc(daysRaw);
    if (!Number.isFinite(days) || days < 1 || days > 60) throw BusinessException.validation('VALIDATION_ERROR', 'days must be an integer between 1 and 60');
    const since = new Date(Date.now() - days * 86_400_000);
    const runRows = await this.prisma.auditLog.findMany({ where: { action: 'catalog.auto_link_run', createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: RUNS_MAX, select: { id: true, createdAt: true, after: true } });
    const setRows = await this.prisma.auditLog.findMany({ where: { action: 'catalog.auto_link', createdAt: { gte: since } }, orderBy: { createdAt: 'asc' }, take: 20_000, select: { entityId: true, after: true } });
    const names = new Map((await this.prisma.cardSet.findMany({ where: { id: { in: [...new Set(setRows.map((r) => r.entityId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));
    const byRun = new Map<string, AutoLinkRunView['sets']>();
    for (const r of setRows) {
      const a = (r.after ?? {}) as Json;
      const runId = typeof a.runId === 'string' ? a.runId : null;
      if (!runId || !r.entityId) continue;
      const via = a.via === 'auto' || a.via === 'promo_table' || a.via === 'confirmed' || a.via === 'b3' ? a.via : null;
      const list = byRun.get(runId) ?? [];
      list.push({
        setId: r.entityId, name: names.get(r.entityId) ?? '', groupId: typeof a.groupId === 'number' ? a.groupId : null, via,
        linked: num(a.linked), priced: num(a.priced), held: num(a.held), finishesAdded: num(a.finishesAdded),
        sample: Array.isArray(a.sample) ? (a.sample as AutoLinkRunView['sets'][number]['sample']).slice(0, 5) : [],
      });
      byRun.set(runId, list);
    }
    return {
      runs: runRows.map((r) => {
        const a = (r.after ?? {}) as Json;
        const runId = typeof a.runId === 'string' ? a.runId : r.id; // corridas anteriores a la versión con `runId`: sin detalle por set
        return {
          runId, at: r.createdAt.toISOString(), setsTried: num(a.setsTried), linked: num(a.linked), priced: num(a.priced), held: num(a.held),
          aborted: typeof a.aborted === 'string' ? a.aborted : null,
          sets: byRun.get(runId) ?? [],
        };
      }),
    };
  }

  /**
   * `POST /admin/catalog/link-exceptions/:setId/unlink` — borra SOLO lo que el job creó en ese set (CardProduct y PriceReference `tcgcsv_singles` de las cartas
   * de `linkedCardIds` de la bitácora ≤ 7 días), nunca overrides manuales ni enlaces confirmados ni productos con piezas; recalcula `ListingPrice` de esas
   * claves (PRICE_PENDING), limpia `cardGroupVia` si era `auto` y deja el set en cuarentena 30 días (`reverted`).
   */
  async unlink(setId: string, user: { id: string; role: Role }): Promise<{ setId: string; unlinked: number; pricesRemoved: number; skipped: { reason: string; count: number }[]; quarantineUntil: string }> {
    const set = await this.prisma.cardSet.findUnique({ where: { id: setId }, select: { id: true, cardGroupVia: true } });
    if (!set) throw BusinessException.notFound();
    const since = new Date(Date.now() - UNLINK_LOOKBACK_DAYS * 86_400_000);
    const rows = await this.prisma.auditLog.findMany({ where: { action: 'catalog.auto_link', entityId: setId, createdAt: { gte: since } }, select: { after: true } });
    const jobRows = rows.map((r) => (r.after ?? {}) as Json).filter((a) => typeof a.runId === 'string');
    if (jobRows.length === 0) throw BusinessException.conflict('NOTHING_TO_UNLINK', 'The automatic job has not run on this set in the last 7 days', { setId });

    // Solo lo del job con grupo automático: una fila `confirmed` (decisión del dueño) jamás se revierte aquí.
    const fromJob = new Set<string>();
    for (const a of jobRows) {
      if (a.via === 'confirmed') continue;
      for (const id of Array.isArray(a.linkedCardIds) ? (a.linkedCardIds as unknown[]) : []) if (typeof id === 'string') fromJob.add(id);
    }
    const confirmedByHand = new Set(
      (await this.prisma.auditLog.findMany({ where: { action: 'catalog.card_link_confirmed', entityId: { in: [...fromJob] } }, select: { entityId: true } })).map((r) => r.entityId as string),
    );
    // Solo cartas que SIGUEN ligadas (un segundo «Revertir» sobre lo ya revertido no es nada que hacer).
    const stillLinked = new Set(
      (await this.prisma.cardProduct.findMany({ where: { cardId: { in: [...fromJob].filter((id) => !confirmedByHand.has(id)) }, card: { setId } }, select: { cardId: true } })).map((r) => r.cardId),
    );
    const cardIds = [...fromJob].filter((id) => !confirmedByHand.has(id) && stillLinked.has(id)).slice(0, UNLINK_MAX_CARDS);
    // §10.3: nada que revertir (el job no ligó nada en este set, o todo es del dueño) ⇒ 409 sin cuarentena, sin reclamo y sin auditoría de reversa.
    if (cardIds.length === 0) throw BusinessException.conflict('NOTHING_TO_UNLINK', 'The automatic job linked nothing in this set that can be reverted', { setId, confirmedByOwner: confirmedByHand.size });

    // 1 por set cada 10 min (reclamo bajo candado consultivo; el 429 no escribe nada más).
    const now = Date.now();
    const wait = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LINK_REPAIR_GATE_NAMESPACE}::int, hashtext(${'unlink:' + setId}))`;
      const prev = await tx.auditLog.findFirst({ where: { action: UNLINK_CLAIM, entityId: setId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
      if (prev && now - prev.createdAt.getTime() < LINK_REPAIR_MANUAL_COOLDOWN_MS) return LINK_REPAIR_MANUAL_COOLDOWN_MS - (now - prev.createdAt.getTime());
      await tx.auditLog.create({ data: { actorUserId: user.id, action: UNLINK_CLAIM, entityType: 'CardSet', entityId: setId, after: { setId } } });
      return 0;
    });
    if (wait > 0) throw new BusinessException('RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS, 'This set was reverted a moment ago', { retryAfterSeconds: Math.max(1, Math.ceil(wait / 1000)) });

    const skipped = new Map<string, number>();
    const skip = (reason: string, n = 1): void => void skipped.set(reason, (skipped.get(reason) ?? 0) + n);
    if (confirmedByHand.size > 0) skip('confirmed_by_owner', confirmedByHand.size);

    let unlinked = 0;
    let pricesRemoved = 0;
    const result = await withPriceWriteShared(this.prisma, async (tx) => {
      const products = await tx.cardProduct.findMany({
        where: { cardId: { in: cardIds }, card: { setId } },
        select: { id: true, cardId: true, _count: { select: { inventoryItems: true } } },
      });
      const free = products.filter((p) => (p._count.inventoryItems === 0 ? true : (skip('product_with_pieces'), false)));
      const ids = free.map((p) => p.id);
      // Filas de precio del job (solo `tcgcsv_singles` no manuales). Si el producto tiene otras (manual/otra fuente), no se borra (FK) y se cuenta.
      // MONEY-REF-EXEMPT: solo cuenta filas ajenas al job (manual/otra fuente) que impiden borrar el producto; no devuelve ningún monto que se cobre, ofrezca o valúe.
      const others = await tx.priceReference.findMany({ where: { cardProductId: { in: ids }, OR: [{ isManualOverride: true }, { source: { not: 'tcgcsv_singles' } }] }, select: { cardProductId: true } });
      const blocked = new Set(others.map((o) => o.cardProductId as string));
      const del = free.filter((p) => (blocked.has(p.id) ? (skip('manual_or_other_source'), false) : true));
      const delIds = del.map((p) => p.id);
      pricesRemoved = (await tx.priceReference.deleteMany({ where: { cardProductId: { in: delIds }, source: 'tcgcsv_singles', isManualOverride: false } })).count;
      unlinked = (await tx.cardProduct.deleteMany({ where: { id: { in: delIds } } })).count;
      if (set.cardGroupVia === 'auto') await tx.cardSet.updateMany({ where: { id: setId, cardGroupVia: 'auto' }, data: { cardGroupId: null, cardGroupVia: null } });
      const quarantineUntil = new Date(Date.now() + UNLINK_QUARANTINE_DAYS * 86_400_000).toISOString();
      await this.audit.log(
        { actorUserId: user.id, actorRole: user.role, action: UNLINK_ACTION, entityType: 'CardSet', entityId: setId, before: null, after: { setId, unlinked, pricesRemoved, skipped: [...skipped].map(([reason, count]) => ({ reason, count })), reason: 'reverted', noProgress: false, nextAttemptAt: quarantineUntil } },
        tx,
      );
      return { quarantineUntil, cardIds: del.map((p) => p.cardId) };
    });

    // Las piezas de esas cartas quedan PRICE_PENDING: se recalcula su `ListingPrice` (ventas y reservas no se anulan).
    if (this.listingPrice && result.cardIds.length > 0) {
      try {
        const items = await this.prisma.inventoryItem.findMany({ where: { cardId: { in: result.cardIds }, productType: 'raw' }, select: { id: true } });
        if (items.length > 0) await this.listingPrice.run('manual_price', items.map((i) => i.id));
      } catch (e) {
        this.logger.warn(`auto-unlink: recálculo de ListingPrice pendiente (${safeErrorTag(e)}); lo recoge el barrido.`);
      }
    }
    return { setId, unlinked, pricesRemoved, skipped: [...skipped].map(([reason, count]) => ({ reason, count })), quarantineUntil: result.quarantineUntil };
  }
}

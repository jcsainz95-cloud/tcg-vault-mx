import { Injectable } from '@nestjs/common';
import { Finish, InventoryStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BusinessException } from '../../common/business.exception';
import { SettingsService } from '../settings/settings.service';
import { ListingPriceService } from '../pricing/listing-price.service';
import type { SaleItem } from '../pricing/sale-decision.service';
import { SEALED_SALE_PRICE_INCLUDE } from '../../common/money';

/** Acabado destino por acabado actual (WotC: «Unlimited» → 1.ª edición). Solo estas dos transiciones existen. */
const TARGET_OF: Partial<Record<Finish, Finish>> = { normal: 'first_edition', holofoil: 'first_edition_holofoil' };
const ACTION = 'catalog.finish_review';

export type BlockedReason = null | 'has_sale' | 'reserved' | 'in_custody' | 'customer_owned' | 'no_target_price';
export interface FinishReviewItem {
  inventoryItemId: string;
  folio: string;
  cardId: string;
  cardName: string;
  setName: string;
  number: string;
  status: InventoryStatus;
  currentFinish: 'normal' | 'holofoil';
  targetFinish: 'first_edition' | 'first_edition_holofoil';
  currentPriceCents: number | null;
  targetPriceCents: number | null;
  blockedReason: BlockedReason;
}
export interface FinishReviewDecision {
  inventoryItemId: string;
  decision: 'keep' | 'first_edition';
  before: { finish: Finish; unitPriceCents: number | null; listPriceCents: number | null };
  after: { finish: Finish; unitPriceCents: number | null; listPriceCents: number | null };
  alreadyResolved: boolean;
}

/**
 * §AUTO-ENLACE fase 4 (Q1 = A; contrato §8b) — piezas antiguas que podrían ser 1.ª edición. NADA se cambia en silencio: el dueño decide por pieza
 * (`keep` = «es Unlimited» / `first_edition`). Sin columna nueva: la decisión vive en bitácora (`catalog.finish_review`, una fila por pieza).
 */
@Injectable()
export class FinishReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly listingPrice: ListingPriceService,
    private readonly settings: SettingsService,
  ) {}

  /** Predicado de «entra en la lista» (raw, normal|holofoil, la carta ofrece el destino, viva, sin decisión previa). */
  private static readonly PENDING_WHERE = Prisma.sql`
    i."productType" = 'raw' AND i."finish" IN ('normal', 'holofoil') AND i."status" NOT IN ('lost', 'damaged', 'withdrawn')
    AND ((i."finish" = 'normal' AND 'first_edition'::"Finish" = ANY (c."availableFinishes"))
      OR (i."finish" = 'holofoil' AND 'first_edition_holofoil'::"Finish" = ANY (c."availableFinishes")))
    AND NOT EXISTS (SELECT 1 FROM "AuditLog" a WHERE a."action" = 'catalog.finish_review' AND a."entityId" = i."id")`;

  async pendingCount(): Promise<number> {
    const [r] = await this.prisma.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS n FROM "InventoryItem" i JOIN "Card" c ON c."id" = i."cardId" WHERE ${FinishReviewService.PENDING_WHERE}`);
    return r?.n ?? 0;
  }

  /** `GET /admin/catalog/finish-review`. Orden: `listed` primero, luego `folio`. Cursor = `<rango>|<folio>` (paginación por llave, no por desplazamiento). */
  async list(cursor: string | undefined, limitRaw: number | undefined): Promise<{ pending: number; items: FinishReviewItem[]; nextCursor: string | null }> {
    const limit = Math.min(200, Math.max(1, Math.trunc(limitRaw ?? 50)));
    let after: { rank: number; folio: string } | null = null;
    if (cursor) {
      const m = /^([01])\|(.+)$/.exec(cursor);
      if (!m) throw BusinessException.validation('VALIDATION_ERROR', 'Invalid cursor');
      after = { rank: Number(m[1]), folio: m[2] };
    }
    const pending = await this.pendingCount();
    const rows = await this.prisma.$queryRaw<{ id: string; rank: number; folio: string }[]>(Prisma.sql`
      SELECT i."id", (CASE WHEN i."status" = 'listed' THEN 0 ELSE 1 END) AS "rank", i."folio"
      FROM "InventoryItem" i JOIN "Card" c ON c."id" = i."cardId"
      WHERE ${FinishReviewService.PENDING_WHERE}
        ${after ? Prisma.sql`AND ((CASE WHEN i."status" = 'listed' THEN 0 ELSE 1 END), i."folio") > (${after.rank}::int, ${after.folio})` : Prisma.empty}
      ORDER BY "rank", i."folio" LIMIT ${limit + 1}`);
    const page = rows.slice(0, limit);
    const items = await this.hydrate(page.map((r) => r.id));
    const order = new Map(page.map((r, i) => [r.id, i]));
    items.sort((a, b) => order.get(a.inventoryItemId)! - order.get(b.inventoryItemId)!);
    const last = page[page.length - 1];
    return { pending, items, nextCursor: rows.length > limit && last ? `${last.rank}|${last.folio}` : null };
  }

  private blockedOf(i: { ownerType: string; status: InventoryStatus; reservedByOrderId: string | null; _count: { orderItems: number } }): BlockedReason {
    if (i.ownerType !== 'platform') return 'customer_owned';
    if (i._count.orderItems > 0 || ['shipped', 'delivered'].includes(i.status)) return 'has_sale';
    if (i.reservedByOrderId != null || ['reserved', 'picking'].includes(i.status)) return 'reserved';
    if (i.status === 'in_custody') return 'in_custody';
    return null;
  }

  private async hydrate(ids: string[]): Promise<FinishReviewItem[]> {
    if (ids.length === 0) return [];
    const rows = (await this.prisma.inventoryItem.findMany({
      where: { id: { in: ids } },
      include: { card: { include: { set: true } }, listingPrice: true, _count: { select: { orderItems: true } }, ...SEALED_SALE_PRICE_INCLUDE },
    })) as (SaleItem & { listingPrice: { unitPriceCents: number | null } | null; _count: { orderItems: number } })[];
    // Precio con el acabado destino: el cálculo en vivo del cuerpo único sobre una copia hipotética de la pieza (sin escribir nada).
    const hypo = rows.map((r) => ({ ...r, finish: TARGET_OF[r.finish]! }) as SaleItem);
    const dials = await this.settings.getIvaDials();
    const sales = await this.listingPrice.previewLive(hypo, dials);
    return rows.map((r) => {
      const s = sales.get(r.id);
      const target = s?.kind === 'priced' ? s.decision.unitPriceCents : null;
      const blocked = this.blockedOf(r) ?? (target == null ? 'no_target_price' : null);
      return {
        inventoryItemId: r.id, folio: r.folio, cardId: r.cardId, setName: r.card.set?.name ?? '',
        cardName: r.card.name,
        number: r.card.number,
        status: r.status,
        currentFinish: r.finish as FinishReviewItem['currentFinish'],
        targetFinish: TARGET_OF[r.finish] as FinishReviewItem['targetFinish'],
        currentPriceCents: r.listingPrice?.unitPriceCents ?? null, targetPriceCents: target, blockedReason: blocked,
      };
    });
  }

  /** `POST /admin/catalog/finish-review/:inventoryItemId`. */
  async decide(
    inventoryItemId: string,
    input: { decision: unknown; expectedFinish: unknown },
    user: { id: string; role: Role },
  ): Promise<FinishReviewDecision> {
    const { decision, expectedFinish } = input;
    if (decision !== 'keep' && decision !== 'first_edition') throw BusinessException.validation('VALIDATION_ERROR', 'decision must be keep|first_edition');
    if (expectedFinish !== 'normal' && expectedFinish !== 'holofoil') throw BusinessException.validation('VALIDATION_ERROR', 'expectedFinish must be normal|holofoil');

    // Precio destino ANTES de la transacción (es lectura y puede ser lenta); se vuelve a exigir dentro con la pieza bloqueada.
    let targetPrice: number | null = null;
    if (decision === 'first_edition') {
      const full = (await this.prisma.inventoryItem.findUnique({ where: { id: inventoryItemId }, include: { card: { include: { set: true } }, ...SEALED_SALE_PRICE_INCLUDE } })) as SaleItem | null;
      if (full && TARGET_OF[full.finish]) {
        const s = (await this.listingPrice.previewLive([{ ...full, finish: TARGET_OF[full.finish]! } as SaleItem], await this.settings.getIvaDials())).get(full.id);
        targetPrice = s?.kind === 'priced' ? s.decision.unitPriceCents : null;
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; finish: Finish; status: InventoryStatus; ownerType: string; reservedByOrderId: string | null; productType: string; cardId: string }[]>`
        SELECT "id", "finish", "status", "ownerType", "reservedByOrderId", "productType", "cardId" FROM "InventoryItem" WHERE "id" = ${inventoryItemId} FOR UPDATE`;
      const item = rows[0];
      if (!item) throw BusinessException.notFound();
      const prev = await tx.auditLog.findFirst({ where: { action: ACTION, entityId: inventoryItemId }, orderBy: { createdAt: 'desc' }, select: { after: true } });
      if (prev) {
        const was = (prev.after as { decision?: string; before?: DecisionSide; after?: DecisionSide } | null) ?? {};
        if (was.decision === decision) {
          return { inventoryItemId, decision, before: was.before ?? this.side(item.finish), after: was.after ?? this.side(item.finish), alreadyResolved: true } as FinishReviewDecision;
        }
        throw BusinessException.conflict('ALREADY_RESOLVED', 'This piece already has a different decision', { inventoryItemId, decision: was.decision });
      }
      if (item.productType !== 'raw' || !TARGET_OF[item.finish]) throw BusinessException.notFound();
      if (item.finish !== expectedFinish) throw BusinessException.conflict('STALE', 'The finish of this piece changed', { inventoryItemId, finish: item.finish });
      const sales = await tx.orderItem.count({ where: { inventoryItemId } });
      const blocked: BlockedReason =
        item.ownerType !== 'platform' ? 'customer_owned'
        : sales > 0 ? 'has_sale'
        : item.reservedByOrderId != null ? 'reserved'
        : !['in_stock', 'listed'].includes(item.status) ? (item.status === 'in_custody' ? 'in_custody' : ['shipped', 'delivered'].includes(item.status) ? 'has_sale' : 'reserved')
        : null;
      if (blocked) throw BusinessException.conflict('ITEM_LOCKED', 'This piece cannot be changed now', { inventoryItemId, blockedReason: blocked });

      const lp = await tx.listingPrice.findUnique({ where: { inventoryItemId }, select: { unitPriceCents: true, listPriceCents: true } });
      const before: DecisionSide = { finish: item.finish, unitPriceCents: lp?.unitPriceCents ?? null, listPriceCents: lp?.listPriceCents ?? null };
      let after: DecisionSide = before;
      if (decision === 'first_edition') {
        if (targetPrice == null) throw BusinessException.conflict('NO_TARGET_PRICE', 'There is no price for the 1st Edition finish', { inventoryItemId });
        const to = TARGET_OF[item.finish]!;
        // Condicionada: solo si la pieza sigue libre, de la plataforma y con el acabado leído (una venta concurrente no se pisa; ya está bajo FOR UPDATE).
        const w = await tx.inventoryItem.updateMany({
          where: { id: inventoryItemId, ownerType: 'platform', finish: item.finish, status: { in: ['in_stock', 'listed'] }, reservedByOrderId: null, orderItems: { none: {} } },
          data: { finish: to },
        });
        if (w.count !== 1) throw BusinessException.conflict('ITEM_LOCKED', 'This piece cannot be changed now', { inventoryItemId, blockedReason: 'reserved' });
        // La fila de precio vieja (llave `…|<acabado anterior>`) YA no es «vigente» para la pieza (`isCurrentRow` compara la llave): el lector precia en vivo con el acabado nuevo
        // y encola `missing_row`. ⛔ No se escribe `ListingPrice` aquí (G-11: solo `listing-price.service.ts` bajo `LISTING_PRICE_LOCK_KEY`).
        after = { finish: to, unitPriceCents: targetPrice, listPriceCents: null };
      }
      await this.audit.log({ actorUserId: user.id, actorRole: user.role, action: ACTION, entityType: 'InventoryItem', entityId: inventoryItemId, before, after: { decision, before, after } }, tx);
      return { inventoryItemId, decision, before, after, alreadyResolved: false } as FinishReviewDecision;
    });

    if (decision === 'first_edition' && !result.alreadyResolved) {
      // Recalcula la fila con la ruta de valuación existente (fuera de la transacción: tiene su propia cola y candados). Si falla, el lector sigue pricing en vivo.
      try {
        await this.listingPrice.run('manual_price', [inventoryItemId]);
        const row = await this.prisma.listingPrice.findUnique({ where: { inventoryItemId }, select: { unitPriceCents: true, listPriceCents: true } });
        if (row) result.after = { ...result.after, unitPriceCents: row.unitPriceCents, listPriceCents: row.listPriceCents };
      } catch {
        // el precio en vivo ya es el del acabado nuevo; la fila la recoge el recálculo diario
      }
    }
    return result;
  }

  private side(finish: Finish): DecisionSide {
    return { finish, unitPriceCents: null, listPriceCents: null };
  }
}

interface DecisionSide {
  finish: Finish;
  unitPriceCents: number | null;
  listPriceCents: number | null;
}

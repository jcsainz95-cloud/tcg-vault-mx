import { Injectable, Logger, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { Finish, InventoryStatus, MovementReason } from '@prisma/client';
import { ListingPriceService } from '../pricing/listing-price.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { isSchedulerDisabled } from '../../config/test-env';
import { CardProductResolverService } from './card-product-resolver.service';
import { isTcgcsvOrigin } from './tcgcsv-card-name';

/** Forma EXACTA de `GET /admin/catalog/sync-status` → `unlinkedPrice` (aditivo, §PRECIO-SIN-ENLACE). */
export interface UnlinkedPriceSet {
  setId: string;
  name: string;
  /** Cartas del set con 0 `CardProduct` (sin enlace ⇒ sin precio de mercado). */
  unlinked: number;
  total: number;
  /** Productos no enlazados por número/nombre repetido, según la ÚLTIMA corrida de `card-link-repair`; `null` = aún sin medir. */
  collisions: number | null;
  /** Productos no enlazados por otro motivo (sin carta local, ya enlazada), última corrida; `null` = aún sin medir. */
  omittedProducts: number | null;
}
export interface UnlinkedPrice {
  /** Cartas sin enlace en TODOS los sets con `unlinked > 0` (no solo los 100 listados). */
  totalCards: number;
  /** Solo sets con `unlinked > 0`, orden descendente por `unlinked`, máx. 100. */
  sets: UnlinkedPriceSet[];
}

export const LINK_REPAIR_MAX_SETS = 20;
const MAX_LISTED_SETS = 100;
const ACTION = 'catalog.link_repair';
const DEPLOY_MARKER = 'catalog.link_repair_deploy';

export interface LinkRepairRun {
  sets: { setId: string; name: string; linked: number; collisions: number; omitted: number; error?: string }[];
  linked: number;
  errors: number;
  /**
   * Decisión del dueño (opción A, 2026-11-25): piezas raw dadas de alta con un acabado que la carta recién enlazada ya no
   * tiene. `corrected` = pasaron al único acabado de la carta (auditadas, costo intacto); `excluded` = tienen venta, reserva,
   * pedido, envío, disputa o cualquier movimiento de dinero (solo se reportan); `ambiguous` = la carta tiene varios acabados
   * (no hay uno solo al que moverla; solo se reportan).
   */
  inventory: { corrected: number; excluded: number; ambiguous: number };
}

/** Piezas en estos estados son las únicas corregibles; el resto (reservada, en picking, enviada…) solo se reporta. */
const CORRECTABLE_STATUS: InventoryStatus[] = ['in_stock', 'listed'];
/** Movimientos que implican dinero ya movido con esa pieza. */
const MONEY_MOVEMENTS: MovementReason[] = ['sale', 'settle', 'chargeback_return', 'replacement', 'withdrawal'];

/**
 * §PRECIO-SIN-ENLACE (fase 1) — `card-link-repair`: enlaza (reglas de `card-link-plan.ts`) las cartas con 0
 * `CardProduct` de los sets con `unlinked > 0` (tope 20 sets por corrida). Idempotente: solo actúa sobre cartas
 * sin enlace (modo `onlyUnlinked` del resolver), así que la 2.ª corrida escribe 0 filas. Una vez al desplegar
 * (marcador de auditoría); el atajo manual es el `POST /admin/catalog/sync {setId, force:true}` existente.
 */
@Injectable()
export class CardLinkRepairService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CardLinkRepairService.name);
  private running: Promise<LinkRepairRun> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: CardProductResolverService,
    private readonly audit: AuditService,
    // Recalcula el precio de venta automático de las piezas corregidas (misma ruta que un cambio manual de precio).
    @Optional() private readonly listingPrice?: ListingPriceService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (isSchedulerDisabled()) return;
    try {
      const done = await this.prisma.auditLog.findFirst({ where: { action: DEPLOY_MARKER }, select: { id: true } });
      if (done) return;
      void this.run('deploy').catch((e) => this.logger.error(`card-link-repair: corrida de despliegue falló (${(e as Error).message}).`));
    } catch (e) {
      this.logger.error(`card-link-repair: no se pudo comprobar el marcador de despliegue (${(e as Error).message}).`);
    }
  }

  /** Cartas sin `CardProduct` por set (consulta LOCAL; no llama a proveedores). */
  async unlinkedPrice(): Promise<UnlinkedPrice> {
    const unlinkedBy = await this.prisma.card.groupBy({
      by: ['setId'],
      where: { cardProducts: { none: {} } },
      _count: { _all: true },
    });
    const sorted = [...unlinkedBy].sort((a, b) => b._count._all - a._count._all);
    const totalCards = sorted.reduce((n, g) => n + g._count._all, 0);
    const top = sorted.slice(0, MAX_LISTED_SETS);
    if (top.length === 0) return { totalCards: 0, sets: [] };
    const ids = top.map((g) => g.setId);
    const [sets, totals, audits] = await Promise.all([
      this.prisma.cardSet.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
      this.prisma.card.groupBy({ by: ['setId'], where: { setId: { in: ids } }, _count: { _all: true } }),
      this.prisma.auditLog.findMany({
        where: { action: ACTION, entityId: { in: ids } },
        orderBy: { createdAt: 'desc' },
        select: { entityId: true, after: true },
        take: 1000,
      }),
    ]);
    const name = new Map(sets.map((s) => [s.id, s.name]));
    const total = new Map(totals.map((t) => [t.setId, t._count._all]));
    const last = new Map<string, { collisions: number | null; omitted: number | null }>();
    for (const a of audits) {
      if (!a.entityId || last.has(a.entityId)) continue;
      const after = (a.after ?? {}) as { collisions?: unknown; omitted?: unknown };
      last.set(a.entityId, {
        collisions: typeof after.collisions === 'number' ? after.collisions : null,
        omitted: typeof after.omitted === 'number' ? after.omitted : null,
      });
    }
    return {
      totalCards,
      sets: top.map((g) => ({
        setId: g.setId,
        name: name.get(g.setId) ?? g.setId,
        unlinked: g._count._all,
        total: total.get(g.setId) ?? g._count._all,
        collisions: last.get(g.setId)?.collisions ?? null,
        omittedProducts: last.get(g.setId)?.omitted ?? null,
      })),
    };
  }

  /** Una corrida a la vez (single-flight en el proceso); una segunda llamada recibe la promesa en curso. */
  run(trigger: 'deploy' | 'manual' = 'manual'): Promise<LinkRepairRun> {
    if (this.running) return this.running;
    const p = this.doRun(trigger).finally(() => {
      this.running = null;
    });
    this.running = p;
    return p;
  }

  private async doRun(trigger: 'deploy' | 'manual'): Promise<LinkRepairRun> {
    const { sets: pending } = await this.unlinkedPrice();
    const out: LinkRepairRun = { sets: [], linked: 0, errors: 0, inventory: { corrected: 0, excluded: 0, ambiguous: 0 } };
    const linkedCardIds: string[] = [];
    let attempted = 0;
    for (const s of pending) {
      if (attempted >= LINK_REPAIR_MAX_SETS) break;
      const set = await this.prisma.cardSet.findUnique({ where: { id: s.setId }, select: { externalId: true } });
      if (!set || isTcgcsvOrigin(set.externalId)) continue; // los sets `tcgcsv:` los puebla su importador
      attempted += 1;
      try {
        const r = await this.resolver.resolveCardProductsForSet(s.setId, { onlyUnlinked: true });
        const linked = r?.touchedCardIds?.length ?? 0;
        linkedCardIds.push(...(r?.touchedCardIds ?? []));
        out.linked += linked;
        const row = { setId: s.setId, name: s.name, linked, collisions: r?.collisions ?? 0, omitted: r?.omittedProducts ?? 0 };
        out.sets.push(row);
        if (r) {
          await this.audit.log({
            actorUserId: null,
            action: ACTION,
            entityType: 'CardSet',
            entityId: s.setId,
            after: { setId: s.setId, linked, collisions: row.collisions, omitted: row.omitted, trigger },
          });
        }
      } catch (e) {
        out.errors += 1;
        out.sets.push({ setId: s.setId, name: s.name, linked: 0, collisions: 0, omitted: 0, error: (e as Error).message });
        this.logger.warn(`card-link-repair: set ${s.setId} falló (${(e as Error).message}); queda para la próxima corrida.`);
      }
    }
    if (linkedCardIds.length > 0) out.inventory = await this.correctInventoryFinish(linkedCardIds, trigger);
    if (trigger === 'deploy' && out.errors === 0) {
      await this.audit.log({
        actorUserId: null,
        action: DEPLOY_MARKER,
        entityType: 'CardSet',
        after: { linked: out.linked, sets: out.sets.length, inventory: out.inventory },
      });
    }
    this.logger.log(
      `card-link-repair (${trigger}): sets=${out.sets.length} enlazadas=${out.linked} errores=${out.errors} ` +
        `piezas con acabado corregido=${out.inventory.corrected} excluidas=${out.inventory.excluded} ambiguas=${out.inventory.ambiguous}.`,
    );
    return out;
  }

  /**
   * Opción A del dueño: una pieza raw (sin versión de liga) cuyo acabado no existe en la carta recién enlazada, y la carta
   * tiene UN solo acabado, pasa a ese acabado. NO se toca el costo de adquisición ni ningún otro campo: solo `finish`
   * (y, por consecuencia, el precio de venta automático, que se recalcula). Sin pedido/envío/disputa/reserva/venta ni
   * movimiento de dinero. Escritura condicionada (solo si la pieza sigue como se leyó) + auditoría por pieza; idempotente
   * (corregida, su acabado ya está en la carta y no vuelve a salir).
   */
  private async correctInventoryFinish(cardIds: string[], trigger: string): Promise<LinkRepairRun['inventory']> {
    const res = { corrected: 0, excluded: 0, ambiguous: 0 };
    const items = await this.prisma.inventoryItem.findMany({
      where: { cardId: { in: cardIds }, productType: 'raw', cardProductId: null },
      select: {
        id: true,
        cardId: true,
        finish: true,
        status: true,
        reservedByOrderId: true,
        card: { select: { availableFinishes: true } },
        _count: { select: { orderItems: true, shipmentItems: true, disputes: true } },
      },
    });
    const mismatched = items.filter((i) => !i.card.availableFinishes.includes(i.finish));
    if (mismatched.length === 0) return res;
    const moneyMoved = new Set(
      (
        await this.prisma.inventoryMovement.findMany({
          where: { itemId: { in: mismatched.map((i) => i.id) }, reason: { in: MONEY_MOVEMENTS } },
          select: { itemId: true },
        })
      ).map((m) => m.itemId),
    );
    const fixed: string[] = [];
    for (const i of mismatched) {
      if (i.card.availableFinishes.length !== 1) {
        res.ambiguous += 1;
        continue;
      }
      const hasMoney =
        !CORRECTABLE_STATUS.includes(i.status) ||
        i.reservedByOrderId != null ||
        i._count.orderItems > 0 ||
        i._count.shipmentItems > 0 ||
        i._count.disputes > 0 ||
        moneyMoved.has(i.id);
      if (hasMoney) {
        res.excluded += 1;
        continue;
      }
      const to: Finish = i.card.availableFinishes[0];
      const done = await this.prisma.$transaction(async (tx) => {
        // Condicionada: solo si la pieza sigue libre y con el acabado leído (una venta concurrente no se pisa).
        const w = await tx.inventoryItem.updateMany({
          where: { id: i.id, finish: i.finish, status: { in: CORRECTABLE_STATUS }, reservedByOrderId: null, orderItems: { none: {} } },
          data: { finish: to },
        });
        if (w.count !== 1) return false;
        await this.audit.log(
          {
            actorUserId: null,
            action: 'inventory.finish_corrected',
            entityType: 'InventoryItem',
            entityId: i.id,
            before: { finish: i.finish },
            after: { finish: to, cardId: i.cardId, reason: 'card-link-repair', trigger },
          },
          tx,
        );
        return true;
      });
      if (done) {
        res.corrected += 1;
        fixed.push(i.id);
      } else res.excluded += 1;
    }
    if (fixed.length > 0 && this.listingPrice) {
      try {
        await this.listingPrice.run('manual_price', fixed);
      } catch (e) {
        this.logger.warn(`card-link-repair: no se pudo recalcular el precio de ${fixed.length} pieza(s) corregida(s) (${(e as Error).message}); lo hará el recálculo diario.`);
      }
    }
    return res;
  }
}

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PricingService } from './pricing.service';
import { normalizeStampLabel } from '../../common/stamp-label';
import { runSerializable } from '../../common/serializable-retry';

export type MergeSkipReason = 'multiple_manual' | 'ambiguous_real' | 'label_mismatch' | 'manual_has_prices';
export interface MergeResult {
  merged: number;
  skipped: number;
  items: number;
}

/**
 * §ALTA-LIGA-2 (API_CONTRACT_ALTA_LIGA §4) — FUSIÓN AUTOMÁTICA de una versión de liga manual (productId < 0) con el producto REAL
 * (productId > 0, `stamped`) de la misma carta y el mismo `stampType`. Sin acción del dueño. Una transacción serializable por carta:
 * reapunta las piezas (`InventoryItem.cardProductId`; conservan costo y todo lo demás), une los acabados, borra el manual y deja
 * `inventory.manual_version_merged`. Ante la duda NO fusiona (el manual sigue con precio heredado) y deja
 * `inventory.manual_version_merge_skipped {reason}` (una sola vez por manual y motivo). Idempotente: la 2.ª corrida no cambia nada.
 * Disparan: el barrido de sellos del sync, `import-tcgcsv-set`, `attach` y el job diario `manual-version-merge`.
 */
@Injectable()
export class ManualVersionMergeService {
  private readonly logger = new Logger(ManualVersionMergeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  /** Cartas con al menos una versión manual (las únicas que el job diario necesita mirar). */
  async cardsWithManual(): Promise<string[]> {
    const rows = await this.prisma.cardProduct.findMany({ where: { kind: 'stamped', tcgplayerProductId: { lt: 0 } }, select: { cardId: true }, distinct: ['cardId'] });
    return rows.map((r) => r.cardId);
  }

  /** El job diario: recorre las cartas con manual. Cada carta es su propia transacción; el fallo de una no frena a las demás. */
  async runAll(): Promise<MergeResult> {
    const total: MergeResult = { merged: 0, skipped: 0, items: 0 };
    for (const cardId of await this.cardsWithManual()) {
      try {
        const r = await this.mergeForCard(cardId);
        total.merged += r.merged;
        total.skipped += r.skipped;
        total.items += r.items;
      } catch (e) {
        this.logger.error(`manual-version-merge ${cardId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return total;
  }

  /** Disparador best-effort para el sync/import (post-commit): recorre las cartas con manual; jamás lanza. */
  async runAllSafe(): Promise<void> {
    try {
      await this.runAll();
    } catch (e) {
      this.logger.warn(`manual-version-merge (disparador): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Disparador best-effort (post-commit del que crea/ata un producto real): jamás lanza. */
  async mergeForCardSafe(cardId: string): Promise<void> {
    try {
      await this.mergeForCard(cardId);
    } catch (e) {
      this.logger.warn(`manual-version-merge ${cardId} (disparador): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async mergeForCard(cardId: string): Promise<MergeResult> {
    const out: MergeResult = { merged: 0, skipped: 0, items: 0 };
    await runSerializable(
      this.prisma,
      async (tx) => {
        out.merged = 0;
        out.skipped = 0;
        out.items = 0;
        const products = await tx.cardProduct.findMany({ where: { cardId, kind: 'stamped' }, orderBy: { tcgplayerProductId: 'asc' } });
        const manuals = products.filter((p) => p.tcgplayerProductId < 0 && p.stampType != null);
        if (manuals.length === 0) return;
        const reals = products.filter((p) => p.tcgplayerProductId > 0 && p.stampType != null);
        const types = new Set(manuals.map((m) => m.stampType!));
        for (const type of types) {
          const ms = manuals.filter((m) => m.stampType === type);
          const rs = reals.filter((r) => r.stampType === type);
          if (rs.length === 0) continue; // nada con qué fusionar todavía
          const skip = async (reason: MergeSkipReason) => {
            for (const m of ms) await this.auditSkip(tx, m, rs, reason, out);
          };
          if (ms.length >= 2) {
            await skip('multiple_manual');
            continue;
          }
          if (rs.length >= 2) {
            await skip('ambiguous_real');
            continue;
          }
          const m = ms[0];
          const r = rs[0];
          const ml = normalizeStampLabel(m.stampLabel);
          const rl = normalizeStampLabel(r.stampLabel);
          if (ml != null && rl != null && ml !== rl) {
            await skip('label_mismatch');
            continue;
          }
          if ((await tx.priceReference.count({ where: { cardProductId: m.id } })) > 0) {
            await skip('manual_has_prices');
            continue;
          }
          // Reapunta TODO lo que cuelga del id manual y conserva el costo (solo cambia la FK de versión).
          const moved = await tx.inventoryItem.updateMany({ where: { cardProductId: m.tcgplayerProductId }, data: { cardProductId: r.tcgplayerProductId } });
          await this.pricing.closePendingOfProduct(tx, m.tcgplayerProductId); // cola derivada: se reabre con la clave del real
          await tx.sellRequestItem.updateMany({ where: { cardProductId: m.tcgplayerProductId }, data: { cardProductId: r.tcgplayerProductId } });
          const finishes = [...new Set([...r.finishes, ...m.finishes])];
          await tx.cardProduct.update({ where: { id: r.id }, data: { finishes } });
          await tx.cardProduct.delete({ where: { id: m.id } });
          await this.audit?.log(
            {
              actorUserId: null,
              action: 'inventory.manual_version_merged',
              entityType: 'CardProduct',
              entityId: r.id,
              after: { from: m.tcgplayerProductId, to: r.tcgplayerProductId, items: moved.count, cardId, stampType: type, finishes },
            },
            tx,
          );
          out.merged += 1;
          out.items += moved.count;
        }
      },
      { label: 'manual-version-merge', logger: this.logger },
    );
    return out;
  }

  /** Una sola fila de «omitido» por manual y motivo (la corrida diaria no la repite). */
  private async auditSkip(
    tx: Prisma.TransactionClient,
    m: { id: string; tcgplayerProductId: number; cardId: string; stampType: string | null },
    reals: { tcgplayerProductId: number }[],
    reason: MergeSkipReason,
    out: MergeResult,
  ): Promise<void> {
    const prev = await tx.auditLog.findFirst({
      where: { action: 'inventory.manual_version_merge_skipped', entityId: m.id, after: { path: ['reason'], equals: reason } },
      select: { id: true },
    });
    out.skipped += 1;
    if (prev) return;
    await this.audit?.log(
      {
        actorUserId: null,
        action: 'inventory.manual_version_merge_skipped',
        entityType: 'CardProduct',
        entityId: m.id,
        after: { reason, cardId: m.cardId, stampType: m.stampType, manual: m.tcgplayerProductId, reals: reals.map((x) => x.tcgplayerProductId) },
      },
      tx,
    );
  }
}

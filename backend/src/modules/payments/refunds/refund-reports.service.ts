/**
 * §M4-SHIP.17.5 — VER AL OPERADOR QUE REEMBOLSA (SEC-SHIP-M1): `operator-summary` (ventanas rodantes 24 h / 7 d /
 * 30 d, `capUsedCents` con EL MISMO predicado que el tope, tasa de faltantes, merma propia, `selfReplaced30d`) y
 * la MERMA POR ACTOR (`/admin/finance/shrinkage`): `InventoryMovement` con `toStatus ∈ {lost, damaged}` Y
 * `fromStatus ∉ {lost, damaged}` — la ENTRADA a merma se cuenta UNA vez (el traspaso `replacement` de una
 * original ya `lost` no vuelve a contar). Sin PII bancaria; sin bitácora (lecturas).
 */
import { Injectable } from '@nestjs/common';
import { customerEmailOrBlank } from '../../../common/customer-email';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { customerDisplayName } from '../../vault/customer-display-name';
import { RefundLedgerService } from './refund-ledger.service';

const DAY = 24 * 3600 * 1000;

export interface ShrinkageTotals {
  pieces: number;
  costCents: number;
  unknownCostPieces: number;
}

@Injectable()
export class RefundReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: RefundLedgerService,
  ) {}

  async customerRef(userId: string): Promise<{ userId: string; fullName: string | null; email: string } | null> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true, nameSource: true } });
    return u ? { userId, fullName: customerDisplayName(u), email: customerEmailOrBlank(u.email, 'RefundReports.customerRef', userId) } : null;
  }

  /** El `where` de la MERMA (un cuerpo para `/finance/shrinkage` y `shrinkage30d`). */
  static shrinkageWhere(extra: Prisma.InventoryMovementWhereInput = {}): Prisma.InventoryMovementWhereInput {
    return {
      toStatus: { in: ['lost', 'damaged'] },
      OR: [{ fromStatus: null }, { fromStatus: { notIn: ['lost', 'damaged'] } }],
      ...extra,
    };
  }

  async shrinkage(q: { from?: Date; to?: Date; actorUserId?: string; reason?: 'lost' | 'damaged'; page: number; pageSize: number }) {
    const where = RefundReportsService.shrinkageWhere({
      ...(q.actorUserId ? { actorUserId: q.actorUserId } : {}),
      ...(q.reason ? { reason: q.reason } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
    });
    const [rows, total, all] = await Promise.all([
      this.prisma.inventoryMovement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { item: { select: { id: true, folio: true, ownerType: true, acquisitionCostCents: true, card: { select: { name: true } } } } },
      }),
      this.prisma.inventoryMovement.count({ where }),
      this.prisma.inventoryMovement.findMany({ where, select: { item: { select: { acquisitionCostCents: true } } } }),
    ]);
    const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter((x): x is string => !!x))];
    const users = actorIds.length ? await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    const totals: ShrinkageTotals = { pieces: all.length, costCents: 0, unknownCostPieces: 0 };
    for (const m of all) {
      if (m.item.acquisitionCostCents == null) totals.unknownCostPieces += 1;
      else totals.costCents += m.item.acquisitionCostCents;
    }
    return {
      data: rows.map((m) => ({
        movementId: m.id,
        createdAt: m.createdAt.toISOString(),
        actor: m.actorUserId ? { userId: m.actorUserId, name: names.get(m.actorUserId) ?? null } : null,
        item: { id: m.item.id, folio: m.item.folio, cardName: m.item.card.name, ownerTypeNow: m.item.ownerType },
        fromStatus: m.fromStatus,
        toStatus: m.toStatus,
        reason: m.reason,
        note: m.note,
        acquisitionCostCents: m.item.acquisitionCostCents,
      })),
      page: q.page,
      pageSize: q.pageSize,
      total,
      totals,
    };
  }

  private async shrinkageTotals(actorUserId: string, since: Date): Promise<ShrinkageTotals> {
    const all = await this.prisma.inventoryMovement.findMany({
      where: RefundReportsService.shrinkageWhere({ actorUserId, createdAt: { gte: since } }),
      select: { item: { select: { acquisitionCostCents: true } } },
    });
    const t: ShrinkageTotals = { pieces: all.length, costCents: 0, unknownCostPieces: 0 };
    for (const m of all) {
      if (m.item.acquisitionCostCents == null) t.unknownCostPieces += 1;
      else t.costCents += m.item.acquisitionCostCents;
    }
    return t;
  }

  async operatorSummary(now = new Date()) {
    const d30 = new Date(now.getTime() - 30 * DAY);
    const [operators, actors] = await Promise.all([
      this.prisma.user.findMany({ where: { role: 'vault_operator' }, select: { id: true, name: true, email: true, username: true, status: true } }),
      this.prisma.paymentRefund.findMany({
        where: { requestedByRole: 'vault_operator', createdAt: { gte: d30 } },
        select: { requestedByUserId: true },
        distinct: ['requestedByUserId'],
      }),
    ]);
    const ids = [...new Set([...operators.map((o) => o.id), ...actors.map((a) => a.requestedByUserId)])];
    const extra = ids.filter((id) => !operators.some((o) => o.id === id));
    const extraUsers = extra.length ? await this.prisma.user.findMany({ where: { id: { in: extra } }, select: { id: true, name: true, email: true, username: true, status: true } }) : [];
    const users = [...operators, ...extraUsers];
    const capCents = await this.ledger.operatorCapCents();
    const out = [];
    for (const u of users) {
      const win = async (ms: number) => {
        const agg = await this.prisma.paymentRefund.aggregate({
          where: { requestedByUserId: u.id, status: { not: 'failed' }, createdAt: { gte: new Date(now.getTime() - ms) } },
          _sum: { amountCents: true },
          _count: { _all: true },
        });
        return { count: agg._count._all, cents: agg._sum.amountCents ?? 0 };
      };
      const [last24h, last7d, last30d, capUsedCents, prepared, selfReplaced30d, shrinkage30d] = await Promise.all([
        win(DAY),
        win(7 * DAY),
        win(30 * DAY),
        this.ledger.operatorUsedCents(this.prisma, u.id, now),
        this.prisma.shipmentRequest.findMany({
          where: { preparedByUserId: u.id, preparedAt: { gte: d30 } },
          select: { items: { select: { prepStatus: true } } },
        }),
        this.prisma.replacementCase.count({ where: { status: 'replaced', openedByUserId: u.id, resolvedByUserId: u.id, resolvedAt: { gte: d30 } } }),
        this.shrinkageTotals(u.id, d30),
      ]);
      const lines = prepared.reduce((a, s) => a + s.items.length, 0);
      const missingLines = prepared.reduce((a, s) => a + s.items.filter((i) => i.prepStatus === 'missing').length, 0);
      out.push({
        // v1.80.9 (§M6-U.8 (b)): el operador puede no tener correo ⇒ `email: string | null` + `username`; el front pinta `email ?? username`.
        user: { userId: u.id, name: u.name.trim() === '' ? null : u.name, email: u.email, username: u.username, active: u.status === 'active' },
        refunds: { last24h, last7d, last30d },
        capUsedCents,
        prepared30d: { shipments: prepared.length, lines, missingLines, missingRatePct: lines === 0 ? null : Math.round((missingLines * 1000) / lines) / 10 },
        shrinkage30d,
        selfReplaced30d,
      });
    }
    return { generatedAt: now.toISOString(), capCents, operators: out };
  }
}

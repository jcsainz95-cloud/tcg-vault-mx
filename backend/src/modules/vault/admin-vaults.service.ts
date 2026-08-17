import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { NOT_ON_HAND } from '../inventory/master-set.service';

/**
 * AdminVaultsService (v1.18-master-set-everywhere, §4.18c) — GET /admin/vaults: lista de clientes
 * CON bóveda (≥1 pieza en bóveda) para soporte/operación. Identificación mínima (name/email, misma
 * exposición que M6 para vault_operator; NUNCA CLABE/RFC/INE) + conteo de piezas + valor estimado
 * con la MISMA base de valuación del portafolio §3: referencia vigente POR ACABADO
 * (`getReferencesBatch`, 1 lote); piezas sin precio se EXCLUYEN del total y se cuentan en
 * `pendingPriceCount`. SIN N+1: 3 queries fijas (piezas en bóveda + usuarios de esas piezas +
 * lote de referencias); el sort global (value_desc default) se hace en memoria sobre el agregado.
 */

export interface AdminVaultSummaryDTO {
  userId: string;
  name: string;
  email: string;
  pieceCount: number;
  totalValueMxnCents: number;
  pendingPriceCount: number;
}

export interface AdminVaultListResponse {
  data: AdminVaultSummaryDTO[];
  page: number;
  pageSize: number;
  total: number;
}

@Injectable()
export class AdminVaultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  async list(q: {
    q?: string;
    page: number;
    pageSize: number;
    sort: string;
  }): Promise<AdminVaultListResponse> {
    // (1) TODAS las piezas "en bóveda" de clientes (mismo filtro de status del scope user_vault).
    const pieces = await this.prisma.inventoryItem.findMany({
      where: {
        ownerType: 'customer',
        ownerUserId: { not: null },
        status: { notIn: NOT_ON_HAND },
      },
      select: {
        ownerUserId: true,
        cardId: true,
        productType: true,
        rawCondition: true,
        gradingCompany: true,
        gradeValue: true,
        finish: true,
      },
    });
    if (pieces.length === 0) return { data: [], page: q.page, pageSize: q.pageSize, total: 0 };

    // (2) Identificación mínima de los dueños (filtro q por nombre/email aquí).
    const ownerIds = [...new Set(pieces.map((p) => p.ownerUserId as string))];
    const users = await this.prisma.user.findMany({
      where: {
        id: { in: ownerIds },
        ...(q.q
          ? {
              OR: [
                { name: { contains: q.q, mode: 'insensitive' } },
                { email: { contains: q.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      select: { id: true, name: true, email: true },
    });
    const userById = new Map(users.map((u) => [u.id, u]));

    // (3) Valuación en LOTE — misma base que el portafolio §3 (referencia vigente por acabado).
    const refs = await this.pricing.getReferencesBatch(
      pieces.map((p) => ({
        cardId: p.cardId,
        productType: p.productType,
        gradeKey: this.pricing.gradeKeyFor(p),
        finish: p.finish,
      })),
    );

    const agg = new Map<
      string,
      { pieceCount: number; totalValueMxnCents: number; pendingPriceCount: number }
    >();
    for (const p of pieces) {
      const userId = p.ownerUserId as string;
      if (!userById.has(userId)) continue; // fuera del filtro q (o usuario inexistente)
      const a = agg.get(userId) ?? { pieceCount: 0, totalValueMxnCents: 0, pendingPriceCount: 0 };
      a.pieceCount += 1;
      const ref = refs.get(
        `${p.cardId}|${p.productType}|${this.pricing.gradeKeyFor(p)}|${p.finish}`,
      );
      if (ref && ref.status === 'priced' && ref.referenceMxnCents != null) {
        a.totalValueMxnCents += ref.referenceMxnCents;
      } else {
        a.pendingPriceCount += 1; // pendientes EXCLUIDOS del total y CONTADOS (§3)
      }
      agg.set(userId, a);
    }

    let rows: AdminVaultSummaryDTO[] = [...agg.entries()].map(([userId, a]) => {
      const u = userById.get(userId)!;
      return { userId, name: u.name, email: u.email, ...a };
    });

    rows = this.sortRows(rows, q.sort);
    const total = rows.length;
    const start = (q.page - 1) * q.pageSize;
    return { data: rows.slice(start, start + q.pageSize), page: q.page, pageSize: q.pageSize, total };
  }

  /** Orden normado: value_desc (default) | pieces_desc | name_asc. */
  private sortRows(rows: AdminVaultSummaryDTO[], sort: string): AdminVaultSummaryDTO[] {
    const byName = (a: AdminVaultSummaryDTO, b: AdminVaultSummaryDTO) =>
      a.name.localeCompare(b.name);
    if (sort === 'pieces_desc') {
      return [...rows].sort((a, b) => b.pieceCount - a.pieceCount || byName(a, b));
    }
    if (sort === 'name_asc') return [...rows].sort(byName);
    return [...rows].sort((a, b) => b.totalValueMxnCents - a.totalValueMxnCents || byName(a, b));
  }
}

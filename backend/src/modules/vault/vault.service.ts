import { Injectable } from '@nestjs/common';
import { ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { BusinessException } from '../../common/business.exception';
import { toCardDTO } from '../catalog/catalog.service';

// v1.17: etapas de un envío ACTIVO (subconjunto expuesto en HoldingDTO.shipmentState).
// `entregado` no aparece (el item ya es `withdrawn` y sale de holdings) y `cancelado`
// libera el item ⇒ shipmentState=null. ARCHITECTURE §3.3, API_CONTRACT §3.
const ACTIVE_SHIPMENT_STAGES: ShipmentStatus[] = [
  ShipmentStatus.solicitado,
  ShipmentStatus.picking,
  ShipmentStatus.guia,
  ShipmentStatus.enviado,
];

@Injectable()
export class VaultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  /**
   * Mi bóveda. El valor de portafolio se calcula contra el VALOR DE REFERENCIA
   * (no el precio de venta). Las cartas con precio pendiente se EXCLUYEN del total
   * y se reportan en pendingPriceCount (no rompen el cálculo). API_CONTRACT §3.
   */
  async holdings(userId: string) {
    // v1.17: los `entregado` salen de la bóveda (item.status='withdrawn') y NO cuentan en
    // el portafolio; los items con envío ACTIVO (solicitado/picking/guia/enviado) SÍ se
    // listan y SÍ cuentan. API_CONTRACT §3.
    const items = await this.prisma.inventoryItem.findMany({
      where: { ownerType: 'customer', ownerUserId: userId, status: { not: 'withdrawn' } },
      include: { card: { include: { set: true } } },
      orderBy: { createdAt: 'desc' },
    });

    // v1.17 — fuente de verdad canónica del estado de retiro: join
    // InventoryItem → ShipmentItem → ShipmentRequest ACTIVO. Batch en UNA consulta
    // (evita N+1); a lo más un envío activo por item (garantizado por
    // 409 ITEM_IN_ANOTHER_SHIPMENT). ARCHITECTURE §3.3.
    const itemIds = items.map((i) => i.id);
    const activeShipmentItems = itemIds.length
      ? await this.prisma.shipmentItem.findMany({
          where: {
            inventoryItemId: { in: itemIds },
            shipmentRequest: { status: { in: ACTIVE_SHIPMENT_STAGES } },
          },
          select: {
            inventoryItemId: true,
            shipmentRequestId: true,
            shipmentRequest: { select: { status: true } },
          },
        })
      : [];
    const activeByItem = new Map<string, { shipmentId: string; state: ShipmentStatus }>();
    for (const si of activeShipmentItems) {
      activeByItem.set(si.inventoryItemId, {
        shipmentId: si.shipmentRequestId,
        state: si.shipmentRequest.status,
      });
    }

    let totalValueMxnCents = 0;
    let pendingPriceCount = 0;
    const data = [];
    for (const item of items) {
      const gradeKey = this.pricing.gradeKeyFor(item);
      // v1.6-finish: valúa contra la referencia del ACABADO del holding (no un precio único por carta).
      const referenceValue = await this.pricing.getReference(
        item.cardId,
        item.productType,
        gradeKey,
        item.finish,
      );
      if (referenceValue.status === 'priced' && referenceValue.referenceMxnCents != null) {
        totalValueMxnCents += referenceValue.referenceMxnCents;
      } else {
        pendingPriceCount += 1;
      }
      // v1.17 — estado del retiro derivado del join; flag `withdrawable` AUTORITATIVO.
      const active = activeByItem.get(item.id) ?? null;
      const shipmentState = active ? active.state : null;
      const activeShipmentId = active ? active.shipmentId : null;
      const withdrawable = item.ownershipStatus === 'settled' && shipmentState === null;
      data.push({
        inventoryItemId: item.id,
        folio: item.folio,
        card: toCardDTO(item.card),
        productType: item.productType,
        rawCondition: item.rawCondition ?? undefined,
        // v1.6-finish: acabado del holding (HoldingDTO.finish).
        finish: item.finish,
        gradingCompany: item.gradingCompany ?? undefined,
        gradeValue: item.gradeValue ?? undefined,
        ownershipStatus: item.ownershipStatus,
        status: item.status,
        // v1.17: etapa del envío activo, deep-link y flag anti doble-retiro.
        shipmentState,
        activeShipmentId,
        withdrawable,
        referenceValue,
      });
    }
    return {
      data,
      portfolio: { totalValueMxnCents, pendingPriceCount, currency: 'MXN' as const },
    };
  }

  /**
   * Base de costo agregada del usuario (suma de acquisitionCostCents de sus holdings).
   * Opcional/nullable: si ningún item tiene costo registrado → null.
   */
  async costBasisCents(userId: string): Promise<number | null> {
    // v1.17: misma exclusión que holdings — los `withdrawn` (entregados) salen del
    // portafolio y de su base de costo, para que el snapshot histórico sea coherente.
    const agg = await this.prisma.inventoryItem.aggregate({
      where: { ownerType: 'customer', ownerUserId: userId, status: { not: 'withdrawn' } },
      _sum: { acquisitionCostCents: true },
    });
    return agg._sum.acquisitionCostCents ?? null;
  }

  /**
   * v1.1 — Gráfica de tendencia del portafolio (API_CONTRACT §3, GET /vault/portfolio/history).
   * Lee la serie diaria `PortfolioSnapshot` para el rango pedido y calcula la variación
   * (primer vs último punto). estilo acciones. Rangos: 5d|15d|1m|3m|6m|1y|ytd|all (default 1m).
   */
  async portfolioHistory(userId: string, range: string) {
    const normalizedRange = this.normalizeRange(range);
    const from = this.rangeStart(normalizedRange);
    const snapshots = await this.prisma.portfolioSnapshot.findMany({
      where: { userId, ...(from ? { asOfDate: { gte: from } } : {}) },
      orderBy: { asOfDate: 'asc' },
    });

    const points = snapshots.map((s) => ({
      date: s.asOfDate.toISOString().slice(0, 10),
      valueMxnCents: s.totalValueMxnCents,
      ...(s.costBasisMxnCents != null ? { costBasisMxnCents: s.costBasisMxnCents } : {}),
    }));

    if (points.length === 0) {
      return {
        range: normalizedRange,
        points,
        change: { absMxnCents: 0, pct: null as number | null, direction: 'flat' as const },
      };
    }

    const first = points[0].valueMxnCents;
    const last = points[points.length - 1].valueMxnCents;
    const absMxnCents = last - first;
    const pct = first === 0 ? null : Math.round((absMxnCents / first) * 10000) / 100;
    const direction = absMxnCents > 0 ? 'up' : absMxnCents < 0 ? 'down' : 'flat';
    return { range: normalizedRange, points, change: { absMxnCents, pct, direction } };
  }

  private normalizeRange(range: string): string {
    const allowed = ['5d', '15d', '1m', '3m', '6m', '1y', 'ytd', 'all'];
    return allowed.includes(range) ? range : '1m';
  }

  /** Fecha de inicio (00:00 UTC) del rango, o null para `all`. */
  private rangeStart(range: string): Date | null {
    const now = new Date();
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    switch (range) {
      case '5d':
        d.setUTCDate(d.getUTCDate() - 5);
        return d;
      case '15d':
        d.setUTCDate(d.getUTCDate() - 15);
        return d;
      case '1m':
        d.setUTCMonth(d.getUTCMonth() - 1);
        return d;
      case '3m':
        d.setUTCMonth(d.getUTCMonth() - 3);
        return d;
      case '6m':
        d.setUTCMonth(d.getUTCMonth() - 6);
        return d;
      case '1y':
        d.setUTCFullYear(d.getUTCFullYear() - 1);
        return d;
      case 'ytd':
        return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      case 'all':
      default:
        return null;
    }
  }

  async holdingDetail(userId: string, inventoryItemId: string) {
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id: inventoryItemId },
      include: {
        card: { include: { set: true } },
        movements: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!item) throw BusinessException.notFound();
    if (item.ownerUserId !== userId) throw BusinessException.forbidden('FORBIDDEN');
    const gradeKey = this.pricing.gradeKeyFor(item);
    // v1.6-finish: valúa contra la referencia del ACABADO del holding.
    const referenceValue = await this.pricing.getReference(
      item.cardId,
      item.productType,
      gradeKey,
      item.finish,
    );
    return {
      inventoryItemId: item.id,
      folio: item.folio,
      card: toCardDTO(item.card),
      productType: item.productType,
      rawCondition: item.rawCondition ?? undefined,
      finish: item.finish,
      gradingCompany: item.gradingCompany ?? undefined,
      gradeValue: item.gradeValue ?? undefined,
      // v1.2 (M-12): nº de certificado PSA/CGC para gradeadas; v1.2 (M-13): sin fotos propias
      // (la imagen es la de catálogo remota de pokemontcg.io, en CardDTO).
      certNumber: item.certNumber ?? undefined,
      ownershipStatus: item.ownershipStatus,
      status: item.status,
      referenceValue,
      movements: item.movements,
    };
  }
}

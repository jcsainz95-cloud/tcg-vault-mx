import { Injectable } from '@nestjs/common';
import { Card, CardSet, InventoryItem, Prisma, SealedCondition, SealedSubtype, ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService, PriceInfo } from '../pricing/pricing.service';
import { BusinessException } from '../../common/business.exception';
import { toCardDTO } from '../catalog/catalog.service';
import { NOT_ON_HAND } from '../inventory/master-set.service';

// v1.17: etapas de un envío ACTIVO (subconjunto expuesto en HoldingDTO.shipmentState).
// `entregado` no aparece (el item ya es `withdrawn` y sale de holdings) y `cancelado`
// libera el item ⇒ shipmentState=null. ARCHITECTURE §3.3, API_CONTRACT §3.
const ACTIVE_SHIPMENT_STAGES: ShipmentStatus[] = [
  ShipmentStatus.solicitado,
  ShipmentStatus.picking,
  ShipmentStatus.guia,
  ShipmentStatus.enviado,
];

// v1.23-sealed-sales: filtros válidos de la pestaña «Sellado» (se ignoran silenciosamente si no matchean).
const SEALED_SUBTYPE_SET = new Set<string>(['box', 'etb', 'bundle', 'tin', 'blister']);
const SEALED_CONDITION_SET = new Set<string>(['mint', 'minor_box_damage']);

/**
 * v1.42 (BLOQ-2a / H-P38-1, §4.34a) — cascada de display del SELLADO, RESUELTA server-side: snapshot
 * congelado por-pieza (`sealedProductName`/`sealedImageUrl`, M-37) → `Card` ancla. MISMO resolver que
 * usa `/vault/sealed` (`sealedTab`), el grid público y `sealed-sets` (no se duplica la regla). Mata el
 * patrón «Tropius»: la caja se pinta con su identidad real, no con la carta ancla. `name` nunca null (la
 * cascada termina en `Card.name`, NOT NULL); `imageUrl` puede ser null (honesto). Money-safe: solo display.
 */
function resolveSealedDisplay(item: {
  sealedProductName?: string | null;
  sealedImageUrl?: string | null;
  card: { name: string; imageSmallUrl?: string | null };
}): { name: string; imageUrl: string | null } {
  return {
    name: item.sealedProductName ?? item.card.name,
    imageUrl: item.sealedImageUrl ?? item.card.imageSmallUrl ?? null,
  };
}

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

    // v1.22-2 / N-15 (§4.22a-6): acabados priceados por carta EN LOTE (sin N+1) para displayFinishes.
    const pricedByCard = await this.pricing.getPricedRawFinishesBatch(items.map((i) => i.cardId));

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
      // v1.17.1 (§3): criterio ÚNICO de elegibilidad read=write. Idéntico a `classifyItems`
      // (shipments.service): settled + EN CUSTODIA + sin envío activo. El `status==='in_custody'`
      // es imprescindible: la query filtra `status != 'withdrawn'`, pero un item `settled` puede
      // estar `lost`/`damaged` (sigue en la bóveda) y NO debe ser retirable.
      const withdrawable =
        item.ownershipStatus === 'settled' &&
        item.status === 'in_custody' &&
        shipmentState === null;
      // v1.42 (BLOQ-2a, §4.34a): identidad de sellado presente SOLO para productType='sealed' (ausente en
      // raw/graded; aditivo/retrocompatible). `card` se conserva (pertenencia al set + fallback). Reusa el
      // MISMO resolver de cascada de `/vault/sealed` para no pintar la caja como la carta ancla («Tropius»).
      const sealedFields =
        item.productType === 'sealed'
          ? (() => {
              const disp = resolveSealedDisplay(item);
              return {
                sealedProductId: item.sealedProductId ?? null,
                sealedProductName: disp.name,
                sealedImageUrl: disp.imageUrl,
                sealedSubtype: item.sealedSubtype ?? null,
                sealedCondition: item.sealedCondition ?? null,
              };
            })()
          : {};
      data.push({
        inventoryItemId: item.id,
        folio: item.folio,
        card: toCardDTO(item.card, pricedByCard.get(item.cardId)),
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
        // v1.42 (BLOQ-2a): campos de sellado (solo sealed; {} en raw/graded).
        ...sealedFields,
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

  /**
   * v1.23-sealed-sales (§3 / §4.23g) — pestaña «Sellado» de la bóveda: agrupa las piezas SELLADAS del
   * usuario en bóveda por producto+condición (mismo criterio que §2-S) con conteo, desglose por
   * titularidad y VALOR DE MERCADO actual (`sealedMarketRef`). Valuación = misma base del portafolio:
   * piezas sin mercado (no mapeadas / sin ingest) se EXCLUYEN de `totalValueMxnCents` y cuentan en
   * `pendingPriceCount`. Lectura pura; SIN datos internos (ubicación/costo/folio). Sin `owner` (lo
   * añade la vista admin). Sin N+1: 1 query de piezas + 1 lote de referencias + agrupación en memoria.
   */
  async sealedTab(userId: string, q: { sealedSubtype?: string; condition?: string; sort?: string }) {
    const where: Prisma.InventoryItemWhereInput = {
      ownerType: 'customer',
      ownerUserId: userId,
      productType: 'sealed',
      status: { notIn: NOT_ON_HAND }, // «en bóveda»: mismo filtro que el scope user_vault (§DTOs)
    };
    if (q.sealedSubtype && SEALED_SUBTYPE_SET.has(q.sealedSubtype)) {
      where.sealedSubtype = q.sealedSubtype as SealedSubtype;
    }
    if (q.condition && SEALED_CONDITION_SET.has(q.condition)) {
      where.sealedCondition = q.condition as SealedCondition;
    }

    const items = (await this.prisma.inventoryItem.findMany({
      where,
      include: { card: { include: { set: true } } },
      orderBy: { createdAt: 'desc' },
    })) as (InventoryItem & { card: Card & { set?: CardSet | null } })[];

    // Lote de referencias de MERCADO del sellado (`sealed:tcg:<productId>`, finish normal).
    const refs = await this.pricing.getReferencesBatch(
      items.flatMap((i) => {
        const gk = this.pricing.sealedMarketGradeKeyForItem(i);
        return gk ? [{ cardId: i.cardId, productType: 'sealed' as const, gradeKey: gk, finish: 'normal' as const }] : [];
      }),
    );
    // H-1 (v1.24): el mercado del sellado solo cuenta con el dial ENCENDIDO (`sourceOn`), igual que
    // catálogo/Compra/grid — para que la VALUACIÓN coincida con ellos (con off el ref TCGCSV es inerte,
    // §4.23a). Antes esta valuación no gateaba por dial (divergía cuando `sealed_price_source=off`).
    const { sourceOn } = await this.pricing.loadSealedSpreads();

    // v1.22-2 / N-15 (§4.22a-6): acabados priceados por carta EN LOTE (sin N+1) para displayFinishes.
    const pricedByCard = await this.pricing.getPricedRawFinishesBatch(items.map((i) => i.cardId));

    // Agrupa por producto+condición (mismo criterio que §2-S).
    const groups = new Map<string, (InventoryItem & { card: Card & { set?: CardSet | null } })[]>();
    for (const item of items) {
      const cond = item.sealedCondition ?? 'mint';
      const key =
        item.tcgplayerProductId != null
          ? `p:${item.tcgplayerProductId}:${cond}`
          : `c:${item.cardId}:${item.sealedSubtype ?? ''}:${cond}`;
      const arr = groups.get(key);
      if (arr) arr.push(item);
      else groups.set(key, [item]);
    }

    let totalValueMxnCents = 0;
    let pendingPriceCount = 0;
    const rows = [...groups.values()].map((members) => {
      const rep = members[0];
      const gk = this.pricing.sealedMarketGradeKeyForItem(rep);
      const rawRef = gk ? refs.get(`${rep.cardId}|sealed|${gk}|normal`) : undefined;
      // H-1 (v1.24): gate ÚNICO del mercado (dial + priced). Con off / no mapeado → null → pending.
      const marketCents = this.pricing.gateSealedMarketCents(rawRef, sourceOn);
      const priced = marketCents != null;
      const marketRef: PriceInfo = priced ? rawRef! : { status: 'pending' };
      const count = members.length;
      const ownership = { pending: 0, settled: 0 };
      for (const m of members) {
        if (m.ownershipStatus === 'settled') ownership.settled += 1;
        else ownership.pending += 1; // pending (o null) cuenta como pending
      }
      const totalMarketValueMxnCents = priced ? count * marketRef.referenceMxnCents! : null;
      if (priced) totalValueMxnCents += totalMarketValueMxnCents!;
      else pendingPriceCount += count; // piezas sin mercado EXCLUIDAS del total y CONTADAS (§3)
      // H-P38-1 (§4.34a): cascada de display de sellado — snapshot congelado por-pieza
      // (`sealedProductName`/`sealedImageUrl`, M-37) → `Card` ancla. Money-safe: solo display; la valuación
      // de arriba no cambia. Resolver ÚNICO compartido con `holdings` (BLOQ-2a): el ETB real, no «Tropius».
      const disp = resolveSealedDisplay(rep);
      return {
        card: toCardDTO(rep.card, pricedByCard.get(rep.cardId)),
        productName: disp.name,
        imageUrl: disp.imageUrl,
        sealedSubtype: (rep.sealedSubtype ?? null) as SealedSubtype | null,
        sealedCondition: (rep.sealedCondition ?? 'mint') as SealedCondition,
        count,
        ownership,
        marketValue: marketRef,
        totalMarketValueMxnCents,
      };
    });

    const sort = q.sort ?? 'value_desc';
    const byName = (a: { productName: string }, b: { productName: string }) =>
      a.productName.localeCompare(b.productName);
    if (sort === 'count_desc') rows.sort((a, b) => b.count - a.count || byName(a, b));
    else if (sort === 'name_asc') rows.sort(byName);
    else rows.sort((a, b) => (b.totalMarketValueMxnCents ?? -1) - (a.totalMarketValueMxnCents ?? -1) || byName(a, b));

    return { data: rows, totalValueMxnCents, pendingPriceCount, currency: 'MXN' as const };
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
    // v1.22-2 / N-15 (§4.22a-6): displayFinishes del detalle usa los acabados priceados de la carta.
    const pricedByCard = await this.pricing.getPricedRawFinishesBatch([item.cardId]);
    return {
      inventoryItemId: item.id,
      folio: item.folio,
      card: toCardDTO(item.card, pricedByCard.get(item.cardId)),
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

import { Injectable } from '@nestjs/common';
import { Finish, GradingCompany, ProductType, SealedCondition } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { PriceInfo, PricingService } from '../pricing/pricing.service';
import { sealedMarketGradeKey } from '../pricing/pricing.types';
import { NOT_ON_HAND, SetRefDTO } from './master-set.service';

/**
 * SealedGradedInventoryService — v1.28 (P-25 + P-20, ARCHITECTURE §4.26g/§4.26h · API_CONTRACT
 * §M1 Stream B). Read models de las pestañas «Sellado» (por SET) y «Gradeadas» de M1
 * (`vault_operator+`). SOLO lectura/agregación: no cambia el modelo por-pieza ni escribe nada.
 *
 * Alcance: piezas de PLATAFORMA "on-hand" (mismo filtro `NOT_ON_HAND` que el Master Set/M1 —
 * fuente única del "qué cuenta como inventario visible en la pestaña"). Identidad de grupo del
 * sellado = §4.23: `(cardId ancla, sealedSubtype, tcgplayerProductId, sealedCondition)`; del
 * graded = `(cardId, gradingCompany, gradeValue)`.
 *
 * Money-safe: los valores de mercado vienen de `PriceReference` vigente (sellado por
 * `sealedMarketRef`, clave `sealed:tcg:<productId>`; graded por su referencia de grado —
 * típicamente el override MANUAL de M2, §M2 P-20). Sin referencia ⇒ `null` HONESTO (nunca un 0
 * inventado); en el índice de sets las piezas sin mercado se EXCLUYEN del valor y cuentan en
 * `unmappedCount`. Sin N+1: agregaciones `groupBy` + `getReferencesBatch` por lote.
 */

export interface SealedSetSummaryDTO {
  set: SetRefDTO;
  pieceCount: number;
  listedCount: number;
  unmappedCount: number;
  marketValueMxnCents: number | null;
}

export interface SealedSetsIndexResponse {
  data: SealedSetSummaryDTO[];
  page: number;
  pageSize: number;
  total: number;
  /** Piezas selladas SIN mapeo en TODO el inventario — badge de la cola M2 `sealed/unmapped`. */
  unmappedTotal: number;
}

export interface SealedInventoryGroupDTO {
  cardId: string;
  /**
   * BLOQ-2 (fix H-P38-1, §4.34a / contrato §M1 v1.36 L187-188): cascada de display del sellado —
   * snapshot congelado por-pieza `sealedProductName` → `Card.name` ancla. Antes leía SOLO `Card.name`
   * y pintaba el nombre de la carta ancla («E2E Charizard») en vez del producto sellado real (ETB/blíster).
   */
  productName: string;
  /**
   * BLOQ-2 (contrato §M1 v1.28.1 L3723-3724, ADITIVO): imagen de la teja — cascada `sealedImageUrl`
   * (snapshot por-pieza) → `Card.imageSmallUrl` ancla → `null` honesto. Faltaba por completo en el DTO.
   */
  imageSmallUrl?: string | null;
  sealedSubtype: string | null;
  sealedCondition: SealedCondition;
  tcgplayerProductId: number | null;
  mapped: boolean;
  counts: { inStock: number; listed: number; other: number };
  sealedMarketRef?: PriceInfo | null;
  totalCostCents: number | null;
}

export interface SealedSetDetailResponse {
  set: SetRefDTO;
  groups: SealedInventoryGroupDTO[];
}

export interface GradedInventoryGroupDTO {
  cardId: string;
  card: { name: string; number: string; setName: string; imageSmallUrl?: string };
  gradingCompany: GradingCompany;
  gradeValue: string;
  count: number;
  marketReferenceMxnCents: number | null;
  capturedDate?: string | null;
  totalCostCents: number | null;
}

export interface GradedIndexResponse {
  data: GradedInventoryGroupDTO[];
  page: number;
  pageSize: number;
  total: number;
}

/** Proyección mínima de CardSet para el SetRefDTO del contrato. */
function toSetRef(s: { id: string; name: string; series: string | null; releaseDate: string | null }): SetRefDTO {
  return {
    id: s.id,
    name: s.name,
    series: s.series ?? undefined,
    releaseDate: s.releaseDate ?? undefined,
  };
}

@Injectable()
export class SealedGradedInventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  /** WHERE base de la pestaña: piezas selladas de PLATAFORMA on-hand (fuente única NOT_ON_HAND). */
  private sealedScope() {
    return {
      productType: 'sealed' as ProductType,
      ownerType: 'platform' as const,
      status: { notIn: NOT_ON_HAND },
    };
  }

  /**
   * GET /admin/inventory/sealed-sets — índice de la pestaña «Sellado»: sets con ≥1 pieza sellada
   * de plataforma. `marketValueMxnCents` = Σ `sealedMarketRef` de las piezas CON mercado; piezas
   * sin mercado (no mapeadas o sin ingest) se excluyen del valor y cuentan en `unmappedCount`
   * (`null` si ninguna valuable — nunca 0 inventado). `unmappedTotal` = espejo del conteo de la
   * cola M2 (`sealed AND tcgplayerProductId IS NULL`, TODO el inventario).
   */
  async sealedSetsIndex(q: { q?: string; page: number; pageSize: number }): Promise<SealedSetsIndexResponse> {
    // (1) UNA agregación de piezas por (carta, producto, status); (2) cartas→set; (3) sets
    // (con filtro q); (4) UN lote de referencias de mercado; (5) el badge global. Sin N+1.
    const [grouped, unmappedTotal] = await Promise.all([
      this.prisma.inventoryItem.groupBy({
        by: ['cardId', 'tcgplayerProductId', 'status'],
        where: this.sealedScope(),
        _count: { _all: true },
      }),
      // Badge de la cola de curación M2 (misma consulta derivada que `sealed/unmapped`).
      this.prisma.inventoryItem.count({
        where: { productType: 'sealed', tcgplayerProductId: null },
      }),
    ]);
    if (grouped.length === 0) {
      return { data: [], page: q.page, pageSize: q.pageSize, total: 0, unmappedTotal };
    }

    const cardIds = [...new Set(grouped.map((g) => g.cardId))];
    const cards = await this.prisma.card.findMany({
      where: { id: { in: cardIds } },
      select: { id: true, setId: true },
    });
    const setIdByCard = new Map(cards.map((c) => [c.id, c.setId]));
    const sets = await this.prisma.cardSet.findMany({
      where: {
        id: { in: [...new Set(cards.map((c) => c.setId))] },
        ...(q.q ? { name: { contains: q.q, mode: 'insensitive' as const } } : {}),
      },
      select: { id: true, name: true, series: true, releaseDate: true },
    });
    const setById = new Map(sets.map((s) => [s.id, s]));

    // Mercado del sellado en UN lote (clave sealed:tcg:<productId>, solo pares mapeados).
    const mappedPairs = [
      ...new Map(
        grouped
          .filter((g) => g.tcgplayerProductId != null)
          .map((g) => [`${g.cardId}|${g.tcgplayerProductId}`, g] as const),
      ).values(),
    ];
    const refs = await this.pricing.getReferencesBatch(
      mappedPairs.map((g) => ({
        cardId: g.cardId,
        productType: 'sealed' as ProductType,
        gradeKey: sealedMarketGradeKey(g.tcgplayerProductId as number),
        finish: 'normal' as Finish,
      })),
    );

    const bySet = new Map<
      string,
      { pieceCount: number; listedCount: number; unmappedCount: number; value: number; anyValued: boolean }
    >();
    for (const g of grouped) {
      const setId = setIdByCard.get(g.cardId);
      if (!setId || !setById.has(setId)) continue; // set filtrado por `q` (o carta huérfana)
      let agg = bySet.get(setId);
      if (!agg) {
        agg = { pieceCount: 0, listedCount: 0, unmappedCount: 0, value: 0, anyValued: false };
        bySet.set(setId, agg);
      }
      const count = g._count._all;
      agg.pieceCount += count;
      if (g.status === 'listed') agg.listedCount += count;
      const ref =
        g.tcgplayerProductId != null
          ? refs.get(`${g.cardId}|sealed|${sealedMarketGradeKey(g.tcgplayerProductId)}|normal`)
          : undefined;
      const cents =
        ref && ref.status === 'priced' && ref.referenceMxnCents != null ? ref.referenceMxnCents : null;
      if (cents != null) {
        agg.value += cents * count;
        agg.anyValued = true;
      } else {
        // "Sin mercado" = no mapeada O mapeada sin ingest (contrato §M1: se excluye y se cuenta).
        agg.unmappedCount += count;
      }
    }

    const rows: SealedSetSummaryDTO[] = [...bySet.entries()].map(([setId, agg]) => ({
      set: toSetRef(setById.get(setId)!),
      pieceCount: agg.pieceCount,
      listedCount: agg.listedCount,
      unmappedCount: agg.unmappedCount,
      marketValueMxnCents: agg.anyValued ? agg.value : null,
    }));
    // Orden por lanzamiento desc (default del índice Master Set — misma convención de pestaña).
    rows.sort((a, b) => (b.set.releaseDate ?? '').localeCompare(a.set.releaseDate ?? ''));
    const total = rows.length;
    const start = (q.page - 1) * q.pageSize;
    return {
      data: rows.slice(start, start + q.pageSize),
      page: q.page,
      pageSize: q.pageSize,
      total,
      unmappedTotal,
    };
  }

  /**
   * GET /admin/inventory/sealed-sets/:setId — grupos de producto sellado del set (identidad
   * §4.23). `sealedMarketRef` solo `priced` (null si no mapeado o sin ingest); `totalCostCents`
   * = Σ costo de adquisición de las piezas del grupo (`null` si ninguna tiene costo capturado).
   * El drill-down a folios es `GET /admin/inventory/items?cardId=&productType=sealed` (P-17).
   */
  async sealedSetDetail(setId: string): Promise<SealedSetDetailResponse> {
    const set = await this.prisma.cardSet.findUnique({
      where: { id: setId },
      select: { id: true, name: true, series: true, releaseDate: true },
    });
    if (!set) throw BusinessException.notFound('NOT_FOUND', 'CardSet not found');

    const grouped = await this.prisma.inventoryItem.groupBy({
      // BLOQ-2 (fix H-P38-1): `sealedProductName`/`sealedImageUrl` entran al groupBy para traer el
      // snapshot de display por identidad SIN N+1. Las filas se re-colapsan por la identidad §4.23
      // (los 4 campos de abajo), así que sumar los conteos mantiene los totales exactos.
      by: [
        'cardId',
        'sealedSubtype',
        'tcgplayerProductId',
        'sealedCondition',
        'status',
        'sealedProductName',
        'sealedImageUrl',
      ],
      where: { ...this.sealedScope(), card: { setId } },
      _count: { _all: true, acquisitionCostCents: true },
      _sum: { acquisitionCostCents: true },
    });

    // Combina las filas por-status en UNA entrada por identidad de grupo (§4.23).
    type GroupAgg = {
      cardId: string;
      sealedSubtype: string | null;
      sealedCondition: SealedCondition;
      tcgplayerProductId: number | null;
      // BLOQ-2: snapshot de display representativo del grupo (primer no-nulo visto). Consistente por
      // identidad porque se deriva del mismo SealedProduct/mapeo al alta.
      sealedProductName: string | null;
      sealedImageUrl: string | null;
      inStock: number;
      listed: number;
      other: number;
      costSum: number;
      costCount: number;
    };
    const byIdentity = new Map<string, GroupAgg>();
    for (const g of grouped) {
      const key = `${g.cardId}|${g.sealedSubtype ?? ''}|${g.tcgplayerProductId ?? ''}|${g.sealedCondition ?? 'mint'}`;
      let agg = byIdentity.get(key);
      if (!agg) {
        agg = {
          cardId: g.cardId,
          sealedSubtype: g.sealedSubtype,
          // sealedCondition es NOT NULL para sealed desde M-28 (default mint); el ?? es defensivo.
          sealedCondition: (g.sealedCondition ?? 'mint') as SealedCondition,
          tcgplayerProductId: g.tcgplayerProductId,
          sealedProductName: null,
          sealedImageUrl: null,
          inStock: 0,
          listed: 0,
          other: 0,
          costSum: 0,
          costCount: 0,
        };
        byIdentity.set(key, agg);
      }
      // Primer snapshot no-nulo del grupo (display-only; no toca conteos ni dinero).
      if (agg.sealedProductName == null && g.sealedProductName != null) {
        agg.sealedProductName = g.sealedProductName;
      }
      if (agg.sealedImageUrl == null && g.sealedImageUrl != null) {
        agg.sealedImageUrl = g.sealedImageUrl;
      }
      const count = g._count._all;
      if (g.status === 'in_stock') agg.inStock += count;
      else if (g.status === 'listed') agg.listed += count;
      else agg.other += count;
      agg.costSum += g._sum.acquisitionCostCents ?? 0;
      agg.costCount += g._count.acquisitionCostCents;
    }

    const cardIds = [...new Set([...byIdentity.values()].map((a) => a.cardId))];
    const cards = cardIds.length
      ? await this.prisma.card.findMany({
          where: { id: { in: cardIds } },
          // BLOQ-2: `imageSmallUrl` para el fallback de imagen de la cascada de display.
          select: { id: true, name: true, imageSmallUrl: true },
        })
      : [];
    const cardById = new Map(cards.map((c) => [c.id, c]));

    const mapped = [...byIdentity.values()].filter((a) => a.tcgplayerProductId != null);
    const refs = await this.pricing.getReferencesBatch(
      mapped.map((a) => ({
        cardId: a.cardId,
        productType: 'sealed' as ProductType,
        gradeKey: sealedMarketGradeKey(a.tcgplayerProductId as number),
        finish: 'normal' as Finish,
      })),
    );

    const groups: SealedInventoryGroupDTO[] = [...byIdentity.values()].map((a) => {
      const ref =
        a.tcgplayerProductId != null
          ? refs.get(`${a.cardId}|sealed|${sealedMarketGradeKey(a.tcgplayerProductId)}|normal`)
          : undefined;
      const card = cardById.get(a.cardId);
      return {
        cardId: a.cardId,
        // BLOQ-2 (cascada §4.34a): snapshot del sellado → nombre/imagen de la Card ancla. MISMO patrón
        // exacto que sealed-catalog.service.ts / vault.service.ts (`sealedProductName ?? card.name`).
        productName: a.sealedProductName ?? card?.name ?? '',
        imageSmallUrl: a.sealedImageUrl ?? card?.imageSmallUrl ?? null,
        sealedSubtype: a.sealedSubtype,
        sealedCondition: a.sealedCondition,
        tcgplayerProductId: a.tcgplayerProductId,
        mapped: a.tcgplayerProductId != null,
        counts: { inStock: a.inStock, listed: a.listed, other: a.other },
        // Contrato §M1 (paridad v1.19): null si no mapeado o sin ingest (pending NO se expone).
        sealedMarketRef: ref && ref.status === 'priced' ? ref : null,
        totalCostCents: a.costCount > 0 ? a.costSum : null,
      };
    });
    groups.sort(
      (x, y) =>
        x.productName.localeCompare(y.productName) ||
        (x.sealedSubtype ?? '').localeCompare(y.sealedSubtype ?? '') ||
        x.sealedCondition.localeCompare(y.sealedCondition) ||
        (x.tcgplayerProductId ?? 0) - (y.tcgplayerProductId ?? 0),
    );

    return { set: toSetRef(set), groups };
  }

  /**
   * GET /admin/inventory/graded — pestaña «Gradeadas»: inventario PSA/CGC SEPARADO de sueltas,
   * agregado por `(cardId, gradingCompany, gradeValue)`. `marketReferenceMxnCents` = la
   * `PriceReference` vigente de `(cardId, 'graded', 'graded:<company>:<grade>', 'normal')`
   * (típicamente el override MANUAL de M2, decisión v1.28 — sin proveedor automático por grado),
   * FX-recompute vía `getReferencesBatch`; `null` honesto si no hay. Drill-down a certs/folios =
   * `items?cardId=&productType=graded` (P-17).
   */
  async gradedIndex(q: { q?: string; page: number; pageSize: number }): Promise<GradedIndexResponse> {
    const grouped = await this.prisma.inventoryItem.groupBy({
      by: ['cardId', 'gradingCompany', 'gradeValue'],
      where: {
        productType: 'graded' as ProductType,
        ownerType: 'platform',
        status: { notIn: NOT_ON_HAND },
        ...(q.q ? { card: { name: { contains: q.q, mode: 'insensitive' as const } } } : {}),
      },
      _count: { _all: true, acquisitionCostCents: true },
      _sum: { acquisitionCostCents: true },
    });
    if (grouped.length === 0) {
      return { data: [], page: q.page, pageSize: q.pageSize, total: 0 };
    }

    const cardIds = [...new Set(grouped.map((g) => g.cardId))];
    const cards = await this.prisma.card.findMany({
      where: { id: { in: cardIds } },
      select: { id: true, name: true, number: true, imageSmallUrl: true, set: { select: { name: true } } },
    });
    const cardById = new Map(cards.map((c) => [c.id, c]));

    // Referencia por grado en UN lote (misma clave que fija el override manual §M2 P-20).
    const gradeKeyOf = (g: { gradingCompany: GradingCompany | null; gradeValue: string | null }) =>
      this.pricing.gradeKeyFor({
        productType: 'graded' as ProductType,
        gradingCompany: g.gradingCompany,
        gradeValue: g.gradeValue,
      });
    const refs = await this.pricing.getReferencesBatch(
      grouped.map((g) => ({
        cardId: g.cardId,
        productType: 'graded' as ProductType,
        gradeKey: gradeKeyOf(g),
        finish: 'normal' as Finish,
      })),
    );

    const rows: GradedInventoryGroupDTO[] = grouped.map((g) => {
      const card = cardById.get(g.cardId);
      const ref = refs.get(`${g.cardId}|graded|${gradeKeyOf(g)}|normal`);
      const priced = ref && ref.status === 'priced' && ref.referenceMxnCents != null;
      return {
        cardId: g.cardId,
        card: {
          name: card?.name ?? '',
          number: card?.number ?? '',
          setName: card?.set?.name ?? '',
          ...(card?.imageSmallUrl ? { imageSmallUrl: card.imageSmallUrl } : {}),
        },
        // El alta exige compañía+grado (validateProductShape); los ?? son defensivos para legacy.
        gradingCompany: (g.gradingCompany ?? 'PSA') as GradingCompany,
        gradeValue: g.gradeValue ?? '',
        count: g._count._all,
        marketReferenceMxnCents: priced ? (ref.referenceMxnCents as number) : null,
        ...(priced && ref.capturedDate != null ? { capturedDate: ref.capturedDate } : {}),
        totalCostCents: g._count.acquisitionCostCents > 0 ? (g._sum.acquisitionCostCents ?? 0) : null,
      };
    });
    // Orden estable: carta (nombre, número), compañía y GRADO DESC (numérico cuando aplica —
    // PSA 10 antes que PSA 9).
    const gradeNum = (v: string) => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
    };
    rows.sort(
      (x, y) =>
        x.card.name.localeCompare(y.card.name) ||
        x.card.number.localeCompare(y.card.number) ||
        x.gradingCompany.localeCompare(y.gradingCompany) ||
        gradeNum(y.gradeValue) - gradeNum(x.gradeValue) ||
        x.gradeValue.localeCompare(y.gradeValue),
    );

    const total = rows.length;
    const start = (q.page - 1) * q.pageSize;
    return { data: rows.slice(start, start + q.pageSize), page: q.page, pageSize: q.pageSize, total };
  }
}

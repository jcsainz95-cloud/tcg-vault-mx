import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Role, SealedSubtype } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { IvaDials, saleDisplayCentsOf, taxBaseCentsOf } from '../../common/money';
import { PriceInfo, PricingService } from '../pricing/pricing.service';
import { sealedMarketGradeKey } from '../pricing/pricing.types';
import { variantKey } from '../../common/variant-key';
import { SettingsService } from '../settings/settings.service';
import { InventoryService } from './inventory.service';
import { SetRefDTO } from './master-set.service';
import { canSetSealedSalePrice } from './sealed-price.policy';
import { SEALED_PIECE_STATUSES, SealedProductPieces, sealedProductPiecesOf } from './sealed-product-pieces';

/**
 * 💰 v1.83 / v1.83.1 — `API_CONTRACT §M11-SP.2`, `§M11-SP.5` y `§M11-SP.12` (manda donde choque). Porqué:
 * `ARCHITECTURE §4.62` / `§4.62.8`. Decisiones del dueño: `HECHOS.md` filas «Precio del sellado» (2026-10-05).
 *
 * Dos verbos:
 *  - `GET /admin/inventory/sealed-price-sheet` — la hoja de M11 (una fila por producto, costo, automático de
 *    respaldo, lo que paga el cliente, margen informativo sobre el neto fiscal). `vault_operator+`.
 *  - `PUT /admin/inventory/sealed-products/:id/sale-price` — el dueño escribe `P` (IVA dentro) y se edita sin retirar:
 *    CAS sobre el precio mostrado, bitácora y cierre de la cola en la MISMA tx, y DESPUÉS del commit la
 *    auto-publicación best-effort (`reevaluateForPublication`).
 *
 * ⛔ Este servicio **no escribe `InventoryItem`** dentro de su transacción (SP.2 / §4.62.4: no compite con la reserva
 * del checkout). ⛔ No tiene fórmula de precio propia: el automático sale de `resolveSealedSalePrice`, `P` de
 * `saleDisplayCentsOf`, el neto de `taxBaseCentsOf`.
 */

/** §M11-SP.12.6 — cuentas de `PublishReevaluationResult.outcome` tras el `PUT`. */
export interface SealedAutoPublishDTO {
  published: number;
  missingLocation: number;
  notPublished: number;
}

/** §M11-SP.5 + §M11-SP.12.4 — una fila de la hoja. */
export interface SealedPriceSheetRowDTO {
  sealedProductId: string;
  name: string;
  subtype: SealedSubtype;
  imageUrl: string | null;
  active: boolean;
  set: SetRefDTO;
  pieces: SealedProductPieces;
  cost: { avgCents: number | null; minCents: number | null; maxCents: number | null; withoutCost: number };
  ownerDisplayPriceCents: number | null;
  automaticListPriceCents: number | null;
  automaticDisplayPriceCents: number | null;
  automaticSource: 'subtype_spread' | 'global_spread' | null;
  appliedSpreadPct: number | null;
  effectiveOrigin: 'product' | 'automatic' | 'pending';
  displayPriceCents: number | null;
  netPriceCents: number | null;
  market: PriceInfo | null;
  legacyPiecePrices: {
    count: number;
    minDisplayCents: number | null;
    maxDisplayCents: number | null;
    shadowed: boolean;
  };
  margin: { cents: number; bps: number } | null;
}

export interface SealedPriceSheetResponse {
  data: SealedPriceSheetRowDTO[];
  page: number;
  pageSize: number;
  total: number;
  unlinkedCount: number;
  canEdit: boolean;
  iva: { ratePct: number; transferPct: number };
}

/** §M11-SP.5 (clase L, default `on_hand`). Se exporta para el registro de `C-EQ-1`. */
export const SEALED_PRICE_SHEET_SCOPE_VALUES = ['on_hand', 'all'] as const;
export type SealedPriceSheetScope = (typeof SEALED_PRICE_SHEET_SCOPE_VALUES)[number];

type Actor = { id?: string; role?: Role | string | null } | null | undefined;

const PRODUCT_SELECT = {
  id: true,
  name: true,
  subtype: true,
  imageUrl: true,
  active: true,
  setId: true,
  tcgplayerProductId: true,
  ownerDisplayPriceCents: true,
  set: { select: { id: true, name: true, series: true, releaseDate: true } },
} as const;
type ProductRow = Prisma.SealedProductGetPayload<{ select: typeof PRODUCT_SELECT }>;

/** Filtro de piezas que cuentan para la hoja: plataforma, ligadas, en existencia (= `pieces`). */
function piecesWhere(ids: string[]): Prisma.InventoryItemWhereInput {
  return { sealedProductId: { in: ids }, ownerType: 'platform', status: { in: [...SEALED_PIECE_STATUSES] } };
}

/**
 * 💰 Margen informativo (§M11-SP.12.3): sobre el **neto fiscal** `N = taxBaseCentsOf(P, r)`, ⛔ no sobre `L` ni sobre
 * `P`. `cents = N − avg`, `bps = round(cents·10000/N)`; `null` sin `P` o sin costo. ⛔ Nunca decide nada.
 */
export function sealedMarginOf(
  displayCents: number | null,
  avgCostCents: number | null,
  ivaRatePct: number,
): { netCents: number | null; margin: { cents: number; bps: number } | null } {
  if (displayCents == null) return { netCents: null, margin: null };
  const net = taxBaseCentsOf(displayCents, ivaRatePct);
  if (avgCostCents == null || net <= 0) return { netCents: net, margin: null };
  const cents = net - avgCostCents;
  return { netCents: net, margin: { cents, bps: Math.round((cents * 10_000) / net) } };
}

@Injectable()
export class SealedPriceService {
  private readonly logger = new Logger(SealedPriceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly settings: SettingsService,
    private readonly inventory: InventoryService,
  ) {}

  // =============================================================== GET …/sealed-price-sheet

  async priceSheet(
    q: { setId?: string; q?: string; scope: SealedPriceSheetScope; page: number; pageSize: number },
    actor: Actor,
  ): Promise<SealedPriceSheetResponse> {
    const onHand: Prisma.SealedProductWhereInput = {
      inventoryItems: { some: { ownerType: 'platform', status: { in: [...SEALED_PIECE_STATUSES] } } },
    };
    const where: Prisma.SealedProductWhereInput = {
      ...(q.setId ? { setId: q.setId } : {}),
      ...(q.q && q.q.trim() !== '' ? { name: { contains: q.q.trim(), mode: 'insensitive' } } : {}),
      // `on_hand`: ≥ 1 pieza de plataforma ligada en existencia. `all`: además, los que solo tienen precio del dueño.
      ...(q.scope === 'all' ? { OR: [onHand, { ownerDisplayPriceCents: { not: null } }] } : onHand),
    };
    const [products, total, unlinkedCount, dials] = await Promise.all([
      this.prisma.sealedProduct.findMany({
        where,
        select: PRODUCT_SELECT,
        orderBy: [{ set: { name: 'asc' } }, { name: 'asc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.sealedProduct.count({ where }),
      // P-79 (d): piezas selladas de plataforma en existencia SIN producto (no entran a ninguna fila).
      this.prisma.inventoryItem.count({
        where: {
          productType: 'sealed',
          ownerType: 'platform',
          status: { in: [...SEALED_PIECE_STATUSES] },
          sealedProductId: null,
        },
      }),
      this.settings.getIvaDials(),
    ]);
    const data = await this.rowsOf(products, dials);
    return {
      data,
      page: q.page,
      pageSize: q.pageSize,
      total,
      unlinkedCount,
      canEdit: canSetSealedSalePrice(actor),
      iva: { ratePct: dials.ivaRatePct, transferPct: dials.ivaTransferPct },
    };
  }

  /**
   * Las filas de una página — consultas **constantes** (SP-10): un `groupBy` de piezas, uno de costos, uno de legado,
   * uno de cartas ancla, (a lo más) uno de anclas de set, un lote de referencias, un `loadSealedSpreads`. Los diales
   * llegan izados.
   */
  private async rowsOf(products: ProductRow[], dials: IvaDials): Promise<SealedPriceSheetRowDTO[]> {
    if (products.length === 0) return [];
    const ids = products.map((p) => p.id);
    const [pieces, costRows, legacyRows, anchorRows, sealedCtx] = await Promise.all([
      sealedProductPiecesOf(this.prisma, ids),
      this.prisma.inventoryItem.groupBy({
        by: ['sealedProductId'],
        where: piecesWhere(ids),
        _avg: { acquisitionCostCents: true },
        _min: { acquisitionCostCents: true },
        _max: { acquisitionCostCents: true },
        _count: { _all: true, acquisitionCostCents: true },
      }),
      // Peldaño 2 (legado): piezas con `listPriceCents > 0` (H-1) entre las mismas piezas de `pieces`.
      this.prisma.inventoryItem.groupBy({
        by: ['sealedProductId'],
        where: { ...piecesWhere(ids), listPriceCents: { gt: 0 } },
        _min: { listPriceCents: true },
        _max: { listPriceCents: true },
        _count: { _all: true },
      }),
      // La carta bajo la que vive la referencia de mercado del producto: la de una pieza ligada (la misma clave que
      // lee esa pieza en `GET …/items`); sin piezas, el ancla del set (abajo), como `sealed-price-ingest`.
      this.prisma.inventoryItem.findMany({
        where: { sealedProductId: { in: ids } },
        distinct: ['sealedProductId'],
        orderBy: [{ sealedProductId: 'asc' }, { createdAt: 'asc' }],
        select: { sealedProductId: true, cardId: true },
      }),
      this.pricing.loadSealedSpreads(),
    ]);
    const costBy = new Map(costRows.map((r) => [r.sealedProductId as string, r]));
    const legacyBy = new Map(legacyRows.map((r) => [r.sealedProductId as string, r]));
    const cardBy = new Map(anchorRows.map((r) => [r.sealedProductId as string, r.cardId]));
    const setsWithoutPiece = [...new Set(products.filter((p) => !cardBy.has(p.id)).map((p) => p.setId))];
    const setAnchor = new Map<string, string>();
    if (setsWithoutPiece.length > 0) {
      const anchors = await this.prisma.card.findMany({
        where: { setId: { in: setsWithoutPiece } },
        distinct: ['setId'],
        orderBy: [{ setId: 'asc' }, { numberPrefix: 'asc' }, { numberSort: 'asc' }],
        select: { id: true, setId: true },
      });
      for (const a of anchors) setAnchor.set(a.setId, a.id);
    }
    const cardOf = (p: ProductRow): string | null => cardBy.get(p.id) ?? setAnchor.get(p.setId) ?? null;
    const refKeyOf = (p: ProductRow, cardId: string) => ({
      cardId,
      productType: 'sealed' as const,
      gradeKey: sealedMarketGradeKey(p.tcgplayerProductId),
      finish: 'normal' as const,
    });
    const refs = await this.pricing.getReferencesBatch(
      products.flatMap((p) => {
        const c = cardOf(p);
        return c ? [refKeyOf(p, c)] : [];
      }),
    );

    return products.map((p) => {
      const c = cardOf(p);
      const ref = c ? refs.get(variantKey(refKeyOf(p, c))) : undefined;
      // Automático (peldaño 3) SIEMPRE calculado, con los peldaños 1–2 ausentes: el MISMO resolvedor (mismo `ctx`:
      // spreads y dial `sourceOn`). ⛔ Ninguna fórmula propia.
      const auto = this.pricing.resolveSealedSalePrice(
        { productType: 'sealed', listPriceCents: null, sealedProduct: null, sealedSubtype: p.subtype },
        ref,
        sealedCtx,
        dials,
      );
      const automaticList = auto.salePriceCents;
      const automaticDisplay =
        automaticList == null ? null : saleDisplayCentsOf({ listPriceCents: automaticList, fixedDisplayCents: null }, dials);
      const owner = p.ownerDisplayPriceCents;
      const display = owner ?? automaticDisplay;
      const cost = costBy.get(p.id);
      const avg = cost?._avg.acquisitionCostCents;
      const avgCents = avg == null ? null : Math.round(avg);
      const withCost = cost?._count.acquisitionCostCents ?? 0;
      const { netCents, margin } = sealedMarginOf(display, avgCents, dials.ivaRatePct);
      const legacy = legacyBy.get(p.id);
      const legacyDisplay = (l: number | null | undefined) =>
        l == null ? null : saleDisplayCentsOf({ listPriceCents: l, fixedDisplayCents: null }, dials);
      return {
        sealedProductId: p.id,
        name: p.name,
        subtype: p.subtype,
        imageUrl: p.imageUrl,
        active: p.active,
        set: {
          id: p.set.id,
          name: p.set.name,
          series: p.set.series ?? undefined,
          releaseDate: p.set.releaseDate ?? undefined,
        },
        pieces: pieces.get(p.id) ?? { inStock: 0, listed: 0, reserved: 0 },
        cost: {
          avgCents,
          minCents: cost?._min.acquisitionCostCents ?? null,
          maxCents: cost?._max.acquisitionCostCents ?? null,
          withoutCost: (cost?._count._all ?? 0) - withCost,
        },
        ownerDisplayPriceCents: owner,
        automaticListPriceCents: automaticList,
        automaticDisplayPriceCents: automaticDisplay,
        // `null ⇔ automaticListPriceCents null` (y `appliedSpreadPct` con él, §M11-SP.12.4).
        automaticSource: automaticList == null ? null : (auto.source as 'subtype_spread' | 'global_spread'),
        appliedSpreadPct: automaticList == null ? null : auto.appliedSpreadPct,
        effectiveOrigin: owner != null ? 'product' : automaticList != null ? 'automatic' : 'pending',
        displayPriceCents: display,
        netPriceCents: netCents,
        // Referencia (`sealedMarketRef`, misma regla que el listado de M1): ⛔ no es precio.
        market: ref && ref.status === 'priced' ? ref : null,
        legacyPiecePrices: {
          count: legacy?._count._all ?? 0,
          minDisplayCents: legacyDisplay(legacy?._min.listPriceCents),
          maxDisplayCents: legacyDisplay(legacy?._max.listPriceCents),
          shadowed: owner != null,
        },
        margin,
      };
    });
  }

  // ========================================== PUT …/sealed-products/:id/sale-price

  async setSalePrice(
    sealedProductId: string,
    body: { displayPriceCents: number; expectedDisplayPriceCents: number | null },
    actor: Actor,
  ): Promise<{ data: SealedPriceSheetRowDTO; autoPublish: SealedAutoPublishDTO | null }> {
    // SP.3: el predicado único (además del `@Roles` de método del controlador).
    if (!canSetSealedSalePrice(actor)) {
      throw BusinessException.forbidden('FORBIDDEN', 'Only the owner sets the sale price of sealed products');
    }
    // Los diales con que se reconstruye el `L` equivalente del momento (van a la bitácora). Se leen JUSTO antes de
    // la tx y no dentro: `getIvaDials` usa su propio handle y dentro pediría una segunda conexión (I1). Ver
    // BACKEND_NOTES §57.
    const dials = await this.settings.getIvaDials();
    await this.prisma.$transaction(async (tx) => {
      // 1. El producto. `active=false` SÍ admite precio (sus piezas existen).
      const sp = await tx.sealedProduct.findUnique({
        where: { id: sealedProductId },
        select: { id: true, ownerDisplayPriceCents: true },
      });
      if (!sp) throw BusinessException.notFound('NOT_FOUND', 'Sealed product not found');
      const current = sp.ownerDisplayPriceCents;
      // 2. Doble clic idempotente: nada que escribir.
      if (body.displayPriceCents === current && body.expectedDisplayPriceCents === current) return;
      // 3. CAS sobre el precio que la pantalla mostró.
      const cas = await tx.sealedProduct.updateMany({
        where: { id: sealedProductId, ownerDisplayPriceCents: body.expectedDisplayPriceCents },
        data: { ownerDisplayPriceCents: body.displayPriceCents },
      });
      if (cas.count !== 1) {
        const now = await tx.sealedProduct.findUnique({
          where: { id: sealedProductId },
          select: { ownerDisplayPriceCents: true },
        });
        throw BusinessException.conflict(
          'CONFLICT',
          'The sale price of this product changed since it was shown',
          { currentDisplayPriceCents: now?.ownerDisplayPriceCents ?? null },
        );
      }
      // 4. Bitácora en la MISMA tx (si falla, no hay precio). `pieces` = las piezas de plataforma ligadas cuyo precio
      //    cambia con esto, contadas en la tx (la misma agregación que la hoja).
      const pieces = (await sealedProductPiecesOf(tx, [sealedProductId])).get(sealedProductId) as SealedProductPieces;
      await tx.auditLog.create({
        data: {
          actorUserId: actor?.id ?? null,
          actorRole: (actor?.role as Role | undefined) ?? null,
          action: 'sealed_product.sale_price_set',
          entityType: 'SealedProduct',
          entityId: sealedProductId,
          before: { ownerDisplayPriceCents: current } as Prisma.InputJsonValue,
          after: {
            ownerDisplayPriceCents: body.displayPriceCents,
            pieces: { ...pieces },
            ivaDials: { ivaTransferPct: dials.ivaTransferPct, ivaRatePct: dials.ivaRatePct },
          } as unknown as Prisma.InputJsonValue,
        },
      });
      // 5. Cola de precio pendiente de ESTE producto (`context='inventory'`), por el método de `pricing` (VQ-5).
      await this.pricing.closeSealedProductSaleQueue(tx, sealedProductId);
    });

    // 💰 §M11-SP.12.6 (A-2): DESPUÉS del commit, best-effort — el precio ya es la decisión del dueño y que una pieza
    // no se pueda publicar no lo deshace. El MISMO cuerpo (`reevaluateForPublication`), llamada directa.
    const autoPublish = await this.autoPublishAfterPrice(sealedProductId);

    // La fila se relee DESPUÉS del intento.
    const product = await this.prisma.sealedProduct.findUnique({
      where: { id: sealedProductId },
      select: PRODUCT_SELECT,
    });
    // D-8 (gate de techlead): si el producto desapareció entre el commit y la relectura, `404` explícito — nunca un
    // `200` con `data: undefined`. El precio YA quedó confirmado (y su bitácora); lo que no hay es fila que devolver.
    if (!product) throw BusinessException.notFound('NOT_FOUND', 'Sealed product not found');
    const [data] = await this.rowsOf([product], await this.settings.getIvaDials());
    return { data, autoPublish };
  }

  /** `null` ⇔ el intento lanzó (se registra); si no, las cuentas de `outcome`. */
  private async autoPublishAfterPrice(sealedProductId: string): Promise<SealedAutoPublishDTO | null> {
    try {
      const ids = (
        await this.prisma.inventoryItem.findMany({
          where: { sealedProductId, ownerType: 'platform', status: 'in_stock' },
          select: { id: true },
        })
      ).map((r) => r.id);
      const results = await this.inventory.reevaluateForPublication(ids);
      const out: SealedAutoPublishDTO = { published: 0, missingLocation: 0, notPublished: 0 };
      for (const r of results) {
        if (r.outcome === 'published') out.published++;
        else if (r.outcome === 'missing_location') out.missingLocation++;
        else out.notPublished++;
      }
      return out;
    } catch (e) {
      this.logger.error(
        `sale-price ${sealedProductId}: auto-publicación falló (el precio YA está confirmado; las piezas siguen en «Listas para publicar»): ${(e as Error).message}`,
      );
      return null;
    }
  }
}

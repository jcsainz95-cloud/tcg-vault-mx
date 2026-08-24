import { Injectable } from '@nestjs/common';
import { Card, CardSet, InventoryItem, Prisma, SealedCondition, SealedSubtype } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService, PriceInfo, toPublicPriceInfo } from '../pricing/pricing.service';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { BusinessException } from '../../common/business.exception';
import { PriceBasis, SealedSpreadSource, sealedPriceBasisOf } from '../../common/money';
import { sealedMarketGradeKey } from '../pricing/pricing.types';
import { CatalogService, toCardDTO } from './catalog.service';
import { SEALED_CONDITION_VALUES, SEALED_SUBTYPE_VALUES } from '../../common/enum-values';

// v2.1.8: DERIVADOS del schema (`common/enum-values.ts`) — ver por qué ahí.
const SEALED_CONDITIONS = new Set<string>(SEALED_CONDITION_VALUES);
const SEALED_SUBTYPES = new Set<string>(SEALED_SUBTYPE_VALUES);
const RANGES = ['5d', '15d', '1m', '3m', '6m', '1y', 'ytd', 'all'];

type ItemWithCard = InventoryItem & { card: Card & { set?: CardSet | null } };

/**
 * `SealedGroupDTO` del contrato (§DTOs), **declarado como tipo a propósito** (v2.1.7).
 *
 * El DTO se construía como un objeto literal sin tipo, así que **omitir un campo requerido no era un
 * error de compilación**: se emitió sin `priceBasis` ni `currency` y ningún test lo vio (los mocks
 * los horneaban). Declararlo convierte esa clase de fallo en un error de `tsc` — el candado más
 * barato que existe para un contrato.
 */
/**
 * v2.1.9 (D2, contrato §DTOs `SealedGroupSummaryDTO`) — **el DTO de la REJILLA de sellado:
 * `SealedGroupDTO` MENOS las TRES señales de precio.**
 *
 * Se van `priceBasis`, `referenceValue` y —esto es lo que se pasa por alto— **`priceSource`**: en
 * sellado `priceBasis` se DERIVA de `priceSource` (`override ⇒ override`; `*_spread ⇒ market`), así
 * que dejarlo publicaría **la misma señal con otro nombre**. Es exactamente el error que v2.1.6
 * documentó al retirar `isManualOverride` y descubrir que `source` filtraba igual.
 *
 * Misma razón y mismas garantías que `GroupedListingSummaryDTO` (ver su bloque en `catalog.service`):
 * §N.7 dice «SOLO fichas», nadie lo consume en la rejilla, y **tipo propio** en vez de campos
 * opcionales para que el compilador —y no un test— sostenga la diferencia.
 */
export interface SealedGroupSummaryDTO {
  representativeItemId: string;
  card: ReturnType<typeof toCardDTO>;
  productName: string;
  imageUrl: string | null;
  sealedSubtype: SealedSubtype | null;
  sealedCondition: SealedCondition;
  availableCount: number;
  fromPriceCents: number;
  currency: 'MXN';
}

export interface SealedGroupDTO {
  representativeItemId: string;
  card: ReturnType<typeof toCardDTO>;
  productName: string;
  imageUrl: string | null;
  sealedSubtype: SealedSubtype | null;
  sealedCondition: SealedCondition;
  availableCount: number;
  fromPriceCents: number;
  /** Detalle PROPIO del sellado: qué spread aplicó. Se conserva además de `priceBasis`. */
  priceSource: SealedSpreadSource;
  /**
   * v2.0 (P-48) — DERIVADO de `priceSource`, para que el front tenga UNA sola regla de visibilidad
   * para las dos fichas, sin ramas por tipo de producto (§N.7).
   */
  priceBasis: PriceBasis;
  referenceValue: PriceInfo;
  currency: 'MXN';
}

/** Una pieza sellada con su precio de venta YA resuelto (SEC-A1) y su referencia de mercado cruda. */
interface PricedSealed {
  item: ItemWithCard;
  salePriceCents: number;
  source: SealedSpreadSource;
  /**
   * v2.0 (P-48) — se deriva AQUÍ, donde vive el `SealedSpreadResult` completo, y no en el builder del
   * DTO: reconstruirlo desde `source` sería un segundo cuerpo de la misma regla.
   */
  priceBasis: PriceBasis;
  /** Referencia de mercado TCGCSV cruda (para el lote/ficha); undefined si no mapeado. */
  marketRef?: PriceInfo;
}

/**
 * SealedCatalogService (v1.23-sealed-sales, ARCHITECTURE §4.23e/§4.23h / API_CONTRACT §2-S) —
 * ventana de tienda del PRODUCTO CERRADO: grid AGREGADO por producto+condición («N disponibles»),
 * ficha con todas las piezas del grupo, y dos endpoints FEATURE-FLAGGED (tendencia de valor y
 * «avísame cuando vuelva»). El precio se resuelve server-side por precedencia money-safe
 * (override > mercado×spread > PRICE_PENDING) reusando `computeSealedSalePrice`. Sin N+1: 1 query de
 * piezas + 1 lote de referencias + agrupación en memoria (patrón `set-value.service`).
 */
@Injectable()
export class SealedCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly settings: SettingsService,
    private readonly catalog: CatalogService,
  ) {}

  // ---------------------------------------------------------------------------
  // Precio del sellado en LOTE — resuelve override/mercado×spread por pieza (money-safe).
  // ---------------------------------------------------------------------------
  private async loadPricedSealed(where: Prisma.InventoryItemWhereInput): Promise<PricedSealed[]> {
    const items = await this.prisma.inventoryItem.findMany({
      where,
      include: { card: { include: { set: true } } },
      orderBy: { createdAt: 'desc' },
    });
    if (items.length === 0) return [];

    const sealed = await this.pricing.loadSealedSpreads();
    // Lote de referencias de MERCADO (`sealed:tcg:<productId>`); un sellado no mapeado no aporta clave.
    const refs = await this.pricing.getReferencesBatch(
      items.flatMap((i) => {
        const gk = this.pricing.sealedMarketGradeKeyForItem(i);
        return gk
          ? [{ cardId: i.cardId, productType: 'sealed' as const, gradeKey: gk, finish: 'normal' as const }]
          : [];
      }),
    );

    const out: PricedSealed[] = [];
    for (const item of items) {
      const gk = this.pricing.sealedMarketGradeKeyForItem(item);
      const ref = gk ? refs.get(`${item.cardId}|sealed|${gk}|normal`) : undefined;
      // H-1 (v1.24): resolver ÚNICO (gate del mercado por dial + pura). Mismo cuerpo que
      // catálogo/Compra/bulk-publish, incluida la regla override=0.
      const sale = this.pricing.resolveSealedSalePrice(item, ref, sealed);
      // Solo grupos con ≥1 pieza vendible (precio resuelto > 0). Money-safe: sin precio no se lista.
      if (sale.salePriceCents == null || sale.salePriceCents <= 0) continue;
      out.push({
        item,
        salePriceCents: sale.salePriceCents,
        source: sale.source,
        priceBasis: sealedPriceBasisOf(sale),
        marketRef: ref,
      });
    }
    return out;
  }

  /** Clave de grupo: mapeado → `p:<productId>:<cond>`; no mapeado → `c:<cardId>:<subtype>:<cond>`. */
  private groupKey(item: InventoryItem): string {
    const cond = item.sealedCondition ?? 'mint';
    if (item.tcgplayerProductId != null) return `p:${item.tcgplayerProductId}:${cond}`;
    return `c:${item.cardId}:${item.sealedSubtype ?? ''}:${cond}`;
  }

  /** Construye el SealedGroupDTO de un grupo (miembros no vacíos). Representante = pieza más barata. */
  private toGroupDTO(members: PricedSealed[]): SealedGroupDTO {
    const sorted = [...members].sort((a, b) => a.salePriceCents - b.salePriceCents);
    const cheapest = sorted[0];
    const item = cheapest.item;
    const referenceValue: PriceInfo =
      cheapest.marketRef && cheapest.marketRef.status === 'priced'
        ? cheapest.marketRef
        : { status: 'pending' };
    return {
      representativeItemId: item.id,
      card: toCardDTO(item.card),
      // H-P38-1 (§4.34a): el display de sellado resuelve en CASCADA la identidad real del `SealedProduct`
      // → snapshot congelado por-pieza (`sealedProductName`/`sealedImageUrl`, M-37) → `Card` ancla. El
      // snapshot es fuente estable y money-safe (solo display; no toca precios); así el grid pinta
      // «… Elite Trainer Box» con su imagen y NO el single ancla («Tropius»).
      productName: item.sealedProductName ?? item.card.name,
      imageUrl: item.sealedImageUrl ?? item.card.imageSmallUrl ?? null,
      sealedSubtype: (item.sealedSubtype ?? null) as SealedSubtype | null,
      sealedCondition: (item.sealedCondition ?? 'mint') as SealedCondition,
      availableCount: members.length,
      fromPriceCents: cheapest.salePriceCents,
      priceSource: cheapest.source,
      // v2.0 (P-48, contrato §DTOs) — REQUERIDO, y se omitía. El sellado NO cambia de matemática
      // (conserva su spread por presentación, §K/§4.23a): solo DERIVA su basis de `priceSource`
      //     override                        ⇒ 'override' ⇒ NO se muestra «Valor de mercado»
      //     subtype_spread | global_spread  ⇒ 'market'   ⇒ SÍ se muestra
      // Sin esto la ficha de sellado sufría el MISMO colapso que la de single: el front compara
      // `priceBasis === 'market'` y con `undefined` la comparación es siempre falsa.
      priceBasis: cheapest.priceBasis,
      // v2.1.6 (S48-M2): superficie ANÓNIMA ⇒ sin `source` (ver `toPublicPriceInfo`).
      // v2.1.9 (D2): y el NÚMERO de mercado viaja si y solo si `priceBasis === 'market'`. Este DTO es
      // el de la FICHA (`SealedGroupDetailResponse.group`); la rejilla usa `toGroupSummaryDTO`.
      referenceValue: toPublicPriceInfo(referenceValue, cheapest.priceBasis),
      // Requerido por el contrato y también se omitía.
      currency: 'MXN',
    };
  }

  /**
   * v2.1.9 (D2) — proyección de REJILLA: el mismo grupo **menos** `priceBasis`, `referenceValue` y
   * `priceSource`. Se construye desde el DTO de ficha (una sola fuente de agrupación y de precio,
   * SEC-A1) por lista blanca; el tipo propio hace que emitir cualquiera de los tres aquí NO COMPILE.
   */
  private toGroupSummaryDTO(members: PricedSealed[]): SealedGroupSummaryDTO {
    const g = this.toGroupDTO(members);
    return {
      representativeItemId: g.representativeItemId,
      card: g.card,
      productName: g.productName,
      imageUrl: g.imageUrl,
      sealedSubtype: g.sealedSubtype,
      sealedCondition: g.sealedCondition,
      availableCount: g.availableCount,
      fromPriceCents: g.fromPriceCents,
      currency: g.currency,
    };
  }

  private validateEnum(field: string, value: string, allowed: Set<string>): string {
    if (!allowed.has(value)) {
      throw BusinessException.badRequest('VALIDATION_ERROR', `Invalid ${field} filter`, {
        field,
        value,
        allowed: [...allowed],
      });
    }
    return value;
  }

  // ---------------------------------------------------------------------------
  // GET /catalog/sealed — grid AGREGADO por producto+condición.
  // ---------------------------------------------------------------------------
  async listSealed(q: {
    setId?: string;
    sealedSubtype?: string;
    condition?: string;
    q?: string;
    page: number;
    pageSize: number;
    sort?: string;
  }) {
    const where: Prisma.InventoryItemWhereInput = {
      productType: 'sealed',
      status: 'listed',
      ownerType: 'platform',
    };
    if (q.sealedSubtype)
      where.sealedSubtype = this.validateEnum('sealedSubtype', q.sealedSubtype, SEALED_SUBTYPES) as never;
    if (q.condition)
      where.sealedCondition = this.validateEnum('condition', q.condition, SEALED_CONDITIONS) as never;
    const cardWhere: Prisma.CardWhereInput = {};
    if (q.setId) cardWhere.setId = q.setId;
    if (q.q) cardWhere.name = { contains: q.q, mode: 'insensitive' };
    if (Object.keys(cardWhere).length) where.card = cardWhere;

    const priced = await this.loadPricedSealed(where);

    // Agrupa en memoria (patrón set-value): una tarjeta por producto+condición.
    const groups = new Map<string, PricedSealed[]>();
    for (const p of priced) {
      const k = this.groupKey(p.item);
      const arr = groups.get(k);
      if (arr) arr.push(p);
      else groups.set(k, [p]);
    }

    // v2.1.9 (D2): la REJILLA emite `SealedGroupSummaryDTO` — sin priceBasis/referenceValue/priceSource.
    const cards = [...groups.values()].map((members) => ({
      dto: this.toGroupSummaryDTO(members),
      newestAt: Math.max(...members.map((m) => m.item.createdAt.getTime())),
    }));

    if (q.sort === 'price_asc') cards.sort((a, b) => a.dto.fromPriceCents - b.dto.fromPriceCents);
    else if (q.sort === 'price_desc') cards.sort((a, b) => b.dto.fromPriceCents - a.dto.fromPriceCents);
    else cards.sort((a, b) => b.newestAt - a.newestAt); // 'newest' (default)

    const total = cards.length;
    const start = (q.page - 1) * q.pageSize;
    const data = cards.slice(start, start + q.pageSize).map((c) => c.dto);
    return { data, page: q.page, pageSize: q.pageSize, total };
  }

  // ---------------------------------------------------------------------------
  // GET /catalog/sealed/:inventoryItemId — ficha (grupo + todas las piezas del grupo).
  // ---------------------------------------------------------------------------
  async sealedDetail(inventoryItemId: string) {
    const rep = await this.prisma.inventoryItem.findFirst({
      where: { id: inventoryItemId, productType: 'sealed', status: 'listed', ownerType: 'platform' },
      include: { card: { include: { set: true } } },
    });
    if (!rep) throw BusinessException.notFound(); // pieza inexistente o no publicada → no visible en Compra

    // Miembros del grupo (mismo producto+condición) publicados y de plataforma.
    const groupWhere: Prisma.InventoryItemWhereInput = {
      productType: 'sealed',
      status: 'listed',
      ownerType: 'platform',
      sealedCondition: rep.sealedCondition,
    };
    if (rep.tcgplayerProductId != null) {
      groupWhere.tcgplayerProductId = rep.tcgplayerProductId;
    } else {
      groupWhere.tcgplayerProductId = null;
      groupWhere.cardId = rep.cardId;
      groupWhere.sealedSubtype = rep.sealedSubtype;
    }
    const priced = await this.loadPricedSealed(groupWhere);
    if (priced.length === 0) throw BusinessException.notFound(); // el grupo no tiene piezas vendibles

    const group = this.toGroupDTO(priced);
    const sealedCtx = await this.pricing.loadSealedSpreads();
    const listings = await Promise.all(
      [...priced]
        .sort((a, b) => a.salePriceCents - b.salePriceCents)
        .map((p) =>
          this.catalog.toListingDTO(p.item, { reference: p.marketRef, sealedSpreads: sealedCtx }),
        ),
    );

    const trendEnabled = (await this.settings.getString(SettingKey.SEALED_VALUE_TREND)) === 'on';
    const restockEnabled = (await this.settings.getString(SettingKey.SEALED_RESTOCK_ALERTS)) === 'on';
    return { group, listings, trendEnabled, restockEnabled };
  }

  // ---------------------------------------------------------------------------
  // GET /catalog/sealed/:inventoryItemId/value-history — FEATURE-FLAGGED sealed_value_trend.
  // ---------------------------------------------------------------------------
  async sealedValueHistory(inventoryItemId: string, range: string) {
    if ((await this.settings.getString(SettingKey.SEALED_VALUE_TREND)) !== 'on') {
      throw BusinessException.notFound('FEATURE_DISABLED', 'sealed value trend is disabled');
    }
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: inventoryItemId, productType: 'sealed' },
      include: { card: { include: { set: true } } },
    });
    // Sin pieza o sin mapeo → sin serie de mercado (los no mapeados no tienen historial TCGCSV).
    if (!item || item.tcgplayerProductId == null) throw BusinessException.notFound();

    const normalizedRange = this.normalizeRange(range);
    const from = this.rangeStart(normalizedRange);
    const rows = await this.prisma.priceReference.findMany({
      where: {
        cardId: item.cardId,
        productType: 'sealed',
        gradeKey: sealedMarketGradeKey(item.tcgplayerProductId),
        finish: 'normal',
        ...(from ? { capturedDate: { gte: from } } : {}),
      },
      orderBy: { capturedDate: 'asc' },
      select: { capturedDate: true, priceMxnCents: true },
    });

    // Un punto por día (dedupe por fecha; con orden asc, la última vista gana).
    const byDate = new Map<string, number>();
    for (const r of rows) byDate.set(r.capturedDate.toISOString().slice(0, 10), r.priceMxnCents);
    const points = [...byDate.entries()].map(([date, valueMxnCents]) => ({
      date,
      valueMxnCents,
      pricedCardCount: 1,
    }));

    const change = this.changeOf(points.map((p) => p.valueMxnCents));
    return {
      product: {
        inventoryItemId: item.id,
        tcgplayerProductId: item.tcgplayerProductId,
        name: item.card.name,
      },
      range: normalizedRange,
      points,
      change,
    };
  }

  // ---------------------------------------------------------------------------
  // POST /catalog/sealed/restock-subscriptions — FEATURE-FLAGGED sealed_restock_alerts.
  // ---------------------------------------------------------------------------
  async subscribeRestock(
    dto: {
      email?: string;
      tcgplayerProductId?: number;
      cardId?: string;
      sealedSubtype?: string;
      sealedCondition?: string;
    },
    userId?: string,
  ): Promise<{ subscribed: true }> {
    if ((await this.settings.getString(SettingKey.SEALED_RESTOCK_ALERTS)) !== 'on') {
      throw BusinessException.notFound('FEATURE_DISABLED', 'sealed restock alerts are disabled');
    }
    const email = typeof dto.email === 'string' ? dto.email.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw BusinessException.validation('VALIDATION_ERROR', 'valid email is required', { field: 'email' });
    }
    if (dto.tcgplayerProductId == null && (dto.cardId == null || dto.cardId === '')) {
      throw BusinessException.validation(
        'VALIDATION_ERROR',
        'product identity required (tcgplayerProductId or cardId)',
        { field: 'product' },
      );
    }
    if (!dto.sealedCondition || !SEALED_CONDITIONS.has(dto.sealedCondition)) {
      throw BusinessException.validation('VALIDATION_ERROR', 'valid sealedCondition is required', {
        field: 'sealedCondition',
      });
    }

    // Resuelve el cardId ancla (FK requerida): explícito, o derivado de una pieza con ese productId.
    let cardId = dto.cardId ?? null;
    let sealedSubtype = (dto.sealedSubtype as SealedSubtype | undefined) ?? null;
    if (cardId == null && dto.tcgplayerProductId != null) {
      const anchor = await this.prisma.inventoryItem.findFirst({
        where: { productType: 'sealed', tcgplayerProductId: dto.tcgplayerProductId },
        select: { cardId: true, sealedSubtype: true },
      });
      if (anchor) {
        cardId = anchor.cardId;
        if (sealedSubtype == null) sealedSubtype = anchor.sealedSubtype;
      }
    }
    // Respuesta NEUTRA (anti-enumeración, §4-G): si no podemos anclar a una Card real, NO revelamos
    // que el producto no existe — devolvemos 202 igual, sin persistir (no hay FK que satisfacer).
    if (cardId != null) {
      const card = await this.prisma.card.findUnique({ where: { id: cardId }, select: { id: true } });
      if (card) {
        await this.prisma.sealedRestockSubscription.create({
          data: {
            email,
            userId: userId ?? null,
            cardId,
            sealedSubtype,
            tcgplayerProductId: dto.tcgplayerProductId ?? null,
            sealedCondition: dto.sealedCondition as SealedCondition,
            notifiedAt: null,
          },
        });
      }
    }
    return { subscribed: true };
  }

  // ---------------------------------------------------------------------------
  // Helpers de rango (mismo conjunto que la gráfica de portafolio/set).
  // ---------------------------------------------------------------------------
  private normalizeRange(range: string): string {
    return RANGES.includes(range) ? range : '1m';
  }

  private rangeStart(range: string): Date | null {
    const now = new Date();
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    switch (range) {
      case '5d': d.setUTCDate(d.getUTCDate() - 5); return d;
      case '15d': d.setUTCDate(d.getUTCDate() - 15); return d;
      case '1m': d.setUTCMonth(d.getUTCMonth() - 1); return d;
      case '3m': d.setUTCMonth(d.getUTCMonth() - 3); return d;
      case '6m': d.setUTCMonth(d.getUTCMonth() - 6); return d;
      case '1y': d.setUTCFullYear(d.getUTCFullYear() - 1); return d;
      case 'ytd': return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      case 'all': default: return null;
    }
  }

  private changeOf(values: number[]): { absMxnCents: number; pct: number | null; direction: 'up' | 'down' | 'flat' } {
    if (values.length === 0) return { absMxnCents: 0, pct: null, direction: 'flat' };
    const first = values[0];
    const last = values[values.length - 1];
    const absMxnCents = last - first;
    const pct = first === 0 ? null : Math.round((absMxnCents / first) * 10000) / 100;
    const direction = absMxnCents > 0 ? 'up' : absMxnCents < 0 ? 'down' : 'flat';
    return { absMxnCents, pct, direction };
  }
}

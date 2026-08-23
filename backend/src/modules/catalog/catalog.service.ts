import { Injectable } from '@nestjs/common';
import { Card, CardSet, Finish, InventoryItem, Prisma, ProductType, RawCondition, SealedSubtype, VariantPriceOverride } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService, PriceInfo, GradedEstimateRef } from '../pricing/pricing.service';
import { computeSalePriceForRarity, SalesRule, PriceRuleSet } from '../../common/money';
import { BusinessException } from '../../common/business.exception';
import { CARD_ORDER_BY_GLOBAL, CARD_ORDER_BY_IN_SET, computeDisplayFinishes } from '../../common/card-order';
// P-30 H2 (TECH_DEBT): helper ÚNICO de la clave de variante K=(cardId,productType,gradeKey,finish),
// antes interpolada a mano en 3 sitios de este archivo (riesgo de drift silencioso). Mismo string.
import { variantKey } from '../../common/variant-key';
// v1.33 (P-27, §4.31d): master set combinado en el STOREFRONT. `GET /catalog/sets`+`/facets` PLIEGAN
// el subset en su principal; `GET /catalog/cards?setId=<principal>` EXPANDE a las partes. SOLO
// presentación/lectura (money-safe): el mapa nunca publica cartas sin precio ni re-llavea nada.
import { MASTER_SET_GROUPS, partExternalIds } from '../../config/master-set-groups';
// v1.44-graded-estimate (§4.35): «gancho de grading». La DECISIÓN (qué se emite y qué se destaca) vive
// en las PURAS de `common/graded-estimate.ts`; aquí solo se compone el DTO. Partición §4.35-0:
// `gradedEstimates` (ficha, SIN gate) ≠ `gradingHighlight` (teja/vitrina, CON gate de curaduría).
import {
  businessDateCdmx,
  evaluateGradingHighlight,
  GRADED_ESTIMATE_COMPANY,
  GradedEstimateConfig,
  GradingHighlightResult,
  selectGradedEstimates,
} from '../../common/graded-estimate';

// Conjuntos de valores válidos de los enums de Prisma. Un filtro público con un valor
// fuera de estos conjuntos produciría un PrismaClientValidationError (500); en cambio
// se rechaza con 400 VALIDATION_ERROR (ver `validateEnum`).
const PRODUCT_TYPES = new Set<string>(Object.values(ProductType));
const RAW_CONDITIONS = new Set<string>(Object.values(RawCondition));
const SEALED_SUBTYPES = new Set<string>(Object.values(SealedSubtype));
const FINISHES = new Set<string>(Object.values(Finish));

/**
 * @param pricedFinishes v1.22-2 / N-15 (§4.22a-6): acabados de ESTA carta con `hasPricedRef`
 *   (PriceReference raw `raw:NM`, `priceMxnCents > 0`), de `PricingService.getPricedRawFinishesBatch`.
 *   El llamador lo pasa para computar `displayFinishes` (supresión del acabado ESPURIO en premium de
 *   una sola impresión). Omitido/`undefined` ⇒ conjunto vacío ⇒ SIN supresión money-safe:
 *   `displayFinishes = availableFinishes` (una premium sin priced cae a la salvaguarda; una no-premium
 *   nunca se suprime). Los call-sites de catalog/quoter/master-set/vault SIEMPRE lo pasan (batch, sin N+1).
 */
export function toCardDTO(
  card: Card & { set?: CardSet | null },
  pricedFinishes?: Iterable<Finish>,
) {
  // v1.6-finish: acabados en que existe la carta (lista blanca de validación). [normal] por default.
  const availableFinishes = (card.availableFinishes ?? ['normal']) as Finish[];
  return {
    id: card.id,
    externalId: card.externalId,
    name: card.name,
    number: card.number,
    // v1.22 (M-26, §4.22b): claves persistidas del ORDEN NATURAL. El front las usa SOLO para
    // re-ordenar localmente tras filtrar, con (numberPrefix asc, numberSort asc, number asc) —
    // que reproduce EXACTAMENTE el orden del servidor. Nunca con el índice del arreglo.
    numberSort: card.numberSort,
    numberPrefix: card.numberPrefix,
    rarity: card.rarity,
    supertype: card.supertype,
    subtypes: (card.subtypes as string[] | null) ?? [],
    setId: card.setId,
    setName: card.set?.name ?? null,
    imageSmallUrl: card.imageSmallUrl,
    imageLargeUrl: card.imageLargeUrl,
    availableFinishes,
    // v1.22-2 / N-15 (§4.22a-6): subconjunto DISPLAY-only (⊆ availableFinishes, orden FINISH_ORDER,
    // nunca vacío). SOLO gobierna el render; la whitelist SEC-A1 sigue siendo availableFinishes.
    displayFinishes: computeDisplayFinishes(card.rarity, availableFinishes, pricedFinishes ?? []),
  };
}

/**
 * v1.44-graded-estimate (§DTOs base / §4.35e) — `GradedEstimateDTO` público. Tres reglas NORMATIVAS que
 * este constructor hace CIERTAS POR CONSTRUCCIÓN (no por convención):
 *  - `estimate.status` es SIEMPRE `"priced"` — un `pending` en un argumento de venta está PROHIBIDO
 *    (§N.4). Si no hay dato, el elemento NO se emite (el caller filtra antes de llegar aquí).
 *  - `referenceMxnCents` y `capturedDate` SIEMPRE presentes.
 *  - **`source` se OMITE SIEMPRE** (y `isManualOverride` jamás viaja): es el ÚNICO campo que delataría
 *    si el número lo tecleó el admin (fase 1) o lo trajo el ingest (fase 2). El objeto se construye con
 *    exactamente tres campos, así que no hay forma de que se cuele. Ver §4.35g.
 *
 * Nada del cálculo viaja: ni multiplicador, ni ganancia, ni costo de gradeo, ni umbral (SEC-A1
 * reforzado — el cliente no puede reconstruir el gate porque los números no salen del servidor).
 */
function toGradedEstimateDTO(e: GradedEstimateRef) {
  return {
    gradingCompany: GRADED_ESTIMATE_COMPANY,
    gradeValue: e.gradeValue,
    gradeKey: e.gradeKey,
    estimate: {
      status: 'priced' as const,
      referenceMxnCents: e.mxnCents,
      capturedDate: e.capturedDate,
    },
  };
}

/**
 * v1.44 — contexto del gancho izado UNA vez por request (§4.35c): config + los estimados de las cartas
 * del conjunto ya materializado (+1 query constante) + la fecha de negocio. `null` ⇒ el dial está
 * apagado o no hay carta raw que evaluar ⇒ **no se emite ninguno de los dos campos y no se hace ninguna
 * query extra**.
 */
interface GradingContext {
  cfg: GradedEstimateConfig;
  byCard: Map<string, GradedEstimateRef[]>;
  today: string;
}

/** Deriva el año del set desde `releaseDate` (`yyyy/MM/dd` de pokemontcg.io). v1.1. */
export function yearFromReleaseDate(releaseDate?: string | null): number | null {
  if (!releaseDate) return null;
  const m = /^(\d{4})/.exec(releaseDate);
  return m ? parseInt(m[1], 10) : null;
}

type ItemWithCard = InventoryItem & { card: Card & { set?: CardSet | null } };

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  /**
   * v1.1 — "Compra" = inventario PUBLICADO con precio de venta RESOLVIBLE (ARCHITECTURE §4.9):
   * `status=listed`, plataforma. El comprador NUNCA ve "precio pendiente".
   *
   * v1.13-sales-pricing (§4.14d): el gate coarse en DB YA NO puede filtrar por existencia de precio.
   * Con las reglas de venta por rareza, una regla `fixed` da PISO a una carta bulk SIN `PriceReference`
   * (antes se excluía), volviéndola sellable — la resolubilidad depende de `SALES_PRICE_RULES`, que la
   * DB no evalúa. Por eso el gate coarse se reduce a `platform + listed`; el precio EXACTO y la
   * comprabilidad (`sellable`) se confirman al construir el ListingDTO (`fetchSellable` descarta los no
   * resolubles: `pct` sin market → pending → no vendible).
   */
  private publishedWhere(extra: Prisma.InventoryItemWhereInput = {}): Prisma.InventoryItemWhereInput {
    return {
      ownerType: 'platform',
      status: 'listed',
      ...extra,
    };
  }

  /**
   * H9 / SB-D5 — WHERE de la vista pública de SINGLES: publicado (`publishedWhere`) + guardarraíl
   * INTERINO que EXCLUYE el sellado. P-35 ancla TODO el sellado de un set a la carta single de menor
   * `(numberPrefix, numberSort)`; sin este filtro la ficha/listado de ese single mezcla cajas selladas
   * entre sus "ejemplares" (y como el front toma `listings[0]` por `createdAt desc` como primary, una caja
   * recién dada de alta puede renderizar la ficha del single como si fuera sellado). Solo raw/graded
   * cuentan como ejemplares de un single; el sellado tiene su propio catálogo público
   * (`GET /catalog/sealed`, SealedCatalogService).
   *
   * Se añade como cláusula `AND` aparte para NO pisar un filtro `productType` explícito ya presente en el
   * where (que sigue exacto). Money-safe: solo ACOTA la lectura (no toca precios ni valuación; sin precio
   * sigue → pendiente/`—`, nunca 0). Cura de raíz (entidad `SealedProduct` propia) diferida en SB-D5 —
   * ver `docs/TECH_DEBT.md` (H9). La ubicación FINAL del filtro la decide el arquitecto: el contrato aún
   * expone sellado en `GET /catalog/facets` y en el filtro `?productType=sealed` de `GET /catalog/cards`.
   */
  private singlesPublishedWhere(extra: Prisma.InventoryItemWhereInput = {}): Prisma.InventoryItemWhereInput {
    const where = this.publishedWhere(extra);
    const guard: Prisma.InventoryItemWhereInput = { productType: { not: 'sealed' } };
    const prev = where.AND;
    where.AND = Array.isArray(prev) ? [...prev, guard] : prev ? [prev, guard] : [guard];
    return where;
  }

  /**
   * Trae items publicados que efectivamente son comprables (precio resoluble).
   *
   * Pago mínimo de BE-25 (v1.16-master-set, §4.17c): iza `SALES_PRICE_RULES`+fallback **una vez** por
   * request y resuelve las referencias en **un** lote (`getReferencesBatch`) en vez de 2 lecturas de
   * settings + 1 `getReference` **por ítem** (N+1). Cada DTO se construye con el contexto pre-cargado.
   */
  private async fetchSellable(
    where: Prisma.InventoryItemWhereInput,
  ): Promise<{ item: ItemWithCard; dto: Awaited<ReturnType<CatalogService['toListingDTO']>> }[]> {
    const items = await this.prisma.inventoryItem.findMany({
      where,
      include: { card: { include: { set: true } } },
      orderBy: { createdAt: 'desc' },
    });
    if (items.length === 0) return [];

    const salesRules = await this.pricing.loadSalesRules();
    // v1.23-sealed-sales (§4.23d): contexto de spreads del sellado izado UNA vez (pago mínimo BE-25).
    const sealedSpreads = await this.pricing.loadSealedSpreads();
    // v1.22-2 / N-15 (§4.22a-6): acabados priceados por carta EN LOTE (sin N+1) para displayFinishes.
    const pricedByCard = await this.pricing.getPricedRawFinishesBatch(items.map((i) => i.cardId));
    // Batch de referencias: para el SELLADO la clave es la de MERCADO (`sealed:tcg:<productId>`,
    // finish normal), NO el gradeKey legacy 'sealed'; un sellado no mapeado no aporta clave (sin market).
    const refs = await this.pricing.getReferencesBatch(
      items.flatMap((i): { cardId: string; productType: ProductType; gradeKey: string; finish: Finish }[] => {
        if (i.productType === 'sealed') {
          const gk = this.pricing.sealedMarketGradeKeyForItem(i);
          return gk ? [{ cardId: i.cardId, productType: 'sealed', gradeKey: gk, finish: 'normal' }] : [];
        }
        return [{ cardId: i.cardId, productType: i.productType, gradeKey: this.pricing.gradeKeyFor(i), finish: i.finish }];
      }),
    );

    // v1.28 (P-18, §4.26b): controles por variante (M-30) EN LOTE — solo para piezas raw/graded que
    // DERIVAN su precio (sin `listPriceCents` manual, que sigue ganando; el sellado conserva su
    // cadena H-1 intacta). UNA query por request, misma clave que el lote de referencias.
    const variantOverrides = await this.pricing.getVariantOverridesBatch(
      items
        .filter((i) => i.productType !== 'sealed' && i.listPriceCents == null)
        .map((i) => ({
          cardId: i.cardId,
          productType: i.productType,
          gradeKey: this.pricing.gradeKeyFor(i),
          finish: i.finish,
        })),
    );

    const out: { item: ItemWithCard; dto: Awaited<ReturnType<CatalogService['toListingDTO']>> }[] = [];
    for (const item of items) {
      const reference = this.refFromBatch(refs, item);
      const dto = await this.toListingDTO(item, {
        reference,
        salesRules,
        sealedSpreads,
        pricedFinishes: pricedByCard.get(item.cardId),
        variantOverride:
          item.productType === 'sealed'
            ? null
            : variantOverrides.get(
                variantKey({
                  cardId: item.cardId,
                  productType: item.productType,
                  gradeKey: this.pricing.gradeKeyFor(item),
                  finish: item.finish,
                }),
              ) ?? null,
      });
      if (dto.sellable && dto.salePriceCents != null) out.push({ item, dto });
    }
    return out;
  }

  /** Referencia del lote para un item (mercado sellado vs. gradeKey+acabado del resto). */
  private refFromBatch(refs: Map<string, PriceInfo>, item: ItemWithCard): PriceInfo | undefined {
    if (item.productType === 'sealed') {
      const gk = this.pricing.sealedMarketGradeKeyForItem(item);
      // P-30 H2: mismo `variantKey` con que `getReferencesBatch` indexó el eje sellado (ver :148, que
      // pasa {productType:'sealed', gradeKey:gk, finish:'normal'}); sin string hand-rolled paralelo.
      return gk
        ? refs.get(variantKey({ cardId: item.cardId, productType: 'sealed', gradeKey: gk, finish: 'normal' }))
        : undefined;
    }
    return refs.get(
      variantKey({
        cardId: item.cardId,
        productType: item.productType,
        gradeKey: this.pricing.gradeKeyFor(item),
        finish: item.finish,
      }),
    );
  }

  /**
   * Construye un ListingDTO (API_CONTRACT §DTOs base). Distingue referenceValue
   * (valor de mercado) de salePriceCents (precio de venta). El sellado lleva sealedSubtype
   * y NO lleva rawCondition/grade/rareza.
   */
  async toListingDTO(
    item: ItemWithCard,
    ctx?: {
      // BE-25 (§4.17c): contexto pre-cargado por `fetchSellable` (referencia del lote + reglas de
      // venta izadas una vez) para evitar el N+1 de referencias/settings. Opcional: sin él el método
      // resuelve todo por sí mismo (uso single).
      reference?: PriceInfo;
      salesRules?: { rules: PriceRuleSet<SalesRule>; fallbackPct: number };
      // v1.23-sealed-sales (§4.23d): contexto de spreads del sellado (izado una vez). Su presencia
      // señala que `reference` viene del lote (para sellado = mercado TCGCSV, o undefined si no mapeado).
      sealedSpreads?: { spreadPctBySubtype: Record<string, number>; fallbackPct: number; sourceOn: boolean };
      // v1.22-2 / N-15 (§4.22a-6): acabados priceados de ESTA carta (del lote) para displayFinishes.
      pricedFinishes?: Iterable<Finish>;
      // v1.28 (P-18, §4.26b): fila M-30 de la variante (del lote de `fetchSellable`; `null` = sin
      // fila). Su presencia va atada a `salesRules` (batch); en uso single se resuelve aquí mismo.
      variantOverride?: VariantPriceOverride | null;
    },
  ) {
    let referenceValue: PriceInfo;
    let salePriceCents: number | undefined;

    if (item.productType === 'sealed') {
      // v1.23-sealed-sales (§4.23a/§4.23b): precio del sellado por precedencia money-safe
      // override > mercado×spread(subtype) > mercado×spread(global) > PRICE_PENDING. referenceValue
      // del sellado = valor de mercado TCGCSV (sealedMarketRef), informativo. SEC-A1: todo server-side.
      const sealedCtx = ctx?.sealedSpreads ?? (await this.pricing.loadSealedSpreads());
      const marketRef = ctx?.sealedSpreads
        ? ctx.reference // lote: puede venir undefined (sellado no mapeado → sin mercado)
        : await this.pricing.getSealedMarketRef(item);
      // H-1 (v1.24): resolver ÚNICO (gate del mercado por dial + pura). El mercado solo cuenta con el
      // dial encendido (§4.23a); con off el sellado solo se vende con override. `referenceValue` =
      // valor de mercado TCGCSV cuando el gate lo deja pasar, si no `pending`.
      const marketPriced = this.pricing.gateSealedMarketCents(marketRef, sealedCtx.sourceOn) != null;
      const sale = this.pricing.resolveSealedSalePrice(item, marketRef, sealedCtx);
      if (sale.salePriceCents != null) salePriceCents = sale.salePriceCents;
      referenceValue = marketPriced ? marketRef! : { status: 'pending' };
    } else {
      const gradeKey = this.pricing.gradeKeyFor(item);
      // v1.6-finish: valúa contra la PriceReference del ACABADO de ESTA copia física.
      referenceValue =
        ctx?.reference ??
        (await this.pricing.getReference(item.cardId, item.productType, gradeKey, item.finish));

      if (item.listPriceCents != null) {
        // Override manual POR PIEZA → gana siempre (precio directo sin regla; intención más
        // específica — v1.28 §4.26b: gana también sobre el sellOverride de la variante).
        salePriceCents = item.listPriceCents;
      } else {
        // v1.13-sales-pricing (§4.14d): precio de venta por RAREZA (SEC-A1: rareza de Card.rarity,
        // acabado de InventoryItem.finish). Con regla `fixed` una bulk SIN market obtiene piso (sellable);
        // con `pct` sin market → pending (sin precio, no vendible), igual que antes.
        // v1.28 (P-18, §4.26b): sellOverride de la VARIANTE (M-30) pisa la regla — resuelto en
        // LECTURA, por eso surte efecto inmediato en toda pieza publicada sin manual.
        const referenceMxnCents =
          referenceValue.status === 'priced' ? (referenceValue.referenceMxnCents ?? null) : null;
        // BE-25: si viene el contexto pre-cargado usa la función pura (sin leer settings por ítem);
        // si no, delega al servicio (que iza reglas por sí mismo) y resuelve el override single.
        const variantOverride = ctx?.salesRules
          ? (ctx.variantOverride ?? null)
          : await this.pricing.getVariantOverride(
              item.cardId,
              item.productType,
              this.pricing.gradeKeyFor(item),
              item.finish,
            );
        const sale = ctx?.salesRules
          ? computeSalePriceForRarity(
              item.card.rarity,
              item.finish,
              referenceMxnCents,
              ctx.salesRules.rules,
              ctx.salesRules.fallbackPct,
              variantOverride,
            )
          : await this.pricing.computeSalePriceForItem(
              { rarity: item.card.rarity, finish: item.finish },
              referenceMxnCents,
              variantOverride,
            );
        if (sale.salePriceCents != null) salePriceCents = sale.salePriceCents;
      }
    }

    // v1.1: comprable solo si está PUBLICADO (listed) y con precio de venta fijado (>0).
    const sellable = salePriceCents != null && salePriceCents > 0 && item.status === 'listed';

    return {
      inventoryItemId: item.id,
      card: toCardDTO(item.card, ctx?.pricedFinishes),
      productType: item.productType,
      rawCondition: item.rawCondition ?? undefined,
      sealedSubtype: item.sealedSubtype ?? undefined,
      // v1.23-sealed-sales: condición del sellado (mint|minor_box_damage); undefined en raw/graded.
      sealedCondition: item.sealedCondition ?? undefined,
      // v1.6-finish: acabado de esta copia (graded/sealed → normal). ListingDTO.finish.
      finish: item.finish,
      gradingCompany: item.gradingCompany ?? undefined,
      gradeValue: item.gradeValue ?? undefined,
      // v1.2 (M-12): nº de certificado PSA/CGC (verificable en la graduadora); null en raw/sealed.
      certNumber: item.certNumber ?? undefined,
      referenceValue,
      salePriceCents,
      sellable,
      // v1.2 (M-13): sin fotos propias — la imagen es la de catálogo remota (CardDTO.imageSmallUrl/Large).
    };
  }

  /**
   * Valida un valor de filtro enum del endpoint público. Devuelve el valor si es válido;
   * si no, lanza 400 VALIDATION_ERROR (nunca deja que un enum inválido llegue a Prisma y
   * produzca un 500 PrismaClientValidationError).
   */
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

  /**
   * v1.33 (P-27, §4.31d) — expande el filtro `setId` de Compra cuando el id es el PRINCIPAL de un
   * master combinado: devuelve `{ in: partSetIds }` (set-ids locales reales de las partes importadas,
   * ≥2) para listar el inventario de todas las partes. Para un set normal, un subset, o un principal
   * con <2 partes importadas → devuelve el `setId` tal cual (comportamiento v1.20). Money-safe: solo
   * amplía el WHERE de lectura; cada `ListingDTO` sigue llaveado a su `Card`/set real.
   */
  private async expandSetIdFilter(setId: string): Promise<string | { in: string[] }> {
    if (MASTER_SET_GROUPS.length === 0) return setId;
    const set = await this.prisma.cardSet.findUnique({
      where: { id: setId },
      select: { externalId: true },
    });
    if (!set) return setId; // id desconocido → sin cambio (mismo resultado que hoy).
    const partExt = partExternalIds(set.externalId); // [] si no es principal de ningún grupo
    if (partExt.length < 2) return setId; // set normal / subset / principal sin subsets → sin expandir.
    const parts = await this.prisma.cardSet.findMany({
      where: { externalId: { in: partExt } },
      select: { id: true },
    });
    const ids = parts.map((p) => p.id);
    return ids.length >= 2 ? { in: ids } : setId; // requiere ≥2 partes importadas para combinar.
  }

  /**
   * v1.33 (P-27, §4.31d) — PLIEGA los subset de cada master combinado en su principal para el dropdown
   * de Compra (`/catalog/sets` y `/catalog/facets`): el principal aparece UNA vez y gana `partSetIds?`
   * (los set-ids reales agrupados) para que el filtro cubra todas las partes. Si el principal no está
   * entre los sets publicados pero sí importado, se trae para nombrar la entrada combinada. CA-71: si
   * el principal no existe importado, el subset NO se pliega (queda como su propio set). Money-safe:
   * solo re-agrupa metadatos de presentación; jamás publica cartas sin precio ni re-llavea nada.
   */
  private async foldStorefrontSets(
    entries: {
      id: string;
      externalId: string;
      name: string;
      series: string | null;
      releaseDate: string | null;
      year: number | null;
      partSetIds?: string[];
    }[],
  ): Promise<typeof entries> {
    if (MASTER_SET_GROUPS.length === 0) return entries;
    const byExternal = new Map(entries.map((e) => [e.externalId, e]));
    const active = MASTER_SET_GROUPS.map((g) => ({
      g,
      subsetsPresent: g.subsets.filter((s) => byExternal.has(s.externalId)),
    })).filter((x) => x.subsetsPresent.length > 0);
    if (active.length === 0) return entries;

    // Principales necesarios que NO están entre los sets publicados (hay que traerlos para el nombre).
    const missingPrimaryExt = [
      ...new Set(active.map((x) => x.g.primary).filter((ext) => !byExternal.has(ext))),
    ];
    const fetchedPrimaries = missingPrimaryExt.length
      ? await this.prisma.cardSet.findMany({
          where: { externalId: { in: missingPrimaryExt } },
          select: { id: true, externalId: true, name: true, series: true, releaseDate: true },
        })
      : [];
    const primaryByExt = new Map(fetchedPrimaries.map((s) => [s.externalId, s]));

    const removed = new Set<string>();
    const added: typeof entries = [];
    for (const { g, subsetsPresent } of active) {
      let primaryEntry = byExternal.get(g.primary);
      if (!primaryEntry) {
        const fetched = primaryByExt.get(g.primary);
        if (!fetched) continue; // CA-71: principal no importado → no se pliega.
        primaryEntry = {
          id: fetched.id,
          externalId: fetched.externalId,
          name: fetched.name,
          series: fetched.series ?? null,
          releaseDate: fetched.releaseDate ?? null,
          year: yearFromReleaseDate(fetched.releaseDate),
        };
        byExternal.set(g.primary, primaryEntry);
        added.push(primaryEntry);
      }
      const subsetIds = subsetsPresent.map((s) => byExternal.get(s.externalId)!.id);
      primaryEntry.partSetIds = [primaryEntry.id, ...subsetIds];
      for (const s of subsetsPresent) removed.add(byExternal.get(s.externalId)!.id);
    }
    return [...entries, ...added].filter((e) => !removed.has(e.id));
  }

  /**
   * v1.38-grouped-listings (P-30, ARCHITECTURE §4.9a) — AGRUPA en LECTURA las piezas vendibles
   * (raw/graded) en publicaciones ÚNICAS por `K = (cardId, productType, gradeKey, finish)`
   * (`gradeKey = gradeKeyFor(item)`, canónico: `raw:NM` | `graded:PSA:10` | …). Reduce en memoria sobre
   * el set `sellable` que `fetchSellable` YA cargó (mismo coste que el listado por-pieza; sin query ni
   * columna nueva). Por construcción todas las piezas de una `K` comparten `salePriceCents` y
   * `referenceValue` (misma regla/override de variante + misma `PriceReference`).
   *
   * Money-safe: `fetchSellable` ya descartó las piezas sin precio resoluble (`dto.sellable ∧
   * salePriceCents != null`), así que TODO grupo devuelto tiene `stockCount = members.length ≥ 1` (VIVO)
   * y `salePriceCents = mínimo del grupo` = el del representante (pieza vendible más barata). Un grupo
   * AGOTADO (stockCount 0) no existe en `rows` ⇒ no se emite (desaparece de Compra). El `certNumber` es
   * POR SLAB ⇒ NO va a nivel de grupo (se expone por pieza en `units[]` de la ficha).
   */
  private buildGroups(
    rows: { item: ItemWithCard; dto: Awaited<ReturnType<CatalogService['toListingDTO']>> }[],
    // v1.44-graded-estimate (§4.35e): contexto del gancho. Ausente/`null` ⇒ ningún grupo trae
    // `gradingHighlight` (dial off, o superficie que no lo compone) — el DTO sale EXACTAMENTE como hoy.
    grading?: GradingContext | null,
  ) {
    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = variantKey({
        cardId: r.item.cardId,
        productType: r.item.productType,
        gradeKey: this.pricing.gradeKeyFor(r.item),
        finish: r.item.finish,
      });
      const arr = groups.get(k);
      if (arr) arr.push(r);
      else groups.set(k, [r]);
    }
    return [...groups.values()].map((members) => {
      // Representante = pieza vendible MÁS BARATA (el precio del grupo = su salePriceCents = mínimo).
      const cheapest = [...members].sort(
        (a, b) => (a.dto.salePriceCents ?? 0) - (b.dto.salePriceCents ?? 0),
      )[0];
      const item = cheapest.item;
      const salePriceCents = cheapest.dto.salePriceCents!; // garantizado por fetchSellable (nunca null aquí)

      // v1.44-graded-estimate (§4.35c/e) — GATE DE CURADURÍA, a nivel de GRUPO: compara contra
      // `salePriceCents`, que ES del grupo. Una carta con `normal` y `reverse_holo` publicados tiene UN
      // solo par de estimados (son de la CARTA) pero DOS precios raw ⇒ puede quedar destacada en un
      // acabado y no en el otro. Es deliberado y money-safe.
      const highlightResult = grading
        ? evaluateGradingHighlight<GradedEstimateRef>({
            productType: item.productType,
            rawSalePriceCents: salePriceCents,
            estimates: grading.byCard.get(item.cardId) ?? [],
            today: grading.today,
            cfg: grading.cfg,
          })
        : null;
      // PRESENCIA ⇔ ELEGIBILIDAD: sin gate cumplido el campo NO EXISTE. Jamás `eligible:false`, jamás
      // `[]` (un arreglo vacío es un contenedor renderizable y filtraría la decisión del gate).
      const gradingHighlight =
        highlightResult?.eligible && highlightResult.highlight.length > 0
          ? highlightResult.highlight.map(toGradedEstimateDTO)
          : null;

      const dto = {
        representativeInventoryItemId: item.id,
        card: cheapest.dto.card,
        productType: item.productType as 'raw' | 'graded',
        finish: item.finish,
        // rawCondition SOLO en raw; gradingCompany/gradeValue SOLO en graded (identidad de GRADO del grupo).
        rawCondition: item.rawCondition ?? undefined,
        gradeKey: this.pricing.gradeKeyFor(item),
        gradingCompany: item.gradingCompany ?? undefined,
        gradeValue: item.gradeValue ?? undefined,
        stockCount: members.length,
        salePriceCents,
        referenceValue: cheapest.dto.referenceValue, // único por K (misma PriceReference), informativo.
        currency: 'MXN' as const,
        // v1.44 (ADITIVO): presente ⇔ el gate de ROI sobre PSA 9 se cumple. Omitido en cualquier otro
        // caso (incluido el dial `off`), y entonces la teja se ve EXACTAMENTE como hoy (criterio 82).
        ...(gradingHighlight ? { gradingHighlight } : {}),
      };

      return {
        dto,
        salePriceCents,
        // 'newest' del grupo = la pieza más nueva (createdAt desc) — contrato §2 GET /catalog/cards.
        newestAt: Math.max(...members.map((m) => m.item.createdAt.getTime())),
        // Claves de ORDEN de la vitrina (`sort=grading_showcase`) y del diagnóstico de admin. NINGUNA
        // viaja al cliente (SEC-A1, §4.35e): el servidor las usa solo para decidir presencia y orden.
        highlightResult,
      };
    });
  }

  /**
   * v1.44-graded-estimate (§4.35c) — iza el contexto del gancho para un conjunto YA materializado de
   * piezas vendibles. Coste: **+1 query constante** (el batch dedicado sobre los `cardId` DISTINTOS de
   * las filas **raw**), nunca una query por grupo.
   *
   * Devuelve `null` —y NO hace ninguna query— cuando:
   *  - el dial maestro está `off` (§M10: con `off` el backend «ni siquiera evalúa nada»), o
   *  - no hay ninguna pieza **raw** vendible en el conjunto (el gancho no aplica a graded ni a sealed,
   *    criterio 87).
   */
  private async loadGradingContext(
    rows: { item: ItemWithCard }[],
  ): Promise<GradingContext | null> {
    const cfg = await this.pricing.loadGradedEstimateConfig();
    if (!cfg.enabled) return null;
    const cardIds = [
      ...new Set(rows.filter((r) => r.item.productType === 'raw').map((r) => r.item.cardId)),
    ];
    if (cardIds.length === 0) return null;
    const byCard = await this.pricing.getGradedEstimatesBatch(cardIds);
    return { cfg, byCard, today: businessDateCdmx() };
  }

  /**
   * v1.44-graded-estimate (§4.35f / API_CONTRACT §2) — valida los DOS query params nuevos de la vitrina
   * ANTES de tocar la base (fail-closed, y el error no depende de si la feature está encendida):
   *  - `gradingHighlight` **solo acepta `"true"`**: un `false` «filtrando lo no destacado» sería una
   *    superficie comercial invertida que nadie pidió ⇒ `400 VALIDATION_ERROR`.
   *  - `sort=grading_showcase` **exige** el filtro ⇒ si no, `400 GRADING_SORT_REQUIRES_FILTER`: sin él,
   *    los grupos NO destacados irían a la cola del listado con clave de orden indefinida y la vitrina
   *    podría pintarlos al paginar.
   */
  private validateGradingQuery(q: { gradingHighlight?: string; sort?: string }): boolean {
    const onlyHighlighted = q.gradingHighlight !== undefined;
    if (onlyHighlighted && q.gradingHighlight !== 'true') {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'gradingHighlight only accepts "true"', {
        field: 'gradingHighlight',
        value: q.gradingHighlight,
        allowed: ['true'],
      });
    }
    if (q.sort === 'grading_showcase' && !onlyHighlighted) {
      throw BusinessException.badRequest(
        'GRADING_SORT_REQUIRES_FILTER',
        'sort=grading_showcase requires gradingHighlight=true',
        { field: 'sort' },
      );
    }
    return onlyHighlighted;
  }

  async listCards(q: {
    q?: string;
    setId?: string;
    rarity?: string;
    productType?: string;
    condition?: string;
    finish?: string;
    sealedSubtype?: string;
    minPriceCents?: number;
    maxPriceCents?: number;
    page: number;
    pageSize: number;
    sort?: string;
    /** v1.44 (§4.35f): vitrina «Joyas para gradear». Solo se acepta `"true"`. */
    gradingHighlight?: string;
  }) {
    // v1.44: se valida ANTES de la query (un sort inválido no debe costar una lectura).
    const onlyHighlighted = this.validateGradingQuery(q);
    // Endpoint PÚBLICO: los filtros enum se validan contra la taxonomía real ANTES de
    // llegar a Prisma. Un valor inválido (p. ej. ?condition=LP, ?productType=foo) hoy
    // rompía con PrismaClientValidationError (500); ahora responde 400 VALIDATION_ERROR.
    const extra: Prisma.InventoryItemWhereInput = {};
    if (q.productType) extra.productType = this.validateEnum('productType', q.productType, PRODUCT_TYPES) as never;
    if (q.condition) extra.rawCondition = this.validateEnum('condition', q.condition, RAW_CONDITIONS) as never;
    // v1.6-finish: filtro por acabado sobre InventoryItem.finish. Valor inválido → 400.
    if (q.finish) extra.finish = this.validateEnum('finish', q.finish, FINISHES) as never;
    if (q.sealedSubtype) extra.sealedSubtype = this.validateEnum('sealedSubtype', q.sealedSubtype, SEALED_SUBTYPES) as never;
    const cardWhere: Prisma.CardWhereInput = {};
    // v1.33 (P-27, §4.31d): si `setId` es el PRINCIPAL de un master combinado, EXPANDE a
    // `setId IN partSetIds` (incluye el inventario publicado de todas las partes: cel25 + cel25c).
    // Aditivo: para un set normal el filtro es idéntico a hoy. La Regla de Compra se respeta —
    // `fetchSellable` sigue listando SOLO lo `sellable` (agrupar no publica cartas sin precio).
    if (q.setId) cardWhere.setId = await this.expandSetIdFilter(q.setId);
    if (q.rarity) cardWhere.rarity = q.rarity;
    if (q.q) cardWhere.name = { contains: q.q, mode: 'insensitive' };
    if (Object.keys(cardWhere).length) extra.card = cardWhere;

    // H9 / SB-D5: la vista de SINGLES excluye el sellado (guardarraíl interino) — ver singlesPublishedWhere.
    const rows = await this.fetchSellable(this.singlesPublishedWhere(extra));

    // v1.44-graded-estimate (§4.35c): +1 query constante (0 si el dial está off o no hay raw).
    const grading = await this.loadGradingContext(rows);

    // v1.38-grouped-listings (P-30, §4.9a): AGRUPA en lectura por K=(cardId,productType,gradeKey,finish).
    // `total` = nº de GRUPOS (publicaciones únicas), no de piezas. Todo grupo emitido tiene stockCount≥1.
    let groups = this.buildGroups(rows, grading);

    // v1.44 (§4.35f) — VITRINA: subconjunto ordenado de Compra, no un endpoint aparte (mismo
    // `GroupedListingDTO` ⇒ misma teja, misma cifra, cero drift). Con el dial `off` ningún grupo trae
    // `gradingHighlight` ⇒ `{ data: [], total: 0 }`, que ES la señal de «no renderizar la vitrina»
    // (criterio 83). No es un error: es la feature apagada.
    if (onlyHighlighted) groups = groups.filter((g) => g.dto.gradingHighlight != null);

    // Rango de precio sobre el salePriceCents del GRUPO (contrato §2): el mínimo del grupo (= el del
    // representante). En el caso normal todas las piezas comparten precio, así que equivale a filtrar por
    // pieza; ante un listPriceCents manual divergente, el grupo se conserva/descarta por su precio único.
    if (q.minPriceCents != null) groups = groups.filter((g) => g.salePriceCents >= q.minPriceCents!);
    if (q.maxPriceCents != null) groups = groups.filter((g) => g.salePriceCents <= q.maxPriceCents!);

    if (q.sort === 'price_asc') groups.sort((a, b) => a.salePriceCents - b.salePriceCents);
    else if (q.sort === 'price_desc') groups.sort((a, b) => b.salePriceCents - a.salePriceCents);
    else if (q.sort === 'grading_showcase') {
      // v1.44 (§4.35f) — nombre deliberadamente NEUTRO: no nombra el criterio, así que ajustar la
      // política comercial es un cambio server-side con CERO impacto en contrato y cliente. Criterio
      // vigente: mayor GANANCIA NETA SOBRE PSA 9 (el escenario realista, no el optimista), con desempate
      // DETERMINISTA para que la paginación no baile: neta desc → PSA 10 desc → representante asc.
      // Ninguna de esas claves viaja al cliente.
      groups.sort((a, b) => {
        const an = a.highlightResult?.netUpsidePsa9MxnCents ?? 0;
        const bn = b.highlightResult?.netUpsidePsa9MxnCents ?? 0;
        if (an !== bn) return bn - an;
        const a10 = a.highlightResult?.psa10MxnCents ?? 0;
        const b10 = b.highlightResult?.psa10MxnCents ?? 0;
        if (a10 !== b10) return b10 - a10;
        return a.dto.representativeInventoryItemId.localeCompare(b.dto.representativeInventoryItemId);
      });
    } else groups.sort((a, b) => b.newestAt - a.newestAt); // 'newest' (default): pieza más nueva del grupo.

    const total = groups.length;
    const start = (q.page - 1) * q.pageSize;
    const data = groups.slice(start, start + q.pageSize).map((g) => g.dto);
    return { data, page: q.page, pageSize: q.pageSize, total };
  }

  /**
   * v1.1 — Facetas dinámicas de "Compra" calculadas SOBRE el inventario publicado y
   * comprable (no el catálogo completo). API_CONTRACT §catalog/facets.
   */
  async facets() {
    const rows = await this.fetchSellable(this.publishedWhere());

    const rarities = [...new Set(rows.map((r) => r.item.card.rarity).filter((x): x is string => Boolean(x)))];
    const productTypes = [...new Set(rows.map((r) => r.item.productType))];
    // v1.6-finish: distinct de InventoryItem.finish sobre el inventario publicado (filtro de acabado).
    const finishes = [...new Set(rows.map((r) => r.item.finish))];
    const sealedSubtypes = [
      ...new Set(rows.map((r) => r.item.sealedSubtype).filter((x): x is NonNullable<typeof x> => Boolean(x))),
    ];

    const setMap = new Map<
      string,
      { id: string; externalId: string; name: string; series: string | null; releaseDate: string | null; year: number | null }
    >();
    for (const { item } of rows) {
      const s = item.card.set;
      if (s && !setMap.has(s.id)) {
        setMap.set(s.id, {
          id: s.id,
          externalId: s.externalId,
          name: s.name,
          series: s.series ?? null,
          releaseDate: s.releaseDate ?? null,
          year: yearFromReleaseDate(s.releaseDate),
        });
      }
    }
    // v1.33 (P-27, §4.31d): pliega el subset en su principal (Celebrations una vez) + `partSetIds?`.
    const folded = await this.foldStorefrontSets([...setMap.values()]);
    const sets = folded
      .map((s) => ({
        id: s.id,
        name: s.name,
        releaseDate: s.releaseDate,
        year: s.year,
        ...(s.partSetIds ? { partSetIds: s.partSetIds } : {}),
      }))
      .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));

    const prices = rows.map((r) => r.dto.salePriceCents ?? 0);
    return {
      rarities,
      sets,
      productTypes,
      sealedSubtypes,
      finishes,
      price: {
        minCents: prices.length ? Math.min(...prices) : 0,
        maxCents: prices.length ? Math.max(...prices) : 0,
        currency: 'MXN' as const,
      },
    };
  }

  async getCard(cardId: string) {
    const card = await this.prisma.card.findUnique({
      where: { id: cardId },
      include: { set: true },
    });
    if (!card) throw BusinessException.notFound();
    // H9 / SB-D5: la ficha del single excluye el sellado (P-35 lo ancla a esta carta) — guardarraíl interino.
    const rows = await this.fetchSellable(this.singlesPublishedWhere({ cardId }));
    // v1.22-2 / N-15 (§4.22a-6): displayFinishes de la ficha usa los acabados priceados de la carta.
    const pricedByCard = await this.pricing.getPricedRawFinishesBatch([cardId]);
    // v1.44-graded-estimate (§4.35c): +1 query constante (batch de UN cardId; 0 si el dial está off).
    const grading = await this.loadGradingContext(rows);
    // v1.38-grouped-listings (P-30, §4.9a): `listings` = publicaciones AGRUPADAS (una por
    // (productType,gradeKey,finish) con stockCount≥1), cheapest-first — es la grilla de la ficha.
    const listings = this.buildGroups(rows, grading)
      .sort((a, b) => a.salePriceCents - b.salePriceCents)
      .map((g) => g.dto);
    // `units` = TODAS las piezas vendibles POR-PIEZA (cheapest-first) para el add-to-cart por
    // inventoryItemId (el carrito sigue por-pieza, §4-G) y para exponer el certNumber de cada slab.
    const units = [...rows]
      .sort((a, b) => (a.dto.salePriceCents ?? 0) - (b.dto.salePriceCents ?? 0))
      .map((r) => r.dto);

    // v1.44-graded-estimate (§4.35-0/e, API_CONTRACT §2) — FICHA: `gradedEstimates` a nivel de CARTA y
    // **SIN gatear** (informar ≠ promover). Se emite siempre que haya dato FRESCO, aunque el gate de
    // curaduría NO se cumpla y la carta no salga destacada en Compra ni en el home: eso es exactamente
    // lo buscado, no una inconsistencia. Los grados son INDEPENDIENTES (PSA 10 sin PSA 9 ⇒ un elemento).
    // NUNCA aparece sin grupos RAW publicados (una gradeada o un sellado jamás lo traen, criterio 87).
    const hasPublishedRawGroup = listings.some((l) => l.productType === 'raw');
    const gradedEstimates = grading
      ? selectGradedEstimates<GradedEstimateRef>({
          productType: hasPublishedRawGroup ? 'raw' : 'graded',
          estimates: grading.byCard.get(cardId) ?? [],
          today: grading.today,
          cfg: grading.cfg,
        }).map(toGradedEstimateDTO)
      : [];

    return {
      card: toCardDTO(card, pricedByCard.get(cardId)),
      listings,
      units,
      // Sin ningún grado que exponer ⇒ el campo se OMITE (nunca `[]`): el front no pinta NADA — ni
      // contenedor, ni skeleton, ni «—», ni $0, ni «pendiente» (criterio 84).
      ...(gradedEstimates.length > 0 ? { gradedEstimates } : {}),
    };
  }

  /**
   * v1.44-graded-estimate (§4.35d, API_CONTRACT §M2) — DIAGNÓSTICO DE CURADURÍA
   * (`GET /admin/pricing/graded-estimates/preview?cardId=`, `super_admin`, read-only): responde
   * «¿por qué esta carta no está destacada?». Es el ÚNICO lugar donde los insumos del gate se exponen —
   * al ADMIN, jamás al cliente — y su existencia es lo que permite que el DTO público sea tan chico.
   *
   * Una entrada **por grupo raw publicado** (la misma `K` de `GroupedListingDTO`). `groups: []` = la
   * carta no tiene ningún grupo raw publicado (NO es un error). Money-safe: todo monto no resoluble es
   * `null`, **nunca `0`**. No escribe nada y no toca dinero.
   *
   * A diferencia del storefront, el batch se lee **aunque el dial esté `off`** (si no, el diagnóstico
   * sería inútil justo en el estado por defecto): el gate devuelve `FEATURE_OFF` y todos los montos que
   * dependen del escalón quedan en `null`.
   */
  async gradedEstimatePreview(cardId: string) {
    const card = await this.prisma.card.findUnique({ where: { id: cardId }, select: { id: true } });
    if (!card) throw BusinessException.notFound();
    // Config COMPLETA (no la abreviada del storefront): el editor de M2 necesita ver los escalones y
    // los umbrales aunque el interruptor maestro esté apagado.
    const cfg = await this.pricing.loadGradedEstimateConfigForAdmin();
    const rows = await this.fetchSellable(this.singlesPublishedWhere({ cardId }));
    const estimates = (await this.pricing.getGradedEstimatesBatch([cardId])).get(cardId) ?? [];
    const today = businessDateCdmx();
    const groups = this.buildGroups(rows)
      .filter((g) => g.dto.productType === 'raw')
      .sort((a, b) => a.salePriceCents - b.salePriceCents)
      .map((g) => {
        const r: GradingHighlightResult<GradedEstimateRef> = evaluateGradingHighlight<GradedEstimateRef>({
          productType: 'raw',
          rawSalePriceCents: g.salePriceCents,
          estimates,
          today,
          cfg,
        });
        return {
          representativeInventoryItemId: g.dto.representativeInventoryItemId,
          finish: g.dto.finish,
          salePriceCents: g.salePriceCents,
          psa10MxnCents: r.psa10MxnCents,
          psa9MxnCents: r.psa9MxnCents,
          capturedDate: r.capturedDate,
          stale: r.stale,
          gradingCostTier: r.gradingCostTier,
          gradingCostMxnCents: r.gradingCostMxnCents,
          thresholdMxnCents: r.thresholdMxnCents,
          netUpsidePsa9MxnCents: r.netUpsidePsa9MxnCents,
          eligible: r.eligible,
          ...(r.reason ? { reason: r.reason } : {}),
        };
      });
    // `config` = la config EFECTIVA (la misma que usa el resolver, ya saneada fail-closed): si el admin
    // ve `gradingCostTiers: []` aquí, eso ES la explicación de por qué nada se destaca.
    return { cardId, enabled: cfg.enabled, config: cfg, groups };
  }

  async getListing(inventoryItemId: string) {
    // v1.1: un item no publicado / sin precio resoluble NO es visible en Compra → 404.
    const rows = await this.fetchSellable(this.publishedWhere({ id: inventoryItemId }));
    if (rows.length === 0) throw BusinessException.notFound();
    return rows[0].dto;
  }

  /**
   * v1.3 — Búsqueda pública sobre TODA la tabla `Card` para el picker del cotizador
   * (API_CONTRACT §6 `GET /buylist/cards`). A diferencia de `listCards` ("Compra"), NO
   * filtra por inventario ni por precio: **cualquier** carta importada es cotizable, aunque
   * NO la tengamos en bóveda. Se reutiliza `CardDTO` (sin `sellable`/`salePriceCents`).
   */
  async searchAllCards(params: {
    setId?: string;
    q?: string;
    rarity?: string;
    page: number;
    pageSize: number;
  }) {
    const where: Prisma.CardWhereInput = {};
    if (params.setId) where.setId = params.setId;
    if (params.rarity) where.rarity = params.rarity;
    if (params.q) {
      // Coincide con nombre (contains, case-insensitive) y/o número de carta.
      where.OR = [
        { name: { contains: params.q, mode: 'insensitive' } },
        { number: { contains: params.q, mode: 'insensitive' } },
      ];
    }
    const skip = (params.page - 1) * params.pageSize;
    const [rows, total] = await Promise.all([
      this.prisma.card.findMany({
        where,
        include: { set: true },
        // ORDEN NORMATIVO v1.22 (API_CONTRACT §6 / ARCHITECTURE §4.22b). Se aplica EN LA BASE DE
        // DATOS, antes de paginar: ordenar tras el skip/take reordenaría la PÁGINA, no el conjunto
        // (orden global incorrecto + filas repetidas/saltadas). Con `setId` (binder del cotizador)
        // el orden es natural puro; sin él, nombre primero. Antes de v1.22 era
        // `[{name},{number}]` con `number` como String ("10" antes que "2") — defecto ORD-1.
        orderBy: params.setId ? CARD_ORDER_BY_IN_SET : CARD_ORDER_BY_GLOBAL,
        skip,
        take: params.pageSize,
      }),
      this.prisma.card.count({ where }),
    ]);
    // v1.22-2 / N-15 (§4.22a-6): picker del cotizador — acabados priceados EN LOTE (sin N+1) para
    // displayFinishes; el front pinta una tarjeta por acabado de displayFinishes (oculta el espurio).
    const pricedByCard = await this.pricing.getPricedRawFinishesBatch(rows.map((c) => c.id));
    return {
      data: rows.map((c) => toCardDTO(c, pricedByCard.get(c.id))),
      page: params.page,
      pageSize: params.pageSize,
      total,
    };
  }

  /**
   * v1.3 — Sets que tienen cartas importadas (API_CONTRACT §6 `GET /buylist/sets`), para
   * poblar el dropdown del cotizador. A diferencia de `listSets` (solo sets con inventario
   * publicado), aquí aparecen TODOS los sets del catálogo con al menos una carta. `year`
   * derivado de `releaseDate`.
   *
   * Orden (fix del dropdown «Filtrar por set»): `releaseDate` COMPLETA descendente (no solo
   * el año — dos sets del mismo año quedan por fecha exacta), desempate por `name` asc, y
   * los sets SIN `releaseDate` al final (también por nombre), en vez de mezclados como si
   * fueran los más antiguos.
   */
  async listSetsWithImportedCards() {
    const sets = await this.prisma.cardSet.findMany({
      where: { cards: { some: {} } },
      select: { id: true, name: true, series: true, releaseDate: true },
    });
    // `releaseDate` viene de pokemontcg.io como `yyyy/MM/dd`, por lo que la comparación
    // lexicográfica de strings equivale a la cronológica con la fecha completa.
    const byName = (a: { name: string }, b: { name: string }) =>
      a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true });
    const data = sets
      .map((s) => ({
        id: s.id,
        name: s.name,
        series: s.series ?? null,
        releaseDate: s.releaseDate ?? null,
        year: yearFromReleaseDate(s.releaseDate),
      }))
      .sort((a, b) => {
        if (a.releaseDate && b.releaseDate) {
          if (a.releaseDate !== b.releaseDate) return a.releaseDate < b.releaseDate ? 1 : -1;
          return byName(a, b);
        }
        if (a.releaseDate) return -1; // b sin fecha → al final
        if (b.releaseDate) return 1; // a sin fecha → al final
        return byName(a, b);
      });
    return { data };
  }

  /** Sets con inventario publicado y comprable, con `year` derivado, ordenados por año desc. v1.1. */
  async listSets() {
    const rows = await this.fetchSellable(this.publishedWhere());
    const setMap = new Map<
      string,
      { id: string; externalId: string; name: string; series: string | null; releaseDate: string | null; year: number | null }
    >();
    for (const { item } of rows) {
      const s = item.card.set;
      if (s && !setMap.has(s.id)) {
        setMap.set(s.id, {
          id: s.id,
          externalId: s.externalId,
          name: s.name,
          series: s.series ?? null,
          releaseDate: s.releaseDate ?? null,
          year: yearFromReleaseDate(s.releaseDate),
        });
      }
    }
    // v1.33 (P-27, §4.31d): pliega el subset en su principal (Celebrations una vez) + `partSetIds?`.
    const folded = await this.foldStorefrontSets([...setMap.values()]);
    const data = folded
      .map((s) => ({
        id: s.id,
        name: s.name,
        series: s.series,
        releaseDate: s.releaseDate,
        year: s.year,
        ...(s.partSetIds ? { partSetIds: s.partSetIds } : {}),
      }))
      .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    return { data };
  }
}

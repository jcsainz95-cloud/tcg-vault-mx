/**
 * sale-decision.service.ts — 💰 v1.113⟨portada⟩ (API_CONTRACT §DYN.5.1, ARCHITECTURE §4.DYN (e)): **EL cuerpo único del precio
 * de venta de una pieza.** Es `resolveSaleDecision` + `derivedSaleDecision`, EXTRAÍDOS sin cambiar su resultado de
 * `orders.service.ts` (fase 2 de §DYN), para que el escritor del precio del día (`ListingPriceService`), el checkout y el
 * cálculo en vivo de una pieza sin fila (catálogo y checkout) pasen por el MISMO código. ⛔ Una segunda copia del cálculo
 * es un defecto (§DYN.5.1).
 *
 * Dos modos de carga, UN cuerpo:
 *  - sin `batch` (una pieza): lee referencia, override de variante, curva y política por sí mismo (lo de siempre del
 *    checkout);
 *  - con `batch` (`loadBatch`): las mismas entradas izadas UNA vez para un lote (lo de siempre de `fetchSellable`, BE-25).
 * `computeSalePriceForItem` = `loadPricingCurve` + `loadSalePremiumFloorPolicy` + `decideSalePrice`
 * (`pricing.service.ts:3342-3353`): las dos ramas dan el mismo veredicto por construcción.
 */
import { Injectable } from '@nestjs/common';
import { Card, CardLanguage, CardSet, Finish, InventoryItem, MarketBracket, ProductType, VariantPriceOverride } from '@prisma/client';
import { BusinessException } from '../../common/business.exception';
import { manualSaleOf, PriceBasis, saleDisplayCentsOf, sealedPriceBasisOf } from '../../common/money';
import type { IvaDials, SealedProductSaleRef } from '../../common/money';
import { marketBracketOf, PremiumFloorPolicy, PricingCurve } from '../../common/pricing-curve';
import { variantKey } from '../../common/variant-key';
import { isDefaultVersion, PieceVersion, pieceVersionOf, scaleByPct, StampRef, versionKeyOf } from '../../common/card-version';
import { cardProductRefKey, PriceInfo, PricingService } from './pricing.service';

/**
 * 💰 v1.116⟨ids⟩ (§IDS.2/.4) — por qué una VERSIÓN no tiene precio publicable (`unavailableReason` de la captura). Viaja en
 * `details.reason` del `PRICE_PENDING` que lanza el cuerpo para una versión distinta de (inglés, sin liga).
 */
export type VersionPendingReason = 'no_english_market' | 'no_stamped_market' | 'premium_at_floor' | 'no_market';

/** La política del guardarraíl que «publica todo»: el de una versión ya se evaluó sobre SU referencia sin X (§IDS.2). */
const GUARD_ALREADY_EVALUATED: PremiumFloorPolicy = Object.freeze({ mode: 'all', rarities: [] as readonly string[] }) as PremiumFloorPolicy;

/**
 * 💰 v1.83 (§M11-SP.1, SP-3) — una pieza tal como la precia el cuerpo de venta: con su carta **y el precio del dueño de su
 * producto** (`SEALED_SALE_PRICE_INCLUDE`). `sealedProduct` es obligatoria en el tipo: una lectura que la olvide no llega
 * aquí.
 */
export type SaleItem = InventoryItem & {
  card: Card & { set?: CardSet | null };
  sealedProduct: SealedProductSaleRef | null;
};

/**
 * 💰 v1.116.4⟨ids⟩ (API_CONTRACT §IDS.2 «Valor de patrimonio», D-IDS-R) — lo que el cuerpo LEE de una pieza para resolver su
 * versión y su referencia de entrada: identidad de variante e identidad de versión, ⛔ sin carta ni precio a mano. Con `Pick` el
 * compilador dice qué columnas hacen falta (antes `as unknown as SaleItem` lo callaba y un `select` sin `language` valuaba una
 * española como inglesa sin que nada fallara).
 */
export type VersionPiece = Pick<
  InventoryItem,
  'cardId' | 'productType' | 'finish' | 'rawCondition' | 'gradingCompany' | 'gradeValue' | 'tcgplayerProductId' | 'language' | 'cardProductId'
>;

/**
 * v1.116.4⟨ids⟩ (D-IDS-R, techlead R2) — una pieza HIPOTÉTICA raw NM de plataforma, sin precio a mano (captura `GET …/versions`,
 * costo de una aportación): la fila COMPLETA, tipada, sin `as unknown as SaleItem`. No se persiste. Una columna nueva de
 * `InventoryItem` no compila aquí hasta que alguien decide su valor hipotético (antes el cast la dejaba `undefined` en silencio).
 */
export function hypotheticalRawSaleItem(p: {
  id: string;
  folio: string;
  card: Card & { set?: CardSet | null };
  finish: Finish;
  language: CardLanguage;
  cardProductId: number | null;
}): SaleItem {
  const epoch = new Date(0);
  return {
    id: p.id,
    folio: p.folio,
    cardId: p.card.id,
    card: p.card,
    productType: 'raw',
    rawCondition: 'NM',
    sealedSubtype: null,
    sealedCondition: null,
    gradingCompany: null,
    gradeValue: null,
    certNumber: null,
    locationId: null,
    ownerType: 'platform',
    ownerUserId: null,
    ownershipStatus: null,
    status: 'in_stock',
    finish: p.finish,
    language: p.language,
    listPriceCents: null,
    acquisitionType: 'compra',
    acquisitionCostCents: null,
    acquisitionCostIvaCents: 0,
    acquisitionPct: null,
    sourceSellRequestItemId: null,
    supplyPurchaseId: null,
    cardProductId: p.cardProductId,
    tcgplayerProductId: null,
    tcgplayerGroupId: null,
    sealedImageUrl: null,
    sealedProductName: null,
    sealedProductId: null,
    sealedProduct: null,
    reservedByOrderId: null,
    reservedUntil: null,
    firstListedAt: null,
    createdAt: epoch,
    updatedAt: epoch,
  };
}

/**
 * v2.0 (P-48, §4.36.7c / PROJECT §N.8) — la DECISIÓN de venta de UNA pieza: el monto y los cuatro datos de
 * instrumentación que se congelan con él. El quinto dato de §N.8 (el precio final) ES `unitPriceCents`.
 */
export interface SaleDecision {
  /**
   * ⭐⭐ **`P` — el precio EXHIBIDO, con el IVA DENTRO** (`ARCHITECTURE §4.44.b`, criterio **194**). Es lo que el cliente
   * ve, lo que suma el carrito y **lo que se congela en `OrderItem`**. Se redondea **una vez por unidad** (regla **R1**).
   */
  unitPriceCents: number;
  /**
   * ⭐ **`L` — el precio de LISTA, SIN IVA**, del que se derivó `P`. No se persiste en la orden; la instrumentación de §N.8 y
   * los gates de curaduría razonan sobre él. *Mezclarlos es cómo un margen se compara contra un precio con impuesto dentro.*
   */
  listPriceCents: number;
  /**
   * 💰 v1.83.1 (`API_CONTRACT §M11-SP.12.3`) — **`P` fijo del dueño** (precio del producto sellado, IVA dentro), o `null`.
   * Con él, `derive` cobra ESE entero tal cual (`saleDisplayCentsOf`). ⛔ Jamás `P` desde su `L` equivalente.
   */
  fixedDisplayCents: number | null;
  priceBasis: PriceBasis;
  /** Mercado CRUDO en centavos que entró al cálculo. `null` = no lo hubo (jamás un 0 inventado). */
  marketMxnCents: number | null;
  marketBracket: MarketBracket | null;
  finish: Finish;
}

/** Los spreads del sellado tal como los iza `PricingService.loadSealedSpreads`. */
export type SealedSpreadsCtx = Awaited<ReturnType<PricingService['loadSealedSpreads']>>;

/** Las entradas del cuerpo, izadas UNA vez para un lote (BE-25: sin N+1). */
export interface SaleDecisionBatch {
  /** `null` ⇔ el lote no trae piezas raw/graded que deriven por la curva (no se leyó). */
  curve: PricingCurve | null;
  premiumFloorPolicy: PremiumFloorPolicy | null;
  /** `null` ⇔ el lote no trae sellado (no se leyó). */
  sealedSpreads: SealedSpreadsCtx | null;
  /** Referencias de mercado por `variantKey` (sellado: su clave de mercado `sealed:tcg:<productId>`, acabado `normal`). */
  refs: Map<string, PriceInfo>;
  /** Override de variante M-30 por `variantKey` (solo raw/graded sin precio a mano). */
  variantOverrides: Map<string, VariantPriceOverride>;
  /** v1.116⟨ids⟩ (§IDS.2): productos de LIGA de las piezas del lote (`tcgplayerProductId → StampRef`). */
  stamps: Map<number, StampRef>;
  /** v1.116⟨ids⟩: referencias de los productos de liga del lote, por `cardProductRefKey` (sin retención, D-IDS-G). */
  stampedRefs: Map<string, PriceInfo>;
  /** v1.116⟨ids⟩: X leído UNA vez por lote; `null` ⇔ el lote no trae piezas `es` o el dial es inválido (falla cerrado). */
  spanishPct: number | null;
  /** v1.116.2⟨ids⟩ (D-IDS-1): `cardProductId` del lote que son `promo`/`deck_exclusive` (⇒ `pending`). Ausente ⇒ ninguno. */
  separateProducts?: Set<number>;
}

/**
 * 💰 v1.116.4⟨ids⟩ (§IDS.2, D-IDS-R) — las entradas de VERSIÓN de un lote (`loadVersionInputs`): productos de liga, sus
 * referencias, productos separados y X. `loadBatch` = esto + curva, política, spreads, referencias retenidas y overrides. La
 * puerta de patrimonio lee SOLO esto (patrimonio no es venta: sin curva, política ni retención, DYN.5.9).
 */
export type VersionInputs = Pick<SaleDecisionBatch, 'stamps' | 'stampedRefs' | 'spanishPct'> & { separateProducts: Set<number> };

/** Las entradas de `versionReferences`: las de versión más el mapa de referencias de la carta base (`R_en` sale de ahí). */
export type VersionRefInputs = Pick<SaleDecisionBatch, 'stamps' | 'stampedRefs' | 'spanishPct' | 'refs'>;

/**
 * 💰 v1.113.3 (API_CONTRACT §DYN.5.5) — el «valor de mercado» que la tienda EXHIBE junto a `P`: la referencia de la pieza tal
 * como la vio el lote que derivó `P`, con el gate del sellado (`gateSealedMarketCents`: fuente y dial) ya aplicado.
 * `referenceMxnCents === null` ⇔ sin mercado exhibible. Es lo que guarda la fila (`referenceMxnCents`,
 * `referenceCapturedDate`); ⛔ no es `marketMxnCents` (instrumentación §N.8, otra semántica).
 */
export interface ExhibitedReference {
  referenceMxnCents: number | null;
  /** `YYYY-MM-DD`; `null` ⇔ `referenceMxnCents === null`. */
  capturedDate: string | null;
}

/** La proyección de §DYN.5.5: `referenceMxnCents ≠ null ? priced : pending` (las proyecciones públicas van encima). */
export function referenceInfoOf(r: ExhibitedReference): PriceInfo {
  if (r.referenceMxnCents == null) return { status: 'pending' };
  return {
    status: 'priced',
    referenceMxnCents: r.referenceMxnCents,
    ...(r.capturedDate != null ? { capturedDate: r.capturedDate } : {}),
  };
}

/** ¿Es el rechazo «sin precio publicable»? (el único que un lector convierte en «no se exhibe»). */
export function isPricePending(e: unknown): e is BusinessException {
  return e instanceof BusinessException && e.code === 'PRICE_PENDING';
}

@Injectable()
export class SaleDecisionService {
  constructor(private readonly pricing: PricingService) {}

  /**
   * Las referencias de mercado de un lote en UNA lectura (`getReferencesBatch`; ausente ⇒ `pending`, misma regla que
   * `getReference`). Para el sellado, su clave de mercado; para el resto, la de su variante.
   *
   * 💰 v1.114 (§DYN.5.9): **con la retención del candado ya aplicada** — una variante raw/graded con caso de revisión vigente
   * (`open`/`kept`) y sin override tier 0 entra con el último sano del caso (sin base, el mínimo fresco admitido, v1.114.3; ninguno ⇒ `pending`), no con la mediana que trae el
   * pico (`PricingService.saleRetentionFor`). Es la ENTRADA del cuerpo: `P`, la instrumentación y el «valor de mercado» que la
   * fila congela (§DYN.5.5) salen del mismo número. ⛔ Solo el cuerpo de venta: los demás lectores de `getReferencesBatch`
   * (bóveda, portafolio, cotizador, admin) no cambian.
   */
  async loadReferences(items: readonly VersionPiece[], stamps: ReadonlyMap<number, StampRef> = new Map()): Promise<Map<string, PriceInfo>> {
    const keys = items.flatMap((i): { cardId: string; productType: ProductType; gradeKey: string; finish: Finish }[] => {
      // v1.116⟨ids⟩: una pieza de liga no lee la referencia de la carta base (I-2).
      // §ALTA-LIGA-2: SALVO la versión de liga MANUAL (productId < 0): mientras no tenga mercado propio hereda el de la normal, y
      // para eso el lote necesita la referencia de la base (`versionReferences`, el único punto).
      if (i.cardProductId != null && stamps.has(i.cardProductId) && stamps.get(i.cardProductId)?.inheritsBase !== true) return [];
      const k = this.refKeyOf(i);
      return k ? [k] : [];
    });
    const refs = await this.pricing.getReferencesBatch(keys);
    // El sellado no tiene candado (§DYN.5.9): un lote solo de sellado no consulta casos.
    const lockable = keys.filter((k) => k.productType !== 'sealed');
    if (lockable.length > 0) {
      for (const [k, held] of await this.pricing.saleRetentionFor(lockable)) refs.set(k, held);
    }
    return refs;
  }

  /** La referencia de una pieza dentro de un mapa de `loadReferences` (`undefined` ⇒ sin referencia ⇒ `pending`). */
  referenceIn(refs: ReadonlyMap<string, PriceInfo>, item: VersionPiece): PriceInfo | undefined {
    const k = this.refKeyOf(item);
    return k ? refs.get(variantKey(k)) : undefined;
  }

  /**
   * 💰 v1.113.3 (§DYN.5.5) — el «valor de mercado» EXHIBIBLE de una pieza, leído del MISMO lote con que se deriva su `P`:
   * sellado ⇒ el de TCGCSV solo si `gateSealedMarketCents` lo deja pasar (fuente `manual` siempre; `tcgcsv` con el dial
   * encendido; `≤ 0` nunca); resto ⇒ la referencia `priced` de su variante. Antes de v1.113.3 esto lo hacía cada lector de
   * la tienda con una lectura en vivo (`catalog.service.ts` `toListingRow`, `sealed-catalog.service.ts` `toGroupDTO`).
   */
  exhibitedReferenceOf(item: SaleItem, batch: SaleDecisionBatch): ExhibitedReference {
    // 💰 v1.116.2⟨ids⟩ (D-IDS-1): una pieza de un producto separado no exhibe el mercado de la base.
    if (this.isSeparateProduct(item, batch)) return { referenceMxnCents: null, capturedDate: null };
    const v = this.versionOf(item, batch);
    if (!isDefaultVersion(v)) {
      // 💰 v1.116⟨ids⟩ (§IDS.2, 959): español ⇒ sin valor de mercado SIEMPRE; (en, P) ⇒ el de SU producto, nunca el de la base.
      if (v.language === 'es' || item.productType !== 'raw') return { referenceMxnCents: null, capturedDate: null };
      return this.exhibited(item, this.stampedRefOf(item, v, batch), false);
    }
    return this.exhibited(item, this.referenceIn(batch.refs, item), batch.sealedSpreads?.sourceOn ?? false);
  }

  /** Lo mismo para UNA pieza sin lote (lecturas sueltas de siempre: `referenceOf` y, en sellado, el dial de su fuente). */
  async exhibitedReferenceSingle(item: SaleItem): Promise<ExhibitedReference> {
    // v1.116⟨ids⟩: una versión distinta de (en, sin liga) se lee por el camino del lote (un lote de una pieza).
    if (item.cardProductId != null || !isDefaultVersion(await this.versionSingle(item))) {
      return this.exhibitedReferenceOf(item, await this.loadBatch([item]));
    }
    const sourceOn = item.productType === 'sealed' ? (await this.pricing.loadSealedSpreads()).sourceOn : false;
    return this.exhibited(item, await this.referenceOf(item), sourceOn);
  }

  private exhibited(item: SaleItem, ref: PriceInfo | undefined, sealedSourceOn: boolean): ExhibitedReference {
    const cents =
      item.productType === 'sealed'
        ? this.pricing.gateSealedMarketCents(ref, sealedSourceOn)
        : ref?.status === 'priced'
          ? (ref.referenceMxnCents ?? null)
          : null;
    return { referenceMxnCents: cents, capturedDate: cents != null ? (ref?.capturedDate ?? null) : null };
  }

  /**
   * Las entradas del cuerpo para un LOTE de piezas, en UNA lectura cada una (el «pago mínimo» de BE-25 que hacía
   * `fetchSellable`): curva, política, spreads, referencias (con la retención del candado, v1.114) y overrides de variante.
   */
  async loadBatch(items: readonly SaleItem[]): Promise<SaleDecisionBatch> {
    // Solo se lee lo que el lote necesita: curva y política si hay raw/graded que derivan; spreads si hay sellado.
    const derives = items.some((i) => i.productType !== 'sealed' && manualSaleOf(i) == null);
    const curve = derives ? await this.pricing.loadPricingCurve() : null;
    // v1.80.8.5 (`M2-PF`): la política de VENTA, izada UNA vez por lote (como la curva).
    const premiumFloorPolicy = derives ? await this.pricing.loadSalePremiumFloorPolicy() : null;
    // v1.23-sealed-sales (§4.23d): spreads del sellado izados UNA vez.
    const sealedSpreads = items.some((i) => i.productType === 'sealed') ? await this.pricing.loadSealedSpreads() : null;
    // Para el SELLADO la clave es la de MERCADO (`sealed:tcg:<productId>`, acabado normal); un sellado no mapeado no
    // aporta clave (sin mercado). v1.53 (§4.40.4b): una graduada sin identidad de slab tampoco (⇒ `pending`).
    // v1.116⟨ids⟩ (§IDS.2): versiones del lote — productos de liga, sus referencias, productos separados y X (v1.116.4: un cuerpo,
    // `loadVersionInputs`, el mismo que lee la puerta de patrimonio).
    const { stamps, stampedRefs, spanishPct, separateProducts } = await this.loadVersionInputs(items);
    const refs = await this.loadReferences(items, stamps);
    // v1.28 (P-18, §4.26b): overrides de variante EN LOTE — solo raw/graded que DERIVAN su precio (sin precio a mano).
    // v1.116⟨ids⟩ (§IDS.2, D-IDS-L): y solo (en, sin liga) — el override es de la inglesa.
    const variantOverrides = !derives ? new Map<string, VariantPriceOverride>() : await this.pricing.getVariantOverridesBatch(
      items
        .filter((i) => i.productType !== 'sealed' && manualSaleOf(i) == null)
        .filter((i) => isDefaultVersion(pieceVersionOf(i, stamps)))
        .flatMap((i) => {
          const gk = this.pricing.tryGradeKeyFor(i);
          return gk ? [{ cardId: i.cardId, productType: i.productType, gradeKey: gk, finish: i.finish }] : [];
        }),
    );
    return { curve, premiumFloorPolicy, sealedSpreads, refs, variantOverrides, stamps, stampedRefs, spanishPct, separateProducts };
  }

  /**
   * 💰 v1.116.4⟨ids⟩ (API_CONTRACT §IDS.2, D-IDS-R) — las entradas de VERSIÓN de un lote, extraídas de `loadBatch` para que venta y
   * patrimonio lean lo mismo: productos de liga (`findStampedProducts`), sus referencias (`getReferencesByCardProductBatch`, sin
   * retención, D-IDS-G), productos separados (`findSeparateProductIds`) y X (`loadSpanishMarketPct`). Cada lectura ≤ 1 sin importar
   * N, y solo si el lote la necesita: sin `cardProductId` no hay liga ni producto separado; sin `es` no se lee X.
   */
  async loadVersionInputs(items: readonly VersionPiece[]): Promise<VersionInputs> {
    const withProduct = items.some((i) => i.cardProductId != null);
    const stamps = await this.stampsOf(items);
    const stampedKeys = items.flatMap((i) => {
      const st = i.cardProductId != null ? stamps.get(i.cardProductId) : undefined;
      const gk = st && i.productType === 'raw' ? this.pricing.tryGradeKeyFor(i) : null;
      return st && gk ? [{ cardProductId: st.internalId, productType: 'raw' as ProductType, gradeKey: gk, finish: i.finish }] : [];
    });
    const separateProducts = withProduct ? await this.pricing.findSeparateProductIds(items.map((i) => i.cardProductId)) : new Set<number>();
    const stampedRefs = stampedKeys.length > 0 ? await this.pricing.getReferencesByCardProductBatch(stampedKeys) : new Map<string, PriceInfo>();
    const spanishPct = items.some((i) => i.language === 'es') ? await this.pricing.loadSpanishMarketPct() : null;
    return { stamps, stampedRefs, spanishPct, separateProducts };
  }

  /**
   * v1.116⟨ids⟩ — los productos de LIGA de un conjunto de piezas (`tcgplayerProductId → StampRef`). Sin ningún `cardProductId` no
   * hay liga posible: ninguna lectura. UNA definición de «¿hay `cardProductId`? ⇒ `findStampedProducts`» (TL-IDS-4): la usan
   * `loadVersionInputs` y el catálogo.
   */
  async stampsOf(items: readonly Pick<VersionPiece, 'cardProductId'>[]): Promise<Map<number, StampRef>> {
    return items.some((i) => i.cardProductId != null)
      ? this.pricing.findStampedProducts(items.map((i) => i.cardProductId))
      : new Map<number, StampRef>();
  }

  /** v1.116.2⟨ids⟩ (D-IDS-1) — ¿la pieza es de un producto `promo`/`deck_exclusive`? */
  isSeparateProduct(item: Pick<SaleItem, 'cardProductId'>, batch: Pick<SaleDecisionBatch, 'separateProducts'>): boolean {
    return item.cardProductId != null && (batch.separateProducts?.has(item.cardProductId) ?? false);
  }

  /** v1.116⟨ids⟩ (§IDS.2) — la versión de una pieza dentro de un lote. */
  versionOf(item: Pick<SaleItem, 'language' | 'cardProductId'>, batch: Pick<SaleDecisionBatch, 'stamps'>): PieceVersion {
    return pieceVersionOf(item, batch.stamps);
  }

  /** v1.116⟨ids⟩ — la versión de UNA pieza sin lote (una lectura solo si trae `cardProductId`). */
  async versionSingle(item: Pick<SaleItem, 'language' | 'cardProductId'>): Promise<PieceVersion> {
    if (item.cardProductId == null) return { language: item.language ?? 'en', stamp: null };
    return pieceVersionOf(item, await this.pricing.findStampedProducts([item.cardProductId]));
  }

  /** La referencia del producto de liga de una pieza (`(en, P)`; sin fila ⇒ `undefined` ⇒ pending). */
  private stampedRefOf(item: VersionPiece, v: PieceVersion, batch: Pick<SaleDecisionBatch, 'stampedRefs'>): PriceInfo | undefined {
    const gk = this.pricing.tryGradeKeyFor(item);
    if (!v.stamp || gk == null) return undefined;
    return batch.stampedRefs.get(cardProductRefKey({ cardProductId: v.stamp.internalId, productType: 'raw', gradeKey: gk, finish: item.finish }));
  }

  /**
   * 💰 v1.116⟨ids⟩ (API_CONTRACT §IDS.2) — las referencias de ENTRADA de una versión distinta de (en, sin liga):
   * ```
   * (es, null) ⇒ guard = R_en (con la retención de DYN.5.9)  · price = R_en ×X  · motivo no_english_market
   * (en, P)    ⇒ guard = price = R_P (su producto)            · motivo no_stamped_market
   * (es, P)    ⇒ guard = R_P                                  · price = R_P ×X   · motivo no_stamped_market
   * ```
   * `guard` es sobre la que se evalúa el guardarraíl `premium_at_floor`; `price` la que entra a la curva. Solo raw (D-IDS-K):
   * graduada o sellado en una versión ⇒ sin referencia (pending). Sin X (dial inválido) ⇒ `price` pending.
   *
   * v1.116.4 (D-IDS-R): entrada `Pick` (`VersionPiece`, `VersionRefInputs`). La venta pasa el lote de `loadBatch` (`refs` CON la
   * retención de DYN.5.9); la puerta de patrimonio pasa sus `refs` SIN retención — por eso `R_en` de la bóveda es el vivo.
   * `capturedDate`/`source` son los de la referencia de entrada (`R_en` o `R_P`): el `M` de una reposición los lleva.
   */
  versionReferences(
    item: VersionPiece,
    v: PieceVersion,
    batch: VersionRefInputs,
  ): {
    guard: number | null;
    price: number | null;
    motive: 'no_english_market' | 'no_stamped_market' | 'no_market';
    capturedDate: string | null;
    source: PriceInfo['source'] | null;
    /** §ALTA-LIGA-2: `true` ⇒ la referencia es la de la carta NORMAL (versión manual sin mercado propio), no la del producto. */
    inherited: boolean;
  } {
    const inheritsBase = v.stamp?.inheritsBase === true;
    const motive = v.stamp ? 'no_stamped_market' : 'no_english_market';
    const none = { guard: null, price: null, motive, capturedDate: null, source: null, inherited: false } as const;
    if (item.productType !== 'raw') return none;
    const ref = v.stamp ? this.stampedRefOf(item, v, batch) : this.referenceIn(batch.refs, item);
    const guard = ref?.status === 'priced' ? (ref.referenceMxnCents ?? null) : null;
    if (guard == null) {
      // ⭐ §ALTA-LIGA-2 (API_CONTRACT_ALTA_LIGA §2.4/§4) — EL ÚNICO PUNTO DE LA HERENCIA: un producto con `inheritsBase` (versión manual, o el
      // real que la absorbió) sin `PriceReference` propia se precia como la carta NORMAL (sin sello) del mismo idioma y acabado: exactamente lo que
      // `(language, null)` daría (en ⇒ R_en; es ⇒ R_en ×X). Un producto real que no absorbió una manual NUNCA hereda; con mercado propio no se llega
      // aquí. Sin mercado en la normal tampoco ⇒ `no_market` (PRICE_PENDING como hoy).
      if (!inheritsBase) return none;
      const base = this.versionReferences(item, { language: v.language, stamp: null }, batch);
      if (base.guard == null) return { ...none, motive: 'no_market' };
      return { ...base, motive: 'no_market', inherited: true };
    }
    const price = v.language === 'es' ? (batch.spanishPct == null ? null : scaleByPct(guard, batch.spanishPct)) : guard;
    return { guard, price, motive, capturedDate: ref?.capturedDate ?? null, source: ref?.source ?? null, inherited: false };
  }

  /** El `gradeKey` canónico de una pieza, o `null` (graduada sin identidad de slab, v1.53). */
  gradeKeyOf(item: SaleItem): string | null {
    return this.pricing.tryGradeKeyFor(item);
  }

  /**
   * La clave de referencia de mercado de una pieza (sellado: la de mercado; resto: la de su variante), o `null`. Es también
   * la «variante» de una pieza para los disparadores `manual_price` (§DYN.5.3: solo las piezas que leen esa referencia).
   */
  refKeyOf(i: VersionPiece): { cardId: string; productType: ProductType; gradeKey: string; finish: Finish } | null {
    if (i.productType === 'sealed') {
      const gk = this.pricing.sealedMarketGradeKeyForItem(i);
      return gk ? { cardId: i.cardId, productType: 'sealed', gradeKey: gk, finish: 'normal' } : null;
    }
    const gk = this.pricing.tryGradeKeyFor(i);
    return gk ? { cardId: i.cardId, productType: i.productType, gradeKey: gk, finish: i.finish } : null;
  }

  /**
   * La referencia de mercado de una pieza: la del lote o, sin lote, leída aquí. Sellado ⇒ la de MERCADO TCGCSV (`undefined`
   * si no está mapeado); resto ⇒ la de su variante (`pending` sin identidad de slab, v1.53), con la retención del candado
   * aplicada igual que en `loadReferences` (v1.114, §DYN.5.9).
   */
  async referenceOf(item: SaleItem, batch?: SaleDecisionBatch): Promise<PriceInfo | undefined> {
    if (batch) return this.referenceIn(batch.refs, item);
    if (item.productType === 'sealed') return this.pricing.getSealedMarketRef(item);
    const gk = this.pricing.tryGradeKeyFor(item);
    if (gk == null) return { status: 'pending' };
    const key = { cardId: item.cardId, productType: item.productType, gradeKey: gk, finish: item.finish };
    const held = (await this.pricing.saleRetentionFor([key])).get(variantKey(key));
    return held ?? this.pricing.getReference(item.cardId, item.productType, gk, item.finish);
  }

  /**
   * ⭐⭐ **LA DERIVACIÓN DE `P`, EN EL ÚNICO SITIO POR EL QUE PASA TODO PRECIO DE VENTA CALCULADO** (`ARCHITECTURE
   * §4.44.b/.c`, `API_CONTRACT §M10-IVA.3`, criterio **185**). `resolve` da `L` por las precedencias de §4.36.6 y termina
   * aquí: `P = round(L × (1 + t·r))` — o, con precio del dueño, su `P` tal cual (E-3, SP-19).
   *
   * ⚠️ `marketMxnCents` y `marketBracket` NO se derivan: siguen en la escala del MERCADO (§N.8).
   */
  private derive(d: SaleDecision, dials: IvaDials): SaleDecision {
    return { ...d, unitPriceCents: saleDisplayCentsOf(d, dials) };
  }

  /**
   * 💰 **El cuerpo de §DYN.5.1** — la decisión de venta COMPLETA de una pieza, con `P` ya derivado con `dials`. Lanza
   * `PRICE_PENDING` (422) si la pieza no tiene precio publicable. ⛔ No mira el `status` ni el dueño de la pieza: eso es de
   * quien la lee (`isSellable` del checkout, `listed` del catálogo).
   */
  async decide(item: SaleItem, dials: IvaDials, batch?: SaleDecisionBatch): Promise<SaleDecision> {
    return this.derive(await this.resolve(item, dials, batch), dials);
  }

  /**
   * v2.0 (P-48, §4.36.7c / PROJECT §N.8) — la DECISIÓN antes de derivar `P`: el monto `L` Y la instrumentación que se
   * congela con él. Los cinco datos de §N.8 salen del MISMO cálculo que fijó el precio: reconstruirlos después sería medir
   * otra cosa. (Cuerpo movido sin cambios de `orders.service.ts` `resolveSaleDecision`, v1.113⟨portada⟩.)
   */
  private async resolve(item: SaleItem, dials: IvaDials, batch?: SaleDecisionBatch): Promise<SaleDecision> {
    // Sin mercado (override/bounty sin referencia, o pendiente): `marketMxnCents`/`marketBracket` van en `null`. Honesto;
    // jamás un 0 inventado (§4.36.7c).
    const instrument = (
      listPriceCents: number,
      basis: PriceBasis,
      marketMxnCents: number | null,
      fixedDisplayCents: number | null = null,
    ): SaleDecision => ({
      // ⚠️ `unitPriceCents` sale IGUAL a `L` aquí y lo DERIVA `derive` (el único sitio). Cuatro derivaciones serían
      // cuatro sitios donde una puede faltar — y la que falte cobra el precio sin IVA sin que nada falle.
      unitPriceCents: listPriceCents,
      listPriceCents,
      fixedDisplayCents,
      priceBasis: basis,
      marketMxnCents,
      marketBracket: marketBracketOf(marketMxnCents),
      finish: item.finish,
    });
    // 💰 v1.83 (§M11-SP.1, SP-2): «tiene precio a mano» ⇔ `manualSaleOf(item) != null` — EL predicado único. En sellado,
    // el precio del dueño del PRODUCTO va antes que el de la pieza (legado, queda sombreado).
    const manual = manualSaleOf(item);
    if (manual?.origin === 'piece') {
      // Peldaño 1 de la precedencia de VENTA (raw/graded) / peldaño 2 del sellado (legado): override POR PIEZA ⇒ `override`.
      return instrument(manual.listCents, 'override', null);
    }
    // v1.23-sealed-sales (§4.23d): el SELLADO deriva por el resolvedor ÚNICO `resolveSealedSalePrice`: precio del producto
    // > mercado×spread > PRICE_PENDING (money-safe). SEC-A1: todo server-side.
    // 💰 v1.116.2⟨ids⟩ (API_CONTRACT §IDS.2 «Producto separado», D-IDS-1, IDS-B17): `promo`/`deck_exclusive` ⇒ SIN referencia ⇒
    // `pending` (no se publica). ⛔ Nunca la referencia de la carta base. El precio por pieza (arriba) sigue de respaldo.
    if (item.cardProductId != null && item.productType !== 'sealed') {
      const b = batch ?? (await this.loadBatch([item]));
      if (this.isSeparateProduct(item, b)) {
        throw BusinessException.validation('PRICE_PENDING', `Item ${item.folio} is a separate product (promo/deck exclusive) without its own price`, {
          reason: 'no_market',
        });
      }
    }
    if (item.productType === 'sealed' && item.language === 'es') {
      // v1.116⟨ids⟩ (D-IDS-K): solo raw NM en una versión; un sellado en español no se precia (falla cerrado).
      throw this.versionPending(item, { language: 'es', stamp: null }, 'no_english_market');
    }
    if (item.productType === 'sealed') {
      const ctx = batch?.sealedSpreads ?? (await this.pricing.loadSealedSpreads());
      const marketRef = batch ? await this.referenceOf(item, batch) : await this.pricing.getSealedMarketRef(item);
      const sale = this.pricing.resolveSealedSalePrice(item, marketRef, ctx, dials);
      // BE-26 (money-safety): un precio de venta <= 0 (p. ej. regla `fixed:0`) NO es vendible.
      if (sale.salePriceCents == null || sale.salePriceCents <= 0) {
        throw BusinessException.validation('PRICE_PENDING', `Item ${item.folio} has no price`);
      }
      // §4.36.7a: el SELLADO no cambia de matemática; su basis se DERIVA de `priceSource`. Con el precio del dueño el
      // mercado no produjo el precio ⇒ `null`.
      const sealedMarket = sale.source === 'override' ? null : this.pricing.gateSealedMarketCents(marketRef, ctx.sourceOn);
      return instrument(sale.salePriceCents, sealedPriceBasisOf(sale), sealedMarket, sale.fixedDisplayCents);
    }
    // v1.53 (§4.40.4, MONEY): la clave TOLERANTE y su `null` se convierte AQUÍ en `PRICE_PENDING` (no vender; jamás el
    // grado más caro sobre una pieza cuyo grado nunca se capturó, ni un 500 en el checkout).
    const gradeKey = this.pricing.tryGradeKeyFor(item);
    if (gradeKey == null) {
      throw BusinessException.validation(
        'PRICE_PENDING',
        `Item ${item.folio} has no slab identity (grading company / grade value); not sellable`,
      );
    }
    // 💰 v1.116⟨ids⟩ (§IDS.2): una versión distinta de (en, sin liga) se precia con SU referencia de entrada y el MISMO cuerpo
    // (curva, piso, redondeo, IVA); ⛔ sin override M-30 ni bounty (D-IDS-L). Sin lote, un lote de una pieza.
    const version = batch ? this.versionOf(item, batch) : await this.versionSingle(item);
    if (!isDefaultVersion(version)) {
      return this.resolveVersion(item, version, batch ?? (await this.loadBatch([item])), instrument);
    }
    // v1.6-finish: precio de venta contra la referencia del ACABADO del item. v1.114 (§DYN.5.9): con la retención del
    // candado (`referenceOf`, con lote o sin él: el MISMO camino).
    const ref = await this.referenceOf(item, batch);
    const referenceMxnCents = ref?.status === 'priced' ? (ref.referenceMxnCents ?? null) : null;
    // v1.28 (P-18, §4.26b): el sellOverride de la VARIANTE (M-30) pisa la curva y es ABSOLUTO (el precio por pieza ya
    // ganó arriba).
    const variantOverride = batch
      ? (batch.variantOverrides.get(variantKey({ cardId: item.cardId, productType: item.productType, gradeKey, finish: item.finish })) ?? null)
      : await this.pricing.getVariantOverride(item.cardId, item.productType, gradeKey, item.finish);
    // v2.0 (P-48, §4.36.5b) — SEAM ÚNICO: monto + GUARDARRAÍL en la misma llamada (una premium en el piso NO se vende).
    const decision = {
      referenceMxnCents,
      // SOLO para el veredicto del guardarraíl (criterio 84): no entra al monto.
      rarityCanonical: item.card.rarityCanonical ?? item.card.rarity,
      controls: variantOverride,
    };
    const sale = batch
      ? this.pricing.decideSalePrice({
          ...decision,
          curve: batch.curve ?? (await this.pricing.loadPricingCurve()),
          premiumFloorPolicy: batch.premiumFloorPolicy ?? (await this.pricing.loadSalePremiumFloorPolicy()),
        })
      : await this.pricing.computeSalePriceForItem(decision);
    if (sale.pendingReason != null) {
      throw BusinessException.validation('PRICE_PENDING', `Item ${item.folio} has no publishable price`);
    }
    // BE-26 (money-safety): un precio de venta <= 0 (p. ej. un override degenerado) NO es vendible.
    if (sale.priceCents == null || sale.priceCents <= 0) {
      throw BusinessException.validation('PRICE_PENDING', `Item ${item.folio} has no price`);
    }
    return instrument(sale.priceCents, sale.basis, sale.marketMxnCents);
  }

  /** El `PRICE_PENDING` de una versión, con su motivo (`details.reason`) para la captura (§IDS.4). */
  versionPending(item: SaleItem, v: PieceVersion, reason: VersionPendingReason): BusinessException {
    const tag = versionKeyOf(v.language, v.stamp?.productId ?? null);
    return BusinessException.validation('PRICE_PENDING', `Item ${item.folio} (version ${tag}) has no publishable price`, { reason });
  }

  /**
   * 💰 v1.116⟨ids⟩ (§IDS.2) — el cuerpo para una versión: guardarraíl sobre la referencia SIN X (`guard`), monto por la curva
   * con la referencia de entrada (`price`, ya con X). `premium_at_floor` del guard ⇒ pending (⛔ sin `PendingPriceEntry`: eso
   * es de quien escala, I-3). El monto pasa por `decideSalePrice` — el MISMO seam — con el guardarraíl ya evaluado.
   */
  private async resolveVersion(
    item: SaleItem,
    v: PieceVersion,
    batch: SaleDecisionBatch,
    instrument: (l: number, b: PriceBasis, m: number | null) => SaleDecision,
  ): Promise<SaleDecision> {
    const r = this.versionReferences(item, v, batch);
    if (r.guard == null) throw this.versionPending(item, v, r.motive);
    const curve = batch.curve ?? (await this.pricing.loadPricingCurve());
    const premiumFloorPolicy = batch.premiumFloorPolicy ?? (await this.pricing.loadSalePremiumFloorPolicy());
    const rarityCanonical = item.card.rarityCanonical ?? item.card.rarity;
    const guard = this.pricing.decideSalePrice({ referenceMxnCents: r.guard, rarityCanonical, controls: null, curve, premiumFloorPolicy });
    if (guard.pendingReason != null) {
      throw this.versionPending(item, v, guard.pendingReason === 'premium_at_floor' ? 'premium_at_floor' : r.motive);
    }
    if (r.price == null) throw this.versionPending(item, v, r.motive);
    const sale =
      r.price === r.guard
        ? guard
        : this.pricing.decideSalePrice({ referenceMxnCents: r.price, rarityCanonical, controls: null, curve, premiumFloorPolicy: GUARD_ALREADY_EVALUATED });
    if (sale.pendingReason != null || sale.priceCents == null || sale.priceCents <= 0) throw this.versionPending(item, v, r.motive);
    return instrument(sale.priceCents, sale.basis, sale.marketMxnCents);
  }
}

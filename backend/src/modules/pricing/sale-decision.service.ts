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
import { Card, CardSet, Finish, InventoryItem, MarketBracket, ProductType, VariantPriceOverride } from '@prisma/client';
import { BusinessException } from '../../common/business.exception';
import { manualSaleOf, PriceBasis, saleDisplayCentsOf, sealedPriceBasisOf } from '../../common/money';
import type { IvaDials, SealedProductSaleRef } from '../../common/money';
import { marketBracketOf, PremiumFloorPolicy, PricingCurve } from '../../common/pricing-curve';
import { variantKey } from '../../common/variant-key';
import { PriceInfo, PricingService } from './pricing.service';

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
}

/** ¿Es el rechazo «sin precio publicable»? (el único que un lector convierte en «no se exhibe»). */
export function isPricePending(e: unknown): e is BusinessException {
  return e instanceof BusinessException && e.code === 'PRICE_PENDING';
}

@Injectable()
export class SaleDecisionService {
  constructor(private readonly pricing: PricingService) {}

  /**
   * Las entradas del cuerpo para un LOTE de piezas, en UNA lectura cada una (el «pago mínimo» de BE-25 que hacía
   * `fetchSellable`): curva, política, spreads, referencias y overrides de variante.
   */
  /**
   * Las referencias de mercado de un lote en UNA lectura (`getReferencesBatch`; ausente ⇒ `pending`, misma regla que
   * `getReference`). Para el sellado, su clave de mercado; para el resto, la de su variante.
   */
  async loadReferences(items: readonly SaleItem[]): Promise<Map<string, PriceInfo>> {
    return this.pricing.getReferencesBatch(
      items.flatMap((i): { cardId: string; productType: ProductType; gradeKey: string; finish: Finish }[] => {
        const k = this.refKeyOf(i);
        return k ? [k] : [];
      }),
    );
  }

  /** La referencia de una pieza dentro de un mapa de `loadReferences` (`undefined` ⇒ sin referencia ⇒ `pending`). */
  referenceIn(refs: Map<string, PriceInfo>, item: SaleItem): PriceInfo | undefined {
    const k = this.refKeyOf(item);
    return k ? refs.get(variantKey(k)) : undefined;
  }

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
    const refs = await this.loadReferences(items);
    // v1.28 (P-18, §4.26b): overrides de variante EN LOTE — solo raw/graded que DERIVAN su precio (sin precio a mano).
    const variantOverrides = !derives ? new Map<string, VariantPriceOverride>() : await this.pricing.getVariantOverridesBatch(
      items
        .filter((i) => i.productType !== 'sealed' && manualSaleOf(i) == null)
        .flatMap((i) => {
          const gk = this.pricing.tryGradeKeyFor(i);
          return gk ? [{ cardId: i.cardId, productType: i.productType, gradeKey: gk, finish: i.finish }] : [];
        }),
    );
    return { curve, premiumFloorPolicy, sealedSpreads, refs, variantOverrides };
  }

  /** El `gradeKey` canónico de una pieza, o `null` (graduada sin identidad de slab, v1.53). */
  gradeKeyOf(item: SaleItem): string | null {
    return this.pricing.tryGradeKeyFor(item);
  }

  /** La clave de referencia de mercado de una pieza (sellado: la de mercado; resto: la de su variante), o `null`. */
  private refKeyOf(i: SaleItem): { cardId: string; productType: ProductType; gradeKey: string; finish: Finish } | null {
    if (i.productType === 'sealed') {
      const gk = this.pricing.sealedMarketGradeKeyForItem(i);
      return gk ? { cardId: i.cardId, productType: 'sealed', gradeKey: gk, finish: 'normal' } : null;
    }
    const gk = this.pricing.tryGradeKeyFor(i);
    return gk ? { cardId: i.cardId, productType: i.productType, gradeKey: gk, finish: i.finish } : null;
  }

  /**
   * La referencia de mercado de una pieza: la del lote o, sin lote, leída aquí. Sellado ⇒ la de MERCADO TCGCSV (`undefined`
   * si no está mapeado); resto ⇒ la de su variante (`pending` sin identidad de slab, v1.53).
   */
  async referenceOf(item: SaleItem, batch?: SaleDecisionBatch): Promise<PriceInfo | undefined> {
    if (batch) return this.referenceIn(batch.refs, item);
    if (item.productType === 'sealed') return this.pricing.getSealedMarketRef(item);
    const gk = this.pricing.tryGradeKeyFor(item);
    return gk == null ? { status: 'pending' } : this.pricing.getReference(item.cardId, item.productType, gk, item.finish);
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
    // v1.6-finish: precio de venta contra la referencia del ACABADO del item.
    const ref = batch
      ? await this.referenceOf(item, batch)
      : await this.pricing.getReference(item.cardId, item.productType, gradeKey, item.finish);
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
}

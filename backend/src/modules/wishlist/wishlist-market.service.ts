/**
 * wishlist-market.service.ts — rev v1.87⟨wishlist⟩ (API_CONTRACT §WSH.3). **UNA lectura del mercado `M` y del precio
 * normal** para las cuatro superficies que los usan (lista, preview, aviso y lista de compra): *dos fuentes para un precio*
 * es la clase de defecto que este proyecto más repite.
 *
 * - `M` = la `PriceReference` vigente `raw:NM` + acabado, set_base, por `pricing.getReferencesBatch` (la misma que alimenta la
 *   curva del catálogo). `pending` ⇒ `null` (807).
 * - Precio normal = `decideSalePrice({M, rareza, override de la variante, curva, política})` → `saleDisplayCentsOf` (P = L con los diales);
 *   `null` si la decisión es `pending`. ⛔ Ningún cálculo de precio propio.
 */
import { Injectable } from '@nestjs/common';
import { Finish } from '@prisma/client';
import { PricingService } from '../pricing/pricing.service';
import { SettingsService } from '../settings/settings.service';
import { variantKey } from '../../common/variant-key';
import { IvaDials, saleDisplayCentsOf } from '../../common/money';

export interface VariantRef {
  cardId: string;
  finish: Finish;
}

export const keyOf = (k: VariantRef) => `${k.cardId}|${k.finish}`;
const RAW_NM = 'raw:NM';

@Injectable()
export class WishlistMarketService {
  constructor(
    private readonly pricing: PricingService,
    private readonly settings: SettingsService,
  ) {}

  ivaDials(): Promise<IvaDials> {
    return this.settings.getIvaDials();
  }

  /** `M` por (carta, acabado); `null` ⇔ precio pendiente. */
  async marketOf(keys: VariantRef[]): Promise<Map<string, number | null>> {
    const uniq = [...new Map(keys.map((k) => [keyOf(k), k])).values()];
    const refs = await this.pricing.getReferencesBatch(
      uniq.map((k) => ({ cardId: k.cardId, productType: 'raw' as const, gradeKey: RAW_NM, finish: k.finish })),
    );
    const out = new Map<string, number | null>();
    for (const k of uniq) {
      const r = refs.get(variantKey({ cardId: k.cardId, productType: 'raw', gradeKey: RAW_NM, finish: k.finish }));
      out.set(keyOf(k), r?.status === 'priced' && r.referenceMxnCents != null ? r.referenceMxnCents : null);
    }
    return out;
  }

  /**
   * Precio normal de hoy (`L` sin IVA, `P` con IVA) por (carta, acabado), por el SEAM ÚNICO de venta y EL camino a `P`
   * (`saleDisplayCentsOf`, candado SP-19). `null` sin mercado o
   * con decisión `pending` (guardarraíl).
   */
  async normalPriceOf(
    keys: (VariantRef & { rarity: string | null })[],
    market: Map<string, number | null>,
    dials: IvaDials,
  ): Promise<Map<string, { listCents: number; displayCents: number } | null>> {
    const out = new Map<string, { listCents: number; displayCents: number } | null>();
    if (keys.length === 0) return out;
    const curve = await this.pricing.loadPricingCurve();
    const premiumFloorPolicy = await this.pricing.loadSalePremiumFloorPolicy();
    const overrides = await this.pricing.getVariantOverridesBatch(
      keys.map((k) => ({ cardId: k.cardId, productType: 'raw' as const, gradeKey: RAW_NM, finish: k.finish })),
    );
    for (const k of keys) {
      const M = market.get(keyOf(k)) ?? null;
      const decision = this.pricing.decideSalePrice({
        referenceMxnCents: M,
        rarityCanonical: k.rarity,
        controls: overrides.get(variantKey({ cardId: k.cardId, productType: 'raw', gradeKey: RAW_NM, finish: k.finish })) ?? null,
        curve,
        premiumFloorPolicy,
      });
      out.set(
        keyOf(k),
        decision.priceCents == null
          ? null
          : { listCents: decision.priceCents, displayCents: saleDisplayCentsOf({ listPriceCents: decision.priceCents, fixedDisplayCents: null }, dials) },
      );
    }
    return out;
  }
}

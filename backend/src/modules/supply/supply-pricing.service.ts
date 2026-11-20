import { Injectable } from '@nestjs/common';
import { Finish } from '@prisma/client';
import { PricingService } from '../pricing/pricing.service';
import { BusinessException } from '../../common/business.exception';
import { variantKey } from '../../common/variant-key';

/** Mercado del día (MXN centavos) para una carta/acabado en NM, o null si no hay. Lo usa el TOPE DURO 100 %. */
@Injectable()
export class SupplyPricingService {
  constructor(private readonly pricing: PricingService) {}

  async marketCents(cardId: string, finish: Finish): Promise<number | null> {
    const info = await this.pricing.getReference(cardId, 'raw', 'raw:NM', finish);
    if (info.status === 'priced' && typeof info.referenceMxnCents === 'number' && info.referenceMxnCents > 0) {
      return info.referenceMxnCents;
    }
    return null;
  }

  /** Mercado de muchas (carta, acabado) en UNA lectura: `Map` clave `cardId|finish` → centavos o null. */
  async marketCentsBatch(items: { cardId: string; finish: Finish }[]): Promise<Map<string, number | null>> {
    const out = new Map<string, number | null>();
    if (items.length === 0) return out;
    const refs = await this.pricing.getReferencesBatch(items.map((i) => ({ cardId: i.cardId, productType: 'raw' as const, gradeKey: 'raw:NM', finish: i.finish })));
    for (const i of items) {
      const info = refs.get(variantKey({ cardId: i.cardId, productType: 'raw', gradeKey: 'raw:NM', finish: i.finish }));
      out.set(`${i.cardId}|${i.finish}`, info && info.status === 'priced' && typeof info.referenceMxnCents === 'number' && info.referenceMxnCents > 0 ? info.referenceMxnCents : null);
    }
    return out;
  }

  /** Tope duro (HECHOS 2026-11-12): nadie, ningún rol, paga arriba del 100 % del mercado. Sin mercado no hay tope que medir. */
  assertWithinCap(unitCents: number, marketCents: number | null): void {
    if (marketCents != null && unitCents > marketCents) {
      throw BusinessException.validation('ABOVE_MARKET_CAP', 'Price above 100% of market is not allowed');
    }
  }
}

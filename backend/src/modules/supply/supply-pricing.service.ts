import { Injectable } from '@nestjs/common';
import { Finish } from '@prisma/client';
import { PricingService } from '../pricing/pricing.service';
import { BusinessException } from '../../common/business.exception';

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

  /** Tope duro (HECHOS 2026-11-12): nadie, ningún rol, paga arriba del 100 % del mercado. Sin mercado no hay tope que medir. */
  assertWithinCap(unitCents: number, marketCents: number | null): void {
    if (marketCents != null && unitCents > marketCents) {
      throw BusinessException.validation('ABOVE_MARKET_CAP', 'Price above 100% of market is not allowed');
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProductType } from '@prisma/client';
import { PriceQuote, PricingProvider, PricingProviderInput } from '../pricing.types';

/**
 * PokemonPriceTrackerProvider — graded (PSA/CGC) y sealed. Free tier ~100/día.
 * STUB: la integración real requiere endpoint/clave del proveedor. Sin clave o
 * sin endpoint estable, devuelve null → cae a "precio pendiente" (nunca descarta).
 * El override manual del admin es el respaldo siempre disponible (ARCHITECTURE §4.1).
 */
@Injectable()
export class PokemonPriceTrackerProvider implements PricingProvider {
  readonly source = 'pokemonpricetracker' as const;
  private readonly logger = new Logger(PokemonPriceTrackerProvider.name);

  constructor(private readonly config: ConfigService) {}

  supports(productType: ProductType): boolean {
    return productType === 'graded' || productType === 'sealed';
  }

  async fetchPrice(_input: PricingProviderInput): Promise<PriceQuote | null> {
    const apiKey = this.config.get<string>('POKEMONPRICETRACKER_API_KEY');
    if (!apiKey || apiKey === 'CHANGE_ME') {
      this.logger.debug('PokemonPriceTracker sin API key: devuelve null (precio pendiente / override).');
      return null;
    }
    // TODO: integración real cuando se confirme el endpoint del proveedor.
    return null;
  }
}

/**
 * PokeTraceProvider — respaldo para graded/sealed. Free tier ~250/día. STUB (ver arriba).
 */
@Injectable()
export class PokeTraceProvider implements PricingProvider {
  readonly source = 'poketrace' as const;
  private readonly logger = new Logger(PokeTraceProvider.name);

  constructor(private readonly config: ConfigService) {}

  supports(productType: ProductType): boolean {
    return productType === 'graded' || productType === 'sealed';
  }

  async fetchPrice(_input: PricingProviderInput): Promise<PriceQuote | null> {
    const apiKey = this.config.get<string>('POKETRACE_API_KEY');
    if (!apiKey || apiKey === 'CHANGE_ME') return null;
    // TODO: integración real.
    return null;
  }
}

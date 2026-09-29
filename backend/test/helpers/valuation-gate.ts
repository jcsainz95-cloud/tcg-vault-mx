import { PricingService } from '../../src/modules/pricing/pricing.service';

/**
 * v1.80.1 (SK-5) — la PUERTA de valuación REAL para los dobles de `PricingService` de las pruebas
 * unitarias de los lectores de patrimonio (bóveda, `/admin/vaults`, ficha 360°, custodia, inventario).
 *
 * ⛔ No es un stub: son los métodos del prototipo, invocados como métodos del doble (`this` = el doble).
 * Así la prueba ejercita el cuerpo de producción de `valuationKeyFor`/`valuationCentsOf`/
 * `gateSealedMarketCents`, y la clave raw/graduada sigue saliendo del `tryGradeKeyFor` que cada doble
 * ya fijaba (la puerta lo llama por el envoltorio). Reescribir aquí la regla sería probar una copia.
 */
export const REAL_VALUATION_GATE = {
  valuationKeyFor: PricingService.prototype.valuationKeyFor,
  valuationCentsOf: PricingService.prototype.valuationCentsOf,
  gateSealedMarketCents: PricingService.prototype.gateSealedMarketCents,
};

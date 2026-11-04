import { PriceInfo, PricingService } from '../../src/modules/pricing/pricing.service';
import { variantKey } from '../../src/common/variant-key';
import { PatrimonyValuationService } from '../../src/modules/pricing/patrimony-valuation.service';
import { SaleDecisionService } from '../../src/modules/pricing/sale-decision.service';

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
  // v1.116.4 (`IDS-PAT`): la puerta iza el dial del sellado con el cuerpo de producción (lee `loadSealedSpreads` del doble).
  sealedSourceOnFor: PricingService.prototype.sealedSourceOnFor,
};

/**
 * 💰 v1.116.4⟨ids⟩ (API_CONTRACT §IDS.2 «Valor de patrimonio» `IDS-PAT`; §IDS.11 «unitarios: doble de la puerta o la real con
 * dobles de `PricingService`») — la PUERTA de patrimonio REAL sobre el doble de `PricingService` de la prueba: el cuerpo de
 * producción (`valuePieces` → `loadVersionInputs`/`versionReferences` del cuerpo de venta real) con las lecturas del doble. Un
 * lector construido a mano en un unitario recibe ESTO: no hay «camino de siempre» sin la puerta.
 */
export function realPatrimony(pricing: PricingService): PatrimonyValuationService {
  const p = withBatchReads(pricing);
  return new PatrimonyValuationService(p, new SaleDecisionService(p));
}

/**
 * Dobles escritos cuando «Mi bóveda» leía con `getReference` por pieza (antes de v1.116.4): solo fijan `getReference`. La puerta
 * lee en lote (`getReferencesBatch`); en producción `getReference` ES `getReferencesBatch` de una clave (`pricing.service.ts`,
 * P-53 ALTO-4), así que el lote del doble se arma con SU `getReference`, clave por clave — la misma referencia, sin regla nueva.
 * Un doble que ya fija `getReferencesBatch` se usa tal cual.
 */
function withBatchReads(pricing: PricingService): PricingService {
  const p = pricing as unknown as Record<string, unknown>;
  if (typeof p.getReferencesBatch === 'function' || typeof p.getReference !== 'function') return pricing;
  const one = p.getReference as PricingService['getReference'];
  const batch: PricingService['getReferencesBatch'] = async (keys) => {
    const m = new Map<string, PriceInfo>();
    for (const k of keys) m.set(variantKey(k), await one.call(pricing, k.cardId, k.productType, k.gradeKey, k.finish));
    return m;
  };
  return Object.assign(Object.create(pricing as object), { getReferencesBatch: batch }) as PricingService;
}

/**
 * Lo mismo para los lectores cuya puerta va detrás de parámetros opcionales (`AdminService`, `InventoryService`: en DI es
 * obligatoria, el `?` es solo de posición) y que un unitario construye a mano: se le inyecta la puerta REAL sobre su doble.
 */
export function withPatrimony<T extends object>(svc: T, pricing: PricingService): T {
  Object.assign(svc, { patrimony: realPatrimony(pricing) });
  return svc;
}

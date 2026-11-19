/**
 * Tarifas MEDIDAS 2026-11-19 (cotizaciones de producción, solo lectura; ⛔ ninguna guía): 14210 → Monterrey 64000, sobre 1 kg y caja
 * 5 kg, y 14210 → Todos Santos 23300 (zona extendida). Mismas formas que `ProviderRate`; el `total` YA lleva IVA y zona extendida.
 */
import { ProviderRate } from '../shipping-provider/shipping-provider.port';

const base = {
  carrierName: 'fedex',
  carrierLabel: 'FedEx',
  vatCents: null,
  creationType: 'single' as const,
  deliveryKind: 'home' as const,
  pickup: true,
  pickupViaSupport: false,
  planType: null,
};

function rate(o: Partial<ProviderRate> & Pick<ProviderRate, 'rateId' | 'serviceCode' | 'serviceName' | 'totalCents' | 'days'>): ProviderRate {
  return { ...base, amountCents: 0, extraFeesCents: 0, serviceFeeCents: 0, insuranceCents: null, ...o };
}

/** Monterrey, sobre 1 kg, declarado MX$1,500: Overnight 141.86, Express Saver 52.26 (seguro MX$15 aparte). */
export const MTY_ENVELOPE: ProviderRate[] = [
  rate({ rateId: 'on-env', serviceCode: 'standard_overnight', serviceName: 'Standard Overnight', totalCents: 14186, days: 1, insuranceCents: 1500 }),
  rate({ rateId: 'es-env', serviceCode: 'fedex_express_saver', serviceName: 'Express Saver', totalCents: 5226, days: 2, insuranceCents: 1500 }),
];
/** Monterrey, caja 5 kg: Overnight 165.95, Express Saver 52.47. */
export const MTY_BOX: ProviderRate[] = [
  rate({ rateId: 'on-box', serviceCode: 'standard_overnight', serviceName: 'Standard Overnight', totalCents: 16595, days: 1, insuranceCents: 3000 }),
  rate({ rateId: 'es-box', serviceCode: 'fedex_express_saver', serviceName: 'Express Saver', totalCents: 5247, days: 2, insuranceCents: 3000 }),
];
/** Todos Santos 23300, sobre: extended_area_fee (188.90 / 182.00) YA DENTRO del total (277.12 / 410.01). */
export const TODOS_SANTOS: ProviderRate[] = [
  rate({ rateId: 'es-ts', serviceCode: 'fedex_express_saver', serviceName: 'Express Saver', totalCents: 27712, days: 7, insuranceCents: 1500, extraFeesCents: 19007, extendedAreaFeeCents: 18890 }),
  rate({ rateId: 'on-ts', serviceCode: 'standard_overnight', serviceName: 'Standard Overnight', totalCents: 41001, days: 2, insuranceCents: 1500, extraFeesCents: 18384, extendedAreaFeeCents: 18200 }),
];
/** Solo Express Saver (Overnight sin cobertura, 10/50 CPs medidos). */
export const ONLY_EXPRESS_SAVER: ProviderRate[] = [MTY_ENVELOPE[1]];

/**
 * Fixtures de las pruebas de la ventana «Capturar guía» (no es una suite: lo importan las `*.test.tsx`).
 *
 * Las cifras son las MEDIDAS (PROD §4.4–§4.6) por medio del servidor falso (`buildMockRates`): 99minutos
 * recomendada y más cara, Paquetexpress con `planType` de promoción, PuntoPost de sucursal (plegada) y J&T
 * en `excluded.unavailable`.
 */
import { buildMockRates } from '@/lib/mock/skydropx';
import type { AdminShipmentDTO, LabelOptionsDTO, ShipmentLabelDTO, ShipmentQuoteDTO, ShipmentRateDTO, ShippingPackageDTO } from '@/types/contract';

export const SHIP_ID = 'shp-sdx-1';
export const REF = 'TCG-000123';
export const TARGET = { id: SHIP_ID, ref: REF, carrier: null, trackingNumber: null };

export function shipment(over: Partial<AdminShipmentDTO> = {}, options: Partial<LabelOptionsDTO> = {}): AdminShipmentDTO {
  return {
    id: SHIP_ID,
    kind: 'guest_direct_ship',
    orderId: 'ord-1',
    orderNumber: REF,
    status: 'picking',
    preparedAt: '2026-10-04T15:00:00Z',
    addressSnapshot: {
      recipientName: 'Ana López',
      line1: 'Av. Periférico Sur 4249',
      line2: 'Depto 2',
      neighborhood: 'Jardines de la Montaña',
      city: 'Tlalpan',
      state: 'Ciudad de México',
      postalCode: '14210',
      country: 'MX',
      phone: '5551234567',
      references: 'Portón negro',
    },
    address: { complete: true, version: 3, corrected: null },
    labelOptions: { provider: 'skydropx', purchase: 'operators', canPurchase: true, ...options },
    labelSource: null,
    label: null,
    labelPending: null,
    labelAlert: null,
    ...over,
  };
}

export function quote(over: Partial<ShipmentQuoteDTO> = {}, bump = 0): ShipmentQuoteDTO {
  const rates = buildMockRates(bump);
  return {
    quoteId: `q-${bump}`,
    providerQuotationId: `sdx-${bump}`,
    requestedAt: '2026-10-04T16:00:00Z',
    expiresAt: '2026-10-05T16:00:00Z',
    completed: true,
    reused: false,
    package: { code: 'envelope', label: 'Sobre', lengthCm: 25, widthCm: 18, heightCm: 3, weightKg: 1 },
    insurance: { insuredValueCents: 30000, coverageCents: 250000, costCents: 2500 },
    charged: { grossCents: 20300, netCents: 17500 },
    recommendedRateId: rates.find((r) => r.recommended)?.rateId ?? null,
    rates,
    excluded: { unavailable: 1, noCoverage: 0, notApplicable: 0, multipackage: 0, breakdownMismatch: 0 },
    ...over,
  };
}

export const rateOf = (q: ShipmentQuoteDTO, id: string): ShipmentRateDTO => q.rates.find((r) => r.rateId === id)!;

export function labelFor(r: ShipmentRateDTO, over: Partial<ShipmentLabelDTO> = {}): ShipmentLabelDTO {
  return {
    source: 'skydropx',
    providerShipmentId: 'sdx-shp-1',
    carrierName: r.carrierName,
    serviceName: r.serviceName,
    trackingNumber: '9900112233',
    trackingUrl: null,
    labelAvailable: true,
    purchasedAt: '2026-10-04T16:05:00Z',
    chosenBy: { userId: 'u-op1', name: 'Operador' },
    chosenAt: '2026-10-04T16:05:00Z',
    chosen: r,
    recommended: r,
    wasRecommended: true,
    cost: { grossCents: r.priceCents, ivaCents: r.breakdown.ivaCents, ivaSource: 'provider', insuranceCents: 2500, netCents: r.netCostCents, marginCents: r.marginCents },
    carrierStatus: 'created',
    carrierStatusAt: '2026-10-04T16:05:00Z',
    processing: false,
    canceledAt: null,
    cancelReason: null,
    ...over,
  };
}

export const PACKAGES: ShippingPackageDTO[] = [
  { code: 'envelope', label: 'Sobre', lengthCm: 25, widthCm: 18, heightCm: 3, weightKg: 1, providerPackageType: '5H4', active: true, sortOrder: 1 },
  { code: 'box', label: 'Caja', lengthCm: 49, widthCm: 23, heightCm: 21, weightKg: 5, providerPackageType: '4G', active: true, sortOrder: 2 },
  { code: 'tube', label: 'Tubo', lengthCm: 40, widthCm: 8, heightCm: 8, weightKg: 1, providerPackageType: null, active: false, sortOrder: 3 },
];

/** Una promesa que se resuelve/rechaza a mano (para clics durante una compra en curso). */
export function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

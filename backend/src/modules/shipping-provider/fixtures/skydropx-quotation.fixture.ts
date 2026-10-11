/**
 * skydropx-quotation.fixture.ts — la cotización MEDIDA de producción, «PROD §4.6 ampliado» (API_CONTRACT
 * §M4-SHIP.19.19.16, PS-94 / PS-70 corregida). Fuente: `docs/specs/SKYDROPX_API_PROD_RESULTADOS.md` (sesión
 * `claude/skydropx-api-prod`, 2026-10-04 03:58–04:03 UTC, cero envíos creados).
 *
 * Qué es MEDIDO y qué es DERIVADO (dicho, no escondido):
 *  - MEDIDO tal cual (PROD §4.6): la forma entera (nombres de campos, importes en cadena, `extra_fees[].value`
 *    numérico, `protection_value_total` numérico, `packages[]` con el eco del seguro), la tarifa FedEx Express Saver
 *    completa (`43.10 + 0.7315 + 7.01 + 1.27 = 52.11`) y la tarifa `no_coverage` de Paquetexpress.
 *  - MEDIDO en su TOTAL (PROD §4.5, 14210→06600, paquete A): PuntoPost $1.19 (solo sucursal, sin recolección),
 *    ampm $51.25, Paquetexpress $51.25, 99minutos Next Day $70.15 (sin recolección), J&T $51.25 con
 *    `success:false` (M-11), 99minutos Next Day Nacional `no_coverage`; 14 de 33 exitosas.
 *  - DERIVADO (no medido): el desglose `amount/vat_fee/service_fee` de las tarifas cuyo total se midió (se reparte
 *    con `vat = total − service − amount` para que cuadre al centavo, como cuadraron 283/283 medidas, PROD §4.3), y
 *    las tarifas «de relleno» hasta 33 (carrier/servicio/precio inventados con la misma forma).
 * ⛔ Ningún dato personal: la cotización no lleva ninguno (solo CP).
 */

export const FIXTURE_QUOTATION_ID = 'fixture-quotation-14210-06600-a';

type RawRate = Record<string, unknown>;

let seq = 0;
function rateId(): string {
  seq += 1;
  return `fixture-rate-${String(seq).padStart(2, '0')}`;
}

function cents(c: number): string {
  return (c / 100).toFixed(2);
}

/** Tarifa exitosa con desglose DERIVADO que cuadra al centavo con el `total` medido. */
function priced(
  provider: string,
  display: string,
  service: string,
  totalCents: number,
  serviceFeeCents: number,
  extra: {
    days: number;
    pickup: boolean;
    officeDeliveryOnly: boolean;
    planType: string;
    pickupViaSupport?: boolean;
    status?: string;
  },
): RawRate {
  const amountCents = Math.round((totalCents - serviceFeeCents) / 1.16);
  const vatCents = totalCents - serviceFeeCents - amountCents;
  return {
    success: true,
    id: rateId(),
    rate_type: 'default',
    provider_name: provider,
    provider_display_name: display,
    provider_service_name: service,
    provider_service_code: `${provider}-${service}`.toLowerCase().replace(/\s+/g, '-'),
    status: extra.status ?? 'price_found_internal',
    currency_code: 'MXN',
    amount: cents(amountCents),
    service_fee: cents(serviceFeeCents),
    vat_fee: cents(vatCents),
    total: cents(totalCents),
    external_price: cents(totalCents - serviceFeeCents),
    extra_fees: [],
    days: extra.days,
    insurable: null,
    plan_type: extra.planType,
    packaging_type: 'package',
    error_messages: null,
    weight: '1.0',
    protection_value_total: 25.0,
    total_value_with_protection: cents(totalCents + 2500),
    coupon: null,
    pickup: extra.pickup,
    pickup_automatic: false,
    pickup_package_min: 0,
    pickup_via_support: extra.pickupViaSupport ?? false,
    shipment_creation_type: 'single',
    office_delivery: true,
    office_pickup: false,
    office_delivery_only: extra.officeDeliveryOnly,
    requires_origin_verification: false,
  };
}

function failed(provider: string, service: string, status: 'no_coverage' | 'not_applicable'): RawRate {
  return {
    success: false,
    id: rateId(),
    provider_name: provider,
    provider_service_name: service,
    status,
    amount: null,
    total: null,
    days: null,
    error_messages:
      status === 'no_coverage'
        ? [
            {
              module: 'carser_response',
              error_type: 'CARRIER_COVERAGE_NOT_FOUND',
              error_message: 'The service is not available for the specified postal codes.',
            },
          ]
        : [{ module: 'rules', error_type: 'max_weight', error_message: 'max_weight debe ser mayor que o igual a 61' }],
  };
}

/** J&T: llega CON precio y `success:false` (M-11: 45 de 45). */
function jtUnavailable(service: string): RawRate {
  const r = priced('jtexpress', 'J&T Express', service, 5125, 127, {
    days: 3,
    pickup: false,
    officeDeliveryOnly: false,
    planType: '50PESOS_30042026',
  });
  return { ...r, success: false, error_messages: null };
}

/** FedEx Express Saver — la tarifa MEDIDA completa de PROD §4.6 (con combustible 0.7315). */
const FEDEX_MEASURED: RawRate = {
  success: true,
  id: 'fixture-rate-fedex-measured',
  rate_type: 'default',
  provider_name: 'fedex',
  provider_display_name: 'FedEx',
  provider_service_name: 'Express Saver',
  provider_service_code: 'fedex-express-saver',
  status: 'price_found_internal',
  currency_code: 'MXN',
  amount: '43.10',
  service_fee: '1.27',
  vat_fee: '7.01',
  total: '52.11',
  external_price: '50.84',
  extra_fees: [{ code: 'fuel_increase_fee', value: 0.7315, groupable: false, group_code: null }],
  days: 2,
  insurable: null,
  has_own_agreement: false,
  own_agreement_amount: null,
  zone: '1',
  service_zone: '1',
  country_code: 'MX',
  plan_type: '50PESOS_30042026',
  packaging_type: 'package',
  error_messages: null,
  weight: '1.0',
  protection_value_total: 25.0,
  total_value_with_protection: '77.11',
  coupon: null,
  pickup: true,
  pickup_automatic: false,
  pickup_package_min: 0,
  pickup_ocurre: true,
  pickup_via_support: false,
  shipment_creation_type: 'single',
  office_delivery: true,
  office_pickup: false,
  office_delivery_only: false,
  requires_origin_verification: false,
};

/** Paquetexpress Express Next Day `no_coverage` — MEDIDA tal cual (PROD §4.6). */
const PAQUETEXPRESS_NO_COVERAGE_MEASURED: RawRate = {
  success: false,
  id: 'fixture-rate-paquetexpress-no-coverage',
  provider_name: 'paquetexpress',
  provider_service_name: 'Express Next Day',
  status: 'no_coverage',
  amount: null,
  total: null,
  days: null,
  error_messages: [
    {
      module: 'carser_response',
      error_type: 'CARRIER_COVERAGE_NOT_FOUND',
      error_message: 'The service is not available for the specified postal codes.',
    },
  ],
};

function buildRates(): RawRate[] {
  seq = 0;
  const successes: RawRate[] = [
    priced('punto_post', 'PuntoPost', 'Standard', 119, 0, {
      days: 2,
      pickup: false,
      officeDeliveryOnly: true,
      planType: 'PROMO_1_PESO_19082026',
    }),
    priced('ampm', 'ampm', 'Plataformas', 5125, 127, {
      days: 1,
      pickup: true,
      officeDeliveryOnly: false,
      planType: '50PESOS_30042026',
    }),
    priced('paquetexpress', 'Paquetexpress', 'Nacional', 5125, 127, {
      days: 3,
      pickup: true,
      officeDeliveryOnly: false,
      planType: '50PESOS_30042026',
    }),
    FEDEX_MEASURED,
    priced('ninetynineminutes', '99minutos', 'Next Day', 7015, 127, {
      days: 2,
      pickup: false,
      officeDeliveryOnly: false,
      planType: 'ACQ_2026',
    }),
    // Relleno DERIVADO (carrier/servicio/precio inventados con la forma medida) hasta 14 exitosas.
    priced('imile', 'Imile', 'Express', 8561, 127, {
      days: 2,
      pickup: false,
      pickupViaSupport: true,
      officeDeliveryOnly: false,
      planType: 'ACQ_2026',
      status: 'price_found_external',
    }),
    priced('estafeta', 'Estafeta', 'Terrestre', 9840, 127, { days: 4, pickup: true, officeDeliveryOnly: false, planType: 'ACQ_2026' }),
    priced('estafeta', 'Estafeta', 'Dia Siguiente', 14390, 127, { days: 1, pickup: true, officeDeliveryOnly: false, planType: 'ACQ_2026' }),
    priced('dhl', 'DHL', 'Economy', 13520, 127, { days: 3, pickup: true, officeDeliveryOnly: false, planType: 'ACQ_2026' }),
    priced('dhl', 'DHL', 'Express', 18960, 127, { days: 1, pickup: true, officeDeliveryOnly: false, planType: 'ACQ_2026' }),
    priced('fedex', 'FedEx', 'Standard Overnight', 16050, 127, { days: 1, pickup: true, officeDeliveryOnly: false, planType: 'ACQ_2026' }),
    priced('ups', 'UPS', 'Saver', 21030, 127, { days: 1, pickup: true, officeDeliveryOnly: false, planType: 'ACQ_2026' }),
    priced('ups', 'UPS', 'Standard', 15475, 127, { days: 3, pickup: true, officeDeliveryOnly: false, planType: 'ACQ_2026' }),
    priced('sendex', 'Sendex', 'Terrestre', 11233, 127, { days: 4, pickup: true, officeDeliveryOnly: false, planType: 'ACQ_2026' }),
  ];
  const unavailable = [jtUnavailable('Standard Sin Recolección'), jtUnavailable('Standard')];
  const noCoverage: RawRate[] = [
    failed('ninetynineminutes', 'Next Day Nacional', 'no_coverage'),
    PAQUETEXPRESS_NO_COVERAGE_MEASURED,
    ...['Same Day', 'Express', 'Terrestre Plus', 'Economico', 'Plus', 'Premium', 'Ocurre', 'Metropolitano', 'Regional', 'Nacional Plus'].map(
      (s) => failed('carrier_x', s, 'no_coverage'),
    ),
  ];
  const notApplicable: RawRate[] = ['LTL', 'Carga', 'Tarima', 'Pesado', 'Consolidado'].map((s) =>
    failed('carrier_y', s, 'not_applicable'),
  );
  return [...successes, ...unavailable, ...noCoverage, ...notApplicable];
}

/** Lo que el FIXTURE debe producir al normalizar (lo asertan PS-94/PS-70; si cambias el fixture, cambia esto). */
export const FIXTURE_EXPECTED = {
  total: 33,
  offered: 14,
  excluded: { unavailable: 2, noCoverage: 12, notApplicable: 5, multipackage: 0, breakdownMismatch: 0 },
} as const;

/** `GET /quotations/{id}` completada, con `packages[]` que ecoa protegido $2,500 (lo que se mandó por omisión). */
export function completedQuotationFixture(opts?: { declaredValue?: string; packageProtected?: boolean }): Record<string, unknown> {
  return {
    id: FIXTURE_QUOTATION_ID,
    quotation_scope: { carriers_scoped_to: 'ALL_AVAILABLE' },
    is_completed: true,
    cash_on_delivery: false,
    recipient_pays_shipping: false,
    on_delivery_amount: null,
    address_template_from_id: null,
    address_template_to_id: null,
    requires_origin_verification: true,
    packages: [
      {
        package_number: 1,
        weight: '1.0',
        length: '25.0',
        width: '18.0',
        height: '3.0',
        package_protected: opts?.packageProtected ?? true,
        declared_value: opts?.declaredValue ?? '2500.0',
        protection_value: 25.0,
      },
    ],
    rates: buildRates(),
  };
}

/** `POST /quotations` ⇒ `201` con `is_completed:false` y las 33 tarifas en `pending` (PROD §4.1). */
export function pendingQuotationFixture(): Record<string, unknown> {
  const done = completedQuotationFixture();
  const rates = (done.rates as RawRate[]).map((r) => ({
    id: r.id,
    success: false,
    provider_name: r.provider_name,
    provider_service_name: r.provider_service_name,
    status: 'pending',
    amount: null,
    total: null,
    days: null,
  }));
  return { ...done, is_completed: false, packages: undefined, rates };
}

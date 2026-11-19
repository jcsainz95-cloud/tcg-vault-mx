import { MTY_BOX, MTY_ENVELOPE, ONLY_EXPRESS_SAVER, TODOS_SANTOS } from './fixtures';
import { ceilPesoCents, customerFeeCents, guideCostPerBoxCents, p75, pickRate, pickZoneRow, recalibrate } from './ship-quote-math';
import { normalizeRates } from '../shipping-provider/rate-normalization';

const ORDER = ['standard_overnight', 'fedex_express_saver'];

describe('§ENV3 fórmula de cobro (centavos enteros)', () => {
  it('cobro = costo de guía (total + seguro) + MX$20, redondeado al peso hacia arriba', () => {
    const r = pickRate(MTY_ENVELOPE, ORDER, 2500)!;
    expect(r.serviceCode).toBe('standard_overnight');
    expect(guideCostPerBoxCents(r)).toBe(14186 + 1500);
    expect(customerFeeCents(1, guideCostPerBoxCents(r), 2000)).toBe(17700); // 17686 → 17700
    expect(ceilPesoCents(15001)).toBe(15100);
  });
  it('N cajas ⇒ Σ por caja + UN solo margen', () => {
    const r = pickRate(MTY_BOX, ORDER, 2500)!;
    expect(customerFeeCents(2, guideCostPerBoxCents(r), 2000)).toBe(ceilPesoCents(2 * (16595 + 3000) + 2000));
  });
  it('zona extendida: el total YA la trae; NO se suma otra vez (medido 66/66)', () => {
    const r = pickRate(TODOS_SANTOS, ORDER, 2500)!;
    expect(r.extendedAreaCents).toBe(18200);
    expect(r.transportCents).toBe(41001); // el total tal cual
    expect(customerFeeCents(1, guideCostPerBoxCents(r), 2000)).toBe(ceilPesoCents(41001 + 1500 + 2000));
  });
  it('sin Overnight ⇒ Express Saver, mismo cálculo + MX$20', () => {
    const r = pickRate(ONLY_EXPRESS_SAVER, ORDER, 2500)!;
    expect(r.serviceCode).toBe('fedex_express_saver');
    expect(customerFeeCents(1, guideCostPerBoxCents(r), 2000)).toBe(ceilPesoCents(5226 + 1500 + 2000));
  });
  it('sin FedEx o a sucursal ⇒ null (respaldo); seguro de la tabla si el eco no coincide', () => {
    expect(pickRate([{ ...MTY_ENVELOPE[0], carrierName: 'ampm' }], ORDER, 2500)).toBeNull();
    expect(pickRate([{ ...MTY_ENVELOPE[0], deliveryKind: 'branch' }], ORDER, 2500)).toBeNull();
    expect(pickRate([{ ...MTY_ENVELOPE[0], insuranceCents: null }], ORDER, 2500)!.insuranceCents).toBe(2500);
  });
});

describe('§ENV3 IVA y zona extendida en la normalización real de Skydropx', () => {
  const raw = (o: object) => ({ id: 'r', success: true, status: 'price_found_internal', shipment_creation_type: 'single', provider_name: 'fedex', provider_service_code: 'fedex_express_saver', provider_service_name: 'Express Saver', amount: '43.10', service_fee: '6.76', vat_fee: '37.29', total: '277.12', days: 7, protection_value_total: 15, extra_fees: [{ code: 'extended_area_fee', value: 188.9 }, { code: 'fuel_increase_fee', value: 1.07 }], ...o });
  it('amount + extras + vat + service = total (total CON IVA) y la zona extendida se expone aparte', () => {
    const { rates } = normalizeRates([raw({})], { insuranceEchoOk: true });
    expect(rates).toHaveLength(1);
    expect(rates[0].totalCents).toBe(27712);
    expect(rates[0].vatCents).toBe(3729);
    expect(rates[0].extendedAreaFeeCents).toBe(18890);
  });
});

describe('§ENV3 tabla de respaldo', () => {
  const rows = [
    { prefix2: '64', profileKey: 'envelope:1', serviceCode: 'standard_overnight', costCents: 15000, samples: 2 },
    { prefix2: '64', profileKey: 'envelope:1', serviceCode: 'fedex_express_saver', costCents: 5300, samples: 2 },
    { prefix2: '66', profileKey: 'envelope:1', serviceCode: 'fedex_express_saver', costCents: 6000, samples: 2 },
    { prefix2: '23', profileKey: 'envelope:1', serviceCode: 'fedex_express_saver', costCents: 27000, samples: 2 },
  ];
  it('fila del prefijo; sin Overnight en el prefijo ⇒ Express Saver; sin prefijo ⇒ máximo de la región ⇒ máximo nacional', () => {
    expect(pickZoneRow(rows, '64', 'envelope:1', ORDER)!.row.costCents).toBe(15000);
    expect(pickZoneRow(rows, '66', 'envelope:1', ORDER)!.row.serviceCode).toBe('fedex_express_saver');
    expect(pickZoneRow(rows, '67', 'envelope:1', ORDER)).toMatchObject({ scope: 'region', row: { costCents: 15000 } });
    expect(pickZoneRow(rows, '99', 'envelope:1', ORDER)).toMatchObject({ scope: 'national', row: { costCents: 27000 } });
    expect(pickZoneRow([], '64', 'envelope:1', ORDER)).toBeNull();
  });
  it('p75 por rango y recalibración: < 5 muestras CONSERVA (no escribe)', () => {
    expect(p75([100, 200, 300, 400])).toBe(300);
    const log = (c: number) => ({ prefix2: '64', profileKey: 'envelope:1', serviceCode: 'x', costCents: c });
    expect(recalibrate([log(1), log(2), log(3), log(4)], 5)).toEqual([]);
    expect(recalibrate([log(1), log(2), log(3), log(4), log(5)], 5)).toEqual([{ prefix2: '64', profileKey: 'envelope:1', serviceCode: 'x', costCents: 4, samples: 5 }]);
  });
});

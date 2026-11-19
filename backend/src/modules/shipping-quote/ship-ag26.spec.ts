import { ag26Of, labelLogRowOf } from './ship-ag26';
import { customerQuoteOf } from './customer-quote';

const snap = { serviceCode: 'standard_overnight', serviceName: 'FedEx Standard Overnight', costQuotedCents: 15686, profile: { package: 'envelope', boxes: 1, perBoxKg: 1 } };
const base = { snapshot: snap, toleranceCents: 1000, boughtService: 'Standard Overnight', folio: 'ENV-000001' };

describe('§ENV3 AG-26', () => {
  it('sin exceso (≤ cotizado + MX$10) ⇒ nada; con exceso ⇒ facts sin PII', () => {
    expect(ag26Of({ ...base, costRealCents: 15686 })).toBeNull();
    expect(ag26Of({ ...base, costRealCents: 16686 })).toBeNull();
    const f = ag26Of({ ...base, costRealCents: 16687 })!;
    expect(f).toEqual({ folio: 'ENV-000001', costQuotedCents: 15686, costRealCents: 16687, differenceCents: 1001, quotedService: 'FedEx Standard Overnight', boughtService: 'Standard Overnight' });
  });
  it('sin snapshot (pedido de la regla fija) o multi-caja ⇒ nada', () => {
    expect(ag26Of({ ...base, snapshot: null, costRealCents: 99999 })).toBeNull();
    expect(ag26Of({ ...base, snapshot: { ...snap, profile: { boxes: 2 } }, costRealCents: 99999 })).toBeNull();
  });
  describe('QA-ENV3-LOG: la guía comprada alimenta la tabla con el servicio COMPRADO a domicilio', () => {
    const order = ['standard_overnight', 'fedex_express_saver'];
    const bought = (o: object = {}) => ({ carrierName: 'fedex', serviceName: 'Express Saver', deliveryKind: 'home' as const, ...o });
    it('usa el servicio comprado (no el cotizado)', () => {
      expect(labelLogRowOf({ snapshot: snap, postalCode: '64000', rate: bought(), serviceOrder: order, transportCents: 5226 })).toEqual({ prefix2: '64', profileKey: 'envelope:1', serviceCode: 'fedex_express_saver', costCents: 5226, source: 'label' });
    });
    it('nunca sucursal, otra paquetería, servicio fuera del orden ni free_threshold; sin snapshot ⇒ nada', () => {
      const base = { snapshot: snap, postalCode: '64000', serviceOrder: order, transportCents: 5226 };
      expect(labelLogRowOf({ ...base, rate: bought({ deliveryKind: 'branch' }) })).toBeNull();
      expect(labelLogRowOf({ ...base, rate: bought({ carrierName: 'ampm' }) })).toBeNull();
      expect(labelLogRowOf({ ...base, rate: bought({ serviceName: 'Día Siguiente LTL' }) })).toBeNull();
      expect(labelLogRowOf({ ...base, snapshot: { ...snap, serviceCode: 'free_threshold' }, rate: bought({ serviceName: 'free threshold' }) })).toBeNull();
      expect(labelLogRowOf({ ...base, snapshot: null, rate: bought() })).toBeNull();
    });
  });
});

describe('§ENV3 customerQuote (preselección de Capturar guía)', () => {
  const rates = [
    { rateId: 'a', carrierName: 'fedex', serviceName: 'Express Saver' },
    { rateId: 'b', carrierName: 'fedex', serviceName: 'Standard Overnight' },
  ];
  it('casa por servicio; si no está, el siguiente del orden con fallback', () => {
    expect(customerQuoteOf(snap, 17700, rates, ['standard_overnight', 'fedex_express_saver'])).toMatchObject({ preselectedRateId: 'b', fallback: false, chargedCents: 17700, costQuotedCents: 15686 });
    expect(customerQuoteOf(snap, 17700, [rates[0]], ['standard_overnight', 'fedex_express_saver'])).toMatchObject({ preselectedRateId: 'a', fallback: true });
    expect(customerQuoteOf(null, 1, rates, [])).toBeNull();
  });
});

import { insuranceCoverageFor } from '../shipments/insurance';
import { listPriceCents } from '../shipments/label-quote.service';

describe('§ENV3 punto 17(5) — el seguro va sobre el precio de lista, no sobre lo cobrado con código', () => {
  const tiers = [{ coverageCents: 250000, costCents: 2500, measuredAt: 'x' }, { coverageCents: 1000000, costCents: 17000, measuredAt: 'x' }];
  it('lista = cobrado + rebaja; el escalón no cambia por un código', () => {
    // 2 piezas de MX$1,400 con 10 %: cobrado 1260 c/u (2520 total, escalón 2500 no cubre... ) vs lista 2800
    const listTotal = 2 * listPriceCents(126000, 14000);
    const chargedTotal = 2 * 126000;
    expect(listTotal).toBe(280000);
    expect(insuranceCoverageFor(chargedTotal, tiers)!.coverageCents).toBe(1000000);
    expect(insuranceCoverageFor(listTotal, tiers)!.coverageCents).toBe(1000000);
    // caso donde el código SÍ cambiaba el escalón: lista 2,600 ⇒ cobrado 2,340
    expect(insuranceCoverageFor(234000, tiers)!.coverageCents).toBe(250000);
    expect(insuranceCoverageFor(2 * listPriceCents(117000, 13000), tiers)!.coverageCents).toBe(1000000);
  });
});

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
  it('la guía comprada alimenta la tabla (transporte sin seguro) solo en pedidos §ENV3', () => {
    expect(labelLogRowOf(snap, '64000', 'standard_overnight', 14186)).toEqual({ prefix2: '64', profileKey: 'envelope:1', serviceCode: 'standard_overnight', costCents: 14186, source: 'label' });
    expect(labelLogRowOf(null, '64000', 'x', 1)).toBeNull();
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

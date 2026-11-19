import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

// Llaves de prueba aleatorias por corrida (nunca literales): la real sale de `PII_HMAC_KEY` en `PiiCryptoService`.
const KEY_A = randomBytes(32);
const KEY_B = randomBytes(32);
import { ShipQuotePayload, signShipQuote, verifyShipQuote } from './ship-quote-token';

const signer = {
  domainHmac: (d: string, v: string) => createHmac('sha256', KEY_A).update(d + v).digest('hex'),
  constantTimeEquals: (a?: string | null, b?: string | null) => !!a && !!b && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b)),
};
const payload = (o: Partial<ShipQuotePayload> = {}): Omit<ShipQuotePayload, 'v'> => ({
  cp: '64000', h: 'abc', fee: 15000, iat: 1000, exp: 2800,
  snap: { serviceCode: 'standard_overnight', serviceName: 'FedEx Standard Overnight', carrier: 'fedex', etaDays: 1, costQuotedCents: 13000, extendedAreaCents: 0, marginCents: 2000, source: 'live', profile: { package: 'envelope', boxes: 1, perBoxKg: 1, perBoxCoverageCents: 250000 }, quotedAt: 'x' },
  ...o,
});

describe('§ENV3 quoteId firmado (infalsificable)', () => {
  it('ida y vuelta válida', () => {
    const v = verifyShipQuote(signer, signShipQuote(signer, payload()), 1500);
    expect(v.ok && v.payload.fee).toBe(15000);
  });
  it('cambiar el cobro dentro del token ⇒ firma inválida', () => {
    const t = signShipQuote(signer, payload());
    const [p1, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p1, 'base64url').toString()), fee: 100 })).toString('base64url');
    expect(verifyShipQuote(signer, `${forged}.${sig}`, 1500)).toMatchObject({ ok: false, reason: 'invalid_token' });
  });
  it('firmado con otra llave ⇒ inválido; basura ⇒ inválido', () => {
    const other = { ...signer, domainHmac: (d: string, v: string) => createHmac('sha256', KEY_B).update(d + v).digest('hex') };
    expect(verifyShipQuote(signer, signShipQuote(other, payload()), 1500).ok).toBe(false);
    for (const g of ['', 'a.b', 'x'.repeat(5000), 12, null]) expect(verifyShipQuote(signer, g, 1500).ok).toBe(false);
  });
  it('caducado ⇒ expired (con firma buena); iat del futuro ⇒ inválido', () => {
    const t = signShipQuote(signer, payload());
    expect(verifyShipQuote(signer, t, 2800)).toMatchObject({ ok: false, reason: 'expired' });
    expect(verifyShipQuote(signer, t, 100)).toMatchObject({ ok: false, reason: 'invalid_token' });
  });
});

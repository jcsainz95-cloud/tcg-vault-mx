import { createHmac, timingSafeEqual } from 'crypto';
import { SETTING_DEFAULTS } from '../settings/settings.constants';
import { MTY_ENVELOPE, ONLY_EXPRESS_SAVER } from './fixtures';
import { MemoryShipQuoteCache } from './ship-quote-cache';
import { ShipCartInput } from './ship-profile';
import { ShippingQuoteService } from './shipping-quote.service';

const pii = {
  domainHmac: (d: string, v: string) => createHmac('sha256', 'k').update(d + v).digest('hex'),
  constantTimeEquals: (a?: string | null, b?: string | null) => !!a && !!b && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b)),
};
const ZONE = [
  { prefix2: '64', profileKey: 'envelope:1', serviceCode: 'standard_overnight', costCents: 15000, samples: 2 },
  { prefix2: '64', profileKey: 'envelope:1', serviceCode: 'fedex_express_saver', costCents: 5300, samples: 2 },
];
const cart = (o: Partial<ShipCartInput> = {}): ShipCartInput => ({ cards: 3, sealedSubtypes: [], accessoryGrams: [], valueCents: 100000, ...o });

function build(over: { settings?: Record<string, unknown>; quote?: jest.Mock; zone?: unknown[] } = {}) {
  const settings = {
    get: jest.fn(async (k: string) => (over.settings && k in over.settings ? over.settings[k] : k === 'skydropx_origin_address_template_id' ? 'tpl-1' : (SETTING_DEFAULTS as Record<string, unknown>)[k])),
    getNumber: jest.fn(async (k: string) => Number(over.settings && k in over.settings ? over.settings[k] : (SETTING_DEFAULTS as Record<string, unknown>)[k])),
  };
  const prisma = {
    shippingZoneRate: { findMany: jest.fn(async () => over.zone ?? ZONE) },
    shippingQuoteLog: { createMany: jest.fn(async () => ({ count: 1 })), create: jest.fn() },
  };
  const postal = { resolvePostalCode: jest.fn(async () => ({ postalCode: '64000', source: 'local', entries: [{ neighborhood: 'Centro', municipality: 'Monterrey', state: 'Nuevo León' }] })) };
  const quote = over.quote ?? jest.fn(async () => ({ providerQuotationId: 'q', completed: true, rates: MTY_ENVELOPE, excluded: {}, insuranceEcho: { ok: true }, raw: null }));
  const cache = new MemoryShipQuoteCache();
  const svc = new ShippingQuoteService(prisma as never, settings as never, pii as never, postal as never, { quote } as never, cache);
  return { svc, quote, prisma, cache, settings };
}

describe('§ENV3 ShippingQuoteService', () => {
  it('vivo: cobro = (total + seguro + MX$20) al peso, congelado en el token', async () => {
    const { svc, quote } = build();
    const dto = await svc.quote({ cp: '64000', cart: cart(), subtotalCents: 100000 });
    expect(dto).toMatchObject({ shippingFeeCents: 17700, service: 'FedEx Standard Overnight', etaDays: 1 });
    expect(quote).toHaveBeenCalledTimes(1);
    const v = svc.verifyToken(dto.quoteId);
    expect(v.ok && v.payload.snap).toMatchObject({ costQuotedCents: 15686, marginCents: 2000, source: 'live' });
  });
  it('el cliente no puede fijar costo: lo único que cuenta es el perfil derivado (el cart no trae peso/costo)', async () => {
    const { svc } = build();
    const evil = { ...cart(), weightKg: 0, costCents: 1, shippingFeeCents: 1 } as unknown as ShipCartInput;
    expect((await svc.quote({ cp: '64000', cart: evil, subtotalCents: 100000 })).shippingFeeCents).toBe(17700);
  });
  it('caché + single-flight: 5 cotizaciones simultáneas del mismo CP/perfil ⇒ 1 llamada a Skydropx; la siguiente sale de caché', async () => {
    const { svc, quote } = build();
    await Promise.all(Array.from({ length: 5 }, () => svc.quote({ cp: '64000', cart: cart(), subtotalCents: 100000 })));
    await svc.quote({ cp: '64000', cart: cart({ cards: 9 }), subtotalCents: 100000 });
    expect(quote).toHaveBeenCalledTimes(1);
  });
  it('timeout ⇒ respaldo por tabla: cobro = p75 + seguro + MX$20 = lo MOSTRADO y firmado; la llamada sigue y llena la caché', async () => {
    let release!: () => void;
    const slow = jest.fn(() => new Promise((res) => { release = () => res({ providerQuotationId: 'q', completed: true, rates: MTY_ENVELOPE, excluded: {}, insuranceEcho: { ok: true }, raw: null }); }));
    const { svc, cache } = build({ settings: { ship_quote_timeout_ms: 500 }, quote: slow });
    const dto = await svc.quote({ cp: '64000', cart: cart(), subtotalCents: 100000 });
    expect(dto.shippingFeeCents).toBe(Math.ceil((15000 + 2500 + 2000) / 100) * 100); // tabla: 150.00 + seguro escalón 25.00 + 20.00
    const v = svc.verifyToken(dto.quoteId);
    expect(v.ok && v.payload.fee).toBe(dto.shippingFeeCents);
    expect(v.ok && v.payload.snap.source).toBe('table');
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(await cache.get('shipq:v1:64000:envelope:1:2500')).toContain('standard_overnight');
  });
  it('disyuntor: 5 fallos seguidos ⇒ la 6ª ni intenta Skydropx (directo a tabla)', async () => {
    const boom = jest.fn(async () => { throw new Error('down'); });
    const { svc } = build({ quote: boom });
    for (let i = 0; i < 5; i++) await svc.quote({ cp: `6400${i}`, cart: cart(), subtotalCents: 100000 });
    expect(boom).toHaveBeenCalledTimes(5);
    await svc.quote({ cp: '64009', cart: cart(), subtotalCents: 100000 });
    expect(boom).toHaveBeenCalledTimes(5);
  });
  it('tabla vacía y Skydropx caído ⇒ 503 SHIPPING_QUOTE_UNAVAILABLE (nunca un precio inventado)', async () => {
    const { svc } = build({ quote: jest.fn(async () => { throw new Error('x'); }), zone: [] });
    await expect(svc.quote({ cp: '64000', cart: cart(), subtotalCents: 100000 })).rejects.toMatchObject({ code: 'SHIPPING_QUOTE_UNAVAILABLE' });
  });
  it('sin Overnight cotizable ⇒ Express Saver + MX$20', async () => {
    const q = jest.fn(async () => ({ providerQuotationId: 'q', completed: true, rates: ONLY_EXPRESS_SAVER, excluded: {}, insuranceEcho: { ok: true }, raw: null }));
    const { svc } = build({ quote: q });
    expect((await svc.quote({ cp: '64000', cart: cart(), subtotalCents: 100000 })).shippingFeeCents).toBe(Math.ceil((5226 + 1500 + 2000) / 100) * 100);
  });
  it('pedido ≥ MX$4,000: cobro 0, SIN llamar a nadie', async () => {
    const { svc, quote } = build();
    const dto = await svc.quote({ cp: '64000', cart: cart(), subtotalCents: 400000 });
    expect(dto.shippingFeeCents).toBe(0);
    expect(quote).not.toHaveBeenCalled();
  });
  it('CP mal formado ⇒ 400', async () => {
    const { svc } = build();
    await expect(svc.quote({ cp: '6400', cart: cart(), subtotalCents: 1 })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  describe('gate (lo que `session` exige)', () => {
    const gateOf = async (svc: ShippingQuoteService, token: string, o: { cp?: string; c?: ShipCartInput; s?: number } = {}) =>
      svc.gate({ token, cp: o.cp ?? '64000', profile: await svc.profileOf(o.c ?? cart()), subtotalCents: o.s ?? 100000, freeFromCents: 400000 });
    it('vigente, mismo CP y perfil ⇒ ok con el cobro firmado', async () => {
      const { svc } = build();
      const { quoteId } = await svc.quote({ cp: '64000', cart: cart(), subtotalCents: 100000 });
      expect(await gateOf(svc, quoteId)).toMatchObject({ ok: true, feeCents: 17700 });
    });
    it('manipulado, ausente, otro CP, otro perfil o caducado ⇒ stale', async () => {
      const { svc } = build();
      const { quoteId } = await svc.quote({ cp: '64000', cart: cart(), subtotalCents: 100000, now: new Date(Date.now() - 31 * 60_000) });
      expect(await gateOf(svc, quoteId)).toEqual({ ok: false }); // caducado
      const fresh = (await svc.quote({ cp: '64000', cart: cart(), subtotalCents: 100000 })).quoteId;
      expect(await gateOf(svc, fresh + 'x')).toEqual({ ok: false });
      expect(await gateOf(svc, '')).toEqual({ ok: false });
      expect(await gateOf(svc, fresh, { cp: '06600' })).toEqual({ ok: false });
      expect(await gateOf(svc, fresh, { c: cart({ sealedSubtypes: ['etb'] }) })).toEqual({ ok: false });
    });
    it('token «gratis por umbral» NO sirve si el pedido ya bajó del umbral', async () => {
      const { svc } = build();
      const free = (await svc.quote({ cp: '64000', cart: cart(), subtotalCents: 450000 })).quoteId;
      expect(await gateOf(svc, free, { s: 100000 })).toEqual({ ok: false });
      expect(await gateOf(svc, free, { s: 450000 })).toMatchObject({ ok: true, feeCents: 0 });
    });
    it('umbral DESPUÉS del descuento: con código y S ≥ T el token firmado lleva el cobro de referencia (tabla) y rige si el descuento baja de T', async () => {
      const { svc } = build();
      const free = (await svc.quote({ cp: '64000', cart: cart(), subtotalCents: 450000 })).quoteId;
      const withCode = svc.gate({ token: free, cp: '64000', profile: await svc.profileOf(cart()), subtotalCents: 450000, freeFromCents: 400000, hasCode: true });
      expect(withCode).toMatchObject({ ok: true, feeCents: Math.ceil((15000 + 2500 + 2000) / 100) * 100 });
      // con código y sin token válido ⇒ stale (nunca «gratis» por no tener cifra); sin código sigue siendo 0
      expect(svc.gate({ token: '', cp: '64000', profile: await svc.profileOf(cart()), subtotalCents: 450000, freeFromCents: 400000, hasCode: true })).toEqual({ ok: false });
      expect(svc.gate({ token: '', cp: '64000', profile: await svc.profileOf(cart()), subtotalCents: 450000, freeFromCents: 400000 })).toMatchObject({ ok: true, feeCents: 0 });
      // un token de umbral NO sirve si el subtotal ya está bajo el umbral (antes de código)
      expect(svc.gate({ token: free, cp: '64000', profile: await svc.profileOf(cart()), subtotalCents: 399999, freeFromCents: 400000, hasCode: true })).toEqual({ ok: false });
    });
    it('subtotal ≥ umbral sin token ⇒ cobro 0 (el umbral manda)', async () => {
      const { svc } = build();
      expect(await gateOf(svc, '', { s: 400000 })).toMatchObject({ ok: true, feeCents: 0 });
      expect(await gateOf(svc, '', { s: 399999 })).toEqual({ ok: false });
    });
  });
});

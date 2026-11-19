import { createHmac, timingSafeEqual } from 'crypto';
import { SETTING_DEFAULTS } from '../settings/settings.constants';
import { MTY_ENVELOPE, ONLY_EXPRESS_SAVER } from './fixtures';
import { MemoryShipQuoteCache } from './ship-quote-cache';
import { MemoryShipQuoteControl } from './ship-quote-control';
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
  const svc = new ShippingQuoteService(prisma as never, settings as never, pii as never, postal as never, { quote } as never, cache, new MemoryShipQuoteControl());
  return { svc, quote, prisma, cache, settings, postal };
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

  describe('QA-ENV3-REF0: sin `ref` válido nunca hay envío 0', () => {
    it('pedido ≥ umbral con tabla vacía ⇒ 503 (no se firma ref=0)', async () => {
      const { svc } = build({ zone: [] });
      await expect(svc.quote({ cp: '64000', cart: cart(), subtotalCents: 450000 })).rejects.toMatchObject({ code: 'SHIPPING_QUOTE_UNAVAILABLE' });
    });
    it('un fallo de BD al leer la tabla también propaga (no se traga)', async () => {
      const { svc, prisma } = build();
      prisma.shippingZoneRate.findMany.mockRejectedValueOnce(new Error('db down'));
      await expect(svc.quote({ cp: '64000', cart: cart(), subtotalCents: 450000 })).rejects.toThrow('db down');
    });
    it('token de umbral SIN ref (o con ref 0) ⇒ stale, con o sin código; sin token y sin código ⇒ 0', async () => {
      const { svc } = build();
      const profile = await svc.profileOf(cart());
      const free = (await svc.quote({ cp: '64000', cart: cart(), subtotalCents: 450000 })).quoteId;
      const payload = JSON.parse(Buffer.from(free.split('.')[0], 'base64url').toString());
      const sign = (o: object) => {
        const p1 = Buffer.from(JSON.stringify(o)).toString('base64url');
        return `${p1}.${pii.domainHmac('ship-quote:v1:', p1)}`;
      };
      const { ref: _r, ...noRef } = payload;
      const args = { cp: '64000', profile, subtotalCents: 450000, freeFromCents: 400000 };
      expect(svc.gate({ ...args, token: sign(noRef) })).toEqual({ ok: false });
      expect(svc.gate({ ...args, token: sign(noRef), hasCode: true })).toEqual({ ok: false });
      expect(svc.gate({ ...args, token: sign({ ...payload, ref: 0 }), hasCode: true })).toEqual({ ok: false });
      expect(svc.gate({ ...args, token: '' })).toMatchObject({ ok: true, feeCents: 0 });
    });
  });

  describe('ENV3-3: disyuntor con timeouts y 5xx, tope global y semáforo', () => {
    const hang = () => jest.fn(() => new Promise(() => undefined));
    const cps = (n: number) => Array.from({ length: n }, (_, i) => `6${String(i).padStart(4, '0')}`);
    it('5 timeouts (CPs distintos, Skydropx colgado) ⇒ el disyuntor abre y la 6ª no llama', async () => {
      const q = hang();
      const { svc } = build({ settings: { ship_quote_timeout_ms: 500 }, quote: q });
      for (const cp of cps(5)) await svc.quote({ cp, cart: cart(), subtotalCents: 100000 });
      expect(q).toHaveBeenCalledTimes(5);
      await svc.quote({ cp: '69999', cart: cart(), subtotalCents: 100000 });
      expect(q).toHaveBeenCalledTimes(5);
    });
    it('error 5xx cuenta; 4xx NO cuenta', async () => {
      const mk = (status: number) => jest.fn(async () => { throw Object.assign(new Error('x'), { httpStatus: status }); });
      const q4 = mk(422);
      const a = build({ quote: q4 });
      for (const cp of cps(6)) await a.svc.quote({ cp, cart: cart(), subtotalCents: 100000 });
      expect(q4).toHaveBeenCalledTimes(6);
      const q5 = mk(503);
      const b = build({ quote: q5 });
      for (const cp of cps(6)) await b.svc.quote({ cp, cart: cart(), subtotalCents: 100000 });
      expect(q5).toHaveBeenCalledTimes(5);
    });
    it('tope global ship_skydropx_max_per_min: la llamada 4ª del minuto va a la tabla sin tocar Skydropx', async () => {
      const q = jest.fn(async () => ({ providerQuotationId: 'q', completed: true, rates: MTY_ENVELOPE, excluded: {}, insuranceEcho: { ok: true }, raw: null }));
      const { svc } = build({ settings: { ship_skydropx_max_per_min: 3 }, quote: q });
      const out = [];
      for (const cp of cps(5)) out.push(await svc.quote({ cp, cart: cart(), subtotalCents: 100000 }));
      expect(q).toHaveBeenCalledTimes(3);
      expect(out.every((o) => o.shippingFeeCents > 0)).toBe(true);
    });
    it('semáforo: máx. 8 llamadas en vuelo a la vez', async () => {
      const q = hang();
      const { svc } = build({ settings: { ship_quote_timeout_ms: 500 }, quote: q });
      await Promise.all(cps(12).map((cp) => svc.quote({ cp, cart: cart(), subtotalCents: 100000 })));
      expect(q.mock.calls.length).toBeLessThanOrEqual(8);
    });
    it('caché con TTL por dial y rango (negativos se ignoran)', async () => {
      const { svc, cache } = build({ settings: { ship_cache_ttl_s: 120 } });
      const setSpy = jest.spyOn(cache, 'set');
      await svc.quote({ cp: '64000', cart: cart(), subtotalCents: 100000 });
      expect(setSpy).toHaveBeenCalledWith(expect.any(String), expect.any(String), 120);
      await cache.set('shipq:v1:64222:envelope:1:2500', JSON.stringify({ serviceCode: 'standard_overnight', serviceName: 'x', carrier: 'fedex', etaDays: 1, transportCents: -5, insuranceCents: 0, extendedAreaCents: 0 }), 60);
      const dto = await svc.quote({ cp: '64222', cart: cart(), subtotalCents: 100000 });
      expect(dto.shippingFeeCents).toBeGreaterThan(1000); // el -5 de caché se ignoró y se cotizó de verdad
    });
  });

  describe('re-gate: M-E / M-C / M-3', () => {
    const cps = (n: number) => Array.from({ length: n }, (_, i) => `6${String(i).padStart(4, '0')}`);
    it('M-E: un timeout cuenta UNA vez aunque la llamada termine fallando después (4 timeouts + 4 rechazos tardíos no abren el disyuntor)', async () => {
      const rejecters: Array<() => void> = [];
      const q = jest.fn(() => new Promise((_, rej) => { rejecters.push(() => rej(Object.assign(new Error('late'), { httpStatus: 503 }))); }));
      const { svc } = build({ settings: { ship_quote_timeout_ms: 500 }, quote: q });
      for (const cp of cps(4)) await svc.quote({ cp, cart: cart(), subtotalCents: 100000 });
      rejecters.forEach((r) => r());
      await new Promise((r) => setTimeout(r, 20));
      await svc.quote({ cp: '69998', cart: cart(), subtotalCents: 100000 });
      expect(q).toHaveBeenCalledTimes(5); // con doble conteo (4×2 = 8 ≥ 5) la 5ª ya no llamaría
    });
    it('M-C: valor sobre el escalón mayor ⇒ el seguro NO es 0 (tarifa del escalón mayor, proporcional)', async () => {
      const boom = jest.fn(async () => { throw new Error('down'); });
      const { svc } = build({ quote: boom });
      const big = await svc.quote({ cp: '64000', cart: cart({ cards: 3, valueCents: 2000000 }), subtotalCents: 399999 });
      const v = svc.verifyToken(big.quoteId);
      expect(v.ok && v.payload.snap.source).toBe('table');
      // tabla 150.00 + seguro proporcional a MX$20,000 (≥ el del escalón mayor MX$170) + MX$20
      expect(big.shippingFeeCents).toBeGreaterThanOrEqual(Math.ceil((15000 + 17000 + 2000) / 100) * 100);
    });
    it('M-3: el sondeo de un CP fuera de catálogo no cuenta como llamada ni gasta tope', async () => {
      const q = jest.fn(async () => ({ providerQuotationId: 'q', completed: true, rates: MTY_ENVELOPE, excluded: {}, insuranceEcho: { ok: true }, raw: null }));
      const { svc, postal } = build({ quote: q });
      postal.resolvePostalCode.mockResolvedValueOnce(null as never);
      expect(await svc.probe('99999', 250000)).toBe(0);
      expect(q).not.toHaveBeenCalled();
    });
  });

  describe('QA-ENV3-LOG: solo muestras de servicio de ship_service_order a domicilio', () => {
    it('la cotización viva NO registra sucursal ni servicios fuera del orden', async () => {
      const rates = [
        ...MTY_ENVELOPE,
        { ...MTY_ENVELOPE[0], rateId: 'br', deliveryKind: 'branch' as const, totalCents: 1 },
        { ...MTY_ENVELOPE[0], rateId: 'ltl', serviceCode: 'ltl_1_day', totalCents: 2 },
      ];
      const q = jest.fn(async () => ({ providerQuotationId: 'q', completed: true, rates, excluded: {}, insuranceEcho: { ok: true }, raw: null }));
      const { svc, prisma } = build({ quote: q });
      await svc.quote({ cp: '64000', cart: cart(), subtotalCents: 100000 });
      await new Promise((r) => setTimeout(r, 10));
      const data = (prisma.shippingQuoteLog.createMany.mock.calls[0] as unknown as [{ data: { serviceCode: string; costCents: number }[] }])[0].data;
      expect(data.map((d) => d.costCents).sort((a, b) => a - b)).toEqual([5226, 14186]);
    });
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
      expect(await gateOf(svc, free, { s: 450000 })).toMatchObject({ ok: true, feeCents: 19500 }); // el `ref` firmado; el umbral lo deja en 0 mientras S' ≥ T
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

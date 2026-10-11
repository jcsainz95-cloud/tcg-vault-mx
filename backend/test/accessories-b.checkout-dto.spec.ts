/**
 * §AC.4 (cuerpo aditivo de `GuestQuoteDto`/`GuestSessionDto`) y §AC.5 / criterio 749 (con cuenta se RECHAZAN, ⛔ no se
 * ignoran). Se mide con el `ValidationPipe` de `main.ts` (`whitelist: true`): una llave no declarada se borraría en
 * silencio, que es exactamente lo que 749 prohíbe.
 */
import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { GuestQuoteDto, GuestSessionDto } from '../src/modules/orders/dto/guest-checkout.dto';
import { QuoteDto, SessionDto } from '../src/modules/orders/dto/orders.dto';
import { BusinessException } from '../src/common/business.exception';
import { OrdersController } from '../src/modules/orders/orders.controller';

const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false });
const meta = (metatype: unknown): ArgumentMetadata => ({ type: 'body', metatype: metatype as ArgumentMetadata['metatype'] });
const UUID = '6f1c2f9a-2a51-4c7e-9b3e-1f2d3c4b5a69';
const UUID2 = '7a2d3e4f-5b6c-4d7e-8f90-a1b2c3d4e5f6';
const ADDRESS = {
  line1: 'Av. Reforma 100',
  neighborhood: 'Juárez',
  city: 'Ciudad de México',
  state: 'CDMX',
  postalCode: '06600',
  country: 'MX',
  phone: '5512345678',
  recipientName: 'Juan Pérez',
};
const session = (over: Record<string, unknown>) => ({ email: 'g@example.com', shippingAddress: ADDRESS, acceptedTerms: true, ...over });

async function codeOf(p: Promise<unknown>): Promise<{ status: number; code: string; details: Record<string, unknown> }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof BusinessException) return { status: e.getStatus(), code: e.code, details: e.details };
    if (e instanceof BadRequestException) return { status: 400, code: 'VALIDATION_ERROR', details: {} };
    throw e;
  }
  return { status: 200, code: 'OK', details: {} };
}

describe('§AC.4 GuestQuoteDto / GuestSessionDto', () => {
  it('solo accesorios (sin piezas) ⇒ válido; inventoryItemIds pasa a OPCIONAL (default [])', async () => {
    const q = (await pipe.transform({ accessoryLines: [{ accessoryId: UUID, quantity: 2 }] }, meta(GuestQuoteDto))) as GuestQuoteDto;
    expect(q.inventoryItemIds).toEqual([]);
    expect(q.accessoryLines).toEqual([{ accessoryId: UUID, quantity: 2 }]);
    const s = (await pipe.transform(session({ accessoryLines: [{ accessoryId: UUID, quantity: 1 }] }), meta(GuestSessionDto))) as GuestSessionDto;
    expect(s.inventoryItemIds).toEqual([]);
  });

  it('carrito vacío (sin piezas ni accesorios) ⇒ 400 VALIDATION_ERROR en el DTO', async () => {
    expect((await codeOf(pipe.transform({}, meta(GuestQuoteDto)))).status).toBe(400);
    expect((await codeOf(pipe.transform({ inventoryItemIds: [], accessoryLines: [] }, meta(GuestQuoteDto)))).status).toBe(400);
    expect((await codeOf(pipe.transform(session({}), meta(GuestSessionDto)))).status).toBe(400);
  });

  it('accessoryId repetido ⇒ 400 {field:"accessoryLines"}', async () => {
    const r = await codeOf(
      pipe.transform({ accessoryLines: [{ accessoryId: UUID, quantity: 1 }, { accessoryId: UUID, quantity: 2 }] }, meta(GuestQuoteDto)),
    );
    expect(r).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', details: { field: 'accessoryLines' } });
    const s = await codeOf(pipe.transform(session({ accessoryLines: [{ accessoryId: UUID, quantity: 1 }, { accessoryId: UUID, quantity: 1 }] }), meta(GuestSessionDto)));
    expect(s).toMatchObject({ status: 400, details: { field: 'accessoryLines' } });
  });

  it.each([
    ['quantity 0', [{ accessoryId: UUID, quantity: 0 }]],
    ['quantity 100', [{ accessoryId: UUID, quantity: 100 }]],
    ['quantity 1.5', [{ accessoryId: UUID, quantity: 1.5 }]],
    ['accessoryId no uuid', [{ accessoryId: 'x', quantity: 1 }]],
    ['21 renglones', Array.from({ length: 21 }, (_, i) => ({ accessoryId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, quantity: 1 }))],
  ])('accessoryLines inválido (%s) ⇒ 400', async (_n, lines) => {
    expect((await codeOf(pipe.transform({ accessoryLines: lines }, meta(GuestQuoteDto)))).status).toBe(400);
  });

  it('deckPulls: ≤ 10, pullToken ≤ 4096, withEnergyBundle booleano', async () => {
    const ok = (await pipe.transform({ inventoryItemIds: ['i1'], deckPulls: [{ pullToken: 'a.b', withEnergyBundle: true }] }, meta(GuestQuoteDto))) as GuestQuoteDto;
    expect(ok.deckPulls).toEqual([{ pullToken: 'a.b', withEnergyBundle: true }]);
    expect((await codeOf(pipe.transform({ inventoryItemIds: ['i1'], deckPulls: Array.from({ length: 11 }, () => ({ pullToken: 't', withEnergyBundle: false })) }, meta(GuestQuoteDto)))).status).toBe(400);
    expect((await codeOf(pipe.transform({ inventoryItemIds: ['i1'], deckPulls: [{ pullToken: 'x'.repeat(4097), withEnergyBundle: false }] }, meta(GuestQuoteDto)))).status).toBe(400);
    expect((await codeOf(pipe.transform({ inventoryItemIds: ['i1'], deckPulls: [{ pullToken: 't', withEnergyBundle: 'yes' }] }, meta(GuestQuoteDto)))).status).toBe(400);
  });

  it('I-AC-3: un precio en el cuerpo no se declara ⇒ el whitelist lo borra (no hay campo de precio en el DTO)', async () => {
    const q = (await pipe.transform(
      { accessoryLines: [{ accessoryId: UUID, quantity: 1, priceCents: 1, unitPriceCents: 1 }], shippingFeeCents: 1, priceCents: 1 },
      meta(GuestQuoteDto),
    )) as unknown as Record<string, unknown>;
    expect(q).not.toHaveProperty('shippingFeeCents');
    expect(q).not.toHaveProperty('priceCents');
    expect((q.accessoryLines as Record<string, unknown>[])[0]).toEqual({ accessoryId: UUID, quantity: 1 });
  });
});

describe('§AC.5 / criterio 749 — compra con cuenta: accesorios y paquetes se RECHAZAN (422), ⛔ no se ignoran', () => {
  it('QuoteDto y SessionDto DECLARAN accessoryLines y deckPulls (el whitelist no los borra)', async () => {
    const q = (await pipe.transform({ inventoryItemIds: ['i1'], accessoryLines: [{ accessoryId: UUID, quantity: 1 }], deckPulls: [{ pullToken: 't', withEnergyBundle: true }] }, meta(QuoteDto))) as QuoteDto & Record<string, unknown>;
    expect(q.accessoryLines).toHaveLength(1);
    expect(q.deckPulls).toHaveLength(1);
    const s = (await pipe.transform({ inventoryItemIds: ['i1'], accessoryLines: [{ accessoryId: UUID2, quantity: 1 }] }, meta(SessionDto))) as SessionDto & Record<string, unknown>;
    expect(s.accessoryLines).toHaveLength(1);
  });

  const orders = { quote: jest.fn(async () => ({})), createSession: jest.fn(async () => ({ reused: false })) };
  const controller = new OrdersController(orders as never, {} as never);
  const res = { status: jest.fn() };
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['accessoryLines', { accessoryLines: [{ accessoryId: UUID, quantity: 1 }] }],
    ['deckPulls', { deckPulls: [{ pullToken: 't', withEnergyBundle: true }] }],
    ['deckPulls sin paquete', { deckPulls: [{ pullToken: 't', withEnergyBundle: false }] }],
  ])('POST /checkout/quote con %s ⇒ 422 ACCESSORIES_REQUIRE_DIRECT_SHIP y el servicio NO corre', async (_n, extra) => {
    const r = await codeOf(Promise.resolve().then(() => controller.quote('u1', { inventoryItemIds: ['i1'], ...extra } as QuoteDto)));
    expect(r).toMatchObject({ status: 422, code: 'ACCESSORIES_REQUIRE_DIRECT_SHIP' });
    expect(orders.quote).not.toHaveBeenCalled();
  });

  it.each([
    ['accessoryLines', { accessoryLines: [{ accessoryId: UUID, quantity: 1 }] }],
    ['deckPulls', { deckPulls: [{ pullToken: 't', withEnergyBundle: true }] }],
  ])('POST /checkout/session con %s ⇒ 422 y ⛔ ni pedido ni cobro (el servicio NO corre)', async (_n, extra) => {
    const r = await codeOf(controller.session('u1', { inventoryItemIds: ['i1'], ...extra } as SessionDto, res as never));
    expect(r).toMatchObject({ status: 422, code: 'ACCESSORIES_REQUIRE_DIRECT_SHIP' });
    expect(orders.createSession).not.toHaveBeenCalled();
  });

  it('vacíos ⇒ conducta de hoy (CONTROL)', async () => {
    await controller.quote('u1', { inventoryItemIds: ['i1'], accessoryLines: [], deckPulls: [] } as unknown as QuoteDto);
    expect(orders.quote).toHaveBeenCalledWith(['i1'], 'u1');
  });
});

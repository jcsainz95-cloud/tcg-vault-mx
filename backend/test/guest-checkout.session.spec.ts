import { GuestCheckoutService } from '../src/modules/orders/guest-checkout.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { OrderAccessTokenService } from '../src/modules/orders/order-access-token.service';
import { GuestOrderMailService } from '../src/modules/orders/guest-order-mail.service';
import { BusinessException } from '../src/common/business.exception';
import { computeDirectShipBreakdown } from '../src/common/money';
import {
  GUEST_CHECKOUT_TOKEN_TTL_MIN,
  GUEST_TRACKING_TTL_DAYS,
} from '../src/modules/orders/guest-checkout.constants';

const FEE = { stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 };
const IVA = 16;
const SHIPPING = 17500;

const ADDRESS = {
  line1: 'Av. Reforma 100',
  line2: 'Depto 3',
  neighborhood: 'Juárez',
  city: 'Ciudad de México',
  state: 'CDMX',
  postalCode: '06600',
  country: 'MX',
  phone: '5512345678',
  recipientName: 'Juan Pérez López',
};

function buildService(opts: { stripeFails?: unknown; itemAvailable?: boolean } = {}) {
  const state = { available: opts.itemAvailable ?? true };
  const created: any[] = [];
  const itemUpdates: any[] = [];
  const prisma: any = {
    // INVARIANTE §4-G.0-4: el camino de invitado JAMÁS consulta `User`. Cualquier acceso
    // a `prisma.user` en este flujo hace estallar el test (es la garantía del criterio 56
    // a nivel de CÓDIGO, no de mensaje).
    get user() {
      throw new Error('INVARIANTE VIOLADO: el checkout de invitado consultó la tabla User');
    },
    inventoryItem: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        itemUpdates.push({ where, data });
        if (data.status === 'reserved') {
          if (!state.available) return { count: 0 };
          state.available = false;
          return { count: 1 };
        }
        return { count: 1 };
      }),
    },
    order: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: 'order-guest-1', createdAt: new Date(), ...data };
        created.push(row);
        return row;
      }),
      update: jest.fn(async () => ({})),
      findMany: jest.fn(async () => []),
    },
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
  };
  const orders: any = {
    priceCartLines: jest.fn(async (ids: string[]) => ({
      items: [],
      subtotalCents: 25000 * ids.length,
      lines: ids.map((id) => ({
        inventoryItemId: id,
        cardSnapshot: { name: 'E2E Charizard', setName: 'Base', number: '4' },
        unitPriceCents: 25000,
      })),
    })),
    nextOrderNumber: jest.fn(async () => 'TCG-000123'),
  };
  const settings: any = {
    getNumber: jest.fn(async (key: string) => (key.includes('shipping') ? SHIPPING : IVA)),
    getStripeFee: jest.fn(async () => FEE),
  };
  const stripe: any = {
    createPaymentIntent: opts.stripeFails
      ? jest.fn().mockRejectedValue(opts.stripeFails)
      : jest.fn(async () => ({ id: 'pi_guest_1', clientSecret: 'cs_guest_1' })),
    cancelPaymentIntent: jest.fn(async () => undefined),
  };
  const tokens: any = {
    issue: jest.fn(async () => ({
      clear: 'CLEAR_TOKEN_43_CHARS',
      expiresAt: new Date('2026-08-18T12:00:00.000Z'),
    })),
  };
  const mail: any = { sendTrackingLink: jest.fn(), sendConfirmation: jest.fn() };
  const svc = new GuestCheckoutService(
    prisma as PrismaService,
    orders as OrdersService,
    settings as SettingsService,
    stripe as StripeService,
    tokens as OrderAccessTokenService,
    mail as GuestOrderMailService,
  );
  return { svc, prisma, orders, stripe, tokens, mail, created, itemUpdates };
}

const validDto = () => ({
  inventoryItemIds: ['item-1'],
  email: '  Guest@Example.COM ',
  shippingAddress: { ...ADDRESS },
  acceptedTerms: true as const,
});

/**
 * POST /checkout/guest/session (API_CONTRACT §4-G.2) + los cinco invariantes de §4-G.0.
 */
describe('GuestCheckoutService.createSession', () => {
  it('destino bóveda ⇒ 422 VAULT_REQUIRES_ACCOUNT con details.upsell (criterio 48: NO es un error de UI)', async () => {
    const { svc, prisma } = buildService();
    await expect(
      svc.createSession({ ...validDto(), fulfillmentMode: 'vault' } as never),
    ).rejects.toMatchObject({
      code: 'VAULT_REQUIRES_ACCOUNT',
      details: { upsell: true, reason: 'VAULT_REQUIRES_ACCOUNT' },
    });
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it('dirección fuera de México ⇒ 422 ADDRESS_NOT_MX (solo nacional, PROJECT §D)', async () => {
    const { svc } = buildService();
    const dto = { ...validDto(), shippingAddress: { ...ADDRESS, country: 'US' } };
    await expect(svc.createSession(dto as never)).rejects.toMatchObject({ code: 'ADDRESS_NOT_MX' });
  });

  it('INVARIANTE 1: la reserva NO toca ownerType/ownerUserId/ownershipStatus (un invitado no tiene bóveda)', async () => {
    const { svc, itemUpdates } = buildService();
    await svc.createSession(validDto() as never);
    const reserve = itemUpdates.find((u) => u.data.status === 'reserved');
    expect(reserve.data).toEqual({ status: 'reserved' });
    expect(reserve.data).not.toHaveProperty('ownerType');
    expect(reserve.data).not.toHaveProperty('ownerUserId');
    expect(reserve.data).not.toHaveProperty('ownershipStatus');
    // Guardia positiva: solo se reserva una pieza de PLATAFORMA en estado vendible.
    expect(reserve.where).toMatchObject({ ownerType: 'platform', status: { in: ['listed', 'in_stock'] } });
  });

  it('crea la Order de invitado con userId=null, correo normalizado, direct_ship y snapshot', async () => {
    const { svc, created } = buildService();
    await svc.createSession(validDto() as never);
    const order = created[0];
    expect(order.userId).toBeNull();
    expect(order.guestEmail).toBe('guest@example.com'); // trim + lowercase
    expect(order.fulfillmentMode).toBe('direct_ship');
    expect(order.orderNumber).toBe('TCG-000123');
    expect(order.shippingAddressSnapshot).toMatchObject({ city: 'Ciudad de México', country: 'MX' });
    expect(order.shippingFeeCents).toBe(SHIPPING);
    expect(order.status).toBe('pending');
  });

  it('INVARIANTE 2: UN SOLO PaymentIntent por el total (cartas + envío + IVA + fee)', async () => {
    const { svc, stripe } = buildService();
    const res = await svc.createSession(validDto() as never);
    const expected = computeDirectShipBreakdown(25000, SHIPPING, IVA, FEE);
    expect(stripe.createPaymentIntent).toHaveBeenCalledTimes(1);
    expect(stripe.createPaymentIntent.mock.calls[0][0].amountCents).toBe(expected.totalCents);
    expect(res.breakdown).toEqual(expected);
    expect(res.breakdown.shippingFeeCents).toBe(SHIPPING);
  });

  it('la metadata del PaymentIntent NO lleva userId (no hay usuario) y marca el pedido como guest', async () => {
    const { svc, stripe } = buildService();
    await svc.createSession(validDto() as never);
    const meta = stripe.createPaymentIntent.mock.calls[0][0].metadata;
    expect(meta).toMatchObject({ orderId: 'order-guest-1', kind: 'order', guest: 'true' });
    expect(meta).not.toHaveProperty('userId');
  });

  it('INVARIANTE 5: devuelve el `checkoutToken` en claro a quien acaba de crear el pedido', async () => {
    const { svc } = buildService();
    const out = await svc.createSession(validDto() as never);
    expect(out.checkoutToken).toBe('CLEAR_TOKEN_43_CHARS');
    expect(out.checkoutTokenExpiresAt).toEqual(new Date('2026-08-18T12:00:00.000Z'));
    expect(out.orderId).toBe('order-guest-1');
    expect(out.orderNumber).toBe('TCG-000123');
    expect(out.stripe).toEqual({ paymentIntentId: 'pi_guest_1', clientSecret: 'cs_guest_1' });
    // v1.21.1: el campo se llama `checkoutToken`; el nombre viejo NO debe sobrevivir.
    expect(out).not.toHaveProperty('trackingToken');
  });

  it('v1.21.1 §4-G.7a: el token del checkout es de VIDA CORTA (120 min), no de 90 días', async () => {
    const { svc, tokens } = buildService();
    await svc.createSession(validDto() as never);
    expect(tokens.issue).toHaveBeenCalledWith(
      'order-guest-1',
      expect.objectContaining({ ttlMs: GUEST_CHECKOUT_TOKEN_TTL_MIN * 60 * 1000 }),
    );
    // Y NO es el TTL del enlace de seguimiento (el de correo).
    const ttlMs = tokens.issue.mock.calls[0][1].ttlMs;
    expect(ttlMs).toBe(2 * 60 * 60 * 1000);
    expect(ttlMs).toBeLessThan(GUEST_TRACKING_TTL_DAYS * 24 * 60 * 60 * 1000);
  });

  it('el token de la sesión se emite SIN rotar (el correo de confirmación no debe matarlo)', async () => {
    const { svc, tokens } = buildService();
    await svc.createSession(validDto() as never);
    expect(tokens.issue).toHaveBeenCalledWith('order-guest-1', expect.objectContaining({ rotate: false }));
  });

  it('pieza ya vendida/reservada ⇒ 409 ITEM_UNAVAILABLE (anti double-sell)', async () => {
    const { svc } = buildService({ itemAvailable: false });
    await expect(svc.createSession(validDto() as never)).rejects.toMatchObject({
      code: 'ITEM_UNAVAILABLE',
    });
  });

  it('A2: si Stripe falla tras reservar, libera la reserva (→listed), marca failed y pide reintento', async () => {
    const { svc, itemUpdates, prisma } = buildService({ stripeFails: new Error('stripe down') });
    await expect(svc.createSession(validDto() as never)).rejects.toMatchObject({
      code: 'PAYMENT_PROVIDER_UNAVAILABLE',
    });
    const release = itemUpdates.find((u) => u.data.status === 'listed');
    expect(release).toBeDefined();
    expect(release.where).toMatchObject({ status: 'reserved' });
    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'failed' } }),
    );
  });

  it('un error de negocio de Stripe (CARD_DECLINED) se propaga tal cual tras compensar', async () => {
    const declined = BusinessException.validation('CARD_DECLINED', 'Card was declined');
    const { svc, itemUpdates } = buildService({ stripeFails: declined });
    await expect(svc.createSession(validDto() as never)).rejects.toMatchObject({ code: 'CARD_DECLINED' });
    expect(itemUpdates.some((u) => u.data.status === 'listed')).toBe(true);
  });
});

describe('GuestCheckoutService.quote', () => {
  it('devuelve desglose con envío, modo direct_ship y las banderas de avisos (sin texto)', async () => {
    const { svc } = buildService();
    const res = await svc.quote({ inventoryItemIds: ['item-1'] } as never);
    expect(res.fulfillmentMode).toBe('direct_ship');
    expect(res.breakdown).toEqual(computeDirectShipBreakdown(25000, SHIPPING, IVA, FEE));
    expect(res.notices).toEqual({ finalSale: true, invoiceByEmail: true, termsRequired: true });
  });

  it('es READ-ONLY: no reserva inventario ni crea pedido', async () => {
    const { svc, prisma } = buildService();
    await svc.quote({ inventoryItemIds: ['item-1'] } as never);
    expect(prisma.inventoryItem.updateMany).not.toHaveBeenCalled();
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it('valida el país si se envía dirección (422 ADDRESS_NOT_MX)', async () => {
    const { svc } = buildService();
    await expect(
      svc.quote({ inventoryItemIds: ['item-1'], shippingAddress: { ...ADDRESS, country: 'US' } } as never),
    ).rejects.toMatchObject({ code: 'ADDRESS_NOT_MX' });
  });

  it('el precio del invitado es el MISMO que el del comprador con cuenta (misma fuente de precio)', async () => {
    const { svc, orders } = buildService();
    await svc.quote({ inventoryItemIds: ['item-1'] } as never);
    // Comparte `OrdersService.priceCartLines` con POST /checkout/quote: no hay tabla de precios
    // paralela para invitados (criterio 48b: comprar como invitado no cambia condiciones).
    expect(orders.priceCartLines).toHaveBeenCalledWith(['item-1']);
  });
});

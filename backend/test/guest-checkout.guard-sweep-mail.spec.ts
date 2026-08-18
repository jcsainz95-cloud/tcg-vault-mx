import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { RejectAuthenticatedGuard } from '../src/modules/orders/guards/reject-authenticated.guard';
import { PrismaService } from '../src/prisma/prisma.service';
import { GuestCheckoutService } from '../src/modules/orders/guest-checkout.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { OrderAccessTokenService } from '../src/modules/orders/order-access-token.service';
import { GuestOrderMailService } from '../src/modules/orders/guest-order-mail.service';
import {
  guestOrderConfirmationTemplate,
  guestTrackingLinkTemplate,
} from '../src/modules/orders/mail/guest-order.templates';
import { maskEmail, maskPostalCode, maskRecipientName, normalizeEmail } from '../src/modules/orders/guest-privacy';
import { GUEST_ORDER_RESERVATION_TTL_MIN } from '../src/modules/orders/guest-checkout.constants';

function ctxWith(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers: authorization ? { authorization } : {} }) }),
  } as unknown as ExecutionContext;
}

/** §4-G.0-3: un endpoint, un tipo de comprador. */
describe('RejectAuthenticatedGuard — /checkout/guest/* rechaza sesiones válidas', () => {
  function build(opts: { verify?: unknown; user?: unknown } = {}) {
    const jwt: any = {
      verifyAsync: jest.fn(async () => {
        if (opts.verify instanceof Error) throw opts.verify;
        return opts.verify ?? { sub: 'user-1', tv: 0 };
      }),
    };
    const config: any = { get: jest.fn(() => 'secret') };
    const prisma: any = {
      user: { findUnique: jest.fn(async () => ('user' in opts ? opts.user : { status: 'active', tokenVersion: 0 })) },
    };
    return {
      guard: new RejectAuthenticatedGuard(jwt as JwtService, config as ConfigService, prisma as PrismaService),
      prisma,
    };
  }

  it('sin cabecera Authorization deja pasar (es un invitado)', async () => {
    const { guard, prisma } = build();
    await expect(guard.canActivate(ctxWith())).resolves.toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('con una sesión VÁLIDA lanza 409 ALREADY_AUTHENTICATED', async () => {
    const { guard } = build();
    await expect(guard.canActivate(ctxWith('Bearer token-valido'))).rejects.toMatchObject({
      code: 'ALREADY_AUTHENTICATED',
    });
    try {
      await guard.canActivate(ctxWith('Bearer token-valido'));
    } catch (e) {
      expect((e as { getStatus(): number }).getStatus()).toBe(409);
    }
  });

  it('un token inválido/expirado NO es una sesión: deja pasar como invitado', async () => {
    const { guard } = build({ verify: new Error('jwt expired') });
    await expect(guard.canActivate(ctxWith('Bearer token-podrido'))).resolves.toBe(true);
  });

  it('una cuenta bloqueada/borrada o con tokenVersion revocada tampoco es sesión', async () => {
    for (const user of [null, { status: 'blocked', tokenVersion: 0 }, { status: 'deleted', tokenVersion: 0 }, { status: 'active', tokenVersion: 7 }]) {
      const { guard } = build({ user });
      await expect(guard.canActivate(ctxWith('Bearer t'))).resolves.toBe(true);
    }
  });

  it('no puebla `req.user` (el camino de invitado no tiene identidad)', async () => {
    const { guard } = build({ verify: new Error('no') });
    const req: any = { headers: { authorization: 'Bearer x' } };
    const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
    await guard.canActivate(ctx);
    expect(req.user).toBeUndefined();
  });
});

/** T9 — barrido de reservas de pedidos de invitado no pagados (ARCHITECTURE §4.21e). */
describe('GuestCheckoutService.sweepStaleGuestOrders', () => {
  function build(orders: any[]) {
    const released: any[] = [];
    const prisma: any = {
      order: {
        findMany: jest.fn(async ({ where }: any) => {
          const cutoff = where.createdAt.lt as Date;
          return orders.filter((o) => o.createdAt < cutoff);
        }),
        update: jest.fn(async ({ data }: any) => {
          released.push({ order: data });
          return {};
        }),
      },
      inventoryItem: {
        updateMany: jest.fn(async ({ where, data }: any) => {
          released.push({ items: where, data });
          return { count: 1 };
        }),
      },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const stripe: any = { cancelPaymentIntent: jest.fn(async () => undefined) };
    const svc = new GuestCheckoutService(
      prisma as PrismaService,
      {} as OrdersService,
      {} as SettingsService,
      stripe as StripeService,
      {} as OrderAccessTokenService,
      {} as GuestOrderMailService,
    );
    return { svc, prisma, stripe, released };
  }

  const staleOrder = {
    id: 'order-viejo',
    createdAt: new Date(Date.now() - (GUEST_ORDER_RESERVATION_TTL_MIN + 5) * 60_000),
    stripePaymentIntentId: 'pi_viejo',
    items: [{ inventoryItemId: 'item-1' }],
  };

  it('libera la reserva (reserved→listed), marca la orden failed y cancela el PaymentIntent', async () => {
    const { svc, stripe, released } = build([staleOrder]);
    expect(await svc.sweepStaleGuestOrders()).toEqual({ swept: 1 });
    expect(released).toContainEqual({
      items: { id: { in: ['item-1'] }, status: 'reserved' },
      data: { status: 'listed' },
    });
    expect(released).toContainEqual({ order: { status: 'failed' } });
    expect(stripe.cancelPaymentIntent).toHaveBeenCalledWith('pi_viejo');
  });

  it('solo barre pedidos de INVITADO `pending` fuera de la ventana de reserva', async () => {
    const { svc, prisma } = build([staleOrder]);
    await svc.sweepStaleGuestOrders();
    expect(prisma.order.findMany.mock.calls[0][0].where).toMatchObject({
      status: 'pending',
      guestEmail: { not: null },
      fulfillmentMode: 'direct_ship',
    });
  });

  it('un pedido reciente no se toca', async () => {
    const { svc, stripe } = build([{ ...staleOrder, createdAt: new Date() }]);
    expect(await svc.sweepStaleGuestOrders()).toEqual({ swept: 0 });
    expect(stripe.cancelPaymentIntent).not.toHaveBeenCalled();
  });

  it('un fallo cancelando el PI no aborta el barrido', async () => {
    const { svc, stripe } = build([staleOrder]);
    stripe.cancelPaymentIntent.mockRejectedValue(new Error('ya capturado'));
    await expect(svc.sweepStaleGuestOrders()).resolves.toEqual({ swept: 1 });
  });
});

/** Minimización en el CORREO (ARCHITECTURE §4.21g). */
describe('Plantillas de correo del invitado', () => {
  const params = {
    orderNumber: 'TCG-000123',
    items: [{ name: 'Charizard', setName: 'Base Set', number: '4' }],
    totalCents: 51812,
    trackingUrl: 'https://tcgvaultmx.com/es/pedido?token=SECRET_TOKEN',
  };

  it('la confirmación lleva pedido, cartas, total y el enlace — y nada más sensible', () => {
    const msg = guestOrderConfirmationTemplate(params, 'es');
    expect(msg.subject).toContain('TCG-000123');
    expect(msg.html).toContain('Charizard');
    expect(msg.html).toContain(params.trackingUrl);
    // PROHIBIDO en el correo (§4.21g): dirección completa, teléfono y datos de tarjeta.
    for (const forbidden of ['Av. Reforma', '5512345678', '4242']) {
      expect(msg.html).not.toContain(forbidden);
      expect(msg.text).not.toContain(forbidden);
    }
    // Y NINGÚN enlace a una acción: el único href del correo es el de seguimiento (solo LEE).
    const hrefs = [...msg.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual([params.trackingUrl]);
  });

  it('ofrece crear cuenta con el mismo correo y comunica ventas finales + factura por correo', () => {
    const msg = guestOrderConfirmationTemplate(params, 'es');
    expect(msg.text).toMatch(/cuenta/i);
    expect(msg.text).toMatch(/ventas finales/i);
    expect(msg.text).toMatch(/factura|CFDI/i);
  });

  it('es bilingüe por `Order.locale` (ES por defecto)', () => {
    expect(guestOrderConfirmationTemplate(params, 'en').subject).toMatch(/confirmed/i);
    expect(guestOrderConfirmationTemplate(params, null).subject).toMatch(/Confirmación/i);
  });

  it('escapa el HTML de los valores dinámicos (S15-B1)', () => {
    const msg = guestOrderConfirmationTemplate(
      { ...params, items: [{ name: '<script>alert(1)</script>', setName: 'Base', number: '4' }] },
      'es',
    );
    expect(msg.html).not.toContain('<script>');
    expect(msg.html).toContain('&lt;script&gt;');
  });

  it('el correo de reenvío solo lleva el pedido y el enlace nuevo', () => {
    const msg = guestTrackingLinkTemplate(
      { orderNumber: 'TCG-000123', trackingUrl: params.trackingUrl },
      'es',
    );
    expect(msg.html).toContain(params.trackingUrl);
    expect(msg.html).not.toContain('Charizard');
    expect(msg.text).not.toMatch(/\$/);
  });
});

describe('Helpers de minimización (funciones puras)', () => {
  it('maskEmail conserva solo la inicial y el TLD', () => {
    expect(maskEmail('juan.perez@example.com')).toBe('j***@***.com');
    expect(maskEmail('a@b.mx')).toBe('a***@***.mx');
    expect(maskEmail(null)).toBe('');
  });

  it('maskPostalCode deja solo los 2 últimos dígitos', () => {
    expect(maskPostalCode('06600')).toBe('***00');
    expect(maskPostalCode('64000')).toBe('***00');
  });

  it('maskRecipientName deja nombre + inicial del apellido', () => {
    expect(maskRecipientName('Juan Pérez López')).toBe('Juan P.');
    expect(maskRecipientName('Ana')).toBe('Ana');
    expect(maskRecipientName('  ')).toBe('');
  });

  it('normalizeEmail hace trim + lowercase (clave de comparación del reclamo)', () => {
    expect(normalizeEmail('  Juan@Example.COM ')).toBe('juan@example.com');
  });
});

import { GuestCheckoutService } from '../src/modules/orders/guest-checkout.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { OrderAccessTokenService } from '../src/modules/orders/order-access-token.service';
import { GuestOrderMailService } from '../src/modules/orders/guest-order-mail.service';
import { GUEST_TRACKING_MAX_AGE_DAYS } from '../src/modules/orders/guest-checkout.constants';

const ORDER = {
  id: 'order-1',
  orderNumber: 'TCG-000123',
  guestEmail: 'juan@example.com',
  locale: 'es',
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
};

function buildService(opts: { order?: any; quotaExceeded?: boolean; tokenOrderId?: string | null } = {}) {
  const order = opts.order === undefined ? ORDER : opts.order;
  const prisma: any = {
    get user() {
      throw new Error('INVARIANTE VIOLADO: el reenvío consultó la tabla User');
    },
    order: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (!order) return null;
        if (where.id) return where.id === order.id ? order : null;
        if (where.orderNumber) return where.orderNumber === order.orderNumber ? order : null;
        return null;
      }),
    },
  };
  const tokens: any = {
    validate: jest.fn(async () =>
      opts.tokenOrderId
        ? { ok: false, code: 'TOKEN_EXPIRED', token: { orderId: opts.tokenOrderId } }
        : { ok: false, code: 'INVALID_TOKEN' },
    ),
    resendQuotaExceeded: jest.fn(async () => opts.quotaExceeded ?? false),
  };
  const mail: any = { sendTrackingLink: jest.fn(async () => new Date()) };
  const svc = new GuestCheckoutService(
    prisma as PrismaService,
    {} as OrdersService,
    {} as SettingsService,
    {} as StripeService,
    tokens as OrderAccessTokenService,
    mail as GuestOrderMailService,
  );
  return { svc, prisma, tokens, mail };
}

/**
 * POST /orders/guest/resend-link (§4-G.4). Su razón de ser en seguridad: NO debe servir como
 * oráculo de "¿este correo compró aquí?" ni como vector de spam a terceros.
 */
describe('resendLink — forma del request (única fuente de 400)', () => {
  it('acepta { token }', () => {
    const { svc } = buildService();
    expect(svc.resendLink({ token: 'abc' })).toEqual({ status: 'ACCEPTED' });
  });

  it('acepta { email, orderNumber } juntos', () => {
    const { svc } = buildService();
    expect(svc.resendLink({ email: 'a@b.com', orderNumber: 'TCG-000123' })).toEqual({ status: 'ACCEPTED' });
  });

  it('RECHAZA `email` a solas (sería un oráculo de "este correo compró aquí")', () => {
    const { svc } = buildService();
    expect(() => svc.resendLink({ email: 'a@b.com' })).toThrow();
    try {
      svc.resendLink({ email: 'a@b.com' });
    } catch (e) {
      expect((e as { code: string }).code).toBe('VALIDATION_ERROR');
      expect((e as { getStatus(): number }).getStatus()).toBe(400);
    }
  });

  it('RECHAZA `orderNumber` a solas y el request vacío', () => {
    const { svc } = buildService();
    expect(() => svc.resendLink({ orderNumber: 'TCG-000123' })).toThrow();
    expect(() => svc.resendLink({})).toThrow();
  });

  it('RECHAZA las dos formas a la vez (unión discriminada, no mezcla)', () => {
    const { svc } = buildService();
    expect(() => svc.resendLink({ token: 'abc', email: 'a@b.com', orderNumber: 'TCG-1' })).toThrow();
  });
});

describe('resendLink — NEUTRALIDAD: siempre 202 con el mismo cuerpo (criterio 53)', () => {
  it('mismo cuerpo exista o no el pedido, el correo o el token', async () => {
    const existing = buildService();
    const missing = buildService({ order: null });
    const bodies = [
      existing.svc.resendLink({ email: ORDER.guestEmail, orderNumber: ORDER.orderNumber }),
      existing.svc.resendLink({ email: 'otro@example.com', orderNumber: ORDER.orderNumber }),
      existing.svc.resendLink({ email: ORDER.guestEmail, orderNumber: 'TCG-999999' }),
      missing.svc.resendLink({ email: 'nadie@example.com', orderNumber: 'TCG-000001' }),
      missing.svc.resendLink({ token: 'token-inventado' }),
    ];
    for (const b of bodies) expect(b).toEqual({ status: 'ACCEPTED' });
  });

  it('no devuelve GUEST_ORDER_TOO_OLD (sería un oráculo de existencia): responde 202 igual', async () => {
    const old = { ...ORDER, createdAt: new Date('2020-01-01T00:00:00.000Z') };
    const { svc, mail } = buildService({ order: old });
    expect(svc.resendLink({ email: old.guestEmail, orderNumber: old.orderNumber })).toEqual({
      status: 'ACCEPTED',
    });
    // ...y sin embargo NO se envía correo.
    const sent = await svc.processResend({ email: old.guestEmail, orderNumber: old.orderNumber });
    expect(sent).toBe(false);
    expect(mail.sendTrackingLink).not.toHaveBeenCalled();
  });
});

describe('resendLink — trabajo real (best-effort, silencioso)', () => {
  it('con el par correcto envía el enlace SIEMPRE a Order.guestEmail (nunca al correo del request)', async () => {
    const { svc, mail } = buildService();
    // El request trae el correo con otra capitalización/espacios: se normaliza para COMPARAR.
    const sent = await svc.processResend({ email: '  Juan@Example.com ', orderNumber: 'TCG-000123' });
    expect(sent).toBe(true);
    expect(mail.sendTrackingLink).toHaveBeenCalledTimes(1);
    expect(mail.sendTrackingLink.mock.calls[0][0].guestEmail).toBe(ORDER.guestEmail);
  });

  it('con un par INCORRECTO (correo que no es el del pedido) no produce ningún correo', async () => {
    const { svc, mail } = buildService();
    expect(await svc.processResend({ email: 'atacante@example.com', orderNumber: 'TCG-000123' })).toBe(false);
    expect(mail.sendTrackingLink).not.toHaveBeenCalled();
  });

  it('con número de pedido inexistente no produce ningún correo', async () => {
    const { svc, mail } = buildService();
    expect(await svc.processResend({ email: ORDER.guestEmail, orderNumber: 'TCG-999999' })).toBe(false);
    expect(mail.sendTrackingLink).not.toHaveBeenCalled();
  });

  it('acepta un token EXPIRADO para identificar el pedido (camino "enlace caducado")', async () => {
    const { svc, mail } = buildService({ tokenOrderId: 'order-1' });
    expect(await svc.processResend({ token: 'token-expirado' })).toBe(true);
    expect(mail.sendTrackingLink).toHaveBeenCalledTimes(1);
  });

  it('un token inventado no identifica ningún pedido ⇒ no hay correo', async () => {
    const { svc, mail } = buildService({ tokenOrderId: null });
    expect(await svc.processResend({ token: 'token-inventado' })).toBe(false);
    expect(mail.sendTrackingLink).not.toHaveBeenCalled();
  });

  it('respeta el tope por pedido de enlaces emitidos en 24h', async () => {
    const { svc, mail } = buildService({ quotaExceeded: true });
    expect(await svc.processResend({ email: ORDER.guestEmail, orderNumber: ORDER.orderNumber })).toBe(false);
    expect(mail.sendTrackingLink).not.toHaveBeenCalled();
  });

  it(`no emite enlaces para pedidos de más de ${GUEST_TRACKING_MAX_AGE_DAYS} días`, async () => {
    const justOld = {
      ...ORDER,
      createdAt: new Date(Date.now() - (GUEST_TRACKING_MAX_AGE_DAYS + 1) * 86_400_000),
    };
    const { svc, mail } = buildService({ order: justOld });
    expect(await svc.processResend({ email: ORDER.guestEmail, orderNumber: ORDER.orderNumber })).toBe(false);
    expect(mail.sendTrackingLink).not.toHaveBeenCalled();
  });

  it('un pedido con cuenta (sin guestEmail) nunca recibe enlace de invitado', async () => {
    const { svc, mail } = buildService({ order: { ...ORDER, guestEmail: null } });
    expect(await svc.processResend({ email: 'x@y.com', orderNumber: ORDER.orderNumber })).toBe(false);
    expect(mail.sendTrackingLink).not.toHaveBeenCalled();
  });

  it('un fallo del correo no propaga (best-effort)', async () => {
    const { svc, mail } = buildService();
    mail.sendTrackingLink.mockRejectedValue(new Error('resend caído'));
    await expect(svc.processResend({ email: ORDER.guestEmail, orderNumber: ORDER.orderNumber })).resolves.toBe(
      false,
    );
  });
});

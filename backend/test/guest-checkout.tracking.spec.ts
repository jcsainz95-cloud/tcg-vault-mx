import { GuestCheckoutService } from '../src/modules/orders/guest-checkout.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { OrderAccessTokenService } from '../src/modules/orders/order-access-token.service';
import { GuestOrderMailService } from '../src/modules/orders/guest-order-mail.service';

/**
 * Datos SENSIBLES plantados a propósito en las filas de BD que la vista pública lee. Si alguno
 * aparece en la respuesta, el test falla: la minimización es del PAYLOAD, no de la UI.
 */
const SECRETS = {
  orderUuid: '3f4b1a52-0000-4000-8000-000000000001',
  inventoryItemId: 'inv-uuid-1',
  cardId: 'card-uuid-1',
  folio: 'INV-000123',
  locationId: 'loc-uuid-1',
  shipmentId: 'shp-uuid-1',
  orderItemId: 'oi-uuid-1',
  guestEmail: 'juan.perez@example.com',
  phone: '5512345678',
  line1: 'Av. Reforma 100',
  line2: 'Depto 3',
  neighborhood: 'Juárez',
  postalCode: '06600',
  recipientName: 'Juan Pérez López',
  pi: 'pi_live_super_secret',
  clientSecret: 'pi_live_super_secret_secret_abc',
  chargeId: 'ch_live_secret',
  billingRfc: 'XAXX010101000',
};

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SECRETS.orderUuid,
    userId: null,
    guestEmail: SECRETS.guestEmail,
    orderNumber: 'TCG-000123',
    fulfillmentMode: 'direct_ship',
    status: 'settled',
    subtotalCents: 25000,
    shippingFeeCents: 17500,
    ivaCents: 6800,
    ivaRatePct: 16,
    processingFeeCents: 2512,
    totalCents: 51812,
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    settledAt: new Date('2026-08-01T10:05:00.000Z'),
    refundedAt: null,
    claimedAt: null,
    locale: 'es',
    paymentMethodBrand: 'visa',
    paymentMethodLast4: '4242',
    // Datos INTERNOS que viven en la fila y NO deben salir jamás:
    stripePaymentIntentId: SECRETS.pi,
    stripeChargeId: SECRETS.chargeId,
    chargebackNeedsManual: true,
    disputeOutcome: 'won',
    billingSnapshot: { rfc: SECRETS.billingRfc },
    cfdiStatus: 'registrado',
    invoiceRequested: false,
    shippingAddressSnapshot: {
      line1: SECRETS.line1,
      line2: SECRETS.line2,
      neighborhood: SECRETS.neighborhood,
      city: 'Ciudad de México',
      state: 'CDMX',
      postalCode: SECRETS.postalCode,
      country: 'MX',
      phone: SECRETS.phone,
      recipientName: SECRETS.recipientName,
    },
    items: [
      {
        id: SECRETS.orderItemId,
        orderId: SECRETS.orderUuid,
        inventoryItemId: SECRETS.inventoryItemId,
        unitPriceCents: 25000,
        cardSnapshot: { cardId: SECRETS.cardId },
        inventoryItem: {
          id: SECRETS.inventoryItemId,
          folio: SECRETS.folio,
          locationId: SECRETS.locationId,
          finish: 'holofoil',
          productType: 'raw',
          rawCondition: 'NM',
          sealedSubtype: null,
          gradingCompany: null,
          gradeValue: null,
          acquisitionCostCents: 70000,
          card: {
            id: SECRETS.cardId,
            name: 'Charizard',
            number: '4',
            imageSmallUrl: 'https://images.pokemontcg.io/base1/4.png',
            set: { name: 'Base Set' },
          },
        },
      },
    ],
    shipmentRequests: [],
    ...overrides,
  };
}

function shipmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SECRETS.shipmentId,
    userId: null,
    orderId: SECRETS.orderUuid,
    status: 'enviado',
    carrier: 'Estafeta',
    trackingNumber: 'EST123456789',
    shippingFeeCents: 0,
    shippingCostCents: 14900, // COSTO interno del carrier: prohibido exponerlo
    ivaCents: 0,
    processingFeeCents: 0,
    totalCents: 0,
    requestedAt: new Date('2026-08-01T10:06:00.000Z'),
    pickingAt: new Date('2026-08-01T10:06:00.000Z'),
    shippedAt: new Date('2026-08-02T10:00:00.000Z'),
    deliveredAt: null,
    addressSnapshot: {},
    ...overrides,
  };
}

function buildService(order: any, validation: any) {
  const prisma: any = {
    get user() {
      throw new Error('INVARIANTE VIOLADO: la vista de seguimiento consultó la tabla User');
    },
    order: { findUnique: jest.fn(async () => order) },
  };
  const tokens: any = {
    validate: jest.fn(async () => validation),
    markUsed: jest.fn(async () => undefined),
  };
  const svc = new GuestCheckoutService(
    prisma as PrismaService,
    {} as OrdersService,
    {} as SettingsService,
    {} as StripeService,
    tokens as OrderAccessTokenService,
    {} as GuestOrderMailService,
  );
  return { svc, prisma, tokens };
}

const okValidation = {
  ok: true,
  token: { id: 'tok-1', orderId: SECRETS.orderUuid, expiresAt: new Date('2026-10-30T10:00:00.000Z') },
};

/** Recolecta todas las claves y todos los valores primitivos de un objeto, en profundidad. */
function deepKeys(value: unknown, acc: string[] = []): string[] {
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      acc.push(k);
      deepKeys(v, acc);
    }
  }
  return acc;
}

describe('POST /orders/guest/track — MINIMIZACIÓN DE DATOS (§4-G.3, criterio 51)', () => {
  it('NO expone NINGUNO de los campos de la tabla cerrada de prohibidos', async () => {
    const { svc } = buildService(orderRow({ shipmentRequests: [shipmentRow()] }), okValidation);
    const dto = await svc.track('clear-token');
    const keys = new Set(deepKeys(dto));

    // Tabla normativa §4-G.3 — "cualquier campo fuera de la lista permitida está prohibido".
    const forbiddenKeys = [
      // Identificadores internos
      'orderId', 'userId', 'inventoryItemId', 'folio', 'cardId', 'locationId', 'shipmentId', 'orderItemId', 'id',
      // Dirección
      'line1', 'line2', 'neighborhood', 'postalCode', 'recipientName', 'country',
      // Contacto
      'email', 'guestEmail', 'phone',
      // Pago
      'stripePaymentIntentId', 'clientSecret', 'stripeChargeId', 'receipt_url',
      // Operación interna
      'chargebackNeedsManual', 'disputeOutcome', 'shippingCostCents', 'billingSnapshot',
      'acquisitionCostCents', 'cfdiStatus', 'invoiceRequested', 'fulfillmentMode', 'locale',
      // Acciones
      'actions', 'cancelUrl', 'refundUrl',
    ];
    for (const k of forbiddenKeys) {
      expect(keys.has(k)).toBe(false);
    }
  });

  it('NO filtra ningún VALOR sensible (ni siquiera bajo otro nombre de campo)', async () => {
    const { svc } = buildService(orderRow({ shipmentRequests: [shipmentRow()] }), okValidation);
    const json = JSON.stringify(await svc.track('clear-token'));
    for (const [name, secret] of Object.entries(SECRETS)) {
      if (name === 'postalCode') continue; // se comprueba aparte (van los 2 últimos dígitos)
      expect(json).not.toContain(secret);
    }
    // El CP completo no aparece; sí sus 2 últimos dígitos enmascarados.
    expect(json).not.toContain('"06600"');
    expect(json).toContain('***00');
  });

  it('expone EXACTAMENTE la allowlist del contrato (ni un campo de más en el nivel raíz)', async () => {
    const { svc } = buildService(orderRow({ shipmentRequests: [shipmentRow()] }), okValidation);
    const dto = await svc.track('clear-token');
    expect(Object.keys(dto).sort()).toEqual(
      [
        'breakdown', 'claim', 'emailMasked', 'items', 'orderNumber', 'payment', 'placedAt',
        'paidAt', 'shipping', 'status', 'support', 'tokenExpiresAt',
      ].sort(),
    );
  });

  it('enmascara correo, CP y nombre del destinatario; muestra ciudad/estado y la guía', async () => {
    const { svc } = buildService(orderRow({ shipmentRequests: [shipmentRow()] }), okValidation);
    const dto: any = await svc.track('clear-token');
    expect(dto.emailMasked).toBe('j***@***.com');
    expect(dto.shipping).toEqual({
      city: 'Ciudad de México',
      state: 'CDMX',
      postalCodeMasked: '***00',
      recipientNameMasked: 'Juan P.',
      carrier: 'Estafeta',
      trackingNumber: 'EST123456789',
      shippedAt: new Date('2026-08-02T10:00:00.000Z'),
      deliveredAt: undefined,
    });
  });

  it('de la tarjeta SOLO marca y últimos 4 (nunca PAN, BIN ni clientSecret)', async () => {
    const { svc } = buildService(orderRow({ shipmentRequests: [shipmentRow()] }), okValidation);
    const dto: any = await svc.track('clear-token');
    expect(dto.payment).toEqual({ brand: 'visa', last4: '4242' });
  });

  it('los items llevan datos de catálogo (públicos) y el precio, nunca ids internos', async () => {
    const { svc } = buildService(orderRow({ shipmentRequests: [shipmentRow()] }), okValidation);
    const dto: any = await svc.track('clear-token');
    expect(Object.keys(dto.items[0]).sort()).toEqual(
      [
        'finish', 'gradeValue', 'gradingCompany', 'imageSmallUrl', 'name', 'number',
        'productType', 'rawCondition', 'sealedSubtype', 'setName', 'unitPriceCents',
      ].sort(),
    );
  });

  it('el desglose es el que el comprador pagó, con la línea de envío', async () => {
    const { svc } = buildService(orderRow({ shipmentRequests: [shipmentRow()] }), okValidation);
    const dto: any = await svc.track('clear-token');
    expect(dto.breakdown).toEqual({
      subtotalCents: 25000,
      shippingFeeCents: 17500,
      ivaCents: 6800,
      ivaRatePct: 16,
      processingFeeCents: 2512,
      totalCents: 51812,
      currency: 'MXN',
    });
  });

  it('ofrece el reclamo mientras el pedido no esté vinculado, y deja de ofrecerlo al reclamarse', async () => {
    const a = buildService(orderRow(), okValidation);
    expect(((await a.svc.track('t')) as any).claim).toEqual({ available: true });
    const b = buildService(orderRow({ claimedAt: new Date(), userId: 'u1' }), okValidation);
    expect(((await b.svc.track('t')) as any).claim).toEqual({ available: false });
  });

  it('publica la ventana de disputa solo cuando hay entrega (criterio 56b)', async () => {
    const delivered = new Date('2026-08-05T10:00:00.000Z');
    const { svc } = buildService(
      orderRow({ shipmentRequests: [shipmentRow({ status: 'entregado', deliveredAt: delivered })] }),
      okValidation,
    );
    const dto: any = await svc.track('t');
    expect(dto.support.evidenceContact).toBe('soporte@tcgvaultmx.com');
    expect(dto.support.disputeWindowDays).toBe(7);
    expect(dto.support.disputeDeadlineAt).toEqual(new Date('2026-08-12T10:00:00.000Z'));

    const { svc: svc2 } = buildService(orderRow({ shipmentRequests: [shipmentRow()] }), okValidation);
    expect(((await svc2.track('t')) as any).support.disputeDeadlineAt).toBeUndefined();
  });

  it('registra el uso del token (telemetría de abuso) sin consumirlo', async () => {
    const { svc, tokens } = buildService(orderRow(), okValidation);
    await svc.track('t');
    expect(tokens.markUsed).toHaveBeenCalledWith('tok-1', expect.any(Date));
  });
});

describe('POST /orders/guest/track — mapeo normativo de estado público (§4-G.5)', () => {
  const cases: [string, string | null, string][] = [
    ['pending', null, 'pendiente_pago'],
    ['settled', null, 'pagado'],
    ['settled', 'solicitado', 'preparando'],
    ['settled', 'picking', 'preparando'],
    ['settled', 'guia', 'guia'],
    ['settled', 'enviado', 'enviado'],
    ['settled', 'entregado', 'entregado'],
    ['settled', 'cancelado', 'en_revision'],
    ['failed', 'picking', 'cancelado'],
    ['refunded', 'entregado', 'reembolsado'],
    ['chargeback', 'enviado', 'en_revision'],
  ];

  it.each(cases)('Order=%s + Shipment=%s ⇒ %s', async (orderStatus, shipmentStatus, expected) => {
    const { svc } = buildService(
      orderRow({
        status: orderStatus,
        shipmentRequests: shipmentStatus ? [shipmentRow({ status: shipmentStatus })] : [],
      }),
      okValidation,
    );
    const dto: any = await svc.track('t');
    expect(dto.status).toBe(expected);
  });

  it('NUNCA nombra el contracargo hacia el invitado (dice `en_revision`)', async () => {
    const { svc } = buildService(
      orderRow({ status: 'chargeback', shipmentRequests: [shipmentRow()] }),
      okValidation,
    );
    const json = JSON.stringify(await svc.track('t'));
    expect(json).not.toContain('chargeback');
    expect(json).toContain('en_revision');
  });
});

describe('POST /orders/guest/track — NEUTRALIDAD de las respuestas de error (criterio 52)', () => {
  async function errorOf(validation: any, order: any = orderRow()) {
    const { svc } = buildService(order, validation);
    try {
      await svc.track('whatever');
      throw new Error('debió lanzar');
    } catch (e) {
      const err = e as { code: string; getStatus?: () => number; getResponse?: () => unknown };
      return { code: err.code, status: err.getStatus?.(), body: err.getResponse?.() };
    }
  }

  it('token inventado y token de un pedido BORRADO son INDISTINGUIBLES (mismo 404 y mismo cuerpo)', async () => {
    const invented = await errorOf({ ok: false, code: 'INVALID_TOKEN' });
    const deletedOrder = await errorOf(okValidation, null);
    expect(invented.status).toBe(404);
    expect(invented.code).toBe('INVALID_TOKEN');
    expect(deletedOrder).toEqual(invented); // ni el mensaje ni los details cambian
  });

  it('token expirado ⇒ 410 TOKEN_EXPIRED, sin cuerpo de pedido', async () => {
    const res = await errorOf({ ok: false, code: 'TOKEN_EXPIRED', token: { id: 't' } });
    expect(res.status).toBe(410);
    expect(res.code).toBe('TOKEN_EXPIRED');
    expect(JSON.stringify(res.body)).not.toContain('TCG-000123');
  });

  it('token revocado ⇒ 410 TOKEN_REVOKED con el motivo, sin cuerpo de pedido', async () => {
    const res = await errorOf({ ok: false, code: 'TOKEN_REVOKED', token: { id: 't' }, reason: 'CLAIMED' });
    expect(res.status).toBe(410);
    expect(res.code).toBe('TOKEN_REVOKED');
    expect(res.body).toMatchObject({ details: { reason: 'CLAIMED' } });
    expect(JSON.stringify(res.body)).not.toContain('TCG-000123');
  });

  it('ningún error de seguimiento revela si el pedido existe (ni por mensaje ni por PII)', async () => {
    for (const v of [
      { ok: false, code: 'INVALID_TOKEN' },
      { ok: false, code: 'TOKEN_EXPIRED', token: { id: 't' } },
      { ok: false, code: 'TOKEN_REVOKED', token: { id: 't' }, reason: 'ROTATED' },
    ]) {
      const res = await errorOf(v);
      const json = JSON.stringify(res.body);
      expect(json).not.toContain(SECRETS.guestEmail);
      expect(json).not.toContain(SECRETS.orderUuid);
      expect(json).not.toContain('TCG-000123');
    }
  });
});

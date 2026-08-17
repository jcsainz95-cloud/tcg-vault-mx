/**
 * vault-shipments.e2e-spec.ts — Integración/E2E contra Postgres real.
 * Cubre: bóveda/portafolio (valor a referencia), retiro solo sobre `settled`, tarifa
 * fija de envío con IVA + fee gross-up, y rechazo de direcciones no-MX.
 * API_CONTRACT §3, §5; ARCHITECTURE §3.3, §5.1; PROJECT criterios 8, 9, 10, 31.
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_CARDS, E2E_FOLIOS, E2E_USERS } from '../../prisma/e2e-fixtures';
import { computeShipmentBreakdown } from '../../src/common/money';

const FEE = { stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 };
const IVA = 16;
const SHIPPING = 17500;

describe('E2E — Bóveda/portafolio y retiros', () => {
  let h: E2EHarness;
  let token: string;
  let addressId: string;
  const itemId: Record<string, string> = {};

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    token = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    const customer = await h.prisma.user.findUnique({ where: { email: E2E_USERS.customer.email } });
    const addr = await h.prisma.address.findFirst({ where: { userId: customer!.id } });
    addressId = addr!.id;
    for (const [key, folio] of Object.entries(E2E_FOLIOS)) {
      const inv = await h.prisma.inventoryItem.findUnique({ where: { folio } });
      if (inv) itemId[key] = inv.id;
    }
  });

  afterAll(async () => {
    await h?.close();
  });

  describe('portafolio (Mi bóveda)', () => {
    it('valúa a referencia y no muestra saldo/wallet', async () => {
      const res = await h.api('GET', '/vault/holdings', { token });
      expect(res.status).toBe(200);
      const folios = (res.body.data as any[]).map((d) => d.folio);
      expect(folios).toEqual(expect.arrayContaining([E2E_FOLIOS.custSettled, E2E_FOLIOS.custPending]));
      // Valor de portafolio = suma de referencias (charizard + common).
      expect(res.body.portfolio.totalValueMxnCents).toBe(E2E_CARDS.charizard.refNmCents + E2E_CARDS.common.refNmCents);
      expect(res.body.portfolio.currency).toBe('MXN');
      expect(res.body).not.toHaveProperty('balance');
      expect(res.body).not.toHaveProperty('wallet');
    });

    it('distingue titularidad settled vs pending en la bóveda', async () => {
      const res = await h.api('GET', '/vault/holdings', { token });
      const data = res.body.data as any[];
      const settled = data.find((d) => d.folio === E2E_FOLIOS.custSettled);
      const pending = data.find((d) => d.folio === E2E_FOLIOS.custPending);
      expect(settled.ownershipStatus).toBe('settled');
      expect(pending.ownershipStatus).toBe('pending');
    });
  });

  describe('retiros / envíos', () => {
    it('quote clasifica settled (elegible) y pending (no elegible) con tarifa fija', async () => {
      const res = await h.api('POST', '/shipments/quote', {
        token,
        json: { inventoryItemIds: [itemId.custSettled, itemId.custPending], addressId },
      });
      expect(res.status).toBe(200);
      expect(res.body.eligibleItemIds).toContain(itemId.custSettled);
      const notSettled = (res.body.ineligible as any[]).find((i) => i.inventoryItemId === itemId.custPending);
      expect(notSettled.reason).toBe('ITEM_NOT_SETTLED');

      const expected = computeShipmentBreakdown(SHIPPING, IVA, FEE);
      expect(res.body.breakdown).toMatchObject({
        subtotalCents: SHIPPING,
        ivaCents: expected.ivaCents,
        processingFeeCents: expected.processingFeeCents,
        totalCents: expected.totalCents,
      });
    });

    it('incluir una carta pending en el retiro → 422 ITEM_NOT_SETTLED', async () => {
      const res = await h.api('POST', '/shipments', {
        token,
        json: { inventoryItemIds: [itemId.custSettled, itemId.custPending], addressId },
        headers: { 'idempotency-key': 'ship-mixed' },
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('ITEM_NOT_SETTLED');
    });

    it('rechaza direcciones fuera de México (422 ADDRESS_NOT_MX)', async () => {
      const res = await h.api('POST', '/users/me/addresses', {
        token,
        json: {
          line1: '1 Foreign St',
          city: 'Austin',
          state: 'TX',
          postalCode: '73301',
          country: 'US',
          phone: '5125550000',
        },
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('ADDRESS_NOT_MX');
    });

    it('crea el retiro de una carta settled: cobro Stripe ANTES, nace en solicitado', async () => {
      const res = await h.api('POST', '/shipments', {
        token,
        json: { inventoryItemIds: [itemId.custSettled], addressId },
        headers: { 'idempotency-key': 'ship-ok' },
      });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('solicitado');
      expect(typeof res.body.stripe.paymentIntentId).toBe('string');
      const shipment = await h.prisma.shipmentRequest.findUnique({ where: { id: res.body.shipmentId } });
      expect(shipment!.status).toBe('solicitado');
      expect(shipment!.stripePaymentIntentId).toBe(res.body.stripe.paymentIntentId);
    });
  });

  /**
   * v1.17 — ciclo de retiro visible en la bóveda (API_CONTRACT §3/§5/§M4). Continúa del
   * retiro `ship-ok` (custSettled, solicitado): al pagar queda "EN RETIRO" y no retirable;
   * al llegar a `entregado` sale de la bóveda (withdrawn) y deja de contar en el portafolio.
   */
  describe('ciclo de retiro visible (v1.17)', () => {
    let adminToken: string;
    let shipmentId: string;
    let paymentIntentId: string;

    beforeAll(async () => {
      adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
      // El envío activo que contiene la carta settled (creado por 'ship-ok').
      const si = await h.prisma.shipmentItem.findFirst({
        where: {
          inventoryItemId: itemId.custSettled,
          shipmentRequest: { status: { notIn: ['cancelado', 'entregado'] } },
        },
        include: { shipmentRequest: true },
      });
      shipmentId = si!.shipmentRequestId;
      paymentIntentId = si!.shipmentRequest.stripePaymentIntentId!;
    });

    it('con envío activo: la carta se marca EN RETIRO y NO es retirable, pero SÍ cuenta', async () => {
      const res = await h.api('GET', '/vault/holdings', { token });
      const settled = (res.body.data as any[]).find((d) => d.folio === E2E_FOLIOS.custSettled);
      expect(settled).toBeDefined();
      expect(settled.shipmentState).toBe('solicitado');
      expect(settled.activeShipmentId).toBe(shipmentId);
      expect(settled.withdrawable).toBe(false);
      // Sigue contando en el portafolio (aún es del cliente).
      expect(res.body.portfolio.totalValueMxnCents).toBe(
        E2E_CARDS.charizard.refNmCents + E2E_CARDS.common.refNmCents,
      );
    });

    it('GET /shipments (mine) trae items enriquecidos y NO expone shippingCostCents', async () => {
      const res = await h.api('GET', '/shipments', { token });
      expect(res.status).toBe(200);
      const dto = (res.body.data as any[]).find((s) => s.id === shipmentId);
      expect(dto).toBeDefined();
      expect(dto).not.toHaveProperty('shippingCostCents');
      const item = dto.items.find((i: any) => i.inventoryItemId === itemId.custSettled);
      expect(item.folio).toBe(E2E_FOLIOS.custSettled);
      expect(typeof item.finish).toBe('string');
      expect(item.card).toMatchObject({ name: expect.any(String), setName: expect.any(String) });
    });

    it('GET /shipments (mine) NO devuelve retiros de otro usuario', async () => {
      const other = await h.login(E2E_USERS.customer2.email, E2E_USERS.customer2.password);
      const res = await h.api('GET', '/shipments', { token: other });
      expect(res.status).toBe(200);
      expect((res.body.data as any[]).some((s) => s.id === shipmentId)).toBe(false);
    });

    it('avanza solicitado→picking→guia→enviado→entregado y retira el item de la bóveda', async () => {
      // Pago liquidado → picking (webhook, sin tocar el item).
      const wh = await h.sendStripeWebhook({
        type: 'payment_intent.succeeded',
        data: { object: { id: paymentIntentId } },
      });
      expect(wh.status).toBe(200);
      let shipment = await h.prisma.shipmentRequest.findUnique({ where: { id: shipmentId } });
      expect(shipment!.status).toBe('picking');
      // El item NO se movió en el pago (sigue in_custody).
      let item = await h.prisma.inventoryItem.findUnique({ where: { id: itemId.custSettled } });
      expect(item!.status).toBe('in_custody');

      // guia (tracking) → enviado → entregado (admin).
      const tr = await h.api('POST', `/admin/shipments/${shipmentId}/tracking`, {
        token: adminToken,
        json: { carrier: 'DHL', trackingNumber: 'TRK-E2E-1' },
      });
      expect(tr.status).toBe(201);
      const s1 = await h.api('PATCH', `/admin/shipments/${shipmentId}/status`, {
        token: adminToken,
        json: { to: 'enviado' },
      });
      expect(s1.status).toBe(200);
      const s2 = await h.api('PATCH', `/admin/shipments/${shipmentId}/status`, {
        token: adminToken,
        json: { to: 'entregado' },
      });
      expect(s2.status).toBe(200);

      shipment = await h.prisma.shipmentRequest.findUnique({ where: { id: shipmentId } });
      expect(shipment!.status).toBe('entregado');

      // Transición terminal: item withdrawn, con movimiento, conservando titularidad histórica.
      item = await h.prisma.inventoryItem.findUnique({ where: { id: itemId.custSettled } });
      expect(item!.status).toBe('withdrawn');
      expect(item!.ownerType).toBe('customer');
      expect(item!.ownershipStatus).toBe('settled');
      const mov = await h.prisma.inventoryMovement.findFirst({
        where: { itemId: itemId.custSettled, reason: 'withdrawal' },
      });
      expect(mov).toBeTruthy();
      expect(mov!.toStatus).toBe('withdrawn');
    });

    it('tras entregado: la carta sale de la bóveda y deja de contar en el portafolio', async () => {
      const res = await h.api('GET', '/vault/holdings', { token });
      const folios = (res.body.data as any[]).map((d) => d.folio);
      expect(folios).not.toContain(E2E_FOLIOS.custSettled);
      // Solo queda la pending (common); el charizard entregado ya no cuenta.
      expect(res.body.portfolio.totalValueMxnCents).toBe(E2E_CARDS.common.refNmCents);
    });
  });
});

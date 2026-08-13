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

const FEE = { stripePct: 0.036, stripeFixedCents: 300 };
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
});

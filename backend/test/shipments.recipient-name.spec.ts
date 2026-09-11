import { ShipmentsService } from '../src/modules/shipments/shipments.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { StripeService } from '../src/modules/payments/stripe.service';

/**
 * v1.67 (M-52, Stream A · B5; contrato §0 `RECIPIENT_NAME_REQUIRED`, §5 «snapshot de NUEVE campos»;
 * ARCHITECTURE §4.47.4). Cierra D-CTA-3: todo retiro de bóveda nacía sin destinatario.
 */

/** Los NUEVE campos del `addressSnapshot` (contrato §5) — los mismos que `Order.shippingAddressSnapshot`. */
const SNAPSHOT_KEYS = [
  'recipientName', 'line1', 'line2', 'neighborhood', 'city', 'state', 'postalCode', 'country', 'phone',
].sort();

function build(recipientName: string | null, userName = 'Nombre De Cuenta') {
  const address = {
    id: 'addr1',
    userId: 'userA',
    recipientName,
    line1: 'Av. E2E 123',
    line2: null,
    neighborhood: 'Centro',
    city: 'CDMX',
    state: 'CDMX',
    postalCode: '01000',
    country: 'MX',
    phone: '5555555555',
  };
  const prisma: any = {
    address: { findUnique: jest.fn().mockResolvedValue(address) },
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'userA', name: userName }) },
    inventoryItem: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'item1', ownerUserId: 'userA', ownershipStatus: 'settled', status: 'in_custody' },
      ]),
    },
    shipmentItem: { findFirst: jest.fn().mockResolvedValue(null) },
    shipmentRequest: {
      create: jest.fn(async ({ data }: any) => ({ id: 'ship1', ...data })),
      update: jest.fn(),
      delete: jest.fn(),
      findUnique: jest.fn(),
    },
  };
  prisma.$transaction = jest.fn((fn: any) => fn(prisma));
  const settings: any = {
    getNumber: jest.fn().mockResolvedValue(17500),
    getStripeFee: jest.fn().mockResolvedValue({ stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 }),
  };
  const stripe: any = { createPaymentIntent: jest.fn().mockResolvedValue({ id: 'pi_1', clientSecret: 'cs' }) };
  const svc = new ShipmentsService(prisma as PrismaService, settings as SettingsService, stripe as StripeService);
  return { svc, prisma, stripe, address };
}

describe('ShipmentsService — 422 RECIPIENT_NAME_REQUIRED en quote y create (v1.67)', () => {
  it.each([['null (fila anterior a M-52)', null], ['vacío', ''], ['solo espacios', '   ']])(
    'create con recipientName %s ⇒ 422, ANTES de la tx y del PaymentIntent, sin fallback a User.name',
    async (_l, name) => {
      const { svc, prisma, stripe } = build(name);
      await expect(svc.create('userA', ['item1'], 'addr1')).rejects.toMatchObject({
        code: 'RECIPIENT_NAME_REQUIRED',
        details: { field: 'recipientName', addressId: 'addr1' },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.shipmentRequest.create).not.toHaveBeenCalled();
      expect(stripe.createPaymentIntent).not.toHaveBeenCalled();
      // ⛔ el servidor NUNCA consulta al usuario para rellenar el destinatario.
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    },
  );

  it('el 422 es de VALIDACIÓN (status 422) y se evalúa antes que la elegibilidad de items', async () => {
    const { svc, prisma } = build(null);
    let status = 0;
    try {
      await svc.create('userA', ['item1'], 'addr1');
    } catch (e: any) {
      status = e.getStatus();
    }
    expect(status).toBe(422);
    expect(prisma.inventoryItem.findMany).not.toHaveBeenCalled();
  });

  it('quote con recipientName null ⇒ 422 RECIPIENT_NAME_REQUIRED (lectura y escritura comparten regla)', async () => {
    const { svc } = build(null);
    await expect(svc.quote('userA', ['item1'], 'addr1')).rejects.toMatchObject({
      code: 'RECIPIENT_NAME_REQUIRED',
      details: { field: 'recipientName', addressId: 'addr1' },
    });
  });

  it('quote con destinatario ⇒ 200 normal (breakdown + clasificación)', async () => {
    const { svc } = build('Ana Pérez');
    const res = await svc.quote('userA', ['item1'], 'addr1');
    expect(res.eligibleItemIds).toEqual(['item1']);
    expect(res.breakdown.subtotalCents).toBe(17500);
  });

  it('una dirección no-MX sigue siendo ADDRESS_NOT_MX (se evalúa antes que el destinatario)', async () => {
    const { svc, prisma } = build(null);
    prisma.address.findUnique.mockResolvedValue({ id: 'addr1', userId: 'userA', country: 'US', recipientName: null });
    await expect(svc.quote('userA', ['item1'], 'addr1')).rejects.toMatchObject({ code: 'ADDRESS_NOT_MX' });
  });
});

describe('ShipmentsService.create — addressSnapshot de NUEVE campos (v1.67)', () => {
  it('congela recipientName copiado TAL CUAL de Address.recipientName (no de User.name)', async () => {
    const { svc, prisma, address } = build('Ana Pérez', 'Otro Nombre De Cuenta');
    const res = await svc.create('userA', ['item1'], 'addr1');
    expect(res.shipmentId).toBe('ship1');
    const snapshot = prisma.shipmentRequest.create.mock.calls[0][0].data.addressSnapshot;
    expect(Object.keys(snapshot).sort()).toEqual(SNAPSHOT_KEYS);
    expect(Object.keys(snapshot)).toHaveLength(9);
    expect(snapshot).toEqual({
      recipientName: 'Ana Pérez',
      line1: address.line1,
      line2: address.line2,
      neighborhood: address.neighborhood,
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
      country: address.country,
      phone: address.phone,
    });
    expect(snapshot.recipientName).not.toBe('Otro Nombre De Cuenta');
  });

  it('el snapshot guarda el destinatario RECORTADO (la fila puede traer espacios)', async () => {
    const { svc, prisma } = build('  Ana Pérez  ');
    await svc.create('userA', ['item1'], 'addr1');
    expect(prisma.shipmentRequest.create.mock.calls[0][0].data.addressSnapshot.recipientName).toBe('Ana Pérez');
  });
});

describe('M4 — `recipientName` del snapshot deja de ser `undefined` en retiros nuevos (§M4 v1.67)', () => {
  function adminBuild(addressSnapshot: Record<string, unknown>) {
    const prisma: any = {
      shipmentRequest: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'shp1', userId: 'userA', orderId: null, addressSnapshot, status: 'solicitado',
          shippingFeeCents: 1, shippingCostCents: 0, ivaCents: 0, processingFeeCents: 0, totalCents: 1,
          stripePaymentIntentId: null, carrier: null, trackingNumber: null, requestedAt: new Date(),
          pickingAt: null, shippedAt: null, deliveredAt: null, items: [], order: null,
        }),
      },
    };
    return new ShipmentsService(prisma as PrismaService, {} as SettingsService, {} as StripeService);
  }

  it('retiro v1.67 (9 campos) ⇒ recipientName poblado, sin cambio en `admin`', async () => {
    const svc = adminBuild({ recipientName: 'Ana Pérez', line1: 'x' });
    const dto = await svc.adminGet('shp1');
    expect(dto.kind).toBe('vault_withdrawal');
    expect(dto.recipientName).toBe('Ana Pérez');
  });

  it('retiro anterior a v1.67 (8 campos) ⇒ recipientName undefined (un snapshot no se reescribe)', async () => {
    const svc = adminBuild({ line1: 'x' });
    const dto = await svc.adminGet('shp1');
    expect(dto.recipientName).toBeUndefined();
    // La cola de M4 NO expone `customer {id,name,email}` (pregunta R5 de ux-ui): solo `userId`.
    expect(dto).not.toHaveProperty('customer');
    expect(dto.userId).toBe('userA');
  });
});

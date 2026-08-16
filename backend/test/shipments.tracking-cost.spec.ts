import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ShipmentsService } from '../src/modules/shipments/shipments.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import {
  SHIPPING_COST_MAX_CENTS,
  TrackingDto,
} from '../src/modules/shipments/dto/shipments.dto';

/**
 * v1.4-finance (M-16): captura del costo real de paquetería al asignar carrier/guía.
 * setTracking persiste shippingCostCents (opcional, editable); el DTO valida entero >= 0.
 */
describe('ShipmentsService.setTracking — shippingCostCents (v1.4-finance)', () => {
  function buildService() {
    const prisma: any = {
      shipmentRequest: {
        findUnique: jest.fn().mockResolvedValue({ id: 'ship1' }),
        update: jest.fn().mockImplementation(({ data }) => ({ id: 'ship1', ...data })),
      },
    };
    const svc = new ShipmentsService(
      prisma as PrismaService,
      {} as SettingsService,
      {} as StripeService,
    );
    return { svc, prisma };
  }

  it('persists shippingCostCents when provided and advances to guia', async () => {
    const { svc, prisma } = buildService();
    await svc.setTracking('ship1', 'DHL', 'TRACK123', 9000);
    expect(prisma.shipmentRequest.update).toHaveBeenCalledWith({
      where: { id: 'ship1' },
      data: { carrier: 'DHL', trackingNumber: 'TRACK123', status: 'guia', shippingCostCents: 9000 },
    });
  });

  it('does not touch shippingCostCents when omitted (keeps column default)', async () => {
    const { svc, prisma } = buildService();
    await svc.setTracking('ship1', 'DHL', 'TRACK123');
    const data = prisma.shipmentRequest.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('shippingCostCents');
  });

  it('is editable: re-invoking updates the persisted cost', async () => {
    const { svc, prisma } = buildService();
    await svc.setTracking('ship1', 'DHL', 'TRACK123', 0);
    await svc.setTracking('ship1', 'DHL', 'TRACK123', 12000);
    expect(prisma.shipmentRequest.update.mock.calls[0][0].data.shippingCostCents).toBe(0);
    expect(prisma.shipmentRequest.update.mock.calls[1][0].data.shippingCostCents).toBe(12000);
  });
});

describe('SEC-C1 — proyección de cliente NO expone shippingCostCents', () => {
  // Fila cruda de Prisma tal como quedaría tras M-16 (incluye el costo interno).
  const rawRow = {
    id: 'ship1',
    userId: 'user1',
    addressSnapshot: { city: 'CDMX' },
    status: 'guia',
    shippingFeeCents: 17500,
    shippingCostCents: 9000, // costo interno del carrier — NO debe salir al cliente
    ivaCents: 2800,
    processingFeeCents: 1200,
    totalCents: 21500,
    stripePaymentIntentId: 'pi_123',
    carrier: 'DHL',
    trackingNumber: 'TRACK123',
    requestedAt: new Date('2026-08-16T00:00:00Z'),
    pickingAt: null,
    shippedAt: null,
    deliveredAt: null,
    items: [],
  };

  function buildService(overrides: any = {}) {
    const prisma: any = {
      shipmentRequest: {
        findMany: jest.fn().mockResolvedValue([{ ...rawRow }]),
        findUnique: jest.fn().mockResolvedValue({ ...rawRow }),
        ...overrides,
      },
    };
    const svc = new ShipmentsService(
      prisma as PrismaService,
      {} as SettingsService,
      {} as StripeService,
    );
    return { svc, prisma };
  }

  it('getMine omits shippingCostCents (and stripePaymentIntentId) but keeps client fields', async () => {
    const { svc } = buildService();
    const res: any = await svc.getMine('user1', 'ship1');
    expect(res).not.toHaveProperty('shippingCostCents');
    expect(res).not.toHaveProperty('stripePaymentIntentId');
    // Campos que el cliente SÍ ve (API_CONTRACT §5), incluido processingFeeCents del breakdown.
    expect(res.shippingFeeCents).toBe(17500);
    expect(res.ivaCents).toBe(2800);
    expect(res.processingFeeCents).toBe(1200);
    expect(res.totalCents).toBe(21500);
    expect(res.status).toBe('guia');
    expect(res.carrier).toBe('DHL');
    expect(res.trackingNumber).toBe('TRACK123');
  });

  it('listMine omits shippingCostCents from every row', async () => {
    const { svc } = buildService();
    const res: any = await svc.listMine('user1');
    expect(res.data).toHaveLength(1);
    for (const row of res.data) {
      expect(row).not.toHaveProperty('shippingCostCents');
      expect(row.totalCents).toBe(21500);
    }
  });

  it('getMine still enforces ownership (404 for another user)', async () => {
    const { svc } = buildService();
    await expect(svc.getMine('someone-else', 'ship1')).rejects.toBeDefined();
  });
});

describe('TrackingDto — validación de shippingCostCents', () => {
  const base = { carrier: 'DHL', trackingNumber: 'TRACK123' };

  it('accepts an omitted shippingCostCents (optional)', async () => {
    const errors = await validate(plainToInstance(TrackingDto, { ...base }));
    expect(errors).toHaveLength(0);
  });

  it('accepts a non-negative integer', async () => {
    const errors = await validate(plainToInstance(TrackingDto, { ...base, shippingCostCents: 0 }));
    expect(errors).toHaveLength(0);
  });

  it('rejects a negative value', async () => {
    const errors = await validate(
      plainToInstance(TrackingDto, { ...base, shippingCostCents: -1 }),
    );
    expect(errors.some((e) => e.property === 'shippingCostCents')).toBe(true);
  });

  it('rejects a non-integer value', async () => {
    const errors = await validate(
      plainToInstance(TrackingDto, { ...base, shippingCostCents: 12.5 }),
    );
    expect(errors.some((e) => e.property === 'shippingCostCents')).toBe(true);
  });

  // SEC-C2: cota superior (evita distorsión del P&L / overflow Int32).
  it('accepts the maximum allowed value (boundary)', async () => {
    const errors = await validate(
      plainToInstance(TrackingDto, { ...base, shippingCostCents: SHIPPING_COST_MAX_CENTS }),
    );
    expect(errors).toHaveLength(0);
  });

  it('rejects a value above the maximum', async () => {
    const errors = await validate(
      plainToInstance(TrackingDto, { ...base, shippingCostCents: SHIPPING_COST_MAX_CENTS + 1 }),
    );
    expect(errors.some((e) => e.property === 'shippingCostCents')).toBe(true);
  });
});

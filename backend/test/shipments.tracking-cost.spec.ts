import { plainToInstance } from 'class-transformer';
import { matchesWhere } from './helpers/prisma-where';
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
  function buildService(inicial: Record<string, unknown> = {}) {
    // ⭐⭐ 2026-09-14 (`D-AVISO-2`) — **la fila es de verdad y el `where` se EVALÚA.**
    // `setTracking` dejó de decidir con un `if` sobre la lectura previa: ahora escribe la etiqueta
    // con un `updateMany` **condicionado al valor viejo** y el `count` lo decide el motor. Con
    // `update: jest.fn()` estas pruebas no podían distinguir el código nuevo del viejo — el mock
    // devolvía lo que le dijeran justo en la línea que decide si se reinicia el ciclo del aviso.
    const fila: Record<string, unknown> = {
      id: 'ship1',
      status: 'picking',
      carrier: null,
      trackingNumber: null,
      trackingNoticeSentAt: null,
      shippingCostCents: 0,
      shippingCostIvaCents: 0,
      ...inicial,
    };
    const prisma: any = {
      shipmentRequest: {
        findUnique: jest.fn(async () => ({ ...fila })),
        findUniqueOrThrow: jest.fn(async () => ({ ...fila })),
        update: jest.fn(async ({ data }: any) => {
          Object.assign(fila, data);
          return { ...fila };
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (!matchesWhere(fila, where)) return { count: 0 };
          Object.assign(fila, data);
          return { count: 1 };
        }),
      },
    };
    const svc = new ShipmentsService(
      prisma as PrismaService,
      {} as SettingsService,
      {} as StripeService,
    );
    return { svc, prisma, fila };
  }

  /** Lo que quedó escrito en la fila, venga del `updateMany` condicional o del `update` de resto. */
  const escrito = (prisma: any) => ({
    ...(prisma.shipmentRequest.updateMany.mock.calls[0]?.[0]?.data ?? {}),
    ...(prisma.shipmentRequest.update.mock.calls[0]?.[0]?.data ?? {}),
  });

  it('persists shippingCostCents when provided and advances to guia', async () => {
    const { svc, prisma, fila } = buildService();
    await svc.setTracking('ship1', 'DHL', 'TRACK123', 9000);
    // La escritura de la etiqueta es la CONDICIONAL, y casó: la fila venía sin etiqueta.
    expect(prisma.shipmentRequest.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.shipmentRequest.updateMany.mock.calls[0][0].data).toEqual({
      carrier: 'DHL',
      trackingNumber: 'TRACK123',
      status: 'guia',
      // v1.74 (§R.4.b): la etiqueta CAMBIÓ (la fila venía sin ella) ⇒ el sello del aviso se
      // limpia **en la misma escritura**, que es lo que hace que corregir un número sí avise.
      trackingNoticeSentAt: null,
      shippingCostCents: 9000,
    });
    // ⛔ Y no se escribió DOS veces: con la condicional casando, el `update` de resto no corre.
    expect(prisma.shipmentRequest.update).not.toHaveBeenCalled();
    expect(fila).toMatchObject({ status: 'guia', shippingCostCents: 9000, trackingNoticeSentAt: null });
  });

  it('does not touch shippingCostCents when omitted (keeps column default)', async () => {
    const { svc, prisma } = buildService();
    await svc.setTracking('ship1', 'DHL', 'TRACK123');
    expect(escrito(prisma)).not.toHaveProperty('shippingCostCents');
  });

  it('is editable: re-invoking updates the persisted cost', async () => {
    const { svc, prisma, fila } = buildService();
    await svc.setTracking('ship1', 'DHL', 'TRACK123', 0);
    expect(fila.shippingCostCents).toBe(0);
    await svc.setTracking('ship1', 'DHL', 'TRACK123', 12000);
    expect(fila.shippingCostCents).toBe(12000);
  });

  /**
   * ⭐⭐ **LA MITAD QUE EL MOCK NO PODÍA VER, y por la que este fixture se reescribió.**
   * Re-capturar el MISMO par no tiene derecho a reiniciar el ciclo del aviso (§R.4.b): la
   * condicional **no casa**, el sello NO se toca, y el resto (costos, estado) se escribe igual por
   * el `update` de resto. Con `update: jest.fn()` esto era indistinguible del caso de arriba.
   */
  it('⭐ re-capturar el MISMO par NO limpia el sello, y el costo SÍ se actualiza', async () => {
    const { svc, prisma, fila } = buildService({
      status: 'guia',
      carrier: 'DHL',
      trackingNumber: 'TRACK123',
      trackingNoticeSentAt: new Date('2026-09-01T00:00:00Z'),
    });
    await svc.setTracking('ship1', 'DHL', 'TRACK123', 12000);
    expect(prisma.shipmentRequest.updateMany.mock.results).toHaveLength(1);
    await expect(prisma.shipmentRequest.updateMany.mock.results[0].value).resolves.toEqual({ count: 0 });
    // ⛔ Rojo si el sello se limpia: sería el segundo correo del mismo número de guía.
    expect(fila.trackingNoticeSentAt).toEqual(new Date('2026-09-01T00:00:00Z'));
    expect(fila.shippingCostCents).toBe(12000);
    // ⛔ Y el sello NO viaja en la escritura de resto: sólo puede limpiarlo la condicional, que es
    // la única que comprueba que la etiqueta de verdad cambió.
    expect(prisma.shipmentRequest.update.mock.calls[0][0].data).not.toHaveProperty(
      'trackingNoticeSentAt',
    );
  });

  /**
   * ⭐⭐ **Y la rama `{ carrier: null }` del `OR`, que NO es defensiva.** Prisma traduce
   * `{ not: v }` a `col <> v`, y en SQL `NULL <> 'DHL'` **no casa**. Sin esa rama, la PRIMERA
   * captura —la única que importa, porque es la que avisa— no limpiaría el sello y el correo no
   * saldría nunca. El evaluador del fake respeta esa semántica, así que esto lo vigila de verdad.
   */
  it('⭐ primera captura (columnas en `NULL`): la condicional SÍ casa y limpia el sello', async () => {
    const { svc, prisma, fila } = buildService();
    await svc.setTracking('ship1', 'DHL', 'TRACK123');
    await expect(prisma.shipmentRequest.updateMany.mock.results[0].value).resolves.toEqual({ count: 1 });
    expect(fila.trackingNoticeSentAt).toBeNull();
    const where = prisma.shipmentRequest.updateMany.mock.calls[0][0].where;
    expect(where.OR).toEqual(
      expect.arrayContaining([{ carrier: null }, { trackingNumber: null }]),
    );
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

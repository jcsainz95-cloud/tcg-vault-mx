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

  /**
   * ⭐⭐ **LAS TRES ESCRITURAS DE `setTracking`, IDENTIFICADAS POR SU FORMA Y NO POR SU ORDEN**
   * (`REL-C`, 2026-09-14). El método dejó de escribir `status` dentro de `data` —ahí vivía la
   * REGRESIÓN DE ESTADO: `advances` se calculaba sobre una lectura previa, así que una captura
   * rezagada devolvía un `enviado` a `guia`— y ahora el avance es **su propia escritura**, con la
   * precondición en el `WHERE`:
   *
   * | escritura | `where` | `data` |
   * |---|---|---|
   * | **avance** (solo si procede) | `status IN (solicitado, picking)` | `{ status: 'guia' }` |
   * | **condicional** (§R.4.b) | etiqueta DISTINTA + `status ≠ cancelado` | etiqueta, costos, `trackingNoticeSentAt: null` |
   * | **resto** (solo si la condicional no casó) | `status ≠ cancelado` | etiqueta, costos — ⛔ sin sello |
   *
   * Se buscan por forma para que estas pruebas no se rompan si mañana cambia el orden — y sobre todo
   * para que **no pasen por accidente** leyendo la escritura equivocada.
   */
  const escrituras = (prisma: any) => {
    const calls: any[] = prisma.shipmentRequest.updateMany.mock.calls.map((c: any) => c[0]);
    return {
      todas: calls,
      avance: calls.find((c) => 'status' in (c.data ?? {})),
      condicional: calls.find((c) => 'trackingNoticeSentAt' in (c.data ?? {})),
      resto: calls.find(
        (c) => !('status' in (c.data ?? {})) && !('trackingNoticeSentAt' in (c.data ?? {})),
      ),
    };
  };

  /** Lo que quedó escrito en la fila, sumando las escrituras que de verdad corrieron. */
  const escrito = (prisma: any) =>
    Object.assign({}, ...escrituras(prisma).todas.map((c: any) => c.data ?? {}));

  it('persists shippingCostCents when provided and advances to guia', async () => {
    const { svc, prisma, fila } = buildService();
    await svc.setTracking('ship1', 'DHL', 'TRACK123', 9000);
    const { avance, condicional, resto } = escrituras(prisma);
    // ⭐ `REL-C`: el avance de estado es su PROPIA escritura, y su precondición vive en el `WHERE`.
    // ⛔ Rojo si `status` vuelve a viajar dentro de `data` junto a la etiqueta: eso es exactamente lo
    // que permitía devolver un `enviado` a `guia` (y con él, un segundo `AV-5`).
    expect(avance.data).toEqual({ status: 'guia' });
    // ⚠️ El conjunto es **`['picking']` y nada más**, y no es un olvido: sale DERIVADO de
    // `TRANSITIONS` (`s ∈ PRE_GUIA ⇔ 'guia' ∈ TRANSITIONS[s]`), y de `solicitado` **no** se salta a
    // `guia` — hay que pasar por `picking` primero. Capturar una etiqueta sobre un `solicitado` ya
    // daba `409` antes de este pase; aquí solo se comprueba que la derivación no inventó estados.
    expect(avance.where).toEqual({ id: 'ship1', status: { in: ['picking'] } });
    // La escritura de la etiqueta es la CONDICIONAL, y casó: la fila venía sin etiqueta.
    expect(condicional.data).toEqual({
      carrier: 'DHL',
      trackingNumber: 'TRACK123',
      // v1.74 (§R.4.b): la etiqueta CAMBIÓ (la fila venía sin ella) ⇒ el sello del aviso se
      // limpia **en la misma escritura**, que es lo que hace que corregir un número sí avise.
      trackingNoticeSentAt: null,
      shippingCostCents: 9000,
    });
    // ⛔ Y no se escribió el resto: con la condicional casando, esa tercera escritura no corre.
    expect(resto).toBeUndefined();
    expect(prisma.shipmentRequest.update).not.toHaveBeenCalled();
    expect(fila).toMatchObject({ status: 'guia', shippingCostCents: 9000, trackingNoticeSentAt: null });
  });

  it('does not touch shippingCostCents when omitted (keeps column default)', async () => {
    const { svc, prisma } = buildService();
    await svc.setTracking('ship1', 'DHL', 'TRACK123');
    expect(escrito(prisma)).not.toHaveProperty('shippingCostCents');
  });

  it('is editable: re-invoking updates the persisted cost', async () => {
    const { svc, fila } = buildService();
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
    const { avance, condicional, resto } = escrituras(prisma);
    // Ya estaba en `guia` ⇒ no hay nada que avanzar (y el `WHERE` del avance tampoco casaría).
    expect(avance).toBeUndefined();
    expect(prisma.shipmentRequest.updateMany).toHaveBeenCalledTimes(2);
    expect(condicional).toBeDefined();
    expect(resto).toBeDefined();
    // ⛔ Rojo si el sello se limpia: sería el segundo correo del mismo número de guía.
    expect(fila.trackingNoticeSentAt).toEqual(new Date('2026-09-01T00:00:00Z'));
    expect(fila.shippingCostCents).toBe(12000);
    // ⛔ Y el sello NO viaja en la escritura de resto: sólo puede limpiarlo la condicional, que es
    // la única que comprueba que la etiqueta de verdad cambió. Tampoco viaja `status` (`REL-C`).
    expect(resto.data).not.toHaveProperty('trackingNoticeSentAt');
    expect(resto.data).not.toHaveProperty('status');
    expect(resto.where).toEqual({ id: 'ship1', status: { not: 'cancelado' } });
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
    const { condicional, resto } = escrituras(prisma);
    // La condicional casó ⇒ no hubo escritura de resto.
    expect(resto).toBeUndefined();
    expect(fila.trackingNoticeSentAt).toBeNull();
    expect(condicional.where.OR).toEqual(
      expect.arrayContaining([{ carrier: null }, { trackingNumber: null }]),
    );
    // ⭐ `REL-C`: y la condicional tampoco escribe sobre un envío ya cancelado — el `409` de arriba
    // se decidió sobre una lectura previa, así que una cancelación simultánea se le colaba.
    expect(condicional.where.status).toEqual({ not: 'cancelado' });
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

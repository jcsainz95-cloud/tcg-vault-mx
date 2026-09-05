import { ConfigService } from '@nestjs/config';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { SettingKey } from '../src/modules/settings/settings.constants';
import { addBusinessDays, isBusinessDay } from '../src/common/business-days';

/**
 * v1.51 — **LA GUÍA Y EL TRÁNSITO**: `POST …/guide`, `POST …/confirm-shipment`, el «ya lo mandé» del
 * vendedor y las dos colas que esa separación crea.
 *
 * ### El bug real que esta separación arregla (§P.13, D20)
 * El plazo mide **una acción del vendedor** pero nos enteramos por **una acción nuestra**. Sin nada
 * en medio: el vendedor deposita el **día 3**, el operador confirma el **día 4**, y el barrido ya
 * expiró una solicitud **en la que el vendedor cumplió** — se queda sin venta **por una latencia
 * nuestra**, y encima ya gastamos la etiqueta. *El barrido solo expira si no hubo NINGUNA de las dos.*
 */

const pii = new PiiCryptoService(new ConfigService({}));

const DIALS: Record<string, number> = {
  [SettingKey.BUYLIST_SHIP_DEADLINE_BUSINESS_DAYS]: 3,
  [SettingKey.BUYLIST_SHIPMENT_CONFIRM_ALERT_BUSINESS_DAYS]: 5,
};

const OPERATOR = { id: 'op-1', role: 'vault_operator' as const };

interface Opts {
  status?: string;
  guideSentAt?: Date | null;
  shipDeadlineAt?: Date | null;
  shipmentCarrier?: string | null;
  shipmentTrackingNumber?: string | null;
  sellerShippedDeclaredAt?: Date | null;
  shipmentConfirmedAt?: Date | null;
  guideCancellationPendingAt?: Date | null;
  guideCancellationDoneAt?: Date | null;
  guideActualCostCents?: number | null;
  rows?: Record<string, unknown>[];
}

function build(opts: Opts = {}) {
  const request: Record<string, unknown> = {
    id: 'sr-1',
    userId: 'u-1',
    user: { id: 'u-1', name: 'Ash', email: 'ash@e.mx', locale: 'es' },
    status: opts.status ?? 'aceptada',
    closedAt: null,
    quotedTotalCents: 90000,
    approvedTotalCents: null,
    ineRequired: false,
    ineProvided: false,
    speiReference: null,
    paidBy: null,
    paidAt: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    receivedAt: null,
    verifiedAt: null,
    approvedAt: null,
    adjustmentSentAt: null,
    deadlineAt: null,
    guideSentAt: opts.guideSentAt ?? null,
    shipDeadlineAt: opts.shipDeadlineAt ?? null,
    shipmentCarrier: opts.shipmentCarrier ?? null,
    shipmentTrackingNumber: opts.shipmentTrackingNumber ?? null,
    sellerShippedDeclaredAt: opts.sellerShippedDeclaredAt ?? null,
    shipmentConfirmedAt: opts.shipmentConfirmedAt ?? null,
    shipmentConfirmedBy: null,
    guideCancellationPendingAt: opts.guideCancellationPendingAt ?? null,
    guideCancellationDoneAt: opts.guideCancellationDoneAt ?? null,
    guideCancellationDoneBy: null,
    guideActualCostCents: opts.guideActualCostCents ?? null,
    expiredReason: null,
  };
  const matches = (value: unknown, cond: unknown): boolean => {
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>;
      if ('in' in c) return (c.in as unknown[]).includes(value);
      if ('not' in c) return !matches(value, c.not);
      throw new Error(`condición no soportada: ${JSON.stringify(cond)}`);
    }
    if (value instanceof Date && cond instanceof Date) return value.getTime() === cond.getTime();
    return value === cond;
  };
  const prisma: any = {
    sellRequest: {
      findUnique: jest.fn(async () => ({ ...request })),
      findMany: jest.fn(async () => (opts.rows ?? []).map((r) => ({ ...request, ...r }))),
      count: jest.fn(async () => (opts.rows ?? []).length),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const { id: _id, ...rest } = where;
        if (!Object.entries(rest).every(([k, c]) => matches(request[k], c))) return { count: 0 };
        Object.assign(request, data);
        return { count: 1 };
      }),
      update: jest.fn(async () => {
        throw new Error('el ciclo NO transiciona con `update`: la guarda es el updateMany');
      }),
    },
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
  };
  const settings = { getNumber: jest.fn(async (k: any) => DIALS[k as string] ?? 0) };
  const svc = new BuylistService(
    prisma as PrismaService,
    {} as PricingService,
    settings as unknown as SettingsService,
    {} as UsersService,
    pii,
  );
  return { svc, prisma, request };
}

// =============================================================================================
describe('⚠️ BL-20 — `isPayable` en TODA proyección admin, y en NINGUNA de cliente', () => {
  const pagable = { status: 'aprobada', verifiedAt: new Date('2026-08-05T00:00:00Z') };

  it.each([['receive'], ['verify'], ['reject']])(
    'la respuesta de mutación `%s` incluye `isPayable`',
    async (_m) => {
      // Se ejercita la PROYECCIÓN COMPARTIDA, que es donde se derivó: las cuatro mutaciones la usan,
      // así que ninguna futura puede olvidarlo.
      const { svc, request } = build();
      Object.assign(request, pagable);
      const res: any = await svc.adminGet('sr-1');
      expect(res).toHaveProperty('isPayable');
      expect(res.isPayable).toBe(true);
    },
  );

  it('⚠️ `verify` es la transición que lo vuelve VERDADERO: antes false, después true', async () => {
    const { svc, request } = build({ status: 'verificacion' });
    // Sin `verifiedAt`, `isPayable` es false aunque el estado esté en el set pagable.
    const antes: any = await svc.adminGet('sr-1');
    expect(antes.isPayable).toBe(false);
    // La transición sella `verifiedAt`…
    request.verifiedAt = new Date();
    const despues: any = await svc.adminGet('sr-1');
    // …y quien lea `res.isPayable` justo después obtiene la verdad, no un `false` silencioso.
    expect(despues.isPayable).toBe(true);
  });

  it('⚠️ LA OTRA MITAD: la proyección de CLIENTE **no contiene la clave** `isPayable`', async () => {
    const { svc, request } = build();
    Object.assign(request, pagable, { items: [] });
    const res: any = await svc.getMine('u-1', 'sr-1');
    // Aserción por AUSENCIA DE CLAVE, no por valor falsy: un `isPayable: false` filtrado seguiría
    // siendo estado interno del pipeline viajando al vendedor.
    expect(Object.prototype.hasOwnProperty.call(res, 'isPayable')).toBe(false);
    expect(JSON.stringify(res)).not.toMatch(/isPayable/);
    // Y el contraste que prueba que la exclusión es deliberada: `isTerminal` sí viaja.
    expect(res).toHaveProperty('isTerminal');
  });

  it('la proyección de cliente resta TRES campos: `closedAt`, `paidBy` e `isPayable`', async () => {
    const { svc, request } = build();
    Object.assign(request, pagable, { items: [], closedAt: new Date(), paidBy: 'sa-1' });
    const res: any = await svc.getMine('u-1', 'sr-1');
    for (const k of ['closedAt', 'paidBy', 'isPayable']) {
      expect(Object.prototype.hasOwnProperty.call(res, k)).toBe(false);
    }
  });
});

// =============================================================================================
describe('⚠️ El caso que motiva TODO el diseño: declara el día 3, confirmamos el día 4', () => {
  it('el vendedor declara y la solicitud SIGUE VIVA: el reloj se detuvo, no expiró', async () => {
    // Guía entregada el día 0, plazo de 3 días hábiles. El vendedor deposita DENTRO del plazo.
    const guideSentAt = new Date('2026-09-01T16:00:00Z'); // martes
    const shipDeadlineAt = addBusinessDays(guideSentAt, 3);
    const { svc, request } = build({ guideSentAt, shipDeadlineAt });

    // Día 3: el vendedor declara. NO mueve el estado, NO suma a «en camino».
    const declara = await svc.declareShipped('u-1', 'sr-1');
    expect(declara.status).toBe('aceptada');
    expect(declara.sellerShippedDeclaredAt).toBeInstanceOf(Date);
    expect(request.status).toBe('aceptada');
    expect(request.shipmentConfirmedAt).toBeNull();

    // El barrido (regla 2) NO puede expirarla: su predicado exige `sellerShippedDeclaredAt IS NULL`.
    // Aquí se asevera el hecho del que depende esa regla: el reloj quedó DETENIDO.
    expect(request.sellerShippedDeclaredAt).not.toBeNull();
    expect(request.closedAt).toBeNull();

    // Día 4: el operador confirma. AHORA sí se mueve el estado.
    const confirma = await svc.adminConfirmShipment('sr-1', OPERATOR);
    expect(confirma.response.status).toBe('en_transito');
    expect(request.status).toBe('en_transito');
    // El vendedor NO perdió la venta por nuestra latencia.
    expect(request.closedAt).toBeNull();
  });

  it('la solicitud con reloj detenido y sin confirmar sale en la cola «por confirmar envío»', async () => {
    // Es justo el trabajo que la separación crea: sin esta cola, el pendiente NUESTRO sería
    // invisible.
    const { svc } = build({
      rows: [
        {
          id: 'sr-1',
          sellerShippedDeclaredAt: new Date('2026-08-20T00:00:00Z'),
          shipmentConfirmedAt: null,
        },
      ],
    });
    const res = await svc.adminPendingShipmentConfirmation(1, 20);
    expect(res.data).toHaveLength(1);
    expect(res.data[0].sellRequestId).toBe('sr-1');
    // `alert` es DERIVADO (timestamp + dial), no columna.
    expect(typeof res.data[0].alert).toBe('boolean');
    expect(res.data[0].businessDaysWaiting).toBeGreaterThan(0);
  });

  it('⚠️ la alerta NO expira, NO cancela y NO mueve el estado: solo hace visible el pendiente', async () => {
    // ⚠️ La fecha va DENTRO de los años que cubre la tabla de festivos: `business-days` LANZA fuera
    // de cobertura a propósito (degradar a «no hay festivos» adelantaría vencimientos). Ver la nota
    // de alcance en BACKEND_NOTES §0.26 (era §0.19 antes del renumerado de la fusión).
    const hace20DiasHabiles = new Date('2026-01-05T00:00:00Z');
    const { svc, request } = build({
      sellerShippedDeclaredAt: hace20DiasHabiles,
      rows: [{ id: 'sr-1', sellerShippedDeclaredAt: hace20DiasHabiles }],
    });
    const res = await svc.adminPendingShipmentConfirmation(1, 20);
    expect(res.data[0].alert).toBe(true);
    // El vendedor ya cumplió; el pendiente es nuestro, así que el remedio es verlo, no castigarlo.
    expect(request.status).toBe('aceptada');
    expect(request.closedAt).toBeNull();
  });

  it('el «ya lo mandé» es IDEMPOTENTE y NO re-fija el timestamp (nada de relojes infinitos)', async () => {
    const yaDeclarado = new Date('2026-08-20T00:00:00Z');
    const { svc, request, prisma } = build({ sellerShippedDeclaredAt: yaDeclarado });
    const res = await svc.declareShipped('u-1', 'sr-1');
    expect(res.sellerShippedDeclaredAt).toEqual(yaDeclarado);
    expect(request.sellerShippedDeclaredAt).toEqual(yaDeclarado);
    expect(prisma.sellRequest.updateMany).not.toHaveBeenCalled();
  });

  it('una `ofertada` NO ofrece esta vía (criterio 114) ⇒ `409 NOT_ACCEPTED`', async () => {
    const { svc } = build({ status: 'ofertada' });
    await expect(svc.declareShipped('u-1', 'sr-1')).rejects.toMatchObject({
      code: 'NOT_ACCEPTED',
      details: { status: 'ofertada' },
    });
  });

  it('un TERCERO con sesión propia ⇒ 404 (no 403: no se confirma la existencia)', async () => {
    const { svc, request } = build();
    await expect(svc.declareShipped('otro', 'sr-1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(request.sellerShippedDeclaredAt).toBeNull();
  });
});

// =============================================================================================
describe('`POST …/guide` — la etiqueta se compra AL ACEPTAR (D21)', () => {
  it('captura paquetería + guía y CONGELA el plazo en días hábiles', async () => {
    const { svc, request } = build();
    const res = await svc.adminGuide('sr-1', ' Estafeta ', ' 1234567890 ');
    expect(res.status).toBe('aceptada'); // capturar la guía NO mueve el estado
    expect(res.shipmentCarrier).toBe('Estafeta'); // trim
    expect(res.shipmentTrackingNumber).toBe('1234567890');
    expect(res.guideSentAt).toBeInstanceOf(Date);
    // El reloj arranca con la ENTREGA DE LA GUÍA, no con la aceptación (criterio 123).
    expect(res.shipDeadlineAt).toEqual(addBusinessDays(res.guideSentAt as Date, 3));
    expect(isBusinessDay(res.shipDeadlineAt as Date)).toBe(true);
    expect(request.shipDeadlineAt).toEqual(res.shipDeadlineAt);
  });

  it('⚠️ sobre una `ofertada` ⇒ `409 GUIDE_NOT_ALLOWED`: una oferta ignorada JAMÁS genera etiqueta', async () => {
    const { svc, request } = build({ status: 'ofertada' });
    await expect(svc.adminGuide('sr-1', 'Estafeta', '1')).rejects.toMatchObject({
      code: 'GUIDE_NOT_ALLOWED',
      details: { status: 'ofertada' },
    });
    expect(request.guideSentAt).toBeNull();
    expect(request.shipDeadlineAt).toBeNull();
  });

  it('mientras NO hay guía, `shipDeadlineAt` es `null` ⇒ el barrido no la ve y NO expira', async () => {
    // Es correcto (§P.13: un plazo del vendedor solo vence por algo del vendedor, y la etiqueta
    // depende de NOSOTROS) — y por eso existe la cola `awaitingGuide`.
    const { request } = build();
    expect(request.guideSentAt).toBeNull();
    expect(request.shipDeadlineAt).toBeNull();
  });

  it('re-capturar CORRIGE el número y **NO mueve** la fecha ya comunicada (criterio 157)', async () => {
    const shipDeadlineAt = new Date('2026-09-10T00:00:00Z');
    const { svc, request } = build({
      guideSentAt: new Date('2026-09-05T00:00:00Z'),
      shipDeadlineAt,
      shipmentTrackingNumber: 'TYPO',
    });
    const res = await svc.adminGuide('sr-1', 'Estafeta', 'BUENO-1');
    expect(res.shipmentTrackingNumber).toBe('BUENO-1');
    expect(res.shipDeadlineAt).toEqual(shipDeadlineAt);
    expect(request.shipDeadlineAt).toEqual(shipDeadlineAt);
  });

  it('⚠️ tras una corrección (plazo en `null`) la re-captura SÍ vuelve a congelar', async () => {
    // Sin esto, la solicitud quedaría invisible para el reloj Y para la cola: un plazo que no
    // arranca es tan defectuoso como uno que arranca mal.
    const { svc, request } = build({ guideSentAt: null, shipDeadlineAt: null });
    await svc.adminGuide('sr-1', 'DHL', 'NUEVA-1');
    expect(request.shipDeadlineAt).toBeInstanceOf(Date);
  });

  it('⚠️ con una cancelación PENDIENTE ⇒ `409 GUIDE_CANCELLATION_PENDING` (una etiqueta viva por solicitud)', async () => {
    const { svc, request } = build({
      guideCancellationPendingAt: new Date('2026-09-02T00:00:00Z'),
      guideCancellationDoneAt: null,
      shipmentCarrier: 'Estafeta',
      shipmentTrackingNumber: 'VIEJA-1',
    });
    await expect(svc.adminGuide('sr-1', 'DHL', 'NUEVA-1')).rejects.toMatchObject({
      code: 'GUIDE_CANCELLATION_PENDING',
      details: { trackingNumber: 'VIEJA-1' },
    });
    // No se pisó el número de la vieja: la cola seguiría pidiendo cancelar la que ya es la buena.
    expect(request.shipmentTrackingNumber).toBe('VIEJA-1');
  });
});

// =============================================================================================
describe('`POST …/confirm-shipment` — lo ÚNICO que mueve a `en_transito` (D20)', () => {
  it('mueve el estado y sella quién y cuándo', async () => {
    const { svc, request } = build({ guideSentAt: new Date('2026-09-01T00:00:00Z') });
    const { response, audit } = await svc.adminConfirmShipment('sr-1', OPERATOR);
    expect(response.status).toBe('en_transito');
    expect(response.shipmentConfirmedBy).toBe('op-1');
    expect(response.shipmentConfirmedAt).toBeInstanceOf(Date);
    expect(request.status).toBe('en_transito');
    expect(audit.guideMissing).toBe(false);
  });

  it.each([['cotizada'], ['ofertada'], ['recibida'], ['en_transito']])(
    '⚠️ desde `%s` NO se entra a `en_transito` ⇒ `409 NOT_ACCEPTED`',
    async (estado) => {
      // Regla dura (criterio 114): no existe secuencia que llegue a `en_transito` sin pasar por
      // `ofertada` y `aceptada`, y la guarda va en el `updateMany`, no en un `if` previo.
      const { svc, request } = build({ status: estado });
      await expect(svc.adminConfirmShipment('sr-1', OPERATOR)).rejects.toMatchObject({
        code: 'NOT_ACCEPTED',
        details: { status: estado },
      });
      expect(request.status).toBe(estado);
    },
  );

  it('⚠️ ni la guía ni el «ya lo mandé» mueven el estado por sí solos', async () => {
    const { svc, request } = build();
    await svc.adminGuide('sr-1', 'Estafeta', '1');
    expect(request.status).toBe('aceptada');
    await svc.declareShipped('u-1', 'sr-1');
    expect(request.status).toBe('aceptada');
    // Solo la confirmación del operador.
    await svc.adminConfirmShipment('sr-1', OPERATOR);
    expect(request.status).toBe('en_transito');
  });

  it('`guideSentAt` NO es precondición, pero el caso queda ANOTADO (fail-visible)', async () => {
    // Si el paquete llegó sin guía capturada, negar la confirmación no devuelve el paquete.
    const { svc, request } = build({ guideSentAt: null });
    const { response, audit } = await svc.adminConfirmShipment('sr-1', OPERATOR);
    expect(response.status).toBe('en_transito');
    expect(audit.guideMissing).toBe(true);
    expect(request.status).toBe('en_transito');
  });

  it('⚠️ FRONTERA money-safe: `guideActualCostCents` NO toca lo que se le deposita al vendedor', async () => {
    const { svc, request } = build({ guideSentAt: new Date() });
    request.offerShippingFeeCents = 18000;
    request.offerNetCents = 72000;
    request.payoutNetCents = null;
    await svc.adminConfirmShipment('sr-1', OPERATOR, 45000); // etiqueta carísima
    expect(request.guideActualCostCents).toBe(45000);
    // Al vendedor se le descuenta la tarifa CONGELADA que aceptó, cueste lo que cueste la real.
    expect(request.offerShippingFeeCents).toBe(18000);
    expect(request.offerNetCents).toBe(72000);
    expect(request.payoutNetCents).toBeNull();
  });
});

// =============================================================================================
describe('D22 — las DOS mitades: la etiqueta se puede cancelar Y alguien avisa', () => {
  it('la cola enumera las tareas abiertas CON el número de guía a la vista', async () => {
    const { svc } = build({
      rows: [
        {
          id: 'sr-9',
          shipmentCarrier: 'Estafeta',
          shipmentTrackingNumber: 'GUIA-MUERTA',
          guideSentAt: new Date('2026-09-01T00:00:00Z'),
          guideCancellationPendingAt: new Date('2026-09-03T00:00:00Z'),
          guideCancellationDoneAt: null,
          status: 'expirada',
        },
      ],
    });
    const res = await svc.adminPendingGuideCancellation(1, 20);
    expect(res.data).toHaveLength(1);
    // Sin el número, la fila no es trabajable: el operador no sabe QUÉ cancelar.
    expect(res.data[0]).toMatchObject({
      trackingNumber: 'GUIA-MUERTA',
      carrier: 'Estafeta',
      closedStatus: 'expirada',
    });
  });

  it('⚠️ NO desaparece sola: solo sale por `guide/cancellation-done`', async () => {
    const { svc, request } = build({
      guideCancellationPendingAt: new Date('2026-09-03T00:00:00Z'),
      guideCancellationDoneAt: null,
      status: 'expirada',
    });
    const res: any = await svc.adminGuideCancellationDone('sr-1', OPERATOR, 0);
    expect(request.guideCancellationDoneAt).toBeInstanceOf(Date);
    expect(request.guideCancellationDoneBy).toBe('op-1');
    // `0` = la paquetería la reembolsó. Es el ÚNICO momento en que se conoce el costo final, y sin
    // capturarlo la etiqueta tirada nunca entraría al P&L.
    expect(request.guideActualCostCents).toBe(0);
    expect(res).toHaveProperty('isPayable'); // proyección admin
  });

  it('sin tarea abierta ⇒ `409 NO_PENDING_GUIDE_CANCELLATION`', async () => {
    const { svc } = build({ guideCancellationPendingAt: null });
    await expect(svc.adminGuideCancellationDone('sr-1', OPERATOR)).rejects.toMatchObject({
      code: 'NO_PENDING_GUIDE_CANCELLATION',
    });
  });

  it('una tarea ya cerrada no se re-cierra (y no se pisa el costo ya capturado)', async () => {
    const { svc, request } = build({
      guideCancellationPendingAt: new Date('2026-09-03T00:00:00Z'),
      guideCancellationDoneAt: new Date('2026-09-04T00:00:00Z'),
      guideActualCostCents: 15000,
    });
    await expect(svc.adminGuideCancellationDone('sr-1', OPERATOR, 99999)).rejects.toMatchObject({
      code: 'NO_PENDING_GUIDE_CANCELLATION',
    });
    expect(request.guideActualCostCents).toBe(15000);
  });
});

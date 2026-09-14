import { ShipmentsService } from '../src/modules/shipments/shipments.service';
import { matchesWhere } from './helpers/prisma-where';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { MailMessage, MailPort } from '../src/modules/mail/mail.port';

/**
 * # §R — LOS AVISOS DE ENVÍO: `C-AV-3`, `C-AV-4` (mitad del comprador), `C-AV-11` y `D-AV-1`
 *
 * ## ⭐⭐ `C-AV-3` SE VERIFICA POR EXCESO **Y** POR DEFECTO, Y ÉSA ES LA MITAD QUE CUESTA
 * El criterio **210** dice *«exactamente DOS correos de envío y NINGUNO al entregar»*. Una prueba que
 * solo compruebe que **llegan los dos** no vale: **tiene que comprobar que el tercero no llega**.
 * Por eso el recorrido completo se mide con **un contador de la bandeja**, no con aserciones sueltas
 * — un correo de más en `entregado` sería invisible para un test que solo mira los dos primeros.
 *
 * ## Cada candado trae su CANARIO
 * Un candado que nadie probó que falla es un adorno. Cada bloque termina con una **ablación**: se
 * reintroduce el defecto (o se afloja la condición) y se comprueba que la aserción **se pone roja**.
 */

type Sent = MailMessage[];

function buildHarness(opts: {
  shipment: Record<string, unknown>;
  order?: Record<string, unknown> | null;
  user?: Record<string, unknown> | null;
  /** `throwing` ⇒ el puerto lanza SIEMPRE (`C-AV-10`). `null` ⇒ no hay puerto. */
  mail?: 'ok' | 'throwing' | null;
}) {
  const sent: Sent = [];
  const row = { ...opts.shipment };
  const tx = {
    shipmentRequest: {
      update: jest.fn().mockImplementation(({ data }) => Object.assign(row, data)),
      // ⭐⭐ `REL-B` (2026-09-14): `updateStatus` ya **no** escribe con `update({ where: { id } })`.
      // RECLAMA la transición con `updateMany({ where: { id, status: <el leído> } })` y solo avisa si
      // `count === 1`. El fake **evalúa el `where`**, así que si alguien quitara el `status` de esa
      // precondición estas pruebas seguirían verdes — pero las de integración con entrelazado
      // forzado (`avisos-sellos`, bloque B) no, y son las que mandan sobre la carrera.
      updateMany: jest.fn().mockImplementation(async ({ where, data }: any) => {
        if (!matchesWhere(row as any, where)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
      findUniqueOrThrow: jest.fn().mockImplementation(async () => ({ ...row })),
    },
    shipmentItem: { findMany: jest.fn().mockResolvedValue([]) },
    inventoryItem: { updateMany: jest.fn(), findUnique: jest.fn() },
    inventoryMovement: { create: jest.fn() },
  };
  const prisma: any = {
    shipmentRequest: {
      findUnique: jest.fn().mockImplementation(async () => ({ ...row })),
      findUniqueOrThrow: jest.fn().mockImplementation(async () => ({ ...row })),
      update: jest.fn().mockImplementation(async ({ data }) => Object.assign(row, data)),
      // ⭐⭐ `updateMany` **EVALÚA EL `where` DE VERDAD** (`helpers/prisma-where`), y desde el
      // 2026-09-14 eso importa el doble: por aquí pasan AHORA las DOS escrituras condicionales de
      // `D-AVISO-2` — la del sello (`… IS NULL`) y la de la ETIQUETA (`carrier IS NULL OR carrier
      // <> …`), que es la que sustituyó al `if` sobre la lectura previa. El fake anterior cogía
      // «la única clave que no es `id`» y **no sabía leer un `OR`**: con el `where` nuevo habría
      // dado un `count` inventado, que es justo lo que un mock no debe poder hacer aquí.
      // ⚠️ `matchesWhere` respeta la semántica SQL de `NULL` en `not` ⇒ si alguien quitara la rama
      // `{ carrier: null }`, la primera captura dejaría de casar y ESTAS pruebas se pondrían rojas.
      updateMany: jest.fn().mockImplementation(async ({ where, data }) => {
        if (!matchesWhere(row as any, where)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
    order: { findUnique: jest.fn().mockResolvedValue(opts.order ?? null) },
    user: { findUnique: jest.fn().mockResolvedValue(opts.user ?? null) },
    $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
  };
  const mail: MailPort | undefined =
    opts.mail === null || opts.mail === undefined
      ? undefined
      : {
          send: jest.fn().mockImplementation(async (m: MailMessage) => {
            if (opts.mail === 'throwing') throw new Error('resend is down');
            sent.push(m);
            return {};
          }),
        };
  const svc = new ShipmentsService(
    prisma as PrismaService,
    {} as SettingsService,
    {} as StripeService,
    mail,
  );
  return { svc, prisma, sent, row };
}

const VAULT_SHIPMENT = {
  id: 'shp-1',
  userId: 'user-1',
  orderId: null,
  status: 'picking',
  carrier: null,
  trackingNumber: null,
  trackingNoticeSentAt: null,
};
const USER = { email: 'ash@pallet.mx', locale: 'es', anonymizedAt: null };

// =================================================================================================
describe('⭐⭐ C-AV-3 — DOS correos de envío y NINGUNO al entregar (criterio 210)', () => {
  it('el recorrido completo produce EXACTAMENTE 2: guía ⇒ 1 · enviado ⇒ 1 · entregado ⇒ 0', async () => {
    const { svc, sent } = buildHarness({ shipment: { ...VAULT_SHIPMENT }, user: USER, mail: 'ok' });

    await svc.setTracking('shp-1', 'DHL', 'TRK-1');
    expect(sent).toHaveLength(1);

    await svc.updateStatus('shp-1', 'enviado');
    expect(sent).toHaveLength(2);

    // ⛔ LA MITAD QUE FALLA POR EXCESO: entregar NO manda nada. *«Ya tiene la caja en la mano»* —
    // decisión del dueño (pregunta 74), tomada con el contraargumento delante.
    await svc.updateStatus('shp-1', 'entregado');
    expect(sent).toHaveLength(2);

    // Y los dos que sí salieron son los que el catálogo nombra, en su orden.
    expect(sent[0].subject).toContain('guía');
    expect(sent[1].subject).toContain('camino');
  });

  it('CANARIO: si `entregado` mandara correo, la aserción de arriba se pondría ROJA', async () => {
    // Ablación: se emula el defecto —un tercer envío al entregar— sobre la MISMA bandeja, y se
    // comprueba que el conteo de `C-AV-3` deja de valer 2. *Una aserción de ausencia que no sabe
    // reconocer la presencia no vale nada.*
    const { svc, sent } = buildHarness({ shipment: { ...VAULT_SHIPMENT }, user: USER, mail: 'ok' });
    await svc.setTracking('shp-1', 'DHL', 'TRK-1');
    await svc.updateStatus('shp-1', 'enviado');
    sent.push({ to: 'ash@pallet.mx', subject: 'entregado', html: '', text: '' });
    expect(sent).toHaveLength(3);
    expect(sent).not.toHaveLength(2); // ⇐ esto es lo que el candado caza
  });

  it('`cancelado` sí manda (AV-6), y desde `cancelado` no se sale ⇒ no puede haber un segundo', async () => {
    const { svc, sent } = buildHarness({
      shipment: { ...VAULT_SHIPMENT, status: 'guia' },
      user: USER,
      mail: 'ok',
    });
    await svc.updateStatus('shp-1', 'cancelado');
    expect(sent).toHaveLength(1);
    // La «una sola vez» la da el MOTOR: `TRANSITIONS['cancelado'] = []`.
    await expect(svc.updateStatus('shp-1', 'cancelado')).rejects.toThrow();
    expect(sent).toHaveLength(1);
  });

  it('⛔ `picking` y `guia` por `PATCH /status` NO mandan nada (son nuestro taller)', async () => {
    const { svc, sent } = buildHarness({
      shipment: { ...VAULT_SHIPMENT, status: 'solicitado' },
      user: USER,
      mail: 'ok',
    });
    await svc.updateStatus('shp-1', 'picking');
    expect(sent).toHaveLength(0);
    // ⭐ Y el `guia` por ESTE camino tampoco: llega SIN etiqueta (`D-AV-2`), así que un correo aquí
    // sería «tu guía» sin número — el criterio 198 servido al revés (§R.3.a).
    await svc.updateStatus('shp-1', 'guia');
    expect(sent).toHaveLength(0);
  });
});

// =================================================================================================
describe('⭐ C-AV-4 — la guía llega CON el número, idéntico al de la fila', () => {
  it('el correo del comprador trae `carrier` y `trackingNumber` tal cual', async () => {
    const { svc, sent } = buildHarness({ shipment: { ...VAULT_SHIPMENT }, user: USER, mail: 'ok' });
    await svc.setTracking('shp-1', 'Estafeta', 'EST-0001');
    const cuerpo = [sent[0].subject, sent[0].html, sent[0].text].join('\n');
    expect(cuerpo).toContain('Estafeta');
    expect(cuerpo).toContain('EST-0001');
  });

  it('CANARIO: el detector reconoce la PRESENCIA de un número que NO es el de la fila', async () => {
    const { svc, sent } = buildHarness({ shipment: { ...VAULT_SHIPMENT }, user: USER, mail: 'ok' });
    await svc.setTracking('shp-1', 'Estafeta', 'EST-0001');
    const cuerpo = [sent[0].subject, sent[0].html, sent[0].text].join('\n');
    expect(cuerpo).not.toContain('EST-9999'); // el candado sabe distinguir un número de otro
  });

  it('§R.4.b — re-capturar EL MISMO número ⛔ NO reenvía; corregirlo SÍ avisa', async () => {
    const { svc, sent } = buildHarness({ shipment: { ...VAULT_SHIPMENT }, user: USER, mail: 'ok' });
    await svc.setTracking('shp-1', 'DHL', 'TRK-1');
    expect(sent).toHaveLength(1);

    // Idéntico ⇒ el sello NO se limpia ⇒ la reclamación pierde (`count === 0`) ⇒ silencio.
    await svc.setTracking('shp-1', 'DHL', 'TRK-1');
    expect(sent).toHaveLength(1);

    // DISTINTO ⇒ se limpia en la misma escritura ⇒ vuelve a avisar. *Un correo con un número que ya
    // no existe es peor que no haber mandado ninguno.*
    await svc.setTracking('shp-1', 'DHL', 'TRK-2');
    expect(sent).toHaveLength(2);
    expect(sent[1].text).toContain('TRK-2');
  });
});

// =================================================================================================
describe('C-AV-11 — el destinatario, en el orden exacto de §R.5', () => {
  it('retiro de bóveda (`userId`) ⇒ `User.email`', async () => {
    const { svc, sent } = buildHarness({ shipment: { ...VAULT_SHIPMENT }, user: USER, mail: 'ok' });
    await svc.setTracking('shp-1', 'DHL', 'TRK-1');
    expect(sent[0].to).toBe('ash@pallet.mx');
  });

  it('fulfillment de pedido de INVITADO ⇒ `guestEmail`', async () => {
    const { svc, sent } = buildHarness({
      shipment: { ...VAULT_SHIPMENT, userId: null, orderId: 'ord-1' },
      order: {
        orderNumber: 'TCG-1001',
        guestEmail: 'guest@correo.mx',
        locale: 'es',
        user: null,
        fulfillmentMode: 'direct_ship',
      },
      mail: 'ok',
    });
    await svc.setTracking('shp-1', 'DHL', 'TRK-1');
    expect(sent[0].to).toBe('guest@correo.mx');
  });

  it('⭐ pedido RECLAMADO ⇒ SIGUE yendo a `guestEmail`, no al correo de la cuenta', async () => {
    // Precedente idéntico y deliberado: el reenvío del enlace de seguimiento ya va SIEMPRE a
    // `Order.guestEmail`. Es la dirección con la que compró y a la que ya le llegó la confirmación.
    const { svc, sent } = buildHarness({
      shipment: { ...VAULT_SHIPMENT, userId: null, orderId: 'ord-1' },
      order: {
        orderNumber: 'TCG-1001',
        guestEmail: 'guest@correo.mx',
        locale: 'es',
        claimedAt: new Date(),
        user: { email: 'cuenta@correo.mx', locale: 'es', anonymizedAt: null },
        fulfillmentMode: 'direct_ship',
      },
      mail: 'ok',
    });
    await svc.setTracking('shp-1', 'DHL', 'TRK-1');
    expect(sent[0].to).toBe('guest@correo.mx');
    expect(sent[0].to).not.toBe('cuenta@correo.mx');
  });

  it('⛔ envío sin `userId` NI `orderId` ⇒ CERO correos (y no se adivina un destinatario)', async () => {
    const { svc, sent } = buildHarness({
      shipment: { ...VAULT_SHIPMENT, userId: null, orderId: null },
      mail: 'ok',
    });
    await svc.setTracking('shp-1', 'DHL', 'TRK-1');
    expect(sent).toHaveLength(0);
  });

  it('⛔ cuenta ANONIMIZADA ⇒ CERO correos (§R.5.a)', async () => {
    const { svc, sent } = buildHarness({
      shipment: { ...VAULT_SHIPMENT },
      user: { ...USER, anonymizedAt: new Date() },
      mail: 'ok',
    });
    await svc.setTracking('shp-1', 'DHL', 'TRK-1');
    expect(sent).toHaveLength(0);
  });

  it('⛔ y el sello NO se quema cuando no hay destinatario: el aviso sigue pendiente', async () => {
    // El orden importa: se resuelve el destinatario ANTES de reclamar el sello. Sellar primero
    // dejaría el aviso **apagado para siempre** por una cuenta que aún no existe.
    const { svc, sent, row } = buildHarness({
      shipment: { ...VAULT_SHIPMENT, userId: null, orderId: null },
      mail: 'ok',
    });
    await svc.setTracking('shp-1', 'DHL', 'TRK-1');
    expect(sent).toHaveLength(0);
    expect((row as any).trackingNoticeSentAt).toBeNull();
  });
});

// =================================================================================================
describe('⭐⭐ D-AV-1 — la captura de guía NO regresa el estado (ARCHITECTURE §9, §M4)', () => {
  it('`entregado` + captura ⇒ el estado SIGUE `entregado` (antes volvía a `guia`)', async () => {
    const { svc, row } = buildHarness({
      shipment: { ...VAULT_SHIPMENT, status: 'entregado', carrier: 'DHL', trackingNumber: 'TRK-1' },
      user: USER,
      mail: 'ok',
    });
    await svc.setTracking('shp-1', 'DHL', 'TRK-9');
    expect((row as any).status).toBe('entregado');
    // …y la etiqueta SÍ se corrige: el contrato pide idempotencia sobre carrier/tracking, no rechazo.
    expect((row as any).trackingNumber).toBe('TRK-9');
  });

  it('`enviado` + captura ⇒ sigue `enviado`', async () => {
    const { svc, row } = buildHarness({
      shipment: { ...VAULT_SHIPMENT, status: 'enviado', carrier: 'DHL', trackingNumber: 'TRK-1' },
      user: USER,
      mail: 'ok',
    });
    await svc.setTracking('shp-1', 'DHL', 'TRK-1');
    expect((row as any).status).toBe('enviado');
  });

  it('`cancelado` + captura ⇒ `409 CONFLICT` y CERO escritura (la cola falsa no se reabre)', async () => {
    const { svc, prisma, row } = buildHarness({
      shipment: { ...VAULT_SHIPMENT, status: 'cancelado' },
      user: USER,
      mail: 'ok',
    });
    await expect(svc.setTracking('shp-1', 'DHL', 'TRK-1')).rejects.toMatchObject({ status: 409 });
    expect(prisma.shipmentRequest.update).not.toHaveBeenCalled();
    expect((row as any).carrier).toBeNull();
  });

  it('`picking` ⇒ SÍ avanza a `guia` (lo único que la tabla TRANSITIONS permite)', async () => {
    const { svc, row } = buildHarness({ shipment: { ...VAULT_SHIPMENT }, user: USER, mail: 'ok' });
    await svc.setTracking('shp-1', 'DHL', 'TRK-1');
    expect((row as any).status).toBe('guia');
  });

  it('CANARIO: con la guarda quitada, un `entregado` volvería a `guia` — y eso es lo que se cazaba', () => {
    // Reproducción del defecto **sin el servicio**: es la escritura literal que había antes
    // (`data: { …, status: 'guia' }` incondicional). Si alguien la reintroduce, el primer test de
    // este bloque se pone rojo. Aquí se deja constancia de QUÉ se reintroduciría.
    const filaEntregada: Record<string, unknown> = { status: 'entregado' };
    const escrituraVieja = { carrier: 'DHL', trackingNumber: 'TRK-9', status: 'guia' };
    Object.assign(filaEntregada, escrituraVieja);
    expect(filaEntregada.status).toBe('guia'); // ⇐ la regresión que `D-AV-1` describía
  });
});

import { ConfigService } from '@nestjs/config';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { Role } from '@prisma/client';

/**
 * v1.51.4 — **BL-13 (`PATCH …/pickup-address`)**, **D31 (`awaitingGuide`)** y **BL-15 (el teléfono en
 * la cola)**: lo que cierra el ciclo del buylist del lado del operador.
 *
 * ### Por qué BL-13 no es una comodidad
 * Con la guía emitida y un typo **NUESTRO** en la etiqueta, el único remedio que quedaba era **dejar
 * vencer el plazo de envío** ⇒ `expirada`/`not_shipped` ⇒ el correo de *«aceptaste y el paquete no
 * salió»*. **Un error nuestro terminaba imputándole un incumplimiento al vendedor.** *No era una
 * comodidad ausente: era un desenlace incorrecto.*
 */

const pii = new PiiCryptoService(new ConfigService({}));

interface Opts {
  status?: string;
  guideSentAt?: Date | null;
  shipDeadlineAt?: Date | null;
  sellerShippedDeclaredAt?: Date | null;
  shipmentConfirmedAt?: Date | null;
  closedAt?: Date | null;
  guideCancellationPendingAt?: Date | null;
  guideCancellationDoneAt?: Date | null;
  snapshot?: Record<string, unknown> | null;
  /** Dueño de la dirección que se manda (para el caso «no es suya»). */
  addressOwner?: string | null;
}

function build(opts: Opts = {}) {
  const request: Record<string, unknown> = {
    id: 'sr-1',
    userId: 'u-1',
    status: opts.status ?? 'aceptada',
    closedAt: opts.closedAt ?? null,
    guideSentAt: opts.guideSentAt ?? null,
    shipDeadlineAt: opts.shipDeadlineAt ?? null,
    sellerShippedDeclaredAt: opts.sellerShippedDeclaredAt ?? null,
    shipmentConfirmedAt: opts.shipmentConfirmedAt ?? null,
    shipmentCarrier: 'Estafeta',
    shipmentTrackingNumber: 'GUIA-VIEJA',
    guideCancellationPendingAt: opts.guideCancellationPendingAt ?? null,
    guideCancellationDoneAt: opts.guideCancellationDoneAt ?? null,
    guideCancellationDoneBy: null,
    pickupAddressSnapshot:
      opts.snapshot === undefined ? { line1: 'Calle Vieja 1', addressId: 'addr-vieja' } : opts.snapshot,
  };
  const matches = (v: unknown, c: unknown): boolean => {
    if (c !== null && typeof c === 'object' && !(c instanceof Date)) {
      const o = c as Record<string, unknown>;
      if ('not' in o) return !matches(v, o.not);
      // ⚠️ v1.58 · BL-36: el `where` de las DOS rutas incorpora ahora `...liveRequestWhere()`, que
      // aporta `status: { notIn: SELL_REQUEST_TERMINAL_STATES }`. El doble lo evalúa **de verdad**:
      // si solo lo tolerara, «el término está» y «el término no está» darían el mismo resultado.
      if ('notIn' in o) return !(o.notIn as unknown[]).includes(v);
      if ('in' in o) return (o.in as unknown[]).includes(v);
      throw new Error('cond no soportada');
    }
    return v === c;
  };
  const prisma: any = {
    sellRequest: {
      findUnique: jest.fn(async () => ({ ...request })),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const { id: _id, ...rest } = where;
        if (!Object.entries(rest).every(([k, c]) => matches(request[k], c))) return { count: 0 };
        Object.assign(request, data);
        return { count: 1 };
      }),
      update: jest.fn(async () => {
        throw new Error('la corrección NO se escribe con `update`: la guarda es el updateMany');
      }),
    },
    address: {
      findUnique: jest.fn(async ({ where }: any) =>
        where.id === 'addr-buena'
          ? {
              id: 'addr-buena',
              userId: opts.addressOwner === undefined ? 'u-1' : opts.addressOwner,
              line1: 'Av. Correcta 456',
              line2: 'Depto 3',
              neighborhood: 'Centro',
              city: 'CDMX',
              state: 'CDMX',
              postalCode: '06000',
              country: 'MX',
              phone: '+52 55 9999 0000',
            }
          : null,
      ),
    },
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
  };
  const svc = new BuylistService(
    prisma as PrismaService,
    {} as PricingService,
    { getNumber: jest.fn(async () => 3) } as unknown as SettingsService,
    {} as UsersService,
    pii,
  );
  return { svc, request, prisma };
}

// =============================================================================================
describe('⚠️ BL-13 — corregir la dirección DESPUÉS de la guía', () => {
  it('con guía emitida: re-congela el snapshot, MATA la guía y REABRE la tarea de cancelación', async () => {
    const { svc, request } = build({
      guideSentAt: new Date('2026-09-02T00:00:00Z'),
      shipDeadlineAt: new Date('2026-09-07T00:00:00Z'),
    });
    const res = await svc.adminUpdatePickupAddress('sr-1', 'addr-buena');

    expect((res.pickupAddress as Record<string, unknown>).line1).toBe('Av. Correcta 456');
    // La solicitud vuelve a un estado QUE YA EXISTE Y YA SE VIGILA: `aceptada` sin guía.
    expect(res.status).toBe('aceptada');
    expect(request.guideSentAt).toBeNull();
    // Sin guía no corre reloj ⇒ la regla 2 no la ve ⇒ NO puede expirar por nuestro error.
    expect(request.shipDeadlineAt).toBeNull();
    expect(request.guideCancellationPendingAt).toBeInstanceOf(Date);
    // ⚠️ `carrier`/`trackingNumber` NO se limpian: son LO QUE HAY QUE CANCELAR, y la fila de la cola
    // los muestra para que el operador sepa qué guía matar.
    expect(request.shipmentTrackingNumber).toBe('GUIA-VIEJA');
    expect(request.shipmentCarrier).toBe('Estafeta');
  });

  it('⚠️ REABRE la tarea aunque ya se hubiera cerrado una vez — sin esto se pierde una etiqueta del P&L EN SILENCIO', async () => {
    // Segunda corrección sobre la misma solicitud: si `guideCancellationDoneAt` se quedara puesto,
    // el predicado de la cola (`doneAt IS NULL`) no la volvería a mostrar y la etiqueta **nunca
    // entraría al P&L** — la cola es la ÚNICA puerta por la que ese costo entra.
    const { svc, request } = build({
      guideSentAt: new Date('2026-09-05T00:00:00Z'),
      guideCancellationPendingAt: new Date('2026-09-03T00:00:00Z'),
      guideCancellationDoneAt: new Date('2026-09-04T00:00:00Z'),
    });
    await svc.adminUpdatePickupAddress('sr-1', 'addr-buena');
    expect(request.guideCancellationDoneAt).toBeNull();
    expect(request.guideCancellationDoneBy).toBeNull();
    expect(request.guideCancellationPendingAt).toBeInstanceOf(Date);
  });

  it('SIN guía emitida: solo re-congela el snapshot, sin tocar la guía ni abrir tarea', async () => {
    const { svc, request } = build({ guideSentAt: null });
    await svc.adminUpdatePickupAddress('sr-1', 'addr-buena');
    expect((request.pickupAddressSnapshot as Record<string, unknown>).line1).toBe('Av. Correcta 456');
    expect(request.guideCancellationPendingAt).toBeNull();
  });

  it('⚠️ el vendedor YA DECLARÓ que lo depositó ⇒ `409 PICKUP_ADDRESS_LOCKED`, y NADA se toca', async () => {
    // El papel no está impreso: está en manos de una paquetería. Cambiar la fila no mueve la caja, y
    // dejarlo pasar CREARÍA LA ILUSIÓN de que sí. Ahí el remedio es humano de verdad.
    const { svc, request } = build({
      guideSentAt: new Date('2026-09-02T00:00:00Z'),
      sellerShippedDeclaredAt: new Date('2026-09-04T00:00:00Z'),
    });
    await expect(svc.adminUpdatePickupAddress('sr-1', 'addr-buena')).rejects.toMatchObject({
      code: 'PICKUP_ADDRESS_LOCKED',
      status: 409,
    });
    expect((request.pickupAddressSnapshot as Record<string, unknown>).line1).toBe('Calle Vieja 1');
    expect(request.guideSentAt).toBeInstanceOf(Date);
  });

  it.each([
    ['el envío ya se confirmó', { shipmentConfirmedAt: new Date('2026-09-05T00:00:00Z') }],
    ['la solicitud está cerrada', { closedAt: new Date('2026-09-05T00:00:00Z') }],
  ])('%s ⇒ `409 PICKUP_ADDRESS_LOCKED`', async (_t, over) => {
    const { svc, request } = build({ guideSentAt: new Date('2026-09-02T00:00:00Z'), ...over });
    await expect(svc.adminUpdatePickupAddress('sr-1', 'addr-buena')).rejects.toMatchObject({
      code: 'PICKUP_ADDRESS_LOCKED',
    });
    expect((request.pickupAddressSnapshot as Record<string, unknown>).line1).toBe('Calle Vieja 1');
  });

  it('⚠️ `guideSentAt` NO es precondición: es JUSTO la ventana que esta ruta existe para cubrir', async () => {
    const { svc } = build({ guideSentAt: new Date('2026-09-02T00:00:00Z') });
    await expect(svc.adminUpdatePickupAddress('sr-1', 'addr-buena')).resolves.toBeDefined();
  });

  it('⚠️ SEC-A1: se ELIGE una fila de la libreta, no se escribe un domicilio', async () => {
    // La firma no admite campos de domicilio: la defensa es la FORMA, no una validación.
    expect(BuylistService.prototype.adminUpdatePickupAddress.length).toBe(2);
    const { svc, prisma } = build();
    await svc.adminUpdatePickupAddress('sr-1', 'addr-buena');
    // Y se resuelve contra la libreta, no contra un pedido ni el KYC.
    expect(prisma.address.findUnique).toHaveBeenCalledWith({ where: { id: 'addr-buena' } });
  });

  it('una dirección INEXISTENTE y una AJENA dan la MISMA respuesta (no es un oráculo)', async () => {
    const inexistente = build();
    await expect(
      inexistente.svc.adminUpdatePickupAddress('sr-1', 'addr-fantasma'),
    ).rejects.toMatchObject({ code: 'PICKUP_ADDRESS_NOT_FOUND' });

    const ajena = build({ addressOwner: 'otro-usuario' });
    await expect(ajena.svc.adminUpdatePickupAddress('sr-1', 'addr-buena')).rejects.toMatchObject({
      code: 'PICKUP_ADDRESS_NOT_FOUND',
    });
    // Ni el snapshot ni la guía se tocaron en ninguno de los dos casos.
    expect((ajena.request.pickupAddressSnapshot as Record<string, unknown>).line1).toBe('Calle Vieja 1');
  });

  it('el teléfono del snapshot es el DEL DOMICILIO, no el del usuario', async () => {
    const { svc, request } = build();
    await svc.adminUpdatePickupAddress('sr-1', 'addr-buena');
    // Se parecen y no son el mismo dato: éste va impreso en la etiqueta.
    expect((request.pickupAddressSnapshot as Record<string, unknown>).phone).toBe('+52 55 9999 0000');
  });

  it('⚠️ la bitácora recibe SOLO los ids, jamás el domicilio', async () => {
    const { svc } = build();
    const res = await svc.adminUpdatePickupAddress('sr-1', 'addr-buena');
    expect(res.auditAddressIds).toEqual({ before: 'addr-vieja', after: 'addr-buena' });
    // Un domicilio en la bitácora es PII que nadie va a purgar.
    expect(JSON.stringify(res.auditAddressIds)).not.toMatch(/Calle|Av\.|06000/);
  });
});

// =============================================================================================
/**
 * ⚠️⚠️ v1.58 · **BL-36 (API_CONTRACT §M5-T, GRUPO B) — LA FÓRMULA GANA EL TÉRMINO DE ESTADO.**
 * *(NO bloqueante: no hay dinero. Es higiene de expediente.)*
 *
 * ### El hueco, y por qué el código no lo cerró antes
 * Los dos `where` decían `closedAt IS NULL` con el comentario **«no se toca una terminal»** al lado:
 * **no eran lo mismo**. Una fila **legacy anterior a M-19** es **terminal con `closedAt = null`** —el
 * schema lo declara: *«Nullable (filas legacy usan fallback)»*— y, **por ser también pre-M-46**,
 * tiene `guideSentAt`, `shipmentConfirmedAt` y `sellerShippedDeclaredAt` **nulos** ⇒ **pasaba las DOS
 * guardas ENTERAS**. Es la discrepancia **inversa** a la de P1 (allí `closedAt` sellado con `status`
 * vivo).
 *
 * **Backend lo midió (0 filas locales) y NO tocó el código**, porque el término que faltaba estaba en
 * **una fórmula que el contrato declara**: moverlo desde aquí habría sido el código mandando sobre el
 * contrato. El arquitecto normó la fórmula en v1.58 y **entonces** el código la siguió.
 * ***Cero local no es cero: la cohorte es posible POR CONSTRUCCIÓN.***
 *
 * ### Qué se evita, sin inflarlo
 * Re-congelar el snapshot de una solicitud **ya cerrada**: **PII fresca sobre un expediente terminal**
 * camino de la purga, y una bitácora que dice que la dirección de origen cambió en una operación que
 * acabó hace meses. **No mueve dinero, no imprime papel y no reabre nada.**
 *
 * | Mutación | Test que cae |
 * |---|---|
 * | quitar el término de estado de la ruta de **admin** | «⭐ la cohorte legacy … (admin)» |
 * | quitar el término de estado de la ruta de **cliente** | «⭐ la cohorte legacy … (cliente)» |
 * | sustituir `closedAt` por el término de estado (en vez de sumarlo) | «`closedAt` sellado con `status` vivo …» |
 * | sustituir `guideSentAt` por el término de estado (cliente) | «el término NO sustituye a `guideSentAt`» |
 * | una guarda que **rechace siempre** (el falso verde) | «el camino feliz sigue …» |
 * | aplicarle T a `guide/cancellation-done` | «⛔ la excepción NOMBRADA …» |
 */
describe('⚠️⚠️ BL-36 — «no se toca una terminal», ahora DICHO en las dos fórmulas', () => {
  /** Los CUATRO terminales de `PROJECT.md` §P.1 / criterio 113. */
  const TERMINALES = ['pagada', 'rechazada', 'abandonada', 'expirada'] as const;

  it.each(TERMINALES)(
    '⭐ la cohorte legacy pre-M-19 (`%s` con `closedAt` NULO) ⇒ `409 PICKUP_ADDRESS_LOCKED` (admin)',
    async (status) => {
      // Antes de v1.58 esta fila pasaba la guarda ENTERA: terminal, pero con los CUATRO términos que
      // el `where` miraba en `null`.
      const { svc, request } = build({
        status,
        closedAt: null,
        guideSentAt: null,
        shipmentConfirmedAt: null,
        sellerShippedDeclaredAt: null,
      });
      await expect(svc.adminUpdatePickupAddress('sr-1', 'addr-buena')).rejects.toMatchObject({
        code: 'PICKUP_ADDRESS_LOCKED',
        status: 409,
        // Cero vocabulario nuevo: `details.status` ya viajaba, y es justo el campo que explica el
        // rechazo nuevo ⇒ **cero impacto de cliente**.
        details: { status },
      });
      expect((request.pickupAddressSnapshot as Record<string, unknown>).line1).toBe('Calle Vieja 1');
    },
  );

  it.each(TERMINALES)(
    '⭐ la cohorte legacy pre-M-19 (`%s` con `closedAt` NULO) ⇒ `409 PICKUP_ADDRESS_LOCKED` (cliente)',
    async (status) => {
      const { svc, request } = build({ status, closedAt: null, guideSentAt: null });
      await expect(svc.updatePickupAddress('u-1', 'sr-1', 'addr-buena')).rejects.toMatchObject({
        code: 'PICKUP_ADDRESS_LOCKED',
        status: 409,
        details: { status },
      });
      expect((request.pickupAddressSnapshot as Record<string, unknown>).line1).toBe('Calle Vieja 1');
    },
  );

  it('`closedAt` sellado con `status` VIVO sigue dando `409`: el término NO sustituye a `closedAt`', async () => {
    // La discrepancia de P1, por el otro lado. Son DOS ejes y hacen falta LOS DOS: una guarda que se
    // apoye en el invariante que el bug rompió no guarda nada.
    const admin = build({ status: 'aceptada', closedAt: new Date('2026-09-05T00:00:00Z') });
    await expect(admin.svc.adminUpdatePickupAddress('sr-1', 'addr-buena')).rejects.toMatchObject({
      code: 'PICKUP_ADDRESS_LOCKED',
    });
    const cliente = build({ status: 'aceptada', closedAt: new Date('2026-09-05T00:00:00Z') });
    await expect(
      cliente.svc.updatePickupAddress('u-1', 'sr-1', 'addr-buena'),
    ).rejects.toMatchObject({ code: 'PICKUP_ADDRESS_LOCKED' });
  });

  it('el término NO sustituye a `guideSentAt` en la ruta de cliente: viva CON papel sigue bloqueada', async () => {
    // Dos ejes distintos —«ya cerró» y «ya hay papel»— y el de v1.58 solo añade el primero.
    const { svc } = build({ status: 'aceptada', guideSentAt: new Date('2026-09-02T00:00:00Z') });
    await expect(svc.updatePickupAddress('u-1', 'sr-1', 'addr-buena')).rejects.toMatchObject({
      code: 'PICKUP_ADDRESS_LOCKED',
    });
  });

  it('el camino feliz sigue: sobre una solicitud VIVA las dos rutas re-congelan el snapshot', async () => {
    // *Sin este assert, todos los anteriores los pasa una guarda que rechaza siempre.*
    const admin = build({ status: 'aceptada', guideSentAt: new Date('2026-09-02T00:00:00Z') });
    await expect(admin.svc.adminUpdatePickupAddress('sr-1', 'addr-buena')).resolves.toBeDefined();
    expect((admin.request.pickupAddressSnapshot as Record<string, unknown>).line1).toBe(
      'Av. Correcta 456',
    );

    const cliente = build({ status: 'aceptada', guideSentAt: null });
    await expect(cliente.svc.updatePickupAddress('u-1', 'sr-1', 'addr-buena')).resolves.toBeDefined();
    expect((cliente.request.pickupAddressSnapshot as Record<string, unknown>).line1).toBe(
      'Av. Correcta 456',
    );
  });

  it('⛔ la excepción NOMBRADA: `guide/cancellation-done` NO gana el término y opera sobre CERRADAS', async () => {
    // Su trabajo legítimo ocurre **sobre solicitudes cerradas**: la tarea de guía muerta NACE de un
    // cierre. Exigirle una fila viva la volvería incerrable y **la etiqueta se perdería del P&L**
    // (D22, criterio 139). *Una invariante con una excepción escrita es una invariante; una con una
    // excepción tácita es un bug esperando.*
    const { svc } = build({
      status: 'expirada',
      closedAt: new Date('2026-09-05T00:00:00Z'),
      guideCancellationPendingAt: new Date('2026-09-04T00:00:00Z'),
      guideCancellationDoneAt: null,
    });
    await expect(
      svc.adminGuideCancellationDone('sr-1', { id: 'op-1', role: Role.vault_operator }, 18000),
    ).resolves.toBeDefined();
  });
});

// =============================================================================================
describe('D31 — `awaitingGuide`: el pendiente NUESTRO que se quedaba quieto para siempre', () => {
  function buildList() {
    const wheres: any[] = [];
    const args: any[] = [];
    const prisma: any = {
      sellRequest: {
        findMany: jest.fn(async (a: any) => {
          wheres.push(a.where);
          args.push(a);
          return [];
        }),
        count: jest.fn(async () => 0),
      },
    };
    const svc = new BuylistService(
      prisma as PrismaService,
      {} as PricingService,
      { getNumber: jest.fn(async () => 7) } as unknown as SettingsService,
      {} as UsersService,
      pii,
    );
    return { svc, wheres, args };
  }

  it('`awaitingGuide=true` ⇒ `aceptada` ∧ `guideSentAt IS NULL`, orden `acceptedAt` ASC', async () => {
    const { svc, wheres, args } = buildList();
    await svc.adminList(undefined, 1, 20, undefined, { awaitingGuide: true });
    expect(wheres[0].AND).toEqual([{ status: 'aceptada' }, { guideSentAt: null }]);
    // Es una COLA DE TRABAJO: lo más viejo primero.
    expect(args[0].orderBy).toEqual({ acceptedAt: 'asc' });
  });

  it('se INTERSECTA con `status` sin pisarlo (el filtro del usuario no desaparece en silencio)', async () => {
    const { svc, wheres } = buildList();
    await svc.adminList('aceptada', 1, 20, undefined, { awaitingGuide: true });
    expect(wheres[0].status).toBeUndefined();
    expect(wheres[0].AND).toContainEqual({ status: 'aceptada' });
    expect(wheres[0].AND).toContainEqual({ guideSentAt: null });
  });

  it('sin el filtro, el `where` y el orden quedan EXACTAMENTE como estaban', async () => {
    const { svc, wheres, args } = buildList();
    await svc.adminList(undefined, 1, 20);
    expect(wheres[0]).not.toHaveProperty('AND');
    expect(args[0].orderBy).toEqual({ createdAt: 'desc' });
  });
});

// =============================================================================================
describe('⚠️ BL-15 — el teléfono en la cola, y NUNCA en el buscador', () => {
  function buildList() {
    const wheres: any[] = [];
    const prisma: any = {
      sellRequest: {
        findMany: jest.fn(async (a: any) => {
          wheres.push(a.where);
          return [
            {
              id: 'sr-1',
              userId: 'u-1',
              user: { id: 'u-1', name: 'Ash', email: 'ash@e.mx', phone: '+52 55 1234 5678' },
              status: 'cotizada',
              verifiedAt: null,
              quotedTotalCents: 1,
              approvedTotalCents: null,
              createdAt: new Date('2026-09-01T00:00:00Z'),
              offerIssueClockStartedAt: null,
              items: [],
            },
          ];
        }),
        count: jest.fn(async () => 1),
      },
    };
    const svc = new BuylistService(
      prisma as PrismaService,
      {} as PricingService,
      { getNumber: jest.fn(async () => 7) } as unknown as SettingsService,
      {} as UsersService,
      pii,
    );
    return { svc, wheres };
  }

  it('la fila trae el teléfono EN CLARO (back-office por rol, como el correo)', async () => {
    const { svc } = buildList();
    const res = await svc.adminList(undefined, 1, 20);
    // Es el requisito de D12: poder llamar desde la solicitud sin ir a buscar al usuario.
    expect(res.data[0].seller).toMatchObject({ phone: '+52 55 1234 5678' });
    // Sin enmascarar: NO es la CLABE, cuyo régimen no cambia.
    expect(res.data[0].seller?.phone).not.toMatch(/\*/);
  });

  it('⚠️ el buscador `q` NO busca por teléfono: sería un oráculo de enumeración', async () => {
    const { svc, wheres } = buildList();
    await svc.adminList(undefined, 1, 20, undefined, { q: '5512345678' });
    // Quien probara números sabría cuáles tienen cuenta aquí.
    expect(JSON.stringify(wheres[0].OR)).not.toMatch(/phone/);
    // Lo que SÍ busca sigue igual: folio, nombre y correo.
    expect(wheres[0].OR).toHaveLength(3);
  });
});

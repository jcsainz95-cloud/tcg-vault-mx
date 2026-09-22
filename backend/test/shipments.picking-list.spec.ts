import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpStatus } from '@nestjs/common';
import { PreparationOrderDTO, ShipmentsService } from '../src/modules/shipments/shipments.service';
import { BusinessException } from '../src/common/business.exception';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { StripeService } from '../src/modules/payments/stripe.service';
// `H3-d`: un candado de código mira CÓDIGO, no prosa.
import { stripComments } from './helpers/strip-comments';

/**
 * `GET /admin/shipments/picking-list` — **«Pedidos a preparar»** (API_CONTRACT §M4-PREP, v1.78).
 *
 * La cola dejó de ser una lista PLANA de piezas ordenada por ubicación y pasó a ser una **hoja de
 * trabajo agrupada por pedido** (`PreparationOrderDTO[]`, un elemento = UN envío). **Misma ruta,
 * mismo guard, cero schema.** Lo que este fichero fija:
 *
 *  - **lo que NO cambió:** el filtro `status='picking'` (fix QA #3 — un envío `solicitado` no está
 *    pagado y no se prepara) y el filtro `?date=`;
 *  - **lo que sí:** agrupación por pedido, `destination` derivado, cliente (+apellido derivado),
 *    dirección completa, identidad de carta con `conditionLabel` compuesta en el back,
 *    `currentLocation` como `LocationView` (⛔ `"UNASSIGNED"` ya no viaja), y los dos órdenes;
 *  - **el filtro nuevo `?destination=`** con la doctrina §0-Q completa, incluida la cubeta `vault`
 *    que hoy sale **vacía a propósito** (las órdenes `fulfillmentMode='vault'` no generan envío).
 */

// ---------------------------------------------------------------- fixtures

type ItemOverrides = Partial<{
  id: string;
  inventoryItemId: string;
  folio: string;
  finish: string;
  rawCondition: string | null;
  sealedCondition: string | null;
  gradingCompany: string | null;
  gradeValue: string | null;
  cardName: string;
  setName: string | null;
  imageSmallUrl: string | null;
  location: { label: string } | null;
}>;

/** Un `ShipmentItem` con la pieza, su carta (+set) y su ubicación, como lo trae el `include`. */
function item(o: ItemOverrides = {}) {
  return {
    id: o.id ?? 'si-1',
    inventoryItemId: o.inventoryItemId ?? 'inv-1',
    inventoryItem: {
      folio: o.folio ?? 'INV-000001',
      finish: o.finish ?? 'normal',
      rawCondition: o.rawCondition === undefined ? 'NM' : o.rawCondition,
      sealedCondition: o.sealedCondition ?? null,
      gradingCompany: o.gradingCompany ?? null,
      gradeValue: o.gradeValue ?? null,
      card: {
        name: o.cardName ?? 'Charizard',
        imageSmallUrl:
          o.imageSmallUrl === undefined ? 'https://img/charizard.png' : o.imageSmallUrl,
        set: o.setName === null ? null : { name: o.setName ?? 'Base Set' },
      },
      location: o.location === undefined ? { label: 'C01-F01-S01' } : o.location,
    },
  };
}

/** El snapshot de dirección COMPLETO (9 campos, v1.67). */
const SNAPSHOT_9 = {
  recipientName: 'Juan Carlos Sainz Pérez',
  line1: 'Av. Insurgentes Sur 1234',
  line2: 'Depto 5B',
  neighborhood: 'Del Valle',
  city: 'Ciudad de México',
  state: 'CDMX',
  postalCode: '03100',
  country: 'MX',
  phone: '+525512345678',
};

/** El snapshot LEGADO de 8 campos (anterior a v1.67): sin `recipientName`. */
const SNAPSHOT_8 = {
  line1: 'Calle Falsa 123',
  line2: null,
  neighborhood: null,
  city: 'Guadalajara',
  state: 'JAL',
  postalCode: '44100',
  country: 'MX',
  phone: '+523311112222',
};

type ShipmentOverrides = Partial<{
  id: string;
  orderId: string | null;
  orderNumber: string | null;
  fulfillmentMode: string;
  userName: string | null;
  requestedAt: Date;
  addressSnapshot: Record<string, unknown> | null;
  items: ReturnType<typeof item>[];
}>;

function shipment(o: ShipmentOverrides = {}) {
  const orderId = o.orderId === undefined ? 'ord-1' : o.orderId;
  return {
    id: o.id ?? 'ship-1',
    orderId,
    requestedAt: o.requestedAt ?? new Date('2026-09-20T10:00:00.000Z'),
    addressSnapshot: o.addressSnapshot === undefined ? SNAPSHOT_9 : o.addressSnapshot,
    order:
      orderId === null
        ? null
        : {
            orderNumber: o.orderNumber === undefined ? 'TCG-000123' : o.orderNumber,
            fulfillmentMode: o.fulfillmentMode ?? 'direct_ship',
          },
    user: o.userName === undefined ? null : o.userName === null ? null : { name: o.userName },
    items: o.items ?? [item()],
  };
}

function makeService(rows: ReturnType<typeof shipment>[] = []) {
  const prisma = { shipmentRequest: { findMany: jest.fn().mockResolvedValue(rows) } };
  const service = new ShipmentsService(
    prisma as unknown as PrismaService,
    {} as SettingsService,
    {} as StripeService,
  );
  return { prisma, service };
}

/** El único `PreparationOrderDTO` de una respuesta de una sola fila. */
async function onlyOrder(rows: ReturnType<typeof shipment>[]): Promise<PreparationOrderDTO> {
  const { service } = makeService(rows);
  const res = await service.pickingList();
  expect(res.data).toHaveLength(1);
  return res.data[0];
}

// ---------------------------------------------------------------- lo que NO cambió

describe('pickingList — lo que la reproyección NO cambió (fix QA #3 y `?date=`)', () => {
  it('filtra por status = picking (excluye `solicitado` / no pagado)', async () => {
    const { prisma, service } = makeService();
    await service.pickingList();
    const arg = prisma.shipmentRequest.findMany.mock.calls[0][0];
    expect(arg.where.status).toBe('picking');
    expect(JSON.stringify(arg.where)).not.toContain('solicitado');
  });

  it('`?date=` se conserva: acota `requestedAt` a la ventana del día', async () => {
    const { prisma, service } = makeService();
    await service.pickingList('2026-09-20');
    const arg = prisma.shipmentRequest.findMany.mock.calls[0][0];
    expect(arg.where.status).toBe('picking');
    expect(arg.where.requestedAt.gte).toEqual(new Date('2026-09-20'));
    expect(arg.where.requestedAt.lt).toEqual(
      new Date(new Date('2026-09-20').getTime() + 24 * 3600 * 1000),
    );
  });

  it('sin `?date=` no acota por fecha', async () => {
    const { prisma, service } = makeService();
    await service.pickingList();
    expect(prisma.shipmentRequest.findMany.mock.calls[0][0].where.requestedAt).toBeUndefined();
  });
});

// ------------------------------------------------- `I-1` · `?date=` malformado ⇒ 400, no 500

describe('pickingList — `?date=` (`I-1` + v1.78.2: era `500`, y ahora es date-only)', () => {
  it.each([
    ['texto libre', 'banana'],
    ['día inexistente ⇒ Invalid Date', '2026-13-45'],
    ['⚠️ 30 de febrero — `isNaN` NO lo atrapa: DESBORDA al 2 de marzo', '2026-02-30'],
    ['⚠️ 31 de abril — desborda al 1 de mayo', '2026-04-31'],
    ['⚠️ 29 de febrero de un año NO bisiesto — desborda al 1 de marzo', '2026-02-29'],
    ['mes 00', '2026-00-10'],
    ['día 32', '2026-01-32'],
    ['sin guiones', '20260920'],
    ['literal null', 'null'],
    ['repetido ⇒ llega como CSV', '2026-09-20,2026-09-21'],
    ['⭐ v1.78.2 — datetime ISO COMPLETO (ventana deslizante)', '2026-09-20T14:30:00Z'],
    ['⭐ v1.78.2 — datetime con offset', '2026-09-20T00:00:00-06:00'],
  ])(
    '`?date=` %s ⇒ 400 VALIDATION_ERROR con `details.field`, ⛔ NO 500 ni `200` vacío',
    async (_n, malo) => {
      const { prisma, service } = makeService();
      await expect(service.pickingList(malo)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        status: HttpStatus.BAD_REQUEST,
        details: { field: 'date' },
      });
      // ⛔ Y muere ANTES de tocar Prisma: un `Invalid Date` en el `where` es el `500` de `P-84`.
      expect(prisma.shipmentRequest.findMany).not.toHaveBeenCalled();
    },
  );

  it('⛔ `details` es `{field}` y NADA MÁS: sin `allowed` y sin eco del valor', async () => {
    const { service } = makeService();
    const largo = 'A'.repeat(5000);
    const err = await service.pickingList(largo).catch((e) => e);
    expect(err).toBeInstanceOf(BusinessException);
    // ⛔ Sin `allowed`: un día del calendario no se enumera — la gramática la explica el `message`.
    // ⛔ Sin eco: §0-Q punto 2 lo prohíbe en todo eje nuevo (amplificación de la respuesta).
    expect(err.details).toEqual({ field: 'date' });
    expect(JSON.stringify(err.details)).not.toContain('AAAA');
  });

  it('⭐ v1.78.2 — un día VÁLIDO ancla en UTC: `[díaT00:00Z, +24h)`, ventana medio abierta', async () => {
    const { prisma, service } = makeService();
    await service.pickingList('2026-09-20');
    const { requestedAt } = prisma.shipmentRequest.findMany.mock.calls[0][0].where;
    expect(requestedAt.gte).toEqual(new Date('2026-09-20T00:00:00.000Z'));
    expect(requestedAt.lt).toEqual(new Date('2026-09-21T00:00:00.000Z'));
    // ⛔ Medio abierta, NO `lte 23:59:59.999`: ningún instante cae en dos días y la corrección no
    // depende de la precisión del almacenamiento.
    expect(requestedAt.lte).toBeUndefined();
  });

  it('⭐ un 29 de febrero REAL (año bisiesto) SÍ se acepta: la ida y vuelta no es un rechazo ciego', async () => {
    // El candado que cierra el desbordamiento no puede cobrarse los días que sí existen.
    const { prisma, service } = makeService();
    await service.pickingList('2024-02-29');
    const { requestedAt } = prisma.shipmentRequest.findMany.mock.calls[0][0].where;
    expect(requestedAt.gte).toEqual(new Date('2024-02-29T00:00:00.000Z'));
    expect(requestedAt.lt).toEqual(new Date('2024-03-01T00:00:00.000Z'));
  });

  it('los espacios que RODEAN al token se recortan (el token sigue siendo date-only)', async () => {
    const { prisma, service } = makeService();
    await service.pickingList('  2026-09-20  ');
    const { requestedAt } = prisma.shipmentRequest.findMany.mock.calls[0][0].where;
    expect(requestedAt.gte).toEqual(new Date('2026-09-20T00:00:00.000Z'));
  });

  it('⭐ PRECEDENCIA — con los DOS ejes mal, gana `?destination=` (§0-Q primero)', async () => {
    const { prisma, service } = makeService();
    await expect(service.pickingList('banana', 'basura')).rejects.toMatchObject({
      details: { field: 'destination' },
    });
    // Y ninguna de las dos validaciones leyó nada.
    expect(prisma.shipmentRequest.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['cadena vacía', ''],
    ['solo espacios', '   '],
  ])('`?date=` %s ≡ ausente: `200` sin filtro, ⛔ nunca 400', async (_n, valor) => {
    const { prisma, service } = makeService();
    await expect(service.pickingList(valor)).resolves.toEqual({ data: [] });
    expect(prisma.shipmentRequest.findMany.mock.calls[0][0].where.requestedAt).toBeUndefined();
  });

  /**
   * ⭐⭐ **PROCEDENCIA — la gramática de «date-only» es UNA en el repositorio, y esto lo vigila.**
   *
   * ### Por qué hace falta un candado de ORIGEN y no basta uno de conducta (medido)
   * Mutación `N-DATE2`: sustituir `DATE_ONLY_RE.test(token) ? … : new Date(NaN)` por
   * `new Date(token)` a secas. Resultado medido el 2026-09-22: **82/82 unitarias y 14/14 de
   * integración en VERDE**. No es que el candado sea flojo: es que la comprobación de **ida y
   * vuelta** (`toISOString().slice(0,10) !== token`) **ya rechaza** por su cuenta el datetime, el
   * texto libre y el desbordamiento ⇒ el mutante es **equivalente en conducta**.
   *
   * Pero §M4-PREP v1.78.2 no pide solo una conducta: pide que el backend **reuse** la noción de
   * date-only que ya existe y **⛔ no escriba una tercera**. Eso es una afirmación sobre **de dónde
   * viene la regla**, y ninguna aserción de conducta la puede sostener — *si mañana alguien copia
   * `/^\d{4}-\d{2}-\d{2}$/` aquí, el comportamiento no cambia y la segunda gramática nace en verde,
   * que es exactamente cómo nacen las divergencias que este repo lleva tres pases pagando*.
   *
   * ⚠️ Mira **código**, no texto (`stripComments`): si mirara el fichero entero, el propio docstring
   * de `parseDayFilter` —que cita el patrón para explicarlo— dispararía el candado, y la salida
   * barata sería una lista blanca por nombre de fichero. Es la lección de `H3-d`, aplicada de
   * entrada.
   */
  it('⭐ PROCEDENCIA — reusa `DATE_ONLY_RE` del helper común y ⛔ no declara una segunda gramática', () => {
    const ruta = join(__dirname, '..', 'src', 'modules', 'shipments', 'shipments.service.ts');
    const codigo = stripComments(readFileSync(ruta, 'utf8'));
    // (a) la importa del ÚNICO sitio donde vive.
    expect(codigo).toMatch(
      /import\s*\{[^}]*\bDATE_ONLY_RE\b[^}]*\}\s*from\s*'\.\.\/\.\.\/common\/admin-list-filters'/,
    );
    // (b) y la USA para decidir (no la importa de adorno).
    expect(codigo).toMatch(/DATE_ONLY_RE\.test\(/);
    // (c) ⛔ y no hay ninguna gramática de fecha declarada aquí dentro.
    expect(codigo).not.toMatch(/\\d\{4\}-\\d\{2\}-\\d\{2\}/);
  });

  it('⛔ y NO existe la ventana DESLIZANTE que el datetime producía (v1.78.2)', async () => {
    // Antes: `2026-09-20T14:30Z` ⇒ `200` con una ventana hasta el **21 a las 14:30** — dos días del
    // calendario, y el operador sin poder nombrar lo que le contestaron.
    const { prisma, service } = makeService();
    await expect(service.pickingList('2026-09-20T14:30:00Z')).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      details: { field: 'date' },
    });
    expect(prisma.shipmentRequest.findMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- la consulta enriquecida

describe('pickingList — la consulta trae lo que el DTO proyecta (§M4-PREP)', () => {
  it('incluye carta+set, ubicación, el join a Order y el nombre del usuario', async () => {
    const { prisma, service } = makeService();
    await service.pickingList();
    const arg = prisma.shipmentRequest.findMany.mock.calls[0][0];
    const inv = arg.include.items.include.inventoryItem.include;
    expect(inv.card.include.set).toBe(true);
    expect(inv.location).toBe(true);
    expect(arg.include.order.select).toEqual({ orderNumber: true, fulfillmentMode: true });
    expect(arg.include.user.select).toEqual({ name: true });
  });

  it('el motor ordena los pedidos por `requestedAt` asc (CA #9)', async () => {
    const { prisma, service } = makeService();
    await service.pickingList();
    expect(prisma.shipmentRequest.findMany.mock.calls[0][0].orderBy).toEqual({
      requestedAt: 'asc',
    });
  });
});

// ---------------------------------------------------------------- agrupación

describe('pickingList — un elemento = UN pedido, no una pieza', () => {
  it('dos cartas de un mismo pedido ⇒ UN elemento con DOS items', async () => {
    const o = await onlyOrder([
      shipment({
        items: [
          item({ id: 'si-a', inventoryItemId: 'inv-a', folio: 'INV-000001' }),
          item({
            id: 'si-b',
            inventoryItemId: 'inv-b',
            folio: 'INV-000002',
            location: { label: 'C01-F01-S02' },
          }),
        ],
      }),
    ]);
    expect(o.shipmentId).toBe('ship-1');
    expect(o.items).toHaveLength(2);
    expect(o.items.map((i) => i.folio)).toEqual(['INV-000001', 'INV-000002']);
    expect(o.items.map((i) => i.shipmentItemId)).toEqual(['si-a', 'si-b']);
  });

  it('dos pedidos ⇒ dos elementos, cada uno con sus cartas', async () => {
    const { service } = makeService([
      shipment({ id: 'ship-1', requestedAt: new Date('2026-09-19T10:00:00.000Z') }),
      shipment({
        id: 'ship-2',
        requestedAt: new Date('2026-09-20T10:00:00.000Z'),
        items: [item({ id: 'si-x' }), item({ id: 'si-y', location: { label: 'C02-F01-S01' } })],
      }),
    ]);
    const res = await service.pickingList();
    expect(res.data).toHaveLength(2);
    expect(res.data.map((o) => o.items.length)).toEqual([1, 2]);
  });

  it('`quantity` es SIEMPRE 1 (un ShipmentItem = una pieza; no hay columna de cantidad)', async () => {
    const o = await onlyOrder([
      shipment({ items: [item({ id: 'si-a' }), item({ id: 'si-b', location: null })] }),
    ]);
    expect(o.items.map((i) => i.quantity)).toEqual([1, 1]);
  });
});

// ---------------------------------------------------------------- destino derivado

describe('pickingList — `destination` DERIVADO de `Order.fulfillmentMode`', () => {
  it('envío directo (`direct_ship`) ⇒ `ship`, con `orderNumber` del join', async () => {
    const o = await onlyOrder([shipment({ orderId: 'ord-1', orderNumber: 'TCG-000123' })]);
    expect(o.destination).toBe('ship');
    expect(o.orderId).toBe('ord-1');
    expect(o.orderNumber).toBe('TCG-000123');
  });

  it('RETIRO DE BÓVEDA (`orderId` null) ⇒ `orderNumber` null y `destination` = `ship`', async () => {
    const o = await onlyOrder([shipment({ orderId: null, userName: 'Ana López' })]);
    expect(o.orderId).toBeNull();
    expect(o.orderNumber).toBeNull();
    expect(o.destination).toBe('ship');
    // `shipmentId` es la referencia SIEMPRE presente para trazar el renglón.
    expect(o.shipmentId).toBe('ship-1');
  });

  it('⚠️ `vault` CON `orderId` es imposible por invariante ⇒ LANZA (igual que `kindForFulfillment`)', async () => {
    const { service } = makeService([shipment({ orderId: 'ord-x', fulfillmentMode: 'vault' })]);
    await expect(service.pickingList()).rejects.toMatchObject({
      code: 'CONFLICT',
      status: HttpStatus.CONFLICT,
    });
  });

  it('⚠️ `orderId` poblado pero SIN orden resuelta (corrupción) ⇒ LANZA, no adivina destino', async () => {
    const row = { ...shipment({ orderId: 'ord-x' }), order: null };
    const { service } = makeService([row]);
    await expect(service.pickingList()).rejects.toBeInstanceOf(BusinessException);
  });
});

// ---------------------------------------------------------------- cliente

describe('pickingList — cliente: `fullName` y el apellido DERIVADO (§6.A)', () => {
  it('con cuenta ⇒ `fullName` sale de `User.name`', async () => {
    const o = await onlyOrder([shipment({ orderId: null, userName: 'Ana María López' })]);
    expect(o.customer.fullName).toBe('Ana María López');
  });

  it('INVITADO (`userId` null) ⇒ `fullName` sale de `addressSnapshot.recipientName`', async () => {
    const o = await onlyOrder([shipment({ userName: undefined })]);
    expect(o.customer.fullName).toBe(SNAPSHOT_9.recipientName);
  });

  it('`User.name` MANDA sobre el snapshot cuando el envío tiene dueño', async () => {
    const o = await onlyOrder([shipment({ orderId: null, userName: 'Ana López' })]);
    expect(o.customer.fullName).toBe('Ana López');
    expect(o.customer.fullName).not.toBe(SNAPSHOT_9.recipientName);
  });

  it('`lastName` = último token del nombre', async () => {
    const o = await onlyOrder([shipment({ orderId: null, userName: 'Ana María López Pérez' })]);
    expect(o.customer.lastName).toBe('Pérez');
  });

  it('`lastName` con UN solo token ⇒ ese token (un mononombre se archiva bajo su letra)', async () => {
    const o = await onlyOrder([shipment({ orderId: null, userName: 'Madonna' })]);
    expect(o.customer.lastName).toBe('Madonna');
  });

  it('`lastName` NULL cuando no hay nada que derivar (nombre vacío / en blanco)', async () => {
    const o = await onlyOrder([
      shipment({ addressSnapshot: { ...SNAPSHOT_9, recipientName: '   ' } }),
    ]);
    expect(o.customer.lastName).toBeNull();
  });

  it('⭐ v1.78.1 — invitado con snapshot LEGADO de 8 campos ⇒ `fullName` NULL (⛔ nunca `""`)', async () => {
    const o = await onlyOrder([shipment({ addressSnapshot: SNAPSHOT_8 })]);
    expect(o.customer.fullName).toBeNull();
    // ⛔ La cadena vacía queda PROHIBIDA como marca de ausencia: `""` renderiza como un hueco
    // invisible y no se distingue de un nombre vacío legítimo. Un hecho, una grafía.
    expect(o.customer.fullName).not.toBe('');
  });

  it('⭐ v1.78.1 — `fullName === null` ⇒ `lastName === null` POR CONSTRUCCIÓN (la ausencia se propaga)', async () => {
    const o = await onlyOrder([shipment({ addressSnapshot: SNAPSHOT_8 })]);
    expect(o.customer.fullName).toBeNull();
    expect(o.customer.lastName).toBeNull();
  });

  it('⭐ v1.78.1 — snapshot ausente por completo ⇒ `fullName` y `lastName` NULL, sin reventar', async () => {
    const o = await onlyOrder([shipment({ addressSnapshot: null })]);
    expect(o.customer).toEqual({ fullName: null, lastName: null });
  });

  it('⛔ la cadena vacía NO viaja en `customer`: `null` es la ÚNICA marca de ausencia', async () => {
    const { service } = makeService([
      shipment({ addressSnapshot: SNAPSHOT_8 }),
      shipment({ id: 'ship-2', orderId: null, userName: 'Ana López' }),
    ]);
    const res = await service.pickingList();
    for (const o of res.data) {
      expect(o.customer.fullName).not.toBe('');
      expect(o.customer.lastName).not.toBe('');
    }
  });
});

// ---------------------------------------------------------------- dirección

describe('pickingList — `shipTo` (CA #6: la dirección COMPLETA, con la calle)', () => {
  it('destino `ship` ⇒ los 9 campos del snapshot', async () => {
    const o = await onlyOrder([shipment()]);
    expect(o.shipTo).toEqual(SNAPSHOT_9);
    // La CALLE es justo lo que la fila plana de ayer omitía.
    expect(o.shipTo?.line1).toBe('Av. Insurgentes Sur 1234');
  });

  it('snapshot LEGADO de 8 campos ⇒ `recipientName` null, el resto intacto', async () => {
    const o = await onlyOrder([shipment({ addressSnapshot: SNAPSHOT_8 })]);
    expect(o.shipTo).toEqual({ recipientName: null, ...SNAPSHOT_8 });
  });

  it('snapshot ausente o no-objeto ⇒ nullables en null y el resto vacío, sin reventar', async () => {
    const o = await onlyOrder([shipment({ addressSnapshot: null })]);
    expect(o.shipTo).toEqual({
      recipientName: null,
      line1: '',
      line2: null,
      neighborhood: null,
      city: '',
      state: '',
      postalCode: '',
      country: '',
      phone: '',
    });
  });
});

// ---------------------------------------------------------------- identidad de la carta

describe('pickingList — identidad de la carta y `conditionLabel` compuesta EN EL BACK', () => {
  it('nombre, set, acabado y miniatura salen del catálogo', async () => {
    const o = await onlyOrder([
      shipment({
        items: [item({ cardName: 'Blastoise', setName: 'Jungle', finish: 'reverse_holo' })],
      }),
    ]);
    expect(o.items[0].card).toMatchObject({
      name: 'Blastoise',
      setName: 'Jungle',
      finish: 'reverse_holo',
      imageSmallUrl: 'https://img/charizard.png',
    });
  });

  it('carta sin set ⇒ `setName` null; sin imagen ⇒ `imageSmallUrl` null', async () => {
    const o = await onlyOrder([
      shipment({ items: [item({ setName: null, imageSmallUrl: null })] }),
    ]);
    expect(o.items[0].card.setName).toBeNull();
    expect(o.items[0].card.imageSmallUrl).toBeNull();
  });

  it('precedencia 1 — GRADEADA: `gradingCompany` + `gradeValue` ⇒ "PSA 9" (gana sobre rawCondition)', async () => {
    const o = await onlyOrder([
      shipment({
        items: [item({ gradingCompany: 'PSA', gradeValue: '9', rawCondition: 'NM' })],
      }),
    ]);
    expect(o.items[0].card.conditionLabel).toBe('PSA 9');
  });

  it('precedencia 2 — RAW: sin gradeo ⇒ `rawCondition` ("NM")', async () => {
    const o = await onlyOrder([shipment({ items: [item({ rawCondition: 'NM' })] })]);
    expect(o.items[0].card.conditionLabel).toBe('NM');
  });

  it('precedencia 3 — SELLADO: `mint` ⇒ "Mint" y `minor_box_damage` ⇒ "Minor box damage"', async () => {
    const o = await onlyOrder([
      shipment({
        items: [
          item({ id: 'si-a', rawCondition: null, sealedCondition: 'mint' }),
          item({
            id: 'si-b',
            rawCondition: null,
            sealedCondition: 'minor_box_damage',
            location: { label: 'C01-F01-S02' },
          }),
        ],
      }),
    ]);
    expect(o.items.map((i) => i.card.conditionLabel)).toEqual(['Mint', 'Minor box damage']);
  });

  it('gradeo a MEDIAS (compañía sin grado) cae al siguiente escalón, no dice "PSA" a secas', async () => {
    const o = await onlyOrder([
      shipment({ items: [item({ gradingCompany: 'PSA', gradeValue: null, rawCondition: 'NM' })] }),
    ]);
    expect(o.items[0].card.conditionLabel).toBe('NM');
  });

  it('pieza sin ninguna de las tres ⇒ cadena vacía (no rompe la cola)', async () => {
    const o = await onlyOrder([
      shipment({ items: [item({ rawCondition: null, sealedCondition: null })] }),
    ]);
    expect(o.items[0].card.conditionLabel).toBe('');
  });
});

// ---------------------------------------------------------------- ubicación

describe('pickingList — `currentLocation` es `LocationView` (CA #11)', () => {
  it('ubicación poblada ⇒ `{kind:"assigned", label}`', async () => {
    const o = await onlyOrder([
      shipment({ items: [item({ location: { label: 'C03-F02-S15' } })] }),
    ]);
    expect(o.items[0].currentLocation).toEqual({ kind: 'assigned', label: 'C03-F02-S15' });
  });

  it('sin ubicación ⇒ `{kind:"unassigned"}` SIN `label`', async () => {
    const o = await onlyOrder([shipment({ items: [item({ location: null })] })]);
    expect(o.items[0].currentLocation).toEqual({ kind: 'unassigned' });
    expect('label' in o.items[0].currentLocation).toBe(false);
  });

  it('⛔ el string "UNASSIGNED" DEJA DE VIAJAR por el cable', async () => {
    const { service } = makeService([
      shipment({ items: [item({ id: 'si-a', location: null }), item({ id: 'si-b' })] }),
    ]);
    const res = await service.pickingList();
    expect(JSON.stringify(res)).not.toContain('UNASSIGNED');
  });
});

// ---------------------------------------------------------------- órdenes

describe('pickingList — los dos órdenes', () => {
  it('pedidos: `requestedAt` asc, lo más viejo primero (CA #9)', async () => {
    // El mock devuelve lo que el `orderBy` pidió; se comprueba que la proyección lo CONSERVA.
    const { service } = makeService([
      shipment({ id: 'viejo', requestedAt: new Date('2026-09-18T08:00:00.000Z') }),
      shipment({ id: 'medio', requestedAt: new Date('2026-09-19T08:00:00.000Z') }),
      shipment({ id: 'nuevo', requestedAt: new Date('2026-09-20T08:00:00.000Z') }),
    ]);
    const res = await service.pickingList();
    expect(res.data.map((o) => o.shipmentId)).toEqual(['viejo', 'medio', 'nuevo']);
    expect(res.data.map((o) => o.requestedAt)).toEqual([
      '2026-09-18T08:00:00.000Z',
      '2026-09-19T08:00:00.000Z',
      '2026-09-20T08:00:00.000Z',
    ]);
  });

  it('cartas dentro del pedido: por ubicación, y las `unassigned` AL FINAL', async () => {
    const o = await onlyOrder([
      shipment({
        items: [
          item({ id: 'sin-2', folio: 'F-SIN-2', location: null }),
          item({ id: 'c03', folio: 'F-C03', location: { label: 'C03-F01-S01' } }),
          item({ id: 'sin-1', folio: 'F-SIN-1', location: null }),
          item({ id: 'c01', folio: 'F-C01', location: { label: 'C01-F01-S01' } }),
          item({ id: 'c02', folio: 'F-C02', location: { label: 'C02-F01-S01' } }),
        ],
      }),
    ]);
    expect(o.items.map((i) => i.shipmentItemId)).toEqual(['c01', 'c02', 'c03', 'sin-2', 'sin-1']);
    expect(o.items.slice(3).every((i) => i.currentLocation.kind === 'unassigned')).toBe(true);
  });
});

// ---------------------------------------------------------------- ?destination= (§0-Q)

describe('pickingList — `?destination=` (§0-Q: o filtra, o 400)', () => {
  const dosFilas = () => [
    shipment({ id: 'directo', orderId: 'ord-1' }),
    shipment({ id: 'retiro', orderId: null, userName: 'Ana López' }),
  ];

  it('ausente ⇒ AMBAS cubetas (no filtra)', async () => {
    const { service } = makeService(dosFilas());
    const res = await service.pickingList();
    expect(res.data.map((o) => o.shipmentId)).toEqual(['directo', 'retiro']);
  });

  it('`?destination=ship` ⇒ devuelve filas (retiros + envíos directos)', async () => {
    const { service } = makeService(dosFilas());
    const res = await service.pickingList(undefined, 'ship');
    expect(res.data).toHaveLength(2);
    expect(res.data.every((o) => o.destination === 'ship')).toBe(true);
  });

  it('⚠️ `?destination=vault` ⇒ VACÍO: las órdenes `fulfillmentMode=vault` no generan envío', async () => {
    const { service } = makeService(dosFilas());
    const res = await service.pickingList(undefined, 'vault');
    expect(res.data).toEqual([]);
  });

  it('cadena vacía y solo-espacios ≡ ausente (nunca 400 — §0-Q fila 1)', async () => {
    const { service } = makeService(dosFilas());
    expect((await service.pickingList(undefined, '')).data).toHaveLength(2);
    expect((await service.pickingList(undefined, '   ')).data).toHaveLength(2);
  });

  it('fuera de dominio ⇒ 400 VALIDATION_ERROR con `details` EXACTO', async () => {
    const { prisma, service } = makeService(dosFilas());
    await expect(service.pickingList(undefined, 'basura')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: HttpStatus.BAD_REQUEST,
      details: { field: 'destination', allowed: ['vault', 'ship'] },
    });
    // ⛔ Y muere ANTES de tocar Prisma (§0-Q: nunca llega crudo al `where`).
    expect(prisma.shipmentRequest.findMany).not.toHaveBeenCalled();
  });

  it('un token con espacios alrededor es entrada MAL FORMADA ⇒ 400, no se normaliza en silencio', async () => {
    const { service } = makeService(dosFilas());
    await expect(service.pickingList(undefined, ' ship')).rejects.toBeInstanceOf(BusinessException);
  });

  it('⛔ NO acepta los tokens de `FulfillmentMode`: `direct_ship` no es del dominio del DTO', async () => {
    const { service } = makeService(dosFilas());
    await expect(service.pickingList(undefined, 'direct_ship')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { field: 'destination', allowed: ['vault', 'ship'] },
    });
  });

  it('`?date=` y `?destination=` conviven', async () => {
    const { prisma, service } = makeService(dosFilas());
    const res = await service.pickingList('2026-09-20', 'ship');
    expect(prisma.shipmentRequest.findMany.mock.calls[0][0].where.requestedAt).toBeDefined();
    expect(res.data).toHaveLength(2);
  });
});

// ---------------------------------------------------------------- forma del DTO

// ---------------------------------------------- `B-1` · la ausencia se escribe `null`, y SOLO `null`

/**
 * ⭐⭐ **`B-1` (bloqueante de QA) — la fuente que EXISTE VACÍA.**
 *
 * v1.78.1 prohíbe `""` como marca de ausencia, y el backend cerró solo la mitad: `?? null` cae ante
 * `null`/`undefined` **pero no ante `""` ni `"   "`**. En la cola viva salieron las **tres grafías
 * del mismo hecho una debajo de otra**.
 *
 * ⚠️ **Y el candado que parecía cubrirlo no lo cubría:** la prueba de «`lastName` NULL cuando no hay
 * nada que derivar» servía `'   '` **y solo asertaba `lastName`, nunca `fullName`** — así que el
 * defecto convivía con ella en verde. *Una prueba que no mira el campo del defecto no es cobertura
 * de ese campo, por mucho que sirva su entrada.* De ahí que aquí se asserte **el campo**, y que el
 * censo de más abajo mire **todos** los campos a la vez en vez de fiarse de esta lista.
 */
describe('`B-1` — ningún campo nullable sirve `""` ni `"   "` (v1.78.1)', () => {
  it.each([
    ['cadena vacía', ''],
    ['solo espacios', '   '],
    ['tabulador y salto', '\t\n '],
  ])('`User.name` %s ⇒ `fullName` NULL (y `lastName` NULL)', async (_n, blanco) => {
    const o = await onlyOrder([shipment({ orderId: null, userName: blanco })]);
    expect(o.customer.fullName).toBeNull();
    expect(o.customer.lastName).toBeNull();
  });

  it.each([
    ['cadena vacía', ''],
    ['solo espacios', '   '],
  ])('`addressSnapshot.recipientName` %s ⇒ `fullName` y `shipTo.recipientName` NULL', async (_n, blanco) => {
    const o = await onlyOrder([
      shipment({ addressSnapshot: { ...SNAPSHOT_9, recipientName: blanco } }),
    ]);
    expect(o.customer.fullName).toBeNull();
    expect(o.shipTo?.recipientName).toBeNull();
  });

  it('⛔ un `User.name` en blanco NO se rellena con el `recipientName` del snapshot', async () => {
    // El destinatario PUEDE SER OTRA PERSONA: rellenar con él inventaría una atribución en la
    // pantalla del operador. Se prefiere la ausencia declarada a un nombre plausible.
    const o = await onlyOrder([shipment({ userName: '  ', addressSnapshot: SNAPSHOT_9 })]);
    expect(o.customer.fullName).toBeNull();
    expect(o.shipTo?.recipientName).toBe(SNAPSHOT_9.recipientName);
  });

  it('`line2` y `neighborhood` en blanco ⇒ NULL (misma grafía que la llave ausente)', async () => {
    const o = await onlyOrder([
      shipment({ addressSnapshot: { ...SNAPSHOT_9, line2: '', neighborhood: '   ' } }),
    ]);
    expect(o.shipTo?.line2).toBeNull();
    expect(o.shipTo?.neighborhood).toBeNull();
  });

  it('`orderNumber` en blanco ⇒ NULL (un folio vacío es la misma ausencia que ninguna orden)', async () => {
    const o = await onlyOrder([shipment({ orderNumber: '   ' })]);
    expect(o.orderNumber).toBeNull();
  });

  it('⭐ `setName` en blanco ⇒ NULL — el campo donde la mutación `?? ""` SOBREVIVÍA a 5611 pruebas', async () => {
    const o = await onlyOrder([shipment({ items: [item({ setName: '' })] })]);
    expect(o.items[0].card.setName).toBeNull();
  });

  it('`imageSmallUrl` en blanco ⇒ NULL (una URL vacía es una imagen que no existe)', async () => {
    const o = await onlyOrder([shipment({ items: [item({ imageSmallUrl: '   ' })] })]);
    expect(o.items[0].card.imageSmallUrl).toBeNull();
  });

  it('⭐ v1.78.2 — `VaultLocation.label` en blanco ⇒ `{kind:"unassigned"}` (⛔ no un `assigned` mudo)', async () => {
    // La hoja de trabajo contesta UNA pregunta: «¿hay sitio al que caminar?». Una etiqueta en blanco
    // responde que no, igual que la ausencia de fila ⇒ es el MISMO estado y lleva el mismo nombre.
    // ⛔ Y `label: ""` sería la cuarta grafía de la ausencia, que es `B-1` otra vez.
    const o = await onlyOrder([shipment({ items: [item({ location: { label: '  ' } })] })]);
    expect(o.items[0].currentLocation).toEqual({ kind: 'unassigned' });
    expect('label' in o.items[0].currentLocation).toBe(false);
  });

  it('⛔ el tipo hace IRREPRESENTABLE el `assigned` sin etiqueta: ningún `kind` fuera de los dos', async () => {
    const { service } = makeService([
      shipment({
        items: [
          item({ id: 'a', location: { label: 'C01-F01-S01' } }),
          item({ id: 'b', location: { label: '   ' } }),
          item({ id: 'c', location: null }),
        ],
      }),
    ]);
    const res = await service.pickingList();
    for (const i of res.data[0].items) {
      expect(['assigned', 'unassigned']).toContain(i.currentLocation.kind);
      // `assigned` ⇒ hay etiqueta NO vacía. `unassigned` ⇒ la llave no existe.
      if (i.currentLocation.kind === 'assigned') {
        expect(i.currentLocation.label.trim()).not.toBe('');
      } else {
        expect('label' in i.currentLocation).toBe(false);
      }
    }
  });

  it('⛔ el blanco decide la AUSENCIA; ⛔ NO recorta el dato que sí existe', async () => {
    // Misma doctrina que §0-Q: el `trim()` decide si viene vacío, no «arregla» el token.
    const o = await onlyOrder([shipment({ orderId: null, userName: '  Ana López  ' })]);
    expect(o.customer.fullName).toBe('  Ana López  ');
    expect(o.customer.lastName).toBe('López');
  });
});

/**
 * ⭐⭐ **EL CENSO DE BLANCOS — la mitad que NO se fía de la lista de arriba.**
 *
 * La lista de casos de `B-1` cubre los campos que **hoy** sabemos que existen. Un campo nullable
 * NUEVO que alguien añada mañana sin `nullIfBlank` **no aparece en ninguno de esos `it`** y entra en
 * verde — que es exactamente cómo llegó `B-1`. Este censo mira la respuesta **entera**: se sirve un
 * pedido con **todas las fuentes de texto en blanco** y se congela, con `toEqual`, el conjunto de
 * rutas que aún devuelven blanco.
 *
 * **La lista blanca NO es una excepción cómoda: es el inventario de los campos que el CONTRATO
 * declara `string` (no nullables)**, donde devolver `null` sería salirse del tipo publicado. Su cura
 * es del contrato, ⛔ no de este servicio. Si aparece una ruta nueva aquí, la salida ⛔ no es añadirla
 * a la lista: es pasar el campo por `nullIfBlank` — y si de verdad es un `string` del contrato,
 * escribirlo aquí **a mano y con su motivo**, que es lo que hace que la decisión se vea en revisión.
 *
 * ⛔ Los identificadores (`shipmentId`, `folio`, `inventoryItemId`, `shipmentItemId`, `requestedAt`)
 * NO se ponen en blanco en el fixture: son llaves primarias y su blanco no dice nada sobre el
 * contrato. Lo que se blanquea es **todo lo que el operador lee**.
 */
describe('`B-1` — CENSO: qué rutas del DTO pueden servir blanco (congelado)', () => {
  /** Rutas de la respuesta cuyo valor es un string en blanco. */
  function blancos(v: unknown, ruta = ''): string[] {
    if (typeof v === 'string') return v.trim() === '' ? [ruta] : [];
    if (Array.isArray(v)) return v.flatMap((x, i) => blancos(x, `${ruta}[${i}]`));
    if (v && typeof v === 'object') {
      return Object.entries(v).flatMap(([k, x]) => blancos(x, ruta ? `${ruta}.${k}` : k));
    }
    return [];
  }

  /** Un pedido con TODA fuente de texto en blanco. Si algo puede salir vacío, sale aquí. */
  const todoEnBlanco = () =>
    shipment({
      orderNumber: '  ',
      userName: '',
      addressSnapshot: {
        recipientName: '',
        line1: '  ',
        line2: '',
        neighborhood: '   ',
        city: '',
        state: '  ',
        postalCode: '',
        country: '  ',
        phone: '',
      },
      items: [
        item({
          cardName: '  ',
          setName: '',
          imageSmallUrl: '  ',
          // Sin ninguna de las tres fuentes ⇒ `conditionLabel` vacía (declarada `string`).
          rawCondition: null,
          sealedCondition: null,
          gradingCompany: null,
          gradeValue: null,
          location: { label: '   ' },
        }),
      ],
    });

  it('⭐ el conjunto de rutas en blanco es EXACTAMENTE el de los `string` del contrato', async () => {
    const { service } = makeService([todoEnBlanco()]);
    const res = await service.pickingList();
    expect(blancos(res).sort()).toEqual([
      // ⚠️ LOS SEIS CAMPOS OBLIGATORIOS DE `shipTo`: el contrato los declara `string`, no
      // `string | null`. Devolver `null` aquí sería salirse del tipo publicado, y reventar por un
      // snapshot viejo es peor que mostrar un hueco. Cura: del CONTRATO (arquitecto), no de aquí.
      'data[0].shipTo.city',
      'data[0].shipTo.country',
      'data[0].shipTo.line1',
      'data[0].shipTo.phone',
      'data[0].shipTo.postalCode',
      'data[0].shipTo.state',
      // `Card.name` es NOT NULL en el schema y `string` en el DTO: un nombre de carta en blanco es
      // un dato roto del catálogo, no una ausencia que este DTO pueda nombrar.
      'data[0].items[0].card.name',
      // `conditionLabel` es COMPUESTA y `string`: vacía = la pieza no tiene ninguna de las tres
      // fuentes (captura a medias). Es el único blanco que este servicio produce a propósito.
      'data[0].items[0].card.conditionLabel',
    ].sort());
  });

  it('⛔ y NINGUNA de esas rutas es un campo nullable del DTO', async () => {
    const { service } = makeService([todoEnBlanco()]);
    const res = await service.pickingList();
    const enBlanco = new Set(blancos(res));
    for (const nullable of [
      'data[0].orderNumber',
      'data[0].customer.fullName',
      'data[0].customer.lastName',
      'data[0].shipTo.recipientName',
      'data[0].shipTo.line2',
      'data[0].shipTo.neighborhood',
      'data[0].items[0].card.setName',
      'data[0].items[0].card.imageSmallUrl',
      'data[0].items[0].currentLocation.label',
    ]) {
      expect([nullable, enBlanco.has(nullable)]).toEqual([nullable, false]);
    }
  });
});

describe('pickingList — la forma vieja ya no viaja', () => {
  it('el renglón es un PEDIDO: ⛔ sin `location` plano ni `folio` a nivel de pedido', async () => {
    const o = await onlyOrder([shipment()]);
    expect(o).not.toHaveProperty('folio');
    expect(o).not.toHaveProperty('location');
    expect(o).not.toHaveProperty('inventoryItemId');
    // El folio y la ubicación viven ahora DENTRO de cada carta.
    expect(o.items[0].folio).toBe('INV-000001');
    expect(o.items[0].currentLocation).toEqual({ kind: 'assigned', label: 'C01-F01-S01' });
  });

  it('cola vacía ⇒ `{ data: [] }`', async () => {
    const { service } = makeService();
    await expect(service.pickingList()).resolves.toEqual({ data: [] });
  });
});

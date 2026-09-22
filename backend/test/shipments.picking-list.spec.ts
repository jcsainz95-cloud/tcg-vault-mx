import { HttpStatus } from '@nestjs/common';
import { PreparationOrderDTO, ShipmentsService } from '../src/modules/shipments/shipments.service';
import { BusinessException } from '../src/common/business.exception';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { StripeService } from '../src/modules/payments/stripe.service';

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

  it('invitado con snapshot LEGADO de 8 campos ⇒ `fullName` vacío y `lastName` null, sin reventar', async () => {
    const o = await onlyOrder([shipment({ addressSnapshot: SNAPSHOT_8 })]);
    expect(o.customer.fullName).toBe('');
    expect(o.customer.lastName).toBeNull();
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

describe('pickingList — la forma vieja ya no viaja', () => {
  it('el renglón es un PEDIDO: ⛔ sin `location` plano ni `folio` a nivel de pedido', async () => {
    const o = await onlyOrder([shipment()]);
    expect(o).not.toHaveProperty('folio');
    expect(o).not.toHaveProperty('location');
    expect(o).not.toHaveProperty('inventoryItemId');
    // El folio y la ubicación viven ahora DENTRO de cada carta.
    expect(o.items[0].folio).toBe('INV-000001');
    expect(o.items[0].currentLocation.label).toBe('C01-F01-S01');
  });

  it('cola vacía ⇒ `{ data: [] }`', async () => {
    const { service } = makeService();
    await expect(service.pickingList()).resolves.toEqual({ data: [] });
  });
});

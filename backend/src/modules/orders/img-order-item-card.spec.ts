import { OrdersService } from './orders.service';
import { GuestCheckoutService } from './guest-checkout.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import {
  FROZEN_CARD_FACT_KEYS,
  FrozenCardFacts,
  distinctCardIds,
  readFrozenCardFacts,
  resolveOrderItemCard,
} from './order-item-card';

/**
 * IMG (ARCHITECTURE §5.2 / API_CONTRACT v1.51-b) — la MINIATURA de las líneas de compra.
 *
 * El defecto: `cardSnapshot()` no incluía `imageSmallUrl`, así que el carrito, el checkout de
 * invitado y el detalle de pedido pintaban un hueco gris. La decisión del arquitecto NO fue
 * persistir el campo (opción (i), rechazada), sino **resolverlo en LECTURA** por join sobre el
 * `cardId` congelado (opción (ii)).
 *
 * **La prueba que separa (ii) de (i) disfrazada** vive abajo, en el bloque
 * «GET /orders/:orderId — PEDIDO HISTÓRICO»: una orden cuyo JSON se escribió ANTES del arreglo
 * (sin `imageSmallUrl` por ningún lado) DEBE mostrar miniatura. Si esa prueba pasara solo con
 * pedidos nuevos, se habría implementado la opción rechazada.
 */

const FEE = { stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 };
const IVA = 16;
const SHIPPING = 17500;

const IMG = 'https://images.pokemontcg.io/base1/4.png';

/** Pieza de inventario vendible, con su `card` YA cargada (como la carga el quote para preciar). */
function inventoryItem(over: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    folio: 'INV-0001',
    cardId: 'card-1',
    productType: 'raw',
    rawCondition: 'NM',
    gradingCompany: null,
    gradeValue: null,
    finish: 'normal',
    ownerType: 'platform',
    status: 'listed',
    // Override por pieza > 0 ⇒ la decisión de venta corta en el peldaño 1 y el test no necesita
    // el PricingService (este archivo es de DISPLAY: no toca ni un monto).
    listPriceCents: 25000,
    card: {
      id: 'card-1',
      name: 'Charizard',
      number: '4',
      imageSmallUrl: IMG,
      set: { name: 'Base Set' },
    },
    ...over,
  };
}

function settingsMock() {
  return {
    getNumber: jest.fn(async (key: string) => (key === 'shipping_fee_cents' ? SHIPPING : IVA)),
    getStripeFee: jest.fn(async () => FEE),
  } as unknown as SettingsService;
}

/** OrdersService con un prisma de mentira; `spies` deja auditar QUÉ tablas se consultaron. */
function buildOrders(prismaOver: Record<string, unknown> = {}) {
  const cardFindMany = jest.fn(async () => []);
  const inventoryFindMany = jest.fn(async () => [inventoryItem()]);
  const prisma = {
    inventoryItem: { findMany: inventoryFindMany },
    card: { findMany: cardFindMany },
    order: { findUnique: jest.fn(async () => null) },
    ...prismaOver,
  } as unknown as PrismaService;
  const svc = new OrdersService(
    prisma,
    {} as never,
    settingsMock(),
    {} as never,
    {} as never,
  );
  return { svc, prisma, cardFindMany, inventoryFindMany };
}

/**
 * Fila `OrderItem` HISTÓRICA: el JSON tal cual lo escribió el código ANTERIOR al arreglo — los
 * ocho hechos congelados y NI RASTRO de `imageSmallUrl`. Es el corazón de la prueba de QA.
 */
function historicOrderItem(over: Record<string, unknown> = {}) {
  return {
    inventoryItemId: 'inv-1',
    unitPriceCents: 25000,
    cardSnapshot: {
      cardId: 'card-1',
      name: 'Charizard',
      setName: 'Base Set',
      number: '4',
      productType: 'raw',
      rawCondition: 'NM',
      gradingCompany: null,
      gradeValue: null,
    },
    ...over,
  };
}

function orderRow(items: unknown[]) {
  return {
    id: 'order-1',
    userId: 'user-1',
    status: 'settled',
    createdAt: new Date('2026-01-01'),
    settledAt: new Date('2026-01-02'),
    subtotalCents: 25000,
    ivaCents: 4000,
    ivaRatePct: IVA,
    processingFeeCents: 1400,
    totalCents: 30400,
    cfdiStatus: 'registrado',
    invoiceRequested: false,
    stripePaymentIntentId: 'pi_1',
    guestEmail: null,
    claimedAt: null,
    items,
  };
}

// ---------------------------------------------------------------------------------------------

describe('IMG-0 — la regla de resolución (§5.2.5) en su cuerpo único', () => {
  const facts: FrozenCardFacts = {
    cardId: 'card-1',
    name: 'Charizard',
    setName: 'Base Set',
    number: '4',
    productType: 'raw',
    rawCondition: 'NM',
  };

  it('une los hechos congelados con la imagen de la fila Card', () => {
    expect(resolveOrderItemCard(facts, { imageSmallUrl: IMG })).toEqual({ ...facts, imageSmallUrl: IMG });
  });

  it('clave SIEMPRE presente: sin fila Card ⇒ `imageSmallUrl: null`, NUNCA se omite la clave', () => {
    const dto = resolveOrderItemCard(facts, null);
    expect(dto.imageSmallUrl).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(dto, 'imageSmallUrl')).toBe(true);
  });

  it('la columna `String?` en null es un resultado legítimo, no un error', () => {
    expect(resolveOrderItemCard(facts, { imageSmallUrl: null }).imageSmallUrl).toBeNull();
  });

  it('NUNCA inventa la URL por plantilla ni la deriva del externalId', () => {
    const dto = resolveOrderItemCard({ ...facts, setName: 'Base Set' }, null);
    expect(dto.imageSmallUrl).toBeNull();
    expect(JSON.stringify(dto)).not.toContain('images.pokemontcg.io');
  });

  it('§5.2.4 — la imagen JAMÁS se lee del JSON: aunque alguien la escribiera ahí, gana el join', () => {
    const envenenado = { ...facts, imageSmallUrl: 'https://cdn.muerto/404.png' } as FrozenCardFacts;
    expect(resolveOrderItemCard(envenenado, { imageSmallUrl: IMG }).imageSmallUrl).toBe(IMG);
    // Y si no hay fila Card, el valor del blob tampoco se rescata: `null`, no la URL podrida.
    expect(resolveOrderItemCard(envenenado, null).imageSmallUrl).toBeNull();
  });

  it('los `cardId` se deduplican para UNA sola consulta y descartan blobs sin cardId', () => {
    expect(distinctCardIds([{ cardId: 'a' }, { cardId: 'a' }, { cardId: 'b' }, {}])).toEqual(['a', 'b']);
  });

  it('un blob ausente o con forma inesperada rinde `{}` — jamás un hecho inventado', () => {
    expect(readFrozenCardFacts(null)).toEqual({});
    expect(readFrozenCardFacts('no soy un objeto')).toEqual({});
    expect(readFrozenCardFacts([1, 2])).toEqual({});
    expect(readFrozenCardFacts({ cardId: 'x' })).toEqual({ cardId: 'x' });
  });
});

describe('IMG-1 — lo que se PERSISTE no cambia: la imagen no entra al snapshot congelado', () => {
  it('`cardSnapshot()` congela los OCHO hechos y NO `imageSmallUrl` (opción (i) rechazada)', async () => {
    const { svc } = buildOrders();
    const snap = (svc as never as { cardSnapshot: (i: unknown) => FrozenCardFacts }).cardSnapshot(
      inventoryItem(),
    );
    expect(Object.keys(snap).sort()).toEqual([
      'cardId',
      'gradeValue',
      'gradingCompany',
      'name',
      'number',
      'productType',
      'rawCondition',
      'setName',
    ]);
    expect(snap).not.toHaveProperty('imageSmallUrl');
  });
});

describe('IMG-2 — POST /checkout/quote (EL CARRITO: la queja original)', () => {
  it('cada línea trae `card.imageSmallUrl` poblada', async () => {
    const { svc } = buildOrders();
    const res = await svc.quote(['inv-1']);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].card.imageSmallUrl).toBe(IMG);
  });

  it('SIN consulta extra: el quote NO toca `prisma.card` (la imagen sale del `card` ya cargado)', async () => {
    const { svc, cardFindMany } = buildOrders();
    await svc.quote(['inv-1']);
    expect(cardFindMany).not.toHaveBeenCalled();
  });

  it('carta sin imagen ⇒ `null` con la clave presente, y el quote responde 200 igual', async () => {
    const item = inventoryItem();
    item.card.imageSmallUrl = null as never;
    const { svc } = buildOrders({ inventoryItem: { findMany: jest.fn(async () => [item]) } });
    const res = await svc.quote(['inv-1']);
    expect(res.items[0].card).toHaveProperty('imageSmallUrl', null);
  });

  it('MONEY-SAFE: la miniatura no mueve ni un centavo del desglose ni del unitPrice', async () => {
    const { svc } = buildOrders();
    const res = await svc.quote(['inv-1']);
    expect(res.items[0].unitPriceCents).toBe(25000);
    expect(res.breakdown).toEqual({
      subtotalCents: 25000,
      ivaCents: 4000,
      ivaRatePct: IVA,
      processingFeeCents: expect.any(Number),
      totalCents: expect.any(Number),
      currency: 'MXN',
    });
    expect(res.breakdown.totalCents).toBe(29000 + res.breakdown.processingFeeCents);
  });

  it('carrito 100 % podado: `items: []`, breakdown en ceros (shape estable intacto)', async () => {
    const { svc } = buildOrders({ inventoryItem: { findMany: jest.fn(async () => []) } });
    const res = await svc.quote(['muerta']);
    expect(res.items).toEqual([]);
    expect(res.breakdown.totalCents).toBe(0);
    expect(res.unavailableItems).toEqual([{ inventoryItemId: 'muerta', cardName: null }]);
  });

  it('CONTRATO — `productType` y `rawCondition` viajan DENTRO de `card`, nunca al nivel del ítem', async () => {
    const { svc } = buildOrders();
    const [preview] = (await svc.quote(['inv-1'])).items;
    expect(preview.card.productType).toBe('raw');
    expect(preview.card.rawCondition).toBe('NM');
    expect(preview).not.toHaveProperty('productType');
    expect(preview).not.toHaveProperty('rawCondition');
    expect(Object.keys(preview).sort()).toEqual(['card', 'inventoryItemId', 'unitPriceCents']);
  });

  it('`OrderItemCardDTO` NO es `CardDTO`: sin `id`, `externalId`, `imageLargeUrl`, `rarity`…', async () => {
    const { svc } = buildOrders();
    const { card } = (await svc.quote(['inv-1'])).items[0];
    expect(Object.keys(card).sort()).toEqual([
      'cardId',
      'gradeValue',
      'gradingCompany',
      'imageSmallUrl',
      'name',
      'number',
      'productType',
      'rawCondition',
      'setName',
    ]);
  });
});

describe('IMG-3 — POST /checkout/guest/quote (mismo hueco gris, misma causa)', () => {
  function buildGuest(over: Record<string, unknown> = {}) {
    const { svc: orders, cardFindMany } = buildOrders(over);
    const guest = new GuestCheckoutService(
      {} as never,
      orders,
      settingsMock(),
      {} as never,
      {} as never,
      {} as never,
    );
    return { guest, cardFindMany };
  }

  it('cada línea trae `card.imageSmallUrl` poblada, y sin consulta extra', async () => {
    const { guest, cardFindMany } = buildGuest();
    const res = await guest.quote({ inventoryItemIds: ['inv-1'] } as never);
    expect(res.items[0].card.imageSmallUrl).toBe(IMG);
    expect(cardFindMany).not.toHaveBeenCalled();
  });

  it('MONEY-SAFE: los DOS desgloses del invitado siguen intactos', async () => {
    const { guest } = buildGuest();
    const res = await guest.quote({ inventoryItemIds: ['inv-1'] } as never);
    expect(res.items[0].unitPriceCents).toBe(25000);
    expect(res.breakdown.subtotalCents).toBe(25000);
    expect(res.breakdown.shippingFeeCents).toBe(SHIPPING);
    expect(res.vaultBreakdown).not.toHaveProperty('shippingFeeCents');
    expect(res.unavailableItems).toEqual([]);
  });

  it('`productType`/`rawCondition` DENTRO de `card` también en la ruta de invitado', async () => {
    const { guest } = buildGuest();
    const [preview] = (await guest.quote({ inventoryItemIds: ['inv-1'] } as never)).items;
    expect(preview.card.productType).toBe('raw');
    expect(preview.card.rawCondition).toBe('NM');
    expect(preview).not.toHaveProperty('productType');
  });
});

/**
 * `getOrder` con la BD de mentira. `cards` es lo que la tabla `Card` contiene HOY: los tests de IMG-5
 * la llenan a propósito con la identidad completa, porque el punto es que ese dato **existe y aun así
 * no se sirve**.
 */
function buildForOrder(items: unknown[], cards: unknown[] = [{ id: 'card-1', imageSmallUrl: IMG }]) {
  const cardFindMany = jest.fn(async (_args: unknown) => cards);
  const inventoryFindMany = jest.fn(async () => {
    throw new Error('PROHIBIDO (§5.2.5): el histórico resolvió la imagen vía InventoryItem');
  });
  const { svc, prisma } = buildOrders({
    order: { findUnique: jest.fn(async () => orderRow(items)) },
    card: { findMany: cardFindMany },
    inventoryItem: { findMany: inventoryFindMany, findUnique: inventoryFindMany },
  });
  return { svc, prisma, cardFindMany };
}

describe('IMG-4 — GET /orders/:orderId — PEDIDO HISTÓRICO (la prueba decisiva de QA)', () => {
  it('★ un pedido creado ANTES del arreglo (JSON sin imagen) DEVUELVE miniatura — sin migración ni backfill', async () => {
    const historico = historicOrderItem();
    expect(historico.cardSnapshot).not.toHaveProperty('imageSmallUrl');

    const { svc } = buildForOrder([historico]);
    const res = await svc.getOrder('user-1', 'order-1');

    expect(res.items[0].card.imageSmallUrl).toBe(IMG);
    // Y el JSON persistido NO se tocó: la resolución es en memoria, no un backfill encubierto.
    expect(historico.cardSnapshot).not.toHaveProperty('imageSmallUrl');
  });

  it('los HECHOS congelados se sirven tal cual se escribieron (un re-sync que renombró la carta NO los cambia)', async () => {
    // La fila `Card` de hoy se llama distinto; el acta de compra debe seguir diciendo lo de ayer.
    const { svc } = buildForOrder([historicOrderItem()], [
      { id: 'card-1', imageSmallUrl: IMG, name: 'Charizard ex (renombrada)' },
    ]);
    const { card } = (await svc.getOrder('user-1', 'order-1')).items[0];
    expect(card.name).toBe('Charizard');
    expect(card.setName).toBe('Base Set');
    expect(card.number).toBe('4');
    expect(card.productType).toBe('raw');
    expect(card.rawCondition).toBe('NM');
    expect(card.imageSmallUrl).toBe(IMG);
  });

  it('BATCHEADO, nunca N+1: UNA sola consulta con los `cardId` DISTINTOS del pedido', async () => {
    const items = [
      historicOrderItem({ inventoryItemId: 'inv-1' }),
      historicOrderItem({ inventoryItemId: 'inv-2' }), // mismo cardId ⇒ no se pide dos veces
      historicOrderItem({
        inventoryItemId: 'inv-3',
        cardSnapshot: { cardId: 'card-2', name: 'Blastoise', number: '2', productType: 'raw' },
      }),
    ];
    const { svc, cardFindMany } = buildForOrder(items, [
      { id: 'card-1', imageSmallUrl: IMG },
      { id: 'card-2', imageSmallUrl: 'https://images.pokemontcg.io/base1/2.png' },
    ]);
    const res = await svc.getOrder('user-1', 'order-1');

    expect(cardFindMany).toHaveBeenCalledTimes(1);
    expect(cardFindMany.mock.calls[0][0]).toEqual({
      where: { id: { in: ['card-1', 'card-2'] } },
      select: { id: true, imageSmallUrl: true },
    });
    expect(res.items.map((i) => i.card.imageSmallUrl)).toEqual([
      IMG,
      IMG,
      'https://images.pokemontcg.io/base1/2.png',
    ]);
  });

  it('PROHIBIDO el puente por `inventoryItemId → InventoryItem.card` (§5.2.5)', async () => {
    // El mock de `inventoryItem` revienta si se consulta: la única unión válida es por `cardId`.
    const { svc } = buildForOrder([historicOrderItem()]);
    await expect(svc.getOrder('user-1', 'order-1')).resolves.toBeDefined();
  });

  it('la fila `Card` YA NO EXISTE ⇒ `imageSmallUrl: null` y 200, no un error', async () => {
    const { svc } = buildForOrder([historicOrderItem()], []);
    const { card } = (await svc.getOrder('user-1', 'order-1')).items[0];
    expect(card).toHaveProperty('imageSmallUrl', null);
    expect(card.name).toBe('Charizard'); // los hechos sobreviven a que la carta desaparezca
  });

  it('la columna `Card.imageSmallUrl` en null ⇒ `null` legítimo', async () => {
    const { svc } = buildForOrder([historicOrderItem()], [{ id: 'card-1', imageSmallUrl: null }]);
    expect((await svc.getOrder('user-1', 'order-1')).items[0].card.imageSmallUrl).toBeNull();
  });

  it('un blob VIEJO sin `cardId` no revienta: `null` y CERO consultas de carta', async () => {
    const { svc, cardFindMany } = buildForOrder([
      historicOrderItem({ cardSnapshot: { name: 'Reliquia', number: '1' } }),
    ]);
    const { card } = (await svc.getOrder('user-1', 'order-1')).items[0];
    expect(card).toHaveProperty('imageSmallUrl', null);
    expect(card.name).toBe('Reliquia');
    expect(cardFindMany).not.toHaveBeenCalled();
  });

  it('pedido sin líneas ⇒ ninguna consulta de carta (no se pregunta por la nada)', async () => {
    const { svc, cardFindMany } = buildForOrder([]);
    const res = await svc.getOrder('user-1', 'order-1');
    expect(res.items).toEqual([]);
    expect(cardFindMany).not.toHaveBeenCalled();
  });

  it('MONEY-SAFE: el desglose y el `unitPriceCents` del histórico salen intactos', async () => {
    const { svc } = buildForOrder([historicOrderItem()]);
    const res = await svc.getOrder('user-1', 'order-1');
    expect(res.items[0].unitPriceCents).toBe(25000);
    expect(res.breakdown).toEqual({
      subtotalCents: 25000,
      ivaCents: 4000,
      ivaRatePct: IVA,
      processingFeeCents: 1400,
      totalCents: 30400,
      currency: 'MXN',
    });
    expect(res.status).toBe('settled');
    expect(res.stripePaymentIntentId).toBe('pi_1');
  });

  it('la guardia de propiedad sigue viva: otro usuario ⇒ FORBIDDEN (no se filtra ni la imagen)', async () => {
    const { svc } = buildForOrder([historicOrderItem()]);
    await expect(svc.getOrder('otro-user', 'order-1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

// ---------------------------------------------------------------------------------------------

/**
 * ⛑️ **IMG-5 (I2) — EL GUARDIÁN DEL INVARIANTE «⛔ PROHIBIDO RELLENAR».**
 *
 * ### Por qué existe este bloque
 * QA mutó `toHistoricItemPreviews` para que **rellenara** `name` ausente desde el join —exactamente la
 * salida que ARCHITECTURE §5.2.9 **rechaza**, con el argumento de que «el caso degradado es precisamente
 * donde el dato re-resuelto tiene más probabilidad de ser falso»— y **pasó la suite entera**. La conducta
 * era correcta; lo que faltaba era **alguien que la afirmara**.
 *
 * IMG-4 solo cubre el caso en que el hecho **sí** está en el blob (el test del re-sync: «el acta dice lo
 * de ayer, no lo de hoy»). Nadie afirmaba lo simétrico: que un blob **sin** el hecho produzca una
 * respuesta **sin** el hecho.
 *
 * ### El montaje, y por qué es el montaje correcto
 * La fila `Card` de la BD trae la identidad **COMPLETA** (`name`, `number`, `productType`, `setName`) y el
 * blob NO. Ése es el punto exacto: **la carta existe, tiene nombre, y aun así el pedido histórico no debe
 * mostrarlo**. Si algún día el hecho ausente aparece en la respuesta, solo pudo salir del catálogo de hoy
 * — que es un dato **inventado presentado como probatorio** dentro de un registro dinero-adyacente
 * (contrato §4 «Tolerancia del histórico», punto 2; §5.2.9 motivo 2).
 *
 * Las aserciones son sobre **lo que sale por el cable** (`Object.keys` del `card` servido), no sobre el
 * cuerpo de una función: así el guardián caza el relleno **venga por donde venga** —ensanchando
 * `CARD_IMAGE_SELECT`, tocando `loadCardsForSnapshots`, o en el `map` de la proyección—.
 */
describe('IMG-5 — ⛔ el histórico NO RELLENA un hecho ausente (§5.2.9 / contrato §4, punto 2)', () => {
  /** La tabla `Card` de HOY, con la identidad entera: todo lo que un relleno tendría a mano. */
  const CARD_ROW_COMPLETA = {
    id: 'card-1',
    imageSmallUrl: IMG,
    name: 'Charizard',
    number: '4',
    productType: 'raw',
    setName: 'Base Set',
    set: { name: 'Base Set' },
  };

  /** Un `OrderItem` histórico al que le FALTA un hecho, con la fila `Card` completa detrás. */
  function sinHecho(...claves: string[]) {
    const item = historicOrderItem();
    for (const k of claves) delete (item.cardSnapshot as Record<string, unknown>)[k];
    return item;
  }

  async function cardServido(item: unknown, cards: unknown[] = [CARD_ROW_COMPLETA]) {
    const { svc } = buildForOrder([item], cards);
    const res = await svc.getOrder('user-1', 'order-1');
    return res.items[0].card as Record<string, unknown>;
  }

  it.each([...FROZEN_CARD_FACT_KEYS])(
    '★ blob SIN `%s` ⇒ la respuesta NO trae ese hecho, aunque la fila `Card` exista en la BD con él',
    async (clave: string) => {
      const item = sinHecho(clave);
      expect(item.cardSnapshot).not.toHaveProperty(clave);

      const card = await cardServido(item);

      expect(Object.prototype.hasOwnProperty.call(card, clave)).toBe(false);
      expect(card).not.toHaveProperty(clave);
      // Y la ausencia NO se disfraza de otro valor (§5.2.9: «ninguna degrada jamás a *otro valor*»).
      expect(card[clave]).toBeUndefined();
    },
  );

  it('el montaje es honesto: la fila `Card` de la BD SÍ trae la identidad que el blob perdió', () => {
    // Sin esto, los ocho casos de arriba podrían pasar por no haber de dónde rellenar.
    for (const clave of ['name', 'number', 'productType', 'setName']) {
      expect(CARD_ROW_COMPLETA).toHaveProperty(clave);
    }
  });

  it('★ el hecho ausente NO reaparece ni siquiera cuando el join SÍ resuelve la imagen', async () => {
    const card = await cardServido(sinHecho('name', 'number', 'productType', 'setName'));
    // La clase (P) resolvió (hay miniatura) y la clase (F) siguió ausente: son caminos distintos.
    expect(card.imageSmallUrl).toBe(IMG);
    expect(Object.keys(card).sort()).toEqual([
      'cardId',
      'gradeValue',
      'gradingCompany',
      'imageSmallUrl',
      'rawCondition',
    ]);
  });

  it('★ blob `{}` ⇒ `card` es EXACTAMENTE `{ imageSmallUrl: null }`, y responde 200 (contrato §4, punto 1)', async () => {
    const card = await cardServido(historicOrderItem({ cardSnapshot: {} }));
    expect(card).toEqual({ imageSmallUrl: null });
    expect(Object.keys(card)).toEqual(['imageSmallUrl']);
  });

  it('★ blob `{ cardId }` solo ⇒ imagen SÍ (clase P), los otros siete hechos NO (clase F)', async () => {
    const card = await cardServido(historicOrderItem({ cardSnapshot: { cardId: 'card-1' } }));
    // El join encontró la carta —con nombre, número y set— y aun así el acta sigue sin decirlos.
    expect(card).toEqual({ cardId: 'card-1', imageSmallUrl: IMG });
    expect(Object.keys(card).sort()).toEqual(['cardId', 'imageSmallUrl']);
  });

  it('blob nulo o no-objeto ⇒ `card` solo con `imageSmallUrl: null`, nunca hechos inventados', async () => {
    for (const blob of [null, undefined, 'no soy un objeto', 42, [1, 2]]) {
      const card = await cardServido(historicOrderItem({ cardSnapshot: blob }));
      expect(card).toEqual({ imageSmallUrl: null });
    }
  });

  it('la ASIMETRÍA de §5.2.9, en una sola respuesta: (P) degrada a `null`; (F) degrada a AUSENTE', async () => {
    // Sin `name` en el blob y sin fila `Card` en la BD.
    const card = await cardServido(sinHecho('name'), []);
    expect(card).toHaveProperty('imageSmallUrl', null); // (P): clave PRESENTE con valor `null`
    expect(card).not.toHaveProperty('name'); // (F): clave OMITIDA
  });

  it('MONEY-SAFE: un blob vacío no mueve ni un centavo (el dinero no vive en el JSON, §4 punto 5)', async () => {
    const { svc } = buildForOrder([historicOrderItem({ cardSnapshot: {} })], [CARD_ROW_COMPLETA]);
    const res = await svc.getOrder('user-1', 'order-1');
    expect(res.items[0].unitPriceCents).toBe(25000);
    expect(res.breakdown).toEqual({
      subtotalCents: 25000,
      ivaCents: 4000,
      ivaRatePct: IVA,
      processingFeeCents: 1400,
      totalCents: 30400,
      currency: 'MXN',
    });
  });

  it('a nivel de LECTOR: `readFrozenCardFacts` no crea claves que el blob no traía', () => {
    expect(readFrozenCardFacts({ cardId: 'card-1' })).toEqual({ cardId: 'card-1' });
    expect(Object.keys(readFrozenCardFacts({}))).toEqual([]);
    // `null` explícito se CONSERVA (≠ ausente, §5.2.9 / T-4): no se poda ni se convierte en omisión.
    expect(readFrozenCardFacts({ rawCondition: null })).toEqual({ rawCondition: null });
    expect(
      Object.prototype.hasOwnProperty.call(readFrozenCardFacts({ rawCondition: null }), 'rawCondition'),
    ).toBe(true);
  });
});

/**
 * ⛑️ **IMG-6 (I1) — el blob de la BD NO sale al cable VERBATIM: allowlist de los OCHO hechos.**
 *
 * `readFrozenCardFacts` hacía `return value as PersistedCardFacts`: **lo que hubiera en la columna `Json`
 * se servía tal cual**. Hoy no fugaba nada porque el write path escribe exactamente ocho claves — pero era
 * un passthrough sin filtro desde un registro **dinero-adyacente** hacia una respuesta HTTP cuya forma
 * fija el contrato §4.
 *
 * **Un `pick` NO es «rellenar»** (nota doctrinal de QA, y §5.2.2 la respalda): la doctrina prohíbe
 * **completar lo ausente**, no **proyectar lo presente**. Filtrar refuerza el invariante de IMG-5.
 *
 * **Allowlist, jamás `omit`:** un `omit` de lo conocido falla **abierto** ante una clave nueva; la
 * allowlist falla **cerrada**. El último test de este bloque es justo esa diferencia.
 */
describe('IMG-6 — la columna `Json` se PROYECTA por allowlist, no se sirve verbatim', () => {
  const BLOB_SUCIO = {
    cardId: 'card-1',
    name: 'Charizard',
    setName: 'Base Set',
    number: '4',
    productType: 'raw',
    rawCondition: 'NM',
    gradingCompany: null,
    gradeValue: null,
    // Ruido que el contrato §4 NO declara y que jamás debe cruzar la frontera HTTP:
    internalCostCents: 999,
    __note: 'nota interna',
    imageSmallUrl: 'https://cdn.muerto/404.png',
    supplierId: 'prov-7',
  };

  it('la allowlist son EXACTAMENTE los ocho hechos congelados, sin claves de más ni de menos', () => {
    expect([...FROZEN_CARD_FACT_KEYS].sort()).toEqual([
      'cardId',
      'gradeValue',
      'gradingCompany',
      'name',
      'number',
      'productType',
      'rawCondition',
      'setName',
    ]);
  });

  it('★ el lector descarta lo que no está en la allowlist (costo interno, notas, proveedor…)', () => {
    const facts = readFrozenCardFacts(BLOB_SUCIO) as Record<string, unknown>;
    expect(Object.keys(facts).sort()).toEqual([...FROZEN_CARD_FACT_KEYS].sort());
    expect(facts).not.toHaveProperty('internalCostCents');
    expect(facts).not.toHaveProperty('__note');
    expect(facts).not.toHaveProperty('supplierId');
  });

  it('★ el `card` SERVIDO por GET /orders/:orderId no filtra el ruido de la columna', async () => {
    const { svc } = buildForOrder([historicOrderItem({ cardSnapshot: BLOB_SUCIO })]);
    const { card } = (await svc.getOrder('user-1', 'order-1')).items[0];
    expect(Object.keys(card).sort()).toEqual([
      'cardId',
      'gradeValue',
      'gradingCompany',
      'imageSmallUrl',
      'name',
      'number',
      'productType',
      'rawCondition',
      'setName',
    ]);
    const serializado = JSON.stringify(card);
    expect(serializado).not.toContain('internalCostCents');
    expect(serializado).not.toContain('nota interna');
    expect(serializado).not.toContain('prov-7');
    // Y la `imageSmallUrl` podrida del blob no gana: la clase (P) siempre sale del join (§5.2.5).
    expect(card.imageSmallUrl).toBe(IMG);
  });

  it('la proyección NO altera los valores de los hechos que sí pasan (proyectar ≠ transformar)', () => {
    const facts = readFrozenCardFacts(BLOB_SUCIO);
    expect(facts).toEqual({
      cardId: 'card-1',
      name: 'Charizard',
      setName: 'Base Set',
      number: '4',
      productType: 'raw',
      rawCondition: 'NM',
      gradingCompany: null,
      gradeValue: null,
    });
  });

  it('★ falla CERRADA: una clave NUEVA e imprevista tampoco pasa (lo que un `omit` no daría)', () => {
    const futuro = { cardId: 'card-1', campoQueNadieHaInventadoAun: 'secreto', pii_email: 'a@b.c' };
    expect(readFrozenCardFacts(futuro)).toEqual({ cardId: 'card-1' });
  });

  it('MONEY-SAFE: el filtro no toca importes — no hay importes en el blob, y sigue sin haberlos', async () => {
    const { svc } = buildForOrder([historicOrderItem({ cardSnapshot: BLOB_SUCIO })]);
    const res = await svc.getOrder('user-1', 'order-1');
    expect(res.items[0].unitPriceCents).toBe(25000);
    expect(res.breakdown.totalCents).toBe(30400);
  });
});

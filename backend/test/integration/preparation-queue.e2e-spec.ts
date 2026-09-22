/**
 * preparation-queue.e2e-spec.ts — **`GET /admin/shipments/picking-list` («Pedidos a preparar»)
 * contra Postgres REAL.** API_CONTRACT §M4-PREP (v1.78.2).
 *
 * ## Por qué existe: es la causa raíz de `B-1`, no su parche
 *
 * `B-1` (bloqueante de QA) fue que el backend servía `fullName: ""` y `"   "`, que v1.78.1 prohíbe.
 * Llegó verde con **69 pruebas unitarias del mismo DTO delante**. El motivo, medido:
 * `grep -rn "fullName" backend/test/integration/` daba **0 aciertos** — **toda** la cobertura del
 * `PreparationOrderDTO` era unitaria **con Prisma mockeado**, y un mock devuelve exactamente lo que
 * el que lo escribió imaginó. *Nadie imagina un `""`; la base sí lo produce.*
 *
 * Aquí el `addressSnapshot` es una columna `Json` real, el `User.name` una fila real y el
 * `VaultLocation.label` un `varchar` real. La diferencia no es de rigor sino de **procedencia del
 * dato**: estas filas entran por la misma puerta por la que entran las de producción
 * (`guest-checkout.dto.ts` valida `recipientName` con `@IsString() @MaxLength(120)` **sin
 * `@IsNotEmpty()`**; `auth.dto.ts` valida `name` con `@MinLength(1)` **sin `trim`**), así que el
 * `""` que este fichero siembra **no es sintético: es el que el sistema ya sabe aceptar**.
 *
 * ⛔ **No duplica la suite unitaria.** Lo unitario mide la PROYECCIÓN (precedencias, órdenes,
 * derivaciones) sobre entradas que yo elijo; esto mide lo que **sale por HTTP** de una fila que la
 * base aceptó, con el guard, el pipe y el serializador puestos.
 *
 * ## Higiene de la BD compartida
 * Todo lo que siembra lleva la marca `M4P-` (en `carrier`, `folio`, `orderNumber` y el correo del
 * usuario) y se barre **antes** de crear y **después** de la suite: la BD de integración se comparte
 * entre specs y una fila de este fichero que sobreviva cambia la cola que mide otro.
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

const MARCA = 'M4P-';

/** El snapshot COMPLETO de 9 campos (v1.67). */
const SNAPSHOT_9 = {
  recipientName: 'Ana María López Pérez',
  line1: 'Av. Insurgentes Sur 1234',
  line2: 'Depto 5B',
  neighborhood: 'Del Valle',
  city: 'Ciudad de México',
  state: 'CDMX',
  postalCode: '03100',
  country: 'MX',
  phone: '+525512345678',
};

type Fila = { data: unknown[] };
type Prep = {
  shipmentId: string;
  orderId: string | null;
  orderNumber: string | null;
  destination: string;
  requestedAt: string;
  customer: { fullName: string | null; lastName: string | null };
  shipTo?: Record<string, string | null>;
  items: {
    shipmentItemId: string;
    inventoryItemId: string;
    folio: string;
    quantity: number;
    card: {
      name: string;
      setName: string | null;
      finish: string;
      conditionLabel: string;
      imageSmallUrl: string | null;
    };
    currentLocation: { kind: 'assigned'; label: string } | { kind: 'unassigned' };
  }[];
};

describe('E2E — «Pedidos a preparar» (§M4-PREP) contra Postgres real', () => {
  let h: E2EHarness;
  let adminToken: string;
  let cardId: string;
  let clienteId: string;

  const cola = async (qs = ''): Promise<{ status: number; body: Fila; text: string }> =>
    h.api('GET', `/admin/shipments/picking-list${qs}`, { token: adminToken }) as any;

  /** Solo las filas de ESTE fichero: la BD se comparte y otras suites dejan envíos en `picking`. */
  const mias = (body: Fila): Prep[] =>
    (body.data as Prep[]).filter((p) => p.items.some((i) => i.folio.startsWith(MARCA)));

  async function limpiar(): Promise<void> {
    await h.prisma.shipmentItem.deleteMany({
      where: { inventoryItem: { folio: { startsWith: MARCA } } },
    });
    await h.prisma.shipmentRequest.deleteMany({ where: { carrier: { startsWith: MARCA } } });
    await h.prisma.inventoryItem.deleteMany({ where: { folio: { startsWith: MARCA } } });
    await h.prisma.vaultLocation.deleteMany({ where: { box: { startsWith: MARCA } } });
    await h.prisma.user.deleteMany({ where: { email: { startsWith: 'm4p-' } } });
  }

  /** Una pieza `picking` con su carta; `label` null ⇒ sin ubicación. */
  async function pieza(folio: string, label: string | null): Promise<string> {
    const locationId =
      label === null
        ? null
        : (
            await h.prisma.vaultLocation.create({
              data: { zone: 'platform_stock', box: `${MARCA}${folio}`, row: '1', slot: '1', label },
            })
          ).id;
    const it = await h.prisma.inventoryItem.create({
      data: {
        folio: `${MARCA}${folio}`,
        cardId,
        productType: 'raw',
        rawCondition: 'NM',
        status: 'picking',
        ownerType: 'platform',
        acquisitionType: 'compra',
        ...(locationId ? { locationId } : {}),
      },
    });
    return it.id;
  }

  async function envio(opts: {
    carrier: string;
    userId?: string | null;
    snapshot: Record<string, unknown>;
    itemIds: string[];
    requestedAt?: Date;
  }): Promise<string> {
    const s = await h.prisma.shipmentRequest.create({
      data: {
        userId: opts.userId ?? null,
        addressSnapshot: opts.snapshot as never,
        status: 'picking',
        shippingFeeCents: 9_900,
        priceConvention: 'IVA_EXCLUSIVE',
        carrier: `${MARCA}${opts.carrier}`,
        ...(opts.requestedAt ? { requestedAt: opts.requestedAt } : {}),
        items: { create: opts.itemIds.map((id) => ({ inventoryItemId: id })) },
      },
    });
    return s.id;
  }

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    const card = await h.prisma.card.findFirstOrThrow({ select: { id: true } });
    cardId = card.id;
    const cliente = await h.prisma.user.findFirstOrThrow({
      where: { email: E2E_USERS.customer.email },
      select: { id: true },
    });
    clienteId = cliente.id;
    await limpiar();
  }, 120000);

  afterAll(async () => {
    if (h) await limpiar();
    await h?.close();
  });

  // ------------------------------------------------------------------ forma del DTO

  describe('la forma del `PreparationOrderDTO` sale por el cable', () => {
    let shipmentId: string;

    beforeAll(async () => {
      const a = await pieza('FORMA-1', 'M4P-C01-F01-S01');
      const b = await pieza('FORMA-2', null);
      shipmentId = await envio({
        carrier: 'forma',
        userId: clienteId,
        snapshot: SNAPSHOT_9,
        itemIds: [a, b],
      });
    }, 60000);

    afterAll(async () => {
      await h.prisma.shipmentItem.deleteMany({ where: { shipmentRequestId: shipmentId } });
      await h.prisma.shipmentRequest.deleteMany({ where: { id: shipmentId } });
    });

    it('un elemento = UN pedido, con sus DOS cartas dentro', async () => {
      const res = await cola();
      expect(res.status).toBe(200);
      const p = mias(res.body).find((x) => x.shipmentId === shipmentId)!;
      expect(p).toBeDefined();
      expect(p.items).toHaveLength(2);
      // ⛔ La forma vieja (plana) no vuelve: el folio vive DENTRO de la carta.
      expect(p).not.toHaveProperty('folio');
      expect(p).not.toHaveProperty('location');
    });

    it('destino, cliente y dirección completa (CA #6: CON la calle)', async () => {
      const p = mias((await cola()).body).find((x) => x.shipmentId === shipmentId)!;
      expect(p.destination).toBe('ship');
      expect(p.orderId).toBeNull();
      expect(p.orderNumber).toBeNull();
      expect(p.customer.fullName).toBe(E2E_USERS.customer.name);
      expect(p.shipTo).toEqual(SNAPSHOT_9);
    });

    it('la carta trae identidad, `quantity` 1 y `currentLocation` como `LocationView`', async () => {
      const p = mias((await cola()).body).find((x) => x.shipmentId === shipmentId)!;
      expect(p.items.map((i) => i.quantity)).toEqual([1, 1]);
      expect(p.items[0].card.conditionLabel).toBe('NM');
      expect(p.items[0].currentLocation).toEqual({
        kind: 'assigned',
        label: 'M4P-C01-F01-S01',
      });
      // Orden dentro del pedido: asignadas primero, `unassigned` al final.
      expect(p.items[1].currentLocation).toEqual({ kind: 'unassigned' });
      // ⛔ CA #11: el código `"UNASSIGNED"` no viaja.
      expect(JSON.stringify(p)).not.toContain('UNASSIGNED');
    });
  });

  // ------------------------------------------------------------------ `B-1` contra la BD real

  /**
   * ⭐⭐ **`B-1` — el `""` que un mock no produce y la base sí.**
   *
   * Cada fila entra por Prisma con el blanco YA dentro de la columna, igual que entraría por el
   * checkout de invitado (`recipientName: ""` pasa su DTO) o por el registro (`name: "   "` pasa el
   * suyo). Si `nullIfBlank` desapareciera, esto sale rojo **aunque las 69 unitarias sigan verdes**.
   */
  describe('`B-1` — la ausencia se sirve `null`, aunque la COLUMNA tenga `""`', () => {
    let invitadoVacio: string;
    let invitadoEspacios: string;
    let conCuentaBlanca: string;
    let catalogoBlanco: string;
    let usuarioBlancoId: string;
    let setBlancoId: string;
    let cardBlancaId: string;

    beforeAll(async () => {
      const usuarioBlanco = await h.prisma.user.create({
        data: {
          email: `m4p-blanco-${Date.now().toString(36)}@e2e.local`,
          // ⚠️ `"   "` pasa `@IsString() @MinLength(1)` de `auth.dto.ts` (sin `trim`): esta fila NO
          // es sintética, es la que el registro de hoy sabe aceptar.
          name: '   ',
          passwordHash: 'x',
          role: 'customer',
        },
      });
      usuarioBlancoId = usuarioBlanco.id;

      invitadoVacio = await envio({
        carrier: 'b1-vacio',
        userId: null,
        // `recipientName: ""` pasa `@IsString() @MaxLength(120)` de `guest-checkout.dto.ts`.
        snapshot: { ...SNAPSHOT_9, recipientName: '', line2: '', neighborhood: '' },
        itemIds: [await pieza('B1-A', 'M4P-C02-F01-S01')],
      });
      invitadoEspacios = await envio({
        carrier: 'b1-espacios',
        userId: null,
        snapshot: { ...SNAPSHOT_9, recipientName: '   ' },
        itemIds: [await pieza('B1-B', 'M4P-C02-F01-S02')],
      });
      conCuentaBlanca = await envio({
        carrier: 'b1-cuenta',
        userId: usuarioBlancoId,
        snapshot: SNAPSHOT_9,
        itemIds: [await pieza('B1-C', 'M4P-C02-F01-S03')],
      });

      // ⭐ El CATÁLOGO en blanco: `CardSet.name`, `Card.imageSmallUrl` y `VaultLocation.label`
      //    vacíos **en la columna**. Sin esto, mutar `setName` o el `label` pasa la integración en
      //    verde — y ése fue exactamente el modo de fallo de `B-1`: un fixture que no produce el
      //    blanco no puede medir quién lo normaliza.
      const setBlanco = await h.prisma.cardSet.create({
        data: { externalId: `${MARCA}set-blanco`, name: '   ', series: 'M4P' },
      });
      setBlancoId = setBlanco.id;
      const cardBlanca = await h.prisma.card.create({
        data: {
          externalId: `${MARCA}card-blanca`,
          setId: setBlanco.id,
          name: 'M4P Carta de catálogo en blanco',
          number: '1',
          imageSmallUrl: '  ',
        },
      });
      cardBlancaId = cardBlanca.id;
      const locBlanca = await h.prisma.vaultLocation.create({
        data: { zone: 'platform_stock', box: `${MARCA}loc-blanca`, row: '1', slot: '1', label: '  ' },
      });
      const piezaBlanca = await h.prisma.inventoryItem.create({
        data: {
          folio: `${MARCA}B1-CAT`,
          cardId: cardBlanca.id,
          productType: 'raw',
          rawCondition: 'NM',
          status: 'picking',
          ownerType: 'platform',
          acquisitionType: 'compra',
          locationId: locBlanca.id,
        },
      });
      catalogoBlanco = await envio({
        carrier: 'b1-catalogo',
        userId: clienteId,
        snapshot: SNAPSHOT_9,
        itemIds: [piezaBlanca.id],
      });
    }, 60000);

    afterAll(async () => {
      const ids = [invitadoVacio, invitadoEspacios, conCuentaBlanca, catalogoBlanco];
      await h.prisma.shipmentItem.deleteMany({ where: { shipmentRequestId: { in: ids } } });
      await h.prisma.shipmentRequest.deleteMany({ where: { id: { in: ids } } });
      await h.prisma.user.deleteMany({ where: { id: usuarioBlancoId } });
      await h.prisma.inventoryItem.deleteMany({ where: { cardId: cardBlancaId } });
      await h.prisma.card.deleteMany({ where: { id: cardBlancaId } });
      await h.prisma.cardSet.deleteMany({ where: { id: setBlancoId } });
    });

    it('`recipientName = ""` en la columna ⇒ `fullName` y `shipTo.recipientName` NULL', async () => {
      const p = mias((await cola()).body).find((x) => x.shipmentId === invitadoVacio)!;
      expect(p).toBeDefined();
      expect(p.customer.fullName).toBeNull();
      expect(p.customer.lastName).toBeNull();
      expect(p.shipTo!.recipientName).toBeNull();
      expect(p.shipTo!.line2).toBeNull();
      expect(p.shipTo!.neighborhood).toBeNull();
    });

    it('`recipientName = "   "` ⇒ lo mismo: una grafía, no tres', async () => {
      const p = mias((await cola()).body).find((x) => x.shipmentId === invitadoEspacios)!;
      expect(p.customer.fullName).toBeNull();
      expect(p.shipTo!.recipientName).toBeNull();
    });

    it('`User.name = "   "` ⇒ `fullName` NULL, y ⛔ NO se rellena con el destinatario', async () => {
      const p = mias((await cola()).body).find((x) => x.shipmentId === conCuentaBlanca)!;
      expect(p.customer.fullName).toBeNull();
      // El destinatario del snapshot SIGUE ahí: lo que no ocurre es que se use como nombre del
      // cliente. Rellenar con él inventaría una atribución.
      expect(p.shipTo!.recipientName).toBe(SNAPSHOT_9.recipientName);
    });

    it('⭐ catálogo en blanco EN LA COLUMNA ⇒ `setName`, `imageSmallUrl` y `label` NULL/ausentes', async () => {
      const p = mias((await cola()).body).find((x) => x.shipmentId === catalogoBlanco)!;
      expect(p).toBeDefined();
      // `CardSet.name = "   "` — el campo donde la mutación `?? ""` sobrevivía a 5611 unitarias.
      expect(p.items[0].card.setName).toBeNull();
      expect(p.items[0].card.imageSmallUrl).toBeNull();
      // ⭐ v1.78.2 — `VaultLocation.label = "  "` ⇒ `unassigned`: la hoja contesta «¿hay sitio al
      // que caminar?», y una etiqueta en blanco responde que no igual que la ausencia de fila.
      expect(p.items[0].currentLocation).toEqual({ kind: 'unassigned' });
    });

    it('⭐ NINGÚN campo nullable del DTO sale en blanco por el cable (censo sobre la respuesta real)', async () => {
      const filas = mias((await cola()).body);
      expect(filas.length).toBeGreaterThan(0);
      const nullables = (p: Prep): [string, unknown][] => [
        ['orderNumber', p.orderNumber],
        ['customer.fullName', p.customer.fullName],
        ['customer.lastName', p.customer.lastName],
        ['shipTo.recipientName', p.shipTo?.recipientName],
        ['shipTo.line2', p.shipTo?.line2],
        ['shipTo.neighborhood', p.shipTo?.neighborhood],
        ...p.items.flatMap((i, n): [string, unknown][] => [
          [`items[${n}].card.setName`, i.card.setName],
          [`items[${n}].card.imageSmallUrl`, i.card.imageSmallUrl],
          [
            `items[${n}].currentLocation.label`,
            i.currentLocation.kind === 'assigned' ? i.currentLocation.label : undefined,
          ],
        ]),
      ];
      const enBlanco = filas.flatMap((p) =>
        nullables(p)
          .filter(([, v]) => typeof v === 'string' && v.trim() === '')
          .map(([k]) => `${p.shipmentId}::${k}`),
      );
      expect(enBlanco).toEqual([]);
    });
  });

  // ------------------------------------------------------------------ filtros, por HTTP

  describe('filtros (§0-Q) — medidos por HTTP, con el pipe y el guard puestos', () => {
    let viejo: string;
    let nuevo: string;

    beforeAll(async () => {
      viejo = await envio({
        carrier: 'orden-viejo',
        userId: clienteId,
        snapshot: SNAPSHOT_9,
        itemIds: [await pieza('ORD-A', 'M4P-C03-F01-S01')],
        requestedAt: new Date('2020-01-02T10:00:00.000Z'),
      });
      nuevo = await envio({
        carrier: 'orden-nuevo',
        userId: clienteId,
        snapshot: SNAPSHOT_9,
        itemIds: [await pieza('ORD-B', 'M4P-C03-F01-S02')],
        requestedAt: new Date('2020-01-03T10:00:00.000Z'),
      });
    }, 60000);

    afterAll(async () => {
      const ids = [viejo, nuevo];
      await h.prisma.shipmentItem.deleteMany({ where: { shipmentRequestId: { in: ids } } });
      await h.prisma.shipmentRequest.deleteMany({ where: { id: { in: ids } } });
    });

    it('CA #9 — el orden por `requestedAt` asc lo produce el BACKEND, no el cliente', async () => {
      const ids = mias((await cola()).body).map((p) => p.shipmentId);
      expect(ids.indexOf(viejo)).toBeLessThan(ids.indexOf(nuevo));
      expect(ids.indexOf(viejo)).toBeGreaterThanOrEqual(0);
    });

    it('`?destination=ship` devuelve filas; `?destination=vault` devuelve VACÍO (cubeta sin datos)', async () => {
      const ship = await cola('?destination=ship');
      expect(ship.status).toBe(200);
      expect(mias(ship.body).length).toBeGreaterThan(0);
      const vault = await cola('?destination=vault');
      expect(vault.status).toBe(200);
      expect(vault.body.data).toEqual([]);
    });

    it('`?destination=basura` ⇒ 400 con el `details` exacto', async () => {
      const res: any = await cola('?destination=basura');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual({
        field: 'destination',
        allowed: ['vault', 'ship'],
      });
    });

    it('`?date=` acota al día; y `?date=` vacío ≡ ausente', async () => {
      const dia = await cola('?date=2020-01-02');
      expect(dia.status).toBe(200);
      const ids = mias(dia.body).map((p) => p.shipmentId);
      expect(ids).toContain(viejo);
      expect(ids).not.toContain(nuevo);
      const vacio = await cola('?date=');
      expect(vacio.status).toBe(200);
      expect(mias(vacio.body).map((p) => p.shipmentId)).toEqual(
        expect.arrayContaining([viejo, nuevo]),
      );
    });

    it('⭐ `I-1` + v1.78.2 — `?date=` fuera de la gramática date-only ⇒ **400**, ⛔ ya NO `500`', async () => {
      // ⚠️ `2026-02-30` y `2026-09-20T14:30:00Z` son los dos que un `Number.isNaN` a secas DEJARÍA
      //    pasar con `200`: el primero desborda al 2 de marzo, el segundo abre la ventana deslizante.
      for (const malo of ['banana', '2026-13-45', '2026-02-30', '2026-09-20T14:30:00Z']) {
        const res: any = await cola(`?date=${malo}`);
        expect([malo, res.status]).toEqual([malo, 400]);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(res.body.error.details.field).toBe('date');
        // ⛔ Y sin eco del valor del cliente (§0-Q punto 2, la cota de `P-89`).
        expect(res.body.error.details.value).toBeUndefined();
      }
    });
  });

  // ------------------------------------------------------------------ el guard, de verdad

  it('el guard sigue siendo el de siempre: sin sesión ⇒ 401', async () => {
    const res: any = await h.api('GET', '/admin/shipments/picking-list');
    expect([401, 403]).toContain(res.status);
  });
});

import { NameSource, PreparationItemStatus } from '@prisma/client';
import { E2EHarness } from './e2e-app';
import { E2E_FOLIOS, E2E_USERS } from '../../../prisma/e2e-fixtures';
import { diferida } from './row-lock-barrier';
import { VAULT_GATE_NAMESPACE } from '../../../src/modules/vault/vault-placement.rules';

/**
 * vault-placement-db.ts — fixtures de COLOCACIÓN en bóveda contra Postgres real (API_CONTRACT
 * §M4-VAULT). Propiedad: backend. Siembra directo en la BD la fila que la liquidación `vault` crea
 * (§M4-VAULT.2-bis: orden `settled` + piezas `in_custody` del cliente en el estante de tienda +
 * `VaultPlacement pending` + una `VaultPlacementItem` por carta) — el nacimiento por webhook ya lo
 * prueba `vault-placement-birth.e2e-spec.ts`; aquí interesa lo que viene DESPUÉS.
 *
 * Todo lo creado se registra y `limpiar()` lo borra en orden de FK (las relaciones de M-59 son
 * `Restrict`). Cada ejecución usa un prefijo propio (`RUN`), así que dos corridas no se pisan.
 */
export class VaultPlacementDb {
  readonly users: string[] = [];
  readonly orders: string[] = [];
  readonly items: string[] = [];
  readonly locations: string[] = [];
  readonly shipments: string[] = [];
  private seq = 0;
  private template!: { cardId: string; setId: string; shopLocationId: string };
  private passwordHash!: string | null;
  operatorId!: string;
  adminId!: string;
  opToken!: string;
  adminToken!: string;

  constructor(
    readonly h: E2EHarness,
    readonly run: string,
  ) {}

  async init(): Promise<void> {
    const base = await this.h.prisma.inventoryItem.findUniqueOrThrow({
      where: { folio: E2E_FOLIOS.listedCharizard },
      select: { cardId: true, locationId: true, card: { select: { setId: true } } },
    });
    const shop = await this.h.prisma.vaultLocation.findUniqueOrThrow({ where: { id: base.locationId! } });
    if (shop.zone !== 'platform_stock') throw new Error('el estante plantilla no es platform_stock');
    this.template = { cardId: base.cardId, setId: base.card.setId, shopLocationId: shop.id };
    this.passwordHash = (
      await this.h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.customer.email } })
    ).passwordHash;
    this.operatorId = (
      await this.h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.operator.email } })
    ).id;
    this.adminId = (await this.h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.admin.email } })).id;
    this.opToken = await this.h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    this.adminToken = await this.h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
  }

  get cardId() {
    return this.template.cardId;
  }
  get setId() {
    return this.template.setId;
  }
  get shopLocationId() {
    return this.template.shopLocationId;
  }

  private next() {
    this.seq += 1;
    return this.seq;
  }

  /** Cliente (la contraseña es la del cliente del fixture: `E2E_USERS.customer.password`). */
  async mkUser(name: string, nameSource: NameSource = 'user', emailLocal?: string) {
    const k = this.next();
    const u = await this.h.prisma.user.create({
      data: {
        email: `${emailLocal ?? 'vpv'}.${this.run}.${k}@e2e.local`,
        passwordHash: this.passwordHash,
        name,
        nameSource,
        role: 'customer',
        emailVerified: true,
      },
    });
    this.users.push(u.id);
    return u;
  }

  /** Un cajón de `customer_custody` (o de la zona pedida), etiqueta única por corrida. */
  async mkDrawer(opts: { zone?: 'customer_custody' | 'platform_stock'; isActive?: boolean } = {}) {
    const k = this.next();
    const box = `VPV${this.run}${k}`.toUpperCase().slice(-20);
    const loc = await this.h.prisma.vaultLocation.create({
      data: {
        zone: opts.zone ?? 'customer_custody',
        box,
        row: 'F01',
        slot: 'S01',
        label: `${box}-F01-S01`,
        isActive: opts.isActive ?? true,
      },
    });
    this.locations.push(loc.id);
    return loc;
  }

  /** Piezas del cliente YA en custodia en un cajón (una colocación anterior, o sembradas). */
  async seedInDrawer(userId: string, locationId: string | null, n = 1) {
    const out = [];
    for (let i = 0; i < n; i += 1) out.push(await this.mkPiece(userId, locationId));
    return out;
  }

  async mkPiece(
    userId: string | null,
    locationId: string | null,
    over: Partial<{ status: string; ownershipStatus: string | null; ownerType: string }> = {},
  ) {
    const k = this.next();
    const it = await this.h.prisma.inventoryItem.create({
      data: {
        folio: `VPV-${this.run}-${String(k).padStart(4, '0')}`,
        cardId: this.template.cardId,
        productType: 'raw',
        rawCondition: 'NM',
        finish: 'normal',
        acquisitionType: 'compra',
        acquisitionCostCents: 1000,
        locationId,
        status: (over.status ?? 'in_custody') as any,
        ownerType: (over.ownerType ?? (userId ? 'customer' : 'platform')) as any,
        ownerUserId: userId,
        ownershipStatus: (over.ownershipStatus === undefined
          ? userId
            ? 'settled'
            : null
          : over.ownershipStatus) as any,
      },
    });
    this.items.push(it.id);
    return it;
  }

  /**
   * La colocación que la liquidación `vault` deja: orden `settled`, `n` piezas del cliente en el
   * estante de tienda (o `pieceLocationId`), `VaultPlacement pending` + una fila por carta.
   * `marks` da el `prepStatus` de cada carta (en orden de folio); `prepared` sella la preparación.
   */
  async mkPlacement(
    userId: string,
    n: number,
    opts: {
      marks?: PreparationItemStatus[];
      prepared?: boolean;
      pieceLocationId?: string | null;
      createdAt?: Date;
      fulfillmentMode?: 'vault' | 'direct_ship';
    } = {},
  ) {
    const k = this.next();
    const now = opts.createdAt ?? new Date();
    const order = await this.h.prisma.order.create({
      data: {
        userId,
        fulfillmentMode: opts.fulfillmentMode ?? 'vault',
        orderNumber: `VPV-${this.run}-${k}`,
        status: 'settled',
        settledAt: now,
        subtotalCents: 100,
        processingFeeCents: 0,
        ivaCents: 0,
        totalCents: 100,
        priceConvention: 'IVA_INCLUSIVE',
        // `Order_direct_ship_has_address_chk`: solo para sembrar la fila CORRUPTA de la invariante.
        ...(opts.fulfillmentMode === 'direct_ship' ? { shippingAddressSnapshot: { line1: 'x' } } : {}),
      },
    });
    this.orders.push(order.id);
    const pieces = [];
    for (let i = 0; i < n; i += 1) {
      const loc = opts.pieceLocationId === undefined ? this.template.shopLocationId : opts.pieceLocationId;
      pieces.push(await this.mkPiece(userId, loc));
    }
    const orderItems = [];
    for (const p of pieces) {
      orderItems.push(
        await this.h.prisma.orderItem.create({
          data: { orderId: order.id, inventoryItemId: p.id, cardSnapshot: {}, unitPriceCents: 1 },
        }),
      );
    }
    const placement = await this.h.prisma.vaultPlacement.create({
      data: {
        orderId: order.id,
        createdAt: now,
        ...(opts.prepared ? { preparedAt: new Date(), preparedByUserId: this.operatorId } : {}),
      },
    });
    const pItems = [];
    for (let i = 0; i < pieces.length; i += 1) {
      const mark = opts.marks?.[i] ?? 'pending';
      pItems.push(
        await this.h.prisma.vaultPlacementItem.create({
          data: {
            placementId: placement.id,
            orderItemId: orderItems[i].id,
            inventoryItemId: pieces[i].id,
            prepStatus: mark,
            ...(mark === 'pending'
              ? {}
              : { prepMarkedAt: new Date(), prepMarkedByUserId: this.operatorId }),
          },
        }),
      );
    }
    return { order, placement, pieces, items: pItems };
  }

  /** Un envío (retiro) con la pieza dentro, en el estado pedido. */
  async mkWithdrawal(userId: string, pieceId: string, status: 'solicitado' | 'picking' | 'guia' | 'enviado') {
    const s = await this.h.prisma.shipmentRequest.create({
      data: {
        userId,
        addressSnapshot: { line1: 'x', city: 'CDMX', state: 'CDMX', postalCode: '01000', country: 'MX', phone: '1' },
        status,
        shippingFeeCents: 0,
        priceConvention: 'IVA_INCLUSIVE',
        items: { create: [{ inventoryItemId: pieceId }] },
      },
    });
    this.shipments.push(s.id);
    return s;
  }

  // ------------------------------------------------------------ verbos por HTTP

  confirm(placementId: string, json: unknown = {}, token = this.opToken) {
    return this.h.api('POST', `/admin/vault-placements/${placementId}/confirm`, { token, json });
  }
  prepare(placementId: string, token = this.opToken) {
    return this.h.api('POST', `/admin/vault-placements/${placementId}/prepared`, { token, json: {} });
  }
  unprepare(placementId: string, token = this.opToken) {
    return this.h.api('DELETE', `/admin/vault-placements/${placementId}/prepared`, { token });
  }
  mark(placementId: string, placementItemId: string, status: unknown, token = this.opToken) {
    return this.h.api('PATCH', `/admin/vault-placements/${placementId}/prep-items/${placementItemId}`, {
      token,
      json: { status },
    });
  }
  queue(qs = '') {
    return this.h.api('GET', `/admin/shipments/picking-list${qs}`, { token: this.opToken });
  }
  physical(userId: string) {
    return this.h.api('GET', `/admin/vaults/${userId}/physical-inventory`, { token: this.opToken });
  }

  audits(placementId: string, action?: string) {
    return this.h.prisma.auditLog.findMany({
      where: { entityType: 'VaultPlacement', entityId: placementId, ...(action ? { action } : {}) },
      orderBy: { createdAt: 'asc' },
    });
  }
  movements(itemIds: string[]) {
    return this.h.prisma.inventoryMovement.findMany({ where: { itemId: { in: itemIds } } });
  }
  placementRow(id: string) {
    return this.h.prisma.vaultPlacement.findUniqueOrThrow({ where: { id } });
  }

  // ------------------------------------------------------------ barreras de carrera

  /**
   * Toma el candado de FILA de `tabla.id` en una transacción que la prueba suelta cuando quiere.
   * Los verbos se bloquean en su `UPDATE` de esa fila (el CAS) — y si la puerta existe, el segundo
   * verbo se bloquea antes, en la puerta, detrás del primero. Con o sin puerta, el orden lo fija la
   * prueba (la cola de espera de Postgres es FIFO).
   */
  async holdRow(tabla: 'VaultPlacement' | 'VaultPlacementItem', id: string | string[]) {
    const ids = Array.isArray(id) ? id : [id];
    const soltar = diferida();
    const tomado = diferida();
    const done = this.h.prisma.$transaction(
      async (tx) => {
        await tx.$queryRawUnsafe(`SELECT id FROM "${tabla}" WHERE id = ANY($1::text[]) FOR UPDATE`, ids);
        tomado.abrir();
        await soltar.promesa;
      },
      { timeout: 60000, maxWait: 10000 },
    );
    await tomado.promesa;
    return {
      // idempotente: `forced` la llama en el camino feliz y otra vez en su `finally`.
      release: async () => {
        soltar.abrir();
        await done;
      },
    };
  }

  /** Toma la PUERTA del cliente desde la prueba (mismo namespace que el producto). */
  async holdGate(userId: string) {
    const soltar = diferida();
    const tomado = diferida();
    const done = this.h.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${VAULT_GATE_NAMESPACE}::int, hashtext(${userId}))`;
        tomado.abrir();
        await soltar.promesa;
      },
      { timeout: 60000, maxWait: 10000 },
    );
    await tomado.promesa;
    return {
      release: async () => {
        soltar.abrir();
        await done;
      },
    };
  }

  /**
   * Espera —y COMPRUEBA— que haya `n` sesiones bloqueadas en un candado (de fila o advisory) en esta
   * BD. ⛔ No es un sleep: si no llegan, revienta diciendo que la barrera ya no mide lo que dice.
   */
  async waitBlocked(n: number, orDone: () => boolean = () => false) {
    const hasta = Date.now() + 10000;
    for (;;) {
      if (orDone()) return;
      const r = await this.h.prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND state = 'active'`,
      );
      if (Number(r[0].n) >= n) return;
      if (Date.now() > hasta) {
        throw new Error(
          `Esperaba ${n} sesión(es) bloqueada(s) en un candado y no llegaron en 10 s: la barrera ya no ` +
            'mide lo que dice (el verbo dejó de tomar la puerta o de escribir esa fila).',
        );
      }
      await new Promise((res) => setTimeout(res, 20));
    }
  }

  // ------------------------------------------------------------ limpieza

  async limpiar() {
    const p = this.h.prisma;
    const placements = await p.vaultPlacement.findMany({
      where: { orderId: { in: this.orders } },
      select: { id: true },
    });
    const pIds = placements.map((x) => x.id);
    await p.auditLog.deleteMany({ where: { entityType: 'VaultPlacement', entityId: { in: pIds } } });
    await p.vaultPlacementItem.deleteMany({ where: { placementId: { in: pIds } } });
    await p.vaultPlacement.deleteMany({ where: { id: { in: pIds } } });
    await p.shipmentRequest.deleteMany({ where: { id: { in: this.shipments } } });
    await p.order.deleteMany({ where: { id: { in: this.orders } } });
    await p.inventoryMovement.deleteMany({ where: { itemId: { in: this.items } } });
    await p.inventoryItem.deleteMany({ where: { id: { in: this.items } } });
    await p.vaultLocation.deleteMany({ where: { id: { in: this.locations } } });
    await p.user.deleteMany({ where: { id: { in: this.users } } });
  }
}

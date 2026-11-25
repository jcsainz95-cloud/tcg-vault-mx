import { randomUUID } from 'crypto';
import { E2EHarness } from './e2e-app';
import { E2E_FOLIOS, E2E_USERS } from '../../../prisma/e2e-fixtures';

/**
 * vault-orphans-db.ts — fixtures de §BOVEDA-COBRADA-SIN-PIEZAS contra Postgres REAL. Propiedad: backend.
 * Siembra directo en la BD (usuarios, cartas PROPIAS —para que ninguna copia del seed sea «equivalente» por accidente—, piezas,
 * pedidos y su reserva) y LIMPIA TODO lo que creó (`cleanup`): CI usa una sola BD en serie (lección de #157).
 */
export interface PieceOver {
  cardId?: string;
  productType?: 'raw' | 'graded' | 'sealed';
  finish?: string;
  language?: 'en' | 'es';
  status?: string;
  ownerType?: 'platform' | 'customer';
  ownerUserId?: string | null;
  ownershipStatus?: string | null;
  gradingCompany?: string | null;
  gradeValue?: string | null;
  sealedSubtype?: string | null;
  sealedCondition?: string | null;
  reservedByOrderId?: string | null;
  createdAt?: Date;
  folio?: string;
  acquisitionCostCents?: number;
}

export class VaultOrphansDb {
  readonly users: string[] = [];
  readonly orders: string[] = [];
  readonly items: string[] = [];
  readonly cards: string[] = [];
  readonly shipments: string[] = [];
  readonly startedAt = new Date();
  private seq = 0;
  private setId!: string;
  private locationId!: string | null;
  private passwordHash!: string | null;

  constructor(
    readonly h: E2EHarness,
    readonly run: string,
  ) {}

  async init(): Promise<void> {
    const base = await this.h.prisma.inventoryItem.findUniqueOrThrow({
      where: { folio: E2E_FOLIOS.listedCharizard },
      select: { locationId: true, card: { select: { setId: true } } },
    });
    this.setId = base.card.setId;
    this.locationId = base.locationId;
    this.passwordHash = (await this.h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.customer.email } })).passwordHash;
  }

  next(): number {
    this.seq += 1;
    return this.seq;
  }

  async user(tag = 'u') {
    const k = this.next();
    const u = await this.h.prisma.user.create({
      data: { email: `vo.${tag}.${this.run}.${k}@e2e.local`, passwordHash: this.passwordHash, name: `VO ${tag} ${k}`, role: 'customer', phone: '5512345678', emailVerified: true },
    });
    this.users.push(u.id);
    return u;
  }

  /** Una carta PROPIA (nadie más tiene copias de ella). */
  async card(tag = 'c') {
    const k = this.next();
    const c = await this.h.prisma.card.create({
      data: { externalId: `vo-${this.run}-${tag}-${k}`, setId: this.setId, name: `VO ${tag}`, number: String(900 + k), availableFinishes: ['normal', 'holofoil', 'reverse_holo'] },
    });
    this.cards.push(c.id);
    return c;
  }

  async piece(cardId: string, over: PieceOver = {}) {
    const k = this.next();
    const it = await this.h.prisma.inventoryItem.create({
      data: {
        folio: over.folio ?? `VO-${this.run}-${String(k).padStart(5, '0')}`,
        cardId: over.cardId ?? cardId,
        productType: over.productType ?? 'raw',
        rawCondition: (over.productType ?? 'raw') === 'raw' ? 'NM' : null,
        gradingCompany: (over.gradingCompany ?? null) as never,
        gradeValue: over.gradeValue ?? null,
        sealedSubtype: (over.sealedSubtype ?? null) as never,
        sealedCondition: (over.sealedCondition ?? null) as never,
        finish: (over.finish ?? 'normal') as never,
        language: over.language ?? 'en',
        acquisitionType: 'compra',
        acquisitionCostCents: over.acquisitionCostCents ?? 1000 + k,
        locationId: this.locationId,
        status: (over.status ?? 'listed') as never,
        ownerType: over.ownerType ?? 'platform',
        ownerUserId: over.ownerUserId ?? null,
        ownershipStatus: (over.ownershipStatus ?? null) as never,
        reservedByOrderId: over.reservedByOrderId ?? null,
        ...(over.createdAt ? { createdAt: over.createdAt } : {}),
      },
    });
    this.items.push(it.id);
    return it;
  }

  /**
   * Un pedido con sus líneas. `pending` ⇒ reserva REAL (las piezas pasan a `reserved` con dueño y vencimiento, como `reserveItems`);
   * `settled`/`failed`/otro ⇒ solo la fila (el estado de las piezas lo decide el test).
   */
  async order(opts: {
    userId: string | null;
    pieces: { id: string }[];
    status?: 'pending' | 'failed' | 'settled';
    mode?: 'vault' | 'direct_ship';
    pi?: string | null;
    reservedUntil?: Date;
    createdAt?: Date;
    guestEmail?: string;
  }) {
    const k = this.next();
    const status = opts.status ?? 'pending';
    const mode = opts.mode ?? 'vault';
    const pi = opts.pi === undefined ? `pi_vo_${randomUUID().replace(/-/g, '')}` : opts.pi;
    const order = await this.h.prisma.order.create({
      data: {
        userId: opts.userId,
        fulfillmentMode: mode,
        orderNumber: `VO-${this.run}-${k}`,
        status,
        ...(status === 'settled' ? { settledAt: new Date() } : {}),
        subtotalCents: 100,
        processingFeeCents: 0,
        ivaCents: 0,
        totalCents: 100,
        priceConvention: 'IVA_EXCLUSIVE',
        feeConvention: 'FEE_ON_TOP',
        stripePaymentIntentId: pi,
        ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
        ...(mode === 'direct_ship' ? { shippingAddressSnapshot: { line1: 'x' }, guestEmail: opts.guestEmail ?? `vo.guest.${this.run}.${k}@example.com` } : {}),
      },
    });
    this.orders.push(order.id);
    const lines = [];
    for (let i = 0; i < opts.pieces.length; i += 1) {
      lines.push(
        await this.h.prisma.orderItem.create({
          data: { orderId: order.id, inventoryItemId: opts.pieces[i].id, cardSnapshot: {}, unitPriceCents: 100 + i },
        }),
      );
    }
    if (status === 'pending') {
      await this.h.prisma.inventoryItem.updateMany({
        where: { id: { in: opts.pieces.map((p) => p.id) } },
        data: {
          status: 'reserved',
          reservedByOrderId: order.id,
          reservedUntil: opts.reservedUntil ?? new Date(Date.now() + 60 * 60 * 1000),
          ...(mode === 'vault' && opts.userId ? { ownerType: 'customer', ownerUserId: opts.userId, ownershipStatus: 'pending' } : {}),
        },
      });
    }
    return { order, lines, pi };
  }

  /** Un pedido de bóveda ya `settled` con su colocación `pending` y una fila por carta (lo que deja la liquidación). */
  async settledVaultOrder(userId: string, pieces: { id: string }[]) {
    const r = await this.order({ userId, pieces, status: 'settled', pi: null });
    const placement = await this.h.prisma.vaultPlacement.create({ data: { orderId: r.order.id, createdAt: new Date() } });
    for (let i = 0; i < pieces.length; i += 1) {
      await this.h.prisma.vaultPlacementItem.create({ data: { placementId: placement.id, orderItemId: r.lines[i].id, inventoryItemId: pieces[i].id } });
    }
    return { ...r, placement };
  }

  /** `payment_intent.succeeded` firmado contra el endpoint real. */
  paid(pi: string, amountCents = 100, eventId?: string) {
    return this.h.sendStripeWebhook({
      ...(eventId ? { id: eventId } : {}),
      type: 'payment_intent.succeeded',
      data: { object: { id: pi, object: 'payment_intent', amount: amountCents, amount_received: amountCents, currency: 'mxn' } },
    });
  }

  item(id: string) {
    return this.h.prisma.inventoryItem.findUniqueOrThrow({ where: { id } });
  }

  async movements(itemId: string, reason?: string) {
    return this.h.prisma.inventoryMovement.findMany({ where: { itemId, ...(reason ? { reason: reason as never } : {}) } });
  }

  /** La invariante, leída de la BD: devuelve las violaciones (vacío ⇒ se cumple). */
  async violations(orderIds: string[]): Promise<string[]> {
    const out: string[] = [];
    const orders = await this.h.prisma.order.findMany({
      where: { id: { in: orderIds }, status: 'settled', fulfillmentMode: 'vault' },
      include: { items: true },
    });
    const claimed = new Map<string, string>();
    for (const o of orders) {
      for (const l of o.items) {
        if (l.fulfillmentFailedAt) continue; // «requiere atención»: cobrada y sin pieza, pero VISIBLE (no es «liquidada normal»)
        const it = await this.item(l.inventoryItemId);
        if (!(it.status === 'in_custody' && it.ownerType === 'customer' && it.ownerUserId === o.userId && it.reservedByOrderId === null)) {
          out.push(`línea ${l.id} de ${o.orderNumber}: pieza ${it.folio} está ${it.status}/${it.ownerType}/${it.ownerUserId}`);
        }
        const prev = claimed.get(l.inventoryItemId);
        if (prev && prev !== o.id) out.push(`pieza ${it.folio} reclamada por dos pedidos liquidados (${prev}, ${o.id})`);
        claimed.set(l.inventoryItemId, o.id);
      }
    }
    return out;
  }

  /** «Exactamente un dueño»: cliente ⇒ con usuario y en reserva/custodia; plataforma ⇒ sin usuario. */
  async ownerViolations(): Promise<string[]> {
    const out: string[] = [];
    const rows = await this.h.prisma.inventoryItem.findMany({ where: { id: { in: this.items } } });
    for (const it of rows) {
      if (it.ownerType === 'customer' && !it.ownerUserId) out.push(`${it.folio}: cliente sin usuario`);
      if (it.ownerType === 'platform' && it.ownerUserId) out.push(`${it.folio}: plataforma con usuario`);
      if (it.status === 'reserved' && !it.reservedByOrderId) out.push(`${it.folio}: reservada sin pedido`);
      if (it.status === 'listed' && it.ownerType === 'customer') out.push(`${it.folio}: listada con dueño cliente`);
    }
    return out;
  }

  /** Borra TODO lo que esta corrida creó (y lo que las rutas reales crearon sobre ello), en orden de FK. */
  async cleanup(extraUserIds: string[] = []): Promise<void> {
    const p = this.h.prisma;
    const userIds = [...this.users, ...extraUserIds];
    // Pedidos creados por las rutas reales (checkout) de los usuarios del fixture, desde el inicio de la corrida.
    const viaApi = await p.order.findMany({ where: { userId: { in: extraUserIds }, createdAt: { gte: this.startedAt } }, select: { id: true } });
    const orderIds = [...new Set([...this.orders, ...viaApi.map((o) => o.id)])];
    const placements = await p.vaultPlacement.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
    const pIds = placements.map((x) => x.id);
    await p.vaultPlacementItem.deleteMany({ where: { placementId: { in: pIds } } });
    await p.vaultPlacement.deleteMany({ where: { id: { in: pIds } } });
    const ships = await p.shipmentRequest.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
    await p.shipmentRequest.deleteMany({ where: { id: { in: [...ships.map((s) => s.id), ...this.shipments] } } });
    await p.paymentRefund.deleteMany({ where: { orderId: { in: orderIds } } });
    await p.discountRedemption.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => undefined);
    await p.auditLog.deleteMany({ where: { OR: [{ entityId: { in: orderIds } }, { action: 'vault.orphan_repair_run', createdAt: { gte: this.startedAt } }] } });
    // Las piezas que el checkout real dejó reservadas/colgadas de estos pedidos vuelven a la plataforma antes de borrarlos.
    await p.inventoryItem.updateMany({ where: { reservedByOrderId: { in: orderIds } }, data: { reservedByOrderId: null, reservedUntil: null } });
    await p.order.deleteMany({ where: { id: { in: orderIds } } });
    await p.inventoryMovement.deleteMany({ where: { itemId: { in: this.items } } });
    await p.inventoryItem.deleteMany({ where: { id: { in: this.items } } });
    await p.card.deleteMany({ where: { id: { in: this.cards } } });
    await p.processedStripeEvent.deleteMany({ where: { processedAt: { gte: this.startedAt }, type: { in: ['payment_intent.succeeded', 'payment_intent.canceled', 'payment_intent.payment_failed'] } } });
    await p.user.deleteMany({ where: { id: { in: this.users } } });
    void userIds;
  }
}

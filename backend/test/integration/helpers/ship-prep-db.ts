/**
 * ship-prep-db.ts — FIXTURES y VERBOS de la cubeta ENVÍO (§M4-SHIP) contra Postgres REAL. Propiedad: backend.
 *
 * Construye, con `Prisma` directo (⛔ no por HTTP: el checkout real necesita Stripe), lo que las PS-* de
 * §M4-SHIP.12/.17.9/.18.8 necesitan: clientes, piezas de plataforma/cliente, órdenes `direct_ship` con las
 * CIFRAS DEL DUEÑO (§M4-SHIP.4: `S=80000, E=15000, F=4617, total=99617`), su envío de fulfillment en
 * `picking`, órdenes `vault` liquidadas (con colocación) y retiros. Los verbos por HTTP real, con la sesión
 * del operador o del súper-admin. Barreras de fila (`holdRow`) para las carreras (prueba 40).
 *
 * `cleanup()` borra TODO lo sembrado por esta corrida (en orden de FKs): la BD queda como estaba.
 */
import { InventoryStatus, OwnerType, OwnershipStatus, PreparationItemStatus, ShipmentStatus } from '@prisma/client';
import { E2EHarness } from './e2e-app';
import { E2E_FOLIOS, E2E_USERS } from '../../../prisma/e2e-fixtures';
import { diferida } from './row-lock-barrier';
import { taxBaseCentsOf } from '../../../src/common/money';
import { PiiCryptoService } from '../../../src/common/crypto/pii-crypto.service';
import { E2E_USERS as USERS } from '../../../prisma/e2e-fixtures';

/** El ejemplo del dueño (§M4-SHIP.4): dos cartas MX$500 + MX$300, envío MX$150, comisión MX$46.17. */
export const OWNER_EXAMPLE = {
  subtotalCents: 80000,
  shippingFeeCents: 15000,
  processingFeeCents: 4617,
  ivaRatePct: 16,
  ivaCents: 95000 - taxBaseCentsOf(95000, 16),
  totalCents: 99617,
  prices: [50000, 30000],
} as const;

export type R = { status: number; body: any };

export class ShipPrepDb {
  readonly users: string[] = [];
  readonly orders: string[] = [];
  readonly items: string[] = [];
  readonly shipments: string[] = [];
  readonly locations: string[] = [];
  readonly cards: string[] = [];
  private seq = 0;
  private template!: { cardId: string; shopLocationId: string; setId: string };
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
    this.template = { cardId: base.cardId, shopLocationId: base.locationId as string, setId: base.card.setId };
    this.passwordHash = (await this.h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.customer.email } })).passwordHash;
    this.operatorId = (await this.h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.operator.email } })).id;
    this.adminId = (await this.h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.admin.email } })).id;
    this.opToken = await this.h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    this.adminToken = await this.h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
  }

  get cardId() {
    return this.template.cardId;
  }
  get shopLocationId() {
    return this.template.shopLocationId;
  }
  private next() {
    this.seq += 1;
    return this.seq;
  }

  // ---------------------------------------------------------------- fixtures

  async mkUser(name = 'Cliente Prep', opts: { email?: string; nameSource?: 'user' | 'derived' } = {}) {
    const k = this.next();
    const u = await this.h.prisma.user.create({
      data: {
        email: opts.email ?? `sp.${this.run}.${k}@e2e.local`,
        passwordHash: this.passwordHash,
        name,
        nameSource: opts.nameSource ?? 'user',
        role: 'customer',
        emailVerified: true,
      },
    });
    this.users.push(u.id);
    return u;
  }

  async mkAddress(userId: string) {
    return this.h.prisma.address.create({
      data: {
        userId,
        recipientName: 'Destinatario Prep',
        line1: 'Calle 1',
        city: 'CDMX',
        state: 'CDMX',
        postalCode: '01000',
        country: 'MX',
        phone: '5500000000',
      },
    });
  }

  async mkPiece(
    over: Partial<{
      status: InventoryStatus;
      ownerType: OwnerType;
      ownerUserId: string | null;
      ownershipStatus: OwnershipStatus | null;
      locationId: string | null;
      cardId: string;
      rawCondition: 'NM';
      finish: 'normal' | 'holofoil';
      acquisitionCostCents: number | null;
      /** Semilla del precio de venta (M1). Sin ella la pieza nace con `null` (default del schema). */
      listPriceCents: number | null;
    }> = {},
  ) {
    const k = this.next();
    const it = await this.h.prisma.inventoryItem.create({
      data: {
        folio: `SP-${this.run}-${String(k).padStart(4, '0')}`,
        cardId: over.cardId ?? this.template.cardId,
        productType: 'raw',
        rawCondition: over.rawCondition ?? 'NM',
        finish: over.finish ?? 'normal',
        acquisitionType: 'compra',
        acquisitionCostCents: over.acquisitionCostCents === undefined ? 1000 : over.acquisitionCostCents,
        locationId: over.locationId === undefined ? this.template.shopLocationId : over.locationId,
        status: over.status ?? 'in_stock',
        ownerType: over.ownerType ?? 'platform',
        ownerUserId: over.ownerUserId ?? null,
        ownershipStatus: over.ownershipStatus === undefined ? null : over.ownershipStatus,
        ...(over.listPriceCents !== undefined ? { listPriceCents: over.listPriceCents } : {}),
      },
    });
    this.items.push(it.id);
    return it;
  }

  async mkDrawer() {
    const k = this.next();
    const box = `SPD${this.run}${k}`.toUpperCase().slice(-20);
    const loc = await this.h.prisma.vaultLocation.create({
      data: { zone: 'customer_custody', box, row: 'F01', slot: 'S01', label: `${box}-F01-S01`, isActive: true },
    });
    this.locations.push(loc.id);
    return loc;
  }

  /**
   * Orden `direct_ship` LIQUIDADA con las cifras del dueño y su envío de fulfillment en `picking`
   * (`userId=null`, montos 0, `IVA_INCLUSIVE`), piezas plataforma `picking`. Guest por defecto.
   */
  async mkDirect(opts: { userId?: string | null; guestEmail?: string | null; prices?: readonly number[]; priceConvention?: 'IVA_INCLUSIVE' | 'IVA_EXCLUSIVE' } = {}) {
    const k = this.next();
    const prices = opts.prices ?? OWNER_EXAMPLE.prices;
    const S = prices.reduce((a, b) => a + b, 0);
    const money = S === OWNER_EXAMPLE.subtotalCents ? OWNER_EXAMPLE : { ...OWNER_EXAMPLE, subtotalCents: S, ivaCents: S + 15000 - taxBaseCentsOf(S + 15000, 16), totalCents: S + 15000 + 4617 };
    const pi = `pi_sp_${this.run}_${k}`;
    const order = await this.h.prisma.order.create({
      data: {
        userId: opts.userId ?? null,
        guestEmail: opts.userId ? null : (opts.guestEmail ?? `guest.${this.run}.${k}@e2e.local`),
        orderNumber: `SP-${this.run}-${k}`,
        fulfillmentMode: 'direct_ship',
        status: 'settled',
        settledAt: new Date(),
        subtotalCents: money.subtotalCents,
        shippingFeeCents: money.shippingFeeCents,
        processingFeeCents: money.processingFeeCents,
        ivaCents: money.ivaCents,
        ivaRatePct: 16,
        totalCents: money.totalCents,
        priceConvention: opts.priceConvention ?? 'IVA_INCLUSIVE',
        stripePaymentIntentId: pi,
        shippingAddressSnapshot: { recipientName: 'Destinatario Directo', line1: 'Calle 1', city: 'CDMX', state: 'CDMX', postalCode: '01000', country: 'MX', phone: '55' },
      },
    });
    this.orders.push(order.id);
    this.h.stripe.chargedByIntent.set(pi, money.totalCents);
    const pieces: Awaited<ReturnType<ShipPrepDb['mkPiece']>>[] = [];
    const orderItems: { id: string; inventoryItemId: string; unitPriceCents: number }[] = [];
    for (const p of prices) {
      const piece = await this.mkPiece({ status: 'picking', ownerType: 'platform' });
      pieces.push(piece);
      orderItems.push(await this.h.prisma.orderItem.create({ data: { orderId: order.id, inventoryItemId: piece.id, cardSnapshot: { name: 'Charizard', setName: 'E2E Base Set', number: '4' }, unitPriceCents: p } }));
    }
    const shipment = await this.h.prisma.shipmentRequest.create({
      data: {
        userId: null,
        orderId: order.id,
        addressSnapshot: order.shippingAddressSnapshot as object,
        status: 'picking',
        pickingAt: new Date(),
        shippingFeeCents: 0,
        ivaCents: 0,
        processingFeeCents: 0,
        totalCents: 0,
        priceConvention: 'IVA_INCLUSIVE',
        items: { create: pieces.map((p) => ({ inventoryItemId: p.id })) },
      },
      include: { items: true },
    });
    this.shipments.push(shipment.id);
    return { order, pieces, orderItems, shipment, lines: shipment.items, pi };
  }

  /** Orden `vault` LIQUIDADA (F-SPEI por defecto: `P₁=50000`, `P₂=30000`, sin envío) con colocación y piezas `in_custody` del cliente. */
  async mkVaultOrder(
    userId: string,
    opts: { prices?: readonly number[]; placement?: 'pending' | 'placed' | 'none'; locationId?: string | null; priceConvention?: 'IVA_INCLUSIVE' | 'IVA_EXCLUSIVE'; settledAt?: Date; cardIds?: readonly string[] } = {},
  ) {
    const k = this.next();
    const prices = opts.prices ?? [50000, 30000];
    const S = prices.reduce((a, b) => a + b, 0);
    const F = 4617;
    const pi = `pi_spv_${this.run}_${k}`;
    const order = await this.h.prisma.order.create({
      data: {
        userId,
        orderNumber: `SPV-${this.run}-${k}`,
        fulfillmentMode: 'vault',
        status: 'settled',
        settledAt: opts.settledAt ?? new Date(),
        subtotalCents: S,
        shippingFeeCents: 0,
        processingFeeCents: F,
        ivaCents: S - taxBaseCentsOf(S, 16),
        ivaRatePct: 16,
        totalCents: S + F,
        priceConvention: opts.priceConvention ?? 'IVA_INCLUSIVE',
        stripePaymentIntentId: pi,
      },
    });
    this.orders.push(order.id);
    this.h.stripe.chargedByIntent.set(pi, S + F);
    const pieces: Awaited<ReturnType<ShipPrepDb['mkPiece']>>[] = [];
    const orderItems: { id: string; inventoryItemId: string; unitPriceCents: number }[] = [];
    for (const [i, p] of prices.entries()) {
      const piece = await this.mkPiece({ status: 'in_custody', ownerType: 'customer', ownerUserId: userId, ownershipStatus: 'settled', locationId: opts.locationId === undefined ? this.template.shopLocationId : opts.locationId, ...(opts.cardIds?.[i] ? { cardId: opts.cardIds[i] } : {}) });
      pieces.push(piece);
      orderItems.push(await this.h.prisma.orderItem.create({ data: { orderId: order.id, inventoryItemId: piece.id, cardSnapshot: { name: 'Charizard', setName: 'E2E Base Set', number: '4' }, unitPriceCents: p } }));
    }
    let placement = null;
    if ((opts.placement ?? 'pending') !== 'none') {
      const placed = opts.placement === 'placed';
      placement = await this.h.prisma.vaultPlacement.create({
        data: {
          orderId: order.id,
          createdAt: order.settledAt as Date,
          ...(placed
            ? { status: 'placed', preparedAt: new Date(), preparedByUserId: this.operatorId, placedAt: new Date(), placedByUserId: this.operatorId, locationId: opts.locationId ?? this.template.shopLocationId }
            : {}),
          items: { create: orderItems.map((oi, i) => ({ orderItemId: oi.id, inventoryItemId: pieces[i].id, ...(placed ? { prepStatus: 'picked' as PreparationItemStatus, prepMarkedAt: new Date(), prepMarkedByUserId: this.operatorId } : {}) })) },
        },
      });
    }
    return { order, pieces, orderItems, placement, pi };
  }

  /** Retiro de bóveda del cliente en el estado dado, con su cobro (`totalCents=20300+fee`). */
  async mkWithdrawal(userId: string, pieceIds: string[], status: ShipmentStatus = 'picking', opts: { prepared?: boolean; picked?: boolean } = {}) {
    const k = this.next();
    const pi = `pi_spw_${this.run}_${k}`;
    const s = await this.h.prisma.shipmentRequest.create({
      data: {
        userId,
        addressSnapshot: { recipientName: 'Destinatario Retiro', line1: 'x', city: 'CDMX', state: 'CDMX', postalCode: '01000', country: 'MX', phone: '1' },
        status,
        pickingAt: status === 'solicitado' ? null : new Date(),
        shippingFeeCents: 20300,
        ivaCents: 20300 - taxBaseCentsOf(20300, 16),
        processingFeeCents: 1105,
        totalCents: 21405,
        priceConvention: 'IVA_INCLUSIVE',
        stripePaymentIntentId: pi,
        ...(opts.prepared ? { preparedAt: new Date(), preparedByUserId: this.operatorId } : {}),
        items: { create: pieceIds.map((id) => ({ inventoryItemId: id, ...(opts.picked ? { prepStatus: 'picked' as PreparationItemStatus, prepMarkedAt: new Date(), prepMarkedByUserId: this.operatorId } : {}) })) },
      },
      include: { items: true },
    });
    this.shipments.push(s.id);
    this.h.stripe.chargedByIntent.set(pi, 21405);
    return { shipment: s, lines: s.items, pi };
  }

  /**
   * ⭐ v1.80.1 — una CARTA PROPIA del test con su referencia de MERCADO controlada (`M`): manual override `refKind:
   * 'market'` (tier superior absoluto, §4.27f-2) para `raw:NM` normal. `null` ⇒ carta SIN referencia (⇒ `pending`).
   */
  async mkCard(marketMxnCents: number | null, name = 'Carta Caso') {
    const k = this.next();
    const card = await this.h.prisma.card.create({
      data: { externalId: `sp-${this.run}-${k}`, setId: this.template.setId, name: `${name} ${k}`, number: String(k), rarity: 'Rare' },
    });
    this.cards.push(card.id);
    if (marketMxnCents !== null) {
      await this.h.prisma.priceReference.create({
        data: {
          cardId: card.id,
          productType: 'raw',
          gradeKey: 'raw:NM',
          finish: 'normal',
          source: 'manual',
          refKind: 'market',
          priceMxnCents: marketMxnCents,
          capturedDate: new Date(new Date().toISOString().slice(0, 10)),
          isManualOverride: true,
          cardProductId: null,
        },
      });
    }
    return card;
  }

  /** CLABE cifrada en el expediente (por la MISMA rutina que el producto: `PiiCryptoService`), sin pasar por `setClabe`. */
  async mkKyc(userId: string, clabe: string | null, extra: { legalName?: string; clabeUpdatedAt?: Date | null } = {}) {
    const pii = this.h.app.get(PiiCryptoService);
    return this.h.prisma.kycProfile.upsert({
      where: { userId },
      create: {
        userId,
        legalName: extra.legalName ?? null,
        ...(clabe ? { clabeEnc: pii.encrypt(clabe), clabeHmac: pii.clabeBlindIndex(clabe), clabeUpdatedAt: extra.clabeUpdatedAt === undefined ? null : extra.clabeUpdatedAt } : {}),
      },
      update: {
        legalName: extra.legalName ?? null,
        ...(clabe ? { clabeEnc: pii.encrypt(clabe), clabeHmac: pii.clabeBlindIndex(clabe), clabeUpdatedAt: extra.clabeUpdatedAt === undefined ? null : extra.clabeUpdatedAt } : {}),
      },
    });
  }

  /** Sesión del cliente sembrado por `mkUser` (misma contraseña que el `customer` del seed). */
  loginCustomer(email: string): Promise<string> {
    return this.h.login(email, USERS.customer.password);
  }

  // ---------------------------------------------------------------- verbos (HTTP real)

  mark(shipmentId: string, lineId: string, json: unknown, token = this.opToken): Promise<R> {
    return this.h.api('PATCH', `/admin/shipments/${shipmentId}/prep-items/${lineId}`, { token, json });
  }
  prepare(shipmentId: string, expectedRefundCents: number, token = this.opToken): Promise<R> {
    return this.h.api('POST', `/admin/shipments/${shipmentId}/prepared`, { token, json: { expectedRefundCents } });
  }
  unprepare(shipmentId: string, token = this.opToken): Promise<R> {
    return this.h.api('DELETE', `/admin/shipments/${shipmentId}/prepared`, { token });
  }
  tracking(shipmentId: string, token = this.opToken): Promise<R> {
    return this.h.api('POST', `/admin/shipments/${shipmentId}/tracking`, { token, json: { carrier: 'DHL', trackingNumber: `T-${this.run}-${this.next()}` } });
  }
  status(shipmentId: string, to: string, token = this.opToken): Promise<R> {
    return this.h.api('PATCH', `/admin/shipments/${shipmentId}/status`, { token, json: { to } });
  }
  retry(refundId: string, token = this.opToken): Promise<R> {
    return this.h.api('POST', `/admin/refunds/${refundId}/retry`, { token });
  }
  m3Refund(orderId: string, json: Record<string, unknown> = { reason: 'prueba' }, token = this.adminToken): Promise<R> {
    return this.h.api('POST', `/admin/orders/${orderId}/refund`, { token, json });
  }
  chargebackInventory(orderId: string, outcome: string, token = this.opToken): Promise<R> {
    return this.h.api('POST', `/admin/orders/${orderId}/chargeback-inventory`, { token, json: { outcome, note: 'nota de prueba' } });
  }
  reclaimVault(orderId: string, json: Record<string, unknown>, token = this.adminToken): Promise<R> {
    return this.h.api('POST', `/admin/orders/${orderId}/reclaim-vault`, { token, json });
  }
  queue(qs = ''): Promise<R> {
    return this.h.api('GET', `/admin/shipments/picking-list${qs}`, { token: this.opToken });
  }
  summary(token = this.opToken): Promise<R> {
    return this.h.api('GET', '/admin/shipments/picking-list/summary', { token });
  }

  // colocaciones (§M4-VAULT.10 / .5)
  vpMark(placementId: string, itemId: string, json: unknown, token = this.opToken): Promise<R> {
    return this.h.api('PATCH', `/admin/vault-placements/${placementId}/prep-items/${itemId}`, { token, json });
  }
  vpPrepare(placementId: string, token = this.opToken): Promise<R> {
    return this.h.api('POST', `/admin/vault-placements/${placementId}/prepared`, { token });
  }
  vpConfirm(placementId: string, json: Record<string, unknown> = {}, token = this.opToken): Promise<R> {
    return this.h.api('POST', `/admin/vault-placements/${placementId}/confirm`, { token, json });
  }
  // apartado «Por reponer» (§M4-SHIP.15)
  caseList(qs = '', token = this.opToken): Promise<R> {
    return this.h.api('GET', `/admin/replacement-cases${qs}`, { token });
  }
  caseGet(id: string, token = this.opToken): Promise<R> {
    return this.h.api('GET', `/admin/replacement-cases/${id}`, { token });
  }
  caseReplace(id: string, json: unknown, token = this.opToken): Promise<R> {
    return this.h.api('POST', `/admin/replacement-cases/${id}/replace`, { token, json });
  }
  casePreview(id: string, amountCents?: number | string, token = this.adminToken): Promise<R> {
    return this.h.api('GET', `/admin/replacement-cases/${id}/refund-preview${amountCents === undefined ? '' : `?amountCents=${amountCents}`}`, { token });
  }
  caseRefund(id: string, json: unknown, token = this.adminToken): Promise<R> {
    return this.h.api('POST', `/admin/replacement-cases/${id}/refund`, { token, json });
  }
  caseVoid(id: string, json: unknown, token = this.adminToken): Promise<R> {
    return this.h.api('POST', `/admin/replacement-cases/${id}/void`, { token, json });
  }
  // cubeta SPEI (§M4-SHIP.15.13)
  mrList(qs = '', token = this.adminToken): Promise<R> {
    return this.h.api('GET', `/admin/manual-refunds${qs}`, { token });
  }
  mrGet(id: string, token = this.adminToken): Promise<R> {
    return this.h.api('GET', `/admin/manual-refunds/${id}`, { token });
  }
  mrReveal(id: string, token = this.adminToken): Promise<R> {
    return this.h.api('GET', `/admin/manual-refunds/${id}/reveal-clabe`, { token });
  }
  mrPaid(id: string, json: unknown, token = this.adminToken): Promise<R> {
    return this.h.api('POST', `/admin/manual-refunds/${id}/paid`, { token, json });
  }
  mrCancel(id: string, json: unknown, token = this.adminToken): Promise<R> {
    return this.h.api('POST', `/admin/manual-refunds/${id}/cancel`, { token, json });
  }
  mrReissue(id: string, json: unknown, token = this.adminToken): Promise<R> {
    return this.h.api('POST', `/admin/manual-refunds/${id}/reissue`, { token, json });
  }
  toManual(refundId: string, token = this.adminToken): Promise<R> {
    return this.h.api('POST', `/admin/refunds/${refundId}/to-manual`, { token });
  }
  // cliente
  putKyc(token: string, json: unknown): Promise<R> {
    return this.h.api('PUT', '/users/me/kyc', { token, json });
  }
  holdings(token: string): Promise<R> {
    return this.h.api('GET', '/vault/holdings', { token });
  }
  clientShipment(id: string, token: string): Promise<R> {
    return this.h.api('GET', `/shipments/${id}`, { token });
  }
  clientOrder(id: string, token: string): Promise<R> {
    return this.h.api('GET', `/orders/${id}`, { token });
  }
  kase(id: string) {
    return this.h.prisma.replacementCase.findUniqueOrThrow({ where: { id } });
  }
  // inventario M1 (§M4-SHIP.17.1 / PS-64)
  invMark(id: string, json: unknown, token = this.opToken): Promise<R> {
    return this.h.api('POST', `/admin/inventory/items/${id}/mark`, { token, json });
  }
  invPatch(id: string, json: unknown, token = this.opToken): Promise<R> {
    return this.h.api('PATCH', `/admin/inventory/items/${id}`, { token, json });
  }
  invMove(id: string, toLocationId: string, token = this.opToken): Promise<R> {
    return this.h.api('POST', `/admin/inventory/items/${id}/move`, { token, json: { toLocationId } });
  }
  publishAll(json: Record<string, unknown> = {}, token = this.adminToken): Promise<R> {
    return this.h.api('POST', '/admin/inventory/publish-all', { token, json });
  }
  bulkPublish(ids: string[], token = this.adminToken): Promise<R> {
    return this.h.api('POST', '/admin/inventory/items/bulk-publish', { token, json: { items: ids.map((inventoryItemId) => ({ inventoryItemId })) } });
  }
  // cliente: retiros
  createShipment(token: string, json: unknown): Promise<R> {
    return this.h.api('POST', '/shipments', { token, json });
  }
  quoteShipment(token: string, json: unknown): Promise<R> {
    return this.h.api('POST', '/shipments/quote', { token, json });
  }
  clientOrders(token: string): Promise<R> {
    return this.h.api('GET', '/orders', { token });
  }
  guestTrack(token: string): Promise<R> {
    return this.h.api('POST', '/orders/guest/track', { json: { token } });
  }
  // súper-admin: M3, tablero, M7
  adminOrder(id: string, token = this.adminToken): Promise<R> {
    return this.h.api('GET', `/admin/orders/${id}`, { token });
  }
  adminOrders(qs = '', token = this.adminToken): Promise<R> {
    return this.h.api('GET', `/admin/orders${qs}`, { token });
  }
  dashboard(token = this.adminToken): Promise<R> {
    return this.h.api('GET', '/admin/dashboard', { token });
  }
  pnl(qs = '', token = this.adminToken): Promise<R> {
    return this.h.api('GET', `/admin/finance/pnl${qs}`, { token });
  }
  shrinkage(qs = '', token = this.adminToken): Promise<R> {
    return this.h.api('GET', `/admin/finance/shrinkage${qs}`, { token });
  }
  operatorSummary(token = this.adminToken): Promise<R> {
    return this.h.api('GET', '/admin/refunds/operator-summary', { token });
  }
  adminRefunds(qs = '', token = this.adminToken): Promise<R> {
    return this.h.api('GET', `/admin/refunds${qs}`, { token });
  }
  vaultPlacementRow(id: string) {
    return this.h.prisma.vaultPlacement.findUniqueOrThrow({ where: { id } });
  }
  manualRows(where: Record<string, unknown>) {
    return this.h.prisma.manualRefund.findMany({ where, orderBy: { createdAt: 'asc' } });
  }

  /** Simula el webhook `charge.refunded` TOTAL de un PI. */
  chargeRefunded(pi: string, amount: number, refunded = amount) {
    return this.h.sendStripeWebhook({ type: 'charge.refunded', data: { object: { id: `ch_${pi}`, object: 'charge', payment_intent: pi, amount, amount_refunded: refunded } } });
  }
  /** Simula `charge.refund.updated`. */
  refundUpdated(refund: { id: string; status: string; metadata: Record<string, string> }) {
    return this.h.sendStripeWebhook({ type: 'charge.refund.updated', data: { object: { object: 'refund', ...refund } } });
  }

  // ---------------------------------------------------------------- lecturas

  refunds(where: Record<string, unknown>) {
    return this.h.prisma.paymentRefund.findMany({ where, orderBy: { createdAt: 'asc' } });
  }
  piece(id: string) {
    return this.h.prisma.inventoryItem.findUniqueOrThrow({ where: { id } });
  }
  shipment(id: string) {
    return this.h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id }, include: { items: true } });
  }
  order(id: string) {
    return this.h.prisma.order.findUniqueOrThrow({ where: { id } });
  }
  movements(itemIds: string[]) {
    return this.h.prisma.inventoryMovement.findMany({ where: { itemId: { in: itemIds } }, orderBy: { createdAt: 'asc' } });
  }
  audits(entityId: string, action?: string) {
    return this.h.prisma.auditLog.findMany({ where: { entityId, ...(action ? { action } : {}) }, orderBy: { createdAt: 'asc' } });
  }

  // ---------------------------------------------------------------- barreras (prueba 40)

  async holdRow(tabla: 'ShipmentRequest' | 'Order' | 'InventoryItem' | 'PaymentRefund' | 'ReplacementCase' | 'ManualRefund' | 'KycProfile', id: string | string[]) {
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
      release: async () => {
        soltar.abrir();
        await done;
      },
    };
  }

  /** Espera a ver `n` sesiones bloqueadas en un candado de FILA (`transactionid`/`tuple`); `false` si no llegan. */
  async waitRowBlocked(n: number, orDone: () => boolean = () => false): Promise<boolean> {
    const hasta = Date.now() + 10000;
    for (;;) {
      if (orDone()) return false;
      const r = await this.h.prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND state = 'active'
            AND wait_event IN ('transactionid', 'tuple')`,
      );
      if (Number(r[0].n) >= n) return true;
      if (Date.now() > hasta) return false;
      await new Promise((res) => setTimeout(res, 20));
    }
  }

  /** Espera a ver `n` sesiones bloqueadas en CUALQUIER candado (fila o advisory). */
  async waitBlocked(n: number, orDone: () => boolean = () => false): Promise<boolean> {
    const hasta = Date.now() + 10000;
    for (;;) {
      if (orDone()) return false;
      const r = await this.h.prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND state = 'active'`,
      );
      if (Number(r[0].n) >= n) return true;
      if (Date.now() > hasta) return false;
      await new Promise((res) => setTimeout(res, 20));
    }
  }

  /**
   * A se lanza primero y se COMPRUEBA bloqueado en la barrera; luego B, que se bloquea detrás — o termina sin
   * bloquearse (lo que pasa cuando una mutación quita la serialización). Se suelta SIEMPRE. Devuelve [A, B] y si
   * se observó a los dos esperando (una tirada sin entrelazado observado NO cuenta, §M4-SHIP.12).
   */
  async forced(
    barrier: () => Promise<{ release: () => Promise<void> }>,
    a: () => Promise<R>,
    b: () => Promise<R>,
  ): Promise<{ a: R; b: R; interleaved: boolean }> {
    const hold = await barrier();
    try {
      const pa = a();
      const aBlocked = await this.waitBlocked(1);
      let bDone = false;
      const pb = b().finally(() => {
        bDone = true;
      });
      const bothBlocked = await this.waitBlocked(2, () => bDone);
      await hold.release();
      const [ra, rb] = await Promise.all([pa, pb]);
      return { a: ra, b: rb, interleaved: aBlocked && (bothBlocked || bDone) };
    } finally {
      await hold.release();
    }
  }

  // ---------------------------------------------------------------- limpieza

  async cleanup(): Promise<void> {
    const p = this.h.prisma;
    const orderIds = this.orders;
    const shipmentIds = this.shipments;
    const itemIds = this.items;
    await p.manualRefund.deleteMany({ where: { OR: [{ orderId: { in: orderIds } }, { customerUserId: { in: this.users } }] } });
    await p.paymentRefund.deleteMany({ where: { OR: [{ orderId: { in: orderIds } }, { shipmentRequestId: { in: shipmentIds } }] } });
    await p.replacementCase.deleteMany({ where: { OR: [{ originalInventoryItemId: { in: itemIds } }, { customerUserId: { in: this.users } }] } });
    await p.vaultPlacementItem.deleteMany({ where: { placement: { orderId: { in: orderIds } } } });
    await p.vaultPlacement.deleteMany({ where: { orderId: { in: orderIds } } });
    // (también los retiros que el CLIENTE creó por HTTP durante la corrida: no pasan por `mkWithdrawal`)
    const mine = await p.shipmentRequest.findMany({ where: { OR: [{ id: { in: shipmentIds } }, { orderId: { in: orderIds } }, { userId: { in: this.users } }] }, select: { id: true } });
    const allShipmentIds = [...new Set([...shipmentIds, ...mine.map((s) => s.id)])];
    await p.paymentRefund.deleteMany({ where: { shipmentRequestId: { in: allShipmentIds } } });
    await p.shipmentItem.deleteMany({ where: { OR: [{ shipmentRequestId: { in: allShipmentIds } }, { inventoryItemId: { in: itemIds } }] } });
    await p.shipmentRequest.deleteMany({ where: { id: { in: allShipmentIds } } });
    await p.orderAccessToken.deleteMany({ where: { orderId: { in: orderIds } } });
    await p.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await p.order.deleteMany({ where: { id: { in: orderIds } } });
    await p.inventoryMovement.deleteMany({ where: { itemId: { in: itemIds } } });
    await p.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
    await p.priceReference.deleteMany({ where: { cardId: { in: this.cards } } });
    await p.card.deleteMany({ where: { id: { in: this.cards } } });
    await p.vaultLocation.deleteMany({ where: { id: { in: this.locations } } });
    await p.auditLog.deleteMany({ where: { OR: [{ entityId: { in: [...orderIds, ...shipmentIds] } }, { actorUserId: { in: this.users } }] } });
    await p.processedStripeEvent.deleteMany({ where: { id: { startsWith: 'evt_e2e_' } } });
    await p.kycProfile.deleteMany({ where: { userId: { in: this.users } } });
    await p.address.deleteMany({ where: { userId: { in: this.users } } });
    await p.user.deleteMany({ where: { id: { in: this.users } } });
  }
}

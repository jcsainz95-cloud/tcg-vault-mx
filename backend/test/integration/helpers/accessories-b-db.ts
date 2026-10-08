/**
 * accessories-b-db.ts — FIXTURES del stream (B) de accesorios (§AC.4–§AC.12) contra Postgres REAL. Propiedad: backend.
 *
 * Todo lo que el cobro de accesorios necesita, sembrado con `Prisma` directo donde el contrato no da verbo (el
 * catálogo de accesorios activos con foto, el deck publicado con su lista firmada, las cajas con tarifa) y por HTTP REAL
 * donde sí lo hay (quote/session/webhook firmado/preparación/M3). Nombres con la etiqueta de la corrida (`run`).
 *
 * `cleanup()` deja la BD como estaba: renglones, pedidos, accesorios propios, decks, cajas y las 8 energías de la semilla
 * de `M-73` devueltas a su estado (inactivas, sin foto, 0 existencias, MX$5).
 */
import { randomBytes, randomUUID } from 'crypto';
import { AccessoryCategory, EnergyType, Prisma } from '@prisma/client';
import { E2EHarness, ApiResponse } from './e2e-app';
import { E2E_FOLIOS, E2E_USERS } from '../../../prisma/e2e-fixtures';
import { PiiCryptoService } from '../../../src/common/crypto/pii-crypto.service';
import { signPullToken } from '../../../src/modules/decks-meta/deck-pull-token';

export const ADDRESS = {
  line1: 'Av. Reforma 100',
  line2: 'Depto 3',
  neighborhood: 'Juárez',
  city: 'Ciudad de México',
  state: 'CDMX',
  postalCode: '06600',
  country: 'MX',
  phone: '5512345678',
  recipientName: 'Juan Pérez López',
};

export interface Dims {
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  weightG: number;
}

export const FUNDA_DIMS: Dims = { lengthMm: 70, widthMm: 95, heightMm: 5, weightG: 20 };
export const PLAYMAT_DIMS: Dims = { lengthMm: 600, widthMm: 350, heightMm: 3, weightG: 400 };
/** Una «caja de mazo» gigante que no cabe en ninguna caja de prueba (criterio 728). */
export const HUGE_DIMS: Dims = { lengthMm: 800, widthMm: 450, heightMm: 120, weightG: 2000 };

const hex16 = () => randomBytes(8).toString('hex');

export class AccDb {
  readonly orders = new Set<string>();
  readonly accessories: string[] = [];
  readonly items: string[] = [];
  readonly decks: string[] = [];
  readonly packages: string[] = [];
  private seq = 0;
  private template!: { cardId: string; locationId: string | null };
  energy!: Record<EnergyType, string>;
  opToken!: string;
  adminToken!: string;
  customerToken!: string;
  pii!: PiiCryptoService;
  /** `E_base` — la tarifa de hoy exhibida (cotizada sobre un carrito solo de cartas). */
  eBase!: number;

  constructor(
    readonly h: E2EHarness,
    readonly run: string,
  ) {}

  async init(): Promise<void> {
    const base = await this.h.prisma.inventoryItem.findUniqueOrThrow({ where: { folio: E2E_FOLIOS.listedCharizard } });
    this.template = { cardId: base.cardId, locationId: base.locationId };
    const rows = await this.h.prisma.accessory.findMany({ where: { category: 'energy' } });
    this.energy = Object.fromEntries(rows.map((r) => [r.energyType!, r.id])) as Record<EnergyType, string>;
    this.opToken = await this.h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    this.adminToken = await this.h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    this.customerToken = await this.h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    this.pii = this.h.app.get(PiiCryptoService);
    await this.resetEnergies();
    await this.clearBoxFees();
    const item = await this.mkItem();
    const q = await this.quote({ inventoryItemIds: [item.id] });
    if (q.status !== 200) throw new Error(`init quote ${q.status} ${q.text}`);
    this.eBase = q.body.breakdown.shippingFeeCents;
  }

  // ------------------------------------------------------------------ catálogo

  /** Pieza vendible propia de la corrida (clona la carta del seed). `listPriceCents` fija el precio (peldaño «pieza»). */
  async mkItem(opts: { productType?: 'raw' | 'sealed'; listPriceCents?: number } = {}) {
    this.seq += 1;
    const sealed = opts.productType === 'sealed';
    const it = await this.h.prisma.inventoryItem.create({
      data: {
        folio: `ACB-${this.run}-${this.seq}`,
        cardId: this.template.cardId,
        productType: sealed ? 'sealed' : 'raw',
        rawCondition: sealed ? null : 'NM',
        sealedSubtype: sealed ? 'box' : null,
        sealedCondition: sealed ? 'mint' : null,
        finish: 'normal',
        ownerType: 'platform',
        status: 'listed',
        acquisitionType: 'compra',
        acquisitionCostCents: 70000,
        locationId: this.template.locationId,
        ...(opts.listPriceCents !== undefined ? { listPriceCents: opts.listPriceCents } : sealed ? { listPriceCents: 60000 } : {}),
      },
    });
    this.items.push(it.id);
    return it;
  }

  /** Accesorio ACTIVO con foto (fila `AccessoryPhoto` real: la URL de la foto responde 200). */
  async mkAccessory(o: {
    name?: string;
    category?: AccessoryCategory;
    priceCents: number;
    stockQty: number;
    unitCostCents?: number | null;
    dims?: Dims | null;
    active?: boolean;
  }) {
    this.seq += 1;
    const version = hex16();
    const dims = o.dims === undefined ? FUNDA_DIMS : o.dims;
    const a = await this.h.prisma.accessory.create({
      data: {
        name: o.name ?? `ACB ${this.run} ${this.seq}`,
        category: o.category ?? 'sleeves',
        priceCents: o.priceCents,
        unitCostCents: o.unitCostCents === undefined ? 1000 : o.unitCostCents,
        stockQty: o.stockQty,
        ...(dims ? dims : {}),
        photoVersion: version,
        active: false,
      },
    });
    await this.h.prisma.accessoryPhoto.create({
      data: {
        accessoryId: a.id,
        version,
        fullWebp: Buffer.from(`full-${version}`),
        thumbWebp: Buffer.from(`thumb-${version}`),
        sourceMime: 'image/png',
        sourceBytes: 10,
        uploadedByUserId: 'acb-fixture',
      },
    });
    if (o.active !== false) await this.h.prisma.accessory.update({ where: { id: a.id }, data: { active: true } });
    this.accessories.push(a.id);
    return { ...a, photoVersion: version };
  }

  /** Reemplaza la foto (nueva versión) — AC-B55. */
  async replacePhoto(accessoryId: string): Promise<string> {
    const version = hex16();
    await this.h.prisma.$transaction([
      this.h.prisma.accessoryPhoto.update({ where: { accessoryId }, data: { version, fullWebp: Buffer.from(`full-${version}`), thumbWebp: Buffer.from(`thumb-${version}`) } }),
      this.h.prisma.accessory.update({ where: { id: accessoryId }, data: { photoVersion: version } }),
    ]);
    return version;
  }

  /** Producto «Energía <tipo>» de la semilla: activo, MX$5 (o lo dado), con foto y existencias. */
  async setEnergy(t: EnergyType, o: { stockQty?: number; priceCents?: number; active?: boolean; unitCostCents?: number | null; dims?: Dims | null } = {}) {
    const id = this.energy[t];
    const cur = await this.h.prisma.accessory.findUniqueOrThrow({ where: { id } });
    let version = cur.photoVersion;
    if (!version) {
      version = hex16();
      await this.h.prisma.accessoryPhoto.upsert({
        where: { accessoryId: id },
        create: { accessoryId: id, version, fullWebp: Buffer.from('f'), thumbWebp: Buffer.from('t'), sourceMime: 'image/png', sourceBytes: 1, uploadedByUserId: 'acb-fixture' },
        update: { version },
      });
    }
    await this.h.prisma.accessory.update({ where: { id }, data: { reservedQty: 0 } });
    await this.h.prisma.accessory.update({
      where: { id },
      data: {
        photoVersion: version,
        priceCents: o.priceCents ?? 500,
        unitCostCents: o.unitCostCents === undefined ? 200 : o.unitCostCents,
        stockQty: o.stockQty ?? 40,
        ...(o.dims === undefined ? {} : o.dims === null ? { lengthMm: null, widthMm: null, heightMm: null, weightG: null } : o.dims),
        active: o.active ?? true,
      },
    });
    return id;
  }

  async resetEnergies(): Promise<void> {
    for (const id of Object.values(this.energy)) {
      await this.h.prisma.accessory.update({
        where: { id },
        data: { active: false, reservedQty: 0, stockQty: 0, priceCents: 500, unitCostCents: null, photoVersion: null, lengthMm: null, widthMm: null, heightMm: null, weightG: null },
      });
    }
    await this.h.prisma.accessoryPhoto.deleteMany({ where: { accessoryId: { in: Object.values(this.energy) } } });
  }

  async stockOf(accessoryId: string) {
    return this.h.prisma.accessory.findUniqueOrThrow({ where: { id: accessoryId }, select: { stockQty: true, reservedQty: true } });
  }

  // ------------------------------------------------------------------ cajas

  /** Cajas de prueba con tarifa (las de la semilla quedan sin tarifa ⇒ no cuentan). */
  async setBoxes(boxes: { code: string; l: number; w: number; h: number; fee: number | null; sortOrder?: number; active?: boolean }[]) {
    await this.clearBoxes();
    for (const b of boxes) {
      const code = `${b.code}-${this.run}`;
      const p = await this.h.prisma.shippingPackage.create({
        data: { code, label: b.code.toUpperCase(), lengthCm: b.l, widthCm: b.w, heightCm: b.h, weightKg: 1, providerPackageType: '4G', customerFeeCents: b.fee, sortOrder: b.sortOrder ?? 0, active: b.active ?? true },
      });
      this.packages.push(p.id);
    }
  }

  async clearBoxes(): Promise<void> {
    if (this.packages.length > 0) await this.h.prisma.shippingPackage.deleteMany({ where: { id: { in: this.packages } } });
    this.packages.length = 0;
  }

  /** Las cajas que no son de esta corrida no cobran (catálogo con tarifa VACÍO, F3). */
  async clearBoxFees(): Promise<void> {
    await this.h.prisma.shippingPackage.updateMany({ where: { NOT: { code: { endsWith: `-${this.run}` } } }, data: { customerFeeCents: null } });
  }

  // ------------------------------------------------------------------ decks

  /**
   * Deck PUBLICADO con su lista: `cards` copias de carta (casadas) y las energías básicas dadas
   * (`unmatched_basic_energy`). P-AC-4: firmar ≥ ⌈cards/2⌉ ids.
   */
  async mkDeck(o: { cards?: number; energies: { rawName: string; quantity: number }[]; published?: boolean }) {
    this.seq += 1;
    const slug = `acb-${this.run}-${this.seq}`;
    const deck = await this.h.prisma.metaDeck.create({ data: { slug, name: `Deck ${this.run} ${this.seq}`, published: o.published ?? true, rank: 1 } });
    const list = await this.h.prisma.metaDeckList.create({
      data: {
        deckId: deck.id,
        formatLabel: 'Standard',
        activeMarksSnapshot: [] as Prisma.InputJsonValue,
        cards: {
          create: [
            { rawName: 'Carta del deck', rawSetCode: 'ACB', rawNumber: '1', quantity: o.cards ?? 2, group: 'pokemon', matchStatus: 'matched', matchedCardId: this.template.cardId },
            ...o.energies.map((e) => ({ rawName: e.rawName, rawSetCode: '', rawNumber: '', quantity: e.quantity, group: 'energy' as const, matchStatus: 'unmatched_basic_energy' as const })),
          ],
        },
      },
    });
    await this.h.prisma.metaDeck.update({ where: { id: deck.id }, data: { currentListId: list.id } });
    this.decks.push(deck.id);
    return { id: deck.id, slug, name: deck.name, listId: list.id };
  }

  token(deck: { slug: string; listId: string }, ids: string[], iat = Math.floor(Date.now() / 1000)): string {
    return signPullToken(this.pii, { slug: deck.slug, listId: deck.listId, ids, iat });
  }

  // ------------------------------------------------------------------ verbos HTTP

  quote(json: unknown, token?: string): Promise<ApiResponse> {
    return this.h.api('POST', '/checkout/guest/quote', { json, ...(token ? { token } : {}) });
  }

  email(tag = ''): string {
    this.seq += 1;
    return `acb.${this.run}.${this.seq}${tag}@example.com`;
  }

  async session(json: Record<string, unknown>, opts: { email?: string; token?: string } = {}): Promise<ApiResponse> {
    const r = await this.h.api('POST', '/checkout/guest/session', {
      json: { email: opts.email ?? this.email(), shippingAddress: ADDRESS, acceptedTerms: true, ...json },
      ...(opts.token ? { token: opts.token } : {}),
    });
    if (r.body?.orderId) this.orders.add(r.body.orderId);
    return r;
  }

  async settle(s: ApiResponse): Promise<ApiResponse> {
    const r = await this.h.sendStripeWebhook({
      type: 'payment_intent.succeeded',
      data: { object: { id: s.body.stripe.paymentIntentId, object: 'payment_intent', amount: s.body.breakdown.totalCents, amount_received: s.body.breakdown.totalCents, currency: 'mxn' } },
    });
    if (r.status !== 200) throw new Error(`settle ${r.status} ${r.text}`);
    this.h.stripe.chargedByIntent.set(s.body.stripe.paymentIntentId, s.body.breakdown.totalCents);
    return r;
  }

  failPayment(paymentIntentId: string): Promise<ApiResponse> {
    return this.h.sendStripeWebhook({ type: 'payment_intent.payment_failed', data: { object: { id: paymentIntentId, object: 'payment_intent' } } });
  }

  /** Pedido liquidado por HTTP real. */
  async paidOrder(json: Record<string, unknown>) {
    const s = await this.session(json);
    if (s.status !== 201) throw new Error(`session ${s.status} ${s.text}`);
    await this.settle(s);
    const shipment = await this.h.prisma.shipmentRequest.findFirstOrThrow({ where: { orderId: s.body.orderId } });
    return { s, orderId: s.body.orderId as string, shipmentId: shipment.id, total: s.body.breakdown.totalCents as number };
  }

  shipmentDetail(id: string, token = this.opToken) {
    return this.h.api('GET', `/admin/shipments/${id}`, { token });
  }
  pickingList(token = this.opToken) {
    return this.h.api('GET', '/admin/shipments/picking-list', { token });
  }
  markCard(shipmentId: string, lineId: string, json: unknown, token = this.opToken) {
    return this.h.api('PATCH', `/admin/shipments/${shipmentId}/prep-items/${lineId}`, { token, json });
  }
  markAcc(shipmentId: string, lineId: string, json: unknown, token = this.opToken) {
    return this.h.api('PATCH', `/admin/shipments/${shipmentId}/prep-accessory-lines/${lineId}`, { token, json });
  }
  prepare(shipmentId: string, expectedRefundCents: number, token = this.opToken) {
    return this.h.api('POST', `/admin/shipments/${shipmentId}/prepared`, { token, json: { expectedRefundCents } });
  }
  tracking(shipmentId: string, token = this.opToken) {
    return this.h.api('POST', `/admin/shipments/${shipmentId}/tracking`, { token, json: { carrier: 'DHL', trackingNumber: `T-${this.run}-${randomUUID().slice(0, 8)}` } });
  }
  status(shipmentId: string, to: string, token = this.opToken) {
    return this.h.api('PATCH', `/admin/shipments/${shipmentId}/status`, { token, json: { to } });
  }
  adminOrder(id: string, token = this.adminToken) {
    return this.h.api('GET', `/admin/orders/${id}`, { token });
  }
  refundAccDelivered(orderId: string, lineId: string, json: unknown, token = this.adminToken) {
    return this.h.api('POST', `/admin/orders/${orderId}/accessory-lines/${lineId}/refund-delivered`, { token, json });
  }
  fullRefund(orderId: string, json: Record<string, unknown> = { reason: 'prueba' }, token = this.adminToken) {
    return this.h.api('POST', `/admin/orders/${orderId}/refund`, { token, json });
  }
  track(clearToken: string) {
    return this.h.api('POST', '/orders/guest/track', { json: { token: clearToken } });
  }

  /** Palomea TODO (cartas y renglones), prepara (sin faltantes) y lleva el envío hasta `to`. */
  async shipAll(shipmentId: string, to: 'enviado' | 'entregado' = 'entregado') {
    const items = await this.h.prisma.shipmentItem.findMany({ where: { shipmentRequestId: shipmentId } });
    for (const it of items) if (it.prepStatus === 'pending') await this.expectOk(this.markCard(shipmentId, it.id, { status: 'picked' }));
    const acc = await this.h.prisma.shipmentAccessoryLine.findMany({ where: { shipmentRequestId: shipmentId } });
    for (const l of acc) if (l.prepStatus === 'pending') await this.expectOk(this.markAcc(shipmentId, l.id, { status: 'picked' }));
    await this.expectOk(this.prepare(shipmentId, 0));
    await this.expectOk(this.tracking(shipmentId));
    await this.expectOk(this.status(shipmentId, 'enviado'));
    if (to === 'entregado') await this.expectOk(this.status(shipmentId, 'entregado'));
  }

  private async expectOk(p: Promise<ApiResponse>) {
    const r = await p;
    if (r.status >= 300) throw new Error(`fixture: ${r.status} ${r.text}`);
    return r;
  }

  // ------------------------------------------------------------------ limpieza

  async cleanup(): Promise<void> {
    const p = this.h.prisma;
    const orderIds = [...this.orders];
    const ships = await p.shipmentRequest.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
    const shipIds = ships.map((s) => s.id);
    await p.paymentRefund.deleteMany({ where: { orderId: { in: orderIds } } });
    await p.shipmentAccessoryLine.deleteMany({ where: { shipmentRequestId: { in: shipIds } } });
    await p.shipmentPaidLabel.deleteMany({ where: { shipmentRequestId: { in: shipIds } } });
    await p.shipmentLabelAttempt.deleteMany({ where: { shipmentRequestId: { in: shipIds } } });
    await p.shipmentItem.deleteMany({ where: { shipmentRequestId: { in: shipIds } } });
    await p.shipmentRequest.deleteMany({ where: { id: { in: shipIds } } });
    await p.orderEnergyBundleComponent.deleteMany({ where: { line: { orderId: { in: orderIds } } } });
    await p.orderAccessoryLine.deleteMany({ where: { orderId: { in: orderIds } } });
    await p.orderAccessToken.deleteMany({ where: { orderId: { in: orderIds } } });
    await p.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await p.inventoryItem.updateMany({ where: { id: { in: this.items } }, data: { reservedByOrderId: null } });
    await p.order.deleteMany({ where: { id: { in: orderIds } } });
    await p.inventoryMovement.deleteMany({ where: { itemId: { in: this.items } } });
    await p.inventoryItem.deleteMany({ where: { id: { in: this.items } } });
    await p.accessoryStockMovement.deleteMany({ where: { accessoryId: { in: [...this.accessories, ...Object.values(this.energy)] } } });
    await p.accessoryPhoto.deleteMany({ where: { accessoryId: { in: this.accessories } } });
    await p.accessory.deleteMany({ where: { id: { in: this.accessories } } });
    await this.resetEnergies();
    for (const id of this.decks) {
      await p.metaDeck.update({ where: { id }, data: { currentListId: null } });
      await p.metaDeckCard.deleteMany({ where: { list: { deckId: id } } });
      await p.metaDeckList.deleteMany({ where: { deckId: id } });
      await p.metaDeck.delete({ where: { id } });
    }
    await this.clearBoxes();
    await p.auditLog.deleteMany({ where: { entityId: { in: [...orderIds, ...shipIds] } } });
  }
}

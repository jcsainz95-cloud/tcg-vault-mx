/**
 * sealed-price.e2e-spec.ts — 💰 v1.83 / v1.83.1 `API_CONTRACT §M11-SP` (SP.8 + errata §M11-SP.12.14) contra Postgres real
 * y por HTTP. Propiedad: backend; la ejecuta QA. Las puras/estáticas viven en `test/sealed-price.sp.spec.ts`.
 *
 *  - SP-2  💰 paridad: `P = 700` del dueño (pieza con legado 1000, mercado presente) en ficha, rejilla, ficha de
 *          sellado, quote (cuenta e invitado), session (cuenta e invitado: `OrderItem.unitPriceCents` y monto del PI),
 *          `pending-publish`, `GET …/items`; y el barrido VQ trata la pieza como «con precio a mano».
 *  - SP-4  💰 roles del `PUT` (200 / 403 / 403 / 401); en los 403 nada escrito.
 *  - SP-5  💰⭐ CAS: `409 { currentDisplayPriceCents }`; carrera FORZADA (N=10) y SUELTA (N=10), con proporción.
 *  - SP-6  💰⭐ re-precio contra checkout: la sesión precia A → barrera → `PUT` B → reserva. FORZADA y SUELTA (N=10 c/u).
 *  - SP-7  el `PUT` (con `reevaluateForPublication` doblado) no toca ninguna pieza; la `listed` pendiente reaparece.
 *  - SP-8  bitácora: una fila, en la misma tx (TRIGGER que la hace fallar ⇒ precio intacto), `pieces` exacto,
 *          el `200` idempotente no escribe.
 *  - SP-9  💰 la tabla de §M11-SP.4 por HTTP (cinco escritores + mercado a mano + raw con operador); v1.83.2
 *           (§M11-SP.13.8): «encontrada» no liga a producto (fila n/a, con canario).
 *  - SP-10 hoja: piezas, costo, automático = `resolvedSalePriceCents` de `GET …/items`, `P`, neto, margen sobre `N`,
 *          vectores de 12.5, dial de fuente off/on, `t = 50`.
 *  - SP-11 cierre de la cola de ESE producto (`context='inventory'`); N-1: la aportación sin mercado re-escala.
 *  - SP-12 💰 `M-71`: sobre un esquema temporal (columna, CHECK, sin relleno, idempotente, cero bitácora) y el
 *          precio efectivo del legado igual (peldaño 2).
 *  - SP-16 💰 A-2: el `PUT` publica lo publicable DESPUÉS del commit; si el intento lanza, `autoPublish: null`.
 *  - SP-16b 💰 v1.83.2 (§M11-SP.13.2): el doble clic no escribe en la tx, pero el disparo corre (es el reintento).
 *  - SP-17 A-1: `sealedProductId` / `sealedProductPieces` en el listado.
 *  - SP-18 💰 el dial de traslación 100 → 50 por su verbo: el `P` del dueño no se mueve; el automático baja. Con
 *          redundancia `P = 7000` (sin ida y vuelta `P → L → P` exacta en 100/16 ni en 50/16): muerde «P desde L».
 *
 * ⚠️ Fila compartida: `iva_transfer_pct` (SP-10, SP-18) y `sealed_price_source` (SP-10): se restauran y se releen.
 */
import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as argon2 from 'argon2';
import { E2EHarness } from './helpers/e2e-app';
import { diferida, esperarBloqueoDeFila } from './helpers/row-lock-barrier';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { InventoryService } from '../../src/modules/inventory/inventory.service';
import { PriceSyncJobService } from '../../src/jobs/price-sync.service';
import { displayPriceCentsOf, taxBaseCentsOf } from '../../src/common/money';

jest.setTimeout(240_000);

const RUN = `sp${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
const SET_ID = `e2e-sp-set-${RUN}`;
const ANCHOR = `e2e-sp-anchor-${RUN}`;
const RAW_CARD = `e2e-sp-raw-${RUN}`;
const N = 10;
const MIGRATION = join(
  __dirname,
  '../../prisma/migrations/20261021120000_m71_sealed_product_owner_display_price/migration.sql',
);
const ADDRESS = {
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

describe('E2E — §M11-SP: el precio del sellado es del producto, lo pone el dueño con IVA (v1.83 / v1.83.1)', () => {
  let h: E2EHarness;
  let admin: string;
  let op: string;
  let cust: string;
  let buyer: string;
  let buyerId: string;
  let customerId: string;
  let shelf: string;
  let pidSeq = Math.floor(Math.random() * 1_000_000) + 7_000_000;
  let seq = 0;
  let sourceBefore: unknown;

  // --------------------------------------------------------------------------------- utilidades
  async function product(o: { owner?: number | null; name?: string; market?: number | 'tcgcsv' | null } = {}) {
    pidSeq += 1;
    const sp = await h.prisma.sealedProduct.create({
      data: {
        setId: SET_ID,
        tcgplayerProductId: pidSeq,
        tcgplayerGroupId: 990_900,
        name: o.name ?? `SP ETB ${RUN} ${pidSeq}`,
        subtype: 'etb',
        ownerDisplayPriceCents: o.owner ?? null,
      },
    });
    if (o.market != null) {
      await h.prisma.priceReference.create({
        data: {
          cardId: ANCHOR,
          productType: 'sealed',
          gradeKey: `sealed:tcg:${pidSeq}`,
          finish: 'normal',
          source: o.market === 'tcgcsv' ? 'tcgcsv' : 'manual',
          priceMxnCents: o.market === 'tcgcsv' ? 100_000 : o.market,
          capturedDate: new Date('2026-10-05T00:00:00.000Z'),
          isManualOverride: o.market !== 'tcgcsv',
          refKind: 'market',
        },
      });
    }
    return sp;
  }

  async function piece(sp: { id: string; tcgplayerProductId: number } | null, o: Record<string, unknown> = {}) {
    seq += 1;
    return h.prisma.inventoryItem.create({
      data: {
        folio: (o.folio as string) ?? `SP-${RUN}-${String(seq).padStart(4, '0')}`,
        cardId: ANCHOR,
        productType: 'sealed',
        sealedSubtype: 'etb',
        sealedCondition: 'mint',
        finish: 'normal',
        acquisitionType: 'compra',
        acquisitionCostCents: 50_000,
        ownerType: 'platform',
        status: 'listed',
        locationId: shelf,
        ...(sp ? { sealedProductId: sp.id, tcgplayerProductId: sp.tcgplayerProductId, tcgplayerGroupId: 990_900 } : {}),
        ...o,
      } as never,
    });
  }

  /** `token: null` ⇒ sin sesión (⛔ `undefined` caería al default). */
  const put = (id: string, json: unknown, token: string | null = admin) =>
    h.api('PUT', `/admin/inventory/sealed-products/${id}/sale-price`, { token: token ?? undefined, json });
  const ownerPrice = async (id: string) =>
    (await h.prisma.sealedProduct.findUniqueOrThrow({ where: { id }, select: { ownerDisplayPriceCents: true } }))
      .ownerDisplayPriceCents;
  const auditRows = (id: string) =>
    h.prisma.auditLog.findMany({
      where: { action: 'sealed_product.sale_price_set', entityId: id },
      orderBy: { createdAt: 'asc' },
    });
  const ivaDials = async () => {
    const rows = await h.prisma.configSetting.findMany({ where: { key: { in: ['iva_transfer_pct', 'iva_pct'] } } });
    const v = (k: string, d: number) => Number(rows.find((r) => r.key === k)?.valueJson ?? d);
    return { t: v('iva_transfer_pct', 100), r: v('iva_pct', 16) };
  };
  async function setTransfer(pct: number) {
    await h.prisma.configSetting.upsert({
      where: { key: 'iva_transfer_pct' },
      create: { key: 'iva_transfer_pct', valueJson: pct },
      update: { valueJson: pct },
    });
  }
  async function setSource(v: 'tcgcsv' | 'off') {
    await h.prisma.configSetting.upsert({
      where: { key: 'sealed_price_source' },
      create: { key: 'sealed_price_source', valueJson: v },
      update: { valueJson: v },
    });
  }
  async function failPi(pi: string) {
    const r = await h.sendStripeWebhook({ type: 'payment_intent.payment_failed', data: { object: { id: pi, object: 'payment_intent' } } });
    expect(r.status).toBe(200);
  }
  function lastIntent(): { id: string; amountCents: number } {
    return h.stripe.createdIntents[h.stripe.createdIntents.length - 1];
  }

  /**
   * Limpieza por PREFIJO (⛔ no solo por la corrida): una corrida muerta a mitad (`kill`, timeout del runner) no llega a
   * su `afterAll` y deja piezas — medido: dos piezas de cliente sembradas aquí pusieron roja
   * `vault-sealed-enum-filters` (cuenta los grupos de un cliente). Por eso: (1) las piezas «de cliente» de esta suite
   * son del comprador PROPIO, nunca del cliente del fixture compartido; (2) `beforeAll` barre también lo de corridas
   * anteriores (`e2e-sp-*`, `sp.buyer.*`).
   */
  async function cleanup() {
    const cards = await h.prisma.card.findMany({ where: { id: { startsWith: 'e2e-sp-' } }, select: { id: true } });
    const cardIds = cards.map((c) => c.id);
    const items = await h.prisma.inventoryItem.findMany({ where: { cardId: { in: cardIds } }, select: { id: true } });
    const itemIds = items.map((i) => i.id);
    const ois = await h.prisma.orderItem.findMany({ where: { inventoryItemId: { in: itemIds } }, select: { orderId: true } });
    const orderIds = [...new Set(ois.map((o) => o.orderId))];
    if (orderIds.length) {
      await h.prisma.shipmentRequest.deleteMany({ where: { orderId: { in: orderIds } } });
      await h.prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    const setWhere = { setId: { startsWith: 'e2e-sp-set-' } };
    const sps = await h.prisma.sealedProduct.findMany({ where: setWhere, select: { id: true } });
    await h.prisma.auditLog.deleteMany({ where: { entityId: { in: [...itemIds, ...sps.map((s) => s.id)] } } });
    await h.prisma.inventoryAdjustment.deleteMany({ where: { inventoryItemId: { in: itemIds } } });
    await h.prisma.inventoryMovement.deleteMany({ where: { itemId: { in: itemIds } } });
    await h.prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
    await h.prisma.pendingPriceEntry.deleteMany({ where: { cardId: { in: cardIds } } });
    await h.prisma.priceReference.deleteMany({ where: { cardId: { in: cardIds } } });
    await h.prisma.sealedProduct.deleteMany({ where: setWhere });
    await h.prisma.card.deleteMany({ where: { id: { in: cardIds } } });
    await h.prisma.cardSet.deleteMany({ where: { id: { startsWith: 'e2e-sp-set-' } } });
    const buyers = await h.prisma.user.findMany({ where: { email: { startsWith: 'sp.buyer.' } }, select: { id: true } });
    const buyerIds = buyers.map((b) => b.id);
    if (buyerIds.length) {
      await h.prisma.shipmentRequest.deleteMany({ where: { userId: { in: buyerIds } } });
      await h.prisma.order.deleteMany({ where: { userId: { in: buyerIds } } });
      await h.prisma.user.deleteMany({ where: { id: { in: buyerIds } } });
    }
  }

  beforeAll(async () => {
    h = await E2EHarness.create();
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    op = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    cust = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    // Barre lo que una corrida anterior muerta a mitad haya dejado (ver `cleanup`).
    await cleanup();
    // Comprador PROPIO (verificado): sus pedidos no se cruzan con los del fixture compartido.
    const buyerEmail = `sp.buyer.${RUN}@e2e.local`;
    buyerId = (
      await h.prisma.user.create({
        data: {
          email: buyerEmail,
          passwordHash: await argon2.hash(E2E_USERS.customer.password),
          name: 'SP Buyer',
          role: 'customer',
          locale: 'es',
          emailVerified: true,
          phone: '5511110099',
        },
      })
    ).id;
    buyer = await h.login(buyerEmail, E2E_USERS.customer.password);
    customerId = buyerId; // las piezas «de cliente» de esta suite son del comprador PROPIO
    shelf = (await h.prisma.vaultLocation.findFirstOrThrow({ where: { zone: 'platform_stock', isActive: true } })).id;
    sourceBefore = (await h.prisma.configSetting.findUnique({ where: { key: 'sealed_price_source' } }))?.valueJson;
    // Los diales de IVA tienen que estar en el NEUTRO al empezar (las cifras de SP-2 lo suponen; si no, se dice).
    expect(await ivaDials()).toEqual({ t: 100, r: 16 });
    await h.prisma.cardSet.create({ data: { id: SET_ID, externalId: SET_ID, name: `SP Set ${RUN}` } });
    await h.prisma.card.create({
      data: { id: ANCHOR, externalId: ANCHOR, setId: SET_ID, name: 'SP Anchor', number: '1', rarity: 'Common', rarityCanonical: 'Common', availableFinishes: ['normal'] },
    });
    await h.prisma.card.create({
      data: { id: RAW_CARD, externalId: RAW_CARD, setId: SET_ID, name: 'SP Raw', number: '2', rarity: 'Common', rarityCanonical: 'Common', availableFinishes: ['normal'] },
    });
  });

  afterAll(async () => {
    if (!h) return;
    await h.prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS sp8_fail_audit ON "AuditLog"`);
    await h.prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS sp8_fail_audit()`);
    await setTransfer(100);
    if (sourceBefore === undefined) await h.prisma.configSetting.deleteMany({ where: { key: 'sealed_price_source' } });
    else await h.prisma.configSetting.update({ where: { key: 'sealed_price_source' }, data: { valueJson: sourceBefore as never } });
    await cleanup();
    const t = await ivaDials();
    await h.close();
    if (t.t !== 100) throw new Error(`iva_transfer_pct quedó en ${t.t}; esta suite debe dejarlo en 100`);
  });

  // ============================================================================================ SP-2
  describe('💰 SP-2 — paridad: UN solo `P` (el del dueño, 700) en todos los sitios', () => {
    it('ficha, rejilla, ficha de sellado, quote y session (cuenta e invitado), cola, listado y barrido VQ', async () => {
      const X = await product({ owner: 700, market: 100_000 });
      const L1 = await piece(X, { listPriceCents: 1000 }); // legado SOMBREADO por el producto
      const L2 = await piece(X); // sin legado
      // ⭐ SU-1 (§M1-SU): sin ubicación y CON precio del producto ⇒ ya NO está en la cola (no le falta nada); su `P` se
      // mide en la fila de M1, abajo.
      const S1 = await piece(X, { status: 'in_stock', locationId: null });

      // Ficha de Compra (pieza) y la de sellado (grupo + piezas).
      const ficha = await h.api('GET', `/catalog/listings/${L1.id}`);
      expect({ s: ficha.status, p: ficha.body.displayPriceCents, b: ficha.body.priceBasis }).toEqual({ s: 200, p: 700, b: 'override' });
      const grid = await h.api('GET', `/catalog/sealed?setId=${SET_ID}&pageSize=50`);
      expect(grid.status).toBe(200);
      expect((grid.body.data as any[]).map((g) => g.fromPriceCents)).toEqual([700]);
      const fichaS = await h.api('GET', `/catalog/sealed/${L1.id}`);
      expect(fichaS.body.group.fromPriceCents).toBe(700);
      expect((fichaS.body.listings as any[]).map((l) => l.displayPriceCents)).toEqual([700, 700]);
      // ⛔ el origen admin no viaja a /catalog.
      expect(JSON.stringify(fichaS.body)).not.toContain('sealedPriceOrigin');

      // Quote (cuenta e invitado).
      const q = await h.api('POST', '/checkout/quote', { token: buyer, json: { inventoryItemIds: [L1.id] } });
      expect(q.status).toBe(200);
      expect(q.body.items.map((i: any) => i.unitPriceCents)).toEqual([700]);
      const gq = await h.api('POST', '/checkout/guest/quote', { json: { inventoryItemIds: [L2.id] } });
      expect(gq.status).toBe(200);
      expect(gq.body.items.map((i: any) => i.unitPriceCents)).toEqual([700]);

      // Session de CUENTA: la línea congela 700 y el PI cobra el total de la sesión.
      const s = await h.api('POST', '/checkout/session', { token: buyer, json: { inventoryItemIds: [L1.id] } });
      expect(s.status).toBe(201);
      const oi = await h.prisma.orderItem.findMany({ where: { orderId: s.body.orderId } });
      expect(oi.map((x) => x.unitPriceCents)).toEqual([700]);
      expect(s.body.breakdown.subtotalCents).toBe(700);
      expect(lastIntent()).toMatchObject({ id: s.body.stripe.paymentIntentId, amountCents: s.body.breakdown.totalCents });
      await failPi(s.body.stripe.paymentIntentId);

      // Session de INVITADO.
      const g = await h.api('POST', '/checkout/guest/session', {
        json: { inventoryItemIds: [L2.id], email: `sp.guest.${RUN}@example.com`, shippingAddress: ADDRESS, acceptedTerms: true, locale: 'es' },
      });
      expect(g.status).toBe(201);
      const goi = await h.prisma.orderItem.findMany({ where: { orderId: g.body.orderId } });
      expect(goi.map((x) => x.unitPriceCents)).toEqual([700]);
      expect(lastIntent()).toMatchObject({ id: g.body.stripe.paymentIntentId, amountCents: g.body.breakdown.totalCents });
      await failPi(g.body.stripe.paymentIntentId);

      // Cola «Listas para publicar» y listado de M1 (admin).
      const pp = await h.api('GET', '/admin/inventory/pending-publish?productType=sealed&pageSize=100', { token: admin });
      expect(pp.status).toBe(200);
      // ⭐ SU-1: S1 (sin cajón, con `P`) no está en la cola — antes salía con `missing: ['location']`.
      expect((pp.body.data as any[]).some((r) => r.inventoryItemId === S1.id)).toBe(false);
      const li = await h.api('GET', `/admin/inventory/items?cardId=${ANCHOR}&productType=sealed&pageSize=100`, { token: admin });
      // La MISMA paridad que la cola le exigía a S1, ahora en su fila de M1 (sigue `in_stock`: el GET no publica).
      expect((li.body.data as any[]).find((r) => r.id === S1.id)).toMatchObject({
        status: 'in_stock',
        resolvedSalePriceCents: 603,
        resolvedDisplayPriceCents: 700,
        sealedPriceOrigin: 'product',
        sealedProductDisplayPriceCents: 700,
      });
      const r1 = (li.body.data as any[]).find((r) => r.id === L1.id);
      expect(r1).toMatchObject({
        listPriceCents: 1000,
        resolvedSalePriceCents: 603,
        resolvedDisplayPriceCents: 700,
        priceBasis: 'override',
        sealedPriceOrigin: 'product',
        sealedProductDisplayPriceCents: 700,
      });
      expect('sealedProduct' in r1).toBe(false);
    });

    it('`price-sync` (barrido VQ): una pieza con precio del PRODUCTO cuenta como «con precio a mano» ⇒ su fila sin motivo se cierra', async () => {
      const Y = await product({ owner: 129_900 });
      const p = await piece(Y); // sin legado: solo el precio del producto la hace vendible
      const row = await h.prisma.pendingPriceEntry.create({
        data: {
          cardId: ANCHOR,
          productType: 'sealed',
          gradeKey: `sealed:tcg:${Y.tcgplayerProductId}`,
          finish: 'normal',
          sealedProductId: Y.id,
          context: 'inventory',
          status: 'open',
          reason: null,
        },
      });
      expect(p.status).toBe('listed');
      await h.app.get(PriceSyncJobService).sweepUnreasonedSaleQueue('publish-all');
      expect((await h.prisma.pendingPriceEntry.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('resolved');
    });
  });

  // ============================================================================================ SP-4
  describe('💰 SP-4 — solo el dueño: roles del `PUT`', () => {
    it('super_admin 200 · vault_operator 403 · customer 403 · sin sesión 401; en los 403 nada escrito', async () => {
      const X = await product({ owner: null });
      for (const [token, status] of [[op, 403], [cust, 403], [null, 401]] as const) {
        const r = await put(X.id, { displayPriceCents: 1500, expectedDisplayPriceCents: null }, token);
        expect({ status: r.status, price: await ownerPrice(X.id), rows: (await auditRows(X.id)).length }).toEqual({ status, price: null, rows: 0 });
      }
      const ok = await put(X.id, { displayPriceCents: 1500, expectedDisplayPriceCents: null });
      expect(ok.status).toBe(200);
      expect(ok.body.data).toMatchObject({ sealedProductId: X.id, ownerDisplayPriceCents: 1500, effectiveOrigin: 'product', displayPriceCents: 1500 });
      expect(await ownerPrice(X.id)).toBe(1500);
    });
    it('forma: 400 VALIDATION_ERROR sin `expectedDisplayPriceCents`, con 0 o con no-entero; 404 si el producto no existe', async () => {
      const X = await product({ owner: null });
      for (const body of [{ displayPriceCents: 1500 }, { displayPriceCents: 0, expectedDisplayPriceCents: null }, { displayPriceCents: 10.5, expectedDisplayPriceCents: null }, { displayPriceCents: 100_000_001, expectedDisplayPriceCents: null }]) {
        const r = await put(X.id, body);
        expect({ s: r.status, c: r.body.error?.code }).toEqual({ s: 400, c: 'VALIDATION_ERROR' });
      }
      expect((await put(`no-existe-${RUN}`, { displayPriceCents: 1500, expectedDisplayPriceCents: null })).status).toBe(404);
      expect(await ownerPrice(X.id)).toBeNull();
    });
  });

  // ============================================================================================ SP-5
  describe('💰 SP-5 ⭐ — CAS: nadie cambia un precio que no vio', () => {
    it('`expectedDisplayPriceCents` distinto ⇒ 409 { currentDisplayPriceCents }, nada escrito', async () => {
      const X = await product({ owner: 1000 });
      const r = await put(X.id, { displayPriceCents: 2000, expectedDisplayPriceCents: 999 });
      expect({ s: r.status, c: r.body.error.code, d: r.body.error.details }).toEqual({ s: 409, c: 'CONFLICT', d: { currentDisplayPriceCents: 1000 } });
      const r2 = await put(X.id, { displayPriceCents: 2000, expectedDisplayPriceCents: null });
      expect(r2.body.error.details).toEqual({ currentDisplayPriceCents: 1000 });
      expect([await ownerPrice(X.id), (await auditRows(X.id)).length]).toEqual([1000, 0]);
    });

    async function forcedRound() {
      const X = await product({ owner: 1000 });
      const candado = diferida();
      const soltar = diferida();
      const tx = h.prisma.$transaction(
        async (t) => {
          await t.$executeRawUnsafe(`SELECT id FROM "SealedProduct" WHERE id = $1 FOR UPDATE`, X.id);
          candado.abrir();
          await soltar.promesa;
        },
        { timeout: 60_000, maxWait: 60_000 },
      );
      let ps: Promise<any>[] = [];
      try {
        await candado.promesa;
        ps = [
          put(X.id, { displayPriceCents: 1100, expectedDisplayPriceCents: 1000 }),
          put(X.id, { displayPriceCents: 1200, expectedDisplayPriceCents: 1000 }),
        ];
        await esperarBloqueoDeFila(h.prisma, 'SealedProduct', 2);
      } finally {
        soltar.abrir();
      }
      await tx;
      const res = await Promise.all(ps);
      return { X, res };
    }

    it(`FORZADA (N=${N}): un 200, un 409, UNA fila cuyo «antes» es el inicial`, async () => {
      const verdicts: string[] = [];
      for (let i = 0; i < N; i++) {
        const { X, res } = await forcedRound();
        const statuses = res.map((r) => r.status).sort();
        const rows = await auditRows(X.id);
        const ok = JSON.stringify(statuses) === '[200,409]' && rows.length === 1 && (rows[0].before as any).ownerDisplayPriceCents === 1000;
        verdicts.push(ok ? 'ok' : `KO ${JSON.stringify({ statuses, rows: rows.map((r) => r.before) })}`);
      }
      // eslint-disable-next-line no-console
      console.log(`[SP-5 forzada] ${verdicts.filter((v) => v === 'ok').length}/${N} ok`);
      expect(verdicts).toEqual(Array(N).fill('ok'));
    });

    it(`SUELTA (N=${N}): o un 200 y un 409 con una fila, o dos 200 EN SERIE con fila2.before === fila1.after`, async () => {
      const kinds: string[] = [];
      for (let i = 0; i < N; i++) {
        const X = await product({ owner: 1000 });
        const res = await Promise.all([
          put(X.id, { displayPriceCents: 1100, expectedDisplayPriceCents: 1000 }),
          put(X.id, { displayPriceCents: 1200, expectedDisplayPriceCents: 1000 }),
        ]);
        const st = res.map((r) => r.status).sort();
        const rows = await auditRows(X.id);
        if (JSON.stringify(st) === '[200,409]' && rows.length === 1 && (rows[0].before as any).ownerDisplayPriceCents === 1000) kinds.push('200+409');
        else if (JSON.stringify(st) === '[200,200]' && rows.length === 2 && (rows[1].before as any).ownerDisplayPriceCents === (rows[0].after as any).ownerDisplayPriceCents) kinds.push('serie');
        else kinds.push(`KO ${JSON.stringify({ st, rows: rows.map((r) => [r.before, r.after]) })}`);
      }
      // eslint-disable-next-line no-console
      console.log(`[SP-5 suelta] 200+409: ${kinds.filter((k) => k === '200+409').length}/${N} · serie: ${kinds.filter((k) => k === 'serie').length}/${N}`);
      expect(kinds.filter((k) => k.startsWith('KO'))).toEqual([]);
    });
  });

  // ============================================================================================ SP-6
  describe('💰 SP-6 ⭐ — re-precio contra el checkout: nadie paga una cifra distinta de la que la sesión devolvió', () => {
    async function round(forced: boolean) {
      const X = await product({ owner: 1000 });
      const p = await piece(X);
      let session: Promise<any>;
      let putRes: any;
      if (forced) {
        const candado = diferida();
        const soltar = diferida();
        const tx = h.prisma.$transaction(
          async (t) => {
            await t.$executeRawUnsafe(`SELECT id FROM "InventoryItem" WHERE id = $1 FOR UPDATE`, p.id);
            candado.abrir();
            await soltar.promesa;
          },
          { timeout: 60_000, maxWait: 60_000 },
        );
        try {
          await candado.promesa;
          session = h.api('POST', '/checkout/session', { token: buyer, json: { inventoryItemIds: [p.id] } });
          // La sesión YA precio (fuera de su tx) y está bloqueada DENTRO de su tx: el `INSERT "OrderItem"` de la orden
          // pide `FOR KEY SHARE` sobre la pieza (FK) y espera al `FOR UPDATE` de la prueba — antes de reservarla.
          await esperarBloqueoDeFila(h.prisma, 'OrderItem', 1);
          // ⛔ El `PUT` no escribe piezas ⇒ NO puede esperar a la reserva del checkout (§4.62.4). Si lo hiciera (p. ej.
          // un fan-out de `listPriceCents`), se quedaría bloqueado detrás del candado de la prueba: se le da un plazo
          // y, vencido, se registra `PUT_BLOQUEADO` y se suelta — la prueba falla en vez de colgarse.
          const putP = put(X.id, { displayPriceCents: 2000, expectedDisplayPriceCents: 1000 });
          const bloqueado = await Promise.race([
            putP.then(() => false),
            new Promise<boolean>((r) => setTimeout(() => r(true), 15_000)),
          ]);
          if (bloqueado) {
            soltar.abrir();
            await putP.catch(() => undefined);
            putRes = { status: 'PUT_BLOQUEADO' };
          } else {
            putRes = await putP;
          }
        } finally {
          soltar.abrir();
        }
        await tx;
      } else {
        session = h.api('POST', '/checkout/session', { token: buyer, json: { inventoryItemIds: [p.id] } });
        putRes = await put(X.id, { displayPriceCents: 2000, expectedDisplayPriceCents: 1000 });
      }
      const s = await session!;
      const oi = s.status === 201 ? await h.prisma.orderItem.findMany({ where: { orderId: s.body.orderId } }) : [];
      const intent = s.status === 201 ? h.stripe.createdIntents.find((x) => x.id === s.body.stripe.paymentIntentId) : undefined;
      const status = (await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: p.id } })).status;
      const out = {
        put: putRes.status,
        session: s.status,
        line: oi.map((x) => x.unitPriceCents)[0],
        piEqualsSession: intent?.amountCents === s.body?.breakdown?.totalCents,
        subtotalEqualsLines: s.body?.breakdown?.subtotalCents === oi.reduce((a, x) => a + x.unitPriceCents, 0),
        status,
      };
      if (s.status === 201) await failPi(s.body.stripe.paymentIntentId);
      // Tras liberar, la pieza cotiza el precio NUEVO.
      const q = await h.api('POST', '/checkout/quote', { token: buyer, json: { inventoryItemIds: [p.id] } });
      return { ...out, after: q.body.items?.[0]?.unitPriceCents };
    }

    it(`FORZADA (N=${N}): la línea es P(A)=1000, PI = total de la sesión = Σ líneas, el PUT 200, la pieza reservada; tras cancelar cotiza P(B)`, async () => {
      const got: string[] = [];
      for (let i = 0; i < N; i++) {
        const r = await round(true);
        const ok = r.put === 200 && r.session === 201 && r.line === 1000 && r.piEqualsSession && r.subtotalEqualsLines && r.status === 'reserved' && r.after === 2000;
        got.push(ok ? 'ok' : `KO ${JSON.stringify(r)}`);
      }
      // eslint-disable-next-line no-console
      console.log(`[SP-6 forzada] ${got.filter((g) => g === 'ok').length}/${N} ok`);
      expect(got).toEqual(Array(N).fill('ok'));
    });

    it(`SUELTA (N=${N}): la línea es A o B, y SIEMPRE PI = total de la sesión = Σ líneas`, async () => {
      const got: string[] = [];
      for (let i = 0; i < N; i++) {
        const r = await round(false);
        const ok = r.put === 200 && r.session === 201 && [1000, 2000].includes(r.line) && r.piEqualsSession && r.subtotalEqualsLines && r.after === 2000;
        got.push(ok ? `ok:${r.line}` : `KO ${JSON.stringify(r)}`);
      }
      // eslint-disable-next-line no-console
      console.log(`[SP-6 suelta] A(1000): ${got.filter((g) => g === 'ok:1000').length}/${N} · B(2000): ${got.filter((g) => g === 'ok:2000').length}/${N}`);
      expect(got.filter((g) => g.startsWith('KO'))).toEqual([]);
    });
  });

  // ============================================================================================ SP-7 / SP-16
  describe('SP-7 — la tx del `PUT` no toca piezas (con `reevaluateForPublication` doblado)', () => {
    it('updatedAt/status/listPriceCents iguales; la in_stock con ubicación sigue in_stock; la listed pendiente reaparece en /catalog/sealed', async () => {
      const X = await product({ owner: null }); // sin mercado: el automático está pendiente
      const a = await piece(X, { status: 'in_stock' });
      const b = await piece(X); // listed sin precio resoluble
      const c = await piece(X, { listPriceCents: null, status: 'in_stock', locationId: null });
      const before = await h.prisma.inventoryItem.findMany({ where: { sealedProductId: X.id }, select: { id: true, updatedAt: true, status: true, listPriceCents: true }, orderBy: { id: 'asc' } });
      expect((await h.api('GET', `/catalog/sealed?setId=${SET_ID}&pageSize=50`)).body.data.some((g: any) => g.representativeItemId === b.id)).toBe(false);
      const spy = jest.spyOn(h.app.get(InventoryService), 'reevaluateForPublication').mockResolvedValue([]);
      try {
        const r = await put(X.id, { displayPriceCents: 129_900, expectedDisplayPriceCents: null });
        expect(r.status).toBe(200);
        // El disparo recibe EXACTAMENTE las in_stock de plataforma del producto (con y sin ubicación).
        expect([...(spy.mock.calls[0][0] as string[])].sort()).toEqual([a.id, c.id].sort());
      } finally {
        spy.mockRestore();
      }
      const after = await h.prisma.inventoryItem.findMany({ where: { sealedProductId: X.id }, select: { id: true, updatedAt: true, status: true, listPriceCents: true }, orderBy: { id: 'asc' } });
      expect(after).toEqual(before);
      const grid = await h.api('GET', `/catalog/sealed?setId=${SET_ID}&pageSize=50`);
      expect(grid.body.data.find((g: any) => g.representativeItemId === b.id)?.fromPriceCents).toBe(129_900);
    });
  });

  describe('💰 SP-16 — A-2: el `PUT` publica lo publicable DESPUÉS del commit', () => {
    it('A (in_stock con ubicación) ⇒ listed; B (sin ubicación) ⇒ listed (SU-1); C (listed) y D (de cliente) intactas; autoPublish {2,0,0}; una fila', async () => {
      const X = await product({ owner: null });
      const A = await piece(X, { status: 'in_stock' });
      const B = await piece(X, { status: 'in_stock', locationId: null });
      const C = await piece(X);
      const D = await piece(X, { ownerType: 'customer', ownerUserId: customerId, ownershipStatus: 'settled', status: 'in_custody', locationId: null });
      const snap = async (id: string) => h.prisma.inventoryItem.findUniqueOrThrow({ where: { id }, select: { status: true, updatedAt: true, listPriceCents: true } });
      const [c0, d0] = [await snap(C.id), await snap(D.id)];
      const r = await put(X.id, { displayPriceCents: 129_900, expectedDisplayPriceCents: null });
      expect(r.status).toBe(200);
      // ⭐ SU-1 (§M1-SU): la pieza sin cajón también se publica; `missingLocation` vale siempre 0 (vocabulario dormido).
      expect(r.body.autoPublish).toEqual({ published: 2, missingLocation: 0, notPublished: 0 });
      expect((await snap(A.id)).status).toBe('listed');
      expect((await snap(B.id)).status).toBe('listed');
      expect([await snap(C.id), await snap(D.id)]).toEqual([c0, d0]);
      expect((await auditRows(X.id)).length).toBe(1);
      // La fila se relee DESPUÉS del intento: A y B ya cuentan como listed.
      expect(r.body.data.pieces).toEqual({ inStock: 0, listed: 3, reserved: 0 });
    });
    it('⭐ SU-B4 · una pieza SIN ubicación: el `PUT` la publica — `autoPublish {published:1, missingLocation:0, notPublished:0}`', async () => {
      const X = await product({ owner: null });
      const B = await piece(X, { status: 'in_stock', locationId: null });
      const r = await put(X.id, { displayPriceCents: 129_900, expectedDisplayPriceCents: null });
      expect(r.status).toBe(200);
      expect(r.body.autoPublish).toEqual({ published: 1, missingLocation: 0, notPublished: 0 });
      const after = await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: B.id }, select: { status: true, locationId: true } });
      // Publicar no es ubicar: el cajón sigue vacío.
      expect(after).toEqual({ status: 'listed', locationId: null });
    });
    it('con `reevaluateForPublication` que LANZA: 200, `autoPublish: null`, precio confirmado y bitácora presente', async () => {
      const X = await product({ owner: null });
      const A = await piece(X, { status: 'in_stock' });
      const spy = jest.spyOn(h.app.get(InventoryService), 'reevaluateForPublication').mockRejectedValueOnce(new Error('boom e2e'));
      try {
        const r = await put(X.id, { displayPriceCents: 129_900, expectedDisplayPriceCents: null });
        expect({ s: r.status, a: r.body.autoPublish }).toEqual({ s: 200, a: null });
      } finally {
        spy.mockRestore();
      }
      expect([await ownerPrice(X.id), (await auditRows(X.id)).length]).toEqual([129_900, 1]);
      expect((await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: A.id } })).status).toBe('in_stock');
    });
    // 💰 v1.83.2 (API_CONTRACT §M11-SP.13.2, Q-2): el doble clic NO escribe en la tx (ni precio, ni bitácora, ni cola)
    // pero el disparo post-commit SÍ corre: volver a guardar el mismo precio ES el reintento del dueño cuando el
    // primer clic dio `autoPublish: null`. Cuentas a cero ≠ `null`.
    it('SP-16b · doble clic tras un disparo que lanzó: 200, A listed, `autoPublish {1,0,0}`, cero bitácora/cola nuevas; 3.º ⇒ {0,0,0} (≠ null)', async () => {
      const X = await product({ owner: null });
      const A = await piece(X, { status: 'in_stock' });
      const spy = jest.spyOn(h.app.get(InventoryService), 'reevaluateForPublication').mockRejectedValueOnce(new Error('boom sp16b'));
      try {
        const r1 = await put(X.id, { displayPriceCents: 700, expectedDisplayPriceCents: null });
        expect({ s: r1.status, a: r1.body.autoPublish }).toEqual({ s: 200, a: null });
      } finally {
        spy.mockRestore();
      }
      const status = async () => (await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: A.id } })).status;
      expect(await status()).toBe('in_stock');
      // Una fila `open` de la cola de ESTE producto, puesta DESPUÉS del primer clic: si el paso 2 cerrara la cola
      // (escritura de la tx), dejaría de estar `open`.
      await h.prisma.pendingPriceEntry.create({
        data: { cardId: ANCHOR, productType: 'sealed', gradeKey: `sealed:tcg:${X.tcgplayerProductId}`, finish: 'normal', sealedProductId: X.id, context: 'inventory', status: 'open', reason: 'no_market' },
      });
      const queue = () =>
        h.prisma.pendingPriceEntry.findMany({ where: { sealedProductId: X.id }, orderBy: { id: 'asc' } });
      const productRow = () => h.prisma.sealedProduct.findUniqueOrThrow({ where: { id: X.id } });
      const [q0, p0] = [await queue(), await productRow()];

      const r2 = await put(X.id, { displayPriceCents: 700, expectedDisplayPriceCents: 700 });
      expect({ s: r2.status, a: r2.body.autoPublish }).toEqual({ s: 200, a: { published: 1, missingLocation: 0, notPublished: 0 } });
      expect(await status()).toBe('listed');
      expect((await auditRows(X.id)).length).toBe(1);
      expect(await queue()).toEqual(q0);
      expect(await productRow()).toEqual(p0);

      const r3 = await put(X.id, { displayPriceCents: 700, expectedDisplayPriceCents: 700 });
      expect({ s: r3.status, a: r3.body.autoPublish }).toEqual({ s: 200, a: { published: 0, missingLocation: 0, notPublished: 0 } });
      expect((await auditRows(X.id)).length).toBe(1);
      expect(await queue()).toEqual(q0);
    });
  });

  // ============================================================================================ SP-8
  describe('SP-8 — bitácora: una fila por cambio, en la MISMA tx', () => {
    it('`pieces` cuenta 2 in_stock, 1 listed, 1 reserved (⛔ vendida ni de cliente); `ivaDials` del momento; el 200 idempotente no escribe', async () => {
      const X = await product({ owner: null });
      await piece(X, { status: 'in_stock', locationId: null });
      await piece(X, { status: 'in_stock', locationId: null });
      await piece(X);
      await piece(X, { status: 'reserved' });
      await piece(X, { status: 'shipped', locationId: null });
      await piece(X, { ownerType: 'customer', ownerUserId: customerId, ownershipStatus: 'settled', status: 'in_custody', locationId: null });
      const r = await put(X.id, { displayPriceCents: 145_000, expectedDisplayPriceCents: null });
      expect(r.status).toBe(200);
      const rows = await auditRows(X.id);
      expect(rows.map((x) => ({ a: x.actorRole, t: x.entityType, b: x.before, af: x.after }))).toEqual([
        {
          a: 'super_admin',
          t: 'SealedProduct',
          b: { ownerDisplayPriceCents: null },
          af: { ownerDisplayPriceCents: 145_000, pieces: { inStock: 2, listed: 1, reserved: 1 }, ivaDials: { ivaTransferPct: 100, ivaRatePct: 16 } },
        },
      ]);
      const again = await put(X.id, { displayPriceCents: 145_000, expectedDisplayPriceCents: 145_000 });
      expect(again.status).toBe(200);
      expect((await auditRows(X.id)).length).toBe(1);
    });
    it('si la fila de bitácora FALLA (TRIGGER), el precio NO se escribe', async () => {
      const X = await product({ owner: 1000 });
      await h.prisma.$executeRawUnsafe(
        `CREATE OR REPLACE FUNCTION sp8_fail_audit() RETURNS trigger AS $$ BEGIN
           IF NEW.action = 'sealed_product.sale_price_set' AND NEW."entityId" = '${X.id}' THEN RAISE EXCEPTION 'sp8 audit boom'; END IF;
           RETURN NEW; END $$ LANGUAGE plpgsql`,
      );
      await h.prisma.$executeRawUnsafe(`CREATE TRIGGER sp8_fail_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION sp8_fail_audit()`);
      try {
        const r = await put(X.id, { displayPriceCents: 2000, expectedDisplayPriceCents: 1000 });
        expect(r.status).toBe(500);
      } finally {
        await h.prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS sp8_fail_audit ON "AuditLog"`);
        await h.prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS sp8_fail_audit()`);
      }
      expect([await ownerPrice(X.id), (await auditRows(X.id)).length]).toEqual([1000, 0]);
    });
  });

  // ============================================================================================ SP-9
  describe('💰 SP-9 — el personal da de alta sin precio (§M11-SP.4, por HTTP)', () => {
    const count = () => h.prisma.inventoryItem.count({ where: { cardId: { in: [ANCHOR, RAW_CARD] } } });

    it('POST …/items: sellado ligado + listPriceCents ⇒ 422 con details (también el dueño); nada creado', async () => {
      const X = await product({ owner: null });
      const n0 = await count();
      for (const token of [admin, op]) {
        const r = await h.api('POST', '/admin/inventory/items', {
          token,
          json: { productType: 'sealed', sealedProductId: X.id, acquisitionType: 'compra', acquisitionCostCents: 1000, listPriceCents: 5000 },
        });
        expect({ s: r.status, c: r.body.error.code, d: r.body.error.details }).toEqual({ s: 422, c: 'SEALED_PRICE_IS_PER_PRODUCT', d: { sealedProductId: X.id } });
      }
      expect(await count()).toBe(n0);
    });
    it('POST …/items/batch: lote de 3 con 1 mala ⇒ 422 del LOTE entero, 0 piezas, sin registro del lote', async () => {
      const X = await product({ owner: null });
      const n0 = await count();
      const batchKey = `sp9-${RUN}-${randomBytes(3).toString('hex')}`;
      const r = await h.api('POST', '/admin/inventory/items/batch', {
        token: op,
        json: {
          batchKey,
          items: [
            { productType: 'sealed', sealedProductId: X.id, acquisitionType: 'compra', acquisitionCostCents: 1000 },
            { productType: 'raw', cardId: RAW_CARD, rawCondition: 'NM', acquisitionType: 'compra', acquisitionCostCents: 100, listPriceCents: 500 },
            { productType: 'sealed', sealedProductId: X.id, acquisitionType: 'compra', acquisitionCostCents: 1000, listPriceCents: 7000 },
          ],
        },
      });
      expect({ s: r.status, c: r.body.error?.code }).toEqual({ s: 422, c: 'SEALED_PRICE_IS_PER_PRODUCT' });
      expect(await count()).toBe(n0);
      expect(await h.prisma.inventoryBatch.count({ where: { id: batchKey } })).toBe(0);
    });
    it('sellado SIN producto: operador ⇒ 403 (alta, «encontrada», PATCH, bulk-publish); dueño ⇒ como hoy', async () => {
      const n0 = await count();
      const alta = { productType: 'sealed', cardId: ANCHOR, sealedSubtype: 'etb', acquisitionType: 'compra', acquisitionCostCents: 1000, listPriceCents: 5000 };
      expect((await h.api('POST', '/admin/inventory/items', { token: op, json: alta })).status).toBe(403);
      const found = { reason: 'encontrada', item: { productType: 'sealed', cardId: ANCHOR, sealedSubtype: 'etb', acquisitionType: 'compra', listPriceCents: 5000 } };
      expect((await h.api('POST', '/admin/inventory/adjustments', { token: op, json: found })).status).toBe(403);
      expect(await count()).toBe(n0);
      const created = await h.api('POST', '/admin/inventory/items', { token: admin, json: alta });
      expect(created.status).toBe(201);
      const u = await piece(null, { status: 'in_stock' });
      const pOp = await h.api('PATCH', `/admin/inventory/items/${u.id}`, { token: op, json: { listPriceCents: 4000 } });
      expect(pOp.status).toBe(403);
      const bOp = await h.api('POST', '/admin/inventory/items/bulk-publish', { token: op, json: { items: [{ inventoryItemId: u.id, listPriceCents: 4000 }] } });
      expect(bOp.status).toBe(403);
      expect(await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: u.id }, select: { status: true, listPriceCents: true } })).toEqual({ status: 'in_stock', listPriceCents: null });
      const pAdm = await h.api('PATCH', `/admin/inventory/items/${u.id}`, { token: admin, json: { listPriceCents: 4000 } });
      expect(pAdm.status).toBe(200);
    });
    // v1.83.2 (API_CONTRACT §M11-SP.13.8, Q-6): «encontrada» NO liga a producto. `AdjustmentFoundItemInput` no declara
    // `sealedProductId` ⇒ la lista blanca del `ValidationPipe` lo quita y la fila «ligado ⇒ 422» de ese escritor es
    // n/a. CANARIO: si alguien declara el campo, la del dueño da 422 SEALED_PRICE_IS_PER_PRODUCT en vez de crearse
    // sin producto — y hay que volver a SP.4 (`assertSealedPriceWriters` en `adjustFound` se queda para eso).
    it('SP-9 (v1.83.2) · «encontrada» sellado con `listPriceCents` y `sealedProductId` en el cuerpo: operador 403 sin nada creado; dueño ⇒ creada SIN producto', async () => {
      const X = await product({ owner: null });
      const n0 = await count();
      const found = {
        reason: 'encontrada',
        item: { productType: 'sealed', cardId: ANCHOR, sealedSubtype: 'etb', acquisitionType: 'compra', listPriceCents: 5000, sealedProductId: X.id },
      };
      const rOp = await h.api('POST', '/admin/inventory/adjustments', { token: op, json: found });
      expect({ s: rOp.status, c: rOp.body.error?.code }).toEqual({ s: 403, c: 'FORBIDDEN' });
      expect(await count()).toBe(n0);
      const rAdm = await h.api('POST', '/admin/inventory/adjustments', { token: admin, json: found });
      expect(rAdm.status).toBe(201);
      const ids: string[] = rAdm.body.data?.inventoryItemIds ?? rAdm.body.inventoryItemIds;
      expect(ids).toHaveLength(1);
      expect(
        await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: ids[0] }, select: { productType: true, sealedProductId: true, listPriceCents: true } }),
      ).toEqual({ productType: 'sealed', sealedProductId: null, listPriceCents: 5000 });
      expect(await h.prisma.inventoryItem.count({ where: { sealedProductId: X.id } })).toBe(0);
    });
    it('PATCH y bulk-publish sobre sellado LIGADO ⇒ 422 (también el dueño) con itemId; nada escrito', async () => {
      const X = await product({ owner: null });
      const l = await piece(X, { status: 'in_stock' });
      const p = await h.api('PATCH', `/admin/inventory/items/${l.id}`, { token: admin, json: { listPriceCents: 4000 } });
      expect({ s: p.status, c: p.body.error.code, d: p.body.error.details }).toEqual({ s: 422, c: 'SEALED_PRICE_IS_PER_PRODUCT', d: { sealedProductId: X.id, itemId: l.id } });
      const b = await h.api('POST', '/admin/inventory/items/bulk-publish', { token: admin, json: { items: [{ inventoryItemId: l.id, listPriceCents: 4000 }] } });
      expect({ s: b.status, c: b.body.error?.code }).toEqual({ s: 422, c: 'SEALED_PRICE_IS_PER_PRODUCT' });
      expect(await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: l.id }, select: { status: true, listPriceCents: true } })).toEqual({ status: 'in_stock', listPriceCents: null });
    });
    it('`manualMarketMxnCents` de sellado por el operador ⇒ 403; raw con precio por el operador ⇒ 201 (P-PRE-1)', async () => {
      const X = await product({ owner: null });
      const m = await h.api('POST', '/admin/inventory/items', {
        token: op,
        json: { productType: 'sealed', sealedProductId: X.id, acquisitionType: 'compra', acquisitionCostCents: 1000, manualMarketMxnCents: 80_000 },
      });
      expect(m.status).toBe(403);
      const raw = await h.api('POST', '/admin/inventory/items', {
        token: op,
        json: { productType: 'raw', cardId: RAW_CARD, rawCondition: 'NM', acquisitionType: 'compra', acquisitionCostCents: 100, listPriceCents: 900 },
      });
      expect(raw.status).toBe(201);
    });
  });

  // ============================================================================================ SP-10
  describe('SP-10 — la hoja de M11 (`GET …/sealed-price-sheet`)', () => {
    const sheet = async (token = op, extra = '') => h.api('GET', `/admin/inventory/sealed-price-sheet?setId=${SET_ID}&pageSize=100${extra}`, { token });

    it('piezas, costo, automático = el de `GET …/items`, P, neto, margen sobre N; luego el dueño fija 1500', async () => {
      const X = await product({ owner: null, market: 100_000, name: `AAA SP10 ${RUN}` });
      const s1 = await piece(X, { status: 'in_stock', acquisitionCostCents: 1000 });
      await piece(X, { acquisitionCostCents: 1200 });
      await piece(X, { status: 'reserved', acquisitionCostCents: null });
      await piece(X, { status: 'shipped', locationId: null, acquisitionCostCents: 1 });
      await piece(X, { ownerType: 'customer', ownerUserId: customerId, ownershipStatus: 'settled', status: 'in_custody', locationId: null, acquisitionCostCents: 1 });
      const r = await sheet();
      expect(r.status).toBe(200);
      expect({ canEdit: r.body.canEdit, iva: r.body.iva }).toEqual({ canEdit: false, iva: { ratePct: 16, transferPct: 100 } });
      const row = (r.body.data as any[]).find((x) => x.sealedProductId === X.id);
      const li = await h.api('GET', `/admin/inventory/items?cardId=${ANCHOR}&productType=sealed&status=in_stock&pageSize=100`, { token: admin });
      const auto = (li.body.data as any[]).find((x) => x.id === s1.id).resolvedSalePriceCents;
      const P = displayPriceCentsOf(auto, 100, 16);
      const N0 = taxBaseCentsOf(P, 16);
      expect(row).toMatchObject({
        pieces: { inStock: 1, listed: 1, reserved: 1 },
        cost: { avgCents: 1100, minCents: 1000, maxCents: 1200, withoutCost: 1 },
        ownerDisplayPriceCents: null,
        automaticListPriceCents: auto,
        automaticDisplayPriceCents: P,
        automaticSource: 'subtype_spread',
        effectiveOrigin: 'automatic',
        displayPriceCents: P,
        netPriceCents: N0,
        legacyPiecePrices: { count: 0, minDisplayCents: null, maxDisplayCents: null, shadowed: false },
        margin: { cents: N0 - 1100, bps: Math.round(((N0 - 1100) * 10_000) / N0) },
      });
      expect(row.market).toMatchObject({ status: 'priced' });
      expect(N0).toBe(auto); // con el dial neutro, N ≡ L (12.3)
      const p = await put(X.id, { displayPriceCents: 1500, expectedDisplayPriceCents: null });
      expect(p.body.data).toMatchObject({ ownerDisplayPriceCents: 1500, effectiveOrigin: 'product', displayPriceCents: 1500, netPriceCents: 1293, margin: { cents: 193, bps: 1493 }, automaticListPriceCents: auto });
      expect((await sheet(admin)).body.canEdit).toBe(true);
    });

    it('vectores de §M11-SP.12.5 (r=16) a través de la hoja', async () => {
      const vec = [[145_000, 90_000, 125_000, 35_000, 2_800], [129_900, 100_000, 111_983, 11_983, 1_070], [700, 500, 603, 103, 1_708]];
      const ids: string[] = [];
      for (const [P, avg] of vec) {
        const X = await product({ owner: P });
        await piece(X, { status: 'in_stock', acquisitionCostCents: avg });
        ids.push(X.id);
      }
      const r = await sheet();
      vec.forEach(([P, , N0, cents, bps], i) => {
        const row = (r.body.data as any[]).find((x) => x.sealedProductId === ids[i]);
        expect({ P: row.displayPriceCents, N: row.netPriceCents, m: row.margin }).toEqual({ P, N: N0, m: { cents, bps } });
      });
    });

    it('con `t = 50` el margen de un AUTOMÁTICO es N − avg (≠ L − avg); legado sombreado; fuente `off` ⇒ pendiente', async () => {
      const X = await product({ owner: null, market: 'tcgcsv' });
      const s1 = await piece(X, { status: 'in_stock', acquisitionCostCents: 1000 });
      await piece(X, { listPriceCents: 2000, acquisitionCostCents: 1000 });
      await setSource('tcgcsv');
      await setTransfer(50);
      try {
        const row = (await sheet()).body.data.find((x: any) => x.sealedProductId === X.id);
        const L = row.automaticListPriceCents as number;
        const N0 = taxBaseCentsOf(displayPriceCentsOf(L, 50, 16), 16);
        expect(row.netPriceCents).toBe(N0);
        expect(N0).not.toBe(L);
        expect(row.margin.cents).toBe(N0 - 1000);
        expect(row.legacyPiecePrices).toEqual({ count: 1, minDisplayCents: displayPriceCentsOf(2000, 50, 16), maxDisplayCents: displayPriceCentsOf(2000, 50, 16), shadowed: false });
        expect(s1.id).toBeDefined();
      } finally {
        await setTransfer(100);
      }
      await setSource('off');
      const off = (await sheet()).body.data.find((x: any) => x.sealedProductId === X.id);
      expect(off).toMatchObject({ automaticListPriceCents: null, automaticSource: null, appliedSpreadPct: null, effectiveOrigin: 'pending', displayPriceCents: null, netPriceCents: null, margin: null });
      await put(X.id, { displayPriceCents: 3000, expectedDisplayPriceCents: null });
      const sh = (await sheet()).body.data.find((x: any) => x.sealedProductId === X.id);
      expect(sh.legacyPiecePrices.shadowed).toBe(true);
    });

    it('`scope`: on_hand (default) excluye un producto SOLO con precio del dueño; `all` lo incluye; basura ⇒ 400', async () => {
      const lonely = await product({ owner: 9_900 });
      expect((await sheet()).body.data.some((x: any) => x.sealedProductId === lonely.id)).toBe(false);
      expect((await sheet(op, '&scope=all')).body.data.some((x: any) => x.sealedProductId === lonely.id)).toBe(true);
      const bad = await sheet(op, '&scope=nope');
      expect({ s: bad.status, f: bad.body.error.details.field }).toEqual({ s: 400, f: 'scope' });
      expect((await h.api('GET', '/admin/inventory/sealed-price-sheet', { token: cust })).status).toBe(403);
    });
  });

  // ============================================================================================ SP-11
  describe('SP-11 — el `PUT` cierra la cola de SU producto (context inventory), ⛔ no la de otro; N-1', () => {
    it('cierra X/inventory; deja Y/inventory y X/buylist; una aportación sin mercado re-escala (nueva fila open)', async () => {
      const X = await product({ owner: null });
      const Y = await product({ owner: null });
      const mk = (sp: { id: string; tcgplayerProductId: number }, context: 'inventory' | 'buylist') =>
        h.prisma.pendingPriceEntry.create({
          data: { cardId: ANCHOR, productType: 'sealed', gradeKey: `sealed:tcg:${sp.tcgplayerProductId}`, finish: 'normal', sealedProductId: sp.id, context, status: 'open', reason: 'no_market' },
        });
      const [xi, yi, xb] = [await mk(X, 'inventory'), await mk(Y, 'inventory'), await mk(X, 'buylist')];
      expect((await put(X.id, { displayPriceCents: 129_900, expectedDisplayPriceCents: null })).status).toBe(200);
      const st = async (id: string) => (await h.prisma.pendingPriceEntry.findUniqueOrThrow({ where: { id } })).status;
      expect([await st(xi.id), await st(yi.id), await st(xb.id)]).toEqual(['resolved', 'open', 'open']);
      // N-1: el precio del dueño NO valúa una aportación; sin mercado ⇒ 422 PRICE_PENDING y la cola se re-abre.
      const ap = await h.api('POST', '/admin/inventory/items', {
        token: op,
        json: { productType: 'sealed', sealedProductId: X.id, acquisitionType: 'aportacion_en_especie' },
      });
      expect({ s: ap.status, c: ap.body.error.code }).toEqual({ s: 422, c: 'PRICE_PENDING' });
      const open = await h.prisma.pendingPriceEntry.findMany({ where: { sealedProductId: X.id, context: 'inventory', status: 'open' } });
      expect(open.length).toBe(1);
      expect(open[0].id).not.toBe(xi.id);
    });
  });

  // ============================================================================================ SP-12
  describe('💰 SP-12 — `M-71` sin relleno', () => {
    function statements(sql: string): string[] {
      return sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n').split(';').map((s) => s.trim()).filter((s) => s.length > 0);
    }
    it('sobre la forma de M-70 con datos: columna y CHECK, todo NULL, cero bitácora, idempotente; el CHECK rechaza 0', async () => {
      const schema = `sp12_${randomBytes(4).toString('hex')}`;
      try {
        const out = await h.prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
          await tx.$executeRawUnsafe(`CREATE TABLE "${schema}"."SealedProduct" (LIKE public."SealedProduct" INCLUDING DEFAULTS)`);
          await tx.$executeRawUnsafe(`ALTER TABLE "${schema}"."SealedProduct" DROP COLUMN "ownerDisplayPriceCents"`);
          await tx.$executeRawUnsafe(`CREATE TABLE "${schema}"."AuditLog" (LIKE public."AuditLog" INCLUDING DEFAULTS)`);
          for (let i = 0; i < 3; i++) {
            await tx.$executeRawUnsafe(
              `INSERT INTO "${schema}"."SealedProduct" ("id","setId","tcgplayerProductId","tcgplayerGroupId","name","subtype","updatedAt") VALUES ($1,'s',$2,1,'n','etb',now())`,
              `p${i}`,
              880_000 + i,
            );
          }
          await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}", public`);
          const sql = readFileSync(MIGRATION, 'utf8');
          for (const s of statements(sql)) await tx.$executeRawUnsafe(s);
          for (const s of statements(sql)) await tx.$executeRawUnsafe(s); // idempotente
          const vals = await tx.$queryRawUnsafe<{ v: number | null }[]>(`SELECT "ownerDisplayPriceCents" AS v FROM "${schema}"."SealedProduct"`);
          const audit = await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${schema}"."AuditLog"`);
          const checks = await tx.$queryRawUnsafe<{ conname: string }[]>(
            `SELECT c.conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = $1 AND c.contype = 'c'`,
            schema,
          );
          let rejected = false;
          await tx.$executeRawUnsafe('SAVEPOINT sp12');
          try {
            await tx.$executeRawUnsafe(`UPDATE "${schema}"."SealedProduct" SET "ownerDisplayPriceCents" = 0 WHERE id = 'p0'`);
          } catch {
            rejected = true;
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT sp12');
          }
          return { vals: vals.map((v) => v.v), audit: Number(audit[0].n), checks: checks.map((c) => c.conname), rejected };
        });
        expect(out).toEqual({ vals: [null, null, null], audit: 0, checks: ['sealed_product_owner_display_price_range'], rejected: true });
      } finally {
        await h.prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      }
    });
    it('sin precio del dueño, el legado por pieza cobra EXACTAMENTE lo de antes (peldaño 2)', async () => {
      const X = await product({ owner: null, market: 100_000 });
      const l = await piece(X, { listPriceCents: 1300 });
      expect((await h.api('GET', `/catalog/listings/${l.id}`)).body.displayPriceCents).toBe(displayPriceCentsOf(1300, 100, 16));
    });
  });

  // ============================================================================================ SP-17
  describe('SP-17 — A-1: identidad y conteo del producto en el listado', () => {
    it('2 piezas de X (X tiene 3 in_stock, 1 listed, 1 reserved), 1 sellada sin producto, 1 raw', async () => {
      const X = await product({ owner: null });
      const tag = `SP17-${RUN}`;
      const a = await piece(X, { status: 'in_stock', folio: `${tag}-a` });
      const b = await piece(X, { folio: `${tag}-b` });
      await piece(X, { status: 'in_stock' });
      await piece(X, { status: 'in_stock' });
      await piece(X, { status: 'reserved' });
      const u = await piece(null, { status: 'in_stock', folio: `${tag}-u` });
      const raw = await h.prisma.inventoryItem.create({
        data: { folio: `${tag}-r`, cardId: RAW_CARD, productType: 'raw', rawCondition: 'NM', finish: 'normal', acquisitionType: 'compra', ownerType: 'platform', status: 'in_stock', locationId: shelf },
      });
      const r = await h.api('GET', `/admin/inventory/items?q=${tag}&pageSize=100`, { token: op });
      const by = new Map((r.body.data as any[]).map((x) => [x.id, x]));
      expect(by.get(a.id)).toMatchObject({ sealedProductId: X.id, sealedProductPieces: { inStock: 3, listed: 1, reserved: 1 } });
      expect(by.get(b.id)).toMatchObject({ sealedProductId: X.id, sealedProductPieces: { inStock: 3, listed: 1, reserved: 1 } });
      expect(by.get(u.id).sealedProductId).toBeNull();
      expect('sealedProductPieces' in by.get(u.id)).toBe(false);
      expect(['sealedProductId' in by.get(raw.id), 'sealedProductPieces' in by.get(raw.id)]).toEqual([false, false]);
    });
  });

  // ============================================================================================ SP-18
  describe('💰 SP-18 — el dial de traslación 100 → 50 por su verbo de M10', () => {
    it('producto con precio del dueño: mismo P en ficha y checkout; producto automático: P baja', async () => {
      await setSource('tcgcsv');
      const O = await product({ owner: 129_900 });
      // 💰 Redundancia (QA menor 2 del gate de techlead): 129 900 da ida y vuelta EXACTA `P → L → P` con 100/16 y con
      // 50/16, así que la mutación «P derivado desde el L equivalente» (`orders.service.ts` `derivedSaleDecision`)
      // pasaría con él. MX$70.00 NO la da con ninguno de los dos diales (7000 ⇒ L 6034 ⇒ 6999 con 100/16;
      // ⇒ L 6481 ⇒ 6999 con 50/16): con la mutación el checkout cobra 6999 y esta prueba sale roja.
      const X = await product({ owner: 7_000 });
      const A = await product({ owner: null, market: 'tcgcsv' });
      const po = await piece(O);
      const px = await piece(X);
      const pa = await piece(A);
      const price = async (id: string) => (await h.api('GET', `/catalog/listings/${id}`)).body.displayPriceCents as number;
      const quote = async (id: string) => (await h.api('POST', '/checkout/quote', { token: buyer, json: { inventoryItemIds: [id] } })).body.items[0].unitPriceCents as number;
      const [o100, a100, qo100] = [await price(po.id), await price(pa.id), await quote(po.id)];
      // Con el dial en 100: ficha y checkout cobran EXACTAMENTE el P del dueño (no su L re-derivado).
      expect([await price(px.id), await quote(px.id)]).toEqual([7_000, 7_000]);
      expect(qo100).toBe(o100);
      const prev = await h.api('GET', '/admin/settings/iva-transfer/preview?ivaTransferPct=50', { token: admin });
      const mv = await h.api('PUT', '/admin/settings/iva-transfer', {
        token: admin,
        json: { ivaTransferPct: 50, acknowledgement: { samplePriceCents: prev.body.samplePriceCents, previewedNetDeltaCents: prev.body.netDeltaPerUnitCents } },
      });
      try {
        expect(mv.status).toBe(200);
        expect([await price(po.id), await quote(po.id)]).toEqual([o100, qo100]);
        expect(o100).toBe(129_900);
        // Y con el dial en 50 (otro L equivalente): sigue siendo 7000 en ficha y checkout.
        expect([await price(px.id), await quote(px.id)]).toEqual([7_000, 7_000]);
        expect(await price(pa.id)).toBeLessThan(a100);
      } finally {
        await setTransfer(100);
        await setSource('off');
      }
    });
  });
});

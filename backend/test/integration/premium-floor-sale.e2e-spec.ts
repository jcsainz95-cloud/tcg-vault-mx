/**
 * premium-floor-sale.e2e-spec.ts — **v1.80.8.5: «premium en el piso», en VENTA, se publica al piso según
 * el dial `premiumFloorSalePublish`** (API_CONTRACT §M2 `M2-PF`, ARCHITECTURE §4.36.5 c-ter). Propiedad:
 * backend; la ejecuta QA. Pruebas **PF-3, PF-7, PF-8 y PF-10** contra Postgres real y por HTTP (las
 * puras y de servicio viven en `test/pricing.premium-floor-sale.spec.ts`).
 *
 * Decisión del dueño (HECHOS 2026-10-04, «Precios — decisiones» (a) y «Precios y reembolsos —
 * respuestas…» (a)): solo `Double Rare` y `Rare Holo EX` se publican al piso (MX$25); el resto de
 * premium sigue retenida `premium_at_floor`. La COMPRA no cambia.
 *
 * ⚠️ El dial es una fila COMPARTIDA de `ConfigSetting`: se guarda su estado antes del spec y se restaura
 * al final (fila ausente ⇒ se borra). ⚠️ El `price-sync` de PF-10 corre REAL salvo el proveedor por
 * carta (`syncCardPrice` ⇒ `pending`), igual que VQ-9: lo que se mide es el barrido del final.
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { PriceSyncJobService } from '../../src/jobs/price-sync.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PricingCurve, resolveBuyFromCurve, resolveSaleFromCurve } from '../../src/common/pricing-curve';
import { P } from './helpers/iva-display';

const SET_ID = 'e2e-pf-set';
const PREFIX = 'e2e-pf-';
const DIAL_KEY = 'premium_floor_sale_publish';
const CLABE = '012345678901234567';
const BROKEN_MARKET = 1000; // MX$10 — la venta cae al piso (MX$25)
const BIN_MARKET = 100; // MX$1 — la compra cae al bin

type Slug = 'dr' | 'ex' | 'ir' | 'sir' | 'drgone' | 'urgone' | 'buydr' | 'buyok';
const CARDS: Record<Slug, { rarity: string; n: string }> = {
  dr: { rarity: 'Double Rare', n: '1' }, // `listed` en el piso
  ex: { rarity: 'Rare Holo EX', n: '2' }, // `in_stock` en el piso
  ir: { rarity: 'Illustration Rare', n: '3' }, // `listed` en el piso (otra premium)
  sir: { rarity: 'Special Illustration Rare', n: '4' }, // `in_stock` en el piso (otra premium)
  drgone: { rarity: 'Double Rare', n: '5' }, // fila de VENTA sin pieza
  urgone: { rarity: 'Ultra Rare', n: '6' }, // fila de VENTA sin pieza (otra premium)
  buydr: { rarity: 'Double Rare', n: '7' }, // eje de COMPRA (mercado en el bin)
  buyok: { rarity: 'Common', n: '8' }, // línea SANA de compra: la solicitud necesita llegar al mínimo
};
const BUY_OK_MARKET = 150_000; // compra por curva `market` (MX$750) ⇒ cubre el mínimo de solicitud del seed
const SEED = { mode: 'only', rarities: ['Double Rare', 'Rare Holo EX'] };
const NONE = { mode: 'none', rarities: [] as string[] };

describe('E2E — M2-PF: premium en el piso, en VENTA, según el dial (v1.80.8.5)', () => {
  let h: E2EHarness;
  let admin: string;
  let customer: string;
  let customerId: string;
  let addressId: string;
  let curve: PricingCurve;
  let dialBefore: unknown = undefined; // undefined ⇒ la fila no existía
  let kycBefore: { ineFrontKey: string | null; ineBackKey: string | null } | null = null;
  const item: Partial<Record<Slug, string>> = {};
  const cardId = (s: Slug) => `${PREFIX}${s}`;

  async function cleanup() {
    const ids = Object.keys(CARDS).map((s) => cardId(s as Slug));
    await h.prisma.sellRequest.deleteMany({ where: { items: { some: { cardId: { in: ids } } } } });
    const its = await h.prisma.inventoryItem.findMany({ where: { cardId: { in: ids } }, select: { id: true } });
    await h.prisma.inventoryMovement.deleteMany({ where: { itemId: { in: its.map((i) => i.id) } } });
    await h.prisma.inventoryItem.deleteMany({ where: { cardId: { in: ids } } });
    await h.prisma.pendingPriceEntry.deleteMany({ where: { cardId: { in: ids } } });
    await h.prisma.priceReference.deleteMany({ where: { cardId: { in: ids } } });
    await h.prisma.card.deleteMany({ where: { setId: SET_ID } });
    await h.prisma.cardSet.deleteMany({ where: { id: SET_ID } });
  }

  async function setDial(value: unknown) {
    const res = await h.api('PUT', '/admin/settings', { token: admin, json: { premiumFloorSalePublish: value } });
    expect({ status: res.status, body: res.status === 200 ? null : res.body }).toEqual({ status: 200, body: null });
  }

  async function market(slug: Slug, cents: number) {
    await h.prisma.priceReference.deleteMany({ where: { cardId: cardId(slug) } });
    await h.prisma.priceReference.create({
      data: {
        cardId: cardId(slug),
        productType: 'raw',
        gradeKey: 'raw:NM',
        finish: 'normal',
        source: 'manual',
        priceMxnCents: cents,
        capturedDate: new Date('2026-10-04T00:00:00.000Z'),
        isManualOverride: true,
        refKind: 'market',
      },
    });
  }

  const pending = (slug: Slug, context: 'inventory' | 'buylist', extra: Record<string, unknown> = {}) =>
    h.prisma.pendingPriceEntry.create({
      data: {
        cardId: cardId(slug),
        productType: 'raw',
        gradeKey: 'raw:NM',
        finish: 'normal',
        status: 'open',
        context,
        reason: 'premium_at_floor',
        ...extra,
      },
    });

  const rowsOf = (slug: Slug) =>
    h.prisma.pendingPriceEntry.findMany({
      where: { cardId: cardId(slug) },
      orderBy: [{ context: 'asc' }, { createdAt: 'asc' }],
      select: { status: true, context: true, reason: true },
    });

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    customer = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    const u = await h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.customer.email } });
    customerId = u.id;
    addressId = (await h.prisma.address.findFirstOrThrow({ where: { userId: u.id } })).id;
    kycBefore = await h.prisma.kycProfile.findUnique({
      where: { userId: customerId },
      select: { ineFrontKey: true, ineBackKey: true },
    });
    await h.prisma.kycProfile.upsert({
      where: { userId: customerId },
      create: { userId: customerId, ineFrontKey: 'ine/front.jpg', ineBackKey: 'ine/back.jpg', kycStatus: 'pending' },
      update: { ineFrontKey: 'ine/front.jpg', ineBackKey: 'ine/back.jpg' },
    });
    const row = await h.prisma.configSetting.findUnique({ where: { key: DIAL_KEY } });
    dialBefore = row ? row.valueJson : undefined;
    curve = (await h.api<PricingCurve>('GET', '/admin/pricing/curve', { token: admin })).body;

    await cleanup();
    await h.prisma.cardSet.create({ data: { id: SET_ID, externalId: SET_ID, name: 'E2E Premium Floor' } });
    for (const [slug, c] of Object.entries(CARDS) as [Slug, (typeof CARDS)[Slug]][]) {
      await h.prisma.card.create({
        data: {
          id: cardId(slug),
          externalId: cardId(slug),
          setId: SET_ID,
          name: `PF ${slug}`,
          number: c.n,
          rarity: c.rarity,
          rarityCanonical: c.rarity,
          availableFinishes: ['normal'],
        },
      });
    }
    const mk = async (slug: Slug, status: 'listed' | 'in_stock') => {
      const it = await h.prisma.inventoryItem.create({
        data: {
          folio: `E2E-PF-${slug.toUpperCase()}`,
          cardId: cardId(slug),
          productType: 'raw',
          rawCondition: 'NM',
          finish: 'normal',
          acquisitionType: 'compra',
          ownerType: 'platform',
          status,
        } as never,
      });
      item[slug] = it.id;
    };
    await mk('dr', 'listed');
    await mk('ex', 'in_stock');
    await mk('ir', 'listed');
    await mk('sir', 'in_stock');
    for (const s of ['dr', 'ex', 'ir', 'sir', 'drgone', 'urgone'] as Slug[]) await market(s, BROKEN_MARKET);
    await market('buydr', BIN_MARKET);
    await market('buyok', BUY_OK_MARKET);
  });

  afterAll(async () => {
    if (h) {
      await cleanup();
      if (dialBefore === undefined) await h.prisma.configSetting.deleteMany({ where: { key: DIAL_KEY } });
      else
        await h.prisma.configSetting.update({ where: { key: DIAL_KEY }, data: { valueJson: dialBefore as object } });
      if (kycBefore) await h.prisma.kycProfile.update({ where: { userId: customerId }, data: kycBefore });
      else await h.prisma.kycProfile.deleteMany({ where: { userId: customerId } });
    }
    await h?.close();
  });

  it('precondición anti-vacuidad: con la curva VIVA, MX$10 cae al PISO de venta y MX$1 al BIN de compra', () => {
    expect(resolveSaleFromCurve(BROKEN_MARKET, curve)).toMatchObject({ basis: 'floor', cents: curve.sale.floorCents });
    expect(resolveBuyFromCurve(BIN_MARKET, curve).basis).toBe('floor');
    expect(resolveBuyFromCurve(BUY_OK_MARKET, curve).basis).toBe('market');
  });

  // =============================================================================================
  // PF-8 — Settings
  // =============================================================================================
  describe('PF-8 — el dial en M10', () => {
    it('sin fila ⇒ `GET /admin/settings` devuelve el seed (y el loader también)', async () => {
      await h.prisma.configSetting.deleteMany({ where: { key: DIAL_KEY } });
      const res = await h.api('GET', '/admin/settings', { token: admin });
      expect(res.status).toBe(200);
      expect(res.body.premiumFloorSalePublish).toEqual(SEED);
      expect(await h.app.get(PricingService).loadSalePremiumFloorPolicy()).toEqual(SEED);
    });

    it.each([
      ['only (el seed)', SEED],
      ['all', { mode: 'all', rarities: [] }],
      ['none', NONE],
    ])('PUT %s ⇒ 200, persiste y deja bitácora', async (_g, value) => {
      const t0 = new Date();
      await setDial(value);
      expect((await h.api('GET', '/admin/settings', { token: admin })).body.premiumFloorSalePublish).toEqual(value);
      const audit = await h.prisma.auditLog.findFirst({
        where: { action: 'settings.update', createdAt: { gte: t0 } },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit?.after).toEqual({ premiumFloorSalePublish: value });
    });

    it.each([
      ['mode fuera del enum', { mode: 'some', rarities: [] }],
      ["'only' con lista vacía", { mode: 'only', rarities: [] }],
      ["'all' con lista", { mode: 'all', rarities: ['Double Rare'] }],
      ["'none' con lista", { mode: 'none', rarities: ['Double Rare'] }],
      ['rareza no canónica (typo)', { mode: 'only', rarities: ['Doble Rare'] }],
      ['alias en vez de la canónica', { mode: 'only', rarities: ['doublerare'] }],
      ['canónica NO premium', { mode: 'only', rarities: ['Common'] }],
      ['duplicados', { mode: 'only', rarities: ['Double Rare', 'Double Rare'] }],
      ['sin `rarities`', { mode: 'all' }],
      ['no es objeto', 'only'],
    ])('PUT %s ⇒ 422 VALIDATION_ERROR y NO escribe', async (_g, value) => {
      await setDial(SEED);
      const res = await h.api('PUT', '/admin/settings', { token: admin, json: { premiumFloorSalePublish: value } });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.errors.premiumFloorSalePublish).toEqual(expect.any(String));
      expect((await h.api('GET', '/admin/settings', { token: admin })).body.premiumFloorSalePublish).toEqual(SEED);
    });

    it('valor almacenado BASURA (escritura directa a BD) ⇒ el loader RETIENE todo (`none`) y lo grita', async () => {
      await h.prisma.configSetting.upsert({
        where: { key: DIAL_KEY },
        create: { key: DIAL_KEY, valueJson: { mode: 'all', rarities: ['Common'] } },
        update: { valueJson: { mode: 'all', rarities: ['Common'] } },
      });
      const pricing = h.app.get(PricingService);
      const err = jest.spyOn((pricing as any).logger, 'error').mockImplementation(() => undefined);
      try {
        expect(await pricing.loadSalePremiumFloorPolicy()).toEqual(NONE);
        expect(err).toHaveBeenCalledWith(expect.stringContaining(DIAL_KEY));
      } finally {
        err.mockRestore();
      }
      await setDial(SEED);
    });
  });

  // =============================================================================================
  // PF-7 — Catálogo + checkout (auth y guest)
  // =============================================================================================
  describe('PF-7 — catálogo y checkout leen la MISMA política', () => {
    const listing = (slug: Slug) => h.api('GET', `/catalog/listings/${item[slug]}`);
    const authQuote = (slug: Slug) =>
      h.api('POST', '/checkout/quote', { token: customer, json: { inventoryItemIds: [item[slug]] } });
    const guestQuote = (slug: Slug) =>
      h.api('POST', '/checkout/guest/quote', { json: { inventoryItemIds: [item[slug]] } });
    async function stockOf(slug: Slug): Promise<number | undefined> {
      const res = await h.api('GET', `/catalog/cards?q=${encodeURIComponent(`PF ${slug}`)}&pageSize=50`);
      expect(res.status).toBe(200);
      const g = (res.body.data as any[]).find((x) => x.card.name === `PF ${slug}`);
      return g?.stockCount;
    }

    it('seed: la DR `listed` se VENDE al piso (catálogo, stockCount, checkout auth y guest); la IR NO', async () => {
      await setDial(SEED);
      const dr = await listing('dr');
      expect(dr.status).toBe(200);
      expect(dr.body.displayPriceCents).toBe(P(curve.sale.floorCents));
      expect(curve.sale.floorCents).toBe(2500);
      expect(await stockOf('dr')).toBe(1);
      for (const q of [await authQuote('dr'), await guestQuote('dr')]) {
        expect(q.status).toBe(200);
        expect(q.body.breakdown.subtotalCents).toBe(P(2500));
      }
      // La IR (premium que el seed NO publica): oculta y el checkout la rechaza como hoy.
      expect((await listing('ir')).status).toBe(404);
      expect(await stockOf('ir')).toBeUndefined();
      for (const q of [await authQuote('ir'), await guestQuote('ir')]) {
        expect(q.status).toBe(422);
        expect(q.body.error.code).toBe('PRICE_PENDING');
      }
    });

    it('dial `none`: la DR vuelve a comportarse como la IR (oculta y rechazada), sin redeploy', async () => {
      await setDial(NONE);
      try {
        expect((await listing('dr')).status).toBe(404);
        expect(await stockOf('dr')).toBeUndefined();
        for (const q of [await authQuote('dr'), await guestQuote('dr')]) {
          expect(q.status).toBe(422);
          expect(q.body.error.code).toBe('PRICE_PENDING');
        }
      } finally {
        await setDial(SEED);
      }
    });
  });

  // =============================================================================================
  // PF-3 — COMPRA intacta aunque el dial de VENTA esté en `all`
  // =============================================================================================
  describe('PF-3 — COMPRA no lee el dial', () => {
    it('dial `all`: una DR en el BIN ⇒ `/buylist/quote` precio_pendiente y `createRequest` con fila `buylist` premium_at_floor', async () => {
      await setDial({ mode: 'all', rarities: [] });
      try {
        const q = await h.api('POST', '/buylist/quote', {
          json: { cardId: cardId('buydr'), productType: 'raw', rawCondition: 'NM' },
        });
        expect(q.status).toBe(200);
        expect(q.body.quote).toMatchObject({ status: 'precio_pendiente', quotedPriceCents: null });
        const res = await h.api('POST', '/buylist/requests', {
          token: customer,
          json: {
            items: [
              { cardId: cardId('buydr'), productType: 'raw', rawCondition: 'NM' },
              { cardId: cardId('buyok'), productType: 'raw', rawCondition: 'NM' },
            ],
            clabe: CLABE,
            addressId,
          },
        });
        expect({ status: res.status, body: res.status === 201 ? null : res.body }).toEqual({ status: 201, body: null });
        const line = await h.prisma.sellRequestItem.findFirstOrThrow({
          where: { sellRequestId: res.body.sellRequestId, cardId: cardId('buydr') },
        });
        expect(line).toMatchObject({ itemStatus: 'precio_pendiente', quotedPriceCents: null });
        expect(await rowsOf('buydr')).toEqual([
          { status: 'open', context: 'buylist', reason: 'premium_at_floor' },
        ]);
      } finally {
        await setDial(SEED);
      }
    });
  });

  // =============================================================================================
  // PF-10 — la VENTA del dueño: publish-all + price-sync completo, dial seed
  // =============================================================================================
  describe('PF-10 — ciclo completo con el seed', () => {
    let buyRowsBefore: number;

    async function counts() {
      const res = await h.api('GET', '/admin/pricing/pending?context=inventory', { token: admin });
      expect(res.status).toBe(200);
      return res.body.counts as { no_market: number; premium_at_floor: number; unknown: number };
    }
    async function publishAllAndFullSync() {
      const pub = await h.api('POST', '/admin/inventory/publish-all', { token: admin, json: { setId: SET_ID } });
      expect(pub.status).toBe(200);
      const pricing = h.app.get(PricingService);
      const spy = jest.spyOn(pricing, 'syncCardPrice').mockResolvedValue({ status: 'pending' });
      try {
        await h.app.get(PriceSyncJobService).run();
      } finally {
        spy.mockRestore();
      }
    }
    const mySaleOpen = () =>
      h.prisma.pendingPriceEntry.findMany({
        where: { card: { setId: SET_ID }, status: 'open', context: 'inventory' },
        select: { cardId: true, reason: true },
        orderBy: { cardId: 'asc' },
      });

    beforeAll(async () => {
      await setDial(SEED);
      // La cola del dueño: `premium_at_floor` de VENTA de DR/EX y de otras premium, con pieza `listed`,
      // `in_stock` y sin pieza; más una fila de COMPRA de la DR y una `null` sin pieza (VQ).
      for (const s of ['dr', 'ex', 'ir', 'sir', 'drgone', 'urgone'] as Slug[]) await pending(s, 'inventory');
      await pending('dr', 'buylist');
      await pending('urgone', 'inventory', { reason: null, cardProductId: 77 });
      buyRowsBefore = await h.prisma.pendingPriceEntry.count({
        where: { card: { setId: SET_ID }, status: 'open', context: 'buylist' },
      });
    });

    it('VENTA: quedan EXACTAMENTE las otras premium; DR/EX cerradas; unknown 0; invariante; COMPRA intacta', async () => {
      await publishAllAndFullSync();
      expect(await mySaleOpen()).toEqual([
        { cardId: cardId('ir'), reason: 'premium_at_floor' },
        { cardId: cardId('sir'), reason: 'premium_at_floor' },
        { cardId: cardId('urgone'), reason: 'premium_at_floor' },
      ]);
      const c = await counts();
      expect(c.unknown).toBe(0);
      const open = await h.prisma.pendingPriceEntry.count({ where: { status: 'open', context: 'inventory' } });
      expect(c.no_market + c.premium_at_floor + c.unknown).toBe(open);
      // Las DR/EX: publicadas (la EX estaba `in_stock`) y a la venta al piso.
      const ex = await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.ex! } });
      expect(ex.status).toBe('listed');
      expect((await h.api('GET', `/catalog/listings/${item.ex}`)).body.displayPriceCents).toBe(P(2500));
      // La SIR (in_stock, otra premium) NO se publicó.
      const sir = await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.sir! } });
      expect(sir.status).toBe('in_stock');
      // COMPRA sin cambio.
      expect(
        await h.prisma.pendingPriceEntry.count({ where: { card: { setId: SET_ID }, status: 'open', context: 'buylist' } }),
      ).toBe(buyRowsBefore);
      expect(await rowsOf('dr')).toEqual([
        { status: 'open', context: 'buylist', reason: 'premium_at_floor' },
        { status: 'resolved', context: 'inventory', reason: 'premium_at_floor' },
      ]);
    });

    it('segunda corrida = no-op', async () => {
      const snap = await h.prisma.pendingPriceEntry.findMany({
        where: { card: { setId: SET_ID } },
        orderBy: { id: 'asc' },
        select: { id: true, status: true, reason: true, context: true },
      });
      const c1 = await counts();
      await publishAllAndFullSync();
      expect(
        await h.prisma.pendingPriceEntry.findMany({
          where: { card: { setId: SET_ID } },
          orderBy: { id: 'asc' },
          select: { id: true, status: true, reason: true, context: true },
        }),
      ).toEqual(snap);
      expect(await counts()).toEqual(c1);
    });
  });
});

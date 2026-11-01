/**
 * sealed-sold-out.e2e-spec.ts — ⭐ v1.115⟨mkt-conv2⟩ `API_CONTRACT §MKT.A.1` (criterio 951; porqué en ARCHITECTURE §13.8 (a))
 * contra Postgres real y por HTTP. Propiedad: backend; la ejecuta QA.
 *
 * `GET /catalog/sealed/:inventoryItemId` resuelve el GRUPO de la pieza pedida, no el estado de la pieza:
 *  - CNV-B1  grupo con su única pieza vendida (o en bóveda de cliente) ⇒ `200` agotada: `listings: []`, `availableCount 0`,
 *            `fromPriceCents null`, `priceSource null`, `priceBasis "pending"`, sin número de mercado (con un mercado
 *            SEMBRADO para que «sin número» signifique algo). Canario: volver a filtrar la pieza por `status: 'listed'` ⇒ 404.
 *  - CNV-B2  pieza pedida vendida, otra del grupo a la venta ⇒ `200` con la otra como `representativeItemId` y en `listings`.
 *            Canario: el mismo ⇒ 404.
 *  - CNV-B3  ⛔ ORÁCULO DE ESTADO: el mismo grupo agotado pedido por una pieza vendida, otra en bóveda, otra retirada de venta
 *            y otra a la venta con precio pendiente ⇒ cuerpos IGUALES salvo `representativeItemId` (las cuatro comparten
 *            identidad, así que no hay otra diferencia legítima). Canario: añadir `status` de la pieza al DTO ⇒ difiere.
 *  - CNV-B4  uuid inexistente y pieza `raw` por la ruta de sellado ⇒ `404 NOT_FOUND` las dos. Canario: quitar el filtro
 *            `productType` ⇒ la `raw` da 200.
 *  - CNV-B5  (TL-MKT5-5) grupo con una pieza `sealedCondition 'mint'` y otra `null` (la clave de grupo `sealedIdentityKey`
 *            las iguala: `null` ≡ `'mint'`) ⇒ la ficha pedida por CUALQUIERA de las dos tiene el `availableCount` de la teja
 *            de la rejilla (2) y lista las dos; una tercera `minor_box_damage` del mismo producto queda en su propio grupo (1).
 *            Canarios: volver al `where` con `sealedCondition: requested.sealedCondition` ⇒ 1; quitar el filtro por clave ⇒ 3.
 *
 * Datos propios (prefijo `e2e-cnv-`), barridos al empezar y al terminar; ⛔ no toca diales compartidos.
 */
import { randomBytes } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';

jest.setTimeout(120_000);

const RUN = `cnv${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
const SET_ID = `e2e-cnv-set-${RUN}`;
const ANCHOR = `e2e-cnv-anchor-${RUN}`;
const NAME = `CNV Caja ${RUN}`;
const IMG = `https://e2e.local/cnv-${RUN}.jpg`;
/** Mercado sembrado con un valor que no coincide con ningún otro número del cuerpo (p. ej. `numberSort` = 1000000). */
const MARKET = 123_457;

describe('E2E — §MKT.A.1: la ficha de sellado resuelve el GRUPO, no el estado de la pieza (v1.115)', () => {
  let h: E2EHarness;
  let shelf: string;
  let ownerId: string;
  let pidSeq = Math.floor(Math.random() * 1_000_000) + 8_000_000;
  let seq = 0;

  async function product(o: { owner?: number | null; market?: number | null } = {}) {
    pidSeq += 1;
    const sp = await h.prisma.sealedProduct.create({
      data: {
        setId: SET_ID,
        tcgplayerProductId: pidSeq,
        tcgplayerGroupId: 990_951,
        name: `${NAME} ${pidSeq}`,
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
          source: 'tcgcsv',
          priceMxnCents: o.market,
          capturedDate: new Date(),
          refKind: 'market',
        },
      });
    }
    return sp;
  }

  /** Pieza sellada del producto `sp` con la MISMA identidad (snapshot) en todas: solo cambia su estado/dueño. */
  async function piece(sp: { id: string; tcgplayerProductId: number }, o: Record<string, unknown> = {}) {
    seq += 1;
    return h.prisma.inventoryItem.create({
      data: {
        folio: `CNV-${RUN}-${String(seq).padStart(4, '0')}`,
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
        sealedProductId: sp.id,
        sealedProductName: NAME,
        sealedImageUrl: IMG,
        tcgplayerProductId: sp.tcgplayerProductId,
        tcgplayerGroupId: 990_951,
        ...o,
      } as never,
    });
  }
  const SOLD = { status: 'shipped', locationId: null };
  const inVault = () => ({ ownerType: 'customer', ownerUserId: ownerId, ownershipStatus: 'settled', status: 'in_custody' });
  const UNLISTED = { status: 'in_stock' };

  const detail = (id: string) => h.api('GET', `/catalog/sealed/${id}`);

  async function cleanup() {
    const cards = await h.prisma.card.findMany({ where: { id: { startsWith: 'e2e-cnv-' } }, select: { id: true } });
    const cardIds = cards.map((c) => c.id);
    const items = await h.prisma.inventoryItem.findMany({ where: { cardId: { in: cardIds } }, select: { id: true } });
    const itemIds = items.map((i) => i.id);
    await h.prisma.auditLog.deleteMany({ where: { entityId: { in: itemIds } } });
    await h.prisma.inventoryMovement.deleteMany({ where: { itemId: { in: itemIds } } });
    await h.prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
    await h.prisma.priceReference.deleteMany({ where: { cardId: { in: cardIds } } });
    await h.prisma.sealedProduct.deleteMany({ where: { setId: { startsWith: 'e2e-cnv-set-' } } });
    await h.prisma.card.deleteMany({ where: { id: { in: cardIds } } });
    await h.prisma.cardSet.deleteMany({ where: { id: { startsWith: 'e2e-cnv-set-' } } });
    await h.prisma.user.deleteMany({ where: { email: { startsWith: 'cnv.owner.' } } });
  }

  beforeAll(async () => {
    h = await E2EHarness.create();
    await cleanup();
    shelf = (await h.prisma.vaultLocation.findFirstOrThrow({ where: { zone: 'platform_stock', isActive: true } })).id;
    ownerId = (
      await h.prisma.user.create({
        data: { email: `cnv.owner.${RUN}@e2e.local`, name: 'CNV Owner', role: 'customer', locale: 'es', emailVerified: true },
      })
    ).id;
    await h.prisma.cardSet.create({ data: { id: SET_ID, externalId: SET_ID, name: `CNV Set ${RUN}` } });
    await h.prisma.card.create({
      data: { id: ANCHOR, externalId: ANCHOR, setId: SET_ID, name: 'CNV Anchor', number: '1', rarity: 'Common', rarityCanonical: 'Common', availableFinishes: ['normal'] },
    });
  });

  afterAll(async () => {
    if (!h) return;
    await cleanup();
    await h.close();
  });

  /** La forma agotada de §MKT.A.1, completa. */
  function expectSoldOut(body: any, requestedId: string) {
    expect(body.listings).toEqual([]);
    const g = body.group;
    expect({
      representativeItemId: g.representativeItemId,
      availableCount: g.availableCount,
      fromPriceCents: g.fromPriceCents,
      priceSource: g.priceSource,
      priceBasis: g.priceBasis,
      productName: g.productName,
      imageUrl: g.imageUrl,
      sealedSubtype: g.sealedSubtype,
      sealedCondition: g.sealedCondition,
      currency: g.currency,
    }).toEqual({
      representativeItemId: requestedId,
      availableCount: 0,
      fromPriceCents: null,
      priceSource: null,
      priceBasis: 'pending',
      productName: NAME,
      imageUrl: IMG,
      sealedSubtype: 'etb',
      sealedCondition: 'mint',
      currency: 'MXN',
    });
    // Sin número de mercado: `referenceValue` con su `status` y nada más; sin `referenceDisplayCents`.
    expect(Object.keys(g.referenceValue)).toEqual(['status']);
    expect('referenceDisplayCents' in g).toBe(false);
    expect(g.pricedAsOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof body.trendEnabled).toBe('boolean');
    expect(typeof body.restockEnabled).toBe('boolean');
  }

  it('CNV-B1 — grupo con su única pieza VENDIDA ⇒ 200 agotada, sin número de mercado (mercado sembrado)', async () => {
    const X = await product({ market: MARKET });
    const sold = await piece(X, SOLD);
    const res = await detail(sold.id);
    expect(res.status).toBe(200);
    expectSoldOut(res.body, sold.id);
    // Ni el mercado neto ni el exhibido con IVA (16 %) aparecen en ninguna parte del cuerpo.
    const blob = JSON.stringify(res.body);
    expect(blob).not.toContain(String(MARKET));
    expect(blob).not.toContain(String(Math.round(MARKET * 1.16)));
    expect(blob).not.toContain('referenceMxnCents');
  });

  it('CNV-B1 — grupo con su única pieza en BÓVEDA de cliente ⇒ 200 agotada', async () => {
    const X = await product({ market: MARKET });
    const vaulted = await piece(X, inVault());
    const res = await detail(vaulted.id);
    expect(res.status).toBe(200);
    expectSoldOut(res.body, vaulted.id);
  });

  it('CNV-B2 — pieza pedida vendida, otra del grupo a la venta ⇒ 200 con la otra como representante y en listings', async () => {
    const X = await product({ owner: 700 });
    const sold = await piece(X, SOLD);
    const listed = await piece(X);
    const res = await detail(sold.id);
    expect(res.status).toBe(200);
    expect(res.body.group.representativeItemId).toBe(listed.id);
    expect((res.body.listings as any[]).map((l) => l.inventoryItemId)).toEqual([listed.id]);
    expect({ n: res.body.group.availableCount, p: res.body.group.fromPriceCents }).toEqual({ n: 1, p: 700 });
    // La misma respuesta que pedirla por la pieza a la venta (el grupo de ahora, no el de la pieza pedida).
    const byListed = await detail(listed.id);
    expect(byListed.status).toBe(200);
    expect(res.body).toEqual(byListed.body);
  });

  it('CNV-B3 — ⛔ oráculo de estado: el mismo grupo agotado pedido por vendida / bóveda / retirada / precio pendiente ⇒ cuerpos iguales salvo representativeItemId', async () => {
    // Sin precio del dueño ni mercado ⇒ la pieza `listed` tiene precio PENDIENTE: el grupo sigue agotado.
    const X = await product();
    const pieces = [
      await piece(X, SOLD),
      await piece(X, inVault()),
      await piece(X, UNLISTED),
      await piece(X), // listed, PRICE_PENDING
    ];
    const bodies = [];
    for (const p of pieces) {
      const res = await detail(p.id);
      expect(res.status).toBe(200);
      expectSoldOut(res.body, p.id);
      const { representativeItemId, ...rest } = res.body.group;
      expect(representativeItemId).toBe(p.id);
      bodies.push({ ...res.body, group: rest });
    }
    for (const b of bodies.slice(1)) expect(b).toEqual(bodies[0]);
  });

  it('CNV-B4 — uuid inexistente y pieza `raw` por la ruta de sellado ⇒ 404 NOT_FOUND las dos', async () => {
    const missing = await detail('00000000-0000-4000-8000-000000000951');
    expect([missing.status, missing.body?.error?.code]).toEqual([404, 'NOT_FOUND']);
    seq += 1;
    const raw = await h.prisma.inventoryItem.create({
      data: {
        folio: `CNV-${RUN}-${String(seq).padStart(4, '0')}`,
        cardId: ANCHOR,
        productType: 'raw',
        rawCondition: 'NM',
        finish: 'normal',
        acquisitionType: 'compra',
        acquisitionCostCents: 5_000,
        ownerType: 'platform',
        status: 'listed',
        locationId: shelf,
        listPriceCents: 10_000,
      } as never,
    });
    const res = await detail(raw.id);
    expect([res.status, res.body?.error?.code]).toEqual([404, 'NOT_FOUND']);
  });

  it('CNV-B5 — (TL-MKT5-5) condición `mint` y `null` en el mismo grupo ⇒ la ficha cuenta lo mismo que la teja de la rejilla', async () => {
    const X = await product({ owner: 900 });
    const mint = await piece(X);
    const unset = await piece(X, { sealedCondition: null });
    // Otra condición del MISMO producto: grupo propio en la rejilla y fuera de la ficha `mint` (y viceversa).
    const damaged = await piece(X, { sealedCondition: 'minor_box_damage' });
    const grid = await h.api('GET', `/catalog/sealed?setId=${SET_ID}&pageSize=100`);
    expect(grid.status).toBe(200);
    const tiles = (grid.body.data as any[]).filter((t) => t.sealedProductId === X.id);
    const mintTiles = tiles.filter((t) => t.sealedCondition === 'mint');
    expect(tiles.map((t) => [t.availableCount, t.sealedCondition]).sort()).toEqual([[1, 'minor_box_damage'], [2, 'mint']]);
    for (const p of [mint, unset]) {
      const res = await detail(p.id);
      expect(res.status).toBe(200);
      expect({ n: res.body.group.availableCount, c: res.body.group.sealedCondition }).toEqual({ n: mintTiles[0].availableCount, c: 'mint' });
      expect((res.body.listings as any[]).map((l) => l.inventoryItemId).sort()).toEqual([mint.id, unset.id].sort());
    }
    const dmg = await detail(damaged.id);
    expect(dmg.status).toBe(200);
    expect({ n: dmg.body.group.availableCount, c: dmg.body.group.sealedCondition }).toEqual({ n: 1, c: 'minor_box_damage' });
    expect((dmg.body.listings as any[]).map((l) => l.inventoryItemId)).toEqual([damaged.id]);
  });
});

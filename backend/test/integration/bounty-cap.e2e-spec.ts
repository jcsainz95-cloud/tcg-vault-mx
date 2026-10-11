/**
 * `bounty-cap.e2e-spec.ts` — **TOPE DE PAGO DEL BOUNTY contra Postgres real y por HTTP**
 * (API_CONTRACT v1.80 §M2-B.11 pruebas **BC-8, BC-10, BC-11, BC-12**; ARCHITECTURE §4.36.6e;
 * decisión del dueño 2026-09-28 en `HECHOS.md`: «el bounty nunca paga más que el precio de mercado»).
 *
 * ### Escala de los montos
 * El contrato ilustra con bounty **1200** / mercado **1000** (centavos). Aquí van **×100** (MX$1,200 /
 * MX$1,000): con MX$12 la solicitud no pasa el mínimo de MX$500 (`BUYLIST_MINIMUM_REQUEST_CENTS`) ni
 * el neto mínimo de oferta, y bajar esos ajustes contaminaría la base compartida. La relación
 * bounty > mercado > curva, que es lo que se prueba, es idéntica.
 *
 * BC-10 cambia el mercado de **B** (el contrato dice 10000 con la curva que imagina): con la curva del
 * seed (50 % en el tramo alto) un bounty de 3000 contra mercado 10000 **no es efectivo**. Se elige un
 * mercado que conserva la propiedad que la prueba necesita: B configurado MENOR que A pero pago MAYOR.
 *
 * ⛔ Nada de mocks: el estado se monta con `h.prisma` (cartas, referencias) y la conducta se ejercita
 * por la puerta.
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { PricingCurve, resolveBuyFromCurve } from '../../src/common/pricing-curve';

const SET_ID = 'e2e-bounty-cap-set';
const CARD_PREFIX = 'e2e-bcap-';
const CLABE = '012345678901234567';

const BOUNTY = 120_000; // MX$1,200 (contrato: 1200)
const MARKET = 100_000; // MX$1,000 (contrato: 1000)

describe('E2E — tope de pago del bounty `min(bounty, mercado)` (§M2-B.11)', () => {
  let h: E2EHarness;
  let adminToken: string;
  let operatorToken: string;
  let customerToken: string;
  let addressId: string;
  let curve: PricingCurve;

  const cardId = (slug: string) => `${CARD_PREFIX}${slug}`;
  const curveBuy = (m: number) => resolveBuyFromCurve(m, curve).cents as number;

  async function cleanup() {
    const cards = await h.prisma.card.findMany({ where: { setId: SET_ID }, select: { id: true } });
    const ids = cards.map((c) => c.id);
    if (ids.length > 0) {
      await h.prisma.inventoryItem.deleteMany({ where: { cardId: { in: ids } } });
      await h.prisma.sellRequest.deleteMany({ where: { items: { some: { cardId: { in: ids } } } } });
    }
    await h.prisma.variantPriceOverride.deleteMany({ where: { card: { setId: SET_ID } } });
    await h.prisma.priceReference.deleteMany({ where: { card: { setId: SET_ID } } });
    await h.prisma.card.deleteMany({ where: { setId: SET_ID } });
    await h.prisma.cardSet.deleteMany({ where: { id: SET_ID } });
  }

  async function makeCard(slug: string, number: string) {
    await h.prisma.card.create({
      data: {
        id: cardId(slug),
        externalId: cardId(slug),
        setId: SET_ID,
        name: `BCAP ${slug}`,
        number,
        rarity: 'Rare Holo',
        availableFinishes: ['normal'],
      },
    });
  }

  /** Fija el MERCADO `raw:NM/normal` de la carta (fila manual en MXN — la misma forma que la consola). */
  async function setMarket(slug: string, priceMxnCents: number) {
    await h.prisma.priceReference.deleteMany({ where: { cardId: cardId(slug) } });
    await h.prisma.priceReference.create({
      data: {
        cardId: cardId(slug),
        productType: 'raw',
        gradeKey: 'raw:NM',
        finish: 'normal',
        source: 'manual',
        priceMxnCents,
        capturedDate: new Date('2026-09-27T00:00:00.000Z'),
        isManualOverride: true,
        refKind: 'market',
      },
    });
  }

  async function setBounty(slug: string, priceCents: number, targetQty = 10) {
    const res = await h.api('PUT', `/admin/pricing/variant-controls/${cardId(slug)}/normal`, {
      token: adminToken,
      json: { productType: 'raw', gradeKey: 'raw:NM', bounty: { enabled: true, priceCents, targetQty } },
    });
    expect(res.status).toBe(200);
  }

  async function quote(slug: string) {
    const res = await h.api('POST', '/buylist/quote', {
      json: { cardId: cardId(slug), productType: 'raw', rawCondition: 'NM' },
    });
    expect(res.status).toBe(200);
    return res.body as { priceBasis: string; quote: { quotedPriceCents: number | null } };
  }

  async function vitrina() {
    const res = await h.api('GET', '/buylist/bounties');
    expect(res.status).toBe(200);
    return ((res.body as any).data as { cardId: string; bountyPriceCents: number }[]).filter((d) =>
      d.cardId.startsWith(CARD_PREFIX),
    );
  }

  async function consola(sort = 'price_desc') {
    const res = await h.api('GET', `/admin/pricing/bounties?setId=${SET_ID}&sort=${sort}`, { token: adminToken });
    expect(res.status).toBe(200);
    return (res.body as any).data as any[];
  }

  async function createRequest(slug: string): Promise<{ srId: string; itemId: string }> {
    const res = await h.api('POST', '/buylist/requests', {
      token: customerToken,
      json: {
        items: [{ cardId: cardId(slug), productType: 'raw', rawCondition: 'NM' }],
        clabe: CLABE,
        addressId,
      },
    });
    expect(res.status).toBe(201);
    const srId = (res.body as { sellRequestId: string }).sellRequestId;
    const item = await h.prisma.sellRequestItem.findFirstOrThrow({ where: { sellRequestId: srId } });
    return { srId, itemId: item.id };
  }

  function offer(srId: string, line: Record<string, unknown>) {
    return h.api('POST', `/admin/buylist/${srId}/offer`, { token: operatorToken, json: { lines: [line] } });
  }

  /** De `ofertada` a `pagada` y convertida, por la puerta. Devuelve el `InventoryItem` nacido. */
  async function acceptPayConvert(srId: string, itemId: string, ref: string) {
    expect(
      (await h.api('POST', `/buylist/requests/${srId}/offer-response`, { token: customerToken, json: { decision: 'accept' } }))
        .status,
    ).toBe(200);
    expect(
      (await h.api('POST', `/admin/buylist/${srId}/confirm-shipment`, { token: operatorToken, json: {} })).status,
    ).toBe(200);
    expect((await h.api('POST', `/admin/buylist/${srId}/receive`, { token: operatorToken })).status).toBe(200);
    expect((await h.api('POST', `/admin/buylist/${srId}/verify`, { token: operatorToken })).status).toBe(200);
    expect(
      (await h.api('PATCH', `/admin/buylist/items/${itemId}/decision`, { token: operatorToken, json: { decision: 'approve' } }))
        .status,
    ).toBe(200);
    const paid = await h.api('POST', `/admin/buylist/${srId}/pay-spei`, { token: adminToken, json: { speiReference: ref } });
    expect(paid.status).toBe(200);
    const conv = await h.api('POST', `/admin/buylist/items/${itemId}/convert-to-inventory`, {
      token: operatorToken,
      json: {},
    });
    expect(conv.status).toBe(200);
    return h.prisma.inventoryItem.findUniqueOrThrow({
      where: { id: (conv.body as { inventoryItemId: string }).inventoryItemId },
    });
  }

  const bountyRow = (slug: string) =>
    h.prisma.variantPriceOverride.findFirstOrThrow({ where: { cardId: cardId(slug), productType: 'raw' } });

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    operatorToken = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    customerToken = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    const u = await h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.customer.email } });
    addressId = (await h.prisma.address.findFirstOrThrow({ where: { userId: u.id } })).id;
    curve = (await h.api<PricingCurve>('GET', '/admin/pricing/curve', { token: adminToken })).body;
    expect(curve?.buy?.points?.length).toBeGreaterThan(0);

    await cleanup();
    await h.prisma.cardSet.create({ data: { id: SET_ID, externalId: SET_ID, name: 'E2E Bounty Cap' } });
    const slugs = ['tres', 'orden-a', 'orden-b', 'retro', 'congelada', 'contador'];
    for (const [i, slug] of slugs.entries()) await makeCard(slug, String(i + 1));
  });

  afterAll(async () => {
    // Una fila de bounty viva contaminaría la vitrina pública de cualquier spec posterior.
    if (h) await cleanup();
    await h?.close();
  });

  // ===========================================================================================
  // BC-8 ⭐⭐ — tres superficies, un número
  // ===========================================================================================
  it('BC-8 — bounty 1200 / mercado 1000 ⇒ cotización, vitrina, solicitud y consola dicen 1000', async () => {
    await setMarket('tres', MARKET);
    // Precondición medida, no supuesta: la curva paga MENOS que el mercado y MENOS que el bounty.
    expect(curveBuy(MARKET)).toBeLessThan(MARKET);
    await setBounty('tres', BOUNTY);

    // (1) cotización pública
    const q = await quote('tres');
    expect(q.priceBasis).toBe('bounty');
    expect(q.quote.quotedPriceCents).toBe(MARKET);

    // (2) vitrina pública: lo que se paga, y el configurado NO sale por la ruta pública.
    const v = await vitrina();
    const fila = v.find((d) => d.cardId === cardId('tres'));
    expect(fila?.bountyPriceCents).toBe(MARKET);
    const raw = JSON.stringify((await h.api('GET', '/buylist/bounties')).body);
    expect(raw).not.toContain(String(BOUNTY));

    // (3) la solicitud congela el pago topado, `priceBasis='bounty'` y el mercado.
    const { itemId } = await createRequest('tres');
    const item = await h.prisma.sellRequestItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.quotedPriceCents).toBe(MARKET);
    expect(item.priceBasis).toBe('bounty');
    expect(item.marketMxnCents).toBe(MARKET);

    // (4) consola del dueño: configurado 1200, paga 1000, topado; `state` intacto.
    const c = (await consola()).find((d) => d.cardId === cardId('tres'));
    expect(c.state).toBe('activa');
    expect(c.pricing.bounty).toMatchObject({
      priceCents: BOUNTY,
      effective: true,
      payoutCents: MARKET,
      cappedByMarket: true,
    });
    expect(c.pricing.buy).toMatchObject({ source: 'bounty', effectiveCents: MARKET });
  });

  // ===========================================================================================
  // BC-10 — la vitrina (y la consola) ordenan por LO QUE SE PAGA
  // ===========================================================================================
  it('BC-10 — A (bounty 5000 / mercado 2000) paga 2000; B (bounty 3000, efectivo) paga 3000 ⇒ B antes que A', async () => {
    const A = { bounty: 500_000, market: 200_000 };
    const B = { bounty: 300_000, market: 400_000 };
    await setMarket('orden-a', A.market);
    await setMarket('orden-b', B.market);
    // B debe ser efectivo SIN llegar al mercado (> curva): si no, la prueba no discrimina nada.
    expect(B.bounty).toBeGreaterThan(curveBuy(B.market));
    expect(A.bounty).toBeGreaterThan(curveBuy(A.market));
    await setBounty('orden-a', A.bounty);
    await setBounty('orden-b', B.bounty);

    const v = (await vitrina()).filter((d) => [cardId('orden-a'), cardId('orden-b')].includes(d.cardId));
    expect(v.map((d) => [d.cardId, d.bountyPriceCents])).toEqual([
      [cardId('orden-b'), B.bounty],
      [cardId('orden-a'), A.market],
    ]);

    // Consola `price_desc`: mismo orden relativo (espejo exacto de la vitrina).
    const orden = (await consola('price_desc'))
      .map((d) => d.cardId)
      .filter((id: string) => [cardId('orden-a'), cardId('orden-b')].includes(id));
    expect(orden).toEqual([cardId('orden-b'), cardId('orden-a')]);
  });

  // ===========================================================================================
  // BC-11 — no retroactivo sobre lo cotizado; la oferta se deriva topada
  // ===========================================================================================
  it('BC-11 — cotizada «antes» en 1200: la oferta deriva 1000, `quotedPriceCents` sigue 1200; honrar 1200 exige motivo', async () => {
    // «Antes»: el mercado estaba por ENCIMA del bounty ⇒ se cotizó y congeló el bounty completo.
    await setMarket('retro', 200_000);
    await setBounty('retro', BOUNTY);
    const { srId, itemId } = await createRequest('retro');
    expect((await h.prisma.sellRequestItem.findUniqueOrThrow({ where: { id: itemId } })).quotedPriceCents).toBe(BOUNTY);

    // El mercado cae por debajo del bounty antes de ofertar.
    await setMarket('retro', MARKET);

    // Honrar la cifra cotizada SIN motivo ⇒ 422 (criterio 148(a), ya existente).
    const sinMotivo = await offer(srId, { itemId, decision: 'buy', overridePriceCents: BOUNTY });
    expect(sinMotivo.status).toBe(422);
    expect((sinMotivo.body as any).error.code).toBe('OVERRIDE_REASON_REQUIRED');

    // Con motivo ⇒ se oferta 1200 como override; el derivado quedó topado en 1000.
    const conMotivo = await offer(srId, {
      itemId,
      decision: 'buy',
      overridePriceCents: BOUNTY,
      overrideReason: 'honrar la cifra cotizada antes del tope',
    });
    expect(conMotivo.status).toBe(200);
    const linea = await h.prisma.sellRequestItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(linea.offerDerivedPriceCents).toBe(MARKET);
    expect(linea.offeredPriceCents).toBe(BOUNTY);
    expect(linea.offerPriceBasis).toBe('override');
    // ⛔ NO retroactivo: lo cotizado no se reescribe.
    expect(linea.quotedPriceCents).toBe(BOUNTY);
    expect(linea.priceBasis).toBe('bounty');
  });

  it('BC-11 (sin override) — la oferta derivada sale topada y con `offerPriceBasis = bounty`', async () => {
    const { srId, itemId } = await createRequest('tres');
    const res = await offer(srId, { itemId, decision: 'buy' });
    expect(res.status).toBe(200);
    const linea = await h.prisma.sellRequestItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(linea.offerDerivedPriceCents).toBe(MARKET);
    expect(linea.offeredPriceCents).toBe(MARKET);
    expect(linea.offerPriceBasis).toBe('bounty');
  });

  // ===========================================================================================
  // BC-12 — lo congelado no se mueve; la línea topada SÍ cuenta para el bounty
  // ===========================================================================================
  it('BC-12 — ofertada en 1200 (mercado arriba) y luego el mercado cae a 1000: se paga y se costea 1200', async () => {
    await setMarket('congelada', 200_000);
    await setBounty('congelada', BOUNTY);
    const { srId, itemId } = await createRequest('congelada');
    expect((await offer(srId, { itemId, decision: 'buy' })).status).toBe(200);
    expect((await h.prisma.sellRequestItem.findUniqueOrThrow({ where: { id: itemId } })).offeredPriceCents).toBe(BOUNTY);

    // Tras ofertar, el mercado cae: el tope aplicaría HOY, pero lo ofertado está congelado (D2/D9).
    await setMarket('congelada', MARKET);
    expect((await quote('congelada')).quote.quotedPriceCents).toBe(MARKET); // hoy sí se topa

    const inv = await acceptPayConvert(srId, itemId, 'SPEI-BCAP-12A');
    const linea = await h.prisma.sellRequestItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(linea.approvedPriceCents).toBe(BOUNTY);
    expect(inv.acquisitionCostCents).toBe(BOUNTY);
    const sr = await h.prisma.sellRequest.findUniqueOrThrow({ where: { id: srId } });
    expect(sr.approvedTotalCents).toBe(BOUNTY);
    expect(sr.payoutNetCents).toBe(BOUNTY - (sr.offerShippingFeeCents ?? 0));
  });

  it('BC-12 — una línea TOPADA (cotizada 1000, basis bounty) que se paga SÍ incrementa `bountyAcquiredQty`', async () => {
    await setMarket('contador', MARKET);
    await setBounty('contador', BOUNTY);
    const antes = (await bountyRow('contador')).bountyAcquiredQty;
    const { srId, itemId } = await createRequest('contador');
    const item = await h.prisma.sellRequestItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.quotedPriceCents).toBe(MARKET);
    expect(item.priceBasis).toBe('bounty');
    expect((await offer(srId, { itemId, decision: 'buy' })).status).toBe(200);

    const inv = await acceptPayConvert(srId, itemId, 'SPEI-BCAP-12B');
    expect(inv.acquisitionCostCents).toBe(MARKET); // el costo es el pago topado (INV-BOUNTY-COST v1.80)
    expect((await bountyRow('contador')).bountyAcquiredQty).toBe(antes + 1);
  });
});

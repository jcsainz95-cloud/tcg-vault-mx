/**
 * `bounty-guard.e2e-spec.ts` — **EL TOPE DEL BOUNTY NO SE SALTA EL GUARDARRAÍL PREMIUM, contra Postgres
 * real y por HTTP** (API_CONTRACT v1.80.2 §M2-B.11 punto 8, ancla `M2-B11-8`, pruebas **BG-6, BG-7,
 * BG-8**; ARCHITECTURE §4.36.5(a), §4.36.6e). Las BG-1…BG-5 (unidad) viven en
 * `test/pricing.bounty-guard.spec.ts`.
 *
 * ### Escala de los montos (desviación declarada, misma doctrina que `bounty-cap.e2e-spec.ts`)
 * El contrato ilustra con mercado **100** y bounty **900000** (MX$9,000). El mercado se conserva (100 =
 * el bin del seed ⇒ la curva cae a `floor`, que es la esquina). El bounty baja a **150000** (MX$1,500):
 * con MX$9,000 la solicitud de BG-8 y la oferta de BG-7 chocan con el tope AML por solicitud del seed
 * (MX$3,000, `BUYLIST_LIMIT_EXCEEDED`), y subir ese dial contaminaría la base compartida. Lo que se
 * prueba —bounty > mercado (TOPA), curva en el bin, rareza premium— es idéntico: 150000 > 100.
 *
 * ⚠️ ANTI-VACUIDAD: cada prueba afirma como precondición qué resolvió la CURVA (`floor` o `market`) con
 * la curva VIVA (`GET /admin/pricing/curve`), no con la constante del seed.
 *
 * ⛔ Nada de mocks: el estado se monta con `h.prisma` (cartas, referencias) y la conducta se ejercita
 * por la puerta.
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { PricingCurve, resolveBuyFromCurve } from '../../src/common/pricing-curve';

const SET_ID = 'e2e-bounty-guard-set';
const CARD_PREFIX = 'e2e-bguard-';
const CLABE = '012345678901234567';
const CHASE = 'Special Illustration Rare'; // premium en el catálogo canónico

const RET = 'retenida';
const SANA = 'sana';
const BROKEN_MARKET = 100; // MX$1 — el dato corrupto: la curva cae al bin
const BOUNTY_RET = 150_000; // MX$1,500 (contrato: 900000; ver «Escala»)
const SANA_MARKET = 100_000; // MX$1,000 — curva `market`
const SANA_BOUNTY = 120_000; // topa contra un mercado SANO ⇒ paga 100000, no se retiene
// BG-8: el mercado se corrige. El contrato dice 1000000 contra su bounty 900000; con el bounty escalado
// (150000) ese mercado haría que la CURVA pagara más que el bounty (⇒ rebasado, `market`). Se elige un
// mercado que conserva la propiedad que la prueba necesita: curva < bounty < mercado (efectivo, sin tope).
const FIXED_MARKET = 200_000;

describe('E2E — el tope del bounty no se salta el guardarraíl premium (§M2-B.11 punto 8)', () => {
  let h: E2EHarness;
  let adminToken: string;
  let customerToken: string;
  let addressId: string;
  let customerId: string;
  // Estado de KYC del vendedor ANTES de este spec (se restaura en `afterAll`).
  let kycBefore: { ineFrontKey: string | null; ineBackKey: string | null } | null = null;
  let curve: PricingCurve;
  // Compartido entre BG-6 → BG-7 → BG-8 (el contrato los encadena: «la línea de BG-6», «tras BG-6»).
  let srId: string;
  let retItemId: string;
  let sanaItemId: string;

  const cardId = (slug: string) => `${CARD_PREFIX}${slug}`;
  const curveBasis = (m: number) => resolveBuyFromCurve(m, curve).basis;

  async function cleanup() {
    const cards = await h.prisma.card.findMany({ where: { setId: SET_ID }, select: { id: true } });
    const ids = cards.map((c) => c.id);
    if (ids.length > 0) {
      await h.prisma.sellRequest.deleteMany({ where: { items: { some: { cardId: { in: ids } } } } });
      await h.prisma.pendingPriceEntry.deleteMany({ where: { cardId: { in: ids } } });
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
        name: `BGUARD ${slug}`,
        number,
        rarity: CHASE,
        rarityCanonical: CHASE,
        availableFinishes: ['normal'],
      },
    });
  }

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
        capturedDate: new Date('2026-09-28T00:00:00.000Z'),
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
    return res.body as { priceBasis: string; quote: { status: string; quotedPriceCents: number | null } };
  }

  async function vitrina() {
    const res = await h.api('GET', '/buylist/bounties');
    expect(res.status).toBe(200);
    return ((res.body as any).data as { cardId: string; bountyPriceCents: number }[]).filter((d) =>
      d.cardId.startsWith(CARD_PREFIX),
    );
  }

  async function consola() {
    const res = await h.api('GET', `/admin/pricing/bounties?setId=${SET_ID}`, { token: adminToken });
    expect(res.status).toBe(200);
    return (res.body as any).data as any[];
  }

  async function createRequest(slugs: string[]) {
    const res = await h.api('POST', '/buylist/requests', {
      token: customerToken,
      json: {
        items: slugs.map((s) => ({ cardId: cardId(s), productType: 'raw', rawCondition: 'NM' })),
        clabe: CLABE,
        addressId,
      },
    });
    expect({ status: res.status, body: res.status === 201 ? null : res.body }).toEqual({ status: 201, body: null });
    const id = (res.body as { sellRequestId: string }).sellRequestId;
    const items = await h.prisma.sellRequestItem.findMany({ where: { sellRequestId: id } });
    const itemOf = (slug: string) => items.find((i) => i.cardId === cardId(slug))!;
    return { id, itemOf };
  }

  const openEntries = (slug: string) =>
    h.prisma.pendingPriceEntry.findMany({ where: { cardId: cardId(slug), productType: 'raw', status: 'open' } });

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    customerToken = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    const u = await h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.customer.email } });
    addressId = (await h.prisma.address.findFirstOrThrow({ where: { userId: u.id } })).id;
    customerId = u.id;
    // Una línea `precio_pendiente` EXIGE INE en el intake (Fase 0.3: la incertidumbre del monto se
    // trata como potencialmente sobre el umbral) ⇒ el vendedor tiene su INE en archivo, como en
    // `buylist-cycle.e2e-spec.ts` A2. Se guarda lo que había para restaurarlo.
    kycBefore = await h.prisma.kycProfile.findUnique({
      where: { userId: customerId },
      select: { ineFrontKey: true, ineBackKey: true },
    });
    await h.prisma.kycProfile.upsert({
      where: { userId: customerId },
      create: { userId: customerId, ineFrontKey: 'ine/front.jpg', ineBackKey: 'ine/back.jpg', kycStatus: 'pending' },
      update: { ineFrontKey: 'ine/front.jpg', ineBackKey: 'ine/back.jpg' },
    });
    curve = (await h.api<PricingCurve>('GET', '/admin/pricing/curve', { token: adminToken })).body;
    expect(curve?.buy?.points?.length).toBeGreaterThan(0);

    await cleanup();
    await h.prisma.cardSet.create({ data: { id: SET_ID, externalId: SET_ID, name: 'E2E Bounty Guard' } });
    await makeCard(RET, '1');
    await makeCard(SANA, '2');
    await setMarket(RET, BROKEN_MARKET);
    await setMarket(SANA, SANA_MARKET);
    await setBounty(RET, BOUNTY_RET);
    await setBounty(SANA, SANA_BOUNTY);
  });

  afterAll(async () => {
    // Una fila de bounty viva contaminaría la vitrina pública de cualquier spec posterior.
    if (h) {
      await cleanup();
      if (kycBefore) await h.prisma.kycProfile.update({ where: { userId: customerId }, data: kycBefore });
      else await h.prisma.kycProfile.deleteMany({ where: { userId: customerId } });
    }
    await h?.close();
  });

  // ===========================================================================================
  // BG-6 ⭐⭐ — todas las superficies, una conducta
  // ===========================================================================================
  it('BG-6 precondición — la curva VIVA: retenida en `floor`, sana en `market`; ambas topan', () => {
    expect(curveBasis(BROKEN_MARKET)).toBe('floor');
    expect(curveBasis(SANA_MARKET)).toBe('market');
    expect(BOUNTY_RET).toBeGreaterThan(BROKEN_MARKET);
    expect(SANA_BOUNTY).toBeGreaterThan(SANA_MARKET);
  });

  it('BG-6 — POST /buylist/quote: retenida `precio_pendiente`/null; sana cotiza el pago topado', async () => {
    const r = await quote(RET);
    expect(r.quote.status).toBe('precio_pendiente');
    expect(r.quote.quotedPriceCents).toBeNull();
    expect(r.priceBasis).toBe('pending');
    const s = await quote(SANA);
    expect(s.quote.quotedPriceCents).toBe(SANA_MARKET);
    expect(s.priceBasis).toBe('bounty');
  });

  it('BG-6 — POST /buylist/quote/batch: la misma conducta por ítem', async () => {
    const res = await h.api('POST', '/buylist/quote/batch', {
      json: {
        items: [RET, SANA].map((s) => ({ cardId: cardId(s), productType: 'raw', rawCondition: 'NM' })),
      },
    });
    expect(res.status).toBe(200);
    const results = (res.body as any).results as any[];
    expect(results[0]).toMatchObject({
      ok: true,
      priceBasis: 'pending',
      quote: { status: 'precio_pendiente', quotedPriceCents: null },
    });
    expect(results[1]).toMatchObject({ ok: true, priceBasis: 'bounty', quote: { quotedPriceCents: SANA_MARKET } });
  });

  it('BG-6 — GET /buylist/bounties: la retenida AUSENTE, la sana PRESENTE (canario de no-vaciar)', async () => {
    const v = await vitrina();
    expect(v.find((d) => d.cardId === cardId(RET))).toBeUndefined();
    expect(v.find((d) => d.cardId === cardId(SANA))?.bountyPriceCents).toBe(SANA_MARKET);
  });

  it('BG-6 — POST /buylist/requests: línea `precio_pendiente`, `quotedPriceCents null`, cola `premium_at_floor`', async () => {
    expect(await openEntries(RET)).toHaveLength(0); // precondición: la cola arranca vacía (READ-ONLY de /quote)
    const { id, itemOf } = await createRequest([RET, SANA]);
    srId = id;
    retItemId = itemOf(RET).id;
    sanaItemId = itemOf(SANA).id;
    const ret = await h.prisma.sellRequestItem.findUniqueOrThrow({ where: { id: retItemId } });
    expect(ret.itemStatus).toBe('precio_pendiente');
    expect(ret.quotedPriceCents).toBeNull();
    expect(ret.priceBasis).toBe('pending');
    const sana = await h.prisma.sellRequestItem.findUniqueOrThrow({ where: { id: sanaItemId } });
    expect(sana.quotedPriceCents).toBe(SANA_MARKET);
    expect(sana.priceBasis).toBe('bounty');

    const open = await openEntries(RET);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ reason: 'premium_at_floor', context: 'buylist', gradeKey: 'raw:NM' });
    expect(await openEntries(SANA)).toHaveLength(0);
  });

  it('BG-6 — consola: los cinco valores del punto 8 y `state` `activa`; la sana intacta', async () => {
    const rows = await consola();
    const ret = rows.find((d) => d.cardId === cardId(RET));
    expect(ret.state).toBe('activa');
    expect(ret.pricing.buy).toMatchObject({ source: 'pending', effectiveCents: null, premiumAtFloor: true });
    expect(ret.pricing.bounty).toMatchObject({
      priceCents: BOUNTY_RET,
      effective: true,
      payoutCents: null,
      cappedByMarket: false,
    });
    const sana = rows.find((d) => d.cardId === cardId(SANA));
    expect(sana.state).toBe('activa');
    expect(sana.pricing.buy).toMatchObject({ source: 'bounty', effectiveCents: SANA_MARKET, premiumAtFloor: false });
    expect(sana.pricing.bounty).toMatchObject({ payoutCents: SANA_MARKET, cappedByMarket: true });
  });

  // ===========================================================================================
  // BG-7 — la oferta llega SIN derivado; el operador pone el precio con motivo
  // ===========================================================================================
  it('BG-7 — oferta: la retenida sin precio ⇒ 422 OFFER_LINE_NOT_PRICEABLE; con motivo ⇒ se oferta como `override`, derivado null', async () => {
    const offer = (retLine: Record<string, unknown>) =>
      h.api('POST', `/admin/buylist/${srId}/offer`, {
        token: adminToken,
        json: { lines: [{ itemId: retItemId, decision: 'buy', ...retLine }, { itemId: sanaItemId, decision: 'buy' }] },
      });
    // Sin precio a mano la línea no es ofertable (derivado null ⇒ exige override motivado o skip):
    // se rechaza y NO se escribe nada.
    const sinPrecio = await offer({});
    expect(sinPrecio.status).toBe(422);
    expect((sinPrecio.body as any).error.code).toBe('OFFER_LINE_NOT_PRICEABLE');
    expect((await h.prisma.sellRequestItem.findUniqueOrThrow({ where: { id: retItemId } })).offeredPriceCents).toBeNull();

    const res = await offer({ overridePriceCents: BOUNTY_RET, overrideReason: 'mercado roto: se honra el bounty' });
    expect(res.status).toBe(200);
    const ret = await h.prisma.sellRequestItem.findUniqueOrThrow({ where: { id: retItemId } });
    expect(ret.offerDerivedPriceCents).toBeNull();
    expect(ret.offeredPriceCents).toBe(BOUNTY_RET);
    expect(ret.offerPriceBasis).toBe('override');
    // Canario: la sana deriva su pago topado.
    const sana = await h.prisma.sellRequestItem.findUniqueOrThrow({ where: { id: sanaItemId } });
    expect(sana.offerDerivedPriceCents).toBe(SANA_MARKET);
    expect(sana.offerPriceBasis).toBe('bounty');
  });

  // ===========================================================================================
  // BG-8 — cierre: la retención se DERIVA, no se persiste
  // ===========================================================================================
  it('BG-8 — el mercado se corrige ⇒ la cotización da el bounty completo y la entrada de la cola se cierra', async () => {
    expect(await openEntries(RET)).toHaveLength(1); // precondición: lo que dejó BG-6
    await setMarket(RET, FIXED_MARKET);
    expect(curveBasis(FIXED_MARKET)).toBe('market');
    expect(resolveBuyFromCurve(FIXED_MARKET, curve).cents as number).toBeLessThan(BOUNTY_RET); // efectivo
    expect(BOUNTY_RET).toBeLessThan(FIXED_MARKET); // sin tope

    const q = await quote(RET);
    expect(q.priceBasis).toBe('bounty');
    expect(q.quote.quotedPriceCents).toBe(BOUNTY_RET); // ya no topa: bounty < mercado

    // Re-resolver por el seam que escala Y cierra (`createRequest`; `/quote` es READ-ONLY).
    const { itemOf } = await createRequest([RET]);
    expect(itemOf(RET).quotedPriceCents).toBe(BOUNTY_RET);
    expect(itemOf(RET).priceBasis).toBe('bounty');
    expect(await openEntries(RET)).toHaveLength(0);
    const resolved = await h.prisma.pendingPriceEntry.findMany({
      where: { cardId: cardId(RET), reason: 'premium_at_floor', status: 'resolved' },
    });
    expect(resolved).toHaveLength(1);
  });
});

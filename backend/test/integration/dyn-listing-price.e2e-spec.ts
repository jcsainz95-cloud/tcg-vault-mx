/**
 * dyn-listing-price.e2e-spec.ts — 💰 v1.113⟨portada⟩ + errata v1.113.1 (API_CONTRACT §DYN.5, M-94) contra Postgres REAL y la
 * app por HTTP: «se paga lo que se ve… se mueve hasta la próxima corrida» (`HECHOS.md` 2026-10-29).
 *
 *  A. M-94: CHECKs (`priced` ⇔ P y L ≥ 1; `pending` ⇔ sin precio) y cascada al borrar la pieza.
 *  B. DYN-B16 (I-3): fila `priced` cuyo `P` ≠ el del cálculo en vivo (se mueven `PriceReference` y el dial de IVA DESPUÉS
 *     de escribirla, sin correr el cálculo): rejilla, ficha, `/catalog/listings/:id`, Destacadas, quote y sesión (cuenta e
 *     invitado) dan el de la fila; el PaymentIntent suma ese; `OrderItem` congela la instrumentación de la fila; tras correr
 *     el cálculo, todos dan el nuevo. v1.113.3: la ficha (carta y sellado) y `/catalog/listings/:id` muestran el «valor de
 *     mercado» de la FILA (`referenceValue`, `capturedDate`, `referenceDisplayCents`), no el de la `PriceReference` movida.
 *  C. DYN-B19: `pending` nunca se exhibe ni se cobra; sin fila ⇒ precio en vivo correcto + `missing_row` encolado.
 *  D. DYN-B18: la corrida AUTOMÁTICA de `price-ingest` no mueve lo exhibido; «Actualizar precios» (manual) sí.
 *  E. Disparadores: `dial_change` por `PUT /admin/settings` (clave que mueve precio sí, otra no) y por
 *     `PUT /admin/settings/iva-transfer`; `publish` al publicar; `manual_price` al poner precio a mano.
 *  F. `dataHealth.listingPrices` (§DYN.5.8) y cabeceras de §DYN.6.1/§DYN.6.5.
 * Deterministas (N=1): el cálculo se corre con `run()` o se espera con `idle()`; no hay carrera que medir aquí.
 */
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { seedE2E } from '../../prisma/seed-e2e';
import { ListingPriceService } from '../../src/modules/pricing/listing-price.service';
import { SaleDecisionService, SaleItem, isPricePending } from '../../src/modules/pricing/sale-decision.service';
import { PriceIngestService } from '../../src/modules/pricing/price-ingest.service';
import { SchedulerService } from '../../src/jobs/scheduler.service';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { marketBracketOf } from '../../src/common/pricing-curve';
import { marketDisplayCentsOf, SEALED_SALE_PRICE_INCLUDE } from '../../src/common/money';

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

describe('E2E — §DYN.5 precio del día (M-94): se cobra lo que se ve', () => {
  let h: E2EHarness;
  let admin: string;
  let operator: string;
  let customer: string;
  let lp: ListingPriceService;
  let decider: SaleDecisionService;
  const run = randomUUID().slice(0, 8);
  let setId: string;
  let cardId: string;
  let shelf: string | null;
  let seq = 0;
  const savedSettings = new Map<string, Prisma.JsonValue | undefined>();
  const SAVED_KEYS = ['iva_transfer_pct', 'iva_pct', 'fx_buffer_pct', 'featured_pool_size'];

  async function item(data: Partial<Prisma.InventoryItemUncheckedCreateInput> = {}) {
    seq += 1;
    return h.prisma.inventoryItem.create({
      data: {
        folio: `LP-${run}-${seq}`,
        cardId,
        productType: 'raw',
        rawCondition: 'NM',
        finish: 'normal',
        ownerType: 'platform',
        status: 'listed',
        acquisitionType: 'compra',
        acquisitionCostCents: 1000,
        firstListedAt: new Date(),
        locationId: shelf,
        ...data,
      },
    });
  }
  const full = (id: string) =>
    h.prisma.inventoryItem.findUniqueOrThrow({
      where: { id },
      include: { card: { include: { set: true } }, ...SEALED_SALE_PRICE_INCLUDE },
    }) as Promise<SaleItem>;
  /** El cálculo EN VIVO de una pieza (el cuerpo único con los diales de ahora). */
  async function live(id: string): Promise<number | 'pending'> {
    try {
      return (await decider.decide(await full(id), await h.app.get(SettingsService).getIvaDials())).unitPriceCents;
    } catch (e) {
      if (isPricePending(e)) return 'pending';
      throw e;
    }
  }
  const row = (id: string) => h.prisma.listingPrice.findUnique({ where: { inventoryItemId: id } });
  async function setMarket(cents: number) {
    await h.prisma.priceReference.updateMany({ where: { cardId, source: 'manual' }, data: { priceMxnCents: cents } });
  }
  async function setSettingRaw(key: string, value: Prisma.InputJsonValue) {
    await h.prisma.configSetting.upsert({ where: { key }, create: { key, valueJson: value }, update: { valueJson: value } });
  }
  const listing = (id: string) => h.api<{ displayPriceCents?: number; priceBasis: string }>('GET', `/catalog/listings/${id}`);
  const quote = (ids: string[]) =>
    h.api<{ items: { inventoryItemId: string; unitPriceCents: number }[]; subtotalCents: number }>('POST', '/checkout/quote', {
      token: customer,
      json: { inventoryItemIds: ids },
    });
  const guestQuote = (ids: string[]) =>
    h.api<{ items: { inventoryItemId: string; unitPriceCents: number }[] }>('POST', '/checkout/guest/quote', {
      json: { inventoryItemIds: ids },
    });

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    operator = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    customer = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    lp = h.app.get(ListingPriceService);
    decider = h.app.get(SaleDecisionService);
    for (const key of SAVED_KEYS) savedSettings.set(key, (await h.prisma.configSetting.findUnique({ where: { key } }))?.valueJson);
    shelf = (await h.prisma.vaultLocation.findFirst({ where: { zone: 'platform_stock', isActive: true } }))?.id ?? null;
    const set = await h.prisma.cardSet.create({ data: { externalId: `lp-${run}`, name: `Set Precio ${run}` } });
    setId = set.id;
    const card = await h.prisma.card.create({
      data: {
        externalId: `lp-${run}-1`,
        setId,
        name: `Carta Precio Dia ${run}`,
        number: '1',
        rarity: 'Common',
        rarityCanonical: 'Common',
        imageSmallUrl: 'https://images.pokemontcg.io/lp/1.png',
        availableFinishes: ['normal'],
      },
    });
    cardId = card.id;
    await h.prisma.priceReference.create({
      data: {
        cardId,
        productType: 'raw',
        gradeKey: 'raw:NM',
        finish: 'normal',
        source: 'manual',
        priceMxnCents: 50_000,
        capturedDate: new Date(new Date().toISOString().slice(0, 10)),
        isManualOverride: true,
        refKind: 'market',
      },
    });
  });

  afterAll(async () => {
    if (h) {
      await lp?.idle();
      for (const [key, v] of savedSettings) {
        if (v === undefined) await h.prisma.configSetting.deleteMany({ where: { key } });
        else await h.prisma.configSetting.update({ where: { key }, data: { valueJson: v as Prisma.InputJsonValue } });
      }
      await h.prisma.featuredSelection.deleteMany({ where: { seed: { startsWith: `e2e-lp-${run}` } } });
      const items = await h.prisma.inventoryItem.findMany({ where: { folio: { startsWith: `LP-${run}-` } }, select: { id: true } });
      const ids = items.map((i) => i.id);
      const orderIds = (await h.prisma.orderItem.findMany({ where: { inventoryItemId: { in: ids } }, select: { orderId: true } })).map((o) => o.orderId);
      await h.prisma.inventoryItem.updateMany({ where: { id: { in: ids } }, data: { reservedByOrderId: null } });
      await h.prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
      await h.prisma.order.deleteMany({ where: { id: { in: orderIds } } }).catch(() => undefined);
      await h.prisma.inventoryMovement.deleteMany({ where: { itemId: { in: ids } } });
      await h.prisma.inventoryItem.deleteMany({ where: { id: { in: ids } } }).catch(() => undefined);
      await h.prisma.priceReference.deleteMany({ where: { cardId } });
      await h.prisma.pendingPriceEntry.deleteMany({ where: { cardId } });
      await h.prisma.card.deleteMany({ where: { id: cardId } }).catch(() => undefined);
      await h.prisma.cardSet.deleteMany({ where: { id: setId } }).catch(() => undefined);
      await h.close();
    }
  });

  describe('A. M-94', () => {
    it('CHECK: `priced` exige P y L ≥ 1; `pending` exige sin precio; la fila cae con su pieza', async () => {
      const it1 = await item();
      const r = await lp.run('manual_price', [it1.id]);
      expect(r).toMatchObject({ status: 'ok', scopeItemCount: 1, pricedCount: 1, pendingCount: 0 });
      await expect(
        h.prisma.$executeRaw`UPDATE "ListingPrice" SET "unitPriceCents" = NULL WHERE "inventoryItemId" = ${it1.id}`,
      ).rejects.toThrow(/ListingPrice_status_price_check/);
      await expect(
        h.prisma.$executeRaw`UPDATE "ListingPrice" SET status = 'pending' WHERE "inventoryItemId" = ${it1.id}`,
      ).rejects.toThrow(/ListingPrice_status_price_check/);
      await expect(
        h.prisma.$executeRaw`UPDATE "ListingPrice" SET "unitPriceCents" = 0 WHERE "inventoryItemId" = ${it1.id}`,
      ).rejects.toThrow(/ListingPrice_status_price_check/);
      const runRow = await h.prisma.listingPriceRun.findUniqueOrThrow({ where: { id: r.runId } });
      expect(runRow).toMatchObject({ trigger: 'manual_price', status: 'ok' });
      expect(runRow.finishedAt).toBeInstanceOf(Date);
      await h.prisma.inventoryItem.delete({ where: { id: it1.id } });
      expect(await row(it1.id)).toBeNull();
    });
  });

  describe('B. DYN-B16 — exhibido = cobrado = la fila, aunque el vivo ya sea otro', () => {
    it('rejilla, ficha, listing, Destacadas, quote y sesión (cuenta e invitado) cobran la FILA; tras el cálculo, el nuevo', async () => {
      await setMarket(50_000);
      await setSettingRaw('iva_transfer_pct', 100);
      const A = await item();
      const B = await item();
      const C = await item();
      await lp.run('manual_price', [A.id, B.id, C.id]);
      const fila = (await row(A.id))!;
      expect(fila.status).toBe('priced');
      const P1 = fila.unitPriceCents!;
      expect(P1).toBe(await live(A.id)); // recién calculada: fila = vivo
      expect([(await row(B.id))!.unitPriceCents, (await row(C.id))!.unitPriceCents]).toEqual([P1, P1]);

      // Se mueve el mercado Y un dial de IVA DESPUÉS de escribir la fila, sin correr el cálculo (escritura directa: no es
      // una puerta). El vivo ya es otro — y tiene que serlo, o la prueba no distingue fila de vivo.
      await setMarket(90_000);
      await setSettingRaw('iva_transfer_pct', 50);
      const P2 = await live(A.id);
      expect(P2).not.toBe(P1);
      expect(typeof P2).toBe('number');

      // Lectores: listing, ficha, rejilla.
      expect((await listing(C.id)).body.displayPriceCents).toBe(P1);
      const ficha = await h.api<{ listings: { displayPriceCents: number; productType: string }[] }>('GET', `/catalog/cards/${cardId}`);
      expect(ficha.status).toBe(200);
      expect(ficha.body.listings.map((l) => l.displayPriceCents)).toEqual([P1]);
      const rejilla = await h.api<{ data: { card: { id: string }; displayPriceCents: number }[] }>(
        'GET',
        `/catalog/cards?q=${encodeURIComponent(`Carta Precio Dia ${run}`)}&pageSize=20`,
      );
      expect(rejilla.body.data.filter((g) => g.card.id === cardId).map((g) => g.displayPriceCents)).toEqual([P1]);

      // Destacadas: una selección vigente con la llave de esta carta.
      const now = Date.now();
      await h.prisma.featuredSelection.create({
        data: {
          businessDate: new Date('2099-01-01T00:00:00Z'),
          effectiveFrom: new Date(now - 1000),
          seed: `e2e-lp-${run}`,
          dials: {},
          poolCount: 1,
          newArrivalCandidates: 0,
          items: { create: [{ position: 1, slotKind: 'pool', cardId, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' }] },
        },
      });
      const featured = await h.api<{ data: { card: { id: string }; displayPriceCents: number }[] }>('GET', '/catalog/featured');
      expect(featured.body.data.filter((g) => g.card.id === cardId).map((g) => g.displayPriceCents)).toEqual([P1]);
      await h.prisma.featuredSelection.deleteMany({ where: { seed: `e2e-lp-${run}` } });

      // Quote (cuenta e invitado).
      const q = await quote([A.id]);
      expect(q.status).toBe(200);
      expect(q.body.items[0].unitPriceCents).toBe(P1);
      const gq = await guestQuote([B.id]);
      expect(gq.status).toBe(200);
      expect(gq.body.items[0].unitPriceCents).toBe(P1);

      // Sesión con cuenta: el PaymentIntent suma la fila y `OrderItem` congela SU instrumentación.
      const s = await h.api<{ orderId: string; breakdown: { subtotalCents: number; totalCents: number }; stripe: { paymentIntentId: string } }>(
        'POST',
        '/checkout/session',
        { token: customer, json: { inventoryItemIds: [A.id] }, headers: { 'idempotency-key': `lp-${run}-a` } },
      );
      expect(s.status).toBe(201);
      expect(s.body.breakdown.subtotalCents).toBe(P1);
      const piA = h.stripe.createdIntents.find((p) => p.id === s.body.stripe.paymentIntentId)!;
      expect(piA.amountCents).toBe(s.body.breakdown.totalCents);
      const oiA = await h.prisma.orderItem.findFirstOrThrow({ where: { orderId: s.body.orderId } });
      expect(oiA).toMatchObject({
        unitPriceCents: P1,
        marketMxnCents: fila.marketMxnCents,
        priceBasis: fila.priceBasis,
        marketBracket: marketBracketOf(fila.marketMxnCents),
        finish: 'normal',
      });

      // Sesión de invitado.
      const gs = await h.api<{ orderId: string; breakdown: { subtotalCents: number; totalCents: number }; stripe: { paymentIntentId: string } }>(
        'POST',
        '/checkout/guest/session',
        { json: { inventoryItemIds: [B.id], email: `lp.${run}@example.com`, shippingAddress: ADDRESS, acceptedTerms: true, locale: 'es' } },
      );
      expect(gs.status).toBe(201);
      expect(gs.body.breakdown.subtotalCents).toBe(P1);
      const piB = h.stripe.createdIntents.find((p) => p.id === gs.body.stripe.paymentIntentId)!;
      expect(piB.amountCents).toBe(gs.body.breakdown.totalCents);
      const oiB = await h.prisma.orderItem.findFirstOrThrow({ where: { orderId: gs.body.orderId } });
      expect(oiB).toMatchObject({ unitPriceCents: P1, marketMxnCents: fila.marketMxnCents, priceBasis: fila.priceBasis });

      // Corre el cálculo ⇒ todos dan el nuevo.
      await lp.run('manual_price', [C.id]);
      expect((await row(C.id))!.unitPriceCents).toBe(P2);
      expect((await listing(C.id)).body.displayPriceCents).toBe(P2);
      expect((await quote([C.id])).body.items[0].unitPriceCents).toBe(P2);
      expect((await guestQuote([C.id])).body.items[0].unitPriceCents).toBe(P2);
      await setSettingRaw('iva_transfer_pct', 100);
      await setMarket(50_000);

      // Y en la otra dirección: el vivo por DEBAJO de la fila ⇒ se cobra la fila igual (arriba el vivo quedó por encima:
      // entre las dos, ni `min` ni `max` de fila y vivo pasan).
      const E = await item();
      await lp.run('manual_price', [E.id]);
      const PE = (await row(E.id))!.unitPriceCents!;
      await setMarket(20_000);
      const liveE = await live(E.id);
      expect(typeof liveE === 'number' && liveE < PE).toBe(true);
      expect((await quote([E.id])).body.items[0].unitPriceCents).toBe(PE);
      const es = await h.api<{ breakdown: { subtotalCents: number } }>('POST', '/checkout/guest/session', {
        json: { inventoryItemIds: [E.id], email: `lp.e.${run}@example.com`, shippingAddress: ADDRESS, acceptedTerms: true, locale: 'es' },
      });
      expect(es.status).toBe(201);
      expect(es.body.breakdown.subtotalCents).toBe(PE);
      await setMarket(50_000);
    });
  });

  describe('B-bis. DYN-B16 (v1.113.3) — el «valor de mercado» exhibido es el de la FILA, no el de la referencia movida', () => {
    type Ref = { status: string; referenceMxnCents?: number; capturedDate?: string; source?: string };
    const today = () => new Date(new Date().toISOString().slice(0, 10));
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    const daysAgo = (n: number) => new Date(today().getTime() - n * 86_400_000);
    const extraCards: string[] = [];
    afterAll(async () => {
      const items = await h.prisma.inventoryItem.findMany({ where: { cardId: { in: extraCards } }, select: { id: true } });
      await h.prisma.inventoryItem.deleteMany({ where: { id: { in: items.map((i) => i.id) } } });
      await h.prisma.priceReference.deleteMany({ where: { cardId: { in: extraCards } } });
      await h.prisma.pendingPriceEntry.deleteMany({ where: { cardId: { in: extraCards } } });
      await h.prisma.card.deleteMany({ where: { id: { in: extraCards } } });
    });
    async function ownCard(n: number) {
      const c = await h.prisma.card.create({
        data: {
          externalId: `lp-${run}-ref-${n}`,
          setId,
          name: `Carta Referencia ${run} ${n}`,
          number: String(100 + n),
          rarity: 'Common',
          rarityCanonical: 'Common',
          imageSmallUrl: `https://images.pokemontcg.io/lp/ref-${n}.png`,
          availableFinishes: ['normal'],
        },
      });
      extraCards.push(c.id);
      return c.id;
    }

    it('ficha de CARTA y `/catalog/listings/:id`: referencia y fecha de la fila; tras el cálculo, las nuevas', async () => {
      const k = await ownCard(1);
      await h.prisma.priceReference.create({
        data: { cardId: k, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'manual', priceMxnCents: 50_000, capturedDate: daysAgo(2), isManualOverride: true, refKind: 'market' },
      });
      const R = await item({ cardId: k });
      await lp.run('manual_price', [R.id]);
      const fila = (await row(R.id))!;
      expect(fila).toMatchObject({ status: 'priced', priceBasis: 'market', referenceMxnCents: 50_000 });
      expect(ymd(fila.referenceCapturedDate!)).toBe(ymd(daysAgo(2)));
      const frozen: Ref = { status: 'priced', referenceMxnCents: 50_000, capturedDate: ymd(daysAgo(2)) };

      // Se MUEVE la referencia (monto y fecha), sin correr el cálculo.
      await h.prisma.priceReference.updateMany({ where: { cardId: k }, data: { priceMxnCents: 90_000, capturedDate: today() } });

      const ficha = await h.api<{
        listings: { referenceValue: Ref; referenceDisplayCents?: number; ivaRatePct: number; displayPriceCents: number }[];
        units: { referenceValue: Ref }[];
      }>('GET', `/catalog/cards/${k}`);
      expect(ficha.status).toBe(200);
      expect(ficha.body.listings).toHaveLength(1);
      expect(ficha.body.listings[0].displayPriceCents).toBe(fila.unitPriceCents);
      expect(ficha.body.listings[0].referenceValue).toEqual(frozen);
      expect(ficha.body.listings[0].referenceDisplayCents).toBe(marketDisplayCentsOf(50_000, ficha.body.listings[0].ivaRatePct));
      expect(ficha.body.units.map((u) => u.referenceValue)).toEqual([frozen]);
      expect((await h.api<{ referenceValue: Ref }>('GET', `/catalog/listings/${R.id}`)).body.referenceValue).toEqual(frozen);

      // Tras el cálculo, la foto nueva: precio Y referencia.
      await lp.run('manual_price', [R.id]);
      const moved: Ref = { status: 'priced', referenceMxnCents: 90_000, capturedDate: ymd(today()) };
      const ficha2 = await h.api<{ listings: { referenceValue: Ref }[] }>('GET', `/catalog/cards/${k}`);
      expect(ficha2.body.listings[0].referenceValue).toEqual(moved);
      expect((await h.api<{ referenceValue: Ref }>('GET', `/catalog/listings/${R.id}`)).body.referenceValue).toEqual(moved);
    });

    it('ficha de SELLADO: el grupo y sus piezas muestran la referencia de la fila; tras el cálculo, la nueva', async () => {
      const k = await ownCard(2);
      const pid = 800_000_000 + Math.floor(Math.random() * 90_000_000);
      await h.prisma.priceReference.create({
        data: { cardId: k, productType: 'sealed', gradeKey: `sealed:tcg:${pid}`, finish: 'normal', source: 'manual', priceMxnCents: 80_000, capturedDate: daysAgo(3), isManualOverride: true, refKind: 'market' },
      });
      const S = await item({ cardId: k, productType: 'sealed', rawCondition: null, sealedSubtype: 'box', sealedCondition: 'mint', tcgplayerProductId: pid });
      await lp.run('manual_price', [S.id]);
      const fila = (await row(S.id))!;
      expect(fila).toMatchObject({ status: 'priced', priceBasis: 'market', referenceMxnCents: 80_000 });
      const frozen: Ref = { status: 'priced', referenceMxnCents: 80_000, capturedDate: ymd(daysAgo(3)) };

      await h.prisma.priceReference.updateMany({ where: { cardId: k }, data: { priceMxnCents: 120_000, capturedDate: today() } });

      type Detail = { group: { referenceValue: Ref; referenceDisplayCents?: number; ivaRatePct: number; fromPriceCents: number }; listings: { referenceValue: Ref }[] };
      const d1 = await h.api<Detail>('GET', `/catalog/sealed/${S.id}`);
      expect(d1.status).toBe(200);
      expect(d1.body.group.fromPriceCents).toBe(fila.unitPriceCents);
      expect(d1.body.group.referenceValue).toEqual(frozen);
      expect(d1.body.group.referenceDisplayCents).toBe(marketDisplayCentsOf(80_000, d1.body.group.ivaRatePct));
      expect(d1.body.listings.map((l) => l.referenceValue)).toEqual([frozen]);

      await lp.run('manual_price', [S.id]);
      const d2 = await h.api<Detail>('GET', `/catalog/sealed/${S.id}`);
      expect(d2.body.group.referenceValue).toEqual({ status: 'priced', referenceMxnCents: 120_000, capturedDate: ymd(today()) });
    });
  });

  describe('C. DYN-B19 — `pending` nunca se exhibe ni se cobra; sin fila ⇒ vivo + `missing_row`', () => {
    it('fila `pending` ⇒ fuera del catálogo y `PRICE_PENDING` en quote y sesión, aunque el vivo SÍ tenga precio', async () => {
      const X = await item();
      await lp.run('manual_price', [X.id]);
      await h.prisma.$executeRaw`UPDATE "ListingPrice" SET status = 'pending', "unitPriceCents" = NULL, "listPriceCents" = NULL,
        "fixedDisplayCents" = NULL WHERE "inventoryItemId" = ${X.id}`;
      expect(typeof (await live(X.id))).toBe('number'); // el vivo tiene precio: lo que manda es la fila
      expect((await listing(X.id)).status).toBe(404);
      const q = await h.api<{ error: { code: string } }>('POST', '/checkout/quote', { token: customer, json: { inventoryItemIds: [X.id] } });
      expect(q.status).toBe(422);
      expect(q.body.error.code).toBe('PRICE_PENDING');
      const s = await h.api<{ error: { code: string } }>('POST', '/checkout/session', {
        token: customer,
        json: { inventoryItemIds: [X.id] },
        headers: { 'idempotency-key': `lp-${run}-x` },
      });
      expect(s.status).toBe(422);
      expect(s.body.error.code).toBe('PRICE_PENDING');
      expect((await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: X.id } })).status).toBe('listed'); // nada apartado
    });

    it('sin fila ⇒ el lector da el precio en vivo correcto y encola `missing_row`, que escribe la fila', async () => {
      const Y = await item();
      expect(await row(Y.id)).toBeNull();
      const expected = await live(Y.id);
      const before = await h.prisma.listingPriceRun.count({ where: { trigger: 'missing_row' } });
      expect((await listing(Y.id)).body.displayPriceCents).toBe(expected);
      await lp.idle();
      expect(await h.prisma.listingPriceRun.count({ where: { trigger: 'missing_row' } })).toBeGreaterThan(before);
      expect(await row(Y.id)).toMatchObject({ status: 'priced', unitPriceCents: expected });
      // Y en el checkout, sin fila, el vivo y la cola también.
      const Z = await item();
      expect((await quote([Z.id])).body.items[0].unitPriceCents).toBe(await live(Z.id));
      await lp.idle();
      expect(await row(Z.id)).toMatchObject({ status: 'priced' });
    });
  });

  describe('D. DYN-B18 — la corrida AUTOMÁTICA de `price-ingest` no mueve lo exhibido; la manual sí', () => {
    it('automática (cron) ⇒ exhibido igual y sin corrida; «Actualizar precios» ⇒ `manual_ingest` y recalculado', async () => {
      const ingest = h.app.get(PriceIngestService);
      // Sin red: el barrido «escribe» el mercado nuevo (lo que haría el proveedor) y nada más.
      const sweep = jest.spyOn(ingest, 'ingestAll').mockImplementation(async () => {
        await setMarket(70_000);
        return undefined as never;
      });
      const graded = jest.spyOn(ingest, 'ingestGradedEstimates').mockResolvedValue({} as never);
      try {
        await setMarket(50_000);
        const W = await item();
        await lp.run('manual_price', [W.id]);
        const P1 = (await row(W.id))!.unitPriceCents!;
        const runsBefore = await h.prisma.listingPriceRun.count({ where: { trigger: 'manual_ingest' } });
        await h.app.get(SchedulerService).process({ name: 'price-ingest' });
        await lp.idle();
        expect(sweep).toHaveBeenCalledTimes(1);
        expect(await live(W.id)).not.toBe(P1); // el mercado sí se movió…
        expect((await listing(W.id)).body.displayPriceCents).toBe(P1); // …lo exhibido no
        expect(await h.prisma.listingPriceRun.count({ where: { trigger: 'manual_ingest' } })).toBe(runsBefore);

        const res = await h.api('POST', '/admin/jobs/price-ingest', { token: admin, json: {} });
        expect(res.status).toBe(202);
        for (let i = 0; i < 50 && (await h.prisma.listingPriceRun.count({ where: { trigger: 'manual_ingest', status: 'ok' } })) === runsBefore; i++) {
          await new Promise((r) => setTimeout(r, 100));
          await lp.idle();
        }
        expect(await h.prisma.listingPriceRun.count({ where: { trigger: 'manual_ingest', status: 'ok' } })).toBe(runsBefore + 1);
        expect((await listing(W.id)).body.displayPriceCents).toBe(await live(W.id));
      } finally {
        sweep.mockRestore();
        graded.mockRestore();
        await setMarket(50_000);
      }
    });
  });

  describe('E. disparadores (§DYN.5.3)', () => {
    const count = (trigger: 'dial_change' | 'publish' | 'manual_price') => h.prisma.listingPriceRun.count({ where: { trigger } });

    it('`PUT /admin/settings` con una clave que mueve precio ⇒ `dial_change`; con otra (Destacadas) ⇒ nada', async () => {
      await lp.idle();
      const before = await count('dial_change');
      const pool = await h.api('PUT', '/admin/settings', { token: admin, json: { featuredPoolSize: 61 } });
      expect(pool.status).toBe(200);
      await lp.idle();
      expect(await count('dial_change')).toBe(before);
      const cur = await h.api<{ fxBufferPct: number }>('GET', '/admin/settings', { token: admin });
      const fx = await h.api('PUT', '/admin/settings', { token: admin, json: { fxBufferPct: cur.body.fxBufferPct } });
      expect(fx.status).toBe(200);
      await lp.idle();
      expect(await count('dial_change')).toBe(before + 1);
    });

    it('`PUT /admin/settings/iva-transfer` (la puerta fuera de `PUT /admin/settings`) ⇒ `dial_change`', async () => {
      await setSettingRaw('iva_transfer_pct', 100);
      await lp.idle();
      const before = await count('dial_change');
      const prev = await h.api<{ samplePriceCents: number; netDeltaPerUnitCents: number }>(
        'GET', '/admin/settings/iva-transfer/preview?ivaTransferPct=60', { token: admin },
      );
      const mv = await h.api('PUT', '/admin/settings/iva-transfer', {
        token: admin,
        json: { ivaTransferPct: 60, acknowledgement: { samplePriceCents: prev.body.samplePriceCents, previewedNetDeltaCents: prev.body.netDeltaPerUnitCents } },
      });
      expect(mv.status).toBe(200);
      await lp.idle();
      expect(await count('dial_change')).toBe(before + 1);
      await setSettingRaw('iva_transfer_pct', 100);
      await lp.run('dial_change');
    });

    it('publicar ⇒ `publish` con su fila; precio a mano (`PATCH listPriceCents`) ⇒ `manual_price` con el precio nuevo', async () => {
      const N = await item({ status: 'in_stock', firstListedAt: null });
      const before = await count('publish');
      const pub = await h.api('POST', '/admin/inventory/items/bulk-publish', { token: admin, json: { items: [{ inventoryItemId: N.id }] } });
      expect(pub.status).toBe(200);
      await lp.idle();
      expect(await count('publish')).toBeGreaterThan(before);
      expect(await row(N.id)).toMatchObject({ status: 'priced', unitPriceCents: await live(N.id) });
      const m0 = await count('manual_price');
      const patch = await h.api('PATCH', `/admin/inventory/items/${N.id}`, { token: admin, json: { listPriceCents: 123_400 } });
      expect(patch.status).toBe(200);
      await lp.idle();
      expect(await count('manual_price')).toBe(m0 + 1);
      expect(await row(N.id)).toMatchObject({ status: 'priced', listPriceCents: 123_400, priceBasis: 'override', unitPriceCents: await live(N.id) });
    });
  });

  describe('F. salud y cabeceras', () => {
    it('`dataHealth.listingPrices` (§DYN.5.8) llega al operador con su forma', async () => {
      const r = await h.api<{ dataHealth: { listingPrices?: { status: string; lastDailyBusinessDate: string | null } } }>(
        'GET', '/admin/dashboard', { token: operator },
      );
      expect(r.status).toBe(200);
      expect(Object.keys(r.body.dataHealth.listingPrices ?? {}).sort()).toEqual(['lastDailyBusinessDate', 'status']);
      expect(['ok', 'stale', 'never']).toContain(r.body.dataHealth.listingPrices!.status);
    });

    // §DYN.6.5 (preflight 600 s) se mide en `test/cors.spec.ts` con `buildCorsOptions` sobre una app real: este arnés no
    // monta CORS (lo hace `main.ts`).
    it('§DYN.6.1: `cards`, `facets`, `sealed` y `featured` públicas cacheables 30 s', async () => {
      for (const path of ['/catalog/cards?pageSize=1', '/catalog/facets', '/catalog/sealed?pageSize=1', '/catalog/featured']) {
        const r = await h.api('GET', path);
        expect({ path, status: r.status, cc: r.headers['cache-control'] }).toEqual({
          path,
          status: 200,
          cc: 'public, max-age=30, stale-while-revalidate=30',
        });
      }
    });
  });
});

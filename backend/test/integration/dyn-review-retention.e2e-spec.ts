/**
 * dyn-review-retention.e2e-spec.ts — 💰 DYN-B23…B26 (API_CONTRACT §DYN.5.9, v1.114; ARCHITECTURE §4.DYN (e), §4.PRE (d)) contra
 * Postgres REAL y la app por HTTP: **el candado retiene la venta.** Con un `PriceReviewCase` vigente (`open` o `kept`) de la
 * variante, el cuerpo de venta usa el último sano (`baselineMxnCents`) y no la mediana con el pico; sin base, el mínimo fresco
 * admitido (v1.114.3; ninguno ⇒ `pending`). Siguen ganando el precio por pieza, el override tier 0 y M-30.
 *
 *  DYN-B23: base 184¢ con fila; barrido con una fuente a 10221¢ ⇒ caso `open` + `review_open`; fila, ficha, quote y sesión con
 *           `P` de 184¢ y referencia 184¢; con override tier 0 ⇒ el override.
 *  DYN-B24: `keep` ⇒ `kept`; barrido 2 con el mismo pico ⇒ sin caso nuevo, base 184¢, fila igual tras el cálculo diario, compra
 *           `pending`; candidato dentro de ×5 ⇒ `superseded` y el cálculo siguiente da el robusto.
 *  DYN-B25 (v1.114.3): caso vigente (`open` o `kept`) con `baselineMxnCents` null ⇒ la venta usa el MÍNIMO de las cotizaciones
 *           frescas admitidas (`admittedFreshQuotes`); ninguna fresca ⇒ fila `pending`; la compra sigue `pending`.
 *  DYN-B26: fila sembrada con el pico + el candado abre caso ⇒ `review_open` reescribe solo esa variante; un `daily` que empezó
 *           antes no la pisa.
 *
 * El «barrido» es el paso del candado del barrido real (`PriceIngestService.runPriceCandado`: árbitro + `decideLock` +
 * `recordArbiterDecision`), sobre filas de `PriceReference` escritas a mano (MXN, sin USD: sin FX en juego).
 * Deterministas (N=1 por construcción): las corridas se esperan con `idle()`/`run()` y el solape de B26 lo fija un cerrojo.
 */
import { randomUUID } from 'crypto';
import { Finish, Prisma } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { seedE2E } from '../../prisma/seed-e2e';
import { ListingPriceService } from '../../src/modules/pricing/listing-price.service';
import { SaleDecisionService, SaleItem, isPricePending } from '../../src/modules/pricing/sale-decision.service';
import { PriceIngestService } from '../../src/modules/pricing/price-ingest.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SEALED_SALE_PRICE_INCLUDE } from '../../src/common/money';

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

const SANO = 184;
const PICO = 10_221;

type Ref = { status: string; referenceMxnCents?: number; capturedDate?: string };

describe('E2E — §DYN.5.9: el candado retiene la venta (DYN-B23…B26)', () => {
  let h: E2EHarness;
  let admin: string;
  let customer: string;
  let lp: ListingPriceService;
  let decider: SaleDecisionService;
  let ingest: PriceIngestService;
  const run = randomUUID().slice(0, 8);
  let setId: string;
  const cardIds: string[] = [];
  let seq = 0;
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const today = () => new Date(`${ymd(new Date())}T00:00:00.000Z`);
  const daysAgo = (n: number) => new Date(today().getTime() - n * 86_400_000);

  async function card(n: number) {
    const c = await h.prisma.card.create({
      data: {
        externalId: `rr-${run}-${n}`,
        setId,
        name: `Carta Retencion ${run} ${n}`,
        number: String(n),
        rarity: 'Common',
        rarityCanonical: 'Common',
        imageSmallUrl: `https://images.pokemontcg.io/rr/${n}.png`,
        availableFinishes: ['normal', 'holofoil', 'reverse_holo'],
      },
    });
    cardIds.push(c.id);
    return c.id;
  }
  async function item(cardId: string, finish: Finish = 'normal', data: Partial<Prisma.InventoryItemUncheckedCreateInput> = {}) {
    seq += 1;
    return (
      await h.prisma.inventoryItem.create({
        data: {
          folio: `RR-${run}-${seq}`,
          cardId,
          productType: 'raw',
          rawCondition: 'NM',
          finish,
          ownerType: 'platform',
          status: 'listed',
          acquisitionType: 'compra',
          acquisitionCostCents: 1000,
          firstListedAt: new Date(),
          ...data,
        },
      })
    ).id;
  }
  /** Una cotización de la fuente del barrido (`tcgcsv_singles`), en MXN (sin FX). */
  async function quoteRow(cardId: string, finish: Finish, cents: number, day: Date) {
    const where = { cardId, productType: 'raw' as const, gradeKey: 'raw:NM', finish, source: 'tcgcsv_singles' as const, capturedDate: day, cardProductId: null };
    const n = await h.prisma.priceReference.updateMany({ where, data: { priceMxnCents: cents } });
    if (n.count === 0) {
      await h.prisma.priceReference.create({
        data: { cardId, productType: 'raw', gradeKey: 'raw:NM', finish, source: 'tcgcsv_singles', priceMxnCents: cents, capturedDate: day, refKind: 'market' },
      });
    }
  }
  const keyOf = (cardId: string, finish: Finish) => ({ cardId, productType: 'raw' as const, gradeKey: 'raw:NM', finish });
  /** El paso del candado del barrido real, sobre esa variante. */
  const sweep = (cardId: string, finish: Finish) =>
    (ingest as unknown as { runPriceCandado(k: ReturnType<typeof keyOf>[]): Promise<void> }).runPriceCandado([keyOf(cardId, finish)]);
  const cases = (cardId: string, finish: Finish) =>
    h.prisma.priceReviewCase.findMany({ where: { cardId, finish }, orderBy: { createdAt: 'asc' } });
  const row = (id: string) => h.prisma.listingPrice.findUnique({ where: { inventoryItemId: id } });
  /** Corridas `review_open` (texto: la prueba también corre sobre el árbol de antes, cuyo enum no la tiene). */
  const runsOf = (trigger: string) =>
    h.prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "ListingPriceRun" WHERE trigger::text = ${trigger}`;
  async function live(id: string): Promise<number | 'pending'> {
    const it = (await h.prisma.inventoryItem.findUniqueOrThrow({
      where: { id },
      include: { card: { include: { set: true } }, ...SEALED_SALE_PRICE_INCLUDE },
    })) as SaleItem;
    try {
      return (await decider.decide(it, await h.app.get(SettingsService).getIvaDials())).unitPriceCents;
    } catch (e) {
      if (isPricePending(e)) return 'pending';
      throw e;
    }
  }
  /** El `P` que daría una referencia dada (misma pieza, mismos diales): un cálculo en una variante limpia de control. */
  async function priceAt(cents: number): Promise<number> {
    const k = await card(900 + seq);
    await quoteRow(k, 'normal', cents, today());
    const id = await item(k);
    const p = await live(id);
    await h.prisma.inventoryItem.delete({ where: { id } });
    if (p === 'pending') throw new Error('control sin precio');
    return p;
  }
  const quote = (ids: string[]) =>
    h.api<{ items: { inventoryItemId: string; unitPriceCents: number }[]; error?: { code: string } }>('POST', '/checkout/quote', {
      token: customer,
      json: { inventoryItemIds: ids },
    });
  const buyQuote = (cardId: string, finish: Finish) =>
    h.api<{ referencePrice: { status: string }; quote: { status: string } }>('POST', '/buylist/quote', {
      json: { cardId, productType: 'raw', rawCondition: 'NM', finish },
    });

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    customer = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    lp = h.app.get(ListingPriceService);
    decider = h.app.get(SaleDecisionService);
    ingest = h.app.get(PriceIngestService);
    const set = await h.prisma.cardSet.create({ data: { externalId: `rr-${run}`, name: `Set Retencion ${run}` } });
    setId = set.id;
  });

  afterAll(async () => {
    if (h) {
      await lp?.idle();
      const items = await h.prisma.inventoryItem.findMany({ where: { folio: { startsWith: `RR-${run}-` } }, select: { id: true } });
      const ids = items.map((i) => i.id);
      const orderIds = (await h.prisma.orderItem.findMany({ where: { inventoryItemId: { in: ids } }, select: { orderId: true } })).map((o) => o.orderId);
      await h.prisma.inventoryItem.updateMany({ where: { id: { in: ids } }, data: { reservedByOrderId: null } });
      await h.prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
      await h.prisma.order.deleteMany({ where: { id: { in: orderIds } } }).catch(() => undefined);
      await h.prisma.inventoryMovement.deleteMany({ where: { itemId: { in: ids } } });
      await h.prisma.inventoryItem.deleteMany({ where: { id: { in: ids } } }).catch(() => undefined);
      await h.prisma.priceReviewCase.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.priceReference.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.pendingPriceEntry.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.variantPriceOverride.deleteMany({ where: { cardId: { in: cardIds } } }).catch(() => undefined);
      await h.prisma.card.deleteMany({ where: { id: { in: cardIds } } }).catch(() => undefined);
      await h.prisma.cardSet.deleteMany({ where: { id: setId } }).catch(() => undefined);
      await h.close();
    }
  });

  describe('DYN-B23 — caso `open` por un pico de una fuente', () => {
    let k: string;
    let A: string;
    let B: string;
    let P_SANO: number;
    let P_PICO: number;
    let reviewRunsBefore: number;

    beforeAll(async () => {
      k = await card(1);
      // Ayer: el sano. Las piezas tienen fila con él.
      await quoteRow(k, 'normal', SANO, daysAgo(1));
      A = await item(k);
      B = await item(k);
      await lp.run('manual_price', [A, B]);
      P_SANO = (await row(A))!.unitPriceCents!;
      expect(await row(A)).toMatchObject({ status: 'priced', referenceMxnCents: SANO });
      P_PICO = await priceAt(PICO);
      expect(P_PICO).not.toBe(P_SANO); // sin esto la prueba no distingue sano de pico
      reviewRunsBefore = (await runsOf('review_open')).length;
      // Barrido: hoy la misma fuente dice 10221 (×55) ⇒ el candado detiene y abre caso.
      await quoteRow(k, 'normal', PICO, today());
      await sweep(k, 'normal');
      await lp.idle();
    });

    it('el barrido abre el caso `open` con base 184 y propuesto 10221', async () => {
      const cs = await cases(k, 'normal');
      expect(cs).toHaveLength(1);
      expect(cs[0]).toMatchObject({ status: 'open', baselineMxnCents: SANO, proposedMxnCents: PICO });
    });

    it('💰 un cálculo con el caso vigente da P y referencia del sano (184), no del pico', async () => {
      // El defecto D-DYN-5: la mediana con el pico entraba al cuerpo y la fila lo publicaba hasta el día siguiente.
      await lp.run('manual_price', [A, B]);
      const caseDay = ymd((await cases(k, 'normal'))[0].createdAt);
      expect(await row(A)).toMatchObject({ status: 'priced', unitPriceCents: P_SANO, referenceMxnCents: SANO });
      expect(ymd((await row(A))!.referenceCapturedDate!)).toBe(caseDay);
      expect(await live(A)).toBe(P_SANO);
    });

    it('el barrido encoló `review_open` y esa corrida reescribió las piezas de la variante', async () => {
      const runs = await runsOf('review_open');
      expect(runs.length).toBe(reviewRunsBefore + 1);
    });

    it('💰 ficha, quote y sesión (cuenta e invitado) cobran y exhiben el sano', async () => {
      const ficha = await h.api<{ listings: { displayPriceCents: number; referenceValue: Ref }[] }>('GET', `/catalog/cards/${k}`);
      expect(ficha.status).toBe(200);
      expect(ficha.body.listings.map((l) => l.displayPriceCents)).toEqual([P_SANO]);
      // La ficha proyecta la referencia de la fila (184) con el `iff priceBasis === 'market'` de D2: con `P` en el piso de la
      // curva el monto no viaja, pero jamás el del pico.
      expect(ficha.body.listings[0].referenceValue.status).toBe('priced');
      expect([undefined, SANO]).toContain(ficha.body.listings[0].referenceValue.referenceMxnCents);
      const q = await quote([A]);
      expect(q.status).toBe(200);
      expect(q.body.items[0].unitPriceCents).toBe(P_SANO);
      const s = await h.api<{ orderId: string; breakdown: { subtotalCents: number } }>('POST', '/checkout/session', {
        token: customer,
        json: { inventoryItemIds: [A] },
        headers: { 'idempotency-key': `rr-${run}-a` },
      });
      expect(s.status).toBe(201);
      expect(s.body.breakdown.subtotalCents).toBe(P_SANO);
      const gs = await h.api<{ breakdown: { subtotalCents: number } }>('POST', '/checkout/guest/session', {
        json: { inventoryItemIds: [B], email: `rr.${run}@example.com`, shippingAddress: ADDRESS, acceptedTerms: true, locale: 'es' },
      });
      expect(gs.status).toBe(201);
      expect(gs.body.breakdown.subtotalCents).toBe(P_SANO);
    });

    it('💰 sin fila (cálculo en vivo) también retiene: quote de una pieza nueva da el sano', async () => {
      const C = await item(k);
      expect(await row(C)).toBeNull();
      const q = await quote([C]);
      expect(q.status).toBe(200);
      expect(q.body.items[0].unitPriceCents).toBe(P_SANO);
    });

    it('con override tier 0 (`POST /admin/pricing/override`) gana el override, aunque el caso siga vigente', async () => {
      const D = await item(k);
      await lp.run('manual_price', [D]);
      const res = await h.api('POST', '/admin/pricing/override', {
        token: admin,
        json: { cardId: k, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', priceMxnCents: 50_000 },
      });
      expect(res.status).toBe(200);
      await lp.idle();
      expect((await cases(k, 'normal'))[0].status).toBe('open');
      const P_OVR = await live(D);
      expect(P_OVR).not.toBe(P_SANO);
      expect(await row(D)).toMatchObject({ status: 'priced', unitPriceCents: P_OVR, referenceMxnCents: 50_000 });
    });
  });

  describe('DYN-B24 — `keep` sigue reteniendo; el mercado asentado lo cierra', () => {
    let k: string;
    let A: string;
    let P_SANO: number;

    beforeAll(async () => {
      k = await card(2);
      await quoteRow(k, 'normal', SANO, daysAgo(1));
      A = await item(k);
      await lp.run('manual_price', [A]);
      P_SANO = (await row(A))!.unitPriceCents!;
      await quoteRow(k, 'normal', PICO, today());
      await sweep(k, 'normal');
      await lp.idle();
    });

    it('`keep` ⇒ `kept`, y la compra sigue en `pending`', async () => {
      const [c] = await cases(k, 'normal');
      const res = await h.api<{ status: string }>('POST', `/admin/pricing/review-queue/${c.id}/resolve`, { token: admin, json: { action: 'keep' } });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('kept');
      const bq = await buyQuote(k, 'normal');
      expect(bq.status).toBe(200);
      expect(bq.body.referencePrice.status).toBe('pending');
    });

    it('💰 barrido 2 con el mismo pico (ayer ya lo trae): sin caso nuevo, base 184 congelada, fila igual tras el cálculo diario', async () => {
      // Día 2: la cotización de «ayer» ya es el pico; sin la base congelada, base ≈ pico ⇒ publicaría el pico.
      await quoteRow(k, 'normal', PICO, daysAgo(1));
      const detail = await h.app.get(PricingService).arbiterDetailForKeys([keyOf(k, 'normal')]);
      expect(detail.get(`${k}|raw|raw:NM|normal`)!.baselineMxnCents).toBe(SANO);
      await sweep(k, 'normal');
      const cs = await cases(k, 'normal');
      expect(cs.map((c) => c.status)).toEqual(['kept']);
      await lp.run('daily', [A]);
      expect(await row(A)).toMatchObject({ status: 'priced', unitPriceCents: P_SANO, referenceMxnCents: SANO });
      expect((await buyQuote(k, 'normal')).body.referencePrice.status).toBe('pending');
    });

    it('candidato dentro de ×5 ⇒ `superseded`, y el cálculo siguiente da el robusto', async () => {
      await quoteRow(k, 'normal', 300, today());
      await quoteRow(k, 'normal', 300, daysAgo(1));
      await sweep(k, 'normal');
      expect((await cases(k, 'normal')).map((c) => c.status)).toEqual(['superseded']);
      await lp.run('manual_ingest', [A]);
      expect(await row(A)).toMatchObject({ status: 'priced', referenceMxnCents: 300 });
      expect((await row(A))!.unitPriceCents).toBe(await live(A));
      expect((await buyQuote(k, 'normal')).body.referencePrice.status).not.toBe('pending');
    });

    it('otro pico distinto sobre un `kept` ⇒ el vigente pasa a `superseded` y nace un `open` con la misma base', async () => {
      const k2 = await card(3);
      await quoteRow(k2, 'normal', SANO, daysAgo(1));
      await quoteRow(k2, 'normal', PICO, today());
      await sweep(k2, 'normal');
      const [c] = await cases(k2, 'normal');
      await h.api('POST', `/admin/pricing/review-queue/${c.id}/resolve`, { token: admin, json: { action: 'keep' } });
      await quoteRow(k2, 'normal', 20_000, today());
      await sweep(k2, 'normal');
      const cs = await cases(k2, 'normal');
      expect(cs.map((x) => [x.status, x.baselineMxnCents, x.proposedMxnCents])).toEqual([
        ['superseded', SANO, PICO],
        ['open', SANO, 20_000],
      ]);
      await lp.idle();
    });
  });

  describe('DYN-B25 — caso vigente sin base ⇒ la venta usa el mínimo fresco (v1.114.3)', () => {
    // Contrato §DYN.5.9 «Sin base» (dueño, HECHOS 2026-10-30 «Casos de revisión de precio SIN base: opción A…»). Cada número del
    // fixture es la huella de una mutación: 300 = el mínimo fresco admitido (lo correcto); 400 = la mediana/promedio de las dos
    // frescas; 100 = la `cardmarket` vieja; 50 = la `pokemontcg_io` excluida; `pending` = la regla v1.114 que se sustituye.
    const MIN = 300;
    const OTRA = 500;
    const VIEJA = 100;
    const EXCLUIDA = 50;
    let k: string;
    let X: string;
    let A: string;
    let B: string;
    let Z: string;
    let P_MIN: number;
    let fresh: number;
    let caseId: string;
    const tcgcsvDay = () => daysAgo(2); // ≠ día del caso: la fila exhibe la fecha DE ESA cotización

    async function refRow(cardId: string, finish: Finish, source: 'tcgcsv_singles' | 'tcgdex' | 'cardmarket' | 'pokemontcg_io', cents: number, day: Date) {
      await h.prisma.priceReference.create({
        data: { cardId, productType: 'raw', gradeKey: 'raw:NM', finish, source, priceMxnCents: cents, capturedDate: day, refKind: 'market' },
      });
    }

    beforeAll(async () => {
      fresh = (await h.app.get(PricingService).loadArbiterDialsSafe()).freshnessDays;
      k = await card(4);
      await refRow(k, 'holofoil', 'tcgcsv_singles', MIN, tcgcsvDay());
      await refRow(k, 'holofoil', 'tcgdex', OTRA, today());
      await refRow(k, 'holofoil', 'cardmarket', VIEJA, daysAgo(fresh + 3));
      await refRow(k, 'holofoil', 'pokemontcg_io', EXCLUIDA, today());
      // Caso vigente SIN base, tal como lo abre el candado del barrido para una variante sin valor sano (fuente única).
      caseId = (
        await h.prisma.priceReviewCase.create({
          data: {
            cardId: k,
            productType: 'raw',
            gradeKey: 'raw:NM',
            finish: 'holofoil',
            axis: 'sell',
            proposedMxnCents: 400,
            baselineMxnCents: null,
            jumpFactorMilli: 0,
            sourceCount: 2,
            familyCount: 1,
            consensus: false,
            quotesSnapshot: [],
            status: 'open',
          },
        })
      ).id;
      X = await item(k, 'holofoil');
      A = await item(k, 'holofoil');
      B = await item(k, 'holofoil');
      Z = await item(k, 'holofoil');
      P_MIN = await priceAt(MIN);
    });

    it('💰 `open`: fila `priced` con referencia 300 (no 400, 100, 50 ni `pending`) y el `capturedDate` de la de tcgcsv', async () => {
      await lp.run('manual_price', [X, A, B, Z]);
      const fila = (await row(X))!;
      expect({ status: fila.status, ref: fila.referenceMxnCents }).toEqual({ status: 'priced', ref: MIN });
      expect(fila.unitPriceCents).toBe(P_MIN);
      expect(ymd(fila.referenceCapturedDate!)).toBe(ymd(tcgcsvDay()));
      expect(await live(X)).toBe(P_MIN);
      // La retención la da el caso, no una casualidad del fixture: sin caso, la referencia viva NO es 300.
      const sinCaso = await h.app.get(PricingService).getReference(k, 'raw', 'raw:NM', 'holofoil');
      expect(sinCaso.referenceMxnCents).not.toBe(MIN);
    });

    it('💰 ficha, quote y sesión (cuenta e invitado) exhiben y cobran el `P` de 300', async () => {
      const ficha = await h.api<{ listings: { displayPriceCents: number; finish: string; referenceValue: Ref }[] }>('GET', `/catalog/cards/${k}`);
      expect(ficha.status).toBe(200);
      const holo = ficha.body.listings.filter((l) => l.finish === 'holofoil');
      expect(holo.length).toBeGreaterThan(0);
      for (const l of holo) {
        expect(l.displayPriceCents).toBe(P_MIN);
        expect(l.referenceValue.status).toBe('priced');
        expect([undefined, MIN]).toContain(l.referenceValue.referenceMxnCents);
      }
      const q = await quote([X]);
      expect(q.status).toBe(200);
      expect(q.body.items[0].unitPriceCents).toBe(P_MIN);
      const s = await h.api<{ breakdown: { subtotalCents: number } }>('POST', '/checkout/session', {
        token: customer,
        json: { inventoryItemIds: [A] },
        headers: { 'idempotency-key': `rr-${run}-b25` },
      });
      expect(s.status).toBe(201);
      expect(s.body.breakdown.subtotalCents).toBe(P_MIN);
      const gs = await h.api<{ breakdown: { subtotalCents: number } }>('POST', '/checkout/guest/session', {
        json: { inventoryItemIds: [B], email: `rr25.${run}@example.com`, shippingAddress: ADDRESS, acceptedTerms: true, locale: 'es' },
      });
      expect(gs.status).toBe(201);
      expect(gs.body.breakdown.subtotalCents).toBe(P_MIN);
    });

    it('💰 la compra sigue en `pending` (no usa el mínimo de venta)', async () => {
      const bq = await buyQuote(k, 'holofoil');
      expect(bq.status).toBe(200);
      expect(bq.body.referencePrice.status).toBe('pending');
    });

    it('💰 `kept` sin base se trata igual que `open`: misma fila de 300 y compra `pending`', async () => {
      await h.prisma.priceReviewCase.update({ where: { id: caseId }, data: { status: 'kept' } });
      await lp.run('manual_price', [X, Z]);
      const fila = (await row(Z))!;
      expect({ status: fila.status, ref: fila.referenceMxnCents, p: fila.unitPriceCents }).toEqual({ status: 'priced', ref: MIN, p: P_MIN });
      expect(ymd(fila.referenceCapturedDate!)).toBe(ymd(tcgcsvDay()));
      expect(await live(Z)).toBe(P_MIN);
      expect((await quote([Z])).body.items[0].unitPriceCents).toBe(P_MIN);
      expect((await buyQuote(k, 'holofoil')).body.referencePrice.status).toBe('pending');
    });

    it('💰 con las dos frescas envejecidas (ninguna fresca) ⇒ fila `pending` y `PRICE_PENDING`', async () => {
      await h.prisma.priceReference.updateMany({
        where: { cardId: k, finish: 'holofoil', source: { in: ['tcgcsv_singles', 'tcgdex'] } },
        data: { capturedDate: daysAgo(fresh + 2) },
      });
      await lp.run('manual_price', [X, Z]);
      expect(await row(Z)).toMatchObject({ status: 'pending', unitPriceCents: null, referenceMxnCents: null });
      expect(await live(Z)).toBe('pending');
      expect((await h.api('GET', `/catalog/listings/${Z}`)).status).toBe(404);
      const q = await quote([Z]);
      expect(q.status).toBe(422);
      expect(q.body.error!.code).toBe('PRICE_PENDING');
    });

    it('el barrido sigue abriendo el caso sin base (base `null`) y la fila va a su única cotización fresca', async () => {
      const k2 = await card(7);
      await quoteRow(k2, 'holofoil', 5_000, today());
      const V = await item(k2, 'holofoil');
      await lp.run('manual_price', [V]);
      await sweep(k2, 'holofoil');
      const cs = await cases(k2, 'holofoil');
      expect(cs).toHaveLength(1);
      expect(cs[0]).toMatchObject({ status: 'open', baselineMxnCents: null });
      await lp.idle();
      await lp.run('manual_price', [V]);
      expect(await row(V)).toMatchObject({ status: 'priced', referenceMxnCents: 5_000 });
      expect((await buyQuote(k2, 'holofoil')).body.referencePrice.status).toBe('pending');
    });
  });

  describe('DYN-B26 — `review_open` cierra la ventana entre el pico escrito y el caso', () => {
    it('💰 fila sembrada con el pico + el candado abre caso ⇒ `review_open` reescribe solo esa variante; un `daily` anterior no la pisa', async () => {
      const k = await card(5);
      // Dos variantes con fila: la del pico (`reverse_holo`) y otra (`normal`) que no tiene nada que ver.
      await quoteRow(k, 'reverse_holo', SANO, daysAgo(1));
      await quoteRow(k, 'normal', 7_000, today());
      const V = await item(k, 'reverse_holo');
      const W = await item(k, 'normal');
      await lp.run('manual_price', [V, W]);
      const P_SANO = (await row(V))!.unitPriceCents!;
      // El barrido escribe el pico ANTES de abrir el caso; un cálculo intermedio lo lee y lo deja en la fila.
      await quoteRow(k, 'reverse_holo', PICO, today());
      await lp.run('manual_price', [V]);
      expect(await row(V)).toMatchObject({ referenceMxnCents: PICO });
      const wRun = (await row(W))!.runId;

      // Un `daily` de OTRA instancia empieza ahora (lee el pico) y se detiene antes de escribir.
      const deciderA = new SaleDecisionService(h.app.get(PricingService));
      let reached!: () => void;
      const atGate = new Promise<void>((r) => (reached = r));
      let open!: () => void;
      const gate = new Promise<void>((r) => (open = r));
      const realLoad = deciderA.loadBatch.bind(deciderA);
      jest.spyOn(deciderA, 'loadBatch').mockImplementation(async (items) => {
        const b = await realLoad(items);
        reached();
        await gate;
        return b;
      });
      const lpA = new ListingPriceService(h.app.get(PrismaService), deciderA, h.app.get(SettingsService));
      const dailyA = lpA.run('daily', [V]);
      await atGate;
      await new Promise((r) => setTimeout(r, 5));

      // El candado abre el caso ⇒ `review_open` (de esta instancia) reescribe la pieza del pico con el sano.
      await sweep(k, 'reverse_holo');
      expect((await cases(k, 'reverse_holo')).map((c) => c.status)).toEqual(['open']);
      await lp.idle();
      const fila = (await row(V))!;
      expect(fila).toMatchObject({ status: 'priced', unitPriceCents: P_SANO, referenceMxnCents: SANO });
      const rr = await h.prisma.listingPriceRun.findUniqueOrThrow({ where: { id: fila.runId } });
      expect(rr.trigger).toBe('review_open');
      // Solo esa variante: la otra pieza de la carta conserva su fila.
      expect((await row(W))!.runId).toBe(wRun);

      // El `daily` que empezó antes termina con su foto del pico: ⛔ no pisa.
      open();
      expect((await dailyA).status).toBe('ok');
      expect(await row(V)).toMatchObject({ runId: fila.runId, unitPriceCents: P_SANO, referenceMxnCents: SANO });
    });

    it('`review_open` solo toca piezas CON fila de la variante (una sin fila la recoge `missing_row`)', async () => {
      const k = await card(6);
      await quoteRow(k, 'normal', SANO, daysAgo(1));
      const V = await item(k);
      const N = await item(k);
      await lp.run('manual_price', [V]);
      await quoteRow(k, 'normal', PICO, today());
      const before = (await row(V))!.runId;
      await sweep(k, 'normal');
      await lp.idle();
      const fila = (await row(V))!;
      expect(fila.runId).not.toBe(before);
      expect((await h.prisma.listingPriceRun.findUniqueOrThrow({ where: { id: fila.runId } })).trigger).toBe('review_open');
      expect(fila.referenceMxnCents).toBe(SANO);
      expect(await row(N)).toBeNull();
    });
  });
});

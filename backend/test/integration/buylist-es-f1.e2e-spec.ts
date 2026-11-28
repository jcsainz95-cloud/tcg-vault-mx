import { Prisma } from '@prisma/client';
/**
 * §BUYLIST-ES F1 — POR HTTP, CONTRA POSTGRES REAL. quote / batch / requests con idioma, dial apagado = hoy, anti-inflado,
 * `quote-policy`, migración (siembra idempotente, 100 % `language='en'`) y `convertToInventory` con idioma / `received*`.
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_CARDS, E2E_USERS } from '../../prisma/e2e-fixtures';
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';

const CLABE = '012345678901234567';
const CAP_KEY = 'buylist_cap_per_month_cents';
const KEYS = ['buylist_spanish_enabled', 'buylist_spanish_penalty_pct', 'buylist_league_enabled'] as const;

describe('E2E — §BUYLIST-ES F1 (idioma en la compra)', () => {
  let h: E2EHarness;
  let customer: string;
  let operator: string;
  let cardId: string;
  let addressId: string;
  let spy: jest.SpyInstance;
  const prev: Record<string, unknown> = {};
  /** Piezas que `convertToInventory` crea (misma carta que el seed): se retiran al terminar, o otra suite (C2 de guest-checkout) las ve como copia equivalente libre. */
  const converted: string[] = [];

  const setDial = (key: string, value: unknown) =>
    h.prisma.configSetting.upsert({ where: { key }, update: { valueJson: value as never }, create: { key, valueJson: value as never } });
  const base = { productType: 'raw', rawCondition: 'NM' };
  const quote = (extra: Record<string, unknown> = {}) => h.api('POST', '/buylist/quote', { json: { cardId, ...base, ...extra } });
  const request = (items: Record<string, unknown>[]) =>
    h.api('POST', '/buylist/requests', { token: customer, json: { items: items.map((i) => ({ cardId, ...base, ...i })), clabe: CLABE, addressId } });

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    customer = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    operator = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    cardId = (await h.prisma.card.findUniqueOrThrow({ where: { externalId: E2E_CARDS.charizard.externalId } })).id;
    const u = await h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.customer.email } });
    addressId = (await h.prisma.address.findFirstOrThrow({ where: { userId: u.id }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] })).id;
    for (const k of [...KEYS, CAP_KEY]) prev[k] = (await h.prisma.configSetting.findUnique({ where: { key: k } }))?.valueJson;
    await setDial(CAP_KEY, 1_000_000_000);
    spy = jest.spyOn(h.app.get<MailPort>(MAIL_PORT), 'send').mockImplementation(async (_m: MailMessage) => ({ id: 'e2e' }));
  });

  afterAll(async () => {
    spy?.mockRestore();
    if (h) {
      if (converted.length) await h.prisma.inventoryItem.updateMany({ where: { id: { in: converted } }, data: { status: 'withdrawn' } });
      for (const k of [...KEYS, CAP_KEY]) {
        if (prev[k] === undefined) await h.prisma.configSetting.deleteMany({ where: { key: k } });
        else await setDial(k, prev[k]);
      }
      await h.close();
    }
  });

  it('migración: los tres diales sembrados (15 / false / false) y toda línea previa en `en`', async () => {
    // La fila puede haber sido pisada por otra suite: se valida el sembrado por el valor ORIGINAL guardado en `prev` o el default.
    expect(prev['buylist_spanish_penalty_pct'] ?? 15).toBe(15);
    expect(prev['buylist_spanish_enabled'] ?? false).toBe(false);
    expect(prev['buylist_league_enabled'] ?? false).toBe(false);
    expect(await h.prisma.sellRequestItem.count({ where: { NOT: { language: 'en' } } })).toBe(0);
  });

  describe('dial APAGADO = comportamiento de hoy', () => {
    beforeAll(async () => {
      await setDial('buylist_spanish_enabled', false);
    });
    it('/quote sin language: MX$500 (charizard MX$1,000), español inexistente; policy lo dice', async () => {
      const r = await quote();
      expect(r.status).toBe(200);
      expect(r.body.quote.quotedPriceCents).toBe(50000);
      expect(r.body).toMatchObject({ language: 'en', offers: { en: 50000, es: null }, spanishEligible: false, stampOptions: [] });
      const p = await h.api('GET', '/buylist/quote-policy', {});
      expect(p.body).toMatchObject({ spanishEnabled: false, leagueEnabled: false, spanishPenaltyPct: 15 });
    });
    it('español ⇒ 400 LANGUAGE_NOT_AVAILABLE en quote y requests (no se crea nada); en batch es error por-ítem', async () => {
      const q = await quote({ language: 'es' });
      expect({ s: q.status, c: q.body.error?.code }).toEqual({ s: 400, c: 'LANGUAGE_NOT_AVAILABLE' });
      const antes = await h.prisma.sellRequest.count();
      const r = await request([{ language: 'es' }]);
      expect({ s: r.status, c: r.body.error?.code }).toEqual({ s: 400, c: 'LANGUAGE_NOT_AVAILABLE' });
      expect(await h.prisma.sellRequest.count()).toBe(antes);
      const b = await h.api('POST', '/buylist/quote/batch', { json: { items: [{ cardId, ...base, language: 'es' }, { cardId, ...base }] } });
      expect(b.status).toBe(200);
      expect(b.body.results[0].error.code).toBe('LANGUAGE_NOT_AVAILABLE');
      expect(b.body.results[1].quote.quotedPriceCents).toBe(50000);
    });
    it('un `language` fuera de en|es ⇒ 400 de validación', async () => {
      expect((await quote({ language: 'fr' })).status).toBe(400);
    });
  });

  describe('dial ENCENDIDO', () => {
    beforeAll(async () => {
      await setDial('buylist_spanish_enabled', true);
      await setDial('buylist_spanish_penalty_pct', 15);
    });
    it('MX$1,000 → MX$850 → MX$425 con desglose; /quote == /batch == /requests; EN y ES son 2 líneas', async () => {
      const q = await quote({ language: 'es' });
      expect(q.status).toBe(200);
      expect(q.body.quote.quotedPriceCents).toBe(42500);
      expect(q.body.offers).toEqual({ en: 50000, es: 42500 });
      expect(q.body.breakdown).toEqual({
        marketMxnCents: 100000,
        languagePenalty: { pct: 15, cents: -15000 },
        adjustedMarketCents: 85000,
        curveBp: 5000,
        curveOfferCents: 42500,
        cap: null,
        source: 'curve',
        finalOfferCents: 42500,
      });
      const b = await h.api('POST', '/buylist/quote/batch', { json: { items: [{ cardId, ...base, language: 'es' }] } });
      expect(b.body.results[0].quote.quotedPriceCents).toBe(42500);
      const r = await request([{}, { language: 'es' }]);
      expect(r.status).toBe(201);
      const rows = await h.prisma.sellRequestItem.findMany({ where: { sellRequestId: r.body.sellRequestId }, orderBy: { language: 'asc' } });
      expect(rows.map((x) => [x.language, x.quotedPriceCents])).toEqual([['en', 50000], ['es', 42500]]);
      expect(rows[1].versionOffers).toEqual({ en: 50000, es: 42500 });
      expect((rows[1].offerBreakdown as any).languagePenalty).toEqual({ pct: 15, cents: -15000 });
      // La solicitud queda congelada: mover el castigo no la cambia ni en el GET.
      await setDial('buylist_spanish_penalty_pct', 30);
      const got = await h.api('GET', `/buylist/requests/${r.body.sellRequestId}`, { token: customer });
      const es = got.body.items.find((i: any) => i.language === 'es');
      expect(es.quotedPriceCents).toBe(42500);
      expect(es.breakdown.finalOfferCents).toBe(42500);
      expect(es).toMatchObject({ stamp: null, receivedLanguage: null, receivedStamp: null });
      const nueva = await quote({ language: 'es' });
      expect(nueva.body.quote.quotedPriceCents).toBeLessThan(42500);
      await setDial('buylist_spanish_penalty_pct', 15);
    });
    it('anti-inflado: ES ≤ EN con castigo 0 (iguales) y nunca por encima', async () => {
      await setDial('buylist_spanish_penalty_pct', 0);
      const q = await quote({ language: 'es' });
      expect(q.body.offers.es).toBe(q.body.offers.en);
      await setDial('buylist_spanish_penalty_pct', 15);
    });
    it('`stamped` sigue rechazado (F4) y graduada ES ⇒ LANGUAGE_NOT_ELIGIBLE', async () => {
      const g = await h.api('POST', '/buylist/quote', { json: { cardId, productType: 'graded', language: 'es' } });
      expect({ s: g.status, c: g.body.error?.code }).toEqual({ s: 400, c: 'LANGUAGE_NOT_ELIGIBLE' });
    });
    it('la mesa de decisión devuelve language y breakdown de la línea ES (castigo congelado)', async () => {
      const r = await request([{}, { language: 'es' }]); // el mínimo de compra (MX$500) se juzga sobre el TOTAL
      expect(r.status).toBe(201);
      const t = await h.api('GET', `/admin/buylist/${r.body.sellRequestId}/decision-table`, { token: operator });
      expect(t.status).toBe(200);
      const line = t.body.lines.find((l: any) => l.language === 'es');
      expect(line).toMatchObject({ language: 'es', stamp: null, derivedPriceCents: 42500 });
      expect(line.breakdown).toMatchObject({ adjustedMarketCents: 85000, finalOfferCents: 42500 });
      // §3.2: la columna Estándar de la línea ES es el % REAL de la curva (no 42,5 %) y la oferta, leídos de lo CONGELADO.
      expect(line).toMatchObject({ standardPctBp: 5000, standardOfferCents: 42500, languagePenaltyPct: 15 });
      // La mesa NO re-deriva: con el castigo movido (y la curva vigente) sigue mostrando lo congelado.
      await setDial('buylist_spanish_penalty_pct', 40);
      try {
        const t2 = await h.api('GET', `/admin/buylist/${r.body.sellRequestId}/decision-table`, { token: operator });
        const l2 = t2.body.lines.find((l: any) => l.language === 'es');
        expect(l2.breakdown).toEqual(line.breakdown);
        expect(l2).toMatchObject({ standardPctBp: 5000, standardOfferCents: 42500, languagePenaltyPct: 15 });
        expect(l2).toMatchObject({ standardKind: 'curve', marketDriftCents: null, adjustment: null, marketMxnCents: 100000 });
        // §3.3 B1-bis: Ofertamos = derivada VIVA; un operador que ajusta `approvedPriceCents` no mueve el chip (compara derivada vs congelado).
        await h.prisma.sellRequestItem.update({ where: { id: line.itemId }, data: { approvedPriceCents: 42680 } });
        const tUp = await h.api('GET', `/admin/buylist/${r.body.sellRequestId}/decision-table`, { token: operator });
        const lUp = tUp.body.lines.find((l: any) => l.language === 'es');
        expect(lUp.adjustment).toBeNull();
        expect(lUp).toMatchObject({ derivedPriceCents: 42500, standardOfferCents: 42500, standardPctBp: 5000, standardKind: 'curve' });
        await h.prisma.sellRequestItem.update({ where: { id: line.itemId }, data: { approvedPriceCents: null } });
        // Cotización congelada más baja que la derivada viva (la curva/mercado subió): chip «Subida» = derivada − congelado, Estándar intacto.
        const frozenBd = (await h.prisma.sellRequestItem.findUniqueOrThrow({ where: { id: line.itemId } })).offerBreakdown as any;
        await h.prisma.sellRequestItem.update({ where: { id: line.itemId }, data: { offerBreakdown: { ...frozenBd, marketMxnCents: 90000, finalOfferCents: 40000 } } });
        const tUp2 = await h.api('GET', `/admin/buylist/${r.body.sellRequestId}/decision-table`, { token: operator });
        const lUp2 = tUp2.body.lines.find((l: any) => l.language === 'es');
        expect(lUp2).toMatchObject({ derivedPriceCents: 42500, standardOfferCents: 40000, marketDriftCents: 10000 });
        expect(lUp2.adjustment).toMatchObject({ deltaCents: 2500, reasonCode: 'MARKET_UP' });
        await h.prisma.sellRequestItem.update({ where: { id: line.itemId }, data: { offerBreakdown: frozenBd } });
        // §3.3 B1: el mercado se movió desde la cotización ⇒ `marketDriftCents` (vivo − congelado) y NADA más cambia.
        await h.prisma.sellRequestItem.update({ where: { id: line.itemId }, data: { offerBreakdown: { ...frozenBd, marketMxnCents: 90000 } } });
        const tDr = await h.api('GET', `/admin/buylist/${r.body.sellRequestId}/decision-table`, { token: operator });
        const lDr = tDr.body.lines.find((l: any) => l.language === 'es');
        expect(lDr).toMatchObject({ marketMxnCents: 100000, marketTodayCents: 100000, marketDriftCents: 10000, adjustment: null, standardOfferCents: 42500 });
        // §3.3 I2: ES pendiente congelada ⇒ chip de idioma, Estándar «pending» y sin chip de subida/bajada.
        const pend = { marketMxnCents: null, languagePenalty: { pct: 15, cents: null }, adjustedMarketCents: null, curveBp: null, curveOfferCents: null, cap: null, source: 'pending', finalOfferCents: null };
        await h.prisma.sellRequestItem.update({ where: { id: line.itemId }, data: { offerBreakdown: pend } });
        const tPe = await h.api('GET', `/admin/buylist/${r.body.sellRequestId}/decision-table`, { token: operator });
        const lPe = tPe.body.lines.find((l: any) => l.language === 'es');
        expect(lPe.breakdown).toEqual(pend);
        expect(lPe).toMatchObject({ derivedPriceCents: 42500, standardKind: 'pending', standardPctBp: null, standardOfferCents: null, marketDriftCents: null, adjustment: null, languagePenaltyPct: 15 });
        // Línea ES sin `offerBreakdown` (datos previos): `breakdown:null` y nada de Estándar derivado.
        await h.prisma.sellRequestItem.update({ where: { id: line.itemId }, data: { offerBreakdown: Prisma.DbNull } });
        const t3 = await h.api('GET', `/admin/buylist/${r.body.sellRequestId}/decision-table`, { token: operator });
        const l3 = t3.body.lines.find((l: any) => l.language === 'es');
        expect(l3.breakdown).toBeNull();
        expect(l3.standardPctBp).toBeNull();
        expect(l3.standardOfferCents).toBeNull();
        // El EN no cambia de forma: Estándar de la curva, sin chip de idioma.
        const en = t3.body.lines.find((l: any) => l.language === 'en');
        expect(en.languagePenaltyPct).toBeNull();
      } finally {
        await setDial('buylist_spanish_penalty_pct', 15);
      }
    });
  });

  it('convertToInventory: EN, ES y `received*` mandan lo recibido', async () => {
    await setDial('buylist_spanish_enabled', true);
    const r = await request([{}, { language: 'es' }, { language: 'es' }]);
    const items = await h.prisma.sellRequestItem.findMany({ where: { sellRequestId: r.body.sellRequestId }, orderBy: [{ language: 'asc' }, { id: 'asc' }] });
    expect(items.map((i) => i.language)).toEqual(['en', 'es', 'es']);
    await h.prisma.sellRequest.update({ where: { id: r.body.sellRequestId }, data: { status: 'verificacion', receivedAt: new Date(), verifiedAt: new Date() } });
    // La tercera llegó en inglés (lo recibido manda).
    await h.prisma.sellRequestItem.update({ where: { id: items[2].id }, data: { receivedLanguage: 'en', receivedVersionSet: true } });
    const langs: string[] = [];
    for (const it of items) {
      await h.prisma.sellRequestItem.update({ where: { id: it.id }, data: { itemStatus: 'aprobada', approvedPriceCents: it.quotedPriceCents, offerDecision: 'buy', offeredPriceCents: it.quotedPriceCents } });
      const c = await h.api('POST', `/admin/buylist/items/${it.id}/convert-to-inventory`, { token: operator, json: {} });
      expect(c.status).toBe(200);
      converted.push(c.body.inventoryItemId);
      langs.push((await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: c.body.inventoryItemId } })).language);
    }
    expect(langs).toEqual(['en', 'es', 'en']);
  });
});

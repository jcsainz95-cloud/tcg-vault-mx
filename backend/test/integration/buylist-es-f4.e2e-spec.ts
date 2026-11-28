import { randomUUID } from 'crypto';
/**
 * §BUYLIST-ES F4 — LIGA, POR HTTP, CONTRA POSTGRES REAL (API_CONTRACT_BUYLIST_ES §3.4, §4.1 celdas de liga, §6 criterios 7, 12, 14, 15).
 * `stamped` se cotiza con el dial de liga encendido y da 400 `STAMP_NOT_AVAILABLE` apagado/ajeno/sin acabado; `stampOptions` y `versions[]` salen del catálogo;
 * ES-liga = castigo UNA vez sobre la referencia de ESA liga, ≤ EN-liga ≤ su referencia; /quote == /batch == /requests; la matriz de recepción con ligas.
 */
import { E2EHarness } from './helpers/e2e-app';
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { DEFAULT_PRICING_CURVE, resolveBuyFromCurve } from '../../src/common/pricing-curve';
import { scaleByPct } from '../../src/common/card-version';

const CLABE = '012345678901234567';
const DIALS = [
  'buylist_spanish_enabled',
  'buylist_spanish_penalty_pct',
  'buylist_league_enabled',
  'buylist_cap_per_month_cents',
  'buylist_cap_per_request_cents',
  'buylist_minimum_request_cents',
  'buylist_minimum_offer_net_cents',
  'buylist_shipping_fee_cents',
  'buylist_operator_offer_cap_cents',
  'ine_threshold_cents',
] as const;
const curveOf = (market: number) => resolveBuyFromCurve(market, DEFAULT_PRICING_CURVE).cents as number;

describe('E2E — §BUYLIST-ES F4 (cartas de liga)', () => {
  let h: E2EHarness;
  let customer: string;
  let operator: string;
  let admin: string;
  let customerUserId: string;
  let addressId: string;
  let setId: string;
  let spy: jest.SpyInstance;
  let mails: MailMessage[] = [];
  const run = randomUUID().slice(0, 8);
  const prev: Record<string, unknown> = {};
  const cardIds: string[] = [];
  const converted: string[] = [];
  let seq = 0;
  const today = () => new Date(new Date().toISOString().slice(0, 10));
  const err = (r: { body: unknown }) => (r.body as { error: { code: string; details?: Record<string, any> } }).error;
  const setDial = (key: string, value: unknown) =>
    h.prisma.configSetting.upsert({ where: { key }, update: { valueJson: value as never }, create: { key, valueJson: value as never } });
  const ref = (cardId: string, cents: number, cardProductId: string | null = null) =>
    h.prisma.priceReference.create({
      data: { cardId, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'manual', priceMxnCents: cents, capturedDate: today(), isManualOverride: true, refKind: 'market', cardProductId },
    });

  /** Carta con su mercado normal y N ligas (`market: null` = liga SIN referencia). Devuelve los productId de TCGplayer. */
  async function leagueCard(normal: number | null, leagues: { type: 'league' | 'prize_pack' | 'championship'; market: number | null; label?: string }[]) {
    const n = `${++seq}`;
    const c = await h.prisma.card.create({
      data: { externalId: `f4-${run}-${n}`, setId, name: `Carta F4 ${run} ${n}`, number: n, rarity: 'Common', rarityCanonical: 'Common', availableFinishes: ['normal'] },
    });
    cardIds.push(c.id);
    if (normal != null) await ref(c.id, normal);
    const pids: number[] = [];
    for (const [i, l] of leagues.entries()) {
      const pid = 760_000_000 + Math.floor(Math.random() * 9_000_000) + i;
      const cp = await h.prisma.cardProduct.create({
        data: { cardId: c.id, tcgplayerProductId: pid, kind: 'stamped', name: `Liga ${run} ${n}.${i}`, finishes: ['normal'], stampType: l.type, stampLabel: l.label ?? null, sourceGroupId: 1539 },
      });
      if (l.market != null) await ref(c.id, l.market, cp.id);
      pids.push(pid);
    }
    return { cardId: c.id, pids };
  }
  const quote = (json: Record<string, unknown>) => h.api<any>('POST', '/buylist/quote', { json: { productType: 'raw', rawCondition: 'NM', ...json } });
  const batch = (items: Record<string, unknown>[]) =>
    h.api<any>('POST', '/buylist/quote/batch', { json: { items: items.map((i) => ({ productType: 'raw', rawCondition: 'NM', ...i })) } });
  const create = (items: Record<string, unknown>[]) =>
    h.api<any>('POST', '/buylist/requests', {
      token: customer,
      json: { items: items.map((i) => ({ productType: 'raw', rawCondition: 'NM', ...i })), clabe: CLABE, addressId },
    });
  const detail = async (srId: string) => (await h.api<any>('GET', `/admin/buylist/${srId}`, { token: admin })).body;
  const itemOf = async (srId: string, itemId: string) => (await detail(srId)).items.find((i: any) => i.id === itemId);
  async function toTransit(items: Record<string, unknown>[]) {
    const res = await create(items);
    expect([res.status, res.status === 201 ? '' : JSON.stringify(res.body)]).toEqual([201, '']);
    const srId = res.body.sellRequestId as string;
    const ids: string[] = (await detail(srId)).items.map((i: any) => i.id);
    expect((await h.api('POST', `/admin/buylist/${srId}/offer`, { token: operator, json: { lines: ids.map((itemId) => ({ itemId, decision: 'buy' })) } })).status).toBe(200);
    expect((await h.api('POST', `/buylist/requests/${srId}/offer-response`, { token: customer, json: { decision: 'accept' } })).status).toBe(200);
    expect((await h.api('POST', `/admin/buylist/${srId}/confirm-shipment`, { token: operator, json: {} })).status).toBe(200);
    return { srId, ids };
  }
  const receive = (srId: string, items?: Record<string, unknown>[]) =>
    h.api<any>('POST', `/admin/buylist/${srId}/receive`, { token: operator, json: items ? { items } : {} });

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    customer = await h.login(E2E_USERS.customer2.email, E2E_USERS.customer2.password);
    operator = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    const u = await h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.customer2.email } });
    customerUserId = u.id;
    addressId = (await h.prisma.address.findFirstOrThrow({ where: { userId: u.id } })).id;
    // Set PROPIO: las cartas de esta suite no entran al «E2E Base Set» (buylist-cards-order cuenta sus cartas).
    setId = (await h.prisma.cardSet.create({ data: { externalId: `f4-${run}`, name: `Set F4 ${run}` } })).id;
    for (const k of DIALS) prev[k] = (await h.prisma.configSetting.findUnique({ where: { key: k } }))?.valueJson;
    await setDial('buylist_spanish_enabled', true);
    await setDial('buylist_spanish_penalty_pct', 15);
    await setDial('buylist_league_enabled', true);
    for (const k of ['buylist_cap_per_month_cents', 'buylist_cap_per_request_cents', 'ine_threshold_cents', 'buylist_operator_offer_cap_cents']) await setDial(k, 1_000_000_000);
    for (const k of ['buylist_minimum_request_cents', 'buylist_minimum_offer_net_cents', 'buylist_shipping_fee_cents']) await setDial(k, 0);
    await h.prisma.kycProfile.upsert({
      where: { userId: customerUserId },
      update: { capPerMonthCentsOverride: 1_000_000_000, ineFrontKey: 'kyc/f4-front', ineBackKey: 'kyc/f4-back' },
      create: { userId: customerUserId, capPerMonthCentsOverride: 1_000_000_000, ineFrontKey: 'kyc/f4-front', ineBackKey: 'kyc/f4-back' },
    });
    spy = jest.spyOn(h.app.get<MailPort>(MAIL_PORT), 'send').mockImplementation(async (m: MailMessage) => {
      mails.push(m);
      return { id: 'm' } as never;
    });
  });
  beforeEach(() => {
    mails = [];
  });
  afterAll(async () => {
    spy?.mockRestore();
    if (h) {
      if (converted.length) await h.prisma.inventoryItem.updateMany({ where: { id: { in: converted } }, data: { status: 'withdrawn' } });
      await h.prisma.pendingPriceEntry.deleteMany({ where: { cardId: { in: cardIds } } });
      for (const k of DIALS) {
        if (prev[k] === undefined) await h.prisma.configSetting.deleteMany({ where: { key: k } });
        else await setDial(k, prev[k]);
      }
      await h.close();
    }
  });

  describe('§3.4 cotización de la liga', () => {
    it('con el dial encendido `stamped` SE COTIZA (referencia de SU producto, no la normal); `stampOptions` y `versions[]` salen del catálogo, ordenados', async () => {
      const { cardId, pids } = await leagueCard(100_000, [
        { type: 'prize_pack', market: 300_000, label: 'Cosmos' },
        { type: 'league', market: 200_000 },
      ]);
      const r = await quote({ cardId, productId: pids[0] });
      expect(r.status).toBe(200);
      expect(r.body.quote.quotedPriceCents).toBe(curveOf(300_000)); // la de la liga, NO la normal (curveOf(100000))
      expect(r.body.quote.quotedPriceCents).not.toBe(curveOf(100_000));
      // ordenado por tipo (league < prize_pack): [pids[1], pids[0]]
      expect(r.body.stampOptions.map((s: any) => [s.productId, s.type, s.label])).toEqual([[pids[1], 'league', null], [pids[0], 'prize_pack', 'Cosmos']]);
      expect(r.body.versions.map((v: any) => v.key)).toEqual(['en', 'es', `en.${pids[1]}`, `es.${pids[1]}`, `en.${pids[0]}`, `es.${pids[0]}`]);
      expect(r.body.versions.find((v: any) => v.key === `en.${pids[0]}`)).toMatchObject({ language: 'en', offerCents: curveOf(300_000), reason: null, stamp: { type: 'prize_pack', productId: pids[0] } });
      expect(JSON.stringify(r.body)).not.toContain('marketCents'); // el mercado por versión es del congelado interno
      // la quote de la normal también las lista (los interruptores cambian el monto SIN otra llamada)
      const n = await quote({ cardId });
      expect(n.body.stampOptions).toHaveLength(2);
      expect(n.body.versions).toHaveLength(6);
    });

    it('dial APAGADO, producto ajeno, acabado que la liga no tiene ⇒ 400 STAMP_NOT_AVAILABLE (quote, batch por-ítem, requests sin crear); `variant` sigue PRODUCT_NOT_FOUND', async () => {
      const a = await leagueCard(100_000, [{ type: 'league', market: 200_000 }]);
      const b = await leagueCard(100_000, [{ type: 'league', market: 200_000 }]);
      const variant = await h.prisma.cardProduct.create({ data: { cardId: a.cardId, tcgplayerProductId: 770_000_000 + Math.floor(Math.random() * 9_000_000), kind: 'variant', name: `Variante ${run}`, finishes: ['normal'] } });
      // ajeno
      const foreign = await quote({ cardId: a.cardId, productId: b.pids[0] });
      expect([foreign.status, err(foreign).code]).toEqual([400, 'STAMP_NOT_AVAILABLE']);
      // acabado que la liga no tiene
      await h.prisma.card.update({ where: { id: a.cardId }, data: { availableFinishes: ['normal', 'holofoil'] } });
      const fin = await quote({ cardId: a.cardId, productId: a.pids[0], finish: 'holofoil' });
      expect([fin.status, err(fin).code]).toEqual([400, 'STAMP_NOT_AVAILABLE']);
      // variant
      const v = await quote({ cardId: a.cardId, productId: variant.tcgplayerProductId });
      expect([v.status, err(v).code]).toEqual([422, 'PRODUCT_NOT_FOUND']);
      // dial apagado
      await setDial('buylist_league_enabled', false);
      try {
        const off = await quote({ cardId: a.cardId, productId: a.pids[0] });
        expect([off.status, err(off).code]).toEqual([400, 'STAMP_NOT_AVAILABLE']);
        const bt = await batch([{ cardId: a.cardId, productId: a.pids[0] }, { cardId: a.cardId }]);
        expect(bt.status).toBe(200);
        expect(bt.body.results[0]).toMatchObject({ ok: false, error: { code: 'STAMP_NOT_AVAILABLE' } });
        expect(bt.body.results[1].ok).toBe(true);
        expect(bt.body.results[1].stampOptions).toEqual([]); // con el dial apagado la carta normal no ofrece ligas
        expect(bt.body.results[1].versions.map((x: any) => x.key)).toEqual(['en', 'es']);
        const before = await h.prisma.sellRequest.count({ where: { userId: customerUserId } });
        const rq = await create([{ cardId: a.cardId, productId: a.pids[0] }]);
        expect([rq.status, err(rq).code]).toEqual([400, 'STAMP_NOT_AVAILABLE']);
        expect(await h.prisma.sellRequest.count({ where: { userId: customerUserId } })).toBe(before);
      } finally {
        await setDial('buylist_league_enabled', true);
      }
    });

    it('ES-liga: castigo UNA vez sobre la referencia de ESA liga; ES ≤ EN-liga ≤ referencia, 20/20; /quote == /batch == /requests, 20/20', async () => {
      let invariants = 0;
      let same = 0;
      for (let n = 0; n < 20; n++) {
        const leagueMarket = 4_000 + n * 9_731; // MX$40 … MX$1,889: recorre el tramo interpolado y el plano
        const { cardId, pids } = await leagueCard(leagueMarket * 3, [{ type: 'league', market: leagueMarket }]); // la normal vale 3×: jamás se mezcla
        const en = await quote({ cardId, productId: pids[0] });
        const es = await quote({ cardId, productId: pids[0], language: 'es' });
        const adjusted = leagueMarket - scaleByPct(leagueMarket, 15);
        const expectEs = Math.min(curveOf(adjusted), curveOf(leagueMarket), leagueMarket);
        const esOffer = es.body.quote.quotedPriceCents as number;
        if (es.body.breakdown?.languagePenalty?.cents === -scaleByPct(leagueMarket, 15) && es.body.breakdown.marketMxnCents === leagueMarket && esOffer === expectEs && esOffer <= en.body.quote.quotedPriceCents && en.body.quote.quotedPriceCents <= leagueMarket) invariants += 1;
        const bt = await batch([{ cardId, productId: pids[0], language: 'es' }]);
        const rq = await create([{ cardId, productId: pids[0], language: 'es' }]);
        const created = await h.prisma.sellRequestItem.findFirstOrThrow({ where: { sellRequestId: rq.body.sellRequestId } });
        if (bt.body.results[0].quote.quotedPriceCents === esOffer && created.quotedPriceCents === esOffer && created.language === 'es' && created.cardProductId === pids[0]) same += 1;
      }
      expect([invariants, same]).toEqual([20, 20]);
    });

    it('liga SIN referencia ⇒ `offerCents:null, reason:no_reference` en sus dos idiomas; nunca se paga la normal ni se cuela a una cola', async () => {
      const { cardId, pids } = await leagueCard(100_000, [{ type: 'league', market: null }]);
      const r = await quote({ cardId, productId: pids[0] });
      expect(r.status).toBe(200);
      expect(r.body.quote).toMatchObject({ status: 'precio_pendiente', quotedPriceCents: null });
      const rows = r.body.versions.filter((v: any) => v.stamp?.productId === pids[0]);
      expect(rows.map((v: any) => [v.language, v.offerCents, v.reason])).toEqual([['en', null, 'no_reference'], ['es', null, 'no_reference']]);
      const normal = await quote({ cardId });
      expect(normal.body.quote.quotedPriceCents).toBe(curveOf(100_000)); // la normal sigue cotizando lo suyo
      expect(normal.body.versions.filter((v: any) => v.stamp?.productId === pids[0]).every((v: any) => v.offerCents === null)).toBe(true);
    });
  });

  describe('§4.1 recepción con ligas (matriz) y alta al inventario', () => {
    const pay = (mkt: number) => curveOf(mkt);

    it('normal→liga SUBE a min(oferta, referencia) congeladas (sin consentimiento); liga→normal BAJA (F2c); liga A→liga B baja a la oferta de B; el dial de liga apagado después no cuenta', async () => {
      const { cardId, pids } = await leagueCard(100_000, [{ type: 'league', market: 300_000 }, { type: 'prize_pack', market: 200_000 }]);
      const [A, B] = pids;
      // normal → liga A
      const up = await toTransit([{ cardId }]);
      await setDial('buylist_league_enabled', false); // la recepción NO lee el dial: usa lo congelado
      const r1 = await receive(up.srId, [{ itemId: up.ids[0], receivedProductId: A }]);
      await setDial('buylist_league_enabled', true);
      expect(r1.status).toBe(200);
      const i1 = await itemOf(up.srId, up.ids[0]);
      expect([i1.itemStatus, i1.revision, i1.receivedBreakdown.finalOfferCents, i1.receivedBreakdown.marketMxnCents]).toEqual(['recibida', null, Math.min(pay(300_000), 300_000), 300_000]);
      expect(i1.receivedBreakdown.finalOfferCents).toBeLessThanOrEqual(i1.receivedBreakdown.marketMxnCents);
      expect(i1.receivedStamp).toMatchObject({ type: 'league', productId: A });
      expect(mails.filter((m) => /Te pagamos|We pay/.test(m.text ?? '')).length).toBe(1);
      // liga A → normal
      const down = await toTransit([{ cardId, productId: A }]);
      mails = [];
      expect((await receive(down.srId, [{ itemId: down.ids[0], receivedProductId: null }])).status).toBe(200);
      const i2 = await itemOf(down.srId, down.ids[0]);
      expect([i2.itemStatus, i2.offeredPriceCents, i2.revision.proposedCents, i2.revision.reasonCode, i2.receivedStamp]).toEqual(['ajustada', pay(300_000), pay(100_000), 'version_mismatch', null]);
      expect(mails.filter((m) => /llegó como|arrived as/.test(m.text ?? '')).length).toBe(1);
      // liga A → liga B
      const ab = await toTransit([{ cardId, productId: A }]);
      expect((await receive(ab.srId, [{ itemId: ab.ids[0], receivedProductId: B }])).status).toBe(200);
      const i3 = await itemOf(ab.srId, ab.ids[0]);
      expect([i3.revision.proposedCents, i3.receivedStamp.productId, i3.stamp.productId]).toEqual([pay(200_000), B, A]);
    });

    it('ES-liga → EN normal: baja a la oferta EN normal congelada; ES normal → ES-liga: sube con castigo UNA vez sobre la liga; liga inexistente ⇒ wrong_card; liga sin llave de ESTA carta ⇒ wrong_card', async () => {
      const { cardId, pids } = await leagueCard(100_000, [{ type: 'league', market: 300_000 }]);
      const other = await leagueCard(100_000, [{ type: 'league', market: 300_000 }]);
      const A = pids[0];
      const esl = await toTransit([{ cardId, productId: A, language: 'es' }]);
      expect((await receive(esl.srId, [{ itemId: esl.ids[0], receivedLanguage: 'en', receivedProductId: null }])).status).toBe(200);
      const i1 = await itemOf(esl.srId, esl.ids[0]);
      const esOffer = Math.min(curveOf(300_000 - scaleByPct(300_000, 15)), curveOf(300_000));
      expect([i1.offeredPriceCents, i1.revision.proposedCents]).toEqual([esOffer, curveOf(100_000)]);

      const es = await toTransit([{ cardId, language: 'es' }]);
      expect((await receive(es.srId, [{ itemId: es.ids[0], receivedLanguage: 'es', receivedProductId: A }])).status).toBe(200);
      const i2 = await itemOf(es.srId, es.ids[0]);
      expect(i2.receivedBreakdown).toMatchObject({ source: 'received', marketMxnCents: 300_000, finalOfferCents: esOffer });
      expect(i2.receivedBreakdown.languagePenalty).toEqual({ pct: 15, cents: -scaleByPct(300_000, 15) });
      expect(i2.receivedBreakdown.finalOfferCents).toBeLessThanOrEqual(300_000);

      const bad = await toTransit([{ cardId }]);
      for (const pid of [987_654_321, other.pids[0]]) {
        const r = await receive(bad.srId, [{ itemId: bad.ids[0], receivedProductId: pid }]);
        expect([r.status, err(r).code, err(r).details?.reason]).toEqual([422, 'VERSION_PRICE_UNAVAILABLE', 'wrong_card']);
      }
      expect((await detail(bad.srId)).status).toBe('en_transito');
    });

    it('liga cotizada SIN referencia al declarar y recibida como liga ⇒ se paga lo declarado (llave `null`); liga válida del catálogo pero fuera del congelado ⇒ 422 `no_price`', async () => {
      const { cardId, pids } = await leagueCard(100_000, [{ type: 'league', market: null }]);
      const t = await toTransit([{ cardId }]);
      expect((await receive(t.srId, [{ itemId: t.ids[0], receivedProductId: pids[0] }])).status).toBe(200);
      const it = await itemOf(t.srId, t.ids[0]);
      expect([it.itemStatus, it.revision, it.receivedBreakdown, it.receivedVersionSet]).toEqual(['recibida', null, null, true]);
      // liga creada DESPUÉS de cotizar: válida en el catálogo, pero sin congelado ⇒ sin respaldo
      const late = await leagueCard(100_000, []);
      const t2 = await toTransit([{ cardId: late.cardId }]);
      const cp = await h.prisma.cardProduct.create({ data: { cardId: late.cardId, tcgplayerProductId: 780_000_000 + Math.floor(Math.random() * 9_000_000), kind: 'stamped', name: `Tarde ${run}`, finishes: ['normal'], stampType: 'league', sourceGroupId: 1539 } });
      const r = await receive(t2.srId, [{ itemId: t2.ids[0], receivedProductId: cp.tcgplayerProductId }]);
      expect([r.status, err(r).code, err(r).details?.reason]).toEqual([422, 'VERSION_PRICE_UNAVAILABLE', 'no_price']);
    });

    it('lo recibido nunca se paga por encima de SU referencia congelada: liga con mercado MX$0.90 (piso de compra MX$1.00) ⇒ min(oferta, referencia) = MX$0.90', async () => {
      const { cardId, pids } = await leagueCard(100, [{ type: 'league', market: 90 }]); // normal: oferta = piso MX$1.00
      const t = await toTransit([{ cardId }]);
      expect((await itemOf(t.srId, t.ids[0])).offeredPriceCents).toBe(100);
      expect((await receive(t.srId, [{ itemId: t.ids[0], receivedProductId: pids[0] }])).status).toBe(200);
      const it = await itemOf(t.srId, t.ids[0]);
      expect([it.receivedBreakdown.finalOfferCents, it.receivedBreakdown.marketMxnCents]).toEqual([90, 90]);
      expect([it.itemStatus, it.revision?.proposedCents]).toEqual(['ajustada', 90]); // 90 < 100 pactado ⇒ baja con el «sí» del vendedor
    });

    it('criterio 7: 4 líneas (EN, ES, EN-liga, ES-liga) dan de alta `language` y `cardProductId` correctos; con lo recibido distinto manda lo recibido', async () => {
      const { cardId, pids } = await leagueCard(100_000, [{ type: 'league', market: 300_000 }]);
      const A = pids[0];
      const t = await toTransit([{ cardId }, { cardId, language: 'es' }, { cardId, productId: A }, { cardId, productId: A, language: 'es' }]);
      const rows = await h.prisma.sellRequestItem.findMany({ where: { id: { in: t.ids } } });
      const key = (r: { language: string; cardProductId: number | null }) => `${r.language}|${r.cardProductId ?? '-'}`;
      expect(rows.map(key).sort()).toEqual(['en|-', `en|${A}`, 'es|-', `es|${A}`].sort());
      // la 4ª llega como EN normal (la baja se acepta) y la 3ª como llegó
      const esLeague = rows.find((r) => r.language === 'es' && r.cardProductId === A)!;
      expect((await receive(t.srId, [{ itemId: esLeague.id, receivedLanguage: 'en', receivedProductId: null }])).status).toBe(200);
      expect((await h.api('POST', `/admin/buylist/${t.srId}/verify`, { token: operator })).status).toBe(200);
      // la baja de la 4ª la acepta el vendedor; las otras 3 se aprueban al pactado
      const rev = (await itemOf(t.srId, esLeague.id)).revision;
      expect((await h.api('POST', `/buylist/requests/${t.srId}/items/${esLeague.id}/revision-response`, { token: customer, json: { decision: 'accept', expectedRevisedPriceCents: rev.proposedCents } })).status).toBe(200);
      for (const r of rows.filter((x) => x.id !== esLeague.id)) {
        expect((await h.api('PATCH', `/admin/buylist/items/${r.id}/decision`, { token: operator, json: { decision: 'approve' } })).status).toBe(200);
      }
      const loc = await h.prisma.vaultLocation.create({ data: { zone: 'platform_stock', box: `F4${Date.now()}`, row: '1', slot: '1', label: 'F4-1' } });
      const cv = await h.api<any>('POST', `/admin/buylist/${t.srId}/convert-all`, { token: operator, json: { locationId: loc.id } });
      expect(cv.status).toBe(200);
      const inv = await h.prisma.inventoryItem.findMany({ where: { sourceSellRequestItemId: { in: t.ids } } });
      converted.push(...inv.map((i) => i.id));
      const bySource = new Map(inv.map((i) => [i.sourceSellRequestItemId, i]));
      expect(inv).toHaveLength(4);
      const got = rows.map((r) => `${r.id === esLeague.id ? 'RECIBIDA' : key(r)} => ${bySource.get(r.id)!.language}|${bySource.get(r.id)!.cardProductId ?? '-'}`).sort();
      expect(got).toEqual(
        [`en|- => en|-`, `es|- => es|-`, `en|${A} => en|${A}`, `RECIBIDA => en|-`].sort(),
      );
    });
  });

  describe('BES-6 en liga, DTO y mesa', () => {
    it('override de staff en línea EN de LIGA por encima de SU referencia ⇒ 422 ES_OVER_CAP (capCents = la referencia de la liga), 10/10', async () => {
      const { cardId, pids } = await leagueCard(100_000, [{ type: 'league', market: 300_000 }]);
      const res = await create([{ cardId, productId: pids[0] }]);
      expect(res.status).toBe(201);
      const srId = res.body.sellRequestId as string;
      const id = (await detail(srId)).items[0].id as string;
      let blocked = 0;
      for (let n = 1; n <= 10; n++) {
        const r = await h.api('POST', `/admin/buylist/${srId}/offer`, {
          token: operator,
          json: { lines: [{ itemId: id, decision: 'buy', overridePriceCents: 300_000 + n, overrideReason: 'prueba tope de liga' }] },
        });
        if (r.status === 422 && err(r).code === 'ES_OVER_CAP' && err(r).details?.capCents === 300_000) blocked += 1;
      }
      expect(blocked).toBe(10);
    });

    it('la mesa y el DTO llevan `stamp`/`versionOptions`; apagar el dial DESPUÉS no deja la línea firmada sin precio', async () => {
      const { cardId, pids } = await leagueCard(100_000, [{ type: 'league', market: 300_000 }]);
      const res = await create([{ cardId, productId: pids[0] }]);
      expect(res.status).toBe(201);
      const srId = res.body.sellRequestId as string;
      expect(res.body.items[0].stamp).toMatchObject({ type: 'league', productId: pids[0] });
      const cl = (await h.api<any>('GET', `/buylist/requests/${srId}`, { token: customer })).body;
      expect(cl.items[0].stamp).toMatchObject({ type: 'league', productId: pids[0] });
      expect(cl.items[0]).not.toHaveProperty('versionOptions'); // solo admin
      expect(cl.items[0]).not.toHaveProperty('versions');
      await setDial('buylist_league_enabled', false);
      try {
        const dt = await h.api<any>('GET', `/admin/buylist/${srId}/decision-table`, { token: operator });
        expect(dt.status).toBe(200);
        const line = dt.body.lines[0];
        expect(line.derivedPriceCents).toBe(curveOf(300_000));
        expect(line.stamp).toMatchObject({ type: 'league', productId: pids[0] });
        expect(line.versions.map((v: any) => v.key).sort()).toEqual(line.versionOptions.map((v: any) => v.key).sort());
        expect(line.versionOptions.map((v: any) => v.key).sort()).toEqual(['en', 'en.' + pids[0], 'es', 'es.' + pids[0]].sort());
      } finally {
        await setDial('buylist_league_enabled', true);
      }
    });
  });
});

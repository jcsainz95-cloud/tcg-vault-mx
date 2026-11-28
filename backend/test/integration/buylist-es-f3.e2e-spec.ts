import { randomUUID } from 'crypto';
/**
 * §BUYLIST-ES F3 — POR HTTP, CONTRA POSTGRES REAL (API_CONTRACT_BUYLIST_ES §1, §4.1-4.5, §6 criterios 12, 13, 15, §9).
 * Recepción con idioma recibido (EN→ES baja F2c, ES→EN alza sin consentimiento, respaldo de filas previas, fuera del mapa, condición + versión),
 * CAS (2 recepciones simultáneas ⇒ 1 ajuste), congelado (`P` del dial AL CREAR, nunca el vivo), cola por idioma, BES-6 y DTO de cliente (BES-4).
 */
import { E2EHarness } from './helpers/e2e-app';
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

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

describe('E2E — §BUYLIST-ES F3 (recepción con idioma recibido)', () => {
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
  const today = () => new Date(new Date().toISOString().slice(0, 10));
  const err = (r: { body: unknown }) => (r.body as { error: { code: string; details?: Record<string, any> } }).error;
  const setDial = (key: string, value: unknown) =>
    h.prisma.configSetting.upsert({ where: { key }, update: { valueJson: value as never }, create: { key, valueJson: value as never } });

  /** Carta con mercado manual (MX$ `market`/100) en `normal`; sin `market` ⇒ sin referencia. */
  async function card(n: string, market: number | null) {
    const c = await h.prisma.card.create({
      data: { externalId: `f3-${run}-${n}`, setId, name: `Carta F3 ${run} ${n}`, number: n, rarity: 'Common', rarityCanonical: 'Common', availableFinishes: ['normal'] },
    });
    cardIds.push(c.id);
    if (market != null) {
      await h.prisma.priceReference.create({
        data: { cardId: c.id, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'manual', priceMxnCents: market, capturedDate: today(), isManualOverride: true, refKind: 'market' },
      });
    }
    return c.id;
  }
  const create = (items: Record<string, unknown>[]) =>
    h.api<any>('POST', '/buylist/requests', {
      token: customer,
      json: { items: items.map((i) => ({ productType: 'raw', rawCondition: 'NM', ...i })), clabe: CLABE, addressId },
    });
  const detail = async (srId: string) => (await h.api<any>('GET', `/admin/buylist/${srId}`, { token: admin })).body;
  const itemOf = async (srId: string, itemId: string) => (await detail(srId)).items.find((i: any) => i.id === itemId);
  /** cotizada → ofertada → aceptada → en_transito. */
  async function toTransit(items: Record<string, unknown>[]) {
    const res = await create(items);
    expect(res.status).toBe(201);
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
    setId = (await h.prisma.cardSet.create({ data: { externalId: `f3-${run}`, name: `Set F3 ${run}` } })).id;
    for (const k of DIALS) prev[k] = (await h.prisma.configSetting.findUnique({ where: { key: k } }))?.valueJson;
    await setDial('buylist_spanish_enabled', true);
    await setDial('buylist_spanish_penalty_pct', 15);
    await setDial('buylist_league_enabled', false);
    for (const k of ['buylist_cap_per_month_cents', 'buylist_cap_per_request_cents', 'ine_threshold_cents', 'buylist_operator_offer_cap_cents']) await setDial(k, 1_000_000_000);
    for (const k of ['buylist_minimum_request_cents', 'buylist_minimum_offer_net_cents', 'buylist_shipping_fee_cents']) await setDial(k, 0);
    await h.prisma.kycProfile.upsert({
      where: { userId: customerUserId },
      update: { capPerMonthCentsOverride: 1_000_000_000, ineFrontKey: 'kyc/f3-front', ineBackKey: 'kyc/f3-back' },
      create: { userId: customerUserId, capPerMonthCentsOverride: 1_000_000_000, ineFrontKey: 'kyc/f3-front', ineBackKey: 'kyc/f3-back' },
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

  it('migración F3: columnas nuevas, `PendingPriceEntry.language` y toda fila previa en `en`', async () => {
    const cols = await h.prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE (table_name = 'SellRequestItem' AND column_name IN ('spanishPenaltyPctAtQuote','versionMarkets','receivedBreakdown'))
         OR (table_name = 'PendingPriceEntry' AND column_name = 'language')`;
    expect(cols.map((c) => `${c.table_name}.${c.column_name}`).sort()).toEqual([
      'PendingPriceEntry.language',
      'SellRequestItem.receivedBreakdown',
      'SellRequestItem.spanishPenaltyPctAtQuote',
      'SellRequestItem.versionMarkets',
    ]);
    expect(await h.prisma.pendingPriceEntry.count({ where: { language: { not: 'en' }, cardId: { notIn: cardIds } } })).toBe(0);
  });

  it('al crear congela `P` del dial (también en EN), `versionOffers` y `versionMarkets`; el dial vivo después no los mueve', async () => {
    const c = await card('freeze', 100_000);
    const res = await create([{ cardId: c }, { cardId: c, language: 'es' }]);
    expect(res.status).toBe(201);
    await setDial('buylist_spanish_penalty_pct', 40);
    const rows = await h.prisma.sellRequestItem.findMany({ where: { sellRequestId: res.body.sellRequestId }, orderBy: { language: 'asc' } });
    expect(rows.map((r) => r.spanishPenaltyPctAtQuote)).toEqual([15, 15]);
    for (const r of rows) {
      expect(r.versionOffers).toEqual({ en: 50_000, es: 42_500 });
      expect(r.versionMarkets).toEqual({ en: 100_000, es: 100_000 });
    }
    await setDial('buylist_spanish_penalty_pct', 15);
  });

  describe('recepción §4.1', () => {
    it('EN→ES: baja F2c automática `version_mismatch` a la oferta ES CONGELADA (MX$425), `offeredPriceCents` intacto, 1 correo; el dial vivo no cuenta (5/5)', async () => {
      let ok = 0;
      for (let n = 0; n < 5; n++) {
        await setDial('buylist_spanish_penalty_pct', 15);
        const c = await card(`enes${n}`, 100_000);
        const { srId, ids } = await toTransit([{ cardId: c }]);
        await setDial('buylist_spanish_penalty_pct', 10 + n * 10); // el dial se mueve entre cotizar y recibir
        mails = [];
        const r = await receive(srId, [{ itemId: ids[0], receivedLanguage: 'es' }]);
        expect(r.status).toBe(200);
        const it = await itemOf(srId, ids[0]);
        if (
          it.itemStatus === 'ajustada' &&
          it.offeredPriceCents === 50_000 &&
          it.revision?.state === 'pending' &&
          it.revision?.proposedCents === 42_500 &&
          it.revision?.reasonCode === 'version_mismatch' &&
          it.receivedLanguage === 'es' &&
          it.receivedVersionSet === true &&
          it.receivedBreakdown?.source === 'received' &&
          it.receivedBreakdown?.languagePenalty?.pct === 15 &&
          it.receivedBreakdown?.languagePenalty?.cents === -15_000 &&
          it.receivedBreakdown?.adjustedMarketCents === 85_000 &&
          it.receivedBreakdown?.finalOfferCents === 42_500 &&
          mails.filter((m) => /llegó como|arrived as/.test(m.text ?? '')).length === 1
        ) ok += 1;
      }
      await setDial('buylist_spanish_penalty_pct', 15);
      expect(ok).toBe(5);
    });

    it('aprobar al pactado una baja `version_mismatch` viva ⇒ 409 VERSION_MISMATCH_PENDING (no se paga la declarada por otra versión)', async () => {
      const c = await card('pend', 100_000);
      const { srId, ids } = await toTransit([{ cardId: c }]);
      expect((await receive(srId, [{ itemId: ids[0], receivedLanguage: 'es' }])).status).toBe(200);
      expect((await h.api('POST', `/admin/buylist/${srId}/verify`, { token: operator })).status).toBe(200);
      const r = await h.api('PATCH', `/admin/buylist/items/${ids[0]}/decision`, { token: operator, json: { decision: 'approve' } });
      expect([r.status, err(r).code]).toEqual([409, 'VERSION_MISMATCH_PENDING']);
    });

    it('ES→EN: sube a `min(oferta EN congelada, referencia)` SIN consentimiento; al aprobar se paga eso; correo «te pagamos»; la pieza nace en EN', async () => {
      const c = await card('esen', 100_000);
      const { srId, ids } = await toTransit([{ cardId: c, language: 'es' }]);
      const r = await receive(srId, [{ itemId: ids[0], receivedLanguage: 'en' }]);
      expect(r.status).toBe(200);
      const it = await itemOf(srId, ids[0]);
      expect(it.offeredPriceCents).toBe(42_500);
      expect(it.itemStatus).toBe('recibida');
      expect(it.revision).toBeNull();
      expect(it.receivedBreakdown).toMatchObject({ source: 'received', finalOfferCents: 50_000, marketMxnCents: 100_000 });
      expect(it.receivedBreakdown.finalOfferCents).toBeLessThanOrEqual(it.receivedBreakdown.marketMxnCents);
      expect(mails.filter((m) => /Te pagamos|We pay/.test(m.text ?? '')).length).toBe(1);
      expect((await h.api('POST', `/admin/buylist/${srId}/verify`, { token: operator })).status).toBe(200);
      const ap = await h.api<any>('PATCH', `/admin/buylist/items/${ids[0]}/decision`, { token: operator, json: { decision: 'approve' } });
      expect(ap.status).toBe(200);
      expect(ap.body.approvedPriceCents).toBe(50_000);
      const loc = await h.prisma.vaultLocation.create({ data: { zone: 'platform_stock', box: `F3${Date.now()}`, row: '1', slot: '1', label: 'F3-1' } });
      const cv = await h.api<any>('POST', `/admin/buylist/${srId}/convert-all`, { token: operator, json: { locationId: loc.id } });
      expect(cv.status).toBe(200);
      const inv = await h.prisma.inventoryItem.findFirstOrThrow({ where: { sourceSellRequestItemId: ids[0] } });
      converted.push(inv.id);
      expect([inv.language, inv.cardProductId]).toEqual(['en', null]);
    });

    it('flujo del front: `PATCH …/decision approve` con `receivedLanguage` dispara §4 — baja ⇒ NO aprueba (queda la propuesta); alza ⇒ aprueba pagando min(oferta, referencia); la misma ⇒ aprueba al pactado', async () => {
      const c = await card('patch', 100_000);
      const t = await toTransit([{ cardId: c }, { cardId: c, language: 'es' }, { cardId: c }]);
      expect((await receive(t.srId)).status).toBe(200);
      expect((await h.api('POST', `/admin/buylist/${t.srId}/verify`, { token: operator })).status).toBe(200);
      const patch = (id: string, json: Record<string, unknown>) => h.api<any>('PATCH', `/admin/buylist/items/${id}/decision`, { token: operator, json: { decision: 'approve', ...json } });
      const down = await patch(t.ids[0], { receivedLanguage: 'es' });
      expect([down.status, down.body.itemStatus, down.body.approvedPriceCents ?? null]).toEqual([200, 'ajustada', null]);
      expect((await itemOf(t.srId, t.ids[0])).revision).toMatchObject({ state: 'pending', proposedCents: 42_500, reasonCode: 'version_mismatch' });
      const up = await patch(t.ids[1], { receivedLanguage: 'en' });
      expect([up.status, up.body.itemStatus, up.body.approvedPriceCents]).toEqual([200, 'aprobada', 50_000]);
      const same = await patch(t.ids[2], { receivedLanguage: 'en' });
      expect([same.status, same.body.approvedPriceCents]).toEqual([200, 50_000]);
    });

    it('misma versión ⇒ `receivedVersionSet:true` y nada más (sin baja, sin correo, sin desglose)', async () => {
      const c = await card('same', 100_000);
      const { srId, ids } = await toTransit([{ cardId: c }]);
      expect((await receive(srId, [{ itemId: ids[0], receivedLanguage: 'en' }])).status).toBe(200);
      const it = await itemOf(srId, ids[0]);
      expect([it.receivedVersionSet, it.itemStatus, it.revision, it.receivedBreakdown]).toEqual([true, 'recibida', null, null]);
      expect(mails.filter((m) => /llegó como|Te pagamos más|We pay more/.test(m.text ?? '')).length).toBe(0);
    });

    it('2 recepciones SIMULTÁNEAS ⇒ 1 solo ajuste y 1 solo correo (CAS), 5/5; repetir lo mismo es idempotente; otra versión ⇒ 409 VERSION_ALREADY_SET', async () => {
      let one = 0;
      for (let n = 0; n < 5; n++) {
        const c = await card(`race${n}`, 100_000);
        const { srId, ids } = await toTransit([{ cardId: c }]);
        mails = [];
        const [a, b] = await Promise.all([receive(srId, [{ itemId: ids[0], receivedLanguage: 'es' }]), receive(srId, [{ itemId: ids[0], receivedLanguage: 'es' }])]);
        expect([a.status, b.status]).toEqual([200, 200]);
        const rev = mails.filter((m) => /llegó como|arrived as/.test(m.text ?? '')).length;
        const it = await itemOf(srId, ids[0]);
        if (rev === 1 && it.revision?.proposedCents === 42_500) one += 1;
        if (n === 0) {
          expect((await receive(srId, [{ itemId: ids[0], receivedLanguage: 'es' }])).status).toBe(200); // idempotente
          const other = await h.api('PATCH', `/admin/buylist/items/${ids[0]}/decision`, { token: operator, json: { decision: 'approve', receivedLanguage: 'en' } });
          expect([other.status, err(other).code]).toEqual([409, 'VERSION_ALREADY_SET']);
        }
      }
      expect(one).toBe(5);
    });

    it('fila SIN congelado (previa a F3): respaldo con `P` y curva VIVOS, tope ≤ lo cotizado; sin mercado ⇒ 422 VERSION_PRICE_UNAVAILABLE', async () => {
      const c = await card('legacy', 100_000);
      const { srId, ids } = await toTransit([{ cardId: c }]);
      await h.prisma.$executeRaw`UPDATE "SellRequestItem" SET "versionOffers" = NULL, "versionMarkets" = NULL, "spanishPenaltyPctAtQuote" = NULL, "offerBreakdown" = NULL WHERE id = ${ids[0]}`;
      await setDial('buylist_spanish_penalty_pct', 20);
      const r = await receive(srId, [{ itemId: ids[0], receivedLanguage: 'es' }]);
      await setDial('buylist_spanish_penalty_pct', 15);
      expect(r.status).toBe(200);
      const it = await itemOf(srId, ids[0]);
      // 100000 − 20 % = 80000 → curva 50 % = 40000 (≤ lo cotizado 50000).
      expect([it.revision?.proposedCents, it.receivedBreakdown?.languagePenalty?.pct]).toEqual([40_000, 20]);

      const c2 = await card('legacy2', 100_000);
      const t2 = await toTransit([{ cardId: c2 }]);
      await h.prisma.$executeRaw`UPDATE "SellRequestItem" SET "versionOffers" = NULL, "versionMarkets" = NULL, "marketMxnCents" = NULL WHERE id = ${t2.ids[0]}`;
      const bad = await receive(t2.srId, [{ itemId: t2.ids[0], receivedLanguage: 'es' }]);
      expect([bad.status, err(bad).code, err(bad).details?.reason]).toEqual([422, 'VERSION_PRICE_UNAVAILABLE', 'no_price']);
      // la solicitud no avanzó a medias:
      expect((await detail(t2.srId)).status).toBe('en_transito');
    });

    it('fuera del mapa (producto de liga inexistente) ⇒ 422 VERSION_PRICE_UNAVAILABLE `wrong_card` y la solicitud NO transiciona', async () => {
      const c = await card('oom', 100_000);
      const { srId, ids } = await toTransit([{ cardId: c }]);
      const r = await receive(srId, [{ itemId: ids[0], receivedProductId: 987_654_321 }]);
      expect([r.status, err(r).code, err(r).details?.reason]).toEqual([422, 'VERSION_PRICE_UNAVAILABLE', 'wrong_card']);
      expect((await detail(srId)).status).toBe('en_transito');
    });

    it('un itemId ajeno a la solicitud ⇒ 400 y nada se mueve', async () => {
      const c = await card('foreign', 100_000);
      const { srId } = await toTransit([{ cardId: c }]);
      const r = await receive(srId, [{ itemId: randomUUID(), receivedLanguage: 'es' }]);
      expect([r.status, err(r).code]).toEqual([400, 'VALIDATION_ERROR']);
      expect((await detail(srId)).status).toBe('en_transito');
    });

    it('condición Y versión distintas: manda `condition_mismatch` y el monto revisado se topa en lo que vale lo recibido (422 OVER_VERSION_CAP)', async () => {
      const c = await card('both', 100_000);
      const { srId, ids } = await toTransit([{ cardId: c }]);
      expect((await receive(srId)).status).toBe(200);
      const over = await h.api('POST', `/admin/buylist/items/${ids[0]}/revise-price`, {
        token: operator,
        json: { revisedPriceCents: 45_000, reasonCode: 'condition_mismatch', receivedLanguage: 'es' },
      });
      expect([over.status, err(over).code, err(over).details?.capCents]).toEqual([422, 'OVER_VERSION_CAP', 42_500]);
      const ok = await h.api('POST', `/admin/buylist/items/${ids[0]}/revise-price`, {
        token: operator,
        json: { revisedPriceCents: 40_000, reasonCode: 'condition_mismatch', receivedLanguage: 'es' },
      });
      expect(ok.status).toBe(200);
      const it = await itemOf(srId, ids[0]);
      expect([it.revision?.reasonCode, it.revision?.proposedCents, it.receivedLanguage, it.receivedVersionSet]).toEqual(['condition_mismatch', 40_000, 'es', true]);
    });
  });

  describe('cola §4.5 (M8/BES-5): una línea abre y cierra SOLO su versión', () => {
    it('ES y EN pendientes de la misma carta = 2 entradas; el precio llega y la EN cierra la EN, la ES cierra la ES, en ambos órdenes (2/2)', async () => {
      const entries = (cardId: string) => h.prisma.pendingPriceEntry.findMany({ where: { cardId, context: 'buylist', status: 'open' }, orderBy: { language: 'asc' } });
      let ok = 0;
      for (const order of [['en', 'es'], ['es', 'en']] as const) {
        const c = await card(`q-${order[0]}`, null);
        // Sin mercado: EN pendiente. (La solicitud pendiente exige INE: el KYC de la prueba ya lo trae.)
        const r = await create([{ cardId: c }, { cardId: c, language: 'es' }]);
        expect([r.status, r.status === 201 ? '' : JSON.stringify(r.body)]).toEqual([201, '']);
        const open = await entries(c);
        expect(open.map((e) => e.language)).toEqual(['en', 'es']);
        await h.prisma.priceReference.create({
          data: { cardId: c, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'manual', priceMxnCents: 100_000, capturedDate: today(), isManualOverride: true, refKind: 'market' },
        });
        const first = await create([{ cardId: c, ...(order[0] === 'es' ? { language: 'es' } : {}) }]);
        expect(first.status).toBe(201);
        expect((await entries(c)).map((e) => e.language)).toEqual([order[1]]); // solo cerró SU versión
        const second = await create([{ cardId: c, ...(order[1] === 'es' ? { language: 'es' } : {}) }]);
        expect(second.status).toBe(201);
        if ((await entries(c)).length === 0) ok += 1;
      }
      expect(ok).toBe(2);
    });
  });

  describe('BES-6 tope duro y BES-4 DTO de cliente', () => {
    it('override de staff en línea ES por encima de min(EN viva, referencia) ⇒ 422 ES_OVER_CAP con `details.capCents`, 10/10; el tope exacto sí pasa', async () => {
      const c = await card('cap', 100_000);
      const res = await create([{ cardId: c, language: 'es' }]);
      const srId = res.body.sellRequestId as string;
      const id = (await detail(srId)).items[0].id as string;
      let blocked = 0;
      for (let n = 1; n <= 10; n++) {
        const r = await h.api('POST', `/admin/buylist/${srId}/offer`, {
          token: operator,
          json: { lines: [{ itemId: id, decision: 'buy', overridePriceCents: 50_000 + n * 1000, overrideReason: 'prueba tope duro' }] },
        });
        if (r.status === 422 && err(r).code === 'ES_OVER_CAP' && err(r).details?.capCents === 50_000) blocked += 1;
      }
      expect(blocked).toBe(10);
      const exact = await h.api('POST', `/admin/buylist/${srId}/offer`, {
        token: operator,
        json: { lines: [{ itemId: id, decision: 'buy', overridePriceCents: 50_000, overrideReason: 'justo el tope' }] },
      });
      expect(exact.status).toBe(200);
    });

    it('el DTO del CLIENTE no lleva `curveOfferCents` ni `cap.cents` (solicitud, lista y creación); el de admin sí conserva todo', async () => {
      const c = await card('dto', 100_000);
      const res = await create([{ cardId: c }, { cardId: c, language: 'es' }]);
      expect(res.status).toBe(201);
      const srId = res.body.sellRequestId as string;
      const bodies = [
        JSON.stringify(res.body),
        JSON.stringify((await h.api('GET', `/buylist/requests/${srId}`, { token: customer })).body),
        JSON.stringify((await h.api('GET', '/buylist/requests', { token: customer })).body),
      ];
      for (const b of bodies) {
        expect(b).not.toContain('curveOfferCents');
        expect(b).not.toMatch(/"cap":\{"reason":"[a-z_]+","cents"/);
      }
      expect(JSON.stringify(await detail(srId))).toContain('curveOfferCents');
    });
  });
});

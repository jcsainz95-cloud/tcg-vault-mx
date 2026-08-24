/**
 * pricing-visibility.e2e-spec.ts — E2E contra Postgres REAL de la funcionalidad central de P-48:
 * la **regla de visibilidad de «Valor de mercado»** (§N.7) y la **cola de triage**.
 *
 * ### Por qué existe este archivo
 * QA encontró contra el stack vivo que `GroupedListingDTO` salía **sin `priceBasis`** (requerido por
 * contrato), lo que **invertía** la regla de §N.7: el front compara `priceBasis === 'market'` y con
 * `undefined` esa comparación es siempre falsa ⇒ el bloque no se mostraba **nunca**, en el 100% de
 * las fichas. Ninguna de las tres capas de verificación lo vio: los fixtures del front **horneaban**
 * el campo, el test de forma miraba el `ListingDTO` **por-pieza** (que sí lo traía) y **ningún test
 * `@real` abría una ficha**.
 *
 * Este spec cierra esa última rendija **del lado del backend**: mira los DTOs de **GRUPO** tal como
 * salen por HTTP, contra datos reales. La forma se assertea sobre el **JSON de la respuesta**, que es
 * donde un requerido ausente y un opcional ausente por fin se distinguen.
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_CARDS, E2E_FOLIOS, E2E_USERS } from '../../prisma/e2e-fixtures';
import { DEFAULT_PRICING_CURVE, resolveSaleFromCurve } from '../../src/common/pricing-curve';

const salePrice = (marketCents: number) => resolveSaleFromCurve(marketCents, DEFAULT_PRICING_CURVE).cents as number;

/** Claves EXACTAS de `GroupedListingDTO` (contrato §DTOs) para una pieza `raw` sin grading. */
const GROUPED_LISTING_KEYS = [
  'card',
  'currency',
  'finish',
  'gradeKey',
  'priceBasis',
  'productType',
  'rawCondition',
  'referenceValue',
  'representativeInventoryItemId',
  'salePriceCents',
  'stockCount',
].sort();

describe('E2E — regla de visibilidad de «Valor de mercado» (§N.7) contra backend vivo', () => {
  let h: E2EHarness;
  let adminToken: string;

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
  });

  afterAll(async () => {
    await h?.close();
  });

  describe('B-1 — el DTO de GRUPO trae `priceBasis` (era `undefined` en el 100%)', () => {
    it('`GET /catalog/cards` — el grupo del charizard trae `priceBasis: "market"`', async () => {
      const res = await h.api('GET', `/catalog/cards?q=${encodeURIComponent(E2E_CARDS.charizard.name)}&pageSize=20`);
      expect(res.status).toBe(200);
      const group = res.body.data.find((g: { card: { name: string } }) => g.card.name === E2E_CARDS.charizard.name);
      expect(group).toBeDefined();
      // La condición EXACTA que evalúa el front para pintar «Valor de mercado».
      expect(group.priceBasis).toBe('market');
      expect(group.salePriceCents).toBe(salePrice(E2E_CARDS.charizard.refNmCents!));
    });

    it('la FORMA en el cable: conjunto EXACTO de claves del grupo, ni una de menos ni de más', async () => {
      const res = await h.api('GET', `/catalog/cards?q=${encodeURIComponent(E2E_CARDS.charizard.name)}&pageSize=20`);
      const group = res.body.data.find((g: { card: { name: string } }) => g.card.name === E2E_CARDS.charizard.name);
      expect(Object.keys(group).sort()).toEqual(GROUPED_LISTING_KEYS);
    });

    it('`GET /catalog/cards/:cardId` — `listings[]` (grupos) también lo trae, no solo `units[]`', async () => {
      const card = await h.prisma.card.findUnique({ where: { externalId: E2E_CARDS.charizard.externalId } });
      const res = await h.api('GET', `/catalog/cards/${card!.id}`);
      expect(res.status).toBe(200);
      expect(res.body.listings.length).toBeGreaterThan(0);
      for (const g of res.body.listings) expect(g.priceBasis).toBe('market');
      // `units[]` es el ListingDTO por-pieza: ya lo traía, y se fija para que no se pierda.
      for (const u of res.body.units) expect(u.priceBasis).toBeDefined();
    });

    it('un override manual POR PIEZA da `priceBasis: "override"` ⇒ el front NO pinta el bloque', async () => {
      const res = await h.api('GET', `/catalog/cards?q=${encodeURIComponent(E2E_CARDS.common.name)}&pageSize=20`);
      const group = res.body.data.find((g: { card: { name: string } }) => g.card.name === E2E_CARDS.common.name);
      // El seed publica esta carta con `listPriceCents` override (E2E-LST-0002).
      expect(group.priceBasis).toBe('override');
      expect(group.priceBasis === 'market').toBe(false); // el mercado NO produjo este precio
    });

    it('`referenceValue` público sigue SIN procedencia (S48-M2 no se rompió al arreglar B-1)', async () => {
      const res = await h.api('GET', `/catalog/cards?q=${encodeURIComponent(E2E_CARDS.charizard.name)}&pageSize=20`);
      const group = res.body.data.find((g: { card: { name: string } }) => g.card.name === E2E_CARDS.charizard.name);
      expect(Object.keys(group.referenceValue).sort()).toEqual(['capturedDate', 'referenceMxnCents', 'status']);
      expect(group.referenceValue).not.toHaveProperty('source');
      expect(group.referenceValue).not.toHaveProperty('isManualOverride');
    });
  });

  describe('I-1 — falta de credencial ⇒ 401 (el interceptor del cliente depende de ese status)', () => {
    it.each([['/vault/holdings'], ['/buylist/requests'], ['/orders'], ['/admin/dashboard']])(
      'GET %s sin Authorization ⇒ 401, no 422',
      async (path) => {
        const res = await h.api('GET', path);
        expect(res.status).toBe(401);
        expect(res.body?.error?.code ?? res.body?.code).toBe('UNAUTHENTICATED');
      },
    );

    it('con token BASURA también 401 (las dos ramas del guard coinciden)', async () => {
      const res = await h.api('GET', '/vault/holdings', { token: 'basura.no.jwt' });
      expect(res.status).toBe(401);
    });

    it('una ruta pública sigue siendo anónima (no se endureció de más)', async () => {
      expect((await h.api('GET', '/catalog/cards?pageSize=1')).status).toBe(200);
    });
  });

  describe('cola de triage — `counts` con DATOS REALES, no solo en forma', () => {
    it('`GET /admin/pricing/pending` devuelve las DOS razones sembradas', async () => {
      const res = await h.api('GET', '/admin/pricing/pending?context=inventory', { token: adminToken });
      expect(res.status).toBe(200);
      expect(res.body.counts).toMatchObject({
        no_market: expect.any(Number),
        premium_at_floor: expect.any(Number),
      });
      // El seed siembra una de cada: son ESTADOS REALES de esas cartas (sin referencia / premium en el piso).
      expect(res.body.counts.no_market).toBeGreaterThanOrEqual(1);
      expect(res.body.counts.premium_at_floor).toBeGreaterThanOrEqual(1);
    });

    it('`?reason=` filtra la cola pero NO mueve los `counts` (§4.36.5c)', async () => {
      const all = await h.api('GET', '/admin/pricing/pending?context=inventory', { token: adminToken });
      const filtered = await h.api('GET', '/admin/pricing/pending?context=inventory&reason=premium_at_floor', {
        token: adminToken,
      });
      expect(filtered.status).toBe(200);
      for (const row of filtered.body.data) expect(row.reason).toBe('premium_at_floor');
      // Los counts describen LA COLA, no la página filtrada — si se movieran, mentirían justo cuando
      // el dueño filtra para triar.
      expect(filtered.body.counts).toEqual(all.body.counts);
    });

    it('la carta PREMIUM con mercado absurdo NO se publica y NO aparece en Compra (guardarraíl)', async () => {
      const res = await h.api('GET', `/catalog/cards?q=${encodeURIComponent(E2E_CARDS.floorpremium.name)}&pageSize=20`);
      expect(res.status).toBe(200);
      const found = res.body.data.find((g: { card: { name: string } }) => g.card.name === E2E_CARDS.floorpremium.name);
      expect(found).toBeUndefined();
    });

    it('S48-M1 en vivo: cotizar esa carta en COMPRA no apaga el aviso del eje de VENTA', async () => {
      const card = await h.prisma.card.findUnique({ where: { externalId: E2E_CARDS.floorpremium.externalId } });
      // El eje de COMPRA resuelve (300c > bin 100c), así que su cotización pública es legítima…
      const quote = await h.api('POST', '/buylist/quote', {
        json: { cardId: card!.id, productType: 'raw', rawCondition: 'NM', finish: 'normal' },
      });
      expect(quote.status).toBe(200);
      expect(quote.body.quote.quotedPriceCents).toBeGreaterThan(0);
      // …y la entrada abierta por VENTA sigue en pie (antes de v2.1.6 se cerraba en silencio).
      const open = await h.prisma.pendingPriceEntry.findFirst({
        where: { cardId: card!.id, status: 'open' },
      });
      expect(open).toMatchObject({ status: 'open', reason: 'premium_at_floor', context: 'inventory' });
    });
  });

  describe('el precio publicado sale de la CURVA (no de una regla por rareza)', () => {
    it('el listado y la ficha por-pieza coinciden al centavo con la pura', async () => {
      const inv = await h.prisma.inventoryItem.findUnique({ where: { folio: E2E_FOLIOS.listedCharizard } });
      const byId = await h.api('GET', `/catalog/listings/${inv!.id}`);
      expect(byId.status).toBe(200);
      expect(byId.body.salePriceCents).toBe(salePrice(E2E_CARDS.charizard.refNmCents!));
      expect(byId.body.priceBasis).toBe('market');
    });
  });
});

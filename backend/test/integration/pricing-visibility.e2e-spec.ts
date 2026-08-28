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
import {
  GROUPED_LISTING_KEYS as GROUPED_LISTING_KEYS_ALL,
  GROUPED_LISTING_SUMMARY_KEYS as GROUPED_LISTING_SUMMARY_KEYS_ALL,
} from '../helpers/dto-keys';

const salePrice = (marketCents: number) => resolveSaleFromCurve(marketCents, DEFAULT_PRICING_CURVE).cents as number;

/**
 * Claves EXACTAS de `GroupedListingDTO` para una pieza `raw` sin grading — el DTO de la **FICHA**
 * (`GroupedListingDetailResponse.listings[]`).
 *
 * ⚠️ **Se DERIVAN de la interfaz, no se escriben a mano** (v1.50.2, techlead). Antes esta lista era
 * literal, que es justamente lo que `helpers/dto-keys.ts` existe para impedir: una lista que puede
 * quedarse corta —literalmente B-1, un requerido que falta y nadie lo ve— o larga, sin que nada falle.
 * `keysOf<T>` obliga al COMPILADOR a exigir todas las claves de la interfaz, así que añadir un campo
 * al DTO y no declararlo allí no compila.
 *
 * El recorte de OPCIONALES sí va aquí, EXPLÍCITO y visible: en este escenario la pieza es `raw`, así
 * que `gradingCompany`/`gradeValue` no viajan (un opcional ausente DESAPARECE en JSON).
 */
const RAW_ABSENT = ['gradingCompany', 'gradeValue'];
const GROUPED_LISTING_KEYS = GROUPED_LISTING_KEYS_ALL.filter((k) => !RAW_ABSENT.includes(k));

/**
 * v2.1.9 (D2) — claves de `GroupedListingSummaryDTO`, el DTO de la **REJILLA**: el de arriba **menos**
 * `priceBasis` y `referenceValue` (que la interfaz ya excluye por tipo). §N.7 dice «SOLO fichas», y la
 * rejilla es la superficie de cosecha masiva: emitir `priceBasis` ahí publica un MAPA de qué cartas
 * llevan override manual.
 *
 * `gradingHighlight` se recorta además porque es OPCIONAL y su PRESENCIA **es** la elegibilidad: con
 * el dial del gancho en `off` (seed) el campo NO existe (§4.38e).
 */
const GROUPED_LISTING_SUMMARY_KEYS = GROUPED_LISTING_SUMMARY_KEYS_ALL.filter(
  (k) => !RAW_ABSENT.includes(k) && k !== 'gradingHighlight',
);

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

  describe('B-1 — el DTO de GRUPO de la FICHA trae `priceBasis` (era `undefined` en el 100%)', () => {
    /** Los grupos de la ficha de una carta, por nombre del fixture. */
    async function fichaListings(externalId: string) {
      const card = await h.prisma.card.findUnique({ where: { externalId } });
      const res = await h.api('GET', `/catalog/cards/${card!.id}`);
      expect(res.status).toBe(200);
      return res.body as { card: unknown; listings: any[]; units: any[] };
    }

    it('`GET /catalog/cards/:cardId` — el grupo del charizard trae `priceBasis: "market"`', async () => {
      const { listings } = await fichaListings(E2E_CARDS.charizard.externalId);
      expect(listings.length).toBeGreaterThan(0);
      // La condición EXACTA que evalúa el front para pintar «Valor de mercado».
      for (const g of listings) expect(g.priceBasis).toBe('market');
      expect(listings[0].salePriceCents).toBe(salePrice(E2E_CARDS.charizard.refNmCents!));
      // `units[]` es el ListingDTO por-pieza: ya lo traía, y se fija para que no se pierda.
      const { units } = await fichaListings(E2E_CARDS.charizard.externalId);
      for (const u of units) expect(u.priceBasis).toBeDefined();
    });

    it('la FORMA en el cable: conjunto EXACTO de claves del grupo de la FICHA', async () => {
      const { listings } = await fichaListings(E2E_CARDS.charizard.externalId);
      expect(Object.keys(listings[0]).sort()).toEqual(GROUPED_LISTING_KEYS);
    });

    it('un override manual POR PIEZA da `priceBasis: "override"` ⇒ el front NO pinta el bloque', async () => {
      // El seed publica esta carta con `listPriceCents` override (E2E-LST-0002).
      const { listings } = await fichaListings(E2E_CARDS.common.externalId);
      expect(listings[0].priceBasis).toBe('override');
      expect(listings[0].priceBasis === 'market').toBe(false); // el mercado NO produjo este precio
    });

    it('`referenceValue` público sigue SIN procedencia (S48-M2 no se rompió al arreglar B-1)', async () => {
      const { listings } = await fichaListings(E2E_CARDS.charizard.externalId);
      expect(Object.keys(listings[0].referenceValue).sort()).toEqual([
        'capturedDate',
        'referenceMxnCents',
        'status',
      ]);
      expect(listings[0].referenceValue).not.toHaveProperty('source');
      expect(listings[0].referenceValue).not.toHaveProperty('isManualOverride');
    });

    /**
     * v2.1.9 (D2) — **la regla de §N.7 se impone en el EMISOR, contra el backend VIVO.**
     *
     * Antes de este pase, un `curl` sin token a `GET /catalog/listings/<id>` devolvía
     * `priceBasis:"override"` **junto con el número de mercado** — el bloque exacto que la UI tiene
     * prohibido pintar. Era el PoC literal del pentester, y por eso se verifica **por HTTP**, sin
     * token, y sobre el JSON de la respuesta: el `iff` en las dos direcciones y a los dos niveles.
     */
    describe('D2 — el `iff` del número de mercado, por HTTP y sin token', () => {
      it('REJILLA `GET /catalog/cards`: ni `priceBasis` ni `referenceValue`, y la forma es la del summary', async () => {
        const res = await h.api('GET', `/catalog/cards?q=${encodeURIComponent(E2E_CARDS.charizard.name)}&pageSize=20`);
        expect(res.status).toBe(200);
        const group = res.body.data.find((g: { card: { name: string } }) => g.card.name === E2E_CARDS.charizard.name);
        expect(group).toBeDefined();
        expect(Object.keys(group).sort()).toEqual(GROUPED_LISTING_SUMMARY_KEYS);
        expect(group).not.toHaveProperty('priceBasis');
        expect(group).not.toHaveProperty('referenceValue');
        // Lo que la rejilla SÍ necesita sigue ahí (el recorte no apagó funcionalidad).
        expect(group.salePriceCents).toBe(salePrice(E2E_CARDS.charizard.refNmCents!));
      });

      it('FICHA con basis `market`: el número de mercado SÍ viaja (dirección «no lo mando nunca»)', async () => {
        const { listings } = await fichaListings(E2E_CARDS.charizard.externalId);
        expect(listings[0].priceBasis).toBe('market');
        expect(listings[0].referenceValue.referenceMxnCents).toBe(E2E_CARDS.charizard.refNmCents);
      });

      it('FICHA con basis `override`: `priceBasis` viaja, el NÚMERO no', async () => {
        const { listings } = await fichaListings(E2E_CARDS.common.externalId);
        expect(listings[0].priceBasis).toBe('override');
        expect(listings[0].referenceValue).toEqual({ status: expect.any(String) });
        expect(listings[0].referenceValue).not.toHaveProperty('referenceMxnCents');
      });

      it('`GET /catalog/listings/:id` SIN TOKEN — el PoC del pentester, cerrado', async () => {
        const { listings, units } = await fichaListings(E2E_CARDS.common.externalId);
        const overrideUnit = units.find((u: any) => u.priceBasis === 'override');
        expect(overrideUnit).toBeDefined();
        expect(listings[0].priceBasis).toBe('override');
        const res = await h.api('GET', `/catalog/listings/${overrideUnit.inventoryItemId}`);
        expect(res.status).toBe(200);
        // `priceBasis` se conserva (la UI lo OBEDECE); el número que tenía prohibido pintar, no.
        expect(res.body.priceBasis).toBe('override');
        expect(res.body.referenceValue).not.toHaveProperty('referenceMxnCents');
        expect(res.body.referenceValue).not.toHaveProperty('capturedDate');
      });
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

/**
 * v2.1.7 (§M2) — las dos rutas NORMADAS, contra Postgres real: **ningún endpoint devuelve una entidad
 * Prisma directamente**. Se verifica sobre el JSON que sale por HTTP, que es donde una columna del
 * schema se auto-publicaría.
 */
describe('E2E — §M2: rutas de pricing con forma DECLARADA', () => {
  let h2: E2EHarness;
  let admin: string;
  let cardId: string;

  const PRICE_HISTORY_KEYS = [
    'capturedDate',
    'gradeKey',
    'isManualOverride',
    'priceMxnCents',
    'productType',
    'source',
  ].sort();

  beforeAll(async () => {
    h2 = await E2EHarness.create();
    await seedE2E(h2.prisma);
    admin = await h2.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    const card = await h2.prisma.card.findUnique({ where: { externalId: E2E_CARDS.charizard.externalId } });
    cardId = card!.id;
  });

  afterAll(async () => {
    await h2?.close();
  });

  it('`GET /admin/pricing/card/:cardId` ⇒ `{ data: PriceHistoryEntryDTO[] }`, sin internos de fila', async () => {
    const res = await h2.api('GET', `/admin/pricing/card/${cardId}`, { token: admin });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['data']);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const row of res.body.data) {
      expect(Object.keys(row).sort()).toEqual(PRICE_HISTORY_KEYS);
      expect(row.capturedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/); // día, no instante
    }
  });

  it('`POST /admin/pricing/override` ⇒ `{ data }` proyectado — antes devolvía la fila COMPLETA', async () => {
    const res = await h2.api('POST', '/admin/pricing/override', {
      token: admin,
      json: { cardId, productType: 'raw', gradeKey: 'raw:NM', priceMxnCents: 123400, finish: 'normal' },
    });
    // v1.50.3-c (QA MENOR-1): el contrato norma `200` para este endpoint («Res `200` NORMADA en
    // v2.1.7»); `@Post` de Nest respondía `201` por default. El CUERPO ya era el normado.
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['data']);
    expect(Object.keys(res.body.data).sort()).toEqual(PRICE_HISTORY_KEYS);
    // Lo que el schema publicaba solo:
    for (const interno of ['id', 'priceUsdCents', 'fxRate', 'fxBufferPct', 'cardProductId', 'createdAt']) {
      expect(res.body.data).not.toHaveProperty(interno);
    }
    // Y el override SÍ surtió efecto (la proyección no rompió la escritura).
    expect(res.body.data).toMatchObject({ priceMxnCents: 123400, source: 'manual', isManualOverride: true });
  });

  it('`PATCH /admin/users/:id/status` ya NO devuelve `passwordHash` (auditoría de la norma)', async () => {
    const target = await h2.prisma.user.findUnique({ where: { email: E2E_USERS.customer2.email } });
    const res = await h2.api('PATCH', `/admin/users/${target!.id}/status`, {
      token: admin,
      json: { status: 'blocked' },
    });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('passwordHash');
    expect(Object.keys(res.body).sort()).toEqual(['createdAt', 'email', 'id', 'name', 'role', 'status']);
    // Se restaura para no dejar al usuario bloqueado en el seed compartido.
    await h2.api('PATCH', `/admin/users/${target!.id}/status`, { token: admin, json: { status: 'active' } });
  });
});

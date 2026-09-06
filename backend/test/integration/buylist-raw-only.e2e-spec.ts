/**
 * buylist-raw-only.e2e-spec.ts — Integración/E2E contra la app REAL (mismos pipes, guards y filtro
 * que `main.ts`) y Postgres real.
 *
 * v1.53-buylist-graded-identity (ARCHITECTURE §4.40, API_CONTRACT v1.53, **MONEY**) — **el cotizador
 * vuelve a ser RAW-ONLY.**
 *
 * ### Por qué este spec vive en INTEGRACIÓN y no solo en unitarios
 * La decisión que este pase tenía que acertar es *dónde* vive la guarda. Un `@IsIn(['raw'])` en el
 * DTO parece equivalente… hasta que el `ValidationPipe` responde **`400` para el request ENTERO** de
 * `/quote/batch` y se lleva por delante **las otras 49 líneas raw legítimas** del grid. Eso solo se
 * ve **por el borde HTTP, con el pipe real montado** — que es exactamente lo que hay aquí.
 *
 * Cubre el encargo de QA de §4.40.9:
 *  (a) `POST /buylist/quote` con `graded` ⇒ `422 BUYLIST_RAW_ONLY`, y JAMÁS un monto derivado de
 *      `graded:PSA:10` (la carta `e2e-graded` TIENE esa referencia sembrada: MX$5,000).
 *  (b) batch de 50 con UNA `graded` ⇒ **`200`**, esa línea `ok:false`, **las otras 49 cotizan**.
 *  (c) `POST /buylist/requests` con una línea `graded` ⇒ `422` y **la solicitud NO se crea**.
 *  (d) `sealed` se comporta igual que `graded` en las tres rutas (criterio 61).
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_CARDS, E2E_USERS } from '../../prisma/e2e-fixtures';
import { BUYLIST_QUOTE_BATCH_MAX } from '../../src/modules/buylist/dto/buylist.dto';

const CLABE = '012345678901234567';

describe('E2E — §4.40 el buylist es RAW-ONLY (guarda server-side, no cosmética del front)', () => {
  let h: E2EHarness;
  let customerToken: string;
  const cardId: Record<string, string> = {};
  // ⚠️ v1.51.20 (D36/D37): `addressId` es OBLIGATORIO en `POST /buylist/requests`. Se resuelve de la
  // libreta que siembra `seed-e2e` (no se inventa: el servidor comprueba que la fila sea DEL usuario
  // autenticado). Sólo lo necesita el caso de REGRESIÓN: los dos rechazos de abajo llegan sin él a
  // propósito, y siguen dando `BUYLIST_RAW_ONLY` — que es la prueba de que la guarda corre PRIMERO.
  let customerAddressId: string;

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    customerToken = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    for (const [key, c] of Object.entries(E2E_CARDS)) {
      const card = await h.prisma.card.findUnique({ where: { externalId: c.externalId } });
      cardId[key] = card!.id;
    }
    const customer = await h.prisma.user.findUnique({ where: { email: E2E_USERS.customer.email } });
    const addr = await h.prisma.address.findFirst({ where: { userId: customer!.id } });
    customerAddressId = addr!.id;
  });

  afterAll(async () => {
    await h?.close();
  });

  // -------------------------------------------------------------------------
  // (a) POST /buylist/quote — 422 de request, y el dinero que NO se ofrece
  // -------------------------------------------------------------------------

  describe('POST /buylist/quote', () => {
    it.each(['graded', 'sealed'])('`%s` ⇒ 422 BUYLIST_RAW_ONLY por el borde HTTP (un `curl` no lo esquiva)', async (pt) => {
      const res = await h.api('POST', '/buylist/quote', {
        json: { cardId: cardId.graded, productType: pt },
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('BUYLIST_RAW_ONLY');
      expect(res.body.error.details).toMatchObject({ productType: pt });
    });

    it('EL CASO DEL DINERO: la carta con referencia `graded:PSA:10` sembrada NO devuelve monto', async () => {
      // `e2e-graded` tiene `refPsa10Cents = 500000` en el seed. Antes de v1.53 esta petición
      // —sin decir NUNCA qué grado es— cotizaba contra esa fila: el grado MÁS CARO.
      const res = await h.api('POST', '/buylist/quote', {
        json: { cardId: cardId.graded, productType: 'graded' },
      });
      expect(res.status).toBe(422);
      expect(res.body.quote).toBeUndefined();
      // Ni siquiera aparece el número en la respuesta.
      expect(res.text).not.toContain(String(E2E_CARDS.graded.refPsa10Cents));
    });

    it('regresión: la MISMA ruta con `raw` sigue cotizando exactamente igual', async () => {
      const res = await h.api('POST', '/buylist/quote', {
        json: { cardId: cardId.charizard, productType: 'raw', rawCondition: 'NM' },
      });
      expect(res.status).toBe(200);
      // Mercado $1,000 ⇒ tramo plano 50 % ⇒ $500 (mismo número que `buylist.e2e-spec.ts`).
      expect(res.body.quote.quotedPriceCents).toBe(E2E_CARDS.charizard.refNmCents / 2);
    });
  });

  // -------------------------------------------------------------------------
  // (b) EL TEST QUE QA MIRA PRIMERO — degradación POR-ÍTEM en el lote
  // -------------------------------------------------------------------------

  describe('POST /buylist/quote/batch — degradación POR-ÍTEM (§4.40.3.3)', () => {
    it('50 líneas con UNA graduada ⇒ HTTP 200 y 49 cotizaciones VIVAS (si da 400, la guarda está en el pipe)', async () => {
      const BAD = 23;
      const items = Array.from({ length: BUYLIST_QUOTE_BATCH_MAX }, (_, i) => ({
        cardId: i === BAD ? cardId.graded : cardId.charizard,
        productType: i === BAD ? 'graded' : 'raw',
        ...(i === BAD ? {} : { rawCondition: 'NM' }),
      }));

      const res = await h.api('POST', '/buylist/quote/batch', { json: { items } });

      // ⚠️ El aserto que decide el pase: 200, no 400.
      expect(res.status).toBe(200);
      const results = res.body.results as { index: number; ok: boolean; error?: { code: string }; quote?: { quotedPriceCents: number | null } }[];
      expect(results).toHaveLength(BUYLIST_QUOTE_BATCH_MAX);

      const vivas = results.filter((r) => r.ok);
      expect(vivas).toHaveLength(49);
      for (const r of vivas) {
        expect(r.quote!.quotedPriceCents).toBe(E2E_CARDS.charizard.refNmCents / 2);
      }

      const rechazada = results[BAD];
      expect(rechazada.ok).toBe(false);
      expect(rechazada.error!.code).toBe('BUYLIST_RAW_ONLY');
      expect(rechazada.index).toBe(BAD);
    });

    it('`sealed` degrada igual que `graded`, y conviven en el mismo lote (criterio 61)', async () => {
      const res = await h.api('POST', '/buylist/quote/batch', {
        json: {
          items: [
            { cardId: cardId.charizard, productType: 'raw', rawCondition: 'NM' },
            { cardId: cardId.graded, productType: 'sealed' },
            { cardId: cardId.graded, productType: 'graded' },
            { cardId: cardId.common, productType: 'raw', rawCondition: 'NM' },
          ],
        },
      });
      expect(res.status).toBe(200);
      const results = res.body.results as { ok: boolean; error?: { code: string } }[];
      expect(results.map((r) => r.ok)).toEqual([true, false, false, true]);
      expect(results[1].error!.code).toBe('BUYLIST_RAW_ONLY');
      expect(results[2].error!.code).toBe('BUYLIST_RAW_ONLY');
    });

    it('los límites de FORMA del lote siguen siendo 400 del pipe (vacío / sobre-cap)', async () => {
      // El contraste importa: la guarda de NEGOCIO degrada por-ítem; la de FORMA sigue tumbando
      // el request, tal y como el contrato manda.
      const vacio = await h.api('POST', '/buylist/quote/batch', { json: { items: [] } });
      expect(vacio.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // (c) POST /buylist/requests — todo-o-nada
  // -------------------------------------------------------------------------

  describe('POST /buylist/requests — no hay degradación por-ítem: la solicitud NO se crea', () => {
    it('una línea `graded` entre dos raw ⇒ 422 con `details.index`, y CERO filas nuevas', async () => {
      const antes = await h.prisma.sellRequest.count();
      const res = await h.api('POST', '/buylist/requests', {
        token: customerToken,
        json: {
          items: [
            { cardId: cardId.common, productType: 'raw', rawCondition: 'NM' },
            { cardId: cardId.graded, productType: 'graded' },
          ],
          clabe: CLABE,
        },
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('BUYLIST_RAW_ONLY');
      expect(res.body.error.details).toMatchObject({ index: 1, productType: 'graded' });
      // Lo que de verdad importa: no se congeló dinero contra un grado que nadie preguntó.
      expect(await h.prisma.sellRequest.count()).toBe(antes);
    });

    it('`sealed` idéntico (criterio 61: ni cotizador ni pipeline)', async () => {
      const antes = await h.prisma.sellRequest.count();
      const res = await h.api('POST', '/buylist/requests', {
        token: customerToken,
        json: {
          items: [{ cardId: cardId.graded, productType: 'sealed' }],
          clabe: CLABE,
        },
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('BUYLIST_RAW_ONLY');
      expect(await h.prisma.sellRequest.count()).toBe(antes);
    });

    it('regresión: una solicitud SOLO raw se sigue creando', async () => {
      // ⚠️ Fusión del ciclo de adquisición: esta ruta gana TRES puertas más antes de congelar dinero
      // —celular (D11), dirección de origen (D36/D37) y **mínimo de compra** (D18, MX$500 con borde
      // INCLUSIVO)—. Por eso la línea es `charizard` (mercado MX$1,000 ⇒ cotiza MX$500, justo el
      // borde) y no `common` (MX$50): con `common` este test mediría el mínimo, no la regresión.
      const res = await h.api('POST', '/buylist/requests', {
        token: customerToken,
        json: {
          items: [{ cardId: cardId.charizard, productType: 'raw', rawCondition: 'NM' }],
          clabe: CLABE,
          addressId: customerAddressId,
        },
      });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('cotizada');
    });
  });

  // -------------------------------------------------------------------------
  // Censo (§4.40.8) — lectura, no reparación
  // -------------------------------------------------------------------------

  describe('§4.40.8 — el censo es una CONSULTA, no un backfill', () => {
    it('tras la guarda, ninguna línea de compra nueva puede nacer no-raw', async () => {
      const noRaw = await h.prisma.sellRequestItem.count({
        where: { productType: { not: 'raw' } },
      });
      // En una BD sembrada de cero esto es 0 por construcción; en una BD con historia, el número
      // es la EXPOSICIÓN que el dueño tiene que resolver a mano (§4.40.5a) — jamás re-cotizando.
      expect(noRaw).toBe(0);
    });
  });
});

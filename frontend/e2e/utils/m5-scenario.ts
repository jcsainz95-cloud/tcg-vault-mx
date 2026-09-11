import { IS_REAL, apiAs, apiAsOk } from './env';

/**
 * ─────────────────────────────────────────────────────────────────────────────────────
 * EL ESCENARIO DE §M5-S, AGNÓSTICO AL ENTORNO (contrato v1.68 · `POST /admin/buylist/:id/receive`
 * y `…/verify`).
 *
 * **Por qué existe — el hallazgo H-4 de QA.** `m5-transitions.spec.ts` era `mockOnly` con el motivo
 * *«el seed real no garantiza una `en_transito`»*. Eso era cierto **del seed** y falso **del
 * escenario**: QA lo refutó midiendo —sembró una `en_transito` y una `recibida` reales y condujo la
 * UI horneada contra el backend, obteniendo «Marcar recibida»=1 / «Iniciar verificación»=0 en
 * `en_transito` y 0/1 en `recibida`—. Un `mockOnly` sobre algo que **sí** se puede medir contra el
 * stack deja el gate vacío: el candado S-3 se verificaba solo contra los fixtures del propio front.
 *
 * **Cómo se siembra: por la API del contrato, los mismos actos que hace el back-office.** Ni SQL ni
 * fixtures. La cadena es exactamente la del ciclo (§M5, D20):
 *
 * ```
 *   POST /buylist/requests                      (cliente)  → cotizada
 *   POST /admin/buylist/:id/offer               (operador) → ofertada        [202 ⇒ authorize]
 *   POST /buylist/requests/:id/offer-response   (cliente)  → aceptada
 *   POST /admin/buylist/:id/confirm-shipment    (operador) → en_transito     ← D20: LO ÚNICO que mueve aquí
 *   POST /admin/buylist/:id/receive             (operador) → recibida
 * ```
 *
 * **Nada del seed se consume.** El vendedor es `customer2` y las filas son suyas: la `ofertada` que
 * el portal del vendedor necesita (`buylist-offer.spec.ts`, del `customer`) queda intacta — que es
 * justo la razón por la que *aquel* caso de «aceptar» se quedó en `needsSeed`.
 *
 * **RECICLA antes de crear, y eso tiene una razón medida.** El tope mensual se cobra **en el
 * intake**: cada `POST /buylist/requests` gasta MX$500 de un cupo de MX$10,000 al mes por vendedor.
 * Conducir por el ciclo una `cotizada` que ya existe **no cuesta cupo**, así que el escenario
 * reutiliza lo que haya y solo crea lo que falte. En un stack recién sembrado hay ~18 corridas de
 * margen, y el seed **purga** las solicitudes de los actores (⇒ re-sembrar restablece el cupo).
 * Cuando no queda ni cupo ni nada que reciclar, el spec se **salta con esa frase**, no falla: es
 * una condición del entorno, no un desacuerdo con el producto.
 *
 * **Nada se hornea.** El monto mínimo, el precio de la carta y el número de copias salen de las
 * respuestas del servidor (el `422 BUYLIST_MINIMUM_NOT_MET` trae `minimumCents`/`totalCents`), no de
 * una constante nuestra: el día que el dial cambie, el arnés lo sigue.
 * ─────────────────────────────────────────────────────────────────────────────────────
 */

/** Los tres actores del candado S-3: quién ofrece «Marcar recibida», quién «Verificar» y quién nada. */
export interface M5Scenario {
  /** `en_transito` — el ÚNICO estado que ofrece «Marcar recibida». */
  inTransit: string;
  /** `recibida` — el ÚNICO que ofrece «Iniciar verificación». */
  received: string;
  /** `cotizada` — el paso equivocado del que colgaba el botón antes de §M5-S. */
  quoted: string;
}

/** Ids de `src/lib/mock/fixtures.ts`. Cero I/O: en mock el escenario ya está en el bundle. */
const MOCK_SCENARIO: M5Scenario = {
  inTransit: 'sr-3007',
  received: 'sr-3002',
  quoted: 'sr-3004',
};

/**
 * El dato NO se pudo sembrar por una razón del ENTORNO (ninguna carta del catálogo cotiza, la
 * libreta del vendedor está vacía…). Se distingue de un fallo de verdad para que el spec pueda
 * saltarse **con su razón impresa** en vez de pintar un rojo que no significa nada — y para que un
 * fallo de verdad **sí** se vea rojo.
 */
export class M5SeedUnavailable extends Error {}

/**
 * ⚠️ **El VENDEDOR de este escenario es `customer2`, no el `customer` de siempre.** Medido
 * (2026-09-11, stack `1522b45`): el tope mensual de compra es POR VENDEDOR y lo consumen todas las
 * suites que crean solicitudes; el `customer` llegó a `monthUsed = 960,000` de `capCents =
 * 1,000,000` y el intake empezó a responder `422 BUYLIST_LIMIT_EXCEEDED`. `customer2` ya existe en
 * el seed con su propia dirección de recolección, así que sembrar aquí no le quita cupo al actor
 * que COMPRA (ni al revés).
 */
const SELLER = 'customer2' as const;

/** Dirección de origen del vendedor (`GET /users/me/addresses`, §6: `addressId` es OBLIGATORIO). */
async function pickupAddressId(): Promise<string> {
  const book = await apiAsOk<{ data: { id: string; isDefault?: boolean }[] }>(
    SELLER,
    'GET',
    '/users/me/addresses',
  );
  const addr = book.data.find((a) => a.isDefault) ?? book.data[0];
  if (!addr) {
    throw new M5SeedUnavailable('el vendedor del seed no tiene ninguna dirección en su libreta');
  }
  return addr.id;
}

/**
 * La carta raw **más cara** del catálogo publicado. No es estética: el intake exige un mínimo de
 * compra, y empezar por la más cara mantiene la solicitud en una o dos líneas en vez de doscientas.
 * El precio de venta es solo el criterio de ORDEN — lo que decide cuántas copias hacen falta es el
 * `422` del servidor, más abajo.
 */
async function mostValuableRawCardId(): Promise<string> {
  const catalog = await apiAsOk<{
    data: { card: { id: string }; productType: string; salePriceCents: number | null }[];
  }>(SELLER, 'GET', '/catalog/cards?pageSize=50');
  const raw = catalog.data
    .filter((row) => row.productType === 'raw' && typeof row.salePriceCents === 'number')
    .sort((a, b) => (b.salePriceCents ?? 0) - (a.salePriceCents ?? 0));
  if (raw.length === 0) {
    throw new M5SeedUnavailable('el catálogo publicado no tiene ninguna carta raw con precio');
  }
  return raw[0].card.id;
}

interface CreatedRequest {
  sellRequestId: string;
  itemIds: string[];
}

/**
 * Crea una solicitud `cotizada` DESECHABLE con las copias que hagan falta para pasar el mínimo.
 *
 * ⚠️ El número de copias **lo dice el servidor**: se intenta con una y, si responde
 * `422 BUYLIST_MINIMUM_NOT_MET`, se lee `minimumCents` y `totalCents` (lo que vale UNA copia) y se
 * reintenta con `ceil(minimum / unidad)`. Calcularlo con un mínimo horneado aquí sería otra fuente
 * para un hecho del que el backend ya es dueño.
 */
async function createQuotedRequest(): Promise<CreatedRequest> {
  const addressId = await pickupAddressId();
  const cardId = await mostValuableRawCardId();
  const line = { cardId, productType: 'raw' as const, rawCondition: 'NM', finish: 'normal' };
  // §6 (v1.15): `clabe` es opcional **si hay una en archivo**. `customer2` no la tiene todavía
  // (`422 CLABE_REQUIRED`, medido), así que el arnés manda la misma CLABE de prueba que ya teclea
  // el smoke de vender (`buylist.spec.ts`): el backend la cifra en su KYC y a partir de ahí el
  // fallback server-side la resuelve sola.
  const clabe = '002010077777777771';

  const create = (copies: number) =>
    apiAs<{
      sellRequestId: string;
      items: { id: string }[];
      error?: { code: string; details?: { minimumCents?: number; totalCents?: number } };
    }>(SELLER, 'POST', '/buylist/requests', {
      items: Array.from({ length: copies }, () => line),
      addressId,
      clabe,
    });

  let res = await create(1);
  if (res.status === 422) {
    const body = res.body as unknown as { error?: { code?: string; details?: Record<string, number> } };
    const details = body.error?.details ?? {};
    const minimum = details.minimumCents;
    const unit = details.totalCents;
    // El tope MENSUAL del vendedor no es un fallo del producto: es cupo agotado en ESTE entorno y
    // en ESTE mes (lo consumen todas las suites que compran). Se distingue para que el spec se
    // salte con la cifra impresa en vez de pintar un rojo que no habla de §M5-S.
    if (body.error?.code === 'BUYLIST_LIMIT_EXCEEDED') {
      const d = body.error.details ?? {};
      throw new M5SeedUnavailable(
        `el cupo MENSUAL del vendedor está agotado en este entorno (cap ${d.capCents}, quedaría en ` +
          `${d.wouldBeCents}) y no quedan solicitudes que reciclar. Se restablece re-sembrando el stack ` +
          `(\`./scripts/stack-native.sh up --seed\`): el seed PURGA las solicitudes de los actores y con ` +
          `ellas el acumulado del mes.`,
      );
    }
    if (body.error?.code !== 'BUYLIST_MINIMUM_NOT_MET' || !minimum || !unit) {
      throw new Error(`POST /buylist/requests rechazó la siembra: ${JSON.stringify(res.body).slice(0, 300)}`);
    }
    res = await create(Math.ceil(minimum / unit));
  }
  if (res.status !== 201) {
    throw new Error(`POST /buylist/requests respondió ${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`);
  }
  return { sellRequestId: res.body.sellRequestId, itemIds: res.body.items.map((i) => i.id) };
}

/** `cotizada → ofertada → aceptada → en_transito`, por los actos del contrato. */
async function driveToInTransit(req: CreatedRequest): Promise<void> {
  const offer = await apiAs<{ requiresAuthorization?: boolean }>(
    'admin',
    'POST',
    `/admin/buylist/${req.sellRequestId}/offer`,
    { lines: req.itemIds.map((itemId) => ({ itemId, decision: 'buy' })) },
  );
  if (offer.status !== 200 && offer.status !== 202) {
    throw new Error(`POST …/offer respondió ${offer.status}: ${JSON.stringify(offer.body).slice(0, 300)}`);
  }
  // `202` = la oferta quedó PREPARADA y la manda el súper-admin (D24, criterio 143). El actor
  // `admin` del seed es `super_admin`, así que puede cerrar los dos pasos.
  if (offer.status === 202) {
    await apiAsOk('admin', 'POST', `/admin/buylist/${req.sellRequestId}/offer/authorize`);
  }
  await apiAsOk(SELLER, 'POST', `/buylist/requests/${req.sellRequestId}/offer-response`, {
    decision: 'accept',
  });
  // D20: `confirm-shipment` es LO ÚNICO que mueve a `en_transito`. La guía no se captura a
  // propósito — el backend lo cuenta como `guideMissing` en la bitácora y **no bloquea**.
  const confirmed = await apiAsOk<{ status: string }>(
    'admin',
    'POST',
    `/admin/buylist/${req.sellRequestId}/confirm-shipment`,
    {},
  );
  if (confirmed.status !== 'en_transito') {
    throw new Error(`confirm-shipment dejó la solicitud en «${confirmed.status}», no en «en_transito»`);
  }
}

/**
 * Las solicitudes que YA tiene el vendedor, por estado (`GET /buylist/requests`, lista propia).
 *
 * ⚠️ **Es la pieza que evita que este gate se apague solo.** Medido (2026-09-11, stack `1522b45`):
 * el tope mensual se cobra **en el intake**, así que cada `POST /buylist/requests` gasta MX$500 de
 * un cupo de MX$10,000 al mes — veinte solicitudes y el vendedor queda capado (y el gate, mudo).
 * **Conducir una `cotizada` que ya existe hasta `en_transito` no cuesta cupo**: son actos del ciclo
 * sobre una fila ya contada. Por eso el escenario RECICLA primero y solo crea cuando no queda nada
 * que reciclar. *Un arnés que solo funciona las primeras corridas es un test que se apaga solo.*
 */
async function sellerPool(): Promise<Map<string, CreatedRequest[]>> {
  const res = await apiAsOk<{
    data: { sellRequestId: string; status: string; items: { id: string }[] }[];
  }>(SELLER, 'GET', '/buylist/requests?pageSize=100');
  const pool = new Map<string, CreatedRequest[]>();
  for (const r of res.data) {
    const list = pool.get(r.status) ?? [];
    list.push({ sellRequestId: r.sellRequestId, itemIds: r.items.map((i) => i.id) });
    pool.set(r.status, list);
  }
  return pool;
}

/**
 * Saca UNA fila del estado pedido, **rotando por worker**: dos workers que empezaran siempre por la
 * primera se pelearían la misma solicitud (uno la recibe, al otro le desaparece de la pestaña).
 * `TEST_WORKER_INDEX` lo pone Playwright.
 */
function takeFrom(pool: Map<string, CreatedRequest[]>, status: string): CreatedRequest | null {
  const list = pool.get(status);
  if (!list || list.length === 0) return null;
  const offset = Number(process.env.TEST_WORKER_INDEX ?? 0) % list.length;
  const [picked] = list.splice(offset, 1);
  return picked ?? null;
}

/**
 * El escenario completo. En MOCK devuelve los ids del fixture (cero I/O); en REAL RECICLA lo que el
 * vendedor ya tenga y conduce por la API del contrato lo que falte.
 *
 * Lanza `M5SeedUnavailable` si el entorno no da para sembrarlo —cupo mensual agotado, catálogo sin
 * cartas, libreta vacía— (⇒ el spec se salta con la razón impresa) y `Error` si algo del ciclo falla
 * de verdad (⇒ rojo, que es lo que el gate quiere ver).
 */
export async function m5Scenario(): Promise<M5Scenario> {
  if (!IS_REAL) return MOCK_SCENARIO;

  const pool = await sellerPool();
  // ⚠️ Todo EN SERIE. Medido: dos `POST /buylist/requests` simultáneos del MISMO vendedor hacen que
  // el backend responda `500` (`PrismaClientKnownRequestError: write conflict or deadlock`,
  // `buylist.service.ts:1637`, transacción SERIALIZABLE del tope mensual). Es un hallazgo anotado
  // para backend; el arnés no lo provoca porque un vendedor real no manda dos en el mismo ms.
  const quoted = takeFrom(pool, 'cotizada') ?? (await createQuotedRequest());

  let inTransit = takeFrom(pool, 'en_transito');
  if (!inTransit) {
    inTransit = takeFrom(pool, 'cotizada') ?? (await createQuotedRequest());
    await driveToInTransit(inTransit);
  }

  let received = takeFrom(pool, 'recibida');
  if (!received) {
    received = takeFrom(pool, 'cotizada') ?? (await createQuotedRequest());
    await driveToInTransit(received);
    const receivedRes = await apiAsOk<{ status: string }>(
      'admin',
      'POST',
      `/admin/buylist/${received.sellRequestId}/receive`,
    );
    if (receivedRes.status !== 'recibida') {
      throw new Error(`receive dejó la solicitud en «${receivedRes.status}», no en «recibida»`);
    }
  }

  return {
    inTransit: inTransit.sellRequestId,
    received: received.sellRequestId,
    quoted: quoted.sellRequestId,
  };
}

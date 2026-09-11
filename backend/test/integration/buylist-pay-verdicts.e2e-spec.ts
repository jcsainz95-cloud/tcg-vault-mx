/**
 * `buylist-pay-verdicts.e2e-spec.ts` — **§M5-V / `BL-45`: NO SE PAGA LO QUE NO SE HA JUZGADO.**
 * Propiedad: backend. `API_CONTRACT` §M5-V (asserts 1..9 de §M5-V.8), `ARCHITECTURE` §9 `BL-45`.
 *
 * ### ⚠️ POR QUÉ ESTA SUITE EXISTE Y POR QUÉ ES DE INTEGRACIÓN, NO UNITARIA
 * `BL-45` **no se pudo ver con 3.612 pruebas unitarias en verde**, y la razón es estructural: el
 * agujero de dinero nace de **la composición de cuatro verbos** (`offer` con cherry-pick →
 * `receive` → `verify` → `itemDecision(reject)`) y de **una auto-transición que NO dispara**
 * (`maybeAutoRejectRequest` exige que **TODO** ítem esté `rechazada`, y la línea `skip` se queda en
 * `verificacion`). Un mock de Prisma confirma la forma del código; **sólo el motor real, con las
 * cuatro escrituras encadenadas, produce la fila que paga la oferta íntegra por CERO cartas.**
 *
 * **Se midió así antes de escribir una línea de arreglo** (`docs/BACKEND_NOTES.md` §0.45.1): la
 * fila resultante fue `status='pagada'`, `approvedTotalCents=null`, `offerGrossCents=50000`,
 * `payoutNetCents=32000` — **MX$320 por cero cartas.** Esta suite es esa medición, congelada.
 *
 * ### NORMA PARA QUIEN AÑADA CASOS
 * **Nada de mocks de Prisma.** Todo por HTTP, con guards, `ValidationPipe` y Postgres real. **Y nada
 * de sembrar el escenario**: si el agujero se pudiera montar sólo sembrando, la gravedad sería otra
 * — el punto es que **se llega por la API, con el ciclo normal y sin rol extraordinario**.
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_CARDS, E2E_USERS } from '../../prisma/e2e-fixtures';

/** CLABE válida (18 dígitos). */
const CLABE = '012345678901234567';

describe('E2E — §M5-V: no se paga lo que no se ha juzgado (BL-45)', () => {
  let h: E2EHarness;
  let customerToken: string;
  let customer2Token: string;
  let address2Id: string;
  let operatorToken: string;
  let adminToken: string;
  let charizardId: string;
  let addressId: string;
  let customerId: string;

  /**
   * El vendedor con el que se monta un caso. **El tope AML es POR VENDEDOR y el intake lo consume
   * al CREAR**, así que un caso nuevo sobre el `customer` le quita presupuesto a todos los de este
   * fichero: los casos añadidos después van con `SEGUNDO` para no desplazar a nadie.
   */
  type Vendedor = { token: string; addressId: string };
  const PRIMERO = (): Vendedor => ({ token: customerToken, addressId });
  const SEGUNDO = (): Vendedor => ({ token: customer2Token, addressId: address2Id });

  /** Crea una solicitud del vendedor dado con `n` líneas físicas de la misma carta (§4.16b). */
  async function createRequest(n: number, quien: Vendedor = PRIMERO()): Promise<string> {
    const res = await h.api('POST', '/buylist/requests', {
      token: quien.token,
      json: {
        items: Array.from({ length: n }, () => ({
          cardId: charizardId,
          productType: 'raw' as const,
          rawCondition: 'NM' as const,
        })),
        clabe: CLABE,
        addressId: quien.addressId,
      },
    });
    expect(res.status).toBe(201);
    return (res.body as { sellRequestId: string }).sellRequestId;
  }

  async function itemIds(srId: string): Promise<string[]> {
    const detail = await h.api('GET', `/admin/buylist/${srId}`, { token: operatorToken });
    expect(detail.status).toBe(200);
    return (detail.body as { items: { id: string }[] }).items.map((i) => i.id);
  }

  async function adminDetail(srId: string) {
    const res = await h.api('GET', `/admin/buylist/${srId}`, { token: adminToken });
    expect(res.status).toBe(200);
    return res.body as {
      status: string;
      isPayable: boolean;
      pendingDecisionItemCount: number;
      approvedTotalCents: number | null;
      offerGrossCents: number | null;
      offerShippingFeeCents: number | null;
      payoutNetCents: number | null;
      quotedTotalCents: number | null;
      items: { id: string; itemStatus: string; offerDecision: string | null }[];
    };
  }

  /**
   * Lleva una solicitud del ciclo hasta `verificacion` **por la puerta**: ofertar (con las
   * decisiones que se le pasen), aceptar, recibir y verificar. Devuelve los ids de sus líneas.
   */
  async function upToVerification(
    lines: ('buy' | 'skip')[],
    quien: Vendedor = PRIMERO(),
  ): Promise<{ srId: string; ids: string[] }> {
    const srId = await createRequest(lines.length, quien);
    const ids = await itemIds(srId);
    const offer = await h.api('POST', `/admin/buylist/${srId}/offer`, {
      token: operatorToken,
      json: { lines: ids.map((itemId, i) => ({ itemId, decision: lines[i] })) },
    });
    expect(offer.status).toBe(200);
    const accept = await h.api('POST', `/buylist/requests/${srId}/offer-response`, {
      token: quien.token,
      json: { decision: 'accept' },
    });
    expect(accept.status).toBe(200);
    // v1.68 · §M5-S: `receive` exige `en_transito` ⇒ el paso 4 (`confirm-shipment`, sin guía) va antes.
    expect(
      (await h.api('POST', `/admin/buylist/${srId}/confirm-shipment`, { token: operatorToken, json: {} })).status,
    ).toBe(200);
    expect((await h.api('POST', `/admin/buylist/${srId}/receive`, { token: operatorToken })).status).toBe(200);
    expect((await h.api('POST', `/admin/buylist/${srId}/verify`, { token: operatorToken })).status).toBe(200);
    return { srId, ids };
  }

  function pay(srId: string, ref: string) {
    return h.api('POST', `/admin/buylist/${srId}/pay-spei`, {
      token: adminToken,
      json: { speiReference: ref },
    });
  }

  /** La fila TAL COMO QUEDÓ EN POSTGRES: es lo que se afirma, no el DTO de la respuesta. */
  async function rowOf(srId: string) {
    const r = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
    return {
      status: r!.status,
      approvedTotalCents: r!.approvedTotalCents,
      offerGrossCents: r!.offerGrossCents,
      offerShippingFeeCents: r!.offerShippingFeeCents,
      payoutNetCents: r!.payoutNetCents,
      paidAt: r!.paidAt,
      closedAt: r!.closedAt,
      speiReference: r!.speiReference,
    };
  }

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    customerToken = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    customer2Token = await h.login(E2E_USERS.customer2.email, E2E_USERS.customer2.password);
    operatorToken = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    const card = await h.prisma.card.findUnique({ where: { externalId: E2E_CARDS.charizard.externalId } });
    charizardId = card!.id;
    const u = await h.prisma.user.findUnique({ where: { email: E2E_USERS.customer.email } });
    customerId = u!.id;
    const addr = await h.prisma.address.findFirst({ where: { userId: customerId } });
    addressId = addr!.id;
    const u2 = await h.prisma.user.findUnique({ where: { email: E2E_USERS.customer2.email } });
    const addr2 = await h.prisma.address.findFirst({ where: { userId: u2!.id } });
    address2Id = addr2!.id;
  });

  afterAll(async () => {
    await h?.close();
  });

  // ===========================================================================================
  // ASSERT 1 — el ciclo completo sin decidir NADA
  // ===========================================================================================
  describe('assert 1 — `pay-spei` sin ningún veredicto ⇒ 422 ITEMS_NOT_DECIDED, CERO escritura', () => {
    it('nombra las líneas `buy` y no toca ni una columna de dinero', async () => {
      const { srId, ids } = await upToVerification(['buy']);
      const antes = await rowOf(srId);

      const res = await pay(srId, 'SPEI-V-A1');
      expect(res.status).toBe(422);
      expect((res.body as any).error.code).toBe('ITEMS_NOT_DECIDED');
      expect((res.body as any).error.details.sellRequestId).toBe(srId);
      expect((res.body as any).error.details.pendingDecisionItemIds).toEqual(ids);

      // ⚠️ **Cero escritura**, verificado contra la BD y no contra el DTO: el `422` de un verbo de
      // dinero que hubiera dejado `paidAt` a medias sería peor que el `200`.
      expect(await rowOf(srId)).toEqual(antes);
      expect((await rowOf(srId)).paidAt).toBeNull();
      expect((await rowOf(srId)).speiReference).toBeNull();
      expect((await rowOf(srId)).payoutNetCents).toBeNull();
      expect((await rowOf(srId)).closedAt).toBeNull();
    });

    // ⚠️ ASSERT 8 — la señal y la guarda no pueden discrepar.
    it('assert 8 — `isPayable: false` y `pendingDecisionItemCount > 0` en el DTO admin', async () => {
      const { srId } = await upToVerification(['buy', 'buy']);
      const d = await adminDetail(srId);
      expect(d.status).toBe('verificacion');
      expect(d.isPayable).toBe(false);
      expect(d.pendingDecisionItemCount).toBe(2);
    });

    it('⛔ `pendingDecisionItemCount` NO viaja al vendedor (la lista de exclusión pasa de 3 a 4)', async () => {
      const { srId } = await upToVerification(['buy']);
      const mio = await h.api('GET', `/buylist/requests/${srId}`, { token: customerToken });
      expect(mio.status).toBe(200);
      for (const campo of ['pendingDecisionItemCount', 'isPayable', 'paidBy', 'closedAt']) {
        expect({ campo, presente: campo in (mio.body as object) }).toEqual({ campo, presente: false });
      }
    });
  });

  // ===========================================================================================
  // ASSERT 2 — parcial: nombra el id QUE FALTA, no «faltan veredictos»
  // ===========================================================================================
  it('assert 2 — 3 líneas `buy`, 2 decididas, 1 sin veredicto ⇒ 422 con ESE id', async () => {
    const { srId, ids } = await upToVerification(['buy', 'buy', 'buy']);
    const ap = await h.api('PATCH', `/admin/buylist/items/${ids[0]}/decision`, {
      token: operatorToken,
      json: { decision: 'approve' },
    });
    expect(ap.status).toBe(200);
    const rj = await h.api('PATCH', `/admin/buylist/items/${ids[1]}/decision`, {
      token: operatorToken,
      json: { decision: 'reject', reason: 'no llega en NM: whitening en los bordes' },
    });
    expect(rj.status).toBe(200);

    // ⚠️ Aquí `approvedTotalCents` **NO es null** (una línea aprobada ya lo pobló) ⇒ V-a pasaría y
    // el pago saldría. **Es el caso que distingue V-b de V-a**: escribir V-b como
    // «approvedTotalCents IS NOT NULL» deja este pago en `200` con una carta sin juzgar.
    const d = await adminDetail(srId);
    expect(d.approvedTotalCents).not.toBeNull();
    expect(d.pendingDecisionItemCount).toBe(1);
    expect(d.isPayable).toBe(false);

    const res = await pay(srId, 'SPEI-V-A2');
    expect(res.status).toBe(422);
    expect((res.body as any).error.code).toBe('ITEMS_NOT_DECIDED');
    expect((res.body as any).error.details.pendingDecisionItemIds).toEqual([ids[2]]);
    expect((await rowOf(srId)).paidAt).toBeNull();
  });

  // ===========================================================================================
  // ASSERT 2-bis — ⭐ CONTRA-CASO OBLIGATORIO: el camino NORMAL del ciclo tiene que poder pagarse
  // ===========================================================================================
  it('assert 2-bis — cherry-pick (`skip` en `verificacion`) + todas las `buy` aprobadas ⇒ 200, se paga', async () => {
    const { srId, ids } = await upToVerification(['buy', 'skip']);
    const ap = await h.api('PATCH', `/admin/buylist/items/${ids[0]}/decision`, {
      token: operatorToken,
      json: { decision: 'approve' },
    });
    expect(ap.status).toBe(200);

    // ⚠️ **LA PREMISA, MEDIDA Y NO SUPUESTA:** la línea `skip` se queda en `verificacion` —no en un
    // estado de veredicto— y **nunca podrá aprobarse**. Si V-b no filtrara por `offerDecision='buy'`,
    // ESTA línea bloquearía el pago y **toda oferta con cherry-pick sería impagable**.
    const skip = await h.prisma.sellRequestItem.findUnique({ where: { id: ids[1] } });
    expect(skip!.offerDecision).toBe('skip');
    expect(['cotizada', 'recibida', 'verificacion']).toContain(skip!.itemStatus);
    expect(['aprobada', 'rechazada', 'convertida_inventario']).not.toContain(skip!.itemStatus);

    const d = await adminDetail(srId);
    expect(d.pendingDecisionItemCount).toBe(0);
    expect(d.isPayable).toBe(true);

    const res = await pay(srId, 'SPEI-V-A2BIS');
    expect(res.status).toBe(200);
    const fila = await rowOf(srId);
    expect(fila.status).toBe('pagada');
    expect(fila.approvedTotalCents).toBe(50_000);
    expect(fila.payoutNetCents).toBe(50_000 - 18_000);
  });

  // ===========================================================================================
  // ASSERT 3 — ⛔ EL AGUJERO DE DINERO, POR LA API Y SIN SEMBRAR NADA
  // ===========================================================================================
  it('assert 3 — cherry-pick + TODAS las `buy` rechazadas ⇒ 422 y NO sale un peso', async () => {
    const { srId, ids } = await upToVerification(['buy', 'skip']);
    const rj = await h.api('PATCH', `/admin/buylist/items/${ids[0]}/decision`, {
      token: operatorToken,
      json: { decision: 'reject', reason: 'no llega en NM: dobleces en la esquina inferior' },
    });
    expect(rj.status).toBe(200);

    // ⚠️⚠️ **EL MECANISMO ENTERO, AFIRMADO PASO A PASO** — sin esto el caso pasaría por casualidad
    // el día que la auto-transición cambie:
    //  (1) la auto-transición a `rechazada` **NO dispara**: exige que TODO ítem esté `rechazada` y
    //      la `skip` se quedó en `verificacion` ⇒ cuenta como no-rechazada;
    //  (2) la solicitud sigue **viva y en estado pagable**, con `receivedAt`/`verifiedAt` sellados;
    //  (3) `approvedTotalCents` es **`null`** (ningún ítem tiene `approvedPriceCents`)
    //      ⇒ `brutoConsumado` caería a `offerGrossCents` ⇒ `max(0, 50000 − 18000) = 32000`.
    const fila = await rowOf(srId);
    expect(fila.status).toBe('verificacion');
    expect(fila.approvedTotalCents).toBeNull();
    expect(fila.offerGrossCents).toBe(50_000);
    expect(fila.offerShippingFeeCents).toBe(18_000);
    const skip = await h.prisma.sellRequestItem.findUnique({ where: { id: ids[1] } });
    expect(skip!.itemStatus).not.toBe('rechazada');

    // ⚠️ V-b **no lo ve**: la única línea `buy` SÍ tiene veredicto (`rechazada`). Lo que lo cierra es
    // **V-a**, y por eso V-a no es un cinturón: es la única de las dos que tapa este agujero.
    const d = await adminDetail(srId);
    expect(d.pendingDecisionItemCount).toBe(0);

    // ⚠️ **EL PAGO SE INTENTA ANTES DE MIRAR LA SEÑAL, y el orden es deliberado:** si alguien quita
    // V-a, lo primero que este caso tiene que gritar es **«salieron MX$320 por cero cartas»**, no
    // «un booleano de la UI no coincide». *El aserto que primero se pone rojo es el que va a leer
    // quien rompa esto.*
    const res = await pay(srId, 'SPEI-V-A3');
    expect(res.status).toBe(422);
    expect((res.body as any).error.code).toBe('VALIDATION_ERROR');
    const despues = await rowOf(srId);
    expect(despues.paidAt).toBeNull();
    expect(despues.payoutNetCents).toBeNull();
    expect(despues.speiReference).toBeNull();
    expect(despues.status).toBe('verificacion');
    // *Negación exacta del criterio 140: cero cartas compradas ⇒ cero pesos.*
    // Y la señal tampoco miente (assert 8 para esta fila).
    expect(d.isPayable).toBe(false);
  });

  // ===========================================================================================
  // ASSERT 4 + 5 + 6 — el camino feliz, el COGS que ata el pago con la mercancía, y la equivalencia
  // ===========================================================================================
  describe('assert 4/5/6 — se decide TODO, se paga, y cada línea comprada ENTRA al inventario', () => {
    let srId: string;
    let ids: string[];

    it('assert 4 — decidir todas ⇒ 200 con `approvedTotalCents = Σ offeredPriceCents` de las `buy` aprobadas', async () => {
      const r = await upToVerification(['buy', 'buy', 'skip']);
      srId = r.srId;
      ids = r.ids;
      for (const id of [ids[0], ids[1]]) {
        const ap = await h.api('PATCH', `/admin/buylist/items/${id}/decision`, {
          token: operatorToken,
          json: { decision: 'approve' },
        });
        expect(ap.status).toBe(200);
        expect((ap.body as any).approvedPriceCents).toBe(50_000);
      }
      const res = await pay(srId, 'SPEI-V-A4');
      expect(res.status).toBe(200);
      const fila = await rowOf(srId);
      expect(fila.status).toBe('pagada');
      expect(fila.approvedTotalCents).toBe(100_000);
      expect(fila.offerGrossCents).toBe(100_000);
      expect(fila.payoutNetCents).toBe(100_000 - 18_000);
    });

    it('⭐ assert 5 — `convert-to-inventory` de CADA línea comprada ⇒ 200 con `acquisitionCostCents = offeredPriceCents`', async () => {
      // **Es el assert que ata el pago con el COGS, y antes de v1.61 no existía.** Sin V-b, este
      // mismo E2E muere aquí con `422 ITEM_NOT_APPROVED` sobre mercancía **ya pagada** que la API no
      // puede rescatar por ninguna ruta (`itemDecision` responde `409 NO_LIVE_ADJUSTMENT`).
      for (const id of [ids[0], ids[1]]) {
        const conv = await h.api('POST', `/admin/buylist/items/${id}/convert-to-inventory`, {
          token: operatorToken,
          json: {},
        });
        expect(conv.status).toBe(200);
        const inv = await h.prisma.inventoryItem.findUnique({
          where: { id: (conv.body as { inventoryItemId: string }).inventoryItemId },
        });
        const linea = await h.prisma.sellRequestItem.findUnique({ where: { id } });
        expect(inv!.acquisitionCostCents).toBe(linea!.offeredPriceCents);
        expect(inv!.acquisitionCostCents).toBe(50_000);
        expect(linea!.itemStatus).toBe('convertida_inventario');
      }
      // La `skip` sigue sin poder convertirse, y eso es lo correcto: no la compramos.
      const noComprada = await h.api('POST', `/admin/buylist/items/${ids[2]}/convert-to-inventory`, {
        token: operatorToken,
        json: {},
      });
      expect(noComprada.status).toBe(422);
      expect((noComprada.body as any).error.code).toBe('ITEM_NOT_APPROVED');
    });

    it('⭐ assert 6 — INVARIANTE DE EQUIVALENCIA: en TODA fila pagada por la API, `brutoConsumado ≡ approvedTotalCents`', async () => {
      // **La mutación #11 atacada por el otro lado.** No mira una fila: barre **todas** las que esta
      // suite pagó. `brutoConsumado = approvedTotalCents ?? offerGrossCents ?? quotedTotalCents ?? 0`
      // ⇒ afirmar que el primer término nunca es `null` es afirmar que los otros dos son
      // inalcanzables, y con ello que el reporte (`_sum(approvedTotalCents)`), el payout y el
      // acumulado AML leen **el mismo número**.
      const pagadas = await h.prisma.sellRequest.findMany({
        where: { userId: customerId, paidAt: { not: null }, speiReference: { startsWith: 'SPEI-V-' } },
        select: {
          id: true,
          approvedTotalCents: true,
          offerGrossCents: true,
          quotedTotalCents: true,
          offerShippingFeeCents: true,
          payoutNetCents: true,
        },
      });
      expect(pagadas.length).toBeGreaterThan(0);
      for (const f of pagadas) {
        const bruto = f.approvedTotalCents ?? f.offerGrossCents ?? f.quotedTotalCents ?? 0;
        expect({ id: f.id, bruto }).toEqual({ id: f.id, bruto: f.approvedTotalCents });
        // Y el neto sellado es exactamente ese bruto menos la tarifa congelada (piso en 0).
        expect({ id: f.id, neto: f.payoutNetCents }).toEqual({
          id: f.id,
          neto: Math.max(0, (f.approvedTotalCents ?? 0) - (f.offerShippingFeeCents ?? 0)),
        });
      }
    });
  });

  // ===========================================================================================
  // ASSERT 7 — la tarjeta del tablero lee LA COLUMNA CORRECTA (§11, mutación #11 de QA)
  // ===========================================================================================
  describe('assert 7 — `buylistPeriod.amountCents` ES EL BRUTO CONSUMADO, no el cotizado ni el neto', () => {
    /** Lee la tarjeta acotada a un periodo que contiene SOLO la fila que se acaba de pagar. */
    async function tarjeta(desde: Date, hasta: Date) {
      const res = await h.api(
        'GET',
        `/admin/dashboard?from=${desde.toISOString()}&to=${hasta.toISOString()}`,
        { token: adminToken },
      );
      expect(res.status).toBe(200);
      return (res.body as { buylistPeriod: { count: number; amountCents: number } }).buylistPeriod;
    }

    it('con TODO aprobado: quoted=60000 · offerGross=50000 · net=32000 ⇒ amountCents = 50000', async () => {
      // ⚠️ **El fixture literal de §M5-V.8(7).** Los tres números son distintos a propósito: si la
      // tarjeta sumara `quotedTotalCents` daría 60000 y si sumara `payoutNetCents` daría 32000.
      // (Dos líneas cotizadas a 50000 = 100000 no serviría: hace falta que cotizado ≠ ofertado, y eso
      // lo produce el **cherry-pick al ofertar**, que descarta una de las dos líneas.)
      const { srId, ids } = await upToVerification(['buy', 'skip']);
      const ap = await h.api('PATCH', `/admin/buylist/items/${ids[0]}/decision`, {
        token: operatorToken,
        json: { decision: 'approve' },
      });
      expect(ap.status).toBe(200);
      const desde = new Date();
      const res = await pay(srId, 'SPEI-V-A7');
      expect(res.status).toBe(200);
      const hasta = new Date(Date.now() + 60_000);

      const fila = await rowOf(srId);
      // Los cuatro números del fixture, afirmados **antes** de mirar la tarjeta.
      expect(fila.approvedTotalCents).toBe(50_000);
      expect(fila.offerGrossCents).toBe(50_000);
      expect(fila.offerShippingFeeCents).toBe(18_000);
      expect(fila.payoutNetCents).toBe(32_000);
      const cotizado = (await adminDetail(srId)).quotedTotalCents;
      expect(cotizado).toBe(100_000); // dos líneas cotizadas; se compró una

      const card = await tarjeta(desde, hasta);
      expect(card.count).toBe(1);
      expect(card.amountCents).toBe(50_000);
      expect(card.amountCents).not.toBe(cotizado);
      expect(card.amountCents).not.toBe(fila.payoutNetCents);
    });

    it('⚠️ y con una `buy` RECHAZADA los CUATRO números son distintos: sólo `approvedTotalCents` da 50000', async () => {
      // ⚠️⚠️ **Sin este caso la mutación #11 sobrevive a medias.** En el fixture de arriba
      // `approvedTotalCents === offerGrossCents` (se aprobó todo lo comprado), así que **cambiar la
      // columna sumada a `offerGrossCents` NO pondría nada rojo**. Aquí se rechaza una de las dos
      // líneas compradas: cotizado 150000 · ofertado 100000 · **aprobado 50000** · neto 32000.
      // *Cuatro columnas, cuatro números: la única suma que da 50000 es la correcta.*
      const { srId, ids } = await upToVerification(['buy', 'buy', 'skip']);
      expect(
        (
          await h.api('PATCH', `/admin/buylist/items/${ids[0]}/decision`, {
            token: operatorToken,
            json: { decision: 'approve' },
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await h.api('PATCH', `/admin/buylist/items/${ids[1]}/decision`, {
            token: operatorToken,
            json: { decision: 'reject', reason: 'no llega en NM: superficie rayada' },
          })
        ).status,
      ).toBe(200);
      const desde = new Date();
      expect((await pay(srId, 'SPEI-V-A7BIS')).status).toBe(200);
      const hasta = new Date(Date.now() + 60_000);

      const fila = await rowOf(srId);
      const detalle = await adminDetail(srId);
      expect(detalle.quotedTotalCents).toBe(150_000);
      expect(fila.offerGrossCents).toBe(100_000);
      expect(fila.approvedTotalCents).toBe(50_000);
      expect(fila.payoutNetCents).toBe(32_000);

      const card = await tarjeta(desde, hasta);
      expect(card).toEqual({ count: 1, amountCents: 50_000 });
    });
  });

  // ===========================================================================================
  // LA ESCALERA DE §M5-V.6 — el orden de los errores es normativo, no cosmético
  // ===========================================================================================
  it('⚠️ `ITEMS_NOT_DECIDED` GANA a la genérica aunque V-a también falle', async () => {
    // Sin ninguna decisión fallan **los dos** términos (`approvedTotalCents` es `null` **y** hay
    // líneas `buy` sin veredicto). El contrato exige que responda el de las líneas: *cuando faltan
    // veredictos, decidirlos es el acto que satisface los dos*, y el mensaje genérico manda al
    // operador a revisar el estado y la recepción, que están bien.
    const { srId } = await upToVerification(['buy']);
    expect((await rowOf(srId)).approvedTotalCents).toBeNull();
    const res = await pay(srId, 'SPEI-V-LADDER');
    expect(res.status).toBe(422);
    expect((res.body as any).error.code).toBe('ITEMS_NOT_DECIDED');
  });

  it('⚠️ el `409` de «ya cobró» sigue GANANDO a los dos términos nuevos (§M5-T no se degrada)', async () => {
    const { srId, ids } = await upToVerification(['buy']);
    expect(
      (
        await h.api('PATCH', `/admin/buylist/items/${ids[0]}/decision`, {
          token: operatorToken,
          json: { decision: 'approve' },
        })
      ).status,
    ).toBe(200);
    expect((await pay(srId, 'SPEI-V-IDEMP')).status).toBe(200);
    // Replay: idempotente, 200 con la primera liquidación — no un 422 de precondición.
    const replay = await pay(srId, 'SPEI-V-IDEMP-2');
    expect(replay.status).toBe(200);
    expect((replay.body as any).status).toBe('pagada');
    expect((await rowOf(srId)).speiReference).toBe('SPEI-V-IDEMP');
  });

  // ===========================================================================================
  // v1.61.1 · MENOR-2 (QA) — el DEPÓSITO DE CERO, contra el motor
  // ===========================================================================================
  it('⚠️ MENOR-2 — `approvedTotalCents = 0` CON líneas decididas SÍ se paga (contra Postgres)', async () => {
    // **El agujero de cobertura que esto cierra:** la mutación `{ not: null }` → `{ gt: 0 }` en V-a
    // dejaba **la integración entera en verde** (281/281). La cazan cinco suites unitarias, así que
    // no era un agujero de conducta — pero *el camino que el contrato marca como «el error obvio» de
    // V-a no tenía ni un assert contra el motor real*, y una regla de dinero que solo vive en mocks
    // es una regla que nadie ha visto cumplirse.
    //
    // El ciclo **no puede fabricar** un aprobado de `0` por la puerta (una línea ofertada a 0 no es
    // ofertable), así que el ESTADO se monta por `h.prisma` —misma frontera que la cohorte legacy de
    // aquí abajo— y **la conducta se prueba por la puerta**.
    const { srId, ids } = await upToVerification(['buy', 'buy'], SEGUNDO());
    expect(
      (
        await h.api('PATCH', `/admin/buylist/items/${ids[0]}/decision`, {
          token: operatorToken,
          json: { decision: 'approve' },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await h.api('PATCH', `/admin/buylist/items/${ids[1]}/decision`, {
          token: operatorToken,
          json: { decision: 'reject', reason: 'no llega en NM: esquina con desgaste' },
        })
      ).status,
    ).toBe(200);
    // El depósito de cero de D40 / criterio 140: **se decidió, y salió cero**. Se escribe la fila
    // COHERENTE (la línea aprobada a 0 y el total a 0), que es lo que `recomputeApprovedTotal`
    // dejaría si el precio aprobado fuese 0.
    await h.prisma.sellRequestItem.update({
      where: { id: ids[0] },
      data: { approvedPriceCents: 0 },
    });
    await h.prisma.sellRequest.update({ where: { id: srId }, data: { approvedTotalCents: 0 } });

    const antes = await adminDetail(srId);
    expect(antes.approvedTotalCents).toBe(0);
    expect(antes.pendingDecisionItemCount).toBe(0);
    // ⚠️ La señal también tiene que decir que sí: `isPayable` es lo que gobierna el botón de pagar.
    expect(antes.isPayable).toBe(true);

    const res = await pay(srId, 'SPEI-V-CERO-D40');
    expect(res.status).toBe(200);
    const fila = await rowOf(srId);
    expect(fila.status).toBe('pagada');
    // `max(0, 0 − envío)` = 0: el piso protege al vendedor de deber, no es excusa para no pagarle.
    expect(fila.payoutNetCents).toBe(0);
    expect(fila.speiReference).toBe('SPEI-V-CERO-D40');
    expect(fila.closedAt).toBeTruthy();
  });

  // ===========================================================================================
  // v1.61.1 · B1 — la composición del `where`, medida contra el motor
  // ===========================================================================================
  it('⚠️⚠️ B1 — sobre una fila REAL con el aprobado en `null`, el SPREAD casa y el `AND` no', async () => {
    // **El defecto era de COMPOSICIÓN, y esto lo mide donde ocurre: en el SQL.** El `where` del
    // `updateMany` de `pay-spei` se armaba con `{ ...payableWhere(), approvedTotalCents: fresh… }` y
    // *en un objeto literal la clave posterior gana sobre el spread*: con el aprobado en `null`, V-a
    // (`IS NOT NULL`) desaparecía y quedaba `IS NULL` — o sea, el `where` casaba **exactamente la
    // fila que V-a existe para rechazar**. En la ventana B-2 eso es `BL-45` otra vez: `count === 1`
    // y sale `max(0, offerGross − envío)` por CERO cartas.
    //
    // La fila se construye **por la puerta** y es la de `BL-45`: única línea `buy` rechazada (⇒
    // `approvedTotalCents = null`) y una `skip` que impide la auto-transición a `rechazada`.
    const { srId, ids } = await upToVerification(['buy', 'skip'], SEGUNDO());
    expect(
      (
        await h.api('PATCH', `/admin/buylist/items/${ids[0]}/decision`, {
          token: operatorToken,
          json: { decision: 'reject', reason: 'no llega en NM: bordes blanqueados' },
        })
      ).status,
    ).toBe(200);
    const fila = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
    expect(fila!.approvedTotalCents).toBeNull();
    expect(fila!.status).toBe('verificacion');

    const vA = { approvedTotalCents: { not: null } }; // el término de `payableWhere()`
    const cas = { approvedTotalCents: fila!.approvedTotalCents }; // el CAS de B-2, con lo releído

    // (1) La composición VIEJA: **Postgres recibe `IS NULL`** y la fila casa. Un peso saldría.
    expect(await h.prisma.sellRequest.count({ where: { id: srId, ...vA, ...cas } })).toBe(1);
    // (2) La composición NUEVA: los dos términos llegan al SQL, se contradicen, y **no casa nada**.
    expect(await h.prisma.sellRequest.count({ where: { id: srId, AND: [vA, cas] } })).toBe(0);
    // (3) Y el `AND` **no es un candado que rechace de más**: con el aprobado presente, casa.
    await h.prisma.sellRequest.update({ where: { id: srId }, data: { approvedTotalCents: 0 } });
    expect(
      await h.prisma.sellRequest.count({
        where: { id: srId, AND: [vA, { approvedTotalCents: 0 }] },
      }),
    ).toBe(1);
  });

  // ===========================================================================================
  // FUERA DEL CICLO — V-b no aplica, y eso es normativo (no es una excepción legacy)
  // ===========================================================================================
  it('⛔ fuera del ciclo (`offerSentAt IS NULL`) V-b NO aplica: la cohorte legacy se sigue pagando', async () => {
    // El ciclo no puede fabricar esta fila (toda oferta sella `offerSentAt`), así que el ESTADO se
    // monta por `h.prisma` —la BD real— y **la conducta se prueba por la puerta**, que es la frontera
    // que esta carpeta declara. Es la cohorte pre-M-46: `respond(accept)` aprobaba en bloque y dejaba
    // líneas sin veredicto individual **de forma legítima**.
    const srId = await createRequest(2);
    const ids = await itemIds(srId);
    await h.prisma.sellRequest.update({
      where: { id: srId },
      data: {
        status: 'aprobada',
        receivedAt: new Date(),
        verifiedAt: new Date(),
        approvedTotalCents: 50_000,
        offerSentAt: null,
      },
    });
    await h.prisma.sellRequestItem.update({
      where: { id: ids[0] },
      data: { itemStatus: 'aprobada', approvedPriceCents: 50_000 },
    });
    // La segunda línea se queda `cotizada` — sin veredicto y sin `offerDecision`.
    const legacy = await h.prisma.sellRequestItem.findUnique({ where: { id: ids[1] } });
    expect(legacy!.offerDecision).toBeNull();
    expect(legacy!.itemStatus).toBe('cotizada');

    const d = await adminDetail(srId);
    expect(d.pendingDecisionItemCount).toBe(0);
    expect(d.isPayable).toBe(true);
    const res = await pay(srId, 'SPEI-V-LEGACY');
    expect(res.status).toBe(200);
    expect((await rowOf(srId)).status).toBe('pagada');
  });
});

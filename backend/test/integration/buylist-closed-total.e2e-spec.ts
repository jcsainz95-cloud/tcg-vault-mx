/**
 * `buylist-closed-total.e2e-spec.ts` — **EN UNA SOLICITUD CERRADA EL BRUTO ES FINAL: ES EL QUE SE
 * PAGÓ.** Propiedad: backend. §M5-T / BL-35 (P1) y §4.39i.4-bis; `recomputeApprovedTotal`
 * (`buylist.service.ts`) e `itemDecision` (BL-14).
 *
 * ### Por qué existe este fichero, dicho con la medición que lo motivó
 * La guarda de `recomputeApprovedTotal` (`updateMany` con `...liveRequestWhere()`) **no tenía ni un
 * caso que la ejercitara contra la base**: QA le quitó los términos de guarda dejando el
 * `updateMany`, y **la suite de integración quedó 264/264 en verde**. Lo único que la sostenía eran
 * dos asertos de FORMA sobre un Prisma mockeado (`test/buylist.reject.spec.ts`), que confirman **la
 * forma del código, no la del sistema**.
 *
 * ### ⚠️ LA TRAMPA QUE ESTE FICHERO EVITA, Y HAY QUE LEERLA ANTES DE TOCARLO
 * El caso obvio —*«sella una solicitud `pagada`, dispara una decisión por-ítem y exige que
 * `approvedTotalCents` no se mueva»*— **NO ejercita esa guarda**: `itemDecision` corta antes con el
 * pre-check de terminal de **BL-14** (`409 NO_LIVE_ADJUSTMENT`) y el recompute **ni siquiera se
 * llama**. Ese test pasa en verde con la guarda del recompute **borrada** — sería exactamente el
 * candado que no se puede poner rojo que este pase existe para corregir. *(Medido: con la guarda
 * mutada a `where: { id }`, el caso (A) de abajo sigue verde y el (B) se pone rojo.)*
 *
 * Por eso hay **dos** casos, que pinchan **dos invariantes distintas y no se tapan entre sí**:
 *
 * - **(A) La puerta de BL-14.** Sobre una solicitud `pagada` **no hay decisión de ítem que tomar**:
 *   `409 NO_LIVE_ADJUSTMENT`, y lo que de verdad se afirma es que **el número del dinero no se
 *   mueve**.
 *   > ⚠️⚠️ **v1.61 · §M5-V (`BL-45`) — LA PREMISA DE (A) CAMBIÓ, Y EL CAMBIO ES EL ARREGLO.** Este
 *   > caso partía del escenario que QA reprodujo en vivo: `receive` → `verify` → **`pay-spei` SIN
 *   > NINGUNA decisión por-ítem** ⇒ `approvedTotalCents = null` y `payoutNetCents = 32000`. **Ese
 *   > pago ya no existe**: `422 ITEMS_NOT_DECIDED` lo frena, porque era el mismo camino que dejaba la
 *   > mercancía pagada fuera del inventario **para siempre**. Ahora (A) decide la línea **antes** de
 *   > pagar —el ciclo como debe ser— y ejercita la puerta con el `reject` de después, que es el
 *   > movimiento que de verdad reescribiría el bruto (`50000 → null`) si BL-14 no estuviera.
 * - **(B) La guarda del recompute, por su OTRO eje.** `liveRequestWhere()` son DOS términos
 *   (`status ∉ TERMINAL ∧ closedAt IS NULL`), y el eje `closedAt` **sí es alcanzable por HTTP**:
 *   sobre una fila **cerrada con estado no-terminal** —la fila que P1 fabricaba, la razón literal
 *   por la que ese segundo término existe— BL-14 deja pasar la decisión (el estado es legal), la
 *   decisión **prospera correctamente**, y lo ÚNICO que impide que el bruto congelado se reescriba
 *   es el `closedAt: null` del `updateMany` del recompute. *Una guarda que se apoya en el invariante
 *   que el bug rompió no guarda nada.*
 *
 * ### Norma de la suite (heredada de `buylist-cycle.e2e-spec.ts`)
 * **Nada de mocks de Prisma.** El estado que la API no puede fabricar —aquí, la fila cerrada con
 * estado vivo— se **siembra por `h.prisma`** (la BD real) y la conducta se ejercita **por HTTP**.
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_CARDS, E2E_USERS } from '../../prisma/e2e-fixtures';

/** CLABE válida (18 dígitos) del `customer`; la fija su primera solicitud. */
const CLABE_A = '012345678901234567';

describe('E2E — el bruto de una solicitud CERRADA no se reescribe (§M5-T · BL-14/BL-35)', () => {
  let h: E2EHarness;
  let customerToken: string;
  let operatorToken: string;
  let adminToken: string;
  let charizardId: string;
  let customerAddressId: string;

  /**
   * Lleva una solicitud NUEVA por el ciclo completo hasta `verificacion`, **toda por HTTP**:
   * cotizar → ofertar → aceptar → guía → «ya lo mandé» → confirmar → recibir → verificar.
   * Deliberadamente **sin ninguna decisión por-ítem**: así `approvedTotalCents` sigue `null` y el
   * bruto vinculante vive en `offerGrossCents` (MX$500) — el caso que M-46 vuelve **normal**, no raro.
   */
  async function walkToVerificacion(): Promise<{ srId: string; itemId: string }> {
    const created = await h.api('POST', '/buylist/requests', {
      token: customerToken,
      json: {
        items: [{ cardId: charizardId, productType: 'raw', rawCondition: 'NM' }],
        clabe: CLABE_A,
        addressId: customerAddressId,
      },
    });
    expect(created.status).toBe(201);
    const srId: string = created.body.sellRequestId;

    const detail = await h.api('GET', `/admin/buylist/${srId}`, { token: operatorToken });
    const itemId: string = detail.body.items[0].id;

    const offer = await h.api('POST', `/admin/buylist/${srId}/offer`, {
      token: operatorToken,
      json: { lines: [{ itemId, decision: 'buy' }] },
    });
    expect(offer.status).toBe(200);

    const accepted = await h.api('POST', `/buylist/requests/${srId}/offer-response`, {
      token: customerToken,
      json: { decision: 'accept' },
    });
    expect(accepted.status).toBe(200);

    const guide = await h.api('POST', `/admin/buylist/${srId}/guide`, {
      token: operatorToken,
      json: { carrier: 'Estafeta', trackingNumber: `E2E-CLOSED-${srId.slice(0, 8)}` },
    });
    expect(guide.status).toBe(200);

    await h.api('POST', `/buylist/requests/${srId}/declare-shipped`, { token: customerToken });
    await h.api('POST', `/admin/buylist/${srId}/confirm-shipment`, {
      token: operatorToken,
      json: {},
    });
    expect((await h.api('POST', `/admin/buylist/${srId}/receive`, { token: operatorToken })).status).toBe(200);
    const verified = await h.api('POST', `/admin/buylist/${srId}/verify`, { token: operatorToken });
    expect(verified.status).toBe(200);

    // La premisa de los dos casos: se llega a la puerta del pago SIN decisiones por-ítem.
    const row = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
    expect(row!.approvedTotalCents).toBeNull();
    expect(row!.offerGrossCents).toBe(50000);
    return { srId, itemId };
  }

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    customerToken = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    operatorToken = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    const card = await h.prisma.card.findUnique({ where: { externalId: E2E_CARDS.charizard.externalId } });
    charizardId = card!.id;
    const user = await h.prisma.user.findUnique({ where: { email: E2E_USERS.customer.email } });
    const addr = await h.prisma.address.findFirst({ where: { userId: user!.id } });
    customerAddressId = addr!.id;
  });

  afterAll(async () => {
    await h?.close();
  });

  it('(A-0) ⚠️⚠️ v1.61 · §M5-V — el pago SIN decisiones que QA midió en vivo YA NO OCURRE', async () => {
    // Se afirma **explícitamente el camino que se cerró**, para que nadie lo reabra creyendo que era
    // un caso de negocio: `receive` → `verify` → `pay-spei` sin ningún veredicto era el estado que
    // dejaba `approvedTotalCents = null`, la tarjeta en MX$0 y la mercancía **inconvertible para
    // siempre**. Quitar la guarda V-b devuelve el `200` y este caso se pone rojo.
    const { srId } = await walkToVerificacion();
    const res = await h.api('POST', `/admin/buylist/${srId}/pay-spei`, {
      token: adminToken,
      json: { speiReference: `SPEI-CLOSED-A0-${srId.slice(0, 8)}` },
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ITEMS_NOT_DECIDED');
    const fila = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
    expect(fila!.paidAt).toBeNull();
    expect(fila!.payoutNetCents).toBeNull();
  });

  it('(A) sobre una solicitud PAGADA no hay decisión de ítem: `409 NO_LIVE_ADJUSTMENT` y el bruto NO se mueve', async () => {
    const { srId, itemId } = await walkToVerificacion();

    // v1.61 · §M5-V: se decide la línea ANTES de pagar (el ciclo como §P.5 lo exige). El bruto
    // aprobado queda en 50000 y el neto en 32000 — los mismos números que antes medía este caso,
    // ahora por el camino que sí deja la mercancía convertible.
    const aprobada = await h.api('PATCH', `/admin/buylist/items/${itemId}/decision`, {
      token: operatorToken,
      json: { decision: 'approve' },
    });
    expect(aprobada.status).toBe(200);

    const paid = await h.api('POST', `/admin/buylist/${srId}/pay-spei`, {
      token: adminToken,
      json: { speiReference: `SPEI-CLOSED-A-${srId.slice(0, 8)}` },
    });
    expect(paid.status).toBe(200);

    const sellado = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
    expect(sellado!.status).toBe('pagada');
    expect(sellado!.approvedTotalCents).toBe(50000);
    expect(sellado!.payoutNetCents).toBe(32000);
    expect(sellado!.closedAt).not.toBeNull();

    // ⚠️ **`reject` y no `approve`**: sobre una fila ya pagada el `reject` es el movimiento que de
    // verdad reescribiría el dinero — pone `approvedPriceCents = null` y el recompute bajaría
    // `approvedTotalCents` de **50000 a `null`** sobre una fila que ya depositó MX$320, liberando
    // cuota mensual AML de forma retroactiva. *La puerta se prueba empujándola por el lado que
    // rompe.*
    const decision = await h.api('PATCH', `/admin/buylist/items/${itemId}/decision`, {
      token: operatorToken,
      json: { decision: 'reject', reason: 'intento de re-decidir una línea ya pagada' },
    });
    expect(decision.status).toBe(409);
    expect(decision.body.error.code).toBe('NO_LIVE_ADJUSTMENT');
    expect(decision.body.error.details.status).toBe('pagada');

    // Lo que de verdad importa no es el código: es que **el número del dinero sigue siendo el mismo**.
    const despues = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
    expect(despues!.approvedTotalCents).toBe(50000);
    expect(despues!.payoutNetCents).toBe(32000);
    const item = await h.prisma.sellRequestItem.findUnique({ where: { id: itemId } });
    expect(item!.approvedPriceCents).toBe(50000);
    expect(item!.itemStatus).toBe('aprobada');
  });

  it('(B) fila CERRADA con estado vivo: la decisión prospera y aun así el recompute NO reescribe el total', async () => {
    const { srId, itemId } = await walkToVerificacion();

    // ⚠️ El estado que la API no fabrica y por eso se siembra: `closedAt` sellado con `status`
    // NO terminal. Es literalmente la fila que P1 producía (revivía el estado sin tocar el cierre)
    // y la razón por la que `liveRequestWhere()` tiene DOS términos y no uno.
    const closedAt = new Date();
    await h.prisma.sellRequest.update({ where: { id: srId }, data: { closedAt } });

    // BL-14 deja pasar: el estado es `verificacion`, que no es terminal. La decisión es legal y
    // **debe** prosperar — este caso no prueba que la decisión falle, prueba que el TOTAL no se mueve.
    const decision = await h.api('PATCH', `/admin/buylist/items/${itemId}/decision`, {
      token: operatorToken,
      json: { decision: 'approve' },
    });
    expect(decision.status).toBe(200);
    expect(decision.body.approvedPriceCents).toBe(50000);

    // El ítem SÍ se movió (prueba de que el recompute tenía un número nuevo que escribir: 50000)…
    const item = await h.prisma.sellRequestItem.findUnique({ where: { id: itemId } });
    expect(item!.itemStatus).toBe('aprobada');
    expect(item!.approvedPriceCents).toBe(50000);

    // …y aun así el bruto de la solicitud CERRADA sigue exactamente donde estaba. Éste es el
    // aserto que la guarda `...liveRequestWhere()` del `updateMany` sostiene, y el único de toda la
    // suite de integración que se pone rojo si se le quita.
    const despues = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
    expect(despues!.approvedTotalCents).toBeNull();
    expect(despues!.closedAt).toEqual(closedAt);
  });
});

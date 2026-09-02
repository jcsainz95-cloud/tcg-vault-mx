/**
 * `buylist-cycle.e2e-spec.ts` — **EL CICLO DE ADQUISICIÓN, POR HTTP, CONTRA POSTGRES REAL.**
 * Propiedad: backend. API_CONTRACT §6 y §M5; ARCHITECTURE §4.39; PROJECT §P.
 *
 * ### ⚠️ POR QUÉ ESTA SUITE EXISTE, y conviene leerlo antes de tocarla
 * El ciclo aterrizó con **3.045 unitarios en verde** y **no funcionaba de punta a punta**. QA lo
 * encontró **ejercitando los endpoints a mano con `curl`** contra el stack vivo, y ninguno de esos
 * ocho bloqueantes era invisible: eran **404 de ruta**, **campos que el DTO no proyectaba**, **un
 * campo que el `ValidationPipe` descartaba en silencio** y **una guarda de dinero que no existía**.
 *
 * **Lo que ninguna de esas 3.045 pruebas podía ver es exactamente lo que esta suite mira:**
 * - un **404 por sombra de ruta** no existe cuando llamas al método del servicio directamente;
 * - un **campo descartado por whitelist** no existe cuando pasas el DTO ya construido;
 * - una **proyección incompleta** no se nota cuando el test asevera solo las claves que sí emite;
 * - y un **Prisma mockeado** confirma **la forma del código**, no **la del sistema**.
 *
 * ⇒ **Todo aquí va por HTTP**, con los guards, el `ValidationPipe` (whitelist incluida), el filtro de
 * excepciones y el motor de verdad. *Un test que no puede fallar por las razones por las que el
 * sistema falla no es cobertura: es decoración.*
 *
 * ### ⚠️ NORMA PARA QUIEN AÑADA CASOS
 * **Nada de mocks de Prisma aquí.** Si un caso necesita un estado que la API no puede fabricar
 * (una guía muerta, una caducidad), se **siembra por `h.prisma`** —que es la BD real— y se ejercita
 * **por HTTP**. La frontera es: *el estado se puede montar; la conducta se prueba por la puerta*.
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_CARDS, E2E_USERS } from '../../prisma/e2e-fixtures';

/** CLABE válida (18 dígitos) del `customer`; la fija su primera solicitud. */
const CLABE_A = '012345678901234567';

describe('E2E — Ciclo de adquisición del buylist (§6 · §M5)', () => {
  let h: E2EHarness;
  let customerToken: string;
  let customer2Token: string;
  let operatorToken: string;
  let adminToken: string;
  const cardId: Record<string, string> = {};
  const userId: Record<string, string> = {};
  const addressId: Record<string, string> = {};

  /** Crea una solicitud LEGÍTIMA del `customer` y devuelve la respuesta cruda. */
  function createRequest(body: Record<string, unknown>, token = customerToken) {
    return h.api('POST', '/buylist/requests', { token, json: body });
  }

  /** El cuerpo mínimo que SÍ crea: una carta por encima del mínimo + CLABE + dirección propia. */
  function validBody(extra: Record<string, unknown> = {}) {
    return {
      items: [{ cardId: cardId.charizard, productType: 'raw', rawCondition: 'NM' }],
      clabe: CLABE_A,
      addressId: addressId.customer,
      ...extra,
    };
  }

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    customerToken = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    customer2Token = await h.login(E2E_USERS.customer2.email, E2E_USERS.customer2.password);
    operatorToken = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    for (const [key, c] of Object.entries(E2E_CARDS)) {
      const card = await h.prisma.card.findUnique({ where: { externalId: c.externalId } });
      cardId[key] = card!.id;
    }
    for (const key of ['customer', 'customer2', 'operator'] as const) {
      const u = await h.prisma.user.findUnique({ where: { email: E2E_USERS[key].email } });
      userId[key] = u!.id;
      const addr = await h.prisma.address.findFirst({ where: { userId: u!.id } });
      // El operador no tiene libreta y no la necesita: solo se guarda su id para aseverar
      // `declinedBy` (D39, el ÚNICO discriminador entre «decidimos» y «dejamos vencer»).
      if (addr) addressId[key] = addr.id;
    }
  });

  afterAll(async () => {
    await h?.close();
  });

  // ===========================================================================================
  // 1) LA PUERTA — `POST /buylist/requests` (BL-26: los tres requisitos que faltaban ENTEROS)
  // ===========================================================================================
  describe('la puerta del ciclo: celular, dirección y mínimo (D11/D18/D36/D37)', () => {
    it('SIN `addressId` → 422 PICKUP_ADDRESS_REQUIRED (y NO crea la solicitud)', async () => {
      // ⚠️ Éste es el caso que ninguna prueba unitaria podía ver: el campo NO estaba en el DTO y el
      // `ValidationPipe` con whitelist lo **descartaba en silencio**, así que la solicitud nacía sin
      // snapshot de origen y quedaba INOFERTABLE desde su primer instante.
      const before = await h.prisma.sellRequest.count({ where: { userId: userId.customer } });
      const res = await createRequest({
        items: [{ cardId: cardId.charizard, productType: 'raw', rawCondition: 'NM' }],
        clabe: CLABE_A,
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('PICKUP_ADDRESS_REQUIRED');
      expect(res.body.error.details.field).toBe('addressId');
      const after = await h.prisma.sellRequest.count({ where: { userId: userId.customer } });
      expect(after).toBe(before); // *Sin dirección no se crea la solicitud.*
    });

    it('con `addressId` AJENO → 422 PICKUP_ADDRESS_NOT_FOUND, la MISMA respuesta que si no existiera', async () => {
      const ajeno = await createRequest(validBody({ addressId: addressId.customer2 }));
      const inexistente = await createRequest(
        validBody({ addressId: '00000000-0000-4000-8000-000000000000' }),
      );
      // Anti-enumeración: distinguir los dos casos convertiría el endpoint en un ORÁCULO de
      // existencia de direcciones ajenas. Se afirma que son INDISTINGUIBLES, no solo que fallan.
      expect(ajeno.status).toBe(422);
      expect(inexistente.status).toBe(422);
      expect(ajeno.body.error.code).toBe('PICKUP_ADDRESS_NOT_FOUND');
      expect(inexistente.body.error.code).toBe(ajeno.body.error.code);
      expect(inexistente.body.error.message).toBe(ajeno.body.error.message);
    });

    it('por DEBAJO del mínimo → 422 BUYLIST_MINIMUM_NOT_MET con el faltante calculado por el SERVIDOR', async () => {
      // `common`: mercado $50 ⇒ la curva paga MX$16.67. El criterio 132(b) existe porque *el
      // cotizador es superficie de cliente y se puede saltar*: mandarlo directo al backend tampoco
      // lo crea.
      const res = await createRequest(
        validBody({ items: [{ cardId: cardId.common, productType: 'raw', rawCondition: 'NM' }] }),
      );
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('BUYLIST_MINIMUM_NOT_MET');
      const d = res.body.error.details;
      expect(d.minimumCents).toBe(50000);
      expect(d.totalCents).toBe(1667);
      // ⚠️ El criterio 132(a) exige que la pantalla diga **cuánto falta**, y el front lo RENDERIZA:
      // un «no» seco manda al vendedor a otro lado; un «te faltan $483.33» lo manda a agregar otra
      // carta. Se asevera la ARITMÉTICA, no solo la presencia de la clave.
      expect(d.shortfallCents).toBe(d.minimumCents - d.totalCents);
      // Y coincide con el dato público del cotizador: una sola fuente para los dos frentes.
      const policy = await h.api('GET', '/buylist/quote-policy');
      expect(policy.body.minimumRequestCents).toBe(d.minimumCents);
    });

    it('EXACTAMENTE el mínimo SÍ se crea: el borde es INCLUSIVO (criterio 158(a))', async () => {
      // charizard: mercado $1,000 ⇒ 50 % = MX$500 = el mínimo EXACTO. Este caso es el que distingue
      // un `<` de un `<=`, y esa diferencia rechazaría solicitudes legítimas todos los días.
      const res = await createRequest(validBody());
      expect(res.status).toBe(201);
      expect(res.body.quotedTotalCents).toBe(50000);
    });

    it('SIN celular en la cuenta → 422 PHONE_REQUIRED (D11, criterio 128(c))', async () => {
      // `User.phone` es NULLABLE aunque el registro local ya lo exija: las cuentas de Google y las
      // viejas lo tienen vacío. Se reproduce ese estado real y se restaura al salir.
      const original = E2E_USERS.customer2.phone;
      await h.prisma.user.update({ where: { id: userId.customer2 }, data: { phone: null } });
      try {
        const res = await createRequest(
          {
            items: [{ cardId: cardId.charizard, productType: 'raw', rawCondition: 'NM' }],
            clabe: CLABE_A,
            addressId: addressId.customer2,
          },
          customer2Token,
        );
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('PHONE_REQUIRED');
        expect(res.body.error.details.field).toBe('phone');
      } finally {
        await h.prisma.user.update({ where: { id: userId.customer2 }, data: { phone: original } });
      }
    });

    it('la solicitud creada NACE con el snapshot de origen congelado, y NO con una FK', async () => {
      const res = await createRequest(validBody());
      expect(res.status).toBe(201);
      const row = await h.prisma.sellRequest.findUnique({ where: { id: res.body.sellRequestId } });
      const snap = row!.pickupAddressSnapshot as Record<string, unknown>;
      expect(snap).toBeTruthy();
      expect(snap.line1).toBe('Av. E2E 123');
      expect(snap.country).toBe('MX');
      // Trazabilidad de QUÉ fila se copió, **sin que sea una referencia viva**: editar o borrar la
      // libreta NO puede reescribir lo que va impreso en la etiqueta.
      expect(snap.addressId).toBe(addressId.customer);
      expect(typeof snap.capturedAt).toBe('string');
    });
  });

  // ===========================================================================================
  // 2) `PATCH /buylist/requests/:id/pickup-address` — la vía de rescate (BL-2 del reporte de QA)
  // ===========================================================================================
  describe('corregir la dirección de origen (§6, D36/D37)', () => {
    let srId: string;
    let otraDireccionId: string;

    beforeAll(async () => {
      const created = await createRequest(validBody());
      srId = created.body.sellRequestId;
      const addr = await h.prisma.address.create({
        data: {
          userId: userId.customer,
          line1: 'Calle Nueva 456',
          city: 'Monterrey',
          state: 'NL',
          postalCode: '64000',
          country: 'MX',
          phone: '8112223333',
        },
      });
      otraDireccionId = addr.id;
    });

    it('re-congela el snapshot mientras NO haya guía', async () => {
      const res = await h.api('PATCH', `/buylist/requests/${srId}/pickup-address`, {
        token: customerToken,
        json: { addressId: otraDireccionId },
      });
      expect(res.status).toBe(200);
      expect(res.body.sellRequestId).toBe(srId);
      expect(res.body.pickupAddress.line1).toBe('Calle Nueva 456');
      expect(res.body.pickupAddress.city).toBe('Monterrey');
      // Y quedó persistido, no solo devuelto.
      const row = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
      expect((row!.pickupAddressSnapshot as { addressId: string }).addressId).toBe(otraDireccionId);
    });

    it('deja bitácora con los ids y SIN PII (la bitácora dice «cambió, y a cuál», no «dónde vive»)', async () => {
      const log = await h.prisma.auditLog.findFirst({
        where: { action: 'buylist.pickup_address.update', entityId: srId },
        orderBy: { createdAt: 'desc' },
      });
      expect(log).toBeTruthy();
      expect((log!.after as { addressId: string }).addressId).toBe(otraDireccionId);
      // Ni una línea de domicilio en la bitácora: es PII que nadie va a purgar.
      expect(JSON.stringify({ b: log!.before, a: log!.after })).not.toContain('Calle Nueva');
    });

    it('una dirección AJENA no se puede congelar: 422 PICKUP_ADDRESS_NOT_FOUND', async () => {
      const res = await h.api('PATCH', `/buylist/requests/${srId}/pickup-address`, {
        token: customerToken,
        json: { addressId: addressId.customer2 },
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('PICKUP_ADDRESS_NOT_FOUND');
    });

    it('una solicitud AJENA responde 404, la misma que una inexistente (anti-IDOR)', async () => {
      const ajena = await h.api('PATCH', `/buylist/requests/${srId}/pickup-address`, {
        token: customer2Token,
        json: { addressId: addressId.customer2 },
      });
      expect(ajena.status).toBe(404);
      expect(ajena.body.error.code).toBe('NOT_FOUND');
    });

    it('CON guía impresa → 409 PICKUP_ADDRESS_LOCKED: la dirección ya está en el papel', async () => {
      // La línea es `guideSentAt`, NO `status`: el estado no dice si hay papel; `guideSentAt` sí.
      await h.prisma.sellRequest.update({
        where: { id: srId },
        data: { guideSentAt: new Date() },
      });
      const res = await h.api('PATCH', `/buylist/requests/${srId}/pickup-address`, {
        token: customerToken,
        json: { addressId: addressId.customer },
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PICKUP_ADDRESS_LOCKED');
      expect(res.body.error.details.guideSentAt).toBeTruthy();
      await h.prisma.sellRequest.update({ where: { id: srId }, data: { guideSentAt: null } });
    });
  });

  // ===========================================================================================
  // 3) LAS CUATRO COLAS — sombra de ruta (BL-28). Dos devolvían 404 con el front llamándolas.
  // ===========================================================================================
  describe('las cuatro colas del ciclo responden (y no las captura `@Get(:id)`)', () => {
    it.each([
      ['offers/pending-authorization'],
      ['live-sellers'],
      ['pending-shipment-confirmation'],
      ['guides/pending-cancellation'],
    ])('GET /admin/buylist/%s → 200 con forma de listado paginado', async (path) => {
      // ⚠️ `live-sellers` y `pending-shipment-confirmation` son de UN solo segmento y estaban
      // declaradas DESPUÉS de `@Get(':id')`: Nest las resolvía como «detalle de la solicitud con id
      // = live-sellers» ⇒ **404**. Las de dos segmentos se salvaban por accidente de forma, no por
      // diseño — por eso las cuatro se prueban igual.
      const res = await h.api('GET', `/admin/buylist/${path}`, { token: operatorToken });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(typeof res.body.total).toBe('number');
    });

    it('`live-sellers` trae el TELÉFONO del vendedor: para llamar sin abrir la ficha (D12)', async () => {
      const res = await h.api('GET', '/admin/buylist/live-sellers', { token: operatorToken });
      const fila = res.body.data.find((r: { seller: { id: string } }) => r.seller.id === userId.customer);
      expect(fila).toBeTruthy();
      expect(fila.seller.phone).toBe(E2E_USERS.customer.phone);
    });
  });

  // ===========================================================================================
  // 4) EL SMOKE COMPLETO — cotizar → ofertar → aceptar → guía → tránsito → verificar → pagar
  // ===========================================================================================
  describe('el ciclo de punta a punta (los criterios 114/122/134/161 en un solo recorrido)', () => {
    let srId: string;
    let itemId: string;

    it('(1) el vendedor cotiza y crea la solicitud', async () => {
      const res = await createRequest(validBody());
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('cotizada');
      srId = res.body.sellRequestId;
      const detail = await h.api('GET', `/admin/buylist/${srId}`, { token: operatorToken });
      itemId = detail.body.items[0].id;
    });

    it('(2) antes de la oferta el vendedor NO ve guía ni instrucciones de envío (criterio 114)', async () => {
      const res = await h.api('GET', `/buylist/requests/${srId}`, { token: customerToken });
      expect(res.status).toBe(200);
      // `offer` es `null` salvo con `offerState='sent'`: una oferta que no existe no se insinúa.
      expect(res.body.offer).toBeNull();
      // Pero SU dirección de origen sí se le muestra desde el principio: es SU dato y es lo que
      // vamos a IMPRIMIR, así que tiene que poder verificarlo antes de que compremos la etiqueta.
      expect(res.body.pickupAddress.line1).toBe('Av. E2E 123');
      // ⚠️ Y NUNCA el estado interno de la oferta: filtraría el orden de magnitud de nuestro tope.
      expect(res.body).not.toHaveProperty('offerState');
      expect(res.body).not.toHaveProperty('isPayable');
      expect(res.body).not.toHaveProperty('closedAt');
      expect(res.body).not.toHaveProperty('offerReissueCount');
    });

    it('(3) la mesa de decisión ya NO reporta la dirección como faltante', async () => {
      const res = await h.api('GET', `/admin/buylist/${srId}/decision-table`, { token: operatorToken });
      expect(res.status).toBe(200);
      // Éste es el efecto medible de BL-1: con el `addressId` descartado, TODA solicitud creada por
      // la app nacía con `pickupAddressMissing: true` y era inofertable (`422 PICKUP_ADDRESS_MISSING`).
      expect(res.body.pickupAddressMissing).toBe(false);
    });

    it('(4) el operador OFERTA dentro de su tope: 200, oferta ENVIADA y los tres montos congelados', async () => {
      const res = await h.api('POST', `/admin/buylist/${srId}/offer`, {
        token: operatorToken,
        json: { lines: [{ itemId, decision: 'buy' }] },
      });
      // 200 (no 202): MX$500 de bruto está por debajo del tope del operador ⇒ el correo sale.
      expect(res.status).toBe(200);
      const row = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
      expect(row!.status).toBe('ofertada');
      expect(row!.offerState).toBe('sent');
      expect(row!.offerGrossCents).toBe(50000);
      expect(row!.offerShippingFeeCents).toBe(18000);
      // NETO = max(0, bruto − envío). «La resta se ENSEÑA, no se esconde.»
      expect(row!.offerNetCents).toBe(32000);
    });

    it('(5) el vendedor ve los TRES montos y el desglose línea por línea (criterios 118/161)', async () => {
      const res = await h.api('GET', `/buylist/requests/${srId}`, { token: customerToken });
      expect(res.body.offer.grossCents).toBe(50000);
      expect(res.body.offer.shippingFeeCents).toBe(18000);
      expect(res.body.offer.netCents).toBe(32000);
      expect(typeof res.body.offer.acceptDeadlineAt).toBe('string');
      // El texto legal lo RENDERIZA el backend con las mismas plantillas que el correo: la pantalla
      // y el correo no pueden decir cosas distintas.
      expect(res.body.offer.terms.perLineConditionLabel).toContain('Near Mint');
      expect(res.body.offer.lines[0].offerDecision).toBe('buy');
      expect(res.body.offer.lines[0].offeredPriceCents).toBe(50000);
      // ⚠️ Y NADA de la deliberación interna: el vendedor ve EL NÚMERO, no cómo se fabricó.
      expect(res.body.offer.lines[0]).not.toHaveProperty('offerDerivedPriceCents');
      expect(res.body.offer.lines[0]).not.toHaveProperty('offerOverrideReason');
    });

    it('(6) el vendedor ACEPTA → `aceptada`, nunca `aprobada`', async () => {
      const res = await h.api('POST', `/buylist/requests/${srId}/offer-response`, {
        token: customerToken,
        json: { decision: 'accept' },
      });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('aceptada');
      // Si saltara a `aprobada` caería en la cola de «listas para pagar SPEI» **sin envío, sin
      // recepción y sin verificación**: pagaríamos por cartas que nunca recibimos.
      const row = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
      expect(row!.acceptedAt).not.toBeNull();
      expect(row!.status).toBe('aceptada');
    });

    it('(7) aparece en `awaitingGuide` — el pendiente es NUESTRO y no corre reloj', async () => {
      const res = await h.api('GET', '/admin/buylist?awaitingGuide=true', { token: operatorToken });
      expect(res.status).toBe(200);
      expect(res.body.data.map((r: { id: string }) => r.id)).toContain(srId);
    });

    it('(8) el operador captura la GUÍA y se congela el plazo de envío', async () => {
      const res = await h.api('POST', `/admin/buylist/${srId}/guide`, {
        token: operatorToken,
        json: { carrier: 'Estafeta', trackingNumber: 'E2E-TRACK-0001' },
      });
      expect(res.status).toBe(201);
      expect(res.body.shipmentCarrier).toBe('Estafeta');
      expect(res.body.shipmentTrackingNumber).toBe('E2E-TRACK-0001');
      expect(res.body.shipDeadlineAt).toBeTruthy();
      // Y le llega al vendedor por su portal: `guideSentAt` es el ÚNICO marcador veraz de «hay guía
      // viva» — derivarlo de `carrier != null` pintaría instrucciones para una etiqueta anulada.
      const portal = await h.api('GET', `/buylist/requests/${srId}`, { token: customerToken });
      expect(portal.body.offer.guideSentAt).toBeTruthy();
      expect(portal.body.offer.trackingNumber).toBe('E2E-TRACK-0001');
    });

    it('(9) el vendedor declara «ya lo mandé»: detiene SU reloj y NO mueve el estado (criterio 138)', async () => {
      const res = await h.api('POST', `/buylist/requests/${srId}/declare-shipped`, {
        token: customerToken,
      });
      expect(res.status).toBe(200);
      const row = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
      expect(row!.sellerShippedDeclaredAt).not.toBeNull();
      // Sigue `aceptada`: es su palabra, todavía sin confirmar. Solo el operador mueve a tránsito.
      expect(row!.status).toBe('aceptada');
      expect(row!.shipmentConfirmedAt).toBeNull();
      // Y entra a la cola de «por confirmar envío», que es el pendiente NUESTRO (criterio 156).
      const cola = await h.api('GET', '/admin/buylist/pending-shipment-confirmation', {
        token: operatorToken,
      });
      // ⚠️ La fila de esta cola se identifica por `sellRequestId`, no por `id`: es una VISTA sobre
      // la solicitud, no la solicitud. Se afirma con la clave del contrato para que un renombre la
      // rompa aquí y no en la UI.
      expect(cola.body.data.map((r: { sellRequestId: string }) => r.sellRequestId)).toContain(srId);
    });

    it('(10) el operador CONFIRMA el envío → `en_transito` (D20: lo único que lo mueve)', async () => {
      const res = await h.api('POST', `/admin/buylist/${srId}/confirm-shipment`, {
        token: operatorToken,
        json: {},
      });
      expect(res.status).toBe(201);
      const row = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
      expect(row!.status).toBe('en_transito');
      expect(row!.shipmentConfirmedAt).not.toBeNull();
    });

    it('(11) recepción y verificación', async () => {
      expect((await h.api('POST', `/admin/buylist/${srId}/receive`, { token: operatorToken })).status).toBe(201);
      const ver = await h.api('POST', `/admin/buylist/${srId}/verify`, { token: operatorToken });
      expect(ver.status).toBe(201);
      // ⚠️ `verify` es JUSTAMENTE la transición que vuelve `isPayable` verdadero: omitirlo en esta
      // respuesta daría un `false` silencioso en superficie de dinero (BL-20).
      expect(ver.body.isPayable).toBe(true);
    });

    it('(12) llegó NM ⇒ aprobada AL PRECIO OFERTADO, fijado SERVER-SIDE (criterio 124)', async () => {
      const res = await h.api('PATCH', `/admin/buylist/items/${itemId}/decision`, {
        token: operatorToken,
        json: { decision: 'approve' },
      });
      expect(res.status).toBe(200);
      // El monto NO se toma del admin: sale de `offeredPriceCents`, que es lo que el vendedor aceptó.
      expect(res.body.approvedPriceCents).toBe(50000);
      const row = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
      expect(row!.approvedTotalCents).toBe(50000);
    });

    it('(13) el SPEI deposita EXACTAMENTE el neto anunciado, ni un peso menos (criterio 134)', async () => {
      const blocked = await h.api('POST', `/admin/buylist/${srId}/pay-spei`, {
        token: operatorToken,
        json: { speiReference: 'SPEI-CYCLE-1' },
      });
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.code).toBe('MONEY_OUT_FORBIDDEN');

      const paid = await h.api('POST', `/admin/buylist/${srId}/pay-spei`, {
        token: adminToken,
        json: { speiReference: 'SPEI-CYCLE-1' },
      });
      expect(paid.status).toBe(201);
      const row = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
      expect(row!.status).toBe('pagada');
      // ⚠️ **LA ASERCIÓN QUE JUSTIFICA TODO EL RECORRIDO.** El vendedor aceptó MX$320 netos y
      // recibe MX$320: `payoutNetCents == offerNetCents`. Es el invariante que el bug de la guarda
      // del ciclo rompía —oferta aceptada de MX$500 brutos, depósito de MX$0— y el único sitio donde
      // se puede comprobar es al final de un ciclo completo contra la BD real.
      expect(row!.payoutNetCents).toBe(32000);
      expect(row!.payoutNetCents).toBe(row!.offerNetCents);
    });
  });

  // ===========================================================================================
  // 5) LA GUARDA DE DINERO — el precio ofertado es INMUTABLE (BL-27, el bloqueante B5 de QA)
  // ===========================================================================================
  describe('en el ciclo de oferta NO existe ni repreciar ni ajustar (criterios 119/124/150)', () => {
    let srId: string;
    let itemId: string;

    beforeAll(async () => {
      // Una solicitud con la oferta ENVIADA y ACEPTADA: el estado exacto en el que QA midió que un
      // vendedor podía aceptar MX$500 y cobrar MX$0.
      const created = await createRequest(validBody());
      srId = created.body.sellRequestId;
      const detail = await h.api('GET', `/admin/buylist/${srId}`, { token: operatorToken });
      itemId = detail.body.items[0].id;
      await h.api('POST', `/admin/buylist/${srId}/offer`, {
        token: operatorToken,
        json: { lines: [{ itemId, decision: 'buy' }] },
      });
      await h.api('POST', `/buylist/requests/${srId}/offer-response`, {
        token: customerToken,
        json: { decision: 'accept' },
      });
    });

    it('`approvedPriceCents` en el body → 422 OFFER_PRICE_IMMUTABLE, y NO escribe nada', async () => {
      const res = await h.api('PATCH', `/admin/buylist/items/${itemId}/decision`, {
        token: operatorToken,
        json: { decision: 'approve', approvedPriceCents: 9900 },
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('OFFER_PRICE_IMMUTABLE');
      expect(res.body.error.details.itemId).toBe(itemId);
      expect(res.body.error.details.offeredPriceCents).toBe(50000);
      // La comprobación que importa no es el código: es que **el dinero no se movió**.
      const item = await h.prisma.sellRequestItem.findUnique({ where: { id: itemId } });
      expect(item!.approvedPriceCents).toBeNull();
      const row = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
      expect(row!.approvedTotalCents).toBeNull();
      expect(row!.offerGrossCents).toBe(50000);
      expect(row!.offerNetCents).toBe(32000);
    });

    it('`decision:"adjust"` → 409 ADJUST_NOT_ALLOWED_IN_OFFER_CYCLE (criterio 150 por lo negativo)', async () => {
      const res = await h.api('PATCH', `/admin/buylist/items/${itemId}/decision`, {
        token: operatorToken,
        json: { decision: 'adjust', approvedPriceCents: 9900 },
      });
      // ⚠️ `approvedPriceCents` viaja TAMBIÉN aquí, y gana el `422`: es la primera puerta y el
      // contrato la lista primero. Lo que este caso fija es que **ninguna de las dos deja pasar**.
      expect([409, 422]).toContain(res.status);
      expect(['ADJUST_NOT_ALLOWED_IN_OFFER_CYCLE', 'OFFER_PRICE_IMMUTABLE']).toContain(
        res.body.error.code,
      );
      // Sin monto en el body, el discriminante es limpio: `adjust` no existe en el ciclo, punto.
      const soloAdjust = await h.api('PATCH', `/admin/buylist/items/${itemId}/decision`, {
        token: operatorToken,
        json: { decision: 'adjust' },
      });
      expect(soloAdjust.status).toBe(409);
      expect(soloAdjust.body.error.code).toBe('ADJUST_NOT_ALLOWED_IN_OFFER_CYCLE');
      // Y el ítem NO quedó `ajustada`: el criterio 150 exige que ese estado no se use en NINGUNA
      // parte del ciclo, y aquí es donde se comprueba que no se usa.
      const item = await h.prisma.sellRequestItem.findUnique({ where: { id: itemId } });
      expect(item!.itemStatus).not.toBe('ajustada');
      // Y el plazo de 7 días del ajuste tampoco se disparó (era el efecto suelto de BL-14).
      const row = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
      expect(row!.adjustmentSentAt).toBeNull();
    });

    it('`reject` SÍ existe en el ciclo: es el rechazo PARCIAL, y baja LÍNEAS, no precios (D30)', async () => {
      const res = await h.api('PATCH', `/admin/buylist/items/${itemId}/decision`, {
        token: operatorToken,
        json: { decision: 'reject', reason: 'no es NM: whitening en los bordes' },
      });
      expect(res.status).toBe(200);
      expect(res.body.itemStatus).toBe('rechazada');
      // *Al rechazar una carta no baja el precio: baja el número de líneas compradas.*
      expect(res.body.approvedPriceCents).toBeNull();
    });

    it('sobre una solicitud TERMINAL gana `409 NO_LIVE_ADJUSTMENT` (precedencia explícita)', async () => {
      // Con la única línea rechazada, la solicitud se auto-cerró a `rechazada` (terminal).
      const row = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
      expect(row!.status).toBe('rechazada');
      const res = await h.api('PATCH', `/admin/buylist/items/${itemId}/decision`, {
        token: operatorToken,
        json: { decision: 'approve', approvedPriceCents: 9900 },
      });
      // *Una solicitud cerrada no se discute por el monto: no se toca.* El terminal GANA sobre el
      // `422 OFFER_PRICE_IMMUTABLE`, aunque las dos condiciones sean ciertas a la vez.
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('NO_LIVE_ADJUSTMENT');
      expect(res.body.error.details.status).toBe('rechazada');
    });
  });

  // ===========================================================================================
  // 6) LAS PROYECCIONES — lo que el DTO dejaba en la fila (BL-29 / B7-B8 del reporte de QA)
  // ===========================================================================================
  describe('proyecciones: el ciclo VIAJA en el DTO admin y se REDACTA en el de cliente', () => {
    let srId: string;

    beforeAll(async () => {
      const created = await createRequest(validBody());
      srId = created.body.sellRequestId;
      const detail = await h.api('GET', `/admin/buylist/${srId}`, { token: operatorToken });
      await h.api('POST', `/admin/buylist/${srId}/offer`, {
        token: operatorToken,
        json: { lines: [{ itemId: detail.body.items[0].id, decision: 'buy' }] },
      });
      await h.api('POST', `/buylist/requests/${srId}/offer-response`, {
        token: customerToken,
        json: { decision: 'accept' },
      });
      await h.api('POST', `/admin/buylist/${srId}/guide`, {
        token: operatorToken,
        json: { carrier: 'DHL', trackingNumber: 'E2E-TRACK-PROJ' },
      });
    });

    it('el DETALLE admin emite los 24 campos del ciclo (los datos ESTABAN en la BD)', async () => {
      const res = await h.api('GET', `/admin/buylist/${srId}`, { token: operatorToken });
      expect(res.status).toBe(200);
      // Se enumera la lista COMPLETA del contrato (§11 `AdminBuylistDTO +=`) y se exige la CLAVE
      // presente —no un valor—, porque el defecto era **omisión**: `undefined` en el cliente HTTP es
      // indistinguible de «no hay dato», y así es como el front se quedó con la guía siempre vacía.
      for (const k of [
        'isTerminal', 'isPayable', 'offerState', 'offerSentAt', 'offerGrossCents',
        'offerShippingFeeCents', 'offerNetCents', 'offerAcceptDeadlineAt', 'offerIssueDeadlineAt',
        'acceptedAt', 'guideSentAt', 'shipDeadlineAt', 'shipmentCarrier', 'shipmentTrackingNumber',
        'sellerShippedDeclaredAt', 'shipmentConfirmedAt', 'guideCancellationPendingAt',
        'guideCancellationDoneAt', 'guideActualCostCents', 'expiredReason', 'declinedBy',
        'offerReissueCount', 'offerReissueAlert', 'payoutNetCents',
      ]) {
        expect(Object.prototype.hasOwnProperty.call(res.body, k)).toBe(true);
      }
      // Y con los valores REALES, no con `null` de relleno.
      expect(res.body.shipmentTrackingNumber).toBe('E2E-TRACK-PROJ');
      expect(res.body.shipmentCarrier).toBe('DHL');
      expect(res.body.offerNetCents).toBe(32000);
      expect(res.body.offerState).toBe('sent');
      expect(res.body.offerReissueCount).toBe(0);
      expect(res.body.offerReissueAlert).toBe(false);
      // El DETALLE (y solo él) lleva la dirección: es donde se compra la etiqueta.
      expect(res.body.pickupAddress.line1).toBe('Av. E2E 123');
      // La CLABE, enmascarada y jamás el blob cifrado.
      expect(res.body.clabeMasked).toMatch(/^\*+\d{4}$/);
      expect(res.body).not.toHaveProperty('clabeSnapshotEnc');
    });

    it('el LISTADO admin trae los mismos campos del ciclo, y NO la dirección (PII masiva)', async () => {
      const res = await h.api(`GET`, `/admin/buylist?q=${srId}`, { token: operatorToken });
      const fila = res.body.data.find((r: { id: string }) => r.id === srId);
      expect(fila).toBeTruthy();
      expect(fila.shipmentTrackingNumber).toBe('E2E-TRACK-PROJ');
      expect(fila.offerNetCents).toBe(32000);
      // ⚠️ Un LISTADO paginado de domicilios es cosecha masiva de PII (N filas por request). La
      // dirección va en el detalle — misma decisión que `AdminOrderSummaryDTO`.
      expect(fila).not.toHaveProperty('pickupAddress');
    });

    it('`?offerReissueAlert=true` FILTRA de verdad (I1: devolvía el superconjunto)', async () => {
      const sinFiltro = await h.api('GET', '/admin/buylist', { token: operatorToken });
      const conFiltro = await h.api('GET', '/admin/buylist?offerReissueAlert=true', {
        token: operatorToken,
      });
      expect(conFiltro.status).toBe(200);
      // Ninguna fila del seed ha re-emitido ofertas ⇒ el filtro tiene que devolver MENOS.
      expect(conFiltro.body.total).toBeLessThan(sinFiltro.body.total);
      expect(conFiltro.body.data.every((r: { offerReissueAlert: boolean }) => r.offerReissueAlert)).toBe(true);

      // Y cuando una fila SÍ está en alerta, aparece. El contador lo escribe la cancelación de una
      // oferta enviada; aquí se monta el estado y se comprueba el FILTRO, que es lo que faltaba.
      await h.prisma.sellRequest.update({
        where: { id: srId },
        data: { offerReissueCount: 5, offerIssueClockStartedAt: new Date() },
      });
      const conAlerta = await h.api('GET', '/admin/buylist?offerReissueAlert=true', {
        token: operatorToken,
      });
      expect(conAlerta.body.data.map((r: { id: string }) => r.id)).toContain(srId);
      await h.prisma.sellRequest.update({
        where: { id: srId },
        data: { offerReissueCount: 0, offerIssueClockStartedAt: null },
      });
    });
  });

  // ===========================================================================================
  // 7) EL CIERRE `no_offer` — los montos dejan de viajar al cliente (D42 / §23.5f)
  // ===========================================================================================
  describe('cierre `no_offer`: la pantalla dice lo mismo que el correo', () => {
    let srId: string;

    it('`POST /admin/buylist/:id/decline` sella `expiredReason` y `declinedBy` EN LA RESPUESTA (I2)', async () => {
      const created = await createRequest(validBody());
      srId = created.body.sellRequestId;
      const res = await h.api('POST', `/admin/buylist/${srId}/decline`, {
        token: operatorToken,
        json: { reason: 'no encaja con el inventario objetivo' },
      });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('expirada');
      // ⚠️ Los DOS campos son lo único que distingue «lo decidimos» de «se nos venció» (D39), y una
      // mutación TERMINAL que no los devuelve obliga a releer para saber qué acaba de pasar.
      expect(res.body.expiredReason).toBe('no_offer');
      // ⚠️ Es EL id de quien declinó, no un booleano: el reporte de desempeño sale de una sola
      // tabla (`count(declinedBy IS NOT NULL)` vs `IS NULL` sobre `expiredReason='no_offer'`) y
      // encima contesta QUIÉN, que un valor de enum no podía.
      expect(res.body.declinedBy).toBe(userId.operator);
      expect(res.body.isTerminal).toBe(true);
    });

    it('el DETALLE del cliente pierde los MONTOS y conserva las LÍNEAS (regla de proyección)', async () => {
      const res = await h.api('GET', `/buylist/requests/${srId}`, { token: customerToken });
      expect(res.status).toBe(200);
      expect(res.body.expiredReason).toBe('no_offer');
      // *«MX$500» junto a «no procedimos» se lee como una deuda.* La regla vive en el servidor
      // porque el correo 4 tiene PROHIBIDO cualquier monto y la pantalla debe decir lo mismo.
      expect(res.body.quotedTotalCents).toBeNull();
      // Las líneas SE SIGUEN LISTANDO: no se le borra su solicitud, se le quita una cifra que ya no
      // significa nada.
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].quotedPriceCents).toBeNull();
      expect(res.body.items[0].card).toBeTruthy();
      // ⚠️ Nunca `declinedBy`: para el vendedor, barrido y «declinar ahora» son el MISMO hecho.
      expect(res.body).not.toHaveProperty('declinedBy');
    });

    it('la LISTA del cliente aplica la misma redacción (o el daño se reproduce una pantalla antes)', async () => {
      const res = await h.api('GET', '/buylist/requests', { token: customerToken });
      const fila = res.body.data.find((r: { sellRequestId: string }) => r.sellRequestId === srId);
      expect(fila).toBeTruthy();
      expect(fila.quotedTotalCents).toBeNull();
      expect(fila.items[0].quotedPriceCents).toBeNull();
      // La lista muestra ESTADOS: ni `offer`, ni `expiredReason`, ni la dirección.
      expect(fila).not.toHaveProperty('pickupAddress');
      expect(fila).not.toHaveProperty('offer');
    });

    it('la proyección ADMIN NO cambia ni una letra: el snapshot histórico lo necesitan M7 y M9', async () => {
      const res = await h.api('GET', `/admin/buylist/${srId}`, { token: operatorToken });
      // *El dato no se pierde; deja de salir por una puerta donde solo puede hacer daño.*
      expect(res.body.quotedTotalCents).toBe(50000);
      expect(res.body.expiredReason).toBe('no_offer');
    });
  });

  // ===========================================================================================
  // 8) `lastOfferCancelledAt` — la pantalla no puede contradecir al correo (D42)
  // ===========================================================================================
  describe('oferta cancelada: el portal deja rastro del correo 5', () => {
    it('tras cancelar una oferta ENVIADA, el detalle emite `lastOfferCancelledAt`', async () => {
      const created = await createRequest(validBody());
      const srId = created.body.sellRequestId;
      const detail = await h.api('GET', `/admin/buylist/${srId}`, { token: operatorToken });
      await h.api('POST', `/admin/buylist/${srId}/offer`, {
        token: operatorToken,
        json: { lines: [{ itemId: detail.body.items[0].id, decision: 'buy' }] },
      });
      const cancel = await h.api('POST', `/admin/buylist/${srId}/offer/cancel`, {
        token: operatorToken,
        json: { reason: 'error de captura interno' },
      });
      expect(cancel.status).toBe(201);

      const portal = await h.api('GET', `/buylist/requests/${srId}`, { token: customerToken });
      // El vendedor acaba de recibir el correo 5. Sin este campo entraba al portal y **no veía
      // rastro** ni de la oferta ni de la cancelación: la pantalla contradecía al correo.
      expect(portal.body.lastOfferCancelledAt).toBeTruthy();
      expect(portal.body.status).toBe('cotizada'); // volvió a la fila: «te debemos una respuesta»
      expect(portal.body.offer).toBeNull(); // los campos congelados se limpiaron y NO se resucitan
      // ⚠️ Viaja EL CUÁNDO Y NADA MÁS: ni el motivo interno, ni los montos, ni cuántas veces.
      expect(portal.body).not.toHaveProperty('offerCancelReason');
      expect(portal.body).not.toHaveProperty('offerReissueCount');

      // Y el contador de re-emisiones SÍ subió, pero solo en la superficie de admin.
      const admin = await h.api('GET', `/admin/buylist/${srId}`, { token: operatorToken });
      expect(admin.body.offerReissueCount).toBe(1);
      // Invariante de §11: `offerReissueCount > 0 ⇔ offerIssueClockStartedAt IS NOT NULL`.
      const row = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
      expect(row!.offerIssueClockStartedAt).not.toBeNull();
    });
  });
});

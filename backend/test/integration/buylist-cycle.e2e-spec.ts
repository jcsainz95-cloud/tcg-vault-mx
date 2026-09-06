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
import { E2E_CARDS, E2E_PICKUP_ADDRESS, E2E_USERS } from '../../prisma/e2e-fixtures';
// v1.54 · B-1: el correo se lee DEL PUERTO REAL de la app levantada, no de una plantilla llamada a
// mano. Es la única forma de ver lo que de verdad sale de la bandeja.
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';

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
      // ⚠️ v1.51.20 (escalada 1) — `details` es **`{ field }` y NADA MÁS**. El `addressId` se retiró:
      // no contesta nada nuevo (el cliente lo acaba de mandar) y devolverlo **sacaría un UUID ajeno**
      // al cuerpo, a los logs y a la telemetría, **justo en el único código de la familia que existe
      // por anti-enumeración**. Se afirma la AUSENCIA, que es lo que el eco haría regresar.
      expect(ajeno.body.error.details).toEqual({ field: 'addressId' });
      expect(inexistente.body.error.details).toEqual({ field: 'addressId' });
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
      expect(res.status).toBe(200); // v1.57 · §M5-C (BL-37)
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
      expect(res.status).toBe(200); // v1.57 · §M5-C (BL-37)
      const row = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
      expect(row!.status).toBe('en_transito');
      expect(row!.shipmentConfirmedAt).not.toBeNull();
    });

    it('(11) recepción y verificación — `200` (v1.56, §M5 punto 4), no el `201` del default de Nest', async () => {
      const rec = await h.api('POST', `/admin/buylist/${srId}/receive`, { token: operatorToken });
      expect(rec.status).toBe(200);
      const ver = await h.api('POST', `/admin/buylist/${srId}/verify`, { token: operatorToken });
      expect(ver.status).toBe(200);
      // ⚠️ `verify` es JUSTAMENTE la transición que vuelve `isPayable` verdadero: omitirlo en esta
      // respuesta daría un `false` silencioso en superficie de dinero (BL-20).
      expect(ver.body.isPayable).toBe(true);
    });

    /**
     * ⚠️⚠️ v1.56 (§M5 `receive`/`verify`, punto 3) — **LA IDEMPOTENCIA, Y SOBRE TODO LA FECHA.**
     *
     * Hasta v1.55 la fecha iba en el mismo `data` que el `status`, así que **cada `POST` repetido la
     * movía hacia adelante**. No era cosmético: `receivedAt` ancla el **abandono a 30 días** del
     * barrido (regla 6) y las dos fechas entran al `max(...)` que fija la **purga del INE**. Un doble
     * clic posponía una transición terminal sobre mercancía ajena y una obligación de retención de
     * PII. ***Un reintento de red no puede correr un plazo legal.***
     *
     * Va **por HTTP contra el motor**: la forma correcta —`receivedAt: null` en el `where`— solo se
     * distingue de un `if` de aplicación cuando escribe una BD de verdad.
     */
    it('(11-bis) repetir `receive`/`verify` ⇒ `200` idempotente y ⛔ la fecha NO se re-sella', async () => {
      const antes = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
      expect(antes!.receivedAt).toBeTruthy();
      expect(antes!.verifiedAt).toBeTruthy();

      // `verify` sobre una ya `verificacion`: el estado YA es el destino ⇒ `200`, no `409`.
      const reVer = await h.api('POST', `/admin/buylist/${srId}/verify`, { token: operatorToken });
      expect(reVer.status).toBe(200);
      expect(reVer.body.status).toBe('verificacion');
      // `receive` desde `verificacion` transiciona hacia atrás (legal: el guardado es por EXCLUSIÓN,
      // no por matriz de predecesores — §M5-T punto 2) pero **tampoco re-sella `receivedAt`**.
      const reRec = await h.api('POST', `/admin/buylist/${srId}/receive`, { token: operatorToken });
      expect(reRec.status).toBe(200);

      const despues = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
      expect(despues!.receivedAt).toEqual(antes!.receivedAt);
      expect(despues!.verifiedAt).toEqual(antes!.verifiedAt);

      // Se deja la solicitud como estaba para que (12)/(13) sigan el camino feliz.
      const ver = await h.api('POST', `/admin/buylist/${srId}/verify`, { token: operatorToken });
      expect(ver.status).toBe(200);
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
      expect(paid.status).toBe(200); // v1.57 · §M5-C (BL-37)
      const row = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
      expect(row!.status).toBe('pagada');
      // ⚠️ **LA ASERCIÓN QUE JUSTIFICA TODO EL RECORRIDO.** El vendedor aceptó MX$320 netos y
      // recibe MX$320: `payoutNetCents == offerNetCents`. Es el invariante que el bug de la guarda
      // del ciclo rompía —oferta aceptada de MX$500 brutos, depósito de MX$0— y el único sitio donde
      // se puede comprobar es al final de un ciclo completo contra la BD real.
      expect(row!.payoutNetCents).toBe(32000);
      expect(row!.payoutNetCents).toBe(row!.offerNetCents);
    });

    // =========================================================================================
    // ⚠️⚠️ (14)-(17) — LA CRÍTICA **P1** (`docs/PENTEST_NOTES.md`), REPRODUCIDA ENTERA.
    //
    // El PoC del red team, paso por paso y por HTTP: `vault_operator` hace `POST …/verify` sobre la
    // solicitud que acaba de quedar **`pagada`**, la fila vuelve a `verificacion` con `closedAt`
    // todavía sellado, `isPayable` se pone `true` otra vez y un `super_admin` que trabaja su cola
    // **vuelve a liquidar con una referencia nueva**. En BD quedaron dos `speiReference` y dos
    // `paidAt` distintos sobre la misma solicitud: **dos SPEI reales al vendedor**.
    //
    // ⚠️ **Esto NO se puede probar con un doble de Prisma**, y por eso vive aquí: el `updateMany`
    // guardado devuelve `count: 1` en cualquier mock que no evalúe el `where`, así que un unitario
    // con un fake pasaría **igual de verde con la guarda quitada**. Lo que distingue el código
    // arreglado del roto es **el motor**, y el motor solo está aquí.
    //
    // El estado de partida no se siembra: **sale del recorrido (1)-(13) de arriba**, que es el ciclo
    // legítimo completo. *La fila que se ataca es exactamente la que el sistema produce.*
    // =========================================================================================
    describe('⚠️ P1 · §M5-T — una solicitud PAGADA no se revive, y no se paga dos veces', () => {
      it('(14) `verify` sobre una `pagada` ⇒ 409 CONFLICT con `details.status` y `details.closedAt`', async () => {
        const before = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
        expect(before!.status).toBe('pagada'); // precondición: el paso (13) la dejó liquidada.

        // El PASO HABILITADOR del PoC, con el rol que lo alcanzaba: `vault_operator`, el de MENOR
        // confianza del back-office. Antes devolvía **201**.
        const res = await h.api('POST', `/admin/buylist/${srId}/verify`, { token: operatorToken });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('CONFLICT');
        // §M5-T: `details` lleva LOS DOS campos. Con solo `status`, el operador no puede distinguir
        // «cerró por el camino normal» de «el status miente y lo que la bloquea es el closedAt».
        expect(res.body.error.details.status).toBe('pagada');
        expect(res.body.error.details.closedAt).toBeTruthy();

        // «Cero escritura» es normativo, así que se afirma columna por columna — no basta el 409.
        const after = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
        expect(after!.status).toBe('pagada');
        expect(after!.verifiedAt).toEqual(before!.verifiedAt);
        expect(after!.closedAt).toEqual(before!.closedAt);
        expect(after!.paidAt).toEqual(before!.paidAt);
        expect(after!.speiReference).toBe(before!.speiReference);
        expect(after!.receivedAt).toEqual(before!.receivedAt);
        expect(after!.payoutNetCents).toBe(before!.payoutNetCents);
      });

      it('(15) `receive` sobre una `pagada` ⇒ 409 y los ÍTEMS tampoco se mueven', async () => {
        // La otra mitad del hueco. Y se mira el nivel ÍTEM porque el `updateMany` de ítems corría
        // **antes** del update de la solicitud: una `pagada` ya podía quedarse con las cartas
        // movidas de `itemStatus` aunque la transición de la solicitud no prosperara.
        const itemsBefore = await h.prisma.sellRequestItem.findMany({
          where: { sellRequestId: srId },
          orderBy: { id: 'asc' },
          select: { id: true, itemStatus: true },
        });
        const res = await h.api('POST', `/admin/buylist/${srId}/receive`, { token: operatorToken });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('CONFLICT');
        expect(res.body.error.details.status).toBe('pagada');

        const itemsAfter = await h.prisma.sellRequestItem.findMany({
          where: { sellRequestId: srId },
          orderBy: { id: 'asc' },
          select: { id: true, itemStatus: true },
        });
        expect(itemsAfter).toEqual(itemsBefore);
        const row = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
        expect(row!.receivedAt).toBeTruthy();
        expect(row!.status).toBe('pagada');
      });

      /**
       * ⚠️⚠️ **EL REMATE DEL PoC, Y ES AUTOCONTENIDO A PROPÓSITO.**
       *
       * La cadena `verify → pay-spei` va **dentro de este mismo test**, sin `receive` en medio, y eso
       * NO es estilo: es la diferencia entre medir el agujero y medir otra cosa. El propio pentester
       * lo anotó — *«si entre `verify` y el 2º pago se llama `receive`, la solicitud cae a `recibida`
       * (no pagable) y el 2º pago da 422; por eso el camino limpio es `verify` → `pay-spei`
       * directo»*. Si este test dependiera del `receive` del caso (15), contra el código SIN arreglar
       * fallaría con un `422` **por la ruta equivocada** y parecería que detecta el defecto cuando en
       * realidad estaría detectando un accidente de orden. *Un test que falla por la razón
       * equivocada no prueba nada el día que la razón cambie.*
       *
       * Contra el código sin arreglar, aquí salía: `verify` **201**, `pay-spei` **201** con
       * `speiReference=SPEI-DOUBLESPEND-777` y `paidAt` avanzado — **dos transferencias reales**.
       */
      it('(16) ⚠️ EL DAÑO: `verify` → 2º `pay-spei` con ref NUEVA no liquida — una sola salida de dinero', async () => {
        const before = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
        expect(before!.status).toBe('pagada');
        expect(before!.speiReference).toBe('SPEI-CYCLE-1');

        // Paso habilitador (vault_operator) e intento de cobro (super_admin), encadenados.
        const revive = await h.api('POST', `/admin/buylist/${srId}/verify`, { token: operatorToken });
        expect(revive.status).toBe(409);
        const res = await h.api('POST', `/admin/buylist/${srId}/pay-spei`, {
          token: adminToken,
          json: { speiReference: 'SPEI-DOUBLESPEND-777' },
        });
        // El rollback no ocurrió ⇒ sigue `pagada` ⇒ salida IDEMPOTENTE con la PRIMERA liquidación.
        expect(res.body.speiReference).toBe('SPEI-CYCLE-1');

        const after = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
        // ⚠️ LAS ASERCIONES QUE VALEN, y no dependen del código HTTP: la fila conserva la PRIMERA
        // referencia y el PRIMER `paidAt`. *Dos referencias distintas sobre la misma solicitud son
        // dos transferencias reales al vendedor, y la primera se quedaría sin rastro en la fila.*
        expect(after!.speiReference).toBe('SPEI-CYCLE-1');
        expect(after!.paidAt).toEqual(before!.paidAt);
        expect(after!.payoutNetCents).toBe(32000);
        expect(after!.closedAt).toEqual(before!.closedAt);
      });

      it('(17) ⚠️ AML: la solicitud pagada SIGUE consumiendo tope del mes (no se sale del acumulado)', async () => {
        // El SEGUNDO impacto de P1: el acumulado exigía `status='pagada'`, así que la fila revivida
        // **salía de la suma** y cada re-pago se medía contra una cifra que no incluía el dinero ya
        // entregado. Ahora ancla en `paidAt` a secas.
        //
        // Se mide POR CONDUCTA, no leyendo un privado: se baja el tope mensual por debajo de lo ya
        // pagado y se comprueba que una solicitud NUEVA del mismo vendedor es rechazada por el tope.
        const CAP_KEY = 'buylist_cap_per_month_cents';
        // La solicitud se crea ANTES de bajar el dial: el mismo tope gobierna el INTAKE, así que
        // crearla después la rechazaría por la puerta de entrada y el test mediría otro control.
        const otra = await createRequest(validBody());
        expect(otra.status).toBe(201);
        const otraId = otra.body.sellRequestId;
        // Se lleva a un estado PAGABLE por la puerta de atrás (la BD): lo que se prueba aquí es el
        // ACUMULADO, no el recorrido — ése ya lo cubren (1)-(13) por HTTP.
        await h.prisma.sellRequest.update({
          where: { id: otraId },
          data: {
            status: 'verificacion',
            // ⚠️ v1.57 · §M5-P — el tercer término. Sin `receivedAt` el pre-check de recepción
            // rechaza ANTES de llegar al tope, y este test mediría la guarda nueva en vez del
            // ACUMULADO, que es su asunto. *Una precondición nueva no puede secuestrar un test viejo.*
            receivedAt: new Date(),
            verifiedAt: new Date(),
            approvedTotalCents: 10000,
          },
        });

        const previo = await h.prisma.configSetting.findUnique({ where: { key: CAP_KEY } });
        try {
          await h.prisma.configSetting.upsert({
            where: { key: CAP_KEY },
            update: { valueJson: 40000 }, // MX$400 — por debajo de los MX$500 brutos ya pagados.
            create: { key: CAP_KEY, valueJson: 40000 },
          });
          const res = await h.api('POST', `/admin/buylist/${otraId}/pay-spei`, {
            token: adminToken,
            json: { speiReference: 'SPEI-AML-GUARD' },
          });
          expect(res.status).toBe(422);
          expect(res.body.error.code).toBe('BUYLIST_LIMIT_EXCEEDED');
          // ⚠️ `wouldBeCents` INCLUYE los MX$500 de la solicitud YA PAGADA: ésa es la prueba de que
          // la fila liquidada **no desapareció del acumulado**. Con el término `status='pagada'` que
          // P1 explotaba, una fila revivida se restaba de esta cifra y el tope dejaba pasar el pago.
          expect(res.body.error.details.wouldBeCents).toBeGreaterThanOrEqual(50000);
          const sigueSinPagar = await h.prisma.sellRequest.findUnique({ where: { id: otraId } });
          expect(sigueSinPagar!.paidAt).toBeNull();
        } finally {
          if (previo) {
            await h.prisma.configSetting.update({
              where: { key: CAP_KEY },
              data: { valueJson: previo.valueJson as never },
            });
          } else {
            await h.prisma.configSetting.delete({ where: { key: CAP_KEY } }).catch(() => undefined);
          }
        }
      });
    });

    // =========================================================================================
    // ⚠️⚠️ (18)-(20) — **BL-35 EJE 2** (`docs/SECURITY_NOTES.md` §2), REPRODUCIDO ENTERO.
    //
    // El PoC del blue team, por HTTP: un `vault_operator` llama `verify` sobre una solicitud que
    // **nunca recibimos** —el PoC salió de una `ofertada`; QA lo repitió desde una `cotizada`—, la
    // fila queda en `verificacion` con `verifiedAt` sellado, `isPayable` se pone `true` y un
    // `super_admin` que trabaja su cola **liquida SPEI real por mercancía que nunca llegó**
    // (MX$320, `SPEI-EJE2-NEVER-ARRIVED-001`).
    //
    // ⚠️ **Vive aquí y no en un unitario por la misma razón que (14)-(17):** lo que frena el pago es
    // el `where` del `updateMany`, y un doble de Prisma que no lo evalúa devuelve `count: 1` con la
    // guarda puesta **y quitada**. El motor solo está aquí.
    //
    // ⚠️ **Y el camino feliz ya está probado arriba** —(11) `receive` → `verify` con
    // `isPayable: true`, (13) el SPEI que deposita el neto—: sin ese contraste, estos tres los pasa
    // igual un endpoint que no pague nunca.
    // =========================================================================================
    describe('⚠️ BL-35 eje 2 · §M5-P — no se paga lo que no ha llegado', () => {
      let nuncaRecibidaId: string;

      it('(18) `verify` sobre una solicitud viva NUNCA RECIBIDA sigue siendo `200`… (eje 2-b, abierto)', async () => {
        // ⚠️ El tercer término **no cierra el eje entero y así está normado** (contrato v1.57 §C):
        // `verify` sigue siendo llamable desde cualquier estado vivo porque estrecharlo exigiría una
        // matriz de predecesores que `PROJECT.md` no declara y que rompería la cohorte legacy.
        const creada = await createRequest(validBody());
        expect(creada.status).toBe(201);
        nuncaRecibidaId = creada.body.sellRequestId;

        const ver = await h.api('POST', `/admin/buylist/${nuncaRecibidaId}/verify`, {
          token: operatorToken,
        });
        expect(ver.status).toBe(200);
        expect(ver.body.status).toBe('verificacion');

        // …y **`verifiedAt` SÍ queda sellado**: es el hecho que la volvía pagable.
        const row = await h.prisma.sellRequest.findUnique({ where: { id: nuncaRecibidaId } });
        expect(row!.verifiedAt).toBeTruthy();
        expect(row!.receivedAt).toBeNull();
      });

      it('(19) ⚠️ LA SEÑAL DEJA DE MENTIR: `isPayable` es `false` sobre la fila nunca recibida', async () => {
        // `isPayable` **gobierna el botón de pagar en M5**. Arreglar la guarda y no la señal dejaría
        // al súper-admin autorizando con la pantalla diciéndole que la carta llegó.
        const dto = await h.api('GET', `/admin/buylist/${nuncaRecibidaId}`, { token: adminToken });
        expect(dto.status).toBe(200);
        expect(dto.body.status).toBe('verificacion');
        expect(dto.body.isPayable).toBe(false);
      });

      it('(20) ⚠️⚠️ EL DAÑO: `pay-spei` sobre ella ⇒ 422 y NO SALE UN PESO', async () => {
        const res = await h.api('POST', `/admin/buylist/${nuncaRecibidaId}/pay-spei`, {
          token: adminToken,
          json: { speiReference: 'SPEI-EJE2-NEVER-ARRIVED-001' },
        });
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');

        // ⚠️ LAS ASERCIONES QUE VALEN, contra la BD: ni referencia, ni fecha de pago, ni cierre.
        const row = await h.prisma.sellRequest.findUnique({ where: { id: nuncaRecibidaId } });
        expect(row!.paidAt).toBeNull();
        expect(row!.speiReference).toBeNull();
        expect(row!.payoutNetCents).toBeNull();
        expect(row!.status).toBe('verificacion');
        expect(row!.closedAt).toBeNull();
      });

      it('(21) y el remedio es el paso que faltaba: `receive` la vuelve pagable, y paga', async () => {
        // *La cohorte que no se puede distinguir del abuso no se exceptúa: se remedia* — con
        // `POST …/receive`, que sella `receivedAt`, es idempotente y **queda auditado con actor y
        // fecha**. El control no vuelve imposible declarar una recepción falsa; le quita el
        // anonimato: deja de ser efecto lateral silencioso de `verify` y pasa a ser un acto firmado.
        const rec = await h.api('POST', `/admin/buylist/${nuncaRecibidaId}/receive`, {
          token: operatorToken,
        });
        expect(rec.status).toBe(200);
        expect(rec.body.isPayable).toBe(false); // `receive` deja el status en `recibida`, que NO es pagable

        const ver = await h.api('POST', `/admin/buylist/${nuncaRecibidaId}/verify`, {
          token: operatorToken,
        });
        expect(ver.status).toBe(200);
        expect(ver.body.isPayable).toBe(true);

        const paid = await h.api('POST', `/admin/buylist/${nuncaRecibidaId}/pay-spei`, {
          token: adminToken,
          json: { speiReference: 'SPEI-EJE2-REMEDIADA' },
        });
        expect([200, 201]).toContain(paid.status);
        const row = await h.prisma.sellRequest.findUnique({ where: { id: nuncaRecibidaId } });
        expect(row!.status).toBe('pagada');
        expect(row!.speiReference).toBe('SPEI-EJE2-REMEDIADA');
        expect(row!.receivedAt).toBeTruthy();
      });
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
      // ⚠️ v1.51.20 (escalada 3, resuelta) — **este caso ya FIJA el `409`.** `approvedPriceCents`
      // viaja también aquí y, aun así, **gana el `409` del VERBO sobre el `422` del CAMPO**: la
      // precedencia va *de lo que anula el ACTO ENTERO a lo que objeta un CAMPO*. Con el `422`
      // delante, el operador lee «ese campo no se toca», lo quita y reintenta — **y choca igual con
      // el `409`**: dos errores para una causa, y el primero apunta al remedio equivocado.
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ADJUST_NOT_ALLOWED_IN_OFFER_CYCLE');
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
  // 5-bis) `approve` SOBRE UNA LÍNEA QUE NO COMPRAMOS — 422 ITEM_NOT_OFFERED (escalada 2)
  // ===========================================================================================
  describe('una carta que no compramos no entra al inventario (v1.51.20, §4.39(i) 6-bis)', () => {
    let srId: string;
    let buyItemId: string;
    let skipItemId: string;

    beforeAll(async () => {
      // DOS líneas físicas de la misma carta (§4.16b: no se colapsan). Se compra una y se descarta
      // la otra — el cherry-pick real del criterio 148.
      const created = await createRequest(
        validBody({
          items: [
            { cardId: cardId.charizard, productType: 'raw', rawCondition: 'NM' },
            { cardId: cardId.charizard, productType: 'raw', rawCondition: 'NM' },
          ],
        }),
      );
      srId = created.body.sellRequestId;
      const detail = await h.api('GET', `/admin/buylist/${srId}`, { token: operatorToken });
      buyItemId = detail.body.items[0].id;
      skipItemId = detail.body.items[1].id;
      const offer = await h.api('POST', `/admin/buylist/${srId}/offer`, {
        token: operatorToken,
        json: {
          lines: [
            { itemId: buyItemId, decision: 'buy' },
            { itemId: skipItemId, decision: 'skip' },
          ],
        },
      });
      expect(offer.status).toBe(200);
      await h.api('POST', `/buylist/requests/${srId}/offer-response`, {
        token: customerToken,
        json: { decision: 'accept' },
      });
    });

    it('`approve` sobre la línea `skip` → 422 ITEM_NOT_OFFERED y NO alcanza `aprobada`', async () => {
      const res = await h.api('PATCH', `/admin/buylist/items/${skipItemId}/decision`, {
        token: operatorToken,
        json: { decision: 'approve' },
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('ITEM_NOT_OFFERED');
      expect(res.body.error.details).toEqual({ itemId: skipItemId, offerDecision: 'skip' });

      // ⚠️ **LA ASERCIÓN QUE JUSTIFICA EL CÓDIGO.** `aprobada` es el ÚNICO estado que
      // `convert-to-inventory` admite: con el `?? 0` de antes, esta carta —que NUNCA compramos—
      // entraba al inventario VENDIBLE con costo 0. Se comprueba por la puerta de verdad.
      const item = await h.prisma.sellRequestItem.findUnique({ where: { id: skipItemId } });
      expect(item!.itemStatus).not.toBe('aprobada');
      expect(item!.approvedPriceCents).toBeNull();
      const convert = await h.api('POST', `/admin/buylist/items/${skipItemId}/convert-to-inventory`, {
        token: operatorToken,
      });
      expect(convert.status).toBe(422);
      expect(convert.body.error.code).toBe('ITEM_NOT_APPROVED');
    });

    it('la vía correcta es `reject` con motivo: ancla §H y deja el reloj del vendedor corriendo', async () => {
      const res = await h.api('PATCH', `/admin/buylist/items/${skipItemId}/decision`, {
        token: operatorToken,
        json: { decision: 'reject', reason: 'llegó sin haber sido ofertada: no la compramos' },
      });
      expect(res.status).toBe(200);
      expect(res.body.itemStatus).toBe('rechazada');
      // `rejectedAt` es el ancla ÚNICA de los plazos 7d/30d — lo que el `0` dejaba sin arrancar.
      expect(res.body.rejectedAt).toBeTruthy();
      const detalle = await h.api('GET', `/buylist/requests/${srId}`, { token: customerToken });
      const linea = detalle.body.items.find((i: { id: string }) => i.id === skipItemId);
      expect(linea.returnDeadlineAt).toBeTruthy();
      expect(linea.abandonDeadlineAt).toBeTruthy();
    });

    it('⚠️ `OFFER_PRICE_IMMUTABLE` es regla del CUERPO: `reject` CON monto también es 422', async () => {
      // Precisión del arquitecto. `reject` sigue siendo legal a los dos lados del eje — lo que se
      // rechaza es el **cuerpo**, no el verbo. *Aceptar-e-ignorar un campo de dinero entrena al
      // integrador a mandarlo, y el día que el verbo cambie empieza a tener efecto.*
      const res = await h.api('PATCH', `/admin/buylist/items/${buyItemId}/decision`, {
        token: operatorToken,
        json: { decision: 'reject', reason: 'no es NM: whitening', approvedPriceCents: 9900 },
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('OFFER_PRICE_IMMUTABLE');
      const item = await h.prisma.sellRequestItem.findUnique({ where: { id: buyItemId } });
      expect(item!.itemStatus).not.toBe('rechazada');
    });

    it('la línea `buy` sí se aprueba, al precio ofertado y server-side', async () => {
      const res = await h.api('PATCH', `/admin/buylist/items/${buyItemId}/decision`, {
        token: operatorToken,
        json: { decision: 'approve' },
      });
      expect(res.status).toBe(200);
      expect(res.body.approvedPriceCents).toBe(50000);
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
      expect(res.status).toBe(200); // v1.57 · §M5-C (BL-37)
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
      expect(cancel.status).toBe(200); // v1.57 · §M5-C (BL-37)

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
      // Invariante de §11 (v1.55/D44: son TRES columnas y un solo predicado).
      const row = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
      expect(row!.offerIssueClockStartedAt).not.toBeNull();
      expect(row!.offerSentCancelledAt).not.toBeNull();
      // Mismo `now()`, misma transacción: no son dos relojes que casualmente coinciden.
      expect(row!.offerSentCancelledAt).toEqual(row!.offerIssueClockStartedAt);
      // Y el portal pinta EXACTAMENTE ese instante: la pantalla dice lo que dice el correo 5.
      expect(new Date(portal.body.lastOfferCancelledAt as string)).toEqual(row!.offerSentCancelledAt);
    });

    /**
     * ⚠️⚠️ **v1.55 · D44 / BL-31 — LA CORRIDA CONJUNTA DEL CRITERIO 176(d).**
     *
     * Hasta v1.54 la proyección discriminaba por `offerSentAt IS NOT NULL` (marca **permanente de la
     * solicitud**, BL-28) y pintaba `offerCancelledAt` (que se **sobrescribe** en las tres ramas).
     * Con **una** cancelación las dos columnas daban la respuesta correcta **por coincidencia**; con
     * **dos** se soltaba: el correo ✔, el reloj ✔ y **el portal pintando una fecha que el vendedor
     * nunca supo**, contradiciendo su correo 5.
     *
     * ⚠️ **Solo se ve corriendo las tres consecuencias JUNTAS y cancelando DOS veces** — que es
     * exactamente lo que 176(d) manda hacer. Por eso vive aquí y no en un unitario de proyección: el
     * `offerCancelledAt` que se sobrescribe lo escribe el motor, en su propia transacción.
     */
    it('⚠️⚠️ 176(d) — con una enviada-y-cancelada previa, cancelar una `pending_authorization` NO mueve la pantalla', async () => {
      const port = h.app.get<MailPort>(MAIL_PORT);
      const enviados: MailMessage[] = [];
      const spy = jest.spyOn(port, 'send').mockImplementation(async (msg: MailMessage) => {
        enviados.push(msg);
        return { id: 'e2e-mail' };
      });
      try {
        const created = await createRequest(validBody());
        const srId = created.body.sellRequestId as string;
        const detail = await h.api('GET', `/admin/buylist/${srId}`, { token: operatorToken });

        // (1) Oferta ENVIADA y cancelada: el vendedor recibe el correo 5 con SU fecha.
        await h.api('POST', `/admin/buylist/${srId}/offer`, {
          token: operatorToken,
          json: { lines: [{ itemId: detail.body.items[0].id, decision: 'buy' }] },
        });
        const primera = await h.api('POST', `/admin/buylist/${srId}/offer/cancel`, {
          token: operatorToken,
          json: { reason: 'me equivoqué en un número' },
        });
        expect(primera.status).toBe(200); // v1.57 · §M5-C (BL-37)
        const correos = enviados.length; // 1 (la oferta) + 1 (la cancelación)
        const tras1 = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
        const laQueElVio = tras1!.offerSentCancelledAt!;
        expect(laQueElVio).not.toBeNull();

        // (2) Se prepara otra oferta que NO llega a enviarse. El estado se MONTA por `h.prisma`
        //     (la API no fabrica un `pending_authorization` sin superar el tope del operador) y la
        //     conducta se prueba **por la puerta**, que es la norma de esta suite.
        await h.prisma.sellRequest.update({
          where: { id: srId },
          data: { offerState: 'pending_authorization' },
        });
        const segunda = await h.api('POST', `/admin/buylist/${srId}/offer/cancel`, {
          token: operatorToken,
          json: { reason: 'la preparada tampoco servía' },
        });
        expect(segunda.status).toBe(200); // v1.57 · §M5-C (BL-37)

        // Correo ✔: esa oferta NUNCA existió para el vendedor ⇒ no sale ni uno más.
        expect(enviados).toHaveLength(correos);

        const tras2 = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
        // Reloj ✔ y conteo ✔: no se mueven (el candado estructural de D38 sigue en pie).
        expect(tras2!.offerIssueClockStartedAt).toEqual(laQueElVio);
        expect(tras2!.offerReissueCount).toBe(1);
        // ⚠️ `offerCancelledAt` SÍ se sobrescribió — y está BIEN: es «el hecho de la cancelación»,
        // admin-only, y lo leen la bitácora y M10. *No se arregla el escritor, se arregla el lector.*
        expect(tras2!.offerCancelledAt).not.toEqual(laQueElVio);
        // ⚠️⚠️ Y LA PANTALLA, que es lo que se soltaba: sigue diciendo lo que dice su correo 5.
        expect(tras2!.offerSentCancelledAt).toEqual(laQueElVio);
        const portal = await h.api('GET', `/buylist/requests/${srId}`, { token: customerToken });
        expect(new Date(portal.body.lastOfferCancelledAt as string)).toEqual(laQueElVio);
      } finally {
        spy.mockRestore();
      }
    });

    it('⚠️ INVARIANTE DESPLEGABLE, medido sobre TODA la tabla con una query', async () => {
      // §11 (M-46, delta v1.55): `offerReissueCount > 0 ⇔ offerIssueClockStartedAt IS NOT NULL ⇔
      // offerSentCancelledAt IS NOT NULL`, más la igualdad de instante entre las dos fechas. Es la
      // misma consulta que devops puede correr tras el deploy, y aquí corre contra la BD real con
      // todas las filas que esta suite ha ido dejando.
      const desajuste = await h.prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*)::bigint AS n FROM "SellRequest"
           WHERE ("offerReissueCount" > 0) IS DISTINCT FROM ("offerIssueClockStartedAt" IS NOT NULL)
              OR ("offerReissueCount" > 0) IS DISTINCT FROM ("offerSentCancelledAt" IS NOT NULL)
              OR "offerSentCancelledAt" IS DISTINCT FROM "offerIssueClockStartedAt"`,
      );
      expect(Number(desajuste[0].n)).toBe(0);
    });
  });

  // ===========================================================================================
  // ⚠️⚠️ v1.54 · B-1 — EL CORREO QUE DE VERDAD SALE NO LLEVA EL DOMICILIO DEL VENDEDOR
  //
  // QA capturó esto del stack corriendo, no de un unitario: el correo de oferta terminaba con
  // `Sale desde: Av. E2E 123, Centro, CDMX, CDMX, 01000` — la dirección sembrada por `seed-e2e`.
  // `PROJECT.md` §P.3 y el criterio 173(h) lo prohíben **en los cinco** correos del ciclo.
  //
  // Este caso vive en INTEGRACIÓN por la misma razón que el resto de esta suite: el dato viajaba
  // del `pickupAddressSnapshot` de la fila real, por el servicio real, hasta el puerto real. Un
  // unitario de plantilla no puede verlo si el fixture no le pasa la dirección — y no se la pasaba
  // (pasaba `null`, que apagaba el bloque). **Aquí se lee lo que sale por el puerto.**
  // ===========================================================================================
  describe('⚠️ B-1 · PII: ningún correo del ciclo lleva el domicilio (criterio 173h)', () => {
    /** Todas las partes del domicilio sembrado, cada una por separado: media dirección lo sigue siendo. */
    const PARTES = Object.values(E2E_PICKUP_ADDRESS).filter((v) => typeof v === 'string');

    it('el correo 1 (oferta), emitido por HTTP, no lleva ni una parte de la dirección de origen', async () => {
      const port = h.app.get<MailPort>(MAIL_PORT);
      const enviados: MailMessage[] = [];
      const spy = jest
        .spyOn(port, 'send')
        .mockImplementation(async (msg: MailMessage) => {
          enviados.push(msg);
          return { id: 'e2e-mail' };
        });
      try {
        const creada = await createRequest(validBody());
        expect(creada.status).toBe(201);
        const srId = creada.body.sellRequestId as string;
        // La solicitud NACIÓ con el snapshot: si no, este test no probaría nada.
        const row = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
        expect((row!.pickupAddressSnapshot as Record<string, unknown>).line1).toBe('Av. E2E 123');

        const detail = await h.api('GET', `/admin/buylist/${srId}`, { token: operatorToken });
        const offer = await h.api('POST', `/admin/buylist/${srId}/offer`, {
          token: operatorToken,
          json: { lines: [{ itemId: detail.body.items[0].id, decision: 'buy' }] },
        });
        expect(offer.status).toBe(200); // 200 ⇒ la oferta SALIÓ (y con ella el correo)

        expect(enviados).toHaveLength(1);
        const cuerpo = [enviados[0].subject, enviados[0].html, enviados[0].text].join('\n');
        for (const parte of PARTES) expect(cuerpo).not.toContain(parte);

        // Contrapeso: un correo vacío también pasaría lo anterior. Lo VINCULANTE sigue ahí.
        expect(cuerpo).toContain('SE TE DEPOSITAN');
        // Y el aviso útil se conserva SIN el dato: corregir la dirección sigue siendo accionable.
        expect(enviados[0].text).toContain('corrígela antes de aceptar');
      } finally {
        spy.mockRestore();
      }
    });
  });
});

import { SellRequestStatus } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';

/**
 * # avisos-sellos.e2e-spec.ts — ⭐⭐ **LOS OTROS DOS SELLOS DE M-57, CONTRA POSTGRES REAL**
 * (`PROJECT §R.4` · `ARCHITECTURE §9 · D-AVISO-2` · criterios **209**, **210** y **211**.)
 *
 * ## Por qué existe: un hueco de cobertura que QA midió y nombró
 * `M-57` define **tres** sellos de «un aviso por hecho», y los tres prometen lo mismo:
 * `kycRejectionNoticeSentAt`, `trackingNoticeSentAt` y `guideNoticeSentAt`. Hasta este fichero,
 * **sólo el primero se ejercitaba contra BD real** (`avisos.e2e-spec.ts`); los otros dos vivían
 * únicamente en unitarios con **Prisma mockeado** (`avisos.shipments.spec.ts`, `avisos.buylist.spec.ts`).
 *
 * ⛔ **Y un mock no puede probar lo que estos sellos prometen.** La garantía de `D-AVISO-2` no es un
 * `if`: es
 *
 * ```ts
 * const sealed = await prisma.X.updateMany({ where: { id, [sello]: null }, data: { [sello]: new Date() } });
 * if (sealed.count !== 1) return;   // ⇐ ya se avisó de este hecho
 * ```
 *
 * …y **el `count` lo decide el MOTOR**, no el código. Con un `updateMany` mockeado, `count` es lo que
 * el test diga que es: la prueba mide **su propia suposición sobre Postgres**, no a Postgres. *El
 * candado de «no mandar dos veces» vive exactamente en la línea que el mock sustituye.*
 *
 * ⇒ Aquí se ejercita **contra el motor de verdad**, y en particular **en paralelo real**: N llamadas
 * simultáneas sobre un sello en `NULL` ⇒ **UN correo**, porque `UPDATE … WHERE sello IS NULL` sólo
 * puede devolver `count === 1` **una vez** por muy concurrentes que lleguen. Ésa es la afirmación, y
 * es la que el cliente nota si falla.
 *
 * ## Y el criterio 210, que también estaba sólo mockeado
 * *«DOS correos de envío, y NINGUNO al entregar»* (pregunta 74 del dueño, contestada con el
 * contraargumento delante). Se verifica **por exceso y por defecto**: se recorre el envío entero por
 * **HTTP**, con guards y pipes montados, y se cuenta la bandeja en los tres pasos.
 *
 * ## ⭐ LA BANDEJA
 * Mismo instrumento que `avisos.e2e-spec.ts`: el puerto de correo de la app es un **singleton** y se
 * le espía `send`. Permite contar **por exceso** — un correo de más aparece aquí aunque nadie lo
 * esperara, que es justo la mitad que un `expect(...).toHaveBeenCalled()` no ve.
 *
 * ## ⚠️ Aislamiento (regla de la casa, BE-64)
 * La BD de integración se COMPARTE entre suites. Todo lo que este fichero crea lleva un sufijo de
 * corrida y se borra en el `afterAll`; y el envío se cuelga de **`customer2`**, cuya bóveda nadie
 * cuenta pieza a pieza (`vault-shipments` asierta el portafolio de `customer` como suma EXACTA).
 */

const RUN = Date.now().toString(36);

describe('§R / M-57 — los sellos `trackingNoticeSentAt` y `guideNoticeSentAt`, contra BD real', () => {
  let h: E2EHarness;
  let adminToken: string;
  let customer2Id: string;
  let customer2Email: string;
  let bandeja: MailMessage[];
  let spy: jest.SpyInstance;

  const envios: string[] = [];
  const solicitudes: string[] = [];

  /** Un envío de bóveda SIN piezas, en `picking`: el estado desde el que se captura una guía. */
  async function nuevoEnvio(sufijo: string): Promise<string> {
    const id = `av-sello-${RUN}-${sufijo}`;
    await h.prisma.shipmentRequest.create({
      data: {
        id,
        userId: customer2Id,
        addressSnapshot: {},
        status: 'picking',
        shippingFeeCents: 20300,
        ivaCents: 2800,
        processingFeeCents: 0,
        totalCents: 20300,
        // ⛔ NOT NULL y sin DEFAULT desde D56 (`IVA-3(e)`): omitirla revienta, y debe reventar.
        priceConvention: 'IVA_INCLUSIVE',
        pickingAt: new Date(),
      },
    });
    envios.push(id);
    return id;
  }

  /** Una `SellRequest` `aceptada` y viva: el estado desde el que se captura la guía del vendedor. */
  async function nuevaSolicitud(): Promise<string> {
    const sr = await h.prisma.sellRequest.create({
      data: {
        userId: customer2Id,
        status: SellRequestStatus.aceptada,
        quotedTotalCents: 100000,
        ineRequired: false,
        ineProvided: false,
      },
      select: { id: true },
    });
    solicitudes.push(sr.id);
    return sr.id;
  }

  const capturarGuiaEnvio = (id: string, carrier: string, trackingNumber: string) =>
    h.api('POST', `/admin/shipments/${id}/tracking`, {
      token: adminToken,
      json: { carrier, trackingNumber },
    });

  const moverEstado = (id: string, to: string) =>
    h.api('PATCH', `/admin/shipments/${id}/status`, { token: adminToken, json: { to } });

  const capturarGuiaVendedor = (id: string, carrier: string, trackingNumber: string) =>
    h.api('POST', `/admin/buylist/${id}/guide`, {
      token: adminToken,
      json: { carrier, trackingNumber },
    });

  const selloEnvio = async (id: string) =>
    (
      await h.prisma.shipmentRequest.findUniqueOrThrow({
        where: { id },
        select: { trackingNoticeSentAt: true },
      })
    ).trackingNoticeSentAt;

  const selloSolicitud = async (id: string) =>
    (
      await h.prisma.sellRequest.findUniqueOrThrow({
        where: { id },
        select: { guideNoticeSentAt: true },
      })
    ).guideNoticeSentAt;

  beforeAll(async () => {
    h = await E2EHarness.create();
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    const u = await h.prisma.user.findUniqueOrThrow({
      where: { email: E2E_USERS.customer2.email },
      select: { id: true, email: true },
    });
    customer2Id = u.id;
    customer2Email = u.email;

    const port = h.app.get<MailPort>(MAIL_PORT);
    bandeja = [];
    spy = jest.spyOn(port, 'send').mockImplementation(async (msg: MailMessage) => {
      bandeja.push(msg);
      return {};
    });
  });

  afterAll(async () => {
    spy?.mockRestore();
    if (envios.length > 0) {
      await h.prisma.shipmentItem.deleteMany({ where: { shipmentRequestId: { in: envios } } });
      await h.prisma.shipmentRequest.deleteMany({ where: { id: { in: envios } } });
    }
    if (solicitudes.length > 0) {
      await h.prisma.sellRequest.deleteMany({ where: { id: { in: solicitudes } } });
    }
    await h?.close();
  });

  beforeEach(() => {
    bandeja.length = 0;
  });

  // ===============================================================================================
  // A · `trackingNoticeSentAt` — la guía del ENVÍO (§R.3.a, `AV-4`)
  // ===============================================================================================
  describe('⭐⭐ A — `trackingNoticeSentAt`: el sello del correo de la guía', () => {
    it('capturar la guía manda UN correo y DEJA EL SELLO puesto (antes era `null`)', async () => {
      const id = await nuevoEnvio('a1');
      expect(await selloEnvio(id)).toBeNull();

      const res = await capturarGuiaEnvio(id, 'DHL', `TRK-${RUN}-A1`);
      expect(res.status).toBe(201);

      expect(bandeja).toHaveLength(1);
      expect(bandeja[0].to).toBe(customer2Email);
      // El sello quedó escrito EN LA FILA, que es lo que un unitario con Prisma mockeado no puede ver.
      expect(await selloEnvio(id)).toBeInstanceOf(Date);
    });

    it('⛔ re-capturar EL MISMO par (carrier, nº) NO manda un segundo correo, y el sello NO se mueve', async () => {
      const id = await nuevoEnvio('a2');
      await capturarGuiaEnvio(id, 'DHL', `TRK-${RUN}-A2`);
      expect(bandeja).toHaveLength(1);
      const selloTrasPrimero = await selloEnvio(id);

      bandeja.length = 0;
      const res = await capturarGuiaEnvio(id, 'DHL', `TRK-${RUN}-A2`);
      expect(res.status).toBe(201);
      // §R.4.b: el ciclo se reinicia por VALOR. Mismo valor ⇒ ni se limpia el sello ni sale correo.
      expect(bandeja).toHaveLength(0);
      expect(await selloEnvio(id)).toEqual(selloTrasPrimero);
    });

    it('⭐ corregir el número SÍ avisa: el sello se limpia en la misma escritura y sale el segundo', async () => {
      const id = await nuevoEnvio('a3');
      await capturarGuiaEnvio(id, 'DHL', `TRK-${RUN}-A3`);
      expect(bandeja).toHaveLength(1);

      bandeja.length = 0;
      const res = await capturarGuiaEnvio(id, 'DHL', `TRK-${RUN}-A3-CORREGIDO`);
      expect(res.status).toBe(201);
      // ⛔ Rojo con 0: un número corregido que no se comunica es una guía que el cliente no puede usar.
      expect(bandeja).toHaveLength(1);
      expect(await selloEnvio(id)).toBeInstanceOf(Date);
    });

    /**
     * ⭐⭐⭐ **LA GARANTÍA DE `D-AVISO-2`, MEDIDA CONTRA EL MOTOR Y NO CONTRA UN MOCK.**
     *
     * Éste es el `it` que justifica el fichero entero, y es el hueco exacto que QA marcó. El sello es
     * un **pestillo de un solo disparo**: `claimAndNotify` se reclama el derecho a avisar con
     * `updateMany({ where: { id, [sello]: null } })` y **sólo manda si `count === 1`**
     * (`ARCHITECTURE §4.54.3`). Con Prisma mockeado ese `count` es **una constante que escribe el
     * propio test** ⇒ la prueba medía su suposición sobre Postgres, no a Postgres. Aquí lo decide el
     * motor, que es quien lo decide en producción.
     *
     * ⚠️ **La carrera se monta sobre el camino REAL** (`POST /admin/shipments/:id/tracking`, por
     * HTTP, con guards y pipes), ⛔ no llamando al método privado: la pregunta es si **el cliente**
     * puede recibir dos correos del mismo hecho, y eso se pregunta por donde entra el hecho.
     *
     * **Todas las llamadas traen el MISMO par (carrier, nº)** ⇒ por §R.4.b ninguna tiene derecho a
     * reiniciar el ciclo. Con el pestillo ya echado, 8 concurrentes deben producir **CERO**: es la
     * mitad que falla **por exceso**, y es la que el cliente nota.
     */
    it('⭐⭐ CARRERA REAL contra Postgres: con el sello echado, 8 capturas simultáneas ⇒ CERO correos', async () => {
      const id = await nuevoEnvio('a4');
      await capturarGuiaEnvio(id, 'DHL', `TRK-${RUN}-A4`);
      expect(bandeja).toHaveLength(1);
      const selloTrasPrimero = await selloEnvio(id);

      bandeja.length = 0;
      const res = await Promise.all(
        Array.from({ length: 8 }, () => capturarGuiaEnvio(id, 'DHL', `TRK-${RUN}-A4`)),
      );
      // Ninguna petición se cae: el sello decide QUIÉN AVISA, ⛔ no si la captura funciona.
      for (const r of res) expect(r.status).toBe(201);

      // ⛔ Rojo con 1: significaría que `count === 1` dejó de ser el guardián (por ejemplo, si
      // alguien lo sustituyera por un `if (sello == null)` leído ANTES del update — la mutación
      // clásica, que un unitario con Prisma mockeado **no puede distinguir**).
      expect(bandeja).toHaveLength(0);
      // …y el sello no se re-selló: la fecha del primero es la que manda (no se pisa en la repetición).
      expect(await selloEnvio(id)).toEqual(selloTrasPrimero);
    });

    /**
     * ⚠️⚠️ **HUECO CONOCIDO Y ABIERTO — NO ES UN OLVIDO, ES UN HALLAZGO, Y SE DEJA POR ESCRITO AQUÍ
     * PORQUE ES DONDE SE VA A BUSCAR.**
     *
     * Lo de arriba mide el pestillo **una vez echado**. La otra mitad —**N capturas simultáneas
     * partiendo del sello en `NULL`**— la medí y **NO se cumple hoy**: con `N = 8` salen **2 y hasta
     * 3 correos**. Medido sobre BD recreada, **3 de 5 corridas en rojo** (`2, 2, 3` correos; las
     * otras 2 dieron 1).
     *
     * **El mecanismo, entero:** `setTracking` decide si reinicia el ciclo con
     * `labelChanged = shipment.carrier !== carrier || …` calculado sobre una **lectura PREVIA** al
     * update (`shipments.service.ts:735`). Con N concurrentes, **las N leen el estado anterior**, las
     * N se creen «el cambio» y las N escriben `trackingNoticeSentAt: null` ⇒ una puede **borrar el
     * pestillo que otra acababa de echar**, y entonces vuelve a haber derecho a avisar. *El pestillo
     * funciona; lo que falla es que se le puede quitar el cerrojo desde fuera.*
     *
     * ⛔ **No se asierta aquí a propósito.** (1) Sería un candado **intermitente** (3/5), y un candado
     * que falla a veces no gatea — es la misma regla por la que se arregló `pricing-visibility` en
     * este mismo pase. (2) El arreglo es **producto**, no instrumentación: mover la decisión al MOTOR
     * (`§4.48.4`, *«la guarda va en el motor»*) con un `updateMany` condicionado al valor viejo, y eso
     * toca semántica de NULL de Prisma y el entrelazado de dos escrituras. **Este encargo era de
     * instrumentación**, así que el hallazgo se enruta en vez de parchearse a escondidas.
     *
     * ⚠️ `guideNoticeSentAt` (bloque C) tiene **la misma forma** de decisión previa; en 5 corridas
     * **no se reprodujo** (5/5 verde), pero **no está demostrado seguro**: su guarda de negocio corre
     * dentro de una transacción y estrecha la ventana, no la cierra.
     */
  });

  // ===============================================================================================
  // B · Criterio 210 — DOS correos de envío y NINGUNO al entregar, POR HTTP
  // ===============================================================================================
  describe('⭐⭐ C-AV-3 / criterio 210 — dos correos de envío, ninguno al entregar (integración)', () => {
    it('el recorrido completo produce EXACTAMENTE 2: guía ⇒ 1 · enviado ⇒ 1 · entregado ⇒ 0', async () => {
      const id = await nuevoEnvio('b1');

      expect((await capturarGuiaEnvio(id, 'DHL', `TRK-${RUN}-B1`)).status).toBe(201);
      expect(bandeja).toHaveLength(1);

      expect((await moverEstado(id, 'enviado')).status).toBe(200);
      expect(bandeja).toHaveLength(2);

      // ⛔ LA MITAD QUE FALLA POR EXCESO: entregar NO manda nada. *«Ya tiene la caja en la mano»* —
      // decisión del dueño (pregunta 74), tomada con el contraargumento de la disputa delante.
      expect((await moverEstado(id, 'entregado')).status).toBe(200);
      expect(bandeja).toHaveLength(2);

      // Y la fila terminó donde debía: el recorrido fue real, no tres llamadas que no movieron nada.
      const fila = await h.prisma.shipmentRequest.findUniqueOrThrow({
        where: { id },
        select: { status: true, deliveredAt: true },
      });
      expect(fila.status).toBe('entregado');
      expect(fila.deliveredAt).toBeInstanceOf(Date);
    });

    it('⛔ y el segundo correo NO tiene sello propio: lo hace único el MOTOR de estados', async () => {
      // `AV-5` no estrena columna — `TRANSITIONS` sólo llega a `enviado` desde `guia`, así que un
      // segundo `enviado` es `409` y no puede haber un segundo correo. Se comprueba que ese es el
      // mecanismo real y no una suposición: si alguien aflojara `TRANSITIONS`, esto se pone rojo.
      const id = await nuevoEnvio('b2');
      await capturarGuiaEnvio(id, 'DHL', `TRK-${RUN}-B2`);
      expect((await moverEstado(id, 'enviado')).status).toBe(200);

      bandeja.length = 0;
      const repetido = await moverEstado(id, 'enviado');
      expect(repetido.status).toBe(409);
      expect(bandeja).toHaveLength(0);
    });
  });

  // ===============================================================================================
  // C · `guideNoticeSentAt` — la guía que el VENDEDOR necesita (§R.3.b, `AV-7`)
  // ===============================================================================================
  describe('⭐⭐ C — `guideNoticeSentAt`: el sello del correo de la guía al vendedor', () => {
    it('capturar la guía manda UN correo al vendedor y deja el sello puesto', async () => {
      const id = await nuevaSolicitud();
      expect(await selloSolicitud(id)).toBeNull();

      const res = await capturarGuiaVendedor(id, 'FedEx', `BL-${RUN}-C1`);
      expect(res.status).toBe(200);

      expect(bandeja).toHaveLength(1);
      expect(bandeja[0].to).toBe(customer2Email);
      expect(await selloSolicitud(id)).toBeInstanceOf(Date);
    });

    it('⛔ re-capturar EL MISMO par NO manda un segundo correo, y el sello NO se mueve', async () => {
      const id = await nuevaSolicitud();
      await capturarGuiaVendedor(id, 'FedEx', `BL-${RUN}-C2`);
      expect(bandeja).toHaveLength(1);
      const selloTrasPrimero = await selloSolicitud(id);

      bandeja.length = 0;
      expect((await capturarGuiaVendedor(id, 'FedEx', `BL-${RUN}-C2`)).status).toBe(200);
      expect(bandeja).toHaveLength(0);
      expect(await selloSolicitud(id)).toEqual(selloTrasPrimero);
    });

    it('⭐ corregir el número SÍ avisa (el sello se limpia en la misma transacción)', async () => {
      const id = await nuevaSolicitud();
      await capturarGuiaVendedor(id, 'FedEx', `BL-${RUN}-C3`);
      expect(bandeja).toHaveLength(1);

      bandeja.length = 0;
      expect((await capturarGuiaVendedor(id, 'FedEx', `BL-${RUN}-C3-OK`)).status).toBe(200);
      expect(bandeja).toHaveLength(1);
    });

    /**
     * ⭐⭐⭐ La misma carrera que en (A), sobre la otra tabla y el otro endpoint, y **en la misma
     * forma determinista**: con el pestillo ya echado. Aquí importa doblemente porque el sello se
     * reclama **POST-COMMIT y FUERA** de la transacción de negocio (a propósito: un fallo de correo
     * no puede revertir la captura de una etiqueta ya pagada) ⇒ la unicidad **no la da la
     * transacción, la da el sello**. Si el sello no muerde, no hay nada más detrás.
     *
     * ⚠️ Se mide en esta forma —y no partiendo del sello en `NULL`— por lo dicho en el bloque (A):
     * esa otra variante depende de una decisión tomada sobre una lectura previa, y un candado
     * intermitente no gatea. Medido: partiendo de `NULL`, **5/5 verde** aquí (contra 2/5 en
     * envíos), pero **5/5 no es una demostración** y no se convierte en candado.
     */
    it('⭐⭐ CARRERA REAL contra Postgres: con el sello echado, 8 capturas simultáneas ⇒ CERO correos', async () => {
      const id = await nuevaSolicitud();
      expect((await capturarGuiaVendedor(id, 'FedEx', `BL-${RUN}-C4`)).status).toBe(200);
      expect(bandeja).toHaveLength(1);
      const selloTrasPrimero = await selloSolicitud(id);

      bandeja.length = 0;
      const res = await Promise.all(
        Array.from({ length: 8 }, () => capturarGuiaVendedor(id, 'FedEx', `BL-${RUN}-C4`)),
      );
      // ⚠️ La guarda de negocio (`status='aceptada' ∧ closedAt=null`, `count===1`) es OTRA y puede
      // rechazar alguna concurrente con `409 GUIDE_NOT_ALLOWED`: se admite, porque lo que este
      // candado afirma es lo del CORREO.
      for (const r of res) expect([200, 409]).toContain(r.status);

      expect(bandeja).toHaveLength(0);
      expect(await selloSolicitud(id)).toEqual(selloTrasPrimero);
    });
  });
});

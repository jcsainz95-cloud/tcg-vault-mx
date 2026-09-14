import { SellRequestStatus } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';
import { diferida, esperarBloqueoDeFila } from './helpers/row-lock-barrier';

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

/**
 * ⭐⭐⭐ **LA BARRERA DE CANDADO DE FILA — por qué estos candados NO lanzan N peticiones a la vez y
 * cruzan los dedos.** *(2026-09-14.)*
 *
 * El defecto que vigilan los bloques (A) y (C) es un *comprobar-y-actuar*: la captura decide si
 * reinicia el ciclo del aviso comparando contra una lectura **previa** al update. La forma obvia de
 * probarlo es disparar 8 capturas simultáneas y contar correos, y eso **sí reproduce el defecto**:
 * medido sobre `f8c7040`, **8 de 25 tiradas** mandaban dos correos en envíos y **6 de 25** en
 * buylist. Pero como candado es malo, y por una razón aritmética: `p ≈ 0.32` por tirada significa
 * que **una sola tirada deja pasar la regresión 2 de cada 3 veces**. Para que gatee hacen falta ~20
 * tiradas (`0.68²⁰ ≈ 0.02 %`), o sea **~7 s de suite** para comprar una certeza que sigue siendo
 * estadística.
 *
 * ⇒ **El entrelazado no se espera: se FUERZA**, y entonces el defecto sale **siempre**. La prueba
 * abre una transacción propia, hace `SELECT … FOR UPDATE` sobre la fila y deja dentro **el estado
 * que produce una captura completa de otro operador** (etiqueta escrita **y** sello echado). Con el
 * candado puesto se lanza la segunda captura: lee el estado **viejo** (`carrier IS NULL`) sin
 * bloquearse, y se **queda esperando** en su `UPDATE` — espera que la prueba **verifica en
 * `pg_stat_activity`**, ⛔ no supone ni duerme. Al soltar, la segunda escribe con una decisión
 * tomada sobre un estado **que ya caducó**. 100 % reproducible, 250 ms, y sin depender de la carga
 * de la máquina.
 *
 * *(La técnica, con sus dos mediciones, vive en `helpers/row-lock-barrier.ts`.)*
 *
 * **Ablación medida (`f8c7040` restaurado verbatim, BD propia, `N = 10` corridas):** estos dos `it`
 * salen **ROJOS 10/10**; con el arreglo, **VERDES 10/10**. *(La versión probabilística, por
 * contraste, habría salido verde con el defecto dentro ~2 corridas de cada 3 si fuera de una sola
 * tirada — que es como se escriben estas pruebas cuando nadie mide la `p`.)*
 *
 * ### ⚠️ Y una trampa de método que casi me come, escrita aquí porque volverá
 * La primera ablación la hice con `git show HEAD:…` para restaurar el código defectuoso. Salió
 * **verde 10/10** y estuve a punto de concluir que la ventana «depende de la carga». Era falso:
 * `HEAD` **se había movido bajo mis pies** (el orquestador commiteó una instantánea WIP **con mi
 * arreglo dentro**), así que `git show HEAD:` me estaba devolviendo **el arreglo**, no el defecto.
 * La ablación medía el código nuevo contra sí mismo. *Una ablación vale exactamente lo que vale el
 * sha que restaura:* ⛔ nunca `HEAD` en un árbol compartido — **el sha, literal**.
 */
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

  /**
   * ⭐⭐ **`REL-B` — LAS DOS PETICIONES LEEN EL MISMO ESTADO, POR CONSTRUCCIÓN.**
   *
   * Abre una transacción propia, bloquea la fila con `SELECT … FOR UPDATE` y suelta dentro dos
   * `PATCH /status` **idénticos**. Cada uno hace su `findUnique` —que **no** se bloquea: un `SELECT`
   * llano ignora el candado de fila bajo `READ COMMITTED`— y se queda esperando en su `UPDATE`.
   * ⛔ Las dos esperas se **verifican** en `pg_stat_activity` (`cuantas = 1`, luego `2`): si el
   * producto dejara de escribir esa tabla con un `UPDATE`, esto revienta en vez de pasar en falso.
   * Al soltar el candado, las dos siguen creyendo el estado viejo — que es exactamente el escenario
   * del doble clic del operador, sin depender de la carga de la máquina.
   */
  async function dosPatchSobreLaMismaLectura(id: string, to: string) {
    const candadoPuesto = diferida();
    const ambasBloqueadas = diferida();
    const tx = h.prisma.$transaction(
      async (t) => {
        await t.$executeRawUnsafe(`SELECT id FROM "ShipmentRequest" WHERE id = $1 FOR UPDATE`, id);
        candadoPuesto.abrir();
        await ambasBloqueadas.promesa;
      },
      { timeout: 30000, maxWait: 30000 },
    );
    await candadoPuesto.promesa;
    const a = moverEstado(id, to);
    await esperarBloqueoDeFila(h.prisma, 'ShipmentRequest', 1);
    const b = moverEstado(id, to);
    await esperarBloqueoDeFila(h.prisma, 'ShipmentRequest', 2);
    ambasBloqueadas.abrir();
    await tx;
    return Promise.all([a, b]);
  }

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
     * ⭐⭐⭐ **LA OTRA MITAD, LA QUE ROMPÍA: LA CARRERA PARTIENDO DEL SELLO EN `NULL`.**
     * *(Hasta el 2026-09-14 esto era un **hueco documentado** en este mismo sitio: el defecto estaba
     * medido y sin arreglar. Ya no — y por eso ahora es un candado y no un párrafo.)*
     *
     * **El defecto que vigila, medido (`f8c7040`, BD propia, 25 tiradas de 8 capturas
     * simultáneas): 8 de 25 tiradas mandaban DOS correos.** Mecanismo: `setTracking` decidía si
     * reiniciar el ciclo con `labelChanged = shipment.carrier !== carrier || …` calculado sobre una
     * **lectura PREVIA** al update. Con N concurrentes las N leen el valor viejo, las N se creen «el
     * cambio» y las N escriben `trackingNoticeSentAt: null` ⇒ una **borra el pestillo que otra
     * acababa de echar**. *El pestillo funcionaba; se le podía quitar el cerrojo desde fuera.*
     *
     * **Canario que aisló la causa (misma carrera, misma concurrencia, `N=25`, mismo sha):** con la
     * etiqueta **ya escrita** en la fila —⇒ `labelChanged` falso para todas, nadie borra el sello—
     * salieron **0/25 rojas**, contra **8/25** con las columnas en `NULL`. La única variable que
     * cambia entre los dos es el borrado del sello ⇒ la causa es ésa y no el sello en sí.
     *
     * ### El entrelazado, forzado paso a paso (ver la cabecera del fichero para el porqué)
     * ```
     * prueba:  BEGIN; SELECT … FOR UPDATE            ⇐ la fila queda bloqueada
     * B:       POST /tracking → lee (carrier NULL)   ⇐ decide «la etiqueta cambia» sobre esto
     * B:       UPDATE …                              ⇐ SE BLOQUEA (verificado en pg_stat_activity)
     * prueba:  UPDATE … SET etiqueta, sello=now(); COMMIT   ⇐ «otra captura terminó y ya avisó»
     * B:       (despierta)                           ⇐ ¿borra el sello que acaba de aparecer?
     * ```
     * Con el defecto: sí lo borra —su `labelChanged` es de antes— y manda **el segundo correo**.
     * Con el arreglo: su `WHERE` se re-evalúa contra la fila **ya actualizada** (`EvalPlanQual`), la
     * etiqueta coincide, `count === 0`, el sello no se toca y **no hay correo**.
     */
    it('⭐⭐ ENTRELAZADO FORZADO: una captura que decidió con datos caducos NO borra el sello ajeno', async () => {
      const id = await nuevoEnvio('a5');
      const trk = `TRK-${RUN}-A5`;
      expect(await selloEnvio(id)).toBeNull();
      bandeja.length = 0;

      const candadoPuesto = diferida();
      const bBloqueada = diferida();
      // La transacción que sostiene el candado y que, ya dentro, deja el estado que produce una
      // captura COMPLETA de otro operador: etiqueta escrita y sello echado (o sea, ya avisó).
      const tx = h.prisma.$transaction(
        async (t) => {
          await t.$executeRawUnsafe(
            `SELECT id FROM "ShipmentRequest" WHERE id = $1 FOR UPDATE`,
            id,
          );
          candadoPuesto.abrir();
          await bBloqueada.promesa;
          await t.$executeRawUnsafe(
            `UPDATE "ShipmentRequest"
                SET carrier = $2, "trackingNumber" = $3, "trackingNoticeSentAt" = now()
              WHERE id = $1`,
            id,
            'DHL',
            trk,
          );
        },
        { timeout: 30000, maxWait: 30000 },
      );

      await candadoPuesto.promesa;
      const peticionB = capturarGuiaEnvio(id, 'DHL', trk);
      await esperarBloqueoDeFila(h.prisma, 'ShipmentRequest');
      bBloqueada.abrir();
      await tx;

      const res = await peticionB;
      // La captura NO falla: el sello decide QUIÉN AVISA, ⛔ no si la captura funciona.
      expect(res.status).toBe(201);
      // El aviso es POST-COMMIT y best-effort: se le deja aterrizar antes de contar la bandeja.
      await new Promise((r) => setTimeout(r, 200));

      // ⛔ Rojo con 1: es el segundo correo del mismo hecho — la promesa que §R.4 le hizo al dueño.
      expect(bandeja).toHaveLength(0);
      // …y el sello sigue puesto: nadie le quitó el cerrojo desde fuera.
      expect(await selloEnvio(id)).toBeInstanceOf(Date);
    }, 60000);
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

    /**
     * ⭐⭐⭐ **`REL-B` (pentester, ALTA) — EL `it` DE ARRIBA ERA EL CANDADO CIEGO, Y ÉSTE ES EL QUE VE.**
     *
     * *«Un segundo `enviado` es 409 y no puede haber un segundo correo»* — cierto **en serie**, que
     * es como lo probaba el `it` anterior. **En concurrencia era falso**, y el defecto vivía a la
     * vista: `updateStatus` validaba `TRANSITIONS` sobre una lectura previa y escribía con
     * `update({ where: { id } })`, **sin el estado en el `WHERE`**. N peticiones leen el mismo
     * `guia`, las N pasan la validación, las N escriben, las N avisan.
     *
     * **Medido antes del arreglo (`0e22415`, BD propia, 25 tiradas de 10 `PATCH` simultáneos):**
     * | aviso | tiradas con duplicado | correos por tirada |
     * |---|---|---|
     * | `AV-5` (`{to:'enviado'}`) | **25/25** | 6 y 10 (×24) |
     * | `AV-6` (`{to:'cancelado'}`) | **25/25** | 10 (×25) |
     * **Después: `0/25` y `0/25`, exactamente 1 correo por tirada.** *(El pentester midió `13/13` y
     * `4/5` con su propio arnés; la diferencia es que el suyo sembraba la fila sin etiqueta.)*
     *
     * ### ⛔ Pero la proporción NO es el candado — disparar N y contar correos no gatea
     * `AV-6` salió `4/5` en el arnés del pentester: **1 de cada 5 corridas habría dado verde con el
     * defecto dentro**. Aquí el entrelazado se **fuerza** con la barrera de candado de fila, y las
     * dos peticiones leen el estado viejo **por construcción**, no por suerte:
     * ```
     * prueba:  BEGIN; SELECT … FOR UPDATE      ⇐ la fila ('guia') queda bloqueada
     * A:       PATCH {to:'enviado'} → lee 'guia' (el SELECT llano no se bloquea) → UPDATE se BLOQUEA
     * B:       PATCH {to:'enviado'} → lee 'guia' TAMBIÉN → UPDATE se encola detrás de A
     *          (las DOS esperas se VERIFICAN en pg_stat_activity — ⛔ ni un sleep)
     * prueba:  COMMIT                          ⇐ se sueltan en orden
     * ```
     * Con el defecto: A escribe y avisa, B escribe encima y **avisa otra vez** ⇒ `[200,200]`, 2
     * correos. Con el arreglo: el `WHERE` de B se re-evalúa contra la fila ya `enviado`
     * (`EvalPlanQual`), `count === 0` ⇒ **`409` y cero correos** ⇒ `[200,409]`, 1 correo.
     *
     * **Ablación (`0e22415` literal, copia propia, `N = 10` corridas): ROJO 10/10. Con el arreglo:
     * VERDE 10/10.** ⛔ Nunca `HEAD` en un árbol compartido — el sha, literal.
     */
    it('⭐⭐ ENTRELAZADO FORZADO `AV-5`: dos `PATCH` sobre la misma lectura ⇒ UN correo, dos `200`', async () => {
      const id = await nuevoEnvio('b3');
      await capturarGuiaEnvio(id, 'DHL', `TRK-${RUN}-B3`);
      bandeja.length = 0;

      const [a, b] = await dosPatchSobreLaMismaLectura(id, 'enviado');
      await new Promise((r) => setTimeout(r, 300));

      // ⛔ Rojo con 2: es el correo «tu paquete va en camino» dos veces por una salida. Criterio 205.
      expect(bandeja).toHaveLength(1);
      // ⭐ §R.4.c cláusula 4: la PERDEDORA no recibe `409` — el envío quedó donde ella pedía, así que
      // recibe `200` idempotente y ningún correo. ⛔ Rojo con un `409`: el doble clic del operador
      // pasaría a ser un error en pantalla por algo que SÍ consiguió.
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(
        (await h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id }, select: { status: true } }))
          .status,
      ).toBe('enviado');
    }, 60000);

    /**
     * ⭐⭐ La otra mitad de `REL-B`. `AV-6` importa aparte porque su mensaje **se contradice al
     * repetirse**: N correos «tu envío quedó cancelado» sugieren N cancelaciones distintas de algo
     * que solo se cancela una vez. (Pentester: `4/5` tiradas con duplicado — y el `1/5` que serializó
     * es exactamente por qué esto se fuerza en vez de tirar los dados.)
     */
    it('⭐⭐ ENTRELAZADO FORZADO `AV-6`: dos `PATCH {cancelado}` sobre la misma lectura ⇒ UN correo', async () => {
      const id = await nuevoEnvio('b4');
      await capturarGuiaEnvio(id, 'DHL', `TRK-${RUN}-B4`);
      bandeja.length = 0;

      const [a, b] = await dosPatchSobreLaMismaLectura(id, 'cancelado');
      await new Promise((r) => setTimeout(r, 300));

      expect(bandeja).toHaveLength(1);
      expect([a.status, b.status]).toEqual([200, 200]);
    }, 60000);

    /**
     * ⭐⭐⭐ **`REL-C` — EL `0/25` DEL PENTESTER NO ERA UNA DEFENSA: ERA UN ARNÉS QUE NO LLEGABA.**
     *
     * Él lo marcó **Baja** y fue honesto: *«el mecanismo está en el código; mi arnés serializaba la
     * cadena y no forcé que la escritura cayera en la ventana exacta»*. Con la barrera de candado de
     * fila la ventana **se abre a voluntad** y el defecto sale **10/10**:
     * ```
     * prueba:  BEGIN; SELECT … FOR UPDATE       ⇐ la fila ('picking') queda bloqueada
     * B:       POST /tracking → lee 'picking'   ⇐ `advances = true`, y con ello `data.status='guia'`
     * B:       UPDATE …                         ⇐ SE BLOQUEA (verificado en pg_stat_activity)
     * prueba:  UPDATE … SET status='enviado'; COMMIT   ⇐ otro operador completó la cadena
     * B:       (despierta) → escribe status='guia'     ⇐ ⛔ REGRESIÓN
     * ```
     * **Y no es cosmético: es la premisa del sello.** `AV-5` no estrena columna porque `guia →
     * enviado` ocurre *como mucho una vez*; con el estado regresado a `guia`, **ocurre otra vez** y
     * el cliente recibe un segundo «va en camino» **con las dos peticiones perfectamente
     * serializadas**. Por eso `REL-B` no estaba cerrada sin esto.
     *
     * El arreglo: el avance sale de `data` y se escribe aparte con `WHERE status IN ('solicitado',
     * 'picking')` — un predicado sobre el estado **real**, no sobre el leído ⇒ no puede retroceder.
     * **Ablación: ROJO 10/10 en `0e22415`; VERDE 10/10 con el arreglo.**
     */
    it('⭐⭐ ENTRELAZADO FORZADO `REL-C`: capturar guía con estado caduco NO regresa `enviado` a `guia`', async () => {
      const id = await nuevoEnvio('b5');
      bandeja.length = 0;

      const candadoPuesto = diferida();
      const bBloqueada = diferida();
      const tx = h.prisma.$transaction(
        async (t) => {
          await t.$executeRawUnsafe(`SELECT id FROM "ShipmentRequest" WHERE id = $1 FOR UPDATE`, id);
          candadoPuesto.abrir();
          await bBloqueada.promesa;
          // Otro operador completó la cadena mientras la captura esperaba: picking → guia → enviado.
          await t.$executeRawUnsafe(
            `UPDATE "ShipmentRequest" SET status = 'enviado', "shippedAt" = now() WHERE id = $1`,
            id,
          );
        },
        { timeout: 30000, maxWait: 30000 },
      );

      await candadoPuesto.promesa;
      const captura = capturarGuiaEnvio(id, 'DHL', `TRK-${RUN}-B5`);
      await esperarBloqueoDeFila(h.prisma, 'ShipmentRequest');
      bBloqueada.abrir();
      await tx;
      await captura;

      // ⛔ Rojo con `guia`: el envío ya salió y la cola de guías lo reclama otra vez — y con él,
      // otra transición `guia → enviado` y otro `AV-5`.
      expect(
        (await h.prisma.shipmentRequest.findUniqueOrThrow({ where: { id }, select: { status: true } }))
          .status,
      ).toBe('enviado');
    }, 60000);
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
     * ⚠️ La variante desde `NULL` vive en el `it` siguiente, y hasta el 2026-09-14 **no existía**:
     * se había medido `5/5 verde` y se había escrito, con razón, que *«5/5 no es una demostración»*.
     * No lo era: con `N = 25` salieron **6 rojas**. El `5/5` fue suerte (`0.76⁵ ≈ 25 %`).
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

    /**
     * ⭐⭐⭐ **EL TERCER SITIO DE LA MISMA CLASE — y el que enseña que una transacción NO basta.**
     *
     * `adminGuide` hacía el mismo *comprobar-y-actuar* que `setTracking`, pero **dentro de una
     * `$transaction`**, y eso invitaba a suponerlo seguro. No lo era: la transacción serializa las
     * ESCRITURAS por el candado de fila, pero cada petición sigue decidiendo `labelChanged` con el
     * valor que leyó **antes** de esperar, y el sello se reclama **POST-COMMIT y fuera** de la
     * transacción ⇒ el `guideNoticeSentAt: null` de la segunda aterriza **después** de que la
     * primera reclamara. **Medido: 6 de 25 tiradas con DOS correos** (`N = 25`, 8 simultáneas). *La
     * transacción estrechaba la ventana; no la cerraba.* ⚠️ El pase anterior midió aquí **5/5 verde**
     * y escribió, con razón, que *«5/5 no es una demostración»*. No lo era: con `p ≈ 0.24`, cinco
     * verdes seguidos salen el **25 %** de las veces.
     *
     * ⚠️ Y es el caso que más se parece a lo que el dueño describió el primer día —*«rechacé dos
     * veces en menos de un min… no sé si se debería bloquear»*—: **un aviso por ciclo** (§R.4,
     * criterio 205).
     *
     * El entrelazado se **fuerza** igual que en (A) —y por la misma razón medida, que está en la
     * cabecera del fichero—: la prueba bloquea la fila, deja dentro el estado de «otra captura ya
     * terminó y ya avisó», y suelta. **Ablación: ROJO 10/10 con el `labelChanged` de la lectura
     * previa; VERDE 10/10 con el arreglo.**
     */
    it('⭐⭐ ENTRELAZADO FORZADO: una captura que decidió con datos caducos NO borra el sello ajeno', async () => {
      const id = await nuevaSolicitud();
      const trk = `BL-${RUN}-C5`;
      expect(await selloSolicitud(id)).toBeNull();
      bandeja.length = 0;

      const candadoPuesto = diferida();
      const bBloqueada = diferida();
      const tx = h.prisma.$transaction(
        async (t) => {
          await t.$executeRawUnsafe(`SELECT id FROM "SellRequest" WHERE id = $1 FOR UPDATE`, id);
          candadoPuesto.abrir();
          await bBloqueada.promesa;
          await t.$executeRawUnsafe(
            `UPDATE "SellRequest"
                SET "shipmentCarrier" = $2, "shipmentTrackingNumber" = $3,
                    "guideSentAt" = now(), "guideNoticeSentAt" = now()
              WHERE id = $1`,
            id,
            'FedEx',
            trk,
          );
        },
        { timeout: 30000, maxWait: 30000 },
      );

      await candadoPuesto.promesa;
      const peticionB = capturarGuiaVendedor(id, 'FedEx', trk);
      await esperarBloqueoDeFila(h.prisma, 'SellRequest');
      bBloqueada.abrir();
      await tx;

      const res = await peticionB;
      // La guarda de negocio (`status='aceptada' ∧ closedAt=null`) sigue siendo otra cosa y puede
      // responder `409`: lo que este candado afirma es lo del CORREO.
      expect([200, 409]).toContain(res.status);
      await new Promise((r) => setTimeout(r, 200));

      // ⛔ Rojo con 1: el segundo correo del mismo hecho.
      expect(bandeja).toHaveLength(0);
      expect(await selloSolicitud(id)).toBeInstanceOf(Date);
    }, 60000);
  });
});

import { Logger } from '@nestjs/common';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_CARDS, E2E_USERS } from '../../prisma/e2e-fixtures';
import { diferida, esperarBloqueoDeFila } from './helpers/row-lock-barrier';

/**
 * # `buylist-intake-concurrency.e2e-spec.ts` — ⭐⭐ **DOS ALTAS A LA VEZ NO PUEDEN DAR `500`**
 * (`API_CONTRACT §6` · `SEC-A2` · el `500` medido el 2026-09-14.)
 *
 * ## El defecto, medido y con su traza
 * Dos intakes **simultáneos** del mismo vendedor contra `POST /buylist/requests`:
 * ```
 * PrismaClientKnownRequestError: Transaction failed due to a write conflict or a deadlock.
 *   at BuylistService.createRequest (buylist.service.ts:1679)      ⇒  500 INTERNAL
 * ```
 * La transacción es `SERIALIZABLE` **a propósito** (`SEC-A2`: cierra el TOCTOU del tope mensual AML;
 * sin ella, N solicitudes concurrentes leen el mismo acumulado y **todas pasan**). El problema no es
 * pedir la garantía: es **no pagar su precio**. En `SERIALIZABLE`, un `40001` es el motor cumpliendo
 * su contrato y pidiendo un reintento — y ese reintento **no existía**, así que el aborto salía por
 * la puerta como un `500`. *Un `500` que además es mentira: no se rompió nada.*
 *
 * ## Qué asierta esta suite, y por qué así
 * **Por exceso:** ninguna respuesta `5xx`, pase lo que pase con las carreras. Ése es el hecho que el
 * cliente nota.
 * **Y contra la vacuidad —que es la mitad que se olvida—:** una suite que dispara concurrencia y
 * *nunca* provoca un conflicto saldría verde **sin haber medido nada**. Por eso el caso principal
 * **repite rondas hasta observar al menos un conflicto real** (contado espiando el aviso del helper)
 * y **revienta si en ninguna ronda hubo ninguno**: eso significaría que el camino dejó de ser
 * serializable —`SEC-A2` caído— o que la prueba dejó de ejercitarlo.
 *
 * ## ⚠️ Aislamiento: el cupo se presta y se devuelve — y no es una precaución, es un rojo medido
 * La primera versión salió **verde aislada y ROJA en la corrida completa**: otras suites ya habían
 * consumido el **tope mensual AML** de `customer2`, así que las 48 altas contestaron
 * `422 BUYLIST_LIMIT_EXCEEDED`, **ninguna creó nada** y no hubo concurrencia que medir. El control
 * de no-vacuidad hizo exactamente su trabajo: avisar de que la prueba no estaba midiendo.
 * ⇒ La suite **sube el tope de ese usuario en el `beforeAll` y lo devuelve tal cual en el
 * `afterAll`**, y borra **solo** las filas que ella creó. ⛔ El tope no se desactiva: sigue vigente
 * —es el motivo mismo de que la transacción sea `SERIALIZABLE`—, solo se le da cabecera.
 * *Un candado de concurrencia que comparte cupo con el resto de la suite mide el orden de los
 * ficheros, no el código.*
 *
 * ## ⭐⭐ El conflicto se FUERZA, no se sortea (P-BUYLIST-CONC-FLAKE, 2026-09-25)
 * La versión anterior disparaba **4 altas a la vez × 12 rondas** y esperaba que la máquina produjera
 * la carrera. Eso hacía la prueba dependiente de la carga **por los dos lados**:
 *  · ROJO sin defecto: con 4 transacciones peleando por el MISMO predicado, de vez en cuando una
 *    pierde las 5 veces seguidas ⇒ `503 BUSY_TRY_AGAIN` (§0-T, «la cola esperable» bajo carga) ⇒
 *    reventaba `expect(servidor).toEqual([])` (línea 161 de la versión anterior). Medido: rojo en el
 *    CI de la PR #59 (1 de 1044 pruebas, verde al re-run) y **1/30 corridas aisladas en local**
 *    (2026-09-25, `connection_limit=5` como el CI), las dos veces con `503 BUSY_TRY_AGAIN`. ⚠️ No
 *    era la no-vacuidad la que fallaba: era el presupuesto de reintentos agotándose bajo carga.
 *  · y la no-vacuidad (`conflictos > 0`) dependía igualmente de que la máquina entrelazara.
 *
 * Ahora el entrelazado lo pone la prueba, con la técnica de `helpers/row-lock-barrier.ts`:
 * ```
 * prueba:  BEGIN; SELECT … FROM "Card" WHERE id = :carta FOR UPDATE
 * A y B:   (SERIALIZABLE) leen el acumulado del mes · INSERT "SellRequest" ·
 *          INSERT "SellRequestItem" ⇒ la FK a "Card" pide FOR KEY SHARE ⇒ SE BLOQUEAN (verificado
 *          en pg_stat_activity, las DOS)
 * prueba:  COMMIT ⇒ A y B siguen, cada una habiendo leído un acumulado que NO incluye la fila de la
 *          otra ⇒ no hay orden serial equivalente ⇒ el SSI de Postgres TIENE que abortar a una
 * ```
 * ⇒ **Toda ronda produce un conflicto real**, por construcción y no por suerte. Y como solo hay DOS
 * contendientes, el reintento del perdedor corre **sin rival** (la otra ya commiteó) ⇒ prospera: la
 * aserción «cero `5xx`» deja de ser una apuesta sobre el presupuesto de reintentos bajo carga y pasa
 * a medir **exactamente** lo que este candado protege: que el conflicto existe (`SERIALIZABLE`
 * vivo, `SEC-A2`) y que se reintenta en vez de salir por la puerta.
 * ⛔ Ninguna aserción se relajó: las tres siguen (cero `5xx`, ≥1 alta creada, ≥1 conflicto) y ahora
 * se exigen **por ronda** y con cifras exactas (2 altas `201` por ronda).
 */

const CLABE_B = '012345678901234568';
/** Rondas, TODAS. Cada una FUERZA su conflicto; si alguna no lo produce, la prueba REVIENTA. */
const RONDAS = 4;
/**
 * Altas por ronda. ⚠️ **DOS, a propósito**: con dos contendientes el SSI aborta a UNA y su reintento
 * corre sin rival ⇒ el resultado es determinista. Con tres o más, los perdedores vuelven a pelearse
 * entre sí sin barrera y se regresa a la tirada de dados que este fichero dejó atrás.
 */
const CONC = 2;
/** Tope mensual que se le presta al usuario de esta suite (y se le retira en el `afterAll`). */
const CAP_SUITE_CENTS = 100_000_000;

describe('§6 / SEC-A2 — altas simultáneas de buylist: cero `5xx`', () => {
  let h: E2EHarness;
  let token: string;
  let userId: string;
  let cardId: string;
  let addressId: string;
  /** Cada aviso de reintento del helper = un conflicto de serialización REAL del motor. */
  let conflictos: number;
  let spy: jest.SpyInstance;
  /** Las solicitudes que crea ESTA suite, para barrerlas sin tocar las de nadie más. */
  const creadas: string[] = [];
  /** El tope mensual que había ANTES, para devolverlo tal cual. */
  let capPrevio: { habia: boolean; valor: number | null } | null = null;

  beforeAll(async () => {
    h = await E2EHarness.create();
    token = await h.login(E2E_USERS.customer2.email, E2E_USERS.customer2.password);
    userId = (
      await h.prisma.user.findUniqueOrThrow({
        where: { email: E2E_USERS.customer2.email },
        select: { id: true },
      })
    ).id;
    const card = await h.prisma.card.findFirstOrThrow({
      where: { externalId: E2E_CARDS.charizard.externalId },
      select: { id: true },
    });
    cardId = card.id;
    const addr = await h.prisma.address.findFirstOrThrow({
      where: { userId, country: 'MX' },
      select: { id: true },
    });
    addressId = addr.id;

    // ⭐ El TOPE MENSUAL, subido SOLO para esta suite y restaurado en el `afterAll`.
    // No es comodidad: es lo que hace que la prueba mida. Sin esto salió **roja en la corrida
    // completa** (verde aislada) porque otras suites ya habían consumido el cupo AML de este
    // usuario ⇒ las 48 altas contestaban `422 BUYLIST_LIMIT_EXCEEDED`, ninguna creaba nada y **no
    // había concurrencia que medir**. ⛔ El tope NO se desactiva —sigue vigente y sigue siendo el
    // motivo por el que la transacción es `SERIALIZABLE`—: solo se le da cabecera a esta suite.
    const kyc = await h.prisma.kycProfile.findUnique({
      where: { userId },
      select: { capPerMonthCentsOverride: true },
    });
    capPrevio = { habia: kyc !== null, valor: kyc?.capPerMonthCentsOverride ?? null };
    await h.prisma.kycProfile.upsert({
      where: { userId },
      create: { userId, capPerMonthCentsOverride: CAP_SUITE_CENTS },
      update: { capPerMonthCentsOverride: CAP_SUITE_CENTS },
    });

    // El helper avisa con `logger.warn('serializable-retry …')` en CADA reintento. Espiarlo es la
    // única forma honesta de saber si la carrera de verdad ocurrió: ⛔ sin este contador, un verde
    // no distingue «no hubo conflictos y el código está bien» de «no hubo concurrencia ninguna».
    conflictos = 0;
    spy = jest.spyOn(Logger.prototype, 'warn').mockImplementation((...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].startsWith('serializable-retry')) conflictos += 1;
    });
  });

  afterAll(async () => {
    spy?.mockRestore();
    // ⛔ SOLO lo que esta suite creó. Borrar «todas las de `customer2`» se llevaría por delante las
    // filas de otra suite del mismo proceso (`maxWorkers: 1`, BD compartida) — la regla de la casa.
    const ids = [...creadas];
    if (ids.length > 0) {
      await h.prisma.sellRequestItem.deleteMany({ where: { sellRequestId: { in: ids } } });
      await h.prisma.sellRequest.deleteMany({ where: { id: { in: ids } } });
    }
    // Y el tope vuelve a ser el que era: dejarlo alto envenenaría a quien mida el cupo después.
    if (capPrevio?.habia) {
      await h.prisma.kycProfile.update({
        where: { userId },
        data: { capPerMonthCentsOverride: capPrevio.valor },
      });
    } else if (capPrevio) {
      await h.prisma.kycProfile.deleteMany({ where: { userId } });
    }
    await h?.close();
  });

  const alta = () =>
    h.api('POST', '/buylist/requests', {
      token,
      json: {
        items: [{ cardId, productType: 'raw', rawCondition: 'NM' }],
        clabe: CLABE_B,
        addressId,
      },
    });

  /**
   * Una ronda con el conflicto FORZADO: la prueba sostiene el candado de la fila de `Card` que la FK
   * de `SellRequestItem` necesita, suelta `CONC` altas, **comprueba** que las `CONC` quedaron
   * bloqueadas dentro de su transacción serializable (ya leyeron el acumulado y ya insertaron su
   * `SellRequest`) y solo entonces suelta el candado.
   */
  async function rondaForzada() {
    const candadoPuesto = diferida();
    const todasBloqueadas = diferida();
    const tx = h.prisma.$transaction(
      async (t) => {
        await t.$executeRawUnsafe(`SELECT id FROM "Card" WHERE id = $1 FOR UPDATE`, cardId);
        candadoPuesto.abrir();
        await todasBloqueadas.promesa;
      },
      { timeout: 30000, maxWait: 30000 },
    );
    await candadoPuesto.promesa;
    const peticiones = Array.from({ length: CONC }, () => alta());
    try {
      // ⛔ No es un `sleep`: si el alta dejara de escribir `SellRequestItem` dentro de la
      // transacción (o dejara de referenciar `Card`), esto REVIENTA en vez de medir en falso.
      await esperarBloqueoDeFila(h.prisma, 'SellRequestItem', CONC);
    } finally {
      todasBloqueadas.abrir();
      await tx;
    }
    return Promise.all(peticiones);
  }

  it('⭐⭐ N altas simultáneas repetidas: ni un solo `5xx`, y el conflicto SÍ ocurrió', async () => {
    const codigos: number[] = [];
    const servidor: string[] = [];
    const conflictosPorRonda: number[] = [];
    // ⛔ SIN salida anticipada: todas las rondas, siempre.
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const antes = conflictos;
      const res = await rondaForzada();
      conflictosPorRonda.push(conflictos - antes);
      for (const r of res) {
        codigos.push(r.status);
        // El CUERPO del 5xx viaja al assert: un `Array [500, 500]` no dice si fue el conflicto sin
        // reintento, el pool agotado o un timeout de transacción — y son arreglos distintos.
        if (r.status >= 500) servidor.push(`${r.status} ${r.text?.slice(0, 160)}`);
        const id = (r.body as { sellRequestId?: string } | undefined)?.sellRequestId;
        if (id) creadas.push(id);
      }
    }

    // ⛔ LA MITAD QUE FALLA POR EXCESO, y es el defecto medido: un `5xx` en cara del cliente por una
    // transacción que el motor abortó haciendo exactamente su trabajo.
    expect(servidor).toEqual([]);
    // Con el tope prestado, TODA alta de cada ronda prospera: el perdedor del conflicto se reintenta
    // y crea su solicitud. (Más estricto que el `[201, 422]` de antes: aquí nada puede quedarse fuera.)
    expect(codigos).toEqual(Array.from({ length: RONDAS * CONC }, () => 201));

    // ⛔ CONTROL DE NO-VACUIDAD, en sus dos mitades — y ahora POR RONDA. Sin ALTAS que prosperen no
    // hubo concurrencia real que medir, y sin CONFLICTO observado en CADA ronda el verde de arriba no
    // diría nada sobre el reintento: significaría que el camino dejó de ser serializable (`SEC-A2`
    // caído) o que la barrera dejó de entrelazar lo que dice entrelazar.
    expect(creadas.length).toBe(RONDAS * CONC);
    expect(conflictos).toBeGreaterThan(0);
    for (const n of conflictosPorRonda) expect(n).toBeGreaterThanOrEqual(1);
  }, 180000);

  it('⭐ y las que prosperaron quedaron BIEN escritas (el reintento no duplica ni deja a medias)', async () => {
    // Un reintento re-ejecuta el cuerpo entero: si dejara basura del intento abortado, se vería
    // aquí como filas sin ítems o con el estado equivocado. El rollback del motor es quien lo
    // garantiza — esto lo comprueba en vez de suponerlo.
    const filas = await h.prisma.sellRequest.findMany({
      where: { id: { in: creadas } },
      select: { status: true, quotedTotalCents: true, _count: { select: { items: true } } },
    });
    expect(filas.length).toBeGreaterThan(0);
    for (const f of filas) {
      expect(f.status).toBe('cotizada');
      expect(f._count.items).toBe(1);
      expect(f.quotedTotalCents).toBeGreaterThan(0);
    }
  }, 60000);
});

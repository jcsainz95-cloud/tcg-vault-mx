import { Logger } from '@nestjs/common';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_CARDS, E2E_USERS } from '../../prisma/e2e-fixtures';

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
 */

const CLABE_B = '012345678901234568';
/** Rondas, TODAS. Si en ninguna hubo un conflicto, la prueba REVIENTA (ver el control de no-vacuidad). */
const RONDAS = 12;
/** Altas simultáneas por ronda. */
const CONC = 4;
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

  it('⭐⭐ N altas simultáneas repetidas: ni un solo `5xx`, y el conflicto SÍ ocurrió', async () => {
    const codigos: number[] = [];
    const servidor: string[] = [];
    // ⛔ SIN salida anticipada: todas las rondas, siempre. Cortar al primer conflicto hacía que cada
    // corrida ejercitara una cantidad de concurrencia distinta — y una prueba cuyo trabajo depende
    // de la suerte tiene un resultado que también depende de la suerte.
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const res = await Promise.all(Array.from({ length: CONC }, () => alta()));
      for (const r of res) {
        codigos.push(r.status);
        // El CUERPO del 5xx viaja al assert: un `Array [500, 500]` no dice si fue el conflicto sin
        // reintento, el pool agotado o un timeout de transacción — y son arreglos distintos.
        if (r.status >= 500) servidor.push(`${r.status} ${r.text?.slice(0, 160)}`);
        const id = (r.body as { sellRequestId?: string } | undefined)?.sellRequestId;
        if (id) creadas.push(id);
      }
    }

    // ⛔ LA MITAD QUE FALLA POR EXCESO, y es el defecto medido: un `500` en cara del cliente por una
    // transacción que el motor abortó haciendo exactamente su trabajo.
    expect(servidor).toEqual([]);
    // Toda respuesta es una de las del contrato §6 (201 crea; 422 si el tope mensual la para).
    for (const c of codigos) expect([201, 422]).toContain(c);

    // ⛔ CONTROL DE NO-VACUIDAD, en sus dos mitades. Sin ALTAS que prosperen no hubo concurrencia
    // real que medir (fue así como se cazó el defecto de aislamiento de este mismo fichero), y sin
    // CONFLICTO observado el verde de arriba no dice nada sobre el reintento.
    expect(creadas.length).toBeGreaterThan(0);
    expect(conflictos).toBeGreaterThan(0);
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

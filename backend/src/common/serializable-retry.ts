import { Prisma } from '@prisma/client';

/**
 * # `serializable-retry.ts` — ⭐⭐ **UNA TRANSACCIÓN `SERIALIZABLE` SIN REINTENTO ES UN `500` ESPERANDO SU DÍA**
 *
 * ## El defecto que cierra, medido (2026-09-14, `f8c7040`)
 * Dos altas simultáneas del mismo vendedor contra `POST /buylist/requests`:
 * ```
 * PrismaClientKnownRequestError: Transaction failed due to a write conflict or a deadlock.
 *   at BuylistService.createRequest (buylist.service.ts:1679)   ⇒  500 INTERNAL en cara del cliente
 * ```
 * `AllExceptionsFilter` **no mapea nada de Prisma**, así que el error cae al `catch` final y sale
 * `500`. Y el `500` es **mentira**: no se rompió nada. El motor hizo **exactamente su trabajo**.
 *
 * ## Por qué es un defecto NUESTRO y no de Postgres
 * En `SERIALIZABLE`, un conflicto de serialización (`40001`) **no es una avería: es el contrato del
 * nivel de aislamiento**. Postgres promete que el resultado equivale a *alguna* ejecución en serie, y
 * el precio es que **puede abortar una transacción y pedir que se reintente**. La documentación lo
 * dice sin rodeos: las aplicaciones que usan `SERIALIZABLE` **deben** estar preparadas para reintentar.
 * Nosotros pedimos la garantía y **no pagamos el precio** ⇒ le pasamos la factura al cliente en forma
 * de `500`.
 *
 * ⛔ **Y la respuesta NO es bajar el aislamiento.** Ese `SERIALIZABLE` está ahí a propósito: es lo que
 * cierra el TOCTOU del **tope mensual AML** (`SEC-A2`) — sin él, N solicitudes concurrentes leen el
 * mismo acumulado y **todas pasan**, que es el bypass del límite. La garantía se conserva; lo que se
 * añade es el reintento que esa garantía siempre exigió.
 *
 * ## Qué se reintenta, y qué NO — la línea es la que importa
 * | Caso | Qué hace | Por qué |
 * |---|---|---|
 * | `P2034` (Prisma) · `40001` · `40P01` (Postgres crudo) | **reintenta** | El motor abortó y **no commiteó nada**: re-ejecutar desde cero es exactamente lo que pide |
 * | `BusinessException` (tope excedido, `409`, …) | ⛔ **propaga tal cual** | Es una decisión de negocio, no una carrera. Reintentarla sería preguntar lo mismo esperando otra respuesta |
 * | `P2028` (timeout de transacción) | ⛔ **propaga** | No es conflicto: reintentar una tx que no cupo en su ventana la vuelve a no caber, y multiplica la carga |
 * | Reintentos agotados | **propaga el error ORIGINAL** | ⛔ No se inventa un código de contrato nuevo: eso lo decide el arquitecto (ver la nota al final) |
 *
 * ## ⭐ Por qué re-ejecutar es SEGURO aquí, y no es una opinión
 * Una transacción abortada por `40001` **no dejó nada escrito** — el rollback es del motor. Por eso el
 * cuerpo puede correr otra vez desde cero **sin compensar nada**. La condición que sí hay que
 * sostener, y que este helper NO puede comprobar por ti:
 *
 * > ⛔ **El cuerpo de la transacción no puede tener efectos FUERA de la base** (correo, Stripe, S3,
 * > colas). Si los tuviera, el segundo intento los repetiría — y un cobro o un correo **no tienen
 * > rollback**.
 *
 * Ese es justamente el patrón que este proyecto ya sigue en los seis sitios: los avisos son
 * **post-commit y best-effort**, y Stripe se llama **después** de la transacción. Auditado uno a uno
 * el 2026-09-14: los seis cuerpos `Serializable` solo llaman a `tx.*`, a helpers `…Tx(tx, …)`, a
 * predicados puros (`liveRequestWhere`, `payableWhere`) y a proyección de DTO. **Cero efectos
 * externos.**
 *
 * ## El candado que impide que esto se olvide otra vez
 * `test/serializable-retry.guard.spec.ts` recorre `src/` y exige que **toda** aparición de
 * `TransactionIsolationLevel.Serializable` esté dentro de este fichero. Abrir una transacción
 * serializable a mano vuelve a ser posible el día que alguien quite ese candado, y no antes.
 *
 * ## ⚠️ Lo que queda ABIERTO y es del ARQUITECTO, no mío
 * Si los `INTENTOS` se agotan (carga patológica), hoy sigue saliendo **`500`** — igual que antes, ni
 * mejor ni peor. Lo correcto sería un código de contrato propio del estilo «vuelve a intentarlo»
 * (`503`), pero **eso es superficie de API** y `API_CONTRACT.md` no lo norma. ⇒ Se deja escrito y se
 * enruta. **Medido: con 4 altas simultáneas del mismo vendedor repetidas 12 rondas (48 altas), los
 * 5 intentos bastan — 8/8 corridas verdes, cero `5xx`. Con 3 intentos, 10/10 rojas.** ⛔ **NO MEDIDO**
 * qué pasa con ~50 a la vez; ahí volvería a salir el `500` de hoy.
 */

/**
 * Intentos TOTALES (el primero + los reintentos).
 *
 * ⚠️ **El 5 está MEDIDO, no elegido.** Con **3** y una presión de 4 altas simultáneas del mismo
 * vendedor repetida 12 rondas, `buylist-intake-concurrency.e2e-spec.ts` sale **roja 10/10**: los
 * reintentos se agotan y vuelve el `500`. Y es aritmética, no mala suerte — con N transacciones
 * serializables compitiendo por el MISMO predicado, el SSI puede abortar a N−1 por ronda, y cada
 * reintento vuelve a entrar en la misma pelea. ⛔ Bajarlo reabre el defecto que este helper cierra;
 * subirlo sin medir convierte un `500` rápido en una espera larga.
 */
export const SERIALIZABLE_ATTEMPTS = 5;

/** Espera base entre intentos, en ms. Con jitter, para no re-sincronizar a los que chocaron. */
const BACKOFF_BASE_MS = 25;

/**
 * ¿Es este error un **conflicto de serialización o un interbloqueo**, o sea, un «vuelve a
 * intentarlo» del motor?
 *
 * Se miran las **dos** capas a propósito: Prisma normaliza el conflicto a **`P2034`** cuando el
 * choque ocurre en una operación del cliente, pero una sentencia cruda (`$executeRaw…`) dentro de la
 * misma transacción puede aflorar el `SQLSTATE` de Postgres sin traducir. ⛔ Mirar solo `P2034`
 * dejaría fuera justo el camino que menos se prueba.
 */
export function isSerializationConflict(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    // P2034 = «Transaction failed due to a write conflict or a deadlock». ⛔ P2028 (timeout) NO.
    if (e.code === 'P2034') return true;
    if (e.code === 'P2028') return false;
  }
  // SQLSTATE crudo: 40001 serialization_failure · 40P01 deadlock_detected.
  const meta = (e as { meta?: unknown } | null)?.meta as { code?: unknown } | undefined;
  const sqlstate = typeof meta?.code === 'string' ? meta.code : undefined;
  if (sqlstate === '40001' || sqlstate === '40P01') return true;
  const msg = e instanceof Error ? e.message : '';
  return /\b(40001|40P01)\b/.test(msg);
}

/** Lo mínimo que este helper necesita de Prisma — estructural, para no atar `common/` al servicio. */
export interface SerializableTxRunner {
  $transaction<R>(
    fn: (tx: Prisma.TransactionClient) => Promise<R>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel; timeout?: number; maxWait?: number },
  ): Promise<R>;
}

/**
 * Corre `fn` en una transacción **`SERIALIZABLE`**, reintentando **solo** ante conflicto del motor.
 *
 * ⚠️ `fn` puede ejecutarse **más de una vez**: no metas dentro nada que no tenga rollback (ver la
 * cabecera). Todo lo demás —incluidas las `BusinessException`— sale a la primera, intacto.
 */
export async function runSerializable<T>(
  prisma: SerializableTxRunner,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options: {
    /** Para el log: qué operación es. No afecta a la conducta. */
    label?: string;
    timeout?: number;
    maxWait?: number;
    attempts?: number;
    logger?: { warn: (message: string) => void };
    /** Inyectable para que la prueba no duerma de verdad. */
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<T> {
  const attempts = options.attempts ?? SERIALIZABLE_ATTEMPTS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let intento = 1; ; intento++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
        ...(options.maxWait !== undefined ? { maxWait: options.maxWait } : {}),
      });
    } catch (e) {
      // ⛔ El último intento propaga el error ORIGINAL: el cliente ve hoy lo mismo que veía antes, y
      // nadie se inventa un código de contrato por su cuenta.
      if (intento >= attempts || !isSerializationConflict(e)) throw e;
      options.logger?.warn(
        `serializable-retry${options.label ? ` [${options.label}]` : ''}: conflicto de ` +
          `serialización en el intento ${intento}/${attempts}; se reintenta`,
      );
      // Backoff con jitter: si dos chocaron, volver a la vez los haría chocar otra vez.
      await sleep(Math.round(BACKOFF_BASE_MS * intento * (0.5 + Math.random())));
    }
  }
}

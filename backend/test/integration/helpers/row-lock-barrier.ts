import type { PrismaService } from '../../../src/prisma/prisma.service';

/**
 * # `row-lock-barrier.ts` — ⭐⭐ **CÓMO SE PRUEBA UNA CARRERA SIN CRUZAR LOS DEDOS**
 * Propiedad: backend. Lo usan `avisos-sellos.e2e-spec.ts` (§R.4 / `D-AVISO-2`) y
 * `buylist-step-guard.e2e-spec.ts` (§M5-S).
 *
 * ## El problema que resuelve, con sus dos medidas
 * Una prueba de concurrencia escrita como *«lanzo N peticiones a la vez y compruebo el resultado»*
 * **no es un candado: es una tirada de dados**, y este repo tiene las dos caras medidas:
 *
 * | Caso | Escrito como | Medido |
 * |---|---|---|
 * | `D-AVISO-2` (envíos) | 8 capturas simultáneas | el defecto salía **8 de 25 veces** ⇒ una sola tirada lo deja pasar 2 de cada 3 |
 * | `§M5-S · S-2` | `receive` y `verify` con **20 ms** de desfase | **2 de 5** corridas en ROJO bajo carga; **5/5 verde** aislada |
 *
 * Las dos fallan por lo mismo: **el orden que la prueba necesita no lo controla la prueba**, lo
 * controla la máquina. La primera sale verde con el defecto dentro; la segunda sale roja sin defecto
 * ninguno. *Un candado que depende de la carga no dice nada sobre el código, ni cuando pasa ni cuando
 * falla.*
 *
 * ## La técnica: el orden se FUERZA con el candado de fila de Postgres
 * ```
 * prueba:  BEGIN; SELECT … FOR UPDATE        ⇐ la fila queda bloqueada
 * A:       (petición) … UPDATE …             ⇐ SE BLOQUEA, y se COMPRUEBA que se bloqueó
 * B:       (petición) … UPDATE …             ⇐ se encola DETRÁS de A (la cola de espera es FIFO)
 * prueba:  [deja el estado que toque]; COMMIT ⇐ se sueltan, en el orden elegido
 * ```
 * Con esto el entrelazado es **el mismo en toda máquina**, y las dos cosas que hay que demostrar de
 * un candado —que **muerde** con el defecto y que **no muerde** sin él— dejan de ser proporciones y
 * pasan a ser hechos.
 *
 * ⛔ **Nada de `sleep` como sincronización.** Dormir es apostar a que la otra parte llegó; esperar en
 * `pg_stat_activity` es **comprobarlo**. Y si no llega, esto **revienta con un mensaje que dice qué
 * cambió** en vez de dejar pasar una prueba que ya no mide lo que cree.
 */

/** Cuánto se espera, como mucho, a que una petición se bloquee en el candado de fila. */
export const ESPERA_CANDADO_MS = 10000;

/** Promesa que otro resuelve — el hilo entre la transacción que bloquea y la petición que espera. */
export function diferida(): { promesa: Promise<void>; abrir: () => void } {
  let abrir!: () => void;
  const promesa = new Promise<void>((res) => {
    abrir = res;
  });
  return { promesa, abrir };
}

/**
 * Espera —y **comprueba**— que haya al menos `cuantas` peticiones **bloqueadas en el candado de
 * fila** de `tabla`.
 *
 * ⛔ No es un `sleep`: si el producto dejara de escribir esa tabla (o dejara de hacerlo con un
 * `UPDATE`), esto **lanza** en vez de dejar pasar un candado que ya no mide nada.
 */
export async function esperarBloqueoDeFila(
  prisma: PrismaService,
  tabla: string,
  cuantas = 1,
): Promise<void> {
  const hasta = Date.now() + ESPERA_CANDADO_MS;
  for (;;) {
    const filas = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND state = 'active'
          AND query ILIKE $1`,
      `%"${tabla}"%`,
    );
    if (Number(filas[0].n) >= cuantas) return;
    if (Date.now() > hasta) {
      throw new Error(
        `Esperaba ${cuantas} petición(es) bloqueada(s) en el candado de fila de "${tabla}" y no ` +
          `llegaron en ${ESPERA_CANDADO_MS} ms. O la operación dejó de escribir esa tabla, o dejó ` +
          'de hacerlo en un UPDATE: en cualquiera de los dos casos este candado ya no mide lo que ' +
          'dice, y por eso revienta en vez de pasar.',
      );
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

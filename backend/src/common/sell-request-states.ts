import { SellRequestStatus } from '@prisma/client';

/**
 * sell-request-states.ts (M-46, ARCHITECTURE §4.39c — **ZONA COMPARTIDA**) — **la ÚNICA fuente de los
 * subconjuntos de `SellRequestStatus`**.
 *
 * ### El problema que cierra, dicho sin adornos
 * M-46 añade **cuatro** valores al enum (`ofertada`, `aceptada`, `en_transito`, `expirada`) y había
 * **NUEVE** listas de literales por el código que codificaban a mano un subconjunto de ese enum.
 * **Ninguna falla en compilación**: todas viven dentro de un `in` / `notIn` / `includes`, así que el
 * compilador las da por buenas y el error sale **en runtime, en silencio y como conducta**.
 *
 * El más grave era de **cumplimiento, no de negocio**: `jobs/ine-retention.service.ts` definía su
 * propio `CLOSED = ['pagada','rechazada','abandonada']`. Con `expirada` en el enum, una solicitud
 * expirada cuenta como **abierta para siempre** ⇒ *el INE de esa persona NO SE PURGA NUNCA* (PII,
 * LFPDPPP). El segundo y el tercero son de **dinero**: una oferta expirada seguiría **quemándole la
 * cuota mensual AML** al vendedor.
 *
 * ### Las dos clases de lista, y por qué no se derivan todas
 * (§4.37) **Clase E** = espeja el schema ⇒ se **deriva** (`Object.values`). **Clase R** = expresa una
 * regla de negocio ⇒ se declara **literal**, con la cláusula de `PROJECT.md` citada al lado.
 *
 * - `SELL_REQUEST_TERMINAL_STATES` es **clase R**: lo declara `PROJECT.md` §P.1 («los terminales son
 *   **CUATRO**», criterio 113), **no** el schema. Si mañana el schema gana un estado, **no** debe
 *   volverse terminal solo.
 * - `SELL_REQUEST_LIVE_STATES` es **clase E por COMPLEMENTO**, y eso es **a propósito** (criterio
 *   129): *«viva» = todo lo que NO es terminal*. Así un estado nuevo entra **solo** a la cola del
 *   back-office, sin que nadie tenga que acordarse de actualizar una lista. **Es la única de las dos
 *   direcciones en la que olvidarse falla hacia el lado seguro** (aparece de más en una cola de
 *   trabajo, en vez de desaparecer de ella).
 *
 * ### Regla de uso
 * **Prohibido volver a escribir un literal de estados en un `in`/`notIn`/`includes`.** Si hace falta
 * un subconjunto que no está aquí, se añade **aquí**, con su cláusula de `PROJECT.md`.
 */

/**
 * **Los CUATRO terminales** (criterio 113 / §P.1). Una vez en uno de ellos la solicitud **no se
 * revive, no se re-oferta y no se re-sella**; toda transición terminal fija `closedAt = now()`
 * (patrón SEC-D2), **incluida `expirada`**, de la que depende la purga del INE.
 *
 * ⚠️ **CLASE R — no se deriva del schema.** Eran **tres** hasta M-46; `expirada` es el cuarto.
 */
export const SELL_REQUEST_TERMINAL_STATES = [
  'pagada',
  'rechazada',
  'abandonada',
  'expirada',
] as const satisfies readonly SellRequestStatus[];

export type SellRequestTerminalStatus = (typeof SELL_REQUEST_TERMINAL_STATES)[number];

/**
 * **«Viva» = todo lo que NO es terminal**, DERIVADO POR COMPLEMENTO (criterio 129, **a propósito**).
 *
 * Se calcula sobre `Object.values(SellRequestStatus)` —el espejo runtime del schema que genera
 * Prisma— así que **no puede desincronizarse** del enum. Un estado nuevo entra aquí **solo**.
 */
export const SELL_REQUEST_LIVE_STATES: readonly SellRequestStatus[] = Object.values(
  SellRequestStatus,
).filter((s) => !(SELL_REQUEST_TERMINAL_STATES as readonly SellRequestStatus[]).includes(s));

/**
 * **Terminales que ya NO comprometen nada** = TERMINAL **menos** `pagada` (que sí comprometió… y
 * pagó). Es el predicado del **acumulado mensual AML** (§4.39c sitios 2+3): una solicitud
 * `rechazada`, `abandonada` o **`expirada`** no le puede seguir quemando cuota a nadie.
 *
 * Se usa por **complemento** (`status notIn …`), que es como estaba escrito el predicado original y
 * es lo correcto: mide *lo que sigue comprometido*, y eso incluye cualquier estado futuro.
 */
export const SELL_REQUEST_NON_COMMITTING_STATES: readonly SellRequestStatus[] =
  SELL_REQUEST_TERMINAL_STATES.filter((s) => s !== 'pagada');

/**
 * **Comprometido** (§P.2): hay una oferta **vinculante** viva y el vendedor ya dijo o va a decir. El
 * dinero todavía no salió, pero la palabra ya está dada.
 */
export const SELL_REQUEST_COMMITTED_STATES = [
  'ofertada',
  'aceptada',
] as const satisfies readonly SellRequestStatus[];

/**
 * **«En camino»** (§P.2c / criterio 116). ⚠️ **UN SOLO estado**, y es deliberado: lo que suma a este
 * conteo es **la confirmación del operador** (D20), **no** el «ya lo mandé» del vendedor
 * (`sellerShippedDeclaredAt`, que detiene el reloj y **no mueve el estado**, criterios 138/156).
 */
export const SELL_REQUEST_IN_TRANSIT_STATES = [
  'en_transito',
] as const satisfies readonly SellRequestStatus[];

/** La carta ya está en nuestras manos y se está revisando. */
export const SELL_REQUEST_VERIFYING_STATES = [
  'recibida',
  'verificacion',
] as const satisfies readonly SellRequestStatus[];

/**
 * **Estados PAGABLES** (`POST /admin/buylist/:id/pay-spei`, dinero SALIENTE). Estaba escrito
 * **inline dos veces en el mismo método** —el pre-check y la guarda transaccional del `updateMany`—,
 * que es la forma más barata de que una edición mueva una y no la otra: el pre-check diría «no» y la
 * guarda «sí», o al revés. **Una sola constante, los dos sitios.**
 */
export const SELL_REQUEST_PAYABLE_STATES = [
  'aprobada',
  'verificacion',
] as const satisfies readonly SellRequestStatus[];

/**
 * v1.51.8 (**§4.39c SITIO 10**, API_CONTRACT §M5) — **¿esta solicitud está en condición de pagarse?**
 * `isPayable` **derivado server-side**, y **es el MISMO cuerpo** que usan el pre-check y la guarda
 * atómica de `paySpei`. **Tres lectores, una regla.**
 *
 * ```
 * isPayable = status ∈ SELL_REQUEST_PAYABLE_STATES  ∧  verifiedAt IS NOT NULL
 * ```
 *
 * ### Por qué existe, y por qué NO bastaba con que el cliente copiara bien
 * `M5View.tsx` tenía `canPay = isSuperAdmin && (status === 'aprobada' || status === 'verificacion')`:
 * `SELL_REQUEST_PAYABLE_STATES` **transcrito a mano en el cliente**, gobernando **el botón de pagar
 * por SPEI**. Es la **tercera** copia de la regla que el **sitio 8** acaba de consolidar server-side
 * *precisamente por ser dinero* — y ésta vive en **otro lenguaje, otro paquete y otro ciclo de
 * release**, así que ni el compilador ni un test de backend la ven.
 *
 * ⚠️ **Y estaba INCOMPLETA:** la precondición del servidor son **DOS** términos y el cliente replicaba
 * **solo el primero**, así que **la UI habilitaba el pago en solicitudes donde el servidor responde
 * `422`**. *No era una copia fiel que pudiera desincronizarse algún día: ya lo estaba.*
 *
 * El remedio **no** es que el cliente replique las dos condiciones —eso sería duplicar **dos** reglas
 * en vez de una y meter `verifiedAt` en la lógica de una pantalla—. *La copia se cura eliminando la
 * necesidad de la copia.*
 *
 * ### ⚠️ ACTOR-INDEPENDIENTE, y no es un permiso
 * *«¿esta solicitud está en condición de pagarse?»* es propiedad **de la fila**; *«¿puedo pagarla
 * yo?»* es propiedad **del actor**. Fundirlas haría que **la misma solicitud respondiera distinto
 * según quién pregunte**: *dos preguntas en un campo son un campo que nadie sabe leer.* El rol se
 * queda en el cliente (ya gatea toda la sección de dinero) y **el servidor lo impone igual con
 * `MoneyOutGuard`**. Un `isPayable: true` **NO autoriza** un pago: `pay-spei` conserva su rol y sus
 * dos guardas intactas.
 *
 * **ADMIN-ONLY** (a diferencia de `isTerminal`, que viaja en las dos proyecciones de cliente): al
 * vendedor no le toca saber si su solicitud entró a la cola de pago — le anticiparía un depósito que
 * aún puede no ocurrir.
 */
export function isPayableSellRequest(sr: {
  status: SellRequestStatus;
  verifiedAt: Date | null;
}): boolean {
  return (
    (SELL_REQUEST_PAYABLE_STATES as readonly SellRequestStatus[]).includes(sr.status) &&
    sr.verifiedAt != null
  );
}

/**
 * `isTerminal` **derivado server-side** (§4.39c **sitio 9**, API_CONTRACT §M5/§11).
 *
 * ⚠️ Existe para **BORRAR la quinta copia del set terminal**, que vivía en el **frontend**
 * (`M5View.tsx`, `REQUEST_TERMINAL`). El frontend **no** la sustituye por otra constante propia: el
 * servidor le dice. *La copia se cura eliminando la necesidad de la copia, no moviéndola de archivo.*
 */
export function isTerminalSellRequestStatus(status: SellRequestStatus): boolean {
  return (SELL_REQUEST_TERMINAL_STATES as readonly SellRequestStatus[]).includes(status);
}

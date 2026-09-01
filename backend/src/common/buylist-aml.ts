import { Prisma } from '@prisma/client';
import { SELL_REQUEST_NON_COMMITTING_STATES } from './sell-request-states';

/**
 * buylist-aml.ts (M-46, ARCHITECTURE §4.39c **sitios 2+3** / §4.39i.4 — **ZONA COMPARTIDA**) —
 * **el acumulado MENSUAL DE COMPROMISO del vendedor, en UN solo cuerpo.**
 *
 * ### Lo que colapsa aquí, y por qué era un problema de dinero
 * `UsersService.monthUsedCents` y `BuylistService.monthUsedCentsTx` eran **el mismo cuerpo
 * duplicado** —el JSDoc del segundo lo reconocía por escrito («misma regla que
 * `UsersService.monthUsedCents`»)— con **dos** literales de estados que había que acordarse de mover
 * **a la vez**. M-46 añade `expirada` al enum: con dos cuerpos, actualizar uno y no el otro deja al
 * sistema **mostrándole al vendedor una cuota** y **aplicándole otra**.
 *
 * ### Los DOS cambios de conducta que trae M-46, dichos en voz alta (QA debe verlos)
 *
 * **1. `expirada` DEJA de quemar cuota.** El predicado era `notIn ['rechazada','abandonada']`. Con
 * `expirada` fuera de esa lista, **una oferta que caducó le seguiría consumiendo el tope mensual al
 * vendedor** — cuota quemada por una operación que **no ocurrió** y que, en la mitad de los casos,
 * **caducó por un plazo NUESTRO** (regla 7). Ahora el predicado se escribe **por complemento** sobre
 * `SELL_REQUEST_NON_COMMITTING_STATES` (= los terminales **menos `pagada`**), así que mide lo que de
 * verdad pregunta: *«¿cuánto sigue COMPROMETIDO este mes?»*.
 *
 * **2. El monto pasa a ser el BRUTO OFERTADO cuando existe** (`offerGrossCents ?? quotedTotalCents ??
 * 0`, criterio 155). Antes solo existía `quotedTotalCents`. Desde M-46 lo vinculante es **lo que
 * ofertamos**, no lo que se cotizó: tras un cherry-pick, la cotización puede ser el doble del bruto
 * realmente comprometido, y cobrarle al vendedor cuota por líneas que **le dijimos que no
 * compraríamos** sería medir un compromiso que no existe.
 *
 * ### Por qué `findMany` + `reduce` y no `_sum`
 * El monto es un **COALESCE entre dos columnas**, y `_sum` de Prisma no lo expresa: sumar el campo
 * equivocado sería exactamente el error que este control existe para cerrar. El conjunto está
 * acotado por el propio tope (las solicitudes de **UN** vendedor en **UN** mes). Es el mismo patrón,
 * y por la misma razón, que `monthCommittedGrossPaidCentsTx`.
 *
 * ### ⚠️ Esto NO es la caja (§4.39i.4)
 * **Dos medidas conviven y NO se mezclan (criterio 155):** el **tope de compromiso** suma **BRUTOS**
 * (misma base que AML); el **acumulado de caja de M7** suma **NETOS** (`payoutNetCents`, lo que de
 * verdad salió por SPEI). *Si el tope sumara netos, un envío caro **bajaría** el acumulado y alguien
 * pasaría el tope sin que se note; si la caja sumara brutos, M7 reportaría una salida de dinero que
 * nunca ocurrió.*
 */

/**
 * Cliente mínimo que necesita este cuerpo. Acepta **el `PrismaService` y el `tx` de una
 * transacción** sin ramas ni sobrecargas: `PrismaClient` es asignable a `Prisma.TransactionClient`.
 * *La variante transaccional no es otra función: es la misma con otro cliente.*
 */
export type SellRequestReader = Pick<Prisma.TransactionClient, 'sellRequest'>;

/**
 * Inicio del mes en curso, en **UTC** — el mismo ancla que usaban los dos cuerpos previos. Se extrae
 * para que los tres acumulados (compromiso vivo, compromiso pagado y cualquier futuro) **no puedan
 * medir meses distintos**.
 */
export function monthStartUtc(now: Date = new Date()): Date {
  const start = new Date(now.getTime());
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

/**
 * **Acumulado mensual de COMPROMISO (brutos)** del vendedor: la base del tope AML por mes.
 *
 * Ancla en `createdAt` (**cuándo entró la solicitud**), que es lo correcto para un tope de
 * *compromiso*: la obligación nace al crearla. El acumulado de **caja** ancla en `paidAt`, y por eso
 * son dos funciones y no una con un flag.
 *
 * @param db `PrismaService` o el `tx` de una `$transaction` (SEC-A2: bajo aislamiento serializable el
 *           chequeo del tope y la creación de la solicitud tienen que ser atómicos).
 */
export async function monthCommittedGrossCents(
  db: SellRequestReader,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const rows = await db.sellRequest.findMany({
    where: {
      userId,
      createdAt: { gte: monthStartUtc(now) },
      // Por COMPLEMENTO (criterio 129): «sigue comprometido» = NO está en un terminal que ya no
      // compromete. `pagada` SÍ cuenta (comprometió y además pagó). Un estado nuevo del enum entra
      // aquí SOLO, que es el lado seguro para un tope.
      status: { notIn: [...SELL_REQUEST_NON_COMMITTING_STATES] },
    },
    select: { offerGrossCents: true, quotedTotalCents: true },
  });
  // Criterio 155: el BRUTO OFERTADO manda sobre el cotizado. Sin oferta emitida (o en filas previas
  // a M-46) la única medida que existe es la cotización.
  return rows.reduce((acc, r) => acc + (r.offerGrossCents ?? r.quotedTotalCents ?? 0), 0);
}

/**
 * v1.51.5 (ARCHITECTURE **§4.39i.4-bis**, NORMATIVO, DINERO, AML) — **el BRUTO CONSUMADO de una
 * solicitud: con qué columna se mide el compromiso que YA se consumó.**
 *
 * ```
 * brutoConsumado(sr) = approvedTotalCents ?? offerGrossCents ?? quotedTotalCents ?? 0
 * ```
 *
 * ### El hueco que cierra, dicho sin rodeos
 * El invariante 4 (criterio 155) fijaba **qué** mide cada acumulado —brutos el tope, netos la caja—
 * y **nunca dijo con qué columna**. Con una sola columna de bruto no costaba nada; **M-46 introduce
 * tres** y la omisión se vuelve un **hueco de tope**. El término que faltaba es el **central**,
 * `offerGrossCents`: sin él la cascada salta de *aprobado* a **cotizado**, y cotizado ≠ ofertado
 * **en los dos sentidos**:
 *
 * | Caso | `quotedTotalCents` | `offerGrossCents` | Acumulaba | Efecto |
 * |---|---|---|---|---|
 * | Cherry-pick al ofertar | **mayor** | menor | de más | injusto, pero **fail-closed** |
 * | **Override al alza (D26)** | **menor** | mayor | **de menos** | ⚠️ **el vendedor REBASA el tope mensual sin que nada lo note** |
 *
 * La segunda fila es la que obliga: **un acumulado AML que puede quedarse corto no es un tope.** Y el
 * override al alza no es hipotético: es una vía explícita del ciclo, con su propio motivo obligatorio.
 *
 * ### Los tres términos, en orden de cercanía al dinero que de verdad salió
 * 1. **`approvedTotalCents`** — el bruto **aprobado** tras la verificación. Es el que generó
 *    `payoutNetCents`, así que es el único que no miente sobre lo que se depositó. Lidera **porque
 *    en un estado terminal es final** — y que lo sea depende de la guarda de terminal de
 *    `itemDecision` (**BL-14**), que va en el mismo pase que esta función. *Sin ese candado, esta
 *    norma se apoya en una afirmación falsa.*
 * 2. **`offerGrossCents`** — el bruto **ofertado**. ⚠️ **EL TÉRMINO QUE FALTABA.** Aplica cuando la
 *    solicitud se pagó **sin ninguna decisión por-ítem** (`recomputeApprovedTotal` deja `null` si
 *    **ningún** ítem tiene `approvedPriceCents`, y `pay-spei` admite pagar desde `verificacion`). En
 *    el ciclo eso significa *«se aceptó todo tal cual se ofertó»*, y el bruto correcto es **el
 *    vinculante** (D2), no la cotización.
 * 3. **`quotedTotalCents`** — **SOLO filas pre-M-46**, donde es la única medida que existe. Con el
 *    ciclo vivo, llegar aquí es un **defecto de dato**, no un caso de negocio.
 *
 * **Cero regresión:** en toda fila pre-M-46 `offerGrossCents` es `null` ⇒ la cascada colapsa a la de
 * hoy (`approvedTotalCents ?? quotedTotalCents ?? 0`).
 *
 * ### ⚠️⚠️ POR QUÉ HAY **DOS** CASCADAS EN ESTE ARCHIVO Y NO SE UNIFICAN
 * `monthCommittedGrossCents` (arriba, sitios 2+3) se queda en **DOS** términos
 * (`offerGrossCents ?? quotedTotalCents ?? 0`) **y no es una inconsistencia: es la regla.** Se
 * escribe aquí, pegado, porque la simetría es tentadora y «unificarlas» **reabriría el agujero**:
 *
 * - **Miden preguntas distintas.** Arriba: *«¿cuánto sigue COMPROMETIDO este mes?»* (ancla
 *   `createdAt`, sobre solicitudes **vivas** + `pagada`). Aquí: *«¿cuánto compromiso se CONSUMÓ este
 *   mes?»* (ancla `paidAt`, **solo `pagada`**).
 * - **En una solicitud VIVA `approvedTotalCents` es PARCIAL**, y por eso no puede liderar allí: el
 *   recompute corre en **cada** decisión por-ítem, así que durante la verificación el número **sube
 *   desde `null`** conforme se deciden líneas. Un acumulado AML que puede **BAJAR** mientras la
 *   operación avanza es exactamente el bypass que el invariante 4 describe. **El compromiso se
 *   mantiene en el bruto ofertado hasta que la solicitud cierra.**
 * - **Aquí la solicitud es TERMINAL**, así que el aprobado es final y puede liderar.
 *
 * ⚠️ **No añadir `approvedTotalCents` a la de arriba «por consistencia».**
 */
export function brutoConsumado(sr: {
  approvedTotalCents: number | null;
  offerGrossCents: number | null;
  quotedTotalCents: number | null;
}): number {
  return sr.approvedTotalCents ?? sr.offerGrossCents ?? sr.quotedTotalCents ?? 0;
}

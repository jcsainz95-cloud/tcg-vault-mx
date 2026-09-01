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

import { Finish, ProductType } from '@prisma/client';

/**
 * `inventory-position.port.ts` (v1.51, **M-46**, ARCHITECTURE §4.39f) — **el ÚNICO dato que cruza de
 * `inventory` a `buylist`**: cuántas piezas ON-HAND de plataforma tenemos de una variante.
 *
 * ### Por qué un puerto y no `imports: [InventoryModule]`
 * `buylist` vive en el stream «Catálogo y precios» e `inventory` en «Inventario y vault». Un
 * `imports: [InventoryModule]` en `BuylistModule` haría que cualquier cambio en el conjunto de
 * providers de `inventory` pudiera **romper el arranque** de `buylist`, y los dos streams tienen que
 * poder mergear por separado. Además la superficie es diminuta y de **solo lectura**: importar el
 * módulo entero traería un grafo de servicios de ESCRITURA de inventario a un módulo que **no debe
 * poder escribir inventario**.
 *
 * Lo **declara y provee `inventory`** (dueño del dato); lo **consume `buylist`**.
 *
 * ### ⚠️ DIFERENCIA CRÍTICA CON `MAIL_PORT` — esto NO se copia por analogía
 * `MAIL_PORT` es **best-effort**: si falta, se loggea y se sigue (un correo que no sale no corrompe
 * una decisión). **Este puerto NO es best-effort.** Si no responde:
 *
 * - **PROHIBIDO devolver `0`.** Un «0 en inventario» que en realidad significa «no pude contar» es el
 *   fallo que `PROJECT.md` §P.8 llama *«peor que no mostrar nada, porque se ve confiable»*: empuja al
 *   operador a **comprar de más**, y eso es capital mal puesto.
 * - La mesa devuelve `position: null` + `positionUnavailable: true` y `suggestion.verdict = "none"`.
 *   El frontend pinta «SIN CONTEO» y **no puede** inferir una sugerencia. **Fail-visible, no
 *   fail-silent.**
 *
 * El `@Optional()` del `@Inject` en el consumidor existe **solo** para que los tests unitarios que
 * construyen el servicio a mano no truenen (mismo motivo que en `MAIL_PORT`); en runtime la ausencia
 * del provider es un **defecto de arranque** y se emite un `error` en el log de izado.
 */
export const INVENTORY_POSITION_PORT = 'INVENTORY_POSITION_PORT';

/**
 * Identidad de la variante que se cuenta. **Incluye `cardProductId`** (D7 / §4.39d): un conteo que
 * mezcla una promo con su versión del set base *es peor que no mostrar nada*, porque el operador lo
 * creería.
 */
export interface VariantPositionRef {
  cardId: string;
  productType: ProductType;
  /** gradeKey **canónico** de `pricing.gradeKeyFor` (`raw:NM` | `graded:PSA:10` | `sealed` | …). */
  gradeKey: string;
  finish: Finish;
  /** M-46 (§4.39d). `null` = set_base. Es el `tcgplayerProductId`, NO el UUID interno. */
  cardProductId: number | null;
}

export interface InventoryPositionPort {
  /** Piezas ON-HAND de PLATAFORMA por variante. Lote (una query), sin N+1. Solo lectura. */
  onHandCountsFor(refs: VariantPositionRef[]): Promise<Map<string /*variantPositionKey*/, number>>;
}

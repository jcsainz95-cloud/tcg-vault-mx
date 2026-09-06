import { ProductType, RawCondition } from '@prisma/client';

/**
 * business-rules.ts — **listas que son una DECISIÓN DE PRODUCTO, no un espejo del schema.**
 *
 * ### Por qué existe este archivo (y por qué NO es `enum-values.ts`)
 * `common/enum-values.ts` deriva de Prisma los enums cuyo **conjunto completo** ES la regla
 * (`SealedSubtype`, `Finish`, …). Su propio docstring ya avisa del reverso: un `@IsIn` que acepta a
 * propósito un **subconjunto** no se deriva, porque su lista es una decisión de negocio y derivarla
 * **rompería la regla**. Ese aviso vivía sólo en un comentario, así que la trampa se activó igual.
 *
 * ### El caso que lo obligó (v2.1.9 · S49-P4, seguridad)
 * En v2.1.8 las cuatro `@IsIn(['NM'])` del alta de inventario pasaron a `@IsIn(RAW_CONDITION_VALUES)`.
 * Hoy no cambia nada —`enum RawCondition { NM }` tiene un solo valor— pero **«raw = solo NM» es
 * decisión de `PROJECT.md` §H**, no un reflejo de la BD: el marketplace opera raw únicamente en Near
 * Mint, en Compra, filtros, inventario y buylist. En un marketplace de cartas, añadir `LP`/`MP` al
 * enum es un cambio **probable**, no hipotético — y con la lista derivada, ese día el backend
 * empezaría a **aceptar y publicar** cartas LP sin que nadie lo decidiera, silenciosamente.
 *
 * La distinción, en una frase: **`enum-values.ts` responde «¿qué valores EXISTEN?»; este archivo
 * responde «¿cuáles ACEPTAMOS?».** Cuando las dos respuestas coinciden hoy, sigue importando cuál de
 * las dos preguntas se está haciendo, porque es la que decide qué pasa mañana.
 *
 * El ancla que lo vigila está en `test/enum-values-parity.spec.ts`: si el schema gana un valor, ese
 * test rompe y obliga a decidir aquí, a mano, si la regla de negocio se ensancha también.
 *
 * (`UserStatus` es el otro caso de esta familia y NO está aquí: su lista vive inline en
 * `admin.controller.ts` con su propio porqué, porque tiene UN solo call-site.)
 */

/**
 * **Condiciones de carta suelta que el marketplace ACEPTA: sólo Near Mint** (`PROJECT.md` §H;
 * `API_CONTRACT` §DTOs «RawCondition = NM» y §E «la condición de compra es siempre NM»).
 *
 * Aplica a los dos ejes de dinero: al **alta de inventario** (M1 — lo que se puede capturar y
 * publicar) y a la **cotización de buylist** (§E — «solo compramos cartas en Near Mint; si al
 * recibir/verificar no está en NM, no se compra»).
 *
 * ⚠️ **NO la sustituyas por `RAW_CONDITION_VALUES`.** Que hoy coincidan con el enum del schema es
 * una coincidencia, no una equivalencia: el día que el schema gane `LP`/`MP` (para, por ejemplo,
 * registrar una devolución no-NM sin publicarla), derivar esta lista abriría la venta y la compra de
 * cartas que la política prohíbe — sin código nuevo y sin que ningún test lo notara.
 */
export const ACCEPTED_RAW_CONDITIONS: readonly RawCondition[] = ['NM'];

/**
 * v1.53 (§4.40.3.1, **MONEY**) — **tipos de producto que el BUYLIST acepta: sólo `raw`.**
 *
 * `PROJECT.md` §E se titula, literal, **«Buylist — compra de *raw* a usuarios»**, y su cuerpo entero
 * es raw NM: *«la condición es fija en Near Mint (NM), **único grado que compramos**»*. §K está
 * **LOCKED**: *«El sellado es solo venta… No hay buylist de sellado… El **cotizador y el pipeline de
 * buylist siguen siendo solo para raw (§E)**»*. Y el **criterio de aceptación 61**: *«no existe flujo
 * de buylist de sellado, **ni cotizador ni pipeline**»*.
 *
 * ### El defecto de DINERO que esta lista cierra (§4.40.1)
 * El cotizador ofrecía `graded` y `sealed`, pero **ningún DTO de buylist tiene —ni tuvo nunca— dónde
 * capturar QUÉ grado es el slab**, y `buildGradeKey` rellenaba el hueco con
 * `` `graded:${gradingCompany ?? 'PSA'}:${gradeValue ?? '10'}` `` ⇒ **toda carta graduada se cotizaba
 * contra la referencia de PSA 10, el grado más caro que existe**, fuera un PSA 6 o un CGC 8. Con la
 * oferta vinculante desde el correo eso deja de ser un error corregible y pasa a ser un compromiso
 * firmado.
 *
 * ⚠️ **NO la sustituyas por `PRODUCT_TYPE_VALUES`.** Es exactamente el caso para el que existe este
 * archivo: `enum-values.ts` responde «¿qué valores EXISTEN?», éste responde «¿cuáles ACEPTAMOS?».
 * Derivarla del enum haría que el día que alguien añada un `ProductType` el buylist empiece a
 * comprarlo **sin que nadie lo decida**.
 *
 * ⚠️ **Ensancharla NO es una tarea de backend.** Comprar graduadas es una decisión de producto
 * (§4.40.6): la responde el dueño, `product-owner` actualiza `PROJECT.md`, y sólo entonces se
 * programa `M-49` (§4.40.7) para capturar la identidad del slab. Añadir `'graded'` aquí sin esas dos
 * cosas devuelve el default silencioso por la puerta de atrás.
 *
 * La guarda que usa esta lista es **server-side** (`buylist.service.ts` → `422 BUYLIST_RAW_ONLY`): el
 * selector del cotizador es sólo UI y un `curl` la esquivaría (SEC-A1).
 */
export const BUYLIST_ACCEPTED_PRODUCT_TYPES: readonly ProductType[] = ['raw'];

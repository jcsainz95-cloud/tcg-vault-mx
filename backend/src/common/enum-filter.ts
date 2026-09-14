import { BusinessException } from './business.exception';

/**
 * enum-filter.ts — **un filtro de enum en query: o filtra, o `400`. Lo que NUNCA hace es `500`.**
 *
 * ### De dónde sale (`P-84`, medido 2026-09-13 sobre `c12b940`, app real + Postgres real)
 * `A5` cerró `GET /admin/users`, pero el **mismo camino de código** —un valor de query CRUDO metido
 * en un `where` de Prisma con `as never`— seguía vivo en otros SEIS ejes. Prisma lanza
 * `PrismaClientValidationError`, que **no es una `HttpException`**, y el filtro global
 * (`common/filters/all-exceptions.filter.ts`) manda todo lo que no lo sea a `500 INTERNAL`.
 *
 * Medido por HTTP, antes de este fichero — **6/6 devolvían `500`**, ninguno estaba protegido aguas
 * arriba:
 *
 * | Ruta | Eje | Antes | Ahora |
 * |---|---|---|---|
 * | `GET /admin/orders` | `status` | `500 INTERNAL` | `400` |
 * | `GET /admin/disputes` | `status` | `500 INTERNAL` | `400` |
 * | `GET /admin/shipments` | `status` | `500 INTERNAL` | `400` |
 * | `GET /admin/inventory/items` | `status` | `500 INTERNAL` | `400` |
 * | `GET /admin/inventory/items` | `ownerType` | `500 INTERNAL` | `400` |
 * | `GET /admin/inventory/items` | `zone` | `500 INTERNAL` | `400` |
 *
 * Un `500` disparable desde la barra de direcciones es, además de un fallo de producto, ruido que
 * **entierra los `500` de verdad** en la bitácora de errores.
 *
 * ### Por qué vive AQUÍ y no como séptima copia (deuda `H3`)
 * Cuando `P-84` empezó, este helper existía **cuatro veces** con tres formas de `details` distintas
 * para el mismo error:
 *
 * | copia | `details` que emite | `message` |
 * |---|---|---|
 * | `admin.service.ts` (`A5`) | `{ field, allowed }` | `invalid ${field} filter '${value}'` |
 * | `buylist.service.ts` (CSV de `status`) | `{ invalidStatus }` | — |
 * | `catalog.service.ts` · `validateEnum` | **`{ field, value, allowed }`** | `Invalid ${field} filter` (**sin el valor**) |
 * | `inventory.controller.ts` (`finish`/`productType`, inline ×2) | `{ finish, allowed }` / `{ productType, allowed }` | — |
 *
 * ⚠️ **Esa fila del catálogo decía `{ field, allowed }` hasta hoy, y era el artefacto más caro del
 * fichero** (QA/techlead, condición de veredicto de `P-89`). Leída literal, afirmaba que **migrar el
 * catálogo no retiraba ninguna llave** — y `echoValue`, treinta líneas más abajo, existe justamente
 * porque eso **no era verdad**. La tabla desmentía el motivo de la bandera que la propia tabla
 * justificaba. Verificado contra el árbol, no contra la memoria:
 * `git show 8d29988:backend/src/modules/catalog/catalog.service.ts` **`:783-789`** ⇒
 * `{ field, value, allowed }`. *Es la misma clase de defecto que abrió `P-84` → `P-89` → `P-90`: una
 * prosa que afirma un estado que nadie volvió a medir.*
 *
 * ⭐ **Y al corregirla aparece un hecho que nadie había dicho: `P-89` ENSANCHÓ el eco, no solo lo
 * conservó.** La columna `message` de arriba lo enseña — el catálogo emitía `Invalid ${field}
 * filter`, **sin el valor del cliente**; el helper al que migró lo emite **con** el valor. Así que en
 * los seis ejes del catálogo el valor pasó de viajar **una** vez (`details.value`) a viajar **dos**
 * (`message` + `details.value`). La amplificación que QA midió (`?condition=<5000 chars>` ⇒ **10 137
 * bytes** de respuesta, sin sesión) es **mitad herencia y mitad `P-89`**, y decirlo importa porque la
 * mitad nueva es la que este fichero podía haber evitado. Se acota abajo (`ENUM_FILTER_ECHO_MAX`).
 *
 * Añadir seis llamadores más a una copia **deja la clase abierta**: el séptimo eje se cae por el
 * mismo agujero. Se declara una vez, y los call-sites la importan.
 *
 * ### `P-89` (2026-09-13) — las DOS copias que `P-84` dejó vivas están migradas: quedan **CERO**
 * `P-84` cerró la mitad (4 copias ⇒ 2). Las dos restantes eran las del catálogo público
 * (`catalog/catalog.service.ts` y su copia **verbatim** en `sealed-catalog.service.ts`), y `P-84` las
 * dejó **citando el censo de §0-Q punto 4, que las declara «✅ conforme»**. El censo se equivocaba,
 * igual que se había equivocado con `/admin/users`: lo eran en **la forma del `details`**, no en
 * **§0-Q punto 1 fila 1** — sus seis ejes escribían `if (q.X)` y `' '` es truthy ⇒ `400` donde la
 * norma manda `200`. Medido por HTTP, **6/6 ejes rojos**, endpoint `@Public()`:
 * `test/integration/catalog-enum-filters-empty.e2e-spec.ts`.
 *
 * El pago no fue solo el `400`: eran **seis `as never`**. `Set<string>` colapsaba el genérico `T` a
 * `string`, así que el call-site tenía que anular al compilador para meter el valor en el `where` —
 * y `as never` es la instrucción que dejó vivir meses los seis `500` de `P-84` sin que nadie los
 * viera. Con los dominios declarados `readonly <EnumDePrisma>[]`, `T` resuelve al enum y los seis
 * `as never` desaparecen (`rg 'as never' backend/src/modules/catalog/` ⇒ **0 en código**).
 *
 * ### ⚠️ La lista `allowed` decide la CLASE, y la clase NO la decide este fichero
 * Igual que en `common/enum-values.ts`, la pregunta se contesta **por endpoint**: *si mañana alguien
 * añade un valor a este enum en `schema.prisma`, ¿este endpoint debe aceptarlo solo?*
 *
 *  - **Sí ⇒ clase E:** pasa `Object.values(PrismaEnum)`. Es el caso de los **seis** ejes de `P-84`,
 *    y no por comodidad: un filtro de lista del back-office existe para que el operador rebane la
 *    tabla **entera**. Si el schema gana un estado y la lista está escrita a mano, el operador recibe
 *    un `400` al filtrar por un estado que **existe de verdad en su base** — y el estado nuevo se
 *    vuelve invisible en el back-office. Aquí la clase R sería activamente peor que la E.
 *  - **No/depende ⇒ clase R:** el endpoint acepta a propósito un **subconjunto** fijado por
 *    `PROJECT.md`. Esa lista se declara literal en `common/business-rules.ts` (o inline en su único
 *    call-site) con la cláusula citada al lado, y se pasa a este helper igual. El helper es el mismo;
 *    lo que cambia es **de dónde sale `allowed`**.
 */

/**
 * Comprueba que `value` pertenece a `allowed`; si no, `400 VALIDATION_ERROR`.
 *
 * ### ⚠️ Se EXPORTA con cero llamadores directos de producción, y es a propósito (`P-89`)
 * Medido el 2026-09-13: el único llamador en `src/` es `parseEnumFilter`, aquí abajo (`rg
 * assertEnumFilter backend/src/` ⇒ esta declaración, esa llamada, y un comentario en
 * `admin/admin.service.ts:818`). **No es código muerto y no se des-exporta**, por dos razones:
 *
 *  1. **Es la costura, y tiene pruebas propias.** La forma del `400` (§0-Q punto 2: `field`
 *     obligatorio, `allowed` obligatorio, `allowed` es una **copia**) es una propiedad de ESTA
 *     función. `test/enum-filter.spec.ts` la ejercita directa; medirla a través de `parseEnumFilter`
 *     acoplaría las pruebas de la **forma del error** a la lógica de **ausente/vacío**, que es
 *     justamente la separación por la que hay dos funciones y no una.
 *  2. **Es la mitad que sirve cuando el valor YA se sabe presente** — un token de un CSV, un
 *     parámetro de ruta, un campo que otro guard ya cribó. Ese caso existe hoy (el CSV de
 *     `GET /admin/buylist`) y no la usa **por una razón medida, no por olvido**: ese endpoint emite
 *     `details.invalidStatus` con **todos** los tokens malos de una vez, y lanzar por token perdería
 *     la lista (`buylist/buylist.service.ts:2205-2224`).
 *
 * Lo que sí sería un problema —y por eso se deja escrito— es que quedara exportada **sin pruebas**:
 * entonces no sería una costura, sería superficie.
 *
 * `400` y no `422`: es **query**, y es el código que ya usan los listados admin de este contrato.
 *
 * **`details.field` es obligatorio y es el punto entero.** `GET /admin/inventory/items` admite
 * **tres** ejes de enum en la misma petición (`status`, `ownerType`, `zone`): un `400` que no diga
 * *cuál* rechazó deja al operador adivinando entre tres. Se emite también `details.allowed` para que
 * el cliente pueda mostrar las opciones válidas sin consultar el contrato.
 *
 * ⛔ **Lo que este helper NO hace: rechazar llaves desconocidas** (`?zzz=1`). Es otro cambio, de otro
 * riesgo: rechazar una llave desconocida **puede romper a un cliente que hoy funciona**, mientras que
 * validar un enum que ya devuelve `500` no puede romper a nadie —quien lo manda ya está recibiendo un
 * `500`—. Por eso `A5` se acotó a su endpoint y `P-84` no amplía de lo segundo a lo primero.
 *
 * ### `echoValue` (P-89) — existe para NO RETIRAR una llave ya publicada, no para dar a elegir
 * El catálogo público emitía `details.value` desde antes de este helper, y §0-Q punto 2 lo declara
 * **OPCIONAL** («se admite porque el helper del catálogo ya lo emite; no se exige»). Migrar el
 * catálogo aquí **sin** esta bandera habría **retirado una llave de la respuesta publicada de un
 * endpoint `@Public()`** —cuyos clientes no son solo el nuestro y por tanto **no se pueden medir**—
 * a cambio de nada: `field` y `allowed` no cambian.
 *
 * ⛔ **No es un punto de extensión.** Un call-site NUEVO no la enciende: el dominio de `details` de
 * §0-Q son `field` + `allowed`, y quien recibe el `400` ya tiene el valor (lo mandó él). Vive aquí,
 * en UN sitio, precisamente para que la variación no vuelva a ser una copia del helper — que es la
 * deuda `H3` entera.
 *
 * ### ⭐ `H3-d` — y desde hoy esa prohibición es un CANDADO, no este párrafo
 * QA/techlead lo midieron y tenían razón: `grep -rn echoValue backend/test/` solo daba pruebas de
 * **conducta**, ninguna que **congelara los call-sites**. Eran 6/6 correctos y nada impedía que el
 * séptimo eje la encendiera y §0-Q volviera a tener dos formas de `details` — *un docstring que
 * prohíbe algo que ningún test comprueba es exactamente la deuda que `P-84` → `P-89` → `P-90` vienen
 * pagando*. El censo vive en `test/enum-filter.spec.ts` («censo CONGELADO de call-sites») y fija los
 * **seis**: 4 en `catalog.service.ts`, 2 en `sealed-catalog.service.ts`. Encenderla en un eje nuevo
 * pone ese test en rojo, y la salida no es apagar el test: es ir al **arquitecto** (regla 9), porque
 * ensanchar el dominio de `details` es cambiar §0-Q.
 *
 * ⚠️ El censo mira **código** (`stripComments`), no texto — si mirara texto, este mismo párrafo lo
 * dispararía y habría que meter este fichero en una lista blanca. Ése era el defecto que `H3-d` le
 * quitó a `enum-values-parity.spec.ts`, y no se replica aquí.
 */
/**
 * **Tope del eco del valor del cliente. El tamaño de la respuesta NO lo decide quien la pide.**
 *
 * ### El defecto (QA, condición de veredicto de `P-89`, medido por HTTP sobre `3c1bd1e`)
 * `GET /catalog/cards?condition=<5000 chars>` ⇒ **10 137 bytes de respuesta por ~5 KB de petición**,
 * **sin sesión** (el catálogo es `@Public()`). El valor salía **dos veces** —`message` y
 * `details.value`— íntegro y sin tope: ~2× de amplificación a coste cero para el emisor.
 *
 * ⚠️ **No es XSS, y decirlo evita el arreglo equivocado.** QA lo midió: `Content-Type:
 * application/json`, `nosniff`, y un `<script>` sale **escapado como dato**. El problema no es que el
 * valor se interprete: es que **viaja**. Por eso la respuesta no es «sanear» (no hay nada que sanear)
 * sino **acotar**.
 *
 * ### Por qué 64 y no un número redondo cualquiera
 * El eco existe para que el cliente reconozca **su** token — un error de dedo, un `holofil` por
 * `holofoil`. Medido el 2026-09-13 sobre `schema.prisma`: el valor de enum **más largo de todo el
 * esquema** es `first_edition_holofoil`, **22 caracteres**, sobre **157** valores. 64 deja casi **3×**
 * de holgura sobre el token legítimo más largo que podría existir, y un valor de más de 64 caracteres
 * **no es un near-miss de ningún token**: es otra cosa. La holgura no se afirma, se **vigila**:
 * `test/enum-filter.spec.ts` falla si alguien mete en el schema un valor que no quepa aquí.
 *
 * ### Se trunca DICIÉNDOLO, y ahí está el punto
 * Se emite `…(+N)` con los caracteres omitidos. Un truncado silencioso convierte *«mandaste esto»* en
 * una **afirmación falsa** sobre lo que el cliente mandó — y este proyecto ya sabe lo que cuesta una
 * prosa que afirma un estado que no midió (la tabla de arriba). Con el `+N`, el mensaje sigue siendo
 * verdadero: *«empezaba así, y había N caracteres más»*.
 *
 * ### ⛔ El tope NO es configurable por entorno
 * Un `ENUM_FILTER_ECHO_MAX` leído de env sería un botón para reabrir el agujero en producción sin
 * tocar código. Es una constante, y su prueba es la que la sostiene.
 */
export const ENUM_FILTER_ECHO_MAX = 64;

/** El valor del cliente, acotado y **declarando** lo que omitió. Ver `ENUM_FILTER_ECHO_MAX`. */
function echoSafe(value: string): string {
  if (value.length <= ENUM_FILTER_ECHO_MAX) return value;
  return `${value.slice(0, ENUM_FILTER_ECHO_MAX)}…(+${value.length - ENUM_FILTER_ECHO_MAX})`;
}

export function assertEnumFilter<T extends string>(
  field: string,
  value: string,
  allowed: readonly T[],
  opts?: { echoValue?: boolean },
): T {
  if (!(allowed as readonly string[]).includes(value)) {
    // ⚠️ El eco va acotado en LAS DOS puntas (`message` y `details.value`). Acotar solo una deja la
    // amplificación intacta: eran las dos las que copiaban el valor entero.
    const shown = echoSafe(value);
    throw BusinessException.badRequest('VALIDATION_ERROR', `invalid ${field} filter '${shown}'`, {
      field,
      ...(opts?.echoValue ? { value: shown } : {}),
      allowed: [...allowed],
    });
  }
  return value as T;
}

/**
 * **El parámetro de query COMPLETO de §0-Q: las tres conductas en un solo sitio.**
 *
 * `assertEnumFilter` valida un valor que ya se sabe presente; esto decide **antes** si hay valor.
 * Existe porque el borde que se colaba no era la validación sino el `if (status)` que la precedía:
 *
 * | Entrada | Devuelve |
 * |---|---|
 * | ausente / `null` | `undefined` — **no filtra**, `200` |
 * | `''`, `' '`, `'\t'` (vacío **tras `trim()`**) | `undefined` — **no filtra**, `200` |
 * | token exacto del dominio | el token |
 * | cualquier otra cosa — incluido `' pending'` | ⛔ `400 VALIDATION_ERROR` |

 *
 * ### ⚠️ El `trim()` decide si está VACÍO; NO «arregla» el token
 * Es la distinción que separa dos conductas que se confunden fácil, y `A5` ya la tenía fijada con
 * prueba viva (`test/admin.users-kyc-filter.spec.ts:218-223`: *«mayúsculas/espacios NO se arreglan:
 * `Pending` es un valor distinto y cae en 400»*, con `' pending'` entre los casos). §0-Q punto 1 usa
 * `trim()` **solo** en la fila de la entrada vacía («a cadena vacía, o solo espacios (tras `trim()`)»);
 * la fila del token exige el «token del dominio aceptado», y `' pending'` no lo es.
 *
 * La razón de fondo no es legalista: **normalizar entrada silenciosamente es la misma familia de
 * error que ignorar el filtro.** Si el servidor «corrige» `' pending'`, el día que un cliente mande
 * `'pending '` por un bug propio nadie se entera — y cuando el bug importe, no habrá señal. Vacío es
 * *«no me filtres»*, que es una intención; un token con basura alrededor es *entrada mal formada*.
 *
 * ### El `trim()` no es cosmético: era un `500`
 * Los seis sitios de `P-84` escribían `if (status)`, y en JS **`' '` es truthy**. Un espacio —lo que
 * manda un `<input>` que el operador tocó y dejó en blanco— pasaba el `if`, llegaba crudo a Prisma y
 * salía `500`. Y un `Select` en «Todas» manda cadena **vacía**: por eso vacío ⇒ *no filtra* y
 * **nunca** `400` (§M6-L.3 — tratarla como inválida rompe la pantalla por su estado por defecto).
 *
 * ### ⚠️ Lo NO ESCALAR (`?status=a&status=b`) — medido 2026-09-13, y NO es lo que el contrato supone
 * §0-Q punto 1 fila 3 dice que el parser entrega un **array**. **En esta app no llega ningún array al
 * handler.** El `ValidationPipe` global va con `transform: true` (`src/main.ts:56`) y el parámetro se
 * declara `@Query('status') status?: string`, así que Nest **coacciona el array al metatipo `String`**
 * *antes* del handler: `['a','b']` ⇒ `'a,b'`.
 *
 * Medido por HTTP (`GET /admin/buylist?status=pagada&status=bogus` ⇒ `400 details.invalidStatus:
 * ['bogus']`, **byte a byte igual** que `?status=pagada,bogus`): `.split(',')` **funcionó**, luego era
 * una cadena. No hay `TypeError` y **no hay `500`** en el séptimo sitio.
 *
 * Consecuencia práctica: en los seis ejes escalares `'a,b'` **no pertenece al dominio** ⇒ `400`, que es
 * lo que §0-Q pide, aunque por un mecanismo distinto del que el contrato describe. La rama
 * `typeof !== 'string'` de abajo es, por tanto, un **cinturón** hoy inalcanzable: se deja porque es
 * barata y porque el día que alguien quite `transform` o escriba el parámetro con otro tipo, el array
 * volvería a viajar — y entonces sí llegaría crudo a Prisma.
 */
export function parseEnumFilter<T extends string>(
  field: string,
  raw: unknown,
  allowed: readonly T[],
  opts?: { echoValue?: boolean },
): T | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') {
    // Cinturón: ver el docstring. Hoy inalcanzable por `transform: true`, no por diseño del handler.
    throw BusinessException.badRequest('VALIDATION_ERROR', `invalid ${field} filter (not scalar)`, {
      field,
      allowed: [...allowed],
    });
  }
  // `trim()` SOLO para decidir si viene vacío. El valor que se valida es el que mandó el cliente,
  // sin recortar: `' pending'` es entrada mal formada (`400`), no un `pending` con adornos.
  if (raw.trim() === '') return undefined;
  return assertEnumFilter(field, raw, allowed, opts);
}

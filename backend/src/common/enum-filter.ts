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
 * | copia | `details` que emite |
 * |---|---|
 * | `admin.service.ts` (`A5`) | `{ field, allowed }` |
 * | `buylist.service.ts` (CSV de `status`) | `{ invalidStatus }` |
 * | `catalog.service.ts` · `validateEnum` | `{ field, allowed }` |
 * | `inventory.controller.ts` (`finish`/`productType`, inline ×2) | `{ finish, allowed }` / `{ productType, allowed }` |
 *
 * Añadir seis llamadores más a una copia **deja la clase abierta**: el séptimo eje se cae por el
 * mismo agujero. Se declara una vez, y los call-sites la importan.
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
 */
export function assertEnumFilter<T extends string>(
  field: string,
  value: string,
  allowed: readonly T[],
): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw BusinessException.badRequest('VALIDATION_ERROR', `invalid ${field} filter '${value}'`, {
      field,
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
  return assertEnumFilter(field, raw, allowed);
}

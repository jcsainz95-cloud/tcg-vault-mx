/**
 * query-axis-cross.ts — ⭐⭐ **EL CRUCE de `C-EQ-1`, y sus cuatro listas de clase, en UN solo sitio.**
 *
 * ### Por qué existe: `R1` del techlead, y es la misma lección dos veces
 * `enum-query-census-canary.spec.ts` demuestra que el descubrimiento **muerde** y que **no es
 * ciego**. Hasta hoy lo demostraba sobre una **copia local** del cruce: una `huerfanos()` propia, con
 * tres listas y `noEnum` cruzada **por nombre** — el cruce que `QA-M4` refutó. O sea: *el canario
 * certificaba una operación distinta de la que se embarca*. techlead lo razonó deductivamente y es
 * irrebatible: **el canario no importaba ni una lista del spec, luego revertir la partición no podía
 * poner roja ninguna aserción suya.**
 *
 * ⚠️ **Y el propio canario tenía escrita la regla que incumplía** (`:222-227`): *«si alguien copiara
 * el escáner en el spec, el canario dejaría de cubrirlo sin que nada sonara»*. La costura del
 * **escáner** estaba blindada; la del **cruce** —justo la que este pase cambió— no. *Se encarece con
 * cada regla nueva: hoy la divergencia es una lista, mañana son tres.*
 *
 * ### Qué vive aquí y qué NO
 * Aquí vive **la operación** (`huerfanos`) y las **cuatro listas estáticas** de clase. ⛔ **`REGISTRO`
 * NO**: es la transcripción de §0-Q punto 4, depende de los enums de Prisma y de fixtures HTTP, y es
 * de la suite de integración. Entra al cruce **como parámetro**, que es lo que permite que el canario
 * lo alimente con un registro sintético.
 *
 * ### La propiedad que este fichero hace cierta
 * *Un `@Query` que no esté en NINGUNA de las cinco (cuatro listas + el registro) ⇒ ROJO.* Y ahora la
 * demuestran **sobre el mismo código** el candado (`enum-query-axes.e2e-spec.ts`, por HTTP, contra la
 * app real) y su canario (`enum-query-census-canary.spec.ts`, unitario, sobre fuentes sintéticas).
 */
import type { QueryAxisSite } from './query-axis-census';

/**
 * ⭐⭐ **`NO_ENUM` se parte en DOS, y la partición es el arreglo de `QA-M4`.**
 *
 * ### El defecto, medido
 * Esta lista se cruzaba **entera por nombre**. QA plantó un endpoint NUEVO con `@Query('rarity')`
 * y `@Query('action')` —dos nombres de aquí— y el descubrimiento salió **3/3 VERDE** (censo
 * 176 → 178: el escáner **sí lo veía**; era el cruce el que lo absolvía). Reproducido por mí antes
 * de tocar nada: **3/3 verde** (N=3). Es exactamente el hueco que el canario `m1` ya demuestra
 * cerrado del lado del **registro** —*«un endpoint NUEVO que reusa un nombre ya registrado en OTRA
 * ruta ⇒ huérfano igual»*— y que seguía **abierto de este lado**.
 *
 * ### Por qué NO se cierra pasándolo todo a `MÉTODO /ruta::param`
 * Porque de las dos mitades, **una sí es transversal de verdad y la otra no**, y tratarlas igual
 * rompe algo en las dos direcciones:
 *
 *  - **`TRANSVERSAL` (92 sitios, 14 NOMBRES — medido)** — `?page=`, `?pageSize=`, `?q=`, los
 *    identificadores y los montos. Su dominio es abierto **por la FORMA del valor**: un `?page=` es
 *    un número, un `?setId=` es un uuid y un `?q=` es texto libre **en cualquier ruta, presente o
 *    futura**. Fijarlos **por ruta** obligaría a tocar esta lista en cada endpoint paginado nuevo —
 *    decenas de entradas que solo dicen «esto sigue siendo un número» y que nadie leería. *Una lista
 *    que hay que actualizar para que no moleste es una lista que se actualiza **sin mirar**.*
 *
 *    ⭐⭐ **`R2a` (techlead + `QA-M5`) — la puerta más barata de las cinco, y era la única sin techo.**
 *    QA lo demostró **con mutación, no leyendo**: el experimento de `QA-M4` cambiando solo los
 *    nombres —endpoint nuevo con `@Query('q')` y `@Query('date')`— salió **3/3 VERDE (N=3)**. Se
 *    cierra con **dos** medidas, y hacen falta las dos porque cada una tapa un agujero distinto:
 *
 *     1. **Techo: `toEqual` sobre los nombres** (en el trinquete de `C-EQ-1`). Impide que la lista
 *        **crezca**: `NO_ENUM_TRANSVERSAL.push('kind')` es **una palabra** que exime ese nombre en
 *        **todas** las rutas, presentes y futuras — más barato y más global que añadirlo a
 *        `POR_RUTA`, que al menos obliga a nombrar la ruta. Va con `toEqual` y no con `length <= N`
 *        porque **sustituir** un nombre por otro es igual de peligroso que añadirlo.
 *     2. ⭐ **Afinar el CRITERIO: `?from=`, `?to=` y `?date=` se van a `POR_RUTA`** (21 sitios).
 *        **El techo por sí solo NO pone roja la mutación de QA** —`q` y `date` ya estaban dentro, así
 *        que un endpoint nuevo que los reusara seguía absuelto—, y decir que `R2a` cierra `QA-M5` sin
 *        esto sería afirmar más de lo que el candado sostiene. El criterio correcto es más estrecho
 *        de lo que estaba escrito: se exime por nombre **solo si ningún dominio cerrado plausible
 *        podría llamarse así**. Una «fecha» no lo cumple: `?date=today|yesterday|week` —el caso que
 *        QA puso encima— es un **dominio cerrado con nombre de fecha**, y es plausible porque los
 *        atajos de periodo son lo primero que le piden a un informe.
 *
 *    ⛔ **Lo que se descartó, con el argumento de techlead y no por pereza:** un tope sobre el
 *    **número de sitios** transversales. Pondría roja `QA-M5` entera, sí — pero habría que **subirlo**
 *    en cada endpoint paginado nuevo, y *un tope que hay que subir para que no moleste se sube sin
 *    mirar*. Es la misma frase con la que se justifica cruzar por nombre; no se puede invocar para
 *    una mitad e ignorar en la otra.
 *  - **`POR_RUTA` (38 sitios, fijados con `toEqual` + tope)** — `?rarity=`, `?action=`,
 *    `?entityType=`, las doce banderas booleanas, los veintiún `?from=`/`?to=`/`?date=` de `R2a` y
 *    —desde D56— los **dos** del `/preview` del dial de IVA (`ivaTransferPct`, `samplePriceCents`:
 *    entero acotado e importe, ⛔ no dominios de tokens).
 *    Aquí la exención **no** se sigue del nombre: se sigue de una **medición de ESA ruta**
 *    («`Card.rarity` es `String`, no enum», «esto es un booleano», «esto es una fecha y no atajos»).
 *    Esa medición ⛔ **no se hereda** a una ruta nueva: mañana `?rarity=` puede ser un enum en otro
 *    endpoint, y `?action=` de `/admin/audit-log` es texto libre **porque su columna lo es**, no
 *    porque se llame `action`. Con la lista fijada por llave, el endpoint de `QA-M4` sale
 *    **huérfano** y el descubrimiento se pone ROJO, que es lo que tenía que pasar desde el principio.
 *
 *    Coste, dicho entero: un endpoint NUEVO con rango de fechas cuesta **dos líneas aquí**. Se acepta
 *    porque es raro y porque es exactamente el momento de preguntarse *«¿esto es una fecha o son
 *    atajos?»*. Un endpoint paginado nuevo **no cuesta nada**: `page`/`pageSize`/`q` siguen exentos
 *    por nombre.
 */
export const NO_ENUM_TRANSVERSAL: readonly string[] = [
  // Paginación y búsqueda libre (§0, línea de «filtros de lista admin»).
  'page',
  'pageSize',
  'q',
  // Identificadores.
  'setId',
  'cardId',
  'userId',
  'actorUserId',
  'locationId',
  'groupId',
  // Montos y fechas.
  'minCents',
  'maxCents',
  'minPriceCents',
  'maxPriceCents',
  'quotedTotalCents',
];

/**
 * ⭐ **La exención que es una medición DE ESA RUTA, y por eso va por `MÉTODO /ruta::param`.**
 *
 * Texto libre sobre columnas `String` del schema (medido 2026-09-13: `Card.rarity`,
 * `AuditLog.action`, `AuditLog.entityType` son `String`, no enums) y banderas booleanas
 * (`'true'`/`'1'`). ⛔ **Fijada con `toEqual` y con tope**: un `@Query('rarity')` en una ruta nueva
 * no hereda esta exención — hay que medir la ruta nueva y escribirla aquí a mano.
 */
export const NO_ENUM_POR_RUTA: readonly string[] = [
  'GET /admin/audit-log::action',
  'GET /admin/audit-log::entityType',
  'GET /admin/buylist::awaitingGuide',
  'GET /admin/buylist::live',
  'GET /admin/buylist::offerReissueAlert',
  'GET /admin/buylist/pending-shipment-confirmation::onlyAlerts',
  'GET /admin/inventory/sealed-products::principalOnly',
  'GET /admin/orders::guest',
  'GET /admin/orders::needsManual',
  'GET /buylist/cards::rarity',
  'GET /catalog/cards::gradingHighlight',
  'GET /catalog/cards::rarity',
  'POST /admin/catalog/backfill::force',
  'POST /admin/catalog/refresh-variants-all::force',
  'POST /admin/catalog/sync-all::force',

  // ⭐⭐ **`?from=` · `?to=` · `?date=` — MOVIDOS aquí desde `TRANSVERSAL` (21 sitios, medido).**
  //
  // Es una desviación deliberada de la dirección recibida, y su motivo es el criterio de la propia
  // partición: un nombre solo puede eximirse **por nombre** si su dominio es abierto **por la FORMA
  // del valor**, en cualquier ruta presente o futura. `?page=` es un número y `?q=` es texto libre —
  // eso se cumple. ⛔ **Una «fecha» no**: el caso que QA puso encima (`?date=today|yesterday|week`)
  // es un **dominio cerrado con nombre de fecha**, y es plausible precisamente porque los atajos de
  // periodo son la primera cosa que le pide un operador a un informe.
  //
  // **Y es lo que hace que `QA-M5` pase a morder.** El techo de nombres que pidió techlead impide que
  // la lista **crezca** (una palabra que absuelve globalmente), pero NO pone roja la mutación de QA:
  // `?q=` y `?date=` ya estaban dentro, así que un endpoint nuevo que los reusara seguía absuelto.
  // Con `?date=` aquí, ese endpoint sale **huérfano** por su mitad de fecha. Su `?q=` sigue exento, y
  // eso es correcto: no hay un `?q=` de dominio cerrado.
  //
  // Coste, dicho entero: un endpoint NUEVO con rango de fechas cuesta **dos líneas aquí**. Se acepta
  // porque es raro y porque es exactamente el momento en que conviene preguntarse *«¿esto es una
  // fecha o son atajos?»*. ⛔ Lo que NO se hizo —y se descartó con el argumento de techlead, no por
  // pereza— es un tope sobre el **número de sitios transversales**: ése habría que **subirlo** en cada
  // endpoint paginado nuevo, y *un tope que hay que subir para que no moleste se sube sin mirar*.
  'GET /admin/audit-log::from',
  'GET /admin/audit-log::to',
  'GET /admin/buylist::from',
  'GET /admin/buylist::to',
  'GET /admin/dashboard::from',
  'GET /admin/dashboard::to',
  'GET /admin/finance/export.csv::from',
  'GET /admin/finance/export.csv::to',
  'GET /admin/finance/iva::from',
  'GET /admin/finance/iva::to',
  'GET /admin/finance/pnl::from',
  'GET /admin/finance/pnl::to',
  'GET /admin/orders::from',
  'GET /admin/orders::to',
  'GET /admin/reports/export.csv::from',
  'GET /admin/reports/export.csv::to',
  'GET /admin/reports/launch-metrics::from',
  'GET /admin/reports/launch-metrics::to',
  'GET /admin/reports/pricing-brackets::from',
  'GET /admin/reports/pricing-brackets::to',
  'GET /admin/shipments/picking-list::date',

  // ⭐⭐ **`GET /admin/settings/iva-transfer/preview` — los DOS ejes del preview del dial de IVA**
  // (`API_CONTRACT §M10-IVA.2`, `N-IVA9-1` **RESUELTO en v1.75**).
  //
  // **Medición que los sitúa aquí y ⛔ NO en `TRANSVERSAL`:**
  //  - `ivaTransferPct` es un **ENTERO ACOTADO `[0,100]`**, ⛔ no un dominio de tokens. Su validador
  //    vive en `settings.controller.ts` (`parseRequiredIntQuery`) y **rechaza con `400` + `details.
  //    {field}`** cualquier cosa fuera del rango — ⛔ no ignora, ⛔ no clampa.
  //  - `samplePriceCents` es un **IMPORTE** en `[1, 100_000_000]`, misma clase que `minCents`/
  //    `maxCents`, que §0-Q punto 7 ya excluye. Su cota superior ⛔ no es higiene: sin ella
  //    `grossUpTotal` **lanza** y la ruta es un `500` desde la barra de direcciones.
  //
  // ⛔ **`NO_ENUM_TRANSVERSAL` NO se toca**: la exención es **de esta ruta**, no del nombre. Mañana
  // un `?ivaTransferPct=` en otro endpoint tendría que declararse de nuevo, y debe.
  'GET /admin/settings/iva-transfer/preview::ivaTransferPct',
  'GET /admin/settings/iva-transfer/preview::samplePriceCents',
];

/**
 * ⭐ **La cola de enrutamiento: ejes de dominio CERRADO medido que §0-Q NO registra.**
 *
 * Salieron **de este descubrimiento**, no de una lista que alguien recordara — que es exactamente
 * la diferencia que `C-EQ-1` existe para marcar. Cada uno lleva su medición y su dueño. ⛔ **No se
 * arreglan aquí**: la clase la decide el arquitecto (regla 9) y el código es de otros work
 * streams. Están fijados con `toEqual` ⇒ **la cola no puede crecer en silencio**.
 *
 * | Eje | Conducta medida (2026-09-13) | Por qué incumple §0-Q | Stream |
 * |---|---|---|---|
 * | `/vault/sealed?sealedSubtype=` · `?condition=` | `vault.service.ts` `if (q.x && SET.has(q.x))` ⇒ **el filtro se IGNORA EN SILENCIO** | punto 1 ⛔ «prohibido ignorar el filtro»: *el fallo se ve y la cola falsa no*. Es el defecto de `?kycStatus=` que `A5` cerró, vivo en la bóveda del CLIENTE | Inventario y vault |
 * | `/admin/vaults/:userId/sealed?sealedSubtype=` · `?condition=` | ídem (mismo servicio) | ídem | Inventario y vault |
 * | `/admin/shipments?kind=` | `shipments.service.ts` `if (kind === 'guest_direct_ship')…` ⇒ **ignora en silencio** lo desconocido | punto 1 fila 3: debería ser `400` | Órdenes y dinero |
 * | `/admin/users/:id/audit?scope=` | `admin.controller.ts` cae al default `target` ante basura ⇒ **clamp silencioso** | punto 6 ⛔ «prohibido el clamp silencioso»: devuelve una lista distinta de la pedida | Admin y auditoría |
 * | `/admin/pricing/graded-estimates/review?reason=` | `400` con `details.{field,invalid,allowed}` | **CUARTA forma de `details`**: `invalid` no es `invalidStatus` (punto 2) ni está declarada | Catálogo y precios |
 * | `/admin/finance/export.csv?report=` · `/admin/reports/export.csv?report=` | `admin.service.ts` `if(report==='pnl')…if(report==='iva')…` ⇒ **cualquier otra cosa cae a `inventory`** | punto 1 fila 3 con el signo peor: devuelve **otro informe** del pedido | Admin y auditoría |
 * | `?range=` ×4 (`/catalog/…/value-history`, `/vault/portfolio/history`) | `normalizeRange` ⇒ **clamp silencioso a `'1m'`** | punto 6 ⛔ clamp silencioso | Catálogo y precios · Inventario y vault |
 * | `?sort=` ×8 (catálogo, sellado, master-sets, bóvedas) | todos caen a su default ante basura | punto 6 ⛔ clamp silencioso; y §0-Q **no declara su dominio** (solo registra el de `bounties`) | varios |
 * | `/catalog/cards?sealedSubtype=` | sigue vivo y filtrando | **RETIRADO del contrato en v1.73** (§2 y §0-Q punto 7): su cura es **quitar el parámetro**, no arreglarlo ⇒ `D-EQ-3`, **frontend primero** | Catálogo y precios |
 */
export const SIN_CLASE_DECLARADA: readonly string[] = [
  // DINERO (`?report=` ×2, `?reason=`): 3 gates aparte, NO en este lote.
  'GET /admin/finance/export.csv::report',
  'GET /admin/pricing/graded-estimates/review::reason',
  'GET /admin/reports/export.csv::report',
  // `D-EQ-3` — frontend primero (retirar el parámetro, no arreglarlo).
  'GET /catalog/cards::sealedSubtype',
  // `?range=` de `value-history` ×3 — stream `catalog` (otro work stream; este pase no lo toca).
  'GET /catalog/featured-set/value-history::range',
  'GET /catalog/sealed/:inventoryItemId/value-history::range',
  'GET /catalog/sets/:id/value-history::range',
];

/**
 * ⭐ **`EQ-D1` (este pase) — CUATRO ejes salieron de la cola (16 → 12) al migrarse a
 * `parseEnumFilter` y ganar su fila de §0-Q punto 4:**
 *  - `GET /admin/shipments::kind` — clase R `{guest_direct_ship, vault_withdrawal}` (§M4). Antes se
 *    ignoraba en silencio; ahora fuera de dominio ⇒ `400`.
 *  - `GET /admin/users/:id/audit::scope` — clase R `{target, actor, both}` (§M6). Antes clampaba a
 *    `target`; ahora fuera de dominio ⇒ `400`.
 *  - `GET /catalog/sealed::sort` — ORDEN `{newest, price_asc, price_desc}` (§2-S). Antes clamp al
 *    default; ahora ⇒ `400`.
 *  - `GET /catalog/cards::sort` — ORDEN `{newest, price_asc, price_desc, grading_showcase}` (§2).
 *    Ídem.
 * ⭐ **`EQ-D1` LOTE 2 (este pase) — CINCO ejes MÁS salieron de la cola (12 → 7) al migrarse a
 * `parseEnumFilter`. A diferencia de lote 1, su fila de §0-Q punto 4 NO existe todavía (son MODOS de
 * la consulta, clase L/ORDEN sin enum en el schema), así que entran al `REGISTRO` como
 * `PENDIENTE-ARQUITECTO` (regla 9), igual que la bóveda de `EQ-D0`:**
 *  - `GET /admin/inventory/master-sets::sort` · `GET /admin/vaults/:userId/master-sets::sort` ·
 *    `GET /vault/master-sets::sort` — un solo dominio `{release_desc, completion_asc, pieces_desc}`
 *    (`master-set.service.ts` `sortSummaries`). Antes: clamp silencioso al default `release_desc`.
 *  - `GET /admin/vaults::sort` — dominio `{value_desc, pieces_desc, name_asc}`
 *    (`admin-vaults.service.ts` `sortRows`). Antes: clamp silencioso al default `value_desc`.
 *  - `GET /vault/portfolio/history::range` — clase L `{5d,15d,1m,3m,6m,1y,ytd,all}`
 *    (`vault.service.ts` `normalizeRange`). Antes: clamp silencioso al default `1m`.
 * Los 7 que quedan son DINERO (`?report=` ×2 finanzas; `graded-estimates/review?reason=` pricing),
 * `?sealedSubtype=` de `/catalog/cards` (retirar el param, `EQ-D3`) y `?range=` ×3 de `value-history`
 * (stream `catalog` — otro work stream).
 */

/**
 * Los `@Query()` **sin nombre** (la query entera). El escáner no puede ver sus llaves, así que el
 * hueco se cierra **diciéndolo**: cada sitio se declara con dónde vive su lista de llaves. Un
 * `@Query()` desnudo nuevo ⇒ **rojo**, porque sería un endpoint entero fuera del inventario.
 */
export const QUERY_SIN_NOMBRE: readonly string[] = [
  // `ADMIN_USERS_QUERY_KEYS` (`admin.controller.ts`): `q status kycStatus page pageSize`. Lee la
  // query ENTERA a propósito (`D-A5-3`): con params sueltos, una llave desconocida se descartaba
  // en silencio y el operador recibía el padrón entero con cara de cola filtrada.
  'GET /admin/users::<sin nombre>',
  // `RejectedItemsQueryDto`: `userId page pageSize` — los tres NO son de dominio cerrado.
  'GET /admin/buylist/rejected-items::<sin nombre>',
];

/** Las cinco fuentes de clase que absuelven a un eje. Ninguna otra cosa lo absuelve. */
export interface ListasDeClase {
  /** Exentos **por nombre**: su dominio es abierto por la FORMA del valor (`?page=` es un número). */
  readonly transversal: readonly string[];
  /** Exentos **por `MÉTODO /ruta::param`**: la exención es una medición DE ESA RUTA y no se hereda. */
  readonly porRuta: readonly string[];
  /** Las llaves del `REGISTRO` de §0-Q punto 4 (`MÉTODO /ruta::param`). */
  readonly registro: readonly string[];
  /** La cola de enrutamiento: dominio cerrado medido que §0-Q todavía no registra. */
  readonly sinClase: readonly string[];
  /** Las rutas con `@Query()` SIN NOMBRE (el escáner no puede ver sus llaves). */
  readonly sinNombre: readonly string[];
}

/**
 * ⭐ **El cruce.** Devuelve las llaves de los ejes que **ninguna** de las cinco listas absuelve.
 *
 * ⚠️ El orden de los filtros no es estético: `transversal` va **por `param`** y las otras cuatro van
 * **por `key`**. Confundir las dos es exactamente el defecto de `QA-M4`, y por eso los dos tipos de
 * lista tienen nombres distintos en la interfaz en vez de un `string[]` genérico.
 */
export function huerfanos(sites: readonly QueryAxisSite[], listas: ListasDeClase): string[] {
  return sites
    .filter(
      (s) =>
        !(s.param !== null && listas.transversal.includes(s.param)) &&
        !listas.porRuta.includes(s.key) &&
        !listas.registro.includes(s.key) &&
        !listas.sinClase.includes(s.key) &&
        !listas.sinNombre.includes(s.key),
    )
    .map((s) => s.key);
}

# «El sellado» — diseño de arreglo (⚠️ BORRADOR para revisión del dueño/orquestador)

> **⚠️ ESTO ES UN BORRADOR.** Es un documento de diseño del **arquitecto** para que el
> **dueño/orquestador** decida. **No cambia código, ni schema vivo, ni el contrato vivo.** Nada de lo
> aquí escrito está implementado por este documento; enruta trabajo a los roles dueños.
>
> **Rama:** `claude/arch-sealed`. **Medido sobre:** `origin/main` @ `bb239c09` (2026-09-16).
> **Método:** re-medido POR CONTENIDO (los file:line de notas viejas envejecieron; ver cada sección).
> **Regla O-1:** toda afirmación de estado abajo lleva su `fichero:línea` de HOY, o la marca **NO MEDIDO**.

El dueño vive tres defectos del sellado como uno. Son tres, y **su estado real hoy difiere de las notas
viejas**. Ordenados por impacto (dinero primero, luego lo visible, luego lo ya resuelto):

| # | Defecto | Estado MEDIDO hoy | Rol | ¿Toca dinero? |
|---|---|---|---|---|
| **P-83** | La llave de precio del sellado no distingue producto de producto | **Parcial**: el camino MAPEADO ya distingue por `sealed:tcg:<id>`; solo colisiona el camino LEGACY sin mapeo (`gradeKey='sealed'`) | **arquitecto → dueño** (decisión), luego backend | **SÍ (máximo)** |
| **P-79(c)** | La cola de publicación M1 pinta la «carta ancla», no el sellado | **Confirmado**: el DTO NO trae `sealedProductName`; la cola pinta `row.card.name` | **arquitecto** (contrato) + **backend** (proyección) + **frontend** (render) | **NO (display/visibilidad)** |
| **P-79(a)** | Al capturar sellado no se jala el precio de mercado | **YA RESUELTO en `origin/main`** (fix «v1.41 / IMP-1» ya mergeado) | ninguno (solo verificar) | **SÍ, pero ya correcto** |

---

## 1) P-83 — 💰 DECISIÓN DEL DUEÑO: identidad de la llave de precio del sellado

### Estado MEDIDO (hoy, `origin/main` @ `bb239c09`)

El modelo de precios del sellado usa **DOS llaves a propósito** (no se unifican; documentado en
`backend/src/modules/inventory/inventory.service.ts:787-809` y `pricing.service.ts:2389-2390`):

1. **Llave de MERCADO por producto** — `gradeKey = sealed:tcg:<tcgplayerProductId>`
   (`pricing.service.ts:1724-1731` `sealedMarketGradeKeyForItem`; se persiste en
   `persistSealedMarketReference`, `pricing.service.ts:2394-2430`). **Da identidad POR producto:** dos
   sellados distintos anclados a la misma `Card` con `tcgplayerProductId` distinto obtienen **filas
   `PriceReference` DISTINTAS**. No colisionan.
2. **Llave estructural LEGACY** — `gradeKey = 'sealed'`
   (`resolveSealedAportacionMarket`, `inventory.service.ts:1040`, `structuralGradeKey = 'sealed'`).
   Es la llave del **override manual / costo de aportación de sellado SIN mapeo**. Esta llave la
   **COMPARTEN todos** los sellados de la misma `Card` ⇒ **aquí sí colisionan**.

**El esquema `PriceReference` NO tiene `sealedProductId`** — confirmado
`backend/prisma/schema.prisma:1009-1070`; la `@@unique` es
`(cardId, productType, gradeKey, finish, capturedDate, cardProductId)` (`schema.prisma:1064`). En
cambio **`PendingPriceEntry` SÍ tiene `sealedProductId`** (`schema.prisma:1093-1094`, `@@index`
`:1108`), añadido en M-40 exactamente por este motivo (dos pendientes de sellado distintos no se
cierran entre sí).

**Re-medición que corrige la nota vieja:** la nota dice «dos sellados anclados a la misma carta
comparten fila de precio (valuar un ETB con el precio de un blíster)». Es **cierto SOLO para la llave
legacy `'sealed'`**, y ese camino se alcanza **únicamente cuando el sellado NO está mapeado**. Dos
hechos medidos acotan drásticamente el riesgo:

- **`SealedProduct.tcgplayerProductId` es `Int @unique` NOT NULL** (`schema.prisma:658`). Todo
  `SealedProduct` del catálogo está mapeado por construcción.
- **El alta P-38 exige `sealedProductId`** y DERIVA `tcgplayerProductId` del `SealedProduct`
  (`inventory.service.ts:828-856`, `deriveFromSealedProduct`). Por tanto **toda pieza dada de alta por
  el flujo vigente nace MAPEADA** y su precio (mercado O manual) se escribe bajo `sealed:tcg:<id>`
  (mercado: `pricing.service.ts:2401`; manual: `inventory.service.ts:912,936-939`; el manual sobre un
  item SIN mapear se **rechaza** con `422 MANUAL_MARKET_NOT_ALLOWED`, `inventory.service.ts:895-899`).

**⇒ Conclusión medida:** la colisión de `PriceReference` en la llave `'sealed'` está **confinada a
sellado LEGACY sin mapeo** (piezas anteriores a M-39, o el camino de aportación sin `productId` con
hermanos ambiguos, `inventory.service.ts:1056-1058`). El backend **ya lo señaló al arquitecto** como
«hueco distinto, de alcance cruzado catálogo/bóveda/admin» (`inventory.service.ts:808-809`). El flujo
de alta vigente NO produce nuevas colisiones.

**NO MEDIDO (requiere query a la BD viva, que el dueño/backend debe correr):** cuántas piezas de
inventario `productType='sealed'` tienen `tcgplayerProductId IS NULL` (o `sealedProductId IS NULL`) —
es el tamaño real del problema legacy. Sin ese número no se puede afirmar cuántas valuaciones están
hoy contaminadas. La medición que lo cierra:
`SELECT count(*) FROM "InventoryItem" WHERE "productType"='sealed' AND "tcgplayerProductId" IS NULL;`

### Lectores del precio de sellado (a tocar si se elige (A)) — MEDIDOS

Todos keyean el mercado por `sealedMarketGradeKeyForItem` (→ `sealed:tcg:<id>`), no por `'sealed'`:
`catalog.service.ts:645-648,739-740,791,812`; `catalog/sealed-catalog.service.ts:146-157`;
`catalog/set-value.service.ts:194`; `admin.service.ts:1576-1615,1641,1677`;
`orders.service.ts:286,316`; `vault.service.ts:178,373-404,477`;
`vault/admin-vaults.service.ts:105`;
`inventory.service.ts:745,914,1063,1440-1448,1599-1617`. La escritura de la llave legacy `'sealed'`
está en `inventory.service.ts:961` (override) y `:1040,1057` (escalada de aportación).

### Las dos opciones (para que decida el DUEÑO)

#### Opción (A) — dar identidad a `PriceReference` (columna `sealedProductId`)

Espejar lo que ya hizo `PendingPriceEntry` (M-40): añadir `sealedProductId String?` a
`PriceReference`, meterla en la `@@unique`, y **fallback simétrico en TODOS los lectores**.

- **Migración:** columna nullable + `@@index([sealedProductId])` + expandir `@@unique` a
  `(cardId, productType, gradeKey, finish, capturedDate, cardProductId, sealedProductId)`. Con
  `sealedProductId` NULL por defecto, **ninguna fila existente cambia de significado** (segura por
  construcción, misma doctrina que `refKind @default(market)` de M-43, `schema.prisma:1047-1048`).
- **Lectores a tocar:** los **~9 ficheros** de arriba, TODOS money-critical. Cada uno debe pasar
  `sealedProductId` de forma **simétrica** escritura/lectura.
- **Riesgo (alto):** (1) la **asimetría** escritor/lector es exactamente la clase de bug que M-40 tuvo
  que domar (`PendingPriceEntry`): un lector que consulta con NULL contra una fila escrita con id (o
  viceversa) revalúa mal o **re-crea el pendiente en bucle**. (2) **Redundancia:** para los items
  mapeados la llave `sealed:tcg:<id>` YA distingue, así que la columna solo aporta desambiguación al
  camino legacy `'sealed'` — se acaba con **dos ejes de identidad** para el mismo hecho. (3) **No cura
  el pasado solo:** las filas legacy `'sealed'` existentes quedan con `sealedProductId=NULL` y **siguen
  colisionando** hasta un backfill que **no tiene fuente de identidad** de dónde derivar el id.
- **A favor:** consistencia de patrón con `PendingPriceEntry`; identidad explícita y duradera.

#### Opción (B) — prohibir el alta de sellado sin mapeo y curar el legacy antes

- **Ya es casi verdad hoy:** `SealedProduct.tcgplayerProductId` es NOT NULL `@unique`
  (`schema.prisma:658`) y el alta exige `sealedProductId` (`inventory.service.ts:831-840`). El flujo
  vigente **ya nace mapeado** ⇒ nuevas altas no colisionan. El trabajo restante es:
  1. **Cerrar/renombrar el camino residual `'sealed'`** de `resolveSealedAportacionMarket`
     (`inventory.service.ts:1040,1057`) para que **jamás produzca una fila de precio VALUADA
     compartida**. Puede seguir siendo un **marcador PENDING compartido** (money-safe: pendiente ⇒ no
     publica, no valúa, `pricing.service.ts:1763-1777` `gateSealedMarketCents`), pero nunca un valor.
  2. **Curar el legacy:** mapear (o retirar) las piezas `productType='sealed'` con
     `tcgplayerProductId IS NULL` **antes** de apoyarse en el invariante. La curación M2 ya existe
     (`sealed-mapping.service.ts`).
- **Migración:** **ninguna** (sin cambio de schema).
- **Lectores a tocar:** **ninguno nuevo** — se conserva `sealed:tcg:<id>` como único eje de identidad.
- **Riesgo (bajo, localizado):** el trabajo es (a) una auditoría de que ningún camino de alta vivo
  escribe `'sealed'` con valor, y (b) una limpieza de datos legacy (cuyo tamaño está **NO MEDIDO**,
  ver arriba). **Límite aparente y por qué NO aplica:** «prohibir sin mapeo» NO bloquea los productos
  con precio manual — el `SealedProduct` ya no puede existir sin `tcgplayerProductId`, y el campo
  manual llena un **hueco de PRECIO**, no de **producto** (`inventory.service.ts:917-943`). Un producto
  sin equivalente TCGplayer simplemente **no puede existir como `SealedProduct` hoy** — eso es estado
  del schema vigente, no una restricción nueva de (B).

### Recomendación del arquitecto: **(B)**, con matiz

Recomiendo **(B)**. Razón medida: la identidad por producto **ya existe** vía `sealed:tcg:<id>` y **ya
cubre todo lo que el flujo vigente da de alta** (schema `:658` + alta `:831-840`). (A) añadiría un
**segundo eje de identidad redundante** para los mapeados y **tocaría ~9 lectores de dinero** con la
trampa de la asimetría (la que M-40 batalló), sin curar solo el pasado. (B) se apoya en el invariante
que el schema y el flujo **ya imponen**, no cambia schema ni contrato, y confina el riesgo a: cerrar el
residual `'sealed'` (que quede PENDING, nunca valor compartido) + una limpieza de datos legacy acotada.

**Condición que bloquea la decisión:** correr la query del conteo legacy (arriba). Si es **0**, (B) es
casi gratis (solo cerrar el residual). Si es grande, (B) exige un plan de curación —pero (A) tampoco lo
resolvería sin el mismo backfill, y encima con migración y 9 lectores de dinero de por medio.

---

## 2) P-79(c) — la cola de publicación M1 pinta la «carta ancla», no el sellado

### Estado MEDIDO (hoy)

**Confirmado.** La cola pinta `row.card.name`
(`frontend/src/app/[locale]/(admin)/admin/m1/PendingPublishQueue.tsx:138`), con línea secundaria
`setName · number · finish` (`:139-141`). **No hay rama de sellado** (`grep -c productType` sobre el
fichero = **0**). Para una pieza sellada muestra el nombre del single ancla (p. ej. «Tropius»), no
«ETB …».

**El DTO NO trae el nombre del sellado.** `PendingPublishRowDTO`
(`frontend/src/types/contract.ts:2741-2759`) tiene `productType: ProductType` (`:2745`) pero **no**
`sealedProductName`. La proyección backend tampoco lo incluye: `pendingPublish()` construye la fila en
`inventory.service.ts:1848-1864` sin `sealedProductName` (el `include` de `:1832-1838` trae solo
`card { set }`).

**Re-medición que corrige la pista:** la pista sugería que «el DTO ya podría traer `sealedProductName`».
**No lo trae** en `PendingPublishRowDTO`. Sí existe la columna fuente `InventoryItem.sealedProductName`
(`schema.prisma:871`) y **otros** DTOs de sellado ya la resuelven server-side (p. ej. `HoldingDTO`,
`contract.ts:819-826`; proyectada en `inventory.service.ts:529`). O sea: **el dato existe en la tabla y
el patrón de resolución ya está probado en la bóveda; solo falta llevarlo a la cola de publicación.**

### Arreglo propuesto

Como el dato **no llega** hoy a esta cola, es backend + frontend + un aditivo de contrato:

1. **arquitecto (contrato):** añadir a `PendingPublishRowDTO` (`contract.ts:2741`) el campo aditivo
   `sealedProductName?: string` (opcional, backend-primero/frontend-después; ausencia tolerada — misma
   doctrina que otros aditivos del DTO). El `productType` ya está.
2. **backend:** en la proyección de `pendingPublish()` (`inventory.service.ts:1848-1864`) proyectar
   `sealedProductName: item.sealedProductName` (la columna ya existe, `schema.prisma:871`; no requiere
   join nuevo — es columna de `InventoryItem`). Money-safe/display-only: no fija precio.
3. **frontend:** en `PendingPublishQueue.tsx:136-143`, rama por `productType === 'sealed'`: pintar
   `row.sealedProductName ?? row.card.name` (fallback money-safe idéntico al de la bóveda,
   `contract.ts:823`), y ajustar la línea secundaria para sellado (subtipo/condición en vez de
   `number · finish`). Sin `sealedProductName` (backend anterior) cae a `card.name` — nunca rompe.

### Rol y dinero

Va al **arquitecto** (aditivo de contrato) → **backend** (proyección) → **frontend** (render).
**⇒ NO toca dinero:** es **display/visibilidad**. No fija ni sugiere precio de venta ni de costo
(la cola es «solo visibilidad», `PendingPublishQueue.tsx:59-61`). El fallback a `card.name` mantiene la
regla «un `no sé` no se pinta como bueno» que ya gobierna la cola (`:14-22`, `:78-82`).

---

## 3) P-79(a) — al capturar sellado no se jala el precio de mercado

### Estado MEDIDO (hoy) — **YA RESUELTO en `origin/main`**

La nota vieja **envejeció**. El fix «v1.41 / IMP-1» **ya está mergeado** en `origin/main @ bb239c09`.
Medido:

- **Frontend `SealedAddFlow.tsx`:** el paso 1/2 se keyea en `effectiveMarketCents` (AUTORITATIVO, ya
  gateado por el dial), **no** en `marketRef`: `gatedMarketCents = selected?.effectiveMarketCents`
  (`:172`), `marketRef` queda como **sugerencia informativa** (`:173-175`), el campo manual y el copy
  se derivan de `gatedMarketCents` (`:180-182`), y a la aportación viaja `resolvedMarketCents`
  (`:180`, `:414`). El docblock `:166-171` lo dice explícito: «NUNCA en `marketRef` — el dead-end
  anterior».
- **`sealedPriceSource` SÍ tiene consumidores reales** (refuta la pista): el DTO de listado lo trae
  (`contract.ts:2118`), el backend lo puebla (`sealed-product.service.ts:65,224-225,252`) y el front lo
  usa para el copy del alta. Consumidores medidos con `grep -rn sealedPriceSource` en
  `frontend/src` y `backend/src`.
- **El dato SÍ llega del backend:** `sealed-product.service.ts:217-244` resuelve
  `effectiveMarketCents` por producto con la MISMA cadena H-1 que el alta
  (`getReferencesBatch` sobre `sealed:tcg:<id>` → `gateSealedMarketCents(ref, sourceOn)`), y lo mete en
  `SealedProductDTO` (`contract.ts:2093-2097`).

**Invariante verificado por medición:** `effectiveMarketCents == null ⟺ el alta acepta precio manual`
(front `:180-182`; backend `:917-943` rechaza el manual si el mercado ya está resuelto). Lo que la UI
ofrece == lo que el backend acepta.

### Arreglo propuesto

**Ninguno.** El defecto descrito por la nota ya no existe en `origin/main`. El único residuo es el de
**P-83** (sellado LEGACY sin mapeo no obtiene mercado y cae a `'sealed'`), que se decide arriba, no
aquí.

### Rol y dinero

**Rol:** ninguno (solo verificación). **⇒ Toca dinero SÍ** (el precio de mercado gatea la valuación de
la aportación), **pero el estado vigente es CORRECTO** — money-safe por construcción (sin mercado
gateado ⇒ manual auditado o PENDING, nunca 0).

---

## Decisión del dueño: P-83 (A vs B)

**La pregunta, en una línea:** ¿damos identidad de producto a la fila de precio con una **columna nueva
+ migración + 9 lectores de dinero** (A), o nos apoyamos en la identidad `sealed:tcg:<id>` que el
schema y el alta **ya imponen** y **curamos el legacy** (B)?

| | (A) columna `sealedProductId` en `PriceReference` | (B) prohibir alta sin mapeo + curar legacy |
|---|---|---|
| **Cambia schema** | Sí (columna + índice + `@@unique`) | No |
| **Migración** | Sí (nullable, segura por `@default null`; no mueve precios publicados) | No |
| **Lectores de dinero a tocar** | ~9 (catálogo, bóveda, órdenes, admin, inventario) con fallback SIMÉTRICO | 0 nuevos |
| **Cura el pasado sola** | No (filas legacy quedan NULL, siguen colisionando; backfill sin fuente de id) | Requiere limpieza de datos legacy (tamaño **NO MEDIDO**) |
| **Riesgo principal** | Asimetría escritor/lector ⇒ revaluación mala / bucle de pendiente (la clase que M-40 batalló) | Que queden piezas legacy sin curar |
| **Redundancia** | Alta: los mapeados YA se distinguen por `sealed:tcg:<id>` | Ninguna |

**Recomendación del arquitecto:** **(B)**. La identidad por producto ya existe y ya cubre todo el flujo
vigente; (A) añade un segundo eje redundante y toca dinero en 9 sitios sin resolver el pasado por sí
sola.

**Lo que el dueño debe decidir / desbloquear:**
1. **Correr la query del conteo legacy**
   (`SELECT count(*) FROM "InventoryItem" WHERE "productType"='sealed' AND "tcgplayerProductId" IS NULL;`).
   Es el único dato que falta para dimensionar (B) — y también condicionaría (A).
2. Elegir (A) o (B). Si (B): autorizar el cierre del residual `'sealed'` (que quede PENDING, nunca
   valor) y el plan de curación legacy.

---

### Anexo — trazabilidad de medición (todo `origin/main` @ `bb239c09`, 2026-09-16)

- P-83 llaves: `inventory.service.ts:787-818,895-947,1030-1070,961`; `pricing.service.ts:1724-1777,2379-2430`; `schema.prisma:654-682,858-879,1009-1070,1072-1110`.
- P-83 lectores: `catalog.service.ts`, `catalog/sealed-catalog.service.ts`, `set-value.service.ts`, `admin.service.ts`, `orders.service.ts`, `vault.service.ts`, `vault/admin-vaults.service.ts`, `inventory.service.ts` (líneas en §1).
- P-79(c): `PendingPublishQueue.tsx:136-143`; `contract.ts:2741-2759,819-826`; `inventory.service.ts:1832-1864`; `schema.prisma:871`.
- P-79(a): `SealedAddFlow.tsx:166-182,414`; `sealed-product.service.ts:217-252`; `contract.ts:2090-2118`.
- **NO MEDIDO:** conteo de sellado legacy sin mapeo en la BD viva (requiere acceso a datos de producción).

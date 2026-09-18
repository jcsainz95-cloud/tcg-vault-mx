# P53_FRESHNESS_DESIGN — Frescura efectiva (`evidenceDate ?? capturedDate`) en TODA ruta de dinero

> Propiedad: **arquitecto**. Diseño, NO código. Backend implementa **todo en UNA rama** y pasa los 3 gates.
> Base de auditoría: `origin/production` = `cd0bf02c` (estado actual, escritor pre-P-53) y la rama
> `claude/be-p53-cura3` = `b9c856bd` (write-on-change + arreglo PARCIAL de los 3 primeros sitios).
> Contrato manda sobre código (regla de conflicto). Este doc es el plano completo que el troceo por gates
> no logró cerrar: audita **cada lector de `capturedDate`** en rutas de dinero y lo clasifica.

## 1. La premisa (medida, no re-litigada — completada)

P-53 cambió el escritor de mercado a **write-on-change** (`persistMarketReference`,
`pricing.service.ts:2287`+): en un día sin cambio de valor **NO** escribe fila nueva; solo avanza
`evidenceDate` de la fila vigente (`pricing.service.ts:2319-2323`). Consecuencia medida: el `capturedDate`
de la fila primaria buena queda **CONGELADO** (viejo), mientras su `evidenceDate` = hoy.

Esto rompe la suposición «`capturedDate` = qué tan fresca es la fila» que vivía en varios lectores de
dinero. Donde un lector **rankea o filtra frescura por `capturedDate` CRUDO**, una fuente PEOR (menor
precedencia §4.27f) pero con `capturedDate` más reciente vence a la primaria buena — **inversión de
precedencia §4.27f**. El predicado correcto, ya establecido por el escritor y el camino graded, es la
**frescura efectiva**: `evidenceDate ?? capturedDate` (SQL: `COALESCE(evidenceDate, capturedDate)`).

**Invariante CA-10 (candado de todo arreglo):** con `evidenceDate = null` (filas legadas el día del
deploy, y todas las filas graded hoy), `evidenceDate ?? capturedDate` **cae a `capturedDate`** ⇒ la
selección es **IDÉNTICA a producción hoy**. El comportamiento nuevo solo emerge cuando el escritor
write-on-change empieza a avanzar `evidenceDate`. Sin schema nuevo: `evidenceDate` ya existe (M-43,
`PriceReference.evidenceDate DateTime? @db.Date`).

## 2. Tabla de sitios: FRESCURA vs IDENTIDAD/AUDITORÍA

Todos los consumidores de dinero (storefront/catálogo, checkout `orders`, `buylist`, `vault`,
`inventory`, `admin`, master-set) resuelven precio a través de los métodos de esta tabla; no hay lectores
de `capturedDate` de dinero fuera de ella (verificado: `git grep` de `capturedDate`/`orderBy`/`take:` en
`pricing`, `catalog`, `admin`, `inventory`, `vault`, `buylist`, `orders`, `set-value` sobre `b9c856bd`).

### (a) FRESCURA — mide/rankea qué fila es la vigente ⇒ debe usar `evidenceDate ?? capturedDate`

| # | Sitio (fichero:línea, `b9c856bd`) | Cómo selecciona | Estado | Por qué es frescura |
|---|---|---|---|---|
| F1 | `pricing.service.ts:~970` `getReferencesBatch` (`$queryRaw`, `max_auto_date`) | ventana por `MAX(COALESCE(evidenceDate,capturedDate)) OVER(PARTITION BY clave)` + `isBetterRef` | **YA CORREGIDO** (b9c856bd) | ventana de frescura del tier automático; sin COALESCE el fallback con `capturedDate=hoy` fijaba `max_auto_date` y excluía a la primaria congelada |
| F2 | `pricing.service.ts:~384` `isBetterRef` | compara `(a.evidenceDate ?? a.capturedDate)` vs `b` (paso 2, dentro del tier) | **YA CORREGIDO** (b9c856bd) | desempate de frescura dentro del tier automático; alimenta F1, F5, F6, F7, F8, F9 |
| F3 | `set-value.service.ts:~202` `computeSetValue` (valuación de set/bóveda) | `select` incluye `evidenceDate`; reduce con `isBetterRef`; **sin cota** | **YA CORREGIDO** (b9c856bd) | valuación agregada del set/serie; sin `evidenceDate` `isBetterRef` recibía `undefined` y volvía a rankear por `capturedDate` a secas |
| **F4** | `pricing.service.ts:~781` `getReference` | 2 queries: **bloque reciente `orderBy capturedDate desc` + `take: SAME_DAY_REF_CANDIDATES(=32)`** ⊕ manuales perennes; `pickBestRef` | **⛔ ABIERTO (ALTO-4)** | el pre-filtro del tier automático se corta por `capturedDate` CRUDO ⇒ la primaria congelada cae FUERA del top-32 antes del desempate. Es el camino de **checkout single-item** (`orders.service.ts:316`) y **buylist single-line** (`buylist.service.ts:1108`) |
| **F5** | `pricing.service.ts:~852` `getReferenceByCardProduct` (producto separado) | idéntico a F4: `orderBy capturedDate desc` + `take: 32` ⊕ manuales; `pickBestRef` | **⛔ ABIERTO (ALTO-4)** | mismo defecto de ventana sobre `cardProductId`. Camino de buylist de producto separado (`buylist.service.ts:1097`) |
| F6 | `pricing.service.ts:~1031` `getReferencesByCardProductBatch` | `orderBy capturedDate desc`, **sin cota**; reduce con `isBetterRef` | CORRECTO (hereda F2, sin cota) | frescura, pero sin `take` la primaria congelada SÍ está entre las candidatas ⇒ `isBetterRef` la elige |
| F7 | `pricing.service.ts:~1127` `getSeparateProductsByCard` | `orderBy capturedDate desc`, **sin cota**; reduce con `isBetterRef` | CORRECTO (hereda F2, sin cota) | ídem F6 |
| F8 | `admin.service.ts:~979` `ownedItemRefs` (ficha 360°, valor de inventario admin) | `orderBy capturedDate desc, createdAt desc`, **sin cota**, filas completas (incl. `evidenceDate`); reduce con `isBetterRef` | CORRECTO (hereda F2, sin cota) | ídem F6 (§0.1.c ya lo pasó a `isBetterRef`) |
| F9 | `pricing.service.ts:~1668` `getGradedEstimatesBatch` | descarta rancio con `isStaleByOrigin(...evidenceDate)` + reduce con `isBetterRef`, **sin cota** | CORRECTO (b9c856bd cableó `evidenceDate`) | frescura del estimado; hoy `evidenceDate=null` en graded ⇒ CA-10 lo hace idéntico |

**Lo ABIERTO son SOLO F4 y F5** (los dos únicos lectores de dinero que aún cortan la ventana por
`capturedDate` crudo con `take: SAME_DAY_REF_CANDIDATES`). Todo lo demás, o ya mide por
`evidenceDate ?? capturedDate` (F1–F3), o es inmune por leer sin cota y reducir con el `isBetterRef` ya
corregido (F6–F9).

### (b) IDENTIDAD DE SERIE / AUDITORÍA / DISPLAY — `capturedDate` es correcto ahí ⇒ NO TOCAR

| # | Sitio (fichero:línea, `b9c856bd`) | Qué hace `capturedDate` ahí | Por qué NO es frescura |
|---|---|---|---|
| I1 | `pricing.service.ts:~2289` `persistMarketReference` (`findFirst`, `capturedDate desc`) | escoge la CABEZA de la serie (la fila vigente que escribe/confirma) | es el **escritor write-on-change** mismo; la cabeza de la serie ES la de `capturedDate` máximo por construcción. Marcado `MONEY-REF-EXEMPT` |
| I2 | `pricing.service.ts:~2824` `priceHistory` (`capturedDate desc`) | eje de la serie histórica de auditoría (admin) | AUDITORÍA: `capturedDate` es el eje temporal; ordenar por evidencia mentiría sobre cuándo se fijó el valor |
| I3 | `sealed-catalog.service.ts:~407` serie de precios sellados (`capturedDate asc`, `byDate`) | eje temporal de la serie para graficar | serie histórica (identidad temporal), no selección de vigente |
| I4 | `set-value.service.ts` rama `asOf` / `computeSetValueSeries` (snapshot) | filtro `capturedDate <= asOf` para valor histórico | punto histórico: qué valor estaba vigente en la fecha X se ancla por `capturedDate` (cuándo se fijó el valor). Ver **nota** abajo |
| I5 | `graded-estimates.controller.ts:~494` (lee filas antes de `deleteMany`, `capturedDate desc`) | material del `before` de la bitácora (undo) | AUDITORÍA: archiva las filas tal cual para poder recapturarlas |
| I6 | `catalog.service.ts:~1789` `byCapturedDate` (orden de la cola de revisión admin) | orden determinista de la lista de diagnóstico «lo más vencido primero» | DISPLAY diagnóstico (admin); no elige qué precio se cobra. Hoy graded ⇒ `evidenceDate=null` ⇒ `capturedDate` es la evidencia real. Ver **nota** |
| I7 | `catalog.service.ts:~1671` scan de revisión (`distinct cardId`, `orderBy cardId asc`, `take`) | enumeración/paginación de cartas con estimado | enumeración por `cardId`, no rankeo de frescura |
| I8 | `card-product-resolver.service.ts:~201`; `pricing.service.ts:~2401/~2564/~2665` (upserts `capturedDate=today()`) | componente de la clave `@@unique(...,capturedDate,cardProductId)` | ESCRITURA: `capturedDate` es parte de la identidad de la fila del día |
| I9 | `prisma/schema.prisma` `@@unique` de `PriceReference` (incluye `capturedDate`) | clave de unicidad de la fila | IDENTIDAD; **NO se toca** (M-43 ya lo dejó fijo) |
| I10 | `master-set.service.ts` / `sealed-graded.service.ts` (`capturedDate` en el DTO) | DECORACIÓN: exhibe la frescura de la fila **ya elegida** por el lector | pass-through del `PriceInfo.capturedDate` que devolvió F1/F4/…; hereda la corrección del lector, no selecciona |

**Nota I4 (para backend, verificar — NO bloquea este diseño):** la rama `asOf` de `computeSetValue`
comparte el `isBetterRef` corregido (F2), que rankea por `evidenceDate ?? capturedDate`. Para un
snapshot histórico lo que estaba vigente en `asOf` se ancla por **cuándo se fijó el valor**
(`capturedDate`), no por evidencia que puede haberse confirmado DESPUÉS de `asOf`. Como el filtro es
`capturedDate <= asOf` y el job diario congela el valor exhibido (§4.1), el resultado no se mueve en la
práctica; queda **anotado para que backend lo confirme con un caso**, pero se clasifica como IDENTIDAD y
b9c856bd no lo alteró en su selección de valor congelado.

**Nota I6 (para backend, verificar):** el orden de la cola de revisión usa el `capturedDate` que reporta
`getGradedEstimatesBatch`. Hoy es correcto (graded ⇒ `evidenceDate=null`); si algún día se cablea la
evidencia del parser graded, este orden querría el `evidenceDate ?? capturedDate` reportado. No es dinero
y no bloquea; se deja anotado.

## 3. El arreglo unificado (F4 y F5) — patrón ya establecido en b9c856bd

**Principio:** un lector de dinero **jamás** debe recortar su ventana de candidatas por `capturedDate`
crudo. La ventana del tier automático se mide por **frescura efectiva** `COALESCE(evidenceDate,
capturedDate)`; el tier manual sigue perenne (§4.27f-2); el desempate final lo cierra `isBetterRef` (F2,
ya corregido). Es exactamente lo que F1 (`getReferencesBatch`) ya hace y los gates ya verificaron.

**Recomendación (primaria) — DELEGAR, para que single-item y lote NO puedan volver a divergir:**

- **F4 `getReference(cardId, productType, gradeKey, finish)`** ⇒ delegar a
  `getReferencesBatch([{cardId, productType, gradeKey, finish}])` y devolver `.get(variantKey(item))` (o
  `{ status: 'pending' }`). Misma clave, mismo `BASE_CARD_REF_WHERE` + `MONEY_REF_WHERE`, misma ventana
  COALESCE ya probada, misma FX viva (`liveMxnCents`), mismo `PriceInfo`. **Elimina el `take: 32`** (el
  vector del bug) y cierra la asimetría single↔lote — el mismo espíritu con que §0.1.b cerró la
  asimetría de los manuales.
- **F5 `getReferenceByCardProduct(cardProductInternalId, productType, gradeKey, finish)`** ⇒ delegar a
  `getReferencesByCardProductBatch([{cardProductId: cardProductInternalId, ...}])` (F6, que **ya** lee
  sin cota y reduce con `isBetterRef` ⇒ ya es durable) y devolver `.get(cardProductRefKey(item))`.
  **Elimina el `take: 32`.**

**Alternativa equivalente (si backend mide regresión de perf en el hot path single-item):** conservar los
métodos independientes pero sustituir el bloque reciente capado por el **mismo `$queryRaw` de ventana**
de `getReferencesBatch`, scoped a la clave única (partición sobre la clave; `WHERE is_manual OR
COALESCE(evidenceDate,capturedDate) = max_auto_date`), reduciendo con `pickBestRef`. Cualquiera de las
dos **quita la cota por `capturedDate` crudo**; la delegación es preferible por DRY y por imposibilitar
la divergencia futura.

**Contrato/schema:** **NO** hay cambio de forma de contrato ni de schema. Es un fix de precedencia de
LECTURA (igual naturaleza que §0.1.b): mismos DTOs (`PriceInfo`), misma `@@unique`, `evidenceDate` ya
existe. Ver §5 para una aclaración OPCIONAL, no requerida, en `docs/API_CONTRACT.md`.

**Efecto colateral a documentar:** al eliminar `take: SAME_DAY_REF_CANDIDATES` de F4/F5, la constante
`SAME_DAY_REF_CANDIDATES` y su docblock (`pricing.service.ts:~289-306`) quedan sin uso o solo citados
por F1; backend decide retirar la constante o reescribir su docblock (hoy afirma, falsamente bajo
write-on-change, que «las filas de los días más recientes son las únicas del tier automático que pueden
ganar»). Es fichero de backend; aquí solo se señala (§5).

## 4. Plan de pruebas que FALLAN (para backend)

Patrón ya establecido: `backend/test/pricing.references-batch.spec.ts` (describe «P-53 ALTO-3: frescura
efectiva en la ventana») usa el emulador `test/helpers/refs-raw-emulate.ts` (`makeRefsRawQuery`) para
reproducir la poda real y morder la inversión. Cada canario nuevo sigue ese molde.

**Canario tipo (la inversión primaria↔fallback):** primaria `tcgcsv_singles`, `capturedDate = OLD`
(p.ej. `2026-09-01`), `evidenceDate = HOY`, `priceMxnCents = 100000`; fallback de MENOR precedencia
`pokemontcg_io`, `capturedDate = HOY`, `evidenceDate = null`, `priceMxnCents = 50000`, misma clave.
Esperado CON arreglo: gana `tcgcsv_singles`/`100000`. SIN arreglo (bug): la ventana por `capturedDate`
crudo excluye a la primaria y gana `50000` ⇒ **rojo** (muerde).

**Gemelo CA-10 (candado):** las MISMAS filas pero `evidenceDate = null` en TODAS ⇒ `COALESCE =
capturedDate` ⇒ gana el fallback fresco, **idéntico a producción hoy**. El arreglo NO cambia este
resultado (prueba que el día del deploy no hay cambio de conducta).

### Canarios requeridos (mínimo)

| Canario | Sitio | Muerde | Gemelo CA-10 |
|---|---|---|---|
| C1 | **F4 `getReference`** (nuevo `pricing.getreference-p53-freshness.spec.ts`) | sí (hoy pasa el fallback) | sí |
| C2 | **F5 `getReferenceByCardProduct`** (mismo o nuevo spec) | sí | sí |

⇒ **2 canarios que muerden, cada uno con su gemelo CA-10 = 4 casos** como piso obligatorio (uno por sitio
de frescura ABIERTO). Si backend implementa por delegación, C1/C2 pueden reutilizar `makeRefsRawQuery`;
si conserva los métodos independientes, el mock debe modelar las DOS lecturas (bloque + manual) para que
la exclusión por ventana sea observable (mismo cuidado que `pricing.manual-override-durable-cross-day`).

Los sitios YA corregidos (F1, F2/F3) ya traen su canario que muerde en b9c856bd
(`pricing.references-batch.spec.ts`, `set-value.spec.ts`); no se re-crean.

### Candados de no-regresión (recomendados, no muerden hoy)

Para que un futuro `take`/cota no reintroduzca la inversión en los lectores hoy correctos por leer sin
cota (F6, F7, F8), un canario por cada uno con el mismo escenario primaria-congelada↔fallback-fresco,
asertando que gana la primaria: **3 candados** que fijan el invariante «estos lectores NO capan por
`capturedDate` crudo». Total sugerido: **4 casos obligatorios + 3 candados = 7**.

## 5. Corrección de la afirmación FALSA en `docs/BACKEND_NOTES.md §0.1.b` (para BACKEND)

`BACKEND_NOTES.md` es fichero de **backend**; el arquitecto solo señala qué corregir (regla de
propiedad). En **§0.1.b — «Capa de lectura: el override manual es candidata PERENNE»**, el punto 1 dice:

> «1. **bloque reciente CAPADO** (`take: 32`, `orderBy capturedDate desc`) — cubre el **tier automático**
> sin traer el histórico entero **(la cota sigue siendo money-safe para automáticas: solo las recientes
> pueden ganar entre sí)**;»

**La frase entre paréntesis es FALSA bajo write-on-change (P-53).** «Las recientes» está medido por
`capturedDate` crudo, y una primaria buena queda con `capturedDate` **congelado** (viejo) aunque su
`evidenceDate` sea de hoy: cae fuera del top-32 y una automática PEOR con `capturedDate` reciente la
vence — la inversión §4.27f que este diseño cierra. La cota **NO** es money-safe para automáticas hoy.

**Qué debe corregir backend en su fichero** (además del texto de §0.1.b, la misma afirmación aparece en
el docblock de `SAME_DAY_REF_CANDIDATES` en `pricing.service.ts:~289-306`: «las filas de los días más
recientes … las únicas del TIER AUTOMÁTICO que pueden ganar»):

1. Retirar/matizar la afirmación de que `take: 32` por `capturedDate` es money-safe para automáticas.
2. Anotar que F4/F5 pasaron a medir la ventana por `COALESCE(evidenceDate, capturedDate)` (o delegan a
   los métodos de lote que ya lo hacen), eliminando la cota por `capturedDate` crudo.
3. Al implementar, decidir el destino de la constante `SAME_DAY_REF_CANDIDATES` y reescribir su docblock.

## 6. Egress (O-17)

**N/A.** Este trabajo es análisis de código local (`git show`/`git grep` sobre shas) y un documento de
diseño. Ningún encargo depende de alcanzar un host externo; no hay egress que medir.

## 7. Resumen para el orquestador

- **Sitios de frescura ABIERTOS: 2** — `getReference` (F4) y `getReferenceByCardProduct` (F5), ambos por
  el `take: SAME_DAY_REF_CANDIDATES` sobre `capturedDate` crudo. Se arreglan **igual** (delegar al lote
  ya corregido, o replicar la ventana `COALESCE`). Son el camino de dinero de checkout single-item y
  buylist single-line, no un borde.
- **Sitios de frescura ya correctos: F1, F2, F3** (corregidos en b9c856bd) y **F6, F7, F8, F9** (inmunes
  por leer sin cota + `isBetterRef` corregido).
- **Sitios de identidad/auditoría/display: I1–I10** — NO tocar.
- **Schema: NO.** `evidenceDate` ya existe (M-43). **Contrato: NO** (fix de precedencia de lectura);
  aclaración OPCIONAL y trivial en `API_CONTRACT.md §4.27f` («la frescura de la selección de mercado se
  mide por `evidenceDate ?? capturedDate`»), que el arquitecto puede añadir aparte; no la requiere el fix.
- **Canarios: 4 obligatorios** (2 que muerden la inversión, 1 por F4 y 1 por F5, cada uno con su gemelo
  CA-10) **+ 3 candados de no-regresión** recomendados sobre F6/F7/F8.
- **Backend implementa TODO en UNA rama** y pasa los 3 gates (QA + techlead + seguridad). Corrige de paso
  la afirmación falsa de `BACKEND_NOTES §0.1.b` y el docblock de `SAME_DAY_REF_CANDIDATES` (§5).

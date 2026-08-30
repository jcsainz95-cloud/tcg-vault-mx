# BACKEND_NOTES.md — Marketplace TCG con Bóveda

> Propiedad: **backend**. Notas de implementación para otros roles (QA, techlead, frontend, devops).
> El contrato (`docs/API_CONTRACT.md`) manda sobre el código. Stack: NestJS + Prisma + PostgreSQL,
> Redis/BullMQ (jobs), JWT + argon2, S3/MinIO (presigned URLs), Stripe.

## 0.12 v1.50.3-g — **M-44 / M-44b: bajar la naturaleza deja de ser una operación** (cierre de SEC-M43-1) (2026-08-29)

> Implementa **ARCHITECTURE §4.38(l.4.10)** (las cinco precisiones) y **§4.38(l.4.13)** (SEC-M43-3/4/5),
> contra **`API_CONTRACT` rev v1.50.3-g**. Cierra **SEC-M43-1** (Media, reproducida en vivo por el blue
> team), **SEC-M43-3**, **SEC-M43-4** y **SEC-M43-5**, y espeja el runbook `M-45` reescrito (§0.11.6).
> **Fuera de alcance por decisión del arquitecto:** `M43-D1` (satisfacible por devops, vía (ii)) y
> `M43-D2` (`evidenceDate`, disparador «antes de la fase 2»). Siguen en `TECH_DEBT.md`.

### 0.12.1 El defecto, en una línea

M-43 prohibió que **el ingest** degradara una fila `market`; **el escritor humano tenía el hueco
abierto**. Con el slab fuera de `platform + listed` —`in_stock` pre-publicación, `reserved`, `picking`,
envío en curso **o `ownerType='customer'` en custodia**— un `intent:"graded_estimate"` caía sobre la
fila del día, **la reclasificaba y le pisaba el `priceMxnCents`**, con `200` y sin `409`. Medido:
`graded:PSA:10 = 500000 · market → 1234 · graded_estimate`; al republicar el slab,
`GET /catalog/cards/:id` devolvía `listings: []` y `GET /admin/pricing/pending` **no lo contenía**. Una
**pieza real, invisible, y ninguna cola la ve** (`reconcilePublishedPrices` es `raw`-only, M43-D1).

La regla que rige desde ahora **no tiene sujeto** (§4.38l.4.3 regla 2, ampliada):

> **La naturaleza de una fila solo se SUBE (`graded_estimate → market`), y solo por acto humano
> declarado (`intent:"market"`). BAJARLA no es una operación que ofrezca este sistema — ni automática ni
> manual.**

### 0.12.2 Qué se implementó (mapa de artefactos)

| Artefacto | Cambio |
|---|---|
| `common/error-codes.ts` | **`GRADED_ESTIMATE_WOULD_DEGRADE_MARKET_REF`** (409). |
| `pricing.service.ts` | **`applyManualOverride(input)`** — el override con el `before` y con la guarda de no-degradación **dentro de la escritura**; `manualOverride(...)` queda como envoltorio de compatibilidad que devuelve solo la fila. Tipos nuevos exportados: `ManualOverrideInput`, `ManualOverrideBefore`, `ManualOverrideResult`. |
| `pricing.controller.ts` | Usa `applyManualOverride`; audita el bloqueo de M-44 (`pricing.override.blocked`, `reason: would_degrade_market_ref`) y el **`before`** en `pricing.override`; valida `productType`/`gradeKey`/`cardId` en el borde (SEC-M43-4). |
| `pricing.types.ts` | **`isCanonicalGradeKey(productType, gradeKey)`** — la inversa de `buildGradeKey`/`sealedMarketGradeKey`. |
| `admin.service.ts` | `lastSync` del dashboard con `MONEY_REF_WHERE` (**SEC-M43-5**). |
| `pricing.service.ts`, `catalog.service.ts`, `graded-estimates.controller.ts`, `card-product-resolver.service.ts` | Marcas **`MONEY-REF-EXEMPT: <motivo>`** en los 10 lectores inclusivos (**SEC-M43-3**). |
| `test/pricing.m44-no-degrade.spec.ts` (nuevo) | 20 casos: la guarda, el TOCTOU, el `before`, la precedencia, la bitácora y los tres bordes de SEC-M43-4. |
| `test/pricing.money-ref-lock.spec.ts` (nuevo) | El **candado estructural** de SEC-M43-3. |
| `test/integration/graded-estimate-degrade-market-ref.e2e-spec.ts` (nuevo) | El PoC de SEC-M43-1 de punta a punta, incluida la **custodia de cliente**. |

### 0.12.3 La regla que hay que conocer para escribir código nuevo aquí

> **Escribir un `graded_estimate` sobre una fila `market` del día NO es un caso a manejar: es un `409`.**
> Si necesitas cambiar ese precio, `intent:"market"`. Si necesitas retirar el dato, el `DELETE` del
> gancho (que solo borra `graded_estimate`). **No existe tercera vía, y es deliberado.**

Tres cosas que conviene saber antes de tocar `applyManualOverride`:

1. **La guarda vive en la sentencia que escribe, no antes.** El `updateMany` lleva
   `refKind: { not: 'market' }` en su propio `where`, así que **no hay ventana** entre decidir y
   confirmar: si un `intent:"market"` concurrente gana la carrera, el `updateMany` devuelve `count = 0`
   y **de ahí** sale el `409`. El `if` previo es un **pre-vuelo para el mensaje** (necesita el monto
   vigente), no la guarda. Moverla al controlador reabriría el TOCTOU que (l.4.10) punto 4 prohíbe.
2. **`count = 0` + fila ausente ⇒ se CREA, no se rechaza.** La fila pudo desaparecer en la ventana (el
   `DELETE` del gancho borra estimados): ahí no hay dato de dinero que proteger y un `409` sería mentira.
3. **El alcance es LA FILA DEL DÍA, y es una decisión.** `refKind` no está en la `@@unique`, así que la
   colisión destructiva solo existe dentro del mismo `capturedDate`. **Cross-day no se prohíbe nada**:
   el estimado de hoy crea **otra** fila y la `market` de ayer sigue siendo candidata **perenne** ⇒ el
   slab conserva su precio. Ensancharlo mataría el caso legítimo (una carta que tuvo slab, se vendió, y
   hoy se quiere exhibir su estimado) y **vaciaría la vitrina en silencio**.

**Precedencia:** si se cumplen las dos condiciones (slab publicado **y** fila `market` del día) gana
**`409 GRADED_ESTIMATE_SLAB_PUBLISHED`**, porque su pre-vuelo corre antes en el controlador. Es la
preexistente, su mensaje es más útil y su `details` enumera los `inventoryItemIds`.

**Fricción aceptada y declarada** (para que nadie la «arregle» luego creyendo que endurece): quien
capture `intent:"market"` por error y quiera corregirlo a estimado **el mismo día** recibe `409` y **no
tiene escotilla**. El coste máximo es que el gancho de esa carta espere a mañana; el beneficio es que un
verbo informativo **no puede destruir un dato de dinero**.

### 0.12.4 M-44b — la bitácora ahora permite deshacer

`AuditLog action=pricing.override` registra **`before: { priceMxnCents, refKind, source } | null`**
además del `after`. `null` ⇔ la escritura **creó** la fila (estrenar la clave no es lo mismo que
corregir un número). Cubre además el residual que M-43 **no** cierra ((l.4.9) punto 1): el
`intent:"market"` mal tecleado sigue siendo posible por diseño — lo que M-44b garantiza es que se pueda
**reconstruir**. No cambia el contrato de la API (`AuditLog` es superficie interna) ni la forma del `200`.

### 0.12.5 Cambios observables para otros roles

- **Contrato (`super_admin`, BREAKING chico):** un subconjunto de llamadas que hoy responden `200` pasa a
  **`409 GRADED_ESTIMATE_WOULD_DEGRADE_MARKET_REF`**. La **forma** del `200` no cambia.
  `details: { cardId, gradeKey, currentRefKind, capturedDate }` — **sin `priceMxnCents`** (dato
  comercial; el operador lo ve en `priceHistory`). El **mensaje** sí nombra el monto vigente, formateado
  en pesos (`MX$5,000.00`), porque es lo que le dice al operador qué está a punto de pisar.
- **Frontend / ux-ui:** el estado de error nuevo necesita texto. **Recomendación (decide ux-ui):** el
  mensaje ya enruta a las dos salidas legítimas (`intent:"market"` o el borrado del gancho); si M2 ofrece
  un botón «capturar estimado» sobre una carta cuya fila del día es `market`, conviene **deshabilitarlo**
  en vez de dejar que choque — ofrecer una acción imposible es peor que no ofrecerla (mismo criterio que
  ya se aplicó al `DELETE` sobre filas `market`).
- **QA:** tres respuestas cambian en `POST /admin/pricing/override` (SEC-M43-4): `productType` fuera del
  conjunto ⇒ **`422`** (antes `500`), `cardId` inexistente ⇒ **`404`** (antes `500`), `gradeKey` no
  generable —p. ej. `graded:PSA:11`— ⇒ **`422`** (antes `200`, y **creaba una fila de dinero** para un
  grado que ninguna pieza puede llevar).
  ⚠️ **Nota de implementación, por si sorprende:** esas tres validaciones están **en el handler**, no
  como `@IsIn` en el DTO. El `ValidationPipe` global responde **400** y el contrato norma **422** para
  estos casos; manda el contrato.
- **devops:** el dashboard reporta `lastSync` **solo sobre filas `market`** (SEC-M43-5), así que una
  corrida de la fase 2 ya no puede hacer parecer fresco el feed de mercado.

### 0.12.6 SEC-M43-3 — el candado estructural (lo que hace que M-43 siga cerrado en seis meses)

El arquitecto aceptó que su frase «un lector nuevo que se olvide del predicado hereda el comportamiento
seguro» **es falsa a nivel de mecanismo**: en Prisma, omitir `refKind` del `where` **incluye** las dos
naturalezas — el default real es el **inseguro**. Lo que había era una **norma**, y una norma sin candado
se erosiona.

`test/pricing.money-ref-lock.spec.ts` la convierte en mecanismo, al estilo del candado `no-raw-entity`
que ya existía: **todo call-site de `priceReference.find*` en `src/` o contiene `MONEY_REF_WHERE` en su
propia sentencia, o lleva `MONEY-REF-EXEMPT: <motivo>` en las líneas previas.** La exención es **por
call-site, no por archivo** (`pricing.service.ts` tiene las dos clases a la vez), y el barrido incluye un
**control de no-vacuidad** para que un refactor no lo deje midiendo el vacío.

> **Si ese test se pone rojo con una query nueva, la pregunta no es «¿cómo lo callo?»** sino *¿esta
> lectura puede terminar en un monto que alguien cobre, ofrezca o valúe?* Si sí ⇒ `MONEY_REF_WHERE` por
> `AND`. Si no ⇒ la marca **con el motivo**, que es lo que se lee en la revisión.

Hoy hay **14** lectores con predicado y **9** exentos con motivo (gancho, `/review`, `priceHistory`, el
`DELETE` —cuyo `where` es **más** estricto— y las lecturas de clave-del-día de los escritores, que
**deben** ver la fila `market` para poder hacer skip en vez de pisarla).

### 0.12.7 Verificación

| Suite | Resultado |
|---|---|
| `npx tsc --noEmit` | limpio |
| `npm run lint` | 0 errores (2 warnings preexistentes, ajenos a este pase) |
| `npm test` (unitarios) | **2 510 / 2 510** en **203** suites (base 2 486 / 201; +24 tests, +2 suites) |
| `npm run test:integration` | **183 / 183** en **15** suites (base 177 / 14; +6 casos, +1 suite), **dos corridas con `npm run seed:synthetic` en medio** ⇒ el sembrado sigue siendo idempotente |

**La prueba que justifica el pase** es `test/integration/graded-estimate-degrade-market-ref.e2e-spec.ts`:
el PoC de SEC-M43-1 contra la app real y Postgres real, incluido el caso `ownerType='customer'` y la
verificación de que la pieza **sigue vendible al republicar**.

**Se verificó que la prueba DETECTA el ataque** (no es decorativa): neutralizando la guarda de M-44 —
dejando el `update` incondicional previo a v1.50.3-g— la suite se puso en rojo reproduciendo la
degradación **literal**:

```
● A) el PoC: … la fila NO se toca
    - Expected            + Received
      Object {
    -   "priceMxnCents": 500000,     +   "priceMxnCents": 1234,
    -   "refKind": "market",         +   "refKind": "graded_estimate",
      }
● A2) al REPUBLICAR, la pieza sigue vendible …   ⇒ el grupo `graded` NO existe (pieza invisible)
● B) CUSTODIA DE CLIENTE …                       ⇒ 200 en vez de 409 sobre la pieza de un tercero
```

Con la guarda restaurada, los 6 casos vuelven a verde. El candado de SEC-M43-3 se verificó igual:
quitando `MONEY_REF_WHERE` de un seam de dinero, el barrido lo **nombra con archivo y línea**.

## 0.11 v1.50.3-f — **M-43: la NATURALEZA de la fila de precio** (cierre de GE-1 / INV-D inverso) (2026-08-29)

> Implementa **ARCHITECTURE §4.38(l.4)** (dictamen completo: l.4.0 gobierno → l.4.9 residual), **§10
> (GU-8)** y **§11 `v1.50.3-f-graded-estimate-kind`**, contra **`API_CONTRACT` rev v1.50.3-f**.
> Cierra el hallazgo **ALTO GE-1** del pentester (`PENTEST_NOTES.md` § «PASE FEATURE»), que era
> **BLOQUEANTE del encendido** del gancho de grading. **Vía A** (la del dictamen); la **vía B** de
> §4.38(l.5) —gatear la creación de estimados con el dial `off`— **NO se implementó** y ya no hace
> falta: `409 GRADED_ESTIMATE_DISABLED` **no existe** en el código.

### 0.11.1 El defecto, en una línea, y por qué las guardas de v1.50.2 no lo tocaban

La fila del «valor estimado si se gradea» y la referencia de mercado real de un slab PSA publicado son
**LA MISMA FILA** (`cardId` + `graded` + `graded:PSA:N` + `finish='normal'` + `cardProductId=null`). El
`422`/`409` cubre *capturar un estimado sobre una carta que YA tiene slab*. **La dirección inversa no
tenía guarda**: capturar el estimado primero (permitido — no hay slab) y publicar el slab después.
Medido en vivo por el pentester: un slab PSA 10 que con referencia correcta lista a **MX$9,200** quedó
publicado a **MX$460** (5 % de su valor), y con el estimado **rancio a −400 días siguió** a MX$460.

Lo que hasta hoy decidía si esa fila era dinero era **el LECTOR**, por inferencia sobre el estado del
mundo (*¿hay slab publicado?*). Por eso el mismo dato significaba dos cosas distintas en dos instantes
distintos **sin que nada cambiara en la fila**. M-43 mueve esa decisión al **ESCRITOR** —el único que
conoce la intención— y la **congela en el dato**.

⛔ **Derogado, y conviene que quede escrito porque es la lección reusable:** la recomendación previa
(§4.38l.3, §10 GU-8) era meter `graded_estimate` en `PriceSource` con `sourceRank` bajo. **No habría
cerrado nada.** `sourceRank` vive dentro de `isBetterRef`, que es un **desempate entre candidatas**, y
la clave del estimado tiene casi siempre **UNA sola fila** (no existe escritor automático de mercado
`graded`): con una sola candidata gana con **cualquier** rango. *Ordenar no es excluir. Un control que
solo actúa en el desempate no protege el caso de candidata única, que es justo el caso degradado.*
`PriceSource` **no cambió**.

### 0.11.2 Qué se implementó (mapa de artefactos)

| Artefacto | Cambio |
|---|---|
| `prisma/schema.prisma` | `enum PriceRefKind { market, graded_estimate }`; `PriceReference.refKind PriceRefKind @default(market)`; `PriceReference.evidenceDate DateTime? @db.Date`; `@@index([refKind])`. **La `@@unique` NO se tocó.** |
| `prisma/migrations/20260829120000_m43_graded_estimate_kind/` | El DDL. Aditivo puro: 1 enum + 2 columnas + 1 índice, **sin `DROP`, sin backfill, sin `UPDATE` de dinero**. |
| `pricing.service.ts` | **`MONEY_REF_WHERE = { refKind: 'market' }`** (exportado) aplicado a todos los seams de dinero; `PRICE_REF_SELECT` gana `refKind`; `manualOverride` gana el 8.º parámetro `refKind`; `syncCardPrice`, `persistMarketReference`, `persistGradedEstimateReference`, `persistSealedMarketReference` fijan la naturaleza; `PriceHistoryEntryDTO`/`toPriceHistoryEntry` ganan `refKind`. |
| `pricing.controller.ts` | `intent` ⇒ `refKind` (`"graded_estimate"` ⇒ estimado; **todo lo demás** ⇒ `market`). |
| `graded-estimates.controller.ts` | El `DELETE` acota su `where` a `refKind='graded_estimate'`; el `404` explica el caso `market`; el `before` de la bitácora registra la naturaleza de cada fila borrada. |
| `catalog.service.ts` | `GradedEstimateReviewItemDTO.refKind` + emisión en `preview` y `review`. |
| `common/graded-estimate.ts` | `GradedEstimateInput.refKind` y `GradingHighlightResult.refKind` (la misma fila que reportan `capturedDate`/`isManual`). |
| `set-value.service.ts`, `sealed-catalog.service.ts`, `admin.service.ts`, `card-product-resolver.service.ts`, `price-ingest.service.ts` | Predicado de dinero / naturaleza explícita en su escritor. |
| `prisma/seed-e2e.ts` | Los estimados de `e2e-stale-est` se siembran `graded_estimate`; **las filas `graded:PSA:10` de `e2e-graded` y `e2e-slab-raw` se quedan `market`** — son el precio de sus slabs publicados, y sembrarlas como estimado las apagaría. |

### 0.11.3 La regla que hay que conocer para escribir código nuevo aquí

> **El default de TODA lectura de `PriceReference` es EXCLUIR lo que no es `market`. Incluir las dos
> naturalezas es opt-in explícito.**

Un lector nuevo que se olvide del predicado **hereda el comportamiento seguro** — exactamente lo
contrario de lo que pasaba antes. Las **únicas cuatro** lecturas inclusivas, y por qué:

| Lectura inclusiva | Por qué |
|---|---|
| `getGradedEstimatesBatch` (ficha, rejilla, vitrina, `preview`, `review`) | Ruta del **gancho**, no del dinero. Las filas `market` de cartas **sin** slab son la mejor estimación disponible de lo que valdría esa carta gradeada y son las que hacen que la vitrina tenga algo que mostrar el día 1; filtrarlas la **vaciaría en silencio**. La seguridad de esta ruta la dan la omisión por slab publicado (§4.38l.2, intacta) y el gate de confianza. |
| El conjunto motor de `/review` (`catalog.service`) | Debe poder listar la coexistencia; el `refKind` por fila es lo que evita que el operador borre dinero. |
| El `findMany` del `DELETE` | Lee la clave completa… pero **borra** solo `graded_estimate` (ver 0.11.5). |
| `priceHistory` | Superficie de **auditoría**: `refKind` es justamente el dato que explica **por qué una fila con número no está priciando nada**. |

La regla general detrás de la asimetría, porque se va a volver a necesitar: **en la dirección del DINERO
se falla cerrando** (mejor sin precio que con precio malo); **en la dirección de la EXHIBICIÓN se falla
informando** (mejor mostrar el dato que tenerlo y callar).

Seams de dinero cubiertos: `getReference` (**las dos** queries), `getReferenceByCardProduct` (**las
dos**), `getReferencesBatch`, `getPricedRawFinishesBatch`, `getSeparateProductsByCard`, el cache diario
de `syncCardPrice`, `set-value.service` (valuación de set), `sealed-catalog.service` (serie de valor del
sellado), `admin.service` (reporte de dinero de admin) y `price-ingest.hasRecentIngest`. Bóveda, binder,
buylist, checkout y `bulk-publish` entran por `getReference`/`getReferencesBatch`, así que quedan
cubiertos sin tocarlos. **`isBetterRef` / `sourceRank` / §4.27f-2 / la curva (§4.36) no se tocaron**: se
filtra **aguas arriba**, sobre las candidatas, nunca dentro del comparador ni de la matemática.

⚠️ **La query que es fácil olvidar y que es LA importante:** el estimado se escribe siempre por la vía
manual (`isManualOverride=true`), así que la que lo traía al resolver es la lectura de **candidatas
PERENNES** (`MANUAL_REF_PREDICATE`, **sin cota de fecha**) — por eso el estimado a −400 días seguía
priciando. `MONEY_REF_WHERE` va en **las dos** queries de `getReference` y de
`getReferenceByCardProduct`; hay un test que lo comprueba estructuralmente.

### 0.11.4 ⚠️ El trampolín: `refKind` en el `update`, no solo en el `create`

`refKind` **no entra a la `@@unique`**, así que para carta+grado+día sigue habiendo **una sola fila**: un
`intent:"market"` que caiga sobre la fila-estimado del mismo día **reusa esa fila**. Si el `update` del
escritor omitiera `refKind`, la fila seguiría clasificada como estimado y **el slab se quedaría sin
precio aunque el operador acabara de afirmarlo** — fallo silencioso en dirección segura, pero fallo, y
además **rompería el paso 3 del cut-over**. Todos los escritores fijan la naturaleza en `create` **y**
en `update`, y hay dos tests dedicados (uno unitario, uno E2E contra la tabla real).

Corolario de escritura (§4.38l.4.3 regla 2): **el ingest NUNCA degrada una fila `market`.** Si la fila
del día ya es de mercado, `persistGradedEstimateReference` hace **skip + traza** (`warn` con carta y
grado; el job lo cuenta en `skippedManual`, que pasa a significar «saltadas por respetar lo que ya
había»). *La naturaleza solo la SUBE un humano con `intent:"market"`; la automática nunca la baja.*
El mismo criterio se aplicó al cache diario de `syncCardPrice`: si la fila del día es un estimado, ni la
sirve como precio ni la pisa — devuelve `pending` y escala a la cola.

### 0.11.5 Cambios observables para otros roles

- **Frontend:** ninguna superficie **pública** cambia de shape. Dos campos **aditivos** y **admin-only**:
  `PriceHistoryEntryDTO.refKind` y `GradedEstimatePreviewDTO.refKind` (también en
  `GradedEstimateReviewItemDTO`). **Recomendación (decide ux-ui/frontend, no backend):** en la lista de
  revisión de M2, una fila `refKind:"market"` **no debe ofrecer el botón de borrar** — el `DELETE` le
  responderá `404`, y ofrecer una acción imposible es peor que no ofrecerla.
- **`DELETE /admin/pricing/graded-estimates/:cardId/:gradeValue`** borra **solo** las filas
  `graded_estimate`. Si la clave solo tenía filas `market` ⇒ **`404`** (aunque la clave no esté vacía).
  El `409 GRADED_ESTIMATE_SLAB_PUBLISHED` corre antes y **no cambió**.
- **QA / M2:** el día del cut-over, cada slab que se estuviera priciando desde un estimado pasa a
  `no_market`. Si se re-afirman antes (paso 3), el conteo **no se mueve**. Si no, el encabezado de la
  cola puede mostrar un salto de `no_market` que **NO** es degradación del feed: el diagnóstico de §M2
  («suben los dos a la vez ⇒ feed degradado») **no aplica** a ese salto.
- **Efecto fail-closed, declarado:** un slab cuya única fila sea un estimado deja de ser vendible —
  `fetchSellable` lo descarta, así que **desaparece del storefront** y `GET /catalog/listings/:id`
  responde `404`. Es deliberado: una pieza sin precio no le cuesta dinero a nadie; una al 5 % sí.

### 0.11.6 CUT-OVER (§4.38l.4.7) — **REESCRITO en v1.50.3-g (`M-45`)**, obligatorio y EN ESTE ORDEN, para devops

> ⛔ **DEROGADA la versión anterior de este apartado, y su defecto valía el aviso**: su **paso 4** traía
> un `UPDATE` masivo de clasificación, listo para copiar y pegar, para el caso «el paso 1 no dio cero»…
> que es exactamente el caso en el que el **paso 1 manda PARARSE**. Un runbook que se contradice en la
> rama que corre cuando el mundo no es el esperado no es un runbook, y ésa es la rama en la que un
> `UPDATE` sobre la tabla de dinero es más peligroso. Además su predicado era el equivocado: copiaba el
> de `publishedSlabsForGradeKey` (`platform` + `listed`), que responde *«¿hay ahora una publicación viva
> que dependa de esta fila?»* —pregunta de **guarda**— y no *«¿qué quiso afirmar el humano que la
> escribió?»*, que es lo que un **backfill de naturaleza** necesita. En una BD real habría marcado como
> estimado la referencia de mercado de todo slab no listado **en ese segundo**: `in_stock` a punto de
> publicarse, `reserved`, `picking`, envío en curso **y los `ownerType='customer'` en custodia**.
> Escalado por `SECURITY_NOTES.md` §2(b) / **SEC-M43-2**; dictamen en ARCHITECTURE §4.38(l.4.7),
> (l.4.7-bis) y (l.4.11). **Este apartado es el espejo de aquél; si divergen, manda ARCHITECTURE.**

**Los pasos 0–3 corren ANTES de aplicar la migración** y no referencian `refKind` (son ejecutables
pre-DDL).

**Paso 0 — CONGELAR la publicación de slabs `graded`**, desde el censo (paso 1) hasta la verificación
(paso 5). El censo es una **foto**, y entre ella y el deploy sigue corriendo el código **viejo**, donde
publicar un slab sobre una carta con estimado es una operación normal y silenciosa: toda pieza que entre
a `listed` en esa ventana **no fue re-afirmada y se apaga al desplegar**. La ventana son minutos;
congelarla es más barato que perseguirla. **La congelación es PROCEDIMENTAL** (aviso al operador +
ventana de mantenimiento), **no un dial nuevo**: no se construye mecanismo para un evento único.
**Dueño: devops.**

**Paso 1 — CONTAR (solo lectura), en cada entorno que venda.** Expectativa declarada en producción:
**cero** (la vía `intent` vive en esta rama y nunca se desplegó).

```sql
-- 1a) censo de filas candidatas a ser estimados del gancho
SELECT count(*) AS filas_psa, count(DISTINCT "cardId") AS cartas
FROM "PriceReference"
WHERE "productType"='graded' AND "gradeKey" LIKE 'graded:PSA:%' AND "cardProductId" IS NULL;

-- 1b) de ésas, las que COEXISTEN con un slab PUBLICADO de ESE grado = las expuestas a GE-1 hoy
--     y las que el paso 3 obliga a re-afirmar. Misma definición de «publicado» que
--     `publishedSlabsForGradeKey`: plataforma + listed + PSA + mismo gradeValue.
SELECT r."cardId", c."externalId", r."gradeKey", r."priceMxnCents", r."capturedDate"
FROM "PriceReference" r
JOIN "Card" c ON c.id = r."cardId"
WHERE r."productType"='graded' AND r."gradeKey" LIKE 'graded:PSA:%' AND r."cardProductId" IS NULL
  AND EXISTS (
    SELECT 1 FROM "InventoryItem" i
    WHERE i."cardId" = r."cardId" AND i."productType"='graded'
      AND i."ownerType"='platform' AND i.status='listed'
      AND i."gradingCompany"='PSA' AND ('graded:PSA:' || i."gradeValue") = r."gradeKey"
  )
ORDER BY c."externalId";
```

> ⛔ **Si 1a NO da cero: SE PARA Y SE ESCALA AL ARQUITECTO. No hay rama alternativa en este runbook.**
> Un censo no-cero **falsifica la premisa** sobre la que está construido todo el procedimiento (existe
> una vía de escritura que este diseño no conoce), y derivar de una premisa recién falsificada un
> `UPDATE` masivo sobre la tabla de dinero es exactamente al revés. La regla con la que el arquitecto
> emitirá el dictamen de clasificación está escrita por adelantado en **§4.38(l.4.7-bis)** —y su
> discriminante **no** es «¿está listado?» sino **«¿existe la pieza física?»** (cualquier `status`,
> cualquier `ownerType`)—, pero **hasta que ese dictamen exista para la lista concreta, el cut-over no
> continúa**.

**Paso 2 — ENUMERAR por la API** (la lista que el operador mira, y la que ya trae `refKind` por fila).
Funciona con el dial `off`:

```bash
curl -s -H "Authorization: Bearer $SUPER_ADMIN" \
  "$API/admin/pricing/graded-estimates/review?reason=SLAB_PUBLISHED&pageSize=200"
```

**Paso 3 — RE-AFIRMAR cada slab de esa lista con `intent:"market"`, ANTES de migrar.** Es un acto de
dinero deliberado y auditado (`AuditLog action=pricing.override`, y desde **M-44b** con `before`), que
es exactamente lo que el hallazgo pide que sustituya a la herencia silenciosa. Tras este paso, **la
migración no puede apagar ninguna pieza**:

```bash
curl -s -X POST -H "Authorization: Bearer $SUPER_ADMIN" -H 'Content-Type: application/json' \
  -d '{"cardId":"<id>","productType":"graded","gradeKey":"graded:PSA:10",
       "priceMxnCents":<precio REAL del slab>,"intent":"market"}' \
  "$API/admin/pricing/override"
```

**Paso 3-bis — RE-CORRER el censo 1b como GATE, inmediatamente antes del deploy.** Es la verificación de
que el paso 0 aguantó. **Si devuelve una sola fila que no esté en la lista re-afirmada del paso 3, el
cut-over SE DETIENE** y se vuelve al paso 2. *(Con la congelación esto debe dar vacío siempre; su valor
es detectar que la congelación no se respetó, no sustituirla.)*

**Paso 4 — MIGRAR:** `npx prisma migrate deploy` (aplica `20260829120000_m43_graded_estimate_kind`).
**Backfill: NINGUNO.** Y no es «innecesario si el paso 1 dio cero»: **el único mundo en el que este paso
4 se ejecuta es aquel en el que el paso 1 dio cero**, y en ese mundo no hay nada que clasificar. **El
`UPDATE` de clasificación queda ⛔ DEROGADO y no figura aquí ni como ejemplo** — un `UPDATE` masivo sobre
la tabla de dinero, listo para copiar y pegar, dentro de un procedimiento cuyo paso 1 dice «párate», *se
acaba ejecutando*. El único que puede existir es el que emita el dictamen de (l.4.7-bis), escrito para la
lista concreta y con visto bueno **explícito** del arquitecto.

**Paso 5 — VERIFICAR con los DOS checks, el positivo y el negativo.** El positivo solo no basta: es una
comprobación **sobre la lista que ya conocíamos**, ciega a todo lo que no estaba en ella.

- **(+)** los slabs re-afirmados conservan su precio (`GET /catalog/cards/:id` ⇒ grupo `graded` con
  `priceBasis:"market"`), y una carta con estimado y **sin** slab sigue mostrando su gancho.
- **(−) el que cierra el hueco:** **cero** `InventoryItem` `productType='graded'` en `status='listed'`
  —**cualquier `ownerType`**— cuyo precio resuelva con `priceBasis != 'market'`. Un solo resultado ⇒ hay
  una pieza apagada en silencio ⇒ **se re-afirma antes de dar por bueno el cut-over.**
  **Este mismo predicado es el detector recurrente de (l.4.12)(ii): se escribe una vez y se usa dos.**

  Enumeración barata en la BD (**solo lectura**) del caso que importa —la pieza publicada **sin ninguna**
  referencia de mercado en su clave, que es la que resuelve `pending` y desaparece del storefront—:

  ```sql
  -- Debe devolver CERO filas. Cualquiera que salga es una pieza publicada y sin precio.
  SELECT i.folio, i."ownerType", i.status, c."externalId", i."gradingCompany", i."gradeValue"
  FROM "InventoryItem" i
  JOIN "Card" c ON c.id = i."cardId"
  WHERE i."productType"='graded' AND i.status='listed'
    AND NOT EXISTS (
      SELECT 1 FROM "PriceReference" r
      WHERE r."cardId" = i."cardId" AND r."productType"='graded'
        AND r."gradeKey" = ('graded:' || i."gradingCompany" || ':' || i."gradeValue")
        AND r.finish = i.finish
        AND r."refKind" = 'market'   -- SIN cota de fecha: el override manual es candidata PERENNE
    );
  ```

  ⚠️ **Qué NO ve esta consulta, dicho para que nadie la tome por el check entero:** `priceBasis` lo
  calcula la app (`'market' | 'floor' | 'override' | 'bounty' | 'pending'`), no el SQL. Esta enumeración
  cubre el caso **silencioso** (`pending` por falta de referencia de mercado), que es el que introduce
  M-43; una pieza con `listPriceCents` resuelve `override` y **está preciada a propósito**. El check
  normativo sigue siendo el de la app: si el SQL da cero y aun así una pieza aparece con
  `priceBasis != 'market'`, **se escala, no se re-afirma a ciegas**.

**Paso 6 — ROLLBACK (§4.38l.4.11): revertir el código NO es suficiente, y hay que elegir el escenario.**
«Revertir basta; la columna se queda» es cierto **para el DDL** y **falso para el riesgo**: en el momento
del rollback ya existen filas `refKind='graded_estimate'` escritas por la vía manual, y esas filas llevan
`isManualOverride=true` / `source='manual'` ⇒ al quitar el predicado vuelven a ser candidatas
**perennes** (`MANUAL_REF_PREDICATE`, sin cota de fecha) ⇒ **rollback = GE-1 restaurado, con la munición
ya cargada y sin caducidad.**

- **(A) URGENCIA (algo va mal y hay que apagarlo YA): la palanca es el DIAL, no el `git revert`.**
  `gradedEstimatesEnabled = off` detiene la exhibición —y, bajo (l.5), la **creación** de estimados—, es
  instantáneo, reversible y **deja M-43/M-44 en pie**, o sea que el predicado de exclusión sigue
  protegiendo el dinero. **Revertir el código en caliente es la peor opción en casi cualquier incidente
  imaginable**, porque quita la protección justo cuando el sistema **ya tiene filas de estimado
  escritas**. Se declara aquí para que en el incidente no haya que decidirlo.
- **(B) RETIRADA ORDENADA (decisión de producto, con tiempo): precondición de CERO.**
  1. `gradedEstimatesEnabled = off` (que no entren más mientras se limpia).
  2. Por cada fila `refKind='graded_estimate'`: **sin pieza física** de esa compañía+grado (cualquier
     `status`, cualquier `ownerType`) ⇒ `DELETE /admin/pricing/graded-estimates/:cardId/:gradeValue`
     (borra **exactamente** esa naturaleza, §4.38l.4.5). **Con pieza física** ⇒
     `POST /admin/pricing/override` con `intent:"market"` al precio real (acto de dinero, auditado).
     *Es el mismo par de gestos del paso 3 y de (l.4.7-bis): un solo criterio para todo el runbook.*
  3. **Verificar `SELECT count(*) FROM "PriceReference" WHERE "refKind"='graded_estimate'` = 0.** Es
     **precondición dura del revert**, no una recomendación.
  4. Recién entonces, revertir el código. **La columna se queda** (aditiva e inerte sin lector). **No se
     quita la columna en caliente.**

### 0.11.7 Lo que M-43 **NO** cierra (residual declarado)

1. **Un `intent:"market"` mal tecleado sigue moviendo el precio de un slab.** Riesgo inherente de
   cualquier override de dinero; su remedio es la auditoría y la revisión, no esta columna. Lo que M-43
   garantiza es que **una cifra que nadie afirmó como precio de venta jamás se convierta en uno**.
2. **`reconcilePublishedPrices` sigue siendo `raw`-only** ⇒ un slab que se quede sin referencia no entra
   a `PendingPriceEntry`. Con el cut-over no puede pasar al migrar, pero sí después. ~~**Deuda no
   bloqueante, dueño backend**~~ ⚠️ **RECLASIFICADO en v1.50.3-g (§4.38l.4.12):** sigue sin bloquear la
   fusión, pero pasa a ser **precondición del cut-over de producción**, y se satisface por la vía **(ii)**
   —detector recurrente con alerta sobre el predicado del paso 5(−), **dueño devops**— o por la **(i)**
   —extender el barrido a `graded`, dueño backend—. **M-44 no lo implementa: fuera de alcance por
   decisión del arquitecto.** Anotado en `TECH_DEBT.md` (M43-D1).
3. **`evidenceDate` entró como COLUMNA pero NO se cableó.** Ni escritor (el ingest sigue sin
   persistirla) ni lector (`stale()` sigue midiendo contra `capturedDate`). Con la columna en `null` en
   toda fila, `evidenceDate ?? capturedDate` sería idéntico a hoy, así que **no hay cambio de
   comportamiento y no hay regresión**: la aproximación conservadora vigente —el gate de evidencia en la
   **escritura** del ingest, cota `≤ 2 × freshnessDays`— sigue siendo la que cumple el criterio 109, y
   sigue declarada como desviación en §9. El alcance que el arquitecto asignó a M-43 pide **la columna**;
   el cierre exacto del criterio 109 **no estaba en él** y **no se hizo por cuenta propia**. Anotado en
   `TECH_DEBT.md` y pendiente de que arquitecto/orquestador lo enruten.

### 0.11.8 Higiene de la BD de integración (hallazgo del pase, para devops/QA)

Correr la suite de integración falló al principio en el caso 6 del gancho con unos escalones de coste
que **no venían de este pase**: `ConfigSetting['grading_cost_tiers']` tenía 2 escalones en vez de 6,
residuo de la sesión del pentester. **`npm run seed:synthetic` NO lo arregla**, porque el seed hace
`upsert` con `update: {}` (deuda ya declarada en §11.0) ⇒ **una config editada sobrevive al resembrado**.
Se hicieron dos cosas: (a) restaurar el valor al del seed en la BD local, y (b) que el `afterAll` de
`graded-estimate.e2e-spec.ts` **restaure también `gradingCostTiers`**, que es lo único que cierra ese
modo de fallo desde la suite. Si una corrida de integración falla con números de gate inexplicables, **lo
primero que hay que mirar es si alguna `ConfigSetting` quedó editada**: el resembrado no la va a salvar.

### 0.11.9 Verificación

| Suite | Resultado |
|---|---|
| `npx tsc --noEmit` | limpio |
| `npm test` (unitarios) | **2 486 / 2 486** en **201** suites (base 2 469 / 200; +17 tests, +1 suite) |
| `npm run test:integration` | **177 / 177** en **14** suites (base 171 / 13; +6 casos, +1 suite), **dos corridas con `npm run seed:synthetic` en medio** ⇒ el sembrado sigue siendo idempotente |

**La prueba que justifica el pase** es `test/integration/graded-estimate-inv-d-inverse.e2e-spec.ts`: el
PoC de GE-1 paso por paso contra la app real. Se **verificó que detecta el ataque** neutralizando
temporalmente `MONEY_REF_WHERE` (`{}`), con lo que la ficha volvió a emitir exactamente la medición del
pentester —`salePriceCents: 46000`, `priceBasis:"market"`, `sellable:true`, y lo mismo con el estimado a
`capturedDate: 2025-07-25`— y los casos (A) y (B) fallaron. Con el predicado puesto, el slab queda
`pending`, desaparece del storefront y la ruta por-pieza responde `404`.

## 0.10 v1.50.3-e — `reasons[]`: el DIAGNÓSTICO deja de heredar el cortocircuito de la DECISIÓN (2026-08-29)

> Implementa **ARCHITECTURE §4.38(i) ítems 9 y 10** / **§4.38(c)** / **§4.38(n.2-ter)**, contra
> `API_CONTRACT` §M2 (addendum v1.50.3-e). **Aditivo y admin-only: cero DTO públicos tocados, cero
> migraciones, cero queries nuevas, cero cambios de precio.** `eligible` **no puede** cambiar por
> construcción (ver 0.10.2).

### 0.10.1 El defecto, y por qué el arreglo NO fue reordenar pasos

Medido por frontend contra el stack vivo sobre `e2e-third-raw` (venta raw **MX$460**):

```
PSA 10 = MX$230, sin PSA 9   →  review: total = 0        ← invisible
+ PSA 9 = MX$150             →  review: NOT_ABOVE_RAW    ← aparece
```

`evaluateGradingHighlight` corta en el paso 5 (`NO_PSA9`) y la cota de magnitud del paso 6c **nunca se
comprueba**. El código era **fiel al algoritmo**: el defecto estaba en usar una salida de **decisión**
(`reason` = «primer bloqueante para PROMOCIONAR») como si fuera una de **diagnóstico** («qué le pasa a
esta carta»), que **no cabe en un escalar**.

Mover el 6c delante del 5 lo habría tapado. No se hizo, y la razón es que **es la segunda vez en el
mismo pase**: `STALE` inalcanzable (PI-D6, §4.38n.2-bis) fue exactamente la misma clase de error. Se
ataca la causa: **la pura emite la lista completa**.

### 0.10.2 Qué cambió en la pura (`src/common/graded-estimate.ts`)

`GradingHighlightResult` gana **`reasons: HighlightReason[]`** con **todas** las condiciones que fallan,
en **orden canónico** (los pasos 1→8 del algoritmo, que **no se reordenan**).

- **`reason` se conserva sin cambio** = `reasons[0]` = primer bloqueante.
- **`eligible ⟺ reasons.length === 0`**, y ahora **se deriva de ahí** en vez de ser un camino aparte: era
  ya la conjunción de los mismos pasos, y una conjunción no depende del orden de evaluación. **Money-neutral
  por construcción**; lo único que el orden decidía era *qué motivo se reporta*, nunca *qué se promociona*.
- **Regla de aplicabilidad:** una condición cuyos **insumos no existen** no se evalúa y **no se lista**
  (`GRADE_ORDER_INVERTED` sin PSA 9; las dos cotas contra el raw sin precio de venta publicado). ⚠️ La
  **ausencia** de un `reason` significa **«no se pudo comprobar»**, no «pasó esa prueba».
- **La cota de ORDEN de grados quedó FUERA del bloque que exige precio de venta**: sus únicos insumos son
  los dos grados. Con el precio ausente, `NOT_PUBLISHED` no debe tapar unas filas capturadas cruzadas.
- **Los montos derivados del escalón siguen intactos**: si algo bloqueó antes del paso 7, `gradingCostTier`,
  `gradingCostMxnCents`, `thresholdMxnCents` y `netUpsidePsa9MxnCents` siguen siendo `null` **exactamente
  como antes** (el paso 6c va antes del 7 a propósito: un PSA 10 en unidades equivocadas no debe resolver
  escalón). Diagnosticar de más no relaja eso, y money-safe sigue siendo `null`, jamás `0`.
- **Coste: ninguna query nueva.** Son comparaciones enteras sobre datos que ya estaban en memoria.

**Nota para quien lea `reasons` en el `preview`:** `NO_COST_TIER` y `BELOW_MIN_UPSIDE` **sí** aparecen
aunque una cota de magnitud haya fallado antes, porque sus insumos existen y la regla es mecánica. No
ensucian la lista de revisión (no son enumerables ahí) y meter un «solo si el número es coherente»
reintroduciría, en pequeño, el cortocircuito que este cambio quita.

### 0.10.3 Qué cambió en las superficies de admin (`catalog.service.ts`)

- **`GradedEstimatePreviewDTO` y `GradedEstimateReviewItemDTO` ganan `reasons: HighlightReason[]`**
  (contrato §M2). `reason` sigue siendo el primer bloqueante, tal como el contrato lo declara.
- **El filtro de `/review` se evalúa sobre `reasons`**: una fila entra si `reasons ∩ {reasons pedidos} ≠ ∅`.
- **El ORDEN primario es el `reason` MATCHEADO** —el primero de `reasons` que está en el conjunto pedido—,
  **no `reasons[0]`**: para la carta de un solo grado, `reasons[0]` es `NO_PSA9`, un motivo que el operador
  no pidió y que no explica su presencia en la lista. Ordenar por él barajaría la lista por un criterio
  invisible desde la respuesta. El resto del orden (`capturedDate` asc con `null` al final → `cardId` →
  representante) no cambia.

**⚠️ Consecuencia observable para QA/frontend, y es la correcta:** el conjunto de
`?reason=SLAB_PUBLISHED` **crece**. Una carta con slab PSA 10 publicado y su fila `graded:PSA:10` ahora
aparece **aunque no tenga PSA 9**; antes desaparecía por el cortocircuito `NO_PSA9`, no porque la
exposición hubiera terminado. La fila sigue siendo indistinguible de un estimado —eso **es** §4.38(l.3)— y
este filtro se define precisamente como «el conjunto expuesto a ese riesgo». La assertion de `8e` que
esperaba lo contrario se corrigió (y ahora afirma lo que de verdad ocurre, con `psa9MxnCents: null` para
probar que el borrado sí surtió efecto). `SLAB_PUBLISHED` **sigue fuera del filtro por defecto**.

### 0.10.4 Fixture E2E: dos cartas nuevas (`prisma/e2e-fixtures.ts`, `prisma/seed-e2e.ts`)

- **`e2e-fourth-raw` (n.º 32) — CUARTA carta raw publicada y LIBRE** (§4.38i.9, v1.50.3-e). Nace **sin
  ninguna fila de estimado** y el caso que la usa la deja como la encontró. La razón va más allá del hueco
  puntual: con tres cartas los escenarios se **reciclaban**, y un fixture que obliga a reciclar crea
  **acoplamiento entre pruebas** —la que corre segunda hereda el estado de la primera—, justo lo que un
  fixture sintético existe para evitar. Precio por **debajo** de `thirdraw` y por **encima** de `slabbed`:
  el orden por precio que usa el arnés del front (dos raw más caras = escenario, `thirdraw` = tercera) no
  se altera.
- **`e2e-stale-est` (n.º 33) — las DOS filas que la API del contrato NO puede fabricar** (petición de QA):
  un estimado con **`capturedDate` vieja** (120 días, **automática**: `source: pokemonpricetracker`,
  `isManualOverride: false`) y otro **manual** de 90 días. `POST /admin/pricing/override` escribe
  **siempre** manual y **siempre** con la fecha de hoy (a propósito, §4.38m), así que sin seed el sabor
  **automático** de `?reason=STALE` —el del remedio **opuesto**: mirar el ingest, no la carta— solo existía
  en unitarios con dobles. Las cifras son **coherentes** a propósito (PSA 10 > raw, muy por debajo del
  múltiplo máximo, PSA 10 > PSA 9): la carta **nunca** entra al filtro por defecto y solo aparece bajo el
  opt-in `STALE`. Las dos señales de origen se siembran coherentes entre sí (`isManualOverride` **y**
  `source`), porque el resolver considera manual una fila con cualquiera de las dos.
- Nuevos folios `E2E-LST-0008` / `E2E-LST-0009` y `E2E_SET_EXPECTED_NUMBERS` con `32` y `33`.
- **La idempotencia del seed se mantiene** (§0.9): las fechas retrodatadas se calculan **relativas a hoy**,
  así que sembrar N veces deja siempre el mismo estado. El oráculo de `seed-idempotency` caso 2 se ajustó:
  ya no puede afirmar «todas las filas son de hoy» —hay filas viejas por diseño— sino lo que de verdad se
  simula, **«cada fila retrocedió exactamente un día»**, que además es una afirmación más fuerte.

### 0.10.5 Pruebas

- **Unitarias, pura** (`test/graded-estimate.gate.spec.ts`, +7): el caso medido (raw $460 + PSA 10 $230 sin
  PSA 9 ⇒ `reasons: ['NO_PSA9','NOT_ABOVE_RAW']`); `reason === reasons[0]` y `eligible ⟺ reasons=[]` sobre
  una matriz de 9 escenarios; condiciones sin insumos que **no** se listan; orden canónico con cinco
  motivos a la vez; money-neutralidad de los montos del escalón; y que lo **rancio** ya no tapa la
  incoherencia que hay debajo.
- **Unitarias, `/review`** (`test/graded-estimate.admin.spec.ts`, +5): la carta de un solo grado enumerada
  bajo `NOT_ABOVE_RAW` con `reason: NO_PSA9` y `eligible: false`; que **también** sale en el default; que
  una carta coherente de un solo grado **no** entra (si bastara con `reasons` no vacío, la lista se
  llenaría de cartas normales); y que el orden usa el `reason` matcheado.
- **Integración** (`test/integration/graded-estimate.e2e-spec.ts`, +2): **`8g)` = el caso 9 del gate de
  QA** —un solo grado incoherente sobre la carta libre: no se promociona, sí en la ficha, sí en
  `review?reason=NOT_ABOVE_RAW`, ningún precio se mueve, y se borra al final— y **`8h)`** el `?reason=STALE`
  con fila **automática** (`isManual: false`, sin filtrarse el `source`).

**Números reales** (2026-08-29, stack nativo): `npm test` **2 469/2 469** en 200 suites;
`npm run test:integration` **171/171** en 13 suites, corrido **dos veces con `npm run seed:synthetic` en
medio** (misma cifra las dos veces). `eslint`: 0 errores (2 warnings preexistentes, ajenos a este cambio).

### 0.10.6 Lo que NO toqué (cerrado por el arquitecto sin código)

- **MEN-B**: `isManual` describe **la fila que el diagnóstico está reportando** (la que `pickBestRef`
  eligió entre las candidatas consideradas), ni «la más antigua» ni «la que caducó» como conceptos
  sueltos. Mi objeción por los diales asimétricos se disuelve: la re-inyección usa **el mismo
  comparador**, así que la fila reportada **es** la que volvería a mostrarse al refrescarla.
- **R1**: la guarda del `DELETE` **no** se ensancha a slabs `in_stock`. Extenderla preservaría la fila del
  estimado precisamente para que, al publicar el slab, pasara a determinar su precio — institucionalizaría
  INV-D inverso. Queda cerrada **en vez de** abierta para que nadie la «complete» creyendo que endurece.

---

## 0.9 v1.50.3-e — El ARNÉS deja de romperse solo: seed idempotente entre días (BLOQ-A de QA) (2026-08-29)

> Cierra el rechazo de QA al pase v1.50.3-d. **La funcionalidad no cambió**: QA verificó el `409` a mano
> contra el stack vivo con el precio del slab intacto en 920 000, y la suite dio 15/15 en una BD limpia. Lo
> que fallaba era el **fixture**. Cero cambios de contrato, cero migraciones, cero cambios de precio.

### 0.9.1 BLOQ-A — el seed no era idempotente ENTRE DÍAS (`prisma/seed-e2e.ts`)

**El defecto.** La `@@unique` de `PriceReference` incluye `capturedDate`, y el helper `priceRef()` buscaba
la fila existente **filtrando por `capturedDate: day`**. Sembrar hoy sobre una BD sembrada ayer **no
actualizaba: insertaba**. El estado que QA midió tras su `up --seed --gate`:

```
e2e-slab-raw | graded:PSA:10 | 800000 | 2026-08-28
e2e-slab-raw | graded:PSA:10 | 800000 | 2026-08-29
```

…y con eso el criterio 8 (`graded-estimate.e2e-spec.ts`) reventaba en la **segunda** corrida. Peor: una
corrida **fallida** dejaba estimados a medio recapturar y filas envejecidas a 40 días (las que el caso `8d`
crea a propósito para probar la caducidad) que la corrida siguiente heredaba. En CI —BD efímera— sale
**verde siempre**: solo muerde a quien verifica en local, que es el modo de fallo que peor enseña.

**La corrección.** El seed pasa de «actualiza la fila de hoy» a **BORRA-Y-DECLARA**: elimina TODAS las
`PriceReference` de las cartas del fixture (cualquier día, cualquier acabado, cualquier `cardProductId`) y
escribe exactamente las que declara, **en una sola transacción** (para que un stack vivo con `up --seed`
nunca observe la ventana intermedia sin precio, que despublicaría piezas por `PRICE_PENDING`). El
`deleteMany` está **acotado por `cardId` a las cartas del fixture**: el seed sintético no gobierna —ni
toca— referencias de ninguna otra carta.

Consecuencia para QA/devops: **sembrar N veces, el mismo día o en días distintos, sobre BD limpia o sucia,
deja siempre el mismo estado** (9 filas de precio, una por clave lógica, con la fecha de hoy).

### 0.9.2 La aserción sobre-especificada (`graded-estimate.e2e-spec.ts:649`)

El criterio es «el `409` **no borró nada**», no «hay exactamente una fila». El caso comparaba
`toHaveLength(1)`, lo que lo acoplaba a que el seed no hubiera corrido nunca otro día. Ahora **mide el
conteo antes y después** —igual que ya hacía con el precio del slab— y sigue exigiendo que la guarda corte
antes de tocar la tabla. (El segundo rojo, `8f` en la 718, era cascada: `8e` abortaba antes de su bloque de
recaptura.)

### 0.9.3 Prueba NUEVA: `test/integration/seed-idempotency.e2e-spec.ts`

El arnés se prueba a sí mismo. Cinco casos, contra Postgres real (sin levantar la app):

1. sembrar dos veces el mismo día ⇒ estado idéntico y una sola fila por clave lógica;
2. **BLOQ-A**: se retrasa un día todo lo que el seed escribió (indistinguible de «se sembró ayer»), se
   siembra, y no hay duplicados — con el síntoma exacto que QA midió nombrado en la aserción (el slab
   con UNA fila `graded:PSA:10` a 800 000);
3. corrida fallida simulada (estimados a medio recapturar + filas a 40 días + un precio pisado por
   override) ⇒ el seed restituye el estado declarado;
4. el borra-y-declara **no toca** las referencias de una carta ajena al fixture;
5. los pedidos/envíos de **invitado** no se acumulan entre corridas (§0.9.4).

### 0.9.4 Hallazgo propio de la misma familia: los pedidos de INVITADO se acumulaban sin límite

Verificando BLOQ-A apareció un rojo distinto en `guest-checkout.e2e-spec.ts` («el envío de invitado aparece
en la cola de M4»). **Misma raíz, otra tabla:** los pedidos de invitado no cuelgan de `userId` —por
definición—, así que el reset por-usuario del seed nunca los alcanzaba y se apilaban corrida tras corrida.
`GET /admin/shipments` pagina con un **tope duro de 100** (el contrato lo capa), y al pasar de 100 envíos
`picking` históricos el envío recién creado dejó de caber en la primera página. En esta máquina había 104.
El seed ahora borra los pedidos de invitado del dominio **reservado `@example.com`** (RFC 2606, el que usan
todos los fixtures de invitado y que ningún cliente real puede tener) y sus envíos —primero los envíos, que
la FK `orderId` es `Restrict`—. Los pedidos de invitado **ya reclamados** entran también: nacieron
invitados y su envío tiene `userId = null`, así que sin esto bloqueaban por `Restrict` el borrado
por-usuario.

### 0.9.5 MEN-C — la guarda INV-D del `DELETE`, ahora también DENTRO de la transacción

Era barato, así que se hizo. La guarda de pre-vuelo se queda (responde y **audita** el `409` sin abrir
transacción, que es el caso normal) y se **repite dentro de la transacción** antes de borrar:
`publishedSlabsForGradeKey` gana un parámetro **opcional** de cliente (`Pick<Prisma.TransactionClient,
'inventoryItem'>`, por defecto el de siempre ⇒ ningún call-site existente cambia). Si el slab aparece en la
carrera, el `409` se lanza dentro, la transacción **revierte entera** y el bloqueo se audita **fuera** de
ella (escrito dentro se habría revertido con ella y la guarda quedaría muda). Cubierto por un unitario que
publica el slab justo al entrar en la transacción.

### 0.9.6 D2 (techlead) — la cita del inventario de configuración estaba desactualizada

`§0.5` citaba una salida que ya no era la que el código emite: la deriva la introdujo la propia mejora del
denominador **comparable**. La cita se **recapturó arrancando el backend contra esta BD** el 2026-08-29 y
se añadieron las otras dos formas literales (`SIN DIVERGENCIAS …` y `NO SE PUDO EMITIR …`), más la nota de
que el denominador son las claves **comparables** (36), no las filas de la tabla (41).

### 0.9.7 Lo que NO toqué (es del arquitecto)

- **MEN-B / R1**: si `isManual` debe describir la fila más antigua o la que caducó, y si la guarda del
  `DELETE` debe cubrir también slabs `in_stock` no publicados. Son decisiones de contrato/diseño, no de
  implementación: no las toco por mi cuenta (CLAUDE.md regla 9).

---

## 0.8 v1.50.3-d — El BORRADO del estimado (§4.38q) + las dos filas que faltaban en el seed E2E (2026-08-28)

> Implementa **ARCHITECTURE §4.38(q)** y los **ítems 8 y 9 de §4.38(i)**, contra `API_CONTRACT` §M2
> (addendum v1.50.3-d). **Cero DTO públicos tocados, cero migraciones, cero cambios de precio.** Una ruta
> nueva, admin-only; el resto es fixture de pruebas.

### 0.8.1 `DELETE /api/v1/admin/pricing/graded-estimates/:cardId/:gradeValue`

`super_admin`, **auditado**, funciona con el dial `off`. Vive en `GradedEstimatesController`
(`src/modules/catalog/graded-estimates.controller.ts`), junto al resto del recurso M2 — el prefijo de ruta
es el del contrato, independiente del módulo que lo aloja (misma razón que ya documenta el `GET`).

Respuesta `200`: `{ cardId, gradeValue, deletedCount }`. Errores: `400 VALIDATION_ERROR` (grado fuera de
`grades`), `403`, `404 NOT_FOUND` (nada que borrar), `409 GRADED_ESTIMATE_SLAB_PUBLISHED` (INV-D).

**Lo que hay que saber para consumirlo o revisarlo:**

1. **Alcance ESTRECHO a propósito.** Solo la fila del estimado por grado. **`raw` y `sealed` siguen sin
   borrado** y eso es deliberado (§4.38q.1 / §9): un `DELETE` genérico sobre la tabla de precios cambiaría
   **precios de venta publicados** de forma inmediata. Si alguien necesita eso, es un diseño nuevo del
   arquitecto, no una ampliación de esta ruta.
2. **`:gradeValue` es `"10"`/`"9"`, no el `gradeKey` crudo.** El servidor deriva la clave canónica
   (`gradedEstimateGradeKey`) y **exige que el grado esté en `cfg.grades`**; si no, `400`. Una ruta
   destructiva no acepta claves arbitrarias con dos puntos escapados.
3. **Borra TODAS las filas de la clave `(cardId,'graded',gradeKey,'normal',cardProductId=null)`, en UNA
   transacción**, sea cual sea su `capturedDate`. No es un detalle de eficiencia: la `@@unique` incluye la
   fecha, así que borrar «solo la vigente» haría **aflorar una fila más vieja** y la cifra **reaparecería
   sola** en la ficha. `deletedCount` sale en la respuesta para que el operador vea cuánto historial se
   llevó por delante.
4. **`404` si no había nada, jamás un `200` con `deletedCount: 0`.** Mismo precedente que el `PUT` con body
   vacío ⇒ `422`: responder éxito cuando no pasó nada le haría creer al operador que limpió algo que no
   limpió.
5. **Auditoría `pricing.graded_estimate.delete`** con `before` = **las filas borradas** (id, monto, USD/FX,
   `source`, `isManualOverride`, `capturedDate`) y `after` NULO. Ese `before` es **la única forma de
   deshacer**: recapturar lo que estaba. Efecto y bitácora van en la **misma transacción** (paridad con
   BE-GE2 del `PUT`): commitean o revierten juntos.
   - Detalle de implementación por si aparece en un `SELECT`: el `after: null` del contrato es la **columna
     en NULL**, y se pide con `Prisma.DbNull` — el `null` literal de Prisma significa «JSON null», que es
     un valor, no la ausencia de valor.

**La guarda INV-D dispara y DEBE disparar.** Con un slab publicado de ese grado ⇒ `409`, la MISMA guarda
que la escritura (`publishedSlabsForGradeKey`, §4.38l.1): esa fila **ya no es un estimado, es la referencia
de mercado real de una pieza física**, y borrarla dejaría al slab sin precio (⇒ `PRICE_PENDING` ⇒
**despublicado**).

> ⛔ **Aviso a QA / frontend / seguridad — la inferencia tentadora y FALSA.** Este `DELETE` **NO** mitiga
> INV-D inverso (§4.38l.3). «Busco las cartas expuestas con `review?reason=SLAB_PUBLISHED` y borro la
> fila» **choca con el `409`, y es correcto que choque**. El remedio ahí sigue siendo **repreciar con
> `intent:"market"`** (`POST /admin/pricing/override`), que es un acto de dinero deliberado y auditado.
> INV-D inverso sigue **abierto** y sigue necesitando **M-43 (GU-8)**.

Dos decisiones de implementación que no están en el contrato y que conviene conocer:

- **La guarda corre ANTES de mirar la tabla.** Es una precondición sobre el estado del mundo, no sobre el
  contenido de la tabla: con slab publicado y sin fila la respuesta es `409`, no `404`. Un `404` ahí
  invitaría a reintentar el borrado después de capturar la fila.
- **El intento BLOQUEADO se audita** con `action='pricing.graded_estimate.delete.blocked'` (§O.8 / criterio
  112b aplicado al verbo destructivo: sin traza, la guarda es muda por esta vía y el `409` se pierde al
  cerrar la pestaña). **`action` propia**, distinta de `pricing.override.blocked`, para no contaminar el
  conteo de aquélla. Si la bitácora falla, se loguea y el `409` sigue su curso — perder la traza es malo;
  dejar pasar el borrado por perderla sería peor.
- **La guarda es POR GRADO.** Con un slab PSA 10 publicado, el estimado de **PSA 9** de esa misma carta
  **sí** se puede borrar: no hay ninguna pieza PSA 9 publicada que dependa de él.

### 0.8.2 Seed E2E — las dos filas que pedía frontend (§4.38i.9)

En `prisma/e2e-fixtures.ts` + `prisma/seed-e2e.ts` (idempotentes, como todo el fixture):

| Carta | Número | Qué es | Qué desbloquea |
|---|---|---|---|
| `slabbed` (`e2e-slab-raw`, «E2E Slab And Raw») | `30` | raw publicado (`E2E-LST-0005`, venta MX$350) **Y** slab PSA 10 publicado (`E2E-LST-0006`, venta MX$9,200) de la MISMA carta, con su `graded:PSA:10` de mercado | el **pre-vuelo de INV-D** del back-office, el **`SLAB_PUBLISHED`** de la lista de revisión en real y el **`409` del `DELETE`** — sin ella no era verificable de punta a punta |
| `thirdraw` (`e2e-third-raw`, «E2E Third Bird») | `31` | **tercera** carta raw publicada (`E2E-LST-0007`, venta MX$460) | cubrir a la vez «un solo grado» y «dos grados sin destacar» sin que un caso pise al otro |

**Tres cosas que hay que saber antes de tocar estos fixtures:**

1. **`E2E_SET_EXPECTED_NUMBERS` se actualizó** a `['4','16','17','20','25','30','31','98','99']` — es el
   oráculo EXPLÍCITO de `buylist-cards-order.e2e-spec.ts` y sigue verde.
2. **`refPsa10Cents` de `slabbed` NO es un estimado**: es la **referencia de mercado** del slab publicado
   (la fila del estimado y la del mercado del slab son la MISMA clave — eso *es* INV-D). Por eso la ficha de
   esa carta **no** muestra el gancho: `usable()` omite el grado con slab publicado.
3. **`slabbed` se sembró SIN fila PSA 9, a propósito.** Ese estimado es justo lo que la API **sí** puede
   crear (`POST /admin/pricing/override` con `intent:"graded_estimate"`, que en el grado 9 no choca con
   nada) y es lo que hace falta para ver `reason: SLAB_PUBLISHED` en la lista de revisión: **captúralo y
   retíralo con el `DELETE` nuevo**, que es exactamente lo que hace el caso `8e` del E2E. Ponerlo en el
   seed haría que la ficha de esa carta mostrara el gancho de forma permanente, y el arnés del front elige
   su carta «sin gancho» (`bare`) tomando el **primer grupo NO raw** del catálogo — que hoy es justamente
   el slab de esta carta. Verificado contra el stack vivo: `curated`/`informed` siguen siendo Charizard y
   Pidgey (las dos raw más caras), `rawGroups[2]` es la tercera raw limpia y `bare` sigue sin gancho.

### 0.8.3 Cobertura

- **Unitarios** (`test/graded-estimate.admin.spec.ts`, 13 casos nuevos): borra todas las filas de la clave;
  borrado quirúrgico (no toca el otro grado, ni otra carta, ni `raw`); `404` sin filas (y sin bitácora);
  `400` con grado fuera de `grades` (y sin tocar la tabla); clave canónica exacta en el `deleteMany`;
  bitácora con `before`/`after` y **dentro** de la transacción; funciona con el dial `off`; y los cinco de
  INV-D (409 con la fila intacta, traza del bloqueo, guarda **por grado**, `409` antes que `404`, y que un
  slab **no publicado** —bóveda de cliente/retirado— no bloquea).
- **E2E** (`test/integration/graded-estimate.e2e-spec.ts`, caso `8e` = **criterio 8 del gate de QA**): la
  carta incoherente aparece en `review`, se **borra** (con **más de una fila** en la clave, porque `8d` la
  envejeció y recapturó: la resurrección se prueba con datos reales), **desaparece de la ficha y de las tres
  consultas de `review`**, el precio de venta **no se mueve**, no se encola ningún `PendingPriceEntry`,
  queda auditada, y repetir el borrado da **`404`**; y sobre la carta con slab el mismo `DELETE` responde
  **`409`** con **el precio del slab idéntico antes y después**, mientras el estimado de **PSA 9** de esa
  misma carta sí se enumera (`?reason=SLAB_PUBLISHED`) y sí se retira.
- **E2E, autorización** (caso `8f`): una ruta destructiva sobre la tabla de dinero es `super_admin` y punto
  — `vault_operator`, `customer` y anónimo reciben `401/403` **y la fila sigue ahí** (un `403` que aun así
  borrara sería el peor de los mundos).

### 0.8.4 Verificación

- `npm test` (unitarios): **200 suites / 2456 tests, todo verde**.
- `npm run test:integration`: **12 suites / 164 tests, todo verde**, y **repetido dos veces seguidas contra
  la MISMA BD** con resultado idéntico (E2E-1: el caso `8e` escribe y borra, así que su idempotencia se
  comprobó, no se supuso).
- `npx tsc --noEmit` limpio; `npm run lint` sin errores (las 2 advertencias son preexistentes y ajenas).

### 0.8.5 Escaladas

**Ninguna.** El contrato era implementable tal cual; no hubo ambigüedad que requiriera regla 9.

## 0.7 v1.50.3-c (cont.) — Las dos escaladas resueltas por el arquitecto (`515a4be`) (2026-08-28)

> Implementa **§4.38(n.2-bis) / GU-A24** (PI-D6) y **§4.38(h.1-ter) / GU-A25** (PI-D7). **Cero DTO
> públicos tocados, cero rutas nuevas, cero migraciones.** Todo se apoya en el
> `includeStaleForDiagnostics` de §0.6.2: **no hay lógica nueva de frescura**.

### 0.7.1 PI-D6 — `STALE` es enumerable, y el diagnóstico dice de qué SABOR es

Tres cambios, todos en superficies **admin-only**:

1. **`STALE` admitido en `?reason=`** de `GET /admin/pricing/graded-estimates/review`
   (`GRADED_REVIEW_ALLOWED_REASONS`). **Opt-in, jamás en el default** — mismo trato que
   `SLAB_PUBLISHED` y por el mismo motivo: en el default **ahogaría la señal de coherencia** en la
   lista que existe para que esa señal se vea. Deja de ser `400`.
2. **`isManual: boolean`** en `GradingHighlightResult`, en `GradedEstimatePreviewDTO` y en
   `GradedEstimateReviewItemDTO`. Se emite **`isManual` y no `source`**: contesta la pregunta operativa
   («¿esta cifra la puse yo?») sin publicar la identidad del proveedor.
3. **`capturedDate` asc intercalado** en el orden determinista (`reason` → `capturedDate` → `cardId` →
   representante). Con `?reason=STALE`, **lo más vencido primero**. `null` **al final**: una fila sin
   fecha no es «la más vieja», es una de la que no sabemos nada, y encabezar con ella empujaría lo
   accionable fuera de la primera página. El orden sigue siendo **total y estable**.

**La decisión de implementación que importa: `isManual` describe LA MISMA FILA que `capturedDate`** (la
más antigua de las presentes, que es la que decide la frescura; empate ⇒ PSA 10, determinista). Antes,
la pura solo conservaba la *fecha* mínima; ahora resuelve la **fila** mínima y deriva las dos cosas de
ella. Si no coincidieran, el operador leería la fecha de una fila y el remedio de otra —y el remedio es
justo lo que este campo existe para dar:

| Fila rancia | Qué significa | Qué hacer |
|---|---|---|
| **manual** (`isManual: true`) | la afirmación **del dueño** expiró | **recapturar** (sostener el número) o **borrarla** |
| **automática** (`isManual: false`) | el feed **dejó de cubrir esa carta** | mirar el **ingest**, no la carta (cuota, shape, carta despublicada) |

**Sin fila presente ⇒ `isManual: false` con `capturedDate: null`.** El contrato lo declara `boolean`, no
anulable; el dato que manda ahí es la fecha. `false` significa «no lo puso una persona», **no** «lo puso
el ingest» — para eso hace falta que exista fila, y eso lo dice `capturedDate`. Está documentado en el
tipo para que nadie lo lea al revés.

**Por qué esto no viola §4.38(g)** (indistinguibilidad fase 1 ⇄ fase 2): esa garantía es sobre las
superficies **PÚBLICAS**, y (g).2 ya dejaba `source`/`isManualOverride` disponibles para el admin.
`GradedEstimateRef` ya llevaba `isManual` porque la frescura asimétrica lo necesita; lo único nuevo es
que **el diagnóstico lo publica al admin**. Hay un test que verifica que el ítem **no** trae `source`
ni `isManualOverride` y que el nombre del proveedor no aparece en el JSON.

### 0.7.2 PI-D7 — el suelo pasa a `min(5, cartas en alcance)` + la regla «cero S1»

El arquitecto ratificó la exigencia de muestra mínima y **corrigió su forma**: mi suelo **absoluto** de 5
tenía **el mismo defecto que el `STALE` inalcanzable que este pase acababa de arreglar**. El alcance del
ingest es «solo cartas con inventario publicado» (§4.38h.3), así que **una tienda con 3 cartas publicadas
nunca llegaría a 5**: si las 3 devolvieran S2, la fase 2 quedaría muerta **en silencio** con su propio
detector apagado por construcción.

Disparador implementado (§4.38h.1-ter), sobre las cartas que devolvieron **algún** bloque PSA:

| Vía | Condición | Lectura |
|---|---|---|
| **A** | `S1 == 0 && S2 >= 1` | **escala SIEMPRE, sin suelo** — «nunca hemos visto el shape bueno» sugiere que `ebay.salesByGrade` no existe en este plan/cuenta; una sola observación ya es informativa |
| **B** | `S2 > S1` y `observadas >= min(5, cardsInScope)` | mayoría estricta con **suelo relativo** |

**Detalle de implementación no obvio: el denominador del suelo es `cardsInScope`** (las cartas que la
corrida **miró**), no `shapeObservations` (las que trajeron bloque PSA). Con `min(5, observadas)` la
condición sería `observadas >= observadas` —siempre verdadera— y **el suelo no existiría**. El suelo tiene
que hablar del **tamaño de la corrida**, que es lo que el argumento de la tienda chica describe.

**La guarda del formato forzado se mantiene y aplica a LAS DOS vías.** Con
`POKEMONPRICETRACKER_GRADED_FORMAT=graded_prices`, el «cero S1» de la vía (A) es **literalmente lo que
ordenamos que pasara** (`useS1 = false` por decreto), así que tampoco ahí el conteo habla del proveedor.
Hay un test específico para eso.

El veredicto lleva **por qué vía se disparó** en el `detail` y en el `AuditLog` (`rule`, `shapeFloor`,
`cardsInScope`, `shapeObservations`, `forcedFormat`): sin el suelo efectivo y el alcance, el veredicto no
sería auditable meses después, cuando `cardsInScope` ya sea otro. `GRADED_SHAPE_ESCALATION_MIN_CARDS`
sigue siendo **constante de código, no dial** (§4.38h.1-ter: se calibra una vez). La escalada es **señal,
no fallo** — no aborta la corrida ni apaga el ingest, así que un falso positivo cuesta una conversación.

### 0.7.3 Verificación

| Suite | Resultado |
|---|---|
| `npm test` (unitarios) | **200 suites / 2443 tests — todo verde** |
| `npm run test:integration` | **12 suites / 162 tests — todo verde** |
| `npx tsc --noEmit` / `eslint` | limpio (2 warnings preexistentes, ajenos) |

Tests nuevos de este tramo: 6 sobre `?reason=STALE` / `isManual` / no-fuga de `source` y 2 de orden por
`capturedDate` en `graded-estimate.admin.spec.ts`; 6 sobre el invariante «`isManual` y `capturedDate`
describen la misma fila» en `graded-estimate.confidence-gate.spec.ts`; 6 sobre las vías A/B y el suelo
relativo (incluido el caso **tienda chica de 3 cartas** y su contraste con 40 en alcance) en
`graded-estimate.inv-fx.spec.ts`.

**Y el caso que pidió el arquitecto para QA (§4.38i punto 7), en el E2E `8d)` contra el stack vivo:** la
carta de 40 días, ya invisible en las tres superficies, **se encuentra** en `review?reason=STALE` con
`isManual: true`, su `capturedDate` y su cifra; **no** aparece en el default; y **desaparece de esa lista
al recapturarla**. Sin esa segunda mitad, «caduca solo» sería una **desaparición sin retorno** — y una
lista de pendientes que no se vacía al resolver el pendiente enseña a ignorarla. La búsqueda es por
`cardId` y no por `data[0]` a propósito: la lista es **global** por diseño, así que filas ajenas al
fixture pueden convivir sin invalidar el caso (es la sensibilidad de estado que reportó QA).

**Nota para frontend/QA:** en el E2E `8c)` el ejemplo de `reason` inválido dejó de poder ser `STALE`
(ahora es admitido); se cambió a `NO_PSA10`, que sigue siendo `400`.

## 0.6 v1.50.3-c — Ronda de corrección QA + techlead sobre el gancho PSA (2026-08-28)

> **Cero cambios de contrato, de schema y de ruta.** Una migración: ninguna. Lo que cambia hacia fuera
> son **tres cosas observables**: el `reason` que emite el diagnóstico de admin cuando una cifra caducó,
> el **código de estado** de `POST /admin/pricing/override` (`201` → `200`, que es lo que el contrato
> norma) y dos líneas de log (inventario de config y escalada por shape).
>
> Contexto: **techlead APROBÓ con deuda**; **QA rechazó por el arnés de pruebas**, no por este código
> (sus dos bloqueantes son de devops y frontend). Esta ronda cierra lo que sí era de backend.

### 0.6.1 El archivo más leído de la feature documentaba los seeds DEROGADOS (techlead, bloqueante del pase)

`backend/src/common/graded-estimate.ts` — el docblock de la **interfaz** `GradedEstimateConfig` seguía
diciendo `manualFreshnessDays` «seed `null` = no decae», `maxRawMultiple` «seed 50» y `minSampleCount`
«seed 3», y **repetía entero el razonamiento v1.50.2** que §4.38(m) derogó («un override manual no es un
feed… su vigencia la revoca otro humano, no el calendario»). Los tres contradecían los `DEFAULT_*` del
**mismo archivo** (30 / 100 / 5) y contradecían la arquitectura. `isStaleRef` remataba con un
`// seed: el manual NUNCA es rancio` que ya no era el seed.

La ronda anterior declaró atendido «comentarios invalidados» (M6) y **este archivo se quedó fuera**. Por
qué es corrección y no deuda: **quien mantenga esto en seis meses lee la interfaz, no las constantes**, y
concluiría lo contrario de lo que el código hace **sobre el predicado que gobierna una afirmación
comercial** (criterio 109). Los cuatro comentarios quedan corregidos, cada uno declarando el valor
vigente, el valor derogado y **por qué** se derogó; `DEFAULT_GRADED_ESTIMATE_*` queda nombrado como la
fuente de verdad para que la próxima divergencia no pueda pasar por «documentación».

### 0.6.2 El motivo `STALE` era CÓDIGO MUERTO en las dos superficies de admin (QA, medido en vivo)

**El defecto.** El arreglo del orden (v1.50.3) metió el filtro de frescura **dentro** de
`getGradedEstimatesBatch`, y `preview`/`review` consumen ese batch **a propósito** (para no diagnosticar
sobre una verdad distinta a la del storefront). Efecto: las filas rancias dejaron de existir también para
el diagnóstico. Con una fila manual de 40 días, `preview` respondía:

```
{ reason: 'NO_PSA10', stale: false, psa10MxnCents: null, capturedDate: null }
```

…cuando la verdad era **«tu cifra expiró»**. `API_CONTRACT §M2` enumera `STALE` entre los `reason`
emitibles y `stale` entre los campos de diagnóstico: los dos eran inalcanzables.

**Por qué no es cosmético.** Los dos remedios son **opuestos**: «captura una cifra» vs. «refresca la que
tienes». Un diagnóstico que los funde manda al operador a teclear de cero un número que ya está en la
tabla — y el bucle operativo del criterio 109 es exactamente *recapturar*.

**El arreglo, sin deshacer el anterior.** `getGradedEstimatesBatch` gana un opt-in
`{ includeStaleForDiagnostics: true }` que **solo** usan `preview` y `review`:

| | Ruta pública (ficha, teja, vitrina) | `preview` / `review` |
|---|---|---|
| Filtro de frescura antes de `pickBestRef` | **sí** (sin cambios) | **sí** (sin cambios) |
| Fila rancia re-inyectada | nunca | **solo** en las claves sin NINGUNA fila fresca |
| Resultado con «manual 200 d + automática fresca» | la automática | **la automática** (cero divergencia) |
| Resultado con «manual 40 d, sin automática» | nada (criterio 109) | `STALE` + monto + `capturedDate` |

Tres propiedades que sostienen que esto no reabre nada:
1. **No puede volver elegible a nadie.** Las filas re-inyectadas son rancias por construcción y
   `evaluateGradingHighlight` corta en `STALE` **antes** de resolver escalón, umbral y cotas.
2. **No puede envenenar la ficha.** Si alguien pasara ese mapa a `selectGradedEstimates`, `usable()`
   vuelve a filtrar por frescura: la defensa de las puras sigue en su sitio.
3. **La única divergencia posible con el storefront viene ETIQUETADA** con la razón que la explica
   (`STALE`), en vez de ser silenciosa.

**Discrepancia con el contrato — escalada (regla 9) y YA RESUELTA por el arquitecto.** Con lo anterior,
`preview` quedaba completo y **`review` no**: §M2 rechazaba `STALE` con `400`, así que una carta con
cifra caducada resolvía a `STALE` y **no era enumerable**. Se escaló sin tocar el contrato; el arquitecto
lo resolvió en el commit `515a4be` (**GU-A24 / §4.38n.2-bis**) aceptando la propuesta tal cual y
declarando el `400` un **error de diseño propio** («agrupé `STALE` con la ausencia de dato, y no es eso:
es un dato que existió y expiró»). **Implementado en §0.7.**

### 0.6.3 La escalada por shape podía AUTOINDUCIR su veredicto (techlead)

`shapeCounts.s2 > shapeCounts.s1` disparaba «PPT sirve mayoritariamente S2 ⇒ la fase 2 no es viable con
este proveedor» — un veredicto de **arquitectura y presupuesto**. Dos formas de engañarlo:

- **Formato forzado.** Con `POKEMONPRICETRACKER_GRADED_FORMAT=graded_prices`, el `forcedFormat` del
  parser pone `useS1 = false`, así que **toda** carta con bloque `gradedPrices` se cuenta como S2 aunque
  traiga `ebay.salesByGrade` perfectamente persistible. Ese hallazgo **no habla del proveedor: habla de
  lo que nosotros le pedimos mirar** — y §4.38h.1-bis declara ese forzado explícitamente legal. Mismo
  falso positivo que el `jsonb` reordenado del inventario: gritar por algo que hicimos nosotros.
- **Sin suelo de muestra.** `1 > 0` satisface la mayoría estricta: **una sola carta** con bloque PSA
  bastaba. Con el alcance acotado por diseño (curaduría manual en fase 1 + `ingestMaxCardsPerRun`), los
  denominadores diminutos son **normales**.

Ahora el predicado exige `forcedFormat === 'auto'` **y** un suelo de muestra. *(⚠️ El suelo que propuse
—5 absoluto— lo **corrigió el arquitecto** en el mismo commit: ver §0.7.2. La guarda del formato forzado
queda como estaba.)* En los dos casos suprimidos el job hace **exactamente lo mismo con las cartas** (S2 sigue
siendo no persistible y se sigue saltando y auditando carta por carta): lo único que cambia es que no se
emite un veredicto que la evidencia no sostiene — y se deja un `warn` que dice **cuál de las dos
condiciones faltó y cómo obtener un veredicto válido** (correr con `auto` / ampliar el alcance). El suelo
es deliberadamente bajo: no busca significancia estadística, solo evitar que una o dos observaciones se
presenten como el shape dominante del proveedor. La escalada lleva ahora su propia procedencia en el
`detail` y en la bitácora (`forcedFormat`, `shapeObservations`, el suelo efectivo y la vía que disparó).

**No muerde hoy** (el dial `graded_estimate_ingest_enabled` está `off`), pero queda cerrado **antes** de
encenderlo, que era la condición.

### 0.6.4 Menores del techlead y de QA

- **Inventario de configuración: recorte alrededor de la primera diferencia.** `INVENTORY_VALUE_TRUNCATE`
  son 160 chars y el JSON de `grading_cost_tiers` ronda los **420**: si la divergencia caía en el escalón
  4, la línea imprimía **dos prefijos idénticos** y decía «X difiere de Y» con X == Y — el falso negativo
  de diagnóstico que esa línea existe para no tener, en el único dial que es una tabla. Ahora se imprime
  el **JSON canónico** (el mismo con el que se decide si hay divergencia) recortado en una **ventana
  común a los dos lados** centrada en el primer char divergente, más el **ancla** `[1ª diferencia en char
  N]`. Los valores que caben se siguen imprimiendo enteros.
- **«SIN DIVERGENCIAS» ya no sobre-afirma.** El denominador era `rows.length`, que incluye las claves
  **sin default de código** (las que salta el `hasOwnProperty`): afirmaba «las N claves están en su
  default» sobre filas que nunca miró. Ahora cuenta las **comparables** y declara aparte cuántas filas
  hay en la tabla. En una línea cuyo único valor es que se pueda confiar en ella, afirmar de más es el
  peor defecto posible.
- **Acoplamiento documentado: `freshnessDays` hace DOS trabajos.** Ventana de **lectura** (ficha y
  vitrina) y ventana de **evidencia en la escritura** (§4.38m.2). Consecuencia al mover el dial, ahora
  escrita en su docblock: bajarlo a 7 aprieta las dos; subirlo a 90 afloja las dos y admite hasta **180
  días** de antigüedad exhibida (90 de evidencia al escribir + 90 de exhibición desde la captura).
- **`isStaleByOrigin(capturedDate, isManual, today, cfg)`** en `common/graded-estimate.ts`.
  `getGradedEstimatesBatch` derivaba `isManual` **dos veces** en la misma función y fabricaba un
  `GradedEstimateInput` falso con **`mxnCents: 0`** solo para llamar a `isStaleRef`. Funcionaba (el
  predicado ignora el monto) pero un `0` es un centinela **inválido** en cualquier otro punto de ese
  archivo —`usable()` lo trata como «no es un estimado», money-safe— y era una trampa para el siguiente
  lector que lo copiara. `isStaleRef` queda como envoltorio: **una sola verdad sobre qué es fresco**.
- **`POST /admin/pricing/override` ahora responde `200`** (QA MENOR-1). El contrato lo norma
  explícitamente («Res `200` NORMADA en v2.1.7») y `@Post` de Nest respondía el `201` por default; el
  **cuerpo** ya era el normado. Manda el contrato sobre el código, así que se corrigió el código —**no
  hubo que escalar**. `200` es además lo correcto en semántica: no crea recurso direccionable (el `id` de
  la `PriceReference` va a la bitácora, no a la respuesta) y no hay `Location`. **Aviso a frontend/QA:**
  cualquier arnés que asertara `201` sobre esta ruta debe actualizarse (en `backend/` ya está hecho, en
  dos specs de integración).

### 0.6.5 Verificación

| Suite | Resultado |
|---|---|
| `npm test` (unitarios) | **200 suites / 2426 tests — todo verde** |
| `npm run test:integration` | **12 suites / 162 tests — todo verde** |
| `npx tsc --noEmit` | limpio |

Tests nuevos (todos en `backend/test/`): 7 sobre `includeStaleForDiagnostics` en
`graded-estimate.batch.spec.ts` (incluida la no-divergencia con el storefront y el money-safe del `<= 0`),
4 sobre las dos guardas de la escalada por shape en `graded-estimate.inv-fx.spec.ts`, 4 sobre el recorte
por diferencia y el denominador en `settings.config-inventory.spec.ts`, 1 sobre el `@HttpCode(200)` en
`pricing.declared-shapes.spec.ts` y 1 aserción nueva en el E2E `8d)` que comprueba `STALE` +
`capturedDate` + monto contra el stack real (era el caso exacto que QA midió).

**Nota sobre la sensibilidad al estado de la BD que reportó QA:** en esta corrida la suite de integración
dio 162/162 sin normalizar nada. El E2E `8d)` **fija el dial explícitamente** antes de asertar (no confía
en el seed) y limpia sus filas `PriceReference` graded en el `afterAll`; el riesgo que QA vio viene de
filas graded **ajenas al seed** que la lista de revisión sí barre por diseño (su conjunto motor son *todas*
las cartas con fila de estimado). No es un defecto del código ni del test: es que `review` es global por
definición. Si vuelve a aparecer, el discriminante es mirar si las filas extra tienen `source` distinto
del que el E2E escribe.

## 0.5 v1.50.3-a/b — Cierre de las dos escaladas (PI-D2 y PI-D3) (2026-08-28)

> Implementa el **addendum v1.50.3-a** (§4.38h.1-bis, §4.38p, §11.0) y el endurecimiento **v1.50.3-b**
> (§4.38i.7, §11.0 punto 5). **Cero cambios de contrato, de DTO y de ruta.** Ninguna migración.
> El único comportamiento nuevo observable desde fuera es de **log y bitácora**.

### 0.5.1 `POKEMONPRICETRACKER_GRADED_MIN_COUNT` — RETIRADA (PI-D2)

La env está **derogada y borrada del código**: `PokemonPriceTrackerBulkProvider` ya no la lee. Fijarla no
tiene ningún efecto (hay un test que lo asserta comparando el resultado con y sin ella, drop a drop).

**Por qué se retira en vez de dejarla ahí.** Su único propósito declarado era hacer persistible a S2, y S2
quedó declarado **NO PERSISTIBLE por shape**. Una escotilla que ya no abre nada **es peor que ninguna**:
alguien la pondrá, no verá cambio alguno, y concluirá que el ingest está roto — el mismo falso negativo de
diagnóstico que producía el truncate de 800 chars.

**Lo que el arquitecto corrigió de mi propio reporte, y conviene que se lea:** S2 **tampoco era persistible
antes de v1.50.3**. Sin `count`, el punto 2 del gate ya quedaba *desconocido* ⇒ fail-closed. El único camino
de S2 a la base era la escotilla, y una escotilla es por definición *aceptar un riesgo a sabiendas*, no una
vía normal. El parser **ya era «de una hipótesis y media»** en configuración por defecto; v1.50.2 no lo
decía en voz alta. El gate de evidencia no rompió nada: puso un segundo cerrojo en una puerta ya cerrada.

**Para QA/devops — la capacidad legítima NO se pierde.** Admitir muestras pequeñas en S1 se hace con el dial
**auditado** `graded_estimate_min_sample_count = 1`, vía `PUT /admin/pricing/graded-estimates`. Hay test.

### 0.5.2 El sondeo de S2 se CONSERVA, con papel nuevo: diagnóstico, no escritura

| | Antes (v1.50.3) | Ahora (v1.50.3-a) |
|---|---|---|
| Motivo del drop | `sample_too_small` (o `evidence_unknown` con la escotilla puesta) | **`shape_not_persistible_s2`** |
| Contador | se fundía en `skippedSample` / `skippedEvidence` | **`skippedShapeS2`, propio** |
| Granularidad | por grado | **por CARTA** (la pregunta es «¿qué sirve el proveedor?») |
| Gates de dinero | se corrían y fallaban | **no se corren**: no fallan, es que **no existen** en el shape |

Los tres motivos van **separados** porque «el proveedor cambió de shape» y «esta carta tiene pocas ventas»
exigen **reacciones opuestas**, y un contador único los vuelve indistinguibles **justo cuando hay que
decidir si escalar**. La línea de resumen del job los imprime por separado, y cada carta en S2 deja `warn`
propio + `AuditLog` (`graded_estimate.ingest.skipped`, `reason: shape_not_persistible_s2`).

**Nuevo veredicto de corrida — `shape_not_persistible_s2_dominant`.** `GradedEstimateFetchResult.shapeCounts`
(`{ s1, s2 }`, cartas por shape) sube al orquestador, que juzga con **la corrida entera delante** (mismo
patrón que `no_graded_block_in_response`). Si `s2 > s1`, el job deja `result.escalation`, un `logger.error`
y una fila `graded_estimate.ingest.escalated`.

- **Umbral = mayoría ESTRICTA, no «≥ 1 carta en S2»**, por la lección del 401/403 tratado como «no admite el
  parámetro»: una escalada dispara una decisión de arquitectura y presupuesto, así que **tiene que poder
  sostener su veredicto**. Una carta suelta en S2 queda contada y auditada, sin veredicto.
- **No para el job ni destruye nada:** lo que sí se pudo escribir en la corrida se conserva (hay test).
- **La escalada dura (4xx) tiene precedencia** y no se pisa con la de shape.

> ⛔ **Para el orquestador, cuando la fase 2 se encienda:** si la primera corrida real emite
> `shape_not_persistible_s2_dominant`, **el backend no parchea** (ni escotilla, ni dial nuevo, ni `count`
> inventado): **vuelve al arquitecto**. Ese hallazgo no dice «hay un bug», dice **«la fase 2 no es viable
> con este proveedor»**, y elegir entre degradar a manual de forma permanente, buscar un segundo proveedor
> o pagar el plan que exponga `salesByGrade` es decisión de **producto y de costo**. **No hay acantilado
> detrás**: la degradación a manual ya está diseñada y funciona (es el estado de v1.50).

### 0.5.3 `lastSaleDate` en S1 se identifica POSITIVAMENTE

Ya era el comportamiento (`parseEvidenceDate` o `evidence_unknown`); v1.50.3-a lo deja **escrito y con
test propio**. La fecha es una **hipótesis, no un hecho**: el Gate 0 dejó registrado que la documentación
del proveedor **se contradice a sí misma**, así que describir `salesByGrade` con «fecha de la última venta»
es **documentación, no una respuesta observada**. Sería incoherente auto-confirmar el precio y **dar por
supuesta la fecha**. Un S1 sin fecha legible **no es «S1 degradado»**: es una forma que no sabemos leer ⇒
no se escribe y se registra la muestra (con el **nombre del campo buscado**, que es lo que permite
descubrir el nombre real sin adivinar). El nombre sigue siendo dial de operador
(`POKEMONPRICETRACKER_GRADED_EVIDENCE_FIELD`), no un alias sondeado a ciegas.

### 0.5.4 Línea de INVENTARIO de configuración al arrancar (PI-D3, §11.0)

`SettingsService.onModuleInit()` emite **una** línea `log`/`info` con las claves cuyo valor vigente
**difiere de su default de código**, con **clave + vigente + default**.

**⚠️ v1.50.3-b: esto es un REQUISITO, no un extra.** Descartado el E2E como detector de configuración
(escribe y exige fixtures ⇒ nunca apunta a prod), esta línea y el `GET /admin/pricing/graded-estimates`
son **los dos únicos detectores del seed rancio**, y los dos son de solo lectura.

- **Se emite SIEMPRE**, también sin divergencias, con `SIN DIVERGENCIAS` explícito: una línea que solo
  aparece con problema es **indistinguible de una que no se emitió**, y «no vi la alerta» pasaría por «está
  todo bien» — fallar abierto. Si la lectura de la BD falla, se emite un `warn` que dice **`NO SE PUDO
  EMITIR`** en vez de callar (el silencio se leería como «sin divergencias»). El arranque **nunca** se cae
  por esto.
- **Es `log`/`info` y NO `warn`** a propósito: un dial ajustado adrede es normal, y alertar por cada uno es
  ruido que se aprende a ignorar. La **única** excepción `warn` sigue siendo `manualFreshnessDays === null`
  (I8-bis), que la emite `PricingService` porque desactiva un criterio de `PROJECT.md`.
- **No escribe nada.** Hay test que asserta que en esa ruta no hay `upsert`/`update`/`create`.

**Comparación CANÓNICA (defecto encontrado corriéndolo contra la BD de dev y corregido).** Postgres guarda
`jsonb` y **reordena las claves de los objetos**, así que `grading_cost_tiers` volvía con el mismo contenido
en otro orden y un `JSON.stringify` crudo lo declaraba «DIFERENTE» **en cada arranque**. Un inventario con
falsos positivos es tan inútil como el truncate de 800 con su falso negativo, y encima entrena a ignorar la
línea. Se compara con JSON canónico: **claves de objeto ordenadas, orden de ARRAYS respetado** (en los
escalones y en la curva el orden es significativo). Tres tests cubren las tres direcciones.

**Salida real contra la base de dev de este entorno** (útil para QA/devops, y es el hallazgo PI-D3 en vivo).
**Recapturada el 2026-08-29 arrancando el backend contra esta BD** (v1.50.3-e, corrección D2 del techlead: la
cita anterior era de antes del cambio de denominador y ya no era la línea que el código emite — un ejemplo
desactualizado en la sección que existe para sustituir una verificación manual es exactamente el defecto que
esta sección persigue). Se transcribe **literal**, en una sola línea como sale:

```
config inventory: 3 de 36 clave(s) comparables DIFIEREN de su default de código → graded_estimate_max_raw_multiple=50 (default 100); graded_estimate_min_sample_count=3 (default 5); sealed_spread_pct_by_subtype={"blister":35,"box":18,"bundle":25,"etb":22,"tin":30} (default {"blister":35,"box":18,"bundle":25,"collection":22,"etb":22,"tin":30,"upc":18}). (§11.0: es un INVENTARIO, no una alarma — un dial ajustado a propósito es normal. Si alguno debía haberse actualizado con el deploy, se aplica por PUT de admin —auditado y validado—, NUNCA por UPDATE directo a la BD.)
```

⚠️ **El denominador son las claves COMPARABLES, no las filas de la tabla** (`36`, no `41`): las filas sin
default de código —retiradas o escritas fuera de banda— no se comparan, y contarlas afirmaba «están en su
default» sobre filas que ni se miraron. Por eso la línea dice `N de M clave(s) comparables DIFIEREN` y no
`N de M clave(s) DIFIEREN`.

Las otras dos formas exactas que emite el mismo método, para que QA/devops sepan qué buscar (`grep 'config
inventory'`). Los números de la primera son los REALES de esta BD (36 comparables de 41 filas), aunque hoy la
línea que sale es la de arriba porque sí hay divergencias:

```
config inventory: SIN DIVERGENCIAS — las 36 clave(s) COMPARABLES (de 41 fila(s) en la tabla; el resto no tiene default de código contra el que contrastar) están en su default de código. (§11.0: un seed es una condición inicial y los cambios de seed NO llegan solos a un entorno ya sembrado; esta línea es —junto al GET del recurso— uno de los dos detectores del seed rancio, así que se emite siempre, también cuando no hay nada.)
config inventory: NO SE PUDO EMITIR el inventario de arranque (§11.0): <error>. Este entorno queda SIN uno de sus dos detectores del seed rancio (el otro es GET /admin/pricing/graded-estimates). El arranque CONTINÚA.
```

Es exactamente lo que §11.0 describe: **una base ya sembrada conserva los seeds viejos con el código nuevo
desplegado y los tests en verde**. (`manual_freshness_days` ya no aparece porque se fijó a mano por el `PUT`
cuando se reprodujo PI-D3.)

### 0.5.5 Lo que NO hice, y por qué (ratificado por el arquitecto)

**No automaticé la propagación de los seeds.** `prisma/seed.ts` sigue con `upsert` + `update: {}` y **no se
toca**: es lo que impide que un deploy pise el ajuste deliberado de un operador. El obstáculo no es pereza:
`ConfigSetting` guarda un **valor**, no su **procedencia**, así que «sigue en el seed viejo» y «el operador
lo eligió así» son **el mismo dato** — y `3`, `50` y `null` son elecciones de operador perfectamente
plausibles. Inferir la procedencia del `AuditLog` se evaluó y se descarta: falla **abierto y en silencio**
ante una poda de auditoría o una edición fuera de banda.

**El paso de despliegue es de devops + el humano (§4.38p, GU-13), no mío.** Backend no tiene trabajo ahí.

---

## 0.4 v1.50.3 — Ronda de corrección del gate QA + techlead (2026-08-28)

> Cierra el rechazo doble del pase v1.50.2. **Sin migración, sin cambio de contrato, sin cambio de forma de
> ningún DTO.** Un solo cambio de comportamiento observable —la nueva fila de bitácora— y el resto son
> correcciones de alcance, de veredicto y de documentación que estaba mintiendo.

### 0.4.1 🔴 BLOQUEANTE (QA) — la guarda de dinero era MUDA por la vía manual

**Qué pasaba.** Los `throw` del `422 GRADED_INTENT_REQUIRED` y del `409 GRADED_ESTIMATE_SLAB_PUBLISHED`
ocurrían **antes** del `audit.log(...)` del handler, así que un intento bloqueado **no dejaba ninguna fila**.
QA lo midió contra el stack vivo: `AuditLog` **421 filas antes, 421 después** de provocar un 409 **y** un 422.

**Por qué era bloqueante y no cosmético.** `PROJECT` **§O.8** y el **criterio 112(b)** exigen que *«todo
intento bloqueado —manual o del ingest— quede registrado, para que se vea si la guarda está saltando seguido
y por qué»*. Sin bitácora, el `422`/`409` lo ve **solo quien hizo la petición** y se pierde al cerrar la
pestaña. En una guarda cuyo propósito es impedir que una cifra ilustrativa mueva el precio de una pieza real,
esa fila es **la única señal** de que el operador está chocando contra ella —y por tanto la única forma de
distinguir «la guarda funciona» de «la UI está enrutando mal y nadie se ha enterado»—. El ingest **sí**
cumplía (`PriceIngestService.auditGradedSkip`); la vía manual quedó como el hueco.

**Fix.** `PricingController.auditGradedBlock(...)` (`pricing.controller.ts`), invocado **antes** de cada
`throw`:

| Campo | Valor |
|---|---|
| `action` | **`pricing.override.blocked`** (propia: un intento bloqueado **no** es un `pricing.override`) |
| `entityType` / `entityId` | `PriceReference` / el `cardId` del intento |
| `actorUserId` | el `super_admin` que lo intentó |
| `after.code` | `GRADED_INTENT_REQUIRED` \| `GRADED_ESTIMATE_SLAB_PUBLISHED` |
| `after.reason` | `intent_missing` \| `slab_published` |
| `after.attemptedPriceMxnCents` | **el monto que NO se escribió** — es lo que permite ver si el operador insiste con la misma cifra |
| `after.gradeKey` / `finish` / `intent` | el intento completo, reconstruible |
| `after.publishedSlabCount` / `inventoryItemIds` | solo en el `409`: **qué piezas reales** lo bloquearon |

**Fallo de la bitácora ⇒ el rechazo SIGUE en pie.** El `log` va en `try/catch` con `logger.warn`: perder la
traza es malo, dejar pasar el intento por perderla sería mucho peor. Hay test para ese caso.

**Cobertura nueva:** 5 pruebas unitarias en `test/pricing.graded-intent.spec.ts` (bloque «el intento
BLOQUEADO se AUDITA») + el caso **(d)** del E2E `graded-estimate.e2e-spec.ts` **3b**, que cuenta filas de
`AuditLog` contra Postgres real antes y después — exactamente la medición con la que QA cazó el fallo.

**Para QA / pentester / seguridad:** `pricing.override.blocked` es una acción **nueva** en `AuditLog`. No
viaja a ninguna superficie pública (`before`/`after` nunca salen del audit-log de M10, §M6).

### 0.4.2 🟠 El «sincronizar ahora» del admin no refrescaba los estimados

`PriceIngestJobService.run()` llamaba a `runGradedEstimates(fx)` en **sus dos ramas** (fan-out con Redis y
secuencial sin Redis), pero `runBackground()` —que es el **único disparo manual** del barrido completo, el
botón de N-11— **no**. El operador veía la barra llegar al 100% y concluía, razonablemente, que había
refrescado todo; los estimados se quedaban hasta el cron.

Ahora `runBackground()` encadena el gancho **después** del barrido (`.catch(...).then(...)`, sin bloquear el
request). Dos decisiones explícitas:
- **Después, no en paralelo:** el gate del gancho compara contra el precio de venta raw que fija el barrido, y
  lanzar los dos a la vez duplicaría la presión sobre la cuota del proveedor.
- **`.then` tras el `.catch`:** si el barrido de venta falla, el gancho **se refresca igual**. La dependencia
  va en un solo sentido y un fallo del barrido no es razón para dejar los estimados rancios.

### 0.4.3 🟠 Renumeración 79–92 → 97–110 completada en el código

`PROJECT.md` renumeró el bloque del gancho porque **79–96 ya estaban tomados por §N (la curva, LOCKED, en
producción)**. El código se quedó con los números viejos, y eso **no era cosmético**: en
`catalog.service.ts`, «criterio 84» significaba **dos cosas distintas según la línea** —`:516`/`:544` era el
84 **vivo de main** (*la rareza no entra al monto*) y `:1094` el viejo 84 del gancho (hoy **102**)—. Un
mantenedor no podía desambiguarlo leyendo.

Mapeo aplicado (offset +18) tras verificar **caso por caso** de quién era cada mención:

| Viejo | Nuevo | Enunciado |
|---|---|---|
| 79 | **97** | el gate decide qué se PROMOCIONA (el «si y solo si >=») |
| 80 | **98** | sin PSA 9 no se promociona |
| 82 | **100** | la teja que falla se ve exactamente igual que hoy |
| 83 | **101** | vitrina: si ninguna pasa, no se renderiza |
| 84 | **102** | money-safe: una cifra que no existe no se dibuja |
| 86 | **104** | diales editables sin deploy y auditados |
| 87 | **105** | solo raw (graded y sealed nunca) |
| 90 | **108** | el estimado no contamina el dinero real |

Tocados: `common/graded-estimate.ts`, `catalog.service.ts` (6 sitios), `graded-estimates.controller.ts`,
`graded-estimate.{gate,composition,admin}.spec.ts`, `catalog.group-dto-shape.spec.ts` y el E2E.
**NO tocados** —son de `main` y siguen vigentes—: `catalog.service.ts:496` (85), `:516`/`:544` (84),
`pricing.service.ts:2130` (84), `pricing.controller.ts:410` (87) / `:491` (84), `variant-pricing.ts` (84),
`variant-controls.service.ts:301` (91) y todos los specs de curva/buylist.

También: `settings.constants.ts` citaba **§N.1** donde hoy va **§O.1**, y la cabecera del E2E citaba §N/§N.6
donde va §O/§O.6.

### 0.4.4 🟡 La escalada del ingest ya no emite veredictos que no puede sostener

Dos correcciones distintas sobre el mismo mecanismo. Las dos tienen la misma forma: **el veredicto de
ESCALADA dispara un rediseño de arquitectura y de presupuesto** (el ingest curado por lista, 2 créditos ×
carta), así que emitirlo sin evidencia cuesta caro.

**(a) `pokemonpricetracker-bulk.provider.ts` — el predicado era «cualquier 4xx ≠ 429».** Un **401/403**
(clave ausente, vencida o sin el plan de eBay) y un **404** (`pptSetId` cacheado que ya no existe) llegaban al
arquitecto como *«el proveedor no admite el parámetro»*. Ninguno de los tres habla del parámetro: dos hablan
de la **credencial** y uno del **recurso**. Ahora `isParamRejection(status)` los excluye y caen a **fallo de
request normal** (no se escribe nada, los estimados previos quedan intactos, la corrida sigue), con una pista
accionable en el log («rota la clave» / «re-mapea el set»). `400`/`422` siguen escalando.

**(b) `price-ingest.service.ts` — «ninguna entrada trae bloque PSA» ya no para la corrida entera.** La
condición es ambigua por naturaleza (*«este set no tiene ventas PSA»* vs *«el proveedor ignoró
`includeEbay`»*) y eso **no ha cambiado**; lo que estaba mal calibrado era la **consecuencia**. Un set sin
ventas PSA es un **estado de datos normal**, así que un set inocente abortaba el run —con sus créditos ya
gastados— y entregaba un veredicto que la evidencia no sostenía.

> **Regla nueva: la ambigüedad se evalúa a escala de CORRIDA, no de set.** Se escala **solo si NINGÚN set del
> run vio bloque PSA** —el único estado en que las dos hipótesis son de verdad indistinguibles—. En cuanto un
> set lo ve, el shape queda **confirmado por observación** y los demás son un `skip` **con traza**.

Mecánica: el provider expone `sawGradedBlock: boolean` y su `escalate` de esta forma pasa a ser un
**candidato**; el veredicto lo emite el orquestador al cierre del run. `GradedIngestResult` gana
`skippedNoGradedBlock`. La escalada **dura** (4xx que rechaza el parámetro) sigue **parando en el acto**: ahí
el proveedor lo dijo explícitamente y seguir barriendo solo quema créditos.

### 0.4.5 🟢 Menores del veredicto

- **INV-D por grado en la rejilla** (criterio 112c): el guard comparaba con `'10'`/`'9'` **hardcodeados**. El
  resultado observable no cambia, pero los literales acoplaban la guarda al **valor del dial**: el día que
  `grades` admita otro grado, un literal que no se actualiza deja de mirarlo y la guarda de LECTURA se abre en
  silencio sobre una fila que **sí es dinero**. Ahora los grados vigilados se **derivan** de las filas que el
  gate resolvió. (La ficha ya era fina grado a grado vía `usable()`.)
- **`GradedEstimateRef extends GradedEstimateInput`** — redeclaraba los cuatro campos a mano contra la promesa
  de §4.38c de «UNA sola definición». Añadir un campo al input y olvidarlo aquí **compilaba**.
- **El `PUT` de M2 usa los validadores compartidos** para `freshnessDays` y `minUpsidePct`
  (`validateGradedEstimateFreshnessDays` / `validateGradingMinUpsidePct`), en vez de reimplementar el rango.
  Eran **tres copias** del mismo invariante (este `PUT`, `PUT /admin/settings` y la lectura fail-closed) que
  nadie obligaba a coincidir. **El mensaje y el `details.field` que ve el cliente no cambian** — hay test que
  lo fija, y ahora también se caza el **tipo** (`'30'`, `1.5`, `NaN`), no solo el rango.
- **`getCard` declara el tipo de su sobre** (`GroupedListingDetailResponse`). Devolvía un literal sin anotar,
  así que cambiar `.map(g => g.dto)` por `g.summary` —un carácter— **compilaba** y servía el DTO de la
  REJILLA en la ficha: reintroducir la inversión de §N.7 en el 100% de las fichas, que es exactamente la
  regresión B-1 que `main` pagó cara. Ahora **no compila**.
- **`pricing-visibility.e2e-spec.ts` deriva sus listas de claves** de `test/helpers/dto-keys.ts` (que existe
  para eso) en vez de mantenerlas a mano. El recorte de opcionales del escenario queda explícito.
- **Resolución carta↔proveedor EN MEMORIA en el ingest del gancho** (BE-GE3): `resolveCardId` hacía **1-3
  queries por fila** dentro del bucle sobre un conjunto que ya estaba materializado (hasta ~750 round-trips
  con el tope de 250 cartas). Ahora hay un índice por set (`byExternalId` / `byNumber`) y un resolver **puro**
  (`resolveGradedCardId`) con la MISMA regla, incluida la de ambigüedad: si el número casa con más de una
  carta, **se omite** (no se adivina). ⚠️ El ingest de **mercado** (`ingestSet`) sigue con el resolver por
  query — anotado como deuda **PI-D1**.
- **Comentarios que el propio pase v1.50.2 invalidó**: `loadGradingContext` decía «6 claves / +1 con `off`,
  +2 con `on`» cuando hoy son **12 claves** y **+3** (config + batch de estimados + batch de slabs de INV-D);
  lo mismo en `pricing.service.ts`. La vitrina decía «mismo `GroupedListingDTO` ⇒ misma teja» cuando tras D2
  la rejilla emite `GroupedListingSummaryDTO`. Y la cabecera de `common/graded-estimate.ts` afirmaba que las
  puras **nunca** ven el origen del número, cuando `isManual` está en el tipo desde la frescura asimétrica:
  ahora dice la verdad **más estrecha y más útil** — `isManual` decide **SI** se emite, nunca **QUÉ**, y no
  viaja al DTO, que es lo que sostiene la indistinguibilidad §4.38g.

### 0.4.6 Trabajo del ARQUITECTO rev v1.50.3 (§4.38(i)) — incorporado en este mismo pase

#### (a) 🔴 Tres seeds que divergían de `PROJECT.md` §O.7 (GU-A17)

| Dial | Antes | Ahora | Por qué |
|---|---|---|---|
| `graded_estimate_manual_freshness_days` | **`null`** | **30** | `null` **derogaba el criterio 109**: un estimado tecleado a mano se quedaba en portada para siempre |
| `graded_estimate_min_sample_count` | 3 | **5** | permisivo: dejaba entrar cifras con 3–4 ventas, el ruido que la cota existe para filtrar |
| `graded_estimate_max_raw_multiple` | 50 | **100** | conservador, y por eso el más difícil de ver: suprimía **sin explicación** las cartas de 50×–100×, que son las que la feature existe para encontrar |

Un seed equivocado **no rompe nada**: no lanza, no falla ningún test de comportamiento, solo hace que el
sistema aplique un criterio distinto del que el producto escribió. Por eso el candado nuevo es sobre **el
valor**, con el número del criterio al lado (`graded-estimate.batch.spec.ts`, «el SEED de `X` es N»).

> ### ⚠️ PARA DEVOPS — el seed corregido **NO llega a una BD ya sembrada**
> `prisma/seed.ts` upsertea con **`update: {}`** (respeta ediciones del admin), así que en cualquier
> entorno que ya corrió el seed las tres filas **conservan el valor viejo**. Verificado: el E2E falló
> contra el stack local hasta fijar el dial explícitamente. **Hace falta una corrección de DATOS
> puntual** antes de considerar cumplidos los criterios 109 y 111(a)/(c):
> ```sql
> UPDATE "ConfigSetting" SET "valueJson" = '30'  WHERE key = 'graded_estimate_manual_freshness_days';
> UPDATE "ConfigSetting" SET "valueJson" = '5'   WHERE key = 'graded_estimate_min_sample_count';
> UPDATE "ConfigSetting" SET "valueJson" = '100' WHERE key = 'graded_estimate_max_raw_multiple';
> ```
> **NO se automatizó como migración a propósito:** M-42 es DATA/seed y `update: {}` existe para no
> pisar decisiones del dueño. Un `UPDATE` incondicional en migración destruiría exactamente lo que esa
> regla protege. Equivalente por API: `PUT /admin/pricing/graded-estimates` con esos tres campos.

**I8-bis:** `manualFreshnessDays: null` **sigue siendo expresable** (es una decisión legítima) pero ya no
es el default, y **desactiva el criterio 109 para la vía manual** ⇒ el resolver emite **`warn`** al izar
la config. No apaga nada: solo lo hace audible. Misma doctrina que «la vitrina no puede vaciarse en
silencio».

#### (b) 🔴 GU-A15 DEROGADA por GU-A16 — el manual SÍ decae; lo que se arregla es el ORDEN

v1.50.2 curó el fallo «gana y luego se tira» **eximiendo al manual del decaimiento**. El **diagnóstico**
era correcto —`isBetterRef` (tier absoluto, §4.27f-2) elegía el manual viejo y **después** la frescura lo
descartaba, dejando la carta sin estimado **pese a haber dato fresco**—, pero el **remedio** derogaba el
criterio 109 en silencio. QA lo reprodujo: una fila manual de **40 días** seguía en la ficha y seguía
promocionándose.

**La clase de fallo no venía del decaimiento: venía de filtrar DESPUÉS de resolver.** Se cierra
invirtiendo el orden dentro de `PricingService.getGradedEstimatesBatch`, **sin tocar `isBetterRef`**:

```
frescas := candidatas.filter(!stale)   // 1) PRIMERO se descarta lo rancio
si frescas vacío -> ese grado NO se emite
pickBestRef(frescas)                    // 2) DESPUÉS gana el mejor (el manual sigue ganando entre las frescas)
```

| Caso | Antes (v1.50.2) | Ahora (v1.50.3) |
|---|---|---|
| manual 200 d + automática fresca | **nada** (fallo silencioso) | **la automática fresca** |
| manual 200 d, sin automática | el manual de 200 d *(⛔ criterio 109)* | **nada** *(✅ criterio 109)* |
| manual 5 d + automática 1 d | gana el manual | gana el manual *(sin cambio)* |

**§4.27f-2 intacto:** es una garantía **money-safe** sobre escrituras y sobre el comparador; el filtro de
frescura es un **predicado de exhibición** que vive **fuera** del comparador y **solo** en la ruta de
lectura del gancho. El override no se borra, no se degrada y no pierde su rango — deja de **exhibirse**
cuando envejece. Se refresca **recapturándolo**, lo que convierte «el dueño puso un número una vez» en
«el dueño **sostiene** ese número».

> **⚠️ BREAKING de FIRMA (interno, `super_admin`):** `getGradedEstimatesBatch(cardIds)` pasa a
> `getGradedEstimatesBatch(cardIds, cfg, today)`. Los tres argumentos son **obligatorios sin default**:
> un parámetro opcional habría sido **fail-open** sobre el criterio 109 —cualquier superficie que lo
> olvidara leería estimados sin filtrar—. Los dos llamadores (`loadGradingContext`,
> `gradedEstimatePreview`) ya izaban `cfg`; el `preview` filtra igual que el storefront a propósito: un
> diagnóstico que mostrara un estimado que la ficha no muestra sería la peor forma de diagnóstico.

#### (c) 🟠 Divergencia NUEVA (§4.38m.2) — contra qué fecha se mide el dato AUTOMÁTICO

**Nadie la había escrito, y era permisiva.** El criterio 109 y §O.7 miden la frescura del dato automático
contra *«la antigüedad de la **evidencia de mercado**, no la fecha en que jalamos el archivo»*. Nuestro
`stale()` mide contra `capturedDate`, que para una fila del ingest **es** la fecha en que jalamos el
archivo.

**El fallo:** el proveedor deja de recibir ventas de una carta pero **sigue sirviendo la misma mediana**;
cada corrida reescribe la fila con `capturedDate = hoy` ⇒ **la cifra parece fresca para siempre**. Es el
feed rancio **disfrazado de fresco por nuestro propio job**.

**Cierre sin DDL: GATE DE EVIDENCIA en la ESCRITURA** (misma técnica que `minSampleCount`).

| `lastSaleDate` en la respuesta | Acción |
|---|---|
| presente y dentro de `freshnessDays` | **escribe** |
| presente y más vieja | **NO escribe** + drop `evidence_too_old` |
| **ausente / no parseable** | **NO escribe** + drop `evidence_unknown` — *«desconocido» no es «fresco»* |

Una fila solo puede refrescar su `capturedDate` mientras su evidencia esté fresca; cuando envejece, el
ingest deja de reescribirla, `capturedDate` **se congela** y la lectura la vence dentro de
`freshnessDays`. **Cota honesta y declarada: ≤ 2 × `freshnessDays` (60 d), NO los 30 literales.** El
cierre exacto es la columna `evidenceDate` de **M-43**.

- El nombre del campo es `lastSaleDate`, con dial de operador **`POKEMONPRICETRACKER_GRADED_EVIDENCE_FIELD`**
  (opcional). **No se sondean alias a ciegas** (P-6): el drop `evidence_unknown` lleva el nombre buscado en
  su muestra cruda, que es lo que permite descubrir el nombre real mirando la traza.
- `GradedIngestResult` gana **`skippedEvidence`**, contado aparte de `skippedSample`: «no hay ventas
  recientes de esta carta» y «la muestra es corta» son diagnósticos distintos.

> ### ⚠️ CONSECUENCIA QUE NECESITA VISTO BUENO DEL ARQUITECTO
> **El shape S2 (`gradedPrices.psaN`, escalar) queda IMPOSIBILITADO de escribir**, porque no trae fecha
> de última venta por construcción ⇒ siempre `evidence_unknown`. Es la aplicación **literal** del
> dictamen («ausente ⇒ no se escribe») y **no inventé una escotilla** para evitarlo, pero la escotilla
> del `count` (`POKEMONPRICETRACKER_GRADED_MIN_COUNT=0`), que existía para que S2 pudiera escribir,
> **deja de alcanzar**. No está vivo (ingest `off`), pero **bloquea encender la fase 2 si el proveedor
> resulta servir S2**. Si la intención era conservar S2, hace falta un dial de evidencia análogo — es
> decisión del arquitecto, no mía.

#### (d) 🟠 `GET /admin/pricing/graded-estimates/review` — la LISTA DE REVISIÓN (criterio 111(e))

`super_admin`, read-only, paginada. **Es la contrapartida de §4.38(k.3):** decidimos **no ocultar** la
cifra incoherente en la ficha, y esa decisión solo se sostiene si alguien puede **enterarse** de que
existe. Sin lista, (k.3) pasaba de «visible-y-corregible» a «visible-y-nadie-la-corrige» — peor que
ocultarla: publicamos el número malo **y** perdemos la señal.

`preview` responde «¿por qué **esta** carta no está destacada?» (exige `cardId`: solo contesta si ya
sospechabas). Esto responde **«¿de qué cartas debo sospechar?»**. **Mismo cálculo, misma pura, mismos
`reason`.**

| Decisión | Comportamiento |
|---|---|
| Conjunto motor | cartas **con fila de estimado** (`distinct cardId`), **no** el catálogo |
| Coste | **constante en queries** (probado por INVARIANZA: 1 carta y 25 cartas ⇒ mismo conteo) |
| Default de `?reason=` | los **tres** de coherencia: `NOT_ABOVE_RAW`, `ABOVE_MAX_MULTIPLE`, `GRADE_ORDER_INVERTED` |
| `SLAB_PUBLISHED` | **opt-in**: es la guarda funcionando, no un dato erróneo; en el default ahogaría la señal |
| Cualquier otro `reason` | **`400`** — son *ausencia* de dato o el gate comercial; `[]` en silencio sería peor |
| Feature `off` | **evalúa igual**, y `FEATURE_OFF` **jamás se emite** (si no, habría que publicar las cifras malas para descubrirlas). `enabled` viaja en la respuesta |
| Config corrupta | **`409 GRADED_CONFIG_INVALID`** nombrando la clave — «apagada» ≠ «corrupta» |
| `GRADED_REVIEW_MAX_SCAN` | 5 000; si se excede, **`truncated: true` + `scannedCards`**. Prohibido truncar en silencio |
| Paginación | default 25, máx 100; fuera de rango ⇒ `400` (jamás un clamp silencioso) |
| Fuera de alcance | «marcar como revisada» (exige DDL) y avisos proactivos — declarado, no colado |

**Código nuevo:** `CatalogService.gradedEstimateReview` + tipos `GradedEstimateReviewItemDTO` /
`GradedEstimateReviewResponse` / `GRADED_REVIEW_*`; ruta en `GradedEstimatesController`;
`GRADED_CONFIG_INVALID` en `error-codes.ts`; `maxRawMultipleInvalid` (INTERNO, no viaja al DTO) en
`GradedEstimateConfig` — existe aparte de `highlightEnabled` porque ése ya está apagado por tres claves y
no permite **nombrar** cuál falló, que es justo lo que el `409` necesita.

**Frontend:** la superficie de M2 es suya (§4.38n.5). **Sin UI el criterio 111(e) no se cumple**:
«aparece en la lista de revisión» es una afirmación sobre lo que el dueño **ve**.

#### (e) Renumeración también en el resto de mis comentarios

Además de lo de §0.4.3, esta rev renumeró **81→99, 85→103, 92→110** en `ARCHITECTURE`/`API_CONTRACT`. En
mi lado no había citas a esos tres; el mapeo completo está en §4.38(o).

### 0.4.7 Resultado de la corrida (2026-08-28, stack nativo de QA en `:3099`/`:3000`)

| Suite | Resultado |
|---|---|
| `npm test` (unitarios) | **199 suites / 2378 tests — verdes** (antes del pase: 2319; **+59** nuevos) |
| `npm run test:integration` (Postgres + Redis reales) | **12 suites / 162 tests — verdes** |
| `npx tsc --noEmit` | limpio |

## 0.3 v1.50.2 — FUSIÓN «pricing v2 (P-48)» × «gancho de grading» (2026-08-28)

> Resuelve el merge de `origin/main` (pricing v2 **ya en producción**) con la rama del gancho, e implementa el
> **dictamen del arquitecto** de `API_CONTRACT` rev **v1.50.2** + `ARCHITECTURE §4.38`. **Sin migración de
> esquema** (M-42 sigue siendo DATA/seed). **Hay un BREAKING pequeño**: ver §0.3.3.
>
> **Renumeración heredada del merge (para que nadie busque donde no es):** mi sección de arquitectura pasó de
> **§4.35 a §4.38** (main ocupó §4.35 con P-47), el seed de **M-41 a M-42**, y `PROJECT` §N a **§O**. Las
> referencias `§4.35` que sobrevivan en el código apuntan a la sección de **main** (fuente por-acabado), no a ésta.

### 0.3.0 Los tres conflictos que NO eran «conservar ambos» (y por qué importan)

`main` **eliminó `backend/src/common/pricing-tiers.ts`** (P-48 §4.36.2 sustituyó las reglas por rareza/acabado por
la CURVA) junto con `computeSalePriceForRarity`, `SalesRule` y `PriceRuleSet`. Tres bloques de imports en conflicto
traían esos símbolos de mi lado: **fusionarlos «conservando ambos» no compila**. Se **borraron**; no había ningún
uso vivo (`TierId` ya solo aparecía en el import). Queda escrito aquí porque el patrón se repetirá: en un merge, un
import que ya no resuelve **no es una preferencia de estilo, es un símbolo muerto**.

### 0.3.1 `gradingHighlight` se MUEVE de `GroupedListingDTO` a `GroupedListingSummaryDTO`

`main` cerró **D2** creando `GroupedListingSummaryDTO` (el DTO de la **rejilla**, construido por **lista blanca**
campo por campo) y dejando `GroupedListingDTO` como el DTO de la **ficha**. Mi campo **se caía de la rejilla en
silencio**: compilaba, y la teja quedaba vacía. El arquitecto dictaminó **moverlo, no duplicarlo** (§4.38e), así que:

- `GroupedListingSummaryDTO` **gana** `gradingHighlight?: GradedEstimateDTO[]` (rejilla de Compra **y** vitrina);
- `GroupedListingDTO` (ficha) **ya no lo lleva** — la ficha informa con `gradedEstimates` en su raíz, que es más
  rico (PSA 10 **y** 9) y **no va gateado**;
- la partición **informar ≠ promover** pasa a sostenerla el **compilador** (dos tipos), no la disciplina.

**Frontend:** eliminar cualquier lectura de `listings[i].gradingHighlight` — hoy es `undefined` **siempre**.

### 0.3.2 INV-FX (§4.38a) — el ingest escribe USD + `fxRate`, JAMÁS el numeral USD en `priceMxnCents`

Las dos vías de escritura de la **misma fila** usan **unidades distintas**: la manual recibe **MXN directo**; el
ingest de fase 2 recibe **USD** de PPT. Confundirlas produce un error de **~19×**, y **en la dirección que menos se
espera**: el numeral en dólares queda ~19× **BAJO**, así que ninguna cota superior lo ve. Por eso hay un escritor
DEDICADO —`PricingService.persistGradedEstimateReference`— que exige `currency` explícito y persiste
`priceUsdCents` + `fxRate` + `fxBufferPct` (igual que `sealed-price-ingest`); `liveMxnCents` recompone al leer.
**El lector público es el mismo en las dos fases y el DTO resultante es idéntico** (indistinguibilidad, §4.38g).

### 0.3.3 ⚠️ BREAKING — `intent` OBLIGATORIO en `POST /admin/pricing/override` con `productType:"graded"`

`intent: "market" | "graded_estimate"`. Sin él ⇒ **`422 GRADED_INTENT_REQUIRED`**; con `graded_estimate` sobre una
carta que tiene **≥1 slab publicado** de ese grado ⇒ **`409 GRADED_ESTIMATE_SLAB_PUBLISHED`** (con `cardId`,
`gradeKey`, `publishedSlabCount` e `inventoryItemIds` en `details`). Con `productType` distinto de `graded` el campo
se ignora.

**Por qué es obligatorio y no opcional-con-default:** la fila del «estimado» y la referencia de mercado real de un
slab PSA publicado **son la misma fila**, así que un `intent` que cayera a `"market"` por omisión sería
**fail-open** — el operador que olvida el campo obtendría, en silencio, la ruta que **mueve dinero**.

> **Migración de llamadores (para QA, devops y cualquier script):** toda llamada que escriba `productType:"graded"`
> **debe** añadir `intent` antes de desplegar, o recibirá `422`. El `intent` se registra en `AuditLog`: es lo
> único que distingue las dos capturas.
>
> ⚠️ **CORRECCIÓN (2026-08-28, tras el gate de QA/techlead).** Esta nota decía *«en este repo ya se actualizó el
> único llamador (el E2E del gancho)»*. **Era falso, y la frase era el problema.** El censo se hizo **solo del
> lado backend**: había **dos llamadores vivos de frontend** —la pestaña «Gradeadas» de M1 y el «Fijar mercado»
> de la consola de variantes— que **devolvían 422 en producción**. Un *breaking* se anuncia por lo que rompe,
> no por lo que uno alcanzó a mirar; declarar cerrado un censo parcial es peor que no censar, porque el
> siguiente rol que lo lea **deja de buscar**. Estado real:
>
> | Llamador | Dónde | Estado |
> |---|---|---|
> | E2E del gancho | `backend/test/integration/graded-estimate.e2e-spec.ts` | ✅ actualizado (backend) |
> | Pestaña «Gradeadas» (M1) | `frontend/` | 🔧 **lo arregla FRONTEND** (rol dueño; ver `FRONTEND_NOTES`) |
> | «Fijar mercado» (consola de variantes) | `frontend/` | 🔧 **lo arregla FRONTEND** (rol dueño) |
>
> **Alcance del censo que sí puedo afirmar:** `backend/` (`src/` + `test/` + `prisma/`). Cualquier script,
> colección de Postman o cliente externo que escriba `productType:"graded"` **sigue sin auditar** — quien lo
> opere tiene que revisarlo antes del deploy.

### 0.3.4 Gate de confianza (§4.38k) — la rejilla exige confiabilidad; la ficha informa

Solo la **rejilla/vitrina** aplica las **tres cotas de magnitud**. **No son redundantes** y hay **una prueba por
cota** para que relajar una rompa su propia prueba:

| Cota | Regla | Qué error ataja |
|---|---|---|
| **inferior** | `psa10 > salePriceCents` | **el error de UNIDADES**: un valor en USD queda ~19× **BAJO** y el múltiplo máximo **no lo ve** |
| **superior** | `psa10 <= salePriceCents × maxRawMultiple` (seed 50) | el **cero de más** / typo al alza |
| **de orden** | `psa10 >= psa9` | el **grado intercambiado** (filas capturadas cruzadas) |

Más **frescura** y **origen confiable** (`minSampleCount`, seed **3**, gateado **en la ESCRITURA** — `PriceReference`
no tiene dónde persistir el `count` sin DDL, y así M-42 sigue siendo DATA/seed puro). La **ficha NO aplica la
magnitud** (§4.38k.3): si el dueño fijó a mano un estimado raro, la ficha se lo **muestra** para que pueda
corregirlo; ocultarlo sería una desaparición silenciosa.

**Frescura asimétrica (§4.38m):** `freshnessDays` **no se aplica a filas manuales** — protege contra un *feed*
rancio, no contra una decisión del dueño. Cierra el fallo silencioso «el manual viejo gana la resolución y luego la
frescura lo tira, dejando la carta sin estimado pese a haber dato fresco». Válvula: `manualFreshnessDays`
(seed `null` = no decae).

### 0.3.5 INV-D (§4.38l) — guarda de ESCRITURA **y** de LECTURA

La de escritura es el `409` de §0.3.3. La de **lectura** (`getPublishedSlabGradesBatch`, **1 query batcheada**) omite
el grado cuando hay slab publicado: es lo único que **neutraliza las filas escritas ANTES de la regla**, que el
`409` por sí solo no alcanza. `reason` del preview: `SLAB_PUBLISHED`.

### 0.3.6 Fase 2 DESBLOQUEADA — parser AUTO-CONFIRMANTE (§4.38h)

El humano preguntó «¿no tenemos algo automático?» y tenía razón: **P-6 prohíbe asumir un esquema, no automatizar**.
El parser (`pokemonpricetracker-bulk.provider.ts › fetchGradedEstimatesForSet`) **sondea las dos hipótesis**
(`ebay.salesByGrade.psaN` objeto / `gradedPrices.psaN` escalar) y **solo persiste lo que identifica positivamente
como monto**; ante cualquier otra forma **no escribe nada** y registra la **muestra cruda**. La primera corrida real
confirma el formato **con cero datos malos en la BD**.

- `includeEbay=true` (2 créditos/carta) **junto a** `fetchAllInSet=true`; **truncate del log de muestra 800 → 4000**
  (con 800 el bloque PSA se corta y da un **falso negativo**);
- **alcance: solo cartas con inventario RAW publicado** + tope duro `ingestMaxCardsPerRun` (seed 250);
- se publica la **MEDIANA** (`sourceStat`, seed `median`): una venta atípica desplaza el promedio, y
  `smartMarketPrice` es una derivación propietaria no documentada;
- overrides del operador `POKEMONPRICETRACKER_GRADED_FORMAT` / `_GRADED_FIELD` **mandan sobre la autodetección**: si
  se fijan y la respuesta no casa, **no se escribe nada** (caer al otro shape derrotaría su intención). Escotilla
  `POKEMONPRICETRACKER_GRADED_MIN_COUNT=0` para aceptar `count` desconocido a sabiendas;
- **dial propio** `graded_estimate_ingest_enabled` (seed `off`), independiente del de exhibición: se puede rodar el
  ingest **en observación con la vitrina apagada**;
- **traza obligatoria** (log + `AuditLog`) por carta saltada — sin ella el descarte por muestra baja sería invisible
  (el `preview` lo vería como `NO_PSA10`, porque la fila no existe).

> ⛔ **ESCALADA IMPLEMENTADA COMO COMPORTAMIENTO (regla 9).** Si `includeEbay=true` **no** combina con
> `fetchAllInSet=true` (4xx del proveedor, o ninguna entrada con bloque PSA), el job **PARA**, lo registra y
> devuelve `escalation`. **NO** se implementó el modo «una petición por carta»: eso cambia el modelo de coste y
> obliga a un ingest **curado por lista** — decisión de **arquitectura y presupuesto**, no de implementación.

### 0.3.7 Coste por request — **+1 con el dial `off` / +3 con `on`** (cifra del contrato, medida)

| Superficie | `off` | `on` |
|---|---|---|
| `GET /catalog/cards` (rejilla y vitrina) | **+1** | **+3** |
| `GET /catalog/cards/:cardId` (ficha) | **+1** | **+3** |
| Resto del sistema | 0 | 0 |

`+1` = la config (las **12** claves en UN `findMany`); `+3` = esa + `getGradedEstimatesBatch` +
`getPublishedSlabGradesBatch`. **Constante**: no depende del nº de grupos, de cartas ni de acabados. El test cuenta
**TODAS** las queries del request, no solo las de graded — contar un subconjunto fue exactamente lo que dejó pasar
el `+7` histórico.

### 0.3.8 Deuda saldada en este pase

- **BE-GE2 — la bitácora del `PUT /admin/pricing/graded-estimates` entra a la transacción** (paridad con
  v2.1.6/P48-B1): antes se escribía **después** del commit, así que una excepción entre commit y `audit.log` dejaba
  **config de dinero cambiada y sin registro**. Ahora efecto y bitácora **commitean o revierten juntos**. Efecto
  lateral necesario: el `after` se **computa** (no se re-lee) porque un lector con otra conexión no vería lo aún no
  commiteado; hay test que verifica que ese `after` coincide con lo que un `GET` posterior devuelve.
- **Comentario de `getGradedEstimatesBatch`**: el rango citado de `getReferencesBatch` estaba obsoleto. Hoy es
  **`pricing.service.ts:688-730`** (en `main`, antes de la fusión, `:588-631`). **La justificación se re-verificó y
  sigue siendo literalmente cierta** — sigue armando el `WHERE` como producto cartesiano y filtrando en memoria.

### 0.3.9 Diales nuevos (M-42, DATA/seed — se siembran solos por `SETTING_DEFAULTS`)

| Key | Seed | Se edita en |
|---|---|---|
| `graded_estimate_manual_freshness_days` | **`null`** (no decae) | M2 `PUT /admin/pricing/graded-estimates` |
| `graded_estimate_max_raw_multiple` | `50` | M2 (mismo `PUT`) |
| `graded_estimate_min_sample_count` | `3` | M2 (mismo `PUT`) |
| `graded_estimate_source_stat` | `median` | M2 (mismo `PUT`) |
| `graded_estimate_ingest_max_cards_per_run` | `250` | M2 (mismo `PUT`) |
| `graded_estimate_ingest_enabled` | **`off`** (fail-closed) | **M10** `PUT /admin/settings` |

**Para devops:** ninguna env nueva es obligatoria. Las de fase 2 son **opcionales y con default seguro**:
`POKEMONPRICETRACKER_GRADED_FORMAT` (`auto`), `POKEMONPRICETRACKER_GRADED_FIELD`,
`POKEMONPRICETRACKER_GRADED_MIN_COUNT`, `POKEMONPRICETRACKER_GRADED_MARKET_FORMAT` (si falta, se usa
`POKEMONPRICETRACKER_MARKET_FORMAT`; **sin ninguno de los dos el ingest NO persiste nada**).

### 0.3.10 Tests de este pase

Nuevos: `test/graded-estimate.confidence-gate.spec.ts` (una prueba **por cota** + el caso **USD-como-MXN** +
INV-D en lectura + la asimetría de frescura), `test/pricing.graded-intent.spec.ts` (`422`/`409` y que **no se
escribe nada** al rechazar), `test/graded-estimate.ingest.spec.ts` (parser: S1/S2, formas no reconocidas, gate de
`count`, overrides del operador, truncate 4000, **escalada**), `test/graded-estimate.inv-fx.spec.ts` (INV-FX byte a
byte + alcance/tope/INV-D del job). Actualizados: los cuatro specs del gancho, los dos de forma de DTO de `main`
y el E2E (nuevo caso **3b** de INV-D contra el stack vivo).

**Resultado local (2026-08-28):** `npm test` → **199 suites / 2319 tests verdes**; `npm run test:integration`
(Postgres + Redis reales) → **12 suites / 160 tests verdes**; `npx tsc --noEmit` limpio.

## 0.2 v1.50-graded-estimate — «Gancho de grading»: valor estimado si se gradea (2026-08-23, rama `claude/psa-graded-card-value-gmhv5u`)

> Implementa `API_CONTRACT` rev **v1.50-graded-estimate** + `ARCHITECTURE §4.38` (PROJECT §O v2.0).
> **SOLO FASE 1 (manual-first).** **Sin migración de esquema**: M-42 es **DATA/seed** (12 `ConfigSetting` tras v1.50.2).
> Cambio **aditivo**: ningún endpoint/DTO existente cambia de forma, ningún monto de dinero cambia.

### Qué se implementó (y dónde)

| Pieza | Archivo |
|---|---|
| Puras del gancho (gate de ROI, escalones, frescura) | `backend/src/common/graded-estimate.ts` **(NUEVO)** |
| Batch dedicado + config izada | `backend/src/modules/pricing/pricing.service.ts` (`getGradedEstimatesBatch`, `loadGradedEstimateConfig`, `loadGradedEstimateConfigForAdmin`) |
| Composición ficha/teja/vitrina + diagnóstico | `backend/src/modules/catalog/catalog.service.ts` (`buildGroups`, `getCard`, `listCards`, `gradedEstimatePreview`) |
| Query params `?gradingHighlight=` y `?sort=grading_showcase` | `backend/src/modules/catalog/catalog.controller.ts` |
| Diales M2 + preview (`GET/PUT /admin/pricing/graded-estimates[/preview]`) | `backend/src/modules/catalog/graded-estimates.controller.ts` **(NUEVO)** |
| `SettingKey` + defaults + validadores (I1–I9) | `backend/src/modules/settings/settings.constants.ts` |
| 4 códigos de error nuevos | `backend/src/common/error-codes.ts` |

**Fase 1 = sin mecanismo de captura nuevo:** los estimados se fijan con el endpoint **YA existente**
`POST /admin/pricing/override` (`productType:"graded"`, `gradeKey:"graded:PSA:10"|"graded:PSA:9"`, `finish`
omitido ⇒ `normal`), que escribe **exactamente** la clave canónica que lee el storefront
(`cardId, 'graded', 'graded:PSA:{10,9}', finish='normal', cardProductId=null`). **Una fila, dos lectores:** es
la MISMA fila que alimenta `GradedInventoryGroupDTO.marketReferenceMxnCents` de M1 › Gradeadas (deliberado, §4.38b).

### Reglas que el backend garantiza (para QA y frontend)

- **Partición INFORMAR ≠ PROMOVER:** `gradedEstimates` (ficha, nivel CARTA, **sin** gate) vs `gradingHighlight`
  (teja/vitrina, nivel GRUPO, **con** gate). Una carta puede informar en la ficha y **no** estar destacada.
- **Presencia ⇔ elegibilidad:** no existe `eligible:false` ni `[]`. Si no hay nada que mostrar, **el campo se omite**.
- **SEC-A1:** el DTO público **no transporta** `multiplier`, `upsideMxnCents`, `netUpside*`, `gradingCost*`,
  `minUpsidePct`, `threshold` ni `reason`. Los insumos existen **solo** en
  `GET /admin/pricing/graded-estimates/preview`.
- **`source` se omite SIEMPRE** en `GradedEstimateDTO.estimate` — y no por convención: el batch devuelve un tipo
  (`GradedEstimateRef`) que **no tiene** `source` ni `isManualOverride`, así que ninguna rama de composición puede
  bifurcar por origen. Fase 1 y fase 2 son **indistinguibles byte a byte** (test ejecutable, ver abajo).
- **Money-safe:** `estimate.status` siempre `"priced"`; un estimado `<= 0` no existe; `costMxnCents >= 1` jamás 0.
- **Fail-closed on-read — `AUSENTE ≠ INVÁLIDA` (GU-A8, v1.44.1).** El lector distingue **tres** estados por clave:

  | Estado de la clave | `grading_cost_tiers` | `minUpsidePct` / `freshnessDays` / `grades` / `highlightGrades` |
  |---|---|---|
  | **Válida** | se usa | se usa |
  | **AUSENTE** (nunca escrita) | `[]` ⇒ `NO_COST_TIER` ⇒ nada se destaca | **seed** (estado del primer deploy, antes de M-42) |
  | **PRESENTE pero INVÁLIDA** | `[]` ⇒ nada se destaca | **nada se destaca** — NO cae al seed |

  Un valor **corrupto es evidencia de que la intención del admin se perdió**, así que no se adivina. **Alcance
  diferenciado del apagado:** `minUpsidePct`/`highlightGrades` inválidos apagan **teja + vitrina** y la **ficha
  sobrevive**; `freshnessDays`/`grades` inválidos apagan **también la ficha** (sin umbral de frescura confiable no se
  puede afirmar que una cifra esté vigente). El COSTO **nunca** tiene default de código, en ningún estado.
  Ver «Correcciones post-revisión» para el porqué y los dos huecos que esto cerró (R1 y GU-A8).
- **Escalones `[min, max)`** contiguos con último abierto (I1–I5), validados en **cada** `PUT` y **también al leer**.
- **Doctrina (b) intacta:** las filas PSA no fijan `listPriceCents`, no publican inventario, no entran en
  `getPricedRawFinishesBatch`/`pricedFinishesSnapshot`/`availableFinishes`, no encolan `PendingPriceEntry`, no valúan
  portafolio/P&L y no tocan el buylist. **No se escribió NINGÚN write nuevo**: la feature es lectura + config.
- **Dial M10 `gradedEstimatesEnabled` (seed `off`)**: con `off` no se lee ni la config restante ni la tabla de
  precios (**0 queries extra**), no se emite ninguno de los dos campos y `?gradingHighlight=true` ⇒ `{data:[],total:0}`.
  **Encenderlo publica una afirmación comercial**: requiere el visto bueno del humano sobre el disclaimer (§O.5).

### Coste por request (invariante de diseño) — **CIFRA CORREGIDA (IMPORTANTE-2)**

> ⚠️ **Para el arquitecto:** la cifra que `API_CONTRACT` publica («+1 query constante») **cuenta solo la query de
> precios** e ignora las lecturas de settings, que también son queries del request. El número **real y medido**
> es el de esta tabla. **Yo no edito el contrato** (regla 9): pido al arquitecto que corrija la cifra a
> **+1 con el dial `off` / +2 con el dial `on`**.

| Superficie | Queries TOTALES añadidas (settings + precios) |
|---|---|
| `GET /catalog/cards` (teja) y `?gradingHighlight=true` (vitrina), dial `on` | **+2** constantes (1 config + 1 batch) |
| `GET /catalog/cards/:cardId` (ficha), dial `on` | **+2** constantes |
| Dial `off`, o sin piezas raw en el conjunto | **+1** (solo la config; **0 queries de precios**) |
| Resto del sistema (`/catalog/sealed*`, `/vault/*`, checkout, buylist, facets, sets) | **0** — no se tocaron |

La **config de las 6 claves va en UNA sola query** (`SettingsService.getRawMany` → un `findMany` con
`key IN (...)`). Antes eran **6** lecturas sueltas (1 `findUnique` del dial + 5 `getRaw()`, y `SettingsService`
**no cachea**), es decir **+7 reales con el dial `on`** frente al «+1» publicado. Sigue siendo **O(1)** respecto
del tamaño de la página, y hay test que lo mide contando **todas** las queries del request, no solo las de
`productType='graded'` (`composition.spec.ts` › «IMPORTANTE-2»).

El batch es **dedicado** (`getGradedEstimatesBatch`) y **no** reusa `getReferencesBatch`: ese método arma el `WHERE`
como producto cartesiano de los conjuntos distintos y filtra en memoria, así que mezclar raw+graded provocaría
over-fetch combinatorio sobre la tabla más caliente. Filtra por `cardProductId: null` explícito y reusa
`pickBestRef`/`isBetterRef` (precedencia `override manual > ingest`, **dentro** de la tabla) y `liveMxnCents` (FX).

### Decisiones de implementación (y desviaciones menores, para techlead/arquitecto)

1. **`getGradedEstimatesBatch` devuelve `Map<cardId, GradedEstimateRef[]>`**, no el
   `Map<cardId, {psa10?: PriceInfo; psa9?: PriceInfo}>` literal de §4.38c. Motivo: (a) el tipo literal **hardcodea
   los grados**, y todo el diseño busca que añadir/quitar un grado sea editar un dial; (b) `PriceInfo` transporta
   `source`/`isManualOverride`, y **no llevarlos** es lo que hace estructuralmente imposible filtrar la fase.
   Semántica y coste idénticos (1 query, mismo desempate, mismo FX).
2. **Los 3 endpoints M2 viven en `CatalogModule`** (`graded-estimates.controller.ts`), no en `PricingController`:
   el `/preview` necesita componer los **grupos raw publicados** (`CatalogService`) y `CatalogModule` ya importa
   `PricingModule` — al revés sería un ciclo (`forwardRef`). Las **rutas** son exactamente las del contrato.
3. **`GET /admin/pricing/graded-estimates` devuelve la config EFECTIVA** (ya saneada fail-closed). Si el admin ve
   `gradingCostTiers: []`, **esa** es la explicación de por qué nada se destaca. La variante de admin lee la config
   completa **aunque el dial esté `off`** (si no, el editor de M2 no podría preparar la tabla antes de encender).
4. **`PUT` con body vacío ⇒ `422 VALIDATION_ERROR`** (el contrato no lo especifica): un `PUT` que no cambia nada
   sería un no-op auditado y confuso. Validación **todo-o-nada**: nada se escribe si algo falla — y desde la
   corrección **D4** la ESCRITURA también es atómica (`prisma.$transaction` sobre los upserts; antes era un bucle
   suelto que podía dejar la config a medias).
5. **`highlightGrades ⊆ grades` se valida contra el ESTADO RESULTANTE** (mezcla de lo enviado con lo vigente), no
   solo contra el body: editar `grades` sin tocar `highlightGrades` no puede dejar un badge huérfano. También se
   aplica **en lectura**.
6. **`GradedEstimatePreviewDTO.capturedDate` (singular)** = el **más antiguo** de los grados presentes (el que manda
   para la frescura); `null` si no hay ninguno. El contrato lo declara singular sin decir cuál.
7. **`today` = fecha de negocio CDMX** (`businessDateCdmx`, `Intl`, date-only). `POST /admin/pricing/override`
   escribe `capturedDate` a medianoche **UTC**, así que puede quedar un día «adelantado» respecto a CDMX: un
   `capturedDate` futuro **es fresco** por regla explícita de §4.38c (no es rancio).
8. **El `/preview` sí lee el batch con el dial `off`** (devuelve `reason: FEATURE_OFF`): si no, el diagnóstico sería
   inútil justo en el estado por defecto. Es admin-only y read-only.

### Correcciones post-revisión (QA rechazó / techlead aprobó con condiciones) — 2026-08-23

| # | Origen | Qué estaba mal | Qué se hizo |
|---|---|---|---|
| **BLOQUEANTE** | QA | `graded-estimate.e2e-spec.ts:108` escaneaba `JSON.stringify(ficha.body)` **entero** buscando `isManualOverride`. El campo que encontraba vive en `listings[].referenceValue` / `units[].referenceValue` — el `PriceInfo` del precio **raw**, **pre-existente** (verificable en `origin/main`), no una fuga del gancho. | La aserción de INDISTINGUIBILIDAD se **acota a los dos campos del gancho** (`gradedEstimates` + los `gradingHighlight` de los grupos). Los insumos del gate (`netUpside`, `gradingCost`, `threshold`, `minUpsidePct`, `eligible`) **siguen escaneándose sobre el body completo**: esos tokens sí son exclusivos de la feature. Mismo patrón corregido en `composition.spec.ts` (donde pasaba **por accidente del fixture**: el precio raw estaba en `pending`, así que no había `source`), + un test nuevo con el precio raw **priceado** que demuestra que el body SÍ trae `isManualOverride` y el gancho NO. |
| **R1** | techlead | El fail-closed **no cubría la clave AUSENTE**: `sanitizeGradingCostTiers` se alimentaba de `settings.getRaw()`, que hace fallback a `SETTING_DEFAULTS`, así que sin fila el resolver veía los 6 escalones del seed y **el gate corría normal** — contra `ARCHITECTURE §4.38d`, el docstring de `graded-estimate.ts` y esta misma nota. | **Camino (a): se corrige el CÓDIGO, no la doctrina.** Nuevo `SettingsService.getRawMany(keys)` que devuelve **solo las filas existentes** (una clave ausente no aparece en el `Map`). `grading_cost_tiers` se lee de ahí **sin** pasar por `SETTING_DEFAULTS` ⇒ ausente = `undefined` ⇒ tabla `[]`. **§4.38d ya dice esto, así que NO hace falta enmienda del arquitecto.** Impacto en prod: **nulo** (`prisma/seed.ts` siembra una fila por cada `SETTING_DEFAULTS`, así que la clave existe); lo que cambia es el caso degradado (BD sin seed / fila borrada). Test añadido: clave ausente ⇒ `[]`, tanto en el resolver como en la variante de admin. |
| **R2** | techlead | `getCard` pasaba `productType: hasPublishedRawGroup ? 'raw' : 'graded'` — un **centinela** que mentía en un parámetro de dominio para forzar `[]`. | **Guarda explícita**: `grading && hasPublishedRawGroup ? … : []`, y la llamada pasa `productType: 'raw'` siempre. |
| **MENOR-1** | QA | El umbral usaba `Math.ceil(costBase * (1 + pct/100))`. Con el default 30 no hay desviación, pero `minUpsidePct` admite `[0,1000]` y con p. ej. `pct=10, costBase=100000` el umbral exacto es 110000 y el cálculo daba **110001**: una carta cuyo PSA 9 **iguala** el umbral quedaba fuera, contra el «si y solo si ≥» del criterio 79. | **Aritmética entera**: se compara `psa9 × 100 >= costBase × (100 + pct)`. El `Math.ceil` sobrevive solo para el `thresholdMxnCents` del **diagnóstico de admin**, y ambos siguen coincidiendo por construcción. Tests: caso de **igualdad exacta** + barrido `pct × costBase × {umbral−1, umbral, umbral+1}` que comprueba que `eligible` y `thresholdMxnCents` nunca se contradicen. |
| **IMPORTANTE-2** | QA | El «+1 query constante» publicado era en realidad **+7** con el dial `on` (1 `findUnique` + 5 `getRaw()` sin caché + el batch), y el test solo contaba las queries con `productType==='graded'`, así que no lo veía. | Se **colapsa la config a UNA query** (`getRawMany`, las 6 claves en un `findMany`): coste real **+1 con `off` / +2 con `on`**. Tests reescritos para contar **todas** las queries del request y medir el DELTA `on − off` a dos tamaños de página. **Pendiente del arquitecto: corregir la cifra en `API_CONTRACT`** (yo no lo edito). |
| **D3** | techlead | I7 duplicado: `gradeList()` del controller re-implementaba `validateGradeList()` de `settings.constants.ts`. | **Arreglado** (no anotado): el controller ahora **envuelve** el validador compartido y solo aporta la forma del error (422 + `details.field`). |
| **D4** | techlead | El `PUT` escribía en un **bucle de `upsert` sin transacción** mientras esta nota prometía «todo-o-nada»; y el `before` auditado salía de la config **saneada**, así que auditar un valor corrupto registraba `[]` y perdía el forense. | **Arreglado** (no anotado): upserts dentro de `prisma.$transaction`, y la entrada de bitácora lleva `before.storedRaw` = los valores **tal cual estaban almacenados** (claves ausentes omitidas, corruptas intactas). |
| **D1** | techlead | Instrumentación de fase 2 no implementada. | **Anotada en `docs/TECH_DEBT.md`** (ligada a BE-6). Sigue bloqueada por doctrina P-6; ver abajo. |
| **GU-A8** | techlead (P1) → arquitecto (§4.38d rev v1.44.1) | La excepción de seed para los umbrales se justificaba con «sin tabla no hay gate», pero eso **solo vale si AMBAS claves fallan**. Con `grading_cost_tiers` **válida** y `grading_min_upside_pct` **corrupto**, el gate caía al seed **30** aunque el admin hubiera puesto **200**: más permisivo que su intención, **en silencio**, en la superficie que promociona. Igual con `freshnessDays` (un 7 configurado se volvía 30 y mostraba como vigente un dato ya rancio). | Implementada la regla normativa **`AUSENTE ≠ INVÁLIDA`** con sus tres estados (tabla arriba) y **alcance diferenciado del apagado**. Detalle de diseño abajo. |

#### Cómo quedó implementado GU-A8 (para techlead/QA)

- **Tres interruptores en `GradedEstimateConfig`, no uno**, con el invariante `highlightEnabled ⇒ estimatesEnabled ⇒
  enabled`:
  - **`enabled`** — sigue siendo el **ESPEJO READ-ONLY del dial M10**, tal como lo define el contrato. **Una clave
    corrupta NO lo apaga**: si lo apagara, el DTO de admin mentiría sobre el estado del dial. El admin se entera por
    el `warn` y por el `reason`.
  - **`estimatesEnabled`** — gobierna `selectGradedEstimates` (**la ficha**). Falso con el dial `off` o con
    `grades`/`freshnessDays` presente-e-inválida.
  - **`highlightEnabled`** — gobierna `evaluateGradingHighlight` (**teja + vitrina**). Falso además con
    `minUpsidePct`/`highlightGrades` presente-e-inválida.
- **Los dos flags nuevos son INTERNOS y NO viajan al contrato.** `GradedEstimateConfigDTO` es una forma cerrada, así
  que se añadió la proyección explícita **`toGradedEstimateConfigDTO()`**, aplicada en `GET`, en el `after`/`before`
  del `PUT` y en el `config` del `/preview`. Antes esas tres superficies devolvían el objeto interno **tal cual**, así
  que cualquier campo que el resolver ganara se filtraba al contrato sin querer; ahora no puede pasar (hay test que
  fija las 6 claves exactas del DTO).
- **`grading_cost_tiers` corrupta sigue produciendo `NO_COST_TIER`, no `FEATURE_OFF`** — mismo efecto (nada se
  destaca) pero **diagnóstico más preciso** para el admin. También se loguea con `warn`.
- **`warn` obligatorio** (`PricingService.warnInvalidGradedEstimateKey`) con **la clave y el invariante violado**, y
  con la acción correctiva. **Una clave AUSENTE no loguea nada** (el primer deploy no es una anomalía). *Nota
  operativa para devops:* la config no se memoiza entre requests, así que una clave corrupta emite un `warn` **por
  request** mientras dure; es un estado de emergencia que solo se alcanza por edición fuera de banda y el ruido es la
  señal deseada, pero conviene saberlo antes de que sorprenda en los logs.
- **Este camino solo se alcanza por edición fuera de banda** (SQL directo, restore parcial, migración a medias): el
  `PUT` de M2 rechaza lo inválido con `422`. Cubierto también en E2E (test **8b**), que corrompe la clave con
  `prisma.configSetting.upsert` directo y verifica el alcance diferenciado contra la app real.

### NO implementado a propósito (pendiente de decisión)

- **Instrumentación de fase 2 (§4.38h, paso 1) — D1, anotada en `docs/TECH_DEBT.md` y ligada a BE-6:**
  `POKEMONPRICETRACKER_INCLUDE_EBAY` y subir el truncate del log de muestra de `800` → `4000` chars en
  `pokemonpricetracker-bulk.provider.ts:209`. El alcance de esta sesión excluía explícitamente tocar los providers
  de PokemonPriceTracker. **Detalle crítico:** con el truncate en **800** la observación de staging produce un
  **falso negativo** («el proveedor no manda PSA» cuando sí lo manda) — o sea, **el gate que desbloquea la fase 2
  está saboteado por ese número**. Es cambio de observabilidad, no de dinero.
- **Ingest automático (fase 2 completa):** BLOQUEADO por doctrina P-6 (Gate 0 del 2026-08-23). No se escribió ni un
  parser. Cuando se desbloquee, **no cambia el contrato ni el frontend**: escribe la misma clave canónica.

### Diales (M-42 — DATA/seed, sin DDL)

| Key | Seed | Se edita en |
|---|---|---|
| `graded_estimate_grades` | `["10","9"]` | M2 `PUT /admin/pricing/graded-estimates` |
| `graded_estimate_highlight_grades` | `["10"]` | M2 (mismo `PUT`) |
| `graded_estimate_freshness_days` | `30` | M2 (mismo `PUT`) |
| `grading_cost_tiers` | tabla §O.2.1 (6 escalones `[min,max)`) | M2 (mismo `PUT`) |
| `grading_min_upside_pct` | `30` | M2 (mismo `PUT`) |
| `graded_estimates_enabled` | **`off`** (fail-closed) | **M10** `PUT /admin/settings` |

Los seis se siembran solos por `SETTING_DEFAULTS` (`npm run seed` los hace `upsert` sin pisar cambios del admin).
**Para devops: ninguna env nueva en fase 1.** Las tres de fase 2 siguen sin cablear (§4.38h).

### Tests (unitarios, `npm test` en `backend/`)

- `test/graded-estimate.gate.spec.ts` — puras: bordes de escalón `[min,max)`, tabla con hueco/vacía/desordenada/
  costo 0 ⇒ **jamás costo 0**, I1–I5 con su código, frescura (borde exacto, fecha futura, fecha corrupta), ficha vs
  gate, y la partición (subir `minUpsidePct` no apaga la ficha).
- `test/graded-estimate.batch.spec.ts` — batch: 1 sola query con la clave canónica, sin `source` en la salida,
  desempate determinista, FX recomputada, `<= 0` descartado; config fail-closed en dos niveles.
- `test/graded-estimate.composition.spec.ts` — servicios REALES (Settings+Pricing+Catalog) sobre Prisma en memoria:
  ficha vs teja, dos acabados (gate por grupo), dial off, vitrina (filtro, orden, `400`s), SEC-A1, doctrina (b),
  criterio 90 y el **test de indistinguibilidad** (`manual` vs `pokemonpricetracker` ⇒ JSON idéntico).
- `test/graded-estimate.admin.spec.ts` — `GET/PUT/preview`: I1–I7 con código, todo-o-nada, auditoría
  (`pricing.graded_estimates.update`, before/after), `enabled` ignorado en el `PUT`, criterio 86 y los `reason`.
- **GU-A8** añade en `batch.spec.ts` el bloque «AUSENTE ≠ INVÁLIDA» (los **tres estados** de cada clave + la
  observabilidad: `warn` con clave e invariante, y **silencio** cuando la clave está ausente) y en
  `composition.spec.ts` el bloque de **alcance diferenciado** sobre la ruta de request completa (`minUpsidePct`
  corrupto ⇒ ficha viva / vitrina apagada; `freshnessDays` y `grades` corruptos ⇒ ambas apagadas), incluido el
  **escenario del hallazgo** (tabla válida + umbral corrupto ⇒ NO promociona con el seed 30).
- **Resultado local (tras las correcciones de QA/techlead + GU-A8, 2026-08-23):** `npm test` → **175 suites /
  1790 tests, todo verde** (antes de esta feature: 171/1679; tras la primera ronda de correcciones: 175/1771).
  `npm run typecheck` limpio; `npm run lint` con 0 errores y 1 warning **preexistente**.
  Nota: `test/inv1-sales-rule-propagation.spec.ts` necesitó añadir `configSetting.findMany` a su Prisma mock (la
  config del gancho ya no usa `findUnique`); es el único spec ajeno al gancho que tocaron estas correcciones.

### E2E (para QA — requiere Postgres real)

`test/integration/graded-estimate.e2e-spec.ts` **(NUEVO)** cubre el flujo crítico de §O.7 punta a punta:
override manual → dial `off` (nada se emite, vitrina `[]`) → dial `on` (ficha informa, teja promueve, vitrina lista)
→ `400 GRADING_SORT_REQUIRES_FILTER` → `/preview` con los insumos → invariantes del `PUT` → subir `minUpsidePct`
vacía la vitrina **sin mover el precio de venta** → apagar el dial deja el catálogo como antes. Usa el fixture
`E2E-LST-0002` (`e2e-common`, publicado a MX$600). Restaura el estado global (dial `off`, `minUpsidePct` 30, borra
las filas PSA) en el `afterAll` porque la BD es compartida.
**+ test 8b (GU-A8):** corrompe `grading_min_upside_pct` con un **`prisma.configSetting.upsert` directo** (el único
camino que llega a ese estado, porque el `PUT` da 422) y verifica el **alcance diferenciado** contra la app real —
la vitrina se vacía y la ficha **sigue** mostrando sus dos cifras, ningún precio se mueve, el `/preview` responde
`reason: FEATURE_OFF`— y luego **restaura** la config sana con un `PUT` válido (el camino de salida del operador).

**Ejecutada y VERDE (2026-08-23, tras el fix de la aserción y GU-A8)** contra Postgres + Redis reales:
`npx jest --config test/jest-integration.config.js --runInBand` → **11 suites / 136 tests, todo verde**
(`graded-estimate.e2e-spec.ts`: **10 tests**). Correr con `npm run test:integration` tras `docker compose up -d` +
`npm run seed:synthetic`; requiere `DATABASE_URL` y `REDIS_URL` en el entorno (`prisma migrate deploy` los exige).
Sin MinIO levantado, `infra-smoke` **avisa y salta** el PUT real (no falla).

### Notas para frontend

- ⚠️ **ACTUALIZADO en v1.50.2 (ver §0.3.1):** el campo de la teja/vitrina vive ahora en
  **`GroupedListingSummaryDTO.gradingHighlight?`** (la REJILLA), **no** en `GroupedListingDTO` (la ficha).
  Ése (teja/vitrina, **gateado**) y `GroupedListingDetailResponse.gradedEstimates?`
  (ficha, **sin gatear**) son **arreglos del mismo tipo**. **Iterar leyendo `gradeValue`**; prohibido asumir
  `[0] === PSA 10` o longitud fija (hoy la ficha trae 2 y el badge 1, pero es un dial).
- **Campo ausente ⇒ no se pinta NADA** (ni contenedor, ni skeleton, ni `—`, ni `$0`, ni «pendiente»). Prohibido
  `…?.[0]?.estimate.referenceMxnCents ?? 0`. Nunca llega `[]` ni `eligible:false`.
- `estimate` es un `PriceInfo` con **solo** `status:"priced"`, `referenceMxnCents` y `capturedDate` (sin `source`).
- La vitrina es `GET /catalog/cards?gradingHighlight=true&sort=grading_showcase&pageSize=8`; `data: []` **es** la
  señal de «no renderizar la vitrina completa». `sort=grading_showcase` **sin** el filtro ⇒ `400`.

## 0.1 P47-2 (§4.27f-2, v1.46): override MANUAL = tier superior ABSOLUTO y durable cross-day — comparador **+ capa de lectura + ficha 360°** (2026-08-24)

> Rama `fix/variant-composition-regression`. Cierra el hallazgo ALTA **P47-2** (dictamen del arquitecto,
> contrato **v1.46 §4.27f-2**). **Money-critical. Sin migración, sin cambio de schema ni de forma de contrato.**
> Es un fix de **precedencia de LECTURA**: no re-resuelve ni re-escribe nada — la siguiente lectura de las
> mismas filas elige la correcta. No toqué el provider TCGCSV singles de P47-1 (cerrado, commit 03f0e02).
>
> **⚠️ CIERRE EN DOS PARTES.** El fix del comparador (commit b16f03d, §0.1.a) era correcto pero **incompleto**:
> el re-gate (techlead RECHAZADO + seguridad NO-CERRADAS) encontró que la **durabilidad cross-day se rompía en la
> CAPA DE LECTURA** (blocker #1) y en la **ficha 360° admin** (blocker #2). Ambos corregidos abajo (§0.1.b/§0.1.c).

### 0.1.a — Comparador `isBetterRef` (commit b16f03d, primera mitad del fix)

**El bug:** en `isBetterRef(a, b)` (`pricing.service.ts`) `capturedDate` se comparaba **antes** que el tier
manual/no-manual. Efecto: un override manual solo ganaba **el mismo día**; al día siguiente una fila automática
`tcgcsv_singles` de HOY superseemplazaba el override manual de ayer → la decisión humana se perdía sin que el
admin la tocara (money-losing).

**El fix (una función, `isBetterRef`):** se **iza** la comparación `manual/no-manual` **por encima** de
`capturedDate`. El override manual (`isManualOverride === true` **o** `source === 'manual'`) es ahora **tier
superior ABSOLUTO y durable cross-day**: gana SIEMPRE sobre una automática, sin mirar la fecha. El resto del
desempate queda **intacto DENTRO del tier**, en este orden: (2) `capturedDate` más fresca; (3) `sourceRank`
(precedencia de fuente, mismo día); (4) `cardProductId` NULLS LAST (variante resuelta gana); (5) cuid lexicográfico
(estabilidad). **Importante:** NO se izó `sourceRank` por encima de `capturedDate` — hacerlo dejaría que una
`tcgcsv_singles` **stale** le ganara a un residuo **fresco** (money-losing distinto). Comentario/doc del método
actualizado a «tier manual absoluto, durable cross-day».

**Alcance de consumo:** `isBetterRef`/`pickBestRef` alimentan `getReference`, `getReferenceByCardProduct`,
`getReferencesBatch`, `getSeparateProductsByCard` (pricing) y `computeSetValue` (catalog). Todos heredan la nueva
precedencia sin cambios propios.

**Tests (money-safe):** nuevo `backend/test/pricing.isbetterref-manual-tier.spec.ts` — (a) override manual VIEJO
gana sobre `tcgcsv_singles` de HOY; (b) dos automáticas de distinta fecha → gana la más fresca; (c) override
manual nuevo supersede al viejo; + guard money-safe (una `tcgcsv_singles` stale NO le gana a un residuo fresco) y
desempate por fuente a igual día. Ningún test existente codificaba el bug viejo (el de determinismo M-31 que
compara «fecha domina» usa dos filas automáticas, sigue válido).

### 0.1.b — Capa de lectura: el override manual es **candidata PERENNE** (blocker #1, money) — 2026-08-24

**El hueco (por qué b16f03d no bastaba):** `getReference` (~L307) y `getReferenceByCardProduct` (~L350) traían las
candidatas con `orderBy capturedDate desc … take: SAME_DAY_REF_CANDIDATES (=32)`. El override manual se persiste con
`capturedDate` **FIJO** (`manualOverride()`) y **no se re-fecha**; el barrido diario `tcgcsv_singles` añade ~1 fila
automática/día para la misma clave y **no hay purga** de `PriceReference`. Tras ~32 días la fila manual cae **fuera
del top-32** → `pickBestRef` **nunca la ve** → el comparador (por bueno que sea) no puede elegirla → el feed diario
vuelve a pisar el precio humano **en silencio**. El comparador estaba bien; la **ventana de lectura** lo saboteaba.

**Approach elegido — lectura DIRIGIDA de manuales unida al bloque reciente (opción a del dictamen).** En `getReference`
y `getReferenceByCardProduct` la lectura ahora hace **DOS queries en paralelo** (`Promise.all`):
1. **bloque reciente CAPADO** (`take: 32`, `orderBy capturedDate desc`) — cubre el **tier automático** sin traer el
   histórico entero (la cota sigue siendo money-safe para automáticas: solo las recientes pueden ganar entre sí);
2. **lectura DIRIGIDA de manuales** (`MANUAL_REF_PREDICATE = { OR: [isManualOverride:true, source:'manual'] }`),
   **SIN cota de fecha ni `take`**, misma clave. Garantiza que **TODA** fila manual de la clave esté siempre entre
   las candidatas, sin importar cuántos barridos automáticos se acumulen.

`pickBestRef([...bloqueReciente, ...manuales])` desempata el conjunto unido (duplicados idempotentes). En `getReference`
la lectura dirigida se combina con `BASE_CARD_REF_WHERE` vía **`AND`** (no spread) para no colisionar con el `OR` de
`BASE_CARD_REF_WHERE`. **Por qué esta opción y no «quitar el cap»:** preserva la cota en el hot path single-item para el
tier automático (no reintroduce un escaneo de historial ilimitado en cada `getReference`), y **expresa el invariante en
código** («el manual es candidata perenne», f-2) de forma auto-documentada. Es exactamente lo que sugirió el blue team.

**Consistencia con los métodos SIN cap:** `getReferencesBatch` y `getSeparateProductsByCard` **ya** leían sin `take`
(todas las filas de la clave, incluidas las manuales) y reducían con `isBetterRef` → **ya eran durables**; no se
tocaron. La asimetría que reportó seguridad (batch durable, single-item no) queda cerrada: ahora los cuatro coinciden.
Nuevo export `MANUAL_REF_PREDICATE` en `pricing.service.ts`. Comentario de `SAME_DAY_REF_CANDIDATES` reescrito para f-2
(la cota gobierna SOLO el tier automático; el manual es perenne).

### 0.1.c — Ficha 360° admin `ownedItemRefs` usa `pickBestRef` (blocker #2, consistencia) — 2026-08-24

**El bug:** `AdminService.ownedItemRefs` (`admin.service.ts` ~L307) elegía «la primera vista» por `capturedDate desc,
createdAt desc` (`if (!latest.has(key)) latest.set(key, r)`), **NO** `isBetterRef`. Bajo P47-2 eso mostraba la
**automática más fresca** aunque existiera un override manual durable → la ficha 360° **divergía de `getReference`**
para la misma variante. Su query **no** lleva `take` (lee todas las refs por `cardId`), así que las filas manuales ya
estaban presentes: bastaba **reducir con la precedencia correcta**.

**El fix:** se reemplaza la reducción «primera vista» por `cur == null || isBetterRef(r, cur)` (mismo patrón que
`set-value.service.ts` y `getReferencesBatch`). Se importa `isBetterRef` desde `pricing.service`. Sin query nueva, sin
cambio de forma del DTO `AdminUserOwnedItemRef`.

### 0.1.d — Tests money-safe añadidos + resultado

- **`backend/test/pricing.isbetterref-manual-tier.spec.ts`** (b16f03d, comparador puro): sigue verde.
- **`backend/test/pricing.manual-override-durable-cross-day.spec.ts`** (NUEVO): escenario **>32 días** — 1 fila manual
  vieja (enero) + 40 automáticas `tcgcsv_singles` más frescas para la misma clave; el mock de Prisma modela FIELMENTE
  las dos lecturas (la capada `take:32` **excluye** la manual vieja; la dirigida la trae). `getReference` **y**
  `getReferenceByCardProduct` devuelven el **override manual** (no la automática fresca). + control negativo del mock
  (la capada sola no ve la manual), + sin regresión del tier automático (gana la más fresca), + dos manuales → gana el
  más reciente.
- **`backend/test/admin.owned-item-refs.manual-override.spec.ts`** (NUEVO): con override manual durable viejo +
  automática fresca, la ficha 360° (`getUser` → `ownedItems[].referenceValue`) muestra el **precio manual**; sin manual,
  la automática más fresca (sin regresión).
- **Suite existente actualizada:** `pricing.getreference-determinism.spec.ts` — el test «lectura acotada» asertaba
  `findManyArgs.toHaveLength(1)` (una sola query, premisa del diseño viejo); ahora aserta las **dos** lecturas (capada
  con `take` + dirigida sin `take`). El resto de sus asserts (determinismo M-31) intactos y verdes.
- **Resultado real:** suite backend COMPLETA **176 suites / 1717 tests verdes** (1710 previos + 7 nuevos). Typecheck
  `tsc --noEmit` limpio.

## 0.2 P-47 (§4.35, v1.44): el barrido diario reprecia por-acabado desde TCGCSV `tcgcsv_singles` (2026-08-23)

> Rama `fix/variant-composition-regression`. Continúa el fix P-47 de 0.3: tras cerrar el aplanamiento de PPT,
> el barrido diario quedó **sin fuente por-acabado** (PPT solo produce la impresión primaria). Implementa el
> dictamen del arquitecto (**§4.35**, contrato **v1.44**): el barrido pasa a repreciar **por-acabado** desde
> **TCGCSV `tcgcsv_singles`**. **Money-critical. Sin migración** (M-31 ya trae `cardProductId`/`tcgcsv_singles`).
> **Sin cambio de forma de contrato.** No toqué config/env (eso es de devops: `PRICE_PROVIDER=tcgcsv_singles`,
> `POKEMONPRICETRACKER_FETCH_PRINTINGS=false` en staging→prod).

**Qué se implementó (todo en `backend/`):**

- **Provider nuevo `TcgcsvSinglesBulkPriceProvider`** (`backend/src/modules/pricing/providers/tcgcsv-singles-bulk.provider.ts`),
  `implements BulkPriceProvider`, `source='tcgcsv_singles'`. `fetchPricesForSet({set})`: resuelve el `groupId`
  TCGCSV (S-D3: `pptSetId` entero → groupId; si no, match ÚNICO por nombre), hace `getProducts`+`getPrices`,
  `deriveCardProductsFromTcgcsv(...)`, y hace el **join EXACTO por `CardProduct.tcgplayerProductId`** (lee
  `cardProduct.findMany`, NUNCA escribe estructura). Emite un `BulkPriceRow` por `(cardProductId, finish,
  marketCents>0)` con `cardId`/`cardProductId` ya resueltos (campos nuevos opcionales en `BulkPriceRow`,
  poblados **solo** por este provider). Money-safe: `marketPrice` null/≤0 ⇒ **omite** la fila (jamás el precio
  de otro acabado, jamás 0); `subTypeName` desconocido ⇒ omitido (`deriveCardProductsFromTcgcsv`); `productId`
  sin `CardProduct` local (estructura no resuelta) ⇒ omitido (dependencia §4.35b: primero `--force` del set);
  fallo remoto ⇒ `requestOk:false` + 0 filas (precios previos **STALE**, no se borran).
- **Registro en `providerFor()`/`PRICE_PROVIDER`** (`price-ingest.service.ts`): `tcgcsv_singles` entra a la
  lista de providers (con filtro anti-`undefined` para los mocks de tests que no lo inyectan) y a
  `PRICE_PROVIDER_VALUES` (`settings.constants.ts`). **El default del seed sigue en `pokemontcg_io`** — el flip
  del dial es de devops. El provider se registra en `PricingModule` (+ su `TcgcsvCatalogClient`, cliente
  anti-SSRF compartido, stateless).
- **Camino DEDICADO `ingestSinglesForSet`** (`price-ingest.service.ts`): cuando `providerFor().source ===
  'tcgcsv_singles'`, el barrido va por un método propio que **solo repreciar** — upsert de `PriceReference`
  keyed por `cardProductId` vía `persistMarketReference(cardId, finish, {..., source:'tcgcsv_singles'}, fx,
  cardProductId)`, FX Banxico del snapshot (USD→MXN+colchón), respetando `isManualOverride`. **NO** comparte el
  colapso `(cardId, finish)` del flujo PPT (que perdería la granularidad por-producto de M-31) ni el bloque
  `pricedFinishesSnapshot`+`FinishReconciler`. **NO** escribe `CardProduct.finishes`/`Card.availableFinishes`
  (la ESTRUCTURA sigue gateada a import/`--force`, §4.27d).

**Precedencia (§4.27f, confirmada, sin cambios):** `sourceRank` ya pone `tcgcsv_singles=1` (sobre PPT=2) e
`isBetterRef` prefiere la fila con `cardProductId` no nulo. Como el reprecio TCGCSV escribe con `cardProductId`
y PPT escribe con `cardProductId=null`, **la fila por-acabado de TCGCSV gana** sobre cualquier residuo de PPT.
Así «PPT LIST fallback-only» se cumple por PRECEDENCIA de lectura: donde TCGCSV tiene precio, gana; PPT solo
«se ve» donde TCGCSV no tiene fila.

**Decisión de mecanismo (para techlead/QA):** el arquitecto ofreció dos vías equivalentes (§4.35b): (A) swap de
provider en `price-ingest`, o (B) job hermano tipo `sealed-price-ingest`. Elegí **(A)** (recomendación del
arquitecto + requisito «registrar en `providerFor()`»), PERO con un **branch dedicado** dentro de `ingestForSet`
en vez de reusar el pipeline PPT. Razón money-safe: el pipeline PPT agrupa por `(cardId, finish)` y correría el
bloque de estructura (`snapshot`+`reconcile`) a diario; ambos son incorrectos para singles (M-31 necesita
granularidad por `cardProductId`, y §4.35 prohíbe re-resolver estructura a diario). El branch dedicado deja el
flujo PPT/pokemontcg.io **100% intacto** (cero regresión) y aísla el reprecio por-cardProduct.

**Tests (nuevos):**
- `backend/test/tcgcsv-singles-bulk.provider.spec.ts` (8 casos): 3 acabados con markets DISTINTOS ⇒ 3 filas con
  su precio; acabado sin precio (null/0) ⇒ omitido (no copia); `subTypeName` desconocido ⇒ omitido; 2 productos
  de la misma carta ⇒ `cardProductId` distinto; producto sin `CardProduct` ⇒ omitido; fallo remoto ⇒
  `requestOk:false`; groupId por `pptSetId` y por nombre.
- `backend/test/price-ingest.singles.spec.ts` (9 casos): dial → provider primario; 3 upserts keyed por
  `cardProductId` con `source='tcgcsv_singles'`+FX; **NO** escribe `availableFinishes`/snapshot ni reconcilia;
  productos distintos de la misma carta no colisionan; fila sin `cardProductId`/`marketCents≤0` ⇒ omitida;
  fetch fallido ⇒ nada persiste; `persistMarketReference` con `cardProductId`: FX+colchón, source correcto,
  **override manual NO se pisa**.
- Suite backend completa: **1701/1701 verde**, `tsc --noEmit` limpio.

**No es hueco, es la separación (§4.35b):** un set **nunca resuelto** bajo M-31 se queda en PPT/`PRICE_PENDING`
hasta un `POST /admin/catalog/sync {setId, force:true}` (runbook de devops, §4.27h) — el reprecio diario solo
cotiza variantes cuya `CardProduct` ya existe.

## 0.3 BUG DE DINERO: el barrido por-impresión de PPT aplanaba el mercado a todos los acabados (2026-08-23)

> Rama `fix/variant-composition-regression`. BUG money-critical confirmado: el barrido de precios mostraba
> el MISMO `market` en `normal`=`reverse_holo`=`holofoil` de una misma carta. Fix interno del provider PPT,
> **sin cambio de contrato**. Money-safe reforzado: acabado sin precio propio ⇒ **pendiente/«—»**, jamás el
> precio de otro acabado.

- **CONFIRMACIÓN — ¿la API v2 de PPT expone un `market` DISTINTO por impresión (`?printing=`)? NO.** El shape
  real v2 (documentado en el propio provider, L104-107, y usado por el modo LISTA y por `mapFreshEntry`) es
  `prices = { market, primaryPrinting, low, lastUpdated }`: **un solo `market`**, el de la impresión PRIMARIA
  de la carta, **invariante al `?printing=`**. No hay un `market` por impresión en ninguna parte del payload.
  Por tanto el modo `fetchPrintings` es **estructuralmente incapaz** de producir precio por-acabado real: las
  3 pasadas (Normal/Reverse Holofoil/Holofoil) traen el mismo `prices.market`.
- **Causa raíz.** `PokemonPriceTrackerBulkProvider.mapEntry`, rama `forced` (modo por-impresión), atribuía
  `e['prices'].market` (nivel carta = primaria) a la **ETIQUETA del request** (`forced.label`). Como las 3
  pasadas traen el mismo market, las 3 filas `PriceReference` (`normal`/`reverse_holo`/`holofoil`) quedaban
  con el MISMO precio. La fuente por-acabado correcta (TCGCSV `tcgcsv_singles`, `CardProductResolverService`,
  precedencia §4.27f `sourceRank=1` sobre PPT `sourceRank=2`) **solo corre en import/`--force`, no en el
  barrido diario** → en el sweep diario ganaban las filas aplanadas de PPT.
- **Fix aplicado (`backend/src/modules/pricing/providers/pokemonpricetracker-bulk.provider.ts`, rama `forced`
  de `mapEntry`, antes L560-564).** El market SIEMPRE pertenece a `prices.primaryPrinting`, así que ahora solo
  se emite fila cuando la impresión primaria REAL de la carta (leída del dato, no de la etiqueta) **coincide**
  con la etiqueta barrida — ese es el único acabado cuyo precio PPT conoce. Los demás acabados **NO se emiten**
  (quedan pendientes/«—»), NUNCA con el precio de otra impresión. Sin `primaryPrinting` legible ⇒ no se emite
  nada. Nuevo helper `extractPrimaryPrinting`. Las filas emitidas siguen `forcedPrinting: true` /
  `finishAliasVerified: false` (excluidas del `pricedFinishesSnapshot`, §4.25a-2 — sin cambio).
- **Test que enmascaraba (`pokemonpricetracker-bulk.fix-ppt.spec.ts`, caso (3), antes L84-109).** Hardcodeaba
  3 markets distintos (1/2/3) por impresión — suposición FALSA que la API real no cumple. Reescrito: las 3
  pasadas devuelven el MISMO market con `primaryPrinting` de la carta; se afirma que **NO se aplana** (solo la
  primaria recibe precio; las otras quedan pendientes). Añadidos (3-money) [primaria Normal ⇒ solo `normal`,
  reverse/holo pendientes] y (3-nomarket) [sin `primaryPrinting` ⇒ 0 filas]. Suite 1685/1685 verde, `tsc` limpio.
- **⚠️ PARA EL ARQUITECTO (regla 9, decisión de estrategia de FUENTE — NO asumida).** Este fix detiene el
  aplanamiento (money-safe), pero deja el barrido diario **sin fuente que pueble el precio por-acabado de
  reverse/holo**: hoy `tcgcsv_singles` (la fuente por-acabado con precedencia) solo corre en import/`--force`,
  no en el sweep diario (`PriceIngestService.ingestAll`). Consecuencia esperada tras el deploy: reverse/holo
  de cartas cuya única corrida reciente fue el sweep quedarán en **PRICE_PENDING** hasta el próximo
  import/`--force` (correcto y fail-closed, pero puede ampliar la cola de pendientes). **Decisiones que
  requieren al arquitecto:** (a) ¿correr `CardProductResolverService`/`tcgcsv_singles` dentro del sweep diario
  de singles (o un job hermano) para que el precio por-acabado se refresque a diario?; (b) ¿mantener el modo
  `fetchPrintings` de PPT, que ahora cuesta ~3× por set para producir a lo sumo 1 fila (la primaria, que el
  modo LISTA ya da a 1× costo) — o desactivarlo (dial `POKEMONPRICETRACKER_FETCH_PRINTINGS`) por redundante?
  La §4.25a-2 de `ARCHITECTURE.md` asume que `fetchPrintings` «produce la `PriceReference` propia de la
  reverse» — premisa que este hallazgo **contradice** (la API no da market por impresión); conviene corregir
  esa sección. No toqué el dial ni el flujo de fuentes (fuera de mi autoridad).

## 0.2 Fix name-match de grupos sellados: tolerancia al prefijo de código de TCGCSV (2026-08-23)

> Rama `fix/variant-composition-regression`. BUG confirmado: sets reales NO auto-resolvían su grupo de
> TCGCSV, así que no bajaban presentaciones (boxes/ETB/etc.). Fix interno de resolución, **sin cambio de
> contrato**.

- **Causa raíz.** `matchScore` en `backend/src/modules/inventory/sealed-product.service.ts` comparaba el
  nombre local vs el del grupo con `normalizeSetName` DIRECTO. TCGCSV nombra los grupos con **prefijo de
  código de colección** («SV08: Pitch Black» → `sv08pitchblack`), mientras el catálogo local (pokemontcg.io)
  NO («Pitch Black» → `pitchblack`). No empataban → caía a 0.5 (contención), por debajo del umbral 0.9 de
  `bestSetMainMatch` → «sin grupo resoluble» → no se poblaba `set_main` ni presentaciones.
- **Fix (`sealed-product.service.ts:782`, método `matchScore`).** `matchScore` ahora compara vía `setNameCandidates`
  (reusado de `pricing/ppt-set-mapper.service.ts:145`, ya existente), que incluye el nombre completo Y —si
  trae prefijo tipo `SV08:`/`ME05:`— también el nombre SIN prefijo. Exacto = intersección no vacía entre las
  variantes del set local y las del grupo → mantiene la escala de año existente (1.0 mismo año / 0.9 sin año
  confirmable / 0.7 año distinto); contención parcial sigue 0.5; sin match 0. No se duplicó normalización.
- **Money-safe / no adivina (INTACTO).** `bestSetMainMatch` (`:803`) NO cambió: auto-resuelve el
  `set_main` SOLO si el mejor score es **≥ 0.9 y ÚNICO en el tope**. El fix SUBE los matches legítimos
  (mismo nombre, distinto prefijo) al rango auto-resoluble, pero si dos grupos empatan tras quitar prefijo
  (base + reprint del mismo set, mismo año) → siguen empatados en el máximo → devuelve **null** (lo cura el
  humano a mano). No inventa precios (eso va aparte).
- **Efecto colateral (positivo).** El mismo `matchScore` alimenta el endpoint de candidatos
  (`GET …/sync/candidates`, `:596`): la UI de curación ahora muestra el grupo prefijado con score real
  (≥0.9) en vez de 0.5.
- **Tests (`test/sealed-product.service.spec.ts`, describe «matchScore — tolerante al prefijo…»):**
  (1) «Pitch Black» vs «SV08: Pitch Black» mismo año → score ≥0.9 y `sync` auto-puebla `tcgcsvGroupId`+`set_main`;
  (2) sin prefijo: exacto+año=1.0, año distinto=0.7, contención=0.5 (comportamiento previo intacto);
  (3) empate tras quitar prefijo (dos «… Pitch Black» mismo año) → NO auto-resuelve (`groupId` null);
  (4) set inexistente en TCGCSV → 0 candidatos, sin auto-resolución. Suite backend 1683/1683 verde, `tsc --noEmit` limpio.

## 0.1 Incidente prod: forgot-password no entrega correo — `trust proxy` ausente (2026-08-23)

> Rama `fix/variant-composition-regression`. El humano usó forgot-password en prod y NO llegó correo,
> mientras el correo de VERIFICACIÓN de registro SÍ le había llegado. Diagnóstico de raíz abajo.

- **Transporte idéntico, no es el proveedor.** Verificación (`sendVerificationEmail`, `auth.service.ts:124`)
  y reset (`forgotPassword`, `auth.service.ts:195`) usan el MISMO `MailService`→`MAIL_PORT` (Resend),
  ambos **síncronos en-request**, sin cola/BullMQ. Si la verificación entrega, el proveedor/dominio/API key
  funcionan. La diferencia está en los GATES de forgot-password, no en el envío.
- **Causa raíz (código) — `trust proxy` no estaba seteado.** `main.ts` creaba la app sin `app.set('trust proxy', …)`.
  Detrás del edge de Railway, Express ignora `X-Forwarded-For` → `req.ip` (y `@Ip()`, el `requestIp` que se
  persiste en `AuthToken`, y la **clave de tracking del `ThrottlerGuard`**) resuelven a la IP del PROXY, igual
  para todos los clientes. Cada `@Throttle` por-IP colapsa en un único cubo por-instancia. El endpoint con la
  ventana más estrecha de la app — `POST /auth/forgot-password` = **@Throttle 3/HORA** (`auth.controller.ts:88`,
  vs login 5/min) — se agota con tráfico mínimo y devuelve **429**, que el front presenta como el 200
  anti-enumeración genérico → el correo de reset **nunca se intenta**. Explica por qué verificación (register
  5/min, volumen bajo) funcionó y forgot-password no. **Fix:** `app.set('trust proxy', 1)` en `main.ts`
  (1 salto = edge de Railway; sin Cloudflare delante del backend, DEVOPS_NOTES §23.2/§25.3). Corrige además la
  exactitud de `AuthToken.requestIp` y del logging por IP.
- **Multi-instancia (devops):** el storage del throttler es in-memory por instancia (`app.module.ts:38`). Con
  varias instancias, cablear storage compartido (Redis) para que el límite sea global-consistente.
- **Gates silenciosos secundarios de forgot-password** (por diseño, pero enmascaran fallos): sin-usuario
  (`:196`), `status!==active` (`:198`), tope 3/h/email (`:199-200`), y el `try/catch` que traga el error de
  Resend y responde 200 (`:211-213`). El `audit.log auth.password_reset_requested` se escribe DENTRO del try
  DESPUÉS del envío (`:205`) → en fallo de envío NO queda rastro auditable, solo `logger.error` en Railway.
  **Recomendación (no implementada, requiere criterio de arquitecto/seguridad):** registrar el intento y el
  fallo de envío en AuditLog para que prod tenga señal consultable; y considerar un health-check de correo
  (hoy `/health` solo cubre DB, `health.service.ts`).
- **Tests:** `test/auth.throttle.spec.ts` fija el candado 3/hora de forgot-password (ventana más frágil).
  Suite auth verde (20/20), `tsc --noEmit` limpio.

## 0.0 Regresión del gate E2E pre-publicación de inventario (2026-08-23) — 2 BLOQ resueltos + 1 escalado al arquitecto

> Rama `fix/variant-composition-regression`. El gate E2E marcó 3 bloqueantes de dinero/identidad en el
> módulo inventario. **BLOQ-1 y BLOQ-2 (parte primaria) corregidos** (fixes de implementación conformes al
> contrato). **BLOQ-3 y las partes secundarias de BLOQ-2 NO se tocan: contradicen cláusulas «fuera de alcance
> cambiarlo» del contrato/ARCHITECTURE → requieren decisión del arquitecto (regla 9)** — ver «Discrepancias».
> Gate: **suite backend completa VERDE** (164 suites / 1625 tests), `tsc --noEmit` limpio.

- **BLOQ-1 (DINERO) — el alta por lote perdía `acquisitionCostCents`.** `BatchInventoryItemInput` no declaraba
  el campo (`backend/src/modules/inventory/dto/inventory.dto.ts:146`), así que con `ValidationPipe({whitelist:true})`
  el costo enviado por el cliente se borraba en silencio y toda pieza de lote (QuickAdd / sellado con «Comprar»)
  nacía con `acquisitionCostCents = NULL`. **Fix:** se añadió `@IsOptional() @IsInt() @Min(0) acquisitionCostCents?`
  con las MISMAS reglas que `CreateItemDto` (`@Min(0)`: un costo 0 es legítimo — promo/regalo — a diferencia de un
  precio de venta). El path de servicio ya leía (`resolveCommon`, `inventory.service.ts:365-366`) y persistía
  (`buildItemData` `:748`, resultado de lote `:861`) el campo; solo faltaba el decorador del DTO. Money-safe: NO se
  inventa costo alguno; sin costo el campo sigue `null`. **Cubierto por** `backend/test/inventory.batch.spec.ts`
  (`[BLOQ-1] persiste acquisitionCostCents…`, `…=0 se persiste como 0`, y 2 casos de validación del DTO que afirman
  que el campo queda whitelisted y no se borra).

- **BLOQ-2 (IDENTIDAD «Tropius») — el sellado se pintaba con nombre/imagen de la carta ancla en M1.**
  `sealed-graded.service.ts` (`sealedSetDetail`, antes `:297`) construía `productName` SOLO desde `Card.name`,
  saltándose la cascada de display del contrato (§4.34a / §M1 v1.36 L187-188: `sealedProductName ?? card.name`,
  `sealedImageUrl ?? card.imageSmallUrl ?? null`). **Fix:** se traen `sealedProductName`/`sealedImageUrl` al
  `groupBy` (snapshot por-identidad, sin N+1) y `imageSmallUrl` de la carta al `select`; el DTO
  `SealedInventoryGroupDTO` aplica ahora la MISMA cascada exacta que `sealed-catalog.service.ts`/`vault.service.ts`
  y **gana `imageSmallUrl`** (que el contrato §M1 v1.28.1 L3723 ya exigía y faltaba en el código). Money-safe:
  cambio de display puro; conteos y valuación intactos (las filas se re-colapsan por la identidad §4.23).
  **Cubierto por** `backend/test/inventory.sealed-graded-tabs.spec.ts` (`cascada de display: sealedProductName…
  ganan a la Card ancla`, y el caso de fallback money-safe sin snapshot).
  - **Vistas de bóveda del cliente/admin YA estaban bien:** `/vault/sealed` (`vault.service.ts:293-294`, cascada) y
    `/admin/vaults/:userId/sealed` (`admin-vaults.service.ts:54` reusa `sealedTab` — fuente única). No requerían
    cambio. Los otros dos síntomas que reportó el gate (ver Discrepancias) NO son este código.

### 0.0.b BLOQ (DINERO) — doble fila «FIJAR PRECIO» en la cola M2 del sellado (2026-08-23, `fix/variant-composition-regression`)

> Bug de dinero **pre-existente** (no lo introdujo esta rama). Fix de IMPLEMENTACIÓN conforme a v1.42/v1.43
> (§4.34a / §4.23a); NO cambia contrato. Suite backend completa **VERDE** (169 suites / 1661 tests),
> `tsc --noEmit` limpio.

- **Causa raíz confirmada:** subir un sellado SIN `listPriceCents` generaba **dos** `PendingPriceEntry` open para
  la MISMA pieza:
  - El **alta** (`inventory.service.ts` `createItem`, bloque `sealedNeedsEscalate`) escalaba con el gradeKey
    LEGACY `'sealed'` (de `gradeKeyFor`) y SIN `sealedProductId` → llamada de 6 args.
  - El **publish** (`resolvePublishSalePrice`, ~`:1135`) escala con la clave de MERCADO `sealed:tcg:<productId>` +
    `sealedProductId` → llamada de 8 args.
  - Como la clave de dedupe de `escalatePending` es `(cardId, productType, gradeKey, finish, cardProductId,
    sealedProductId, status)`, las dos difieren en `gradeKey` **y** `sealedProductId` → NO colapsan → 2 filas.
  - El resolver del sellado (`resolvePublishSalePrice` `:1128-1129`, `getSealedMarketRef` `:641`) consume
    `sealed:tcg:<productId>`, NO el legacy `'sealed'`. Y «FIJAR PRECIO» (`POST /admin/pricing/override`,
    `pricing.controller.ts:180`) escribe el `PriceReference` con el `gradeKey` de la fila M2 elegida. Si el admin
    fijaba sobre la fila legacy `'sealed'`, el override quedaba en un gradeKey que el resolver **ignora** → la pieza
    seguía impublicable (dinero parado + confusión: el admin creía haber fijado el precio).

- **Fix (1 archivo de lógica):** `backend/src/modules/inventory/inventory.service.ts`, `createItem` (bloque
  `sealedNeedsEscalate`, ~`:275`). La escalación del ALTA ahora unifica su firma con la del publish: computa
  `pendingGradeKey = sealedMarketGradeKey(r.sealedMapping.tcgplayerProductId)` cuando la pieza está mapeada, y pasa
  `finish='normal'`, `cardProductId=null` y `sealedProductId=r.sealedProductId`. Así alta y publish producen la
  MISMA clave lógica → **UNA sola** entrada resoluble por `(item / sealedProductId / clave de mercado)`, la que el
  resolver SÍ consume. Sellado LEGACY sin mapeo (sin `tcgplayerProductId`) cae de forma segura a `gradeKey='sealed'`
  con `sealedProductId=null` — comportamiento previo preservado, sin duplicar.
- **La ruta de APORTACIÓN ya estaba bien** (escalaba con `sealedPendingGradeKey`=clave de mercado + `sealedProductId`
  desde BLOQ-2b): esta ruta y el bloque `sealedNeedsEscalate` son mutuamente excluyentes (la aportación sin mercado
  lanza `PRICE_PENDING` desde `resolveCreation` antes de llegar al bloque). Solo el path COMPRA sin `listPrice`
  disparaba el legacy.
- **Money-safe intacto:** sin `listPriceCents`, sin override manual y sin mercado ⇒ **una (1)** entrada
  `PRICE_PENDING`, jamás 0. Fijar el override manual sobre esa entrada (misma clave `sealed:tcg:<id>`) publica la
  pieza (precio derivado `mercado×spread`, `>0`).
- **Saneo de datos:** NO se incluyó script. Riesgo bajo/acotado y no trivialmente idempotente sin conocer el estado
  real de staging (habría que casar cada `PendingPriceEntry gradeKey='sealed'` con la pieza `sealedProductId` viva y
  su `tcgplayerProductId`, re-mapear al gradeKey de mercado y cerrar/mover sin inventar precios). **Runbook de saneo
  manual** (para pendientes legacy YA existentes de piezas con `sealedProductId`): por cada
  `PendingPriceEntry status='open' AND gradeKey='sealed'` cuya pieza asociada tenga `sealedProductId` (y por ende
  `tcgplayerProductId`), (a) fijar el precio a través de la fila **resoluble** `sealed:tcg:<tcgplayerProductId>` (la
  que crea el publish) — nunca sobre la legacy — y (b) marcar la fila legacy como `resolved`/descartada. Declarado
  como **deuda menor NO bloqueante** (no re-crea filas nuevas tras el fix; solo limpia residuos previos). Se anota a
  petición del techlead en `docs/TECH_DEBT.md` si procede.
- **Tests (NUEVO `backend/test/inventory.sealed-pending-dedup.spec.ts`, `escalatePending` REAL + dedupe completa):**
  - alta (compra) sin `listPrice` con `sealedProductId` → **exactamente 1** pendiente open con
    `gradeKey='sealed:tcg:777'` + `sealedProductId='sp-etb'` (afirma `!= 'sealed'`).
  - tras `bulkPublish` de esa pieza → sigue **1** (no 2); `pendingPriceEntry.create` llamado 1 sola vez; la línea
    devuelve `PRICE_PENDING` + el `pendingPriceEntryId` de esa única fila.
  - `manualOverride` sobre esa entrada (misma clave) → la resuelve (cola open = 0) y el re-`bulkPublish` publica
    (`ok:true`, `status:'listed'`, `priceSource:'derived'`, `salePriceCents>0`).
  - caso legacy sin `sealedProductId` (mapeado por `tcgplayerProductId` del cliente): escala con `sealed:tcg:<id>` +
    `sealedProductId=null`, 1 sola fila, money-safe.
  - `test/inventory.sealed.spec.ts` (legacy unmapped) actualizado: la aserción de `escalatePending` ahora espera los
    dos trailing args `null, null` (firma unificada; gradeKey sigue `'sealed'` — comportamiento preservado).

### Discrepancias con el contrato — ESCALADAS AL ARQUITECTO (no implementadas; regla 9)

Tres puntos del gate resultan **cambios de contrato**, no fixes de implementación: el código ACTUAL ya cumple
lo que el contrato/ARCHITECTURE declaran, y esos documentos marcan explícitamente el comportamiento pedido como
**«fuera de alcance cambiarlo»**. No los toqué (no puedo «arreglar» el contrato por mi cuenta):

- **BLOQ-3 (CONTEO) — «excluir `productType='sealed'` de los conteos del master-set binder».** El contrato
  **API_CONTRACT §M1 (nota de coexistencia v1.23, L2302-2303)** y **ARCHITECTURE §4.20b (L4407-4408)** dicen
  textualmente: *«las piezas selladas siguen apareciendo en `GET /vault/holdings` (por-pieza) y en el binder
  master-set como `finish=normal` (comportamiento pre-existente §4.20b — **fuera de alcance cambiarlo**)»*. La
  **regla H9** que cita el hallazgo aplica SOLO al **catálogo de singles** (`GET /catalog/cards`/`facets`,
  guardarraíl `CatalogService.singlesPublishedWhere`, TECH_DEBT H9/SB-D5), **no** al binder. Por tanto excluir el
  sellado del binder (`MasterSetService.binder`/`aggregateInventoryBySet`, `master-set.service.ts`) **contradice el
  contrato**. → Arquitecto: decidir si el binder debe excluir sellado y actualizar §4.20b + la nota v1.23. Backend
  implementa en cuanto el contrato lo permita (el filtro es un `AND productType != 'sealed'` acotado, análogo a H9).

- **BLOQ-2 secundario (a) — «Mis piezas» del cliente muestra el sellado como la carta ancla.** «Mis piezas» =
  `GET /vault/holdings` (front `VaultView.tsx:289-292` pinta `h.card.name`/`h.card.imageSmallUrl` directo). El
  `HoldingDTO` (contrato L2216-2222) **no tiene** campo de display de sellado, y la MISMA nota v1.23/§4.20b lo
  declara «fuera de alcance cambiarlo». Exponer el nombre/imagen del sellado aquí exige **añadir campos al
  HoldingDTO** → cambio de contrato. → Arquitecto.

- **BLOQ-2 secundario (b) — la cola de precio pendiente de M2 etiqueta «E2E Charizard #4 · sealed».** La cola
  (`PricingService.pendingQueue`, `pricing.service.ts:1080`) devuelve `card {name,number,setName}` de la carta
  ancla; el `PendingPriceEntry` (contrato L4821) **no porta identidad de sellado** y su `gradeKey` para un sellado
  SIN mapear es el legacy `'sealed'` (sin `productId`), por lo que **ETB y blíster del mismo set anclados a la
  misma carta colapsan en UNA entrada** → es **ambiguo** qué nombre mostrar sin un campo nuevo. Esto es
  exactamente el terreno de **SB-D5** (entidad `SealedProduct` diferida). Resolverlo requiere que el arquitecto
  defina cómo `PendingPriceEntry` lleva la identidad del sellado → cambio de contrato/schema. → Arquitecto.
  *(Money-safe entretanto: es solo un label; ningún precio se inventa.)*

## 0. Pago de deuda técnica backend (2026-08-23) — 4 ítems RESUELTOS, money-safe intacto

> Pase de deuda (solo `backend/`). Cierra `H-P38-4`, `P-34 H4`, `P-34 H5`, `P-30 H2` de `TECH_DEBT.md`.
> Sin cambio de contrato ni de schema; sin cambio de comportamiento money-safe. Gate: **suite unit+contrato
> completa VERDE** (164 suites / 1615 tests), typecheck y lint limpios.

- **`variantKey(...)` (NUEVO helper compartido)** — `backend/src/common/variant-key.ts`. Única definición de
  la clave de variante `K = cardId|productType|gradeKey|finish`; reusada en los 3 call-sites de
  `catalog.service.ts` (antes hand-rolled). Mismo string exacto. Otros roles: si necesitan la clave de
  agrupación de variantes, **importar `variantKey`** en vez de interpolar a mano (evita drift). *(Los ≥6
  sitios de SB-D3 siguen abiertos: este pase solo tocó los 3 de `catalog.service.ts`.)*
- **P-30 H2 · cierre COMPLETO (2026-08-23) — productores + eje sellado + guard de round-trip.** El pase
  anterior migró solo los CONSUMIDORES (`catalog.service`); los PRODUCTORES de esos mismos mapas seguían con
  la clave hand-rolled, partiendo la fuente de drift en dos. Ahora productor y consumidor comparten **una sola**
  `variantKey()`:
  - `pricing.service.ts`: `getReferencesBatch` (`keyOf`), `getVariantOverridesBatch` (`keyOf`) y el lookup
    single de `getVariantOverride` enrutados a `variantKey(...)` (import de `../../common/variant-key`).
  - `catalog.service.ts` `refFromBatch` (`:197`): el eje SELLADO `refs.get(`${cardId}|sealed|${gk}|normal`)`
    hand-rolled pasó a `variantKey({cardId, productType:'sealed', gradeKey:gk, finish:'normal'})`.
  - **Byte-identidad garantizada:** `variantKey` emite EXACTAMENTE el mismo string ⇒ ningún override/referencia
    se pierde (money-safe: es clave de map). **No se tocó cálculo de montos ni contrato.**
  - **Guard de round-trip** en `backend/test/tech-debt-backend.spec.ts`: ejercita el `PricingService` REAL con
    prisma mockeado y comprueba que la clave con que el batch INDEXA el Map se recupera con
    `variantKey(mismas partes)` (lo que hace el consumidor) — productor y consumidor comparten fuente. Incluye
    el eje sellado. QA: es el invariante real anti-drift (no solo «el helper produce X»).
- **`premiumFixedOffenders(...)` reubicado** — de `PricingController` (privado) a
  `backend/src/common/pricing-tiers.ts` (exportado, lógica idéntica; el controller delega). Es el invariante
  money-safe §4.33d (premium→pct de COMPRA). Ahora unit-testeable directo sobre el seed.
- **`rarity-catalog.premiumByPattern`**: +patrones `mega`/`blackwhite` (red money-safe R-5). Una variante
  string premium NUEVA no-alias ya no cae al bin holo barato.
- **`sealed-product.service`**: `upsertSealedProduct`/`ensureSetGroup`/`linkGroup` ahora atómicos frente a
  concurrencia (`create(...).catch(P2002 → converger)`); semántica preservada (subtype curado no se pisa,
  `linkGroup` duplicado sigue 409, soft-delete acotado intacto).

## 0-P37/P41. IVA a un solo dial + orden global por set más nuevo (2026-08-23, v1.40)

> Stream «Catálogo y precios». Dos enmiendas del contrato **v1.40** (P-37 y P-41-mejora), disjuntas y
> money-safe. Solo `backend/`. No hay cambio de schema. Gate: `settings.validation`, `buylist-catalog`,
> `money` y `money.direct-ship` **verde**; typecheck limpio en los archivos tocados. (Nota: hay 2 suites
> rojas PRE-EXISTENTES del stream de inventario/sellado —`sealed-price-ingest`, `inventory.sealed`— por
> `prisma.sealedProduct`/`TcgcsvGroupRef`; **ajenas a estos cambios**, no las toqué.)

### A) P-37 — `IVA_PCT` es la fuente ÚNICA del IVA (se retira `STRIPE_FEE_IVA_PCT`)
- **`settings.service.ts` `getStripeFee()`** — `stripeFeeIvaPct` deja de leer el dial propio y se DERIVA:
  `(await getNumber(IVA_PCT)) / 100`. Con `IVA_PCT = 16` ⇒ `0.16`, **idéntico al centavo** al valor previo;
  `money.ts`/`grossUpTotal`/`StripeFeeConfig` **no se tocaron** (solo cambia de dónde sale el 0.16).
- **`settings.constants.ts`** — se elimina `STRIPE_FEE_IVA_PCT` de `SettingKey`, `SETTING_DEFAULTS`,
  `SETTING_VALIDATORS` y `SETTING_DTO_MAP`. Efecto de contrato (§M10): ya **no se expone en `GET`** y un
  `PUT { stripeFeeIvaPct }` cae en **422** (key desconocida, flujo existente). **Sin migración**: la fila
  de BD `stripe_fee_iva_pct`, si existe, queda **inerte** — el gross-up nunca la lee ni cae a 0.
- **QA/frontend:** el DTO de M10 pierde `stripeFeeIvaPct`; la UI de settings debe retirar ese dial (frontend).

### B) P-41-mejora — desempate global por SET MÁS NUEVO
- **`common/card-order.ts` `CARD_ORDER_BY_GLOBAL`** — tras `name asc`, el desempate pasa de
  `{ setId: 'asc' }` (uuid aleatorio) a `{ set: { releaseDate: { sort: 'desc', nulls: 'last' } } }`:
  varias variantes del mismo nombre → sale primero la del set con `releaseDate` más reciente; un set con
  `releaseDate = null` queda al final del grupo. `{ id: 'asc' }` sigue como desempate total (paginación
  determinista). **`CARD_ORDER_BY_IN_SET` NO cambia** (binder/master-set intactos, inventario no tocado).
- **Consumo:** `catalog.service.searchAllCards` usa la constante tal cual (transparente). Prisma añade el
  JOIN a `CardSet` SOLO para ordenar (sin `include`). `CardSet.releaseDate` es `String? yyyy/MM/dd`
  zero-padded ⇒ el sort desc lexicográfico coincide con el cronológico.
- **Rendimiento (no bloqueante):** ordenar por columna de la relación NO usa el índice
  `@@index([setId, numberPrefix, numberSort])`. Índice de apoyo (p. ej. sobre `CardSet.releaseDate`, o un
  índice compuesto) **a evaluar si el plan lo pide** (ya referenciado en ARCHITECTURE §4.22b). No se
  implementó aquí. Candidato a `TECH_DEBT.md` a petición del techlead (no lo escribo por propiedad de archivo).

## 0-P30. Publicación ÚNICA por carta con STOCK — singles agrupados (2026-08-22, v1.38-grouped-listings)

> Stream «Catálogo y precios». Implementa el changelog **v1.38-grouped-listings** del contrato (§DTOs
> `GroupedListingDTO`/`GroupedListingListResponse`/`GroupedListingDetailResponse`; §2 `GET /catalog/cards`
> y §`GET /catalog/cards/:cardId`) y ARCHITECTURE **§4.9a**. **Cambio de SHAPE breaking** de `/catalog/cards*`
> (antes: un `ListingDTO` por copia física; ahora: publicaciones agrupadas por carta/variante/condición con
> `stockCount`). **SIN migración de schema** (agregación en LECTURA). Solo `backend/`. Gate backend: **161
> suites / 1545 tests verde**, typecheck limpio.

### Qué cambió en `catalog.service.ts` (único archivo de lógica tocado)
- **`buildGroups(rows)` (NUEVO, privado)** — reduce en memoria el set `sellable` que `fetchSellable` YA
  carga, agrupando por **`K = (cardId, productType, gradeKey, finish)`** con `gradeKey = pricing.gradeKeyFor(item)`
  (canónico `raw:NM` | `graded:PSA:10` | …). Devuelve `{ dto: GroupedListingDTO, salePriceCents, newestAt }[]`
  para que el caller filtre/ordene/pagine por GRUPO. Coste idéntico al listado por-pieza previo (que también
  cargaba todo y paginaba en memoria); mismo patrón que `SealedCatalogService` (sellado).
- **`listCards`** — tras `fetchSellable(singlesPublishedWhere(extra))` llama `buildGroups`. El rango de precio
  (`minPriceCents`/`maxPriceCents`) filtra ahora sobre el **`salePriceCents` del GRUPO** (contrato §2), no por
  pieza; `sort` ordena por grupo (`price_asc/price_desc` por `salePriceCents`; `newest`/default por la pieza
  más nueva del grupo, `createdAt` desc). **`total` = nº de GRUPOS** (publicaciones únicas), no de piezas.
- **`getCard`** — devuelve `{ card, listings: GroupedListingDTO[], units: ListingDTO[] }`. `listings` =
  grupos vendibles de la carta (cheapest-first) = la grilla de la ficha. `units` = TODAS las piezas vendibles
  **por-pieza** (`ListingDTO[]`, cheapest-first) para el **add-to-cart por `inventoryItemId`** (el carrito
  sigue por-pieza, §4-G) y para exponer el `certNumber` de cada slab en graded.
- **NO tocados:** `fetchSellable`/`toListingDTO` (siguen por pieza, base de la agrupación), `facets`,
  `getListing` (`GET /catalog/listings/:inventoryItemId` = re-quote por pieza, SIN cambio), `singlesPublishedWhere`
  (**H9** intacto: singles excluyen `productType='sealed'`), `/catalog/sealed*` (su propio catálogo agrupado).

### Money-safe del `stockCount` (invariante «vivo»)
`stockCount = nº de piezas VENDIBLES del grupo`. Como `fetchSellable` ya descartó toda pieza sin precio
resoluble (`dto.sellable ∧ salePriceCents != null`, Regla de Compra §4.9), **una pieza sin precio NO cuenta
ni entra** (nunca $0), y todo grupo emitido tiene **`stockCount ≥ 1` (VIVO)**. Un grupo AGOTADO (`stockCount=0`)
**no existe en `rows` ⇒ no se emite** (desaparece de Compra). No hay campo `status` de publicación ni columna
`stockCount`: el stock se **recomputa en cada lectura** (cero doble-escritura/drift). `salePriceCents` del grupo
= **mínimo** de sus piezas = el del `representativeInventoryItemId` (pieza vendible más barata); en el caso
normal todas comparten precio (misma K ⇒ misma regla/override + misma `PriceReference`), la única divergencia
posible es un `listPriceCents` manual por pieza (§4.26b) ⇒ el grupo muestra el más barato primero. `certNumber`
es POR SLAB ⇒ NO va al grupo, se expone en `units[]`.

### Sin migración — CONFIRMADO
El grupo es una **vista derivada en lectura** (reduce en memoria). No se añade columna ni tabla; `gradeKey`
se deriva en app (`gradeKeyFor`), no en SQL. El índice existente `@@index([cardId, finish, status])` (M-21)
cubre la ficha. No hubo cambios en `prisma/schema.prisma` ni nueva migración. (ARCHITECTURE §4.9a lo ratifica.)

### Tests (backend) — al shape agrupado
- `test/catalog.spec.ts`: nuevo describe **«publicación ÚNICA por carta/variante/condición con STOCK (P-30)»**
  — 3 copias de misma K ⇒ 1 grupo `stockCount=3` precio=mínimo/representante; **money-safe** (pieza sin precio
  no cuenta; grupo agotado desaparece); K distinta (raw vs graded) ⇒ grupos separados; `getCard` `listings`
  (grupos) vs `units` (por-pieza cheapest-first para add-to-cart). Los tests previos de `listCards`/H9/getCard
  migrados a `representativeInventoryItemId`/`stockCount`.
- `test/integration/catalog-checkout-webhook.e2e-spec.ts`: el aserto del listado de Compra migró de
  `l.sellable` a `l.stockCount≥1 ∧ salePriceCents>0 ∧ representativeInventoryItemId`.

### Pendiente de coordinación (NO backend)
El **render del storefront** (`frontend/`, carril del rediseño) consume el shape viejo de `/catalog/cards*`
y **quedó pendiente**: esto es un cambio **breaking** intencional coordinado con la sesión de rediseño (no lo
arregla backend). Frontend debe pintar la grilla contra `data`/`listings` (`GroupedListingDTO`, badge «N
disponibles» = `stockCount`, add-to-cart con `representativeInventoryItemId`) y la ficha contra `listings`
(grupos) + `units` (add-to-cart por-pieza / `certNumber`).

## 0-P34. Pricing por TIERS (2026-08-22, v1.37-pricing-tiers, M-38)

> Stream «Catálogo y precios». Implementa el changelog **v1.37-pricing-tiers** del contrato (§M2 «Pricing
> por TIERS») y ARCHITECTURE **§4.33 + M-38**. Cambios **MONEY-SAFE**; la naturaleza de la regla
> (`fixed`/`pct`), la precedencia (§4.26b) y el eje `finish` (§4.28d) **NO cambian**. **Único cambio de
> comportamiento intencional: T2 (Rare/Rare Holo) baja de fallback 40% → `pct` 25% (LOCKED).** Gate
> backend: **161 suites / 1540 tests verde** (incluye los nuevos). **Sin DDL** (migración de datos/seed).

### Taxonomía LOCKED — `common/pricing-tiers.ts` (NUEVO, zona compartida)
`PRICING_TIERS` = 5 tiers `T0–T4` `{ id, name, premium }` (T0/T1/T2 no-premium; T3/T4 premium). Es una
constante **cerrada y versionada** (como `rarity-catalog.ts`): el dueño NO crea/borra tiers, solo edita
los VALORES de cada tier y el MAPA rareza→tier. Helpers `TIER_IDS`, `isTierId`, `getTier`.

### Indirección money-safe — `common/money.ts` (aditivo; el resolver NO se tocó)
- `TieredRuleSet<R> { tierRules: Partial<Record<TierId,R>>, finishRules, fallbackPct }` — reemplaza el eje
  `rarityRules` de `PriceRuleSet` por `tierRules` (5 entradas). `finishRules`/`fallbackPct` idénticos.
- **`buildEffectiveRuleSet(tiered, tierMap)`** (función pura ÚNICA nueva) DERIVA el `PriceRuleSet` de
  siempre: `rarityRules[canonical] = tierRules[map[canonical]]`, y se lo pasa VERBATIM a
  `resolveTwoAxisRule` / `quoteAcquisitionForFinish` / `computeSalePriceForRarity`. El gate premium
  (§4.2.1) y la precedencia quedan intactos.
- **Compat on-read (ambos shapes conviven, sin ventana ciega):** `toPriceRuleSet(raw, fallbackPct,
  tierMap?)` gana un 3er parámetro opcional. Si `raw` es un `TieredRuleSet` (post-M-38) DERIVA el efectivo
  con `buildEffectiveRuleSet`; si es `{ rarityRules, ... }`/plano (pre-M-38) sigue igual (§4.28d, ignora el
  mapa). Si el shape es tiered pero el caller NO izó el mapa ⇒ `rarityRules={}` ⇒ **todo cae al fallback
  pct** (money-safe, nunca $0; `finishRules` se conservan). `isTieredRuleSet` distingue el shape.

### Cableado de los READ POINTS (izan el mapa + derivan el efectivo, patrón BE-25)
Los tres puntos que leen las reglas ahora también leen `PRICING_TIER_MAP` y pasan el mapa a
`toPriceRuleSet`. Ningún consumidor aguas abajo cambió (todos reciben el `PriceRuleSet` efectivo de
siempre): `catalog.service`, `inventory.service`, `master-set.service`, `variant-controls.service` heredan
el fix sin tocarse.
- `pricing.service.loadBuylistRules()` / `loadSalesRules()` — + `loadTierMap()` (nuevo helper).
- `pricing.controller.readBuylistRuleSet()` / `readSalesRuleSet()` — + `readTierMap()`.
- `buylist.service.buylistRules()` — iza el mapa inline (ruta de COMPRA pública/batch/createRequest).
  **Nota de scope:** este archivo es de `modules/buylist/` (mismo stream, no el `catalog.service.ts`
  vetado). Se tocó SOLO `buylistRules()` porque, sin izar el mapa, el seed tiered le llegaría como mapa
  plano corrupto = bug de dinero en la cotización de compra. Cambio mínimo y necesario (money-safety).

### Endpoints M2 (`super_admin`, auditados) — `pricing.controller.ts`
- **`GET /admin/pricing/tiers`** — 5 tiers `{ id,name,premium,buy,sell,rarityCount }` + `finishRules{buy,
  sell}` + `fallbackPct{buy,sell}`. `rarityCount` = nº de rarezas del mapa en ese tier.
- **`PUT /admin/pricing/tiers`** — reemplaza los VALORES de las 5 reglas (buy y sell) + eje acabado +
  fallbacks. Exige las 5 filas `T0..T4`; `name`/`premium` se ignoran (LOCKED). Valida
  mode/value/rango (buy pct [0,100], sell pct [0,1000], fixed entero cents ≥ 0). **Invariante** (abajo).
  Persiste `BUYLIST_PRICE_RULES`/`SALES_PRICE_RULES` (tiered) + dials de fallback. Audita
  `pricing.tiers.update` (before/after). Cambiar un tier repricia todas sus rarezas (criterio 74).
- **`GET /admin/pricing/tier-map`** — `{ tiers:[{id,name,premium}], rarities:[{ canonical, premium, mapped,
  cardCount, tierId|null, source:'map'|'fallback' }] }`, ordenado por `cardCount` desc. `tierId:null` ⇒
  rareza del catálogo sin mapear ⇒ fallback pct.
- **`PUT /admin/pricing/tier-map`** — patch **parcial** `{ assignments: { [canonical]: TierId } }`. Normaliza
  cada key a su canónica (`normalizeRarity`) y la exige mapeada en el catálogo (§4.28c) ⇒ si no,
  **`422 UNKNOWN_RARITY`** (`details.rarity`). `TierId ∉ {T0..T4}` ⇒ `422 VALIDATION_ERROR`. Fusiona con el
  mapa vigente. **Invariante** (abajo). Audita `pricing.tier_map.update`.
- **RETIRADOS:** `PUT /admin/pricing/buylist-rules` y `PUT /admin/pricing/sales-rules` (superseded). Los
  `GET` se conservan y ahora devuelven el `PriceRuleSet` **EFECTIVO** (derivado de tiers×mapa).
  `GET /admin/pricing/rarities` (+ `/sales-rarities`) ganan `tierId` + `source:'map'|'fallback'`; su `rule`
  refleja la regla RESUELTA vía tier. (`source` pasó de `'rule'|'fallback'` a `'map'|'fallback'` — basado
  en presencia de tier, coherente con `tier-map`; el front debe tolerar `'map'`.)

### Invariante money-safe (§4.33d) — `422 PREMIUM_RARITY_FIXED_TIER`
`premiumFixedOffenders(tierMap, buyTierRules)`: toda rareza `isPremiumCanonicalRarity(canonical)===true`
mapeada a un tier cuya regla de **COMPRA** es `fixed` es infractora. Se valida sobre el **producto
completo** (tiers × mapa), por eso lo emiten **ambos** PUT: el de `/tiers` con las reglas NUEVAS × el mapa
vigente; el de `/tier-map` con el mapa RESULTANTE × las reglas de compra vigentes. `details.offending:
[{ rarity, tierId }]`. Un tier de compra SIN regla (undefined) NO es infractor (cae al fallback pct). **El
eje de VENTA no entra** (un `fixed` de venta es un piso, no un bin de compra). Códigos nuevos añadidos al
enum central `common/error-codes.ts`.

### Persistencia / seed (M-38, `settings.constants.ts` — reshape de DATO, sin DDL)
- Nuevo `SettingKey.PRICING_TIER_MAP` (`pricing_tier_map`) + su default (mapa M.2 LOCKED + `Mega Rare`/
  `Black White Rare` → T3) + validador `validateTierMap` (forma + `TierId`; la existencia de la rareza la
  valida el PUT). NO se expone en `SETTING_DTO_MAP` (no editable por PUT /admin/settings).
- RESHAPE de `BUYLIST_PRICE_RULES`/`SALES_PRICE_RULES` de `{ rarityRules,... }` a `{ tierRules, finishRules
  }`. **Seed COMPRA:** T0 fixed $0.50, T1 fixed $1.50, **T2 pct 25% (CAMBIO LOCKED)**, T3/T4 pct 40%,
  fallback 40%. **Seed VENTA:** T0 fixed $5, T1 fixed $10 (= pisos vigentes de Common/Uncommon), T2/T3/T4
  pct 15 (= fallback de venta vigente), fallback 15. `finishRules` (buy `reverse_holo` fixed 150; sell
  `holofoil`/`reverse_holo` fixed 1000) = **las de hoy, SIN cambio** (§4.33e).
- `validateBuylistRules`/`validateSalesRules` ahora aceptan **3 shapes**: tiered (`tierRules`), dos ejes
  (`rarityRules`, compat pre-M-38) y mapa plano legacy. `validateTieredRuleSet` valida el nuevo shape.

### rarity-catalog.ts (+1 alias, +2 canónicas premium — cierra 3 `unmapped` money-losing, §4.33e)
- Alias `megahyperrare` → `Hyper Rare` (ya premium) → T4.
- Canónica `Mega Rare` (aliases `megaattackrare`, `megarare`, premium) → T3. `MEGA_ATTACK_RARE` (snake) lo
  colapsa `normKey`.
- Canónica `Black White Rare` (alias `blackwhiterare`, premium) → T3.
- **Efecto (fix de dinero):** las 3 dejan de cotizar al bin de acabado holo barato de bulk; con
  `premium:true` el gate §4.2.1 las resuelve por su propia regla (T3/T4 pct), verificado en tests.

### Backfill `Card.rarityCanonical` + barrido de otras `unmapped` — OPERATIVO, sin código nuevo
- El backfill de las 3 rarezas crudas se hace corriendo el endpoint **ya existente**
  `POST /admin/catalog/unify-rarities` post-deploy: re-deriva `rarityCanonical = normalizeRarity(rarity)`
  para todas las cartas con el catálogo YA extendido ⇒ `MEGA_ATTACK_RARE`/`Black White Rare`/`Mega Hyper
  Rare` pasan de pass-through `unmapped` a su canónica premium. **No toqué `catalog/` (otro stream corre
  ahí en paralelo);** el endpoint ya implementa la política. Money-safe: solo reescribe `rarityCanonical`.
- **Barrido de otras `unmapped` (§4.33g):** es AUTOMÁTICO por diseño — una rareza sin entrada en
  `PRICING_TIER_MAP` no cae a ningún tier fijo: resuelve por `fallbackPct` (40% compra), nunca $0 ni bin
  fijo. La política «premium por patrón nunca cae a T0/T1» se cumple sola (los tiers T0/T1 solo se asignan
  por el mapa explícito, y `premiumByPattern` mantiene el verdicto premium para el gate §4.2.1).

### Deuda descubierta (para que el orquestador la enrute — NO escribí TECH_DEBT.md)
- **DEV-tiers-1 (bandera para PO, ya en §4.33g):** el mapa LOCKED sube **Uncommon** de compra $0.50→$1.50
  (T1). Es cambio de negocio (no money-safety), reversible sin código (bajar T1 o reasignar Uncommon→T0).
- **DEUDA-tiers-2 (doc, contrato):** el ejemplo JSON del `GET /admin/pricing/tiers` en el contrato (línea
  ~3721) muestra `finishRules.sell.reverse_holo = 1500`, pero §4.33e manda «finishRules = las de hoy, SIN
  cambio» (hoy sell `reverse_holo` = **1000**, y además existe `holofoil` = 1000 que el ejemplo omite).
  Implementé lo NORMATIVO (§4.33e: preservar las de hoy). El «1500»/ausencia de `holofoil` del ejemplo es
  ilustrativo; conviene que el arquitecto alinee el ejemplo del contrato para que QA no lo lea como seed.
- **DEUDA-tiers-3 (acoplamiento, heredada SB-D2):** `buylist.service.buylistRules()` y
  `pricing.service.loadBuylistRules()` leen las MISMAS 3 claves por separado (2 lecturas paralelas). Con
  los tiers son ahora 3 claves cada uno (reglas + fallback + mapa). Sigue siendo la deuda SB-D2 ya
  registrada; no la agravé, solo la extendí a `PRICING_TIER_MAP`.

## 0-P35. Alta dedicada de producto SELLADO con imagen de API (2026-08-22, v1.36-sealed-alta)

> Stream «Inventario y vault». Implementa el changelog **v1.36-sealed-alta** del contrato (§M1 +
> DTOs `SealedCatalogProductDTO`/`SealedCatalogResponse` + 4 campos aditivos de `BatchInventoryItemInput`)
> y ARCHITECTURE §4.32. Cambios **ADITIVOS, RETROCOMPATIBLES y MONEY-SAFE**. Gate backend:
> **1518/1518** verde (1478 previos + 40 nuevos). De paso se saldan **H7** y **H8** del mismo módulo.

### Migración M-37 (schema, `prisma/` — zona compartida serializada)
`prisma/migrations/20260822160000_m37_sealed_alta/` — **3 columnas nullable, ADITIVAS, sin backfill**:
- `CardSet.tcgcsvGroupId Int?` — grupo TCGCSV **curado por set**; resuelve el listado (set → productos
  sellados de la API). `null` ⇒ fallback por hermanos ya mapeados.
- `InventoryItem.sealedImageUrl String?` + `InventoryItem.sealedProductName String?` — imagen/nombre del
  producto sellado **desde la API**, **display-only**, money-safe (jamás fijan precio). `null` ⇒ el
  display cae a la `Card` ancla (arregla que el sellado muestre la **caja**, no el single ancla).
- Las columnas de MAPEO (`InventoryItem.tcgplayerProductId/tcgplayerGroupId`) **ya existían** (M-23): el
  alta solo las **puebla**.

### `GET /admin/inventory/sealed-catalog?setId=&groupId?=&q?=` (`vault_operator+`)
Nuevo endpoint en el controller M1 → `SealedCatalogAdminService` (`modules/inventory/sealed-catalog-admin.service.ts`).
- **Reusa** el `TcgcsvSealedBulkProvider` de M2 (proxy read-only server-side; host fijo anti-SSRF +
  categoría Pokémon=3 en el cliente base). Se **exportó** desde `PricingModule` para inyectarlo sin
  duplicar el cliente. El navegador NUNCA habla con tcgcsv.com. **Autorización:** el explorador de
  curación M2 es `super_admin`; ESTE es `vault_operator+` (alta M1) — ampliación deliberada §4.32c.
- **Resolución set → grupo (precedencia §4.32b):** `groupId` query (override) > `CardSet.tcgcsvGroupId` >
  `DISTINCT tcgplayerGroupId` de hermanos sellados ya mapeados del set. Exactamente uno ⇒ se usa; cero o
  varios (sin `CardSet.tcgcsvGroupId`) ⇒ `groupResolved:false` + `data:[]` (el front ofrece fijar el grupo).
- **`anchorCardId`:** Card representativa del set = menor `(numberPrefix, numberSort)`. El alta la reenvía
  como `cardId` (satisface `InventoryItem.cardId` NOT NULL). El operador **nunca** elige un single como ancla.
- **`marketRef` (money-safe, INFORMATIVO):** `marketPrice` TCGCSV del grupo (USD) → `usdToMxnCents` con
  FX+colchón (`FxService.getCurrent()` **una vez** por request). **Sin precio en la fuente ⇒ `null`
  (pendiente/«—»), NUNCA `0`.** No fija venta ni costo. **Sin N+1:** 1 llamada de productos + 1 de precios.
- **`sealedSubtype` inferido** por heurística de nombre (`inferSealedSubtype`, exportada y testeada):
  ETB→`etb`, Booster Box→`box`, Bundle→`bundle`, Tin→`tin`, Blister/Sleeved/Checklane→`blister`; `null`
  si no se infiere (el operador lo elige al alta).
- **Errores:** `400 VALIDATION_ERROR` (setId ausente / groupId no entero positivo — en el controller),
  `404 NOT_FOUND` (set inexistente), `502 UPSTREAM_ERROR` (TCGCSV caído — `listSealedProducts` lanza; los
  precios NUNCA lanzan, devuelven lo acumulado ⇒ productos sin precio salen con `marketRef:null`).

### Alta de sellado — SIN endpoint nuevo: `POST /admin/inventory/items[/batch]`
`BatchInventoryItemInput` + `CreateItemDto` ganan 4 campos aditivos, **SOLO** `productType='sealed'`
(ignorados en raw/graded):
- `tcgplayerProductId?` + `tcgplayerGroupId?` — se fijan **JUNTOS**; XOR (uno sin el otro) → **422
  VALIDATION_ERROR** (por-línea en el lote). Presentes ⇒ la pieza **NACE MAPEADA** (pobla las columnas
  M-23) ⇒ la **aportación de sellado valúa EN EL ACTO** por `sealed:tcg:<productId>` **directo** (sin
  inferir hermanos; `resolveSealedAportacionMarket(bornMappedProductId)`). Sin mercado/override ⇒ **422
  PRICE_PENDING** por línea (jamás 0), como hoy. Sellado SIN mapeo conserva la inferencia por hermanos.
- `sealedImageUrl?` + `sealedProductName?` — la imagen se **VALIDA server-side** contra el host allowlist
  (`modules/inventory/sealed-image-host.ts`: solo `https:` + host EXACTO/subdominio de `tcgplayer.com` o
  `tcgcsv.com`, sin `http:`/`data:`/`javascript:`/userinfo). Inválida/omitida ⇒ `null` (fallback a la
  `Card` ancla). Anti stored-XSS. `sealedProductName` se persiste tal cual (vacío ⇒ null).
- **Idempotencia** por `batchKey` (`InventoryBatch` `kind='create'`) sin cambios; tolerancia por-línea
  intacta. Los campos se persisten en `buildItemData` (single y lote comparten el mismo builder).
- **Autorización (nota para seguridad):** que un `vault_operator` fije el mapeo TCGCSV al alta es una
  ampliación deliberada (§4.32c); el `productId` viene del listado que el server sirvió, la valuación
  sigue server-side (SEC-A1) y el alta queda auditada (`inventory.batch_create`).

### Deuda saldada de paso (mismo archivo, `inventory.service.ts`)
- **H7** — el export (`exportInventoryXlsx`) ahora **valida `setId`** contra `CardSet` ANTES de consultar:
  id desconocido → **400 VALIDATION_ERROR** (paridad con `publishAll`/bulk-ops; ya no export vacío en
  silencio). **RESUELTA** en `docs/TECH_DEBT.md`.
- **H8** — `workbook.creator = 'TCG Vault MX'` (marca **vigente**, PROJECT.md), reemplaza la obsoleta
  `'TCG HUNT'`. **RESUELTA** en `docs/TECH_DEBT.md`.

### Tests nuevos (40)
- `test/inventory.sealed-catalog.spec.ts` — listado sellado (no singles), `imageUrl`, `marketRef`
  (pending⇒null nunca 0, colchón FX), precedencia de resolución de grupo, `groupResolved:false`, 404/502,
  sin N+1, heurística de subtipo, y las 400 del controller.
- `test/inventory.sealed-alta.spec.ts` — nace mapeada + valúa; money-safe (sin mercado ⇒ 422 PRICE_PENDING);
  XOR del mapeo ⇒ 422; campos ignorados en raw; host allowlist (evil/http/data/js/userinfo ⇒ null);
  batch tolerante + idempotencia por `batchKey`.
- `test/inventory.export-xlsx.spec.ts` — +H7 (setId inexistente ⇒ 400; existente aplica filtro) y +H8
  (`workbook.creator`).

### Diferido (SB-D5, §4.32d)
La entidad `SealedProduct` de catálogo (cura de raíz del ancla-a-single) **NO** se hace aquí; M-37 es el
puente mínimo. SB-D5 **permanece abierta** (ver `docs/TECH_DEBT.md`).

## 0-P29/P31. Baja rápida por cantidad + Export de inventario a Excel (2026-08-22, `fix/variant-composition-regression`)

> Solo `backend/` (módulo `inventory` + un error code en `common/` + dep `exceljs`). Cambios
> **ADITIVOS y MONEY-SAFE**. Gate: **1471/1471** verde (1452 previos + 19 nuevos). Ambos endpoints
> quedan **PENDIENTES de formalizar en `API_CONTRACT` por el arquitecto** (patrón §M1 vigente).

### P-29 — Baja rápida por CANTIDAD (nuevo endpoint)

`POST /admin/inventory/items/bulk-remove` · roles `vault_operator` + `super_admin` (mismo controller M1).

**Por qué un endpoint nuevo (no reuso directo):** el camino de baja por-pieza YA existe
(`POST /admin/inventory/adjustments` con `reason ∈ {perdida, danada, error_captura}` → un
`inventoryItemId` concreto; y `POST /admin/inventory/items/:id/mark`). Lo que faltaba es dar de baja
**N piezas de un golpe** de un (cardId, finish[, condición]) sin ir pieza por pieza. `bulk-remove`
**reusa la semántica** de `adjustExisting` (mismo mapeo de motivos, mismo guardarraíl, mismo rastro
triple) pero **selecciona las N piezas server-side**.

**Request body** (`BulkRemoveRequestDto`):
- `cardId: string` (req), `finish: Finish` (req: `normal|reverse_holo|holofoil|first_edition_holofoil`),
- `quantity: int ≥1` (req, tope `MAX_BATCH_QTY=500`), `reason: perdida|danada|error_captura` (req),
- `note: string` (req, no-vacía — paridad con la baja por-pieza),
- filtros OPCIONALES para desambiguar la casilla: `productType?`, `rawCondition?` (`NM`), `sealedCondition?`.

**Selección de las «N más apropiadas»:** solo piezas `ownerType=platform` en `{in_stock, listed}`
(mismo allowlist `ADJUSTABLE_ORIGIN_STATUSES` que el ajuste), ordenadas **`in_stock` antes que
`listed`** (baja primero lo NO publicado → menos disrupción del storefront) y dentro de cada status la
**más antigua (FIFO por `createdAt`)**. `take: quantity`.

**Motivos → status:** `perdida→lost`, `danada→damaged`, `error_captura→withdrawn` (idéntico a
`adjustExisting`). Registro **triple por pieza**: `InventoryMovement(reason=adjustment)` +
`InventoryAdjustment` (M-24) en la MISMA `$transaction`; el `AuditLog action=inventory.bulk_remove`
lo escribe el controller (con `requested`/`removed`/`folios`/`adjustmentIds`).

**Atómico / «no bajar más de las que hay»:** si hay **menos** piezas ajustables que `quantity` →
`422 INSUFFICIENT_STOCK` con `details.{available, requested}` y **NO se baja ninguna**. Guardia
atómica de status (updateMany condicionado + `count`, patrón BE-45): una carrera que saque una pieza
del allowlist entre la lectura y la escritura → `422 ITEM_NOT_ADJUSTABLE` + rollback (nunca pisa una
reserva de checkout con lost/damaged).

**Money-safe:** NO toca precios (`listPriceCents`, referencias, overrides) ni crea/reversa órdenes;
solo transiciona `status` (baja de stock). Jamás escribe `reserved`/`listed` → no vende ni publica.

**Response 200** (`BulkRemoveResponse`): `{ batchKey?, idempotentReplay, removed, requested, reason,
toStatus, inventoryItemIds[], folios[], adjustmentIds[] }` (arrays 1:1). En el camino feliz
`removed === requested` siempre.

**Nuevo error code:** `INSUFFICIENT_STOCK` (422) en `src/common/error-codes.ts` — formalizado en
API_CONTRACT §0/§M1 (v1.34).

#### Idempotencia por `batchKey` (v1.35, H1 — cierre del «encogimiento fantasma»)

`bulk-remove` gana **paridad total** con `adjustFound` (`InventoryAdjustmentRequest.encontrada`,
v1.20.1/BE-47) y `publish-all`. Copiado tal cual el mecanismo `InventoryBatch` (M-21):

- **DTO:** `batchKey?: string` opcional (`@IsOptional() @IsString()`). `note` sigue **obligatoria**
  (`@IsString() @IsNotEmpty() note!: string`; el servicio además rechaza whitespace → 400). NO se relajó.
- **Persistencia:** `InventoryBatch` con **`kind='bulk_remove'`** (nuevo valor). `kind` es una columna
  **`TEXT` libre** (no enum de BD, sin `CHECK`) → **añadir el valor NO requiere migración** (mismo
  precedente que `publish_all` en v1.28; se actualizó solo el comentario del schema). Ver `TECH_DEBT.md`
  BE-BR1/BE-BR2.
- **Mecanismo (idéntico a `adjustFound`):** fast-path replay (batchKey ya persistido →
  `replayBulkRemove` devuelve el `resultJson` guardado + `idempotentReplay: true`, mismo `200`, **sin**
  transicionar status ni escribir un segundo lote de movimientos/ajustes) · claim
  `inventoryBatch.create({ id: batchKey, kind: 'bulk_remove' })` **PRIMERO** dentro de la `$transaction`
  (la unique constraint del id es la guardia de concurrencia; P2002 → replay del ganador) · un fallo
  posterior (`INSUFFICIENT_STOCK`/TOCTOU) hace **rollback del claim** → un reintento con la misma key
  vuelve a intentar limpio (no se «quema» el batchKey). Sin `batchKey` ⇒ `idempotentReplay: false`.
- **Response:** se anteponen `batchKey?` (presente solo si vino en el request) e `idempotentReplay`.
- **Auditoría:** el controller añade `batchKey` + `idempotentReplay` a `AuditLog
  action=inventory.bulk_remove`.
- **Comentario falso corregido (H1):** el docstring de `bulkRemove` afirmaba/implicaba que la
  **atomicidad + el estado de carga** cubrían el doble submit. Es **FALSO**: la atomicidad solo garantiza
  consistencia DENTRO de una ejecución (o baja las N o ninguna); lo que evita re-bajar OTRAS N piezas en
  un reintento es la **idempotencia por `batchKey`**. El docstring ahora lo describe correctamente.
- **Tests:** `test/inventory.bulk-remove.spec.ts` +4 (replay devuelve el guardado sin re-bajar; claim
  `kind='bulk_remove'` primero + resultJson como fuente del replay; fallo no quema el batchKey;
  concurrencia P2002 → replay del ganador). **Suite: 15/15 verde** (11 previos + 4 nuevos); inventario
  completo **160/160**; typecheck limpio.

### P-31 — Export de inventario a Excel (nuevo endpoint)

`GET /admin/inventory/export.xlsx?setId=&productType=` · roles `vault_operator` + `super_admin`.

**Librería:** **`exceljs` ^4.4.0** (añadida a `backend/package.json`; genera `.xlsx` OOXML real, trae
su propio empaquetador ZIP, sin binarios nativos). Se prefirió `.xlsx` real (lo pidió el humano) sobre
CSV.

**Alcance / grano:** **por PIEZA (una fila por folio)** — el modelo es folio-por-pieza, así el
operador ve cada copia con su ubicación/costo/cert/estado. Scope = inventario de **plataforma**
(`ownerType=platform`); las piezas en custodia de clientes NO se exportan (no son inventario propio).
Filtros opcionales: `setId` (id LOCAL de `CardSet`) y `productType` (validado contra el enum → 400).

**Columnas** (orden fijo, `INVENTORY_EXPORT_COLUMNS`): Folio · Carta · Set · Número · Rareza · Tipo ·
Acabado · Condición · Certificado · Cantidad(=1) · Estado · Ubicación · Origen · Costo MXN · Precio
mercado MXN · Precio compra MXN · Precio venta MXN.

**Semántica money-safe de las columnas de dinero (todo STORED, sin derivar ni inventar):**
- **Costo** = `acquisitionCostCents`.
- **Precio mercado** = `PriceReference` de la variante del item (`getReferencesBatch`, MXN al FX vivo;
  sellado por `sealed:tcg:<productId>`). Ref `pending` → vacío.
- **Precio compra** = override de COMPRA manual (`VariantPriceOverride.buyOverrideCents`, M-30). **NO**
  recomputa la regla del cotizador por rareza (eso sería inventar). Vacío si no hay override.
- **Precio venta** = precio manual POR PIEZA (`listPriceCents`) ó, en su defecto, el override de VENTA
  (`sellOverrideCents`). **NO** deriva mercado×markup. Vacío si ninguno.
- **Regla dura:** sin dato → **celda VACÍA** (nunca `0`). `centsToMxn(null) = null`.

Consultas EN LOTE (sin N+1): `getReferencesBatch` + un `variantPriceOverride.findMany` por `cardId`.

**Respuesta:** binario con `Content-Type:
application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` y
`Content-Disposition: attachment; filename="inventario-YYYY-MM-DD.xlsx"` (+ `Content-Length`).
Controller usa `@Res()` directo (no passthrough) — no hay interceptor global que envuelva la respuesta.

### Tests (P-29 + P-31)
`test/inventory.bulk-remove.spec.ts` (baja N; motivos→status; selección/orden/filtros;
`INSUFFICIENT_STOCK` sin escribir; TOCTOU; money-safe; **idempotencia por `batchKey` v1.35**; auditoría
del controller) y `test/inventory.export-xlsx.spec.ts` (firma ZIP + re-lectura ExcelJS de
encabezados/valores; celda vacía sin precio; precios stored en MXN; ref pending vacía; filtros al where;
graded/sealed; cabeceras de descarga). **bulk-remove 15/15 (11 previos + 4 de idempotencia); export
verde.**

---

## 0-P27. Master set combinado (sets multi-parte) — P-27 (2026-08-22, `fix/variant-composition-regression`)

> Solo `backend/`. Cambios **ADITIVOS, RETROCOMPATIBLES y MONEY-SAFE**. Implementa ARCHITECTURE §4.31
> + API_CONTRACT v1.33-master-set-multipart. Gate: **1450/1450** verde (1434 previos + 16 nuevos).
> El **frontend de P-27 va aparte** (binder agrupado por `partSetId`, dropdown combinado, URL canónica).

**Qué resuelve.** Un set multi-parte que pokemontcg.io publica como ≥2 set-ids (principal + subset con
id propio) se mostraba como dos sets → Celebrations aparecía con **25** cartas siendo **50**. Ahora se
presenta como **UN master set combinado** (cel25 + cel25c), **SOLO en la vista**: cada carta conserva
su set-id real; precio/inventario/bóveda **no cambian a nivel de dato**.

**(1) Mapa curado `backend/src/config/master-set-groups.ts`.** Constante llaveada por `externalId` de
pokemontcg.io (NO columna de schema, NO tabla, NO migración). Estructura soporta **N subsets** por
principal. Helpers puros (leen el array en vivo, sin índices pre-construidos → testeables con fixtures):
`groupForPrimaryExternalId`, `parentExternalIdOf`, `subsetMetaOf`, `partExternalIds`, `isMappedExternalId`,
`allMappedExternalIds`.
- **ACTIVADO:** `cel25` → `cel25c` (label "Classic Collection"), confirmado (criterios 65–67).
- **COMENTADOS como candidatos** (NO activados — sin DB aquí para validar los `externalId` reales):
  Shining Fates `swsh45`→`swsh45sv` y Hidden Fates `sm115`→`sma`, con nota "VALIDAR contra catálogo real
  antes de activar". Para activar: descomentar la línea; la validación al boot avisará si no está importado.
- **Validación al boot:** `MasterSetService.onModuleInit()` resuelve cada `externalId` mapeado contra
  `CardSet` y **loguea WARNING** por los no importados (CA-71). Defensivo (try/catch): si la BD no está
  al arrancar (smoke de DI con Prisma mockeado) no revienta.

**(2) Fan-in en `MasterSetService` (read model ÚNICO §4.20 — M1, bóveda y admin-bóveda lo heredan).**
Método privado `resolveMasterSet(set)`: por el `externalId` decide si el set es principal/subset de un
grupo y devuelve las partes importadas en orden de bloque, o `null` (set normal → comportamiento v1.20
intacto). UNA query extra (`CardSet WHERE externalId IN partes`).
- `binder()`: `Card WHERE setId IN partSetIds`; orden por bloque (principal `order 0` primero, luego cada
  subset por su `order`; **estable** → preserva el orden natural intra-bloque). `set` = principal;
  `catalogCardCount`/`printedTotal` = **Σ de las partes** (Celebrations = 50); cada celda gana
  `partSetId`/`partLabel`; el binder gana `parts[]` (con `catalogCardCount` por parte). Pedir el binder de
  un **subset** (`cel25c`) **normaliza al principal** y devuelve `canonicalSetId`.
- `index()`: `foldCombinedMasterSets()` pliega los subset en la fila del principal (agregados SUMADos
  sobre las partes; `completionPct`/`variantCompletionPct` recomputados), quita las filas de subset y
  añade `partSetIds`. El pliegue corre **antes** del filtro `totalPieces>0` de bóveda (un subset con
  piezas cuenta aunque el principal tenga 0). Sin N+1: reagrupa resultados de las agregaciones fijas ya
  existentes.

**(3) Storefront `catalog.service.ts` (aditivo).**
- `GET /catalog/sets` + `/facets`: `foldStorefrontSets()` pliega el subset en el principal (Celebrations
  una vez) + `partSetIds?`. Si el principal no tiene inventario publicado pero sí está importado, se trae
  por `externalId` para nombrar la entrada. CA-71: principal no importado → no se pliega.
- `GET /catalog/cards?setId=<principal>`: `expandSetIdFilter()` expande a `setId IN partSetIds` (solo
  cuando el id es el principal de un grupo con ≥2 partes importadas). Respeta la **Regla de Compra**
  (`fetchSellable` sigue listando solo lo `sellable`; agrupar NO publica cartas sin precio).

**(4) MONEY-SAFE DURO (verificado).** El mapa se importa en **exactamente 2 read models** de
presentación: `master-set.service.ts` (binder/index) y `catalog.service.ts` (listCards/facets/listSets).
**NINGUNA ruta de escritura/dinero lo consulta:** alta por lote, bulk-publish, adjustments, órdenes/
checkout, pricing/sync, buylist. En particular el **cotizador de buylist** (`searchAllCards` /
`listSetsWithImportedCards`) **NO** usa el mapa → sigue llaveado al set REAL. `scopeWhere` y las
agregaciones filtran por `cardId` (llaveado a su set real): el `groupBy` de piezas del binder usa
`cardId IN [...]` + `scopeWhere` intactos. No hay re-llaveado, migración, enum nuevo ni escrituras.
Verificable: precio/folio/titularidad de una carta `cel25c` idénticos con y sin grupo (CA-68/CA-72).

**Tests (16 nuevos).** `test/master-set.multipart.spec.ts` (11): helpers del mapa (cel25 activo,
candidatos NO activos); binder Celebrations = 50 en un master; `partSetId`/`partLabel` + orden de bloque;
subset→principal con `canonicalSetId`; CA-68 (piezas de `cel25c` llaveadas a `cardId`, `groupBy` por
`cardId`+`scopeWhere` real); CA-70 (N subsets, grupo-fixture temporal); CA-71 (subset sin principal /
principal sin subset → set normal, sin 500); index pliega con Σ de conteos + `partSetIds`.
`test/catalog.multipart.spec.ts` (5): `listSets`/`facets` pliegan (+`partSetIds`, principal traído si
falta); `listCards` expande `setId` del principal; set normal sin expansión. Los grupos-fixture se
limpian en `afterEach`.

**Bloqueos/discrepancias con el contrato:** ninguno. El diseño del arquitecto era implementable tal cual.

## 0-quater. Pago de deuda techlead TD-2 / TD-3 (2026-08-22, `fix/variant-composition-regression`)

> Solo `backend/`. Sin cambio de comportamiento (los casts eran solo de tipo); gate 1434/1434 verde.

**TD-2 — códigos de error formalizados en el enum central.** `UPSTREAM_ERROR` (502) y
`SET_NOT_IMPORTED` (409) — normativos en el contrato desde v1.31/v1.32 (§Convenciones/Errores) — se
emitían por **cast** `as ErrorCodeType` fuera de la fuente única de verdad. Ahora están en el enum
`ErrorCode` de `backend/src/common/error-codes.ts` (sección Catalog/pricing) y **se retiraron todos los
casts**:
> - `modules/catalog/catalog-sync.service.ts`: se eliminaron las consts locales `UPSTREAM_ERROR`/
>   `SET_NOT_IMPORTED` (creadas por cast). Ahora usan `ErrorCode.*`: `refreshVariants` (SET_NOT_IMPORTED
>   409, e `INTERNAL` del resolver no cableado), `withTcgcsvGuard`/`withUpstreamGuard` (UPSTREAM_ERROR
>   502), y el fallback de `runRefreshVariantsAll` (`String(ErrorCode.UPSTREAM_ERROR)`).
> - `modules/pricing/sealed-pricing.controller.ts`: `groups`/`products` (proxy TCGCSV) usan
>   `ErrorCode.UPSTREAM_ERROR`; se eliminó la const local por cast.
>
> Mapeo HTTP intacto: 502 para UPSTREAM_ERROR, 409 para SET_NOT_IMPORTED. Verificado: `grep 'as
> ErrorCodeType' backend/src/` → 0 resultados.

**TD-3 — migración de limpieza `rarity_map` (M-36).** Tras retirar el setting `RARITY_MAP`, quedaban
filas `ConfigSetting key='rarity_map'` inertes. Se añadió la migración de datos
`prisma/migrations/20260822150000_m36_cleanup_rarity_map_setting/` con
`DELETE FROM "ConfigSetting" WHERE "key" = 'rarity_map';`. **Idempotente** (0 filas si no existen;
no-op en greenfield) y **aditiva/segura** (solo borra config muerta; NO toca schema, dinero, precios ni
inventario). **NO aplicada contra prod** desde el entorno de trabajo (no hay DB aquí); la aplica devops
en el `migrate deploy`. **Rollback:** no se restaura — era config muerta sin lectura viva; si se
necesitara una tabla rareza→precio se usa el setting vigente `buylist_price_rules`.

## 0-ter. `POST /admin/catalog/unify-rarities` — backfill LOCAL de `rarityCanonical` (money-safe, sin pokemontcg.io)

> Rama `fix/variant-composition-regression`. Endpoint admin NUEVO, aditivo, **money-safe**. Solo
> `backend/`. Repara la **regresión de la migración M-31**, que sembró `Card.rarityCanonical = rarity`
> CRUDO (sin normalizar). Con eso, el `groupBy(['rarityCanonical','rarity'])` del editor de reglas
> (`GET /admin/pricing/rarities` y `/sales-rarities`) mostraba rarezas **fragmentadas/duplicadas** (ej.
> `rare holo`, `Rare Holo`, `RARE HOLO` como filas separadas). El **dinero está a salvo** (el pricing
> re-normaliza al vuelo en `money.ts`); lo roto era SOLO la UX del editor.

**Qué hace.** Recorre TODAS las `Card` con `rarity != null` y reescribe
`rarityCanonical = normalizeRarity(rarity)` (función PURA de `common/rarity-catalog.ts`). Es un UPDATE
derivado de la columna **LOCAL** `rarity`: **NUNCA** llama a pokemontcg.io ni a TCGCSV.

**Money-safe (garantías).** NO toca `PriceReference`, precios, `PendingPriceEntry`, ni la composición
de variantes/acabados. La ÚNICA columna que escribe es `Card.rarityCanonical`. Como el pricing ya
re-normaliza la rareza al cotizar, ningún monto cambia: esto solo arregla el agrupado del editor.

**Síncrono e idempotente.** Elegí **síncrono (200)** en vez del patrón fire-and-forget+status: es un
UPDATE de UNA columna y el universo de rarezas DISTINTAS es de decenas, así que agrego el estado con
un solo `groupBy(['rarity','rarityCanonical'])` y emito **un `updateMany` por rareza cruda divergente**
(no un UPDATE por carta). En la segunda corrida no hay filas divergentes ⇒ **0 writes, 0 updates**.

### Firma exacta (pendiente de formalizar en `API_CONTRACT.md` por el arquitecto)
- **Ruta:** `POST /api/v1/admin/catalog/unify-rarities`
- **Auth/rol:** `@Roles(super_admin)` (hereda el guard de `AdminCatalogController`). Auditado
  (`AuditLog action=catalog.unify_rarities`, `entityType='Card'`, con `cardsProcessed`, `cardsUpdated`,
  `distinctCanonical`, `unmappedCount`).
- **HTTP de éxito:** `200`. **Body:** vacío (sin parámetros).
- **Respuesta 200 (resumen):**
  ```jsonc
  {
    "ok": true,
    "cardsProcessed": 12000,   // # de Card con rarity != null (universo recorrido)
    "cardsUpdated": 3400,      // # de Card cuyo rarityCanonical DIFERÍA y se corrigió (0 en 2ª corrida)
    "distinctCanonical": 21,   // # de rarezas canónicas DISTINTAS resultantes
    "unmapped": [              // rarezas cuya forma cruda NO tiene entrada en CANONICAL_RARITIES
      { "raw": "Galaxy Foil", "canonical": "Galaxy Foil", "count": 40 }
      // ↑ el operador ve qué rarezas nuevas convendría AÑADIR al catálogo canónico (rarity-catalog.ts).
      //   `canonical` es el pass-through Title-case (money-safe: cae al fallback pct, predecible).
    ]
  }
  ```
- **Implementación:** `CatalogSyncService.unifyRarities()` + `AdminCatalogController.unifyRarities()`.
- **Tests:** `backend/test/catalog-unify-rarities.spec.ts` (5 casos): cruda→canónica escribe solo donde
  difiere; idempotencia (0 updates, 0 writes); `unmapped`; money-safe (no llama a pokemontcg.io, solo
  `card.updateMany` de `rarityCanonical`); `distinctCanonical`.

## 0-quater. Limpieza: retiro de endpoints muertos / redundantes (rama `fix/variant-composition-regression`)

- **RETIRADO — `GET/PUT /admin/pricing/rarity-map` (MUERTO).** Deprecado desde v1.3.1 (la cotización ya
  NO lo leía; lo reemplazó `BUYLIST_PRICE_RULES` + el catálogo canónico §4.28c). Verifiqué que **nada
  lo consume**: el front NO tiene wrapper (`frontend/src/types/contract.ts:1478` es solo un comentario
  de tipo, sin llamada). Retirado:
  - `PricingController.getRarityMap` / `putRarityMap` + el DTO `RarityMapDto` (`pricing.controller.ts`).
  - El setting huérfano `SettingKey.RARITY_MAP` (`rarity_map`) y sus entradas en `SETTING_DEFAULTS` y
    `SETTING_VALIDATORS` (`settings.constants.ts`). Único consumidor previo = los endpoints retirados.
  - El test obsoleto `backend/test/pricing.rarity-map.spec.ts` (borrado).
  - Filas `ConfigSetting key='rarity_map'` que existan en BD quedan huérfanas e inertes (nadie las lee);
    no requieren migración. Los deploys nuevos ya no las siembran.
- **DEPRECADO (no borrado) — `POST /admin/pricing/sync` («sync de precios (bóveda)»).** El front lo
  retira del UI. **NO se borra** porque su servicio `PriceSyncJobService` es COMPARTIDO: el endpoint usa
  `.enqueue()`, pero `PriceSyncJobService.run()` es el ejecutable del **job PROGRAMADO** `price-sync`
  (BullMQ, cron `15 6 * * *` en `scheduler.service.ts:159/217`). Borrar el servicio rompería el cron.
  Marqué el endpoint con `@deprecated` (JSDoc en `pricing.controller.ts`). **Retirarlo definitivamente
  es follow-up del arquitecto** una vez confirmado que ningún cliente lo llama. `GET
  /admin/pricing/sync-status` (barra de progreso del barrido de `price-ingest`) es OTRO endpoint (no
  toca `PriceSyncJobService`) y **queda intacto**.
- **NO tocado:** los endpoints E/H (los del "Avanzado" que el front solo esconde) siguen vivos.

## 0-bis. M-34 — `POST /admin/catalog/refresh-variants`: refrescar variantes + precios de un set YA importado SOLO desde TCGCSV (sin pokemontcg.io)

> Rama `fix/variant-composition-regression`. Endpoint admin NUEVO, aditivo, **money-safe**. Solo
> `backend/`. Desacopla el refresco de variantes/precios (TCGCSV) del re-fetch de cartas
> (pokemontcg.io), para poder **reparar el `normal` fantasma de un set que YA está en BD aunque
> pokemontcg.io esté caído (502)**.

**Motivo.** El "Sync completo" (`POST /admin/catalog/sync {setId, force:true}`) encadena el
re-fetch de metadata de cartas desde **pokemontcg.io** con el resolver estructural de
variantes/precios desde **TCGCSV**. Durante el outage actual de pokemontcg.io (502), ese
encadenamiento **bloquea** arreglar la composición de un set que ya tenemos importado. Este camino
NO toca pokemontcg.io: opera sobre las `Card` existentes en BD y solo habla con TCGCSV.

### Firma exacta (pendiente de formalizar en `API_CONTRACT.md` por el arquitecto)
- **Ruta:** `POST /api/v1/admin/catalog/refresh-variants`
- **Auth/rol:** `@Roles(super_admin)` (mismo guard que el resto de `AdminCatalogController`). Auditado
  (`AuditLog action=catalog.refresh_variants`, entityType `CardSet`, con los contadores + `force`).
- **HTTP de éxito:** `200`.
- **Body:**
  ```jsonc
  {
    "setId": "me05",   // REQUERIDO. externalId del set (id pokemontcg.io, p. ej. "me05"). string.
    "force": false     // OPCIONAL, default false. Aceptado por simetría con /sync (ver nota).
  }
  ```
- **Respuesta 200 (resumen informativo):**
  ```jsonc
  {
    "ok": true,
    "setId": "me05",
    "cardsProcessed": 42,        // # de Card locales del set (universo procesado)
    "cardProductsUpserted": 40,  // CardProduct upserteados (productos TCGCSV unidos por productId)
    "pricesUpserted": 55,        // PriceReference (tcgcsv_singles) escritos (marketPrice>0)
    "pending": 7,                // variantes (producto×acabado) SIN precio ⇒ «—»/PRICE_PENDING (jamás 0)
    "tcgcsvReachable": true
  }
  ```
- **Errores:**
  - `422 VALIDATION_ERROR` — `setId` con formato inválido (no calza `SET_ID_PATTERN`). Antes de tocar BD/red.
  - `409 SET_NOT_IMPORTED` — el set NO existe en BD, o existe pero **sin cartas**. Mensaje accionable:
    "impórtalo primero con `POST /admin/catalog/sync`; este camino NO llama a pokemontcg.io". **No** se
    intenta importar. **Se usa 409 (no 404) a propósito:** el frontend trata `404/405` como "endpoint no
    desplegado" (`isEndpointMissing`), así que un `SET_NOT_IMPORTED` real con 404 se confundiría con
    "endpoint faltante". 409 (Conflict: no se puede refrescar porque el set no está importado) deja
    backend+frontend alineados.
  - `502 UPSTREAM_ERROR` — TCGCSV no responde (401/403/5xx/red/parse). Mensaje accionable
    "Fuente TCGCSV no disponible; reintenta en unos minutos (...)". **NO** un 500 crudo. Money-safe: el
    resolver hace TODO el fetch (products+prices / listGroups) ANTES de cualquier escritura, así que un
    fallo remoto NO escribe ni borra nada (se conserva lo previo).
  - `500 INTERNAL` — solo si el `CardProductResolverService` no estuviera cableado (no ocurre en prod;
    el `@Optional` es únicamente para los tests unitarios de metadata).

> **Nota sobre `force`.** Este camino ES, por definición, un refresco forzado de variantes: SIEMPRE
> re-resuelve por completo (no hay gate de first-import como en `/sync`). Por eso `force` hoy **no
> altera** el comportamiento; se acepta por simetría con `/sync` y para el mismo botón del front, y
> queda registrado en auditoría. Si a futuro se quiere un modo "solo si stale", el flag ya está listo.

### Servicios REUSADOS (no se duplicó lógica)
- **`CardProductResolverService.resolveCardProductsForSet(localSetId)`** — EL MISMO resolver del sync
  (§4.27d). Ya operaba sobre las `Card` existentes en BD (`card.findMany({where:{setId}})`) y **solo**
  usa TCGCSV: no hubo que extraer nada. Hace los 3 pasos: (1) upsert `CardProduct` por `productId`
  EXACTO (jamás funde por número ⇒ `normal` fantasma imposible), (2) `FinishReconciler.reconcile(...)`
  recomputa `Card.availableFinishes`, (3) `PriceReference` por variante (`source=tcgcsv_singles`, FX
  Banxico, money-safe).
- **`FinishReconciler`** y el **ingest de precio por variante** (M-31): invocados dentro del resolver;
  sin cambios.
- **Cambio aditivo mínimo en el resolver:** su retorno gana un campo `pricesPending` (cuenta las
  variantes con `marketPrice` null/≤0 que ya se OMITÍAN por money-safe). No altera comportamiento; solo
  expone al resumen el `pending`. Todos los tests previos del resolver siguen verdes.

### Confirmación: NO llama a pokemontcg.io
- El método `CatalogSyncService.refreshVariants(setId, force)` no invoca ningún método de
  `PokemonTcgIoClient`. Su único upstream es TCGCSV (vía el resolver).
- **Test que lo blinda:** `backend/test/catalog-refresh-variants.spec.ts` espía **todos** los métodos
  del `PokemonTcgIoClient` (`getSets`, `getCardsBySet`) y verifica en CADA caso (éxito, SET_NOT_IMPORTED,
  UPSTREAM_ERROR, pending, groupId no resuelto, validación) que **no se invocan**.

### Guard de degradado TCGCSV
- Nuevo helper privado `withTcgcsvGuard<T>()` en `catalog-sync.service.ts` — HERMANO del
  `withUpstreamGuard` existente (que es para pokemontcg.io). Remapea fallo NO-Business a
  `BusinessException(UPSTREAM_ERROR, 502, "Fuente TCGCSV no disponible...")`; preserva una
  `BusinessException` ya formada (`SET_NOT_IMPORTED`, `VALIDATION_ERROR`).

**⚠️ PENDIENTE PARA EL ARQUITECTO — formalizar 2 códigos + el endpoint en el contrato.**
- Añadir `UPSTREAM_ERROR` (ya pendiente, ver §0-ter) **y `SET_NOT_IMPORTED`** a `ErrorCode` en
  `common/error-codes.ts`, y quitar los casts `as ErrorCodeType` (mismo patrón vigente). No bloquea.
- Formalizar `POST /admin/catalog/refresh-variants` (ruta/body/respuesta/errores de arriba) en
  `API_CONTRACT.md` §M2 para que **frontend** lo consuma. Backend NO toca `API_CONTRACT.md` (regla 9).

**Archivos tocados (solo `backend/`):**
- `src/modules/catalog/catalog-sync.service.ts` — método `refreshVariants` + guard `withTcgcsvGuard`
  + const `SET_NOT_IMPORTED`.
- `src/modules/catalog/admin-catalog.controller.ts` — endpoint `refresh-variants` + `RefreshVariantsDto`.
- `src/modules/catalog/card-product-resolver.service.ts` — retorno aditivo `pricesPending`.
- `test/catalog-refresh-variants.spec.ts` — 7 tests nuevos.

**Gates (números reales, esta rama):** `tsc --noEmit` OK · `eslint` OK · `nest build` OK ·
`jest` **152 suites / 1423 tests verdes** (1416 previos + 7 nuevos). No se despliega (lo coordina el
orquestador).

## 0-quater. M-35 — `POST /admin/catalog/refresh-variants-all`: versión BATCH del refresh solo-TCGCSV (backfill del catálogo viejo)

> Rama `fix/variant-composition-regression`. Endpoint admin NUEVO, aditivo, **money-safe**. Solo
> `backend/`. Es la versión BATCH del `refresh-variants` (§0-bis, M-34): corre, sobre **TODOS los
> sets ya importados**, el MISMO refresh solo-TCGCSV por-set, para backfillear el catálogo viejo que
> arrastra el `normal` fantasma pre-M-31. **NUNCA toca pokemontcg.io** — ni siquiera para listar
> sets (la lista sale de BD local). Réplica del modelo de ejecución/progreso de `sync-all`.

**Motivo.** El `refresh-variants` por-set (M-34) arregla UN set a la vez; hay decenas de sets viejos
importados con el `normal` fantasma. Este batch los recorre TODOS en un solo disparo, respetuoso con
tcgcsv.com (delay entre sets) y **resiliente por-set** (el fallo de un set no aborta el barrido).

### Firma exacta (pendiente de formalizar en `API_CONTRACT.md` por el arquitecto)
- **Ruta:** `POST /api/v1/admin/catalog/refresh-variants-all`
- **Auth/rol:** `@Roles(super_admin)`. Auditado (`AuditLog action=catalog.refresh_variants_all`,
  entityType `CardSet`, con `jobId/setsQueued/remaining/force`).
- **HTTP de éxito:** `202` (NO bloqueante, fire-and-forget — MISMO patrón que `sync-all`).
- **Body:**
  ```jsonc
  {
    "force": false   // OPCIONAL, default false. Aceptado por simetría con refresh-variants/sync-all.
  }
  ```
  (También acepta `?force=true` por query, igual que `sync-all`/`backfill`.)
- **Respuesta 202 (encolado, igual shape que `sync-all`):**
  ```jsonc
  {
    "jobId": "catalog-refresh-variants-all-1690000000000",
    "setsQueued": 37,   // # de sets importados (cards>0) encolados en este barrido
    "remaining": 0      // 0: se encolan todos; >0 solo si ya había un barrido en curso (single-flight)
  }
  ```

### Progreso + resumen agregado (MISMO mecanismo que `sync-all`)
- **Ruta:** `GET /api/v1/admin/catalog/refresh-variants-status` — HERMANO de `GET .../sync-status`.
  Pensado para POLLING/keep-alive del front: **NO se audita** y **NO llama a ningún upstream** (lee
  estado en memoria del proceso). `@Roles(super_admin)`.
- **Respuesta:**
  ```jsonc
  {
    "running": false,          // true mientras el barrido corre; single-flight contra sí mismo
    "jobId": "catalog-refresh-variants-all-1690000000000",
    "total": 37,               // sets a procesar (barra honesta done/total en SETS)
    "done": 37,                // sets INTENTADOS (éxito o fallo)
    "startedAt": "2026-08-22T...Z",
    "finishedAt": "2026-08-22T...Z",   // null mientras running=true; se fija al terminar
    // summary === null hasta que ARRANCA el primer barrido (backend recién levantado, ningún batch
    // disparado). En cuanto un barrido arranca/corre se puebla (ceros → agregado) y ya no vuelve a null.
    "summary": {
      "setsTotal": 37,
      "setsOk": 35,
      "setsFailed": 2,
      "cardProductsUpserted": 1234,   // suma de los sets OK
      "pricesUpserted": 2100,         // suma de los sets OK
      "pending": 180,                 // suma de variantes sin precio ⇒ «—»/PRICE_PENDING (jamás 0)
      "failures": [
        { "setId": "base1", "code": "UPSTREAM_ERROR", "message": "Fuente TCGCSV no disponible; ..." }
      ]
    }
  }
  ```
- El front consume esto igual que `sync-all`: dispara el `POST` (202), luego hace poll de
  `refresh-variants-status` con keep-alive hasta `running=false`, y lee el `summary` para el veredicto.

### Comportamiento
- **Universo = sets IMPORTADOS de BD local:** `cardSet.findMany` filtrado a `_count.cards > 0`. La
  lista de sets **NO** sale de pokemontcg.io ni de TCGCSV: es puramente local.
- **Reusa `refreshVariants(externalId, force)` por-set** (no se duplicó lógica): el mismo camino
  M-34 (resolver TCGCSV → FinishReconciler → precio por variante, money-safe, guard `withTcgcsvGuard`).
- **Pausado/respetuoso con TCGCSV:** delay entre sets (no tras el último), configurable por env
  `CATALOG_REFRESH_VARIANTS_BATCH_DELAY_MS` (default **250ms**). El User-Agent ya lo pone el cliente.
- **Resiliente por-set:** cada set se ejecuta en su try/catch. Un fallo (502 UPSTREAM_ERROR de TCGCSV,
  grupo no espejado, SET_NOT_IMPORTED por carrera) **NO aborta** el barrido: se captura el `code` (de la
  `BusinessException`) + `message`, se acumula en `summary.failures`, se loguea `warn` y se sigue.
- **Single-flight:** mientras `running=true` un segundo `POST` no lanza otro barrido (devuelve
  `setsQueued:0`, `remaining=<pendientes>`). Independiente del single-flight de `sync-all` (estados
  separados; se pueden solapar pues este solo toca TCGCSV).
- **Money-safe intacto:** cada set delega en `refreshVariants`/resolver, que hace TODO el fetch TCGCSV
  ANTES de escribir; un fallo remoto no borra ni escribe nada. Variante sin precio ⇒ `pending`/«—», jamás 0.
- **`summary` null hasta el primer barrido (fix QA M-35, `fix/variant-composition-regression`):** el estado
  arranca con `summary: null` y `getRefreshVariantsAllStatus()` lo expone tal cual mientras NINGÚN batch se
  haya disparado (contrato `RefreshVariantsStatusResponse.summary: RefreshVariantsSummary | null`, alineado
  al mock del front). Así, con el backend recién levantado, M2 **no** pinta un banner verde falso
  «Listo — 0/0 sets». En cuanto un barrido arranca (`refreshVariantsAll` fija `summary` en ceros con
  `setsTotal`) o corre (`runRefreshVariantsAll` lo inicializa si se invoca directo) el `summary` queda
  poblado y ya no vuelve a null: expone el progreso/último barrido. Blindado por el test
  `summary === null hasta que termina un batch; poblado después del barrido`.

### Confirmación: NO llama a pokemontcg.io
- Ni `refreshVariantsAll` (lista desde BD) ni `runRefreshVariantsAll` (delega en `refreshVariants`)
  invocan `PokemonTcgIoClient`. Su único upstream es TCGCSV (vía el resolver).
- **Test que lo blinda:** `backend/test/catalog-refresh-variants-all.spec.ts` espía **todos** los
  métodos del `PokemonTcgIoClient` y verifica en CADA caso (encolado, single-flight, barrido con set
  que falla, resumen agregado, delay, progreso, money-safe/pending, groupId nulo) que **no se invocan**.

**⚠️ PENDIENTE PARA EL ARQUITECTO — formalizar en el contrato.**
- Formalizar `POST /admin/catalog/refresh-variants-all` + `GET /admin/catalog/refresh-variants-status`
  (ruta/body/respuesta 202/progreso/errores de arriba) en `API_CONTRACT.md` §M2, para que **frontend**
  los consuma. Backend NO toca `API_CONTRACT.md` (regla 9). Mismos códigos por-set que M-34
  (`UPSTREAM_ERROR`/`SET_NOT_IMPORTED`, aún pendientes en `common/error-codes.ts`) — aquí NO se propagan
  como HTTP: se capturan por-set y se reportan en `summary.failures`.

**Archivos tocados (solo `backend/`):**
- `src/modules/catalog/catalog-sync.service.ts` — estado `refreshVariantsAllStatus` +
  `getRefreshVariantsAllStatus()` + `refreshVariantsAll()` + `runRefreshVariantsAll()` + `sleep()`
  protegido + const de delay. Reusa `refreshVariants` (M-34) sin duplicar.
- `src/modules/catalog/admin-catalog.controller.ts` — endpoints `refresh-variants-all` (202, auditado)
  y `refresh-variants-status` (GET, no auditado) + `RefreshVariantsAllDto`.
- `test/catalog-refresh-variants-all.spec.ts` — 9 tests (8 iniciales + 1 del `summary` null, fix QA).

**Fix QA M-35 (rama `fix/variant-composition-regression`):**
- **Bloqueante — `summary` null hasta el primer batch:** `refreshVariantsAllStatus.summary` ahora arranca
  en `null` (antes se inicializaba en ceros); `getRefreshVariantsAllStatus()` expone `null` mientras no haya
  arrancado ningún barrido y el objeto poblado una vez arranca/corre uno (helper
  `emptyRefreshVariantsSummary()` centraliza el objeto en ceros). Test nuevo lo blinda.
- **Menor — JSDoc:** el header de `refreshVariants` (~:173) decía `SET_NOT_IMPORTED (404)` pero el código
  lanza **409 CONFLICT** a propósito (:208, para no colisionar con `isEndpointMissing` del front); JSDoc
  corregido a 409 con la razón.
- **Deuda registrada en `TECH_DEBT.md`:** BE-11 y BE-21 ampliadas para nombrar también
  `refreshVariantsAllStatus`; **BE-77** (los dos barridos no son mutuamente exclusivos server-side, solo el
  front los serializa) y **BE-78** (tres copias del patrón sweep-en-memoria → extraer `InMemorySweep`).

**Gates (números reales, tras el fix QA):** `tsc --noEmit` OK · `eslint` OK · `nest build` OK ·
`jest` **153 suites / 1432 tests verdes** (1431 previos + 1 nuevo del `summary` null). No se despliega
(lo coordina el orquestador).

## 0-ter. fix/variant-composition-regression — robustez del sync por-set ante fallos de fuentes externas

> Rama `fix/variant-composition-regression`. Dos arreglos de **bajo riesgo**, reversibles y
> **money-safe** (fase de METADATA, no tocan precios). Solo `backend/`. Diagnóstico previo con
> archivo:línea.

**FIX 1 — `User-Agent` identificable en el cliente HTTP base de TCGCSV.**
- Archivo: `backend/src/modules/pricing/providers/tcgcsv-http.client.ts` (método `getJson`, ~línea 37).
- Antes: la request a `tcgcsv.com/tcgplayer/...` mandaba **solo** `Accept: application/json` y NINGÚN
  `User-Agent` → varias CDNs devuelven 401/403 al UA por defecto de Node/undici. En prod,
  `tcgcsv.com/tcgplayer/3/24688/products` devolvió **HTTP 401**.
- Ahora: `headers: { Accept: 'application/json', 'User-Agent': 'tcg-vault-mx/1.0 (+https://tcghunt.mx)' }`.
- Alcance: este cliente es la **base COMPARTIDA** de singles Y sellado (`TcgcsvCatalogClient` +
  `TcgcsvSealedBulkProvider`), así que el UA aplica por igual a ambos — es lo correcto. Sin cambio de
  seguridad (host fijo, `redirect:'error'`, timeout, anti-SSRF intactos).

**FIX 2 — degradado elegante del 5xx de pokemontcg.io en el sync single (500 crudo → 502 accionable).**
- Archivo: `backend/src/modules/catalog/catalog-sync.service.ts`, método `importSetByExternalId`
  (llamado por `sync(setId)` — el botón por-set de M2).
- Antes: cuando pokemontcg.io caía (HTTP 500/502), el `Error` crudo del cliente
  (`pokemontcg.io ... -> HTTP 5xx`) subía **sin manejar** y salía como **500 "Error del servidor"**, a
  diferencia de `remoteSets()` que SÍ degrada.
- Ahora: nuevo helper privado `withUpstreamGuard<T>()` envuelve las dos llamadas upstream
  (`client.getCardsBySet(setId, 1)` y `importRemainingPages(...)`) y remapea cualquier fallo NO-Business a
  `BusinessException(UPSTREAM_ERROR, HttpStatus.BAD_GATEWAY /* 502 */, "Fuente pokemontcg.io no disponible
  (HTTP 5xx); reintenta en unos minutos (...)")`. Una `BusinessException` que ya venga (p. ej.
  `VALIDATION_ERROR` del setId) se **PRESERVA** (no se re-envuelve). Money-safe: es fase de metadata.
- Test añadido: `backend/test/catalog-sync.spec.ts` — «fallo upstream de pokemontcg.io (HTTP 5xx) → 502
  UPSTREAM_ERROR accionable»: el cliente lanza `Error('... -> HTTP 500')` y se verifica
  `BusinessException` con `code=UPSTREAM_ERROR` y `getStatus()===502` (no 500 crudo).

**⚠️ PENDIENTE PARA EL ARQUITECTO — formalizar `UPSTREAM_ERROR` en el enum central.**
- `UPSTREAM_ERROR` (502) YA está en el contrato (§M2, explorador TCGCSV) y en uso vigente en
  `sealed-pricing.controller.ts` mediante el **mismo patrón** `const UPSTREAM_ERROR = 'UPSTREAM_ERROR' as
  ErrorCodeType`. Aquí se replicó ese cast en `catalog-sync.service.ts` para NO cambiar el contrato ni la
  zona compartida `common/error-codes.ts` desde este hotfix. **Follow-up de 1 línea**: añadir
  `UPSTREAM_ERROR` a `ErrorCode` en `common/error-codes.ts` y quitar los dos casts (sealed + catalog-sync).
  No bloquea el hotfix.

**Gates (números reales, esta rama):** `tsc --noEmit` OK · `eslint` OK · `nest build` OK ·
`jest` **151 suites / 1415 tests verdes** (1414 previos + 1 nuevo). No se despliega (lo coordina el
orquestador).

## 0-quater. BUG M-33 — el índice único VIEJO de 5 campos de `PriceReference` sobrevivió a M-31 (fix en prod)

> Rama `fix/variant-composition-regression`. Migración **correctiva** de 1 línea + cierre de brecha de
> test. Money-safe (solo dropea un índice redundante e incompatible; ninguna fila se toca). Solo
> `backend/`. **No modifica el contrato ni el schema** (el `@@unique` ya era el de 6 campos desde M-31).

**Síntoma en prod (evidencia dura, log Railway, resolver TCGCSV en `me5`/Pitch Black):**
```
importSet: resolver estructural TCGCSV falló para me5 (
Invalid `prisma.priceReference.upsert()` invocation:
Unique constraint failed on the fields: (`cardId`,`productType`,`gradeKey`,`finish`,`capturedDate`)
)
```
Consecuencia en cadena: el upsert de precio por variante reventaba → el resolver abortaba → **NO se creaba
`CardProduct`** (el reconciler logueaba "N cartas sin CardProduct (legacy) conservaron su availableFinishes
previo") → el `normal` fantasma persistía y no se encolaban precios. (No abortaba el import completo: el
resolver es best-effort/money-safe.)

**Causa raíz (confirmada por lectura de las migraciones):**
- El `@@unique` de `PriceReference` cambió de **5 → 6 campos** en M-31 (añadió `cardProductId`, §4.27b):
  `@@unique([cardId, productType, gradeKey, finish, capturedDate, cardProductId])` (schema `:707`).
- El índice de 6 campos SÍ se creó bien en M-31 (`PriceReference_variant_capturedDate_key`, `NULLS NOT
  DISTINCT`, migración M-31 líneas 86-88).
- **PERO** M-31 intentó dropear el índice VIEJO de 5 campos con un **nombre MAL TRUNCADO**:
  `DROP INDEX IF EXISTS "PriceReference_cardId_productType_gradeKey_finish_capturedDa_key";` (M-31 `:79`).
  Ese nombre **no existe**. El índice REAL lo creó **M-18** (`20260816160000_m18_finish/migration.sql:25`)
  con el nombre que Prisma trunca a 63 chars:
  **`PriceReference_cardId_productType_gradeKey_finish_capturedD_key`** — `capturedD`, **no** `capturedDa`
  (Prisma corta en `capturedD` para caber en 63; M-31 escribió `capturedDa`, 64 chars, que nunca fue el
  nombre real). Al no coincidir, el `DROP INDEX IF EXISTS` fue un **no-op silencioso**: el viejo de 5
  campos SOBREVIVIÓ y coexistió con el de 6.
- El viejo de 5 campos bloquea a DOS `CardProduct` de la MISMA carta que comparten
  `(cardId, productType, gradeKey, finish, capturedDate)` con distinto `cardProductId` — justo el caso
  `set_base` + `deck_exclusive`, o dos variantes del mismo finish. El segundo `INSERT` del upsert chocaba.

**El `where` del upsert YA era correcto** (no requirió cambio): `card-product-resolver.service.ts:158-183`
usa la clave compuesta de **6 campos**
`cardId_productType_gradeKey_finish_capturedDate_cardProductId`. El fallo era en el CREATE contra el
constraint de BD viejo, no en la clave de la app.

**Fix — migración correctiva `20260822140000_m33_drop_old_pricereference_unique/migration.sql`:**
```sql
DROP INDEX IF EXISTS "PriceReference_cardId_productType_gradeKey_finish_capturedD_key";
```
Idempotente (`IF EXISTS`). Deja SOLO la unicidad de 6 campos, que es estrictamente suficiente contra
duplicados reales (para `cardProductId=NULL` el índice `NULLS NOT DISTINCT` se comporta como antes de M-31;
para SINGLES el `cardProductId` es el ancla exacta). **Rollback** documentado en el encabezado de la
migración: recrear el índice viejo REINTRODUCE el bug (es incompatible con el modelo N-productos-por-carta);
solo revertir junto con un rollback total de M-31.

**Otros `@@unique` que M-31/M-32 tocaron — revisados, SIN riesgo latente del mismo patrón:**
- **`VariantPriceOverride`** (M-30, `@@unique([cardId, productType, gradeKey, finish])`): tabla **nueva**,
  índice creado fresco; no había índice viejo que dropear. Sin riesgo.
- **`SellRequestItem.cardProductId`** y **`PendingPriceEntry.cardProductId`** (M-32): son columnas nuevas
  que entran a una clave **LÓGICA de dedupe a nivel de aplicación**, NO a un `@@unique` de BD (ninguna de
  las dos tablas tiene un `@@unique` que incluya `cardProductId`; `PendingPriceEntry` solo tiene
  `@@index([status])`, `SellRequestItem` no tiene `@@unique` de dedupe por producto). No cambió ningún
  índice único de BD ⇒ sin riesgo. (El `unique_source_sell_request_item` es sobre
  `InventoryItem.sourceSellRequestItemId`, no relacionado.)
- Conclusión: **solo** `PriceReference` sufrió el "aditiva sin drop efectivo". La migración M-33 dropea ese
  único índice; NO toca ningún constraint que no cambió.

**Brecha de test cerrada (por qué los unitarios no lo cacharon):** los tests de
`card-product-resolver.spec.ts` usan **Prisma MOCKEADO** — el mock nunca aplica constraints de BD, así que
la colisión del índice era invisible. Dos frentes:
- **(a) Unitario nuevo** en `backend/test/card-product-resolver.spec.ts` — «REGRESIÓN M-33: dos productos
  de la MISMA carta con el MISMO finish ⇒ 2 upserts con la CLAVE de 6 campos (distinto cardProductId), sin
  colisión lógica». Fija que el código usa la clave de 6 campos (`...capturedDate_cardProductId`) y NUNCA
  la vieja de 5; blinda contra un futuro cambio del `where`.
- **(b) Integración (Postgres REAL)** nuevo:
  `backend/test/integration/price-reference-variant-unique.e2e-spec.ts` — inserta DOS `PriceReference` de
  la misma carta con el MISMO 5-tuple y distinto `cardProductId` y verifica que AMBAS persisten (con el
  índice viejo vivo, la segunda reventaría con P2002). Incluye idempotencia por la clave de 6 campos y el
  `NULLS NOT DISTINCT` (vía SQL crudo, porque el cliente tipado de Prisma no permite apuntar
  `cardProductId=NULL` en un compound-unique). **PENDIENTE CI:** este spec corre bajo
  `npm run test:integration` (`test/integration/*.e2e-spec.ts`, requiere Postgres con `prisma migrate
  deploy`), que **no** corre en el `jest` unitario. Debe cablearse/ejecutarse en el job E2E de CI para que
  este tipo de regresión de constraint se cache automáticamente. Es la lección: **un cambio de `@@unique`
  necesita un test de integración con Postgres real, no basta el mock.**

**Nota de proceso (para el arquitecto/techlead):** el patrón "migración aditiva que NO dropea el índice
viejo" es peligroso cuando el nombre del índice a dropear se escribe a mano y Prisma lo trunca a 63 chars.
Recomendación: cuando una migración cambie un `@@unique`, generar el nombre a dropear con
`prisma migrate diff` (o copiarlo verbatim de la migración que lo creó) en vez de teclearlo.

**Gates (números reales, M-33):** `tsc --noEmit` OK · `eslint` OK · `nest build` OK ·
`jest` **151 suites / 1416 tests verdes** (1415 previos + 1 nuevo unitario de regresión). El spec de
integración con Postgres real (`price-reference-variant-unique.e2e-spec.ts`) NO corre en el `jest`
unitario — pendiente de ejecutarse en el job E2E de CI (`npm run test:integration`). No se despliega (lo
coordina el orquestador).

## 0-bis. v1.30-buylist-quote-por-producto — LÍNEA de buylist por `productId` (M-32)

> Implementa ARCHITECTURE §4.29 y el Changelog v1.30 de API_CONTRACT. Rama
> `fix/variant-composition-regression`. Todo ADITIVO/retrocompatible/money-safe; NO se dropea nada. Cierra
> el hueco de que el quote/carrito de buylist solo se identificaban por `(cardId, finish)` y no podían
> cotizar/vender un `CardProduct` SEPARADO (deck_exclusive/promo) como línea propia con su precio.

**Qué cambió (resumen para otros roles):**
- **`productId?: number` OPCIONAL/ADITIVO** en la línea de buylist — es el **TCGplayer productId**
  (`== CardProduct.tcgplayerProductId`, el MISMO que el front recibe en `CardProductDTO.productId` /
  `separateProducts`), **no** el UUID interno. Añadido a la ENTRADA de `POST /buylist/quote`
  (`PublicQuoteDto`), `POST /buylist/quote/batch` (`BuylistQuoteItemDto`) y `POST /buylist/requests`
  (`RequestItemDto`), y como ECO en `BuylistQuotePayload` (quote/batch) y `SellItemDTO`
  (`itemDTO`). Validación DTO: `@IsInt() @Min(1)` (entero positivo).
- **Resolución (§4.29b, `buylist.service.ts`):**
  - **SIN `productId`** → rama SET_BASE **idéntica a v1.29** (whitelist `Card.availableFinishes`,
    referencia por `(cardId, raw, raw:NM, finish)` vía `getReference`, override M-30 como hoy). Cero
    cambios de comportamiento; los 1408 tests previos siguen verdes.
  - **CON `productId`** → la línea es ESE `CardProduct`: whitelist de acabado = **`CardProduct.finishes`**
    (`assertFinishForProduct`; un solo acabado + `finish` omitido ⇒ default; >1 ⇒ `finish` OBLIGATORIO,
    falta/no-pertenece ⇒ `FINISH_NOT_AVAILABLE`); referencia leída por **ese `cardProductId`** vía el
    método nuevo `PricingService.getReferenceByCardProduct` (filtra `PriceReference.cardProductId`, precio
    propio del producto de M-31). La **rareza NO cambia de fuente** (sigue saliendo de `Card.rarity`).
- **Money-safe / validación (§4.29c):**
  - `productId` inexistente ⇒ **`PRODUCT_NOT_FOUND`**; `productId` que NO cuelga del `cardId` ⇒
    **`PRODUCT_CARD_MISMATCH`** (rechazo validado, NUNCA fusión silenciosa con la carta de set). Ambos
    son **422** en `/quote` por-carta y `/requests`; **`ok:false` por-ítem** en `/quote/batch` (no tumban
    el lote — se añadieron al set de códigos degradables del `catch`). Nuevos códigos en
    `common/error-codes.ts`.
  - Producto sin precio ⇒ `precio_pendiente` / `quotedPriceCents=null` / «—», **jamás 0** (misma
    invariante H1/H2/H3). Regla `fixed` siempre cotiza; `pct` sin referencia del producto cae en pendiente.
  - **Override M-30 (bounty/variant) NO aplica a la rama `productId`** (se pasa `null`): su clave
    `(cardId, productType, gradeKey, finish)` NO tiene `cardProductId`, así que mapea a la variante
    set_base; aplicarlo al producto separado sería fusión de precios. Decisión money-safe conservadora —
    **si el PO/arquitecto quiere bounties por producto separado, requiere extender la clave de M-30**
    (fuera de alcance de M-32). Anotado como salvedad abajo.
- **Unicidad de línea (§4.29d):** la llave lógica gana `productId` → `(cardId, finish, productId ?? base)`.
  Dos líneas con mismo `(cardId, finish)` y distinto `productId` son **DISTINTAS** (no se deduplican).
  En batch la correlación sigue siendo el `index`.
- **Persistencia (migración M-32, ADITIVA):**
  - `SellRequestItem.cardProductId Int?` — snapshot del `tcgplayerProductId` cotizado (`null` = set_base).
  - `PendingPriceEntry.cardProductId Int?` — entra a la **clave lógica de dedupe** de la cola de precio
    pendiente: `escalatePending` ahora incluye `cardProductId` en el `findFirst`/`create`, de modo que
    resolver el set_base NO cierra la del Deck Exclusive (money-safe). Param opcional al final con default
    `null` ⇒ los ~8 llamadores previos quedan intactos.
  - Migración: `prisma/migrations/20260822130000_m32_sell_item_card_product_id/migration.sql` (dos
    `ADD COLUMN INTEGER` nullable, SIN backfill). **NO aplicada contra prod** (no había `DATABASE_URL` en
    el entorno). `prisma generate` corrido OK.

**Fuera de alcance (confirmado con §4.29e y el changelog M-32):**
- El **carrito de storefront** NO cambia (se identifica por `inventoryItemId`).
- **No** se propaga `cardProductId` al `InventoryItem` al convertir (M5). El campo existente
  `InventoryItem.tcgplayerProductId` tiene **semántica de SELLADO** (mapeo curado TCGCSV, emparejado con
  `tcgplayerGroupId`); reutilizarlo para un single de producto separado lo sobrecargaría y podría afectar
  las colas de mapeo de sellado. El changelog M-32 marca esta propagación como **decisión opcional del
  backend**; se **difiere** (no la exige el contrato). La valuación de un single de producto separado en
  bóveda/storefront (§4.29e menciona `PriceReference.cardProductId` de la pieza) queda como **gap
  preexistente de M-31 fuera del alcance de M-32** (M-32 es solo la LÍNEA de buylist). **Salvedad para
  arquitecto** si se quiere cerrar ese eje.

**Tests (`test/buylist.product-line.spec.ts`, 13 casos, todos verdes):** quote por-carta y batch CON/SIN
`productId`; default de finish con un solo acabado; `FINISH_NOT_AVAILABLE` (>1 acabado sin finish y finish
fuera de lista); `PRODUCT_NOT_FOUND`; `PRODUCT_CARD_MISMATCH` (sin caer al set_base); producto sin precio →
pendiente; **unicidad** (dos líneas mismo `(cardId, finish)` distinto `productId` → precios distintos);
`createRequest` persiste `cardProductId` + escala pendiente CON `cardProductId`; retrocompat (sin `productId`
no resuelve producto ni snapshotea). Suite completa: **150 suites / 1408 tests verdes**.

---

## 0. v1.29-tcgcsv-productos-por-variante — «1 carta ↔ N productos» + rareza canónica (M-31)

> Implementa ARCHITECTURE §4.27 / §4.28 y el Changelog v1.29 de API_CONTRACT. Rama
> `fix/variant-composition-regression`. Todo ADITIVO/money-safe; NO se dropea ninguna columna.

**Qué cambió (resumen para otros roles):**
- **Composición por `productId` EXACTO (mata el fantasma).** Se retiró `unionStructuralFinishesByCardNumber`
  (unión por número — el bug de 3 rondas) y `StructuralFinishResolverService`. Entran
  `deriveCardProductsFromTcgcsv` (agrupa por `productId`, `tcgcsv-singles.provider.ts`) y
  `CardProductResolverService` (`catalog/card-product-resolver.service.ts`). `Card.availableFinishes`
  se DERIVA DIRECTO de `⋃ CardProduct.finishes (set_base/other)` — sin heurística `isPremiumRarity`
  ni resta de `normal`. La energía especial de Pitch Black queda en **2 casillas** (holofoil,
  reverse_holo), no 3. Los `deck_exclusive`/`promo` NO fusionan sus acabados: se exponen como
  **productos vendibles separados** (`MasterSetCardCellDTO.separateProducts: CardProductDTO[]`).
- **Precio por VARIANTE desde TCGCSV (fuente primaria).** El resolver persiste una `PriceReference`
  por `(cardProduct, finish)` con `source=tcgcsv_singles`, leyendo `marketPrice` por `subTypeName` y
  convirtiendo USD→MXN con el **módulo Banxico existente** (`FxService.getCurrent` + `usdToMxnCents`,
  no se inventó FX). PPT baja a **fallback** (`persistMarketReference` con `cardProductId=null`).
  Precedencia de fuente: override manual > `tcgcsv_singles` > `tcgcsv` (sellado) > PPT > pokemontcg.io.
  **Money-safe DURO:** variante sin precio ⇒ celda `null`/«—» + PRICE_PENDING, JAMÁS 0.
- **Catálogo canónico de rarezas** (`common/rarity-catalog.ts`): `CANONICAL_RARITIES`, `normalizeRarity`,
  `isPremiumCanonicalRarity`. `Card.rarityCanonical` se puebla en el ingest; el admin
  (`GET /admin/pricing/rarities` y su eco de ventas) agrupa por `rarityCanonical` (empate 1:1 con las
  keys que edita). **UNA sola definición de «premium»**: se retiraron `PREMIUM_RARITY_PATTERNS`
  (money.ts) y `PREMIUM_RARITY_TERMS` (ppt-sync-scope.ts); ambos DELEGAN en el catálogo.
- **Reglas de precio en DOS EJES** (§4.28d): `PriceRuleSet { rarityRules, finishRules, fallbackPct }`
  reemplaza el mapa plano que mezclaba rareza y acabado. `GET/PUT /admin/pricing/buylist-rules` y
  `sales-rules` sirven/guardan la nueva forma; el legacy plano se **migra on-read** (`toPriceRuleSet`,
  `money.ts`), así que la config de prod existente sigue funcionando sin intervención.

**Migración M-31** (`prisma/migrations/20260822120000_m31_card_products_rarity_canonical/`):
- Enum `CardProductKind`; tabla `CardProduct` (unique por `tcgplayerProductId`, FK→Card);
  `PriceReference.cardProductId String?` + FK; `PriceSource += tcgcsv_singles`; `Card.rarityCanonical String?`.
- La `@@unique` de `PriceReference` pasa a `[cardId, productType, gradeKey, finish, capturedDate, cardProductId]`.
- **Backfills:** `CardProduct` set_base desde `Card.tcgplayerId` numérico + `structuralFinishes`;
  `rarityCanonical` sembrado con el `rarity` CRUDO (transitorio money-safe; el normalizador fino corre
  en el re-sync por set / el data-migration).
- **NO aplicada contra prod** (ni ninguna BD): solo generada + `prisma generate`. Aplicar con
  `prisma migrate deploy` en el deploy (devops).

**Salvedad Prisma / índice (IMPORTANTE para devops):** el índice único de `PriceReference` se crea con
`NULLS NOT DISTINCT` (**requiere PostgreSQL 15+**) para que las filas con `cardProductId=NULL`
(graded/sealed/fallback PPT) mantengan «un renglón/día como hoy». Además, como el runtime de Prisma
**no tipa `null` en la clave compuesta**, los upserts del camino NULL (`persistMarketReference`,
`persistSealedMarketReference`, `manualOverride`, `syncCardPrice`) se hicieron con `findFirst` +
`create`/`update` (el resolver de singles, con `cardProductId` no-null, sí usa el upsert compuesto).
Si el motor fuera **< PG15**, sustituir el índice por uno normal y confiar en la invariante de upsert
a nivel de aplicación (ya vigente). Ver §0.1 (deuda) y la migración.

**Deuda (para `TECH_DEBT.md`, a petición del techlead — dueño = backend):**
- Dropear las columnas MUERTAS `Card.structuralFinishes` / `catalogFinishes` / `pricedFinishesSnapshot`
  en una migración POSTERIOR, tras validar en prod (se conservan en M-31 por reversibilidad).
- Retirar `Card.tcgplayerId` (DEPRECADO, reemplazado por `CardProduct.tcgplayerProductId`) y el campo
  `displayFinishes` del contrato (= `availableFinishes`) en la siguiente rev de front.
- Proceso «añadir rareza nueva al catálogo canónico» (R-5): una rareza no mapeada entra `unmapped`
  (fallback pct, visible al admin) hasta agregarla a `CANONICAL_RARITIES`.

**Riesgos / pendientes abiertos (necesitan validación con egress o decisión del arquitecto):**
- **R-1 (no verificable sin egress):** ¿el producto «Deck Exclusives» cae en el MISMO `groupId` TCGCSV
  del set? El resolver solo fetchea el grupo del set. Si TCGplayer lo coloca en OTRO grupo, hay que
  ampliar el fetch a grupos hermanos. **Se decide con el `--force` de Pitch Black (groupId 24688) en
  staging.** Reversible; documentado. Hasta confirmarlo, un Deck Exclusive en otro grupo quedaría sin
  colgar (money-safe: no rompe nada, solo no aparece como producto separado).
- **Consecuencia de unificar «premium» (R-4, cerrado por el PO = UN atributo):** `ppt-sync-scope`
  ya NO clasifica «Rare Holo» plano como premium (sigue la semántica de buylist de money.ts). Efecto:
  algunos holos de set VIEJO que antes entraban al scope `partial` de PPT por su rareza ahora dependen
  de tener inventario activo; los cubre el re-sync TCGCSV (fuente primaria gratis). Sin impacto de dinero.

## 0.1 Estado de gates v1.29 (para QA/techlead)

- `npm run build` (nest build): **OK**.
- `npx tsc --noEmit`: **0 errores**.
- `npm run lint` (eslint): **0 errores, 0 warnings**.
- `npx jest`: **149 suites / 1395 tests — todos verdes** (incluye los nuevos:
  `card-product-resolver.spec`, `tcgcsv-singles.provider.spec` (derive+kind+fantasma),
  `finish-reconciler.spec` (deriva de CardProduct), reglas de dos ejes y rarezas canónicas en
  `pricing.buylist-rules.spec`/`pricing.sales-rules.spec`, unificación de premium en `ppt-sync-scope.spec`).
- Validación barata exigida por el PO (§4.27h): el resolver corre por-set vía
  `POST /admin/catalog/sync {setId, force:true}` — **NO ejecutado contra prod** (sin egress a
  tcgcsv.com en dev/CI); cubierto por tests con las fixtures `test/fixtures/tcgcsv/` y fixtures inline
  del caso Pitch Black (2 productos que comparten número ⇒ sin fantasma).

## 1. Cómo correr

```bash
cd backend
npm install
npx prisma generate                 # genera el cliente Prisma
# Infra local (desde la raíz del repo): docker compose up -d   (postgres/redis/minio)
cp ../.env.example ../.env           # rellena secretos; los valores "(local ok)" ya sirven
npx prisma migrate deploy            # aplica migraciones (crea tablas + secuencia de folios)
npm run seed                         # diales M10 + super_admin + datos de ejemplo
npm run start:dev                    # API en http://localhost:3001/api/v1
```

- **Prefijo de API:** `/api/v1` (todas las rutas). Coincide con el contrato.
- **Puerto:** `3001` (coincide con `Dockerfile.backend` y `docker-compose.yml`).
- **Usuarios sembrados (SEC-C1 — ya NO hay contraseñas hardcodeadas):**
  - `admin@tcg.local` (super_admin) — password **obligatoria por `SEED_ADMIN_PASSWORD`**
    (email configurable por `SEED_ADMIN_EMAIL`).
  - `operador@tcg.local` (vault_operator) — password **obligatoria por `SEED_OPERATOR_PASSWORD`**
    (email configurable por `SEED_OPERATOR_EMAIL`).
  - En entornos **no-locales** (`NODE_ENV` ≠ `development`/`test`/`local`) el seed **falla** si
    esas envs faltan (sin defaults débiles). En local, si faltan, usa un fallback **solo-desarrollo**
    (aleatorio) y avisa por consola — nunca reutilizable fuera de local.

## 2. Cómo testear

```bash
npm test               # unit + smoke de DI (59 tests). NO requiere Postgres/Redis/MinIO.
npm run test:integration  # E2E contra infra REAL (Postgres/Redis/MinIO/Stripe). Ver §8.
npm run lint           # eslint (0 errores)
npm run typecheck      # tsc --noEmit (0 errores)
npm run build          # nest build → dist/
```

- Los tests unitarios usan **Prisma mockeado** (`@nestjs/testing` / jest), así que **corren sin
  infraestructura** (verde en CI sin DB y en local sin Docker). El job de CI de devops levanta
  Postgres+Redis y corre `prisma migrate deploy` antes de `npm test`; nuestros tests no dependen de
  ello, pero la migración valida el schema.
- **Cobertura de tests (lógica crítica, como pidió el encargo):**
  - `test/money.spec.ts` — fórmulas de checkout (**gross-up + IVA 16%**), retiro/envío,
    `AcquisitionPricer` (común/reverse/EX+ y precio pendiente), sale price (markup), aportación 70%,
    FX+colchón. (§5.1 y §4.2 de ARCHITECTURE).
  - `test/payments.service.spec.ts` — ciclo **pending→settled**, **contracargo** (reversión a
    inventario de plataforma), **idempotencia** por `event.id`, y liquidación de envío→picking.
  - `test/money-out.guard.spec.ts` — **`MoneyOutGuard`**: solo `super_admin`; operador/cliente
    reciben `MONEY_OUT_FORBIDDEN` y el intento queda **auditado**.
  - `test/app.module.spec.ts` — smoke del **grafo de DI** completo (detecta wiring roto/ciclos).
- **Suite de integración/E2E** (contrato punta a punta, seguridad, **webhooks reales**) ahora
  vive en `test/integration/*.e2e-spec.ts` y la ejecuta **QA/devops** con `npm run test:integration`
  (infra real). Detalle completo, cobertura y env en **§8**.

## 3. Estado por módulo (completo vs stub/TODO)

| Módulo | Estado | Notas |
|---|---|---|
| **auth** (register/login/refresh/logout) | ✅ Completo | argon2 + JWT access/refresh. `logout` es no-op (JWT stateless; blacklist = fase 2). |
| **users/KYC/addresses/billing** (M6 cliente) | ✅ Completo | Direcciones **solo MX** (`ADDRESS_NOT_MX`). CLABE 18 dígitos (`CLABE_INVALID`). |
| **catalog** (storefront) | ✅ Completo | `ListingDTO` con `referenceValue` (mercado) vs `salePriceCents` (venta). Precio pendiente ⇒ `sellable=false`. |
| **pricing / FX** (M2) | ✅ Lógica completa · ⚠️ providers graded/sealed = **stub** | `PokemonTcgIoProvider` (raw) hace fetch real a pokemontcg.io. `PokemonPriceTracker`/`PokeTrace` devuelven `null` (sin endpoint confirmado) ⇒ **precio pendiente** + **override manual** (que sí funciona). FX Banxico SIE implementado; sin token usa override/último valor. |
| **inventory / vault** (M1) | ✅ Completo | Folio `INV-000123` (secuencia Postgres), ubicaciones jerárquicas, movimientos, mover, marcar pérdida/daño, aportación en especie (ref×pct). |
| **orders / checkout** (M3) | ✅ Completo | `quote`, `session` (reserva + PaymentIntent), breakdown gross-up, `request-invoice`, refund (money-out). |
| **payments / webhooks** | ✅ Completo | Stripe real (lazy client). Webhook firmado + idempotente. succeeded/failed/refunded/dispute. |
| **shipments** (M4) | ✅ Completo | Cobro Stripe **antes** de crear la solicitud; solo `settled`; picking-list por ubicación; captura de guía. |
| **buylist** (M5/E) | ✅ Completo | Cotizador público, topes/INE/CLABE, cherry-pick, convert-to-inventory, pago SPEI (money-out). |
| **disputes** (M8) | ✅ Completo | Ventana 7d desde entrega, disputa por correo (evidencia adjunta), recompra (money-out solo `super_admin`). |
| **uploads** | ✅ Completo | Presigned PUT S3/MinIO acotado a `kyc_ine` (v1.2: sin `dispute_claim`/`inventory_photo`). |
| **admin** (M6/M7/M9 + dashboard) | ✅ Completo | P&L, inventory-value, custody-value, IVA, export CSV, launch-metrics, dashboard 8 tarjetas (dinero enmascarado a `vault_operator`). |
| **settings/audit** (M10) | ✅ Completo | Diales en DB (editables sin redeploy), bitácora global. |
| **jobs** (BullMQ) | ⚠️ **Lógica completa, scheduling pendiente** | `price-sync`, `fx-refresh`, `buylist-sweep`, `dispute-deadline` implementados como servicios ejecutables. La **programación repetible BullMQ/Redis** es un wrapper de despliegue aún **no cableado** (ver §5). `price-sync` y `fx-refresh` se pueden disparar por endpoint admin. |
| **health** (infra) | ✅ Completo | `GET /api/v1/health` **público** (sin auth, sin rate-limit). `SELECT 1` a Postgres + `PING` a Redis opcional. Ver §12. |

## 4. Solicitudes de cambio de contrato al **arquitecto** (no edité el contrato)

1. **`FxRate.source` vs enum `PriceSource`.** `ARCHITECTURE §3.2` dice `FxRate.source ∈ {banxico, manual}`,
   pero el enum `PriceSource` del contrato es `{pokemontcg_io, pokemonpricetracker, poketrace, manual}`
   (sin `banxico`). Para no violar ninguno, modelé `FxRate.source` como **String libre** (`"banxico"|"manual"`),
   NO como el enum `PriceSource`. Es coherente con ARCHITECTURE; solo lo señalo por si el arquitecto
   quiere formalizar un enum `FxSource` en el contrato. **No bloquea.**
2. **`BILLING_PROFILE_REQUIRED` (checkout/session).** El contrato lo lista como posible error, pero en
   el MVP la factura es **manual por correo** y el `billingProfileId` es **opcional**. Hoy **no** disparo
   ese error (se puede comprar sin billing profile). Si el negocio quiere exigir billing profile antes de
   pagar, el arquitecto debe precisar la condición. **No bloquea.**
3. **Dashboard money-masking.** El contrato muestra `profitPeriodCents/inventoryValueCents/custodyValueCents`
   en el ejemplo, y aclara que se **omiten/enmascaran** para `vault_operator`. Los **omito** (no vienen en
   el JSON) para ese rol. Si se prefiere enviarlos como `null`, avísese. **No bloquea.**
4. **Semántica de error del webhook Stripe (correctness fix de QA).** `API_CONTRACT §9` dice "Res 200
   siempre que la firma sea válida; los errores de negocio se registran, no se devuelven a Stripe". Tras
   el hallazgo de QA (un fallo transitorio dejaba la orden en `pending` para siempre), ahora distingo:
   firma inválida → 400; evento ya procesado o no manejado → **200**; pero si el **handler falla**
   (excepción, p. ej. DB transitoria) → se **propaga 5xx** para que **Stripe reintegre/reintente** y el
   evento **no** quede marcado como procesado. Es un refinamiento del texto del contrato (no un cambio de
   esquema/DTO); lo señalo por si el arquitecto quiere precisar la redacción de §9. **No bloquea.**
5. **Shape de las LISTAS de buylist (fix de QA — crash de vistas).** QA reportó 2 bugs preexistentes: las
   respuestas de **lista** no incluían las relaciones que el contrato/frontend esperan y crasheaban las
   vistas.
   - `GET /buylist/requests` (`listMine`, comprador) devolvía filas Prisma crudas **sin `items`** y con
     `id` en vez de `sellRequestId`. `BuylistView` itera `r.items.map(...)` → `TypeError`. **Fix:** ahora
     incluye `items: { include: { card: true } }` y mapea al shape **`SellRequestDTO`**
     (`sellRequestId` + `items: SellItemDTO[]` vía `itemDTO`, con `rarity`/`appliedRule`/`card`).
   - `GET /admin/buylist` (`adminList`, M5) incluía `items` **sin `card`**. `M5View` lee `it.card.name` →
     `TypeError`. **Fix:** `items: { include: { card: true } }` y mapeo a **`AdminBuylistDTO`**
     (`id`/`userId`/`quotedTotalCents`/`approvedTotalCents?`/`items[].card`).
   - Regresión fijada por `test/buylist.list-shapes.spec.ts` (asserta el `include` y el shape de ambas
     listas: un `include` faltante lo atrapa el test, no el runtime).
   - **Filtro `deleted` en `GET /admin/users`:** el enum `UserStatus` ya incluye `deleted`; el filtro
     `?status=` de la lista lo acepta trivialmente (el service pasa el string a `where.status`), sin
     cambios de código. El `PATCH .../status` sigue restringido a `active|blocked` (el contrato fija
     `deleted` solo por `DELETE /admin/users/:id`).

## 5. Variables de entorno faltantes / notas para **devops** (no edité `.env.example`)

- **`SEED_ADMIN_PASSWORD`** y **`SEED_OPERATOR_PASSWORD`** (SEC-C1) — **NUEVAS y obligatorias** para
  sembrar cualquier entorno no-local. **Solicitud a devops:** añadirlas a `.env.example` (vacías, con
  comentario "obligatoria en no-local; usar secreto fuerte") y **rotar** la credencial del operador que
  antes estaba en el repo (`Operador123!`) y la del admin (`ChangeMe123!`). Emparejables con
  `SEED_ADMIN_EMAIL`/`SEED_OPERATOR_EMAIL` (opcionales). El seed **rechaza el arranque** en no-local si
  faltan. Recomendado moverlas a un secret manager (no `.env` en el host) — ver banderas de SECURITY_NOTES §3.
- **Rate-limiting (SEC-C1):** el `ThrottlerModule` usa storage **in-memory por instancia**. En despliegue
  **multi-instancia** devops debe: (a) añadir storage compartido (Redis) para un límite global real, y
  (b) configurar `trust proxy`/`X-Forwarded-For` en el borde para que el tracker use la IP real del
  cliente (detrás de proxy). Además conviene un **rate-limit/WAF en el borde** como capa extra.
- **`BANXICO_SIE_TOKEN`** — `ARCHITECTURE §8` lo pide para el FX automático (API SIE de Banxico), pero
  `.env.example` solo tiene `FX_SOURCE`/`FX_API_KEY`. El código lee **`BANXICO_SIE_TOKEN` y, si falta,
  cae a `FX_API_KEY`**. **Solicitud a devops:** añadir `BANXICO_SIE_TOKEN=` a `.env.example`. Sin token,
  el FX usa el override manual (dial M10) o el último `FxRate` — el sistema **no se rompe**.
- **`S3_FORCE_PATH_STYLE`** ya está en `.env.example` (lo consumo para MinIO).
- **Webhook Stripe / raw body:** el endpoint `POST /api/v1/webhooks/stripe` necesita el **body crudo**
  para verificar la firma. Lo resuelvo en `main.ts` con un `json({ verify })` que captura `req.rawBody`
  antes del parse global. Si devops pone un proxy/body-parser delante, **preservar el raw body** en esa ruta.
- **BullMQ scheduling:** para activar los jobs repetibles (diarios) hace falta un worker BullMQ conectado
  a `REDIS_URL`. Hoy la **lógica** está lista (`src/jobs/*`); falta el wrapper de `@nestjs/bullmq` con
  `repeatable jobs`. Mientras tanto se pueden disparar: `POST /admin/pricing/sync` (price-sync) y
  `POST /admin/fx/refresh` (fx-refresh). `buylist-sweep` y `dispute-deadline` no tienen endpoint aún
  (solo servicio) — **deuda técnica no bloqueante** para el techlead/devops.

## 6. Decisiones de implementación relevantes

- **Dinero:** todo en **centavos MXN** enteros (`*Cents`); nunca floats. No existe wallet/saldo.
- **Fee de checkout = gross-up** `total = ceil((subtotal+IVA + fija) / (1 − pct))`; `fee = total − base`.
  El fee **no** lleva IVA. IVA grava subtotal (compra) o envío (retiro). `stripePct`/`stripeFixedCents`
  son diales M10 (defaults 3.6% + MX$3.00 — **a confirmar con la tarifa MX real de Stripe** por el dueño).
- **Precio de venta** = `round(referencia × (1 + salesMarkupPct/100))` (dial `sales_markup_pct`, default 15%),
  o `listPriceCents` override. El **valor de mercado** mostrado y la valuación de portafolio usan la
  **referencia** pura.
- **Titularidad / reserva (ARCHITECTURE §8):** checkout ⇒ **reserva ATÓMICA** con
  `status=reserved, ownerType=customer, ownershipStatus=pending` vía `updateMany` con guardia de estado
  vendible + `count===1` (evita doble venta de pieza única; el 2º checkout concurrente recibe
  `ITEM_UNAVAILABLE`). Webhook `succeeded` ⇒ `reserved → in_custody`, `ownershipStatus=settled`.
  `payment_failed` ⇒ `reserved → listed` (libera). `dispute.created` ⇒ revierte a plataforma (`listed`),
  `Order=chargeback`, movimiento `chargeback_return`. Todo transaccional con `InventoryMovement`.
- **Diales M10 validados:** `PUT /admin/settings` valida cada dial por tipo+rango (p. ej.
  `stripe_fee_pct ∈ [0,1)`, porcentajes ≥ 0, cents enteros ≥ 0) y **rechaza keys desconocidas** con `422`
  (validación "todo o nada"). Evita que un dial mal escrito rompa la matemática de `money.ts`.
- **Reportes por periodo:** `pnl` (órdenes por `settledAt`, envíos por `pickingAt`), `launchMetrics`
  (ventas `settledAt`, buylist `paidAt`, retiros `deliveredAt`) y `dashboard` (tarjetas de periodo con
  `from/to` opcionales; default = mes calendario UTC en curso) acotan realmente por fecha.
- **Precio pendiente (transversal):** si no hay referencia y no hay override, se crea `PendingPriceEntry`
  (una abierta por combinación) y **nunca se descarta** la carta. Aplica a catálogo/portafolio/buylist/
  inventario (aportación en especie sin referencia ⇒ `422 PRICE_PENDING` + cola).
- **Roles:** guards globales en orden `JwtAuthGuard → RolesGuard → MoneyOutGuard`. `@Public()` exime del
  JWT; `@Roles(...)` por ruta (con override a nivel de método, p.ej. KYC/status = solo `super_admin`);
  `@MoneyOut()` exige `super_admin` y **audita el intento bloqueado**. El **remedio de recompra** (M8)
  no usa `@MoneyOut()` en la ruta (porque `reject` sí lo puede hacer el operador): la restricción de
  `repurchase` a `super_admin` se hace en el controller, también auditando el bloqueo.
- **Errores:** shape del contrato `{ error: { code, message, details } }` vía `AllExceptionsFilter`.
  `BusinessException` lleva el `errorCode` estable (i18n en frontend). El backend **no** traduce textos.
- **Folios:** secuencia Postgres `inventory_folio_seq` (creada en la migración) → `INV-000123`.
- **Idempotencia (webhooks):** guardia **atómica** por `ProcessedStripeEvent(event.id)` — se hace
  `create` primero y se usa la violación de unique (P2002) como "ya procesado" (evita doble-`settled`
  ante entregas concurrentes). El evento se marca procesado **solo tras éxito** del handler; si el handler
  falla, se **borra** la marca y se **re-lanza** (Stripe reintenta). Los endpoints de pago aceptan
  `Idempotency-Key` (se pasa a Stripe).
- **Migraciones:** una sola migración inicial `0000000000000_init` (generada con `prisma migrate diff`,
  sin DB) + la secuencia de folios apéndice. `prisma migrate deploy` la aplica en CI/prod.

## 7. Qué falta para que QA valide (checklist)

- ✅ Endpoints del contrato implementados (auth, users, catalog, vault, checkout/orders, shipments,
  buylist, disputes, uploads, webhooks, admin M1–M10, dashboard).
- ✅ Enums/DTOs/errorCodes alineados con `API_CONTRACT.md`.
- ✅ Tests unitarios de lógica crítica pasan (`npm test` = 59 verdes, incluye la suite de seguridad §9).
- ⚠️ **Integración con infra real** (Postgres/Redis/MinIO/Stripe test): QA debe levantar
  `docker compose up -d`, `prisma migrate deploy`, `npm run seed`, y usar `stripe listen` para webhooks.
- ⚠️ **Providers de precio graded/sealed** son stubs (devuelven `null` ⇒ precio pendiente + override
  manual). El flujo funciona; los precios automáticos de gradeadas/sellado requieren confirmar el
  endpoint/clave del proveedor (fuera de mi alcance sin credenciales).
- ⚠️ **Scheduling BullMQ** de los 4 jobs (deuda no bloqueante; lógica lista y disparable).

## 8. Suite de integración / E2E (infra real) — para QA/devops

Suite que verifica la plataforma **contra infraestructura real** (Postgres/Redis/MinIO del
`docker-compose` + firma de webhook Stripe real, offline). Es la parte "teoría→realidad":
**no** usa Prisma mockeado; levanta el `AppModule` completo y lo golpea por **HTTP real**.

### Script para devops (CI)
```bash
npm run test:integration        # (alias: npm run test:e2e)
#   = prisma migrate deploy  &&  npm run seed:synthetic  &&  jest (config e2e)
```
- Corre **migraciones + seed sintético ANTES** de los tests (encadenado en el script).
- Config aislada: `test/jest-integration.config.js` (testRegex `test/integration/*.e2e-spec.ts`,
  `--runInBand` porque comparten estado de DB). **No** lo recoge `npm test` (unit sigue verde
  sin infra); el unit `jest.config.js` ignora `/test/integration/`.

### Seed sintético (lo invoca `scripts/seed-synthetic.sh`)
```bash
npm run seed:synthetic          # = ts-node prisma/seed-e2e.ts  (datos FICTICIOS deterministas)
```
- `prisma/seed-e2e.ts` exporta `seedE2E(prisma)` (reutilizable) + runner CLI. Idempotente:
  resetea el estado transaccional E2E en cada corrida. Constantes en `prisma/e2e-fixtures.ts`
  (usuarios por rol, cartas, folios, referencias, diales deterministas). **Nada de datos reales.**
- **v1.50.3-e (§0.9): idempotente también ENTRE DÍAS y tras una corrida FALLIDA.** Las
  `PriceReference` de las cartas del fixture se **borran y se declaran** en una transacción (su
  `@@unique` incluye `capturedDate`, así que «actualizar la del día» insertaba una fila nueva al
  día siguiente), y los pedidos/envíos de invitado `@example.com` se resetean (no cuelgan de
  `userId`, así que se acumulaban). Lo vigila `test/integration/seed-idempotency.e2e-spec.ts`.
- Usuarios sembrados: `customer@e2e.local` / `Customer123!`, `customer2@e2e.local`,
  `operator@e2e.local` / `Operator123!` (vault_operator), `admin@e2e.local` / `Admin123!` (super_admin).
- `scripts/seed-synthetic.sh` ya prefiere `npm run seed:synthetic` (coincide con su convención).

### Variables de entorno que necesita
- **Obligatoria:** `DATABASE_URL` (Postgres real; sin ella la suite falla explícito).
- **Recomendadas (infra real):** `REDIS_URL`, `S3_ENDPOINT`/`S3_REGION`/`S3_BUCKET`/
  `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` (MinIO; el bucket `tcg-photos` debe existir).
- **Stripe:** `STRIPE_WEBHOOK_SECRET` (se usa para **firmar y verificar** el webhook; si no se
  fija, la suite usa `whsec_e2e_test_secret` de forma consistente). No se llama a la API de
  Stripe por red: la creación de PaymentIntent/refund se stubbea offline; **la verificación de
  firma del webhook es REAL** (SDK). `STRIPE_SECRET_KEY` puede ser dummy.
- **`E2E_STRICT_INFRA=true`** (recomendado en el job E2E con toda la infra): hace que los smokes
  de **Redis** y **MinIO** fallen si la infra no responde. Sin él, esos dos smokes se **saltan
  con aviso** si no hay Redis/MinIO (Postgres siempre es obligatorio).

Local, con Docker:
```bash
cd .. && docker compose up -d && cd backend
npm run test:integration
```

### Qué cubre (flujos críticos de negocio)
| Spec | Cubre |
|---|---|
| `auth-authz.e2e-spec.ts` | registro/login/refresh; rol customer bloqueado del back-office; operador ve M3 pero no M7; **MoneyOutGuard** (operador→`MONEY_OUT_FORBIDDEN` **auditado**, super_admin pasa). |
| `catalog-checkout-webhook.e2e-spec.ts` | catálogo `referenceValue` vs `salePrice` (markup) y override; **precio pendiente → no comprable** (`sellable=false`, `422 PRICE_PENDING`); breakdown **IVA 16% + fee gross-up**; **reserva atómica anti doble-venta**; **webhook firmado** `payment_intent.succeeded` → `reserved→settled` (in_custody); **idempotencia** por `event.id` (un solo `settle`); **firma inválida → 400**; `charge.dispute.created` → **reversión a inventario de plataforma** + movimiento `chargeback_return`. |
| `vault-shipments.e2e-spec.ts` | portafolio valuado a **referencia** (sin wallet); retiro **solo `settled`** (`pending`→`ITEM_NOT_SETTLED`); **tarifa fija** 17500 + IVA + fee; **`ADDRESS_NOT_MX`**; cobro Stripe **antes** (nace en `solicitado`). |
| `buylist.e2e-spec.ts` | cotizador público (común 50 / reverse 150 / EX+ 40% / **precio pendiente**); tope por solicitud (`BUYLIST_LIMIT_EXCEEDED`), **INE** sobre umbral (`INE_REQUIRED`), **CLABE a nombre propio** (`CLABE_NOT_OWN_NAME`); pipeline `recibida→verificación`, **cherry-pick** + **convert-to-inventory**; **pago SPEI** (operador 403 money-out, super_admin OK). |
| `infra-smoke.e2e-spec.ts` | **Postgres** (query + secuencia de folios, obligatorio); **Redis** (PING real, skip/aviso si ausente); **MinIO/S3** (presign + **PUT real**, skip/aviso si ausente). |

### Notas de implementación (para QA/devops)
- **Sin dependencias nuevas:** el cliente HTTP de la suite usa el módulo `http` nativo (no se
  añadió supertest); las firmas de webhook se generan con el SDK de Stripe (ya presente).
- **Stripe sin `stripe listen`:** no hace falta el CLI de Stripe. Los eventos se **fabrican y
  firman en proceso** con `generateTestHeaderString` y se envían al endpoint real, que verifica
  la firma con `STRIPE_WEBHOOK_SECRET` e idempotencia por `event.id`. (Si en el futuro se quiere
  probar contra Stripe real de punta a punta, ahí sí `stripe listen --forward-to`; no es
  necesario para esta suite.)
- **CI actual (devops):** el job `backend` ya levanta Postgres+Redis. Para correr la suite
  completa hace falta **añadir un servicio MinIO** (o `E2E_STRICT_INFRA` sin fijar para que el
  smoke de MinIO se salte) y un step `npm run test:integration`. Postgres+Redis ya alcanzan para
  todo salvo el PUT real a MinIO.
- **Ejecutable aquí vs pendiente de infra:** en esta sesión **no hay daemon Docker**, así que la
  suite queda **lista y verificada a nivel de compilación** (typecheck/lint/build verdes, arranca
  el `AppModule` y falla limpio en la conexión a Postgres). Se ejecuta en verde en CI/local con la
  infra levantada. Los tests **unitarios** siguen intactos (`npm test` = 59 verdes, sin infra).
```

## 9. Remediación de seguridad (veredicto RECHAZADO → hallazgos cerrados por backend)

> Cierre de los hallazgos de `docs/SECURITY_NOTES.md` / `docs/PENTEST_NOTES.md` cuyo **rol dueño es
> backend**. Los de rol **devops** (bucket privado, rotación de secretos, WAF, bump de framework) se
> coordinan por separado (ver §5 y el checklist de abajo). Todo cerrado con tests + `lint/typecheck/
> test/build` en verde.

| ID | Fix (backend) | Test |
|---|---|---|
| **SEC-C1** rate-limit + seed | `@nestjs/throttler` global (`ThrottlerGuard` como 1er APP_GUARD, 300/min) + `@Throttle` estrecho en `/auth/login` y `/auth/register` (**5/min**) y `/auth/refresh` (20/min); webhook Stripe `@SkipThrottle`. Seed sin passwords hardcodeadas: `SEED_ADMIN_PASSWORD`/`SEED_OPERATOR_PASSWORD` obligatorias en no-local, falla si faltan. | `test/auth.throttle.spec.ts`, `test/seed.password.spec.ts` |
| **SEC-A1** categoría buylist server-side | `createRequest` **deriva `category` de la rareza real** (`categoryForRarity`) e **ignora** la del DTO; aplica en cotización y persistencia. | `test/buylist.security.spec.ts` (DTO malicioso `ex_plus` sobre común → 50c, no infla) |
| **SEC-A2** topes atómicos (TOCTOU) | Lectura del acumulado mensual + creación de `SellRequest` en **transacción SERIALIZABLE** (`monthUsedCentsTx` sobre `tx`); tope por-solicitud fuera (no depende de concurrencia). | `test/buylist.security.spec.ts` (isolation serializable; 2 concurrentes → 1 sola creada) |
| **SEC-A3** doble convert-to-inventory | `@unique` en `InventoryItem.sourceSellRequestItemId` (+ migración `20260813120000_unique_source_sell_request_item`); `convertToInventory` captura **P2002** y lo trata como "ya convertido". | `test/buylist.security.spec.ts` (2 conversiones → 1 solo InventoryItem) |
| **SEC-A4** PII/KYC al `vault_operator` | `getUser(id, role)`: proyección **reducida** para no-super_admin (CLABE **enmascarada** a últimos 4; INE/RFC **omitidos**; `billingProfile: null`; `ineOnFile` booleano). Controller pasa el rol. | `test/admin.pii.spec.ts` (operador sin PII sensible; super_admin ficha completa) |
| **SEC-A5** INE/KYC por presign de lectura | `UploadsService.presignGet(key, 300s)` (GET prefirmado); `DisputesService.adminGet` sirve fotos por presign, **no** por `S3_PUBLIC_BASE_URL`. (devops hace el bucket privado.) | `test/disputes.presign.spec.ts` |
| **SEC-C2** deps runtime | `@nestjs/config`→**4.0.4** (elimina `lodash` high); `overrides`: `multer@^2.2.0` (high), `qs@^6.15.3`, `express@^4.22.2`, `body-parser@^1.20.6`. `npm audit --omit=dev` = **0 high / 0 critical**. | `npm audit --omit=dev` (ver abajo) |
| **SEC-M3** (deuda, incluida) refund | Refund exige `status='settled'`; idempotencia obligatoria hacia Stripe (deriva `refund-<orderId>` si no viene header). | cubierto por lógica; e2e de órdenes |
| **SEC-M5** (deuda, incluida) pay-spei | `paySpei` idempotente (si ya `pagada` → devuelve) + transición atómica `updateMany` con guardia de estado (`count===1`). | `test/buylist.security.spec.ts` |

**`npm audit --omit=dev` (runtime) tras el fix:** `{ high: 0, critical: 0, moderate: 4 }`. Los 4 moderados
son **de framework y sin fix sin salto de major**, se documentan como deuda no explotable en este código:
- `@nestjs/core` / `@nestjs/platform-express` (GHSA-36xv-jgw5-4q75, moderate): el único fix es **NestJS 11**
  (major, rompe toda la app). Se pospone a un upgrade coordinado de framework (**devops/backend**, no
  bloqueante — es moderate, no high/critical).
- `file-type` vía `@nestjs/common` (moderate, DoS parseando media malformada): transitivo; **no alcanzable**
  en nuestro código — no parseamos archivos subidos en el servidor (los uploads van directo a S3 por presign).
- Nota: mantuve **NestJS 10** a propósito para no arriesgar un major; los highs de runtime (`multer`,
  `lodash`) se cerraron con `overrides` + `@nestjs/config@4`, más quirúrgico y de bajo riesgo. `multer` no
  se usa (no hay `FileInterceptor`; uploads por presign), así que el override es seguro.

### Pendientes de **devops** para completar el cierre (coordinar)
- **SEC-C1:** añadir `SEED_ADMIN_PASSWORD`/`SEED_OPERATOR_PASSWORD` a `.env.example`; **rotar** las
  credenciales sembradas antiguas; storage Redis para throttler + `trust proxy` + WAF en el borde (ver §5).
- **SEC-A5:** bucket **privado** (sin ACL público-lectura) para `kyc_ine`/`dispute_claim`; el backend ya
  sirve por presign. (El `S3_PUBLIC_BASE_URL` sigue usándose solo para **fotos de catálogo** públicas,
  que son producto y sí deben ser públicas — no es PII.)
- **SEC-C2:** mantener el gate `security-sast.yml` como required check; evaluar el salto a NestJS 11 en un
  sprint de hardening para cerrar los 4 moderados de framework.
- **Deuda restante (no de este encargo):** SEC-M1/M2/M4 (CORS allow-list, JWT en localStorage=frontend,
  helmet/headers B3, presign upload content-type B4) siguen como **deuda aceptada con disparador** en
  SECURITY_NOTES §2.

## 10. Endurecimiento de PII sensible (CLABE / RFC / INE) — cifrado en reposo + retención

> Cierra la bandera legal de `SECURITY_NOTES §2.3` (LFPDPPP): CLABE/RFC ya **no** viven en claro en la
> BD y la INE tiene **retención/borrado**. Greenfield: se renombraron las columnas a `*Enc` **sin backfill**.

### 10.1 Cifrado en reposo (AES-256-GCM) + blind index (HMAC-SHA256)
- **`src/common/crypto/pii-crypto.service.ts`** (`PiiCryptoService`, provisto por `CryptoModule` **@Global**):
  - `encrypt(x)` / `decrypt(x)`: AES-256-GCM autenticado. Formato serializado **`v1:iv:tag:ciphertext`**
    (cada campo en base64; IV de 12 bytes **aleatorio por operación**, authTag de 16 bytes). `decrypt`
    lanza si el payload fue manipulado o está mal formado.
  - `clabeBlindIndex(clabe)`: **HMAC-SHA256** con `PII_HMAC_KEY` sobre la CLABE **normalizada** (solo
    dígitos). Determinista ⇒ permite **igualar/buscar sin descifrar**. `blindIndexEquals` compara en
    tiempo constante.
  - **Fail-safe:** en entornos **no-locales** (`NODE_ENV` ∉ {development,test,local}) **falla claro** si
    `PII_ENCRYPTION_KEY`/`PII_HMAC_KEY` faltan o están mal formadas (la key AES debe decodificar a
    **exactamente 32 bytes**). En local, si faltan, deriva claves de desarrollo deterministas con **aviso**.
- **Columnas cifradas** (schema + migración `20260813130000_pii_encryption_at_rest`):
  - `KycProfile.clabe → clabeEnc`, `KycProfile.rfc → rfcEnc`, **nuevo** `KycProfile.clabeHmac` (blind index,
    con índice), `SellRequest.clabeSnapshot → clabeSnapshotEnc`, `BillingProfile.rfc → rfcEnc`.
- **Match `CLABE_NOT_OWN_NAME`** (`buylist.service.ts`): ahora compara **HMACs** (`clabeHmac` vs
  `clabeBlindIndex(clabe entrante)`) **sin descifrar** la CLABE almacenada. El índice también permite (a
  futuro) detectar la misma CLABE compartida entre cuentas.

### 10.2 Reveal on-demand para pagar (no dejar ciego al pagador)
- **NUEVO endpoint `GET /api/v1/admin/buylist/:id/reveal-clabe`** (`admin-buylist.controller.ts`):
  **solo `super_admin`**, marcado **`@MoneyOut()`** y **auditado en `AuditLog`** (`action:
  buylist.reveal_clabe`, quién/cuándo/qué solicitud). Descifra y devuelve la **CLABE completa (18 dígitos)**
  `{ sellRequestId, clabe }` para copiarla a la banca al hacer el SPEI. Cae a la CLABE de KYC si el snapshot
  falta. **Es el ÚNICO punto** que devuelve la CLABE en claro.
- **Enmascarado en todo lo demás** (helpers puros `src/common/crypto/pii-mask.ts`: `maskClabe`→`****1234`,
  `maskRfc`→`XAX**********`):
  - `GET /users/me/kyc` → CLABE **enmascarada** (antes iba en claro).
  - `GET /users/me/billing-profile` → RFC **enmascarado**.
  - `admin/users/:id` (ficha 360°): CLABE **y** RFC **enmascarados también para `super_admin`**; el
    operador además no ve RFC/INE keys/billing (se mantiene SEC-A4).
  - `admin/buylist/:id` (detalle): expone `clabeMasked`, nunca el snapshot cifrado ni la CLABE en claro.
- El `billingSnapshot` que guarda `Order` ahora contiene `rfcEnc` (ciphertext), **no** RFC en claro.

### 10.3 Retención de INE
- Dial **`INE_RETENTION_DAYS`** en `settings.constants.ts` (default **180** días, con validador
  `entero ≥ 0`). **NO** se expone en el DTO de `GET/PUT /admin/settings` para no tocar el contrato (ver
  solicitud abajo); se lee desde DB/seed vía `SettingsService`.
- **`src/jobs/ine-retention.service.ts`** (`IneRetentionJobService.run()`): purga las imágenes de INE
  (`UploadsService.deleteObject` **nuevo** + limpia `ineFrontKey/ineBackKey`) de un usuario cuando (1) no
  tiene solicitudes de buylist **abiertas** y (2) su última solicitud **cerrada/pagada** superó el periodo.
  Función **lista y disparable**; el **scheduling BullMQ es deuda BE-5** (igual que los otros 4 jobs).

### 10.4 Variables de entorno NUEVAS para **devops** (no edité `.env.example`)
- **`PII_ENCRYPTION_KEY`** — **obligatoria en no-local**. 32 bytes en **base64** (`openssl rand -base64 32`).
- **`PII_HMAC_KEY`** — **obligatoria en no-local**. Clave del blind index (`openssl rand -base64 32`).
  **Rotar la clave HMAC invalida los `clabeHmac` existentes** (habría que recalcularlos); en greenfield no
  aplica. Ambas deben vivir en un **secret manager**, no en `.env` del host.
- El dial **`INE_RETENTION_DAYS`** (default 180) se siembra con los demás diales M10 (`npm run seed`).

### 10.5 Solicitud de cambio de contrato al **arquitecto** (no edité `API_CONTRACT.md`)
5. **Nuevo endpoint `GET /api/v1/admin/buylist/:id/reveal-clabe`** (super_admin, money-out, auditado) →
   `{ sellRequestId, clabe }` con la CLABE en claro para el pago SPEI. **Formalizar en `API_CONTRACT §M5`.**
   Correlato: en M5/M6 la CLABE/RFC pasan a devolverse **enmascarados** por defecto (la ficha 360° ya no
   trae CLABE/RFC en claro; `GET /users/me/kyc` enmascara la CLABE). Recomiendo que el arquitecto anote el
   enmascarado como comportamiento del contrato y, si se desea, exponga `ineRetentionDays` como dial M10.

**Verde:** `lint` + `typecheck` + `build` OK; `npm test` = **79 verdes** (antes 59; +20 de PII: round-trip
de cifrado, blind index/normalización/manipulación, match CLABE por HMAC propia vs tercero, reveal only
super_admin, enmascarado por rol, y retención de INE). Los E2E de infra siguen usando la API por HTTP
(cifrado transparente); QA los corre con infra real.

## 11. Remediación de la revisión de Stripe + POLÍTICA DE REEMBOLSOS del humano

> Cierre de los hallazgos de la revisión de Stripe (C1, A1, A2, M1, M2, M3, B1, B2, B5, B6) con la
> **política del humano**: **VENTAS FINALES, sin reembolso voluntario** (ni en bóveda ni enviada).
> Única excepción: carta **dañada/equivocada** → disputa de condición; si procede, el super_admin
> **compensa (recompra al precio pagado)**, el **cliente conserva la carta** y la carta **NO** regresa
> al inventario. Todo cerrado con tests + `lint/typecheck/test/build` en verde (**95 tests**, antes 79).

### 11.1 Fixes por hallazgo

| ID | Fix (backend) | Archivo(s) | Test |
|---|---|---|---|
| **C1** (crítico) gross-up con IVA sobre la comisión Stripe | `grossUpTotal` ahora incluye el IVA que Stripe MX cobra sobre su comisión: `total = ceil((base + (1+ivaFee)·fija) / (1 − (1+ivaFee)·pct))`. `StripeFeeConfig` gana `stripeFeeIvaPct`. Nuevo dial **`stripe_fee_iva_pct`** (default **0.16**) con validador (`fracción [0,1)`) y seed. `getStripeFee()` lo lee. | `common/money.ts`, `settings.constants.ts`, `settings.service.ts` | `test/money.spec.ts` (netea **exactamente `base`** tras la deducción real de Stripe con IVA; el total sube vs. la fórmula sin IVA) |
| **A2** (alto) PaymentIntent transaccional con la reserva (cierra **BE-7**) | `orders.service` y `shipments.service`: `createPaymentIntent` va en `try/catch` **tras** la reserva. Ante fallo se **compensa** (orders: libera la reserva `reserved→listed`, orden `failed`; shipments: **borra** la `ShipmentRequest` → cascada a items) y se lanza un **error de reintento** (`PAYMENT_PROVIDER_UNAVAILABLE`, 503). Los errores de negocio legibles (`CARD_DECLINED`) se propagan tal cual. | `orders/orders.service.ts`, `shipments/shipments.service.ts` | `test/orders.reservation.spec.ts` (release + 503; CARD_DECLINED as-is), `test/shipments.rollback.spec.ts` |
| **A1** reembolso restringido/excepcional | `POST /admin/orders/:id/refund` ya es `super_admin` + `@MoneyOut()` + guardia `settled`; se documenta como **excepcional** (VENTAS FINALES). `onChargeRefunded` marca la orden `refunded` pero **NO** re-agrega el item. | `orders/admin-orders.controller.ts`, `payments/payments.service.ts` | `test/payments.service.spec.ts` (refund total → refunded, sin tocar inventario) |
| **A1** disputes = compensación correcta | `disputes.resolve('repurchase')` **ya NO revierte** el item ni crea `InventoryMovement`: el **cliente conserva la carta**, **no** regresa al inventario. Sigue money-out (super_admin) + **auditado** (controller). Importe de recompra registrado en la resolución (M7). | `disputes/disputes.service.ts` | `test/disputes.repurchase.spec.ts` |
| **Fix 4** contracargo consciente del estado físico | `onChargeDispute`: si la carta sigue **en bóveda** (no hay `ShipmentItem` con envío `enviado/entregado`) → revierte a `platform/listed` + `InventoryMovement chargeback_return`; si **ya salió** → **NO** re-agrega, marca `Order.chargebackNeedsManual=true` (pelear con la guía). | `payments/payments.service.ts` | `test/payments.service.spec.ts` (en-bóveda vs enviada) |
| **M1/Fix 5** cierre de disputa | Nuevos handlers `charge.dispute.closed` / `charge.dispute.funds_reinstated`: **ganamos** → `settled` (item revertido se **queda en inventario**); **perdemos** → `chargeback` terminal. `Order.disputeOutcome` = `won/lost`. | `payments/payments.service.ts` | `test/payments.service.spec.ts` (won/funds_reinstated/lost) |
| **M2** reembolso parcial vs total | `onChargeRefunded` distingue `charge.amount_refunded` vs `charge.amount`: solo el **total** transiciona a `refunded`; el **parcial** no cambia estado (conciliación fina en M7). | `payments/payments.service.ts` | `test/payments.service.spec.ts` |
| **M3** idempotency-key derivada en servidor | `orders` deriva `pi-order-<id>` y `shipments` `pi-shipment-<id>`; el header `Idempotency-Key` del cliente es solo **override**. | `orders.service.ts`, `shipments.service.ts` | `test/shipments.rollback.spec.ts` (key derivada) |
| **B1** resiliencia del cliente Stripe | `maxNetworkRetries: 2`; `StripeCardError` → `CARD_DECLINED` (422, mensaje legible + `declineCode`). | `payments/stripe.service.ts` | cubierto por A2 (CARD_DECLINED se propaga) |
| **B2** monto mínimo antes del PI | Guardia `amountCents ≥ MIN_CHARGE_CENTS (1000c ≈ MX$10)` antes de crear el PI → `AMOUNT_TOO_LOW`. | `payments/stripe.service.ts` | — (guardia defensiva; validación pura) |
| **B5** `payment_intent.canceled` | Nuevo handler → libera la reserva (orden `failed`, `reserved→listed`) o **cancela** un envío `solicitado` (libera items). | `payments/payments.service.ts` | `test/payments.service.spec.ts` (orden y envío) |
| **B6** fail-fast en producción | `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET` ahora **requeridas** en producción (`env.validation.ts` aborta el arranque); `StripeService` **no** cae a `sk_test_dummy` en prod (`onModuleInit` + getter). | `config/env.validation.ts`, `payments/stripe.service.ts` | — (arranque; validado por typecheck/build) |

### 11.2 Dial NUEVO para **devops**
- **`stripe_fee_iva_pct`** (default **0.16**) — IVA que Stripe MX cobra **sobre su comisión**. Se siembra
  con los demás diales (`npm run seed`, iterando `SETTING_DEFAULTS`). **NO** se expone en el DTO de
  `GET/PUT /admin/settings` hasta que el arquitecto lo formalice en el contrato (mismo patrón que
  `INE_RETENTION_DAYS`); mientras tanto es editable en DB. Impacto: el **fee de procesamiento** del checkout/
  envío ahora grosea comisión **+ IVA de Stripe**, por lo que el total sube (~+0.6% del total) frente al
  cálculo anterior. **Registrar la tarifa MX real de Stripe** (pct+fija+IVA) con el dueño.

### 11.3 Notas para **devops** (env + Stripe dashboard)
- **B6 — envs requeridas en prod:** `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET` ahora bloquean el arranque
  si faltan en producción. Añadirlas al secret manager y confirmar que están seteadas en staging/prod.
- **Webhooks nuevos a habilitar en el Stripe Dashboard:** además de los actuales, suscribir
  **`payment_intent.canceled`**, **`charge.dispute.closed`** y **`charge.dispute.funds_reinstated`**
  (si no, los cierres de disputa y cancelaciones no se procesarán).
- **Recomendación de seguridad (Stripe):** usar **restricted API keys** (permisos mínimos: PaymentIntents,
  Refunds, Charges/Disputes de solo-lo-necesario) en vez de la secret key completa, y **activar Radar**
  (reglas antifraude) para reducir contracargos. Coordinar con seguridad/devops.

### 11.4 Solicitudes de cambio de contrato al **arquitecto** (no edité `API_CONTRACT.md`)
6. **§M8 disputes — RESUELTO (ya alineado, sin acción pendiente).** El contrato §M8
   (`API_CONTRACT.md:485`) **ya** recoge la política VENTAS FINALES: en `repurchase` el
   **cliente conserva la carta** y la carta **NO** regresa al inventario (no re-agrega item, no crea
   `InventoryMovement`). La implementación (`disputes.service.ts › resolve`) coincide exactamente.
   Ya **no** hay discrepancia ni solicitud de cambio abierta; el docstring de `resolve()` se actualizó
   para reflejar el alineamiento (cierre de hallazgo techlead v1.2). **No bloqueante.**
7. **§9 webhooks — ampliar/precisar la semántica de disputas y refunds.** Hoy §9 dice que
   `charge.dispute.created` **siempre** revierte el item. La implementación ahora es **consciente del estado
   físico** (en bóveda → revierte; enviada/entregada → NO re-agrega + flag manual) y agrega
   `charge.dispute.closed`/`funds_reinstated` (ganamos→`settled`, perdemos→`chargeback`),
   `payment_intent.canceled` (libera reserva) y `charge.refunded` **parcial vs total** (sin re-agregar item).
   **Solicito actualizar §9** con estos eventos y la regla de "no re-agregar si ya salió".
8. **`OrderStatus` — NO cambié el enum.** Para no romper el contrato/i18n del frontend, mapeé
   ganamos→`settled` y perdimos→`chargeback`, y agregué **dos columnas escalares** a `Order`
   (`chargebackNeedsManual: boolean`, `disputeOutcome: "won"|"lost"|null`) — **no** están en los DTOs del
   contrato (uso interno / back-office). Si el arquitecto prefiere un estado terminal dedicado
   (`chargeback_won`/`dispute_won`) o exponer esos campos en el detalle admin de orden, que lo formalice.
9. **`stripe_fee_iva_pct` (dial M10).** Nuevo dial interno (default 0.16). **Solicito formalizarlo** en el
   DTO de `GET/PUT /admin/settings` (§M10). Correlato de redacción: en §5.1/§12 "el fee no lleva IVA" se
   refiere al **IVA de producto** (el fee no agrega una línea de IVA de venta); internamente el fee **sí**
   grosea el IVA de la **comisión de Stripe** (C1). Sugiero precisar esa distinción en el contrato.

**Verde (este encargo):** `lint` + `typecheck` + `build` OK; `npm test` = **95 verdes** (antes 79; +16:
gross-up con IVA y neto exacto, rollback de PI en orders y shipments, contracargo en-bóveda vs enviada,
cierre de disputa won/funds_reinstated/lost, refund parcial vs total sin re-agregar, `payment_intent.canceled`
en orden y envío, y recompra de disputa sin revertir la carta). Migración nueva
`20260813140000_order_chargeback_manual_and_dispute_outcome` (2 columnas escalares en `Order`).

## 12. Health endpoint (`GET /api/v1/health`) — para el healthcheck de Railway (devops)

> Encargo: dar a la plataforma (Railway) una sonda barata de salud. Trabajo solo en `backend/`.

- **Ruta exacta:** `GET /api/v1/health` — **pública** (`@Public()` salta el `JwtAuthGuard` global)
  y **sin rate-limit** (`@SkipThrottle()`, para no gastar cupo con sondas frecuentes).
- **Módulo propio, sin dependencias nuevas:** `src/modules/health/{health.module,health.controller,health.service}.ts`.
  No usé `@nestjs/terminus` (no estaba instalado y habría añadido peso); es un check simple hecho a mano.
- **Respuesta:**
  - **200** cuando las dependencias responden: `{ status: 'ok', uptime, timestamp, db, redis }`
    (`uptime` en segundos, `timestamp` ISO-8601). Ej. `{ status:'ok', uptime:1234, timestamp:'...', db:'up', redis:'skipped' }`.
  - **503** cuando algo está caído: `{ status: 'degraded', uptime, timestamp, db, redis }`
    con `db`/`redis ∈ up|down|skipped`.
- **Chequeo ligero de dependencias:** `SELECT 1` a Postgres vía `PrismaService`. **Redis: `PING` solo si hay
  cliente disponible.** Hoy **no** hay cliente Redis registrado en el `AppModule` (los jobs BullMQ aún no
  están cableados, ver §3/§5), así que `redis` sale como **`skipped`** y **NO** degrada la salud. Si devops
  registra un provider bajo el token `HEALTH_REDIS_CLIENT` (interfaz `{ ping(): Promise<string> }`), el
  health lo pingueará automáticamente y `redis` pasará a `up`/`down`. Un `down` real (DB o Redis) da 503.
- **Barato a propósito:** sin escrituras, sin locks, sin llamadas externas de negocio.

### Acción para **devops**
- **Fijar `healthcheckPath: "/api/v1/health"` en `railway.json`** (y el healthcheck del `docker-compose`/
  CI si aplica). El endpoint ya está listo y no requiere auth ni cabeceras.
- Considerar un `healthcheckTimeout` holgado (p. ej. 30 s) para tolerar el arranque de Prisma.

### Solicitud de cambio de contrato al **arquitecto** (no edité `API_CONTRACT.md`)
10. **Formalizar `GET /api/v1/health`** en el contrato (sección de **salud/infra**): público, `200
    { status:'ok', uptime, timestamp, db, redis }` / `503 { status:'degraded', ... }`. Hoy es un endpoint
    operativo (no de negocio) que el contrato aún no describe. **No bloquea.**

**Verde (este encargo):** `lint` + `typecheck` + `build` OK; `npm test` = **99 verdes** (antes 95; +4 del
health: 200/ok sin Redis, 200/ok con Redis PING, 503 por DB caída, 503 por PING de Redis fallido). El smoke
de DI (`app.module.spec`) sigue verde con el `HealthModule` cableado.

## 13. Alcance v1.1 (2026-08-14) — raw NM, Compra con precio, sync catálogo, Google, portafolio, sellado

> Implementa el contrato/arquitectura **v1.1**. Greenfield (sin backfill de datos). Todo con
> `lint/typecheck/test/build` en verde: `npm test` = **129 verdes** (antes 99; +30 de v1.1).

### 13.1 Migración Prisma
- **Nueva migración `prisma/migrations/20260814100000_v11_scope/`** (ARCHITECTURE §11, M-1..M-11):
  - **M-1** `RawCondition` → **solo `NM`** (se recrea el enum y se recastean `InventoryItem.rawCondition`
    y `SellRequestItem.rawCondition`; greenfield, sin filas ≠ NM que migrar).
  - **M-2** `SealedSubtype` (`box|etb|bundle|tin|blister`) + `InventoryItem.sealedSubtype` (nullable).
  - **M-3..M-7** `User`: `passwordHash` **nullable**, `authProvider` (`local|google`, default `local`),
    `googleId String? @unique`, `emailVerified Boolean @default(false)`, `avatarUrl String?`.
  - **M-8** modelo nuevo **`PortfolioSnapshot`** (`userId`, `asOfDate @db.Date`, `totalValueMxnCents`,
    `costBasisMxnCents?`, `pendingPriceCount`, `@@unique([userId,asOfDate])`, `@@index([userId,asOfDate])`).
  - **M-9** seed del dial **`catalog_sync_from_date` = `"2024/01/01"`** (idempotente, `ON CONFLICT DO NOTHING`;
    también se siembra por `npm run seed` vía `SETTING_DEFAULTS`).
  - **M-10** `Dispute.type` ya es `String` libre → admite `condition_sealed` sin cambio de esquema.
  - **M-11** `Card.rarity` permanece **String libre** (taxonomía abierta; captura rarezas modernas).

### 13.2 Login con Google (`POST /auth/google`)
- `GoogleTokenVerifier` (`google-auth-library`) valida el ID token **server-side**: firma JWKS,
  `aud=GOOGLE_CLIENT_ID`, `iss` de Google, `exp`, y `email_verified`. Es una clase inyectable delgada
  (mockeable en tests). Sin `GOOGLE_CLIENT_ID` rechaza (nunca acepta a ciegas).
- `AuthService.google(idToken)`: verifica → exige `email_verified` (si no, **`403 GOOGLE_EMAIL_UNVERIFIED`**,
  no crea ni enlaza) → busca por `googleId` → **account-linking por email verificado** a cuenta local
  (audita `auth.google_link`) → si no existe, **crea** (`authProvider=google`, `emailVerified=true`,
  `passwordHash=null`, **`role=customer` SIEMPRE server-side**, nunca del token). Mismo shape que `/login`.
  Errores: `401 GOOGLE_TOKEN_INVALID`, `403 GOOGLE_EMAIL_UNVERIFIED`, `403 USER_BLOCKED`.
- **`/auth/login` rechaza cuentas sin `passwordHash`** (solo-Google) con `401 INVALID_CREDENTIALS`
  (no revela que es cuenta Google).
- **`/users/me`** ahora expone `authProvider`, `emailVerified`, `avatarUrl?`.
- Endpoint con `@Throttle` estrecho (5/min por IP, igual que `/login`).

### 13.3 Sync de catálogo M2 (super_admin, auditado)
- `PokemonTcgIoClient` (`modules/catalog/pokemontcg-io.client.ts`): **host FIJO** `https://api.pokemontcg.io/v2`
  (anti-SSRF), header `X-Api-Key` desde `POKEMONTCG_IO_API_KEY`. `getSets()`, `getCardsBySet(setId,page)`.
- `CatalogSyncService`: `remoteSets()` (`imported`/`cardCount` locales), `sync({setId?,fromReleaseDate?})`
  (default `fromReleaseDate` = dial `catalog_sync_from_date`), `backfill({batchSize=10,untilYear?})` →
  `{imported, newBoundary, remaining}`. **Upsert idempotente por `externalId`** (set y cartas).
  **Guardarraíl `setId` `^[a-z0-9]+(-[a-z0-9]+)*$`** (anti-inyección de `q=set.id:`), `fromReleaseDate`
  validado `yyyy/MM/dd`. `Card.rarity` se persiste tal cual (rarezas modernas).
- `AdminCatalogController` (`/admin/catalog/*`, `super_admin`): `remote-sets`, `sync` (202), `backfill` (200).
  Cada operación queda en `AuditLog` (`catalog.remote_sets|catalog.sync|catalog.backfill`).
- **Ejecución síncrona (MVP)** como `price-sync`; en prod la cola BullMQ da el rate-limit del free tier.

### 13.4 "Compra" = inventario publicado con precio (semántica v1.1)
- `GET /catalog/cards` ahora devuelve **solo `status=listed` + plataforma + precio de venta RESOLUBLE**
  (`listPriceCents` fijado/override **o** referencia con la que calcular precio×markup) y `sellable=true`.
  **Excluye "precio pendiente"** (el comprador nunca lo ve). Gate coarse en DB
  (`listPriceCents>0` **OR** `card.priceReferences.some`) + confirmación exacta de `sellable` al construir
  el DTO; **paginación en memoria** sobre el conjunto comprable (aceptable por inventario propio acotado;
  ver TECH_DEBT abajo).
- `GET /catalog/facets` (**nuevo**): `rarities` (distinct de `Card.rarity`, espejo pokemontcg.io), `sets`
  (`{id,name,releaseDate,year}` con `year` derivado, orden año desc), `productTypes`, `sealedSubtypes`,
  `price{minCents,maxCents}` — todo sobre el inventario **publicado y comprable**.
- `GET /catalog/sets` añade `year` (derivado de `releaseDate`), orden año desc; solo sets con inventario publicado.
- `GET /catalog/cards/:cardId` y `GET /catalog/listings/:id` respetan el mismo gate; **`listings/:id` → 404**
  para item no publicado / sin precio (antes de v1.1 devolvía 200 con `sellable=false`). Filtro nuevo por `sealedSubtype`.
- **Actualicé el E2E** `catalog-checkout-webhook.e2e-spec.ts` (assert de `listedPending`: ahora **404** en
  `GET /catalog/listings/:id`, coherente con el contrato v1.1). El resto del E2E no cambia (listedCharizard
  sigue apareciendo por su referencia).

### 13.5 Sellado como línea de venta
- `POST /admin/inventory/items` soporta `productType=sealed` + `sealedSubtype`; **sin condición/grade/rareza**
  (validación `validateProductShape`: sellado con `rawCondition`/grade → `422 VALIDATION_ERROR`; raw solo `NM`;
  graded exige compañía+grado). El **precio manual MXN (`listPriceCents`) es obligatorio para publicar**: sin
  él, el sellado se crea pero se escala a **precio pendiente** (no aparece en Compra). `ListingDTO` lleva `sealedSubtype`.
- Disputas: `Dispute` generalizada a **sellado** (`type=condition_sealed`, evidencia = foto de la caja al
  ingreso); graded sigue devolviendo `NOT_RAW`.

### 13.6 Gráfica de portafolio + scheduler (BE-5)
- `PortfolioSnapshotJobService` (`src/jobs/portfolio-snapshot.service.ts`, alojado en `VaultModule` para
  evitar ciclos): reutiliza `VaultService.holdings()` (valor a **referencia**, excluye pendientes) + base de
  costo agregada; **upsert idempotente por día** (`@@unique[userId,asOfDate]`).
- `GET /vault/portfolio/history?range=5d|15d|1m|3m|6m|1y|ytd|all` (default `1m`, `customer`) →
  `{range, points[], change{absMxnCents,pct,direction}}`. Sin snapshots → `points:[]`, `change` flat/`pct:null`.
  Backfill indicativo (`estimated`) **no** implementado (opcional en el contrato; queda como mejora futura).
- **Scheduler BullMQ (BE-5 / v15-D1)** `src/jobs/scheduler.service.ts`: programa **los 7 jobs diarios**
  (repeatable jobs, UTC escalonado) con `REDIS_URL` — ver §18 para el detalle actualizado. **Se activa solo
  si hay `REDIS_URL`**; sin él queda deshabilitado sin abrir conexiones (arranque local/tests/CI sin infra
  intactos). Disparo manual admin: `POST /admin/pricing/sync`, `POST /admin/fx/refresh`,
  `POST /admin/jobs/{portfolio-snapshot,ine-retention,buylist-sweep,dispute-deadline,auth-token-sweep}`.

### 13.7 AcquisitionPricer — rarezas modernas
- `BuylistService.categoryForRarity`: **default `ex_plus`** para rarezas NO listadas como común/reverse
  (Illustration/Special Illustration Rare, Full Art, Alternate Art, Trainer Gallery, Character Rare, Radiant,
  etc.). `comun`/`reverse_holo` solo si la tabla `rarity-map` lo dice explícitamente. La cotización sigue:
  ex_plus **con** market price → 40% de la referencia; **sin** dato → `precio_pendiente` (lado adquisición,
  nunca al comprador). Condición siempre NM.

### 13.8 Variables de entorno NUEVAS para **devops** (no edité `.env.example`)
- **`GOOGLE_CLIENT_ID`** (backend) — audiencia esperada del ID token de Google (validación `aud`). Sin ella,
  `POST /auth/google` responde `401 GOOGLE_TOKEN_INVALID` (login Google inhabilitado, el resto no se rompe).
  Correlato frontend: **`NEXT_PUBLIC_GOOGLE_CLIENT_ID`** (Google Identity Services; propiedad de frontend/devops).
  **Solicitud a devops:** añadir ambas a `.env.example` (sin `client_secret`: flujo de ID token, no code-exchange).
- **`REDIS_URL`** ya está en la arquitectura; ahora el **scheduler BE-5** lo consume para los jobs diarios.
  Sin `REDIS_URL` el scheduler queda deshabilitado (jobs disparables a mano). Con multi-instancia, correr el
  worker en **un solo** proceso/instancia (o aceptar que BullMQ deduplica por `jobId` repetible).
- `POKEMONTCG_IO_API_KEY` (ya listado en ARCHITECTURE §8) — lo consume el `PokemonTcgIoClient` del sync M2.

### 13.9 Dependencias runtime nuevas
- **`google-auth-library@^9`** (verificación del ID token), **`bullmq@^5`** + **`ioredis@^5`** (scheduler BE-5).
- `npm audit --omit=dev` tras el alta: **0 high / 0 critical**; **6 moderate** (los 4 previos de framework/
  file-type + 2 nuevos transitivos `gaxios`→`uuid` de google-auth-library, no explotables aquí). Se mantiene
  la política (sin high/critical en runtime).

### 13.10 Deuda técnica / notas (a petición del techlead)
- **Paginación en memoria de Compra:** `GET /catalog/cards`/`facets`/`sets` computan `sellable` por item
  (una lectura de referencia por item) y paginan en memoria sobre el conjunto comprable. Correcto y acotado
  para el inventario **propio** del MVP; a escala convendría **persistir `salePriceCents`/flag `published`**
  al listar + índice y paginar en DB. **No bloqueante.**
- **Sync de catálogo síncrono (MVP):** `sync`/`backfill` importan en proceso (como `price-sync`). Para
  colecciones grandes conviene moverlo a la cola BullMQ con rate-limit del free tier. **No bloqueante.**

### 13.11 Solicitudes de cambio de contrato al **arquitecto** (no edité `API_CONTRACT.md`)
11. **`GET /users/me` — campos v1.1.** Ya devuelvo `authProvider`/`emailVerified`/`avatarUrl` (contrato §Auth).
    Sin cambio pendiente; solo lo registro.
12. **Disputa de sellado.** El contrato §7 mantiene `422 NOT_RAW` y no describe un path explícito de disputa
    de sellado, pero ARCHITECTURE §3.6 la contempla. Generalicé `Dispute` a raw **y** sellado
    (`type=condition_sealed`, evidencia = foto de la caja); graded sigue con `NOT_RAW`. **Sugiero al arquitecto
    precisar §7** (renombrar el error o documentar el caso sellado). **No bloquea.**
13. ~~**`catalog_sync_from_date` (dial M10).** Nuevo dial interno (default `"2024/01/01"`); **NO** expuesto en el
    DTO de `GET/PUT /admin/settings`.~~ **RESUELTO (2026-08-14, ver §14):** el arquitecto lo formalizó en
    `API_CONTRACT §M10` como `catalogSyncFromDate` y ya está expuesto/editable por API.

**Verde (v1.1):** `npm run lint && npm run typecheck && npm test && npm run build` OK; `npm test` = **129
verdes** (+30: verificación de ID token Google [aud/firma inválida→401, email no verificado→403, linking sin
duplicar, alta role=customer, login solo-Google→401], sync idempotente + validación `setId` + default por
fecha, semántica de Compra [excluye sin precio] + facetas + `year`, sellado con/sin precio + validación,
snapshot idempotente + `change`, AcquisitionPricer rareza moderna → ex_plus, gating del scheduler por `REDIS_URL`).

## 14. `catalogSyncFromDate` expuesto en el DTO de M10 (2026-08-14)

> Ajuste menor de contrato ya formalizado por el arquitecto (`API_CONTRACT §M10`): el dial
> `catalog_sync_from_date` pasa a ser una `ConfigSetting` de primera clase, legible y editable por API como
> `catalogSyncFromDate` (string `yyyy/MM/dd`, default `"2024/01/01"`). Cierra la solicitud #13 de §13.11.

- **Sin lógica duplicada.** El dial `catalog_sync_from_date` (key, default y validador `yyyy/MM/dd`) ya existía
  en `settings.constants.ts` desde v1.1 (M-9). El único cambio necesario fue **añadir la entrada
  `catalogSyncFromDate → CATALOG_SYNC_FROM_DATE` a `SETTING_DTO_MAP`**, que gobierna a la vez:
  - `GET /admin/settings` (`getAllDto` itera el mapa) → ahora incluye `catalogSyncFromDate`.
  - `PUT /admin/settings` (`update` valida contra el mapa) → ahora lo acepta y lo valida con el validador
    existente (`^\d{4}\/\d{2}\/\d{2}$` → formato inválido = `422 VALIDATION_ERROR`). Las keys desconocidas
    se siguen rechazando con 422 (allow-list "todo o nada" intacta, §6).
  El `CatalogSyncService` sigue leyendo el mismo dial vía `SettingsService.getString(CATALOG_SYNC_FROM_DATE)`
  (una sola fuente de verdad; no se tocó su lógica).
- **Tests** (`test/settings.validation.spec.ts`): lectura del dial en `getAllDto` (default y valor persistido),
  actualización válida (`2025/03/01` → upsert de `catalog_sync_from_date`) y formato inválido → 422
  (`2025-03-01`, `not-a-date`, numérico).
- **Nota (fuera de este encargo):** el contrato §M10 también lista `stripeFeeIvaPct` en el DTO de
  `GET /admin/settings`, pero ese dial **sigue sin estar** en `SETTING_DTO_MAP` (dial interno, ver §11.2). Es
  una discrepancia contrato↔código independiente; **no** la toqué en este encargo (alcance = solo
  `catalogSyncFromDate`). **Se señala al arquitecto/orquestador** para decidir si se expone también.

**Verde (este encargo):** `npm run lint && npm run typecheck && npm run build` OK; `npm test` = **133 verdes**
(antes 129; +4: getAllDto expone `catalogSyncFromDate` con default y valor persistido, PUT válido, PUT formato
inválido → 422).

## 15. Fixes de QA/techlead sobre alcance v1.1 (2026-08-14)

> Correcciones de los hallazgos de QA y techlead. Solo se tocó `backend/` (+ estas notas y `TECH_DEBT.md`).
> Ningún cambio de contrato: todos los fixes implementan lo que el contrato/PROJECT ya exigían.

- **BLOQUEANTE (QA) — guard de `itemStatus` en `convertToInventory`.**
  `src/modules/buylist/buylist.service.ts` → `convertToInventory` (~L419). Se añade una **guardia de
  aprobación**: si `item.itemStatus !== 'aprobada'` → **`422 ITEM_NOT_APPROVED`** (nuevo errorCode en
  `common/error-codes.ts`) y **no se crea InventoryItem**. Así una carta `rechazada` (resultado de
  verificación NO-NM, PROJECT §H / criterios 3d/16) NUNCA se vuelve inventario vendible. La guardia va
  **después** del pre-check de idempotencia (un item ya convertido, `inventoryItemId` set, sigue devolviendo
  idempotente sin 422) y **antes** del create; se conservan la idempotencia y la guardia TOCTOU por índice
  único (`sourceSellRequestItemId` + P2002). El controlador `admin-buylist.controller.ts:105` no cambia
  (delega en el servicio; el 422 se propaga y se serializa por el filtro global).
  Tests: `test/buylist.convert-guard.spec.ts` (rechazada/estados no aprobados → 422 sin create; aprobada →
  crea y marca `convertida_inventario`; ya convertido → idempotente). Se actualizó el mock de
  `test/buylist.security.spec.ts` (SEC-A3) para incluir `itemStatus: 'aprobada'`.

- **IMPORTANTE (QA) — `POST /disputes` devuelve `type`.**
  `src/modules/disputes/disputes.service.ts` → `create` ahora incluye `type`
  (`condition_raw | condition_sealed`, derivado server-side del `productType`) en la respuesta 201, como
  exige el contrato §7. Test: `test/disputes.create-type.spec.ts` (raw→condition_raw, sealed→condition_sealed,
  graded→422 NOT_RAW).

- **MENOR (QA) — saneo de filtros enum en `GET /catalog/cards`.**
  `src/modules/catalog/catalog.service.ts` → `listCards`. Los filtros `productType`/`condition`/`sealedSubtype`
  (endpoint público) se validan contra los enums de Prisma (`ProductType`/`RawCondition`/`SealedSubtype`) con
  el helper `validateEnum`; un valor inválido (`?condition=LP`, `?productType=foo`) responde **`400
  VALIDATION_ERROR`** y **nunca llega a Prisma** (antes producía `500 PrismaClientValidationError`). Test:
  `test/catalog.enum-filters.spec.ts`.

- **D5 (techlead / seguridad) — enumeración por temporización en login.**
  `src/modules/auth/auth.service.ts` → `login`. Se ejecuta **siempre** `argon2.verify`: cuando no hay usuario
  o `passwordHash` es null (cuenta solo-Google) se verifica contra un **hash dummy fijo precomputado**
  (`DUMMY_PASSWORD_HASH`, argon2id) para igualar la latencia y cerrar el canal de temporización. Se mantiene
  `401 INVALID_CREDENTIALS` en ambas ramas y el caso Google intacto (sigue sin poder loguearse por
  contraseña). Test: `test/auth.login-timing.spec.ts` (ambas ramas → 401 y ejecutan `verify`; rama feliz
  intacta).

- **D4 (alinear con contrato §M10) — `stripeFeeIvaPct` en settings.**
  `src/modules/settings/settings.constants.ts` → añadido `stripeFeeIvaPct → STRIPE_FEE_IVA_PCT` a
  `SETTING_DTO_MAP` (el validador de rango `[0,1)` ya existía). Cierra la discrepancia señalada en §14. Ahora
  `GET/PUT /admin/settings` leen/actualizan el dial. Test añadido en `test/settings.validation.spec.ts`
  (getAllDto expone default 0.16; update válido persiste `stripe_fee_iva_pct`; `>= 1` → 422).

- **Deuda registrada** (`docs/TECH_DEBT.md`): **D1** (sync de catálogo síncrono con `jobId` ficticio → mover
  a cola BullMQ), **D2** (`pokemontcg-io.client.getSets()` sin paginación, trunca > 250 sets), **D3**
  (N+1 de `getReference` en holdings/snapshot → batch). **D4 y D5 marcadas como RESUELTAS** en este pase.

**Verde (este pase):** `npm run lint && npm run typecheck && npm run build` OK; `npm test` = **155 verdes,
30 suites** (antes 133; +5 tests nuevos de los fixes, ajustado 1 mock existente).

---

## 16. Simplificación v1.2 / v1.2.1 (2026-08-14) — sin fotos de producto, gradeadas por certificado, uploads solo INE, disputa por correo

> Implementa el contrato/arquitectura **v1.2 / v1.2.1** (changelog + migraciones **M-12/M-13**). Greenfield
> (sin backfill de datos). Verde: `npm run lint && npm run typecheck && npm test && npm run build` OK;
> `npm test` = **163 verdes, 32 suites** (antes 155; +2 suites nuevas: `uploads.presign`, `inventory.graded-cert`).
> **INE/CLABE intactos** (v1.2.1 revierte solo la parte del INE): cifrado PII, retención y `reveal-clabe` sin cambios.

### 16.1 Migración Prisma (`20260814200000_v12_simplification`)
- **M-12 — `InventoryItem.certNumber`** (`String?`, add column): nº de certificado PSA/CGC. Solo para
  `productType=graded` (null en raw/sealed). **Requerido a nivel de aplicación** para publicar una gradeada
  (validación de servicio, no `NOT NULL` en BD). Sin validación automática contra la graduadora.
- **M-13 — drop de campos de foto** (greenfield, sin datos que migrar):
  - `InventoryItem.frontPhotoKey` / `backPhotoKey` / `extraPhotoKeys`
  - `SellRequestItem.photoKeys`
  - `Dispute.ingressPhotoKeys` / `claimPhotoKeys`
- **NO tocado:** `KycProfile.ineFrontKey`/`ineBackKey`, columnas `*Enc`/`*Hmac`, retención `INE_RETENTION_DAYS`,
  `reveal-clabe`. La migración de v1.2 no toca el esquema de INE/CLABE.
- `schema.prisma` deja **comentarios `// v1.2 (M-13)`** donde estaban los campos, para trazabilidad.

### 16.2 Alta de inventario (`POST /admin/inventory/items`)
- `CreateItemDto` / `UpdateItemDto`: **eliminados** `frontPhotoKey`/`backPhotoKey`/`extraPhotoKeys`;
  **añadido** `certNumber?`. La imagen del item es siempre la de **catálogo remota** de la `Card`.
- **Gradeada exige `certNumber` para publicar:** `validateProductShape` (graded) ahora rechaza con
  **`422 VALIDATION_ERROR`** si falta `certNumber` (o viene vacío). raw/sealed lo dejan `null`.
- `ListingDTO` (catalog): **sin** `frontPhotoUrl`/`backPhotoUrl` (se eliminó el helper `photoUrl`); ahora
  expone `certNumber` para gradeadas. La imagen = `CardDTO.imageSmallUrl`/`imageLargeUrl`.
- El detalle de bóveda (`GET /vault/holdings/:id`) expone `certNumber` para gradeadas; sin claves de foto.

### 16.3 Uploads/presign acotado a `kyc_ine` (`POST /uploads/presign`)
- `UploadsService.presign` acepta **solo** `purpose="kyc_ine"`; cualquier otro (incl. `inventory_photo`,
  `dispute_claim`) → **`422 VALIDATION_ERROR`** (regla de negocio, no el 400 del `ValidationPipe`: el DTO
  recibe `purpose` como `String` libre y el servicio valida).
- **Pipeline INE intacto:** presign PUT (bucket **privado** + cifrado), presign GET de vida corta
  (`presignGet`, usado por back-office M6), retención (`ine-retention` job), `S3_*`, `PII_*` sin cambios.

### 16.4 Disputa por correo (`POST /disputes`, `GET /admin/disputes/:id`)
- `CreateDisputeDto`: **eliminado** `claimPhotoUploadKeys`. La respuesta 201 ahora incluye
  **`evidenceContact`** (correo de soporte), además de `type` (`condition_raw|condition_sealed`) y `deadlineAt`.
- Valor de `evidenceContact` en **`src/modules/disputes/disputes.constants.ts`**:
  `DISPUTE_EVIDENCE_CONTACT = 'soporte@tcgvaultmx.com'` (placeholder; overridable por env
  `DISPUTE_EVIDENCE_CONTACT`). **SUPUESTO por confirmar por el humano** (ver PROJECT.md).
- `DisputesService` ya **no** depende de `UploadsService` (quitado del constructor y del `DisputesModule`).
  `adminGet` **sin comparador de fotos**: expone `type`, `deadlineAt`, `evidenceContact` y el item (para
  gradeadas: `gradingCompany + gradeValue + certNumber`). Se conserva **VENTAS FINALES** y la resolución
  por grado/`certNumber` (gradeadas) o estándar NM (raw) — sin cambios de negocio.

### 16.5 Tests (ajustados + nuevos)
- **Nuevos:** `test/inventory.graded-cert.spec.ts` (gradeada sin `certNumber` → 422; con `certNumber`
  persiste y no guarda claves de foto), `test/uploads.presign.spec.ts` (`kyc_ine` acepta; `inventory_photo`/
  `dispute_claim`/otros → 422).
- **Ajustados:** `test/disputes.create-type.spec.ts` (respuesta incluye `evidenceContact`; no persiste claves
  de foto), `test/disputes.presign.spec.ts` (reescrito: adminGet sin fotos, expone `evidenceContact`),
  `test/disputes.repurchase.spec.ts` (constructor sin `UploadsService`), `test/catalog.spec.ts` (mock de item
  sin claves de foto, con `certNumber`), `test/integration/infra-smoke.e2e-spec.ts` (presign usa `kyc_ine`).

### 16.6 Env para **devops** (no edité `.env.example`)
- **`DISPUTE_EVIDENCE_CONTACT`** (opcional): correo de soporte para evidencia de disputa. Default
  `soporte@tcgvaultmx.com`. Añadir a `.env.example` cuando el humano confirme la dirección real.

### 16.7 Nota de coherencia con el contrato
- El contrato (§M1) lista `graded sin certNumber` explícitamente como **`422 VALIDATION_ERROR`** en el alta,
  por lo que implementé el `certNumber` como **requisito duro en el alta** de gradeadas (no como "creable pero
  no vendible"). Coincide con el test "gradeada sin certNumber no se publica". **Sin discrepancias abiertas**
  con el contrato en este pase.

### 16.8 Cierre hallazgo techlead v1.2 — invariante `certNumber` también en UPDATE
- **Gap:** la invariante "gradeada publicada exige `certNumber`" solo se aplicaba en `createItem`
  (`validateProductShape`); `updateItem` hacía `update({ data: dto })` sin revalidar, así que un PATCH
  podía **publicar** (`status:'listed'`) o **mantener publicada** una gradeada sin cert, o **quitar** el cert
  de una gradeada ya listada. La habría dejado aparecer en Compra sin nº de certificado verificable.
- **Fix (`inventory.service.ts › updateItem`):** se valida el **estado RESULTANTE** del PATCH — si
  `productType === 'graded'` **y** el `status` resultante es `listed`, el `certNumber` resultante (el del dto
  si viene, si no el persistido) debe ser no vacío; en caso contrario **`422 VALIDATION_ERROR`**. `updateItem`
  no puede cambiar `productType` (el DTO no lo expone), por eso se toma el del item actual.
- **Tests** (`test/inventory.graded-cert.spec.ts`, nuevo bloque `updateItem`): publicar gradeada sin cert →
  422; quitar cert de gradeada publicada → 422; publicar con cert (previo o aportado en el mismo dto) → OK;
  PATCH a gradeada `in_stock` sin cert → OK (la invariante solo aplica al publicar); PATCH a raw publicada
  sin cert → OK. Suite total **169 verdes** (antes 163).
- **Docstrings corregidos (sin cambio de comportamiento):** `disputes.service.ts › resolve()` (ya no
  afirma discrepancia con §M8; el contrato está alineado) y `uploads.service.ts › presignGet()` (acotado a
  `kyc_ine`; se retiró la referencia muerta a "fotos de disputa", eliminadas en v1.2).

## 17. Endurecimiento de producción (cierre de S-M2 / S-B3 / S-B4 / S-M1 · rol backend)

> Cierre de la deuda enrutada a **backend** en `docs/SECURITY_NOTES.md §4` para promoción a producción.
> Todo en `backend/`. `lint` + `typecheck` + `build` OK; `npm test` = **177 verdes** (antes 169; +8 de
> uploads: allow-list de content-type + límite de tamaño). **No** toqué `docs/API_CONTRACT.md` (los cambios
> son aditivos y compatibles con §8).

### 17.1 S-M2 — CORS con allow-list (`main.ts`)
- Se elimina `app.enableCors({ origin: true, ... })`. Ahora el origin se toma de **`APP_BASE_URL`**
  (lista **separada por comas** si hay varios orígenes válidos, p. ej. `https://app.tcgvaultmx.com,https://tcgvaultmx.com`).
  **`credentials: true` se mantiene.** Nunca se refleja un origin arbitrario.
- **Fallback seguro** si `APP_BASE_URL` no está seteada: solo orígenes de **desarrollo local**
  (`http://localhost:3000`, `http://localhost:5173`) — jamás un comodín. Se loguea la allow-list efectiva al
  arrancar. **En staging/producción `APP_BASE_URL` DEBE fijarse** (si no, el frontend real no pasará CORS).

### 17.2 S-B4 — helmet + `algorithms` JWT + validación de env
- **helmet:** `app.use(helmet())` en `main.ts` (dependencia nueva `helmet`, añadida a `package.json`).
  Aplica CSP por defecto, HSTS, `X-Content-Type-Options: nosniff`, frameguard, etc.
- **`algorithms` JWT fijados a `HS256`** (evita algorithm-confusion), tanto al **firmar** como al **verificar**:
  `auth.service.ts › issueTokens` (`algorithm: 'HS256'` en access y refresh), `auth.service.ts › refresh`
  y `common/guards/jwt-auth.guard.ts` (`algorithms: ['HS256']` al verificar). El login con Google reusa
  `issueTokens`, así que queda cubierto sin cambios adicionales.
- **Validación de env corre SIEMPRE** (antes solo `NODE_ENV==='production'`). `config/env.validation.ts`:
  ahora aborta el arranque si faltan `DATABASE_URL`/`JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`/
  `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` en **cualquier entorno NO-local** (incluye **staging**, antes no
  cubierto). Se mantiene el patrón local/no-local del repo (seed, pii-crypto): en `development`/`test`/`local`
  (o sin `NODE_ENV`) NO aborta, para no romper dev/CI sin secretos reales. Se añade además un **chequeo de
  entropía**: los secretos JWT deben tener **≥ 32 caracteres** en entornos no-locales (si no, aborta).
  **Acción devops:** garantizar en staging/prod que `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` cumplen la
  longitud mínima y provienen del secret manager.

### 17.3 S-B3 — Presign KYC (`uploads.service.ts` / `uploads.controller.ts`)
- **Allow-list de content-type:** el presign de `kyc_ine` solo admite `image/*`; cualquier otro
  (`text/html`, `application/pdf`, `application/octet-stream`, …) → **`422 VALIDATION_ERROR`**.
- **Límite de tamaño:** default **10 MiB**, configurable por env **`KYC_UPLOAD_MAX_BYTES`** (bytes). El DTO
  acepta un **`contentLength` opcional** (aditivo al contrato §8, `Req` no lo exigía): si el cliente lo declara,
  se valida contra el tope (`422 VALIDATION_ERROR` si excede o no es entero positivo) **y** se **fija en la
  firma** (`ContentLength`), de modo que el PUT deba enviar exactamente ese tamaño (S3 rechaza si el cuerpo no
  coincide). La respuesta ahora incluye `maxBytes` y, si se declaró tamaño, el header `Content-Length`.
- **Defensa extra (mismo hallazgo):** `presignGet` sirve el INE con `ResponseContentDisposition: attachment`
  (nunca render inline) → un objeto malicioso se descarga en vez de ejecutarse aunque se abra desde el dominio
  de storage. El bucket privado sigue siendo responsabilidad de **devops** (S-B3 infra).
- **Tests** (`test/uploads.presign.spec.ts`): rechazo de `text/html`/`application/pdf`/`octet-stream`;
  aceptación de `image/jpeg`/`image/png`; rechazo por tamaño > tope (default y `KYC_UPLOAD_MAX_BYTES`
  custom); rechazo de `contentLength` no positivo; reflejo de `Content-Length`/`maxBytes` en la respuesta.

### 17.4 S-M1 — Dependencias (moderate) del runtime
- `npm audit fix` **no forzado** no aplicaba nada (las correcciones vivían en transitivos anidados). Se
  resolvieron con **`overrides` compatibles** (sin breaking change):
  - **`uuid ^11.1.1`** (cierra GHSA-w5hq-g745-h8pq vía `gaxios`→`google-auth-library`; `uuid@11` soporta
    CommonJS, API `v4()` estable).
  - **`file-type ^21.3.4`** (cierra GHSA-5v7r-6r5c-r473 / GHSA-j47w-4g3g-c36v vía `@nestjs/common`, que ya
    cargaba `file-type` **ESM por dynamic `import()`**; el bump mantiene el mismo mecanismo de carga).
- **`npm audit --omit=dev` (runtime):** pasó de **6 moderate** a **2 moderate**. Los 2 restantes son
  `@nestjs/core`/`@nestjs/platform-express` (GHSA-36xv-jgw5-4q75), cuyo **único fix es NestJS 11 (major,
  breaking)** — **NO se fuerza** (fuera del alcance de este encargo). **Deuda restante enrutada a devops**
  (gate `npm audit` en SAST + salto coordinado a NestJS 11 en un sprint de hardening). `file-type` no es
  alcanzable por nuestro código (no parseamos archivos en el server; uploads van directo a S3 por presign),
  pero el override deja el audit runtime limpio de ese hallazgo igualmente.

### 17.5 Variables de entorno nuevas / relevantes para **devops**
- **`APP_BASE_URL`** — **NUEVA, obligatoria en staging/prod.** Origen(es) permitido(s) por CORS, lista
  separada por comas. Sin ella se cae a los orígenes de **localhost** (solo dev). Añadir a `.env.example`.
- **`KYC_UPLOAD_MAX_BYTES`** — **NUEVA, opcional.** Tope de tamaño del upload de INE en bytes (default
  `10485760` = 10 MiB). Añadir a `.env.example` con el default comentado.
- Recordatorio S-B4/devops: `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` deben ser **≥ 32 chars** en
  staging/prod (ahora el arranque lo exige) y venir del secret manager.

---

## 18. Cotizador Opción 1 (v1.3, 2026-08-16) — buylist sobre TODO el catálogo + sync-all

Alcance del contrato v1.3 (`API_CONTRACT.md §6` y `§M2`): 3 endpoints nuevos de backend para que el
cotizador pueda elegir **cualquier** carta del catálogo (no solo el inventario comprable de "Compra").
**No hubo migración Prisma** (se reutilizan `Card`/`CardSet` existentes y `CardDTO`).

### 18.1 Endpoints implementados

- **`GET /api/v1/buylist/cards`** (público) — búsqueda paginada sobre **toda** la tabla `Card`.
  - Controller nuevo `BuylistCatalogController` (`modules/buylist/buylist-catalog.controller.ts`), delega en
    `CatalogService.searchAllCards()`. `BuylistModule` ahora importa `CatalogModule` (que ya exporta
    `CatalogService`); **sin ciclo** (CatalogModule no importa BuylistModule).
  - Query: `setId`, `q` (nombre `contains` case-insensitive **OR** número `contains`), `rarity` (String
    libre tal cual pokemontcg.io), `page`, `pageSize` (tope de servidor **≤100**, igual que el resto de
    endpoints públicos paginados). Respuesta `{ data: CardDTO[], page, pageSize, total }` (reutiliza
    `CardDTO`; **no** lleva `sellable`/`salePriceCents` — no es Compra). `total` vía `card.count`.
  - **Consulta `Card`, NO `InventoryItem`** → devuelve cartas que **no** tenemos en bóveda (justo lo que
    pide la Opción 1). No toca pricing.
  - **Rate-limit anti-scraping SIN sesión:** `@Throttle({ ttl: 60_000, limit: 60 })` por IP (más estricto
    que el global de 300/min), para no facilitar el volcado del catálogo desde un endpoint público.
- **`GET /api/v1/buylist/sets`** (público) — sets con **cartas importadas** (dropdown del cotizador).
  - `CatalogService.listSetsWithImportedCards()`: `cardSet.findMany({ where: { cards: { some: {} } } })`,
    `year` derivado de `releaseDate` (`yearFromReleaseDate`), ordenado por año **desc**. Respuesta
    `{ data: [{ id, name, series, releaseDate, year }] }`. Distinto de `GET /catalog/sets` (que solo trae
    sets con inventario **publicado**). Mismo throttle 60/min.
- **`POST /api/v1/admin/catalog/sync-all`** (super_admin, auditado) — importa TODO el catálogo. Ver 18.2.

### 18.2 `sync-all` — cómo se resolvió el NO-bloqueo (DEV-1) y sus límites

`CatalogSyncService.syncAll()` + `runSyncAll()` (`modules/catalog/catalog-sync.service.ts`), endpoint en
`AdminCatalogController` (`@HttpCode(202)`, audita `action: catalog.sync_all`).

- **Enfoque elegido: background in-process (NO se cableó BullMQ para catálogo).** Motivo: el
  `SchedulerService` BullMQ existente (BE-5) solo se activa con `REDIS_URL` y solo cablea los jobs diarios
  (`fx-refresh`/`price-sync`/`portfolio-snapshot`) en la cola `tcg-daily`; no hay worker de catálogo. Cablear
  una cola/worker dedicado de catálogo (con su rate-limiter y persistencia de progreso) excede este encargo,
  así que `sync-all` corre el barrido **en memoria del proceso** de forma **fire-and-forget**:
  1. `getSets()` (una llamada rápida a `/sets`) para calcular los sets **pendientes** (remotos que **no**
     tienen ya un `CardSet` local con ≥1 carta → **resumible**).
  2. Marca `syncAllRunning=true` y lanza `runSyncAll(pending)` **sin `await`** → el request retorna `202
     { jobId, setsQueued, remaining }` de inmediato (no espera la importación completa; resuelve el timeout de
     DEV-1 que sí tenía el `sync` from-date síncrono).
  3. `runSyncAll` importa **secuencialmente** cada set (respeta el rate-limit del free tier); un set que
     falla **no** aborta el barrido de los demás. Al terminar libera `syncAllRunning`.
- **Idempotente:** cada set/carta se persiste con `upsert` por `externalId` (no duplica al re-correr).
- **Resumible:** re-llamar `sync-all` reanuda solo los sets aún **no** importados. `setsQueued` = sets
  encolados en esa llamada; `remaining` = 0 cuando encolamos todos los pendientes.
- **Single-flight:** si ya hay un barrido en curso, una segunda llamada **no** lanza otro (evita duplicar
  carga y quemar rate-limit); devuelve `setsQueued: 0` y `remaining` = pendientes actuales.
- **Límites conocidos (deuda, enrutar a devops/techlead):**
  - El progreso vive **en memoria**: si el proceso se **reinicia** a mitad del barrido, los sets no
    importados quedan pendientes y se reanudan re-llamando `sync-all` (idempotente), pero **no** hay reintento
    automático ni backoff persistido. El `jobId` es **cosmético** (no consultable; alineado con DEV-2).
    Cuando devops cablee una cola BullMQ de catálogo, `syncAll()` debería encolar en ella en vez del
    fire-and-forget in-process. **No bloquea el MVP** (el `sync`/`backfill` existentes ya cubren la carga
    completa; `sync-all` la hace explícita y segura contra timeouts del request).
  - En despliegue **multi-instancia**, el `syncAllRunning` es por-instancia (dos réplicas podrían barrer en
    paralelo). Con la cola BullMQ (job único) esto se resuelve; hasta entonces, dispararlo desde una sola
    instancia/manualmente.

### 18.3 Gates (desde `backend/`)

- `npm run lint` ✅ · `npm run typecheck` ✅ · `npm test` ✅ **192 tests / 34 suites** (incluye **8 nuevos**:
  4 en `test/buylist-catalog.spec.ts`, 4 en `test/catalog-sync.spec.ts` describe `syncAll`) · `npm run build` ✅.
- Cobertura nueva: búsqueda por `set`/`q` en `/buylist/cards` sobre `Card` (prueba explícita de que **no**
  toca `InventoryItem` → incluye cartas sin inventario), paginación/`total`, `q` OR nombre/número;
  `/buylist/sets` (where `cards.some`, year desc); `sync-all` (encola solo pendientes = resumible, no
  bloquea, single-flight, upsert idempotente, y un set fallido no aborta el barrido).

### 18.4 Discrepancias con el contrato / decisiones para el **arquitecto**

- **Ninguna que exija cambio de contrato.** Los 3 endpoints se implementaron con los shapes exactos de
  `API_CONTRACT.md §6/§M2`.
- **Nota (no bloqueante):** el contrato menciona para `/buylist/cards` `Err 400 VALIDATION_ERROR
  (paginación inválida)`. Igual que el endpoint hermano `GET /catalog/cards`, aquí `page`/`pageSize`
  inválidos se **coercionan** a defaults (`page≥1`, `1≤pageSize≤100`) en vez de devolver 400 — se mantuvo la
  convención ya establecida en el codebase para uniformidad entre ambos buscadores públicos. Si el arquitecto
  prefiere 400 estricto, es un ajuste menor de validación en ambos controllers (avisar).
- **Pregunta abierta 1 de ARCHITECTURE §10 (pricing on-demand del cotizador):** `/buylist/cards` **no**
  pricea; el pricing de una `ex_plus` se resuelve en `POST /buylist/quote` (ya existente) contra el
  `PriceReference` en bóveda. Una carta fuera de bóveda sin market price sale `precio_pendiente` y escala a la
  cola del dueño al crear la solicitud (§13/criterio 13), tal como especifica el contrato. Sin cambio de
  backend requerido aquí; queda como decisión de producto si se quiere pricing on-demand (fuera de alcance).

## 19. Alineación de shapes al contrato tras rechazo de QA (2026-08-16)

QA rechazó por 4 mismatches donde el **backend omitía/violaba los nombres de campo del
contrato**. Correcciones (solo nombres del DTO de salida; **no** se tocaron columnas de BD,
enmascarado, ni lógica). Archivos: `modules/admin/admin.service.ts`,
`modules/pricing/pricing.controller.ts`.

- **M6 ficha 360° (`AdminService.getUser`)** — `API_CONTRACT §M6`. En **ambas** proyecciones
  (super_admin y vault_operator) el KYC ahora expone `clabeMasked` (antes `clabe`),
  `rfcMasked` (antes `rfc`, solo super_admin) y los topes como `capPerRequestCents` /
  `capPerMonthCents` (antes `capPerRequestCentsOverride` / `capPerMonthCentsOverride`; las
  **columnas** de BD siguen llamándose `*Override`, solo cambió el nombre en la respuesta).
  El `billingProfile` expone `rfcMasked` (antes `rfc`). El enmascarado y la segregación por
  rol (SEC-A4) no cambian: CLABE en claro sigue **solo** por `reveal-clabe`.
- **M2 rarity-map (`PricingController`)** — `API_CONTRACT §M2`. `GET/PUT
  /admin/pricing/rarity-map` ahora devuelven el envelope `{ entries: [{ rarity, category },
  ...] }` (antes el `GET` devolvía un `Record<string,string>` plano y el `PUT` devolvía el
  mapa). La **persistencia interna** sigue siendo un mapa (`ConfigSetting.valueJson`); se
  proyecta a `entries` al leer y al responder el `PUT`. El body del `PUT` ya aceptaba
  `{entries:[...]}` (sin cambio).
- **M7 IVA (`AdminService.ivaReport`)** — `API_CONTRACT §M7`. Cada item de `byOrder` expone
  `orderId` (antes `id`); conserva `ivaCents`, `settledAt`, `status`. `exportCsv` (report=iva)
  se ajustó para leer `orderId`.
- **M9 launch-metrics (`AdminService.launchMetrics`)** — `API_CONTRACT §M9`. `goals` es
  **`null`** (el objeto completo) cuando no hay metas fijadas, en vez de `{N:null,X:null,
  Y:null,Z:null}`. La lógica colapsa a `null` si ninguna meta está definida; cuando el humano
  fije al menos una, devolverá el objeto `{N,X,Y,Z}`. (Aún no existe fuente de metas: hoy
  siempre `null`, que es lo correcto por contrato.)

### 19.1 Tests que fijan estos shapes (para que un mismatch futuro lo atrape un test)

- `test/admin.pii.spec.ts` (actualizado): asserts sobre `clabeMasked` / `rfcMasked` /
  `capPerRequestCents` / `capPerMonthCents` y que los nombres viejos (`clabe`/`rfc`/`*Override`)
  ya **no** existen; billing con `rfcMasked`.
- `test/admin.contract-shapes.spec.ts` (nuevo): `ivaReport` → cada item con `orderId` (sin
  `id`); `launchMetrics` → `goals` null sin metas.
- `test/pricing.rarity-map.spec.ts` (nuevo): `GET`/`PUT` devuelven `{entries:[...]}`; GET con
  config ausente → `{entries: []}`; `PUT` persiste el mapa interno y responde el envelope.

### 19.2 Gates (desde `backend/`)

- `npm run lint` ✅ · `npm run typecheck` ✅ · `npm test` ✅ **197 tests / 36 suites**
  (antes 192/34; +5 tests, +2 suites) · `npm run build` ✅.

### 19.3 Discrepancias con el contrato

- **Ninguna.** Los 4 shapes se alinearon exactamente a `API_CONTRACT §M2/§M6/§M7/§M9`. No se
  editó el contrato ni la estructura de carpetas.

---

## 20. v1.3.1 — Precio de buylist por rareza + gestión de usuarios M6 + robustez del sync

Ronda que implementa: (1) precio de buylist por **rareza oficial** (§E.1, criterios 12/12b/12c/18),
(2) gestión de usuarios M6 (reset de contraseña + borrado híbrido), y (3) robustez del sync de catálogo
(`remote-sets` degradado + import por carta aislado). Fuente: `API_CONTRACT §6/§M2/§M6` v1.3.1,
`ARCHITECTURE §3.2/§4.2/§4.7bis/§4.8`.

### 20.1 Precio de buylist por rareza (§E.1)

- **Diales nuevos** (`settings.constants.ts`): `buylist_price_rules` (mapa
  `{ [rarity]: { mode:'fixed'|'pct', value } }`) y `buylist_price_fallback_pct` (default **40**).
  Validadores: `fixed`→entero ≥0 (centavos); `pct`→número en `[0,100]`; fallback en `[0,100]`. Se
  exportan `validateBuylistRules` / `validateFallbackPct` (reusados por el editor M2). **NO** están en
  `SETTING_DTO_MAP`: no se editan por `GET/PUT /admin/settings`, sino por los endpoints dedicados M2.
- **Seed** (en `SETTING_DEFAULTS`, se siembra por `seed.ts`): `Common`/`Uncommon` = fixed 50c,
  `Reverse Holo` = fixed 150c, fallback 40%. Preserva el negocio vigente (todo lo demás → 40% de la
  referencia = antiguo `ex_plus`). `rarity_map` (`RARITY_MAP`) queda **DEPRECADO** en la ruta de
  cotización (ya no se lee para el monto); sus endpoints `GET/PUT /admin/pricing/rarity-map` se conservan
  como legacy/no-op (tests intactos).
- **`quoteAcquisition` (money.ts) reescrito**: firma nueva
  `quoteAcquisition(rarity, referenceMxnCents, rules, fallbackPct)` → `{ quotedPriceCents, status,
  appliedRule, ruleSource }`. `fixed`→monto fijo (siempre cotiza); `pct`→`round(ref×value/100)`, sin ref
  →`precio_pendiente`; rareza sin regla→fallback pct (`ruleSource='fallback'`). **SEC-A1 intacto**: la
  rareza sale de `Card.rarity` (server-side), nunca del DTO.
- **`BuylistService`**: `publicQuote` y el DTO de item exponen `rarity` + `appliedRule`
  (`{mode,value,source}`) en vez de `category`. `createRequest` ya no recibe `category`
  (`RequestItemDto` sin el campo; el ValidationPipe `whitelist` descarta cualquier `category` que envíe
  el cliente) y snapshotea la regla aplicada por item. `categoryForRarity` eliminado; nuevo helper
  `buylistRules()`.
- **Endpoints M2 nuevos** (`PricingController`, super_admin, auditado
  `pricing.buylist_rules.update`): `GET/PUT /admin/pricing/buylist-rules` (tabla + fallback, validación
  estricta → `422 VALIDATION_ERROR`) y `GET /admin/pricing/rarities` (`distinct Card.rarity` vía
  `groupBy` unido a las reglas; `source: rule|fallback`; ordenado por `cardCount` desc).
- **Modelo/Migración M-14** (`20260816120000_m14_buylist_rules_by_rarity`): enum `BuylistRuleMode`
  (`fixed|pct`); `SellRequestItem` gana `rarity`/`ruleMode`/`ruleValue`/`ruleSource`; `category` pasa a
  **nullable** (retención legacy, nada nuevo lo escribe). No se borran datos.

### 20.2 Gestión de usuarios M6 (super_admin, auditado)

- **`POST /admin/users/:id/reset-password`** (`AdminService.resetPassword`): genera temp de alta
  entropía (`randomBytes(18).base64url`), la hashea con **argon2** (como `/auth/register`), responde
  `{ userId, tempPassword, mustChangePassword:true }` **una sola vez**. Revoca sesiones vía
  `tokenVersion++` y setea `mustChangePassword`. La contraseña **nunca** se loguea ni entra al
  `AuditLog` (solo `action=user.reset_password` + actor + target). `422 USER_DELETED` sobre cuenta ya
  soft-deleted.
- **`DELETE /admin/users/:id`** (`AdminService.deleteUser`): predicado "tiene transacciones" = ≥1 fila en
  `Order`/`SellRequest`/`ShipmentRequest`/`Dispute`/`InventoryItem(ownerUserId)`. Falso → **hard delete**
  (cascada + purga INE en R2). Verdadero → **soft delete** (`status=deleted`, `deletedAt`/`anonymizedAt`,
  email→`deleted+<uuid>@anon.invalid`, `name`/`phone`/`avatarUrl`/`googleId`/`passwordHash` limpiados,
  `tokenVersion++`; PII de `KycProfile` nulada + INE purgado; `BillingProfile`/`Address`/
  `PortfolioSnapshot` borrados; filas económicas conservadas). Respuesta `{ userId, mode }`. Idempotente
  sobre soft-deleted. `409 CANNOT_DELETE_SELF`. `AdminModule` importa `UploadsModule` para la purga de INE.
- **`tokenVersion` cableado en el JWT**: `AuthService.issueTokens` incluye `tv` en el payload
  (access+refresh). El **`JwtAuthGuard`** ahora consulta la BD por request y rechaza si la cuenta está
  `blocked`/`deleted` o si `tv` no coincide con `User.tokenVersion` (revocación inmediata de sesiones).
  `refresh()` valida lo mismo. `login`/`google` rechazan `deleted` con `403 USER_BLOCKED` (no revela
  motivo). **Trade-off**: el guard hace un `SELECT` por request autenticada (correctitud de revocación
  sobre latencia); cacheable a futuro si hace falta. Migración **M-15**
  (`20260816130000_m15_user_management`): `UserStatus += deleted`; `User += deletedAt, anonymizedAt,
  mustChangePassword, tokenVersion`.

### 20.3 Robustez del sync de catálogo (bugs de producción)

- **`GET /admin/catalog/remote-sets` ya no tira 500** cuando pokemontcg.io falla/rate-limitea: degrada
  con gracia usando la lista **local** (`CardSet` en BD) como fallback. Shape del contrato intacto
  (`{ data:[...] }`) + banderas opcionales `degraded`/`source` (`remote|local`).
- **Import por carta aislado** (fix "el sync importaba solo 1 carta por set"): `upsertCards` envuelve
  cada `card.upsert` en try/catch — una carta con dato inválido se **omite con log** y **no aborta** el
  set; `number` faltante → `''`; carta sin `id`/`name` se salta. `importSet` devuelve el `cardCount`
  **real** importado. La paginación (`importRemainingPages`) recorre todas las páginas por
  `totalCount/pageSize` (verificado con test).
- **Retry/backoff en el cliente** (`PokemonTcgIoClient.getJson`): reintenta ante `429` y `5xx`
  transitorios (hasta 4 veces), respetando `Retry-After` si viene, o backoff exponencial. Un 429 a media
  importación ya no aborta el barrido del set.

### 20.4 Tests (unitarios, propios)

- `test/money.spec.ts` (actualizado): `quoteAcquisition` por regla — fixed/pct/fallback/pending + redondeo.
- `test/buylist.modern-rarity.spec.ts` (reescrito): `publicQuote` con fallback %, pending, regla fixed y
  pct granular por rareza.
- `test/buylist.security.spec.ts` / `test/buylist.clabe-pii.spec.ts` (actualizados): SEC-A1 ahora sobre
  rareza real + `appliedRule`; ítems sin `category`.
- `test/pricing.buylist-rules.spec.ts` (nuevo): GET/PUT `buylist-rules` (+validación 422 de
  mode/rango/fallback) y `rarities` (join catálogo↔reglas, orden, `source`, omite null).
- `test/admin.user-management.spec.ts` (nuevo): reset-password (hashea, revoca, no expone claro,
  USER_DELETED), delete híbrido (hard sin transacciones + purga INE, soft con transacciones + anonimiza,
  409 self, idempotente).
- `test/catalog.remote-sets-fallback.spec.ts` (nuevo): fallback local en fallo remoto; 2ª carta que
  truena no deja el set en 1; paginación multi-página.
- Integración: `test/integration/buylist.e2e-spec.ts` actualizado al nuevo contrato (rarity/appliedRule,
  sin `category`) para QA.

### 20.5 Gates (desde `backend/`)

- `npm run lint` ✅ · `npm run typecheck` ✅ · `npm test` ✅ **217 tests / 39 suites**
  (antes 197/36; +20 tests, +3 suites) · `npm run build` ✅.
- Migraciones aplicadas a un Postgres 16 limpio (`prisma migrate deploy` OK) y **sin drift**
  (`prisma migrate diff` = "No difference detected"); `seed.ts` siembra los 2 diales nuevos.

### 20.6 Discrepancias con el contrato

- **Ninguna.** Todo se alineó a `API_CONTRACT §6/§M2/§M6` v1.3.1. No se editó el contrato ni la
  estructura de carpetas. Nota para el arquitecto (no bloqueante): `remote-sets` añade campos
  **opcionales** `degraded`/`source` no listados en el contrato (no rompen el shape `{data}`); si se
  prefieren fuera del contrato, se pueden ocultar.

## 21. Health `/api/v1/health` ahora refleja Redis de verdad (2026-08-16)

> Corrección al §12: el health reportaba `redis:skipped` **siempre** porque nadie registraba el token
> `HEALTH_REDIS_CLIENT`, aun cuando en producción `REDIS_URL` sí existe y el `SchedulerService`
> (BullMQ) abre su conexión. Era engañoso. Ahora `/health` dice la verdad. **Sin cambios de shape**
> en la respuesta ni en el contrato.

### 21.1 Qué cambió (solo `backend/`)

- **Nuevo provider** `src/modules/health/health-redis.provider.ts`:
  - Clase `HealthRedisClientProvider` (implementa `HealthRedisClient` + `OnModuleDestroy`) que envuelve un
    cliente **IORedis liviano y dedicado** solo para el `PING` del health. Opciones: `maxRetriesPerRequest:
    null` (no cuelga el check si Redis cae → falla a `down`) y `lazyConnect: true` (no abre el socket hasta
    el primer chequeo). Registra un handler de `'error'` no-op para que un Redis caído **no tumbe el
    proceso** (el estado real lo decide el resultado del `ping()`). `onModuleDestroy` hace `quit()` (con
    fallback a `disconnect()`) para **no fugar sockets**.
  - `healthRedisProvider`: factory sobre el token `HEALTH_REDIS_CLIENT` que **inyecta `ConfigService`**:
    - **con `REDIS_URL`** → devuelve el cliente real ⇒ health reporta `up`/`down`.
    - **sin `REDIS_URL`** (local/tests/CI sin infra) → devuelve `null` ⇒ health sigue reportando `skipped`
      (comportamiento previo preservado; el token es `@Optional()` en `HealthService`).
- **`health.module.ts`** registra `healthRedisProvider` en `providers`. `ConfigService` ya estaba
  disponible por el `ConfigModule` **global** del `AppModule` (no hizo falta importarlo).
- **Conexión independiente a propósito**: NO comparto la conexión BullMQ del worker (SchedulerService).
  Una conexión de health separada y mínima es más simple y evita acoplar la sonda a los workers. El costo
  (un socket extra, lazy) es despreciable.
- **No toqué** `HealthResult` ni `checkRedis()` en `health.service.ts` (ya manejaban `up`/`down`/`skipped`
  bien); solo faltaba satisfacer el token con un cliente real cuando hay `REDIS_URL`.

### 21.2 Tests

- Nuevo `test/health-redis.provider.spec.ts` (ioredis mockeado, sin sockets reales): token+inject
  correctos; sin `REDIS_URL` → `null` y no se construye cliente; con `REDIS_URL` → cliente con las opciones
  esperadas + `ping()`; `onModuleDestroy` cierra con `quit()` y hace fallback a `disconnect()` si falla.
- Los tests de `health.controller.spec.ts` (§12) siguen válidos sin cambios: instancian `HealthService`
  directo (skipped = sin cliente; up/down = cliente mock), que es exactamente el nuevo comportamiento
  condicionado por `REDIS_URL`.

### 21.3 Gates (desde `backend/`)

- `npm run lint` ✅ · `npm run typecheck` ✅ · `npm test` ✅ **224 tests / 41 suites** (antes 217/39; +7
  tests, +2 suites — incluye el nuevo spec del provider) · `npm run build` ✅.

### 21.4 Verificación manual

- **Con Redis arriba:** `REDIS_URL=redis://localhost:6379 npm run start` → `curl -s localhost:3000/api/v1/health`
  ⇒ `... "redis":"up"`. Si Redis está definido pero **caído** ⇒ `"redis":"down"` y **503**.
- **Sin Redis (local/CI):** arrancar **sin** `REDIS_URL` → `curl -s localhost:3000/api/v1/health` ⇒
  `... "redis":"skipped"` y **200** (no degrada).

### 21.5 Discrepancias con el contrato

- **Ninguna.** La respuesta de `/health` conserva su shape (`{ status, uptime, timestamp, db, redis }`,
  `redis ∈ up|down|skipped`). Sigue en pie del §12 la solicitud (no bloqueante) al **arquitecto** de
  **formalizar `GET /api/v1/health`** en `API_CONTRACT.md`.

## 22. v1.4-finance — Costo real de paquetería en el P&L (M-16, 2026-08-16)

Implementa el requisito #3 de `PROJECT.md` (criterio 21): el P&L trataba el envío **solo como
ingreso** (`shippingFeeCents`) y nunca restaba el **costo real** pagado a la paquetería,
sobreestimando la ganancia. Cambio **aditivo**, siguiendo `API_CONTRACT §M4/§M7` y `ARCHITECTURE §11 M-16`.

### 22.1 Qué cambió (solo `backend/`)

- **Modelo / migración M-16** (`prisma/schema.prisma` + `prisma/migrations/20260816140000_m16_shipping_cost/`):
  `ShipmentRequest` gana `shippingCostCents Int @default(0)` = costo real MXN (centavos) que la
  plataforma paga al carrier. **No** toca `shippingFeeCents` (sigue siendo el **ingreso** cobrado al
  cliente). `@default(0)` cubre filas históricas/sin captura. Migración = un `ADD COLUMN ... DEFAULT 0`
  (patrón aditivo, sin backfill; greenfield).
- **Captura en M4** (`modules/shipments/dto/shipments.dto.ts`, `admin-shipments.controller.ts`,
  `shipments.service.ts`): `TrackingDto` gana `shippingCostCents?` con `@IsOptional @IsInt @Min(0)`
  (negativo/no-entero ⇒ `422 VALIDATION_ERROR`). `setTracking()` lo persiste **solo si viene** (si se
  omite no se modifica; queda el default/valor previo ⇒ **editable** re-invocando). El endpoint es
  admin-only por la ruta; el costo **no** se expone al cliente. Se añade al `AuditLog`
  (`action: shipment.tracking`, `after.shippingCostCents` = valor persistido).
- **P&L M7** (`modules/admin/admin.service.ts` `pnl()`): la clave `shippingCents` se **renombra** a
  `shippingRevenueCents` (sigue sumando `shippingFeeCents`) y se **añade** `shippingCostCents` = suma
  de `s.shippingCostCents` sobre **los mismos** envíos ya filtrados por `pickingAt`
  (`status ∈ {picking, guia, enviado, entregado}`), para que ingreso y costo del envío caigan en el
  mismo periodo. Nueva fórmula:
  `profitCents = incomeCents + shippingRevenueCents − cogsCents − stripeFeesCents − shippingCostCents`.
  Response: `{ incomeCents, shippingRevenueCents, cogsCents, stripeFeesCents, shippingCostCents, profitCents }`.
- **CSV export** (`exportCsv`, `report=pnl`): cabecera y fila espejan el shape nuevo:
  `report,incomeCents,shippingRevenueCents,cogsCents,stripeFeesCents,shippingCostCents,profitCents`.
- **Consumidores internos:** el dashboard/summary usa `pnl().profitCents` (sin cambio de nombre), así
  que no requirió ajuste. Búsqueda global: no quedan referencias a la vieja clave `shippingCents`.

### 22.2 Tests (unitarios, propios)

- `test/admin.pnl-shipping.spec.ts`: `pnl()` devuelve el shape de 6 claves, **resta** `shippingCostCents`,
  separa ingreso (`shippingRevenueCents`) vs costo, envíos sin costo suman 0, y el CSV espeja el header nuevo.
- `test/shipments.tracking-cost.spec.ts`: `setTracking()` persiste `shippingCostCents` cuando se envía,
  **no** lo toca cuando se omite, es editable al re-invocar; `TrackingDto` acepta ausente/entero≥0 y
  **rechaza** negativos y no-enteros.

### 22.3 Gates (desde `backend/`)

- `npm run lint` ✅ · `npm run typecheck` ✅ · `npm test` ✅ **234 tests / 43 suites** (antes 224/41;
  +10 tests, +2 suites) · `npm run build` ✅.

### 22.4 Verificación manual (P&L con las 6 claves)

```bash
# como super_admin (token con rol super_admin):
curl -s "http://localhost:3001/api/v1/admin/finance/pnl?from=2026-01-01&to=2026-12-31" \
  -H "Authorization: Bearer <accessToken super_admin>" | jq
# => { "incomeCents":…, "shippingRevenueCents":…, "cogsCents":…,
#      "stripeFeesCents":…, "shippingCostCents":…, "profitCents":… }

# Captura de costo al asignar guía (avanza a `guia`, persiste el costo):
curl -s -X POST "http://localhost:3001/api/v1/admin/shipments/<shipmentId>/tracking" \
  -H "Authorization: Bearer <accessToken vault_operator+>" -H "Content-Type: application/json" \
  -d '{"carrier":"DHL","trackingNumber":"TRACK123","shippingCostCents":9000}'
# negativo => 422 VALIDATION_ERROR

# CSV con el header nuevo:
curl -s "http://localhost:3001/api/v1/admin/finance/export.csv?report=pnl" \
  -H "Authorization: Bearer <accessToken super_admin>"
# report,incomeCents,shippingRevenueCents,cogsCents,stripeFeesCents,shippingCostCents,profitCents
```

### 22.5 Discrepancias con el contrato

- **Ninguna.** Implementado al pie de `API_CONTRACT §M4/§M7` y `ARCHITECTURE §11 M-16`. No se tocó
  `frontend/`, `docs/API_CONTRACT.md` ni `docs/ARCHITECTURE.md`.

### 22.6 Correcciones de seguridad (blue team, `docs/SECURITY_NOTES.md` §C)

- **SEC-C1 (Media) — Fuga de `shippingCostCents` al cliente (CORREGIDO).** `listMine`/`getMine`
  (endpoints de CLIENTE `GET /shipments` y `GET /shipments/:id`) devolvían la fila **cruda** de
  Prisma; tras M-16 eso incluía `shippingCostCents` (costo interno del carrier / dato de margen que
  `API_CONTRACT §M4` marca "no se expone al cliente"). Se añadió el proyector privado
  `toClientShipment()` en `shipments.service.ts` que mapea a una **allowlist explícita** de los campos
  que el contrato declara para el comprador (`API_CONTRACT §5`): `id, status, addressSnapshot,`
  `shippingFeeCents, ivaCents, processingFeeCents, totalCents, carrier, trackingNumber, requestedAt,`
  `pickingAt, shippedAt, deliveredAt, items`. Se eligió **allowlist** (no `omit`/denylist) a propósito:
  si el modelo gana un campo interno futuro, no se filtra por accidente.
  - **`processingFeeCents`: SE INCLUYE** en la salida de cliente. Es un cargo que el comprador **paga**
    y ya lo ve en el `BreakdownDTO` de `quote`/`create` (`API_CONTRACT §5` y `BreakdownDTO`), así que no
    es dato interno de margen — a diferencia de `shippingCostCents`. (Nota del blue team: antes también
    se "fugaba" `processingFeeCents`; queda **dentro** por diseño del contrato, no por descuido.)
  - Como efecto de la allowlist, tampoco sale `stripePaymentIntentId` (el cliente ya recibe su
    `clientSecret` en `create`; el PI id no es campo de cliente). Defensa en profundidad.
  - **ADMIN sin cambios:** `adminGet`/`adminList` siguen devolviendo la fila cruda **con** el costo
    (los admins sí pueden verlo). La proyección solo acota los endpoints de cliente.
- **SEC-C2 (Baja) — `@Min(0)` sin `@Max` + overflow Int32 (CORREGIDO).** `TrackingDto.shippingCostCents`
  gana `@Max(SHIPPING_COST_MAX_CENTS)`. **Tope elegido: `100_000_00` cents = MX$100,000** (constante
  nueva exportada en `dto/shipments.dto.ts`). Holgado para el costo real de UN envío de paquetería y muy
  por debajo del `Int` de Postgres (2^31−1). No se reutilizó `BUYLIST_CAP_*`/`REPO_CAP_*` porque son
  topes de **negocio** (compra/reposición), semánticamente distintos del costo de paquetería; una
  constante dedicada evita acoplar límites no relacionados. `422 VALIDATION_ERROR` si excede el tope.
- **Tests (propios, `test/shipments.tracking-cost.spec.ts`):**
  - SEC-C1: `getMine`/`listMine` **omiten** `shippingCostCents` (y `stripePaymentIntentId`) y conservan
    los campos de cliente (incl. `processingFeeCents`); `getMine` sigue aplicando ownership (404 a otro
    usuario).
  - SEC-C2: `TrackingDto` acepta el valor en el borde (`= SHIPPING_COST_MAX_CENTS`) y **rechaza** por
    encima del tope.
- **Gates (desde `backend/`):** `npm run lint` ✅ · `npm run typecheck` ✅ · `npm test` ✅

---

## v1.5-auth-email — Verificación de correo + recuperación self-service (Resend)

Implementa el changelog v1.5 del contrato (§1 Auth) y ARCHITECTURE §3.2/§4.11/§10. La verificación
**NO bloquea el login** — bloquea **acciones sensibles** (comprar/retirar/vender) server-side.

### Modelo de datos (M-17)
- Migración: **`prisma/migrations/20260816150000_m17_auth_tokens/migration.sql`** (patrón aditivo/greenfield).
- Enum `AuthTokenType = email_verification | password_reset`; modelo **`AuthToken`** (`id`, `userId` FK
  `User` `onDelete: Cascade`, `type`, `tokenHash` `String @unique` = **SHA-256** del token en claro,
  `expiresAt`, `usedAt?`, `requestIp?`, `createdAt`) con `@@unique([tokenHash])`, `@@index([userId, type])`,
  `@@index([expiresAt])`. `User` gana `authTokens AuthToken[]`.
- **El token en claro NUNCA se persiste.** Es 32 bytes aleatorios (`crypto.randomBytes` → base64url, ~256
  bits); en BD vive su **SHA-256** (basta; no argon2 — no hay fuerza bruta con esa entropía). Emisión/consumo
  en `AuthTokenService` (`src/modules/auth/auth-token.service.ts`): `issue()` rota (invalida) los previos no
  usados del mismo tipo → solo el último link vale; `consume()` claima atómico (`updateMany` con `usedAt:null`
  + `expiresAt > now`) → **un solo uso**. TTL: verificación **24h**, reset **1h**.

### Módulo `mail` (`src/modules/mail/`)
- Puerto `MailPort` (token DI **`MAIL_PORT`**) + `ResendMailAdapter` (usa la lib **`resend`**, POST a Resend
  con `RESEND_API_KEY`, remitente `MAIL_FROM` default `no-reply@tcgvaultmx.com`) + `NoopMailAdapter`
  (local/CI/tests: loguea destinatario + link, **no envía**). `MailService` arma plantillas **bilingües ES/EN**
  por `User.locale` (`sendEmailVerification` / `sendPasswordReset`).
- **Selección del adaptador (`MailModule`, factory):** si hay `RESEND_API_KEY` → Resend; si no y es LOCAL_ENVS
  → Noop. En **no-local** la key es requerida por `env.validation` (nunca cae a Noop silencioso en prod).
- **Links al FRONTEND:** `AuthService.buildFrontendLink()` construye `${origin}/<locale>/verify-email?token=…`
  y `.../reset-password?token=…`, usando el **primer origin** de `APP_BASE_URL` (lista separada por comas) y
  `User.locale` (default `es`). El nombre del query param es contrato: `token`.

### Endpoints (auth.controller / auth.service)
- `POST /auth/verify-email/resend` — **customer+ (autenticado)**, body `{}`, usa `req.user` (cero
  enumeración) → `200 {ok:true}`. No-op si ya verificado. Rate-limit **3/h/usuario** (tope por servicio contando
  `AuthToken` emitidos la última hora) + backstop IP; `429 RATE_LIMITED` si excede.
- `POST /auth/verify-email` — **public** `{token}` → `200 {verified:true}`; `422 EMAIL_VERIFY_TOKEN_INVALID`
  si inválido/expirado/usado. **Idempotente:** si el usuario del token ya está verificado, responde `200`
  aunque el token esté usado (doble clic). **No** toca `tokenVersion`. Rate-limit 10/min/IP.
- `POST /auth/forgot-password` — **public** `{email}` → **SIEMPRE `200 {ok:true}`** (anti-enumeración). Si el
  email existe y la cuenta está **activa**, emite `password_reset` (1h), rota previos y envía correo (tope
  3/h/email en servicio; blocked/deleted no se procesan pero igual responde 200). Rate-limit **3/h/IP**.
- `POST /auth/reset-password` — **public** `{token, password}` → `200 {ok:true}`. Consume el token, setea
  `passwordHash` (**argon2id**), `tokenVersion++` (revoca sesiones, patrón existente), **`emailVerified=true`**
  (v1.5-3), limpia `mustChangePassword`, marca token usado. `422 RESET_TOKEN_INVALID`; `400 VALIDATION_ERROR`
  (password `MinLength 8`, misma política que register). **No** devuelve tokens (el usuario re-inicia sesión).
- `POST /auth/register` — ahora emite `email_verification` (24h) y envía el correo (best-effort; el fallo del
  envío **no** aborta el registro). El `user` de **register|login|google** incluye `emailVerified` (`publicUser`).

### Gating server-side (EmailVerifiedGuard)
- Guard `src/common/guards/email-verified.guard.ts` + decorador `@RequireEmailVerified()`
  (`src/common/decorators/require-email-verified.decorator.ts`). Registrado como `APP_GUARD` **tras**
  `JwtAuthGuard`/`RolesGuard` y **antes** de `MoneyOutGuard`. `403 EMAIL_NOT_VERIFIED` si `emailVerified=false`.
- **`JwtAuthGuard`** añade `emailVerified` al `select` y lo puebla en `req.user` (interfaz `AuthUser`).
- Aplicado **SOLO** a: `POST /checkout/session`, `POST /shipments`, `POST /buylist/requests`. Los `*/quote`
  y el cotizador público **no** se bloquean. Google entra con `emailVerified=true`; staff sembrado verificado.

### env / seed / jobs
- `env.validation.ts`: `RESEND_API_KEY` añadida a `required` (obligatoria en **no-local**; en LOCAL_ENVS
  degrada a Noop). `MAIL_FROM` opcional (default en código, no bloquea el arranque).
- **Seed (v1.5-6):** `admin`/`operator` (`prisma/seed.ts`) y todos los fixtures de `prisma/seed-e2e.ts`
  nacen `emailVerified=true` (el customer E2E también, para que el guard no bloquee los flujos de la suite).
- **Job `auth-token-sweep`** (`src/jobs/auth-token-sweep.service.ts`): borra `AuthToken` expirados/usados.
  Standalone `run()` (patrón buylist-sweep/ine-retention), registrado/exportado en `JobsModule`. Scheduling
  repetible BullMQ = deuda BE-5 (disparable a mano); no crítico (el consumo ya rechaza expirados/usados).

### Tests (propios)
- `test/auth.token.spec.ts` — emisión/consumo: hash SHA-256 (no claro), rotación, un solo uso, expiración por tipo.
- `test/auth.email-flows.spec.ts` — forgot anti-enumeración (200 sin email/sin enviar), reset (`tokenVersion++`
  + `emailVerified=true` + argon2 + token usado), verify (idempotencia doble clic / 422), resend (no-op/429).
- `test/email-verified.guard.spec.ts` — gating 403 sin verificar / pasa verificado / no restringe sin decorador.
- `test/mail.service.spec.ts` — MailService con `NoopMailAdapter` mockeado (asunto bilingüe, `to`, link en html/text).
- `test/env.validation.spec.ts` — actualizado: `RESEND_API_KEY` requerida en no-local, no en local.

### Discrepancias con el contrato
- **Ninguna.** El contrato/ARCHITECTURE describen el `ResendMailAdapter` como "POST https://api.resend.com/emails";
  se implementó con la librería `resend` (equivalente, añadida a `package.json`). Sin cambios a `API_CONTRACT.md`
  ni `ARCHITECTURE.md`. **Nota abierta del arquitecto (v1.5-2, no bloqueante):** `MAIL_FROM`=`tcgvaultmx.com` vs
  soporte `tcgvaultmx.com` — dominio canónico a fijar por el humano (no afecta esta implementación).

### Gates (desde `backend/`)
`npm run lint` ✅ · `npm run typecheck` ✅ · `npm test` ✅ (47 suites / 264 tests) · `npm run build` ✅
  **239 tests / 43 suites** · `npm run build` ✅.

### Cierre de hallazgos Baja de seguridad v1.5 (2026-08-16)

> Tras los 3 veredictos APROBADO (QA/techlead/seguridad), se cierran los 2 hallazgos **Baja** que
> seguridad pidió cerrar en esta entrega. El resto de la deuda Baja aceptada queda en `docs/TECH_DEBT.md`
> (sección "Deuda del pase correo v1.5": `v15-D1..D3`, `v15-S15-B2`, `v15-S15-B3`).

- **S15-B1 — escape de HTML en plantillas de correo** (`src/modules/mail/mail.templates.ts`). Nueva
  función `escapeHtml()` (escapa `& < > " '`) aplicada a **`name`** (dato controlado por el usuario) y al
  **`link`** en el **cuerpo HTML** de las **4** plantillas (verificación y reset, ES y EN). El `&` va
  primero para no re-escapar entidades. El **texto plano** y el layout/asuntos no cambian. Cierra el
  defecto de inyección (impacto acotado: el correo va solo al propio usuario, pero era interpolación cruda).
- **S15-B4 — revalidar `status` en `resetPassword`** (`src/modules/auth/auth.service.ts`). Defensa en
  profundidad: tras `consume` del token y **antes** de fijar la contraseña, se relee el usuario y se exige
  `status === active`; si no (blocked/deleted/futuro suspended → `user.status !== active`) se rechaza con
  **`403 USER_BLOCKED`** (mismo trato que login) y **no** se actualiza nada. Evita que un token de reset
  emitido antes de bloquear la cuenta permita fijar contraseña en una cuenta ya bloqueada. `UserStatus` hoy
  es `{active, blocked, deleted}`; la guardia `!== active` cubre cualquier estado no-activo futuro.
- **Tests añadidos:** `test/mail.service.spec.ts` (bloque "escape de HTML (S15-B1)": un `name` con
  `<script>`/`"`/`'`/`&` se escapa en el HTML de las 4 plantillas; el payload crudo no aparece).
  `test/auth.email-flows.spec.ts` (reset con cuenta `blocked` y `deleted` → `USER_BLOCKED`, sin `update`;
  el caso feliz ahora mockea `findUnique` → `active`).
- **Gates:** `npm run lint` ✅ · `npm run typecheck` ✅ · `npm test` ✅ (**47 suites / 271 tests**) ·
  `npm run build` ✅.

## v1.6-finish — Acabado / versión de carta (finish) en TODA la cadena (M-18, 2026-08-16)

> Implementa `API_CONTRACT` changelog v1.6-finish y `ARCHITECTURE` §3.7/§4.1/§4.2.1/§4.8/§4.9/§11 M-18
> **al pie de la letra**. El contrato manda. Enum `Finish = normal | reverse_holo | holofoil |
> first_edition_holofoil`. Cambio **aditivo con default seguro** (`normal` / `[normal]`).

### Migración M-18 (aditiva)
- Archivo: **`backend/prisma/migrations/20260816160000_m18_finish/migration.sql`** (correlativo tras
  M-17 `…150000`). Schema: `backend/prisma/schema.prisma`.
- Crea `CREATE TYPE "Finish"`; añade **`Card.availableFinishes Finish[] @default([normal])`**,
  **`PriceReference.finish Finish @default(normal)`**, **`InventoryItem.finish Finish @default(normal)`**,
  **`SellRequestItem.finish Finish @default(normal)`**. Filas históricas quedan operables sin re-sync.
- **Clave de `PriceReference`:** el `@@unique` pasó de `[cardId, productType, gradeKey, capturedDate]`
  a **`[cardId, productType, gradeKey, finish, capturedDate]`** (índice
  `PriceReference_cardId_productType_gradeKey_finish_capturedDa_key`). Así `normal` y `reverse_holo` de
  la misma carta tienen **referencia de precio distinta** (una fila por día **por acabado**). `gradeKey`
  **no** cambia de semántica (sigue siendo condición/grado); `finish` es una **columna ortogonal**.
- **`PendingPriceEntry` NO gana columna `finish`** (fuera del alcance explícito de M-18; el contrato solo
  lista los 4 modelos de arriba). Consecuencia menor: distintos acabados de la misma carta comparten la
  misma entrada de "precio pendiente" (keyed por `gradeKey`). Registrado como nota, no bloqueante.

### Import de acabados (`catalog/`)
- `pokemontcg-io.client.ts`: `RemoteCard.tcgplayer` ahora tipa **`prices?: Record<string,{market?}>`**
  (antes solo `{url}` y se descartaba). Sin cambio de host/anti-SSRF.
- `pricing.types.ts`: mapeo canónico **`TCG_KEY_TO_FINISH`** (`normal→normal`,
  `reverseHolofoil→reverse_holo`, `holofoil→holofoil`, `1stEditionHolofoil→first_edition_holofoil`;
  `1stEditionNormal`/`unlimitedHolofoil` **se ignoran**) e inverso **`FINISH_TO_TCG_KEY`**. Helper
  **`deriveAvailableFinishes(prices)`** (ausente/vacío/sin llaves mapeadas → `[normal]`).
- `catalog-sync.service.ts` `upsertCards`: deriva `availableFinishes` de las llaves presentes y lo
  persiste en create/update del `Card`.

### Pricing por acabado (`pricing/`)
- `PricingProviderInput` gana `finish`. `PokemonTcgIoProvider.fetchPrice` lee **`prices[FINISH_TO_TCG_KEY[finish]].market`**
  (deja de tomar "el primer market disponible"). Providers graded/sealed ignoran `finish`.
- `PricingService`: **`getReference(cardId, productType, gradeKey, finish='normal')`** y
  **`syncCardPrice(card, productType, gradeKey, finish='normal', context, refId?)`** ganan `finish`
  (posición explícita antes de `context`, como el contrato). El lookup/upsert usa la clave compuesta con
  `finish`. `manualOverride(...)` y `POST /admin/pricing/override` ganan `finish?` (default normal).
  `buildGradeKey` **NO cambia**. `finish` default `normal` conserva a graded/sealed y a todos los
  callers no-raw sin fricción.
- Job `price-sync.service.ts`: pricea `item.finish` de cada copia física.

### Resolver finish→regla determinista (`common/money.ts`, §4.2.1)
- **`isHoloRarity(rarity)`** = `rarity` contiene `"holo"` (case-insensitive).
- **`ruleKeyCandidates(rarity, finish)`**: `reverse_holo→["Reverse Holo"]`; `holofoil`/
  `first_edition_holofoil`→ `isHoloRarity ? [rarity,"Holo"] : ["Holo"]`; `normal→[rarity]`.
- **`quoteAcquisitionForFinish(rarity, finish, referenceMxnCentsForFinish, rules, fallbackPct)`**: gana el
  **primer candidato con regla explícita**; si ninguno → `BUYLIST_PRICE_FALLBACK_PCT`. `pct` sobre el
  **market DEL acabado** cotizado; `fixed` siempre cotiza. `first_edition_holofoil` usa la regla de
  holofoil con el market de la llave `1stEditionHolofoil` (vía `getReference(..., finish)`).
- Resultado con el seed vigente: una **común en reverse_holo** cotiza con **"Reverse Holo" ($1.50)**, no
  con "Common"; una **común en holofoil** salta a `"Holo"` (no sembrada) → **40% del market holofoil**.

### Buylist quote/request + M1 inventario + convert
- DTOs (`buylist/dto/buylist.dto.ts`, `inventory/dto/inventory.dto.ts`): `PublicQuoteDto`,
  `RequestItemDto` y `CreateItemDto` ganan **`finish?`** (default normal, `@IsIn` de los 4 valores).
- `BuylistService`: helper **`assertFinishAvailable(card, finish)`** valida server-side contra
  `card.availableFinishes` → **`422 FINISH_NOT_AVAILABLE`** (nuevo `ErrorCode`). `publicQuote` responde
  `finish` + `appliedRule` resuelto por acabado; `createRequest` valida, cotiza por acabado y
  **snapshotea `SellRequestItem.finish`**; `itemDTO` (SellItemDTO) expone `finish`. **SEC-A1 intacto:** el
  monto se deriva de `(Card.rarity, finish)` validado, **nunca** del cliente.
- `InventoryService.createItem`: **`resolveFinish(dto, card.availableFinishes)`** — raw valida contra la
  lista blanca (422 si no); **graded/sealed = `normal` siempre**. Propaga a `InventoryItem.finish` y usa
  el finish para la referencia de la aportación en especie.
- `convertToInventory` (M5): propaga `SellRequestItem.finish` → `InventoryItem.finish`.
- Valuación de portafolio/inventario/custodia/orden (`vault.service`, `admin.service`, `orders.service`)
  usa `item.finish` en `getReference`.

### Catálogo "Compra" (`catalog/`)
- `toCardDTO` expone **`availableFinishes`**. `ListingDTO`/`HoldingDTO`/`SellItemDTO` exponen **`finish`**.
- `GET /catalog/cards` gana filtro **`finish`** (sobre `InventoryItem.finish`; inválido → 400).
  `GET /catalog/facets` gana **`finishes`** (distinct sobre el inventario publicado). `toListingDTO`,
  `vault.holdings`/`holdingDetail` valúan contra la `PriceReference` del acabado del item.

### Endpoints/DTOs con finish (resumen)
`POST /buylist/quote` (+`finish?` req, +`finish`/`appliedRule` res) · `POST /buylist/requests`
(`items[].finish?`) · `POST /admin/inventory/items` (+`finish?`) · `POST /admin/pricing/override`
(+`finish?`) · `GET /catalog/cards?finish=` · `GET /catalog/facets` (+`finishes`) · `CardDTO`
(+`availableFinishes`) · `ListingDTO`/`HoldingDTO`/`SellItemDTO` (+`finish`). Nuevo error
**`422 FINISH_NOT_AVAILABLE`**.

### ⚠️ RE-SYNC del catálogo requerido tras desplegar (devops/QA)
Las cartas ya importadas quedan con `availableFinishes=[normal]` y sus `PriceReference` en `finish=normal`
hasta que se **RE-SINCRONICE** el catálogo (`POST /admin/catalog/sync` / `sync-all`) y el **price-sync**
repueble las referencias por acabado. El default seguro mantiene todo operable mientras tanto; el re-sync
es idempotente. **No lo ejecuté** (requiere entorno con la API key y la BD desplegada).

### Tests añadidos
- `test/buylist.finish.spec.ts` (15): resolver puro (`isHoloRarity`/`ruleKeyCandidates`/
  `quoteAcquisitionForFinish`), cotización común reverse_holo → "Reverse Holo", `pct` con la referencia
  del acabado, `precio_pendiente` por acabado sin ref, **`FINISH_NOT_AVAILABLE`** en quote y request,
  snapshot del finish y **convert propaga finish**.
- `test/catalog-sync.finish.spec.ts` (5): `deriveAvailableFinishes` (mapeo/descarte/default) y
  `upsertCards` persiste `availableFinishes` derivado de `tcgplayer.prices`.

### Gates
`npm run lint` ✅ · `npm run typecheck` ✅ · `npm test` ✅ (**49 suites / 291 tests**) ·
`npm run build` ✅.

### Discrepancias con el contrato
Ninguna que bloquee. El contrato fue implementable al pie de la letra. Única nota de diseño propio (dentro
del alcance): `PendingPriceEntry` no lleva `finish` porque M-18 no lo lista entre los modelos a migrar.

## 23. Modo `force` en sync-all/backfill (v1.6-finish · 2026-08-16) — fix re-sync que no repueblaba `availableFinishes`

### Bug
El re-sync NO repueblaba `Card.availableFinishes` (los sets viejos quedaban en `['normal']`) porque
`syncAll` **saltaba** los sets ya importados: filtraba `importedWithCards` (`_count.cards > 0`) y solo
procesaba los `pending`. El UPDATE del upsert (`upsertCards`) SÍ incluye `availableFinishes`, pero nunca
se ejecutaba sobre sets ya poblados. `backfill` tenía el mismo filtro (`!importedIds.has(s.id)`).

### Fix (solo `backend/`)
- **`catalog-sync.service.ts` → `syncAll(options: { force?: boolean } = {})`:** con `force:true` NO filtra
  los sets ya poblados — reprocesa **TODOS** los sets remotos y re-upserta sus cartas vía `upsertCards`
  (idempotente por `externalId`), refrescando `availableFinishes` y disparando el poblado de precios por
  acabado. `force:false` (default) mantiene el comportamiento de hoy (salta importados). Firma
  retro-compatible: `syncAll()` sin args sigue funcionando.
- **`backfill(batchSize, untilYear, force = false)`:** mismo patrón — con `force:true` los candidatos no
  se filtran por importados; default intacto.
- **Idempotencia/robustez reusadas:** el barrido forzado sigue el mismo camino fire-and-forget
  (single-flight `syncAllRunning`, `runSyncAll` secuencial respetando rate-limit, aislamiento por-carta de
  `upsertCards` v1.3.1). El request responde `202` de inmediato; el reproceso pesado corre en background.

### Endpoint (nombre exacto + cómo se pasa `force`)
- **`POST /admin/catalog/sync-all`** (guard `@Roles(Role.super_admin)` intacto). Acepta `force` por
  **body `{"force": true}`** o **query `?force=true`** (también `?force=1`). Default `false`. La respuesta
  `202` no cambia de shape; `force` se registra en `AuditLog.after`.
- **`POST /admin/catalog/backfill`** acepta `force` igual (body/query), default `false`.
- Precedencia: si viene en el body, gana el body; si no, se lee la query (`parseForce`).

### Cómo usar (operación, tras desplegar — resuelve el ⚠️ RE-SYNC de la sección "finish")
`POST /api/v1/admin/catalog/sync-all?force=true` (super_admin) reprocesa todo el catálogo y repuebla
`availableFinishes`/precios por acabado en los sets ya importados. **No lo ejecuté** (requiere entorno con
API key + BD desplegada); es idempotente.

### Archivos tocados
- `backend/src/modules/catalog/catalog-sync.service.ts` — `force` en `syncAll` y `backfill`.
- `backend/src/modules/catalog/admin-catalog.controller.ts` — `SyncAllDto`, `force` en `sync-all`/`backfill`
  (body+query), `parseForce`, auditoría incluye `force`.
- `backend/test/catalog-sync.spec.ts` — tests `force:false` (salta importados) vs `force:true` (reprocesa).

### Tests + gates
- Nuevos: `force:false` (default) NO encola sets ya importados; `force:true` encola **todos** los remotos
  aunque estén poblados (verifica el arg pasado a `runSyncAll`).
- `npm run lint` ✅ · `npm run typecheck` ✅ · `npm test` ✅ (**49 suites / 293 tests**) · `npm run build` ✅.

### Discrepancias con el contrato
Ninguna. No toqué `API_CONTRACT.md` ni `ARCHITECTURE.md` (el arquitecto documenta el nuevo param en
paralelo). El endpoint y verbo existentes no cambian; `force` es un parámetro opcional aditivo.

## 25. BUG A1 (INE) — presigned PUT a R2 daba 403 SignatureDoesNotMatch (2026-08-16)

> Síntoma: el navegador subía la foto del INE directo a Cloudflare **R2** con la URL prefirmada (PUT) que
> emite `POST /uploads/presign`, y R2 respondía **403 `SignatureDoesNotMatch`**. El presign en sí y la
> validación de content-type/tamaño funcionaban; fallaba solo el PUT real del navegador.

### Causa raíz
El **AWS SDK v3** (`@aws-sdk/client-s3 ^3.1109`) trae por defecto
`requestChecksumCalculation: 'WHEN_SUPPORTED'`. Con ese default, al firmar la URL (`getSignedUrl` sobre un
`PutObjectCommand`) el SDK **incluye los headers `x-amz-sdk-checksum-algorithm` y `x-amz-checksum-crc32`
dentro de los `SignedHeaders`** de la firma. Pero el navegador, al hacer el PUT directo a R2, **solo envía
`Content-Type`** (y `Content-Length` si se fijó) — NO manda esos headers de checksum. Como los headers
firmados no coinciden con los enviados, la firma no valida → **403 SignatureDoesNotMatch**. Es un choque
conocido del SDK v3 con presigned URLs consumidas fuera del propio SDK (navegador / S3-compatibles como R2).

### Fix (solo `backend/`, sin cambio de contrato)
- **`src/modules/uploads/uploads.service.ts`** (getter `s3`, construcción del `S3Client`): se añaden dos
  opciones al cliente:
  - `requestChecksumCalculation: 'WHEN_REQUIRED'`
  - `responseChecksumValidation: 'WHEN_REQUIRED'`
  Con `WHEN_REQUIRED` el SDK **no** agrega los headers de checksum al presign salvo que la operación los
  exija (PutObject no los exige), de modo que el PUT del navegador (que solo manda `Content-Type`) vuelve
  a validar la firma. **No** se tocó la lógica de presign, el allow-list `image/*`, el `ContentLength`, ni
  `presignGet`/`deleteObject`. `POST /uploads/presign` conserva su shape (`API_CONTRACT §8`).

### Tests
- `test/uploads.presign.spec.ts` (ampliado): nuevo `describe` que **mockea `@aws-sdk/client-s3`** para
  capturar la config con la que se construye el `S3Client` y verifica que se pasa
  `requestChecksumCalculation: 'WHEN_REQUIRED'` (y `responseChecksumValidation: 'WHEN_REQUIRED'`), además de
  que el cliente se construye **una sola vez** (getter lazy). Los tests previos (solo `kyc_ine`, allow-list
  de content-type, tope de tamaño) siguen intactos.

### Gates (desde `backend/`)
- `npm run lint` ✅ · `npm run typecheck` ✅ · `npm test` ✅ · `npm run build` ✅.

### Nota para QA/devops
El E2E de infra (`test/integration/infra-smoke.e2e-spec.ts`) ya hacía un **PUT real** contra MinIO; contra
**MinIO** el bug no se dispara igual que en R2, pero el fix es correcto para ambos (MinIO tampoco reenvía
los headers de checksum firmados desde un cliente HTTP plano). Para reproducir el 403 original hay que
apuntar el PUT a un endpoint **R2** con el SDK sin el flag. Sin cambios de env ni de infra.

### Discrepancias con el contrato
Ninguna. Solo configuración del cliente S3; `API_CONTRACT.md` no cambia.

## 26. v1.7-admin-users (2026-08-16) — Alta de usuarios por rol (E2) + historial 360° por usuario (F2)

Dos features aditivas de M6, **sin migración** (reusan `User`, `AuditLog` y los listados admin ya
paginados). Contrato: `API_CONTRACT.md` §M6 (E1/F1) + §M4/§M5/§M8 (`?userId=`) + §11 DTOs
(`AdminCreatedUserDTO`, `UserAuditEntryDTO`). Arquitectura: §4.7bis (c) / §4.7ter.

### E2 — `POST /api/v1/admin/users` (super_admin-only, auditado `user.create`, NO money-out)
- **Controller** `AdminUsersController.createUser` (`backend/src/modules/admin/admin.controller.ts`),
  `@Post()` + `@Roles(Role.super_admin)` (override del guard de clase `vault_operator+`), `@HttpCode(201)`.
- **Service** `AdminService.createUser` (`backend/src/modules/admin/admin.service.ts`).
- **Autogen de password:** si el req **omite** `password`, se autogenera una temporal de alta entropía
  **reusando el mismo generador del reset M-15** (`randomBytes(18).toString('base64url')`, ~24 chars) y
  se devuelve **UNA sola vez** en `tempPassword`. Se hashea con `argon2.hash` (patrón `auth.service.ts`),
  y `mustChangePassword=true`. Si el admin **provee** `password` (≥8), `mustChangePassword=false` y **no**
  hay `tempPassword`. En ambos casos `emailVerified=true` (staff como el seed; el customer porque el admin
  da fe — **no** se envía correo) y `authProvider='local'`. Sin KYC/CLABE/INE.
- **`email` se lowercasea** antes de persistir/validar unicidad (paridad con `/auth/register:102`).
- **Errores:** `409 EMAIL_TAKEN` (Prisma `P2002`); `422 VALIDATION_ERROR` (email/rol/locale inválidos,
  password débil); `403 FORBIDDEN` (guard de rol para no-super_admin).
- **Respuesta** (`AdminCreatedUserDTO`): `{ user: { id, email, name, role, locale, status, emailVerified,
  authProvider, createdAt }, tempPassword?, mustChangePassword }`. El `user` es **shape público** (sin
  `passwordHash`).
- **Seguridad / AuditLog:** el `after` de `user.create` guarda solo `{ role, emailVerified, authProvider,
  mustChangePassword }` — la contraseña (temp o provista) **NUNCA** entra al `AuditLog` ni a logs (mismo
  criterio que `user.reset_password`). Test defensivo verifica que el valor de la temp no aparece serializado.

> **Nota de validación (422 vs 400) — patrón del repo, no discrepancia de contrato.** El contrato §M6
> exige `422 VALIDATION_ERROR` para email/rol/password inválidos. El `ValidationPipe` global de NestJS
> devuelve **400** para fallos de `class-validator` y corre **antes** que cualquier pipe de ruta/param, así
> que `@IsEmail`/`@IsIn`/`@MinLength` en el DTO producirían 400, contradiciendo el contrato. Igual que
> `uploads`/`settings` (ver §16 y el comentario en `uploads.controller.ts`), el DTO declara solo la
> **estructura** (`@IsString`/`@IsOptional`, para sobrevivir al `whitelist`) y la validación **semántica**
> (formato de email, rol ∈ {customer|vault_operator|super_admin}, locale ∈ {es|en}, longitud de password)
> vive en `AdminService.createUser` lanzando `BusinessException.validation('VALIDATION_ERROR')` → **422**.
> Esto además hace la validación **unit-testeable** a nivel de servicio (como el resto de M6).

### F2 — Historial por usuario (reuso; no engorda `getUser`)
- **`?userId=` opcional** añadido a `GET /admin/buylist` (`SellRequest.userId`), `GET /admin/shipments`
  (`ShipmentRequest.userId`), `GET /admin/disputes` (`Dispute.userId`) — **patrón EXACTO** de
  `GET /admin/orders` (`@Query('userId')` → `where.userId`). Solo se añade el filtro; el **shape de
  respuesta, el guard (`vault_operator+`), la proyección PII por rol y la paginación no cambian**.
  Servicios: `buylist.service.ts:adminList`, `shipments.service.ts:adminList`, `disputes.service.ts:adminList`
  (4º parámetro `userId?`). Controllers añaden `@Query('userId')`.
- **`GET /api/v1/admin/users/:id/audit`** (`AdminUsersController.userAudit`, paginado). Roles: `super_admin`
  (proyección completa **con `ip`**) y `vault_operator` (**reducida, sin `ip`**) — cubierto por el guard de
  clase. Query `?scope=target|actor|both&page=&pageSize=`:
  - `target` (default): `entityType='User' AND entityId=:id` (acciones **sobre** el usuario).
  - `actor`: `actorUserId=:id` (acciones **del** usuario). `both`: OR de ambas.
  - Un `scope` desconocido se normaliza a `target` en el controller.
- **Método de LECTURA en `AuditService`** (`backend/src/modules/audit/audit.service.ts`, antes solo `log()`):
  `AuditService.listForUser({ userId, scope, role, page, pageSize })`. **404 `NOT_FOUND`** si el usuario no
  existe (consulta `user.findUnique` antes de tocar `AuditLog`).
- **`ip` condicional por rol:** se **reusa el `select` del audit-log de M10** (id/actorUserId/actorRole/
  action/entityType/entityId/createdAt) y se añade `...(isSuperAdmin ? { ip: true } : {})`. Para
  `vault_operator` la columna `ip` **ni siquiera se selecciona** en la query (no se lee de BD y no puede
  filtrarse). **`before`/`after` NUNCA** se seleccionan (posible PII/estado sensible), alineado con la regla
  de ARCHITECTURE §3.2. DTO expuesto: `UserAuditEntryDTO = { id, actorUserId, actorRole, action, entityType,
  entityId, createdAt, ip? }`.

### Tests (unitarios, sin Postgres/Redis)
- `backend/test/admin.user-create.spec.ts` (E2): crea customer/operator/super_admin OK; email lowercaseado;
  `emailVerified=true`/`authProvider='local'`; autogen → `tempPassword` una vez + `mustChangePassword=true`;
  password provista → `mustChangePassword=false` sin `tempPassword`; 422 para rol/email/locale/name/password
  débil; 409 `EMAIL_TAKEN` (P2002); auditoría no filtra la contraseña.
- `backend/test/admin.user-audit.spec.ts` (F2): scope target/actor/both arman el `where` correcto;
  super_admin selecciona `ip`, vault_operator no; nunca `before`/`after`; 404 usuario inexistente;
  paginación skip/take/total; normalización de scope inválido; metadata `@Roles` (super_admin en `createUser`,
  vault_operator+ a nivel de clase para el audit read); `?userId=` filtra en buylist/shipments/disputes.

### Gates
`npm run lint`, `npm run typecheck`, `npm test` (51 suites / 323 tests) y `npm run build` — **verdes**.

### Discrepancias con el contrato
Ninguna. `API_CONTRACT.md` / `ARCHITECTURE.md` no se tocan. La única decisión de implementación digna de
nota es el **422 en el servicio** (arriba), que **cumple** el contrato §M6 (400 sería la desviación).

---

## 18. Pase P0 jobs de barrido + cap de dinero saliente (BE-5 / v15-D1 / B-4 / BE-8)

> Cierra la deuda P0 de backend que toca **PII/dinero/ciclo de datos**: cablea los 4 jobs de barrido al
> scheduler, los hace disparables a mano, tapa el hueco de dinero saliente del buylist (B-4) y cierra BE-8.

### 18.1 Scheduler — los 7 jobs diarios cableados (BE-5 + v15-D1)
`src/jobs/scheduler.service.ts` ahora programa **7** jobs repetibles BullMQ (antes solo 3). Todos siguen el
**mismo patrón** (`queue.add(name, {}, this.repeat(name, cron))` + `case name: return this.<svc>.run()` en el
worker). El helper `repeat()` mantiene el **single-flight** (`jobId: <name>-daily`) + `removeOnComplete: true`
+ `removeOnFail: 100`, así que multi-instancia deduplica por `jobId`. Cron en **UTC**, escalonados para no
solaparse:

| Job | Cron (UTC) | Servicio (`run()`) | Qué hace |
|---|---|---|---|
| `fx-refresh` | `0 6 * * *` | `FxRefreshJobService` | tipo de cambio USD→MXN |
| `price-sync` | `15 6 * * *` | `PriceSyncJobService` | refresco de precios en bóveda |
| `portfolio-snapshot` | `0 7 * * *` | `PortfolioSnapshotJobService` | snapshot diario del portafolio |
| `ine-retention` | `30 7 * * *` | `IneRetentionJobService` | **purga PII INE** por `INE_RETENTION_DAYS` (LFPDPPP) |
| `dispute-deadline` | `45 7 * * *` | `DisputeDeadlineJobService` | disputa `abierta` vencida → `en_revision` |
| `buylist-sweep` | `0 8 * * *` | `BuylistSweepJobService` | 7d→`rechazada` / 30d→`abandonada` |
| `auth-token-sweep` | `15 8 * * *` | `AuthTokenSweepJobService` | limpia `AuthToken` expirados/usados |

- **Sin cambio de comportamiento en `buylist-sweep`**: se cablea el `run()` **actual** (7d/30d). La conversión
  a inventario de la carta abandonada (BE-3) **se difiere** (sigue como deuda, no se tocó).
- Se **inyectan** los 4 servicios nuevos en el constructor del scheduler (ya eran providers de `JobsModule`).
- Log de arranque actualizado: enumera los 7 jobs.

### 18.2 Endpoints manuales de disparo (super_admin, auditados)
`AdminJobsController` (`src/jobs/admin-jobs.controller.ts`) suma 4 endpoints al ya existente
`POST /admin/jobs/portfolio-snapshot`, mismo patrón (super_admin, `@HttpCode(200)`, auditado, devuelve el
resumen del `run()`):

| Endpoint | `action` auditado | Devuelve |
|---|---|---|
| `POST /admin/jobs/ine-retention` | `jobs.ine_retention.run` | `{ purged, scanned }` |
| `POST /admin/jobs/buylist-sweep` | `jobs.buylist_sweep.run` | `{ rejected, abandoned }` |
| `POST /admin/jobs/dispute-deadline` | `jobs.dispute_deadline.run` | `{ expired }` |
| `POST /admin/jobs/auth-token-sweep` | `jobs.auth_token_sweep.run` | `{ deleted }` |

> **Nota de contrato:** estos `/admin/jobs/*` son **operativos de ops** (disparo de jobs internos), no
> cambian ningún contrato de negocio ni shape de datos del cliente. Igual que el `POST /admin/jobs/portfolio-snapshot`
> ya existente, **no** se documentan en `API_CONTRACT.md` (superficie operativa admin). No requieren
> decisión del arquitecto.

### 18.3 Cap de `approvedPriceCents` — dinero saliente del buylist (B-4 / S-B5)
Defensa en profundidad, **dos capas**, sobre `ItemDecisionDto.approvedPriceCents` (la decisión carta-por-carta
que fija el monto SPEI a pagar al vendedor):
1. **DTO (`buylist.dto.ts`)**: `@Max(MAX_APPROVED_PRICE_CENTS)` con `MAX_APPROVED_PRICE_CENTS = 1_000_000`
   (**MX$10,000**, = tope AML mensual por defecto). Cota **dura de sanidad**: rechaza en el `ValidationPipe`
   (**400**) el PoC `99999999`. Un ítem individual nunca puede aprobar más que el tope mensual completo.
2. **Server-side (`buylist.service.ts` → `itemDecision` / `assertApprovedPriceWithinCap`)**: cota **fina**
   (SEC-A1, el dinero se valida en el servidor, no se confía al DTO). El monto efectivo debe ser
   **≤ min(`quotedPriceCents` × 2, tope por solicitud `buylist_cap_per_request_cents`)**. El **factor 2×**
   permite ajustes al alza acotados tras verificar la carta; el tope AML por solicitud (300,000c default) es la
   cota absoluta. Sin `quotedPriceCents` (carta que estaba en `precio_pendiente`) aplica **solo** la cota AML.
   Excede → **`APPROVED_PRICE_CAP_EXCEEDED`** (422, nuevo `ErrorCode`).
- **No rompe el flujo normal**: aprobar el precio cotizado tal cual (o un ajuste ≤ 2×) siempre pasa. **No toca
  SEC-A1** (la derivación server-side de la cotización) ni la guardia de aprobación de convert-to-inventory.

### 18.4 BE-8 (CORS `origin:true`) — ya estaba RESUELTA
`src/main.ts` **ya** usa `resolveCorsOrigins()` (allow-list desde `APP_BASE_URL`, fallback a `localhost` de
dev, **nunca** `origin:true`). No requirió cambio; se marca BE-8 como **RESUELTA/obsoleta** en `TECH_DEBT.md`.

### 18.5 Tests (unitarios, sin infra) + gates
- `test/scheduler.spec.ts` (reescrito): con **bullmq/ioredis mockeados**, verifica que **con `REDIS_URL`** se
  programan los **7** jobs con su cron exacto y que el worker enruta cada barrido a su `run()`; **sin
  `REDIS_URL`** sigue siendo no-op sin abrir conexiones.
- `test/admin-jobs.controller.spec.ts` (nuevo): los 5 endpoints corren `run()`, devuelven el resumen y auditan
  con su `action`.
- `test/buylist.approved-price-cap.spec.ts` (nuevo): rechaza por encima del tope (PoC y por AML), acepta ajuste
  normal (≤ 2×) y el flujo de aprobar el cotizado.
- **Gates verdes:** `lint`, `typecheck`, `test` (**53 suites / 336 tests**), `build`.

### 18.6 Discrepancias con el contrato
Ninguna. No se tocó `API_CONTRACT.md` ni `ARCHITECTURE.md`. Los `/admin/jobs/*` son superficie operativa admin
(ver §18.2). El `APPROVED_PRICE_CAP_EXCEEDED` es un `errorCode` de negocio nuevo (422) coherente con el patrón
de errores existente; no altera ningún shape de respuesta del contrato.

## 27. Ronda C (v1.8-ronda-c · 2026-08-16) — contrato M-19 + barrido de deuda backend

Pase que implementa las tres deudas de Ronda C del contrato (BE-10, `PendingPriceEntry.finish`, SEC-D2)
más un barrido de deuda de backend (RB-6, RB-3, RB-1/2/5, BE-9). **SEC-A1 intacto**: todos los montos
(incluido `approvedTotalCents`) se derivan server-side, nunca del cliente.

### 27.1 Migración M-19
`prisma/migrations/20260816170000_m19_pending_finish_sellrequest_closedat/migration.sql`. Dos columnas
aditivas con default seguro; **sin enums nuevos, sin backfill** (defaults/fallbacks cubren filas legacy):
- `PendingPriceEntry.finish  Finish  NOT NULL DEFAULT 'normal'` — la cola de precio pendiente pasa a ser
  **por acabado**. Modelo Prisma real (no solo DTO): `schema.prisma` gana la columna + comentario.
- `SellRequest.closedAt  TIMESTAMP(3)` (nullable) — fecha del cierre real (terminal). Campo interno de
  cumplimiento; **no** se expone en DTOs de cliente.

### 27.2 PricingService — 2 bugs funcionales + override por acabado
- **`manualOverride` (fix):** el `updateMany` que resuelve pendientes ahora filtra por `finish` en el
  `where` → resuelve **solo** el pendiente de ese acabado (antes cerraba `normal`+`holofoil`+… de la
  misma carta con un solo override).
- **`syncCardPrice` (fix):** propaga `finish` a `escalatePending` (antes encolaba sin acabado, colapsando
  acabados distintos en UNA entrada). `escalatePending` gana un parámetro `finish` (default `normal`) que
  entra a la clave de dedupe (`findFirst`) y a la fila creada.
- **`buylist.service.createRequest`:** la llamada a `escalatePending` propaga el `finish` cotizado.
- **`POST /admin/pricing/override`:** ya recibía `finish?` (default `normal`) en el `OverrideDto` y lo
  pasaba a `manualOverride`; se añadió `finish` al `after` de la auditoría. Fija la `PriceReference` de ese
  acabado y (con el fix) resuelve solo su pendiente.

### 27.3 BE-10 — `AdminUserOwnedItemRef` con `finish` + `productType` + `referenceValue`
`admin.service.getUser().ownedItems` ahora conforma el contrato §M6 enriquecido. Se extrajo un helper
privado `ownedItemRefs(items)` que reusa `PricingService.getReference`-equivalente por acabado. **Anti
N+1 (batch):** una sola lectura `priceReference.findMany({ where: { cardId: { in: [...] } } })` ordenada
`capturedDate desc, createdAt desc`; se arma un `Map` `(cardId|productType|gradeKey|finish) → ref más
reciente` y se resuelve cada item en memoria (misma semántica que `getReference`). Items sin precio del día
→ `referenceValue.status="pending"` (**no se excluyen**: es vista 360°, no un total de portafolio).

### 27.4 SEC-D2 — `closedAt` en transiciones terminales + retención de INE
`closedAt = now` se sella en **un solo punto por transición** terminal:
- `buylist.service.respond(decline)` → `rechazada`.
- `buylist.service.paySpei` → `pagada` (en el `updateMany` atómico terminal).
- `buylist-sweep.run`: `rechazada` (7d) y `abandonada` (30d).

`ine-retention.service.closureDate` usa `SellRequest.closedAt` como **fuente prioritaria** con **fallback**
al cálculo por timestamps de estado cuando `closedAt` es null (filas legacy). El **predicado de seguridad
NO cambia** (openCount>0 → continue; requiere `lastClosed` y `closureDate ≤ cutoff`).

### 27.5 Deudas de backend cerradas
- **RB-6 / SEC-D3:** `SellRequest.approvedTotalCents` ahora **se escribe** server-side. Nuevo helper
  `recomputeApprovedTotal(sellRequestId)` = suma de `approvedPriceCents` de los ítems (via `aggregate`),
  invocado tras cada `itemDecision`. Sin ítems aprobados → `null` (distingue "sin aprobar" de "cero"). El
  P&L / tarjeta "buylist del periodo" (`admin.dashboard`, `_sum.approvedTotalCents` para `pagada`) ya lo
  lee → deja de dar 0.
- **RB-3:** `assertApprovedPriceWithinCap` recibe el cap AML **ya resuelto** por `itemDecision`, que ahora
  honra `kyc.capPerRequestCentsOverride` del usuario (misma fuente que `createRequest`) con fallback al
  dial global. Un usuario con override alto ya no ve rechazada una aprobación legítima.
- **RB-1:** taxonomía de auditoría de jobs uniforme `jobs.<name>.run` (`portfolio_snapshot` era el único
  sin sufijo `.run`).
- **RB-2:** `entityType: 'Job'` + `entityId: '<job>'` presentes en TODA la auditoría de `/admin/jobs/*`.
- **RB-5:** JSDoc corregido en `buylist-sweep.service.ts` (decía "30d → convertida_inventario"; el código
  setea `abandonada`) e `ine-retention.service.ts` (decía "scheduling BullMQ es deuda BE-5"; ya cableado).
- **BE-9:** validación de credenciales centralizada en `common/validation/credentials.ts`
  (`MIN_PASSWORD_LENGTH`, `EMAIL_REGEX`, `normalizeEmail`, `isValidEmailFormat`, `isStrongPassword`),
  consumida por `admin.createUser` y por las DTOs de `auth` (`RegisterDto`/`ResetPasswordDto` usan la
  constante compartida). Fin de la lógica duplicada.

### 27.6 Deudas DIFERIDAS (no tocadas, siguen en TECH_DEBT)
BE-2 (TOCTOU), BE-3 (30d→inventario), BE-4/D3 (N+1 valuaciones a escala), BE-6 (providers graded/sealed),
BE-7 (orden huérfana), D1/D2 (BullMQ catálogo/paginación), RB-4 (2× dial), enumeración/timing (aceptadas),
SEC-D1 (lifecycle R2 = devops/humano).

### 27.7 Tests (nuevos/actualizados) + gates
- `test/pricing.finish-pending.spec.ts` (nuevo): (a) `manualOverride` filtra por `finish` en el updateMany;
  `escalatePending` encola con `finish` en clave+fila; defaults `normal`.
- `test/buylist.ronda-c.spec.ts` (nuevo): (d) `approvedTotalCents` derivado y persistido (+ `null` sin
  aprobados); (e) cap honra el override KYC (aprueba con override, rechaza sin él); (c) `closedAt` en
  `respond(decline)` y `paySpei`.
- `test/buylist-sweep.closedat.spec.ts` (nuevo): `closedAt` en `rechazada`/`abandonada` del sweep.
- `test/ine-retention.spec.ts` (ampliado): `closedAt` es la fuente prioritaria del cierre (2 casos).
- `test/admin.pii.spec.ts` (ampliado): `ownedItems` trae `finish`+`productType`+`referenceValue` (pending
  sin precio; priced con `PriceReference` del acabado; **una** query batch).
- `test/buylist.approved-price-cap.spec.ts` (actualizado): mock del nuevo shape de `itemDecision`
  (include `sellRequest.userId`, `kycProfile`, `aggregate`).
- `test/admin-jobs.controller.spec.ts` (actualizado): nueva taxonomía `.run` + entityType/entityId.
- **Gates verdes (desde `backend/`):** `lint`, `typecheck`, `test` (**56 suites / 350 tests**), `build`.

### 27.8 Discrepancias con el contrato
Ninguna. No se tocó `API_CONTRACT.md` ni `ARCHITECTURE.md`. La implementación conforma v1.8-ronda-c
(§M2 override+cola por acabado, §M6 BE-10, §11 DTOs, §12). Todo se deriva server-side (SEC-A1).

## 28. Fix CI-1 — aislamiento de tests env-sensibles a REDIS_URL (2026-08-16)
Solo cambio de **tests** (sin código de producción). El job `backend` del workflow **CI** levanta un
contenedor Redis y **exporta `REDIS_URL`**; dos suites afirmaban comportamiento "sin Redis" pero leían la
variable vía `ConfigService.get('REDIS_URL')`, que **cae a `process.env`**. Resultado en CI: **2 tests
fallaban / 348 pasaban** (verde en local/qa porque ahí no hay `REDIS_URL`).

- `test/health-redis.provider.spec.ts` — «sin REDIS_URL: resuelve a null y no crea cliente».
- `test/scheduler.spec.ts` — «sin REDIS_URL: onModuleInit es no-op» (el gating BE-5/v15-D1).

Fix: en el bloque `describe` que ejerce el caso "sin REDIS_URL" se guarda/borra `process.env.REDIS_URL` en
`beforeEach` y se restaura en `afterEach` (sin filtrar entre tests). Los casos "con REDIS_URL" ya construían
su propio `new ConfigService({ REDIS_URL: ... })` y no dependían de `process.env`, así que no cambian.
Producción intacta (`health-redis.provider.ts`, `scheduler.service.ts` sin tocar): el bug era del test, no del
gating. Verificado en **ambos** entornos: `REDIS_URL=redis://localhost:6379 npm test` y `npm test` →
**56 suites / 350 tests verdes** en los dos; `lint`, `typecheck`, `build` verdes. No aparecieron otras fugas
env-sensibles (las suites PII construyen su propio `ConfigService` con claves y ya pasaban en CI). Ver CI-1 en
`docs/TECH_DEBT.md`.

## 29. v1.9-set-chart (2026-08-16) — Gráfica PÚBLICA del valor de un set (hero de la home)

Gráfica estilo acciones del **valor de mercado agregado de un set destacado**, PÚBLICA (visitantes
anónimos), datos REALES con captura diaria. Reusa el patrón de `PortfolioSnapshot`/portfolio-history
pero **por set** y **sin PII**. Contrato: API_CONTRACT changelog v1.9-set-chart; ARCHITECTURE §3.2 /
§4.12 / §11 (M-20). **SEC-A1 intacto**: `totalValueMxnCents` se deriva SIEMPRE server-side de
`PriceReference` real; nunca del cliente. **Todo aditivo, una sola migración M-20 (sin backfill).**

### 29.1 Migración M-20 + modelo `SetValueSnapshot`
- Migración: `backend/prisma/migrations/20260816180000_m20_set_value_snapshot/` (crea tabla + FK
  `onDelete: Cascade` a `CardSet` + índice único + índice de rango). Aditiva, **sin backfill**: la
  serie arranca vacía y crece desde el primer día que corran los jobs.
- Modelo (`schema.prisma`): `SetValueSnapshot { id, setId (FK→CardSet, Cascade), asOfDate @db.Date,
  totalValueMxnCents Int, pricedCardCount Int, totalCardCount Int, createdAt, updatedAt,
  @@unique([setId, asOfDate]), @@index([setId, asOfDate]) }`. Relación inversa nueva en `CardSet`:
  `snapshots SetValueSnapshot[]` (solo relación Prisma, no añade columna a `CardSet`).
- Idempotente por día vía el `@@unique`: re-correr el job del día hace **upsert**, no duplica.

### 29.2 `SetValueService` (vive en `backend/src/modules/catalog/set-value.service.ts`)
Elegí `modules/catalog/` (es lectura de catálogo público, y ahí ya viven el `PokemonTcgIoClient` y el
sync). Firmas:
- `resolveFeaturedSet(): Promise<CardSet | null>` — cascada §4.12b: env `HOME_FEATURED_SET_ID` (id
  nativo pokemontcg.io → `CardSet` local por `externalId`) → set con mayor `totalValueMxnCents` en su
  último `SetValueSnapshot` → `CardSet` más reciente por `releaseDate` (desc; String `yyyy/MM/dd` →
  orden lexicográfico) → `createdAt` desc → `null`. La usan **tanto** el endpoint público **como** el
  job `set-price-sync` (env y gráfica no divergen).
- `computeSetValue(setId: string, asOf?: Date): Promise<{ totalValueMxnCents, pricedCardCount,
  totalCardCount }>` — SUM §4.12a con acabado/tipo/grado FIJOS (`finish='normal'`, `productType='raw'`,
  `gradeKey='raw:NM'`, campo `priceMxnCents`). Cartas sin precio se **excluyen** del total pero se
  cuentan en `totalCardCount`. **NO genera `PendingPriceEntry`** (agregación de mercado, no de bóveda).
- `valueHistory(setId, range): Promise<{ range, points: SetValuePointDTO[], change }>` — lee
  `SetValueSnapshot` del rango, arma `points` (asc por fecha, cada punto lleva `pricedCardCount`) +
  `change {absMxnCents, pct, direction}` (misma lógica que portfolio-history: `pct=null` si el valor
  inicial es 0; rango inválido cae a `1m`).
- Wrappers para los endpoints: `featuredSetHistory(range)` (resuelve el set; `set:null,points:[]` si no
  hay ningún `CardSet`) y `setHistoryById(id, range)` (404 `NOT_FOUND` si el id local no existe; `set`
  siempre resuelto, `points:[]` si aún no hay snapshots). `snapshotFeaturedSet()` para el job diario.

### 29.3 Cómo se evita el N+1 en `computeSetValue`
**2 queries fijas**, independientes del nº de cartas del set: (1) `card.findMany({ where:{setId},
select:{id} })`; (2) `priceReference.findMany({ where:{ cardId:{in:[...]}, productType:'raw',
gradeKey:'raw:NM', finish:'normal', capturedDate:{lte:asOf}? }, orderBy:{capturedDate:'desc'} })`. El
"vigente más reciente por carta" se resuelve **en memoria**: como viene ordenado `capturedDate desc`, la
**primera** fila vista por `cardId` es la más reciente (dedupe con un `Set`). Cero llamadas por-carta.

### 29.4 Jobs nuevos + crons cableados
- `SetPriceSyncJobService` (`backend/src/jobs/set-price-sync.service.ts`) — precia TODAS las cartas del
  set destacado: `Card WHERE setId=<featured>` **SIN** el filtro `InventoryItem` (cierra **DEV-3**).
  Reusa `PricingService.syncCardPrice(card,'raw','raw:NM','normal','catalog',undefined,false)` — host
  FIJO anti-SSRF, cache diario. El **7º parámetro nuevo `escalate=false`** evita encolar
  `PendingPriceEntry` por cada carta sin precio (§4.12a: no inundar la cola con todo el catálogo). Los
  demás llamadores de `syncCardPrice` quedan con el default `escalate=true` (comportamiento intacto).
- `SetValueSnapshotJobService` (`backend/src/jobs/set-value-snapshot.service.ts`) — delega en
  `SetValueService.snapshotFeaturedSet()`: `computeSetValue(featured, today)` + **upsert** idempotente
  por `(setId, asOfDate)`.
- Ambos servicios se **proveen y exportan desde `CatalogModule`** (dependen de `SetValueService`/
  `PricingService`; se evita el ciclo con `JobsModule`, mismo patrón que `portfolio-snapshot` en
  `VaultModule`). `JobsModule` ahora importa `CatalogModule`.
- Scheduler (`scheduler.service.ts`, gated por `REDIS_URL`, single-flight por `jobId`): **`set-price-sync
  '30 6 * * *'`** y **`set-value-snapshot '15 7 * * *'`**. Orden duro **FX (`0 6`) → set-price-sync
  (`30 6`) → portfolio (`0 7`) → set-value-snapshot (`15 7`)**.

### 29.5 Endpoints públicos (`@Public()`) — `catalog.controller.ts`
- `GET /api/v1/catalog/featured-set/value-history?range=` → `SetValueHistoryResponse`. Set destacado
  resuelto server-side (el front NO hardcodea id). Sin `CardSet` → `set:null, points:[], change flat`.
- `GET /api/v1/catalog/sets/:id/value-history?range=` → igual, por id **local** del `CardSet`; `404` si
  no existe; sin snapshots → `points:[]` con `set` resuelto.
- `range` default `1m`; conjunto `5d|15d|1m|3m|6m|1y|ytd|all` (inválido cae a `1m`).

### 29.6 Disparos manuales admin (super_admin, auditados) — `admin-jobs.controller.ts`
`POST /api/v1/admin/jobs/set-price-sync` y `POST /api/v1/admin/jobs/set-value-snapshot`, para **sembrar
el primer punto sin esperar al cron**. Auditados como `jobs.set_price_sync.run` /
`jobs.set_value_snapshot.run` (`entityType='Job'`), taxonomía uniforme con los demás disparos.

### 29.7 Semilla histórica — qué hice (honesto, sin fabricar)
**NO se hizo backfill.** pokemontcg.io solo entrega el precio de **HOY** (TCGPlayer `market`), sin
historial; y las cartas del set fuera de bóveda no tienen `PriceReference` de fechas previas. No existe
una fuente pública **legítima y fiable** de histórico real de precios integrable en el MVP sin costo. Por
tanto la serie **arranca hoy** (primer `set-value-snapshot`, sembrable a mano por el disparo admin) y
**crece a diario**. Se respeta "NUNCA fabriques puntos ni simules mercado": un día sin snapshot no tiene
punto; el campo `estimated?` del DTO queda reservado y sin uso.

### 29.8 Env para **devops** (NO edité `.env.example` — lo lleva devops)
- `HOME_FEATURED_SET_ID` (opcional): id **nativo pokemontcg.io** del set destacado (ej. `sv8`). Si no se
  setea o no resuelve a un `CardSet` local, aplica el **fallback determinista** (§29.2) — el feature no
  se bloquea sin la env. Recomendado: un set Scarlet & Violet reciente y líquido. Reutiliza el
  `POKEMONTCG_IO_API_KEY` existente para el rate-limit del free tier.

### 29.9 Tests + gates (desde `backend/`)
- `test/set-value.spec.ts` (**NUEVO**): `computeSetValue` (excluye sin-precio, cuenta priced/total,
  dedupe del más reciente por carta, **2 queries = sin N+1**, cota `capturedDate<=asOf`, set vacío);
  `resolveFeaturedSet` (los 4 escalones de la cascada + env que no resuelve); `valueHistory` (vacío→flat,
  ascendente→up con pct, valor inicial 0→pct null, rango inválido→1m); endpoints `featuredSetHistory`/
  `setHistoryById` (con/sin snapshots, `set:null`, `404`); jobs `set-value-snapshot` (upsert idempotente)
  y `set-price-sync` (recorre por `setId` **sin InventoryItem** + `escalate=false`).
- Actualizados: `test/scheduler.spec.ts` (ahora **9 crons**, verifica `30 6`/`15 7` y el ruteo del
  worker) y `test/admin-jobs.controller.spec.ts` (2 disparos nuevos auditados).
- Resultado: **`lint`, `typecheck`, `build` verdes**; **57 suites / 371 tests verdes** (`npx jest`).
  Antes del cambio: 56 suites / ~350 tests. `prisma validate` OK (con `DATABASE_URL` dummy).

### 29.10 Cierre post-veredicto (2026-08-16) — 2 fixes baratos + deuda registrada
Feature ya aprobada por **qa + techlead + seguridad**. En el cierre se aplicaron los DOS fixes baratos que
los revisores recomendaron y se registró la deuda no bloqueante (`docs/TECH_DEBT.md` → sección v1.9-set-chart).

- **SEC-F1 (seguridad) — throttle propio en los 2 endpoints públicos de la gráfica.**
  `catalog.controller.ts`: `GET /catalog/featured-set/value-history` y `GET /catalog/sets/:id/value-history`
  ahora llevan `@Throttle({ default: { ttl: 60_000, limit: 60 } })` (**60/min por IP**), en PARIDAD con
  `BuylistCatalogController` (mismo import/patrón). Antes colgaban solo del global (300/min). Sin config nueva.
- **TD-2 (techlead) — índice redundante eliminado en M-20.** `SetValueSnapshot` tenía
  `@@unique([setId, asOfDate])` **y** `@@index([setId, asOfDate])` (mismas columnas/orden). El `@@index` era
  redundante (el índice del `@@unique` ya sirve el rango de la gráfica). Se quitó del `schema.prisma` **y** del
  `prisma/migrations/20260816180000_m20_set_value_snapshot/migration.sql` (edición **en sitio**: M-20 no se ha
  aplicado en ningún entorno). `prisma validate` OK; schema y migración coherentes (índice fuera en ambos).
- **TD-1 (parcial) — `SET_VALUE_RULE` compartido.** Se extrajo la constante `SET_VALUE_RULE`
  (`{ productType:'raw', gradeKey:'raw:NM', finish:'normal' }`) a `set-value.service.ts`, reusada por
  `computeSetValue` (lectura/agregación) **y** el job `set-price-sync` (escritura de la PriceReference del día).
  Antes los 3 literales estaban duplicados en ambos archivos → riesgo de que escritura y lectura divergieran.
  **Queda como deuda** unificar la *lógica* "más reciente por capturedDate" con `PricingService.getReference`
  vía un batch compartido (dirección RB-8/BE-4/D3, diferido por escala). Tests de `set-value.spec.ts` ahora
  referencian `SET_VALUE_RULE` (single source verificado en `computeSetValue` y `set-price-sync`).
- Deudas restantes registradas: **TD-3** (cargas en memoria en fallback-2/`computeSetValue`; el request
  público NO invoca `computeSetValue`), **SEC-F2** (`:id` sin validación de formato; sin impacto, Prisma
  parametriza + 404) y **QA-min** (fallback-3 ordena `releaseDate` como String, correcto para `yyyy/MM/dd`).
- Gates del cierre: **`lint`, `typecheck`, `build` verdes**; **57 suites / 371 tests verdes**.

### 30. Endurecimiento cripto GCM en PII (2026-08-16) — gate SAST
Hallazgo REAL del gate SAST (semgrep `javascript.node-crypto.security.gcm-no-tag-length`, registry `p/*`) en
`src/common/crypto/pii-crypto.service.ts` → `decrypt()`. Es defensa en profundidad sobre PII (CLABE/RFC/INE).

- **Problema:** `createDecipheriv('aes-256-gcm', key, iv)` + `setAuthTag(tag)` **sin** `authTagLength`.
  Node acepta authTags GCM **más cortos** de 16 bytes; un atacante con capacidad de manipular el ciphertext
  almacenado (`v1:iv:tag:ct` en BD) podría presentar un **tag truncado** y debilitar la autenticidad GCM
  (riesgo de forja).
- **Fix (endurecimiento interno, retrocompatible):**
  - `decrypt()`: valida `tag.length === 16` **ANTES** de `setAuthTag`; si no, lanza el mensaje **genérico**
    `Malformed PII ciphertext` (idéntico al de payload mal formado → **sin oráculo** que distinga el motivo).
    Luego `createDecipheriv('aes-256-gcm', encKey, iv, { authTagLength: 16 })`.
  - `encrypt()`: `createCipheriv('aes-256-gcm', encKey, iv, { authTagLength: 16 })` explícito por
    simetría/robustez (`getAuthTag()` ya devolvía 16 bytes).
  - Nueva constante `TAG_BYTES = 16`.
- **Por qué es retrocompatible:** NO cambia el formato serializado `v1:iv:tag:ct` ni las claves. Todo authTag
  que produjo `encrypt()` (`cipher.getAuthTag()`) es de 16 bytes, así que los datos ya cifrados en BD descifran
  igual. Es puramente un endurecimiento de la ruta de verificación.
- **Tests** (`test/pii-crypto.spec.ts`): (a) round-trip `decrypt(encrypt(x)) === x` sigue OK; (b) test nuevo
  «rechaza un authTag GCM truncado (longitud != 16)»: verifica que el tag legítimo mide 16 bytes, y que un tag
  de **12 bytes** (truncado), **vacío** y **20 bytes** (sobredimensionado) son RECHAZADOS con el mensaje
  genérico; (c) el test de manipulación de ciphertext/formato sigue lanzando.
- **Gates:** `lint`, `typecheck`, `build` verdes; **57 suites / 372 tests verdes** (`npm test`). Antes: 371.
- **Estado:** pendiente de **veredicto de seguridad + qa** por tocar PII/cripto. Cerrado en `TECH_DEBT.md`
  → SAST-1.

## 30. Gate SAST (trivy-image) — bump supply-chain node-tar / tmp (2026-08-16)

> `trivy-image` (SAST de imagen del backend, ya funcionando) reportó CVEs HIGH/CRITICAL reales en
> dependencias transitivas de la imagen. Se remedian con `overrides` en `backend/package.json`. Cerrado en
> `TECH_DEBT.md` → **SAST-2**. Solo cambios de dependencias; código de la app intacto.

### 30.1 Origen de los hallazgos (árbol `npm ls`)
- **`tmp`** (CVE-2026-44705, path traversal por prefix/postfix; fixed **>= 0.2.6**): **devDependency**
  transitiva del CLI de Nest. Árbol:
  `@nestjs/cli@10.4.9 → inquirer@8.2.6 → external-editor@3.1.0 → tmp@0.0.33`. Estaba en `0.0.33`
  (vulnerable). Marcado `"dev": true` en el lockfile.
- **`tar` (node-tar)** (CVE-2026-26960 / -29786 / -31802 / -59874, hardlink path traversal + DoS; fixed
  **>= 7.5.18**): **NO está presente** en el árbol de dependencias del backend. `npm ls tar` → `(empty)`,
  no existe ningún `node_modules/**/tar` ni en el lockfile ni instalado. Prisma 5.x (`@prisma/fetch-engine`)
  **descarga sus binarios de engine directamente** (gzip), no vía node-tar; ningún otro paquete del árbol lo
  requiere. El override queda igualmente aplicado como **pin defensivo**: si una futura resolución transitiva
  reintrodujera `tar`, quedará forzado a `>= 7.5.18`. (Si trivy vuelve a marcar `tar`, probablemente escaneó
  una imagen construida con un lockfile anterior; la imagen se construye con `npm ci` desde este lockfile, que
  ya **no** contiene `tar`.)

### 30.2 Overrides aplicados y resolución (`npm ls`)
En `backend/package.json` → `overrides` (se suman a los ya existentes de SEC-C2):
```json
"tar": ">=7.5.18",
"tmp": ">=0.2.6"
```
Tras `npm install` + `npm ci --include=dev` (lockfile regenerado, 788 paquetes auditados):
- `tmp` → **0.2.7** `overridden` (satisface el `^0.0.33` de `external-editor`; el override cascadea sin romper
  el peer). Efecto colateral limpio: se elimina la sub-dep transitiva `os-tmpdir@1.0.2` (tmp 0.2.x ya no la usa).
  `npm ls tmp`: `... external-editor@3.1.0 → tmp@0.2.7 overridden`.
- `tar` → `(empty)` (no presente; el override no fuerza una instalación, solo pinnea si aparece).

### 30.3 ¿devDependency en la imagen de runtime? (nota para devops)
- **`tmp` es devDependency** (vía `@nestjs/cli`). **Igual viaja en la imagen** porque `Dockerfile.backend`
  hace `npm ci --include=dev` **y NO poda** (`no npm prune --omit=dev`) — decisión de devops documentada en el
  propio Dockerfile (etapa build) y `DEVOPS_NOTES §6`: se conservan `prisma`/`ts-node`/`typescript` para
  `prisma migrate deploy` + seed en runtime, arrastrando todo el árbol dev (incl. `@nestjs/cli` → `tmp`). Por
  eso el override es la remediación correcta (parchea aunque sea devDep). **Sugerencia opcional a devops**
  (no requerida para cerrar el gate): un `prune`/multi-stage que excluya `@nestjs/cli` del runtime reduciría
  superficie, pero el override ya deja `tmp` en versión parcheada de todas formas.

### 30.4 Gates (verde)
- `prisma generate` OK · `lint` OK · `typecheck` OK · `build` (`nest build`) OK.
- `npm test` = **57 suites / 372 tests verdes** (sin cambio de conteo; solo bump de deps, sin tocar código).
- `npm ci --include=dev` limpio desde el lockfile regenerado; `tmp` resuelve a **0.2.7** en instalación limpia.

## 31. Fix E2E-1 — seed E2E idempotente + fin de la doble siembra (2026-08-16)

> El gate **backend-e2e** (`npm run test:integration`) fallaba. Solo se tocó `backend/prisma/seed-e2e.ts` y
> `backend/package.json`. Cerrado en `TECH_DEBT.md` → **E2E-1**. Ningún endpoint ni lógica de negocio tocada.

### 31.1 Síntoma y diagnóstico
Postgres del runner registraba, **durante** el `jest`:
```
ERROR: duplicate key ... "ProcessedStripeEvent_pkey" — (id)=(evt_e2e_succeeded_fixed) already exists.
ERROR: duplicate key ... "User_email_key" — (email)=(customer@e2e.local) already exists.
```
Investigación (`seed-e2e.ts`, `jest-integration.config.js`, los 5 `*.e2e-spec.ts`, `payments.service.ts`,
`auth.service.ts`):
- **No hay `globalSetup`** en `jest-integration.config.js` (solo `setupFilesAfterEnv: setup.ts`, que NO
  siembra). La "doble siembra" era: `test:integration` corría `seed:synthetic` **standalone** ANTES de `jest`
  **y** cada uno de los 5 specs vuelve a llamar `seedE2E()` en `beforeAll` → 6 siembras/corrida.
- Los DOS `ERROR` de Postgres citados son, en una corrida única, **P2002 capturados por diseño** (no el
  fallo): `auth.service.ts:111` (test "rechaza email duplicado" → 409 `EMAIL_TAKEN`) y `payments.service.ts:44`
  (guard de idempotencia atómica del webhook, test "es IDEMPOTENTE: reenviar el mismo event.id"). Postgres
  loguea el `ERROR` aunque la app lo capture.
- **Fallo real = idempotencia CROSS-RUN.** `seedE2E` reseteaba estado transaccional **por userId**
  (orders/shipments/sellRequests/disputes/kyc) pero **NO** `ProcessedStripeEvent` ni `InventoryMovement` de
  piezas de **plataforma** (que no cuelgan de userId). En una **2ª corrida** sobre la misma DB:
  `evt_e2e_succeeded_fixed` persistía → el webhook hacía no-op → la orden no liquidaba (falla "el webhook
  FIRMADO liquida la orden"); y los `InventoryMovement reason=settle` previos hacían que
  `expect(settleMovements).toBe(1)` contara 2+.

### 31.2 Fix
1. **Fin de la doble siembra (lo más limpio):** `package.json` → `test:integration` pasa de
   `prisma migrate deploy && npm run seed:synthetic && jest ...` a `prisma migrate deploy && jest ...`. La
   siembra queda como **única fuente** en el `beforeAll` de cada spec (aislamiento por-spec necesario porque
   las suites mutan estado). El script `seed:synthetic` (= `ts-node prisma/seed-e2e.ts`) **se conserva** —lo
   usan `scripts/seed-synthetic.sh` y CI de staging.
2. **`seedE2E` idempotente cross-run (defensa):** nuevo paso **3b** que borra, además del reset por-usuario:
   - `InventoryMovement` de los ítems E2E (`where itemId IN (items con folio IN E2E_FOLIOS)`);
   - `ProcessedStripeEvent` (`id = evt_e2e_succeeded_fixed` **OR** `id startsWith 'evt_e2e'`, que cubre los
     `evt_e2e_<uuid>` aleatorios que genera el harness `sendStripeWebhook`).
   El resto del seed ya era idempotente: **todos** los fixtures con clave única usan `upsert` (ConfigSetting,
   User `by email`, VaultLocation, CardSet, Card, PriceReference, InventoryItem `by folio`) y `Address` va con
   guard `findFirst`. Revisado el seed completo, no solo los dos fixtures del log.

Resultado: `test:integration` corrido **dos veces seguidas** sobre la misma DB no rompe (idempotencia real).

### 31.3 Gates (verde)
- `lint` OK · `typecheck` OK · `build` (`nest build`) OK.
- `npm test` = **57 suites / 372 tests verdes** (unit, sin infra; sin cambio de conteo).
- **No** pude correr `test:integration` en local (egress bloquea el pull de imágenes Docker de Postgres/Redis/
  MinIO). El **verde de E2E lo confirma el runner de CI**.

## 32. Tier 0 — Operación por acabado: escalado de pendientes con `finish` + cola con carta (2026-08-17)

> Dos arreglos chicos que habilitan la operación por acabado (M-19/Ronda C) end-to-end en M1/M2.
> Rama `claude/git-repo-review-c67xyk`. Sin migraciones (el modelo ya tenía `finish` desde M-19).

### 32.1 Alta de inventario escala el pendiente CON el `finish` del alta (bug real)
- **Bug:** en `inventory.service.ts#createItem` las DOS llamadas a `escalatePending(...)` (aportación en
  especie sin referencia, y sellado sin precio manual) omitían el 6º argumento `finish` → por el default
  de la firma el pendiente se encolaba como `normal` aunque el alta fuera `holofoil`. Consecuencia: el
  override del admin "resolvía" el acabado equivocado y la valuación por versión (M2) quedaba rota.
- **Fix:** ambas llamadas pasan ahora el `finish` ya resuelto por `resolveFinish` (que valida contra
  `Card.availableFinishes`, SEC-A1). Para sealed `resolveFinish` devuelve `normal` siempre, así que ese
  camino no cambia de comportamiento, solo queda explícito y en paridad de firma con `syncCardPrice`.
  La firma de `PricingService.escalatePending(cardId, productType, gradeKey, context, refId?, finish)` ya
  aceptaba `finish` (Ronda C) — no hubo que tocarla.

### 32.2 `pendingQueue()` incluye la carta → `GET /admin/pricing/pending` con `cardName` + `finish`
- **Bug:** el `findMany` de `pricing.service.ts#pendingQueue` no hacía `include: { card }` → el DTO
  llegaba sin nombre de carta y el frontend M2 pintaba el UUID.
- **Fix + shape final por entrada** (aditivo sobre `PendingPriceEntry` del contrato §11; el front consume
  el `cardName` plano opcional que ya tenía tipado):
  ```json
  { "id": "...", "cardId": "...", "productType": "raw", "gradeKey": "raw:NM",
    "finish": "holofoil", "context": "inventory", "refId": null, "status": "open",
    "resolvedPriceRefId": null, "createdAt": "...", "resolvedAt": null,
    "cardName": "Zapdos",
    "card": { "id": "...", "name": "Zapdos", "number": "16", "setName": "Fossil" } }
  ```
  `finish` viene del modelo (M-19) y se propaga tal cual; `cardName` es conveniencia plana y `card`
  trae name+number+setName (proyección, no la relación Prisma cruda).

### 32.3 Override por acabado — confirmado, sin cambios
`POST /admin/pricing/override` **ya** acepta `finish?` (Ronda C): `OverrideDto` lo valida con `@IsIn`,
el controller pasa `dto.finish ?? 'normal'` y `manualOverride` upserta la `PriceReference` de ese acabado
y resuelve **solo** el `PendingPriceEntry` de ese `(cardId, productType, gradeKey, finish)`. La respuesta
es el `PriceReference` completo (incluye `finish`). Auditado con `finish` en `after`.

### 32.4 Tests y gates (verde)
- Nuevo `test/inventory.finish-pending.spec.ts`: aportación holofoil sin referencia → `PRICE_PENDING` y
  encola con `finish='holofoil'` (y consulta la referencia de ESE acabado); con referencia → no escala,
  persiste el finish y calcula costo 70%; finish fuera de `availableFinishes` → `FINISH_NOT_AVAILABLE`.
- `test/pricing.finish-pending.spec.ts` ampliado: `pendingQueue` hace el `include` de card+set y cada
  entrada expone `cardName`, `card{name,number,setName}` y `finish`.
- `test/inventory.sealed.spec.ts` ajustado a la nueva llamada (`..., 'inventory', undefined, 'normal'`).
- Gates: `lint` OK · `typecheck` OK · `build` OK · `npm test` = **58 suites / 377 tests verdes**.

## 33. Fase 0 del epic de precios (commit ebb4dee, 2026-08-17) — gate premium + encolado honesto + INE con pendiente

> Fase 0 del epic de precios, con **triple veredicto APROBADO** (qa + techlead APROBADO-con-deuda +
> seguridad APROBADO). Cierra el bug estructural de dinero por el que una rareza chase podía cotizar al bin
> fijo barato de bulk, hace real la promesa del copy del cotizador público, y sella el gating de INE cuando
> la solicitud lleva líneas pendientes. Remite al contrato **§4.2.1** (semántica holofoil por rareza) y
> **§6** (reglas de buylist). La deuda **no bloqueante** del delta quedó registrada como **BE-13..BE-19** en
> `docs/TECH_DEBT.md` (ver disparadores; BE-13 pide ticket antes de operar con dinero real).

### 33.1 (Fase 0.1) Gate premium — `isPremiumRarity` + `ruleKeyCandidates` (`common/money.ts`)
- **Regla de negocio (humano):** SOLO Common/Uncommon y el "holo/reverse común" son precio **FIJO** de bulk;
  todo lo más raro es un **% arriba del mercado**. Una rareza **premium (chase)** por tanto **NUNCA** debe
  poder caer al bin fijo barato de bulk.
- **`isPremiumRarity(rarity)`**: `true` si la rareza matchea `PREMIUM_RARITY_PATTERNS` (allowlist de
  substrings/tokens case-insensitive: Illustration/Ultra/Double/Secret/Rainbow/Hyper/Full Art/Alt Art/
  Amazing/Radiant/Shiny/Trainer Gallery/Character/Gold/Prism + token suelto `\b(v|vmax|vstar|vunion|ex|gx)\b`).
  Diseñado para **sobre-incluir** a propósito: una carta barata mal clasificada como premium solo pasa a "%
  de mercado" (**costo acotado**), mientras que sub-incluir una chase = tratarla como bulk = **pérdida de
  dinero** (el fallo que se estaba cerrando).
- **`ruleKeyCandidates(rarity, finish)`** devuelve los candidatos de `ruleKey` en orden de prioridad (gana el
  primero con regla explícita; si ninguno → fallback pct). Fix central: la **rareza real va SIEMPRE primero**,
  y para `holofoil`/`first_edition_holofoil` una rareza **premium** retorna `[rarity]` (su propia regla o el
  fallback pct, **nunca** la clave sintética `'Holo'` que el admin puede tener fija barata). No-premium
  preserva la semántica de ARCHITECTURE §4.2.1: holo de bulk → `[rarity, 'Holo']`; Common/Uncommon holofoil →
  `['Holo']` (% del market holofoil). Antes, una holo premium sin "holo" en el string (Illustration/Ultra/
  Double Rare) resolvía a `['Holo']` y una chase de miles de pesos cotizaba al bin fijo barato — bug
  estructural, ya cerrado.
- **Deuda anotada del gate:** la allowlist es finita (**BE-14**: chase antiguas — Rare Shining/Prime/LEGEND/
  BREAK/ACE — se escapan → subcotización, nunca money-out excesivo) y la rama `reverse_holo` no pasa por el
  gate (**BE-18**, asimetría probablemente inocua). Falta test unitario directo del gate (**BE-17**) y hay un
  comentario cosmético a corregir ("inocuo" → "costo acotado", **BE-19**).

### 33.2 (Fase 0.2) `publicQuote` encola el pendiente de forma honesta (`buylist.service.ts`)
- El copy del cotizador público promete que un acabado en `precio_pendiente` "entrará a la cola de precio
  pendiente". Igual que `createRequest`, `publicQuote` ahora llama
  `pricing.escalatePending(cardId, productType, gradeKey, 'buylist', undefined, finish)` para cada acabado
  cotizado como pendiente, de modo que la promesa sea real y el trabajo de fijar precio llegue al admin.
- **SEC-A1 intacto:** rareza y montos se siguen derivando **server-side**; esto solo escala el trabajo de
  precio. El dedup de `escalatePending` (`findFirst status='open'` + `create`) hace el llamado **idempotente**
  en el caso normal.
- **Deuda anotada:** el encolado ocurre desde un endpoint **público/anónimo** (**BE-16**, hallazgo QA aceptado
  por seguridad — un anónimo puede poblar la cola enumerando cartas existentes; acotado por throttle 300/min y
  dedup best-effort; **la Fase 1 on-demand lo supersede**), y el dedup **no es atómico** (**BE-15**: sin
  `@@unique` en `PendingPriceEntry` → filas duplicadas bajo concurrencia; el fix toca `schema.prisma` →
  coordinar con arquitecto).

### 33.3 (Fase 0.3) INE exigida con línea en precio pendiente
- Cuando una solicitud de buylist incluye cualquier línea en `precio_pendiente`, se mantiene la exigencia de
  **INE en archivo** (además del umbral por monto). Es una de las capas que **compensan** la deuda AML **BE-13**
  (el mensual `monthUsedCentsTx` agrega `quotedTotalCents`, no `approvedTotalCents`, y un ítem que nació
  pendiente no se re-contabiliza contra el tope mensual al resolverse su precio). Las otras capas: cap
  por-solicitud en `assertApprovedPriceWithinCap` y money-out solo `super_admin` + auditado. Ver contrato §6.

## 34. Fase 1 del epic de precios (v1.12-catalog-pricing, 2026-08-17) — preciar TODO el catálogo + refresco 2×/día

> Implementa ARCHITECTURE **§4.13a/b/c** (Fase 1). **Aditivo, SIN migración de esquema** (reusa
> `PriceReference`, que ya lleva `finish` en su clave desde M-18). Decisión del humano confirmada: refresco de
> **todo el catálogo 2×/día** a las **06:00 y 18:00 CDMX** = **00:00 y 12:00 UTC**. Gates: `tsc --noEmit` exit 0,
> `jest` 60 suites / 397 tests en verde. Toca dinero → requiere triple veredicto (qa + techlead + seguridad).

### 34.1 (1.1) `catalog-sync` puebla `PriceReference` de todo el catálogo — sin llamadas extra
- **`CatalogSyncService` gana dos dependencias:** `PricingService` (upsert de la referencia) y `FxService`
  (tasa del día). `CatalogModule` ya importaba `PricingModule`, que exporta ambas → sin cambios de wiring de
  módulos salvo el registro del job (§34.3).
- **`upsertCards` ahora persiste precio por acabado:** por cada carta upserteada, `persistMarketReferences`
  recorre `card.availableFinishes` y, por cada `finish` con `tcgplayer.prices[FINISH_TO_TCG_KEY[finish]].market
  > 0`, llama `PricingService.persistMarketReference(cardId, finish, round(market×100), fx)`. Es el **mismo
  payload** que ya se descargaba para derivar `availableFinishes` → **cero requests extra** a pokemontcg.io.
- **`PricingService.persistMarketReference(cardId, finish, marketUsdCents, fx)` (NUEVO):** upsert idempotente
  por día sobre la clave única existente `(cardId, 'raw', 'raw:NM', finish, capturedDate=hoy)`. `priceUsdCents =
  marketUsdCents`, `priceMxnCents = usdToMxnCents(marketUsdCents, fx.rate, fx.bufferPct)`, `source='pokemontcg_io'`,
  `isManualOverride=false`. **NO pisa overrides del admin:** hace `findUnique` de la fila de hoy y, si existe con
  `isManualOverride=true`, hace **skip** (el override manda, §4.1). La 2ª pasada del día (18:00) **refina** el
  precio de hoy (update sobre la misma fila), no duplica.
- **FX una sola vez por corrida (no por carta):** cada punto de entrada del sync carga `FxService.getCurrent()`
  UNA vez y pasa el snapshot `{ rate, bufferPct }` por toda la cadena hasta `upsertCards`. Puntos de entrada
  instrumentados: `sync` (single y from_date), `runSyncAll` (barrido de `sync-all`; NO en `syncAll`, que sólo
  encola y delega en `runSyncAll` fire-and-forget → el FX se carga dentro del barrido real) y `backfill`. Las
  helpers privadas (`importSet`/`importSetByExternalId`/`importCardsForSet`/`importRemainingPages`/`upsertCards`)
  reciben `fx: FxSnapshot` como parámetro.
- **Cartas SIN market → ni referencia ni pendiente:** `escalate=false` de facto — este flujo **nunca** encola
  `PendingPriceEntry` (mismo criterio que `set-price-sync`, §4.12a; escalar decenas de miles de cartas del
  catálogo sería ruido). Una carta sin market simplemente no tiene referencia hasta que (i) el admin la fija a
  mano o (ii) entra a un contexto real (bóveda/buylist) donde los flujos existentes SÍ escalan.
- **Aislamiento de fallos:** si `persistMarketReference` truena para un acabado, se loguea y se continúa; la
  carta ya quedó upserteada (el precio no aborta la importación).

### 34.2 (1.2) `publicQuote` vuelve a READ-ONLY — cierra BE-16
- Se **eliminó** la llamada a `pricing.escalatePending` del cotizador público (`BuylistService.publicQuote`).
  Un endpoint público/anónimo dejaba de escribir en la cola de trabajo del dueño (superficie de abuso:
  enumerar cartas inflaba la cola). Con el catálogo ya priceado por 1.1, el `getReference` del quote casi
  siempre encuentra precio; si un acabado sigue `precio_pendiente`, el quote **lo reporta** sin escribir nada.
- La escalada a `PendingPriceEntry` queda **SOLO** en el flujo autenticado `createRequest`
  (`POST /buylist/requests`), sin cambio.
- **Test actualizado:** en `test/buylist.modern-rarity.spec.ts` el bloque de Fase 0.2 (que verificaba el
  encolado desde el quote) ahora verifica que `publicQuote` **NO** llama `escalatePending` (ni con pendiente ni
  con cotizada).

### 34.3 (1.3) Job `catalog-price-sync` 2×/día
- **`CatalogPriceSyncJobService` (`backend/src/jobs/catalog-price-sync.service.ts`, NUEVO):** su `run()` ejecuta
  `CatalogSyncService.syncAll({ force: true })` — re-sync completo que reprocesa TODOS los sets remotos
  (`upsertCards` repuebla cartas + `availableFinishes` + `PriceReference` por acabado con el FX del día) e
  **importa sets nuevos** en la misma pasada (procesa los sets que aún no existían localmente). Secuencial
  (respeta el backoff 429 del cliente), **single-flight** garantizado por `syncAllStatus.running` dentro de
  `syncAll`, idempotente.
- **Registro (evita ciclos con JobsModule):** el job vive en `CatalogModule` (providers + exports), mismo patrón
  que `set-price-sync`, porque depende de `CatalogSyncService`. `JobsModule` ya importa `CatalogModule`, así que
  `SchedulerService` y `AdminJobsController` lo inyectan desde ahí.
- **Scheduler — DOS repeatables:** en `scheduler.service.ts` se añaden `catalog-price-sync-1` y
  `catalog-price-sync-2`, ambos enrutados al mismo `catalogPriceSync.run()` en el worker. Crons tomados de env
  con defaults `0 0 * * *` (00:00 UTC = 18:00 CDMX del día anterior… ver nota) y `0 12 * * *` (12:00 UTC = 06:00
  CDMX):
  - **Env:** `CATALOG_PRICE_SYNC_CRON_1` (default `0 0 * * *`) y `CATALOG_PRICE_SYNC_CRON_2` (default
    `0 12 * * *`). Devops puede ajustar ambos horarios **sin redeploy**. Crons en **UTC** (CDMX = UTC−6 sin DST).
    Para **devops**: conviene un `fx-refresh` poco antes de la corrida de las 00:00 UTC (el `fx-refresh 0 6 UTC`
    existente cubre la de las 12:00 UTC) si se quiere FX del mismo día; `FxService.getCurrent()` degrada al último
    `FxRate` disponible, así que el orden es suave, no bloqueante.
- **Disparo manual (opcional, implementado):** `POST /admin/jobs/catalog-price-sync` (super_admin, auditado
  `jobs.catalog_price_sync.run`) en `AdminJobsController`, simetría con los demás disparos manuales de jobs. Es
  alias operativo del job; también sigue disponible `POST /admin/catalog/sync-all {force:true}`.

### 34.4 Tests nuevos
- `test/catalog-price-sync.spec.ts` (NUEVO): (a) `catalog-sync` persiste un `PriceReference` por acabado desde
  `tcgplayer.prices` y carga FX una sola vez por corrida; (c) carta sin market (sin `tcgplayer.prices` o con
  todos `market<=0`) → `persistMarketReference` NO se llama; (b) `persistMarketReference` escribe la referencia
  MXN (`usdToMxnCents`) y **respeta `isManualOverride=true`** (skip del upsert); (d) el job invoca
  `syncAll({force:true})`.
- Specs existentes ajustados al nuevo constructor de `CatalogSyncService` (+`PricingService`+`FxService`) y a los
  nuevos deps de `SchedulerService`/`AdminJobsController`: `catalog-sync.spec.ts`, `catalog-sync.finish.spec.ts`,
  `catalog.remote-sets-fallback.spec.ts`, `scheduler.spec.ts`, `admin-jobs.controller.spec.ts`.

### 34.5 Para devops / notas
- **Env nuevas (documentar en `.env.example`, propiedad devops):** `CATALOG_PRICE_SYNC_CRON_1`,
  `CATALOG_PRICE_SYNC_CRON_2` (defaults arriba). **`POKEMONTCG_IO_API_KEY` pasa a requisito operativo:** el
  re-sync 2×/día son ~cientos de requests por corrida; sin API key el free tier puede toparse (riesgo §8/§10 del
  ARCHITECTURE).
- **Sin cambios de contrato ni de `schema.prisma`.** Todo reusa modelos/claves existentes.

## 35. Fase 2 del epic de precios (v1.13-sales-pricing, 2026-08-17) — precio de VENTA por RAREZA, editable en admin

Reemplaza el **markup GLOBAL único** de venta (`SALES_MARKUP_PCT`, default 15) por una **tabla de regla por
rareza** editable en M2 sin redeploy, **simétrica** a la de buylist (§4.2/§4.2.1). Ejemplo del humano: Common $5,
Uncommon/Holo/Reverse $10 **fijos**; lo más raro = **% ARRIBA de mercado**. **Aditivo, SIN migración** (el precio
de venta ya se congela en `OrderItem.unitPriceCents` al checkout). Fuente: ARCHITECTURE §4.14, API_CONTRACT §M2.
Solo `backend/`; el editor M2 (frontend) es tarea aparte.

### 35.1 Config (diales M2) — `backend/src/modules/settings/settings.constants.ts`
- Dos `SettingKey` nuevos: `SALES_PRICE_RULES` (`sales_price_rules`), `SALES_PRICE_FALLBACK_PCT`
  (`sales_price_fallback_pct`).
- **Seed** (`SETTING_DEFAULTS`, reproduce el ejemplo del humano): `Common fixed 500¢`, `Uncommon fixed 1000¢`,
  `Holo fixed 1000¢`, `Reverse Holo fixed 1000¢`; **fallback = 15**. El 15 iguala el `SALES_MARKUP_PCT` legacy →
  toda rareza que caiga al fallback **preserva** el precio de venta actual (market × 1.15); solo cambia el piso de
  bulk. Se siembran solos (el seed itera `SETTING_DEFAULTS`), y `getRaw`/`getNumber` caen al default si no hay fila.
- **Validadores** `validateSalesRules` / `validateSalesFallbackPct` (+ `isValidSalesRule`, `SALES_PCT_MAX=1000`):
  clones de los de buylist con **una sola diferencia** — el `pct` de venta admite **`[0, 1000]`** (markup arriba de
  mercado, puede >100%: una chase se lista a 2×–3× market), vs. `[0,100]` en buylist. Registrados en
  `SETTING_VALIDATORS`. **NO** en `SETTING_DTO_MAP` (se editan por endpoints M2 dedicados, como buylist; `PUT
  /admin/settings` no los toca).

### 35.2 Función pura — `backend/src/common/money.ts`
- `computeSalePriceForRarity(rarity, finish, referenceMxnCents, rules, fallbackPct): SalePriceResult`.
  **Reusa `ruleKeyCandidates`** → hereda el **gate premium de Fase 0** (una chase en holofoil/1st-ed holo NUNCA cae
  al piso sintético `"Holo"` de bulk: resuelve por su regla o el fallback pct).
- **Semántica de venta (DIVERGE de compra):** `fixed` → `value` (centavos, **piso**; NO depende de market → siempre
  `priced`); `pct` → **% ARRIBA de mercado** = `round(ref × (1 + value/100))`. En **buylist** `pct = ref × value/100`
  (% de la referencia). Mismo shape `{mode,value}`, matemática del pct distinta. `pct` sin referencia → `pending`
  (sin precio), igual que el `computeSalePrice` legacy. La divergencia está documentada en el JSDoc de la función.
- `computeSalePriceCents` (markup global) marcada **`@deprecated`** (palanca de rollback; retiro = follow-up).

### 35.3 Endpoints M2 — `backend/src/modules/pricing/pricing.controller.ts` (super_admin, auditados)
Clones 1:1 del patrón buylist:
- `GET /admin/pricing/sales-rules` → `{ rules, fallbackPct }` (crudo).
- `PUT /admin/pricing/sales-rules` → reemplaza tabla y/o fallback; valida (mode/value/rango, pct∈[0,1000]) →
  `422 VALIDATION_ERROR`; **auditado** `action=pricing.sales_rules.update` (before/after); sin redeploy.
- `GET /admin/pricing/sales-rarities` → `{ fallbackPct, rarities: [{ rarity, cardCount, rule, source }] }`
  (`groupBy Card.rarity` unido a las reglas; sin regla → muestra el fallback; ordenado por `cardCount` desc).

### 35.4 Aplicación — swap de los 2 call-sites
- Nuevo `PricingService.computeSalePriceForItem({rarity, finish}, referenceMxnCents)`: lee `SALES_PRICE_RULES` +
  `SALES_PRICE_FALLBACK_PCT` y aplica `computeSalePriceForRarity`.
- **`catalog.service.toListingDTO`:** si no hay `listPriceCents` (override manual, que **sigue ganando**), calcula
  `salePriceCents` con el resolver por rareza. **SEC-A1:** rareza de `item.card.rarity`, acabado de `item.finish`
  (BD), nunca del cliente.
- **`orders.service.salePriceOf`:** idem; `fixed` devuelve el piso aunque no haya market; `pct` sin referencia →
  `PRICE_PENDING` (se conserva).
- **`computeSalePrice` (PricingService)** queda `@deprecated` — verificado que **no quedan otros callers** en la
  ruta de venta (solo los 2 swapeados).

### 35.5 Piso `fixed` sin market → gate de publicación (cambio de comportamiento intencional)
Con una regla `fixed`, una carta bulk **sin `PriceReference`** ahora obtiene precio de venta (piso) y **puede
volverse `sellable`** (objetivo del piso). El **gate coarse en DB** de `catalog.publishedWhere` filtraba por
existencia de `listPriceCents` **o** alguna `PriceReference` — eso **excluía** justo esas cartas. Como la
resolubilidad ahora depende de `SALES_PRICE_RULES` (que la DB no evalúa), el gate coarse se reduce a
`platform + listed`; la comprabilidad exacta se confirma en `toListingDTO`/`fetchSellable` (un `pct` sin market →
`pending` → no vendible, sigue excluido; el comprador nunca ve "precio pendiente"). Efecto secundario: se cargan más
items del inventario publicado por consulta (antes acotados por el OR de precio); aceptable y deliberado.

### 35.6 Tests (jest verde: 64 suites / 434 tests; `tsc --noEmit` exit 0)
- `test/money.sales-pricing.spec.ts` (NUEVO): `computeSalePriceForRarity` — fixed piso (con/sin market); pct =
  markup arriba de mercado (incl. divergencia value=40 → 140% vs 40% de buylist); pct sin market → pending; gate
  premium (una chase en holofoil NO cae al piso `"Holo"`; un holo de bulk sí; regla explícita gana).
- `test/pricing.sales-rules.spec.ts` (NUEVO): contrato de `GET/PUT sales-rules` + `GET sales-rarities` (shape,
  auditoría `pricing.sales_rules.update`, validación pct>1000/fixed<0/fallback, **acepta pct>100**).
- `test/settings.sales-pricing.spec.ts` (NUEVO): seed de ambos settings, validadores registrados, **NO** en
  `SETTING_DTO_MAP`, `SALES_PCT_MAX=1000`.
- `test/pricing.sales-for-item.spec.ts` (NUEVO): `computeSalePriceForItem` real (lee las keys de venta, no
  `sales_markup_pct`); `toListingDTO` vuelve sellable una Common sin market al piso y respeta el override
  `listPriceCents`; `orders.salePriceOf` da el piso con `fixed` y `PRICE_PENDING` con `pct` sin market.
- Ajustados (mock del call-site swap): `test/catalog.spec.ts`, `test/catalog.enum-filters.spec.ts` (mockean
  `computeSalePriceForItem` en vez del `computeSalePrice` retirado de la ruta).

### 35.7 Notas para otros roles
- **frontend (Fable / editor M2):** el editor de venta vive en `M2View` (no `BuylistView`) y consume
  `sales-rules`/`sales-rarities`. **Copy crítico:** en venta `pct` = **markup arriba de mercado** (no "% de la
  referencia" como en buylist). Sin colisión con backend.
- **devops:** sin cambios de `.env.example`, `schema.prisma` ni migraciones. Los dos `ConfigSetting` nuevos se
  siembran con el seed existente.
- **QA/seguridad:** toca dinero → triple veredicto. SEC-A1 intacto (rareza/acabado server-side de BD). El override
  manual `listPriceCents` sigue teniendo prioridad; el precio se congela en `OrderItem.unitPriceCents` al checkout.
- **Sin cambio de contrato solicitado** — `API_CONTRACT.md §M2` ya documenta ambos endpoints y la semántica del pct.

### 35.8 Triple veredicto Fase 2 + deuda registrada (2026-08-17)
La Fase 2 (commits `fba6486` + `fee3c19`) recibió **triple veredicto APROBADO** (qa + techlead
APROBADO-con-deuda + seguridad APROBADO). **Resumen de la venta por rareza implementada** (remite a
**ARCHITECTURE §4.14** / API_CONTRACT §M2): función pura `computeSalePriceForRarity` en `money.ts` (§4.14b;
`fixed` = piso aunque no haya market, `pct` = markup **arriba de mercado**), endpoints M2 `sales-rules` /
`sales-rarities` (§4.14a/c), **swap de call-sites** de venta a `computeSalePriceForItem`
(`catalog.toListingDTO` + `orders.salePriceOf`, retirando `computeSalePrice`/`sales_markup_pct` de la ruta),
y **piso `fixed` que vuelve `sellable` el bulk** (relaja el gate coarse a `platform+listed`; ver §35.5).
Detalle en §35.1–§35.7.

**Deuda BACKEND no bloqueante registrada** en `docs/TECH_DEBT.md` (sección Backend, tras BE-23):
- **BE-24** (techlead) — trap de tipado estructural `BuylistRule` vs `SalesRule` en `money.ts` (firmas
  posicionales idénticas → TS no atrapa el cruce compra/venta). Mitigar con branding nominal o test de fórmula.
- **BE-25** (techlead + qa) — N+1 de lecturas de settings en `fetchSellable` agravado por el gate relajado
  (2 `findUnique` sin cache por `toListingDTO`). Izar/memoizar `SALES_PRICE_RULES` por request.
- **BE-26** (seguridad B-6, Baja, ruta de dinero) — orden a $0 por regla `fixed:0`: `salePriceOf` solo
  rechaza `== null`, no `<=0`; `createSession` no re-verifica precio. **Endurecer ANTES de dinero real.**
- **BE-27** (seguridad B-7, Baja) — `fixed` sin cota superior → overflow Int32 (columnas `*Cents` 32-bit);
  misma familia que B-3 de `PENTEST_NOTES`, extendida a venta. Acotar en la decisión BigInt de B-3.

### 35.9 `SALES_MARKUP_PCT` / `salesMarkupPct` queda NO-OP tras Fase 2 (deprecado)
El dial `SALES_MARKUP_PCT` (`sales_markup_pct`, campo `salesMarkupPct`) **ya no lo lee la ruta de venta** (la
reemplaza la tabla `SALES_PRICE_RULES` + `SALES_PRICE_FALLBACK_PCT`). **Sigue editable en M10** pero es
**no-op** funcional: cambiarlo **no afecta** ningún precio de venta y **confunde** al operador. Se conserva
solo como **palanca de rollback** (decisión abierta **v1.13-3**, ver ARCHITECTURE §4.14d). **Retiro definitivo
pendiente** — cuando se cierre v1.13-3, quitar el dial del seed/DTO y del código muerto.

## 36. WS-A (v1.14-price-ingest, 2026-08-17) — Ingesta MASIVA de precios (BulkPriceProvider) + FX #13

> **TOCA DINERO → triple veredicto.** Implementa ARCHITECTURE §4.15 (a–h) y API_CONTRACT §M10-ops / §M10 / §M2.
> **Aditivo, SIN migración de esquema** (reusa `PriceReference`+`finish`, `PriceSource.pokemonpricetracker`,
> `Card.availableFinishes`). Gates verdes: `npx tsc --noEmit` (exit 0), `npx jest` (**68 suites / 467 tests**),
> `eslint` limpio. **SEGURIDAD (repo público):** la API key SOLO se lee de
> `process.env.POKEMONPRICETRACKER_API_KEY` (vía ConfigService) — cero secretos en el repo.

### 36.1 Qué se implementó (por archivo)
- **`modules/pricing/pricing.types.ts`** — interfaces nuevas `BulkPriceRow` / `BulkPriceResult` /
  `BulkPriceProvider` (§4.15b, distintas del `PricingProvider` per-carta, que se conserva) + helper
  `normalizeFinishAlias(raw) → Finish | null` (tabla conservadora variante→acabado; desconocida → `null` →
  se OMITE, money-safe).
- **`modules/pricing/providers/pokemonpricetracker-bulk.provider.ts`** (NUEVO, PRIMARIO) —
  `POST https://www.pokemonpricetracker.com/api/v1/cards/bulk-price` (host FIJO anti-SSRF), `Authorization:
  Bearer <env key>`, body `{ set, limit, page }`. **Mapeo defensivo:** valida `market>0`, `variante→Finish`,
  omite mal formado. **FAIL-CLOSED de moneda/unidad (post-veredicto B):** NO persiste bajo moneda/unidad
  asumida — el operador fija `POKEMONPRICETRACKER_MARKET_FORMAT` (sin default, valores
  `usd_dollars|usd_cents|mxn_dollars|mxn_cents`); **sin él → modo sample-only** (loguea la muestra, persiste
  NADA). **LOGUEA UN ejemplo** de la 1ª entrada cruda (sin secretos). Sin key/HTTP fail → `{ rows: [] }` + log
  (precios STALE, no se borran). **PO confirmó `usd_dollars`** (= ×100 + FX + colchón, idéntico al legacy USD).
- **`modules/pricing/providers/pokemontcg-io-bulk.provider.ts`** (NUEVO, LEGACY/rollback) — envuelve
  `PokemonTcgIoClient.getCardsBySet` (paginado) y extrae `tcgplayer.prices[llave].market` por acabado
  (USD). Permite `PRICE_PROVIDER=pokemontcg_io` sin la key de paga; el job ya es robusto con esta fuente.
- **`modules/pricing/price-ingest.service.ts`** (NUEVO, `PriceIngestService`) — `providerFor()` (dial),
  `ingestSet(setId, fx)` / `ingestSetByExternalId` / `ingestAll(fx)`, resolución carta↔BD (externalId
  primario → `(set,number)` fallback → omite no resueltas), agrupa por carta, **upsert por acabado** vía
  `PricingService.persistMarketReference`, **`availableFinishes` derivado del proveedor** (autoridad, no
  clobbea si el proveedor no reporta nada).
- **`jobs/price-ingest.service.ts`** (NUEVO, `PriceIngestJobService`) — orquestación: **con Redis** fan-out
  (un `price-ingest-set` por set, jobId determinista por día = single-flight, `attempts:3`+backoff,
  reanudable); **sin Redis** secuencial **AWAITED** (nunca fire-and-forget). **FX una vez por corrida**
  (`FxService.getCurrent()` → snapshot en `job.data`).
- **`modules/pricing/pricing.service.ts`** — `persistMarketReference` **generalizado**: acepta
  `{ marketCents, currency: 'USD'|'MXN', source: PriceSource }`. USD → `usdToMxnCents` (colchón) + guarda
  `priceUsdCents`/`fxRate`/`fxBufferPct`; **MXN → sin conversión** (`priceUsdCents`/`fx*` = null). Respeta
  `isManualOverride` (skip).
- **`modules/catalog/catalog-sync.service.ts`** (DEV-5 / A.5) — **aligerado a SOLO metadata**: se
  quitó `persistMarketReferences` + las deps `PricingService`/`FxService` + todo el threading de FX. Se
  **conserva** `deriveAvailableFinishes` como **bootstrap** (default seguro; `price-ingest` lo sobre-escribe).
  Constructor ahora `(prisma, client, settings)`.
- **`modules/settings/settings.constants.ts`** — dial `PRICE_PROVIDER` (`price_provider`), **seed
  `'pokemontcg_io'`** (money-safe), validador `IsIn(['pokemontcg_io','pokemonpricetracker'])`, en
  `SETTING_DTO_MAP` como `priceProvider`.
- **`modules/pricing/fx.service.ts`** (#13) — `getCurrent()` prefiere el `bufferPct` del **dial** en TODAS
  las ramas (aplica de inmediato en el próximo ingest); `setManual(rate?, bufferPct?)` con `rate` opcional
  (omitirlo guarda SOLO el colchón, NO pinnea `fx_manual_override_rate`).
- **`modules/pricing/pricing.controller.ts`** — `FxDto.rate?` opcional (al menos uno; 422 si el body va vacío).
- **`jobs/admin-jobs.controller.ts`** — `POST /admin/jobs/price-ingest` (super_admin, auditado
  `jobs.price_ingest.run`, `HttpCode(202)`, `setId?` opcional). **Toca dinero.**
- **`jobs/scheduler.service.ts`** — entrega la cola al ingest (`setQueue`), enruta `price-ingest` (parent) /
  `price-ingest-set` (child) en el worker. **Transición de scheduling completada (post-veredicto A):**
  `price-ingest` se programa **POR DEFECTO 2×/día** (00:00 y 12:00 UTC, `PRICE_INGEST_CRON_1/_2` overridable) con
  el dial sembrado `pokemontcg_io` (legacy USD → money-safe); el barrido pesado `catalog-price-sync force:true`
  **se retiró del schedule** y se reemplazó por `catalog-metadata-sync` **diario** (`syncAll({force:false})`,
  solo sets nuevos, barato; `CATALOG_METADATA_SYNC_CRON` overridable). El disparo manual
  `POST /admin/jobs/catalog-price-sync` (force:true, ops) se conserva intacto.
- **`jobs/catalog-price-sync.service.ts`** — nuevo `runMetadataImport()` (`syncAll({force:false})`) para la
  cadencia ligera del scheduler; `run()` (force:true) se conserva para el disparo manual de ops.
- **`config/env.validation.ts`** — `POKEMONPRICETRACKER_API_KEY` requerida en no-local **solo** cuando el
  hint de env `PRICE_PROVIDER=pokemonpricetracker` está presente (la autoridad runtime es el dial en BD; el
  provider degrada seguro si falta la key).

### 36.2 Campos del proveedor de paga ASUMIDOS (a verificar en la 1ª corrida en Railway)
El dominio del proveedor está **bloqueado en dev por egress**, así que el esquema exacto se verifica en la 1ª
corrida (`POST /admin/jobs/price-ingest { "setId": "sv8" }` → inspeccionar el **log de ejemplo** +
`PriceReference`). Supuestos marcados en el adapter (`pokemonpricetracker-bulk.provider.ts`):
1. **Endpoint/params:** `POST /api/v1/cards/bulk-price` con `{ set, limit, page }`; paginación por `page`
   (corta cuando la página viene `< limit`).
2. **Envelope:** `{ data: [] }` (o `cards`/`results`/`prices`/array pelón).
3. **Id de carta:** `id` | `cardId` | `productId` | `_id`; **número:** `number` | `cardNumber` | `collectorNumber`.
4. **Variante/acabado:** shape (A) `prices: { <variante>: { market } }` (tcgplayer-like) o (B) plano
   `variant`/`finish`/`printing` + `market`/`marketPrice`/`price`. Variante desconocida → **OMITE**.
5. **MONEDA + UNIDAD de `market` = FAIL-CLOSED (post-veredicto B):** ya NO se asume nada. El operador fija
   `POKEMONPRICETRACKER_MARKET_FORMAT` (env, **sin default**): `usd_dollars` (×100 + FX + colchón, **confirmado
   por el PO** 2026-08-17), `usd_cents` (sin ×100 + FX), `mxn_dollars` (×100, sin FX), `mxn_cents` (sin ×100, sin
   FX). **Sin la env → sample-only** (loguea la muestra, persiste NADA). La moneda de la fila viene del FORMATO,
   no de un campo `currency` del payload. Runbook: correr `POST /admin/jobs/price-ingest { "setId": "sv8" }` con
   el dial en `pokemonpricetracker` → leer el log de muestra → fijar `POKEMONPRICETRACKER_MARKET_FORMAT=usd_dollars`.

### 36.3 Seed del dial + rollout
`price_provider` **seed `'pokemontcg_io'`** (legacy, **NO cambia**). El flip a `'pokemonpricetracker'` es del
humano/devops por `PUT /admin/settings { "priceProvider": "pokemonpricetracker" }` (sin redeploy) — y requiere
además fijar `POKEMONPRICETRACKER_MARKET_FORMAT` (si no, el proveedor de paga corre sample-only y no escribe).
**Scheduling (post-veredicto A): `price-ingest` corre POR DEFECTO 2×/día** con Redis (usa el dial sembrado
`pokemontcg_io` → misma fuente USD de siempre, money-safe). Es decir: en un deploy por defecto CON Redis
(Railway) los precios del catálogo **sí se refrescan** desde el arranque (desatoro de #1/#8/#10), sin activar el
proveedor de paga. Sin Redis → fallback manual awaited.

### 36.4 Tests (mocks del provider; NO se llama la API real)
- `test/price-ingest.provider.spec.ts` — mapeo defensivo de ambos adapters + `normalizeFinishAlias`
  (variante→finish, desconocida→null, skip market≤0); **fail-closed (B):** sin `MARKET_FORMAT` → sample-only
  (fetch sí, persiste nada); `usd_dollars` → ×100 (=legacy USD); `usd_cents` → sin ×100; `mxn_dollars` → ×100 +
  moneda MXN; sin key → `{rows:[]}`; HTTP fail.
- `test/price-ingest.service.spec.ts` — dial elige provider; upsert por acabado; resolución externalId /
  `(set,number)`; omite no resueltas; **no clobbea** `availableFinishes`; MXN propagada; `persistMarketReference`
  USD vs MXN + respeta override.
- `test/price-ingest.job.spec.ts` — fan-out (un `price-ingest-set` por set) + **FX una vez** (mismo snapshot
  en cada child); sin cola → `ingestAll` AWAITED; single-flight → `enqueued:false`; `setId` → `scope:set`; `runChild`.
- `test/fx.buffer-optional-rate.spec.ts` — `getCurrent` usa el colchón del dial; `setManual` con/sin `rate`;
  `FxController` (422 body vacío, solo-buffer, rate+buffer).
- `test/settings.validation.spec.ts` (+casos) — `priceProvider` válido/ inválido + expuesto en `getAllDto`.
- Ajustados por el aligeramiento de `catalog-sync`: `catalog-sync.spec.ts`, `catalog-sync.finish.spec.ts`,
  `catalog.remote-sets-fallback.spec.ts` (constructor 3 args), `catalog-price-sync.spec.ts` (solo el job),
  `admin-jobs.controller.spec.ts` + `scheduler.spec.ts` (nueva dep `PriceIngestJobService`).

### 36.5 Notas para otros roles
- **devops — ENV NUEVAS a añadir a `.env.example`/Railway (NO las edité yo; ruta devops):**
  - `POKEMONPRICETRACKER_API_KEY` (secreto; ya se lee de env). Requerida en no-local solo si el hint
    `PRICE_PROVIDER=pokemonpricetracker` está puesto.
  - **`POKEMONPRICETRACKER_MARKET_FORMAT`** (NUEVA, post-veredicto B): fijar a **`usd_dollars`** (confirmado PO)
    tras ver el log de la 1ª corrida. **Sin ella el proveedor de paga NO escribe precios** (fail-closed).
  - `PRICE_INGEST_CRON_1` / `PRICE_INGEST_CRON_2` (opcionales; **defaults `0 0 * * *` / `0 12 * * *`** — ya no
    son opt-in, el ingest se programa por defecto). `CATALOG_METADATA_SYNC_CRON` (opcional; default `0 1 * * *`).
- **devops — scheduling (post-veredicto A):** ya NO hay que hacer nada para que el pricing corra: `price-ingest`
  2×/día está por defecto con `pokemontcg_io`. Se **retiró** el barrido pesado `catalog-price-sync` del schedule
  (reemplazado por `catalog-metadata-sync` diario, `force:false`). Recomendado: `fx-refresh` (06:00 UTC) antes
  del ingest de 12:00 UTC (el de 00:00 usa el FX del día previo — degradación suave, aceptable §4.15g). Cuota/
  coste del proveedor de paga = decisión abierta v1.14-2.
- **QA/seguridad:** SEC-A1 intacto (precio server-side del proveedor; `finish` = dimensión de la clave, no
  monto del cliente). Money-safe: sin key/fallo/formato → NO se escriben precios (STALE/sample-only) + log; MXN
  sin ×FX; variante desconocida → omitida (no se atribuye a `normal`). El **fail-closed de MARKET_FORMAT** cierra
  el riesgo de inflar ~18×/100× al flipar (§36.2.5).
- **frontend (M2):** `PUT /admin/fx` acepta `rate?` opcional (guardar solo colchón); alternativa recomendada
  `PUT /admin/settings { fxBufferPct }`. Dial `priceProvider` editable en M2/M10.

### 36.6 Decisión de implementación a señalar (NO cambia el contrato)
La **resolución carta↔BD** (externalId primario, `(set,number)` fallback, omitir no resueltas) vive en
`PriceIngestService`, **no dentro del adapter HTTP**, porque (a) el `BulkPriceRow` del contrato §4.15b lleva
`externalId`/`number` (NO un `cardId` ya resuelto) y §4.15c dice que el child "agrupa por cardId **resuelto**",
y (b) mantiene el adapter **sin BD** y unit-testeable. Funcionalmente idéntico al requisito money-safe de §4.15d.
Ninguna duda de contrato/esquema bloqueante: el único punto a confirmar en runtime es el **esquema del payload
del proveedor de paga** (§36.2), ya contemplado por el diseño (dial seed legacy + verificación en 1ª corrida).

### 36.7 Cierre post-triple-veredicto (2026-08-17) — 3 follow-ups no bloqueantes
WS-A recibió **triple veredicto APROBADO** (qa+techlead+seguridad). Antes de promover a main se cerraron 3
hallazgos no bloqueantes (SIN cambio de contrato/schema):
- **(A) Transición de scheduling [techlead].** `price-ingest` ahora corre **por defecto 2×/día** (dial sembrado
  `pokemontcg_io` → money-safe) y el barrido pesado `catalog-price-sync force:true` se **retiró del schedule**,
  reemplazado por `catalog-metadata-sync` diario (`force:false`, solo sets nuevos). Así el deploy por defecto CON
  Redis **cumple el desatoro** de #1/#8/#10 sin activar el proveedor de paga. Ver §36.3 y `scheduler.spec.ts`.
- **(B) Fail-closed de moneda/unidad [seguridad Media + qa].** El proveedor de paga NO persiste bajo formato
  asumido: `POKEMONPRICETRACKER_MARKET_FORMAT` (sin default) o **sample-only**. PO confirmó **`usd_dollars`**
  (= comportamiento legacy). Cierra el riesgo de inflar ~18×/100× al flipar. Ver §36.2.5 / §36.5.
- **(C) Deuda aceptada registrada** en `docs/TECH_DEBT.md` (Backend): **BE-28** (FxDto.rate entero, pre-WS-A),
  **BE-29** (resolveCardId `(set,number)` ambiguo), **BE-30** (seed sin fila `price_provider` explícita),
  **BE-31** (single-flight del parent solo explícito en la rama secuencial; comentario simétrico añadido),
  **BE-32** (loop de páginas si el proveedor ignora `page` + batch de `resolveCardId`), **BE-33** (moneda/unidad,
  ahora **mitigada** por B — disparador: fijar `MARKET_FORMAT` antes de flipar).

**Gates tras el pase:** `npx tsc --noEmit` exit 0; `npx jest` **68 suites / 469 tests** verdes.

## 37. WS-C (v1.15-buylist-batch-clabe, 2026-08-17) — cotizador buylist contra el backend REAL (Fase 3b)

> **TOCA DINERO/PII → triple veredicto.** Implementa ARCHITECTURE §4.16 (a–c) y API_CONTRACT §0/§1/§6
> (Changelog v1.15). **Aditivo, SIN migración de esquema** (reusa `KycProfile.clabeEnc`,
> `SellRequest.clabeSnapshotEnc`, `quoteAcquisitionForFinish`, `PriceReference`). **SEC-A1 intacto**
> (montos server-side por `(Card.rarity, finish)`; el cliente nunca fija precio ni CLABE de terceros).
> Gates verdes: `npx tsc --noEmit` (exit 0), `npx jest` (**69 suites / 486 tests**).

### 37.1 Qué se implementó (por archivo)
- **`modules/buylist/dto/buylist.dto.ts`**:
  - `CreateRequestDto.clabe` → **`@IsOptional() @IsString() clabe?: string`** (antes `@IsString() clabe!`).
  - **NUEVO** `BuylistQuoteItemDto` (espeja `PublicQuoteDto`: `cardId`, `productType`, `rawCondition?`,
    `finish?`; **SIN `qty`** — una línea por carta física) y **`BatchQuoteDto`** (`items` con
    `@ArrayNotEmpty` + `@ArrayMaxSize(BUYLIST_QUOTE_BATCH_MAX)` + `@ValidateNested`/`@Type`). Constante
    exportada **`BUYLIST_QUOTE_BATCH_MAX = 50`**.
- **`modules/buylist/buylist.service.ts`**:
  - **`createRequest(userId, items, clabe?, ineUploadKeys?)`** — CLABE opcional + **fallback server-side**
    (§4.16a). La KYC se lee SIEMPRE por el `userId` autenticado. Con `clabe` en el body: flujo idéntico al
    actual (formato → `422 CLABE_INVALID`; nombre propio por blind-index HMAC → `422 CLABE_NOT_OWN_NAME`;
    persiste `clabeEnc`+`clabeHmac` en KYC). Sin `clabe`: **desencripta `kyc.clabeEnc`** (misma vía que
    `revealClabe`) → si no hay → **`422 CLABE_REQUIRED`** (nuevo). La CLABE resuelta se **snapshotea
    cifrada** en `clabeSnapshotEnc`, **NUNCA se loguea ni se devuelve**. En el fallback **no** se reescribe
    la CLABE en KYC (ya está en archivo); el INE sí se actualiza si vienen keys nuevas.
  - **`batchQuote(items)`** (§4.16b) — `map` de `quoteCardForFinish` sobre `items[]` cargando
    `buylistRules()` **una vez**. **Errores por-ítem**: `NOT_FOUND`/`FINISH_NOT_AVAILABLE` → `ok:false` de ESE
    ítem (cualquier otro error se propaga); el resto sale `ok:true`. **READ-ONLY**: no crea solicitud, no
    persiste, **no** llama `escalatePending`. Correlación por `index` + eco de `cardId`.
  - **`quoteCardForFinish(...)`** (privado, NUEVO) — núcleo READ-ONLY extraído de `publicQuote`, recibe
    `rules`/`fallbackPct` ya cargados. `publicQuote` ahora delega en él (misma matemática/guardarraíles;
    shape del quote por-carta **sin cambios**). Tipos exportados `BuylistQuotePayload` /
    `BuylistBatchQuoteResult` (para nombrar el retorno en el controller).
- **`modules/buylist/buylist.controller.ts`** — **`POST /buylist/quote/batch`** (`@Public()`,
  `@HttpCode(200)`, sin `@RequireEmailVerified`). `create` pasa `dto.clabe` (ahora opcional) sin cambios.
- **`modules/users/users.service.ts`** — `getKyc` añade **`clabeOnFile: Boolean(kyc?.clabeEnc)`** (§4.16c),
  simétrico a `ineOnFile`. `clabeMasked` se conserva; sin PII nueva.
- **`common/error-codes.ts`** — nuevo código estable **`CLABE_REQUIRED`** (se serializa como `422`).

### 37.2 Garantías de PII / dinero (para seguridad y QA)
- **Autorización estricta del fallback:** `kyc = findUnique({ where: { userId } })` con el `userId` de la
  sesión; es **imposible** resolver la CLABE de otro usuario. Test dedicado: un `u2` con OTRA CLABE en
  archivo **jamás** se usa para `u1` (y si `u1` no tiene CLABE → `CLABE_REQUIRED`, no cae a la de `u2`).
- **CLABE nunca en claro fuera del reveal:** no se loguea, la respuesta (`{ sellRequestId, status,
  quotedTotalCents, ineRequired, items }`) **no** la incluye, y el snapshot va cifrado (`pii.encrypt`). El
  único punto de exposición en claro sigue siendo `GET /admin/buylist/:id/reveal-clabe`.
- **SEC-A1 en batch:** rareza (`Card.rarity`) y `finish` (validado contra `Card.availableFinishes`) se
  derivan server-side; el cliente no envía precio/monto/regla. El batch es anónimo pero **read-only** — no
  escribe en la cola de precio pendiente (misma doctrina que `publicQuote` desde v1.12).
- **Cap 50:** lo impone el DTO (`@ArrayMaxSize(50)`) → `400 VALIDATION_ERROR`; cuenta como **1** request
  contra el throttle público (colapsa el fan-out FE-12).

### 37.3 Tests (jest) — `test/buylist.batch-clabe.spec.ts` (17 casos)
- **Fallback usa SOLO la CLABE propia** (snapshot descifra a la propia; la KYC se lee siempre por el
  `userId` autenticado; no reescribe la CLABE en KYC en el fallback).
- **`CLABE_REQUIRED`** cuando no hay `clabe` ni CLABE en archivo (con y sin KYC) — no crea solicitud, no
  alcanza la CLABE de otro usuario.
- **`clabe` en el body**: comportamiento intacto (persiste `clabeEnc`+`clabeHmac`); formato inválido →
  `CLABE_INVALID` sin caer al fallback.
- **Batch con 1 carta inválida → 200 + error por-ítem** (mezcla `ok`/`NOT_FOUND`/`FINISH_NOT_AVAILABLE`/
  `precio_pendiente`, correlada por `index`); **READ-ONLY** (`escalatePending` nunca llamado).
- **Equivalencia batch vs. quote por-carta** (mismo `payload` por acabado: normal $0.50, reverse $1.50,
  holofoil 40% del market).
- **DTO del batch**: cap 50 exacto válido, 51 → `arrayMaxSize`, vacío → `arrayNotEmpty`, ítem malformado →
  error nested.
- **`clabeOnFile`** refleja el estado real (con CLABE / solo INE / sin KYC), y la CLABE sigue enmascarada.
- Ninguna aserción imprime/valida la CLABE en claro salvo para comprobar que el snapshot **NO** la contiene
  sin cifrar.

### 37.4 Notas para otros roles
- **frontend:** `POST /buylist/quote/batch` (1 request por página del grid, render parcial-tolerante por
  `results[].ok`/`error.code`); usar `clabeOnFile` para el atajo "usar mi CLABE ****1234" (**omitir** `clabe`
  en `POST /buylist/requests`) e `ineOnFile` para ocultar los uploaders de INE. Ver §4.16c.
- **devops/QA/seguridad:** sin nueva ENV ni migración. E2E sugerido (ARCHITECTURE §4.16, reparto): cotizar un
  lote, crear solicitud con CLABE en archivo (sin reteclear) y con INE en archivo (sin resubir); pentest del
  fallback (no fugar/loguear CLABE; no resolver la de otro usuario).

### 37.5 Sin dudas de contrato/esquema
El contrato v1.15 es implementable tal cual con los defaults del arquitecto (endpoint aditivo `/batch`, sin
`qty`, cap 50, `422 CLABE_REQUIRED`). **No se solicitó ningún cambio de contrato ni de schema.**

**Gates:** `npx tsc --noEmit` exit 0; `npx jest` **69 suites / 486 tests** verdes.

---

## 38. WS-E · Master Set + inventario a escala (v1.16-master-set, §M1, §4.17)

Agregación de LECTURA (binder por set) + escritura por LOTE, **encima del modelo por-pieza sin
cambiarlo** (sigue 1 `InventoryItem` por pieza física). Todos los endpoints `vault_operator+`. Migración
única **M-21** (índice + `InventoryBatch`). NO toca dinero saliente; la publicación deriva el precio de
venta server-side (reusa §4.14, SEC-A1).

### 38.1 Migración M-21 (`prisma/migrations/20260817120000_m21_master_set_batch/`)
- **Índice** `@@index([cardId, finish, status])` en `InventoryItem` — sirve la agregación `countsByFinish`
  del binder (`GROUP BY cardId, finish` filtrando status on-hand) y el conteo por set. Complementa (no
  reemplaza) los índices existentes.
- **Modelo `InventoryBatch`** — `id` = `batchKey` (idempotencia natural), `actorUserId?`, `kind`
  (`create|publish`), `requested`, `createdItems`, `failedLines`, `resultJson`, `createdAt`. Es el registro
  de auditoría del lote (complementa `AuditLog`). Sin FK dura a `User` (patrón `AuditLog`). Aditiva, sin
  backfill. **NO se aplicó a ninguna BD** (no hay DB en el sandbox); `prisma validate` + `prisma generate`
  OK, la SQL sigue la convención del repo.

### 38.2 Endpoints (§M1, `vault_operator+`)
- **`GET /admin/inventory/master-sets`** (`MasterSetService.index`) — índice de sets con `MasterSetSummaryDTO`
  (`printedTotal`, `catalogCardCount`, `distinctCardsOwned`, `completionPct`, `totalPieces`, `year`). **Query
  fija sin N+1**: (1) página de `CardSet` (filtro `q`), (2) `Card.groupBy([setId])` → `catalogCardCount`,
  (3) **una** agregación raw `InventoryItem ⋈ Card GROUP BY setId` → piezas + cartas distintas on-hand.
  `sort`: `release_desc` (default) | `completion_asc` | `pieces_desc`.
- **`GET /admin/inventory/master-sets/:setId`** (`MasterSetService.binder`) — binder con `MasterSetCardCellDTO`
  por carta (`cardId`, `number`, `numberSort`, `name`, `rarity`, `imageSmallUrl`, `availableFinishes`,
  `countsByFinish`, `totalCount`, `isSecretRare`). **Orden natural** obligatorio (ver 38.4). Sin N+1: 1
  `Card WHERE setId` + 1 `groupBy [cardId, finish]`. 404 si el set no existe. `:setId` = id LOCAL del `CardSet`.
- **`POST /admin/inventory/items/batch`** (`InventoryService.batchCreate`) — alta por LOTE. **Errores
  por-línea** (una línea inválida no tumba el resto → commit parcial, HTTP 200), **`qty`** expande a N
  `InventoryItem`/N folios (graded → qty 1; qty>1 en graded = `VALIDATION_ERROR`), folios **consecutivos** por
  línea vía `PrismaService.nextFolios(qty)`, **idempotencia + auditoría** por `batchKey` en `InventoryBatch`
  (replay → `idempotentReplay:true` sin re-crear). Header `Idempotency-Key` equivale a `batchKey`. La lógica
  por línea reusa **exactamente** `resolveCreation` (extraída de `createItem`): costo de aportación
  server-side, validación de `finish` contra `availableFinishes` (SEC-A1). Auditado `inventory.batch_create`.
- **`POST /admin/inventory/items/bulk-publish`** (`InventoryService.bulkPublish`) — publicar N piezas →
  `listed`. Precio **derivado** server-side (`computeSalePriceForRarity`, rareza de `Card.rarity` + acabado de
  `InventoryItem.finish`, SEC-A1) o **manual** (`listPriceCents`). `pct` sin market → `PRICE_PENDING`: **no
  publica** esa pieza (regla "solo se lista lo que tiene precio"). Errores por-línea (no encontrada, no
  `platform`, graded sin `certNumber`, precio pendiente) → HTTP 200. Re-publicar una `listed` = no-op
  idempotente. `batchKey?` opcional (idempotencia/auditoría del lote). Auditado `inventory.bulk_publish`.

### 38.3 Deuda pagada
- **`PricingService.getReferencesBatch(items)`** (cierra **RB-8/BE-4/D3**) — referencia vigente = más
  reciente por acabado para N ítems en **1** query; devuelve `Map<cardId|productType|gradeKey|finish, PriceInfo>`.
- **`PricingService.loadSalesRules()`** — iza `SALES_PRICE_RULES`+fallback en 1 par de lecturas.
- **BE-25 (pago mínimo):** `bulk-publish` y `CatalogService.fetchSellable` izan las reglas **una vez** y usan
  `getReferencesBatch` (antes: 2 lecturas de settings + 1 `getReference` **por ítem** = N+1). El resto de
  BE-25 (memoización global de `SettingsService`, familia BE-4/D3) queda como deuda menor.
- **`PrismaService.nextFolios(n)`** — reserva n folios consecutivos en 1 `SELECT nextval(...) FROM
  generate_series(1,n)`.

### 38.4 Orden natural de `Card.number` (String) — decisión de implementación
`Card.number` es String; el orden lexicográfico rompe ("10" < "2"; promos mal ubicadas). `deriveNumberParts`
+ `compareByNumber` (puros expuestos y testeados) producen:
1. cartas **puro-numéricas** primero, por su entero ("2" < "10" < "200");
2. cartas con **prefijo** (promos/subsets `TG`/`GG`/`SV`) al **FINAL**, **agrupadas por prefijo** (GG → SV →
   TG) y dentro del prefijo por su parte numérica ("TG2" < "TG12").
`numberSort` (DTO) = entero para puros; `1_000_000 + parte_numérica` para promos (clave coarse "al final"
que el front puede reusar). `isSecretRare = numberSort > printedTotal`.
- **Desviación documentada del literal del contrato:** el contrato ilustra `numberSort` con
  `regexp_replace(number,'\D','','g')::int` (que daría `TG12`→12, ubicándolo entre las numéricas), pero el
  MISMO contrato y el reparto de ARCHITECTURE §4.17 exigen "**TG12 al final**" / "no-numéricos al final"
  (default **WS-E-5**). Se implementó el comportamiento **observable** exigido (promos al final, agrupadas por
  prefijo), no la fórmula literal (que lo contradice). No se cambió el contrato. **Punto para el arquitecto
  si quiere reconciliar el texto de la fórmula.**

### 38.5 Defaults de decisiones abiertas aplicados (para revisión del humano)
- **WS-E-1** completitud = `distinctCardsOwned / catalogCardCount` (denominador = **catálogo real**, nunca
  >100%; `printedTotal` se expone aparte). `completionPct=null` si `catalogCardCount=0`.
- **WS-E-2** on-hand = **solo `ownerType='platform'`** con `status NOT IN (withdrawn, shipped, delivered,
  lost, damaged)`. La custodia de clientes (`customer_custody`) NO cuenta en el binder de back-office.
- **WS-E-3** `qty` es un **atajo bulk** (raw/sellado) que expande a N piezas/N folios; graded siempre 1.
- **WS-E-4** cap **200** líneas por lote + idempotencia con `InventoryBatch` (que además ES la auditoría del
  lote). Empty/over-cap/`batchKey` ausente → `400 VALIDATION_ERROR`.
- **WS-E-5** no-numéricos/promos al final (ver 38.4).

### 38.6 Desviación menor de implementación (sin cambio de contrato)
- **Índice Master Set — agregación global vs. page-scoped:** el contrato sugiere agregar solo los `setId` de
  la página. Para que `sort=completion_asc`/`pieces_desc` sea **globalmente correcto** (no solo dentro de la
  página) se cargan los sets que hacen match con `q` (select liviano) y se agrega para ellos en **3 queries
  fijas** (patrón `set-value.service`), no una por set. Sigue siendo **O(1) queries / sin N+1**; el nº de
  sets es acotado (~cientos). Documentado por si el arquitecto prefiere paginar en DB solo para `release_desc`.

### 38.7 Archivos tocados
- `prisma/schema.prisma` (índice + `InventoryBatch`), `prisma/migrations/20260817120000_m21_master_set_batch/migration.sql`.
- `src/prisma/prisma.service.ts` (`nextFolios`).
- `src/modules/pricing/pricing.service.ts` (`getReferencesBatch`, `loadSalesRules`; `computeSalePriceForItem`
  reusa `loadSalesRules`).
- `src/modules/inventory/master-set.service.ts` (**nuevo**: index/binder + orden natural).
- `src/modules/inventory/inventory.service.ts` (`resolveCreation`/`buildItemData` extraídos; `batchCreate`,
  `bulkPublish`).
- `src/modules/inventory/inventory.controller.ts` (4 endpoints), `inventory.module.ts`, `dto/inventory.dto.ts`
  (DTOs de lote).
- `src/modules/catalog/catalog.service.ts` (`fetchSellable`/`toListingDTO` con contexto pre-cargado, BE-25).
- Tests: `test/master-set.service.spec.ts`, `test/inventory.batch.spec.ts`, `test/pricing.references-batch.spec.ts`,
  `test/catalog.spec.ts` (mock actualizado a las nuevas deps de `fetchSellable`).

### 38.8 Notas para otros roles
- **frontend (M1):** índice Master Set (grid ordenable), binder (cuadrícula por número; `countsByFinish`,
  huecos `totalCount=0`, secret rares; **filtros locales** rareza/acabado/faltantes sobre la respuesta
  completa), carrito de captura → 1 POST `/batch` (render parcial-tolerante por `results[].ok`), publicación
  masiva → `/bulk-publish`. Reusa el componente de cuadrícula del picker del cotizador.
- **devops/QA:** doble veredicto (no toca dinero saliente; publicación deriva precio server-side). **No hay
  DB en el sandbox → la migración M-21 se debe aplicar (`prisma migrate deploy`) en el entorno real.** E2E:
  inventariar un set por el binder, ver el conteo agregado actualizarse, publicar en lote, confirmar que el
  replay del carrito no duplica.

### 38.9 Sin dudas de contrato bloqueantes
El contrato v1.16 es implementable tal cual con los defaults del arquitecto. **Único punto de reconciliación
NO bloqueante:** el texto de la fórmula `numberSort` del contrato (regexp) contradice el requisito
"TG12/no-numéricos al final" del mismo contrato; se implementó el requisito observable. No se modificó
`API_CONTRACT.md`.

**Gates:** `npx tsc --noEmit` exit 0; `npx jest` **72 suites / 503 tests** verdes.

## 39. Endurecimiento WS-E — cierre de hallazgos de escritura por lote (2026-08-17)

Los tres veredictos aprobaron WS-E con hallazgos a cerrar ANTES de promover (uno es bug de DINERO). Todo
en `backend/` (+ estas notas + `TECH_DEBT`), **sin tocar el contrato**. Gates: `tsc --noEmit` exit 0;
`jest` **72 suites / 514 tests** verdes.

### 39.1 [MONEY · QA] Double-sell cerrado en `bulkPublish` (allowlist de status de ORIGEN)
- **Bug:** la guarda por-línea solo validaba `ownerType !== 'platform'`; **no** miraba el `status` actual
  antes de forzar `status → 'listed'`. Una pieza de plataforma en `reserved` (orden con PaymentIntent vivo),
  `in_custody`/`picking`/`shipped`/`delivered`, `lost`/`damaged` (sin existencia física real) o `withdrawn`
  podía re-publicarse a `listed`. Como el checkout reserva por `status IN ('listed','in_stock')`
  (`orders.service.ts` reserva atómica), un **segundo** checkout la reservaría para OTRO comprador → **dos
  clientes por una pieza física** / inventario fantasma.
- **Fix:** allowlist de status de origen `PUBLISHABLE_ORIGIN_STATUSES = ['in_stock','listed']`
  (`inventory.service.ts`). `in_stock` → publica; `listed` → **no-op idempotente** (`ok:true`); cualquier
  otro → **error por-línea `ITEM_NOT_PUBLISHABLE`** (422, nuevo en `error-codes.ts`) que **no tumba** el
  resto del lote. El `status` se lee del `InventoryItem` en BD (server-side), nunca del DTO. El enum real de
  `InventoryStatus` **no tiene `sold`** (una venta liquidada pasa a `in_custody` con `ownerType='customer'`,
  ya bloqueado por la guarda de owner); el conjunto seguro correcto para publicar es `{in_stock, listed}`.
- **Nota para el arquitecto (NO bloqueante):** el contrato §M1 (WS-E, `bulk-publish`) debería **especificar
  explícitamente el conjunto de status de ORIGEN permitido**; hoy solo describe el error `PRICE_PENDING`
  por-línea y no menciona la guarda anti-double-sell. Se implementó el comportamiento seguro; no se editó
  `API_CONTRACT.md`. Sugerencia: documentar `ITEM_NOT_PUBLISHABLE` y el allowlist `{in_stock, listed}`.

### 39.2 [SEC-N2 / BE-34] Atomicidad + idempotencia de `batchCreate`
- **Bug:** hacía `findUnique(batchKey)` → creaba ítems en loop → `InventoryBatch.create` al final. Dos
  requests concurrentes con el mismo `batchKey` pasaban ambos el `findUnique` nulo y **duplicaban** piezas;
  un crash a mitad dejaba ítems huérfanos sin `InventoryBatch` y el replay los **recreaba**.
- **Fix:** el lote completo (claim del `InventoryBatch` + N `InventoryItem` + movimientos + resultado) corre
  en **una `$transaction`**. El **claim `inventoryBatch.create({ id: batchKey })` va PRIMERO** dentro de la
  tx; su **unique constraint** (`id = batchKey`) es la guardia:
  - **Concurrencia:** dos requests → uno commitea; el otro choca con **P2002** en el claim → se detecta por
    `(e as {code}).code === 'P2002'`, se re-lee el batch ganador y se devuelve como **replay**
    (`idempotentReplay:true`) → **no duplica inventario**. (Carrera extrema sin resultado visible aún →
    `409 CONFLICT` "retry".)
  - **Crash-safety:** un crash a mitad hace **rollback** del claim y de los ítems (sin huérfanos); el replay
    re-hace el lote limpio.
  - El claim se crea con `resultJson` placeholder y se **finaliza** con `inventoryBatch.update` al final de
    la tx (auditoría del lote intacta). Los ítems se crean con el **cliente `tx`**; las lecturas/escala de
    pendientes de `resolveCreation` siguen en `this.prisma` (reads consistentes; la escala a
    `PendingPriceEntry` es auxiliar/advisory).
- El fast-path `findUnique` inicial sigue sirviendo el **replay secuencial** (las filas no committeadas de
  una corrida en vuelo no son visibles bajo READ COMMITTED, así que nunca ve un claim a medias).

### 39.3 [SEC-N1 · Media DoS] `qty` con `@Max`
- `BatchInventoryItemInput.qty` tenía `@Min(1)` sin tope → un `vault_operator` podía mandar `qty` gigante y
  `nextFolios` ejecuta `generate_series(1, qty)` → DoS de BD. Añadido `@Max(MAX_BATCH_QTY)` con
  `MAX_BATCH_QTY = 500` (holgado para bulk raw/sellado real). Sobre el tope → `400 VALIDATION_ERROR`.

### 39.4 [SEC-N3 · Baja] `listPriceCents` con `@Max`
- `listPriceCents` era `@Min(0)` sin tope en `CreateItemDto`, `UpdateItemDto`, `BatchInventoryItemInput` y
  `BulkPublishLineInput` (dinero en Int 32-bit, deuda B-3). Añadido `@Max(MAX_LIST_PRICE_CENTS)` con
  `MAX_LIST_PRICE_CENTS = 100_000_000` (= MX$1,000,000/pieza, muy por debajo de 2^31; margen de sobra para el
  slab más caro). Sobre el tope → `400 VALIDATION_ERROR`. Ambas constantes exportadas desde
  `dto/inventory.dto.ts`.

### 39.5 Tests (todos en `test/inventory.batch.spec.ts`)
- **bulk-publish double-sell:** OMITE con `ITEM_NOT_PUBLISHABLE` piezas en `reserved`, `lost`, `damaged`,
  `in_custody`, `shipped`, `withdrawn` (sin llamar `inventoryItem.update`); **no-op idempotente** en `listed`
  (ok:true, no tumba el lote).
- **batch atomicidad/idempotencia:** claim + items en **1 `$transaction`**; **concurrencia** (P2002 en el
  claim) → replay sin crear piezas; replay secuencial sin re-crear.
- **DTOs:** `qty > 500` → error de validación; `listPriceCents > MAX` → error (en `BatchInventoryItemInput` y
  `BulkPublishLineInput`); límites exactos aceptados.

### 39.6 Archivos tocados
- `src/common/error-codes.ts` (nuevo `ITEM_NOT_PUBLISHABLE`).
- `src/modules/inventory/inventory.service.ts` (allowlist de origen en `bulkPublish`; `batchCreate` con
  claim-first en `$transaction` + `replayBatch`).
- `src/modules/inventory/dto/inventory.dto.ts` (`@Max` en `qty`/`listPriceCents`; constantes
  `MAX_BATCH_QTY`/`MAX_LIST_PRICE_CENTS`).
- `test/inventory.batch.spec.ts` (mock con `$transaction`/`inventoryBatch.update`/P2002; tests nuevos).

## 40. Limpieza de dos veredictos (2026-08-17) — throttle del cotizador público + `isSecretRare` v1.16.1

Pase pequeño de cierre de dos hallazgos ya señalados. No cambia el contrato; toca `backend/` + docs.

### 40.1 [B-C1 · seguridad] `@Throttle` dedicado en el cotizador público de buylist
- **Qué:** `POST /buylist/quote` y `POST /buylist/quote/batch` (ambos `@Public`/anónimos) dependían solo del
  throttler **global** (300/min). El batch amplifica hasta **50×** el trabajo por request → amplificación DoS
  anónima. Se añadió `@Throttle` propio, alineado con el patrón de los controllers públicos hermanos
  (`buylist-catalog.controller.ts` usa `@Throttle({ default: { ttl: 60_000, limit: 60 } })`).
- **Límites elegidos:**
  - `POST /buylist/quote` → **60/min** por IP (igual que `buylist-catalog`).
  - `POST /buylist/quote/batch` → **12/min** por IP (más estricto). Racional: 12 req/min × 50 ítems ≈ el mismo
    techo de cotizaciones/min que 60/min del quote por-carta, así que cierra la amplificación sin penalizar el
    uso legítimo (el batch existe justamente para mandar N cartas en 1 request).
- **Archivos:** `src/modules/buylist/buylist.controller.ts` (import `Throttle`, decorador en los 2 métodos).
- **Test:** `test/buylist.quote-throttle.spec.ts` — lee la metadata `THROTTLER:LIMITdefault`/`THROTTLER:TTLdefault`
  (mismo patrón que `test/auth.throttle.spec.ts`): quote=60/60s, batch=12/60s, y batch < quote.

### 40.2 [BE-36] `isSecretRare` alineado al contrato §M1 v1.16.1 / ARCHITECTURE §4.17a
- **Qué:** en `master-set.service.ts` el flag era `printedTotal != null && parts.numberSort > printedTotal`.
  Como los promos/subsets (`TG`/`GG`/`SV`) reciben `numberSort = PROMO_SORT_BASE + n` (clave "al final",
  §38.4), su `numberSort` **siempre** superaba `printedTotal` → **todos** salían `isSecretRare: true`.
- **Definición reconciliada (heurística de DISPLAY):** `true` **solo** para numeración PRINCIPAL (número
  **puramente numérico**, sin prefijo alfabético) con entero `> printedTotal`; promos/subsets con **prefijo**
  → `false`; `printedTotal` nulo → `false`.
- **Fix:** `printedTotal != null && parts.prefix === '' && parts.num > printedTotal` (para un número puro
  `deriveNumberParts` da `prefix === ''` y `num` = el entero; para `TG12`, `prefix === 'TG'`).
- **Archivos:** `src/modules/inventory/master-set.service.ts` (línea del `map` del binder).
- **Test:** `test/master-set.service.spec.ts` — `c200` (200 > 191) → `true`; `TG12` (prefijo) → `false`;
  `c10` (dentro del total) → `false`.
- **BE-36 cerrada** en `docs/TECH_DEBT.md`.

### 40.3 Deuda no-bloqueante registrada (docs/TECH_DEBT.md)
- **BE-37** — `nextFolios`/`escalatePending` corren fuera de `$transaction` (huecos de folio en rollback /
  escalación huérfana; benigno, del re-chequeo de QA).
- **BE-38** — `batchQuote` resuelve `getReference` por-ítem (hasta 50 lecturas); reusable con el
  `getReferencesBatch` existente (par de BE-35/BE-4).
- **Nota al arquitecto** (no implementada): `AdminBuylistDTO §M5` podría exponer `userName` para evitar el
  fetch por-fila en M5.

### 40.4 Gates
- `npx tsc --noEmit` → 0 errores. `npx jest` → **73 suites / 516 tests verdes** (incluye los 2 tests nuevos/
  ajustados).

---

## 41. Ciclo de RETIRO visible para el cliente (WS-H / contrato v1.17-withdrawal-lifecycle)

Implementa la **Opción 1** del contrato v1.17 (API_CONTRACT §3, §5, §M4, §9; ARCHITECTURE §3.3, §9 WD-1):
la carta retirada permanece "EN RETIRO" en la bóveda con RETIRAR deshabilitado, el retiro es rastreable por
etapa, y al llegar a `entregado` **sale de la bóveda**. **Aditivo, SIN migración** (reusa
`InventoryStatus.withdrawn`, `MovementReason.withdrawal` y la máquina `ShipmentStatus` existentes).

### 41.1 Fuente de verdad canónica (derivación, sin espejo)
El estado/etapa del retiro se **deriva del join** `InventoryItem → ShipmentItem → ShipmentRequest.status`.
El `InventoryItem.status` **NO se espeja por etapa**: permanece `in_custody` durante
`solicitado→picking→guia→enviado`. La **única escritura persistente** del ciclo es la transición terminal en
`entregado` (`in_custody → withdrawn`). Hay a lo más **un** envío activo por item (garantizado por
`409 ITEM_IN_ANOTHER_SHIPMENT`).

### 41.2 `GET /vault/holdings` — nuevos campos derivados (`vault.service.ts`)
- **Query:** `ownerType='customer' AND ownerUserId=:me AND status != 'withdrawn'`. Los `withdrawn`
  (entregados) NO se listan ni cuentan; los items con envío activo SÍ se listan y SÍ cuentan.
- **Join eficiente (sin N+1):** UNA sola consulta batch a `shipmentItem.findMany` con
  `inventoryItemId IN (ids)` y `shipmentRequest.status IN (solicitado,picking,guia,enviado)`; se construye un
  `Map<inventoryItemId, {shipmentId, state}>`. Si no hay items, no se consulta el join.
- **Campos por holding:** `shipmentState: ShipmentActiveStage|null` (etapa del envío activo),
  `activeShipmentId: string|null` (deep-link a `GET /shipments/:id`), `withdrawable: boolean` =
  `ownershipStatus==='settled' && status==='in_custody' && shipmentState===null` (flag autoritativo
  anti doble-retiro). Ver §41.9 (alineación read=write, v1.17.1).
- Constante `ACTIVE_SHIPMENT_STAGES` en el módulo (subconjunto activo del enum `ShipmentStatus`).

### 41.3 Portafolio / snapshot coherentes
- `costBasisCents` y el job `portfolio-snapshot` (`jobs/portfolio-snapshot.service.ts`) aplican la **misma**
  exclusión `status != 'withdrawn'`. Como el snapshot reusa `VaultService.holdings()`, el valor histórico y
  el valor en vivo quedan alineados (los entregados dejan de contar en ambos).

### 41.4 Rastreo del cliente — `GET /shipments` (listMine) y `GET /shipments/:id` (`shipments.service.ts`)
- `toClientShipment` ahora enriquece `items[]` a `ClientShipmentItemDTO`:
  `{ inventoryItemId, folio, finish, card:{ id, name, setName, number, imageSmallUrl } }` (helper
  `toClientShipmentItem`, tipo `EnrichedShipmentItem`). `listMine`/`getMine` incluyen
  `items.inventoryItem.card.set`. Envelope `{ data }` (sin paginar) para listMine.
- Sigue siendo **allowlist** de campos de cliente (SEC-C1): NO expone `shippingCostCents` ni costos internos.
  Timestamps por etapa expuestos: `requestedAt/pickingAt/shippedAt/deliveredAt` (no existe `guiaAt` en el
  modelo; la etapa `guia` se refleja por `status` + `carrier/trackingNumber`). Scoping por `userId`/owner.

### 41.5 Transición terminal — `updateStatus` (`PATCH /admin/shipments/:id/status`)
- Al pasar a `entregado`, **dentro de `$transaction`**: por cada `InventoryItem` de los `ShipmentItem` del
  envío, `status: in_custody → withdrawn` (solo cambia `status`; **conserva** `ownerType='customer'`,
  `ownerUserId`, `ownershipStatus='settled'` — histórico intacto) + `InventoryMovement reason='withdrawal'`.
- **Idempotente:** un item ya `withdrawn` no duplica movimiento. Como `entregado` es terminal en la máquina,
  reintentar la transición da `409 CONFLICT` (doble candado). Las transiciones no terminales NO tocan el item.

### 41.6 Webhook (sin cambio, confirmado)
`payments.service.ts` sigue avanzando **solo** `ShipmentRequest solicitado→picking` en
`payment_intent.succeeded`, **sin tocar el item**. No se modificó.

### 41.7 Tests
- **Unit** (`npm test`): `test/vault.holdings-withdrawal.spec.ts` (exclusión de withdrawn, `shipmentState`/
  `activeShipmentId`/`withdrawable`, join batch de 1 consulta, pending no retirable, costBasis excluye
  withdrawn) y `test/shipments.client-tracking.spec.ts` (ClientShipmentDTO enriquecido sin `shippingCostCents`,
  scoping por usuario, transición terminal a `withdrawn` en transacción + idempotencia + no-op en etapas no
  terminales).
- **Integración/E2E** (`npm run test:integration`, corre QA con infra): nuevo describe en
  `test/integration/vault-shipments.e2e-spec.ts` que recorre `solicitado→picking→guia→enviado→entregado`,
  verifica EN RETIRO / no-retirable con envío activo, items enriquecidos, aislamiento entre usuarios, y la
  salida de la bóveda + caída del valor del portafolio tras entregar.

### 41.8 Gates
- `npm run typecheck` → **0 errores**.
- `npm test` (unit) → **75 suites / 530 tests verdes** (incluye los 2 specs nuevos de este WS).
- `npm run test:integration` → requiere Postgres/Redis/MinIO; **no se ejecutó en el entorno de desarrollo del
  agente** (sin Docker/DB). El spec añadido compila (incluido en `tsc`); QA lo ejecuta contra el stack.

### 41.9 Cierre WS-H (v1.17.1 §3) — el flag de LECTURA `withdrawable` alineado read=write (2026-08-17)
> Micro-pase tras el RECHAZO de QA por divergencia contrato-vs-código: el read de `withdrawable` en
> `vault.service.ts` omitía el chequeo `status==='in_custody'` que sí exige el contrato v1.17.1 §3 y el write
> (`classifyItems`, §42.1). Un item `settled` pero `lost`/`damaged` (sigue en la bóveda; solo `withdrawn` se
> excluye de la query) daba `withdrawable=true` por error. Solo se tocó `backend/`.
- **Fix (`vault.service.ts`, cómputo del HoldingDTO):**
  `withdrawable = ownershipStatus==='settled' && shipmentState===null`
  → `withdrawable = ownershipStatus==='settled' && status==='in_custody' && shipmentState===null`.
  El `status` ya estaba disponible en el item mapeado (no requiere query nueva).
- **Invariante read=write cerrada:** el criterio de LECTURA (`withdrawable`) queda **IDÉNTICO** al de ESCRITURA
  (`classifyItems`: `settled && status==='in_custody' && sin envío activo`) y al contrato §3/§5. La parte "sin
  envío activo" la aporta `shipmentState===null` (read) / el guard anti-doble-envío (write, §42.2).
- **Sin cambio de inclusión/exclusión de holdings:** la query sigue filtrando **solo** `status != 'withdrawn'`;
  los `lost`/`damaged` **siguen apareciendo** en la bóveda y contando en el portafolio, ahora con
  `withdrawable=false` (ya no ofrecen RETIRAR una carta en incidencia). Nota UX no bloqueante en `TECH_DEBT` BE-40.
- **Test añadido** (`test/vault.holdings-withdrawal.spec.ts`): un holding `settled` con `status='lost'` y otro
  `'damaged'`, sin envío → `withdrawable===false` pero **siguen listados** y contando en el portafolio (antes el
  read daba `true`). Specs existentes de holdings intactos y verdes.
- **Cosmético:** comentario de `shipments.service.ts` (guard SEC-H2) corregido de `BE-30` → `BE-42` (la deuda
  real del índice único parcial de `ShipmentItem`).
- **Gates de este micro-pase:** `typecheck` **0 errores**, `lint` **0 errores**, `npm test`
  **76 suites / 536 tests verdes** (+1 test nuevo).

## 42. Cierre WS-H · invariante de retiro (SEC-H1 / SEC-H2, triple veredicto — 2026-08-17)

> Pase de cierre tras el triple veredicto de WS-H. Cierra **SEC-H1** (techlead#1 / qa-IMPORTANTE: item
> `withdrawn` re-retirable, se re-cobraba envío por una carta ya entregada) y **SEC-H2** (techlead#3: TOCTOU de
> doble-envío concurrente). **Aditivo, SIN migración.** Alineado al contrato en actualización paralela v1.17.x
> (código de error `ITEM_NOT_IN_CUSTODY`/422 que el arquitecto añade a §5). Solo se tocó `backend/`.

### 42.1 FIX 1 (SEC-H1) — `classifyItems` exige `status === 'in_custody'` (criterio positivo)
- **Problema:** la transición terminal deja el item `status='withdrawn'` **conservando**
  `ownershipStatus='settled'` (histórico intacto, WD-1). `classifyItems` solo validaba `ownerUserId` +
  `ownershipStatus==='settled'` y **NO** excluía `status='withdrawn'`; el chequeo anti-doble-envío excluye
  envíos `entregado`. Resultado: un item ya entregado (fuera de la bóveda) pasaba ambos gates → se creaba una
  `ShipmentRequest` y se **cobraba envío por Stripe** de una carta ya retirada (doble-retiro).
- **Fix (`shipments.service.ts › classifyItems`):** tras el check de `settled`, se añade el criterio
  **POSITIVO** `item.status === 'in_custody'`; cualquier otro status (incl. `withdrawn`) → inelegible con razón
  `ITEM_NOT_IN_CUSTODY`. Así el criterio de **escritura** (creación de retiro) queda **IDÉNTICO** al flag de
  **lectura** `withdrawable` del HoldingDTO (`settled && status==='in_custody' && sin envío activo`): la parte
  "sin envío activo" la aporta el guard anti-doble-envío (§42.2).
- **Error/HTTP:** nuevo código estable **`ITEM_NOT_IN_CUSTODY`** en `common/error-codes.ts`, devuelto vía
  `BusinessException.validation(...)` → **HTTP 422**. En `create`, el mapeo de inelegibles prioriza
  `ITEM_NOT_SETTLED` → `ITEM_NOT_IN_CUSTODY` → `NOT_FOUND` (todos 422), con `details.ineligible`.

### 42.2 FIX 2 (SEC-H2) — guard transaccional SERIALIZABLE del anti-doble-envío + creación
- **Problema:** el `findFirst` de "envío activo" y la creación de `ShipmentRequest`/`ShipmentItem` iban
  **fuera** de transacción (y `ShipmentItem` no tiene unique en `inventoryItemId`) → dos `POST /shipments`
  concurrentes del mismo item podían pasar ambos el check y crear **dos** envíos + **dos** PaymentIntents.
- **Elección (sin migración):** envolví el **re-chequeo** (`tx.shipmentItem.findFirst`) **+** la creación
  (`tx.shipmentRequest.create`, con items) en **UN** `$transaction` con
  `isolationLevel: Prisma.TransactionIsolationLevel.Serializable` — **mismo patrón atómico** que ya usan el
  checkout (`orders.service`, reserva `updateMany`+`count===1`) y el tope AML de buylist (SEC-A2). Bajo
  SERIALIZABLE, dos transacciones que ambas leen "no hay envío activo" y ambas insertan producen un **conflicto
  de serialización** que aborta a una → nunca se crean dos envíos activos. **No** metí la llamada a Stripe
  (creación del PaymentIntent) dentro de la tx a propósito: sigue **después** (A2/BE-7), para no bloquear una
  conexión de DB en una llamada de red y conservar el rollback compensatorio (borra la `ShipmentRequest` si
  Stripe falla → cascada a items).
- **Índice único parcial NO aplicado (deuda `BE-42`):** el cinturón-y-tirantes a nivel BD (índice único parcial
  sobre `ShipmentItem.inventoryItemId` para envíos activos) **requiere migración** y se **difirió** por alcance;
  queda registrado en `TECH_DEBT.md` (**BE-42**, dueño backend, schema→arquitecto, **disparador DAST**). El guard
  serializable ya mitiga la carrera práctica.

### 42.3 Tests (obligatorio del encargo)
- **Nuevo** `test/shipments.withdraw-invariant.spec.ts` (6 casos): (a) `POST /shipments` con item `withdrawn`
  (settled preservado) → **`ITEM_NOT_IN_CUSTODY`/422**, sin tocar Stripe ni crear solicitud; (b) ciclo
  entregado→re-retiro falla (segundo intento rechazado); camino feliz (settled+in_custody) crea la solicitud
  **dentro** del `$transaction` serializable; (c) guard SEC-H2: primer envío OK, segundo secuencial ve el envío
  activo → **`ITEM_IN_ANOTHER_SHIPMENT`/409**, `shipmentRequest.create` llamado **una** sola vez y Stripe una
  sola vez; y un caso que asserta que el re-chequeo corre dentro de `$transaction`.
- **Actualizado** `test/shipments.rollback.spec.ts`: el mock del item ganó `status:'in_custody'` (antes sin
  status → ahora lo exige el gate) y se añadió `prisma.$transaction` al mock (ejecuta el callback con el propio
  cliente mock como `tx`). Mantiene verdes los 2 casos de rollback A2/BE-7.

### 42.4 Gates
- `npm run lint` → **0 errores**. `npm run typecheck` → **0 errores**.
- `npm test` (unit) → **76 suites / 535 tests verdes** (antes 75/530; +1 suite / +5 tests netos de este pase).
- `npm run test:integration` → requiere Postgres/Redis/MinIO; **no se ejecutó** en el entorno del agente (sin
  Docker/DB). Los specs unitarios nuevos corren sin infra (Prisma mockeado).

## 43. Auditoría de precios (2026-08-17) — por qué el catálogo vive en «Precio pendiente» en producción

Síntomas en prod (Railway, 1 réplica, worker BullMQ in-process): casi todas las cartas del cotizador/catálogo
sin precio; el set destacado «Pitch Black» suma ~MX$10 en total.

### 43.1 Causas raíz confirmadas (con evidencia de código)

**CR-1 (principal) — La conexión Redis del scheduler no era viable en Railway y fallaba EN SILENCIO.**
`SchedulerService.onModuleInit` creaba `new IORedis(url, { maxRetriesPerRequest: null })` **sin `family`**.
El private networking de Railway (`redis.railway.internal`) resuelve **solo IPv6 (AAAA)**; ioredis usa
`family: 4` (IPv4) **por default** → el lookup falla (ENOTFOUND/ETIMEDOUT) y el cliente **reintenta para
siempre**. Consecuencias encadenadas, todas invisibles:
- La conexión **no tenía listener `on('error')`** ni `on('ready')`: cero rastro en logs de que Redis nunca conectó.
- Los `await this.queue.add(...)` de los crons quedaban esperando en la **offline queue** de ioredis →
  `onModuleInit` **nunca resolvía** → Nest no llegaba a `app.listen()` → el healthcheck del deploy
  (`railway.json: /api/v1/health`, timeout 300s) moría. Con Railway conservando el deployment anterior
  sirviendo, el humano ve una app «funcionando» donde los crons jamás corren.
- Con los crons muertos, **NADA** escribe `PriceReference` de mercado: ni `price-ingest` (00:00/12:00 UTC),
  ni `set-price-sync` (06:30 UTC, el que precia el set destacado completo). Evidencia del MX$10: si el
  scheduler corriera, `set-price-sync` habría preciado las ~150-250 cartas de «Pitch Black»;
  `SetValueService.computeSetValue` **excluye del total las cartas sin precio** (diseño correcto, no inventa
  precios) → un total ridículo = solo 1-3 cartas con referencia (p. ej. overrides manuales del admin), o sea:
  la ingesta masiva **nunca corrió**.
- El fallo del worker sí tenía `on('failed')`, pero jamás llegaba un job al worker: el fallo era **antes** (conexión).

**CR-2 (agravante) — Sin catch-up: un cron perdido = catálogo sin precios hasta el siguiente cron.**
Aunque se arregle la conexión, un deploy a las 13:00 UTC no precia nada hasta las 00:00 UTC. No existía
ningún mecanismo de «si no hay ingesta reciente, ingesta ahora».

### 43.2 Hipótesis auditadas y DESCARTADAS
- **Switch del worker incompleto** — descartada: `scheduler.service.ts` enruta `price-ingest`,
  `price-ingest-1`, `price-ingest-2` (→ `run()`) y `price-ingest-set` (→ `runChild()`); el `default` loggea warn.
- **`onModuleInit` lanza y Nest se traga el error** — descartada como estaba escrito: no lanzaba; se **colgaba**
  (peor: ni stack trace). Ahora ni lanza ni cuelga (ver fix).
- **Dial `price_provider` sin sembrar** — descartada: `SettingsService.get` cae a `SETTING_DEFAULTS`
  (`settings.constants.ts: PRICE_PROVIDER → 'pokemontcg_io'`) si no hay fila, y `providerFor()` además tiene
  fallback explícito al provider legacy ante valor desconocido. Nunca queda sin provider.
- **FX ausente rompe el ingest** — descartada: `FxService.getCurrent()` tiene fallback duro `rate=18`.
- **Cobertura de pokemontcg.io** — *contribuyente menor, no causa raíz*: el provider bulk solo emite filas con
  `tcgplayer.prices[llave].market > 0` y llave mapeada; cartas/sets sin precios de TCGPlayer quedarán
  «pendiente» aunque el ingest corra (correcto, money-safe). No explica un catálogo *entero* vacío.
- **Rate limit** — *riesgo operativo, no causa raíz*: full ingest ≈ nº sets × 1-2 páginas (250/pág) ≈ cientos de
  requests, 2×/día. Con `POKEMONTCG_IO_API_KEY` (~20k/día) sobra; sin key el free tier (~30/min) provoca 429s;
  el cliente reintenta 4 veces respetando `Retry-After` y el provider devuelve lo acumulado con `logger.warn`
  (parcial, visible en logs, no borra precios). Verificar la key en Railway (ver 43.5).

### 43.3 Fix aplicado (archivos)
- **`backend/src/jobs/redis-connection.util.ts` (nuevo):** `resolveRedisFamily()` / `bullRedisOptions()` —
  `family: 0` (lookup dual-stack) por default; precedencia: env `REDIS_FAMILY` (0|4|6) > `?family=` en la
  REDIS_URL (se respeta, no se pisa) > default 0. Funciona igual en local/CI (IPv4) y Railway (IPv6-only).
- **`backend/src/jobs/scheduler.service.ts`:**
  - Conexión con `bullRedisOptions` + listeners `error` (con throttle 60s para no spamear; mensaje explícito
    «los crons NO corren hasta reconectar») y `ready`.
  - **Boot no bloqueante:** el wiring BullMQ corre en background (`setupDone`); un Redis caído ya no cuelga
    `app.listen()` ni mata el healthcheck. Cuando Redis conecta, los adds pendientes fluyen y el scheduler
    se activa solo. Un fallo del wiring se loggea como **error con stack** y la app sigue (jobs quedan en
    modo disparo manual).
  - Cola con `on('error')`; worker con `on('failed')` (ahora con id + nº de intento + stack), `on('error')`
    y `on('completed')` (heartbeat observable de que los crons corren).
  - **Catch-up al boot:** al terminar el wiring llama `priceIngest.catchUpIfStale()` (no fatal).
  - `onModuleDestroy` tolerante: closes en try/catch; `quit()` solo con conexión `ready`, si no `disconnect()`
    duro (antes un shutdown con Redis roto se colgaba).
- **`backend/src/jobs/price-ingest.service.ts`:** `catchUpIfStale()` — con cola y **sin** `PriceReference`
  no-manual de hoy/ayer, encola un `price-ingest` inmediato con `jobId=price-ingest-catchup-<día>` (dedup:
  reinicios múltiples el mismo día no duplican; el upsert de PriceReference ya es idempotente). Sin cola: no-op
  (no lanza el ingest secuencial pesado al boot en local/CI).
- **`backend/src/modules/pricing/price-ingest.service.ts`:** `hasRecentIngest()` (señal del catch-up;
  excluye `isManualOverride=true` — un precio manual del admin no cuenta como ingesta).
- **`backend/src/modules/health/health-redis.provider.ts`:** mismo `family` que el scheduler → en Railway
  `/api/v1/health` ahora reporta el estado REAL de Redis (antes daría `down` con Redis sano, o directamente
  no se podía consultar porque el boot se colgaba).
- Visibilidad del ingest: ya existía y es útil — resumen por set en `PriceIngestService.ingestForSet`
  (`price-ingest-set(<set>, <provider>): N cartas, N refs, N sin resolver, N omitidas`) + total del fan-out.
  Ahora además cada job loggea `completado`/`falló` desde el worker.

### 43.4 Tests y gates
- `test/scheduler.spec.ts` (+7 casos): family default/override/URL-passthrough, listeners de
  conexión/cola/worker, catch-up disparado, wiring fallido no revienta el boot, destroy con conexión no lista.
- `test/price-ingest.job.spec.ts` (+3): `catchUpIfStale` no-queue / recent / stale (jobId dedup por día).
- `test/price-ingest.service.spec.ts` (+2): `hasRecentIngest` (ventana ayer 00:00 UTC, excluye manuales).
- `test/health-redis.provider.spec.ts` (+2 y ctor actualizado con `family: 0`).
- Gates: `npm run lint` **0 errores** · `npm run typecheck` **0 errores** · `npm test` **76 suites / 553 tests
  verdes** (este pase añade **+14 tests** netos).

### 43.5 Runbook de verificación en producción (post-deploy)
1. **Logs de arranque (Railway):** deben aparecer, en orden:
   `Scheduler: conexión Redis lista (BullMQ operativo).` → `Scheduler activo (BullMQ): …` → y una de:
   `price-ingest catch-up: SIN ingesta de precios reciente → encolado price-ingest inmediato (jobId=…)` (primera
   vez) o `price-ingest catch-up: hay ingesta reciente…`. Si en cambio se ve
   `Scheduler: error de conexión Redis…` repetido cada ~60s → la URL/red sigue mal (ver ACCIÓN DEVOPS).
2. **Health:** `GET /api/v1/health` → Redis `up` (ya con `family` correcto es señal fiable).
3. **Progreso del ingest:** logs `price-ingest: encolados N sets (fan-out BullMQ).` y luego una línea
   `price-ingest-set(<setId>, pokemontcg_io): X cartas, Y refs, …` por set + `Job price-ingest-set (id=…) completado.`
4. **Disparo manual (si se quiere forzar sin esperar):** `POST /api/v1/admin/jobs/price-ingest` (super_admin,
   202). Con body `{"setId": "<externalId, p.ej. el de Pitch Black>"}` ingesta SOLO ese set inline (verificación
   rápida). Sin body: fan-out completo.
5. **Datos:** el cotizador/catálogo deja de mostrar «Precio pendiente» para cartas con precio TCGPlayer, y el
   total de «Pitch Black» sube a un valor plausible tras el snapshot (`set-value-snapshot` 07:15 UTC, o
   `POST /api/v1/admin/jobs/set-value-snapshot` manual tras `set-price-sync`/ingest).
6. Cartas que SIGAN en «pendiente» tras un ingest verde = sin `tcgplayer.prices.market>0` en la fuente
   (cobertura, esperado); se resuelven con override manual del admin o cambiando el dial `priceProvider`.

### 43.6 ACCIÓN DEVOPS REQUERIDA (no implementado por backend; zonas de devops)
1. **Verificar en Railway que `REDIS_URL` está en el SERVICIO del backend** (variable del service, no solo del
   entorno/proyecto) y apunta al Redis correcto. El síntoma histórico es 100% consistente con scheduler sin
   conexión Redis viable.
2. **`.env.example`:** documentar la nueva env OPCIONAL `REDIS_FAMILY` (`0` dual-stack default en código; `4`/`6`
   para forzar). No requiere valor en Railway: el default 0 ya cubre `redis.railway.internal` (IPv6-only).
   Alternativa equivalente: `REDIS_URL=...?family=0`.
3. **Verificar `POKEMONTCG_IO_API_KEY` en Railway** (recomendada en prod; sin ella el free tier ~30 req/min
   ralentiza el ingest y multiplica 429s). Opcional: pedir al arquitecto si debe ser env requerida no-local
   (`env.validation.ts` es zona compartida `src/config/` — backend no la tocó).
4. **Post-deploy:** correr el runbook 43.5; si el catch-up no aparece en logs, capturar el log de arranque
   completo para backend.

## 44. v1.19-sealed-tcgcsv (2026-08-17) — Referencia de mercado del SELLADO vía TCGCSV (§4.19, M-23)

Implementación del diseño v1.19 (ARCHITECTURE §4.19a–g, API_CONTRACT §0/§M1/§M2/§M10/§M10-ops). El precio
TCGCSV es SOLO referencia informativa: no publica, no fija `listPriceCents`, no encola `PendingPriceEntry`,
no toca el costo de aportación ni la superficie pública.

### 44.1 Qué hay (mapa de archivos)
- **M-23** — `prisma/schema.prisma` + `prisma/migrations/20260817140000_m23_sealed_tcgcsv/`: enum
  `PriceSource += tcgcsv` (`ALTER TYPE ... ADD VALUE`, aditivo), `InventoryItem.tcgplayerProductId Int?` +
  `tcgplayerGroupId Int?` (se fijan JUNTOS; solo sealed — regla de aplicación) e índice
  `@@index([tcgplayerProductId])`. **NO aplicada** (sin DB en este entorno); `prisma validate` y `generate`
  verdes. Sin backfill: la curación es manual post-deploy.
- **Tipos** — `modules/pricing/pricing.types.ts`: `SealedBulkPriceProvider` (interfaz NUEVA, keyeada por
  `tcgplayerProductId`; no se reusa `BulkPriceProvider`), `SealedPriceRow` (con `usedFallbackMid`),
  `TcgcsvGroupRef`/`TcgcsvProductRef`, `sealedMarketGradeKey(pid)` → `sealed:tcg:<pid>`. `PriceSourceStr`
  ganó `'tcgcsv'`. `buildGradeKey` NO cambió (`'sealed'` sigue siendo override manual/costo de aportación).
- **Adapter** — `modules/pricing/providers/tcgcsv-sealed.provider.ts` (`TcgcsvSealedBulkProvider`): host
  FIJO `https://tcgcsv.com` (anti-SSRF), categoría Pokémon=3 constante de servidor, `groupId` validado
  entero positivo ANTES de interpolar, sin API key, timeout 15s, `redirect:'error'`. Money-safe:
  `subTypeName≠'Normal'` u market inválido → OMITE; fallback `marketPrice→midPrice` con flag; el fetch de
  precios del ingest NUNCA lanza (devuelve lo acumulado + log; precios previos quedan STALE). El explorador
  (`listGroups`/`listSealedProducts`) SÍ lanza → el controller lo mapea a `502 UPSTREAM_ERROR`. Heurística
  de sellado: product SIN extendedData `Number`/`Rarity` (limpia la lista; no decide dinero).
- **Ingest** — `modules/pricing/sealed-price-ingest.service.ts` (`SealedPriceIngestService`): algoritmo
  normativo §4.19d (DISTINCT groupIds mapeados → precios por grupo → pares distintos
  `(anchorCardId, productId)` → upsert). Escritura vía **`PricingService.persistSealedMarketReference`**
  (método HERMANO de `persistMarketReference`, misma doctrina: upsert idempotente por día, respeta
  `isManualOverride`, no escala pendientes) con clave `(cardId, 'sealed', sealed:tcg:<pid>, 'normal', hoy)`,
  `source='tcgcsv'`, USD→MXN con FX+colchón y trazabilidad (`priceUsdCents`/`fxRate`/`fxBufferPct`).
- **Job** — `jobs/sealed-price-ingest.service.ts` (`SealedPriceIngestJobService`): secuencial AWAITED SIN
  fan-out (alcance minúsculo), single-flight en memoria (worker BullMQ y HTTP admin comparten proceso),
  FX UNA vez por corrida, fail-closed por dial (`off` → `{enqueued:false, reason:'SEALED_PRICE_SOURCE_OFF'}`
  ANTES de leer FX/red). Cableado en `scheduler.service.ts`: repeatable `sealed-price-ingest`, cron env
  **`SEALED_PRICE_INGEST_CRON`** (default `30 21 * * *` = 21:30 UTC, tras el refresh TCGCSV ~20:00 UTC y
  tras fx-refresh; horario final = devops) + case del worker (logging failed/completed heredado).
- **M2 (4 endpoints, super_admin)** — `modules/pricing/sealed-pricing.controller.ts` +
  `sealed-mapping.service.ts`: `GET /admin/pricing/sealed/unmapped` (cola DERIVADA
  `sealed AND tcgplayerProductId IS NULL`, asc por createdAt), `GET .../tcgcsv/groups` y
  `GET .../tcgcsv/groups/:groupId/products` (proxy read-only; `:groupId` no entero → 400; remoto caído →
  502 UPSTREAM_ERROR; `?q=` filtra server-side sobre name/cleanName), `PUT .../items/:itemId/mapping`
  (null desmapea y limpia groupId; con valor exige groupId; `applyToSiblings` copia SOLO a sealed sin mapeo
  del mismo `(cardId, sealedSubtype)` — nunca pisa; auditado `pricing.sealed_mapping.update` con
  before/after). La curación NO valida contra TCGCSV ni depende del dial.
- **M1 read-only** — `modules/inventory/inventory.service.ts`: listado y detalle de items sealed exponen
  `tcgplayerProductId`/`tcgplayerGroupId` (columnas fluyen solas) + `sealedMarketRef: PriceInfo|null`
  (null sin mapeo o sin ingest). En listados por LOTE vía `getReferencesBatch` (una query por página, sin
  N+1). `PATCH /admin/inventory/items/:id` IGNORA el mapeo (DTO whitelisted; solo el PUT de M2 lo edita).
- **M10-ops** — `jobs/admin-jobs.controller.ts`: `POST /admin/jobs/sealed-price-ingest` (202, super_admin,
  auditado `jobs.sealed_price_ingest.run`), body `{ groupId? }` entero ≥1 (2ª excepción de la familia).
- **Dial (cambio serializado AUTORIZADO en `settings`)** — `modules/settings/settings.constants.ts`:
  key `sealed_price_source`, seed **`off`** (fail-closed; el seed itera `SETTING_DEFAULTS`, así que se
  siembra solo), `SEALED_PRICE_SOURCE_VALUES=['tcgcsv','off']`, validador (422 si otro valor), DTO
  `sealedPriceSource` en §M10. Patrón EXACTO de `price_provider`. Nada más se tocó en ese módulo.

### 44.2 Decisiones de implementación (no obvias del spec)
- **`sealedMarketRef` pending → `null`:** el contrato §M1 dice "null si no mapeado o aún no hay ingest";
  no se expone un `PriceInfo{status:'pending'}` (a diferencia de `referenceValue` de holdings).
- **`UPSTREAM_ERROR` no está en `common/error-codes.ts`** (zona `src/common/` serializada a otro stream en
  esta ventana): se tipa por cast local en `sealed-pricing.controller.ts`. **Follow-up de 1 línea** cuando
  common/ esté libre: añadir `UPSTREAM_ERROR: 'UPSTREAM_ERROR'` a `ErrorCode`.
- **Single-flight en memoria** (no jobId BullMQ): el job corre inline en el worker/HTTP del MISMO proceso
  (sin fan-out), igual que la rama secuencial de `price-ingest`. Si algún día hay multi-instancia con
  worker separado, promover a dedup por jobId (sin cambio de contrato).
- **`applyToSiblings` con desmapeo (null) = no-op sobre terceros** (nunca desmapea en masa).
- **DTO del PUT mapping usa `@Allow()`** en `tcgplayerProductId` (el ValidationPipe global corre con
  `whitelist:true` y quitaría el campo); la validación fina (ausente≠null, enteros positivos, 422) vive en
  `SealedMappingService`/controller.

### 44.3 Fixtures y validación en STAGING (runbook para devops)
- **Fixtures** en `backend/test/fixtures/tcgcsv/` (`groups.json`, `products-23821.json`,
  `prices-23821.json`, grupo Surging Sparks): formato **documentado** de TCGCSV (wrapper
  `{totalItems, success, errors, results[]}`; precios con `productId/lowPrice/midPrice/highPrice/
  marketPrice/directLowPrice/subTypeName`). El egress a tcgcsv.com está BLOQUEADO en este entorno (se
  intentó una descarga real: proxy 403), así que son verbatim del formato público documentado, NO payloads
  descargados — **la validación del esquema real es obligatoria en staging antes del flip del dial**.
- **Runbook (opera devops, §4.19f):** (1) deploy + `prisma migrate deploy` (M-23); (2) seed/verificar dial
  `sealedPriceSource=off` (GET /admin/settings); (3) mapear 1-2 items sellados reales vía M2
  (`tcgcsv/groups` → `.../products` → PUT mapping); (4) 1ª corrida acotada:
  `POST /api/v1/admin/jobs/sealed-price-ingest {"groupId": <grupo mapeado>}` — con el dial `off` responde
  `enqueued:false, reason:SEALED_PRICE_SOURCE_OFF`, así que para la corrida de VALIDACIÓN hay que flipear
  el dial a `tcgcsv` en staging primero (staging no es prod: inocuo); (5) inspeccionar logs
  (`fetchedRaw/skipped/usedFallbackMid/unmatched`) y `PriceReference` (`source=tcgcsv`,
  `gradeKey=sealed:tcg:<pid>`, USD y MXN coherentes con FX del día); (6) si el esquema real difiere de las
  fixtures → hallazgo a backend (ajustar adapter + fixtures); si cuadra → flip del dial en PROD.
  Rollback = dial `off` (los PriceReference escritos permanecen, inertes). Env nueva opcional para
  `.env.example` (zona devops): `SEALED_PRICE_INGEST_CRON`.

### 44.4 Tests (todos contra fixtures/mocks; sin red)
`test/tcgcsv-sealed.provider.spec.ts` (host fijo/anti-SSRF, parsing verbatim, heurística de sellado,
omisiones money-safe, fallback mid, fallo parcial sin borrar), `test/sealed-price-ingest.spec.ts`
(gradeKey, persist hermano + override manual, algoritmo por pares, FX una vez, dial off no-op,
single-flight, scope groupId), `test/pricing.sealed-mapping.spec.ts` (404/422, desmapeo, applyToSiblings,
roles super_admin, 400 groupId, 502 UPSTREAM_ERROR, auditoría before/after),
`test/inventory.sealed-market-ref.spec.ts` (M1 batch sin N+1 + dial), y actualizados
`scheduler.spec.ts`/`admin-jobs.controller.spec.ts`. Gates: `lint` + `typecheck` + `test` (82 suites,
633 tests) + `prisma validate/generate` — todo verde.

### 44.5 Cierre de hallazgos techlead v1.19 (2026-08-17)
- **T-1 (condición de merge) — RESUELTO.** `BuylistService.adminRejectedItems` devolvía la fila Prisma
  cruda en `card` (con la relación `set` anidada); el contrato §11 exige `card: CardDTO`
  (`setName`/`subtypes`/`availableFinishes` planos). Ahora proyecta con la canónica `toCardDTO`
  (exportada por `catalog.service.ts`; mismo patrón que `sealed-mapping.service.ts`) y el `include` trae
  `set: true`. `test/buylist.rejected-items.spec.ts` actualizado: fixture con fila Card realista y
  aserciones que CEMENTAN el shape CardDTO (`setName` plano, `set` crudo NO se propaga, `subtypes`,
  `availableFinishes`). `itemDTO` (~L470) NO se tocó — marcado por techlead como pre-existente para otro
  pase. Gates: lint/typecheck verdes; suite completa **82 suites / 633 tests** verde.
- **Deuda anotada en `docs/TECH_DEBT.md`** (sin cambio de código): nueva **BE-44** (cast local de
  `UPSTREAM_ERROR`; duplicación de ~35 líneas del upsert money-safe en `persistSealedMarketReference` →
  dirección `upsertDailyReference` común; heurística/fixtures TCGCSV pendientes de validar en staging con
  dial `off` como candado), **ampliación de BE-43** (buzón `soporte@tcgvaultmx.com` hardcodeado en
  `buylist-mail.templates.ts` vs env `DISPUTE_EVIDENCE_CONTACT` en disputes — dos fuentes de verdad) y
  **nota baja** familia BE-4/BE-25/BE-35 (clave del Map de `getReferencesBatch` reconstruida a mano en 6
  sitios → exportar `referenceKey(item)`).

---

## 45. WS «Inventario y vault» (v1.20-master-set-everywhere, 2026-08-17) — master set en TODAS partes + ajustes (M-24)

Implementa el contrato v1.20: el binder Master Set (v1.16, solo M1) se convierte en el **read model
único por scope** que sirve tres vistas con el MISMO shape — (i) M1 plataforma, (ii) admin viendo la
bóveda de un cliente, (iii) "Mi bóveda" del cliente — más `GET /admin/vaults` y el **ajuste por
levantamiento físico** con migración **M-24**. Todo ADITIVO sobre v1.16 (los endpoints M1 existentes
no cambian de forma; solo ganan campos). No toca dinero saliente.

### 45.1 `MasterSetService` parametrizado por scope (§4.20a)
- `index()/binder()` ganan `scope: MasterSetQueryScope = { kind:'platform' } | { kind:'user_vault', userId }`
  (default `platform` → los llamadores v1.16 no cambian) y `opts: { includeOwnerEmail?, includeBuyable? }`.
  El scope SOLO cambia el WHERE de la agregación (`ownerType='customer' AND ownerUserId=:userId` para
  bóveda, ambas titularidades `pending|settled`, mismo filtro `NOT_ON_HAND` de status); orden natural,
  `numberSort`, `isSecretRare` y el patrón sin-N+1 se reusan sin duplicar.
- **Completitud por VARIANTE (§4.20b):** universo por carta = `Card.availableFinishes` (vacío/null →
  `['normal']`, helper exportado `expectedFinishes`, orden del enum `Finish`). Por celda: `variants[]`
  (`{finish, count, covered, buyable?}`), `expectedVariantCount`, `coveredVariantCount`. En el índice:
  `catalogVariantCount` (Σ|availableFinishes| por set, 1 raw SQL sobre `Card`), `distinctVariantsOwned`
  y `variantCompletionPct`. **Drift**: una pieza cuyo finish quedó fuera del universo se ve en
  `countsByFinish`/`totalCount` pero NO cuenta en expected/covered (el CASE del raw SQL del índice y el
  filtro del binder lo excluyen del numerador) → nunca `covered > expected`.
- **Queries fijas:** índice = 4 (sets + `card.groupBy` + raw variantes de catálogo + raw agregación de
  piezas con `distinctVariants`); binder = 2 (+1 lote de buyables solo en la vista (iii)). En scope
  `user_vault` el índice filtra a sets con ≥1 pieza del usuario DESPUÉS de agregar (queries siguen fijas).
- **Omisiones por scope (regla dura):** el shape jamás lleva ubicación/costos/folios; `owner` solo en
  `user_vault` (`email` SOLO con `includeOwnerEmail`, vista (ii)); `buyable` SOLO con `includeBuyable`
  (vista (iii)). `resolveOwner` hace el 404 de usuario inexistente para las rutas admin.
- `MasterSetService` ahora inyecta `PricingService` (buyables); `InventoryModule` ya importaba
  `PricingModule`, sin ciclos nuevos.

### 45.2 Endpoints nuevos
- **`GET /vault/master-sets` y `GET /vault/master-sets/:setId`** (`VaultController`, módulo vault,
  guard de sesión existente): SIEMPRE `userId = req.user` (la vista (iii) jamás acepta un userId del
  request). Índice = solo sets con ≥1 pieza mía; binder = cualquier set del catálogo (los huecos son
  mis faltantes) con `buyable: {inventoryItemId, salePriceCents}|null` por variante faltante. Lectura
  pura, sin acciones.
- **`GET /admin/vaults`** (`AdminVaultsController` + `AdminVaultsService`, módulo vault,
  `@Roles(vault_operator, super_admin)`): clientes con bóveda (≥1 pieza). Valuación con la MISMA base
  del portafolio §3: `getReferencesBatch` en 1 lote (referencia por acabado); pendientes EXCLUIDOS del
  total y contados en `pendingPriceCount`. Sorts `value_desc` (default) | `pieces_desc` | `name_asc`;
  filtro `q` por nombre/email; paginado. 3 queries fijas (piezas de bóveda + users + lote de refs).
- **`GET /admin/vaults/:userId/master-sets[/:setId]`**: vista (ii) — mismo shape, `owner` CON email,
  SIN `buyable`, read-only. 404 usuario/set inexistente.
- **`POST /admin/inventory/adjustments`** (`InventoryController`, `vault_operator+`): motivo
  OBLIGATORIO `encontrada|perdida|danada|error_captura` (`InventoryAdjustmentRequestDto`; validación
  cruzada por reason en el servicio → 400). `encontrada` crea pieza(s) reusando `resolveCreation`/
  `buildItemData`/`nextFolios` del alta (acquisitionType default `aportacion_en_especie`, PRICE_PENDING
  con escalado en paridad con el alta; qty default 1, graded fuerza 1) → Res **201**; los otros tres
  operan UNA pieza existente con `note` obligatoria → Res **200**. Transiciones: perdida→`lost`,
  danada→`damaged`, error_captura→`withdrawn` (SIN semántica de pérdida; la distinción vive en
  `InventoryAdjustment.reason`). **Guardarraíl:** solo `ownerType=platform` con status ∈
  `{in_stock, listed}` → resto `422 ITEM_NOT_ADJUSTABLE` (código nuevo en `error-codes.ts`).
  **Registro triple:** fila(s) `InventoryAdjustment` + `InventoryMovement(reason=adjustment)` en UNA
  `$transaction` (servicio) + `AuditLog action=inventory.adjustment` con usuario/timestamp
  (controller, patrón M1). El ajuste JAMÁS pone `reserved`/`listed` ni crea órdenes (sin venta directa).

### 45.3 Migración M-24 (`20260817200000_m24_inventory_adjustment`)
- `enum AdjustmentReason`, valor `MovementReason.adjustment` (ALTER TYPE ADD VALUE, aditivo) y modelo
  `InventoryAdjustment` (uuid id, FK `inventoryItemId` onDelete Cascade — patrón `InventoryMovement` —,
  `reason/fromStatus/toStatus/actorUserId/note/createdAt`, índices por item/reason/createdAt). SQL
  escrito a mano (sin BD local corriendo) y VERIFICADO contra `prisma migrate diff --from-empty
  --to-schema-datamodel` (tabla/índices/FK/enums idénticos a lo que generaría Prisma). Sin backfill.
  NO se añadió valor a `InventoryStatus` (decisión §4.20e).

### 45.4 Decisiones/notas para otros roles
- **`adjustmentId` con qty>1 (`encontrada`) — RESUELTA por v1.20.1 (ver §45.7):** el arquitecto
  aclaró el contrato (v1.20.1-adjustments-clarify): `adjustmentIds: string[]` sustituye al singular
  (todas las filas M-24, alineadas 1:1 con `inventoryItemIds`/`folios`) y `batchKey?` da idempotencia
  a `encontrada`. Implementado en este stream; la nota original queda como histórico.
- **`GET /admin/vaults` valúa TODAS las piezas de bóveda** (1 findMany + 1 lote de refs) para poder
  ordenar globalmente por `value_desc` antes de paginar — mismo patrón que el índice master-set (sort
  global en memoria). A escala de decenas de miles de piezas convendría materializar (par de la fase 2
  `InventoryStockSummary`); hoy es O(1) queries y suficiente para el MVP.
- **`buyable`:** paridad con la ficha §4.9 — `listPriceCents` override gana; si no, derivado por
  reglas de venta (`computeSalePriceForRarity` + `getReferencesBatch`); precio no resoluble o ≤0 → esa
  pieza no es buyable. Solo `ownerType=platform AND status=listed`, cualquier productType.
- **Zonas compartidas tocadas (aditivo, autorizado por el stream):** `prisma/schema.prisma` (M-24 ya
  aprobada por el arquitecto) y `src/common/error-codes.ts` (+`ITEM_NOT_ADJUSTABLE`, exigido por §0).

### 45.5 Archivos
- `src/modules/inventory/master-set.service.ts` (scopes/variantes/buyable), `inventory.service.ts`
  (`adjust` + allowlist ajustable), `inventory.controller.ts` (POST adjustments + audit),
  `dto/inventory.dto.ts` (`AdjustmentFoundItemInput`, `InventoryAdjustmentRequestDto`).
- `src/modules/vault/vault.controller.ts` (rutas master-sets del cliente), `admin-vaults.service.ts`,
  `admin-vaults.controller.ts`, `vault.module.ts` (importa `InventoryModule`).
- `src/common/error-codes.ts`; `prisma/schema.prisma` + `prisma/migrations/20260817200000_m24_inventory_adjustment/`.
- Tests: `test/master-set.service.spec.ts` (actualizado: v1.16 intacto bajo scope default),
  `test/master-set.scopes.spec.ts`, `test/admin-vaults.spec.ts`, `test/inventory.adjustments.spec.ts`.

### 45.6 Gates
- `npx prisma generate` OK · `npm run typecheck` → 0 errores · `npm run lint` → 0 warnings ·
  `npm run build` OK · `npx jest` → **76 suites / 563 tests verdes** (antes 73/516: 3 suites nuevas +
  1 actualizada, +47 tests de este WS). La suite de integración (`test:integration`) requiere la infra
  levantada (la corre QA con el stack).

### 45.7 Ronda final post-gates (v1.20.1-adjustments-clarify + pago BE-45/BE-46, 2026-08-17)
- **v1.20.1 en `POST /admin/inventory/adjustments`** (contrato §M1 / ARCHITECTURE §4.20e):
  - `InventoryAdjustmentResponse.adjustmentIds: string[]` **sustituye** al singular `adjustmentId`
    (eliminado sin deprecated): con `encontrada` y qty>1 se devuelven TODAS las filas M-24, alineadas
    1:1 con `inventoryItemIds`/`folios`; longitud 1 en los otros motivos. Se añade
    `idempotentReplay: boolean`. El AuditLog ancla `entityId` en el **primer** adjustmentId y lista
    todos en `after.adjustmentIds`.
  - **`batchKey?` SOLO con `encontrada`** (otro motivo → `400 VALIDATION_ERROR`, validado en
    `adjust()` antes del dispatch). Idempotencia con el MISMO mecanismo `InventoryBatch` (M-21) que
    `batchCreate`, **sin migración nueva** (`kind: 'adjust'`; solo se actualizó el comentario del
    campo en `schema.prisma`): fast-path replay si el batchKey ya está persistido; si no, **claim
    atómico primero** dentro de la `$transaction` (P2002 → replay del ganador / `409 CONFLICT` en la
    carrera extrema; crash → rollback de claim + piezas). El replay devuelve la **respuesta original
    guardada** (`resultJson`) con `idempotentReplay: true` y **HTTP 200** aunque la primera vez fuera
    201 (`res.status(... && !out.idempotentReplay ? 201 : 200)` en el controller). Si la validación
    (`PRICE_PENDING`, etc.) falla ANTES del claim, el batchKey NO queda quemado: el reintento procesa
    limpio. **Cierra BE-47** y la nota §45.4.
- **BE-45 PAGADA (guardia atómica de status, autorizada por techlead sin re-review):** en
  `adjustExisting` y en `bulkPublish` el paso de status dejó de ser un `update` incondicional tras el
  check en memoria; ahora es `updateMany({ where: { id, ownerType:'platform', status: { in:
  ADJUSTABLE_ORIGIN_STATUSES | PUBLISHABLE_ORIGIN_STATUSES } } })` + `count === 1`, y `count !== 1` →
  `422 ITEM_NOT_ADJUSTABLE` (rollback de la tx del ajuste) / `ITEM_NOT_PUBLISHABLE` por-línea. Cierra
  el TOCTOU: una pieza que un checkout reservó entre lectura y escritura ya no puede ser pisada ni
  re-listada (anti double-sell). El pre-check en memoria queda como validación de mensajes amables.
- **BE-46 PAGADA:** el raw SQL de `aggregateInventoryBySet` ya no reescribe la lista on-hand a mano:
  interpola `ii.status::text NOT IN (${Prisma.join(NOT_ON_HAND)})` — una sola fuente de verdad con
  `scopeWhere`/`admin-vaults`.
- **Deuda anotada en `docs/TECH_DEBT.md`:** BE-45/BE-46 PAGADAS, BE-47 CERRADA; **BE-48** (DTO
  `AdjustmentFoundItemInput` copia de `BatchInventoryItemInput` → derivar base común), **BE-49**
  (`GET /admin/vaults` valúa todas las bóvedas por request + `getReferencesBatch` escala con el
  histórico de `PriceReference` + `gradeKeyFor` calculado dos veces; disparador: antes de staging con
  histórico real o miles de piezas), **BE-50** (índice master set `user_vault` agrega sobre el
  catálogo completo → acotar a los sets del usuario) abiertas no bloqueantes. Además, por
  trazabilidad, dos pendientes de **OTROS streams** detectados por QA (XS-1: `jwt-auth.guard.ts:37`
  responde 422 en vez de 401 `UNAUTHENTICATED`; XS-2: 5 fallos deterministas de integración por
  rate-limit login/B-C1 vs harness E2E → dial de throttle para entorno E2E). Este stream NO los tocó.
- **Tests/gates de esta ronda:** `test/inventory.adjustments.spec.ts` (respuesta plural; batchKey:
  replay idempotente + claim `kind:'adjust'` + carrera P2002 + batchKey con motivo ≠ encontrada →
  400 + fallo pre-claim no quema la key; carrera de status → 422 sin escritura) y
  `test/inventory.batch.spec.ts` (bulk-publish con guardia atómica + test de carrera count=0).
  `npm run typecheck` 0 errores · `npm run lint` 0 warnings · `npm run build` OK · `npx jest` →
  **76 suites / 572 tests verdes** (+9 sobre §45.6).

---

## 46. Desbloqueo del gate `backend-e2e` + 2 CVEs HIGH de dependencias (2026-08-18)

> Contexto: el release quedó bloqueado con el check suite en rojo (PR #4, runs 32080601928 /
> 32080601897). Devops cerró gitleaks y el Chromium del E2E de frontend; lo que quedaba era
> **de backend**: 4 tests de integración en 429 y un `afterAll` colgado, más 2 CVEs HIGH que sí
> son dependencias reales de la app. Nada de esto tocó el contrato.

### 46.1 `NODE_ENV=test` como ÚNICO relajo, centralizado y auditable (`src/config/test-env.ts`)

Nuevo módulo con tres funciones puras (`isTestEnv`, `isThrottlerDisabled`, `isSchedulerDisabled`).
**Regla dura:** ambas banderas exigen `NODE_ENV === 'test'` como AND obligatorio; **no existe env
var capaz de apagar el rate-limiting ni el scheduler en staging/producción**. Las envs
`E2E_ENABLE_THROTTLER` / `E2E_ENABLE_SCHEDULER` solo sirven para volver a ENCENDER la pieza dentro
de la propia suite. El candado está testeado (`test/test-env.spec.ts`: en `production`, `staging`,
`development`, `local` y sin `NODE_ENV` las funciones devuelven `false` aunque se pongan las envs).

### 46.2 Throttler: 4 tests en 429 (`auth-authz.e2e-spec.ts`) — **cierra XS-2**

- **Causa:** `POST /auth/login` está limitado a **5/min por IP** (SEC-C1) y el storage del throttler
  es in-memory: la suite hace ~10 logins desde 127.0.0.1 dentro del mismo minuto y del mismo proceso
  (`--runInBand`) → 429 `RATE_LIMITED` determinista, sin bug funcional detrás.
- **Fix:** `src/common/guards/app-throttler.guard.ts` — `AppThrottlerGuard extends ThrottlerGuard`
  con `shouldSkip()` que devuelve `true` solo si `isThrottlerDisabled()`. Se cablea en `app.module.ts`
  en lugar del `ThrottlerGuard` pelado. **A nivel de guard a propósito**: los límites sensibles son
  `@Throttle(...)` **por handler** (login/register 5/min, refresh 20/min, cotizador batch B-C1 12/min),
  así que relajar la config global del `ThrottlerModule` no habría servido de nada.
- **Los límites NO cambian** (global 300/min y todos los `@Throttle` siguen idénticos); en
  staging/producción —donde corre el DAST— el rate-limiting está intacto.
- **El control de seguridad sigue verificado punta a punta:** nueva
  `test/integration/auth-throttle.e2e-spec.ts` re-activa el throttler (`E2E_ENABLE_THROTTLER=true`),
  martillea `/auth/login` y exige **429 `RATE_LIMITED`** dentro del límite del minuto (y restaura la
  env en `afterAll` para no contagiar a las demás suites del proceso).
- Cierra **XS-2** de `docs/TECH_DEBT.md` (incluye el throttle B-C1 del cotizador batch, que caía por
  lo mismo).

### 46.3 Scheduler BullMQ: `afterAll` colgado 30 s + "Jest did not exit"

- **Causa (confirmada leyendo el wiring, ver limitación en 46.5):** cada harness E2E levanta el
  `AppModule` completo, así que **cada suite** arrancaba el `SchedulerService` contra el Redis real:
  crons repetibles + worker sobre la cola compartida `tcg-daily` y, desde el fix de la auditoría de
  precios (§43), un **catch-up de `price-ingest` al arranque** — que en la BD de E2E siempre se
  dispara, porque las `PriceReference` del seed sintético son `isManualOverride: true` y
  `hasRecentIngest()` las ignora. El worker se ponía a ingerir precios REALES contra pokemontcg.io y
  `worker.close()` (sin `force`) **espera a que termine el job en vuelo** → `h.close()` > 30 s y
  conexiones ioredis vivas al final del run.
- **Fix 1 (el que desbloquea CI):** el scheduler **no arranca bajo `NODE_ENV=test`** (log de aviso;
  `E2E_ENABLE_SCHEDULER=true` lo fuerza). Ninguna spec lo ejercita y sí aportaba indeterminismo,
  tráfico a una API externa y escrituras de fondo en la BD de test.
- **Fix 2 (bug REAL de producción, no solo de tests):** `onModuleDestroy` era propenso a colgarse y a
  dejar handles:
  - ahora **espera (acotado) a `setupDone`** antes de cerrar — el wiring corre en background desde §43,
    y si el destroy llegaba antes, la cola/worker se creaban **después** del cierre y nadie los cerraba;
  - un flag `destroying` aborta el wiring en curso (no se crea el worker si ya se está apagando);
  - `worker.close()`, `queue.close()` y `connection.quit()` tienen **plazo máximo**
    (`SCHEDULER_SHUTDOWN_TIMEOUT_MS`, default 10 s): vencido, se loggea y se continúa. Un
    `price-ingest` largo ya no puede colgar el apagado de un deploy (los jobs son idempotentes —
    upsert + jobId dedup— y BullMQ recupera el abandonado como *stalled*).
  - Nota técnica: `Worker.close(force)` de BullMQ **cachea la promesa** en la primera llamada, así que
    "reintentar con force" no funciona; por eso el plazo + seguir, en vez de un segundo `close(true)`.
- **Tests:** `test/scheduler.spec.ts` (+3): no arranca bajo `NODE_ENV=test`; un `worker.close()` que
  nunca resuelve **no** cuelga el destroy (y cola/conexión igual se cierran); un destroy durante el
  wiring **no** crea el worker.

### 46.4 Ruido de Postgres en los logs de CI (revisado: **no es un bug**)

Las dos violaciones de unicidad del log de Postgres son **esperadas** y las provoca la propia suite:
`User_email_key (customer@e2e.local)` viene del test que exige **409 `EMAIL_TAKEN`** al registrar un
email duplicado, y `ProcessedStripeEvent_pkey (evt_e2e_succeeded_fixed)` del test de **idempotencia**
del webhook (reentregar el mismo `event.id`). En ambos casos el código captura la violación y responde
lo que el contrato manda; no hay nada que arreglar.

### 46.5 CVEs HIGH: `glob` y `picomatch` (bump REAL, sin ignores de trivy)

| Librería | CVE | Antes | Ahora | De dónde venía |
|---|---|---|---|---|
| `glob` | CVE-2025-64756 (command injection) | 10.4.5 | **10.5.0** | `@nestjs/cli` (transitiva) |
| `picomatch` | CVE-2026-33671 (ReDoS extglob) | 4.0.1 | **4.0.5** | `@nestjs/cli` → `@angular-devkit/core` |

- Se usan **overrides acotados por rango** en `backend/package.json`: `"glob@^10": "^10.5.0"` y
  `"picomatch@^4": "^4.0.4"`. **A propósito no son overrides globales**: el árbol también tiene
  `glob@7.2.3` (jest/eslint) y `picomatch@2.3.2` (chokidar/micromatch/jest-util), que **no están
  afectados** (2.3.2 es justamente una de las versiones parchadas) y a los que empujar a 10.x/4.x
  rompería APIs incompatibles. `npm ls` confirma que **no queda ninguna versión vulnerable** en el árbol.
- Se retiró `overrides.tar` por **inefectivo**: `npm ls tar` sale vacío (ningún paquete del árbol
  depende de `tar`; el `tar` del CVE viejo venía dentro del npm empaquetado en la imagen, que devops ya
  eliminó del runtime). Un override que no aplica a nada solo da falsa sensación de cobertura. Los
  demás overrides (`multer`, `qs`, `express`, `body-parser`, `uuid`, `file-type`, `tmp`) **sí** aplican
  y se conservan.
- La imagen instala con `npm ci --include=dev` (conserva devDependencies a propósito, ver NOTA de
  `Dockerfile.backend`), así que el bump del lockfile es lo que llega al `app/node_modules` escaneado.

### 46.6 Verificación ejecutada (2026-08-18)

- `npm ci` limpio + `npm run test:integration` **contra Postgres 16 y Redis reales** (levantados
  local, sin docker): **6 suites / 47 tests verdes**, sin el aviso "Jest did not exit".
- `npm test` (unitarios): **86 suites / 701 tests verdes**. `npm run typecheck`, `npm run lint` y
  `npm run build`: OK.
- `npm ls glob` / `npm ls picomatch` tras `npm ci`: 10.5.0 y 4.0.5 (`overridden`), resto en versiones
  no afectadas.
- **NO verificado en este entorno (sin docker ni trivy):** el escaneo `trivy-image` real y el PUT
  contra MinIO del `infra-smoke` (se salta con aviso si no hay S3; en CI sí corre). La confirmación
  final de los 2 CVEs cerrados la da el job `trivy-image` de CI.

---

## 47. P-6 (2026-08-18) — El proveedor de PAGA no escribía ni un precio: el adapter llamaba al endpoint equivocado

**Síntoma:** con `price_provider=pokemonpricetracker`, la key en Railway y
`POKEMONPRICETRACKER_MARKET_FORMAT=usd_dollars`, `PriceReference` **no recibía ni una fila** y el
cotizador mostraba «Precio pendiente» en todo lo que cotiza por regla `pct`. Las cartas con importe
(MX$1.00 / MX$0.50) son **pisos fijos por rareza** de las reglas de buylist y **enmascaran** el
problema: no pasan por precio de mercado. Diagnóstico de devops en `DEVOPS_NOTES §23.9` / `P-6`.

### 47.1 Causa: endpoint y forma del request

El adapter hacía `POST /api/v1/cards/bulk-price` con cuerpo `{ set, limit, page }`. Ese endpoint
**existe**, pero su cuerpo documentado es una **lista explícita** `{ cardIds: ["base1-4", …] }`: no
acepta un filtro por set. El proveedor respondía 4xx → `throw` → lo capturaba el `catch` money-safe
→ **0 filas sin borrar nada** (correcto por diseño) → cero referencias de mercado. Eran exactamente
los tres `SUPUESTO (verificar 1ª corrida)` que el propio adapter dejó anotados.

**Ahora:** el barrido por set usa el endpoint de precios —
`GET /api/prices?setId=<CardSet.externalId>&limit=&page=` → `{ data, pagination }` — con el mismo
`Authorization: Bearer`. La paginación se calcula con el objeto `pagination` de la RESPUESTA
(`totalPages`, o `total`/`limit` **efectivos**, o `hasMore`), no con el heurístico «página
incompleta»: si el servidor capa el `limit` pedido, la cuenta de páginas sigue saliendo bien. El
`limit` pedido pasó de 250 a **1000** (el tope que documenta `/api/prices`; el de 100 es del bulk
por-lista). Cota dura de 40 páginas como anti-bucle, igual que antes.

**El modo por-lista (`{ cardIds }`) NO se implementó:** ningún flujo lo necesita (el ingest siempre
trabaja set por set) y construirlo desde la BD serían más requests y más frágil para el mismo
resultado. Queda documentado en el docblock del adapter por si algún día hace falta.

**Ruta no verificada en runtime (honestidad):** el egress del sandbox bloquea el dominio del
proveedor, así que la fuente sigue siendo su documentación pública. Como la doc alterna entre
`/api/prices` y `/api/v1/prices` según la página, el adapter **prueba ambas en orden** en el primer
request, memoriza la que respondió (`resolvedPath`, una sola vez por proceso) y deja en el log cuál
fue. Un 404/400 de la primera **no** aborta la corrida.

### 47.2 Mapeo (revisado aunque el endpoint fuera la causa)

| Campo del proveedor | Nuestro campo | Nota |
|---|---|---|
| `id` / `cardId` | `Card.externalId` | mismo namespace pokemontcg.io (`sv8-104`). Se quitaron `productId`/`_id` de los candidatos: son de otro namespace y jamás resolverían. |
| `cardNumber` | fallback `(set, number)` | **riesgo real confirmado**: nuestro `Card.number` viene de pokemontcg.io (`"104"`) y el proveedor puede publicar `"104/159"` o `"004"`. Ver 47.3. |
| `printing` | `Finish` | se lee ahora `printing` **primero** (es el campo documentado), luego `variant`/`finish`/`printingName`/`subTypeName`. Se quitó `condition`: es el estado (NM/LP), no el acabado — leerlo podía atribuir un precio a un acabado inventado. |
| `marketPrice` | `marketCents` | se lee `marketPrice` primero, luego `market`/`price`. La unidad la sigue fijando `POKEMONPRICETRACKER_MARKET_FORMAT` (fail-closed intacto). |
| `setId` | — | **nuevo guard money-safe**: si la entrada trae un `setId` distinto al del set que se está ingiriendo, se DESCARTA. Si el filtro del proveedor no se respetara, el fallback `(set, number)` habría atribuido el precio a la carta equivocada. |

Los acabados documentados mapean a nuestros canónicos con el mapa existente: `Normal`→`normal`,
`Reverse Holofoil`→`reverse_holo`, `Holofoil`→`holofoil`, `1st Edition Holofoil`→
`first_edition_holofoil`. `Unlimited` (y cualquier otro) **se OMITE**: no tiene enum propio y
atribuirlo a `normal` cotizaría de más al comprar. **Acabado AUSENTE también se omite** (no se
asume `normal`) — pero el resumen del log dice cuántas filas cayeron ahí y con qué ejemplo crudo,
que es lo que permite ampliar el mapa de alias si el proveedor usa otros nombres.

### 47.3 `cardNumber`: variantes de formato (`cardNumberVariants`)

`PriceIngestService.resolveCardId` sigue resolviendo primero por `externalId` y luego por el número
**EXACTO**. Solo si ambos fallan prueba las formas equivalentes (`pricing.types.cardNumberVariants`):
`"104/159"` → `"104"` (se corta el total del set) y relleno de ceros en ambos sentidos
(`"004"`↔`"4"`). Los alfanuméricos (`TG01`, `SV107`) no se tocan. Money-safe: la variante solo se
acepta si casa con **UNA** carta del set; si casan dos, se omite la fila y se loguea — nunca se
adivina a qué carta pertenece un precio.

### 47.4 Diagnóstico observable (lo que hay que buscar en los Deploy Logs)

Filtrando `PokemonPriceTracker` en Railway, los dos modos de falla ahora se distinguen sin acceso
al proveedor:

- **El request falló** → `EL REQUEST FALLÓ para el set <id>: HTTP <status> en <ruta> — cuerpo: <…>`.
  Trae status **y cuerpo** del error del proveedor (contrato 400 / ruta 404 / auth 401-403 / cuota
  429). Nunca se loguean la key ni los headers.
- **El request pasó pero no mapeó** → `El request PASÓ pero NADA mapeó → revisa los nombres de campo
  contra el ejemplo crudo: {…}`, además del resumen por set:
  `<N> entradas crudas → <M> filas mapeadas [x sin acabado reconocible, y sin market válido, z de
  otro set, w no-objeto]`.
- **Todo bien** → `GET /api/prices OK (set <id>, pág 1): <N> entradas, pagination={…}` + el resumen
  con `M > 0`, y aguas abajo el de siempre:
  `price-ingest-set(<set>, pokemonpricetracker): <cartas> cartas, <refs> refs, …`.

### 47.5 Tests

`test/price-ingest.provider.spec.ts` cubre con **fixtures del formato documentado** (no se puede
llamar al proveedor real desde el sandbox): request GET con `setId`/`Bearer` y sin cuerpo,
paginación multi-página con `limit` capado por el servidor, respuesta sin `pagination`, caída a la
ruta alterna ante 404, los cuatro acabados + `Unlimited` omitido, acabado ausente, `cardNumber`
`"104/159"`, entrada de otro set, `marketPrice<=0` y **4xx → 0 filas sin excepción**.
`test/price-ingest.service.spec.ts` cubre `cardNumberVariants` y la resolución por variantes
(exacto primero, ambigua → omitida). Suite backend completa: **86 suites / 718 tests** en verde,
más `lint` y `typecheck`.

### 47.6 Lo que NO se tocó

Reglas de buylist (`BUYLIST_PRICE_RULES` / `BUYLIST_PRICE_FALLBACK_PCT`), `.github/workflows/`,
dial `price_provider`, envs y cron: intactos. El candado fail-closed de moneda/unidad y el
comportamiento money-safe ante error (0 filas, precios previos **stale**, nunca borrados ni
estimados) siguen exactamente igual. Sin cambios en el contrato de API.

## 48. WS «Órdenes y dinero» — GUEST CHECKOUT (v1.21-guest-checkout, M-25, 2026-08-18)

> Implementa `API_CONTRACT §4-G` completa (§4-G.0–§4-G.11) y `ARCHITECTURE §4.21`.
> PROJECT §J / §J.1, criterios 45–56b. **Alcance tocado:** `modules/orders`, `modules/payments`,
> `modules/shipments`, `prisma/` (solo M-25) y dos adiciones en `common/`.

### 48.1 Qué se construyó (mapa rápido para QA / frontend)

| Superficie | Archivo | Nota |
|---|---|---|
| `POST /checkout/guest/quote` · `/session` · `POST /orders/guest/track` · `/resend-link` | `orders/guest-orders.controller.ts` | `@Public()` + `@Throttle` EXACTO del contrato (30/min, 5/h, 20/min, 3/h). |
| Lógica de los 4 endpoints + barrido T9 | `orders/guest-checkout.service.ts` | Incluye el mapeo `Order.status`+envío → `GuestOrderPublicStatus` y el `GuestOrderTrackingDTO`. |
| Enlace tokenizado (emitir/validar/rotar/revocar/selector) | `orders/order-access-token.service.ts` | Multi-uso, `revokedAt`, solo SHA-256 en BD. **Dos vidas** (checkout 120 min / seguimiento 90 d) por `ttlMs`, sin columna nueva (§4-G.7a). |
| Correo (plantilla LOCAL, sin tocar `mail/`) | `orders/mail/guest-order.templates.ts` + `orders/guest-order-mail.service.ts` | Inyecta el puerto global `MAIL_PORT`. |
| Reclamo (`GET /orders/claimable`, `POST /orders/claim`) | `orders/order-claim.service.ts` + rutas en `orders.controller.ts` | `@RequireEmailVerified()`; UPDATE condicional. |
| Reenvío de soporte (`POST /admin/orders/:id/tracking-link`) + campos M3 | `orders/admin-orders.controller.ts` | Auditado (`order.tracking_link.reissue`), no money-out. |
| Rechazo de sesión en `/checkout/guest/*` | `orders/guards/reject-authenticated.guard.ts` | `409 ALREADY_AUTHENTICATED`. |
| Rama `direct_ship` del webhook | `payments/payments.service.ts` (`settleDirectShipOrder`) | items → `picking`, crea `ShipmentRequest`, captura marca/last4, correo post-commit. |
| Ramificación terminal de M4 + `kind` en la cola | `shipments/shipments.service.ts` | `enviado` ⇒ `picking→shipped`; `entregado` ⇒ `shipped→delivered`. |
| Helpers de minimización | `orders/guest-privacy.ts` | `maskEmail`, `maskPostalCode`, `maskRecipientName`, `normalizeEmail`. |
| Constantes de servidor | `orders/guest-checkout.constants.ts` | 90d / 365d / 5 por día / 20 líneas / 60 min. **No son diales de M10.** |

**Zonas compartidas — solo adiciones:** `common/money.ts` gana `computeDirectShipBreakdown()` +
`DirectShipBreakdownDTO`; `common/error-codes.ts` gana los códigos nuevos. Nada existente se
modificó ni se reformateó (para no romper el merge de otras sesiones).

### 48.2 Migración M-25 aplicada (diff real)

`backend/prisma/migrations/20260818120000_m25_guest_checkout/migration.sql`. Verificada contra un
Postgres 16 real: `migrate deploy` + `migrate diff --exit-code` ⇒ **sin drift**.

- **Enum nuevo** `FulfillmentMode { vault | direct_ship }`.
- **`Order`**: `userId` → nullable; columnas nuevas `guestEmail`, `orderNumber @unique`,
  `fulfillmentMode @default(vault)`, `shippingAddressSnapshot`, `shippingFeeCents @default(0)`,
  `claimedAt`, `locale`, `paymentMethodBrand`, `paymentMethodLast4`; índice `@@index([guestEmail])`;
  relaciones `accessTokens`, `shipmentRequests`.
- **`ShipmentRequest`**: `userId` → nullable; `orderId?` + FK + `@@index([orderId])`.
- **Modelo nuevo `OrderAccessToken`** (tal cual §4-G.10).
- **Secuencia `order_number_seq`** + backfill de `orderNumber` por `createdAt` dentro de la migración.
- **4 CHECK** de invariantes (probados uno por uno contra Postgres: los tres pedidos mal formados
  son rechazados y el `UPDATE` que dejaría `claimedAt` sin `userId` también).

**Desviación consciente y necesaria (reportada al arquitecto):** las relaciones `Order.user`,
`ShipmentRequest.user` y `ShipmentRequest.order` se declaran **`onDelete: Restrict` explícito**. Al
volver opcional una relación, el default de Prisma pasa a `SET NULL`, y con `SET NULL` un borrado
duro de usuario **huerfanaría** sus pedidos y **rompería** el CHECK
`claimedAt IS NOT NULL ⇒ userId IS NOT NULL` (lo reprodujo el E2E). Con `Restrict` se conserva
exactamente el comportamiento previo a M-25. **La migración NO recrea esas FKs**: quedan como estaban.

### 48.3 Decisiones de implementación que otros roles deben conocer

1. **`orderNumber` se escribe en TODOS los pedidos nuevos**, también en los de bóveda
   (`POST /checkout/session`). La secuencia se reserva **antes** de la transacción (`nextval` no es
   transaccional): un hueco es inocuo, un duplicado no. No hay `PrismaService.nextOrderNumber()`
   porque `src/prisma/` es zona de otro stream: la consulta vive en `OrdersService`.
2. **El precio del invitado sale de la MISMA función** que el del comprador con cuenta
   (`OrdersService.priceCartForOrder`, extraída de `quote`/`createSession`). No hay tabla de precios
   paralela: comprar como invitado no cambia condiciones comerciales (criterio 48b).
3. **El envío del `ShipmentRequest` de invitado va en `0`** a propósito. El ingreso vive en
   `Order.shippingFeeCents`. **M7 (módulo `admin`, OTRO work stream) debe corregir su fórmula**
   según §12; mientras no lo haga, el ingreso de envío de los pedidos de invitado **no aparece** en
   el P&L (no se duplica, se omite). *No se tocó `admin` por indicación explícita del orquestador.*
4. **Movimientos de inventario del ciclo de invitado:** `reserved→picking` con `reason='settle'`
   (mismo disparador que la ruta de bóveda) y `picking→shipped` / `shipped→delivered` con
   `reason='sale'`. **No se usa `withdrawal`**: significaría "salió de la bóveda de un cliente" y
   mentiría en los reportes de custodia. *El contrato no fija el `reason`; queda documentado aquí.*
5. **`GET /shipments` y `/shipments/:id`** ganaron una guardia explícita contra `userId` vacío,
   además del filtro positivo que ya tenían. Un envío `userId=null` no es de nadie (riesgo #1 de M-25).
6. **El correo es best-effort post-commit.** Si Resend falla, el pago NO se revierte y el webhook
   responde 200 (un 5xx haría que Stripe reintentara un settle ya aplicado).
7. **`RejectAuthenticatedGuard` deja pasar una sesión INVÁLIDA** (token expirado/firma mala/cuenta
   bloqueada): no hay sesión, luego es un invitado. Solo una sesión **válida** produce `409`.
8. **El correo se recorta (`trim`) antes de validar** el formato y se pasa a minúsculas al persistir.
   Un espacio pegado al copiar no puede bloquear una compra legítima.

### 48.4 v1.21.1 — resolución del arquitecto a los dos puntos que backend reportó

> Los dos huecos que backend detectó (regla 9) los resolvió el arquitecto en
> **`API_CONTRACT §4-G.7a`** / **`ARCHITECTURE §4.21e-bis` + amenaza T7b**. **Sin migración
> adicional: M-25 no cambia.** Esto es lo que quedó implementado.

**1. Las DOS VIDAS del token (§4-G.7a).** Se retiró el requisito irrealizable ("el mismo token se
envía por correo al liquidar"): con solo el SHA-256 en BD el claro **no es recuperable**, y esa
irrecuperabilidad es la propiedad de seguridad **T5**, no un defecto. Ahora hay **dos emisiones en
la misma tabla, sin columna nueva**, distinguidas **solo por `expiresAt`**:

| | Token de **checkout** | Token de **seguimiento** |
|---|---|---|
| Lo emite | `POST /checkout/guest/session` | webhook `payment_intent.succeeded`, reenvío (§4-G.4), soporte (§4-G.9b) |
| Se entrega | en la **respuesta HTTP** (campo **`checkoutToken`** + `checkoutTokenExpiresAt`) | **solo por correo** |
| TTL | **120 min** (`GUEST_CHECKOUT_TOKEN_TTL_MIN`) | **90 días** (`GUEST_TRACKING_TTL_DAYS`) |
| ¿Rota? | n/a (es el primero) | **NO en el settle** · **SÍ en reenvío/soporte** |

- **El campo de la respuesta se renombró `trackingToken` → `checkoutToken`** (+
  `checkoutTokenExpiresAt`). **Es contract-breaking para frontend**, ya avisado por el orquestador.
- **El settle NO rota** (excepción acotada: rotar mataría la confirmación post-3DS en curso) y es
  seguro porque la puerta que sobrevive se apaga sola en 2 h. **Reenvío y soporte SÍ rotan** y
  revocan *todos* los vivos —incluido cualquier `checkoutToken` residual—. **El reclamo revoca todo.**
- Resultado: el solapamiento de dos puertas sin contraseña baja de **90 días a ≤2 horas** (T7b).
- `issue()` acepta `ttlMs`; el default sigue siendo 90 días. **No hay `type` ni `purpose` en la
  tabla y no hace falta ninguna env nueva.**

**2. `details.reason` del `410 TOKEN_REVOKED`: se ELIMINA `SUPPORT`.** Valores normativos:
**`CLAIMED | ROTATED`**, derivados de forma literal — `order.claimedAt != null` ⇒ `CLAIMED`, en
cualquier otro caso ⇒ `ROTATED`. Una rotación de soporte se reporta como `ROTATED` (es lo que el
usuario necesita leer). **La trazabilidad forense no se pierde y está probada en la E2E:** el
reenvío de **soporte** escribe `AuditLog` (`order.tracking_link.reissue`, con actor y timestamp) y
el **self-service no escribe ninguno** — esa asimetría es la que distingue quién rotó.

**3. Selector del reenvío (§4-G.4) — verificado.** `POST /orders/guest/resend-link` con `{token}`
resuelve el pedido con **`OrderAccessTokenService.orderIdForSelector()`**, que busca **solo por
`tokenHash`, SIN filtrar por `expiresAt` ni `revokedAt`**. Es el caso normal: se llega desde la
pantalla de "enlace expirado" (o con un `checkoutToken` de 120 min ya vencido). *Identificar* el
pedido ≠ *leerlo*: la lectura (§4-G.3) sigue exigiendo un token vigente vía `validate()`.
Cubierto por tests unitarios (incluido uno que afirma que el `where` de la consulta tiene
**exactamente** la clave `tokenHash`) y por un caso E2E con un token realmente revocado.

**4. Ratificados sin cambio:** los `InventoryMovement.reason` (`settle` en `reserved→picking`,
`sale` en `picking→shipped` y `shipped→delivered`, **`withdrawal` prohibido**) y el conteo de
**8** códigos de error nuevos.

### 48.5 Job `guest-order-sweep` (T9) — CABLEADO (2026-08-18, ronda 2)

`backend/src/jobs/guest-order-sweep.service.ts`, registrado en `JobsModule` y en el
`SchedulerService`. Sigue el patrón standalone de `auth-token-sweep` / `buylist-sweep`: un `run()`
sin estado que **delega la regla de negocio** en `GuestCheckoutService.sweepStaleGuestOrders()`
(el dueño del ciclo del pedido de invitado) para no duplicar lógica en `jobs/`.

- **Qué hace:** libera las piezas (`reserved → listed`) de las órdenes de invitado `pending` con más
  de `GUEST_ORDER_RESERVATION_TTL_MIN` (**60 min**), marca la orden `failed` y cancela el
  PaymentIntent (best-effort).
- **Cadencia: cada 15 minutos, NO diaria** — a diferencia del resto de barridos. Una reserva de
  invitado sin pagar bloquea **piezas únicas**; con cron diario, una carta abandonada tras el 3DS
  quedaría invendible hasta el día siguiente.
- **Cron overridable por env: `GUEST_ORDER_SWEEP_CRON`** (default `*/15 * * * *`).
  ⚠️ **`.env.example` es de devops: la variable NO se añadió ahí.** Queda reportada al orquestador
  para que devops la documente/propague (el default ya es sensato, así que no bloquea el deploy).
  **Es la ÚNICA variable de entorno nueva de todo el guest checkout** (ver §48.5b).
- **Sin Redis no hay cron** (mismo gating que todos los jobs: `SchedulerService` se desactiva sin
  `REDIS_URL`). **No se expuso `POST /admin/jobs/guest-order-sweep`**: sería superficie de API nueva
  y el contrato no la contempla; si ops la quiere, pasa por el arquitecto.
- **Adición estrictamente localizada en `scheduler.service.ts`** (12 líneas, 0 borradas): import,
  parámetro de constructor **al final**, un `queue.add` junto a los demás barridos y un `case` en el
  worker. **No se tocó el bloque de pricing** (hay otra sesión trabajando ahí) ni el log-resumen del
  arranque, que por eso **no lista** `guest-order-sweep`; es cosmético (el job loguea cada corrida y
  el worker loguea `completed`) y se puede plegar cuando esa sesión cierre.
- **Nota menor:** el helper `repeat()` sufija el `jobId` con `-daily`, así que el id en Redis es
  `guest-order-sweep-daily` pese a correr cada 15 min. Es solo la clave de dedup (invisible para
  ops); no se modificó el helper para no tocar código compartido.

### 48.5b Handoff a devops — variables y constantes del guest checkout

**Variables de entorno (única lista; todo lo demás son constantes de servidor):**

| Variable | Default | Para qué | Dueño del archivo |
|---|---|---|---|
| `GUEST_ORDER_SWEEP_CRON` | `*/15 * * * *` | Cadencia del barrido T9 de reservas de invitado sin pagar. Sin `REDIS_URL` el scheduler está apagado y el job no corre. | devops (`.env.example`) — **no la añadí yo** |

**Constantes de servidor** (`backend/src/modules/orders/guest-checkout.constants.ts`; **NO son
diales de M10 ni envs**, mismo precedente que las ventanas 7d/30d del buylist):

| Constante | Valor | Nota |
|---|---|---|
| `GUEST_TRACKING_TTL_DAYS` | 90 | TTL del enlace que viaja por correo. |
| `GUEST_CHECKOUT_TOKEN_TTL_MIN` | **120** | v1.21.1 — TTL del `checkoutToken` de la respuesta del checkout. |
| `GUEST_TRACKING_MAX_AGE_DAYS` | 365 | Tope de edad del pedido para emitir enlaces nuevos. |
| `GUEST_RESEND_MAX_PER_DAY` | 5 | Tope de enlaces por pedido en 24 h. |
| `GUEST_MAX_ITEMS` | 20 | Máximo de líneas por pedido de invitado. |
| `GUEST_ORDER_RESERVATION_TTL_MIN` | 60 | Ventana de reserva que barre el job T9. |

La **tarifa de envío** NO es constante nueva: reusa el dial existente `SHIPPING_FEE_CENTS` (M10).
Promover cualquiera de estas constantes a `ConfigSetting` más adelante es **no-breaking**.

### 48.7 v1.21.2 — T1 (double-sell del contracargo), D4, D6 y el bloqueante B3 de QA

**T1 — el contracargo NUNCA re-lista una pieza con envío vivo.** `onChargeDispute` ramifica ahora
por `Order.fulfillmentMode` (switch exhaustivo que **lanza** ante un modo desconocido) y, en
`direct_ship`, decide **por el estado del envío**:

| Envío al llegar el contracargo | `ShipmentRequest` | `InventoryItem` | `chargebackNeedsManual` |
|---|---|---|---|
| no existe / `cancelado` | — | `reserved\|picking → listed` + `chargeback_return` | `false` |
| `solicitado\|picking\|guia` | **→ `cancelado`** (misma tx) | **CONGELADO** en `picking` | `true` |
| `enviado\|entregado` | sin cambio | sin cambio | `true` |

- **Desenlace humano nuevo:** `POST /admin/orders/:id/chargeback-inventory`
  (`recuperada | no_recuperada | reexpedir`, `note` obligatoria, `vault_operator+`, auditado, **no
  money-out**). Sin él la pieza congelada se quedaba congelada para siempre.
- **Ganar la disputa NO re-expide.** En `direct_ship` el flag `chargebackNeedsManual` **no se
  limpia** al cerrar la disputa (ni en `won` ni en `lost`): lo limpia solo el desenlace humano. En
  `vault` se conserva el comportamiento v1.21 (se limpia). *La extensión al caso `lost` la decidí
  yo por simetría —el contrato solo norma `won`—: limpiarlo dejaría la pieza congelada fuera de
  toda cola.*
- `recuperada` devuelve la pieza a `listed`, o a **`in_stock`** si su precio de venta no resuelve
  (en Compra nunca se publica una pieza sin precio).

**D4 — discriminador canónico.** `ShipmentRequest.orderId` responde solo "¿de dónde viene?"; el
**comportamiento** (transición terminal del item y `kind` de §M4) se resuelve leyendo
`Order.fulfillmentMode`. El switch **lanza** ante un modo no soportado y ante `vault` con
`orderId != null` (combinación imposible = corrupción de datos), en vez de asumir `direct_ship`.

**D6 — migración M-25b** (`backend/prisma/migrations/20260818160000_m25b_inventory_owner_check/`):
`InventoryItem CHECK (ownerType <> 'customer' OR ownerUserId IS NOT NULL)`. Es el quinto invariante
de §4-G.10, el que sostiene la nulabilidad de `Order.userId`. **`InventoryItem` es tabla del stream
«Inventario y vault» ⇒ el orquestador serializa.**
> **Precondición verificada contra Postgres real:**
> `SELECT count(*) FROM "InventoryItem" WHERE "ownerType"='customer' AND "ownerUserId" IS NULL` → **0**
> (antes de escribir la migración y de nuevo tras correr la suite E2E completa). **devops debe
> re-ejecutarla en staging/producción antes de aplicar**; si diera > 0, se corrige el dato primero.

**B3 (bloqueante de QA) — carrera barrido↔settle.** El orden estaba invertido: se liberaba el
inventario y **después** se intentaba cancelar el PaymentIntent, tragándose el fallo con un `warn`.
Un webhook `succeeded` tardío liquidaba la orden ⇒ **pedido pagado, envío en la cola del operador y
la misma pieza única otra vez comprable**. Tres arreglos:
1. **Cancelar el PI primero, liberar solo si quedó `canceled`.** `StripeService.cancelPaymentIntent`
   devuelve el `status`; si la cancelación falla, se consulta el PI: `canceled` ⇒ se libera
   (evita reservas atrapadas para siempre); `succeeded`/vivo/desconocido ⇒ **no se libera**.
2. **El fallo ya no se traga:** es `logger.error` y el pedido **no se barre en esa pasada** (se
   reintenta en la siguiente). El barrido reporta `swept` y cuántos se saltaron.
3. **La rama silenciosa del settle es ruidosa:** si una pieza no está `reserved` al liquidar, se
   **re-congela** en `picking` cuando sigue libre (el pago confirmado manda sobre una reserva
   liberada) y, si ya está comprometida con otro flujo, **no se le quita a nadie** — en ambos casos
   `logger.error` + `AuditLog` (`order.settle_inventory_anomaly`, con `needsHumanReview`).

**I2 (QA) — el bloque `payment` nunca había corrido en verde.** `TestStripeService` no sobrescribía
`getCardDetails`, así que salía a la red real y devolvía `null`. Ahora el doble devuelve una tarjeta
determinista y la E2E verifica que `paymentMethodBrand/Last4` se persisten al liquidar y que el
`GuestOrderTrackingDTO` expone `{brand, last4}` y nada más.

**Discrepancia detectada entre documentos (no la resolví yo):** ARCHITECTURE §4.21h (caso vi) pide
que `reexpedir` sobre una orden aún en `chargeback` devuelva **422**, mientras API_CONTRACT §M3 dice
**409 CONFLICT** para ese mismo caso. Implementé y testeé **409** (el contrato manda sobre el código
y §M3 es la especificación del endpoint). Reportado al orquestador.

### 48.8 T1-b + atomicidad del desenlace (ronda de rechazo del techlead)

**T1-b — la rama «envío cancelado» reabría el double-sell.** Mi `else` guardaba
`status: { in: ['reserved','picking'] }`, ampliando la fila 1 de la tabla normativa (que autoriza
**solo `reserved → listed`**), y mi docblock documentaba la ampliación como si fuera la norma.

- **Camino automático que lo disparaba:** la idempotencia del webhook es por `event.id`, así que una
  **segunda** `charge.dispute.created` (reapertura / segunda disputa) **no** se deduplica; encontraba
  el envío ya `cancelado`, caía en esa rama y re-listaba la pieza **congelada**, además de bajar
  `chargebackNeedsManual` a `false` — borrando la única señal de que faltaba una decisión humana.
- **Arreglado:** guardia `status: 'reserved'` exacta; una pieza en `picking` con envío cancelado
  **se queda congelada** y va al desenlace humano. Docblock corregido para **citar** la tabla, no
  reinterpretarla, y test reescrito para asertar el congelamiento (antes fijaba el comportamiento
  ampliado).
- **`chargebackNeedsManual` es MONÓTONO en el webhook:** solo sube a `true`, nunca baja (se escribe
  `undefined` cuando no hay nada que elevar). Bajarlo es competencia **exclusiva** de
  `resolveChargebackInventory`. Hay un test que recorre las cuatro ramas y verifica que el webhook
  **nunca** escribe `false`.

**Atomicidad del desenlace (mismo archivo, pagado en la misma pasada).**
`resolveChargebackInventory` leía `chargebackNeedsManual` **fuera** de la transacción y lo escribía
**dentro**: dos llamadas concurrentes (doble submit; el endpoint no lleva `Idempotency-Key`) pasaban
ambas, y `reexpedir` creaba **dos `ShipmentRequest`** para la misma orden — rompiendo «a lo más un
envío activo por orden» (§4-G.10) y duplicando la pieza en `pickingList()`. Ahora **todo** ocurre en
una transacción y la decisión se **reclama** con `updateMany(where: { chargebackNeedsManual: true })`
+ `count === 1` (el patrón de la casa, el mismo de `reserveItems`). El perdedor recibe `409`, que
**es** la regla de idempotencia de §M3. Y como la transacción revierte al lanzar, un desenlace
**rechazado** (p. ej. `reexpedir` sin disputa ganada) **no consume** la decisión: el flag vuelve a
`true`. Cubierto con un test de dos `reexpedir` concurrentes.

**`GET /admin/orders?needsManual=true` (§M3, aditivo).** Filtro opcional sobre el listado que ya
existía: sin el parámetro, misma forma de respuesta y mismo comportamiento. Es la **cola de
contracargos por resolver**; sin ella nadie sabría **cuándo** llamar a `chargeback-inventory` y la
pieza congelada se quedaría congelada para siempre. **La UI es del WS «Admin y auditoría»**; aquí
solo está el filtro porque `admin-orders.controller.ts` vive en este módulo.

**Regresión adoptada de QA.** El `TestStripeService` del harness devolvía **siempre** `canceled`, así
que por sí solo **nunca ejercitaba la rama peligrosa** de B3. Ahora tiene un `cancelOutcome`
guionizable (`canceled | throws-succeeded | throws-canceled | throws-unknown | requires_capture`) y
los casos **A1, A3 y C2** de QA viven en la suite E2E del repo, más las variantes «estado distinto de
canceled» y «PI ya cancelado ⇒ sí libera». También se añadió el caso T1-b contra Postgres real (una
segunda disputa no descongela la pieza ni baja el flag).

> **Nota de mocks:** dos dobles de `inventoryItem.updateMany` ignoraban la guardia **escalar**
> (`status: 'reserved'`) y solo honraban la forma `{ in: [...] }`, con lo que dejaban pasar
> exactamente el bug de T1-b. Corregidos para honrar ambas, como hace Prisma contra la fila real.

### 48.9 Regresión adoptada de QA + cierre del stream (última ronda: solo tests y docs)

**Suite nueva: `backend/test/integration/guest-chargeback.e2e-spec.ts` (11 casos).** Vive aparte de
`guest-checkout.e2e-spec.ts` porque cuenta otra historia: qué pasa cuando el dinero se da la vuelta.
Adopta como regresión permanente los hallazgos que QA cubrió y la suite del equipo no:

| Caso | Qué ancla |
|---|---|
| Disputa **PERDIDA** | El otro camino al «congelada para siempre»: `lost` **no** limpia `chargebackNeedsManual`, el pedido sigue en `?needsManual=true` y el desenlace humano funciona igual. |
| **Segunda y tercera** disputa | La idempotencia del webhook es por `event.id`: no filtra una reapertura. La pieza sigue `picking` y el flag en `true`. |
| **Monotonía** del flag | Un webhook que computa `false` no puede bajar un `true` ya puesto: solo el desenlace humano lo baja. |
| **Fila 1 legítima** | Ceñir la guardia a `reserved` no rompió el caso que la norma **sí** autoriza (pieza `reserved` sin envío ⇒ `listed` + `chargeback_return` + cierre automático). |
| Caso **i** | Congelar **no** deja ningún `InventoryMovement` (no pasó nada físico todavía). |
| Caso **v** por las **tres puertas** | `/checkout/guest/quote`, `/checkout/quote` y `/checkout/session` ⇒ `409 ITEM_UNAVAILABLE`, y la pieza fuera de la `picking-list`. El guardarraíl es el `status`, así que protege a las dos rutas de fulfillment por igual. |
| **Atomicidad** | Dos `reexpedir` concurrentes ⇒ `[200, 409]` y **un** envío activo; un desenlace rechazado **revierte el claim** y la decisión sigue pendiente. |
| `no_recuperada` | Cierra sin mover inventario ni marcar merma. |
| Filtro `?needsManual` | Partición exacta del listado; un valor no reconocido lo deja intacto. |
| Caso **viii** (D4) | `vault` con `orderId` ⇒ la transición terminal responde `409` y el helper lanza `Unsupported fulfillmentMode`, en vez de asumir envío directo. |

**BE-64 (QA) resuelta en esta ronda — flake latente, no regresión.** El caso «el envío aparece en la
cola de M4» buscaba su fila en un listado **paginado de 20** sin filtrar, así que empezaba a fallar
solo cuando la BD compartida acumulaba envíos (QA: 102/104 con 41 envíos, 103/104 tras recrear).
Ahora la consulta se acota (`status=picking&pageSize=100`). **Verificado corriendo la integración dos
veces seguidas sobre la misma BD acumulada** (40 envíos): 114/115 en ambas pasadas.

> **Lección del stream, para quien herede esto:** los tres bloqueantes (T1, T1-b, B3) sobrevivieron
> a los gates por la misma razón —**el instrumento estaba ciego**—, no por falta de tests:
> dos dobles de `inventoryItem.updateMany` ignoraban la guardia **escalar** (`status: 'reserved'`) y
> solo honraban `{ in: [...] }`, y `TestStripeService.cancelPaymentIntent` devolvía **siempre**
> `canceled`. Con esos dos dobles, un test podía pasar en verde afirmando justo lo contrario de lo
> que hacía el código. Antes de escribir el test de un bug de inventario o de dinero, **comprueba
> que el doble sabe fallar**.

### 48.6 Cómo probarlo

```bash
cd backend
npm test                    # 100 suites / 912 tests (incluye las 14 suites nuevas del guest checkout)
npm run test:integration    # 8 suites / 115 casos (requiere Postgres; `infra-smoke` exige S3/MinIO)
npm run lint && npm run typecheck
# E2E (requiere Postgres real):
DATABASE_URL=... APP_BASE_URL=http://localhost:3000 npm run test:integration
```

- **Suites E2E nuevas:** `test/integration/guest-checkout.e2e-spec.ts` (57 casos) y
  `test/integration/guest-chargeback.e2e-spec.ts` (11 casos, §48.9) — camino feliz de
  §J.1 completo (comprar → webhook → enlace → guía → enviado → entregado → reclamo) más los flujos
  negativos (token manipulado, token de otro pedido, reenvío neutro, doble reclamo, aislamiento de
  `GET /shipments`). Es **idempotente**: usa correos y folios propios por corrida
  (`E2E-GST-<run>-*`), porque deja `ShipmentItem` de un envío entregado y eso alteraría el
  contracargo de otra suite si reusara los folios compartidos del seed.
- **Suites unitarias nuevas:** `money.direct-ship`, `guest-order-token`, `guest-checkout.session`,
  `guest-checkout.tracking` (minimización + neutralidad + mapeo de estado), `guest-checkout.resend`,
  `guest-claim`, `payments.guest-settle`, `shipments.guest-direct-ship`, `guest-checkout.contract`,
  `guest-checkout.guard-sweep-mail`, `guest-order-sweep.job`.
- **El barrido T9 se probó contra Postgres real** (dos casos en la E2E): una orden de invitado
  envejecida a 90 min libera su pieza (`listed`, `ownerType=platform`), la orden queda `failed`, el
  PI se cancela y la carta se puede volver a cotizar; y el barrido **no toca** pedidos recientes ni
  liquidados.

## 49. WS «Catálogo y precios» + «Inventario y vault» — Variantes reales y orden natural del master set (v1.22-variantes-orden, M-26, 2026-08-18)

Implementa ARCHITECTURE §4.22 / API_CONTRACT v1.22 tal cual las cerró el arquitecto. Es la **tercera
ronda** del mismo bug del PO («una casilla de imagen por VARIANTE REAL, normal a la izquierda, holo
reverso a la derecha»): las dos rondas previas atacaron el render; la causa estaba en el dato y en
quién lo escribía.

### 49.1 Causa raíz y el arreglo (§4.22a)

`Card.availableFinishes` respondía *«¿en qué impresiones existe esta carta?»* (metadata de catálogo)
pero se escribía desde la ruta que responde *«¿cuánto vale hoy?»* (`price-ingest.service.ts:167-172`,
VAR-1): tras ingerir precios, **sobrescribía** el campo con los acabados que obtuvieron `market > 0`.
Una carta con reverse holo **sin precio** de reverse holo quedaba clobbeada a `['normal']` — una sola
casilla. Agravado por VAR-2 (`catalog-sync` solo miraba `tcgplayer.prices`, ignorando `cardmarket`),
VAR-3 (los seeds no seteaban el campo, así que el bug era invisible a cualquier E2E) y VAR-4 (los
sets importados antes de v1.6-finish nunca se refrescaban sin `force:true`).

**Norma aplicada — 5 reglas:**
1. **Autoridad única = `CatalogSyncService.upsertCards`.** Es el ÚNICO escritor de
   `Card.availableFinishes` en todo el sistema.
2. **`price-ingest` no escribe `availableFinishes`. Cero escrituras.** Se eliminó el bloque completo
   (el `card.update({ data: { availableFinishes } })` en `ingestForSet`), no se "amplió sin reducir":
   la unión monótona con un alias mal mapeado en `BULK_VARIANT_TO_FINISH` (todavía marcado *SUPUESTO
   — verificar 1ª corrida*) grabaría un acabado inexistente que el catálogo ya no podría limpiar.
3. **Derivación = unión de DOS señales del mismo payload** (`backend/src/modules/pricing/pricing.types.ts`,
   `deriveAvailableFinishes(remote): Finish[] | null`):
   - **Señal A** — `tcgplayer.prices`: cada **llave presente** (mapeable) añade su `Finish`. La
     presencia de la llave ES la señal; `market` puede ser `null`/`0`.
   - **Señal B** — `cardmarket.prices.reverseHolo*` (`reverseHoloSell|Low|Trend|Avg1|Avg7|Avg30`):
     añade `reverse_holo` si ALGUNO de esos campos es un número **finito > 0**. ⚠️ Asimetría
     deliberada con la señal A: Cardmarket emite esas llaves SIEMPRE (con `0`/`null` cuando la
     impresión no existe) ⇒ aquí la llave NO es señal, el VALOR sí. Tratarla como la A inventaría un
     reverse holo en TODAS las cartas — la casilla de relleno que el PO prohíbe.
   - Sin ninguna señal → **`null`** (≠ `['normal']`: significa «el payload no dice nada»).
4. **`upsertCards` (`catalog-sync.service.ts`):**
   - **CREATE** → `derived ?? ['normal']` (conservador, nunca relleno).
   - **UPDATE** → la clave `availableFinishes` se **omite del objeto `data`** cuando `derived ===
     null` (Prisma conserva el valor existente); se incluye y **puede reducir** cuando `derived !==
     null` (corrección legítima).
5. **Observabilidad, no adivinanza.** El sync loguea `cardsWithoutFinishSignal=N/M` por lote (WARN) y
   `price-ingest` loguea `finishNotInCatalog` cuando el proveedor de paga reporta un acabado que
   `Card.availableFinishes` no declara — el precio **sí** se persiste (el quote valida el finish
   contra el catálogo antes de leer precio; dato inocuo), el catálogo **no** se toca.

### 49.2 Orden natural persistido — M-26 (§4.22b)

`Card.number` es `String`; el `orderBy: [{name},{number}]` anterior ordenaba `"10"` antes de `"2"`.
Se descartó ordenar en memoria porque **`searchAllCards` pagina** (`skip`/`take`): ordenar después
del `LIMIT` reordena la página, no el conjunto (orden global incorrecto + filas repetidas/saltadas
entre páginas). Se eligieron **columnas persistidas**:

- `Card.numberSort Int @default(1000000)` / `Card.numberPrefix String @default("")` — migración
  `20260818180000_m26_card_number_order` (aditiva: dos `ADD COLUMN NOT NULL DEFAULT`, un backfill
  `UPDATE` con el mismo clamp a `999999` vía `numeric` que el código, y `CREATE INDEX
  "Card_setId_numberPrefix_numberSort_idx" ON "Card"("setId","numberPrefix","numberSort")`). El SQL
  es copia literal del que especificó el arquitecto en ARCHITECTURE §11.
- **Un solo algoritmo** en `backend/src/common/card-order.ts` (`deriveNumberParts`,
  `compareByNumber`, `FINISH_ORDER`, `orderFinishes`, `CARD_ORDER_BY_IN_SET`, `CARD_ORDER_BY_GLOBAL`):
  lo usan `upsertCards` (escribe las columnas), `CatalogService.searchAllCards`
  (`GET /buylist/cards`), `MasterSetService.binder` (ordena en BD, ya no en memoria) y los tres
  seeds. `master-set.service.ts` **re-exporta** estos símbolos por compatibilidad de imports (varios
  módulos/tests los importaban desde ahí).
- `orderBy` normativo: con `setId` → `[{numberPrefix},{numberSort},{number},{id}]`; sin `setId` →
  `[{name},{setId},{numberPrefix},{numberSort},{id}]`. El `{id:'asc'}` final es el desempate total
  que hace determinista la paginación (sin él, dos filas empatadas pueden intercambiarse entre dos
  consultas y producir filas repetidas/saltadas al cambiar de página).
- `MasterSetService.binder`: el `card.findMany` del binder ahora usa `orderBy: CARD_ORDER_BY_IN_SET`
  y lee `numberSort`/`numberPrefix` de la fila; se eliminó el `.sort(compareByNumber)` + `parts =
  deriveNumberParts(c.number)` en memoria. `isSecretRare` (heurística de display, BE-36) ahora lee
  `c.numberPrefix === ''` y `c.numberSort > printedTotal` directo de las columnas — misma semántica
  para números puros (donde `numberSort` ES el entero).
- `CardDTO` y `MasterSetCardCellDTO` ganan `numberSort`/`numberPrefix` (aditivo).

### 49.3 Archivos tocados

- **Nuevo** `backend/src/common/card-order.ts` — algoritmo único de orden (números + acabados).
- `backend/src/modules/pricing/pricing.types.ts` — `deriveAvailableFinishes` reescrita con la firma
  `(remote) => Finish[] | null`; nuevo `CARDMARKET_REVERSE_HOLO_KEYS` / `FinishSignalSource`.
- `backend/src/modules/catalog/pokemontcg-io.client.ts` — `RemoteCard.cardmarket?: { prices?:
  Record<string, unknown> | null }` (solo tipos: el JSON de `GET /v2/cards` ya venía completo sin
  `select=`, cero requests extra).
- `backend/src/modules/catalog/catalog-sync.service.ts` — `upsertCards` puebla
  `numberSort`/`numberPrefix` y aplica la regla CREATE/UPDATE de `availableFinishes`; log
  `cardsWithoutFinishSignal`.
- `backend/src/modules/pricing/price-ingest.service.ts` — eliminado el `card.update` de variantes;
  nueva lectura de solo-consulta del catálogo tocado (`card.findMany({ where: { id: { in: [...] } }
  })`) para loguear `finishNotInCatalog` cuando hay drift precio↔catálogo.
- `backend/src/modules/catalog/catalog.service.ts` — `toCardDTO` expone `numberSort`/`numberPrefix`;
  `searchAllCards` usa `CARD_ORDER_BY_IN_SET`/`CARD_ORDER_BY_GLOBAL` según haya o no `setId`.
- `backend/src/modules/inventory/master-set.service.ts` — binder ordena en BD, DTO
  `+= numberPrefix`, re-exporta el orden canónico desde `common/card-order.ts`.
- `backend/prisma/schema.prisma` + `backend/prisma/migrations/20260818180000_m26_card_number_order/` (M-26).
- `backend/prisma/seed.ts`, `backend/prisma/seed-e2e.ts`, `backend/prisma/e2e-fixtures.ts` — ver §49.4.
- Tests: `test/catalog-sync.finish.spec.ts` (tabla de verdad completa, reemplaza la suite v1.6-finish),
  `test/price-ingest.service.spec.ts` (cero escrituras + `finishNotInCatalog` + mocks de `findMany`
  ruteados por forma de `where`), `test/master-set.service.spec.ts` (mock ya ordenado + `orderBy`).

### 49.4 Seeds (§4.22e)

`E2E_CARDS`/`E2E_ORDER_CARDS` (`prisma/e2e-fixtures.ts`) ahora declaran `availableFinishes`
EXPLÍCITO en cada carta (nunca el `@default([normal])` del schema): **`reverse` (E2E Reverse Bird,
#17) nace en `['normal','reverse_holo']`** — la candidata obvia, antes sembrada en `{normal}` pese a
su nombre — y el resto en `['normal']` (probando que no se pinta relleno). Se añadió un **segundo
set sintético**, `E2E_ORDER_SET` (`e2e-order`), dedicado solo al orden natural: cartas `"2"`, `"10"`,
`"SV107"` y `"TG01"` sembradas fuera de orden (DOS prefijos de promo, para ejercitar la agrupación por
`numberPrefix`), con el oráculo `E2E_ORDER_EXPECTED_NUMBERS = ['2','10','SV107','TG01']` que consume el
test de integración de §49.9. Se
mantuvo separado de `E2E_SET` a propósito — meterle cartas nuevas a `E2E Base Set` cambiaría totales y
páginas ya cableados en `buylist.e2e-spec.ts`/`vault-shipments.e2e-spec.ts`/etc. `seed-e2e.ts` puebla
`numberSort`/`numberPrefix` con `deriveNumberParts` (la misma función del sync) tanto en `create`
como en `update` (idempotencia E2E-1: una 2ª corrida sobre una BD vieja corrige, no conserva, el bug).
`seed.ts` (dev/local) siembra el Charizard `base1-4` con `availableFinishes: ['holofoil']` (Rare Holo
pura del Base Set original, sin reverse holo/normal reales para esa impresión) y sus claves de orden.

### 49.5 Verificado contra Postgres local (migrate deploy + reseed + build + server real)

```
$ npx prisma migrate deploy   # aplica 20260818180000_m26_card_number_order
$ npm run seed && npm run seed:synthetic
$ npm run build && node dist/main.js   # :3011

$ curl "http://localhost:3011/api/v1/buylist/cards?setId=<e2e-base>&page=1&pageSize=50"
# data[].number en orden: 4, 16, 17, 20, 25, 99
# "E2E Reverse Bird" (#17) → availableFinishes: ["normal","reverse_holo"]

$ for p in 1 2 3; do curl ".../buylist/cards?setId=<e2e-base>&page=$p&pageSize=2"; done
# page=1 → [4,16]  page=2 → [17,20]  page=3 → [25,99]   (sin huecos ni duplicados)

$ curl "http://localhost:3011/api/v1/buylist/cards?setId=<e2e-order>&page=1&pageSize=50"
# data[].number en orden: 2, 10, SV107, TG01   (promos al final, agrupados por prefijo SV < TG)
```

```
npm run typecheck   # limpio
npm run lint        # limpio
npm test            # 100 suites / 940 tests, todo verde
npm run test:integration   # 8 suites / 115 casos — 114 verdes, 1 falla PRE-EXISTENTE
                            # y NO relacionada (infra-smoke.e2e-spec.ts, presign de MinIO
                            # devuelve 403 en vez de [200,204]; confirmado con `git stash`
                            # que falla igual ANTES de este cambio — es un asunto de
                            # infraestructura local de MinIO/S3, no de este WS).
```

### 49.6 Supuesto abierto, sin verificar (bloqueado por el proxy del sandbox)

El proxy de este entorno bloquea `api.pokemontcg.io` (403 en `CONNECT`), así que **no se pudo
verificar el payload remoto real** de pokemontcg.io v2. La derivación de §49.1 se implementó contra
el esquema DOCUMENTADO de la API y el código existente que ya lo consumía, con tres supuestos
explícitos (ARCHITECTURE §4.22f, tabla S1/S2/S3) que quedan **pendientes de la primera corrida real**:

- **S1** — que `tcgplayer.prices` solo trae la sub-llave de una impresión cuando esa impresión
  existe (i.e. que la llave es metadata real y no un slot fijo siempre presente). Si resulta falso,
  la señal A degenera y hay que apoyarse más en la señal B.
- **S2** — que `cardmarket.prices` expone `reverseHolo*` SIEMPRE (con `0`/`null` cuando no aplica).
  Si en realidad solo aparecen cuando existe la impresión, la señal B se **simplifica** (bastaría con
  "llave presente", igual que la A) — cambio de código menor, no rompe el contrato.
- **S3** — que el endpoint `GET /v2/cards?q=set.id:*` YA incluye `cardmarket` en el payload sin
  `select=` explícito (cero requests extra). Si resulta falso, hace falta un `select=` o una segunda
  llamada por carta — **avisar al arquitecto antes**, porque cambia el costo del sync.

**Acción recomendada para quien opere el próximo sync en Railway/staging con acceso real a
pokemontcg.io:** antes de lanzar `sync-all {force:true}` a gran escala, correr `sync` sobre UN set
moderno conocido (p. ej. `sv8`, Surging Sparks) y verificar en logs (a) cuántas cartas reportan
`cardsWithoutFinishSignal` (si es masivo, S1/S2 fallaron) y (b) hacer un `SELECT count(*) FROM "Card"
WHERE 'reverse_holo' = ANY("availableFinishes") AND "setId" = :set` — debe ser **> 0** para un set con
reverse holos conocidos. Documentar el resultado en `docs/DEVOPS_NOTES.md` (dueño: backend/devops,
ARCHITECTURE §4.22f).

### 49.7 Re-sync requerido en producción/staging (dueño: devops, con backend)

El código corregido **no repara solo** las filas ya escritas con el bug (`['normal']` grabado por
VAR-1/VAR-2/VAR-4). Secuencia exacta (ARCHITECTURE §4.22d):

1. Desplegar la migración **M-26** primero (aditiva, seguro con la app corriendo — nadie lee las
   columnas nuevas hasta que el código nuevo despliegue): `npx prisma migrate deploy`.
2. Desplegar el backend con este código (price-ingest sin escritura de variantes + derivación de dos
   señales + `numberSort`/`numberPrefix` poblados por el sync).
3. **Re-sync forzado del catálogo completo** — es el único camino que reprocesa sets ya importados y
   repuebla `availableFinishes` **y** las columnas de orden en un solo paso:
   ```
   POST /api/v1/admin/catalog/sync-all
   Authorization: Bearer <token super_admin>
   Content-Type: application/json

   { "force": true }
   ```
   Verificar progreso con `GET /api/v1/admin/catalog/sync-status`.
4. **Gate de verificación** sobre un set moderno conocido:
   ```sql
   SELECT count(*) FROM "Card"
   WHERE 'reverse_holo' = ANY("availableFinishes") AND "setId" = :set;
   -- debe ser > 0 (hoy da 0 en el set afectado)
   ```
   y en el binder, una común moderna debe mostrar **dos** casillas. Si sigue en `['normal']` masivo,
   el payload remoto no trae ninguna de las dos señales (S1/S2 de §49.6 fallaron) — abrir la pregunta
   con el arquitecto antes de tocar más código, NO inventar una heurística de relleno.

No hace falta ningún backfill SQL adicional de `availableFinishes`: la migración M-26 **no la toca**
(solo aditiva sobre `numberSort`/`numberPrefix`); el arreglo de variantes es enteramente código +
re-sync, tal como lo especifica ARCHITECTURE §4.22a/§4.22d.

### 49.8 Discrepancias / bloqueos para el arquitecto

**Corrección (2026-08-18, tras el rechazo del techlead):** la primera versión de esta sección
afirmaba «se implementó tal cual» y era **inexacta**: faltaba uno de los **tests obligatorios** del
reparto de trabajo de §4.22 — el de **orden paginado** de `GET /buylist/cards` («`["2","10","TG01",
"SV107"]` sale en ese orden atravesando dos páginas»). Se había verificado a mano con `curl`, pero
ninguna suite lo anclaba: el oráculo `E2E_ORDER_EXPECTED_NUMBERS` no tenía consumidores, el fixture
de orden no tenía `SV107` (con un solo prefijo la agrupación por `numberPrefix` no se ejercitaba) y
`buylist-catalog.spec.ts` no asertaba el `orderBy` (una regresión a `[{name},{number}]` — ORD-1 —
habría pasado verde). Resuelto en §49.9.

**Nit de doc para el arquitecto (no bloqueante):** la línea «Tests obligatorios» de §4.22 lista el
orden esperado como `["2","10","TG01","SV107"]`, pero el `orderBy` **normativo** del propio §4.22b
(`numberPrefix asc` primero) y `compareByNumber` (agrupación «GG → SV → TG») producen
**`2, 10, SV107, TG01`** — `SV` < `TG` alfabéticamente. El test implementado sigue la norma
(§4.22b), no la línea ilustrativa. Sería bueno corregir esa línea en ARCHITECTURE para que nadie
"arregle" el orden en la dirección equivocada.

Fuera de eso, la especificación de §4.22 se implementó sin cambios (incluida la migración M-26
copiada literal de §11). El único punto abierto es el supuesto S1/S2/S3 de §49.6, que el propio
arquitecto ya dejó documentado como pendiente de la primera corrida real (no bloqueante).

### 49.9 Test de integración obligatorio del orden paginado (añadido tras veredicto del techlead)

**Suite nueva: `backend/test/integration/buylist-cards-order.e2e-spec.ts`** (contra Postgres real,
vía la app Nest completa del harness). Consume los oráculos `E2E_ORDER_EXPECTED_NUMBERS` y
`E2E_SET_EXPECTED_NUMBERS` de `prisma/e2e-fixtures.ts` (antes exportados sin consumidor):

| Caso | Qué ancla |
|---|---|
| `pageSize=2` sobre `E2E_ORDER_SET` (4 cartas → 2 páginas) | Orden GLOBAL `2, 10, SV107, TG01` atravesando páginas; sin duplicados (`Set` de ids) ni huecos (`rows.length === total`). Regresión directa de ORD-1. |
| `pageSize=1` y `pageSize=3` | El mismo orden global con fronteras de página desalineadas (el `{id:'asc'}` final garantiza paginación determinista). |
| Columnas M-26 expuestas | `numberSort`/`numberPrefix` del DTO coherentes (`SV107` → `{1000107,'SV'}`, `TG01` → `{1000001,'TG'}`) y **`SV107` sale ANTES que `TG01` pese a `numberSort` mayor** — es la agrupación por `numberPrefix`, la razón de ser de la columna (`TG12`/`GG12` colisionan en `numberSort`). |
| `E2E Base Set` con `pageSize=2` | Páginas 4,16 / 17,20 / 25,99 y `E2E Reverse Bird` con `availableFinishes: ['normal','reverse_holo']` en orden canónico (§4.22c, el requisito del PO); ningún array vacío. |

**Fixture ampliado:** `E2E_ORDER_CARDS` gana `orderShiny` (`SV107`, `Rare Shiny`) — **segundo
prefijo** de promo, sin el cual la agrupación por `numberPrefix` no quedaba ejercitada por datos
sembrados. El oráculo pasa a `['2','10','SV107','TG01']`.

**Asserts de `orderBy` en unitarias:** `test/buylist-catalog.spec.ts` ahora asierta que
`searchAllCards` pasa a Prisma exactamente `CARD_ORDER_BY_IN_SET` (con `setId`) y
`CARD_ORDER_BY_GLOBAL` (sin él), con el shape literal duplicado en el assert (defensa en
profundidad: si alguien cambiara la constante Y el call-site a la vez, el literal sigue fallando).

**Hallazgo lateral corregido — recurrencia del patrón BE-64:**
`catalog-checkout-webhook.e2e-spec.ts` buscaba el charizard del seed en `GET /catalog/cards?
pageSize=50`; al acumular la BD compartida >50 piezas listadas del MISMO charizard (`E2E-GST-*` que
dejan las suites de guest checkout por corrida) la pieza cayó fuera de la página y el test empezó a
fallar solo — exactamente el flake que BE-64 documentó, y acotar con `q=` tampoco bastaba (51
listings del mismo nombre). Corregido a la regla de la casa: la pieza concreta se pide **por id**
(`GET /catalog/listings/:id`, mismo `ListingDTO`) y el listado se asierta por comportamiento (toda
fila publicada es vendible con precio > 0), no por volumen. Recurrencia anotada en la propia entrada
BE-64 de `TECH_DEBT.md`.
## 50. v1.21.3-quote-prune (2026-08-18) — poda por ítem en los DOS quotes; session sigue estricta

**Qué cambió (API_CONTRACT §4, §4-G.1; ARCHITECTURE §4.21h-1 caso v ajustado).** El carrito vive en
`localStorage` como ids de piezas físicas ÚNICAS: al venderse desaparecen, y un solo id muerto
reventaba el quote completo (`404 NOT_FOUND` / `409 ITEM_UNAVAILABLE` globales) bloqueando el
checkout. Ahora `POST /checkout/quote` y `POST /checkout/guest/quote` resuelven **por ítem**:

- Los ids que no resuelven (`cardName: null`) o existen pero están fuera de la venta de plataforma
  (`ownerType != 'platform'` o `status ∉ {listed, in_stock}` ⇒ `cardName` con el nombre) viajan en
  **`unavailableItems: UnavailableCartItemDTO[]`** con `200`. **Siempre presente**, `[]` si todo
  resuelve (shape previo intacto en ese caso).
- `items`/`breakdown` se calculan SOLO con los válidos. **Carrito 100 % muerto ⇒ `200` con
  `items: []` y breakdown EN CEROS** (sin gross-up: cotizar la nada no puede producir el fee fijo
  \> 0; `ivaRatePct` conserva el dial). En invitado el cero incluye `shippingFeeCents: 0` y se
  conservan `fulfillmentMode`/`notices`.
- `422 PRICE_PENDING` conserva su semántica pero se evalúa **DESPUÉS de la poda**: solo lo dispara
  un ítem VÁLIDO sin precio. `GUEST_MAX_ITEMS` se valida sobre el array del REQUEST (el DTO, como
  siempre): podar a vacío es `200`, no `400`.
- Un id **repetido** en el carrito se dedupe (una pieza única no puede cotizarse dos veces).

**Qué NO cambió (anti-sobrecorrección).** `POST /checkout/session` y `POST /checkout/guest/session`
siguen ESTRICTOS (`404`/`409` globales) y la reserva atómica está intacta: el gate duro anti
double-sell es session. El flujo es: quote poda → el front actualiza el carrito (y le pone
expiración de 30 días, dueño: frontend) → session recibe solo ids vivos.

**Diseño (regla de venta ÚNICA, sin duplicar precios).** En `OrdersService`:
- `isSellable(item)` — EL predicado de venta (plataforma + `{listed, in_stock}`), un solo cuerpo.
- `buildLines(items)` — precios server-side vía `salePriceOf` (SEC-A1), un solo cuerpo; conserva
  `PRICE_PENDING`.
- `priceCartForOrder` (ESTRICTA, la de las dos sessions — ruta de dinero/reserva) y
  `priceCartForQuote` (tolerante, la de
  los dos quotes) **delegan ambas** en esos helpers: solo cambia el TRANSPORTE del fallo
  (excepción global vs. poda a `unavailableItems`), nunca el criterio. El breakdown en ceros
  canónico es `OrdersService.zeroCartBreakdown(ivaPct)`; el invitado lo extiende con
  `shippingFeeCents: 0`.

**Tests.**
- Unit nueva: `test/orders.quote-prune.spec.ts` (11 casos): mezcla viva+vendida+borrada, pieza de
  bóveda podada, 100 % muerto en ceros sin gross-up, compat `[]`, dedupe, `PRICE_PENDING`
  post-poda (y que un muerto sin precio NO lo dispara), y la estrictez intacta de
  `priceCartForOrder`/`createSession` (`NOT_FOUND`/`ITEM_UNAVAILABLE`, sin crear la Order).
- `test/guest-checkout.session.spec.ts`: el quote de invitado ahora ancla poda/ceros/shape estable
  y que session usa la ruta ESTRICTA (nunca la tolerante).
- Integración actualizada: `catalog-checkout-webhook` (describe nuevo de poda customer + session
  estricta sin dejar reservas), `guest-checkout.e2e-spec` (poda de invitado, pieza reservada ⇒
  quote podado + session 409) y `guest-chargeback.e2e-spec` — **caso v ajustado**: los quotes ya no
  dan `409`; la aserción equivalente es `200` con la pieza en `unavailableItems` y FUERA de
  `items`/`breakdown`; las DOS sessions siguen en `409` y la pieza fuera de la `picking-list`.
- Resultado: `npm test` 101 suites / 944 tests en verde; integración 7/8 suites en verde
  (119/120 — el único rojo es el PUT a MinIO de `infra-smoke`, entorno sin S3, ajeno al cambio);
  `lint` y `typecheck` limpios.

## 51. v1.22-1 (M-27, 2026-08-19) — `availableFinishes` DERIVADA money-safe: Señal C de PPT + `FinishReconciler`

**Diseño del arquitecto (§4.22g/§4.22h), implementado tal cual.** `Card.availableFinishes` deja de
escribirse directamente y pasa a ser una **columna DERIVADA y recomputable** de DOS columnas de
ENTRADA nuevas y persistidas:

```
availableFinishes := orderFinishes(catalogFinishes ∪ pricedFinishesSnapshot) || ['normal']
```

- **`catalogFinishes`** — «opinión del catálogo» (Señal A ∪ B de pokemontcg.io, lo que devuelve
  `deriveAvailableFinishes`). La escribe `catalog-sync.upsertCards` con la semántica null de §4.22a-4
  (CREATE `derived ?? ['normal']`; UPDATE omite la clave si `derived === null` → conserva lo previo,
  sobrevive a un 502). **Backfill M-27:** `catalogFinishes := availableFinishes`.
- **`pricedFinishesSnapshot`** — **Señal C**: acabados que PPT reportó con `market>0` **y alias
  VERIFICADO**, por carta. La escribe `price-ingest` por **REEMPLAZO por carta en una corrida
  EXITOSA** (`requestOk && rows>0`); ante fallo/0 filas NO se toca ningún snapshot (stale money-safe).
- **Único escritor de `availableFinishes` = `catalog.FinishReconciler`** (nuevo). `price-ingest` y
  `catalog-sync` escriben SU columna de entrada y **llaman** `reconcile(cardIds)`. `price-ingest`
  sigue haciendo **CERO** escrituras sobre `availableFinishes` (assert de spy en el test).

**Cuatro candados (§4.22g).** (1) No monótona: quitar el acabado de cualquiera de las dos entradas y
recomputar lo elimina (`sync --force` o la siguiente corrida de PPT REPARAN). (2) Alias VERIFICADO
(`VERIFIED_FINISH_ALIASES`, espejo estricto de `TCG_KEY_TO_FINISH`, SIN los SUPUESTO): un `foil`
supuesto persiste su `PriceReference` pero **no** entra a la lista blanca. (3) Anti-invención:
`normalizeVerifiedFinishAlias` devuelve `null` para lo desconocido → se OMITE, jamás se atribuye a
`normal`. (4) Un solo método escribe `availableFinishes`.

### 51.1 Archivos tocados (solo `backend/`)
- `prisma/schema.prisma` — `Card.catalogFinishes Finish[] @default([])` + `Card.pricedFinishesSnapshot Finish[] @default([])`.
- `prisma/migrations/20260819120000_m27_card_finish_signals/migration.sql` — **M-27**, ADITIVA: dos
  columnas `NOT NULL DEFAULT ARRAY[]::"Finish"[]` (mismo patrón enum-array que M-18) + backfill
  `UPDATE "Card" SET "catalogFinishes" = "availableFinishes"`. No toca la forma de `availableFinishes`.
- `src/common/card-order.ts` — `unionAvailableFinishes(catalog, priced)` (función PURA, sin DI;
  reusable por reconciler, seeds y tests).
- `src/modules/catalog/finish-reconciler.service.ts` + `finish-reconciler.module.ts` — **NUEVO**
  `FinishReconciler` (único escritor; idempotente: no escribe si el valor recomputado ya coincide).
  Vive en su propio módulo para que `CatalogModule` y `PricingModule` lo compartan **sin `forwardRef`**
  (solo depende de `PrismaService` @Global).
- `src/modules/catalog/catalog-sync.service.ts` — `upsertCards` escribe `catalogFinishes` (no
  `availableFinishes`) y llama `reconcile(cardIds)` del lote.
- `src/modules/pricing/pricing.types.ts` — `VERIFIED_FINISH_ALIASES` + `normalizeVerifiedFinishAlias`;
  `finishAliasVerified: boolean` en `BulkPriceRow`; `requestOk?: boolean` en `BulkPriceResult`.
  `normalizeFinishAlias`/`BULK_VARIANT_TO_FINISH` **intactos** (el PRECIO sigue tolerante).
- `src/modules/pricing/providers/pokemonpricetracker-bulk.provider.ts` — fija `finishAliasVerified`
  por fila y devuelve `requestOk`.
- `src/modules/pricing/providers/pokemontcg-io-bulk.provider.ts` — `finishAliasVerified: true` (las
  llaves reales de tcgplayer.prices son verificadas por construcción) + `requestOk`.
- `src/modules/pricing/price-ingest.service.ts` — en corrida exitosa reemplaza
  `pricedFinishesSnapshot` (verificados con `market>0`) por carta vista y llama `reconcile`; sigue sin
  escribir `availableFinishes`.
- `src/modules/pricing/pricing.module.ts` + `catalog/catalog.module.ts` — importan `FinishReconcilerModule`.
- Seeds: `prisma/e2e-fixtures.ts` (la carta `reverse` pasa a **PPT-only rescatado**:
  `catalogFinishes=['normal']`, `snapshot=['reverse_holo']`, mismo `availableFinishes` → cero cambio
  para las suites de dinero), `prisma/seed-e2e.ts` (`seedCards` siembra las 3 columnas), `prisma/seed.ts`
  (Charizard ruta catálogo + carta `base1-16 Pidgey` PPT-only de demostración).

### 51.2 Tests (propios) — todos los exigidos por §4.22h
- `test/finish-reconciler.spec.ts` (**nuevo**): unión pura (rescate/orden/default/recomputable);
  `FinishReconciler` (RESCATE PPT-only ⇒ `['normal','reverse_holo']`; REPARABILIDAD ⇒ se quita;
  DEFAULT ⇒ `['normal']`; IDEMPOTENTE ⇒ 0 writes); `normalizeVerifiedFinishAlias` (acepta verificados,
  rechaza SUPUESTO, espejo de `TCG_KEY_TO_FINISH`).
- `test/price-ingest.service.spec.ts` (reescrito): escribe `pricedFinishesSnapshot` + reconcile;
  **ANTI-INVENCIÓN/SEC-A1** (`foil` supuesto: precio sí, snapshot `[]`); **MONEY-SAFE STALE**
  (`requestOk=false` o 0 filas ⇒ ningún snapshot ni reconcile); **ÚNICO ESCRITOR** (ningún
  `card.update` toca `availableFinishes`).
- `test/price-ingest.provider.spec.ts` (actualizado): `finishAliasVerified`/`requestOk` por fila/result;
  el caso `variant:'Reverse Holo'` (SUPUESTO) queda `finishAliasVerified:false`.
- `test/catalog-sync.finish.spec.ts` (actualizado): `upsertCards` escribe `catalogFinishes` (no
  `availableFinishes`), omite la clave sin señal en UPDATE, y llama `reconcile(cardIds)`.
- `test/catalog-sync.spec.ts` y `test/catalog.remote-sets-fallback.spec.ts`: 4º arg (reconciler mock).

**Evidencia local (sandbox, sin red externa ni Postgres):**
- `npx prisma generate` OK (schema parsea); `npx prisma validate` solo objeta `DATABASE_URL` ausente
  (getConfig), no el esquema.
- `npx tsc --noEmit -p tsconfig.json` → **exit 0** (cubre `src/**`, `prisma/**`, `test/**`).
- `npx jest` (suite unitaria completa) → **102 suites / 970 tests en verde**.
- ⚠️ **`prisma migrate deploy` NO se pudo correr aquí**: el sandbox no tiene Postgres ni egress a la
  BD. La migración es ADITIVA y calca el patrón enum-array validado de M-18 (`"Finish"[] ... ARRAY[]::"Finish"[]`)
  y el patrón de backfill de M-26. **Devops/QA la aplican con `prisma migrate deploy`** en staging.

### 51.3 Supuestos S-C1/S-C2 (a verificar en la 1ª corrida en Railway — NO verificable en sandbox)
El egress del sandbox **no alcanza PPT** (dominio bloqueado). El diseño asume:
- **S-C1:** PPT emite `reverse_holo` como un `printing` DISTINTO con `market>0` para sets 2026 nuevos
  (Pitch Black). **(a) Qué asumí:** que hay una fila PPT con `printing` reconocible (`Reverse Holofoil`)
  y `marketPrice>0` por carta con reverse holo. **(b) Comando/log que lo confirma o desmiente:** tras
  el deploy, `POST /api/v1/admin/jobs/price-ingest { "setId": "<externalId de Pitch Black>" }` (super_admin)
  y en los Deploy Logs de Railway buscar la línea `PokemonPriceTracker bulk: GET /api/prices OK ...
  Ejemplo de entrada cruda: {...}` (muestra el `printing` real) y el resumen `... N filas mapeadas`.
  Verificación SQL: `SELECT count(*) FROM "Card" WHERE 'reverse_holo' = ANY("pricedFinishesSnapshot")
  AND "setId" = :pitchBlackLocalId;` debe ser **> 0**, y `... = ANY("availableFinishes") ...` también > 0.
  **(c) Si S-C1 resulta falso** (PPT también colapsa el set nuevo a un solo `printing`): la opción (c)
  **no rescata**; el remedio permanente es el **override manual del admin por carta/set (opción (a),
  M2)** — **avisar al arquitecto** (no inventar reverse holo por rareza ni por `CardSet.hasReverseHolo`).
- **S-C2:** los alias SUPUESTO que aparezcan en PPT corresponden de verdad al `Finish` mapeado.
  **Verificación:** en los logs, el resumen del provider imprime `N sin acabado reconocible` y un
  ejemplo crudo; contrastar el histograma de `printing` crudos. Los que se confirmen se **promueven** a
  `VERIFIED_FINISH_ALIASES` (una línea en `pricing.types.ts`); hasta entonces **solo alimentan el
  precio**, nunca la lista blanca (candado 2). Mientras tanto la Señal C solo admite los 4 verificados.

### 51.4 `dataHealth` «rescatadas por PPT» — DEFERIDO (no bloqueante, dueño: backend)
§4.22h lo marca **recomendado**. El contador vive en el **dashboard de admin** (`admin.service.ts`,
módulo/stream «Admin y auditoría»), cuyo shape lo fija `API_CONTRACT §Dashboard` y lo ancla
`test/admin.contract-shapes.spec.ts`. Añadir un campo a `dataHealth` toca la **superficie de contrato
de otro stream**; por eso **no** lo incluí en este cambio para no meterme en zona ajena ni forzar un
cambio de contrato sin el arquitecto. Queda como **pendiente menor con dueño backend** (misma suerte
que `cardsWithoutFinishSignal` de §4.22a-5, que tampoco se materializó en el dashboard): el techlead
puede pedir su registro formal en `docs/TECH_DEBT.md`. La query sugerida (cuando se aborde):
`Card` con `NOT ('reverse_holo' = ANY("catalogFinishes"))` **y** `('reverse_holo' = ANY("availableFinishes"))`.

## 52. WS-A fix-ppt (M-28, 2026-08-19) — PokemonPriceTracker: setId real, throttle 429, scope y reverse holo

**Incidente (producción, confirmado con logs de Railway):** con `PRICE_PROVIDER=pokemonpricetracker`
activo, el cotizador/inventario mostraba piso por rareza (MX$0.50) o "Precio pendiente" en TODO el
catálogo. El adapter devolvía `0 entradas crudas → 0 filas mapeadas` en TODOS los sets, con `HTTP 429`
(114×). La API key del PO ES válida (los `401` eran ruido). Causas, en orden, y su arreglo:

### Causa raíz #1 — `setId` equivocado (el "0 entradas")
El adapter mandaba `GET /api/v2/cards?setId=<CardSet.externalId>` con el id de pokemontcg.io (`sv8`),
que **PokemonPriceTracker NO reconoce como set** → 0 cartas. PPT identifica el set por el **GroupId
numérico de TCGplayer** (`tcgPlayerNumericId`, p. ej. `1407`), el **slug** (`tcgPlayerId`,
`sv-prismatic-evolutions`) o su id mongo — nunca el externalId de pokemontcg.io.

- **Nueva columna `CardSet.pptSetId String?`** (migración `20260819160000_m28_cardset_ppt_setid`,
  aditiva, nullable, sin índice). Cachea el setId real de PPT. `null` = aún no mapeado / sin match.
- **`PptSetMapper`** (`backend/src/modules/pricing/ppt-set-mapper.service.ts`): pide `GET /api/v2/sets`
  UNA vez por corrida (caché en memoria), empata cada set local por **nombre normalizado** (minúsculas,
  sin no-alfanuméricos) y desempata por **año de `releaseDate`**; persiste `pptSetId`. Match ambiguo o
  ausente → `null` y se **loguea** (`… SIN mapeo a PokemonPriceTracker …`). Prefiere GroupId numérico.
- El provider **jamás** cae al `externalId` si falta `pptSetId`: loguea `motivo=setId no mapeado` y
  devuelve 0 filas (repetir el externalId reproduciría el bug).

### Causa #2 — SCOPE (no barrer los 174 sets; no agotar 20k créditos/día)
Regla del PO en `backend/src/modules/pricing/ppt-sync-scope.ts` (+ integración en `PriceIngestService`):
- **(a) Set con `releaseDate` año ≥ 2020 → `full`** (todas sus cartas).
- **(b) Set con año < 2020 → `partial`**: SOLO cartas con **InventoryItem activo** (status ≠
  `withdrawn`/`lost`) **∪** cartas **PREMIUM/CHASE**. En viejos NO se persiste el bulk ni el rare normal.
- Viejo sin inventario activo ni premium → **`skip`** (no se pide nada).
- **Umbral de rareza (REFINAMIENTO DEL PO, 2026-08-19 — `isPremiumRarity`):** allow-list EXPLÍCITA de
  premium/chase, no una deny-list. **INCLUYE** "Illustration Rare para arriba" (Illustration/Special
  Illustration, Hyper/Rainbow, Gold/Secret) + familia **ex/EX/GX/V/VMAX/VSTAR** (+ Mega, V-UNION) +
  chase equivalente (Full Art=`Rare Ultra`, Lv.X, Prime, BREAK, LEGEND, Amazing/Radiant, Shiny/Shining,
  Prism Star). Términos premium (substring normalizado): `holo, ultra, secret, rainbow, gold, hyper,
  illustration, shiny, shining, amazing, radiant, prime, break, legend, lvx/levelx, prism, mega` + la
  familia ex/gx/v por PALABRA. **EXCLUYE** `common`, `uncommon`, `rare` normal (no-holo). **Reverse holo
  NUNCA cuenta como rareza** (es un ACABADO, no un tier; guard `reverse`, y de todos modos el scope solo
  mira `Card.rarity`, jamás los acabados). **CAVEAT cross-era:** en eras viejas (base/neo/e-card/EX) no
  existe "Illustration Rare" → el premium es **`Rare Holo`** (por eso `holo` es término premium: Charizard
  Base = Rare Holo entra) y los EX de esa época. Rareza `null`/desconocida → **NO premium** (excluida): el
  **InventoryItem activo es la red de seguridad** de cualquier carta que realmente tengamos.
- El scope se aplica al **seleccionar** los sets (`listSetIdsForIngest`, modernos primero) y al
  **persistir** (en partial solo se escriben las `allowedCardIds` aunque el barrido traiga el set entero).
- Disparo manual de un set (`POST /admin/jobs/price-ingest { setId }`) **fuerza full** (verificación).

### Causa #3 — Throttle / 429 (los 114× HTTP 429)
Nuevo cliente compartido **`PptApiClient`** (`backend/src/modules/pricing/providers/ppt-api.client.ts`),
usado por el mapper y el bulk provider. Host FIJO (anti-SSRF), key solo en header. Maneja el 429 según
`limitType` del cuerpo:
- **`per_minute`** → espera `Retry-After` (header o cuerpo, seg→ms) y **reintenta** (hasta 4×); sin
  Retry-After, backoff exponencial con jitter determinista.
- **`daily`** → lanza `PptDailyLimitError` (**PARADA**, no resetea hasta 00:00 UTC) y arma un **candado
  en memoria** hasta `resetsAt`: toda petición posterior de esa corrida corta SIN pegarle al proveedor
  (en fan-out, el `PptApiClient` es singleton del worker → los children restantes cortan solos).
- **Presupuesto:** trackea `X-RateLimit-Daily-Remaining` (`client.dailyRemaining()` /
  `effectiveRemaining() = remaining − inFlight`) y `metadata.apiCallsConsumed`.
- El bulk provider propaga `dailyLimited` en `BulkPriceResult`; `ingestAll` **detiene** el barrido y
  reporta cuántos sets quedaron **pendientes**. Money-safe: ante 429/timeout NO se borran precios.

### Causa #4 — Variantes reverse holo (las 2 casillas por carta)
La lista v2 trae un solo `prices.market` + `prices.primaryPrinting`. Opcional (dial
`POKEMONPRICETRACKER_FETCH_PRINTINGS=true`): el provider hace **un barrido por impresión**
(`printing=Normal` / `Reverse Holofoil` / `Holofoil`) y atribuye cada `market` a su `Finish`, poblando
reverse holo (alimenta `pricedFinishesSnapshot → FinishReconciler → availableFinishes`). **Costo ≈3×**
por set (un request por impresión) → por eso va por dial y respeta el scope.

### Causa #5 — Observabilidad
El resumen por set ahora dice el **MOTIVO** cuando da 0: `setId no mapeado` / `429 daily` /
`429 per_minute` / `request falló` / `200 sin datos` / `sample-only`, además del ejemplo crudo. Cada
página OK loguea `dailyRemaining`.

### Shape v2 real (mapeo)
Se añadió como fuente PRIMARIA `entry.prices = { market, primaryPrinting, low, lastUpdated }`
(market→finish del primaryPrinting). Se conservan como fallback tolerante los shapes previos
(`tcgplayer.prices` por acabado, listas de `printings`/`variants`, plano `printing`+`marketPrice`).
El fail-closed de moneda/unidad (`POKEMONPRICETRACKER_MARKET_FORMAT`) NO cambia (sin formato →
sample-only, no persiste). PO confirmó `usd_dollars`.

### Env / columnas nuevas y defaults
| Qué | Tipo | Default | Efecto |
|---|---|---|---|
| `CardSet.pptSetId` | columna `String?` | `null` | setId real de PPT (lo puebla el mapper) |
| `POKEMONPRICETRACKER_MARKET_FORMAT` | env | *(sin default)* | sin él → sample-only; PO: `usd_dollars` |
| `POKEMONPRICETRACKER_PARTIAL_MIN_PRICE` | env | *(vacío)* | filtro `minPrice` de la API en sets partial (excluir bulk en origen); confirmar la unidad en la 1ª corrida |
| `POKEMONPRICETRACKER_FETCH_PRINTINGS` | env | `false` | `true` → barrido por impresión (reverse holo, ≈3× costo) |

(Los env viven en `.env.example`, cuya edición es de **devops** — aquí solo se documentan.)

### Qué debe buscar el PO en los logs de la próxima corrida de Railway
1. `PptSetMapper: /api/v2/sets devolvió N sets (dailyRemaining=…)` y `resueltos X/Y sets nuevos`.
   Si aparece `… SIN mapeo a PokemonPriceTracker (…)`, esos sets no empataron por nombre/año (revisar).
2. Por set, en vez del viejo "0 entradas": `PokemonPriceTracker bulk resumen (set sv8): N crudas →
   M filas […] motivo=ok.` con `M > 0`. Un `motivo=setId no mapeado` señala fallo del match.
3. `price-ingest scope (pokemonpricetracker): A sets modernos … + B viejos … partial, C omitidos`.
4. Si se agota la cuota: `429 DAILY … PARADA. resetsAt=…` y `PARADA por cuota DIARIA agotada tras
   P/Q sets (R pendientes; reintenta tras 00:00 UTC)`.
5. `dailyRemaining=…` decreciente en las líneas `GET … OK` (presupuesto vivo).

### Tests (sandbox sin egress → todo mockeado)
`ppt-sync-scope.spec.ts` (scope/rareza), `ppt-set-mapper.service.spec.ts` (match/persistencia/daily),
`ppt-api.client.spec.ts` (Retry-After, daily-stop, presupuesto, 404), `pokemonpricetracker-bulk.fix-ppt.spec.ts`
(setId real, shape v2, printings, daily), + scope en `test/price-ingest.service.spec.ts`. Verdes:
lint, typecheck, build y 1019 unit tests.

## 53. N-11 (2026-08-19) — barra de progreso del sync de precios (`price-ingest` background + `sync-status`)

Junto con el fix de PPT (§52) se implementó N-11: convertir el `price-ingest` de **bloqueante** a
**segundo plano** (fire-and-forget) con **estado observable**, calcando el patrón que ya existe para el
catálogo (`catalog-sync.getSyncStatus` + `GET /admin/catalog/sync-status`).

### Backend
- **Estado en memoria** en `PriceIngestService` (`PriceSyncStatus`), expuesto por `getSyncStatus()`.
  Lo maneja `ingestAll` (barrido COMPLETO): publica `running/total/startedAt` al arrancar, avanza
  `done`/`pending` por set, guarda `dailyRemaining` (presupuesto vivo del proveedor) y `dailyLimited`
  (429 daily), y cierra con `running=false`+`finishedAt` (y `lastError` si reventó). No persistido (se
  pierde al reiniciar, igual que el de catálogo) y NO llama al proveedor en cada poll.
- **Disparo no bloqueante:** `PriceIngestJobService.runBackground()` — single-flight vía
  `getSyncStatus().running`, lanza `ingestAll` fire-and-forget y **devuelve de inmediato**. El endpoint
  `POST /admin/jobs/price-ingest` **sin `setId`** ahora enruta a `runBackground()` (con `setId` sigue
  AWAITED para verificación de un set). El **CRON 2×/día NO cambia**: sigue usando `run()` (fan-out
  BullMQ / secuencial) — solo el disparo MANUAL usa el barrido background con barra.
- **`dailyRemaining`** se propaga del `PptApiClient` → `BulkPriceResult` → `IngestSetResult` → estado
  (sin nueva dependencia en el servicio).

### Contrato del endpoint nuevo (reportar al arquitecto para formalizar en API_CONTRACT)
`GET /admin/pricing/sync-status` — **super_admin**. Responde:
```jsonc
{
  "running": false,
  "jobId": "price-ingest-2026-08-19",
  "total": 120, "done": 120, "pending": 0,
  "startedAt": "2026-08-19T00:00:00.000Z",
  "finishedAt": "2026-08-19T00:04:12.000Z",
  "lastError": null,
  "dailyRemaining": 17777,   // presupuesto diario del proveedor de paga (o null)
  "dailyLimited": false,     // true = pausado por 429 daily → "retoma 00:00 UTC, N pendientes"
  "provider": "pokemonpricetracker"
}
```
El front (M2View) lo pollea ~3s mientras `running` y pinta la barra `done/total` REUSANDO el componente
`SyncProgress` (FE-9, `role="progressbar"`); si `dailyLimited`, muestra el aviso de pausa por límite
diario con `pending`. El disparo `POST /admin/jobs/price-ingest` responde 202 con
`{ job, enqueued, background:true, alreadyRunning }`.

### Nota de proceso
El endpoint nuevo (`GET /admin/pricing/sync-status`) es superficie de contrato → el **arquitecto** debe
formalizarlo en `docs/API_CONTRACT.md §M2/§M10-ops` (no lo edité: propiedad de otro rol). El frontend
(M2View + `SyncProgress`) lo implementa un subagente **frontend** (excepción explícita del PO a
"solo backend") tocando solo `frontend/`.
## 52. WS «Sellado / Producto cerrado» (v1.23-sealed-sales, M-28, 2026-08-19)

Implementa el contrato §2-S/§3/§M1/§M2/§M10 y ARCHITECTURE §4.23. El sellado pasa de «precio manual
único» a **línea de venta con precio derivado** (`override > mercado TCGCSV × spread > PRICE_PENDING`),
con superficie propia (grid + ficha), pestaña «Sellado» en bóveda, y dos diferenciadores
feature-flagged (tendencia + restock). **Todo aditivo; una migración (M-28); cuatro diales.**

### 52.1 Migración M-28 (`prisma/migrations/20260819130000_m28_sealed_sales/`)
Aditiva y nullable, con backfill. **NO toca** `PriceReference`/`Order`/`OrderItem`.
- `enum SealedCondition { mint, minor_box_damage }` — condición SIMPLE visible al comprador (labels en
  i18n del front). **No altera el precio** (el spread es por presentación); para descontar una caja con
  detalle el admin usa el **override** de esa pieza.
- `InventoryItem.sealedCondition SealedCondition?` — app-requerido para `sealed` (default `mint`), null
  en raw/graded. **Backfill:** `UPDATE ... SET sealedCondition='mint' WHERE productType='sealed'`.
- `InventoryItem @@index([productType, status])` — sirve el grid del sellado (`sealed AND listed`).
- `model SealedRestockSubscription` — «avísame cuando vuelva» (feature-flagged; solo se puebla con el
  flag on). FK `userId` opcional (`onDelete: SetNull`) y `cardId` (RESTRICT).

### 52.2 Cuatro diales (`settings.constants.ts`)
- `sealed_spread_pct_by_subtype` (seed `{box:18,etb:22,bundle:25,tin:30,blister:35}`) y
  `sealed_spread_fallback_pct` (seed `25`) — markup % **ARRIBA de mercado** por presentación. **NO se
  exponen en el DTO de M10 ni se editan por `PUT /admin/settings`**: solo por los endpoints M2
  dedicados `GET/PUT /admin/pricing/sealed-spreads` (como sales/buylist rules). Validación: subtype ∈
  {box,etb,bundle,tin,blister}, value/fallback en `[0,1000]`.
- `sealed_value_trend` y `sealed_restock_alerts` (seed **off** ambos) — feature flags **expuestos** en el
  DTO de M10 (`sealedValueTrend`/`sealedRestockAlerts`), editables por `PUT /admin/settings`, validados `on|off`.
El seed los siembra automáticamente (loop `SETTING_DEFAULTS` en `seed.ts`/`seed-e2e.ts`).

### 52.3 Precio del sellado (money-safe, SEC-A1) — función pura + call-sites
- **`computeSealedSalePrice(overrideCents, sealedSubtype, marketMxnCents, spreadPctBySubtype,
  fallbackPct)`** (`common/money.ts`): precedencia `override > mercado×spread(subtype) >
  mercado×spread(global) > pending`. Devuelve `{ salePriceCents, status, source, appliedSpreadPct }`.
  `source` ∈ `override|subtype_spread|global_spread` (= `SealedSpreadSource` del contrato). **Nunca
  inventa precio:** sin override y sin mercado → `status:'pending'` (no publicable).
- **`PricingService`** gana `loadSealedSpreads()` (iza spreads + `sourceOn` = dial `sealedPriceSource===tcgcsv`,
  una lectura por request), `sealedMarketGradeKeyForItem(item)`, `getSealedMarketRef(item)`,
  `computeSealedSalePriceForItem(item, marketCents)`.
- **Gating por dial (fraseo corregido en v1.43 / IMP-C — ver §52.9):** el dial `sealedPriceSource`
  gobierna **solo la FUENTE AUTOMÁTICA de mercado** (`source='tcgcsv'`): con `off` ese mercado queda
  inerte (`gate → null`, fail-closed). **NO** aplica a un **override manual de mercado**
  (`isManualOverride`/`source='manual'`, «FIJAR PRECIO»), que es decisión humana y sobrevive al dial.
  Es decir, con el dial `off` el sellado se vende con (a) el **override de venta por pieza**
  (`listPriceCents`) **o** (b) el **override manual de mercado**×spread — **no** solo con `listPriceCents`.
  Se aplica en los 3 call-sites vía el gate único `gateSealedMarketCents` (H-1).
- **Call-sites ramificados por `productType==='sealed'`** (mismo patrón §4.14d):
  `catalog.service.toListingDTO` (grid/Compra), `orders.service.salePriceOf` (checkout → `422 PRICE_PENDING`
  si no resuelve) e `inventory.service.bulkPublish` (§M1; la rama sealed **ya no exige** `listPriceCents`).
  Todos batchean referencias con la clave de MERCADO `sealed:tcg:<productId>` (un sellado no mapeado no
  aporta clave). `ListingDTO` gana `sealedCondition?` y para sellado `referenceValue` = `sealedMarketRef`.

### 52.4 Endpoints nuevos
- **Público (§2-S), `catalog.controller` + `SealedCatalogService`:**
  - `GET /catalog/sealed` — grid AGREGADO por producto+condición («N disponibles»). Agrupa
    mapeado→`p:<productId>:<cond>`, no mapeado→`c:<cardId>:<subtype>:<cond>`. La **condición separa
    grupos**. Solo grupos con ≥1 pieza vendible (precio resuelto). Filtros set/subtype/condición/q,
    paginado, sort `price_asc|price_desc|newest`. **Sin N+1**: 1 query + `getReferencesBatch` + groupBy.
  - `GET /catalog/sealed/:inventoryItemId` — ficha: grupo + `listings: ListingDTO[]` (todas las piezas
    del grupo, más baratas primero) + `trendEnabled`/`restockEnabled`.
  - `GET /catalog/sealed/:inventoryItemId/value-history` — **feature-flagged** `sealed_value_trend`
    (`404 FEATURE_DISABLED` si off). Reusa el historial de `PriceReference(sealed:tcg:<productId>)` que
    el job `sealed-price-ingest` ya acumula (cero fabricación de datos). `404 NOT_FOUND` si pieza
    inexistente o no mapeada. Rate-limit 60/min.
  - `POST /catalog/sealed/restock-subscriptions` — **feature-flagged** `sealed_restock_alerts`. Respuesta
    **neutra `202 {subscribed:true}`** (anti-enumeración), rate-limit 5/min. `422 VALIDATION_ERROR` si
    correo inválido o sin identidad de producto. Resuelve el `cardId` ancla (explícito o desde un item
    con ese `productId`); si no ancla a una Card real, 202 neutro sin persistir.
- **Bóveda (§3/§M1):** `GET /vault/sealed` (`VaultService.sealedTab`, cliente) y
  `GET /admin/vaults/:userId/sealed` (`AdminVaultsService.sealed`, `vault_operator+`, con `owner`
  name/email, `404` si usuario inexistente). Agrupan las piezas selladas en bóveda por
  producto+condición; valúan por `sealedMarketRef`; piezas sin mercado **excluidas** del total y
  contadas en `pendingPriceCount`. Desglose `ownership {pending, settled}`.
- **M2 (§M2), `PricingController`:** `GET/PUT /admin/pricing/sealed-spreads` (`super_admin`, **auditado**
  `pricing.sealed_spreads.update` before/after). PUT parcial; validación estricta → `422`.
- **Alta admin (§M1):** `sealedCondition?` aceptado en `CreateItemDto`/`BatchInventoryItemInput`/
  `AdjustmentFoundItemInput`; persistido en `buildItemData` (default `mint`, null en raw/graded);
  raw/graded rechazan `sealedCondition` en `validateProductShape`.
- **Job `sealed-restock-notify` (§M10-ops, `SealedRestockNotifyService`):** cableado + disparo manual
  `POST /admin/jobs/sealed-restock-notify` (auditado). Feature-flagged (`off` → no-op). Empareja
  suscripciones pendientes con productos de vuelta a `listed` (identidad + condición), envía correo
  (módulo `mail`, `@Global`), marca `notifiedAt`. **NO agendado en cron** (por §4.23h, «no agendado
  hasta el flip»); solo disparo manual.

### 52.5 Decisiones / supuestos de implementación
- **Imagen del grid/bóveda del sellado** = imagen de catálogo de la `Card` (`imageSmallUrl`). El
  contrato dice «TCGCSV si mapeado», pero **la imagen TCGCSV no se persiste** (el adapter la expone solo
  en el explorador de curación M2, no en BD); traerla por producto sería un N+1 contra el remoto. Se usa
  la de catálogo (remota, pokemontcg.io), money-safe y consistente con el resto del producto (§H). Igual
  con `productName` = `Card.name` (el nombre TCGCSV tampoco se persiste). **Si el arquitecto quiere la
  imagen/nombre TCGCSV reales, hace falta persistirlos en el mapeo (columna nueva) — decisión suya.**
- **Valuación de la pestaña «Sellado» NO se gatea por `sealedPriceSource`** (usa el `sealedMarketRef` si
  existe = «valor de mercado actual»); el gating por dial se aplica solo a la **resolución del precio de
  venta** (§4.23a). El precio de venta del sellado sí requiere el dial `tcgcsv`.
- **`GET /vault/holdings` (portafolio general) NO cambia** para el sellado: sigue valuando por el
  gradeKey legacy `'sealed'` (§3 lo declara fuera de alcance). La pestaña «Sellado» es la superficie
  dedicada con valuación de mercado. El sellado ya contaba en el portafolio (item de bóveda), así que el
  criterio «incluir sellado en la valuación» se cumple sin tocar `holdings()`.
- **`POST /catalog/sealed/restock-subscriptions` es `@Public`** y NO asocia `userId` de una sesión: en
  una ruta pública el guard JWT se salta y `req.user` queda vacío, así que las suscripciones de usuarios
  logueados se guardan con `userId=null`. Asociarlo requeriría un guard de auth **opcional** (no cableado
  hoy). No afecta la respuesta neutra ni el emparejamiento por identidad+correo. **Minor; dueño backend
  si se quiere el `userId`.**

### 52.6 Cómo correr los tests
Desde `backend/`: `npm ci` (una vez) → `npx prisma generate` → `npx tsc --noEmit` (typecheck) →
`npx jest` (unitarios) → `npm run lint`. Los de integración/contrato con DB:
`npm run test:integration` (corre `prisma migrate deploy` + jest `--runInBand`; requiere Postgres).
Suites nuevas del sellado: `test/sealed-pricing.spec.ts` (precedencia money-safe de la función pura),
`test/sealed-catalog.spec.ts` (grid agregado, condición separa grupos, money-safe, feature-flags off →
404, restock neutro/anti-enumeración), `test/sealed-settings.spec.ts` (validadores + DTO M10),
`test/vault-sealed.spec.ts` (agregación/valuación de bóveda), `test/sealed-restock-notify.spec.ts` (job).
**Estado:** typecheck limpio, `1023 tests / 108 suites` en verde, lint limpio (`npx jest` + `npm run lint`).

### 52.7 Bloqueos / discrepancias con el contrato para el arquitecto
Ninguno bloqueante. Puntos que conviene que el arquitecto confirme (no «arreglé» el contrato):
1. **Imagen/nombre TCGCSV** del grid/bóveda: implementados con la imagen/nombre de catálogo de la `Card`
   (ver §52.5). Si se quiere la imagen/nombre reales de TCGCSV, requiere persistirlos (columna en el
   mapeo M-23) — cambio de esquema/decisión del arquitecto.
2. **`userId` en restock**: la ruta pública no asocia sesión (§52.5). Si el contrato exige asociar
   `userId` del usuario logueado, hace falta un guard de auth opcional (no existe hoy).

## 53. Saneo del Sellado (v1.24, pase `sellado-producto-cerrado`, 2026-08-19)

Pase de saneo aprobado por el PO sobre el work stream de Sellado (ya cerrado). Solo `backend/`,
`docs/BACKEND_NOTES.md`, `docs/TECH_DEBT.md`. Contrato/arquitectura/PROJECT SIN tocar.

### 53.1 Autoprecio del sellado — seed `off` (fail-closed, por contrato); se enciende en RUNTIME
> **CORRECCIÓN (2026-08-19, hallazgo ALTO del techlead):** un intento previo de este pase cambió el
> **seed** de `sealed_price_source` de `off` → `tcgcsv`. Eso **violaba** el contrato/arquitectura
> (§4.19e / §4.23e y API_CONTRACT §M10 mandan **`seed off, fail-closed`**), rompía el runbook de devops
> y **removía el candado money-safe** del que depende la deuda §BE-44(c) de `TECH_DEBT.md`. **Revertido:**
> el seed vuelve a **`off`**. El autoprecio que pidió el PO NO se logra por seed sino en runtime (abajo).
- **Seed:** el dial `sealed_price_source` (`settings.constants.ts` → `SETTING_DEFAULTS`) queda en
  **`off`** (FAIL-CLOSED). Un **seed fresco** (BD nueva: CI/dev/prod) arranca con el autoprecio del
  sellado **APAGADO** — así el arranque respeta el checkpoint de validación-en-staging (§4.23f) y NO
  se salta el candado money-safe.
- **Cómo se ENCIENDE el autoprecio (runtime, NO seed):** tras validar el esquema TCGCSV con una corrida
  acotada del `sealed-price-ingest` en staging (§4.23f), un `super_admin` flipea el dial por M10:
  ```
  PUT /admin/settings
  Authorization: Bearer <token super_admin>
  Content-Type: application/json
  { "sealedPriceSource": "tcgcsv" }
  ```
  (`SettingsController.updateSettings`, `@Roles(super_admin)`, **auditado** `settings.update`
  before/after). **Ese PUT es el mecanismo money-safe.** **Rollback = mismo PUT con `"off"`.** Aplica
  igual en staging y prod; en una BD ya sembrada el seed no re-siembra (`SettingsService.get` cae al
  default de código solo si la fila falta), así que el flip de runtime es el único camino.
- **Money-safe (independiente del dial):** con el dial en `tcgcsv` (`sourceOn=true`), una pieza sellada
  **SIN `sealedMarketRef`** mapeado/curado (sin `tcgplayerProductId` → sin clave de mercado
  `sealed:tcg:<productId>` → `getSealedMarketRef` = `pending`) sigue resolviendo a **`PRICE_PENDING`** y
  **NO se publica**: `gateSealedMarketCents(undefined, true)=null` →
  `computeSealedSalePrice(override, subtype, null, …)` → sin override>0 → `status:'pending'`,
  `salePriceCents:null`. Solo se auto-precian las piezas **curadas** (mapeadas y con `PriceReference`
  de mercado ingerida por el job `sealed-price-ingest`). Con el dial en `off` (seed) el mercado TCGCSV
  queda inerte (§4.23a) y todo sellado sin override cae a pending. Cubierto en
  `test/sealed-price-resolver.spec.ts` («sin market → pending») y `test/sealed-pricing.spec.ts`.

### 53.2 H-1 · Resolver ÚNICO del precio de venta del sellado (Tarea 2, hallazgo techlead — dinero)
- **Problema:** el gating del precio de venta del sellado (`sourceOn && ref priced && refCents != null`
  → arma `marketCents` → llama `computeSealedSalePrice`) estaba **copiado y DIVERGIDO** en varios
  call-sites. Divergencia concreta de dinero: `orders.salePriceOf` trataba el override como
  `listPriceCents != null && > 0`, mientras la pura y `catalog.toListingDTO` lo trataban como
  `!= null`. Con un **override degenerado de `0`** centavos, Compra (catálogo) marcaba `sellable=false`
  pero el checkout resolvía por otra rama → **inconsistencia de dinero** (un sellado no-vendible en el
  grid podía cobrarse).
- **Fix — un solo cuerpo en `PricingService`:**
  - `gateSealedMarketCents(ref, sourceOn)`: gate ÚNICO del mercado (dial encendido + ref priced +
    `referenceMxnCents != null`) → `number | null`. Con `off` el mercado TCGCSV queda inerte (§4.23a).
  - `resolveSealedSalePrice(item, ref, ctx)`: gate + pura `computeSealedSalePrice` → `SealedSpreadResult`
    completo (`{ salePriceCents, source, status, appliedSpreadPct }`).
- **REGLA ÚNICA DE OVERRIDE (money-safe elegida):** un override se considera **presente solo si
  `overrideCents > 0`**. Un override **`<= 0`** (0 o negativo) es **input DEGENERADO** → se trata como
  **AUSENTE**: el precio cae a `mercado×spread` (y a `PRICE_PENDING` si tampoco hay mercado). Elección:
  **nunca cobrar un sellado gratis ni por debajo de mercado** por un override mal capturado; para
  descontar una caja con detalle el admin fija un override **positivo** (deliberado), no un 0. La regla
  vive en la pura `computeSealedSalePrice` (`if (overrideCents != null && overrideCents > 0)`), así que
  es **idéntica** en todos los consumidores.
- **Call-sites que ahora consumen el resolver** (mismo precio SIEMPRE, incluido override=0):
  `catalog.service.toListingDTO` (grid/Compra), `orders.service.salePriceOf` (checkout),
  `sealed-catalog.service.loadPricedSealed` (grid agregado §2-S) e `inventory.service.bulkPublish`
  (§M1). La **valuación** de la pestaña «Sellado» (`vault.service.sealedTab`) ahora usa
  `gateSealedMarketCents` con `sourceOn` — antes **NO gateaba por dial** (divergía con catálogo/grid
  cuando `sealed_price_source=off`); ahora la valuación **coincide** con las demás superficies.
- **Nota de alcance:** la dedup de `groupKey` (H-2) NO se hizo (habría requerido tocar mocks de dos
  suites y no da valor de correctness); se deja como está para no salir de alcance. La regla de override
  de las **cartas sueltas** (raw/graded) en `orders.salePriceOf` línea 49 (`!= null && > 0`) ya era
  money-safe y no se tocó (la divergencia raw/catálogo está registrada como **BE-26**).

### 53.3 Archivos tocados (solo `backend/`)
- `src/modules/settings/settings.constants.ts` — seed `sealed_price_source` = **`off`** (fail-closed,
  por contrato §M10; el autoprecio se enciende en runtime con el PUT de §53.1, no por seed).
- `src/common/money.ts` — `computeSealedSalePrice`: override presente ⇔ `> 0` (+ doc).
- `src/modules/pricing/pricing.service.ts` — `gateSealedMarketCents` + `resolveSealedSalePrice`.
- `src/modules/catalog/catalog.service.ts`, `src/modules/orders/orders.service.ts`,
  `src/modules/catalog/sealed-catalog.service.ts`, `src/modules/inventory/inventory.service.ts` —
  consumen el resolver; imports de `computeSealedSalePrice` retirados donde ya no se usa.
- `src/modules/vault/vault.service.ts` — valuación gatea por `sourceOn` vía `gateSealedMarketCents`.
- Tests: `test/sealed-price-resolver.spec.ts` (resolver único + gate + consistencia
  catálogo/orders/grid para override=0), `test/sealed-pricing.spec.ts` (regla override=0/negativo/1c),
  mocks de `test/catalog.spec.ts` / `test/sealed-catalog.spec.ts` / `test/vault-sealed.spec.ts`
  ampliados con los métodos nuevos del `PricingService`.

### 53.4 Corrección del rechazo del techlead + cierre de 2 BAJOS (2026-08-19)
- **ALTO (revertido):** el seed de `sealed_price_source` vuelve a **`off`** (fail-closed, por contrato
  §M10 / arquitectura §4.19e·§4.23e). Ver §53.1 corregido: el autoprecio se enciende en runtime con
  `PUT /admin/settings {"sealedPriceSource":"tcgcsv"}` tras validar en staging (§4.23f); rollback = mismo
  PUT con `"off"`. Restaurado el candado money-safe del que depende §BE-44(c) de `TECH_DEBT.md`.
- **BAJO (techlead+QA) — 4º call-site del resolver:** `test/sealed-price-resolver.spec.ts` gana un
  describe que ejercita `inventory.bulkPublish` como 4º consumidor de `resolveSealedSalePrice`: (a) un
  sellado SIN mapeo → `PRICE_PENDING`, no publicado; (b) un sellado mapeado + mercado priceado (sin
  override) → converge al MISMO `EXPECTED` (mercado×spread) que catálogo/Compra/grid, publicado
  `derived`. Nota: en `bulkPublish` un `listPriceCents=0` almacenado entra por la rama `manual` (precio
  explícito 0) ANTES del resolver, así que la convergencia del override=0 se prueba en los 3 sitios que
  sí pasan por el resolver; el 4º se ancla con el caso derivado sin override (mismo `EXPECTED`).
- **BAJO (techlead) — mocks que reimplementaban la pura:** `test/catalog.spec.ts` y
  `test/sealed-catalog.spec.ts` ahora **importan y delegan** en la pura real `computeSealedSalePrice`
  (antes la reescribían a mano → riesgo de divergencia silenciosa). `test/vault-sealed.spec.ts` solo
  mockea el gate trivial `gateSealedMarketCents` (no la pura); se dejó como está y se corrigió su
  comentario (referenciaba el seed `tcgcsv` ya revertido → ahora `sourceOn:true` explícito de runtime).

### 53.5 Estado de verificación
`npx tsc --noEmit` limpio · `npm run lint` limpio · `npx jest` **1036 tests / 109 suites en VERDE**
(1035 previos + 1 nuevo: el 4º call-site `bulkPublish` en `sealed-price-resolver.spec.ts`). Sin commit
ni push (por instrucción del pase).

## 54. FX AL VUELO — la referencia de mercado en USD se valúa con la tasa vigente (money-safe)

**Problema (dinero):** la FX se aplicaba AL SINCRONIZAR y se congelaba en `PriceReference.priceMxnCents`.
Cambiar el dial `fx_manual_override_rate` (o Banxico) NO movía los precios hasta re-sincronizar.

**Fix:** la referencia de MERCADO en USD se **recalcula al VALUAR** con la FX vigente
(`FxService.getCurrent()`), no con el `priceMxnCents` congelado. Un cambio de tasa se refleja al instante,
sin re-sync. La ingesta NO cambió: sigue guardando `priceUsdCents` (+ `fxRate`/`fxBufferPct` de trazabilidad)
para las fuentes en USD, y el `priceMxnCents` almacenado se **repurposa como fallback money-safe** (último
válido si la FX falla).

### 54.1 Distinción "referencia de mercado viva" vs "precio histórico/aceptado"
Encapsulada en el helper puro `PricingService.liveMxnCents(ref, fx)`:
- `priceUsdCents != null` y `isManualOverride=false` → **REFERENCIA DE MERCADO VIVA** → `usdToMxnCents(priceUsdCents, fx.rate, fx.bufferPct)` con la FX vigente.
- `isManualOverride=true` (override del admin en MXN, `priceUsdCents=null`) → **CONGELADO** (el admin fijó pesos a mano).
- `priceUsdCents=null` sin override (proveedor nativo en MXN) → **CONGELADO** (no hay FX que aplicar).
- **Órdenes/compras:** el precio se **snapshotea** en la línea de la orden al comprar (`orders.buildLines` → `unitPriceCents`). Una orden pagada NO se mueve retroactivamente aunque cambie la FX.
- **Series históricas de tendencia** (gráfica de sellado `sealed-catalog` byDate; `SetValueSnapshot` diario; `PortfolioSnapshot` diario) → **CONGELADAS**: cada día conserva la FX con que se ingirió/snapshoteó. Solo el valor "hoy" (sin `asOf`) se recalcula vivo.

### 54.2 Invariantes money-safe
- `market > 0` siempre: si el recomputo no es finito o `<= 0`, cae al `priceMxnCents` almacenado.
- **Fallo de FX nunca rompe la valuación ni anula la referencia:** `fxSnapshotSafe()` captura errores de `FxService.getCurrent()` y devuelve `null` → se usa el `priceMxnCents` congelado (último válido).
- Redondeo consistente en centavos vía el helper existente `usdToMxnCents` (`common/money.ts`).
- **Sellado (autoprecio = mercado × spread):** el spread se aplica sobre el mercado YA convertido con la FX vigente (`getSealedMarketRef` → `getReference` → live), no sobre un MXN congelado.

### 54.3 Puntos tocados (todos en `backend/`)
- `pricing.service.ts`: nuevos `fxSnapshotSafe()` (público) y `liveMxnCents()`; `getReference` y `getReferencesBatch` recalculan el MXN vivo (FX izada 1 vez por request; el batch añade `priceUsdCents`/`isManualOverride` al `select`).
- `admin.service.ts` `ownedItemRefs` (ficha 360° viva): recalcula con FX vigente vía `pricing.liveMxnCents`.
- `set-value.service.ts` `computeSetValue`: valor "hoy" (sin `asOf`) recalcula vivo; con `asOf` (histórico/snapshot) queda congelado. Se inyectó `PricingService` (sin ciclo).
- Consumidores que ya pasan por `getReference`/`getReferencesBatch` heredan el fix sin cambios: buylist, inventory/bulk-publish, vault/holdings/admin-vaults, catalog/sealed-catalog listings, orders `salePriceOf`, admin finanzas/custodia, portfolio-snapshot (reusa `VaultService.holdings`).

### 54.4 Migración / backfill
**No se requiere migración ni backfill.** El schema ya tenía `priceUsdCents`/`fxRate`/`fxBufferPct`, y la
ingesta SIEMPRE poblaba `priceUsdCents` al convertir desde USD (`syncCardPrice`, `persistMarketReference`,
`persistSealedMarketReference`). Por tanto cualquier fila con `priceUsdCents=null` es legítimamente un
override manual o un precio nativo en MXN (ambos correctamente congelados). No hay que re-derivar ni borrar
nada. Las referencias de mercado USD ya existentes empiezan a valuarse vivas de inmediato (y cada ingesta
diaria repuebla `priceUsdCents`).

### 54.5 Contrato de API
**Sin cambios de shape.** Los DTO siguen exponiendo `referenceMxnCents`/`priceMxnCents`; solo cambia el
VALOR (ahora vivo para referencias USD). No se editó `docs/API_CONTRACT.md`.

### 54.6 Verificación
`npx tsc --noEmit` limpio · `npm run lint` limpio · `npm test` **1087 tests / 114 suites en VERDE**
(incluye el nuevo `test/pricing.fx-live.spec.ts`, 8 casos: recomputo vivo, cambio de tasa sin re-sync,
override/MXN congelados, fallo de FX → fallback, tasa `<=0` → fallback, batch, y sellado mercado×spread
sobre mercado vivo). Se ajustaron dos mocks existentes (`set-value.spec.ts`, `admin.pii.spec.ts`) para el
nuevo constructor/superficie de `PricingService`. Sin commit ni push (lo hace el orquestador).

---

## N-15 — `displayFinishes` (supresión de acabado espurio, DISPLAY-only) · rama `claude/pulido-precios-display`

Implementación EXACTA de ARCHITECTURE §4.22a-6 / API_CONTRACT changelog v1.22-2-finish-display. `availableFinishes`
(whitelist SEC-A1: valida `finish` y deriva el monto) NO cambia; se AÑADE el campo derivado DISPLAY-only
`displayFinishes: Finish[]` que el front usa para pintar casillas/tarjetas.

### Función pura compartida (UNA sola, sin duplicar)
`computeDisplayFinishes(rarity, availableFinishes, pricedFinishes)` en `backend/src/common/card-order.ts`
(zona compartida). Reusa `isPremiumRarity` de `common/money.ts` (NO se redefine la lista de rarezas) y
`orderFinishes` (FINISH_ORDER). Reglas: premium (`isPremiumRarity===true`) con `pricedFinishes≠∅` ⇒
`orderFinishes(availableFinishes ∩ priced)`; en cualquier otro caso ⇒ `availableFinishes`. Invariantes
garantizadas por construcción (el resultado se FILTRA de `availableFinishes`): `⊆ availableFinishes`, nunca
vacío (salvaguarda anti-cero-casillas: premium totalmente pendiente ⇒ `availableFinishes`), orden FINISH_ORDER.
SOLO RESTA, jamás AÑADE (un finish priceado fuera de la whitelist no aparece); `isPremiumRarity(null)===false`
⇒ sin supresión. NO inventa `reverse_holo` por rareza (VAR-1 §9 intacto).

`card-order.ts` pasa a importar `money.ts` — sin ciclo (`money.ts` no importa `card-order.ts`).

### `hasPricedRef` en LOTE (sin N+1)
Nuevo `PricingService.getPricedRawFinishesBatch(cardIds): Map<cardId, Set<Finish>>` — UNA query
(`productType='raw'`, `gradeKey='raw:NM'`, `priceMxnCents>0`, `distinct [cardId,finish]`). Es el mismo
por-acabado que alimenta `referenceValue`/quote. No aplica FX: solo interesa la EXISTENCIA de precio>0 para
display (el monto valuado no cambia; la invariante de ingesta `market>0` ya se refleja en `priceMxnCents`).

### Exposición en DTOs (aditiva, sin endpoints ni migración)
- `CardDTO += displayFinishes` — en `toCardDTO(card, pricedFinishes?)` (`catalog.service.ts`). Segundo parámetro
  OPCIONAL: omitido ⇒ conjunto vacío ⇒ sin supresión money-safe (premium cae a la salvaguarda; no-premium
  intacto). Los call-sites de catalog/quoter/master-set/vault SIEMPRE lo pasan (batch).
- `MasterSetCardCellDTO += displayFinishes` y `MasterSetVariantDTO += displayed` (`= finish ∈ displayFinishes`)
  en `master-set.service.ts` (`binder`). `variants` SIGUE trayendo una entrada por acabado de `availableFinishes`
  (universo de completitud X/Y = `expected/coveredVariantCount` sobre `availableFinishes`, SIN cambio);
  `displayed` solo indica cuál PINTA el render plano N-16.

### Call-sites tocados (todos evitan N+1)
- `catalog.service.ts`: `fetchSellable` (batch por card, threaded a `toListingDTO` vía ctx.pricedFinishes),
  `getCard` (batch de 1), `searchAllCards` (batch de la página — picker del cotizador).
- `vault.service.ts`: `holdings`, bóveda sellada y `holdingDetail` (batch antes del loop / batch de 1).
- `buylist.service.ts`: `adminRejectedItems` (batch de la página).
- `admin.service.ts`: lista de inventario — REUSA los `refs` YA cargados (deriva el set de acabados raw/`raw:NM`
  con `priceMxnCents>0` inline, SIN query extra).
- `master-set.service.ts`: `binder` (batch por cards del set).
- `sealed-catalog.service.ts` / `pricing/sealed-mapping.service.ts`: sin cambio (sellado siempre `finish=normal`;
  con el default vacío `displayFinishes = availableFinishes`, no-op deliberado).

### Verificación
`npx tsc --noEmit` limpio · `npm run lint` limpio · `npm test` **1096 tests / 115 suites en VERDE**.
Nuevo `test/display-finishes.spec.ts` (9 casos: función pura ex/full-art, common, salvaguarda ∅, rareza null,
orden FINISH_ORDER, SOLO-resta, default; + binder `displayed` por variante y X/Y intacto). Se ajustaron mocks
existentes que ahora rozan `getPricedRawFinishesBatch` (`master-set.service`, `master-set.scopes`, `catalog`,
`buylist-catalog`, `vault.holdings-withdrawal`, `vault-sealed`, `buylist.rejected-items`) y las aserciones
`toEqual` de `variants` en `master-set.scopes` (ahora incluyen `displayed`). Suites de finish/completitud NO
cambiaron su semántica (X/Y sigue sobre `availableFinishes`). Sin commit ni push (lo hace el orquestador).

## P-4 — Cierre de la SOLICITUD al rechazar ítems (v1.24-buylist-request-reject)

> Bug P-4 (ARCHITECTURE §9): `itemDecision('reject')` sólo tocaba el ÍTEM y nunca re-evaluaba
> `SellRequest.status` → rechazado el único ítem, la solicitud quedaba atorada en `verificacion`. El
> contrato v1.24 (API_CONTRACT §M5, ARCHITECTURE §4.18f/g) documenta **dos mecanismos**. Todo en
> `backend/src/modules/buylist/`. **Sin migración** (`closedAt` ya existe por SEC-D2/M-19).

### (f) Auto-transición — efecto de `itemDecision('reject')`
- Nuevo helper privado `BuylistService.maybeAutoRejectRequest(sellRequestId)`, invocado en la rama
  `decision==='reject'` **TRAS `recomputeApprovedTotal` y el correo best-effort** (justo antes del
  `return`). Determina "todos rechazados" con `sellRequestItem.count({ where: { sellRequestId,
  itemStatus: { not: 'rechazada' } } })` — si el conteo es `0`, transiciona. **`convertida_inventario`
  cuenta como ítem VIVO** (no-rechazado) ⇒ una solicitud con convertidos + rechazados **NO** se
  auto-rechaza.
- Transición con **guard «no pisar terminal»** vía `sellRequest.updateMany({ where: { id, status:
  { notIn: ['pagada','rechazada','abandonada'] } }, data: { status:'rechazada', closedAt: new Date() } })`
  — mismo patrón atómico que `paySpei`. **No** toca montos (BL-1 ya los sacó vía el recompute) **ni**
  envía correos (el correo por-ítem ya salió). Idempotente: el re-reject v1.18 retorna no-op ANTES de
  llegar al helper, y el `updateMany` no re-sella una solicitud ya terminal.

### (g) Cierre explícito — `POST /admin/buylist/:id/reject`
- Endpoint NUEVO en `admin-buylist.controller.ts` (`reject`), ruta literal `:id/reject` (POST, sin
  colisión). Roles heredados de la clase (`vault_operator`/`super_admin`), **SIN `@MoneyOut`** (no es
  dinero saliente). Auditado `action: 'buylist.reject'` con `reason?` interno (no PII) en `after`.
- Método `BuylistService.rejectRequest(id, reason?)` → `{ request, transitioned }` (`request` = shape de
  `adminGet`, Res 200 del contrato). Guard de precondición: cierra **sólo si TODOS** los ítems ya están
  `rechazada`; si queda ≥1 vivo → **`422 REQUEST_HAS_NON_REJECTED_ITEMS`** con
  `details.nonRejectedItemStatuses: SellItemStatus[]` (status vivos, deduplicados). **Idempotente**: ya
  `rechazada` → `200` con estado actual, `transitioned=false` ⇒ el controller **NO audita** como cambio.
  Otro terminal (`pagada`/`abandonada`) → **`409 CONFLICT`** con `details.status`. `404` si no existe.
- Nuevo error code `REQUEST_HAS_NON_REJECTED_ITEMS` en `common/error-codes.ts` (sección Buylist). DTO
  `RejectRequestDto { reason?: string }` (`@IsOptional @IsString @MaxLength(500)`; body `{}` válido).

### Verificación
`npx jest buylist` → **137 tests / 17 suites en VERDE**; `npx tsc --noEmit -p tsconfig.json` limpio.
Nuevo `test/buylist.request-reject.spec.ts` (9 casos: auto-transición al rechazar el último ítem;
NO-transición con ítem `aprobada`/`convertida_inventario` vivo; no-op idempotente; `rejectRequest`
éxito/422/idempotente/409 `pagada`/409 `abandonada`/404). Se añadieron stubs `sellRequestItem.count` y
`sellRequest.updateMany` a los mocks de `buylist.reject.spec.ts` y `buylist.ronda-c.spec.ts` (default
`count=1` ⇒ no dispara la transición en esos tests item-céntricos). Sin commit ni push (orquestador).

### Endurecimiento post-aprobación (atomicidad intra-método) — no cambia contrato

> QA/techlead/seguridad aprobaron P-4 con hallazgos NO bloqueantes que convergen en una raíz: el
> chequeo «¿todos los ítems rechazados?» y la escritura del `status` de la solicitud eran awaits
> secuenciales NO atómicos, aunque ARCHITECTURE §4.18f afirma «mismo transaction boundary» (drift
> doc↔código). Cierre acotado, espejando patrones YA aprobados del propio servicio. **Sin cambio de
> contrato ni de firma pública** (`{ request, transitioned }` intacto).

- **Constante única de terminales.** Se extrajo `['pagada','rechazada','abandonada']` a
  `SELL_REQUEST_TERMINAL_STATES` en `buylist-reject.constants.ts` (fuente única). La reusan
  `maybeAutoRejectRequest` y `rejectRequest` (incluida la guarda 409 `pagada`/`abandonada`, ahora
  `includes` porque `rechazada` ya se resolvió como idempotente arriba). **No** se reapuntó el
  `CLOSED` propio de `src/jobs/ine-retention.service.ts` (mismo set): vive en zona `src/jobs/` de otro
  stream ⇒ deuda menor anotada (misma política que el `buylist-sweep` inline 7/30).
- **Atomicidad intra-método.** En AMBOS métodos, «leer conteo/ítems no-rechazados» + «actualizar el
  `status`» van ahora en UN `$transaction(..., { isolationLevel: Serializable })` (igual que
  `createRequest`/SEC-A2), usando el cliente `tx`. Esto hace verdadera la afirmación de §4.18f («mismo
  transaction boundary»).
- **Verificación de `res.count` en `rejectRequest`** (espejo de `paySpei`). Tras el `updateMany` con
  guarda de estado, si `count===0` re-lee la solicitud dentro de la tx: si quedó `rechazada` ⇒
  idempotente (`transitioned:false`, 200, **sin** auditar como cambio); si otro terminal
  (`pagada`/`abandonada`) ⇒ `409 CONFLICT` con `details.status`. Nunca se reporta `transitioned:true`
  cuando el update no cambió nada (elimina la entrada de auditoría fantasma que señaló el techlead).
- **Preservado:** guard «no pisar terminal», `convertida_inventario` = vivo, BL-1, idempotencia v1.18,
  shape de respuesta = `adminGet`. Se agregó stub `$transaction:(fn)=>fn(tx)` a los mocks de
  `buylist.request-reject`/`buylist.reject`/`buylist.ronda-c` specs, y dos casos nuevos del count-guard
  de `rejectRequest` (count:0 + re-lectura `pagada` ⇒ 409; re-lectura `rechazada` ⇒ idempotente).
- **Verificación real:** `npx jest buylist` → **139 tests / 17 suites en VERDE**;
  `npx tsc --noEmit -p tsconfig.json` limpio. Sin commit ni push (orquestador).

---

## P-5 — Paginación server-side + filtros en colas admin M5/M3 (v1.25-buylist-orders-pagination)

Contrato ADITIVO del arquitecto (§Convenciones «Filtros de lista admin», §M5, §M3). TODOS los params
nuevos son OPCIONALES; **omitirlos = comportamiento IDÉNTICO al de hoy** (sin migración de datos).
Mismos nombres en ambos endpoints: `q`, `from`, `to`, `minCents`, `maxCents`, `page`, `pageSize`.

### Helper transversal
- **`backend/src/common/admin-list-filters.ts` (NUEVO):** `parseAdminListFilters(raw)` parsea+valida
  `page`/`pageSize`/`q`/`from`/`to`/`minCents`/`maxCents` y devuelve `{ page, pageSize, q?, dateRange?,
  centsRange? }` ya normalizados. **Toda entrada inválida → `400 VALIDATION_ERROR`** (`BusinessException.
  badRequest`, NO el 422 de `.validation`), nunca un clamp silencioso: paginación no numérica / `<1` /
  `pageSize>100`, fecha no parseable, monto no entero o negativo, `maxCents<minCents`, `q>200` chars.
  `q` se hace `trim`; vacío/whitespace ⇒ ausente. La construcción del `where` (columnas de monto/fecha,
  campos del OR de `q`, CSV de `status`) NO vive aquí porque difiere por endpoint — el helper sólo
  entrega valores validados. Reusado por AMBOS controllers (consistencia A↔B).

### Borde de día en `from`/`to` (v1.25.1 — aclaración de semántica de fecha, aditiva)
Contrato §Convenciones «Borde de día» + §M5 + §M3. Materializado en un ÚNICO punto —
`parseDate` de `admin-list-filters.ts` — así que arregla M5, M3 y el caso latente de orders de una vez
(sin duplicar lógica en los controllers). Reglas:
- **date-only** (`^\d{4}-\d{2}-\d{2}$`, lo que emite `<input type=date>`) → ancla al **borde del día
  en UTC**: `from` = `00:00:00.000Z` (inicio), `to` = `23:59:59.999Z` (**fin de día INCLUSIVO**). Así
  `to=YYYY-MM-DD` incluye todo lo cerrado ese mismo día (antes, tratado como medianoche UTC, excluía
  casi toda la jornada money-adjacent).
- **datetime ISO completo** (con hora/offset, p. ej. `2026-08-20T15:00:00Z`) → se usa **TAL CUAL**,
  sin ajuste (`gte`/`lte` exactos).
- Detección date-only con match estricto; una date-only inválida (`2026-13-40`) sigue cayendo en el
  chequeo `NaN` → `400 VALIDATION_ERROR`. **Rango invertido** (`from>to`) NO es error → simplemente
  devuelve vacío (lo resuelve la BD). El `where.createdAt` resultante sigue siendo `{ gte, lte }` de
  `Date` — buylist `adminList` y orders `list` lo montan sin cambios.

### A) `GET /api/v1/admin/buylist` (§M5)
- **`admin-buylist.controller.ts::list`** (`backend/src/modules/buylist/admin-buylist.controller.ts:27`):
  añade `@Query` `q`, `from`, `to`, `minCents`, `maxCents` (declarados **al final** para no alterar el
  orden posicional de los params existentes); delega validación a `parseAdminListFilters` y pasa el
  objeto `{ q, dateRange, centsRange }` al servicio.
- **`BuylistService.adminList`** (`backend/src/modules/buylist/buylist.service.ts:557`): firma extendida
  con 5º param opcional `filters?`. Construcción del `where`:
  - **`status` → CSV → `IN`:** split por coma + trim; **1 token ⇒ escalar `where.status = token`
    (IDÉNTICO a hoy)**, ≥2 tokens ⇒ `{ in: [...] }` (pestaña «Cerradas» = `pagada,rechazada,abandonada`
    en una llamada). Token que no sea `SellRequestStatus` válido → `400 VALIDATION_ERROR` con
    `details.invalidStatus: string[]`. (Escalar en el caso 1-token es deliberado: preserva el
    `toEqual({status:'cotizada'})` del spec `admin.user-audit` y el shape de respuesta previo.)
  - **`q` → OR** `contains` `mode:'insensitive'` sobre `SellRequest.id` (folio) + `user.name` +
    `user.email` (join `user` ya existente). **NO** busca CLABE/RFC/INE ni datos de pago.
  - **`from`/`to` → `where.createdAt` gte/lte**; **`minCents`/`maxCents` → `where.quotedTotalCents`
    gte/lte** (snapshot histórico `Int @default(0)`, SIEMPRE presente — NO `approvedTotalCents`, que es
    nullable y excluiría las rechazadas/abandonadas que dominan «Cerradas»).
  - `pageSize` default **20 sin cambios** (máx 100); orden `createdAt desc` y respuesta
    `{ data, page, pageSize, total }` intactos.

### B) `GET /api/v1/admin/orders` (§M3)
- **`admin-orders.controller.ts::list`** (`backend/src/modules/orders/admin-orders.controller.ts:31`):
  `where` inline (sin cambio de servicio). Añade `@Query` `q`, `minCents`, `maxCents` **al final**
  (posiciones 9/10/11) para no romper las llamadas posicionales del spec `admin-orders.needs-manual`.
  Todo lo existente (`status`/`userId`/`from`/`to`/`guest`/`needsManual`/`page`/`pageSize`) intacto.
  - **`q` → OR** `contains` `mode:'insensitive'` sobre `orderNumber` + `guestEmail` + `user.name` +
    `user.email`, **más `userId` EXACTO** (`{ userId: q }`). Cubre invitado (`guestEmail`) y con cuenta
    (`user.*`/`userId`). Se usa la relación `Order.user` (nullable) como filtro — **sin `include`**
    extra (Prisma filtra por relación sin traerla). No busca `paymentMethodLast4`.
  - **`minCents`/`maxCents` → `where.totalCents` gte/lte** (total canónico `Int` de la orden).
  - `from`/`to` migrados al `dateRange` del helper (misma semántica gte/lte sobre `createdAt`).

### Seguridad
Todos los filtros **sólo REDUCEN** el conjunto ya autorizado por el guard de rol
(`vault_operator`/`super_admin`, heredado de la clase) — no habilitan IDOR ni enumeración cruzada, no
cambian shape ni proyección PII. Todo vía Prisma parametrizado (`contains`/`in`/`equals`), **nunca SQL
crudo interpolado**. `q` no toca datos cifrados/enmascarados (CLABE/RFC/INE/pago).

### Índice compuesto recomendado — FOLLOW-UP DIFERIDO (coordinación de zona compartida)
El arquitecto recomendó `@@index([status, createdAt])` en `SellRequest` y `Order`
(ARCHITECTURE §4.18(h)/§4.21(l)) para las nuevas colas paginadas+filtradas. **NO se escribe aquí:**
`backend/prisma/schema.prisma` y `backend/prisma/` son **zona compartida** con otro stream en paralelo;
el índice se posterga a un **pase de schema coordinado**. Los índices existentes
(`@@index([status])`, `@@index([userId])`, `@@index([guestEmail])`) bastan para el MVP. **Backend deja
pendiente** añadir los compuestos en ese pase coordinado (no es deuda de diseño — ya está en
ARCHITECTURE; es una nota de secuenciación por zona compartida).

### Discrepancia menor con el contrato (para el arquitecto)
- **Paginación inválida → 400 (antes clamp):** el contrato v1.25 pide `page`/`pageSize` no numéricos o
  `pageSize>100` → `400 VALIDATION_ERROR`. El código PREVIO de ambos listados hacía **clamp** silencioso
  (`Math.min(100, Math.max(1, …))`). Se alineó a `400` (helper) por fidelidad al contrato y consistencia
  A↔B. Cambio de comportamiento **sólo para entradas inválidas** (valores válidos, incluido el
  `pageSize=25` que pide el front, no se ven afectados). Si el arquitecto prefiere mantener el clamp
  legacy, es un ajuste de una línea en el helper.

### Verificación real
- `npx jest buylist orders` → **23 suites / 196 tests en VERDE** (incluye los 2 specs nuevos:
  `test/buylist.admin-list-filters.spec.ts` — 9 casos: status CSV→IN, 1-token escalar, status inválido
  →400, `q` OR, from/to, minCents/maxCents sobre quotedTotalCents, skip/take, where vacío por defecto,
  combinación; `test/admin-orders.list-filters.spec.ts` — 9 casos: `q` OR, totalCents, combinación con
  filtros existentes, default idéntico, from/to, y 4 de validación →400).
- `npx jest admin.user-audit` → 15/15 VERDE (no se rompió el spec de firma de `adminList`).
- `npx tsc --noEmit -p tsconfig.json` → **limpio** (sin salida).
- **v1.25.1 borde de día:** `npx jest buylist orders admin-list` → **24 suites / 208 tests VERDE**.
  Nuevo spec unitario del helper `test/admin-list-filters.date-boundary.spec.ts` (9 casos: `to`
  date-only→fin de día inclusivo, `from` date-only→inicio, rango date-only, datetime completo/offset
  tal cual, `where` sigue `{gte,lte}`, date-only inválida→400, no parseable→400, rango invertido no es
  error). Más 1 caso de integración en cada spec de listas (`buylist.admin-list-filters` vía controller,
  `admin-orders.list-filters` vía controller) confirmando que un `to` date-only incluye una fila de esa
  misma tarde. `tsc --noEmit` limpio.
- Sin commit ni push (orquestador).

## P-7 — Gate `backend-e2e` en verde: fixtures del webhook `payment_intent.succeeded` + H1 lee `amount_received` (rama `claude/backend-e2e-payment-fixtures-77mo4t`, 2026-08-21)

### Qué estaba roto
37 tests e2e en rojo: los fixtures de webhook `payment_intent.succeeded` mandaban
`data.object = { id, object: 'payment_intent' }` SIN `amount` ni `currency`. El guard H1
(`payments.service.ts`, defensa en profundidad antes de liquidar) comparaba contra
`order.totalCents`/`'mxn'`, recibía `undefined undefined`, NO liquidaba → la orden quedaba
`pending`, no se creaba el `ShipmentRequest` y el helper `paidOrder` de `guest-chargeback`
explotaba en cascada (`Cannot read properties of null (reading 'id')`). El guard hizo
EXACTAMENTE su trabajo: los fixtures eran los rotos, no el guard.

### Decisión de diseño: H1 valida `amount_received` (capturado) con fallback a `amount`
```ts
const receivedCents = pi.amount_received ?? pi.amount;
if (receivedCents !== order.totalCents || pi.currency !== 'mxn') { /* NO liquida + audita */ }
```
Razón: en Stripe real, para un PaymentIntent `succeeded`, `amount` es lo SOLICITADO y
`amount_received` lo efectivamente CAPTURADO. Con captura parcial (`amount_to_capture <
amount`) el PI emite `succeeded` con `amount` intacto: validar `amount` liquidaría una orden
por la que entró menos dinero. Validar lo capturado es la semántica correcta de un guard
money-safety. Detalles deliberados:
- Fallback `??` (no `||`): un `amount_received === 0` NO cae a `amount` (0 capturado no
  liquida). El fallback solo cubre payloads sin el campo (mocks/eventos slim), manteniendo
  compatibilidad con los specs unitarios existentes que solo mandan `amount`.
- El log H1 y el AuditLog `order.settle_amount_mismatch` reportan `receivedCents` (el valor
  que el guard comparó), no `pi.amount` crudo.
- Unitarios nuevos en `src/modules/payments/h1-settle-amount.spec.ts`: captura parcial con
  `amount` cuadrando → NO liquida; `amount_received` cuadrando con `amount` raro → liquida;
  `amount_received: 0` → NO liquida.

### Fixtures e2e (todos los `payment_intent.succeeded` de `test/integration/`)
Ahora mandan `amount`, `amount_received` y `currency: 'mxn'` con el **total REAL** de la
orden creada en cada test (nada hardcodeado):
- `catalog-checkout-webhook.e2e-spec.ts` — `orderTotalCents` leído de la Order en BD tras crear la sesión.
- `guest-checkout.e2e-spec.ts` — `res.body.breakdown.totalCents` de la sesión de invitado
  (variable de suite + retorno `totalCents` en `makeStaleGuestOrder`).
- `guest-chargeback.e2e-spec.ts` — `pendingOrder()` ahora retorna `totalCents` del breakdown; `paidOrder()` lo usa.
- `vault-shipments.e2e-spec.ts` — pago de un ENVÍO (no hay Order, H1 no aplica ahí), pero el
  fixture manda el `totalCents` del `ShipmentRequest` por realismo/futuro-proofing.

### Verificación real (local, replicando CI: Postgres 16 + Redis + migrate deploy + seed sintético)
- `npm run test:integration` → **9 suites / 124 tests VERDE** (incluye las 4 afectadas).
  Nota: sin `S3_ENDPOINT` local el smoke de MinIO firmaba contra AWS real vía proxy (403);
  con las `S3_*` de CI apuntando a `localhost:9000` el spec se salta solo, como está diseñado.
- `npm test` (unit) → **137 suites / 1259 tests VERDE**. `npm run typecheck` limpio.
- `npm run lint` → 0 errores (1 warning preexistente en `buylist.service.ts`, ajeno a este cambio).

## Stream A v1.27 — P-13 variantes fantasma + P-15 mercado por variante + P-12 force en sync por set (rama `claude/backend-e2e-payment-fixtures-77mo4t`, 2026-08-21)

Implementación backend de ARCHITECTURE §4.25 / API_CONTRACT Changelog v1.27. **SIN cambios de
schema ni de `prisma/`** (M-27/M-29 ya existían). Paso de despliegue pendiente (devops/humano):
re-sync forzado único (§4.25a-4) + `POKEMONPRICETRACKER_FETCH_PRINTINGS=true`.

### P-13 — «el precio CONFIRMA, nunca AÑADE» (§4.25a)
- **`common/card-order.ts`:** `unionAvailableFinishes(structural, snapshot)` ELIMINADA y sustituida
  por `composeAvailableFinishes(structural)` = `structural ≠ ∅ ? orderFinishes(structural) : ['normal']`.
  Nadie más la importaba (verificado con grep); los seeds no la usan.
- **`catalog/finish-reconciler.service.ts`** (sigue siendo el ÚNICO escritor): usa la fórmula nueva.
  `pricedFinishesSnapshot` se sigue LEYENDO pero solo para observabilidad: log **`pricedNotStructural`**
  (= snapshot ∖ structural, pares `cardId:finish`, cap a 20 en el mensaje) — evidencia de drift
  proveedor↔estructura, jamás compone.
- **P-13.2 — filas forzadas de `fetchPrintings`:** `BulkPriceRow` gana `forcedPrinting?: boolean`
  (`pricing.types.ts`). El provider PPT marca las filas del modo por-impresión con
  `forcedPrinting: true` y `finishAliasVerified: false` (antes se auto-verificaba contra la propia
  etiqueta del request). En `price-ingest`, las filas forzadas se EXCLUYEN del cómputo del snapshot;
  si TODAS las filas de una carta son forzadas (corrida fetchPrintings pura), **su snapshot NO se
  escribe** (ni se limpia: una corrida por-impresión no aporta ni retira evidencia del modo lista —
  decisión dentro del margen de §4.25a-2, conserva el valor previo del modo lista como
  observabilidad). El reconcile SÍ corre igual para esas cartas (idempotente; además repara
  `availableFinishes` stale con la fórmula nueva en cada price-ingest, incluso antes del re-sync).
  El modo LISTA (`primaryPrinting`) sigue alimentando el snapshot como hasta ahora.
- **Nota para QA/devops (datos e2e) — RESUELTA (2026-08-21, pase techlead-gate):** el fixture
  `e2e-fixtures.ts › reverse` ya declara `structuralFinishes: ['normal','reverse_holo']` (y el seed
  de desarrollo `seed.ts › Pidgey base1-16` igual): los seeds quedaron CONSISTENTES con
  `composeAvailableFinishes` y un reconcile sobre ellos es NO-OP (no colapsa casillas). El snapshot
  `['reverse_holo']` se conserva como decoración/observabilidad (el precio confirma el reverse).
  Detalle en §«Pase techlead-gate Stream A» más abajo. Sigue sin tocarse el schema de `prisma/`.

### P-15 — mercado por VARIANTE en el Master Set (§4.25b)
- **`inventory/master-set.service.ts`:** `MasterSetVariantDTO += marketReferenceMxnCents?: number|null`
  y `capturedDate?: string|null` (presente SOLO con precio). El lote de `getReferencesBatch` se
  expandió de (1 clave por carta, acabado base) a **(carta × acabado de `expectedFinishes`)** —
  sigue UNA query (el batch ya aceptaba lista). `getReferencesBatch` YA devolvía `capturedDate` en
  `PriceInfo` → **no hizo falta tocar `pricing.service.ts`**.
- Campo de CELDA `MasterSetCardCellDTO.marketReferenceMxnCents`: DEPRECADO, emitido como espejo
  exacto de `variants[0].marketReferenceMxnCents` (costo cero, mismo batch). Retiro en la siguiente
  rev de contrato.
- Aplica a los 3 scopes del binder (misma agregación); `resolveBuyables` (2ª llamada al batch, solo
  vista cliente) queda intacto.

### P-12 — `force` en `POST /admin/catalog/sync` (§4.25c)
- **`admin-catalog.controller.ts`:** `SyncDto += force?: boolean` (default `false`); se registra
  `force` en el detalle de auditoría de `catalog.sync`.
- **`catalog-sync.service.ts`:** `sync(setId?, fromReleaseDate?, force=false)`. Modo single:
  `importSetByExternalId` gana el MISMO gate `firstImport || force` que `importSet` (antes esta ruta
  JAMÁS corría el resolver, ni siquiera en first-import — asimetría cerrada con paridad completa).
  Modo from_date: propaga `force` a `importSet` (gate ya existente). El paso resolver se extrajo al
  helper `runStructuralResolver(localSetId, externalId)` (best-effort: fallo TCGCSV ⇒ log warn,
  conserva previo, NO aborta el import; no-op si el resolver `@Optional` no está cableado).

### Tests (nuevos/actualizados)
- `test/finish-reconciler.spec.ts` — reescrito a la fórmula §4.25a: ex holofoil con `normal`
  priceado ⇒ UNA casilla (el fantasma stale se elimina); el precio ya no rescata; legacy vacío ⇒
  `['normal']` aunque el snapshot traiga acabados; log `pricedNotStructural`; idempotencia.
- `src/modules/pricing/providers/pokemonpricetracker-bulk.fix-ppt.spec.ts` — filas forzadas:
  `finishAliasVerified=false` + `forcedPrinting=true`; modo lista sin `forcedPrinting`.
- `test/price-ingest.service.spec.ts` — corrida forzada pura: precios sí / snapshot intacto /
  reconcile sí; mezcla lista+forzada: snapshot SOLO con la evidencia del modo lista.
- `test/master-set.market-reference.spec.ts` — reescrito: mercado por variante (Normal ≠ Reverse),
  `capturedDate` solo con precio, espejo de celda = `variants[0]`, lote carta×acabado en UNA llamada.
- `test/master-set.scopes.spec.ts` — 3 aserciones `variants` actualizadas (+`marketReferenceMxnCents: null`).
- `test/catalog-sync.structural.spec.ts` — sigue verde SIN cambios en sus casos previos; describe
  nuevo P-12: force corre resolver aunque no sea first-import; sin force no; first-import sí;
  best-effort ante fallo TCGCSV.

### Verificación real (local, replicando CI: Postgres 16 + Redis + migrate deploy + seed sintético + S3_* de CI)
- `npm run typecheck` → limpio.
- `npm run lint` → 0 errores (1 warning preexistente en `buylist.service.ts`, ajeno).
- `npm test` (unit) → **137 suites / 1267 tests VERDE**.
- `npm run test:integration` → **9 suites / 124 tests VERDE** (los 124 del gate backend-e2e intactos).

## Pase techlead-gate Stream A v1.27 — seeds consistentes post-P-13 + comentarios normativos (rama `claude/backend-e2e-payment-fixtures-77mo4t`, 2026-08-21)

Correcciones acotadas a los DOS ítems MAYORES del veredicto del techlead sobre el Stream A (el
diseño de P-13/P-15/P-12 quedó aprobado; aquí NO se cambió ninguna lógica de producción — solo
datos de seed y comentarios).

### Ítem #1 — seeds con estado imposible post-v1.27 (corregido)
- **`prisma/seed.ts` (Pidgey `base1-16`):** pasaba `structuralFinishes: ['normal']` +
  `pricedFinishesSnapshot: ['reverse_holo']` + `availableFinishes: ['normal','reverse_holo']` —
  inconsistente con `composeAvailableFinishes` (el primer reconcile lo colapsaba a UNA casilla).
  Ahora `structuralFinishes: ['normal','reverse_holo']` (la forma post-v1.27 de tener dos casillas:
  TCGCSV resolvió ambas impresiones); el snapshot `['reverse_holo']` queda como
  decoración/observabilidad (el precio CONFIRMA el reverse) y el docblock ilustra «la estructura
  manda, el precio confirma» en vez del rescate derogado.
- **`prisma/e2e-fixtures.ts` (`E2E_CARDS.reverse`):** mismo arreglo — declara
  `structuralFinishes: ['normal','reverse_holo']`; docblock del «rescate por PPT» reescrito a la
  doctrina §4.25a. `catalogFinishes: ['normal']` se conserva a propósito (señal débil write-only que
  nadie lee en producción). `availableFinishes` final IDÉNTICO ⇒ ningún total/página de las suites
  de dinero cambia.
- **`prisma/seed-e2e.ts`:** comentarios de `seedCards` actualizados a la fórmula vigente (la
  mecánica `structuralFinishes ?? catalogFinishes` ya soportaba la declaración; solo cambió el dato
  del fixture y el texto).
- **Mínimo normativo §4.22e confirmado:** el seed de desarrollo conserva ≥1 carta de DOS casillas
  (Pidgey, ahora estructural) y ≥1 de UNA casilla (Charizard holofoil puro); el sintético igual
  (`reverse` dos casillas / resto una; `orderTwo` cubre el caso en `E2E_ORDER_SET`).

### Ítem #2 — comentarios normativos derogados en `catalog-sync.service.ts` (corregido)
- Docblock de `upsertCards`: `Card.catalogFinishes` ya NO se titula «AUTORIDAD» — es una columna
  write-only de señal débil (nadie la lee en producción); la fórmula del reconcile citada pasó de la
  derogada `orderFinishes(catalogFinishes ∪ pricedFinishesSnapshot) || ['normal']` a la real
  `composeAvailableFinishes(structuralFinishes)` (v1.27 §4.25a).
- Comentario previo al `reconcile(touchedCardIds)`: misma corrección de fórmula.

### Deuda registrada (docs/TECH_DEBT.md, sección «Stream A v1.27 … veredicto techlead»)
`SA-D2` (Alta: `getReferencesBatch` sin acotar histórico, amplificado por P-15 — enlazada a
BE-20/BE-35, disparador de BE-35 actualizado), `SA-D1` (Media: `catalogFinishes` write-only, retiro
decide arquitecto), `SA-D3` (Media: escrituras secuenciales por carta bajo request síncrono, P-12 +
202 síncrono), `SA-D5` (Baja: gate estructural duplicado), `SA-D6` (Baja: convención de `force`
inconsistente en el controller).

### Verificación (local, replicando CI)
- `npm run typecheck` → limpio. `npm run lint` → 0 errores (1 warning preexistente ajeno).
- `npm test` → **137 suites / 1267 tests VERDE**.
- `npm run test:integration` (Postgres 16 + Redis locales + S3_* de CI) → **9 suites / 124 tests
  VERDE**; el re-seed idempotente CORRIGIÓ la fila vieja del fixture en la BD compartida
  (verificado en Postgres: `e2e-reverse` ⇒ `structural={normal,reverse_holo}`,
  `available={normal,reverse_holo}`, snapshot `{reverse_holo}` decorativo).

## Stream B v1.28 — FASE 1: M-30 `VariantPriceOverride` + P-18 consola de tres precios (rama `claude/backend-e2e-payment-fixtures-77mo4t`, 2026-08-21)

> Spec: ARCHITECTURE **§4.26** (a, b, i, j) · contrato **v1.28** (§M2 `variant-controls`, §6 quote,
> §DTOs `VariantPricingDTO`/`MasterSetVariantDTO.pricing?`). Alcance de la fase (orden §4.26j):
> **M-30 → P-18**. P-19/P-17/P-22 (vitrina+conteo)/P-24/P-25/P-20 vienen en fases siguientes.
> Toca DINERO en las dos direcciones → gate de seguridad por release.

### M-30 — migración `20260821172210_m30_variant_price_override`
- Generada con el tooling del repo (`prisma migrate dev --create-only` + anotación + apply), NO a
  mano. **Aditiva pura**: una tabla nueva + relación en `Card`; cero cambios a tablas existentes.
  Nace vacía ⇒ sin filas el comportamiento es EXACTAMENTE el previo (regresión cubierta por tests).
- Modelo tal como §4.26a: `@@unique[cardId, productType, gradeKey, finish]` (espejo de
  `PriceReference` menos `capturedDate`), `@@index[bountyEnabled]`, campos sell/buy override +
  bounty (enabled/price/target/acquired/completedAt) + `updatedBy` (patrón AuditLog sin FK dura).

### P-18 — resolver ÚNICO por cara (dónde vive cada cosa)
- **`common/money.ts` (lock §4.26i, cambios ADITIVOS):**
  - `quoteAcquisitionForFinish(..., controls?)` — COMPRA: `bounty > override > regla > precio_pendiente`.
    Bounty/override actúan como `fixed` (siempre `cotizada`, no dependen de la referencia).
    `AcquisitionRuleSource = 'bounty'|'override'|'rule'|'fallback'` (tipo nuevo, aditivo).
  - `computeSalePriceForRarity(..., controls?)` — VENTA: `sellOverride > regla > pending`. El paso 1
    (`listPriceCents` POR PIEZA) lo aplican los CALLERS antes, como siempre (intacto).
  - **Regla de presencia money-safe (doctrina H-1):** un monto de control `<= 0` es input degenerado
    ⇒ se trata como AUSENTE (jamás se ofrece/cobra $0 por dato corrupto). El write lo rechaza (422).
- **`pricing.service.ts`:** `getVariantOverridesBatch` (UNA query por request, patrón
  `getReferencesBatch`, mapa por `cardId|productType|gradeKey|finish`), `getVariantOverride`
  (single, delega en el batch), `loadBuylistRules` (espejo de `loadSalesRules`, para
  consola/binder) y `computeSalePriceForItem(..., controls?)`.
- **`pricing/variant-pricing.ts` (NUEVO):** `composeVariantPricing` — composer PURO del
  `VariantPricingDTO` (sugerido=regla sola; efectivo=precedencia completa; `source='pending'`
  cuando nada resuelve; bloque `bounty` SOLO si existe fila). Lo comparten la respuesta del PUT y
  el binder — un solo cuerpo, cero duplicación.
- **`pricing/variant-controls.service.ts` (NUEVO) + `PUT /admin/pricing/variant-controls/:cardId/:finish`**
  (PricingController, hereda `@Roles(super_admin)`):
  - Validación MANUAL (el body distingue OMITIDO=no tocar de `null`=limpiar, cosa que
    class-validator no expresa; DTO con `@Allow()` para sobrevivir al whitelist del pipe global).
    Códigos del contrato: `VALIDATION_ERROR` (sealed/gradeKey/centavos/targetQty),
    `FINISH_NOT_AVAILABLE` (SEC-A1 contra `Card.availableFinishes`), `BOUNTY_PRICE_REQUIRED`,
    `BOUNTY_BELOW_RULE` (regla `<` estricta; sugerido `pending` ⇒ se acepta), `404 NOT_FOUND`.
  - Upsert parcial sobre la clave única; **fila con todo vacío se BORRA** (equivalente observable a
    «sin fila») SALVO que tenga historia de bounty (`acquiredQty>0`/`completedAt`) — «apagar no
    borra el contador». AUDITADO `pricing.variant_controls` con before/after. NO toca
    `PriceReference` ni resuelve `PendingPriceEntry` (el mercado es otra perilla).
  - Respuesta = estado RESUELTO tras el write (`VariantControlsResponse` con el mismo
    `VariantPricingDTO` del binder).
- **Bounty en esta fase:** persistencia + validaciones + precedencia en el resolver de compra (los
  3 consumidores del quote ya lo honran y `createRequest` snapshotea `ruleSource='bounty'`, lo que
  deja listo el conteo del pago M5). La vitrina `GET /buylist/bounties` y el conteo/auto-off
  transaccional son **P-22 (fase siguiente)**.

### Integración en los puntos de resolución (consumidores §4.26b — todos migrados)
- **COMPRA** (`buylist.service.ts`): `publicQuote` (single), `batchQuote` y `createRequest`
  (overrides EN LOTE, una query por request) pasan la fila M-30 a `quoteCardForFinish` →
  `quoteAcquisitionForFinish`. `appliedRule.source` gana `"bounty"|"override"` (quote, batch y
  `SellItemDTO.appliedRule`); `createRequest` snapshotea `ruleSource` con esos valores. Topes de
  buylist SIN cambio (aplican igual a montos bounty). La clave del lookup usa `gradeKeyFor` +
  finish default `normal` — paridad exacta con la clave de la referencia.
- **VENTA** (resuelta en LECTURA ⇒ efecto inmediato, nada que re-publicar):
  - `catalog.fetchSellable`/`toListingDTO` (batch por lote + fallback single);
  - `orders.salePriceOf` (checkout auth + guest — cobra EXACTO lo que publica el storefront);
  - `inventory.bulkPublish` (rama derivada raw/graded; overrides en lote);
  - `master-set.resolveBuyables` (el `buyable` del binder = precio del storefront).
  En TODOS: `listPriceCents` por pieza sigue ganando; sellado conserva su cadena H-1 intacta
  (P-18 NO aplica a `sealed`); BE-26 sigue (efectivo `<=0` ⇒ no vendible).
- **Binder (M1):** `MasterSetVariantDTO.pricing?` SOLO scope `platform` — en `user_vault`/«Mi
  bóveda» ni se computa ni viaja (ni siquiera se consulta la tabla M-30 ni las reglas de compra:
  cubierto por test). Lotes izados una vez (buy+sell rules + overrides + refs) — sin N+1.

### Decisiones dentro del margen de la spec (documentadas para el arquitecto/techlead)
1. **`gradeKey` raw = `raw:NM` estricto** en el PUT (422 otro valor): `RawCondition` solo tiene NM
   (§3.5) y es el canónico de `buildGradeKey`; evita filas huérfanas imposibles de resolver.
2. **Re-encender un bounty limpia `bountyCompletedAt`** (re-armado ≠ completado; el aviso de M1
   sale de `completedAt`) y CONSERVA `bountyAcquiredQty` (doctrina «apagar no borra el contador»).
3. **`bounty` no-null sobre `productType=graded` → 422** (estricto; `bounty:null` sí se acepta en
   graded porque no habilita nada). Sell/buy overrides en graded SÍ aplican (misma tabla).
4. **`buylistRules()` de BuylistService NO delega** en `loadBuylistRules` (mismas SettingKey, misma
   forma): delegar rompía ~10 specs que configuran reglas vía `settings.getRaw` — churn sin valor.
   El «un solo núcleo» normativo es la MATEMÁTICA (`quoteAcquisitionForFinish`), que sí es única.
5. **Cap BE-27 en el write** (`> MAX_CENTS` ⇒ 422) además del clamp de lectura: una fila Int32
   jamás se persiste desbordada.

### Tests nuevos (todos verdes) + mocks actualizados
- `test/money.variant-controls.spec.ts` — precedencias puras de las DOS caras (empates, ausencias,
  degenerados <=0, clamp BE-27, no-contaminación buy↔sell, regresión sin controls).
- `test/pricing.variant-controls.spec.ts` — endpoint/servicio: validaciones del contrato, PATCH
  parcial (omitido≠null), borrado de fila vacía (y NO-borrado con historia de bounty), auditoría
  before/after, respuesta resuelta, `composeVariantPricing`.
- `test/pricing.variant-overrides-batch.spec.ts` — lote M-30: una query, filtro wanted-set (el
  producto cartesiano de los IN no cuela filas), single delega en batch.
- `test/buylist.variant-overrides.spec.ts` — quote/batch/createRequest: override pisa regla, bounty
  pisa override, snapshot `ruleSource`, lote sin N+1, cotiza sin referencia sin escalar pendientes,
  topes intactos, regresión.
- `test/sell-override.propagation.spec.ts` — propagación de venta a catálogo (single+batch),
  checkout, bulk-publish, binder (`pricing?` platform-only + omisión en user_vault + buyable).
- Mocks de `PricingService` en 18 specs existentes ganaron los métodos nuevos con default «sin
  filas» (= comportamiento previo); 3 aserciones de `master-set.scopes` ganaron `pricing:
  expect.any(Object)` (scope platform ahora lo trae por contrato).

### Verificación (local; Postgres 16 + Redis reales, migrate deploy + seed sintético)
- `npm run typecheck` → limpio.
- `npm run lint` → 0 errores (1 warning preexistente en `buylist.service.ts`, ajeno).
- `npm test` (unit) → **142 suites / 1338 tests VERDE**.
- `npm run test:integration` (con `migrate deploy` aplicando M-30 sobre la BD local) → **9 suites /
  124 tests VERDE**. Nota entorno: el smoke de MinIO exige un endpoint S3 REALMENTE inaccesible
  para tomar su vía de skip; en este sandbox el proxy de salida contesta 403 a endpoints
  inexistentes, así que se fijó `S3_ENDPOINT=http://127.0.0.1:9000` (sin MinIO ⇒ ECONNREFUSED ⇒
  skip documentado). Preexistente, ajeno a esta fase (verificado también sobre el commit base).

### Qué queda listo para la FASE 2 (P-19 + P-17)
- El **prellenado del alta rápida** (`pricing.buy.effectiveCents`) ya viaja en el binder (P-18
  aterrizado ⇒ P-19 conecta el efectivo directo, sin regla provisional).
- `publish-all` (P-19) reusa la precedencia v1.28 ya integrada en la rama derivada de
  `bulkPublish` (mismo cuerpo `computeSalePriceForRarity + getVariantOverridesBatch`).
- P-22 solo necesita: endpoint público `GET /buylist/bounties` (leer filas `bountyEnabled` con
  `bountyPriceCents desc`, cap 50) + conteo/auto-off en el pago M5 — el snapshot
  `ruleSource='bounty'` en `SellRequestItem` ya se persiste desde esta fase.

## Stream B v1.28 — FASES 2-4: P-19/P-17 + P-22 + P-24/P-25/P-20 (rama `claude/backend-e2e-payment-fixtures-77mo4t`, 2026-08-21)

> Spec: ARCHITECTURE **§4.26 (c–h, j)** · contrato **v1.28** (§M1 Stream B, §6 bounties, §M7
> breakdown). Cierra el alcance backend del stream (la Fase 1 M-30+P-18 está arriba). **SIN
> migraciones nuevas** (lock §4.26i respetado: el schema quedó cerrado en Fase 1).

### FASE 2 — P-19 `publish-all` + P-17 filtros de drill-down + fix aportación de sellado
- **`POST /admin/inventory/publish-all`** (`inventory.service.ts::publishAll` + controller):
  selección SERVER-SIDE (`ownerType=platform` + `status=in_stock` ± `setId`/`productType`,
  `setId` inexistente ⇒ 400 filtro inválido), SIN cap de selección — snapshot de ids procesado
  por chunks de 100 (iterar por snapshot y no re-consultando `in_stock` garantiza terminación:
  una PRICE_PENDING sigue `in_stock`). Res `{ batchKey?, idempotentReplay, summary
  { selected, published, alreadyListed, pendingPrice, failed }, failures[] }` con detalle
  **capado a 200** (constantes `PUBLISH_ALL_CHUNK_SIZE`/`PUBLISH_ALL_FAILURES_CAP`).
  - **Pipeline por-pieza EXTRAÍDO y COMPARTIDO con `bulkPublish`** (el contrato exige pipeline
    IDÉNTICO ⇒ un solo cuerpo): `assertPublishableGuards` (platform + allowlist WS-E + cert de
    graded), `resolvePublishSalePrice` (manual > [sealed H-1 | sellOverride M-30 > regla] >
    PRICE_PENDING que ESCALA ④ y no publica) y `claimListed` (updateMany atómico BE-45
    anti-double-sell). `bulkPublish` quedó reescrito sobre los mismos helpers — cero divergencia
    posible; regresión cubierta por las suites previas (verdes sin cambios).
  - Idempotencia: `InventoryBatch kind='publish_all'` (String, sin migración). Replay ⇒ resultado
    guardado + `idempotentReplay:true`; un `batchKey` de OTRO kind ⇒ **409 CONFLICT** (no se
    "replay-ea" un shape ajeno — decisión dentro del margen, `bulkPublish` legacy no lo valida).
    El resultado se persiste POST-proceso (patrón bulkPublish); carrera P2002 ⇒ devuelve el del
    ganador (piece-safe: `claimListed` impide doble publish aunque ambas corran).
  - `alreadyListed` cuenta piezas que se volvieron `listed` entre selección y proceso
    (concurrencia/chunk repetido): no-op sin escritura. Auditoría `inventory.publish_all`
    (filtros + summary) en el controller.
- **P-17:** `GET /admin/inventory/items` gana `finish?`/`productType?` — validados contra los
  enums EN EL CONTROLLER (`400 VALIDATION_ERROR` con `allowed`), el servicio solo reduce el
  `where`. Sirve `?cardId=&finish=` (drill-down de variante) y `?cardId=&productType=sealed|graded`
  (pestañas P-25/P-20).
- **Fix normativo §4.26g — la APORTACIÓN de sellado valúa por `sealedMarketRef`:**
  `resolveCreation` ramifica: sealed+aportación → `resolveSealedAportacionMarket` — infiere el
  `tcgplayerProductId` del GRUPO desde sus **hermanos ya mapeados** con el mismo
  `(cardId, sealedSubtype)` (la MISMA identidad que `applyToSiblings` del mapeo M2; el item que
  nace aún no tiene mapeo — la curación es posterior y sigue siendo EXCLUSIVA del endpoint M2:
  la pieza nueva **NO hereda** el productId). Money-safe: exactamente UN productId ⇒ valúa con su
  referencia **gateada por el dial** (`gateSealedMarketCents`, H-1); CERO hermanos o ≥2 productIds
  (ambigüedad) ⇒ sin mercado ⇒ `422 PRICE_PENDING` por línea (escalado con la clave de mercado si
  se conocía; estructural `'sealed'` si no). Raw/graded intactos. `locationId` opcional verificado
  con test (alta sin ubicación + movimiento sin `toLocationId`).

### FASE 3 — P-22 bounty público + conteo transaccional
- **`GET /buylist/bounties`** (`BuylistService.publicBounties`, ruta `@Public()` + throttle
  dedicado 60/min como el quote por-carta): filas `bountyEnabled=true AND bountyPriceCents>0 AND
  productType='raw'` (defensa en profundidad; el write ya impone raw), `orderBy bountyPriceCents
  desc` (+ desempate `updatedAt desc`, dentro del margen), `take 50`, sin query params.
  `remainingQty = max(0, target − acquired)` (`null` sin objetivo); `imageSmallUrl`/`rarity` se
  OMITEN si la carta no los tiene. READ-ONLY estricto (no persiste ni escala).
- **Conteo al pagar (`paySpei`)**: la transición `→pagada` (updateMany con guardia count===1) y
  `countBountyAcquisitionsTx` corren ahora en **UNA `$transaction`** — o se paga Y se cuenta, o
  nada. Por cada ítem con snapshot `ruleSource='bounty'` se incrementa `bountyAcquiredQty` de su
  fila M-30 (clave derivada con `gradeKeyFor` + finish, AGRUPADA: una actualización por variante,
  `increment: n`). Auto-apagado: `enabled && target!=null && acquired ≥ target` ⇒
  `bountyEnabled=false` + `bountyCompletedAt` + `AuditLog action=bounty.completed`
  (`tx.auditLog.create` directo — AuditService escribe fuera de la tx). Reglas money-safe:
  el contador sube AUNQUE el bounty ya esté apagado (la pieza se compró bajo bounty; el monto
  quedó snapshoteado); fila M-30 borrada ⇒ `updateMany count=0` ⇒ se omite SIN tumbar el pago.
  **Idempotente ante replays**: solo cuenta la llamada que HIZO la transición (replay/carrera
  perdida ven `pagada` y no re-cuentan) — cubierto por test.
- Mocks de `paySpei` en 2 specs existentes (`buylist.ronda-c`, `buylist.security`) ganaron
  `$transaction` + `sellRequestItem.findMany` (patrón "mock gana el método nuevo, default no-op").

### FASE 4 — P-24 breakdown + P-25 sealed-sets + P-20 graded
- **P-24 (`admin.service.ts::inventoryValue`)**: gana `breakdown { raw, sealed, graded }` con
  `{ atReferenceCents, atCostCents, pieceCount, pendingPriceCount }`; **top-level = Σ del
  breakdown** (invariante del contrato, cubierto por test; el dashboard sigue espejando el
  top-level). Cambios de valuación DOCUMENTADOS:
  - el sellado pasa a valuar por **`sealedMarketRef`** (`sealed:tcg:<productId>` del mapeo M-23,
    norma §4.26f) con **fallback al gradeKey legacy `'sealed'`** (= el comportamiento previo:
    override manual de mercado preexistente no pierde su valuación; estrictamente ≥ información
    que antes). La valuación P-24/P-25 usa la referencia SIN el gate del dial (es informativa,
    paridad con el `sealedMarketRef` de v1.19); el dial solo gatea DINERO (venta H-1 y la
    aportación de Fase 2).
  - el N+1 anotado en `getReferencesBatch` («deuda diferida… inventoryValue») queda cerrado: UN
    lote por request.
  - CSV `report=inventory`: cabecera previa + `raw_*`,`sealed_*`,`graded_*` (4 columnas por
    bucket) AL FINAL.
- **P-25 (`inventory/sealed-graded.service.ts`, NUEVO)**: `GET /admin/inventory/sealed-sets`
  (índice: groupBy `[cardId, productId, status]` + cartas→set + sets con `?q=` + UN lote de refs;
  `marketValueMxnCents` = Σ ref×piezas CON mercado, `null` si ninguna; `unmappedCount` = piezas
  SIN mercado — no mapeadas O mapeadas sin ingest, como norma el contrato; `unmappedTotal` =
  espejo EXACTO de la cola M2 `sealed AND productId IS NULL` sobre todo el inventario; orden
  `releaseDate desc` como el índice Master Set) y `GET .../sealed-sets/:setId` (grupos por
  identidad §4.23 `(cardId, subtype, productId, condition)` con `counts {inStock, listed, other}`,
  `mapped`, `sealedMarketRef` solo `priced`, `totalCostCents` `null` sin capturas; 404 set
  inexistente). **Alcance de pestaña = plataforma on-hand (`NOT_ON_HAND` del Master Set — fuente
  única)**; `other` captura `reserved`/tránsitos.
- **P-20 (mismo servicio)**: `GET /admin/inventory/graded` — groupBy `(cardId, gradingCompany,
  gradeValue)` (+ `?q=` por nombre de carta), referencia POR GRADO en lote con la clave
  `(cardId,'graded','graded:<company>:<grade>','normal')` (la que fija el override manual M2 —
  vía normativa v1.28), `capturedDate` solo con precio, costo agregado `null` sin capturas, orden
  carta asc + grado DESC numérico (PSA 10 antes que 9), paginación en memoria. **Verificado** que
  la consola P-18 ya soporta graded sell/buy y que bounty en graded sigue 422 (tests de Fase 1).
- Wiring: `SealedGradedInventoryService` registrado/exportado en `InventoryModule`; rutas en
  `InventoryController` (heredan `vault_operator+`), inyección como 4º parámetro opcional para no
  romper constructores de tests legacy.

### Decisiones dentro del margen (para arquitecto/techlead)
1. `publish-all`: batchKey de otro `kind` ⇒ 409 (no replay de shape ajeno); persistencia del
   resultado POST-proceso con P2002⇒replay del ganador (piece-safe por `claimListed`).
2. Aportación de sellado: inferencia del productId por HERMANOS mapeados `(cardId, sealedSubtype)`
   (identidad de `applyToSiblings`); ambigüedad ⇒ PRICE_PENDING; la pieza nueva NO hereda mapeo.
   Si el arquitecto prefiere otra vía (p. ej. `tcgplayerProductId` en el DTO del alta), es cambio
   de contrato — se solicita, no se improvisa.
3. P-24: fallback legacy `'sealed'` en la valuación del sellado (no pierde overrides manuales
   pre-v1.19); referencia informativa SIN gate de dial (el dial gatea dinero, no reportes).
4. Pestañas P-25/P-20: alcance "on-hand" = `NOT_ON_HAND` (consistente con Master Set/M1);
   `unmappedCount` cuenta también "mapeada sin ingest" (texto normativo «piezas sin mercado»).
5. Bounties: desempate `updatedAt desc` tras el precio (orden estable; el contrato solo norma
   `bountyPriceCents desc`).

### Tests nuevos (todos verdes)
- `test/inventory.publish-all.spec.ts` — tolerante/money-safe (mix publicadas+pendientes+
  fallidas; no persiste precio derivado; sellOverride vuelve publicable), filtros server-side,
  idempotencia (replay sin re-proceso; kind ajeno 409), alreadyListed por concurrencia, cap 200.
- `test/inventory.items-filters.spec.ts` — filtros P-17 en servicio + validación 400 del controller.
- `test/inventory.sealed-aportacion.spec.ts` — valuación por sealedMarketRef (dial on/off, sin
  mapeo, ambigüedad, sin ingest, no-herencia del mapeo), alta sin `locationId`, regresión raw 100 %.
- `test/buylist.bounties.spec.ts` — vitrina pública (filtros/orden/cap/mapeo/remainingQty piso 0)
  y conteo del pago (agrupado por clave, auto-off + audit, sin target solo contador, apagado sigue
  contando, fila borrada no tumba, idempotencia ante replay/carrera, dentro del boundary de la tx).
- `test/admin.inventory-value-breakdown.spec.ts` — breakdown suma = top-level, sealed por
  mercado/legacy/pendiente, lote único, CSV espejo.
- `test/inventory.sealed-graded-tabs.spec.ts` — sealed-sets índice (agrega bien, q, unmapped,
  valor null honesto, unmappedTotal) y detalle (identidad §4.23, mapped, 404), graded separado
  (referencia por grado, orden, q, paginación).

### Verificación (local; Postgres 16 + Redis reales, `tcg_e2e` con M-30 aplicada)
- `npm run typecheck` → limpio.
- `npm run lint` → 0 errores (mismo warning preexistente en `buylist.service.ts`, ajeno).
- `npm test` → **148 suites / 1386 tests VERDE** (142/1338 previos + 6 suites nuevas; 2 specs
  existentes de paySpei actualizados de mock, cero regresiones).
- `npm run test:integration` (con `S3_ENDPOINT=http://127.0.0.1:9000` para el skip documentado de
  MinIO) → **9 suites / 124 tests VERDE**.

## Ronda de corrección gate Stream B v1.28 — B-1 conteo de bounty excluye rechazadas (rama `claude/backend-e2e-payment-fixtures-77mo4t`, 2026-08-21)

Correcciones del veredicto del techlead (RECHAZÓ acotado) + menores de QA sobre el gate del Stream B.

### B-1 (BLOQUEANTE) — `countBountyAcquisitionsTx` contaba piezas rechazadas
- **Bug:** el `findMany` de ítems bounty al pagar (`buylist.service.ts`, dentro de la tx de `paySpei`)
  filtraba solo `ruleSource='bounty'`, SIN excluir `itemStatus='rechazada'`. Con **cherry-pick**
  (solicitud pagada con mezcla aceptadas/rechazadas), las rechazadas — que NO se compran ni suman en
  `approvedTotalCents` (invariante BL-1) — inflaban `bountyAcquiredQty`, podían **auto-apagar el
  bounty antes de tiempo** y auditar `bounty.completed` **en falso**.
- **Fix:** mismo filtro que BL-1 (`itemStatus: { not: 'rechazada' }`) en el where del conteo.
  Semántica normativa ratificada por el orquestador: §4.26a — `bountyAcquiredQty` mide «piezas
  COMPRADAS vía buylist PAGADA bajo bounty» (el arquitecto alinea en paralelo la frase ambigua de
  §4.26e). Docblock del método actualizado con la regla.
- **Test nuevo:** `test/buylist.bounties.spec.ts` → caso cherry-pick (2 aprobadas + 3 rechazadas bajo
  bounty, target 4, acquired 1): solo cuentan las 2 compradas (1+2=3 < 4 ⇒ **NO** auto-off, cero
  `bounty.completed`); además asserta el where con el filtro BL-1. El harness del spec ahora honra
  ambos filtros del where real.

### Menores del mismo pase
- `pricing.service.ts` (`loadBuylistRules`): el docblock afirmaba en falso que
  `BuylistService.buylistRules()` delegaba ahí. Corregido: son DOS lecturas paralelas de la misma
  config (no-delegación justificada; cuerpo normativo = matemática de `money.ts`). Deuda **SB-D2**.
- `buylist.service.ts` `rejectRequest(id, reason?)`: se eliminó el parámetro `reason` sin uso
  (warning de lint preexistente, MENOR-3 de QA). El `reason` del body sigue llegando a la auditoría
  vía el controller (`admin-buylist.controller.ts` lo pone en `after`); el servicio nunca lo usó.
- `docs/TECH_DEBT.md`: nueva sección **Stream B v1.28** con SB-D1..SB-D6 y SB-D9 (SB-D7/D8 son de
  frontend y las registra su dueño).

### Verificación (local; Postgres 16 + Redis reales)
- `npm run typecheck` → limpio. `npm run lint` → **0 warnings** (el preexistente de `reason` quedó
  eliminado). `npm test` → **148 suites / 1387 tests VERDE** (+1: cherry-pick B-1).
- `npm run test:integration` (setup §8, `S3_ENDPOINT=http://127.0.0.1:9000`) → **9 suites / 124
  tests VERDE**.

## P-21 · Rebrand a TCG HUNT — lado servidor (rama `claude/backend-e2e-payment-fixtures-77mo4t`, 2026-08-21)

> Fuente: `docs/DESIGN_SYSTEM.md` §17 (marca visible "TCG HUNT", con espacio; dominio `tcghunt.mx`
> en prosa; **rutas técnicas / nombres de módulos / prefijo de folios `TCG-` NO cambian**, §17.4).

### Qué cambió (solo strings visibles al usuario)
- **`modules/mail/mail.templates.ts`** — `BRAND = 'TCG HUNT'` (header/footer y cuerpo de los
  correos de verificación de email y reset de contraseña, ES/EN).
- **`modules/orders/mail/guest-order.templates.ts`** — `BRAND = 'TCG HUNT'` (asuntos
  `TCG HUNT — Confirmación de tu pedido …` / `— Enlace de seguimiento …` y layout). El copy
  "tu bóveda"/"your vault" NO cambia: es el nombre de la función de custodia, no de la marca (§17.4).
- **`modules/buylist/buylist-mail.templates.ts`** — `BRAND = 'TCG HUNT'` (correo de rechazo de ítem).
- **`modules/catalog/sealed-restock-notify.service.ts`** — correo bilingüe de reposición de sellado:
  "…disponible en TCG HUNT" / "…back in stock at TCG HUNT" (4 strings).

### Correos de contacto/remitente → quedan en env (NO se cambió el valor efectivo)
El buzón `@tcghunt.mx` todavía no existe y el dominio de Resend verificado sigue siendo el viejo,
así que **ningún default de código cambió de valor**; solo se movieron a config los que estaban
hardcodeados (mismo patrón que `disputes.constants.ts`):
- `modules/orders/guest-checkout.constants.ts` → `SUPPORT_EVIDENCE_CONTACT` ahora lee
  `process.env.DISPUTE_EVIDENCE_CONTACT ?? 'soporte@tcgvaultmx.com'` (misma env que disputes: el
  propio comentario del código declara que exponen el mismo valor).
- `modules/buylist/buylist-mail.templates.ts` → `SUPPORT_EMAIL` lee
  `process.env.SUPPORT_EMAIL ?? process.env.DISPUTE_EVIDENCE_CONTACT ?? 'soporte@tcgvaultmx.com'`.
- No hay URLs web absolutas del dominio viejo hardcodeadas en `src/` (los links de correo ya salen
  de `APP_BASE_URL`); las apariciones restantes de `tcgvaultmx.com` son defaults de buzón (arriba)
  y valores de fixture en tests (no asserts de marca).

### Para **devops** (cuando existan dominio de correo + buzón; NO edité `.env.example`)
- `MAIL_FROM="TCG HUNT <no-reply@tcghunt.mx>"` — remitente visible "TCG HUNT" (DESIGN_SYSTEM
  §17.3). El default de código conserva `no-reply@tcgvaultmx.com` a propósito (buzón verificado
  en Resend hoy). Requiere verificar `tcghunt.mx` en Resend antes de flipear.
- `DISPUTE_EVIDENCE_CONTACT=soporte@tcghunt.mx` — flipea de golpe los TRES puntos de contacto
  (disputes §7, guest checkout 56b y el correo de rechazo del buylist).
- `SUPPORT_EMAIL` (opcional, nueva) — solo si algún día el contacto del buylist debe divergir del
  de disputas; si no se fija, cae en cascada a `DISPUTE_EVIDENCE_CONTACT`.
- `APP_BASE_URL` — ya existente (links de correos): apuntarla al dominio nuevo cuando el front
  viva en `tcghunt.mx` (redirects `tcgvaultmx.com` → `tcghunt.mx` = alcance devops, P-21).

### Qué NO se tocó (a propósito)
Prefijo de folios `TCG-000123`; nombres técnicos (`tcg-vault-mx`, módulo `vault`, rol
`vault_operator`, bucket `tcg-photos`, package `tcg-marketplace-backend`); lógica de dinero;
tests (ninguno asserta la marca vieja; los que assertan `soporte@tcgvaultmx.com` siguen en verde
porque el default no cambió).

### Gates (local, Postgres 16 + Redis reales; sin MinIO en esta sesión → smoke S3 se salta con aviso)
- `npm run typecheck` → limpio · `npm run lint` → 0 warnings.
- `npm test` → **148 suites / 1387 tests VERDE**.
- `npm run test:integration` (setup §8, `S3_ENDPOINT=http://127.0.0.1:9000`) → **9 suites /
  124 tests VERDE**.

## Ronda de cierre P-21 · Robustez de env vacía en lecturas de correo (`envOr`) (rama `claude/backend-e2e-payment-fixtures-77mo4t`, 2026-08-21)

> Condición pre-switch del techlead sobre el gate P-21: las 4 lecturas de env de correo usaban
> `??`, que NO cubre cadena vacía. Con `MAIL_FROM=` (definida pero vacía) el `from` quedaba `''`
> y **Resend rechazaría TODO envío**; con `DISPUTE_EVIDENCE_CONTACT=` vacía la API exponía
> `evidenceContact: ""`.

### Qué cambió
- **Helper único `modules/mail/mail-env.util.ts` → `envOr(value, fallback)`**: trata
  vacío/solo-blancos como ausente y devuelve el valor saneado (trim) cuando sí hay contenido.
  **Decisión de ubicación:** vive en `modules/mail/` y NO en `src/common/` a propósito —
  `common/` es zona compartida serializada entre streams y los 4 consumidores son de correo y ya
  dependen de `mail/`. Promoverlo a `common/` cuando quede libre es NO-BREAKING (TECH_DEBT
  BE-P21-2, junto con `BRAND` → BE-P21-1).
- **Aplicado en los 4 sitios:** `mail/mail.module.ts` (MAIL_FROM → default histórico),
  `disputes/disputes.constants.ts` y `orders/guest-checkout.constants.ts`
  (`DISPUTE_EVIDENCE_CONTACT` → `soporte@tcgvaultmx.com`) y `buylist/buylist-mail.templates.ts`
  (cascada `SUPPORT_EMAIL` → `DISPUTE_EVIDENCE_CONTACT` → histórico, saltando vacíos en cada
  eslabón). Comportamiento con env ausente o con valor real: **idéntico al de antes**; solo
  cambia el caso patológico env-definida-pero-vacía/blanca.
- **Tests `mail-env.util.spec.ts` (10):** helper puro (ausente/vacía/blancos → default; valor →
  se usa, con trim), los 3 consumidores import-time re-evaluados con `jest.isolateModules`
  (incluida la cascada del buylist) y la factory de `MailModule` vía metadata + ConfigService
  stub (`MAIL_FROM` vacía/blanca → default; con valor → lo usa).
- **TECH_DEBT:** nueva sección "Ronda de cierre P-21" (BE-P21-1 marca `BRAND` x3 + literales del
  restock; BE-P21-2 default literal duplicado x3 + dos idiomas de config process.env vs
  ConfigService) y corregida la ampliación obsoleta de BE-43 (el buzón ya NO está hardcodeado).

### Gates (local, Postgres 16 + Redis reales + s3rver en 127.0.0.1:9000 → smoke S3 con PUT real)
- `npm run typecheck` → limpio · `npm run lint` → 0 warnings.
- `npm test` → **149 suites / 1397 tests VERDE**.
- `npm run test:integration` (setup §8) → **9 suites / 124 tests VERDE** (incl. `infra-smoke`
  con S3 real).

## v1.27.1 — P-13-fix: REGRESIÓN de composición de variantes (§4.25e, rama `fix/variant-composition-regression`, 2026-08-22)

> Spec: ARCHITECTURE **§4.25e** (regla vigente, deroga §4.25a-1). Regresión en prod (set Pitch Black):
> tras el re-sync con la fórmula «solo structural» de P-13, los COMUNES perdieron su `reverse_holo` y
> las ex conservaron un `normal` fantasma. SIN migración de schema; SIN cambio de forma de contrato
> (`CardDTO.availableFinishes` sigue `Finish[]`). Toca la lista blanca SEC-A1 → gate de seguridad por
> release. **Paso de despliegue (devops/humano):** re-sync forzado único (§4.25a-4) para recomputar prod.

### Regla vigente (deroga la «solo structural» de §4.25a-1)
```
availableFinishes := orderFinishes( (structuralFinishes ∪ pricedFinishesSnapshot)
                                    − { normal | isPremiumRarity(rarity) } ) || ['normal']
```
1. **UNIÓN** `structural ∪ snapshot` (vuelve): recupera el `reverse_holo` legítimo del común, que en
   sets recién salidos SOLO trae el proveedor de precios (`pricedFinishesSnapshot`, Señal C), no TCGCSV.
2. **RESTA `normal` si `isPremiumRarity(rarity)`**: una premium (ex/Double Rare, Ultra/Secret/Illustration/
   Hyper/Rainbow/Gold Rare, V/VMAX/VSTAR/ex/GX…) NUNCA existe en `normal` ⇒ es fantasma venga del
   snapshot envenenado, del `structuralFinishes` STALE de M-29 o del seed. Filtro **estructural por
   rareza**, en la composición misma — NO por precio (NO es N-15/`computeDisplayFinishes`).
3. `orderFinishes` (dedup + `FINISH_ORDER`) + fallback `|| ['normal']` si la resta deja vacío.

### Cambios (SOLO `backend/` + este doc; lock de `common/` de este stream)
- **`src/common/card-order.ts`** — `composeAvailableFinishes` pasa de 1 arg a **3**:
  `composeAvailableFinishes(structuralFinishes, pricedFinishesSnapshot, rarity)`. **Reusa
  `isPremiumRarity` de `common/money.ts`** (mismo clasificador chase, sin redefinir patrones).
  `isPremiumRarity(null) === false` ⇒ rareza null/desconocida NO filtra `normal` (fail-safe conservador).
- **`src/modules/catalog/finish-reconciler.service.ts`** (ÚNICO escritor, candado 4 §4.22g) — el
  `findMany` ahora **selecciona `rarity`**; la fórmula recibe `(structural, priced, c.rarity)`. El
  snapshot **vuelve a componer** (antes P-13 lo excluía). Log `pricedNotStructural` (drift
  proveedor↔estructura) **conservado**. Idempotencia, dedup de ids y NO-monotonía intactas.
- **Callers de `composeAvailableFinishes`:** el ÚNICO caller de producción es `FinishReconciler`
  (actualizado). Los seeds/fixtures no la invocan (solo describen su resultado en comentarios).
  Comentarios normativos alineados a §4.25e en `catalog-sync.service.ts`, `prisma/seed.ts`,
  `prisma/seed-e2e.ts`, `prisma/e2e-fixtures.ts` (SIN cambio de datos: los valores sembrados ya eran
  NO-OP bajo la fórmula nueva — Pidgey Común da 2 casillas, Charizard `Rare Holo` da `['holofoil']`).

### Tests
- **`test/finish-reconciler.spec.ts`** reescrito a §4.25e:
  - Unit `card-order`: los **6 worked examples** con datos reales de Pitch Black — Tropius/Grubbin
    Common → `[normal, reverse_holo]`; Lurantis/Mega Delphox ex (Double Rare) → `[holofoil]`; energía
    básica común → `[normal]`; secret rare holo puro (snapshot envenenado) → `[holofoil]`; premium con
    struct/snap vacíos → `['normal']` fallback. + orden canónico/dedup, fail-safe rareza null, no-monotonía.
  - Spec `FinishReconciler`: común RECUPERA su reverse del snapshot; ex PIERDE el `normal` stale;
    secret rare nunca `normal`; fallback premium vacío ⇒ `['normal']`; el `select` LEE `rarity` +
    snapshot; observabilidad `pricedNotStructural`; idempotencia; fast-path lista vacía.
- Las aserciones que asumían «solo structural» de P-13 quedaron actualizadas a la regla nueva (el
  común AHORA da 2 casillas, no 1; la ex sigue en `[holofoil]` pero por rareza-filtra-normal).

### Gates (local, Postgres 16 + Redis reales + s3rver en 127.0.0.1:9000 → smoke S3 con PUT real)
- `npm run typecheck` → limpio · `npm run lint` → 0 warnings.
- `npm test` → **149 suites / 1405 tests VERDE**.
- `npm run test:integration` (setup §8, `E2E_STRICT_INFRA=true`) → **9 suites / 124 tests VERDE**
  (incl. `infra-smoke` con S3 real).

### Cierre del gate techlead — arreglo del log contradictorio (2026-08-22, solo logging)
> Techlead APROBÓ el fix CON DEUDA y pidió, antes de merge, corregir el mensaje del log (barato). Solo se
> tocó el **logging** del reconciliador; la lógica de composición (ya aprobada) NO cambió.
- **Problema:** el `logger.warn` de `pricedNotStructural` decía que el snapshot «NO compone la lista blanca
  (§4.25a); es drift proveedor↔estructura». Bajo §4.25e eso es **falso** (el snapshot SÍ compone: es lo que
  recupera el reverse holo del común) y además se disparaba en el **camino feliz** — cada común de set nuevo
  logueaba su reverse recuperado como «drift» → spam inútil en `warn`.
- **Fix (`finish-reconciler.service.ts`, `reconcile`):** la observabilidad `snapshot ∖ structural` se parte
  por SEÑAL en dos buckets:
  - **`snapshotRecovered` → `logger.debug`:** el acabado del snapshot sin respaldo estructural que **SÍ
    compone** (`f ∈ next`) — camino feliz esperado (§4.25e recupera el reverse del común); trazado a `debug`
    para no ensuciar `warn`.
  - **`pricedNotStructural` → `logger.warn`:** el acabado del snapshot sin respaldo estructural que la
    composición **DESCARTÓ** (`f ∉ next`, hoy `normal` fantasma en rareza premium filtrado por §4.25e-1) —
    drift genuino proveedor↔estructura, con texto veraz.
- **Tests (`test/finish-reconciler.spec.ts`):** la prueba de observabilidad se dividió en dos — (1) camino
  feliz (común con reverse en snapshot) ⇒ `debug`/`snapshotRecovered` y `warn` NO llamado; (2) anomalía
  (`normal` fantasma en `Double Rare`) ⇒ `warn`/`pricedNotStructural`. Comentario del header actualizado.
- **Deuda del veredicto** registrada en `docs/TECH_DEBT.md`: VC-D1 (este arreglo, RESUELTA), VC-D2 (dos
  clases residuales fuera de la doctrina §4.25e → arquitecto), VC-D3 (`isPremiumRarity` con 3 dueños
  asimétricos → arquitecto/backend), VC-D4 (aclarar doctrina money-safe en comentarios de `card-order.ts`).
- **Integración:** NO se re-corrió — no se tocó lógica de negocio ni endpoints, solo nivel/texto de logs y
  sus tests unitarios.
- **Gates:** `npm run typecheck` limpio · `npm run lint` 0 warnings · `npm test` → **149 suites / 1406 tests
  VERDE** (el test único de observabilidad se dividió en dos sub-casos camino-feliz/anomalía: 1405 → 1406).

## P-32 · Valor del «set destacado» del home mal (regresión M-31) (rama `fix/variant-composition-regression`, 2026-08-22)
> El hero mostraba «Pitch Black · Valor de mercado» ≈ **MX$15,756.32 con +157,463%** — absurdo. Fix
> **solo cálculo, SIN cambio de contrato**: el shape de `SetValueHistoryResponse` (set/range/points/change)
> es idéntico; solo cambia CÓMO se computan `points[].valueMxnCents` y `change`.

### De dónde salía el número mal (dos bugs, ambos regresión de M-31 «1 carta ↔ N productos»)
- **(A) Valor inflado — `SetValueService.computeSetValue` no filtraba por producto.** M-31 metió
  `PriceReference.cardProductId` y su `@@unique` ahora incluye ese eje: una misma `Card` puede tener VARIAS
  filas `raw:NM:normal` el mismo día — la del `set_base` **y** las de `deck_exclusive`/`promo` (productos
  VENDIBLES SEPARADOS con su propio precio; su valor NO es «la carta de set»). `computeSetValue` seguía con
  la query pre-M-31: `findMany` por `cardId/productType/gradeKey/finish` **sin** `BASE_CARD_REF_WHERE`, y
  dedupe «la primera por `capturedDate desc`». Resultado: por carta podía colarse el precio de un producto
  ajeno (Deck Exclusive de alto valor / ancla de sellado), inflando la Σ. M-31 **sí** blindó `getReference`
  y `getReferencesBatch` con `BASE_CARD_REF_WHERE` + desempate `isBetterRef`, pero **omitió esta ruta**
  (`computeSetValue` precede a M-31, último commit `be858cb`; el diff de M-31 nunca la tocó).
- **(B) % irreal — base semilla en `valueHistory`.** El `change.pct` comparaba `points[0]` contra el último
  punto sin mirar cobertura. Cuando la serie apenas se sembraba (día 1 con **1** carta priceada ≈ MX$10) y
  luego el set entero, `first!==0` ⇒ pct = (last−first)/first·100 = **cifra astronómica** (el +157,463%).

### Fix exacto (archivo:línea)
- **`backend/src/modules/pricing/pricing.service.ts`:** se EXPORTAN los helpers money-safe de M-31 para
  reusarlos (antes module-private): `BASE_CARD_REF_WHERE` (L45), `RefRow` (L78), `isBetterRef` (L116),
  `pickBestRef` (L131). Sin cambio de lógica; solo visibilidad.
- **`backend/src/modules/catalog/set-value.service.ts` › `computeSetValue` (L~150-225):** la query añade
  `...BASE_CARD_REF_WHERE` (excluye `deck_exclusive`/`promo`; incluye `set_base`/`other` y el legacy
  `cardProductId=null`), selecciona `source/capturedDate/cardProductId`, ordena
  `[capturedDate desc, cardProductId nulls last]` y elige la MEJOR ref **por carta** con `isBetterRef`
  (fecha → fuente → variante resuelta → cuid), **no** «la primera vista». Mismo criterio que el resto de la
  valuación (§4.27f) ⇒ escritura (`set-price-sync`) y lectura no divergen.
- **`backend/src/modules/catalog/set-value.service.ts` › `valueHistory` (L~232-264) + const
  `MIN_BASE_COVERAGE_FRACTION=0.5`:** la base del `%` es el snapshot MÁS ANTIGUO del rango con `valor>0` y
  `pricedCardCount >= ceil(0.5 × pricedCardCount del último punto)`. Si no existe (solo el último punto tiene
  cobertura real, p. ej. serie recién sembrada) ⇒ `change` = `{ absMxnCents:0, pct:null, direction:'flat' }`
  (**«sin cambio» honesto, nunca una cifra absurda**). El caso `first===0` queda cubierto por `valor>0`.

### Money-safe: cómo se tratan las cartas sin precio en la Σ
- Una carta **sin `PriceReference` base** vigente **NO entra** al total y **NO cuenta como 0**: se refleja en
  `pricedCardCount < totalCardCount` (cobertura honesta), nunca inventa ni deflacta. Sin ninguna carta
  priceada ⇒ `totalValueMxnCents=0`, y el hero degrada a «—»/vacío (el front ya distingue `points` vacío).
- La base del `%` es de **VALOR** (`valueMxnCents>0`), no de conteo; el `MIN_BASE_COVERAGE_FRACTION` solo
  descarta snapshots-semilla para que el `%` compare canastas comparables, sin tocar la Σ.

### Contrato
- **NO se tocó** `docs/API_CONTRACT.md` ni el shape de respuesta. Mismo `SetValueHistoryResponse`. No fue
  necesario pasar por el arquitecto (solo corrección de cálculo). El job `set-price-sync` sigue preciando el
  set destacado con `SET_VALUE_RULE` (raw/raw:NM/normal) vía `syncCardPrice` (`cardProductId=null`), que la
  lectura ya acepta por el brazo `cardProductId:null` de `BASE_CARD_REF_WHERE`.

### Tests (`backend/test/set-value.spec.ts`)
- Nuevo: `computeSetValue` con `set_base` (tcgcsv_singles) vs genérica (pokemontcg.io) el mismo día ⇒ gana el
  `set_base` por precedencia de fuente (no la genérica ni una suma); y aserción de que el `where` lleva
  `BASE_CARD_REF_WHERE.OR` (excluye deck_exclusive/promo).
- Nuevo: serie con snapshot SEMILLA (1/180 priceadas, MX$10) + set completo ⇒ `pct` razonable (5.04%, base =
  el punto comparable), `< 100%`, **jamás** el +157,463%.
- Ajustado: el viejo caso «primer valor 0 → direction up» ahora es «base semilla ⇒ sin cambio (flat/null)»
  (la semántica corregida: un semilla no es base válida).
- Ajustados los mocks de `priceReference.findMany` para incluir `capturedDate/source/cardProductId` (los
  insumos del nuevo desempate); helper `ref()` con defaults seguros.

### Gates (local)
- `npx tsc --noEmit` limpio · `npx eslint` (archivos tocados) 0 warnings · `npx nest build` exit 0 ·
  `npx jest` → **155 suites / 1452 tests VERDE** (set-value: 21/21).

---

## v1.39-sealed-product-module (M-39, P-38) — entidad `SealedProduct`, cura de raíz de SB-D5 (2026-08-23)

**Contexto.** El alta de sellado anclaba cada presentación a un single representativo del set (puente P-35)
→ «Tropius #1 · sealed» + «SIN MAPEO». Tres huecos: (1) `CardSet.tcgcsvGroupId` no lo escribía nadie
(círculo vicioso: para resolver el grupo hacía falta un sellado ya mapeado); (2) UPC no existía; (3) sin
concepto de «principales». M-39 materializa la entidad de catálogo `SealedProduct` (diferida en §4.32d/SB-D5)
contra el contrato **v1.39.1** y ARCHITECTURE **§4.34 + §11 (M-39)**. **NO se tocó `docs/API_CONTRACT.md`.**

### Migración — `20260823120000_m39_sealed_product` (aditiva y reversible)
- `ALTER TYPE "SealedSubtype" ADD VALUE 'upc'`, `'collection'` (idempotente `IF NOT EXISTS`; se APENDAN).
- `CREATE TYPE "SealedGroupKind" ('set_main','promo_collection')`.
- `CREATE TABLE "SealedSetGroup"` (`@@unique(setId,tcgplayerGroupId)`, index `setId`, FK→CardSet CASCADE).
- `CREATE TABLE "SealedProduct"` (§4.34a: `tcgplayerProductId @unique`, `setId` FK, `tcgplayerGroupId`,
  `name/cleanName`, `subtype`, `subtypeInferred`, `isPrincipal`, `origin`, `imageUrl?`, `marketUsdCents?`+
  `marketUpdatedAt?`, `active`; index `setId`/`tcgplayerGroupId`).
- `ALTER TABLE "InventoryItem" ADD "sealedProductId"` (FK nullable, **`onDelete: SetNull`**, index).
- **PASO 6 en SQL:** siembra `SealedSetGroup(kind=set_main)` desde `CardSet.tcgcsvGroupId != null`
  (`ON CONFLICT DO NOTHING`). Usa solo el enum NUEVO `SealedGroupKind` (usable en su tx de creación); NO usa
  `upc`/`collection` (un valor AÑADIDO a un enum previo no puede usarse en su misma tx).
- **Backfill de datos (pasos 7-8) → `prisma/backfill-m39-sealed-product.ts`** (idempotente; corre TRAS
  aplicar la migración): deriva `SealedProduct` de items sellados **YA MAPEADOS** y liga `sealedProductId`
  (**cura el ETB→Tropius**); los **SIN MAPEO** (`tcgplayerProductId` null) quedan `sealedProductId=null` +
  **reporte de reconciliación** (cero adivinación; JAMÁS fabrica precio → `marketUsdCents=null`).
- `backend/prisma/` es **zona compartida** → migración serializada por el orquestador.

### Cómo el backfill cura el caso actual (ETB→Tropius)
El ETB actual está en `InventoryItem` como `productType='sealed'`, `tcgplayerProductId=<pid>` (mapeado por
P-35) pero anclado a la carta Tropius y sin identidad. El backfill: (a) crea un `SealedProduct` con
`name=sealedProductName` («… Elite Trainer Box»), `setId` = set de la carta ancla, `subtype='etb'`,
`marketUsdCents=null`; (b) `UPDATE InventoryItem SET sealedProductId=<sp>` para todas las piezas de ese
`tcgplayerProductId`. La pieza queda ligada a su **presentación real**; el display en cascada
(`SealedProduct` vivo → snapshot → ancla) ya no muestra «Tropius». Los «SIN MAPEO» se re-curan con el nuevo
flujo (sync del set → seleccionar el `SealedProduct` → re-alta).

### Endpoints (todos bajo `/admin`, controller `InventoryController`)
- `GET /admin/inventory/sealed-products?setId=&q&origin&principalOnly` (**vault_operator+**) →
  `SealedProductListResponse`. Lee los `SealedProduct` **persistidos** (active=true), ordenados
  `(isPrincipal desc, sortOrder asc, name asc)` (§4.34c), cada uno con `marketRef` money-safe
  **live TCGCSV → caché `marketUsdCents` → null (NUNCA 0)**; `needsSync=true` si el set no tiene catálogo;
  `groups` = `SealedSetGroup` del set (para separar «Del set» / «Promos/colecciones» por `origin`).
- `POST /admin/inventory/sealed-products/sync` (**super_admin**, auditado `inventory.sealed_products_sync`)
  `{ setId? | all?, groupIds? }` → `SealedSyncResultDTO`. Resuelve grupos (`SealedSetGroup` ∪ `groupIds`
  como `promo_collection` ∪ **name-match del `set_main` si falta**) → por grupo `listSealedProducts`
  (descarta singles) → `inferSealedSubtype` → **upsert `SealedProduct`** por `tcgplayerProductId` → asegura
  `SealedSetGroup` → **puebla `CardSet.tcgcsvGroupId`** si null. Soft-delete de los que ya no aparecen.
- `GET /admin/inventory/sealed-products/sync/candidates?setId=` (**super_admin**) → grupos TCGCSV candidatos
  por name-match (`matchScore` + `alreadyLinked`).
- `POST /admin/inventory/sealed-sets/:setId/groups` (**super_admin**, 201, auditado) `{ tcgplayerGroupId,
  kind }` → enlaza un grupo extra (1 set → N grupos); grupo ya enlazado → 409.
- **Alta = SELECCIONAR** (sin endpoint nuevo): `POST /admin/inventory/items/batch` gana
  `BatchInventoryItemInput.sealedProductId?` (identidad; el backend deriva `cardId` ancla + mapeo + imagen/
  nombre/subtipo del `SealedProduct` y congela el snapshot; `cardId` pasa a opcional) + `manualMarketMxnCents?`.
  Errores: `422 SEALED_PRODUCT_NOT_FOUND`, `422 MANUAL_MARKET_NOT_ALLOWED`.

### Alta por `sealedProductId` + precio manual money-safe (§4.34d, decisión humano v1.39.1)
- `deriveFromSealedProduct` (SEC-A1): con `sealedProductId` el cliente NO manda identidad ni montos; se
  derivan del `SealedProduct` persistido → la pieza **nace con identidad correcta** (los 4 campos M-37
  sueltos se IGNORAN). Inexistente/inactivo → **422 SEALED_PRODUCT_NOT_FOUND**.
- **Mercado al alta / fallback manual** (`resolveSealedMarketForAlta`): mercado autoritativo = caché H-1
  `PriceReference sealed:tcg:<productId>` gateada por el dial `sealedPriceSource`. **Money-safe:**
  - mercado resuelto + `manualMarketMxnCents` → **422 MANUAL_MARKET_NOT_ALLOWED** (el override solo llena
    el hueco, JAMÁS pisa un mercado vivo; **NO** se dispara por rol);
  - mercado null + `manualMarketMxnCents>0` → override AUDITADO (`AuditLog inventory.sealed_manual_market`)
    + persistido como `PriceReference isManualOverride=true`; la aportación valúa por ese valor;
  - `manualMarketMxnCents ≤ 0` → **422 VALIDATION_ERROR** (nunca 0);
  - sin override y sin mercado → **422 PRICE_PENDING** (nunca 0).
  - **Permiso `vault_operator+`** (decisión del humano): la autorización vive en el controller (rol de
    clase); el servicio no gatea por rol. **⚠ Input de dinero por operador → marcado para la fase de
    seguridad por release.**
- **Nota de diseño money-safe (deuda menor aceptada):** el «precio EN VIVO al alta» se resuelve por la
  caché H-1 (poblada por el sync + `sealed-price-ingest`, no por un fetch HTTP dentro de la transacción de
  alta — evita pool-starvation). Nunca fabrica precio. Un producto recién sincronizado ya tiene su
  `PriceReference`/`marketUsdCents` fresco; un hueco cae a manual/PRICE_PENDING. Registrado como SB-D-live
  (Baja) si se quisiera un fetch on-demand estricto.

### `sealed-price-ingest` enriquecido (§4.34a)
Barre ahora **items mapeados ∪ `SealedProduct` ACTIVOS** (`listMappedGroupIds` une ambas fuentes). Para un
`SealedProduct` sin inventario, ancla el precio a la **carta ancla del set** (menor `numberPrefix/numberSort`)
y refresca la caché `SealedProduct.marketUsdCents` (display; la autoridad sigue siendo `PriceReference`). Un
item mapeado GANA el dedupe por `productId` (usa su `cardId`).

### `inferSealedSubtype` + `SEALED_SUBTYPE_META` (`sealed-subtype.ts`, canónico)
Orden normativo §4.34c: **upc** (antes de etb/collection) → etb → bundle → box → tin → blister →
**collection** (Premium/Special/`\bbox\b` genérico) → null. `sortOrder` `upc=0…collection=6`; principales =
`box,etb,upc,bundle`. `sealed-catalog-admin.service.ts` (DEPRECADO) re-exporta esta fuente única.

### Gates (local)
- `npx tsc --noEmit` limpio · `npx jest` → **163 suites / 1589 tests VERDE** (nuevos:
  `sealed-product.service.spec.ts` 29, `inventory.sealed-product-alta.spec.ts` 8, +2 en
  `sealed-price-ingest.spec.ts`). Sin regresiones en las suites de sellado/inventario previas.

## Fase de seguridad P-38 — fix de 2 ALTOS + 1 MEDIO en el precio manual del sellado (2026-08-23)
Enrutados por la fase de seguridad (blanco: precio de dinero del sellado). Solo `backend/`. Contrato intacto
(v1.39.1/v1.40 sin cambios). `npx tsc --noEmit` limpio · `npx jest` → **163 suites / 1603 tests VERDE**.

### H-1 (ALTO, money) — atomicidad total del override manual → RESUELTA
- **Problema:** el override (`PriceReference isManualOverride=true`, referencia global autoritativa
  `sealed:tcg:<productId>`) y su `AuditLog` se escribían con `this.prisma` (NO transaccional) DENTRO del
  `$transaction` del lote → auto-commit que **sobrevivía** a una línea fallida (`ok:false`) o a un rollback
  del `$transaction` → precio de dinero pinneado **huérfano**.
- **Fix (deferred-write, per-línea):** `resolveSealedMarketForAlta` ya NO escribe: **valida** y devuelve un
  descriptor `SealedManualOverride`. El caller aplica el override con `applySealedManualOverride(ov, actor,
  tx)` **dentro de la misma `tx`** y **SOLO tras crear la pieza** (en `batchCreate`, al final de la línea,
  tras `tx.inventoryItem.create`; en `createItem`, ahora envuelto en su propio `$transaction`).
  `pricing.manualOverride(...)` y `audit.log(...)` aceptan un **`tx?: Prisma.TransactionClient`** opcional
  (default `this.prisma` — sin cambio de comportamiento para el resto de llamadores).
- **Garantía:** sin override sin pieza, ni pieza sin su override; un fallo/rollback revierte AMBOS. El valor
  del override se usa igual para valuar la aportación (no depende del write). Money-safe intacto.

### H-2 (ALTO) — override solo con `sealedProductId` validado → RESUELTA
- **Problema:** `manualMarketMxnCents` se aceptaba por el path **legacy** (`tcgplayerProductId`+
  `tcgplayerGroupId` del cliente) sin validar un `SealedProduct` activo → el override se anclaba a un
  `productId` **arbitrario del cliente**, saltándose `SEALED_PRODUCT_NOT_FOUND`/SEC-A1.
- **Fix:** gate en `resolveCreation` — `manualMarketMxnCents != null && sealedProductId == null` → **422
  MANUAL_MARKET_NOT_ALLOWED** (incluye el path legacy). El override SOLO procede cuando la identidad viene de
  un `sealedProductId` validado (SealedProduct activo, cuyo `tcgplayerProductId` deriva server-side el ancla).
  El alta normal sin override no se ve afectada por ningún path.

### M-2 (MEDIO) — `acquisitionPct` con `@Max` → RESUELTA
- `dto/inventory.dto.ts`: `acquisitionPct?` pasa de `@IsInt() @Min(0)` a **`@Min(0) @Max(MAX_APORTACION_PCT=100)`**
  en los 3 DTOs (single/batch/update). Un `vault_operator` ya no puede inflar el costo de aportación
  (costo = referencia × pct/100) por encima del 100%.

### Tests de seguridad añadidos
- `inventory.sealed-product-alta.spec.ts` — describe **H-1** (override participa del cliente tx en single y
  lote; fallo de creación de pieza ⇒ sin `PriceReference isManualOverride` huérfano ni audit) y **H-2**
  (`manualMarketMxnCents` sin/con-legacy `sealedProductId` → 422 sin escribir override; con `sealedProductId`
  válido sí procede, anclado al productId derivado).
- `inventory.batch.spec.ts` — **M-2** (`acquisitionPct > 100` y `< 0` → error de validación del DTO).
- Nota de tests: `pricing.manualOverride`/`audit.log` reciben ahora un 6º/2º arg (`tx`); los harness de alta
  single mockean `$transaction: (fn) => fn(prisma)`.

---

## v1.42 (BLOQ-3/3b/2a/2b) + v1.41 (IMP-1) — identidad de sellado en todas las vistas (rama `fix/variant-composition-regression`)

Pase ADITIVO, RETROCOMPATIBLE y MONEY-SAFE (ningún monto cambia; sin precio ⇒ null/pendiente, JAMÁS 0).
Contrato: `API_CONTRACT.md` changelog v1.41-sealed-effective-market + v1.42-sealed-identity-everywhere;
ARCHITECTURE §4.20b/§4.20d/§4.23g/§4.34a/§11. Suite completa: `npm test` → **167 suites / 1644 tests PASS**;
`tsc --noEmit` limpio.

### IMP-1 (v1.41) — `effectiveMarketCents` gateado en el alta de sellado
- `sealed-product.service.ts`:
  - `SealedProductDTO` gana **`effectiveMarketCents: number | null`** (AUTORITATIVO, gateado por el dial
    `sealedPriceSource`); `marketRef` queda reetiquetado como INFORMATIVO (ungated). `SealedProductListResponse`
    gana **`sealedPriceSource: SealedPriceSource`** (`'tcgcsv'|'off'`, una vez por respuesta). Nuevo `type
    SealedPriceSource` local (no es enum de BD).
  - `listSealedProducts` inyecta `PricingService` y computa `effectiveMarketCents` con la **MISMA** cadena H-1
    que decide `PRICE_PENDING` en el alta (`getReferencesBatch` sobre `(anchorCardId, 'sealed',
    'sealed:tcg:<productId>', 'normal')` → `gateSealedMarketCents(ref, sourceOn)`), NO una segunda ruta. El
    ancla se resuelve con `resolveAnchorCardId` (menor `numberPrefix`/`numberSort`), idéntico al alta. Un lote
    de referencias (sin N+1). `sealedPriceSource = sourceOn ? 'tcgcsv' : 'off'`.
  - Invariante verificado: `effectiveMarketCents == null` ⟺ dial off / sin mapeo / sin fila H-1 ⟺ el alta
    acepta `manualMarketMxnCents`. Sin ancla (set sin cartas) ⇒ null (money-safe).
  - **Endpoint DEPRECADO `sealed-catalog`:** NO se tocó. Devuelve `SealedCatalogResponse`/`SealedCatalogProductDTO`
    (shape propio, NO `SealedProductDTO`); §DTOs solo añade `effectiveMarketCents` a `SealedProductDTO`. Se deja
    intacto para no alterar un shape fuera de §DTOs; el front usa `sealed-products` para el campo gateado.
- Tests: `test/sealed-product.service.spec.ts` describe «v1.41 (IMP-1)» — dial off → `effectiveMarketCents`
  null aunque `marketRef` traiga caché; dial on + ref gateada → ese valor; dial on sin ingest → null.

### BLOQ-3/3b (v1.42) — el binder de master set cuenta SOLO singles
- `master-set.service.ts`:
  - `aggregateInventoryBySet` (raw SQL del índice, 4 scopes): `AND ii."productType"::text <> 'sealed'`.
  - `binder` `groupBy` de piezas: `where` gana `productType: { not: 'sealed' }` (filtro en el groupBy, NO en
    `scopeWhere`, para no afectar otras rutas que reusan el scope).
  - `resolveBuyables` `findMany` (BLOQ-3b): `where` gana `productType: { not: 'sealed' }` — un ETB sellado ya
    no llena la casilla `buyable` de un single. `graded` SIGUE contando/siendo buyable. `catalogCardCount`
    (denominador) NO cambia. SEC-A1 intacto (`salePriceCents` sigue server-side).
- Tests: `test/master-set.sealed-exclusion.spec.ts` — groupBy filtra sealed; el ETB anclado no infla ni marca
  covered; el SQL del índice interpola la exclusión; `buyable` filtra sealed y un graded sí es buyable.

### BLOQ-2a (v1.42) — `GET /vault/holdings` pinta el sellado con identidad real
- `vault.service.ts`:
  - Nuevo helper `resolveSealedDisplay(item)` = cascada §4.34a (snapshot `sealedProductName`/`sealedImageUrl`
    → `Card.name`/`imageSmallUrl`). `holdings` lo usa para poblar, SOLO en `productType='sealed'`,
    `sealedProductId`/`sealedProductName`/`sealedImageUrl`/`sealedSubtype`/`sealedCondition` (ausentes en
    raw/graded). `sealedTab` (`/vault/sealed`) se refactorizó para usar el MISMO helper (no se duplica la
    regla). Display-only: `referenceValue`/portafolio intactos (sin query extra — las columnas ya vienen en
    el item). Nota: se reusa la cascada snapshot→Card tal como en `/vault/sealed`; NO se introduce una segunda
    ruta que lea el `SealedProduct` vivo (evita divergencia, lección IMP-1).
- Tests: `test/vault.holdings-sealed-identity.spec.ts` — sellado pinta el ETB (no «Tropius»); legacy sin
  snapshot cae a `Card.name`/imagen; raw NO trae campos de sellado.

### BLOQ-2b (v1.42) — cola M2 con identidad de sellado + migración M-40
- **Migración `20260823130000_m40_pending_sealed_product`** (aditiva/reversible, patrón M-39): columna
  `PendingPriceEntry.sealedProductId TEXT` nullable + índice + FK → `SealedProduct` `ON DELETE SET NULL`.
  `schema.prisma`: `PendingPriceEntry` gana `sealedProductId String?` + relación `sealedProduct`
  (`onDelete: SetNull`) + `@@index([sealedProductId])`; `SealedProduct` gana la relación inversa
  `pendingPriceEntries`. `prisma validate` OK; `prisma generate` OK (no se pudo correr `migrate diff` por falta
  de BD en el entorno, pero el SQL sigue la convención M-39 y el schema valida).
- `pricing.service.ts`:
  - `escalatePending` gana 8º parámetro `sealedProductId: string | null = null`, que entra a la CLAVE de dedupe
    (`findFirst`) y a la fila creada — dos pendientes con igual `(cardId, gradeKey, finish)` y distinto
    `sealedProductId` (ETB vs blíster) quedan SEPARADAS. Residual money-safe: legacy sin `sealedProductId`
    colapsa bajo `gradeKey='sealed'` hasta curarse; siempre pendiente, nunca 0.
  - `pendingQueue` incluye `sealedProduct` en el `findMany` y, SOLO para `productType='sealed'`, expone
    `sealedProductId` + `sealedProductName` (cascada §4.34a: `sealedProduct.name` → `Card.name`) +
    `sealedSubtype`. `sealedProductId` es columna del modelo → se espeja también en raw/graded como null
    (mismo comportamiento que `cardProductId`); los campos RESUELTOS (name/subtype) solo se añaden en sellado.
- `inventory.service.ts`: los 4 call-sites de `escalatePending` de SELLADO propagan el `sealedProductId`
  (`r.sealedProductId` en batch/single-adjust, la var local en el path de aportación, `item.sealedProductId`
  en `resolvePublishSalePrice`); el call-site raw/graded queda con `null`.
- Tests: `test/pricing.sealed-pending.spec.ts` — dedupe por `sealedProductId` (ETB≠blíster no colapsan);
  `pendingQueue` muestra «ETB …» (no «sealed»/ancla); legacy sin FK cae a `Card.name`; raw sin campos resueltos.
- Tests actualizados por firma aditiva: `test/inventory.finish-pending.spec.ts` (escalatePending ahora con
  `null, null` finales) y `test/pricing.finish-pending.spec.ts` (include gana `sealedProduct: true`).

### Discrepancias / decisiones para el arquitecto
- **`sealed-catalog` (deprecado):** el changelog v1.41 dice que «hereda la misma regla si aún se usa», pero
  §DTOs solo añade `effectiveMarketCents` a `SealedProductDTO`, no a `SealedCatalogProductDTO` (shape distinto).
  Decisión tomada: NO alterar el shape del endpoint deprecado; el front debe leer el campo gateado de
  `sealed-products`. Si se requiere el campo también en el alias deprecado, es una decisión de contrato del
  arquitecto (no la asumo). Sin bloqueo: el endpoint vivo cumple IMP-1.

---

## Backfill P-34 / M-38 — reshape de reglas de precio legacy → tiered (money-safe, idempotente)

**Archivo:** `backend/prisma/backfill-p34-tiered-pricing.ts`
**Rama:** `fix/variant-composition-regression`

### Problema (regresión detectada por el gate E2E)
La decisión de dinero de **P-34** —bajar la COMPRA de `Rare`/`Rare Holo` del fallback 40% al **T2 = 25%**—
quedó **silenciosamente inerte** en BDs existentes (incluida prod). Causa raíz: `ConfigSetting.buylist_price_rules`
conserva el **shape LEGACY PLANO** (`{"Common":…, "Uncommon":…, "Reverse Holo":…}`) que el seed sembró en el
primer deploy; el seed hace `upsert({ update: {} })` (no pisa lo existente) y **no había migración de datos**
del reshape a tiers (M-38). El compat on-read (`money.toPriceRuleSet`) reproduce EXACTO el negocio viejo:
`Rare`/`Rare Holo` no están en el mapa plano ⇒ caen al fallback 40%, nunca al T2 25%. Verificado en E2E:
quote Charizard (Rare Holo) = 40% `source:fallback`.

### Qué hace el script (por `buylist_price_rules` y `sale_price_rules`)
1. **Idempotente:** si el valor YA está en shape tiered (`{ tierRules }`) ⇒ **NO-OP**.
2. **Pristine ⇒ reshape:** si el valor es LEGACY (plano o dos-ejes) e **idéntico** (comparación
   order-independent) al **default original** que se sembró en su día (nunca editado a mano) ⇒ lo reemplaza
   por el shape **TIERED CANÓNICO vigente** (`SETTING_DEFAULTS`), que es la decisión LOCKED del humano
   (P-34 T2=25% + DEV-tiers-1 T1=$1.50). Money-safe: escribe el seed aprobado, nunca deja una regla en 0/vacía.
3. **Divergente ⇒ NO se toca:** si el valor LEGACY **diverge** del pristine (editado a mano en M2), la
   colapsación rareza→tier es AMBIGUA (dinero). El script **lo deja intacto** (comportamiento sin cambio =
   money-safe) y lo REPORTA como **«ACCIÓN REQUERIDA — revisión humana»** (escalar al arquitecto/humano).
4. **`pricing_tier_map`:** clave NUEVA de v1.37 que BDs viejas no tienen; sin ella un `tierRules` no resuelve
   (rareza sin tier ⇒ fallback). Si falta, la crea con el mapa canónico; si existe, la respeta.

**Defaults «pristine» reconocidos** (constantes históricas, ya no en el código — fuente git `a8c40c4` plano /
`421967f` dos-ejes):
- buylist plano: `{Common:fixed 50, Uncommon:fixed 50, "Reverse Holo":fixed 150}`
- buylist dos-ejes: `{rarityRules:{Common:50,Uncommon:50}, finishRules:{reverse_holo:150}}`
- sales plano: `{Common:500, Uncommon:1000, Holo:1000, "Reverse Holo":1000}`
- sales dos-ejes: `{rarityRules:{Common:500,Uncommon:1000}, finishRules:{holofoil:1000,reverse_holo:1000}}`

### Reshape de dinero (reporte de auditoría) — solo BDs PRISTINE
El script imprime, por rareza, la regla efectiva ANTES→DESPUÉS (derivada con el MISMO `toPriceRuleSet` de
producción). Sobre una BD pristine el reshape introduce **exactamente dos cambios de dinero**, ambos parte
del seed LOCKED aprobado:
- **`Rare` / `Rare Holo` (T2): 40% → 25%** — *pagamos MENOS* (decisión P-34, el objetivo de este fix).
- **`Uncommon` (T1): $0.50 → $1.50 fixed** — *pagamos MÁS* (bandera PO **DEV-tiers-1**, bundleada en el seed).
- Sin cambio: `Common` (T0 $0.50), `Reverse Holo` (acabado $1.50), premium T3/T4 (40% = fallback vigente).
- **Sales:** reshape money-**neutral** (T0 $5 / T1 $10 pisos = legacy; T2/T3/T4 = pct 15 = fallback 15 vigente;
  acabados holo/reverse $10 = legacy). Se reshapea solo por consistencia de shape (editor M2 tiered + tier-map).

> Nota para el humano/devops: el objetivo comunicado fue «T2 = 25%», pero el mapa canónico de P-34 **también**
> sube `Uncommon` a $1.50 (DEV-tiers-1). Es la misma tabla aprobada en el seed; se aplica junta. Si se quisiera
> desacoplar, es decisión del arquitecto (no la asumí).

### Cómo correrlo (runbook devops)
```bash
# Requiere DATABASE_URL apuntando a la BD objetivo + migraciones aplicadas.
cd backend
npx prisma migrate deploy            # asegura schema al día
npx ts-node prisma/backfill-p34-tiered-pricing.ts
```
- Correr **después** del deploy del código v1.37+ y **antes** de anunciar que P-34 está vigente.
- **Seguro correrlo varias veces** (idempotente). Revisar el reporte impreso; si aparece
  «⚠ ACCIÓN REQUERIDA» para alguna tabla (BD con reglas editadas a mano), **no continuar**: escalar el
  reshape rareza→tier al arquitecto/humano (dinero) antes de tocar esa tabla.
- Rollback: no muta datos transaccionales, solo `ConfigSetting`. Para revertir una tabla concreta, restaurar
  su `valueJson` anterior desde backup (el reporte del run deja el before/after por rareza para auditoría).

### Ambigüedad de negocio pendiente (para el arquitecto/humano)
El caso **BD-divergente** (reglas editadas a mano) NO se migra automáticamente porque el shape tiered no puede
expresar divergencias per-rareza dentro de un mismo tier. Política actual del script: **no tocar + reportar**.
Si prod resulta estar divergente, se necesita decisión humana del mapeo legacy→tier a mano. El diagnóstico E2E
indica que prod tiene el shape **plano pristine** (3 claves), por lo que se espera la ruta limpia (reshape).

### Tests
- `backend/test/pricing.p34-reshape.spec.ts` — unit del planner puro `planSettingReshape` (7 casos: tiered→no-op,
  plano/dos-ejes pristine→reshape, order-independent, divergente→skip, extra-key→skip, ausente→missing). VERDE.
- `backend/test/integration/buylist.e2e-spec.ts` — actualizado a T2=25% para Rare Holo (Charizard): quote
  `pct 25 source:rule`, `quotedTotalCents = 0.25×ref`, umbral INE (`highvalue` ref subida a $12,000 para que
  25%×1.2M = 300000 = umbral, preservando el intent del test), y tope por solicitud (13×25000 = 325000 > cap).
- `E2E_CARDS.highvalue.refNmCents` en `backend/prisma/e2e-fixtures.ts`: 750000 → **1200000** (para conservar
  el umbral INE exacto bajo 25%). `highvalue` solo se usa en `buylist.e2e-spec.ts` (sin ripple).

## v1.43 (IMP-C) — el override manual de mercado del sellado SOBREVIVE al dial `off` (`gateSealedMarketCents`) (rama `fix/variant-composition-regression`, 2026-08-23)

**Escalada por regla 9 (arquitecto dictaminó en el contrato v1.43, §M2/§M10; norma en ARCHITECTURE §4.23a con
pseudocódigo).** Corrige el fraseo viejo de §52.3 («con off solo se vende con override [de venta]»): el dial
gobierna **solo la FUENTE AUTOMÁTICA** (`source='tcgcsv'`), no el override manual de mercado.

- **Síntoma (bucle cola↔publicar, gate E2E):** con `sealedPriceSource=off`, publicar un sellado sin precio
  escalaba a `PRICE_PENDING`. El admin fijaba «FIJAR PRECIO» (override manual de mercado, `PriceReference
  isManualOverride=true`/`source='manual'` en `sealed:tcg:<productId>`) y vaciaba la cola. Pero **re-publicar
  volvía a `PRICE_PENDING` y RE-CREABA la entrada** — el gate `gateSealedMarketCents` anulaba **todo** mercado
  con `sourceOn=false`, incluido el override manual.
- **Causa raíz (H-1, una sola línea de verdad):** `gateSealedMarketCents(ref, sourceOn)` devolvía
  `sourceOn && priced && cents!=null ? cents : null` — no distinguía la fuente. Como es la **única** fuente de
  verdad que consumen los 4 call-sites, el bug se manifestaba en los 4.
- **Fix — predicado corregido (`pricing.service.ts`, ~L646):**
  - Antes: `return sourceOn && ref?.status === 'priced' && ref.referenceMxnCents != null ? ref.referenceMxnCents : null;`
  - Después (pseudocódigo normativo §4.23a):
    ```
    if (ref?.status !== 'priced' || ref.referenceMxnCents == null) return null;
    if (ref.isManualOverride === true || ref.source === 'manual') return ref.referenceMxnCents; // override manual: sobrevive al dial
    return sourceOn ? ref.referenceMxnCents : null;                                             // fuente automática: gateada por el dial
    ```
- **Discriminante en `PriceInfo`:** ya exponía `source?` (y `manualOverride()` siempre escribe `source='manual'`,
  así que `source` basta). Se añadió además `isManualOverride?: boolean` a `PriceInfo` y se pobló en
  `getReference`/`getReferenceByCardProduct`/`getReferencesBatch` (el `PRICE_REF_SELECT` ya lo traía) para casar
  el pseudocódigo literal. **Sin migración** (lógica pura; el flag ya vivía en `PriceReference`).
- **4 consumidores arreglados de golpe** (comparten el gate H-1): `catalog.service.toListingDTO`,
  `orders.service.salePriceOf`, `sealed-catalog.service.loadPricedSealed` (grid) e
  `inventory.service.bulkPublish`. (También `vault.service.sealedTab` y `resolveSealedAportacionMarket`, que ya
  llamaban el mismo gate.)
- **Precedencia §K intacta:** override de VENTA por pieza (`listPriceCents`) verbatim #1 > override manual de
  MERCADO (#2/#3, alimenta `mercado×spread`) > mercado automático (gateado por el dial). Money-safe: sin
  `listPriceCents`, sin override manual y sin mercado automático aplicable ⇒ `PRICE_PENDING`, **nunca 0**.
- **Tests (`test/sealed-price-resolver.spec.ts`):** (1) unitario del gate con los 4 combos
  `{manual, tcgcsv} × {sourceOn true/false}` (manual sobrevive en ambos; tcgcsv solo con `on`) + variante
  «solo `source='manual'` sin `isManualOverride`»; (2) **bucle cerrado** con prisma COMPARTIDO real entre
  `PricingService` e `InventoryService`: dial `off` → `bulkPublish` sellado sin precio → `PRICE_PENDING`
  (1 pendiente open) → `manualOverride` (resuelve el pendiente) → re-`bulkPublish` → `sellable`/`ok:true`,
  `salePriceCents=118000` (=100000×1.18, nunca 0), **sin re-crear el pendiente** (`create` no se re-llama).
  Los mocks-réplica del gate en `test/{catalog,sealed-catalog,sealed-product.service,vault-sealed}.spec.ts` se
  actualizaron al nuevo predicado (seguían siendo «réplica exacta»).

---

## Fast-follow de seguridad — hallazgos money-adjacent N-1 / N-2 / N-3 (pre-deploy)

> Cierre de 3 hallazgos **bajos** que seguridad marcó money-adjacent (hoy inalcanzables por guards, pero
> tocan $0 y P&L → se cierran antes del deploy). Todo confinado a `backend/`. Money-safe. Suite verde
> (170 suites / 1670 tests) + `tsc --noEmit` limpio.

### N-1 · $0 latente en el precio manual del sellado — **parte 2 aplicada; parte 1 BLOQUEADA (contrato)**
- **Parte 2 (APLICADA) — endurecimiento del gate.** `pricing.service.ts` `gateSealedMarketCents` (~L662):
  el predicado ahora rechaza también `referenceMxnCents <= 0`, no solo `null`:
  `if (ref?.status !== 'priced' || ref.referenceMxnCents == null || ref.referenceMxnCents <= 0) return null;`
  Así, aunque una fila `isManualOverride` tuviera `priceMxnCents=0` (dato legacy/migración/ruta futura), el
  gate devuelve `null` (⇒ `PRICE_PENDING`) y `computeSealedSalePrice` **jamás** produce un $0 publicado —
  ni siquiera por el ramo del override manual que por lo demás sobrevive al dial. Money-safe.
  **Test:** `test/sealed-price-resolver.spec.ts` — override manual con `referenceMxnCents=0` → `null` (dial
  on y off); ref priced con centavos negativos → `null`.
- **Parte 1 (NO aplicada — rozaba el contrato, ver «Discrepancias»).** Añadir `@Min(1)` a
  `manualMarketMxnCents` (`CreateItemDto`/`BatchInventoryItemInput`) **cambiaría el status HTTP de ≤0 de
  `422` a `400`**, en contra de `API_CONTRACT` (que fija `≤0 → 422 VALIDATION_ERROR`) y de un comentario de
  diseño deliberado en el DTO. El $0 ya está cerrado por el guard de servicio (422) + la parte 2 del gate.
  Requiere decisión del arquitecto (ver abajo).

### N-2 · `acquisitionCostCents` sin `@Max` → overflow de P&L — **APLICADA**
- `inventory/dto/inventory.dto.ts`: `acquisitionCostCents` en `CreateItemDto` (~L74) y en
  `BatchInventoryItemInput` (~L150) ahora es `@Min(0) @Max(MAX_LIST_PRICE_CENTS)`.
- **Cota elegida:** `MAX_LIST_PRICE_CENTS = 100_000_000` (MX$1,000,000/pieza) — la **misma** cota que ya
  gobierna el dinero manual (`listPriceCents`). Coherente y con margen holgado frente al slab/box más caro,
  lejos de Int32 (2^31). Evita que un `vault_operator` inyecte un costo cercano a Int32 que desborde los
  agregados de P&L (`costo × qty`). `@Min(0)` se mantiene: un **costo 0 es legítimo** (promo/regalo).
- **Test:** `test/inventory.batch.spec.ts` — acepta `acquisitionCostCents = MAX_LIST_PRICE_CENTS`, rechaza
  `MAX_LIST_PRICE_CENTS + 1` (propiedad `acquisitionCostCents`), en **ambos** DTOs (batch + `CreateItemDto`).

### N-3 · resolución de pendientes sin `sealedProductId` — **APLICADA (capacidad + guard)**
- `pricing.service.ts` `manualOverride` (~L1099): el `pendingPriceEntry.updateMany` ganó un parámetro
  OPCIONAL `pending?: { sealedProductId?; cardProductId? }`. Cuando el caller aporta la identidad, esas
  claves entran al `where` (paridad con la clave de dedupe de `escalatePending`), de modo que un override de
  sellado **legacy** (`gradeKey='sealed'` compartido) cierra **solo** la entrada correspondiente y no todas
  las identidades que comparten `(cardId,'sealed',finish)`.
- **Retrocompat / caso mapeado intacto:** con `pending` ausente (default), el `where` NO se restringe —
  comportamiento previo idéntico. El **caso mapeado** (`gradeKey='sealed:tcg:<id>'`) ya segrega por
  `gradeKey`, así que no necesita la identidad; los callers actuales (override standalone del controller y
  `applySealedManualOverride` del alta) **no se tocaron** → cero regresión (verificado: los tests del alta
  y del dedup mapeado siguen verdes, incl. `toHaveBeenCalledWith` de 6 args).
- **Límite conocido (no bloqueante):** el endpoint standalone `POST /admin/pricing/override` (`OverrideDto`)
  **no transporta** `sealedProductId`, así que la resolución precisa del caso *legacy vía ese endpoint*
  requeriría añadir `sealedProductId?` al `OverrideDto` — **cambio de contrato** (arquitecto). El fix deja la
  capacidad lista en el servicio; ningún caller la necesita hoy salvo un futuro flujo legacy-consciente.
- **Test:** `test/pricing.manual-override-dedup.spec.ts` — con prisma en memoria que **honra** el filtro
  `sealedProductId`: dos pendientes legacy `sp-etb`/`sp-blister` bajo `(c1,'sealed',normal)` → un override con
  `{sealedProductId:'sp-etb'}` cierra SOLO `sp-etb` (el blíster sigue `open`); sin identidad → `where` sin
  `sealedProductId` (retrocompat); caso mapeado (`sealed:tcg:777` vs `:888`) segregado por `gradeKey`.

### Discrepancia con el contrato que necesita decisión del arquitecto
- **N-1 parte 1 (`manualMarketMxnCents` `@Min(1)`):** `API_CONTRACT.md` (§DTOs, la línea del fallback manual)
  fija explícitamente `manualMarketMxnCents … > 0 (≤0 → 422 VALIDATION_ERROR)` — un **422 de regla de
  negocio**, resuelto hoy por el guard de `resolveSealedMarketForAlta` (`'manualMarketMxnCents must be > 0'`)
  y con test que lo asevera (`inventory.sealed-product-alta.spec.ts`). Un `@Min(1)` en el DTO lo movería a un
  **400 del `ValidationPipe`**. No lo apliqué (el $0 ya está cerrado por el guard + N-1 parte 2). Si el
  arquitecto quiere el `@Min(1)` defensivo, debe decidir el trade-off `422 → 400` y actualizar el contrato;
  entonces el backend lo cablea.

---

## Herramienta de operador: `reset-db-keep-users.ts` (vaciar BD preservando usuarios)

`backend/prisma/reset-db-keep-users.ts` — script FUERA del flujo de la app, para dejar la base
"como nueva" PRESERVANDO la identidad de usuario. NO se ejecuta solo; es una herramienta manual de
operador con triple guarda. Planificador puro testeado en `reset-db-keep-users.spec.ts` (8 casos verdes;
`tsc --noEmit` limpio).

### Clasificación de modelos en 3 baldes
- **PRESERVAR (identidad de usuario) — NUNCA se borra:** `User`, `KycProfile` (KYC/INE/CLABE cifrada +
  blind index), `BillingProfile` (RFC/CFDI), `Address`, `AuthToken` (verificación de correo / reset).
  Más `ConfigSetting` (config crítica: spreads/tiers/flags/dinero; no se repuebla por sync → nunca se borra,
  ni con `--wipe-catalog`). Sin estos el usuario no podría entrar ni operar.
- **REFERENCIA/CATÁLOGO — se repuebla por "Sincronizar", CONSERVADO por defecto (`--wipe-catalog` opt-in):**
  `CardSet`, `Card`, `CardProduct`, `SealedProduct`, `SealedSetGroup`, `FxRate`.
- **OPERATIVO / DINERO — se vacía con `--execute`:** `InventoryItem`, `InventoryMovement`,
  `InventoryAdjustment`, `InventoryBatch`, `Order`, `OrderItem`, `OrderAccessToken`, `ShipmentRequest`,
  `ShipmentItem`, `SellRequest`, `SellRequestItem`, `Dispute`, `PriceReference`, `PendingPriceEntry`,
  `VariantPriceOverride`, `PortfolioSnapshot`, `SetValueSnapshot`, `SealedRestockSubscription`,
  `ProcessedStripeEvent`.
  Detrás de flags separados (conservados por defecto): `AuditLog` (`--wipe-audit`), `VaultLocation`
  (`--wipe-locations`, mapa físico de bóveda = config-infra).

### Orden FK-seguro (hijos antes que padres)
Operativo → (audit) → (locations) → (catálogo). El operativo va SIEMPRE primero porque todos los referrers
del catálogo (PriceReference/PendingPriceEntry/SetValueSnapshot/SealedRestockSubscription/InventoryItem…)
son operativos. Detalle en `OPERATIONAL_ORDER`/`CATALOG_ORDER` del script (con la FK y su `onDelete` anotados).

### FKs a `User` (por qué preservar usuarios es seguro)
`User` es SIEMPRE el lado PADRE; sólo borramos sus hijos/referrers, nunca la fila `User`.
- `onDelete: Cascade` a User: `KycProfile`, `BillingProfile`, `Address`, `AuthToken`, `PortfolioSnapshot`
  (no se disparan: no tocamos el padre).
- `onDelete: Restrict` a User: `Order.userId`, `ShipmentRequest.userId`, `SellRequest.userId`,
  `Dispute.userId` (sólo se violarían al borrar User; jamás lo hacemos).
- `onDelete: SetNull` a User: `InventoryItem.ownerUserId`, `SealedRestockSubscription.userId`.

### Triple guarda
(a) env `CONFIRM_RESET=YES_I_HAVE_A_BACKUP`; (b) primer arg = nombre EXACTO de la BD, comparado contra el
dbname de `DATABASE_URL` (aborta si difieren); (c) DRY-RUN por defecto con conteos por tabla — sólo
`--execute` borra, dentro de una `$transaction` (todo o nada, timeout 5 min). Idempotente. Loguea antes/
borradas/después por tabla.

### Decisiones abiertas para el HUMANO (no las tomé yo)
1. **Bóvedas/holdings de clientes = inventario en custodia.** No hay modelo `Holding`: las bóvedas son
   `InventoryItem` con `ownerType='customer'`/`in_custody`. El default (vaciar TODO `InventoryItem`) BORRA
   las cartas que los clientes tienen en custodia. Si "usuarios" debe incluir conservar sus holdings, es una
   operación quirúrgica distinta (filtrar por `ownerType` y limpiar sólo movements/orderItems/disputes de
   piezas de plataforma) que NO implementé — requeriría diseño del arquitecto. Hoy: "como nueva" = holdings
   fuera.
2. **Auditoría (`AuditLog`):** ¿se conserva o se borra? Default = CONSERVAR (opt-in `--wipe-audit`).
3. **Catálogo:** ¿se borra o se repuebla por sync? Default = CONSERVAR (opt-in `--wipe-catalog`).
4. **Ubicaciones de bóveda (`VaultLocation`):** el enunciado las listó como "operativo", pero son config-infra
   (mapa físico), no dato de usuario ni dinero. Las dejé CONSERVADAS por defecto tras el flag `--wipe-locations`.
5. **`VariantPriceOverride` (overrides/bounties manuales):** las metí en el balde operativo (dinero), pero
   ojo: son trabajo MANUAL del admin y NO se repueblan por sync. "Como nueva" las quita; si el humano quiere
   conservarlas habría que sacarlas del balde operativo.

## Cambios de configuración

- **Rate-limit `POST /auth/forgot-password` subido 3→10/hora (2026-08-23, `auth.controller.ts:88`):** por
  petición del humano (3/hora le bloqueaba las pruebas); ttl intacto en 1 hora. 10/hora sigue siendo tope
  anti-abuso razonable. Candado en `test/auth.throttle.spec.ts` y comentario en `main.ts:34` actualizados.

## P47-1 (MEDIA, seguridad blue team) — cota de cordura del `market` externo en tcgcsv_singles

**Archivo:** `backend/src/modules/pricing/providers/tcgcsv-singles-bulk.provider.ts`
**Rama:** `fix/variant-composition-regression`

**Hallazgo:** el `market` del feed externo TCGCSV se convertía a centavos y terminaba clampándose a
`MAX_CENTS` (~USD 21.4M) sin validación previa. Un `market` = `Infinity`/`NaN` o un finito absurdamente
grande (feed corrupto o malicioso) se clampaba EN SILENCIO al máximo → riesgo de precio de venta absurdo.

**Fix (quirúrgico, en el tramo que ya omitía null/≤0, ~L114):**
1. `Number.isFinite(pf.marketPrice)` → si no es finito se OMITE la fila (mismo invariante que ≤0: celda
   queda «—»/PRICE_PENDING, jamás un precio inventado). No se clampa.
2. Cota superior de cordura `MAX_SANE_MARKET_USD = 50_000` (constante a nivel de módulo, documentada).
   Un `market` por encima se OMITE y se AUDITA con `logger.warn` estructurado (`productId`, `finish`,
   `market`) para que un dato corrupto sea VISIBLE, no silencioso.
3. NO se inventa precio ni se sustituye por otro acabado: omitir mantiene el invariante money-safe.

**Justificación de la cota (50 000 USD):** un single real de Pokémon cotiza, aun en los grados/alter más
caros, muy por debajo de USD 50k como `market` de TCGplayer (los outliers de subasta tipo Pikachu
Illustrator no cotizan como `market`). 50k es del orden de las decenas de miles: muy por encima de
cualquier carta real y muy por debajo de `MAX_CENTS` (≈USD 21.4M), de modo que jamás se emita un precio
de venta absurdo. Es una cota defendible y conservadora; si en el futuro apareciera un single legítimo
cerca de ese techo, el `warn` lo haría visible antes de que impacte al catálogo.

**NO tocado:** la precedencia `isBetterRef` (hallazgo P47-2, en manos del arquitecto).

**Tests:** `backend/test/tcgcsv-singles-bulk.provider.spec.ts` — 3 casos nuevos: `market=Infinity` →
omitida; `market` sobre la cota → omitida + warn (con productId/finish/market); `market` normal
(3.50 USD) → emitido idéntico. Suite completa del provider: 11/11 verde.

## Cierre eje P-47 (partes 1+2+3) — deuda no bloqueante anotada (2026-08-24)

**Rama:** `fix/variant-composition-regression`

El techlead APROBÓ el cierre de **P47-2** condicionado a registrar 3 ítems de deuda NO bloqueante. Quedaron
anotados en `docs/TECH_DEBT.md` (sección «Deuda del pase P-47 parte 2»), dueño **backend**, sin tocar código
de producción:
- **BE-79** — `ownedItemRefs` (`admin.service.ts` ~L307) agrupa sin `cardProductId` / omite `BASE_CARD_REF_WHERE`
  (display 360° admin, preexistente, no money-moving).
- **BE-80** — lectura dirigida de manuales (`MANUAL_REF_PREDICATE` en `getReference`/`getReferenceByCardProduct`,
  `pricing.service.ts`) sin `take`; acotada en la práctica por el nº de overrides humanos por clave.
- **BE-81** — el `logger.warn` de la cota `MAX_SANE_MARKET_USD` (P47-1, `tcgcsv-singles-bulk.provider.ts`) no
  incluye `set`/`groupId` (observabilidad menor; ya señalado por techlead y seguridad).

**Veredicto del eje P-47 (partes 1+2+3):** cerrado con **triple veredicto — QA APROBADO, techlead APROBADO CON
DEUDA ANOTADA, seguridad CERRADA (v1.47)**.
---

## P-48 · v2.0-pricing-curve + v2.1-curve-preview — curva de precios (interpolada, sin tiers), M-41 (2026-08-24)

Rework end-to-end de TODO el eje de precios (venta y compra) según ARCHITECTURE §4.36.0–§4.36.11 y
API_CONTRACT `v2.0-pricing-curve`/`v2.1-curve-preview`. Reemplaza el modelo de reglas por rareza/tier
(`SALES_PRICE_RULES`/`BUYLIST_PRICE_RULES`/`PRICING_TIER_MAP` + los dos fallback `%`) por UNA sola
función continua e interpolada por tramos de mercado, en basis points (bp, 10000bp=100%), sin rareza ni
acabado como parámetro de monto (criterio 84 — la rareza SOLO alimenta un guardarraíl booleano). Se
implementaron las etapas E0–E8 completas, en orden, cada una con su propia suite verde antes de avanzar.
Rama `claude/card-pricing-rules-2e537m`. Money-critical: toca los dos ejes (venta al público, compra en
buylist) y el guardarraíl de rarezas premium.

### E0 — matemática pura (`backend/src/common/pricing-curve.ts` + `.spec.ts`, 75 tests)
Módulo SIN dependencias de infraestructura. `venta = ROUND_HALF_UP(max(piso, mercado × markup(mercado)))`,
`compra = max(bin, mercado × pct(mercado))`, ambas interpoladas linealmente entre breakpoints (nunca
escalonadas). `DEFAULT_PRICING_CURVE` = el seed de PROJECT §N.2 verbatim.

**ROUND_HALF_UP — confirmación explícita pedida por el coordinador:** mi implementación original de
`interp` redondeaba el DELTA (`v0 + Math.round(delta)`), no el valor final. El arquitecto corrigió §4.36.1
(commit `7f1f23d`) para exigir redondeo del VALOR FINAL (`ROUND_HALF_UP(v0 + delta)`), porque
`Math.round(-1590.5)` en JS da `-1590` (redondeo nativo hacia +∞), pero ROUND_HALF_UP (mitad ALEJADA de
cero) exige `-1591` en deltas negativos. Verifiqué con un barrido numérico exhaustivo (155,003 puntos sobre
5 tramos representativos, incluida la curva seed real) que mi redondeo-de-delta original daba resultados
IDÉNTICOS al redondeo-de-valor-final corregido en TODOS los casos — porque `v0` (el breakpoint) siempre es
entero, así que `v0 + round(delta) === round(v0 + delta)` matemáticamente. A pesar de la equivalencia
numérica probada (cero divergencias), reescribí el código para que coincida LITERALMENTE con el §4.36.1
corregido (auditabilidad): añadí `roundHalfUp(x)` como helper nombrado explícito
(`x < 0 ? -Math.round(-x) : Math.round(x)`), cambié `interp`/`interpWithSegment` para calcular
`roundHalfUp(p0.valueBp + delta)` en vez de `p0.valueBp + Math.round(delta)`, y añadí tests de medio
centavo obligatorios (`roundHalfUp(-1590.5) === -1591`, `interp` con delta exactamente `-500.5` debe dar
`15500` no `15499`). Commit `46947ee`.

`PriceBasis` (`market | floor | override | bounty | pending`) vive aquí y se re-exporta desde `money.ts`;
es el enum compartido entre los dos ejes, el guardarraíl, la instrumentación y la regla de visibilidad.
`MarketBracket` (`lt_3 | r3_10 | r10_25 | r25_80 | r80_300 | gte_300`) es una escala FIJA independiente de
la curva mutable, usada solo para agregación de instrumentación — nunca se deriva de los breakpoints.

### E1 — setting + migración M-41 (`settings.constants.ts`, `backend/prisma/migrations/`)
`SettingKey.PRICING_CURVE = 'pricing_curve'`, seed = `DEFAULT_PRICING_CURVE`, validador
`validatePricingCurveSetting`, explícitamente fuera de `SETTING_DTO_MAP` (NO se toca por
`PUT /admin/settings`; solo por `GET/PUT /admin/pricing/curve` dedicado, como los spreads del sellado).
Migración M-41 ADITIVA PURA (sin `DROP`, sin migración de datos — el precio de venta se resuelve en
lectura, no se persiste). Verifiqué que aplica limpio y sin drift (`prisma migrate diff`) contra un cluster
Postgres local provisionado ad-hoc (`/var/lib/postgresql/m41check`, puerto 5439).

### E2/E3 — seams de servicio migrados a la curva (`money.ts`, `pricing.service.ts`, ~30 specs)
`PricingService.loadPricingCurve()` es el ÚNICO lector de configuración de dinero en todo el backend
(funde los antiguos `loadBuylistRules()`/`loadSalesRules()`/`loadTierMap()` Y el
`BuylistService.buylistRules()` que antes NO delegaba en `PricingService` — dos lectores paralelos de la
MISMA config era un riesgo money-safe real, ya cerrado). Money-safe: un valor persistido inválido en BD
(edición manual) NO apaga la publicación/cotización de todo el catálogo — cae al seed §N.2 y lo grita por
`logger.error`. «Siempre hay curva» es invariante de diseño (§4.36.2: ya no existe «sin regla»).
`computeSalePriceFromCurve`/`quoteAcquisitionFromCurve` en `money.ts` reemplazan
`computeSalePriceForRarity`/`quoteAcquisitionForFinish` — firma sin `rarity`/`finish` (criterio 84).

### E4 — guardarraíl premium-en-el-piso + cola de pendientes simétrica (§4.36.5/§4.36.5c)
`premiumFloorGuard`: rareza premium que aterriza en piso(venta)/bin(compra) bloquea publicar/cotizar y
escala a `PendingPriceEntry` con `reason='premium_at_floor'`. `resolvePendingReason(basis, rarityCanonical)`
distingue `no_market` (basis=`pending`, sin `PriceReference`) de `premium_at_floor` (guardarraíl). Seam
único simétrico `settlePendingForVariant(reason, key, context, refId?)` tanto ESCALA (con motivo) como
CIERRA (cuando el precio deja de ser pendiente/premium-en-piso) — antes solo existía la mitad de escalada.
Adenda v2.1: `GET /admin/pricing/pending?reason=` filtra por motivo y devuelve `counts` agregados vía
`prisma.pendingPriceEntry.groupBy({by:['reason'], where:{status:'open',...}})`.

### E5 — bounty revalidado en las TRES seams (create/quote/publish)
`isBountyEffective` exige ESTRICTAMENTE mayor que la cotización de la curva (criterio 91).
`BOUNTY_BELOW_RULE` endurecido de `<` a `<=` al crear (ya no se puede fijar un bounty igual a lo que la
curva ya paga). `publicBounties()` reescrito para resolver mercado en lote y filtrar bounties inefectivos
ANTES del tope de 50 (antes filtraba después, podía mostrar menos de 50 aun habiendo más disponibles).

### E6 — instrumentación de los dos ejes (§N.8, criterio 95)
5 campos (`marketMxnCents`, `priceBasis`, `marketBracket`, `finish`, precio final) persistidos
DIRECTAMENTE en las filas de `OrderItem`/`SellRequestItem` (sin tabla de log separada) en el momento de
consumación (checkout / `createRequest`). `resolveSaleDecision(item)` en `orders.service.ts` calcula precio
e instrumentación en el MISMO call site para que no puedan desincronizarse. `GET /admin/reports/pricing-brackets`
(nuevo, `admin.service.ts`/`admin.controller.ts`) agrega por `marketBracket` + desglose `byBasis`.

### E7a/E7b — editor de la curva + retiro del editor viejo
`GET/PUT /admin/pricing/curve` (valida con `collectCurveViolations`, audita `pricing.curve.update` con
before/after) y `POST /admin/pricing/curve/preview` (v2.1, adelantado a pedido del arquitecto): dry-run que
separa violaciones ESTRUCTURALES (bloquean con 422) de violaciones NO bloqueantes (devuelve 200 +
`violations[]` para que el editor muestre pesos mientras el dueño arregla la curva); el preview NUNCA
autoriza el PUT, que revalida desde cero. Se retiraron `GET/PUT /admin/pricing/tiers`,
`GET/PUT /admin/pricing/tier-map`, `GET /admin/pricing/buylist-rules`, `GET /admin/pricing/sales-rules`,
`GET /admin/pricing/sales-rarities` (~480 líneas). `GET /admin/pricing/rarities` se repropuso: devuelve
`{rarities: [{canonical, raw, premium, mapped, cardCount}]}` ordenado por `cardCount` desc (se cayeron
`rule`/`tierId`/`source`/`fallbackPct` y el alias deprecado `rarity`).

### E8 — retiro SIN RESIDUOS de los cinco settings legacy (criterio 96)
Se retiró la LECTURA/ESCRITURA y la superficie de API de `SALES_PRICE_RULES`, `BUYLIST_PRICE_RULES`,
`PRICING_TIER_MAP`, `SALES_PRICE_FALLBACK_PCT`, `BUYLIST_PRICE_FALLBACK_PCT` — **sus filas quedan
HUÉRFANAS E INERTES en `ConfigSetting`, NO se borran** (§4.36.9b, mismo precedente que `rarity_map` v1.32):
borrar config en el mismo paso que cambia la matemática elimina la vía de diagnóstico y el rollback barato.
El precedente/documentación de la migración M-41 permanece intacto (aditiva pura, sin `DROP`).

Se eliminaron del código: los 5 `SettingKey` + sus `SETTING_DEFAULTS`/`SETTING_VALIDATORS`, las funciones
`validatePriceRuleSet`/`validateTieredRuleSet`/`validateBuylistRules`/`validateTierMap`/
`validateFallbackPct`/`validateSalesRules`/`validateSalesFallbackPct`/`isValidBuylistRule`/
`isValidSalesRule`, los tipos `BuylistRule`/`SalesRule`/`PriceRuleSet`/`TieredRuleSet`/
`BuylistRuleMode`/`SalesRuleMode`/`AcquisitionRuleSource`/`AcquisitionQuote`/`SalePriceResult`/
`SaleRuleSource`, las funciones `quoteAcquisition`/`quoteAcquisitionForFinish`/`computeSalePriceForRarity`/
`applyRule`/`resolveRuleForFinish`/`resolveTwoAxisRule`/`ruleKeyCandidates`/`finishRuleFor`/
`lookupRarityRule`/`toPriceRuleSet`/`buildEffectiveRuleSet`/`isPriceRuleSet`/`isTieredRuleSet`/
`isHoloRarity`/`isPremiumRarity` (la de `money.ts`; sobrevive `isPremiumCanonicalRarity` de
`rarity-catalog.ts`, que sí se sigue usando). Se borraron `backend/src/common/pricing-tiers.ts` (+ su
spec), `backend/prisma/backfill-p34-tiered-pricing.ts` (el backfill P-34/M-38 ya corrió; el código de
respaldo queda retirado, no la migración) y varios specs obsoletos de la superficie retirada. `money.ts`
conserva `Finish`, `VariantPriceControls`, `computeSalePriceCents`, toda la math de sellado
(independiente de la curva) y los helpers de `BreakdownDTO`.

> **RECTIFICACIÓN (2026-08-24, gate techlead).** Esta nota decía que `computeSalePriceCents` «sigue en
> uso» — **es FALSO**. Solo la tocan dos specs; ningún código de producción la llama, y su `@deprecated`
> apunta a `computeSalePriceForRarity`, que E8 borró. Es la única función que produce un precio de venta
> **fuera de la curva**, así que queda registrada como deuda **D2(b)** en `docs/TECH_DEBT.md`: o se
> retira o se justifica explícitamente. No se retiró en este pase por ser superficie de dinero.

**Verificación de residuo** (grep exigido por el criterio de la etapa): sin referencias vivas a
`SALES_PRICE_RULES`/`BUYLIST_PRICE_RULES`/`PRICING_TIER_MAP`/`*_FALLBACK_PCT`/`computeSalePriceForRarity`/
`loadSalesRules`/`loadBuylistRules`/`loadTierMap`/`buylistRules()` en `src/`/`prisma/` — solo quedan
comentarios de retiro explícitos (`v2.0 (P-48, §4.36.2) — ... RETIRADO`). De paso corregí varios docblocks
que describían el mecanismo viejo como si siguiera vigente (`catalog.service.ts`, `inventory.service.ts`,
`buylist.service.ts`, `pricing.service.ts`, `settings.constants.ts`, `prisma/e2e-fixtures.ts`) — quedaban
huérfanos apuntando a settings/funciones ya retiradas, incluido un docblock DUPLICADO en
`pricing.service.ts` (el viejo de `loadBuylistRules`, v1.28, seguía pegado justo encima del nuevo de
`loadPricingCurve`, v2.0) que borré por completo.

Se actualizaron dos specs de integración y el fixture compartido a la matemática v2.0:
`prisma/e2e-fixtures.ts` (`highvalue.refNmCents` recalculado de `1200000` a `600000` para que
`600000 × 50% = 300000` siga cayendo exacto en el umbral INE bajo el pct-tope de la curva, no el 25% T2
viejo), `test/integration/buylist.e2e-spec.ts` (montos esperados re-expresados en `priceBasis` en vez de
`appliedRule`; el test de tope-por-solicitud pasó de 13 a 7 ítems porque la curva paga 500/carta no
250/carta en ese tramo) y `test/integration/catalog-checkout-webhook.e2e-spec.ts` (helper `salePrice()`
sobre `resolveSaleFromCurve` en vez del markup genérico `computeSalePriceCents`).

### Estado final de la suite (post-E8, tras verificación explícita con herramientas)
`npx tsc --noEmit` limpio. `npm run lint`: 0 errores, 2 warnings preexistentes SIN relación con este
cambio (`actorUserId` sin usar en `inventory.service.ts`, `normalizeSetName` sin usar en
`sealed-product.service.ts`). `npx jest`: **171 suites / 1809 tests, todos verdes**.

### Pendiente para otro rol (NO lo toco — fuera de mi propiedad de archivos)
`scripts/post-deploy.sh` (línea 87) referencia `npx ts-node prisma/backfill-p34-tiered-pricing.ts`, que
este pase borró como parte del retiro sin residuos (E8, criterio 96 — el backfill P-34/M-38 ya corrió en
producción y su script de respaldo queda retirado). `scripts/` es territorio de **devops** por la tabla de
propiedad de archivos; queda flagueado para que devops actualice/retire esa línea del pipeline de deploy.

---

## P-48 · Ronda de gate — techlead (bloqueos 1/2), arquitecto (E4-bis/E4-ter) y QA (E0-bis) (2026-08-24)

Tres frentes cerrados sobre la rama `claude/card-pricing-rules-2e537m` después de la primera entrega de
E0–E8. Ninguno cambió el DTO, el setting ni el seed.

### E0-bis (v2.1.2) — el bug de dinero: cuantizar el multiplicador rompía la monotonía

**Lo que pasó, y por qué mi implementación no era el eslabón roto.** §4.36.1 mandaba redondear el
multiplicador interpolado a **bp entero** (`// bp entero`), y eso es lo que implementé. Redondear `k(m)`
lo convierte en una función **escalonada**: en cada escalón a la baja, `m × round(k(m))` **cae** aunque
`m` suba, y la escalera de redondeo de venta amplifica esa caída de unos centavos a **un peldaño
completo**. QA lo reprodujo con tres curvas de diales plausibles, **las tres aceptadas por el `PUT` con
`200` y `violations: []`**; la peor daba **$717.10 ⇒ $800** y **$717.11 ⇒ $775**.

V5 (monotonía de venta) demostraba algo **verdadero** —`f(m)=m·k(m)` continua es creciente— sobre un
objeto que **no era el que cobra**. El eslabón que faltaba nombrar era el 2 de la cadena de composición.

**La corrección, en el código:**
- `interpExact(points, m) → { num, den, segment }`: el valor interpolado **exacto**, como racional. Ya
  no existe un «bp entero» intermedio.
- `rawCentsFromRational(m, num, den) = ROUND_HALF_UP(m·num / (den·10000))`, en **UNA** expresión y en
  **`BigInt`**: con `m` hasta `MAX_CENTS` (~2.1e9) y `num` hasta ~1e15 el producto rebasa
  `Number.MAX_SAFE_INTEGER`, y perder precisión ahí sería reintroducir el mismo bug por otra puerta. El
  operando es siempre ≥ 0 por construcción, así que ROUND_HALF_UP se reduce a `floor((2n+d)/2d)`. El
  resultado se acota a `MAX_CENTS` **antes** de volver a `number` (BE-27).
- `interp` **sobrevive marcada SOLO-DISPLAY** (memoria de cálculo del previsualizador). `CurveLegTrace.appliedBp`
  documenta explícitamente que **no es el operando del precio**: con `k(m)` no entero, `rawCents` ya
  **no** es `ROUND_HALF_UP(mercado × appliedBp / 10000)`, y recomputarlo así reintroduce I1.
- **V6 endurecida** a `multiplier − pct ≥ 1` unidad, comparada sobre los **racionales exactos** en la
  unión de nodos (`ns·db − nb·ds ≥ ds·db`, enteros, sin división). Sobre los continuos, dos valores
  distintos dentro del mismo centavo colapsaban a `compra == venta` (margen cero, §N.3).
- **V8 intacta**: amplificaba un input ya roto, no lo generaba.

**Valores que CAMBIARON** (y son el bug, no una regresión): el pct exacto de compra en $125 es
`4062.5 bp` ⇒ `5078` centavos (antes `4063 bp` ⇒ `5079`: un centavo **inflado** por el doble redondeo).
Ese `5078` aparece ahora en `buylist.finish`, `buylist.modern-rarity` y `buylist.batch-clabe`.

> **⚠️ DISCREPANCIA DE CONTRATO PARA EL ARQUITECTO (no la toqué).** El ejemplo del dry-run en
> `docs/API_CONTRACT.md:4778` y su nota `:4794` siguen mostrando el resultado **derivado del bp
> cuantizado**: `«5000 × 3467/10000 = 1733.5 ⇒ 1734»`. Con la interpolación exacta que el propio
> v2.1.2 impone, `pct($50) = 10400/3 = 3466.666…`, así que `rawCents = 1733` y `priceCents = 1733`, y
> `deltaCents.buy` pasa de `67` a **`66`**. `appliedBp: 3467` sigue siendo correcto **como display**.
> Mismo caso en `docs/ARCHITECTURE.md:7722` (la fila E0 de la tabla de etapas cita `rawCents = 1733.5
> ⇒ 1734` como el «caso de medio centavo» obligatorio). Implementé la matemática corregida —es la
> decisión más reciente y explícita— y dejé el modo `ROUND_HALF_UP` fijado por tests propios de
> `rawCentsFromRational`. **Los dos ejemplos necesitan actualización del arquitecto.**

**Regresión permanente** (`pricing-curve.spec.ts`): las tres curvas de QA con su par que rompía y el
entorno de ±$50, el caso peor con sus cifras exactas, y el barrido del seed y de la compra
($0.01–$6 000, 0 rupturas). El barrido vive **en CI, jamás en el `PUT`**: barrer en cada escritura
cambiaría un invariante exacto por uno muestreado.

### Bloqueo 1 — el seam de venta devuelve una DECISIÓN, no un monto

`PricingService.computeSalePriceForItem` se documentaba como «seam único» pero solo cargaba config y
delegaba: el guardarraíl vivía **fuera**, así que cada consumidor tenía que acordarse de invocarlo — y
uno de cinco (`MasterSetService.resolveBuyables`) no se acordó. Efecto alcanzable y money-visible: una
premium con mercado degradado que el storefront ocultaba y el checkout rechazaba, **el binder la seguía
ofreciendo como `buyable` con CTA a un checkout que iba a fallar**.

- `decideSalePrice({ referenceMxnCents, rarityCanonical, controls, curve })` (síncrono, curva izada) y
  `computeSalePriceForItem(...)` (single, iza la curva) devuelven `SalePriceDecision`, con el invariante
  **`pendingReason != null ⇒ priceCents === null && basis === 'pending'`**. El monto se suprime **en el
  seam**, no en cada caller.
- La rareza es **obligatoria en la firma** a propósito: un caller no puede «olvidarla» sin que el
  compilador lo pare. **Criterio 84 intacto**: la matemática pura de `common/` sigue sin `rarity`/`finish`
  en su firma —que es donde §4.36.4 lo exige «hecho tipo»— y la rareza solo puede **suprimir** el monto,
  nunca fijarlo (test dedicado: misma curva, dos rarezas, mismo precio).
- **Candado mecánico** (`pricing.premium-floor-guard.spec.ts`): ningún módulo fuera de `modules/pricing/`
  puede importar la función pura `computeSalePriceFromCurve`, y los cinco consumidores deben contener una
  llamada al seam. La regla «un solo cuerpo» deja de depender de disciplina.

### Bloqueo 2 — un solo cuerpo en el eje de compra

`createRequest` reimplementaba la secuencia de `quoteCardForFinish` (rama `productId`, rama `set_base`,
`quoteAcquisitionFromCurve`, `resolvePendingReason`, derivación de `quotedPriceCents`/`priceBasis`/
`itemStatus`). Los dos cuerpos coincidían **hoy**, así que no era un bug: era el riesgo de que **el
vendedor vea un número y firme otro**. Ahora `decideBuyLine` es el cuerpo único (quote, batch y
createRequest), `quoteCardForFinish` queda como armador de DTO, y lo único propio de `createRequest` es
la instrumentación y el `settlePendingForVariant`. De paso se cerró el **N+1**: las cartas se cargan en
lote (1 `findMany`, 0 `findUnique` por ítem) mientras los overrides ya venían en lote.

### E4-bis — el punto ciego del inventario ya `listed`

`publishAll` seleccionaba `in_stock` **y** cortaba la rama `listed` antes de resolver precio. Ensanchar
la selección sin tocar esa rama habría sido **peor que no hacer nada**: cada pieza degradada se contaría
como `alreadyListed` («ya estaba bien») y el paso 2 del cut-over habría dado falso negativo *pareciendo*
verificado. Se hicieron **las dos cosas**: selección `{in_stock, listed}` y **re-resolución** de la rama
`listed`. Escalar **no cambia el status** (sigue `listed`: no hay exposición que cerrar porque el precio
se resuelve en lectura, y un flip competiría con un checkout en vuelo). `summary.listedNowPending` es
subcontador **fuera** de la partición; `alreadyListed` cambia de significado a «re-verificada y sana».
`bulkPublish` **ya** re-resolvía (nunca tuvo el corto-circuito): queda cubierto con el mismo par de tests.

> **Nota para quien toque `publishAll`:** el **snapshot de ids por adelantado** no es una optimización,
> es lo que **garantiza terminación**. Con `listed` en la allowlist es imprescindible: una pieza que
> escala **sigue casando el predicado**, así que un re-query en bucle no terminaría nunca.

### E4-ter — el barrido ABRE la cola, no solo la cierra

§4.36.5c ató la **salida** de la cola al barrido diario, pero la **entrada** quedó atada solo a eventos
de publicación: el guardarraíl **se cerraba solo y no se abría solo**. `PriceIngestService.reconcilePublishedPrices`
cierra la asimetría: al terminar de repreciar un set, re-resuelve sus piezas `platform`/`listed`/`raw`
por el **mismo seam** y abre o cierra según el veredicto. Alcance = **el set completo**, no solo las
variantes con fila nueva, porque el caso feo es justo el acabado que el proveedor **dejó de reportar**.
Se saltan las piezas con override manual por pieza (su precio no depende del mercado, mismo criterio que
`resolvePublishSalePrice`). Falla-seguro: un error aquí **no tumba la ingesta** (los precios ya se
persistieron). Sin contrato, sin migración, sin job nuevo.

### M1 — el cap de sondas del dry-run devuelve 400, no 422

`POST /admin/pricing/curve/preview` usaba `BusinessException.validation` (422) para la **forma** del
request. Manda el contrato: **400**. La forma no es regla de negocio y el precedente local es unánime
(`/buylist/quote/batch`, `bulk-publish`, `bulk-remove`). Los 422 quedan solo para las infracciones de
curva que **impiden calcular**. El test que se titulaba «→ 400» solo asertaba el `code` y nunca el
status —por eso la divergencia pasaba verde—: ahora assertea el **status HTTP**, con el recíproco 422.

### Estado de la suite tras la ronda
`tsc --noEmit` limpio · `lint` 0 errores (2 warnings preexistentes ajenos) · **171 suites / 1859 tests
verdes**. Deuda anotada en `docs/TECH_DEBT.md`: **D1** (cerrada por arrastre del bloqueo 1), **D2**
(residuos de E8, incluida la rectificación de `computeSalePriceCents`), **D5** (dos criterios para
`listPriceCents > 0` — es dinero y necesita decisión del arquitecto) y **D6** (menores, cerrados).

---

## P-48 · Ronda final pre-seguridad — E0-ter, E0-quater, E5-bis y el cierre de los menores (2026-08-24)

Última ronda antes de la fase de seguridad. Cuatro bloques normativos (`v2.1.4` y `v2.1.5`) más los
menores del techlead. **Ningún cambio de DTO ni de setting**; un rango se ensancha (V3) y `details`
gana campos (aditivo).

### E0-ter (v2.1.4) — V9: la simetría que faltaba en el eje de compra

**El hueco.** V5 solo iteraba `sale.points`, y V6 ata la compra únicamente en **relativo** (por debajo
de la venta): nada impedía que el **monto pagado bajara en absoluto** mientras el mercado subía. Con
diales de tienda real (50 % @ $10 → 20 % @ $500), mercado **$410.90 paga $104.60** y **$500.00 paga
$100.00** — $89.10 más de valor, $4.60 menos para el cliente. Es la misma clase que I1, **sin la
amplificación de la escalera** (la compra no se redondea), y por eso pasó desapercibida: no da el
salto llamativo de un peldaño, **solo pierde dinero en silencio**. §N.0 aplica simétricamente: pagar
de menos ⇒ el vendedor no vende ⇒ carta perdida, irrecuperable.

V9 es el mismo chequeo algebraico de extremos de V5 aplicado a `buy.points`, con código propio
`BUY_CURVE_NOT_MONOTONIC`. Dos cosas quedaron **escritas en el código** para que nadie las
«simplifique»:
- **Los tramos planos de compra no se justifican como los de venta.** Allá el argumento es V4
  (`k ≥ 10000 > 0`); aquí **no hay V4** y `pctBp ∈ [0, 10000]`, así que se apoya en **V3** (`p ≥ 0`):
  con `p = 0` el tramo es **constante**, que sigue siendo no decreciente y deja el pago en el `bin`.
  Hay un test de `pctBp = 0` que **debe pasar**, precisamente para cazar a quien copie el razonamiento
  de venta.
- **V9 no exige que el pct suba.** Eso es **intención** (§N.1) y vive como aviso no bloqueante del
  previsualizador. V9 impone el **invariante de dinero**, que es más débil: bajar el pct en un tramo
  mientras el pago absoluto sube es legítimo, y hay test que lo fija. *Invariante = dinero; aviso =
  intención.*

**Techo de `marketCents` (V3).** Se aceptaba `9_000_000_000`. El producto final se computa en `BigInt`
(correcto), pero `interpExact` calcula `num = v₀·den + (v₁−v₀)·(m−m₀)` en aritmética `number` **antes**
de que el `BigInt` intervenga: con un breakpoint absurdo ese `num` sale del rango seguro justo en el
paso que E0-bis acaba de blindar. Cota: `[0, MAX_CENTS]`.

### `rawCentsFromRational` violaba su propio ROUND_HALF_UP

`(2n + d) / (2d)` en `BigInt` **trunca hacia cero**, que no es «medio alejándose de cero» para
negativos: `(5, -50000, 1)` daba `-24` cuando el exacto es `-25.0`. Ahora redondea sobre **magnitudes**
con el signo aparte.

Y el docblock que lo justificaba —«el operando es SIEMPRE ≥ 0 por construcción»— era **falso**. La
corrección de v2.1.5 lo deja preciso: **quien garantiza el signo es V3, no V4**, y **solo porque V3
bloquea también en la ruta del `preview`**. Si alguien vuelve V3 no bloqueante «para que el
previsualizador enseñe más», reabre el caso negativo sin notarlo. Las funciones quedan **defensivas
ante negativos de todos modos**: apoyarse en «es imposible» es la clase exacta de suposición que
produjo I1.

### E0-quater (v2.1.5) — V4 era estructuralmente inalcanzable

**V3 y V4 eran el mismo predicado con manejos opuestos:** V3 exigía `multiplierBp ≥ 10000`
**bloqueante (422)**, V4 exige lo mismo **no bloqueante (200 + `violations`)**. Un `5000` era
simultáneamente ambas cosas, y como V3 bloquea primero, **V4 nunca podía dispararse** — el
previsualizador **jamás** podía enseñar en pesos «esto vendería por debajo del mercado», que es
exactamente el caso para el que se diseñó el reparto 422/200. La validación existía y estaba muerta.

V3 baja su piso a `0` y queda como **representabilidad**; V4 queda como el **invariante de negocio**.
Ahora `multiplierBp = 0` **calcula** (raw `0` ⇒ gana el piso ⇒ `basis='floor'`) y `violations` explica
por qué no se guarda; `−5000` lo corta V3 en el campo. **Cada invariante en su superficie.**

> Ojo con la interacción: tratar el negativo en `rawCentsFromRational` **no sustituía** bajar el piso
> de V3. Son cosas distintas — sin el cambio de V3, V4 seguía inalcanzable.

**`details` normado campo por campo, sin «…».** El hueco era de **cinco** códigos. El contrato decía
`{ axis, index, marketCents, … }` y dejaba el segundo extremo del tramo dentro del «…»; el front
declaró `toIndex`/`toMarketCents` —nombres que inventó y que **nadie podía contradecir**— y el segundo
extremo **nunca se marcó desde E9**. El peor era `BUY_ABOVE_SALE`: su copy lleva `{pct}` y `{mult}`, y
sin ellos el front los **adivinaba o los recalculaba**, o sea **interpolaba en el cliente** — justo la
duplicación de fórmula que el `preview` existe para eliminar. Ahora viajan, con `saleIndex`/`buyIndex`
por separado (el nodo puede ser de una sola curva). `ROUNDING_LADDER_INVALID` gana **`bandIndex`**,
con nombre distinto **a propósito**: indexa `rounding[]`, no `points[]`.

**El test que sí lo habría cazado** (`test/pricing.curve-details-shape.spec.ts`): contrato **por
código**, assertando los **campos exactos** de `details` y no solo el `code` — que es como todos los
tests previos dejaban pasar el hueco. La convención transversal que sale de esto: **ningún campo que
un consumidor deba leer puede vivir dentro de un «…»**. *El contrato no mintió: no dijo.*

### E5-bis (v2.1.4) — D5 completo, con los seis sitios

`<= 0` es **AUSENTE** en todos los seams, con **un solo predicado** (`hasManualPrice`,
`isPresentAmount`, `firstPresentAmount` en `common/money.ts`, junto a la H-1 que ya regía para variante
y sellado). Se eliminaron **dos `??`**, que eran la forma sutil del mismo bug: `??` solo salta
`null`/`undefined`, así que un `0` cortocircuitaba y **enmascaraba el siguiente peldaño** — en
`resolvePublishSalePrice` un `0` en la línea tapaba el override de la pieza, y en el export XLSX
tapaba el `sellOverrideCents` de la variante.

**El sexto seam lo abrió este mismo pase:** `price-ingest:507`, el bucle de reconciliación de E4-ter.
Con `!= null` saltaba la pieza al repreciar y **nunca se reconciliaba** — el hueco de D5 reabierto
dentro del mecanismo que existe para cerrarlo. Mi nota de `TECH_DEBT` listaba cuatro sitios y eran
seis; corregido allí.

**Escritura (cinturón y tirantes):** `@Min(1)` en los **cinco** DTOs que escriben la columna — los tres
que la spec nombra más `UpdateItemDto` y `AdjustmentFoundItemInput`: dejar uno en `Min(0)` mantendría
abierta la puerta para crear el estado prohibido. La lectura no se relaja por eso (las filas
anteriores a la validación ya están en la base), y **una sola de las dos puntas es exactamente lo que
falló**.

### `DisplayBp` y el retiro de la trampa cargada

`saleMultiplierBpAt`/`buyPctBpAt` **retiradas**: cero llamadores de producción, exportadas
públicamente, nombradas exactamente como uno buscaría un multiplicador… y devolviendo el valor
**cuantizado**. `DisplayBp` pasa a **norma**: `interp` y `CurveLegTrace.appliedBp` devuelven un tipo
**opaco** — en runtime es un `number` (el JSON del contrato no cambia), en compilación **no se puede
multiplicar**. Desenvolverlo exige `displayBpValue`, explícito y **greppable**. Candado con
`@ts-expect-error` que falla si alguien vuelve a permitir la aritmética. Hasta ahora la puerta estaba
cerrada por convención, y la lección de I1 es justamente que una garantía de dinero no puede depender
de que alguien recuerde una convención.

**El candado de arquitectura cubría `src/modules` pero no `src/jobs/`** — que es exactamente donde
viviría un repriciador nocturno, el sitio con más razones para llamar a la función pura y saltarse el
veredicto. La raíz pasa a `src/` completo con exclusión de `common/` y `modules/pricing/`, más un test
que verifica que el barrido **alcanza** `src/jobs/`.

### Menores

- **Int32 tras la escalera:** `roundUpWithStep` redondea **hacia arriba**, así que podía sacar el
  precio del rango aunque `rawCentsFromRational` ya hubiera acotado (con `m = 2e9`, `2_147_485_000`).
  `money.ts` re-acotaba en la ruta de cobro, pero `previewCurve` devolvía la traza sin acotar. Cerrado
  en `explainSaleFromCurve`, el único cuerpo.
- **Smoke de MinIO contradictorio:** el comentario decía «o 403 si el bucket no existe» pero el assert
  exigía `[200,204]`, y el `catch` solo atrapa fallo de **conexión** — un 403 es una respuesta HTTP
  exitosa a nivel socket, así que se colaba y tumbaba el smoke por una razón que el propio comentario
  declaraba tolerable. Resuelto en la dirección estricta, con skip explicativo en modo no estricto.

### Estado de la suite
`tsc --noEmit` limpio · `lint` 0 errores (2 warnings preexistentes ajenos) · **173 suites / 1916 tests
verdes**. Deuda nueva anotada en `docs/TECH_DEBT.md`: **D7** (escritura secuencial del pase nocturno —
anotar, no hacer) y **D8** (`batchQuote` sin batchear, ahora barato porque las tres superficies
comparten `decideBuyLine`). **D5 marcada como RESUELTA.**

---

## P-48 · Cierre de la fase de seguridad — S48-M1, S48-M2, P48-B1 y AML-1 (2026-08-24)

Los tres veredictos ya estaban dados (QA, techlead, seguridad: 0 críticos / 0 altos); esto cierra los
hallazgos que quedaban antes del cut-over. **Ninguno cambia un precio**; todos cierran control.

### S48-M1 (Media) — la cola se cierra por (variante, EJE, RAZÓN), no por variante

Lo encontró seguridad ejecutando las funciones puras contra el seed real, y **es mío de raíz**.
`closePendingForVariant` cerraba por variante, sin eje ni razón, apoyado en el invariante v1.26: *«la
`PriceReference` es COMPARTIDA por clave, así que si el mercado resolvió, resolvió para las dos
caras»*.

**Ese argumento era válido con UNA sola razón.** `no_market` sí depende de un dato compartido.
`premium_at_floor` —que añadí yo en v2.0— depende de **constantes distintas por eje**
(`sale.floorCents` 2500 vs `buy.binCents` 100, con V7 garantizando `bin < floor`), así que las dos
caras **ya no resuelven juntas**. Con el seed y mercado de MX$10:

```
VENTA  → 2500c basis 'floor'  reason 'premium_at_floor'   (bloqueada)
COMPRA →  300c basis 'market' reason  null                (resuelve)
```

…así que un cliente **autenticado** mandando esa variante en `POST /buylist/requests` cerraba la
entrada que el eje de venta había abierto. No perdía el **bloqueo** (el seam re-bloquea y re-escala en
el siguiente `publish-all`) pero perdía el **aviso** — justo la entrada que §4.36.5c describe como «la
que necesita que el dueño mire». Y el peor momento para que la cola se vacíe sola es el **cut-over**,
que es cuando más entradas hay.

Regla nueva, **por razón** (quirúrgica, no un apagón del cierre): `no_market` se cierra desde
cualquier eje —con test, porque si dejara de hacerlo la otra cara quedaría abierta para siempre, que
es justo lo que v1.26 vino a evitar—; `premium_at_floor` solo desde el eje que la abrió; las filas
históricas (`reason = null`, pre-M-41) como `no_market`; y sin `context` (vía manual del admin) el
cierre sigue siendo total, porque ahí se arregla el dato de mercado compartido, raíz de las dos.

> **Residual conocido, para el arquitecto.** Con la clave de dedupe actual hay **una sola fila abierta
> por variante**, y su `context` es el de quien la creó. Si las **dos** caras están bloqueadas a la vez
> (posible: con el seed, cualquier mercado < $3.33 bloquea ambas) y la que la creó resuelve primero, la
> fila se cierra aunque la otra siga bloqueada — hasta que esa otra la reabra. Cerrarlo del todo exige
> meter `context` en la clave de dedupe, que es **decisión de schema/contrato**, no de implementación.
> Con esta corrección el caso pasa de «cualquier eje apaga cualquier aviso» a un residual estrecho.

### S48-M2 (Baja) — DTO CERRADO: `isManualOverride` viajaba sin estar declarado

`PriceInfo.isManualOverride` nunca estuvo en el contrato y el backend lo emitía **a endpoints
anónimos**: un mapa **scrapeable** de qué cartas llevan precio fijado a mano — o sea dónde falló el
feed y dónde el precio puede estar desalineado. **Se retira** (no se reubica en admin: es
**redundante**, `source === 'manual'` carga el mismo bit; el flag sigue en la fila de BD y
`gateSealedMarketCents` discrimina por `source`, que es lo que `manualOverride()` siempre escribe).

**Quitarlo no basta:** `PriceSource` incluye `manual`, así que **`source` filtra la misma señal**.
`toPublicPriceInfo` es ahora el único cuerpo que decide qué sale, y proyecta por **lista blanca** en
vez de hacer `delete`: si mañana `PriceInfo` gana un campo interno, no sale por omisión — es la
diferencia entre cerrar una fuga y cerrar la clase. Aplicado a `/catalog/*`, al grid de sellado y
**también a la bóveda del cliente** (un cliente no es `vault_operator+`: necesita el valor y su
frescura, no de qué feed salió). Admin conserva la procedencia. `capturedDate` sigue en público.

**El test es de CONJUNTO EXACTO de claves**, que es lo único que habría cazado esto: todos los tests
previos comprobaban que los campos esperados **estuvieran**. *«Aditivo es seguro» vale para el
consumidor, no para el emisor: publicar de más no rompe a nadie, **filtra**.* Es la otra cara del
hueco de `details` (v2.1.5) — aquél apagó funcionalidad, éste publicaba información. Incluye candado
explícito de **no-sobrecorrección**: `referenceValue` y `priceBasis` **siguen viajando** (§N.7 los
manda, y seguridad reclasificó ese hallazgo a la baja precisamente por eso).

### P48-B1 — tres agujeros en `PUT /admin/settings` (IVA, fees, topes AML, umbral de INE)

1. **Lista blanca esquivable por la cadena de prototipos.** `SETTING_DTO_MAP[dtoKey]` con
   `__proto__`/`constructor`/`toString` devuelve un heredado **truthy** ⇒ pasaba el `if (!settingKey)`
   y llegaba al `upsert` con clave no-string ⇒ **500**. Ahora se pregunta por **propiedad propia**
   (`hasOwnProperty.call`, no `Object.hasOwn`: el target del build es ES2021 y son equivalentes, así
   que no obligo a mover configuración de compilación) más un `typeof === 'string'` de defensa.
2. **Y al escribir el test apareció la misma clase un nivel más abajo.** El acumulador `errors` se
   indexa con claves **controladas por el atacante**, y sobre un objeto normal
   `errors['__proto__'] = 'unknown setting key'` **no crea propiedad** —es el setter de `[[Prototype]]`,
   no-op silencioso con un string—, así que **el error se perdía**, `Object.keys(errors).length` seguía
   en 0 y la petición continuaba **como si fuera válida**. `Object.create(null)` lo cierra.
3. **El «todo o nada» que prometía el propio comentario era falso en la escritura** (los `upsert` sin
   transacción) y **la bitácora se perdía justo donde más importa** (el controller auditaba *después*
   de `update()`, así que una excepción saltaba el `audit.log` y el dial persistido no dejaba rastro).
   Ahora los upserts y la fila de auditoría van en **la misma `$transaction`**: commitean o revierten
   juntos, en cualquier orden de fallo — incluido que reviente la propia auditoría, donde los diales
   revierten (en un endpoint de dinero la bitácora no es opcional).

> El test construye el payload con `JSON.parse` y **no** con un literal, porque ahí está el vector:
> `{ __proto__: x }` en un literal **fija el prototipo** y no crea propiedad propia, mientras que
> `JSON.parse` **sí** — que es como llega un body HTTP. Con un literal el test pasaría sin probar nada.

### AML-1 (§4.36.6a) — el tope mensual liga el dinero que SALE

El tope se evaluaba sobre la **cotización de intake**, pero el dinero sale en la **aprobación**: una
línea `precio_pendiente` entra consumiendo **$0** y, si el dueño le fija precio y la aprueba, ese monto
**sí sale** — y nada lo medía. La curva **amplió la población de líneas en `$0`** (dos vías nuevas
hacia `precio_pendiente`), así que el hueco es responsabilidad de este pase aunque el remedio viva en
M5: *un control AML no se define solo por su mecanismo de concurrencia, sino por el universo de montos
que mide*.

Implementado en el seam de money-out **que ya existía** (`paySpei`, donde vive `@MoneyOut`), no en un
control nuevo. Se ancla en **`paidAt`** y no en `createdAt` (una solicitud de diciembre pagada en enero
consume tope de **enero**, que es cuando sale el dinero). El monto es `approvedTotalCents ??
quotedTotalCents`, sumado en memoria porque es un **COALESCE** que `_sum` de Prisma no expresa y sumar
el campo equivocado sería justo el error que este control cierra. Bajo **`Serializable`** por la misma
razón que el intake (SEC-A2). La transacción del intake **no se toca**: esto **añade** la verificación
de salida.

### `createRequest` ya no escribe la cola por una solicitud que no existe

Escribía en `PendingPriceEntry` **antes** de topes/INE y **fuera** de la transacción: una solicitud
rechazada dejaba igual su rastro y —peor— podía **cerrar** entradas por una solicitud que nunca
existió. Misma clase que S48-M1, otra puerta. Ahora el bucle solo **acumula la intención** y la cola se
escribe **después del commit**. No dentro de la tx serializable a propósito: meter N escrituras ahí
alargaría su ventana de conflicto sin ganar nada, y el seam es idempotente y simétrico — si el proceso
muriera entre commit y escritura, la siguiente cotización o el siguiente `publish-all` re-escalan.
**Perder una escalada es recuperable; escribir la cola por una solicitud que no se creó, no.**

### Estado de la suite
`tsc --noEmit` limpio · `lint` 0 errores (2 warnings preexistentes ajenos) · **177 suites / 1962 tests
verdes**. Deuda nueva: **D9** (el reporte de brackets escanea sin cota — la validación de fechas del
mismo hallazgo **sí** se cerró; el escaneo necesita `groupBy` en BD y el eje de compra tiene un
COALESCE que `_sum` no expresa).

---

## P-48 · B-1 / B-2 / I-1 — lo que QA encontró contra el STACK VIVO (2026-08-24)

QA corrió los E2E contra el stack real por primera vez: **80/80 en mocks se convirtió en 3/8**. La
funcionalidad central de P-48 estaba rota, y dos de los tres bloqueantes son míos.

### B-1 — «Valor de mercado» no aparecía en NINGUNA ficha de single

`buildGroups` construía el `GroupedListingDTO` **omitiendo `priceBasis`** —requerido por contrato—
teniéndolo a mano en `cheapest.dto` (la línea siguiente ya lo usaba para `referenceValue`).

El front decide con `primary?.priceBasis === 'market'`. Con `undefined` esa comparación es **siempre
falsa**, así que la regla de §N.7 quedó **invertida**: de *«se muestra si y solo si el mercado fijó el
precio»* a *«no se muestra nunca»*, en el **100%** de las fichas. Es el mismo defecto de fondo que
veníamos cazando —la visibilidad decidida por un dato que no llega— pero al revés que la fuga del
pentester: aquélla **publicaba de más**, ésta **apagaba funcionalidad**.

### B-2 — `SealedGroupDTO` omitía `priceBasis` **y** `currency`

Mismo colapso en la ficha de sellado. El basis se deriva ahora **donde vive el `SealedSpreadResult`
completo** (`loadPricedSealed`) y no en el builder del DTO: reconstruirlo desde `source` habría creado
un segundo cuerpo de la misma regla. Con esto las dos fichas comparten **una sola** regla de
visibilidad, que era exactamente el motivo de darle `priceBasis` al sellado.

### La causa de fondo, que es la que me toca

**Los dos DTOs se construían como objetos literales SIN TIPO**, así que omitir un campo requerido
**no era un error de compilación**. `GroupedListingDTO` y `SealedGroupDTO` quedan **declarados** y los
builders **anotados**: esa clase entera de fallo pasa a ser un error de `tsc`.

Lo verifiqué revirtiendo la emisión con los tipos ya puestos: el spec nuevo **deja de compilar**, que
es mejor que fallar en runtime.

**Y el test que faltaba.** Tres capas de verificación y el campo faltaba en la que nadie miraba:
- los fixtures del front **horneaban** `priceBasis: 'market'`;
- mi `catalog.dto-closed.spec.ts` assertaba sobre el **`ListingDTO`** (por-pieza), que sí lo traía;
- ningún test `@real` abría una ficha.

`catalog.group-dto-shape.spec.ts` assertea el **conjunto exacto de claves de los DTOs de GRUPO**, y lo
hace sobre la forma **serializada**: en memoria, un opcional ausente y un requerido que falta se ven
igual (`undefined`), y esa diferencia es justo la que B-1 explotó. Es el complemento simétrico del
otro spec: aquél vigila que **no salga de más** (fuga), éste que **no falte de menos** (rotura).

### I-1 — falta de credencial: 401, no 422

`jwt-auth.guard.ts` era el **único outlier del archivo**: la rama de token inválido (mismo método) y
las guards hermanas ya devolvían 401. **No es cosmético**: el interceptor del cliente filtra por
`status === 401` para disparar el refresh y limpiar la sesión, así que el 422 **esquivaba esa rama
entera** y una sesión sin token acababa en un error genérico en vez de ir al login. Semánticamente,
422 dice «tu payload no valida» — aquí no hay payload, falta la credencial. Nada lo cubría; ahora hay
spec unitario **y** E2E sobre las cuatro rutas que QA probó a mano.

### La condición de QA para levantar el rechazo — atendida del lado del backend

> *«Mientras esos specs no aporten tests `@real`, P-48 seguirá sin una sola prueba que lo mire contra
> un backend vivo — que es exactamente cómo B-1 llegó hasta aquí.»*

Los `@real` del front son de frontend, pero **mi lado del contrato sí es mío**:
`test/integration/pricing-visibility.e2e-spec.ts` (16 casos contra **Postgres real**) mira los DTOs de
grupo **tal como salen por HTTP**, el 401 sin credencial, los `counts` de la cola con datos reales, y
**S48-M1 en vivo**: cotizar en compra la premium-en-el-piso **no apaga** el aviso que abrió el eje de
venta.

**El seed ahora siembra `PendingPriceEntry`**, que no tenía ningún dato real (sus `counts` estaban
verificados en forma pero no en número). Las dos razones sembradas son **estados verdaderos**, no filas
decorativas: `nopref` no tiene `PriceReference` (`no_market`) y la carta nueva `floorpremium` es
premium con mercado de MX$10 ⇒ su venta cae al piso (`premium_at_floor`) mientras su compra resuelve —
el escenario exacto de S48-M1.

> **Correr la suite de integración COMPLETA valió la pena:** la carta nueva rompió
> `buylist-cards-order.e2e-spec.ts`, que tiene un **oráculo explícito** del orden natural del set. Se
> actualizó el oráculo y se dejó escrito por qué sigue siendo explícito y **no derivado** de
> `E2E_CARDS`: derivarlo haría que un fixture mal ordenado se auto-justificara y el test dejaría de
> comprobar lo que vigila.

### Menor — `GET /admin/pricing/card/:cardId` devolvía filas Prisma crudas

`id`, `cardProductId`, `fxRate`, `fxBufferPct`, `createdAt` y la fecha en ISO completo. Es
`super_admin` (sin fuga pública), pero es la misma doctrina de S48-M2: **un DTO es cerrado**. Se
proyecta por lista blanca a la forma que **el frontend ya declaró como SUPUESTO** en `contract.ts` —
inventar otra habría roto su pantalla sin ganar nada— con fecha corta como el resto del sistema.
`isManualOverride` **sí** viaja aquí y no contradice S48-M2: allá se retiró de superficie **anónima**
por redundante con `source`; ésta es `super_admin`, donde la procedencia **es** el dato consultado.

> **⚠️ Para el arquitecto:** esa forma sigue **sin estar declarada** en el contrato. Backend y frontend
> coinciden hoy por **acuerdo tácito** — que es exactamente la condición que produjo B-1. Vale la pena
> declararla, aunque el endpoint sea admin.

### Estado
`tsc --noEmit` limpio · `lint` 0 errores (2 warnings preexistentes ajenos) · **unitarios: 179 suites /
1980 tests** · **integración: 143/143 contra Postgres real** (eran 127; +16 nuevos).

---

## P-48 · v2.1.7-declared-shapes — la causa raíz, y la auditoría que dejó a backend (2026-08-24)

El arquitecto normó las dos rutas que dejé marcadas y, auditando el acuerdo tácito de
`GET /admin/pricing/card/:cardId`, encontró **la causa raíz de toda la familia de bugs** de este pase:

> Cuando la respuesta **es** la entidad, la forma de la API la define el **schema**, no el contrato — y
> entonces **cada migración es un cambio de contrato silencioso.**

M-41 añadió columnas a **tres** modelos. Con ese patrón, cualquier columna futura **se auto-publica sin
que nadie lo decida**. Es literalmente la máquina que produjo el hueco de `details` (v2.1.5), el de
`PriceInfo` (v2.1.6) y B-1 (v2.1.7).

### Las dos rutas normadas

`toPriceHistoryEntry` es **un solo cuerpo**, por **lista blanca** (no `delete`, no spread de la fila).
Hay un test que **simula la próxima migración** —añade una columna al objeto de entrada— y comprueba
que no sale por omisión: esa es la propiedad que se busca, no que hoy los campos coincidan.

- **`GET /admin/pricing/card/:cardId`** → `{ data: PriceHistoryEntryDTO[] }`.
- **`POST /admin/pricing/override`** → `{ data: PriceHistoryEntryDTO }`. Era el **caso testigo**:
  devolvía la fila completa (`id`, `priceUsdCents`, `fxRate`, `fxBufferPct`, `cardProductId`,
  `createdAt`).

> **Dónde vive la proyección, y por qué.** El **servicio** sigue devolviendo la entidad **a propósito**:
> su otro llamador (`inventory`, alta de sellado con precio manual) la compone dentro de una
> transacción y necesita la fila. La proyección vive en el **borde HTTP**, que es donde se decide la
> forma de la API. El `id` sigue yendo a la **bitácora**, que es donde se necesita para trazar.

**`source` pasa a ser el ENUM.** Era la grieta del acuerdo tácito: yo lo tipaba `string`, el frontend
`PriceSource`. Con `string`, un valor fuera del enum **compila** de mi lado y **rompe el render** del
otro sin que nada avise — justo en el campo del que trata la ruta.

### La auditoría encontró algo peor que las rutas de pricing

`PATCH /admin/users/:id/status` devolvía la fila **`User` COMPLETA**: **`passwordHash`**, más
`tokenVersion`, `googleId` y `anonymizedAt`. Es `super_admin` y el hash es bcrypt, así que no es una
fuga explotable de inmediato — pero **un hash de credencial no tiene ninguna razón para viajar en la
respuesta de «cambiar estado»**, y es exactamente el fallo que la norma predice.

Se proyectó con el **mismo `select` que ya usaba `listUsers`** (el endpoint hermano): no inventé forma,
reusé la que el consumidor ya conoce.

### Lo que NO proyecté, y por qué es deliberado

La auditoría completa quedó en `docs/TECH_DEBT.md` **D10** con archivo:línea: ocho sitios más
(`addresses`, `guest-checkout`, `inventory items/locations`, `buylist`, `shipments`, `disputes`,
`kyc`). **Ninguno expone credenciales.**

No los proyecté porque **el contrato no declara la forma de ninguna de esas respuestas** — `AddressDTO`
incluso se **referencia** en §5 y **nunca se define**. Proyectarlas ahora sería que backend **invente
ocho formas por su cuenta**, que es **exactamente el «acuerdo tácito» que produjo B-1** y que esta
revisión vino a erradicar. Y hacerlo en vísperas del gate de release metería riesgo de regresión en
rutas de dinero sin ganancia de seguridad. El arquitecto declara; yo proyecto contra lo declarado.

### `isManualOverride` en el historial — ratificado, y con mejor argumento que el mío

El arquitecto fue a **verificar** mi afirmación de redundancia en vez de aceptarla, y encontró que
**ahí no la hay**: `sourceRank(source, isManualOverride)` casa `isManualOverride || source === 'manual'`
— o sea las trata como **señales separadas**, así que una fila puede venir marcada manual con un
`source` distinto. En `PriceInfo` se resuelve **una** referencia y `source === 'manual'` la determinaba
por completo; en un historial de **N filas de auditoría**, ambas cargan información. Queda con la regla
que generaliza:

> La pregunta correcta nunca es «¿este campo es sensible?» sino **«¿es sensible para quien lee esta
> ruta?»**.

### Estado final del árbol
`tsc --noEmit` limpio · `lint` 0 errores (2 warnings preexistentes ajenos) · **unitarios: 180 suites /
1989 tests** · **integración: 146/146 contra Postgres real**. Las tres rutas corregidas están
verificadas **por HTTP contra el stack vivo**, no solo en unitarios.

---

## v2.1.8 — Los valores de enum se DERIVAN del schema (el dueño ya puede vender UPC) (2026-08-24)

**Ortogonal a P-48**: no toca la curva, ni el guardarraíl, ni los DTOs de precio. Va aparte a
propósito, para que el delta sea legible.

### El daño, y por qué no fue uniforme

`SealedSubtype` tiene **siete** valores en el schema (`box etb bundle tin blister upc collection`).
Había **ocho** listas de cinco escritas a mano —tres más de las que el grep inicial encontró— y
`upc`/`collection` quedaron fuera de todas:

| sitio | efecto |
|---|---|
| `@IsIn` del catálogo público | filtrar por UPC ⇒ **400** |
| `validateEnum` del catálogo de sellado | mismo rechazo |
| filtro de la **bóveda** | **se ignora EN SILENCIO**: el cliente pide sus UPC y recibe todo su sellado |
| `@IsIn` del alta de inventario (**×4**) | **no se podía ni CAPTURAR** una pieza UPC |
| `SEALED_SUBTYPE_KEYS` de spreads | **422**: sin poder calibrar spread ⇒ siempre el fallback del 25 % |

El de la bóveda es el peor: **no falla, miente**. «Ignorar en silencio lo que no matchea» es un
diseño correcto para **basura desconocida** — pero aquí el valor **existe en el schema**, así que el
silencio escondía un bug en vez de tolerar entrada inválida. Y el de spreads es **dinero**: un UPC es
pieza grande, comparable a una box (18 %) o un ETB (22 %), y salía al 25 % sin ajuste posible.

### Por qué derivar y no «añadir dos strings»

Añadirlos a ocho listas cerraba **este** bug y dejaba la **clase** abierta: el próximo valor del enum
se cae por el mismo agujero. Las listas se derivan ahora del **enum de Prisma** —que es el espejo del
schema— en `src/common/enum-values.ts`, **una sola declaración**. Prisma genera un objeto en runtime
además del tipo, así que `Object.values(...)` no puede desincronizarse por construcción. Se derivan
también `Finish`, `ProductType`, `GradingCompany`, `AcquisitionType`, `RawCondition`,
`SealedCondition` y `Locale`.

> **La distinción que quedó escrita en el módulo, porque derivar mal rompería negocio:** ahí solo va
> lo que debe ser el enum **completo**. Un `@IsIn` que a propósito acepta un **subconjunto** —
> `UserStatus` en `PATCH /admin/users/:id/status`, que acepta `active|blocked` pero **no** `deleted`
> porque ese lo fija el `DELETE`— **no se deriva**: su lista es una **decisión de producto**, no un
> espejo del schema.

### El test cierra la clase en DOS direcciones, y la segunda encontró más

1. **Paridad**: cada lista derivada == los valores del enum. Además se lee **`schema.prisma` en
   disco**, por si el client estuviera regenerado pero desfasado.
2. **Residuo**: **ninguna lista literal** de esos valores sobrevive en `src/`.

La segunda dirección **encontró dos sitios que el grep inicial no vio** (`buylist.dto.ts` con `Finish`
y `ProductType`; `pricing.controller.ts` con `Finish`). Sin ella, la paridad habría pasado verde
mientras un `@IsIn` olvidado seguía rechazando al cliente — que es **exactamente la situación que
había**. Misma doctrina que el candado de arquitectura del eje de venta y que `DisplayBp`: convertir
una disciplina en algo que sostiene la máquina.

### Estado
`tsc` limpio · `lint` 0 errores · **unitarios 181 suites / 2002 tests** · **integración 146/146 contra
Postgres real**.

---

## v2.1.9 — La CLABE cifrada viajaba en cinco rutas más, y la norma que lo prohibía no existía (2026-08-24)

> Rama `claude/card-pricing-rules-2e537m`. Hallazgos enrutados por el gate de release (QA + techlead +
> seguridad, tres veredictos aprobados, 0 críticos / 0 altos) más los encargos **D1/D2/D4** que el
> arquitecto desbloqueó en `be4cc71`. Todo lo de abajo es backend; **ningún cambio de contrato** salió
> de aquí.

### S49-M1 · El snapshot cifrado de la CLABE, en cinco rutas (seguridad, Media) — CERRADO

`SellRequest.clabeSnapshotEnc` es el blob **AES-256-GCM** de la CLABE del vendedor. El contrato (§M5)
es literal: «**nunca** el snapshot cifrado»; `reveal-clabe` es el único punto autorizado, con
`@MoneyOut()` y auditoría. El release anterior aplicó esa regla a **dos** sitios (`getMine`,
`adminGet`) y la declaró universal. **En el mismo archivo** quedaban cinco `return` con la fila entera:

| Ruta | Quién la alcanza | Cómo se llegaba |
|---|---|---|
| `POST /buylist/requests/:id/respond` (`decline`) | **el propio cliente** | transición terminal |
| `POST /buylist/requests/:id/respond` (`accept`) | **el propio cliente** | transición |
| `POST /admin/buylist/:id/receive` | `vault_operator` | transición |
| `POST /admin/buylist/:id/verify` | `vault_operator` | transición |
| `POST /admin/buylist/:id/pay-spei` | `super_admin` | transición **y salida idempotente** |

La **salida idempotente** de `pay-spei` es la más fácil de alcanzar de todas: basta **re-postear el
pago** — devolvía el `findUnique` crudo sin pasar por ninguna transición. `getMine` filtraba además
`closedAt`, que el schema marca «NO se expone en DTOs de cliente» (SEC-D2, ancla la retención de INE).

**Cómo se proyecta.** Dos funciones en `buylist.service.ts`: `toAdminSellRequestDTO` y
`toCustomerSellRequestDTO` (= la de admin **menos** `closedAt` y `paidBy`; `paidBy` es el uuid del
staff que liquidó — el vendedor no tiene por qué recibir la identidad del operador). Son **listas
blancas**: una lista negra sólo protege de las columnas que existían el día que se escribió.

> **Para QA y frontend:** el shape de esas respuestas **no cambia** salvo por lo retirado. El front no
> consumía `clabeSnapshotEnc`, `closedAt` ni `paidBy` en ninguna de las cinco (verificado en
> `frontend/src/lib/api.ts` y `M5View.tsx`: `respond` sólo usa `{id,status}` y las demás ignoran el
> cuerpo). `reveal-clabe` **sigue igual**.

### R1 · `PATCH /admin/users/:id/kyc` devolvía la entidad `KycProfile` (pentester, Media) — CERRADO

Devolvía `rfcEnc`, `clabeEnc`, `ineFrontKey`, `ineBackKey` y —lo más grave— **`clabeHmac`**, el *blind
index* determinista. Ese HMAC existe **para no salir jamás del servidor**: es lo que permite comparar
CLABEs sin descifrarlas, así que publicarlo entrega un **oráculo de igualdad** («¿estas dos cuentas
comparten CLABE?») y un valor pre-computable contra un diccionario si la clave HMAC se filtrara.

La decisión ya existía y esta ruta la ignoraba: la ruta hermana `getUser`, **con el mismo privilegio**,
borra a propósito esos campos y reduce el INE a `ineOnFile: boolean`. Se aplica **esa** proyección
(`ADMIN_KYC_SELECT` + `toAdminKycDTO`), no una inventada. El `select` es lista blanca **a nivel de BD**:
la PII cifrada **ni siquiera se lee**.

> **Para frontend:** la respuesta pasa de la fila cruda a la forma de `AdminKycProfileDTO` (§M6) —
> `kycStatus`, `capPerRequestCents`, `capPerMonthCents`, `ineOnFile`. `M6View` ignora el cuerpo (sólo
> invalida queries), así que no hay cambio observable.

### R4 · El barrido completo — y qué encontraron las dos listas previas que faltaba

Las dos listas anteriores estaban incompletas y en direcciones distintas, así que este barrido se hizo
desde cero sobre `backend/src/`, con **dos** patrones (directo `return prisma.X.op(...)` e indirecto
`const x = await ...; return x`): **24 directos + 13 indirectos**. De ésos, ~14 eran falsos positivos
estructurales (`return` **dentro** de una `$transaction` cuyo caller sí proyecta, helpers privados,
`count()` que devuelve un número, o un `select` ya presente).

**Lo que ninguna de las dos listas previas traía** (además de que la del pentester omitía el módulo
con la PII):

- `disputes.service.ts` — `listMine` y `getMine`, o sea el **cliente** recibía la fila `Dispute`
  completa, con `resolvedBy` (uuid del súper-admin que resolvió) y `repurchaseOrderId`. La lista
  citaba sólo `:152,163` (el `resolve` admin).
- `users.service.ts` — `listAddresses`, además del `create`/`update` que sí estaban listados.
- `disputes.service.ts` `adminList` — el listado paginado, no sólo la transición.
- `shipments.service.ts` — `withAdminKind` esparcía la fila entera (`...row`), así que `adminList` y
  `adminGet` eran raw-entity **en disguise**: el patrón `return prisma.X` no los delataba.
- `buylist.service.ts` `itemDecision` — devolvía `SellRequestItem` crudo por **tres** caminos, con las
  columnas legacy `category`/`ruleMode`/`ruleValue`/`ruleSource` que ya nada escribe (v2.0 P-48).
- `inventory.service.ts` `getItem` y `listLocations`, además de los cuatro ya listados.

Ninguno de esos lleva secreto **hoy**; se proyectaron **fijando la forma ACTUAL** (lista blanca de lo
que ya viajaba): **cero cambio visible**, cero forma inventada, y la columna sensible de mañana ya no
se auto-publica.

**La norma pasó a la máquina** — `backend/test/no-raw-entity-response.spec.ts`, dos capas:

1. **Comportamiento.** Se llama al servicio con una fila que **sí** trae el secreto y se afirma que la
   respuesta no lo contiene. Un mock de Prisma **ignora los `select`**, así que este test sólo pasa si
   la proyección es explícita en el código — que es justamente el punto.
2. **Estructura.** Barrido de `src/` que prohíbe `return prisma.<modelo>.<op>(…)`. Lo que no se puede
   proyectar lleva **`PROJECTION-EXEMPT: <motivo>`** en el propio código: la excepción deja de ser un
   silencio y pasa a ser **una frase que alguien tuvo que escribir**. Hay un segundo test que verifica
   que el barrido **no está midiendo el vacío** (si un refactor cambiara el acceso a datos, el regex
   dejaría de encontrar nada y pasaría verde).

### D1 · Techo de cordura de `floorCents` / `binCents` (arquitecto, `be4cc71`) — CERRADO

`MAX_CURVE_CONSTANT_CENTS = 1_000_000` (**MX$10,000**) en `common/pricing-curve.ts`. Bloquea igual en
`PUT /admin/pricing/curve` y en `POST /admin/pricing/curve/preview` (V3 es Fase 1 ⇒ **422** en las dos,
mismo `code` y mismo `details { axis, index: null, field }`).

**Lo importante es que NO es `MAX_CENTS`.** Con Int32 el caso que QA demostró en vivo **seguiría
pasando**: `floorCents: 2147483647` es representable y publica la vitrina entera saturada. `marketCents`
describe *el valor de una carta* ⇒ su techo es de **representabilidad**; el piso y el bin son las únicas
entradas que **por sí solas** fijan el precio de todo el catálogo ⇒ el suyo es de **cordura**. El test
lo fija con los tres valores que importan (`2e15`, `2147483647`, `1000001`) **asertando el status
HTTP**, no sólo el `code`.

**Efecto colateral deseado (y verificado):** una curva **ya persistida** con el piso disparado deja de
servirse — `sanitizePricingCurve` la declara inválida y cae al seed (`fellBack=true`). El síntoma que
QA vio era de lectura; ahí es donde se corta.

> **Lo que este techo NO hace, y no se intentó cubrir:** no ataja «un cero de más». Un piso de MX$250
> (`25000`) **pasa y debe pasar** — es calibración plausible, y el error y la intención escriben el
> **mismo número**. Eso lo cubren dos señales que **ya existen**: `constantWon` por sonda en el preview
> y `premium_at_floor` en `GET /admin/pricing/pending`. Hay un test con ese nombre para que nadie lo
> lea como una defensa anti-typo. El **número** (MX$10,000) está escalado como **Q-D1**: cambiarlo es
> una enmienda de una línea, sin efecto en la matemática ni en ningún DTO.

### D2 · La regla de visibilidad se impone en el EMISOR (arquitecto, `be4cc71`) — CERRADO

§N.7 dice que «Valor de mercado» se muestra **si y solo si `priceBasis === 'market'`**, y eso se cumplía
**sólo en el navegador**: un `curl` **sin token** a `GET /catalog/listings/<id>` devolvía
`priceBasis:"override"` **junto con el número de mercado** — el bloque exacto que la UI tiene prohibido
pintar. El argumento que lo sostenía («el mismo DTO alimenta admin y valuación») quedó **derogado por
escrito**: `toPublicPriceInfo` ya recortaba por superficie (quita `source` desde v2.1.6), así que la
premisa era falsa.

**El recorte va en UN solo proyector**, `toPublicPriceInfo(info, priceBasis?)`, nunca repartido por
seams. Quién recibe qué:

| Superficie | `priceBasis` | número de mercado |
|---|---|---|
| **Rejilla** `GET /catalog/cards` | **no viaja** | **no viaja** |
| **Rejilla** `GET /catalog/sealed` | **no viaja** (ni `priceSource`) | **no viaja** |
| **Ficha** `GET /catalog/cards/:id` (`listings[]`, `units[]`) | viaja | **iff** `market` |
| **Ficha** `GET /catalog/sealed/:id` (`group`) | viaja (y `priceSource`) | **iff** `market` |
| `GET /catalog/listings/:id` | viaja | **iff** `market` |
| `/vault/*`, `/admin/*` | **SIN CAMBIO** | **SIN CAMBIO** |

- **En sellado se va también `priceSource`** de la rejilla: `priceBasis` se **deriva** de él, así que
  dejarlo publicaría la misma señal con otro nombre — el error que v2.1.6 documentó al retirar
  `isManualOverride` y descubrir que `source` filtraba igual.
- **`priceBasis` NO se vuelve opcional en ningún DTO** — eso es literalmente B-1 (`undefined ===
  'market'` es `false` **siempre** ⇒ el bloque no se mostraba nunca). Las rejillas reciben **tipos
  propios declarados**: `GroupedListingSummaryDTO` y `SealedGroupSummaryDTO`. Omitir el campo en la
  ficha **no compila**, y emitirlo en la rejilla tampoco.
- **`/vault/*` y `/admin/*` quedan intactos a propósito** (§N.7 los excluye): ahí el cliente ve el
  mercado de lo que **ya posee** y el back-office necesita la procedencia. Omitir el argumento
  `priceBasis` en esas llamadas es deliberado y está dicho en el docstring — **no lo "unifiques"**.

> **Para frontend (cambio de shape, coordinar):** `GroupedListingListResponse.data` y
> `SealedGroupListResponse.data` cambian de `GroupedListingDTO`/`SealedGroupDTO` a sus `*SummaryDTO`.
> Si alguna teja leía `priceBasis` o `referenceValue`, ahora recibe `undefined` — pero §N.7 dice que
> tejas y listados **no muestran** valor de mercado, así que no debería haber consumidor.
> **Esto NO releva al front de obedecer `priceBasis` en la ficha:** es defensa en profundidad, no
> permiso para inferir comparando cifras.

### D4 · `RawCondition` pasa a **clase R**, y la paridad de enums a **tres bandas** — CERRADO

El candado de enums era **tautológico**: `expect(Object.values(e)).toEqual(Object.values(e))`. No podía
fallar. Un valor nuevo en cualquier enum del schema pasaba **verde** y quedaba **auto-aceptado en la
API**. El único ancla real era el `toHaveLength(7)` de `SealedSubtype`, y era **accidental**.

- **Ancla humana por enum**: `EXPECTED_ENUM_VALUES` con la lista aprobada escrita a mano. Un valor
  nuevo en el schema **rompe el test a propósito** y obliga a decidir tres cosas que el espejo
  automático decidía solo (¿se acepta en los `@IsIn` públicos? ¿hay listas de negocio que NO son el
  enum completo? ¿hay pricing/spreads que calibrar?).
- **Tres bandas**: `schema.prisma` ⇄ `enum-values.ts` ⇄ **la línea canónica del contrato**. La tercera
  es la que falló **dos veces** (`PriceSource` sin `tcgcsv_singles`, `SealedSubtype` sin
  `upc`/`collection`) porque **nadie la comparaba**.
- **`RawCondition` sale de `enum-values.ts`** a `src/common/business-rules.ts` como
  `ACCEPTED_RAW_CONDITIONS = ['NM']`, literal y con `PROJECT.md` §H citado al lado. Aplica a los 4
  `@IsIn` del alta de inventario, los 3 del buylist y el filtro público de condición de Compra. Sus dos
  tests de clase R: **lista exacta** y **subconjunto** del enum de Prisma.

**La distinción, en una frase:** `enum-values.ts` responde *«¿qué valores EXISTEN?»*;
`business-rules.ts` responde *«¿cuáles ACEPTAMOS?»*. Cuando las dos respuestas coinciden hoy, sigue
importando cuál de las dos preguntas se está haciendo — es la que decide qué pasa mañana.

### T-3 · El porqué de la exclusión de `UserStatus`, movido al call-site

`admin.controller.ts` tenía `@IsIn(['active','blocked'])` **sin comentario** y sin ningún test que
fijara el rechazo de `deleted`. El riesgo es concreto: el escáner de residuo marca las listas de enums
escritas a mano como infractoras, y el fix «obvio» —derivarla— le concedería a `PATCH /status` poner
`deleted` **saltándose todo `deleteUser`** (que anonimiza la PII, pone `passwordHash: null`,
**incrementa `tokenVersion`** revocando los JWT vivos, y borra direcciones/KYC). Resultado: un usuario
«eliminado» con la PII intacta y la **sesión viva**. El porqué vive ahora en el DTO, y
`test/admin.user-status-enum.spec.ts` fija el rechazo (+ un test que verifica que el enum del schema
sigue siendo **más ancho**, para que la afirmación no se vacíe de contenido).

### T-2 · DTOs con tipo declarado que espeja el CONTRATO, no la implementación

- **`CardDTO`** y **`ListingDTO`** declarados en `catalog.service.ts`; `toCardDTO` y `toListingDTO`
  anotados. Antes `GroupedListingDTO.card` era `ReturnType<typeof toCardDTO>` — **el tipo espejaba la
  implementación**: si el builder perdía `displayFinishes`, el tipo lo seguía y ningún test lo veía.
- **`HoldingDTO`** declarado en `vault.service.ts`. Ahí el riesgo era mayor por el **spread condicional**
  (`...sealedFields`): con dos ramas y sin tipo, una podía perder un requerido sin que la otra lo notara.
- La aserción de conjunto exacto **baja al segundo nivel** (`listings[0].card`), que era el hueco: las
  de forma sólo cubrían el primer nivel.
- Las listas de claves dejan de estar duplicadas a mano: viven en `test/helpers/dto-keys.ts` derivadas
  con `Record<keyof DTO, true>` ⇒ añadir un campo al DTO y no declararlo **no compila**.

### MENOR 3 (QA) · El filtro `sealedSubtype` de la bóveda, cubierto

`vault-sealed.spec.ts` no ejercitaba el filtro con **ningún** valor, y es justo el sitio donde el bug de
v2.1.8 **no fallaba: MENTÍA** (el `if` no entraba, el WHERE salía sin filtro y el cliente recibía todo
su sellado creyendo ver sólo sus UPC). QA no pudo probarlo por comportamiento porque la bóveda del seed
está vacía de sellado; ahora hay (a) los **siete** subtipos verificados contra el WHERE que llega a
Prisma, (b) un test de **comportamiento** con dos piezas de subtipo distinto —filtrado vs sin filtrar,
para que el «1 resultado» no se confunda con una bóveda vacía— y (c) un test que fija que un subtipo
**inexistente** se sigue ignorando (tolerar basura desconocida SÍ es correcto; esconder un valor que el
schema conoce, no).

### Semilla de spreads del sellado: `upc: 18` y `collection: 22` — **y por qué NO llega sola a un entorno vivo**

El dueño confirmó que **vende UPC** y eligió los dos valores (2026-08-24). El criterio es el que la
tabla **ya venía usando**, «ítem más chico ⇒ % mayor» (`box 18 · etb 22 · bundle 25 · tin 30 ·
blister 35`): un **UPC** (Ultra Premium Collection) es la pieza **más grande y cara** del catálogo, así
que va con **box**; una **collection** es comparable a un **ETB**. Hasta ahora las dos caían al
`sealed_spread_fallback_pct: 25` — un número que **nadie eligió** para la pieza más cara que vendemos,
y que fue el síntoma del que salió todo el hilo del enum en v2.1.8.

> ### ⚠️ PASO DE RUNBOOK PARA DEVOPS — esto es **semilla, no migración**
>
> `prisma/seed.ts` upserta los diales con **`update: {}`** (a propósito: no pisa lo que el admin ya
> editó). Consecuencia concreta: **una BD ya sembrada conserva su fila de CINCO llaves**, y correr
> `prisma migrate deploy` + `seed` **no la actualiza**. Aplica a la **local viva de este stack** y a
> **producción** cuando exista.
>
> Llevar el valor a un entorno existente es una **acción operativa**, no un despliegue:
>
> ```
> PUT /api/v1/admin/pricing/sealed-spreads     (super_admin, auditado, sin redeploy)
> { "spreadPctBySubtype": { "upc": 18, "collection": 22 } }
> ```
>
> El `PUT` es **parcial** (sólo las claves a cambiar), así que no hay que reenviar las otras cinco.
> Queda en `AuditLog` (`pricing.sealed_spreads.update`, con `before`/`after`). Verificación:
> `GET /admin/pricing/sealed-spreads` debe devolver las siete llaves.
>
> **No lo des por hecho al desplegar.** Sin ese `PUT`, un UPC publicado en un entorno existente se
> sigue vendiendo al fallback del 25 % — money-safe, pero **no es el precio que el dueño eligió**.

Hay un **ancla** en `test/sealed-settings.spec.ts` que exige **una entrada por cada `SealedSubtype`**:
cuando el schema gane un octavo subtipo, el test rompe y obliga a **elegir su spread a propósito** en
vez de dejarlo caer al fallback en silencio. Misma doctrina que las anclas de `enum-values-parity`.

> **⚠️ DIVERGENCIA CON EL CONTRATO — para el arquitecto (no la corrijo yo, regla 9).**
> `docs/API_CONTRACT.md` §M2 dice hoy, literal: «**`upc` y `collection` NO tienen semilla** — […] Que
> no tengan semilla es justamente por qué el dueño **necesita** poder fijarlas a mano». Esa frase
> describía el estado **anterior** a la decisión del dueño y **ahora contradice el código**. La
> enmienda es de una línea (las semillas de §K pasan a listar las siete). Lo señalo aquí en vez de
> tocarlo porque el contrato manda sobre el código y no es mío; la decisión del dueño (PROJECT §K) es
> la que manda sobre el contrato. **Puede viajar junto con la enmienda de `MAX_CURVE_CONSTANT_CENTS`
> que ya está pedida** — el arquitecto está editando esa misma sección ahora mismo.

> **⚠️ HUECO DETECTADO DE PASO (no implementado, no enrutado a mí todavía): hoy NO se puede BORRAR un
> spread para volver al global.** El validador vigente exige `número ∈ [0, 1000]`, así que
> `PUT { "spreadPctBySubtype": { "upc": null } }` responde **`422`** (verificado). Es decir: el dueño
> puede **fijar** el spread de una presentación pero **no retirarlo**. La única salida hoy sería
> mandar `0`, que es un **bug de dinero**: `0` es un spread legítimo y significa «vender **al mercado,
> sin markup**», no «usa el global». El arquitecto ya tiene una norma redactada en su borrador
> (`null` explícito retira la llave, idempotente y auditado). **Cuando la commitee, es trabajo de
> backend**: aceptar `null` en el validador y borrar la llave del mapa persistido. No lo adelanto —
> el shape del request es contrato (regla 9).

### Lo que NO se tocó, y por qué

- **Deuda anotada, no resuelta:** D-a, D-b, D-c, D-d, D-f y **S49-B2** quedan en `docs/TECH_DEBT.md`
  con dueño, razón y disparador. **S49-B2 se juzgó explícitamente**: los 3 endpoints `@Public` que
  paginan en memoria **no** son baratos de arreglar, y el arreglo barato (un `take`) sería **peor** que
  la deuda — truncaría el catálogo en silencio, e inventario publicado que no aparece en Compra es
  inventario que no se vende. El fix real exige persistir el precio de venta, lo que revierte la
  propiedad «repricia en lectura» de §4.36.9c ⇒ **decisión del arquitecto**.
- **D-e** se cerró de paso (las listas de claves ya se derivan de la interfaz).
- **`MAX_CURVE_CONSTANT_CENTS` sigue en `1_000_000`.** El dueño contestó Q-D1 y lo baja a **MX$2,000**
  (`200_000`): el piso de venta es *el precio de la carta más barata de la tienda*, así que MX$10,000
  nunca es configuración legítima, un techo apretado ataja más typos y equivocarse sólo cuesta un
  `422` (siguen quedando **80×** sobre la semilla de MX$25). **No se implementa todavía**: el techo
  está declarado en `docs/API_CONTRACT.md` §M2 y en ARCHITECTURE §4.36.3, así que la enmienda va
  primero por el **arquitecto** (regla 9). Cuando llegue, además del valor hay que mover los casos de
  `test/pricing.curve-constant-cap.spec.ts`: hoy son `1000000 ⇒ 200` y `1000001 ⇒ 422`, y pasan a
  `200000 ⇒ 200` y `200001 ⇒ 422`; **se conservan `2147483647 ⇒ 422` y `2e15 ⇒ 422`**, que son los que
  demostró QA y los que hacen visible que el techo **no** es de representabilidad.

### Estado
`typecheck` limpio · `lint` 0 errores (2 warnings preexistentes, ajenos) · **unitarios 185 suites /
2089 tests** · **integración 11 suites / 149 tests contra Postgres real**, todo en verde.

> **El stack vivo de `:3099` NO se reinició** tras el cambio de semilla, a petición del coordinador
> (seguridad está corriendo PoC contra el proceso). No hace falta: la semilla sólo la lee
> `prisma/seed.ts` en una instalación limpia, y el proceso vivo lee los spreads de la **BD**, cuya fila
> no cambia (ver el paso de runbook de arriba). El backend corre con `ts-node` **sin watch**, así que
> editar no lo afecta.

> **Nota para QA sobre `test/integration/pricing-visibility.e2e-spec.ts`:** cuatro de sus casos
> afirmaban lo VIEJO (que la **rejilla** trae `priceBasis` y `referenceValue`) y **fallaron a
> propósito** al implementar D2 — es la señal correcta, no un flake. Se reescribieron: la afirmación
> de B-1 se mudó a la **ficha**, que es donde `priceBasis` se consume, y se añadió el `iff` verificado
> **por HTTP y sin token**, incluido el PoC exacto del pentester
> (`GET /catalog/listings/<id>` de una pieza con override ⇒ `priceBasis` sí, número de mercado no).

---

## Cierre de la FUSIÓN pricing v2 — DOS CAPAS: REFERENCIA (tcgcsv_singles, P-47) × REGLA (curva v2) (2026-08-28)

Ejecutado el merge `--no-ff` de `origin/claude/card-pricing-rules-2e537m` sobre `integration/pricing-v2-merge`
(rama base = `origin/main` HEAD `3edf19e`), siguiendo ARCHITECTURE §4.36 (DICTAMEN DE FUSIÓN) y API_CONTRACT
v1.49 («Dos capas de precio»). Resultado: se **ADOPTA** la capa REGLA (curva v2) y se **CONSERVA** la capa
REFERENCIA (`tcgcsv_singles`, P-47); son ortogonales. Se **RECHAZA** el borrado de `tcgcsv_singles`.

### Conflicto de CÓDIGO resuelto — `price-ingest.service.ts` (§4.36c)
Único conflicto de código real. Los dos lados añadían un método distinto en la misma región (main:
`ingestSinglesForSet` P-47; v2: `reconcilePublishedPrices`). NO son mutuamente excluyentes: uno **ESCRIBE**
referencia y el otro la **LEE**. Resolución = conservar AMBOS métodos y encadenarlos en secuencia
escribir-luego-leer dentro del camino primario:
- **CONSERVADO (P-47):** `ingestSinglesForSet` íntegro (upsert per-acabado keyed por `cardProductId`,
  `source='tcgcsv_singles'`, respeta `isManualOverride`, NO toca estructura ni `FinishReconciler`). Junto con
  el `import`, el parámetro de constructor `tcgcsvSinglesBulk`, el registro en `providerFor()` (sigue
  devolviendo `tcgcsv_singles` como PRIMARIO — candidatas `[pptBulk, tcgIoBulk, tcgcsvSinglesBulk]`), el
  dispatch en `ingestForSet` (`if provider.source === 'tcgcsv_singles' → ingestSinglesForSet`) y el fichero
  `providers/tcgcsv-singles-bulk.provider.ts` (NO fue borrado por el merge; verificado presente = versión main).
- **ADOPTADO (v2):** `reconcilePublishedPrices` (reprice por-curva de piezas publicadas: `loadPricingCurve`,
  `getReferencesBatch`/`getVariantOverridesBatch` per-acabado, `decideSalePrice`, `settlePendingForVariant`
  con `pendingReason`), más toda la capa REGLA que auto-mergeó (`common/pricing-curve.ts`, editor M2 de
  curva/spreads/UPC, DTOs con `priceBasis`, migración M-41).
- **COEXISTENCIA (§4.36c.6):** añadí dentro de `ingestSinglesForSet`, tras los upserts de referencia y solo
  si `result.requestOk && result.rows.length > 0`, la llamada `await this.reconcilePublishedPrices(set)`.
  Así el barrido PRIMARIO (tcgcsv_singles) primero ESCRIBE la referencia per-acabado del día y luego la LEE
  para re-resolver la curva de lo ya `listed` (guardarraíl continuo). Sin esto, el primario habría
  repreciado la referencia pero nunca re-resuelto la curva de las piezas publicadas.

### Banderas restauradas / verificadas (§4.36d)
1. `PRICE_PROVIDER_VALUES = ['pokemontcg_io','pokemonpricetracker','tcgcsv_singles']` — el auto-merge
   conservó la versión de main (3 valores). v2 la había reducido a 2; quedó restaurada.
2. `enum PriceSource` (schema Prisma) conserva `tcgcsv_singles`. OK.
3. Seed/default `PRICE_PROVIDER` = `pokemontcg_io` — idéntico en main y v2; NO se tocó. `tcgcsv_singles`
   permanece como OPCIÓN válida (vía `PRICE_PROVIDER_VALUES`).
4. Registro en `pricing.module.ts`: `TcgcsvSinglesBulkPriceProvider` sigue en el array de `providers`. OK.
5. Tests: no quedó ningún spec asertando `providerFor()==[pptBulk,tcgIoBulk]` ni la ausencia de
   `tcgcsv_singles`. El smoke money-safe per-acabado (`test/price-ingest.singles.spec.ts`: 3 acabados con
   markets distintos ⇒ 3 upserts keyed por cardProductId; sin market ⇒ omitido, nunca el de otro acabado)
   sigue verde. Corregido 1 test money-safe (`pricing.manual-override-durable-cross-day.spec.ts`): se
   eliminó la aserción sobre `info.isManualOverride` porque v2 RETIRA ese campo del DTO `PriceInfo`
   (§4.36.7); el invariante (override humano gana cross-day) queda cubierto por `source === 'manual'`.
6. `.env.example` (devops): auto-mergeó por unión sin conflicto; `POKEMONPRICETRACKER_FETCH_PRINTINGS=false`
   y la doc de `tcgcsv_singles` como PRIMARIO intactos. Ver nota para devops abajo.

### Validación pre-commit
- `npx tsc --noEmit`: limpio (tras `npx prisma generate`, necesario porque el schema mergeado trae campos
  nuevos de v2: `MarketBracket`, `PendingPriceEntry.reason`, `OrderItem/SellRequestItem.marketBracket/
  marketMxnCents/priceBasis`).
- `npx prisma validate`: schema válido. Migración **M-41** (`20260824120000_m41_pricing_curve_instrumentation`)
  en orden tras **M-40** (`20260823130000_m40_pending_sealed_product`).
- Suite unitaria (`npx jest`): **191 suites / 2139 tests, todo verde**. Incluye smoke per-acabado
  tcgcsv_singles y los specs de la curva v2 (`pricing-curve.spec.ts`, `money.pricing-curve.spec.ts`,
  `pricing.curve-*.spec.ts`).

### Docs ajenos tocados en el merge (SIN autoría; para sus dueños)
- **ARCHITECTURE.md / API_CONTRACT.md (arquitecto):** changelog resuelto con **ours** (v1.49/§4.36; los
  changelogs internos v2.x se re-anclan como notas del pase de curva, §4.36e). Preservé por **UNIÓN** el
  contenido §M2 de v2 que main no tenía: en ARCHITECTURE, las desviaciones **D1-TECHO, D2-EMISOR, D4-ENUMS y
  P-48-RC** (junto a la de main MERGE-P47xCURVA); en API_CONTRACT, el bullet de `GET /admin/settings` sobre
  `salesMarkupPct` retirado + los diales de curva en `PUT /admin/pricing/curve` (conservando la línea de main
  con el enum `priceProvider` de 3 valores, no la de v2 con 2). El resto del §M2/curva (§4.36.3, §4.37,
  editor de curva) auto-mergeó limpio. **Recomiendo al arquitecto revisar la coherencia de numeración v2.x↔v1.49.**
- **DEVOPS_NOTES.md / FRONTEND_NOTES.md (devops/frontend):** resueltos por **UNIÓN** (se conservan ambos
  lados). **Nota para devops:** en `.env.example` línea ~65 un comentario aún lista solo
  `pokemonpricetracker | pokemontcg_io` para `PRICE_PROVIDER`; la doc canónica del mismo archivo (líneas
  ~288-295) ya incluye `tcgcsv_singles` como PRIMARIO. Menor, es tu archivo; lo dejo señalado sin tocar.

### Escaladas
Ninguna. La curva NO asumió un shape de entrada que la referencia P-47 no provea: recibe `marketMxnCents`
escalar y lo lee per-acabado, exactamente lo que `ingestSinglesForSet` produce (§4.36a/c). No hubo
incompatibilidad que requiriera regla 9.

# DECKS-META Fase 2 — Auto-fetch semanal desde Limitless TCG

> **Estado:** ESPECIFICACIÓN (arquitecto). No hay código de feature ni migración en este commit.
> **Rama:** `claude/arch-decksmeta-f2-spec` (rama base `origin/production` @ `d3c03c69`).
> **Alcance:** define el traído AUTOMÁTICO semanal de los decks meta. Fase 1 (pull MANUAL) YA está
> en producción y **no cambia**: este diseño es ADITIVO y reusa el parser, el matcher, la compuerta de
> legalidad y los modelos ya mergeados.
> **Requisito duro del dueño (2026-09-19):** *«quiero que se mapee las 60 cartas»* — el auto-fetch
> debe mapear **las ~60 cartas de cada deck**, no solo las cartas núcleo (`core-card`).

---

## 0. Resumen ejecutivo (qué decide esta especificación)

1. **La fuente de las 60 cartas es la página de lista completa** `/decks/list/<id>` (selector
   `.decklist-card[data-set][data-number]`), **no** la página de arquetipo `/decks/<id>` (que solo
   trae ~18 `core-card`). La home nos da, por bloque `.leader`, el `archetypeId`, el nombre, el rank,
   el share **y** el `listId` representativo — todo verificado contra el fixture.
2. **Flujo:** `home-index` → extraer N bloques `.leader` → por cada uno, fetch de su
   `/decks/list/<listId>` → parsear las 60 cartas → matchear con el matcher de Fase 1 →
   persistir una `MetaDeckList` **nueva e inmutable** que supersede a la anterior.
3. **Egress:** el sandbox BLOQUEA `limitlesstcg.com` (403). El adapter se CONSTRUYE y se PRUEBA en
   unitarios contra los fixtures capturados; el fetch real **solo corre en prod**. Por eso el diseño
   obliga a un **DRY-RUN CANARY en prod** que trae + parsea + reporta counts **sin publicar**, para
   validar el parser contra la realidad antes de encender el modo vivo.
4. **Gate duro de publicación (canary):** si no se cumplen los umbrales (nº de arquetipos, ~60 cartas
   por deck sumadas por cantidad, piso de ratio de match), **NO se publica**: se conserva lo último
   bueno, se registra `MetaFetchRun{applied:false}` y se alerta al operador.
5. **Scheduler:** se reusa BullMQ (ya en el repo, cola `tcg-daily`) con un job repetible **semanal**
   `decks-meta-refresh` + endpoint de disparo manual admin. Idempotencia y locking por `jobId`.

### ⚠️ Supuestos que el DRY-RUN de prod DEBE confirmar (no medibles offline)

| # | Supuesto | Por qué no lo pude medir | Cómo lo cierra el dry-run |
|---|----------|--------------------------|---------------------------|
| A1 | La estructura de `/decks/list/<id>` es `.decklist-card[data-set][data-number][data-lang]` con `.card-count` y `.card-name`, columnas «Pokémon (N) / Trainer (N) / Energy (N)», energías básicas con `data-basic-energy`. | **No tengo fixture capturado** de esa página; es estructura *documentada*, no verificada. | El dry-run trae páginas reales y reporta cartas parseadas por deck y suma-por-cantidad. Si el parser saca 0 o < ~55, los selectores están mal y NO se publica. |
| A2 | La home «Top Decks» entrega **≥ 8** arquetipos. | El fixture `home-index.html` muestra **solo 6** bloques `.leader` (verificado). | El dry-run reporta cuántos `.leader` trae la home viva. Si son < 8, o se baja el umbral a 6, o se añade la página de ranking completo `/decks?format=<code>` como fuente (su fila NO está capturada → A3). |
| A3 | La página de ranking completo `/decks?format=<code>` (para superar los 6 de la home) tiene filas con `archetypeId`, nombre, share y un `listId` representativo. | No tengo fixture; es un plan de contingencia para A2. | Solo se activa si A2 falla; el dry-run mediría su estructura antes de codificar el segundo parser. |
| A4 | El `listId` de `a.leader-decklist` es una lista de **60 cartas del formato vigente** (no un recorte). | El texto del fixture dice «4th Place World Championships 2026», i.e. una lista de torneo real ⇒ debería ser 60. Pero es un dato de un solo bloque. | El dry-run valida la regla de suma-por-cantidad ≈ 60 en TODOS los decks, no solo uno. |

Estos cuatro supuestos son la deuda honesta de esta fase: nacen de que **no hay fixture de
`/decks/list/`**. El diseño está construido para que el dry-run los mida antes de encender nada.

---

## 1. Flujo de fetch

```
[1] GET /                         (home-index)          1 request
      └─ extraer <h2>Top Decks (CODE)</h2>  → formatCode "TEF-PBL"
      └─ extraer bloques .leader   → [{archetypeId, name, rank, sharePct, listId}]  (N bloques)
[2] GET /decks?format=CODE        (formatLabel canónico) 1 request   (opcional; ver §3)
[3] por cada arquetipo (SECUENCIAL, con delay):
      GET /decks/list/<listId>    (lista completa 60)   N requests
      └─ parsear .decklist-card    → líneas crudas
      └─ matchear (Fase 1)         → matched/unmatched
[4] validar CANARY (§5)           (en memoria)          0 requests
[5] si pasa Y no es dry-run: persistir MetaDeckList nueva + supersede (§4)
    si NO pasa:               conservar último-bueno + MetaFetchRun{applied:false} + alerta
```

### Parámetros pineados

| Parámetro | Valor | Razón |
|-----------|-------|-------|
| **N (top-how-many)** | `META_FETCH_TOP_N` = **10** (default), tope duro 12 | El dueño quiere top-10. La home del fixture solo da 6 (supuesto A2); si la fuente no llega a N, se usan los que haya y el canary decide. |
| **Orden** | **Secuencial**, un `/decks/list/` a la vez | Cortesía con un sitio de terceros sin API pública; nada de fan-out paralelo. |
| **Delay entre requests** | `META_FETCH_DELAY_MS` = **1500 ms** | Rate-limit educado. ~1 req cada 1.5 s. |
| **Timeout por request** | `META_FETCH_TIMEOUT_MS` = **10000 ms** (`AbortController`) | Igual patrón que `pokemontcg-io.client` (fetch nativo). Una página lenta no cuelga el job. |
| **Reintentos por request** | **2** (3 intentos totales), backoff 2 s → 5 s; respeta `Retry-After` si viene | Igual criterio que el cliente pokemontcg.io existente (maneja `retry-after`). |
| **Presupuesto total de requests** | **1 (home) + 1 (formato, opcional) + N (listas) ≤ 12** por corrida | Cota dura. Un fetch nunca hace > 12 GETs. Si N crece, la cota se recalcula pero se registra. |
| **Presupuesto total de tiempo** | ~30–45 s típico (12 × (delay+fetch)) | Muy por debajo del stall del worker; el job es ligero. |
| **Tamaño máx. por respuesta** | `META_FETCH_MAX_BYTES` = **3 MB** | Cap de seguridad (§9). Una respuesta mayor se aborta y cuenta como fallo del deck. |

El **origen del contenido no es configurable por usuario**: host FIJO `https://limitlesstcg.com`
(allowlist de un solo host, §9). El único parámetro externo es `formatCode`, y se **lee de la propia
home** (no se acepta de entrada de usuario).

---

## 2. Tablas de selectores exactos

### 2.1 Home index (`GET /`) — VERIFICADO contra `home-index.html`

| Dato | Selector | Extracción | Ejemplo (fixture) |
|------|----------|-----------|-------------------|
| Código de formato | `section > h2` cuyo texto empieza por `Top Decks (` | regex `Top Decks \(([A-Z-]+)\)` | `TEF-PBL` |
| Bloque de arquetipo | `div.top-leaders > div.leader` (repetido) | iterar | 6 bloques en el fixture |
| `archetypeId` | dentro del bloque, `a.leader-details[href^="/decks/"]` (o `a.leader-image`) | regex `^/decks/(\d+)$` sobre `href` | `284`, `339`, `350`, `320`, `322`, `376` |
| Rank + nombre | `a.leader-details div.text-lg.font-bold` | texto `"1. Dragapult"` → regex `^(\d+)\.\s*(.+)$` → rank=`1`, name=`Dragapult` | `1. Dragapult` |
| Share % | `a.leader-details > div` siguiente al de nombre (el que contiene `%`) | parseFloat sin `%` | `36.11` |
| **`listId` representativo** | `a.leader-decklist[href^="/decks/list/"]` | regex `^/decks/list/(\d+)$` sobre `href` | `28760`, `28874`, `28757`, `28800`, `28949`, `28895` |
| Descripción de la lista | `a.leader-decklist > div` (el último, sin `.text-sm`) | texto → `sourceTournament` | `4th Place World Championships 2026 - Michael R.` |
| Enlace ranking completo | `a.button.text-button[href^="/decks?format="]` | regex `format=([A-Z-]+)` (respaldo de `formatCode`) | `/decks?format=TEF-PBL` |

> Nota: el `<h2>` del fixture es `Top Decks (TEF-PBL)`; el enlace de «Complete deck ranking» apunta a
> `/decks?format=TEF-PBL`. Las dos fuentes del código de formato deben coincidir; si difieren, gana el
> `<h2>` y se loggea la discrepancia.

### 2.2 Página de arquetipo (`GET /decks/<id>`) — VERIFICADO contra `archetype-284.html`

**Solo se usa para metadata opcional, NUNCA para las 60 cartas.**

| Dato | Selector | Nota |
|------|----------|------|
| Nombre del arquetipo | `h1.name` | `Dragapult` (respaldo del nombre de la home) |
| Cartas núcleo | `div.deck-core > div.core-card` con `img.card[data-set][data-number]` | **~18 en el fixture** → insuficiente para las 60. Se ignora en el flujo principal. |

> ⛔ **Decisión:** el flujo NO usa `core-card` para construir la lista. `core-card` demostraría
> exactamente el bug que el dueño rechaza (mapear solo el núcleo). Se documenta aquí para dejar por
> escrito *por qué* no se usa.

### 2.3 Página de lista completa (`GET /decks/list/<id>`) — DOCUMENTADO, **sin fixture** (supuesto A1)

| Dato | Selector (documentado) | Extracción → línea cruda |
|------|------------------------|---------------------------|
| Carta (línea) | `.decklist-card[data-set][data-number][data-lang]` (repetido) | una `ParsedLine` por elemento |
| Cantidad | `.decklist-card span.card-count` | `Number(text)` → `quantity` |
| Nombre | `.decklist-card span.card-name` | `text.trim()` → `name` (solo display; el match NO usa el nombre) |
| Set code | atributo `data-set` | → `setCode` (es el `ptcgoCode`) |
| Número | atributo `data-number` | → `number` (admite prefijo/sufijo alfabético, ya modelado) |
| Sección/grupo | encabezado de columna `Pokémon (19)` / `Trainer (32)` / `Energy (9)` | fija `group` de las cartas que le siguen (mismo criterio que el parser de texto) |
| **Energía básica** | `.decklist-card[data-basic-energy="N"]` (o sin `data-set`/`data-number`) | `setCode=null`, `number=null`, `isBasicEnergy=true`, `group='energy'` |

**Handling de energía básica (crítico para «las 60»):** una energía básica **no tiene set/número**;
el matcher de Fase 1 ya la resuelve a `matchStatus='unmatched_basic_energy'` (siempre legal, se marca,
no se inventa). Esto **cuenta para el total de 60** (por su `quantity`) aunque no case a una `Card`.
Es decir: «mapear las 60» = **parsear y persistir las 60 líneas por su cantidad**, con su
`matchStatus`; no significa que las 60 casen a una `Card` de nuestro catálogo (las básicas y las
rotadas no casarán, y eso es correcto). El canary mide **cartas-por-cantidad ≈ 60**, no
matched=60.

**Reutilización del parser de Fase 1:** el parser de texto (`deck-list.parser.ts`) NO sirve tal cual
porque la fuente es **HTML con atributos**, no el export de texto de TCG-Live. Se añade una función
**pura** nueva `parseDeckListHtml(html): ParseResult` que emite la MISMA `ParsedLine[]` (mismo
contrato) y luego alimenta el **mismo** `DeckMatcherService.matchLines()` sin cambios. Así el matcher,
la legalidad y el modelo de datos se reusan intactos.

> **Elección de parser HTML (§9 seguridad):** el repo **no tiene** ninguna librería de parseo HTML
> (`grep` de `cheerio`/`jsdom`/`node-html-parser`/`parse5` = 0 hits; el HTTP es `fetch` nativo, sin
> `axios`). Se recomienda **añadir `cheerio`** (parser tree-based, sin `eval`, sin ejecución de
> scripts, sin red), **fijado por versión + integridad** (regla de dependencias del proyecto:
> «toda dependencia externa va fijada»). Alternativa sin dep nueva: extracción por regex acotada a los
> atributos `data-*` (más frágil ante cambios de markup). **Recomendación: cheerio pineado**; la
> decisión final la ratifica techlead y la revisa SEGURIDAD (§10).

---

## 3. Código de formato → `formatLabel` + `activeMarksSnapshot`

- **`formatCode`** («TEF-PBL») se extrae del `<h2>Top Decks (TEF-PBL)</h2>` de la home (respaldo:
  el `href` de «Complete deck ranking»). Es el **candado de versión de formato** que pide
  `MetaFetchRun.formatVersion` («versión FIJADA del formato Limitless»).
- **`formatLabel`** (campo `MetaDeckList.formatLabel`, string legible): se compone como
  `"Standard <formatCode>"` (p. ej. `"Standard TEF-PBL"`). Fase 1 usa `"Standard"` a secas por
  defecto; Fase 2 lo enriquece con el código vigente. El label es **informativo** (procedencia), no
  gobierna legalidad.
- **`activeMarksSnapshot`** (campo `MetaDeckList.activeMarksSnapshot`, JSON): se toma **de NUESTRA
  configuración de legalidad**, exactamente como en Fase 1
  (`cfg.activeMarks` leído de `ConfigSetting['standard.active_regulation_marks']` vía
  `loadLegalityConfig()`), **no** de Limitless. Es la foto de la ventana de marcas vigente **al
  capturar** — procedencia, no fuente de verdad. La legalidad se sigue DERIVANDO en lectura con
  `isLegalStandardNow()`; el snapshot solo registra qué ventana regía cuando se trajo la lista.

> **Por qué el snapshot es nuestro y no de Limitless:** la regla dura del proyecto es que la legalidad
> es DERIVADA de nuestros hechos crudos (`regulationMark`) + nuestra ventana (`ConfigSetting`).
> El `formatCode` de Limitless entra como **procedencia/versión** (`formatVersion`), nunca como
> autoridad de qué es legal. Esto conserva el mecanismo de rotación de Fase 1 intacto.

---

## 4. Mapeo a los modelos existentes (sin cambios de esquema para el camino feliz)

Por cada arquetipo que pasa el canary, dentro de **una `$transaction`** (idéntico patrón a
`adminCreateOrCurate` de Fase 1):

1. **`MetaDeck`** — upsert por `slug` (slug derivado del nombre; determinista).
   - `source = MetaDeckSource.limitless` (¡no `manual`!).
   - `sourceRef = "/decks/<archetypeId>"` (id/url del arquetipo en Limitless).
   - `rank`, `sharePct` de la home. `trend` = `sharePct` actual − `sharePct` del deck anterior (si
     existía), como ya modela el campo.
   - `published`: **no se toca en auto-fetch** si el operador ya lo fijó; ver §6.
   - `pausedByOperator`: **respetado** — si `true`, el deck se salta (§6).
2. **`MetaDeckList`** (INMUTABLE, nueva por refresh):
   - `formatLabel` (§3), `activeMarksSnapshot` (§3), `fetchedAt = now()`.
   - `sourceUrl = "https://limitlesstcg.com/decks/list/<listId>"`.
   - `sourceTournament` = descripción de `a.leader-decklist` (p. ej. «4th Place World Championships 2026 - Michael R.»).
   - `cards`: **una `MetaDeckCard` por línea parseada** (las ~60), con:
     - `rawName`, `rawSetCode`, `rawNumber`, `quantity`, `group` (del parser/matcher),
     - `matchStatus` (matched / ambiguous / unmatched_set / unmatched_number / unmatched_basic_energy),
     - `matchedCardId` (o `null`).
3. **Supersede:** si el deck ya tenía `currentListId` y es distinto, se marca la lista anterior
   `supersededById = <nueva>` y se re-apunta `MetaDeck.currentListId = <nueva>`. **Nunca se edita ni
   se borra la lista vieja** (inmutabilidad). El último-bueno vive como lista superseded.
4. **`MetaFetchRun`** (provenance + canary):
   - `source = limitless`, `formatVersion = <formatCode>`, `deckCount = <arquetipos aplicados>`,
   - `applied = true`,
   - `note` = JSON compacto con procedencia: `{urlsFetched, perDeckCounts, matchedRatio,
     unmatchedByStatus, canaryVerdict, startedAt, finishedAt}`.

### 4.b Campos que el esquema de Fase 1 NO tiene y que Fase 2 querría

`MetaFetchRun` de Fase 1 es un placeholder mínimo (`runAt, source, formatVersion, deckCount, applied,
note`). Fase 2 necesita registrar por corrida: URLs traídas, counts por deck, ratio de match, error
textual y el veredicto del canary. **Camino feliz: se serializan dentro de `note` (JSON string)**, sin
DDL. **Opcional (mejora, requiere migración y ratificación del arquitecto, §10):** columnas dedicadas
`startedAt`, `finishedAt`, `errorText`, `canaryJson`, `dryRun Boolean`. La recomendación es **empezar
con `note` JSON (cero DDL)** y promover a columnas solo si el reporte de operación lo pide. Si se
añaden columnas, es un **cambio de zona compartida (`prisma/schema`)** → pasa por arquitecto (regla 9)
y actualiza la paridad de enums/contrato.

---

## 5. CANARY de validación (gate DURO antes de publicar)

El canary corre **en memoria**, después de traer+parsear+matchear TODO, **antes** de cualquier
escritura de datos publicados. Si **cualquier** umbral falla, el resultado es **NO-PUBLISH**.

| # | Umbral | Valor | Razón |
|---|--------|-------|-------|
| C1 | Arquetipos con lista parseada OK | **≥ `META_CANARY_MIN_DECKS`** (default **6**; objetivo 8) | El fixture de la home da **6** (medido). Poner el default en 6 evita un falso rojo garantizado; el objetivo de 8 se sube **cuando el dry-run confirme** que la fuente entrega ≥8 (supuesto A2). Umbral configurable por env. |
| C2 | Cartas por deck (suma de `quantity`) | **55 ≤ Σqty ≤ 61** por deck | Un deck estándar es 60. La banda 55–61 absorbe listas con líneas raras/errores menores de parseo sin dejar pasar un deck a medio parsear (p. ej. solo core = ~30). **Este es el umbral que hace cumplir «las 60».** |
| C3 | Ratio de match global | **matched / total ≥ `META_CANARY_MATCH_FLOOR`** (default **0.80**) | Las básicas (`unmatched_basic_energy`) y alguna rotada NO casan legítimamente; ~9 energías + margen ⇒ un piso del 80 % detecta un catálogo desincronizado o `ptcgoCode` roto sin castigar las básicas esperadas. |
| C4 | Ratio de `unmatched_set` | **≤ 10 %** de las líneas | Muchos `unmatched_set` = el mapeo de `ptcgoCode` cambió o el set-code de Limitless dejó de coincidir → señal de que el parser/catálogo necesita curaduría, no de publicar. |
| C5 | Home parseable | ≥ C1 bloques `.leader` con `listId` no nulo | Si la home cambió de markup, C5 falla temprano y no se hace ni un fetch de lista. |

**En fallo de canary:**
1. **NO** se escribe ninguna `MetaDeckList` nueva ni se re-apunta `currentListId`.
2. Se **conservan las listas publicadas último-bueno** (siguen siendo `currentList`).
3. Se registra `MetaFetchRun{source:limitless, applied:false, note:<canaryVerdict+contadores>}`.
4. Se **alerta al operador** (canal de alertas existente / log de error visible; ver §6).
5. El job termina **sin lanzar excepción no controlada** (para no dejar la cola en estado sucio).

**Umbrales configurables por env** (`META_CANARY_MIN_DECKS`, `META_CANARY_MATCH_FLOOR`,
`META_CANARY_CARDS_MIN`, `META_CANARY_CARDS_MAX`) para que devops los afine tras el primer dry-run
real sin redeploy de código.

---

## 6. Fallback + controles del operador

- **`pausedByOperator` se respeta:** un deck con `pausedByOperator=true` se **salta** en el auto-fetch
  (no se le crea lista nueva ni se toca su `currentList`). Es el freno del operador sin borrar.
- **Pull manual (Fase 1) sigue vivo e intacto:** `POST /admin/decks-meta` (`source=manual`) y toda la
  curaduría siguen funcionando. Un deck curado a mano (`source=manual`) **no** es pisado por el
  auto-fetch salvo que compartan `slug`; para evitar colisiones, el auto-fetch **no publica**
  automáticamente sobre un `slug` cuyo `MetaDeck.source=manual` — lo registra como conflicto en el
  `MetaFetchRun.note` y lo deja al operador (regla: manual gana sobre auto en caso de colisión de
  slug). *(Este punto conviene confirmarlo con el dueño; ver hand-back.)*
- **Último-bueno retenido:** por inmutabilidad, la lista previa nunca se borra; en fallo de canary o
  de fetch de un deck concreto, ese deck conserva su `currentList` anterior.
- **Publicación:** el auto-fetch crea/actualiza la LISTA, pero **no fuerza `published=true`**. El
  operador decide qué se publica (igual que Fase 1). Alternativa a confirmar con el dueño:
  auto-publicar solo los decks que YA estaban publicados y pasaron canary. Por defecto,
  **conservador: no cambia `published`**.
- **Alerta al operador:** en fallo de canary o de fetch, log `error` visible + (si existe canal de
  notificación admin) un aviso. No hay throttle de dinero involucrado, así que basta con visibilidad
  operativa.

---

## 7. Job semanal (scheduler)

**Se REUSA BullMQ** (ya en `package.json`: `bullmq@^5.81.3`; cola `tcg-daily` en
`backend/src/jobs/scheduler.service.ts`). **No se añade `@nestjs/schedule`** (no está en el repo).

- **Job repetible:** `decks-meta-refresh`, cadencia **semanal**.
  - Cron propuesto: **`0 9 * * 1`** (lunes 09:00 UTC = 03:00 CDMX; después de que los resultados de
    torneos del fin de semana estén cargados). Configurable por env `DECKS_META_REFRESH_CRON`.
  - Registro con el helper `repeat()` existente (`{ repeat:{pattern}, jobId:'decks-meta-refresh-weekly',
    removeOnComplete:true, removeOnFail:100 }`). El sufijo se ajusta (`-weekly`, no `-daily`).
- **Handler:** un `case 'decks-meta-refresh':` nuevo en el `switch (job.name)` del `Worker` de
  `scheduler.service.ts`, que delega en un servicio nuevo `DecksMetaRefreshService.run({dryRun})`
  dentro del módulo `decks-meta`.
- **Disparo manual:** `POST /admin/jobs/decks-meta-refresh` (rol `vault_operator`+, patrón idéntico a
  `POST /admin/jobs/catalog-price-sync`). Acepta `{ dryRun?: boolean }`.
- **Idempotencia / locking:**
  - `jobId` fijo por corrida programada dedup en BullMQ (misma técnica que los jobs diarios).
  - Lock aplicativo: la corrida toma un lock corto (p. ej. `ConfigSetting` `decks-meta.refresh.lock`
    con timestamp, o el lock nativo de BullMQ por `jobId`) para que un disparo manual no se solape con
    el semanal. Si hay lock vivo, el segundo se rechaza con mensaje claro.
  - Toda escritura es transaccional y supersede-based ⇒ **re-ejecutar es seguro** (crea una lista
    nueva; nunca corrompe la anterior).
- **Degradación:** igual que el resto del scheduler, si falta `REDIS_URL` el job no se programa pero el
  **disparo manual admin sigue disponible**. El auto-fetch NUNCA bloquea el arranque HTTP.

---

## 8. Modo DRY-RUN / preview (camino de verificación en prod)

Es el mecanismo que compensa la falta de fixture de `/decks/list/` y el bloqueo de egress del sandbox.

- **Invocación:** `POST /admin/jobs/decks-meta-refresh { "dryRun": true }` (rol `vault_operator`+),
  y/o `GET /admin/decks-meta/preview` que corre el mismo pipeline y devuelve el reporte inline.
- **Qué hace:** ejecuta **todo** el pipeline real en prod — home → N listas → parseo → match →
  legalidad → **canary** — **PERO NO ESCRIBE datos publicados**: no crea `MetaDeckList`, no toca
  `currentListId`, no cambia `published`.
- **Qué reporta** (JSON, para el dueño/orquestador):
  - `formatCode` detectado y `formatLabel` compuesto.
  - Por arquetipo: `archetypeId`, `name`, `rank`, `sharePct`, `listId`, **cartas parseadas**,
    **Σ cantidad** (¿≈60?), **matched / total**, desglose por `matchStatus`, cuántas caen por
    legalidad.
  - Veredicto del canary (C1–C5) con el valor medido vs. el umbral, y **PUBLICARÍA / NO-PUBLICARÍA**.
  - `urlsFetched`, tiempos, errores por deck.
- **Persistencia opcional del dry-run:** puede registrar un `MetaFetchRun{applied:false, note:"dry-run
  ..."}` para dejar traza sin publicar (o, con la columna opcional `dryRun`, marcarlo explícito).
- **Flujo de encendido seguro:**
  1. Deploy del adapter (probado offline contra fixtures) con el modo vivo **apagado** (dial
     `decks_meta_autofetch` = `off`, seed conservador, igual patrón que `sealed_price_source`).
  2. Operador corre **dry-run en prod** → dueño y orquestador revisan el reporte (¿60 cartas? ¿≥N
     arquetipos? ¿ratio de match sano?).
  3. Solo si el reporte es sano se **flipa el dial a `on`** y el job semanal empieza a publicar.
- **Dial fail-closed:** con el dial en `off`, el job semanal corre en modo dry-run (o no-op logueado)
  y **nunca** publica. Encender es una acción de operación deliberada, no el estado por defecto.

---

## 9. Superficie de seguridad (traer + parsear HTML de terceros)

| Riesgo | Mitigación pineada |
|--------|--------------------|
| **SSRF** | **Allowlist de UN host fijo** `https://limitlesstcg.com`. La URL se construye SOLO desde constantes + IDs numéricos extraídos por regex `^\d+$` (archetypeId, listId). **Cero** parte de la URL viene de entrada de usuario. `formatCode` se valida contra `^[A-Z]{2,4}(-[A-Z]{2,4})?$` antes de usarse. Se rechazan redirects a otros hosts (no seguir `Location` fuera del allowlist). |
| **IDs no numéricos / inyección en URL** | Los IDs se castean y validan `^\d+$`; cualquier otro valor se descarta (no se hace el fetch). |
| **Parseo de HTML no confiable** | **cheerio** (recomendado): parser tree-based, **no ejecuta scripts, no hace red, no `eval`**. Prohibido `jsdom` con scripts activos y prohibido `eval`/`Function` sobre contenido traído. Si se opta por regex, se acota a extraer atributos `data-*` y texto, nunca a evaluar. |
| **Tamaño de respuesta (DoS de memoria)** | Cap `META_FETCH_MAX_BYTES` = 3 MB por respuesta; se aborta la lectura al superarlo. |
| **Timeouts / cuelgues** | `AbortController` a 10 s por request (§1). Presupuesto total acotado (§1). |
| **Contenido malicioso persistido** | Solo se persisten campos tipados: `quantity` (Int), `rawName`/`rawSetCode`/`rawNumber` (strings acotados por longitud como en Fase 1 DTO, `@MaxLength`), `matchStatus` (enum). El HTML crudo **no** se guarda. `rawName` es display-only y se escapa en el frontend (ya se hace en Fase 1). |
| **XSS vía `rawName`** | Ya cubierto por Fase 1 (el front trata `rawName` como texto, no HTML). No se introduce HTML nuevo en la BD. |
| **Envenenamiento de datos (deck falso)** | El canary (§5) es la defensa: un deck manipulado que rompa la suma-60 o el ratio de match dispara NO-PUBLISH. Además `matchedCardId` solo apunta a `Card` de NUESTRO catálogo; jamás se inventa carta ni precio (regla dura Fase 1). |
| **Secreto / credenciales** | Ninguna: Limitless no requiere auth para estas páginas públicas. No hay secretos que enmascarar. |
| **Rate-limit / bloqueo del tercero** | Secuencial + delay 1.5 s + User-Agent identificable. Un 429/403 respeta `Retry-After` y, si persiste, aborta con canary-fail (no reintenta agresivo). |

**Lo que SEGURIDAD debe revisar explícitamente (blue team):**
1. La construcción de URLs y la allowlist de host (no-SSRF) — el punto más sensible.
2. La elección y versión pineada del parser HTML (cheerio) y su configuración sin ejecución de scripts.
3. El cap de bytes y los timeouts (DoS defensivo).
4. Que `note`/`canaryJson` no filtre HTML crudo ni datos sensibles a logs.
5. Que el dial fail-closed (`decks_meta_autofetch=off`) realmente impida publicar.

---

## 10. Plan de GATES para el PR de construcción (proporcionado)

**Clasificación:** esto **NO es zona de dinero** (`orders/payments/pricing/buylist/inventory/vault`).
Es **datos de catálogo/meta**. PERO tiene dos agravantes: **(a) fetch de un tercero no confiable** y
**(b) toca zona compartida `prisma/schema`** SOLO si se adoptan las columnas opcionales de §4.b.

| Gate | ¿Obligatorio? | Justificación |
|------|---------------|---------------|
| **QA** | **SÍ** | Unitarios del parser HTML contra los fixtures capturados (`home-index`, `archetype-284`) + un fixture sintético de `/decks/list/` construido según §2.3; tests del canary (cada umbral C1–C5 con su caso que DEBE fallar); test de que `pausedByOperator` se respeta; test de idempotencia/supersede. Smoke E2E del endpoint admin de dry-run. |
| **techlead** | **SÍ** | Mantenibilidad del adapter, reuso correcto del matcher/legalidad de Fase 1, elección de cheerio, calidad del manejo de errores del job. |
| **arquitecto (ratifica)** | **SÍ, si cambia el esquema** | Solo si se adoptan las columnas opcionales de `MetaFetchRun` (§4.b). El camino feliz (note JSON) **no** toca esquema ⇒ no requiere ratificación de esquema, pero sí que el arquitecto confirme que el contrato (`API_CONTRACT.md`) documenta los endpoints nuevos (dry-run, manual trigger). |
| **SEGURIDAD (revisa superficie de fetch/parse)** | **SÍ** | Es la razón de más peso: fetch de HTML de terceros + parseo. Revisa los 5 puntos de §9. No hace falta la fase completa de pentest de release por-cambio, pero SÍ una revisión dirigida de la superficie de egress/parseo en el PR. |
| **pentester (red team)** | En el gate de **release**, no por-cambio | Cadencia normal del proyecto: la fase de seguridad completa corre por release. |

**Recomendación de gate para el PR:** **QA + techlead obligatorios**; **SEGURIDAD revisa la superficie
fetch/parse** (dirigido, no full pentest); **arquitecto ratifica solo si hay DDL**. Es proporcionado:
más que un cambio de pantalla sin dinero (por el egress a terceros), menos que un cambio en zona de
dinero (no toca `orders/payments/pricing`).

---

## 11. i18n (paridad es/en, §32.6)

Strings nuevos de cara al operador que requieren **paridad es/en**:
- Estados/mensajes del reporte de dry-run y del disparo manual (p. ej. «Publicaría» / «Would publish»,
  «No publicaría — canary falló» / «Would not publish — canary failed»).
- Mensajes de alerta al operador en fallo de canary/fetch.
- Etiquetas del panel admin si se expone el reporte de dry-run en UI (frontend).
- Nombres/tooltips de los nuevos controles admin (disparo manual, dry-run).

Todo string de UI va en `frontend/messages/{es,en}.json` con clave en ambos idiomas (lo verifica el
control de paridad existente). Los strings de log/servidor no requieren i18n, pero los de respuesta de
API que el frontend muestre, sí.

---

## 12. Endurecimiento post-gates (fix pass) — decisiones de operación y seguridad

Consolidado tras QA/techlead/seguridad (tres veredictos aprobados, sin bloqueantes). Registra las
desviaciones deliberadas respecto a esta spec y los residuales aceptados. Rama `claude/be-decksmeta-f2`.

**(a) Disparo manual endurecido a `super_admin` (desviación de «`vault_operator`+» de §7/§8).**
`POST /admin/jobs/decks-meta-refresh` vive bajo `AdminJobsController`, que es **`@Roles(super_admin)`**
para TODA la familia de disparos de jobs. Se dejó ahí a propósito (decisión del orquestador, más
seguro): el disparo del refresh comparte la superficie de ops con los demás jobs. **La vía del
operador (`vault_operator`+) es el preview de solo-lectura en dry-run**: `GET /admin/decks-meta/preview`
(bajo `AdminDecksMetaController`, `@Roles(vault_operator, super_admin)`), que corre el pipeline real
sin escribir nada publicado. Así el operador verifica sin poder disparar una publicación.

**(b) Single-flight en memoria, suficiente a `numReplicas:1`.** El candado contra corridas solapadas
(worker BullMQ + disparo HTTP admin) es un **flag en memoria** reclamado síncronamente antes del primer
`await` (`DecksMetaRefreshService.running`). Es correcto **porque el worker BullMQ corre in-process y
`railway.json` fija `numReplicas:1`** (ver `DEVOPS_NOTES §20.3`: 1 réplica mientras el worker viva en
el mismo proceso HTTP). Un **lock de advisory en BD para multi-instancia queda DIFERIDO**, gateado
detrás de separar el worker a su propio proceso/deploy (§20.3). Mientras haya 1 réplica, un lock de BD
sería complejidad sin beneficio medible.

**(c) DNS-rebinding: residual ACEPTADO.** El host es **fijo** (`https://limitlesstcg.com`, no viene de
entrada de usuario) y la validación anti-SSRF es sobre el `origin` de un host constante. Un rebinding
apuntaría el nombre fijo a otra IP, pero no cambia que el destino sea el mismo nombre de un tercero
público sin secretos ni red interna alcanzable. No se añade pin de IP (frágil y sin beneficio real aquí).

**Nota anti-SSRF (refuerzo sobre §9):** los redirects ya **no se siguen a ciegas**. El cliente usa
`redirect:'manual'`: ante un 3xx lee `Location`, lo resuelve contra la URL actual y valida que su
`origin` sea el allowlist **ANTES** de seguirlo; un `Location` off-host se **rechaza sin traerlo**
(jamás se hace `fetch` de una URL no validada), con cota dura de saltos. Antes se validaba `res.url`
*después* de que `fetch` ya hubiera seguido el redirect (hueco de blind-SSRF). Cubierto por
`limitless-fetch.client.spec.ts`.

**(d) `nth-check@2.1.1` — versión PARCHEADA.** El aviso de ReDoS de `nth-check` afecta a `<2.0.1`; la
transitiva (vía `cheerio`) es **2.1.1**, ya parcheada. Además los selectores CSS usados son **estáticos**
(literales en el código, no derivados de la entrada del tercero) ⇒ la ruta vulnerable **no es
alcanzable** aunque la versión fuera vieja.

**Notas de corrección incluidas en este fix pass:** `MetaFetchRun.deckCount` = arquetipos
**efectivamente persistidos** este run (no `publishedSlugs + supersededListIds`, que subcontaba los
decks nuevos sin publicar y doblaba el publicado que además supersedió); `note` se serializa acotando
las **entradas** antes de `JSON.stringify` y, si aun así excede el cap, guarda un **marcador truncado
válido** (nunca una cadena JSON cortada a mitad); `GET /admin/decks-meta/preview` ahora **audita**
(`jobs.decks_meta_preview.run`) porque dispara egress real a un tercero; el parser **loguea la
discrepancia** de `formatCode` entre el `<h2>` (fuente de verdad, §2.1) y el href de respaldo.

---

## Apéndice — Hechos medidos (ground truth de esta especificación)

- **Fixtures leídos:** `home-index.html` (6 bloques `.leader` verificados: archetypeIds
  284/339/350/320/322/376; listIds 28760/28874/28757/28800/28949/28895; formato `TEF-PBL`),
  `archetype-284.html` (`h1.name=Dragapult`; ~18 `div.core-card` con `img.card[data-set][data-number]`
  — insuficiente para 60, confirmado).
- **`/decks/list/<id>`: SIN fixture** — sus selectores (§2.3) son documentados, no verificados
  (supuesto A1, lo cierra el dry-run).
- **Modelos Fase 1 (verificados en `backend/prisma/schema.prisma` @ `origin/production`):**
  enums `MetaDeckSource{limitless,manual}`, `MetaCardGroup{pokemon,trainer,energy}`,
  `MetaMatchStatus{matched,ambiguous,unmatched_set,unmatched_number,unmatched_basic_energy}`;
  `MetaDeck(slug,name,source,sourceRef,rank,sharePct,trend,published,pausedByOperator,currentListId,
  imageCardId)`; `MetaDeckList(deckId,formatLabel,activeMarksSnapshot,sourceUrl,sourceTournament,
  fetchedAt,supersededById)` **inmutable**; `MetaDeckCard(rawName,rawSetCode,rawNumber,quantity,group,
  matchStatus,matchedCardId?)`; `MetaFetchRun(runAt,source,formatVersion,deckCount,applied,note)`.
- **Matcher (verificado, `deck-matcher.service.ts`):** casa por `CardSet.ptcgoCode` + `Card.number`
  normalizado (ceros a la izquierda para numéricos; upper para alfanuméricos), NUNCA por nombre;
  ambigüedad ⇒ `ambiguous`; básica sin identidad ⇒ `unmatched_basic_energy`.
- **Legalidad (verificado, `common/standard-legality.ts`):** `isLegalStandardNow` = `regulationMark ≠
  null ∧ ∈ activeMarks ∧ legalStandardRaw ≠ 'Banned'`; `regulationMark==null` ⇒ NO legal
  (conservador). Derivada en lectura, no persistida.
- **Infra (verificado):** HTTP = **`fetch` nativo** (`pokemontcg-io.client.ts`, host fijo, maneja
  `retry-after`), **sin axios/got**. **Sin** librería de parseo HTML en el repo (0 hits cheerio/jsdom/
  node-html-parser/parse5). **Sin** `@nestjs/schedule`. Scheduler = **BullMQ** (`bullmq@^5.81.3`, cola
  `tcg-daily`, helper `repeat()`, jobs repetibles por cron UTC, degradación sin `REDIS_URL`, disparo
  manual `POST /admin/jobs/*`).
- **Servicio Fase 1 (verificado, `decks-meta.service.ts`):** `adminCreateOrCurate` ya hace el patrón
  exacto que Fase 2 reusa (upsert deck → crear `MetaDeckList` → cards matched → supersede lista previa
  → re-apuntar `currentListId` → `MetaFetchRun`), todo en una `$transaction`.

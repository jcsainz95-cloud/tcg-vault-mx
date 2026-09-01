# TECH_DEBT.md — Marketplace TCG con Bóveda

> Registro de **deuda técnica aceptada, no bloqueante**, acordada con el techlead. Cada ítem indica
> **dueño**, **impacto** y **disparador** (cuándo hay que abordarlo). La deuda bloqueante NO va aquí:
> se corrige antes de cerrar. Propiedad de este archivo: **el rol dueño del código anotado** (a petición
> del techlead). Cada rol mantiene su propia sección.

---

## Backend (dueño: backend)

> Los 3 hallazgos de correctness de dinero marcados como gate de go-live (reserva de checkout atómica,
> validación de diales M10, y acotado por periodo de reportes) **ya están corregidos** con tests; no
> figuran como deuda.

### I8-B1 · `ingestConfigInvalid` NO cubre `grades` ni `freshnessDays`, y las dos viajan al proveedor (techlead B-1, v1.51-a, 2026-08-31)
- **Dueño:** backend (si la salida elegida es ampliar el fail-closed, el alcance lo confirma el **arquitecto**: cambia qué apaga el ingest). **Severidad:** **Media** (aceptada, **no bloqueante hoy** porque `grading_hook_enabled` está `off` y con `off` no se pide ni se escribe nada).
- **Deuda:** el gate de dinero del ingest sale por `cfg.ingestConfigInvalid` (`price-ingest.service.ts:1000`), que se compone con **tres** claves (`pricing.service.ts:1326`: `minSampleCount`, `sourceStat`, `ingestMaxCardsPerRun`). Pero al proveedor viajan **cinco**: `grades` (`price-ingest.service.ts:1095`) y `freshnessDays` (`:1102`) *(números de línea tras el pase v1.51-a; eran `:1087`/`:1094` en el reporte del techlead)* también se le pasan a `fetchGradedEstimatesForSet`, y **ninguna de las dos** marca `ingestConfigInvalid`. Con `graded_estimate_grades` corrupta, el resolver **apaga ficha y vitrina** (`estimatesEnabled=false`) y, en la misma corrida, el ingest **gasta créditos y ESCRIBE** usando el seed de esa misma clave — un valor que el resolver acaba de declarar no fiable.
- **Por qué importa más de lo que parece:** invierte la doctrina propia del proyecto («en la dirección del DINERO se falla cerrando»). Además hay una **divergencia documental**: el docstring que justifica que el gate lea el **dial crudo** en vez de `estimatesEnabled` (`price-ingest.service.ts`, bloque «v1.51 (M-46, §4.38r.7)») nombra **tres** claves de *curaduría* (`minUpsidePct`, `highlightGrades`, `maxRawMultiple`) como lo que no debe congelar el feed — pero el código habilita **cinco**: las tres de curaduría **más** `grades` y `freshnessDays`, que no son curaduría (gobiernan qué se pide y qué cuenta como fresco).
- **Impacto:** ninguno observable con el dial `off`. Con el dial `on`, una edición fuera de banda de `graded_estimate_grades`/`graded_estimate_freshness_days` produce **gasto + escritura con seeds** mientras la superficie de lectura está apagada.
- **Salidas (excluyentes; lo que NO puede quedarse es la divergencia):** **(a)** ampliar `ingestConfigInvalid` a `gradesRes.invalid || freshRes.invalid` (fail-closed completo; **decide arquitecto**, porque hace que una clave de exhibición corrupta congele también la obtención), **o (b)** reescribir el docstring para que deje de decir «curaduría» y **enumere exactamente** qué claves habilitan el gasto pese a estar corruptas y por qué se aceptó. Con (a) hace falta un test gemelo del de I8 (`graded-estimate.one-dial.spec.ts`): clave corrupta ⇒ cero `fetch`.
- **Disparador:** **antes del primer `off → on` de `grading_hook_enabled`** (mismo momento que M43-D2). Ref: ARCHITECTURE §4.38(h.3), §4.38(d) «Alcance del apagado», `BACKEND_NOTES.md` §0.15.

### I8-B2 · El dial que multiplica la factura no tiene `warn` al izarse; el de «rancio» sí (techlead B-2, v1.51-a, 2026-08-31)
- **Dueño:** backend (la **regla** de cuándo avisar —el presupuesto declarado— la fija el **arquitecto**). **Severidad:** Baja (aceptada, **no bloqueante**; es observabilidad, no comportamiento).
- **Deuda:** asimetría de ceremonia. `manualFreshnessDays: null` —que solo **desactiva un criterio de frescura**— tiene **`warn` obligatorio** al izar la config (**I8-bis**, `pricing.service.ts`, con test propio en `graded-estimate.batch.spec.ts`). `ingestMaxCardsPerRun` —el dial que **multiplica la factura del proveedor**— se iza **en silencio** con cualquier valor de su rango. El dial de dinero tiene **menos** ceremonia que el dial de rancio.
- **Impacto:** un `1000` puesto por dedazo (4× el seed) no deja ninguna señal en el log del arranque ni de la corrida; el operador se entera por la factura. No cambia ningún importe por sí solo.
- **Propuesta (del techlead):** emitir `warn` al izar una config cuyo `ingestMaxCardsPerRun` **supere el presupuesto declarado** — no un umbral hardcodeado; el presupuesto vive hoy en `DEVOPS_NOTES.md` §32.12 y el arquitecto tiene que decir **de dónde lo lee el backend** (¿otra clave de config? ¿env?) antes de implementarlo. **⚠️ El aviso debe decir «techo NOMINAL»**, nunca una cifra firme de créditos: el factor de amplificación `A` (§4.38r.3.1) no lo acota este dial (ver nota de I8 abajo).
- **Disparador:** cuando el arquitecto defina dónde vive el presupuesto declarado, o en el primer `PUT` que suba este dial por encima del seed — lo que ocurra antes. Ref: ARCHITECTURE §4.38(r.3.4), §4.38(m) (I8-bis como precedente de forma).

> **Nota de alcance sobre el estrechamiento de I8 (v1.51-a, `[1, 5000]` → `[1, 1000]`) — NO es deuda, es
> una advertencia contra la falsa cobertura.** Bajar el máximo reduce el peor caso **NOMINAL** que un
> solo `PUT` autoriza (de 20 000 a 4 000 créditos/día). **No cierra la amplificación:** `ingestMaxCardsPerRun`
> acota las cartas **en alcance**, no las que el proveedor devuelve (`fetchAllInSet=true` pide el SET
> entero), y el factor `A` lo manda el número de **sets** tocados, que **no es configurable**. Con `A=16`,
> 1 000 siguen siendo 16 000 créditos. Lo que acota el gasto es la **medición** que §4.38(r.3.1) hace
> precondición del primer `off → on`, y ésa **sigue abierta** (dueño: devops + QA, (r.8) nº 1).

> **D-3 (techlead) — CERRADA en este mismo pase, sin deuda residual.** Los comentarios de
> `graded-estimate.composition.spec.ts:654` y `:680` seguían diciendo «las 12 claves» después de que
> v1.51 (M-46) las bajara a **11** al fundir los dos diales M10 en `grading_hook_enabled`. `pricing.service.ts:99`
> exige que ese número no mienta («un número que miente es peor que no tenerlo») y el test que lo acompaña
> mentía. Los dos comentarios dicen ahora **11**, con la nota de por qué cambió.

### TL-GE4 · La regla S1/S2 está DUPLICADA entre `detectGradedShape` y `parseGradedEntry` (techlead GE-4, v1.51-b, 2026-08-31)
- **Dueño:** backend. **Severidad:** Media-baja (aceptada, **no bloqueante hoy**: las dos copias coinciden y hay tests que fijan la conducta de cada una por separado).
- **Deuda:** «qué es S1 y qué es S2» se decide en **dos** funciones de `pokemonpricetracker-bulk.provider.ts`: `detectGradedShape` (la SONDA, ~`:143`) y `parseGradedEntry` (el camino que ESCRIBE, ~`:1108`). Las dos repiten literalmente el mismo par de extracciones (`pickObject(pickObject(e['ebay']), 'salesByGrade')` y `pickObject(e, 'gradedPrices')`) y la misma precedencia (`S1 gana si existe`). Divergen **a propósito** en una sola cosa: la sonda ignora `GRADED_FORMAT` y el parser lo obedece.
- **Por qué importa:** es exactamente la forma del defecto **TL-GE2/R2** que se acaba de cerrar en este pase (dos definiciones de «conteo inducido», una en cada lado, que llegaron a contradecirse en la misma corrida). Aquí el riesgo es peor de leer: si el proveedor cambia el nombre del bloque y solo se actualiza una copia, la **sonda diría «llega S1, la fase 2 funciona»** mientras el ingest clasifica todo como S2 y no escribe **ni una fila** — o al revés. El veredicto y la conducta se separarían sin que ningún test actual lo note, porque cada copia tiene los suyos.
- **Impacto hoy:** ninguno observable. Las dos copias están sincronizadas y verificadas (`graded-estimate.probe.spec.ts`).
- **Salida propuesta:** extraer un `extractGradedBlocks(entry) → { salesByGrade, gradedPrices, externalId }` **puro** y que las dos funciones lo consuman, dejando en cada una **solo** su diferencia declarada (la sonda fija `useS1 = salesByGrade != null`; el parser aplica `forcedFormat`). Con un test que afirme que, para el mismo `entry`, `detectGradedShape` y `parseGradedEntry` **con `forcedFormat='auto'`** devuelven el MISMO `shape` — el gemelo del test que cerró TL-GE2/R2.
- **Disparador:** el primero de (a) **cualquier cambio en el shape del bloque PSA** del proveedor (nombre de campo, anidamiento) o (b) **antes del primer `off → on`** de `grading_hook_enabled` en producción, junto con el resto de la fase 2. Ref: `BACKEND_NOTES.md` §0.16, ARCHITECTURE §4.38(h.1-bis).

### TL-GE5 · La fila que NO resuelve a una carta se descarta SIN dejar traza (backend, v1.51-b, 2026-08-31)
- **Dueño:** backend. **Severidad:** ⬆️ **Media** (subida desde Baja en v1.51-c: **el disparador YA se cumplió**, ver abajo). Sigue siendo **no bloqueante** y **no toca dinero** — la dirección del fallo es la segura: **no** se escribe una referencia huérfana —, pero hoy es una pregunta abierta del dueño sin instrumento que la conteste.
- **Deuda:** en `ingestGradedEstimates`, `if (!cardId || !allowed.has(cardId)) continue;` (`price-ingest.service.ts`, bucle de `res.rows`) descarta la fila **en silencio**: no hay `warn`, no hay contador en `GradedIngestResult` y no hay `AuditLog`. El único caso que sí deja traza es la **ambigüedad** («el número X casa con N cartas → se OMITE»). Todos los demás —`externalId` que no empata, número con un formato que `cardNumberVariants` no cubre, carta de otro set— desaparecen.
- **Por qué importa:** es la **única fila del MAPA DE CAUSAS (`BACKEND_NOTES.md` §0.16.2, #19) sin línea de log**. En una corrida que devuelve S1 impecable y escribe cero filas, el veredicto diría `VIABLE` con `written=0` y **nada** en el log explicaría el hueco: el operador se queda exactamente en el estado que el bloque `[VEREDICTO-PSA]` existe para evitar. Es el mismo defecto de forma que §4.38h.4 ya obligó a cerrar para los descartes del parser («sin traza, el descarte es invisible y el preview solo dice `NO_PSA10`»), aplicado al descarte de resolución.
- **⚠️ Salida propuesta — CORREGIDA en v1.51-c (techlead): la anterior medía la POBLACIÓN EQUIVOCADA.** Se proponía un contador `skippedUnresolved` sobre las filas del proveedor que caen en `if (!cardId || !allowed.has(cardId)) continue;`. No sirve: con `fetchAllInSet=true` esas filas son **el SET ENTERO**, mientras `allowed` son solo las cartas con **inventario RAW publicado** ⇒ ese `continue` salta **por diseño en toda corrida sana**, y el contador quedaría dominado por el caso normal (un set de 200 cartas con 3 publicadas daría `skippedUnresolved = 197`, todos legítimos). El instrumento correcto es el **COMPLEMENTO**: un `Set<string>` de los `cardId` **resueltos** en el set y reportar **`allowed.size − resueltos.size`** por set —las cartas NUESTRAS que el proveedor no empató, que es la pregunta— más una muestra acotada de los `externalId`/`number` del proveedor que no casaron (tope de N por set, para no reproducir el ruido de 2 000 líneas que motivó el veredicto). Mismo coste, y sí contesta. Sigue siendo un campo **INTERNO** de `GradedIngestResult` (no viaja por HTTP) ⇒ **sin cambio de contrato**.
- **Nota (código muerto):** en `price-ingest.service.ts` (`if (!cardId || !allowed.has(cardId)) continue;`) la segunda mitad, **`!allowed.has(cardId)`, es inalcanzable**: `buildGradedCardIndex` construye el índice **recorriendo `allowed`**, así que todo `cardId` que el resolver devuelve ya está en `allowed`. Quien implemente esto que la retire o la deje con su comentario, pero que no la cuente como una causa de descarte distinta.
- **Disparador: ✅ YA SE CUMPLIÓ (v1.51-c, 2026-08-31).** Decía «la primera corrida real con `VEREDICTO: VIABLE` y `written` < cartas S1 observadas»; **producción está exactamente ahí ahora mismo** (el ingest escribe —hay estimados PSA reales— y muchas cartas siguen sin dato, y el dueño quiere saber por qué). El trabajo queda **listo para tomarse**, con una precisión de v1.51-c: la causa #5 del mapa («set sin `pptSetId`») **ya dejó de ser invisible** —el bloque `[VEREDICTO-PSA]` trae la línea `SETS NO PEDIDOS:` con los sets nombrados (`BACKEND_NOTES.md` §0.16.3)—, así que descartar esa causa antes de implementar esto es **barato, pero hay que leer la línea con las dos cautelas que v1.51-d le añadió** (§0.16.4): **(1)** `SETS NO PEDIDOS` cuenta solo los sets del **recorrido**, y el recorrido se corta (tope de sonda, cuota diaria, escalada, alcance recortado por `ingestMaxCardsPerRun`) ⇒ si el bloque trae `ALCANCE RECORRIDO: PARCIAL` / `COTA INFERIOR`, ese número es un **mínimo** y la causa #5 **no** queda descartada por verlo bajo; **(2)** existe una línea hermana, `SETS SIN COMPROBAR`, para los sets cuyo mapeo **ni se intentó** (catálogo `/api/v2/sets` caído, causa #8) — hasta v1.51-c esos sets se publicaban **dentro** de `SETS NO PEDIDOS`, así que una lectura anterior de esa línea pudo atribuir a la causa #5 lo que era la #8. Con las dos cautelas, la lectura sigue siendo gratis; sin ellas, engaña. Ref: `BACKEND_NOTES.md` §0.16.2 fila #19.

> **TL-GE1, TL-GE2/R2, TL-GE3 y R1 — CERRADOS en el pase v1.51-b, sin deuda residual.** Se anotan aquí
> por el **hallazgo de proceso** que levantó el techlead: los cuatro se detectaron en dos pases de
> revisión independientes y **ninguno llegó a este archivo**, así que el techlead los volvió a encontrar
> desde cero. Quedaron: **R1** — el veredicto daba dos diagnósticos FALSOS (`enabled` sobrecargado como
> «por qué no pasó nada» y asignado *después* de dos salidas tempranas) ⇒ hoy hay `stopReason` con
> titular y acción propios por causa, y la clave inválida se NOMBRA. **TL-GE1** — `COSTE MEDIDO` se
> calculaba restando el contador diario del **singleton** `PptApiClient`, que el barrido RAW de la misma
> corrida pisa ⇒ hoy se suma `metadata.apiCallsConsumed` de las llamadas graded y, sin atribución, **no
> se reporta número**. **TL-GE2/R2** — dos definiciones de «conteo inducido» ⇒ una sola,
> `shapeCountIsInduced`, exportada y consumida por ingest y veredicto. **TL-GE3** — la bandera
> `POKEMONPRICETRACKER_GRADED_PROBE` caía en silencio ante un typo ⇒ `warn` explícito (semántica
> intacta). Detalle y tests en `BACKEND_NOTES.md` §0.16.1.
>
> **Residuos del propio pase, CERRADOS en v1.51-c, sin deuda nueva.** El segundo repaso encontró que
> R1 había dejado viva una **tercera** instancia de su propio defecto (la rama `!requestOk` mandaba a
> leer «EL REQUEST FALLÓ» también cuando **no hubo petición**: sin API key y **set sin `pptSetId`**), que
> el cierre de TL-GE2 introdujo una **afirmación falsa** en el `detail` que se le manda al arquitecto
> («GRADED_FORMAT=auto» en la rama donde vale `graded_prices`), que la línea de coste **concluía el
> modelo de cobro desde cero observaciones**, y que el candado de R1 era de **aridad**, no de
> corrección. Los cuatro quedan cerrados en `BACKEND_NOTES.md` §0.16.3 (unión discriminada
> `GradedRunOutcome` + `noRequestReason` en el provider), con los estados prohibidos probados por
> `@ts-expect-error`. **Nada de esto cambió una ruta de escritura de dinero.**
>
> **Residuos del tercer pase, CERRADOS en v1.51-d, sin deuda nueva de conducta.** El techlead encontró
> la **cuarta** instancia de R1 y QA la **quinta**, así que este pase empezó por el **guardián** y no
> por las instancias: **TL-GE7** — las líneas de log del camino graded viven en
> `backend/src/modules/pricing/graded-log-lines.ts`, el emisor y la cita leen la **misma constante**, y
> un test sobre las corridas reales (`test/graded-verdict-guard.spec.ts` + el guardián de
> `test/graded-run.harness.ts`) exige que toda línea citada entre `«…»` **exista en los logs de esa
> misma corrida** (y que las citadas como ausentes, no). Se verificó **retroactivamente** contra las dos
> instancias de este pase: el guardián las caza a las dos, solo con el invariante y sin ninguna
> aserción de contenido. **R1-quater** — `pptSetId == null` significaba dos cosas («se comprobó y no
> empata» vs. «no se pudo comprobar») ⇒ `PptSetMapping` las separa por tipo y el veredicto tiene
> titular, acción y línea propios para cada una. **QA (429 daily)** — el `nextStep` era incondicional y
> mandaba a «EL REQUEST FALLÓ», que la rama del 429 diario **no emite**. **QA (cota inferior)** —
> `SETS NO PEDIDOS` se marca ahora como mínimo cuando el recorrido no cubrió el alcance. **techlead
> §2** — `no_scope` se discrimina por `reason` con `never` de cierre. Detalle en `BACKEND_NOTES.md`
> §0.16.4. **Ninguno cambió una ruta de escritura de dinero.**

### TL-GE7-D1 · El catálogo de sets caído se reporta con UNA causa y se re-pide una vez POR SET (backend, v1.51-d, 2026-08-31)
- **Dueño:** backend. **Severidad:** Baja (aceptada, **no bloqueante**; no toca dinero y no afecta a ninguna decisión de escritura).
- **Deuda (dos residuos del cierre de R1-quater, los dos de precisión, no de conducta):**
  1. **Una sola causa por corrida.** `GradedRequestTally.mapper` lleva `cause: 'daily_limit' | 'request_failed'` y el veredicto publica la del **primer** set que quedó sin comprobar. Si en la misma corrida un set falla por cuota y otro por red, el titular nombra solo una de las dos. Para **esa** combinación (dos causas de *unavailable*) no hay cita falsa: las dos emiten la MISMA marca citable (`PptSetMapper: NO SE PUDO CONSULTAR /api/v2/sets`), así que el guardián sigue verde y el `grep` del operador sigue devolviendo la línea; lo único impreciso es la acción sugerida («espera a las 00:00 UTC» vs. «revisa la red»).
     - **⛔ Corrección (v1.51-e, hallazgo de QA — la afirmación original se pasaba de fuerte).** La frase anterior decía «**no produce ninguna cita falsa**» a secas, y ese razonamiento **solo cubría** la combinación *unavailable + unavailable*. **NO cubría `unavailable` + `unmatched`**, que sí producía una cita falsa y que era la **instancia #6** del defecto R1: como `loadRemoteSets` cachea **solo el éxito**, un fallo transitorio de `/api/v2/sets` en el set A y un éxito en el set B dan `mapper.available:false` **y** `setsUnmatched:[B]` **a la vez**, y el bloque citaba `PptSetMapper: … sets SIN mapeo` como **viva** (línea `SETS NO PEDIDOS`) y como **AUSENTE** (`AHORA:`) en el mismo bloque, además de afirmar «NO es que falte mapeo» habiéndolo. **Ya está CORREGIDO** en este pase (rama condicionada a `sinMapeo.length === 0` + rama fundida que publica las dos causas con sus dos acciones) y **con test de corrida real** (`test/graded-verdict-guard.spec.ts`, describe «el catálogo caído para UN set y sin mapeo para OTRO»). Lo que queda de deuda aquí es solo lo de arriba: la causa única entre dos *unavailable*.
  2. **Sin caché negativa.** `PptSetMapper.loadRemoteSets` cachea en memoria solo el ÉXITO; si `/api/v2/sets` falla, cada set del alcance vuelve a pedirlo. Con `daily_limit` es inocuo (el candado en memoria de `PptApiClient` corta **sin** pegarle al proveedor), pero con `request_failed` son N peticiones fallidas por corrida en vez de una.
- **Impacto hoy:** ninguno observable con el dial `off`, y con el dial `on` es ruido de log + N intentos fallidos contra un endpoint que ya se sabe caído. Money-safe intacto: sin catálogo **no se pide nada** y **no se escribe nada**.
- **Salida propuesta:** llevar la causa por set (`mapper.sets` como pares `{setExternalId, cause}`) si alguna vez se ven las dos causas en la misma corrida, y cachear el fallo de `loadRemoteSets` por corrida (un `remoteSetsError` en memoria, limpiado igual que la caché de éxito).
- **Disparador:** el primero de (a) una corrida real que reporte `SETS SIN COMPROBAR` con más de un set, o (b) **antes del primer `off → on`** de `grading_hook_enabled`, junto con el resto de la fase 2. Ref: `BACKEND_NOTES.md` §0.16.4.

### Pase v1.51-e (remate del guardián graded + cerrojos del carrito) — deuda del cuarto pase (backend, 2026-08-31, no bloqueante)

> **Lo que NACIÓ Y MURIÓ en este mismo pase, y por eso NO se anota como deuda abierta.** El techlead
> enumeró tres residuos (R-1, R-2, R-3) que habrían sido TL-GE8-1/2/3: el guardián era **opt-in**, la
> cita solo estaba vigilada si llevaba `«»`, y el `else` que afirma «hubo petición» no tenía candado.
> **Los tres quedan cerrados aquí**: `capturarLogs()` suscribe el buffer y un `afterEach` del harness
> corre el invariante sobre todo test que capture logs (con opt-out **nombrado** y **verificado**,
> `sinGuardianPorque`); el complemento del invariante (`mencionesSinMarcar`) prohíbe nombrar una marca
> —o sus prefijos `PPT graded:` / `PptSetMapper:`— fuera de un marcador de cita; y las dos cadenas
> `if/else` de `price-ingest.service.ts` son `switch` con `const … : never` (verificado con
> contraejemplo: un cuarto `noRequestReason` y un tercer `reason` de `PptSetMapping` **no compilan**).
> También se cerró la **instancia #6** que QA reprodujo (ver la corrección dentro de TL-GE7-D1) y se
> sustituyó el mapped type distributivo de `GradedSimpleStop` por un miembro normal + `never` sobre el
> discriminante (A7 del techlead, **compilado y verificado** en las dos direcciones). Ninguno de estos
> cambios toca una ruta de escritura de dinero.

#### TL-GE8-4 · `GradedRequestTally` no lleva `requestFailedCount`: bajo `dailyLimited` el bloque CALLA si además hubo fallos (backend, v1.51-e)
- **Dueño:** backend. **Severidad:** Baja (aceptada, **no bloqueante**; no toca dinero, solo precisión del diagnóstico).
- **Deuda:** en la rama «se emitieron peticiones y ninguna respondió OK» con `dailyLimited: true`, el `nextStep` cita `«PPT graded: 429 DAILY … → PARADA.»` y **deliberadamente no afirma nada** sobre `EL REQUEST FALLÓ`: con la cuota agotada esa línea **puede** existir (si otro set falló antes por 401/red) o no, y hoy el veredicto **no tiene el dato** para saberlo. Callar es lo correcto frente a mentir, pero es callar algo **decidible**: el provider ya sabe cuándo entró en el `else` del `catch` (el que emite `requestFailed`), así que bastaría un contador `requestFailedCount` en el tally para que el bloque dijera «además hubo N peticiones que fallaron ⇒ busca también esta línea» o «no hubo ninguna ⇒ no la busques».
- **Impacto:** el operador con cuota agotada **y** un 401 de fondo no ve el segundo problema hasta la corrida siguiente. Cero impacto en dinero: sin respuestas OK no se escribe nada.
- **Salida propuesta:** `requestFailedCount: number` en `GradedRequestTally`, poblado desde el provider; el `nextStep` de `dailyLimited` añade la cita VIVA solo si `> 0`. El guardián lo verifica solo, sin aserción de contenido.
- **Disparador:** la próxima vez que se toque el tally, o **antes del primer `off → on`** de `grading_hook_enabled` si la cuota diaria se topa en una corrida real. Ref: `BACKEND_NOTES.md` §0.16.5.

#### TL-GE8-5 · `sweepComplete` ignora las cartas con `set` nulo, y la rama «ninguna causa conocida» no tiene test (backend, v1.51-e)
- **Dueño:** backend. **Severidad:** Baja-Media (aceptada, **no bloqueante**; ninguna de las dos ramas escribe nada).
- **Deuda (dos cosas, la misma familia — «el bloque afirma más de lo que sabe»):**
  1. **`sweepComplete` puede salir `true` habiendo cartas que nadie miró.** El alcance se construye con `cardIds` (cartas con inventario RAW publicado), pero el agrupador por set descarta las que vienen sin `set` (`price-ingest.service.ts`, `if (!c.set) continue;`). Esas cartas **están en alcance y no se miran nunca**, y sin embargo `setsVisitados === setsEnAlcance` se cumple ⇒ el bloque **no** marca `ALCANCE RECORRIDO: PARCIAL` ni `COTA INFERIOR`. Con `Card.setId` obligatorio en el schema es hoy inalcanzable por datos, pero es exactamente la clase de afirmación que este hilo lleva cuatro pases cerrando: un total que en realidad es un mínimo.
  2. **La rama «ninguna causa conocida» es alcanzable en producción, tiene CITA y no tiene test.** Es el `return` final de `noRequestOkVerdict` cuando `attempted === 0` sin llave ausente, sin catálogo caído y sin sets sin mapear (y, desde este pase, también el destino de un `noRequestReason` sin rama, que ahora **no** incrementa `attempted`). Cita `«graded-estimate-ingest»` como viva. Ningún test la ejercita, y **un test de función pura no la cerraría**: el guardián solo verifica contra logs de corridas REALES, así que hace falta construir la corrida.
- **Impacto:** (1) una cifra de sets presentada como total cuando es un mínimo; (2) una rama de diagnóstico sin red. Ninguna de las dos escribe ni relaja un gate: money-safe intacto.
- **Salida propuesta:** (1) contar las cartas descartadas por `!c.set` y meterlas en el predicado de `sweepComplete` (o darles su propia línea «N carta(s) del alcance sin set ⇒ no se miraron»); (2) montar la corrida que llega ahí (un `noRequestReason` desconocido inyectado por un doble de provider) y pasarla por el guardián.
- **Disparador:** la próxima vez que se toque `sweepComplete` o el tally, o **antes del primer `off → on`** en producción. Ref: `BACKEND_NOTES.md` §0.16.5.

#### T-9 · HUECO #1 del guardián de citas: los tests de **función pura** lo esquivan (backend, v1.51-e)
- **Dueño:** backend. **Severidad:** Baja-Media (aceptada, **no bloqueante**; es cobertura del guardián, no conducta del producto).
- **Deuda:** desde este pase el guardián de citas es **automático** —`capturarLogs()` suscribe el buffer y un `afterEach` corre el invariante sobre **todo test que capture logs**, con opt-out nombrado y verificado (`sinGuardianPorque`)—. Pero engancha por **captura de logs**, así que un test que llama a `gradedPhase2Verdict(...)` **como función pura**, sin montar corrida ni capturar nada, **no lo dispara**: nadie mira el texto que produce. Y esa es exactamente la mitad por la que **R1 entró la primera vez** (una cita a una línea de log que no existía, escrita en un veredicto que ningún test de corrida real ejercitaba).
- **Impacto:** ninguno observable hoy — las instancias conocidas de R1 están cerradas y con test de corrida real. Es una **puerta lateral** del guardián: quien añada mañana un veredicto nuevo probándolo solo como función pura vuelve a quedar sin red, y el guardián automático no protestará.
- **Salida propuesta (la que añadió el techlead, y es barata):** **`mencionesSinMarcar()` es puramente TEXTUAL y no necesita logs.** Es el complemento del invariante —prohíbe nombrar una marca, o sus prefijos `PPT graded:` / `PptSetMapper:`, fuera de un marcador de cita— y opera sobre una cadena, no sobre un buffer. Así que se puede correr sobre `report.lines` de **cualquier** test de función pura: **~3 líneas en un helper compartido** (`esperarSinMencionesSinMarcar(report)`) invocado desde los tests puros de `gradedPhase2Verdict`. No cubre el hueco entero (la mitad que verifica que la cita **exista viva en el log** sigue exigiendo corrida real, por construcción), pero cubre **la mitad exacta** por la que R1 entró.
- **Refs:** `src/modules/pricing/graded-log-lines.ts:187` (`mencionesSinMarcar`), `test/graded-verdict-guard.spec.ts` (harness `capturarLogs`/`sinGuardianPorque`), `src/modules/pricing/graded-phase2-verdict.ts`.
- **Disparador:** **la próxima rama nueva en `gradedPhase2Verdict`**, o **antes del primer `off → on`** de `grading_hook_enabled` — lo que ocurra antes.

#### T-6 · `FrozenCardFacts` compila contra `Prisma.InputJsonValue` **solo por ser un `type` alias** (backend, v1.51-e)
- **Dueño:** backend. **Severidad:** Baja (aceptada, **no bloqueante**; hoy compila y no hay error latente en ejecución).
- **Deuda:** el blob congelado viaja a Prisma como `Prisma.InputJsonValue`, y esa asignabilidad depende de que `FrozenCardFacts` sea un **`type` alias** y no una `interface`: los alias de objeto tienen índice implícito para el chequeo estructural y las `interface` **no**. Convertirlo a `interface` —un refactor que cualquiera haría por costumbre— **rompe el build**, y lo rompe con un error **críptico y lejano**: no habla de `FrozenCardFacts` sino de `Type 'OrderLineData[]' is not assignable to … OrderItemCreateWithoutOrderInput[]` en `orders.service.ts` y `guest-checkout.service.ts` (verificado en este pase). El bloque de doctrina de `order-item-card.ts` **no advierte de esto**.
- **Impacto:** media hora perdida por quien lo intente, en un archivo que es la doctrina del snapshot congelado. Ningún impacto en ejecución ni en dinero.
- **Salida propuesta:** una línea en el docstring de `FrozenCardFacts` («⛔ tiene que seguir siendo `type`, no `interface`: es lo que lo hace asignable a `Prisma.InputJsonValue`») o, mejor, un cerrojo explícito del estilo `const _esJsonPersistible: Prisma.InputJsonValue = {} as FrozenCardFacts;` que falle **en el archivo correcto** y no a dos módulos de distancia.
- **Disparador:** el próximo cambio en `order-item-card.ts`.

#### T-7 · Dos mocks de `guest-checkout.session.spec.ts` ejercitan en silencio la rama «sin fila `Card` ⇒ `null`» (backend, v1.51-e)
- **Dueño:** backend. **Severidad:** Baja (aceptada, **no bloqueante**).
- **Deuda:** `test/guest-checkout.session.spec.ts:94` y `:118` mockean `priceCartForOrder`/`priceCartForQuote` con `items: ids.map((id) => ({ id, folio: … })) as never` — o sea **sin `card`**. `toOrderItemPreviews` resuelve la clase (P) por `cardByItemId.get(inventoryItemId)`, así que en esos tests el mapa devuelve `undefined` y **todas** las líneas salen con `imageSmallUrl: null`. El `as never` tapa que el doble no cumple la forma que el código real recibe: esos tests están ejercitando el camino degradado creyendo ejercitar el bueno.
- **Impacto:** ninguno hoy (esos tests no afirman nada sobre la miniatura), pero es un doble que MIENTE sobre la forma: si mañana alguien añade ahí una aserción de imagen, la escribirá contra el camino equivocado.
- **Salida propuesta:** darle `card: { imageSmallUrl: … }` al doble y quitar el `as never`, o dejar el `as never` con un comentario que diga explícitamente qué rama se está ejercitando.
- **Disparador:** el próximo test que toque la miniatura en el flujo de invitado.

#### T-8 · El detalle **admin** de un pedido resuelve la miniatura solo por lectura de código: no hay test que lo fije (backend, v1.51-e)
- **Dueño:** backend. **Severidad:** Baja (aceptada, **no bloqueante**).
- **Deuda:** `getOrder(userId, orderId, isAdmin)` sirve **dos** superficies con el mismo cuerpo: el detalle del cliente y el del admin (`isAdmin = true`, que se salta el guard de propiedad). Que el admin vea la miniatura resuelta es cierto **por construcción** —es literalmente el mismo `return`, y desde este pase la misma proyección anotada `toHistoricItemPreviews`—, pero **ningún test lo fija**: si alguien bifurcara el cuerpo por `isAdmin`, nada se pondría rojo.
- **Impacto:** ninguno hoy. Es cobertura ausente, no defecto.
- **Salida propuesta:** un caso en `IMG-4` con `getOrder(otroUsuario, orderId, true)` que afirme el mismo `card.imageSmallUrl` que ve el dueño (4 líneas).
- **Disparador:** el próximo cambio en `getOrder` o en las superficies de admin de pedidos.

### M43-D1 · `reconcilePublishedPrices` sigue siendo `raw`-only: un slab sin referencia no entra a la cola (M-43, 2026-08-29)
- **Dueño:** backend. **Severidad:** Media-baja (aceptada, **no bloqueante**). Residual **declarado por el arquitecto** en ARCHITECTURE §4.38(l.4.9), fuera del alcance de M-43 por decisión del orquestador.
- **Deuda:** el barrido de reconciliación (`reconcilePublishedPrices`) lleva `productType:'raw'` en su `where` (candado 1 de §4.38l.4.6). Con M-43, un slab cuya única fila de `graded:PSA:N` sea un estimado —o al que se le borre su referencia de mercado— **deja de venderse** (`priceBasis:'pending'`, `fetchSellable` lo descarta, `GET /catalog/listings/:id` ⇒ 404) **pero NO aparece en `PendingPriceEntry`**, así que no entra a la cola de triaje de §M2 y el dueño no tiene dónde verlo.
- **Impacto:** una pieza puede quedar apagada **en silencio**. **No puede ocurrir durante la migración** si se ejecuta el cut-over de §4.38(l.4.7) en orden (el paso 3 re-afirma cada slab expuesto **antes** de migrar, ver `BACKEND_NOTES.md` §0.11.6). Sí puede ocurrir **después** — por ejemplo si alguien borra una referencia de mercado de un slab. Money-safe en la dirección segura: la pieza no se vende barata, simplemente no se vende.
- **Disparador:** al **encender el gancho de grading** (v1.51: `gradingHookEnabled='on'`, el dial ÚNICO — §4.38r) o antes de que M2 se use como bandeja única de precios pendientes. El fix es extender el barrido a `productType:'graded'`; toca el módulo `pricing` y la cola, así que **el alcance lo confirma el arquitecto**.
- **⚠️ Actualización v1.50.3-g (ARCHITECTURE §4.38l.4.12, dictamen del arquitecto):** sigue **sin bloquear la fusión** ni el encendido en staging con datos sintéticos, pero pasa a ser **precondición del cut-over de producción**, cabalgando sobre la puerta que ya está cerrada (condición **C3** del blue team). Se satisface por **cualquiera** de dos vías: **(i)** extender `reconcilePublishedPrices` a `graded` —de fondo, **dueño backend**, con el cuidado declarado de no inundar la cola el día del encendido— **o (ii)** un **detector recurrente con alerta** sobre el predicado del **paso 5(−)** del runbook (`BACKEND_NOTES.md` §0.11.6), que es **la misma consulta que ya hay que escribir**, agendada — **dueño devops**. El arquitecto declara **(ii) suficiente para abrir la puerta del cut-over**; **(i) se conserva aquí con su disparador propio** y no bloquea ningún deploy. **Este pase (M-44) NO lo implementa: quedó explícitamente fuera de alcance.**

### M43-D2 · `PriceReference.evidenceDate` existe pero NO está cableada (criterio 109 sigue con su aproximación) (M-43, 2026-08-29)
- **Dueño:** backend (el alcance lo decide **arquitecto**; ver nota de gobierno abajo). **Severidad:** Baja (aceptada, **no bloqueante**, **sin regresión**).
- **Deuda:** la migración `v1.50.3-f-graded-estimate-kind` creó la columna `evidenceDate DateTime? @db.Date` (§4.38m.2, empaquetada con `refKind` para no pagar dos ventanas de migración), pero **este pase no la cableó**: ni el ingest la puebla (el parser YA resuelve la `lastSaleDate` del proveedor y la usa para el gate de escritura, pero no la persiste) ni `stale()` la lee (sigue midiendo contra `capturedDate`). **La columna está en `null` en todas las filas**, así que `evidenceDate ?? capturedDate` sería hoy idéntico a `capturedDate`: **cero cambio de comportamiento, cero regresión**.
- **Impacto:** el **criterio 109** sigue cumpliéndose por la **aproximación conservadora** vigente —el gate de evidencia en la **escritura** del ingest, con cota honesta `≤ 2 × freshnessDays` (60 d con el seed) en vez de los 30 literales—, que ya está **declarada como desviación en §9** y que cierra el fallo grave («fresco para siempre»). Lo que falta es el cierre **al pie de la letra**. La deuda es de **precisión**, no de seguridad, y el dial del gancho (v1.51: `grading_hook_enabled`) está `off`.
- **Nota de gobierno (por qué no se hizo aquí):** §11 describe el cierre exacto junto a la columna, pero **el alcance que el arquitecto asignó a M-43 enumera la columna en el schema y nada más**; cablear `stale()` y el escritor del ingest habría sido cambiar un comportamiento de frescura de dinero-adyacente **sin encargo**. Se declara en vez de decidirlo por cuenta propia (regla 9).
- **Disparador (⚠️ ADELANTADO en v1.51 por M-46):** **antes del primer `off → on` de `grading_hook_enabled` en producción**. Antes decía «antes de encender `graded_estimate_ingest_enabled` (la fase 2)», y con **dos** diales eso era una fecha lejana; con el **dial ÚNICO** (§4.38r) *encender la fase 2 y encender la feature son el mismo acto*, así que esto pasa a estar **delante del paso 5 del pase** (§4.38r.4) — es la **GU-9** que el arquitecto repositionó a **bloqueante del primer encendido en producción** (§4.38r.6.2, §10). Cierre por **una de dos**: el humano acepta por escrito la cota `≤ 60 días`, **o** se cablea `evidenceDate`. El trabajo es: (a) `persistGradedEstimateReference` recibe y persiste la `evidenceDate` que el parser ya trae, y (b) `isStaleByOrigin`/`stale()` miden contra `evidenceDate ?? capturedDate`. Ref: ARCHITECTURE §4.38(m.2), §11 (M-43), `BACKEND_NOTES.md` §0.11.7.
- **✅ Actualización v1.51-a (2026-08-31) — GU-9 CERRADA ⇒ esta deuda DEJA DE BLOQUEAR el encendido.** El dueño **aceptó por escrito la cota de ≤ 60 días** (`PROJECT.md`, decisión 61; ARCHITECTURE §4.38m.2.1), que era **una** de las dos vías de cierre del disparador anterior. Queda por tanto: **severidad BAJA, NO bloqueante**, sin disparador de fecha. Se conserva porque el cierre *al pie de la letra* del criterio 109 sigue pendiente y porque **la columna `evidenceDate` YA EXISTE** en el schema (migración `v1.50.3-f-graded-estimate-kind`): el trabajo restante es (a)+(b) de arriba, **sin DDL y sin ventana de migración**. ⛔ **Lo que este cierre NO autoriza a nadie:** tocar `graded_estimate_freshness_days` — se queda en **30**; escribir 60 daría un peor caso de **120** (§4.38m.2.1). Encargo: (r.8) nº 7.

### M44-D1 · La validación de entrada del override de precios vive en el handler, no en el DTO (M-44, 2026-08-29)
- **Dueño:** backend (la decisión de fondo, si se toma, es del **arquitecto**). **Severidad:** Baja (aceptada, **no bloqueante**, sin impacto observable).
- **Deuda:** `API_CONTRACT` §M2 rev v1.50.3-g norma **`422 VALIDATION_ERROR`** para los tres bordes de SEC-M43-4 (`productType` fuera del conjunto, `gradeKey` no generable, `cardId` inexistente ⇒ `404`). El `ValidationPipe` global de `main.ts` responde **`400`** ante un fallo de `class-validator`, así que un `@IsIn(PRODUCT_TYPE_VALUES)` en el DTO habría cumplido la intención del hallazgo **incumpliendo el estatus del contrato**. Se implementaron **a mano en el handler** (`pricing.controller.ts`), que es lo que manda el contrato, a costa de que la regla no viva junto al campo que valida.
- **Impacto:** ninguno funcional. Es una **asimetría de estilo** dentro del mismo DTO (`finish` e `intent` sí usan `@IsIn`, porque su fallo no está normado en el contrato) y, sobre todo, una **señal**: hay una divergencia general `400` (pipe) vs `422` (contrato) que este pase **no** tenía encargo de resolver y que no se resolvió por cuenta propia (regla 9).
- **Disparador:** la próxima revisión de contrato que toque códigos de validación. Dos salidas posibles, y **la elige el arquitecto**: (a) `errorHttpStatusCode: 422` en el `ValidationPipe` global —cambia el estatus de **todos** los endpoints, o sea contrato en masa—, o (b) declarar en el contrato que la validación de forma es `400` y dejar el `422` para las reglas de negocio. Ref: `SECURITY_NOTES.md` §5.4, ARCHITECTURE §4.38(l.4.13), `BACKEND_NOTES.md` §0.12.5.

### MSH-1 · Homólogo de H2/H1 no propagado a rutas de dinero hermanas (money-safety-hardening, 2026-08-20)
- **Dueño:** arquitecto decide alcance → **backend** ejecuta (misma clase que H2, ruta distinta). **Severidad:** Media (aceptada, out-of-scope de la rama `claude/money-safety-hardening`).
- **Deuda:** el endurecimiento H2 (ignorar `Idempotency-Key` del cliente en rutas de dinero) y H1 (aseverar monto/moneda al liquidar) se aplicaron a `orders`/`guest`, pero **no** a las rutas gemelas: `shipments.service.ts:170` aún hace `idempotencyKey ?? pi-shipment-<id>` (el header del cliente llega a Stripe) y `admin-orders.controller.ts:234` (refund `@MoneyOut`) acepta la key del cliente como override; además la rama `shipment` de `payments.service.ts onPaymentSucceeded` (~:171) liquida `solicitado→picking` **sin** aseverar monto/moneda (MS-4).
- **Impacto:** superficie residual de la misma clase de riesgo que H1/H2, en el módulo `shipments`/refund (fuera del work stream de `orders/payments/money`). No explotable para robo sin forjar la firma de Stripe; el refund es admin-gated y auditado.
- **Disparador:** **antes de operar con dinero real.** El fix es idéntico y trivial (forzar clave server-side; añadir la aserción monto/moneda en la rama shipment). Requiere decisión del arquitecto por tocar otro módulo/stream. Ref: `docs/PENTEST_NOTES.md` (MS-1/MS-4) y `docs/SECURITY_NOTES.md` (pase money-safety-hardening).

### MSH-2 · Telemetría del clamp unitario y secreto del webhook (money-safety-hardening, 2026-08-20)
- **Dueño:** backend. **Severidad:** Baja (aceptada). El vector de DoS por overflow del **agregado** `Order.totalCents` (MS-2, Media) **ya está corregido** con throw en `grossUpTotal` → `AMOUNT_TOO_LARGE` (422) y tests; no figura como deuda abierta.
- **Deuda residual:** (a) **MS-3** — `clampCents` (`common/money.ts`) recorta el precio *unitario* en silencio (sin log/audit), a diferencia de H1; se dejó puro a propósito (el módulo es «sin dependencias de infra») y la señal fuerte vive en el throw del agregado + los validadores `FIXED_CENTS_MAX`. (b) **MS-5** — `constructEvent` usa `SECRET ?? ''` (fail-closed, con fail-fast en prod, pero frágil).
- **Impacto:** bajo; con config legítima el clamp unitario no debería dispararse. Si se disparara, no deja rastro (posible bug aguas arriba enmascarado).
- **Disparador:** si aparece un `AMOUNT_TOO_LARGE` en producción o se endurece la observabilidad de dinero, emitir señal (warn/audit) desde el caller que persiste cuando `clampCents` realmente recorte; y endurecer el manejo del secreto del webhook. Ref: `docs/SECURITY_NOTES.md` (MS-3/MS-5).

### Deuda del pase P-29 idempotencia (v1.35, cluster 2 inventario — hallazgos techlead, no bloqueante, aceptada)

> Pase `fix/variant-composition-regression` (2026-08-22): se cerró **H1 MAYOR** (idempotencia por
> `batchKey` en `bulk-remove`, paridad con `adjustFound`) — ya **corregido con tests**, no figura como
> deuda. Lo de abajo son los ítems **menores no bloqueantes** que quedaron del mismo pase.

#### BE-BR1 (= techlead H4; el fast-path sin filtro por `kind` = H3) · `InventoryBatch.kind` es TEXT libre sin enum/CHECK (hardening de idempotencia)
- **Dueño:** backend (schema es zona compartida → cambio pasa por arquitecto). **Severidad:** Baja (aceptada).
- **Deuda:** `InventoryBatch.kind` (`schema.prisma`) es `String`/`TEXT NOT NULL` **sin** `CHECK` ni enum
  Prisma; hoy admite cualquier string. Los valores válidos (`create | publish | adjust | publish_all |
  bulk_remove`) viven solo en el comentario del schema y en el código. Un `kind` mal escrito no lo atrapa
  la BD. Además, el mecanismo de idempotencia **no filtra por `kind` en el fast-path de `bulk-remove`**
  (a diferencia de `publishAll`, que sí verifica `existing.kind !== 'publish_all'` → 409): un `batchKey`
  reutilizado por accidente entre `bulk-remove` y otro tipo de lote haría replay del `resultJson` ajeno.
  En la práctica el `batchKey` lo genera el cliente por-operación (UUID) y no colisiona entre tipos.
- **Impacto:** bajo; requiere que el front reuse deliberadamente un `batchKey` de otro endpoint (no ocurre
  con UUIDs por-operación). No toca dinero (la baja solo transiciona `status`).
- **Disparador:** al endurecer la familia de idempotencia por lote, (a) migrar `kind` a un enum Prisma o
  añadir un `CHECK` (decisión del arquitecto por ser schema/zona compartida) y (b) alinear el fast-path de
  `bulk-remove` con `publishAll` (verificar `kind === 'bulk_remove'` antes de replay-ear → 409 si no).

#### BE-BR2 · Sin migración para el valor `bulk_remove` — decisión documentada (no es deuda de código)
- **Dueño:** backend. **Severidad:** N/A (nota de trazabilidad).
- **Contexto:** el contrato v1.35 y el brief de tarea pedían «añadir `bulk_remove` al enum `kind` con su
  migración (p. ej. M-37)». **No aplica migración**: `kind` es una columna `TEXT` libre (no enum de BD, sin
  `CHECK`); añadir un valor **no genera DDL** (mismo precedente que `publish_all`, añadido en v1.28 sin
  migración). Solo se actualizó el comentario del schema. Se registra aquí para que el arquitecto lo sepa
  al valorar BE-BR1 (si se decide enum/CHECK, **ahí sí** habrá una migración numerada).

#### Re-enumeración techlead H2–H8 (cluster 2 inventario, veredicto APROBADO CON DEUDA)

> Transcripción de los hallazgos menores no bloqueantes que el techlead re-enumeró tras el gate.
> **H3** y **H4** son la misma familia que **BE-BR1/BE-BR2** de arriba (se referencian, no se duplican).
> Todos anclan en `backend/` salvo el componente de schema de **H4**, que es zona compartida `prisma/`
> → decisión del arquitecto (pero la entrada de deuda vive aquí porque el código es de backend).

##### H2 · Andamiaje de idempotencia copypasteado en 4 copias (sin helper compartido)
- **Dueño:** backend. **Severidad:** Baja (aceptada). **Valor:** mayor a mediano plazo.
- **Deuda:** el andamiaje `fast-path → claim-first → P2002 → replay` (más el `replayX` que castea
  `resultJson`) está **copypasteado en 4 copias** — `batchCreate`, `adjustFound`, `bulkRemove`,
  `publishAll` — sin un helper compartido tipo `withIdempotentBatch(kind, key, fn)`. Un cambio de
  semántica obliga a tocar los 4 sitios en sincronía. Ruta: `backend/src/modules/inventory/inventory.service.ts`.
- **No-bloqueante:** la duplicación es **correcta y uniforme** hoy; el riesgo es de **evolución futura**
  (divergencia al editar una copia y no las otras), no de corrección actual.
- **Disparador:** al próximo cambio de semántica de idempotencia por lote, extraer
  `withIdempotentBatch(kind, key, fn)` y hacer que las 4 rutas lo consuman.

##### H3 · Fast-path de replay en `bulkRemove` y `adjustFound` no filtra por `kind` (= parte de BE-BR1)
- **Dueño:** backend. **Severidad:** Baja (aceptada). **Ref:** ver **BE-BR1** arriba.
- **Deuda:** a diferencia de `publishAll` (que valida `existing.kind` → 409 si no coincide), el fast-path
  de `bulkRemove` y `adjustFound` **no filtra por `kind`** antes de hacer replay, y castea `resultJson` a
  un tipo potencialmente ajeno (cross-replay teórico). Ruta: `inventory.service.ts`.
- **No-bloqueante:** riesgo práctico **despreciable** — los prefijos de key son disjuntos
  (`qrem`/`qadd`/`adj`/`puball`…) y no hay ruta de header `Idempotency-Key` en bulk-remove.
- **Disparador:** al endurecer la familia de idempotencia (junto con H4/BE-BR1), verificar
  `kind === 'bulk_remove'` / `kind === 'adjust'` antes de replay-ear → 409 si no coincide.

##### H4 · `InventoryBatch.kind` es TEXT libre sin enum/CHECK (= BE-BR1; schema → arquitecto)
- **Dueño:** backend + **arquitecto** (el cambio de schema vive en zona compartida `prisma/`). **Severidad:** Baja (aceptada). **Ref:** ver **BE-BR1/BE-BR2** arriba.
- **Deuda:** `InventoryBatch.kind` es `TEXT` libre **sin enum ni `CHECK`**; no hay guardia a nivel BD contra
  un `kind` inválido o una colisión. Endurecer a enum Prisma / `CHECK` **y** filtrar por `kind` en el
  fast-path (H3). Ruta: `backend/prisma/schema.prisma` + `inventory.service.ts`.
- **Cambio de schema → arquitecto:** modificar `prisma/schema.prisma` es zona compartida; **la decisión de
  migrar a enum/CHECK es del arquitecto** (regla 9). La entrada de deuda vive en TECH_DEBT porque el código
  (`inventory.service.ts`) es de backend.
- **No-bloqueante:** la idempotencia **funciona hoy** sobre `TEXT`; la falta de guardia de BD no rompe nada
  con los `batchKey` UUID por-operación que genera el cliente.

##### H5 · `replayBulkRemove` / `replayAdjustment` hacen blind-cast de `resultJson` (sin validar shape ni versión)
- **Dueño:** backend. **Severidad:** Baja (aceptada).
- **Deuda:** `replayBulkRemove` y `replayAdjustment` hacen **blind-cast** de `resultJson` sin validar el
  shape ni una versión; si el shape de respuesta evoluciona, los batches viejos **replayarían una forma
  stale en silencio**. Rutas: `inventory.service.ts` (~1676-1679 y ~1402-1405).
- **No-bloqueante:** el shape de respuesta es **estable hoy**; no hay migración de forma en vuelo.
- **Disparador:** al cambiar el shape del `resultJson`, versionar el payload y validar (o rechazar) shapes
  previos en el replay.

##### H6 · `exportInventoryXlsx` hace `findMany` sin cota ni streaming (workbook en memoria)
- **Dueño:** backend. **Severidad:** Baja (aceptada). **Valor:** mayor a mediano plazo.
- **Deuda:** `exportInventoryXlsx` hace un `findMany` **sin cota ni streaming** y arma el workbook completo
  **en memoria** (todo el inventario). Escala mal conforme crece el inventario (memoria/latencia). Ruta:
  `inventory.service.ts` (~1697-1781).
- **No-bloqueante:** el **volumen actual está OK**; no es un problema a la escala presente.
- **Disparador:** al crecer el inventario (o ante presión de memoria en el export), paginar/streamear la
  consulta y escribir el workbook por chunks.

##### H7 · El filtro `setId` del export no se valida (devuelve export vacío en silencio) — RESUELTO (2026-08-22, v1.36 P-35)
- **Dueño:** backend. **Severidad:** Baja (aceptada). **Estado:** **RESUELTO**.
- **Deuda (histórica):** el filtro `setId` del export **no se validaba**: un `setId` inexistente devolvía un
  **export vacío en silencio**, inconsistente con `publishAll`/bulk-ops que responden **400** ante un `setId`
  desconocido. Rutas: `inventory.controller.ts` / `inventory.service.ts`.
- **Fix:** `exportInventoryXlsx` valida el `setId` contra `CardSet` ANTES de consultar; un id desconocido →
  **`400 VALIDATION_ERROR`** (paridad con `publishAll`/bulk-ops), sin llegar a barrer el inventario. Tests:
  `test/inventory.export-xlsx.spec.ts` («H7 · setId inexistente → 400» + «setId existente aplica el filtro»).

##### H8 · `workbook.creator = 'TCG HUNT'` — marca obsoleta en la metadata del `.xlsx` — RESUELTO (2026-08-22, v1.36 P-35)
- **Dueño:** backend. **Severidad:** Baja (aceptada). **Estado:** **RESUELTO**.
- **Deuda (histórica):** `workbook.creator = 'TCG HUNT'` grababa una **marca obsoleta** en la metadata del
  `.xlsx`. Ruta: `inventory.service.ts`.
- **Fix:** `workbook.creator = 'TCG Vault MX'` (marca **vigente** del proyecto, PROJECT.md «Nombre comercial /
  marca: TCG Vault MX»). Test: `test/inventory.export-xlsx.spec.ts` («H8 · workbook.creator = TCG Vault MX»).

#### QA-BR1 (hallazgo MENOR de QA) · el test de bulk-remove no ejercita el rollback real del claim
- **Dueño:** backend. **Severidad:** Baja (aceptada, cobertura de test).
- **Deuda:** el test `inventory.bulk-remove.spec.ts` «un fallo no quema el batchKey» **no prueba el rollback
  real** porque la `$transaction` está **mockeada**; el caso no ejercita la reversión del claim tras un
  `INSUFFICIENT_STOCK`. Rutas: `backend/test/inventory.bulk-remove.spec.ts` + e2e.
- **No-bloqueante:** el comportamiento en producción es correcto; falta cobertura de integración real.
- **Disparador:** asegurar que el **e2e con BD real** ejercite el rollback del claim tras `INSUFFICIENT_STOCK`
  (que el `batchKey` no quede quemado tras el fallo transaccional real).

### Deuda del pase P-30 grouped-listings (v1.38, cluster «Catálogo y precios» — hallazgos techlead, no bloqueante, aceptada)

> Pase `v1.38-grouped-listings` (2026-08-22): agrupación en LECTURA de las publicaciones de Compra por
> `K = (cardId, productType, gradeKey, finish)` (ARCHITECTURE §4.9a). Gate: **QA APROBADO + techlead
> APROBADO CON DEUDA**. Los cuatro hallazgos H1–H4 del techlead se registran aquí. Ninguno es de dinero:
> el cobro real se re-cotiza siempre por `inventoryItemId` (el precio del grupo es un PISO informativo).

#### H1 · `GroupedListingDTO.salePriceCents` colisiona en nombre y diverge de la semántica «desde» del sellado (toca contrato → arquitecto)
- **Dueño:** backend (**solicita al arquitecto** — el fix toca `docs/API_CONTRACT.md`, zona compartida, regla 9). **Severidad:** Baja (aceptada). **Estado:** **PENDIENTE-DE-ARQUITECTO**.
- **Deuda:** `GroupedListingDTO.salePriceCents` (precio del grupo = **mínimo** del grupo, un PISO «desde»)
  **colisiona en nombre** con `ListingDTO.salePriceCents`, que es el precio **EXACTO por-pieza**, y **diverge**
  del homólogo `SealedGroupDTO.fromPriceCents`, que sí nombra la semántica «desde». Un consumidor del contrato
  puede leer el precio del grupo como si fuera exacto. Rutas: `backend/src/modules/catalog/catalog.service.ts`
  (DTO de `buildGroups`) + `docs/API_CONTRACT.md` §DTOs.
- **Toca contrato → solicitud al arquitecto (regla 9):** alinear nombre/semántica del campo (p. ej.
  `fromPriceCents` como en el sellado, o un nombre que marque el PISO). **Backend NO ejecuta el rename por su
  cuenta** — la decisión del nombre/forma del DTO es del arquitecto; esta entrada queda como solicitud abierta.
- **No-bloqueante (money-safe):** no hay fuga de dinero — el cobro real se **re-cotiza por `inventoryItemId`**
  en checkout; el precio del grupo es solo un piso de presentación. El defecto es de **consistencia
  transversal** del contrato, no de corrección monetaria.
- **Disparador:** cuando el arquitecto alinee el naming de precios de grupo en el contrato; backend renombra
  el campo del DTO de `buildGroups` en el mismo pase.

#### H2 · La clave `K = (cardId|productType|gradeKey|finish)` está hand-rolled (riesgo de drift) — RESUELTO COMPLETO (2026-08-23)
- **Dueño:** backend. **Severidad:** Baja (aceptada). **Valor:** mayor a mediano plazo. **Estado:** **RESUELTO COMPLETO** (ya no parcial).
- **Fix parcial (2026-08-23, consumidores):** extraído el helper único `variantKey({cardId, productType, gradeKey, finish})` en
  `backend/src/common/variant-key.ts` (produce EXACTAMENTE el mismo string `cardId|productType|gradeKey|finish`)
  y reusado en los **3 CONSUMIDORES** de `catalog.service.ts` (`variantOverride` en `fetchSellable`, `refFromBatch`,
  `buildGroups`).
- **Cierre COMPLETO (2026-08-23, productores + eje sellado):** los **PRODUCTORES** de esos mismos mapas ahora también
  llavean con `variantKey` — antes seguían con la interpolación hand-rolled, partiendo la fuente de drift en dos:
  - `pricing.service.ts` `getReferencesBatch` (`keyOf`), `getVariantOverridesBatch` (`keyOf`) y el lookup single de
    `getVariantOverride` → los 3 enrutados a `variantKey(...)` importado de `../../common/variant-key`.
  - Eje SELLADO de `catalog.service.ts` (`refFromBatch` `:197`): el `refs.get(`${cardId}|sealed|${gk}|normal`)`
    hand-rolled pasó a `variantKey({cardId, productType:'sealed', gradeKey:gk, finish:'normal'})`.
  Byte-identidad verificada: `variantKey` produce EXACTAMENTE el mismo string, así que no se pierde ninguna
  referencia/override (money-safe: es clave de map, un cambio de formato corrompería precio).
- **Guard de round-trip (nuevo):** además del test del helper, `backend/test/tech-debt-backend.spec.ts` ejercita el
  `PricingService` REAL (prisma mockeado): la fila que `getReferencesBatch`/`getVariantOverridesBatch` INDEXA en el
  Map se recupera con `variantKey(mismas partes)` (lo que hace el consumidor) → se encuentra. Es el invariante que
  de verdad protege contra el drift: **productor y consumidor comparten la misma fuente `variantKey`**, no solo que
  el helper produzca X. Incluye el eje sellado. *(Nota: SB-D3 = otros ≥6 sitios hand-rolled en `buylist`/`inventory`/
  `admin`/`vault`/`sealed-graded` — de OTROS módulos/streams — quedan FUERA de este ítem; siguen byte-idénticos y no
  se rompen. Su migración es su propia entrada.)*
- **Deuda:** la clave `K` = `${cardId}|${productType}|${gradeKey}|${finish}` está **escrita a mano en 3
  sitios** de `catalog.service.ts`: `~L177` (`variantOverride` en `fetchSellable`), `~L191` (`refFromBatch`) y
  `~L429` (`buildGroups`). Si la definición de `K` cambia (orden de campos, separador, componentes), hay que
  tocar los 3 en sincronía o se produce **drift silencioso** (un grupo llaveado distinto de su override/ref).
  Ruta: `backend/src/modules/catalog/catalog.service.ts`.
- **No-bloqueante:** las 3 copias son **idénticas y correctas hoy**; el riesgo es de **evolución futura**.
- **Disparador:** al próximo cambio de la forma de `K`, extraer un helper único `variantKey(item)` en
  `pricing`/`common` y hacer que los 3 sitios lo consuman.

#### H3 · Duplicación del andamiaje agrupar→ordenar→paginar y de `validateEnum` entre `CatalogService` y `SealedCatalogService`
- **Dueño:** backend. **Severidad:** Baja (aceptada). **Valor:** mayor a mediano plazo.
- **Deuda:** el andamiaje **agrupar → ordenar → paginar** sobre grupos, y el helper `validateEnum`, están
  **duplicados** entre `CatalogService` y `SealedCatalogService` (`validateEnum` aparece **verbatim** en
  ambos). Un cambio de semántica obliga a tocar los dos servicios en sincronía. Rutas:
  `backend/src/modules/catalog/catalog.service.ts` + `backend/src/modules/catalog/sealed-catalog.service.ts`.
- **No-bloqueante:** las copias son **correctas y uniformes hoy**; el riesgo es de **divergencia futura**.
- **Disparador:** al próximo cambio del andamiaje, extraer `sortAndPaginateGroups` / `groupBy` genéricos y
  mover `validateEnum` a `common/`, y hacer que ambos servicios los consuman.

#### H4 · Faltaban 2 tests de regresión de grupos (precio divergente + sort/paginación) — RESUELTO (2026-08-22)
- **Dueño:** backend. **Severidad:** Baja (aceptada, cobertura de test). **Estado:** **RESUELTO**.
- **Deuda (histórica):** faltaban 2 tests de regresión sobre la agrupación de `buildGroups`: (a) grupo con
  `listPriceCents` manual **divergente** en la misma `K` (el grupo muestra el mínimo como representante y
  **todas** las piezas aparecen en `units[]`, cheapest-first) y (b) **sort + paginación** sobre grupos
  (`price_asc`/`price_desc`, `total = nº de grupos`, sin repetir ni saltar grupos entre páginas).
- **Fix:** añadidos en `backend/test/catalog.spec.ts` — «H4 · precio de grupo con `listPriceCents` divergente
  en la misma K» (grupo = mínimo, `units[]` completo cheapest-first) y «H4 · sort + paginación sobre grupos»
  (price_asc/desc correctos, `total` = nº de grupos, cobertura completa sin duplicados entre páginas).

> **Hallazgos de FRONTEND del pase P-30 (storefront).** IDs `FE-1`/`FE-2` **acotados a este pase P-30**
> (no confundir con el `FE-1`/`FE-2` histórico del makeover más abajo en este documento). Dueño **frontend**.

#### FE-1 (P-30 storefront) · Regresión visual: el badge de singles con stock 1 pintaba «Último» en vez de «Queda 1» — RESUELTO (2026-08-22)
- **Dueño:** frontend. **Severidad:** Baja (regresión visual, no dinero). **Estado:** **RESUELTO**.
- **Deuda (histórica):** la adaptación P-30 conectó las tejas de **singles** (catálogo, gradeadas, Home,
  detalle) a `stockVariantFromCount(count)`, que mapea `count===1 → 'lastUnit'` («Último», muted). Ese
  mapeador es el del **sellado**. El rediseño (DS §20.6) manda para singles con 1 pieza la variante
  `unique` («Queda 1», accent): con el modelo agrupado de P-30, `stockCount===1` = «1 disponible ahora
  mismo» (no «última de varias»). La regresión dejó **huérfana** la variante `unique` + la clave
  `stock.lastOne` y contradecía el docstring de `CatalogView` (que sigue prometiendo «Queda 1»).
- **Fix:** nuevo mapeador `stockVariantForSingle(count)` en `StockBadge.tsx` (`0→soldOut`, `1→unique`,
  `N≥2→count`); las tejas de singles (`CatalogTile`, `GradedShelf`, `FeaturedCarousel`, `CardDetailView`)
  lo consumen. El sellado (`SealedShelf`, `SealedShopView`, `SealedDetailView`) mantiene
  `stockVariantFromCount` (`1→lastUnit`) — DS §20.6 reserva «Último» **para sellado**. Resultado:
  `unique`/`stock.lastOne` des-huérfanos **y** `lastUnit`/`stock.lastUnit` conservados (sin huérfanos en
  ninguna dirección). Test `_shared/StockBadge.test.tsx` afirma `stockCount===1 → «Queda 1»` (unique) y el
  contraste con sellado (`→ «Último»`). Suites (593) + `tsc` + `next build` verdes.

#### FE-2 (P-30 storefront) · Los singles agrupados no comunican «desde» mientras el sellado sí (gatillada por backend H1)
- **Dueño:** frontend. **Severidad:** Baja (aceptada, consistencia de presentación — no dinero). **Estado:** **PENDIENTE (bloqueada por H1/arquitecto)**.
- **Deuda:** en el modelo agrupado, el precio del grupo de singles es un **PISO «desde»** (el mínimo del
  grupo), pero la teja lo pinta como cifra pelada, mientras el **sellado** sí comunica la semántica «desde»
  (`fromPriceCents` + «sin IVA»). Asimetría de presentación entre familias equivalentes.
- **No-bloqueante (money-safe):** no hay fuga de dinero — el cobro real se re-cotiza por `inventoryItemId`
  en checkout; es solo consistencia de UI.
- **Disparador:** depende del backend **H1** (rename `GroupedListingDTO.salePriceCents → fromPriceCents`,
  que **pasa por el arquitecto**, regla 9, zona compartida `docs/API_CONTRACT.md`). Cuando el contrato
  alinee el naming, el frontend reflejará en singles el mismo trato «desde»/sin IVA que el sellado, al
  menos cuando `stockCount>1` (con `stockCount===1` la teja ya dice «Queda 1» y «desde» pierde sentido).
  Ruta: `frontend/src/app/[locale]/(storefront)/catalog/CatalogTile.tsx` (+ tejas de singles homólogas).

### CI-1 · CI en rojo por tests env-sensibles (REDIS_URL) — RESUELTO (2026-08-16)
- **Dueño:** backend. **Estado:** **RESUELTO** (solo cambio de tests; producción intacta).
- **Síntoma:** el job `backend` del workflow **CI** estaba en rojo en **toda la historia** del repo
  (no es regresión de Ronda C): **2 tests fallaban / 348 pasaban**. Verde en local/qa.
- **Causa raíz:** CI levanta un contenedor Redis y **exporta `REDIS_URL`**. Dos suites afirmaban
  comportamiento "sin Redis" leyendo la variable con `ConfigService.get('REDIS_URL')`, que **cae a
  `process.env`** → fuga de entorno. Afectadas: `test/health-redis.provider.spec.ts` («sin REDIS_URL:
  resuelve a null») y `test/scheduler.spec.ts` («sin REDIS_URL: onModuleInit es no-op», gating BE-5/v15-D1).
- **Fix:** aislar `process.env.REDIS_URL` (guardar/borrar en `beforeEach`, restaurar en `afterEach`) en el
  bloque que ejerce el caso "sin REDIS_URL". Sin tocar `health-redis.provider.ts` ni `scheduler.service.ts`
  (el bug estaba en el test, no en el gating). Verificado con y sin `REDIS_URL`: **56 suites / 350 tests
  verdes** en ambos; `lint`/`typecheck`/`build` verdes. Detalle en `BACKEND_NOTES.md §28`.
- **Nota de alcance:** los workflows **Security SAST**, **E2E** y **deploy.yml** siguen fallando por causas
  de **infra/secrets separadas** (dueño **devops/humano**) — fuera del alcance de este fix de backend.

### E2E-1 · Seed E2E no idempotente (doble siembra + estado no reseteado) — RESUELTO (2026-08-16)
- **Dueño:** backend. **Estado:** **RESUELTO** (solo `backend/prisma/seed-e2e.ts` + `backend/package.json`;
  producción intacta, ningún endpoint tocado).
- **Síntoma:** el gate **backend-e2e** (`npm run test:integration`) fallaba. Postgres del runner registraba
  `duplicate key ... "ProcessedStripeEvent_pkey" (id)=(evt_e2e_succeeded_fixed)` y
  `... "User_email_key" (email)=(customer@e2e.local)` **durante** el `jest`.
- **Causa raíz — dos capas:**
  1. **Doble siembra:** `test:integration` corría `npm run seed:synthetic` **standalone** ANTES de `jest`, y
     además **cada** uno de los 5 `*.e2e-spec.ts` vuelve a llamar `seedE2E()` en su `beforeAll` → 6 siembras
     por corrida (redundancia). Los dos `ERROR` de Postgres citados son, en una corrida única, **P2002
     capturados por diseño**: `auth.service.ts:111` (test "rechaza email duplicado" → 409 `EMAIL_TAKEN`) y
     `payments.service.ts:44` (guard de idempotencia del webhook, test "es IDEMPOTENTE reenvía event.id") —
     benignos, no son el fallo.
  2. **Idempotencia CROSS-RUN rota (fallo real):** `seed-e2e.ts` reseteaba estado transaccional **por
     userId** (orders/shipments/sellRequests/disputes/kyc) pero **NO** el estado E2E que no cuelga de userId:
     `ProcessedStripeEvent` (id `evt_e2e_succeeded_fixed`) ni `InventoryMovement` de piezas de **plataforma**.
     En una **2ª corrida** sobre la misma DB, `evt_e2e_succeeded_fixed` ya existía → el webhook hacía no-op →
     la orden **no** liquidaba (test "el webhook FIRMADO liquida la orden" fallaba); y los movimientos `settle`
     previos hacían que el assert `settleMovements === 1` contara 2+.
- **Fix:**
  1. Se quitó la siembra **standalone** redundante de `test:integration` (ahora `prisma migrate deploy && jest
     ...`); la siembra queda como **única fuente** en el `beforeAll` de cada spec (`seedE2E`). El script
     `seed:synthetic` (usado por `scripts/seed-synthetic.sh`/CI staging) **se conserva**.
  2. `seedE2E` ahora es **idempotente cross-run**: además del reset por-usuario, borra en el paso 3b los
     `InventoryMovement` de los ítems E2E (por `folio IN E2E_FOLIOS`) y los `ProcessedStripeEvent`
     (`evt_e2e_succeeded_fixed` + prefijo `evt_e2e`). Todos los fixtures con clave única ya usaban `upsert`
     (revisado el seed completo: ConfigSetting, User, VaultLocation, CardSet, Card, PriceReference,
     InventoryItem; Address ya iba con guard `findFirst`). Correr `test:integration` DOS veces seguidas sobre
     la misma DB ya no rompe.
- **Verificación (gates sin infra):** `lint` OK, `typecheck` OK, `build` OK, `npm test` **57 suites / 372
  tests** verdes. El **verde de E2E lo confirma el runner** (egress local bloquea el pull de imágenes Docker
  de los services). Detalle en `docs/BACKEND_NOTES.md`.

#### E2E-1-bis · La idempotencia de 2026-08-16 era **intra-día**: dos agujeros más — RESUELTOS (2026-08-29, v1.50.3-e)
- **Dueño:** backend. **Estado:** **RESUELTO** (solo `backend/prisma/seed-e2e.ts` + suites; producción intacta).
- **Por qué se reabre la entrada:** el fix de E2E-1 afirmaba «correr `test:integration` DOS veces seguidas
  sobre la misma DB ya no rompe», y era cierto **el mismo día**. QA (BLOQ-A, gate de v1.50.3-d) encontró dos
  casos que el criterio no cubría, y los dos hacen que **el arnés se rompa por su propia operación**:
  1. **Entre DÍAS:** la `@@unique` de `PriceReference` incluye `capturedDate` y el seed «actualizaba la fila
     del día» ⇒ sembrar hoy sobre una BD sembrada ayer **insertaba** una segunda fila de la misma clave
     lógica (el fixture del slab acababa con dos `graded:PSA:10` y el criterio 8 fallaba en la 2ª corrida).
  2. **Estado sin `userId`:** los **pedidos de invitado** (v1.21/M-25) no los alcanzaba ningún reset
     por-usuario y se acumulaban sin límite; al pasar de 100 envíos `picking` históricos, el tope duro de
     paginación de `GET /admin/shipments` dejó fuera al envío recién creado y el caso de la cola de M4 de
     `guest-checkout.e2e-spec` empezó a fallar solo en máquinas con historial.
- **Fix:** `PriceReference` de las cartas del fixture pasa a **borra-y-declara transaccional**, y el seed
  resetea pedidos/envíos de invitado del dominio reservado `@example.com`. Detalle en
  `docs/BACKEND_NOTES.md` §0.9.
- **Lección que sí es deuda de PROCESO (no de código):** en CI la BD es **efímera**, así que esta familia
  entera sale **verde siempre** y solo muerde a quien verifica en local. Por eso ahora existe un test que la
  vigila explícitamente: `backend/test/integration/seed-idempotency.e2e-spec.ts`. Cualquier estado nuevo del
  arnés que **no cuelgue de `userId`** o que dependa de **la fecha** debe entrar ahí a la vez que al seed.

### BE-1 · La recompra de disputa no ejecuta reembolso Stripe real — RESUELTA/OBSOLETA
- **Dónde:** `src/modules/disputes/disputes.service.ts` → `resolve(resolution='repurchase')`.
- **Estado actual (2026-08-13):** **resuelta.** Con la política de **VENTAS FINALES**, la recompra por
  disputa **ya NO revierte el item al inventario** — el cliente **conserva la carta**. El remedio ahora
  **compensa dinero al cliente** (money-out) por el precio de recompra y queda **auditado**, con
  idempotencia; ya no se mueve a mano ni queda solo como texto en `resolution`.
- **Nota:** entrada conservada como registro histórico. El supuesto original ("revierte el item al
  inventario" + "solo registra el remedio, sin mover dinero") es **obsoleto**: la política correcta ya
  está implementada. Ya no aplica como deuda técnica.

### BE-2 · TOCTOU en operaciones que aún no son atómicas
- **Dónde:** `buylist.service.ts` → `convertToInventory` (check `inventoryItemId` + create), asignación de
  item a envío (`shipments.service.ts` → chequeo "en otro envío" + create), y el **tope mensual** de
  buylist (`createRequest`: lee `monthUsedCents` y luego crea, sin candado).
- **Estado actual:** son check-then-act no transaccionales; dos peticiones concurrentes podrían
  doble-convertir un `SellRequestItem`, meter un item en dos envíos, o exceder ligeramente el tope mensual.
- **Impacto:** medio. Requiere concurrencia real del mismo recurso (poco probable con un admin operando en
  serie en el MVP), pero puede producir un item duplicado en inventario o un rebase del tope.
- **Disparador:** cuando haya más de un operador concurrente, o antes de automatizar buylist. Solución:
  `unique constraint` (p. ej. `SellRequestItem.inventoryItemId` único; `ShipmentItem.inventoryItemId`
  único sobre envíos activos) y/o transacción con `updateMany`+count como ya se hizo en checkout (#1).
- **Nota (2026-08-29, v1.50.3-e):** el caso hermano que QA marcó como MEN-C —la guarda INV-D del `DELETE`
  de estimados corriendo fuera de la transacción— **ya no aplica**: la guarda se repite **dentro** de la
  transacción antes de borrar (`publishedSlabsForGradeKey` acepta el cliente transaccional). Los tres casos
  de arriba siguen abiertos.

### BE-3 · `buylist-sweep` a 30 días marca `abandonada` pero no convierte a inventario
- **Dónde:** `src/jobs/buylist-sweep.service.ts`.
- **Estado actual:** a los 30 días de abandono la solicitud pasa a `abandonada`; **no** ejecuta la
  conversión automática a inventario. Cumple PROJECT criterio 16 solo parcialmente (el 7d→rechazo sí).
- **Impacto:** bajo. Las cartas abandonadas quedan visibles en la cola para que el admin las convierta con
  un clic (`convert-to-inventory`), pero no entran a inventario solas.
- **Disparador:** cuando el volumen de abandonos justifique automatizarlo, o al cablear el scheduler
  (ver BE-5). Solución: en el sweep, tras `abandonada`, invocar la conversión de sus items aprobados.

### BE-4 · N+1 de `getReference` en valuaciones
- **Dónde:** `vault.service.ts` → `holdings`; `admin.service.ts` → `inventoryValue` / `custodyValue`;
  `orders.service.ts` → `salePriceOf` (en bucle de checkout).
- **Estado actual:** por cada item se hace una consulta `PriceReference.findFirst`. Con bóvedas grandes se
  vuelven decenas/cientos de queries por request.
- **Impacto:** rendimiento (latencia del portafolio y de las tarjetas financieras) al crecer el inventario.
  Correctness OK.
- **Disparador:** cuando el portafolio/inventario supere ~unos cientos de items o la latencia de esos
  endpoints moleste. Solución: batch/`IN` de referencias por `(cardId, productType, gradeKey, capturedDate)`
  y map en memoria, o una vista materializada de "última referencia por combinación".

### BE-5 · Scheduling BullMQ de los jobs — RESUELTA (pase P0 jobs de barrido)
- **Dónde:** `src/jobs/scheduler.service.ts` + `src/jobs/admin-jobs.controller.ts`.
- **Estado:** **resuelta.** El scheduler ahora programa **los 7 jobs diarios** repetibles BullMQ
  (`fx-refresh`, `price-sync`, `portfolio-snapshot`, `ine-retention`, `buylist-sweep`, `dispute-deadline`,
  `auth-token-sweep`) con `repeat`+`jobId` single-flight y conexión a `REDIS_URL` (sin Redis queda
  deshabilitado, jobs disparables a mano). Los 4 barridos también son **disparables manualmente** por
  `POST /admin/jobs/*` (super_admin, auditado). Cubierto con tests (`test/scheduler.spec.ts` mockea
  bullmq/ioredis; `test/admin-jobs.controller.spec.ts`). Detalle: `docs/BACKEND_NOTES.md §18.1/§18.2`.
- **Nota:** BE-3 (conversión a inventario del abandono a 30 días en `buylist-sweep`) **sigue diferida** como
  deuda propia; este pase cableó el `run()` **actual** (7d/30d) sin cambiar su comportamiento.

### BE-6 · Providers de precio graded/sealed son stubs
- **Dónde:** `src/modules/pricing/providers/graded-sealed.providers.ts`.
- **Estado actual:** `PokemonPriceTracker`/`PokeTrace` devuelven `null` (sin endpoint/clave confirmados) ⇒
  las cartas gradeadas/selladas caen a **"precio pendiente"** y dependen del **override manual** del admin
  (que sí funciona). El provider de raw (pokemontcg.io) sí hace fetch real.
- **Impacto:** medio para el catálogo de gradeadas/sellado: sin override manual, esas cartas no son
  vendibles automáticamente. No rompe nada (la regla "nunca se descarta" aplica).
- **Disparador:** cuando se contraten/confirmen las credenciales y el contrato de esos proveedores, o al
  subir a plan de pago. Solución: implementar `fetchPrice` real respetando el rate-limit del free tier.
- **v1.44 (2026-08-23):** PokemonPriceTracker **ya está contratado** y el «gancho de grading» necesita sus
  valores PSA. El **paso 0** para cerrar esta deuda por la vertiente PSA es **`BE-GE1`** (instrumentación de
  fase 2): sin ella la observación de staging da un **falso negativo** y no hay evidencia del payload con la
  que implementar el `fetchPrice` real. Ver `BE-GE1` al final de esta sección.
- **v1.50.2 (2026-08-28) — el paso 0 YA ESTÁ HECHO por la vertiente PSA:** el truncate del log está en 4000,
  `includeEbay=true` se pide, y el **parser auto-confirmante** de §4.38h escribe los estimados PSA sin
  suposiciones. Lo que sigue abierto de BE-6 es el `fetchPrice` **per-carta** de graded/sealed (otro camino),
  y el **riesgo de proveedor único** queda registrado aparte en **`BE-GE3`**.

### BE-7 · Orden `pending` huérfana si Stripe falla tras confirmar la reserva
- **Dónde:** `src/modules/orders/orders.service.ts` → `createSession` (crea Order+reserva en tx, luego
  llama a Stripe fuera de la tx).
- **Estado actual:** si `createPaymentIntent` falla **después** de commitear la reserva, la Order queda
  `pending` y los items `reserved` sin `PaymentIntent` asociado, sin compensación automática.
- **Impacto:** bajo pero real: items "atascados" en `reserved` que no se liberan solos (no hay
  `payment_failed` porque nunca hubo PI). Requiere intervención manual o un barrido.
- **Disparador:** al endurecer el flujo de pago para producción. Solución: `try/catch` alrededor de Stripe
  que revierta la reserva (items→`listed`, Order→`failed`) si falla la creación del PI, y/o un job de
  expiración de reservas `pending` sin PI tras N minutos.

### BE-8 · CORS `origin: true` en `main.ts` — RESUELTA/OBSOLETA
- **Dónde:** `src/main.ts` → `enableCors`.
- **Estado:** **resuelta.** Ya **no** usa `origin: true`. `resolveCorsOrigins()` construye una **allow-list**
  desde `APP_BASE_URL` (lista separada por comas) con `credentials: true`; fallback seguro a orígenes de dev
  local (`http://localhost:3000`, `:5173`) — **nunca** un comodín ni reflejo de origen arbitrario. En
  staging/prod `APP_BASE_URL` DEBE fijarse (coordinado con devops). Entrada conservada como registro
  histórico; ya no aplica como deuda.

### Deuda del pase v1.1 (hallazgos QA/techlead sobre alcance v1.1)

> Del lote de fixes v1.1: **D4 y D5 quedaron RESUELTAS** en este mismo pase (ver más abajo). **D1, D2 y
> D3** se registran aquí como deuda aceptada no bloqueante.

### D1 · Sync de catálogo M2 es síncrono con `jobId` ficticio (falta cola BullMQ)
- **Dónde:** `src/modules/catalog/catalog-sync.service.ts` (`POST /admin/catalog/sync`,
  `POST /admin/catalog/backfill`) y su controlador admin.
- **Estado actual:** la ingesta desde pokemontcg.io se ejecuta **en el propio request** y devuelve un
  `jobId` **fabricado** (no hay worker/cola real detrás). El contrato §M2 modela `sync` como `202 { jobId }`
  (asíncrono), pero hoy la operación es efectivamente síncrona.
- **Impacto:** medio. Un set grande o un backfill amplio puede exceder el timeout HTTP y no respeta el
  rate-limit del free tier vía cola (ARCHITECTURE §4.8 pide BullMQ). El `jobId` no es consultable.
- **Disparador:** antes de poblar el catálogo a escala (backfill de colecciones antiguas) o al cablear el
  scheduler (BE-5). Solución: encolar la ingesta en BullMQ (misma cola con rate-limit), persistir el estado
  del job y devolver un `jobId` real consultable.

### D2 · `PokemonTcgIoClient.getSets()` sin paginación (trunca > 250 sets)
- **Dónde:** `src/modules/catalog/pokemontcg-io.client.ts` → `getSets()` (usado por `remote-sets`,
  `sync` sin `setId` y `backfill`).
- **Estado actual:** hace una sola llamada a `/v2/sets` con el `pageSize` por defecto de la API (250). Al
  superar los 250 sets existentes en pokemontcg.io, **la lista queda truncada** y los sets más allá de la
  primera página no se ven/importan/backfillean.
- **Impacto:** medio a futuro. Hoy pokemontcg.io ronda ese umbral; en cuanto lo cruce, `remote-sets` y el
  cálculo de `remaining`/`newBoundary` del backfill se vuelven incompletos silenciosamente.
- **Disparador:** cuando el total de sets remotos supere 250 (o al implementar D1). Solución: iterar
  `page`/`pageSize` hasta agotar `totalCount`, acumulando todas las páginas.

### D3 · N+1 de snapshot/holdings en `PricingService.getReference` (portafolio)
- **Dónde:** `src/modules/vault/vault.service.ts` → `holdings()` y el job `portfolio-snapshot`, que llaman
  `PricingService.getReference` por cada holding.
- **Estado actual:** una consulta de `PriceReference` por item; con bóvedas grandes son decenas/cientos de
  queries por request/snapshot. (Es la misma familia que BE-4, acotada aquí al camino de portafolio/gráfica
  de tendencia v1.1.)
- **Impacto:** rendimiento de "Mi bóveda" y del snapshot diario al crecer el inventario del usuario.
  Correctness OK.
- **Disparador:** cuando un usuario supere ~cientos de holdings o el snapshot diario se vuelva lento.
  Solución: batch de referencias por `(cardId, productType, gradeKey, capturedDate)` con un `IN` y map en
  memoria, reutilizado por `holdings()` y el job.

### D4 · Exponer `stripeFeeIvaPct` en el DTO de settings — RESUELTA (pase v1.1)
- **Dónde:** `src/modules/settings/settings.constants.ts` → `SETTING_DTO_MAP`.
- **Estado:** **resuelta.** El contrato §M10 ya listaba `stripeFeeIvaPct` en el DTO de `GET/PUT
  /admin/settings`, pero faltaba en `SETTING_DTO_MAP`. Se añadió con su validador de rango (fracción
  `[0,1)`) y se cubrió con tests (`test/settings.validation.spec.ts`: lectura vía `getAllDto` +
  actualización). Ya no es deuda.

### D5 · Enumeración por temporización en login — RESUELTA (pase v1.1)
- **Dónde:** `src/modules/auth/auth.service.ts` → `login`.
- **Estado:** **resuelta.** Antes retornaba temprano (401) si el usuario no existía o si `passwordHash`
  era null, dejando un canal de temporización (el comentario prometía una mitigación ausente). Ahora se
  ejecuta **siempre** `argon2.verify` — contra un **hash dummy fijo precomputado** cuando no hay
  usuario/`passwordHash` null — para igualar la latencia; se mantiene `401 INVALID_CREDENTIALS` y el caso
  Google intacto. Cubierto con tests (`test/auth.login-timing.spec.ts`). Ya no es deuda.

### Deuda del pase correo v1.5 (hallazgos seguridad — Baja, aceptada)

> Del pase de **feature de correo v1.5** (verificación + reset por email). Los hallazgos **S15-B1**
> (escape de HTML en plantillas) y **S15-B4** (revalidar `status` en reset) se **cerraron** en este
> mismo pase y **no** figuran como deuda. Lo de abajo es la deuda **Baja aceptada** que seguridad
> autorizó a diferir. IDs prefijados `v15-` para no colisionar con la D1–D3 del pase v1.1 (arriba).

### v15-D1 · `auth-token-sweep` sin disparador automático — RESUELTA (pase P0 jobs de barrido)
- **Dónde:** `src/jobs/auth-token-sweep.service.ts` + `src/jobs/scheduler.service.ts`.
- **Estado:** **resuelta.** `auth-token-sweep` (junto con `buylist-sweep`, `dispute-deadline`,
  `ine-retention`) ya está cableado como job repetible BullMQ en el scheduler (`repeat` + `case` en el worker,
  cron diario `15 8 * * *`) y también es disparable a mano por `POST /admin/jobs/auth-token-sweep`
  (super_admin, auditado). La tabla `AuthToken` ya se poda sola cuando hay `REDIS_URL`. Ver BE-5 arriba y
  `docs/BACKEND_NOTES.md §18`. Nota v15-D2 (claim-luego-lectura no transaccional en `consume`) sigue como
  deuda propia: al activarse el sweep conviene envolver claim+lectura en tx (ver v15-D2).

### v15-D2 · `AuthTokenService.consume`/`ownerOf`: claim-luego-lectura no transaccional
- **Dónde:** `src/modules/auth/auth-token.service.ts:53-65` (`consume`) y `:68-75` (`ownerOf`).
- **Estado actual:** `consume` hace `updateMany` (claim atómico de `usedAt`) y **después** un `findUnique`
  para leer el `userId`; los dos pasos no van en una transacción. Si un **sweep** (v15-D1) borrara la fila
  justo entre ambos pasos, el `findUnique` devolvería `null` y el flujo daría un **422 espurio** (token
  "inválido") pese al claim exitoso. Ventana **teórica**: hoy no hay sweep corriendo (v15-D1) y las filas
  no se borran, así que no se materializa.
- **Impacto:** bajo. A lo sumo un 422 espurio ocasional que el usuario resuelve reintentando; nunca fija
  contraseña ni verifica de más (el claim ya ocurrió; el peor caso es no-progreso, no un bypass).
- **Disparador:** al activar el sweep (v15-D1) o si aparece el 422 espurio en producción. Solución: envolver
  claim+lectura en `$transaction`, o **retornar el `userId` en el mismo `updateMany`** (p. ej. `UPDATE ...
  RETURNING userId` vía `$queryRaw`) para eliminar la segunda lectura.

### v15-D3 · Rate-limit de correos por conteo en BD (`countIssuedLastHour`) es TOCTOU
- **Dónde:** `src/modules/auth/auth-token.service.ts:78-82` (`countIssuedLastHour`), usado por
  `resendVerification` y `forgotPassword` (tope 3/h/usuario).
- **Estado actual:** el tope se evalúa leyendo un `count` y luego emitiendo; una **ráfaga concurrente**
  podría leer el mismo valor y superar el límite de 3 (p. ej. emitir 4-5). **Acotado** por el `@Throttle`
  por IP del controller (`auth.controller.ts`: 3/h en forgot, 10/h en resend) que limita la tasa de entrada.
- **Impacto:** bajo. En el peor caso, unos pocos correos extra por hora a la **propia** dirección del
  usuario; no es amplificación hacia terceros (el correo va al dueño de la cuenta).
- **Disparador:** fase 2 / storage compartido del throttler. Solución: mover el conteo a **Redis** con
  `INCR`+`EXPIRE` atómico (o `updateMany` con guardia), en línea con la migración del throttler a Redis (§5 NOTES).

### v15-S15-B2 · Enumeración por timing en forgot-password (await del envío solo si el email existe)
- **Dónde:** `src/modules/auth/auth.service.ts` → `forgotPassword` (el `await mail.sendPasswordReset`
  ocurre **solo** dentro de la rama `user && status===active`).
- **Estado actual:** la respuesta es genérica `200 { ok:true }` siempre (no revela existencia por el
  cuerpo), pero el **tiempo de respuesta** difiere: cuando el email existe se hace trabajo extra
  (emitir token + enviar correo) que un atacante podría medir para inferir cuentas registradas.
  **Mitigado** por el rate-limit (3/h + `@Throttle` IP) que hace inviable un barrido masivo por timing.
- **Impacto:** bajo. Canal lateral de enumeración de baja señal, muy ruidoso por el jitter del envío SMTP.
- **Disparador:** si se endurece el modelo anti-enumeración. Solución: enviar el correo **fuera del ciclo
  de respuesta** (encolar y responder de inmediato) o **igualar el trabajo** en ambas ramas (trabajo dummy
  equivalente cuando el email no existe), como ya se hizo con el hash dummy del login (D5).

### v15-S15-B3 · Token de reset/verificación viaja en la URL (Referer/historial del navegador)
- **Dónde:** `src/modules/auth/auth.service.ts` → `buildFrontendLink` (`?token=<claro>` en el link del correo).
- **Estado actual:** el token va como query param del enlace, por lo que puede quedar en el **historial**
  del navegador y filtrarse por cabecera `Referer` a recursos de terceros cargados en la página de destino.
  **Mitigado** por **single-use** (`consume` marca `usedAt`) + **TTL corto** (24h verificación / 1h reset):
  un token filtrado ya usado o caducado no sirve.
- **Impacto:** bajo. Requiere que un tercero capture el Referer/historial antes de que el token se use o
  expire; el diseño single-use lo neutraliza en la práctica.
- **Disparador:** si se refuerza el manejo del token en el frontend. Solución: que la página de destino
  intercambie el token por POST y lo **retire de la URL** (`history.replaceState`) al montar, y/o
  `Referrer-Policy: no-referrer` en esas rutas (coordinar con frontend/devops).

### Deuda del pase v1.7-admin-users (hallazgos techlead — no bloqueante, aceptada)

> Del pase de **alta de usuario por rol desde admin (M6)**. El bloqueante (proyección `ownedItems`
> de `getUser` que no conformaba el contrato `AdminUserOwnedItemRef` y crasheaba la pestaña Bóveda)
> **ya se corrigió** en este mismo pase (`admin.service.ts` → `getUser` mapea `{ inventoryItemId,
> folio, card: CardDTO, ownershipStatus }` con `toCardDTO`, cubierto en `test/admin.pii.spec.ts`) y
> **no** figura como deuda. Lo de abajo es la deuda no bloqueante que el techlead autorizó a diferir.

### BE-9 · `createUser` reimplementa a mano la validación de email/password — CERRADA (v1.8-ronda-c)
- **Dónde:** `src/modules/admin/admin.service.ts` → `createUser` vs. `src/modules/auth` (`RegisterDto` /
  `ResetPasswordDto`).
- **Estado (2026-08-16):** **cerrada.** Se centralizaron las reglas en `src/common/validation/credentials.ts`
  (`MIN_PASSWORD_LENGTH`, `EMAIL_REGEX`, `normalizeEmail`, `isValidEmailFormat`, `isStrongPassword`).
  `createUser` consume el helper; las DTOs de `auth` usan la constante compartida `MIN_PASSWORD_LENGTH` en
  sus `@MinLength`. Fuente única → sin riesgo de divergencia. Entrada conservada como registro histórico.

### BE-10 · `AdminUserOwnedItemRef` sin `finish` ni `referenceValue` — CERRADA (v1.8-ronda-c)
- **Dónde:** contrato `docs/API_CONTRACT.md §M6` (`AdminUserOwnedItemRef`); backend `admin.service.ts` →
  `getUser().ownedItems` / `ownedItemRefs`.
- **Estado (2026-08-16):** **cerrada.** El arquitecto eligió la opción (a) — enriquecer el ref — en el
  contrato v1.8-ronda-c. El backend implementó: cada `AdminUserOwnedItemRef` trae `finish` + `productType`
  + `referenceValue: PriceInfo`, reusando la valuación por-acabado del `HoldingDTO`. Anti N+1 con lectura
  batch de `PriceReference` por `cardId IN (...)`. Items sin precio → `referenceValue.status="pending"`
  (no se excluyen: vista 360°). Cubierto en `test/admin.pii.spec.ts`. Entrada conservada como histórico.

### B-4 / S-B5 · `approvedPriceCents` sin tope (dinero saliente arbitrario) — RESUELTA (pase P0 jobs de barrido)
- **Dónde:** `src/modules/buylist/dto/buylist.dto.ts` (`ItemDecisionDto`) + `buylist.service.ts` (`itemDecision`).
- **Estado:** **resuelta.** Hallazgo B-4 del pentest: `approvedPriceCents` tenía `@IsInt @Min(0)` **sin cota
  superior** → un `vault_operator` podía aprobar un monto SPEI arbitrario (PoC `99999999`). Defensa en dos
  capas: (1) DTO `@Max(1_000_000)` (MX$10,000, cota dura de sanidad → 400); (2) server-side
  `assertApprovedPriceWithinCap`: monto efectivo ≤ **min(`quotedPriceCents` × 2, tope por solicitud
  `buylist_cap_per_request_cents`)**; excede → `APPROVED_PRICE_CAP_EXCEEDED` (422). No rompe SEC-A1 ni el
  flujo de aprobación normal (aprobar el cotizado o ajuste ≤ 2× pasa). Cubierto con
  `test/buylist.approved-price-cap.spec.ts`. Ver `docs/BACKEND_NOTES.md §18.3`.

### Delta rama `claude/git-repo-review-c67xyk` — review techlead (2026-08-17, no bloqueante)

> Aprobado por **techlead** CON DEUDA ANOTADA. Dos ítems del código de catálogo (`catalog-sync.service.ts`),
> dueño **backend**. No bloqueantes; registrados a petición del techlead sin tocar código de producción.

### BE-11 · Estado de `sync-status`/`refresh-variants-status` en memoria; restart silencioso
- **Dónde:** `src/modules/catalog/catalog-sync.service.ts` → `syncAllStatus` **y** `refreshVariantsAllStatus`
  (ambos `{running,jobId,total,done,startedAt,finishedAt}`; el segundo con `summary` agregado). Dependencia:
  **devops/BullMQ (DEV-1)**. *(Alcance ampliado en `fix/variant-composition-regression` (M-35): el barrido
  `refresh-variants-all` calca EXACTAMENTE el modelo de `sync-all` y comparte esta misma deuda — mismo estado
  en memoria por-proceso, mismo `running` que queda colgado tras restart, mismo single-flight per-proceso.)*
- **Estado actual:** el estado observable de los barridos `sync-all` **y** `refresh-variants-all` vive **en
  memoria del proceso**. Si el proceso se reinicia a mitad del barrido, el estado vuelve a
  `{running:false,total:0}` (en `refresh-variants-all` además `summary` regresa a `null`), la barra de progreso
  de M2 desaparece y `finishedAt` **nunca** se setea → el operador puede creer que "terminó" cuando quedan sets
  pendientes; el progreso `done/total` se pierde y no se reanuda solo (hay que **re-llamar** el barrido).
- **Impacto:** medio. Aceptable como MVP (documentado en el propio código y en ARCHITECTURE DEV-1). No hay
  fuga de datos ni doble importación (el upsert por `externalId` es idempotente y ambos barridos son resumibles).
- **Disparador:** al **cablear BullMQ** para catálogo (misma familia que D1/DEV-1). Solución: progreso
  **persistido** en la cola + reintentos con backoff → cierra este ítem (para ambos barridos) y el D1.

### BE-12 · `.finally` muta `this.syncAllStatus` por referencia (seguro solo por el single-flight)
- **Dónde:** `src/modules/catalog/catalog-sync.service.ts` → `syncAll`/`runSyncAll` (el `.finally` del
  fire-and-forget que pone `running=false`/`finishedAt` sobre `this.syncAllStatus`).
- **Estado actual:** el `.finally` cierra el estado sobre `this.syncAllStatus`. Hoy es seguro **SOLO** porque
  el single-flight (`if (this.syncAllStatus.running) return`) impide barridos solapados. Si algún día se
  **relaja** ese guard, el `finally` de un barrido viejo pisaría el estado de uno nuevo (race de cierre).
- **Impacto:** bajo hoy (latente): el guard actual lo neutraliza; el riesgo aparece solo si se permite
  concurrencia de barridos.
- **Disparador:** si se relaja el single-flight o al mover el estado a la cola (BE-11/D1). Mitigación sugerida
  (no urgente): **capturar el `jobId` en el closure** y verificar `this.syncAllStatus.jobId === jobId` antes de
  mutar en el `finally`.

### Fase 0 del epic de precios — deuda del delta (commit ebb4dee, 2026-08-17, no bloqueante)

> De la **Fase 0** del epic de precios (gate premium `isPremiumRarity`/`ruleKeyCandidates`, encolado honesto
> de `publicQuote`, INE con línea pendiente). Triple veredicto **APROBADO** (qa + techlead APROBADO-con-deuda +
> seguridad APROBADO). Todos los ítems de abajo son **no bloqueantes**, dueño **backend** salvo donde se
> anota coordinación con **arquitecto**. Registrados a petición del techlead/seguridad sin tocar código de
> producción. Continúan la numeración `BE-*` (tras BE-1..12). Detalle de implementación en
> `docs/BACKEND_NOTES.md` (contrato §4.2.1 / §6).

### BE-13 · Contabilidad AML mensual no re-cuenta ítems que fueron `precio_pendiente` (Media, seguridad)
- **Dónde:** `src/modules/buylist/buylist.service.ts` → `monthUsedCentsTx` (~:294-307).
- **Estado actual:** el acumulado mensual agrega `quotedTotalCents` (no `approvedTotalCents`). Un ítem que
  entra como **`precio_pendiente`** (cotizado en 0) no suma al mensual al crearse; cuando el admin lo resuelve
  su monto entra a `approvedTotalCents` de la solicitud pero **nunca se re-contabiliza** contra el tope
  mensual AML del usuario. Un usuario podría, en teoría, superar el tope mensual acumulando aprobaciones de
  ítems que nacieron pendientes.
- **Impacto:** medio (AML/cumplimiento). **Compensado hoy** por tres capas: (1) la **INE siempre exigida** con
  cualquier línea pendiente en la solicitud; (2) el **cap por-solicitud** en `assertApprovedPriceWithinCap`
  (min(quoted×2, `buylist_cap_per_request_cents`)); (3) money-out **solo `super_admin`** y **auditado**. No hay
  fuga automática de dinero: cada pago SPEI pasa por el super_admin.
- **Disparador:** **abrir ticket ANTES de operar con dinero real / volumen AML relevante.** Solución: basar el
  mensual en `max(quotedTotalCents, approvedTotalCents)`, o re-evaluar el cap mensual en
  `itemDecision`/`recomputeApprovedTotal` al fijar `approvedPriceCents`.

### BE-14 · `isPremiumRarity` es allowlist finita de patrones (Baja, seguridad)
- **Dónde:** `src/common/money.ts` → `PREMIUM_RARITY_PATTERNS` / `isPremiumRarity` (~:125-153).
- **Estado actual:** el gate premium empareja por substrings/tokens de una lista finita. Rarezas **chase
  antiguas** que no matchean ningún patrón se escapan del gate (`Rare Shining`, `Rare Prime`, `Rare LEGEND`,
  `Rare BREAK`, `Rare ACE`); en finish holofoil, una premium cuyo string no lleva "holo" y no está en la
  allowlist cae al bin `['Holo']`.
- **Impacto:** bajo y **acotado a la baja**: el fallo posible es **subcotización** (pagar de menos por una
  chase antigua tratada como bulk), **nunca money-out excesivo**. No hay riesgo de sobrepago automático.
- **Disparador:** si se empiezan a cotizar **eras antiguas** (pre-Scarlet&Violet chase). Solución: ampliar
  `PREMIUM_RARITY_PATTERNS` con esos tokens. Dueño **backend**; la definición de taxonomía es del **arquitecto**.

### BE-15 · `escalatePending` dedup no atómico (falta `@@unique`) (Baja, seguridad)
- **Dónde:** `src/modules/pricing/pricing.service.ts` → `escalatePending` (~:189-195); modelo
  `PendingPriceEntry` (`prisma/schema.prisma`).
- **Estado actual:** el dedup es `findFirst` (`status='open'`) **+** `create`, sin unicidad en la tabla.
  `PendingPriceEntry` **no** tiene `@@unique` sobre `(cardId, productType, gradeKey, finish)` → bajo
  **concurrencia** (dos quotes/escaladas simultáneas de la misma combinación) pueden crearse **filas
  duplicadas** en la cola de precio pendiente.
- **Impacto:** bajo. A lo sumo entradas duplicadas en la cola de trabajo del admin (ruido operativo); no afecta
  dinero ni correctness de cotización (la resolución del precio resuelve todas las abiertas de la combinación).
- **Disparador:** al endurecer la cola de pendientes o si aparecen duplicados en operación. Solución: índice
  único parcial `(cardId, productType, gradeKey, finish) WHERE status='open'` + `upsert`/captura de **P2002**.
  **Toca `schema.prisma` → coordinar con arquitecto.**

### BE-16 · `publicQuote` escala pendientes desde endpoint público/anónimo (hallazgo QA, aceptado por seguridad)
- **Dónde:** `src/modules/buylist/buylist.service.ts` → `publicQuote` (~:81-83) +
  `src/modules/buylist/buylist.controller.ts` (~:14-19).
- **Estado actual:** el cotizador público (anónimo) llama `escalatePending` cuando el acabado cotiza
  `precio_pendiente` — para cumplir la promesa del copy ("entrará a la cola de precio pendiente"). Un usuario
  **anónimo** puede, en consecuencia, **poblar la cola** de precio-pendiente enumerando cartas. **Acotado**
  por: solo cartas **existentes** en catálogo, throttle global (300/min), y dedup best-effort (BE-15).
- **Impacto:** bajo. Ruido en la cola de trabajo del admin; sin fuga de datos ni de dinero (SEC-A1 intacto:
  rareza/montos server-side).
- **Disparador:** **la Fase 1 (precio on-demand) lo supersede** — el quote traerá precio real en vez de
  encolar, y el punto desaparece. Si molesta la cola antes de eso: marcar el **origen** del pendiente
  (público vs autenticado) o escalar **solo autenticado**. Aceptado como interino por seguridad.

### BE-17 · Falta test unitario directo de `isPremiumRarity` / `ruleKeyCandidates` (D1 techlead)
- **Dónde:** `test/money.spec.ts` (no las cubre directamente); hoy solo se ejercen vía integración en
  `test/buylist.modern-rarity.spec.ts`.
- **Estado actual:** el gate premium (`isPremiumRarity`) y la selección de candidatos (`ruleKeyCandidates`)
  se prueban **indirectamente** por integración, no con una tabla de casos unitaria dedicada.
- **Impacto:** bajo (calidad/mantenibilidad). Sin cobertura directa, un cambio en los patrones podría
  regresar sin fallar un test unitario; el token `\b(v|ex|gx…)\b` es especialmente **propenso a falsos
  positivos** (p. ej. "ex" dentro de otras palabras) y merece casos explícitos.
- **Disparador:** próximo pase de hardening de tests. Solución: agregar a `test/money.spec.ts` una **tabla de
  casos** (premium vs bulk, holofoil/reverse/normal, y el token de V-series/EX/GX).

### BE-18 · Asimetría del gate: `reverse_holo` no pasa por `isPremiumRarity` (techlead punto 3)
- **Dónde:** `src/common/money.ts` → `ruleKeyCandidates`, rama `case 'reverse_holo'` (~:173-174).
- **Estado actual:** `reverse_holo` retorna **siempre** `['Reverse Holo']` **sin** pasar por el gate premium
  (a diferencia de holofoil/1st-ed, que sí lo aplican). Probablemente inocuo: una rareza premium **rara vez**
  existe en acabado reverse, y `assertFinishAvailable` filtra acabados no disponibles; pero la asimetría no
  tiene test ni doc que la justifique.
- **Impacto:** bajo/latente. Igual que BE-14, el fallo posible sería **subcotización**, no money-out excesivo.
- **Disparador:** si aparece una rareza premium con `reverse_holo` real en catálogo. Solución: aplicar el
  mismo gate premium a la rama `reverse_holo` (o documentar/testear la exclusión intencional).

### BE-19 · Comentario "inocuo" de la sobre-inclusión en `money.ts` debería decir "costo acotado" (cosmético, D2 techlead)
- **Dónde:** `src/common/money.ts` (~:120-121 y ~:166).
- **Estado actual:** los comentarios describen la sobre-inclusión del gate premium (una carta barata
  clasificada premium "solo pasa a % de mercado, **inocuo**"). En **buylist** ese "% de mercado" **es dinero
  que sale** (aunque pequeño), así que la redacción correcta es "**costo acotado**", no "inocuo".
- **Impacto:** nulo funcional; solo precisión del comentario (evita subestimar el efecto en dinero saliente).
- **Disparador:** próximo toque de `money.ts`. Solución: reemplazar "inocuo" por "costo acotado" en esos dos
  comentarios.

### Fase 1 del epic de precios — deuda del delta (commit a6a79df, 2026-08-17, no bloqueante)

> De la **Fase 1** del epic de precios (precio on-demand: `persistMarketReference`, disparo manual del job
> de catálogo/precio). Triple veredicto **APROBADO** (seguridad + qa + techlead APROBADO-con-deuda). Todos
> los ítems de abajo son **no bloqueantes**, dueño **backend** salvo dependencia con **devops** donde se
> anota. Registrados a petición del techlead/seguridad sin tocar código de producción. Continúan la
> numeración `BE-*` (tras BE-1..19).

### BE-20 · `PriceReference` crece sin poda (prioridad alta de disparo)
- **Dónde:** `src/modules/pricing/pricing.service.ts` → `persistMarketReference` (~:210-256).
- **Estado actual:** el upsert va por `capturedDate=hoy` (idempotente **dentro** del día), pero entre días
  acumula **una fila por `(card, finish, día)`** → ~30-40k filas/día, ~11-15M/año, **sin job de barrido**
  (`priceReference.deleteMany` no existe). Es la contrapartida directa de "preciar todo el catálogo 2×/día".
- **Impacto:** medio a alto a futuro: crecimiento monotónico de la tabla que degrada consultas y storage al
  operar a escala. Correctness OK (el upsert diario no corrompe).
- **Disparador:** **ANTES de operar a escala.** Solución: job de retención/particionado por `capturedDate`
  (mantener N días de histórico raw + agregados para la gráfica de set §4.12). Dependencia **devops**
  (particionado) / DEV-1.

### BE-21 · single-flight solo en memoria del proceso; el disparo manual evade la cola
- **Dónde:** `src/modules/catalog/catalog-sync.service.ts` → `syncAllStatus.running` **y**
  `refreshVariantsAllStatus.running` +
  `src/modules/catalog/admin-jobs.controller.ts:150` (`POST /admin/jobs/catalog-price-sync`). *(Alcance
  ampliado en `fix/variant-composition-regression` (M-35): `refresh-variants-all` usa su propio `running`
  como single-flight **per-proceso**, idéntico al de `sync-all` — misma limitación.)*
- **Estado actual:** `syncAllStatus.running` (y `refreshVariantsAllStatus.running`) es estado **en memoria**;
  el disparo manual corre `syncAll()`/`refreshVariantsAll()` **in-process en el web dyno**, saltándose el
  worker BullMQ. En multi-instancia, un disparo manual puede solaparse con otro → **dos barridos concurrentes**
  del mismo tipo → doble carga y agotamiento del rate-limit del upstream (429 pokemontcg.io / tcgcsv.com).
  Idempotente: no corrompe datos.
- **Impacto:** medio bajo condiciones multi-instancia: doble carga sobre el upstream y 429. Aceptable en
  instancia única (el single-flight en memoria basta).
- **Disparador:** **multi-instancia o al cablear BullMQ para catálogo.** Mitigación: encolar también el
  disparo manual, o lock en Redis (`SET NX`). Familia DEV-1/BE-11/BE-12. Ver también **BE-77** (los dos
  barridos NO son mutuamente exclusivos entre sí, solo dentro de su propio tipo).

### BE-22 · `persistMarketReference` guard `isManualOverride` es TOCTOU (Baja)
- **Dónde:** `src/modules/pricing/pricing.service.ts:228-254`.
- **Estado actual:** `findUnique` → early-return si `isManualOverride`; si no, `upsert` cuyo `update` fija
  `isManualOverride:false`. Entre lectura y escritura un admin podría setear override y el `update` lo
  **pisaría** (`manual` → `pokemontcg_io`). Ventana **minúscula**; consistente con el TOCTOU de
  `syncCardPrice` y BE-15. Es **dinero** (precio de referencia).
- **Impacto:** bajo. Requiere que un override manual caiga exactamente en la ventana lectura→escritura de un
  sync concurrente; el peor caso es un override pisado por el precio automático (recuperable re-aplicando).
- **Disparador:** **al endurecer overrides o si aparece pisado en operación.** Solución:
  `updateMany ... WHERE isManualOverride=false` en una sola sentencia, o `$transaction`.

### BE-23 · Disparo manual del job sin `@Throttle` propio (Baja/Info, seguridad)
- **Dónde:** `src/modules/catalog/admin-jobs.controller.ts:145-160`.
- **Estado actual:** el single-flight impide barridos solapados, pero cada disparo en loop ejecuta
  `client.getSets()` contra pokemontcg.io. **Solo `super_admin`**, impacto bajo.
- **Impacto:** bajo. A lo sumo carga extra sobre el proveedor si un super_admin abusa del endpoint en loop.
- **Disparador:** si se abusa. Mitigación: `@Throttle` nominal en el endpoint de jobs.

### Fase 2 del epic de precios — deuda del delta (commits fba6486 + fee3c19, 2026-08-17, no bloqueante)

> De la **Fase 2** del epic de precios (precio de VENTA por RAREZA editable en admin:
> `computeSalePriceForRarity`, endpoints `sales-rules`/`sales-rarities`, swap de call-sites de venta, piso
> `fixed` que vuelve vendible el bulk). Triple veredicto **APROBADO** (qa + techlead APROBADO-con-deuda +
> seguridad APROBADO). Todos los ítems de abajo son **no bloqueantes**, dueño **backend**. Registrados a
> petición del techlead/seguridad sin tocar código de producción. Continúan la numeración `BE-*` (tras
> BE-1..23). Detalle de implementación en `docs/BACKEND_NOTES.md §35` (contrato/arquitectura §4.14).

### BE-24 · Trap de tipado estructural `BuylistRule` vs `SalesRule` (techlead)
- **Dónde:** `backend/src/common/money.ts` (tipos `BuylistRule`/`SalesRule` + `quoteAcquisitionForFinish` /
  `computeSalePriceForRarity`).
- **Estado actual:** los dos tipos son **estructuralmente idénticos** (`{mode,value}`) y las dos funciones
  tienen **firma posicional idéntica** → TypeScript **NO atrapa** si se pasa `BUYLIST_PRICE_RULES` a la
  función de venta (o viceversa); se aplicaría matemática incorrecta **en silencio**. Hoy es seguro porque
  cada servicio lee su propia key (`SALES_PRICE_RULES` vs `BUYLIST_PRICE_RULES`), pero el tipo **no es
  guardarraíl**.
- **Impacto:** bajo/latente. Correctness OK hoy; el riesgo aparece si un refactor cruza las reglas de
  compra y venta sin que el compilador lo señale (venta a precio de compra o al revés).
- **Disparador:** **al tocar el resolver de precios.** Mitigación: branding nominal
  (`& {readonly __brand:'sales'}` / `'buylist'`) para que TS distinga los tipos, o un test que **fije la
  fórmula de cada rama** (venta = markup sobre mercado; compra = % de la referencia).

### BE-25 · N+1 de lecturas de settings en `fetchSellable` agravado por el gate relajado (techlead + qa)
- **Dónde:** `src/modules/catalog/catalog.service.ts:69-82` (`fetchSellable`) + `toListingDTO` →
  `computeSalePriceForItem`; lecturas en `src/modules/settings/settings.service.ts:22-26`
  (`configSetting.findUnique` **sin memoización**).
- **Estado actual:** al quitar el filtro de precio del gate coarse (para que el piso `fixed` vuelva vendible
  el bulk), se itera **TODO** `platform+listed` y cada `toListingDTO`→`computeSalePriceForItem` hace **2
  lecturas de settings sin cache** (`SALES_PRICE_RULES` + fallback). El número de queries crece con el
  inventario listado (afecta `facets`/`listSets`/`search`). Es **perf, no correctness**.
- **Impacto:** rendimiento del storefront (Compra/facets) al crecer el catálogo publicado.
- **Disparador:** **al crecer el catálogo listado.** Mitigación: izar la lectura de `SALES_PRICE_RULES` +
  fallback **una vez por request**, o memoizar `SettingsService` (misma familia que BE-4/D3, acotada a la
  ruta de venta).

### BE-26 · Orden a $0 por regla `fixed:0` (seguridad B-6, Baja, ruta de dinero)
- **Dónde:** `src/modules/catalog/catalog.service.ts:118` (gate exige `salePriceCents>0`) vs.
  `src/modules/orders/orders.service.ts:38-41` (`salePriceOf` solo rechaza `== null`).
- **Estado actual:** el catálogo exige `salePriceCents>0` para exponer, pero `salePriceOf` **no** rechaza
  `<=0` y `createSession` **no re-verifica** `sellable`/`price>0`. Si un `super_admin` fijara por error un
  piso `fixed:0` (el validador permite `value>=0`), un checkout con un `inventoryItemId` **conocido** crearía
  una orden a `unitPriceCents:0`. Requiere **misconfig de un actor confiable** + un cuid **no adivinable** → **Baja**.
- **Impacto:** bajo. Ruta de dinero: una orden a precio cero saltándose el gate `>0` del catálogo; acotado a
  actor confiable equivocado.
- **Disparador:** **endurecer ANTES de operar con dinero real.** Mitigación: que `salePriceOf` rechace `<=0`
  (alinear con el gate `>0` del catálogo) y/o que el validador de `fixed` exija `value>=1`.

### BE-27 · `fixed` sin cota superior → overflow Int32 (seguridad B-7, Baja)
- **Dónde:** `src/common/money.ts` → `isValidSalesRule` (valida `fixed` solo `>=0`, sin cota superior; `pct`
  puede dar `market×11`).
- **Estado actual:** ni `fixed` ni el resultado de `pct` tienen cota superior; ambos alimentan columnas
  `*Cents` **Int 32-bit** → un `fixed` > 2.147e9 (o un market alto ×11) **desborda** la escritura en Postgres.
  Misma familia que **B-3** (`PENTEST_NOTES`, ya aceptada), aquí **extendida a venta**. Input **confiable**,
  no explotable por externo.
- **Impacto:** bajo. A lo sumo un error de escritura por un dial mal configurado por actor confiable; no es
  vector externo.
- **Disparador:** al abordar B-3. Mitigación: **cota superior en `fixed`** dentro de la decisión BigInt de
  B-3 (acotar también el `pct×market`).

### WS-A (v1.14-price-ingest) — deuda aceptada del triple veredicto (2026-08-17, no bloqueante)

### BE-28 · `FxDto.rate` `@IsInt @Min(1)` — override manual de FX solo admite pesos enteros (MENOR-1)
- **Dónde:** `src/modules/pricing/pricing.controller.ts` (`FxDto.rate` `@IsInt`), pre-existente (commit `eb29654`,
  NO introducido por WS-A).
- **Estado actual:** el override manual de la tasa USD→MXN se valida como **entero** (18, 19…), no decimal.
  Un tipo real como 18.75 se rechaza; el admin fijaría 18 o 19 → **~2.7% de error** en el precio de referencia
  cuando se usa el override manual. El colchón (`fx_buffer_pct`) sí es decimal. La ruta automática (Banxico) sí
  guarda el rate decimal real; esto solo afecta al **override manual** explícito.
- **Impacto:** bajo. Solo cuando el admin fija tasa manual (respaldo); el flujo normal (Banxico) no se afecta.
- **Disparador:** al pulir la UX de FX de M2. Mitigación: `@IsNumber()` + `@Min(0.000001)` en `rate` (permitir
  decimales) — **cambio menor de validación, sin efecto en el resto**. Fuera de alcance de WS-A (no lo tocó).

### BE-29 · `resolveCardId` fallback `(set, number)` puede mal-resolver si dos cartas comparten `number` (MENOR-3)
- **Dónde:** `src/modules/pricing/price-ingest.service.ts` → `resolveCardId` (`card.findFirst({ setId, number })`).
- **Estado actual:** la resolución **primaria** es `Card.externalId` (`@unique`, exacta). El **fallback** por
  `(setId, number)` usa `findFirst`; si un set tuviera **dos cartas con el mismo `number`** (p. ej. variantes/
  promos con numeración repetida), podría resolver a la "otra" y escribir el `PriceReference` en la carta
  equivocada. No hay índice/constraint `(setId, number)` único. En la práctica el proveedor de paga trae
  `externalId`, así que el fallback rara vez actúa.
- **Impacto:** bajo. Ruta de dinero (precio de referencia) pero acotado al caso raro de `number` duplicado en un
  set Y sin `externalId` en la fila del proveedor. SEC-A1 intacto (no viene del cliente).
- **Disparador:** si el proveedor de paga entregara filas SIN `externalId`. Mitigación: preferir siempre
  `externalId`; si se necesita robustez del fallback, desambiguar (p. ej. por `finish`/`rarity`) o rechazar el
  `number` ambiguo en vez de adivinar.

### BE-30 · El seed depende del default de código para `price_provider` (auditoría) (MENOR-4)
- **Dónde:** `prisma/seed.ts` (siembra `SETTING_DEFAULTS`) + `SettingsService.get` (cae al default de código si
  no hay fila).
- **Estado actual:** `PRICE_PROVIDER` **sí** está en `SETTING_DEFAULTS` (`pokemontcg_io`) → un **seed fresco**
  escribe la fila. Pero una BD **pre-existente** que no re-corra el seed **no** tendrá la fila `price_provider`
  hasta el primer `PUT /admin/settings`; mientras tanto `providerFor()` resuelve por el **default de código**
  (`pokemontcg_io`) — funciona y es money-safe, pero **no deja rastro en `ConfigSetting`** para auditoría.
- **Impacto:** muy bajo. Solo cosmético/auditoría; el comportamiento efectivo es correcto (legacy).
- **Disparador:** opcional. Mitigación: sembrar/backfillear explícitamente la fila `price_provider` en la BD de
  staging/prod (o un `PUT /admin/settings { priceProvider: "pokemontcg_io" }` una vez) para que el dial sea visible.

### BE-31 · Single-flight del parent solo explícito en la rama secuencial (techlead-3)
- **Dónde:** `src/jobs/price-ingest.service.ts` → `run()` (flag `running` para la rama SIN Redis) vs
  `enqueueAllSets()` (rama CON cola).
- **Estado actual:** la rama **secuencial** (sin Redis) tiene single-flight explícito (`running`). La rama **con
  cola** se apoya en el **jobId determinista por día por set** (`price-ingest-set-<setId>-<día>`): BullMQ
  deduplica y el upsert es idempotente → no hay doble escritura, pero NO hay un guard "ya hay una corrida
  activa" simétrico. Se añadió un **comentario** explicando el mecanismo; el guard explícito queda pendiente.
- **Impacto:** ninguno de dinero (dedup + upsert idempotente lo cubren). A lo sumo, dos disparos casi simultáneos
  re-encolan los mismos jobIds (no-op para los pendientes).
- **Disparador:** si se quisiera un `enqueued:false` fiable en la rama con cola. Mitigación: guard simétrico
  (p. ej. contar jobs activos/deduplicados del día antes de re-encolar).

### BE-32 · Si el bulk del proveedor ignora `page` → hasta `maxPages` requests idénticas + N queries/set (techlead-4)
- **Dónde:** `src/modules/pricing/providers/pokemonpricetracker-bulk.provider.ts` (loop de páginas) y
  `price-ingest.service.ts` → `resolveCardId` (una query por fila).
- **Estado actual:** (a) si el endpoint del proveedor **ignora** `page` y devuelve siempre la misma página llena,
  el loop iteraría hasta `maxPages` (40) requests **idénticas** (gasta cuota; **sin** error de dinero — el upsert
  idempotente y el jobId por día lo neutralizan). (b) `resolveCardId` hace **N queries** por set (una por fila);
  se podría **batchear** (un `findMany` por `externalId[]`/`number[]` y resolver en memoria).
- **Impacto:** bajo. Coste de cuota/latencia, no de dinero. Solo relevante al flipar al proveedor de paga.
- **Disparador:** verificar la paginación real en la 1ª corrida (§36.2). Mitigación: cortar el loop si una página
  repite el contenido de la anterior; batchear `resolveCardId` con un `findMany` por set.

### BE-33 · Moneda/unidad del proveedor de paga — MITIGADA por fail-closed `MARKET_FORMAT` (seguridad Media)
- **Dónde:** `src/modules/pricing/providers/pokemonpricetracker-bulk.provider.ts` (`POKEMONPRICETRACKER_MARKET_FORMAT`).
- **Estado actual:** el riesgo original (asumir USD-dólares y persistir precios inflados ~18×/100× si el payload
  fuera MXN o centavos) queda **mitigado por construcción**: el proveedor de paga **NO persiste** bajo una
  moneda/unidad asumida — el operador debe fijar `POKEMONPRICETRACKER_MARKET_FORMAT` (sin default); sin él corre
  en **sample-only** (loguea la muestra, persiste nada). **PO confirmó `usd_dollars`** (2026-08-17). El dial
  `price_provider` sigue sembrado en `pokemontcg_io` (legacy) hasta el flip consciente.
- **Impacto:** residual muy bajo (el candado exige acción explícita). Queda como recordatorio operativo.
- **Disparador (aceptado):** **abordar/confirmar ANTES de flipar a `pokemonpricetracker`** — fijar
  `POKEMONPRICETRACKER_MARKET_FORMAT=usd_dollars` tras inspeccionar el log de la 1ª corrida (runbook en
  `BACKEND_NOTES §36`). Sin esa env, el flip del dial NO escribe precios (seguro).

### BE-35 · `getReferencesBatch` arma una consulta cartesiana (inocua con cap 50) (Baja)
- **Dónde:** `src/modules/pricing/pricing.service.ts` (`getReferencesBatch`), usada por `bulkPublish` y
  `CatalogService.fetchSellable`.
- **Estado actual:** el batch de referencias construye un `WHERE` con el producto de las dimensiones
  `(cardId, productType, gradeKey, finish)` de los ítems del lote → en el peor caso la condición crece de
  forma cuasi-cartesiana. **Inocuo hoy**: los lotes están capados (bulk-publish/batch ≤ 200 líneas; el
  cotizador batch ≤ 50) y el índice de `PriceReference` sirve la búsqueda; el volumen real es pequeño.
- **Impacto:** ninguno observable a la escala del MVP; potencial de consulta grande si se subieran mucho los
  caps de lote sin revisar la forma del query.
- **Disparador (aceptado):** si se aumenta el cap de lote (>200) o aparece latencia en `bulk-publish`/
  `fetchSellable`, reescribir a un `IN` sobre claves compuestas o a tuplas `(cardId, finish)` acotadas.
  **Actualización 2026-08-21 (Stream A v1.27):** el binder Master Set (P-15) pasó el lote a
  carta×acabado SIN cap de 50 (un set completo por request) y la consulta además carga TODO el
  histórico sin acotar `capturedDate` — ver **SA-D2** (Alta), que absorbe/adelanta este disparador:
  pagar ambos juntos (acotar fecha o `DISTINCT ON` + revisar la forma cartesiana del `WHERE`).

### BE-36 · `isSecretRare = numberSort > printedTotal` marca TODOS los promos TG/GG/SV — RESUELTA (2026-08-17)
- **Dónde:** `src/modules/inventory/master-set.service.ts` (`MasterSetCardCellDTO.isSecretRare`).
- **Estado:** **RESUELTA** contra el contrato reconciliado §M1 **v1.16.1** / ARCHITECTURE §4.17a. El arquitecto
  afinó la definición a **heurística de display**: `isSecretRare = true` **solo** para numeración PRINCIPAL
  (número **puramente numérico**, sin prefijo alfabético) con entero `> printedTotal`; promos/subsets con
  **prefijo** (`TG`/`GG`/`SV`) → **`false`** aunque su `numberSort` (`PROMO_SORT_BASE + n`) supere el total;
  `printedTotal` nulo → `false`.
- **Fix:** el cálculo pasó de `printedTotal != null && parts.numberSort > printedTotal` a
  `printedTotal != null && parts.prefix === '' && parts.num > printedTotal`. Tests en
  `test/master-set.service.spec.ts`: `c200` (número puro 200 > 191) → `true`; `TG12` (prefijo) → `false`;
  `c10` (dentro del total) → `false`. Detalle en `BACKEND_NOTES §40`.

### BE-37 · `nextFolios` / `escalatePending` corren FUERA de `$transaction` (Baja — re-chequeo de QA)
- **Dónde:** creación de piezas de inventario (secuencia de folios) y `PricingService.escalatePending`.
- **Estado actual:** ambos side-effects se ejecutan **fuera** de la transacción que los origina. Consecuencias
  benignas: (a) si la transacción hace **rollback** tras reservar folios, quedan **huecos de folio** (la
  secuencia no retrocede — comportamiento normal de una secuencia); (b) `escalatePending` puede quedar como
  **escalación huérfana** si la operación que la disparó revierte. Ninguno afecta correctness de dinero ni
  double-sell: los folios solo deben ser únicos/monótonos (no contiguos) y la escalación es idempotente/benigna.
- **Impacto:** cosmético/operativo (huecos en la numeración de folios; alguna escalación de precio "de más").
- **Disparador (aceptado):** si auditoría exige folios contiguos, o si las escalaciones huérfanas generan ruido,
  mover ambos dentro del `$transaction` (o compensar en el `catch`). Relacionado con **BE-15** (dedup de
  `escalatePending` no atómico).

### BE-38 · `batchQuote` de buylist resuelve `getReference` por-ítem (hasta 50 lecturas) (Baja)
- **Dónde:** `src/modules/buylist/buylist.service.ts` → `batchQuote` (usado por `POST /buylist/quote/batch`).
- **Estado actual:** el cotizador batch resuelve la referencia de precio **por ítem** (`getReference` en bucle),
  hasta 50 lecturas por request. **Inocuo hoy**: el lote está capado a 50 por el DTO y el endpoint ya lleva
  `@Throttle` dedicado (12/min, ver B-C1 en `BACKEND_NOTES §40`), así que el techo de lecturas está acotado.
- **Impacto:** rendimiento (latencia del batch) al crecer el uso; correctness OK.
- **Disparador (aceptado):** reusar el **`getReferencesBatch`** ya existente (`PricingService`, ver **BE-35**)
  para resolver las 50 referencias en 1 consulta. Misma familia que **BE-4/D3**.

### WS-H (cierre invariante de retiro) — deuda del delta (2026-08-17, no bloqueante)

> Del pase de cierre WS-H (SEC-H1/SEC-H2: item `withdrawn` re-retirable + TOCTOU de doble-envío). Los
> **dos fixes** (gate positivo `status==='in_custody'` en `classifyItems` → `ITEM_NOT_IN_CUSTODY`/422; y el
> guard transaccional SERIALIZABLE del chequeo anti-doble-envío + creación) se **aplicaron** en este pase con
> tests, y por tanto **no** figuran como deuda. Lo de abajo es la deuda **no bloqueante** que queda. Dueño
> **backend** salvo donde se anota dependencia con **devops**. Continúan la numeración `BE-*` (tras BE-38).

### BE-39 · Regla de exclusión `status!='withdrawn'` duplicada en 3 sitios (mantenibilidad)
- **Dónde:** `src/modules/vault/vault.service.ts:35` (`holdings`) y `:121` (`costBasisCents`);
  `src/jobs/portfolio-snapshot.service.ts:32` (snapshot por-usuario).
- **Estado actual:** el `where` de "holdings activos del cliente" (`ownerType:'customer', ownerUserId:userId,
  status:{ not:'withdrawn' }`) está **replicado a mano** en tres consultas. Si la definición de "holding activo"
  cambia (p. ej. excluir también `lost`/`damaged` del portafolio, o añadir un nuevo status terminal), hay que
  tocarlo en tres sitios y es fácil que diverjan (el snapshot mostraría un total distinto del de "Mi bóveda").
- **Impacto:** bajo. Correctness OK hoy (los tres coinciden); riesgo de divergencia silenciosa al evolucionar
  la máquina de estados del inventario.
- **Disparador:** al tocar la definición de holding activo o la valuación de portafolio. Solución: extraer un
  helper compartido `customerActiveHoldingsWhere(userId)` (un `Prisma.InventoryItemWhereInput`) reusado por los
  tres call-sites. Owner: **backend**. Prioridad: **baja**.

### BE-40 · Dos representaciones de "envío activo": allowlist vs denylist (fuente doble)
- **Dónde:** `src/modules/vault/vault.service.ts:11-16` (`ACTIVE_SHIPMENT_STAGES` = allowlist
  `[solicitado, picking, guia, enviado]`) vs. `src/modules/shipments/shipments.service.ts` (chequeo
  anti-doble-envío usa `status: { notIn: ['cancelado','entregado'] }` = **denylist**).
- **Estado actual:** el mismo concepto ("un envío que aún bloquea el item") se codifica de **dos formas
  complementarias** en dos módulos. Hoy son equivalentes (los 6 estados particionan exactamente en 4 activos +
  2 terminales), pero si se **añade un estado nuevo** al `ShipmentStatus` (p. ej. `retenido`/`devuelto`), la
  allowlist y la denylist **discreparían** (uno lo trataría activo, el otro no) → un item podría listarse como
  retirable en la bóveda y a la vez ser rechazado por el gate de creación, o viceversa.
- **Impacto:** bajo/latente. Correctness OK con los 6 estados actuales; el riesgo aparece al extender el enum.
- **Disparador:** al añadir un `ShipmentStatus` nuevo o al tocar cualquiera de los dos checks. Solución: derivar
  ambas de **una sola constante** (p. ej. `ACTIVE_SHIPMENT_STAGES` como fuente; el gate de shipments usa
  `status: { in: ACTIVE_SHIPMENT_STAGES }` en vez del `notIn`). Owner: **backend**. Prioridad: **baja**.
- **Nota UX (v1.17.1, no bloqueante):** con el read de `withdrawable` ya alineado al contrato §3 (read=write:
  `settled && status==='in_custody' && sin envío activo`), un item `settled` pero `lost`/`damaged` ahora muestra
  `withdrawable=false` (**resuelto**: ya no ofrece RETIRAR una carta en incidencia). Si en el futuro se quiere un
  **mensaje específico** "carta en incidencia" en la bóveda (en vez de solo ocultar/deshabilitar el botón), es una
  **mejora de UX** (frontend, requeriría exponer/consumir el `status` en la tarjeta). No bloqueante. Owner: **ux-ui/frontend**.

### BE-41 · N+1 de pricing en `holdings` amplificado por el snapshot por-usuario (perf) — familia BE-4/D3
- **Dónde:** `src/modules/vault/vault.service.ts:69-106` (`holdings` llama `PricingService.getReference` por
  ítem) + el job `portfolio-snapshot` (mismo patrón, ahora por-usuario).
- **Estado actual:** una consulta `PriceReference` por holding; con bóvedas grandes son decenas/cientos de
  queries por request, y el snapshot diario lo repite **por cada usuario**. Es la misma familia que **BE-4/D3**,
  aquí re-confirmada y amplificada por el snapshot por-usuario del portafolio.
- **Impacto:** rendimiento de "Mi bóveda" y del snapshot diario al crecer el inventario. Correctness OK.
- **Disparador:** cuando un usuario supere ~cientos de holdings o el snapshot se vuelva lento. Solución: migrar a
  `PricingService.getReferencesBatch` (ya existe, ver BE-35) por `(cardId, productType, gradeKey, finish)` con un
  `IN` y map en memoria, reusado por `holdings` y el job. **Re-confirmar/cerrar junto con BE-4.** Owner:
  **backend**. Prioridad: **baja**.

### BE-42 · Índice único parcial de `ShipmentItem` para SEC-H2 (defensa en profundidad) — disparador DAST
- **Dónde:** `prisma/schema.prisma` (`ShipmentItem`, sin `@@unique`/índice parcial sobre `inventoryItemId`);
  `src/modules/shipments/shipments.service.ts` (`create`, guard transaccional SERIALIZABLE).
- **Estado actual:** SEC-H2 quedó **mitigado** en este pase por el guard transaccional serializable (dos
  `POST /shipments` concurrentes del mismo item → uno aborta por conflicto de serialización, no se crean dos
  envíos ni dos PaymentIntents), **SIN migración**. La defensa **en profundidad** —un índice único **parcial**
  `ShipmentItem(inventoryItemId) WHERE shipmentRequest activo` que haga la doble-inserción imposible a nivel de
  BD incluso bajo un aislamiento más laxo— **no** se aplicó en este pase (requiere migración; se difirió a
  propósito por el alcance del encargo). Nota: un índice parcial sobre una condición que cruza tablas
  (`shipmentRequest.status`) no es expresable directo en Postgres sin desnormalizar un flag "activo" en
  `ShipmentItem` o materializarlo; evaluar el diseño al abordarlo.
- **Impacto:** bajo residual (el guard serializable ya cierra la carrera práctica); el índice sería cinturón +
  tirantes ante un cambio futuro de nivel de aislamiento o un camino de creación alterno.
- **Disparador:** **al aparecer en un DAST** de doble-envío concurrente sobre staging, o al endurecer la ruta
  de dinero antes de operar a escala/multi-instancia. Solución: migración con el índice único parcial (posible
  columna `isActive`/`shipmentStatus` desnormalizada en `ShipmentItem` mantenida por la máquina de estados) +
  captura de P2002 como `ITEM_IN_ANOTHER_SHIPMENT`. Owner: **backend** (schema → **coordinar con arquitecto**;
  disparador **DAST/devops**). Prioridad: **baja**. Relacionado con **BE-2** (familia TOCTOU).

### v1.18-buylist-rejects (M5 rechazos) — deuda aceptada del pase (2026-08-17, no bloqueante)

### BE-43 · Plantilla del correo de rechazo de buylist vive FUERA de `mail/` (layout/escape duplicados)
- **Dónde:** `src/modules/buylist/buylist-mail.templates.ts` (`sellItemRejectedTemplate` + helpers
  `layout`/`escapeHtml`/`normalizeLocale` duplicados de `src/modules/mail/mail.templates.ts`) y el envío
  best-effort en `buylist.service.ts` (`sendItemRejectedMail`, sin cola de reintentos).
- **Estado actual:** decisión de diseño del arquitecto (ARCHITECTURE §4.18c / API_CONTRACT v1.18): el módulo
  `mail` pertenece al stream «Cuentas y acceso» y NO se toca desde este stream; `buylist` inyecta solo el
  puerto global `MAIL_PORT` y renderiza con plantilla LOCAL al módulo. Consecuencias: (a) el helper de
  layout/branding y la disciplina de escape HTML (S15-B1) están **duplicados** (si `mail.templates.ts`
  cambia el branding/escape, hay que espejarlo a mano aquí); (b) el envío es **best-effort sin reintentos**
  (fallo → `logger.error`, la decisión NO se revierte — norma §M5). Relacionado (mismo pase, menor): las
  constantes 7d/30d de los plazos del ítem rechazado viven en
  `src/modules/buylist/buylist-reject.constants.ts`; `src/jobs/buylist-sweep.service.ts` (zona de otro
  agente en este pase) conserva sus 7/30 inline — al tocar el sweep, importar esas constantes (fuente única).
- **Ampliación (v1.19, techlead) — RESUELTA en P-21:** el correo de soporte ya NO está hardcodeado:
  `buylist-mail.templates.ts` lee `SUPPORT_EMAIL` con cascada a `DISPUTE_EVIDENCE_CONTACT` (la MISMA env que
  `disputes.constants.ts`) y default histórico, vía `envOr` (ronda de cierre P-21: env vacía/blanca cae al
  default). Un cambio del buzón vía env SÍ se refleja en el correo de rechazo. Queda solo el residuo menor de
  que el **literal default** está duplicado en 3 archivos — trackeado como **BE-P21-2** (abajo).
- **Impacto:** bajo. Mantenibilidad (divergencia potencial de branding/escape entre plantillas) y, sin
  reintentos, un correo de rechazo puede perderse si el proveedor falla (el vendedor igual ve motivo y plazos
  en la app, `GET /buylist/requests/:id`).
- **Disparador (aceptado):** cuando el stream **«Cuentas y acceso»** toque `mail/`: absorber
  `sellItemRejectedTemplate` en `mail.templates.ts`/`MailService` (helpers a fuente única) y evaluar cola de
  reintentos para transaccionales de negocio. Dueño: **backend**. Aceptada por arquitecto en el contrato v1.18.

### Nota al arquitecto (NO backend) · `AdminBuylistDTO §M5` podría exponer `userName` — CERRADA (v1.18)
- **Qué:** el flujo admin de buylist (§M5) hacía un **fetch por-fila** del nombre del usuario. Si el contrato
  expusiera `userName` en `AdminBuylistDTO` se evitaría ese N+1 de presentación en M5.
- **Estado (2026-08-17):** **CERRADA.** El arquitecto lo normó en el contrato **v1.18-buylist-rejects**:
  `GET /admin/buylist` y `GET /admin/buylist/:id` exponen **`seller: AdminSellerRef = { id, name, email }`**
  (join server-side a `User`), implementado por backend en este pase (`adminList`/`adminGet`). El N+1 de
  presentación desaparece. Entrada conservada como trazabilidad.

### v1.19-sealed-tcgcsv (referencia de mercado del sellado) — deuda aceptada del pase (2026-08-17, no bloqueante)

### BE-44 · Restos del pase sealed-TCGCSV: error-code por cast, upsert money-safe duplicado, heurística sin validar
- **Dónde:** (a) `src/modules/pricing/sealed-pricing.controller.ts:19`; (b) `src/modules/pricing/pricing.service.ts`
  (`persistSealedMarketReference`, ~:340-376, vs `persistMarketReference`); (c)
  `src/modules/pricing/providers/tcgcsv-sealed.provider.ts` (heurística de "sellado", ~:130) + sus fixtures de test.
- **Qué / por qué:**
  - **(a) `UPSTREAM_ERROR` tipado por cast local.** El código 502 `UPSTREAM_ERROR` está en el contrato (§M2,
    explorador TCGCSV) pero NO en `src/common/error-codes.ts`, porque `common/` (zona compartida) estaba
    **serializada a otro stream** en esta ventana. El controller lo tipa con
    `'UPSTREAM_ERROR' as ErrorCodeType` (cast local documentado). Follow-up de **1 línea** (añadirlo al
    enum `ErrorCode`) en cuanto `common/` quede libre.
  - **(b) upsert diario money-safe duplicado.** `persistSealedMarketReference` duplica ~35 líneas de
    `persistMarketReference`: construcción de la clave compuesta
    `cardId_productType_gradeKey_finish_capturedDate`, la guardia `existing?.isManualOverride` (NO clobbear
    el override manual del admin) y el `upsert` create/update. Deliberado en el pase (hermano documentado)
    pero la **doctrina money-safe debe vivir en UN solo sitio**. Dirección: extraer un privado común
    `upsertDailyReference(key, data)` que ambos llamen; si un fix de la guardia (p. ej. un edge del override)
    aterriza en una sola copia, la otra diverge en silencio sobre dinero.
  - **(c) heurística de sellado + fixtures sin validar contra payloads reales.** La detección de "producto
    sellado" del adapter TCGCSV (product SIN los extendedData de single) y los fixtures de test se
    escribieron contra la documentación/muestras, **sin validar contra payloads reales** de tcgcsv.com
    (egress bloqueado en local). Riesgo: clasificar mal un product en la primera corrida real. **Candado:**
    el dial `sealed_price_source` tiene seed **`off`** (fail-closed); la ingesta no corre hasta que el
    humano/devops flipee a `tcgcsv` en staging.
- **Impacto:** bajo. (a) cosmético/tipado; (b) mantenibilidad sobre camino de dinero (correctness OK hoy,
  riesgo de divergencia futura); (c) acotado por el dial `off` — sin corrida real no hay dato malo persistido.
- **Disparador:** (a) primer pase que libere/toque `common/` (fix de 1 línea); (b) próximo toque a la familia
  `persistMarketReference`/ingesta de precios; (c) **1ª corrida en staging** con el dial en `tcgcsv`:
  validar la heurística contra los payloads reales y ajustar fixtures antes de considerar prod.
- **Dueño:** **backend**. Prioridad: **baja** (aceptada por techlead en el veredicto v1.19).

### Nota (baja) · La clave del Map de `getReferencesBatch` se reconstruye a mano en 6 sitios (familia BE-4/BE-25/BE-35)
- **Qué:** la clave `` `${cardId}|${productType}|${gradeKey}|${finish}` `` del `Map` que devuelve
  `PricingService.getReferencesBatch` se re-arma **a mano** en 6 sitios: `pricing.service.ts:107` (`keyOf`,
  privada), `admin.service.ts:314,319`, `catalog.service.ts:99` e `inventory.service.ts:431,629`. Un cambio
  de formato de la clave (p. ej. un campo nuevo) rompería consumidores en silencio (miss del Map → pending).
- **Dirección:** exportar un helper `referenceKey(item)` desde `pricing.service.ts` (o devolver un objeto con
  `get(item)`) y migrar los 5 sitios consumidores. Misma familia que **BE-4/BE-25/BE-35** (batch de
  referencias); pagarlo junto con la próxima migración de esa familia. Dueño: **backend**. Prioridad: **baja**.

### Stream «Inventario y vault» (v1.20/v1.20.1) — ronda final post-gates (2026-08-17, no bloqueante)

> Cierre del stream «Inventario y vault» tras el doble veredicto. **BE-45 y BE-46 se PAGARON en este
> mismo stream** (autorizado por techlead sin re-review) y **BE-47 quedó CERRADA por el contrato
> v1.20.1-adjustments-clarify**; BE-48..BE-50 quedan **abiertas, aceptadas no bloqueantes**. Al final
> se anotan dos pendientes de **OTROS streams** detectados por QA en este gate (dueño: backend de sus
> respectivos streams — NO se tocaron aquí). Continúa la numeración `BE-*` (tras BE-44). Detalle de
> implementación en `docs/BACKEND_NOTES.md §45.7`.

### BE-45 · Update incondicional de status en ajuste y bulk-publish (TOCTOU) — PAGADA (2026-08-17, este stream)
- **Dónde:** `src/modules/inventory/inventory.service.ts` → `adjustExisting` (el update dentro de la
  `$transaction`, antes ~:816-833) y `bulkPublish` (el paso a `listed`, antes ~:478).
- **Estado:** **PAGADA.** Ambos sitios hacían check-then-act: validaban el allowlist de status sobre el
  snapshot leído y luego escribían con `update` **incondicional** — una carrera (p. ej. un checkout que
  pone la pieza `reserved` entre lectura y escritura) podía pisar la reserva con `lost|damaged|withdrawn`
  o re-listar una pieza reservada (double-sell).
- **Fix:** guardia **atómica** en el propio UPDATE: `updateMany({ where: { id, ownerType:'platform',
  status: { in: ADJUSTABLE_ORIGIN_STATUSES | PUBLISHABLE_ORIGIN_STATUSES } } })` + `count === 1`; si
  `count !== 1` → `422 ITEM_NOT_ADJUSTABLE` (ajuste, con rollback de la tx) / `ITEM_NOT_PUBLISHABLE`
  por-línea (bulk-publish). El pre-check en memoria se conserva solo para mensajes amables. Cubierto con
  tests de carrera (`test/inventory.adjustments.spec.ts`, `test/inventory.batch.spec.ts`).

### BE-46 · Raw SQL del índice master set duplicaba a mano la lista de status on-hand — PAGADA (2026-08-17, este stream)
- **Dónde:** `src/modules/inventory/master-set.service.ts` → `aggregateInventoryBySet` (raw SQL, ~:383)
  vs la constante exportada `NOT_ON_HAND` (~:29, usada por `scopeWhere` y `admin-vaults.service.ts`).
- **Estado:** **PAGADA.** El `AND ii.status NOT IN ('withdrawn', 'shipped', ...)` reescribía la lista
  literal — dos fuentes de verdad que podían divergir al tocar el enum. Ahora el SQL interpola la
  constante: `ii.status::text NOT IN (${Prisma.join(NOT_ON_HAND)})` (parametrizado por Prisma, cast
  `::text` para comparar el enum con los parámetros). Una sola fuente de verdad para "on-hand".

### BE-47 · Doble submit del drawer de ajuste duplicaba piezas (`encontrada` sin idempotencia) — CERRADA por v1.20.1 (2026-08-17)
- **Dónde:** `POST /admin/inventory/adjustments` (`inventory.service.ts` → `adjustFound`).
- **Estado:** **CERRADA** por el contrato **v1.20.1-adjustments-clarify** (§M1) implementado en este
  stream: `batchKey?` opcional **solo** en la rama `encontrada`, con la MISMA semántica e infraestructura
  `InventoryBatch` (M-21) que `batchCreate` — **sin migración nueva** (claim atómico `create({ id:
  batchKey, kind:'adjust' })` PRIMERO dentro de la `$transaction`; P2002 → replay del ganador). Un replay
  devuelve la **respuesta original guardada** con `idempotentReplay: true` y **200** (aunque la primera
  vez fuera 201). `batchKey` con otro motivo → `400 VALIDATION_ERROR` (esos motivos tienen idempotencia
  natural: su replay cae en `422 ITEM_NOT_ADJUSTABLE`). De paso se implementó la otra aclaración v1.20.1:
  `adjustmentIds: string[]` (una fila M-24 por pieza, alineada 1:1 con `inventoryItemIds`/`folios`)
  **sustituye** al singular `adjustmentId` (cierra la nota de BACKEND_NOTES §45.4).

### BE-48 · `AdjustmentFoundItemInput` es copia casi 1:1 de `BatchInventoryItemInput` (Baja)
- **Dónde:** `src/modules/inventory/dto/inventory.dto.ts` → `AdjustmentFoundItemInput` (~:146-162) vs
  `BatchInventoryItemInput` (~:95-110).
- **Estado actual:** los dos DTOs comparten 12 de 13 campos (decoradores incluidos); la ÚNICA diferencia
  real es `acquisitionType` (obligatorio en el lote, opcional con default `aportacion_en_especie` en el
  ajuste). Un cambio de validación en el alta (p. ej. un tope nuevo) hay que replicarlo a mano en la copia
  — riesgo de divergencia silenciosa.
- **Impacto:** bajo. Mantenibilidad; correctness OK hoy (el servicio reusa `resolveCreation`, así que la
  lógica de negocio NO está duplicada — solo la capa de validación del DTO).
- **Disparador:** al tocar cualquiera de los dos DTOs. Dirección: **derivar/extraer una base común**
  (p. ej. clase base con los campos compartidos y `AdjustmentFoundItemInput extends` relajando solo
  `acquisitionType`, o `OmitType`/`PartialType` de `@nestjs/mapped-types`).

### BE-49 · `GET /admin/vaults` valúa TODAS las bóvedas por request; `getReferencesBatch` escala con el histórico (Media a futuro)
- **Dónde:** `src/modules/vault/admin-vaults.service.ts` (`list`: 1 `findMany` de TODAS las piezas de
  bóveda + 1 `getReferencesBatch` para valuar y ordenar globalmente ANTES de paginar) +
  `src/modules/pricing/pricing.service.ts` (`getReferencesBatch`, que lee `PriceReference` con un WHERE
  por combinaciones y resuelve "la más reciente" en memoria — su costo crece con el histórico diario de
  `PriceReference`, ver BE-20). Detalle adicional: en ese camino `gradeKeyFor` se calcula **dos veces**
  por pieza (una para armar el lote de combinaciones y otra al mapear el resultado) — trabajo redundante
  que conviene izar a una sola pasada al pagar esta deuda.
- **Impacto:** hoy O(1) queries y correcto; con **histórico real de PriceReference** (30-40k filas/día,
  BE-20) o **miles de piezas** en bóveda, la valuación por-request se vuelve el cuello del listado admin.
- **Disparador (aceptado):** **antes de staging con histórico real de precios o con miles de piezas.**
  Dirección: materializar la valuación por usuario (familia `InventoryStockSummary`/BE-4/D3) o resolver
  "última referencia por combinación" en SQL (`DISTINCT ON`) en vez de cargar+filtrar en memoria, y
  calcular `gradeKeyFor` una sola vez por pieza.

### BE-50 · Índice master set en scope `user_vault` agrega sobre el catálogo COMPLETO (Baja)
- **Dónde:** `src/modules/inventory/master-set.service.ts` → `index()` con scope `user_vault`: las
  agregaciones (`cardSet` + `card.groupBy` + raw de variantes de catálogo + raw de piezas) corren sobre
  TODOS los sets del catálogo y el filtro "solo sets con ≥1 pieza del usuario" se aplica DESPUÉS, en
  memoria.
- **Impacto:** bajo hoy (queries fijas, catálogo acotado); al crecer el catálogo (cientos de sets tras el
  backfill), cada vista "Mi bóveda"/admin-bóveda paga la agregación del catálogo entero para mostrar los
  3-4 sets del usuario.
- **Disparador (aceptado):** al crecer el catálogo o si el índice de bóveda se siente lento. Dirección:
  **acotar primero a los sets del usuario** (una query corta `SELECT DISTINCT c."setId" FROM
  InventoryItem ii JOIN Card c ...` con el WHERE del scope) y agregar solo sobre esos setIds.

### Re-verificación QA v1.20.1 (2026-08-17) — hallazgos MENORES no bloqueantes

> De la **re-verificación de QA sobre v1.20.1-adjustments-clarify** (idempotencia `batchKey` en
> ajustes `encontrada`, ver BE-47). Ambos son **menores, no bloqueantes**, dueño **backend**.
> Continúa la numeración `BE-*` (tras BE-50).

### BE-51 · Lookup de replay idempotente de adjustments no filtra `kind:'adjust'` (Baja)
- **Dónde:** `backend/src/modules/inventory/inventory.service.ts` L778 y L876:
  `inventoryBatch.findUnique({ where: { id: batchKey } })`.
- **Estado actual:** el lookup de replay resuelve por `id` sin filtrar `kind:'adjust'`; una **colisión de
  clave** con un batch previo `create`/`publish` replayaría un `resultJson` **ajeno** como
  `InventoryAdjustmentResponse`.
- **Impacto:** riesgo práctico **~nulo**: las claves son UUID con prefijo `adj-` (colisión inviable en la
  práctica) y el endpoint es solo admin. Además es un **patrón pre-existente idéntico** en
  `batchCreate`/`bulkPublish` (mismo lookup sin filtro de `kind`).
- **Disparador:** próximo toque de la infraestructura `InventoryBatch`. Dirección: **filtrar por `kind`
  en el lookup** (y valorar hacerlo también en los caminos hermanos `batchCreate`/`bulkPublish`).

### BE-52 · Catch de P2002 en la tx de ajuste interpreta cualquier violación de unique como carrera de batchKey (Baja)
- **Dónde:** `backend/src/modules/inventory/inventory.service.ts` L873-884 (catch de **P2002** dentro de
  la `$transaction` de `adjustFound`).
- **Estado actual:** el catch trata **cualquier** violación de unique como carrera del claim de
  `batchKey`. Con folios generados por secuencia, otra fuente de P2002 es **prácticamente inalcanzable**
  y, si ocurriera, **falla seguro**: 409 CONFLICT sin duplicación. (Nota informativa: 409 está en los
  códigos comunes del contrato §0 aunque no aparece en la ficha §M1.)
- **Impacto:** bajo. A lo sumo un 409 con causa mal atribuida en un caso hoy inalcanzable; sin riesgo de
  duplicación ni de dinero.
- **Disparador:** próximo toque de esa transacción. Dirección: **acotar el catch al target del claim de
  `InventoryBatch`** (inspeccionar `error.meta.target` / modelo antes de mapear a la carrera de batchKey).

### Pendientes de OTROS streams detectados por QA en este gate (2026-08-17 — NO son de este stream)

> Anotados aquí por trazabilidad a petición del gate; **dueño: backend de sus respectivos streams**
> («Cuentas y acceso» / zona común de throttling). Este stream NO los tocó (regla 8: el hallazgo vuelve
> al rol/stream responsable).

### XS-1 · `jwt-auth.guard.ts:37` devuelve 422 UNAUTHENTICATED en vez de 401 (contrato §0) — stream «Cuentas y acceso»
- **Dónde:** `src/common/guards/jwt-auth.guard.ts:37` — la rama "sin header Bearer" lanza
  `BusinessException.validation('UNAUTHENTICATED', ...)` que mapea a **422**; el contrato §0 exige
  **401** para `UNAUTHENTICATED` (las otras dos ramas del guard ya usan 401 explícito).
- **Impacto:** medio-bajo: rompe el contrato de status para clientes/interceptores que disparan el
  refresh de token con `response.status === 401` (una petición sin token recibiría 422 y no refrescaría).
- **Dirección:** `new BusinessException('UNAUTHENTICATED', 401, 'Missing bearer token')` (paridad con
  las líneas :48/:63 del mismo guard) + test de contrato del guard. **Fix trivial pero fuera de este
  stream**; requiere pasar por los gates de su stream.

### XS-2 · 5 fallos DETERMINISTAS de la suite de integración por rate-limit (login throttle + throttle B-C1) vs harness E2E — **CERRADA (2026-08-18, backend)**
- **Dónde:** `backend/test/integration/*` corriendo contra el stack levantado: el throttle de login
  (`auth.controller.ts`, familia `@Throttle` anti fuerza-bruta) y el throttle dedicado del cotizador
  batch (B-C1, 12/min — ver BACKEND_NOTES §40) se AGOTAN con la cadencia del harness E2E (todos los
  specs se loguean/cotizan en ráfaga desde la MISMA IP del runner) → **5 tests fallan de forma
  determinista** con 429, sin bug funcional detrás.
- **Impacto:** **bloqueará la suite E2E completa de release** (gate de QA por-release): los 429 son
  falsos negativos reproducibles, no flakes.
- **Dirección:** **dial de throttle para entorno E2E** — p. ej. límites configurables por env
  (`THROTTLE_*` que el harness/compose de E2E suba, sin tocar los defaults de prod) o allowlist de la IP
  del runner SOLO en el perfil E2E. Los límites de producción NO se relajan. Dueño: backend del stream
  correspondiente, coordinado con **devops** (harness/compose) y verificación de **seguridad** (toca
  diales anti fuerza-bruta).
- **CERRADA (2026-08-18, backend — ver BACKEND_NOTES §46.2):** en vez de un dial de límites (que sí
  habría podido relajarse por error en un entorno real), el `ThrottlerGuard` se sustituyó por
  `AppThrottlerGuard`, que **omite el rate-limiting solo si `NODE_ENV === 'test'`**
  (`src/config/test-env.ts`; no hay env var capaz de apagarlo en staging/prod, con test que lo prueba).
  Cubre a la vez el throttle de login y el B-C1 del cotizador batch, porque actúa sobre el guard y no
  sobre la config global. Los límites configurados quedan **intactos** y el 429 real sigue verificado
  punta a punta en `test/integration/auth-throttle.e2e-spec.ts` (que re-activa el throttler a
  propósito). Pendiente de que **seguridad** lo valide en su gate de release.

> Deuda aceptada, no bloqueante para el MVP. El cliente compila y pasa lint/typecheck/test/build; todas
> las pantallas priorizadas funcionan contra los shapes del contrato. Lo de abajo es lo que queda para la
> fase de integración con el backend real y post-MVP. Detalle operativo en `docs/FRONTEND_NOTES.md`.

### FE-1 · Mocks activos por default + `computeBreakdown` duplica la fórmula de dinero
- **Dónde:** `frontend/src/lib/config.ts` (`useMocks` default `true`), `frontend/src/lib/api.ts`
  (`computeBreakdown`, réplica local de ARCHITECTURE §5.1) y `frontend/src/lib/mock/fixtures.ts`.
- **Estado actual:** con `NEXT_PUBLIC_USE_MOCKS` distinto de `"false"` el cliente sirve fixtures locales.
  El desglose de dinero de esos fixtures se calcula con `computeBreakdown` (subtotal + IVA 16% + fee
  gross-up), que **duplica** la fórmula del backend solo para tener números coherentes en los mocks.
- **Impacto:** riesgo de **divergencia** si el backend cambia IVA/markup/tarifa Stripe o la fórmula de
  gross-up: los mocks mostrarían cifras que ya no coinciden. En producción no aplica (la UI solo pinta el
  `BreakdownDTO` que llega del backend), pero mantener la fórmula duplicada puede confundir.
- **Disparador:** al integrar con backend real (`NEXT_PUBLIC_USE_MOCKS=false`). Acción: **eliminar**
  `computeBreakdown` del camino real y consumir el `BreakdownDTO` del backend (incluido `ivaRatePct`) como
  **única fuente**; dejar la fórmula solo en fixtures o retirarla del bundle de producción.

### FE-2 · Integraciones reales pendientes (auth, Stripe, presign de fotos, mutaciones admin)
- **Dónde:** `frontend/src/components/domain/AuthForm.tsx` (token local simulado en `localStorage`),
  `frontend/src/app/[locale]/(storefront)/checkout/CheckoutView.tsx` y `.../shipments/ShipmentsView.tsx`
  (pago simulado, sin Stripe Elements), `frontend/src/components/ui/PhotoUploader.tsx` (subida simulada,
  sin presign PUT), y las vistas admin M1/M3/M5/M8 (acciones sin `mutation` cableada a `/admin/*`).
- **Estado actual:** el cliente API tipado (`frontend/src/lib/api.ts`) ya llama a las rutas reales del
  contrato cuando `useMocks=false`; faltan las piezas que dependen de credenciales/SDK externos y las
  mutaciones de escritura del panel.
- **Impacto:** hasta cablearlas, no hay auth real, no se cobra por Stripe, no se suben fotos a S3/MinIO y
  las decisiones de admin no persisten. No afecta la navegación ni la lectura del MVP con mocks.
- **Disparador:** fase de integración con backend. Acción: montar `@stripe/stripe-js` + Elements con el
  `clientSecret` de `POST /checkout/session` y `POST /shipments`; auth con `POST /auth/login|register|refresh`,
  `GET /users/me` y `PATCH /users/me { locale }`; `POST /uploads/presign` + `PUT` directo en `PhotoUploader`;
  y `useMutation` para M1 alta, M3 refund, M5 decisiones/convert/pay-spei, M8 resolve.

### FE-3 · UI de módulos admin M2/M7/M9/M10 en placeholder
- **Dónde:** `frontend/src/app/[locale]/(admin)/admin/{m2,m7,m9,m10}/page.tsx` +
  `frontend/src/components/domain/ModuleTodo.tsx`.
- **Estado actual:** M1, M3, M4, M5, M6 y M8 (más dashboard) tienen UI funcional; M2 (precios/FX/override),
  M7 (finanzas/P&L/export CSV), M9 (reportes) y M10 (config/diales/bitácora) muestran un placeholder
  `ModuleTodo`. Los tipos y rutas del contrato ya están mapeados.
  - **ACTUALIZACIÓN 2026-08-16 (housekeeping ronda-c):** **M6 salió de esta lista** — ya **no** es placeholder.
    `m6/page.tsx` monta el `M6View` completo (ficha 360°, KYC, alta/reset/borrado, historial por pestañas,
    VaultTab enriquecido). Corrección factual: la entrada listaba M6 por inercia tras v1.7/ronda-c.
- **Impacto:** faltan superficies del back-office; no bloquea las verticales priorizadas del MVP.
- **Disparador:** post-MVP / fase 2, o cuando el negocio necesite operar esos módulos desde la UI. Acción:
  construir las vistas consumiendo `/admin/pricing/*`, `/admin/fx`, `/admin/finance/*`,
  `/admin/reports/*`, `/admin/settings` y `/admin/audit-log`, reutilizando `DataTable`, `StatCard`,
  `Modal` y el enmascarado por rol ya existentes.

### FE-4 · Sesión/enmascarado por rol simulados en cliente
- **Dónde:** `frontend/src/lib/role.tsx` (contexto que alterna `super_admin`/`vault_operator` vía
  `localStorage`) y `frontend/src/lib/api-client.ts` (token en `localStorage`).
- **Estado actual:** el rol de back-office se elige con un switch en el topbar para **demostrar** el
  enmascarado financiero y el bloqueo de dinero saliente; el backend deriva el rol del JWT. No hay guardas
  de ruta reales ni expiración/refresh de token en el cliente.
- **Impacto:** el enmascarado del cliente es **presentacional**; la autorización real la impone el backend
  (contrato §7). Sin auth real, cualquiera puede cambiar el switch de rol. No es una brecha de producción
  porque el servidor manda, pero la UX de sesión está incompleta.
- **Disparador:** junto con FE-2 (auth real). Acción: derivar el rol de `GET /users/me`, proteger las rutas
  `(admin)/*` según rol, y manejar refresh/expiración y `403 MONEY_OUT_FORBIDDEN` desde el backend.

### FE-5 · Fuente Inter no self-hosted (fallback de sistema)
- **Dónde:** `frontend/src/app/globals.css` (`--font-inter: 'Inter'` con fallback `system-ui`) y
  `frontend/tailwind.config.ts` (`fontFamily.sans`).
- **Estado actual:** para evitar dependencia de red en el build (descarga de Google Fonts), no se usa
  `next/font`; los tokens tipográficos del DESIGN_SYSTEM ya están listos, pero si el sistema no tiene Inter
  se cae a la fuente del sistema.
- **Impacto:** cosmético/consistencia de marca entre entornos; sin efecto en accesibilidad ni layout
  (los tamaños/pesos y `tabular-nums` se respetan igual).
- **Disparador:** al pulir el look final o cuando devops confirme acceso a fuentes en build. Acción:
  self-host de Inter (variable) vía `next/font/local` o `next/font/google` con subconjunto `latin`+`latin-ext`.

### FE-6 · Persistencia de `locale` con sesión pendiente
- **Dónde:** `frontend/src/components/ui/LocaleToggle.tsx`.
- **Estado actual:** el toggle ES/EN cambia el idioma por ruta (`[locale]`), pero no persiste la preferencia
  en `User.locale` (`PATCH /users/me`) porque aún no hay auth real; sin sesión, depende del prefijo de ruta.
- **Impacto:** bajo. El idioma funciona y es consistente por navegación; solo falta recordar la preferencia
  del usuario logueado entre dispositivos.
- **Disparador:** junto con FE-2 (auth real). Acción: al cambiar locale con sesión activa, llamar
  `PATCH /users/me { locale }` además de actualizar la ruta.

### Deuda del pase v1.1 (hallazgos techlead sobre alcance v1.1)

> De este pase v1.1: **D6 quedó RESUELTA** (el botón de Google ya no se atasca en "connecting" al
> descartar el prompt de GIS: se maneja `PromptMomentNotification` + timeout de respaldo, con test).
> **D7** se registra aquí como deuda aceptada no bloqueante (sin cambiar el comportamiento del mock).

### D7 · La lógica de negocio del mock re-implementa reglas del backend y puede derivar
- **Dónde:** `frontend/src/lib/api.ts` → `computeBreakdown` (desglose de dinero de checkout/envíos) y
  `getBuylistQuote` (cotizador de buylist), ambos solo en la rama `config.useMocks`.
- **Estado actual:** duplicación de **reglas de negocio** del backend, con dos derivas concretas:
  - `computeBreakdown` calcula el gross-up del fee Stripe **omitiendo `(1 + stripeFeeIvaPct)`**: hace
    `total = ceil((base + fixed) / (1 − stripePct))` sin cubrir el IVA que Stripe MX cobra sobre su
    comisión (dial `stripe_fee_iva_pct`, default 0.16; ver ARCHITECTURE §5.1 y contrato §4). El
    `processingFeeCents` del mock queda **por debajo** del que devolverá el backend.
  - `getBuylistQuote` **reimplementa** `categoryForRarity`/`quoteAcquisition` con una **regex propia**
    (`/holo|rare|ex|illustration|full|art|radiant|ultra/`) en lugar de la tabla `pricing/rarity-map`
    (dial M2/M10) y de la regla EX+ = `round(referencia × 0.40)` que vive en el backend/contrato §6.
- **Impacto:** bajo pero real: es duplicación que **envejece** — si el backend cambia la fórmula de
  gross-up, el IVA/markup o el mapeo rareza→categoría, los fixtures mostrarían cifras/categorías que ya
  no coinciden. **Aceptable** porque está **aislado tras `config.useMocks`** (solo demo sin backend); en
  producción (`useMocks=false`) la UI pinta el `BreakdownDTO`/quote que llega del backend, única fuente.
  (Es la misma familia que FE-1, aquí acotada a las dos derivas puntuales señaladas por techlead.)
- **Disparador:** si el mock **crece** o empieza a usarse como referencia numérica. Acción: mover los
  fixtures a consumir los **mismos helpers puros del contrato** (gross-up con `(1+stripeFeeIvaPct)` y
  `categoryForRarity`/`quoteAcquisition` compartidos), o retirar la lógica del bundle real. **No** se
  cambia el comportamiento del mock ahora (evita romper fixtures/E2E que asumen los números actuales).

### Deuda del pase rediseño 5a (hallazgos qa/techlead — no bloqueante, aceptada)

> Del pase de **rediseño 5a**. Los **dos MUST-FIX de accesibilidad** (foco visible en el `<select>` de
> switch de rol del AdminTopbar; contraste AA del token `--color-success` + consistencia del anillo de
> foco en los inputs crudos de `ShopFilters`/`CatalogView`) **ya se corrigieron** en su pase y **no**
> figuran como deuda (ver `FRONTEND_NOTES.md`). IDs prefijados `5a-` para no colisionar con FE-1..6/D7.
>
> **ACTUALIZACIÓN 2026-08-16 (pase "destacadas por precio + cierre 5a en lote"):** las **cinco** entradas
> `5a-D1/D3/D4/D5/D6` quedaron **CERRADAS** (ver detalle en cada una y en `FRONTEND_NOTES.md`). Ya **no**
> hay deuda 5a abierta. Se conservan como registro histórico.

### 5a-D1 · `ConditionBadge` huérfano + lógica de condición triplicada — CERRADA (eliminado)
- **Dónde:** `frontend/src/components/ui/ConditionBadge.tsx` (+ su test) — **eliminados**.
- **Estado (2026-08-16):** **CERRADA por opción (b): eliminación.** `ConditionBadge` estaba huérfano (solo
  lo importaba su propio test). Se decidió **eliminarlo** en vez de adoptarlo porque el rediseño 5a sustituyó
  la fila de pastillas (condición + acabado + cert) por el renglón mono `ListingSpec`, y la ficha de detalle
  (`CardDetailView`) pinta la condición como `Fact` de **texto plano** coherente con la dirección minimalista
  ratificada (con `CertNumberField` para el cert gradeado). Adoptar `ConditionBadge` (Badge/pastilla de color)
  en esos Facts de texto plano sería forzado y reintroduciría pastillas que el rediseño quitó a propósito. Ya
  no hay triplicación: quedan dos presentaciones intencionalmente distintas (renglón mono `ListingSpec` en
  retículas; texto plano en la ficha). `GradedCertChip` sobrevive intacto (lo usa el back-office M8). Cubierto
  por el E2E `catalog.spec.ts:56` (la ficha pinta la condición legible). Entrada conservada como histórico.

### 5a-D3 · Grosor de anillo de foco inconsistente (3px hardcodeado vs token 2px) — CERRADA
- **Dónde:** `DisputeEvidenceContact.tsx` y `PhotoUploader.tsx` (los que quedaban con 3px inline).
- **Estado (2026-08-16):** **CERRADA.** Se unificaron a **`shadow-focus` (2px)** los `shadow-[0_0_0_3px_...]`
  de `DisputeEvidenceContact` (link mailto + botón Copiar) y `PhotoUploader` (botón de captura). `Button.tsx`
  ya no tenía inline (usa el `:focus-visible` global). Verificado: grep `shadow-[0_0_0_3px` → **0 matches**.
  Todo el foco es el `outline` global o `shadow-focus` 2px, consistente con Input/Select. Sin doble anillo.

### 5a-D4 · `ListingSpec` compacto (graded) omite `certNumber` en el `aria-label` — CERRADA
- **Dónde:** `frontend/src/components/domain/ListingSpec.tsx` (variante `compact` para producto `graded`).
- **Estado (2026-08-16):** **CERRADA.** La variante compacta de graded ahora compone el `aria-label` con
  **empresa + grado + cert SIEMPRE** (§7.2b), aunque el texto **visible** siga abreviado (sin cert en la
  retícula). Se construye `gradedAriaLabel` cuando el cert se omite del visible; el `aria-label` final es el
  tooltip NM (raw) o `gradedAriaLabel` (graded compacto). Solo se enriqueció el aria-label; el visible no cambió.

### 5a-D5 · Vars `--radius-*` / `--shadow-*` muertas en `globals.css` (Tailwind hardcodea 0) — CERRADA
- **Dónde:** `frontend/src/app/globals.css`.
- **Estado (2026-08-16):** **CERRADA.** Se **quitaron** las vars muertas `--radius-sm/md/lg/xl` (Tailwind
  hardcodea `borderRadius: 0px`; nadie consume `var(--radius-*)` — verificado por grep). **No** existían vars
  `--shadow-*` en `globals.css` (el único boxShadow con var es `boxShadow.focus` en tailwind.config, que SÍ se
  usa). **No** se tocó `--color-focus-ring` ni `boxShadow.focus`.

### 5a-D6 · (nota) `PortfolioTrendChart` hardcodea hex de la paleta como fallback de recharts — DEGRADADA
- **Dónde:** `frontend/src/components/domain/PortfolioTrendChart.tsx`.
- **Estado (2026-08-16):** **DEGRADADA a resuelta en la práctica.** El fallback que estaba **desalineado**
  (`LIGHT.up = #4E7A49`, viejo verde pre-AA) se corrigió a **`#4a7345`** = el token vivo `--color-success`
  (ya ajustado al fix de contraste AA). Ya no hay drift en el primer paint: los hex de fallback coinciden con
  los tokens actuales de `globals.css`, y `useTrendColors` sigue leyendo los tokens reales tras montar. La
  mejora estructural (leer TODOS los colores vía `getComputedStyle` en vez de literales) queda como
  refinamiento opcional sin impacto observable; ya **no** hay divergencia numérica que registrar.

### Ronda B — deuda surgida en verdictos (2026-08-16, no bloqueante)

- **RB-1 (backend) — CERRADA (v1.8-ronda-c):** taxonomía de auditoría de jobs unificada a `jobs.<name>.run`
  (`portfolio_snapshot` era el único sin `.run`; ahora `jobs.portfolio_snapshot.run`). `admin-jobs.controller.ts`.
- **RB-2 (backend) — CERRADA (v1.8-ronda-c):** `entityType: 'Job'` + `entityId: '<job>'` presentes en TODA la
  auditoría de `/admin/jobs/*` (paridad con los disparos M2). `admin-jobs.controller.ts`.
- **RB-3 (backend) — CERRADA (v1.8-ronda-c):** `assertApprovedPriceWithinCap` recibe el cap AML ya resuelto por
  `itemDecision`, que honra `kyc.capPerRequestCentsOverride` con fallback al dial global (misma fuente que
  `createRequest`). Cubierto en `test/buylist.ronda-c.spec.ts`.
- **RB-4 (backend) — DIFERIDA:** factor de uplift `2×` (`APPROVED_PRICE_UPLIFT_FACTOR`) sigue como constante de
  código; subir a dial `ConfigSetting`/M10 cuando el negocio quiera ajustarlo sin redeploy. No bloqueante.
- **RB-5 (backend) — CERRADA (v1.8-ronda-c):** JSDoc corregido en `buylist-sweep.service.ts` (era "30d →
  convertida_inventario"; el código setea `abandonada`) e `ine-retention.service.ts` (era "scheduling BullMQ es
  deuda BE-5"; ya cableado).
- **RB-6 (backend) — CERRADA (v1.8-ronda-c):** `SellRequest.approvedTotalCents` se escribe server-side (helper
  `recomputeApprovedTotal` = suma de `approvedPriceCents` por ítem, invocado en `itemDecision`; `null` si no hay
  aprobados). El P&L / tarjeta "buylist del periodo" (`admin.dashboard`) ya lo lee. Cubierto en
  `test/buylist.ronda-c.spec.ts`.
- **SEC-D1 (devops) — DIFERIDA:** lifecycle/retención a nivel de bucket R2 para cubrir INE huérfano si falla la
  purga por API. Fuera del alcance de backend (devops/humano).
- **SEC-D2 (backend/arquitecto) — CERRADA (v1.8-ronda-c):** `SellRequest.closedAt` (M-19) sellado en las
  transiciones terminales (`pagada`/`rechazada`/`abandonada`); `ine-retention` lo usa como fuente del cierre con
  fallback al cálculo por timestamps para filas legacy. Cubierto en `test/buylist.ronda-c.spec.ts`,
  `test/buylist-sweep.closedat.spec.ts`, `test/ine-retention.spec.ts`.
- **SEC-D3 (backend, pentest) — CERRADA (v1.8-ronda-c):** hallazgo Info del pentest, **par de RB-6**
  (`docs/SECURITY_NOTES.md` RC.0 / BACKEND_NOTES §27.5): `SellRequest.approvedTotalCents` se LEÍA en
  P&L/dashboard pero nunca se escribía → la tarjeta "buylist del periodo" sumaba 0/null. Resuelto por el
  mismo fix de RB-6 (`recomputeApprovedTotal` server-side). Blue team lo dio por cerrado.

### Ronda C — deuda surgida en verdictos (2026-08-16, no bloqueante)

> Hallazgos NUEVOS de los verdictos de Ronda C (qa/techlead/seguridad), todos **no bloqueantes**. RB-7 es
> **PENDIENTE-DECISIÓN** (cambio de máquina de estados: no se implementa sin negocio + arquitecto). El resto
> son fixes pequeños diferidos a un próximo round; los que tocan PII/retención requieren re-verificación
> qa+seguridad al abordarse.

- **RB-7 (techlead #1) — PENDIENTE-DECISIÓN — `closedAt` no se sella cuando TODOS los items se rechazan
  vía `itemDecision('reject')`.** El `SellRequest` queda en estado no-terminal (`verificacion`), `closedAt`
  sigue `null` e `ine-retention` **nunca purga** esa INE (sobre-retención — dirección conservadora, no fuga,
  pero contradice el diseño SEC-D2 de minimización de PII). Owner: **backend**, pero es un **cambio de
  comportamiento / máquina de estados** → requiere PRIMERO **decisión de negocio del humano + arquitecto**:
  ¿una solicitud con todos los items rechazados debe transicionar sola a `rechazada`? **NO implementar** hasta
  esa decisión. Prioridad: **media** (cumplimiento PII/LFPDPPP).
- **SEC-E1 (seguridad, pre-existente) — `ine-retention` elige `lastClosed` por `orderBy createdAt desc`
  en vez de `max(closedAt)`.** En escenarios multi-solicitud podría anclar la retención a un cierre anterior
  y purgar unos días antes de lo debido. Recomendación: anclar a **`max(closedAt)`**. Owner: **backend**.
  Prioridad: **baja** (edge, pre-existente — no introducido por Ronda C). Candidato a próximo round: fix
  pequeño y localizado, pero **requiere re-verificación qa+seguridad** por tocar el camino de PII.
- **RB-8 (techlead #2) — regla de valuación "referencia vigente = más reciente por acabado" duplicada.**
  Vive por partida doble en `PricingService.getReference` y en el batch inline de `admin.service.ts` →
  `ownedItemRefs`. Dirección: extraer `PricingService.getReferencesBatch(items)` y compartirlo con
  `holdings`, `ownedItemRefs`, `inventoryValue`, `custodyValue` (de paso cierra el N+1 de la familia
  BE-4/D3). Owner: **backend**. Prioridad: **baja** (diferido por escala; misma familia BE-4/D3).
- **BE-9b (techlead #3) — dedup de validación incompleto para email.** `MIN_PASSWORD_LENGTH` sí es fuente
  única (cerrado en BE-9), pero el **formato de email diverge**: `RegisterDto` usa `@IsEmail` (class-validator)
  y el camino admin usa `EMAIL_REGEX` (más laxo, en `common/validation/credentials.ts`). Owner: **backend**.
  Prioridad: **baja**. Nota: unificar `RegisterDto` al helper **cambia el set de emails aceptados** (validación
  de auth) → si se hace, va **con re-verificación**.

### v1.9-set-chart — cierre post-veredicto (2026-08-16, no bloqueante)

> Feature ya aprobada por **qa + techlead + seguridad**. En este cierre se aplicaron **DOS fixes baratos**
> recomendados por los revisores (**SEC-F1** y **TD-2**, marcados RESUELTOS abajo) y se registran las deudas
> **no bloqueantes** restantes. Todas Owner **backend**, prioridad **baja/informativa**. Gates verdes tras el
> cierre: lint/typecheck/build OK, **57 suites / 371 tests**. Detalle en `docs/BACKEND_NOTES.md §29`.

- **SEC-F1 (seguridad) — RESUELTO (2026-08-16).** Los 2 endpoints públicos de la gráfica
  (`GET /catalog/featured-set/value-history` y `GET /catalog/sets/:id/value-history`) NO tenían `@Throttle`
  propio: colgaban solo del límite global (300/min). Se les añadió `@Throttle({ default: { ttl: 60_000,
  limit: 60 } })` (**60/min por IP**) en `catalog.controller.ts`, en **PARIDAD** con los otros públicos
  anti-scraping (`BuylistCatalogController`, mismo patrón/import). Sin config nueva.
- **TD-2 (techlead) — RESUELTO (2026-08-16).** `SetValueSnapshot` (M-20) tenía `@@unique([setId, asOfDate])`
  **y** `@@index([setId, asOfDate])` (mismas columnas, mismo orden) → el `@@index` era **redundante** (el
  índice del `@@unique` ya sirve las consultas por rango, con menor coste de escritura). Se eliminó del
  `schema.prisma` **y** del `migration.sql` de M-20 (edición **en sitio**: la migración M-20 NO se ha aplicado
  en ningún entorno — egress bloquea prod, tests con mocks — así que no requiere migración nueva). Verificado
  con `prisma validate` (schema válido); schema y migración quedan coherentes (índice quitado en ambos).
- **TD-1 / RB-8-family — regla de valuación del set (extracción PARCIAL aplicada).** La regla
  raw/`raw:NM`/`normal` + "referencia vigente = más reciente por capturedDate" estaba duplicada entre
  `set-value.service.ts:computeSetValue` (lectura/agregación) y `set-price-sync.service.ts` (escritura), y es
  además la MISMA semántica de `PricingService.getReference`. Deliberada (evita N+1) pero con riesgo de
  divergencia. **En este cierre** se extrajo la constante `SET_VALUE_RULE` (las 3 llaves de tipo/grado/acabado)
  a `set-value.service.ts`, reusada por `computeSetValue` **y** el job `set-price-sync` (escritura y lectura ya
  no divergen en los literales). **Queda como deuda** unificar la *lógica* de "más reciente por capturedDate"
  con `getReference` vía un `getReferencesBatch` compartido (misma dirección que **RB-8/BE-4/D3**, diferido por
  escala). Owner: **backend**. Prioridad: **baja**.
- **TD-3 — cargas en memoria en `resolveFeaturedSet` (fallback-2) y `computeSetValue`.** Ambas leen tablas
  completas a memoria (`SetValueSnapshot` para elegir el set más valioso; `Card` + sus `PriceReference` del set
  para agregar) y resuelven el "más reciente por X" en JS. Crecen con el histórico. **Inocuo hoy**: el request
  público (`featuredSetHistory`/`setHistoryById`) **NO** invoca `computeSetValue` — solo lee `SetValueSnapshot`
  ya materializado; `computeSetValue` corre en el job diario. Dirección: `DISTINCT ON`/`groupBy` al escalar.
  Owner: **backend**. Prioridad: **baja**.
- **SEC-F2 — `:id` de `GET /catalog/sets/:id/value-history` sin validación de formato.** No hay `ParseUUIDPipe`
  ni chequeo de forma; **sin impacto**: Prisma parametriza la query (sin inyección) y un id inexistente/mal
  formado cae en `findUnique` → **404 NOT_FOUND**. Dirección: validar formato si se quiere devolver 400 antes de
  tocar BD. Owner: **backend**. Prioridad: **baja**.
- **QA-min (informativo) — fallback-3 de `resolveFeaturedSet` ordena `releaseDate` como String.** El orden
  lexicográfico es **correcto** para el formato `yyyy/MM/dd` de pokemontcg.io (mismo orden que cronológico).
  Solo habría que endurecerlo (parseo a fecha) si entraran `releaseDate` con **otros formatos**. Owner:
  **backend**. **Informativo** (sin acción hoy).

### Gate SAST — endurecimiento cripto GCM en PII (2026-08-16, no bloqueante)

- **SAST-1 (backend) — RESUELTA (2026-08-16) — `createDecipheriv` GCM sin `authTagLength` (tag truncado
  aceptado).** Regla semgrep `javascript.node-crypto.security.gcm-no-tag-length` (registry `p/*`) marcó
  `src/common/crypto/pii-crypto.service.ts` → `decrypt()`: `createDecipheriv('aes-256-gcm', key, iv)` seguido
  de `setAuthTag(tag)` **sin** fijar `authTagLength`. Node acepta authTags GCM más cortos de 16 bytes, así que
  un atacante capaz de manipular el ciphertext almacenado (`v1:iv:tag:ct` en BD) podría presentar un **tag
  truncado** y debilitar la autenticidad GCM (riesgo de forja). Defensa en profundidad sobre PII (CLABE/RFC/INE).
  **Fix (endurecimiento interno, retrocompatible — NO cambia el formato serializado ni las claves):**
  (1) `decrypt()` valida `tag.length === 16` **antes** de `setAuthTag` y, si no, lanza el mensaje genérico
  `'Malformed PII ciphertext'` (mismo que un payload mal formado → **sin oráculo** que distinga el motivo);
  (2) ambos `createCipheriv`/`createDecipheriv` fijan explícitamente `{ authTagLength: 16 }`. Los authTags que
  produce `encrypt()` (`cipher.getAuthTag()`) siempre son de 16 bytes, así que los datos ya cifrados descifran
  igual. Tests en `test/pii-crypto.spec.ts`: round-trip OK + rechazo de tag truncado (12B), vacío y
  sobredimensionado (20B). Gates verdes: lint/typecheck/build OK, **57 suites / 372 tests**. Detalle en
  `docs/BACKEND_NOTES.md`. Owner: **backend**. Queda pendiente el **veredicto de seguridad + qa** (toca PII/cripto).

- **SAST-2 (backend) — RESUELTA (2026-08-16) — supply-chain HIGH/CRITICAL en node-tar / tmp (gate
  `trivy-image`).** El SAST de imagen del backend reportó CVEs reales en deps transitivas:
  - **`tmp`** (CVE-2026-44705, path traversal por prefix/postfix; fixed **>= 0.2.6**): devDependency
    transitiva `@nestjs/cli@10.4.9 → inquirer@8.2.6 → external-editor@3.1.0 → tmp@0.0.33`. Viajaba a la
    imagen porque `Dockerfile.backend` hace `npm ci --include=dev` sin poda (devops, DEVOPS_NOTES §6).
  - **`tar` (node-tar)** (CVE-2026-26960/-29786/-31802/-59874, hardlink path traversal + DoS; fixed
    **>= 7.5.18**): **no presente** en el árbol del backend (`npm ls tar` → vacío; ningún `node_modules/**/tar`;
    Prisma descarga sus engines sin node-tar). Sin fix necesario en el árbol actual.
  - **Fix:** `overrides` en `backend/package.json`: `"tar": ">=7.5.18"` (pin defensivo por si reaparece) y
    `"tmp": ">=0.2.6"`. Lockfile regenerado (`npm install` + `npm ci --include=dev`): **`tmp` → 0.2.7
    `overridden`** (cascadea sin romper el peer `^0.0.33`; elimina la sub-dep `os-tmpdir`); `tar` sigue ausente.
  - **Gates:** lint/typecheck/build OK; `npm test` **57 suites / 372 tests** (sin cambio de conteo; solo deps).
    Detalle en `docs/BACKEND_NOTES.md §30`. Owner: **backend**. El **verde final del gate lo confirma el runner
    de CI** (trivy-image necesita docker build + DB de trivy; egress bloqueado en local).

### Ola 2 — deudas techlead de Ola 1 (frontend, 2026-08-17)

> Las 3 deudas menores de mantenibilidad anotadas por **techlead** en la Ola 1 (dueño: **frontend**).
> Las tres eran triviales y limpias, así que se **RESOLVIERON** en la misma Ola 2 (junto con la gestión
> de inventario M1). Gates verdes tras el cierre: lint/typecheck/build OK, **35 archivos / 202 tests**.
> Detalle en `docs/FRONTEND_NOTES.md` (sección Ola 2).

- **TL-FE-1 — RESUELTA (2026-08-17) — paginación duplicada en ramas mock.** `getAdminShipments`,
  `getAdminUsers`, `searchBuylistCards` y `getAuditLog` repetían inline el slice de paginación
  (`pageSize/page/start`) en vez de usar el helper `paginate<T>` que ya existía para el historial 360°.
  **Fix:** `paginate<T>(rows, { page?, pageSize? })` se movió a la cabecera de `frontend/src/lib/api.ts`
  (junto a `delay`) y las 4 funciones lo reusan. De paso `getAdminShipments` ganó slicing real (antes
  devolvía TODAS las filas ignorando `page/pageSize` en mock).
- **TL-FE-2 — RESUELTA (2026-08-17) — generadores mock inline duplicados.** Los literales
  `` `job-${Math.floor(Math.random()*9000+1000)}` `` (3 sitios: `syncPricing`, `syncCatalog`,
  `syncAllCatalog`) y `` `Tmp-${...}-${...}` `` (2 sitios: `resetUserPassword`, `createAdminUser`) se
  extrajeron a los helpers privados `mockJobId()` / `mockTempPassword()` en `frontend/src/lib/api.ts`.
- **TL-FE-3 — RESUELTA (2026-08-17) — interfaz vacía `AdminBuylistItemDTO`.** `frontend/src/types/contract.ts`
  declaraba `export interface AdminBuylistItemDTO extends SellItemDTO {}` sin ningún consumidor (verificado
  por grep: solo la declaración). Se **eliminó**; `AdminBuylistDTO.items` ya tipaba `SellItemDTO[]` directo.

### Delta rama `claude/git-repo-review-c67xyk` — review techlead (2026-08-17, no bloqueante)

> Aprobado por **techlead** CON DEUDA ANOTADA. Cinco ítems de mantenibilidad/a11y/UX del delta, dueño
> **frontend**. No bloqueantes; registrados a petición del techlead sin tocar código de producción.
> Continúan la numeración `FE-*` (tras FE-1..6). FE-10 y FE-11 provienen de hallazgos QA (relacionados
> con BE-11 / gating de KYC).

### FE-7 · Doble fuente de verdad para "email bloqueado" en el gating de buylist
- **Dónde:** `frontend/src/hooks/useSellRequirements.ts:57` vs.
  `frontend/src/components/domain/BuylistKycForm.tsx:78`.
- **Estado actual:** `BuylistKycForm` **recomputa su propio** `emailBlocked` en lugar de recibir
  `sellReq.emailBlocked` por prop del hook. Lo necesita para el caso **403 en respuesta**, pero el gating
  **proactivo** podría venir del hook. Quedan dos lugares que calculan lo mismo y evolucionan por separado.
- **Impacto:** bajo. Deuda menor de mantenibilidad; riesgo de divergencia si la regla de "email bloqueado"
  cambia en un solo sitio.
- **Disparador:** al tocar el gating de buylist otra vez. Acción: **unificar en una sola fuente** (prop
  `emailBlocked` proveniente del hook), dejando el manejo del 403 como reacción a la respuesta.

### FE-8 · CTAs de login/register duplicados en la vista de buylist
- **Dónde:** `frontend/src/app/[locale]/(storefront)/buylist/BuylistView.tsx` — `SellRequirementsPanel`
  (cuando no hay sesión) **y** un bloque inline (~líneas 544-560).
- **Estado actual:** hay dos puntos que pintan el mismo llamado a iniciar sesión / registrarse cuando el
  usuario no tiene sesión: el panel de requisitos y un bloque inline aparte. Redundancia visual y lógica.
- **Impacto:** bajo. No bloqueante; posible inconsistencia si uno de los dos cambia y el otro no.
- **Disparador:** al pulir la vista de buylist. Acción: **consolidar en un solo punto de CTA sin sesión**.

### FE-9 · `SyncProgress` usa `role="status"` en vez de `role="progressbar"` — RESUELTO (2026-08-19)
- **Dónde:** `frontend/src/app/[locale]/(admin)/admin/m2/M2View.tsx` (componente `SyncProgress`).
- **Estado:** **RESUELTO** (solo el componente `SyncProgress`; sin cambio de contrato ni de lógica de sync).
- **Fix:** la barra ahora expone `role="progressbar"` con `aria-valuemin/max/now` + `aria-valuetext`
  sobre el elemento de la barra, y se retiró el `role="status"`/`aria-live` del contenedor que
  re-anunciaba el bloque completo cada ~3 s. El lector de pantalla anuncia el cambio de `aria-valuenow`
  de forma nativa y menos verbosa. No hay tests que dependieran del `role="status"` y `SyncProgress` no
  se usa fuera de M2. Deja el componente listo para reutilizarse en la barra de precios (N-11).

### FE-10 · Barra "completada" persiste tras terminar el barrido (hallazgo QA, par de BE-11)
- **Dónde:** `frontend/src/app/[locale]/(admin)/admin/m2/M2View.tsx` — condición de render `running || total>0`.
- **Estado actual:** con el estado del `sync-status` en memoria del proceso (ver **BE-11**), al reentrar a M2
  se pinta la barra verde "Sincronización completada: N sets" del **último** barrido de forma indefinida
  (hasta que el proceso se reinicie o se dispare un nuevo barrido). Quirk de UX; no bloquea.
- **Impacto:** bajo. Cosmético/UX: puede confundir sobre si hay un barrido "reciente", pero no altera datos
  ni acciones.
- **Disparador:** cuando **BE-11** pase a progreso **persistido** (BullMQ). Acción: decidir cuándo
  ocultar/expirar el estado "completada" (p. ej. TTL o descarte al montar tras `finishedAt`).

### FE-11 · Staff no consulta KYC en el gating de venta (hallazgo QA, intencional/inocuo)
- **Dónde:** `frontend/src/hooks/useSellRequirements.ts:48`.
- **Estado actual:** para roles `vault_operator`/`super_admin` **no** se llama `GET /users/me/kyc` (evita el
  403), por lo que `SellRequirementsPanel` les muestra "CLABE no registrada" aunque técnicamente puedan
  enviar. **Intencional** (staff casi no vende); anotado por completitud.
- **Impacto:** muy bajo. Solo afecta la señal visual de requisitos para cuentas staff, que no es el flujo de
  venta objetivo; no hay error funcional ni fuga.
- **Disparador:** si el staff empieza a vender de verdad. Acción: resolver el gating de KYC para roles staff
  (consulta condicional o endpoint que no devuelva 403 para staff, coordinando con backend/arquitecto).

### Rediseño del cotizador — Fase 3a (commit 10d5205, 2026-08-17, no bloqueante)

> Del **rediseño del cotizador (Fase 3a)**. Ítems pedidos por **techlead** y **qa** sobre el delta del
> buylist. No bloqueantes, dueño **frontend**. Registrados a petición del techlead/qa sin tocar código de
> producción. Continúan la numeración `FE-*` (tras FE-1..11).

### FE-12 · Fan-out del auto-quote + bulk all-or-nothing (techlead + qa)
- **Dónde:** `frontend/src/app/[locale]/(storefront)/buylist/BuylistView.tsx` — `ResultQuote` (~:95-114) y
  `addSelectedToCart` (~:254-293).
- **Estado actual:** `ResultQuote` monta un `useQuery` **por resultado visible** → una búsqueda dispara
  ~`pageSize` (≤20) `POST /buylist/quote` en ráfaga (**mitigado** por queryKey compartido + `staleTime` 5min,
  que deduplica y cachea). El bulk `addSelectedToCart` usa `Promise.all` **all-or-nothing**: si una carta
  falla al cotizar, no se agrega **ninguna** al carrito de venta.
- **Impacto:** medio-bajo. Riesgo de topar el **throttle público 300/min** con paginación intensa (muchas
  búsquedas seguidas); y UX all-or-nothing en el bulk (un fallo aislado bloquea todo el lote). Correctness OK.
- **Disparador:** cuando exista el endpoint **batch quote (Fase 3b)** — colapsa el fan-out a **1 request** y
  permite resultado parcial; o si las búsquedas empiezan a devolver **listas grandes**. Acción: consumir el
  batch quote (una llamada por página) y cambiar el bulk a **parcial-tolerante** (agregar lo que sí cotizó,
  reportar lo que falló).

### FE-13 · `BuylistView.tsx` creció (1115 líneas) — pide extracción de hooks/subcomponentes (techlead) — RESUELTA (ronda de corrección Stream C, 2026-08-21)
- **Estado:** **RESUELTA** en la ronda de corrección del gate Stream C (hallazgo TL-C3: tercer toque sin
  pagar el compromiso «sin tercer aplazamiento»). Extracción MECÁNICA, sin cambio de comportamiento, a la
  misma carpeta de la ruta: `useSellCart.ts` (carrito + `mergeCartLine` + cantidades + `expandedLines` +
  totales derivados, handlers estables con `useCallback`), `SellCartContents.tsx` (contenido del drawer:
  requisitos → líneas → total → CTA → vaciar, con `QuoteRow`/`ruleText`) y `MyRequestsSection.tsx`
  ("Mis solicitudes" + mutación de respuesta al ajuste F5, dueña de su query `['sell-requests']`).
  `BuylistView.tsx` quedó como orquestador (787 líneas). Red de seguridad: los 41 tests conductuales de
  `BuylistView.test.tsx` pasan idénticos antes y después (43 tras los 2 nuevos de TL-C2). El registro
  original queda abajo para trazabilidad.
- **Dónde:** `frontend/src/app/[locale]/(storefront)/buylist/BuylistView.tsx` (1115 líneas, medido
  2026-08-17; antes ~960).
- **Estado actual:** el archivo concentra carrito de venta, selección bulk, cotización por resultado, "Mis
  solicitudes" y el panel de resultados. La lógica sigue encapsulada en funciones pequeñas → la extracción
  sería **mecánica y de bajo riesgo**. Costuras identificadas por el techlead como guía: `SellCart`
  (~líneas 666-860), `ResultsGrid` (~595-658), `MyRequestsSection` (~884-1033), hooks
  `useSellCart`/`useBulkSelection` (12 `useState` viven hoy en el componente); los helpers puros ya están
  aislados (`mergeCartLine`, `quoteFor`, `tileFinishes`).
- **Impacto:** **medio** (subió de bajo). Mantenibilidad/legibilidad; no afecta comportamiento ni
  correctness, pero el archivo siguió creciendo tras aplazar la extracción.
- **Disparador:** **consumido una vez** — el disparador original («próximo toque funcional del buylist, p.
  ej. al cablear el batch quote de FE-12») **se cumplió** en el rediseño 2026-08-17 (se cableó el batch
  quote y se pagó FE-12) y la extracción **no se pagó**. Compromiso: extraer los hooks y subcomponentes
  citados (sin cambiar comportamiento) en el **siguiente** toque de BuylistView, **sin tercer
  aplazamiento**.

### Editor de venta en M2 — Fase 2 (commit fee3c19, 2026-08-17, no bloqueante)

> Del pase **Fase 2** (editor de reglas de venta por rareza en M2). Ítem pedido por **techlead**, dueño
> **frontend**. Registrado a petición del techlead sin tocar código de producción. Continúa la numeración
> `FE-*` (tras FE-12/13).

### FE-14 · Duplicación del editor buylist/venta en `M2View.tsx` (techlead) — **RESUELTA (2026-08-22, `fix/variant-composition-regression`, junto con TD-1)**
- **Dónde:** `frontend/src/app/[locale]/(admin)/admin/m2/M2View.tsx` — secciones 4 (reglas de compra) y 5
  (reglas de venta) → ahora `m2/sections/BuylistRulesSection.tsx`, `SalesRulesSection.tsx` y el compartido
  `RuleAxisEditor.tsx`.
- **Estado actual:** ~~las dos secciones son **clones ~1:1**~~ **RESUELTA.** La estructura común de los dos ejes
  (rareza canónica + acabado, fallback, save/cancel, banners) vive una sola vez en `<RuleAxisEditor>`
  presentacional; las diferencias reales (modelo numérico vs texto crudo, preservar vs limpiar valor al
  cambiar de modo, validación S-P1-1 de venta, fallback default 40 vs 15, copy `pctHint`, tope pct) se
  parametrizan desde cada sección vía props/view-models de fila. Sin cambio de comportamiento; 568/568 tests
  verdes. Ver TD-1 y `docs/FRONTEND_NOTES.md`.

### Limpieza WS-B (auto-refresh de token) — deuda del delta (2026-08-17, no bloqueante)

> Del pase de **limpieza sobre WS-B** (auto-refresh de token, ya en main). En este pase el frontend corrigió
> un **comentario factualmente incorrecto** del single-flight en `api-client.ts` (afirmaba que el backend
> **ROTA** el refresh token en cada uso y que refresh paralelos "se invalidarían entre sí" — **FALSO**:
> `auth.service.ts` `refresh()` firma con el `tokenVersion` VIGENTE y NO incrementa ni persiste nada (JWT
> stateless) → el refresh viejo sigue válido tras refrescar y dos refresh en paralelo NO se invalidan entre
> sí) y **dedupó** `logout` para que delegue en `clearClientSession` (una sola fuente de limpieza de sesión).
> Los ítems de abajo son la deuda **no bloqueante** que el **techlead** señaló y quedó diferida. Dueño
> **frontend**. Continúan la numeración `FE-*` (tras FE-14).

### FE-15 · Auto-refresh NO universal: `exportFinanceCsv` usa fetch directo (fuera del interceptor)
- **Dónde:** `frontend/src/lib/api.ts` → `exportFinanceCsv` (~:1936-1960).
- **Estado actual:** el interceptor `401 → refresh → reintento` vive en `apiRequest`/`requestWithRefresh`
  (`api-client.ts`). `exportFinanceCsv` hace `fetch` directo con `Authorization: Bearer` manual (necesita leer
  **texto** CSV, no JSON) y por eso **NO** pasa por el interceptor: si el access token (15m) venció, el export
  CSV falla con **401 sin auto-refrescar**. (Nota: `uploadToPresignedUrl` **NO** es deuda — usa URL firmada
  sin bearer y **debe** evitar el interceptor a propósito.)
- **Impacto:** bajo. Admin-only (finanzas/`super_admin`) y **benigno**: en cuanto **cualquier** llamada que sí
  pase por `apiRequest` refresque el token (navegar/recargar la vista), un reintento del export funciona; un
  reintento **aislado** del export seguiría fallando porque no refresca por sí mismo. Sin fuga ni pérdida de datos.
- **Disparador:** al unificar el cliente HTTP o si el 401 en export molesta en operación. Acción: extraer un
  helper de `fetch` con refresh (o una variante de `apiRequest` que devuelva **texto**) y enrutar
  `exportFinanceCsv` por él, reusando `refreshTokensShared`.

### FE-16 · Huecos de tests del auto-refresh (single-flight concurrente, red, cuerpo 200 malformado)
- **Dónde:** `frontend/src/lib/api-client.ts` (`refreshTokens`, `refreshTokensShared`, `requestWithRefresh`) y
  su suite `frontend/src/lib/api-client.test.ts`.
- **Estado actual:** la suite cubre el 401→refresh→reintento, el no-bucle, `/auth/*`, sin-refresh-token y
  no-401; **faltan** tres casos: (1) **single-flight concurrente** — dos `apiRequest` que reciben 401 a la vez
  comparten **UNA** sola llamada a `/auth/refresh` (`refreshInFlight`); (2) la rama **`catch` de error de red**
  en `refreshTokens` (fetch que lanza → devuelve `null`, no bloquea); y (3) el **cuerpo 200 malformado** (200
  sin `accessToken`/`refreshToken` → se trata como fallo y devuelve `null`).
- **Impacto:** bajo. Calidad/mantenibilidad: la lógica funciona hoy, pero un refactor podría regresar el
  single-flight o el manejo de fallos sin que un test lo señale.
- **Disparador:** próximo pase de hardening de tests o al tocar el interceptor de refresh. Acción: agregar esos
  tres casos (dos 401 concurrentes con assert de **una** llamada a refresh; `fetchMock.mockRejectedValueOnce`;
  y un 200 con body incompleto).

### FE-17 · `pay()` / `requestWithdrawal()` usan try/catch + `useState` en vez de `useMutation` (patrón inconsistente)
- **Dónde:** `frontend/src/app/[locale]/(storefront)/checkout/CheckoutView.tsx` (`pay()` ~:93) y
  `frontend/src/app/[locale]/(storefront)/shipments/ShipmentsView.tsx` (`requestWithdrawal()` ~:159).
- **Estado actual:** el resto del proyecto dispara mutaciones de red con **`useMutation`** de TanStack Query
  (estados `isPending`/`isError`/`isSuccess`, `reset`, invalidación de cache). Estas dos acciones que **tocan
  dinero/custodia** (crear sesión de checkout; solicitar retiro) siguen el patrón viejo: `async function` con
  `try/catch/finally` + banderas manuales en `useState` (`creating`/`payError`/`emailNotVerified`, etc.). El
  comportamiento es correcto (bloquea doble envío, muestra el error real), pero el patrón diverge del estándar.
- **Impacto:** bajo. Mantenibilidad/consistencia: dos formas de hacer lo mismo; el estado manual es más fácil de
  desincronizar en un refactor (p. ej. olvidar `setCreating(false)` en una nueva rama) y no reusa la invalidación
  declarativa de cache. Sin fuga ni bug funcional hoy.
- **Disparador:** al tocar cualquiera de las dos vistas o en un pase de unificación de acceso a datos. Acción:
  migrar ambas a `useMutation` (mapear `EMAIL_NOT_VERIFIED`/errores en `onError`, `isPending`→loading del botón),
  como ya hacen M1/M2/M5/M6.

### FE-18 · `PrivateRouteGuard` acopla la lista de rutas privadas por prefijo (frágil)
- **Dónde:** `frontend/src/components/layout/PrivateRouteGuard.tsx` (`PRIVATE_PREFIXES`, `isPrivatePath`).
- **Estado actual:** el guard de cliente decide qué rutas exigen sesión con una **lista hardcodeada de prefijos**
  (`['/vault', '/orders', '/shipments', '/checkout']`) comparada contra el `pathname`. Cada ruta privada nueva
  hay que **acordarse** de añadirla a ese array; si se olvida, la vista se renderiza sin sesión y solo revienta
  al pegarle al backend (401 críptico) — justo lo que el guard evita.
- **Impacto:** bajo-medio. Mantenibilidad/seguridad-de-UI: es defensa de UI (el backend sigue siendo la
  autoridad), pero la lista puede quedar desincronizada del árbol de rutas real. Acoplamiento por convención de
  strings, no por estructura.
- **Disparador:** al añadir una nueva sección privada del storefront, o al reorganizar rutas. Acción: mover las
  rutas privadas a un **route group `(protected)`** de Next (App Router) cuyo `layout` monte el guard, de modo que
  la privacidad la determine la **ubicación en el árbol**, no una lista paralela de prefijos.

### FE-19 · Lógica de auth-redirect duplicada entre `AdminShell` y `PrivateRouteGuard` (extraer `useAuthGate`)
- **Dónde:** `frontend/src/components/layout/AdminShell.tsx` y `frontend/src/components/layout/PrivateRouteGuard.tsx`.
- **Estado actual:** ambos componentes implementan **el mismo patrón** casi idéntico: `requireAuth = !config.useMocks`,
  `useEffect` que en modo real hace `router.replace({ pathname: '/login', query: { next: pathname } })` cuando
  `ready && !isAuthenticated`, y un estado de carga (`aria-busy`) mientras se resuelve la sesión — para no mostrar
  contenido que dará 401. AdminShell añade encima el chequeo de **rol** de back-office; el resto es copia.
- **Impacto:** bajo. Mantenibilidad: dos copias del mismo criterio de redirección (`next`, modo mock, orden de
  `ready`/`isAuthenticated`); un cambio de política de auth-redirect hay que hacerlo en dos sitios y es fácil que
  se separen.
- **Disparador:** al tocar la política de redirección o al añadir un tercer consumidor. Acción: extraer un hook
  `useAuthGate({ requireRole? })` que devuelva `{ blocked, redirecting }` y centralice el `useEffect` + el criterio;
  AdminShell lo consume con `requireRole` de back-office y PrivateRouteGuard sin rol.

### Pulido de veredicto WS-E frontend (Master Set) — deuda del delta (2026-08-17, no bloqueante)

> Del pase de **pulido de WS-E** (cierre de hallazgos NO bloqueantes del veredicto). Se **RESOLVIERON**
> en ese mismo pase, y por tanto **NO** figuran como deuda: **techlead #1** (`batchKey` ESTABLE por sesión
> de carrito en `MasterSetPanel`/`CellDrawer` → un reintento por timeout reusa la key = replay idempotente,
> no duplica piezas); la **UX del bulk-publish del `CellDrawer`** (deshabilitar checkboxes de piezas cuyo
> status ∉ `{in_stock, listed}`, hint del porqué); y **techlead #3** (dedup de `FINISH_ORDER` a
> `@/lib/finish.ts`, importado por los 5 consumidores). Lo de abajo es la deuda FE no bloqueante restante.
> Continúan la numeración `FE-*` (tras FE-19).

### FE-20 · Extraer `ItemCaptureFields` compartido entre M1 (alta manual) y `CellDrawer` (techlead #2)
- **Dónde:** `frontend/src/app/[locale]/(admin)/admin/m1/M1View.tsx` (form de alta manual) y
  `frontend/src/app/[locale]/(admin)/admin/m1/master-set/CellDrawer.tsx` (alta rápida → carrito).
- **Estado actual:** ambos formularios capturan casi los MISMOS campos de una pieza (productType, finish,
  gradingCompany/gradeValue/certNumber, acquisitionType/pct, location, qty) con su propia copia de estado
  (`useState`) y de las reglas de visibilidad (finish solo si raw; cert requerido si graded; pct solo si
  aportación). Divergen en detalles (M1 incluye `sealed`; el drawer no). El techlead lo marcó como
  **"candidato #1 a divergir"**: un cambio de captura (p. ej. un campo nuevo o una regla de validación) hay
  que replicarlo en dos sitios.
- **Impacto:** bajo hoy (correctness OK), medio en mantenibilidad: alto riesgo de que las dos capturas se
  separen sin que nada lo señale.
- **Disparador:** al añadir/cambiar un campo de captura de pieza, o en un pase de unificación. Acción:
  extraer un `ItemCaptureFields` (componente presentacional + un tipo/estado compartido) que ambos monten,
  parametrizado por los product types permitidos.

### FE-21 · `getAdminInventory({ pageSize: 100 })` en `CellDrawer` sin paginación (cap silencioso) (techlead #4)
- **Dónde:** `frontend/src/app/[locale]/(admin)/admin/m1/master-set/CellDrawer.tsx` (query `cell-pieces`).
- **Estado actual:** la lista de piezas publicables de una carta pide `pageSize: 100` en **una sola página**,
  sin controles de paginación ni indicación de "hay más". Si una carta tiene **>100 piezas de plataforma**
  en bóveda, las excedentes **no se muestran** ni se pueden seleccionar para bulk-publish — cap **silencioso**.
- **Impacto:** bajo hoy (raro tener >100 piezas de la MISMA carta), medio a escala. No corrompe nada; solo
  oculta piezas del operador.
- **Disparador:** cuando una carta acumule >100 piezas de plataforma, o en el pase de virtualización del
  binder (FE-22). Acción: paginar la lista del drawer (o al menos avisar "mostrando 100 de N" + cargar más).

### FE-22 · Fase-2 del binder: virtualización + export/import CSV del lote
- **Dónde:** `frontend/src/app/[locale]/(admin)/admin/m1/master-set/MasterSetBinder.tsx` (grid completo) y el
  carrito de captura (`MasterSetPanel.tsx`).
- **Estado actual:** el binder pinta TODAS las celdas del set de una vez (mitigado con `loading=lazy` +
  `content-visibility:auto`), sin virtualización; el lote de captura/publicación no tiene export/import CSV.
  El contrato §M1 marca explícitamente **virtualización y CSV como fase 2** (fuera de WS-E).
- **Impacto:** bajo. Sets acotados (~200-400 cartas) rinden aceptablemente con el lazy actual; el CSV es una
  comodidad de captura a escala, no un bloqueo.
- **Disparador:** sets muy grandes o captura/inventario masivo por lote. Acción: virtualizar el grid
  (`@tanstack/react-virtual` o similar) y añadir export/import CSV del carrito.

### FE-23 · Gating de M5 duplicado (tabs por etapa vs booleans de acción) → un solo mapa status→capacidades
- **Dónde:** `frontend/src/app/[locale]/(admin)/admin/m5/M5View.tsx` (`M5_TABS` por etapa + `canDecide`/
  `showMoneyOut`/gating de convertir).
- **Estado actual:** la **agrupación por etapa** (qué `status` cae en cada pestaña) y las **capacidades por
  acción** (`canDecide`, `showMoneyOut`, convertir habilitado) derivan del `status` en **dos lugares
  independientes** con sus propias condiciones. Señalado por el techlead de WS-G P2: conviene un **único
  mapa** `status → { etapa, capacidades }` del que salgan ambas cosas, para que no puedan desincronizarse.
- **Impacto:** bajo (correctness OK hoy), medio en mantenibilidad: un cambio de máquina de estados de venta
  hay que reflejarlo en las tabs Y en los booleans de acción por separado.
- **Disparador:** al tocar la máquina de estados de `SellRequest`/`SellItem` o al añadir una acción/etapa.
  Acción: un solo mapa declarativo `status → capacidades` consumido por tabs y por las acciones.

### FE-24 · Rol crudo residual en `M6View` (§9.2 "nunca el enum crudo")
- **Dónde:** `frontend/src/app/[locale]/(admin)/admin/m6/M6View.tsx`.
- **Estado actual:** WS-G P1/P2 tradujo el rol en el topbar (`admin.roles.*`) y varios enums de M1/M5, pero
  la ficha 360° de usuario (M6) aún muestra en algún punto el **valor crudo del rol** (enum del contrato) en
  vez del label traducido, contra la convención §9.2 (el valor técnico solo debe vivir en `title`/`aria-label`).
- **Impacto:** bajo. Cosmético/consistencia i18n; no afecta datos ni permisos (el rol lo autoriza el backend).
- **Disparador:** próximo toque de M6 o un pase de consistencia i18n admin. Acción: mapear el rol por
  `admin.roles.{customer,vault_operator,super_admin}` en M6, dejando el enum en `title`/`aria-label`.

### WS «Inventario y vault» — cierre v1.20.1 (2026-08-17, no bloqueante)

> Hallazgos del veredicto del **techlead** en el cierre del stream «Inventario y vault» (master set en
> todas partes + ajuste por levantamiento físico, contrato v1.20/v1.20.1). Aceptados como deuda
> **no bloqueante**, dueño **frontend**. Continúan la numeración `FE-*` (tras FE-24).

### FE-25 · Props de `MasterSetPanel` permiten estados ilegales (`mode` con default + `userId?` sueltos)
- **Dónde:** `frontend/src/components/master-set/MasterSetPanel.tsx:24-27` (interfaz `Props`: `mode?` con
  default `'platform'` y `userId?` independientes), y sus consumidores del `userId ?? ''`:
  `frontend/src/components/master-set/MasterSetIndex.tsx:38` y
  `frontend/src/components/master-set/MasterSetBinder.tsx:43`.
- **Estado actual:** `mode` y `userId` son props sueltas: el tipo acepta combinaciones ilegales
  (`user_vault_admin` **sin** `userId`, o `platform` **con** `userId` ignorado). En el caso malo real,
  `fetchIndex`/`fetchBinder` hacen `userId ?? ''` y disparan un request a
  `GET /admin/vaults//master-sets` → **404 opaco** en runtime en vez de un error de compilación. Además el
  default `mode = 'platform'` hace que **omitir** `mode` monte silenciosamente la vista con MÁS capacidades
  (captura/publicación/ajuste) en lugar de fallar.
- **Impacto:** bajo-medio. Hoy los tres call-sites reales pasan props correctas (M1, `/admin/vaults`,
  `VaultView`), pero el tipo no protege al siguiente consumidor; el fallo se manifiesta como 404 críptico de
  red, no como error de tipos. Sin fuga de datos (el backend valida scope/rol por su lado).
- **Disparador:** al añadir un consumidor nuevo del panel o al tocar `mode.ts`. Acción (dirección acordada
  con el techlead): **unión discriminada de props** —
  `{ mode: 'platform' } | { mode: 'user_vault_admin'; userId: string } | { mode: 'user_vault_self'; onBuyMissing?: … }` —
  y **quitar el default** de `mode` (siempre explícito). Propagar la unión a `MasterSetIndex`/`MasterSetBinder`
  para eliminar los `userId ?? ''`.

### FE-26 · `PlatformPiecesSection` (CellDrawer) acumula publicación + ajuste (~240 líneas, ~12 useState, 2 mutaciones)
- **Dónde:** `frontend/src/components/master-set/CellDrawer.tsx:290-532` aprox. (función
  `PlatformPiecesSection`).
- **Estado actual:** una sola función-componente concentra DOS features de M1 que solo comparten la query de
  piezas: (a) publicación por lote (selección + `bulkPublishItems` + render por-línea) y (b) ajuste por
  levantamiento físico (motivo, formulario `encontrada`/pieza+nota, `createInventoryAdjustment` con batchKey
  idempotente v1.20.1). ~240 líneas, ~12 `useState` y 2 `useMutation` entrelazados. Además `adjustFinish` se
  **inicializa desde props** (`useState(availableFinishes[0] …)` = estado derivado): si el drawer se
  **reutilizara sin desmontar** para otra celda (hoy se desmonta al cerrar, por eso no muerde), el acabado
  inicial quedaría stale respecto de la nueva carta.
- **Impacto:** bajo. Funciona y está testeado (17 specs del master set); el costo es de mantenibilidad:
  cualquier cambio en una feature obliga a razonar sobre el estado de la otra, y el estado derivado es una
  trampa latente ante un refactor del ciclo de vida del drawer.
- **Disparador:** al volver a tocar el drawer (nueva feature o fix) o si el drawer pasa a reutilizarse sin
  desmontar. Acción (dirección acordada con el techlead): extraer **`AdjustSection` a su propio archivo**
  recibiendo `pieces` por props (la query queda en el padre), y eliminar el estado derivado de `adjustFinish`
  (derivarlo en render con override del usuario, o re-sincronizar con `cell.cardId` por `key`).

### WS «Órdenes y dinero» — guest checkout, frontend (2026-08-18, no bloqueante)

> Hallazgos de **techlead** y **QA** en el cierre del stream «Órdenes y dinero» sobre la parte de
> **frontend** (checkout de invitado + seguimiento público por token, contrato v1.21/v1.21.1).
> Ninguno bloquea: el veredicto de código fue **sin hallazgos**; estas dos son deudas de diseño
> defensivo y de cobertura. Aceptadas como deuda **no bloqueante**, dueño **frontend** (FE-28 con
> cadencia compartida con QA). Continúan la numeración `FE-*` (tras FE-26).

### FE-27 · La `queryKey` del seguimiento público no incluye el token (aislamiento por caché, no por clave) (Media)
- **Dónde:** `frontend/src/app/[locale]/pedido/TrackingPageClient.tsx:46` —
  `useQuery({ queryKey: ['guest-order-track'], queryFn: () => trackGuestOrder(token) })`.
- **Estado actual:** la clave de caché es **constante** para un recurso que es **por-token**: dos
  pedidos distintos comparten la misma entrada en el `QueryClient`. Hoy no se manifiesta porque la
  query se configuró con `gcTime: 0` y `staleTime: 0` (y `retry: false`), así que nunca hay una
  entrada viva que reutilizar. Es decir: **el aislamiento entre pedidos lo está sosteniendo la
  configuración de caché, no la identidad del recurso**.
- **Impacto:** medio. **No hay bug hoy** ni fuga observable —los E2E y los unitarios lo confirman—,
  pero la protección es **accidental**: cualquier cambio de política de caché (subir `staleTime`,
  activar `gcTime` por defecto, un `QueryClient` con defaults distintos, o prefetch) convierte esto
  en una **fuga entre pedidos**: el `GuestOrderTrackingDTO` de un invitado servido a otro. Y es
  justo la superficie más sensible del stream (criterio 51/52: un token ⇒ un pedido).
- **Disparador:** al tocar los defaults del `QueryClient`, al añadir prefetch/persistencia de caché,
  o al permitir cambiar de token sin remontar la página. Acción: **incluir el token en la
  `queryKey`** —`['guest-order-track', token]`, o un hash/prefijo suyo si se prefiere no dejar el
  secreto en las devtools de React Query— de modo que el aislamiento sea una propiedad de la clave y
  no del `gcTime`.

### FE-28 · La E2E del seguimiento público es mock-driven: la superficie del enlace tokenizado no se ejerce contra el stack real (Media)
- **Dónde:** `frontend/e2e/guest-checkout.spec.ts:144-235` (bloque `seguimiento público · /pedido`:
  `mock-demo-token`, `mock-expired-token`, `mock-…-checkout-token-expired`), servidos por la rama
  mock de `trackGuestOrder` / `resendGuestTrackingLink` en `frontend/src/lib/api.ts`. El único caso
  tagueado `@real` del spec (`comprar como invitado`) **degrada a mock** cuando no hay backend.
- **Estado actual:** todo el comportamiento de seguridad del enlace que valida el front —token
  válido, token inválido/expirado con pantalla neutra idéntica, reenvío neutro— se verifica contra
  **fixtures del propio frontend**, no contra el backend. Los casos negativos comprueban que la UI
  no ramifica, pero **no** que el backend responda `404/410/429` como el contrato §4-G.3 exige, ni
  que el DTO real venga sin los campos prohibidos.
- **Impacto:** medio. **Precedente concreto de este mismo stream:** `/checkout` estaba en
  `PRIVATE_PREFIXES` de `PrivateRouteGuard`, lo que **rompía el criterio 45/46 en modo REAL**
  (redirect a `/login`), y **los 60 E2E en modo mock pasaban igual** — porque el guard es inerte con
  `useMocks`. El verde en mock no dice nada sobre el stack real, y aquí lo que quedaría sin cubrir
  no es una pantalla cualquiera sino la **puerta sin contraseña** del pedido.
- **Disparador:** próxima ronda de E2E `@real` / cierre de release. Acción: cubrir contra el backend
  vivo al menos (a) **token válido** (pedido sembrado por el seed E2E ⇒ la vista pinta su
  `orderNumber` y su estado) y (b) **token inválido/manipulado** (⇒ pantalla neutra, sin eco del
  `errorCode`), reusando el patrón `@real` + `E2E_REAL=1` ya existente. Dueño: **frontend** escribe
  el spec; **QA** fija la cadencia (por stream vs. por release) y siembra el pedido de invitado.

### FE-29 · `numberSort`/`numberPrefix` opcionales en `types/contract.ts` + fallback duplicado `deriveNumberParts` en cliente (Baja, con condición de retiro)
- **Dónde:** `frontend/src/types/contract.ts` (`CardDTO.numberSort?/numberPrefix?`,
  `MasterSetCardCellDTO.numberSort?/numberPrefix?`) y `frontend/src/lib/cardOrder.ts`
  (`deriveNumberParts` + el fallback dentro de `compareCardNumber`/`keysOf`).
- **Estado actual:** el contrato v1.22 declara ambos campos **requeridos** (columnas de `Card`
  desde M-26, siempre presentes en el DTO), pero el tipo del frontend los marca `?` a propósito:
  **tolerancia de despliegue** mientras el re-sync/backfill (`POST /admin/catalog/sync-all
  {force:true}`, ARCHITECTURE §4.22d) no haya corrido sobre TODAS las filas de producción. Si el
  campo falta, `cardOrder.ts` deriva la clave equivalente en cliente con la MISMA regla del
  contrato. Costo: la fórmula del orden natural vive **duplicada** front/back (ya con una
  divergencia teórica conocida: el `.toUpperCase()` del front, ver BE-65b), y el tipo miente
  respecto al contrato (dice "opcional" donde la norma dice "siempre").
- **Impacto:** bajo. El fallback reproduce la misma secuencia para todos los `number` reales del
  catálogo (prefijos ya en mayúsculas); el riesgo es de deriva futura entre las dos copias de la
  fórmula, no de comportamiento hoy.
- **Disparador / CONDICIÓN DE RETIRO:** cuando devops confirme la corrida del
  `sync-all {force:true}` de §4.22d **en producción** (registro en `docs/DEVOPS_NOTES.md`, gate del
  paso 4), el rol frontend debe: (1) volver **requeridos** `numberSort`/`numberPrefix` en ambos DTOs
  de `types/contract.ts`; (2) **borrar** `deriveNumberParts` y el fallback de `keysOf` en
  `cardOrder.ts` (queda solo el comparador sobre los campos del DTO — elimina la duplicación
  front/back de la fórmula y de paso el `.toUpperCase()` divergente de BE-65b); (3) ajustar los
  fixtures/tests que hoy construyen `CardDTO` sin esos campos. Anotada a petición del **techlead**
  (veredicto del stream v1.22-variantes-orden); la decisión del `?` está documentada en
  `docs/FRONTEND_NOTES.md` (entrada 2026-08-18 T1/T2/T3, «Nota de tipos»).

### Rama `fix/m1-alta-inventario` — cierre M1 alta (2026-08-18, no bloqueante)

> Deuda **aceptada, no bloqueante** anotada a petición del **techlead** tras el pase de fixes de dinero del
> alta M1 (FIX 1 gradeadas sin cert compartido, FIX 2 reset de formulario, FIX 3 banner, FIX 4 tests).
> Dueño **frontend**. Registradas sin implementar en este pase. Continúan la numeración `FE-*` (tras FE-29).

### FE-30 · Extraer el modal de alta de `M1View.tsx` a `<AddItemModal>` + hooks de mutación
- **Dónde:** `frontend/src/app/[locale]/(admin)/admin/m1/M1View.tsx` (≈945 líneas: tabla+pestañas+filtros
  **y** todo el modal de alta simple/masiva con sus dos `useMutation`).
- **Estado actual:** un solo componente concentra la orquestación de tabla/pestañas/filtros/paginación **y**
  el formulario de alta (picker de catálogo, lote, gradeada/sellado/raw, los `create`/`batch` mutations,
  el reset de formulario `resetAddForm`, el manejo de `batchKey`). El archivo es grande y mezcla dos
  responsabilidades; cada fix del alta obliga a navegar todo el componente.
- **Impacto:** medio (mantenibilidad). Sin bug; el tamaño eleva el costo de cambios y el riesgo de regresión
  al tocar el alta (justo la superficie de dinero de este pase).
- **Disparador:** próximo toque sustancial del alta M1. Acción: extraer `<AddItemModal>` (formulario + lote)
  con hooks `useInventoryCreate` / `useBatchCreate` que encapsulen las mutaciones + invalidación de
  `['admin-inventory']`; `M1View` queda como orquestador de tabla+pestañas+filtros.

### FE-31 · Reusar `PerLineErrors` (master-set) para el resultado por-línea del lote de M1
- **Dónde:** `frontend/src/app/[locale]/(admin)/admin/m1/M1View.tsx` (~:563-600, render del `batch.data.results`)
  vs. `frontend/src/components/master-set/PerLineErrors.tsx`.
- **Estado actual:** M1 **reimplementa** a mano el render del resultado por-línea del lote (folios OK / motivo
  de fallo por-código con `Check`/`AlertTriangle`), mientras master-set ya tiene `PerLineErrors` para el mismo
  propósito. Dos presentaciones divergentes de "resultado de lote".
- **Impacto:** bajo (mantenibilidad/consistencia). Cualquier mejora de presentación de lotes hay que hacerla
  dos veces.
- **Disparador:** al unificar la presentación de lotes o al tocar el resultado del alta masiva. Acción: usar
  `PerLineErrors` (o extraer un componente común) para el detalle por-línea, **sin** acoplar M1 a
  `MasterSetPanel`. Nota: `capture.ts`/master-set quedaron **fuera de alcance** de este pase (NO TOCAR).

### FE-32 · Unificar la generación de `batchKey` con `localUid('batch')`
- **Dónde:** `frontend/src/app/[locale]/(admin)/admin/m1/M1View.tsx` (`ensureBatchKey`, inline con
  `Date.now().toString(36)` + `Math.random()`) vs. `frontend/src/components/master-set/capture.ts`
  (`localUid('batch')`, ya usado por `MasterSetPanel`/`CellDrawer`).
- **Estado actual:** M1 genera su `batchKey` de idempotencia **inline** con su propia fórmula; master-set usa
  el helper compartido `localUid`. Dos fuentes para la misma noción (clave estable de lote).
- **Impacto:** bajo. Funciona; es duplicación de un helper ya existente.
- **Disparador:** al extraer los hooks de alta (FE-30) o al tocar `capture.ts` (hoy en la lista NO TOCAR).
  Acción: reusar `localUid('batch')`.

### FE-33 · Mostrar el acabado ASIGNADO por línea en el resultado del lote (hoy degrada en silencio)
- **Dónde:** `frontend/src/app/[locale]/(admin)/admin/m1/M1View.tsx` (`finishForCard`, ~:159-162, y el render
  del resultado del lote).
- **Estado actual:** en el alta masiva el acabado elegido se recorta por-carta (`finishForCard`): si la carta
  no soporta el acabado del formulario, se sustituye por su primer acabado disponible **sin avisar**. El
  resultado por-línea muestra folio/motivo pero **no** el acabado con que finalmente se creó cada pieza. El
  acabado afecta la valuación, así que un degradado silencioso puede pasar inadvertido al operador.
- **Impacto:** bajo/medio (transparencia de captura; el acabado incide en valuación). No corrompe: la pieza se
  crea con un acabado válido para la carta; solo falta hacerlo visible.
- **Disparador:** al tocar el resultado del alta masiva. Acción: incluir en cada línea OK el acabado asignado
  (badge `FinishBadge`), destacando cuando difiere del elegido en el formulario.

### FE-34 · P-1 · Tras logout el guard de `AdminShell` impone `/login?next=/admin/m1` (cosmético)
- **Dónde:** `frontend/src/components/layout/AdminShell.tsx` (guard de sesión) vs. el `router.replace('/login')`
  del logout.
- **Estado actual:** al cerrar sesión, el guard de `AdminShell` **gana la carrera** y redirige a
  `/login?next=/admin/m1` (con el `?next=`/flash) antes de que el `router.replace('/login')` limpio tome
  efecto. El usuario acaba en login con un `next` que apunta de vuelta a la ruta admin recién cerrada.
- **Impacto:** cosmético. No hay fuga (el guard protege igual); solo el query param sobra tras un logout
  explícito.
- **Disparador:** aceptado; **no arreglar ahora** salvo que resulte trivial y sin riesgo para el guard.
  Acción posible: que el logout señale un "logout intencional" para que el guard omita el `?next=` en esa
  transición.


### P-5 (v1.25 paginación+filtros) — deuda del delta frontend (2026-08-20, no bloqueante)

> Hallazgos del **techlead** sobre el delta de P-5 (paginación + filtros server-side de M3 y de la
> pestaña «Cerradas» de M5). Aceptados como deuda **no bloqueante**, dueño **frontend**. Continúan la
> numeración `FE-*` (tras FE-34).
>
> **No están aquí, porque se pagaron en este mismo pase:** el **debounce** de los inputs de filtro
> que alimentan la query server-side (hook `useDebouncedValue`, aplicado a `q`/monto de M3 y al
> buscador global + monto de «Cerradas» de M5) y la **fidelidad del mock de `getAdminOrders`** (el
> filtro `q` del mock se alineó a los campos del backend real: `orderNumber`/`guestEmail`/`user.name`/
> `user.email` parciales + `userId` EXACTO, en vez del `includes` sobre el UUID que daba falsos verdes).

### FE-35 · Barra de filtros + paginación + `pesosToCents`/`*_PAGE_SIZE` duplicados entre M3 y M5
- **Dónde:** `frontend/src/app/[locale]/(admin)/admin/m3/M3View.tsx` y
  `frontend/src/app/[locale]/(admin)/admin/m5/M5View.tsx`.
- **Estado actual:** ambas vistas repiten casi idéntico: el bloque de inputs de **filtro** (fecha
  `from`/`to`, monto min/max con prefijo `MX$`), los **controles de paginación** (botones prev/next +
  `pageInfo`, cálculo de `totalPages`), el helper **`pesosToCents`** (pesos↔centavos, idéntico byte a
  byte en las dos), la constante **`*_PAGE_SIZE = 25`** y ahora también el cableado de **debounce** de
  los inputs de red (`useDebouncedValue` sobre `q`/monto). Cada cambio de patrón (p. ej. un nuevo campo
  de filtro o ajustar el `resetPage`) hay que hacerlo en dos sitios y es fácil que diverjan.
- **Impacto:** bajo. Mantenibilidad: duplicación estructural; sin bug funcional. El riesgo es que M3 y
  M5 se separen sutilmente en un refactor (p. ej. distinta semántica de `resetPage`/debounce).
- **Disparador:** al añadir un tercer listado admin paginado, o al tocar los filtros de cualquiera de
  las dos vistas. Acción: extraer un hook `useAdminListFilters` (estado de page/q/from/to/min/max +
  debounce + `resetPage` + serialización a params) y componentes compartidos `<AdminListFilters>` y
  `<Pagination>`; centralizar `pesosToCents` (a `@/lib/format` o `@/lib`) y `ADMIN_LIST_PAGE_SIZE`.

### FE-36 · i18n de filtros/paginación duplicada entre `admin.m3` y `admin.m5` (namespace compartido)
- **Dónde:** `frontend/messages/{es,en}.json` → `admin.m3.filters.{dateFrom,dateTo,minAmount,maxAmount}`
  + `admin.m3.{prev,next,pageInfo}` y sus gemelas `admin.m5.filters.*` / `admin.m5.closed.{prev,next,
  pageInfo}`.
- **Estado actual:** las mismas etiquetas de filtro (Desde/Hasta/Monto mín./Monto máx.) y de paginación
  (Anterior/Siguiente/«Página X de Y») están **repetidas** bajo los namespaces `admin.m3` y `admin.m5`
  (y en «Cerradas»/«Rechazadas» de M5 hay más copias del par prev/next/pageInfo). Un cambio de copy hay
  que replicarlo en cada namespace y locale.
- **Impacto:** bajo. Mantenibilidad/consistencia de copy; sin efecto funcional.
- **Disparador:** junto con FE-35 (extracción de `<AdminListFilters>`/`<Pagination>`), o al añadir otro
  listado admin. Acción: mover las claves comunes a un namespace compartido `admin.filters`
  (y `admin.pagination`) y consumirlo desde los componentes extraídos, dejando en `admin.m3`/`admin.m5`
  solo lo específico de cada vista.


### WS «Órdenes y dinero» — cierre v1.21 guest checkout (2026-08-18, no bloqueante)

> Hallazgos del veredicto del **techlead** sobre el stream «Órdenes y dinero» (guest checkout, contrato
> v1.21/v1.21.1/v1.21.2). Aceptados como deuda **no bloqueante**, dueño **backend**. Continúan la
> numeración `BE-*` (tras BE-52).
>
> **No están aquí, porque se pagaron en el propio stream:** **T2** (reserva atómica y compensación del
> PaymentIntent duplicadas y ya divergentes → fuente única `OrdersService.reserveItems` /
> `attachPaymentIntent`, con la titularidad como parámetro), **T1** (double-sell físico del contracargo con
> envío vivo, v1.21.2), **D4** (discriminador canónico `Order.fulfillmentMode` con `switch` exhaustivo) y
> **D6** (`CHECK` de `InventoryItem`, migración M-25b).

### BE-53 · `sendTrackingLink` revoca los enlaces ANTES de saber si el correo salió (Media)
- **Dónde:** `backend/src/modules/orders/guest-order-mail.service.ts` (`sendTrackingLink`, la llamada a
  `tokens.issue(..., { rotate: true })` previa a `mail.send`).
- **Estado actual:** el reenvío **rota primero** (revoca todos los tokens vivos del pedido) y **después**
  intenta enviar el correo. Si el proveedor falla, el invitado se queda **sin el enlace que tenía** y **sin
  el nuevo**; y como `POST /orders/guest/resend-link` responde siempre `202` por diseño anti-oráculo
  (§4-G.4), **no se entera**. Le quedan el reclamo (si tiene cuenta) o soporte.
- **Impacto:** medio. No hay pérdida de dinero ni de datos y el pedido se prepara y envía igual, pero el
  comprador puede perder la visibilidad de su pedido justo cuando pidió ayuda. Probabilidad = la de un fallo
  del proveedor de correo.
- **Disparador:** al tocar el reenvío o al añadir reintentos de correo. Acción (dirección del techlead):
  **emitir sin rotar** y revocar los anteriores **solo tras `mail.send` OK** (dos pasos), aceptando una
  ventana breve de dos enlaces vivos —que es exactamente el patrón ya normado para el settle en §4-G.7a—.

### BE-54 · El listado de M3 devuelve la fila cruda con spread en vez de una allowlist (Media)
- **Dónde:** `backend/src/modules/orders/admin-orders.controller.ts` (`list()`, el `data.map((o) => ({ ...o,
  isGuestOrder }))`).
- **Estado actual:** el listado admin proyecta la fila de `Order` **entera** (spread) y solo añade el flag
  derivado. Hoy eso incluye `guestEmail` y el `shippingAddressSnapshot` **completo** (dirección con calle y
  teléfono), que el contrato sí permite en back-office, pero la forma es **denylist implícita**: cualquier
  columna sensible que se añada mañana a `Order` se expone sola. Contradice el criterio de **allowlist
  explícita** que este mismo stream defiende en `toTrackingDto` y que `toClientShipment` ya aplica.
- **Impacto:** medio en riesgo futuro, bajo hoy (endpoint protegido por rol `vault_operator+`).
- **Disparador:** al añadir columnas a `Order` o al tocar M3. Acción: proyección **por allowlist explícita**
  (misma disciplina que `toClientShipment`), enumerando los campos que §M3 declara.

### BE-55 · `getOrder('', id, true)`: centinela de string vacío + flag `isAdmin` para saltarse el check de dueño (Media)
- **Dónde:** `backend/src/modules/orders/orders.service.ts` (`getOrder(userId, orderId, isAdmin)`) y su
  llamada desde `admin-orders.controller.ts` (`this.orders.getOrder('', id, true)`).
- **Estado actual:** una sola función sirve a dos autorizaciones distintas; el llamador admin pasa un
  **centinela `''`** como `userId` y un **flag booleano** que desactiva la comparación de dueño. Con
  `Order.userId` **ya nullable** (M-25) este es justo el patrón que produce fugas: basta un futuro
  `if (!isAdmin && order.userId !== userId)` mal editado, o un llamador que pase `''` sin querer, para que
  la puerta quede abierta. Hoy es correcto (`'' !== uuid` y `null !== ''`), pero la seguridad depende de una
  coincidencia, no del tipo.
- **Impacto:** medio (riesgo de autorización latente); ninguno observable hoy.
- **Disparador:** al tocar el detalle de pedido o al añadir un tercer llamador. Acción (dirección del
  techlead): **dos métodos separados** —`getForCustomer(userId, orderId)` y `getForAdmin(orderId)`—, sin
  flags ni centinelas, cada uno con su proyección.

### BE-56 · Discrepancia doc↔código: el barrido T9 solo cubre pedidos de invitado (Baja)
- **Dónde:** `backend/src/modules/orders/guest-checkout.service.ts` (`sweepStaleGuestOrders`, el `where` con
  `guestEmail: { not: null }` y `fulfillmentMode: 'direct_ship'`) frente a `docs/ARCHITECTURE.md` §4.21e (T9),
  que afirma que el barrido «**también** beneficia a los pedidos con cuenta (hoy dependen solo de que Stripe
  cancele el PI)».
- **Estado actual:** el filtro excluye a propósito los pedidos de bóveda, así que **hoy esa frase no se
  cumple**: una reserva de un pedido con cuenta no pagado sigue dependiendo de que Stripe cancele el PI.
- **Impacto:** bajo. No hay bug en la ruta de invitado (que es la que el job debía cubrir); es una
  discrepancia de documentación y una mejora no hecha para la ruta con cuenta.
- **Disparador:** decidir cuál de las dos se alinea. Acción: o ampliar el barrido a `status='pending'` sin
  filtrar por `guestEmail` (con la ventana de reserva que decida el arquitecto para bóveda), o corregir la
  frase de §4.21e. **La ampliación toca la ruta con cuenta ⇒ pasa por el arquitecto antes.**

### BE-57 · `RejectAuthenticatedGuard` aplicado por handler y no a nivel de clase (Media)
- **Dónde:** `backend/src/modules/orders/guest-orders.controller.ts` (`@UseGuards(RejectAuthenticatedGuard)`
  repetido en `quote` y `session`).
- **Estado actual:** el invariante §4-G.0-3 («los endpoints `/checkout/guest/*` rechazan una sesión válida
  con `409 ALREADY_AUTHENTICATED`») depende de que **cada handler nuevo recuerde el decorador**. Un quinto
  endpoint `/checkout/guest/*` que lo olvide pierde el invariante **en silencio**: no falla ningún test
  existente ni ningún tipo. El controlador mezcla además las dos familias (`/checkout/guest/*`, que rechaza
  sesión, y `/orders/guest/*`, que no), por lo que no basta con subir el guard a la clase actual.
- **Impacto:** medio en riesgo futuro; ninguno hoy (los dos handlers que lo necesitan lo tienen, y hay test
  que lo verifica).
- **Disparador:** al añadir cualquier endpoint `/checkout/guest/*`. Acción: **separar en dos controladores**
  (`GuestCheckoutController` con el guard a **nivel de clase** y `GuestOrdersController` sin él), de modo que
  el invariante lo dé la **estructura** y no la disciplina.

### BE-58 · Tests de implementación en el spec de contrato del guest checkout (Baja)
- **Dónde:** `backend/test/guest-checkout.contract.spec.ts`, describe «metadatos de seguridad» (lecturas de
  `Reflect.getMetadata('THROTTLER:LIMITdefault' | '__guards__')` y comprobación del **orden de declaración**
  de los métodos de `OrdersController`).
- **Estado actual:** esos casos afirman **cómo está construido** el código (claves internas de
  Nest/Throttler, orden de métodos) en vez de **qué hace**. El más peligroso es
  `expect(guardsOf(proto.track)).not.toContain(...)`: si la clave `'__guards__'` cambia de nombre en una
  versión de Nest, el helper devuelve `[]` y el aserto **pasa en vacío** — verde sin probar nada. Se
  escribieron así porque probar el rate-limit real exigiría infra (y el throttler se salta bajo
  `NODE_ENV=test`).
- **Impacto:** bajo. Los mismos invariantes están cubiertos por tests de comportamiento (el guard tiene su
  propia suite; la ruta `claimable` se ejercita por HTTP en la E2E), así que el riesgo es falsa confianza,
  no un agujero descubierto.
- **Disparador:** al subir de major de `@nestjs/throttler`/`@nestjs/core`. Acción: sustituir por
  comportamiento (E2E de `429` con el throttler activo y una llamada real a `/orders/claimable`), o al menos
  hacer que el helper **falle si la metadata no existe** en vez de devolver vacío.

### BE-59 · `resendQuotaExceeded` cuenta también los tokens que no son reenvíos (Baja)
- **Dónde:** `backend/src/modules/orders/order-access-token.service.ts` (`resendQuotaExceeded`: `count` de
  todas las filas `OrderAccessToken` del pedido en 24 h).
- **Estado actual:** el tope `GUEST_RESEND_MAX_PER_DAY = 5` del contrato (§4-G.4) cuenta **cualquier** fila
  emitida en 24 h, incluidos el **`checkoutToken`** del checkout y el token del **settle**. El día de la
  compra esos dos ya consumen cuota ⇒ el invitado dispone de **3 reenvíos reales, no 5**. El contrato dice
  «contando `OrderAccessToken` emitidos», así que la implementación es literal, pero el efecto observable
  discrepa de la intención («5 reenvíos»).
- **Impacto:** bajo. Solo aprieta el límite (nunca lo afloja) y ocurre únicamente el primer día.
- **Disparador:** si soporte reporta invitados sin reenvíos disponibles. Acción: contar solo emisiones de
  **reenvío** —distinguibles hoy por su TTL de 90 días frente a los 120 min del checkout, sin columna nueva—
  o pedir al arquitecto que fije el criterio exacto de conteo en §4-G.4.

### BE-60 · Una fila corrupta de M4 tumba el listado entero (Media)
- **Dónde:** `backend/src/modules/shipments/shipments.service.ts` — `kindForFulfillment()` lanza
  (`409 CONFLICT`) y se invoca desde `withAdminKind()` dentro del `.map()` de `adminList()`.
- **Estado actual:** D4 exige que un `fulfillmentMode` no soportado (o un `vault` con `orderId`,
  combinación imposible) **rompa visiblemente** en vez de comportarse como envío directo. Correcto
  en el **detalle** (`adminGet`) y en la máquina de estados. Pero en el **listado** el mismo throw
  hace que **una sola fila corrupta** devuelva `409` para **toda la cola de M4**: el operador se
  queda sin listado, sin poder ni siquiera identificar la fila culpable.
- **Impacto:** medio. Hoy no puede ocurrir (`fulfillmentMode` es NOT NULL con default y el
  invariante lo sostiene la aplicación), pero el modo de fallo elegido es "apagar la cola" en vez
  de "señalar la fila", justo en la pantalla operativa de la que depende el trabajo diario.
- **Disparador:** al añadir un tercer `FulfillmentMode` o ante corrupción de datos. Acción:
  degradar **por fila** en el listado (`kind: 'unknown'` + `logger.error` con el `shipmentId`),
  conservando el throw en el detalle y en la transición terminal, donde sí debe frenar.

### BE-61 · El envío del settle se crea incluyendo piezas con anomalía no recuperada (Baja)
- **Dónde:** `backend/src/modules/payments/payments.service.ts` (`settleDirectShipOrder`: el
  `shipmentRequest.create` usa **todos** los `order.items`, incluidas las piezas cuya anomalía B3
  no se pudo recuperar).
- **Estado actual:** si al liquidar una pieza está comprometida con otro flujo (`shipped`,
  `in_custody`…), el settle **no se la quita a nadie** (correcto) pero el `ShipmentRequest` que crea
  **sí la incluye** como `ShipmentItem`. Queda un envío que promete una carta que no está
  disponible; el operador lo descubre al hacer picking. La anomalía **ya se registra** (`logger.error`
  + `AuditLog order.settle_inventory_anomaly` con `needsHumanReview: true`).
- **Impacto:** bajo. El caso solo aparece tras una anomalía ya auditada y con intervención humana
  pendiente; el pedido pagado necesita **algún** envío, así que crearlo completo es lo menos malo
  (lo contrario —omitir la línea— escondería la deuda al operador).
- **Disparador:** al construir la cola de "anomalías de settle" en back-office. Acción: excluir del
  `ShipmentRequest` las piezas no recuperadas y reflejarlas en esa cola, o marcar la línea del
  envío como pendiente de confirmación. **Decisión de producto/UX ⇒ pasa por el arquitecto.**

### BE-62 · `sellableStatusFor` usa el cliente NO transaccional dentro de una transacción abierta (Media)
- **Dónde:** `backend/src/modules/orders/orders.service.ts` — `resolveChargebackInventory` la invoca
  **dentro** del `$transaction` (rama `recuperada`) y el helper lee por **`this.prisma`**, no por el
  `tx` de esa transacción.
- **Estado actual:** inofensivo hoy y verificado por el techlead: `PricingService.getReference` es
  lectura pura de BD (sin red) y un `SELECT` por otra conexión no se bloquea bajo READ COMMITTED.
  Pero **contradice la regla que el propio proyecto se escribió** en `shipments.service.ts` —*«la
  creación del PaymentIntent queda FUERA de la tx a propósito: no bloquear una conexión de DB en una
  llamada de red»*— y el helper está **a una llamada de proveedor** de reabrir BE-7: basta que
  mañana la resolución de precio consulte un proveedor externo (el `PricingProvider` es
  intercambiable por diseño) para tener una llamada de red con una transacción abierta y filas
  bloqueadas.
- **Impacto:** medio en riesgo futuro; ninguno observable hoy.
- **Disparador:** al tocar `sellableStatusFor`, al cambiar de `PricingProvider` o al añadir otra
  resolución de precio dentro de una transacción. Acción: pasar el `tx` al helper (firma
  `sellableStatusFor(tx, item)`) y dejar **explícito en su docblock** que no puede hacer I/O externa.

### BE-63 · `catch {}` desnudo en `sellableStatusFor` degrada a `in_stock` en silencio (Baja)
- **Dónde:** `backend/src/modules/orders/orders.service.ts` (`sellableStatusFor`, el `catch` sin
  filtro que devuelve `'in_stock'`).
- **Estado actual:** el `catch` está pensado para `PRICE_PENDING` (una pieza sin precio no se
  publica), pero atrapa **cualquier** excepción: ahora que corre **dentro de la transacción**, un
  fallo real de Prisma (conexión, timeout, constraint) se traga y la pieza se degrada a `in_stock`
  como si el problema fuera de precio. **Es la misma especie que el `continue` mudo del settle que
  B3 nos enseñó a no dejar pasar**: una rama silenciosa en el camino del inventario que convierte un
  fallo de infraestructura en una decisión de negocio plausible, y por eso nadie la investiga.
- **Impacto:** bajo. La dirección del error es conservadora (no publica de más) y el desenlace queda
  auditado igualmente; lo que se pierde es la señal de que algo falló.
- **Disparador:** al tocar el helper o al investigar piezas que "aparecen" en `in_stock` sin motivo.
  Acción: capturar **solo** `BusinessException` con `code === 'PRICE_PENDING'` y dejar propagar el
  resto (la transacción revertirá, que es lo correcto ante un fallo real).

### BE-64 · La suite de integración dependía del volumen acumulado de la BD compartida — RESUELTA en esta ronda (Baja)
- **Dónde:** `backend/test/integration/guest-checkout.e2e-spec.ts` (el caso «el envío de invitado
  aparece en la cola de M4»).
- **Qué pasaba (hallazgo de QA):** el test buscaba **su** envío en
  `GET /admin/shipments?kind=guest_direct_ship` **sin paginar**, y ese endpoint sirve `pageSize=20`
  por defecto. QA lo demostró: **102/104** con la BD acumulada (41 envíos) y **103/104** tras
  recrearla. CI usa BD efímera, pero el propio spec declara que la suite comparte BD entre
  ejecuciones, así que en staging **habría empezado a fallar solo** — un flake que se disfraza de
  regresión y quema tiempo de QA.
- **Resolución:** la consulta se acota (`status=picking&pageSize=100`), de modo que el aserto
  depende del **comportamiento** y no del volumen histórico. Verificado corriendo la suite de
  integración **dos veces seguidas sobre la misma BD acumulada** (40 envíos): 114/115 en ambas
  pasadas, con el único fallo en `infra-smoke` (MinIO/S3 ausente en el entorno, ajeno).
- **Se anota igualmente** porque el patrón —*asertar sobre un listado paginado compartido*— puede
  repetirse en cualquier spec futuro de back-office; la regla es: filtra o busca por id, nunca
  confíes en que tu fila entra en la primera página.
- **Recurrencia confirmada y corregida (2026-08-18, WS v1.22):** el mismo patrón latente vivía en
  `catalog-checkout-webhook.e2e-spec.ts` (buscaba el charizard del seed en `GET /catalog/cards?
  pageSize=50`) y despertó al acumular la BD compartida >50 piezas listadas del MISMO nombre
  (`E2E-GST-*` por corrida). Ni siquiera acotar con `q=` bastó (51 listings del mismo charizard).
  Corregido a la regla: la pieza concreta se pide **por id** (`/catalog/listings/:id`) y el listado
  se asierta por comportamiento, no por volumen.

### WS «Catálogo y precios» — v1.22 variantes y orden (2026-08-18, no bloqueante; anotado a petición del techlead)

### BE-65 · Casos borde del orden natural: `"23a"`, `number` vacío, y dos divergencias oráculo↔clave persistida (Baja)
- **Dónde:** `backend/src/common/card-order.ts` (`deriveNumberParts` / `compareByNumber`) y su
  espejo del front `frontend/src/lib/cardOrder.ts` (dueño frontend para su mitad).
- **Estado actual:** ARCHITECTURE §4.22b decidió explícitamente NO cambiar la semántica de estos
  bordes en este WS (parity con el comparador previo): `"23a"` → `prefix="a"`,
  `numberSort=1_000_023` (cae en el bloque de promos en vez de junto a `"23"`); `number=""` →
  `prefix=""`, `numberSort=1_000_000` (al final del bloque numérico). Además hay **dos divergencias
  reales** entre implementaciones del mismo orden:
  - **(a) `compareByNumber` diverge de la clave persistida para `number=""`:** el comparador decide
    "promo" por `prefix !== ''` y compara por `num` (no por `numberSort`), así que `""` (prefix `''`,
    num `0`) se trata como puro-numérico y ordena **PRIMERO** en memoria, mientras que en BD su
    `numberSort=1_000_000` lo manda **al final del bloque numérico**. `compareByNumber` es hoy solo
    oráculo de tests y comparador de colecciones ya materializadas, pero un oráculo que diverge del
    dato que audita es una trampa esperando a su test.
  - **(b) El fallback del front normaliza el prefijo a MAYÚSCULAS y el backend no:**
    `frontend/src/lib/cardOrder.ts` hace `.toUpperCase()` del prefijo derivado; el backend
    (`deriveNumberParts` y el backfill SQL de M-26) conserva las minúsculas. Un `number` con prefijo
    en minúsculas (`"23a"` → backend `prefix="a"`, front `prefix="A"`) ordenaría distinto al
    re-ordenar localmente tras filtrar que en la página servida por la BD.
- **Impacto:** bajo. pokemontcg.io emite los prefijos reales en mayúsculas (`TG`/`GG`/`SV`) y no se
  han visto `number` vacíos en producción; los bordes son teóricos hoy.
- **Disparador:** al afinar los casos borde que §4.22b dejó como deuda, o si un sync real trae un
  `number` con letra minúscula/vacío. Acción: (1) unificar la decisión "¿es promo?" y la comparación
  sobre `numberSort`+`prefix` (las MISMAS claves persistidas) en `compareByNumber`; (2) decidir UNA
  normalización de prefijo (recomendado: ninguna, y quitar el `.toUpperCase()` del front — cambio
  del rol frontend); (3) si se cambia la semántica de `""`/`"23a"`, actualizar `deriveNumberParts`,
  el backfill de referencia y re-sync — **pasa por el arquitecto** (cambia el orden observable del
  contrato).

### BE-66 · `availableFinishes ?? ['normal']` no cubre el array VACÍO (Baja)
- **Dónde:** `backend/src/modules/catalog/catalog.service.ts` (`toCardDTO`) y
  `backend/src/modules/inventory/master-set.service.ts` (celda del binder): ambos emiten
  `(card.availableFinishes ?? ['normal'])`.
- **Estado actual:** Prisma **nunca devuelve `null`** en columnas de lista (devuelve `[]`), así que
  el `??` solo protege contra un caso que no ocurre; un `[]` legado/corrupto se emitiría **tal
  cual**, violando el invariante del contrato («el array nunca llega vacío», API_CONTRACT §6 /
  §4.22c) y dejando una celda del binder con CERO casillas. Hoy es **inalcanzable por código**: el
  schema tiene `@default([normal])`, `upsertCards` nunca escribe vacío (`derived ?? ['normal']` en
  CREATE, omisión en UPDATE), los seeds siembran explícito y `expectedFinishes()` del master-set SÍ
  cubre `length === 0`. El agujero requeriría un UPDATE manual en BD.
- **Impacto:** bajo (defensa en profundidad, no bug activo).
- **Disparador:** al tocar `toCardDTO` o el binder. Acción: helper único
  `presentFinishes(arr: Finish[] | null | undefined): Finish[]` (en `common/card-order.ts`, junto a
  `orderFinishes`) que cubra `null | undefined | []` → `['normal']`, y usarlo en los tres sitios
  (`toCardDTO`, binder, `expectedFinishes`) para que el invariante viva en UN lugar.

### BE-67 · Supuestos S1/S2/S3 del payload de pokemontcg.io SIN verificar en vivo — gate de la secuencia §4.22d (Media hasta la 1ª corrida)
- **Dónde:** `backend/src/modules/pricing/pricing.types.ts` (`deriveAvailableFinishes`) y
  `backend/src/modules/catalog/pokemontcg-io.client.ts` (`RemoteCard.cardmarket`). Detalle completo:
  `docs/BACKEND_NOTES.md` §49.6 y ARCHITECTURE §4.22f (tabla S1/S2/S3).
- **Estado actual:** el proxy del sandbox bloquea `api.pokemontcg.io` (403 en CONNECT), así que la
  derivación de dos señales se implementó contra el esquema DOCUMENTADO de la API v2, cubierta solo
  por tests de tabla de verdad sobre payloads fijos. Supuestos: **S1** la llave de `tcgplayer.prices`
  solo aparece cuando la impresión existe; **S2** `cardmarket.prices.reverseHolo*` viene siempre
  (señal = valor > 0); **S3** el payload de `GET /v2/cards?q=set.id:*` ya incluye `cardmarket` sin
  `select=` (cero requests extra).
- **Impacto:** medio **hasta** la primera corrida real: si S1/S2 fallan, el re-sync de §4.22d
  repoblará `['normal']` masivamente (el gate del paso 4 lo detecta); si S3 falla, el sync necesita
  una llamada extra (avisar al arquitecto ANTES: cambia el costo del sync).
- **Disparador:** la **ejecución de la secuencia §4.22d en Railway/staging** (dueño devops, con
  backend). Acción: correr `sync` sobre UN set moderno conocido antes del `sync-all {force:true}`,
  revisar `cardsWithoutFinishSignal` en logs y el `SELECT count(*)... 'reverse_holo' =
  ANY("availableFinishes")` del gate, registrar el resultado en `docs/DEVOPS_NOTES.md` y cerrar esta
  entrada (o escalar v1.22-1 al arquitecto si el payload no trae ninguna señal). **Esta entrada
  existe para que el supuesto no se pierda entre el merge del stream y el deploy.**

### Rama `fix/carrito-pieza-muerta` (v1.21.3-quote-prune) — deuda del veredicto techlead (2026-08-18, no bloqueante)

> Del stream de poda de carrito (quote por ítem). Techlead **APROBADO con condiciones**; el rename
> `priceCartForOrder`/`priceCartForQuote` (B-4 del review) se aplicó en la propia rama y NO figura
> aquí. IDs `B-1..B-3` del review de ese stream (no confundir con la serie `BE-*` de arriba).

### B-1 · Dedupe asimétrico quote vs session
- **Dónde:** `backend/src/modules/orders/orders.service.ts` — `priceCartForQuote` deduplica ids
  (`new Set`) antes de cotizar; `loadItems` (la ruta estricta de `priceCartForOrder`/sessions) NO:
  con un id duplicado en el carrito `items.length !== ids.length` y responde `404 NOT_FOUND`.
- **Dueño:** backend.
- **Estado actual:** el arquitecto lo está documentando en el contrato como comportamiento vigente
  (quote dedupe; session estricta rechaza duplicados). No es bug hoy: el front manda ids únicos.
- **Impacto:** bajo. Asimetría de normalización entre las dos rutas; un cliente que repita un id
  ve `200` en quote y `404` en session para el mismo carrito.
- **Disparador:** próximo cambio en `loadItems`/checkout, o si aparece un cliente de API externo.
  Acción: normalizar los ids en un punto ÚNICO de entrada para ambas rutas.

### B-2 · `QuoteDto` sin `ArrayMaxSize`
- **Dónde:** `backend/src/modules/orders/dto/orders.dto.ts:11-13` (`QuoteDto.inventoryItemIds`).
- **Dueño:** backend.
- **Estado actual:** el DTO de quote de invitado acota a `GUEST_MAX_ITEMS=20` y el de customer NO
  tiene cota. Desde v1.21.3 la petición se procesa COMPLETA (la poda tolerante ya no corta con el
  404 temprano que antes actuaba de freno accidental).
- **Impacto:** superficie de abuso: un autenticado puede cotizar arrays enormes de ids y cargar
  BD/CPU (una query `IN` gigante + resolución de precio por ítem válido).
- **Disparador:** fase de seguridad del próximo release — **pedir a pentester/seguridad que lo
  evalúen**. Acción probable: `@ArrayMaxSize` en `QuoteDto` alineada con una cota de producto.

### B-3 · Regla de venta con gemelo SQL
- **Dónde:** predicado TS `isSellable` (`backend/src/modules/orders/orders.service.ts`) vs. el
  `where` literal de `reserveItems` (`ownerType:'platform', status:{in:['listed','in_stock']}`) y la
  copia en `backend/src/modules/payments/payments.service.ts:218`.
- **Dueño:** backend.
- **Estado actual:** deuda HEREDADA (este stream la REDUJO al unificar el predicado TS en un solo
  cuerpo), pero la regla sigue viviendo también como literales SQL en dos sitios: un cambio en la
  lista de estados vendibles exige tocar tres lugares coordinados o la regla diverge en silencio.
- **Impacto:** medio/latente. Es la regla que decide qué pieza puede venderse/reservarse: una
  divergencia sería double-sell o pieza invendible.
- **Disparador:** próximo cambio en CUALQUIERA de los tres sitios. Dirección: constante compartida
  `SELLABLE_STATUSES` (mismo patrón que `inventory.service.ts:74`) consumida por el predicado y por
  los dos `where`.

### Rama `fix/available-finishes-source` — fix de `availableFinishes` (2026-08-19, no bloqueante; anotado a petición del techlead)

> El techlead **APROBÓ** el fix de la fuente de `availableFinishes` con **deuda NO bloqueante**. Los
> cuatro ítems de abajo son deuda **menor**, dueño **backend**, registrados sin tocar código en este
> pase. Continúan la numeración `BE-*` (tras BE-67). Familia de `catalog`/`pricing`
> (`finish-reconciler`, `price-ingest`).

### BE-68 · Race read-compute-write en `FinishReconciler.reconcile` (Baja)
- **Dónde:** `backend/src/modules/catalog/finish-reconciler.service.ts:36-55`, invocado desde
  `backend/src/modules/pricing/price-ingest.service.ts:225` y
  `backend/src/modules/catalog/catalog-sync.service.ts:412`.
- **Estado actual:** `reconcile` hace `findMany` → recompute → `update` **SIN transacción ni lock de
  fila**. Si `catalog-sync` y `price-ingest` corren **concurrentemente** sobre la MISMA carta, un
  interleaving puede dejar `availableFinishes` **transitoriamente** sin un acabado real (una casilla
  del binder desaparece hasta la siguiente recomputación).
- **Impacto:** bajo. NO bloquea: la dirección es **conservadora** (nunca inyecta un acabado fantasma
  → SEC-A1 intacto) y es **self-healing** por ser recomputable (el siguiente `reconcile` lo corrige).
- **Disparador:** si ambos writers pueden solaparse sobre el mismo set (multi-instancia o al cablear
  BullMQ para catálogo/precio). Dirección: envolver el recompute **por carta** en `$transaction` con
  `SELECT … FOR UPDATE`, o **serializar** ambos jobs sobre el mismo set de cartas.
- **Nota (arquitecto):** el contrato **§4.22g no aborda la atomicidad entre los dos writers** →
  candidato a **decisión de arquitectura futura**; el arquitecto debería saberlo.

### BE-69 · Nombre de variable engañoso + `select` sin usar en `price-ingest` (Baja, mantenibilidad)
- **Dónde:** `backend/src/modules/pricing/price-ingest.service.ts:170-176`.
- **Estado actual:** la variable local `catalogFinishes` se **puebla desde `r.availableFinishes`** (la
  lista blanca **derivada**), no de la columna real `catalogFinishes` → el nombre induce a error sobre
  qué fuente se está usando. Además, `externalId` aparece en el `select` (~línea 174) pero **no se
  usa** después.
- **Impacto:** nulo funcional; solo claridad del código (riesgo de que un lector confunda la lista
  derivada con la columna persistida).
- **Disparador:** próximo toque de `price-ingest`. Dirección: renombrar la variable a
  `whitelistByCard`/`knownFinishesByCard` y quitar `externalId` del `select` (o consumirlo si hacía
  falta).

### BE-70 · Log `finishNotInCatalog` desincronizado con la Señal C (Baja, observabilidad)
- **Dónde:** `backend/src/modules/pricing/price-ingest.service.ts:192-197,228-235`.
- **Estado actual:** el drift se compara contra `availableFinishes` **PRE-reconcile**; un alias
  **VERIFICADO** que la **Señal C** rescata en la MISMA corrida se loguea como drift aunque se esté
  añadiendo **legítimamente**, y el mensaje sugiere un remedio (`sync --force`/override)
  **desactualizado**. Es **solo observabilidad** (no afecta el dato escrito).
- **Impacto:** bajo. Ruido/confusión en logs (falso positivo de drift + remedio obsoleto); no afecta
  correctness ni dinero.
- **Disparador:** próximo toque del logging de ingesta. Dirección: comparar contra `catalogFinishes`
  (columna real) o **loguear post-reconcile**, y actualizar el texto del remedio.

### BE-71 · "Last wins" por acabado duplicado en el snapshot (Baja)
- **Dónde:** `backend/src/modules/pricing/price-ingest.service.ts:164`.
- **Estado actual:** si para una carta llegan **dos filas** que mapean al mismo enum `Finish` (una
  **verificada**, una **supuesta**) y **gana la supuesta**, se **pierde un acabado real** del
  snapshot. La dirección es **conservadora** (falta una casilla, no sobra) y el caso es **marginal**.
- **Impacto:** bajo. A lo sumo una casilla del binder que no aparece pese a existir; nunca inyecta un
  acabado inexistente.
- **Disparador:** si aparecen filas duplicadas por `Finish` en el feed del proveedor. Dirección:
  preferir la fila con `finishAliasVerified` al **deduplicar** (verificada gana sobre supuesta).

### Pase `fix/pokemonpricetracker-404` — deuda del delta (P-7, 2026-08-19, no bloqueante)

> Del fix P0 del adapter de PokemonPriceTracker (endpoints muertos `/api/prices`+`/api/v1/prices`
> → **API v2** `GET /api/v2/cards?setId=…&fetchAllInSet=true`, envelope raíz `{ data, total, count,
> limit, offset, hasMore }`, precios por acabado en `tcgplayer.prices`). Verdictos qa + techlead
> APROBADO-con-deuda. El único ítem es no bloqueante, dueño **backend**. Continúa la numeración
> `BE-*` (tras BE-71). Detalle del cambio en el propio provider + specs (`price-ingest.provider.spec.ts`
> y el co-localizado `pokemonpricetracker-bulk.provider.spec.ts`).

### BE-72 · Fallbacks A/B/C de `mapEntry` son un hedge sin verificar en runtime (Baja)
- **Dónde:** `src/modules/pricing/providers/pokemonpricetracker-bulk.provider.ts` → `mapEntry`
  (fuente PRIMARIA `entry.tcgplayer.prices` + fallbacks tolerantes **(A)** `entry.prices` objeto,
  **(B)** plano `printing`+`marketPrice`, **(C)** listas `prices`/`printings`/`variants`).
- **Estado actual:** el shape v2 REAL (`tcgplayer.prices` por acabado) está confirmado **solo** por
  el OpenAPI público del proveedor + múltiples clientes en GitHub; el **egress del sandbox bloquea**
  la verificación contra la API real. Como red de seguridad, `mapEntry` conserva los tres shapes
  fallback del adapter anterior. Una vez confirmado el shape real en la 1ª corrida, esos fallbacks
  son **código muerto** que ensucia el mapeo y puede enmascarar un cambio de contrato futuro
  (un shape inesperado mapearía por un fallback en vez de fallar visiblemente).
- **Impacto:** bajo (mantenibilidad; money-safe intacto — los fallbacks también validan acabado y
  `market>0`). Familia de BE-32 (paginación real por verificar) y BE-33 (moneda/unidad por confirmar):
  los tres esperan la **misma 1ª corrida en staging**.
- **Disparador:** **podar los fallbacks A/B/C de `mapEntry` tras confirmar el shape v2 real en la 1ª
  corrida en staging** (runbook devops, junto al flip de `POKEMONPRICETRACKER_MARKET_FORMAT`, BE-33).
  Solución: dejar solo la lectura de `tcgplayer.prices`; si el payload no la trae, OMITIR y loguear
  (que un cambio de contrato falle visible, no que un fallback lo tape).

### Pase `sellado-producto-cerrado` — saneo del sellado (2026-08-19, no bloqueante)

> Del pase de saneo aprobado por el PO sobre el work stream de Sellado: dedup del gating del precio de
> venta del sellado en un resolver único `PricingService.resolveSealedSalePrice` (H-1, Tarea 2). El
> intento de la Tarea 1 (cambiar el **seed** del autoprecio a `tcgcsv`) fue **RECHAZADO por el techlead**
> y **revertido**: el seed vuelve a **`off`** (fail-closed, por contrato §M10; el autoprecio se enciende
> en runtime con `PUT /admin/settings {"sealedPriceSource":"tcgcsv"}` tras validar en staging — ver
> `BACKEND_NOTES §53.1`), lo que **preserva** la mitigación de §BE-44(c). Deuda aceptada anotada de los
> reportes de QA/techlead. Todos no bloqueantes, dueño **backend**. Continúan la numeración `BE-*` (tras BE-72).

### BE-73 · Paginación EN MEMORIA del sellado (`loadPricedSealed` / `vault.sealedTab`) (Media)
- **Dónde:** `src/modules/catalog/sealed-catalog.service.ts` → `loadPricedSealed` (usado por
  `listSealed`/`sealedDetail`) y `src/modules/vault/vault.service.ts` → `sealedTab`.
- **Estado actual:** ambos cargan **todas** las piezas selladas que matchean el `where` (sin `take`
  en BD), resuelven precio/valuación pieza por pieza, **agrupan por producto+condición en memoria** y
  recién entonces paginan (`slice`) u ordenan. Es el patrón `set-value` (agrupación en memoria), correcto
  para MVP pero que **escala con el inventario sellado**, no con la página pedida.
- **Impacto:** medio a futuro. Con un catálogo sellado grande, cada request del grid/bóveda materializa
  el universo de piezas selladas antes de paginar (latencia + memoria). Correctness OK.
- **Disparador:** cuando el inventario sellado publicado supere ~unos cientos de piezas o la latencia del
  grid/bóveda moleste. Solución: agrupar/paginar en BD (p. ej. `GROUP BY` por producto+condición con
  `take`/`skip`) o materializar el agregado por grupo; misma familia perf que BE-4/D3/BE-25.

### BE-74 · Imagen/nombre del grid/bóveda de sellado = los de la `Card`, no los reales de TCGCSV (Baja)
- **Dónde:** `src/modules/catalog/sealed-catalog.service.ts` → `toGroupDTO` (`productName: item.card.name`,
  `imageUrl: item.card.imageSmallUrl`) y `src/modules/vault/vault.service.ts` → `sealedTab` (idem).
- **Estado actual:** el `SealedGroupDTO` (grid, ficha, pestaña bóveda) usa el **nombre y la imagen de la
  `Card` ancla** (catálogo pokemontcg.io), NO el nombre/imagen reales del producto sellado en TCGCSV — hoy
  **no se persisten** en el mapeo. Traerlos en vivo sería un **N+1 remoto** contra TCGCSV por producto.
  Decisión correcta para MVP (sin fotos propias, imagen de catálogo remota).
- **Impacto:** bajo (cosmético/UX). El comprador ve el nombre/imagen de la carta ancla en vez del arte del
  booster box/ETB real; el precio y la agrupación son correctos.
- **Disparador:** **pregunta abierta al arquitecto** — ¿persistir `name`/`imageUrl` de TCGCSV en el mapeo
  del producto sellado (M-23) durante el ingest? Requiere columna(s) nueva(s) en el modelo del mapeo
  (schema → pasa por arquitecto, regla 9) para servirlos sin N+1 remoto.

### BE-75 · `userId` siempre `null` en `SealedRestockSubscription` (ruta `@Public`) (Baja)
- **Dónde:** `src/modules/catalog/sealed-catalog.service.ts` → `subscribeRestock` (persiste
  `userId: userId ?? null`) + su controlador `@Public` (`POST /catalog/sealed/restock-subscriptions`).
- **Estado actual:** la suscripción a «avísame cuando vuelva» es un endpoint **público/anónimo**, así que
  `userId` entra siempre `null`; el emparejamiento de la notificación es **por correo**. Ligar la
  suscripción a una **cuenta** cuando el usuario está autenticado requiere un **guard de auth OPCIONAL**
  (leer el usuario si hay sesión, permitir anónimo si no) que **hoy no existe** en el stack. Feature-flag
  `sealed_restock_alerts` está apagado (seed off), así que la ruta no opera aún.
- **Impacto:** bajo. Cuando se encienda el restock, la notificación llega por correo igual; solo se pierde
  la ligadura suscripción→cuenta (no se puede listar «mis avisos» dentro de la sesión).
- **Disparador:** al **encender** `sealed_restock_alerts` y querer ligar avisos a la cuenta. Solución:
  guard de auth opcional que popule `userId` cuando haya sesión (sin romper el acceso anónimo ni la
  respuesta neutra anti-enumeración).

### Deuda del pase v1.44-graded-estimate («gancho de grading», rama `claude/psa-graded-card-value-gmhv5u`, 2026-08-23)

> Anotada a petición del **techlead** (veredicto: aprobado con dos correcciones obligatorias, **R1** y **R2**,
> **ya ejecutadas** — ver `docs/BACKEND_NOTES.md` §0.2 › «Correcciones post-revisión»). De los cuatro ítems
> menores que el techlead enumeró, **D3 y D4 se arreglaron en el mismo pase** (eran baratos) y **no figuran
> como deuda abierta**; queda **BE-GE1** (= D1), que está bloqueada por doctrina, no por esfuerzo.
>
> **Actualización v1.50.2 (2026-08-28):** **BE-GE1 dejó de estar bloqueada** — la fase 2 se implementó con un
> parser auto-confirmante y la entrada **cambia de naturaleza** (ver abajo). Se añade **BE-GE3**
> (concentración de fuente). Y la deuda **BE-GE2** —la bitácora del `PUT` de M2 se escribía **después** del
> commit, así que una excepción entre ambos dejaba **config de dinero cambiada y sin registro**— quedó
> **SALDADA en este pase**: el `audit.log` entra a la misma `$transaction` que los upserts (paridad con
> v2.1.6/P48-B1). No figura como deuda abierta; se menciona para que el techlead pueda cerrarla.

#### BE-GE1 (= techlead D1) · ~~Instrumentación de fase 2 del gancho no implementada~~ → **RESUELTA en v1.50.2; la deuda CAMBIA DE NATURALEZA** (2026-08-28)

> ⚠️ **Esta entrada ya no describe una deuda de instrumentación: describe el RIESGO OPERATIVO de una fase 2
> que ahora existe.** En v1.50.2 el arquitecto **derogó el bloqueo** («fase 2 BLOQUEADA») y backend implementó
> el **parser auto-confirmante** (§4.38h). Lo que se hizo, y por qué el bloqueo era demasiado tosco:
>
> - **el truncate 800 → 4000 está APLICADO** (`pokemonpricetracker-bulk.provider.ts`), así que el falso
>   negativo que saboteaba el gate **ya no existe**;
> - **`includeEbay=true` se pide** junto al barrido por set, con `POKEMONPRICETRACKER_GRADED_FORMAT` /
>   `_GRADED_FIELD` como override del operador;
> - **P-6 se satisface por construcción**, no se esquiva: el parser **prueba** las dos hipótesis de shape y
>   **se niega a escribir** lo que no identifica positivamente como monto, registrando la muestra cruda. La
>   primera corrida real confirma el formato **con cero datos malos en la BD**. La lectura previa de P-6
>   («no automatizar hasta observar a mano») era **la forma más tosca de cumplirlo**: confundía «no asumir»
>   con «no automatizar».
>
> **Lo que queda abierto de esta entrada** es la **verificación en staging con datos reales** (severidad
> **Baja**, no bloqueante): el ingest arranca con el dial del gancho —desde v1.51 el ÚNICO,
> `grading_hook_enabled`— en **`off`**, así que hasta que un humano lo encienda **no gasta un solo crédito ni
> escribe una sola fila**. ~~El orden de encendido lo fija §4.38h: rodar el ingest **en observación con la
> vitrina apagada**, revisar la traza (`AuditLog` `graded_estimate.ingest.*`) y solo entonces encender la
> exhibición.~~ ⛔ **ACTUALIZADO en v1.51 (M-46, §4.38r):** con un solo dial ese orden **ya no es
> expresable**; el sustituto es rodar con la **SONDA** (`POKEMONPRICETRACKER_GRADED_PROBE=on`, solo-lectura
> por construcción), revisar la traza y la lista de revisión, y **solo entonces** encender el dial — que
> desde v1.51 es un **acto de gasto** además de una decisión comercial (§4.38r.3).
>
> **Y una escalada que puede reabrir esto como decisión de ARQUITECTURA (regla 9):** si la corrida revela que
> `includeEbay=true` **no** combina con `fetchAllInSet=true`, el job **PARA** y lo reporta (`escalation`). En
> ese escenario **no** hay solución de implementación: pasar a «una petición por carta» multiplica el coste
> (2 créditos × carta) e invalida el barrido por set, así que **vuelve al arquitecto** para rediseñar hacia un
> ingest **curado por lista**. Backend **no lo forzará**.

<details>
<summary>Redacción original (histórica, v1.44 — describía el bloqueo ya derogado)</summary>

- **Dueño:** backend (el cambio vive en `src/modules/pricing/providers/`, que quedó **fuera del alcance** de
  esta rama por decisión del orquestador). **Severidad:** Media (aceptada, **no** bloqueante de v1.44).
  **Ligada a `BE-6` · «Providers de precio graded/sealed son stubs»**: BE-GE1 es literalmente el **paso 0**
  para poder cerrar BE-6 en su vertiente PSA — sin la observación de staging no hay evidencia con la que
  implementar el `fetchPrice` real de PokemonPriceTracker.
- **Dónde:** `src/modules/pricing/providers/pokemonpricetracker-bulk.provider.ts:209` (truncate del log de
  muestra del payload) + la env `POKEMONPRICETRACKER_INCLUDE_EBAY`, sin cablear. ARCHITECTURE §4.35h, paso 1.
- **Deuda:** la **fase 2** del gancho (ingest automático de los estimados PSA, hoy fijados a mano por el
  admin) está bloqueada por **doctrina P-6** (Gate 0, 2026-08-23): no se escribe ni un parser hasta
  **confirmar el payload real en staging**. Esa confirmación es precisamente lo que la instrumentación
  produce, y **hoy no existe**.
- **Impacto — el detalle crítico, que es lo que la hace Media y no Baja:** con el truncate en **800**
  caracteres, la muestra del payload que se loguea **se corta antes de llegar a los bloques de grado**, así
  que la observación de staging concluye **«el proveedor no manda PSA» cuando sí lo manda**. Es un **falso
  negativo**: el gate que decide si la fase 2 es viable está midiendo mal, y con esa medición la fase 2 se
  descartaría por una razón inexistente. Es deuda de **observabilidad**, no de dinero: no toca ningún monto,
  ningún precio de venta ni el comportamiento visible (fase 1 y fase 2 son indistinguibles para el cliente).
- **Disparador:** **antes de correr la observación de staging de fase 2** (es decir, antes de tomar cualquier
  decisión sobre el ingest automático de PSA). Solución: subir el truncate de `800` → **`4000`** chars y
  cablear `POKEMONPRICETRACKER_INCLUDE_EBAY`. Dos cambios de una línea; el trabajo real es la observación.
  **Requiere que el orquestador/arquitecto asigne el módulo `pricing/providers` a un stream** (hoy fuera del
  alcance de esta rama). Ref: `docs/BACKEND_NOTES.md` §0.2 › «NO implementado a propósito», `BE-6`.

</details>

#### BE-GE3 · **Concentración de fuente: SOLO PokemonPriceTracker puede entregar PSA** (Media — riesgo ACEPTADO)
- **Dueño:** backend. **Severidad:** Media (riesgo **aceptado**, no bloqueante). Origen: §4.38h.4, recuadro
  «RIESGO ACEPTADO — proveedor único»; el arquitecto pidió expresamente que el apunte lo haga **el rol dueño
  del código**, no él.
- **Dónde:** `src/modules/pricing/providers/pokemonpricetracker-bulk.provider.ts` es hoy el **único** camino
  hacia un valor por **grado**. Los otros dos providers **no son sustitutos ni degradados**, y la razón es
  estructural, no de calidad: **TCGCSV y pokemontcg.io tienen eje de ACABADO** (normal / reverse holo /
  holofoil), **no de GRADO** (PSA 10 / PSA 9). No es que traigan el dato peor: **no lo traen**.
- **Segundo candidato inexistente:** `PokeTraceProvider` (`providers/graded-sealed.providers.ts`) está
  **declarado y registrado en el módulo, pero nunca implementado** (es un stub — ver `BE-6`). **No se diseña
  ahora**, y eso también es deliberado: no hay evidencia de que exponga PSA, y diseñar contra esa suposición
  sería **reincidir exactamente en P-6**, la doctrina que el parser de §4.38h acaba de satisfacer por
  construcción.
- **Impacto si PPT cambia el shape o retira el dato:** la fase 2 **se detiene sola** (el parser no escribe lo
  que no reconoce, así que **no hay riesgo de dato malo**) y la feature **degrada a MANUAL** — que es el estado
  de v1.50 y **funciona**: el humano cura sus cartas gancho con `POST /admin/pricing/override`. Ningún precio
  de venta se mueve, ningún DTO cambia de forma, el storefront no se entera (§4.38g). El coste real es
  **operativo**: vuelve la talacha de capturar a mano.
- **Detección:** la traza obligatoria del job (§4.38h.4) lo hace visible sin que nadie tenga que mirar la BD —
  un cambio de shape aparece como **`unrecognized_shape` masivo** en log + `AuditLog`, y una retirada del dato
  como `no_graded_block_in_response` (que además **escala**). Sin esa traza, la degradación sería silenciosa.
- **Disparador:** (a) si PPT deja de entregar PSA de forma sostenida, o (b) si el dueño quiere redundancia
  antes de apoyarse comercialmente en la cifra. **Solución:** evaluar un segundo proveedor **con evidencia en
  mano** (payload real) e implementar `PokeTraceProvider` —o el que resulte— detrás del **mismo** contrato de
  fila (`GradedEstimateSourceRow`), de modo que el resto del camino (gate de confianza, INV-FX, INV-D,
  persistencia) **no se entere de la fuente**. Eso es diseño de proveedor, así que pasa por el arquitecto.
### Deuda del pase P-47 parte 2 (rama `fix/variant-composition-regression`, techlead APROBADO CON DEUDA, 2026-08-24)

> Cierre de **P47-2** (§4.27f-2, v1.46): el override MANUAL es tier superior absoluto durable cross-day, y
> la lectura de referencia une SIEMPRE a las candidatas del bloque reciente TODAS las filas manuales de la
> clave (`MANUAL_REF_PREDICATE`, sin cota de fecha). El fix money-relevante ya está corregido con tests y no
> figura como deuda; lo de abajo son los **3 ítems menores NO bloqueantes** que el techlead pidió anotar como
> condición del cierre. Ninguno mueve dinero. Dueño de los tres: **backend**.
>
> **Cierre del eje P-47 (partes 1+2+3):** cerrado con **triple veredicto — QA APROBADO, techlead APROBADO CON
> DEUDA ANOTADA (estos ítems + los de «P-47 parte 3»), seguridad CERRADA (v1.47)**.

#### BE-79 · `ownedItemRefs` agrupa SIN `cardProductId` (omite `BASE_CARD_REF_WHERE`) (Baja — display, preexistente)
- **Dónde:** `backend/src/modules/admin/admin.service.ts` (`ownedItemRefs`, ~L307). El `findMany` filtra solo
  por `cardId` y la reducción llavea por `${cardId}|${productType}|${gradeKey}|${finish}` (~L323), **sin**
  aplicar `BASE_CARD_REF_WHERE` ni distinguir `cardProductId`, a diferencia de `getReference` /
  `getReferencesBatch` (que SÍ acotan al set_base/other vía `BASE_CARD_REF_WHERE`).
- **Estado actual:** **preexistente** — NO introducido por `330f0b4` (P47-2 solo cambió «primera vista» →
  `isBetterRef` sobre el mismo conjunto). Teóricamente una `PriceReference` de un `deck_exclusive`/`promo`
  bajo el MISMO `cardId` podría **contaminar el bucket** de la carta de set en la vista 360° del admin
  (esos precios viven en su producto separado y `getReference` los excluye a propósito).
- **Impacto:** bajo — vista de **display** (valuación 360° del admin), **no money-moving** (el cobro/cotización
  reales van por `getReference`/`getReferencesBatch`, que sí acotan). El escenario requiere que coexistan filas
  de un producto separado y de la carta de set bajo el mismo `cardId`.
- **Disparador:** al **unificar la capa de valuación del admin con `getReferencesBatch`** (familia BE-4/BE-49/
  RB-8): al migrar `ownedItemRefs` a la primitiva batch compartida hereda `BASE_CARD_REF_WHERE` y el keying por
  `cardProductId`, cerrando la contaminación teórica de paso.

#### BE-80 · Lectura DIRIGIDA de manuales (`MANUAL_REF_PREDICATE`) sin `take` (Baja — teóricamente no acotada)
- **Dónde:** `backend/src/modules/pricing/pricing.service.ts` — la rama `manualRows` de `getReference` (~L339-342)
  y su homóloga en `getReferenceByCardProduct` (~L397) leen TODAS las filas que matchean `MANUAL_REF_PREDICATE`
  (overrides humanos de la clave) **sin cota de fecha ni `take`** (a propósito: un override de meses atrás no
  debe caer fuera de la ventana). El bloque reciente SÍ va capado (`take: SAME_DAY_REF_CANDIDATES`).
- **Estado actual:** teóricamente **no acotada**; en la práctica acotada por el **nº de overrides humanos por
  clave** (un puñado — los pone un operador a mano, no un feed). `pickBestRef` desempata el conjunto.
- **Impacto:** bajo — el cardinal real es diminuto; no hay ruta que genere manuales en masa por clave.
- **Disparador (blindaje OPCIONAL):** si algún día se automatizara la escritura de manuales, añadir
  `orderBy: [{ capturedDate: 'desc' }]` + un `take` pequeño a la rama manual (el tier manual gana por
  **frescura entre manuales**, así que un `take` corto sobre el orden desc no cambia el ganador). Severidad
  menor; no urge.

#### BE-81 · El warn de la cota `MAX_SANE_MARKET_USD` (P47-1) no incluye `set`/`groupId` (Baja — observabilidad)
- **Dónde:** `backend/src/modules/pricing/providers/tcgcsv-singles-bulk.provider.ts` — el `logger.warn` de la
  cota de cordura `MAX_SANE_MARKET_USD` (~L144-148) emite `productId`/`finish`/`market` pero **no** `set`/
  `groupId`, que sí están en scope (el resto de warns del provider los incluyen).
- **Estado actual:** la línea audita cada `market` anómalo omitido POR VARIANTE; un feed **masivamente
  corrupto** de TCGCSV podría generar ruido por-variante sin el ancla `set`/`groupId` para agruparlo/filtrarlo.
- **Impacto:** bajo — **observabilidad** menor; no afecta correctness (la fila anómala se OMITE, money-safe).
  Ya señalado por **techlead** y **seguridad** en pases previos (nit de P47-1).
- **Disparador:** al tocar la observabilidad del provider TCGCSV singles, añadir `set=${set.name}` /
  `groupId=${groupId}` al warn de la cota (paridad con los otros dos warns del mismo archivo).

### Deuda del pase P-47 parte 3 (rama `fix/variant-composition-regression`, techlead APROBADO CON DEUDA, 2026-08-23)

> Ingesta de precios de singles vía TCGCSV. Los 3 ítems de abajo son **menores no bloqueantes**;
> el camino singles lean está justificado por §4.35 del contrato. Dueño de los tres: **backend**.

#### BE-76 · Dos caminos de ingesta divergentes (singles lean vs pipeline PPT) (Baja — mantenibilidad)
- **Dónde:** dispatch en `src/modules/pricing/price-ingest.service.ts:336`
  (`if (provider.source === 'tcgcsv_singles')`) → camino lean keyed por `cardProductId`
  (`ingestSinglesForSet`, `price-ingest.service.ts:483-531`) **vs** el pipeline PPT/`pokemontcg_io`
  (resolveCardId + colapso `(cardId, finish)` + snapshot + `FinishReconciler`).
- **Estado actual:** justificado por **§4.35** (el provider TCGCSV singles ya viene keyed por producto, no
  necesita resolución/colapso). Pero son **dos rutas paralelas** que pueden **driftar**: un 3er provider o
  un cambio de semántica (FX, persistencia de snapshot) hay que aplicarlo en **dos sitios** en sincronía.
- **Impacto:** bajo; correctness OK hoy. Riesgo de **evolución futura** (divergencia al editar una ruta y
  no la otra).
- **Disparador:** al añadir un 3er provider de ingesta o cambiar la semántica FX/persistencia compartida,
  factorizar la parte común de ambos caminos (o documentar explícitamente qué diverge a propósito).

#### BE-77 · `BulkPriceRow` acumula campos por-provider (unión disfrazada + campo muerto) (Baja)
- **Dónde:** `src/modules/pricing/pricing.types.ts` (~`:214`/`:222`) y
  `src/modules/pricing/tcgcsv-singles-bulk.provider.ts:131`.
- **Estado actual:** el tipo compartido `BulkPriceRow` mezcla campos que solo usa **un** camino:
  `cardId?`/`cardProductId?` los consume solo el camino singles; `finishAliasVerified`/`forcedPrinting`
  solo el camino PPT. El tipo deriva de facto a una **unión de dos formas disfrazada** de un solo tipo con
  opcionales. Además el provider TCGCSV setea `finishAliasVerified: true`
  (`tcgcsv-singles-bulk.provider.ts:131`) en filas que **su propio camino nunca lee** → **campo muerto**.
- **Impacto:** bajo; correctness OK. Legibilidad/seguridad de tipos: un opcional no señala qué camino lo
  usa, y el campo muerto confunde.
- **Disparador:** si aparece un **4º campo** por-provider, partir el tipo en `BulkPriceRow` (fila cruda, sin
  resolver) **vs** `ResolvedSinglesRow` (fila ya keyed por producto), y limpiar el `finishAliasVerified`
  muerto del provider TCGCSV.

#### BE-78 · 9º param del constructor opcional (`tcgcsvSinglesBulk?`) — DI que en prod siempre se inyecta (Menor-a-moderada, money-relevante si se rompe DI)
- **Dónde:** constructor de `src/modules/pricing/price-ingest.service.ts:154`
  (`tcgcsvSinglesBulk?`); registro real en `src/modules/pricing/pricing.module.ts:66-67`.
- **Estado actual:** la dependencia `tcgcsvSinglesBulk` **siempre se inyecta en prod** (está registrada en
  `pricing.module.ts:66-67`); se dejó **opcional** en el constructor **solo para no tocar los mocks** de los
  tests. Si alguien **olvida registrarla** y el dial de ingesta es `tcgcsv_singles`, `providerFor()` cae en
  **silencio** al `pokemontcg_io` → elige el **provider equivocado**, y eso es **money-relevante** (los
  precios de ingesta alimentan valuación/cotización).
- **Impacto:** menor-a-moderada. No ocurre con la config actual (DI correcta), pero el fallo sería
  **silencioso** y afecta dinero.
- **Disparador:** hacer el parámetro **requerido** (quitar el `?`) y **actualizar los mocks** de los tests
  que instancian el servicio, para que un fallo de DI reviente en arranque en vez de degradar en silencio.

---

## Frontend (dueño: frontend)

> Deuda aceptada del veredicto del techlead sobre la rama `fix/carrito-pieza-muerta`
> (v1.21.3-quote-prune, 2026-08-18) + un hallazgo de QA. El único fix de código de ese veredicto
> (F-2: re-quote tras `ITEM_UNAVAILABLE`/`NOT_FOUND` en session) **ya se corrigió en la misma rama**
> y no figura aquí. Todos los ítems son no bloqueantes; dueño **frontend**.

### F-P48-1 · Gráfico de la curva (`PricingCurveChart`, DS §21.5c) no implementado (Baja)
- **Dónde:** `frontend/src/app/[locale]/(admin)/admin/m2/curve/CurvePreview.tsx` — el previsualizador
  entrega las **dos capas obligatorias** de §21.5 (probeta con memoria de cálculo + tabla de
  referencia). Falta la tercera, **recomendada y explícitamente no bloqueante** para el primer
  entregable: el SVG con eje X logarítmico en las fronteras del `MarketBracket`, los cuatro trazos
  (venta borrador con su escalera, compra borrador, curva guardada detrás y la identidad
  `venta = mercado`) y las reglas horizontales de piso/mínimo.
- **Impacto:** bajo. La **alternativa accesible obligatoria del gráfico es la tabla de referencia**
  (§21.5b), que sí está: no hay pérdida de información ni de accesibilidad, solo de lectura rápida
  de la FORMA de la curva al calibrar. El aviso textual «la curva va al revés de lo previsto»
  (§21.5b) cubre el caso que el gráfico haría obvio de un vistazo.
- **Disparador:** cuando el dueño empiece a calibrar con el reporte `GET /admin/reports/pricing-brackets`
  (§N.8): ahí el gráfico y el reporte **hablan del mismo eje** y compararlos deja de ser mental.
  Los datos ya vienen servidos por el dry-run (`rows`), así que es trabajo de dibujo, no de cálculo.

### F-P48-2 · El previsualizador no funciona en modo mock (Baja, deliberada)
- **Dónde:** `frontend/src/lib/api.ts` → `previewPricingCurve` **no tiene rama mock**: siempre llama
  al backend (`POST /admin/pricing/curve/preview`).
- **Por qué es deliberado:** fingir el cálculo en el cliente —aunque fuera «solo para la demo»— es
  exactamente la duplicación de fórmula de dinero que ese endpoint existe para matar (ARCH §4.36.8a).
  Un mock plausible se convierte, con el tiempo, en la cifra contra la que alguien calibra.
- **Impacto:** con `NEXT_PUBLIC_USE_MOCKS` (dev sin backend y los E2E de Playwright en modo mock) el
  previsualizador muestra su **estado de error honesto** («no se muestran cifras estimadas») y la
  columna derivada de cada fila queda en «—». El editor sigue siendo operable: constantes, puntos,
  reorden, borrado, diff y guardado funcionan contra el mock del `PUT`. **No hay riesgo de dinero**:
  la pantalla nunca inventa un precio.
- **Disparador:** si se quiere E2E de las cifras de la prueba de mesa (§21.13.5g) en el pipeline de
  mock, la salida correcta **no** es escribir la fórmula en el cliente: es levantar el backend
  (`E2E_REAL=1`) o servir un *fixture grabado* de la respuesta real del dry-run.
- **`fixtures.ts` › `mockDemoBuyQuote`: la distinción, y su corrección de 2026-08-24.** El mock del
  cotizador **sí** evalúa la curva de compra en cliente para que la demo no quede vacía. **Rellenar
  una demo no es calibrar:** el previsualizador existe para que el dueño **elija los puntos**
  mirando una cifra —si fuera local, elegiría contra un número que el backend no produce, P-48 en
  espejo—; en la demo nadie toma una decisión de dinero con ese número y el monto real siempre lo
  deriva el backend (SEC-A1).
  **Pero la demo tampoco puede estar 67% equivocada.** QA lo midió contra el stack vivo: con
  constantes idénticas, un mercado de MX$1,000 pagaba **MX$300** en mock y **MX$500** en real,
  porque el mock aplicaba el pct del PRIMER punto a todo el dominio. Corregido (v2.1.7): el mock
  **interpola**, y hay un test que fija que reproduce la **prueba de mesa de compra** de
  ARCHITECTURE §4.36.1 (`$10⇒$3 · $25⇒$7.50 · $100⇒$40 · $300⇒$135 · $500⇒$250`). El eje de compra
  queda estructuralmente completo (no se redondea); **el de VENTA sigue sin la escalera**, así que
  un monto de venta del modo demo puede diferir del real hasta un escalón.
- **Consecuencia práctica que sigue vigente:** **un E2E en modo mock que afirme MONTOS de VENTA no
  verifica el precio del producto.** El único assert de dinero del cotizador
  (`e2e/buylist.spec.ts`) usa `MONEY_RE` — **formato**, no monto — y queda anotado ahí mismo. Los
  montos exactos de otros specs (`inventory-stream-b.spec.ts`) son valores de mercado, spread de
  sellado y precios de bounty **explícitos**: ninguno pasa por la curva.

### F-P48-3 · ~~Conteo por motivo de la cola derivado de la página cargada~~ — **RESUELTA (2026-08-24)**
- **Estaba mal clasificada.** Se registró como «espera solicitud abierta al arquitecto», pero la
  solicitud **se resolvió mientras el frontend trabajaba**: el contrato **v2.1** norma
  `counts: { no_market, premium_at_floor, unknown }` en el **cuerpo** de `GET /admin/pricing/pending`
  (`API_CONTRACT` §M2) y el backend ya lo devuelve. Lo que quedaba era **drift del lado del
  frontend**, no deuda de producto.
- **Cerrado:** `frontend/src/types/contract.ts` declara `PendingPriceCountsDTO` /
  `PendingPriceQueueResponse`; `getPendingPrices` devuelve `{ data, counts }`; y
  `PendingQueueSection.tsx` pinta los counts **verbatim** — no los recalcula ni los filtra en
  cliente, porque el contrato manda que **ignoren `?reason=` y la paginación pero respeten
  `?context=`**. Se pinta también `unknown` (filas anteriores a M-41) cuando es > 0: sostiene el
  invariante `no_market + premium_at_floor + unknown === entradas open de esa cola`; sin ella los
  números no cuadran con la lista y parece un bug del backend. Cubierto por tres tests en
  `M2View.test.tsx` (counts verbatim, el filtro no mueve el encabezado, y `unknown` pintado).

### F-1 · Efecto de poda duplicado en CheckoutView/GuestCheckoutView (Baja)
- **Dónde:** `frontend/src/app/[locale]/(storefront)/checkout/CheckoutView.tsx` y
  `GuestCheckoutView.tsx` — el mismo par `pushUnavailableNotice(unavailable)` +
  `prune(unavailable.map(...))` vive copiado en un `useEffect` de cada componente.
- **Impacto:** bajo (mantenibilidad). Un matiz futuro a la lógica de poda (orden, dedupe, telemetría)
  hay que aplicarlo dos veces; si se aplica en una sola vista, las dos naturalezas del checkout
  divergen en silencio.
- **Disparador:** próximo matiz a la lógica de poda. Acción: extraer un hook
  `useQuotePrune(unavailableItems)` junto a `unavailable-notice.ts` y consumirlo desde ambas vistas.

### F-3 · Store de módulo con `getServerSnapshot` compartido en `unavailable-notice.ts` (Baja)
- **Dónde:** `frontend/src/app/[locale]/(storefront)/checkout/unavailable-notice.ts` —
  `useSyncExternalStore(subscribe, getSnapshot, getSnapshot)` usa la MISMA función para cliente y
  servidor; la seguridad SSR depende de una invariante **no escrita**: «el array `notice` solo se
  muta desde efectos de cliente» (si algún día se mutara en render/SSR, el snapshot de servidor
  dejaría de ser estable).
- **Impacto:** bajo/latente. Hoy correcto; el riesgo aparece con el próximo colaborador que mute el
  store fuera de un efecto.
- **Disparador:** próximo toque al store. Acción: `getServerSnapshot = () => EMPTY` (constante
  congelada) o documentar la invariante en el docblock del store.

### F-4 · Dos idioms de estado compartido conviven (`useSyncExternalStore` vs `useState`+evento `window`) (Baja)
- **Dónde:** `frontend/src/app/[locale]/(storefront)/checkout/unavailable-notice.ts`
  (useSyncExternalStore) vs `frontend/src/lib/cart.ts` y `frontend/src/lib/session.ts`
  (useState + evento de `window`).
- **Impacto:** bajo (consistencia/mantenibilidad). Dos patrones para el mismo problema aumentan la
  carga cognitiva y el riesgo de elegir el equivocado en el siguiente store.
- **Disparador:** próxima vez que se toquen `cart.ts`/`session.ts`. Acción: converger a
  `useSyncExternalStore` como idiom único de estado compartido de módulo.

### F-5 · `UnavailableItemsNotice` reimplementa el botón de cierre del Banner (Baja)
- **Dónde:** `frontend/src/app/[locale]/(storefront)/checkout/UnavailableItemsNotice.tsx` (X propia
  vía `action`) porque el `dismissible` de `frontend/src/components/ui/Banner.tsx` no expone callback
  de cierre; de paso, el `aria-label="Close"` sin i18n de `Banner.tsx:65` (preexistente).
- **Impacto:** bajo (duplicación de UI + un aria-label sin traducir en el componente base).
- **Disparador:** próximo consumidor que necesite un cierre con efecto. Acción: darle a `Banner` un
  `onDismiss?` (y usar copy i18n en su aria-label); `UnavailableItemsNotice` pasa a usarlo.

### F-6 · JSDoc/mocks desactualizados en `api.ts` tras v1.21.3 (Baja)
- **Dónde:** `frontend/src/lib/api.ts` — (1) el JSDoc del quote de invitado aún lista
  `409 ITEM_UNAVAILABLE` como error del quote (desde v1.21.3 los quotes resuelven por ítem y
  devuelven `200` con `unavailableItems`); (2) la lógica de poda del mock está duplicada en los dos
  quotes mock; (3) el mock no modela el caso «existe pero fuera de venta» (`cardName` poblado) — los
  ids ausentes de fixtures siempre salen con `cardName: null`.
- **Impacto:** bajo (documentación/mocks; no afecta producción). Puede confundir al siguiente
  desarrollador o dejar sin cobertura de mock un copy real.
- **Disparador:** próximo toque a los mocks de `api.ts`. Acción: corregir el JSDoc, extraer la poda
  mock a un helper único y añadir un fixture «fuera de venta» con nombre.

### F-7 · Suite Playwright sin los flujos de poda de piezas muertas (QA) (Media)
- **Dónde:** `frontend/e2e/checkout.spec.ts` y `frontend/e2e/guest-checkout.spec.ts` — el banner de
  piezas muertas, el EmptyState por carrito 100 % muerto y la poda del `localStorage` hoy solo están
  cubiertos en jsdom (`CheckoutUnavailable.test.tsx`), no de punta a punta contra el stack corriendo.
- **Impacto:** medio para la garantía de release: el flujo crítico nuevo de v1.21.3 (incluido el
  re-quote F-2) no forma parte del harness E2E que ejecuta QA.
- **Disparador:** cierre de release (suite E2E completa). Acción: añadir a las dos specs los
  escenarios de poda (parcial, total y carrera quote→pago) sembrando una pieza que muere entre
  medias.

### Pase `sellado-producto-cerrado` — deuda del sellado (2026-08-19, no bloqueante)

> Deuda aceptada del work stream de Sellado anotada por backend en esta pasada de saneo (frontend NO
> tocó `TECH_DEBT.md` en este pase, para evitar conflicto de escritura; los ítems son **dueño frontend**
> y se registran aquí de los reportes de QA/techlead). Continúan la numeración `F-*` (tras F-7).

### F-8 · Facetas de set APROXIMADAS en `SealedShopView` (Media)
- **Dónde:** `frontend/src/app/[locale]/(storefront)` — `SealedShopView` (vista del grid de sellado).
- **Estado actual:** las facetas de **set** del filtro de la ventana de sellado se pueblan **de la página
  ya cargada** (los grupos visibles), no del **universo** de sets con sellado publicado. Con paginación,
  un set cuyo producto sellado no aparece en la página actual **no se ofrece** como filtro.
- **Impacto:** medio (UX de descubrimiento). El comprador puede no ver un set como opción de filtro pese a
  existir sellado de ese set en catálogo.
- **Disparador:** cuando el catálogo sellado tenga suficientes sets para paginar. Solución: **endpoint de
  facetas** del sellado (sets con sellado publicado, agregado en BD) — **pasa por el arquitecto** (contrato,
  regla 9), análogo a las facetas de Compra (`facets`).

### F-9 · Cosmético M2 — placeholder `?? 15` mientras el seed real del fallback global es `25` (Baja)
- **Dónde:** frontend del editor de spreads del sellado (M2) — el placeholder del fallback global usa
  `?? 15`.
- **Estado actual:** el placeholder/valor por defecto mostrado usa `15`, pero el **seed real** del dial
  `sealed_spread_fallback_pct` es **25** (`SETTING_DEFAULTS`). Solo cosmético: el valor efectivo lo manda
  el backend; el `?? 15` únicamente pinta un placeholder cuando el campo llega vacío.
- **Impacto:** bajo (cosmético). Puede confundir al súper-admin al leer `15` como "el default" cuando el
  fallback vigente es `25`.
- **Disparador:** próximo toque al editor de spreads M2. Solución: alinear el placeholder a `25` (o
  derivarlo del valor servido por el backend en vez de hardcodearlo).

### F-10 · `SealedVaultPanel` re-keyea por `card.id-subtype-condition` ignorando `tcgplayerProductId` (Baja)
- **Dónde:** `frontend` — `SealedVaultPanel` (pestaña «Sellado» de la bóveda) usa como key de React
  `card.id-subtype-condition`.
- **Estado actual:** la key de la lista **omite** `tcgplayerProductId`; si una misma `Card` ancla **dos
  productos sellados distintos** con el **mismo `sealedSubtype` + condición**, sus grupos colisionan en la
  **misma key React** (posible reconciliación incorrecta / warning de keys duplicadas).
- **Impacto:** bajo. Requiere el caso raro de dos productos mapeados al mismo Card ancla con idéntico
  subtype+condición; a lo sumo un render inestable de esas filas.
- **Disparador:** si aparece un Card ancla con dos productos del mismo subtype+condición. Solución: incluir
  `tcgplayerProductId` (o el `representativeItemId`, que ya es único por grupo) en la key.

### Stream «pulido del CHECKOUT de invitado» (rama `claude/pulido-checkout`) — deuda del delta (2026-08-19, no bloqueante)

> Deuda aceptada del veredicto del **techlead** (gate por-stream) sobre el pulido del guest checkout.
> El único ítem es **dueño frontend**, no bloqueante, registrado sin tocar código de producción en este
> pase. Continúa la numeración `F-*` (tras F-10).

### F-11 · Mock de dinero del frontend omite el IVA de la comisión Stripe (C1) en el gross-up (Baja)
- **Dónde:** `frontend/src/lib/api.ts` — `computeBreakdown` (~L511-517) y `computeGuestBreakdown`
  (~L2963-2977); el nuevo `vaultBreakdown` (N-12) reusa `computeBreakdown` y por tanto **hereda la misma
  omisión**.
- **Estado actual:** el mock calcula el total como `ceil((base + STRIPE_FIXED) / (1 - STRIPE_PCT))`,
  mientras que el backend (`backend/src/common/money.ts`, `grossUpTotal`) aplica **además** el factor
  `(1 + stripe_fee_iva_pct)` (dial `stripe_fee_iva_pct=0.16`, IVA que Stripe MX cobra sobre su comisión,
  C1). Para el mismo input, el mock produce un `processingFeeCents`/`totalCents` **distinto** al de
  producción.
- **Severidad:** **NO bloqueante.** **Preexistente** — ambas réplicas ya omitían el factor; N-12 solo lo
  **propaga** a `vaultBreakdown`. El mock es **dev-only** (`config.useMocks`); en runtime el desglose
  autoritativo es el del **backend**, y el contrato §4-G.1 reconoce que el mock replica con un
  `StripeFeeConfig` de prueba **solo para desarrollo offline**.
- **Riesgo:** un dev que valide totales contra el mock verá cifras que no cuadran con staging/prod y puede
  perseguir un **bug fantasma**. **NO** usar los totales del mock como referencia de fee/total.
- **Disparador / dirección de pago (si algún día se toma):** una **única** `computeBreakdown` en el mock que
  acepte `stripeFeeIvaPct` y **espeje `grossUpTotal`**, para tener una sola fórmula replicada en vez de dos.

### Stream `inventario-precios-admin` — deuda de INV-1/INV-2 (2026-08-19, no bloqueante)

> Deuda aceptada del veredicto del **techlead** (gate por-stream) sobre `claude/inventario-precios-admin`
> (INV-1: editor de reglas money-safe que preserva claves sintéticas; INV-2: total on-hand por carta en el
> binder de Master Set). Ambos ítems son **dueño frontend**, no bloqueantes, registrados a petición del
> techlead sin tocar código de producción. La observación de robustez del propio INV-1 (Guardar como no-op
> silencioso si la tabla cruda falla/carga) **se corrigió en la misma rama** (gate del `disabled` con
> `!buylistRules.data`/`!salesRules.data` + Banner de reintento) y **no** figura como deuda. Continúa la
> numeración `F-*` (tras F-11).

### F-12 · `fallbackPct` con doble fuente en M2View (Baja)
- **Dónde:** `frontend/src/app/[locale]/(admin)/admin/m2/M2View.tsx` — editores de buylist y de venta.
- **Estado actual:** el `fallbackPct` se lee de la **vista de rarezas** (`rarities.data.fallbackPct` /
  `salesRarities.data.fallbackPct`) para pintar el input, mientras que la **tabla cruda** (`getBuylistRules`/
  `getSalesRules`, añadida en INV-1 como base del merge de guardado) **también** trae `fallbackPct`. Hoy ambas
  fuentes **coinciden** (el backend las deriva del mismo dial), así que no hay divergencia observable.
- **Impacto:** bajo (mantenibilidad/consistencia). Si en el futuro las dos rutas divirgieran, el valor pintado
  y el efectivo podrían desalinearse.
- **Disparador:** próximo toque a los editores de reglas de M2. Solución: leer `fallbackPct` de **una sola
  fuente** (preferir la tabla cruda, que ya es la base del guardado) y derivar de ahí el input y el merge.

### F-13 · Total on-hand por carta se repite en cada tarjeta de impresión (Baja)
- **Dónde:** `frontend/src/components/master-set/MasterSetBinder.tsx` — `TileHeader` (badge `cardTotalCount`).
- **Estado actual:** por la rejilla plana N-16 (una tarjeta por impresión), el total on-hand **por carta**
  (`cell.totalCount`) se pinta en **cada** tarjeta de esa carta (p. ej. las 3 tarjetas de Charizard muestran
  las tres «4 en total»). Es intencional (el `TileHeader` es compartido) y está desambiguado por `title`
  (tooltip «tengo N de esta carta en total»), pero visualmente el mismo dato se repite.
- **Impacto:** bajo (UX/estética). No es incorrecto; puede leerse como redundante en cartas con muchos acabados.
- **Disparador:** próxima iteración de UX del binder. Posible mejora: **agrupar visualmente** las impresiones
  de una misma carta (encabezado por-carta sobre su grupo de tarjetas) y mostrar el total **una sola vez** ahí,
  en vez de por tarjeta.

> Deuda de INV-3 (indicador «Precio manual» en M1: el override `listPriceCents` ignora las reglas de precio
> globales). Aprobado por **techlead** con dos observaciones **ya cerradas en la misma rama** (predicado
> `hasManualPrice` que espeja money.ts H-1 para sellado, y `ManualPriceBadge` compartido con hint accesible
> focuseable) — no figuran como deuda. Las dos entradas siguientes son menores/aceptadas. Continúa `F-*` (tras F-13).

### F-14 · El badge «Precio manual» + monto vive en la columna «Referencia» de M1 (Baja)
- **Dónde:** `frontend/src/app/[locale]/(admin)/admin/m1/M1View.tsx` — columna `reference` de la tabla de piezas.
- **Estado actual:** la columna «Referencia» pinta la **referencia de mercado** (`PriceTag`, input de las reglas)
  y, cuando la pieza tiene override, además el `ManualPriceBadge` con el **precio de lista manual**. Son dos
  conceptos distintos (referencia de mercado vs. precio de venta manual) compartiendo una sola columna. Hoy se
  desambigua por el badge en versalitas + el monto etiquetado, pero conviven en el mismo espacio.
- **Impacto:** bajo (claridad/semántica). Un operador podría leer el monto del override como si fuera la referencia.
- **Disparador:** próxima iteración de la tabla M1. Posible mejora: **columna de precio dedicada** (precio de
  lista efectivo / override) separada de la referencia de mercado.

### F-15 · La combinación `neutral + outline` del `Badge` no está en el status-map del DS (Baja)
- **Dónde:** `frontend/src/components/domain/ManualPriceBadge.tsx` (y el `Badge` base `neutral`/`outline`).
- **Estado actual:** el badge «Precio manual» usa `tone="neutral" shape="outline"`, una combinación **válida y
  sobria** que el componente `Badge` soporta, pero que **no está catalogada** en la tabla de badges de estado del
  `DESIGN_SYSTEM.md` (§2, mapeo `enum → tono/forma`). No es un estado de negocio del contrato, sino un indicador
  de UI, por eso no encaja en el status-map tal cual.
- **Impacto:** bajo (gobernanza del DS). Sin ratificar, otro dev podría dudar de si la combinación es «oficial».
- **Disparador:** revisión del sistema de badges por **ux-ui**. Acción: que ux-ui **ratifique** (o ajuste) el uso
  de `neutral + outline` para indicadores de UI no-estado, y lo documente en `DESIGN_SYSTEM.md`.

### F-16 · Badge «Precio manual» en el binder de Master Set — FOLLOW-UP diferido (decisión del PO) (Baja)
- **Dónde:** `frontend/src/components/master-set/MasterSetBinder.tsx` (casilla por impresión, junto al «N en total»).
- **Estado actual:** INV-3 pinta el badge «Precio manual» SOLO en M1 (lista «Piezas» + detalle), donde el override
  es por pieza (`InventoryItemDTO.listPriceCents`, dato ya en contrato). El PO (opción A) decidió publicar así y
  dejar el master-set como follow-up aparte.
- **Por qué NO se hizo ahora (regla 9):** el DTO del binder **no trae** señal de override (solo
  `count`/`covered`/`totalCount`), y una casilla post-N-16 **agrega varias piezas** de la misma (carta, acabado):
  algunas pueden tener override y otras no → el indicador sería «**alguna** pieza es precio manual», semántica
  distinta a la de M1. Requiere **cambio de contrato** (p. ej. `anyManualPrice`/conteo de overrides por celda o
  variante) que pasa por **arquitecto** antes de tocar backend/frontend.
- **Disparador:** que el PO confirme que quiere el indicador agregado en el binder. Acción: arquitecto define el
  campo aditivo en `docs/API_CONTRACT.md` §M1 (binder) → backend lo agrega a la agregación → frontend lo pinta.

### F-17 · E2E `catalog.spec.ts:36` («tarjeta de SELLADO») falla desde antes del gancho de grading (Media)
- **Dónde:** `frontend/e2e/catalog.spec.ts:36` — «tarjeta de SELLADO: badge "Sellado" + precio, sin
  condición/rareza».
- **Estado actual:** **rojo**, y **ya lo estaba en `origin/main`** (QA lo verificó en un worktree limpio; se
  reconfirmó en la rama `claude/psa-graded-card-value-gmhv5u`: `9 passed / 1 failed`, siendo ese el único
  fallo). **No es una regresión del gancho de grading**: la rama v2.0 no toca el filtro de tipo, la teja de
  sellado ni sus fixtures — el spec nuevo `e2e/grading-estimate.spec.ts` corre **9/9 en verde** junto a él.
- **Por qué NO se arregló en este pase:** QA lo excluyó explícitamente del alcance del rechazo («no es tuyo,
  no lo arregles») y tocarlo mezclaría un fix de otro flujo con la corrección del bloqueante del disclaimer.
- **Impacto:** medio — mientras siga rojo, la suite completa de Playwright no puede usarse como gate «todo
  verde» sin una excepción anotada.
- **Disparador:** el work stream dueño del **sellado** (o el pase de estabilización de E2E) debe diagnosticar
  si lo que cambió es el copy del filtro, el fixture o la teja, y arreglar spec **o** producto según toque.
- **Actualización (2026-08-28, fusión con `main`/pricing v2):** tras el merge, `npx playwright test
  e2e/catalog.spec.ts` corre **13/13 en verde** en este entorno (modo mocks), incluido el caso de la tarjeta de
  sellado. **No se tocó el spec ni la teja de sellado** — el cambio que lo pudo arreglar viene de `main`
  (§21.8f retira «Valor de mercado» de las tejas y `SealedShopView`/`SealedDetailView` se movieron con la
  curva). La entrada **no se cierra desde frontend**: quien la abrió (QA) debe reconfirmarla en su entorno,
  porque el fallo original se observó ahí y un verde local no es evidencia suficiente para darla por muerta.
- **✅ CERRADA (2026-08-28, pase `intent` v1.50.2/v1.50.3).** La reconfirmación que faltaba **ya la hizo QA**:
  `catalog.spec.ts` corre **12/12** en mocks y **tampoco falla contra el stack real**. Con eso se cumple la
  condición que la entrada se había puesto a sí misma (que la cerrara quien la abrió, en su entorno), así que
  el hallazgo **está muerto** y deja de bloquear el uso de la suite Playwright como gate «todo verde».
  **No hubo fix**: el cambio que lo mató vino de `main` con la curva. Se deja la entrada como registro de
  procedencia, no como deuda abierta.

### F-18 · El mock del storefront no simula el interruptor `gradedEstimatesEnabled` (Baja)
- **Dónde:** `frontend/src/lib/mock/fixtures.ts` (`mockSettings.gradedEstimatesEnabled`, hoy `'on'`) frente a
  `mockGradingHighlightFor` / `mockGroupedDetail`.
- **Estado actual:** el dial existe en M10 y se guarda, pero **apagarlo en modo mock no apaga las cifras** del
  storefront: el gate y el interruptor son **server-side** (contrato §M10: con `off` el backend ni siquiera
  evalúa) y el fixture reproduce el **resultado** que el servidor ya resolvió, no su lógica. Por eso el mock se
  publica **encendido** (como un staging donde el dueño ya lo prendió) y así las tres superficies son
  coherentes entre sí. **El seed real sigue siendo `off`**, fail-closed.
- **Por qué se dejó así:** cablear el dial al fixture haría que un E2E de admin que guarde M10 **apagara las
  cifras para el resto de la suite** (servidor de dev compartido, `fullyParallel`), volviendo flaky a los
  specs de catálogo y home. El acoplamiento costaría más de lo que aporta.
- **Impacto:** bajo, y acotado al modo mock. La verificación del **criterio 90** (encender/apagar no cambia
  precios, portafolio, buylist ni P&L) se hace contra el **backend real**, donde el dial sí gobierna.
- **Disparador:** si QA quiere ejercitar el on/off end-to-end sin backend, wirear el dial en el fixture **y**
  aislar el estado por test (p. ej. reset del módulo entre specs) en la misma tarea.
- **Actualización (2026-08-28, contrato v1.50.2):** con `gradingHighlight` movido a
  `GroupedListingSummaryDTO`, el marcador del mock lo pone ahora **`groupMockSummaries()`** (rejilla), no
  `groupMockListings()` (ficha). La deuda **no cambia de naturaleza ni de severidad**: sigue siendo que el
  fixture reproduce el resultado del servidor y no la lógica del dial. Solo cambia el punto donde habría que
  wirearlo.

### F-19 · Nada en el cliente verifica que la rejilla NO reciba las señales de precio de D2 (Baja)
- **Dónde:** `frontend/src/lib/mock/fixtures.ts` (`groupMockSummaries`) y `frontend/src/lib/api.ts`
  (`getCatalog`, rama real).
- **Estado actual:** el tipo `GroupedListingSummaryDTO` impide **leer** `priceBasis`/`referenceValue` en la
  teja (que es lo que compra D2), pero en la rama **real** el cliente no comprueba que el backend tampoco los
  **emita**: si un día viajaran de más, TypeScript no diría nada (los campos extra no rompen en runtime) y la
  fuga de «qué cartas van por override» pasaría inadvertida desde el front.
- **Por qué se dejó así:** verificarlo es responsabilidad natural del **test de contrato** (backend/QA), no del
  cliente; añadir un guard en el cliente que descarte campos sería inventar una regla de emisión en la capa
  equivocada, y silenciaría el síntoma en vez de reportarlo.
- **Impacto:** bajo mientras el test de contrato cubra la forma de `GET /catalog/cards`.
- **Disparador:** si QA detecta drift entre lo que el backend emite y la lista blanca de D2, pedir al
  arquitecto un caso de contrato explícito («la rejilla no emite `priceBasis` ni `referenceValue`») antes de
  añadir nada en el cliente.

### F-20 · Los cinco diales del gate de confianza se MUESTRAN en M2 pero no se EDITAN ahí (Baja)
- **Dueño:** frontend. **Dónde:** `frontend/src/app/[locale]/(admin)/admin/m2/sections/GradedEstimatesSection.tsx`.
- **Estado actual:** el contrato (`PUT /admin/pricing/graded-estimates`, v1.50.2/v1.50.3) admite editar
  `manualFreshnessDays`, `maxRawMultiple`, `minSampleCount`, `sourceStat` e `ingestMaxCardsPerRun`. El panel
  los **pinta read-only** —se añadieron en este pase porque cambian lo que el operador ve y no tenía dónde
  consultarlos: con `manualFreshnessDays: 30` un estimado capturado a mano **caduca**, y `maxRawMultiple` es
  el tope contra el que la lista de revisión marca `ABOVE_MAX_MULTIPLE`— pero **no son editables** desde ahí.
- **Por qué se dejó así:** cada uno trae su propio rango normativo (`(1,1000]`, `[1,100]`, `null | [1,3650]`,
  enum de 3 valores, `[1,5000]`) y el editor de esta sección presume invariantes **por construcción**, no por
  regaño. Añadir cinco campos con validación propia en el pase que arregla el bloqueante de `intent` habría
  mezclado dos cosas y ampliado la superficie de un formulario que toca la curaduría del gancho.
- **Impacto:** bajo — se editan por API, y los seeds v1.50.3 ya son los correctos. Lo que NO se puede es
  ajustarlos sin llamada directa, que es exactamente lo que el criterio 110(e) pide para los **escalones**
  (esos sí se editan) pero no exige literalmente para estos cinco.
- **Disparador:** que el dueño necesite mover `maxRawMultiple` o `manualFreshnessDays` en caliente (p. ej.
  porque la lista de revisión marque demasiado o demasiado poco). Acción: extender el editor con los cinco
  campos y sus rangos, reusando el mismo patrón «bloquea el guardado, no regaña después».

### Pase `pulido-precios-display` — deuda del pulido de display de precios (2026-08-19, no bloqueante)

> Del stream `claude/pulido-precios-display` (referencia de mercado viva: `liveMxnCents` re-FX-eado al vuelo
> por request). Revisado por **techlead**: APROBADO **con deuda no bloqueante**. Ambos ítems son **dueño
> backend**, **severidad: no bloqueante** (correctos y money-safe). Registrados a petición del techlead sin
> tocar código de producción. IDs `D-1`/`D-2` prefijados por este stream para no colisionar con la D1–D5 del
> pase v1.1 (arriba).

### D-1 · FX al vuelo amplifica un N+1 preexistente en rutas de lectura calientes
- **Dónde:** `src/modules/pricing/pricing.service.ts` → `getReference` (single, `:133` invoca
  `fxSnapshotSafe()` en cada llamada); `src/modules/pricing/` `FxService.getCurrent()` **sin cache** hace ~3
  lecturas a BD (`settings.getNumber(FX_BUFFER_PCT)` + `settings.getRaw(FX_MANUAL_OVERRIDE_RATE)` +
  `fxRate.findFirst`), agravado por `SettingsService.get` sin cache (`settings.service.ts:22-26`).
- **Estado actual:** cada `getReference` dispara ~3 queries de FX extra, y `getReference` se llama en **bucles
  por-ítem** en los caminos calientes: `vault.service.ts:80` (valuación «Mi bóveda»), `buylist.service.ts:185`
  vía `batchQuote` (el nuevo quoter binder N-16 cotiza cada carta×acabado de un set completo),
  `admin.service.ts:571/589` e `inventory.service.ts:729`. Es la misma familia que BE-4/D3, ahora amplificada
  por la pata FX del display vivo. Correctness OK y money-safe.
- **Impacto:** rendimiento. Se vuelve urgente cuando una bóveda/set grande tenga **cientos de ítems**
  (latencia y presión de BD).
- **Disparador:** bóveda/set grande con cientos de ítems, o al endurecer las rutas calientes. Solución (ya
  existe la primitiva): migrar esos bucles a `getReferencesBatch` — que iza la FX **una sola vez por request**
  (`pricing.service.ts:181`) — y **batchear** los `card.findUnique` de `batchQuote` con `findMany`+`Map`.
  Considerar además **cachear `FxService.getCurrent()`** por request/TTL corto.

### D-2 · «referencia de mercado viva» solo es viva en la pata de FX (consistencia de display)
- **Dónde:** `src/modules/pricing/pricing.service.ts:104-111,136-138` (`liveMxnCents`).
- **Estado actual:** `liveMxnCents` recalcula el MXN con la **FX vigente**, pero `priceUsdCents` y
  `capturedDate` siguen siendo los **de la ingesta**. El monto mostrado es «USD del `capturedDate` × FX de
  hoy». Es la **doctrina correcta** (FX al vuelo, **no** mercado al vuelo) y es money-safe.
- **Impacto:** nulo funcional; solo **etiqueta de UI**. El riesgo es que el front pinte «precio del
  {capturedDate}» junto a un monto ya re-FX-eado (confusión de etiqueta USD-fecha vs MXN-hoy).
- **Disparador:** no requiere cambio de código backend. **Nota para frontend:** no rotular el `liveMxnCents`
  con la fecha de captura como si fuera el precio de ese día. Solución (front): separar/clarificar la etiqueta
  (p. ej. «ref. USD del {capturedDate}, MXN al tipo de cambio de hoy»).

### Pase `buylist-ordenes` — endurecimiento P-4 (2026-08-20, no bloqueante)

> Del stream `claude/buylist-ordenes` (endurecimiento post-aprobación de P-4: atomicidad intra-método
> del cierre de solicitud + verificación de `res.count`). Registrado a petición de **techlead/seguridad**.
> Ítems **dueño backend**, **severidad: no bloqueante**, estado **money-safe**. IDs `P4-D1`/`P4-D2`/`P4-D3`
> prefijados por este stream para no colisionar.

### P4-D1 · Serialización cross-path de la concurrencia multi-operador (seguridad LOW-1)
- **Dónde:** `backend/src/modules/buylist/buylist.service.ts` → `itemDecision('approve')` vs
  `itemDecision('reject')`/`maybeAutoRejectRequest`/`rejectRequest` (rutas approve y reject sobre la MISMA
  solicitud).
- **Estado actual:** cada método ya es atómico intra-método (count + update en un `$transaction`
  Serializable). Falta el boundary/locking **compartido entre rutas**: un `approve` concurrente sobre el
  ÚLTIMO ítem podría, en una ventana estrecha, dejar la solicitud `rechazada` con un ítem `aprobada` vivo.
- **Impacto:** estado money-safe — **no pagable** (paySpei exige aprobada/verificación + guard de estado),
  **no vendible** (convertToInventory exige ítem `aprobada`, no la solicitud), **no evade AML**. Solo
  incoherencia de estado observable en back-office.
- **Disparador:** antes de habilitar operación concurrente multi-operador sobre la misma solicitud.
  Mitigación futura: compartir boundary/locking entre las rutas `approve` y `reject` (p. ej. `SELECT … FOR
  UPDATE`/row-lock de la `SellRequest` o un único tx que abarque decisión de ítem + re-evaluación).

### P4-D2 · `SELL_REQUEST_TERMINAL_STATES` aún duplicado en `ine-retention` (fuente única parcial)
- **Dónde:** `backend/src/jobs/ine-retention.service.ts:28` (`private static readonly CLOSED = [...]`).
- **Estado actual:** el set `['pagada','rechazada','abandonada']` ya es fuente única en
  `buylist-reject.constants.ts` (`SELL_REQUEST_TERMINAL_STATES`), reusada por el módulo `buylist`. El job
  de retención define su propio `CLOSED` idéntico; **no** se reapuntó porque `src/jobs/` está en uso por
  otro stream en este pase (evitar regresión cross-stream). Misma política que el `buylist-sweep` 7/30 inline.
- **Impacto:** nulo funcional; solo duplicación del literal.
- **Disparador:** al tocar `src/jobs/ine-retention.service.ts` por cualquier motivo, importar
  `SELL_REQUEST_TERMINAL_STATES` y borrar el `CLOSED` local.

### P4-D3 · `getMine` filtra `closedAt` al cliente dueño vía spread (pre-existente, no de P-4)
- **Dónde:** `backend/src/modules/buylist/buylist.service.ts` → `getMine` (`const { clabeSnapshotEnc, items,
  ...rest } = req; return { ...rest, … }`).
- **Estado actual:** el spread `...rest` propaga campos internos como `closedAt` (timestamp de cierre
  interno; **no PII**) al detalle del cliente dueño. Pre-existente — **no introducido por P-4**.
- **Impacto:** menor (fuga de un timestamp interno, no PII, solo al propio dueño de la solicitud).
- **Disparador:** al endurecer la proyección de las vistas del cliente. Solución: proyectar campos
  explícitos (allow-list) como ya hace `listMine`, en vez del spread.

### Pase `precios-variantes-masterset` — hardening gate-driven (2026-08-20, no bloqueante)

> Del stream `claude/precios-variantes-masterset`. Los hallazgos bloqueantes/cerrados en este mismo pase
> (SEGURIDAD L1 override `@Min(1)`, L2 timeout+`redirect:'error'` en `PokemonTcgIoProvider.fetchFreshForCards`,
> TECHLEAD #2 match exacto de nombre en el resolver estructural) **no** figuran como deuda. Lo de abajo es la
> deuda **no bloqueante** que el techlead pidió anotar (el rol dueño del código la registra). Dueño **backend**;
> las decisiones marcadas dependen de **devops** (registrar S-D1/2/3) y **arquitecto** (materializar la columna).
> Referencia: **ARCHITECTURE §4.24a** (supuestos **S-D1/S-D2/S-D3**).

### BE-76 · `structural-finish-resolver`: supuesto S-D3 + fallback por nombre + `groupIdCache` solo en memoria
- **Dónde:** `backend/src/modules/catalog/structural-finish-resolver.service.ts` → `resolveGroupId` (~:132-186)
  y el campo `private readonly groupIdCache = new Map<string, number>()` (~:33).
- **Estado actual:** el resolver del `groupId` TCGCSV de un set descansa en tres piezas frágiles, **todas
  money-safe hoy** (ambiguo ⇒ `null` ⇒ no se toca ninguna carta):
  1. **Supuesto S-D3** (§4.24a): `CardSet.pptSetId` numérico **==** `groupId` de TCGCSV (TCGplayer group ==
     TCGCSV group). Es la ruta preferente (`/^\d+$/`); si el supuesto fuera falso, resolvería al grupo
     equivocado silenciosamente (no hay verificación cruzada de nombre en la rama numérica).
  2. **Fallback por nombre** cuando `pptSetId` no es numérico: match contra `listGroups()`, ahora **igualdad
     exacta preferida** y solo si no hay exacto, substring bidireccional **ÚNICO** (TECHLEAD #2 endureció el
     loose `includes` original). Sigue siendo heurística de string; un rename upstream lo rompe → `null`.
  3. **`groupIdCache` solo en memoria del proceso** (per-instance, **no persistido**): cada boot re-resuelve
     por nombre (o por S-D3). No se comparte entre instancias ni sobrevive a un restart; en multi-instancia
     cada dyno mantiene su propio mapa.
- **Impacto:** bajo hoy y **acotado money-safe**: el peor caso de una mala resolución sería tocar
  `structuralFinishes` del set equivocado, pero el guard de unicidad + `tcgplayerId`/`pptSetId` numérico como
  anclas preferentes lo mantienen conservador; un fallo de resolución degrada a «no se toca» (falta-una-casilla,
  nunca sobra-una-falsa). Re-resolver por nombre en cada boot es coste/latencia, no correctness.
- **Disparador / contingencia:** **si S-D3 se prueba falso** (devops registra S-D1/S-D2/S-D3 tras la 1ª corrida
  en Railway), materializar la columna **`CardSet.tcgplayerGroupId`** (§4.24a S-D3: «resolver por nombre vía
  `listGroups()` y cachear en columna, coordinar zona prisma») como fuente persistida del mapeo, sustituyendo el
  `pptSetId`-numérico y el caché en memoria. **Owners:** **devops** registra S-D1/2/3 tras la primera corrida
  Railway; el **arquitecto** decide si/ cuándo materializar `tcgplayerGroupId` (toca `schema.prisma` → zona
  compartida). Mitigación intermedia: verificar el nombre del grupo también en la rama numérica S-D3.

### BE-77 · `sync-all` y `refresh-variants-all` NO son mutuamente exclusivos server-side (Baja) — `fix/variant-composition-regression` (M-35)
- **Dónde:** `backend/src/modules/catalog/catalog-sync.service.ts` → `syncAllStatus.running` y
  `refreshVariantsAllStatus.running` son flags **separados**; cada barrido solo se serializa contra **sí
  mismo** (single-flight per-tipo). El `FinishReconciler.reconcile` es el punto común: `sync-all` lo llama
  al (re)importar cartas y `refresh-variants-all` lo llama al reconciliar `availableFinishes` desde
  `CardProduct`.
- **Estado actual:** hoy los DOS barridos **no** se pueden solapar en la práctica porque **el frontend los
  serializa** (M2 no deja disparar uno con el otro corriendo). Server-side, en cambio, un cliente que pegue
  directo a la API puede lanzar `sync-all` y `refresh-variants-all` a la vez: ambos pasan sus respectivos
  single-flight (flags distintos) y pueden reconciliar **las mismas cartas** concurrentemente → contención /
  last-write-wins en `FinishReconciler` (familia de BE-68, race read-compute-write). Idempotente: no corrompe
  dinero ni duplica registros; el peor caso es un `availableFinishes` transitoriamente pisado que la siguiente
  corrida corrige.
- **Impacto:** bajo hoy (la serialización del front lo neutraliza en el flujo normal); latente si se opera por
  API directa o en multi-instancia.
- **Disparador:** **multi-instancia, disparo por API fuera del front, o al cablear BullMQ.** Dirección: un
  **flag/lock compartido** entre ambos barridos (o serializar los dos contra un mismo mutex/Redis `SET NX`),
  de modo que sean mutuamente exclusivos también server-side. Familia DEV-1/BE-11/BE-21/BE-68.

### BE-78 · Tres copias del patrón "sweep en memoria + single-flight + fire-and-forget" (Media, refactor)
- **Dónde:** `backend/src/modules/catalog/catalog-sync.service.ts` (`sync-all` → `syncAllStatus`/`runSyncAll`
  y `refresh-variants-all` → `refreshVariantsAllStatus`/`runRefreshVariantsAll`) y el barrido masivo de
  precios (`price-sync`, `PriceSyncStatusResponse`).
- **Estado actual:** el MISMO patrón está **copiado tres veces**: un objeto de estado en memoria
  `{running,jobId,total,done,startedAt,finishedAt(,summary)}`, un guard `if (running) return` como
  single-flight, un lanzamiento `void run().finally(() => { running=false; finishedAt=... })` fire-and-forget,
  y un getter que devuelve una copia del estado para polling. Cada copia arrastra por separado las mismas
  deudas (BE-11 restart silencioso, BE-12 cierre por referencia, BE-21 single-flight per-proceso). Divergen
  en detalles menores (p. ej. `refresh-variants-all` añade `summary` nullable; `price-sync` añade presupuesto
  del proveedor), lo que multiplica la superficie de bugs sutiles al tocar uno y no los otros.
- **Impacto:** medio de mantenibilidad (no de correctness): un fix o endurecimiento (persistencia, lock
  compartido, jobId-check en el `finally`) hay que aplicarlo 3 veces y es fácil olvidar una.
- **Disparador / dirección:** **al cablear BullMQ (DEV-1/BE-11).** Extraer un helper reutilizable
  `InMemorySweep` (estado + single-flight + fire-and-forget + getter de status) parametrizado por el trabajo
  por-ítem y el acumulador de `summary`, y hacer que los tres barridos lo consuman. Pagar **junto con
  DEV-1/BE-11** cuando se persista el progreso en la cola (el refactor y la migración a BullMQ tocan el mismo
  código).

### Stream A v1.27 (P-13/P-15/P-12) — deuda del veredicto techlead del gate (2026-08-21, no bloqueante)

> Deuda anotada del veredicto del **techlead** sobre el gate del Stream A (rama
> `claude/backend-e2e-payment-fixtures-77mo4t`, P-13 variantes fantasma + P-15 mercado por variante +
> P-12 force en sync por set). Los DOS ítems MAYORES del rechazo (seeds con estado imposible
> post-v1.27 en `seed.ts`/`e2e-fixtures.ts`/`seed-e2e.ts`, y comentarios normativos derogados en
> `catalog-sync.service.ts`) **se corrigieron en esta misma rama** y NO figuran como deuda. Lo de
> abajo es la deuda NO bloqueante que el techlead pidió registrar. Dueño **backend** salvo donde se
> anota (arquitecto). IDs `SA-D*` con la numeración del veredicto del techlead (prefijo `SA-` para no
> colisionar con la D1–D5 del pase v1.1 ni la D-1/D-2 de `pulido-precios-display`).

### SA-D2 · `getReferencesBatch` carga TODO el histórico de `PriceReference` y deduplica en memoria (Alta)
- **Dónde:** `src/modules/pricing/pricing.service.ts:192-224` (`getReferencesBatch`).
- **Estado actual:** el `findMany` NO acota `capturedDate`: trae TODAS las filas históricas que
  matcheen las dimensiones (`orderBy capturedDate desc`) y se queda con la PRIMERA vista por clave
  **en memoria** (descarta el resto). **P-15 multiplicó el lote** a carta×acabado (binder Master Set:
  un set completo por request, sin cap de 50). Con la ingesta acumulando ~11-15M filas/año
  (**BE-20**), a un año de operación un set de 300 cartas × ~2 acabados × ~365 capturas ⇒ **~200k
  filas transferidas y descartadas POR REQUEST de binder**.
- **Impacto:** alto a futuro: latencia y presión de BD/red en la ruta caliente del binder (y demás
  consumidores del batch), empeorando linealmente con el histórico. Correctness OK (la dedup elige
  bien la más reciente).
- **Disparador:** **antes de que `PriceReference` acumule meses de histórico a escala** — mismo reloj
  que **BE-20** (poda/retención); pagar junto con **BE-35** (forma cartesiana del `WHERE`, cuyo
  disparador se actualizó para apuntar aquí). Dirección: acotar el `findMany` con
  `capturedDate >= hoy − N días` (la referencia vigente es reciente por construcción de la ingesta
  2×/día) **o** `DISTINCT ON (cardId, productType, gradeKey, finish) … ORDER BY capturedDate DESC`
  vía SQL, devolviendo UNA fila por clave desde la BD.

### SA-D1 · `Card.catalogFinishes` es write-only desde v1.26 (Media — decisión de retiro: arquitecto)
- **Dónde:** columna `Card.catalogFinishes` (`prisma/schema.prisma`); único escritor
  `catalog-sync.service.ts` → `upsertCards`; **ningún lector en producción**.
- **Estado actual:** desde v1.26 el reconciliador compone `availableFinishes` SOLO de
  `structuralFinishes` (resolver TCGCSV); `catalogFinishes` se sigue escribiendo (señal débil
  derivada del payload de pokemontcg.io) pero nadie la lee en código de producción — quedó como
  observabilidad/registro. El docblock de `upsertCards` ya lo dice explícitamente (corregido en este
  mismo pase: antes aún la titulaba «AUTORIDAD»).
- **Impacto:** medio-bajo (mantenibilidad/confusión): una columna con nombre de autoridad que ya no
  manda invita a re-conectarla por error en un refactor futuro.
- **Disparador:** próxima revisión de schema. **La decisión de retirarla (drop de columna) pasa por
  el arquitecto** (`prisma/schema.prisma` es zona compartida); aquí solo se registra la deuda.

### SA-D3 · Escrituras secuenciales por carta bajo request síncrono (Media)
- **Dónde:** `src/modules/catalog/finish-reconciler.service.ts:65` (`card.update` en bucle),
  `src/modules/pricing/price-ingest.service.ts:370` (`persistMarketReference` por fila) y `:411`
  (`card.update` del snapshot por carta).
- **Estado actual:** los tres caminos escriben UNA fila por round-trip a Postgres, en serie. **P-12
  lo pone detrás de un botón de M2** (`POST /admin/catalog/sync {setId, force:true}`): resolver
  estructural + reconcile de un set de ~300 cartas ⇒ **~300 round-trips dentro del request HTTP**; y
  el `202 {jobId}` de ese sync sigue siendo síncrono en realidad (D1 del pase v1.1: no hay cola
  detrás del jobId).
- **Impacto:** medio: latencia del request admin, con riesgo de timeout en sets grandes o instancias
  lejos de la BD. Correctness OK (upserts/updates idempotentes; re-lanzar repara).
- **Disparador:** timeouts reales del botón de M2, o al cablear BullMQ para catálogo (familia
  D1/BE-11/BE-21). Dirección: batchear las escrituras (`updateMany` agrupado por valor recomputado,
  `$transaction` por lotes, `createMany` para referencias) y/o mover el trabajo a un job real con
  `jobId` consultable.

### SA-D5 · Gate estructural `firstImport || force` duplicado en las dos rutas de import (Baja)
- **Dónde:** `src/modules/catalog/catalog-sync.service.ts:305-312` (`importSet`) vs `:334-342`
  (`importSetByExternalId`).
- **Estado actual:** el cálculo de `firstImport` (resolver cableado + count de cartas del set == 0) y
  el gate `firstImport || force` están copiados en ambas rutas (P-12 los dejó en paridad a propósito,
  pero por duplicación literal).
- **Impacto:** bajo (mantenibilidad): un matiz futuro al gate hay que aplicarlo dos veces o las rutas
  divergen en silencio — justo la asimetría que P-12 vino a cerrar.
- **Disparador:** próximo toque a `catalog-sync`. Dirección: extraer un helper privado (p. ej.
  `shouldRunStructuralResolver(localSetId, force)`) consumido por ambas rutas.

### SA-D6 · `force` solo-body en `sync` vs body-o-query (`parseForce`) en `sync-all`/`backfill` (Baja)
- **Dónde:** `src/modules/catalog/admin-catalog.controller.ts` — `POST /admin/catalog/sync` lee
  `force` SOLO del body (`SyncDto`, `dto.force ?? false`), mientras `sync-all` y `backfill` aceptan
  body O query vía el helper `parseForce(bodyForce, queryForce)`.
- **Estado actual:** dos convenciones de entrada para el MISMO flag en el MISMO controller.
- **Impacto:** bajo (consistencia/DX de operación): un operador que use `?force=true` en `sync` verá
  el flag ignorado en silencio (y el audit registrará `force:false`).
- **Disparador:** próximo toque al controller de catálogo (si cambia la superficie del contrato §M2,
  pasa por el arquitecto). Dirección: unificar a UNA convención (body tipado en las tres rutas, o
  `parseForce` en las tres).

### SA-D4 · `MasterSetVariantDTO.capturedDate` se emite y nadie lo consume (Baja, dueño frontend)
- **Dónde:** cadena completa del campo: backend lo puebla
  (`backend/src/modules/inventory/master-set.service.ts:493-495`, solo cuando hay precio), el mock lo
  genera (`frontend/src/lib/mock/fixtures.ts:1069`), `frontend/src/types/contract.ts:827` lo tipa
  («decoración de frescura; el front tolera su ausencia») — y **ningún componente lo pinta**:
  `MasterSetBinder.tsx` solo lee `marketReferenceMxnCents`.
- **Estado actual:** campo del contrato v1.27 (P-15) transportado de punta a punta pero **write-only
  en la UI**. El patrón para renderizarlo ya existe: `frontend/src/components/ui/PriceTag.tsx:49`
  fecha la referencia en modo `reference` con `formatDate(reference.capturedDate, locale)`.
- **Impacto:** bajo (UX/mantenibilidad): el usuario del binder no ve la frescura del precio de cada
  variante pese a que el dato viaja; un campo transportado-y-nunca-leído invita a retirarlo por error
  en un refactor de contrato («nadie lo usa») cuando la intención era consumirlo.
- **Disparador:** próximo toque al binder Master Set. Dirección: renderizar `capturedDate` como
  frescura del precio en la variante (reutilizando el patrón de `PriceTag.tsx:49`) **o** anotar
  explícitamente en `contract.ts`/`MasterSetBinder.tsx` que el campo queda reservado para la ficha de
  detalle (documentar la no-lectura intencional).

### SA-D7 · M2: `onSuccess` de ingest duplicado y `fullSyncPhase` como estado paralelo (Baja, dueño frontend)
- **Dónde:** `frontend/src/app/[locale]/(admin)/admin/m2/M2View.tsx` — `onSuccess` de
  `fullSyncMutation` (~:582-588) vs `onSuccess` de `ingestMutation` (~:323-327); y el `useState`
  `fullSyncPhase` (~:569).
- **Estado actual:** (a) los dos `onSuccess` duplican literalmente la misma secuencia
  (`invalidateQueries(['pending-prices'])` + `setJustDispatched(true)` + `priceSyncStatus.refetch()`);
  el patrón correcto ya existe extraído para el otro flujo (`onSweepLaunched` ~:543-546) — falta el
  análogo `onIngestLaunched`. (b) `fullSyncPhase` es un `useState` **paralelo** al estado de la
  mutación (dos fuentes de verdad sobre el mismo ciclo de vida); en error NO se limpia a propósito
  (el banner reporta en qué fase falló), pero queda **pegado** hasta el siguiente disparo.
- **Impacto:** bajo (mantenibilidad): un cambio futuro a la mecánica post-ingest (p. ej. invalidar
  otra query) hay que aplicarlo en dos sitios o los flujos divergen en silencio — misma clase que
  SA-D5; el estado paralelo complica razonar sobre el banner tras un error.
- **Disparador:** próximo toque a M2View. Dirección: extraer `onIngestLaunched` consumido por ambas
  mutaciones (espejo de `onSweepLaunched`), y derivar la fase del propio estado de la mutación
  (`variables`/`error`) o resetear `fullSyncPhase` en un punto único del ciclo (p. ej. en `onMutate`),
  dejando UNA fuente de verdad.

### Stream B v1.28 (P-17..P-25) — deuda del veredicto techlead del gate (2026-08-21, no bloqueante)

> Deuda anotada del veredicto del **techlead** sobre el gate del Stream B (rama
> `claude/backend-e2e-payment-fixtures-77mo4t`, v1.28: M1 reorganizado P-17, consola de tres precios
> P-18, alta rápida P-19, publicar-todo, Top Bounties P-22, sellado/gradeadas P-25/P-20). El ítem
> BLOQUEANTE del rechazo acotado (B-1/IMPORTANTE-1: `countBountyAcquisitionsTx` contaba piezas
> `rechazada` hacia `bountyAcquiredQty` — cherry-pick inflaba el contador, podía auto-apagar el
> bounty antes de tiempo y auditar `bounty.completed` en falso) **se corrigió en esta misma rama**
> (mismo filtro que la invariante BL-1, con test del caso cherry-pick) y NO figura como deuda. Lo de
> abajo es la deuda NO bloqueante que el techlead pidió registrar. Dueño **backend** salvo donde se
> anota (arquitecto). IDs `SB-D*` con la numeración del veredicto (mismo formato que `SA-D*`;
> SB-D7/SB-D8 son de frontend y las registra su dueño en su propio pase).

### SB-D1 · `publish-all` síncrono sin cota; `InventoryBatch` se persiste al final (Media)
- **Dónde:** `backend/src/modules/inventory/inventory.service.ts:811` (`publishAll`) y el registro del
  `InventoryBatch` al cierre del método; endpoint `POST /admin/inventory/publish-all`
  (`inventory.controller.ts:160`).
- **Estado actual:** la publicación masiva corre **dentro del request HTTP** sin cota de selección
  (§4.26c: chunks server-side, pero el total puede ser todo el inventario) y el `InventoryBatch` que
  registra el resultado se persiste **al final** del recorrido. Si el request agota el timeout, el
  trabajo por-pieza ya commiteado es **piece-safe** (re-lanzar re-procesa idempotente), pero el diálogo
  del operador queda colgado y un re-lanzamiento **re-recorre TODO** desde cero.
- **Impacto:** medio: latencia/timeout del botón de M1 con inventarios grandes; sin corrupción de
  datos (idempotente por pieza), solo UX de operación y re-trabajo.
- **Disparador:** timeouts reales del publicar-todo, o al cablear BullMQ para estos barridos (misma
  familia que **D1/BE-11/SA-D3**). Dirección: mover a job con `jobId` consultable (progreso
  persistido) o, como mínimo, cap por set/filtro con paginación de reanudación.

### SB-D2 · Lecturas paralelas de config de reglas de compra/venta (`buylistRules()` / `loadBuylistRules()` / `loadSalesRules()`) — guard de parseo casi-duplicado (Baja) — **PROMOVIDA por H6/P-34 (2026-08-22): tercer read + disparador cumplido**
- **Dónde:** `backend/src/modules/buylist/buylist.service.ts` (`buylistRules()`) vs
  `backend/src/modules/pricing/pricing.service.ts` (`loadBuylistRules()` **y** `loadSalesRules()`).
- **Estado actual:** originalmente dos lecturas **paralelas** de la MISMA config (`BUYLIST_PRICE_RULES` +
  `BUYLIST_PRICE_FALLBACK_PCT`), con cuerpo idéntico. La no-delegación es **decisión justificada**
  (no acoplar `buylist`→`pricing` por un read de settings); el cuerpo normativo de la semántica de
  precio es la matemática compartida en `common/money.ts`. El docblock de `loadBuylistRules` que
  afirmaba (en falso) que `buylistRules()` delegaba ahí **ya se corrigió** en un pase anterior.
- **Actualización 2026-08-22 (H6, cluster P-34, pricing por tiers):** con la migración a tiers hay ya
  **TRES** lecturas de `PRICING_TIER_MAP` por separado —`buylist.service.buylistRules()`,
  `pricing.service.loadBuylistRules()` y `pricing.service.loadSalesRules()`— cada una con un **guard
  de parseo casi-duplicado** del tier map. El **disparador de SB-D2** («próximo toque a cualquiera de
  los dos specs de reglas de compra») **ya se cumplió** con el toque de tiers. Esta entrada absorbe H6
  (no se crea entrada separada); dueño **backend**.
- **Impacto:** bajo (mantenibilidad): si cambia el formato del dial/tier hay que tocar tres lectores —
  hoy los tres leen las mismas `SettingKey`, así que cambian juntos por construcción. **No hay
  divergencia hoy**, solo superficie de riesgo acumulada.
- **Disparador:** cumplido (toque de tiers). Dirección: **unificar en un loader único compartido** del
  `PRICING_TIER_MAP` (helper con el guard de parseo una sola vez) que consuman los tres call-sites,
  en vez de tres guards casi-duplicados. No bloquea (sin divergencia de comportamiento).

### SB-D3 · Clave de variante `${cardId}|${productType}|${gradeKey}|${finish}` construida a mano en ≥6 sitios (Baja)
- **Dónde:** `pricing.service.ts:192,280,308`, `buylist.service.ts:170,397,1374`,
  `catalog.service.ts:150,164`, `admin.service.ts:317,334,612`, `master-set.service.ts:637,645`,
  `inventory.service.ts:744`, `admin-vaults.service.ts:121` (todos en `backend/src/modules/`).
- **Estado actual:** la clave compuesta de la variante M-30 (y de los maps de `PriceReference` batch)
  se interpola a mano con el mismo template literal en ≥6 módulos. Un typo/reordenación en un solo
  sitio produce un **miss silencioso** del map (fila no encontrada ⇒ sin override/sin referencia).
- **Impacto:** bajo hoy (los sitios son idénticos y con tests); riesgo latente de divergencia
  silenciosa en refactors.
- **Disparador:** próximo toque a M-30 (`VariantPriceOverride`). Dirección: exportar un
  `variantKey({cardId, productType, gradeKey, finish})` único (p. ej. junto a los tipos de pricing) y
  reapuntar los call-sites.

### SB-D4 · `resolveSealedAportacionMarket` consulta hermanos+spreads+referencia POR LÍNEA del lote (Media)
- **Dónde:** `backend/src/modules/inventory/inventory.service.ts:262` (call-site en el alta por lote)
  → `:307` (`resolveSealedAportacionMarket`).
- **Estado actual:** en el alta de aportación con líneas selladas, CADA línea dispara su propia ronda
  de queries (hermanos mapeados con `tcgplayerProductId`, spreads de presentación, referencia de
  mercado) — rompe la doctrina **BE-25** de izar la config/lecturas UNA vez por request.
- **Impacto:** medio: N+1 sobre la ruta de captura admin al crecer los lotes con sellado; correctness
  OK.
- **Disparador:** lotes grandes de sellado o próximo toque al alta. Dirección: izar hermanos + spreads
  + referencias al **inicio del lote** (batch por `cardId IN (...)` + map en memoria), mismo patrón
  que `getReferencesBatch`.

### SB-D5 · Inferencia de `tcgplayerProductId` por hermanos = parche a hueco de modelo (RESUELTA v1.39/M-39 + display cliente H-P38-1, P-38)
- **Estado:** **RESUELTA DE PUNTA A PUNTA** — modelo + alta (v1.39/M-39) **y display de cliente cableado en
  H-P38-1**. La cura de raíz (entidad `SealedProduct`, snapshot M-37) llegó al modelo/alta en M-39, pero el
  techlead detectó en P-38 (**H-P38-1**) que las **superficies de cliente** seguían pintando el single ancla
  («Tropius») en vez de la identidad real del `SealedProduct`. **H-P38-1 (backend, RESUELTA):** se cableó la
  cascada de display de §4.34a (`SealedProduct` vivo → snapshot congelado `sealedProductName`/`sealedImageUrl`
  de M-37 → `Card` ancla) en los **dos DTO-builders de cliente**: `catalog/sealed-catalog.service.ts`
  (`toGroupDTO`, grid + ficha de Compra) y `vault/vault.service.ts` (`sealedTab`, grid de bóveda sellada).
  Ambos usan `sealedProductName ?? card.name` e `sealedImageUrl ?? card.imageSmallUrl` (snapshot congelado,
  estable y money-safe: solo display, no toca precios ni valuación). Tests: `test/sealed-catalog.spec.ts` y
  `test/vault-sealed.spec.ts` («H-P38-1: el display usa la IDENTIDAD del SealedProduct, NO el single ancla»).
  El guardarraíl H9 (singles excluyen sellado) y el agrupado por producto+condición quedan intactos.
- **✅ RESUELTA (CURA DE RAÍZ) — v1.39-sealed-product-module (M-39, P-38, ARCHITECTURE §4.34):** se
  materializó la entidad de catálogo **`SealedProduct`** (identidad propia por presentación sellada de un
  set, llaveada por `tcgplayerProductId @unique`) + la tabla de enlace **`SealedSetGroup`** (1 set → N
  grupos TCGCSV) + `InventoryItem.sealedProductId` (FK `onDelete: SetNull`). El alta pasa a **seleccionar**
  un `SealedProduct` (`BatchInventoryItemInput.sealedProductId`): el backend DERIVA server-side la identidad
  (ancla del set + mapeo + imagen/nombre/subtipo) → la pieza nace **«ETB …», NO anclada a Tropius**. Un
  **sync** (`POST /admin/inventory/sealed-products/sync`) descarga las presentaciones desde TCGCSV y de paso
  **puebla `CardSet.tcgcsvGroupId` + `SealedSetGroup`** por name-match SIN requerir un item previo — **rompe
  el círculo vicioso** del hueco 1. El **backfill M-39** (`prisma/backfill-m39-sealed-product.ts`) deriva
  `SealedProduct` de los items sellados YA MAPEADOS y liga su `sealedProductId` (**cura el ETB→Tropius
  actual**); los SIN MAPEO quedan `null` + reporte de reconciliación (cero adivinación). La inferencia por
  hermanos **sigue viva SOLO** como camino legacy/transición (sellado sin `sealedProductId`); ya no es la
  fuente de verdad de la identidad. Ver `backend/src/modules/inventory/sealed-product.service.ts`,
  `sealed-subtype.ts`, migración `20260823120000_m39_sealed_product`, tests
  `backend/test/sealed-product.service.spec.ts` + `inventory.sealed-product-alta.spec.ts`.
- **H9 (ancla-a-single en la ficha del single):** la cura de raíz elimina el ancla-a-single como
  IDENTIDAD (ahora `sealedProductId`), pero la `cardId` ancla se **mantiene** (NOT NULL sigue) como
  pertenencia al set + fallback de imagen; el guardarraíl `productType != 'sealed'` de la vista de singles
  **sigue vigente** (H9 permanece MITIGADA — su retiro/reubicación es decisión del arquitecto).
- **Contexto histórico (antes de M-39):**
- **Dónde:** `backend/src/modules/inventory/inventory.service.ts:298-322` (inferencia del productId
  del GRUPO desde piezas hermanas ya mapeadas).
- **Estado actual:** no existe una **entidad de producto sellado** en el modelo; el
  `tcgplayerProductId` de una nueva pieza sellada se **infiere** de sus hermanos (`distinct` de piezas
  ya mapeadas de la misma agrupación). Si no hay hermanos mapeados o hay más de un candidato, la
  inferencia degrada (sin productId ⇒ sin mercado). Es un parche funcional a un hueco de modelado.
- **Impacto:** medio (mantenibilidad + calidad de datos): la fuente de verdad del mapeo vive
  implícita en las piezas, no en el catálogo.
- **Disparador:** próximo toque al modelo de sellado. **Decisión del arquitecto:** `productId`
  explícito en el DTO del alta vs **entidad de producto sellado** en `schema.prisma` (zona
  compartida, regla 9).
- **Actualización 2026-08-22 (v1.36 P-35, M-37):** el arquitecto eligió — para P-35 — el **`productId`
  explícito en el DTO del alta** (la pieza NACE MAPEADA: `BatchInventoryItemInput.tcgplayerProductId`+
  `tcgplayerGroupId`), como **puente mínimo** money-safe. Efecto: cuando el alta trae el mapeo, la
  valuación de aportación de sellado ya **NO** depende de la inferencia por hermanos (usa el productId
  directo, `inventory.service.ts` `resolveSealedAportacionMarket(bornMappedProductId)`); la inferencia
  por hermanos **sigue viva** solo para altas de sellado SIN mapeo (compatibilidad). La **entidad
  `SealedProduct` de catálogo** (cura de raíz del ancla-a-single) queda **DIFERIDA** explícitamente
  (ARCHITECTURE §4.32d): NO se hizo en este cambio. SB-D5 **permanece abierta** (Media).

### H-P38-2 · Override manual escribe `PriceReference`/audit fuera de la transacción del batch (money) (backend) — ✅ RESUELTA (fix de seguridad H-1)
- **Dueño:** backend. **Severidad:** original Media; **REESCALADA a ALTO** por la fase de seguridad (P-38,
  money-critical). **Estado:** ✅ **RESUELTA** — fix de seguridad **H-1** (atomicidad total del override).
- **Síntoma (original):** dentro del `$transaction` del batch de alta, el override manual escribía
  `PriceReference isManualOverride=true` (referencia global autoritativa, `sourceRank=0`,
  `sealed:tcg:<productId>`) y su `AuditLog` con `this.prisma` (cliente NO transaccional). Consecuencia: el
  override **auto-commiteaba** y **sobrevivía** aunque la línea fallara (`ok:false`) o el `$transaction`
  hiciera rollback → **precio de dinero pinneado huérfano** (envenenamiento de precio global).
- **Fix aplicado (H-1):** la escritura del override se **DIFIERE**. `resolveSealedMarketForAlta` ya no escribe:
  VALIDA y devuelve un descriptor (`SealedManualOverride`). El caller (`createItem` / `batchCreate` por-línea)
  aplica el override con `applySealedManualOverride(...)` **DENTRO de la misma `tx`** y **SOLO tras crear la
  pieza**. `pricing.manualOverride(...)` y `audit.log(...)` aceptan ahora un `tx?: Prisma.TransactionClient`
  opcional y lo usan cuando se les pasa. En el alta **single** se envolvió `alta + override` en un
  `$transaction` propio (antes no tenía). Atomicidad total: sin override sin pieza, ni pieza sin su override;
  un rollback o una línea fallida **revierten también el override** → jamás queda un `PriceReference
  isManualOverride` huérfano. Money-safe intacto: sin precio → PRICE_PENDING (nunca 0), el override solo llena
  hueco `null`, `>0`, auditado.
- **Dónde:** `backend/src/modules/inventory/inventory.service.ts` (`resolveCreation`,
  `resolveSealedMarketForAlta`, `applySealedManualOverride`, `createItem`, `batchCreate`);
  `backend/src/modules/pricing/pricing.service.ts` (`manualOverride` con `tx`);
  `backend/src/modules/audit/audit.service.ts` (`log` con `tx`).
- **Tests:** `test/inventory.sealed-product-alta.spec.ts` (describe **H-1** — override participa del cliente
  tx del alta single/lote; fallo de creación de pieza ⇒ sin override huérfano ni audit).

### H-P38-3 · `subtype` sin match cae a `'collection'` en vez de `→ null` (spec) (arquitecto + backend)
- **Dueño:** **arquitecto** (decisión de spec) + backend (implementación). **Severidad:** Media. **Estado:** ABIERTA.
- **Síntoma:** al derivar el `sealedSubtype` desde TCGCSV, un subtype **sin match** resuelve a `'collection'`
  cuando la spec dice **`→ null`**. Divergencia código↔contrato; puede etiquetar mal presentaciones no
  reconocidas. Ruta: lógica de mapeo de subtype (`sealed-subtype.ts` / `sealed-product.service.ts`).
- **Disparador:** el arquitecto confirma el valor canónico (`null` vs `'collection'`) en el contrato; backend
  ajusta el default del mapeo.

### H-P38-4 · Check-then-create no atómico en `upsertSealedProduct`/`ensureSetGroup`/`linkGroup` (backend) — RESUELTO (2026-08-23)
- **Dueño:** backend. **Severidad:** Media (concurrencia). **Estado:** **RESUELTO**.
- **Síntoma:** los helpers `upsertSealedProduct`, `ensureSetGroup` y `linkGroup` hacían **check-then-create**
  (findUnique seguido de create) sin atomicidad → bajo concurrencia (dos syncs/altas simultáneos)
  podían intentar crear el mismo registro y romper por unique, o duplicar el enlace. Ruta:
  `backend/src/modules/inventory/sealed-product.service.ts`.
- **Fix (2026-08-23):** patrón `create(...).catch(P2002 → converger)` (helper `isUniqueViolation`,
  `Prisma.PrismaClientKnownRequestError.code === 'P2002'`). (1) `upsertSealedProduct`: si el `create` pierde
  la carrera, relee por `tcgplayerProductId` y aplica el `update` (closure `applyUpdate`) **preservando la
  semántica**: NO pisa un subtype curado por humano (`subtypeInferred=false`), refresca market/name/etc.,
  money-safe (sin precio ⇒ `marketUsdCents` null, jamás 0). (2) `ensureSetGroup`: P2002 ⇒ devuelve `false`
  (NO doble-cuenta `groupsPopulated`) y converge el label. (3) `linkGroup`: mantiene el pre-check `dup` (409
  normal) y traduce el P2002 de la carrera al **mismo 409 CONFLICT** (semántica de enlace duplicado
  preservada); el soft-delete acotado y el poblado de `CardSet.tcgcsvGroupId` quedan intactos. Un error
  NO-P2002 se propaga (no se traga). Tests: `backend/test/sealed-product.service.spec.ts` (describe
  «concurrencia atómica (H-P38-4)»: converge-sin-pisar-curado, error no-P2002 propaga, ensureSetGroup no
  doble-cuenta, linkGroup carrera → 409).

### H-P38-5 · Frontend manda `cardId = SealedProduct.id` como relleno (frontend) — **RESUELTA (2026-08-23)**
- **Dueño:** **frontend**. **Severidad:** Media. **Estado:** **RESUELTA**.
- **Síntoma:** el cliente de captura enviaba `cardId` poblado con el `SealedProduct.id` como valor de relleno
  (placeholder) cuando debía dejar que el backend derive la `cardId` ancla desde `sealedProductId`. Riesgo de
  confundir identidades en el alta.
- **Fix (2026-08-23):** `SealedAddFlow.tsx` ya **no** pasa `cardId` en el `target` del alta de sellado (se omite,
  antes `cardId: selected.id`). `QuickAddTarget.cardId` pasó a **opcional** (`cardId?: string`, ya opcional en
  `BatchInventoryItemInput` del contrato v1.39). El mutation de `QuickAdd` ya omitía cardId bajo identidad sellada
  (`usesSealedIdentity ? {} : { cardId }`), así que el alta funciona idéntica; ahora la identidad es inequívoca
  (el backend deriva la Card ancla desde `sealedProductId`). Sin cambio de contrato.

### H-P38-6 · Nota de migración `ADD VALUE` (enum) para el runbook de devops (devops)
- **Dueño:** **devops**. **Severidad:** Baja (operacional). **Estado:** ABIERTA (nota de runbook).
- **Síntoma/nota:** la migración de sellado usa `ALTER TYPE … ADD VALUE` (nuevo valor de enum). `ADD VALUE`
  **no corre dentro de un bloque transaccional** en Postgres y el nuevo valor no es usable en la misma
  transacción que lo agrega → documentar en el runbook de deploy (orden de migración + verificación) para
  evitar fallos de despliegue/rollback. Fix: nota en `docs/DEVOPS_NOTES.md` (runbook de migración de enums).

### H9 · Ancla-a-single (P-35) expone sellado en la ficha del single — MITIGADA por guardarraíl `productType` (ligada a SB-D5) (backend + arquitecto)
- **Dueño:** backend (guardarraíl) + **arquitecto** (ubicación final del filtro). **Severidad:** Media.
  **Estado:** **MITIGADA** (guardarraíl interino landeado); **cura de raíz pendiente en SB-D5**.
- **Síntoma concreto (hallazgo techlead H9, cluster P-35):** P-35 ancla TODO el sellado de un set a la
  carta single de menor `(numberPrefix, numberSort)` (misma `cardId`), y determinista. Las consultas de
  SINGLES del storefront (`CatalogService.getCard` ficha y `listCards` listado) hacían
  `fetchSellable(publishedWhere(...))` **sin filtro de `productType`**, así que la ficha pública
  `GET /catalog/cards/:anchorCardId` **mezclaba cajas selladas** entre los "ejemplares" del single; y
  como el front toma `listings[0]` (orden `createdAt desc`) como `primary`, una **caja recién dada de
  alta** podía **renderizar la ficha del single como si fuera sellado**. No es money-unsafe (no toca
  precios ni valuación), pero es una **incorrección visible en tienda** que P-35 volvió determinista.
- **Guardarraíl INTERINO (landeado):** `CatalogService.singlesPublishedWhere(...)` añade
  `AND: [{ productType: { not: 'sealed' } }]` a la vista pública de singles (`getCard`, `listCards`).
  Solo raw/graded cuentan como ejemplares de un single; el sellado ya tiene su propio catálogo público
  `GET /catalog/sealed` (`SealedCatalogService`, `productType='sealed'`). Se aplica como cláusula `AND`
  aparte para **no pisar** un filtro `productType` explícito del where. Money-safe: solo ACOTA la
  lectura. Ruta: `backend/src/modules/catalog/catalog.service.ts`. Tests:
  `backend/test/catalog.spec.ts` («H9 / SB-D5 — la vista de SINGLES excluye el sellado»: `listCards` y
  `getCard` no exponen el `sealed`, y el MISMO `sealed` SÍ aparece en `GET /catalog/sealed`).
- **Discrepancia con el contrato (para el arquitecto):** `docs/API_CONTRACT.md` §2 aún declara
  `productType: raw | graded | sealed` como filtro válido de `GET /catalog/cards` (línea ~1817) y
  `GET /catalog/facets` sigue exponiendo `"sealed"` en `productTypes`/`sealedSubtypes` (línea ~1834).
  El guardarraíl **no tocó `facets`** (el contrato manda: no se altera `API_CONTRACT.md`), por lo que
  `GET /catalog/cards?productType=sealed` ahora devuelve **vacío** aunque facets lo anuncie. La
  **ubicación/forma final del filtro** (¿retirar sellado de facets del singles? ¿ruta separada?) es
  **decisión del arquitecto** (regla 9), junto con la cura de raíz.
- **Cura de raíz — pendiente en SB-D5:** la entidad de catálogo **`SealedProduct`** propia (que elimina
  el ancla-a-single y da al sellado su identidad de producto) sigue **DIFERIDA** en **SB-D5**. Al
  materializarla, este guardarraíl `productType` se vuelve innecesario (o se re-ubica según el arquitecto).
- **Disparador:** al abordar SB-D5 (entidad `SealedProduct`) o al reconciliar el contrato de
  `/catalog/cards`/`/catalog/facets` respecto del sellado.

### SB-D6 · `VariantControlsService.update`: read-modify-write + delete/upsert fuera de transacción (Baja)
- **Dónde:** `backend/src/modules/pricing/variant-controls.service.ts:115-157` (`update`: `findUnique`
  de la fila vigente → merge en memoria → `delete`/`upsert`, sin `$transaction`).
- **Estado actual:** dos `PUT` concurrentes sobre la MISMA variante pueden leer la misma fila vigente
  y pisarse el merge (last-writer-wins de campos que el otro no tocó), o carrera delete-vs-upsert.
  Solo panel admin (M2), operación en serie en la práctica; misma familia TOCTOU que BE-2/BE-22.
- **Impacto:** bajo: requiere dos admins editando la misma variante a la vez; el peor caso es un
  override pisado (recuperable re-aplicando; auditado con before/after).
- **Disparador:** próximo toque a variant-controls o al habilitar multi-operador concurrente.
  Dirección: envolver lectura+merge+persistencia en un `$transaction` (o `updateMany` con guardias).

### SB-D7 · Recorte de identidad de grupo de sellado en cliente; falta filtro de identidad en el contrato (Media, frontend + arquitecto)
- **Dónde:** `frontend/src/app/[locale]/(admin)/admin/m1/SealedTab.tsx:192-226` (publicar-grupo pagina
  server-side hasta agotar la carta) y
  `frontend/src/app/[locale]/(admin)/admin/m1/VariantDrawer.tsx:118,342,409-413` (lista de piezas del
  drawer, capeada a `pageSize` máx 100 del contrato); consumidor de `GET /admin/inventory/items`.
- **Estado actual:** el contrato no ofrece filtros de **identidad de grupo** de sellado
  (`sealedSubtype`/`sealedCondition`/`gradingCompany`/`gradeValue`) en `GET /admin/inventory/items`, así
  que el cliente trae páginas por carta y **recorta la identidad en memoria**. **Mitigado** en la ronda
  de corrección del gate (2026-08-21): el mutation de «Publicar grupo» **pagina hasta agotar** la carta
  (ya no trunca a 100) y la lista de piezas del drawer **declara el truncado** con el conteo real
  (`admin.drawer.truncated`: «Mostrando {shown} de {total}…»). La vía de fondo sigue pendiente.
  Nota adicional: el heading **«Piezas (N)»** del drawer cuenta las filas **recortadas** en cliente, no
  el total server-side cuando hay truncado (el indicador nuevo lo deja declarado al operador).
- **Impacto:** medio: sobre-lectura (páginas de más por carta) y conteo del heading no-total bajo
  truncado; correctness del publicar-grupo OK tras la mitigación (recorre todas las páginas).
- **Disparador:** próximo toque al contrato de M1/inventario. **Solicitud al arquitecto:** filtros de
  identidad `sealedSubtype`/`sealedCondition`/`gradingCompany`/`gradeValue` en
  `GET /admin/inventory/items` (y de paso un `total` filtrado utilizable por el heading), para que el
  servidor filtre el grupo y el cliente deje de recortar. Ref: `docs/FRONTEND_NOTES.md` (Ronda de
  corrección Stream B, M-2).

### SB-D8 · `FinishMark`/`FinishBand` con hex del DS hardcodeados — RESUELTA (ronda de corrección, 2026-08-21)
- **Dónde:** `frontend/src/components/domain/FinishMark.tsx` (compartido; el Stream C lo reusa tal cual).
- **Estado:** **RESUELTA** en la misma ronda del gate (commit `e0fbff1`). `FinishBand` dejó los hex
  hardcodeados del DS §16.6 y usa **tokens vivos con fallback**
  (`var(--color-neutral-warm|--color-accent|--color-ink, <hex del DS §16.6>)`), mismo criterio que
  `PortfolioTrendChart`, aplicado ANTES de que el Stream C esparza el patrón. Cubierto por
  `FinishMark.test.tsx`. Registrada aquí para trazabilidad del veredicto techlead; ya no es deuda.

### SB-D9 · `toListingDTO` con dos caminos paralelos de resolución de precio (ctx lote vs single) (Media)
- **Dónde:** `backend/src/modules/catalog/catalog.service.ts:229-250` (`toListingDTO`: rama
  `ctx?.salesRules` → `computeSalePriceForRarity` pura con override del batch, vs rama sin ctx →
  `pricing.getVariantOverride` + `pricing.computeSalePriceForItem` por ítem).
- **Estado actual:** la MISMA resolución de precio de venta (regla por rareza + override de variante)
  vive en dos caminos que deben mantenerse equivalentes a mano. Hoy convergen en la matemática de
  `money.ts`, pero un cambio que toque solo una rama (p. ej. un guard nuevo del override) divergiría
  en silencio entre listados (con ctx) y ficha single (sin ctx).
- **Impacto:** medio (mantenibilidad de ruta de dinero-display): riesgo de precios distintos para la
  misma pieza según el camino de lectura.
- **Disparador:** próximo toque a la ficha/listado del catálogo. Dirección: exigir un
  **PricingContext único** (construirlo siempre — de 1 elemento en el caso single) y borrar la rama
  sin ctx.

### SB-D10 · Troceo >200 del publicar-grupo de sellado no es transaccional entre trozos (Baja, frontend)
- **Dónde:** `frontend/src/app/[locale]/(admin)/admin/m1/SealedTab.tsx:219-226` — el bulk-publish capea
  200 líneas por request (contrato §M1), así que grupos grandes se publican en trozos secuenciales con
  `batchKey` de sufijo **determinista** por trozo (`<key>-0`, `<key>-1`, …) sobre una clave base en
  `useRef` que solo rota tras éxito.
- **Estado actual:** los trozos son requests independientes: un fallo intermedio (red/timeout/5xx) deja
  el grupo **parcialmente publicado**. Es **reparable por replay**: la clave base no se limpia hasta el
  éxito total, así el reintento reenvía los MISMOS `batchKey` por trozo — los trozos ya aplicados
  replayean idempotentes server-side y solo los pendientes ejecutan trabajo real. El toast reporta el
  agregado real de lo procesado.
- **Impacto:** bajo: ventana de publicación parcial visible hasta que el operador reintenta; sin
  duplicados ni corrupción (idempotencia por trozo). Aceptada.
- **Disparador:** si SB-D1 (publish-all → job server-side con `jobId` consultable) se convierte en job,
  **mover este bucle al servidor** en la misma pasada (un solo submit con progreso persistido) y borrar
  el troceo en cliente. Ref: `docs/FRONTEND_NOTES.md` (Ronda de corrección Stream B, M-2) y tests en
  `SealedTab.test.tsx` (paginado+troceo, reuse de batchKey en reintento).

### Ronda de cierre P-21 (rebrand/correo) — deuda del veredicto techlead del gate (2026-08-21, no bloqueante)

### BE-P21-1 · `BRAND` declarado 3 veces + literales de marca inline en el correo de restock (Baja)
- **Dónde:** `backend/src/modules/mail/mail.templates.ts:31`, `backend/src/modules/buylist/buylist-mail.templates.ts:25`
  y `backend/src/modules/orders/mail/guest-order.templates.ts:20` declaran cada uno `const BRAND = 'TCG HUNT'`;
  además `backend/src/modules/catalog/sealed-restock-notify.service.ts:111-115` lleva 4 literales `TCG HUNT`
  **inline** (texto/HTML del correo de reposición), sin constante.
- **Estado actual:** la marca visible del rebrand P-21 vive en 4 sitios independientes; un futuro ajuste de
  marca exige tocar los 4 a mano (la duplicación de plantillas es la deuda aceptada BE-43 — misma raíz:
  `mail/` es de otro stream y las plantillas locales no comparten helpers).
- **Impacto:** bajo (mantenibilidad/branding): divergencia silenciosa posible entre correos si un rebrand
  futuro olvida un sitio.
- **Disparador/dirección:** cuando `backend/src/common/` quede libre (zona compartida serializada), extraer
  `common/brand.constants.ts` (fuente única de `BRAND`) e importarla en los 4 sitios; **se acumula con BE-43**
  (absorción de plantillas en `mail/` — mismo pase). Owner: **backend**. Prioridad: **baja**.

### BE-P21-2 · Default `'soporte@tcgvaultmx.com'` duplicado como literal en 3 archivos + dos idiomas de config (Baja)
- **Dónde:** `backend/src/modules/disputes/disputes.constants.ts:13` (aprox.),
  `backend/src/modules/orders/guest-checkout.constants.ts` (`SUPPORT_EVIDENCE_CONTACT`) y
  `backend/src/modules/buylist/buylist-mail.templates.ts` (`SUPPORT_EMAIL`): los tres leen la MISMA env
  `DISPUTE_EVIDENCE_CONTACT` (buylist con cascada previa por `SUPPORT_EMAIL`) vía `envOr`, pero el **default
  literal** `'soporte@tcgvaultmx.com'` está repetido en los 3.
- **Estado actual:** tras la ronda de cierre P-21 el comportamiento es correcto (env vacía/blanca cae al
  default, helper único `mail/mail-env.util.ts` con tests), pero quedan dos residuos: (a) el literal default
  duplicado → **divergencia silenciosa posible** si alguien cambia solo uno; (b) conviven **dos idiomas de
  configuración**: estas constantes leen `process.env` a **import-time**, mientras el idioma del proyecto es
  `ConfigService` inyectado (como hace `mail.module.ts`) — las constantes no ven cambios de env post-import y
  esquivan la validación central de env.
- **Impacto:** bajo (correctness OK hoy; riesgo de divergencia del buzón y de sorpresa en tests/entornos que
  muten env después del import).
- **Disparador/dirección:** al absorber las plantillas en `mail/` (BE-43) o al liberar `common/`: extraer el
  default a una constante única (junto a `BRAND`, BE-P21-1) y migrar la lectura a `ConfigService` (o a un
  provider del módulo `mail`) para alinear el idioma de config. Owner: **backend**. Prioridad: **baja**.

### FE-P21-1 · Geometría del logo copiada en 3 sitios (componente + OG + favicon), sin guardia contra drift (Media)
- **Dónde:** `frontend/src/components/domain/LogoTcgHunt.tsx:162-180` (fuente de verdad viva: cruz
  segmentada, arcos y punto central del mark), `frontend/public/branding/og-tcg-hunt.svg:21-36` (copia
  literal de esa geometría; además el asset OG **no está referenciado** en el metadata de ningún layout)
  y `frontend/src/app/icon.svg:5-10` (copia de la variante micro).
- **Estado actual:** la triplicación es legítima —los assets estáticos (OG/favicon) no pueden importar un
  componente React— pero no hay nada que detecte divergencia entre las tres copias. Y la divergencia YA
  está agendada: el cotejo pendiente con el PNG original del humano ajustará números en el TSX, y el OG
  (hoy invisible por no estar cableado) quedaría con la geometría vieja sin que nadie lo note.
- **Impacto:** medio (branding): tres copias sin guardia + un ajuste planificado sobre solo una de ellas
  = drift silencioso casi garantizado en OG y favicon.
- **Disparador/dirección:** en la misma pasada del cotejo con el PNG (ese es el disparador): o (a)
  drift-guard — test que compare los números de geometría de los SVG estáticos contra el render del
  componente (`renderToStaticMarkup` de las variantes mark/micro) y falle si divergen, o (b) script que
  **genere** `og-tcg-hunt.svg` e `icon.svg` desde el componente (los estáticos dejan de ser fuente).
  Cablear entonces el OG en metadata (ver FE-P21-3). Owner: **frontend**. Prioridad: **media**.

### FE-P21-2 · Tokens `--hunt-*` declarados pero casi no consumidos; los hex viven duplicados en STOPS del logo (Baja)
- **Dónde:** `frontend/src/app/globals.css:49-55` declara `--hunt-red`, `--hunt-wine`, `--hunt-wine-up`,
  `--hunt-red-hover`, `--hunt-red-up`, `--hunt-red-deep`, `--hunt-tint`; de esos solo `--hunt-red-hover`
  se consume. Los mismos hex están duplicados a mano en `LogoTcgHunt.tsx:38-43` (objeto `STOPS` de los
  gradientes del mark/wordmark).
- **Estado actual:** dos sedes de la paleta hunt sin conexión: cambiar `--hunt-red` en CSS **no cambia el
  logo**, y los tokens restantes son código muerto que sugiere una fuente de verdad que no lo es.
- **Impacto:** bajo (mantenibilidad/DS): riesgo de divergencia de paleta en un ajuste de color futuro y
  tokens fantasma que confunden al que llegue después.
- **Disparador/dirección:** elegir UNA de dos (no ambas): (a) el componente consume los tokens vía
  `style`/`var(--hunt-*)` en los stops y CSS queda como sede única, o (b) se retiran los tokens no usados
  de `globals.css` y el DS declara `STOPS` del componente como sede única de la paleta del logo. Hacerlo
  junto al cotejo del PNG (FE-P21-1), que ya tocará esos hex. Owner: **frontend** (si toca `DESIGN_SYSTEM.md`,
  coordina ux-ui). Prioridad: **baja**.

### FE-P21-3 · Marca duplicada en i18n, patrón de título copiado a mano y metadata sin `metadataBase`/OG url (Baja)
- **Dónde:** `frontend/messages/es.json` y `frontend/messages/en.json` duplican `"TCG HUNT"` en
  `common.appName` y `common.brand.name` (metadata consume una clave y la UI la otra); el patrón de
  título `TCG HUNT — {página}` está copiado a mano en 2 layouts (`frontend/src/app/[locale]/layout.tsx`
  y `frontend/src/app/[locale]/(storefront)/layout.tsx`) en vez de usar `title: { default, template }`
  del layout raíz; y falta `metadataBase` + `openGraph.url` en el metadata.
- **Estado actual:** renombrar la marca exige tocar 4 claves i18n + 2 layouts; sin `metadataBase` las URLs
  relativas de OG no resuelven a absolutas, y sin `openGraph.url` no hay señal canónica.
- **Impacto:** bajo hoy (los textos coinciden), pero `metadataBase`/`openGraph.url` se vuelven necesarios
  en cuanto aterrice el OG PNG (FE-P21-1) y como señal canónica en la migración de dominio con 301.
- **Disparador/dirección:** cuando aterrice el OG PNG o arranque la migración con 301, lo primero que
  llegue: unificar la marca en una sola clave i18n (la otra referencia o desaparece), mover el patrón de
  título a `title: { default, template }` del layout raíz (los layouts hijos solo declaran su segmento) y
  añadir `metadataBase` + `openGraph.url` (dominio canónico desde env). Owner: **frontend**. Prioridad:
  **baja**.

### DO-P21-1 · Guardia anti-prod del DAST: predicado duplicado ×4 y exención de staging por substring — RESUELTA (ronda de cierre P-21, 2026-08-21)
- **Dónde:** `security/scripts/dast-zap-baseline.sh`, `dast-zap-full.sh`, `dast-nuclei.sh` y
  `dast-extra.sh` — cada uno llevaba su copia inline de la guardia anti-producción, y la exención de
  staging comparaba **substring sobre la URL completa** (`*"staging"*`): una URL de producción con
  "staging" en el path/query/userinfo (p. ej. `https://tcghunt.mx/staging-x`) bypaseaba la guardia y
  permitía DAST intrusivo contra prod sin `ALLOW_PROD_DAST=1`.
- **Estado:** **RESUELTA** en la misma ronda del gate (commit `fbcb8fb`). Las dos partes del hallazgo:
  (a) el predicado duplicado ×4 se extrajo a **`security/scripts/_guard.sh`** (`dast_prod_guard` +
  `_dast_host_from_url`), sourceado **obligatorio** por los 4 scripts (si falta, abortan por `set -e`;
  los 5 archivos viajan juntos en `security/scripts/`); (b) la exención se endureció a comparar el
  **HOST** de `TARGET_URL` (sin esquema/userinfo/puerto/path/query, en minúsculas): producción =
  (sub)dominio de `tcgvaultmx.com`/`tcghunt.mx`/`tudominio.com`, exime solo un host con prefijo
  `staging.`. Verificado en ejecución (9 casos de bloqueo con exit 2 —incluido el bypass viejo—,
  staging/localhost pasan, `ALLOW_PROD_DAST=1` levanta); comportamiento documentado en
  `security/README.md` › «Guardia anti-producción». Registrada aquí para trazabilidad del veredicto
  techlead (mismo criterio que SB-D8); **no queda deuda viva** de este hallazgo. Owner: **devops**.
  Prioridad original: **baja**.

### Ronda de corrección Stream C (Cotizador v2) — deuda del veredicto techlead del gate (2026-08-21, no bloqueante)

> Del gate del **Stream C · Cotizador v2** (QA aprobó; techlead rechazó con TL-C1/C2/C3, corregidos en la
> ronda — ver `docs/FRONTEND_NOTES.md` § «Stream C · ronda de corrección»). Ítems de deuda señalados por
> el techlead, dueño **frontend**. Numeración `SC-D*` (Stream C).

### SC-D1 · Cuarto shell de diálogo a mano con garantías divergentes (Media)
- **Dónde:** `frontend/src/components/domain/SellCartDrawer.tsx` vs `components/ui/Modal.tsx` vs
  `components/master-set/CellDrawer.tsx`/`VariantDrawer` — cada uno implementa su propio contenedor de
  diálogo (overlay + Esc + retorno de foco), con GARANTÍAS distintas: solo SellCartDrawer trae focus
  trap completo + guard de focusin (TL-C2); el scrim `rgba(26,26,24,.55)` vive hardcodeado en una
  **cuarta copia**.
- **Impacto:** medio (a11y/mantenibilidad): un fix de foco/scroll aplicado a un shell no llega a los
  demás (el propio TL-C2 se corrigió SOLO en SellCartDrawer); el token del scrim no existe.
- **Disparador:** el **siguiente diálogo nuevo** o el **primer bug de scroll/portal en móvil**.
  Dirección: primitivo `useDialogShell`/`<Dialog>` en `components/ui/` (trap + Esc + overlay + retorno
  de foco + guard TL-C2 una sola vez) + token `bg-scrim` en el DS (coordinar nombre con ux-ui). NO se
  implementó en este stream (decisión explícita del techlead: fuera de alcance de la ronda).

### SC-D2 · 8 tests muertos en `e2e/buylist.spec.ts` (grid plano raw pre-v1.21) — RESUELTA (ronda de corrección Stream C, 2026-08-21)
- **Dónde:** `frontend/e2e/buylist.spec.ts` — 8 casos asumían el grid plano en `raw` (helpers
  `searchFor`/`addCard` sobre «Buscar carta» del filtro plano), muerto desde v1.21 (raw = binder Master
  Set). Normalizaban el rojo: 8 failed / 4 passed de reposo en mock.
- **Estado:** **RESUELTA** en la ronda (opción barata sugerida por techlead, sin `test.fixme` ni
  cobertura falsa): los casos de comportamiento del grid plano/bulk se migraron a **`graded`**
  (seleccionan «Tipo de producto» primero — el grid plano vive ahí ahora) y los casos de acabados raw
  (línea por acabado, precio pendiente de Zapdos, KYC) al **binder quoter** (helpers
  `openBaseSet`/`addFromBinder`, mismos fixtures). `addFirstSellableCard` (@real) descubre por graded y
  clica la primera fila **habilitada** (una carta holofoil-only no cotiza graded en mock →
  FINISH_NOT_AVAILABLE por-ítem, fila deshabilitada sin tumbar el grid). Estado final verificado en
  mock: **12 passed / 0 failed** (antes 4/8). El pendiente que dejó esta migración (el smoke `@real`
  ya no cubre la ruta raw contra staging) se extrajo como ítem abierto propio: ver **SC-D5**.

### SC-D3 · Re-render de la grilla completa del quoter en cada interacción del carrito (Baja-Media)
- **Dónde:** `frontend/src/app/[locale]/(storefront)/buylist/BuylistView.tsx` (`addFromMasterSet`) y
  `frontend/src/components/master-set/MasterSetBinder.tsx` (`QuoterTile`/`BinderTile` sin `memo`).
- **Estado actual:** **preparada (handler estable); sin efecto de perf hasta memoizar las tejas
  (QuoterTile/BinderTile)**. En la ronda TL-C3 `addFromMasterSet` quedó como `useCallback` sobre
  handlers estables de `useSellCart` — pero es un paso *preparatorio*: no hay `memo(` en
  `frontend/src/components/master-set/` (verificado por techlead), así que hoy NO evita ningún
  re-render; cualquier estado que cambie arriba sigue re-renderizando las N tejas del set.
- **Impacto:** bajo-medio (solo perf percibida en sets grandes; sin bug funcional).
- **Disparador:** **lag al teclear cantidades en un set grande** (200+ tejas). Acción: `React.memo` en
  `QuoterTile`/`BinderTile` (sus props ya son estables tras esta ronda) y perfilar antes/después.

### SC-D4 · `MasterSetBinder` acumula ~10 ramas por modo (Baja)
- **Dónde:** `frontend/src/components/master-set/MasterSetBinder.tsx` — condicionales `isQuoter`/
  `mode === 'user_vault_admin'`/etc. regados por fetch, filtros, contadores, sticky y tiles.
- **Estado actual:** el binder compartido decide por modo en ~10 puntos distintos; cada modo nuevo
  (P-17 sumó `onOpenVariant`) agrega otra rama transversal. Aún legible, pero la próxima rama cruza el
  umbral.
- **Impacto:** bajo (mantenibilidad del componente compartido más cargado del proyecto).
- **Disparador:** **la próxima rama por modo** que se necesite. Dirección: objeto de **capacidades por
  modo** (`{ sticky, completion, secretFilter, pieceFilter, nameFilter, addToCart, … }` derivado de
  `MasterSetViewMode` en `mode.ts`) y que el JSX pregunte por capacidad, no por modo.

### SC-D5 · El smoke `@real vender` ya no valida la ruta raw contra staging (extraído de SC-D2)
- **Dónde:** `frontend/e2e/buylist.spec.ts` → `addFirstSellableCard` (flujo `@real`). Dueño: **frontend**.
- **Estado actual:** tras la migración de SC-D2, el descubridor del smoke `@real` selecciona **graded**
  y clica la primera fila habilitada del grid plano. En consecuencia, contra staging **ya no se valida
  la ruta raw** (binder Master Set) — que es la ruta **principal del producto desde v1.21**. La
  cobertura raw existe solo en mock (helpers `openBaseSet`/`addFromBinder`); el E2E real ejercita
  únicamente la ruta graded.
- **Impacto:** hueco de cobertura E2E real en el flujo crítico de venta: una regresión que solo se
  manifieste en la ruta raw contra el stack real pasaría el smoke en verde.
- **Disparador:** **antes del cierre de release / cuando el seed real cotice el binder.** Acción:
  extender el descubridor `@real` (o añadir un caso) que cotice por el binder raw contra staging; si el
  seed real no cotiza raw, ajustar el seed (coordinar con backend/devops) o el descubridor. Ref: SC-D2.

### SC-D6 · Regla de dinero «pendiente ≠ MX$0.00» duplicada en 3 archivos de la ruta buylist (Media)
- **Dónde:** `frontend/src/app/[locale]/(storefront)/buylist/` — la lógica de presentación de un monto
  pendiente vive copiada en 3 archivos: `SellCartContents.tsx:107-121`, `BuylistView.tsx:735-753` y
  `MyRequestsSection.tsx:121-139`; además la condición del total (`totalEstimatedCents === 0 &&
  pendingCardCount > 0`) es **copia exacta** en 2 sitios: `SellCartContents.tsx:211` y
  `BuylistView.tsx:747`. Dueño: **frontend**.
- **Impacto:** medio — es un **invariante de dinero visible**: si se cambia el criterio de «cuándo un
  monto es pendiente» (o su formato) en un sitio y no en los otros, el usuario ve un **total mentiroso**
  (p. ej. MX$0.00 donde debería decir «pendiente») según la pantalla en la que esté.
- **Disparador:** **el próximo toque a cómo se muestra un monto pendiente.** Dirección: extraer un
  `<QuotedAmount>`/`formatQuoted` compartido en la propia carpeta de la ruta (no en `components/`
  globales: es zona compartida y el uso es local a buylist), y que los 3 archivos lo consuman —
  incluida la condición del total, definida una sola vez.

### Fix `fix/variant-composition-regression` (§4.25e) — deuda del veredicto techlead (2026-08-22, no bloqueante)

> Del gate techlead del **fix de la regresión de composición de variantes** (la unión `structural ∪
> pricedFinishesSnapshot` VUELVE, menos `normal` cuando la rareza es premium — §4.25e, deroga §4.25a-1).
> Veredicto **APROBADO con deuda anotada**. La lógica de composición ya pasó gate y NO se toca aquí. Los
> ítems `VC-D*` de abajo son no bloqueantes; dueño **backend** o **arquitecto** donde se anota. Registrados
> a petición del techlead sin tocar la lógica de composición. Detalle del arreglo del log en
> `docs/BACKEND_NOTES.md`.

### VC-D1 · Mensaje `pricedNotStructural` contradictorio bajo §4.25e — RESUELTA (este commit)
- **Dónde:** `backend/src/modules/catalog/finish-reconciler.service.ts` (`reconcile`, bloque de logging).
- **Estado (2026-08-22):** **resuelta.** El `logger.warn` previo decía que el snapshot «NO compone la lista
  blanca (§4.25a); es drift proveedor↔estructura» — texto FALSO bajo §4.25e (con el fix el snapshot SÍ
  compone; es lo que recupera el reverse holo del común) y que además se disparaba en el **camino feliz**
  (cada común de set nuevo logueaba su reverse recuperado como «drift» → ruido inútil en `warn`). Fix
  (solo logging, sin tocar la composición): la observabilidad `snapshot ∖ structural` se parte por SEÑAL en
  dos buckets — (a) acabado que **SÍ compone** (camino feliz, reverse recuperado) ⇒ traza a **`debug`**
  (`snapshotRecovered`), no ensucia `warn`; (b) acabado que la composición **DESCARTÓ** (anómalo, hoy
  `normal` fantasma en rareza premium filtrado por §4.25e-1) ⇒ **`warn`** (`pricedNotStructural`) con texto
  veraz. Tests actualizados en `test/finish-reconciler.spec.ts` (camino feliz→debug + caso anómalo→warn).
  Entrada conservada como registro histórico/trazabilidad.

### VC-D2 · La afirmación «el único acabado colado de más es normal-en-premium» deja fuera dos clases residuales (Media, arquitecto)
- **Dónde:** doctrina de §4.25e (contrato/arquitectura) vs. `composeAvailableFinishes`
  (`backend/src/common/card-order.ts`) + `isPremiumRarity` (`backend/src/common/money.ts`).
- **Estado actual:** el filtro estructural de §4.25e solo quita `normal` cuando `isPremiumRarity(rarity)`.
  La afirmación «el único acabado colado de más es el `normal`-en-premium» deja fuera **dos clases
  residuales pre-existentes** (NO regresión de este fix):
  - **Clase A — `normal` fantasma en rareza holo-only NO-premium:** rarezas holo-only que `isPremiumRarity`
    **no** cubre (p.ej. `Rare Holo` plano, `ACE SPEC Rare`, `LV.X`, `Prime`, `BREAK`) que arrastran un
    `normal` STALE de M-29 en cartas que **NO** joinean TCGCSV. Como no son «premium» por el proxy de
    rareza, el filtro no las limpia → conservan la casilla `normal` fantasma.
  - **Clase B — fantasma NO-normal desde el snapshot:** un `holofoil`/`reverse` espurio inyectado por el
    snapshot que el filtro (solo-`normal`) **no** toca. Mitigado hoy por el gate de escritura del snapshot
    (`market>0 && verified && !forced`), no por la composición.
- **Impacto:** medio (correctness de whitelist / SEC-A1). Ambas clases materializan una casilla vendible de
  más; acotadas hoy por los gates aguas arriba, pero la doctrina las declara imposibles cuando no lo son.
- **Disparador:** al endurecer la whitelist o antes de ampliar el catálogo a eras/rarezas holo-only antiguas.
  Dirección: **documentar por qué no ocurren** (invariantes aguas arriba que las neutralizan) **o sustituir
  el proxy de rareza por un invariante estructural** (no «premium ⇒ sin normal», sino «holo-only ⇒ sin
  normal»). **Enrutar al arquitecto** (define la taxonomía/doctrina §4.25e).

### VC-D3 · `isPremiumRarity` tiene 3 dueños con asimetrías de costo distintas (Media, arquitecto/backend)
- **Dónde:** `backend/src/common/money.ts` → `PREMIUM_RARITY_PATTERNS` / `isPremiumRarity`, consumido por:
  buylist (Fase 0.1, `ruleKeyCandidates`), N-15 display (`computeDisplayFinishes`) y el filtro de whitelist
  (`composeAvailableFinishes`, §4.25e).
- **Estado actual:** el mismo clasificador alimenta 3 rutas con **asimetrías de costo opuestas**: en
  **buylist** sobre-incluir es inocuo/costo acotado (a lo sumo paga % de mercado de más); en **N-15 display**
  es benigno (solo oculta casillas sin precio); pero en el **filtro whitelist** sobre-incluir **BORRA** la
  casilla `normal` (quita un acabado vendible). Un cambio de patrones motivado por buylist (p.ej. ampliar
  para cotizar mejor una chase) puede, **en silencio**, alterar la whitelist y borrar un `normal` legítimo.
- **Impacto:** medio/latente. Correctness OK hoy; el riesgo es un cambio de patrón bien intencionado en un
  consumidor que regrese otro sin señal del compilador ni de un test.
- **Disparador:** **al próximo toque de `PREMIUM_RARITY_PATTERNS`.** Dirección: (1) **test de invariante**
  «premium ⇒ sin `normal` legítimo» (tabla de rarezas premium reales que NUNCA existen en `normal`) que
  falle si un patrón nuevo captura una rareza que sí tiene `normal`; (2) **advertencia** en la definición de
  `PREMIUM_RARITY_PATTERNS` de que la función tiene 3 dueños con costos asimétricos (el de whitelist borra).
  Coordinar **arquitecto** (taxonomía) + **backend** (test/comentario).

### VC-D4 · Doctrina money-safe contradictoria en los comentarios de `card-order.ts` (Baja, backend)
- **Dónde:** `backend/src/common/card-order.ts` → `composeAvailableFinishes` (comentarios del fallback
  `|| ['normal']` y de la rama `isPremiumRarity(null) === false`).
- **Estado actual:** los comentarios justifican **dos cosas opuestas con la misma etiqueta «fail-closed»**:
  el fallback `|| ['normal']` se defiende como «mejor que falte una casilla a que sobre una falsa» (fail-closed
  = **sub**-incluir), mientras la rama `rarity=null` se defiende como lo contrario, «conservar la casilla
  dudosa» (= **sobre**-incluir el `normal`). Ambas son correctas en su contexto, pero el texto no aclara
  **cuál doctrina aplica dónde** ni por qué difieren (una es «conjunto vacío ⇒ semilla mínima»; la otra es
  «no clasifico la rareza ⇒ no me atrevo a borrar»).
- **Impacto:** nulo funcional; solo claridad. Un lector puede creer que hay una contradicción de diseño.
- **Disparador:** **próximo toque de `card-order.ts`.** Dirección: aclarar en cada comentario el eje de la
  decisión — fallback = «nunca emitir whitelist vacía» (materializa una casilla mínima recomputable); rama
  `null` = «sin rareza no hay evidencia para borrar un `normal` posiblemente legítimo» — de modo que quede
  explícito que no compiten (aplican a fases distintas de la composición).

### Fix `fix/variant-composition-regression` — cierre M-31/M-32 (v1.29/v1.30, 2026-08-22, no bloqueante)

> Del gate techlead del stream M-31/M-32 («1 carta ↔ N productos TCGplayer» por `productId` exacto +
> rareza canónica, §4.27/§4.28/§4.29). Veredicto **APROBADO con deuda**. Los 3 hallazgos MAYOR
> (desempate no determinista en `getReference`; comentarios obsoletos que describían heurísticas
> retiradas; migración que prometía un backfill inexistente) **ya se cerraron** en esta rama y NO
> figuran como deuda. Lo de abajo es la deuda NO bloqueante aceptada. Con v1.29 quedan **superseded**
> los ítems `VC-D2/VC-D3/VC-D4` (describen la heurística `composeAvailableFinishes`/`isPremiumRarity`/N-15,
> DEROGADA: la whitelist hoy se deriva EXACTA de `CardProduct.finishes` sin filtro premium — ver
> `finish-reconciler.service.ts`); se conservan como registro histórico.

### VC-D5 · Columnas muertas aún escritas (`structuralFinishes`/`catalogFinishes`/`pricedFinishesSnapshot`) (Baja, backend)
- **Dónde:** `backend/prisma/schema.prisma` (`Card`), aún escritas por `catalog-sync.service.ts` (`upsertCards`) y `price-ingest.service.ts` (snapshot). Ya **NO se leen** para componer (v1.29, §4.27c: el `FinishReconciler` deriva de `CardProduct.finishes`).
- **Estado:** columnas WRITE-ONLY. La migración M-31 las conserva a propósito para **reversibilidad** del deploy (el resolver viejo aún las encontraría si hay que revertir).
- **Impacto:** nulo funcional; ruido de esquema + escrituras inútiles.
- **Disparador:** **una vez validado M-31 en prod.** Dirección: migración POSTERIOR que dropee las 3 columnas y retire su escritura de `upsertCards`/`price-ingest`. Cambio de schema ⇒ **coordinar arquitecto** (zona compartida `prisma/`).

### VC-D6 · `cardProductId` sobrecargado: `String?` FK (cuid) vs `Int?` snapshot (productId) (Baja, backend)
- **Dónde:** `PriceReference.cardProductId` = `String?` FK a `CardProduct.id` (UUID/cuid interno); pero `SellRequestItem.cardProductId` y `PendingPriceEntry.cardProductId` = `Int?` = el `tcgplayerProductId` (productId TCGplayer crudo), NO el UUID interno.
- **Estado:** mismo NOMBRE de columna con DOS significados/tipos distintos (FK interna vs snapshot del id externo). Documentado en los comentarios del schema, pero el nombre invita a confundirlos.
- **Impacto:** bajo/latente; riesgo de que un dev cruce un `Int` productId con la FK `String` o viceversa (no compila por tipo, pero confunde en queries manuales/joins mentales).
- **Disparador:** **próximo toque de `SellRequestItem`/`PendingPriceEntry`.** Dirección: renombrar los `Int?` a `tcgplayerProductId` (o `productIdSnapshot`) para desambiguar del FK interno. Cambio de schema ⇒ **coordinar arquitecto**.

### VC-D7 · `displayFinishes` redundante (`== availableFinishes`) — retiro de contrato pendiente (Baja, backend/frontend)
- **Dónde:** `computeDisplayFinishes` (`backend/src/common/card-order.ts`) es hoy un **shim PURO** (`displayFinishes := availableFinishes`, sin N-15). Se sigue emitiendo en los DTO (`catalog.service.ts`, `master-set.service.ts`) solo por el contrato del front.
- **Impacto:** nulo funcional; campo duplicado en el payload.
- **Disparador:** cuando el **frontend** deje de leer `displayFinishes`. Dirección: retirar el campo del contrato (**arquitecto** en `API_CONTRACT.md`) y del DTO, y borrar el shim. Follow-up de front; hasta entonces se conserva por compatibilidad.

### VC-D8 · `NULLS NOT DISTINCT` fija PostgreSQL ≥ 15 como requisito de deploy (Media, backend/devops)
- **Dónde:** migración M-31 (`20260822120000_..._rarity_canonical/migration.sql`), índice `PriceReference_variant_capturedDate_key ... NULLS NOT DISTINCT`.
- **Estado:** la unicidad de la clave de precio con `cardProductId = NULL` (graded/sealed/fallback) depende de `NULLS NOT DISTINCT`, sintaxis **solo PG 15+**. En un motor < 15 la migración falla.
- **Impacto:** medio operativo: pin de versión de infra no negociable. Si staging/prod corriera < 15, rompería el deploy o (peor) permitiría duplicados si se sustituyera por índice normal sin invariante de app.
- **Disparador:** **antes del primer deploy y en cualquier cambio de motor.** Dirección: **devops** fija/documenta PG ≥ 15 en el entorno; si algún día hay que soportar < 15, sustituir por índice normal + invariante de upsert a nivel de aplicación (ya anticipado en el comentario de la migración). Ref: `docs/DEVOPS_NOTES.md`.

### VC-D9 · El override M-30 no cubre la rama `productId` (producto separado) (Baja, backend)
- **Dónde:** lógica de override manual de precio (M-30) sobre `PriceReference`.
- **Estado:** el override manual opera sobre la referencia de la carta de set (`cardProductId = null`); la rama de PRODUCTO SEPARADO (`cardProductId` no nulo: deck_exclusive/promo) NO tiene override manual. **Money-safe** por construcción: sin override, el precio del producto separado cae a su referencia de mercado o a `pending` («—», nunca 0).
- **Impacto:** bajo; el admin no puede fijar a mano el precio de un producto separado (solo mercado). Sin riesgo de dinero mal calculado.
- **Disparador:** si negocio pide override manual por productId. Dirección: extender el override a la clave `(…, cardProductId)`. **Coordinar arquitecto** (contrato del override).

### VC-D10 · `cardProductId` no se propaga a `InventoryItem` al convertir (Baja, backend)
- **Dónde:** conversión de una entrada/sell request a `InventoryItem`.
- **Estado:** el `cardProductId` (productId del producto separado) que viaja en `SellRequestItem`/`PendingPriceEntry` NO se propaga al `InventoryItem` resultante; el ítem queda anclado solo a `(cardId, finish)` como antes de M-31/M-32.
- **Impacto:** bajo hoy; la valuación del inventario del producto separado no distingue por productId al nivel del ítem (usa la ruta de carta base). Latente si se quiere valuar/reportar inventario por producto separado.
- **Disparador:** cuando el inventario necesite discriminar por producto separado. Dirección: añadir `cardProductId` a `InventoryItem` y propagarlo en la conversión. Cambio de schema ⇒ **coordinar arquitecto**.

### VC-D11 · R-1: hermanos por `groupId` sin verificación por egress (Media, backend/arquitecto)
- **Dónde:** resolución de productos hermanos (mismo `groupId` TCGCSV) en el resolver de M-31.
- **Estado:** los productos hermanos bajo un `groupId` se agrupan sin una verificación independiente por **egress** (segunda señal que confirme que pertenecen a la misma carta/juego). Se confía en el `groupId` de la fuente.
- **Impacto:** medio/latente; una anomalía de la fuente (dos cartas distintas bajo un mismo groupId) podría fundir productos que no corresponden. Acotado hoy por el `@unique tcgplayerProductId` y la lectura EXACTA por productId.
- **Disparador:** al endurecer el resolver o si aparece drift de agrupación en la fuente. Dirección: añadir verificación cruzada (egress/segunda señal) antes de agrupar por `groupId`. **Enrutar al arquitecto** (doctrina del resolver §4.27).

### VC-D12 · R-5: rareza nueva entra `unmapped` → fallback pct hasta añadirla al catálogo (Media, backend)
- **Dónde:** `normalizeRarity` / catálogo de rarezas canónicas + reglas por rareza (buylist/sales).
- **Estado:** una rareza NUEVA que aún no está en el catálogo de mapeo entra como `unmapped` y cae al **fallback por porcentaje** de las reglas de precio hasta que se la añada explícitamente. Money-safe (usa el pct genérico), pero no aplica la regla fina de esa rareza.
- **Impacto:** medio; precios de compra/venta de la rareza nueva usan el % genérico (no el afinado) hasta la actualización del catálogo.
- **Disparador:** cada vez que TCGplayer introduce una rareza nueva. Dirección: proceso/alerta que detecte `unmapped` y lo enrute a añadir la rareza al catálogo canónico + su regla. Observabilidad ya existe vía el lookup; falta la señal proactiva.

### VC-D13 · M-31 REQUIERE re-sync forzado TOTAL para poblar `CardProduct` + `rarityCanonical` (Media, backend/devops — requisito de release)
- **Dónde:** migración M-31 (siembra transitoria) + `catalog-sync.service.ts` (`upsertCards` escribe `rarityCanonical = normalizeRarity(rarity)` y el resolver `--force` puebla `CardProduct`).
- **Estado (honesto, cierra MAYOR-2):** la migración M-31 **NO** trae data-migration aparte (el `m31-backfill.ts` que un comentario previo prometía **no existe**; el comentario ya se corrigió). La columna `rarityCanonical` se SIEMBRA con el `rarity` **crudo** como valor money-safe transitorio; el valor CANÓNICO real y las filas de `CardProduct` los puebla el **RE-SYNC FORZADO por set** (`sync {setId, force:true}`), que de todos modos es **obligatorio** para poblar `CardProduct`.
- **Impacto:** hasta ejecutar el re-sync forzado TOTAL, el `groupBy(['rarityCanonical','rarity'])` del admin (`pricing.controller.ts`) agrupa las filas **pre-M31 por el string CRUDO** (no el canónico). El **PRICING no se ve afectado** (el lookup re-normaliza AMBOS lados). Sin riesgo de dinero; solo agrupación de reportes admin hasta el re-sync.
- **Disparador:** **release de M-31/M-32.** Acción requerida: correr un **re-sync forzado total** (todos los sets) como paso del release, ANTES de considerar poblado el catálogo canónico. No hay runbook de release dentro de `backend/`; **devops** debe cablear este paso en el procedimiento de deploy (`docs/DEVOPS_NOTES.md`). Consistencia verificada: comentario de la migración ↔ realidad ↔ esta entrada.

### Ronda de limpieza `fix/variant-composition-regression` — deuda del veredicto techlead (2026-08-22, no bloqueante)

> Dos hallazgos MENOR + un MAYOR de mantenibilidad del pase de limpieza. El comentario engañoso
> de `e2e-fixtures.ts:35` (afirmaba mapeo vía `RARITY_MAP`, ya retirado) **queda resuelto en este
> mismo commit** (ahora describe `normalizeRarity` + `BUYLIST_PRICE_RULES`) y NO figura como deuda.

### TD-1 · `M2View.tsx` es un monolito (~2.236 líneas, ~20 hooks, editores inline clonados) (MAYOR, frontend) — **RESUELTA (2026-08-22, `fix/variant-composition-regression`)**
- **Dónde:** `frontend/src/app/[locale]/(admin)/admin/m2/M2View.tsx` + nueva subcarpeta `frontend/src/app/[locale]/(admin)/admin/m2/sections/`.
- **Estado:** ~~un solo componente de ~2.236 líneas con ~20 hooks y varios editores inline. Los editores de reglas **buylist** y **venta** son clones 1:1 del mismo patrón dos-ejes (rareza canónica + acabado).~~ **RESUELTA** (refactor PURO, cero cambio de comportamiento/UX). `M2View.tsx` quedó como **orquestador de 56 líneas** (antes 2.235). Se extrajeron a `m2/sections/`: `PriceIngestSection` (Sección 1), `PendingQueueSection` (+ modal override), `FxSection`, `PriceProviderSection` (selector de proveedor §3b), `BuylistRulesSection` (+ «Unificar rarezas» anclado §19.5 y su modal), `SalesRulesSection`, `SealedSpreadsSection`, `CatalogSyncSection` (los 3 grupos Datos/Catálogo/Avanzado + tabla de sets + modales force/refresh-all), y helpers/constantes/`SyncProgress`/`RowMoreMenu` en `shared.tsx`. La **duplicación buylist↔venta se colapsó** en un único `<RuleAxisEditor>` presentacional (estructura de los dos ejes); la lógica de modelo que DIFIERE (buylist numérico + preserva valor al cambiar de modo; venta texto crudo + limpia valor + validación S-P1-1) queda en cada sección vía view-models de fila → comportamiento EXACTO. El estado acoplado precio↔catálogo (`justDispatched`, `priceSyncStatus`, `catalogBusy`/`batchBusy`, keep-alive, invalidaciones) se centralizó en el hook `useCatalogSync` consumido por `PriceIngestSection` y `CatalogSyncSection`; el orden DOM se conserva idéntico.
- **Verificación (gates):** `tsc --noEmit` OK, `next lint` sin warnings/errores, `next build` OK, **`vitest run` 568/568 verdes** (M2View.test.tsx 67/67), sin modificar los tests. Detalle en `docs/FRONTEND_NOTES.md`.
- **Nota:** cubre también la duplicación descrita en **FE-14** (editores buylist/venta) — el `RuleAxisEditor` compartido la elimina.

### TD-2 · Formalizar `unify-rarities` en contrato + `UPSTREAM_ERROR`/`SET_NOT_IMPORTED` en el enum central (MENOR, arquitecto) — **RESUELTO (2026-08-22, `fix/variant-composition-regression`)**
- **Dónde:** `docs/API_CONTRACT.md` (§Convenciones/Errores, v1.31/v1.32) y `backend/src/common/error-codes.ts`.
- **Estado:** ~~`unify-rarities` aún no está documentado en el contrato pese a estar operativo; y los códigos `UPSTREAM_ERROR` / `SET_NOT_IMPORTED` se emiten hoy por **cast** (`as ErrorCodeType`) en vez de estar en el enum central de códigos de error.~~ **RESUELTO.** El arquitecto formalizó ambos códigos como normativos en el contrato (v1.31/v1.32). El **backend** los añadió al enum central `ErrorCode` (`common/error-codes.ts`, sección Catalog/pricing) y **retiró todos los casts `as ErrorCodeType`** que los usaban: `catalog-sync.service.ts` (consts `UPSTREAM_ERROR`/`SET_NOT_IMPORTED` eliminadas; guards `withTcgcsvGuard`/`withUpstreamGuard`, `refreshVariants` SET_NOT_IMPORTED e `INTERNAL`, y el fallback de `runRefreshVariantsAll` ahora usan `ErrorCode.*`) y `sealed-pricing.controller.ts` (`groups`/`products` ahora usan `ErrorCode.UPSTREAM_ERROR`). Mapeo de status HTTP intacto (502 UPSTREAM_ERROR / 409 SET_NOT_IMPORTED); sin cambio de comportamiento. Gate: 1434/1434 tests verdes, `tsc`/lint/build OK. No quedan casts `as ErrorCodeType` en `backend/src/`.
- **Impacto:** cerrado; el cast que evadía la fuente única de verdad de los códigos ya no existe.

### TD-3 · Filas `ConfigSetting key='rarity_map'` quedan inertes en BD sin migración de limpieza (MENOR, backend) — **RESUELTO (2026-08-22, `fix/variant-composition-regression`)**
- **Dónde:** tabla `ConfigSetting`, filas con `key='rarity_map'` (residuo del `RARITY_MAP` retirado). Migración: `backend/prisma/migrations/20260822150000_m36_cleanup_rarity_map_setting/`.
- **Estado:** ~~el `RARITY_MAP` fue retirado del código pero las filas `rarity_map` en `ConfigSetting` no se borraron.~~ **RESUELTO.** Se añadió la migración de datos **M-36** (`DELETE FROM "ConfigSetting" WHERE "key" = 'rarity_map';`), idempotente (0 filas afectadas si no existen; no-op en greenfield) y segura/aditiva (solo borra config muerta; NO toca schema, dinero, precios ni inventario). NO se aplicó contra prod desde aquí (no hay DB en el entorno de trabajo); la aplica devops en el deploy. Gate: `prisma format`/`generate` OK, 1434/1434 tests verdes.
- **Impacto:** cerrado; el residuo de datos se limpia con el próximo `migrate deploy`.
- **Rollback:** NO se restaura — era config muerta sin lectura viva (documentado en la cabecera de la migración). Si se necesitara una tabla rareza→precio, se usa el setting vigente `buylist_price_rules`.

### Cierre P-27 (sets multi-parte / master set combinado) — deuda del veredicto techlead (2026-08-22, `fix/variant-composition-regression`, no bloqueante)

> Veredicto techlead de P-27 **aprobado**. **M1** (export muerto `isMappedExternalId` en
> `master-set-groups.ts`) **queda RESUELTA** en este mismo cierre: grep confirmó cero consumidores en
> módulos y tests, se **eliminó** la función. **M3** (mutación in-place de arrays en un par de folds) es
> cosmético y no se registra. Los siguientes cuatro ítems quedan como deuda MENOR aceptada.

### P27-D1 · El mapa `master-set-groups` es constante de código (añadir un par requiere deploy) (MENOR, backend)
- **Dónde:** `backend/src/config/master-set-groups.ts` (`MASTER_SET_GROUPS`).
- **Deuda:** el mapa padre→subset es una constante curada en código. Añadir/quitar un par de master set combinado requiere **deploy + validación contra el catálogo real** (no es editable en caliente).
- **Impacto:** bajo; el catálogo de pares hoy es diminuto (solo Celebrations confirmado). Money-safe por diseño: el mapa es SOLO PRESENTACIÓN, nunca fuente de verdad (ARCHITECTURE §4.31e).
- **Disparador:** cuando el catálogo de pares **crezca** (varios sets multi-parte). Ruta futura: migrar a `ConfigSetting` (M10) editable-sin-deploy **conservando la regla «nunca fuente de verdad»** (invariante ya documentada en ARCHITECTURE §4.31a). No urgente.

### P27-D2 · El cotizador de buylist NO combina sets multi-parte (incoherencia de superficie) (MENOR, backend/frontend)
- **Dónde:** `backend/src/modules/catalog/catalog.service.ts` → `listSetsWithImportedCards` y `searchAllCards` (rutas `/buylist/sets` y `/buylist/cards`).
- **Deuda:** esas dos rutas **no** aplican `foldStorefrontSets`/`expandSetIdFilter`, así que el cotizador de buylist muestra Celebrations como **dos sets de 25** (`cel25` + `cel25c`) mientras storefront/M1/bóveda lo pliegan a **un master de 50**.
- **Impacto:** cosmético/UX; **money-safe** — el cotizador cotiza por `cardId` real (cada carta conserva su `setId` real), no por el set combinado. Está **fuera del alcance de §L** (centrada en storefront/M1/bóveda), por eso no era gate.
- **Disparador:** cuando se quiera coherencia de presentación end-to-end. Dirección: exponer el mismo plegado/expansión (`foldStorefrontSets`/`expandSetIdFilter`) también en `/buylist/sets` y `/buylist/cards`. Requiere alinear frontend del cotizador.

### P27-D3 · Validar los `externalId` reales de los pares Shiny Vault contra el catálogo (MENOR, backend)
- **Dónde:** `backend/src/config/master-set-groups.ts` (candidatos COMENTADOS).
- **Deuda:** dos candidatos «Shiny Vault con id propio» quedan comentados a la espera de validar sus `externalId` EXACTOS contra el catálogo REAL antes de activar (no se shippea a ciegas — ARCHITECTURE §4.31a): Shining Fates (`swsh45` → subset `swsh45sv`) y Hidden Fates (`sm115` → subset `sma`).
- **Impacto:** nulo hoy (líneas inertes/comentadas); sin descomentar, esos sets simplemente no se pliegan.
- **Disparador:** validar los `externalId` reales de ambos pares contra el catálogo importado e ir **descomentando** las líneas correspondientes (la validación al boot §4.31a avisa si el `externalId` mapeado no está importado). No urgente.

### P27-M2 · Cuatro implementaciones del «resolver grupos activos según externalId presentes» repiten el núcleo (MENOR/refactor, backend)
- **Dónde:** `resolveMasterSet`, `foldCombinedMasterSets`, `foldStorefrontSets` y `expandSetIdFilter` (config/servicio de master sets).
- **Deuda:** las cuatro repiten el mismo núcleo —resolver qué grupos están activos según los `externalId` presentes, incluido el chequeo `<2 partes`— con pequeñas variaciones de forma de salida.
- **Impacto:** mantenibilidad; cuatro sitios a tocar si cambia la regla de activación. Sin riesgo de comportamiento hoy (los tests cubren cada uno).
- **Disparador:** al próximo cambio de la regla de agrupación. Dirección: extraer un helper compartido `resolveActiveGroups(presentExternalIds)` en la config y que los cuatro lo consuman. No urgente.

### Makeover 1a storefront (2026-08-22) — pase de refactors R1–R5 (rama `claude/frontend-redesign-320uai`, dueño: frontend salvo indicado)

> Registro pedido por el techlead junto al pase acotado de refactors del makeover 1a. Los refactors
> obligatorios **R1–R5 quedaron ejecutados en esta misma rama** (StockBadge/PendingPriceLabel/Shelf/
> EditorialLink únicos en `(storefront)/_shared/`, StoreTabs como `<nav>`+`aria-current`, debounce +
> `keepPreviousData` en el catálogo) y NO figuran aquí. De los D-menores (D7), quedaron **corregidos
> de paso**: año dinámico del footer, numeración del carrusel `aria-hidden`, semántica de tabla del
> BountyBoard (`role="table"/row/columnheader/cell`), aria-label de quitar en chips de filtro,
> `BUYLIST` literal → `buylist.verticalLabel`, y **D3** (Paginator movido a `_shared/` y paginación
> real en `SealedShopView`). Lo de abajo es la deuda que QUEDA abierta.

#### MK-D1 · Seis tejas de producto conviven con una `ListingCard` canónica muerta (Media, frontend)
- **Dónde:** `CatalogTile`, teja grande/chica del `FeaturedCarousel`, teja de `GradedShelf`, teja de
  `SealedShelf` (home), `SealedGroupTile` (sellado) — todas en `(storefront)/` — frente a
  `frontend/src/components/domain/ListingCard.tsx` (canónica previa al makeover, hoy sin consumidor
  del storefront).
- **Impacto:** medio (mantenibilidad): la anatomía de teja (imagen + serif + renglón mono + precio +
  distintivo) vive N veces; un matiz del DS hay que replicarlo. Se mitigó en este pase unificando
  distintivo de stock y precio-pendiente, pero la teja completa sigue multiplicada.
- **Disparador:** cuando el orquestador **serialice la zona compartida `frontend/src/components/`**
  para este stream: consolidar una teja canónica ahí (o retirar `ListingCard` si se decide que la
  teja vive por vista) — la decisión de dónde vive pasa por techlead/orquestador.

#### MK-D2 · Huérfanos `FeaturedSetGlance` + claves `home.trustAuth/trustPrice/ctaBuylist/vaultLabel/featuredSet.*` (Baja, frontend + ux-ui)
- **Dónde:** `frontend/src/components/domain/PortfolioTrendChart.tsx` (`FeaturedSetGlance`, retirado
  de la home por el makeover; solo lo referencia su test) y claves i18n `home.trustAuth`,
  `home.trustPrice`, `home.ctaBuylist`, `home.vaultLabel`, `home.featuredSet.*` (ES+EN) sin consumidor
  de vista.
- **Impacto:** bajo (código/copys muertos). `FeaturedSetGlance` está en zona compartida
  `components/domain/` — su baja no puede ejecutarla este stream unilateralmente.
- **Disparador:** decidir la **baja con ux-ui** (¿regresa el glance en alguna vista o se retira
  §7.18?); al retirarlo, borrar componente + test + claves en el stream que tenga la zona compartida.

#### MK-D4 · Chips de filtro del catálogo con etiquetas sin traducir (`productType`, acabado) (Baja, frontend)
- **Dónde:** `catalog/CatalogView.tsx` → `buildChips`: el chip de `productType` pinta el valor crudo
  del enum (`raw`/`graded`/`sealed`), y el de `finish` la etiqueta cruda (la localizada vive en el
  panel de filtros). El nombre de set (QA-1) y los límites de precio (QA-2) ya se corrigieron.
- **Impacto:** bajo (copy en inglés técnico en chips ES). El valor es correcto; solo falta la
  etiqueta localizada (los catálogos i18n `finish.*` y tipos ya existen).
- **Disparador:** próximo toque a `buildChips`; mapear a `t('finish.*')` / etiqueta de tipo.

#### MK-D5 · Doble fuente de verdad de filtros del catálogo (URL vs estado) (Media, frontend)
- **Dónde:** `catalog/CatalogView.tsx`: los filtros viven en `useState` y se MERGEAN desde la URL
  (efecto sobre `urlKey` + `parseUrlFilters`), y solo `type=graded` se refleja de vuelta con
  `router.replace`. El resto de filtros no viaja a la URL (no hay deep-link/back-forward completo), y
  la sincronización bidireccional parcial es frágil (R5 añadió además el término debounced como
  tercera pieza a coordinar).
- **Impacto:** medio (UX de compartir/atrás-adelante + complejidad accidental creciente).
- **Disparador:** a medio plazo, próximo trabajo mayor sobre el catálogo: hacer la **URL la fuente
  única** (estado derivado de `searchParams`, cambios vía `router.replace` con scroll preservado).

#### MK-D6 · `BuylistView` sigue siendo un monolito (~820 líneas) (Media, frontend)
- **Dónde:** `buylist/BuylistView.tsx` (~821 líneas) pese a las extracciones previas (TL-C3:
  `useSellCart`, `SellCartContents`, `MyRequestsSection`).
- **Impacto:** medio (mantenibilidad; mismo patrón que el resuelto TD-1/M2View a menor escala).
- **Disparador:** próximo trabajo sobre el módulo Vender. **Siguiente extracción acordada:** barra de
  filtros (set/búsqueda por tipo) + grid de resultados a componentes propios de `buylist/`.

#### MK-D7 · Menores restantes del veredicto (Baja, frontend)
- **`SealedShelf` (home) usa `<img>` crudo** en vez de `CardImage` (thumb cuadrado con
  `object-contain` propio); `CardImage` es compartido y hoy impone su proporción — alinear cuando se
  toque la zona compartida (misma ventana que MK-D1).
- **`HomeQuoter`:** `getBuylistQuote` con `.then/.catch` sin cancelación (una respuesta tardía puede
  aterrizar tras quitar la línea; el guard por `key` mitiga duplicados, no estados zombis) y el
  typeahead **sin patrón combobox ARIA** (`role="combobox"`/`listbox`/`aria-activedescendant`,
  navegación con flechas). Disparador: próximo toque al cotizador del hero — migrar a
  `useMutation`/AbortController y al combobox accesible (§6 del DS).
- **Header de `/checkout` sin simplificar** según §20.1 («marca + rótulo mono PAGO SEGURO · MXN SIN
  IVA, sin nav»): `StorefrontHeader` es zona compartida (`components/layout/`) — aplicar cuando se
  serialice esa zona.
- **`PriceTag` compartido (`components/ui/PriceTag.tsx`):** la señal «precio pendiente» canónica del
  storefront quedó en `(storefront)/_shared/PendingPriceLabel.tsx` (R2, color accent §16.4/§20.13);
  la **consolidación final va en `PriceTag`** (que hoy pinta su propia variante) cuando se serialice
  la zona compartida — mismo disparador que MK-D1.

#### MK-D8 · `CatalogView` sin test de regresión del debounce/reset de página (Baja, frontend)
- **Dónde:** `catalog/CatalogView.tsx` — la interacción debounce de búsqueda (300 ms, R5) + reset de
  página no tiene test de regresión. **Borde conocido:** pulsar «Limpiar filtros» dentro de la
  ventana de 300 ms no limpia el input de búsqueda y el término pendiente entra como filtro después.
- **Impacto:** bajo (borde de UX poco frecuente; sin test, una regresión pasaría inadvertida).
- **Remedio:** limpiar `searchTerm` cuando el caller pasa filtros vacíos + test de regresión del
  debounce/reset.
- **Disparador:** próximo toque al catálogo.

#### MK-D9 · `StockBadge` sin prop `size` (Baja, frontend)
- **Dónde:** `(storefront)/_shared/StockBadge.tsx` — no expone tamaño; `SealedDetailView` pelea con
  las clases responsivas vía `className`.
- **Impacto:** bajo (override frágil de clases en un consumidor).
- **Remedio:** agregar `size?: 'sm' | 'md'` al componente y retirar el override.
- **Disparador:** cuando aparezca la próxima variante de tamaño del distintivo.
### Cluster P-34 (pricing por tiers) — deuda del veredicto techlead (2026-08-22, no bloqueante)

> Deuda NO bloqueante que el techlead re-enumeró en el **Cluster P-34** (migración de pricing a
> **tiers**). Dueño **backend** salvo H8 (recordatorio operativo para **devops**). El acoplamiento del
> tercer read del `PRICING_TIER_MAP` (**H6**) NO se registra como entrada nueva: **actualiza SB-D2**
> (ver arriba, «Actualización 2026-08-22 (H6…)»), que ya cubre las lecturas paralelas de reglas de
> compra/venta. Ninguno de estos ítems tiene riesgo de dinero: todos los callers de producción ya
> pasan por la ruta segura (tier map); lo que queda es complejidad/endurecimiento preventivo.

### H3 · `toPriceRuleSet` ramifica en 3 shapes (tiered / dos-ejes v1.29 / plano legacy v1.3.1) (Baja, backend)
- **Dónde:** `backend/src/common/money.ts` → `toPriceRuleSet`.
- **Estado actual:** compat **on-read**: `toPriceRuleSet` acepta y normaliza TRES formas de config —
  (1) **tiered** (la vigente), (2) **dos-ejes v1.29** y (3) **plano legacy v1.3.1**. La rama plana
  legacy ya **no debería existir** en datos productivos.
- **Impacto:** bajo (mantenibilidad): tres ramas de parseo que hay que mantener y razonar; sin riesgo
  de dinero — todos los callers de producción pasan `tierMap`, así que la ruta viva es la tiered.
- **No bloquea:** la complejidad es acumulada, no un defecto de correctness; el dinero se calcula por
  la rama tiered.
- **Disparador:** una vez **confirmado que ningún `ConfigSetting` productivo trae el shape viejo**,
  **cerrar la rama plana legacy** (y evaluar además retirar la de dos-ejes v1.29). Dirección: auditar
  los `ConfigSetting` de precio en prod → si solo hay tiered, eliminar la(s) rama(s) muerta(s) de
  `toPriceRuleSet`.

### H4 · Seed `DEFAULT_SETTINGS` sin validación de invariante premium→pct en runtime (Baja, backend) — RESUELTO (2026-08-23)
- **Dónde:** `backend/src/modules/settings/settings.constants.ts` (`SETTING_DEFAULTS`). **Estado:** **RESUELTO**.
- **Estado (histórico):** el seed **no** se afirmaba contra el invariante premium→pct; cumplía, pero nada
  lo verificaba automáticamente.
- **Fix (2026-08-23):** `premiumFixedOffenders` se **extrajo** del `PricingController` (antes privado) a
  `backend/src/common/pricing-tiers.ts` como función pura exportada (lógica idéntica; el controller ahora
  delega). Nuevo unit test en `backend/test/tech-debt-backend.spec.ts` afirma
  `premiumFixedOffenders(seedMap, seedBuyTiers) === []` sobre el seed (`PRICING_TIER_MAP` +
  `BUYLIST_PRICE_RULES.tierRules`), más sanity (detecta infractor si una premium se mapea a un tier fixed) y
  el caso «tier sin regla de compra ⇒ no infractor». **El seed NO se tocó** (solo se añadió el test/guard).

### H5 · `premiumByPattern` incompleto (falta `mega`/`blackwhite`) — clase R-5 money-losing latente (Media, backend) — RESUELTO (2026-08-23)
- **Dónde:** `backend/src/common/rarity-catalog.ts` → `premiumByPattern`. **Estado:** **RESUELTO**.
- **Estado (histórico):** `premiumByPattern` no incluía el patrón `mega`/`blackwhite`; una futura variante
  string tipo `"Mega X"`/`"Black White Y"` **no-alias** caería a `premium:false` → bin holo barato
  (money-losing clase R-5).
- **Fix (2026-08-23):** añadidos los substrings `'mega'` y `'blackwhite'` a `PREMIUM_SUBSTRINGS`
  (consistentes con las canónicas premium ya mapeadas: `MEGA_ATTACK_RARE`→Mega Rare y Black White Rare →
  T3). Ahora una variante premium NUEVA no-alias resuelve a premium **por patrón** (sobre-incluir es inocuo:
  cotiza por % de mercado; ya no cae al bin fijo barato). Sin cambio para las no-premium (Common/Uncommon/
  Rare/Rare Holo siguen `false`). Tests en `backend/test/tech-debt-backend.spec.ts` («P-34 H5 …»):
  `isPremiumCanonicalRarity('Mega Brilliant Rare')`/`('Black White Star Rare')` no-alias ⇒ `true`; canónicas
  ya mapeadas siguen premium; no-premium intactas.

### H8 · Backfill `POST /admin/catalog/unify-rarities` debe correr post-deploy — divergencia cosmética hasta entonces (Baja, operativa — recordatorio para runbook de **devops**)
- **Dónde:** operativa/runbook (no es código de `backend/`). Endpoint: `POST /admin/catalog/unify-rarities`.
- **Estado actual:** hasta correr el backfill `unify-rarities` **post-deploy**, el editor admin puede
  pintar una rareza premium como **unmapped/fallback** aunque la **cotización la resuelva bien**. La
  divergencia es **SOLO cosmética** (editor admin) — la **money-safety NO depende del backfill** (el
  lookup re-normaliza y cotiza correcto).
- **Impacto:** bajo y cosmético (visualización en el editor admin); sin efecto en dinero/valuación.
- **No bloquea:** money-safe por construcción; solo pulido de presentación admin post-deploy.
- **Disparador / acción:** **devops** debe **documentar en el runbook de deploy** que el backfill
  `POST /admin/catalog/unify-rarities` corre **tras el deploy** (para eliminar la divergencia cosmética
  del editor). Recordatorio enrutado a `docs/DEVOPS_NOTES.md`; el backend solo lo anota aquí (no toca
  runbook ni CI, que son de devops).

### Pase de deuda de display/UX del cotizador (2026-08-23) — H1/H3/H4 (frontend)

> Pago de deuda **segura y de valor**, dueño **frontend**. Todo es **display/UX** (money-safe intacto) y
> conserva el visual del rediseño. Detalle en `docs/FRONTEND_NOTES.md` («Pase de deuda técnica frontend»).

#### Cotizador H3 · La teja de PRODUCTO SEPARADO no se sombreaba «En el carrito» (lo pidió el humano) — **RESUELTA (2026-08-23)**
- **Dónde:** `frontend/src/components/master-set/MasterSetBinder.tsx` (`SeparateProductTile` + su render ~L531).
- **Síntoma:** las tejas de variante base (`QuoterTile`) recibían `inCart` y se sombreaban «ya en el carro», pero
  la teja de **producto separado** (`SeparateProductTile`, deck_exclusive/promo) NO recibía la prop → un producto
  separado ya agregado quedaba sin sombrear (inconsistencia visible en el cotizador).
- **Fix:** se propaga `inCart` a `SeparateProductTile` con la MISMA identidad del carrito que las demás tejas,
  añadiendo el `productId` (un producto separado es una LÍNEA propia): `isInCart?.(cardId, finish, productId)`.
  Reusa EXACTO el sombreado de `QuoterTile` (`bg-surface-2` + `shadow-[inset_0_0_0_1px_var(--color-border-strong)]`
  + `data-in-cart` + etiqueta textual `quoterInCart` en `text-success`, doble canal). Solo aplica en quoter
  (fuera del quoter `inCart` es undefined). Sin cambio de contrato.

#### Cotizador H1 · Flash de layout en desktop (carrito JS-driven) — **RESUELTA (mitigación mínima, 2026-08-23)**
- **Dónde:** `frontend/src/app/[locale]/(storefront)/buylist/BuylistView.tsx` (contenedor grid + `useMediaQuery`).
- **Síntoma:** el carrito desktop se decidía 100% en JS (`useMediaQuery('(min-width:1024px)')`), first-paint móvil
  que saltaba a 2 columnas al hidratar → layout shift visible de la columna `main`.
- **Fix (mitigación mínima):** la ESTRUCTURA de 2 columnas se declara ahora por CSS
  (`lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start`, mismo umbral 1024px que `isDesktopCart`), NO por
  JS. El track de 360px queda reservado desde el first-paint en desktop ⇒ `main` nace con su ancho final y no
  refluye. **Trade-off (aceptado):** el CONTENIDO del carrito (`<aside>` / FAB+drawer) SIGUE siendo un ÚNICO render
  JS-driven (`isDesktopCart`) para no duplicar estado/foco ni el focus-trap; en desktop el `<aside>` aparece al
  hidratar dentro de la columna ya reservada (rellena hueco, sin reflujo de `main`), y el FAB móvil es `fixed`
  (fuera del flujo). El fix del todo (SSR-aware del viewport o extracción del carrito) reestructuraría de más;
  se aplicó la mitigación mínima. Documentado en `docs/FRONTEND_NOTES.md`.

#### Cotizador H4 · Doc drift «gemelo de FinishLabel» → `FinishMark` — **RESUELTA (2026-08-23)**
- **Dónde:** comentario de `frontend/src/components/domain/RarityLabel.tsx` + `docs/FRONTEND_NOTES.md` (P-44).
- **Síntoma:** el comentario describía `RarityLabel` como «gemela del `FinishLabel`»; el hermano canónico del
  rediseño que vive JUNTO a `RarityLabel` en `components/domain` es **`FinishMark`** (`FinishLabel` es una etiqueta
  local del storefront en `_shared/`). Drift de referencia.
- **Fix:** corregida la referencia a **`FinishMark`** en ambos sitios.

### Merge stream «Inventario y vault» / sellado (`fix/variant-composition-regression`, HEAD `9b6a81b`, 2026-08-23) — deuda del veredicto techlead (APROBADO CON DEUDA ANOTADA, no bloqueante)

> Tres hallazgos **menores no bloqueantes** (todos dueño **backend**) que el techlead aceptó al aprobar el
> merge del stream de inventario/sellado. Ninguno bloquea; se anotan con archivo:línea para quien los tome.

#### D-1 · Cascada de display de sellado (§4.34a) duplicada e YA DIVERGENTE pese a existir helper (Baja, backend)
- **Dueño:** backend. **Severidad:** Baja (mantenibilidad; **solo display, no dinero**).
- **Deuda:** `backend/src/modules/vault/vault.service.ts:30` define `resolveSealedDisplay(...)` y su comentario
  afirma que es el «MISMO resolver» que usan las 4 vistas — **es inexacto**. `catalog/sealed-catalog.service.ts:103-104`
  e `inventory/sealed-graded.service.ts:334-335` **inline** la misma cascada de fallback en vez de importar el
  helper, y **ya DIVERGEN**: graded usa `card?.name ?? ''` como último eslabón, mientras
  `sealed-product.service.ts:695` usa `` `Sealed #${productId}` ``. El orden de fallback vive hoy en 4 sitios
  distintos que pueden seguir separándose.
- **Por qué importa:** el nombre mostrado del sellado puede diferir entre catálogo, vault, graded y producto
  para la misma pieza (inconsistencia visible de UI). No toca dinero.
- **Disparador / dirección de fix:** subir `resolveSealedDisplay` a `backend/src/common/` (o a `pricing`) y que
  los **4 builders** lo consuman; el orden de fallback queda en un solo sitio, eliminando la divergencia.

#### D-2 · `resolveAnchorCardId` duplicado verbatim (byte-a-byte), money-adjacent (Baja hoy, prioridad de extracción, backend)
- **Dueño:** backend. **Severidad:** Baja hoy, pero **money-adjacent** → prioridad de extracción.
- **Deuda:** `resolveAnchorCardId` es **idéntico byte-a-byte** en `inventory.service.ts:515` y
  `sealed-product.service.ts:260`. El invariante de dinero de **IMP-1** («`effectiveMarketCents == null` ⟺ el
  alta acepta el precio manual») depende de que **ambas copias ordenen igual** (`orderBy [numberPrefix, numberSort]`).
- **Por qué importa:** **correcto hoy**, pero si una copia cambia el `orderBy` sin la otra, reaparece el
  dead-end de IMP-1 (o su inverso): una pieza podría quedar sin poder aceptar el manual, o aceptarlo cuando no
  debe. Al tocar dinero, el riesgo de divergencia es más caro que el de D-1.
- **Disparador / dirección de fix:** extraer a un helper compartido (`common/`) **antes** de que alguien edite
  una de las dos copias, para que el `orderBy` del ancla viva en un único sitio.

#### D-3 · Saneo de `PendingPriceEntry` legacy (clave vieja) no automatizado (Baja, backend)
- **Dueño:** backend. **Severidad:** Baja (no bloquea publicar; filas huérfanas de ruido en M2).
- **Deuda:** el fix de la cola M2 (commit `9b6a81b`) **detiene la creación** de filas legacy nuevas, pero las
  entradas ya escritas con la clave vieja (`gradeKey='sealed'`, `sealedProductId=null`) por altas previas al fix
  quedan `open` **para siempre**: `manualOverride` (`pricing.service.ts:1099`, que matchea por `gradeKey`) nunca
  las cierra con la clave de mercado. El propio código lo reconoce como residual en `pricing.service.ts:823`.
- **Por qué importa:** impacto bajo — la pieza **sí se publica** por la entrada de mercado; las legacy solo
  quedan como filas huérfanas `open` que ensucian la cola M2. No bloquea nada.
- **Disparador / dirección de fix:** script de saneo **idempotente** (o barrido puntual) que remapee/cierre las
  entradas legacy huérfanas pertenecientes a piezas con `sealedProductId`.

---

### Gate techlead P-48 / v2.0-pricing-curve (rama `claude/card-pricing-rules-2e537m`, 2026-08-24) — deuda del veredicto (APROBADO CON DEUDA ANOTADA, no bloqueante)

> El techlead **no rechazó el diseño** de la curva (la abstracción simplifica de verdad y la matemática
> vive en un solo sitio); rechazó tres huecos concretos, ya **corregidos con tests** en este mismo pase
> (guardarraíl ausente en `MasterSetService`, dos cuerpos en el eje de compra, y —vía arquitecto— el
> punto ciego del inventario ya `listed`). Lo de abajo es lo **menor no bloqueante** que se acepta
> anotado. Dueño de las tres: **backend**.

#### D1 · `resolvePendingReason` recibe la rareza CRUDA en cuatro de cinco call sites — **RESUELTA (2026-08-24)**
- **Dueño:** backend. **Severidad:** Baja hoy, **money-adjacent** (el parámetro gobierna un veredicto que bloquea dinero).
- **Deuda (como la reportó el techlead):** el parámetro se llama `rarityCanonical`, pero cuatro call sites le
  pasaban `card.rarity` **crudo** (`catalog:311`, `inventory:1179`, `orders:139`, `buylist:565`) y solo
  `master-set:817` pasaba `rarityCanonical ?? rarity`. Era inocuo **hoy** porque `isPremiumCanonicalRarity`
  normaliza por dentro; el riesgo era futuro: si alguien endurecía el predicado a canónica pura, cuatro caminos
  de dinero degradaban **en silencio** (una chase dejaría de estar protegida por el guardarraíl sin que nada
  fallara). Cinco call sites, un solo criterio.
- **Por qué se cerró en vez de anotarse:** el refactor del BLOQUEO 1 obligaba a tocar los cinco call sites de
  todos modos (el seam ahora **exige** la rareza en la firma), así que unificar costaba una línea por sitio.
  Los cinco pasan hoy `card.rarityCanonical ?? card.rarity`, que era el criterio del sitio «bueno».
- **Residual aceptado (Baja):** `rarityCanonical` puede quedar **stale** en BD si el catálogo cambió su
  normalización después de escribir la fila; el `?? rarity` cubre el caso `null`, no el caso obsoleto. Lo cura
  el backfill de normalización de rarezas (`unify-rarities`), no este seam.

#### D2 · Residuos de E8 (retiro «sin residuos» del modelo de reglas) (Baja, backend)
- **Dueño:** backend. **Severidad:** Baja (ruido/mantenibilidad; (b) es money-adjacent por naturaleza).
- **Deuda, en tres piezas:**
  - **(a) Códigos de error sin emisor.** `common/error-codes.ts:83` (`PREMIUM_RARITY_FIXED_TIER`) y `:87`
    (`UNKNOWN_RARITY`) siguen declarados, con comentarios que describen `PUT /admin/pricing/tier-map` — un
    endpoint que **ya no existe**. El contrato los declara **retirados en v2.0** y `grep` confirma que **nadie
    los emite**. Retirarlos toca el enum central (superficie de contrato) ⇒ pasa por el arquitecto (regla 9).
  - **(b) `computeSalePriceCents` (`common/money.ts:74`) está MUERTA y su `@deprecated` miente.** Solo la tocan
    dos specs (`be27-clamp-cents.spec.ts`, `money.spec.ts`); ningún código de producción la llama. Su
    `@deprecated` apunta a `computeSalePriceForRarity`, **que E8 borró**. Es la **única función que produce un
    precio de venta fuera de la curva**, así que dejarla viva es dejar una segunda puerta al dinero: o se retira
    o se justifica explícitamente. **Corrección de mi propia nota:** `docs/BACKEND_NOTES.md` §E8 afirmaba que
    «sigue en uso» — **es falso** y queda rectificado aquí y en esa nota.
  - **(c) Docstrings obsoletos** que describen el modelo retirado: `master-set.service.ts:924-931` (**ya
    corregido** en este pase, al reescribir `resolveBuyables`) y `rarity-catalog.ts:15-24,89,96` (pendiente).
- **Disparador / dirección de fix:** (a) y (b) juntos, en el próximo pase que toque `common/` — (b) requiere
  decisión explícita («se retira» vs «se justifica») porque toca la superficie de dinero; (a) requiere al
  arquitecto por ser el enum de contrato.

#### D5 · Dos criterios para la presencia del override POR PIEZA (`listPriceCents`) — **RESUELTA (2026-08-24, E5-bis)**
> Cerrada por el arquitecto en §4.36.6 (E5-bis) y ejecutada: `<= 0` es AUSENTE en los **seis** seams, con un
> **predicado único** (`hasManualPrice`/`isPresentAmount`/`firstPresentAmount` en `common/money.ts`) y validación de
> escritura `@Min(1)` en los cinco DTOs que escriben la columna. **Mi nota original listaba cuatro sitios y eran
> seis:** el quinto (`inventory:2211`) usaba `??`, que solo salta `null`/`undefined` y por tanto dejaba que un `0`
> enmascarara el `sellOverrideCents` de la variante; el sexto (`price-ingest:507`) lo abrió el propio bucle de
> reconciliación de E4-ter en este mismo pase — saltaba la pieza al repreciar, así que **nunca se reconciliaba**.
> Se deja el texto original abajo como registro de qué se corrigió.

#### D5 (texto original) · Dos criterios para la presencia del override POR PIEZA (`listPriceCents`) (Media, backend)
- **Dueño:** backend. **Severidad:** Media (**es dinero, y es divergencia observable entre superficies**).
- **Deuda:** la doctrina **H-1** («presente ⇔ `> 0`») está bien resuelta en `money.ts` para los overrides de
  **variante** (M-30) y para el **sellado**, pero el **peldaño 1** de la precedencia —el override por pieza— no
  la heredó: `orders.service.ts:98` exige `listPriceCents != null && > 0`, mientras `catalog.service.ts:274`,
  `master-set.service.ts:969` e `inventory.service.ts:1135` solo exigen `!= null`.
- **Efecto concreto de un `listPriceCents = 0`:** el **checkout** lo trata como AUSENTE y cae a la curva
  (cobra el precio derivado); el **storefront**, el **binder** y la **publicación** lo tratan como PRESENTE y
  resuelven a `0` ⇒ no vendible / `pending`. La misma pieza se comporta distinto en cada superficie, y la
  divergencia es justo del tipo que este pase acaba de cerrar en el eje de venta (un solo cuerpo, un solo
  criterio).
- **Por qué se anota y no se corrige aquí:** unificar cambia **comportamiento de dinero** en un peldaño de la
  precedencia normativa (§4.36.6) — hay que decidir cuál de los dos criterios es el correcto (`0` = ausente,
  como en H-1, es lo coherente) y eso es decisión del **arquitecto**, no un refactor de backend.
- **Disparador:** antes de operar con dinero real, o en cuanto aparezca una pieza con `listPriceCents = 0` en
  producción. Fix esperado: extender H-1 al peldaño 1 en un único predicado compartido, como ya se hizo con los
  otros dos niveles.

#### D6 · Detalles menores del gate (preferencia del techlead, no bloquean) — **RESUELTOS (2026-08-24)**
- `collectCurveViolations` (`pricing-curve.ts`) anunciaba en su JSDoc el orden «forma → V1 → V3 → V4 → V2»
  mientras el código evalúa V2 antes que V4: el docblock se corrigió al orden real.
- El test «el markup cambia peso a peso» (`pricing-curve.spec.ts`) fijaba `a - b < 200`, un umbral atado a la
  pendiente del seed vigente que se rompería por una razón **distinta** de la que el test quiere proteger
  (que no haya escalones). Se re-expresó contra la propiedad, no contra el número.

#### D7 · `reconcilePublishedPrices` escribe pieza por pieza (`await` secuencial) (Baja, backend)
- **Dueño:** backend. **Severidad:** Baja (aceptada; **anotar, no hacer** — petición explícita del techlead).
- **Deuda:** `price-ingest.service.ts` (bucle de E4-ter) hace un `await settlePendingForVariant(...)` **por pieza**,
  secuencial. En un **job nocturno** es perfectamente aceptable —el barrido no compite con nadie y la latencia no le
  importa a ningún usuario—, pero el patrón no debe copiarse a un camino de **request**.
- **Por qué se anota igual:** el riesgo no es este bucle, es que alguien lo tome como plantilla. Queda escrito para
  que la próxima lectura sepa que la tolerancia es del contexto (job), no del patrón.
- **Disparador / dirección de fix:** si alguna vez se llama desde un endpoint, agrupar por clave y cerrar/abrir en
  lote (`updateMany` por conjunto) en vez de N escrituras.

#### D8 · `batchQuote` sigue con `findUnique` + `getReference` por línea (Baja, backend)
- **Dueño:** backend. **Severidad:** Baja (aceptada).
- **Deuda:** `buylist.service.ts` `batchQuote` iza la curva y los overrides **en lote** (BE-25), pero cada línea sigue
  haciendo su `card.findUnique` y su `getReference`. `createRequest` ya cerró su N+1 de cartas en este pase.
- **Por qué ahora es barato:** desde el gate del techlead las **tres** superficies comparten `decideBuyLine`, así que
  batchear dentro de ese cuerpo es un cambio **local** — antes habría habido que tocar dos implementaciones y
  arriesgar que divergieran. La deuda se abarató por el propio refactor.
- **Disparador / dirección de fix:** pre-cargar cartas y referencias en lote en `batchQuote` (espejo de lo que ya hace
  `createRequest`) y pasarlas a `decideBuyLine`. Endpoint público y anónimo ⇒ vale la pena antes de tráfico real.

#### D9 · `GET /admin/reports/pricing-brackets` escanea sin cota (Baja, backend)
- **Dueño:** backend. **Severidad:** Baja (aceptada; admin-only). **La validación de fechas del mismo hallazgo SÍ se
  cerró** (v2.1.6): una fecha basura daba **500** y un rango invertido devolvía un reporte vacío indistinguible de «no
  hubo operaciones»; ahora las dos son `422` con el campo señalado, para todos los reportes que comparten `range()`.
- **Deuda:** `admin.service.ts` `pricingBrackets` hace `findMany` sobre **todos** los `OrderItem` liquidados (y todos
  los `SellRequestItem` pagados) del rango y agrega **en memoria**. Sin `from`/`to` eso es «todo el histórico».
- **Por qué NO se resolvió con un `take`:** un cap de filas **truncaría el agregado en silencio** y el reporte
  reportaría **menos dinero del que hubo** — que en un reporte de calibración es peor que tardar. Un límite que
  produce un número plausible pero falso es exactamente lo que este proyecto ha estado corrigiendo todo el pase.
- **Por qué tampoco una ventana por defecto:** cambiaría lo que devuelve una llamada sin filtros (hoy «todo»), y eso
  es superficie de contrato ⇒ decisión del arquitecto, no del implementador.
- **Dirección de fix:** agregar **en la base** con `groupBy(['marketBracket','priceBasis'])` + `_count`/`_sum`, que
  deja la memoria en O(brackets × basis) ≈ 30 filas sea cual sea el volumen y **no cambia ni un número**. Nota para
  quien lo tome: el eje de COMPRA suma `approvedPriceCents ?? quotedPriceCents`, un COALESCE que `_sum` de Prisma no
  expresa — ese eje necesita SQL crudo o dos sumas reconciliadas. Esa asimetría es la razón de que no entrara en el
  pase de seguridad.
- **Disparador:** cuando el histórico de operaciones deje de caber cómodamente en memoria, o antes de exponer el
  reporte a un rol con menos fricción que `super_admin`.

#### D10 · Endpoints que aún devuelven entidades Prisma sin forma declarada (Media, backend + arquitecto)
- **Dueño:** el **arquitecto** declara la forma; **backend** proyecta. **Severidad:** Media (no hay credenciales ni
  PII sensible en los que quedan; lo que hay es la **máquina** que produce cambios de contrato silenciosos).
- **Contexto:** v2.1.7 elevó a norma que *ningún endpoint devuelve una entidad Prisma directamente*. El arquitecto
  normó las **dos** rutas de §M2 y dejó a backend **auditar el resto**. Esta es esa auditoría, completa.
- **Ya cerrados en v2.1.7:** `GET /admin/pricing/card/:cardId`, `POST /admin/pricing/override` (rutas normadas) y
  `PATCH /admin/users/:id/status` — este último **devolvía `passwordHash`**, y se proyectó con el `select` que ya
  usaba `listUsers` (no hubo que inventar forma).
- **Pendientes, con archivo:línea.** Ninguno expone credenciales; todos comparten el defecto estructural:

  | Endpoint / servicio | Sitio | Entidad devuelta |
  |---|---|---|
  | `POST`/`PATCH /users/me/addresses` | `users.service.ts:81,91` | `Address` |
  | Seguimiento de pedido invitado | `guest-checkout.service.ts:291` | `Order` |
  | `PATCH /admin/inventory/items/:id` (y `move`/`mark`) | `inventory.service.ts:1642,1659,1678` | `InventoryItem` |
  | `POST /admin/inventory/locations` | `inventory.service.ts:2293` | `VaultLocation` |
  | `POST /buylist/requests/:id/respond` y transiciones admin | `buylist.service.ts:947,957,1109,1121` | `SellRequest` |
  | Transición de envío | `shipments.service.ts:564` | `ShipmentRequest` |
  | Transición de disputa | `disputes.service.ts:152,163` | `Dispute` |
  | KYC admin | `admin.service.ts:385` | `KycProfile` |

- **Por qué NO se proyectaron en este pase, y es deliberado:** el contrato **no declara** la forma de ninguna de
  esas respuestas — de hecho `AddressDTO` se **referencia** en §5 pero **nunca se define**. Proyectarlas ahora
  significaría que backend **inventa** ocho formas por su cuenta… que es **exactamente el «acuerdo tácito» que
  produjo B-1** y que esta misma revisión vino a erradicar. Hacerlo en vísperas del gate de release, además, mete
  riesgo de regresión en rutas de dinero (buylist, shipments, orders) sin ganancia de seguridad.
- **Disparador / dirección de fix:** el arquitecto declara los DTOs (o confirma que la entidad ES la forma
  contractual para cada caso) y backend proyecta contra lo declarado, con el patrón ya probado: **tipo declarado +
  builder anotado + test de conjunto exacto de claves sobre el JSON**. Prioridad sugerida por superficie:
  `guest-checkout` (semi-pública, con token) → `users/addresses` (PII de domicilio) → el resto (admin).

---

### Pase v2.1.9 (`claude/card-pricing-rules-2e537m`, 2026-08-24) — enrutado por el gate de release

> **D10 queda CERRADO por este pase.** La tabla de arriba listaba ocho sitios que devolvían entidades
> Prisma y argumentaba —correctamente en su momento— que proyectarlas significaría *inventar* formas sin
> contrato. Lo que cambió el cálculo es que dos de esos ocho **sí llevaban secreto**: `SellRequest`
> arrastra `clabeSnapshotEnc` (el blob AES-256-GCM de la CLABE) por cinco rutas —dos de ellas **al
> cliente**— y `KycProfile` arrastra `clabeHmac`, el *blind index* determinista. Con eso, «esperar al
> contrato» dejó de ser prudencia y pasó a ser exposición. Los seis restantes se proyectaron **fijando
> la forma ACTUAL** (lista blanca de las columnas que ya viajaban): cero cambio visible, cero forma
> inventada, y la columna sensible de mañana ya no se auto-publica. La norma quedó además **mecanizada**
> en `test/no-raw-entity-response.spec.ts` (barrido de `src/` + marca `PROJECTION-EXEMPT: <motivo>`).

#### D-a · `pricing.declared-shapes.spec.ts` enuncia la norma en absoluto y se cumple en 3 de 11 rutas (Baja, backend)
- **Dueño:** backend. **Severidad:** Baja (aceptada; documental, no funcional).
- **Deuda:** el docstring de `test/pricing.declared-shapes.spec.ts:8-9` dice que los DTOs de `§M2` están
  declarados **como norma general**, pero el spec cubre **3** de las ~11 rutas del módulo. Quien lo lea
  concluye «cerrado» y no lo está.
- **Por qué importa aunque sea documental:** un candado que **parece** universal desactiva la búsqueda.
  Es la misma mecánica que hizo que la norma de «ningún endpoint devuelve una entidad Prisma» viviera
  dos releases aplicada a dos sitios.
- **Dirección de fix:** acotar el enunciado a lo que el spec realmente cubre y **referenciar D10** (y
  esta entrada) para el resto. Si se prefiere ampliar la cobertura en vez de acotar el texto, el patrón
  ya está probado: tipo declarado + builder anotado + conjunto exacto de claves sobre el JSON.
- **Disparador:** el próximo pase que toque `§M2`.

#### D-b · Proyección de usuario duplicada en `admin.service.ts` (Baja, backend)
- **Dueño:** backend. **Severidad:** Baja (aceptada).
- **Deuda:** `listUsers` (`:201`) y `updateUserStatus` (`:421`) declaran el **mismo `select` literal**
  (`id,email,name,role,status,createdAt`). Sólo `:421` tiene test (`no-raw-entity-response` + el de
  v2.1.7), así que la copia de `listUsers` puede derivar sin que nada lo note.
- **Por qué no se extrajo en este pase:** el pase ya toca nueve archivos de proyección; meter un
  refactor cosmético en `admin.service` junto al fix de PII de R1 mezcla dos revisiones distintas en el
  mismo diff. La duplicación es **literal e idéntica hoy** (verificado), así que no hay divergencia viva.
- **Dirección de fix:** extraer `ADMIN_USER_SELECT` + `toAdminUserDTO` (espejo de `ADMIN_KYC_SELECT` /
  `toAdminKycDTO`, que este pase sí introdujo) y apuntar las dos rutas ahí.
- **Disparador:** al añadir o quitar cualquier columna de la proyección de usuario — que es justo cuando
  la duplicación cobra.

#### D-c · Seis re-derivaciones de enums que puentean `enum-values.ts` (Baja, backend)
- **Dueño:** backend. **Severidad:** Baja (aceptada).
- **Deuda:** `Object.values(<PrismaEnum>)` re-derivado en `catalog.service.ts:23-26`,
  `variant-controls.service.ts:46` e `inventory.controller.ts:44-45`, en vez de importar de
  `common/enum-values.ts`. Además `SEALED_SUBTYPE_KEYS` (`settings.constants.ts:192`) se exporta como
  **`string[]` mutable**, no `readonly`.
- **Impacto real hoy: ninguno** — derivan del mismo enum, así que el valor es idéntico. Lo que se pierde
  es el **punto único**: el docstring de `enum-values.ts` (que explica clase E vs clase R, y por qué
  `RawCondition` salió de ahí) no se lee en un `Object.values` suelto. Ahí es donde se toma la decisión
  equivocada la próxima vez.
- **Nota:** `catalog.service.ts:24` **sí se corrigió** en este pase, pero por otra razón: era el filtro
  público de condición y pasó a `ACCEPTED_RAW_CONDITIONS` (clase R, D4). Las otras cinco siguen.
- **Dirección de fix:** importar de `common/enum-values.ts` y tipar `SEALED_SUBTYPE_KEYS` como
  `readonly string[]`.
- **Disparador:** el próximo enum que crezca (el ancla de `enum-values-parity.spec.ts` obligará a pasar
  por ahí de todos modos).

#### D-d · El escáner de residuo de enums escanea LÍNEA POR LÍNEA (Media, backend)
- **Dueño:** backend. **Severidad:** Media (aceptada; es un candado con un punto ciego conocido).
- **Deuda:** `test/enum-values-parity.spec.ts` (bloque «residuo») detecta una lista escrita a mano
  exigiendo **≥2 valores del enum en la MISMA línea**. Un `@IsIn([...])` con **un valor por línea** —muy
  plausible con siete valores y un formateador de por medio— lo **evade entero**.
- **Por qué no se cerró aquí:** el pase ya reescribió ese archivo para quitar la tautología de la
  paridad y montar las tres bandas (schema ⇄ `enum-values.ts` ⇄ contrato). Cambiar además el motor del
  escáner a AST (o a ventana multilínea) es un segundo cambio con su propia superficie de falsos
  positivos, y mezclarlo habría hecho ilegible qué fijó qué.
- **Dirección de fix:** escanear sobre el **statement** (unir líneas hasta equilibrar corchetes) en vez
  de la línea, o pasar a AST. Referencia de estilo: el barrido de `no-raw-entity-response.spec.ts` ya
  hace balanceo de paréntesis para leer un statement completo.
- **Disparador:** antes de confiar en ese candado para un enum nuevo, o si aparece un `@IsIn` multilínea.

#### D-e · `GROUPED_LISTING_KEYS` duplicado sin vínculo con la interfaz — **CERRADO en este pase**
- Vivía a mano en dos specs. Ahora se deriva con `Record<keyof DTO, true>` en `test/helpers/dto-keys.ts`:
  añadir un campo al DTO y no declararlo **no compila**. Se anota como cerrado para que la referencia
  del techlead no quede huérfana.

#### D-f · `sealed-catalog.service.ts:104` interpola la clave de variante a mano (Baja, backend)
- **Dueño:** backend. **Severidad:** Baja (aceptada).
- **Deuda:** `refs.get(`${item.cardId}|sealed|${gk}|normal`)` construye la clave `K` **a mano** en vez de
  usar `variantKey()` — el helper que P-30 H2 introdujo precisamente porque la interpolación estaba
  repetida en tres sitios de `catalog.service.ts` y podía derivar en silencio.
- **Por qué es sutil:** el consumidor y el **productor** de ese mapa (`getReferencesBatch`) deben llavear
  con el MISMO cuerpo. Si `variantKey()` cambia (un separador, un orden), este sitio no lo sigue, el
  `get` devuelve `undefined` y el efecto es **un sellado que aparece sin valor de mercado** — un fallo
  silencioso de precio, no un error.
- **Dirección de fix:** `variantKey({ cardId, productType: 'sealed', gradeKey: gk, finish: 'normal' })`.
  Cambio de una línea; no entró aquí para no mezclar un refactor de llaves con el recorte de D2 sobre
  los mismos DTOs.
- **Disparador:** cualquier cambio a `common/variant-key.ts`, o el próximo pase que toque el sellado.

#### S49-B2 · Los 3 endpoints `@Public` de catálogo leen sin `take` y paginan en memoria (Media, backend)
- **Dueño:** backend. **Severidad:** Media (aceptada). **Juzgado explícitamente: NO es barato de
  arreglar, y el arreglo «barato» sería peor que la deuda.**
- **Deuda:** `catalog.service.ts` `fetchSellable` y `sealed-catalog.service.ts` `loadPricedSealed` hacen
  `findMany` **sin `take`** y luego `slice()` en memoria. Alimentan `GET /catalog/cards`,
  `GET /catalog/facets` y `GET /catalog/sealed` — los tres **anónimos**. El coste por request crece
  **lineal con el inventario publicado, independientemente de `pageSize`**.
- **Por qué NO se puede empujar el `take` a SQL:** el `salePriceCents` **no está persistido** — se
  resuelve **en LECTURA** con la curva vigente, y eso es una decisión deliberada (§4.36.9c: mover un
  punto de la curva repricia sin republicar nada). Como consecuencia, las tres operaciones que definen
  la página —**agrupar** por `K=(cardId,productType,gradeKey,finish)`, **filtrar** por
  `minPriceCents`/`maxPriceCents` y **ordenar** por precio— dependen de un valor que la base no conoce.
  Un `take` en la query paginaría **piezas**, no **grupos**, y aplicaría el filtro de precio sobre un
  subconjunto arbitrario: la página saldría **incompleta y con precios filtrados mal**.
- **Por qué tampoco un cap de seguridad (p. ej. `take: 5000`):** truncaría el catálogo **en silencio**.
  Inventario publicado que no aparece en Compra es inventario que **no se vende**, y un fallo silencioso
  de visibilidad de dinero es peor que un coste alto — es la misma regla por la que D9 rechazó su cap.
- **Mitigación vigente:** superficie de sólo lectura, sin escrituras ni escalada de pendientes (doctrina
  v1.12 de anónimos), tras el throttler global (300/min) y con el fan-out más caro (`quote/batch`) ya
  acotado a 12/min por B-C1.
- **✅ DICTAMEN DEL ARQUITECTO — `ARCHITECTURE §4.36.9(e)` (2026-08-24).** La escalada se resolvió y el
  invariante queda **fijado**, así que quien lo retome **no discute desde cero**:

  > Una proyección persistida puede gobernar el **ORDEN**, el **FILTRO** y la **PAGINACIÓN**.
  > Nunca el precio que se **COBRA**.

  O sea: persistir una **clave de orden invalidable** (para `ORDER BY`, rango de precio y corte de
  página) **NO** revierte §4.36.9c, **mientras** el `salePriceCents` del DTO, del carrito y del
  checkout se sigan resolviendo **en lectura**. La asimetría que lo decide es la que motivó negarse a
  la solución barata: una **clave rancia** pone una carta unas posiciones fuera de sitio —invisible y
  recuperable—; un **precio rancio cobra mal**, y eso es **irreversible** en cuanto alguien paga.
- **Corolarios que fijó el dictamen** (condiciones de la solución, no sugerencias): la clave se
  **invalida en los mismos seams que ya reprician**; **puede estar rancia sin romper nada** (esa
  tolerancia es justo lo que la hace admisible); y **no se emite en ningún DTO** — en cuanto un cliente
  pueda leerla, alguien la usará para pintar un precio, y ahí se pierde la garantía entera.
- **Dirección de fix (real, no barata):** persistir esa **clave de orden** con su invalidación, y recién
  entonces paginar/ordenar/filtrar en SQL. **NO** persistir el precio que se cobra. El diseño concreto
  vuelve por el **arquitecto** cuando toque (el invariante ya está; falta la forma).
- **Disparador:** cuando el inventario publicado supere ~5k piezas, o antes de exponer Compra a tráfico
  no autenticado real (lo que ocurra primero). Medir primero: `fetchSellable` con `EXPLAIN ANALYZE` y el
  p95 de `GET /catalog/cards` bajo carga.

### Ronda de corrección del gate QA + techlead + rev v1.50.3 del arquitecto (rama `claude/psa-graded-card-value-gmhv5u`, 2026-08-28) — deuda del pase (dueño: **backend**, no bloqueante)

> Todos los hallazgos enrutados a backend en esta ronda **se arreglaron en el pase** (bloqueante de
> auditoría, `runBackground`, renumeración, las dos escaladas del ingest, los menores del techlead, y los
> cuatro puntos de la rev v1.50.3 del arquitecto). Lo que queda aquí es lo que **NO** se arregló, con el
> porqué y el disparador.

#### PI-D1 · `resolveCardId` sigue haciendo 1-3 queries POR FILA en el ingest de MERCADO (Media, backend)
- **Dueño:** backend. **Severidad:** Media (aceptada).
- **Deuda:** el techlead señaló el N+1 del bucle del ingest de **estimados** y ahí **se cerró**
  (`buildGradedCardIndex` + `resolveGradedCardId`, resolución en memoria, cero queries en el bucle). El
  ingest de **MERCADO** (`PriceIngestService.ingestSet`, `price-ingest.service.ts:~437`) sigue llamando
  al `resolveCardId` por-fila: `findUnique` por `externalId` → `findFirst` por `(setId, number)` →
  `findMany` por variantes del número. Un set de 250 cartas puede costar hasta ~750 round-trips.
- **Por qué NO se hizo en este pase, y no es pereza:** son dos diferencias reales, no una repetición.
  (1) El ingest de estimados tenía el conjunto **ya materializado en memoria** (`allowed` por set) y
  acotado por el tope de cuota; el de mercado resuelve contra **todo el set** y en scope `full` no tiene
  un conjunto permitido, así que el índice hay que **traerlo** — es una query nueva y una decisión de
  memoria, no un `Map.get` gratis. (2) Es la ruta que escribe el **precio de venta** de todo el
  catálogo: cambiar su resolución carta↔proveedor es tocar dinero en el mismo diff en el que se están
  corrigiendo otras cinco cosas del gancho, y ninguna revisión posterior podría separar qué rompió qué.
- **Dirección de fix (probada ya):** el patrón está implementado y con tests en el gancho — un índice por
  set (`byExternalId` / `byNumber` con desempate por `cardNumberVariants`, ambigüedad ⇒ se omite) y un
  resolver **puro** que recibe el logger como callback. Portarlo es mecánico; lo que hay que decidir es
  de dónde sale el índice cuando el scope es `full`.
- **Disparador:** el próximo pase que toque `ingestSet`, o si el tiempo de una corrida de precios se
  vuelve un problema operativo (medir primero: nº de `card.findUnique` por corrida).

#### PI-D2 · ~~El gate de EVIDENCIA deja al shape S2 sin poder escribir~~ → **RESUELTO por dictamen** (v1.50.3-a)
- **Dueño:** arquitecto (decidió), backend (implementó). **Estado: CERRADO como decisión de diseño.**
- **Desenlace (§4.38h.1-bis):** **S2 queda declarado NO PERSISTIBLE** y **no se añade una segunda
  escotilla**. S2 no es «un S1 degradado»: el escalar no trae **ni `count` ni fecha**, o sea ninguna de
  las dos piezas de evidencia con las que se calculan las pruebas 1 y 2 del gate de confianza ⇒ es
  **estructuralmente incapaz** de pasarlas, y ninguna configuración lo arregla porque **no hay nada que
  configurar**. Tampoco existe superficie donde una fila S2 fuera admisible (la ficha es más permisiva
  en **magnitud**, no en procedencia), así que persistirla sería basura en una tabla de dinero.
- **Corrección al planteamiento original, del arquitecto:** **S2 tampoco era persistible antes de
  v1.50.3** — sin `count`, el punto 2 del gate ya quedaba *desconocido* ⇒ fail-closed. El único camino a
  la BD era la escotilla, y una escotilla es *aceptar un riesgo a sabiendas*, no una vía normal. El
  parser **ya era «de una hipótesis y media»**; v1.50.2 no lo decía en voz alta.
- **Implementado:** `POKEMONPRICETRACKER_GRADED_MIN_COUNT` **retirada del código** (una escotilla que no
  abre nada es peor que ninguna: alguien la pone, no ve cambio y concluye que el ingest está roto);
  sondeo de S2 **conservado** como **diagnóstico** con motivo propio `shape_not_persistible_s2`,
  contador `skippedShapeS2` **aparte**, y veredicto de corrida
  `shape_not_persistible_s2_dominant` cuando `s2 > s1`.
- **Lo que queda vivo, y NO es deuda de código:** si la primera corrida real emite ese veredicto, es
  **escalada obligatoria al arquitecto** (regla 9) — significa que la fase 2 **no es viable con este
  proveedor**, y la decisión es de producto y de costo. Ver PI-D5.

#### PI-D3 · Los tres seeds corregidos NO llegan a una BD ya sembrada (Media, **operativa — devops**)
- **Dueño:** **devops** (ejecuta), backend (lo documenta). **Severidad:** Media.
- **Deuda:** `prisma/seed.ts` upsertea `SETTING_DEFAULTS` con **`update: {}`** (no pisa ediciones del
  admin), así que la corrección de v1.50.3 —`manualFreshnessDays` `null`→30, `minSampleCount` 3→5,
  `maxRawMultiple` 50→100— **solo aplica a bases nuevas**. Verificado en vivo: el E2E del criterio 109
  falló contra el stack local hasta fijar el dial explícitamente.
- **Por qué NO se automatizó como migración:** un `UPDATE` incondicional destruiría exactamente lo que
  `update: {}` protege (la decisión del dueño). Un `UPDATE` condicionado a «solo si vale el valor viejo»
  es indistinguible de pisar una elección deliberada de 50×.
- **Dirección de fix (v1.50.3-a, §4.38p + §11.0): NO es un `UPDATE`.** Es el paso de despliegue
  explícito por la **vía normal de operación**: `GET /admin/pricing/graded-estimates` para ver lo
  vigente y, si coincide con los seeds viejos, **un** `PUT` con los tres valores. Queda **auditado**
  (`AuditLog`, M10), **validado** (I1–I9) y surte efecto **sin redeploy**. Si alguno difiere, el
  operador lo ajustó a propósito y **decide él, clave por clave**. ⚠️ **Prohibido `UPDATE` directo a la
  BD:** se salta auditoría, validación (una clave presente-e-inválida **apaga la feature**) y bitácora.
- **Ratificado por el arquitecto:** no se automatiza porque `ConfigSetting` guarda un **valor**, no su
  **procedencia** — «sigue en el seed viejo» y «el operador lo eligió así» son el mismo dato, y `3`,
  `50` y `null` son elecciones plausibles. Inferirlo del `AuditLog` se **descartó**: falla abierto y en
  silencio ante una poda. La regla general quedó en **§11.0**.
- **Detector implementado por backend (v1.50.3-a/b):** `SettingsService.onModuleInit()` emite **una**
  línea `log` de **inventario de configuración** (clave + vigente + default) y **siempre**, con
  `SIN DIVERGENCIAS` explícito cuando no hay ninguna. Con el E2E descartado como detector de
  configuración (§11.0 punto 5), esta línea y el `GET` son **los dos únicos detectores del seed rancio**.
- **Disparador:** **antes** de dar por cumplidos los criterios 109 y 111(a)/(c) en cualquier entorno que
  ya haya corrido el seed. Es requisito de release, no de código. **Va al humano como GU-13** (el paso 3
  es una decisión suya).

#### PI-D5 · Riesgo de PROVEEDOR ÚNICO para la fase 2: si PPT sirve S2, no hay sustituto (Media, **producto/costo**)
- **Dueño:** **arquitecto/producto** (decide), backend (detecta e informa). **Severidad:** Media.
- **Riesgo:** **solo PPT** puede entregar PSA — verificado que TCGCSV y pokemontcg.io tienen eje de
  **acabado**, no de **grado**, así que no son sustitutos ni degradados. `PokeTraceProvider` está
  declarado y **nunca implementado**, y no hay evidencia de que exponga PSA (diseñar contra eso sería
  reincidir en **P-6**). Si PPT sirve **mayoritariamente S2**, la fase 2 **no es viable con este
  proveedor**.
- **Detección implementada (§4.38h.1-bis):** el job emite `escalation.reason =
  shape_not_persistible_s2_dominant` (+ `logger.error` + `AuditLog`) cuando `shapeCounts.s2 >
  shapeCounts.s1` en la corrida. Umbral de **mayoría estricta** a propósito: una escalada dispara una
  decisión de arquitectura y presupuesto, así que tiene que **poder sostener su veredicto**.
- **Qué NO se hace al verlo:** ni escotilla, ni dial nuevo, ni `count` inventado. **Vuelve al
  arquitecto** (regla 9). Las opciones —degradar a manual de forma permanente, buscar un segundo
  proveedor, o pagar el plan que exponga `salesByGrade`— son de **producto y de costo**.
- **Impacto hoy: ninguno** (el dial del gancho —v1.51: `grading_hook_enabled`— tiene seed `off`). **No hay acantilado detrás:**
  la degradación a manual ya está diseñada, aceptada y funcionando — es el estado de v1.50. Se pierde la
  **automatización** de la feature, no la feature.
- **Disparador:** la primera corrida real del ingest.

#### PI-D4 · `preview` y `review` divergen en el corte por `FEATURE_OFF` (Baja, backend)
- **Dueño:** backend. **Severidad:** Baja (aceptada; la divergencia es **deliberada** y está documentada
  en §4.38n.3).
- **Deuda:** el `preview` corta en `FEATURE_OFF` y la **lista de revisión** no (evalúa igual con el dial
  apagado, forzando `estimatesEnabled`/`highlightEnabled` a `true` sobre la config real). Son dos
  comportamientos distintos de la misma función pura, y quien lea uno puede asumir el otro.
- **Por qué la asimetría es CORRECTA y no se unificó:** la lista existe para **limpiar los datos antes**
  de encender la afirmación comercial; si solo funcionara encendida, obligaría a **publicar las cifras
  malas para poder descubrirlas**. El `preview`, en cambio, responde «¿por qué no está destacada?» y
  `FEATURE_OFF` **es** una respuesta correcta a esa pregunta. Unificarlos empeoraría uno de los dos.
- **Dirección de fix (si se decide):** el arquitecto lo dejó como «candidato de limpieza posterior» —
  parametrizar el corte del dial en las puras (`ignoreFeatureFlag`) en vez de forzar la config desde el
  caller, que es lo que hoy hace `gradedEstimateReview`. **No** unificar el comportamiento.
- **Disparador:** una tercera superficie que necesite el mismo cálculo con otra política de dial.

### Ronda de corrección v1.50.3-c (QA + techlead) (rama `claude/psa-graded-card-value-gmhv5u`, 2026-08-28) — deuda del pase (dueño: **backend**, no bloqueante)

> Los tres hallazgos enrutados a backend en esta ronda **se arreglaron en el pase** (los cuatro
> comentarios derogados de `graded-estimate.ts`, la recuperación de `STALE` en el diagnóstico, y las dos
> guardas de la escalada por shape), junto con los cinco menores. Se escalaron dos cosas al arquitecto
> (regla 9) y **las dos volvieron resueltas en el commit `515a4be`**, implementadas en el mismo pase; lo
> que sigue abierto aquí es solo la calibración de PI-D7.

#### PI-D6 · ~~La lista de revisión sigue sin poder ENUMERAR una cifra caducada~~ → **RESUELTA** (v1.50.3-c, commit `515a4be`)
- **Estado: CERRADA.** El arquitecto aceptó la propuesta **tal cual** (GU-A24, §4.38n.2-bis) y declaró
  el `400` un **error de diseño propio**: había agrupado `STALE` con la «ausencia de dato» cuando es lo
  contrario —**un dato que existió y expiró**—, y en §4.38(m) había escrito que la lista era la
  superficie donde el dueño ve lo que le vence **normando a la vez el rechazo de esa consulta exacta**.
  Agravante que él mismo señala: la categoría **la creó esa misma revisión** al sembrar
  `manualFreshnessDays = 30` (antes era el conjunto vacío).
- **Implementado por backend en el mismo pase:** `STALE` opt-in en `?reason=` (nunca default),
  `isManual: boolean` en los DTO de diagnóstico (`isManual` sí, `source` no) y `capturedDate` asc
  intercalado en el orden (lo más vencido primero, `null` al final). Ver `BACKEND_NOTES` §0.7.1.
- **Lo que queda vivo y NO es deuda:** la vista de **«próximo a vencer»** (`caduca en N días`) quedó
  **declarada fuera de alcance** por el arquitecto en §4.38(n.4) —exige una ventana parametrizable, o
  sea alcance nuevo—, con el mismo trato que «marcar como revisada». Si el dueño la pide, es decisión de
  producto + arquitecto.
- *(Registro original de la escalada, conservado para trazabilidad:)*
- **Dueño:** **arquitecto** (decidió), backend (implementó). **Severidad:** Media. **Escalado por regla 9.**
- **Qué SÍ quedó arreglado en este pase:** `preview` volvió a emitir `STALE` / `stale: true` /
  `capturedDate` / el monto de la fila caducada (antes respondía `NO_PSA10` + `capturedDate: null`, o
  sea «nunca la capturaste» sobre una cifra que sí existía). `review` calcula ahora con esa misma
  verdad: los ítems que emite llevan `stale` y `capturedDate` resueltos contra la fila real.
- **Lo que NO se puede cerrar sin tocar el contrato:** API_CONTRACT §M2 declara que en
  `GET /admin/pricing/graded-estimates/review` cualquier `reason` fuera de `NOT_ABOVE_RAW |
  ABOVE_MAX_MULTIPLE | GRADE_ORDER_INVERTED | SLAB_PUBLISHED` ⇒ **`400 VALIDATION_ERROR`**, y `STALE`
  está nombrado explícitamente entre los rechazados. Como el orden de razones de la pura es AUSENCIA →
  FRESCURA → coherencia, una carta con cifra caducada resuelve a `STALE` y **queda fuera de toda consulta
  posible**: la lista que existe para «sacar a flote lo que hay que mirar» no puede mostrar la cifra
  expirada.
- **Por qué importa:** «captura una cifra» y «refresca la que tienes» son remedios **opuestos**, y el
  bucle operativo del criterio 109 es precisamente *recapturar*. Una cifra caducada es trabajo pendiente
  del operador con la misma legitimidad que una incoherente.
- **Dirección de fix propuesta (NO implementada):** admitir `STALE` como valor **opt-in** del filtro
  `reason`, igual que `SLAB_PUBLISHED` — **nunca** en el default, porque ahogaría la señal de coherencia
  (mismo argumento que ya se aplicó a `SLAB_PUBLISHED`). Coste en backend: una constante
  (`GRADED_REVIEW_ALLOWED_REASONS`) y sus tests. Cero cambios de DTO, de query y de cálculo.
- **Disparador:** decisión del arquitecto. **Llegó en `515a4be`: aceptada e implementada** (ver arriba).

#### PI-D7 · El suelo de muestra de la escalada por shape (Baja, backend) — **AJUSTADO por el arquitecto** (v1.50.3-c, `515a4be`)
- **Dueño:** backend. **Severidad:** Baja (aceptada). **Estado: el defecto de alcanzabilidad está CERRADO;
  la calibración del número sigue abierta.**
- **Lo que se corrigió (GU-A25, §4.38h.1-ter):** mi suelo **absoluto** de 5 tenía **el mismo bug que el
  `STALE` inalcanzable** de PI-D6 — con alcance «solo cartas publicadas», una tienda con **3 cartas** no
  llegaría nunca a 5 y la fase 2 moriría en silencio con su propio aviso apagado. Ahora: **(A)**
  `S1 == 0 && S2 >= 1` escala **sin suelo**; **(B)** `S2 > S1` con suelo **`min(5, cartas en alcance)`**.
- **Lo que queda como deuda (Baja):** el **5** sigue siendo un número **elegido, no medido**. Este job
  barre lo que hay, no muestrea, así que no hay significancia que calcular; se eligió bajo a propósito
  porque el defecto opuesto —silenciar un cambio de shape real— es peor, y por debajo del suelo la señal
  **se informa con `warn`** en vez de perderse. Sigue siendo **constante de código, no dial**
  (§4.38h.1-ter: se calibra una vez).
- **Disparador:** la primera corrida real del ingest con `grading_hook_enabled = on` (v1.51: es el mismo acto que encender la feature). Si el
  `warn` de «no se escala por muestra corta» aparece de forma sostenida sobre corridas de alcance normal,
  el número está mal calibrado y ahí sí habrá datos para elegirlo.

### Cierre del stream del gancho de grading — IMP-A / IMP-B / D3 / D5 / D6 (rama `claude/psa-graded-card-value-gmhv5u`, 2026-08-29) — deuda del pase (dueño: **frontend**, no bloqueante)

> Los cinco hallazgos del cierre se **arreglaron en el pase** (higiene de credenciales del arnés,
> `@real` del borrado, guardarraíl de `bare`, candado anti-regresión reescrito y la errata de copy).
> Lo que queda aquí es lo que **no depende de mí**, escrito para que no se pierda.

#### GR-D1 · El opt-in `STALE` y el origen `ingest` de la lista de revisión no tienen cobertura `@real` (Baja, frontend — bloqueada por DATO de seed)
- **Dueño:** frontend (el test), **desbloquea:** backend (`prisma/seed-e2e.ts`). **Severidad:** Baja.
- **Qué falta:** el smoke de «lo caducado se puede pedir y se distingue su origen» sigue `mockOnly`.
  Una cifra **caducada** exige una `capturedDate` anterior a `manualFreshnessDays`, y una de origen
  **automático** exige `isManual:false`. **Ninguna de las dos se puede fabricar por la API del
  contrato**: `POST /admin/pricing/override` escribe siempre manual y con fecha de hoy. No es una
  limitación del test —está escrito agnóstico— sino la ausencia del dato.
- **Lo que SÍ quedó cubierto en real:** el **borrado** de punta a punta a nivel UI, con el gesto del
  operador y verificación por contrato (`preview` + segundo `DELETE` ⇒ `404` + grado auxiliar intacto).
- **Disparador:** dos filas en el seed sintético — una `PriceReference` `graded:PSA:*` con
  `capturedDate` vieja y otra con origen ingest. El test pasa tal cual el día que existan.

#### GR-D2 · Falta una CUARTA carta raw publicada y libre en el seed (Baja, frontend — bloqueada por DATO de seed)
- **Dueño:** frontend (el test), **desbloquea:** backend. **Severidad:** Baja.
- **Qué falta:** el escenario real ya consume las tres raw publicadas (`curated`, `informed` y
  `deletable`, esta última elegida **sin slab publicado** para que el `DELETE` no choque con INV-D).
  El caso «dos grados con dato y SIN destacar» necesita una cuarta y sigue `needsSeed`.
- **Disparador:** una cuarta carta raw publicada en `seed-e2e.ts`. El test no cambia.

#### GR-D3 · La suite E2E no purga los estimados que siembra (Media→Baja, frontend — decisión, no olvido)
- **Dueño:** frontend. **Severidad:** Baja (mitigada). **Estado: aceptada.**
- **Qué pasa:** el arnés siembra `PriceReference` de estimado en `curated`/`informed` y **no** las
  retira en el `globalTeardown`, aunque el `DELETE` del contrato ya existe y ya está cableado en el
  cliente. **Motivo:** el módulo **no puede distinguir** la fila que escribió él de la que trae el seed
  —la clave canónica es la misma— y una purga indiscriminada se llevaría dato del entorno por delante.
- **Mitigación vigente (por qué es Baja):** la siembra es **idempotente** (un override posterior
  supersede al anterior), el dial vuelve a `off` en el teardown ⇒ **nada de lo sembrado se publica**, y
  contra el residuo de una corrida cuyo teardown no llegó a correr los **guardarraíles** de `informed`
  y `bare` fallan con el remedio literal («borra esto con este endpoint») en vez de con un rojo de UI.
  El único caso que sí se limpia solo es el del smoke de borrado, que retira lo que siembra.
- **Disparador para cerrarla:** que el arnés pueda marcar sus propias filas (p. ej. una carta de seed
  reservada al E2E cuyo estimado sea siempre desechable). Es alcance nuevo, no un arreglo.

### Última pasada de M-46 (§22.14 + los dos candados burlados) — rama `claude/psa-graded-card-value-gmhv5u`, 2026-08-31 (dueño: **frontend**, no bloqueante)

#### GR-D4 · El `findAllByRole` del botón «Refrescar variantes y precios» es INESTABLE en suite completa (Media→Baja, frontend — **fuera del stream que la anotó**)
- **Dueño:** frontend. **Severidad:** Baja (test, no producto). **Estado: abierta, ticket propio.**
- **Qué pasa:** el test `M2 · jerarquía por-fila (§19.4) › I y G son botones directos…` falla de
  forma intermitente en la **suite completa** —QA lo vio caer **1 de 2 corridas**, en el
  `findAllByRole` del botón «Refrescar variantes y precios de {set} usando solo TCGCSV»— y **pasa
  3/3 aislado**. En la corrida de cierre de este pase (842/842) **no se reprodujo**: es intermitente,
  no determinista, y esto es lo único que se puede afirmar hoy.
- **Hipótesis (no verificada, y se anota como hipótesis):** `M2View` monta muchas queries a la vez y
  el `findAllByRole` corre con la ventana por defecto de `waitFor` (1 s). Bajo la carga de la suite
  completa esa ventana se puede agotar antes del render. Si es eso, el arreglo es del **test**
  (esperar por un hito estable de la vista, o subir el timeout de ese `find*`), no del componente.
- **Por qué no se arregla aquí:** **ningún commit de este pase toca `M2View.tsx` ni
  `M2View.test.tsx`**. Tocar un archivo ajeno al stream para «dejarlo verde» es exactamente cómo un
  flake se convierte en un cambio sin revisar. Va como ticket propio de frontend.
- **Disparador para cerrarla:** reproducir el rojo con `--repeat` o `--sequence.shuffle` sobre la
  suite completa, confirmar (o descartar) la hipótesis del timeout y arreglar el test en su rama.

> **Addendum (2026-09-01, pase §41) — segundo avistamiento, y el alcance de la ficha se GENERALIZA.**
> En una corrida completa del pase de copy cayó
> `M2 · «Refrescar variantes + precios (solo TCGCSV)» por set (P-13) › money-safe: si TCGCSV no fue
> alcanzable del todo (tcgcsvReachable=false) avisa resultado parcial` (**`M2View.test.tsx:794`**). El
> archivo pasó **65/65 aislado** y las corridas completas siguientes dieron verde.
>
> **Es un `it` DISTINTO del que nombraba esta ficha**, y en otro `describe`: lo registrado era
> `:718`/`:722` («jerarquía por-fila §19.4»). La hipótesis del timeout **sí transfiere**, porque los dos
> usan el **mismo** `findAllByRole` del botón «Refrescar variantes y precios de {set} usando solo
> TCGCSV» — ese selector aparece **7 veces** en el archivo, **4 de ellas dentro de un `find*ByRole`**.
>
> Por eso el alcance deja de ser «el test de `:722`» y pasa a ser **«el `findAllByRole` del botón
> Refrescar, compartido por ≥3 tests del archivo»** (de ahí el título nuevo). **Dos avistamientos sobre
> el mismo selector en dos tests distintos refuerzan la hipótesis** y descartan que sea una peculiaridad
> de un `it` concreto. Quien la investigue debe atacar el **selector compartido**, no perseguir una sola
> línea — que es justo lo que la ficha anterior le habría hecho hacer.
>
> Sigue **sin arreglarse aquí y por la misma razón**: el pase §41 no toca `M2View.tsx` ni
> `M2View.test.tsx`, y están fuera de su stream.

### Cierre del pase de la rotación del carrusel (§23) — rama `claude/tcg-hunt-orchestrator-28p7z1`, 2026-08-31 (dueño: **frontend**, no bloqueante)

#### FR-C1 · La ventana de 1200 ms de §23.5a se arma con entradas que NO desplazan la pista — el riesgo es el FALSO POSITIVO (Media-baja, frontend + ux-ui)
> ⚠️ **ACTUALIZADA el 2026-08-31 tras `bb3fb2c` (a petición del techlead, con el hallazgo de QA).** La
> ficha original decía «no bloqueante: hoy no hay ni un reporte y **WCAG 2.2.2 sigue cumplido por el
> conmutador, que es visible y opera**», y su disparador era «que QA o soporte vean **el conmutador en
> REANUDAR** sin intervención». **Las dos cosas son falsas desde `bb3fb2c`**: el conmutador se retiró
> (decisión del dueño, `DESIGN_SYSTEM.md` **§23.4.0**, que además deja escrito que la implementación
> **NO cumple** WCAG 2.2.2 y por qué se acepta). Las dos frases originales quedan **citadas aquí** en vez
> de borradas: una premisa falsa en un documento durable es justo lo que este proyecto lleva todo el día
> cerrando, y quien vuelva a esta ficha tiene que poder ver qué se creía y qué resultó no ser cierto.
>
> **Y lo más importante, que QA señaló: no cambió el síntoma — SE FUE EL REMEDIO.** Esta ficha describe
> un **falso positivo**: una rueda vertical pura, o un *scroll anchoring* por imagen tardía, arma la
> ventana y **pausa la rotación permanentemente sin que nadie lo haya pedido**. Cuando se aceptó como
> Media-baja, el usuario al que le ocurría **tenía salida: pulsar REANUDAR**. Hoy **no hay ninguna
> recuperación en toda la visita**: `paused` es terminal, no hay control, y ni el hover, ni el foco, ni
> volver a la pestaña, ni recargar-sin-recargar devuelven la rotación. El defecto pasó de «molesto y
> reversible por el usuario» a «la función queda muerta hasta la siguiente carga de página». **La
> severidad registrada ya no describe el riesgo real.**

- **Dueño:** **frontend** (la medición), **ux-ui** (la norma: §23.5a es normativa y el número vive ahí, no en el componente). **Severidad:** **Media** (subida desde Media-baja al desaparecer la mitigación; sigue **no bloqueante** porque **no se ha reproducido ni una vez**: 53 eventos `scroll` / 0 con antecedente en la medición de la pasada completa, y esa corrida no tenía red lenta). **Premisa vigente:** la protección de accesibilidad ya no descansa en un control visible sino en los cinco frenos automáticos, y §23.4.0 (a) deja constancia de que 2.2.2 **no se cumple** por decisión del dueño — así que este falso positivo ya no tiene por encima ninguna red que lo compense.
- **Qué pasa:** `handleScroll` (`frontend/src/app/[locale]/(storefront)/_home/FeaturedCarousel.tsx`) pausa para siempre si hay antecedente de usuario en los 1200 ms previos. El antecedente lo arman **cinco** entradas y **dos de ellas no implican que el usuario esté moviendo la pista**:
  - **`onWheel` no discrimina eje.** Medido en Chromium sobre la home real: una rueda **vertical** pura sobre la pista (`deltaX: 0, deltaY: 250`) —o sea, alguien pasando de largo la home— **llega a la pista y arma la ventana**. §23.5 solo nombra la rueda/trackpad **horizontal** como intervención.
  - **`onFocus`** la arma igual, y el foco puede aterrizar en una teja sin que nadie desplace nada.
- **Por qué importa (y por qué el riesgo va al revés de lo que se sospechaba):** el falso **negativo** no es el problema —un swipe emite muchos `scroll` y el primero llega en milisegundos, muy dentro de la ventana—. El problema es el falso **positivo**: si dentro de esos 1200 ms una imagen tardía provoca *scroll anchoring* —que es **exactamente** el escenario que §23.5a describe y lo que pasa en red lenta—, el carrusel **se pausa sin que nadie lo pidiera**. Sería el defecto que §23.5a vino a matar (el conmutador en REANUDAR con el usuario quieto), re-armado por una entrada inocente. Hoy no se reproduce: en la medición de la pasada completa, **53 eventos `scroll` y 0 con antecedente** — pero esa corrida no tenía red lenta ni imágenes tardías.
- **Lo que NO es:** no es la guarda que se retiró en este pase (esa disparaba contra la persona; ésta dispararía contra el motor). Y no es motivo para reintroducirla: una marca de origen no distingue un anclaje de scroll de un swipe, que es justo lo que haría falta aquí.
- **Salidas posibles (ninguna implementada; la elección es de ux-ui porque toca la norma):** **(a)** discriminar eje en `onWheel` (`Math.abs(deltaX) > Math.abs(deltaY)`), que es lo que §23.5 nombra — barato y del componente, pero cambia el enunciado de §23.5a y por eso pasa por ux-ui; **(b)** exigir que el `scroll` mueva `scrollLeft` de verdad antes de atribuirlo (hoy `handleScroll` no compara posiciones); **(c)** acortar la ventana, que es **decisión de ux-ui en §23.5a con medición delante** («si alguna vez se toca ese número, se toca aquí»). No se toma ninguna sin dato.
- **Salida que ganó peso al irse el remedio:** cualquiera de las tres de arriba sirve, pero además hay una **cuarta** que antes no hacía falta plantearse — que la pausa por intervención deje de ser terminal **para el caso del falso positivo** (p. ej. atribuir solo el `scroll` que mueve `scrollLeft` de verdad, salida (b), que mata la causa en vez de ofrecer recuperación). **No se implementa aquí:** toca §23.5a, que es norma de ux-ui, y hacerlo «de paso» en un pase de cierre es exactamente cómo se cuela un cambio de conducta sin revisar.
- **Disparador (nuevo, observable sin conmutador):** que **QA o soporte vean que la pista deja de rotar sola antes de terminar su pasada** — sin que nadie la haya tocado, mirado con el ratón, tabulado ni apartado de la vista. Es el mismo defecto de siempre leído donde ahora se ve: en el movimiento, no en la etiqueta de un botón que ya no existe. Para instrumentarlo basta reproducir la home con throttling de red y una imagen líder lenta, y registrar `scroll` + última entrada, como en la medición del pase. Ref: `DESIGN_SYSTEM.md` §23.5a y §23.4.0, `docs/FRONTEND_NOTES.md` §38 y §40.

#### FR-C2 · El freno por VISIBILIDAD tiene un único punto de cobertura en todo el proyecto, y es un E2E (Media-baja, frontend + devops)
- **Dueño:** **frontend** (el test), **devops** (la composición del gate). **Severidad:** Media-baja. **Estado: abierta, aceptada.** Aviso de QA en el cierre del stream.
- **Qué pasa:** de los cinco frenos automáticos del carrusel, el de visibilidad (`IntersectionObserver` < 50 % + `visibilitychange`) es el **único** cuya mitad de `IntersectionObserver` **no tiene ni un test unitario**: jsdom no implementa la API, así que una mutación que borre `inView` de `suspended` pasa **los 44 unitarios en verde** (verificado en el pase anterior con 39, y el número no cambia la conclusión). Toda su red es **un solo caso**: `§23.5 · la pista fuera de vista suspende, y al volver NO se acumulan tics` en `frontend/e2e/featured-rotation.spec.ts`.
- **Por qué importa:** no es un problema mientras el gate corra unitarios **y** E2E, que es lo que manda `CLAUDE.md`. Es un problema el día que alguien componga un gate «rápido» solo con la suite unitaria —o que la suite E2E se salte por flake, timeout o falta de navegador en un runner—: **ese freno queda a ciegas y nadie se entera**. Un carrusel que sigue rotando fuera de pantalla gasta CPU y batería en móvil y es justo lo que §23.5 prohíbe.
- **Lo que NO es:** no es un hueco de implementación (el freno funciona y está medido: la mutación pone el E2E en rojo, `460 → 960`), ni algo que se arregle escribiendo otro test unitario con la API que jsdom no tiene.
- **Salidas posibles:** **(a)** un *stub* de `IntersectionObserver` en `vitest.setup.ts` que permita disparar entradas a mano — cubre la lógica del componente, no el observador real, y hay que decirlo en el test; **(b)** marcar el spec del carrusel como **obligatorio** en el gate de CI (devops), de modo que saltárselo sea una decisión explícita y no un descuido; **(c)** las dos.
- **Disparador para cerrarla:** que se proponga cualquier gate que no incluya `e2e/featured-rotation.spec.ts`, o que ese spec se marque `skip`/`fixme` por cualquier motivo. Ref: `docs/FRONTEND_NOTES.md` §40, cabecera de `frontend/e2e/featured-rotation.spec.ts`.

### Cierre del pase de copy del home (§41) — rama `claude/ecommerce-home-copy-optimization-dd3d2w`, 2026-09-01 (dueño: **frontend**, no bloqueante)

> Deuda anotada **a petición del techlead** en su veredicto sobre el pase de copy. Ambos ítems son de
> **acoplamiento**, no de defecto: nada está roto hoy. Los textos son los que redactó el techlead.
> **Ninguno se implementa en este pase** — el alcance seguía siendo el copy.
>
> El hallazgo **bloqueante** de ese mismo veredicto (el homoglifo cirílico U+0435 que dejaba muerto un
> brazo del guard de `aria-label`) **NO figura aquí: se corrigió en la rama**, con caso de control y
> verificado por mutación. Ver `FRONTEND_NOTES.md` §41.4.

#### DT-Fx · Tests unitarios del storefront acoplados a literales de copy en español (Baja, frontend)
- **Dueño:** frontend. **Severidad:** Baja. **Estado: abierta, aceptada.**
- **Deuda:** `page.test.tsx` y `FeaturedCarouselRotation.test.tsx` localizan nodos **tecleando la frase de
  marketing** (8 literales tuvieron que reescribirse en el pase de copy §41, rama
  `claude/ecommerce-home-copy-optimization-dd3d2w`). Los E2E de Playwright **no rompieron** porque
  resuelven las claves con `t(locale, 'home.…')` (`e2e/utils/i18n.ts`), que es lo que
  `DESIGN_SYSTEM.md` §9 pide. `src/test/render.tsx` ya importa `messages/{es,en}.json`, así que los
  unitarios pueden leer `es.home.<clave>` **sin infraestructura nueva**.
- **Alcance de la deuda:** solo los literales que sirven para **localizar** el nodo. **Se conservan como
  literal a propósito** las aserciones que son **sobre el texto**: el candado de `aria-label` de §23.9 y
  cualquier deslinde legal (`home.gradingGems.kicker`, `catalog.gradingNote.*`), donde leer la clave haría
  el test **tautológico**.
- **Impacto si no se paga:** cada pase de copy del home cuesta una ronda de tests rojos y arrastra el
  riesgo de que la corrección **debilite la aserción** para volver al verde.
- **Coste estimado:** bajo (2 archivos, sin helper nuevo). **No bloqueante.**
- **Disparador:** el próximo pase que cambie copy del home, o cualquier corrección de un test rojo de esta
  familia que proponga relajar la aserción en vez de actualizar el literal.

#### DT-Fy · `home.featuredTitle` es a la vez titular de marketing y nombre accesible de un landmark (Baja, frontend + ux-ui)
- **Dueño:** frontend (el desacople), **ux-ui** (la norma: §1 es suya). **Severidad:** Baja.
  **Estado: abierta, aceptada.**
- **Deuda:** `FeaturedCarousel.tsx:600` usa `ariaLabel={t('featuredTitle')}` para el `role="region"` del
  carrusel, y la misma clave es el H2 (que alterna con `featuredTitleShort` en móvil, así que el nombre
  del landmark y el título visible **no coinciden por debajo de `lg`**). `DESIGN_SYSTEM.md` §1 (v2.9)
  admite la metáfora de marca en **titulares de marketing** y la prohíbe en **mensajes de accesibilidad**:
  esta clave cae en **los dos lados a la vez**.
- **Impacto:** hoy el valor es neutro («Piezas destacadas»); el riesgo es que un futuro pase de copy meta
  voz de marca en el **árbol de accesibilidad** sin que ningún gate lo note.
- **Dirección:** clave propia y estable para el `aria-label` de la región, desacoplada del titular.
  **No bloqueante.**
- **Disparador:** el próximo pase de copy que toque `home.featuredTitle`, o cualquier propuesta de meter
  léxico de marca (cacería/bounty/HUNT) en ese valor.

#### DT-Fz · ~~`home.how.step1Body` enumera las líneas del resumen de checkout~~ → **RESUELTA de raíz** (2026-09-01, misma rama)
- **Dueño:** frontend. **Severidad:** Baja. **Estado: abierta, aceptada.** Anotada a petición del techlead en el veredicto del pase §41.
- **Hoy es CIERTO, y eso es justo lo que la hace fácil de pasar por alto.** `home.how.step1Body` dice «ves el desglose completo: **IVA, procesamiento y envío**» (EN: «VAT, processing and shipping»), y el resumen de checkout tiene hoy exactamente esas líneas: `checkout.subtotal`, `checkout.processingFee`, `checkout.iva`, `checkout.shipping`, `checkout.total` (verificado sobre `messages/es.json`).
- **Deuda:** el home **espeja la composición de un componente que no controla**. La enumeración es una afirmación sobre el checkout escrita en la home, y **nada la ata**: no hay test que compare ambas superficies, ni podría haberlo sin inventar un acoplamiento nuevo. El día que el resumen gane o pierda una línea —un descuento, una cuota aduanal, o que la comisión del procesador se absorba en el precio en vez de trasladarse— **el home vuelve a ser falso en silencio**.
- **Por qué importa más de lo que parece:** es la **recurrencia, por una vía nueva, de la falla que QA acaba de rechazar** en este mismo pase (§41.9a: «Lo que ves es lo que pagas» prometía una equivalencia que el desglose desmentía). Se corrigió una frase falsa sustituyéndola por una frase cierta **pero frágil**. No es un defecto hoy; es el mismo defecto esperando otro cambio de checkout.
- **Salidas (excluyentes):** **(a)** redactar **sin enumerar** — «ves el desglose completo antes de pagar» / «you see the full breakdown before you pay»: rompe el acoplamiento a **coste cero**, sin perder el argumento (el desglose sigue siendo el gancho), y es la salida barata; **o (b)** conservar la enumeración porque concreta mejor, y entonces **anclar el disparador a `checkout.*`**: quien toque las líneas del resumen tiene que revisar esta clave.
- **Impacto si no se paga:** una afirmación falsa en el home, invisible para el gate, hasta que alguien la lea con el checkout delante.
- **Coste estimado:** trivial con la salida (a). **No bloqueante.**
- **Disparador:** cualquier cambio en la composición del resumen de checkout (altas/bajas de línea en `checkout.*`), o el próximo pase de copy que toque `home.how.step1Body`. Ref: `FRONTEND_NOTES.md` §41.9(a), `PROJECT.md:346`, `:348`, `:401`, `:766`.

> **RESUELTA en la misma rama, y no por haberla pagado: la enumeración era además FALSA.** La segunda
> ronda de QA (§41.9-bis) tumbó `home.how.step1Body` por otro motivo —afirmaba «su precio de mercado»
> contra una decisión LOCKED— y al reescribirla se comprobó que la enumeración «IVA, procesamiento y
> **envío**» tampoco cuadraba: `AmountBreakdown.tsx:64-70` pinta la línea de envío **solo** cuando viene
> `shippingFeeCents`, que es el caso `direct_ship` (invitado). En **compras a bóveda el envío NO se
> cobra ahí** — y esta es precisamente la sección «Cómo funciona la bóveda».
>
> El valor nuevo adopta la **salida (a)** de esta ficha —redactar **sin enumerar**—:
> «En el checkout ves el desglose completo antes de pagar.» / «At checkout you see the full breakdown
> before you pay.» El acoplamiento a la composición de `checkout.*` **desaparece**: la frase es cierta
> para cualquier juego de líneas presente o futuro.
>
> **Cierra sin deuda residual.** Nota para quien lea la ficha original: el diagnóstico decía «hoy es
> cierto, el riesgo es futuro». Era **optimista** — ya era falso al escribirlo, para el caso de bóveda.
> Una ficha de acoplamiento no sustituye a verificar el valor contra el componente.

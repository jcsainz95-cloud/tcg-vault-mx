# API_CONTRACT.md — Marketplace TCG con Bóveda (Pokémon, México)

> Propiedad: **arquitecto**. **Fuente de verdad** de la interfaz backend↔frontend.
> Manda `PROJECT.md` sobre este contrato, y este contrato sobre el código.
> Versión de API: **v1**. Prefijo: `/api/v1`. Formato: **REST/JSON**. Fecha: 2026-08-31 (rev **v1.50.4-brand-domain**).
>
> **Changelog v1.50.4-brand-domain — el contrato deja de transcribir correos (2026-08-31, arquitecto).**
> ⚠️ **CERO cambios de shape, de rutas, de códigos de error y de montos. Ningún endpoint cambia. Ninguna
> implementación existente se vuelve incorrecta.** Lo que cambia es **qué es normativo** en este documento.
> - **Los dominios `tcgvaultmx.com` / `tcgvault.mx` están MUERTOS.** El dominio canónico es el de
>   `common.brand.domain` — hoy **`tcghunt.mx`** — y la marca es `common.brand.name` — hoy **«TCG HUNT»**.
>   Verificado **contra el producto** (`frontend/messages/{es,en}.json`, `backend/src/modules/mail/`), **no contra
>   otra documentación**: cotejar documentos entre sí es exactamente cómo se propagó el error. Buzones del
>   producto: **`soporte@` · `contacto@` · `facturacion@` · `buylist@` · `no-reply@`**, todos `@tcghunt.mx`.
> - **Por qué esto NO era cosmético.** Por la regla de conflicto de `CLAUDE.md`, **este contrato manda sobre el
>   código**. Mientras dijera `soporte@tcgvaultmx.com`, cualquier backend o frontend que lo obedeciera
>   reintroducía el dominio muerto **legítimamente — y tendría razón**. Este documento era la autoridad que
>   sostenía el error, no su víctima.
> - **NUEVA convención transversal en §0: «Datos de contacto y valores de configuración».** El contrato norma la
>   **forma, el origen, la obligatoriedad y quién resuelve** un valor de infraestructura; **no transcribe el
>   valor**. `evidenceContact` pasa de `"soporte@…"` (literal, normativo) a `string` **resuelto server-side desde
>   configuración**. **Cambiar el valor deja de ser un cambio de contrato.** Criterio generalizable — aplica a
>   futuros remitentes, teléfonos y URLs de soporte.
> - **Los correos que quedan en el cuerpo del documento son ILUSTRATIVOS** (marcados `p. ej.`) y **no son
>   citables como autoridad**. Fundamento y norma de lectura: **ARCHITECTURE §0-B** («Fuentes de verdad
>   ejecutables»), nueva en este pase.
> - **Fuera de mi alcance, enrutado:** defaults de buzón en código (backend, P-21) y envs/redirects (devops,
>   P-21). Los buzones `@tcghunt.mx` **ya reciben** (humano, 2026-08-31), lo que desbloquea ese tramo.
> - **Base previa:** v1.50.3-g.
>
> **Changelog v1.50.3-g — DICTAMEN del gate de seguridad / `M-44` + `M-45` (2026-08-29, arquitecto;
> lo implementa BACKEND. ARCHITECTURE §4.38(l.4.10)–(l.4.13), §9, §11):**
> ⚠️ **Cierra SEC-M43-1 (Media, reproducida en vivo por el blue team) y la mitad de contrato de SEC-M43-2.
> UN código de error nuevo, UNA precisión de validación, cero cambios de shape, cero superficies públicas tocadas.**
> - **NUEVO `409 GRADED_ESTIMATE_WOULD_DEGRADE_MARKET_REF` en `POST /admin/pricing/override`** (`M-44`,
>   **BREAKING chico**, `super_admin`). `intent:"graded_estimate"` **ya no puede caer sobre una fila `market` del
>   mismo día**: la reclasificaba a estimado **y le pisaba el monto**, con `200` y sin `409`, siempre que el slab
>   estuviera fuera de `platform+listed` — reserva, picking, pre-publicación **o custodia de cliente**. Medido:
>   `500000 · market → 1234 · graded_estimate` ⇒ al republicar el slab, `listings: []` y **ninguna cola lo ve**.
>   **La regla que ya regía al ingest pasa a regir al humano:** *la naturaleza de una fila solo se SUBE
>   (`graded_estimate → market`), y solo por acto humano declarado; bajarla no es una operación que ofrezca este
>   sistema.* **NO se ensancha la guarda a `in_stock`** (ARCHITECTURE §4.38q.2 sigue intacta: contesta otra pregunta).
> - **Qué cambia del `200`, explícito:** su **forma no cambia** (`{ data: PriceHistoryEntryDTO }`). Cambia **qué
>   llamadas la reciben**: un subconjunto que hoy responde `200` pasa a responder `409`. Misma clase y misma
>   justificación que el `422 GRADED_INTENT_REQUIRED` de v1.50.2.
> - **Precisión de validación en `POST /admin/pricing/override` (SEC-M43-4, aditiva, NO breaking):** `productType`
>   fuera del conjunto ⇒ **`422 VALIDATION_ERROR`**; `cardId` inexistente ⇒ **`404 NOT_FOUND`**; `gradeKey` no
>   generable por `gradeKeyFor` (p. ej. `graded:PSA:11`) ⇒ **`422`**. Hoy los dos primeros devuelven **`500`**: es el
>   **código apartándose del contrato**, que ya normaba `422`. Se escribe caso por caso para que no vuelva a pasar.
> - **`M-44b` (no es contrato de API, se anota para trazabilidad):** `AuditLog` de `pricing.override` registra
>   **`before`** además de `after` — hoy el monto pisado **no es reconstruible** desde la bitácora.
> - **`M-45` — el runbook de cut-over se corrige en ARCHITECTURE §4.38(l.4.7)/(l.4.11)** (congelación, censo que
>   **para y escala** sin rama alternativa, re-censo como gate, **sin backfill**, check **negativo** en la
>   verificación, rollback con precondición de cero). **No toca ningún endpoint**; se cita aquí porque la nota de
>   cut-over del `POST /admin/pricing/override` remitía al procedimiento derogado.
> - **Sin cambios** en superficies públicas, DTOs, curva (§N/§4.36) ni montos. **Base previa:** v1.50.3-f.
>
> **Changelog v1.50.3-f — DICTAMEN GE-1 / `M-43`: la NATURALEZA de la fila de precio (2026-08-29, arquitecto;
> lo implementa BACKEND. ARCHITECTURE §4.38(l.4)/(l.5), §9, §11 `v1.50.3-f-graded-estimate-kind`):**
> ⚠️ **Cierra un hallazgo ALTO reproducido en vivo por el pentester (GE-1, `PENTEST_NOTES.md`): un slab PSA 10 que con
> referencia correcta lista a MX$9,200 quedó publicado a MX$460 —5% de su valor— heredando la fila del «estimado si se
> gradea»; con el estimado rancio a −400 días siguió a MX$460.** Es **INV-D en la dirección inversa** (capturar el
> estimado ANTES, publicar el slab DESPUÉS), que v1.50.2 declaró abierta. **Cambios de contrato: dos campos aditivos
> admin-only, una precisión de semántica en `DELETE`, y una regla normativa de resolución de precio. Ninguna
> superficie pública cambia de shape.**
> - **`PriceReference` gana `refKind` (`"market" | "graded_estimate"`, default `market`) — NATURALEZA, ortogonal a
>   `source` (procedencia).** Regla normativa, y es el corazón del cambio: **una fila `graded_estimate` NUNCA resuelve
>   `salePriceCents`, ni oferta de buylist, ni valuación** — no «pierde la precedencia»: **no es candidata**. Un slab
>   sin fila `market` responde `PRICE_PENDING` y **no es vendible** (fail-closed). ARCHITECTURE §4.38(l.4.4)A.
> - **`intent` del `POST /admin/pricing/override` deja de vivir solo en la bitácora y pasa a FIJAR `refKind`**
>   (`"market"` ⇒ `market`; `"graded_estimate"` ⇒ `graded_estimate`). El `422 GRADED_INTENT_REQUIRED` y el
>   `409 GRADED_ESTIMATE_SLAB_PUBLISHED` **no cambian** (defensa en profundidad: el `409` sigue existiendo porque
>   capturar un estimado sobre un grado con pieza publicada es una **intención equivocada**, aunque ya no mueva dinero).
> - **`PriceHistoryEntryDTO` y `GradedEstimatePreviewDTO` ganan `refKind`** (ambos `super_admin`; **aditivo**). En el
>   diagnóstico distingue «cifra que puedo recapturar o borrar» de «**dinero** de una pieza real, no la toques».
> - **`DELETE /admin/pricing/graded-estimates/:cardId/:gradeValue` borra SOLO las filas `refKind="graded_estimate"`**
>   (antes: todas las de la clave). Sin esto, el verbo destructivo del gancho podría llevarse una fila de **mercado** —
>   justo el radio de explosión que v1.50.3-d se negó a abrir para `raw`/`sealed`. `404` si no había filas **de esa
>   naturaleza**, aunque existan filas `market`. La guarda `409` corre antes y no cambia.
> - **⛔ DEROGADA la recomendación de v1.50.3** («valor `graded_estimate` en el enum `PriceSource` con `sourceRank`
>   bajo toda fuente real»): **`PriceSource` NO cambia** y el conjunto de valores del enum del contrato **queda
>   intacto**. El PoC probó que ordenar no sirve — el estimado suele ser la **única** candidata de su clave y gana con
>   cualquier rango. Hacía falta **excluir**, no ordenar. ARCHITECTURE §4.38(l.4.1).
> - **CONDICIONAL (solo si el humano ejerce la «vía B» de §4.38(l.5), es decir, fusionar antes de que M-43 esté
>   desplegado): `409 GRADED_ESTIMATE_DISABLED`** en `POST /admin/pricing/override` con `intent:"graded_estimate"`
>   mientras `gradedEstimatesEnabled` esté `off`. **Transitorio**: se retira con M-43. Si M-43 entra en este mismo
>   pase, **este código nunca se emite** y desaparece del contrato en la siguiente rev.
> - **GE-2 (Media, rechazos 401/403 sin fila en `AuditLog`): NO es cambio de contrato.** Dictamen en ARCHITECTURE §9:
>   es **hardening del plano de observabilidad (devops)**, no requisito de la bitácora de negocio — el `401` no tiene
>   «quién» (criterio 23) y auditarlo le daría a un anónimo una **primitiva de escritura** sobre una tabla
>   money-adjacent. Ningún endpoint cambia.
> - **Sin cambios** en la curva (§N/§4.36), en ningún DTO público, ruta pública ni monto. **Base previa:** v1.50.3-e.
>
> **Changelog v1.50.3-project-reconciliation (2026-08-28, arquitecto — pase de RECONCILIACIÓN con `PROJECT.md` tras el
> rechazo de QA + techlead; lo implementan BACKEND + FRONTEND. ARCHITECTURE §4.38 rev v1.50.3.):**
> ⚠️ **No añade features. Cierra divergencias en las que el contrato/código se apartó de `PROJECT.md` sin actualizar el
> criterio — y por la regla de conflicto PROJECT manda.** **UN endpoint nuevo (admin), TRES seeds corregidos, cero
> cambios de shape en superficie pública.**
> - **⚠️ SEEDS CORREGIDOS (§M2, `GET/PUT /admin/pricing/graded-estimates`) — cambia el VALOR, no el shape:**
>   `manualFreshnessDays` **`null` → 30**, `minSampleCount` **3 → 5**, `maxRawMultiple` **50 → 100**. Los tres estaban
>   divergiendo de `PROJECT.md` (criterios **109**, **111(a)** y **111(c)**) **sin estar documentados en ningún
>   sitio**. Dos consecuencias observables: **(1)** un estimado fijado a mano **ya caduca** a los 30 días —antes no
>   caducaba nunca, y QA lo demostró con una fila de 40 días que seguía en la ficha **y** promocionándose—; **(2)** el
>   ingest exige **5** ventas en la muestra, no 3. **Es cambio de código para backend** (seeds + orden de operaciones
>   de la frescura). ARCHITECTURE §4.38(k.0)/(m).
> - **La frescura del override manual: qué cambia exactamente.** No se exime a nadie del decaimiento; se **invierte el
>   orden**: la frescura filtra las candidatas **ANTES** de que `pickBestRef` elija al ganador, nunca después. Con eso
>   se cierra el fallo que motivó la exención de v1.50.2 (el manual viejo ganaba y luego la frescura lo tiraba, dejando
>   la carta muda **pese a haber dato fresco**) **sin** contradecir el criterio 109. **`isBetterRef` no se toca**, así
>   que §4.27f-2 (money-safe) queda intacto.
> - **NUEVO — `GET /api/v1/admin/pricing/graded-estimates/review` (`super_admin`, read-only, paginado): la LISTA DE
>   REVISIÓN del back-office.** Es el **criterio 111(e)**, que no existía **ni estaba declarado fuera de alcance**. Es
>   la contrapartida explícita de la decisión de **no ocultar** la cifra incoherente en la ficha (ARCHITECTURE
>   §4.38k.3): sin ella publicábamos el número raro y **nadie se enteraba nunca**, porque el único diagnóstico era
>   `/preview`, **por carta y con `cardId` obligatorio**. **Aditivo y admin-only**; **necesita superficie en M2**
>   (sin UI el criterio no se cumple). ARCHITECTURE §4.38(n).
> - **GLOSARIO de nombres `PROJECT.md` ⇄ contrato (§M2).** `minSalesSample` = `minSampleCount`, `maxGradedMultiple` =
>   `maxRawMultiple`. **Los identificadores del contrato NO se renombran** (breaking de admin + migración de
>   `SettingKey` a cambio de cero comportamiento); lo que se corrige es que la equivalencia **no estaba escrita en
>   ninguna parte**, que es lo que permitió que los valores divergieran en silencio.
> - **Renumeración de criterios 79–92 → 97–112 en TODAS las citas del gancho** (changelog v1.50, §DTOs base, §2, §M2,
>   §M10). Los números viejos **hoy son criterios vivos de `main`** (§N, la curva, en producción), así que las citas
>   apuntaban a otra cosa y hacían que QA verificara lo que no era. **Verificado caso por caso: las citas de §N/§4.36
>   NO se tocaron.** ARCHITECTURE §4.38(o).
> - **`freshnessDays` gana un segundo efecto en el INGEST** (no cambia el contrato, es comportamiento del job): no se
>   persiste una fila cuya `lastSaleDate` del proveedor supere la ventana; ausente/no parseable ⇒ no se escribe. Cierra
>   el «fresco para siempre» de ARCHITECTURE §4.38(m.2). **Bloquea encender la fase 2**, que hoy está `off`.
> - **⚠️ ADDENDUM v1.50.3-a — LOS TRES SEEDS NO LLEGAN A UN ENTORNO YA SEMBRADO. Léase antes de dar por hecho que la
>   tabla de arriba describe producción.** `prisma/seed.ts` hace `upsert` con **`update: {}`**, así que un entorno que
>   ya corrió el seed **conserva los valores viejos** (`manualFreshnessDays: null`, `minSampleCount: 3`,
>   `maxRawMultiple: 50`) **aunque el código nuevo esté desplegado y los tests en verde**. Los valores de este
>   contrato son los **defaults de código**; el estado real de un entorno se consulta con
>   `GET /admin/pricing/graded-estimates`. **No se automatiza un `UPDATE`** (pisaría en silencio cualquier dial que el
>   operador haya ajustado a propósito): se aplican con un **`PUT /admin/pricing/graded-estimates` explícito y
>   auditado** como paso de despliegue. Detalle en ARCHITECTURE §4.38(p); **regla general para todo `ConfigSetting`**
>   en ARCHITECTURE §11.0.
>   **⚠️ v1.50.3-b — cómo se VERIFICA que un entorno quedó bien, porque las dos garantías no son la misma:** la
>   **configuración** se comprueba con **este `GET` + la línea de inventario** del arranque —solo lectura, válidas en
>   **producción**, y **los únicos detectores del seed rancio**—; la **lógica** del criterio 109 se comprueba con el
>   **E2E, en staging**, que **escribe** y **fija el dial antes de asertar** ⇒ **«corrí el E2E y pasó» NO significa
>   «el dial de producción está bien»**. ARCHITECTURE §4.38(p) y §11.0 punto 5.
> - **⚠️ ADDENDUM v1.50.3-a — el shape `gradedPrices.psaN` (S2) del ingest queda NO PERSISTIBLE**, y la escotilla
>   `POKEMONPRICETRACKER_GRADED_MIN_COUNT=0` **se deroga**. **No afecta a este contrato** (el ingest no tiene
>   superficie pública y la indistinguibilidad de fases se mantiene), pero se registra aquí porque **condiciona
>   encender la fase 2**: un escalar sin `count` ni fecha no puede satisfacer las pruebas 1 y 2 del gate de confianza,
>   así que no hay superficie —**tampoco la ficha**— donde esa fila fuera admisible. ARCHITECTURE §4.38(h.1-bis).
> - **⚠️ ADDENDUM v1.50.3-c — `STALE` deja de ser `400` en `/graded-estimates/review` y pasa a valor OPT-IN de
>   `?reason=`; `GradedEstimatePreviewDTO` gana `isManual: boolean`.** Corrige un **error de diseño mío**: agrupé
>   `STALE` con «ausencia de dato» (`NO_PSA10` y compañía) cuando es lo contrario — **un dato que existió y expiró**.
>   Sin esto, una cifra caducada **desaparece de las tres superficies en silencio, sigue en la BD y el dueño no tiene
>   forma de encontrarla** para refrescarla o retirarla; y es la categoría que ARCHITECTURE §4.38(m) ya prometía poder
>   enumerar. `isManual` distingue los dos remedios (**manual** rancia ⇒ recapturar; **automática** rancia ⇒ mirar el
>   ingest). **Ambos cambios son ADMIN-ONLY: ningún DTO ni superficie pública se altera**, y la indistinguibilidad de
>   fases (§4.38g) queda intacta porque es una garantía sobre lo **público**. El orden del listado intercala
>   `capturedDate` asc (lo más vencido primero). ARCHITECTURE §4.38(n.2-bis).
> - **⚠️ ADDENDUM v1.50.3-d — NUEVO `DELETE /api/v1/admin/pricing/graded-estimates/:cardId/:gradeValue`
>   (`super_admin`, auditado). Cierra un hueco que este contrato arrastraba desde v1.46:** afirmaba que un override
>   manual «solo lo revoca otro override o la **limpieza/borrado explícito** por `super_admin`», **y ese borrado no
>   existía** — el back-office solo podía **pisar** una cifra, nunca **quitarla**. `PROJECT.md` §O.7 exige que el
>   dueño pueda *«corregirla con override **o descartarla**»*, así que no era opcional. Borra **todas** las filas de la
>   clave canónica en transacción, responde `deletedCount`, **`404` si no había nada** (no un `200` silencioso), y
>   lleva la **misma guarda INV-D que la escritura ⇒ `409 GRADED_ESTIMATE_SLAB_PUBLISHED`**. **Admin-only; ninguna
>   superficie pública cambia.** ⚠️ **`raw` y `sealed` siguen sin borrado** (un `DELETE` ahí mueve precios de venta
>   publicados y necesita su propio diseño): corregidas las frases que lo daban por existente. ARCHITECTURE §4.38(q),
>   §4.27f-2, §9.
> - **⚠️ ADDENDUM v1.50.3-e — `GradedEstimatePreviewDTO` gana `reasons: HighlightReason[]`; el filtro de `/review` se
>   evalúa sobre `reasons`, no sobre `reason`.** Cierra un **agujero medido en la red de coherencia**: con **un solo
>   grado** (raw $460 + PSA 10 $230, sin PSA 9) la evaluación cortaba en `NO_PSA9` y **`NOT_ABOVE_RAW` nunca se
>   comprobaba** ⇒ `total: 0`. Es el peor sitio posible para esa falta: el error **USD-como-MXN** es más probable en
>   la **primera captura** (un grado), y como sin PSA 9 la carta **nunca se promociona**, la cifra errónea **no llega
>   a la rejilla pero SÍ se muestra en la ficha** ⇒ **visible al comprador, inencontrable para el operador**.
>   **`reason` y `eligible` NO cambian de semántica** (`reason` = primer bloqueante = `reasons[0]`; `eligible` es la
>   conjunción de todos los pasos y el orden nunca la alteró). **Aditivo, admin-only, ninguna query nueva.**
>   ARCHITECTURE §4.38(c), §4.38(n.2-ter).
> - **Ratificado sin cambio documental:** `POST /admin/pricing/override` responde **`200`**, como este contrato norma
>   desde v1.50. El código devolvía `201`; **backend corrigió el código, no el contrato** (`@HttpCode(200)`). Es el
>   desenlace correcto — **el contrato manda sobre el código**. **Frontend/QA:** revisar cualquier arnés que asertara
>   `201`.
> - **Sin cambios** en ningún DTO público, ruta pública, código de error existente ni monto de dinero. **M-42 sigue
>   siendo DATA/seed, sin DDL.** **Base previa:** v1.50.2.
>
> **Changelog v1.50.2-graded-estimate-confidence-gate (2026-08-28, arquitecto — DICTAMEN DE FUSIÓN del gancho de
> grading con pricing v2 (§4.36/D2, contrato v1.49); lo implementan BACKEND + FRONTEND. ARCHITECTURE §4.38.):**
> ⚠️ **UN cambio de shape y UN breaking chico de admin. Todo lo demás es aditivo y money-safe.**
> - **⚠️ CAMBIO DE SHAPE — `gradingHighlight?` se MUEVE de `GroupedListingDTO` a `GroupedListingSummaryDTO`.** Main
>   creó `GroupedListingSummaryDTO` (D2) y la rejilla dejó de usar `GroupedListingDTO`, así que mi campo **se caía de
>   la lista blanca en silencio** (backend compila, la teja queda vacía). **Dictamen: entra a la lista blanca y NO
>   viola D2** — D2 no protege un secreto, protege la **economía de enumerar** un mapa de defectos operativos, y ese
>   argumento **solo se sostiene mientras no exista un enumerador público del campo**; aquí lo construimos a propósito
>   (`?gradingHighlight=true&sort=grading_showcase`), así que publicar la cifra por fila **no crea capacidad nueva**.
>   Además `GradedEstimateDTO` **no tiene** `priceBasis`/`source`/`isManualOverride` (ausencia **estructural**).
>   Se **mueve** en vez de duplicarse para que la partición **informar ≠ promover** la sostenga el **compilador**.
>   **Consecuencia:** `GroupedListingDTO` (ficha) **ya no lleva** `gradingHighlight`; la ficha usa `gradedEstimates`.
>   **Regla generalizada de admisión** a `GroupedListingSummaryDTO` en ARCHITECTURE §4.38(e), para no re-litigar.
> - **GATE DE CONFIANZA (nuevo) — la rejilla exige confiabilidad; la ficha no.** La cifra se emite en rejilla/vitrina
>   solo si es **fresca**, de **origen confiable** y **coherente en magnitud** (tres cotas). **La ficha NO aplica la
>   coherencia de magnitud**: informa lo que hay. **6 diales nuevos** (M-42 pasa de 6 a **12** claves, sigue **sin
>   DDL**) y **4 `reason` nuevos** en el preview de admin. §M2, ARCHITECTURE §4.38(k).
> - **⚠️ BREAKING (admin, `super_admin`) — `POST /admin/pricing/override` exige `intent` cuando
>   `productType:"graded"`.** Cierra una colisión de **dinero**: la fila del «estimado» y la referencia de mercado de
>   un **slab PSA real publicado** son **la misma fila**, así que fijar un estimado sobre una carta con slab publicado
>   **cambiaba su precio de venta real**. `422 GRADED_INTENT_REQUIRED` si falta; `409 GRADED_ESTIMATE_SLAB_PUBLISHED`
>   si se intenta un estimado con slab publicado. **Obligatorio y no opcional-con-default a propósito:** un default en
>   ruta de dinero es **fail-open**. ARCHITECTURE §4.38(l).
> - **La fase 2 (ingest PPT) se DESBLOQUEA** con un parser **auto-confirmante** que satisface P-6 en vez de
>   dispensarla. **No cambia el contrato público** (la indistinguibilidad de fases se mantiene). ARCHITECTURE §4.38(h).
> - **Coste de queries: +1 dial `off` / +3 dial `on`** (config + estimados + slabs publicados). Antes +1/+2.
> - **Sin cambio** en ningún DTO de dinero, ni en la curva, ni en las dos capas de §4.36. **Base previa:** v1.50.1.
>
> **Enmienda v1.50.1 (2026-08-23, arquitecto — post-gates QA + techlead). NO cambia ningún shape ni ninguna ruta;
> corrige una cifra publicada y endurece una regla money-safe.**
> - **Coste de queries CORREGIDO.** Esta rev publicaba «**+1 query constante**»; **la cifra real medida por QA es +1
>   con el dial `off` y +2 con el dial `on`** (1 de config + 1 del batch de estimados). La vieja cifra contaba solo la
>   query de precios e ignoraba la de config. *(QA midió **+7** en su momento porque `SettingsService.get()` no
>   memoizaba y hacía un `findUnique` por cada una de las 6 claves; backend ya lo cerró izando las 6 en una query.)*
>   Corregido abajo y en §2. **Los tests de coste deben contar TODAS las queries del request**, no solo las de graded.
>   *(⚠️ **v1.50.2 la vuelve a subir a +1 `off` / +3 `on`**: el guard de slab publicado de INV-D añade un batch.)*
> - **Fail-closed endurecido — `AUSENTE ≠ INVÁLIDA` (P1 del techlead, aceptada).** Una clave de config **presente pero
>   corrupta** (edición fuera de banda) **apaga el destacado** en vez de caer a su seed. Antes, con la tabla de
>   escalones válida y `grading_min_upside_pct` corrupto, el gate caía al seed **30** aunque el admin hubiera puesto
>   **200**: **más permisivo que su intención, en silencio, en la superficie que promociona**. **Ausente** (primer
>   deploy) sigue cayendo a seed. Detalle en §M2 y ARCHITECTURE §4.38(d).
> - **Dos decisiones de implementación registradas** para que nadie las revierta: los endpoints
>   `admin/pricing/graded-estimates*` se declaran en **`CatalogModule`** (anti-ciclo `Pricing ↔ Catalog`; **las rutas de
>   este contrato NO cambian**) y **`PUT` con body vacío ⇒ `422`** (parcial ≠ vacío; precedente `PUT /admin/fx`).
> - **Sin cambios para frontend.** Ningún DTO, campo, query param ni código de error se altera. *(v1.50.2 sí los tiene:
>   ver arriba el movimiento de `gradingHighlight`.)*
>
> **Changelog v1.50-graded-estimate (2026-08-23, arquitecto — DISEÑO EN PAPEL; backend/frontend implementan.
> PROJECT §O v2.0 «gancho de grading» + **reducción de alcance del humano del 2026-08-23**, rama
> `claude/psa-graded-card-value-gmhv5u`. Todo ADITIVO, RETROCOMPATIBLE y MONEY-SAFE: ningún endpoint ni DTO existente
> cambia de forma o de tipo; solo se AÑADEN campos OPCIONALES, dos query params, un recurso de diales M2 (+ su
> diagnóstico) y un dial M10. Ningún monto de dinero real cambia. SIN migración de esquema (M-42 = DATA/seed).
> ARCHITECTURE §4.38/§10/§11.**
> - **Qué es:** sobre una carta **raw publicada**, el storefront muestra **cuánto valdría gradeada**. Es un **estimado
>   informativo con disclaimer obligatorio**: **nunca** un precio de venta, una oferta, una promesa de grado ni un
>   compromiso de recompra.
> - **⚠ REDUCCIÓN DE ALCANCE (2026-08-23, humano) — leer antes que nada.** La interfaz **NO muestra multiplicador, ni
>   ganancia calculada, ni comparativa de columnas** («no hay que mostrarlo así… nos quitamos talacha de calcularlo»).
>   La superficie visible se reduce a **la cifra por grado junto al precio**. Por eso el contrato **público NO
>   transporta** `multiplier`, `upsideMxnCents`, `netUpside*`, `gradingCost*` ni `minUpsidePct`. `PROJECT.md` §O.3
>   (bloque comparativo, upside, escalón visible) queda **SUPERADO en la parte de presentación**; **product-owner** debe
>   actualizarlo para que mande sobre el contrato (regla de conflicto).
> - **El gate de ROI SOBREVIVE COMPLETO pero cambia de PAPEL:** deja de ser información al cliente y pasa a ser
>   **criterio de CURADURÍA** — decide **dónde promocionamos activamente** («calcúlalo para que podamos ponerlo en la
>   sección de destacado algo que valga la pena»). De ahí **dos campos con reglas de emisión distintas**:
>   - **`GroupedListingDetailResponse += gradedEstimates?: GradedEstimateDTO[]`** — **FICHA**, nivel **CARTA**.
>     **PSA 10 y PSA 9**, tal cual. **SIN gatear**: se emite siempre que haya dato fresco.
>   - **`GroupedListingSummaryDTO += gradingHighlight?: GradedEstimateDTO[]`** — **REJILLA de Compra + VITRINA del
>     home**, nivel **GRUPO**. **GATEADO**: solo si el gate de ROI sobre PSA 9 se cumple. Contenido = los grados que el
>     badge pinta (hoy `["10"]`). *(v1.50 lo declaró en `GroupedListingDTO`; **v1.50.2 lo MOVIÓ** al Summary — ver el
>     changelog de arriba.)*
>   - Consecuencia deliberada: **una carta puede mostrar sus estimados en la ficha y NO estar destacada** en Compra ni
>     en el home. Informar ≠ promover.
> - **SEC-A1 sale REFORZADO:** el cliente ya ni siquiera recibe los **insumos** del cálculo (ganancia neta, escalón
>   aplicado, umbral) — solo su resultado binario = **presencia del campo**. Un DTO manipulado no puede reconstruir el
>   gate porque los números no viajan. Los insumos se exponen **solo al admin**, en
>   `GET /admin/pricing/graded-estimates/preview` (§M2), para responder «¿por qué esta carta no está destacada?».
> - **REGLA DURA (presencia ⇔ elegibilidad).** **NO existe `eligible: boolean`** ni `[]` vacío: si no hay nada que
>   mostrar, el campo **se OMITE** y el front **no renderiza nada** — nunca **$0**, nunca un guion `—`, nunca un rango
>   inventado y —a diferencia del resto del sistema— **ni siquiera «precio pendiente»** (el estado pendiente es
>   back-office, no un argumento de venta). Un `eligible:false` está **prohibido**: invitaría a pintar un badge
>   tachado/gris (criterio 100).
> - **Gate de ROI sobre PSA 9, server-side (SEC-A1, decisión 41), SOLO para rejilla/vitrina:**
>   `destacada ⇔ estimadoPSA9 ≥ ceil((precioVentaRaw + gradingCost) × (1 + minUpsidePct/100))`, con **`gradingCost` =
>   el ESCALÓN cuyo rango contiene el estimado PSA 10** (tabla `gradingCostTiers`, §O.2.1). El **PSA 10 NO decide** la
>   elegibilidad. **Sin PSA 9 no hay promoción** (criterio 98) — aunque la ficha sí pueda mostrar el PSA 10.
>   *(v1.50.2 antepone el **gate de confianza**: fresca + origen confiable + coherencia de magnitud. Ver §M2.)*
> - **Sin escalón, sin destacado:** tabla vacía, con hueco o mal editada ⇒ **no elegible**. **Jamás** se asume costo $0
>   ni se cae a un default silencioso. La tabla se valida **contigua y con escalón final abierto** en cada `PUT`.
> - **Diales (M2, recurso nuevo):** `GET/PUT /api/v1/admin/pricing/graded-estimates` — `gradingCostTiers`,
>   `minUpsidePct` (30), `freshnessDays` (30), `grades` (`["10","9"]`) y `highlightGrades` (`["10"]`). Mismo **patrón**
>   que `sealed-spreads`/`tiers` (JSON en `ConfigSetting`, `super_admin`, **auditado**, **sin redeploy**), pero
>   **recurso propio**: **no** se reusa `GET/PUT /admin/pricing/tiers`, cuya taxonomía es LOCKED de 5 filas nombradas
>   con un invariante incompatible (ARCHITECTURE §4.38d / GU-A1). *(v1.50.2 añade 5 diales más a este recurso.)*
> - **Dial M10 nuevo:** `gradedEstimatesEnabled` (`graded_estimates_enabled`, `on|off`, **seed `off` fail-closed**).
>   Con `off` el backend **ni siquiera evalúa nada**: no emite `gradedEstimates` ni `gradingHighlight`, y
>   `?gradingHighlight=true` devuelve `data: []`. Encenderlo en producción **requiere el visto bueno del humano** sobre
>   el texto del disclaimer (§O.5, pregunta abierta v2.0 #1). *(v1.50.2 añade un segundo dial M10,
>   `gradedEstimateIngestEnabled`, que gobierna la **obtención** y no la exhibición.)*
> - **Vitrina = `GET /catalog/cards` filtrado**, no endpoint nuevo: `?gradingHighlight=true&sort=grading_showcase`
>   (orden server-side por **mayor ganancia neta sobre PSA 9**, el escenario realista). `data: []` **es** la señal de
>   «no renderizar la vitrina completa». `sort=grading_showcase` sin el filtro ⇒ `400 GRADING_SORT_REQUIRES_FILTER`.
> - **Fase 1 = MANUAL-FIRST, sin mecanismo de captura nuevo:** los estimados se fijan con el endpoint **ya existente**
>   `POST /admin/pricing/override` (`productType:"graded"`, `gradeKey:"graded:PSA:10"|"graded:PSA:9"`, `finish`
>   omitido ⇒ `normal`), que escribe **exactamente** las filas que el storefront lee. ~~**Fase 2** (ingest automático
>   PokemonPriceTracker) está **BLOQUEADA** por doctrina P-6~~ ⛔ **DESBLOQUEADA en v1.50.2** con un parser
>   auto-confirmante que satisface P-6; **sigue sin cambiar este contrato** — ARCHITECTURE §4.38(h).
>   *(v1.50.2: con `productType:"graded"` el endpoint exige `intent` — ver el changelog de arriba.)*
> - **Indistinguibilidad fase 1 ⇄ fase 2 (criterio de éxito):** el campo **`source` NO se emite** en las superficies
>   públicas del gancho (es el único que delataría el origen del número). Cambiar de manual a ingest **no toca ni el
>   contrato ni el cliente**. Ver ARCHITECTURE §4.38(g).
> - **Actualiza la DECISIÓN v1.28** (valor de mercado por grado, §M1 «Gradeadas»): ~~sigue siendo manual, sin proveedor
>   automático~~ *(v1.50.2: la fuente automática se desbloquea, §4.38h)*; ese valor **deja de ser solo de back-office y
>   pasa a alimentar el storefront**. Ver la nota **v1.50** en §M1 y en `POST /admin/pricing/override`.
> - **Doctrina (informativa, no dinero):** las filas `graded:PSA:*` **no** fijan `listPriceCents`, **no** publican
>   inventario, **no** entran en `availableFinishes`/`displayFinishes`, **no** encolan `PendingPriceEntry`, **no**
>   valúan portafolio/P&L/inventario y **no** afectan el buylist. ARCHITECTURE §4.38(b) — es la trampa más fácil de
>   pisar. ⚠️ **EXCEPCIÓN descubierta en v1.50.2 (INV-D):** cuando existe un **slab publicado** de ese grado, esa fila
>   **SÍ es dinero** (es la referencia de mercado real de esa pieza). Por eso `intent` + `409`. ARCHITECTURE §4.38(l).
> - **Sin N+1 — coste MEDIDO (corregido tras el gate de QA):** un **único** batch dedicado
>   (`getGradedEstimatesBatch`) por request. Coste **constante** en `/catalog/cards`,
>   `/catalog/cards?gradingHighlight=true` y `/catalog/cards/:cardId`: **+1 query con el dial `off`** (solo la lectura
>   memoizada de config, que corta antes de tocar precios) y **+2 con el dial `on`** (1 de config + 1 del batch de
>   estimados). **0** en el resto de endpoints. *(La rev inicial publicaba «+1 constante»: contaba solo la query de
>   precios e ignoraba la de config. QA midió **+7** con el dial `on` porque `SettingsService.get()` no memoizaba y
>   hacía un `findUnique` por cada una de las 6 claves; backend lo corrigió izando las 6 en **una** query. El coste no
>   depende del nº de grupos ni de cartas de la página.)* **⚠️ v1.50.2: la cifra vigente es +1 `off` / +3 `on`.**
> - **Reparto:** **backend** (stream «Catálogo y precios», módulos `pricing`+`catalog`, común
>   `backend/src/common/graded-estimate.ts` NUEVO). **Frontend** (mismo stream): las tres superficies + i18n ES/EN del
>   disclaimer. **El disclaimer NO viaja por la API** (es copy i18n del front, como el label de NM) y su patrón de
>   presentación —**nota al pie** con llamada junto a la cifra— lo define **ux-ui** (`DESIGN_SYSTEM.md` **§22**); pero
>   **renderizar cualquier cifra sin él es un defecto bloqueante** (criterio 103).
>
> **Changelog v1.49-pricing-two-layers-merge (2026-08-25, arquitecto — DICTAMEN DE FUSIÓN; lo implementa BACKEND en el
> merge. Escalada regla 9 (backend), rama v2 `origin/claude/card-pricing-rules-2e537m`. ARCHITECTURE §4.36. Money-safe,
> retrocompatible; sin migración por este dictamen — la M-41 aditiva la trae la rama.):** la rama v2 reescribe la **capa
> REGLA** de pricing (motor de **curva** `computeSalePriceFromCurve`/`quoteAcquisitionFromCurve`, editor M2 de
> curvas/spreads/UPC, `priceBasis` en DTO de precio) y, en el mismo pase, **elimina** el provider `tcgcsv_singles` (P-47,
> §4.35) del barrido. **Dictamen:** se **ADOPTA** la capa REGLA (curva) y se **CONSERVA** la capa REFERENCIA
> (`tcgcsv_singles`); son **ortogonales**. Se **RECHAZA** el borrado de `tcgcsv_singles`.
>
> **— DOS CAPAS DE PRECIO (NORMATIVO). —** El precio de un single se produce en dos capas independientes que no se pisan:
> 1. **Capa REFERENCIA (per-acabado):** el **precio de mercado por `(carta, finish, cardProductId)`** lo puebla el barrido
>    diario desde **TCGCSV `tcgcsv_singles`** (§4.35, P-47), provider **PRIMARIO**. `tcgcsv_singles` **PERMANECE** como
>    fuente per-acabado **precisamente porque PPT/pokemontcg.io aplanan** —exponen UN solo `market` a nivel carta,
>    invariante al printing (§4.35(d))—; retirarlo re-aplana normal/reverse/holo al mismo precio (la regresión que P-47
>    cerró). Ancla: **§4.35** (referencia per-acabado, `tcgcsv_singles` primario) + **§4.27f-2** (override manual = tier
>    superior absoluto, durable cross-day, sobre CUALQUIER fuente automática).
> 2. **Capa REGLA (deriva compra/venta):** sobre el escalar de mercado de la capa 1, la **curva** (adopción v2) deriva el
>    precio de compra (buylist) y de venta, **por acabado** (`getReference(...finish)`/`getReferencesBatch` per-acabado; la
>    curva recibe `marketMxnCents` escalar y se evalúa una vez por acabado). La curva es la evolución del editor de M2 y
>    **sustituye la indirección tiers×mapa** de §4.33 conservando su semántica money-safe (`fixed`/`pct`, gate premium,
>    precedencia, `pct` sin market ⇒ pendiente nunca $0, derivación server-side SEC-A1). Ancla: **§M2** (editor de curva) +
>    **§4.33/§4.28** (regla = curva por valor de mercado sobre el catálogo canónico de rarezas). Los DTO de precio ganan
>    **`priceBasis`** (adopción v2) para exponer sobre qué base se derivó el precio.
>
> Las dos capas se **ortogonalizan en el barrido** como escribir-luego-leer: la capa REFERENCIA **escribe**
> `PriceReference` per-acabado (`tcgcsv_singles`), la capa REGLA (curva) la **lee** para derivar compra/venta y encolar
> pendientes (`pendingReason`). El override manual (§4.27f-2) es tier superior absoluto sobre la capa 1 y sobrevive a
> ambas. **Reconciliación de numeración:** los changelogs internos **v2.x** de la rama (hasta `v2.1.9`) se re-anclan como
> **notas internas del pase de curva**; la línea de contrato de PRODUCCIÓN sigue siendo **v1.x** y bumpéa a **v1.49**. No
> existe una «línea v2» del contrato. **Sin cambio de forma** de los DTO existentes salvo la adición de `priceBasis` (capa
> REGLA v2, adoptada verbatim de la rama); los shapes concretos de la curva (editor M2, `priceBasis`) son los que aterriza
> la rama v2 y backend los confirma al merge — este changelog fija la NORMA de las dos capas, no re-diseña el shape de la
> curva. **Base previa:** v1.48-priceprovider-enum-reconcile.
>
> **Changelog v1.48-priceprovider-enum-reconcile (2026-08-24, arquitecto — CORRECCIÓN DE REDACCIÓN; NO cambia código ni
> shape de DTO. Frontend lo detectó al re-exponer el dial `priceProvider` en la UI de M10, rama de catálogo/precios. NO
> es cambio normativo de comportamiento: reconcilia la DESCRIPCIÓN de §M10 con lo ya vigente en P-47/v1.44 y con el
> validador de backend. Retrocompatible, sin migración. ARCHITECTURE §4.35.):** el enum documentado del dial
> `priceProvider` en **§M10** (definición normativa, y su eco en el Changelog v1.14) quedó **desactualizado**: listaba
> solo `pokemonpricetracker | pokemontcg_io`, **sin `tcgcsv_singles`**, pese a que P-47/v1.44 (§M10-ops job
> `price-ingest`, ARCHITECTURE §4.35) ya lo incorporó como **provider PRIMARIO** del precio por-acabado diario y el
> backend lo valida (`PRICE_PROVIDER_VALUES = ['pokemontcg_io','pokemonpricetracker','tcgcsv_singles']`). **Corrección:**
> el enum válido de `priceProvider` es **`tcgcsv_singles | pokemonpricetracker | pokemontcg_io`**, con semántica —
> `tcgcsv_singles` = **provider PRIMARIO** (precio por-acabado diario, P-47/v1.44); `pokemontcg_io` = **legacy/rollback
> money-safe**; `pokemonpricetracker` = **fallback**. **No cambia la forma del DTO** (el campo ya existe en `GET/PUT
> /admin/settings`), no añade endpoint ni migración; solo alinea §M10 con las secciones P-47 y con `PRICE_PROVIDER_VALUES`.
> **Base previa:** v1.47-manual-override-perennial-candidate.
>
> **Changelog v1.47-manual-override-perennial-candidate (2026-08-24, arquitecto — DISEÑO EN PAPEL; lo implementa BACKEND.
> Re-gate seguridad + techlead sobre P47-2, rama `fix/variant-composition-regression`. NO cambia ningún shape de DTO ni
> endpoint; refuerza la garantía de LECTURA §4.27f-2/§4.27f-3. Money-safe, retrocompatible, sin migración.
> ARCHITECTURE §4.27f-3.):** el re-gate halló que v1.46 era **incompleta**. El tier manual absoluto de v1.46 vive en el
> **comparador** `isBetterRef`, pero el comparador solo puede elegir entre las candidatas que la query trae. Las rutas de
> lectura **single-item** (`getReference`/`getReferenceByCardProduct`) acotan candidatas con `take (=32)` bajo
> `orderBy capturedDate desc`; como el override manual tiene `capturedDate` FIJO y el barrido diario suma ~1 fila/día sin
> purga, tras ~32 días el manual **sale de la ventana** y el feed vuelve a pisar el precio humano **en silencio**. Las
> rutas **batch** (`getReferencesBatch`, `getSeparateProductsByCard`) no tienen cap y por eso **ya** honran el tier
> manual. **Dictamen normativo (§4.27f-3):** la durabilidad cross-day son **DOS capas** — (a) el comparador (ya hecho) y
> (b) la **SELECCIÓN de candidatas**, que DEBE incluir SIEMPRE toda fila manual de la clave (**candidata perenne**, sin
> cota de fecha ni de recencia). Los caminos de lectura deben ser **consistentes** en honrar el tier manual. **Efecto en
> el contrato:** REFUERZA (no cambia) la garantía ya declarada en v1.46 — los DTO con override manual persistido
> reflejan ese valor de forma estable **indefinidamente** (antes: solo ~32 días en las rutas single-item). Sin cambio de
> forma de DTO ni de endpoint. **Base previa:** v1.46-manual-override-durable-cross-day.
>
> **Changelog v1.46-manual-override-durable-cross-day (2026-08-24, arquitecto — DISEÑO EN PAPEL; lo implementa BACKEND.
> Escalada regla 9 (seguridad/blue team), hallazgo ALTA P47-2, rama `fix/variant-composition-regression`. NO cambia ningún
> shape de DTO ni endpoint; solo pin­ea la semántica de precedencia de LECTURA §4.27f. Money-safe (FORTALECE la
> invariante), retrocompatible, sin migración. ARCHITECTURE §4.27f-2 / §4.27f / §4.35(f).):** el comparador de
> resolución de referencia de mercado (`isBetterRef`, precedencia de LECTURA §4.27f) ordenaba `capturedDate` **antes**
> que `sourceRank`, de modo que un **override manual de MERCADO** (`PriceReference source='manual' /
> isManualOverride=true`, `sourceRank=0`) solo ganaba el **mismo día** de su captura. Al pasar `tcgcsv_singles` a
> **escritor DIARIO** (Changelog v1.44/§4.35), el barrido pisaba el override humano **cada día siguiente** por fecha —
> contradiciendo §K/§E.1 (override manual = **máxima precedencia**). **Dictamen normativo (§4.27f-2):** el override
> manual es un **tier SUPERIOR ABSOLUTO, DURABLE cross-day**; `isBetterRef` iza el split manual/no-manual **por encima**
> de `capturedDate`; la frescura desempata **solo dentro del mismo tier**. Un override manual **solo** lo revoca otro
> override manual posterior o la **limpieza explícita por `super_admin`** (`POST /api/v1/admin/pricing/override` de
> nuevo, o borrado money-scoped) — **ninguna** escritura automática lo pisa. *(⚠️ **v1.50.3-d:** el «borrado
> money-scoped» de esta frase **no existía como endpoint**. Hoy existe **solo para estimados por grado**
> —`DELETE /admin/pricing/graded-estimates/:cardId/:gradeValue`, §M2—; para overrides **`raw` y `sealed` sigue sin
> existir**, así que ahí la revocación real es **únicamente** otro override posterior. Ver ARCHITECTURE §4.27f-2 y §9.)* Efecto observable en el contrato: cualquier
> DTO con `marketReferenceMxnCents` / `referenceMxnCents` / `source` / `isManualOverride` (binder, valuación de bóveda,
> `variants[]`, sellado) que tenga un override manual persistido **refleja ese valor de forma estable día tras día**, no
> solo el día de captura. Sin cambio de forma; nota reforzada en `POST /admin/pricing/override` (§ pricing admin) y en
> la nota de `variants[].marketReferenceMxnCents` (§DTOs). **Base previa:** v1.45-fallback-only-is-read-precedence.
>
> **Changelog v1.45-fallback-only-is-read-precedence (2026-08-23, arquitecto — DISEÑO EN PAPEL; RATIFICA implementación
> de BACKEND. Escalada regla 9 (techlead), issue P-47/§4.35b, rama `fix/variant-composition-regression`. NO cambia ningún
> shape de DTO ni endpoint; solo aclara la semántica de «fallback-only». Money-safe, retrocompatible, sin cambio de
> código. ARCHITECTURE §4.35(b)/§4.35(f) + §4.27f):** se **ratifica** que «PPT LIST fallback-only» del barrido diario se
> cumple por **PRECEDENCIA DE LECTURA**, no por una doble-escritura de PPT en vivo. En el barrido `price-ingest` corre
> **UN solo provider (`tcgcsv_singles`, dial `PRICE_PROVIDER`); PPT bulk NO corre**. Las filas PPT que aparecen donde
> TCGCSV no tiene precio son **residuo congelado** previo al switch, que aflora al **resolver** la referencia
> (`sourceRank`/`isBetterRef`, §4.27f). Money-safe: acabado que TCGCSV no cubre → **congela** su último precio real o
> queda `PRICE_PENDING`/«—»; **nunca $0, nunca el de otro acabado**; el hueco de un set nunca resuelto lo cierra el
> `--force` por set. Eco puntual en la nota `v1.44` del job `price-ingest` (§M10-ops). **Base previa:** v1.44-per-finish-price-source.
>
> **Changelog v1.44-per-finish-price-source (2026-08-23, arquitecto — DISEÑO EN PAPEL; lo implementan BACKEND + DEVOPS.
> Escalada regla 9 (backend), issue P-47, rama `fix/variant-composition-regression`. NO cambia ningún shape de DTO ni
> endpoint; solo precedencia de fuente de precio + notas. Money-safe, retrocompatible. ARCHITECTURE §4.35 / §4.27f /
> corrección §4.25a-2.):** tras el fix del aplanamiento de PPT `fetchPrintings` (commit `35e948a`; la API v2 de PPT
> expone UN solo `market`, invariante al `?printing=`), el **barrido diario `price-ingest` pasa a repreciar por-acabado
> desde TCGCSV `tcgcsv_singles`** (fuente primaria por-variante, por `cardProductId`, §4.27e/f) **sin re-resolver
> estructura** (gateada a import/`--force`, §4.27d). **PPT baja a LIST fallback-only** y **`fetchPrintings` se APAGA**
> (dial devops `POKEMONPRICETRACKER_FETCH_PRINTINGS=false`). Sin migración (M-31 ya trae `cardProductId`/`tcgcsv_singles`).
> Eco en §M10-ops (job `price-ingest`) y en la nota de `variants[].marketReferenceMxnCents` (§DTOs). Money-safe: acabado
> sin precio en ninguna fuente ⇒ `PRICE_PENDING`/«—», JAMÁS el de otro acabado.
>
> **Changelog v1.43-sealed-manual-override-survives-dial (2026-08-23, arquitecto — DISEÑO EN PAPEL; lo implementa
> BACKEND. Escalada por regla 9 del gate E2E, issue IMP-C, rama `fix/variant-composition-regression`.
> CLARIFICACIÓN normativa de la precedencia §K del sellado — NO cambia la matemática ni ningún shape; corrige QUÉ gatea
> exactamente el dial `sealedPriceSource`. Money-safe, aditivo, retrocompatible. ARCHITECTURE §4.23a/§4.23d/§10/§11.**
> - **Síntoma (IMP-C):** con el dial `sealedPriceSource=off`, publicar un sellado sin precio escala a la cola de
>   pendientes (M2). El operador usa «FIJAR PRECIO» → `POST /admin/pricing/override` (`productType:"sealed"`,
>   `gradeKey:"sealed:tcg:<productId>"`) `201`, que persiste un **override manual de MERCADO** (`PriceReference
>   source='manual', isManualOverride=true`) y vacía la cola. Pero **re-publicar vuelve a `PRICE_PENDING` y RE-CREA la
>   entrada** (bucle). Causa raíz: `gateSealedMarketCents` (resolver H-1 único, `pricing.service.ts`) anula **TODO**
>   mercado cuando `sourceOn=false`, **incluido el override manual** — contradiciendo §K («override manual >
>   mercado×spread»). Con el dial `on` el mismo override publica bien (verificado).
> - **DICTAMEN (opción a — normativa):** el dial `sealedPriceSource` gobierna **SOLO la FUENTE AUTOMÁTICA de mercado
>   (ingest TCGCSV, `source='tcgcsv'`)**. Un **override manual** — sea el override de VENTA por pieza
>   (`InventoryItem.listPriceCents`, precedencia §K #1) o el **override manual de MERCADO** (`PriceReference` con
>   `isManualOverride=true` / `source='manual'` en la clave `sealed:tcg:<productId>`, que alimenta el nivel
>   «mercado × spread» §K #2/#3) — es una decisión humana explícita que **SOBREVIVE al dial `off`**. `gateSealedMarketCents`
>   deja de gatear el override manual: devuelve su `referenceMxnCents` cuando `isManualOverride/source='manual'`
>   **independientemente de `sourceOn`**, y gatea (devuelve `null` con `sourceOn=false`) **solo** el mercado de fuente
>   automática (`source='tcgcsv'`). Efecto: tras «FIJAR PRECIO», re-publicar usa el override y **NO** re-crea el pendiente.
> - **Reparto:** **backend** (stream «Catálogo y precios», módulo `pricing`) corrige el **único** punto
>   `gateSealedMarketCents`; al ser la única fuente de verdad (H-1) queda arreglado en los 4 consumidores a la vez
>   (`catalog.toListingDTO`, `orders.salePriceOf`, grid `loadPricedSealed`, `bulk-publish`). **Frontend: SIN cambio
>   funcional** — «FIJAR PRECIO» ya postea al `gradeKey` de mercado correcto (por eso funciona con dial `on`).
> - **Money-safe (invariante reafirmado):** sin `listPriceCents`, sin override manual de mercado y sin mercado automático
>   aplicable ⇒ `PRICE_PENDING` (no se publica), **nunca 0**. Un override manual de mercado se resuelve por
>   `mercado × spread` (paridad exacta con dial `on`); un `listPriceCents` por pieza se resuelve verbatim (§K #1). Ambos
>   canales son server-side (SEC-A1). **No es decisión de producto** — §K ya definía el dial como gobernador del *ingest
>   automático* y el override como máxima precedencia; era un bug de gate que confundía «mercado de fuente» con «cualquier
>   mercado incluido el manual». *(Refinamiento OPCIONAL, no bloqueante, para el humano/UX: si se quisiera que «FIJAR
>   PRECIO» del operador fijara el precio de venta EXACTO sin spread, se enrutaría a `listPriceCents` en vez de al override
>   de mercado; hoy se conserva el mecanismo vigente —override de mercado × spread— por coherencia con el dial `on`.)*
>
> **Changelog v1.42-sealed-identity-everywhere (2026-08-23, arquitecto — DISEÑO EN PAPEL; backend/frontend implementan.
> Escalada por regla 9 del gate E2E pre-publicación: 3 incoherencias de identidad/conteo del producto SELLADO — BLOQ-3,
> BLOQ-2a, BLOQ-2b — que el contrato ANTES ordenaba con una cláusula «fuera de alcance cambiarlo» ANTERIOR al módulo
> `SealedProduct` (P-38, §4.34). Con el sellado ya con identidad real, se DICTAMINA cambiar el contrato. Mandato explícito
> del humano: (a) matar el patrón «Tropius» —el sellado mostrándose con nombre/imagen de la carta ancla— en TODAS las
> vistas; (b) inventario limpio para publicar. Todo ADITIVO, RETROCOMPATIBLE y MONEY-SAFE (ningún shape cambia de tipo;
> solo se AÑADEN campos y reglas de conteo/identidad; ningún monto cambia). ARCHITECTURE §4.20b/§4.20d/§4.23g/§4.34a/§10/§11.**
> - **BLOQ-3 (APROBADO) — el master-set binder cuenta SINGLES, EXCLUYE `productType='sealed'` (alinea con H9).** El binder
>   de master set es una vista de la **colección de singles** (carta+acabado). Se DEROGA la regla previa (§4.20b nota
>   v1.16 «cobertura cuenta piezas de CUALQUIER productType», que mapeaba sellado/graded a `finish=normal`) **solo para el
>   sellado**: un ETB anclado a Charizard **YA NO** hace que Charizard cuente «2 piezas / countsByFinish normal:99» ni
>   marque su variante `covered`. **Alcance de la exclusión (los 4 scopes del binder):** `GET /admin/inventory/master-sets`
>   y `.../master-sets/:setId` (scope `platform`, M1) **y** `GET /admin/vaults/:userId/master-sets[/:setId]` y
>   `GET /vault/master-sets[/:setId]` (scope `user_vault`). Afecta: `MasterSetSummaryDTO.{distinctCardsOwned, totalPieces,
>   completionPct}`, `MasterSetCardCellDTO.{countsByFinish, totalCount}`, `MasterSetVariantDTO.{count, covered}` y sus
>   agregados X/Y de completitud — **todos SOLO singles** (`productType ∈ {raw, graded}`, sellado excluido). `catalogCardCount`
>   (denominador = catálogo) **no cambia**. **`buyable` también excluye sellado** (ver BLOQ-3b abajo). El sellado NO
>   desaparece: sigue en sus superficies dedicadas — M1 › pestaña «Sellado» (`GET /admin/inventory/sealed-sets[/:setId]`,
>   §4.26g) y bóveda › pestaña «Sellado» (`GET /vault/sealed`, `GET /admin/vaults/:userId/sealed`). **No se crea endpoint
>   nuevo.** Money-safe: es CONTEO, no dinero. **Resuelve la pregunta abierta WS-IV-1 (§10) para el sellado** por mandato
>   explícito del humano; `graded` **sigue contando** (un slab es una copia real del single de esa `cardId` — fuera de
>   este dictamen, WS-IV-1 permanece abierta solo para graded).
> - **BLOQ-3b (APROBADO, corolario money-adjacent) — `buyable` del binder resuelve solo SINGLES.** La variante faltante
>   (`covered=false`, solo vista (iii) cliente) traía la pieza `listed` más barata de «CUALQUIER productType»: eso ofrecía
>   un ETB sellado como comprable para llenar la casilla de un single (Tropius en el faltante). Ahora `buyable` = la pieza
>   `listed` de plataforma más barata **de un single** (`productType ∈ {raw, graded}`) de ese `(cardId, finish)`, o `null`.
>   SEC-A1 intacto: `salePriceCents` sigue resuelto server-side, jamás del DTO; solo cambia QUÉ piezas son elegibles.
>   **Resuelve WS-IV-2 (§10) para el sellado.**
> - **BLOQ-2a (APROBADO) — `HoldingDTO` (`GET /vault/holdings`) gana la cascada de display de sellado (mata «Tropius» en
>   «Mis piezas»).** Hoy la pieza sellada del cliente se pinta como la carta ancla («E2E Charizard» + imagen del single).
>   Se AÑADEN al item de holdings, **presentes SOLO para `productType='sealed'`** (ausentes/omitidos en raw/graded;
>   aditivo/retrocompatible): `sealedProductId?: string | null` (identidad, FK → `SealedProduct`; `null` para sellado
>   legacy sin ligar), `sealedProductName?: string` (nombre de display **YA RESUELTO server-side** por la cascada §4.34a
>   `SealedProduct` vivo → snapshot `sealedProductName` → `Card.name`; nunca `null` para sellado porque la cascada termina
>   en `Card.name` NOT NULL), `sealedImageUrl?: string | null` (imagen **YA RESUELTA** por la cascada `SealedProduct.imageUrl`
>   → snapshot `sealedImageUrl` → `Card.imageSmallUrl` → `null`), `sealedSubtype?: SealedSubtype | null` y
>   `sealedCondition?: SealedCondition | null` (snapshot por-pieza). Misma cascada ya normada en §4.34a y aplicada en
>   `/vault/sealed` (`VaultSealedGroupDTO`), grid público (`SealedGroupDTO`) y `sealed-sets` (`SealedInventoryGroupDTO`).
>   `card: CardDTO` **se conserva** (pertenencia al set + fallback). Money-safe: display-only, `referenceValue` intacto.
> - **BLOQ-2b (APROBADO) — `PendingPriceEntry` (cola M2, `GET /admin/pricing/pending`) gana identidad de sellado; la clave
>   de la cola discrimina por `sealedProductId`.** Hoy, para sellado **sin mapear**, `gradeKey` es el legacy `'sealed'`, así
>   que un ETB y un blíster de la misma carta ancla **COLAPSAN** en una entrada con nombre ambiguo (terreno SB-D5, curado
>   por P-38). Se AÑADEN, **presentes SOLO para `productType='sealed'`**: `sealedProductId?: string | null` (identidad),
>   `sealedProductName?: string` (display RESUELTO cascada §4.34a, para que el operador vea «ETB …», no «sealed»),
>   `sealedSubtype?: SealedSubtype | null`. **Clave lógica de la cola** para sellado gana `sealedProductId` (misma mecánica
>   que `finish` v1.8-ronda-c y `cardProductId` v1.30): dos pendientes con igual `(cardId, gradeKey, finish)` y distinto
>   `sealedProductId` son entradas **SEPARADAS** — resolver el override de uno **NO** cierra el otro. Con identidad P-38
>   cada presentación tiene su `SealedProduct` (⇒ su `tcgplayerProductId` ⇒ su `gradeKey sealed:tcg:<productId>`), así que
>   ETB y blíster ya no colapsan. **Residual money-safe:** sellado legacy sin `sealedProductId` (que el backfill P-38 no
>   ligó) puede seguir colapsando bajo `gradeKey 'sealed'` hasta curarse en M2; sigue **pendiente, JAMÁS 0**. Migración
>   **M-40** (columna nueva nullable `PendingPriceEntry.sealedProductId String?`, FK → `SealedProduct` `onDelete: SetNull`;
>   `backend/prisma/` es zona compartida — el arquitecto la DEFINE, backend la implementa). Ver §11.
> - **Reparto de trabajo (todo stream «Inventario y vault» salvo lo marcado):** **backend** — (BLOQ-3/3b, módulo `inventory`/
>   `vault`) añadir el filtro `productType != 'sealed'` a las agregaciones del `MasterSetService` (los 4 scopes) y al
>   resolver de `buyable`; (BLOQ-2a, módulo `vault`) poblar los 5 campos de sellado en `GET /vault/holdings` reusando el
>   resolver de cascada §4.34a ya usado en `/vault/sealed`; (BLOQ-2b, módulo `pricing`) migración M-40 + poblar
>   `sealedProductId`/display en `PendingPriceEntry` y meter `sealedProductId` en la clave de dedup/escalada de la cola;
>   tests: sellado NO infla binder ni marca covered, buyable ignora sellado, holdings de sellado pinta la caja (no la
>   ancla), ETB y blíster no colapsan en pendientes, money-safe (sin precio ⇒ pendiente, nunca 0). **Frontend** — (stream
>   «Inventario y vault» / «Órdenes y dinero» según vista) el binder M1 y «Mi bóveda» ya no muestran sellado como single
>   (viene excluido del backend, sin cambio de front salvo copy); «Mis piezas» (`GET /vault/holdings`) pinta la caja usando
>   `sealedProductName`/`sealedImageUrl` cuando `productType='sealed'`; M2 muestra el nombre del sellado en la cola de
>   pendientes. **No hay cambio de schema fuera de M-40; no hay endpoint nuevo.**
>
> **Changelog v1.41-sealed-effective-market (2026-08-23, arquitecto — DISEÑO EN PAPEL; backend/frontend implementan.
> IMP-1, dead-end del alta de sellado detectado por el gate E2E pre-publicación. ARCHITECTURE §4.34d):** cambios
> **ADITIVOS, RETROCOMPATIBLES y MONEY-SAFE** (ningún shape existente cambia de tipo; solo se AÑADEN campos y una regla
> de coherencia UI↔backend).
> - **Raíz del defecto (IMP-1):** el alta de sellado (`SealedAddFlow`) tenía **dos** nociones de «precio de mercado del
>   sellado» y frontend/backend usaban **distintas**. (1) `SealedProductDTO.marketRef` (§M1, `GET
>   /admin/inventory/sealed-products`) = referencia **INFORMATIVA**, live TCGCSV → caché → null, **NO gateada** por el
>   dial `sealedPriceSource`. (2) La valuación real del alta (`aportacion_en_especie`, resolver H-1 §4.23) usa
>   `sealedMarketRef`, que **SÍ está gateado** por `sealedPriceSource` (dial `off`/seed ⇒ `null` ⇒ `422 PRICE_PENDING`).
>   El front decidía la visibilidad del campo de precio manual por `marketRef` (ungated): con el dial `off` mostraba «se
>   registra a valor de mercado: MX$926.81» (de la caché) y **ocultaba** el campo manual, pero el backend valuaba con la
>   referencia gateada (`null`) y devolvía `422 PRICE_PENDING` **sin dónde fijar el precio** → dead-end. El backend SÍ
>   habría aceptado `manualMarketMxnCents` (su referencia efectiva era `null`), pero el manual no se ofrecía.
> - **Dictamen (OPCIÓN a — valor efectivo gateado autoritativo):** se AÑADE al DTO de preview del alta un
>   **`effectiveMarketCents: number | null`** = el mercado del sellado **YA gateado por `sealedPriceSource`**, calculado
>   con la MISMA resolución que la valuación del alta (dial + mapeo). Es `null` **exactamente cuando** el backend
>   valuaría en `PRICE_PENDING` (dial `off`, sin mapeo, o sin precio en la fuente gateada). `marketRef` se conserva
>   **SOLO como INFORMATIVO** (ungated; decoración/frescura, jamás decide UI ni promete un valor de registro). **La
>   regla de visibilidad del campo manual se keyea en `effectiveMarketCents`, NUNCA en `marketRef`/caché.** Se descarta
>   la opción (b) «ofrecer siempre el manual» porque colisiona con `422 MANUAL_MARKET_NOT_ALLOWED`: el backend RECHAZA
>   `manualMarketMxnCents` cuando el mercado efectivo **no** es null (crearía el dead-end inverso). Un único valor
>   autoritativo gobierna ambos lados.
> - **Contrato de coherencia (NORMATIVO, money-safe):** `effectiveMarketCents == null` ⟺ el backend está en
>   `PRICE_PENDING` para esa línea ⟺ el backend ACEPTA `manualMarketMxnCents` (`>0`, `vault_operator+`, auditado) ⟺ el
>   front DEBE mostrar el campo manual (requerido para valuar/publicar). `effectiveMarketCents != null` ⟺ el backend
>   valúa con ese mercado ⟺ el backend RECHAZA `manualMarketMxnCents` con `422 MANUAL_MARKET_NOT_ALLOWED` ⟺ el front
>   OCULTA el manual y muestra «se registra a valor de mercado: $X» usando **`effectiveMarketCents`** (no `marketRef`).
>   La UI **jamás** promete un valor que el backend vaya a rechazar. `0` sigue prohibido (sin precio ⇒ `null`/pendiente).
> - **Shape (aditivo):** `SealedProductDTO` gana **`effectiveMarketCents: number | null`** (autoritativo, gateado);
>   `marketRef: PriceInfo | null` intacto (reetiquetado INFORMATIVO). `SealedProductListResponse` gana
>   **`sealedPriceSource: SealedPriceSource`** (estado del dial una vez por respuesta, para el copy del front:
>   `off` ⇒ «la fuente de precio de sellado está apagada; captura el valor»). El endpoint DEPRECADO
>   `GET /admin/inventory/sealed-catalog` (§4.32a) hereda la misma regla si aún se usa (mismo `effectiveMarketCents`).
> - **Reparto de trabajo:** **backend** (stream «Inventario y vault») expone `effectiveMarketCents` en
>   `GET /admin/inventory/sealed-products` calculándolo con el resolver gateado H-1 (§4.23) — la MISMA función que decide
>   `PRICE_PENDING` en el alta — y `sealedPriceSource` en la respuesta; NO cambia la valuación del alta ni el gate del
>   dial. **Frontend** (stream «Inventario y vault», `SealedAddFlow` paso 2) keyea la visibilidad del campo manual y el
>   copy «valor de mercado» en `effectiveMarketCents` (deja de leer `marketRef`/`liveMarketCents` para esa decisión);
>   `marketRef` queda solo como sugerencia informativa cuando `effectiveMarketCents == null`.
>
> **Changelog v1.40-iva-single-dial-y-orden-set-nuevo (2026-08-23, arquitecto — DISEÑO EN PAPEL; backend/frontend
> implementan. Dos enmiendas aprobadas por el humano: P-37 y P-41-mejora):**
> - **Enmienda A — P-37: `IVA_PCT` queda como FUENTE ÚNICA del IVA (se retira el dial redundante `STRIPE_FEE_IVA_PCT`).**
>   Había **dos** diales del **mismo** 16% de IVA MX en **formatos distintos**: `IVA_PCT` (16, porcentaje `[0,100]`) y
>   `STRIPE_FEE_IVA_PCT` (0.16, fracción `[0,1)`) — redundante y **money-unsafe** (drift si se toca uno y no el otro). El
>   gross-up de Stripe (`grossUpTotal`, ARCHITECTURE §5.1) que hoy lee `stripe_fee_iva_pct` (fracción) pasa a **derivar el
>   IVA de la comisión de Stripe de `IVA_PCT`**: `stripeFeeIvaPct := ivaPct / 100`. **Matemáticamente idéntico** (16/100 =
>   0.16 ⇒ el neteo NO cambia un centavo). **`stripeFeeIvaPct` se RETIRA del DTO de §M10** (deja de leerse/escribirse por
>   `GET/PUT /admin/settings`) y del dial de M10 en la UI. **Compat money-safe:** la clave de BD `stripe_fee_iva_pct` queda
>   **DEPRECADA** — cualquier lectura del gross-up cae **siempre** a `ivaPct/100`, **nunca** a la fila vieja ni a 0; no hay
>   migración de datos (la fila, si existe, queda inerte). **Deltas por rol abajo en §M10 y ARCHITECTURE §5.1.**
> - **Enmienda B — P-41-mejora: el orden global del catálogo/cotizador/búsqueda desempata por SET MÁS NUEVO.** El `orderBy`
>   NORMATIVO **sin `setId`** (§6, ARCHITECTURE §4.22b) desempataba tras `name asc` por **`setId asc`** = **uuid aleatorio**:
>   con muchas variantes del mismo nombre (p. ej. 6 «Tropius») cuál sale primero era **arbitrario** y nunca priorizaba el set
>   reciente (una impresión nueva quedaba fuera del top-N). **Cambio NORMATIVO:** tras `name asc`, se desempata por
>   **`set.releaseDate` desc (más nuevo primero)**, luego `numberPrefix asc → numberSort asc → id asc`. Aplica a catálogo,
>   cotizador y búsqueda. `CardSet.releaseDate` **ya existe** en el schema (`String?`, formato `yyyy/MM/dd` zero-padded ⇒ el
>   orden lexicográfico desc == cronológico desc); **`nulls: 'last'`** para que un set sin fecha NO salte al frente. **Sin
>   cambio de schema.** **Deltas por rol abajo en §6.**
>
> **Changelog v1.39.1-sealed-decisiones-po (2026-08-23, arquitecto — decisiones del humano sobre P-38; SIN cambio de
> shape):** el humano resolvió las 4 preguntas abiertas de §4.34. **Solo #2 cambia norma; #1/#3/#4 confirman.**
> - **#2 (CAMBIO) — precio manual también `vault_operator`:** `BatchInventoryItemInput.manualMarketMxnCents` (fallback
>   money-safe del alta) pasa de **`super_admin`** a **`vault_operator+`** (el operador de bóveda opera el alta). Se mantiene
>   money-safe: solo cuando el mercado en vivo/caché es null, valor `>0`, **auditado**. **`422 MANUAL_MARKET_NOT_ALLOWED`
>   deja de dispararse por rol** — queda **solo** para el caso «intentar sobrescribir un mercado ya resuelto». ⚠ **Este
>   input de dinero por `vault_operator` queda MARCADO para revisión de la fase de seguridad (pentester + seguridad) por
>   release.**
> - **#1 (confirma) — UI SEPARADA por `origin`:** el alta muestra dos secciones «Del set» (`origin=set_main`) vs
>   «Promos/colecciones» (`origin=promo_collection`). Partición de presentación (frontend/ux-ui); `origin` ya viene en
>   `SealedProductDTO` — **sin cambio de shape**.
> - **#3 (confirma) — subtipo `collection`:** `SealedSubtype = {box, etb, upc, bundle, tin, blister, collection}` (como se
>   diseñó).
> - **#4 (confirma) — soft-delete:** producto que desaparece de TCGCSV ⇒ `SealedProduct.active=false` (se conserva por FKs
>   de inventario/órdenes), nunca borrado duro.
>
> **Changelog v1.39-sealed-product-module (2026-08-23, arquitecto — DISEÑO EN PAPEL; backend/frontend implementan. P-38,
> cura de raíz de SB-D5, ARCHITECTURE §4.34):** cambios **ADITIVOS, RETROCOMPATIBLES y MONEY-SAFE**. Materializa la
> entidad de catálogo **`SealedProduct`** (diferida en §4.32d): cada presentación sellada de un set (ETB, **UPC**, Booster
> Bundle, booster box, tin, blíster, colección) es una **fila real** con identidad propia, descargada de TCGCSV por un
> **sync**, en vez de anclarse a un single representativo. Resuelve el defecto «ETB → Tropius #1 · SIN MAPEO»: el alta pasa
> a **seleccionar** un `SealedProduct` y el `InventoryItem` lo referencia por FK (`sealedProductId`). El sync **puebla los
> groupIds del set** (rompe el círculo vicioso: `CardSet.tcgcsvGroupId` ya no requiere un item previo).
> - **`GET /admin/inventory/sealed-products` (NUEVO, `vault_operator+`, §M1) — listar las presentaciones selladas
>   PERSISTIDAS de un set** (fuente del alta). Query `?setId=` (requerido) `&q?` `&origin?` (`set_main`|`promo_collection`)
>   `&principalOnly?`. Res `SealedProductListResponse`: `{ set, needsSync, groups: SealedSetGroupDTO[], data:
>   SealedProductDTO[] }`, ordenado (principales primero, §4.34c), cada producto con `marketRef: PriceInfo | null` (**live**:
>   TCGCSV al vuelo → caché → **`null` money-safe, JAMÁS 0**). Catálogo vacío ⇒ `data:[]` + `needsSync:true`.
>   **SUSTITUYE** a `GET /admin/inventory/sealed-catalog` (v1.36, §4.32a), que queda **DEPRECADO** (alias transitorio que
>   lee la misma tabla; se retira en release posterior).
> - **`POST /admin/inventory/sealed-products/sync` (NUEVO, `super_admin`) — descarga las presentaciones selladas del set
>   (o de todos) desde TCGCSV y las persiste como `SealedProduct`, poblando de paso `CardSet.tcgcsvGroupId` + las filas
>   `SealedSetGroup`.** Req `{ setId?, groupIds?, all? }`. Upsert por `tcgplayerProductId`; descarta singles; infiere
>   subtipo (incl. **upc**); productos ausentes ⇒ `active=false`. **Money-safe:** nunca fabrica precio, nunca toca
>   inventario/valuación. Res `SealedSyncResultDTO`.
> - **`GET /admin/inventory/sealed-products/sync/candidates` (NUEVO, `super_admin`) — grupos TCGCSV candidatos por
>   name-match** (bootstrap del `set_main` + localizar grupos `promo_collection`). Query `?setId=`. Res
>   `{ set, candidates: TcgcsvGroupCandidateDTO[] }`.
> - **`POST /admin/inventory/sealed-sets/:setId/groups` (NUEVO, `super_admin`) — enlaza un grupo TCGCSV extra
>   (promo/colección) al set** (1 set → N grupos, §4.34b). Req `{ tcgplayerGroupId, kind }`. Res `SealedSetGroupDTO`.
> - **Alta = SELECCIONAR — reusa `POST /admin/inventory/items/batch`.** `BatchInventoryItemInput` gana **`sealedProductId?`**
>   (solo `sealed`): presente ⇒ el backend **deriva server-side** `cardId` (ancla), mapeo, imagen/nombre y subtipo desde el
>   `SealedProduct`, congela el snapshot, y la pieza **nace con identidad correcta** («ETB …», no la Tropius). Precio **en
>   vivo** al alta (TCGCSV on-demand → caché → null). **Fallback manual money-safe:** `manualMarketMxnCents?` por línea,
>   aceptado SOLO cuando el mercado resuelto es `null`, `> 0`, **auditado**, **`super_admin`**; sin override ⇒
>   `422 PRICE_PENDING`. **Nunca** 0. Los campos sueltos M-37 (`tcgplayerProductId`/`sealedImageUrl`/…) quedan
>   **deprecados** (aceptados en transición; si viene `sealedProductId` mandan los derivados).
> - **Enum `SealedSubtype` gana `upc` y `collection`** (hueco 2; Prisma + contrato). Catálogo + orden + «principales» en
>   §4.34c. `inferSealedSubtype` reconoce UPC (antes que ETB/collection).
> - **Deltas de schema (migración M-39, ADITIVA/reversible, money-safe) — para backend:** tablas nuevas `SealedProduct` y
>   `SealedSetGroup` (enlace 1 set → N grupos), enum `SealedGroupKind`, `InventoryItem.sealedProductId String?` (FK), +2
>   valores de enum. Backfill: siembra grupos desde `CardSet.tcgcsvGroupId`, deriva `SealedProduct` de items mapeados y liga
>   `sealedProductId` (cura ETB→Tropius); sin-mapeo → null + reconciliación. Ver ARCHITECTURE §4.34e + §11 (M-39).
> - **Errores nuevos:** `422 SEALED_PRODUCT_NOT_FOUND` (`sealedProductId` inexistente/inactivo), `422 MANUAL_MARKET_NOT_ALLOWED`
>   (`manualMarketMxnCents` con mercado ya resuelto, o rol < vault_operator). `422 PRICE_PENDING`/`VALIDATION_ERROR` sin cambio.
>
> **Changelog v1.38-grouped-listings (2026-08-22, arquitecto — DISEÑO EN PAPEL; backend/frontend implementan. P-30,
> catálogo de singles agrupado por stock):** hoy `GET /catalog/cards` y `GET /catalog/cards/:cardId` devuelven **un
> `ListingDTO` por CADA copia física** (`InventoryItem`): tres Tropius raw NM en bóveda ⇒ tres publicaciones separadas
> («01/02/03 Tropius»). Se sustituye por **UNA publicación agrupada por `(carta, productType, gradeKey, finish)`** con
> **`stockCount`** (nº de piezas vendibles), **precio único de la variante** y estado **vivo mientras `stockCount≥1`**
> (agotado ⇒ **desaparece** de Compra, money-safe). Es el MISMO patrón ya probado del sellado (`GET /catalog/sealed` →
> `SealedGroupDTO` con `availableCount`, v1.23-sealed-sales); ahora se aplica a los **singles** (raw/graded). **CAMBIO DE
> SHAPE (breaking) de `/catalog/cards*`** — se coordina con el rediseño visual del storefront, que construye la grilla/
> ficha contra el shape agrupado final (ver nota de coordinación abajo y ARCHITECTURE §4.9a). Detalle:
> - **DTOs nuevos:** `GroupedListingDTO` (grupo con `representativeInventoryItemId`, `stockCount`, `salePriceCents` único,
>   `referenceValue`, atributos de variante), `GroupedListingListResponse`, `GroupedListingDetailResponse`. Ver §DTOs.
> - **`GET /catalog/cards`** (§2): `Res 200` pasa de `{ data: ListingDTO[], … }` a **`{ data: GroupedListingDTO[], … }`**;
>   `total` = nº de **grupos** (no de piezas). Filtros/sort/paginación **sin cambio de forma** (aplican sobre el grupo:
>   `salePriceCents` del grupo, `createdAt` de su pieza más nueva). Cada grupo devuelto tiene `stockCount≥1`.
> - **`GET /catalog/cards/:cardId`** (§2): `Res 200` pasa de `{ card, listings: ListingDTO[] }` a
>   **`{ card, listings: GroupedListingDTO[], units: ListingDTO[] }`**. `units` = TODAS las piezas vendibles de la carta
>   (por-pieza, más baratas primero) SOLO para resolver el **add-to-cart por `inventoryItemId`** (el carrito sigue siendo
>   por-pieza, §4/§4-G, sin cambio) — **NO** es la grilla de navegación. Espeja `SealedGroupDetailResponse.listings`.
> - **`GET /catalog/listings/:inventoryItemId`** (§2): **SIN cambio** (sigue `ListingDTO` por-pieza; lo usa el re-quote del
>   carrito, v1.21.3). **`GET /catalog/facets`**: **SIN cambio** (los `distinct`/rangos sobre el inventario publicado son
>   idénticos con o sin agrupar; el precio del grupo = precio de sus piezas).
> - **Clave de agrupación = clave de PRECIO** (`gradeKeyFor(item)` + `finish` + `productType` + `cardId`): exactamente la
>   que hoy resuelve `salePriceCents` por pieza en `fetchSellable`/`toListingDTO` ⇒ **un solo precio por grupo** por
>   construcción. `stockCount` = conteo de piezas `sellable` (money-safe: una pieza sin precio no cuenta ni publica).
> - **Sin schema/migración:** el grupo es una **agregación en LECTURA** (reduce en memoria sobre el set `sellable`, como el
>   sellado); NO hay contador denormalizado (cero doble-escritura / drift). Publicar/despublicar N piezas = flip de
>   `status='listed'` por pieza (M1, sin cambio) ⇒ el `stockCount` **derivado** sube/baja solo. ARCHITECTURE §4.9a.
> - **Sellado intacto:** `/catalog/sealed*` no cambia; H9 (singles excluyen `productType='sealed'`) sigue vigente — el
>   catálogo de singles agrupa SOLO raw/graded, el sellado conserva su propio catálogo agrupado.
>
> **Changelog v1.37.1-tiers-example-fix (2026-08-22, arquitecto — CORRECCIÓN DE EJEMPLO, NO NORMATIVO. P-34,
> DEUDA-tiers-2 / H7):** QA/techlead detectaron que el **ejemplo JSON ilustrativo** de `GET /admin/pricing/tiers`
> mostraba `finishRules.sell = { reverse_holo: fixed 1500 }` (valor 1500 y **omitía** `holofoil`), contradiciendo el
> seed real / NORMA §4.33e («las de hoy, SIN cambio»). Se alinea SOLO el ejemplo a
> `finishRules.sell = { holofoil: fixed 1000, reverse_holo: fixed 1000 }` (el backend ya implementó lo normativo).
> **Sin cambio de norma §4.33e ni de shape**; `finishRules.buy` del ejemplo (`reverse_holo: fixed 150`) ya reflejaba
> el seed de buylist y queda igual. Verificado: no hay otros ejemplos del contrato con el mismo desfase.
>
> **Changelog v1.37-pricing-tiers (2026-08-22, arquitecto — DISEÑO EN PAPEL; backend/frontend implementan. P-34,
> PROJECT §M v1.9 LOCKED, ARCHITECTURE §4.33):** el editor de precios de M2 pasa de «una fila por CADA rareza
> canónica» (~30) a «una fila por `tier`» (**5 tiers T0–T4**) + un **mapa rareza canónica → tier** compartido por
> compra y venta. Cambios **MONEY-SAFE**; la naturaleza de la regla (`fixed`/`pct`), la precedencia y el eje `finish`
> **no cambian** (los tiers solo re-expresan el eje rareza de `PriceRuleSet`, §4.28d). **Único cambio intencional:
> T2 (Rare/Holo) → `pct` 25%.**
> - **`GET /admin/pricing/tiers` (NUEVO, `super_admin`, §M2) — lee los 5 tiers con su regla de COMPRA y VENTA + el eje
>   acabado (`finishRules`) + fallbacks.** Res `{ tiers: TierRuleDTO[5], finishRules:{ buy, sell }, fallbackPct:{ buy,
>   sell } }`. Cada `TierRuleDTO = { id:'T0'..'T4', name, premium, buy: Rule, sell: Rule, rarityCount }`. `name`/
>   `premium` son taxonomía LOCKED (`common/pricing-tiers.ts`), NO editables. Read-only, no muta.
> - **`PUT /admin/pricing/tiers` (NUEVO, `super_admin`) — reemplaza los VALORES de las 5 reglas (buy y sell) + eje
>   acabado + fallbacks.** Req `{ tiers:[{id, buy, sell}], finishRules?:{buy?,sell?}, fallbackPct?:{buy?,sell?} }`.
>   `name`/`premium` se ignoran si vienen. Valida el **invariante de refinamiento** (§4.33d) contra el mapa vigente:
>   un tier con reglas de compra `fixed` no puede tener rareza premium mapeada ⇒ `422 PREMIUM_RARITY_FIXED_TIER`.
>   Cambiar la regla de un tier **repricia todas** sus rarezas (criterio 74). **Auditado**, sin redeploy.
> - **`GET /admin/pricing/tier-map` (NUEVO, `super_admin`) — el mapa rareza canónica → tier**, unido al catálogo.
>   Res `{ tiers:[{id,name,premium}], rarities: TierMapRowDTO[] }`; cada fila `{ canonical, premium, mapped, cardCount,
>   tierId|null, source:'map'|'fallback' }`. `tierId:null` = rareza del catálogo sin mapear ⇒ cae al fallback pct.
> - **`PUT /admin/pricing/tier-map` (NUEVO, `super_admin`) — reasigna rarezas a tiers** (Opción B, editable por el
>   dueño). Req `{ assignments: { [canonical]: TierId } }` (patch parcial). Valida el **invariante de refinamiento**
>   (una rareza premium a un tier de compra `fixed` ⇒ `422 PREMIUM_RARITY_FIXED_TIER`, con los pares infractores) y
>   que `TierId ∈ {T0..T4}` (`422 VALIDATION_ERROR`). **Auditado**, sin redeploy.
> - **DEPRECADOS/superseded:** `GET/PUT /admin/pricing/buylist-rules` y `/sales-rules` (mapa plano rareza→regla, §4.28d)
>   quedan **superseded por `/tiers` + `/tier-map`**. Los `GET` pueden mantenerse como lectura del `PriceRuleSet`
>   **efectivo** (derivado de tiers×mapa, §4.33c) durante la transición; los `PUT` se **retiran**. `GET
>   /admin/pricing/rarities` (+ `/sales-rarities`) ganan `tierId` + `source` y su `rule` refleja la regla RESUELTA vía
>   tier (retrocompatibles).
> - **Persistencia (migración M-38 — DATA/seed, SIN DDL) — para backend:** NO hay cambio de schema Prisma. Nuevo
>   `SettingKey` `PRICING_TIER_MAP` (`pricing_tier_map`, mapa compartido); RESHAPE de `BUYLIST_PRICE_RULES`/
>   `SALES_PRICE_RULES` de `{ rarityRules, ... }` a `{ tierRules, finishRules, fallbackPct }`; nueva constante
>   `common/pricing-tiers.ts`; +2 canónicas premium y +1 alias en `common/rarity-catalog.ts` (cierre de las `unmapped`
>   Mega Hyper Rare→T4, `MEGA_ATTACK_RARE`/Black White Rare→T3); backfill de `Card.rarityCanonical` de esas rarezas.
>   Ver ARCHITECTURE §4.33 + §11 (M-38). **Nota T2/Uncommon:** T2 baja de 40%→25% (LOCKED); el mapa sube **Uncommon**
>   de compra $0.50→$1.50 (T1) — bandera para PO (DEV-tiers-1, §4.33g), reversible sin código.
>
> **Changelog v1.36-sealed-alta (2026-08-22, arquitecto — DISEÑO EN PAPEL; backend/frontend implementan. P-35,
> PROJECT §K/§F-M1, decisión v1.6 «Sellado»):** cambios **ADITIVOS, RETROCOMPATIBLES y MONEY-SAFE**. Resuelve el
> defecto de M1 → pestaña **Sellado**: el modal de alta reutiliza el **buscador de CARTAS** (singles) y, al elegir
> set + Tipo=Sellado, sigue mostrando singles en vez de **productos sellados** (ETB, booster box, blíster). Se añade
> un flujo DEDICADO que **lista los productos sellados del set con su imagen de API** (TCGCSV/TCGplayer, mapeo
> M-23) y un alta que **nace mapeada** (valuación inmediata, sin curación M2 aparte). Ver ARCHITECTURE §4.32.
> - **`GET /admin/inventory/sealed-catalog` (NUEVO, `vault_operator+`, §M1) — listar productos SELLADOS de un set,
>   NO singles.** Query `?setId=<localSetId>` (requerido) `&groupId?` (override) `&q?`. Resuelve el set → **grupo
>   TCGCSV** (precedencia: `groupId` explícito > `CardSet.tcgcsvGroupId` > `DISTINCT tcgplayerGroupId` de hermanos
>   sellados ya mapeados del set) y reusa el **proxy read-only server-side** existente (host fijo anti-SSRF, misma
>   familia que `/admin/pricing/sealed/tcgcsv/groups/:groupId/products`). Devuelve `SealedCatalogProductDTO[]`: cada
>   producto con `tcgplayerProductId`, `name`, `sealedSubtype` inferido (heurística de nombre; `null` si no se
>   infiere → el operador elige), **`imageUrl` de la API** y **`marketRef: PriceInfo | null`** (informativo; sin
>   precio en TCGCSV ⇒ **`null` = pendiente/`—`, NUNCA `0`**). Grupo no resoluble ⇒ `200` con `data:[]` +
>   `groupResolved:false` (el front ofrece fijar el grupo). Err `404 NOT_FOUND` (set), `502 UPSTREAM_ERROR` (TCGCSV).
> - **Alta de inventario sellado — SIN endpoint nuevo: reusa `POST /admin/inventory/items/batch`.** El
>   `BatchInventoryItemInput` (y el singular `POST /admin/inventory/items`) gana 4 campos ADITIVOS/opcionales, SOLO
>   `productType='sealed'`: `tcgplayerProductId?`, `tcgplayerGroupId?` (se fijan **juntos**; la pieza **nace mapeada**
>   → `sealedMarketRef` y valuación de aportación funcionan sin curación M2 aparte), `sealedImageUrl?` y
>   `sealedProductName?` (imagen/nombre de la API del sellado, **validados server-side** contra el host allowlist de
>   imágenes TCGplayer/TCGCSV; `null`/omitidos ⇒ fallback a la `Card` ancla). `qty` + `batchKey` = **MISMA
>   idempotencia** que hoy (`InventoryBatch` M-21, `kind='create'`). Aportación de sellado valúa por `sealedMarketRef`
>   (H-1, §4.23), no por el gradeKey legacy `'sealed'`; sin mercado ⇒ `422 PRICE_PENDING` por línea.
> - **Deltas de schema (migración M-37, ADITIVA, money-safe) — para backend:** `CardSet.tcgcsvGroupId Int?` (grupo
>   TCGCSV curado por set; resuelve el listado; `null` ⇒ fallback por hermanos mapeados) + `InventoryItem.sealedImageUrl
>   String?` y `InventoryItem.sealedProductName String?` (imagen/nombre del producto sellado desde la API; display-only,
>   arreglan que el sellado muestre la **caja** y no el single ancla en Compra/bóveda/M1). Las columnas de mapeo
>   (`InventoryItem.tcgplayerProductId/tcgplayerGroupId`) **ya existen** (M-23): el alta solo las **puebla**. Ver
>   ARCHITECTURE §4.32 + §11 (M-37). El refactor mayor (entidad `SealedProduct` de catálogo, llaveada por productId)
>   queda **DIFERIDO** y documentado (SB-D5 / §4.32d): NO se hace en este cambio.
> - **DTOs de display del sellado prefieren los campos nuevos:** `SealedGroupDTO`/`VaultSealedGroupDTO`/
>   `SealedInventoryGroupDTO` resuelven `imageUrl`/`productName` desde `sealedImageUrl`/`sealedProductName` cuando
>   existen, y caen a la `Card` ancla cuando son `null` (retrocompatible; ninguna forma de DTO cambia).
>
> **Changelog v1.35-inventory-bulk-remove-idempotency (2026-08-22, arquitecto — PRECISIÓN enrutada por QA/techlead
> (hallazgo MAYOR, Cluster 2); cambios ADITIVOS, RETROCOMPATIBLES y MONEY-SAFE):** dos aclaraciones sobre
> `POST /admin/inventory/items/bulk-remove` (P-29), para dejar el contrato idéntico a lo que backend debe exponer y
> frontend consumir:
> - **`note` es OBLIGATORIO (no opcional).** El DTO backend lo declara `@IsString() note!: string` y el
>   `ValidationPipe` global rechaza la llamada sin él (`400 VALIDATION_ERROR`). Se reafirma `note` como campo
>   **requerido** (string no-vacía, motivo/nota de la baja) en el request, la prosa y los errores; **no** aparece
>   como opcional en ningún punto del endpoint.
> - **Idempotencia por `batchKey` (cierra el «encogimiento fantasma»).** `bulk-remove` acepta ahora un `batchKey`
>   con la **MISMA forma y semántica** que su hermano `adjustFound` (`InventoryAdjustmentRequest.encontrada`, v1.20.1,
>   BE-47) y que `publish-all`: `batchKey?` **opcional**, persistido en `InventoryBatch` (M-21) con
>   `kind='bulk_remove'`. Un reintento tras un timeout ambiguo con el mismo `batchKey` **NO** vuelve a dar de baja
>   otras N piezas: el replay **devuelve el resultado guardado** de la primera ejecución con `idempotentReplay: true`
>   (mismo `200`), sin tocar status ni escribir un segundo lote de ajustes. Se añade `batchKey?` +
>   `idempotentReplay: boolean` al `BulkRemoveResponse`. El front DEBE enviarlo desde el diálogo de baja (anti
>   doble-submit / anti reintento-fantasma).
>
> **Changelog v1.34-inventory-bulk-remove-export (2026-08-22, arquitecto — FORMALIZACIÓN de lo YA implementado por
> backend; `BACKEND_NOTES.md` §0-P29/P31. DoD «docs al día»):** cambios **ADITIVOS, RETROCOMPATIBLES y MONEY-SAFE**.
> Formaliza en §M1 (Stream B) dos endpoints nuevos del módulo `inventory` (P-29/P-31 de `PENDIENTES.md`), ambos
> `vault_operator` + `super_admin`:
> - **`POST /admin/inventory/items/bulk-remove` (P-29)** — baja rápida por **CANTIDAD**: da de baja **N piezas de un
>   golpe** de un `(cardId, finish[, condición])` sin ir pieza por pieza. **Reusa el pipeline de ajustes M-24** (mismo
>   mapeo de motivos `perdida→lost`/`danada→damaged`/`error_captura→withdrawn`, mismo allowlist, mismo rastro triple);
>   lo nuevo es que **selecciona server-side** las N piezas (`in_stock` antes que `listed`, FIFO por `createdAt`).
>   **Money-safe:** solo transiciona `status` (baja de stock); **NO** toca precios/órdenes ni escribe `reserved`/`listed`
>   (no vende ni publica). **Atómico:** si hay menos piezas ajustables que `quantity` ⇒ `422 INSUFFICIENT_STOCK` y **no
>   baja ninguna**. Rastro triple por pieza (`InventoryMovement` + `InventoryAdjustment` + `AuditLog
>   action=inventory.bulk_remove`).
> - **`GET /admin/inventory/export.xlsx` (P-31)** — export del inventario de **plataforma** a **`.xlsx` real** (OOXML,
>   lib `exceljs`), **una fila por folio/pieza**. Filtros opcionales `setId`/`productType`. **Money-safe:** todas las
>   columnas de dinero son **STORED** (costo, mercado, compra, venta), sin derivar ni inventar; **sin dato ⇒ celda VACÍA,
>   nunca `0`**. Respuesta binaria con cabeceras de descarga (`Content-Disposition: attachment`).
> - **Nuevo código de error `422 INSUFFICIENT_STOCK`** (§Errores) — ya en el enum central `common/error-codes.ts`.
>
> **Changelog v1.33-master-set-multipart (2026-08-22, arquitecto — DISEÑO EN PAPEL; backend/frontend implementan.
> P-27, PROJECT §L, criterios 65–72, decisiones D1–D5):** cambios **ADITIVOS y RETROCOMPATIBLES**, **money-safe**.
> Un set multi-parte (principal + subset(s) con id propio: Celebrations `cel25` + Classic Collection `cel25c` = 50) se
> presenta como **UN master set combinado**, con separador/etiqueta por subset. **SOLO presentación**: cada carta
> conserva su set-id de origen; precio/inventario/bóveda operan por set-id real, sin cambio de dato. Ver ARCHITECTURE §4.31.
> - **Dónde vive el mapa:** constante curada `backend/src/config/master-set-groups.ts` (padre→subset por `externalId`
>   de pokemontcg.io), **NO** columna de schema ni tabla — sin migración, extensible sin tocar código de presentación
>   (CA-69). Arranca con `cel25`→`cel25c` (label "Classic Collection"); candidatos Shiny Vault (Shining Fates
>   `swsh45`→`swsh45sv`, Hidden Fates `sm115`→`sma`) **sujetos a validación de backend contra el catálogo real**.
> - **Binder `GET /admin/inventory/master-sets/:setId`** (y `GET /vault/master-sets/:setId`,
>   `GET /admin/vaults/:userId/master-sets/:setId` — **heredan** el fan-in por el read model único §4.20): fan-in de
>   `Card WHERE setId IN partSetIds`; `set` = principal; bloque principal primero, luego cada subset (orden natural
>   dentro del bloque); `catalogCardCount`/`printedTotal` = **Σ de las partes** (Celebrations = 50). **Aditivo:**
>   `MasterSetBinderResponse += { parts?: SetPartDTO[], canonicalSetId? }` y `MasterSetCardCellDTO += { partSetId?,
>   partLabel? }`. Pedir el binder por un **subset** (`cel25c`) **normaliza a su principal** y devuelve `canonicalSetId`
>   (el front actualiza la URL; no más binder roto de 25).
> - **Índice `GET /admin/inventory/master-sets`** (y vault): los subset se **pliegan** en la fila del principal y sus
>   agregados se **suman** sobre `partSetIds`; los subset **no** aparecen como filas propias. **Aditivo:**
>   `MasterSetSummaryDTO += { partSetIds?: string[] }`. Sin N+1 (se agrupan por set-id canónico los resultados de las
>   agregaciones fijas ya existentes).
> - **Storefront:** `GET /catalog/sets` **pliega** el subset (Celebrations una vez) y gana `partSetIds?`;
>   `GET /catalog/cards?setId=<principal>` **expande** a `setId IN partSetIds` (aditivo, solo sets mapeados) respetando
>   la Regla de Compra (solo se lista lo que tiene precio). Gráfica de valor de set suma partes (derivado, opcional).
> - **Money-safe (CA-68/CA-72):** el mapa es **solo lectura de presentación**, jamás fuente de verdad; ninguna ruta de
>   escritura/dinero (batch, bulk-publish, adjustments, órdenes, pricing, sync, buylist) lo consulta. `scopeWhere` y las
>   agregaciones filtran por `cardId` (llaveado a su set real). Verificable: precio/folio/titularidad de una `cel25c`
>   idénticos con y sin grupo.
> - **Casos borde:** N subsets (`subsets[]`); subset sin su principal → no se pliega (se muestra como su set, sin 500,
>   CA-71). Sin enum nuevo, sin migración, sin cambio de rutas.
>
> **Changelog v1.32-unify-rarities (2026-08-22, arquitecto — FORMALIZACIÓN de lo YA implementado; cierra dos
> hallazgos de QA sobre el contrato, DoD «docs al día»):** cambios **ADITIVOS y RETROCOMPATIBLES**, money-safe.
> - **Formaliza `POST /admin/catalog/unify-rarities`** (backend ya lo implementó; `BACKEND_NOTES.md` §0-ter) en la
>   familia de backfill de §M2, enmarcado en ARCHITECTURE §4.28 (catálogo canónico de rarezas). `@Roles(super_admin)`,
>   **síncrono 200**, sin body relevante. Res: `{ ok, cardsProcessed, cardsUpdated, distinctCanonical, unmapped:[{ raw,
>   canonical, count }] }`. Semántica: **backfill idempotente** que reescribe `Card.rarityCanonical = normalizeRarity(
>   rarity)` desde la columna **LOCAL** `rarity` (sin pokemontcg.io **ni** TCGCSV), **money-safe** (única columna
>   escrita = `rarityCanonical`; NO toca `PriceReference`/precios/composición). `unmapped` = rarezas crudas sin entrada
>   en `CANONICAL_RARITIES` (para saber cuáles añadir al catálogo canónico). Ver §M2.
> - **`GET/PUT /admin/pricing/rarity-map` → RETIRADOS** (antes «DEPRECADOS… se conservan hasta su retiro»): el código
>   ya los **retiró** junto con el setting `RARITY_MAP` (`BACKEND_NOTES.md` §0-quater). Reemplazados por
>   `BUYLIST_PRICE_RULES`/`SALES_PRICE_RULES` (§4.28d) + el catálogo canónico (§4.28c) y su endpoint `rarities`. Ver §M2/pricing.
> - **Follow-up de backend (recordatorio, no bloquea, zona compartida):** `UPSTREAM_ERROR` y `SET_NOT_IMPORTED` viven
>   hoy por cast `as ErrorCodeType`; falta añadirlos al enum central `common/error-codes.ts` y quitar los casts (tarea
>   de backend en su turno de zona compartida). El contrato ya los declara normativos (§Errores).
>
> **Changelog v1.31-refresh-variants-tcgcsv (2026-08-22, arquitecto — FORMALIZACIÓN de lo YA implementado;
> cierra incumplimiento de DoD «docs al día» reportado por QA):** cambios **ADITIVOS y RETROCOMPATIBLES**,
> money-safe (variante sin precio ⇒ `PRICE_PENDING`/«—» = `null`; **jamás 0**). Formaliza en §M2 la familia de
> **backfill solo-TCGCSV** que el frontend ya consume pero **no estaba documentada** (backend la describió en
> `BACKEND_NOTES.md` §0-bis M-34 y §0-quater M-35). Enmarca dentro de la decisión de ARCHITECTURE §4.27–§4.30
> (TCGCSV = fuente de **estructura + precio**; estos endpoints son la operación de **reparación de variantes**
> —el `normal` fantasma pre-M-31— **sin tocar pokemontcg.io**, para poder arreglar sets ya importados aunque
> pokemontcg.io esté caído). Endpoints nuevos:
> - **`POST /admin/catalog/refresh-variants` (M-34, `super_admin`, 200):** refresca variantes (finishes) + precios
>   de UN set ya importado, SOLO TCGCSV. Hermano acotado de `sync {setId, force:true}` que **NO** llama a
>   pokemontcg.io. Ver §M2.
> - **`POST /admin/catalog/refresh-variants-all` (M-35, `super_admin`, 202):** versión BATCH del anterior sobre
>   **todos** los sets importados (universo desde BD local), fire-and-forget, resiliente por-set. Ver §M2.
> - **`GET /admin/catalog/refresh-variants-status` (M-35, `super_admin`, 200):** progreso + `summary` agregado del
>   batch, para polling (mismo mecanismo que `sync-status`). Ver §M2.
> - **Códigos de error documentados:** `502 UPSTREAM_ERROR` (fuente externa TCGCSV no disponible) y **`409
>   SET_NOT_IMPORTED`** (el set no está importado en BD) — ver §Convenciones/Errores. **Follow-up de backend
>   (no bloquea, zona compartida):** ambos viven hoy por cast `as ErrorCodeType`; falta añadirlos al enum central
>   `common/error-codes.ts` y quitar los casts. El contrato ya los declara normativos.
>
> **Changelog v1.30-buylist-quote-por-producto (2026-08-22, arquitecto — DISEÑO EN PAPEL; backend/frontend
> implementan):** cambios **ADITIVOS y RETROCOMPATIBLES**, money-safe (PRICE_PENDING y «—» = `null` preservados;
> guards H1/H2/H3 + MoneyOutGuard intactos). Cierra el hueco detectado por el front tras v1.29: la línea de
> cotización/venta de buylist se identificaba SOLO por `(cardId, finish)`, así que un **producto separado**
> (`CardProduct` `kind ∈ {deck_exclusive, promo}` — p. ej. «Voltaic Lightning Energy 084/084 Deck Exclusives»,
> productId TCGplayer **707029**, distinto del set_base **704841** que comparte número 084/084) **no podía cotizarse
> ni ir al carrito como LÍNEA PROPIA** sin fusionarse con la carta de set. Spec en ARCHITECTURE §4.29 (referencia a
> §4.27/§4.28). **Resolución** = reusa `CardProduct` + `PriceReference.cardProductId` de M-31 (§4.27b), sin migración
> nueva para leer precios. **Persistencia** = una migración ADITIVA menor **M-32** (`SellRequestItem.cardProductId?` +
> `PendingPriceEntry.cardProductId?`, ambas nullable), análoga a como v1.6-finish añadió `SellRequestItem.finish`
> (M-19). Nada se dropea; clientes/filas viejos con `cardProductId = null` = línea de set_base.
> - **(1) `productId?: number` OPCIONAL y ADITIVO** en la LÍNEA de buylist: `BuylistQuoteItemDTO` (batch
>   `POST /buylist/quote/batch`), `Req` de `POST /buylist/quote` (por-carta), y `items[]` de
>   `POST /buylist/requests`. Es el **mismo `productId`** que el front ya recibe en `CardProductDTO.productId`
>   (`separateProducts`, v1.29) — el TCGplayer `productId` (== `CardProduct.tcgplayerProductId`), NO el UUID interno.
> - **(2) Eco en la RESPUESTA:** `BuylistQuotePayload` (por-carta y por-ítem del batch) y `SellItemDTO` ganan
>   **`productId?: number`** (snapshot del producto cotizado; ausente ⇒ línea de set_base, comportamiento actual).
> - **(3) Semántica de resolución (NORMATIVA §4.29):** **con `productId`** → la línea es ESE `CardProduct` concreto;
>   whitelist de acabado = `CardProduct.finishes` (no `Card.availableFinishes`); la referencia de mercado se lee de
>   `PriceReference` filtrada por ese `cardProductId` (precio propio del producto). **Sin `productId`** → EXACTAMENTE
>   el comportamiento de hoy: producto de set por `(cardId, finish)` (clientes viejos no cambian). La **rareza** sigue
>   saliendo de la carta (`rarityCanonical`), el **acabado** del producto — encaja con `PriceRuleSet` (§4.28d).
> - **(4) Validación money-safe:** `productId` inexistente ⇒ **`PRODUCT_NOT_FOUND`**; `productId` que NO cuelga del
>   `cardId` ⇒ **`PRODUCT_CARD_MISMATCH`** (rechazo validado, **jamás fusión silenciosa** con la carta base);
>   `finish` fuera de `CardProduct.finishes` ⇒ **`FINISH_NOT_AVAILABLE`**. Producto sin precio en ninguna fuente ⇒
>   `precio_pendiente` / «—» (`null`), **nunca 0**; el pago sigue bloqueado por MoneyOutGuard hasta que el dueño lo
>   fije. En el batch, los tres son errores **por-ítem** (`ok:false`, no tumban el lote); en por-carta/`requests` son
>   `422`.
> - **(5) Unicidad de línea:** la llave lógica de la línea gana `productId` → **`(cardId, finish, productId ?? base)`**.
>   Dos líneas con el mismo `(cardId, finish)` pero distinto `productId` son **DISTINTAS** (no se fusionan/deduplican);
>   `productId` ausente = la línea `base` (set_base). Espeja el `@@unique … cardProductId` de `PriceReference` (M-31,
>   §4.27b). El `index` 0-based del batch sigue siendo la llave de correlación (ya robusta a repeticiones). Detalle
>   abajo en §DTOs y §M5.
>
> **Changelog v1.29-tcgcsv-productos-por-variante (2026-08-22, arquitecto — DISEÑO EN PAPEL; backend/frontend
> implementan):** cambios ADITIVOS y money-safe (PRICE_PENDING y «—» = `null` preservados). Spec en ARCHITECTURE
> §4.27 (composición+precio por `productId`) y §4.28 (rareza canónica). (1) **Producto vendible separado
> («Deck Exclusives»/promo):** `MasterSetCardCellDTO` y el cotizador ganan `separateProducts?: CardProductDTO[]` — los
> `CardProduct` de `kind ∈ {deck_exclusive, promo}` de la carta, cada uno con su `productId`, `kind`, `name`,
> `finishes[]` y precio por variante (`marketReferenceMxnCents | null`). (2) **`availableFinishes` y
> `variants[].marketReferenceMxnCents` no cambian de FORMA** pero ahora son EXACTOS (leídos por producto desde TCGCSV,
> sin fantasma). (3) **`displayFinishes` queda DEPRECADO** (= `availableFinishes`; ya no hay casilla espuria que
> ocultar; retiro en la siguiente rev de front). (4) **Precio de singles:** referencia = TCGCSV primario (USD→MXN vía
> FX Banxico existente) › PPT fallback › «—» + PRICE_PENDING; `PriceSource` gana `tcgcsv_singles`. (5) **Rareza
> canónica:** `GET /admin/pricing/rarities` (y su eco de ventas) agrupan por `rarityCanonical` (no por `rarity` crudo)
> y devuelven `{ canonical, raw?, premium, rule?, source }`; las reglas se editan en DOS ejes
> `PriceRuleSet { rarityRules, finishRules, fallbackPct }` (separa rareza-de-la-carta de acabado-de-la-variante;
> retira el parche INV-1 del front con keys sintéticas `Holo`/`Reverse Holo`). Rareza sin regla → fallback pct
> predecible y auditable, nunca 0. Detalle abajo en §DTOs y §M2.
>
> **Changelog v1.28.1 (2026-08-21, pase corto de precisión — hallazgos de los gates del Stream B; sin endpoints
> nuevos):** (1) **§M2 `variant-controls` / conteo de bounty:** `bountyAcquiredQty` cuenta SOLO ítems
> `ruleSource="bounty"` con `itemStatus ≠ 'rechazada'` (alineado con BL-1; corrige la frase que contaba todo
> snapshot bounty). (2) **§M1 publish-all:** semántica de `summary.selected` = snapshot de candidatas
> seleccionadas server-side. (3) **§M1 sealed-sets:** `SealedInventoryGroupDTO` gana `imageSmallUrl?` (aditivo);
> inferencia normativa del `tcgplayerProductId` en la aportación de sellado (1 exacto entre hermanos mapeados o
> `PRICE_PENDING`; sin herencia de mapeo; decisión de fondo = SB-D5 en TECH_DEBT); la vista de la cola
> `sealed/unmapped` es del frontend de M2 (pendiente menor post-stream).
>
> **Changelog v1.28-stream-b-inventario-master-set (2026-08-21, Stream B «Inventario Master Set», P-19 + P-18 +
> P-17 + P-24 + P-25 + P-20 + P-22 de `PENDIENTES.md` — decisiones de producto YA tomadas por el humano). Spec
> completa en ARCHITECTURE §4.26. CON migración de schema: M-30 (`VariantPriceOverride`, aditiva pura). Toca
> DINERO en ambas direcciones (los overrides PISAN el precio publicado del storefront y la oferta del cotizador
> público) → gate de seguridad por release.**
> - **P-18 — consola de tres precios + overrides que PISAN (§M1/§M2/§DTOs).** NUEVO
>   `PUT /admin/pricing/variant-controls/:cardId/:finish` (`super_admin`, auditado): upsert de
>   `sellOverrideCents`/`buyOverrideCents`/`bounty` por (carta, variante[, grado]). `MasterSetVariantDTO` gana
>   **`pricing?: VariantPricingDTO`** (sugerido + override + efectivo + fuente, por cara compra/venta) — **SOLO
>   scope `platform`** (jamás en vistas de cliente). Precedencias NORMATIVAS (ARCHITECTURE §4.26b): COMPRA
>   `bounty > override > regla > precio_pendiente`; VENTA `listPriceCents (pieza) > sellOverride (variante) >
>   regla > PRICE_PENDING`. Sellado NO cambia (H-1). `appliedRule.source` del quote de buylist gana los valores
>   **`"bounty" | "override"`** (aditivo — el front debe tolerarlos).
> - **P-19 — alta rápida simple + PUBLICAR TODO (§M1).** El alta rápida reusa `items/batch`: «Compra» =
>   `acquisitionCostCents` capturado (prellenado con el sugerido/efectivo de compra); «Aportación» = sin %,
>   `acquisitionPct: 100` (valuada a mercado del momento; sin referencia ⇒ `422 PRICE_PENDING` por línea, visible
>   — lección P-4). `locationId` pasa a **opcional** (alineación de contrato; el DTO ya lo era). NUEVO
>   **`POST /admin/inventory/publish-all`** `{ batchKey?, setId?, productType? }`: publica todo lo `in_stock`
>   preciable, tolerante por-ítem (pendientes ESCALAN ④ y se reportan, jamás revientan el lote), idempotente.
> - **P-17 — drill-down de piezas (§M1, aditivo).** `GET /admin/inventory/items` gana **`finish?`** y
>   **`productType?`**; con `cardId` sirve el panel de copias físicas por variante. Sin endpoints nuevos.
> - **P-22 — Top Bounties (§6/§M2).** Bounty por carta+variante (flag + precio premium ≥ sugerido
>   [`BOUNTY_BELOW_RULE`] + objetivo opcional con auto-apagado al completarse) editado por `variant-controls`;
>   NUEVO endpoint **público read-only `GET /buylist/bounties`** para la sección arriba de `/buylist`. El quote
>   público y `createRequest` aplican la precedencia (snapshot `ruleSource="bounty"|"override"`).
> - **P-24 — valor desglosado (§M7, aditivo).** `GET /admin/finance/inventory-value` gana
>   `breakdown { raw, sealed, graded }` (cada uno `{ atReferenceCents, atCostCents, pieceCount,
>   pendingPriceCount }`); top-level intacto; CSV con columnas espejo. Se pinta en M1 solo para `super_admin`.
> - **P-25 — pestaña «Sellado» POR SET (§M1).** NUEVOS `GET /admin/inventory/sealed-sets` y
>   `GET .../sealed-sets/:setId` (agregación de piezas selladas por set/grupo con `sealedMarketRef`). **Fix
>   normativo backend:** la APORTACIÓN de sellado valúa por `sealedMarketRef` (H-1), no por el gradeKey legacy
>   `'sealed'`.
> - **P-20 — gradeadas separadas (§M1).** NUEVO `GET /admin/inventory/graded` (agregación por carta+grado). El
>   valor de mercado por grado es MANUAL vía `POST /admin/pricing/override` con `productType:"graded"` +
>   `gradeKey:"graded:PSA:10"` (sin proveedor por grado en este stream). Overrides P-18 aplican con
>   `productType=graded`.
>
> **Changelog v1.27.1-fix-variant-composition-regression (2026-08-22, rama `fix/variant-composition-regression`) —
> corrige la regresión en prod de la fórmula «solo structural» de P-13. SIN cambio de shape de contrato: ningún DTO,
> endpoint ni error cambia de forma; SOLO cambia la SEMÁNTICA de cómo se compone `Card.availableFinishes` server-side.
> Spec en ARCHITECTURE §4.25e.**
> - `availableFinishes` vuelve a incluir el `pricedFinishesSnapshot` en su unión (recupera el reverse holo de los
>   comunes que solo trae el proveedor de precios) pero filtra `normal` en rareza premium (elimina el fantasma de
>   ex/secret rares). Fórmula: `orderFinishes( (structuralFinishes ∪ pricedFinishesSnapshot) − { normal |
>   isPremiumRarity(rarity) } ) || ['normal']`. Los lectores del contrato (`CardDTO.availableFinishes`/`displayFinishes`,
>   `MasterSetVariantDTO`) no cambian; solo mejora su CONTENIDO. SEC-A1 (`422 FINISH_NOT_AVAILABLE`) intacto.
>
> **Changelog v1.27-stream-a-catalogo-precios (2026-08-22, Stream A «Catálogo y precios», P-13 + P-15 + P-12 de
> `PENDIENTES.md`). Spec completa en ARCHITECTURE §4.25. SIN migración de schema (las columnas ya existen, M-27/M-29);
> el paso de despliegue es un RE-SYNC forzado (ver P-13 abajo). Toca la lista blanca de dinero SEC-A1 (composición de
> `availableFinishes`) → gate de seguridad por release como siempre.**
> - **P-13 — semántica nueva de `availableFinishes`: la composición cambia server-side (sin cambio de shape).**
>   ⛔ La primera versión de P-13 (fórmula «solo structural», `availableFinishes := structuralFinishes ≠ ∅ ?
>   orderFinishes(structuralFinishes) : ['normal']`) causó una REGRESIÓN en prod y quedó **DEROGADA 2026-08-22** (ver
>   changelog v1.27.1 abajo). **Fórmula VIGENTE (ARCHITECTURE §4.25e):**
>   `availableFinishes := orderFinishes( (structuralFinishes ∪ pricedFinishesSnapshot) − { normal | isPremiumRarity(rarity) } ) || ['normal']`.
>   La unión vuelve (recupera el reverse holo legítimo de los comunes, que en sets nuevos solo trae el proveedor de
>   precios) pero se filtra `normal` en rareza premium (mata el fantasma de las ex/secret rares — filtro estructural por
>   rareza). `CardDTO.availableFinishes` / `displayFinishes` / `MasterSetVariantDTO` **no cambian de forma**; solo cambia
>   cómo se computa server-side. SEC-A1 (`422 FINISH_NOT_AVAILABLE`) sigue validando contra `availableFinishes`.
> - **P-15 — precio de mercado POR VARIANTE en el Master Set (aditivo, §M1/§DTOs).** `MasterSetVariantDTO` gana
>   **`marketReferenceMxnCents?: number | null`** (+ **`capturedDate?: string | null`** opcional) = la referencia
>   `PriceReference` de **ESE acabado** (`raw`, `raw:NM`, `finish` de la variante), FX-recompute a MXN — Normal y
>   Reverse Holo dejan de mostrar el mismo número. El batch `getReferencesBatch` se expande a (carta × acabado del
>   universo), sigue siendo UNA query. **`MasterSetCardCellDTO.marketReferenceMxnCents` queda DEPRECADO** (se
>   conserva UNA versión como espejo del acabado base; retiro en la siguiente rev de contrato — el front debe migrar
>   a leer la variante YA en este stream).
> - **P-12 — sync completo de UN set (aditivo, §M2).** `POST /admin/catalog/sync` gana **`force?: boolean = false`**:
>   con `force:true` corre también el **resolver estructural TCGCSV** para los sets procesados (antes solo corría en
>   first-import o `sync-all {force:true}`). **Flujo recomendado del admin por set:** `sync {setId, force:true}` +
>   `POST /admin/jobs/price-ingest {setId}` (ya existente; barre el set completo, bypass del scope <2020). Se corrigen
>   los textos stale que decían que `sync-all`/`catalog-price-sync` «repuebla precios»: desde v1.14 (WS-A §4.15g) el
>   sync de catálogo es SOLO metadata+estructura; los precios viven exclusivamente en `price-ingest`.
>
> **Changelog v1.26-precios-variantes-masterset (2026-08-20, rama `claude/precios-variantes-masterset`) — bundle del PO.
> Cambios de contrato: §M1 (bulk-publish escalate + `pendingPriceEntryId`; `MasterSetCardCellDTO.marketReferenceMxnCents`;
> P-7 reprice), §M2 (`pending?context=`). Diseño en ARCHITECTURE §4.24; migración M-29 (§11).**
> - **④ `POST /admin/inventory/items/bulk-publish` — priceless ESCALA, no dropea (§M1).** Una línea cuya variante no
>   resuelve precio hoy falla `PRICE_PENDING` y se cae en silencio. Ahora **escala** a la cola de pendientes
>   (`context='inventory'`, dedupe idempotente) y **no publica**; el admin fija precio (override M2 o `listPriceCents`) y
>   el re-publish procede. **Mismo código de error** (`PRICE_PENDING`, no breaking). `BulkPublishLineResult` gana
>   **`pendingPriceEntryId?: string`** (aditivo/opcional) para deep-link de UI a la entrada de M2. La allowlist de status
>   de origen publicable `{in_stock, listed}` (v1.16.1) se **ratifica**.
> - **P-2 `MasterSetCardCellDTO.marketReferenceMxnCents?: number | null` (aditivo, §M1).** Precio de **MERCADO**
>   (referencia `PriceReference` cruda, FX-recompute a MXN vía `getReferencesBatch`/`liveMxnCents`), **NO** precio de
>   venta derivado. `null` cuando la referencia está `pending`. Semántica declarada: «precio de mercado» del PO = la
>   referencia ingerida (la teja admin muestra mercado; el precio de venta del cliente vive en `buyable.salePriceCents`).
> - **P-7 publicar + repreciar FRESCO desde el Master Set (aditivo, §M1).** `bulk-publish` gana flag opcional
>   **`repriceFresh?: boolean`** (o endpoint hermano `POST .../items/reprice`): refresca la `PriceReference` con un fetch
>   **on-demand por carta** ANTES de resolver precio, funciona sobre inventario UNPUBLISHED y **hereda el gate ④** (sin
>   precio tras refresh → escala pendiente, no publica). **Money-touching → gate de seguridad posterior.** Cuota diaria
>   del proveedor (PPT): cap por request, respeta `dailyLimited` de `sync-status`.
> - **③ P-6 dos buckets en `GET /admin/pricing/pending` (§M2).** Gana query param opcional **`?context=`**: **VENTA** =
>   `context=inventory`; **COMPRA** = vista **READ-ONLY** sobre `context=buylist` (producir el precio de compra es WRITE
>   del buylist — fuera de alcance). **Invariante documentado:** `manualOverride` (`POST /admin/pricing/override`)
>   resuelve pendientes **context-agnóstico** — un override de VENTA cierra también el pendiente de COMPRA de la misma
>   variante; se **conserva agnóstico** (opción a); un scope por `context` (opción b) **requiere coordinación con el
>   stream buylist**, no unilateral.
> - **① Variantes desde TCGCSV — SIN cambio de forma de contrato.** `CardDTO.availableFinishes`/`displayFinishes`
>   mantienen su shape; `Card.structuralFinishes` (M-29) es INTERNA (no se expone). Nota en §DTOs. Detalle en
>   ARCHITECTURE §4.24a.
>
> **Changelog v1.25-buylist-orders-pagination (2026-08-20, rama `claude/buylist-ordenes`) — WS «Buylist y órdenes»
> (regla 9, cambio de contrato P-5): paginación server-side + filtros para las colas admin de M5 (buylist) y M3
> (órdenes).** Problema del PO: con muchas solicitudes «Cerradas» (M5) y muchas órdenes (M3) hay que scrolear para
> encontrar una; la pestaña «Cerradas» de M5 filtra **client-side** sobre un fetch COMPLETO (`getAdminBuylist` sin
> params) — no escala. **Decisión del PO: paginar + filtrar en el servidor (NO archivar aparte).** **100% ADITIVO,
> sin migración de datos** (los parámetros nuevos son opcionales; omitirlos deja el listado EXACTAMENTE como hoy).
> Se añaden, con **mismos nombres en ambos endpoints** — `q`, `from`, `to`, `minCents`, `maxCents` (+ `page`,
> `pageSize` ya existentes):
> - **`GET /admin/buylist` (§M5):** `q` (folio/vendedor — sustituye el buscador client-side), `from`/`to` (rango sobre
>   `createdAt`, ISO, gte/lte), `minCents`/`maxCents` (rango sobre **`quotedTotalCents`**), y **`status` pasa a aceptar
>   CSV** (`status=pagada,rechazada,abandonada` → la pestaña «Cerradas»; un solo valor y la ausencia se comportan como
>   HOY). Orden `createdAt desc` (ya era norma v1.18).
> - **`GET /admin/orders` (§M3):** `q` (folio `orderNumber` / comprador), `minCents`/`maxCents` (rango sobre
>   **`totalCents`**, total canónico de la orden). `status`, `userId`, `from`, `to`, `guest`, `needsManual` ya existían.
> - **`pageSize`:** default **20 sin cambios** (subir el default rompería en silencio a consumidores que hoy reciben 20);
>   el front pide `pageSize=25` (sugerencia del PO). Máx **100** sin cambios. Validación: paginación/fecha/monto
>   inválidos → `400 VALIDATION_ERROR` (§Convenciones). **Índices recomendados en ARCHITECTURE §4.18(h)/§4.21(l) — NO se
>   escriben migraciones aquí.** Seguridad: los filtros sólo REDUCEN el conjunto ya autorizado por rol; `q` NO busca
>   sobre CLABE/RFC/INE. Ver §M5, §M3, §Convenciones y ARCHITECTURE §4.18(h)/§4.21(l).**
>
> **Changelog v1.24-buylist-request-reject (2026-08-20, rama `claude/buylist-ordenes`) — WS «Buylist y órdenes»: cierre
> del hueco de ESTADO A NIVEL SOLICITUD al rechazar ítems (bug P-4). Semántica que HOY FALTA: cuando el back-office (M5)
> rechazaba el ÚLTIMO ítem no-rechazado de una `SellRequest`, la solicitud se quedaba en `verificacion` — huérfana, sin
> transición a `rechazada` ni automática ni por botón (`respond('decline')` mueve la solicitud, pero es el flujo del
> CLIENTE ante un ajuste, no el back-office). Se documentan DOS mecanismos («y/o» del PO). ADITIVO: NO cambia el shape de
> `SellItemDTO` ni la semántica POR-ÍTEM de `reject` (v1.18); un endpoint nuevo. Ver §M5 y ARCHITECTURE §4.18 (f/g).**
> - **(1) Auto-transición a nivel solicitud (principal) — efecto de `PATCH /admin/buylist/items/:itemId/decision`
>   `decision:"reject"`:** tras el recompute de `approvedTotalCents`, si **TODOS** los ítems de la solicitud quedan
>   `itemStatus="rechazada"` (no queda NINGÚN ítem en estado no-rechazado), la `SellRequest` transiciona a
>   `status="rechazada"` sellando **`closedAt = now()`** (terminal, patrón SEC-D2). **Guard:** no pisa estados terminales
>   (`pagada`/`rechazada`/`abandonada`) — si ya es terminal, no-op. **Interacción con `convertida_inventario`:** un ítem
>   `convertida_inventario` **NO cuenta como rechazado** → si conviven ítems convertidos y rechazados, la solicitud **NO**
>   se auto-rechaza (regla exacta: se auto-rechaza **sólo si TODO ítem** tiene `itemStatus="rechazada"`). Idempotente por
>   construcción (el `reject` idempotente no re-dispara; una solicitud ya `rechazada` no se re-sella).
> - **(2) Cierre explícito — botón «Rechazar solicitud» (M5):** endpoint NUEVO `POST /admin/buylist/:id/reject`
>   (`vault_operator`/`super_admin`, mismo guard que el resto de §M5, auditado `action: buylist.reject`). Semántica SEGURA
>   y mínima: cierra la solicitud a `rechazada` + `closedAt`. **Guard:** sólo cierra si **TODOS** los ítems ya están
>   `rechazada`; si queda algún ítem no-rechazado → **`422 REQUEST_HAS_NON_REJECTED_ITEMS`**. **NO** mueve dinero, **NO**
>   reevalúa montos por ítem, **NO** manda correos. Sirve para cerrar solicitudes ya atoradas (ítem rechazado pre-fix).
>   **Idempotente:** si ya está `rechazada` → `200` con el estado actual. Errores `404`/`422`/`403`.
> - **Invariantes preservados:** idempotencia de `reject` (v1.18/§M5), invariante de dinero **BL-1** (un ítem `rechazada`
>   nunca suma en `approvedTotalCents`; el cierre a nivel solicitud **no** toca montos), y `closedAt` **SEC-D2** (sellado
>   al entrar a estado terminal, ancla de la retención de INE). Sin migración: no hay columnas nuevas.
>
> **Changelog v1.22-2-finish-display (2026-08-19, rama `claude/pulido-precios-display`) — Pulido de derivación/
> visualización de acabados (N-15 + N-16). ADITIVO: ningún campo se quita ni cambia de tipo; NO se toca ninguna regla
> de precio ni la whitelist SEC-A1 `Card.availableFinishes`. Ver ARCHITECTURE §4.22a-6 / §4.22c / §3.7.**
> - **N-15 — nuevo campo derivado de DISPLAY `displayFinishes: Finish[]`.** `availableFinishes` **NO cambia**: sigue
>   siendo la **lista blanca SEC-A1** que valida el `finish` (`422 FINISH_NOT_AVAILABLE`) y con la que se **deriva el
>   monto** server-side. `displayFinishes` (`⊆ availableFinishes`, mismo orden `FINISH_ORDER`, nunca vacío) es lo que
>   el front **pinta**: en una carta **premium de una sola impresión** (`isPremiumRarity`) oculta el acabado `normal`
>   **espurio** (entró solo por llave de `tcgplayer.prices` sin `market>0`). En el resto de cartas (y en rareza
>   `null`/desconocida) `displayFinishes === availableFinishes` (sin supresión). Solo RESTA casillas, **nunca** añade:
>   **no** inventa `reverse_holo` por rareza (VAR-1 intacto).
> - **DTOs aditivos:** `CardDTO` **+= `displayFinishes: Finish[]`**; `MasterSetCardCellDTO` **+= `displayFinishes:
>   Finish[]`**; `MasterSetVariantDTO` **+= `displayed: boolean`** (`= finish ∈ displayFinishes`, espejo de
>   conveniencia para el render plano). Sin endpoints nuevos, sin migración, sin cambio de códigos de error.
> - **N-16 — rejilla PLANA (presentación del FRONT, no cambio de contrato).** El front deja de agrupar por carta con
>   sub-casillas y muestra **una tarjeta por impresión (carta+acabado)** en flujo plano en cotizador, master-set M1,
>   «Mi bóveda» y bóvedas de cliente (admin). El conjunto de tarjetas por carta = **`displayFinishes`** (tras N-15),
>   NO `availableFinishes`. El precio por acabado ya existía (quote por `(card,finish)`, `ListingDTO.finish`,
>   `MasterSetVariantDTO`): **no** se añade shape de precio.
>
> **Changelog v1.21.4-dual-breakdown (2026-08-19, rama `claude/pulido-checkout`, N-12) — WS «Pulido checkout invitado».
> TODO ADITIVO: ningún endpoint/DTO existente cambia de forma.** `POST /checkout/guest/quote` (§4-G.1) gana
> `vaultBreakdown: BreakdownDTO` (SIN `shippingFeeCents`, **siempre presente** en el `200`, incluido el carrito 100 %
> podado con subtotal 0), ADEMÁS del `breakdown` de envío directo que NO cambia. Permite al front conmutar el resumen
> «recibir ⇄ bóveda» **al instante** sin refetch por toggle. `vaultBreakdown` = `computeCartBreakdown(subtotal, ivaRatePct,
> fee)` (IVA solo sobre cartas, gross-up sobre la base menor, sin envío); DEBE venir del backend porque el gross-up de
> Stripe (`StripeFeeConfig` fija+pct) no se expone al cliente y no es invertible. Zona compartida a serializar:
> `frontend/src/types/contract.ts` (tipo espejo). Solo afecta el quote; `/checkout/guest/session` sigue con un `breakdown`.
>
> **Changelog v1.23-sealed-sales (2026-08-19, rama `claude/sellado-producto-cerrado`) — WS «Sellado / Producto cerrado».
> TODO ADITIVO: ningún endpoint/DTO existente cambia de forma; se AÑADEN endpoints y campos. Cambia una REGLA de precio
> (el sellado deja de ser precio-manual-único y pasa a `override > mercado×spread > PRICE_PENDING`). Ver ARCHITECTURE §4.23.**
> Nuevos: enum `SealedCondition`; DTOs `SealedGroupDTO`/`SealedGroupDetailResponse`/`VaultSealedGroupDTO`/`VaultSealedResponse`/`SealedSpreadsDTO`;
> §2-S (grid público + ficha + value-history + restock, este último feature-flagged); §M2 `GET/PUT /admin/pricing/sealed-spreads`;
> §3 `GET /vault/sealed`; §M1 `GET /admin/vaults/:userId/sealed`; §M10 cuatro diales. Migración **M-28** (ARCHITECTURE §11).
> - **Precio del sellado (lo importante):** `ListingDTO`/grid/checkout resuelven el precio de venta del sellado
>   server-side con `computeSealedSalePrice` (SEC-A1): **override** (`InventoryItem.listPriceCents`) gana; si no, hay
>   `sealedMarketRef` (TCGCSV, §4.19) → `mercado × (1 + spread/100)` con el spread de su `SealedSubtype` o el global;
>   sin ninguno → `PRICE_PENDING` (no publicable, money-safe). El `referenceValue` del sellado pasa a ser el valor de
>   mercado TCGCSV (antes pendiente/oculto). Los spreads viven en `ConfigSetting` y se editan por §M2 dedicados.
> - **`bulk-publish` (§M1):** la rama `sealed` deja de exigir `listPriceCents`; deriva por override/mercado×spread; sin
>   ninguno sigue `PRICE_PENDING` (mismo código de error, sin breaking).
> - **Reuso total del checkout:** el sellado se compra por los MISMOS endpoints (§4 / §4-G): `fulfillmentMode vault|direct_ship`,
>   invitado → `direct_ship`. Sin endpoints de checkout nuevos. Solo se añade `sealedCondition` a los DTOs de sellado.
>
> **Changelog v1.22-1-señal-ppt (2026-08-19, rama `fix/available-finishes-source`) — SIN CAMBIO DE CONTRATO (nota de
> semántica).** Resuelve la pregunta abierta v1.22-1 (ARCHITECTURE §4.22g/§10): con pokemontcg.io caído (502), la señal
> de acabados también se toma de la fuente de PAGA (PokemonPriceTracker) como **evidencia positiva** (`market>0` vía
> alias VERIFICADO ⇒ el acabado existe). **`CardDTO.availableFinishes` NO cambia de forma ni de tipo** (`Finish[]`, no
> vacío, orden `FINISH_ORDER`); cambia solo **cómo se computa server-side**: ahora es la unión materializada de la
> «opinión del catálogo» (`catalogFinishes`, interna) y la evidencia PPT (`pricedFinishesSnapshot`, interna). **Ninguna
> de esas dos columnas se expone en DTO.** Todos los lectores del contrato siguen consumiendo `availableFinishes` igual;
> el guardarraíl SEC-A1 `422 FINISH_NOT_AVAILABLE` sigue validando contra `Card.availableFinishes`. Ningún endpoint,
> ruta, campo o código de error cambia. Detalle y candados money-safe: ARCHITECTURE §4.22g/§4.22h; migración M-27 (§11).
>
> **Changelog v1.22-variantes-orden (2026-08-18) — «Una casilla de imagen por VARIANTE REAL» (requisito del PO,
> tercera ronda) + orden natural por número. TODO ADITIVO: ningún campo se quita ni cambia de tipo, ningún endpoint
> cambia de ruta ni de códigos de error. NO se toca ninguna regla de precio de buylist ni de venta.**
> Ver §DTOs (`CardDTO`, `MasterSetCardCellDTO`, `MasterSetVariantDTO`), §6 (`GET /buylist/cards`), §M1 (binder) y
> ARCHITECTURE **§4.22** / §3.7 / §11 (**M-26**).
> - **`Card.availableFinishes` cambia de FUENTE, no de shape (lo importante).** La nota de v1.14 —«la fuente pasa a
>   ser el proveedor de paga durante el price-ingest»— queda **DEROGADA**: el `price-ingest` **sobrescribía** el campo
>   con los acabados que tenían `market > 0`, así que una carta con reverse holo **sin precio** de reverse holo se
>   reducía a `["normal"]` y el binder pintaba **una** casilla. **Fuente única = el sync de catálogo**, derivando de
>   `tcgplayer.prices` (**llaves presentes**, con o sin `market`) **∪** `cardmarket.prices.reverseHolo*` (valor > 0).
>   **La ausencia de precio ya no reduce variantes.** Sin señal remota, el catálogo **no sobrescribe** lo existente.
> - **Garantías nuevas del array (normativas):** nunca vacío, **orden canónico** `normal → reverse_holo → holofoil →
>   first_edition_holofoil`, y es el **universo exacto de casillas**: `|casillas| = |availableFinishes| ≥ 1`,
>   **prohibida la casilla de relleno**. De ahí sale literalmente «la común a la izquierda y la holo a la derecha»,
>   **sin** que el front ordene nada.
> - **`MasterSetVariantDTO` NO cambia — y es decisión, no omisión.** pokemontcg.io publica **una** imagen por carta
>   (el reverse holo no tiene arte propia en la fuente) ⇒ las N casillas de una celda usan la **misma**
>   `imageSmallUrl`. **No se añade `imageByFinish`** ni imagen por variante; diferenciar el acabado es
>   **presentación** del front (marco/badge), no contrato.
> - **Orden por número — `GET /buylist/cards` gana garantía NORMATIVA.** Hoy ordena `name asc, number asc` con
>   `number` **String** (`"10"` antes que `"2"`) **y pagina**, así que el orden **debe** vivir en SQL: con `setId` →
>   `numberPrefix, numberSort, number, id`; sin `setId` → `name, setId, numberPrefix, numberSort, id`. El `id` final
>   es lo que hace **determinista** la paginación. Ordenar en memoria tras paginar queda **prohibido**.
> - **DTOs aditivos:** `CardDTO` **+= `numberSort: number`, `numberPrefix: string`** (matan el `numberSort` sintético
>   que el front calculaba con el índice del arreglo); `MasterSetCardCellDTO` **+= `numberPrefix: string`**
>   (`numberSort` solo no basta: `TG12` y `GG12` colisionan). Ambos son **columnas** de `Card` desde **M-26**.
> - **Migración M-26** (2 columnas + backfill + índice) y **re-sync `POST /admin/catalog/sync-all {force:true}`**
>   como paso de despliegue: el código corregido **no repara** las filas ya grabadas. Detalle en ARCHITECTURE §4.22d.
>
> **Changelog v1.21.3-quote-prune (2026-08-18) — Fix de producción (decisión cerrada con el PO): una pieza MUERTA
> en un carrito viejo NO debe bloquear el checkout. SOLO cambian los DOS endpoints de QUOTE (§4 `POST /checkout/quote`
> y §4-G.1 `POST /checkout/guest/quote`); los de SESSION siguen ESTRICTOS.** Ver §4, §4-G.1 y ARCHITECTURE §4.21h-1 (caso v ajustado).
> - **Bug raíz:** el carrito vive en `localStorage` como lista de `inventoryItemId` (piezas físicas ÚNICAS — al
>   venderse desaparecen). Hoy, si UN id ya no resuelve, el quote entero revienta con `404 NOT_FOUND` global
>   ("One or more items not found"), y si UNA pieza existe pero salió de `{listed, in_stock}` de plataforma, con
>   `409 ITEM_UNAVAILABLE` global ⇒ el checkout queda 100 % bloqueado para todo el carrito.
> - **Norma nueva — resolución POR ÍTEM con poda amable (SOLO quote):** los ítems que no resuelven o no están
>   disponibles **ya no producen `404`/`409` a nivel de request**. La respuesta es `200` con `items` + `breakdown`
>   calculados SOLO sobre los ítems válidos, más el campo nuevo **`unavailableItems: UnavailableCartItemDTO[]`**
>   (**siempre presente**, `[]` cuando todo el carrito resuelve — tipado estable; shape sin cambios en ese caso
>   salvo el `[]` aditivo). `UnavailableCartItemDTO = { inventoryItemId, cardName: string | null }` — `cardName`
>   viene cuando la pieza aún existe en BD (para el aviso «X ya no está disponible y se quitó de tu carrito»);
>   `null` si el id ya no existe.
> - **Carrito 100 % muerto:** `200` con `items: []`, `unavailableItems` poblado y **`breakdown` presente EN CEROS**
>   (nunca pantalla de error; el front pinta carrito vacío + aviso y deshabilita "pagar").
> - **`422 PRICE_PENDING` NO cambia de semántica**, pero se evalúa **DESPUÉS de la poda**: solo un ítem válido
>   (existente y disponible) sin precio dispara el 422.
> - **SESSION sigue estricto A PROPÓSITO (no "arreglar" de más):** `POST /checkout/session` y
>   `POST /checkout/guest/session` conservan `404 NOT_FOUND` / `409 ITEM_UNAVAILABLE` globales — crear un pedido
>   con una pieza muerta DEBE fallar (anti double-sell; el caso v de ARCHITECTURE §4.21h-1 lo cubre). El flujo es:
>   quote poda → el front actualiza el carrito → session recibe solo ids vivos.
> - **Nota de frontend (no es API):** el carrito de `localStorage` gana timestamp de última modificación y
>   **expira a los 30 días** (dueño: frontend; complementa la poda, no la sustituye).
> - **Fuera de alcance:** reglas de precios, tracking de invitado (token) y `GET /buylist/cards` NO cambian.
>
> **Changelog v1.21.2-chargeback-fulfillment (2026-08-18) — Cierre del hallazgo BLOQUEANTE del techlead (T1) + D6 y
> D4. Un endpoint admin nuevo (`chargeback-inventory`) y UN constraint (M-25b); ningún DTO de cliente cambia.**
> Ver §4-G.6, §9, §M3, §M4 y ARCHITECTURE §4.21c-bis.
> - **T1 — double-sell FÍSICO (bloqueante, hueco de la norma, no de la implementación).** §4-G.6 describía el
>   reverso del contracargo **solo** por el `InventoryItem`. Con un pedido `direct_ship` y el envío en
>   `picking`/`guia`, el item volvía a `listed` **mientras el envío seguía en la cola de picking** ⇒ la misma pieza
>   única podía venderse a un segundo comprador mientras el operador la metía en la caja. **Norma nueva: el
>   contracargo NUNCA re-lista automáticamente una pieza con envío vivo** — el envío no terminal pasa a `cancelado`
>   en la misma transacción y la pieza queda **congelada** en `picking` (fuera de venta), con
>   `chargebackNeedsManual=true`; el desenlace lo confirma un humano con **`POST /admin/orders/:id/chargeback-inventory`**
>   (`recuperada | no_recuperada | reexpedir`, `vault_operator+`, auditado, **no money-out**). **Ganar la disputa no
>   re-expide solo.** Invariante nuevo: *pieza con `ShipmentItem` en envío no terminal ⇒ jamás en `{listed, in_stock}`*.
>   **Sin enums ni columnas nuevas** (reusa `ShipmentStatus.cancelado`).
> - **D6 — el `CHECK` que faltaba pasa a normativo (M-25b):** `InventoryItem CHECK (ownerType <> 'customer' OR
>   ownerUserId IS NOT NULL)`. Único de los cinco invariantes de §4-G.10 sin implementar, y precisamente el que
>   sostiene la nulabilidad de `Order.userId`. Tabla de otro stream ⇒ serializar.
> - **D4 — un solo discriminador canónico:** `ShipmentRequest.orderId` dice **de dónde viene** el envío; **el
>   comportamiento** (terminal del item, `kind` de §M4) se resuelve **siempre** por **`Order.fulfillmentMode`**, con
>   `switch` exhaustivo que **lanza** ante un modo no soportado en vez de asumir `direct_ship` en silencio.
> - **Erratas de documentación corregidas (post-QA/techlead), sin cambio de código:** (a) se **ratifica `409 CONFLICT`**
>   —no `422`— para un `outcome` que no aplica al estado del recurso en `chargeback-inventory` (ARCHITECTURE §4.21c-bis
>   decía `422`; ya corregido: el cuerpo es válido, el obstáculo es el **estado**); (b) los 8 casos de prueba exigidos
>   del contracargo se enumeran en **ARCHITECTURE §4.21h-1** con numeración `i…viii` **canónica** (los tests ya la
>   citan; no se renumera).
> - **`GET /admin/orders?needsManual=true` (NUEVO, aditivo)** + **requisito de UI pendiente**: el desenlace humano del
>   contracargo **no tiene pantalla** hoy; sin la cola visible y el formulario de desenlace la pieza congelada se
>   queda congelada. Dueño: WS **«Admin y auditoría»**.
>
> **Changelog v1.21.1-guest-checkout-fixes (2026-08-18) — Correcciones post-implementación del WS «Órdenes y
> dinero» (regla 9: backend detectó, el arquitecto resuelve). SOLO estos 4 puntos; nada más del contrato cambia.
> SIN migración adicional (M-25 se queda como está).** Ver §4-G.7a, §4-G.3, §4-G.6, §4-G.11.
> - **§4-G.2/§9 — se retira un requisito IRREALIZABLE.** Decía "el **mismo** token se envía por correo al
>   liquidar": imposible, porque en BD solo vive el `SHA-256` y el claro **no es recuperable** en el webhook (esa
>   irrecuperabilidad es justamente la propiedad de seguridad T5). **Norma nueva: dos emisiones con vidas
>   distintas** — `checkoutToken` de **120 min** (respuesta del checkout, para la confirmación post-3DS) y token de
>   seguimiento de **90 días** (solo por correo). El **settle NO rota** (rotar mataría la confirmación en curso);
>   **reenvío y soporte SÍ rotan** revocando todos los vivos. Así el solapamiento de dos puertas dura **≤2 horas**
>   en vez de 90 días. **Sin columna nueva** (se distinguen solo por `expiresAt`). El campo de la respuesta pasa a
>   llamarse **`checkoutToken`** (+ `checkoutTokenExpiresAt`).
> - **§4-G.3 — `details.reason` del `410 TOKEN_REVOKED` se DERIVA**, no se persiste: `CLAIMED` si
>   `Order.claimedAt != null`, si no `ROTATED`. **Se ELIMINA el valor `SUPPORT`** (inderivable sin columna de
>   motivo; no se añade una columna para cambiar un texto de UX). La distinción "quién rotó" **sigue disponible en
>   `AuditLog`** (`order.tracking_link.reissue`), que es donde corresponde.
> - **§4-G.6 — se fijan los `InventoryMovement.reason`** del ciclo de invitado (faltaban): **`settle`** en
>   `reserved → picking`; **`sale`** en `picking → shipped` y `shipped → delivered`; **`withdrawal` PROHIBIDO**
>   (ensuciaría los reportes de custodia). Sin valores nuevos en el enum. Ratifica lo que backend implementó.
> - **§4-G.11 — corrección de conteo:** son **8** códigos de error nuevos, no 7. La lista normativa de §0 (que
>   siempre tuvo 8) es la que manda.
>
> **Changelog v1.21-guest-checkout (2026-08-18) — WS «Órdenes y dinero»: COMPRAR SIN CUENTA (PROJECT §J, §J.1,
> criterios 45–56b).** Superficie **nueva y aislada** (`/checkout/guest/*`, `/orders/guest/*`, `/orders/claim*`):
> **ningún endpoint existente cambia de forma ni de rol**. ⚠️ **UNA migración (M-25, ARCHITECTURE §11):**
> `Order.userId` pasa a **nullable**, 9 columnas nuevas en `Order`, 2 en `ShipmentRequest`, enum `FulfillmentMode`
> y modelo nuevo `OrderAccessToken` — **`backend/prisma/` es zona compartida, el orquestador la serializa**.
> Ver **§4-G** (spec completa), §5, §9, §M3, §M4, §11 y ARCHITECTURE §4.21.
> - **Ruta de fulfillment NUEVA (`fulfillmentMode = vault | direct_ship`):** hoy comprar SIEMPRE deposita en bóveda
>   y el envío es un flujo posterior cobrado aparte. El invitado **no tiene bóveda ni `Address` guardada**, así que
>   su pedido es `direct_ship`: dirección **capturada en línea** (snapshot en la orden) y **envío cobrado en el MISMO
>   PaymentIntent** de la orden (`BreakdownDTO` gana `shippingFeeCents?`). El `ShipmentRequest` de ese pedido lo crea
>   el **servidor** al liquidar (no el cliente): `userId=null`, `orderId` set, `shippingFeeCents=0` (el envío ya se
>   cobró en la orden — **evita doble conteo en el P&L de M7**).
> - **Ciclo de vida del item en pedido de invitado (sin bóveda, sin `ownerUserId`):** el item **NUNCA** pasa a
>   `ownerType='customer'`; conserva `ownerType='platform', ownerUserId=null, ownershipStatus=null` y su ciclo lo
>   lleva `status`: `listed/in_stock → reserved → (pago) picking → (enviado) shipped → (entregado) delivered`. Se
>   estrenan los tres valores de `InventoryStatus` que v1.17 dejó **sin uso por diseño**; **sin enum nuevo**.
>   Invariante reforzado: **`ownerType='customer'` ⇒ `ownerUserId NOT NULL`**.
> - **Seguimiento por enlace tokenizado (`OrderAccessToken`):** token **opaco** de 32 bytes (`base64url`) del que la
>   BD guarda **solo el SHA-256** — mismo patrón que `AuthToken`, **NO un JWT** (revocable por fila, sin claims que
>   filtrar, un dump de BD no produce enlaces válidos). Diferencia con `AuthToken`: es **multi-uso** (`revokedAt`, no
>   `usedAt`). TTL **90 días**, reenvío **rota** (solo el último enlace vive), tope de edad de la orden 365 días.
> - **`GuestOrderTrackingDTO` = datos mínimos (criterio 51):** el contrato enumera **campo por campo** lo que se
>   expone y lo que NO (sin dirección completa, sin correo/teléfono, sin `orderId` interno, sin `inventoryItemId`,
>   sin datos de pago más allá de marca+`last4`, **sin ninguna acción**). Respuesta neutra: `404 INVALID_TOKEN` /
>   `410 TOKEN_EXPIRED|TOKEN_REVOKED`, sin cuerpo de pedido.
> - **Reclamo post-compra:** **prueba de titularidad = correo VERIFICADO**, nada más (ni el token ni el número de
>   pedido bastan). `GET /orders/claimable` + `POST /orders/claim` (`customer` + `emailVerified`); vinculación
>   **explícita**, **una sola vez** (`409 ORDER_ALREADY_CLAIMED`), auditada, y **revoca** los tokens del pedido.
> - **Anti-enumeración (criterio 56, política del orquestador):** el camino de invitado **jamás consulta `User` por
>   correo**; comprar con un correo ya registrado se permite y **no se revela**. El pedido guarda `guestEmail` y la
>   vinculación es un paso posterior ⇒ las tres políticas posibles (reclamo explícito / auto-vínculo / exigir login)
>   se soportan **sin migración**. **Política revisable por el humano** (ver §4-G.9).
> - **Bóveda para invitado = upsell, nunca error (criterio 48):** `422 VAULT_REQUIRES_ACCOUNT` con
>   `details.upsell=true`; el front lo renderiza como oferta de registro, no como error.
>
> **Changelog v1.20.1-adjustments-clarify (2026-08-17) — Aclaración post-gates del stream «Inventario y vault»:
> `POST /admin/inventory/adjustments` (§M1). SOLO este endpoint; nada más del contrato cambia. Sin migración
> (reusa `InventoryBatch` M-21 para la idempotencia). Resuelve las dos ambigüedades enrutadas por techlead/QA
> (BACKEND_NOTES §45.4 y deuda BE-47).** Ver ARCHITECTURE §4.20e.
> - **`adjustmentIds: string[]` SUSTITUYE al singular `adjustmentId` en `InventoryAdjustmentResponse` (cambio
>   LIMPIO, sin campo deprecated).** Con `encontrada` y `qty>1` el backend crea **N** filas `InventoryAdjustment`
>   (una por pieza, M-24); el singular obligaba a devolver solo la primera (BACKEND_NOTES §45.4). Ahora se devuelven
>   **todas**, alineadas 1:1 con `inventoryItemIds`/`folios` (simetría con el alta por lote). Con los otros motivos
>   el array tiene longitud 1. **Decisión explícita: se elimina `adjustmentId` sin periodo de deprecación** — no hay
>   clientes externos; el único consumidor es el frontend propio y no navega por ese id.
> - **`batchKey?` (opcional) en `InventoryAdjustmentRequest`, SOLO en el camino `encontrada`** (vive en esa rama de
>   la unión), con la **MISMA semántica de idempotencia que el alta por lote** (`POST .../items/batch`): mismo
>   `batchKey` → **no** re-crea piezas ni filas de ajuste; el **replay devuelve la respuesta original guardada**
>   (mismo criterio que `batchCreate`) con el campo nuevo **`idempotentReplay: true`** y status **`200`**. Cierra la
>   deuda **BE-47** (doble submit duplicaba piezas en `encontrada`). Los motivos `perdida | danada | error_captura`
>   **no** llevan `batchKey` (operan sobre una pieza existente e id concreto): su replay cae solo en
>   `422 ITEM_NOT_ADJUSTABLE` porque la pieza ya salió de `{in_stock, listed}` — idempotencia natural. `batchKey`
>   con motivo distinto de `encontrada` → `400 VALIDATION_ERROR`.
>
> **Changelog v1.20-master-set-everywhere (2026-08-17) — WS «Inventario y vault»: Master set en TODAS partes.**
> La vista Master Set (v1.16, solo back-office M1) se generaliza a un **contrato ÚNICO de "contenido de
> bóveda/inventario agrupado por set y por acabado"** que sirve **TRES vistas con el MISMO shape de respuesta**,
> parametrizado por **`scope`** (`platform` | `user_vault`): (i) master set interno M1 (endpoints existentes
> `GET /admin/inventory/master-sets[/:setId]` — DTOs **EXTENDIDOS, no duplicados**), (ii) admin viendo la bóveda de
> **cualquier cliente** (`GET /admin/vaults/:userId/master-sets[/:setId]`, `vault_operator+`), (iii) cliente viendo
> **su propia** bóveda (`GET /vault/master-sets[/:setId]`, `customer`). **Aditivo** sobre los DTOs v1.16 (solo campos
> nuevos; nada se quita ni cambia de forma). Migración **M-24** (ajustes de inventario). NO toca dinero saliente.
> Ver ARCHITECTURE §4.20.
> - **Completitud por VARIANTE (carta+acabado), no por carta:** una carta que existe en `normal` y `reverse_holo`
>   son **2 casillas**. El **universo de variantes esperadas por carta = `Card.availableFinishes`** (campo YA
>   existente del catálogo; ~~poblado por el price-ingest v1.14~~ → **v1.22: poblado SOLO por el sync de catálogo**
>   (`tcgplayer.prices` ∪ `cardmarket.reverseHolo*`); filas históricas →
>   `["normal"]`). **No hace falta regla derivada nueva:** el catálogo SÍ declara los acabados esperados. Los
>   contadores **«X/Y» cuentan variantes**: nuevos `variants[]` + `expectedVariantCount`/`coveredVariantCount`
>   (celda) y `catalogVariantCount`/`distinctVariantsOwned`/`variantCompletionPct` (índice). Los campos por-carta
>   de v1.16 (`distinctCardsOwned`, `completionPct`, `countsByFinish`…) se **conservan** (compat).
> - **Scope `user_vault`:** mismo shape; cambia SOLO el filtro de agregación (piezas **del usuario en bóveda**:
>   `ownerType='customer' AND ownerUserId=:userId AND status NOT IN (withdrawn, shipped, delivered, lost, damaged)`,
>   ambas titularidades `pending|settled`) y las **omisiones por scope**: el shape compartido **NUNCA** expone
>   ubicaciones físicas, costos, folios ni datos internos de inventario; en las vistas de cliente **no hay acciones
>   de venta/captura/publicación/ajuste** y `buyable` **SOLO** existe en scope cliente (iii).
> - **`buyable` (SOLO vista (iii), cliente):** cada **variante faltante** del binder resuelve a inventario publicado
>   comprable: `buyable: { inventoryItemId, salePriceCents } | null` (la pieza `listed` **más barata** de ese
>   `(cardId, finish)`; `null` si no hay nada publicado). En scopes admin el campo se **omite**.
> - **`GET /admin/vaults` (NUEVO, `vault_operator+`):** lista de clientes **con bóveda** — identificación mínima
>   (id, nombre, email), conteo de piezas y **valor estimado con la MISMA base de valuación del portafolio §3**
>   (referencia por acabado; pendientes excluidos y contados). Paginación y orden (`value_desc` default).
> - **`POST /api/v1/admin/inventory/adjustments` (NUEVO, `vault_operator+`, auditado):** ajuste de inventario por
>   **levantamiento físico** desde la celda del binder M1. **Motivo OBLIGATORIO** enum
>   `encontrada | perdida | danada | error_captura`; registra `InventoryAdjustment` (M-24) +
>   `InventoryMovement(reason=adjustment)` + `AuditLog` con usuario y timestamp. **NO existe venta directa manual
>   desde el binder: toda salida de venta pasa por órdenes (checkout/M3).** Error nuevo `422 ITEM_NOT_ADJUSTABLE`.
>
> **Changelog v1.19-sealed-tcgcsv (2026-08-17) — WS «Catálogo y precios»: referencia de mercado para producto SELLADO
> vía TCGCSV (espejo diario gratuito de precios de TCGplayer; cubre ETB/booster box/bundle/tin/blister). Aditivo,
> no-breaking y TODO admin-only: **NINGÚN endpoint público ni DTO de cliente cambia** (ficha de Compra, holdings,
> buylist: intactos). ⚠️ UNA migración (M-23, ARCHITECTURE §11): enum `PriceSource += tcgcsv` + 2 columnas nullable en
> `InventoryItem` (`tcgplayerProductId`, `tcgplayerGroupId`) + índice — prisma es zona compartida, el orquestador la
> serializa. Ver §0 (enums), §M1, §M2, §M10, §M10-ops y ARCHITECTURE §4.19.**
> - **PRECEDENCIA (PROJECT 3e manda, sin cambio):** el sellado se sigue vendiendo con **precio manual del admin en MXN**
>   (`listPriceCents` obligatorio para publicar). El precio TCGCSV es **valor de referencia informativo** para el
>   back-office (sugerencia al fijar precio); NO auto-publica, NO fija `listPriceCents`, NO encola `PendingPriceEntry`
>   y NO se muestra en la ficha pública en esta versión.
> - **Enums:** `PriceSource += tcgcsv`; nuevo `SealedPriceSource = tcgcsv | off` (valores del dial `sealedPriceSource`).
> - **§M1:** los items `productType=sealed` exponen (read-only en M1) `tcgplayerProductId?`, `tcgplayerGroupId?` y
>   `sealedMarketRef?: PriceInfo` (`source:"tcgcsv"`; `null` si no mapeado o sin ingest). El mapeo NO se edita por
>   `PATCH /admin/inventory/items/:id` — solo por §M2 › mapping.
> - **§M2 (NUEVO, `super_admin`):** curación del mapeo sellado↔TCGCSV — `GET /admin/pricing/sealed/unmapped` (cola
>   derivada), `GET /admin/pricing/sealed/tcgcsv/groups` y `GET .../groups/:groupId/products` (explorador proxy
>   read-only, host fijo anti-SSRF) y `PUT /admin/pricing/sealed/items/:itemId/mapping` (asigna/desmapea,
>   `applyToSiblings?`, auditado).
> - **§M10:** dial nuevo **`sealedPriceSource`** (`sealed_price_source`, `tcgcsv | off`, **seed `off`** fail-closed;
>   flip tras validar en staging — patrón `priceProvider`).
> - **§M10-ops:** job nuevo **`sealed-price-ingest`** (`POST /admin/jobs/sealed-price-ingest`, acepta `groupId?` para la
>   verificación de esquema de la 1ª corrida; 2ª excepción al body-vacío de la familia, junto a `price-ingest`).
> - **Persistencia (interno, sin cambio de contrato):** upsert en `PriceReference` con `productType='sealed'`,
>   `gradeKey='sealed:tcg:<productId>'`, `finish='normal'`, `source='tcgcsv'`, USD→MXN con FX+colchón. Sin cambio en
>   `PriceInfo` (mismo shape; `source` gana el valor `tcgcsv`).
>
> **Changelog v1.18-buylist-rejects (2026-08-17) — WS «Catálogo y precios»: M5 operable (identidad del vendedor,
> orden/fechas, semántica completa de cartas RECHAZADAS con plazos 7d/30d y correo al vendedor) + orden normativo de
> `GET /buylist/sets`. PROJECT §H / criterios 15–16 (rechazo no-NM → no se paga → devolución 7 días a costo del
> usuario, abandono a 30 días; abandonada no-NM NUNCA entra al inventario vendible). Aditivo, no-breaking. ⚠️ Incluye
> UNA migración de esquema (M-22, ARCHITECTURE §11): 2 columnas nullable en `SellRequestItem` — prisma es zona
> compartida, el orquestador la serializa. Ver §6, §M5, §11 (DTOs) y ARCHITECTURE §4.18.**
> - **`GET /buylist/sets` — ordenamiento NORMATIVO (§6):** `releaseDate` **desc** por fecha COMPLETA (no solo año),
>   desempate por `name` **asc**, y sets **sin** `releaseDate` **al final** (a su vez por `name` asc). Antes el texto
>   decía "por año desc" (ambiguo dentro del mismo año); se vuelve norma lo que backend ya implementa en este stream.
>   Sin cambio de shape.
> - **§M5 · identidad del vendedor:** `GET /admin/buylist` (cada fila) y `GET /admin/buylist/:id` ganan
>   **`seller: AdminSellerRef = { id, name, email }`** (join a `User`), además del `userId` existente (compat). La UI
>   muestra nombre/correo y relega el UUID a tooltip/detalle. **PII:** son endpoints de back-office ya protegidos por
>   rol (`vault_operator`/`super_admin`); el **correo es dato de contacto operativo, NO es la CLABE** — **no** requiere
>   reveal auditado ni enmascarado. La CLABE sigue con su régimen actual (enmascarada; en claro SOLO por `reveal-clabe`).
> - **§M5 · orden y fechas:** `GET /admin/buylist` se ordena por **`createdAt` desc** (más reciente primero) — NORMA;
>   el código actual ordena `asc` y backend lo corrige en este stream. `createdAt` ya se expone por fila; el detalle ya
>   expone `receivedAt`/`verifiedAt`/`approvedAt`/`adjustmentSentAt` (fechas de plazos de la solicitud).
> - **§M5 · rechazo de ítem (`PATCH /admin/buylist/items/:itemId/decision`, `decision:"reject"`):**
>   - **`reason: string` (NUEVO, OBLIGATORIO con `reject`, 3–500 chars):** motivo del rechazo (p. ej. "no es NM:
>     whitening en el reverso"). Falta/vacío → `400 VALIDATION_ERROR`. Se persiste (`SellRequestItem.rejectionReason`),
>     se ecoa en DTOs, va al `AuditLog` (`buylist.item.reject`, en `after`) y alimenta el correo al vendedor. Ignorado
>     (y no persistido) para `approve`/`adjust`.
>   - **`rejectedAt` (NUEVO, persistido):** timestamp de la decisión de rechazo (= momento en que se notifica al
>     vendedor). **Ancla ÚNICA de los plazos del ítem rechazado.**
>   - **INVARIANTE de dinero (norma):** un ítem `rechazada` **NO suma** en `SellRequest.approvedTotalCents`. El
>     `reject` pone **`approvedPriceCents = null`** y dispara `recomputeApprovedTotal`. *Verificado en código:* hoy el
>     recompute suma todo `approvedPriceCents != null` sin filtrar por status, así que la secuencia approve→reject
>     dejaba el monto **fantasma** en el total (desviación BL-1, ARCHITECTURE §9; backend la corrige en este stream).
>     `quotedTotalCents` NO se recalcula (es snapshot histórico de la cotización).
>   - **Idempotencia:** re-enviar `reject` sobre un ítem ya `rechazada` es **no-op** (200 con el estado actual; no
>     re-fija `rejectedAt`, no re-envía correo).
>   - **Efecto lateral — CORREO al vendedor (best-effort):** al transicionar a `rechazada` se envía correo al dueño de
>     la solicitud con carta (nombre/set/número), acabado, `reason` y los plazos de devolución/abandono con fechas.
>     **Su fallo NO revierte la decisión ni falla el request** (se loggea). Spec completa en §M5 y ARCHITECTURE §4.18.
> - **Plazos del ítem rechazado (derivados, NO columnas):** `returnDeadlineAt = rejectedAt + 7 días` (gestionar
>   devolución **a costo del usuario**) y `abandonDeadlineAt = rejectedAt + 30 días` (abandono). Se **calculan
>   server-side** al proyectar (misma familia de constantes 7d/30d que `buylist-sweep`); NO se persisten (fuente única
>   = `rejectedAt`). Ítems rechazados ANTES de M-22 (legacy, sin `rejectedAt`) exponen los tres campos `null`. Son
>   fechas **informativas para el back-office y el vendedor**: NO se añade transición automática de estado del ítem al
>   vencer (la solicitud ya tiene su sweep 7d/30d a nivel request; sin cambio).
> - **`SellItemDTO` (§11) gana `rejectedAt?`, `rejectionReason?`, `returnDeadlineAt?`, `abandonDeadlineAt?`** (los 4
>   `null`/omitidos si el ítem no está `rechazada`). Aplica en TODAS las proyecciones que ya usan `SellItemDTO`,
>   incluido el detalle del PROPIO cliente `GET /buylist/requests/:id` (el vendedor ve su motivo y sus plazos).
> - **`GET /admin/buylist/rejected-items` (NUEVO, §M5):** listado paginado TRANSVERSAL de ítems `rechazada` (todas las
>   solicitudes) para la pestaña «Rechazadas» de M5: `RejectedSellItemDTO` con `seller`, carta, `finish`, `reason` y
>   plazos, ordenado por `rejectedAt` desc. `vault_operator`/`super_admin`.
> - **`convert-to-inventory` — NORMA para rechazadas:** un ítem `rechazada` **NUNCA es convertible** a inventario
>   (PROJECT criterio 16: la carta rechazada es no-NM y una no-NM abandonada NO entra al inventario vendible; la carta
>   queda físicamente retenida hasta devolución o abandono, pero jamás vendible). La guardia existente
>   `422 ITEM_NOT_APPROVED` (solo `aprobada` convierte) **es la norma**; no se abre excepción al vencer plazos.
> - **Correo de rechazo — decisión de diseño (ARCHITECTURE §4.18):** el módulo `mail` pertenece a otro stream y **NO se
>   toca**; `buylist` inyecta el puerto público **`MAIL_PORT`** (`send({to,subject,html,text})`, módulo @Global ya
>   exportado) con **plantilla LOCAL al módulo buylist** (ES/EN por `User.locale`, mismo layout/escape que
>   `mail.templates.ts`). **Deuda aceptada:** la plantilla vive fuera de `mail/` hasta que el stream «Cuentas y acceso»
>   la absorba (backend la registra en TECH_DEBT). El correo **no filtra datos sensibles**: SIN CLABE (ni enmascarada),
>   SIN montos ni estado de otros ítems, SIN datos de terceros.
> - **⚠️ Migración M-22 (prisma = zona compartida — serializar):** `SellRequestItem.rejectedAt DateTime?` +
>   `SellRequestItem.rejectionReason String?` (+ índice recomendado `@@index([itemStatus])` para el listado). Son
>   **imprescindibles** (no derivables): `SellRequestItem` no tiene NINGÚN timestamp propio, `adjustmentSentAt` es de
>   la solicitud y solo aplica a `adjust`, y `AuditLog` no es fuente válida para lógica de plazos. Ver ARCHITECTURE §11.
>
> **Changelog v1.17.1-withdrawal-eligibility (2026-08-17) — Cierre de invariante read/write del RETIRO tras el triple
> verdicto de WS-H (techlead + seguridad SEC-H1 + qa). SOLO documentación; no cambia shapes ni añade endpoints.** El
> triple verdicto detectó una **divergencia read/write**: la transición terminal deja el item `status='withdrawn'`
> PERO conserva `ownershipStatus='settled'` (histórico). El criterio de creación de retiro (`POST /shipments` →
> `classifyItems`) exigía `settled` pero **no excluía** `withdrawn`, así que un item **ya entregado** podía
> re-enviarse/re-cobrarse por llamada directa a la API. Se **norma explícitamente** el criterio único de elegibilidad
> y se cierra el hueco. Ver §3 (`withdrawable`), §5 (`POST /shipments`) y ARCHITECTURE §3.3.
> - **Criterio único de elegibilidad de retiro (§5):** un item es elegible para `POST /shipments` **SOLO si**
>   `ownerType='customer' AND ownerUserId=usuario AND ownershipStatus='settled' AND status='in_custody' AND sin envío
>   activo`. Es decir, **DEBE excluir** `status='withdrawn'` (y cualquier estado que no sea `in_custody`). Este es el
>   **mismo** criterio que el flag de lectura **`withdrawable`** del `HoldingDTO` (§3): read (`withdrawable`) y write
>   (creación de `ShipmentRequest`) comparten criterio — cierra la divergencia.
> - **Error normado (§5):** intentar retirar un item no elegible **por estado** (`withdrawn` o cualquier no-`in_custody`)
>   responde **`422 ITEM_NOT_IN_CUSTODY`** (NUEVO código; junto a `409 ITEM_IN_ANOTHER_SHIPMENT` y `422 ITEM_NOT_SETTLED`).
>   Backend implementa exactamente ese código. Ver §0 y §5.
> - **ARCHITECTURE §3.3:** se deja escrito que un item `withdrawn` es **TERMINAL para retiros** (no re-elegible) y que
>   la fuente de verdad de elegibilidad **excluye** `withdrawn`.
>
> **Changelog v1.17-withdrawal-lifecycle (2026-08-17) — Cierre del hueco del ciclo de RETIRO en la bóveda (Opción 1
> del humano). PROJECT.md §D / criterios 9–11.** Hoy, cuando el cliente paga un retiro, el `InventoryItem` **nunca**
> se toca en todo el ciclo del envío (`solicitado→picking→guia→enviado→entregado`): la carta se queda
> `ownerType=customer, ownershipStatus=settled, status=in_custody` **para siempre**, sigue apareciendo en "Mi Bóveda"
> como LIQUIDADA con **RETIRAR activo** aunque ya esté en un envío o incluso ya entregada, y el cliente **no ve** el
> estado de su retiro por carta. Se norma la **Opción 1**: (1) al pagar, la carta **se queda en la bóveda marcada "EN
> RETIRO"** con RETIRAR **deshabilitado**; (2) el retiro es **rastreable** por etapa (`picking → guia → enviado →
> entregado`); (3) al llegar a **`entregado`, la carta SALE de la bóveda** (deja de listarse y de contar en el
> portafolio). **Aditivo, SIN migración** (reusa el enum `InventoryStatus.withdrawn` ya existente y la máquina de
> `ShipmentStatus`; no hay columnas nuevas). **No toca dinero** (SEC-A1 intacto). Ver ARCHITECTURE §3.3 (actualizado)
> y §9 (WD-1).
> - **Fuente de verdad canónica (declarada para evitar ambigüedad):** el **estado/etapa del retiro** se **deriva del
>   join `InventoryItem → ShipmentItem → ShipmentRequest`** (hay a lo más **un** envío activo por item, garantizado por
>   `409 ITEM_IN_ANOTHER_SHIPMENT`). El `InventoryItem.status` **NO se refleja por etapa** (sigue `in_custody` durante
>   `solicitado→picking→guia→enviado`), salvo **UNA** transición terminal: al pasar el envío a **`entregado`** el item
>   pasa **`in_custody → withdrawn`** (única escritura persistente; ver §M4). Los valores `picking | shipped | delivered`
>   de `InventoryStatus` **quedan sin uso por diseño** (no se espejan en el item). Esto **conserva** el comentario
>   vigente de `payments.service` ("el estado del InventoryItem no se mueve en el flujo de envío") para `solicitado→enviado`
>   y solo lo **acota** en el paso `entregado`.
> - **`GET /vault/holdings` — HoldingDTO gana `shipmentState`, `activeShipmentId`, `withdrawable` (§3):** `shipmentState:
>   ShipmentActiveStage | null` (etapa del envío activo, derivada del join); `activeShipmentId: string | null`
>   (deep-link a la vista de rastreo); `withdrawable: boolean` (flag **autoritativo** para deshabilitar RETIRAR = mismo
>   criterio que el backend: `ownershipStatus='settled' && status='in_custody' && shipmentState=null`, refinado en v1.17.1
> con `status='in_custody'`; ver §3 normativa). **Regla de inclusión/exclusión:** los
>   holdings **excluyen** `status='withdrawn'` (los `entregado` salen de la bóveda y **no** cuentan en el portafolio);
>   los items con envío **activo** (`picking/guia/enviado`, y el transitorio `solicitado`) **SÍ se listan y SÍ cuentan**
>   en el portafolio, marcados y **no** retirables. Ver §3.
> - **`GET /shipments` (listMine) + `GET /shipments/:id` — spec COMPLETA de la vista de rastreo del cliente (§5):** se
>   detalla el shape (antes el contrato solo decía "lista propia"). `items[]` gana `folio` + `card` (nombre/set/imagen)
>   + `finish` para que el cliente vea **qué cartas** van en cada retiro y su **etapa/guía**. **No es endpoint nuevo**
>   (el `GET /shipments` ya existe); se norma su forma y el **mapeo etapa→texto**. Sin PII, sin migración.
> - **`payment_intent.succeeded` (§9) y máquina de estados (§M4):** se **reafirma** que el pago del envío avanza solo
>   `ShipmentRequest: solicitado→picking` **sin** tocar el item, y se **norma la transición terminal** `entregado ⇒
>   item.status=withdrawn` (+ `InventoryMovement reason='withdrawal'`) en el paso a `entregado` de la máquina M4.
> - **Enum nuevo (alias de contrato):** `ShipmentActiveStage = solicitado | picking | guia | enviado` (subconjunto
>   "activo" de `ShipmentStatus`; `entregado` nunca aparece en holdings porque el item ya es `withdrawn`, y `cancelado`
>   libera el item ⇒ `shipmentState=null`). Ver §Enums.
>
> **Changelog v1.16.1-master-set-reconcile (2026-08-17) — Reconciliación de contrato §M1 (Master Set) con el
> comportamiento YA implementado por backend y señalado por qa/seguridad. SOLO documentación: el backend está bien;
> se alinea el TEXTO del contrato. Sin cambio de comportamiento, sin migración, sin nuevos endpoints.** Ver
> ARCHITECTURE §4.17 (actualizado) y §9 (Desviaciones).
> - **`POST /admin/inventory/items/bulk-publish` — status de ORIGEN permitido + error `ITEM_NOT_PUBLISHABLE` (NUEVO
>   código):** el §M1 previo solo mencionaba `PRICE_PENDING`. Se documenta EXPLÍCITAMENTE el conjunto de status de
>   origen publicable **`{in_stock, listed}`**: `in_stock` → **publica** (`→ listed`); `listed` → **no-op idempotente**
>   (`ok:true`, no re-cobra ni duplica); **cualquier otro** status (`reserved | in_custody | picking | shipped |
>   delivered | lost | damaged | withdrawn`) → **`422 ITEM_NOT_PUBLISHABLE`** por-línea (no tumba las demás). Esto
>   **cierra un double-sell**: una pieza `reserved`/vendida/en-custodia/enviada NO puede volver a `listed`. `PRICE_PENDING`
>   se conserva para el caso "precio no resuelto". Ver §0, §DTOs y §M1.
> - **`numberSort` (binder `GET .../master-sets/:setId`) — fórmula ilustrativa CORREGIDA:** el texto previo
>   (`regexp_replace(number,'\D','','g')::int`) **contradecía** el requisito "no-numéricos (TG/GG/SV promos) al final":
>   esa fórmula convierte `TG12`→`12` y lo intercala **entre** las numéricas. El backend implementó el comportamiento
>   correcto: **puros-numéricos por valor entero primero**; **promos/subsets con prefijo alfabético al final, agrupados
>   por prefijo**. Se corrige la fórmula/nota del contrato para describir ESE orden. Ver §DTOs y §M1.
> - **`isSecretRare` (`MasterSetCardCellDTO`) — definición AFINADA a heurística de display:** la definición previa
>   (`numberSort > printedTotal`) marcaba **TODOS** los promos (TG/GG/SV) como secret rare (deuda **BE-36**). Se
>   documenta como **heurística SOLO de display** y se afina: `isSecretRare=true` **solo** para cartas de
>   numeración principal (número **puramente numérico**) cuyo entero **> `printedTotal`** (secret/hyper rare real);
>   los promos/subsets con **prefijo alfabético** (TG/GG/SV) **NO** son secret rare (son subset aparte, `isSecretRare=false`);
>   `printedTotal` nulo → `false`. **Decisión de producto (default propuesto, marcado)**: los subsets se distinguen por
>   prefijo alfabético, no se cuentan como secret rare. Ver §DTOs, §M1 y ARCHITECTURE §9 (BE-36).
> - **Enhancement futuro (§6, NO exigido ahora):** `GET /shipments` (listMine) devolver `productType`/`deliveredAt`
>   por ítem para un gate 100%-cliente del UI de disputas (WS-F). Hoy el backend `NOT_RAW` es la autoridad y solo
>   `GET /shipments/:id` trae `productType`. Documentado como **opcional**; no obliga cambio de backend. Ver §5.
>
> **Changelog v1.16-master-set (2026-08-17) — WS-E: Master Set + inventario a escala (M1, comentarios #4/#11/#12).**
> El inventario admin (M1) hoy **no escala**: alta 1×1, tabla plana, sin vista agregada. Se añade una **vista Master
> Set** (cada carta del set × cada acabado, como binder/cuadrícula por número, con cantidad por carta/acabado) para
> **inventariar de un vistazo**, más **escritura por lote** (carrito de captura + publicación masiva). **El modelo
> por-pieza NO cambia** (sigue 1 fila `InventoryItem` por pieza física — la custodia por-pieza lo exige); todo lo
> nuevo es **agregación de lectura** + **lote de escritura**. **Aditivo.** Migración **M-21** (índice de agregación +
> `InventoryBatch` de idempotencia/auditoría; sin backfill). NO toca dinero saliente (SPEI/reembolso); la publicación
> deriva **precio de venta server-side** (SEC-A1, reusa reglas de venta §4.14). Ver ARCHITECTURE §4.17.
> - **`GET /admin/inventory/master-sets` (NUEVO, `vault_operator+`, §M1):** índice de sets con resumen agregado
>   (`MasterSetSummaryDTO`: `printedTotal`, cartas distintas en inventario / completitud, piezas totales). **Query
>   fija** (patrón `set-value.service.ts`), sin N+1: groupBy/raw aggregate por `setId`. Paginado.
> - **`GET /admin/inventory/master-sets/:setId` (NUEVO, `vault_operator+`, §M1):** binder del set — lista de
>   `MasterSetCardCellDTO` por carta (número, nombre, imagen, rareza, `countsByFinish`, gaps/secret rares), en
>   **orden natural por número** (`Card.number` es String → el backend ordena numéricamente, no lexicográfico). Los
>   filtros locales (rareza/acabado/faltantes) los hace el front. No paginado (un set es acotado; virtualización = fase 2).
> - **`POST /admin/inventory/items/batch` (NUEVO, `vault_operator+`, §M1):** alta por LOTE (carrito de captura, #12).
>   N líneas en 1 request; **errores por-línea** (una línea inválida no tumba las demás → HTTP 200); **idempotencia
>   por `batchKey`**; **auditoría por lote** (`InventoryBatch`). Cada línea reusa la misma resolución de
>   `POST /admin/inventory/items` (costo por aportación server-side, validación de `finish`/cert). DTOs
>   `BatchInventoryItemInput` / `BatchInventoryLineResult` / `BatchCreateInventoryResponse`.
> - **`POST /admin/inventory/items/bulk-publish` (NUEVO, `vault_operator+`, §M1):** publicar por LOTE (varias piezas →
>   `listed` con precio **derivado** de las reglas de venta por rareza+acabado o **manual**). **Errores por-línea**
>   (`PRICE_PENDING` no publica esa pieza, no tumba las demás). DTOs `BulkPublishLineInput` / `BulkPublishLineResult` /
>   `BulkPublishResponse`.
> - **Backend además:** `@@index([cardId, finish, status])` en `InventoryItem` (M-21) para las agregaciones;
>   `PrismaService.nextFolios(n)` (folios consecutivos por lote en 1 llamada a la secuencia); `PricingService.
>   getReferencesBatch(items)` (referencias por lote, cierra la familia RB-8/BE-4/D3); y pago **mínimo** de **BE-25**
>   (izar `SALES_PRICE_RULES`+fallback una vez por request + batch de referencias en `fetchSellable`/bulk-publish).
> - **Reuso:** la misma vista Master Set (grid por número + acabados) sirve para **cotizar/comprar/inventariar** — el
>   binder es la superficie común; back-office la usa para inventariar, el cotizador/Compra para elegir carta+acabado.
> - **Sin cambios** en enums, SEC-A1, ni en el modelo por-pieza. **Fase 2 (fuera de este WS):** virtualización del
>   binder, export/import CSV del lote, y una tabla materializada `InventoryStockSummary` (denormalización de conteos).
>
> **Changelog v1.15-buylist-batch-clabe (2026-08-17) — WS-C: cotizador de buylist (Fable) contra el backend REAL
> (Fase 3b).** Cierra los mocks/atajos del cotizador rediseñado. **Aditivo, SIN migración.** **TOCA DINERO/PII**
> (buylist = pago SPEI + CLABE + INE) → triple veredicto. SEC-A1 intacto (montos server-side por `(Card.rarity,
> finish)`; el cliente nunca fija precio ni CLABE de terceros). Ver ARCHITECTURE §4.16.
> - **`clabe` OPCIONAL + fallback server-side (§6, PII):** `POST /buylist/requests` deja de exigir `clabe`. Si el
>   request **no** la trae, el backend usa la CLABE **del propio usuario** en archivo (`kyc.clabeEnc`, desencriptada —
>   mismo fallback que `reveal-clabe`). Si **no** viene ni hay en archivo → **`422 CLABE_REQUIRED`** (nuevo). La CLABE
>   resuelta **nunca** se loguea ni se devuelve; se guarda cifrada (snapshot) y solo se revela por
>   `GET /admin/buylist/:id/reveal-clabe`. Con `clabe` presente, el comportamiento no cambia (formato + nombre propio).
> - **Batch quote `POST /buylist/quote/batch` (§6, NUEVO, `public`, READ-ONLY):** cotiza **N cartas en 1 request**
>   (mata el fan-out FE-12). **No** crea solicitud, **no** mueve dinero, **no** persiste, **no** escala a pendiente.
>   **Errores por-ítem** (una carta inválida no tumba las demás): cada resultado es `ok:true`/`ok:false`; HTTP global
>   `200`. **Cap `50`** ítems (vacío/sobre-cap → `400 VALIDATION_ERROR`). Reusa la misma resolución de monto que
>   `POST /buylist/quote` (rareza+acabado, gate premium, `BUYLIST_PRICE_RULES`, FX en `PriceReference`). Se **conserva**
>   `POST /buylist/quote` (por-carta) intacto. DTOs `BuylistQuoteItemDTO`/`BuylistBatchQuoteResultDTO`/
>   `BuylistBatchQuoteResponse`.
> - **`GET /users/me/kyc` gana `clabeOnFile: boolean` (§1):** simétrico al **`ineOnFile`** ya existente. El front usa
>   `ineOnFile` para **ocultar los uploaders de INE** (y omitir `ineUploadKeys`) y `clabeOnFile` para el atajo "usar mi
>   CLABE ****1234" (= **omitir** `clabe`). `clabeMasked` se conserva para el label. Sin PII nueva.
> - **Error nuevo:** `422 CLABE_REQUIRED`. **Sin cambios** en enums ni migración.
>
> **Changelog v1.14-price-ingest (2026-08-17) — WS-A: ingesta MASIVA de precios vía proveedor de PAGA
> (PokemonPriceTracker), pluggable, que reemplaza el barrido por-carta frágil.** El pricing del catálogo pasa de un
> re-sync completo de pokemontcg.io fire-and-forget en memoria (que se cae al reiniciar) a un **job de ingest masivo por
> SET** que consume el endpoint bulk del proveedor de paga (`POST /api/v1/cards/bulk-price`, auth `Bearer`). **Aditivo,
> SIN migración** (reusa `PriceReference`+`finish`, `PriceSource.pokemonpricetracker` ya existente, `Card.availableFinishes`).
> El **grueso es backend/devops interno**; la superficie de contrato es mínima. SEC-A1 intacto (precios server-side desde
> el proveedor; `finish` es dimensión de la clave, no monto del cliente). Toca dinero → triple veredicto. Ver ARCHITECTURE §4.15.
> - **Ops (NUEVO, §M10-ops):** `POST /api/v1/admin/jobs/price-ingest` (`super_admin`, auditado, single-flight) — dispara
>   el ingest masivo (fan-out BullMQ **un job por set**; reanudable). Acepta **`setId?`** opcional (excepción al body-vacío
>   de la familia, justificada: verificar el esquema del proveedor en la 1ª corrida con un solo set). **Toca dinero**
>   (mueve precios de referencia). Equivale a la corrida programada 1–2×/día.
> - **M10 settings (NUEVO dial):** `GET/PUT /api/v1/admin/settings` gana **`priceProvider`** (`price_provider`,
>   ~~`pokemonpricetracker | pokemontcg_io`~~ **enum vigente `tcgcsv_singles | pokemonpricetracker | pokemontcg_io`
>   — actualizado v1.48; ver §M10 y Changelog v1.48**) — selecciona el proveedor de ingest **sin redeploy** (palanca de
>   rollback money-safe). ~~Seed recomendado `pokemontcg_io` … flip a `pokemonpricetracker`~~ *(superado por P-47/v1.44:
>   provider primario vigente = `tcgcsv_singles`)*. Editable por `PUT /admin/settings` parcial; auditado (`settings.update`).
> - **FX / colchón (#13):** `PUT /api/v1/admin/fx` gana **`rate?` opcional** — si se omite `rate`, actualiza **solo** el
>   colchón (`bufferPct`) y **NO** pinnea el override manual de tasa (hoy exige ambos y congela la tasa auto de Banxico).
>   **Alternativa recomendada sin cambio de contrato de FX:** guardar el colchón por `PUT /admin/settings { fxBufferPct }`
>   (parcial, ya soportado). Nota de UI para M2 (frontend). El colchón **aplica en cada ingest** (USD→MXN con FX+buffer).
> - ~~**`CardDTO.availableFinishes` (mismo shape, nueva FUENTE):** pasa a **derivarse del proveedor** de paga en el
>   ingest (que trae las variantes reales del mercado), reemplazando la derivación frágil de `tcgplayer.prices`.~~
>   ⛔ **DEROGADO por v1.22-variantes-orden:** derivar las **variantes** de un feed de **precios** hacía que un acabado
>   sin `market` desapareciera del catálogo (una casilla de menos en el binder y `422 FINISH_NOT_AVAILABLE` al
>   cotizarlo). Fuente vigente = **sync de catálogo** (`tcgplayer.prices` ∪ `cardmarket.reverseHolo*`); el ingest
>   **no escribe** el campo. Sigue siendo la lista blanca SEC-A1 del `finish`. Ver §DTOs y ARCHITECTURE §4.22a.
> - **Sin endpoint nuevo de catálogo/quote:** el ingest es interno (job); `POST /buylist/quote`, `GET /catalog/*` y
>   `POST /admin/catalog/sync-all` **no cambian de shape** — solo mejora la **completitud/frescura** de los precios que
>   devuelven. `catalog-sync` queda como **solo metadata** (import de sets nuevos); su rol de pricing lo asume el ingest.
>
> **Changelog v1.13-sales-pricing (2026-08-17) — FASE 2 del epic de precios: precio de VENTA por RAREZA, editable en
> M2 (análogo al de COMPRA/buylist).** Reemplaza el **markup GLOBAL único** de venta (`salesMarkupPct`, dial M10) por
> una **tabla de regla por rareza** (`fixed` MX$ / `pct` % **ARRIBA de mercado**) + fallback %, editable sin redeploy.
> **Aditivo, SIN migración** (el precio de venta ya se congela en `OrderItem.unitPriceCents`). SEC-A1 intacto (la
> rareza/acabado se derivan server-side de `Card.rarity`/`InventoryItem.finish`, nunca del cliente). Toca dinero →
> triple veredicto. Ver ARCHITECTURE §4.14.
> - **M2 (NUEVO, backend):** `GET/PUT /api/v1/admin/pricing/sales-rules` (lee/edita la tabla + fallback) y
>   `GET /api/v1/admin/pricing/sales-rarities` (rarezas distintas del catálogo unidas a las reglas de venta).
>   **Clones exactos** de `buylist-rules`/`rarities`. Auditados. Ver §M2.
> - **DTOs nuevos:** `SalesRule = { mode: SalesRuleMode, value }` (misma forma que `BuylistRule`; `SalesRuleMode =
>   fixed | pct`), `SalesRuleApplied`, `SalesRulesDTO`, `SalesRarityRowDTO`, `SalesRaritiesResponse`. Ver §DTOs base.
> - **Semántica de `pct` (¡distinta a buylist!):** en venta `pct` = **markup ARRIBA de mercado** → `salePriceCents =
>   round(referencia × (1 + value/100))`. En buylist `pct` = **% de** la referencia (`ref × value/100`). Misma forma
>   de dato, matemática distinta. El editor front debe rotular "% arriba de mercado".
> - **Validación:** `fixed`→`value` entero ≥ 0 (centavos); `pct`→`value` número en **`[0, 1000]`** (propuesta; el `pct`
>   de venta puede >100% a diferencia del de buylist que topa en 100%); `fallbackPct` en el mismo rango. Ver
>   ARCHITECTURE decisión abierta v1.13-2.
> - **Comportamiento:** el precio de venta de `ListingDTO.salePriceCents` y del checkout deja de usar el markup global
>   y se resuelve por la regla de la rareza+acabado del item (reusa el **gate premium** de Fase 0). Una carta bulk sin
>   market con regla `fixed` ahora obtiene precio de venta (piso) y puede ser `sellable`. **Mismos shapes** de
>   `ListingDTO`/checkout (solo cambia cómo se calcula el número). `salesMarkupPct` (M10) queda **DEPRECADO** (palanca
>   de rollback; decisión abierta v1.13-3).
>
> **Changelog v1.12.1 (2026-08-17) — Reconciliación de contrato: `POST /admin/jobs/catalog-price-sync` (Fase 1, tarea 1.3).**
> QA detectó (commit `a6a79df`) que el changelog v1.12 decía "**Sin endpoint nuevo**" para 1.3, pero el backend **sí**
> añadió (opción **autorizada** por ARCHITECTURE **§4.13c**) el disparador manual **`POST /admin/jobs/catalog-price-sync`**
> (`super_admin`, auditado). Se corrige la nota de 1.3 abajo y se **documenta de una vez la familia interna de ops
> `POST /admin/jobs/*`** (portfolio-snapshot, ine-retention, set-price-sync, catalog-price-sync, …), que existía en
> código pero no en la fuente de verdad. **Sin cambio de comportamiento** (solo se documenta lo ya implementado); sin
> migración. Ver §M10-ops.
>
> **Changelog v1.12-catalog-pricing (2026-08-17) — FASE 1 del epic de precios (preciar TODO el catálogo +
> refresco 2×/día + import de sets nuevos).** **Sin migración**; los cambios de contrato son mayormente de
> **comportamiento**. La única superficie **nueva** es el disparador de ops **`POST /admin/jobs/catalog-price-sync`**
> (tarea 1.3, **opcional**, autorizado por ARCHITECTURE **§4.13c**; ver §M10-ops); el resto reusa endpoints
> existentes. Ver ARCHITECTURE §4.13. Toca dinero → triple veredicto.
> - **`POST /buylist/quote` pasa a READ-ONLY (supersede BE-16):** el cotizador público **ya no escribe** en la cola
>   de precio pendiente (se elimina el `escalatePending` que se había añadido en Fase 0.2). **Mismo shape de
>   request/response**; lo que cambia es que un `quote` con `precio_pendiente` **ya no** genera un `PendingPriceEntry`
>   desde el endpoint anónimo. La escalada sigue **solo** en `POST /buylist/requests` (autenticado). Habilitado por
>   el priming de todo el catálogo (abajo): el `referencePrice`/`quote` del cotizador ahora sale `priced` para casi
>   cualquier carta del catálogo (no solo bóveda). SEC-A1 intacto (montos server-side).
> - **Priming de `PriceReference` de TODO el catálogo (interno, sin endpoint):** el `catalog-sync` ahora **puebla
>   `PriceReference`** por `(card, finish)` reusando `tcgplayer.prices` ya descargado (`raw`/`raw:NM`, FX del día).
>   Efecto observable en el contrato: `POST /buylist/quote` y `GET /catalog/*` devuelven precio para cartas fuera de
>   bóveda. Cartas sin `market` no generan referencia ni pendiente (no se inunda la cola).
> - **Refresco 2×/día + import de sets nuevos (job interno `catalog-price-sync`, 06:00 y 18:00 CDMX, configurable):**
>   refrescar precios ⇒ re-sync del catálogo (pokemontcg.io no tiene bulk de solo-precios). El job automático corre
>   por cron; el **disparo manual** de 1.3 se expone con **`POST /admin/jobs/catalog-price-sync`** (NUEVO,
>   `super_admin`, **auditado**, opción **autorizada por ARCHITECTURE §4.13c**), que encola el **mismo re-sync
>   completo** (`force:true`, **single-flight**). **Equivale** a `POST /admin/catalog/sync-all {force:true}` (que
>   también existe). Ver §M10-ops. *(Corrección v1.12.1: la nota original decía "Sin endpoint nuevo".)*
> - **1.4 "Importar sets nuevos" (M2, solo frontend):** reusa `POST /admin/catalog/sync-all {force:false}` +
>   `GET /admin/catalog/sync-status` + `GET /admin/catalog/remote-sets`. **No requiere endpoint nuevo.**
>
> **Changelog v1.11-premium-gate (2026-08-17) — Gate PREMIUM en el cotizador de buylist (fix de dinero, Fase 0):**
> Documenta lo YA implementado por backend (`backend/src/common/money.ts`, commit `ebb4dee`) en **`POST
> /buylist/quote`** (§6). **Sin cambio de shape de request/response**: mismo `appliedRule`/`ruleSource`/`quote`; lo
> que cambia es **cómo el servidor resuelve la regla** para `holofoil`/`first_edition_holofoil`.
> - **Regla nueva:** una **rareza PREMIUM** (chase / alto valor — `isPremiumRarity`) en `holofoil`/`1st-ed holo`
>   resuelve a `[rarity]` **únicamente** (su regla explícita o el fallback pct = % de mercado); **nunca** a la clave
>   sintética `"Holo"` ni a ningún bin **fijo** de bulk. Antes, esas chase (ex/Full Art/Illustration/Ultra/Double
>   Rare, V/VMAX/VSTAR/GX… — que solo existen en holofoil pero cuyo string NO contiene "holo") caían a `['Holo']` y,
>   con una regla `"Holo"` fija barata, cotizaban al bin de bulk (bug de dinero). No premium → semántica previa.
> - **`isPremiumRarity` es parte del contrato de pricing:** lista canónica de patrones documentada en §6 y en
>   ARCHITECTURE §4.2.1. SEC-A1 intacto (monto derivado server-side de `(Card.rarity, finish)` validado).
> - **Common/Uncommon en holofoil (punto abierto resuelto):** se **mantiene** "% del market holofoil"; sin cambio de
>   contrato ni de backend (ver ARCHITECTURE §4.2.1, Decisión 2026-08-17).
>
> **Changelog v1.10-sync-status (2026-08-17) — Progreso observable del barrido `sync-all` (M2, polling):**
> **Bendición retroactiva** de un endpoint **YA implementado, probado y con triple veredicto APROBADO**
> (qa+techlead+seguridad), que QA marcó como **brecha de contrato** por no estar en la fuente de verdad. Se
> documenta aquí **exactamente** el shape ya espejado en `frontend/src/types/contract.ts` como
> `CatalogSyncStatusResponse`, para alinear productor (backend) y consumidor (frontend).
> - **`GET /api/v1/admin/catalog/sync-status` (NUEVO, `super_admin`):** devuelve el **progreso** del barrido
>   `sync-all` en curso (o del último). Convierte el `sync-all` de fire-and-forget "a ciegas" en un flujo
>   **observable**: M2 pollea cada ~3s mientras `running` y sabe **cuándo** terminó (`finishedAt`). **Read-only,
>   NO auditado** (es de polling), **NO llama a pokemontcg.io** (lee estado en memoria del proceso; **no**
>   consume rate-limit). Ver §M2.
> - **Límite conocido (DEV-1):** el estado vive **en memoria del proceso** (no persistido). Si el proceso se
>   reinicia a mitad del barrido, el estado se **pierde** y hay que re-llamar `sync-all`. Ligado al cableado
>   pendiente de BullMQ (Desviación **DEV-1**, ARCHITECTURE §9).
>
> **Changelog v1.9-set-chart (2026-08-16) — Gráfica PÚBLICA del valor de un set en el tiempo (hero de la home):**
> Dos endpoints **PÚBLICOS** nuevos (`@Public()`) para el hero de la home, que sirven la serie diaria del **valor
> de mercado agregado de un set destacado** — para atraer visitantes anónimos (hoy la home solo muestra el
> vistazo del portafolio PERSONAL, visible solo con sesión). Datos REALES con captura diaria (pokemontcg.io solo
> da precio de HOY → la serie se siembra hoy y crece a diario, patrón `PortfolioSnapshot`). **Aditivo**,
> migración **M-20** (modelo `SetValueSnapshot`, sin backfill). **SEC-A1 intacto** (el valor se deriva server-side
> de `PriceReference` real). **Sin PII** (solo valor agregado de mercado).
> - **`GET /api/v1/catalog/featured-set/value-history` (NUEVO, `public`):** el "set destacado" de la home,
>   resuelto server-side (env `HOME_FEATURED_SET_ID` + fallback, ARCHITECTURE §4.12b) para que el front **no**
>   hardcodee un id. Query `?range=5d|15d|1m|3m|6m|1y|ytd|all` (default `1m`). Res: `{ set, range, points, change }`.
> - **`GET /api/v1/catalog/sets/:id/value-history` (NUEVO, `public`):** genérico por-id, misma forma, por si se
>   quiere graficar otro set. `:id` es el **id local** del `CardSet` (no el `externalId`).
> - **DTO nuevo `SetValuePointDTO = { date, valueMxnCents, pricedCardCount, estimated? }`** (misma línea que
>   `PortfolioPointDTO`). `change` = `{ absMxnCents, pct, direction }` (idéntico al de portafolio). El objeto
>   `set` = `{ id, name, series, releaseDate }`.
> - **Regla de valor:** `valueMxnCents` = SUM de la `PriceReference` vigente por carta del set (acabado `normal`,
>   `raw`, `gradeKey='raw:NM'`); cartas sin precio se **excluyen** del total pero se cuentan en `pricedCardCount`
>   (vs total del set). Es "valor de las cartas priceadas del set", NO promesa de set completo. Ver ARCHITECTURE §4.12.
> - **No fabrica datos:** un día sin snapshot **no** tiene punto; si el set no tiene ninguna carta priceada,
>   `points: []` y `change` en `flat`; si no hay `CardSet`, `set: null`.
>
> **Changelog v1.8-ronda-c (2026-08-16) — Tres deudas de Ronda C (BE-10, PendingPriceEntry+finish, SEC-D2):**
> Tres cambios **aditivos**, una sola migración **M-19** (dos columnas; BE-10 no migra). SEC-A1 intacto (montos
> server-side). Ver ARCHITECTURE Changelog v1.8-ronda-c.
> - **BE-10 — `AdminUserOwnedItemRef` gana `finish` + `referenceValue`:** la pestaña "Bóveda" de la ficha 360°
>   (`GET /admin/users/:id`, §M6) devolvía por ítem solo `{ inventoryItemId, folio, card, ownershipStatus }`. Ahora
>   incluye **`finish: Finish`** y **`referenceValue: PriceInfo`** (mismo `PriceInfo` que `HoldingDTO` §3, reusando
>   la valuación por-acabado `getReference`). **Decisión: enriquecer el ref** (no `GET /admin/users/:id/holdings`
>   paginado) porque la bóveda por usuario es acotada y `getUser` ya trae `ownedItems`. Ver §M6 y §11. **Proyección,
>   NO migra.**
> - **PendingPriceEntry + `finish`:** el DTO `PendingPriceEntry` (§11) y la cola de precio pendiente ganan
>   **`finish: Finish`**. Antes la cola se llevaba por `(cardId, productType, gradeKey)` sin `finish` → acabados
>   distintos colapsaban en UNA entrada y el override de `normal` cerraba el pendiente de `holofoil`. `POST
>   /admin/pricing/override` (§M2) gana **`finish?`** (default `normal`) para resolver el pendiente del acabado
>   correcto. `getReference` ya era por-acabado (no cambia). **Migración M-19** (columna en `PendingPriceEntry`).
> - **SEC-D2 — `SellRequest.closedAt`:** columna interna nueva `closedAt: DateTime?` (M-19), seteada al llegar a
>   estado terminal (`pagada`/`rechazada`/`abandonada`); el job `ine-retention` la usa para anclar la ventana de
>   retención de INE al cierre real. **Campo interno de cumplimiento — NO se expone en DTOs de cliente.**
>
> **Changelog v1.7-admin-users (2026-08-16) — Alta de usuarios por rol desde admin (E1) + historial 360° por usuario (F1):**
> Dos adiciones **aditivas** de back-office (M6), sin romper consumidores existentes. NO requieren migración
> (reusan modelos existentes: `User`, `AuditLog`, y los listados admin ya paginados).
> - **E1 — `POST /api/v1/admin/users` (NUEVO, `super_admin` only, auditado `user.create`, NO money-out):** alta de
>   cuentas de cualquier rol desde back-office (hoy solo hay auto-registro de `customer` y staff por seed). Req:
>   `email` (IsEmail, se lowercasea), `name` (required), `role` (`@IsIn(customer|vault_operator|super_admin)`),
>   `password?` (si se omite, el backend **autogenera** una temporal de alta entropía y la devuelve **una sola vez**,
>   patrón reset M-15), `phone?`, `locale?`. **Sin KYC/CLABE/INE** (perfiles self-service). Res `201`: el usuario
>   creado (shape público, sin `passwordHash`) + `tempPassword?` (solo si se autogeneró) + `mustChangePassword`.
>   Errores: `409 EMAIL_TAKEN` (P2002), `422 VALIDATION_ERROR` (rol/email inválidos, password débil), `403 FORBIDDEN`.
>   **Decisiones (defaults):** `emailVerified=true` para staff (operator/admin, como el seed) y también para el
>   `customer` creado por admin (el admin da fe; no se envía correo); `authProvider='local'`; `mustChangePassword=true`
>   **solo** cuando la contraseña es autogenerada (`false` si el admin la provee explícita). **Seguridad:** crear
>   `super_admin` es **escalada de privilegios** → el control es super_admin-only + auditoría (la contraseña **nunca**
>   se registra en `AuditLog`). Ver §M6 y ARCHITECTURE §4.7bis.
> - **F1 — Historial 360° por usuario (REUSO, no engorda `getUser`):**
>   - **`?userId=` (query opcional) añadido** a `GET /admin/buylist`, `GET /admin/shipments` y `GET /admin/disputes`
>     — **simetría** con `GET /admin/orders` que ya lo tenía. Paginados, mismo guard (`vault_operator+`) y misma
>     proyección PII por rol (el filtro no cambia el shape). Ver §M4/§M5/§M8.
>   - **`GET /api/v1/admin/users/:id/audit` (NUEVO, paginado):** entradas de `AuditLog` de/ sobre el usuario. Query
>     `?scope=target|actor|both` (default `target` = `entityType='User' AND entityId=:id`; `actor` = `actorUserId=:id`;
>     `both` = OR). **Expone** `id, actorUserId, actorRole, action, entityType, entityId, createdAt` (+ `ip` **solo**
>     para `super_admin`); **NUNCA** `before`/`after` (posible PII/estado sensible). Roles: `super_admin` (proyección
>     completa con `ip`) y `vault_operator` (**reducido, sin `ip`**). Ver §M6.
>
> **Changelog v1.6-finish (2026-08-16) — Acabado / versión de carta (finish) en toda la cadena (PROJECT.md §I / v1.4, criterios 37–44):**
> Las cartas se distinguen por **acabado**: `Finish = normal | reverse_holo | holofoil | first_edition_holofoil`
> (derivados de las llaves de `tcgplayer.prices`; mapeo en ARCHITECTURE §3.7). El monto se **deriva server-side**
> de `(Card.rarity, finish)` **validado contra `Card.availableFinishes`** (SEC-A1 intacto); un acabado no
> disponible se **bloquea** (`422 FINISH_NOT_AVAILABLE`). **1 fila por `Card`** (no cambia): los acabados viven en
> `Card.availableFinishes` (array).
> - **Enum nuevo:** `Finish` (§Enums).
> - **DTOs:** `CardDTO` gana **`availableFinishes: Finish[]`**; `ListingDTO`, `HoldingDTO` y `SellItemDTO` ganan
>   **`finish: Finish`**. `referenceValue`/`salePriceCents` se calculan contra la referencia **de ese acabado**.
> - **Cotizador:** `POST /buylist/quote` (req gana `finish?`, res gana `finish` + `appliedRule` resuelto por
>   acabado) y `POST /buylist/requests` (`items[]` gana `finish?`). Default `normal` si se omite. La regla la
>   selecciona el acabado (reverse holo → `"Reverse Holo"`; holofoil / 1st ed → rareza base si ya es holo, si no
>   `"Holo"`; normal → rareza base) y el `pct` usa el market del acabado. Ver ARCHITECTURE §4.2.1.
> - **Compra (§2):** `GET /catalog/cards` gana filtro **`finish`**; `GET /catalog/facets` gana **`finishes`**.
> - **M1 (§10):** `POST /admin/inventory/items` gana **`finish?`** (default `normal`; validado contra
>   `availableFinishes`).
> - **Error nuevo:** `422 FINISH_NOT_AVAILABLE` (acabado fuera de `Card.availableFinishes`).
> - **Migración M-18** (ARCHITECTURE §11), aditiva con default seguro. **Requiere RE-SYNC del catálogo** tras
>   desplegar para poblar `availableFinishes` + precios por acabado.
> - **Sync-all `force` (admin):** `POST /admin/catalog/sync-all` gana **`force?: boolean = false`** (opcional,
>   admin-only). `force=true` **no filtra** los sets ya importados y reprocesa **TODO** el catálogo para repoblar
>   `availableFinishes`/precios por acabado tras la migración M-18; `false` (default) mantiene el comportamiento
>   actual (salta sets ya importados). **Aditivo y retrocompatible** — no rompe consumidores. Ver §M2.
> - **NO cambia:** SEC-A1 (monto server-side), 1 fila por `Card` (`externalId @unique`), semántica de `gradeKey`
>   para graded/sealed, tabla `BUYLIST_PRICE_RULES` (se reutiliza).
>
> **Changelog v1.5-auth-email (2026-08-16) — Verificación de correo + recuperación de contraseña self-service (Resend):**
> Decisiones de producto cerradas por el humano. **La verificación NO bloquea el login** — bloquea **acciones
> sensibles** (server-side, no solo UI). Recuperación con **ambos** flujos (self-service por email + reset por
> admin existente).
> - **Endpoints nuevos (auth, §1):** `POST /auth/verify-email/resend` (`customer+`), `POST /auth/verify-email`
>   (`public`), `POST /auth/forgot-password` (`public`, **siempre 200** anti-enumeración), `POST /auth/reset-password`
>   (`public`). El registro email/password **emite** el token de verificación y envía el correo.
> - **Objeto `user` de `/auth/register|login|google` ahora incluye `emailVerified`** (ya estaba en `/users/me`).
>   El front usa ese flag para el banner "verifica tu correo"; el bloqueo real lo hace el backend.
> - **Gating server-side (nuevo `403 EMAIL_NOT_VERIFIED`):** con `emailVerified=false` se rechazan
>   `POST /checkout/session` (§4), `POST /shipments` (§5) y `POST /buylist/requests` (§6). Los `*/quote` y el
>   cotizador público **no** se bloquean. Google entra con `emailVerified=true` (no afectado).
> - **Modelo de tokens (`AuthToken`, MIGRACIÓN M-17):** un solo uso, `type` (`email_verification | password_reset`),
>   **hash** en BD (nunca el claro), expira 24h / 1h. Ver ARCHITECTURE §3.2, §4.11 y §11.
> - **Reset (self-service o admin) incrementa `User.tokenVersion`** → revoca sesiones (patrón existente).
> - **Env nuevas:** `RESEND_API_KEY` (secreto, requerida en no-local), `MAIL_FROM` (remitente; **valor por
>   entorno**, default en código sobre el dominio canónico `common.brand.domain` — p. ej. `no-reply@tcghunt.mx`).
>   Los links de los correos apuntan al **frontend** (`${APP_BASE_URL}/<locale>/verify-email|reset-password?token=…`).
>
> **Changelog v1.2 / v1.2.1 (2026-08-14):** simplificación aprobada por el humano (PROJECT.md › "Simplificación
> v1.2" y "Corrección v1.2.1").
> - **Sin fotos de producto/inventario:** el producto **no lleva fotos propias**; la imagen mostrada es la
>   **imagen de catálogo remota** de pokemontcg.io (`CardDTO.imageSmallUrl` / `imageLargeUrl`). Se **eliminan**
>   `frontPhotoUrl`/`backPhotoUrl` de `ListingDTO` y se **relajan** los campos de foto del alta de inventario
>   (`frontPhotoKey`/`backPhotoKey`/`extraPhotoKeys` pasan a opcionales/eliminados). **Migración** (ver
>   ARCHITECTURE §11 M-13).
> - **Gradeadas por certificado:** `InventoryItem`/alta captura **`certNumber`** (string, nº de certificado
>   PSA/CGC), **requerido para publicar una gradeada**; el listing expone `gradingCompany + gradeValue +
>   certNumber`. Sin validación automática contra la graduadora (fuera de alcance). **Migración** (M-12).
> - **Uploads acotados a `kyc_ine`:** `POST /uploads/presign` **solo** admite `purpose="kyc_ine"`; se
>   **deprecan/eliminan** `inventory_photo` y `dispute_claim`.
> - **Disputa por correo:** `POST /disputes` **ya no** acepta evidencia por archivo; la evidencia se envía **por
>   correo a soporte** (dato de contacto, no endpoint). Se conserva `type` (`condition_raw | condition_sealed`)
>   y la política de VENTAS FINALES (§7/§M8). Ya no hay comparador de fotos de ingreso.
> - **INE (KYC) intacto:** el almacenamiento de INE en R2 (cifrado + retención `INE_RETENTION_DAYS`) y el set
>   `S3_*` **se conservan** (ahora justificados solo por `kyc_ine`). PII/cifrado/`reveal-clabe` sin cambios.
>
> **Changelog v1.1 (2026-08-14):** `RawCondition` reducido a `NM` (migración); `GET /catalog/cards`
> devuelve solo inventario **publicado con precio** (nunca "precio pendiente" al comprador) + nuevo
> `GET /catalog/facets` (facetas dinámicas) y `GET /catalog/sets` con `year`; sellado como línea de venta
> (`sealedSubtype`, precio manual MXN); `POST /auth/google`; `GET /vault/portfolio/history`; endpoints admin
> de **sync de catálogo** (M2); AcquisitionPricer con rarezas modernas. Ver ARCHITECTURE §11 (migraciones).
>
> **Changelog v1.4-finance (2026-08-16) — Costo real de paquetería en el P&L (PROJECT.md req #3, §M7 / criterio 21):**
> El P&L trataba el envío **solo como ingreso** (`shippingFeeCents`) y nunca restaba el **costo real** pagado a
> la paquetería, sobreestimando la ganancia. Se corrige de forma **aditiva** (sin romper el resto del contrato):
> - **Modelo (backend):** `ShipmentRequest` gana `shippingCostCents` (`Int @default(0)`) = costo real MXN
>   (centavos) que la plataforma paga al carrier. **Migración M-16** (ARCHITECTURE §11). No toca `shippingFeeCents`.
> - **Captura (M4):** `POST /admin/shipments/:id/tracking` gana `shippingCostCents?` (opcional, editable, entero
>   ≥ 0) — el operador lo captura al asignar carrier/guía. Ver §M4.
> - **P&L (M7):** `GET /admin/finance/pnl` **renombra** `shippingCents`→`shippingRevenueCents` (ingreso) y
>   **añade** `shippingCostCents` (costo). Nueva fórmula:
>   `profitCents = incomeCents + shippingRevenueCents − cogsCents − stripeFeesCents − shippingCostCents`.
>   **Decisión de naming:** se renombra (no solo se añade) porque `shippingRevenueCents` elimina la ambigüedad de
>   tener dos claves de envío. Es un **breaking change**: M7 **sí** tiene un consumidor de frontend real y montado
>   (`admin/m7/M7View.tsx`, que llama a `getPnl` y renderiza el desglose del P&L), así que se actualizaron
>   **productor y consumidor en la misma entrega** (no hubo periodo de compatibilidad porque el front migró al
>   shape de 6 claves al mismo tiempo). El costo se acota al periodo por `pickingAt` (igual que el ingreso). El
>   CSV export (`export.csv?report=pnl`) espeja el nuevo shape. Ver §M7.
>
> **Changelog v1.3.1 (2026-08-16) — Precio de buylist por RAREZA OFICIAL (editable en M2):**
> Reemplaza las **3 categorías hardcodeadas** (`comun|reverse_holo|ex_plus` + `rarity-map`) por una **tabla de
> regla por rareza** (`fixed` MX$ / `pct` % de la referencia), editable sin redeploy. PROJECT.md §E.1,
> criterios 12/12b/12c/18.
> - **Enums:** nuevo `BuylistRuleMode = fixed | pct`. `BuylistCategory` **DEPRECADO** (retención legacy).
> - **Cotizador:** `POST /buylist/quote` devuelve `rarity` + `appliedRule` + `ruleSource` en vez de `category`.
>   `POST /buylist/requests` **ya no** recibe `category` en `items` (el backend deriva la regla de `Card.rarity`).
>   `SellItemDTO` expone `rarity` + `appliedRule` en vez de `category`.
> - **M2 (NUEVO, backend):** `GET/PUT /admin/pricing/buylist-rules` (lee/edita la tabla + fallback) y
>   `GET /admin/pricing/rarities` (rarezas distintas del catálogo unidas a las reglas). `GET/PUT
>   /admin/pricing/rarity-map` **DEPRECADOS**.
> - **Diales:** `buylist_price_rules` (mapa) + `buylist_price_fallback_pct` (default **40**) como `ConfigSetting`;
>   se editan por los endpoints de M2 (no por `PUT /admin/settings`). Ver §M2 y ARCHITECTURE §3.2/§4.2.
> - **Migración M-14** (ARCHITECTURE §11): `SellRequestItem` snapshotea la regla aplicada; `category` deprecado.
>
> **Changelog v1.3 (2026-08-16) — Cotizador Opción 1 + confirmación de módulos de back-office:**
> - **Cotizador sobre TODO el catálogo (NUEVO, backend):** `GET /buylist/cards` (búsqueda pública sobre la
>   tabla `Card` completa, no solo el inventario de "Compra") y `GET /buylist/sets` (sets con cartas
>   importadas). Resuelven que el cotizador pueda elegir **cualquier** carta, no solo lo comprable en bóveda.
>   Ver §6.
> - **Sync de TODO el catálogo (NUEVO, backend):** `POST /admin/catalog/sync-all` (encola en background la
>   importación de **todos** los sets remotos, truly-async). El `sync`/`backfill` existentes ya permiten
>   cubrir todo el catálogo (backfill repetible hasta `remaining=0`), pero `sync-all` lo hace explícito y
>   seguro contra timeouts. Ver §M2.
> - **Confirmación (SIN cambios de contrato):** M2 (pricing/catalog), M6 (users/KYC), M7 (finance/P&L),
>   M9 (reports/export) y M10 (settings/audit-log) **ya están especificados aquí y ya existen implementados en
>   backend**, no backend nuevo. Sobre el **consumo de frontend**: **M7 YA tiene un consumidor real y montado**
>   (`admin/m7/M7View.tsx`, renderizado por `admin/m7/page.tsx`, consume `getPnl`); el resto (M2/M6/M9/M10)
>   sigue pendiente de consumir en UI (`ModuleTodo`). La **edición de diales** de M10 es `PUT /admin/settings`
>   (body parcial de keys); **no** se añade `PATCH /admin/settings/:key`. Ver §M7, §M9, §M10 y "Desviaciones" en
>   ARCHITECTURE §9.

## 0. Convenciones generales

- **Auth:** `Authorization: Bearer <accessToken>` (JWT). Refresh vía cookie httpOnly o body (ver auth).
- **Roles:** `public` (sin token), `customer`, `vault_operator`, `super_admin`. Cada endpoint declara el rol mínimo. Rutas `/admin/*` son back-office (M1–M10).
- **Dinero:** enteros en **centavos MXN** (`*Cents`). `currency` siempre `"MXN"`. No hay saldo/wallet.
- **Fechas:** ISO-8601 UTC.
- **Paginación:** query `?page=1&pageSize=20`; respuesta `{ data: [...], page, pageSize, total }`.
- **Filtros de lista admin (`q`, `from`, `to`, `minCents`, `maxCents`) — CONVENCIÓN TRANSVERSAL (v1.25-buylist-orders-pagination):** nombres y semántica **idénticos** en `GET /admin/buylist` (§M5) y `GET /admin/orders` (§M3), y compatibles con los listados que ya los usaban parcialmente. Todos **opcionales**; omitir todos = listado como antes de v1.25. **`q`:** texto libre, `trim`, **case-insensitive**, contains, OR entre los campos definidos por endpoint; vacío/whitespace = ausente; **máx 200 chars**. **`from`/`to`:** ISO-8601 sobre `createdAt`, **`gte`/`lte`** (rango inclusivo por día; sólo `from` = desde, sólo `to` = hasta). **Semántica de borde de día (v1.25.1 — aclaración de semántica de fecha, aditiva):** un valor **date-only** (`YYYY-MM-DD`, sin componente horario — lo que emite un `<input type=date>`) se interpreta en el **borde del día en UTC**: **`from` = inicio de día (`00:00:00.000Z`)** y **`to` = fin de día INCLUSIVO (`23:59:59.999Z`)**. Un valor con **componente horario** (datetime ISO completo, p. ej. `2026-08-20T14:30:00Z`) se usa **tal cual** (`gte`/`lte` exactos, sin ajuste). Así `to=YYYY-MM-DD` **incluye** todo lo cerrado ese mismo día — sin la omisión silenciosa de tratar `to` date-only como medianoche UTC (que excluiría casi todo el día en una cola money-adjacent). El backend materializa este borde en su **helper de parseo** de fechas (mismo helper para ambos endpoints). Un **rango invertido** (`from` > `to`) simplemente devuelve **vacío** — no es error (no se exige validación `from ≤ to`). **`minCents`/`maxCents`:** enteros **≥ 0** sobre el campo de monto que cada endpoint declara (`quotedTotalCents` en buylist, `totalCents` en orders), `gte`/`lte`. **Validación → `400 VALIDATION_ERROR`** (mismo patrón que la paginación): `page`/`pageSize` no numéricos o `pageSize>100`, fecha no parseable, monto no entero o negativo, `maxCents < minCents`, `q` > 200 chars, o un token de `status` (CSV, §M5) que no sea enum válido (`details.invalidStatus`). **Seguridad:** estos filtros **sólo REDUCEN** el conjunto ya autorizado por rol admin — no habilitan IDOR ni enumeración cruzada, no cambian el shape ni la proyección PII por rol, y `q` **nunca** busca sobre CLABE/RFC/INE/datos de pago.
- **i18n:** el contrato NO devuelve texto traducido. Devuelve **enums** y **`errorCode`**; el frontend traduce (ES/EN). Datos de catálogo en inglés por diseño.
- **Datos de contacto y valores de configuración — el contrato describe la FORMA y el ORIGEN, no transcribe el
  VALOR (convención transversal, v1.50.4).** Cuando un campo de respuesta transporta un **dato de infraestructura
  configurable por entorno** —hoy: correos de contacto (`evidenceContact` y cualquier buzón que la API devuelva);
  por extensión, cualquier valor que devops pueda cambiar **sin redeploy**— este contrato norma **cinco cosas y
  ninguna más**:
  1. **Tipo y forma:** `string`, dirección de correo válida (RFC 5322 `addr-spec`, opcionalmente con display name),
     **no vacía**, **siempre presente** cuando el campo es requerido por el DTO.
  2. **Origen:** **resuelto server-side** desde configuración de entorno, con **default en código**. El backend
     **nunca** omite el campo ni lo devuelve vacío; una env **definida pero vacía o en blanco cae al default**
     (helper `envOr`, **no** `??` — el `??` no cubre la cadena vacía y dejaría el campo en `""`).
  3. **Estabilidad:** el **valor** puede cambiar por entorno y en el tiempo (rebrand, cambio de proveedor de
     correo, buzón nuevo) **sin que este contrato cambie de revisión**. **Cambiar el valor NO es un cambio de
     contrato** y no requiere pasar por el arquitecto (regla 9 de `CLAUDE.md`). Cambiar su **forma u origen**, sí.
  4. **Obligación del consumidor (frontend):** **renderiza el valor que recibe**. **Prohibido** hardcodearlo,
     derivarlo del dominio, o **afirmarlo en un test de contrato** (un test que asserta el literal convierte un
     dato de infra en un candado de CI, y ese candado se vuelve en contra el día del rebrand). Un literal de
     **fallback** solo se admite en fixtures/mocks offline y en el modo degradado sin API, y debe construirse
     sobre el dominio de `common.brand.domain`, nunca sobre un literal copiado de este documento.
  5. **Los valores que aparecen en este documento son ILUSTRATIVOS**, marcados `p. ej.`, y **no son citables como
     autoridad**. La fuente ejecutable del dominio de marca es la clave i18n **`common.brand.domain`** (hoy
     `tcghunt.mx`); la del valor efectivo de un campo es **su env** (`DISPUTE_EVIDENCE_CONTACT` para
     `evidenceContact`, en cascada con `SUPPORT_EMAIL` donde aplique).

  **Por qué (y el criterio que hay que recordar).** Un literal escrito en el contrato **sobrevive a un rebrand**:
  como el contrato manda sobre el código, un dominio muerto escrito aquí **autoriza** a backend y frontend a
  reintroducirlo, y ambos tendrían razón. Además acopla lo **más barato de cambiar** (una env) a lo **más caro**
  (el contrato). Criterio generalizable, para las próximas: *si un valor puede cambiar por entorno o sin redeploy,
  el contrato norma su **forma, origen, obligatoriedad y quién lo resuelve** — nunca su contenido.* Aplica ya a
  correos y, por extensión, a remitentes, teléfonos, URLs de soporte y cualquier identificador de contacto futuro.
  Fundamento completo y clasificación decisión-vs-descripción: **ARCHITECTURE §0-B**.
- **Errores (shape estándar):**
```json
{ "error": { "code": "PRICE_PENDING", "message": "human-readable EN fallback", "details": {} } }
```
- **Códigos comunes:** `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `404 NOT_FOUND`, `409 CONFLICT`, `422` (regla de negocio), `429 RATE_LIMITED`, `500 INTERNAL`.
- **`422 FINISH_NOT_AVAILABLE` (v1.6-finish):** el `finish` enviado (cotizador, alta de inventario, solicitud) **no** está en `Card.availableFinishes`. Guardarraíl SEC-A1: el cliente no puede cotizar/vender un acabado inexistente para pagar de más. Afecta `POST /buylist/quote`, `POST /buylist/requests`, `POST /admin/inventory/items`.
- **`403 EMAIL_NOT_VERIFIED` (v1.5):** un `customer` autenticado con `emailVerified=false` intenta una **acción sensible** (comprar / retirar / vender). El front muestra el banner "verifica tu correo" y ofrece reenviar; el bloqueo lo aplica **siempre** el backend (`EmailVerifiedGuard`, ARCHITECTURE §4.11). Endpoints afectados: `POST /checkout/session`, `POST /shipments`, `POST /buylist/requests`.
- **`422 CLABE_REQUIRED` (v1.15):** `POST /buylist/requests` **sin** `clabe` en el body **y sin** CLABE en archivo (`KycProfile.clabeEnc` vacío). El front debe pedir la CLABE (o registrarla en KYC) antes de reintentar. Distinto de `422 CLABE_INVALID` (formato incorrecto) y de `422 CLABE_NOT_OWN_NAME` (no coincide con la de archivo). Ver §6 y ARCHITECTURE §4.16a.
- **`422 ITEM_NOT_PUBLISHABLE` (v1.16.1):** en `POST /admin/inventory/items/bulk-publish`, la pieza está en un status de origen **no publicable**. Solo `{in_stock, listed}` son publicables (`in_stock` → publica; `listed` → no-op idempotente). Cualquier otro (`reserved | in_custody | picking | shipped | delivered | lost | damaged | withdrawn`) → **`ITEM_NOT_PUBLISHABLE`** por-línea. **Guardarraíl anti double-sell:** una pieza reservada/vendida/en-custodia/enviada no puede re-listarse. Distinto de `PRICE_PENDING` (precio no resuelto). Ver §M1 y ARCHITECTURE §4.17b.
- **`422 ITEM_NOT_IN_CUSTODY` (v1.17.1):** en `POST /shipments`, se intenta retirar un item cuyo `status` **no es `in_custody`** — típicamente ya `withdrawn` (retiro entregado, terminal), o cualquier otro estado no custodiable. **Guardarraíl anti doble-retiro/doble-cobro:** un item ya entregado (`withdrawn`) **NO** es re-elegible para un nuevo retiro aunque conserve `ownershipStatus='settled'` (histórico). Comparte criterio con el flag de lectura `HoldingDTO.withdrawable` (§3): read y write usan la **misma** regla de elegibilidad. Distinto de `422 ITEM_NOT_SETTLED` (aún `pending`, no liquidado) y de `409 ITEM_IN_ANOTHER_SHIPMENT` (ya tiene envío activo). Ver §5 y ARCHITECTURE §3.3.
- **`422 ITEM_NOT_ADJUSTABLE` (v1.20):** en `POST /admin/inventory/adjustments`, la pieza referida **no** es ajustable: solo piezas `ownerType=platform` con status ∈ `{in_stock, listed}` admiten `perdida | danada | error_captura`. Una pieza `reserved` (en una orden viva), `in_custody`/`picking`/`shipped`/`delivered` (bóveda/envío de cliente) o ya terminal (`lost | damaged | withdrawn`) **no** se ajusta desde el binder — su salida/incidencia va por el flujo dueño (órdenes M3, retiros M4, `mark` + reposición para custodia de clientes). Ver §M1 y ARCHITECTURE §4.20e.
- **`422 INSUFFICIENT_STOCK` (v1.34):** en `POST /admin/inventory/items/bulk-remove` (baja rápida por cantidad, P-29), hay **menos** piezas ajustables que la `quantity` pedida para el `(cardId, finish[, condición])`. Ajustable = misma regla que `ITEM_NOT_ADJUSTABLE` (`ownerType=platform`, status ∈ `{in_stock, listed}`). **Operación atómica:** el fallo **NO baja ninguna pieza** (todo o nada). `details: { available: number, requested: number }` (el front muestra cuántas hay realmente para que el operador ajuste la cantidad). Distinto de `422 ITEM_NOT_ADJUSTABLE`, que aquí surge por **carrera TOCTOU** (una pieza sale del allowlist entre la lectura y la escritura ⇒ rollback). Ya en el enum central `common/error-codes.ts`. Ver §M1.
- **Códigos nuevos de la CURVA (v2.0, P-48 — `PUT /api/v1/admin/pricing/curve`; detalle en §M2 «Curva de precio por
  VALOR DE MERCADO» y ARCHITECTURE §4.36.3).** Todos son **`422`**, todos se validan **al GUARDAR** (no solo en
  runtime), todos se evalúan sobre el **objeto completo** (no sobre un delta) y **todos indican QUÉ PUNTO lo rompe**
  en `details`, cuya **forma está normada campo por campo en §M2** (v2.1.5 — **sin «…»**: el segundo extremo del
  tramo es `index2`/`marketCentsTo`, y cada código declara sus campos exactos) (PROJECT §N.3, criterio 87).
  **v2.1:** los **mismos códigos y el mismo `details`** los produce `POST /admin/pricing/curve/preview`, pero repartidos
  por **computabilidad**: los que **impiden calcular** (`VALIDATION_ERROR`, `CURVE_EMPTY`, `DUPLICATE_BREAKPOINT`,
  `ROUNDING_LADDER_INVALID` estructural) salen como **`422`** también en el preview; los que **sí dejan calcular**
  (`SALE_BELOW_MARKET`, `SALE_CURVE_NOT_MONOTONIC`, `BUY_ABOVE_SALE`, `BIN_ABOVE_FLOOR`, `ROUNDING_LADDER_INVALID` fino)
  salen en **`200` dentro de `violations[]`**, para que el previsualizador enseñe el problema **en pesos** mientras el
  dueño corrige. **Un `violations` vacío NO autoriza el `PUT`** (ver §M2):
  - **`422 CURVE_EMPTY`** — `sale.points` o `buy.points` sin puntos: sin puntos no hay curva que interpolar.
  - **`422 DUPLICATE_BREAKPOINT`** — dos puntos con el mismo `marketCents` en la misma curva (la interpolación sería
    ambigua / división por cero).
  - **`422 SALE_BELOW_MARKET`** — algún punto con `multiplierBp < 10000`: **ningún precio de venta puede caer por
    debajo del mercado**. `details.multiplierBp` señala el punto.
  - **`422 SALE_CURVE_NOT_MONOTONIC`** — la curva de venta resultante **no es monótona creciente** (más mercado
    produciría **menos** precio). Se verifica algebraicamente por tramo, **no por muestreo**. `details` señala **los
    dos extremos** del tramo infractor (`index`/`marketCents` + `index2`/`marketCentsTo`; §M2, forma normada). **v2.1.2:** el invariante se afirma sobre **el precio que se cobra**
    (`roundUp(max(piso, ROUND_HALF_UP(m·k(m)/10000)), escalera)`) y no sobre una aproximación continua suya; lo
    sostiene la **prohibición de cuantizar** el multiplicador interpolado (ARCHITECTURE §4.36.1). Es lo que hace
    cumplible el **criterio 87(a)** *de verdad*: antes se aceptaban curvas cuya venta real **sí** bajaba.
  - **`422 BUY_CURVE_NOT_MONOTONIC` (NUEVO v2.1.4)** — la curva de **compra** **no es monótona creciente**: existe un
    tramo donde **más mercado paga MENOS**. `details: { axis: "buy", index, marketCents, index2, marketCentsTo }` —
    **los DOS extremos del tramo** (§M2, forma normada).
    **Es el hermano de `SALE_CURVE_NOT_MONOTONIC` y no lo cubría nadie:** V5 solo iteraba el eje de venta y
    `BUY_ABOVE_SALE` solo ata la compra **en relativo** (por debajo de la venta), así que el monto pagado podía bajar
    **en absoluto** mientras el mercado subía — misma clase que I1, pero **silenciosa**, porque la compra no se
    redondea y no produce el salto llamativo de un peldaño. Money-safe por §N.0 **en simétrico**: pagar de menos ⇒ el
    vendedor no vende ⇒ **carta perdida, irrecuperable**. **Necesita fila de copy en DESIGN_SYSTEM §21.4c** (redacción
    final de ux-ui; sugerencia: ES «Entre MX$ {m0} y MX$ {m1} **pagarías menos** aunque el mercado suba. Sube el pago
    de MX$ {m1} o baja el de MX$ {m0}.»).
  - **`422 BUY_ABOVE_SALE`** — en algún punto del dominio la **compra alcanza o supera la venta**. **v2.1.2:** la
    condición es `multiplierBp(m) − pctBp(m) ≥ 1` (una unidad entera de la escala compartida), no `pctBp < multiplierBp`
    sobre los continuos: dos valores distintos **dentro del mismo centavo** redondeaban al mismo entero y producían
    `compra == venta` (margen cero). Se evalúa en la **unión** de los `marketCents` de ambas curvas — exacto, no
    muestreo: la diferencia es lineal por tramo, así que su mínimo cae siempre **en un nodo**.
  - **`422 BIN_ABOVE_FLOOR`** — `binCents ≥ floorCents`: el caso en que ambos ejes saturan en su constante y la compra
    igualaría/superaría la venta.
  - **`422 ROUNDING_LADDER_INVALID`** — escalera mal formada: banda sin `stepCents ≥ 1`, `uptoCents` no crecientes,
    ninguna/más de una banda abierta (`uptoCents: null`), o una **frontera que no es múltiplo exacto del paso de la
    banda inferior** (rompería la monotonía que `SALE_CURVE_NOT_MONOTONIC` acaba de garantizar).
  - **`422 BOUNTY_BELOW_RULE` (v1.28, SEMÁNTICA AMPLIADA en v2.0):** ahora compara contra la **cotización de la
    curva** y **rechaza también el EMPATE** (`priceCents ≤ curveQuoteCents`). `details: { curveQuoteCents, priceCents }`.
    Además, la misma condición se evalúa **en runtime** al cotizar y al publicar (ahí no es un `422`: el bounty
    simplemente **deja de aplicar** y **desaparece de la vitrina**). Ver §M2 y §6.
  - **RETIRADOS en v2.0:** `422 PREMIUM_RARITY_FIXED_TIER` y `422 UNKNOWN_RARITY` — sus endpoints (`/tiers`,
    `/tier-map`) ya no existen y su invariante lo sustituye el **guardarraíl** de ARCHITECTURE §4.36.5 (que no rechaza
    configuración: bloquea publicación/cotización en runtime y encola con `reason="premium_at_floor"`).
- **`422 PREMIUM_RARITY_FIXED_TIER` (v1.37, pricing por tiers, P-34) — ⛔ RETIRADO en v2.0 (P-48):** en `PUT /admin/pricing/tier-map` o `PUT
  /admin/pricing/tiers`, la edición dejaría una rareza `premium:true` (catálogo canónico, §4.28e) resolviendo en un tier
  cuya regla de **COMPRA** es `fixed` (con el seed: T0/T1). **Guardarraíl money-safe (refinamiento estricto, ARCHITECTURE
  §4.33d):** una carta chase jamás puede cotizar al bin fijo barato de bulk, **aunque el dueño edite el mapa**. El
  invariante se valida sobre el producto (tiers × mapa) completo, por eso lo emiten **ambos** PUT. `details: { offending:
  [{ rarity: string, tierId: string }] }` (los pares infractores, para que el front los marque). El eje de VENTA no lo
  dispara (un `fixed` de venta es un piso, no un bin de compra). Ya en el enum central `common/error-codes.ts`.
- **`422 UNKNOWN_RARITY` (v1.37, pricing por tiers, P-34) — ⛔ RETIRADO en v2.0 (P-48):** en `PUT /admin/pricing/tier-map`, una key de `assignments`
  **no** es una rareza canónica del catálogo (§4.28c). Money-safe: el mapa solo asigna tiers a rarezas conocidas; una key
  desconocida se rechaza en vez de crear una entrada muerta. Distinto de `422 VALIDATION_ERROR` (`TierId` fuera de
  `{T0..T4}` o body mal formado). Ver §M2 «Pricing por TIERS».
- **Códigos nuevos del guest checkout (v1.21 — detalle en §4-G):** `422 VAULT_REQUIRES_ACCOUNT` (el invitado eligió destino bóveda; **es un upsell, no un error de UI** — `details.upsell=true`), `409 ALREADY_AUTHENTICATED` (se llamó un endpoint `/checkout/guest/*` con una sesión válida), `404 INVALID_TOKEN` y `410 TOKEN_EXPIRED` / `410 TOKEN_REVOKED` (enlace de seguimiento), `409 ORDER_ALREADY_CLAIMED` (pedido ya vinculado a una cuenta), `403 CLAIM_EMAIL_MISMATCH` (el correo verificado de la sesión no es el del pedido), `422 GUEST_ORDER_TOO_OLD` (reenvío de enlace sobre un pedido fuera del tope de edad).
- **Códigos nuevos del sellado (v1.23-sealed-sales):** `404 FEATURE_DISABLED` (endpoint feature-flagged con el dial en `off`: tendencia de sellado / restock — §2-S). Reusa códigos existentes: `422 VALIDATION_ERROR` (`sealedCondition` en raw/graded; spread fuera de `[0,1000]`; restock sin identidad de producto), `422 PRICE_PENDING` (sellado sin override y sin `sealedMarketRef` al publicar/comprar), `429 RATE_LIMITED` (restock). No introduce códigos de negocio nuevos más allá de `FEATURE_DISABLED`.
- **Códigos nuevos del módulo `SealedProduct` (v1.39, P-38):** `422 SEALED_PRODUCT_NOT_FOUND` (`BatchInventoryItemInput.sealedProductId` no existe o está `active=false`; money-safe: no se crea inventario contra una identidad inválida). `422 MANUAL_MARKET_NOT_ALLOWED` (`manualMarketMxnCents` enviado cuando el mercado en vivo/caché **ya** resuelve — el override solo aplica al hueco de precio, jamás pisa un mercado vivo). **v1.39.1:** **ya NO** lo dispara el rol — el precio manual lo permite `vault_operator+` (decisión del humano); queda como error **solo** por el caso «mercado ya resuelto». Input de dinero por vault_operator → marcado para la fase de seguridad por release. Reusa: `422 PRICE_PENDING` (sellado sin mercado y sin override manual), `422 VALIDATION_ERROR` (`manualMarketMxnCents ≤ 0`; `sealedProductId` en raw/graded; `sync` sin `setId` ni `all`), `409` (grupo ya enlazado en `sealed-sets/:setId/groups`), `502 UPSTREAM_ERROR` (sync/candidates/marketRef live). Ya en el enum central `common/error-codes.ts`.
- **`502 UPSTREAM_ERROR` (transversal; formalizado v1.31):** una **fuente externa** de datos no está disponible o
  devolvió un payload inválido (timeout/red, 401/403/5xx, o parse fallido). Aplica a **TCGCSV** (`https://tcgcsv.com`,
  espejo de precios/estructura de TCGplayer) y a **pokemontcg.io** (metadata de cartas). **No** es un `500` crudo: el
  backend **remapea** el fallo remoto a `502` con mensaje accionable ("Fuente TCGCSV/pokemontcg.io no disponible;
  reintenta en unos minutos"). **Money-safe:** el resolver hace **todo** el fetch remoto **ANTES** de cualquier
  escritura, así que un fallo upstream **no escribe ni borra nada** local (se conserva lo previo). Endpoints que lo
  emiten: familia TCGCSV del sellado (§M2 `groups`/`products`), `sync`/`sync-all` (pokemontcg.io) y la familia
  **refresh-variants** (§M2, TCGCSV — M-34/M-35). En el **batch** `refresh-variants-all` **NO** se propaga como HTTP:
  se captura por-set y se reporta en `summary.failures[].code`. **Follow-up backend (no bloquea):** hoy en uso por cast
  `as ErrorCodeType` en `sealed-pricing.controller.ts` y `catalog-sync.service.ts`; pendiente añadirlo al enum central
  `common/error-codes.ts` (zona compartida) y quitar los casts.
- **`409 SET_NOT_IMPORTED` (v1.31, refresh-variants M-34):** se intentó refrescar variantes/precios de un set que
  **NO** existe en BD, o existe pero **sin cartas**. La reparación solo-TCGCSV **no importa** el set (no llama a
  pokemontcg.io); el mensaje es accionable: "impórtalo primero con `POST /admin/catalog/sync`". **Se usa `409` (no
  `404`) a propósito:** el frontend trata `404/405` como "endpoint no desplegado" (`isEndpointMissing`), así que un
  `SET_NOT_IMPORTED` real con `404` se confundiría con "endpoint faltante". `409` (Conflict: no se puede refrescar
  porque el set no está importado) deja backend y frontend alineados. Lo emite `POST /admin/catalog/refresh-variants`;
  en el batch se captura por-set y va a `summary.failures[].code`. **Mismo follow-up de enum central** que
  `UPSTREAM_ERROR`.
- **`422 REQUEST_HAS_NON_REJECTED_ITEMS` (v1.24-buylist-request-reject):** en `POST /admin/buylist/:id/reject` (botón «Rechazar solicitud» de M5), la solicitud tiene **al menos un ítem no-rechazado** (`itemStatus != "rechazada"` — p. ej. `aprobada`, `convertida_inventario`, `verificacion`). El cierre explícito es una operación **segura y mínima**: cierra la solicitud **sólo** cuando ya no queda ítem vivo, por lo que rechaza el intento en vez de rechazar ítems en cascada (eso es cherry-pick por-ítem, `PATCH /admin/buylist/items/:itemId/decision`). `details: { nonRejectedItemStatuses: SellItemStatus[] }` (los status vivos encontrados, para que el front explique qué falta cerrar). Distinto de `404 NOT_FOUND` (solicitud inexistente). Ver §M5 y ARCHITECTURE §4.18(g).
- **Acceso `public` vs `guest` (v1.21):** `public` sigue significando **sin token** (decorador `@Public()` del backend, respetado por `JwtAuthGuard`). Los endpoints de invitado son `public` **por construcción** y además **rechazan** una sesión válida (`409 ALREADY_AUTHENTICATED`): un usuario con cuenta compra por `/checkout/session`, un invitado por `/checkout/guest/session`. **No hay endpoint que sirva a los dos.** Simétricamente, ningún endpoint `customer` acepta un token de seguimiento como credencial: el `OrderAccessToken` **no** es una sesión, no otorga rol y solo lee **un** pedido.
- **Idempotencia:** endpoints de pago aceptan header `Idempotency-Key`.
- **PII sensible (CLABE / RFC / INE):** por **defecto se devuelven ENMASCARADOS** en **todas** las respuestas (cliente y back-office, incluido `super_admin`). Formato: CLABE → `****1234` (últimos 4 dígitos), RFC → parcial (ej. `XAX**********`). La **CLABE en claro (18 dígitos) SOLO** se obtiene por el endpoint dedicado `GET /admin/buylist/:id/reveal-clabe` (`super_admin`, money-out, **auditado**). Estos campos viven **cifrados en reposo** (ver ARCHITECTURE §3.4); el contrato nunca expone RFC/CLABE/INE en claro fuera del reveal.

### Enums (fuente de verdad)

> **⚠️ v2.1.9 (D4) — CÓMO SE LEE ESTE BLOQUE: hay dos clases de lista y NO se validan igual (ARCHITECTURE §4.37).**
> - **Clase E — ESPEJA el schema.** El dominio del enum **es** la regla. La declaración de aquí espeja `schema.prisma`
>   (con su referencia `archivo:líneas` al lado) y el backend la **deriva** (`Object.values(<PrismaEnum>)`, una sola
>   declaración en `common/enum-values.ts`). **Paridad a TRES BANDAS**, verificada: `schema.prisma` ↔ `enum-values.ts`
>   ↔ **esta línea**. *Comparar `Object.values(e)` contra `Object.values(e)` es una **tautología** y no verifica nada —
>   la tercera banda (el contrato) es justamente la que falló dos veces (`PriceSource` sin `tcgcsv_singles`,
>   `SealedSubtype` sin `upc`/`collection`), porque **nadie la comparaba**.*
> - **Clase R — EXPRESA una regla de negocio.** El endpoint acepta a propósito un **subconjunto** fijado por
>   `PROJECT.md`. **NO se deriva**: se declara literal, con la cláusula de PROJECT citada al lado, y se verifica con dos
>   tests (lista exacta **y** subconjunto del enum de Prisma). **Derivar una clase R BORRA la regla**: el próximo valor
>   que alguien añada al schema se auto-aceptaría en la API **sin que nadie decidiera nada**.
> - **La pregunta que decide la clase** (se contesta **por endpoint**, no por enum): *si mañana alguien añade un valor a
>   este enum en `schema.prisma`, ¿este endpoint debe aceptarlo **solo**?* **Sí ⇒ E. No/depende ⇒ R.**

```
Role                = customer | vault_operator | super_admin
Locale              = es | en
ProductType         = graded | sealed | raw
RawCondition        = NM                                 // v1.1: ÚNICO valor (se eliminan LP|MP|HP|DMG). Migración.
                    // ⚠️ CLASE R (v2.1.9, D4) — NO SE DERIVA DEL SCHEMA. «Raw = solo NM» es decisión de PROJECT §H
                    // (LOCKED): «el raw se opera ÚNICAMENTE en NM; se ELIMINAN los grados LP/MP/HP/DMG», con
                    // consecuencias de dinero en las dos puntas (buylist NM-only: «si al recibir no está en NM, no se
                    // compra»; el filtro de Compra «refleja únicamente NM»). Hoy el enum de BD tiene un solo valor, así
                    // que derivar da el MISMO resultado — pero por accidente, no por construcción: si mañana el schema
                    // gana `LP`, toda validación derivada lo aceptaría el mismo día y se cotizarían y publicarían
                    // cartas no-NM. Backend: literal `['NM']` con esta cita al lado + test de lista exacta y de
                    // subconjunto del enum. Ejemplar hermano ya bien resuelto: `UserStatus` en
                    // `PATCH /admin/users/:id/status` (acepta active|blocked, NO deleted — lo fija el DELETE).
Finish              = normal | reverse_holo | holofoil | first_edition_holofoil // v1.6-finish: acabado/versión de carta (mapeo de tcgplayer.prices, ARCHITECTURE §3.7). graded/sealed = normal.
SealedSubtype       = box | etb | bundle | tin | blister | upc | collection
                    // v1.1: subtipo opcional del sellado. ⛔ v2.1.8 — `upc` (Ultra Premium Collection) y
                    // `collection` FALTABAN: el changelog v1.39/P-38 anunció «enum SealedSubtype gana `upc` y
                    // `collection`» (y §M1 lo repite), pero la línea CANÓNICA nunca se actualizó. Espeja ahora
                    // `schema.prisma:69-77`. **SEGUNDA instancia del mismo patrón que `PriceSource`** — por eso el
                    // espejo enum↔schema pasa a ser verificación de contrato (ver §M2 «convención de DTOs»).
AuthProvider        = local | google                     // v1.1: proveedor de autenticación del User
AuthTokenType       = email_verification | password_reset // v1.5: token de un solo uso (hash en BD); verificación 24h, reset 1h
GradingCompany      = PSA | CGC
OwnerType           = platform | customer
OwnershipStatus     = pending | settled
InventoryStatus     = in_stock | listed | reserved | in_custody | picking | shipped | delivered | lost | damaged | withdrawn
VaultZone           = platform_stock | customer_custody
OrderStatus         = pending | settled | failed | refunded | chargeback
ShipmentStatus      = solicitado | picking | guia | enviado | entregado | cancelado
ShipmentActiveStage = solicitado | picking | guia | enviado  // v1.17: subconjunto "activo" de ShipmentStatus expuesto en HoldingDTO.shipmentState. `entregado` NUNCA aparece (el item ya es InventoryStatus.withdrawn y sale de holdings); `cancelado` libera el item ⇒ shipmentState=null.
SellRequestStatus   = cotizada | recibida | verificacion | aprobada | pagada | rechazada | abandonada
SellItemStatus      = cotizada | precio_pendiente | recibida | verificacion | aprobada | ajustada | rechazada | pagada | convertida_inventario
PriceBasis          = market | floor | override | bounty | pending   // v2.0 (P-48, PROJECT §N.7 LOCKED): QUÉ determinó el precio.
                    // Lo calcula SIEMPRE el backend (SEC-A1); la UI NO lo infiere comparando cifras: lo OBEDECE.
                    // market  = el mercado produjo el precio (curva). EMPATE (piso == mercado×markup) cuenta como market.
                    // floor   = la CONSTANTE INFERIOR de ese eje ganó el `max`: el PISO en venta, el BIN en compra.
                    //           (Un solo valor para los dos ejes a propósito: es el mismo hecho — «el mercado no explica
                    //            este precio» — y así guardarraíl, instrumentación y visibilidad comparten UN enum.)
                    // override = override manual (por pieza o por variante). bounty = bounty VÁLIDO (solo eje compra).
                    // pending  = no resoluble ⇒ no se publica ni se cotiza (JAMÁS MX$0 ni precio inventado).
                    // SELLADO: derivado de SealedSpreadSource — override⇒override; subtype_spread|global_spread⇒market.
MarketBracket       = lt_3 | r3_10 | r10_25 | r25_80 | r80_300 | gte_300  // v2.0 (§N.8): bracket de mercado para la
                    // instrumentación. ESCALA FIJA e INDEPENDIENTE de la curva (si se derivara de los puntos vigentes,
                    // la serie histórica dejaría de ser comparable cada vez que el dueño mueva la curva). Fronteras
                    // SEMIABIERTAS [lo,hi) en centavos MXN: 300 / 1000 / 2500 / 8000 / 30000. Es un ÍNDICE de
                    // conveniencia: el dato real es `marketMxnCents` (crudo), que se persiste SIEMPRE junto al bracket.
                    // `null` cuando la operación no tuvo mercado (override/bounty sin referencia).
PendingPriceReason  = no_market | premium_at_floor      // v2.0: por qué una variante entró a la cola de precio pendiente.
                    // no_market = sin referencia de mercado. premium_at_floor = guardarraíl §4.36.5 (rareza premium que
                    // aterrizó en el piso/bin: su dato de mercado está mal). Distinguirlos es lo que hace TRIABLE la cola.
BuylistRuleMode     = fixed | pct                       // ⛔ RETIRADO v2.0 (P-48): desaparece la distinción fixed/pct como modos excluyentes. Solo retención de filas históricas (SellRequestItem.ruleMode legacy).
SalesRuleMode       = fixed | pct                       // ⛔ RETIRADO v2.0 (P-48): ídem. El `fixed` de venta era la causa raíz (documentado como PISO, implementado como precio absoluto).
BuylistCategory     = comun | reverse_holo | ex_plus    // DEPRECADO v1.3.1: reemplazado por la tabla de regla por rareza (BuylistRuleMode). Retención legacy; nada nuevo lo usa.
DisputeStatus       = abierta | en_revision | resuelta_recompra | rechazada
PriceSource         = pokemontcg_io | pokemonpricetracker | poketrace | manual | tcgcsv | tcgcsv_singles
                    // ⚠️ DECLARACIÓN CANÓNICA ÚNICA (v2.1.8). Espeja `enum PriceSource` de `schema.prisma:198-210`.
                    // `tcgcsv`        = referencia de mercado del SELLADO vía TCGCSV (v1.19, M-23, §4.19).
                    // `tcgcsv_singles`= PRIMARIO de precio de SINGLES por variante (por CardProduct+acabado, leído
                    //   del `marketPrice` por `subTypeName`); PPT/pokemontcg.io quedan de FALLBACK (v1.29, M-31,
                    //   §4.27f). **Es la fuente de la MAYORÍA de las filas** de `GET /admin/pricing/card/:cardId`.
                    // ⛔ `tcgcsv_singles` FALTABA desde v1.44: el changelog anunció «PriceSource gana tcgcsv_singles»
                    //   y la línea canónica nunca se actualizó — y estaba DUPLICADA (dos declaraciones del mismo
                    //   enum en este bloque), que es justo el mecanismo por el que una se actualiza y la otra no.
                    //   Se colapsan en ESTA. Efecto que cerraba: el front recibía un `source` FUERA de su unión en
                    //   la mayoría de las filas del historial (mismo modo de fallo que `string` contra enum, un
                    //   nivel más arriba: aquí el enum existe y le faltaba un miembro).
SealedPriceSource   = tcgcsv | off                       // v1.19: valores del dial sealedPriceSource (§M10). NO es enum de BD; seed "off" (fail-closed)
KycStatus           = none | pending | verified | rejected
UserStatus          = active | blocked | deleted        // v1.3.1: `deleted` = cuenta soft-deleted/anonimizada (no puede iniciar sesión). `PATCH .../status` sigue aceptando solo active|blocked; `deleted` lo fija DELETE /admin/users/:id.
AcquisitionType     = aportacion_en_especie | buylist | compra
CfdiStatus          = registrado | no_aplica          // MVP sin PAC; "emitido" reservado para fase 2
// (v2.1.8) — aquí había una SEGUNDA declaración de `PriceSource`, duplicada y desactualizada. RETIRADA: la
// declaración canónica es la de arriba. Un enum declarado dos veces es un enum que se va a bifurcar.
FxSource            = banxico | manual                // fuente del tipo de cambio (separado de PriceSource)
MasterSetScope      = platform | user_vault           // v1.20: alcance de la vista master set (inventario de plataforma vs bóveda de UN usuario)
AdjustmentReason    = encontrada | perdida | danada | error_captura // v1.20: motivo OBLIGATORIO del ajuste de inventario por levantamiento físico (M1)
FulfillmentMode     = vault | direct_ship            // v1.21: destino del pedido. vault = entra a la bóveda del comprador (requiere cuenta, comportamiento actual, DEFAULT). direct_ship = envío directo a domicilio, envío cobrado en el MISMO PaymentIntent (ÚNICO modo del invitado). Enum de BD (Order.fulfillmentMode).
GuestOrderPublicStatus = pendiente_pago | pagado | preparando | guia | enviado | entregado | cancelado | reembolsado | en_revision
                    // v1.21: estado PÚBLICO derivado (NO es columna) que ve el invitado en la vista de seguimiento.
                    // Se deriva de Order.status + ShipmentRequest.status; tabla de mapeo normativa en §4-G.5.
SealedCondition     = mint | minor_box_damage      // v1.23: condición SIMPLE del sellado, visible al comprador. Enum de BD
                    // (InventoryItem.sealedCondition, nullable salvo sealed; default mint). Labels legibles ("Como nueva" /
                    // "Detalle menor en caja") en i18n del FRONT, NO en la API. NO altera el precio derivado (ver §4.23b).
SealedSpreadSource  = override | subtype_spread | global_spread  // v1.23: de dónde salió el precio de venta del sellado.
                    // NO es enum de BD (derivado por computeSealedSalePrice, ARCHITECTURE §4.23b).
```

### DTOs base (compartidos)
```ts
Money        = { amountCents: number, currency: "MXN" }
// PriceInfo describe el VALOR DE REFERENCIA (valor de mercado), no el precio de venta.
// ⚠️ v2.1.6 (hallazgo de la fase de seguridad) — `source` es PROCEDENCIA, y la procedencia es ADMIN-ONLY.
//   * `isManualOverride` NUNCA estuvo en este contrato y el backend lo emitía igual (`pricing.service.ts:335/378/430`),
//     **a endpoints anónimos**. SE RETIRA del DTO, y no «se mueve a admin»: es REDUNDANTE — `source === "manual"`
//     carga exactamente el mismo bit. Dejarlo en otra superficie sería mantener dos nombres para un mismo hecho.
//   * ⚠️ POR ESO NO BASTA QUITAR `isManualOverride`: `PriceSource` incluye el valor `manual`, así que `source` filtra
//     LA MISMA señal. Norma: **`source` se OMITE en toda superficie pública/anónima** (`/catalog/*`, `/buylist/*`) y
//     solo viaja en superficies `vault_operator+`. El campo YA es opcional, así que omitirlo NO cambia el tipo ni
//     hace que `PriceInfo` signifique cosas distintas según la ruta (eso sí lo prohibimos para `referenceMxnCents`,
//     que es la CARGA del DTO; `source` es metadato de procedencia y su ausencia es un caso ya declarado).
//   * Riesgo que cierra: un mapa **scrapeable** de qué cartas llevan precio fijado a mano — es decir, dónde falló el
//     feed automático y por tanto dónde es más probable que el precio esté desalineado. Es inteligencia de pricing
//     interna, no información de compra: el comprador no necesita saber de dónde salió el número.
//   * `capturedDate` SÍ puede viajar en público (frescura del dato es información legítima de compra).
PriceInfo    = { status: "priced" | "pending", referenceMxnCents?: number, source?: PriceSource, capturedDate?: string }
// v1.6-finish: availableFinishes = acabados en que existe la carta. SIGUE siendo 1 CardDTO por carta
// (externalId único); availableFinishes es un array en el MISMO objeto. Filas históricas / sin sincronizar →
// ["normal"]. Es la lista blanca contra la que el backend valida `finish` (SEC-A1, 422 FINISH_NOT_AVAILABLE).
// v1.14-price-ingest: la FUENTE de availableFinishes pasa a ser el PROVEEDOR de paga (…) — ⛔ DEROGADO por v1.22.
// v1.22-variantes-orden (NORMATIVO, sustituye a la nota v1.14):
//   * FUENTE ÚNICA = el SYNC DE CATÁLOGO. Se deriva de `tcgplayer.prices` (llaves PRESENTES, con o sin `market`)
//     ∪ `cardmarket.prices.reverseHolo*` (valor numérico > 0). El price-ingest YA NO escribe este campo: la
//     ausencia de PRECIO de un acabado NO reduce las variantes (ARCHITECTURE §4.22a; §4.15e derogada).
//   * v1.22-1 (ARCHITECTURE §4.22g) — SIN CAMBIO DE FORMA: `availableFinishes` pasa a ser una columna DERIVADA =
//     union(catalogFinishes, pricedFinishesSnapshot) recomputada server-side. Se añade una SEGUNDA fuente de señal:
//     el proveedor de PAGA (PPT) como EVIDENCIA POSITIVA — `market>0` de un acabado, vía alias VERIFICADO ⇒ ese
//     acabado EXISTE (resuelve el caso pokemontcg.io caído/502). NO es la conversa prohibida por §4.22a-regla 2:
//     precio AUSENTE sigue SIN reducir variantes; solo precio PRESENTE (verificado) las AÑADE. Único escritor =
//     catalog.FinishReconciler. `catalogFinishes`/`pricedFinishesSnapshot` son INTERNAS, no se emiten en ningún DTO.
//   * v1.26 (ARCHITECTURE §4.24a) — SIN CAMBIO DE FORMA: la ENTRADA estructural de la unión pasa de `catalogFinishes`
//     (proxy de precio) a la nueva `Card.structuralFinishes` (INTERNA, no se emite), derivada de la fuente ESTRUCTURAL
//     autoritativa TCGCSV (`subTypeName`, que existe aunque no haya precio ⇒ estructura ≠ precio).
//     ⛔ v1.27: la fórmula de UNIÓN `orderFinishes(structuralFinishes ∪ pricedFinishesSnapshot) || ['normal']` quedó
//     DEROGADA (era el vector de las variantes fantasma).
//   * ⛔ v1.27 (P-13, §4.25a-1) — «solo structural» DEROGADA 2026-08-22 (regresión: los comunes perdieron el reverse
//     holo que solo trae el proveedor de precios). NO usar `availableFinishes := structuralFinishes ≠ ∅ ? … : ['normal']`.
//   * v1.27.1 (P-13-fix, ARCHITECTURE §4.25e) — SIN CAMBIO DE FORMA. FÓRMULA VIGENTE: la unión vuelve, el fantasma no.
//     availableFinishes := orderFinishes( (structuralFinishes ∪ pricedFinishesSnapshot) − { normal | isPremiumRarity(rarity) } ) || ['normal']
//     (composeAvailableFinishes(structuralFinishes, pricedFinishesSnapshot, rarity); reusa isPremiumRarity de money.ts).
//     La unión recupera el reverse del común; el filtro premium mata el `normal` fantasma de ex/secret rares. VAR-1 intacto.
//   * ORDEN CANÓNICO GARANTIZADO: normal → reverse_holo → holofoil → first_edition_holofoil. El front NO ordena;
//     consume el orden del array. De ahí sale "normal a la IZQUIERDA, reverse holo a la DERECHA".
//   * NUNCA vacío (mínimo ["normal"]) y NUNCA con acabados inventados: es el universo EXACTO de casillas del
//     binder. Invariante de render: |casillas| = |availableFinishes| ≥ 1; PROHIBIDA la casilla de relleno.
//   * La IMAGEN es la MISMA para todas las variantes de la carta (`imageSmallUrl`/`imageLargeUrl` del CardDTO):
//     pokemontcg.io publica UNA imagen por carta, sin arte por acabado. Por eso NO existe `imageByFinish`.
// v1.22 — numberSort / numberPrefix: claves DERIVADAS de `number` (String) para el ORDEN NATURAL, persistidas en
//   BD (M-26) y ya usadas por el `ORDER BY` del servidor. El front las usa SOLO para re-ordenar localmente tras
//   filtrar, con el comparador (numberPrefix asc, numberSort asc, number asc) — que reproduce EXACTAMENTE el orden
//   del servidor. numberPrefix="" ⇒ número puramente numérico (ordena primero); "TG"/"SV"/"GG" ⇒ promo/subset al
//   final. Reemplaza cualquier `numberSort` sintético que el front venga calculando (p. ej. el índice del arreglo).
// v1.22-2 (N-15, ARCHITECTURE §4.22a-6): displayFinishes = acabados que el front PINTA como casillas/tarjetas.
//   * SIEMPRE `⊆ availableFinishes`, mismo orden FINISH_ORDER, nunca vacío (≥ 1).
//   * DEFAULT: displayFinishes === availableFinishes (misma lista). SOLO difiere en una carta PREMIUM de una sola
//     impresión (isPremiumRarity(rarity) === true): se ocultan los acabados SIN precio (market>0) — típicamente el
//     `normal` espurio de una ex/full-art — dejando solo su impresión real (p. ej. ["holofoil"]).
//   * NO es whitelist ni vector de dinero: `availableFinishes` sigue siendo la lista blanca SEC-A1 (valida `finish`
//     y deriva el monto). displayFinishes SOLO gobierna el render. Solo RESTA acabados, jamás los INVENTA
//     (no crea reverse_holo por rareza; VAR-1 intacto). Server-side, derivado; el front NO lo recalcula.
CardDTO      = { id, externalId, name, number, numberSort: number, numberPrefix: string,
                 rarity, supertype, subtypes: string[],
                 setId, setName, imageSmallUrl, imageLargeUrl,
                 availableFinishes: Finish[], displayFinishes: Finish[] }
// referenceValue = valor de mercado (referencia). salePriceCents = precio de venta = referencia × (1+markup) u override.
// rawCondition solo aplica a productType=raw y su ÚNICO valor es "NM". El LABEL legible de NM
// ("Casi nueva (Near Mint)" / "Near Mint" + descripción) vive en i18n del FRONT, NO en la API.
// sealedSubtype solo aplica a productType=sealed (opcional). El sellado NO lleva rawCondition/grade/rareza.
// IMAGEN (v1.2): el producto NO lleva fotos propias. La imagen mostrada en ficha/Compra/bóveda/back-office
// es SIEMPRE la imagen de catálogo remota de pokemontcg.io (CardDTO.imageSmallUrl / imageLargeUrl).
// No existen frontPhotoUrl/backPhotoUrl en ListingDTO ni en ningún DTO de producto.
// GRADEADAS (v1.2): graded expone gradingCompany + gradeValue + certNumber (nº de certificado PSA/CGC,
// verificable en la web de la graduadora). certNumber es null para raw/sealed.
// v1.6-finish: `finish` = acabado de ESTA copia física. referenceValue/salePriceCents se calculan contra la
// PriceReference de ESE acabado (no un precio único por carta). Dos copias de la misma carta con acabado
// distinto son ListingDTO SEPARADOS. graded/sealed → finish = "normal".
// ===== v2.0 (P-48) — `priceBasis` ADITIVO y NORMATIVO =====
//   * `priceBasis` = QUÉ determinó `salePriceCents` (server-side, §ARCH 4.36.7a). Valores alcanzables en el eje de
//     VENTA: "market" | "floor" | "override" | "pending". ("bounty" NUNCA aparece en venta: vive en el eje de compra.)
//   * ===== v1.50.3-f (M-43) — QUÉ FILA PUEDE SER «market» (NORMATIVO, DINERO) =====
//     `priceBasis:"market"` solo puede provenir de una `PriceReference` con `refKind:"market"`. Una fila
//     `refKind:"graded_estimate"` —el «valor estimado si se gradea», §4.38— **NUNCA** resuelve `salePriceCents`, ni
//     oferta de buylist, ni valuación de bóveda/set: no pierde la precedencia, **no entra como candidata**. Si la
//     única fila de la clave es un estimado, el resultado es `priceBasis:"pending"` (`salePriceCents` ausente,
//     `sellable:false`) — fail-closed, y es deliberado: una pieza sin precio no le cuesta dinero a nadie; una pieza
//     al 5% de su valor sí (medición del pentester: MX$9,200 → MX$460). **La curva no cambia** (§N/§4.36): la
//     exclusión ocurre AGUAS ARRIBA, al resolver la referencia, nunca dentro del seam de precio.
//     ARCHITECTURE §4.38(l.4).
//   * ⚠️ REGLA DE VISIBILIDAD (contrato, no sugerencia): en la FICHA de carta y en la FICHA de sellado el bloque
//     «Valor de mercado» se muestra **si y solo si `priceBasis === "market"`**. Con floor/override/pending el bloque
//     DESAPARECE — ni en cero, ni tachado, ni atenuado, ni «—». En TEJAS y LISTADOS no se muestra mercado (no se
//     muestra hoy y no va a mostrarse). NO cambia la bóveda/portafolio del cliente ni el cotizador de buylist.
//   * ⛔ DEROGADO v2.1.9 — decía: «`referenceValue` SIGUE viajando aunque no se muestre … stripearlo por endpoint haría
//     que PriceInfo significara cosas distintas según la ruta». La premisa era FALSA desde v2.1.6: `toPublicPriceInfo`
//     YA recorta `PriceInfo` por superficie (quita `source`), y lo prohibido es que cambie de significado
//     `referenceMxnCents` —la CARGA—, no que esté o no esté. Efecto del hueco: `GET /catalog/listings/<id>` devolvía
//     SIN TOKEN `priceBasis:"override"` + `referenceValue`, o sea el bloque que la UI tiene PROHIBIDO pintar.
//   * ===== v2.1.9 (D2) — LA REGLA DE VISIBILIDAD SE IMPONE EN EL EMISOR (NORMATIVO) =====
//     Lo que la UI no puede pintar en una superficie NO VIAJA en esa superficie. En superficie PÚBLICA:
//         referenceValue.referenceMxnCents PRESENTE  ⇔  priceBasis === "market"
//     (`capturedDate` acompaña al número: sin número, la frescura no informa. `status` viaja SIEMPRE — es la carga
//     estructural del PriceInfo, no procedencia.) Con basis floor/override/pending el `PriceInfo` público sale como
//     `{ status }` a secas. Es un `iff` ⇒ se verifica sobre el JSON SERIALIZADO en LAS DOS DIRECCIONES.
//     ⚠️ Esto NO releva al front de obedecer `priceBasis`: la garantía del servidor es defensa en profundidad, no un
//     permiso para inferir comparando cifras. Y `priceBasis` NO se vuelve opcional en NINGÚN DTO — su ausencia es lo
//     que INVIRTIÓ la regla en B-1. Superficies `vault_operator+`, `/vault/*` y `/admin/*`: SIN CAMBIO (§N.7 las
//     excluye explícitamente; ahí el cliente ve el mercado de lo que YA POSEE y admin necesita la procedencia).
ListingDTO   = { inventoryItemId, card: CardDTO, productType, rawCondition?, sealedSubtype?, finish: Finish,
                 gradingCompany?, gradeValue?, certNumber?,
                 referenceValue: PriceInfo, salePriceCents?: number, priceBasis: PriceBasis, sellable: boolean }
// ===== v1.38-grouped-listings (P-30): publicación ÚNICA por carta/variante/condición con STOCK =====
// GroupedListingDTO = UNA publicación agrupada de SINGLES (raw/graded) para la sección "Compra". Reemplaza el
// «un ListingDTO por copia física» de `GET /catalog/cards*`. Es el análogo de `SealedGroupDTO` (sellado) para singles.
//   * CLAVE DE AGRUPACIÓN K = (cardId, productType, gradeKey, finish). gradeKey = `gradeKeyFor(item)` — canónico:
//     "raw:NM" | "graded:PSA:10" | … (encapsula condición/grado). Es EXACTAMENTE la clave con la que hoy se resuelve
//     `salePriceCents` por pieza (fetchSellable/toListingDTO) y la de `PriceReference`/`VariantPriceOverride` (menos
//     `capturedDate`/`cardProductId`): por eso **todas las piezas de un grupo comparten un ÚNICO precio de venta**.
//   * `stockCount` = nº de piezas VENDIBLES del grupo (`ownerType=platform`, `status=listed`, `sellable=true`,
//     `salePriceCents!=null`). Money-safe: una pieza sin precio NO cuenta ni publica (nunca $0). En `/catalog/cards*`
//     todo grupo devuelto tiene `stockCount≥1` (VIVO). Estado AGOTADO (stock 0) ⇒ el grupo **desaparece** de Compra
//     (no se emite fila): el `stockCount≥1` en la respuesta ES el invariante «vivo». (No hay campo `status`: el stock
//     es la única fuente de verdad; el front usa `stockCount` para el badge «N disponibles» y para topar el carrito.)
//   * `representativeInventoryItemId` = pieza vendible MÁS BARATA del grupo (para add-to-cart de 1 y como key de la ficha).
//   * `salePriceCents` = **precio del grupo = MÍNIMO/«DESDE» de sus piezas** (= el del representante). SEMÁNTICA
//     «desde», NO el precio exacto por-pieza. ⚠ NOMBRE COMPARTIDO, SEMÁNTICA DISTINTA: en `ListingDTO.salePriceCents`
//     es el precio EXACTO de UNA copia física; aquí es el mínimo del grupo (el análogo de `SealedGroupDTO.fromPriceCents`
//     en sellado). En el caso normal TODAS las piezas comparten precio (misma K ⇒ misma regla/override de variante) y el
//     mínimo = ese precio único, así que «desde X» == «X». Divergencia SOLO si una pieza trae `listPriceCents` manual
//     distinto (override POR PIEZA, §4.26b): entonces el grupo muestra el más barato primero (idéntico a
//     `SealedGroupDTO.fromPriceCents`); las piezas siguen en `units[]` de la ficha, cada una con su `salePriceCents` exacto.
//   * **FE-2 (display, frontend):** cuando `stockCount > 1`, el front debe rotular «desde $X» (no «$X» a secas), porque
//     puede haber piezas más caras en `units[]`; con `stockCount == 1` muestra el precio a secas. Es tarea de display; el
//     shape NO cambia. El rename `salePriceCents → fromPriceCents` (para igualar el nombre a la semántica «desde», como el
//     sellado) queda como **deuda futura OPCIONAL** (breaking: contrato+backend+frontend) — no se hace pre-release por riesgo.
//   * `referenceValue` = valor de mercado de la variante (PriceInfo de la misma K); compartido por el grupo. Informativo.
//   * rawCondition presente SOLO para raw ('NM'); gradingCompany/gradeValue presentes SOLO para graded (identidad de
//     GRADO, compartida por el grupo). El `certNumber` es POR SLAB (distinto por pieza) ⇒ NO va a nivel de grupo: se
//     expone por pieza en `units[]` de la ficha (el comprador verifica el cert del slab concreto que agrega al carrito).
//   * productType ∈ {raw, graded} — NUNCA sealed (H9: el sellado tiene su propio catálogo agrupado, §2-S).
//   * **v2.0 (P-48):** `priceBasis` = el del **representante** (la pieza más barata del grupo). Todas las piezas de un
//     grupo comparten clave K ⇒ comparten curva/override de variante ⇒ comparten basis, SALVO que alguna traiga
//     `listPriceCents` manual (override POR PIEZA): en ese caso el representante es esa y el basis del grupo es
//     "override". El basis EXACTO por pieza vive en `units[]` de la ficha (`ListingDTO.priceBasis`).
//   * **v2.1.9 (D2):** este DTO es el de la **FICHA** (`GroupedListingDetailResponse.listings[]`). `referenceValue`
//     sigue **requerido**, pero su `referenceMxnCents`/`capturedDate` viajan **si y solo si `priceBasis === "market"`**
//     (el `iff` de `ListingDTO` arriba). La **REJILLA** ya NO usa este DTO: usa `GroupedListingSummaryDTO`.
GroupedListingDTO = { representativeInventoryItemId: string, card: CardDTO, productType: "raw" | "graded",
                      finish: Finish, rawCondition?: RawCondition, gradeKey: string,
                      gradingCompany?: GradingCompany, gradeValue?: string,
                      stockCount: number, salePriceCents: number, priceBasis: PriceBasis,
                      referenceValue: PriceInfo, currency: "MXN" }
// ===== v2.1.9 (D2) — el DTO de la REJILLA de singles: `GroupedListingDTO` MENOS las dos señales de precio =====
// Es `GroupedListingDTO` sin `priceBasis` y sin `referenceValue`. Se declara como TIPO PROPIO (no como «los mismos
// campos, opcionales») a propósito, y ésa es la parte que importa:
//   * §N.7 dice literal «SOLO fichas»: tejas y listados NO muestran valor de mercado hoy y NO van a mostrarlo, así que
//     en esta superficie NADIE consume ninguno de los dos campos. Por la convención de DTOs cerrados («lo que no debe
//     salir, PROHIBIDO»: publicar de más no rompe a nadie — FILTRA), un campo no consumido aquí no se emite.
//   * Qué cierra: la rejilla es la superficie de COSECHA MASIVA (N filas por request, paginada). Emitir `priceBasis`
//     ahí publica un MAPA COMPLETO de qué cartas llevan override manual — o sea dónde falló el feed y dónde el precio
//     puede estar desalineado. Es exactamente la clase que v2.1.6 cerró retirando `isManualOverride`/`source` de lo
//     público. En la FICHA `priceBasis` sí es público, y a propósito: la UI lo OBEDECE (decisión LOCKED de §N.7);
//     lo que cambia entre las dos superficies no es el secreto, es la ECONOMÍA de enumerarlo.
//   * Por qué TIPO PROPIO y no `priceBasis?`: un campo opcional cuya ausencia apaga una regla es LITERALMENTE B-1
//     (`undefined === "market"` ⇒ false SIEMPRE ⇒ «Valor de mercado» no se mostró NUNCA). Con dos tipos, omitirlo en la
//     ficha NO COMPILA y emitirlo en la rejilla tampoco. El compilador sostiene la diferencia; el test es la red.
//   * Todo lo demás (agrupación K, `stockCount`, `salePriceCents` con semántica «desde», representante) es IDÉNTICO.
GroupedListingSummaryDTO = { representativeInventoryItemId: string, card: CardDTO, productType: "raw" | "graded",
                             finish: Finish, rawCondition?: RawCondition, gradeKey: string,
                             gradingCompany?: GradingCompany, gradeValue?: string,
                             stockCount: number, salePriceCents: number, currency: "MXN" }
GroupedListingListResponse = { data: GroupedListingSummaryDTO[], page: number, pageSize: number, total: number }
// ===== v1.50-graded-estimate (PROJECT §O v2.0 + REDUCCIÓN DE ALCANCE del humano 2026-08-23) =====
// «Gancho de grading» — ARCHITECTURE §4.38. La superficie visible es la CIFRA por grado junto al precio («en PSA 10
// vale tanto»). SIN multiplicador, SIN ganancia calculada, SIN comparativa de columnas: el humano los retiró
// explícitamente. Por eso el contrato PÚBLICO **no transporta** `multiplier`, `upsideMxnCents`, `netUpside*`,
// `gradingCost*` ni `minUpsidePct` — nadie los pinta, y un campo que nadie pinta es deuda.
//
// EL GATE DE ROI SOBREVIVE COMPLETO (con la tabla de escalones de §O.2.1) pero cambia de PAPEL: deja de ser
// información al cliente y pasa a ser **criterio de CURADURÍA** — decide DÓNDE promocionamos activamente («calcúlalo
// para que podamos ponerlo en la sección de destacado algo que valga la pena»). Eso parte el gancho en DOS campos con
// reglas de emisión DISTINTAS, y esa distinción es lo único importante de esta sección:
//
//   | Campo               | Dónde vive (DTO)               | Superficie          | ¿Gate de ROI? | ¿Gate de confianza? |
//   |---------------------|--------------------------------|---------------------|---------------|---------------------|
//   | `gradedEstimates`   | GroupedListingDetailResponse   | FICHA               | **NO**        | frescura + origen (SIN magnitud) |
//   | `gradingHighlight`  | **GroupedListingSummaryDTO**   | REJILLA + VITRINA   | **SÍ**        | frescura + origen + **magnitud** |
//
// ⚠️ v2.1.9/D2 × v1.50.2 — POR QUÉ `gradingHighlight` VIVE EN EL SUMMARY Y ESO NO CONTRADICE A D2:
//   D2 retiró `priceBasis`/`referenceValue` de la rejilla porque enumeran un MAPA DE DEFECTOS OPERATIVOS (dónde falló
//   el feed). El argumento textual de D2 es de ECONOMÍA DE ENUMERACIÓN, no de secreto — y ese argumento SOLO SE
//   SOSTIENE MIENTRAS NO EXISTA UN ENUMERADOR PÚBLICO del campo. Para `priceBasis` no existe. Para `gradingHighlight`
//   SÍ, y lo construimos a propósito: `?gradingHighlight=true&sort=grading_showcase` (§2) es un enumerador paginado y
//   ordenado de EXACTAMENTE ese conjunto. Publicar la cifra por fila NO crea capacidad nueva para nadie.
//   Además: `GradedEstimateDTO` NO TIENE `priceBasis`, ni `source`, ni `isManualOverride` — ausencia ESTRUCTURAL, no
//   filtrado al serializar. Y la presencia del campo es ORTOGONAL al `priceBasis` del raw (el gate compara contra
//   `salePriceCents`, ya público aquí), así que ver el badge no dice de dónde salió el precio raw.
//   Regla generalizada de admisión al Summary (tres condiciones) en ARCHITECTURE §4.38(e).
//   SE MUEVE, no se duplica: así el compilador sostiene la partición informar≠promover, igual que sostiene D2.
//
// Racional: la ficha es INFORMACIÓN para quien ya está viendo esa carta; la rejilla y la vitrina son PROMOCIÓN ACTIVA
// y solo deben empujar lo que le conviene al comprador incluso saliendo PSA 9. **SEC-A1 sale REFORZADO**: el cliente
// ya ni siquiera recibe los INSUMOS del cálculo (ganancia neta, escalón aplicado, razón), solo su resultado binario =
// presencia del campo. Un DTO manipulado no puede reconstruir el gate porque los números no viajan.
//
// El estimado de UN grado. `estimate` reusa PriceInfo (NO se inventa otro tipo de dinero) con tres reglas NORMATIVAS:
//   * `status` es SIEMPRE "priced" — un `pending` en un argumento de venta está PROHIBIDO (PROJECT §O.4). Si no hay
//     dato, el elemento NO se emite; JAMÁS se emite un GradedEstimateDTO en estado pendiente.
//   * `referenceMxnCents` y `capturedDate` SIEMPRE presentes (`capturedDate` = fecha del último refresco del dato).
//   * `source` se OMITE SIEMPRE (y `isManualOverride` nunca viaja). Es la garantía técnica de que la FASE 1 (valor
//     fijado a mano por el admin) y la FASE 2 (ingest automático) son INDISTINGUIBLES para el cliente — `source` es el
//     único campo que delataría el origen. El admin sí lo ve en `GET /admin/pricing/card/:cardId` (§M2).
// `gradeKey` es la clave canónica con la que el valor se fija/lee ("graded:PSA:10" | "graded:PSA:9"): key estable de
// render/orden para el front, NO un dato que el cliente deba resolver.
// MVP: `gradingCompany` siempre "PSA". `gradeValue` es un STRING abierto en el TIPO —a propósito, para que añadir un
// grado no sea un cambio de contrato— pero el servidor solo emite lo que digan los diales `grades`/`highlightGrades`:
// hoy **"10" y "9"** en la ficha, **"10"** en el badge. Otras graduadoras (CGC/BGS/TAG) y otros grados (PSA <= 8)
// quedan FUERA DE ALCANCE (§O.1).
GradedEstimateDTO = { gradingCompany: "PSA", gradeValue: string /* "10" | "9" */, gradeKey: string, estimate: PriceInfo }
// REGLAS COMUNES a los dos campos de abajo (ambos son ARREGLOS de GradedEstimateDTO — mismo tipo de elemento, mismo
// helper de render en el front; lo único que difiere es la REGLA DE EMISIÓN):
//   * PRESENCIA ⇔ ELEGIBILIDAD. **No existe `eligible: boolean`** (invitaría a pintar un badge tachado/gris —
//     criterio 100). Ausente u omitido ⇒ el front NO pinta NADA: ni contenedor, ni skeleton, ni "—", ni $0, ni
//     "pendiente". PROHIBIDO cualquier `…?.[0]?.estimate.referenceMxnCents ?? 0`.
//   * NUNCA se emiten VACÍOS (`[]`). Sin ningún grado que exponer, el campo se OMITE — un `[]` es un contenedor vacío
//     que el front podría renderizar.
//   * SOLO para `productType:"raw"`. Una gradeada y un sellado NUNCA los traen (criterio 105).
//   * ORDEN: grado descendente (PSA 10 primero). **El cliente DEBE iterar leyendo `gradeValue`; tiene PROHIBIDO
//     asumir `[0] === PSA 10` o una longitud fija.** Es exactamente lo que permite añadir/quitar un grado sin tocar
//     el contrato ni el cliente.
//   * Nunca traen el precio raw (ya está en `salePriceCents` del mismo DTO / de `listings`), ni multiplicador, ni
//     ganancia, ni costo de gradeo, ni umbral. El servidor usa esos números SOLO para decidir presencia y orden.
//
// EXTENSIÓN v1.50 (ADITIVA y OPCIONAL; `+=` = campo que se AÑADE al DTO existente, que no cambia de forma).
// `gradingHighlight` = MARCADOR DE CURADURÍA: «esta carta la estamos promoviendo activamente». Vive en la teja de la
// REJILLA (`GroupedListingSummaryDTO`), que es la unidad de render de Compra y de la vitrina del home ⇒ un solo
// componente, cero drift. ⚠️ **v1.50.2 lo MOVIÓ desde `GroupedListingDTO`** (que tras D2 es el DTO de la FICHA).
//   * SE EMITE **SOLO SI EL GATE DE ROI SOBRE PSA 9 SE CUMPLE** (§O.2, ARCHITECTURE §4.38c) **Y ADEMÁS pasa el GATE
//     DE CONFIANZA** (v1.50.2: fresca + origen confiable + **coherencia de magnitud**; ARCHITECTURE §4.38k). El
//     resultado del cálculo NO viaja: solo su consecuencia (el campo está o no está).
//   * Vive a nivel de GRUPO y no de carta: el gate compara contra `salePriceCents`, que es del GRUPO. Una carta con
//     `normal` y `reverse_holo` publicados puede quedar destacada en un acabado y no en el otro (§4.38a).
//   * Contenido = los grados que el badge PINTA (`highlightGrades`, dial; hoy **["10"]**: el badge muestra UNA cifra,
//     «en PSA 10 vale tanto»; el copy exacto lo define ux-ui, DESIGN_SYSTEM §22). Es un SUBCONJUNTO de los grados con
//     dato: el gate SIEMPRE se evalúa con PSA 9 aunque PSA 9 no se pinte. Añadir PSA 9 al badge = editar el dial,
//     CERO cambio de contrato ni de cliente (por eso es un arreglo y no un escalar).
GroupedListingSummaryDTO += { gradingHighlight?: GradedEstimateDTO[] }
// ⚠️ `GroupedListingDTO` (FICHA) **NO** lleva `gradingHighlight`. El bullet de v1.50 que decía que los `listings[i]`
// de la ficha podían traerlo queda **DEROGADO** en v1.50.2: la ficha ya expone `gradedEstimates` en su raíz, que es
// más rico (PSA 10 y 9) y no va gateado. FRONTEND: eliminar cualquier lectura de `gradingHighlight` en `listings[i]`.
//
// `gradedEstimates` = INFORMACIÓN de la FICHA para quien ya está viendo esa carta. Vive en la RAÍZ de la respuesta de
// la ficha (nivel CARTA: el estimado por grado es por carta y NO se cruza con el acabado — §4.38a).
//   * SE EMITE SIEMPRE QUE HAYA DATO fresco, **SIN condicionar al gate de ROI** (decisión del humano). Una carta
//     puede mostrar sus estimados en la ficha y NO estar destacada en Compra ni en el home: es exactamente lo
//     buscado (informar ≠ promover).
//   * **v1.50.2 — la ficha NO aplica la coherencia de MAGNITUD** (sí frescura y origen). Si el dueño fijó a mano un
//     estimado raro, la ficha se lo MUESTRA (con su disclaimer) y la rejilla NO lo promueve: ocultarlo también aquí
//     convertiría un dato visible-y-corregible en una desaparición silenciosa. ARCHITECTURE §4.38(k.3).
//   * Contenido = **PSA 10 y PSA 9** (ambos confirmados por el humano), mostrados tal cual, sin comparativa.
//     Un grado sin dato o con dato rancio simplemente NO aparece en el arreglo (los grados son independientes entre sí:
//     tener PSA 10 y no PSA 9 emite un arreglo de un elemento — a diferencia del gate, que exige los dos).
GroupedListingDetailResponse += { gradedEstimates?: GradedEstimateDTO[] }
// ---- Config del gancho (GET/PUT /admin/pricing/graded-estimates, §M2). NADA de esto viaja al cliente. ----
// Un escalón de `gradingCostTiers`: rango de VALOR DECLARADO de la carta → COSTO de gradeo en MXN (cuota PSA + envío
// internacional + retorno asegurado a México + manejo; §O.2.1). Intervalo SEMIABIERTO [min, max):
//   * `maxValueMxnCents === null` SOLO en el ÚLTIMO escalón ("de X en adelante"); ningún otro puede ser null.
//   * `tiers[i].maxValueMxnCents === tiers[i+1].minValueMxnCents` (contiguo, sin huecos ni solapes); `tiers[0].min === 0`.
//   * `costMxnCents` entero >= 1 — JAMÁS 0 (un costo subestimado es exactamente lo que haría perder dinero al
//     comprador). Semiabierto a propósito: con límites "$2,000 / $2,001" los centavos intermedios quedaban en un HUECO.
GradingCostTierDTO = { minValueMxnCents: number, maxValueMxnCents: number | null, costMxnCents: number }
// `enabled` / `ingestEnabled` = ESPEJOS READ-ONLY de los dos diales M10 (se editan en PUT /admin/settings, no aquí; si
// vienen en el PUT se IGNORAN). `grades` = grados que la FICHA expone; `highlightGrades` ⊆ `grades` = grados que el
// BADGE pinta. `minUpsidePct` + `gradingCostTiers` = el gate de CURADURÍA (rejilla/vitrina), nunca la ficha.
// v1.50.2 añade 5 campos editables: `manualFreshnessDays` (decaimiento del override manual), `maxRawMultiple`
// (cota superior de magnitud), `minSampleCount` (muestra mínima, se aplica en el INGEST), `sourceStat` (qué número
// del proveedor es el precio) y `ingestMaxCardsPerRun` (tope de cuota por corrida).
// ⚠️ v1.50.3 — TRES SEEDS CORREGIDOS (solo el valor; el shape NO cambia), para alinear con PROJECT.md:
//   manualFreshnessDays null -> 30 (criterio 109: el override manual SÍ caduca, contra su fecha de captura)
//   minSampleCount        3  -> 5   (criterio 111a = `minSalesSample` de §O.7)
//   maxRawMultiple       50  -> 100 (criterio 111c = `maxGradedMultiple` de §O.7)
// Los NOMBRES no se renombran; la equivalencia con el vocabulario de PROJECT §O.7 está tabulada en §M2.
GradedEstimateConfigDTO = { enabled: boolean, ingestEnabled: boolean, grades: string[] /* ["10","9"] */,
                            highlightGrades: string[] /* ["10"] */, freshnessDays: number,
                            minUpsidePct: number, gradingCostTiers: GradingCostTierDTO[],
                            manualFreshnessDays: number | null, maxRawMultiple: number,
                            minSampleCount: number, sourceStat: "median" | "average" | "smart",
                            ingestMaxCardsPerRun: number }
// Diagnóstico de CURADURÍA (GET /admin/pricing/graded-estimates/preview, §M2, super_admin). Es el ÚNICO lugar donde
// los insumos del gate se exponen — al ADMIN, jamás al cliente. Responde «¿por qué esta carta no está destacada?».
// `eligible=false` viene con `reason` accionable; los montos son null cuando no se pudieron resolver (nunca 0).
// v1.50.2 añade `maxAllowedPsa10MxnCents` (la cota superior efectiva = salePriceCents × maxRawMultiple) y
// `publishedSlabGrades` (los grados de esa carta con slab PUBLICADO — INV-D, §4.38l).
// v1.50.3-c añade `isManual` (admin-only): distingue la fila rancia MANUAL (la afirmación del dueño expiró ⇒
// recapturar o borrar) de la AUTOMÁTICA (el feed dejó de cubrir la carta ⇒ mirar el ingest). Remedios opuestos, y
// `reason: STALE` a secas no los distingue. No viola §4.38(g): esa garantía es sobre superficies PÚBLICAS.
// v1.50.3-f (M-43) añade `refKind` (admin-only): NATURALEZA de la fila que este diagnóstico está reportando.
// `"graded_estimate"` ⇒ es una cifra del gancho: se puede recapturar o borrar. `"market"` ⇒ es DINERO (la referencia
// de mercado de M1 «Gradeadas»): el gancho la MUESTRA cuando la carta no tiene slab de ese grado (§4.38l.4.4B), pero
// **no se toca desde aquí** — el `DELETE` del gancho no la borra. Sin este campo, la lista de revisión invita a
// borrar filas de mercado. ARCHITECTURE §4.38(l.4.4)B / (l.4.5).
GradedEstimatePreviewDTO = { representativeInventoryItemId: string, finish: Finish, salePriceCents: number,
                             psa10MxnCents: number | null, psa9MxnCents: number | null,
                             capturedDate: string | null, stale: boolean, isManual: boolean,
                             refKind: "market" | "graded_estimate",
                             gradingCostTier: GradingCostTierDTO | null, gradingCostMxnCents: number | null,
                             thresholdMxnCents: number | null, netUpsidePsa9MxnCents: number | null,
                             maxAllowedPsa10MxnCents: number | null, publishedSlabGrades: string[],
                             eligible: boolean,
                             reason?: HighlightReason,      // PRIMER bloqueante (decisión de promoción) — sin cambio
                             reasons: HighlightReason[] }   // v1.50.3-e: TODAS las condiciones detectadas (diagnóstico)
HighlightReason = "FEATURE_OFF" | "NOT_RAW" | "NOT_PUBLISHED" | "NO_PSA10" | "NO_PSA9"
                | "STALE" | "NO_COST_TIER" | "BELOW_MIN_UPSIDE"
                | "SLAB_PUBLISHED" | "NOT_ABOVE_RAW" | "ABOVE_MAX_MULTIPLE" | "GRADE_ORDER_INVERTED"
// ⚠️ v1.50.3-e — POR QUÉ HAY DOS CAMPOS. `reason` responde «¿qué impide promocionar?» y se detiene en el primer
// bloqueante: correcto para decidir, INSUFICIENTE para diagnosticar, porque una carta puede fallar VARIAS cosas a la
// vez. Medido: raw $460 + PSA 10 $230 SIN PSA 9 cortaba en NO_PSA9 y la incoherencia NOT_ABOVE_RAW nunca se
// evaluaba ⇒ una cifra en unidades equivocadas, VISIBLE en la ficha, INVISIBLE en la lista de revisión.
// `reasons` lista todas las condiciones en orden canónico; `reason` === `reasons[0]`. `eligible` NO cambia (es la
// conjunción de todos los pasos; el orden de evaluación nunca la alteró).
// ⚠️ Una condición cuyos INSUMOS no existen no se evalúa y NO se lista (p.ej. GRADE_ORDER_INVERTED sin PSA 9):
// la AUSENCIA de un reason significa «no se pudo comprobar», NO «pasó esa prueba».
// ---- LISTA DE REVISIÓN (GET /admin/pricing/graded-estimates/review, §M2, super_admin) — NUEVO v1.50.3. ----
// Es el criterio 111(e), y la CONTRAPARTIDA de §4.38(k.3): la cifra incoherente NO se oculta en la ficha, así que
// alguien tiene que enterarse. `preview` responde «¿por qué ESTA carta no está destacada?» (exige cardId: solo
// contesta si ya sospechabas); esto responde «¿de qué cartas debo sospechar?». MISMO cálculo, MISMOS `reason`.
// Mismo contenido que el preview + identidad de la carta, para que la lista se lea sin un fetch por fila.
GradedEstimateReviewItemDTO = GradedEstimatePreviewDTO & { cardId: string, cardName: string,
                                                           setName: string, number: string }
// Default del filtro = SOLO los tres `reason` de coherencia de magnitud (criterio 111 b/c/d):
//   NOT_ABOVE_RAW | ABOVE_MAX_MULTIPLE | GRADE_ORDER_INVERTED
// OPT-IN (accionables, pero NO son datos erróneos: en el default ahogarían la señal de coherencia):
//   SLAB_PUBLISHED (INV-D)  y  STALE (v1.50.3-c, PI-D6: la cifra EXISTE y CADUCÓ — no es «ausencia»).
// El resto de `reason` NO son enumerables aquí (400): son AUSENCIA de dato o el gate comercial funcionando.
// `FEATURE_OFF` JAMÁS se emite: esta lista evalúa aunque el dial esté `off`, para poder limpiar ANTES de encender.
// Ficha (GET /catalog/cards/:cardId): los grupos vendibles de esa carta + `units` = TODAS las piezas vendibles por-pieza
// (cheapest-first) para que el front agregue hasta `stockCount` `inventoryItemId` DISTINTOS al carrito (por-pieza, §4-G).
// Espeja `SealedGroupDetailResponse` (group+listings): la grilla se construye contra `listings` (grupos); `units` es SOLO
// el detalle por-pieza para resolver el add-to-cart y (en graded) mostrar `certNumber` por slab.
GroupedListingDetailResponse = { card: CardDTO, listings: GroupedListingDTO[], units: ListingDTO[] }
// Punto de la serie de tendencia del portafolio (gráfica estilo acciones). estimated? = punto de backfill indicativo.
PortfolioPointDTO = { date: string, valueMxnCents: number, costBasisMxnCents?: number, estimated?: boolean }
// v1.9-set-chart: punto de la serie PÚBLICA del valor de mercado agregado de un SET (hero de la home).
// Misma línea que PortfolioPointDTO. valueMxnCents = SUM de PriceReference (acabado normal/raw) de las cartas
// PRICEADAS del set ese día; pricedCardCount = cuántas cartas entraron al total (las sin precio se excluyen,
// no se inventan). estimated? reservado (no se usa en el MVP: la serie no tiene backfill).
SetValuePointDTO = { date: string, valueMxnCents: number, pricedCardCount: number, estimated?: boolean }
// v1.9-set-chart: cabecera del set graficado. id = id LOCAL del CardSet (no el externalId). Datos de catálogo
// públicos de pokemontcg.io (en inglés, no se traduce). series/releaseDate opcionales (pueden faltar en catálogo).
SetRefDTO = { id: string, name: string, series?: string, releaseDate?: string }
// v1.9-set-chart: rango de la serie (mismo conjunto que la gráfica de portafolio, GET /vault/portfolio/history).
SetValueRange = "5d" | "15d" | "1m" | "3m" | "6m" | "1y" | "ytd" | "all"
// v1.9-set-chart: respuesta de las rutas *-value-history. `set` es null si no hay ningún CardSet para graficar.
SetValueHistoryResponse = { set: SetRefDTO | null, range: SetValueRange,
                            points: SetValuePointDTO[],
                            change: { absMxnCents: number, pct: number | null, direction: "up" | "down" | "flat" } }
// ⛔ v2.0 (P-48): `BuylistRule` / `BuylistRuleApplied` / `SalesRule` / `SalesRuleApplied` RETIRADOS del contrato vivo.
// No hay reglas por rareza/tier/acabado ni modos fixed/pct: hay UNA CURVA por eje (`PricingCurveDTO`, abajo). Se
// conservan estas líneas solo como registro de procedencia (y porque `SellRequestItem.ruleMode/ruleValue/ruleSource`
// sobreviven en BD como columnas legacy de filas históricas — nada nuevo las escribe).
BuylistRule       = { mode: BuylistRuleMode, value: number }                              // ⛔ RETIRADO v2.0
BuylistRuleApplied = { mode: BuylistRuleMode, value: number, source: "rule" | "fallback" } // ⛔ RETIRADO v2.0
SalesRule         = { mode: SalesRuleMode, value: number }                                // ⛔ RETIRADO v2.0
SalesRuleApplied  = { mode: SalesRuleMode, value: number, source: "rule" | "fallback" }   // ⛔ RETIRADO v2.0

// ===== v2.0 (P-48) — LA CURVA. Fuente de verdad del editor de M2 (GET/PUT /admin/pricing/curve) =====
// UNIDADES (normativas, todo ENTERO): dinero en CENTAVOS MXN. Los dos valores interpolados van en la MISMA unidad —
// PUNTOS BASE (bp) del mercado, donde 10000 bp = 1× = 100 % del mercado. Así el invariante «compra < venta» es la
// comparación DIRECTA `pctBp(m) < multiplierBp(m)` y «venta nunca por debajo del mercado» es `multiplierBp >= 10000`.
//   venta  = redondeo↑( max( sale.floorCents , mercado × multiplierBp(mercado) / 10000 ) )
//   compra =            max( buy.binCents    , mercado × pctBp(mercado)        / 10000 )   // SIN redondeo
// INTERPOLACIÓN LINEAL obligatoria entre puntos; tramos PLANOS solo antes del primero y después del último. Un tramo
// escalonado DENTRO del rango está prohibido (produce saltos de precio y, arriba de ~$25 de mercado, es imposible sin
// vender por debajo del mercado). `points` es de LONGITUD VARIABLE: el dueño AGREGA, MUEVE y BORRA renglones — NO es
// una estructura fija de N puntos. El PUT reemplaza la lista completa (semántica de reemplazo, no de patch por índice).
// ⚠️ v2.1.2 — los `marketCents`/`multiplierBp`/`pctBp` de los PUNTOS son enteros (así se persisten y se editan), pero
// el multiplicador INTERPOLADO entre dos puntos NO se cuantiza: el precio se computa en UNA sola expresión racional
// exacta y el único redondeo de la cadena es el de centavos finales. Cuantizar el interpolado a bp entero volvía la
// venta NO monótona (mercado $717.10 ⇒ $800 / $717.11 ⇒ $775 con una curva legal). ARCHITECTURE §4.36.1.
// v2.1.5 — OJO con los DOS rangos del multiplicador, que son distintos a propósito:
//   * REPRESENTABILIDAD (V3, bloquea 422 SIEMPRE, también en el preview): multiplierBp ∈ [0, 1000000].
//   * NEGOCIO (V4, `SALE_BELOW_MARKET`, NO bloquea en el preview): multiplierBp >= 10000 («nunca por debajo del
//     mercado»). Antes V3 exigía >= 10000 y hacía a V4 INALCANZABLE: el previsualizador no podía enseñar en pesos
//     una curva que vendiera bajo mercado, que es justo para lo que existe el reparto 422/200. Ver §M2.
//   `marketCents ∈ [0, MAX_CENTS]` (2_147_483_647) en ambas curvas.
SaleCurvePointDTO = { marketCents: number, multiplierBp: number }   // 1.60× = 16000 ; V3 [0, 1000000] · V4 >= 10000
BuyCurvePointDTO  = { marketCents: number, pctBp: number }          // 30 %  = 3000  ; rango [0, 10000]
// Escalera de redondeo ↑ — SOLO VENTA (la compra no se redondea). La BANDA la decide el monto ANTES de redondear y se
// elige UNA SOLA VEZ: si el redondeo cruza el umbral, NO se re-evalúa. `uptoCents: null` = banda abierta (la última).
RoundingBandDTO   = { uptoCents: number | null, stepCents: number }
// v2.1.9 — LAS DOS CONSTANTES LLEVAN TECHO, y NO es el de `marketCents`: `floorCents, binCents ∈ [0, 200000]`
//   (`MAX_CURVE_CONSTANT_CENTS` = MX$2,000, cerrado por el dueño en Q-D1). `marketCents` describe el VALOR DE UNA
//   CARTA (techo = representabilidad Int32); el piso y el bin son las ÚNICAS entradas que por sí solas fijan el precio
//   de TODO el catálogo (techo = cordura, anclado en lo plausible como CARTA MÁS BARATA de la tienda). Sin techo,
//   `floorCents: 2e15` se guardaba con `200` y publicaba la vitrina entera en 2147483647 con basis="floor". Razón
//   completa y anclajes del número en §M2 / ARCHITECTURE §4.36.3.
PricingCurveDTO   = { version: 1,
                      sale: { floorCents: number,          // PISO único y GLOBAL (no por acabado, ni rareza, ni tier). [0, 200000]
                              points: SaleCurvePointDTO[],  // >= 1, marketCents estrictamente crecientes
                              rounding: RoundingBandDTO[] },// >= 1, la ÚLTIMA con uptoCents = null
                      buy:  { binCents: number,            // BIN único y GLOBAL. [0, 200000] y además < floorCents (BIN_ABOVE_FLOOR)
                              points: BuyCurvePointDTO[] } }

// ===== v2.1 (P-48) — DRY-RUN de la curva (POST /admin/pricing/curve/preview) =====
// Alimenta el previsualizador OBLIGATORIO del editor (DESIGN_SYSTEM §21.5: probeta + tabla de referencia). Existe
// para que la fórmula de dinero NO se reimplemente en el cliente: si el dueño calibra contra un cálculo que no es el
// que va a cobrar, es el bug de P-48 en espejo. ARCHITECTURE §4.36.8a.
// `violations` = las infracciones CALCULADAS POR EL MISMO VALIDADOR DEL `PUT` ⇒ el editor tampoco reimplementa V1–V9.
CurvePreviewRequest = { draft: PricingCurveDTO,   // la curva EN EDICIÓN (sin guardar). Obligatoria.
                        marketsCents: number[] }  // 1..50 sondas, enteros >= 0. El server DEDUPLICA y ORDENA asc.
// Memoria de cálculo de UN eje para UNA sonda (§21.5a la pinta literal; ARCHITECTURE §4.36.1 la define).
//   * `appliedBp` = el valor interpolado, en puntos base (venta: multiplicador, 16000=1.60×; compra: %, 3000=30%). Es
//     el «× 1.4409» / «× 34.67%» de la memoria.
//     ⚠️ v2.1.2 — `appliedBp` es **SOLO PARA MOSTRAR, redondeado a bp; NO es el valor con el que se calcula**: el
//     cálculo usa la interpolación RACIONAL EXACTA (cuantizarla rompía la monotonía, §DTOs arriba / ARCHITECTURE
//     §4.36.1). Consecuencia práctica: rehacer a mano `mercado × appliedBp` puede diferir de `rawCents` en **≤ 1
//     centavo**; el número autoritativo es `rawCents`, que lo devuelve el servidor. (Nota para ux-ui: conviene que la
//     memoria de §21.5a lea «≈» en esa línea, o muestre más decimales. Es copy, decide ux-ui.)
//     ⚠️ v2.1.4 — el aislamiento pasa a ser ESTRUCTURAL, no advertido: `appliedBp` se tipa como un tipo DISTINTO
//     (branded `DisplayBp`) que NO es asignable a los parámetros de las funciones de precio, de modo que recomponer
//     un monto a partir de él **no compile**. Hoy ningún consumidor lo hace (verificado en backend y frontend), pero
//     eso es convención; I1 falló exactamente así — un valor redondeado que se coló en la ruta de dinero.
//   * `rawCents` = producto ANTES de la constante y ANTES de redondear = ROUND_HALF_UP(mercado × appliedBp / 10000).
//     ⚠ `ROUND_HALF_UP` = medio ALEJÁNDOSE DE CERO, y en `interp` se redondea el VALOR FINAL (nunca el delta, que
//     puede ser negativo cuando el markup baja: `Math.round(-1590.5)` da -1590 en JS pero la norma exige -1591).
//     Fijarlo es lo que impide que backend y previsualizador difieran en un centavo. ARCHITECTURE §4.36.1.
//   * `constantCents` = el piso (venta) o el bin (compra); `constantWon` = la constante ganó el `max` (⇒ basis="floor").
//   * `baseCents` = max(constantCents, rawCents) — el monto sobre el que se elige la banda y se redondea (SOLO venta).
//     ⚠ La escalera se aplica IGUAL cuando gana el piso: con piso MX$25.30 y paso MX$5 el precio publicado es MX$30.
//     Exponer `baseCents` deja eso VISIBLE en pantalla en vez de que parezca un descuadre.
//   * `roundingStepCents` = el paso usado (venta). La banda se elige por `baseCents` y NO se re-evalúa. `null` en compra
//     (la compra NO se redondea) y cuando basis="pending".
//   * `segment` = qué tramo se interpoló: `{ fromIndex, toIndex }`, o `null` en los tramos PLANOS (antes del primer
//     punto / después del último). Saber QUÉ tramo aplicó es parte de la matemática — §21.4b/§21.5c resaltan «el tramo
//     implicado» y derivarlo en el cliente sería re-duplicar el lookup que este endpoint centraliza.
//   * `basis` solo puede valer "market" | "floor" | "pending": el dry-run opera sobre mercados HIPOTÉTICOS, no sobre
//     variantes reales ⇒ jamás "override" ni "bounty" (no consulta overrides, bounties, rareza ni inventario).
CurvePreviewLegDTO = { priceCents: number | null, basis: PriceBasis,
                       appliedBp: number | null, rawCents: number | null,
                       constantCents: number, constantWon: boolean,
                       baseCents?: number | null, roundingStepCents?: number | null,
                       segment: { fromIndex: number, toIndex: number } | null }
// Una sonda evaluada con las DOS curvas. `deltaCents` = borrador − vigente (null si algún lado es pending).
CurvePreviewRowDTO = { marketCents: number,
                       draft: { sale: CurvePreviewLegDTO, buy: CurvePreviewLegDTO },
                       saved: { sale: CurvePreviewLegDTO, buy: CurvePreviewLegDTO },
                       deltaCents: { sale: number | null, buy: number | null } }
// `violations` = infracciones del BORRADOR que SÍ dejan calcular (V4/V5/V6/V7 + condición fina de la escalera).
// MISMO `{ code, details }` que emitiría el `PUT`. Vacío ⇒ el borrador pasaría hoy — pero NO es una autorización:
// el `PUT` re-valida desde cero y es la única autoridad (SEC-A1).
CurvePreviewResponse = { rows: CurvePreviewRowDTO[],
                         violations: { code: string, details: object }[] }
// v1.15-buylist-batch-clabe: cotización en LOTE (POST /buylist/quote/batch). READ-ONLY. SIN `qty` — el modelo es
// UNA línea por carta física (ARCHITECTURE §4.16b). Espeja EXACTAMENTE los campos del quote por-carta (PublicQuoteDto).
// v1.30: `productId?` (number = TCGplayer productId == CardProduct.tcgplayerProductId; el MISMO que el front recibió
//   en CardProductDTO.productId / separateProducts). OPCIONAL/ADITIVO. Presente ⇒ la línea es ESE CardProduct concreto
//   (acabado ∈ CardProduct.finishes; referencia leída de PriceReference filtrada por ese cardProductId). Ausente ⇒
//   producto de set por (cardId, finish) — comportamiento v1.29 intacto (clientes viejos no cambian). Ver §4.29.
BuylistQuoteItemDTO = { cardId: string, productType: ProductType, rawCondition?: RawCondition, finish?: Finish,
                        productId?: number }
// Payload de éxito por ítem = MISMO shape que la respuesta de POST /buylist/quote por-carta (BuylistQuoteResponse).
// v1.30: `productId?` = eco del producto cotizado (snapshot). Ausente ⇒ línea de set_base. El `finish` es el del
//   producto y determina DE QUÉ VARIANTE se lee el mercado; el monto se deriva server-side (SEC-A1).
// ⚠️ v2.0 (P-48) — BREAKING ACOTADO: `appliedRule` SE RETIRA (ya no existe `{mode,value}`: no hay reglas, hay curva).
//   Lo reemplaza `priceBasis` (§Enums). `rarity` SE CONSERVA como dato INFORMATIVO/de display del catálogo — el monto
//   NO depende de ella (criterio 84); el front no debe derivar precio de ella. Valores alcanzables de `priceBasis` en
//   este eje: "bounty" | "override" | "market" | "floor" | "pending". `precio_pendiente` ⇔ priceBasis="pending" —
//   que ahora incluye DOS casos: sin dato de mercado (el bin NO gana) y guardarraíl §4.36.5 (premium en el bin).
// ⚠️ v2.1 — `priceBasis` de ESTE payload es para la LÓGICA del cliente (habilitar/deshabilitar, estado
//   `precio_pendiente`, snapshot de `createRequest`), NO para RENDERIZARLO AL VENDEDOR. §N.7 acota la superficie donde
//   se explica el origen del precio a la FICHA de carta y la de sellado; el **cotizador de buylist NO se toca**. Al
//   retirarse `appliedRule`, la fila «Regla aplicada» de la vista del cliente **se retira** — NO se sustituye por un
//   rótulo de `priceBasis` de cara al comprador/vendedor (sería inventar superficie que el contrato no autoriza y
//   filtrar la calibración interna: «piso»/«mínimo» le dice al vendedor que su carta tocó el bin). Decisión ratificada.
BuylistQuotePayload = { rarity: string | null, finish: Finish, productId?: number, priceBasis: PriceBasis,
                        quote: { status: "cotizada" | "precio_pendiente", quotedPriceCents: number | null, currency: "MXN" },
                        referencePrice: { status: "priced" | "pending", priceMxnCents?: number },
                        paymentNotice: "PAY_AFTER_RECEIPT" }
// Resultado por ítem: ok:true trae la cotización; ok:false trae el error de ESE ítem (NO tumba el lote → HTTP 200).
// `index` = posición 0-based en el request `items[]` (llave de correlación robusta ante cardId+finish+productId repetidos).
// v1.30: `error.code` gana `PRODUCT_NOT_FOUND` (productId inexistente) y `PRODUCT_CARD_MISMATCH` (productId no cuelga
//   del cardId → rechazo validado, NUNCA fusión silenciosa con la carta base).
BuylistBatchQuoteResultDTO =
    | ({ index: number, cardId: string, ok: true } & BuylistQuotePayload)
    | { index: number, cardId: string, ok: false,
        error: { code: "NOT_FOUND" | "FINISH_NOT_AVAILABLE" | "PRODUCT_NOT_FOUND" | "PRODUCT_CARD_MISMATCH", message: string } }
BuylistBatchQuoteResponse = { results: BuylistBatchQuoteResultDTO[] }
// ===== v1.16-master-set: Master Set + inventario a escala (§M1) =====
// Fila del índice de sets (GET /admin/inventory/master-sets). Agregación SOLO de inventario de PLATAFORMA
// (back-office). `catalogCardCount` = nº de Card del catálogo con ese setId (puede EXCEDER printedTotal por
// secret/hyper rares > printedTotal). `distinctCardsOwned` = cartas DISTINTAS del set con ≥1 pieza on-hand.
// `completionPct` = distinctCardsOwned / catalogCardCount × 100 (denominador = catálogo real, no printedTotal;
// null si catalogCardCount=0). `totalPieces` = conteo de InventoryItem on-hand del set. "on-hand" = ownerType
// 'platform' AND status NOT IN (withdrawn, shipped, delivered, lost, damaged). Ver ARCHITECTURE §4.17a (decisión abierta WS-E-1/2).
// v1.42 (BLOQ-3): el binder cuenta SOLO SINGLES → todas las agregaciones de este DTO (distinctCardsOwned, totalPieces,
//   completionPct) EXCLUYEN `productType='sealed'` (alinea con H9; el sellado vive en la pestaña «Sellado», §sealed-sets).
//   `catalogCardCount` (denominador = catálogo) NO cambia. Mismo filtro en el scope user_vault. Ver ARCHITECTURE §4.20b.
MasterSetSummaryDTO = { setId: string, name: string, series?: string, releaseDate?: string, year?: number,
                        printedTotal?: number, catalogCardCount: number, distinctCardsOwned: number,
                        completionPct: number | null, totalPieces: number }
MasterSetIndexResponse = { data: MasterSetSummaryDTO[], page: number, pageSize: number, total: number }
// Celda del binder (GET /admin/inventory/master-sets/:setId). Una por Card del catálogo del set. `number` es el
// Card.number crudo (String, p. ej. "4", "SV107", "TG12"); `numberSort` es la CLAVE NUMÉRICA derivada server-side
// para el orden natural estable (el front conserva/re-ordena por ella tras filtrar). `countsByFinish` = piezas
// on-hand por acabado (solo acabados con ≥1 pieza); `totalCount` = suma. Celda con `totalCount=0` = hueco de
// inventario (carta que aún no tenemos).
// v1.42 (BLOQ-3): SOLO SINGLES — `countsByFinish`/`totalCount` EXCLUYEN `productType='sealed'` (un ETB anclado a esta
//   carta ya NO la infla como `finish=normal`). El sellado vive en su pestaña dedicada. Ver ARCHITECTURE §4.20b.
// v1.16.1 — ORDEN NATURAL (corrige la nota previa): los números **puramente numéricos** ordenan por su valor ENTERO
//   primero; los **promos/subsets con prefijo alfabético** (TG/GG/SV…) van AL FINAL, agrupados por prefijo. La
//   fórmula ilustrativa previa (`regexp_replace(number,'\D','','g')::int`) era INCORRECTA porque convertía `TG12`→12
//   y lo intercalaba entre las numéricas; el `numberSort` correcto solo parsea el entero cuando `number ~ '^[0-9]+$'`
//   (ver §M1 para el orden completo). Para una celda promo, `numberSort` es un valor sentinela que la empuja al final.
// v1.16.1 — `isSecretRare` es una HEURÍSTICA SOLO DE DISPLAY (no es dato de negocio): true SOLO para cartas de la
//   numeración PRINCIPAL (número puramente numérico) cuyo entero > `printedTotal` (secret/hyper rare real). Los
//   promos/subsets con prefijo alfabético (TG/GG/SV) NO son secret rare → `isSecretRare=false` (son subset aparte).
//   `printedTotal` nulo → `false`. (Definición previa `numberSort > printedTotal` marcaba TODOS los promos; deuda
//   BE-36, ver ARCHITECTURE §9.)
// v1.22-variantes-orden — `numberSort` y el NUEVO `numberPrefix` dejan de ser derivados en memoria: son COLUMNAS
//   de `Card` (M-26) y el servidor ordena por ellas en SQL. `numberSort` SOLO no basta para re-ordenar en el front
//   (`TG12` y `GG12` colisionan en 1000012): el comparador correcto es (numberPrefix asc, numberSort asc, number asc).
// v1.22-2 (N-15): displayFinishes = subconjunto de availableFinishes que el front RENDERIZA (oculta el acabado
//   espurio de una premium de una sola impresión). Ver CardDTO. Con N-16 (rejilla plana) el nº de TARJETAS por
//   carta = |displayFinishes| (una tarjeta por acabado visible), NO |availableFinishes|.
// v1.26 (P-2, §M1): marketReferenceMxnCents = precio de MERCADO (PriceReference cruda del acabado base, FX-recompute a
//   MXN vigente); NO es el precio de venta derivado. null cuando la referencia está `pending`. ADITIVO/opcional. La teja
//   admin del Master Set muestra MERCADO; el precio de venta del cliente vive en `buyable.salePriceCents` (vista cliente).
// v1.27 (P-15): ⚠️ el `marketReferenceMxnCents` de la CELDA queda **DEPRECADO** — el precio de mercado se mueve al
//   nivel VARIANTE (`MasterSetVariantDTO.marketReferenceMxnCents`, abajo): la referencia del acabado BASE pintada
//   igual en todas las variantes era el bug P-15 (Normal y Reverse mostraban lo mismo). El campo de celda se CONSERVA
//   UNA versión como espejo de la variante del acabado base (= `variants[0].marketReferenceMxnCents`) para no romper
//   lectores rezagados; el front NO debe leerlo más (lee la variante). Retiro planificado en la siguiente rev.
MasterSetCardCellDTO = { cardId: string, number: string, numberSort: number, numberPrefix: string,
                         name: string, rarity?: string,
                         imageSmallUrl?: string, availableFinishes: Finish[], displayFinishes: Finish[],
                         countsByFinish: { finish: Finish, count: number }[], totalCount: number, isSecretRare: boolean,
                         marketReferenceMxnCents?: number | null /* DEPRECADO v1.27: usar variants[].marketReferenceMxnCents */ }
MasterSetBinderResponse = { set: SetRefDTO, printedTotal: number | null, catalogCardCount: number,
                            cells: MasterSetCardCellDTO[] }
// ===== v1.20-master-set-everywhere: contrato ÚNICO por scope + completitud por VARIANTE =====
// Un solo shape para 3 vistas; cambia el ALCANCE de la agregación, no la forma:
//   scope="platform"   → inventario de PLATAFORMA (M1, `GET /admin/inventory/master-sets[...]`; regla on-hand v1.16).
//   scope="user_vault" → bóveda de UN usuario: ownerType='customer' AND ownerUserId=:userId AND status NOT IN
//                        (withdrawn, shipped, delivered, lost, damaged); cuenta AMBAS titularidades (pending|settled).
// Omisiones por scope (regla dura): este shape NUNCA lleva ubicación física (box/row/slot/locationId), costos
// (acquisitionCostCents/acquisitionPct), folios, ni ownerUserId de terceros — en NINGÚN scope (el detalle interno
// vive en GET /admin/inventory/items). En scope cliente además NO hay acciones de captura/publicación/ajuste/venta,
// y `buyable` SOLO se puebla en la vista (iii) del propio cliente.
// `owner`: presente SOLO en scope user_vault. `email` SOLO en la vista admin (ii); en la vista (iii) se omite.
VaultOwnerRefDTO = { userId: string, name: string, email?: string }
// Variante = (carta, acabado). El UNIVERSO esperado por carta = Card.availableFinishes (campo YA existente del
// catálogo; v1.22: fuente ÚNICA = sync de catálogo — tcgplayer.prices ∪ cardmarket.reverseHolo*; el price-ingest
// YA NO lo escribe. Filas históricas/sin datos → ["normal"]).
// v1.27.1 (P-13-fix, sin cambio de shape): universo = orderFinishes( (structuralFinishes ∪ pricedFinishesSnapshot)
// − { normal si rareza premium } ) || ["normal"]. La unión recupera el reverse holo de los comunes (que en sets nuevos
// solo trae el proveedor de precios) y el filtro premium mata el `normal` fantasma de ex/secret rares. (⛔ la fórmula
// «solo structural» de la primera P-13 quedó derogada 2026-08-22 por regresión.) Ver ARCHITECTURE §4.25e.
// `variants` trae EXACTAMENTE una entrada por acabado de availableFinishes (orden canónico FINISH_ORDER:
// normal → reverse_holo → holofoil → first_edition_holofoil), ni una más ni una menos.
// v1.22 — SIN CAMBIO DE SHAPE, y es una decisión, no un olvido: la variante NO lleva imagen propia. pokemontcg.io
// publica UNA sola imagen por carta (el reverse holo no tiene arte distinta en la fuente), así que las N casillas
// de una celda usan la MISMA `MasterSetCardCellDTO.imageSmallUrl`. Diferenciar visualmente el acabado es
// PRESENTACIÓN del front (marco/badge/overlay), no un campo del contrato. No proponer `imageByFinish`.
// `covered` = ≥1 pieza en el scope para ese (cardId, finish). `buyable` SOLO scope cliente y SOLO cuando
// covered=false: la pieza `listed` de plataforma MÁS BARATA de ese (cardId, finish), o null.
// v1.42 (BLOQ-3/3b): `count`/`covered` cuentan SOLO SINGLES (`productType ∈ {raw, graded}`) — `sealed` EXCLUIDO (ya no
//   llena la casilla del single anclado). `buyable` también resuelve SOLO singles (ya no ofrece un ETB sellado para
//   llenar la casilla de un single; mata «Tropius» en el faltante). SEC-A1 intacto: salePriceCents server-side, no del DTO.
//   (⚠ deroga el «cualquier productType» previo SOLO para sealed; graded sigue contando/siendo buyable.)
// NOTA compat: `countsByFinish` (v1.16) se CONSERVA y puede traer acabados FUERA del universo (drift de catálogo:
// pieza capturada con un finish que availableFinishes ya no declara); esas piezas se ven pero NO cuentan en
// expected/covered (los contadores X/Y cuentan variantes del universo).
// v1.22-2 (N-15/N-16): `displayed` = (finish ∈ cell.displayFinishes) — espejo de conveniencia para el render PLANO.
//   `variants` SIGUE trayendo una entrada por acabado de availableFinishes (universo de completitud X/Y intacto:
//   coveredVariantCount/expectedVariantCount cuentan sobre availableFinishes). El front que pinta la REJILLA PLANA
//   (N-16) renderiza UNA tarjeta por variante con `displayed===true`; las variantes `displayed===false` (acabado
//   espurio suprimido) NO se pintan pero SIGUEN contando para completitud y buyable. Whitelist SEC-A1 sin cambio.
// v1.27 (P-15, ADITIVO): la variante gana su PROPIO precio de mercado — `marketReferenceMxnCents` = la
//   `PriceReference` vigente de (cardId, 'raw', 'raw:NM', ESTE finish), FX-recompute a MXN server-side
//   (`getReferencesBatch`/`liveMxnCents`, batch expandido a carta × acabado del universo; sigue siendo UNA query,
//   sin N+1). `null` cuando la referencia está `pending`/ausente (NUNCA un 0 inventado; el front pinta "—").
//   NO es el precio de venta derivado (ese vive en `buyable.salePriceCents`, solo vista (iii) cliente).
//   `capturedDate` (opcional) = `PriceReference.capturedDate` (ISO, fecha de la última ingesta) de ESA fila;
//   presente solo cuando `marketReferenceMxnCents != null`; el front lo trata como decoración de frescura y
//   tolera su ausencia. Aplica en los 3 scopes del binder (M1 plataforma, bóveda admin, "Mi bóveda") — misma
//   agregación, solo lectura, no toca SEC-A1.
//   ⚠️ Prerrequisito de DATOS (no de contrato) — CORREGIDO v1.44 (P-47, ARCHITECTURE §4.35): el precio por-acabado
//   (reverse_holo/holofoil) lo pobla el barrido diario desde **TCGCSV `tcgcsv_singles`** (`source='tcgcsv_singles'`,
//   por `cardProductId`), NO PPT. La API v2 de PPT expone UN solo `market` (impresión primaria) invariante al
//   `?printing=`, así que `fetchPrintings` nunca dio la referencia propia de la reverse (se APAGA:
//   `POKEMONPRICETRACKER_FETCH_PRINTINGS=false`; PPT queda como fallback LIST de la impresión primaria). Un acabado sin
//   precio en NINGUNA fuente ⇒ referencia `null`/"—" + `PRICE_PENDING`, JAMÁS el precio de otro acabado.
// v1.28 (P-18, ADITIVO): `pricing?` = la CONSOLA de precios de la variante (compra/venta: sugerido por regla,
//   override vigente, efectivo resuelto + fuente; bounty P-22). Presente **SOLO en scope `platform`** (M1) — en
//   `user_vault` y «Mi bóveda» se OMITE SIEMPRE (la estrategia de compra/bounty no se filtra al cliente; regla
//   dura, misma familia que la omisión de costos/folios). Sugeridos/efectivos se computan en lote (reglas izadas
//   una vez + `getReferencesBatch` + `getVariantOverridesBatch`; sin N+1). `null` = no resoluble (money-safe,
//   nunca 0 inventado). Precedencias normativas en ARCHITECTURE §4.26b. El precio manual POR PIEZA
//   (`listPriceCents`) NO viaja aquí (vive en el drill-down de items) pero GANA sobre `sell.overrideCents` para
//   esa pieza.
MasterSetVariantDTO = { finish: Finish, count: number, covered: boolean, displayed: boolean,
                        marketReferenceMxnCents?: number | null, capturedDate?: string | null,
                        pricing?: VariantPricingDTO,
                        buyable?: { inventoryItemId: string, salePriceCents: number } | null }
// v1.28 (P-18/P-22). `suggestedCents` = lo que da la REGLA HOY sobre la referencia del acabado; `overrideCents` = el
// override manual persistido (VariantPriceOverride, M-30); `effectiveCents` = el precio RESUELTO con la precedencia
// normativa; `source` = qué peldaño ganó. `bounty` viene (solo si existe fila) con su estado para la consola.
// ⚠️ v2.0 (P-48) — BREAKING ACOTADO (admin-only, ningún cliente público lo consume):
//   * `suggestedCents` = lo que da la **CURVA** hoy (no «la regla»): venta con piso+redondeo, compra con bin.
//   * `source` pasa de `"rule" | "fallback"` a **`PriceBasis`**: `market | floor` sustituyen a ambos.
//     buy.source ∈ {bounty, override, market, floor, pending} · sell.source ∈ {override, market, floor, pending}.
//   * `bounty` gana **`effective: boolean`** y **`curveQuoteCents: number | null`** — la ALERTA DEL BINDER (§N.6,
//     decisión del humano: basta el binder, SIN aviso proactivo por correo/push). `effective=false` ⇔ el bounty
//     quedó por debajo (o IGUAL) de la tarifa vigente ⇒ NO aplica en la cotización, NO se publica en la vitrina y
//     `buy.source` NO será "bounty". `curveQuoteCents` = la tarifa de curva que lo rebasó (null si la curva no
//     resuelve, en cuyo caso el bounty explícito SIGUE siendo efectivo).
//   * `premiumAtFloor: boolean` (ADITIVO) = el guardarraíl §4.36.5 disparó para esta variante en ese eje: rareza
//     premium que aterrizó en el piso/bin ⇒ NO se publica / NO se cotiza y hay entrada `premium_at_floor` en la cola.
//     Es lo que hace VISIBLE el guardarraíl desde el back-office y permite detectar PISOS MAL CALIBRADOS.
VariantPricingDTO = { buy:  { suggestedCents: number | null, overrideCents: number | null,
                              effectiveCents: number | null,
                              source: PriceBasis, premiumAtFloor: boolean },
                      sell: { suggestedCents: number | null, overrideCents: number | null,
                              effectiveCents: number | null,
                              source: PriceBasis, premiumAtFloor: boolean },
                      bounty?: { enabled: boolean, priceCents: number | null, targetQty: number | null,
                                 acquiredQty: number, completedAt: string | null,
                                 effective: boolean, curveQuoteCents: number | null } | null }
// EXTENSIONES v1.20 (ADITIVAS — los campos v1.16 no cambian; notación `+=` = campos que se AÑADEN al DTO):
// Índice: catalogVariantCount = Σ |availableFinishes| de las cartas del set; distinctVariantsOwned = variantes del
// universo con ≥1 pieza en el scope; variantCompletionPct = distinctVariantsOwned / catalogVariantCount × 100
// (null si catalogVariantCount=0). Los contadores de UI "X/Y" usan ESTOS campos (variantes), no los de carta.
// En scope user_vault, `distinctCardsOwned`/`totalPieces`/`completionPct` se reinterpretan sobre la bóveda del usuario.
MasterSetSummaryDTO  += { catalogVariantCount: number, distinctVariantsOwned: number,
                          variantCompletionPct: number | null }
MasterSetCardCellDTO += { expectedVariantCount: number, coveredVariantCount: number,
                          variants: MasterSetVariantDTO[] }
// v1.29 (ARCHITECTURE §4.27) — «1 carta ↔ N productos». CardProductDTO = un producto TCGplayer (== un productId)
// bajo esta carta. Los productos de set (kind=set_base) alimentan availableFinishes/variants; los kind ∈
// {deck_exclusive, promo} se exponen APARTE como productos vendibles/cotizables propios con su PROPIO precio.
// marketReferenceMxnCents por acabado = null cuando no hay precio en ninguna fuente («—», nunca 0). displayFinishes
// queda DEPRECADO (= availableFinishes; ya no hay casilla espuria que ocultar tras §4.27).
CardProductDTO = { productId: number, kind: "set_base" | "deck_exclusive" | "promo" | "other", name: string,
                   finishes: Finish[],
                   prices: { finish: Finish, marketReferenceMxnCents: number | null, capturedDate?: string | null }[] }
// separateProducts = SOLO los kind ∈ {deck_exclusive, promo} de la carta (los set_base ya están en variants).
// Ausente/[] cuando la carta no tiene productos separados (el caso común).
MasterSetCardCellDTO += { separateProducts?: CardProductDTO[] }
MasterSetIndexResponse  += { scope: MasterSetScope, owner?: VaultOwnerRefDTO }
MasterSetBinderResponse += { scope: MasterSetScope, owner?: VaultOwnerRefDTO }
// ===== v1.33-master-set-multipart (P-27, PROJECT §L / ARCHITECTURE §4.31): MASTER SET COMBINADO =====
// Un set multi-parte (principal + subset(s) con id propio) se presenta como UN master set combinado (Celebrations
// cel25 + Classic Collection cel25c = 50). SOLO presentación: cada Card/celda/pieza conserva su set-id REAL; el
// mapa padre→subset (constante curada backend/src/config/master-set-groups.ts) NUNCA es fuente de verdad ni toca
// precio/inventario/bóveda (money-safe, CA-68/CA-72). Todos los campos abajo son ADITIVOS y OPCIONALES: un set
// normal (sin grupo) los OMITE y su comportamiento v1.20 no cambia (retrocompat total).
// `parts` presente SOLO cuando el set es un master COMBINADO (≥2 partes); una entrada por parte (principal + cada
// subset importado), en orden de bloque (principal isPrimary=true order=0; subsets por su `order`). `label` = la
// etiqueta del separador ("Classic Collection"); en el principal `label` = su propio `name`. `catalogCardCount` de
// la parte = nº de Card de ESE set-id (para que el front pueda mostrar el desglose por bloque).
SetPartDTO = { setId: string, name: string, label?: string, isPrimary: boolean, order: number,
               catalogCardCount: number }
// `partSetId`/`partLabel` en la celda: a qué parte REAL pertenece la carta (su CardSet local) y la etiqueta del
// bloque. Presentes SOLO en un master combinado (cuando `parts` viene); el front agrupa las celdas por `partSetId`
// y pinta el separador con `partLabel`. En un set normal se OMITEN (la celda es del único set). NO cambian la
// identidad: `cardId` sigue llaveado a su set real — money-safe.
MasterSetCardCellDTO += { partSetId?: string, partLabel?: string }
// Binder de un master combinado: `set` = SetRefDTO del PRINCIPAL (nombre del master = "Celebrations", D4);
// `catalogCardCount`/`printedTotal` = Σ de TODAS las partes (Celebrations = 50, D5/CA-67); `cells` fan-in de todas
// las partes, bloque del principal primero y luego cada subset, orden natural DENTRO del bloque. `canonicalSetId`
// presente SOLO cuando el `:setId` pedido era un SUBSET y se normalizó a su principal (el front actualiza la URL;
// evita el binder roto de 25 al abrir cel25c). En un set normal ambos se omiten.
MasterSetBinderResponse += { parts?: SetPartDTO[], canonicalSetId?: string }
// Índice: los subset de un grupo se PLIEGAN en la fila del principal (no aparecen como filas propias) y TODOS los
// agregados (catalogCardCount, catalogVariantCount, distinctCardsOwned, distinctVariantsOwned, totalPieces) se SUMAN
// sobre las partes; completionPct/variantCompletionPct se recomputan sobre esos totales (→ 50). `partSetIds` = los
// set-ids REALES plegados (principal + subsets); presente SOLO en masters combinados. CA-70: N subsets, suma todas.
// CA-71: si el principal NO está importado, el subset NO se pliega (aparece como su propio set, sin romper el conteo).
MasterSetSummaryDTO += { partSetIds?: string[] }
// ----- Lista de clientes con bóveda (GET /admin/vaults) -----
// totalValueMxnCents usa la MISMA base de valuación del portafolio (§3): referencia del ACABADO de cada pieza
// (PriceReference vigente); piezas sin precio se EXCLUYEN del total y se cuentan en pendingPriceCount.
// pieceCount = piezas del usuario "en bóveda" (mismo filtro de status del scope user_vault).
AdminVaultSummaryDTO = { userId: string, name: string, email: string, pieceCount: number,
                         totalValueMxnCents: number, pendingPriceCount: number }
AdminVaultListResponse = { data: AdminVaultSummaryDTO[], page: number, pageSize: number, total: number }
// ----- Ajuste de inventario por levantamiento físico (POST /admin/inventory/adjustments) -----
// Modelo POR-PIEZA (sin "delta" numérico): `encontrada` CREA piezas nuevas (reusa los campos de alta del lote,
// BatchInventoryItemInput; `acquisitionType` default "aportacion_en_especie" si se omite — excepción documentada;
// qty default 1, graded fuerza 1); los otros tres motivos operan UNA pieza existente y `note` es OBLIGATORIA.
// Estado resultante por motivo: encontrada → in_stock (fromStatus null) · perdida → lost · danada → damaged ·
// error_captura → withdrawn (la pieza NUNCA existió físicamente; NO cuenta como pérdida/reposición — el motivo real
// queda en InventoryAdjustment.reason, distinguible de un retiro de cliente).
// v1.20.1 — `batchKey?` SOLO en la rama `encontrada`: MISMA idempotencia que el alta por lote (mismo batchKey →
// no re-crea; el replay devuelve la respuesta original con idempotentReplay:true). Los otros motivos no lo llevan
// (id concreto; un replay cae en 422 ITEM_NOT_ADJUSTABLE — idempotencia natural).
InventoryAdjustmentRequest =
    | { reason: "perdida" | "danada" | "error_captura", inventoryItemId: string, note: string }
    | { reason: "encontrada", item: BatchInventoryItemInput, note?: string, batchKey?: string }
// v1.20.1 — `adjustmentIds` SUSTITUYE al singular `adjustmentId` (eliminado sin deprecated; sin clientes externos).
// Con `encontrada` y qty>1 hay N filas InventoryAdjustment (una por pieza, M-24): se devuelven TODAS, alineadas
// 1:1 con inventoryItemIds/folios. Con los otros motivos, arrays de longitud 1.
// `idempotentReplay`: true SOLO cuando un batchKey ya procesado repite la respuesta guardada; false en todo
// procesamiento nuevo (y siempre false sin batchKey / en motivos ≠ encontrada).
InventoryAdjustmentResponse = { adjustmentIds: string[], reason: AdjustmentReason,
                                inventoryItemIds: string[], folios: string[],
                                fromStatus: InventoryStatus | null, toStatus: InventoryStatus,
                                idempotentReplay: boolean }
// ----- Alta por LOTE (POST /admin/inventory/items/batch) -----
// Una línea = una intención de alta; `qty` (default 1) es un ATAJO que el backend expande a N InventoryItem
// (N piezas físicas, N folios) para bulk raw/sellado. graded → qty forzado a 1 (cada slab es único por certNumber;
// qty>1 en graded → 422 VALIDATION_ERROR). Los demás campos = MISMOS que POST /admin/inventory/items.
// v1.36 (P-35): 4 campos ADITIVOS SOLO para productType='sealed' (ignorados/─ raw/graded).
//   tcgplayerProductId? + tcgplayerGroupId? = mapeo TCGCSV; se fijan JUNTOS (uno sin el otro → 422 VALIDATION_ERROR).
//     Presentes ⇒ la pieza NACE MAPEADA (pobla InventoryItem.tcgplayerProductId/GroupId, columnas M-23 ya existentes)
//     → sealedMarketRef y valuación de aportación resuelven sin curación M2 aparte. Ausentes ⇒ nace sin mapeo (cola
//     de curación M2 como hoy). Vienen del SealedCatalogProductDTO que el operador eligió (productId de TCGplayer).
//   sealedImageUrl? + sealedProductName? = imagen/nombre del producto sellado desde la API (TCGCSV). El backend los
//     VALIDA contra el host allowlist de imágenes TCGplayer/TCGCSV antes de persistir (anti stored-XSS/URL arbitraria);
//     inválidos/omitidos ⇒ null (fallback a la Card ancla). Display-only, money-safe (jamás fijan precio). Deltas M-37.
// v1.39 (P-38): `sealedProductId?` (solo sealed) = IDENTIDAD del sellado (FK → SealedProduct). RECOMENDADO — sustituye
//   a los 4 campos M-37 sueltos, que quedan DEPRECADOS (aceptados en transición). Presente ⇒ el backend DERIVA
//   server-side `cardId` (ancla del set), tcgplayerProductId/GroupId, sealedImageUrl/sealedProductName y sealedSubtype
//   DESDE el SealedProduct (el cliente NO manda identidad ni montos) y congela el SNAPSHOT ⇒ la pieza nace con identidad
//   correcta («ETB …», no la Tropius). Inexistente/inactivo → 422 SEALED_PRODUCT_NOT_FOUND. Si viene sealedProductId,
//   los 4 campos sueltos se IGNORAN (mandan los derivados). `cardId` pasa a OPCIONAL: REQUERIDO para raw/graded y para
//   sealed SIN `sealedProductId` (transición P-35); con `sealedProductId` el backend lo DERIVA (ancla del set) y el
//   cliente puede omitirlo. Ausente donde se requiere → 422 VALIDATION_ERROR.
// v1.39 (P-38) + v1.39.1: `manualMarketMxnCents?` (solo sealed, FALLBACK MANUAL money-safe) = mercado en MXN centavos
//   aceptado SOLO cuando el precio EN VIVO (TCGCSV al alta) y la caché son null; `> 0` (≤0 → 422 VALIDATION_ERROR);
//   AUDITADO (persiste PriceReference isManualOverride=true). **PERMISO (v1.39.1, decisión del humano): `vault_operator+`**
//   (NO restringido a super_admin — el operador de bóveda opera el alta). Con mercado YA resuelto (no hay hueco que
//   llenar) → 422 MANUAL_MARKET_NOT_ALLOWED (el override manual solo aplica al hueco de precio, JAMÁS pisa un mercado
//   vivo). Sin override y sin mercado ⇒ 422 PRICE_PENDING (NUNCA se inventa 0). ⚠ Input de dinero por vault_operator →
//   MARCADO para revisión de la fase de seguridad (pentester + seguridad) por release.
BatchInventoryItemInput = { cardId?: string, productType: ProductType, rawCondition?: RawCondition, finish?: Finish,
                            sealedSubtype?: SealedSubtype, sealedCondition?: SealedCondition, // v1.23: default mint (solo sealed)
                            gradingCompany?: GradingCompany, gradeValue?: string,
                            certNumber?: string, locationId?: string, acquisitionType: AcquisitionType,
                            acquisitionPct?: number, listPriceCents?: number, qty?: number,
                            sealedProductId?: string,                            // v1.39 (P-38) — IDENTIDAD (recomendado)
                            manualMarketMxnCents?: number,                       // v1.39 (P-38) — fallback manual (vault_operator+)
                            tcgplayerProductId?: number, tcgplayerGroupId?: number,  // v1.36 (P-35) — DEPRECADO si hay sealedProductId
                            sealedImageUrl?: string, sealedProductName?: string }     // v1.36 (P-35) — DEPRECADO si hay sealedProductId
BatchCreateInventoryRequest = { batchKey: string, items: BatchInventoryItemInput[] }   // cap items = 200
// Resultado por línea: ok:true crea qty piezas (devuelve sus folios); ok:false trae el error de ESA línea
// (NO tumba las demás → HTTP 200). `index` = posición 0-based en items[].
BatchInventoryLineResult =
    | { index: number, ok: true, folios: string[], inventoryItemIds: string[], acquisitionCostCents?: number }
    | { index: number, ok: false, error: { code: string, message: string } }
// `idempotentReplay` = true si el batchKey ya se había procesado (se REPITE el resultado guardado; no re-crea).
BatchCreateInventoryResponse = { batchKey: string, idempotentReplay: boolean,
                                 summary: { requested: number, createdItems: number, failedLines: number },
                                 results: BatchInventoryLineResult[] }
// ----- Publicar por LOTE (POST /admin/inventory/items/bulk-publish) -----
// `listPriceCents` omitido → precio DERIVADO server-side de las reglas de venta por rareza+acabado (§4.14, SEC-A1);
// presente → override manual. Una pieza cuyo precio no se resuelve (pct sin market) NO se publica (PRICE_PENDING).
// v1.16.1 — STATUS DE ORIGEN PUBLICABLE = { in_stock, listed }: in_stock → publica (→ listed); listed → NO-OP
//   idempotente (ok:true, no re-cobra ni duplica); cualquier otro status (reserved | in_custody | picking | shipped |
//   delivered | lost | damaged | withdrawn) → 422 ITEM_NOT_PUBLISHABLE por-línea (anti double-sell: una pieza
//   reservada/vendida/en-custodia/enviada no se re-lista). Distinto de PRICE_PENDING (precio no resuelto).
// v1.26 (④, §M1): una línea sin precio resoluble ESCALA a la cola de pendientes (context='inventory') y NO publica
//   (antes se caía en silencio). Mismo error PRICE_PENDING. `pendingPriceEntryId?` = id de la PendingPriceEntry
//   escalada (ADITIVO/opcional; para deep-link de UI a M2; ausente si el backend no lo devuelve).
// v1.26 (P-7, §M1): `repriceFresh?` en el request refresca la PriceReference con un fetch on-demand por carta ANTES de
//   resolver precio (sobre inventario UNPUBLISHED); hereda el gate ④ (sin precio tras refresh → escala pendiente, no
//   publica). Money-touching → gate de seguridad posterior; respeta la cuota diaria del proveedor.
BulkPublishLineInput = { inventoryItemId: string, listPriceCents?: number }
BulkPublishRequest = { batchKey?: string, items: BulkPublishLineInput[], repriceFresh?: boolean }   // cap items = 200
BulkPublishLineResult =
    | { index: number, inventoryItemId: string, ok: true, status: "listed", salePriceCents: number, priceSource: "manual" | "derived" }
    | { index: number, inventoryItemId: string, ok: false, error: { code: string, message: string }, pendingPriceEntryId?: string }
BulkPublishResponse = { summary: { requested: number, published: number, failedLines: number }, results: BulkPublishLineResult[] }
// ----- Baja rápida por CANTIDAD (POST /admin/inventory/items/bulk-remove) — P-29, §M1 -----
// Da de baja N piezas de un (cardId, finish[, condición]) seleccionadas server-side (in_stock antes que listed;
// FIFO por createdAt; take = quantity). `note` es OBLIGATORIA (@IsString() note!: string; sin ella → 400). Motivo →
// status: perdida→lost · danada→damaged · error_captura→withdrawn (NO acepta `encontrada`). Atómico: menos piezas
// ajustables que quantity → 422 INSUFFICIENT_STOCK y NO baja ninguna. Money-safe: solo transiciona status.
// `batchKey?` (v1.35): MISMA idempotencia que adjustFound/publish-all (InventoryBatch M-21, kind='bulk_remove').
// Mismo batchKey tras un reintento → NO re-baja; el replay devuelve la respuesta original guardada con
// idempotentReplay:true (mismo 200). Sin batchKey → idempotentReplay:false. Cierra el «encogimiento fantasma».
BulkRemoveRequest = { cardId: string, finish: Finish, quantity: number /* int 1..500 (MAX_BATCH_QTY) */,
                      reason: "perdida" | "danada" | "error_captura", note: string /* REQUERIDO, no-vacío */,
                      batchKey?: string,
                      productType?: ProductType, rawCondition?: RawCondition, sealedCondition?: SealedCondition }
BulkRemoveResponse = { batchKey?: string, idempotentReplay: boolean, removed: number, requested: number,
                       reason: AdjustmentReason, toStatus: InventoryStatus, inventoryItemIds: string[],
                       folios: string[], adjustmentIds: string[] }   // arrays alineados 1:1
// Desglose del checkout. base = subtotal + iva se recibe íntegro; el fee es gross-up de la comisión Stripe.
// "SIN IVA" = el fee NO agrega una línea de IVA de PRODUCTO (no se vuelve a gravar la venta). Internamente
// el gross-up SÍ cubre el IVA que Stripe MX cobra sobre SU comisión (derivado de ivaPct/100 — v1.40, ver ARCHITECTURE §5.1).
// ivaCents grava subtotal (compras) o envío (retiros). totalCents = subtotal + ivaCents + processingFeeCents.
// v1.21-guest-checkout — `shippingFeeCents?` (ADITIVO, opcional): SOLO presente en un pedido
// `fulfillmentMode='direct_ship'` (hoy = pedido de invitado, §4-G), donde el envío se cobra en el MISMO
// PaymentIntent que las cartas. Ausente (u omitido) en compras a bóveda y en retiros — en esos dos casos
// el shape y las fórmulas de v1.20 NO cambian. Con `shippingFeeCents` presente:
//   subtotalCents      = Σ precio de venta de las cartas (SIN envío, SIN IVA)
//   ivaCents           = round((subtotalCents + shippingFeeCents) × ivaRatePct/100)   // el envío SÍ causa IVA
//   totalCents         = subtotalCents + shippingFeeCents + ivaCents + processingFeeCents
//   processingFeeCents = gross-up Stripe sobre base = subtotal + envío + IVA (misma función grossUpTotal)
// OJO — asimetría deliberada con el retiro (§5), donde `subtotalCents` ES la tarifa de envío: aquí el envío
// va en su PROPIA línea porque el pedido lleva cartas y envío juntos. El front debe leer `shippingFeeCents`
// como línea aparte y NO restarla del subtotal.
BreakdownDTO = { subtotalCents, ivaCents, ivaRatePct, processingFeeCents, totalCents, currency: "MXN",
                 shippingFeeCents?: number }
// v1.21.4-dual-breakdown (§4-G.1, N-12) — el QUOTE de invitado (`POST /checkout/guest/quote`) devuelve DOS
// desgloses en el mismo `200`: `breakdown` (CON `shippingFeeCents` = envío directo, lo que se cobra) y
// `vaultBreakdown` (SIN `shippingFeeCents` = destino bóveda, informativo/reactivo). `vaultBreakdown` es
// EXACTAMENTE computeCartBreakdown(subtotal, ivaRatePct, fee): IVA solo sobre cartas, gross-up sobre la base
// menor, sin línea de envío. Ambos usan el MISMO subtotalCents (Σ cartas válidas tras dedupe+poda). Es SOLO
// del quote: `POST /checkout/guest/session` (§4-G.2) sigue devolviendo UN solo `breakdown` (direct_ship, lo
// que se cobra), porque el invitado solo puede PAGAR envío directo (bóveda → 422 VAULT_REQUIRES_ACCOUNT).
// v1.21.3-quote-prune — ítem de carrito podado por los DOS endpoints de QUOTE (§4 y §4-G.1). SOLO quote:
// los endpoints de session NO lo usan (siguen estrictos). `cardName` = nombre de la carta si la pieza aún
// existe en BD (aunque ya no esté disponible); null si el `inventoryItemId` ya no resuelve (pieza borrada).
// El front lo usa para el aviso «X ya no está disponible y se quitó de tu carrito» y para PODAR el
// localStorage antes de llamar a session.
UnavailableCartItemDTO = { inventoryItemId: string, cardName: string | null }
// ===== v1.23-sealed-sales: sellado / producto cerrado =====
// ListingDTO GANA `sealedCondition?` (ADITIVO): presente SOLO en productType='sealed' (mint|minor_box_damage);
// omitido en raw/graded. Para sellado, `referenceValue` = valor de mercado TCGCSV (sealedMarketRef, §4.19) y
// `salePriceCents` = override o mercado×spread (ARCHITECTURE §4.23b). Ningún otro campo de ListingDTO cambia.
ListingDTO += { sealedCondition?: SealedCondition }
// Tarjeta AGREGADA del grid público de sellado (GET /catalog/sealed): agrupa piezas idénticas (mismo producto TCGCSV
// + misma condición) → "N disponibles". `representativeItemId` = la pieza disponible MÁS BARATA (add-to-cart / key de
// la ficha). `imageUrl` = imagen TCGCSV si el producto está mapeado, si no la de catálogo de la Card. `fromPriceCents`
// = mínimo salePriceCents del grupo. `referenceValue` = valor de mercado TCGCSV (informativo; puede ser pending si el
// grupo se vende solo por override). Todos los grupos devueltos tienen ≥1 pieza vendible.
// v2.0 (P-48): el sellado NO cambia de matemática (conserva su spread por presentación, §K/§4.23a — su precio antes y
// después es IDÉNTICO). Solo gana `priceBasis` DERIVADO de `priceSource`, para que el front tenga UNA sola regla de
// visibilidad para las dos fichas, sin ramas por tipo de producto:
//     priceSource="override"                          ⇒ priceBasis="override"  ⇒ NO se muestra «Valor de mercado»
//     priceSource="subtype_spread" | "global_spread"  ⇒ priceBasis="market"    ⇒ SÍ se muestra
//     sin precio (no se publica, PRICE_PENDING)        ⇒ priceBasis="pending"
// `priceSource` se CONSERVA (detalle propio del sellado: qué spread aplicó).
// **v2.1.9 (D2):** este DTO es el de la FICHA (`SealedGroupDetailResponse.group`). `referenceValue` sigue requerido,
// con su `referenceMxnCents`/`capturedDate` presentes si y solo si `priceBasis === "market"` (el `iff` de ListingDTO).
// La REJILLA ya NO usa este DTO: usa `SealedGroupSummaryDTO`.
SealedGroupDTO = { representativeItemId: string, card: CardDTO, productName: string, imageUrl: string | null,
                   sealedSubtype: SealedSubtype | null, sealedCondition: SealedCondition,
                   availableCount: number, fromPriceCents: number, priceSource: SealedSpreadSource,
                   priceBasis: PriceBasis, referenceValue: PriceInfo, currency: "MXN" }
// ===== v2.1.9 (D2) — el DTO de la REJILLA de sellado: `SealedGroupDTO` MENOS las tres señales de precio =====
// Se van `priceBasis`, `referenceValue` y **también `priceSource`**: en sellado `priceSource` es de donde `priceBasis`
// se DERIVA (`override ⇒ override`; `*_spread ⇒ market`), así que dejarlo publicaría la misma señal por otro nombre —
// el mismo error que v2.1.6 documentó al retirar `isManualOverride` y descubrir que `source` filtraba igual. Misma
// razón y mismas garantías que `GroupedListingSummaryDTO` (ver su bloque): §N.7 «SOLO fichas», nadie lo consume en la
// rejilla, y TIPO PROPIO en vez de campos opcionales para que el compilador —y no un test— sostenga la diferencia.
SealedGroupSummaryDTO = { representativeItemId: string, card: CardDTO, productName: string, imageUrl: string | null,
                          sealedSubtype: SealedSubtype | null, sealedCondition: SealedCondition,
                          availableCount: number, fromPriceCents: number, currency: "MXN" }
SealedGroupListResponse = { data: SealedGroupSummaryDTO[], page: number, pageSize: number, total: number }
// Ficha del sellado (GET /catalog/sealed/:inventoryItemId): el grupo + TODAS las piezas disponibles del mismo grupo
// (cada una un ListingDTO, más baratas primero) para que el comprador elija cantidad (carrito por-pieza). `trendEnabled`
// / `restockEnabled` reflejan los feature-flags (§M10) para que el front decida si mostrar la tendencia / el CTA de aviso.
SealedGroupDetailResponse = { group: SealedGroupDTO, listings: ListingDTO[],
                              trendEnabled: boolean, restockEnabled: boolean }
// Grupo de la pestaña "Sellado" de la bóveda (GET /vault/sealed y admin). `count` = piezas del usuario en bóveda de
// ese grupo; `ownership` = desglose por titularidad. `marketValue` = valor de mercado ACTUAL por pieza (sealedMarketRef);
// `totalMarketValueMxnCents` = count × referenceMxnCents (null si el mercado está pending). Valuación = misma base del
// portafolio (§3): piezas sin mercado se EXCLUYEN del total y cuentan en pendingPriceCount de la respuesta.
VaultSealedGroupDTO = { card: CardDTO, productName: string, imageUrl: string | null,
                        sealedSubtype: SealedSubtype | null, sealedCondition: SealedCondition,
                        count: number, ownership: { pending: number, settled: number },
                        marketValue: PriceInfo, totalMarketValueMxnCents: number | null }
VaultSealedResponse = { data: VaultSealedGroupDTO[], totalValueMxnCents: number, pendingPriceCount: number,
                        currency: "MXN", owner?: VaultOwnerRefDTO }
// Spreads de venta del sellado (GET/PUT /admin/pricing/sealed-spreads). `spreadPctBySubtype` = markup % ARRIBA de
// mercado por presentación; `fallbackPct` = spread global de respaldo (sin subtype o subtype sin regla). Semántica de
// pct = markup sobre mercado (como ventas §4.14, NO "% de la referencia" del buylist). Rango [0, 1000].
SealedSpreadsDTO = { spreadPctBySubtype: { [subtype in SealedSubtype]?: number }, fallbackPct: number }
// v2.1.9 — REQUEST del PUT (distinto del DTO de respuesta, y la diferencia es el punto): los valores admiten `null`
// como sentinel de RETIRO («quita la regla propia de esta presentación; usa `fallbackPct`»). Semántica PARCIAL:
//   llave ausente  ⇒ no se toca      ·  llave con número ⇒ se fija  ·  llave con null ⇒ SE RETIRA (el GET la omite)
// ⚠️ `null` ≠ `0`: `0` es un spread legítimo (vender AL mercado, sin markup, §SUP-8). Un campo VACIADO en la pantalla
// viaja como `null`, JAMÁS como `0`. `fallbackPct: null` ⇒ 422 (el global es el respaldo; no se retira). Razón,
// alternativas descartadas y precedente (`mapping` con `tcgplayerProductId: null`) en §M2.
SealedSpreadsUpdateRequest = { spreadPctBySubtype?: { [subtype in SealedSubtype]?: number | null },
                               fallbackPct?: number }
// ===== v1.36 (P-35): alta dedicada de sellado — listar productos sellados de un set desde la API =====
// Un producto SELLADO del catálogo TCGCSV de un set (ETB / booster box / bundle / tin / blister), NO un single.
// `tcgplayerProductId` = clave de emparejamiento TCGplayer (== la que el alta reenvía al batch). `sealedSubtype` =
// INFERIDO por heurística de nombre (null si no se pudo inferir → el operador lo elige en el alta). `imageUrl` =
// imagen del producto DESDE LA API (TCGCSV/TCGplayer); null si el producto no trae imagen. `marketRef` = valor de
// mercado INFORMATIVO (USD→MXN con FX+colchón) leído del precio TCGCSV del producto; MONEY-SAFE: sin precio en la
// fuente ⇒ marketRef=null (pendiente / "—"), NUNCA 0. NO fija venta ni costo (eso se deriva al alta/publish, §M1).
SealedCatalogProductDTO = { tcgplayerProductId: number, name: string, cleanName?: string,
                            sealedSubtype: SealedSubtype | null, imageUrl: string | null,
                            marketRef: PriceInfo | null }
// Respuesta de GET /admin/inventory/sealed-catalog. `set` = el set consultado; `tcgcsvGroupId` = grupo resuelto
// (null si no se pudo resolver); `groupResolved=false` ⇒ data:[] y el front ofrece fijar el grupo (mapear un item o
// setear CardSet.tcgcsvGroupId). `anchorCardId` = Card REPRESENTATIVA del set (menor (numberPrefix, numberSort);
// §4.32b) que el alta reenvía como `cardId` — el operador NUNCA elige un single como ancla del sellado.
SealedCatalogResponse = { set: SetRefDTO, tcgcsvGroupId: number | null, groupResolved: boolean,
                          anchorCardId: string, data: SealedCatalogProductDTO[] }
// ===== v1.39 (P-38): módulo de PRODUCTO SELLADO robusto — entidad SealedProduct persistida =====
// enum SealedSubtype gana `upc` (Ultra Premium Collection) y `collection` (colecciones/cajas especiales).
// SealedGroupKind = tipo de grupo TCGCSV asociado a un set: `set_main` (grupo principal, booster box/ETB/bundle…) |
//   `promo_collection` (grupo APARTE de promo/colección — blísters/tins/colecciones promo, incl. Mega Evolution). Un
//   set tiene 1 set_main + N promo_collection (§4.34b).
SealedGroupKind = "set_main" | "promo_collection"
// Presentación sellada REAL de un set, con IDENTIDAD PROPIA (NO anclada a un single). `tcgplayerProductId` = clave de
// identidad (== productId TCGplayer; == clave de precio sealed:tcg:<productId>). `subtype` incl. `upc`; `subtypeInferred`
// = true si se infirió por nombre, false si un humano lo curó. `subtype` es SIEMPRE no-null (schema NOT NULL): un sellado
// sin match de `inferSealedSubtype` cae al bucket `collection` con `subtypeInferred=true` (secundario, sortOrder=6, no
// principal) — ver ARCHITECTURE §4.34c paso 8 (H-P38-3). `isPrincipal` = presentación «cabecera» (§4.34c).
// `origin` = de qué tipo de grupo provino. `imageUrl` = imagen de la API (null si no trae).
// v1.41 (IMP-1) — DOS valores de mercado, NO intercambiables (money-safe):
//   * `marketRef` = referencia INFORMATIVA (live TCGCSV → caché → null); NO gateada por el dial `sealedPriceSource`.
//     Solo decoración/sugerencia; sin precio ⇒ null (pendiente/"—"), NUNCA 0. **NO decide UI ni promete valor de registro.**
//   * `effectiveMarketCents` = mercado AUTORITATIVO, YA gateado por `sealedPriceSource` (resolver H-1 §4.23), MXN centavos.
//     Es EXACTAMENTE el valor con que el backend valuará esta línea en el alta: `null` ⟺ el backend está en PRICE_PENDING
//     (dial `off`, sin mapeo, o sin precio en la fuente gateada) ⟺ el backend ACEPTA `manualMarketMxnCents`.
//     **El front keyea la visibilidad del campo de precio manual y el copy «valor de mercado» en ESTE campo, jamás en
//     `marketRef`/caché.** Sin precio efectivo ⇒ null (pendiente), NUNCA 0.
SealedProductDTO = { id: string, setId: string, tcgplayerProductId: number, tcgplayerGroupId: number,
                     name: string, cleanName?: string, subtype: SealedSubtype, subtypeInferred: boolean,
                     isPrincipal: boolean, origin: SealedGroupKind, imageUrl: string | null,
                     marketRef: PriceInfo | null,             // INFORMATIVO (ungated) — solo sugerencia
                     effectiveMarketCents: number | null }    // v1.41 (IMP-1): AUTORITATIVO, gateado por sealedPriceSource
// Enlace set → grupo TCGCSV (1 set → N grupos). `label` = nombre del grupo en TCGCSV (curación/observabilidad).
SealedSetGroupDTO = { id: string, setId: string, tcgplayerGroupId: number, kind: SealedGroupKind, label?: string }
// Respuesta de GET /admin/inventory/sealed-products. `data` ordenado (principales primero: isPrincipal desc, sortOrder
// asc, name asc; §4.34c). `groups` = grupos TCGCSV conocidos del set. `needsSync=true` ⇒ catálogo vacío (el front ofrece
// «Sincronizar»). Los productos son los PERSISTIDOS (active=true) — NO una descarga en vivo (esa la hace el sync).
// v1.41 (IMP-1): `sealedPriceSource` = estado del dial (§M10) que gatea `effectiveMarketCents`; el front lo usa para el
// copy («off» ⇒ «la fuente de precio de sellado está apagada; captura el valor»). Una vez por respuesta, no por producto.
SealedProductListResponse = { set: SetRefDTO, needsSync: boolean, groups: SealedSetGroupDTO[],
                              sealedPriceSource: SealedPriceSource, data: SealedProductDTO[] }
// Grupo TCGCSV candidato por name-match (GET .../sync/candidates). `alreadyLinked` = ya está en SealedSetGroup del set.
// `matchScore` = confianza de la coincidencia nombre+año (0..1, orientativo para la UI de curación).
TcgcsvGroupCandidateDTO = { tcgplayerGroupId: number, name: string, publishedOn?: string,
                            alreadyLinked: boolean, matchScore: number }
SealedSyncCandidatesResponse = { set: SetRefDTO, candidates: TcgcsvGroupCandidateDTO[] }
// Req de POST /admin/inventory/sealed-products/sync. Uno de: `setId` (un set) | `all:true` (todos). `groupIds?` = grupos
// extra a enlazar+sincronizar (promo/colección) además de los ya conocidos del set.
SealedSyncRequest = { setId?: string, groupIds?: number[], all?: boolean }
// Resultado del sync (money-safe: nunca fabrica precio, nunca toca inventario). `pricedCount` = productos con marketUsdCents
// no-null; `pendingPriceCount` = sin precio en la fuente (null, honesto). `groupsPopulated` = groupIds nuevos escritos.
SealedSyncResultDTO = { setsSynced: number, groupsPopulated: number, productsUpserted: number,
                        productsDeactivated: number, pricedCount: number, pendingPriceCount: number }
// Req de POST /admin/inventory/sealed-sets/:setId/groups — enlaza un grupo extra (promo/colección) al set.
SealedSetGroupLinkRequest = { tcgplayerGroupId: number, kind: SealedGroupKind }
```

---

## 1. Auth y usuarios

### POST /api/v1/auth/register — `public`
Req: `{ email, password, name, phone, locale? }`
Res `201`: `{ user: { id, email, name, role, locale, emailVerified }, accessToken, refreshToken }`
Err: `409 EMAIL_TAKEN`, `400 VALIDATION_ERROR`.
> **v1.5:** al registrar (email/password) el usuario nace con `emailVerified=false`; el backend **emite un token
> de verificación (`AuthToken`, 24h)** y **envía el correo** (Resend). El registro **no** falla si el envío del
> correo falla (se registra el error; el usuario puede pedir reenvío). El `user` de la respuesta incluye ahora
> `emailVerified` (siempre `false` recién registrado). El usuario **puede iniciar sesión y navegar** sin verificar,
> pero las acciones sensibles quedan bloqueadas hasta verificar (ver `403 EMAIL_NOT_VERIFIED`).

### POST /api/v1/auth/login — `public`
Req: `{ email, password }` → Res `200`: `{ user, accessToken, refreshToken }`. Err: `401 INVALID_CREDENTIALS`, `403 USER_BLOCKED`.
Nota: una cuenta creada solo con Google tiene `passwordHash=null`; este endpoint la rechaza con `401 INVALID_CREDENTIALS` (no revela que es cuenta Google) hasta que el usuario fije contraseña.
> **v1.5:** el login **NO** exige `emailVerified` (un usuario sin verificar sí puede entrar y navegar). El objeto
> `user` incluye `emailVerified` para que el front decida el banner. `403 USER_BLOCKED` sigue aplicando a
> cuentas `blocked`/`deleted`; `emailVerified=false` **no** es motivo de rechazo de login.

### POST /api/v1/auth/google — `public`  (v1.1)
Login/registro con **ID token de Google** (Google Identity Services en el front con `NEXT_PUBLIC_GOOGLE_CLIENT_ID`). El backend **verifica el ID token server-side** (firma JWKS, `aud=GOOGLE_CLIENT_ID`, `iss` de Google, `exp`, `email_verified=true`) antes de emitir sus JWT. El `role` se asigna **server-side** (siempre `customer` para altas nuevas); **nunca** se lee del token.
Req: `{ idToken: string }`
Res `200`: `{ user, accessToken, refreshToken }` — **mismo shape que `/auth/login`**.
Comportamiento: busca por `googleId`; si no, enlaza por **email verificado** a una cuenta `local` existente (account-linking); si no existe, crea `User` (`authProvider=google`, `emailVerified=true`, `passwordHash=null`, `role=customer`).
Err:
- `401 GOOGLE_TOKEN_INVALID` (firma/`aud`/`iss`/`exp` inválidos)
- `403 GOOGLE_EMAIL_UNVERIFIED` (`email_verified != true` en el token → no se crea ni enlaza)
- `403 USER_BLOCKED` (cuenta existente bloqueada)
Nota: el login Google **no exime KYC** — la buylist sigue exigiendo CLABE/INE a nombre del usuario (§6/M6).

### POST /api/v1/auth/refresh — `public` (con refresh token)
Req: `{ refreshToken }` → Res `200`: `{ accessToken, refreshToken }`. Err: `401`.

### POST /api/v1/auth/logout — `customer+`
Res `204`.

### Verificación de correo (v1.5)
Bloquea **acciones sensibles**, no el login. El correo lo envía Resend; el link apunta al frontend
(`${APP_BASE_URL}/<locale>/verify-email?token=<claro>`). Token de un solo uso, 24h (`AuthToken`, ARCHITECTURE §4.11).

#### POST /api/v1/auth/verify-email/resend — `customer+`
Reenvía el correo de verificación al **email de la sesión** (usa `req.user`; **sin body** → cero enumeración).
Rota los tokens de verificación previos y emite uno nuevo (24h). Rate-limit **3/hora por usuario** (+ IP).
Req: `{}` → Res `200`: `{ ok: true }`.
- Si el usuario **ya está verificado** → `200 { ok: true }` no-op (no reenvía).
- Rate-limit excedido → `429 RATE_LIMITED`.

#### POST /api/v1/auth/verify-email — `public`
Consume el token del link (se abre desde el correo, quizá sin sesión). Marca `User.emailVerified=true` y el token
como usado. **No** altera `tokenVersion` (verificar no revoca sesiones). Rate-limit **10/min por IP**.
Req: `{ token: string }` → Res `200`: `{ verified: true }`.
Err: `422 EMAIL_VERIFY_TOKEN_INVALID` (inválido / expirado / ya usado — no se distingue el motivo).
- Idempotencia: si el `User` del token ya está verificado, responde `200 { verified: true }` aunque el token ya
  esté usado (tolera doble clic).

### Recuperación de contraseña — self-service (v1.5)
Complementa el reset por admin de M6 (`POST /admin/users/:id/reset-password`, §M6), que **se conserva**. Ambos
flujos **incrementan `User.tokenVersion`** (revocan sesiones). Token de un solo uso, 1h.

#### POST /api/v1/auth/forgot-password — `public`
Solicita el link de restablecimiento. **SIEMPRE responde `200`** exista o no el email (**anti-enumeración**).
Si el email existe, emite `AuthToken(password_reset, 1h)`, rota tokens de reset previos y envía el correo
(`${APP_BASE_URL}/<locale>/reset-password?token=<claro>`). Rate-limit **3/hora por IP** (+ tope por email en servicio).
Req: `{ email: string }` → Res `200`: `{ ok: true }` (genérico; nunca revela existencia).
- Cuenta solo-Google (sin `passwordHash`): el flujo **fija** una contraseña (habilita login local, igual que el
  reset admin). No cambia la respuesta genérica.
- Rate-limit excedido → `429 RATE_LIMITED`.

#### POST /api/v1/auth/reset-password — `public`
Consume el token de reset y fija la nueva contraseña. Setea `passwordHash` (argon2), **incrementa
`User.tokenVersion`** (revoca sesiones vivas), marca el token como usado, limpia `mustChangePassword` si estaba, y
setea `emailVerified=true` *(el clic prueba control del inbox; decisión a confirmar, ARCHITECTURE §10 v1.5-3)*.
**No** devuelve tokens: el usuario **re-inicia sesión** con la nueva contraseña. Rate-limit **10/min por IP**.
Req: `{ token: string, password: string }` (password `MinLength 8`, misma política que register) → Res `200`: `{ ok: true }`.
Err: `422 RESET_TOKEN_INVALID` (inválido / expirado / ya usado), `400 VALIDATION_ERROR` (contraseña débil).

### GET /api/v1/users/me — `customer+`
Res `200`: `{ id, email, name, phone, role, locale, kycStatus, status, authProvider, emailVerified, avatarUrl? }`.
(`authProvider`/`emailVerified`/`avatarUrl` añadidos en v1.1; el front puede ocultar "cambiar contraseña" cuando `authProvider=google` y aún no hay contraseña.)

### PATCH /api/v1/users/me — `customer+`
Req: `{ name?, phone?, locale? }` → Res `200`: user.

### Direcciones (envío, solo MX)
- `GET /api/v1/users/me/addresses` — `customer` → `{ data: AddressDTO[] }`
- `POST /api/v1/users/me/addresses` — `customer` — Req: `{ line1, line2?, neighborhood?, city, state, postalCode, country, phone, isDefault? }`. Err **`422 ADDRESS_NOT_MX`** si `country != "MX"`.
- `PATCH /api/v1/users/me/addresses/:id` — `customer`
- `DELETE /api/v1/users/me/addresses/:id` — `customer`

### Perfil de facturación (CFDI)
- `GET /api/v1/users/me/billing-profile` — `customer` → devuelve `rfcMasked` (RFC **enmascarado**, ej. `XAX**********`), no el RFC en claro. El resto de campos (razonSocial, regimenFiscal, usoCfdi, postalCode, email) van tal cual.
- `PUT /api/v1/users/me/billing-profile` — `customer` — Req: `{ rfc, razonSocial, regimenFiscal, usoCfdi, postalCode, email }` (el RFC se recibe en claro y se cifra en reposo; ver ARCHITECTURE §3.4).

### KYC (buylist)
- `GET /api/v1/users/me/kyc` — `customer` → `{ kycStatus, clabeMasked?, clabeOnFile: boolean, ineOnFile: boolean, capPerRequestCents, capPerMonthCents, monthUsedCents }`. La CLABE se devuelve **enmascarada** (`clabeMasked` = `****1234`); nunca en claro por este endpoint.
  - **`ineOnFile: boolean`** (ya existente) = hay imagen de INE (frente+reverso) en archivo. El front lo usa para **ocultar los uploaders de INE** y **omitir `ineUploadKeys`** en `POST /buylist/requests`; el backend ya trata el INE en archivo como "provisto" para el umbral AML (no re-pide INE si ya está).
  - **`clabeOnFile: boolean`** (**NUEVO v1.15**) = hay CLABE cifrada en archivo (`Boolean(KycProfile.clabeEnc)`). Booleano **limpio y simétrico** a `ineOnFile`. El front lo usa para ofrecer el atajo "usar mi CLABE ****1234" (= **omitir** `clabe` en `POST /buylist/requests`, resuelto server-side; ver §6) y, junto con `clabeMasked`, pintar el label. Si `clabeOnFile=false`, el front pide la CLABE.
- `PUT /api/v1/users/me/kyc` — `customer` — Req: `{ clabe?, ineFrontUploadKey?, ineBackUploadKey? }` (keys de presign). La CLABE se recibe en claro (18 dígitos), se **cifra en reposo** y debe ser **a nombre del propio usuario** (declarado). Err `422 CLABE_INVALID`.

---

## 2. Catálogo y precios

### GET /api/v1/catalog/cards — `public`  (sección "Compra")
Storefront **"Compra"**: lista **SOLO inventario publicado CON precio de venta fijado** (`status=listed`, `sellable=true`, `salePriceCents != null`). **Excluye** items `pending`/sin precio/"precio pendiente" — el comprador **nunca** ve "precio pendiente".
> **Cambio semántico v1.1:** en v1 podían mostrarse pendientes no comprables; en **v1.1 NO se listan**. La ruta **se mantiene** `/catalog/cards` (el rótulo de UI "Compra" lo controla el front); no se renombra para no romper el contrato (decisión en ARCHITECTURE §4.9).
Query: `?q=&setId=&rarity=&productType=&condition=&finish=&minPriceCents=&maxPriceCents=&sealedSubtype=&page=&pageSize=&sort=`
- `rarity`: valor **tal cual pokemontcg.io** (taxonomía abierta; usar los valores de `GET /catalog/facets`).
- `productType`: `raw | graded | sealed`. `condition`: para raw solo `NM`.
- `finish` (v1.6-finish, opcional): `normal | reverse_holo | holofoil | first_edition_holofoil`; filtra por `InventoryItem.finish`. Valor inválido → `400 VALIDATION_ERROR`.
- `setId` — **v1.33 (P-27):** si el `setId` es el **principal** de un master combinado (mapa
  `config/master-set-groups.ts`), el filtro **expande** a `setId IN partSetIds` (incluye el inventario publicado de
  todas las partes, p. ej. `cel25` + `cel25c`). ADITIVO: para un set normal el filtro es idéntico a hoy. Se respeta la
  **Regla de Compra**: agrupar **no** publica cartas sin precio (solo se listan las ya `sellable`). Money-safe: cada
  `ListingDTO` sigue llaveado a su `Card`/set real.
- `sort`: `price_asc | price_desc | newest` (opcional). Ordena por el **grupo**: `salePriceCents` del grupo; `newest` por la pieza más nueva del grupo (`createdAt` desc). **v1.44:** gana `grading_showcase` (ver abajo).
- **v1.38-grouped-listings (P-30):** el listado es **AGRUPADO por publicación única** `(carta, productType, gradeKey, finish)`, no una fila por copia física. `minPriceCents`/`maxPriceCents` filtran sobre el `salePriceCents` del grupo; los filtros `condition`/`finish`/`rarity`/`productType`/`setId` **no cambian de forma** (acotan las piezas que entran a cada grupo).
- **v1.50-graded-estimate (PROJECT §O.3, ADITIVO) — `?gradingHighlight=` y `?sort=grading_showcase`:** habilitan la
  **vitrina «Joyas para gradear» del home** SIN endpoint nuevo. La vitrina es, literalmente, «cartas elegibles con
  **su teja** y enlace a su ficha» (§O.3(3)) ⇒ es un **subconjunto ordenado de Compra**, con el **mismo**
  `GroupedListingSummaryDTO` y por tanto el **mismo componente de teja y la misma cifra** — un endpoint aparte
  duplicaría la ruta de composición y podría desincronizar la vitrina de Compra (justo lo que money-safe teme).
  Ver ARCHITECTURE §4.38(f).
  > **Este filtro es, además, la premisa del dictamen de la lista blanca (v1.50.2):** es un **enumerador público y
  > deliberado** del conjunto destacado, y por eso emitir `gradingHighlight` en la rejilla no crea capacidad nueva.
  > **Si algún día se retira este filtro, ese dictamen deja de aplicar** y hay que re-evaluar la emisión en la
  > rejilla. La dependencia es real, no retórica (ARCHITECTURE §4.38e).
  - **«Ver todas» de la vitrina — DECISIÓN v1.50.2 (arquitecto): SÍ al ENLACE, NO a la faceta. Sin cambio de
    contrato.** Frontend omitió el enlace porque no había a dónde apuntar sin mentir, e hizo bien en no inventarlo.
    **No hace falta contrato nuevo:** este filtro **ya es público y ya se acepta** aquí, así que Compra puede
    enlazarse a `?gradingHighlight=true` (con el `sort` normal de Compra, o con `sort=grading_showcase` si se quiere
    el mismo orden que la vitrina) y **filtra de verdad**. Lo que **NO** se hace es exponerlo como **faceta** —ni
    checkbox en el panel de filtros, ni entrada en `GET /catalog/facets`—, y la distinción importa:
    - un **enlace** es una **puerta de entrada a una promoción curada**, coherente con lo que el campo significa;
    - una **faceta** convertiría «esto lo estamos promoviendo» en un **eje permanente de navegación**, lo que (a)
      invita al comprador a leerlo como una **categoría de producto** («cartas para gradear») en vez de como una
      selección editorial nuestra, y (b) **acopla la política comercial a la IA de navegación**: cambiar
      `minUpsidePct` pasaría a cambiar la estructura del catálogo, no solo su contenido. El nombre neutro del sort
      (GU-A5) existe justo para evitar ese acoplamiento; añadir la faceta lo desharía.
    - **Regla de render del enlace (criterio 101, misma que la vitrina):** con `{ data: [], total: 0 }` —vitrina vacía
      o dial `off`— **no se pinta la vitrina NI su enlace**. Un «Ver todas» que lleva a una lista vacía es
      exactamente la mentira que frontend quiso evitar.
    - Si más adelante se quisiera la **faceta**, sí es decisión de producto + arquitecto (regla 9): cambia qué es
      esta superficie, no solo cómo se llega a ella.
  - `gradingHighlight` (opcional): **solo se acepta `true`**. Presente ⇒ devuelve **únicamente** los grupos que traen
    `gradingHighlight` (los que pasan el gate de ROI). Omitido ⇒ comportamiento idéntico a hoy (no filtra). Cualquier
    otro valor (`false`, `1`, `yes`) ⇒ `400 VALIDATION_ERROR` (fail-closed: un `false` «filtrando lo no destacado»
    sería una superficie comercial invertida que nadie pidió).
  - `sort=grading_showcase`: **el orden lo resuelve el SERVIDOR y el nombre es deliberadamente neutro** — no nombra el
    criterio, así que ajustarlo es un cambio server-side de **cero** impacto en contrato y cliente (mismo motivo por el
    que el DTO ya no publica el cálculo). Criterio **vigente (confirmado por el humano)**: **mayor GANANCIA NETA SOBRE
    PSA 9** desc — es decir `psa9MxnCents − (salePriceCents + gradingCost)`, el escenario **realista**, no el
    optimista. **Desempate determinista** (paginación estable): ganancia neta desc → estimado PSA 10 desc →
    `representativeInventoryItemId` asc. **Ninguno de esos números viaja al cliente.**
  - **`sort=grading_showcase` SIN `gradingHighlight=true` ⇒ `400 VALIDATION_ERROR` código
    `GRADING_SORT_REQUIRES_FILTER`.** Fail-closed: si se aceptara, los grupos **no destacados** irían a la cola del
    listado (con clave de orden indefinida) y la vitrina podría pintarlos al paginar.
  - **Tamaño de la vitrina** = `pageSize` (el front del home pide **8**, §O.3(3) SUPUESTO); el default del endpoint no
    cambia. **Cero cartas elegibles ⇒ `{ data: [], total: 0 }`, y ese `data: []` ES la señal normativa de «no renderizar
    la vitrina completa»** (criterio 101): sin encabezado, sin placeholder, sin «próximamente».
  - **Dial `gradedEstimatesEnabled=off` (§M10, seed `off`)** ⇒ ningún grupo trae `gradingHighlight` ⇒
    `?gradingHighlight=true` devuelve `{ data: [], total: 0 }` (no es error: es la feature apagada).
  - **Sin N+1 — coste MEDIDO:** el listado ya materializa, filtra y pagina **en memoria**; el gancho añade un coste
    **constante** de **+1 query con el dial `off`** (la lectura memoizada de config, que corta antes de tocar precios)
    y **+3 con el dial `on`** (1 de config + 1 del batch de estimados de los `cardId` distintos + 1 del batch de slabs
    publicados, INV-D §4.38l). **Nunca** una query por grupo ni por carta. Ver ARCHITECTURE §4.38(c).
Res `200` (**v2.1.9, `GroupedListingListResponse`**): `{ data: GroupedListingSummaryDTO[], page, pageSize, total }`. `total` = nº de **grupos** (publicaciones únicas), no de piezas. Cada grupo trae `stockCount≥1` (vivo), `salePriceCents` = mínimo/«desde» del grupo (el front rotula «desde» si `stockCount>1`, FE-2) y `representativeInventoryItemId` (add-to-cart de 1). Un grupo AGOTADO (`stockCount=0`) **no aparece** (money-safe: solo se lista lo publicado con precio y stock). *(Antes de v1.38: `{ data: ListingDTO[], … }`, un ítem por copia física — Tropius ×3 salía 3 veces. **Cambio de shape breaking, coordinado con el rediseño del storefront**.)*
- **⚠️ v2.1.9 (D2) — CAMBIO DE SHAPE: la rejilla pasa de `GroupedListingDTO` a `GroupedListingSummaryDTO`**, que es el
  mismo objeto **sin `priceBasis` y sin `referenceValue`**. §N.7 dice literal «**SOLO fichas**»: aquí no se muestra
  valor de mercado hoy y **no va a mostrarse**, así que **nadie consume** ninguno de los dos — y un campo no consumido
  en una superficie pública **no se emite** (convención de DTOs cerrados: *publicar de más no rompe a nadie, filtra*).
  **Qué cierra:** la rejilla es la superficie de **cosecha masiva** (N filas por request, paginada); emitir `priceBasis`
  ahí publicaba un **mapa completo** de qué cartas llevan **override manual**, o sea dónde falló el feed y dónde el
  precio puede estar desalineado — la misma clase que v2.1.6 cerró con `isManualOverride`/`source`. En la **ficha**
  `priceBasis` **sigue siendo público y requerido**, y eso es deliberado: la UI lo **obedece** (§N.7 LOCKED). Lo que
  cambia entre las dos superficies no es el secreto: es la **economía de enumerarlo**.
  **Frontend:** es una **eliminación** de campos, así que TypeScript marca cualquier consumo que quedara vivo. Hoy
  `ListingCard` pasa `referenceValue` a `PriceTag` en `mode='sale'`, que **no lo pinta** (§21.8f ya retiró esa línea);
  el único uso real es la rama «precio pendiente», **inalcanzable aquí** (la rejilla solo lista lo que tiene precio).
- **v1.50.2 (ADITIVO sobre el DTO de D2):** cada grupo puede traer **`gradingHighlight?: GradedEstimateDTO[]`** —
  **presente ⇔ el gate de ROI sobre PSA 9 se cumple Y la cifra pasa el GATE DE CONFIANZA** (§DTOs base; ARCHITECTURE
  §4.38k). **Solo en grupos `productType:"raw"`.** Junto al precio, el front pinta la cifra de PSA 10 («en PSA 10 vale
  tanto») cuando está presente, y **la teja se ve exactamente como hoy** cuando no (criterio 100: **sin** badge vacío,
  tachado, en gris ni placeholder). La cifra DEBE llevar su **llamada al disclaimer** (asterisco/nota al pie, patrón
  que define **ux-ui** en `DESIGN_SYSTEM.md` **§22**) — renderizarla sin él es **defecto bloqueante** (criterio 103).
  - **Por qué este campo SÍ entra a la lista blanca de la rejilla y `priceBasis` no** (dictamen v1.50.2): D2 protege la
    **economía de enumerar** un mapa de defectos operativos, y ese argumento **solo se sostiene mientras no exista un
    enumerador público**; para `gradingHighlight` **existe y lo construimos a propósito** (`?gradingHighlight=true`,
    arriba), así que emitirlo por fila no crea capacidad nueva. Además `GradedEstimateDTO` **no transporta**
    `priceBasis`, `source` ni `isManualOverride` (ausencia estructural) y su presencia es **ortogonal** al `priceBasis`
    del raw. Razonamiento completo y **regla generalizada de admisión** en ARCHITECTURE §4.38(e).
  - *(Ojo: aquí el campo está **gateado**; el arreglo **ungated** de la ficha es otro campo, `gradedEstimates`, y vive
    en otra respuesta y en otro DTO. No se confunden — y desde v1.50.2 **el compilador los mantiene separados**.)*

### GET /api/v1/catalog/facets — `public`  (v1.1 — facetas dinámicas de "Compra")
Facetas calculadas **sobre el inventario publicado** (no sobre el catálogo completo), para poblar los filtros de Compra.
Res `200`:
```json
{
  "rarities": ["Illustration Rare", "Special Illustration Rare", "Common", "..."],
  "sets": [{ "id": "sv08", "name": "Surging Sparks", "releaseDate": "2024/11/08", "year": 2024 }],
  "productTypes": ["raw", "graded", "sealed"],
  "sealedSubtypes": ["box", "etb"],
  "finishes": ["normal", "reverse_holo", "holofoil"],
  "price": { "minCents": 5000, "maxCents": 4500000, "currency": "MXN" }
}
```
- `rarities`: `distinct` de `Card.rarity` sobre inventario publicado, **espejando pokemontcg.io tal cual** (lista **NO** cerrada).
- `sets`: `{ id, name, releaseDate, year }` con `year` **derivado** de `releaseDate`; solo sets con inventario publicado; **ordenados por año desc**. **v1.33 (P-27):** igual que `GET /catalog/sets`, un subset de un master combinado se **pliega** en su principal (Celebrations una vez) y la entrada gana `partSetIds?` (aditivo/opcional).
- `productTypes` / `sealedSubtypes`: subconjuntos presentes en el inventario publicado.
- `finishes` (v1.6-finish): `distinct` de `InventoryItem.finish` sobre el inventario publicado (subconjunto de `Finish`), para el filtro de acabado.

### GET /api/v1/catalog/cards/:cardId — `public`  (FICHA — aquí aplica la regla de visibilidad v2.0)
Res `200` (**v1.38-grouped-listings, `GroupedListingDetailResponse`**): `{ card: CardDTO, listings: GroupedListingDTO[], units: ListingDTO[] }` **(+ v1.50, ADITIVO: `gradedEstimates?: GradedEstimateDTO[]`)**.
- **`listings`** = las **publicaciones agrupadas** de esa carta (una por `(productType, gradeKey, finish)` con `stockCount≥1`, `salePriceCents` único). Es lo que el front pinta en la ficha. *(Antes de v1.38: `listings: ListingDTO[]` con una entrada por copia física.)*
- **`units`** = TODAS las piezas vendibles de la carta **por-pieza** (`ListingDTO[]`, cheapest-first) — SOLO para resolver el **add-to-cart por `inventoryItemId`** (el carrito sigue siendo por-pieza, §4-G) y para exponer el `certNumber` de cada slab en graded. No es la grilla de navegación. Espeja `SealedGroupDetailResponse.listings`.
- **Cambio breaking coordinado con el rediseño del storefront** (ver nota de coordinación en el Changelog v1.38 y ARCHITECTURE §4.9a).
- **⚠️ v2.0 (P-48) — REGLA DE VISIBILIDAD DEL «VALOR DE MERCADO» (contrato de UI, criterio 93).** En **esta ficha**, el
  bloque **«Valor de mercado»** se muestra **si y solo si `priceBasis === "market"`** del grupo/pieza que se está
  pintando. Con `"floor"`, `"override"` o `"pending"` el bloque **DESAPARECE**: ni en cero, ni tachado, ni atenuado,
  ni «—»; el precio de venta queda como el **único número** de esa zona.
  - **Por qué:** en zona de piso el mercado **no produjo** el precio, así que el número **no explica nada**. Mostrar
    «venta $25 / mercado $1.14» publica un **múltiplo de 22×** sin informar al comprador.
  - **Empate ⇒ se muestra:** si `piso == mercado × markup`, el backend emite `priceBasis="market"` (desempate fijado
    para que la regla sea determinista y verificable).
  - **PROHIBIDO inferir en el cliente** comparando `referenceValue` contra `salePriceCents`: la UI **obedece**
    `priceBasis`. **⚠️ v2.1.9 (D2) — corrección de la frase que seguía aquí** («`referenceValue` sigue viajando en el
    DTO… que viaje no autoriza a pintarlo»): **ya no viaja siempre**. En esta ficha el número de mercado
    (`referenceValue.referenceMxnCents` + `capturedDate`) se emite **si y solo si `priceBasis === "market"`**; con
    `floor`/`override`/`pending` el `PriceInfo` sale como `{ status }` a secas. **La regla se impone en el EMISOR**,
    no solo en el navegador — antes, un `curl` sin token devolvía el número que la UI tenía prohibido pintar.
    **Esto NO releva al front de obedecer `priceBasis`:** es defensa en profundidad, no permiso para inferir.
  - **Alcance: SOLO fichas.** `GET /catalog/cards` (tejas/listados) **no muestra** valor de mercado hoy y **no va a
    mostrarlo** — y desde **v2.1.9 tampoco lo recibe** (`GroupedListingSummaryDTO`, sin `priceBasis` ni
    `referenceValue`). **NO cambian** la **bóveda/portafolio del cliente** (ahí ve el valor de mercado de lo que **ya
    posee** — valuación y gráfica de tendencia **idénticas**) ni el **cotizador de buylist**.
  - El **precio cobrado NO cambia** por esta regla: es **presentación**, no dinero.
  - ⚠️ **v1.50.2 — `gradedEstimates` NO es «valor de mercado» y esta regla NO le aplica.** Es un estimado
    **informativo** sobre un producto que no tenemos (una carta gradeada), no la referencia de mercado de lo que se
    está vendiendo; se rige por su propio disclaimer y su propio gate. Confundirlos llevaría a ocultarlo cuando
    `priceBasis !== "market"`, que no es lo que nadie decidió.
- **v1.50-graded-estimate (ADITIVO) — los estimados por grado de la ficha (§O.3(1)):** la respuesta gana
  **`gradedEstimates?: GradedEstimateDTO[]`** en la **RAÍZ** (nivel **CARTA**: el estimado por grado es por carta y
  **no se cruza con el acabado** — ARCHITECTURE §4.38a).
  - **Contenido:** **PSA 10 y PSA 9**, mostrados **tal cual**, cada uno con su `referenceMxnCents` y su `capturedDate`
    (la «fecha del último refresco» de §O.3(1)). **Sin multiplicador, sin ganancia, sin comparativa** — el humano los
    retiró de la interfaz. Orden: **PSA 10 primero**.
  - **Regla de emisión — NO va gateada (decisión del humano):** se emite **siempre que haya dato fresco**, con
    independencia del gate de ROI. La ficha **informa** a quien ya está viendo esa carta; la teja y la vitrina
    **promueven**. Consecuencia deliberada y esperada: **una carta puede mostrar sus estimados en la ficha y NO estar
    destacada en Compra ni en el home**.
  - **Los grados son independientes:** un grado sin dato, con dato ≤ 0 o **rancio** simplemente **no aparece en el
    arreglo**. Una carta con PSA 10 y sin PSA 9 emite un arreglo de **un** elemento.
    **⚠️ v1.50.3 — «rancio» aplica también al override MANUAL** (`manualFreshnessDays`, **seed 30**, medido contra su
    **fecha de captura**; criterio 109). Hasta v1.50.2 el seed era `null` y una cifra fijada a mano **no caducaba
    jamás**, contra lo que dice `PROJECT.md`. Consecuencia observable para frontend y QA: **una carta cuyo único
    estimado es un override manual de más de 30 días deja de mostrar cifra** en la ficha, en la rejilla y en la
    vitrina. Si esa carta tiene además dato **automático fresco**, se muestra **el automático** (la frescura se
    aplica **antes** de elegir el ganador — ARCHITECTURE §4.38m). Refrescar un estimado manual = **recapturarlo**.
    *(A diferencia del **gate** de la teja/vitrina, que **exige los dos** — sin PSA 9 no hay promoción, criterio 98.)*
  - **Sin ningún grado ⇒ el campo se OMITE** (nunca `[]`): el front no pinta nada — ni contenedor, ni `—`, ni $0, ni
    «pendiente» (criterio 102).
  - **⛔ v1.50.2 — los `listings[i]` de esta respuesta NO traen `gradingHighlight`.** *(Este bullet decía lo contrario
    hasta v1.50.2 y queda **DEROGADO**.)* `gradingHighlight` vive **solo** en `GroupedListingSummaryDTO`
    (rejilla + vitrina); `GroupedListingDTO`, que es el DTO de **esta** ficha, **no lo lleva**. La ficha informa con
    `gradedEstimates` en su raíz, que es más rico (PSA 10 **y** 9) y no va gateado. Ver §DTOs base y ARCHITECTURE
    §4.38(e).
  - **Disclaimer COMPLETO obligatorio** en la ficha (criterio 103). **No viaja por la API**: es copy i18n del front, y
    el patrón de presentación (nota al pie con llamada junto a la cifra) lo define **ux-ui** en `DESIGN_SYSTEM.md`
    **§22**.
  - **`gradedEstimates` NUNCA aparece** para una carta sin grupos **raw publicados**, para una **gradeada**, para un
    **sellado** (§2-S), ni con el dial `gradedEstimatesEnabled=off` (§M10).
  - **v1.50.2 — el grado con SLAB PUBLICADO se OMITE** (INV-D, ARCHITECTURE §4.38l): si la carta tiene una pieza PSA 10
    publicada, su fila `graded:PSA:10` **es el precio de mercado real de esa pieza**, no un estimado, y esa pieza ya se
    lista con su propio precio. Los demás grados siguen apareciendo con normalidad.

### GET /api/v1/catalog/listings/:inventoryItemId — `public`
Res `200`: `ListingDTO`. Err `404` (incluye el caso de un item no publicado / sin precio: no es visible en Compra).
- **v1.38 (P-30):** **SIN cambio** — sigue devolviendo el `ListingDTO` **por pieza**. Lo consume el re-quote del carrito (v1.21.3, carrito = lista de `inventoryItemId`). La agrupación de P-30 vive SOLO en `GET /catalog/cards*` (navegación); la resolución por-pieza (carrito/checkout) es intacta.
- **v1.50-graded-estimate: SIN cambio, y es una decisión, no un olvido.** `ListingDTO` **NO** gana ningún campo del
  gancho: es una capa de **navegación/presentación**, no de compra. Meterlo en el DTO por-pieza lo pondría en la ruta
  del **carrito y el checkout** —donde no pinta nada y solo añadiría superficie a un camino de dinero— y obligaría a
  reevaluar el gate N veces por grupo sin ganar nada. El gancho vive **solo** en
  **`GroupedListingSummaryDTO.gradingHighlight`** (rejilla/vitrina, gateado) y en
  `GroupedListingDetailResponse.gradedEstimates` (ficha, sin gatear). *(v1.50.2 actualizó el primero de los dos: antes
  decía `GroupedListingDTO`.)*
- **v2.1.9 (D2) — aplica el mismo `iff` que la ficha, y `priceBasis` SE CONSERVA.** El número de mercado viaja **solo
  si `priceBasis === "market"`**. `priceBasis` **sí** sigue viajando aquí, y la razón es de **economía, no de secreto**:
  es una superficie de **detalle por pieza** (1 request = 1 carta, igual que la ficha), devuelve el **mismo
  `ListingDTO`** que `units[]`, y bifurcar el tipo aquí no cerraría nada que la ficha —donde `priceBasis` es público
  por decisión LOCKED de §N.7— no abra igual. Lo que se cierra es el **listado**, que es donde la señal se vuelve mapa.
  *(Este endpoint es el del PoC del pentester: `GET /catalog/listings/<id>` sin token devolvía `priceBasis:"override"`
  **+ `referenceValue`**. Lo que se retira es la mitad que la UI tenía prohibido pintar.)*

### GET /api/v1/catalog/sets — `public`
Res `200`: `{ data: [{ id, name, series, releaseDate, year }] }` (datos en inglés; `year` derivado de `releaseDate`, v1.1). Devuelve los sets con inventario publicado, ordenados por año desc.
- **v1.33 (P-27) — master set combinado:** un `setId` **subset** de un grupo (mapa `config/master-set-groups.ts`) se
  **pliega** en su **principal**: Celebrations aparece **una** sola vez (no dos entradas `cel25`/`cel25c`). La entrada
  combinada gana `partSetIds?: string[]` (los set-ids reales que agrupa) para que el front filtre por todas las partes.
  ADITIVO/opcional (los sets normales lo omiten). Solo presentación; el subset sigue siendo un `CardSet` real.

### GET /api/v1/catalog/featured-set/value-history — `public`  (v1.9-set-chart — gráfica del hero)
Serie temporal del **valor de mercado agregado del set destacado** (estilo acciones), para el hero de la home
dirigido a **visitantes anónimos**. El set destacado se resuelve **server-side** (env `HOME_FEATURED_SET_ID` +
fallback en cascada, ARCHITECTURE §4.12b) — el front **no** envía ni hardcodea id. Alimentada por el snapshot
diario `SetValueSnapshot` (jobs `set-price-sync` + `set-value-snapshot`, ARCHITECTURE §4.12c / §5).
Query: `?range=5d|15d|1m|3m|6m|1y|ytd|all` (default `1m`)
Res `200` (`SetValueHistoryResponse`):
```json
{
  "set": { "id": "…", "name": "Surging Sparks", "series": "Scarlet & Violet", "releaseDate": "2024/11/08" },
  "range": "1m",
  "points": [
    { "date": "2026-07-16", "valueMxnCents": 128450000, "pricedCardCount": 182 },
    { "date": "2026-08-15", "valueMxnCents": 131920000, "pricedCardCount": 184 }
  ],
  "change": { "absMxnCents": 3470000, "pct": 2.70, "direction": "up" }
}
```
- **`set`**: cabecera del set graficado (`SetRefDTO`; `id` = id **local** del `CardSet`). `null` si no hay ningún
  `CardSet` en el catálogo (el hero degrada sin error).
- **`points`**: un punto por día con snapshot en el rango (asc por fecha). `valueMxnCents` = SUM de la
  `PriceReference` vigente por carta del set (acabado `normal`, `raw`, `gradeKey='raw:NM'`); `pricedCardCount` =
  cuántas cartas del set tenían precio ese día. Las cartas sin precio **se excluyen** del total (no se inventan).
  Es "valor de las cartas **priceadas** del set", NO promesa de valor de set completo.
- **`change`**: variación entre el primer y último punto del rango; `direction ∈ up|down|flat`; `pct` con 2
  decimales, `null` si el valor inicial es 0.
- Si el set aún no tiene snapshots (recién sembrado / sin cartas priceadas), `points: []` y
  `change: { absMxnCents: 0, pct: null, direction: "flat" }`.
- **Público sin PII:** solo datos de catálogo (nombre/serie/fecha del set, en inglés) y valor agregado de mercado.
  No expone usuarios, bóveda, inventario ni costos.
Sin auth. (Rate-limit por IP + cache corto recomendado por ser hero de alto tráfico — ARCHITECTURE §4.12d.)

### GET /api/v1/catalog/sets/:id/value-history — `public`  (v1.9-set-chart)
Igual que el anterior pero para un **set específico** por su **id local** (`:id` = `CardSet.id`, no `externalId`).
Query y forma de respuesta **idénticas** (`SetValueHistoryResponse`), con `set` siempre no-null cuando el id
existe. Útil si en el futuro se grafica otro set fuera del destacado. Err `404 NOT_FOUND` si el `:id` no
existe. **Nota:** en el MVP solo el set destacado tiene jobs de captura corriendo; para otros sets la serie puede
venir vacía (`points: []`) hasta que se les active la captura diaria.

**Nota de precio pendiente (v1.1):** un item en "precio pendiente" (`referenceValue.status="pending"` y sin `salePriceCents` por override) **NO aparece en Compra** (`GET /catalog/cards` lo excluye) — el comprador nunca lo ve. *(v2.1.9: eso es el **criterio server-side** de exclusión, evaluado antes de proyectar; la rejilla ya no **emite** `referenceValue` —§DTOs `GroupedListingSummaryDTO`— y no lo necesita, precisamente porque todo lo que llega ahí tiene precio resuelto.)* El estado "precio pendiente" vive solo en adquisición/buylist/back-office (M2/M5). Si por carrera un item deja de ser vendible entre listar y comprar, el checkout lo bloquea con `422 PRICE_PENDING` / `409 ITEM_UNAVAILABLE`. El `salePriceCents` visible al cliente es el precio de venta (referencia × (1+markup) u override); `referenceValue` es el valor de mercado informativo.

**Sellado (v1.1 → actualizado v1.23 → v1.38):** el sellado tiene su **propio catálogo agrupado** en §2-S (`GET /catalog/sealed` → `SealedGroupDTO` con `availableCount`); su precio de venta es **derivado** (`override > mercado TCGCSV × spread > PRICE_PENDING`, ARCHITECTURE §4.23b). Como Compra solo lista lo que tiene precio, un sellado sin precio resuelto **no aparece** (money-safe). **Guardarraíl H9 (vigente):** `GET /catalog/cards*` es el catálogo de **singles** (raw/graded) y **excluye** `productType='sealed'` (`singlesPublishedWhere`); por eso `GET /catalog/cards?productType=sealed` devuelve **vacío** (el sellado se navega SOLO por §2-S). Con **v1.38-grouped-listings**, los singles de `/catalog/cards*` van **agrupados por stock** (`GroupedListingDTO`), simétrico al agrupado del sellado (`SealedGroupDTO`): dos catálogos agrupados paralelos, cada uno con su DTO.

---

## 2-S. Sellado — ventana de tienda (v1.23-sealed-sales)

> Superficie propia del **producto cerrado** (front: `(storefront)/sellado`). Listado **agregado por producto** (agrupa
> piezas idénticas → «N disponibles»), ficha con selección de cantidad, y dos endpoints **feature-flagged** (tendencia y
> restock). El checkout/carrito **no cambia** (§4 / §4-G): se compra por `inventoryItemId` como cualquier pieza. **Solo
> VENTA** — no hay buylist de sellado (la ventana muestra un call-out **mailto al buzón de contacto**; es **copy del
> front**, vive en i18n sobre `common.brand.domain` —p. ej. `contacto@tcghunt.mx`—, **no es un endpoint** y este
> contrato no lo norma). Ver ARCHITECTURE §4.23e/§4.23h.

### GET /api/v1/catalog/sealed — `public`
Grid agregado del sellado publicado. Agrupa por producto+condición (`tcgplayerProductId` si mapeado, si no
`cardId+sealedSubtype`, + `sealedCondition`); **solo grupos con ≥1 pieza vendible** (`status=listed`, `ownerType=platform`,
precio resuelto). La condición **separa** grupos (una tarjeta `mint`, otra `minor_box_damage`).
Query: `?setId=&sealedSubtype=&condition=&q=&page=&pageSize=&sort=`
- `condition`: `mint | minor_box_damage`. `sealedSubtype`: **cualquier valor de `SealedSubtype`** (§Enums — los SIETE; ⛔ **v2.1.9-a**: aquí decía `box|etb|bundle|tin|blister`, una lista a mano de **cinco** de un enum de **siete**. El backend ya deriva del enum y acepta `upc`/`collection`, así que **el contrato era el que iba atrasado** — filtrar por UPC en la tienda funciona y aquí parecía inválido. Es literalmente la clase que §4.37 norma: **un enum se declara UNA vez**). `sort`: `price_asc | price_desc | newest`.
Res `200` (**v2.1.9**, `SealedGroupListResponse`): `{ data: SealedGroupSummaryDTO[], page, pageSize, total }`.
- Cada `SealedGroupSummaryDTO` trae `availableCount` («N disponibles»), `fromPriceCents` (mínimo del grupo),
  `representativeItemId` (pieza más barata → add-to-cart) e `imageUrl` (TCGCSV si mapeado).
- **⚠️ v2.1.9 (D2) — CAMBIO DE SHAPE: la rejilla pierde `referenceValue`, `priceBasis` y `priceSource`.** Mismo
  criterio que `GET /catalog/cards` (§2): §N.7 es «SOLO fichas», nadie los consume aquí, y es la superficie de
  **cosecha masiva**. **`priceSource` se va también** —aunque no sea el campo del hallazgo— porque en sellado
  `priceBasis` **se deriva de él** (`override ⇒ override`; `*_spread ⇒ market`): dejarlo publicaría **la misma señal
  por otro nombre**, que es exactamente el error que v2.1.6 documentó al retirar `isManualOverride` y descubrir que
  `source` filtraba igual. Los tres **siguen intactos en la ficha** (`SealedGroupDTO`).
- **Sin N+1:** una query de las piezas de la página + `getReferencesBatch` de sus `sealedMarketRef` + agrupación en memoria.
  *(El mercado se sigue leyendo server-side —lo necesita `fromPriceCents`—; lo que cambia es que **no se emite**.)*

### GET /api/v1/catalog/sealed/:inventoryItemId — `public`  (FICHA — aquí aplica la regla de visibilidad v2.0)
Ficha de un producto sellado. `:inventoryItemId` = una pieza del grupo (típicamente `representativeItemId`).
Res `200` (`SealedGroupDetailResponse`): `{ group, listings: ListingDTO[], trendEnabled, restockEnabled }`.
- `listings` = **todas** las piezas disponibles del mismo grupo (producto+condición), más baratas primero — el front deja
  agregar hasta `group.availableCount` al carrito (por-pieza).
- `trendEnabled`/`restockEnabled` = estado de los feature-flags `sealed_value_trend`/`sealed_restock_alerts` (§M10).
- **⚠️ v2.0 (P-48) — misma REGLA DE VISIBILIDAD que la ficha de carta (criterio 93).** El bloque «Valor de mercado» se
  muestra **si y solo si `group.priceBasis === "market"`**. Para el sellado eso se traduce, sin ambigüedad, a:
  precio derivado por **spread** (`priceSource ∈ {subtype_spread, global_spread}`) ⇒ **se muestra**; precio fijado por
  **override manual** (`priceSource="override"`) ⇒ **NO se muestra**. **La matemática del sellado NO cambia** (§K /
  ARCHITECTURE §4.23a): conserva `override > mercado × spread por presentación > mercado × spread global >
  PRICE_PENDING`, con sus semillas box 18 / etb 22 / bundle 25 / tin 30 / blister 35 / **upc 18 / collection 22**
  (v2.1.9-a) / global 25. **El precio de un
  sellado antes y después de v2.0 es IDÉNTICO** (criterio 85); lo único aditivo es `priceBasis`, para que el front
  tenga **una sola** regla de visibilidad para las dos fichas.
- **v2.1.9 (D2):** en esta ficha `group.priceBasis` y `group.priceSource` **se conservan**, y `group.referenceValue`
  emite su número **si y solo si `priceBasis === "market"`** (el `iff` de §DTOs). Los `listings[]` (piezas, `ListingDTO`)
  siguen la misma regla. La **rejilla** (`GET /catalog/sealed`) ya no recibe ninguno de los tres.
Err `404 NOT_FOUND` (pieza inexistente o no publicada — no visible en Compra).

### GET /api/v1/catalog/sealed/:inventoryItemId/value-history — `public`  (v1.23 — FEATURE-FLAGGED `sealed_value_trend`)
Tendencia de valor de mercado del producto sellado (estilo acciones), **reusando** el historial de `PriceReference`
(`sealed:tcg:<productId>`) que ya acumula el job `sealed-price-ingest` (§4.19d) — cero fabricación de datos. Solo
productos **mapeados** tienen serie.
Query: `?range=5d|15d|1m|3m|6m|1y|ytd|all` (default `1m`).
Res `200`: misma forma que `SetValueHistoryResponse` (`{ set|product, range, points: SetValuePointDTO[], change }`).
Err `404 FEATURE_DISABLED` (dial `sealed_value_trend=off`), `404 NOT_FOUND` (pieza inexistente o no mapeada → sin serie).

### POST /api/v1/catalog/sealed/restock-subscriptions — `public`  (v1.23 — FEATURE-FLAGGED `sealed_restock_alerts`)
«Avísame cuando vuelva»: suscribe un correo a la reposición de un producto **agotado**. Acepta correo de invitado o de
usuario logueado (si hay sesión, se asocia `userId`). Guarda una `SealedRestockSubscription` (ARCHITECTURE §4.23h/M-28).
Req: `{ email: string, tcgplayerProductId?: number, cardId?: string, sealedSubtype?: SealedSubtype, sealedCondition: SealedCondition }`
- Identidad de producto: `tcgplayerProductId` (mapeado, preferido) **o** `cardId (+ sealedSubtype)`. Uno de los dos es obligatorio.
Res `202`: `{ subscribed: true }` — **respuesta neutra** (no revela si el producto existe/está agotado; anti-enumeración,
patrón §4-G). **Rate-limited** por IP/correo (`429 RATE_LIMITED`).
Err `404 FEATURE_DISABLED` (dial `off`), `422 VALIDATION_ERROR` (sin identidad de producto / correo inválido).

---

## 3. Bóveda y portafolio (comprador)

### GET /api/v1/vault/holdings — `customer`
Res `200`:
```json
{
  "data": [{
    "inventoryItemId": "…", "folio": "INV-000123", "card": { "…": "CardDTO" },
    "productType": "raw", "rawCondition": "NM", "finish": "reverse_holo",
    "ownershipStatus": "settled", "status": "in_custody",
    "shipmentState": "picking", "activeShipmentId": "shp_…", "withdrawable": false,
    "referenceValue": { "status": "priced", "referenceMxnCents": 12500, "capturedDate": "2026-08-13" }
  }],
  "_ejemplo_sellado_v1.42": {
    "inventoryItemId": "…", "folio": "INV-000456", "card": { "…": "CardDTO ancla del set" },
    "productType": "sealed", "finish": "normal", "ownershipStatus": "settled", "status": "in_custody",
    "sealedProductId": "sp_…", "sealedProductName": "Obsidian Flames Elite Trainer Box",
    "sealedImageUrl": "https://…/etb.jpg", "sealedSubtype": "etb", "sealedCondition": "mint",
    "referenceValue": { "status": "priced", "referenceMxnCents": 92681, "capturedDate": "2026-08-13" }
  },
  "portfolio": { "totalValueMxnCents": 543200, "pendingPriceCount": 2, "currency": "MXN" }
}
```
El valor del portafolio se calcula contra el **valor de referencia** (no el precio de venta). Las cartas `referenceValue.status="pending"` se **excluyen** del total y se reportan en `pendingPriceCount` (no rompen el cálculo).
- **`finish` (v1.6-finish):** cada holding trae su **acabado** (Normal/Reverse Holo/Holofoil/1st Ed. Holo). El `referenceValue` es el de **ese acabado** (`PriceReference` con `finish`); la valuación del portafolio usa el precio del acabado específico, no un precio único por carta. "Mi bóveda" muestra el acabado y permite ordenar por set y por valor.
- **Identidad de sellado (v1.42, BLOQ-2a — mata «Tropius» en «Mis piezas»):** para `productType='sealed'` el holding gana
  campos de display **presentes SOLO en sellado** (ausentes/omitidos en raw/graded; aditivo/retrocompatible):
  - `sealedProductId: string | null` — identidad del sellado (FK → `SealedProduct`); `null` para sellado legacy sin ligar.
  - `sealedProductName: string` — nombre de display **YA RESUELTO server-side** por la cascada §4.34a: `SealedProduct` vivo
    (si `sealedProductId`) → snapshot `sealedProductName` → `Card.name` ancla. **Nunca `null`** en sellado (la cascada
    termina en `Card.name`, NOT NULL). El front lo pinta tal cual (no re-aplica fallback).
  - `sealedImageUrl: string | null` — imagen **YA RESUELTA** por la cascada `SealedProduct.imageUrl` → snapshot
    `sealedImageUrl` → `Card.imageSmallUrl` → `null`. El front muestra la **caja**, no el single ancla.
  - `sealedSubtype: SealedSubtype | null`, `sealedCondition: SealedCondition | null` — snapshot por-pieza (identidad de grupo).
  `card: CardDTO` **se conserva** (pertenencia al set + fallback ya resuelto arriba). Display-only, money-safe:
  `referenceValue` y el cálculo del portafolio **no cambian** (el sellado ya entra a la valuación por `sealedMarketRef`,
  §3/SUP-4). Misma cascada de `/vault/sealed`, grid público de sellado y `sealed-sets`.
- **`shipmentState: ShipmentActiveStage | null` (v1.17):** etapa del **envío activo** del item, si lo tiene, **derivada del join** `InventoryItem → ShipmentItem → ShipmentRequest` (fuente de verdad canónica; hay a lo más un envío activo por item, garantizado por `409 ITEM_IN_ANOTHER_SHIPMENT`). Valores: `solicitado` (retiro creado, **pago pendiente** — transitorio), `picking` (preparando), `guia` (con guía), `enviado` (en tránsito). `null` = sin envío activo. **`entregado` nunca aparece** aquí (ver exclusión abajo) y `cancelado` deja el item sin envío activo (`null`). El front muestra el **badge "EN RETIRO"** cuando `shipmentState !== null`.
- **`activeShipmentId: string | null` (v1.17):** id de la `ShipmentRequest` activa (para **deep-link** desde el badge a la vista de rastreo `GET /shipments/:id`); `null` si `shipmentState=null`.
- **`withdrawable: boolean` (v1.17; criterio único read/write reafirmado en v1.17.1):** flag **autoritativo** para que el front habilite/deshabilite el botón **RETIRAR**. `true` **solo si** `ownershipStatus='settled' && status='in_custody' && shipmentState=null`. Este flag de **lectura** aplica **exactamente el mismo criterio** que el backend usa al **crear** el retiro (`POST /shipments` → `classifyItems`, §5): read y write comparten regla de elegibilidad — no hay divergencia. Los items ya entregados quedan `status='withdrawn'` y **no aparecen** en holdings (se excluyen), por lo que nunca traen `withdrawable=true`; si se intenta retirarlos por llamada directa, el backend responde **`422 ITEM_NOT_IN_CUSTODY`** (§5). Expone la **regla anti doble-retiro** ANTES de intentar (el cliente ya no la descubre solo al recibir el error): un item `pending` daría `422 ITEM_NOT_SETTLED`, uno ya en envío `409 ITEM_IN_ANOTHER_SHIPMENT`, y uno ya entregado `422 ITEM_NOT_IN_CUSTODY`.
- **Inclusión/exclusión y conteo del portafolio (v1.17):** `GET /vault/holdings` lista items del usuario `ownerType='customer' AND ownerUserId=:me AND status != 'withdrawn'`. (a) Items con **envío activo** (`solicitado/picking/guia/enviado`) **SÍ se listan** (marcados `shipmentState`, `withdrawable=false`) y **SÍ cuentan** en `portfolio.totalValueMxnCents` (siguen siendo del cliente hasta la entrega). (b) Items **`entregado`** → el item ya es `status='withdrawn'` (transición terminal de la máquina M4, ver §M4/§9) → **NO se listan** y **NO cuentan** en el portafolio (salieron de la bóveda). El **snapshot diario del portafolio** (`portfolio-snapshot`) usa la **misma** regla de inclusión (excluye `withdrawn`) para que la gráfica de tendencia sea consistente.

### GET /api/v1/vault/holdings/:inventoryItemId — `customer`
Res `200`: holding detallado (imagen de catálogo de pokemontcg.io, movimientos visibles al dueño; para gradeadas incluye `gradingCompany + gradeValue + certNumber`). **No hay fotos propias del item** (v1.2). Err `403` si no es del usuario.

### GET /api/v1/vault/portfolio/history — `customer`  (v1.1 — gráfica de tendencia)
Serie temporal del valor del portafolio (estilo acciones) para "Mi bóveda". Alimentada por el snapshot diario `PortfolioSnapshot` (job `portfolio-snapshot`, ver ARCHITECTURE §3 y §5).
Query: `?range=5d|15d|1m|3m|6m|1y|ytd|all`  (default `1m`)
Res `200`:
```json
{
  "range": "1m",
  "points": [
    { "date": "2026-07-15", "valueMxnCents": 512000, "costBasisMxnCents": 400000 },
    { "date": "2026-08-14", "valueMxnCents": 543200, "costBasisMxnCents": 400000 }
  ],
  "change": { "absMxnCents": 31200, "pct": 6.09, "direction": "up" }
}
```
- `points`: un punto por día con snapshot en el rango (ordenados asc por fecha). `costBasisMxnCents` es opcional (puede faltar si no hay base de costo). Los puntos de **backfill indicativo** (si se sembró histórico) traen `estimated: true` (ver `PortfolioPointDTO`).
- `change`: variación entre el primer y último punto del rango; `direction` ∈ `up | down | flat`. `pct` con 2 decimales; si el valor inicial es 0, `pct=null`.
- Si el usuario no tiene snapshots todavía, `points: []` y `change` con `direction: "flat"`, `absMxnCents: 0`, `pct: null`.
Err `401`.

### GET /api/v1/vault/master-sets — `customer`  (v1.20-master-set-everywhere — vista (iii): MI bóveda por set)
"Mi bóveda como master set": **mismo shape** que `GET /admin/inventory/master-sets` (`MasterSetIndexResponse` +
extensiones v1.20) con `scope="user_vault"` y `owner = { userId, name }` (el propio usuario; **sin** `email`).
Query: `?q=&page=&pageSize=&sort=` (mismos valores que el índice admin; `sort` default `release_desc`).
- **Alcance:** SOLO piezas del usuario autenticado **en bóveda** (`ownerType='customer' AND ownerUserId=<yo>`,
  status en bóveda; ver §DTOs). El índice devuelve **solo los sets con ≥1 pieza** del usuario (no lista los ~cientos
  de sets vacíos; la completitud contra el catálogo se ve al abrir el binder de un set).
- **Sin datos internos:** nada de ubicaciones/costos/folios (regla de omisión por scope, §DTOs). Sin acciones de
  inventario: es lectura pura.
Err `401`.

### GET /api/v1/vault/master-sets/:setId — `customer`  (v1.20 — binder de MI bóveda + faltantes comprables)
Binder del set sobre MI bóveda: **mismo shape** que el binder admin (`MasterSetBinderResponse` + extensiones v1.20),
`scope="user_vault"`, `cells` en el **mismo orden natural** por número. `:setId` = id LOCAL del `CardSet` (funciona
para CUALQUIER set del catálogo, tenga o no piezas el usuario: las celdas/variantes sin piezas son sus faltantes).
- **v1.33 (P-27) — hereda el master set combinado:** por usar el **mismo** `MasterSetService`, esta vista (y la admin
  `GET /admin/vaults/:userId/master-sets/:setId`) aplican el mismo fan-in que el binder M1 (`parts`, `partSetId`/
  `partLabel`, `canonicalSetId`, conteos = Σ de partes). Si el cliente tiene cartas de ambas partes, se ven bajo el
  mismo master. `buyable` sigue resolviéndose por `(cardId, finish)` — no depende del grupo. **La valuación del
  portafolio no cambia** (cada carta se valúa con la `PriceReference` de su acabado/su set-id real; money-safe).
- **Completitud por variante:** cada celda expone `variants[]` (universo = `Card.availableFinishes`) con `covered`
  por acabado; los contadores «X/Y» del front cuentan **variantes** (`coveredVariantCount`/`expectedVariantCount` y
  los agregados del set), no cartas.
- **v1.22-2 (N-15/N-16) — render plano:** las **tarjetas** que se PINTAN son las de `cell.displayFinishes` (equiv.
  `variants[].displayed === true`); el acabado espurio suprimido por N-15 **no se pinta** pero **sigue contando**
  para completitud (X/Y) y `buyable`. La whitelist SEC-A1 no cambia. Mismo criterio en la vista admin de bóveda
  (`GET /admin/vaults/:userId/master-sets`) y en el binder M1 (`GET /admin/inventory/master-sets/:setId`).
- **`buyable` (SOLO esta vista):** cada variante **faltante** (`covered=false`) trae
  `buyable: { inventoryItemId, salePriceCents } | null` — la pieza **`listed` más barata** de plataforma para ese
  `(cardId, finish)`, **SOLO un single** (`productType ∈ {raw, graded}`; **v1.42/BLOQ-3b: sellado EXCLUIDO** — ya no se
  ofrece un ETB sellado para llenar la casilla de un single), resoluble a ficha vía `GET /catalog/listings/:inventoryItemId`
  y comprable por el checkout normal §4. `null` si no hay single publicado. **No** hay compra dentro del binder: el CTA lleva al flujo de
  Compra/checkout existente (el binder no crea órdenes).
Err `401`, `404 NOT_FOUND` (set inexistente).

### GET /api/v1/vault/sealed — `customer`  (v1.23-sealed-sales — pestaña «Sellado» de MI bóveda)
Segunda pestaña de «Mi bóveda» (junto a «Cartas» = binder master-set §3). Agrupa las piezas **selladas** del usuario en
bóveda por producto+condición (mismo criterio que §2-S) con conteo y **valor de mercado actual**.
Query: `?sealedSubtype=&condition=&sort=` (`sort` default `value_desc`; también `count_desc | name_asc`).
Res `200` (`VaultSealedResponse`): `{ data: VaultSealedGroupDTO[], totalValueMxnCents, pendingPriceCount, currency }`
(sin `owner` en la vista del propio cliente).
- **Alcance:** solo piezas del usuario `ownerType='customer' AND ownerUserId=<yo> AND status en bóveda` (ambas
  titularidades `pending|settled`; mismo filtro de status que el scope `user_vault`, §DTOs).
- **Valuación = base del portafolio (§3):** `marketValue` por pieza = `sealedMarketRef` (TCGCSV); piezas sin mercado
  (no mapeadas / sin ingest) se **excluyen** de `totalValueMxnCents` y cuentan en `pendingPriceCount`.
- **Sin datos internos:** nada de ubicación/costo/folio (regla de omisión por scope). Lectura pura.
Err `401`.

> **Nota de coexistencia (v1.23, ACTUALIZADA v1.42):** las piezas selladas **siguen** apareciendo en `GET /vault/holdings`
> (por-pieza) **pero ahora con su propia identidad de sellado** (`sealedProductName`/`sealedImageUrl`, BLOQ-2a — ya NO se
> pintan como la carta ancla). En cambio, **el binder master-set las EXCLUYE** (`productType='sealed'` no cuenta en piezas/
> `countsByFinish`/completitud ni es `buyable`; BLOQ-3/3b v1.42) — el binder es la colección de **singles** (alinea con H9).
> La cláusula previa «pre-existente §4.20b, fuera de alcance cambiarlo» queda **DEROGADA** (era anterior al módulo
> `SealedProduct`/P-38). Esta pestaña «Sellado» y las de M1 (`sealed-sets`) son la superficie **dedicada y agrupada** del
> sellado.

---

## 4. Compra, checkout y órdenes (Stripe)

### POST /api/v1/checkout/quote — `customer`  (v1.21.3-quote-prune: resolución POR ÍTEM)
Calcula el desglose sin cobrar (para mostrar líneas en el checkout).
Req: `{ inventoryItemIds: string[] }`  *(sin cambios)*
Res `200`: `{ items: OrderItemPreview[], breakdown: BreakdownDTO, unavailableItems: UnavailableCartItemDTO[] }`

**Poda amable (v1.21.3):** el quote resuelve **por ítem**, nunca revienta por una pieza muerta del carrito
(`localStorage` puede traer ids de piezas ya vendidas/borradas):
- **`unavailableItems` — SIEMPRE presente** (tipado estable): `[]` si todos los ids resuelven y están disponibles
  (en ese caso la forma previa de la respuesta NO cambia: mismo `items` y `breakdown`, solo se suma el `[]`).
  Entra a `unavailableItems` todo id que (a) **no existe** en BD (`cardName: null`) o (b) existe pero **no** está
  disponible para venta de plataforma (`ownerType != 'platform'` o `status ∉ {listed, in_stock}`) — ahí
  `cardName` trae el nombre de la carta para el aviso del front.
- `items` y `breakdown` se calculan **SOLO con los ítems válidos** (los podados no suman al total).
- **Carrito 100 % no disponible:** `200` con `items: []`, `unavailableItems` poblado y **`breakdown` presente en
  CEROS** (`{ subtotalCents: 0, ivaCents: 0, ivaRatePct: 16, processingFeeCents: 0, totalCents: 0,
  currency: "MXN" }`). El front pinta carrito vacío + aviso; **nunca** pantalla de error.
- **Deber del front:** tras cada quote, **podar del carrito** (`localStorage`) los `inventoryItemId` que vengan en
  `unavailableItems`, ANTES de llamar a `POST /checkout/session` (que sigue estricto, ver abajo).
- **Ids repetidos — adenda v1.21.3-quote-prune (2026-08-18, hallazgo B-1 del techlead):** los `inventoryItemIds`
  duplicados se **deduplican** antes de resolver (cada pieza física es única y solo puede comprarse una vez):
  `["a","a"]` ⇒ `200` con **1** ítem, sin error ni entrada en `unavailableItems`. Comportamiento vigente que se
  documenta, no se cambia. ⚠️ `POST /checkout/session` **no** deduplica (ver su nota abajo).

Ejemplo (una pieza vendida entre visitas, otra borrada):
```json
{ "items": [{ "inventoryItemId": "a1…", "card": {}, "unitPriceCents": 12500 }],
  "breakdown": { "subtotalCents": 12500, "ivaCents": 2000, "ivaRatePct": 16,
                 "processingFeeCents": 700, "totalCents": 15200, "currency": "MXN" },
  "unavailableItems": [
    { "inventoryItemId": "b2…", "cardName": "Antique Skull Fossil" },
    { "inventoryItemId": "c3…", "cardName": null }
  ] }
```
Err: `422 PRICE_PENDING` (algún ítem **VÁLIDO** —existente y disponible— sin precio; se evalúa **después** de la
poda, semántica intacta), `400 VALIDATION_ERROR` (carrito vacío en el request), `401`.
- **v2.0 (P-48) — `PRICE_PENDING` NO cambia de semántica; solo gana dos causas más** (sin dato de mercado, y
  guardarraíl `premium_at_floor`), exactamente como cualquier otra pieza cuyo precio dejó de resolver entre visitas.
  **Punto normativo importante:** como el precio de venta se resuelve **en LECTURA**, una pieza `status='listed'`
  cuyo precio deja de resolver **desaparece sola de Compra** (`fetchSellable` la excluye por `sellable=false` /
  `salePriceCents=null`) **sin cambiar de status** y **escala a la cola**. El comprador **nunca** ve «precio
  pendiente» (§A). El **checkout NO se sesga hacia abajo**: ante duda, no se vende (§N.0 — vender de menos es la
  pérdida irreversible).
**Eliminados en v1.21.3 (SOLO en este endpoint):** `404 NOT_FOUND` global y `409 ITEM_UNAVAILABLE` global — ambos
casos ahora viajan en `unavailableItems` con `200`.
> ⚠️ **NO propagar la poda a session:** `POST /checkout/session` (abajo) **conserva** `404 NOT_FOUND` /
> `409 ITEM_UNAVAILABLE` estrictos. Crear un pedido con una pieza muerta DEBE seguir fallando (anti double-sell,
> regresión caso v de ARCHITECTURE §4.21h-1). La poda vive únicamente en los dos quotes.
> **Nota de frontend (no es API):** el carrito de `localStorage` gana timestamp de última modificación y **expira
> a los 30 días** (complementa la poda; dueño: frontend).

### POST /api/v1/checkout/session — `customer`
Reserva los items (`status=reserved`), crea la `Order` en `pending` y el `PaymentIntent` de Stripe.
Req: `{ inventoryItemIds: string[], billingProfileId?: string }` + header `Idempotency-Key`.
El `billingProfileId` es **opcional**: en el MVP la factura es por correo (CFDI sin PAC), por lo que **no se exige billing profile para comprar**.
Res `201`:
```json
{ "orderId": "…", "breakdown": { "…": "BreakdownDTO" },
  "stripe": { "paymentIntentId": "pi_…", "clientSecret": "…" } }
```
Err: `422 PRICE_PENDING`, `409 ITEM_UNAVAILABLE`, `404 NOT_FOUND` (algún `inventoryItemId` no existe), **`403 EMAIL_NOT_VERIFIED`** (v1.5 — `emailVerified=false`; comprar es acción sensible). (No aplica `BILLING_PROFILE_REQUIRED` en el MVP: el billing profile no es obligatorio.)
> **v1.21.3 — session sigue ESTRICTO a propósito:** la poda por ítem de v1.21.3 aplica **SOLO a los quotes**. Aquí
> una pieza muerta en el carrito DEBE seguir fallando con `404`/`409` globales (anti double-sell, caso v de
> ARCHITECTURE §4.21h-1). El front llega a session con el carrito YA podado por el quote.
> **Ids únicos — adenda v1.21.3-quote-prune (2026-08-18, hallazgo B-1):** a diferencia del quote, session **no
> deduplica**: `inventoryItemIds` duplicados o no resolubles caen en el `404 NOT_FOUND` / `409 ITEM_UNAVAILABLE`
> estricto vigente (la carga estricta compara el conteo pedido contra el resuelto; `["a","a"]` ⇒ `404`). El
> cliente DEBE enviar ids únicos — el carrito del front ya lo garantiza (un id por pieza única).
> **v1.5:** `POST /checkout/session` está bloqueado por `EmailVerifiedGuard` (crear orden = acción sensible). El
> `POST /checkout/quote` (read-only) **no** se bloquea, para que la UI muestre precios con el banner "verifica tu correo".
Notas: `breakdown` incluye **IVA 16% desglosado** (sobre el subtotal de cartas) y **línea de fee de procesamiento por gross-up** (para que la plataforma reciba íntegro `subtotal+IVA` tras la comisión Stripe; el fee **no** lleva IVA **de producto**). El gross-up sí cubre el IVA que Stripe MX cobra sobre su comisión (**v1.40: derivado de `ivaPct/100`**, fuente única del IVA). `totalCents = subtotalCents + ivaCents + processingFeeCents` (ver ARCHITECTURE §5.1).

### GET /api/v1/orders — `customer`
Res `200`: `{ data: OrderSummaryDTO[], page, pageSize, total }`.

### GET /api/v1/orders/:orderId — `customer`
Res `200`:
```json
{ "id": "…", "status": "settled", "createdAt": "…", "settledAt": "…",
  "breakdown": { "…": "BreakdownDTO" },
  "items": [{ "inventoryItemId": "…", "card": {}, "unitPriceCents": 12500 }],
  "cfdiStatus": "registrado", "invoiceRequested": false, "stripePaymentIntentId": "pi_…" }
```
Err `403/404`.

Tras `settled`, los items aparecen en la bóveda con `ownershipStatus=settled`. En `pending` ya están en la bóveda con `ownershipStatus=pending`.

### POST /api/v1/orders/:orderId/request-invoice — `customer`
CFDI en MVP **sin PAC**: no timbra. Marca la orden como "factura solicitada" y la UI muestra la instrucción de enviar los datos fiscales por correo (timbrado manual). Timbrado real = fase 2.
Req: `{}` (usa el `BillingProfile` en archivo) → Res `200`: `{ orderId, invoiceRequested: true, instructions: "SEND_FISCAL_DATA_BY_EMAIL" }`.
El IVA cobrado ya queda registrado en `Order.ivaCents` (disponible en M7).

---

## 4-G. Guest checkout — comprar sin cuenta (v1.21-guest-checkout)

> **PROJECT §J / §J.1 / criterios 45–56b.** Superficie **aditiva y aislada**: los endpoints de §4 y §5 de arriba
> **no cambian de forma ni de rol**. Diseño completo (ruta de fulfillment, ciclo de vida de los items, modelo de
> amenazas del enlace) en **ARCHITECTURE §4.21**; diff de esquema en **§4-G.10** y ARCHITECTURE §11 (M-25).
>
> **Las tres decisiones de producto están CERRADAS y no se re-litigan aquí:** (1) el invitado solo hace **envío
> directo**, la bóveda **exige cuenta** y elegirla produce **upsell, no error**; (2) **correo obligatorio** +
> seguimiento por **enlace tokenizado**; (3) **reclamo post-compra** con el mismo correo.

### 4-G.0 Invariantes normativos (los cinco que gobiernan toda la sección)

1. **Un invitado no tiene bóveda.** En un pedido `fulfillmentMode='direct_ship'` el `InventoryItem` **nunca** pasa
   a `ownerType='customer'`: conserva `ownerType='platform', ownerUserId=null, ownershipStatus=null` y todo su
   ciclo lo lleva `status` (§4-G.6). Invariante global reforzado: **`ownerType='customer'` ⇒ `ownerUserId NOT NULL`**
   (hoy no está escrito en ningún lado y es lo que hace segura la nulabilidad de `Order.userId`).
2. **El envío del invitado se cobra en el MISMO `PaymentIntent`** que las cartas (`BreakdownDTO.shippingFeeCents`).
   El invitado **no** puede pagar un segundo PI: no tiene bóveda desde donde pedir un retiro.
3. **Un invitado nunca toca un endpoint `customer` y viceversa.** Los endpoints de invitado son `@Public()` y
   **rechazan** una sesión válida (`409 ALREADY_AUTHENTICATED`); los `customer` siguen exigiendo JWT (`401`). El
   `OrderAccessToken` **no es una credencial de sesión**: no otorga rol, no se acepta como `Authorization`, y solo
   habilita la lectura de **un** pedido por los endpoints `/orders/guest/*`.
4. **El camino de invitado JAMÁS consulta `User` por correo.** No hay `findUnique({ where: { email } })` en
   `/checkout/guest/*` ni en `/orders/guest/*`. Es la garantía de criterio 56 a nivel de código, no de mensaje.
5. **Ninguna respuesta de API devuelve un token en claro salvo a quien acaba de crear el pedido.** El token de
   seguimiento viaja **por correo**; la única excepción es el `checkoutToken` **de vida corta** que devuelve
   `POST /checkout/guest/session` (quien la recibe **es** el comprador que creó ese pedido, §4-G.2/§4-G.7a).
   Consecuencia directa del hash: **el claro es irrecuperable** una vez emitido — ningún proceso posterior
   (webhook, reenvío, soporte) puede "volver a mandar el mismo token"; solo puede **emitir uno nuevo**.

### 4-G.1 POST /api/v1/checkout/guest/quote — `public` (`@Public()`)

Desglose sin cobrar del **carrito de invitado** (cartas + envío + IVA + fee). Read-only: **no** reserva inventario.

Rate limit: `@Throttle({ default: { ttl: 60_000, limit: 30 } })` (por IP).

Req:
```ts
GuestAddressInput = {
  line1: string, line2?: string, neighborhood?: string,
  city: string, state: string,
  postalCode: string,          // ^\d{5}$
  country: "MX",               // literal; cualquier otro valor → 422 ADDRESS_NOT_MX
  phone: string,               // 10 dígitos MX (contacto de paquetería)
  recipientName: string        // nombre de quien recibe (el invitado no tiene User.name)
}
GuestCheckoutQuoteRequest = { inventoryItemIds: string[], shippingAddress?: GuestAddressInput }
```
`shippingAddress` es **opcional** en el quote (la tarifa es fija y nacional): si viene, se valida MX; si no viene,
se cotiza igual y la validación de dirección ocurre en la sesión. `inventoryItemIds`: 1..`GUEST_MAX_ITEMS` (**20**,
constante de servidor, §4-G.10).

Res `200` (v1.21.3-quote-prune: gana `unavailableItems`, **siempre presente**; v1.21.4-dual-breakdown:
gana `vaultBreakdown`, **siempre presente** — ver abajo):
```json
{ "items": [{ "inventoryItemId": "…", "card": {}, "unitPriceCents": 12500 }],
  "fulfillmentMode": "direct_ship",
  "breakdown": { "subtotalCents": 25000, "shippingFeeCents": 17500, "ivaCents": 6800,
                 "ivaRatePct": 16, "processingFeeCents": 1900, "totalCents": 51200, "currency": "MXN" },
  "vaultBreakdown": { "subtotalCents": 25000, "ivaCents": 4000,
                      "ivaRatePct": 16, "processingFeeCents": 1400, "totalCents": 30400, "currency": "MXN" },
  "unavailableItems": [{ "inventoryItemId": "…", "cardName": "Antique Skull Fossil" }],
  "notices": { "finalSale": true, "invoiceByEmail": true, "termsRequired": true } }
```
> `notices` son **banderas**, no texto (§0 i18n): el front renderiza el aviso de **ventas finales**, el mensaje de
> **factura CFDI manual por correo** y el enlace a términos desde su i18n (criterio 48b). El **precio de venta es el
> mismo** que para un usuario con cuenta (mismas reglas de venta por rareza/acabado; comprar como invitado no cambia
> condiciones comerciales).

**`vaultBreakdown` — desglose reactivo del destino (v1.21.4-dual-breakdown, N-12).** El quote devuelve **DOS
desgloses en una sola respuesta** para que la UI conmute el resumen **al instante** al alternar el radio de destino
(«recibir en casa» ⇄ «guardar en bóveda»), **sin refetch por toggle**:
- `breakdown` (`DirectShipBreakdownDTO`, **CON `shippingFeeCents`**) = el resumen del destino **envío directo**;
  **no cambia** respecto de v1.21.3 (mismo shape, mismas fórmulas). Es lo que se cobra si el invitado paga sin cuenta.
- `vaultBreakdown` (`BreakdownDTO`, **SIN `shippingFeeCents`**) = el resumen del destino **bóveda**: **la bóveda no se
  envía**, así que **se quita la línea de envío** y el IVA/fee/total se recalculan sobre la base menor (solo cartas).
  Es **exactamente** `computeCartBreakdown(subtotal, ivaRatePct, fee)` (`backend/src/common/money.ts`, ARCHITECTURE §5.1).
  Fórmulas normativas (idénticas en backend y en el mock del front — el front **no las puede derivar por su cuenta**,
  ver nota de seguridad abajo):
  - `subtotalCents = Σ` precio de venta de las cartas válidas (el **mismo** `subtotalCents` que `breakdown`; sin envío).
  - `ivaCents = round(subtotalCents × ivaRatePct/100)` — IVA **solo sobre cartas** (sin la línea de envío que sí grava en `breakdown`).
  - `base = subtotalCents + ivaCents`.
  - `totalCents = grossUp(base)` — mismo gross-up de Stripe (fija + pct, incl. IVA de la comisión) sobre la base menor.
  - `processingFeeCents = totalCents − base`.
  - **NO lleva** campo `shippingFeeCents` (ni `0` ni presente): su ausencia es la señal de shape de «destino bóveda».

> **Por qué DOS desgloses y no un parámetro `destination`/`fulfillmentMode` en el request.** El PO pidió reactividad
> **«al instante»**. Un parámetro de destino en el request forzaría un **round-trip por cada toggle** del radio (latencia
> + parpadeo + carrera de respuestas fuera de orden). Devolver ambos desgloses en el mismo `200` los deja precomputados:
> el front pinta uno u otro con un puro cambio de estado local, sin red. El costo es un segundo desglose barato
> (aritmética pura sobre el mismo subtotal ya calculado), y el `breakdown` de envío directo **no cambia de shape**, así
> que la respuesta es 100 % aditiva. `fulfillmentMode` en la RESPUESTA sigue siendo `"direct_ship"` (es el único destino
> que un invitado puede **pagar**; la bóveda exige cuenta, §4-G.2 `422 VAULT_REQUIRES_ACCOUNT`). `vaultBreakdown` es
> **solo informativo**: le permite al invitado **ver** el ahorro de no pagar envío y es el gancho del upsell de bóveda
> (§4-G.2 / PROJECT §J), pero **elegir bóveda sigue produciendo el upsell/crear-cuenta, no un cobro**.
>
> **Por qué el desglose de bóveda TIENE que venir del backend (no lo puede derivar el front).** El `processingFeeCents`
> es un **gross-up de la comisión de Stripe** cuya config (`StripeFeeConfig`: **fija + pct**, + IVA de la comisión) **nunca
> se expone al cliente** — el front solo recibe el `BreakdownDTO` final. Con un solo `total` conocido y **dos incógnitas**
> (fija y pct) el cálculo **no es invertible**: el front no puede «quitarle el envío» al `breakdown` de envío directo y
> re-derivar el fee/total de bóveda. Por eso el backend computa `vaultBreakdown` con el `StripeFeeConfig` real (misma
> `grossUpTotal`) y lo entrega ya hecho. El **mock del front** replica `computeCartBreakdown` con un `StripeFeeConfig` de
> prueba **solo** para desarrollo offline; en runtime el desglose autoritativo es el del backend.

**Poda / carrito 100 % podado — coherencia de `vaultBreakdown`:** `vaultBreakdown` se calcula sobre los **mismos ítems
válidos** que `breakdown` (después de dedupe + poda). En el caso **100 % no disponible** (`items: []`), además del
`breakdown` en CEROS (`shippingFeeCents: 0` incluido), `vaultBreakdown` también va en CEROS con **subtotal 0**
(`subtotalCents: 0, ivaCents: 0, processingFeeCents: 0, totalCents: 0, ivaRatePct` = dial, `currency: "MXN"`, **sin
`shippingFeeCents`**). Shape estable: `vaultBreakdown` está **siempre presente** en todo `200`.

**Poda amable (v1.21.3 — MISMA norma que `POST /checkout/quote`, §4, porque comparten la lógica de pricing):**
- `unavailableItems: UnavailableCartItemDTO[]` **siempre presente**; `[]` cuando todo el carrito resuelve (y en ese
  caso la forma previa de la respuesta NO cambia). Entra todo id inexistente (`cardName: null`) o existente pero
  fuera de venta de plataforma (`ownerType != 'platform'` o `status ∉ {listed, in_stock}`; `cardName` con nombre).
- `items` y `breakdown` se calculan SOLO con los ítems válidos.
- **Carrito 100 % no disponible:** `200` con `items: []`, `unavailableItems` poblado y `breakdown` **en CEROS,
  incluido `shippingFeeCents: 0`** (no hay nada que enviar; el front pinta carrito vacío + aviso, nunca error).
  `fulfillmentMode` y `notices` se conservan (shape estable).
- El límite `1..GUEST_MAX_ITEMS` (**20**) se valida sobre el **array del request** (antes de la poda): un carrito
  que valida pero queda vacío tras la poda es `200`, no `400`.
- **Deber del front:** podar del carrito los ids de `unavailableItems` ANTES de llamar a
  `POST /checkout/guest/session` (§4-G.2), que **sigue estricto**.
- **Ids repetidos — adenda v1.21.3-quote-prune (2026-08-18, hallazgo B-1):** MISMA norma que §4 — los
  `inventoryItemIds` duplicados se **deduplican** antes de resolver (`["a","a"]` ⇒ `200` con 1 ítem, sin error).
  El límite `1..GUEST_MAX_ITEMS` sigue validándose sobre el **array del request**, antes del dedupe y de la poda.
  ⚠️ `POST /checkout/guest/session` (§4-G.2) **no** deduplica (ver su nota).

Err: `422 PRICE_PENDING` (ítem **válido** sin precio; se evalúa **después** de la poda, semántica intacta),
`422 ADDRESS_NOT_MX`, `400 VALIDATION_ERROR` (carrito vacío o por encima de `GUEST_MAX_ITEMS`),
`409 ALREADY_AUTHENTICATED`, `429 RATE_LIMITED`.
**Eliminados en v1.21.3 (SOLO en este endpoint):** `404 NOT_FOUND` global y `409 ITEM_UNAVAILABLE` global — ahora
viajan en `unavailableItems` con `200`. ⚠️ `POST /checkout/guest/session` (§4-G.2) **conserva** ambos errores
estrictos: crear pedido con pieza muerta DEBE seguir fallando (anti double-sell).

### 4-G.2 POST /api/v1/checkout/guest/session — `public` (`@Public()`)

Crea el pedido de invitado: reserva los items, crea la `Order` (`userId=null`, `guestEmail`, `fulfillmentMode='direct_ship'`,
snapshot de dirección) y **un solo `PaymentIntent`** por `totalCents` (cartas + envío + IVA + fee).

Rate limit: `@Throttle({ default: { ttl: 3_600_000, limit: 5 } })` (por IP; crear un pedido reserva inventario y
crea un PI — es la superficie más cara). Header `Idempotency-Key` aceptado (la clave real se deriva server-side
como `pi-order-<id>`, igual que §4).

Req:
```ts
GuestCheckoutSessionRequest = {
  inventoryItemIds: string[],          // 1..20
  email: string,                       // OBLIGATORIO. Se normaliza (trim + lowercase) antes de persistir
  shippingAddress: GuestAddressInput,  // OBLIGATORIO
  locale?: Locale,                     // idioma del correo de confirmación (default `es`; PROJECT pregunta abierta v1.5-8)
  acceptedTerms: true,                 // aceptación explícita de ventas finales + aviso de privacidad
  fulfillmentMode?: FulfillmentMode    // si se envía DEBE ser "direct_ship"; "vault" → 422 VAULT_REQUIRES_ACCOUNT
}
```
- **Validación del correo (criterio 47):** formato RFC-5322 simplificado + longitud ≤ 254. La **doble captura /
  confirmación** del correo es requisito de **frontend** (no hay campo `emailConfirm` en la API); el backend valida
  formato y es la autoridad del bloqueo (`400 VALIDATION_ERROR` ⇒ no se puede pagar).
- **Anti-enumeración (criterio 56):** el endpoint **no consulta `User`**. Que el correo tenga cuenta es
  indistinguible desde afuera: mismo status, mismo shape, mismos tiempos.
- **Destino bóveda (criterio 48):** `fulfillmentMode: "vault"` → **`422 VAULT_REQUIRES_ACCOUNT`** con
  `details: { upsell: true, reason: "VAULT_REQUIRES_ACCOUNT" }`. **El front NUNCA lo pinta como error**: es la
  señal para mostrar el upsell (beneficio + "crear cuenta sin salir del checkout", conservando carrito y datos).

Res `201`:
```json
{ "orderId": "uuid…", "orderNumber": "TCG-000123",
  "breakdown": { "…": "BreakdownDTO con shippingFeeCents" },
  "checkoutToken": "9f8a…43-chars-base64url", "checkoutTokenExpiresAt": "2026-08-18T16:30:00Z",
  "stripe": { "paymentIntentId": "pi_…", "clientSecret": "…" } }
```
> **`checkoutToken` — token de VIDA CORTA (v1.21.1, corrección normativa).** Quien llama a este endpoint **es** quien
> crea el pedido, así que devolvérselo no filtra nada (solo abre *ese* pedido, cuyos datos el llamante acaba de
> escribir). Resuelve el problema real de la pantalla de confirmación: tras el redirect 3DS de Stripe el navegador
> puede perder el estado y, sin sesión, la confirmación no podría leer nada. El front lo usa para armar el
> `return_url` y renderizar confirmación + seguimiento inmediato.
> **TTL = `GUEST_CHECKOUT_TOKEN_TTL_MIN` (120 minutos), NO 90 días.** Es un `OrderAccessToken` normal (mismo modelo,
> misma tabla, **sin columna nueva**): lo único que lo distingue es su `expiresAt`. Ver §4-G.7a para el porqué de
> las dos vidas.
> **Es la ÚNICA respuesta de API que contiene un token en claro** (invariante §4-G.0-5). **Regla para el front:** no
> persistirlo en `localStorage` compartido ni loguearlo; tratarlo como secreto de URL (§4-G.7).

`orderId` (uuid) se devuelve **solo aquí** (lo necesita el flujo de pago/soporte); **no** aparece en la vista pública
de seguimiento.

Err: `400 VALIDATION_ERROR` (correo inválido/vacío, dirección incompleta, `acceptedTerms` ausente, carrito
vacío/`>20`), `422 ADDRESS_NOT_MX` (criterio 48b / 31), `422 VAULT_REQUIRES_ACCOUNT`, `422 PRICE_PENDING`,
`409 ITEM_UNAVAILABLE`, `409 ALREADY_AUTHENTICATED`, `429 RATE_LIMITED`, `503 PAYMENT_PROVIDER_UNAVAILABLE`
(mismo comportamiento compensatorio A2 de §4: se libera la reserva y la orden queda `failed`).
> **Ids únicos — adenda v1.21.3-quote-prune (2026-08-18, hallazgo B-1):** igual que `POST /checkout/session` (§4),
> este endpoint **no deduplica**: `inventoryItemIds` duplicados o no resolubles producen el `404 NOT_FOUND` /
> `409 ITEM_UNAVAILABLE` estricto vigente. El cliente DEBE enviar ids únicos — el carrito del front ya lo garantiza.
**NO aplica `403 EMAIL_NOT_VERIFIED`** (no hay cuenta que verificar) — ver la asimetría documentada en §4-G.8.

### 4-G.3 POST /api/v1/orders/guest/track — `public` (`@Public()`)

Vista pública de seguimiento de **un** pedido. **Es un POST, no un GET, deliberadamente**: el token viaja en el
**cuerpo**, no en la ruta, para que no aparezca en access logs, `Referer`, historial de proxies ni cachés
intermedias (el front ya lo recibe por query string desde el correo y lo mueve al body en la llamada de API).

Rate limit: `@Throttle({ default: { ttl: 60_000, limit: 20 } })` (por IP).
Cabeceras de respuesta obligatorias: `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`.

Req: `{ token: string }`

Res `200` — **`GuestOrderTrackingDTO`. Este DTO es el corazón de la seguridad de la feature (criterio 51).**
```ts
GuestOrderTrackingDTO = {
  orderNumber: string,                    // "TCG-000123" — identificador legible; NO es el uuid interno
  status: GuestOrderPublicStatus,         // derivado (§4-G.5); el front traduce el enum
  placedAt: string,                       // ISO — Order.createdAt
  paidAt?: string,                        // ISO — Order.settledAt (ausente si aún no liquida)
  emailMasked: string,                    // "j***@***.com" (confirma al comprador QUÉ correo usó, sin revelarlo)
  items: GuestTrackingItemDTO[],
  breakdown: BreakdownDTO,                // con shippingFeeCents; es lo que el comprador pagó
  shipping: GuestTrackingShippingDTO,
  payment?: GuestTrackingPaymentDTO,      // presente solo tras liquidar
  claim: { available: boolean },          // true si el pedido aún NO está vinculado a una cuenta (oferta de registro)
  support: { evidenceContact: string,       // correo de soporte RESUELTO SERVER-SIDE desde configuración (§0):
                                            //   forma normada, valor NO normado. Siempre presente y no vacío.
                                            //   El front lo RENDERIZA; no lo hardcodea ni lo assertá en contrato.
             disputeWindowDays: 7,
             disputeDeadlineAt?: string }, // presente solo si hay entrega (deliveredAt + 7d) — criterio 56b
  tokenExpiresAt: string                  // para que la UI avise "tu enlace caduca el …" y ofrezca reenvío
}
GuestTrackingItemDTO = {
  name: string, setName: string, number: string,       // identificación de la carta (datos de catálogo, públicos)
  finish: Finish, productType: ProductType,
  rawCondition?: RawCondition, sealedSubtype?: SealedSubtype,
  gradingCompany?: GradingCompany, gradeValue?: string,
  imageSmallUrl?: string,                              // imagen de catálogo remota (pokemontcg.io)
  unitPriceCents: number
}
GuestTrackingShippingDTO = {
  city: string, state: string,
  postalCodeMasked: string,          // "***45" — SOLO los 2 últimos dígitos del CP
  recipientNameMasked: string,       // "Juan P." — nombre + inicial del apellido
  carrier?: string, trackingNumber?: string,   // guía cuando existe (criterio 50)
  shippedAt?: string, deliveredAt?: string
}
GuestTrackingPaymentDTO = { brand?: string, last4?: string }   // "visa", "4242" — NADA más
```

**Lo que este DTO NO expone (lista cerrada y normativa; cualquier campo fuera de la lista de arriba está prohibido):**

| Categoría | Prohibido | Por qué |
|---|---|---|
| Identificadores internos | `orderId` (uuid), `userId`, `inventoryItemId`, `folio`, `cardId`, `locationId`, `shipmentId`, `orderItemId` | El enlace no debe ser puente hacia ningún otro endpoint ni permitir correlacionar inventario. |
| Dirección | `line1`, `line2`, `neighborhood`, CP completo, nombre completo del destinatario | PROJECT §J: "no muestra la dirección completa; a lo mucho ciudad/estado y últimos dígitos del CP". |
| Contacto | correo completo, teléfono (ni parcial) | El enlace puede ser reenviado; el correo/teléfono son PII reutilizable para phishing. |
| Pago | `stripePaymentIntentId`, `clientSecret`, `stripeChargeId`, titular de la tarjeta, BIN, `receipt_url` | Solo marca + `last4` (criterio 51). El `clientSecret` permitiría reintentar el cobro. |
| Operación interna | `chargebackNeedsManual`, `disputeOutcome`, `shippingCostCents` (costo del carrier), notas de picking, ubicaciones, `acquisitionCost*`, `billingSnapshot` | Datos internos/financieros; `shippingCostCents` ya es interno para el cliente con cuenta (§5). |
| Otros pedidos | cualquier lista, conteo o referencia a otro pedido del mismo correo | Un token = **un** pedido (criterio 52). |
| Acciones | **ninguna**: no cancelar, no reembolsar, no cambiar dirección, no reenviar-a-otro-correo, no abrir disputa, no editar nada | El enlace sustituye a una contraseña; solo lee. Todo cambio exige cuenta o soporte. |

**Errores (respuesta neutra, sin cuerpo de pedido):**
- `404 INVALID_TOKEN` — el hash **no existe** en `OrderAccessToken` (token inventado, manipulado o de un pedido ya
  borrado). Mensaje genérico; **no** dice si el pedido existe (criterio 52).
- `410 TOKEN_EXPIRED` — el token existe pero `expiresAt < now`. La página muestra mensaje neutro y **ofrece
  reenviar** (criterio 53).
- `410 TOKEN_REVOKED` con **`details.reason = "CLAIMED" | "ROTATED"`** — el enlace dejó de valer porque el pedido se
  **reclamó** (hay cuenta detrás: el front invita a iniciar sesión) o porque se **emitió uno nuevo** (el front
  invita a usar el último correo o a pedir reenvío).
  > **v1.21.1 — el `reason` se DERIVA, no se persiste (decisión: ningún campo nuevo).** Regla normativa:
  > `order.claimedAt != null` ⇒ `"CLAIMED"`; en cualquier otro caso ⇒ `"ROTATED"`. **El valor `"SUPPORT"` se
  > ELIMINA del contrato** (era inderivable sin una columna de motivo): una rotación hecha por soporte se reporta
  > como `"ROTATED"`, que es exactamente lo que el usuario necesita saber ("tu enlace fue sustituido por uno
  > nuevo"). **La distinción no se pierde para forense**: el reenvío de soporte deja `AuditLog`
  > (`action: 'order.tracking_link.reissue'`, con actor y timestamp) y el self-service no. Se acepta a conciencia
  > que el **cuerpo de la respuesta** no distinga quién rotó: es copy de UX, no un dato de auditoría, y añadir una
  > columna para pintar un texto distinto no lo justifica.
- `429 RATE_LIMITED`.
> **Por qué distinguir "expirado/revocado" de "inválido" NO es un oráculo:** para obtener un `410` hay que
> **presentar un token real de 256 bits**, que solo se consigue teniéndolo. No existe espacio adivinable donde la
> distinción dé información. En cambio sí sería un oráculo distinguir por **correo** o por **número de pedido**;
> por eso el reenvío (§4-G.4) responde igual siempre. Detalle en ARCHITECTURE §4.21e.

### 4-G.4 POST /api/v1/orders/guest/resend-link — `public` (`@Public()`)

Reenvía **al correo del pedido** (nunca a otro) un enlace nuevo. **Rota**: emitirlo revoca los anteriores.

Rate limit: `@Throttle({ default: { ttl: 3_600_000, limit: 3 } })` (por IP — mismo perfil que `forgot-password`)
**más** un tope por pedido de `GUEST_RESEND_MAX_PER_DAY` (**5**/24h, contando `OrderAccessToken` emitidos).

Req — unión discriminada; **una de las dos formas**:
```ts
GuestResendLinkRequest =
  | { token: string }                          // desde la página de "enlace expirado" (camino preferente)
  | { email: string, orderNumber: string }     // ambos OBLIGATORIOS juntos
```
> **`email` solo NUNCA se acepta.** Pedir además el número de pedido lo inutiliza como oráculo ("¿este correo
> compró aquí?") y como vector de spam a terceros: un par incorrecto no produce ningún correo. El envío siempre va
> a `Order.guestEmail`, **jamás** al correo del request (que solo se usa para comparar).
> **v1.21.1 — el `token` sirve como selector aunque esté EXPIRADO o REVOCADO** (es el caso normal: se llega aquí
> desde la página de "enlace expirado", y también desde un `checkoutToken` de 120 min ya vencido). La búsqueda es
> por hash **sin filtrar por `expiresAt`/`revokedAt`**; lo único que un token caduco **no** puede hacer es *leer*
> el pedido (§4-G.3). Emitir el nuevo **rota** y revoca todos los vivos (§4-G.7a).
> **v1.21.1 — discrepancia con `DESIGN_SYSTEM §15.7` (reenvío pidiendo solo el correo): manda el contrato y NO se
> relaja.** Un formulario de "reenviar por correo" a secas es exactamente el oráculo que el criterio 53 prohíbe
> ("que no sirva para saber si un correo compró aquí") y, además, un vector para mandar correos a terceros. La UI
> debe pedir **correo + número de pedido** (el número se le mostró en la confirmación y va en el correo) o venir
> con el token de la página de enlace expirado. *(ux-ui: ajustar §15.7 en su documento.)*

Res **`202`** — **SIEMPRE el mismo cuerpo, exista o no el pedido/correo/token** (criterio 53):
```json
{ "status": "ACCEPTED" }
```
No hay `404`, ni `200` vs `202` diferenciados, ni diferencia de tiempos observable (el trabajo real es
post-respuesta / best-effort). **Únicos errores posibles: `400 VALIDATION_ERROR`** (forma del request malformada —
p. ej. `email` sin `orderNumber`, o ambas formas a la vez) **y `429 RATE_LIMITED`**.
> **`422 GUEST_ORDER_TOO_OLD` NO se devuelve aquí** (sería un oráculo de existencia): un pedido fuera del tope de
> edad (`GUEST_TRACKING_MAX_AGE_DAYS`, 365 días) simplemente **no genera correo** y la respuesta sigue siendo
> `202 ACCEPTED`. Ese código solo lo usa el endpoint **admin** de §4-G.9b, donde el llamante ya está autenticado.

### 4-G.5 Mapeo normativo `Order.status` (+ envío) → `GuestOrderPublicStatus`

El estado público **no es una columna**: se deriva. La API devuelve el **enum**; el texto legible vive en i18n del
front (§0). Progreso de PROJECT §J: `pagado → preparando → guía → enviado → entregado`.

| `Order.status` | `ShipmentRequest.status` del pedido | `GuestOrderPublicStatus` |
|---|---|---|
| `pending` | (aún no existe) | `pendiente_pago` |
| `settled` | (no existe todavía — ventana entre webhook y creación) | `pagado` |
| `settled` | `solicitado` \| `picking` | `preparando` |
| `settled` | `guia` | `guia` |
| `settled` | `enviado` | `enviado` |
| `settled` | `entregado` | `entregado` |
| `settled` | `cancelado` | `en_revision` |
| `failed` | cualquiera | `cancelado` |
| `refunded` | cualquiera | `reembolsado` |
| `chargeback` | cualquiera | `en_revision` |

> `chargeback` **no se nombra** hacia el invitado (`en_revision`): decir "contracargo" en una vista sin autenticar
> da información operativa a quien tenga el enlace. `refunded` sí se nombra (el comprador ya lo sabe por su banco).

### 4-G.6 Ciclo de vida de los items de un pedido de invitado (contrato observable)

Ningún estado nuevo: se estrenan `picking | shipped | delivered` de `InventoryStatus`, que v1.17 dejó **sin uso por
diseño** (el retiro de bóveda no los escribe; ver ARCHITECTURE §3.3). Diseño completo en ARCHITECTURE §4.21c.

```
listed | in_stock
  → POST /checkout/guest/session      : status=reserved   (ownerType SIGUE platform, ownerUserId=null,
                                                           ownershipStatus=null — NO hay bóveda)
  → webhook payment_intent.succeeded  : status=picking     + Order settled + se CREA el ShipmentRequest
                                                             (userId=null, orderId set, status='picking')
  → PATCH /admin/shipments/:id/status → enviado  : status=shipped
  → PATCH /admin/shipments/:id/status → entregado: status=delivered      (TERMINAL; NO es `withdrawn`)
  → webhook payment_intent.payment_failed | canceled : status → listed (libera reserva; Order failed)
  → webhook charge.dispute.created (contracargo)     : DECIDE EL ESTADO DEL ENVÍO, no el del item (abajo)
```

**Contracargo — tabla normativa (v1.21.2, corrección de un hueco bloqueante).** La v1.21 describía el reverso solo
por el `InventoryItem`, y eso producía un **double-sell físico**: con el envío en `picking`/`guia` el item volvía a
`listed` **mientras el envío seguía en la cola de picking**, así que la misma pieza única podía venderse a un
segundo comprador mientras el operador la metía en la caja del contracargo. **Norma: el contracargo NUNCA re-lista
automáticamente una pieza con envío vivo.** Diseño y justificación en ARCHITECTURE §4.21c-bis.

| Envío del pedido al llegar el contracargo | `ShipmentRequest` | `InventoryItem` | `chargebackNeedsManual` |
|---|---|---|---|
| **No existe** (orden `pending`) o **`cancelado`** | — | `reserved → listed`, `ownerType=platform` (+ movimiento `chargeback_return`) | `false` |
| **`solicitado` \| `picking` \| `guia`** | **→ `cancelado`** en la MISMA transacción (sale de `GET /admin/shipments/picking-list`) | **CONGELADO** en `picking`: **NO** vuelve a `listed`, **NO** cambia `ownerType` | **`true`** |
| **`enviado` \| `entregado`** | sin cambio | sin cambio (`shipped` / `delivered`) | **`true`** |

> **Invariante que se eleva a norma:** *una pieza con un `ShipmentItem` en un envío **no terminal** jamás puede
> estar en `{listed, in_stock}`*. La pieza congelada queda doblemente fuera de venta: por su `status` (`picking` ∉
> `{listed, in_stock}` ⇒ `409 ITEM_UNAVAILABLE` en checkout y `422 ITEM_NOT_PUBLISHABLE` en `bulk-publish`) y
> porque su envío ya no está en la cola. **Ningún estado ni enum nuevo**: se reusa `ShipmentStatus.cancelado`.

El desenlace de una pieza congelada lo confirma **un humano** con
**`POST /admin/orders/:id/chargeback-inventory`** (§M3): sin esa acción la pieza quedaría congelada para siempre.
- **`delivered` vs `withdrawn`:** `withdrawn` significa "salió de la bóveda de un cliente" y es la terminal del
  retiro (§5/§M4). Un pedido de invitado **nunca estuvo en bóveda**, así que su terminal es `delivered`. M4 debe
  **ramificar** por `ShipmentRequest.orderId != null` (ver §M4).
- **Efecto en conteos de M1 (documentado, aceptado):** una pieza `reserved`/`picking` de un pedido de invitado
  sigue siendo `ownerType='platform'` y por tanto **cuenta como "on-hand"** en el master set de plataforma (§M1)
  hasta que pasa a `shipped`. Es coherente con el criterio físico ("la carta sigue en el almacén") y con que
  `reserved` ya contaba; **no** se cambia la regla `on-hand` de §M1 (es de otro work stream).
- **Anti double-sell:** `picking`/`shipped`/`delivered` no están en `{in_stock, listed}`, así que ni el checkout
  (`ITEM_UNAVAILABLE`) ni `bulk-publish` (`ITEM_NOT_PUBLISHABLE`) ni el ajuste de M1 (`ITEM_NOT_ADJUSTABLE`) pueden
  tocarlos. **No hace falta ninguna guarda nueva** en esos endpoints.
- **`InventoryMovement.reason` de cada transición (v1.21.1 — NORMATIVO; no se añade ningún valor al enum):**

  | Transición | Disparador | `reason` |
  |---|---|---|
  | `reserved → picking` | `payment_intent.succeeded` (pedido liquidado) | **`settle`** — mismo motivo y mismo evento que la ruta de bóveda (`reserved → in_custody`); lo que cambia es el `toStatus`, no la causa. |
  | `picking → shipped` | M4 `→ enviado` | **`sale`** — la pieza sale del almacén por una **venta**. |
  | `shipped → delivered` | M4 `→ entregado` | **`sale`** — cierre de la misma venta. |
  | `reserved → listed` | pago fallido/cancelado | **sin `InventoryMovement`** — se conserva el comportamiento actual de la liberación de reserva (§4/§9), que tampoco lo registra para pedidos con cuenta. No se introduce asimetría entre las dos rutas. |
  | `reserved\|picking → listed` | contracargo | **`chargeback_return`** (sin cambio respecto a la ruta de bóveda). |

  **`withdrawal` queda PROHIBIDO en el ciclo de invitado.** Ese motivo significa "retiro de la bóveda de un
  cliente" y usarlo aquí ensuciaría los reportes de custodia (un pedido de invitado nunca estuvo en bóveda), igual
  que `delivered` existe para no mentir con `withdrawn`. Las dos filas `sale` de un mismo item se distinguen sin
  ambigüedad por `fromStatus`/`toStatus` (`picking→shipped` vs `shipped→delivered`), así que no hace falta un
  motivo nuevo para "entregado".

### 4-G.7 El enlace tokenizado — parámetros normativos

| Aspecto | Decisión | Razón |
|---|---|---|
| Tipo | **Token opaco aleatorio**, `randomBytes(32).toString('base64url')` (256 bits, 43 chars). **NO JWT** | Revocable por fila; no lleva claims que filtrar; no depende de rotación de secreto; un dump de BD **no** produce enlaces válidos (solo hay hashes). Mismo patrón ya probado en `AuthToken` (ARCHITECTURE §3.2). |
| Persistencia | Solo `SHA-256` hex en `OrderAccessToken.tokenHash @unique`. El claro **jamás** se guarda | Idéntico a `AuthToken`. SHA-256 basta (256 bits de entropía: no hay fuerza bruta posible, a diferencia de una contraseña). |
| Usos | **MULTI-USO** (a diferencia de `AuthToken`): **no** hay `usedAt` | El invitado reabre el mismo enlace cada vez que quiere ver su pedido (criterio 50). |
| Revocación | `revokedAt DateTime?`. Se revoca al **reclamar** el pedido, al **rotar** (reenvío self-service o de soporte) | "Revocable sí, consumible no". |
| Rotación | **Solo el reenvío** (§4-G.4) y el **reenvío de soporte** (§4-G.9b) rotan: revocan **todos** los tokens vivos del pedido y emiten uno nuevo ⇒ **solo el último enlace funciona**. La emisión del token de correo en el settle **NO rota** (§4-G.7a) | Limita las puertas abiertas simultáneas; mismo criterio que `AuthToken.issue`, con la excepción acotada del settle. |
| TTL | **Dos vidas, según origen** (§4-G.7a): token de **checkout** = `GUEST_CHECKOUT_TOKEN_TTL_MIN` (**120 min**); token de **correo/reenvío/soporte** = `GUEST_TRACKING_TTL_DAYS` (**90 días**, supuesto del PO — cubre entrega + ventana de disputa con margen). Se distinguen **solo** por `expiresAt`; **no hay columna de tipo** | PROJECT §J. Los 90 días son **revisables por el humano** (pregunta abierta v1.5-2). |
| Tope de edad | No se emiten tokens nuevos para pedidos con `createdAt` anterior a `GUEST_TRACKING_MAX_AGE_DAYS` (**365 días**) | Evita que el reenvío mantenga la puerta abierta para siempre. Pasado ese punto, la vía es el **reclamo** (que no necesita enlace) o soporte. |
| Transporte | El correo lleva `${APP_BASE_URL}/${locale}/pedido?token=<claro>`; el front mueve el token al **body** de `POST /orders/guest/track` y lo **borra de la URL** (`history.replaceState`) | Minimiza exposición en historial/`Referer`. La página debe ser `noindex` y `Referrer-Policy: no-referrer`. |
| Alcance | **Un token ⇒ un pedido** (`orderId` en la fila). No hay token "de correo" ni token multi-pedido | Criterio 52. |

#### 4-G.7a Ciclo de vida de los tokens de un pedido — CORRECCIÓN NORMATIVA (v1.21.1)

**Qué estaba mal.** La v1.21 decía que "el **mismo** token se envía por correo al liquidar". **Es irrealizable**: en
BD solo vive el `SHA-256`, así que el claro devuelto en el checkout **no es recuperable** por el webhook. Y "rotar
al liquidar" tampoco sirve: mataría justo el token que el navegador está usando en la pantalla de confirmación tras
el 3DS — precisamente la UX que el propio contrato describe.

**Qué es normativo ahora.** Un pedido de invitado tiene **dos emisiones** con **vidas deliberadamente distintas**:

| | Token de **checkout** | Token de **seguimiento** |
|---|---|---|
| Lo emite | `POST /checkout/guest/session` | el webhook `payment_intent.succeeded` (§9), el reenvío (§4-G.4) y soporte (§4-G.9b) |
| Se entrega | en la **respuesta HTTP** al comprador | **solo por correo** |
| TTL | **120 min** (`GUEST_CHECKOUT_TOKEN_TTL_MIN`) | **90 días** (`GUEST_TRACKING_TTL_DAYS`) |
| ¿Rota los anteriores? | n/a (es el primero) | **NO** en el settle · **SÍ** en reenvío/soporte |
| Para qué | confirmación post-3DS y seguimiento inmediato | el enlace duradero de PROJECT §J (criterios 49/50/53) |

- **Sí hay dos puertas vivas a la vez, pero solo durante ≤2 horas.** Pasado el TTL corto queda **una sola** puerta
  de larga duración. Esto era el punto débil de la lectura anterior (dos tokens de 90 días por pedido **duplicaban
  la exposición del enlace sin contraseña durante tres meses**, sin ningún beneficio: el token de checkout no se
  vuelve a usar una vez que llega el correo).
- **El settle NO rota** — es la excepción acotada y la razón está arriba: rotar mataría la confirmación en curso.
  Es seguro precisamente porque el token que sobrevive sin rotar (el de checkout) **se apaga solo** en 2 horas.
- **Reenvío y soporte SÍ rotan**: revocan **todos** los tokens vivos del pedido (los de ambas vidas) y emiten uno
  nuevo de 90 días. Tras un reenvío, el enlace del correo anterior **y** cualquier token de checkout residual
  devuelven `410 TOKEN_REVOKED`.
- **El reclamo revoca todo** (sin cambio respecto a v1.21).
- **Sin columna nueva:** ambas emisiones son filas idénticas de `OrderAccessToken`; lo único que las distingue es
  `expiresAt`. No hay `type`, ni `purpose`, ni migración adicional.
- **Si el correo falla** (envío best-effort), el comprador conserva 2 horas de acceso por el token de checkout y,
  después, el camino es el **reenvío** con `{ email, orderNumber }` — datos que la pantalla de confirmación le
  mostró. No queda sin salida.

### 4-G.8 Endpoints existentes: qué cambia y qué NO

**No cambia la forma de ningún endpoint anterior.** Lo que cambia es lo que puede haber detrás:

- **`POST /checkout/quote` y `POST /checkout/session` (`customer`) — SIN cambios.** Siguen creando pedidos
  `fulfillmentMode='vault'` (default de columna). El envío directo para usuarios **con cuenta** queda **fuera del
  alcance v1.5** aunque el modelo ya lo soporte (extensión futura sin migración).
- **`GET /orders` y `GET /orders/:orderId` (`customer`) — SIN cambios de shape.** Siguen filtrando por
  `Order.userId`; un pedido de invitado **reclamado** tiene `userId` poblado y por eso aparece en el historial
  (criterio 54). Un pedido de invitado **no reclamado** tiene `userId=null` y `userId !== :sessionUser` para
  cualquier sesión ⇒ `403/404` como hoy. **`Order.userId` nullable no relaja ninguna autorización**: la comparación
  `order.userId !== userId` sigue siendo la única puerta, y `null` nunca iguala a un uuid de sesión.
  - **Aditivo opcional en el detalle:** `isGuestOrder: boolean` (= `guestEmail != null`) y `claimedAt?: string`,
    para que la UI pueda etiquetar "pedido hecho como invitado". Sin PII (no expone el correo).
- **`POST /orders/:orderId/request-invoice` (`customer`) — SIN cambios.** Un invitado **no** puede pedir factura por
  API (no tiene sesión): el aviso de **factura CFDI manual por correo** del checkout es su vía (mismo mensaje que
  ya existe). Si reclama el pedido, el endpoint queda disponible con normalidad.
- **`POST /shipments`, `POST /shipments/quote`, `GET /shipments[...]` (`customer`) — SIN cambios y SIN relajar
  guardas.** `ShipmentRequest.userId` se vuelve nullable **solo** para alojar los envíos directos creados por el
  servidor; todos estos endpoints siguen exigiendo sesión y filtrando por `userId = :sessionUser`.
  **Norma explícita:** `GET /shipments` / `GET /shipments/:id` deben filtrar `userId = :sessionUser` de forma
  **positiva** (nunca "≠ otro"), de modo que un envío con `userId=null` **jamás** aparezca en la lista de nadie
  (una consulta mal escrita del tipo `where: { userId: { not: X } }` o un `findUnique` sin comparar dueño sí lo
  expondría — es el riesgo #1 de esta migración y QA debe cubrirlo con un caso negativo).
- **`POST /disputes` (`customer`) — SIN cambios.** El invitado **no** abre disputa por API (criterio 56b se cumple
  por correo a soporte citando su `orderNumber`); el súper-admin evalúa y, si procede, ejecuta **reembolso en M3**
  (`POST /admin/orders/:id/refund`), que ya funciona sobre cualquier orden. Consecuencia consciente: en v1.5 **no
  se crea fila `Dispute`** para un invitado (se evita volver `Dispute.userId` nullable); la trazabilidad queda en
  el `AuditLog` del reembolso. Ver ARCHITECTURE §4.21f (deuda propuesta).
- **`EmailVerifiedGuard` — asimetría deliberada.** Un `customer` con `emailVerified=false` **no** puede comprar
  (`403 EMAIL_NOT_VERIFIED`), pero un invitado **sí** compra sin verificar nada. No es una inconsistencia: la
  verificación protege **privilegios persistentes** (bóveda, retiros, buylist con dinero saliente) que el invitado
  **no tiene**. Lo único que el invitado obtiene por su correo es el enlace de **su propio** pedido, y si el correo
  es incorrecto el único perjudicado es él (el pedido igual se prepara y envía). El **reclamo**, en cambio, sí
  otorga acceso persistente y **exige `emailVerified`** (§4-G.9).

### 4-G.9 Reclamo del pedido (conversión a cuenta)

**Prueba de titularidad — decisión explícita: basta (y se exige) el CORREO VERIFICADO de la cuenta.** No sirve el
token, ni el número de pedido, ni conocer el correo: hay que **demostrar control del buzón**, que es exactamente la
misma prueba con la que el invitado recibió su enlace. Por eso:
- El reclamo **exige** `user.emailVerified === true` → si no, **`403 EMAIL_NOT_VERIFIED`** (mismo código y guard ya
  existentes). Sin este requisito, cualquiera podría registrarse con el correo de un tercero y quedarse su pedido.
- El reclamo **es siempre explícito** (nunca silencioso, ni en el registro ni en el pago): PROJECT §J + decisión del
  orquestador. **Política revisable por el humano** (pregunta abierta v1.5-1). El modelo la soporta **sin
  migración**: `guestEmail` queda en el pedido y la vinculación es un `UPDATE` posterior — para pasar a
  "auto-vínculo al pagar" basta poblar `userId`+`claimedAt` en el settle, y para "exigir login" basta un check en
  el checkout. **Nada de esto se implementa hoy.**

#### GET /api/v1/orders/claimable — `customer` (+ `emailVerified`)
Lista los pedidos de invitado **sin reclamar** cuyo `guestEmail` == el correo (normalizado) de la sesión.
Rate limit: `@Throttle({ default: { ttl: 60_000, limit: 30 } })`.
> **Nota de implementación (Nest):** declarar esta ruta **antes** de `@Get(':orderId')` en `OrdersController`, o
> `claimable` se resolverá como un `orderId`.

Res `200`: `{ data: ClaimableOrderDTO[] }` (sin paginar; volumen esperado ínfimo)
```ts
ClaimableOrderDTO = { orderId: string, orderNumber: string, status: OrderStatus,
                      totalCents: number, itemCount: number, createdAt: string, settledAt?: string }
```
Err: `401`, `403 EMAIL_NOT_VERIFIED`.
> **No es un oráculo:** solo informa sobre el correo **verificado** de quien pregunta. Nunca acepta un correo como
> parámetro.

#### POST /api/v1/orders/claim — `customer` (+ `emailVerified`, auditado)
Req: `{ orderIds: string[] }` (1..50; los ids vienen de `/orders/claimable`).
Rate limit: `@Throttle({ default: { ttl: 3_600_000, limit: 10 } })`.

Semántica **por pedido** (transaccional, condicional, ganador único):
`UPDATE Order SET userId=:me, claimedAt=now() WHERE id=:id AND userId IS NULL AND guestEmail=:myVerifiedEmail`
→ `count===1` gana; `count===0` ⇒ ya reclamado o correo distinto. Cierra la carrera de dos reclamos simultáneos
(criterio 55) sin bloqueos.

Efectos del reclamo (y **solo** estos): `Order.userId`, `Order.claimedAt`, **revocación de todos los
`OrderAccessToken` del pedido** (`revokedAt=now`, `reason=CLAIMED`) y `AuditLog` (`action: 'order.claim'`,
`entityType: 'Order'`, actor = usuario). **NO cambia** destino (sigue `direct_ship`), precio, desglose, políticas,
estado del pedido ni el estado/propiedad de los items (criterio 54). Un pedido **ya enviado o entregado** se
reclama igual.

Res `200`: `{ claimed: string[], failed: [{ orderId, code: "ORDER_ALREADY_CLAIMED" | "CLAIM_EMAIL_MISMATCH" | "NOT_FOUND" }] }`
(la operación es **parcial-tolerante**: un pedido fallido no tumba los demás; HTTP `200`).
Err globales: `401`, `403 EMAIL_NOT_VERIFIED`, `400 VALIDATION_ERROR`, `429`.
> **Consecuencia de revocar al reclamar:** un enlace viejo abierto después responde `410 TOKEN_REVOKED`
> (`reason: "CLAIMED"`) y el front invita a iniciar sesión. Es deliberado: una vez que el pedido tiene una
> credencial real detrás, dejar puertas sin contraseña abiertas suma riesgo sin aportar nada.

#### 4-G.9b POST /api/v1/admin/orders/:id/tracking-link — `vault_operator+` (auditado)
Soporte reenvía/rota el enlace de un pedido de invitado (PROJECT §J: "el token también puede reenviarse desde
soporte"). Emite un token nuevo (revocando los previos) y lo envía a `Order.guestEmail`. **No** devuelve el token.
Res `200`: `{ orderNumber, sentTo: "j***@***.com", expiresAt }`.
Err: `404 NOT_FOUND`, `422 GUEST_ORDER_TOO_OLD` (fuera del tope de 365 días), `422 VALIDATION_ERROR` (el pedido no
es de invitado: `guestEmail` nulo). `AuditLog action: 'order.tracking_link.reissue'`. **No es money-out.**

### 4-G.10 Impacto en el esquema de Prisma (migración M-25)

> ⚠️ **`backend/prisma/schema.prisma` es ZONA COMPARTIDA.** El arquitecto **especifica**, **backend aplica**, y el
> **orquestador serializa** esta migración frente a cualquier otro stream. Detalle y notas de compatibilidad en
> ARCHITECTURE §11 (M-25).

**Enum nuevo**
```prisma
enum FulfillmentMode { vault direct_ship }
```

**`Order` — campo por campo**
| Campo | Cambio | Nulabilidad / default | Nota |
|---|---|---|---|
| `userId` | `String` → **`String?`** | nullable | Único cambio **destructivo-de-constraint** de la migración (`DROP NOT NULL`). La relación pasa a `user User? @relation(fields:[userId], references:[id])`. |
| `@@index([userId])` | **se CONSERVA** | — | Un índice B-tree de Postgres indexa filas con `NULL`, y las consultas existentes (`where userId = X`) lo siguen usando igual. **No hay que recrearlo.** |
| `guestEmail` | **columna nueva** `String?` | nullable | Correo del invitado, **normalizado** (trim + lowercase) por la aplicación. `guestEmail != null` ⇔ el pedido **nació** como pedido de invitado (inmutable, sobrevive al reclamo). |
| `@@index([guestEmail])` | **índice nuevo** | — | Sirve `GET /orders/claimable` y el reenvío por `(email, orderNumber)`. |
| `fulfillmentMode` | **columna nueva** `FulfillmentMode` | **`@default(vault)`** | El default preserva **exactamente** el comportamiento actual: todo pedido existente y todo pedido de `POST /checkout/session` es `vault`. |
| `shippingAddressSnapshot` | **columna nueva** `Json?` | nullable | Dirección capturada en línea (el invitado no tiene `Address`). Mismo criterio de *snapshot* que `ShipmentRequest.addressSnapshot`. Obligatoria a nivel de aplicación cuando `fulfillmentMode='direct_ship'`. |
| `shippingFeeCents` | **columna nueva** `Int` | **`@default(0)`** | Envío cobrado **dentro** de esta orden. `0` en pedidos a bóveda ⇒ el P&L histórico no cambia. |
| `orderNumber` | **columna nueva** `String?` **`@unique`** | nullable + backfill | Número legible `TCG-000123` (criterios 45/49/53/56b). Se genera con una **secuencia Postgres** `order_number_seq`, mismo patrón que `inventory_folio_seq` (`PrismaService.nextFolio`). Nullable **solo** para permitir el backfill; la aplicación lo escribe **siempre** en pedidos nuevos. |
| `claimedAt` | **columna nueva** `DateTime?` | nullable | Momento del reclamo. Con `guestEmail != null`: `claimedAt = null` ⇒ reclamable; `!= null` ⇒ ya vinculado. |
| `locale` | **columna nueva** `Locale?` | nullable | Idioma del correo del invitado (no hay `User.locale`). Resolución: `order.locale ?? user.locale ?? 'es'`. |
| `paymentMethodBrand` | **columna nueva** `String?` | nullable | Marca de tarjeta capturada del `charge` al liquidar. Alimenta `GuestTrackingPaymentDTO`. |
| `paymentMethodLast4` | **columna nueva** `String?` | nullable | **Solo** los 4 últimos (dato permitido por PCI-DSS; nunca PAN, ni BIN, ni titular). |
| `accessTokens` | **relación nueva** | — | `OrderAccessToken[]`. |
| `shipmentRequests` | **relación nueva** | — | `ShipmentRequest[]` (envíos que fulfillan esta orden). |

**`ShipmentRequest`**
| Campo | Cambio | Nulabilidad / default | Nota |
|---|---|---|---|
| `userId` | `String` → **`String?`** | nullable | `null` **solo** en el envío directo de un pedido de invitado. `@@index([userId])` **se conserva**. |
| `orderId` | **columna nueva** `String?` + FK a `Order` | nullable | `null` = retiro de bóveda (todo lo existente). `!= null` = envío directo que fulfilla ese pedido. **Discriminador** que usa M4 para ramificar la transición terminal. |
| `@@index([orderId])` | **índice nuevo** | — | Join orden→envío de la vista de seguimiento. **No `@unique`**: deja abierta la re-expedición (pérdida en tránsito) sin migrar. Invariante de aplicación: **a lo más un envío activo por orden**. |

**Modelo nuevo `OrderAccessToken`**
```prisma
model OrderAccessToken {
  id         String    @id @default(uuid())
  orderId    String
  order      Order     @relation(fields: [orderId], references: [id], onDelete: Cascade)
  tokenHash  String    @unique     // SHA-256 hex del claro (32 bytes base64url). El claro NUNCA se persiste.
  expiresAt  DateTime
  revokedAt  DateTime?             // MULTI-USO: revocable, NO consumible (no hay usedAt)
  lastUsedAt DateTime?             // telemetría de abuso (opcional de escribir)
  useCount   Int       @default(0)
  requestIp  String?
  createdAt  DateTime  @default(now())

  @@index([orderId])
  @@index([expiresAt])
}
```

**Invariantes de aplicación (recomendado además como `CHECK` en SQL crudo dentro de la migración)**
1. `userId IS NOT NULL OR guestEmail IS NOT NULL` — ningún pedido queda huérfano.
2. `guestEmail IS NOT NULL ⇒ fulfillmentMode = 'direct_ship'` — no hay bóveda para invitados (v1.5).
3. `fulfillmentMode = 'direct_ship' ⇒ shippingAddressSnapshot IS NOT NULL`.
4. `claimedAt IS NOT NULL ⇒ userId IS NOT NULL AND guestEmail IS NOT NULL`.
5. **`InventoryItem`: `CHECK (ownerType <> 'customer' OR ownerUserId IS NOT NULL)`** — **v1.21.2 (D6): pasa de
   "invariante de aplicación" a `CHECK` NORMATIVO (migración M-25b)**, y sí es expresable en SQL simple (la v1.21
   decía lo contrario, por error). Era el **único** de los cinco sin implementar, y es justo el que §4-G.0-1 llama
   «lo que hace segura la nulabilidad de `Order.userId`». Sin él, un bug que escriba `customer` + `ownerUserId=null`
   crea una pieza en el limbo: invisible en la bóveda de todos (las consultas filtran por `ownerUserId`), no
   vendible (`ownerType≠platform`) y no ajustable en M1 — una carta desaparecida en silencio. **`InventoryItem` es
   tabla de otro work stream ⇒ el orquestador serializa.** Precondición: `count(*)` de esa combinación debe ser `0`.
6. **`ShipmentItem` en envío no terminal ⇒ su `InventoryItem` NO está en `{listed, in_stock}`** (v1.21.2, §4-G.6).
   No se expresa como `CHECK` (cruza tres tablas): se garantiza por las transiciones normadas y **se verifica con
   los tests exigidos** de ARCHITECTURE §4.21h.

**Compatibilidad hacia atrás (qué NO se rompe)**
- Toda fila `Order`/`ShipmentRequest` existente conserva su `userId`; los defaults (`vault`, `0`) reproducen el
  comportamiento actual bit a bit. **Sin cambio de comportamiento para usuarios con cuenta.**
- Las consultas `where: { userId }` siguen siendo válidas y siguen usando el índice; lo único a auditar es que
  **ninguna** consulta de usuario dependa de "userId distinto de" o de un `findUnique` sin comparar dueño (ver la
  norma de §4-G.8 para `GET /shipments`).
- **Backfill único** de `orderNumber` para las filas existentes (ordenadas por `createdAt`), dentro de la propia
  migración. El proyecto es greenfield (ARCHITECTURE §11), así que el volumen es trivial.
- Tipos generados: `Order.userId` pasa a `string | null` en el cliente Prisma ⇒ **TypeScript señalará** cada punto
  que lo asumía no-nulo. Esa es la red de seguridad de la migración; backend debe resolver **todos** los errores
  con una decisión explícita, no con `!`.

**Constantes de servidor (NO son diales de M10)** — en `backend/src/modules/orders/guest-checkout.constants.ts`,
siguiendo el precedente de las ventanas 7d/30d del buylist (v1.18):
`GUEST_TRACKING_TTL_DAYS=90`, **`GUEST_CHECKOUT_TOKEN_TTL_MIN=120`** (v1.21.1, §4-G.7a),
`GUEST_TRACKING_MAX_AGE_DAYS=365`, `GUEST_RESEND_MAX_PER_DAY=5`,
`GUEST_MAX_ITEMS=20`, `GUEST_ORDER_RESERVATION_TTL_MIN=60`. Promoverlas a `ConfigSetting` (M10) más adelante es
**no-breaking**; hoy se evitan para no tocar el módulo `settings` (otro work stream). La **tarifa de envío** NO es
constante nueva: reusa el dial existente `SHIPPING_FEE_CENTS` (default 17500).

### 4-G.11 Zonas compartidas que este stream necesita (para el orquestador)

| Ruta | Cambio necesario | Naturaleza |
|---|---|---|
| `backend/prisma/schema.prisma` | Migración **M-25** | Serializar (regla de zona compartida). |
| `backend/src/common/money.ts` | Función **nueva** `computeDirectShipBreakdown(subtotal, shippingFee, ivaPct, fee)` | **Aditiva**: `computeCartBreakdown` y `computeShipmentBreakdown` **no se tocan**. |
| `backend/src/common/error-codes.ts` | **8** códigos nuevos (§0) — `VAULT_REQUIRES_ACCOUNT`, `ALREADY_AUTHENTICATED`, `INVALID_TOKEN`, `TOKEN_EXPIRED`, `TOKEN_REVOKED`, `ORDER_ALREADY_CLAIMED`, `CLAIM_EMAIL_MISMATCH`, `GUEST_ORDER_TOO_OLD` *(v1.21.1: la v1.21 decía "7" por error de conteo; la lista normativa de §0 siempre fue de 8 y es la que manda)* | Aditiva. |
| `frontend/src/types/contract.ts` | **v1.21.4-dual-breakdown (N-12):** el tipo espejo de la respuesta del quote de invitado gana `vaultBreakdown: BreakdownDTO` (siempre presente). `BreakdownDTO` ya existe; NO se le agrega `shippingFeeCents` — `vaultBreakdown` reusa el shape base sin envío. | **Aditiva. SERIALIZAR** (zona compartida `frontend/src/types/`): lo edita el stream de frontend, no el arquitecto. |
| `docs/API_CONTRACT.md` | Esta sección + §4-G.1 (`vaultBreakdown`) + bloque de DTOs (§0) | Ya aplicada, aditiva y localizada. |

**No se necesita tocar:** `common/decorators/public.decorator.ts` (se usa tal cual), `@nestjs/throttler` (ya
configurado), y **el módulo `mail` NO se modifica por dentro**: `orders` inyecta el puerto global **`MAIL_PORT`**
(exportado por `MailModule`, que es `@Global()`) y renderiza su **plantilla propia** en
`backend/src/modules/orders/mail/guest-order.templates.ts` (ES/EN por `Order.locale`), exactamente como hizo
`buylist` en v1.18. Envío **best-effort post-commit**: su fallo **no** revierte el pago ni falla el webhook (se
loguea); la red de seguridad es el `trackingToken` ya devuelto en la respuesta del checkout, el reenvío
self-service y el reenvío de soporte.

---

## 5. Retiros / envíos (comprador)

> **v1.21-guest-checkout — `ShipmentRequest` ahora tiene DOS naturalezas; los endpoints de esta sección solo
> operan la primera.** (a) **Retiro de bóveda** (`orderId = null`, `userId` poblado): todo lo descrito abajo, sin
> un solo cambio. (b) **Envío directo de un pedido de invitado** (`orderId` poblado, `userId = null`): lo **crea el
> servidor** al liquidar el pago del pedido (§9), nace ya en **`picking`** (el envío se cobró dentro del
> `PaymentIntent` de la orden), tiene `stripePaymentIntentId = null` y **`shippingFeeCents = 0` / `ivaCents = 0` /
> `processingFeeCents = 0` / `totalCents = 0`** — el ingreso de envío vive en `Order.shippingFeeCents`, de modo que
> **el P&L de M7 no lo cuente dos veces** (ver §M7/§12). Se opera desde M4 como cualquier otro envío.
> **Ningún endpoint `customer` de esta sección cambia de forma ni de rol**, y **ninguno** devuelve envíos con
> `userId = null`: `GET /shipments` y `GET /shipments/:id` deben filtrar por `userId = :sessionUser` de forma
> **positiva** (nunca por negación ni con un `findUnique` que no compare dueño). Caso negativo obligatorio de QA.

### POST /api/v1/shipments/quote — `customer`
El IVA 16% grava la **tarifa de envío**; el fee de procesamiento es gross-up (sin IVA). `totalCents = shippingFee + iva + processingFee`.
Req: `{ inventoryItemIds: string[], addressId: string }`
Res `200`: `{ breakdown: { subtotalCents: 17500, ivaCents, ivaRatePct, processingFeeCents, totalCents, currency: "MXN" }, eligibleItemIds, ineligible: [{ inventoryItemId, reason }] }`
(nota: en retiros `subtotalCents` = tarifa de envío). Err: `422 ADDRESS_NOT_MX`, `422 ITEM_NOT_SETTLED`.

### POST /api/v1/shipments — `customer`
Cobra la tarifa (envío + IVA + fee gross-up) por **Stripe ANTES** de crear la solicitud; solo items **elegibles** (ver criterio abajo). La `ShipmentRequest` nace en `solicitado` con el `PaymentIntent` asociado y **solo avanza a `picking` una vez liquidado** (webhook `payment_intent.succeeded`). No hay wallet.
Req: `{ inventoryItemIds: string[], addressId: string }` + `Idempotency-Key`
Res `201`: `{ shipmentId, status: "solicitado", breakdown: { "…": "BreakdownDTO" }, stripe: { paymentIntentId, clientSecret } }`
- **Criterio único de elegibilidad de retiro (v1.17.1 — `classifyItems`):** un item es elegible para `POST /shipments` **SOLO si** cumple **TODAS**:
  `ownerType='customer' AND ownerUserId=usuario AND ownershipStatus='settled' AND status='in_custody' AND sin envío activo`
  (sin `ShipmentItem` en un `ShipmentRequest` con `status NOT IN (cancelado, entregado)`).
  Este criterio **DEBE excluir** `status='withdrawn'` (item ya entregado, terminal) y **cualquier** estado que no sea `in_custody`. Es el **mismo** criterio que el flag de lectura `HoldingDTO.withdrawable` (§3): read y write comparten regla — no hay divergencia. Rechazos por-causa: `pending` ⇒ `422 ITEM_NOT_SETTLED`; ya con envío activo ⇒ `409 ITEM_IN_ANOTHER_SHIPMENT`; `withdrawn`/no-`in_custody` ⇒ `422 ITEM_NOT_IN_CUSTODY`.
Err: `422 ITEM_NOT_SETTLED` (incluye algún item `pending`), **`422 ITEM_NOT_IN_CUSTODY`** (v1.17.1 — incluye algún item `withdrawn` o cualquier `status != 'in_custody'`; guardarraíl anti doble-retiro/doble-cobro de un item ya entregado), `422 ADDRESS_NOT_MX`, `409 ITEM_IN_ANOTHER_SHIPMENT`, **`403 EMAIL_NOT_VERIFIED`** (v1.5 — retiro/envío es acción sensible; el `POST /shipments/quote` read-only **no** se bloquea).

### GET /api/v1/shipments — `customer` (v1.17 — vista de RASTREO de retiros del cliente)
Lista los retiros/envíos **del propio usuario**, ordenados por `requestedAt` desc. **No es endpoint nuevo** (ya existía como listMine); v1.17 norma su forma y **enriquece `items`** con carta/folio/acabado para que el cliente vea qué va en cada retiro. **No paginado** en el MVP (un cliente tiene pocos retiros; envelope `{ data }`, no `{ data, page, ... }`). No expone `shippingCostCents` (costo interno del carrier, §M4).
Res `200`:
```json
{ "data": [ { "…": "ClientShipmentDTO" } ] }
```
```ts
ClientShipmentDTO = {
  id: string,
  status: ShipmentStatus,               // solicitado | picking | guia | enviado | entregado | cancelado
  addressSnapshot: object,              // dirección MX (snapshot)
  shippingFeeCents: number, ivaCents: number, processingFeeCents: number, totalCents: number, // total del envío
  carrier?: string, trackingNumber?: string,   // guía/tracking cuando existe (status >= guia)
  requestedAt: string, pickingAt?: string, shippedAt?: string, deliveredAt?: string,
  items: ClientShipmentItemDTO[]
}
ClientShipmentItemDTO = {
  inventoryItemId: string,
  folio: string,                        // INV-000123
  finish: Finish,
  card: { id: string, name: string, setName: string, number: string, imageSmallUrl: string }
}
```
- **Mapeo etapa→texto (normativo; el LABEL traducido vive en i18n del FRONT, la API devuelve el enum):**
  | `status` | Texto cliente (ES) | Texto cliente (EN) |
  |---|---|---|
  | `solicitado` | Retiro solicitado (pago pendiente) | Withdrawal requested (payment pending) |
  | `picking` | Preparando tu envío | Preparing your shipment |
  | `guia` | Guía generada | Label created |
  | `enviado` | En camino | In transit |
  | `entregado` | Entregado | Delivered |
  | `cancelado` | Cancelado | Cancelled |
- El progreso rastreable de PROJECT.md §D (`preparando → guía → enviado → entregado`) corresponde a `picking → guia → enviado → entregado`; `solicitado` es el estado transitorio previo al pago (avanza a `picking` con `payment_intent.succeeded`, §9) y `cancelado` es terminal (envío no cobrado que se liberó).

### GET /api/v1/shipments/:id — `customer` (v1.17)
Detalle de un retiro propio (mismo `ClientShipmentDTO`, con `items` enriquecidos). Err `404` si no existe o no es del usuario. Sigue sin exponer `shippingCostCents`.

> **Enhancement OPCIONAL (v1.16.1 — NO exigido en el MVP, no obliga cambio de backend ahora):** el UI de disputas
> (WS-F) querría hacer un **gate 100%-cliente** (mostrar/ocultar el botón "abrir disputa" sin ida y vuelta al server),
> para lo cual `GET /shipments` (listMine) debería devolver por ítem **`productType`** y **`deliveredAt`**. **Hoy la
> autoridad es el backend** (`POST /disputes` deriva el tipo del `productType` y rechaza graded con `422 NOT_RAW`, y
> valida la ventana de 7 días desde entrega); solo `GET /shipments/:id` trae `productType`. Mientras no se implemente,
> el front puede resolver el gate con `GET /shipments/:id` o simplemente intentar `POST /disputes` y manejar
> `NOT_RAW`/`DISPUTE_WINDOW_CLOSED`. Si se prioriza, entra como cambio **aditivo** al `ShipmentDTO` de listMine (sin
> PII, sin migración). No es requisito de la Definición de Terminado actual.

---

## 6. Buylist (cotizador público + solicitudes)

### Cotizador — búsqueda de cartas sobre TODO el catálogo (v1.3 — NUEVO, backend)

El cotizador debe permitir elegir **cualquier** carta de la tabla `Card` (todo el catálogo importado), **no**
solo el inventario comprable de "Compra". Por eso estas rutas son **distintas** de `/catalog/*` (que está
acotado a inventario publicado con precio, ARCHITECTURE §4.9). El resultado alimenta a `POST /buylist/quote`
(que recibe `cardId`).

#### GET /api/v1/buylist/cards — `public`  (v1.3)
Búsqueda paginada sobre **toda** la tabla `Card` para el picker del cotizador. **No** filtra por inventario ni
por precio (una carta que no tenemos en bóveda también se puede vender). La **condición de compra es siempre
NM** (no hay filtro de condición).
Query: `?setId=&q=&rarity=&page=&pageSize=`
- `setId` (recomendado): acota a un set concreto (`Card.setId`).
- `q` (texto): coincide con **nombre** (`contains`, case-insensitive) y/o **número** de carta.
- `rarity` (opcional): valor **tal cual pokemontcg.io** (taxonomía abierta; usar `GET /buylist/sets` +
  facetas del front). Lista NO cerrada.
- Paginación estándar `{ page, pageSize }`; `pageSize` con tope de servidor (≤100).
Res `200`: `{ data: CardDTO[], page, pageSize, total }`
- Se reutiliza **`CardDTO`** (ya trae `id, name, number, rarity, setId, setName, imageSmallUrl,
  imageLargeUrl` + **`availableFinishes: Finish[]`** — cumple id/nombre/set/rareza/imagen/número/acabados).
  **No** hay `sellable`/`salePriceCents` (no es Compra); no hay precio en este DTO. El front puebla el **selector
  de acabado** del cotizador con `availableFinishes` (v1.6-finish).

**Ordenamiento NORMATIVO (v1.22-variantes-orden) — el binder del cotizador depende de él.** El orden se aplica
**en la base de datos, antes de paginar**; ordenar en el cliente o en memoria tras el `skip/take` está
**prohibido** (reordenaría la página, no el conjunto ⇒ orden global incorrecto y filas repetidas/saltadas entre
páginas). Dos casos:

| Caso | Orden garantizado |
|---|---|
| **con `setId`** (binder / master set) | `numberPrefix` asc → `numberSort` asc → `number` asc → `id` asc |
| **sin `setId`** (búsqueda de texto en todo el catálogo) | `name` asc → **`set.releaseDate` desc (`nulls: last`)** → `numberPrefix` asc → `numberSort` asc → `id` asc |

- Efecto observable: dentro de un set la secuencia es **`1, 2, 3, … 10, 11 …`** (nunca `1, 10, 100, 2`) y los
  promos/subsets van **al final, agrupados por prefijo alfabético** (`GG50` → `SV107` → `TG01`: `numberPrefix` asc). Antes de v1.22 el orden era
  `name asc, number asc` con `number` como **String** (`"10"` antes que `"2"`) — defecto **ORD-1**, ARCHITECTURE §9.
- **v1.40 (Enmienda B, P-41) — desempate por SET MÁS NUEVO en la búsqueda sin `setId`:** cuando varias cartas comparten
  el mismo `name` (misma carta reimpresa en varios sets, p. ej. 6 «Tropius»), el segundo criterio es **`set.releaseDate`
  desc** ⇒ la impresión del **set más reciente sale primero**. Antes se desempataba por `setId` (uuid **aleatorio**) ⇒ orden
  arbitrario que podía dejar la impresión nueva fuera del top-N. `CardSet.releaseDate` es `yyyy/MM/dd` zero-padded, así que
  el orden lexicográfico desc coincide con el cronológico; los sets **sin `releaseDate`** (`null`) van **al final** de ese
  grupo de nombre (`nulls: last`), nunca al frente. **Solo** afecta el caso **sin `setId`**; dentro de un set (`con setId`)
  el orden natural por número **no cambia**.
- El **`id` asc final es obligatorio**: es el desempate total que hace **determinista** la paginación.
- El front **no re-implementa** este orden: lo recibe ya aplicado, y si filtra localmente re-ordena con
  `(numberPrefix, numberSort, number)` del propio DTO — nunca con el índice del arreglo.

**Garantía de VARIANTES (v1.22).** `availableFinishes` de cada `CardDTO` es el **universo exacto de casillas** que
el binder debe pintar: **una casilla de imagen por entrada**, en el **orden del array** (`normal` primero ⇒
izquierda, `reverse_holo` después ⇒ derecha), todas con la **misma** `imageSmallUrl` de la carta. Si la carta solo
trae `["normal"]` se pinta **una** casilla: **nunca** un hueco de relleno ni un acabado por convención. El array
**nunca llega vacío** y **nunca** se reduce por falta de precio (ARCHITECTURE §4.22a/§4.22c).
**v1.22-2 (N-15/N-16):** lo que el front PINTA es **`CardDTO.displayFinishes`** (`⊆ availableFinishes`), que en una
carta **premium de una sola impresión** oculta el acabado `normal` **espurio**; en el resto coincide con
`availableFinishes`. Con la **rejilla plana (N-16)** el front genera **una tarjeta por cada `finish` de
`displayFinishes`** (una common con reverse holo real → 2 tarjetas; una ex/full-art → 1 tarjeta Holofoil, sin
`normal` espuria) y **cotiza cada tarjeta** con `POST /buylist/quote` por `(cardId, finish)`. La **validación
SEC-A1** del quote sigue contra `availableFinishes` (no contra `displayFinishes`).
Err: `400 VALIDATION_ERROR` (paginación inválida).
Nota: para **cotizar** una carta encontrada, el front llama `POST /buylist/quote` con su `cardId`. Si la carta
es `ex_plus` y **no tiene precio de referencia** (típico en cartas fuera de bóveda), la cotización sale
`precio_pendiente` y escala a la cola del dueño al crear la solicitud (§13, criterio 13). Ver **Pregunta
abierta 1** (pricing on-demand del cotizador) en ARCHITECTURE §10.

#### GET /api/v1/buylist/sets — `public`  (v1.3)
Sets que tienen **cartas importadas** (para poblar el dropdown de set del cotizador). A diferencia de
`GET /catalog/sets` (solo sets con inventario publicado), aquí aparecen **todos** los sets del catálogo.
Res `200`: `{ data: [{ id, name, series, releaseDate, year }] }` (datos en inglés; `year` derivado de
`releaseDate`).
- **Ordenamiento NORMATIVO (v1.18-buylist-rejects):** por **`releaseDate` desc** usando la fecha **COMPLETA**
  (no solo el año: dos sets del mismo año quedan por fecha real, el más reciente primero); **desempate** (misma
  `releaseDate`) por **`name` asc**; los sets **sin `releaseDate`** (`null`) van **AL FINAL**, entre ellos por
  `name` asc. Sin cambio de shape. (Antes decía "por año desc", ambiguo dentro del mismo año.)

### POST /api/v1/buylist/quote — `public`  (v1.3.1: por RAREZA · v1.6-finish: por ACABADO · v1.12: READ-ONLY)
Cotizador público (stateless). Muestra el mensaje de "pago tras recepción y verificación" (copy en frontend).
> **v1.12-catalog-pricing:** el quote es **read-only** — **no** escribe en la cola de precio pendiente aunque el
> resultado sea `precio_pendiente` (se retiró el `escalatePending` de Fase 0.2; cierra BE-16). Con el catálogo ya
> priceado (§4.13a), el `referencePrice` casi siempre sale `priced`. La escalada a `PendingPriceEntry` ocurre solo en
> `POST /buylist/requests` (autenticado). Mismo shape que antes.
Req: `{ cardId: string, productType: ProductType, rawCondition?: RawCondition, finish?: Finish, productId?: number }`
- **`finish` (v1.6-finish, opcional, default `normal`):** debe pertenecer a `Card.availableFinishes`; si no →
  `422 FINISH_NOT_AVAILABLE`. El front lo puebla del `CardDTO.availableFinishes` de la carta elegida.
- **`productId` (v1.30, opcional, ADITIVO):** cuando el vendedor cotiza un **producto separado** (`separateProducts`
  de la celda, v1.29 — Deck Exclusive/promo con su propio productId), lo envía aquí. Semántica (§4.29):
  - **Presente** → la línea es ESE `CardProduct` (server resuelve `CardProduct.tcgplayerProductId == productId`);
    el `finish` se valida contra **`CardProduct.finishes`** (NO `Card.availableFinishes`) y, si se omite y el producto
    tiene un solo acabado, se **default-ea a ese**; con >1 acabado, `finish` es obligatorio (si falta o no pertenece →
    `422 FINISH_NOT_AVAILABLE`). La **referencia de mercado** se lee de la `PriceReference` filtrada por ese
    `cardProductId` (precio propio del producto), no la del set_base.
  - **Ausente** → comportamiento v1.29 (set_base por `(cardId, finish)`), sin cambio.
  - **`422 PRODUCT_NOT_FOUND`** si el `productId` no existe; **`422 PRODUCT_CARD_MISMATCH`** si existe pero no cuelga
    del `cardId` (rechazo validado, jamás fusión silenciosa). Producto sin precio ⇒ `precio_pendiente`/«—», nunca 0.
  - La respuesta ecoa `productId` (`BuylistQuotePayload.productId`). El **acabado** del producto determina **de qué
    variante se lee el mercado**; el monto se deriva server-side (SEC-A1).
Res `200` (**v2.0**):
```json
{ "rarity": "Common", "finish": "reverse_holo",
  "priceBasis": "market",
  "quote": { "status": "cotizada", "quotedPriceCents": 3750, "currency": "MXN" },
  "referencePrice": { "status": "priced", "priceMxnCents": 12500 },
  "paymentNotice": "PAY_AFTER_RECEIPT" }
```

**⚠️ v2.0 (P-48) — RESOLUCIÓN DEL MONTO: la CURVA. Supersede TODO lo anterior de esta sección** (cadena de
`ruleKeyCandidates`, claves sintéticas `"Holo"`/`"Reverse Holo"`, `isPremiumRarity` como gate de pricing,
`BUYLIST_PRICE_RULES`, `fixed`/`pct` y `BUYLIST_PRICE_FALLBACK_PCT`). **El monto NO depende de la rareza ni del
acabado** (criterio 84). ARCHITECTURE §4.36.

```
compra = max( bin , mercado × pct(mercado) )        // pct INTERPOLADO; SIN redondeo
```

- **Qué hace todavía el `finish`:** elegir **de qué variante se lee el mercado** (`PriceReference` de ESE acabado /
  ESE `cardProductId`). Sigue **capturándose** en el cotizador por eso, y sigue siendo identidad de variante
  (inventario, overrides, bounties, `availableFinishes`). Lo único que perdió es **tener regla de precio propia**.
- **Qué hace todavía la `rareza`:** **nada en el monto**. El campo `rarity` de la respuesta es **informativo/display**.
  Su único papel money-safe es el **guardarraíl** (abajo).
- **Precedencia NORMATIVA de COMPRA (§4.36.6; la forma de v1.28 no cambia, el peldaño «regla» pasa a ser «curva»):**

  | # | Peldaño | `priceBasis` | Nota |
  |---|---|---|---|
  | 1 | **bounty VÁLIDO** (`bountyEnabled`, `priceCents>0` y **estrictamente mayor** que la curva) | `"bounty"` | no depende de la referencia ⇒ siempre `cotizada`. Un bounty **rebasado por la curva deja de ser bounty**: se salta este peldaño |
  | 2 | **`buyOverrideCents`** | `"override"` | **ABSOLUTO**: puede quedar **por debajo** de la curva y se paga **exactamente** ese monto (criterio 89). Jamás se envuelve en un `max` |
  | 3 | **CURVA** `max(bin, mercado × pct(mercado))` | `"market"` o `"floor"` | `"floor"` ⇔ el **bin** ganó el `max` (mercado × pct < bin). **Empate ⇒ `"market"`** |
  | 4 | **sin resolver** | `"pending"` | `{ "quote": { "status": "precio_pendiente", "quotedPriceCents": null } }` |

- **Dos causas de `precio_pendiente` (v2.0, ambas LOCKED, money):**
  1. **SIN DATO DE MERCADO ⇒ pendiente. El bin NO gana** (corrige el supuesto de §N.2). *Por qué:* el guardarraíl se
     apoya en la **rareza** — justo el proxy malo que este cambio retira del pricing. Atraparía una Secret Rare con
     dato corrupto, pero **no** una Common de $400 sin dato, que se cotizaría a $1. Sería reabrir el hueco exacto que
     este cambio cierra. **En ningún caso se cotiza MX$0 ni se inventa un precio.**
  2. **GUARDARRAÍL — rareza premium que aterriza en el BIN** (§4.36.5, criterio 88): que una chase resuelva al bin
     solo puede significar que su dato de mercado está **mal**. Se cotiza `precio_pendiente` y la variante entra a la
     cola con `reason="premium_at_floor"`. **NO** dispara con `priceBasis ∈ {override, bounty}` (decisiones
     deliberadas del admin, §4.36.6).
- **`escalatePending` sin cambio de doctrina:** `/quote` y `/quote/batch` siguen siendo **READ-ONLY** (v1.12) — no
  escriben en la cola aunque devuelvan `precio_pendiente`. Quien escala sigue siendo `POST /buylist/requests`.
- **`appliedRule` RETIRADO del payload** (no hay `{mode,value}`); lo reemplaza `priceBasis`. El snapshot
  `ruleSource="bounty"` de `createRequest` que habilita el conteo del bounty al pagar se re-expresa como
  `priceBasis="bounty"` (misma semántica, mismo efecto en §M2 variant-controls).
- **Prueba de mesa (criterio 80, diales iniciales de §N.2 — verificable):** mercado **$0.50 ⇒ $1** (gana el bin) ·
  **$10 ⇒ $3** · **$25 ⇒ $7.50** · **$100 ⇒ $40** · **$300 ⇒ $135** (pct interpolado 45 %) · **$500 ⇒ $250**. En
  particular, **una Common que vale cientos de pesos deja de recibir MX$0.50**.
- La condición de compra es **siempre NM** (ARCHITECTURE §3.5); `rawCondition` solo puede ser `NM`. Los topes de
  buylist (solicitud/mes, INE) **no cambian** y aplican igual a montos bounty. El "precio pendiente" es un estado de
  adquisición/back-office; **nunca** se muestra al comprador. El cotizador **sigue sin mostrar valor de mercado**
  (§N.7: no se toca).

### POST /api/v1/buylist/quote/batch — `public`  (v1.15 — NUEVO · cotización en LOTE · READ-ONLY)
Cotiza **N cartas en 1 request** (colapsa el fan-out del cotizador: hoy el grid dispara ~`pageSize` llamadas a
`POST /buylist/quote`). **No** crea solicitud, **no** mueve dinero, **no** persiste y **no** escala a
`PendingPriceEntry` (misma doctrina read-only que el quote por-carta desde v1.12; crítico por ser endpoint anónimo).
Cada ítem se resuelve **igual** que `POST /buylist/quote` — **v2.0 (P-48): por la CURVA DE COMPRA**
`max(bin, mercado × pct(mercado))` con la precedencia `bounty válido > buyOverrideCents > curva > pendiente`,
referencia **por acabado** (el acabado elige de qué variante se lee el mercado), FX ya bakeada en `PriceReference`.
**Un solo cuerpo compartido, prohibido duplicarlo** (`quoteAcquisitionFromCurve`). ~~rareza+acabado server-side, gate
premium, `BUYLIST_PRICE_RULES` + fallback~~ ⛔ retirados. SEC-A1 intacto: el monto se deriva del dato real de la
variante, jamás del DTO. **READ-ONLY** (no escala pendientes, v1.12).
Req: `{ items: BuylistQuoteItemDTO[] }` donde `BuylistQuoteItemDTO = { cardId, productType, rawCondition?, finish?, productId? }`
(mismos campos que el quote por-carta; **sin `qty`** — el modelo es una línea por carta física, ARCHITECTURE §4.16b).
- **Límites:** `items` **no vacío**; **máx `50`** ítems por request (`BUYLIST_QUOTE_BATCH_MAX`). Vacío o sobre-cap →
  `400 VALIDATION_ERROR`. Cuenta como **1** request contra el throttle público.
- **`finish?`** (default `normal`): se valida por-ítem contra `Card.availableFinishes` (o `CardProduct.finishes` si el
  ítem trae `productId`); si no pertenece, **ese ítem** sale `ok:false` con `error.code="FINISH_NOT_AVAILABLE"` (no
  tumba el lote).
- **`productId?`** (v1.30, ADITIVO): por-ítem, misma semántica que el quote por-carta (§4.29). Presente ⇒ la línea es
  ese `CardProduct` (acabado ∈ `CardProduct.finishes`; referencia por `cardProductId`); ausente ⇒ set_base por
  `(cardId, finish)`. Errores por-ítem `ok:false`: `PRODUCT_NOT_FOUND` (productId inexistente), `PRODUCT_CARD_MISMATCH`
  (no cuelga del cardId). Producto sin precio ⇒ ítem `ok:true` con `quote.status="precio_pendiente"` / `null` (nunca 0).
  El payload `ok:true` ecoa `productId`. **Unicidad:** dos ítems con el mismo `(cardId, finish)` pero distinto
  `productId` son líneas DISTINTAS; el front NO debe deduplicarlas. La llave de correlación sigue siendo `index`.
Res `200` (`BuylistBatchQuoteResponse`): **errores por-ítem** — una carta inválida NO afecta a las demás; el HTTP
global es `200`. `index` = posición 0-based en `items[]` (llave de correlación); `cardId` se ecoa.
```json
{
  "results": [
    { "index": 0, "cardId": "card_abc", "ok": true,
      "rarity": "Common", "finish": "reverse_holo",
      "priceBasis": "market",
      "quote": { "status": "cotizada", "quotedPriceCents": 3750, "currency": "MXN" },
      "referencePrice": { "status": "priced", "priceMxnCents": 12500 },
      "paymentNotice": "PAY_AFTER_RECEIPT" },
    { "index": 1, "cardId": "card_zap", "ok": true,
      "rarity": "Illustration Rare", "finish": "holofoil",
      "priceBasis": "pending",
      "quote": { "status": "precio_pendiente", "quotedPriceCents": null, "currency": "MXN" },
      "referencePrice": { "status": "pending" },
      "paymentNotice": "PAY_AFTER_RECEIPT" },
    { "index": 2, "cardId": "card_bad", "ok": false,
      "error": { "code": "FINISH_NOT_AVAILABLE", "message": "Finish 'holofoil' is not available for this card" } }
  ]
}
```
- **`ok:true`** → mismo payload que `POST /buylist/quote` (`rarity`, `finish`, **`priceBasis`** —v2.0, reemplaza a
  `appliedRule`—, `quote`, `referencePrice`, `paymentNotice`). **v2.0:** `quote.status="precio_pendiente"` ⇔
  `priceBasis="pending"`, y ahora tiene **dos** causas: (a) **sin dato de mercado** (el bin **NO** gana) y (b) el
  **guardarraíl** (rareza premium que aterrizó en el bin). El "precio pendiente" es de adquisición/back-office,
  **nunca** se muestra como precio al comprador — aquí es un vendedor cotizando.
- **`ok:false`** → `error.code ∈ { NOT_FOUND (carta inexistente), FINISH_NOT_AVAILABLE (acabado fuera de la whitelist
  aplicable), PRODUCT_NOT_FOUND (v1.30 — productId inexistente), PRODUCT_CARD_MISMATCH (v1.30 — productId no cuelga del
  cardId) }`, con `message` EN de fallback. Son los mismos códigos que el endpoint por-carta devolvería como
  `404`/`422`, aquí **por-ítem**.
Err (nivel request, no por-ítem): `400 VALIDATION_ERROR` (items vacío / > 50 / ítem malformado), `429 RATE_LIMITED`.
Nota: el batch es **anónimo/público** como el quote por-carta; la creación de la solicitud (con topes/KYC/CLABE)
sigue siendo el paso autenticado `POST /buylist/requests`.

### GET /api/v1/buylist/bounties — `public`  (v1.28 — NUEVO · «Top Bounties» de la página Vender · READ-ONLY)
Bounties **activos** (`bountyEnabled=true` con `bountyPriceCents>0`), para la sección "Top Bounties" **arriba** de
`/buylist`, visible **antes de elegir set**. **Read-only estricto** (doctrina v1.12 de endpoints anónimos: no
persiste, no escala pendientes, no mueve dinero); mismo throttle público que el quote. Orden `bountyPriceCents
desc`; **cap 50** (sin paginación — es una vitrina, no un listado). Sin query params.

> **⚠️ v2.0 (P-48) — solo se publica lo que es MEJOR que la tarifa estándar (§N.6, criterios 90/91).** Un bounty
> **por debajo o igual** de la cotización de la **curva** vigente **deja de ser bounty** y **NO aparece aquí** (ni en
> Home ni en Vender). Antes, `BOUNTY_BELOW_RULE` se validaba **solo al crear**: si después subía el mercado y la
> tarifa estándar rebasaba al bounty, la «oferta» publicada **pagaba MENOS que la tarifa normal** y seguía publicada.
> **Orden de operaciones NORMATIVO (importa):** seleccionar candidatos activos → resolver el mercado en **lote** →
> **filtrar los no efectivos** → ordenar `bountyPriceCents desc` → **tomar el top 50**. Filtrar **después** del cap
> dejaría huecos silenciosos en la vitrina. **Efecto garantizado:** para **todo** bounty visible aquí, la cotización
> de `/buylist/quote` es **exactamente** `bountyPriceCents` y es **estrictamente mayor** que la tarifa estándar de esa
> variante (criterio 91). El dueño ve los rebasados como **alerta en el binder** (`VariantPricingDTO.bounty.effective
> = false` + `curveQuoteCents`, §M2) — **sin** aviso proactivo por correo/push (decisión del humano).
Res `200` (`PublicBountiesResponse`): `{ data: PublicBountyDTO[] }`
```json
{ "data": [
  { "cardId": "card_abc", "name": "Pikachu ex", "number": "104", "setName": "Surging Sparks",
    "imageSmallUrl": "https://…", "rarity": "Special Illustration Rare", "finish": "holofoil",
    "bountyPriceCents": 250000, "targetQty": 3, "remainingQty": 2 }
] }
```
- `PublicBountyDTO = { cardId, name, number, setName, imageSmallUrl?, rarity?, finish: Finish,
  bountyPriceCents: number, targetQty: number | null, remainingQty: number | null }` —
  `remainingQty = targetQty − bountyAcquiredQty` (piso 0; `null` si sin objetivo). Dato motivacional («quedan 2»),
  **no** compromiso contractual de compra; el flujo de venta sigue siendo el normal (quote → solicitud → recepción
  → verificación → pago). Un bounty completado/apagado **desaparece** de la lista (el cliente que ya cotizó
  conserva su monto snapshoteado).
- **NO expone** `productType`/`gradeKey` distintos de raw NM en el MVP (los bounties nacen sobre la variante raw
  del Master Set; un bounty sobre graded no se lista aquí — decisión de alcance: la vitrina pública es de sueltas).
- Err `429 RATE_LIMITED`.

### POST /api/v1/buylist/requests — `customer`
Crea la solicitud; valida topes/KYC.
Req: `{ items: [{ cardId, productType, rawCondition?, finish?, productId? }], clabe?: string, ineUploadKeys?: { front, back } }`
> **v1.15 — `clabe` OPCIONAL + fallback server-side (PII):** `clabe` deja de ser obligatoria. Resolución server-side:
> - **`clabe` presente** → comportamiento actual: valida formato (18 dígitos → `422 CLABE_INVALID`) y **nombre propio**
>   contra la CLABE en archivo por blind-index (`422 CLABE_NOT_OWN_NAME` si no coincide); se cifra/persiste.
> - **`clabe` omitida** → el backend usa la **CLABE del PROPIO usuario** en archivo (`KycProfile.clabeEnc`,
>   desencriptada — **misma fuente que `GET /admin/buylist/:id/reveal-clabe`**). Autorización estricta: **siempre** la
>   del `userId` autenticado, **nunca** la de otro. Habilita el atajo del cotizador "usar mi CLABE ****1234" cuando
>   `GET /users/me/kyc` reporta `clabeOnFile=true` (§1).
> - **`clabe` omitida y sin CLABE en archivo** → **`422 CLABE_REQUIRED`**.
> La CLABE **resuelta** (de request o fallback) se **snapshotea cifrada** en la solicitud (para el pago SPEI), **nunca
> se loguea** y **nunca se devuelve** en la respuesta; su único punto de exposición en claro es el reveal dedicado.
> **v1.15 — INE en archivo:** si `GET /users/me/kyc` reporta `ineOnFile=true`, el front **omite** `ineUploadKeys` y el
> backend usa el INE ya en archivo para el umbral AML (no re-pide INE si ya está).
> **v1.3.1:** `items` **ya no** incluye `category` (SEC-A1: el backend deriva el monto server-side; un `category` del
> cliente se ignora si se envía). ~~Cada item cotizado snapshotea la regla aplicada
> (rarity/ruleMode/ruleValue/ruleSource)~~
> **⚠️ v2.0 (P-48) — el snapshot cambia de contenido y ES la instrumentación (§N.8, criterio 95).** En la **misma
> transacción** que congela `quotedPriceCents`, cada item persiste: **`marketMxnCents`** (mercado **crudo** en
> centavos que entró al cálculo), **`priceBasis`**, **`marketBracket`** (escala **FIJA**) y el **`finish`** que ya
> tenía — los cinco datos de §N.8 (`quotedPriceCents` es el precio final). Se refleja en `SellItemDTO`. Un **ajuste**
> posterior del admin (`approvedPriceCents`) **no reescribe** `priceBasis`/`marketBracket`: la serie mide **la
> decisión de la curva**. Las columnas `ruleMode`/`ruleValue`/`ruleSource` quedan **legacy** (nada nuevo las escribe).
> **Este es el único punto del eje de compra que ESCALA a `PendingPriceEntry`** (el quote sigue read-only, v1.12).
> **v1.6-finish:** cada item lleva `finish?` (default `normal`, validado ∈ `card.availableFinishes`); se
> **snapshotea** en `SellRequestItem.finish` y se propaga al `InventoryItem` al convertir (M5). El monto se deriva
> por `(rarity, finish)` server-side.
> **v1.30 (§4.29):** cada item lleva `productId?` OPCIONAL. Presente ⇒ la línea es ESE `CardProduct`
> (`separateProducts`): el `finish` se valida contra `CardProduct.finishes`, la referencia se lee por ese
> `cardProductId`, y el monto se deriva por `(rarityCanonical de la carta, finish del producto)` server-side (SEC-A1
> intacto). Se **snapshotea** en `SellRequestItem.cardProductId` (== el productId TCGplayer) y al convertir a
> inventario (M5) el `InventoryItem` queda ligado a ESE producto (no al set_base). Ausente ⇒ set_base por
> `(cardId, finish)`, comportamiento actual. **Unicidad:** dos items con el mismo `(cardId, finish)` y distinto
> `productId` son líneas físicas DISTINTAS (una por carta física, §4.16b) — no se colapsan. `productId` inexistente ⇒
> `422 PRODUCT_NOT_FOUND`; que no cuelgue del `cardId` ⇒ `422 PRODUCT_CARD_MISMATCH` (jamás fusión silenciosa). Un
> item de producto separado sin referencia queda en `precio_pendiente` (escala a `PendingPriceEntry` por
> `(cardId, productType, gradeKey, finish, cardProductId)`) — nunca 0; el pago SPEI sigue tras MoneyOutGuard.
Res `201`: `{ sellRequestId, status: "cotizada", quotedTotalCents, ineRequired: boolean, items: SellItemDTO[] }` (**no** incluye la CLABE, ni enmascarada ni en claro).
Err:
- **`403 EMAIL_NOT_VERIFIED`** (v1.5 — vender es acción sensible; el cotizador público `POST /buylist/quote` y `POST /buylist/quote/batch` **no** se bloquean)
- **`422 FINISH_NOT_AVAILABLE`** (v1.6 — algún `finish` no está en la whitelist aplicable: `Card.availableFinishes`, o
  `CardProduct.finishes` si el item trae `productId`)
- **`422 PRODUCT_NOT_FOUND`** (v1.30 — algún `productId` no existe)
- **`422 PRODUCT_CARD_MISMATCH`** (v1.30 — algún `productId` no cuelga del `cardId` de su item)
- `422 BUYLIST_LIMIT_EXCEEDED` (details: `{ scope: "per_request" | "per_month", capCents, wouldBeCents }`)
- `422 INE_REQUIRED` (supera el tope configurado y no hay INE ni en el request ni en archivo)
- **`422 CLABE_REQUIRED`** (v1.15 — sin `clabe` en el body y sin CLABE en archivo)
- `422 CLABE_INVALID` (formato != 18 dígitos, solo cuando `clabe` viene en el body)
- `422 CLABE_NOT_OWN_NAME` (la `clabe` del body no coincide con la de archivo — nombre propio)

### GET /api/v1/buylist/requests — `customer` → lista propia.
### GET /api/v1/buylist/requests/:id — `customer` → detalle con estados por item, ajustes propuestos, plazos.
> **v1.18-buylist-rejects:** los items del detalle (`SellItemDTO`, §11) exponen — SOLO cuando `itemStatus="rechazada"` —
> `rejectionReason`, `rejectedAt`, `returnDeadlineAt` (devolución, +7 días, **a costo del usuario**) y
> `abandonDeadlineAt` (+30 días). Es la MISMA información del correo de rechazo (§M5): el vendedor ve en la app por qué
> se rechazó su carta y hasta cuándo puede gestionar la devolución. Ítems legacy (rechazados antes de M-22) traen los
> cuatro campos `null`.

### POST /api/v1/buylist/requests/:id/respond — `customer`
Responde a un ajuste del admin (aceptar/rechazar el ajuste). Req: `{ decision: "accept" | "decline" }`. Plazo: 7 días sin respuesta → `rechazada` (job).

---

## 7. Disputas de condición (raw y sellado)

Disputa de **condición** sobre un item **entregado** (ventana de 7 días desde la entrega). Cubre tanto **raw** como **sellado**; el tipo se conserva (`condition_raw | condition_sealed`, ver ARCHITECTURE §3.6 y §11 M-10). El **graded no** tiene disputa de condición.

> **Evidencia por correo (v1.2; norma de valor revisada en v1.50.4):** la disputa **ya no acepta evidencia por
> archivo** en la app (se elimina el propósito de upload `dispute_claim`). El cliente **envía la evidencia por
> correo al buzón de soporte**. Ese buzón es un **dato de contacto**, no un endpoint, y el contrato **no fija su
> valor**: lo **resuelve el backend server-side** desde configuración (`DISPUTE_EVIDENCE_CONTACT`, overridable por
> entorno **sin redeploy**, con default en código) y lo devuelve en `evidenceContact` para que el front **lo
> muestre tal cual** en el flujo de disputa y en términos/FAQ. Hoy resuelve a un buzón del dominio canónico
> `common.brand.domain` (p. ej. `soporte@tcghunt.mx`) — **valor ilustrativo, no normativo**; ver §0 «Datos de
> contacto y valores de configuración» y ARCHITECTURE §0-B.
> *(Lo que el humano confirmó el 2026-08-16 fue el **invariante**: un único buzón de soporte, en el mismo dominio
> canónico que el remitente. La revisión anterior de este documento transcribía además el literal de entonces, y
> ese literal **sobrevivió al rebrand** — con el contrato mandando sobre el código, autorizaba a reintroducir un
> dominio muerto. Por eso ahora se norma la forma y el origen, no el valor.)*
> Ya **no existe comparador de fotos de ingreso** en el back-office.

### POST /api/v1/disputes — `customer`
El `type` de la disputa se **deriva server-side** del `productType` del `inventoryItemId` (el cliente **no** lo envía):
- `productType=raw` → `type="condition_raw"`. Resolución por el **estándar/política de condición NM** propio (no por foto).
- `productType=sealed` → `type="condition_sealed"`. Aplica a caja **dañada/equivocada** (sin "condición NM"). Ver ARCHITECTURE §3.6.
- `productType=graded` → **no aplica**: `422 NOT_RAW`.
Req: `{ inventoryItemId: string, description: string }`  (**sin** `claimPhotoUploadKeys`; la evidencia va por correo a soporte).
Res `201`: `{ disputeId, status: "abierta", type: "condition_raw" | "condition_sealed", deadlineAt, evidenceContact: string }`
 - **`evidenceContact`**: correo de soporte **resuelto server-side desde configuración** (§0). **Siempre presente y no vacío**; el valor **no** lo fija este contrato (p. ej. `soporte@tcghunt.mx`). El front **renderiza lo que recibe**.
Err: `422 DISPUTE_WINDOW_CLOSED` (fuera de 7 días desde entrega), `422 NOT_RAW` (item graded; el `code` se conserva por compatibilidad aunque hoy signifique "ni raw ni sellado"), `403`.

**Resolución (back-office §M8):** idéntica política para raw y sellado — **VENTAS FINALES**. El súper-admin resuelve `reject` (`→rechazada`) o `repurchase` (`→resuelta_recompra`, money-out): **recompra al precio pagado**; el **cliente conserva el ítem** y el ítem **NO** regresa al inventario (sin `InventoryMovement`, sin revertir titularidad/stock). La resolución se apoya en: **gradeadas** → grado + `certNumber` del slab (verificable en la graduadora); **raw NM** → estándar/política de condición propio; la evidencia del cliente llegó **por correo a soporte** (fuera del sistema).

### GET /api/v1/disputes — `customer` → lista propia.
### GET /api/v1/disputes/:id — `customer` → estado + resolución.

---

## 8. Uploads (SOLO INE de KYC)

> **Acotado a `kyc_ine` (v1.2).** El **único** propósito de upload válido es la **imagen del INE del buylist**
> (`kyc_ine`). Los propósitos `inventory_photo` y `dispute_claim` quedan **eliminados/deprecados**: el producto
> no lleva fotos propias (imagen de catálogo remota) y la evidencia de disputa se envía **por correo a soporte**
> (§7). El bucket del INE sigue **privado, cifrado y con retención** (`INE_RETENTION_DAYS`, ver ARCHITECTURE
> §3.4 y §8); el set `S3_*` de env se conserva, ahora justificado solo por `kyc_ine`.

### POST /api/v1/uploads/presign — `customer`  (solo `kyc_ine`)
Genera un presign para subir la imagen del INE. El objeto vive en **bucket privado** (no público); su lectura
por back-office es vía presign **GET** de vida corta (no URL pública). Retención según `INE_RETENTION_DAYS`.
Req: `{ purpose: "kyc_ine", contentType: string }`
Res `200`: `{ uploadKey, uploadUrl, method: "PUT", headers: {}, expiresAt }`
El cliente hace `PUT` directo al object storage privado; luego envía la `uploadKey` al endpoint de KYC
(`PUT /users/me/kyc` como `ineFrontUploadKey`/`ineBackUploadKey`). Captura móvil vía navegador.
Err: `422 VALIDATION_ERROR` si `purpose != "kyc_ine"` (los propósitos `inventory_photo`/`dispute_claim` ya no
son válidos).

---

## 9. Webhooks Stripe

### POST /api/v1/webhooks/stripe — `public` (firma verificada)
Header: `Stripe-Signature` (validado con `STRIPE_WEBHOOK_SECRET`). Idempotente por `event.id`.
Eventos manejados:
- `payment_intent.succeeded` → Order `pending→settled`; items `ownershipStatus pending→settled`. (También liquida el pago de un envío: `ShipmentRequest solicitado→picking`.)
  - **v1.17:** el pago del envío **NO** toca el `InventoryItem` (sigue `ownerType=customer, ownershipStatus=settled, status=in_custody`); la etapa "EN RETIRO" del holding se **deriva del join** al `ShipmentRequest` (fuente de verdad canónica, no un espejo en el item). La única transición del item en todo el ciclo del envío es la **terminal** `entregado ⇒ status=withdrawn`, que **no** ocurre aquí sino en la máquina de estados M4 (`PATCH /admin/shipments/:id/status → entregado`, ver §M4).
  - **v1.21 — rama `fulfillmentMode='direct_ship'` (pedido de invitado):** el item **NO** va a `in_custody` (no hay
    bóveda ni `ownerUserId` donde depositarlo). En la **misma transacción** del settle: (1) cada item
    `reserved → picking` conservando `ownerType='platform', ownerUserId=null, ownershipStatus=null`
    (+ `InventoryMovement reason='settle'`); (2) se **crea el `ShipmentRequest`** de fulfillment
    (`orderId` = la orden, `userId=null`, `status='picking'`, `pickingAt=now`, `addressSnapshot` copiado de
    `Order.shippingAddressSnapshot`, montos en `0` — ver §5), **idempotente** (si ya existe un envío para esa
    orden, no se crea otro: el webhook se reintenta); (3) se persisten `paymentMethodBrand` / `paymentMethodLast4`
    del `charge`. **Post-commit y best-effort:** se emite un `OrderAccessToken` **NUEVO de 90 días — sin rotar los
    anteriores** (§4-G.7a: el token de checkout que el navegador está usando tras el 3DS debe sobrevivir; se apaga
    solo a los 120 min) y se envía el **correo de confirmación con el enlace de seguimiento** (criterio 49). El
    claro del token de checkout **no es recuperable** (en BD solo hay hash), por eso el correo lleva **otro** token.
    El fallo del correo **no** revierte nada y **no** debe hacer fallar el webhook (un 5xx haría que Stripe
    reintentara un settle ya aplicado). **Idempotencia:** si el webhook se reintenta y la orden ya está `settled`,
    **no** se emite otro token ni se reenvía el correo.
- `payment_intent.payment_failed` → Order `pending→failed`; libera reserva de items (`reserved→listed`).
  - **v1.21:** en un pedido de invitado la liberación es idéntica (`reserved → listed`) y **más simple**, porque el
    item nunca dejó de ser `ownerType='platform'` (no hay titularidad que revertir).
- `payment_intent.canceled` → libera la reserva de compra (Order `→failed`, items `reserved→listed`) **o** cancela un envío aún en `solicitado` (`ShipmentRequest →cancelado`, libera sus items). Idempotente/no-op si ya está en estado terminal.
- `charge.refunded` → **distingue parcial vs total** comparando `amount_refunded` con `amount`:
  - **Total** (`amount_refunded == amount`) → Order `→refunded`.
  - **Parcial** (`amount_refunded < amount`) → **no** cambia `OrderStatus` (queda para conciliación fina en M7).
  - En ambos casos **NO** re-agrega el item al inventario (VENTAS FINALES: la carta ya es del cliente; el reembolso es excepcional, ver §M3).
- `charge.dispute.created` (contracargo) → Order `→chargeback`. **Consciente del estado físico** de la carta:
  - Si la carta **sigue en bóveda** (no hay `ShipmentItem` con envío `enviado`/`entregado`) → revierte a inventario de plataforma (`ownerType=platform`, `ownershipStatus=null`, `status=listed`), movimiento `chargeback_return`.
  - Si la carta **ya se envió/entregó** → **NO** re-agrega al inventario; marca `Order.chargebackNeedsManual=true` (hay que pelear la disputa con la evidencia de la guía). Sin movimiento de inventario.
  - **v1.21.2 — pedido de invitado: decide el ESTADO DEL ENVÍO, no el del item.** Corrige un hueco **bloqueante**
    de v1.21 (double-sell físico: con el envío en `picking`/`guia` el item volvía a `listed` mientras el envío
    seguía en la cola de picking). Reglas, con la **tabla normativa completa en §4-G.6**:
    - **envío no terminal** (`solicitado|picking|guia`) ⇒ `ShipmentRequest → cancelado` **en la misma transacción**
      + item **CONGELADO** (se queda en `picking`, **NO** se re-lista) + `chargebackNeedsManual=true`;
    - **envío `enviado|entregado`** ⇒ sin cambio de inventario + `chargebackNeedsManual=true` (como en v1.21);
    - **sin envío** (orden `pending`) ⇒ `reserved → listed` + `chargeback_return` + flag `false`.
    **El buscar `ShipmentItem` con envío en `enviado|entregado` NO basta como criterio**: un envío en `picking`/
    `guia` no coincide y hacía caer el caso en la rama "sigue en bóveda". El desenlace de la pieza congelada lo
    confirma un humano (`POST /admin/orders/:id/chargeback-inventory`, §M3).
- `charge.dispute.closed` / `charge.dispute.funds_reinstated` (cierre de disputa) →
  - **Ganamos** (`funds_reinstated`, o `closed` con `status=won`) → Order `→settled`; `Order.disputeOutcome="won"`. Si la carta se había revertido a inventario, **se queda en inventario** de plataforma (no vuelve al cliente).
    - **v1.21.2 — pedido de invitado con pieza congelada:** ganar **NO re-expide automáticamente**. La orden vuelve
      a `settled` y **`chargebackNeedsManual` se MANTIENE en `true`** para que el caso siga visible en la cola de M3
      hasta que un humano confirme que la carta sigue ahí y ejecute `chargeback-inventory` con `reexpedir`.
      Automatizarlo presupondría una realidad física que nadie comprobó (el envío original ya fue `cancelado`).
  - **Perdemos** (`closed` con `status=lost`) → Order `→chargeback` (terminal); `Order.disputeOutcome="lost"`.

**Semántica de respuesta (idempotente):**
- Firma inválida (`Stripe-Signature` no verifica) → **`400`** (no se procesa).
- Evento **ya procesado** (idempotencia por `event.id`) o **tipo no manejado** → **`200`** `{ received: true }` (no-op).
- Evento válido y nuevo, procesado con éxito → **`200`** `{ received: true }`.
- **Fallo del handler** al procesar un evento válido → **`5xx`** para que **Stripe reintente** (evita que la orden quede en `pending` permanente). El reintento es seguro por la idempotencia.

---

## 10. Back-office / Admin (M1–M10)

Todas requieren `vault_operator` o `super_admin` según §7 de ARCHITECTURE. Acciones de **dinero saliente** exigen `super_admin`; los demás reciben `403 MONEY_OUT_FORBIDDEN` (auditado). Todo cambio se registra en `AuditLog`.

### M1 — Inventario y bóveda (`vault_operator+`)
- `POST /api/v1/admin/inventory/items` — alta de item.
  Req: `{ cardId, productType, rawCondition?, finish?, sealedSubtype?, sealedCondition?, gradingCompany?, gradeValue?, certNumber?, locationId?, acquisitionType, acquisitionPct?, acquisitionCostCents?, listPriceCents?, sourceSellRequestItemId? }`
  - **`locationId?` OPCIONAL (v1.28/P-19 — alineación de contrato; el DTO backend ya lo trataba opcional):** una
    pieza puede nacer **sin ubicación** (la bóveda física la definirá el humano después, nota P-17). Aplica igual
    a `items/batch` y a `adjustments(encontrada)`. **`acquisitionCostCents?`** (ya existente en el DTO, ahora
    documentado): costo capturado para `acquisitionType="compra"` — es el campo del camino «Compra» del alta
    rápida (v1.28/P-19).
  - **Sin fotos propias (v1.2):** el alta **ya no recibe** `frontPhotoKey`/`backPhotoKey`/`extraPhotoKeys`; la imagen del item es la **imagen de catálogo remota** de la `Card` (pokemontcg.io). No se sube ninguna foto de producto/inventario.
  - **`finish` (v1.6-finish, opcional, default `normal`):** acabado de la copia física; se **valida contra `Card.availableFinishes`** (→ `422 FINISH_NOT_AVAILABLE` si no pertenece). Determina la referencia con que se valúa el item (Compra/portafolio). Para `graded`/`sealed` es `normal` (el acabado no aplica). En la **conversión desde buylist** (`convert-to-inventory`, M5) el `finish` se **hereda** del `SellRequestItem.finish` (no se recaptura).
  - `productType=raw` → `rawCondition` solo `NM` (v1.1). `productType=sealed` → `sealedSubtype?` (opcional) + **`sealedCondition?` (v1.23, default `mint`; `mint | minor_box_damage`, visible al comprador)**, **sin** `rawCondition`/grade/rareza/cert; `listPriceCents` (override MXN) es **opcional** (v1.23): si se omite, el sellado se auto-precia por `mercado TCGCSV × spread` cuando está mapeado y el dial `sealedPriceSource=tcgcsv` (ARCHITECTURE §4.23b); sin mercado ni override queda `PRICE_PENDING` (no publicable). **`sealedCondition` en raw/graded → `422 VALIDATION_ERROR`.** `productType=graded` → `gradingCompany` + `gradeValue` + **`certNumber` (nº de certificado PSA/CGC, string) — REQUERIDO para publicar una gradeada** (v1.2). Sin validación automática contra la graduadora (fuera de alcance); es un dato capturado a mano.
  Para `aportacion_en_especie`: el costo se calcula = **referencia del día × pct** (default 70, editable). El item nace `ownerType=platform`.
  Res `201`: `{ id, folio: "INV-000123", status: "in_stock", acquisitionCostCents }`
  Err `422 PRICE_PENDING` (si aportación en especie y no hay referencia → cola de precio pendiente), `422 VALIDATION_ERROR` (p. ej. `sealed` con `rawCondition`, `raw` con `rawCondition != NM`, o **`graded` sin `certNumber`**).
- `GET /api/v1/admin/inventory/items` — query `?status=&cardId=&ownerType=&locationId=&zone=&q=&page=&finish=&productType=`
  - **`finish?` y `productType?` (v1.28/P-17, ADITIVOS):** filtros nuevos, validados contra sus enums
    (`400 VALIDATION_ERROR` si inválidos); omitidos = comportamiento actual. Con `cardId+finish` sirven el
    **drill-down** de copias físicas por variante desde el Master Set (P-17); con `cardId+productType=sealed|graded`
    sirven los drill-downs de las pestañas Sellado (P-25) y Gradeadas (P-20). Solo REDUCEN el conjunto ya
    autorizado por rol.
- `GET /api/v1/admin/inventory/items/:id` — detalle + historial de movimientos.
- `PATCH /api/v1/admin/inventory/items/:id` — editar (grado, `certNumber`, `sealedSubtype`, `listPriceCents` manual, ubicación, etc.). **No** hay campos de foto de producto (v1.2). **No** edita el mapeo TCGCSV (v1.19; ver abajo).
- **Sellado — referencia de mercado TCGCSV (v1.19, READ-ONLY en M1):** para items `productType=sealed`, `GET /admin/inventory/items` (cada fila) y `GET .../items/:id` exponen además:
  - `tcgplayerProductId?: number` y `tcgplayerGroupId?: number` — mapeo curado al producto de TCGplayer/TCGCSV (`null`/omitidos si no mapeado; M-23).
  - `sealedMarketRef?: PriceInfo` — **valor de referencia de mercado** del producto sellado (`source: "tcgcsv"`, MXN con FX+colchón, `capturedDate` del último ingest). `null`/omitido si el item no está mapeado o aún no hay ingest. En listados se resuelve por lote (`getReferencesBatch`, sin N+1).
  - **Semántica (PROJECT 3e):** es **informativo** — una sugerencia junto al campo `listPriceCents`. NO cambia la regla de publicación (el sellado publica SOLO con precio manual), NO se usa para valuar ni vender, y NO aparece en la superficie pública. El **mapeo se edita únicamente** por `PUT /admin/pricing/sealed/items/:itemId/mapping` (§M2, `super_admin`); `PATCH .../items/:id` lo ignora.
- `POST /api/v1/admin/inventory/items/:id/move` — Req `{ toLocationId, note? }` → registra `InventoryMovement`.
- `POST /api/v1/admin/inventory/items/:id/mark` — Req `{ mark: "lost" | "damaged", note }` → `status` y movimiento; disponible para reposición (M7/tope M10).
- Ubicaciones: `GET /api/v1/admin/locations`, `POST /api/v1/admin/locations` (`{ zone, box, row, slot }`).

#### Master Set + inventario a escala (v1.16-master-set) — `vault_operator+`
> Vista agregada del inventario (binder/cuadrícula por set) + escritura por lote. **NO cambia el modelo por-pieza**
> (1 `InventoryItem` por pieza física): todo es agregación de lectura + lote de escritura. Ver ARCHITECTURE §4.17.

- `GET /api/v1/admin/inventory/master-sets` — **(NUEVO)** índice de sets con resumen agregado para inventariar.
  Query: `?q=` (filtro por nombre de set, opcional), `?page=1&pageSize=20` (paginado; default `pageSize=20`),
  `?sort=` (`release_desc` default | `completion_asc` | `pieces_desc`). **Solo inventario de PLATAFORMA.**
  Res `200` (`MasterSetIndexResponse`): `{ data: MasterSetSummaryDTO[], page, pageSize, total }`.
  - **Sin N+1 (patrón `set-value.service.ts`):** query fija — (1) página de `CardSet`; (2) `Card.groupBy({ by:[setId] })`
    para `catalogCardCount`; (3) **una** agregación (raw SQL `GROUP BY c."setId"`) sobre `InventoryItem ⋈ Card` para
    `totalPieces` + `distinctCardsOwned` de los `setId` de la página. `year` se deriva de `releaseDate` (yyyy/MM/dd).
  - **v1.33 (P-27) — master set combinado:** los `setId` **subset** de un grupo (mapa
    `config/master-set-groups.ts`) se **pliegan** en la fila del **principal** y sus agregados se **suman** sobre
    `partSetIds`; el subset **no** aparece como fila propia. La fila combinada trae `partSetIds` (§DTOs). Sigue O(1)
    queries (se agrupan por set-id canónico los resultados de las agregaciones ya existentes). **Money-safe:** solo
    lectura; ninguna escritura consulta el mapa.
- `GET /api/v1/admin/inventory/master-sets/:setId` — **(NUEVO)** binder del set: una celda por carta del catálogo.
  `:setId` = id LOCAL del `CardSet` (no `externalId`). Res `200` (`MasterSetBinderResponse`): `{ set, printedTotal,
  catalogCardCount, cells: MasterSetCardCellDTO[] }`, `cells` en **ORDEN NATURAL por número** (ver nota).
  - **v1.33 (P-27) — master set combinado (ARCHITECTURE §4.31b):** si `:setId` es el **principal** de un grupo, el
    binder hace **fan-in** de todas las partes (`Card WHERE setId IN partSetIds`): `set` = el principal (nombre del
    master), `catalogCardCount`/`printedTotal` = **Σ de las partes** (Celebrations = 50), `cells` en bloque del
    principal primero y luego cada subset (orden natural dentro del bloque). Cada celda trae `partSetId`/`partLabel`
    (§DTOs) y el binder trae `parts[]`. Si `:setId` es un **subset**, se **normaliza a su principal** y la respuesta
    trae `canonicalSetId` (el front actualiza la URL). Un set normal (sin grupo) responde igual que v1.20 (sin
    `parts`/`partSetId`). **Money-safe:** cada `Card`/pieza conserva su set-id real; `scopeWhere` y las agregaciones
    no cambian (filtran por `cardId`).
  - **Orden natural (obligatorio) — v1.16.1 CORREGIDO:** `Card.number` es **String** → el orden lexicográfico rompe
    ("10" < "2", "TG12" mal ubicado). El backend produce el orden correcto: **(1)** las cartas con `number`
    **puramente numérico** (`number ~ '^[0-9]+$'`) primero, ordenadas por su **valor entero**; **(2)** los
    **promos/subsets con prefijo alfabético** (`TG`, `GG`, `SV`…) **AL FINAL**, agrupados por prefijo y luego por su
    sufijo numérico. Ilustrativo (Postgres):
    `ORDER BY (number ~ '^[0-9]+$') DESC, CASE WHEN number ~ '^[0-9]+$' THEN number::int END NULLS LAST,
    regexp_replace(number,'[0-9]','','g'), NULLIF(regexp_replace(number,'\D','','g'),'')::int, number`.
    > **NOTA:** la fórmula previa `NULLIF(regexp_replace(number,'\D','','g'),'')::int` era **incorrecta** — convertía
    > `TG12`→`12` y lo intercalaba entre las numéricas, contradiciendo "promos al final". Solo debe parsearse el entero
    > cuando el `number` es puramente numérico. `numberSort` (en el DTO) es el entero para cartas numéricas y un
    > sentinela que empuja al final para promos.
  - **v1.22-variantes-orden — el orden deja de calcularse en cada consulta: se PERSISTE.** `Card.numberSort` y
    `Card.numberPrefix` son **columnas** (migración **M-26**) pobladas por el sync con `deriveNumberParts`, y el
    `ORDER BY` normativo pasa a ser **`numberPrefix asc, numberSort asc, number asc, id asc`** — equivalente exacto al
    de arriba, pero indexable (`@@index([setId, numberPrefix, numberSort])`) y **reutilizable por `GET /buylist/cards`,
    que pagina** (ordenar en memoria ahí daría un orden global incorrecto; ver §6 y ARCHITECTURE §4.22b). El SQL crudo
    ilustrativo previo queda como **referencia histórica**; el orden vigente es el de columnas.
    `MasterSetCardCellDTO` gana **`numberPrefix`** porque `numberSort` **solo no basta** para que el front re-ordene
    tras filtrar (`TG12` y `GG12` colisionan en el mismo sentinela).
  - **`isSecretRare` (v1.16.1 — heurística SOLO de display):** `true` **solo** para cartas de la numeración
    **principal** (número puramente numérico) cuyo entero **> `printedTotal`** (secret/hyper rare real). Los
    promos/subsets con **prefijo alfabético** (TG/GG/SV) → `isSecretRare=false` (subset aparte, no secret rare).
    `printedTotal` nulo → `false`. **Decisión de producto (default propuesto):** distinguir subset por prefijo
    alfabético; no cuentan como secret rare. La definición previa (`numberSort > printedTotal` sin más) marcaba TODOS
    los promos → **deuda BE-36** (ARCHITECTURE §9); si el código aún usa la forma amplia, backend debe alinearlo.
  - **Sin N+1:** (1) `Card WHERE setId` (cartas del set); (2) **una** agregación (raw SQL o `groupBy [cardId, finish]`)
    de piezas on-hand por `(cardId, finish)` para los `cardId` del set → `countsByFinish`. Los **filtros locales**
    (rareza, acabado, solo faltantes, solo secret rares) los aplica el **frontend** sobre la respuesta completa.
  - Err `404 NOT_FOUND` (no existe `CardSet` con ese id).
- `POST /api/v1/admin/inventory/items/batch` — **(NUEVO)** alta por LOTE (carrito de captura, #12). N líneas en 1 request.
  Req (`BatchCreateInventoryRequest`): `{ batchKey, items: BatchInventoryItemInput[] }` (cap **200** líneas). También
  acepta header `Idempotency-Key` (equivalente a `batchKey`).
  - **Errores por-línea:** una línea inválida (`FINISH_NOT_AVAILABLE`, `PRICE_PENDING` por aportación sin referencia,
    `VALIDATION_ERROR` p. ej. graded sin `certNumber` o `qty>1`, sellado con `rawCondition`) **no tumba** las demás.
    Las líneas válidas **SÍ se crean** (commit parcial, no atómico) → HTTP global **200**.
  - **`qty` (default 1):** atajo que expande a N `InventoryItem` (N folios) para bulk raw/sellado; `graded` fuerza 1.
    Cada línea reusa **exactamente** la lógica de `POST /admin/inventory/items` (costo de aportación server-side,
    validación de `finish` contra `availableFinishes`, folio legible). Los folios del lote son **consecutivos**
    (`PrismaService.nextFolios(n)` en 1 reserva de secuencia).
  - **Idempotencia + auditoría:** el `batchKey` se persiste en `InventoryBatch` (M-21) con el resultado; un replay del
    mismo `batchKey` devuelve el resultado guardado con `idempotentReplay:true` **sin** re-crear. El lote queda auditado
    (`AuditLog action=inventory.batch_create`, con `batchKey` + resumen; nunca PII).
  - Res `200` (`BatchCreateInventoryResponse`): `{ batchKey, idempotentReplay, summary, results }`.
  - Err `400 VALIDATION_ERROR` (items vacío / sobre-cap / `batchKey` ausente).
- `POST /api/v1/admin/inventory/items/bulk-publish` — **(NUEVO)** publicar por LOTE (varias piezas → `listed`).
  Req (`BulkPublishRequest`): `{ batchKey?, items: BulkPublishLineInput[] }` (cap **200**).
  - **Status de origen publicable (v1.16.1, OBLIGATORIO) = `{in_stock, listed}`:**
    - `in_stock` → **publica** (`status → listed`).
    - `listed` → **el precio se RE-RESUELVE** (v2.1.1, ratificado normativamente). Si resuelve ⇒ **no-op idempotente**
      (`ok:true`; no re-cobra, no duplica, no cambia precio salvo override explícito). Si **no** resuelve ⇒ línea
      `ok:false` con **`PRICE_PENDING`**, **escala** a la cola y la pieza **sigue `listed`** (no se le cambia el
      status; ver §M1 `publish-all` y ARCHITECTURE §4.36.5b-bis).
      > **Para `bulk-publish` esto es RATIFICACIÓN, no cambio de comportamiento:** ya re-resolvía. Se escribe como
      > norma porque el punto ciego que se corrigió en `publish-all` (v2.1.1) vivía **solo** en el bucle de
      > `publish-all`, y lo que faltaba aquí era que **algo garantizara** que `bulk-publish` no derivara hacia el
      > mismo no-op: este contrato declara ambos pipelines **idénticos**, y con el mismo par de tests queda cubierto.
      > Si el operador pide publicar un folio que ya está `listed`, **re-verificarlo es justo lo que esperaría**.
    - **cualquier otro** status (`reserved | in_custody | picking | shipped | delivered | lost | damaged | withdrawn`)
      → línea falla **`422 ITEM_NOT_PUBLISHABLE`** y **NO** se publica. **Guardarraíl anti double-sell:** una pieza
      reservada/vendida/en-custodia/enviada **no** puede regresar a `listed`.
  - Precio por línea: `listPriceCents` presente → **override manual**; ausente → **precio de venta
    derivado** server-side (SEC-A1). **v2.1.3 (D5, H-1): «presente» significa `> 0`.** Un `listPriceCents <= 0` en la
    línea (o en la pieza) se trata como **AUSENTE** y la pieza se precia por la cadena derivada — nunca se publica en
    `0`. Además el **write valida `listPriceCents` entero `> 0`** (`422 VALIDATION_ERROR`) aquí y en
    `POST /admin/inventory/items` / `items/batch`, para que el estado no se pueda crear; `null` sigue siendo válido y
    significa «sin override». Misma regla que `sellOverrideCents` y que el override del sellado. Ramificado por
    `productType`: `raw|graded` → ~~reglas por rareza+acabado~~
    **⛔ v2.0 (P-48): la CURVA DE VENTA** `redondeo↑(max(piso, mercado × markup(mercado)))` (§M2 «Curva de precio por
    VALOR DE MERCADO», `computeSalePriceForItem`); **`sealed` → `computeSealedSalePrice`** (`sealedMarketRef × spread`,
    §M2 sealed-spreads / ARCHITECTURE §4.23b/d — **sin cambio**). Una pieza cuyo precio **no se resuelve** → línea
    falla `PRICE_PENDING` y **NO** se publica (regla "solo se lista lo que tiene precio"; mismo código de error).
    graded sin `certNumber` → `VALIDATION_ERROR`.
    - **v2.0 — DOS causas nuevas de `PRICE_PENDING` en `raw|graded`** (ambas escalan a la cola con su `reason`, ver ④):
      1. **Sin dato de mercado ⇒ `PRICE_PENDING`. El piso NO gana** (`reason="no_market"`). *Por qué (decisión del
         humano, corrige el supuesto de §N.2):* el guardarraíl se apoya en la **rareza**, justo el proxy malo que este
         cambio retira del pricing — atraparía una Secret Rare con dato corrupto pero **no** una Common de $400 sin
         dato, que se publicaría al piso de $25. Sería reabrir el hueco exacto que este cambio cierra.
      2. **GUARDARRAÍL: rareza premium que aterriza en el PISO ⇒ no se publica** (`reason="premium_at_floor"`,
         criterio 88). Que una chase resuelva al piso solo puede significar que su dato de mercado está **mal**.
         **NO** dispara con `priceBasis ∈ {override, bounty}` (decisiones deliberadas del admin: `listPriceCents` y
         `sellOverrideCents` **siguen siendo ABSOLUTOS** y publican sin importar la curva).
    - **v1.23:** el sellado **ya no exige `listPriceCents`** — se auto-precia por mercado×spread cuando está mapeado y el
      dial `sealedPriceSource=tcgcsv`; el override sigue disponible y gana. Retro-compatible: sin mercado, el override es
      la única vía (idéntico a hoy).
  - **v1.26 (④, priceless → ESCALA, no dropea):** una línea que falla `PRICE_PENDING` (variante sin precio resoluble)
    **ESCALA** a la cola de pendientes (`escalatePending`, `context='inventory'`, dedupe idempotente por
    `(cardId, productType, gradeKey, finish, status='open')`) y **NO** se publica — antes se caía en silencio y M2 no se
    enteraba. **Mismo código de error** `PRICE_PENDING` (no breaking). La línea puede devolver **`pendingPriceEntryId?`**
    (aditivo/opcional) para deep-link de UI. Remedio: el admin fija precio (override M2 `POST /admin/pricing/override` o
    `listPriceCents` por-línea) y el re-publish procede. Paridad con `createItem` (que ya escalaba). Ver ARCHITECTURE §4.24b.
    - **v2.0 (P-48):** la entrada escalada lleva **`reason`** (`no_market | premium_at_floor`) y **sale sola** de la
      cola: cuando el siguiente barrido (`price-ingest`) escribe una `PriceReference` real y el precio vuelve a
      resolver con `priceBasis="market"`, la entrada `open` de esa clave se **cierra** en la siguiente resolución
      (re-publish / `publish-all` / lectura del binder), **sin intervención manual**.
  - **v1.26 (P-7, `repriceFresh?`):** si `repriceFresh:true`, ANTES de resolver el precio se refresca la `PriceReference`
    con un fetch **on-demand por carta** del proveedor (upsert de mercado del día), útil para publicar inventario
    UNPUBLISHED con precio fresco. **Hereda el gate ④**: si tras el refresh sigue sin precio → escala pendiente, no
    publica. **Money-touching → gate de seguridad posterior.** Cuota diaria del proveedor (PPT): cap por request, respeta
    `dailyLimited` de `GET /admin/pricing/sync-status`. Alternativa de diseño equivalente: endpoint hermano
    `POST /admin/inventory/items/reprice`. Ver ARCHITECTURE §4.24e.
  - **Errores por-línea** (item no encontrado `404`/`NOT_FOUND`, no `ownerType=platform`, status no publicable
    `ITEM_NOT_PUBLISHABLE`, precio pendiente `PRICE_PENDING` —ahora escalado—) no tumban las demás → HTTP **200**.
    Re-publicar una pieza ya `listed` es **no-op idempotente** (`ok:true`) **si su precio sigue resolviendo**; si no,
    la línea sale `ok:false / PRICE_PENDING` y escala (v2.1.1). Reusa `getReferencesBatch` (1 lote de referencias) e
    iza **la CURVA** (v2.0) **una vez** por request (pago mínimo de **BE-25**).
  - Res `200` (`BulkPublishResponse`): `{ summary, results }`. Auditado (`AuditLog action=inventory.bulk_publish`).

#### Master set en todas partes (v1.20-master-set-everywhere) — `vault_operator+`
> El binder deja de ser exclusivo del inventario de plataforma: el **mismo contrato** sirve (i) M1 interno,
> (ii) la bóveda de cualquier cliente vista por admin y (iii) "Mi bóveda" del cliente (§3). Ver ARCHITECTURE §4.20.

- `GET /api/v1/admin/inventory/master-sets` y `GET .../master-sets/:setId` — **(EXTENDIDOS, no duplicados)** los
  endpoints v1.16 ganan los campos v1.20: `scope:"platform"` en la respuesta, contadores por **variante**
  (`catalogVariantCount`/`distinctVariantsOwned`/`variantCompletionPct` en el índice;
  `variants[]`/`expectedVariantCount`/`coveredVariantCount` por celda). `owner` ausente y `buyable` **omitido**
  (solo existe en la vista (iii) del cliente). Query, orden natural, reglas on-hand y errores: **sin cambios v1.16**.
  - **v1.26 (P-2, aditivo):** `MasterSetCardCellDTO` gana **`marketReferenceMxnCents?: number | null`** = precio de
    **MERCADO** (referencia `PriceReference` cruda del acabado base, FX-recompute a MXN vigente vía
    `getReferencesBatch`/`liveMxnCents`), **NO** el precio de venta derivado. `null` si la referencia está `pending`. Se
    puebla con la infraestructura ya inyectada del binder (sin N+1). Ver ARCHITECTURE §4.24d.
  - **v1.27 (P-15, aditivo):** el precio de mercado baja al **nivel VARIANTE** — `MasterSetVariantDTO` gana
    **`marketReferenceMxnCents?: number | null`** (+ `capturedDate?: string | null`) con la referencia de **ESE**
    acabado (`raw`, `raw:NM`, `finish` de la variante): Normal y Reverse Holo muestran cada una SU mercado, en los
    **3 scopes** del binder (M1, bóveda admin, "Mi bóveda"). El backend expande el batch de `getReferencesBatch` a
    **(carta × acabado del universo `availableFinishes`)** — el batch ya acepta lista, sigue siendo UNA query, sin
    N+1. El campo de **CELDA** queda **DEPRECADO** (espejo de la variante del acabado base durante UNA versión; el
    front migra a leer la variante en este mismo stream; retiro en la siguiente rev). Ver ARCHITECTURE §4.25b.
- `GET /api/v1/admin/vaults` — **(NUEVO)** lista de clientes **con bóveda** (≥1 pieza en bóveda).
  Query: `?q=` (nombre/email), `?page=1&pageSize=20`, `?sort=` (`value_desc` default | `pieces_desc` | `name_asc`).
  Res `200` (`AdminVaultListResponse`): `{ data: AdminVaultSummaryDTO[], page, pageSize, total }` — por cliente:
  `userId`, `name`, `email`, `pieceCount`, `totalValueMxnCents` (**misma valuación que el portafolio §3**:
  referencia vigente por acabado; pendientes excluidos del total y contados en `pendingPriceCount`).
  - **Sin N+1:** una agregación de piezas por usuario + `getReferencesBatch` para valuar la página (no una query
    por pieza ni por usuario). El valor es **estimado del día** (misma frescura que el portafolio del cliente).
  - PII: solo identificación mínima (`name`/`email`, ya visibles para `vault_operator` en M6). **Nunca** CLABE/RFC/INE.
- `GET /api/v1/admin/vaults/:userId/master-sets` — **(NUEVO)** vista (ii): índice master set de la bóveda de un
  cliente. **Mismo shape** que el índice M1 con `scope:"user_vault"` y `owner: { userId, name, email }`. Solo sets
  con ≥1 pieza del cliente. Query igual al índice M1. Err `404 NOT_FOUND` (usuario inexistente).
- `GET /api/v1/admin/vaults/:userId/master-sets/:setId` — **(NUEVO)** binder de la bóveda del cliente. **Mismo
  shape** que el binder M1 (`scope:"user_vault"`, `owner` con `email`), mismo orden natural. **Sin `buyable`** (es
  vista operativa, no de compra) y **sin acciones**: lectura pura para soporte/operación (¿qué tiene este cliente
  de este set?). Err `404 NOT_FOUND` (usuario o set inexistente).
- `GET /api/v1/admin/vaults/:userId/sealed` — **(NUEVO, v1.23-sealed-sales)** pestaña «Sellado» de la bóveda de un
  cliente (hermana admin de `GET /vault/sealed`, §3). **Mismo shape** (`VaultSealedResponse`) con `owner: { userId, name,
  email }`. Agrupa las piezas selladas del cliente en bóveda por producto+condición, con conteo y valor de mercado
  (misma valuación que el portafolio; pendientes excluidos del total y contados en `pendingPriceCount`). Query igual a
  `GET /vault/sealed`. Lectura pura (sin acciones); PII mínima (`name`/`email`, ya visibles para `vault_operator`).
  Err `404 NOT_FOUND` (usuario inexistente).
- `POST /api/v1/admin/inventory/adjustments` — **(NUEVO)** ajuste por **levantamiento físico** desde la celda del
  binder M1 (scope plataforma). Req (`InventoryAdjustmentRequest`) con **motivo OBLIGATORIO**
  `reason: encontrada | perdida | danada | error_captura`:
  - **`encontrada`** (aparece una pieza física no capturada): **crea** la(s) pieza(s) reusando los campos de alta
    del lote (`item: BatchInventoryItemInput`; misma validación de `finish`/cert; `qty` default 1, `graded` fuerza
    1). `acquisitionType` default **`aportacion_en_especie`** si se omite (costo = referencia × pct, con su
    `422 PRICE_PENDING` si no hay referencia — paridad con el alta normal). Piezas nacen `in_stock`, `ownerType=platform`.
    - **Idempotencia (`batchKey?`, v1.20.1, SOLO `encontrada`):** misma semántica que el alta por lote
      (`POST .../items/batch`, mecanismo `InventoryBatch` M-21): mismo `batchKey` → **no** re-crea piezas ni filas
      de ajuste; el replay devuelve la **respuesta original guardada** con `idempotentReplay: true` y **`200`**
      (aunque la primera vez fuera `201`). El front DEBE enviarlo desde el drawer de ajuste (anti doble-submit,
      cierra BE-47). Los otros motivos no lo aceptan: operan una pieza existente y su replay cae en
      `422 ITEM_NOT_ADJUSTABLE` (la pieza ya salió de `{in_stock, listed}`).
  - **`perdida` / `danada`** (la pieza del sistema no aparece o aparece dañada): `status → lost | damaged`
    (habilita el flujo de reposición/merma existente, M7/tope M10). `note` **obligatoria**.
  - **`error_captura`** (la pieza **nunca existió** físicamente; se capturó por error): `status → withdrawn` — sale
    del on-hand **sin** contar como pérdida/reposición; el motivo real queda en `InventoryAdjustment.reason`
    (distinguible de un retiro de cliente en reportes/auditoría). `note` **obligatoria**.
  - **Alcance ajustable:** SOLO piezas `ownerType=platform` con status ∈ `{in_stock, listed}` (para
    `perdida|danada|error_captura`). Cualquier otro status → **`422 ITEM_NOT_ADJUSTABLE`** (§0): una pieza
    `reserved`/vendida/en custodia/enviada se resuelve por su flujo dueño (M3/M4/`mark`), no por ajuste.
  - **Registro (obligatorio):** cada ajuste persiste `InventoryAdjustment` (M-24, con `reason`, `fromStatus`,
    `toStatus`, `actorUserId`, `note`, timestamp) + `InventoryMovement` con `reason=adjustment` (el historial de la
    pieza distingue un ajuste de operador de un mark normal) + `AuditLog action=inventory.adjustment` (quién/qué/cuándo).
  - **NO hay venta directa manual desde el binder:** el ajuste **no** puede poner una pieza en `reserved`, crear
    órdenes ni registrar una venta; **toda salida por venta pasa por órdenes (checkout Stripe / M3)**. Publicar a la
    venta sigue siendo `bulk-publish`/`PATCH` (con precio server-side SEC-A1). No es dinero saliente (sin `MoneyOutGuard`).
  Res `201` (encontrada) / `200` (resto; también `200` el replay idempotente por `batchKey`):
  `InventoryAdjustmentResponse` — v1.20.1: `adjustmentIds: string[]` (una fila `InventoryAdjustment` por pieza con
  `encontrada` y `qty>1`, alineadas 1:1 con `inventoryItemIds`/`folios`; longitud 1 en el resto) +
  `idempotentReplay: boolean`. El singular `adjustmentId` queda **eliminado** (sin deprecated).
  Err `400 VALIDATION_ERROR` (reason ausente/inválido; `encontrada` sin `item`; `perdida|danada|error_captura` sin
  `inventoryItemId`, sin `note`, o con `batchKey`), `404 NOT_FOUND`, `422 ITEM_NOT_ADJUSTABLE`,
  `422 FINISH_NOT_AVAILABLE`, `422 PRICE_PENDING` (encontrada por aportación sin referencia).

#### Stream B — Inventario Master Set operable (v1.28) — `vault_operator+` salvo nota
> P-19 + P-17 + P-24 + P-25 + P-20 de `PENDIENTES.md` (decisiones del humano ya tomadas). Spec en ARCHITECTURE
> §4.26. La consola de precios P-18/P-22 vive en §M2 (`variant-controls`, `super_admin`) y su LECTURA viaja en el
> binder (`MasterSetVariantDTO.pricing?`, solo scope `platform` — ver §DTOs).

- **Alta rápida desde la casilla de variante (P-19) — SIN endpoint nuevo:** el front reusa
  `POST /admin/inventory/items/batch` con líneas mínimas. Reglas normativas:
  - **«Compra»**: `{ cardId, finish: <el de la casilla picada>, qty, acquisitionType: "compra",
    acquisitionCostCents: <capturado> }` — el precio se **prellena** con `pricing.buy.effectiveCents` del binder
    (sugerido de regla, u override/bounty vigente) y es **editable**.
  - **«Aportación»**: un botón, **sin %** — `{ ..., acquisitionType: "aportacion_en_especie", acquisitionPct: 100 }`
    ⇒ el server valúa **costo = referencia de mercado del momento × 100 %** (mecánica existente). **Sin referencia
    ⇒ `422 PRICE_PENDING` POR LÍNEA** (lote tolerante) y el front lo muestra anclado con copy claro (lección P-4:
    ni crear a ciegas ni fallar en silencio). El dial `aportacionPct` (70) NO cambia: es el default del formulario
    clásico; el alta rápida manda `100` explícito. Aplica igual a sellado (abajo, con `sealedMarketRef`).
  - **Sin dropdown de acabado** (la casilla lo fija; SEC-A1 valida igual) y **sin campo de ubicación**
    (`locationId?` opcional). Bajas simples = `POST /admin/inventory/adjustments` desde el drill-down; la VENTA
    solo sale por checkout/M3 (ratificado §4.20e).
- `POST /api/v1/admin/inventory/publish-all` — **(NUEVO, P-19)** publicar TODO el inventario (o un filtro) de golpe.
  Req (`PublishAllRequest`): `{ batchKey?, setId?, productType? }` — selección **server-side**: piezas
  `ownerType=platform` + `status ∈ {in_stock, listed}` (± `setId` de la carta, ± `productType`). **Sin cap de
  selección** (procesa por chunks server-side; a diferencia de `bulk-publish`, que exige lista explícita y capa 200).
  - **⚠️ v2.1.1 (CAMBIO DE COMPORTAMIENTO, hallazgo del techlead — ARCHITECTURE §4.36.5b-bis).** La selección pasa de
    `status = 'in_stock'` a la allowlist **`PUBLISHABLE_ORIGIN_STATUSES = {in_stock, listed}`**, la misma que
    `bulk-publish` usa desde v1.16.1, **y la rama `listed` deja de ser un no-op: RE-RESUELVE el precio.**
    - **Por qué no ensucia el endpoint — lo corrige.** Este contrato ya declaraba que el pipeline por-pieza es
      «**IDÉNTICO** a `bulk-publish`», y **no lo era**: la divergencia de selección era una desviación no documentada
      entre contrato y código. La semántica del endpoint nunca fue «transicionar `in_stock → listed`» sino **«dejar
      cada pieza en el estado publicable correcto»**.
    - **Las DOS partes son la norma; una sola es peor que ninguna.** Ensanchar la selección sin tocar la rama `listed`
      dejaría el hueco intacto **y lo disfrazaría**: cada pieza degradada se contaría como **`alreadyListed`**, que se
      lee como «ésta ya estaba bien».
    - **Qué arregla:** una pieza publicada cuyo dato de mercado se degrada **después** dejaba de venderse **en
      silencio** y **no entraba a la cola** — lo contrario de lo que pide §N.5 («convierte un error de dinero
      silencioso en una cola visible»). El guardarraíl cubría la **transición** a publicado, no la **vida** de lo
      publicado.
    - **No había pérdida de dinero** (el precio se resuelve **en lectura**: la pieza ya salía de Compra con
      `sellable=false` y **no contaba en `stockCount`**, §4.9a) — lo que se perdía era **la señal**.
  - **Destino por-pieza de una `listed` re-evaluada (normativo):**
    - **re-resuelve** ⇒ **sigue `listed`**, cuenta en **`alreadyListed`** (no-op observable: **no re-cobra** y **no
      cambia el precio** — el precio derivado no está persistido, §4.26b);
    - **no resuelve** (`no_market` o `premium_at_floor`) ⇒ **escala a la cola** con su `reason`, cuenta en
      **`pendingPrice`** y además en el subcontador **`listedNowPending`**;
    - **⚠️ escalar NO le cambia el `status`: se queda `listed`.** (a) No hay exposición que cerrar (ya está fuera de
      Compra y de `stockCount`); (b) un flip `listed → in_stock` **competiría con un checkout en vuelo** que la tenga
      reservada — sería introducir un riesgo nuevo con una mejora de observabilidad; (c) **la señal es la entrada en
      la cola**, no el status.
  - **Pipeline por-pieza IDÉNTICO a `bulk-publish`:** precio server-side SEC-A1 con la precedencia v1.28
    (`listPriceCents > sellOverride > `**`CURVA`**` (v2.0)`; sellado por H-1); una pieza sin precio resoluble falla
    `PRICE_PENDING`, **ESCALA** a la cola (④ v1.26, `context='inventory'`, con su `reason` v2.0) y **NO** se publica;
    `listed` = **re-resuelta** (v2.1.1) ⇒ no-op si sigue sana, escalada si no. **Tolerante por-ítem: el lote JAMÁS
    revienta completo.**
  - **⚠️ v2.0 (P-48) — este endpoint ES el paso 2 del CUT-OVER de la curva** (ARCHITECTURE §4.36.9c). Como el precio
    de venta **se resuelve en LECTURA y no está persistido**, la migración **no reescribe ninguna fila de precio**:
    «repriciar el catálogo por completo» (criterio 96) = **re-resolver**, y esto es lo que lo hace. Tras el deploy se
    corre sobre el inventario `platform` para publicar lo que ahora resuelve y **escalar** lo que cae en `no_market`
    o `premium_at_floor`.
    - **⚠️ El paso depende de la selección `{in_stock, listed}` de v2.1.1.** Con la selección anterior
      (`in_stock` a secas) este barrido **no tocaba las piezas ya publicadas**, así que «re-resolver toda pieza» era
      falso y el paso de verificación daba un **falso negativo**. **Las cartas del reporte original del dueño —las de
      MX$1.31— son piezas `listed`**, exactamente las que no se tocaban.
    - **Verificación, en dos lecturas:** (1) `summary.listedNowPending` = de lo que ya estaba a la venta, cuánto quedó
      roto bajo la curva nueva; (2) `GET /admin/pricing/pending?reason=premium_at_floor` (o el `counts` del
      encabezado) debe quedar del orden de **≈3 por cada 333** cartas; mucho más ⇒ **piso mal calibrado o ingest
      roto**, no guardarraíl ruidoso — y los dos `counts` juntos separan cuál de los dos es (§M2).
  - **Idempotencia + auditoría:** `batchKey` vía `InventoryBatch` (`kind='publish_all'`; replay ⇒ resultado
    guardado + `idempotentReplay:true`). `AuditLog action=inventory.publish_all` (filtros + resumen).
  - Res `200` (`PublishAllResponse`): `{ batchKey?, idempotentReplay: boolean,
    summary: { selected, published, alreadyListed, pendingPrice, failed, listedNowPending },
    failures: { inventoryItemId, folio, error: { code, message }, pendingPriceEntryId? }[] /* CAPADO a 200 */ }`
    — el remanente de pendientes se opera por `GET /admin/pricing/pending?context=inventory`. **`selected`
    (v1.28.1):** snapshot del total de piezas candidatas **seleccionadas server-side** por el filtro al momento de
    la ejecución; `published`/`alreadyListed`/`pendingPrice`/`failed` **PARTICIONAN** esa selección.
    - **`listedNowPending` (NUEVO v2.1.1)** = piezas que **estaban `listed` y ya NO resuelven precio** (escalaron a la
      cola y siguen `listed`). Es un **SUBCONJUNTO de `pendingPrice`**, reportado aparte: **NO** entra en la partición,
      así que el invariante `selected = published + alreadyListed + pendingPrice + failed` **no cambia**.
    - **Por qué merece contador propio:** es el número que contesta la pregunta del dueño — *«de lo que ya estaba a la
      venta, ¿cuánto quedó roto?»*. **No se puede deducir** de `pendingPrice` (que mezcla lo que nunca estuvo
      publicado) ni de `alreadyListed`, cuyo significado **cambia** en v2.1.1: pasa de «no la toqué» a **«la
      re-verifiqué y está sana»**. Sin este contador, el cut-over de una plataforma con inventario ya publicado leería
      un `alreadyListed` alto como éxito cuando podría estar tapando el hallazgo.
  - Err `400 VALIDATION_ERROR` (filtros inválidos), `403`. **Toca dinero** (expone piezas a la venta) → gate de
    seguridad por release.
- `GET /api/v1/admin/inventory/sealed-sets` — **(NUEVO, P-25)** índice de la pestaña «Sellado»: sets con ≥1 pieza
  **sellada** de plataforma. Query `?q=&page=&pageSize=` (patrón del índice Master Set).
  Res `200`: `{ data: SealedSetSummaryDTO[], page, pageSize, total, unmappedTotal }` donde
  `SealedSetSummaryDTO = { set: SetRefDTO, pieceCount, listedCount, unmappedCount,
  marketValueMxnCents: number | null }` (valor = Σ `sealedMarketRef` de piezas mapeadas; piezas sin mercado se
  excluyen y cuentan en `unmappedCount`; `null` si ninguna valuable — nunca 0 inventado). `unmappedTotal` = piezas
  selladas sin mapeo en TODO el inventario (badge de la cola). **Sin N+1** (una agregación + `getReferencesBatch`).
- `GET /api/v1/admin/inventory/sealed-sets/:setId` — **(NUEVO, P-25)** detalle por set: grupos de producto sellado
  (identidad §4.23: `(cardId ancla, sealedSubtype, tcgplayerProductId, sealedCondition)`).
  Res `200`: `{ set: SetRefDTO, groups: SealedInventoryGroupDTO[] }` con
  `SealedInventoryGroupDTO = { cardId, productName /* Card.name ancla */, imageSmallUrl?: string | null
  /* v1.28.1, aditivo: imagen de la carta ancla (teja DESIGN §16.8); null honesto */,
  sealedSubtype: SealedSubtype | null, sealedCondition: SealedCondition, tcgplayerProductId: number | null,
  mapped: boolean, counts: { inStock, listed, other }, sealedMarketRef?: PriceInfo,
  totalCostCents: number | null }`.
  Alta rápida/bajas/publicar = mismas reglas P-19 (aportación de sellado valúa por `sealedMarketRef` — ver nota
  normativa abajo); publicar por grupo = `bulk-publish` de sus folios o `publish-all {setId, productType:"sealed"}`;
  drill-down a folios = `items?cardId=&productType=sealed`. Err `404 NOT_FOUND`.
  - **⚠ Nota NORMATIVA (backend, dinero) — aportación de SELLADO:** la valuación de
    `aportacion_en_especie` para `productType=sealed` debe resolver la referencia por **`sealedMarketRef`**
    (clave `sealed:tcg:<productId>`, gateada por el dial `sealedPriceSource`, resolver H-1 §4.23) — **no** por el
    gradeKey legacy `'sealed'` (que jamás tiene filas ⇒ todo caía a `PRICE_PENDING` aunque el mercado exista).
    Sin mapeo o dial `off` ⇒ `422 PRICE_PENDING` por línea, como siempre.
    - **Inferencia del `tcgplayerProductId` (NORMATIVO v1.28.1):** el alta no captura productId; el server lo
      infiere de los **hermanos ya mapeados del grupo `(cardId, sealedSubtype)`**. Exactamente UN productId entre
      ellos ⇒ se usa para valuar; cero o varios ⇒ `422 PRICE_PENDING` por línea (ambigüedad = sin precio, jamás
      adivinar). La pieza nueva **NO hereda el mapeo** (la curación sigue en M2). Decisión de fondo (productId en
      el DTO del alta vs. entidad de producto sellado) abierta como **SB-D5** en `docs/TECH_DEBT.md`.
  - La **cola de no-mapeados** se enlaza desde la pestaña pero sigue siendo `GET /admin/pricing/sealed/unmapped`
    (§M2, **`super_admin`**); para `vault_operator` el grupo no mapeado se muestra como «sin precio de mercado».
    **Dueño de la vista (v1.28.1):** la pantalla que consume esa cola pertenece al **frontend de M2** (precios),
    no a la pestaña Sellado de M1 (que solo enlaza); pendiente menor post-stream, no bloquea el cierre de B.
- `GET /api/v1/admin/inventory/sealed-catalog` — **(NUEVO, P-35)** listar los **productos SELLADOS de un set** (ETB,
  booster box, bundle, tin, blíster) para el **alta dedicada** de la pestaña «Sellado» — **NO singles**. Reemplaza la
  reutilización del buscador de CARTAS en el modal de alta (defecto P-35). `vault_operator+`.
  Query: `?setId=<id LOCAL de CardSet>` (**requerido**) `&groupId?=<int>` (override manual del grupo TCGCSV, para
  bootstrap de un set aún sin sellado ni `tcgcsvGroupId`) `&q?` (filtro por nombre).
  - **Resolución set → grupo TCGCSV (precedencia normativa, §4.32b):** `groupId` explícito de la query > **`CardSet.tcgcsvGroupId`**
    (delta M-37) > `SELECT DISTINCT tcgplayerGroupId` de los `InventoryItem` `sealed` **ya mapeados** del set (dato
    curado M-23). Exactamente un grupo ⇒ se usa; **cero ⇒ `groupResolved:false`** y `data:[]` (el front ofrece fijar
    el grupo); varios distintos ⇒ se toma el de `CardSet.tcgcsvGroupId` si existe, si no `groupResolved:false`
    (ambigüedad, no se adivina).
  - **Fuente de los productos = proxy read-only server-side** (host fijo `tcgcsv.com`, categoría Pokémon=3, anti-SSRF
    centralizado; **misma familia** que `/admin/pricing/sealed/tcgcsv/groups/:groupId/products`, §M2). El navegador
    NUNCA habla con tcgcsv.com. Filtra singles por heurística de `extendedData` (§4.19b). `sealedSubtype` se **infiere**
    del nombre (`ETB`→`etb`, `Booster Box`→`box`, …; `null` si no se infiere → el operador lo elige al dar de alta).
  - **`marketRef` (money-safe, INFORMATIVO):** por producto, precio de mercado leído del grupo TCGCSV (USD→MXN con
    FX+colchón), como sugerencia junto al alta. **Sin precio en la fuente ⇒ `marketRef=null` (pendiente / «—»),
    JAMÁS `0`.** NO fija venta ni costo; la valuación real se deriva al alta (aportación) / `bulk-publish` (venta).
  - **`anchorCardId`:** Card **representativa** del set (menor `(numberPrefix, numberSort)`, §4.32b) que el front
    **reenvía como `cardId`** en el alta. El sellado se ancla a esa Card SOLO para satisfacer `InventoryItem.cardId`
    (NOT NULL) y como fallback de nombre/imagen; el **display real** sale de `sealedImageUrl`/`sealedProductName`
    (deltas M-37). El operador **nunca** elige un single como ancla (raíz del defecto P-35).
  - Res `200` (`SealedCatalogResponse`): `{ set, tcgcsvGroupId, groupResolved, anchorCardId, data: SealedCatalogProductDTO[] }`.
  - Err `404 NOT_FOUND` (set inexistente), `400 VALIDATION_ERROR` (`setId` ausente / `groupId` no entero positivo),
    `502 UPSTREAM_ERROR` (TCGCSV no responde / payload inválido — no afecta nada local). **Sin N+1** (una llamada de
    productos + una de precios del grupo).
  - **⚠ DEPRECADO (v1.39, P-38):** superado por `GET /admin/inventory/sealed-products` (lee `SealedProduct` persistidos).
    Se conserva como alias transitorio (puede leer la misma tabla); se retira en release posterior.
- `GET /api/v1/admin/inventory/sealed-products` — **(NUEVO, P-38)** listar las presentaciones selladas **PERSISTIDAS**
  de un set (`SealedProduct`, `active=true`) — la FUENTE del alta dedicada de la pestaña «Sellado». `vault_operator+`.
  Query: `?setId=<id LOCAL de CardSet>` (**requerido**) `&q?` (filtro por nombre) `&origin?=set_main|promo_collection`
  `&principalOnly?=true` (solo presentaciones «cabecera»).
  - **Orden (§4.34c):** principales primero — `(isPrincipal desc, sortOrder asc, name asc)`; `sortOrder` canónico
    `upc=0, etb=1, box=2, bundle=3, tin=4, blister=5, collection=6`.
  - **Presentación SEPARADA por `origin` (v1.39.1, decisión del humano) — para frontend/ux-ui:** el alta muestra **dos
    secciones** — «Del set» (`origin=set_main`) y «Promos/colecciones» (`origin=promo_collection`). Es partición de UI;
    **sin cambio de shape** (el campo `origin` ya viene en `SealedProductDTO`; el orden §4.34c aplica dentro de cada sección).
  - **`marketRef` (money-safe, INFORMATIVO — ungated):** por producto — **live** (fetch TCGCSV del grupo al vuelo,
    USD→MXN con FX+colchón) → fallback a `marketUsdCents` cacheado por el sync → **`null` (pendiente/«—»), JAMÁS `0`**.
    **NO** está gateado por `sealedPriceSource`; es **solo sugerencia informativa** y **NO** decide la UI del alta ni
    promete un valor de registro (lección IMP-1). No fija venta ni costo. **Sin N+1** (una llamada de precios por grupo
    distinto + join en memoria; FX una vez por request).
  - **`effectiveMarketCents` (money-safe, AUTORITATIVO — v1.41, IMP-1):** por producto, el mercado del sellado **YA
    gateado por el dial `sealedPriceSource`** (§M10), resuelto con la **MISMA** función H-1 (§4.23) que decide la
    valuación del alta (`aportacion_en_especie`) — es EXACTAMENTE el valor con que el backend valuará esta línea. `null`
    ⟺ el backend está en `PRICE_PENDING` para esta línea (dial `off`, sin mapeo, o sin precio en la fuente gateada) ⟺ el
    backend ACEPTA `manualMarketMxnCents` en el alta. **NUNCA `0`** (sin precio ⇒ `null`). **Regla de front (NORMATIVA):**
    la visibilidad del campo de precio manual y el copy «se registra a valor de mercado: $X» se keyean en
    `effectiveMarketCents` (muestra manual ⟺ `== null`; muestra «valor de mercado» con este valor ⟺ `!= null`), **jamás**
    en `marketRef`/caché. Garantiza que la UI nunca promete un valor que el backend rechazaría.
  - **`sealedPriceSource` (v1.41):** estado del dial (`tcgcsv | off`) devuelto una vez en la respuesta; con `off` el
    front explica que la fuente está apagada y pide capturar el valor manual. Semántica: `off` ⇒ todos los
    `effectiveMarketCents` son `null` (fail-closed) aunque `marketRef` traiga un valor de caché.
  - **Catálogo vacío** (set sin `SealedProduct` aún) ⇒ `data:[]` + **`needsSync:true`** (el front ofrece «Sincronizar»,
    `super_admin`). `groups` = grupos TCGCSV conocidos del set (`SealedSetGroup`).
  - Res `200` (`SealedProductListResponse`): `{ set, needsSync, groups: SealedSetGroupDTO[], sealedPriceSource,
    data: SealedProductDTO[] }`.
  - Err `404 NOT_FOUND` (set), `400 VALIDATION_ERROR` (`setId` ausente/inválido), `502 UPSTREAM_ERROR` (precios live).
- `POST /api/v1/admin/inventory/sealed-products/sync` — **(NUEVO, P-38)** descargar las presentaciones selladas de un set
  (o de todos) desde TCGCSV y persistirlas como `SealedProduct`, **poblando de paso `CardSet.tcgcsvGroupId` + `SealedSetGroup`**
  (rompe el círculo vicioso del grupo). **`super_admin`** (curación/escritura de catálogo).
  - Req (`SealedSyncRequest`): `{ setId?, groupIds?, all? }` — uno de `setId` (un set) o `all:true` (todos); `groupIds?`
    = grupos extra (promo/colección) a **enlazar + sincronizar** además de los ya conocidos del set.
  - **Algoritmo:** resuelve los grupos del set (`SealedSetGroup` ∪ `groupIds` ∪ name-match del `set_main` si falta) →
    por grupo `listSealedProducts` (**descarta singles**, incl. el single promo de un grupo `promo_collection`) →
    `inferSealedSubtype` (incl. **upc**) → **upsert `SealedProduct`** por `tcgplayerProductId` (name/image/subtype-si-no-curado/
    `marketUsdCents`) → asegura la fila `SealedSetGroup` (con su `kind`) → **puebla `CardSet.tcgcsvGroupId`** si era null.
    Productos que ya no aparecen ⇒ `active=false` (soft; nunca borrado duro). **Money-safe:** nunca fabrica precio
    (`marketUsdCents` null si TCGCSV no trae), nunca toca inventario/valuación existente.
  - **Cadencia:** on-demand (botón «Sincronizar») + batch opcional `sealed-catalog-sync` (todos los sets, 1×/día,
    ventana TCGCSV, single-flight, secuencial-awaited como `sealed-price-ingest`).
  - Res `200` (`SealedSyncResultDTO`): `{ setsSynced, groupsPopulated, productsUpserted, productsDeactivated,
    pricedCount, pendingPriceCount }`. Err `404 NOT_FOUND` (set), `400 VALIDATION_ERROR`, `502 UPSTREAM_ERROR`.
- `GET /api/v1/admin/inventory/sealed-products/sync/candidates` — **(NUEVO, P-38)** grupos TCGCSV candidatos por
  **name-match** contra el set (bootstrap del `set_main` sin item previo + localizar grupos `promo_collection` — Mega
  Evolution/promos). **`super_admin`**. Query `?setId=` (**requerido**).
  Res `200` (`SealedSyncCandidatesResponse`): `{ set, candidates: TcgcsvGroupCandidateDTO[] }` (con `alreadyLinked` +
  `matchScore`). Err `404 NOT_FOUND`, `502 UPSTREAM_ERROR`.
- `POST /api/v1/admin/inventory/sealed-sets/:setId/groups` — **(NUEVO, P-38)** enlazar un grupo TCGCSV **extra**
  (promo/colección) al set (**1 set → N grupos**, §4.34b). **`super_admin`**.
  Req (`SealedSetGroupLinkRequest`): `{ tcgplayerGroupId, kind }`. Res `201` (`SealedSetGroupDTO`).
  Err `404 NOT_FOUND` (set), `409` (grupo ya enlazado), `400 VALIDATION_ERROR`.
- **Alta de inventario SELLADO (P-38) — SIN endpoint nuevo:** el front reusa **`POST /admin/inventory/items/batch`** con
  **`sealedProductId`** (identidad; el backend deriva `cardId` ancla + mapeo + imagen/nombre/subtipo del `SealedProduct` y
  congela el snapshot ⇒ nace «ETB …», no Tropius). Precio **en vivo** al alta (TCGCSV → caché → null). **Fallback manual
  money-safe (v1.39.1):** `manualMarketMxnCents?` (solo si el mercado resuelto es null, `>0`, **`vault_operator+`**,
  auditado; ⚠ input de dinero por operador → revisión de seguridad por release); sin override ⇒ `422 PRICE_PENDING`
  (nunca 0). Errores nuevos: `422 SEALED_PRODUCT_NOT_FOUND`, `422 MANUAL_MARKET_NOT_ALLOWED` (solo «mercado ya resuelto»).
  - **Coherencia con el preview (v1.41, IMP-1) — NORMATIVA:** «el mercado resuelto es null» aquí = el **MISMO** valor
    gateado por `sealedPriceSource` que el preview expone como `SealedProductDTO.effectiveMarketCents`
    (`GET /admin/inventory/sealed-products`). Por construcción: `effectiveMarketCents == null` ⟺ el alta acepta
    `manualMarketMxnCents` y sin él responde `422 PRICE_PENDING`; `effectiveMarketCents != null` ⟺ el alta RECHAZA
    `manualMarketMxnCents` con `422 MANUAL_MARKET_NOT_ALLOWED`. El front decide si envía `manualMarketMxnCents` a partir
    de `effectiveMarketCents` (no de `marketRef`/caché), de modo que nunca dispare `MANUAL_MARKET_NOT_ALLOWED` ni caiga
    en el dead-end de `PRICE_PENDING` sin campo donde fijar el precio (raíz de IMP-1).
  - **Nota transición:** los 4 campos sueltos M-37 (`tcgplayerProductId`/`tcgplayerGroupId`/`sealedImageUrl`/
    `sealedProductName`) quedan **DEPRECADOS**; si viene `sealedProductId` se ignoran (mandan los derivados). El flujo P-35
    (§4.32c, alta por mapeo suelto) sigue funcionando en transición.
- **Alta de inventario SELLADO (P-35, legacy/transición) — SIN endpoint nuevo:** el front reusa **`POST /admin/inventory/items/batch`**
  (o el singular `POST /admin/inventory/items`) con líneas `sealed`. Desde `SealedCatalogProductDTO` + `anchorCardId`,
  cada línea = `{ cardId: <anchorCardId>, productType:"sealed", sealedSubtype:<elegido/inferido>, sealedCondition?,
  finish:"normal", qty, acquisitionType, acquisitionCostCents?/acquisitionPct?, tcgplayerProductId:<productId>,
  tcgplayerGroupId:<grupo resuelto>, sealedImageUrl?:<imageUrl>, sealedProductName?:<name> }`. Reglas normativas:
  - **Nace mapeada:** `tcgplayerProductId`+`tcgplayerGroupId` (columnas M-23, ya existentes) se pueblan al crear ⇒
    `sealedMarketRef` y la **aportación de sellado** valúan de inmediato por `sealed:tcg:<productId>` (H-1, §4.23),
    **no** por el gradeKey legacy `'sealed'`. Sin mercado ni override ⇒ `422 PRICE_PENDING` **por línea** (lote
    tolerante), igual que hoy. `applyToSiblings`/curación M2 siguen disponibles pero ya **no** son requisito para el
    primer alta de un producto.
  - **Imagen/nombre de API:** `sealedImageUrl`/`sealedProductName` (deltas M-37) se persisten **validados server-side**
    contra el host allowlist de imágenes TCGplayer/TCGCSV (anti stored-XSS / URL arbitraria); inválidos/omitidos ⇒
    `null` y el display cae a la `Card` ancla. Money-safe (display-only, jamás fijan precio).
  - **Idempotencia:** `batchKey` (`InventoryBatch` M-21, `kind='create'`) — **misma** que hoy; el front DEBE enviarlo
    (anti doble-submit). Publicar a la venta sigue siendo `bulk-publish`/`publish-all {setId, productType:"sealed"}`.
  - **⚠ Autorización (para la fase de seguridad):** que un `vault_operator` fije el mapeo TCGCSV al alta (hoy la
    curación de mapeo es `super_admin` en M2) es una AMPLIACIÓN deliberada: el `productId` proviene de la lista que el
    servidor sirvió (TCGCSV), la valuación sigue derivándose server-side (SEC-A1) y el alta queda **auditada**
    (`AuditLog action=inventory.batch_create`, con el mapeo). Revisar en pentester/seguridad. Ver ARCHITECTURE §4.32c.
- `GET /api/v1/admin/inventory/graded` — **(NUEVO, P-20)** pestaña «Gradeadas»: inventario PSA/CGC **separado** de
  sueltas, agregado por `(cardId, gradingCompany, gradeValue)`. Query `?q=&page=&pageSize=`.
  Res `200`: `{ data: GradedInventoryGroupDTO[], page, pageSize, total }` con
  `GradedInventoryGroupDTO = { cardId, card: { name, number, setName, imageSmallUrl? }, gradingCompany:
  GradingCompany, gradeValue: string, count: number, marketReferenceMxnCents: number | null,
  capturedDate?: string | null, totalCostCents: number | null }` — `marketReferenceMxnCents` = `PriceReference`
  vigente de `(cardId, 'graded', 'graded:<company>:<grade>', 'normal')`, FX-recompute (típicamente **manual**, ver
  nota); `null` honesto si no hay. Drill-down a certs/folios = `items?cardId=&productType=graded`.
  - **Valor de mercado por grado (DECISIÓN v1.28 — ACTUALIZADA en v1.44, ver abajo):** SIN proveedor automático en este
    stream (no verificado que el proveedor exponga precios por grado — doctrina P-6: no construir sobre esquemas no
    confirmados). Se fija MANUAL con el endpoint EXISTENTE `POST /admin/pricing/override` (`productType:"graded"`,
    `gradeKey:"graded:PSA:10"`, `finish` omitido). Si un proveedor futuro da precios por grado, entra por
    `price-ingest` sin cambiar este contrato. Los overrides de venta/compra P-18 aplican con `productType=graded`
    (misma tabla M-30, `finish=normal`).
  - **ACTUALIZACIÓN v1.50-graded-estimate — el mismo valor manual AHORA SE EXPONE AL STOREFRONT (§4.38, PROJECT §O):**
    ~~la parte técnica de la decisión v1.28 sigue vigente: no hay proveedor automático~~ ⛔ **v1.50.2: la fuente
    automática SE DESBLOQUEA.** El Gate 0 de 2026-08-23 (doctrina **P-6**) confirmó que PokemonPriceTracker **sí**
    publica precios PSA pero (a) exige `includeEbay=true`, que **duplica el consumo de créditos**; (b) el **shape del
    payload no estaba confirmado** (la documentación se contradice entre `data[i].ebay.salesByGrade.psa10` —objeto— y
    `gradedPrices.psa10` —escalar—); y (c) **se desconoce** si el parámetro combina con el barrido por set. **v1.50.2
    resuelve (b) sin violar P-6:** un **parser auto-confirmante** que **prueba las dos hipótesis** y **solo persiste lo
    que identifica positivamente como monto** (ante cualquier otra forma **no escribe nada** y registra la muestra).
    P-6 prohíbe *codificar contra un esquema que se asume*; esto **no asume**, **verifica**. (c) sigue siendo
    **escalada obligatoria al arquitecto**. Ver ARCHITECTURE §4.38(h).
    **Lo que SÍ cambia:** esa `PriceReference` **deja de ser un dato exclusivo de back-office**. Con `gradeKey
    'graded:PSA:10'` y `'graded:PSA:9'` es ahora **la fuente ÚNICA del «gancho de grading»** que se muestra al
    comprador en Compra, la ficha y el home (§DTOs base `GradedEstimateDTO`; §2). Consecuencias **normativas** para
    quien opere M1/M2:
    1. **Una sola fila, dos lectores.** La MISMA fila alimenta `GradedInventoryGroupDTO.marketReferenceMxnCents` (esta
       pestaña) **y** el estimado público. Fijarla para el gancho **también** cambia lo que M1 muestra, y viceversa.
       Es **deliberado** (es el mismo hecho de mercado). **No se debe crear una clave paralela** para «separarlos»:
       duplicaría la verdad y obligaría a capturar dos veces.
       > ⛔ **CORRECCIÓN v1.50.2 (INV-D) — la versión anterior de este punto decía que «no mueve dinero en ninguno de
       > los dos lados». ES FALSO cuando hay SLAB PUBLICADO de ese grado:** entonces esa fila **es la referencia de
       > mercado real de esa pieza** y **alimenta su precio de venta**. El error fue generalizar desde el caso «carta
       > sin slab» (donde en efecto no hay dinero). **Por eso `POST /admin/pricing/override` exige `intent` y devuelve
       > `409 GRADED_ESTIMATE_SLAB_PUBLISHED`**, y el storefront **omite** ese grado. ARCHITECTURE §4.38(l).
    2. **Fijar este valor es ahora una AFIRMACIÓN COMERCIAL PÚBLICA**, no una anotación interna: sale en la **ficha**
       en cuanto la carta raw esté publicada y el dato esté fresco, y —si además pasa el **gate de ROI** y el **gate de
       confianza** (v1.50.2)— en la **rejilla de Compra** y la **vitrina del home**. Está gobernada por el disclaimer
       obligatorio y por el dial `gradedEstimatesEnabled` (§M10, **seed `off`**), que es el interruptor maestro.
    3. **No hace falta pieza física.** La FK de `PriceReference` es a `Card`: se puede fijar el estimado de una carta
       **raw** de la que **no tenemos ningún slab**. Eso es precisamente el caso de uso de la fase 1 (§O.6: el humano
       **cura a mano** sus cartas gancho) — y, por INV-D, es también **el único caso en que la captura del estimado
       está permitida**. Ver ARCHITECTURE §4.38(a)/(b), §4.38(h) y §4.38(l).
- **Valor del inventario en M1 (P-24):** las tarjetas de resumen consumen `GET /admin/finance/inventory-value`
  (§M7, extendido con `breakdown` — sigue **`super_admin`**); el front las omite para `vault_operator`
  (coherente con el enmascaramiento del dashboard; sin fuga por API).

#### Baja rápida por cantidad + Export a Excel (v1.34, P-29/P-31) — `vault_operator+`
> P-29 + P-31 de `PENDIENTES.md`. Formaliza lo YA implementado (`BACKEND_NOTES.md` §0-P29/P31). Ambos endpoints en el
> mismo controller M1 (`vault_operator` + `super_admin`). **ADITIVOS y MONEY-SAFE.**

- `POST /api/v1/admin/inventory/items/bulk-remove` — **(NUEVO, P-29)** baja rápida por **CANTIDAD**: da de baja
  **N piezas de un golpe** de un `(cardId, finish[, condición])` sin ir pieza por pieza. Complementa la baja
  por-pieza (`POST /admin/inventory/adjustments` con un `inventoryItemId`) **reusando su semántica** (mismo mapeo de
  motivos, mismo guardarraíl, mismo rastro triple M-24) pero **seleccionando las N piezas server-side**.
  Req (`BulkRemoveRequest`):
  - `cardId: string` (req), `finish: Finish` (req: `normal | reverse_holo | holofoil | first_edition_holofoil`),
  - `quantity: int ≥ 1` (req; tope `MAX_BATCH_QTY = 500`),
  - `reason: perdida | danada | error_captura` (req) — **subconjunto** de los motivos de `adjustments`; **NO** acepta
    `encontrada` (eso es alta, no baja),
  - `note: string` (**REQUERIDO**, no-vacía — motivo/nota de la baja; paridad con la baja por-pieza `adjustments`).
    El DTO backend lo declara `@IsString() note!: string`; **sin `note` ⇒ `400 VALIDATION_ERROR`** (lo rechaza el
    `ValidationPipe` global). **No** es opcional,
  - `batchKey?: string` (**idempotency key generado por el cliente**, OPCIONAL — MISMA forma y semántica que
    `adjustFound` (`InventoryAdjustmentRequest.encontrada`, v1.20.1/BE-47) y `publish-all`; ver bullet
    «Idempotencia» abajo). El front DEBE enviarlo desde el diálogo de baja (anti doble-submit / anti
    reintento-fantasma tras timeout ambiguo),
  - filtros OPCIONALES para desambiguar la casilla: `productType?`, `rawCondition?` (p. ej. `NM`), `sealedCondition?`.
  - **Selección server-side de las «N más apropiadas»:** solo piezas `ownerType=platform` con status ∈
    `{in_stock, listed}` (mismo allowlist que el ajuste), ordenadas **`in_stock` antes que `listed`** (baja primero lo
    NO publicado ⇒ menos disrupción del storefront) y dentro de cada status la **más antigua (FIFO por `createdAt`)**; `take: quantity`.
  - **Motivo → status:** `perdida → lost`, `danada → damaged`, `error_captura → withdrawn` (idéntico a `adjustments`).
  - **Atómico / «no bajar más de las que hay»:** si hay **menos** piezas ajustables que `quantity` ⇒
    `422 INSUFFICIENT_STOCK` (`details: { available, requested }`) y **NO se baja ninguna**. Guardia atómica de status
    (updateMany condicionado + `count`): una carrera que saque una pieza del allowlist entre la lectura y la escritura
    ⇒ `422 ITEM_NOT_ADJUSTABLE` + rollback (nunca pisa una reserva de checkout con lost/damaged).
  - **Money-safe:** solo transiciona `status` (baja de stock); **NO** toca precios (`listPriceCents`, referencias,
    overrides) ni crea/reversa órdenes; **jamás** escribe `reserved`/`listed` (no vende ni publica). No es dinero
    saliente (sin `MoneyOutGuard`).
  - **Idempotencia (`batchKey?`) — cierra el «encogimiento fantasma»:** MISMO mecanismo que `adjustFound`
    (`encontrada`, v1.20.1) y `publish-all` — `InventoryBatch` (M-21) con **`kind='bulk_remove'`**. Un reintento tras
    un timeout ambiguo con el MISMO `batchKey` **NO** vuelve a dar de baja otras N piezas (evita el encogimiento
    fantasma del inventario): el replay **devuelve la respuesta original guardada** de la primera ejecución con
    `idempotentReplay: true` (mismo `200`), **sin** transicionar status ni escribir un segundo lote de ajustes. Sin
    `batchKey` (u omitido) cada llamada es un procesamiento nuevo (`idempotentReplay: false`). Semántica idéntica a la
    documentada para `adjustFound`.
  - **Rastro triple por pieza (obligatorio):** `InventoryMovement(reason=adjustment)` + `InventoryAdjustment` (M-24,
    con `reason`/`fromStatus`/`toStatus`/`actorUserId`/`note`) en la MISMA `$transaction` + `AuditLog
    action=inventory.bulk_remove` (con `batchKey`/`requested`/`removed`/`folios`/`adjustmentIds`) que escribe el
    controller.
  - Res `200` (`BulkRemoveResponse`): `{ batchKey?, idempotentReplay: boolean, removed, requested, reason, toStatus,
    inventoryItemIds: string[], folios: string[], adjustmentIds: string[] }` (arrays alineados 1:1; en el camino feliz
    `removed === requested`; `idempotentReplay:true` ⇒ es el replay de un `batchKey` ya procesado, no una nueva baja).
  - Err `400 VALIDATION_ERROR` (`reason` fuera de `{perdida,danada,error_captura}`; `quantity < 1` o `> 500`; `note`
    ausente o vacía; `finish` inválido), `403`, `404 NOT_FOUND` (carta inexistente), `422 INSUFFICIENT_STOCK`,
    `422 ITEM_NOT_ADJUSTABLE` (carrera TOCTOU). Ver ARCHITECTURE §4.20e.
- `GET /api/v1/admin/inventory/export.xlsx` — **(NUEVO, P-31)** export del inventario de **plataforma**
  (`ownerType=platform`; piezas en custodia de clientes NO se exportan) a un `.xlsx` real (OOXML, lib `exceljs`),
  con grano **una fila por folio/pieza**. Query OPCIONAL `?setId=&productType=` (y otros filtros que el backend
  soporte); `setId` = id LOCAL de `CardSet`; `productType` validado contra el enum (⇒ `400`).
  - **Columnas (orden fijo, `INVENTORY_EXPORT_COLUMNS`):** Folio · Carta · Set · Número · Rareza · Tipo · Acabado ·
    Condición · Certificado · Cantidad (= 1) · Estado · Ubicación · Origen · Costo MXN · Precio mercado MXN · Precio
    compra MXN · Precio venta MXN.
  - **Money-safe (todas las columnas de dinero son STORED, sin derivar ni inventar):** Costo = `acquisitionCostCents`;
    Precio mercado = `PriceReference` de la variante (MXN al FX vivo; ref `pending` ⇒ vacío); Precio compra = override
    de COMPRA manual (`VariantPriceOverride.buyOverrideCents`, sin recomputar la regla del cotizador); Precio venta =
    `listPriceCents` por pieza o, en su defecto, `sellOverrideCents` (sin derivar mercado×markup). **Regla dura: sin
    dato ⇒ celda VACÍA, nunca `0`** (`centsToMxn(null) = null`). Consultas EN LOTE (sin N+1).
  - Res `200` **binario**: `Content-Type:
    application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
    `Content-Disposition: attachment; filename="inventario-YYYY-MM-DD.xlsx"` (+ `Content-Length`). El controller usa
    `@Res()` directo (no lo envuelve el interceptor global de respuesta).
  - Err `400 VALIDATION_ERROR` (`productType` fuera del enum), `403`.

### M2 — Catálogo y precios (`super_admin`)
> **Estado v1.3: YA EXISTE en backend** (`PricingController`, `FxController`, `AdminCatalogController`). No requiere backend nuevo para el flujo M2 existente (sync de precios de bóveda, override, FX, rareza→categoría, sync de catálogo por fecha/backfill); falta **consumo de frontend** (M2 es `ModuleTodo` en UI). Lo **único NUEVO** de backend en M2 es `POST /admin/catalog/sync-all` (abajo), para la Opción 1 del cotizador.
- `POST /api/v1/admin/pricing/sync` — dispara/encola el sync diario (solo bóveda). Req `{ scope?: "all_vault" | "cardIds" , cardIds?: [] }` → `{ jobId, queued: number }`.
- `GET /api/v1/admin/pricing/pending` — cola de precio pendiente. **v2.1:** `{ data: PendingPriceEntry[], counts: PendingPriceCountsDTO }`.
  - **v1.8-ronda-c:** cada `PendingPriceEntry` trae **`finish`** — dos acabados de la misma carta sin precio son **entradas separadas** (antes colapsaban en una).
  - **v1.42 (BLOQ-2b):** para sellado, la entrada trae **`sealedProductId`** (+ `sealedProductName`/`sealedSubtype` de display). Dos presentaciones distintas del mismo set (ETB vs blíster) son **entradas separadas** por `sealedProductId` — antes colapsaban bajo el `gradeKey` legacy `'sealed'`. El override de una **no** cierra la otra (money-safe).
  - **v1.26 (P-6, dos buckets) — query param opcional `?context=`** (`catalog | portfolio | buylist | inventory`; omitido = todos, retro-compatible). Habilita los dos buckets de M2: **VENTA** = `?context=inventory` (inventario incl. no publicado; se escala en `createItem` y —v1.26— en `bulk-publish`); **COMPRA** = `?context=buylist`, una vista **READ-ONLY** (solo display). ⚠️ **Producir el precio de compra on-request es un WRITE del buylist (`itemDecision`, acoplado a control INE/AML) — FUERA DE ALCANCE de M2;** COMPRA no escribe decisiones ni resuelve pendientes de buylist. Ver ARCHITECTURE §4.24c.
  - **v2.0 (P-48) — cada entrada gana `reason: PendingPriceReason | null`** y el endpoint el **filtro `?reason=`**
    (`no_market | premium_at_floor`; omitido = todas, retro-compatible; `null` en filas históricas). Distinguirlos es
    lo que hace **triable** la cola: `no_market` la cura sola el siguiente barrido; **`premium_at_floor` necesita que
    el dueño mire** (es el **guardarraíl** §4.36.5: una rareza premium cuyo precio aterrizó en el piso/bin, señal
    inequívoca de que **su dato de mercado está mal**). Volumen esperado de `premium_at_floor`: **≈3 de 333** cartas de
    un master set completo — si sale mucho más, el problema es el **piso mal calibrado** o el ingest, no el guardarraíl.
  - **v2.0 — dos entradas nuevas a la cola (money, LOCKED):** (1) **sin dato de mercado ⇒ `no_market`** — la variante
    **NO se publica y NO se cotiza**; el piso/bin **NO gana** (decisión del humano que corrige el supuesto de §N.2:
    un guardarraíl por rareza atraparía una Secret Rare con dato corrupto pero **no** una Common de $400 sin dato, que
    se publicaría al piso — sería reabrir el hueco exacto que este cambio cierra). (2) **`premium_at_floor`** en
    **AMBOS ejes**: premium en el piso ⇒ no se publica; premium en el bin ⇒ no se cotiza.
  - **v2.1 (NUEVO) — `counts: PendingPriceCountsDTO` en el CUERPO de la respuesta.** Conteo por motivo sobre la cola
    **completa**, para el encabezado `12 SIN MERCADO · 3 PREMIUM EN EL PISO` de DESIGN_SYSTEM §21.7c.
    `{ "counts": { "no_market": 12, "premium_at_floor": 3, "unknown": 0 } }`
    - **⚠️ NORMATIVO — los `counts` IGNORAN `?reason=` y la paginación, pero RESPETAN `?context=`.** Es la distinción
      que arregla el defecto: **`reason` filtra DENTRO de la cola que estás triando; `context` elige QUÉ cola es**
      (VENTA = `inventory` vs COMPRA = `buylist`, los dos buckets de §4.24c). Si los conteos ignoraran `context`, el
      encabezado del bucket de VENTA sumaría pendientes de COMPRA — el mismo defecto en otro eje. Y si respetaran
      `reason`, al filtrar «Premium en el piso» el encabezado diría `0 SIN MERCADO · 3 PREMIUM EN EL PISO`: **el
      número mentiría justo cuando el dueño está filtrando para triar**, que es cuando más lo mira.
    - **Solo `status = "open"`.** La cola es una **bandeja de trabajo**: una entrada `resolved` ya no es trabajo
      pendiente y no debe inflar el encabezado.
    - **`unknown`** = entradas con `reason = null` (**filas anteriores a M-41**, §11). Existe para que se cumpla el
      invariante **`no_market + premium_at_floor + unknown === nº de entradas `open` de esa cola`** — verificable por
      QA y aseverable por el front. Sin esta tercera clave, una cola con filas históricas haría que los dos números
      **no cuadraran con la lista** y pareciera un bug del backend. DESIGN_SYSTEM §21.7c ya contempla la fila
      `(ausente, filas históricas) → «—»`, así que la UI puede mostrarla o ignorarla; el contrato **no** la esconde.
    - **DECISIÓN: van en el CUERPO, no en un recurso aparte.** Tres razones, en orden de peso: (1) **coherencia en
      pantalla** — encabezado y lista se pintan del mismo `load`, así que salen del mismo snapshot y no pueden
      contradecirse; con un recurso aparte hay dos round-trips y una ventana en la que el encabezado describe un
      estado que la tabla ya no muestra, que es una variante del mismo defecto que se está corrigiendo; (2) **coste
      trivial** — es un `groupBy(reason)` sobre la misma tabla y el mismo predicado menos el filtro de `reason`, no
      una consulta nueva; (3) **precedente local** — este contrato ya devuelve agregados-sobre-el-total junto a una
      lista paginada (`GET /admin/inventory/sealed-sets` → `unmappedTotal`; `PublishAllResponse.summary`), así que no
      se inventa un patrón.
    - **Los dos números juntos son un DIAGNÓSTICO, no dos cifras sueltas** — y es la razón de peso para que viajen en
      la misma respuesta. Contra la línea base de **≈3 por cada 333** cartas (ARCHITECTURE §4.36.9c-3):
      **`premium_at_floor` sube y `no_market` se queda plano** ⇒ hay dato de mercado y está **por debajo del piso**:
      apunta a **piso mal calibrado** (o a un piso que subió sin recalibrar la curva). **Suben los dos a la vez** ⇒
      apunta al **feed de mercado degradado** (`price-ingest`/proveedor), no a la curva. Son los dos diagnósticos que
      hoy el dueño no puede separar sin contar a mano, y separarlos exige **ver ambos conteos del mismo instante**.
    - *(Observación para PO/orquestador, **no** es cambio de contrato ni acción de nadie ahora):* el **Dashboard** ya
      tiene una tarjeta **«salud de datos»** (`dataHealth.pendingPriceCount`). Si `premium_at_floor` es señal de salud
      del sistema, ése es su sitio natural para que el dueño lo note **sin navegar a M2**. Reusaría este mismo
      `groupBy`. Se anota y **se difiere**; hoy la señal vive donde se triaja, que es lo que pidió el diseño.
  - **v2.0 — SALIDA de la cola (simétrica a la entrada):** cuando el **siguiente barrido** (`price-ingest`) escribe una
    `PriceReference` real y el precio vuelve a resolver con `priceBasis="market"`, la entrada `open` de esa clave se
    **cierra sola** en la siguiente resolución (publicación / re-publicación / `publish-all` / lectura del binder),
    **sin intervención manual**. La vía manual (`POST /admin/pricing/override`) **no cambia**.
- `POST /api/v1/admin/pricing/override` — override manual (respaldo siempre disponible).
  Req: `{ cardId, productType, gradeKey, priceMxnCents, finish?, intent? }` → crea `PriceReference` `source=manual` **para ese acabado**, resuelve **solo** el `PendingPriceEntry` de ese `(cardId, productType, gradeKey, finish)`.
  - **⚠️ v1.50.2 — `intent` es OBLIGATORIO cuando `productType:"graded"` (BREAKING chico, `super_admin`).**
    `intent: "market" | "graded_estimate"`. Cierra la colisión **INV-D** (ARCHITECTURE §4.38l): la fila del
    «estimado si se gradea» y la **referencia de mercado real de un slab PSA publicado** son **LA MISMA FILA**
    (`cardId` + `productType='graded'` + `gradeKey` + `finish='normal'`), así que fijar un «estimado» sobre una carta
    que además tiene un slab publicado de ese grado **cambiaba el precio de venta real de esa pieza**.
    | Caso | Respuesta |
    |---|---|
    | `productType:"graded"` **sin** `intent` | **`422 GRADED_INTENT_REQUIRED`** |
    | `intent:"graded_estimate"` **y existe ≥1 slab publicado** de ese `(cardId, gradingCompany, gradeValue)` | **`409 GRADED_ESTIMATE_SLAB_PUBLISHED`** |
    | `intent:"graded_estimate"` **y la fila del día de esa clave existe con `refKind:"market"`** | **`409 GRADED_ESTIMATE_WOULD_DEGRADE_MARKET_REF`** *(NUEVO v1.50.3-g, `M-44`)* |
    | `intent:"market"` | comportamiento **vigente, sin cambios** (§M1 v1.28) |
    | `productType` ≠ `"graded"` | `intent` se **ignora** si viene; nada cambia |
    - **⚠️ v1.50.3-g — `409 GRADED_ESTIMATE_WOULD_DEGRADE_MARKET_REF` (`M-44`, BREAKING chico, `super_admin`).**
      **Regla normativa (ARCHITECTURE §4.38l.4.3 regla 2, ampliada, y §4.38l.4.10):** *la naturaleza de una fila solo
      se **SUBE** (`graded_estimate → market`), y solo por acto humano declarado (`intent:"market"`). **Bajarla no es
      una operación que ofrezca este sistema** — ni automática ni manual.* Hasta v1.50.3-f la prohibición solo pesaba
      sobre el **ingest**; el escritor humano tenía el hueco abierto y el blue team lo reprodujo en vivo.
      - **Condición exacta que dispara el `409`:** `intent:"graded_estimate"` **y** ya existe fila para
        `(cardId, productType:"graded", gradeKey, finish, capturedDate = hoy, cardProductId)` **con
        `refKind:"market"`**. La fila **no se toca**: ni su `refKind` ni su `priceMxnCents`. El bloqueo **se audita**
        (`AuditLog`), igual que sus hermanas.
      - **⚠️ El alcance es LA FILA DEL DÍA, y es deliberado.** `refKind` **no** está en la `@@unique`, así que la
        colisión destructiva solo existe dentro del mismo `capturedDate`. **Cross-day no se prohíbe nada**: un
        estimado capturado hoy crea **otra** fila y la fila `market` de ayer **sigue siendo candidata de dinero
        perenne** (override manual durable, v1.46 / §4.27f-2) ⇒ el slab —de plataforma **o de custodia**— conserva su
        precio. Prohibirlo cross-day mataría el caso legítimo (una carta que tuvo slab, se vendió, y hoy se quiere
        exhibir su estimado) y **vaciaría la vitrina en silencio**.
      - **Precedencia:** si se cumplen las dos condiciones (slab publicado **y** fila `market` del día), gana
        **`409 GRADED_ESTIMATE_SLAB_PUBLISHED`** — es la preexistente y su mensaje es más útil al operador. `M-44`
        cubre **exactamente el complemento**: el hueco que la otra no ve (slab en `in_stock`/`reserved`/`picking`/
        envío, slab **en custodia de cliente**, o sin slab alguno).
      - **Transaccionalidad (normativo):** la comprobación de naturaleza es **parte de la escritura**, no de su
        antesala — va en la **misma transacción** que el upsert. Un pre-vuelo fuera de la transacción es **opcional y
        solo para construir el mensaje**. Sin esto, dos peticiones concurrentes (`intent:"market"` /
        `intent:"graded_estimate"`) pueden consumar la degradación por TOCTOU.
      - **Mensaje:** «No se puede convertir en ESTIMADO la referencia de MERCADO de PSA {grade} de esta carta: la
        fila de hoy vale {monto} y fue afirmada como precio de mercado. Si quieres cambiar ese precio, usa
        `intent:"market"`; si quieres retirar el dato, hazlo con el borrado del gancho.»
        `details: { cardId, gradeKey, currentRefKind: "market", capturedDate }`. **`priceMxnCents` actual NO viaja en
        `details`** (no aporta a la decisión y es dato comercial; el operador lo ve en `priceHistory`).
      - **Fricción aceptada y declarada** (para que nadie la «arregle» luego creyendo que endurece): quien capture
        `intent:"market"` por error y quiera corregirlo a estimado **el mismo día** recibe `409` y **no tiene
        escotilla** — el `DELETE` del gancho borra **solo** filas `graded_estimate`. El coste máximo es que el gancho
        de esa carta espere a mañana; el beneficio es que **un verbo informativo no puede destruir un dato de
        dinero**. ARCHITECTURE §4.38(l.4.10).
    - **⚠️ v1.50.3-g — validación del borde (SEC-M43-4; precisión ADITIVA, el contrato ya normaba `422`):**
      | Entrada | Respuesta normada | Hoy devuelve |
      |---|---|---|
      | `productType` fuera del conjunto soportado (`raw`/`graded`/`sealed`) | **`422 VALIDATION_ERROR`** | `500` ⛔ |
      | `cardId` que no existe | **`404 NOT_FOUND`** | `500` ⛔ |
      | `gradeKey` que no corresponde a una clave generable por `gradeKeyFor` (p. ej. `graded:PSA:11`) | **`422 VALIDATION_ERROR`** | `200` ⛔ (crea fila para un grado inexistente) |
      Un `500` en un endpoint de dinero es indistinguible de una caída real y contamina cualquier alerta de
      401/403 que se monte sobre `/admin/*`. **No hay fuga de información** (el filtro devuelve `INTERNAL` sin
      detalle), por eso es **Baja** y no bloquea; **conviene cerrarlo junto a C4**.
    - **⚠️ v1.50.3-f — `intent` FIJA la NATURALEZA de la fila (`refKind`), y ésa es la que decide si el número puede
      ser dinero.** `intent:"market"` (y todo `productType` ≠ `graded`) ⇒ `refKind="market"`;
      `intent:"graded_estimate"` ⇒ `refKind="graded_estimate"`. **Regla normativa (ARCHITECTURE §4.38l.4):** *una fila
      `graded_estimate` **nunca** resuelve precio de venta, oferta de compra ni valuación* — no es que pierda la
      precedencia: **no entra como candidata**. Cierra **INV-D en la dirección inversa** (capturar el estimado antes y
      publicar el slab después), que el pentester reprodujo en vivo: **MX$9,200 → MX$460**.
      - **Consecuencia observable, y hay que leerla antes de desplegar:** un slab publicado cuya **única** fila de esa
        clave sea un estimado pasa a `priceBasis:"pending"` / `PRICE_PENDING` y **deja de ser vendible** hasta que
        alguien capture su precio real con `intent:"market"`. Es **deliberado y fail-closed** (mejor sin precio que al
        5%). El procedimiento de cut-over —enumerar con `/graded-estimates/review?reason=SLAB_PUBLISHED` y
        **re-afirmar cada slab con `intent:"market"` ANTES de migrar**— es **obligatorio**: sin él una pieza puede
        apagarse en silencio. ARCHITECTURE §4.38(l.4.7). **⚠️ v1.50.3-g (`M-45`): ese procedimiento fue REESCRITO**
        (congelación de publicaciones `graded` durante la ventana; censo que **para y escala** sin rama alternativa;
        re-censo como gate previo al deploy; **sin backfill**; verificación con check **positivo Y negativo**;
        rollback con **precondición de cero** filas `graded_estimate`). **El `UPDATE` de clasificación que circulaba
        en el runbook queda ⛔ DEROGADO**: usaba el predicado de una **guarda** (`platform+listed`) para una decisión
        de **naturaleza**, y en una BD real habría marcado como estimado la referencia de mercado de todo slab no
        listado en ese instante, **incluidos los de custodia de clientes**. ARCHITECTURE §4.38(l.4.7)/(l.4.7-bis)/(l.4.11).
      - **El `409` y el `422` NO se retiran** (defensa en profundidad): con slab publicado, «capturar un estimado»
        sigue siendo una intención equivocada y el sistema lo dice, aunque ya no mueva dinero.
      - **El ingest de fase 2 escribe siempre `refKind="graded_estimate"` y NUNCA degrada una fila `market`** (si la
        fila del día ya es de mercado, hace *skip* + traza, igual que ante `isManualOverride`).
      - **`PriceSource` NO cambia** (⛔ derogada la vía «enum + `sourceRank` bajo»: ordenar no excluye, y el estimado
        suele ser la única candidata de su clave). ARCHITECTURE §4.38(l.4.1).
    - **CONDICIONAL — `409 GRADED_ESTIMATE_DISABLED` (solo bajo la «vía B» de ARCHITECTURE §4.38l.5).** Si el humano
      decide fusionar **antes** de que M-43 esté desplegado, `intent:"graded_estimate"` responde `409` mientras
      `gradedEstimatesEnabled` esté `off` (el `DELETE` y `/review` **siguen funcionando** con el dial apagado: se
      gatea **crear**, nunca limpiar ni diagnosticar). **Transitorio**: se retira al desplegar M-43. Si M-43 entra en
      este pase, este código **no llega a existir**.
      Mensaje: «El gancho de grading está apagado (`gradedEstimatesEnabled=off`): no se pueden capturar estimados
      hasta encenderlo.» `details: { cardId, gradeKey }`.
    - **Mensaje del `422`:** «Para `productType:"graded"` debes declarar `intent`: `"market"` (precio de mercado real
      de un slab publicado) o `"graded_estimate"` (valor estimado si se gradea).»
    - **Mensaje del `409`:** «No se puede fijar un valor ESTIMADO de PSA {grade} para esta carta: hay {n} slab(s)
      PSA {grade} publicado(s). Esa fila es el precio de mercado real de esas piezas y cambiaría su precio de venta.
      Usa `intent:"market"` si lo que quieres es fijar el precio de mercado del slab.»
      `details: { cardId, gradeKey, publishedSlabCount, inventoryItemIds }`.
    - **Por qué OBLIGATORIO y no opcional-con-default:** un `intent` que cayera a `"market"` por omisión es
      **fail-open** — el operador que olvida el campo obtiene **en silencio** la ruta que mueve dinero. Se acepta el
      coste de un *breaking* pequeño en una ruta `super_admin` a cambio de que la ambigüedad sea **imposible de
      expresar**. Misma doctrina que «sin escalón no hay destacado» y «AUSENTE ≠ INVÁLIDA».
    - **El ingest de fase 2 aplica la MISMA guarda** (salta esas cartas y deja `AuditLog`).
    - ⚠️ **Migración de llamadores:** cualquier script o llamada interna que escriba `productType:"graded"` **debe
      actualizarse** antes de desplegar, o empezará a recibir `422`.
  - **v1.26 — invariante del hazard de tabla compartida (documentado):** la resolución de pendientes es **CONTEXT-AGNÓSTICA** (el `updateMany` filtra por `(cardId, productType, gradeKey, finish, status='open')` **sin `context`**) ⇒ un override desde **VENTA** (`context=inventory`) cierra **también** el pendiente de **COMPRA** (`context=buylist`) de la misma variante, y viceversa. Se **conserva agnóstico (opción a)**: la `PriceReference` es compartida por clave, así que el precio fijado es válido para ambas caras y no mueve dinero. Añadir un `context` scope al `updateMany` (opción b) es cambio en el archivo del stream de precios del que **depende el stream buylist** ⇒ **requiere serialización/coordinación con buylist**, no unilateral. Ver ARCHITECTURE §4.24c.
  - **`finish?` (v1.8-ronda-c, opcional, default `normal`):** `normal | reverse_holo | holofoil | first_edition_holofoil`. Fija/actualiza la `PriceReference` del acabado indicado y resuelve el pendiente de **ese** acabado; el pendiente de otros acabados de la misma carta **permanece abierto**. Omitirlo mantiene el comportamiento previo (`normal`). No debilita SEC-A1 (es un precio de referencia del admin, no un monto de cliente).
  - **v1.46 (P47-2) — DURABILIDAD del override manual (precedencia de LECTURA §4.27f-2):** el override manual persistido por este endpoint es **máxima precedencia ABSOLUTA y DURABLE cross-day**: gana la resolución de la referencia de mercado **todos los días**, no solo el de su captura, **aunque el barrido diario `tcgcsv_singles` escriba una fila más fresca** (§4.35). **Solo lo revoca** (a) **otro `POST /admin/pricing/override`** posterior sobre la misma `(cardId, productType, gradeKey, finish)` (supersede al anterior), o (b) la **limpieza/borrado explícito de la fila por `super_admin`** (permiso money). **Ninguna** escritura automática (`tcgcsv_singles`/PPT/pokemontcg.io) lo pisa. Es semántica de LECTURA (comparador `isBetterRef`): **sin migración, sin cambio de shape**. Ver ARCHITECTURE §4.27f-2.
  - **v1.28 (P-20):** con `productType:"graded"` + `gradeKey:"graded:<company>:<grade>"` es la vía NORMATIVA para
    fijar el **valor de mercado por carta+grado** (pestaña Gradeadas de M1). Sin cambio de shape.
  - **v1.50 (§O v2.0) — ES TAMBIÉN LA CAPTURA DE LA FASE 1 DEL «GANCHO DE GRADING».** Con
    `productType:"graded"` + `gradeKey:"graded:PSA:10"` / `"graded:PSA:9"` (+ `finish` **omitido** ⇒ `normal`,
    + **`intent:"graded_estimate"`** desde v1.50.2), este endpoint escribe **exactamente** las filas que el storefront
    lee para el gancho (§2, §DTOs base). **No se construye ningún mecanismo de captura nuevo** (PROJECT §O.6,
    decisión 47). Notas normativas:
    - **⚠️ INV-FX — Recibe MXN directo** (`priceMxnCents`, entero **`≥ 1`** por la guardia L1 ya vigente): **no hay FX
      en esta vía**. En la **fase 2**, el ingest **DEBE** escribir **USD + `fxRate`** en la MISMA clave (PPT entrega
      USD) y `liveMxnCents` recompone — **el lector público es el mismo y el DTO resultante es idéntico**
      (indistinguibilidad, ARCHITECTURE §4.38g). **Está PROHIBIDO que el ingest escriba el numeral USD en
      `priceMxnCents`**: son dos rutas con **unidades distintas** hacia la misma fila, y confundirlas produce un error
      de **~19×**. ARCHITECTURE §4.38(a) INV-FX.
    - **`isManualOverride=true` / `source='manual'` ⇒ MÁXIMA PRECEDENCIA, también después de encender el ingest**
      (§O.6). La resuelve `pickBestRef`/`isBetterRef` **dentro de la tabla**; ningún consumidor bifurca por origen.
      ~~**v1.50.2:** por eso mismo, **la ventana de frescura NO se le aplica**…~~ ⛔ **DEROGADO en v1.50.3.**
      **La ventana de frescura SÍ se le aplica** (`manualFreshnessDays`, seed **30**, contra su fecha de captura):
      lo exige el **criterio 109** y `PROJECT.md` manda sobre el contrato. El problema real que v1.50.2 quiso
      resolver —un manual viejo ganaba la resolución y **luego** la frescura lo descartaba, dejando la carta sin
      estimado **pese a haber dato fresco**— se cierra **invirtiendo el orden**: la frescura filtra las candidatas
      **antes** de que `pickBestRef` elija, no después. Así el manual rancio cede el paso al automático fresco, y el
      manual rancio **sin** respaldo deja de exhibirse. **`isBetterRef` no se toca** (ARCHITECTURE §4.38m).
    - **NO hace falta que la carta tenga inventario gradeado**: la FK es a `Card`. Es el flujo de curaduría del humano.
    - **NO crea `PendingPriceEntry`, y la AUSENCIA de estimado PSA NO es un «precio pendiente»** (sería inundar la cola
      de M2 con todo el catálogo). Su comportamiento vigente de **resolver** el pendiente de la clave escrita, si
      existiera, **no cambia**. ARCHITECTURE §4.38(b).
    - **Efecto lateral consciente:** escribir aquí cambia también el `marketReferenceMxnCents` de M1 › Gradeadas (misma
      fila, dos lectores — ver la nota v1.50 en §M1); si la carta **raw** está publicada, **enciende los estimados en
      la ficha**; y si además **pasa el gate de ROI y el de confianza**, la **destaca** en la rejilla de Compra y en la
      vitrina del home. Es una afirmación comercial: el dial `gradedEstimatesEnabled` (§M10) es el interruptor maestro,
      y `GET /admin/pricing/graded-estimates/preview` dice **por qué** una carta quedó (o no) destacada.
      **v1.50.3:** y `GET /admin/pricing/graded-estimates/review` dice **qué cartas hay que revisar** sin tener que
      preguntarlas una por una (criterio 111(e)).
    - **⚠️ v1.50.2 — y si hay SLAB PUBLICADO de ese grado, el efecto lateral es DINERO:** esa fila es la referencia de
      mercado real de la pieza. Por eso `intent:"graded_estimate"` devuelve **`409 GRADED_ESTIMATE_SLAB_PUBLISHED`** en
      ese caso (arriba), y el storefront **omite ese grado** aunque la fila exista (INV-D, ARCHITECTURE §4.38l).
  - **v1.43 (IMP-C) — sellado + dial `off`:** con `productType:"sealed"` + `gradeKey:"sealed:tcg:<productId>"` esta es
    la vía «FIJAR PRECIO» de la cola de pendientes del sellado; persiste un **override manual de MERCADO** (`source=manual`,
    `isManualOverride=true`). **Ese override SOBREVIVE al dial `sealedPriceSource=off`** (el dial gatea solo el ingest
    automático TCGCSV, no un override manual). Tras fijarlo, el sellado se auto-precia por `mercado(override) × spread` y
    **re-publicar NO re-crea el pendiente**. Ver el changelog v1.43 y ARCHITECTURE §4.23a. *(Antes de v1.43,
    `gateSealedMarketCents` anulaba este override con el dial `off` ⇒ bucle `PRICE_PENDING`.)*
- `PUT /api/v1/admin/pricing/variant-controls/:cardId/:finish` — **(NUEVO v1.28, P-18/P-22, `super_admin`,
  auditado)** upsert de los controles de precio por (carta, variante[, grado]) — persiste `VariantPriceOverride`
  (M-30). **Estos valores PISAN lo que ve el cliente** (decisión del humano): `sellOverrideCents` fija el precio
  publicado del storefront (para piezas sin `listPriceCents` manual); `buyOverrideCents`/bounty fijan la oferta
  del cotizador público de buylist. Precedencias normativas en ARCHITECTURE §4.26b.
  Req (`VariantControlsRequest`):
  `{ productType?: "raw" | "graded" /* default raw */, gradeKey?: string /* default "raw:NM"; graded:
  "graded:PSA:10"… */, sellOverrideCents?: number | null, buyOverrideCents?: number | null,
  bounty?: { enabled: boolean, priceCents?: number, targetQty?: number | null } | null }`
  — campos omitidos NO se tocan; `null` explícito LIMPIA (quitar un override regresa la cara a su regla;
  `bounty: null` o `enabled:false` apaga el bounty sin borrar el contador). Fila con todo vacío ⇒ puede borrarse
  (equivalente observable).
  - **Validaciones:** centavos enteros `> 0`; `raw` ⇒ `:finish ∈ Card.availableFinishes` (SEC-A1,
    `422 FINISH_NOT_AVAILABLE`); `graded` ⇒ `:finish = normal` y `gradeKey` con forma `graded:<company>:<grade>`;
    `productType="sealed"` ⇒ `422 VALIDATION_ERROR` (el sellado conserva su cadena H-1). Bounty: **solo
    `productType="raw"`** (`422 VALIDATION_ERROR` en graded — la vitrina pública es de sueltas y un bounty
    invisible sería incoherente; los overrides sell/buy en graded SÍ aplican);
    `enabled:true` sin `priceCents>0` ⇒ **`422 BOUNTY_PRICE_REQUIRED`**; `priceCents <` sugerido de compra por
    regla del momento (cuando el sugerido resuelve) ⇒ **`422 BOUNTY_BELOW_RULE`** (si el sugerido está `pending`
    se acepta: el bounty es SIEMPRE precio explícito, jamás calculado); `targetQty ≥ 1`.
  - **v2.0 (P-48) — el bounty se revalida contra la CURVA, y ahora en TRES momentos (§N.6, criterios 90/91):**
    - **`422 BOUNTY_BELOW_RULE` cambia de comparación:** se compara contra la **cotización de la curva** vigente y
      **rechaza también el EMPATE** (`priceCents ≤ curveQuoteCents`, antes solo `<`). Detalle del error:
      `{ curveQuoteCents, priceCents }`. **Por qué el endurecimiento:** el predicado de runtime exige
      **estrictamente mayor** (criterio 91: «todo lo de la vitrina es mejor que la tarifa estándar»), así que un
      bounty **igual** a la curva pasaría el alta y sería **invisible en ejecución** — una incoherencia entre alta y
      runtime. Reversible en dato (subir el bounty $0.01). Curva `pending` ⇒ se **acepta** (sin cambio).
    - **AL COTIZAR** (`/buylist/quote`, `/quote/batch`, `createRequest`): un bounty que quedó **por debajo o igual**
      de la curva vigente **deja de ser bounty** — se **salta el peldaño 1** y se paga la **curva**. El `priceBasis`
      resultante **nunca** es `"bounty"`.
    - **AL PUBLICAR** (`GET /buylist/bounties`): **desaparece de la vitrina** (Home y Vender).
    - **ALERTA EN EL BINDER (y solo ahí — decisión del humano):** la respuesta trae `pricing.bounty.effective=false` +
      `curveQuoteCents` para que M1 pinte el aviso. **NO** hay aviso proactivo (correo/push/dashboard): eso es alcance
      posterior.
  - **v2.0 — el override manual de compra SIGUE SIENDO ABSOLUTO** (criterio 89): `buyOverrideCents` puede quedar
    **por debajo** de la curva vigente —decisión deliberada del admin para esa variante— y **se paga exactamente ese
    monto**. **No** se levanta al nivel de la curva ni se envuelve en un `max(...)`. Ídem `sellOverrideCents`.
  - **v2.1.3 (D5) — H-1 aplica también al override POR PIEZA (`InventoryItem.listPriceCents`).** «Presente ⇔ `> 0`»:
    un `listPriceCents <= 0` se trata como **AUSENTE** y la pieza cae al siguiente peldaño (override de variante →
    curva). Es la misma regla que ya gobierna `sellOverrideCents`/`buyOverrideCents` y el override del sellado; el
    peldaño 1 era el **único** que no la había heredado. **Un `0` no es un precio** (§H: jamás se publica MX$0), y
    dejar el mismo campo con dos lecturas es exactamente la forma del bug P-48. **Se cierra en las dos puntas:** el
    **write** rechaza `<= 0` (abajo) y la **lectura** lo trata como ausente en **todos** los seams (storefront, ficha,
    checkout, binder, publish, barrido y valor de inventario), vía **un solo predicado compartido**.
    Ver ARCHITECTURE §4.36.6.
  - Res `200` (`VariantControlsResponse`): `{ cardId, productType, gradeKey, finish, pricing: VariantPricingDTO }`
    (el estado RESUELTO tras el write — mismo DTO que lee el binder; §DTOs). Err `404 NOT_FOUND` (carta), `403`.
  - **Auditado** (`AuditLog action=pricing.variant_controls`, before/after). **Toca dinero en ambas direcciones**
    → gate de seguridad por release. NO toca `PriceReference` (el mercado es otra perilla) ni resuelve
    `PendingPriceEntry` (un override de venta/compra no es una referencia; la cola de pendientes sigue siendo del
    mercado — a diferencia de `pricing/override`).
  - **Efectos colaterales normativos:** el conteo del bounty (`bountyAcquiredQty`) lo incrementa el PAGO de M5
    (SPEI) en su misma transacción, por cada `SellRequestItem` con snapshot ~~`ruleSource="bounty"`~~
    **`priceBasis="bounty"`** (v2.0: mismo criterio, campo nuevo) de esa clave
    **cuyo `itemStatus` NO sea `rechazada`** (v1.28.1, alineado con BL-1: un ítem rechazado del cherry-pick no se
    compra ni se paga ⇒ jamás cuenta para el bounty ni dispara el auto-apagado — ARCHITECTURE §4.26e); al
    llegar a `targetQty` ⇒ `enabled=false` + `completedAt` + `AuditLog action=bounty.completed` (auto-apagado).
    Apagar/editar un bounty NO re-precia solicitudes ya cotizadas (montos snapshoteados, doctrina vigente).
- `GET /api/v1/admin/pricing/card/:cardId` — **historial de precios** por fecha/fuente de esa carta (todas las
  variantes/grados/tipos), `capturedDate` **desc**. **Forma NORMADA en v2.1.7** — antes solo decía «historial de
  precios por fecha/fuente» y **no fijaba campos**: backend y frontend coincidían por **acuerdo tácito**, que es
  exactamente la condición que produjo B-1 (ver la convención de DTOs cerrados abajo).
  Res `200`: `{ data: PriceHistoryEntryDTO[] }` (§DTOs de administración).
  - **`isManualOverride` SÍ viaja aquí, y NO contradice su retiro de `PriceInfo` (v2.1.6).** Dos razones, y conviene
    dejarlas escritas para que la próxima auditoría no lo vuelva a levantar como fuga:
    1. **La superficie es distinta.** Allá era **anónima** (`/catalog/*`) y la procedencia permitía inferir estado
       interno de pricing — un mapa de dónde falló el feed. Aquí es **`super_admin`** y la procedencia **es la
       pregunta que el endpoint contesta**: «¿de dónde salió este precio y cuándo?». Retirarlo lo vaciaría.
    2. **Aquí NO es redundante con `source`.** En `PriceInfo` se resuelve **una** referencia y `source === "manual"`
       la determina por completo. En el historial son **N filas** y el resolver trata las dos señales como
       **separadas** (`sourceRank(source, isManualOverride)`, `pricing.service.ts:105-106`, que casa
       `isManualOverride || source === 'manual'`): una fila puede venir marcada manual con un `source` distinto de
       `manual`. En una superficie de **auditoría** ambas cargan información.
    > **Regla general que esto ilustra:** un mismo campo puede ser **fuga** en una superficie y **carga** en otra. La
    > pregunta correcta nunca es «¿este campo es sensible?» sino **«¿es sensible PARA QUIEN LEE ESTA RUTA?»**.
- `POST /api/v1/admin/pricing/override` — **Res `200` NORMADA en v2.1.7:** `{ data: PriceHistoryEntryDTO }` — la
  referencia recién escrita, **proyectada**, no la entidad.
  > ⚠️ **Por qué se norma: hoy devuelve la fila Prisma `PriceReference` COMPLETA** (`manualOverride(): Promise<PriceReference>`,
  > devuelta tal cual por el controller). Eso publica `id`, `priceUsdCents`, `fxRate`, `fxBufferPct`, `cardProductId`,
  > `createdAt`… **sin que el contrato lo diga**. No es fuga pública (`super_admin`), pero es la **causa raíz** de
  > esta familia: **cuando la respuesta ES la entidad, la forma de la API la define el SCHEMA, no el contrato — y
  > entonces CADA MIGRACIÓN es un cambio de contrato silencioso.** M-41 añadió columnas a tres modelos; con este
  > patrón, cualquier columna futura se auto-publica. **Norma: ningún endpoint devuelve una entidad Prisma
  > directamente; siempre una proyección declarada.**
- FX: `GET /api/v1/admin/fx` → `{ rate, bufferPct, source: FxSource, effectiveDate }` (automático diario desde **Banxico SIE** + colchón). `PUT /api/v1/admin/fx` — Req `{ rate?, bufferPct? }` → fija **override manual** (`source=manual`, prioridad sobre el automático del día). `POST /api/v1/admin/fx/refresh` — fuerza el fetch a Banxico.
  - **`rate?` opcional (v1.14-price-ingest, #13):** si se **omite** `rate`, la llamada actualiza **solo** el colchón (`bufferPct`) y **NO** pinnea el override manual de tasa (`fx_manual_override_rate`) → la tasa **automática de Banxico sigue activa**. Antes exigía ambos, así que subir solo el colchón congelaba la tasa sin querer. El colchón **aplica en cada ingest de precios** (USD→MXN con FX+buffer, ARCHITECTURE §4.15f). **Vía recomendada sin cambiar este endpoint:** editar el colchón por `PUT /admin/settings { fxBufferPct }` (parcial, ya soportado). **Nota para frontend (M2):** exponer un guardado del colchón independiente del `rate`.
#### Curva de precio por VALOR DE MERCADO (v2.0 — NUEVO; editor M2, `super_admin`) — SUPERSEDE el editor por TIERS y por RAREZA
> **P-48, PROJECT §N v2.0 LOCKED, ARCHITECTURE §4.36.** El precio de las **cartas sueltas** (raw **y** gradeadas) deja
> de depender de la **rareza** y del **acabado**. Queda **UNA curva por eje de dinero** sobre el **valor de mercado**:
>
> ```
> venta  = redondeo↑( max( piso , mercado × markup(mercado) ) )
> compra =            max( bin  , mercado × pct(mercado)    )
> ```
>
> **Desaparecen** los modos `fixed`/`pct`, los 5 tiers, el mapa rareza→tier, las reglas por acabado (`finishRules`) y
> los cinco `SettingKey` que los sostenían — reemplazados por **UNO solo**, `pricing_curve`. El **SELLADO no cambia**
> (spread por presentación, §2-S). Toda edición se **audita** (M10) y **surte efecto sin redeploy**.
>
> **Por qué UN solo endpoint y no dos (venta/compra por separado) — razón de money-safety, no de estilo:** el
> invariante «la compra queda por debajo de la venta en todo el dominio» es **cruzado** (depende de las dos curvas +
> el piso + el bin **a la vez**). Con dos endpoints, dos `PUT` sucesivos abren una ventana en la que se compra por
> encima de lo que se vende. Con **uno**, la validación es **atómica por construcción** y esa ventana no existe.

- `GET /api/v1/admin/pricing/curve` — **(NUEVO)** lee la curva completa. Read-only.
  Res `200` (`PricingCurveDTO`, §DTOs — semillas de PROJECT §N.2):
  ```json
  { "version": 1,
    "sale": {
      "floorCents": 2500,
      "points": [ { "marketCents": 2500, "multiplierBp": 16000 },
                  { "marketCents": 8000, "multiplierBp": 11500 } ],
      "rounding": [ { "uptoCents": 20000, "stepCents":  500 },
                    { "uptoCents": 50000, "stepCents": 1000 },
                    { "uptoCents": null,  "stepCents": 2500 } ]
    },
    "buy": {
      "binCents": 100,
      "points": [ { "marketCents":  2500, "pctBp": 3000 },
                  { "marketCents": 10000, "pctBp": 4000 },
                  { "marketCents": 50000, "pctBp": 5000 } ]
    } }
  ```
  - **Unidades (normativas, todo entero):** dinero en **centavos MXN**; `multiplierBp` y `pctBp` en **puntos base del
    mercado** (`10000 bp = 1× = 100 %`). `1.60×` = `16000`; `30 %` = `3000`.
  - **Interpolación LINEAL** entre puntos; **tramos planos SOLO antes del primero y después del último**. Un tramo
    escalonado dentro del rango está **prohibido** (criterio 81).
  - **`points` es de LONGITUD VARIABLE** (requisito explícito del humano, §N.3): el dueño **agrega**, **mueve** y
    **borra** renglones. **NO** es una estructura fija de N puntos. `rounding` también es de longitud variable.
  - El **piso** y el **bin** son **ÚNICOS y GLOBALES** para todo el catálogo de cartas: **no** por acabado, **no** por
    rareza, **no** por tier (§N.10 lo descarta explícitamente). **v2.1.9:** y **precisamente por ser globales llevan
    techo propio** — `floorCents, binCents ∈ [0, 200000]` (**MX$2,000**), que **no** es el de `marketCents`; ver el
    bloque del `PUT`.
  - El **redondeo↑ aplica SOLO a venta**; la **compra no se redondea**. La **banda** la decide el monto de venta
    **ANTES** de redondear y se elige **UNA SOLA VEZ**: si el redondeo cruza el umbral, **no se re-evalúa**.
- `PUT /api/v1/admin/pricing/curve` — **(NUEVO)** **reemplaza el objeto completo** (semántica de reemplazo, no de
  patch por índice: mover/borrar un renglón por índice es frágil y no auditable; el `AuditLog` guarda `before`/`after`
  del objeto entero).
  Req: el mismo `PricingCurveDTO`. Los puntos pueden venir desordenados: el server **ordena por `marketCents`** y
  rechaza duplicados.
  - **Validaciones money-safe (se imponen al GUARDAR — 422, no solo en runtime; §N.3 / criterio 87). Si algo falla NO
    se guarda, y el cuerpo del error dice EXACTAMENTE QUÉ PUNTO lo rompe** (`details: { axis: "sale"|"buy", index,
    marketCents, … }`):

    | Código `422` | Invariante que protege |
    |---|---|
    | `VALIDATION_ERROR` | tipos y rangos **de REPRESENTABILIDAD y CORDURA** (no de negocio): **`marketCents ∈ [0, MAX_CENTS]`** entero (v2.1.4 — el techo importa: `interpExact` computa `num` en aritmética `number` **antes** del `BigInt`, y un breakpoint absurdo lo saca del rango seguro); **`multiplierBp ∈ [0, 1000000]`** (v2.1.5 — el piso baja de `10000` a `0`); `pctBp ∈ [0, 10000]`; **`floorCents ∈ [0, 200000]`** y **`binCents ∈ [0, 200000]`** (**v2.1.9** — antes `≥ 0` **sin techo**; `200000` = `MAX_CURVE_CONSTANT_CENTS` = **MX$2,000**, y **NO** es `MAX_CENTS`: ver el bloque de abajo) |
    | `CURVE_EMPTY` | `sale.points` y `buy.points` deben tener **≥ 1** punto (sin puntos no hay curva) |
    | `DUPLICATE_BREAKPOINT` | dos puntos con el **mismo `marketCents`** en la misma curva |
    | `SALE_BELOW_MARKET` | **ningún precio de venta cae por debajo del mercado** ⇒ `multiplierBp ≥ 10000` **en cada punto** |
    | `SALE_CURVE_NOT_MONOTONIC` | **la curva de venta es monótona creciente SOBRE EL PRECIO QUE SE COBRA** — más mercado **nunca** produce menos precio. **v2.1.2:** el invariante se afirma sobre `roundUp(max(piso, ROUND_HALF_UP(m·k(m)/10000)), escalera)`, no sobre una aproximación suya; lo sostiene la **prohibición de cuantizar** el multiplicador interpolado (ARCHITECTURE §4.36.1) |
    | `BUY_ABOVE_SALE` | **la compra queda ESTRICTAMENTE por debajo de la venta en TODO el dominio** ⇒ **v2.1.2:** `multiplierBp(m) − pctBp(m) ≥ 1` (una unidad entera de la escala compartida) en la unión de los puntos de ambas curvas. Antes era `<` sobre los valores continuos, y dos valores distintos dentro del mismo centavo colapsaban a `compra == venta` (margen cero) |
    | **`BUY_CURVE_NOT_MONOTONIC`** | **(NUEVO v2.1.4)** la curva de **COMPRA** es monótona creciente **sobre el monto que se PAGA** — más mercado **nunca** paga menos. `BUY_ABOVE_SALE` solo ata la compra en **relativo** (por debajo de la venta); esto la ata en **absoluto**. Mismo chequeo algebraico de extremos que `SALE_CURVE_NOT_MONOTONIC`, aplicado a `buy.points`. `details` con `axis:"buy"` + el tramo `(index, index+1)` |
    | `BIN_ABOVE_FLOOR` | `binCents < floorCents` (el caso en que ambos ejes saturan en su constante) |

  - **⚠️ FORMA DE `details` — NORMADA CAMPO POR CAMPO (v2.1.5). Nada de «…».** Cada campo que un consumidor tiene que
    leer va **nombrado aquí**. Aplica igual al `PUT` y a `violations[]` del `preview`.

    | Código | `details` (campos EXACTOS) | Qué consume el front (DESIGN_SYSTEM §21.4b/c) |
    |---|---|---|
    | `VALIDATION_ERROR` | `{ axis: "sale"\|"buy", index: number \| null, field: string }` | marca **el campo** inline (§21.4a), no el resumen |
    | `CURVE_EMPTY` | `{ axis }` | «La curva de {venta\|compra} se quedó sin puntos» |
    | `DUPLICATE_BREAKPOINT` | `{ axis, index, index2, marketCents }` | marca **las dos** filas colisionadas + `{m}` |
    | `SALE_BELOW_MARKET` | `{ axis: "sale", index, marketCents, multiplierBp }` | marca la fila + `{m}` |
    | `SALE_CURVE_NOT_MONOTONIC` | `{ axis: "sale", index, marketCents, index2, marketCentsTo }` | marca **los DOS extremos** + `{m0}`=`marketCents`, `{m1}`=`marketCentsTo` |
    | `BUY_CURVE_NOT_MONOTONIC` | `{ axis: "buy", index, marketCents, index2, marketCentsTo }` | ídem, eje compra |
    | `BUY_ABOVE_SALE` | `{ marketCents, multiplierBp, pctBp, saleIndex?, buyIndex? }` | `{m}`, `{pct}`=`pctBp/100`, `{mult}`=`multiplierBp/10000`; marca la fila en **ambas** caras |
    | `BIN_ABOVE_FLOOR` | `{ binCents, floorCents }` | `{bin}`, `{floor}`. **Sin `axis`/`index`**: es una pareja de constantes, no un punto |
    | `ROUNDING_LADDER_INVALID` | `{ axis: "sale", bandIndex, uptoCents, stepCents }` | marca **la banda** infractora de la escalera |

    - **`index2` / `marketCentsTo` son el SEGUNDO extremo del tramo.** Los errores de **tramo** (`*_NOT_MONOTONIC`) y
      la colisión (`DUPLICATE_BREAKPOINT`) describen un problema **entre dos puntos**: marcar solo uno deja al dueño
      sin la mitad de la información. *(Se normalizan **estos** nombres —los que el backend ya emite— y no unos más
      simétricos tipo `indexTo`: renombrar código que funciona por estética no vale el churn. La asimetría
      `index2`/`marketCentsTo` es deliberada y queda documentada, no es un descuido.)*
    - **`multiplierBp` y `pctBp` viajan en el `details` de `BUY_ABOVE_SALE`** — **el front NO los recalcula**. Serían
      una interpolación en el cliente, o sea justo la duplicación de fórmula que el `preview` existe para eliminar
      (§4.36.8a). Van en **bp**; el formateo a `%`/`×` es display.
    - **`bandIndex` no es `index`.** Indexa `sale.rounding[]`, no `sale.points[]`. Nombre distinto a propósito: un
      `index` ambiguo entre dos colecciones es el mismo tipo de hueco que se está cerrando.
    - **`index: null` EXPLÍCITO para lo que no es un punto de la tabla (v2.1.9 — se declara lo que ya se emite).**
      `floorCents` y `binCents` son **constantes globales del eje**, no filas: su `VALIDATION_ERROR` viaja con
      `{ axis, index: null, field }`. **El campo TIENE que estar aunque su valor sea nulo** — omitirlo devuelve al
      consumidor a adivinar, que es la mitad «lo que debe estar, declarado» de la convención de abajo. Por eso `index`
      se declara **`number | null`** y no `number`: el backend ya emitía `null` (`pricing-curve.ts:753-756`) y este
      contrato lo tenía mal escrito. El front distingue **fila** (`index: number` ⇒ marca el renglón) de **constante**
      (`index: null` ⇒ marca el campo de piso/bin, §21.4a).

  - **⚠️ EL TECHO DE `floorCents` / `binCents` — por qué NO es `MAX_CENTS` (v2.1.9, NORMATIVO; ARCHITECTURE §4.36.3).**
    Hasta v2.1.8 este contrato decía literal `floorCents ≥ 0` y `binCents ≥ 0`, **sin cota superior** — las dos únicas
    entradas de la curva sin techo, y justo las que fijan el **piso de venta** y el **mínimo de compra**. Con eso:

    ```
    PUT /admin/pricing/curve  {"sale":{"floorCents":2000000000000000,…}}   → HTTP 200
    GET /catalog/cards        → venta 2147483647 · basis "floor"  (MX$21,474,836.47) — TODA la vitrina
    ```

    **El código cumplía este contrato** (por eso la corrección es del contrato, no de backend), y **no hay respaldo al
    seed**: una curva con piso gigante está **bien formada**, así que el saneador de lectura la acepta.

    - **`marketCents` y las constantes son magnitudes distintas.** `marketCents` describe **el valor de una carta**
      —que legítimamente puede ser alto— y su techo es **representabilidad** (Int32, el rango seguro de `interpExact`).
      `floorCents` describe **el precio mínimo de la carta más barata de la tienda** y `binCents` **el pago mínimo por
      cualquier carta**: son las **únicas** entradas que **por sí solas** deciden el precio de **todo** el catálogo.
      Saturarlas no produce «un precio alto», produce **una vitrina entera republicada**. Con `MAX_CENTS` como techo, el
      caso de arriba **seguiría pasando** con `floorCents: 2147483647` — un techo que no cambia el síntoma no es el
      techo.
    - **El número: `MAX_CURVE_CONSTANT_CENTS = 200000` (MX$2,000) — cerrado por el dueño (Q-D1, 2026-08-24).**
      Anclado en **qué es el número acotado**: `floorCents` **es el precio de la carta más barata de la tienda**, así
      que un piso por encima de MX$2,000 significaría que **nada** en la vitrina baja de MX$2,000 — implausible para un
      marketplace de singles cuya semilla es MX$25 (§N.2) y cuyo bulk vale centavos. Deja **80×** sobre la semilla del
      piso y **2 000×** sobre la del bin, y queda **10 737×** por debajo de Int32 ⇒ la vitrina saturada es
      **inalcanzable por construcción**. **Apretarlo es lo correcto por asimetría de costo:** pasarse de apretado cuesta
      **un `422` y volver a teclear**; pasarse de holgado cuesta **republicar la vitrina entera y apagar el buylist**.
      - **⛔ El techo del piso NO se deriva de los topes de §E**, y conviene dejarlo escrito para que nadie lo
        «restaure» viendo que las cifras se parecían: MX$3,000/solicitud y MX$10,000/mes son **límites AML por usuario
        sobre dinero que SALE** y no dicen nada sobre cuánto puede costar la carta más barata. Ése era **mi** anclaje en
        el borrador de esta rev y **queda retirado**: era coincidencia de orden de magnitud, no razonamiento — y ataría
        el techo del **pricing** a un dial de **AML**.
      - **Precedente que hacía legítimo proponer un número** (no que lo determina): este contrato ya fija techos
        anti-typo que no vienen de PROJECT (`multiplierBp ≤ 1000000` = «100×, techo anti-typo»; `pctBp ≤ 10000`).
    - **Bloquea igual en `PUT` y en `preview`**: V3 es del grupo «impide calcular» ⇒ `422` en las dos rutas, mismo
      código y mismo `details` (tabla de arriba).
    - **Lo que este techo NO hace, dicho para que nadie lo dé por cerrado:** **no ataja «un cero de más»**. Con la
      semilla en MX$25, un typo a MX$250 (`25000`) **pasa y debe pasar** — es una calibración plausible. Ningún techo
      atrapa ese caso sin bloquear configuraciones legítimas: el error y la intención escriben **el mismo número**. Ese
      caso se cubre **viéndolo**, con dos señales que **ya existen**: `CurvePreviewLegDTO.constantWon` **por sonda**
      (una curva con el piso disparado da `true` en **todas** las sondas de la tabla de referencia) y el contador
      **`premium_at_floor`** de `GET /admin/pricing/pending` (con el piso disparado, toda carta premium aterriza en el
      piso ⇒ guardarraíl ⇒ cola; §4.36.5c ya norma su lectura: «sube solo ⇒ **piso mal calibrado**»).
    - **`binCents` también lleva techo explícito** aunque `BIN_ABOVE_FLOOR` lo acote transitivamente: V3 corta **antes**
      de que ese invariante se evalúe, y apoyarse solo en él dejaría el error señalando el campo equivocado.
    - **✅ Q-D1 CERRADA (2026-08-24, ARCHITECTURE §10):** el **número** era calibración de negocio y lo fijó el dueño
      en **MX$2,000** (el borrador de esta rev proponía MX$10,000). El **techo** y el hecho de que **no sea
      `MAX_CENTS`** nunca estuvieron en duda: son la parte técnica, y son justo lo que hace defendible un número tan
      apretado. Sin efecto en la matemática ni en ningún DTO.

  - **📌 CONVENCIÓN NORMATIVA DE DTOs — LOS DOS SENTIDOS (transversal, v2.1.6; no solo `details`, no solo la curva).**
    Un DTO de este contrato es **CERRADO, no abierto**: enumera su superficie **completa**.
    1. **Lo que debe estar, DECLARADO.** Ningún campo que un consumidor deba leer puede quedar dentro de un «…». Si
       un `details` (o cualquier DTO) lleva algo que la UI tiene que pintar o usar para marcar, va **nombrado**.
    2. **Lo que no debe salir, PROHIBIDO.** Emitir un campo **no declarado** es una **violación del contrato**, no una
       adición inocua. «Aditivo es seguro» vale para el **consumidor** (que ignora lo que no conoce); **no** vale para
       el **emisor**, porque publicar de más no rompe a nadie — **filtra**.
    > **Por qué hacen falta las dos mitades, con un caso de cada una.** La primera nació de un hueco que **apagó
    > funcionalidad**: el segundo extremo del tramo vivía en un «…», backend emitió `index2`/`marketCentsTo`,
    > frontend inventó `toIndex`/`toMarketCents` y **la marca nunca se pintó** desde E9. La segunda nació de un hueco
    > que **publicó información**: `PriceInfo.isManualOverride` **nunca estuvo declarado** y el backend lo emitía a
    > endpoints **anónimos** (fase de seguridad, v2.1.6) — un mapa scrapeable de qué cartas llevan precio manual.
    > **Son el mismo defecto por las dos caras: el contrato no mintió, no dijo.** Un DTO que solo lista lo obligatorio
    > deja el resto al criterio de quien implementa — y ese criterio, sin malicia, resuelve unas veces de menos
    > (funcionalidad apagada) y otras de más (fuga). **Ningún test de contrato caza ninguno de los dos**, porque en
    > ambos casos no hay nada que contradecir.
    3. **Lo declarado, VERIFICADO SOBRE LA FORMA SERIALIZADA** (v2.1.7 — la tercera pata, que faltaba). La
       verificación de un DTO cerrado se hace sobre **el JSON que sale**, **en las dos direcciones** (que no sobre,
       que no falte) y **en el nivel de agregación que el consumidor realmente lee**.
    > **Por qué el JSON y no el objeto:** *en memoria, un opcional ausente y un requerido que falta se ven idénticos*.
    > Esa indistinguibilidad es exactamente la que B-1 explotó — `GroupedListingDTO` y `SealedGroupDTO` se construían
    > como **objetos literales sin tipo**, así que omitir `priceBasis` **no era error de compilación**, y
    > `undefined === "market"` daba `false` **siempre**: «Valor de mercado» **no se mostró nunca**, ni cuando el
    > mercado sí fijaba el precio. **La regla no se apagó: se INVIRTIÓ** — el peor modo de fallo, porque la pantalla
    > se veía «correcta» (un bloque que falta no se nota) y el E2E contra el stack vivo fue lo único que lo cazó.
    > **Por qué el nivel de agregación importa:** ya existía un test que vigilaba que **no saliera de más** a nivel de
    > **pieza** (`catalog.dto-closed.spec.ts`); faltaba el simétrico, que **no faltara de menos** a nivel de **grupo**.
    > **Un test sobre el DTO de unidad NO cubre el de grupo, aunque compartan campos** — son builders distintos, y el
    > que el consumidor lee es el de grupo.
    > **Y la mitad estructural:** todo DTO se construye **con su tipo puesto** (builder anotado), no como objeto
    > literal suelto. Con el tipo, omitir un campo requerido **deja de compilar**; sin él, el test es la única red.
    > Backend lo verificó revirtiendo la emisión con los tipos puestos: **el spec deja de compilar**. Ése es el
    > estándar — *que el compilador atrape lo que pueda, y el test serializado lo que no*, la misma doctrina que
    > `DisplayBp` (§M2 preview).
    4. **Un enum se declara UNA vez, y su declaración canónica ESPEJA el schema** (v2.1.8 — cuarta pata). Ampliar un
       enum en `schema.prisma` **sin** ampliar su línea canónica aquí es un **cambio de contrato silencioso**: el
       backend emite el valor nuevo (lo contrario sería inventar dato) y el consumidor recibe algo **fuera de su
       unión**.
    > **Se eleva a norma porque ya ocurrió DOS veces, y la segunda cortó funcionalidad.** (a) `PriceSource` no
    > incluía **`tcgcsv_singles`** —la fuente **primaria** de singles, o sea **la mayoría** de las filas de
    > `GET /admin/pricing/card/:cardId`— pese a que el changelog de v1.44 lo anunció. Agravante: el enum estaba
    > **DECLARADO DOS VECES** en este bloque, que es precisamente el mecanismo por el que una copia se actualiza y la
    > otra no; **se colapsaron en una**. (b) `SealedSubtype` no incluía **`upc`** ni **`collection`** pese al
    > changelog de v1.39 — y ahí no fue solo cosmético: la validación de `PUT /admin/pricing/sealed-spreads` deriva
    > de ese enum, así que **el dueño no podía calibrar spread** para dos presentaciones reales; caían siempre al
    > fallback global.
    > **Regla práctica:** un enum del contrato que tenga contraparte en `schema.prisma` lleva su referencia
    > (`archivo:líneas`) al lado, y el espejo se verifica — un test que compare **los valores del enum Prisma contra
    > los declarados aquí** cuesta poco y cierra la clase entera. Es el análogo, a nivel de tipo, del test sobre la
    > forma serializada.
    > **⚠️ AMPLIADA en v2.1.9 (D4) — la pata tenía DOS huecos, y los dos ya se materializaron:**
    > 1. **La verificación es a TRES bandas, no a dos.** El candado que se escribió compara la lista derivada contra
    >    `Object.values(<PrismaEnum>)` (`enum-values-parity.spec.ts:58`) — pero **la lista derivada ES eso**, así que
    >    **es una tautología: no puede fallar nunca**. Y aunque no lo fuera, seguiría sin mirar **la tercera copia, esta
    >    declaración**, que es justo la que falló en los dos casos de v2.1.8. **Norma: `schema.prisma` (leído del
    >    archivo, no del cliente generado) ↔ `common/enum-values.ts` ↔ la línea canónica de §Enums.** El mismo spec ya
    >    trae la forma correcta para **un** enum (`:67-76`, `readFileSync` del schema); esa forma es la norma para
    >    todos.
    > 2. **«Espejar el schema» no siempre es lo correcto — y cuándo NO lo es hay que decidirlo por endpoint.** Una
    >    lista de validación que expresa una **regla de PROJECT.md** (no el dominio del enum) **no se deriva**:
    >    derivarla la **borra**, porque cualquier valor futuro del schema se auto-aceptaría en la API sin decisión.
    >    Clases **E**/**R**, pregunta que decide, obligaciones de cada una e **inventario vigente**: **ARCHITECTURE
    >    §4.37**. Caso vivo reclasificado: **`RawCondition`** (§Enums).
    > **La simetría con las otras patas es exacta:** aditivo-es-seguro vale para el consumidor y no para el emisor;
    > derivar-del-schema vale para el espejo y no para la regla. En ambos casos la trampa es aplicar a una cara un
    > argumento que solo es cierto en la otra.
    > **Por qué se eleva a convención:** un hueco aquí produjo un bug **silencioso** que vivió desde E9. El contrato
    > normaba `details: { axis, index, marketCents, … }` y dejaba el segundo extremo dentro del «…»; backend emitió
    > `index2`/`marketCentsTo`, el frontend declaró `toIndex`/`toMarketCents` —nombres que **inventó y que nadie
    > podía contradecir, porque no estaban normados**— y **el segundo extremo del tramo nunca se marcó**. No era un
    > fallo de V9: afectaba a `SALE_CURVE_NOT_MONOTONIC` y `DUPLICATE_BREAKPOINT` **desde antes**.
    > **El contrato no mintió: no dijo.** Y un hueco de especificación hizo el mismo daño que una especificación
    > equivocada, con el agravante de que **ningún test de contrato podía cazarlo** — no había nada que contradecir.
    > La auditoría que disparó este hallazgo encontró **cuatro códigos más** en la misma situación
    > (`BUY_ABOVE_SALE`, `BIN_ABOVE_FLOOR`, `ROUNDING_LADDER_INVALID`, `SALE_BELOW_MARKET`): todos con placeholders en
    > el copy de §21.4c que el front tenía que rellenar **adivinando** o **recalculando**. Quedan normados arriba.
    | `ROUNDING_LADDER_INVALID` | escalera bien formada: `stepCents ≥ 1`; `uptoCents` estrictamente crecientes; **exactamente la última** con `uptoCents = null`; **cada frontera múltiplo exacto del paso de la banda inferior** (si no, el redondeo rompe la monotonía) |

  - Res `200`: mismo shape que el `GET`. **Auditado** (`AuditLog action=pricing.curve.update`, before/after).
    **Sin redeploy**: mover un punto **repricia** todo lo afectado **en el siguiente cálculo** (el precio de venta se
    resuelve en LECTURA, no está persistido — por eso no hace falta re-publicar nada).
  - **Se RETIRA `422 PREMIUM_RARITY_FIXED_TIER`**: su invariante (`premium ⇒ pct`) ya no existe. Lo sustituye el
    **guardarraíl** de §4.36.5 (que no valida configuración: bloquea publicación/cotización en runtime).
- `POST /api/v1/admin/pricing/curve/preview` — **(NUEVO v2.1, `super_admin`)** **DRY-RUN**: evalúa una curva
  **borrador** contra N mercados de sonda. **No persiste nada, no audita, no autoriza.** Alimenta el previsualizador
  **obligatorio** del editor (DESIGN_SYSTEM §21.5: probeta + tabla de referencia). ARCHITECTURE §4.36.8a.
  > **Por qué existe — money-safety, no comodidad.** Sin este endpoint el frontend tiene que **reimplementar la
  > matemática de §4.36.1 en el cliente**: dos implementaciones de una fórmula de dinero que pueden divergir. Aquí el
  > daño es peor que el habitual, porque **el dueño calibraría la curva contra un cálculo que no es el que va a
  > cobrar** — elige los puntos mirando una cifra que el backend no produce. Es el bug de P-48 (precio mostrado ≠
  > precio real) **en espejo**. Y mata **dos** duplicaciones, no una: la aritmética **y** los invariantes cruzados,
  > porque `violations[]` sale del **mismo validador que usa el `PUT`** — que es exactamente lo que §21.4 le **prohíbe**
  > reimplementar al editor («si el cliente inventara un rechazo que el servidor no haría, el dueño dejaría de confiar
  > en la pantalla»).

  Req (`CurvePreviewRequest`): `{ draft: PricingCurveDTO, marketsCents: number[] }`
  - **`draft` (obligatorio)** = la curva **en edición**, aún sin guardar.
  - **`marketsCents`** = sondas, enteros **≥ 0**, **1..50**. El servidor **deduplica y ordena ascendente** (la tabla de
    referencia de §21.5b los quiere así, y dejarlo del lado del servidor evita otra reimplementación por pequeña que
    sea). Vacío, sobre-cap o valor negativo/no entero ⇒ `400 VALIDATION_ERROR`.
  - **`marketCents: 0` es una sonda LEGÍTIMA**, no un error: devuelve `basis:"pending"` y `priceCents:null`. Es la
    forma de que el previsualizador **enseñe en pantalla** la decisión money del humano — «sin dato de mercado ⇒
    precio pendiente; el piso **NO** gana» — en vez de dejarla solo escrita en un documento.
  - **El request NO trae la curva vigente, a propósito:** la columna «VIGENTE» la calcula el **servidor** leyendo **su**
    `pricing_curve` almacenada. Si el cliente pudiera echarla de vuelta, un cliente rancio pintaría una columna
    «VIGENTE» que no es la vigente — y ésa es justamente contra la que el dueño mide su cambio. *(Se lee al atender la
    petición: si alguien guardó en el intervalo, el siguiente preview ya lo refleja.)*

  Res `200` (`CurvePreviewResponse`): `{ rows: CurvePreviewRowDTO[], violations: [] }` — una fila por sonda (ordenadas
  asc), cada una con el resultado del **borrador** y de la **vigente** + `deltaCents`. Ver §DTOs para la memoria de
  cálculo completa (`appliedBp`, `rawCents`, `constantCents`/`constantWon`, `baseCents`, `roundingStepCents`,
  `segment`) — es literalmente lo que §21.5a pinta bajo cada cifra.
  ```json
  { "rows": [
      { "marketCents": 5000,
        "draft": {
          "sale": { "priceCents": 7500, "basis": "market", "appliedBp": 14409, "rawCents": 7205,
                    "constantCents": 2500, "constantWon": false, "baseCents": 7205,
                    "roundingStepCents": 500, "segment": { "fromIndex": 0, "toIndex": 1 } },
          "buy":  { "priceCents": 1733, "basis": "market", "appliedBp": 3467, "rawCents": 1733,
                    "constantCents": 100, "constantWon": false, "baseCents": null,
                    "roundingStepCents": null, "segment": { "fromIndex": 0, "toIndex": 1 } } },
        "saved": {
          "sale": { "priceCents": 7000, "basis": "market", "appliedBp": 13955, "rawCents": 6977,
                    "constantCents": 2500, "constantWon": false, "baseCents": 6977,
                    "roundingStepCents": 500, "segment": { "fromIndex": 0, "toIndex": 1 } },
          "buy":  { "priceCents": 1667, "basis": "market", "appliedBp": 3333, "rawCents": 1667,
                    "constantCents": 100, "constantWon": false, "baseCents": null,
                    "roundingStepCents": null, "segment": { "fromIndex": 0, "toIndex": 1 } } },
        "deltaCents": { "sale": 500, "buy": 66 } }
    ],
    "violations": [] }
  ```
  > **⚠️ Recalculado en v2.1.2 con la interpolación EXACTA — la versión anterior de este ejemplo estaba derivada del
  > bp cuantizado y afirmaba cifras que la matemática corregida ya no produce.** Corresponde al de DESIGN_SYSTEM
  > §21.5a (borrador que sube el punto de venta de MX$80 de `1.15×` a `1.25×` y el de compra de MX$25 de `30%` a
  > `32%`). Lo que cambió y por qué:
  >
  > | Campo | Antes (bp cuantizado) | Ahora (racional exacto) |
  > |---|---|---|
  > | `draft.buy.rawCents` / `priceCents` | `1734` (de `k→3467`, `5000×3467/10000 = 1733.5`) | **`1733`** (`k = 10400/3 = 3466.666…`, `= 1733.33…`) |
  > | `saved.sale.rawCents` / `baseCents` | `6978` (de `k→13955`, `= 6977.5`) | **`6977`** (`k = 13954.545…`, `= 6977.27…`) |
  > | `deltaCents.buy` | `67` | **`66`** |
  >
  > **Los `appliedBp` (`14409`, `3467`, `13955`, `3333`) siguen siendo correctos** — pero **solo como display**: son la
  > interpolación redondeada a bp, **no** el valor con el que se calcula. Los `priceCents` finales **no cambian**
  > (`$75.00` / `$70.00`), porque la escalera absorbe el centavo — pero `rawCents` sí, y es el número que el
  > previsualizador pinta en la memoria de cálculo.
  >
  > **Nota para ux-ui (retira mi sugerencia anterior de usar «≈» aquí):** con la matemática exacta, las cifras de la
  > prosa de §21.5a — `17.33` y `69.77` — **son exactas**, no truncamientos. Eran correctas desde el principio; el que
  > estaba desviado un centavo era mi ejemplo cuantizado. El caveat general sigue en pie (`appliedBp` es display, así
  > que rehacer a mano puede diferir ≤1 centavo en otros mercados), pero **en este ejemplo no hay nada que suavizar**.
  - **BORRADOR INVÁLIDO — la respuesta se parte por COMPUTABILIDAD, no por severidad (decisión normativa):**

    | Grupo | Códigos | Respuesta | Por qué |
    |---|---|---|---|
    | **Impide calcular** | `VALIDATION_ERROR` (tipos/rangos), `CURVE_EMPTY`, `DUPLICATE_BREAKPOINT`, `ROUNDING_LADDER_INVALID` **estructural** (banda abierta ausente/duplicada, `stepCents < 1`, `uptoCents` no crecientes) | **`422`**, mismos códigos y mismo `details` que el `PUT` | **No hay número que devolver:** sin puntos no hay qué interpolar, con dos puntos en el mismo mercado la interpolación es **ambigua** (división por cero) y sin banda no se puede elegir paso. Un `200` aquí sería **inventar un precio** |
    | **Calculable pero prohibido** | `SALE_BELOW_MARKET`, `SALE_CURVE_NOT_MONOTONIC`, **`BUY_CURVE_NOT_MONOTONIC`** (v2.1.4), `BUY_ABOVE_SALE`, `BIN_ABOVE_FLOOR`, `ROUNDING_LADDER_INVALID` **fino** (frontera no múltiplo del paso inferior) | **`200`** con los precios **calculados** + `violations[]` con el mismo `{ code, details }` que emitiría el `PUT` | Son invariantes sobre la **forma** de una curva que **sí** se puede evaluar. Un `422` apagaría el previsualizador **justo cuando más se necesita**: §21.4 ordena que «el previsualizador enseñe el problema **en pesos**» y §21.4b-3 que **resalte el tramo implicado**. Con `422`, el dueño leería la prosa del error sin poder ver cuánto cuesta, y corregiría a ciegas. *(`BUY_CURVE_NOT_MONOTONIC` entra aquí por la misma razón: la tabla de referencia de §21.5b es donde el dueño VE que su curva de compra baja.)* |

  - **⚠️ REGLA DURA — el preview NO autoriza.** Un `200` con **`violations: []` NO significa que el `PUT` vaya a
    pasar**: el `PUT` **re-valida desde cero** contra el estado almacenado en el momento de la escritura. El cliente
    **jamás** puede saltarse, cachear ni cortocircuitar la validación del `PUT` apoyándose en un preview. El preview es
    **lectura**; la autoridad del dinero es el `PUT` (SEC-A1).
  - **Qué NO hace (para que nadie lo amplíe por inercia):** no persiste (ni curva, ni `PriceReference`, ni entrada de
    cola); **no se audita** — es lectura pura y no mueve dinero *(se dice explícito porque todo lo demás en pricing sí
    se audita, y su ausencia podría leerse como olvido)*; **no evalúa el guardarraíl** ni consulta rareza, overrides,
    bounties ni inventario — opera sobre **mercados hipotéticos**, no sobre variantes reales, y por eso `basis` solo
    puede valer `market | floor | pending` (**nunca** `override` ni `bounty`); y **no cuenta impacto** sobre
    publicaciones reales (diferido por el orquestador, DESIGN_SYSTEM §21.13.2).
  - **La escalera se aplica IGUAL cuando gana el piso** — y el previsualizador lo hace visible: con piso `MX$25.30` y
    paso `MX$5`, `baseCents = 2530` ⇒ precio publicado `MX$30`. Sin `baseCents` en la respuesta eso parecería un
    descuadre; con él, el dueño ve por qué su piso «no se respeta al centavo» y puede alinearlo al paso.
  - **Test de aceptación (normativo, criterio 79/80/82):** con los diales iniciales de §N.2, las sondas de la **prueba
    de mesa** de ARCHITECTURE §4.36.1 (`1.14 · 10 · 25 · 50 · 80 · 86 · 87 · 100 · 300 · 500`) deben devolver
    **exactamente** esas cifras (`$87 ⇒ $105`, **no** `$110`). Es el mismo test que la función pura y el mismo que QA
    verifica en la tabla de referencia de §21.5b: **una fórmula, tres puntos de observación, cero divergencia posible.**
  - Err: `400 VALIDATION_ERROR` (sondas vacías / > 50 / no enteras / negativas; `draft` ausente o mal formado),
    `422` (los del grupo «impide calcular», arriba), `403 FORBIDDEN` (rol < `super_admin`).
  - **⚠️ RATIFICADO v2.1.2 (hallazgo M1 de QA — la implementación devuelve `422` donde aquí dice `400`; manda el
    contrato).** La separación es deliberada y **se conserva**:
    - **`400` = la PETICIÓN está mal formada** (`marketsCents` vacío, > 50, no entero, negativo; `draft` ausente o sin
      la forma de `PricingCurveDTO`). No se llegó a evaluar ninguna curva.
    - **`422` = la CURVA es inevaluable** (`CURVE_EMPTY`, `DUPLICATE_BREAKPOINT`, rangos, escalera estructural). La
      petición era válida; el objeto de negocio no.
    - **Por qué 400 y no 422 en los límites de la lista:** es el **precedente local** para exactamente la misma forma
      (lista + cap 50): `POST /buylist/quote/batch` → «Vacío o sobre-cap → `400 VALIDATION_ERROR`»; ídem
      `bulk-publish` y `bulk-remove`. Un cap de request es forma, no regla de negocio. **Backend ajusta** (no usar
      `BusinessException.validation`, que mapea a 422, para este grupo).
    - **Nota de calidad de test (para backend):** el caso `pricing.curve-endpoints.spec.ts:315` **se titula «→ 400»
      pero solo asserta `code`**, nunca el status — por eso la divergencia pasó verde. Los tests de estos errores
      deben **assertar el status HTTP**, no solo el `code`; si no, la distinción 400/422 no está cubierta por nada.
- `GET /api/v1/admin/reports/pricing-brackets` — **(NUEVO, M9, `super_admin`)** — instrumentación (§N.8, criterio 95).
  Agrega las operaciones **consumadas** por eje × `MarketBracket` para responder «¿qué tan rápido rota cada bracket y
  con qué margen?». Es lo que evita que la calibración de la curva vuelva a ser una corazonada.
  Query: `from?`, `to?` (fechas ISO), `axis?` (`sale | buy`; omitido = ambos).
  Res `200`:
  ```json
  { "from": "2026-08-01", "to": "2026-08-24",
    "sale": [ { "bracket": "r25_80", "operations": 41, "unitsSold": 47,
                "grossMxnCents": 415000, "marketMxnCents": 305000,
                "byBasis": { "market": 39, "floor": 0, "override": 2, "bounty": 0, "pending": 0 } } ],
    "buy":  [ { "bracket": "lt_3",  "operations": 310, "unitsBought": 310,
                "paidMxnCents": 31000, "marketMxnCents": 74000,
                "byBasis": { "market": 12, "floor": 296, "override": 2, "bounty": 0, "pending": 0 } } ] }
  ```
  - `bracket` = **escala FIJA** (`MarketBracket`, §Enums), independiente de la curva **a propósito**: si se derivara de
    los puntos vigentes, la serie histórica dejaría de ser comparable cada vez que el dueño moviera la curva — que es
    justo lo que se quiere medir. Fila `bracket: null` = operaciones **sin mercado** (override/bounty sin referencia).
  - `marketMxnCents` = suma del **mercado crudo** de esas operaciones (se persiste SIEMPRE, junto al bracket: el
    bracket es un índice, el dato real es el monto). `byBasis` = conteo por `priceBasis`.
  - **v2.0 recolecta; NO calibra.** El ajuste automático de la curva está **fuera de alcance** (§N.10): el dueño mueve
    los puntos a mano con este dato en la pantalla.
- **RETIRADOS por la curva (v2.0):**
  - `GET`/`PUT /api/v1/admin/pricing/tiers` y `GET`/`PUT /api/v1/admin/pricing/tier-map` — **ya no existen**. El eje
    rareza **no se edita**: salió del pricing.
  - `GET /api/v1/admin/pricing/buylist-rules` y `GET /api/v1/admin/pricing/sales-rules` — **ya no existen** (sus `PUT`
    estaban retirados desde v1.37). No hay `PriceRuleSet` que leer.
  - `GET /api/v1/admin/pricing/sales-rarities` — **ya no existe** (era el espejo de venta del editor por rareza).
  - Filas `ConfigSetting` con key `sales_price_rules`, `sales_price_fallback_pct`, `buylist_price_rules`,
    `buylist_price_fallback_pct` y `pricing_tier_map` quedan **huérfanas e inertes** (nadie las lee); **no se borran en
    la migración a propósito** — conservarlas mantiene barato el diagnóstico y el rollback. Mismo precedente que
    `rarity_map` (v1.32).
- **`GET /api/v1/admin/pricing/rarities` — SOBREVIVE, RE-PROPOSITADO** (es lo único que queda del editor viejo). Deja
  de ser un editor de precios y pasa a ser la **salud del catálogo de rarezas que respalda el guardarraíl**: qué
  rarezas existen, cuáles son `premium` y cuántas cartas hay de cada una.
  Res `200`: `{ "rarities": [ { "canonical": "Illustration Rare", "raw": "Illustration Rare", "premium": true,
  "mapped": true, "cardCount": 87 } ] }` — **se retiran** `rule`, `tierId`, `source` y `fallbackPct` (ya no hay
  reglas). `rarity` (alias deprecado de `canonical`) se retira también. Ordenado por `cardCount` desc.

#### Pricing por TIERS (v1.37) — ⛔ **RETIRADO por la curva (v2.0, P-48); ver «Curva de precio por VALOR DE MERCADO» arriba**
> ⛔ **RETIRADO.** PROJECT §M quedó superseded por §N v2.0. Los endpoints `/tiers` y `/tier-map` **ya no existen** y la
> taxonomía de 5 tiers se retira del código (`common/pricing-tiers.ts`). Se conserva abajo como registro de
> procedencia. **No implementar nada de aquí.**
> **P-34, PROJECT §M v1.9 LOCKED, ARCHITECTURE §4.33.** El editor pasa de «una fila por CADA rareza canónica» (~30) a
> «una fila por `tier`» (**5 tiers T0–T4**) + un **mapa rareza canónica → tier** compartido por compra y venta. La
> naturaleza de la regla (`fixed` MX$ centavos / `pct`), la precedencia money-safe y el **eje `finish`** (`finishRules`)
> **no cambian**: los tiers solo re-expresan el **eje rareza** de `PriceRuleSet` (§4.28d). Toda edición se **audita**
> (M10) y **surte efecto sin redeploy**. `Rule = { mode:'fixed'|'pct', value:number }` (buy `pct`=% de la referencia;
> sell `pct`=markup arriba de mercado, §4.14b).

- `GET /api/v1/admin/pricing/tiers` — **(NUEVO)** lee los 5 tiers (regla de COMPRA y VENTA), el eje acabado y los
  fallbacks. Read-only.
  Res `200`:
  ```json
  { "tiers": [
      { "id":"T0", "name":"Bulk",               "premium":false, "buy":{"mode":"fixed","value":50},  "sell":{"mode":"fixed","value":500},  "rarityCount":1 },
      { "id":"T1", "name":"Uncommon / Reverse",  "premium":false, "buy":{"mode":"fixed","value":150}, "sell":{"mode":"fixed","value":1000}, "rarityCount":3 },
      { "id":"T2", "name":"Rare / Holo",         "premium":false, "buy":{"mode":"pct","value":25},    "sell":{"mode":"pct","value":15},     "rarityCount":2 },
      { "id":"T3", "name":"Premium / Chase",     "premium":true,  "buy":{"mode":"pct","value":40},    "sell":{"mode":"pct","value":15},     "rarityCount":19 },
      { "id":"T4", "name":"Ultra / Grail",       "premium":true,  "buy":{"mode":"pct","value":40},    "sell":{"mode":"pct","value":15},     "rarityCount":4 }
    ],
    "finishRules": { "buy":  { "reverse_holo":{"mode":"fixed","value":150} },
                     "sell": { "holofoil":{"mode":"fixed","value":1000}, "reverse_holo":{"mode":"fixed","value":1000} } },
    "fallbackPct": { "buy": 40, "sell": 15 } }
  ```
  - `id`/`name`/`premium` = taxonomía **LOCKED** (`common/pricing-tiers.ts`); NO editables. `rarityCount` = nº de
    rarezas canónicas mapeadas a ese tier (informativo). `finishRules` keyeadas por el enum `Finish` (§4.28d), eje
    ACABADO **sin cambio**; `buy`/`sell` separan los dos juegos de valores. Valores de venta = reproducen el markup
    vigente (backend confirma los pisos exactos de T0/T1, ARCHITECTURE §4.33e).
- `PUT /api/v1/admin/pricing/tiers` — **(NUEVO)** reemplaza los VALORES de las 5 reglas (buy y sell), el eje acabado y
  los fallbacks.
  Req: `{ tiers: [{ id: TierId, buy: Rule, sell: Rule }], finishRules?: { buy?, sell? }, fallbackPct?: { buy?, sell? } }`.
  - **`name`/`premium` se ignoran** si vienen (taxonomía LOCKED). Deben venir las 5 filas (`T0..T4`).
  - **Validación:** `mode ∈ {fixed, pct}`; `fixed` → `value` **entero ≥ 0** (centavos); buy `pct` → `value` en `[0,100]`;
    sell `pct` → `value` en `[0,1000]` (markup, puede >100%, `SALES_PCT_MAX`); `fallbackPct` en su rango respectivo.
  - **Invariante de refinamiento (money-safe, §4.33d):** se valida contra el **mapa vigente**. Poner la regla de
    **COMPRA** de un tier en `fixed` cuando ese tier tiene alguna rareza `premium:true` mapeada ⇒ **rechazo**. (El eje
    de VENTA no entra al invariante: un `fixed` de venta es un piso, no un bin de compra.)
  - Res `200`: mismo shape que el `GET`. **Auditado** (`AuditLog action=pricing.tiers.update`, before/after). **Sin
    redeploy.** Cambiar la regla de un tier **repricia todas** las rarezas mapeadas a él (criterio 74).
  - Err `422 VALIDATION_ERROR` (modo/valor/rango/filas); `422 PREMIUM_RARITY_FIXED_TIER` (una rareza premium quedaría en
    un tier de compra `fixed`; el body lista los pares `(rarity, tierId)` infractores).
- `GET /api/v1/admin/pricing/tier-map` — **(NUEVO)** el **mapa rareza canónica → tier**, unido al catálogo canónico
  (§4.28c) para poblar el editor de asignación. Muestra rarezas mapeadas y rarezas del catálogo aún sin mapear.
  Res `200`:
  ```json
  { "tiers": [ { "id":"T0","name":"Bulk","premium":false }, { "id":"T4","name":"Ultra / Grail","premium":true } ],
    "rarities": [
      { "canonical":"Common",            "premium":false, "mapped":true, "cardCount":5326, "tierId":"T0", "source":"map" },
      { "canonical":"Rare Holo",         "premium":false, "mapped":true, "cardCount":1617, "tierId":"T2", "source":"map" },
      { "canonical":"Illustration Rare", "premium":true,  "mapped":true, "cardCount":87,   "tierId":"T3", "source":"map" },
      { "canonical":"Some New Rarity",   "premium":true,  "mapped":false,"cardCount":3,    "tierId":null, "source":"fallback" }
    ] }
  ```
  - `premium` = del catálogo canónico (§4.28e, DATO). `mapped=false` = rareza `unmapped` (sin entrada en el catálogo
    canónico). `tierId:null` + `source:"fallback"` = rareza del catálogo **sin entrada en `PRICING_TIER_MAP`** ⇒ cotiza
    por el **tier por defecto = `pct` de fallback** (money-safe, nunca $0/bin fijo). Ordenado por `cardCount` desc.
- `PUT /api/v1/admin/pricing/tier-map` — **(NUEVO)** reasigna rarezas a tiers (Opción B, editable por el dueño).
  Req: `{ assignments: { [canonical: string]: TierId } }` (patch **parcial**: solo las rarezas a cambiar).
  - **Validación:** `TierId ∈ {T0,T1,T2,T3,T4}` (`422 VALIDATION_ERROR`). Cada `canonical` debe ser una key canónica del
    catálogo (§4.28); una key desconocida ⇒ `422 UNKNOWN_RARITY`.
  - **Invariante de refinamiento (money-safe, §4.33d):** una rareza con `premium:true` no puede asignarse a un tier cuya
    regla de **COMPRA** sea `fixed` (con el seed: no puede caer en T0/T1) ⇒ **rechazo** con los pares infractores.
  - Res `200`: mismo shape que `GET /admin/pricing/tier-map`. **Auditado** (`AuditLog action=pricing.tier_map.update`,
    before/after). **Sin redeploy.** Err `422 VALIDATION_ERROR`, `422 UNKNOWN_RARITY`, `422 PREMIUM_RARITY_FIXED_TIER`.
- **SUPERSEDED por los tiers:** `GET/PUT /api/v1/admin/pricing/buylist-rules` y `/sales-rules` (mapa plano rareza→regla,
  §4.28d). Los **`PUT` se retiran** (el eje rareza ya no se edita por rareza suelta, sino por tier). Los **`GET` pueden
  conservarse** como lectura del `PriceRuleSet` **efectivo** derivado de `tiers × tier-map` (§4.33c) durante la
  transición, o retirarse. `GET /admin/pricing/rarities` (+ `/sales-rarities`) **se conservan** y ganan `tierId` +
  `source:'map'|'fallback'`; su `rule` refleja la regla **RESUELTA vía tier** (retrocompatible). El editor nuevo consume
  `/tiers` + `/tier-map`.

#### Precio de buylist por RAREZA (v1.3.1) — ⛔ **RETIRADO por la CURVA (v2.0, P-48)**
> ⛔ **RETIRADO (v2.0).** Los endpoints `GET /admin/pricing/buylist-rules` y `GET /admin/pricing/rarities` con
> `rule`/`fallbackPct` **ya no existen en esa forma**: la compra sale de la **curva**
> (`GET/PUT /admin/pricing/curve`, arriba) y `/rarities` sobrevive **re-propositado** como salud del catálogo de
> rarezas (sin reglas). Registro histórico; **no implementar nada de aquí.**
> **DEPRECADO (v1.37):** superseded por el editor por `tier` (arriba). Se conserva para procedencia. Reemplazó
> `rarity-map`. Una fila por rareza oficial con regla **`fixed` (MX$ centavos)** o **`pct` (% de la
> referencia)** + un **fallback %** para rarezas sin regla. Toda edición se **audita** (M10). Ver ARCHITECTURE §4.2.

- `GET /api/v1/admin/pricing/rarities` — **(NUEVO)** lista las **rarezas CANÓNICAS del catálogo sincronizado**
  **unidas** a las reglas configuradas, para poblar el editor. Devuelve tanto rarezas con regla explícita como
  rarezas del catálogo aún sin regla (que muestran el fallback).
  > **v1.29 (ARCHITECTURE §4.28):** agrupa por **`Card.rarityCanonical`** (no por `Card.rarity` crudo) ⇒ la lista que
  > el admin edita empata **1:1** con la forma canónica que produce el ingest. Cada entrada añade `raw?` (una forma
  > cruda observada, para diagnóstico), `canonical` (la key editable), `premium` (del catálogo canónico, §4.28e) y
  > `mapped` (`false` = rareza `unmapped` aún sin entrada en el catálogo canónico → cae al fallback pct de forma
  > predecible; visible para que el admin la resuelva). El campo `rarity` se conserva como ALIAS de `canonical`
  > (compat) y queda DEPRECADO.
  Res `200`:
  ```json
  { "fallbackPct": 40,
    "rarities": [
      { "canonical": "Common",           "raw": "Common",           "premium": false, "mapped": true,  "cardCount": 1234, "rule": { "mode": "fixed", "value": 50 }, "source": "rule" },
      { "canonical": "Illustration Rare", "raw": "Illustration Rare", "premium": true,  "mapped": true,  "cardCount": 87,   "rule": { "mode": "pct",   "value": 40 }, "source": "fallback" }
    ] }
  ```
  - `cardCount` = nº de cartas del catálogo con esa rareza canónica. `source="rule"` si hay fila explícita en
    `rarityRules`; `source="fallback"` si la rareza existe en el catálogo pero aún no tiene regla (muestra
    `{ mode:"pct", value: fallbackPct }`). Ordenado por `cardCount` desc (rarezas más frecuentes primero).
  - **Reglas en DOS ejes (v1.29, §4.28d):** las reglas dejan de ser un mapa plano que mezcla rareza y acabado. Pasan a
    `PriceRuleSet { rarityRules: { [canonicalRarity]: Rule }, finishRules: { [finish]: Rule }, fallbackPct }`. El eje
    `finishRules` (keyeado por el enum `Finish`: `reverse_holo`, `holofoil`, `first_edition_holofoil`) **reemplaza** las
    keys sintéticas `Holo`/`Reverse Holo` del mapa plano y **retira el parche INV-1 del front**. La precedencia de
    resolución (finish-rule vs rarity-rule vs fallback) conserva la semántica de negocio vigente. Money-safe: rareza sin
    regla → fallback pct predecible y auditable, nunca 0.
- `GET /api/v1/admin/pricing/buylist-rules` — **(NUEVO)** lee la tabla cruda + fallback.
  Res `200`: `{ rules: { [rarity: string]: BuylistRule }, fallbackPct: number }`
  (ej. `{ "rules": { "Common": { "mode":"fixed","value":50 }, "Reverse Holo": { "mode":"fixed","value":150 } }, "fallbackPct": 40 }`).
- `PUT /api/v1/admin/pricing/buylist-rules` — **(NUEVO)** reemplaza la tabla y/o el fallback.
  Req: `{ rules: { [rarity: string]: BuylistRule }, fallbackPct?: number }`
  - **Validación:** `mode ∈ {fixed, pct}`; si `fixed` → `value` **entero ≥ 0** (centavos); si `pct` → `value`
    **número en `[0, 100]`**; `fallbackPct` **número en `[0, 100]`**. `rules` debe ser objeto (no array).
  - Res `200`: mismo shape que el `GET`. **Auditado** (`AuditLog action=pricing.buylist_rules.update`, con
    `before`/`after`). **Surte efecto sin redeploy** (criterio 12b). Err `422 VALIDATION_ERROR` (modo/valor/rango inválidos).
  > **v1.29 (§4.28d) — dos ejes:** `buylist-rules` (y su análogo de ventas) evolucionan de `{ rules, fallbackPct }`
  > (mapa plano rareza∪acabado) a `PriceRuleSet { rarityRules, finishRules, fallbackPct }`. `rarityRules` keyeadas por
  > **rareza canónica**; `finishRules` keyeadas por el enum **`Finish`**. El seed migra las keys `Holo`/`Reverse Holo`
  > a `finishRules[holofoil]`/`finishRules[reverse_holo]` y canonicaliza las demás; reproduce EXACTAMENTE el negocio
  > vigente. La validación de `Rule` (`mode ∈ {fixed,pct}`, rangos) no cambia. **Auditado**, sin redeploy.
- **RETIRADOS (v1.32; deprecados desde v1.3.1):** `GET/PUT /api/v1/admin/pricing/rarity-map` **ya no existen** — el
  código los **retiró** junto con el setting `RARITY_MAP` (backend, rama `fix/variant-composition-regression`,
  `BACKEND_NOTES.md` §0-quater). Fueron **reemplazados** por `BUYLIST_PRICE_RULES` / `SALES_PRICE_RULES` (reglas en dos
  ejes §4.28d) + el **catálogo canónico de rarezas** (§4.28c, normalizador `rawRarity→canonical`) y su endpoint de
  lectura `GET /admin/pricing/rarities` (+ `sales-rarities`). El editor nuevo consume `rarities` + `buylist-rules`.
  Filas `ConfigSetting key='rarity_map'` que existan en BD quedan huérfanas e inertes (nadie las lee); no requieren
  migración y los deploys nuevos ya no las siembran.

#### Precio de VENTA por RAREZA (v1.13-sales-pricing) — ⛔ **RETIRADO por la CURVA (v2.0, P-48)**
> ⛔ **RETIRADO (v2.0).** `GET /admin/pricing/sales-rules` y `GET /admin/pricing/sales-rarities` **ya no existen**.
> **Aquí vivía la causa raíz del bug P-48**: la regla `fixed` se documenta y etiqueta como **«Piso (MX$)»** pero se
> implementa como **precio absoluto** (nunca se compara contra el mercado) — por eso una carta con mercado de $400 se
> publicaba en $15 y una barata en $1.31. En la curva el `max` hace que el **piso sea piso de verdad** y el modo
> `fixed` **desaparece**. Registro histórico; **no implementar nada de aquí.**
> **Análogo al de buylist** (arriba), pero para el **precio de VENTA** (lo que se cobra en Compra/checkout).
> Reemplaza el markup GLOBAL único (`salesMarkupPct`, §M10, ahora **DEPRECADO**). Una fila por rareza con regla
> **`fixed` (piso MX$ centavos)** o **`pct` (% ARRIBA de mercado)** + un **fallback %** para rarezas sin regla.
> **Semántica de `pct`:** `salePriceCents = round(referencia × (1 + value/100))` (markup sobre mercado — NO "% de la
> referencia" como en buylist). Toda edición se **audita** (M10). Ver ARCHITECTURE §4.14.

- `GET /api/v1/admin/pricing/sales-rarities` — **(NUEVO)** lista las **rarezas distintas del catálogo sincronizado**
  (`distinct Card.rarity`) **unidas** a las reglas de venta configuradas, para poblar el editor. Devuelve tanto
  rarezas con regla explícita como rarezas del catálogo aún sin regla (que muestran el fallback).
  Res `200`:
  ```json
  { "fallbackPct": 15,
    "rarities": [
      { "rarity": "Common",            "cardCount": 1234, "rule": { "mode": "fixed", "value": 500  }, "source": "rule" },
      { "rarity": "Uncommon",          "cardCount": 980,  "rule": { "mode": "fixed", "value": 1000 }, "source": "rule" },
      { "rarity": "Illustration Rare", "cardCount": 87,   "rule": { "mode": "pct",   "value": 15   }, "source": "fallback" }
    ] }
  ```
  - `cardCount` = nº de cartas del catálogo con esa rareza. `source="rule"` si hay fila explícita en
    `SALES_PRICE_RULES`; `source="fallback"` si la rareza existe en el catálogo pero aún no tiene regla (muestra
    `{ mode:"pct", value: fallbackPct }`). Ordenado por `cardCount` desc.
- `GET /api/v1/admin/pricing/sales-rules` — **(NUEVO)** lee la tabla cruda + fallback.
  Res `200`: `{ rules: { [rarity: string]: SalesRule }, fallbackPct: number }`
  (ej. `{ "rules": { "Common": { "mode":"fixed","value":500 }, "Reverse Holo": { "mode":"fixed","value":1000 } }, "fallbackPct": 15 }`).
  - **Claves sintéticas de acabado:** además de rarezas, la tabla admite las claves `"Reverse Holo"` y `"Holo"`
    (que el resolver por acabado, ARCHITECTURE §4.2.1/§4.14b, usa para los finish `reverse_holo`/`holofoil` de bulk).
- `PUT /api/v1/admin/pricing/sales-rules` — **(NUEVO)** reemplaza la tabla y/o el fallback.
  Req: `{ rules: { [rarity: string]: SalesRule }, fallbackPct?: number }`
  - **Validación:** `mode ∈ {fixed, pct}`; si `fixed` → `value` **entero ≥ 0** (centavos); si `pct` → `value`
    **número en `[0, 1000]`** (markup arriba de mercado, puede >100% a diferencia del pct de buylist; tope propuesto
    `SALES_PCT_MAX=1000`, ver ARCHITECTURE decisión abierta v1.13-2); `fallbackPct` en el mismo rango. `rules` debe
    ser objeto (no array).
  - Res `200`: mismo shape que el `GET`. **Auditado** (`AuditLog action=pricing.sales_rules.update`, con
    `before`/`after`). **Surte efecto sin redeploy.** Err `422 VALIDATION_ERROR` (modo/valor/rango inválidos).

#### Sync de catálogo desde pokemontcg.io (`super_admin`, auditado) — v1.1
Ingesta de datos de catálogo (Card/CardSet en inglés). Ver ARCHITECTURE §4.8. Todas quedan en `AuditLog`.
- `GET /api/v1/admin/catalog/remote-sets` — consulta `/v2/sets` remoto.
  Res `200`: `{ data: [{ id, name, series, releaseDate, printedTotal, imported: boolean, cardCount: number }] }` ordenado por `releaseDate` **desc**. `imported` = si el `CardSet` ya existe local; `cardCount` = cartas locales del set.
- `POST /api/v1/admin/catalog/sync` — importa/actualiza cartas.
  Req: `{ setId?: string, fromReleaseDate?: string, force?: boolean = false }`.
  - `setId` (opcional) → importa ese set puntual. **Debe cumplir `^[a-z0-9]+(-[a-z0-9]+)*$`** (anti-inyección en `q=set.id:`); si no, `422 VALIDATION_ERROR`.
  - sin `setId` → importa sets con `releaseDate >= fromReleaseDate`. **Default `fromReleaseDate` = dial `catalog_sync_from_date` (`"2024/01/01"`)**, editable sin redeploy vía `GET/PUT /admin/settings` (`catalogSyncFromDate`, §M10). Formato `yyyy/MM/dd`.
  - **`force` (v1.27 / P-12, opcional, default `false`, aditivo):** con `true`, para **cada set procesado por la
    llamada** se corre además el **resolver estructural TCGCSV** (`resolveStructuralFinishesForSet`, ARCHITECTURE
    §4.24a) aunque el set NO sea first-import — misma semántica que el `force` de `sync-all` (cierra la asimetría:
    antes el resolver solo corría en first-import o en `sync-all {force:true}`, y el botón por set NUNCA refrescaba
    variantes). El resolver sigue siendo **best-effort** (si TCGCSV falla se loguea y NO aborta el import,
    money-safe). Uso recomendado: **por set** (`{setId, force:true}`); con modo `from_date` también se honra, pero
    ojo al volumen (un fetch TCGCSV por set del rango). Retrocompatible: omitir `force` deja el comportamiento
    EXACTO de hoy. Auditado con `force` en el detalle.
  - **⚠️ Este endpoint NO toca precios** (desde v1.14 / WS-A §4.15g el pricing vive SOLO en `price-ingest`).
    **Flujo recomendado del admin para «sincronizar un set completo» (v1.27):** (1) `POST /admin/catalog/sync
    { setId, force: true }` → metadata + todas las cartas + variantes estructurales TCGCSV del set; (2) `POST
    /admin/jobs/price-ingest { setId }` (§M10-ops, ya existente) → precios del set **completo** (el sync manual por
    set hace bypass del scope de sets <2020 de `ppt-sync-scope`). El frontend encadena ambos desde la acción por
    fila de M2; el copy NO debe decir que el sync de cartas «repuebla precios».
  Res `202`: `{ jobId, setsQueued: number, mode: "single" | "from_date" }` (shape sin cambios).
- `POST /api/v1/admin/catalog/backfill` — importa el **siguiente lote de sets más antiguos aún no importados** (colecciones previas a la frontera). Repetible.
  Req: `{ batchSize?: number = 10, untilYear?: number }`.
  Res `200`: `{ imported: [{ id, name, releaseDate, cardCount }], newBoundary: string, remaining: number }`. `newBoundary` = `releaseDate` del set más antiguo ya importado tras el lote; `remaining` = sets aún sin importar. Se repite hasta `remaining=0` (o hasta `untilYear`).
- `POST /api/v1/admin/catalog/sync-all` — **(v1.3, NUEVO)** importa **TODO el catálogo** (todos los sets remotos, sin frontera de fecha) — soporte de la **Opción 1** del cotizador (poder cotizar cualquier carta). **Truly-async**: encola los sets en la cola BullMQ y **retorna de inmediato** (no importa en el request, a diferencia del `sync` from-date actual — ver Desviación DEV-1 en ARCHITECTURE §9). **Admin-only** (`super_admin`).
  Req: `{ force?: boolean = false }` (sin otros campos; ignora `catalog_sync_from_date`).
    - **`force` (v1.6-finish, opcional, default `false`, admin-only):** controla si se reprocesan los sets **ya importados**.
      - `false` (default): **comportamiento actual** — se **saltan** los sets ya importados; solo se encolan los sets remotos aún no presentes.
      - `true`: **no filtra** por sets ya importados — se encolan **TODOS** los sets (incluidos los ya importados) para **repoblar** `Card.availableFinishes` ~~y los precios por acabado~~ tras la **migración M-18** (v1.6-finish). Usar tras el deploy que requiere RE-SYNC (ver Changelog v1.6-finish, criterio 24). **⛔ Corrección v1.27:** desde v1.14 (WS-A §4.15g) este endpoint **NO repuebla precios** — solo metadata, cartas y (con `force`) variantes estructurales TCGCSV + reconcile; los precios se ingieren únicamente vía `price-ingest` (§M10-ops).
    - **Retrocompatible:** omitir `force` (o enviar `false`) preserva el contrato y la semántica previos; ningún consumidor existente se rompe. El campo es aditivo y opcional.
  Res `202`: `{ jobId: string, setsQueued: number, remaining: number }` (`setsQueued` = sets encolados en esta llamada; `remaining` = sets remotos aún no importados tras encolar; con `force=true`, `remaining` puede ser `0` aunque se hayan encolado todos los sets). Idempotente: los sets ya importados se re-upsertean sin duplicar. Auditado (`action: catalog.sync_all`, con `force` registrado en el detalle).
  > **Alternativa sin endpoint nuevo:** el mismo resultado se logra con `POST /admin/catalog/sync` pasando un `fromReleaseDate` muy antiguo (p. ej. `"1998/01/01"`) **más** `POST /admin/catalog/backfill` repetido hasta `remaining=0`. `sync-all` existe para hacerlo explícito y **seguro contra timeouts** en catálogos grandes. Backend decide si `sync-all` es un wrapper que encola lo mismo que `backfill` en lote completo.
  > **Uso en Fase 1 (v1.12-catalog-pricing, ARCHITECTURE §4.13):** este endpoint **cubre 1.3 y 1.4 sin variantes nuevas** — (1.4, frontend) botón **"Importar sets nuevos"** en M2 = `sync-all {force:false}` (solo sets no importados) + polling `sync-status` + refrescar `remote-sets`; (1.3, disparo manual del refresco de precios) = `sync-all {force:true}` (re-sync completo que repuebla `PriceReference` por acabado). El job automático `catalog-price-sync` 2×/día ejecuta internamente la misma lógica de `force:true`.
  > **⛔ Corrección v1.27 al párrafo anterior (la mitad 1.3 quedó STALE desde v1.14/WS-A §4.15g):** `sync-all` **ya NO
  > repuebla `PriceReference`** — el refresco de precios es EXCLUSIVO de `price-ingest` (§M10-ops; global o `{setId}`).
  > `sync-all {force:true}` hoy sirve para: re-upsert de metadata/cartas + **reparación estructural de variantes**
  > (resolver TCGCSV + reconcile, §4.24a/§4.25a) — es el paso de despliegue del re-sync forzado post-P-13. La mitad
  > 1.4 ("Importar sets nuevos") sigue vigente tal cual. El copy de frontend en M2 debe reflejarlo (`es.json` decía
  > "repuebla precios": mentira desde v1.14; corregir en este stream).
- `GET /api/v1/admin/catalog/sync-status` — **(v1.10-sync-status, NUEVO)** devuelve el **progreso** del barrido `sync-all` **en curso** (o del **último** ejecutado) → permite a M2 **pollear** (cada ~3s mientras `running`) y saber **cuándo** terminó (antes `sync-all` era fire-and-forget "a ciegas"). **Read-only**, **NO auditado** (es de polling), **NO llama a pokemontcg.io** (lee estado **en memoria del proceso**; **no** consume rate-limit ni la cola BullMQ). **Admin-only** (`super_admin`, hereda de `@Roles(Role.super_admin)` del controller). El shape corresponde **exactamente** a `CatalogSyncStatusResponse` (`frontend/src/types/contract.ts`).
  Res `200` (`CatalogSyncStatusResponse`):
  ```json
  {
    "running": true,
    "jobId": "catalog-sync-all-1734400000000",
    "total": 168,
    "done": 42,
    "startedAt": "2026-08-17T18:00:00.000Z",
    "finishedAt": null
  }
  ```
    - **`running: boolean`** — hay un barrido **activo**.
    - **`jobId: string | null`** — id del barrido **actual/último** (formato `catalog-sync-all-<epoch>`); `null` si nunca se ha corrido un `sync-all` desde el arranque del proceso.
    - **`total: number`** — sets **encolados** en el barrido actual/último.
    - **`done: number`** — sets ya **procesados** (éxito **o** fallo). La barra de progreso es `done/total`.
    - **`startedAt: string | null`** — ISO-8601; cuándo arrancó el barrido actual/último.
    - **`finishedAt: string | null`** — ISO-8601; se **setea al terminar** (cuando `running` pasa a `false`). `null` mientras `running` o antes del primer barrido.
  > **Límite conocido (DEV-1):** el estado vive **en memoria del proceso** (**no persistido**). Si el proceso se **reinicia** a mitad del barrido, el estado se **pierde** (vuelve a `running:false`, `jobId:null`) y hay que **re-llamar** `sync-all`. Ligado al cableado pendiente de BullMQ — ver Desviación **DEV-1** en ARCHITECTURE §9.
#### Reparación de variantes + precios solo-TCGCSV (v1.31 — NUEVO, `super_admin`) — backfill del `normal` fantasma sin pokemontcg.io
> **Contexto (ARCHITECTURE §4.27–§4.30).** TCGCSV es la fuente de **estructura + precio** de las variantes (finishes)
> por `productId` exacto. El `sync {setId, force:true}` **encadena** re-fetch de metadata desde **pokemontcg.io** con
> el resolver estructural TCGCSV; durante un outage de pokemontcg.io (502) ese encadenamiento **bloquea** arreglar la
> composición de un set que YA está importado (el `normal` fantasma pre-M-31). Esta familia **desacopla** el refresco
> de variantes/precios (TCGCSV) del re-fetch de cartas: opera **solo** sobre las `Card` ya en BD y **NUNCA** llama a
> pokemontcg.io — ni siquiera para listar sets (la lista sale de BD local). Es la operación de **backfill/reparación**.
> **Money-safe (transversal):** el resolver hace TODO el fetch TCGCSV **antes** de escribir; un fallo remoto no borra
> ni escribe nada. Toda variante (producto×acabado) **sin precio de mercado** ⇒ `pending`/«—» (`null`), **jamás 0**.

- `POST /api/v1/admin/catalog/refresh-variants` — **(M-34)** refresca **variantes (finishes) + precios** de UN set
  **ya importado**, usando **SOLO TCGCSV** (no toca pokemontcg.io). Hermano acotado de `sync {setId, force:true}` que
  omite la fase pokemontcg.io. **Auditado** (`AuditLog action=catalog.refresh_variants`, `entityType=CardSet`, con los
  contadores + `force`).
  Req: `{ setId: string, force?: boolean = false }`.
  - **`setId` (REQUERIDO):** **`externalId`** del set (id de pokemontcg.io, p. ej. `"me05"`). **Debe cumplir
    `^[a-z0-9]+(-[a-z0-9]+)*$`** (mismo `SET_ID_PATTERN` que `sync`); si no, `422 VALIDATION_ERROR` **antes** de tocar
    BD/red.
  - **`force` (opcional, default `false`):** aceptado por **simetría** con `sync`/`sync-all` y para el mismo botón del
    front; hoy **no altera** el comportamiento (este camino ES, por definición, un refresco forzado: **siempre**
    re-resuelve por completo, no hay gate de first-import). Queda registrado en auditoría; reservado para un futuro modo
    "solo si stale".
  - Res `200`: `{ ok: boolean, setId: string, cardsProcessed: number, cardProductsUpserted: number, pricesUpserted:
    number, pending: number, tcgcsvReachable: boolean }`.
    - **`cardsProcessed`** — # de `Card` locales del set (universo procesado).
    - **`cardProductsUpserted`** — `CardProduct` upserteados (unidos por `productId` **exacto** — jamás por número, así
      el `normal` fantasma es imposible).
    - **`pricesUpserted`** — `PriceReference` (`source=tcgcsv_singles`) escritos (`marketPrice > 0`).
    - **`pending`** — variantes (producto×acabado) **sin** precio ⇒ «—»/`PRICE_PENDING` (**jamás 0**).
    - **`tcgcsvReachable`** — si la fuente respondió en esta corrida.
  - Err:
    - `422 VALIDATION_ERROR` — `setId` con formato inválido (no calza `SET_ID_PATTERN`).
    - `409 SET_NOT_IMPORTED` — el set no existe en BD, o existe **sin cartas**. **No** se intenta importar (mensaje:
      "impórtalo primero con `POST /admin/catalog/sync`"). Ver §Errores (por qué **409 y no 404**).
    - `502 UPSTREAM_ERROR` — TCGCSV no responde (401/403/5xx/red/parse). **Money-safe:** el fetch ocurre íntegro antes
      de escribir, así que un fallo remoto no muta nada local.
  - **Blindaje (test):** `backend/test/catalog-refresh-variants.spec.ts` espía **todos** los métodos de
    `PokemonTcgIoClient` y verifica en cada caso que **no se invocan**.
- `POST /api/v1/admin/catalog/refresh-variants-all` — **(M-35)** versión **BATCH** del anterior: corre el **mismo**
  refresh solo-TCGCSV sobre **TODOS los sets importados** (universo = `CardSet` de **BD local** con `cards > 0`; **no**
  sale de pokemontcg.io ni de TCGCSV). **Truly-async / fire-and-forget** (mismo patrón que `sync-all`): encola y
  **retorna de inmediato** (`202`). **Respetuoso con TCGCSV** (delay entre sets, env
  `CATALOG_REFRESH_VARIANTS_BATCH_DELAY_MS`, default 250ms) y **resiliente por-set** (el fallo de un set —502, grupo no
  espejado, `SET_NOT_IMPORTED` por carrera— **NO aborta** el barrido: se acumula en `summary.failures`). **Auditado**
  (`AuditLog action=catalog.refresh_variants_all`, `entityType=CardSet`, con `jobId/setsQueued/remaining/force`).
  Req: `{ force?: boolean = false }` (también acepta `?force=true` por query, igual que `sync-all`/`backfill`). Semántica
  de `force` idéntica a la del por-set (aceptado por simetría; hoy no altera el comportamiento).
  Res `202`: `{ jobId: string, setsQueued: number, remaining: number }`.
    - **`jobId`** — formato `catalog-refresh-variants-all-<epoch>`.
    - **`setsQueued`** — # de sets importados (`cards > 0`) encolados en este barrido.
    - **`remaining`** — `0` cuando se encolan todos; `>0` solo si **ya había un barrido en curso** (single-flight →
      `setsQueued:0`, `remaining=<pendientes>`). El single-flight es **independiente** del de `sync-all` (estados
      separados; pueden solaparse, pues este solo toca TCGCSV).
- `GET /api/v1/admin/catalog/refresh-variants-status` — **(M-35)** progreso + **resumen agregado** del batch, para
  **polling/keep-alive** del front (hermano de `sync-status`). **Read-only**, **NO auditado**, **NO** llama a ningún
  upstream (lee estado **en memoria del proceso**). `@Roles(super_admin)`.
  Res `200`:
  ```jsonc
  {
    "running": false,          // true mientras el barrido corre; single-flight contra sí mismo
    "jobId": "catalog-refresh-variants-all-1690000000000",
    "total": 37,               // sets a procesar (barra honesta done/total en SETS)
    "done": 37,                // sets INTENTADOS (éxito o fallo)
    "startedAt": "2026-08-22T18:00:00.000Z",
    "finishedAt": "2026-08-22T18:04:00.000Z",  // null mientras running=true; se fija al terminar
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
    - **`running: boolean`** — hay un barrido activo.
    - **`jobId: string | null`** — id del barrido actual/último (`catalog-refresh-variants-all-<epoch>`); `null` si nunca
      corrió desde el arranque del proceso.
    - **`total: number`** — sets a procesar; **`done: number`** — sets ya intentados (éxito **o** fallo). Barra = `done/total`.
    - **`startedAt` / `finishedAt`** — ISO-8601; `finishedAt` se fija al terminar (`null` mientras `running`).
    - **`summary`** — **`null`** hasta que termine el **primer** batch; luego el objeto agregado de arriba.
      `failures[].code` es el `code` de la `BusinessException` por-set (típicamente `UPSTREAM_ERROR` o
      `SET_NOT_IMPORTED`) — en el batch **no** se propagan como HTTP.
  > **Uso en el front (mismo patrón que `sync-all`):** dispara el `POST` (`202`), luego pollea
  > `refresh-variants-status` con keep-alive hasta `running=false` y lee el `summary` para el veredicto.
  > **Límite conocido (DEV-1):** el estado vive **en memoria del proceso** (no persistido). Si el proceso se reinicia a
  > mitad del barrido, el estado se **pierde** (vuelve a `running:false`) y hay que re-llamar. Mismo límite que
  > `sync-status` — ver Desviación **DEV-1** en ARCHITECTURE §9.

#### Backfill LOCAL de `rarityCanonical` (v1.32 — NUEVO, `super_admin`) — normaliza rarezas sin upstream, money-safe
> **Contexto (ARCHITECTURE §4.28 — catálogo canónico de rarezas).** La migración **M-31** sembró
> `Card.rarityCanonical = rarity` **CRUDO** (sin normalizar), de modo que el `groupBy(['rarityCanonical','rarity'])`
> que alimenta los editores de reglas (`GET /admin/pricing/rarities` y `/sales-rarities`) mostraba la **misma** rareza
> **fragmentada/duplicada** (`rare holo`, `Rare Holo`, `RARE HOLO` como filas separadas). Este endpoint es el
> **backfill idempotente** que reescribe `Card.rarityCanonical = normalizeRarity(rarity)` a partir de la columna
> **LOCAL** `rarity`. Hermano de la familia de reparación de arriba, pero **puramente local**: **NUNCA** llama a
> pokemontcg.io **ni** a TCGCSV. **El dinero no se toca** — el pricing ya re-normaliza la rareza al cotizar
> (`money.ts`); lo roto era **solo** la UX del agrupado en el editor.
> **Money-safe (garantía dura):** la **única** columna que escribe es `Card.rarityCanonical`. **NO** toca
> `PriceReference`, precios, `PendingPriceEntry` ni la composición de variantes/acabados; ningún monto cambia.

- `POST /api/v1/admin/catalog/unify-rarities` — **(M2, `super_admin`, síncrono `200`)** recorre TODAS las `Card` con
  `rarity != null` y reescribe `rarityCanonical = normalizeRarity(rarity)` (función **PURA** de
  `common/rarity-catalog.ts`, catálogo `CANONICAL_RARITIES`). **Síncrono e idempotente** (no fire-and-forget): emite
  **un `updateMany` por rareza cruda divergente** (no un UPDATE por carta); en la 2ª corrida no hay filas divergentes
  ⇒ **0 writes, 0 updates**. **Auditado** (`AuditLog action=catalog.unify_rarities`, `entityType='Card'`, con los
  contadores).
  Req: **sin body relevante** (sin parámetros).
  Res `200`:
  ```jsonc
  {
    "ok": true,
    "cardsProcessed": 12000,   // # de Card con rarity != null (universo recorrido)
    "cardsUpdated": 3400,      // # de Card cuyo rarityCanonical DIFERÍA y se corrigió (0 en 2ª corrida)
    "distinctCanonical": 21,   // # de rarezas canónicas DISTINTAS resultantes
    "unmapped": [              // rarezas cuya forma CRUDA no tiene entrada en CANONICAL_RARITIES
      { "raw": "Galaxy Foil", "canonical": "Galaxy Foil", "count": 40 }
    ]
  }
  ```
  - **`unmapped`** = rarezas crudas **sin** entrada en el catálogo canónico (`CANONICAL_RARITIES`); `canonical` es el
    pass-through Title-case. Sirve para que el operador sepa qué rarezas **añadir** a `rarity-catalog.ts` (§4.28). Es
    money-safe: una rareza sin entrada canónica **cae al fallback pct** (predecible y auditable, **nunca 0**), así que
    su ausencia no rompe precios — solo la deja fuera de las reglas explícitas hasta que se agregue.
  - Sin errores de negocio propios (no depende de fuentes externas). Guardas de rol/auth estándar (`super_admin`).
  - **Relación con la familia de arriba:** aquella (`refresh-variants*`) repara **variantes + precios** desde **TCGCSV**;
    esta repara **solo la rareza canónica** desde columna **LOCAL**. Ninguna llama a pokemontcg.io.

Notas de seguridad: **host fijo** de pokemontcg.io (sin SSRF); `POKEMONTCG_IO_API_KEY`; rate-limit vía cola BullMQ; `Card.rarity` se persiste como **String libre** (taxonomía abierta, captura rarezas modernas).

#### Referencia de mercado del SELLADO vía TCGCSV (v1.19-sealed-tcgcsv — NUEVO, `super_admin`)
> El sellado se sigue **vendiendo** con precio manual en MXN (PROJECT 3e, sin cambio). Esta familia da al admin un
> **valor de referencia informativo** desde **TCGCSV** (espejo diario de precios de TCGplayer, host fijo
> `https://tcgcsv.com`, sin API key) y la **curación manual** del mapeo item sellado ↔ `productId` de TCGplayer.
> El ingest lo corre el job `sealed-price-ingest` (§M10-ops) gateado por el dial `sealedPriceSource` (§M10, seed `off`);
> la **curación funciona aunque el dial esté `off`** (mapear no mueve precios). Ver ARCHITECTURE §4.19.

- `GET /api/v1/admin/pricing/sealed/unmapped` — **(NUEVO)** cola de curación: items `sealed` **sin mapeo**
  (consulta derivada `productType='sealed' AND tcgplayerProductId IS NULL`; no hay tabla/estado nuevo).
  Query `?page=1&pageSize=20`.
  Res `200`: `{ data: [{ inventoryItemId, folio, card: CardDTO, sealedSubtype?: SealedSubtype, listPriceCents?: number, createdAt }], page, pageSize, total }` (orden `createdAt` asc — lo más viejo primero).
- `GET /api/v1/admin/pricing/sealed/tcgcsv/groups` — **(NUEVO)** explorador de grupos TCGCSV (≈ sets/expansiones),
  **proxy read-only server-side** (el navegador nunca habla con tcgcsv.com; host fijo anti-SSRF, categoría Pokémon=3
  constante de servidor). Query `?q=` (filtro por nombre, opcional).
  Res `200`: `{ data: [{ groupId: number, name: string, abbreviation?: string, publishedOn?: string }] }`.
  Err `502 UPSTREAM_ERROR` (TCGCSV no responde/payload inválido; no afecta nada local).
- `GET /api/v1/admin/pricing/sealed/tcgcsv/groups/:groupId/products` — **(NUEVO)** productos **SELLADOS** del grupo
  (el proxy filtra los singles por heurística de `extendedData`; ARCHITECTURE §4.19b). `:groupId` debe ser **entero
  positivo** → si no, `400 VALIDATION_ERROR` (nunca se interpola un string del cliente en el path remoto).
  Query `?q=` (filtro por nombre, opcional).
  Res `200`: `{ data: [{ productId: number, name: string, cleanName?: string, imageUrl?: string }] }`.
  Err `400 VALIDATION_ERROR`, `502 UPSTREAM_ERROR`.
- `PUT /api/v1/admin/pricing/sealed/items/:itemId/mapping` — **(NUEVO)** asigna, actualiza o quita el mapeo de UN item.
  Req: `{ tcgplayerProductId: number | null, tcgplayerGroupId?: number, applyToSiblings?: boolean }`
  - `tcgplayerProductId: null` → **desmapea** (limpia también `tcgplayerGroupId`); con valor → `tcgplayerGroupId`
    **obligatorio** (el fetch de precios es por grupo) y ambos **enteros positivos**.
  - `applyToSiblings` (default `false`): copia el mapeo a los demás items `sealed` **sin mapeo** con el mismo
    `(cardId, sealedSubtype)` (las otras copias físicas del mismo producto). Nunca pisa mapeos existentes.
  - Res `200`: `{ inventoryItemId, tcgplayerProductId: number | null, tcgplayerGroupId: number | null, siblingsUpdated: number }`.
  - Err `404 NOT_FOUND` (item), `422 VALIDATION_ERROR` (item no es `sealed`; `tcgplayerGroupId` ausente con productId;
    valores no enteros/negativos). **Auditado** (`AuditLog action=pricing.sealed_mapping.update`, con `before`/`after`).
  - **No** valida contra TCGCSV en el request (la curación debe funcionar sin red al remoto); un `productId` erróneo
    simplemente no matchea filas en el siguiente ingest (referencia queda `null`/stale — inocuo, informativo).

#### Spreads de VENTA del SELLADO (v1.23-sealed-sales — NUEVO backend; editor M2, `super_admin`)
> **Análogo a las reglas de venta por rareza** (arriba), pero keyeado por **presentación** (`SealedSubtype`) para el
> **precio de venta del sellado**: `salePriceCents = round(mercadoTCGCSV × (1 + spread/100))`, con el spread de su
> presentación o el **global de respaldo**, y **override manual** por pieza (`InventoryItem.listPriceCents`) que gana
> siempre. Semántica de `pct` = **markup ARRIBA de mercado** (como ventas §M2, NO «% de la referencia» del buylist).
> Toda edición se **audita** (M10). Ver ARCHITECTURE §4.23b/§4.23c.

- `GET /api/v1/admin/pricing/sealed-spreads` — **(NUEVO)** lee los spreads crudos + fallback.
  Res `200` (`SealedSpreadsDTO`, §DTOs): `{ spreadPctBySubtype: { [subtype in SealedSubtype]?: number }, fallbackPct: number }`
  — el **dominio de llaves son los SIETE valores de `SealedSubtype`**: `box · etb · bundle · tin · blister · upc ·
  collection`.
  ```json
  // ⚠️ VALORES DE EJEMPLO — deliberadamente DISTINTOS de la semilla (ver la tabla de semillas abajo).
  //    Ninguno de estos siete números coincide con el default: esto ilustra la FORMA, no los valores.
  { "spreadPctBySubtype": { "box": 15, "etb": 19, "bundle": 24, "tin": 28, "blister": 33,
                            "upc": 15, "collection": 19 },
    "fallbackPct": 26 }
  ```
  - **⚠️ CORREGIDO EN v2.1.9 — este ejemplo listaba CINCO llaves mientras el `PUT` acepta SIETE, y el frontend
    lo estaba ESPEJANDO.** Tenía tres listas de cinco escritas a mano tomadas de aquí; el resultado es que el dueño
    **vende UPC y no podía calibrarle spread desde la pantalla** — la presentación caía siempre al `fallbackPct`
    global. **No fue un error del frontend: fue este ejemplo.** Es la misma familia que los dos enums de v2.1.8, un
    piso más abajo: allí mentía la **línea canónica**, aquí mentía el **ejemplo** — y un ejemplo se copia con la misma
    confianza que una declaración.
  - **NORMA: el ejemplo NUNCA es el dominio de llaves, NI la fuente de los valores.** La lista de presentaciones se
    **deriva de `SealedSubtype`** (§Enums, espejo de `schema.prisma`), tanto en backend como en el editor de M2: **una
    fila por valor del enum**, nunca un literal a mano. Un ejemplo muestra **una instancia**, no el dominio — y si los
    dos pueden leerse igual, manda la declaración de §DTOs.
    - **Por eso el ejemplo de arriba se mantiene DISTINTO de la semilla (v2.1.9-a, decisión deliberada).** Cuando el
      dueño fijó `upc`/`collection` hubo la tentación de alinear el ejemplo con los defaults «para que cuadre»: **se
      descarta**. Un ejemplo que coincide con la semilla es indistinguible de una tabla de defaults, y volveríamos a
      tener a alguien copiando de aquí — que es **exactamente** el bug D3, con los números en vez de las llaves. La
      **forma** vive en el ejemplo; los **valores** viven en la tabla de semillas de abajo y, en runtime, en lo
      almacenado. *(El ejemplo sí conserva a propósito la **relación** `upc == box` y `collection == etb`: eso no es un
      valor, es el criterio.)*
  - **El mapa es PARCIAL: el `GET` OMITE las llaves no configuradas** (devuelve tal cual lo almacenado; `{}` sólo si no
    hay fila de setting). **Ausente ≠ 0**: una presentación sin spread propio usa `fallbackPct` (`ARCHITECTURE §4.23b`).
    Consecuencia para el editor: **la pantalla no puede derivar sus renglones de las llaves que vengan** —vendría
    exactamente el mismo hueco por otra puerta—; los deriva del **enum** y pinta «usa el global (`fallbackPct`)» en las
    que falten.
    - **v2.1.9-a — la partialidad sigue siendo real, pero YA NO es el estado inicial.** Con la semilla cubriendo las
      **siete** presentaciones, una instalación limpia devuelve **siete** llaves. Una llave falta sólo si el dueño la
      **retiró a propósito** con `null` (ver el `PUT`). **Que hoy vengan las siete NO autoriza al editor a asumirlo**:
      seguiría siendo derivar el dominio de una instancia — exactamente el error de D3, y encima uno que sólo se
      manifestaría **después** de que el dueño borre su primera regla.
  - **SEMILLAS — las SIETE presentaciones tienen default (⚠️ ENMENDADO v2.1.9-a).** Se declaran en tabla, no en JSON,
    a propósito: una tabla no se copia como payload.

    | Presentación | Spread semilla | Origen |
    |---|---|---|
    | `box` | **18 %** | PROJECT §K |
    | `etb` | **22 %** | PROJECT §K |
    | `bundle` | **25 %** | PROJECT §K |
    | `tin` | **30 %** | PROJECT §K |
    | `blister` | **35 %** | PROJECT §K |
    | **`upc`** | **18 %** | **decisión del dueño, 2026-08-24** (= `box`) |
    | **`collection`** | **22 %** | **decisión del dueño, 2026-08-24** (= `etb`) |
    | `fallbackPct` (global) | **25 %** | PROJECT §K |

    - **⛔ Qué decía esta línea hasta v2.1.9 y por qué estaba mal:** *«`upc` y `collection` **NO tienen semilla** […]
      que no tengan semilla es justamente por qué el dueño **necesita** poder fijarlas a mano»*. Describía el estado
      **anterior** a que el dueño contestara, y hoy **afirma lo contrario del código** (backend ya las sembró).
    - **El argumento no muere, cambia de sitio — y conviene decir por qué, porque el error es instructivo.** «No tienen
      semilla, por eso hace falta poder fijarlas» era un **diagnóstico correcto del bug** (el `422` le impedía
      calibrarlas) del que saqué **la conclusión equivocada**: la respuesta era **arreglar el `422`**, no **dejarlas
      sin default**. Son cosas independientes — *poder editar* y *tener un valor razonable de arranque*—, y tratarlas
      como si una sustituyera a la otra dejaba a dos presentaciones reales cayendo al fallback global por omisión.
      **Ahora se cumplen las dos:** el dueño puede fijarlas (D3 + el borrado con `null`, abajo) **y** arrancan en un
      valor elegido a propósito.
    - **El criterio que ubica cualquier presentación futura (es el que la tabla ya venía usando): «ítem más chico ⇒
      % mayor».** El orden `box 18 < etb 22 < bundle 25 < tin 30 < blister 35` no es arbitrario: en una pieza grande y
      cara un porcentaje gordo es un **monto absoluto** que mata la venta; en una pieza barata hace falta un porcentaje
      mayor para que el margen absoluto pague el manejo y el envío. De ahí salen los dos nuevos: un **UPC** es la pieza
      **más grande y cara** del catálogo ⇒ va con `box` (**18**); una **collection** es comparable a un ETB ⇒ va con
      `etb` (**22**).
    - **El criterio ya NO vive solo en esta prosa (backend lo ancló con dos tests, y es la mitad que importa):** (1)
      **una entrada por CADA `SealedSubtype`** — un octavo subtipo en el schema **rompe el test** y obliga a elegirle
      spread **a propósito**, en vez de caer al fallback en silencio; (2) el **orden** `box < etb < bundle < tin <
      blister` con `upc === box` y `collection === etb`. Es la misma doctrina de §4.37: convertir una disciplina en algo
      que sostiene la máquina.
    - **Efecto de (1) sobre el papel de `fallbackPct` — vale la pena verlo, porque cierra el círculo de esta rev.**
      Antes, el fallback era el **destino silencioso de todo lo que nadie pensó** (por eso `upc`/`collection` vivían
      ahí). Con el test de cobertura, **ninguna presentación llega al fallback por olvido**: sólo llega la que el dueño
      **retiró deliberadamente** con `null` (ver el `PUT`). El fallback pasa de **default de facto** a **excepción
      explícita** — que es lo que siempre debió ser, y la razón por la que `fallbackPct: null` es `422`.
    - **📌 Enrutar a product-owner (no bloquea):** `upc 18` / `collection 22` son una **decisión de negocio del humano**
      y hoy sólo están registradas **aquí y en el seed**. PROJECT §K sigue enumerando **cinco**. Por la regla de
      conflicto (*PROJECT manda sobre el contrato*), el contrato no debería ser el **origen** de un número de negocio:
      **product-owner** debe reflejarlas en §K para que este bloque quede citándolas, no inventándolas.
- `PUT /api/v1/admin/pricing/sealed-spreads` — **(NUEVO)** reemplaza los spreads y/o el fallback.
  Req (`SealedSpreadsUpdateRequest`, §DTOs): `{ spreadPctBySubtype?: { [subtype in SealedSubtype]?: number | null }, fallbackPct?: number }`
  (**parcial**: solo las claves a cambiar).
  - **⚠️ CÓMO SE BORRA UNA REGLA PARA VOLVER AL GLOBAL — NORMADO EN v2.1.9 (pregunta de frontend; §M2 no lo definía).**
    **`null` explícito RETIRA la regla de esa presentación**, que pasa a usar `fallbackPct`:
    ```
    PUT { "spreadPctBySubtype": { "upc": null } }     ⇒ `upc` deja de tener regla propia; usa el global
    ```
    Tras el `PUT`, el `GET` **omite** la llave (el mapa es parcial, arriba). Es **idempotente**: retirar una llave que
    no estaba configurada devuelve `200`, no error. **Auditado** como cualquier otra edición
    (`pricing.sealed_spreads.update` con `before`/`after`, donde la retirada es visible).
  - **`null` ≠ `0`, y confundirlos es un bug de DINERO — esto es lo que el front NO debe hacer.** `0` es un spread
    **legítimo** (§SUP-8: «una promo a mercado es legítima»), y significa **vender AL mercado, sin markup**. `null`
    significa **«no tengo regla propia, usa el global»** (hoy 25 %). Un campo que el dueño **vacía** en la pantalla debe
    viajar como **`null`** —o no viajar, si no quiso tocarlo—; **jamás como `0`**, que pondría esa presentación a
    precio de mercado sin margen y sin que nadie lo pidiera. El editor debe distinguir los tres estados: **con valor**,
    **vaciado** (⇒ `null`) y **no tocado** (⇒ llave ausente).
  - **Por qué `null` y no otra cosa (dos alternativas descartadas, con su razón):**
    1. **Semántica de reemplazo total** (mandar el mapa completo; ausencia = borrada), como el `PUT` de la curva:
       **descartada**. Un cliente rancio que mandara las **cinco** llaves de siempre **borraría `upc` y `collection`
       en silencio** — literalmente el bug de D3 reabierto desde el otro lado. En la curva el reemplazo total es
       correcto porque el objeto **es** la unidad de validación cruzada; aquí las llaves son **independientes** entre
       sí, así que la unidad de edición es la llave.
    2. **`DELETE /admin/pricing/sealed-spreads/:subtype`**: **descartada** por no partir en dos caminos de escritura la
       edición de un mismo setting (dos caminos = uno se olvida en un call-site, y la auditoría queda repartida en dos
       acciones). Además, con `null` el dueño puede **retirar una y ajustar otra en la misma escritura**.
    3. **Precedente local que lo cierra:** este mismo §M2 ya usa exactamente este sentinel para exactamente este gesto —
       `PUT /admin/pricing/sealed/items/:itemId/mapping` con `tcgplayerProductId: null` **desmapea**. Mismo verbo,
       mismo rol, misma semántica de «quitar la asociación»: reusarlo es una decisión menos que tomar y una menos que
       recordar.
  - **`fallbackPct: null` ⇒ `422 VALIDATION_ERROR`.** El global **no se puede retirar**: es el respaldo del que
    dependen todas las presentaciones sin regla, y sin él una presentación sin spread no tendría de dónde derivar
    precio — caería a `PRICE_PENDING` y **dejaría de publicarse**, que es una consecuencia de dinero para un gesto que
    parece de limpieza. Para «no aplicar markup global» el valor correcto es **`0`**, no la ausencia.
  - **Validación:** cada clave de `spreadPctBySubtype` ∈ **`SealedSubtype`** — es decir
    `{box, etb, bundle, tin, blister, upc, collection}` (**v2.1.8**: `upc` y `collection` estaban de facto excluidos
    porque el enum canónico se había quedado corto, así que el `PUT` los rechazaba con `422` y **el dueño no podía
    calibrarles spread**; caían siempre al `fallbackPct` global. Consecuencia money-safe pero **no calibrable** — el
    fallback existe para el hueco, no para ser el único camino de dos presentaciones reales); cada `value` y `fallbackPct`
    **número en `[0, 1000]`** (markup arriba de mercado, puede >100%). Objeto (no array). `422 VALIDATION_ERROR` si no.
  - Res `200`: mismo shape que el `GET`. **Auditado** (`AuditLog action=pricing.sealed_spreads.update`, `before`/`after`).
    **Surte efecto sin redeploy.**
  - **Override por producto/pieza:** el override manual es `InventoryItem.listPriceCents` (`PATCH /admin/inventory/items/:id`
    o `bulk-publish` con `listPriceCents` por línea). Un «override por producto» = aplicar el mismo `listPriceCents` a
    todas las piezas del grupo vía `bulk-publish` (no hace falta endpoint nuevo). El override **gana** sobre el spread.
  - **Prerequisito money-safe:** para que el spread produzca precio hace falta `sealedMarketRef` (item **mapeado**, §M2).
    Ese mercado puede venir del **ingest automático TCGCSV** (requiere dial `sealedPriceSource=tcgcsv`, §M10) **o** de un
    **override manual de mercado** («FIJAR PRECIO», `isManualOverride`) — **v1.43 (IMP-C):** el override manual **NO** lo
    condiciona el dial y produce precio aun con el dial `off`. Sin mercado de ninguna fuente, el sellado solo se vende con
    el override de venta por pieza (`listPriceCents`).

#### Gancho de grading — estimados PSA y curaduría del destacado (v1.50 — NUEVO; editor M2, `super_admin`)
> **PROJECT §O v2.0 + reducción de alcance del humano (2026-08-23); ARCHITECTURE §4.38.** Gobierna **qué grados se
> muestran**, **cuándo un dato deja de ser fresco**, **qué cartas se promocionan activamente** (gate de ROI sobre
> PSA 9 con tabla de escalones de costo) y —desde **v1.50.2**— **cuándo una cifra es lo bastante confiable para
> promoverla** (gate de confianza). **Nada de esto viaja al cliente.** Mismo **patrón** que
> `sealed-spreads`/`tiers` (JSON en `ConfigSetting`, **auditado**, **sin redeploy**, validación total en el `PUT`), en
> un **recurso propio**: los tiers de rareza son una taxonomía **LOCKED** de 5 filas nombradas cuyo `PUT` **exige** las
> 5 y valida el refinamiento premium; los escalones de costo son filas **añadibles/eliminables** que son **rangos** y
> cuyo invariante es **contigüidad + escalón final abierto**. Dos validadores incompatibles no caben en un `PUT`.
> **Los estimados NO se capturan aquí:** se fijan con `POST /admin/pricing/override` (arriba, con
> `intent:"graded_estimate"` desde v1.50.2), fase 1 manual-first.
> **⚠ Nota de implementación (normativa, v1.50):** estos tres endpoints se declaran en **`CatalogModule`**, no en
> `PricingModule`, para evitar un **ciclo `Pricing ↔ Catalog`** (el resolver necesita la composición de grupos de
> `catalog` y el batch de `pricing`; `Catalog → Pricing` ya es la dirección única y sana). **Las rutas son las de este
> contrato y NO cambian** — la ruta HTTP es la fuente de verdad, no el módulo que la aloja. Moverlos a `PricingModule`
> «por coherencia de nombre» **revive el ciclo**: requiere extraer un módulo compartido y pasa por el arquitecto
> (regla 9). Ver ARCHITECTURE §4.38(d).

- `GET /api/v1/admin/pricing/graded-estimates` — **(NUEVO)** lee la config completa. Read-only.
  Res `200` (`GradedEstimateConfigDTO`):
  ```json
  { "enabled": false,
    "ingestEnabled": false,
    "grades": ["10", "9"],
    "highlightGrades": ["10"],
    "freshnessDays": 30,
    "minUpsidePct": 30,
    "manualFreshnessDays": 30,
    "maxRawMultiple": 100,
    "minSampleCount": 5,
    "sourceStat": "median",
    "ingestMaxCardsPerRun": 250,
    "gradingCostTiers": [
      { "minValueMxnCents": 0,       "maxValueMxnCents": 200000,  "costMxnCents": 70000 },
      { "minValueMxnCents": 200000,  "maxValueMxnCents": 500000,  "costMxnCents": 110000 },
      { "minValueMxnCents": 500000,  "maxValueMxnCents": 1000000, "costMxnCents": 180000 },
      { "minValueMxnCents": 1000000, "maxValueMxnCents": 2000000, "costMxnCents": 300000 },
      { "minValueMxnCents": 2000000, "maxValueMxnCents": 5000000, "costMxnCents": 600000 },
      { "minValueMxnCents": 5000000, "maxValueMxnCents": null,    "costMxnCents": 1200000 }
    ] }
  ```
  - **`enabled` / `ingestEnabled`** = **espejos READ-ONLY** de los dos diales M10 (`gradedEstimatesEnabled` /
    `gradedEstimateIngestEnabled`, ambos seed `off`); se editan en `PUT /admin/settings`, **no aquí**. Están en este
    DTO para que el editor de M2 muestre si lo que se edita está vivo. *(`enabled` = ¿se **exhibe**? `ingestEnabled` =
    ¿se **obtiene**? Ver §M10 para por qué son dos.)*
  - **`grades`** = grados que la **FICHA** expone (seed `["10","9"]`, orden desc). **`highlightGrades` ⊆ `grades`** =
    grados que **el badge de rejilla/vitrina** pinta (seed `["10"]`, §O.3(2)). El **gate SIEMPRE se evalúa con PSA 9**
    aunque PSA 9 no se pinte en el badge.
  - **`gradingCostTiers`** = escalones **[min, max)** en centavos MXN. El seed es la tabla de **§O.2.1** y cubre el
    total **puerta a puerta** para un comprador en México (cuota PSA + envío internacional + retorno asegurado +
    manejo), **no** la cuota pelona (criterio 110(d)). Los valores son un **SUPUESTO revisable** por el dueño.
  - **v1.50.2 — los cinco diales del GATE DE CONFIANZA y del INGEST** (ARCHITECTURE §4.38k/§4.38h).
    **⚠️ v1.50.3 corrige TRES seeds** para alinearlos con `PROJECT.md` (regla de conflicto: PROJECT manda sobre el
    contrato). **Solo cambia el valor sembrado; ningún shape, ruta, rango ni código de error se altera.**
    **⚠️ Estos son los defaults de CÓDIGO, y no describen necesariamente el entorno que estés mirando.** El seed usa
    `update: {}`, así que **una base ya sembrada conserva los valores viejos** hasta que alguien los cambie por este
    mismo `PUT`. Para saber qué tiene un entorno, **consulta el `GET`** — no supongas esta tabla. Paso de despliegue
    en ARCHITECTURE §4.38(p); regla general en ARCHITECTURE §11.0.

    | Campo | Seed **v1.50.3** | *(antes)* | Rango | Qué gobierna |
    |---|---|---|---|---|
    | `manualFreshnessDays` | **30** | ~~`null`~~ | `null` o `[1, 3650]` | Decaimiento del **override manual**, medido contra su **fecha de captura** (**criterio 109**). `null` = **no decae**, pero **desactiva ese criterio** ⇒ es decisión del humano, y el backend emite **`warn`** al izar la config si lo encuentra en `null` (§4.38m) |
    | `maxRawMultiple` | **100** | ~~50~~ | `(1, 1000]` | Cota **superior** de magnitud: se descarta si `psa10 > salePriceCents × maxRawMultiple`. Es el `maxGradedMultiple` de §O.7 / **criterio 111(c)** |
    | `minSampleCount` | **5** | ~~3~~ | `[1, 100]` | Muestra mínima del proveedor. Es el `minSalesSample` de §O.7 / **criterio 111(a)**. **Se aplica en el INGEST (escritura)**, no en lectura |
    | `sourceStat` | **`median`** | — | `median\|average\|smart` | Cuál número del proveedor **es** el precio (§4.38h.2) |
    | `ingestMaxCardsPerRun` | **250** | — | `[1, 5000]` | Tope **duro** de cuota por corrida del ingest |

    - **⚠️ GLOSARIO NORMATIVO de nombres (v1.50.3) — `PROJECT.md` y el contrato usan vocabularios distintos, y eso
      permitió que los VALORES divergieran en silencio.** Queda tabulado para que la equivalencia deje de ser
      folclore. **Los identificadores del contrato NO se renombran** (renombrar cuesta un breaking de admin + migrar
      `SettingKey` ya sembradas, a cambio de cero comportamiento; y `maxRawMultiple` es además más preciso: el
      múltiplo se aplica sobre el precio **raw**). Razonamiento completo en ARCHITECTURE §4.38(k.0).

      | `PROJECT.md` §O.7 | Contrato (`GradedEstimateConfigDTO`) | `SettingKey` |
      |---|---|---|
      | `minSalesSample` | `minSampleCount` | `graded_estimate_min_sample_count` |
      | `maxGradedMultiple` | `maxRawMultiple` | `graded_estimate_max_raw_multiple` |
    - **`minSampleCount` se aplica al ESCRIBIR, y eso tiene una consecuencia que hay que conocer:** cambiarlo afecta
      **solo a escrituras futuras**; para re-aplicarlo retroactivamente hay que **re-correr el ingest**. Se hizo así
      para que `PriceReference` **no cambie de esquema** (no hay dónde persistir el `count`) y M-42 siga siendo
      DATA/seed puro. El `count` observado va a **log + `AuditLog`** del job, nunca a la tabla de dinero.
      **⚠️ v1.50.3:** subir el seed a **5** **no re-filtra** lo ya escrito. Hoy el ingest está `off` (seed), así que
      en la práctica no hay filas que re-aplicar; **si eso cambia antes del deploy, backend debe re-correr el ingest o
      limpiar** las filas escritas con `count ∈ {3, 4}`.
    - **⚠️ v1.50.3 — `freshnessDays` gana un SEGUNDO efecto, en la escritura del ingest** (ARCHITECTURE §4.38m.2): el
      ingest **no persiste** una fila cuya `lastSaleDate` del proveedor supere `freshnessDays`, y trata
      **ausente/no parseable como NO fresco**. Sin ese gate, cada corrida reescribiría `capturedDate = hoy` sobre
      evidencia que ya no se mueve y la cifra parecería **fresca para siempre** — el fallo exacto que el
      **criterio 109** existe para evitar. **No cambia el contrato**: es comportamiento del job.
    - **Diagnóstico:** como el descarte por muestra baja ocurre en escritura, el `preview` lo ve como
      `NO_PSA10`/`NO_PSA9` (la fila no existe). **Por eso el ingest DEBE dejar traza por carta saltada** (§4.38h.4).
      Es una limitación aceptada y su compensación es esa traza.
- `PUT /api/v1/admin/pricing/graded-estimates` — **(NUEVO)** actualiza la config. Body **parcial** por campo; el
  **array `gradingCostTiers` se reemplaza COMPLETO** cuando viene (un patch por fila no puede validar contigüidad).
  Req: `{ grades?: string[], highlightGrades?: string[], freshnessDays?: number, minUpsidePct?: number,
  gradingCostTiers?: GradingCostTierDTO[], manualFreshnessDays?: number | null, maxRawMultiple?: number,
  minSampleCount?: number, sourceStat?: "median"|"average"|"smart", ingestMaxCardsPerRun?: number }`.
  **`enabled` y `ingestEnabled` se IGNORAN** si vienen (se editan en M10).
  - **Body vacío (`{}`, o sin ninguna clave reconocida) ⇒ `422 VALIDATION_ERROR`.** El body es parcial, pero **debe
    traer al menos un campo**: un `PUT` que no toca ninguna clave es casi siempre un bug del cliente (campo mal
    nombrado, serialización rota), y responder `200` con la config sin cambios le haría creer al operador que
    **guardó** algo que no guardó — en un dial que gobierna una afirmación comercial. Mismo precedente que
    `PUT /admin/fx`, que exige al menos uno de sus dos campos opcionales.
  - **Validación (fail-closed, server-side, en CADA write):**
    | # | Invariante | Error |
    |---|---|---|
    | I1 | `gradingCostTiers` array **no vacío** | `422 GRADING_TIERS_EMPTY` |
    | I2 | por fila: `minValueMxnCents` int ≥ 0; `maxValueMxnCents` int > min **o** `null`; `costMxnCents` int **≥ 1** y ≤ `GRADING_COST_MAX_CENTS` (**10 000 000** = $100 000, anti-typo) | `422 VALIDATION_ERROR` |
    | I3 | orden ascendente por `minValueMxnCents` y **primera fila `min === 0`** (cobertura desde cero) | `422 GRADING_TIERS_NOT_CONTIGUOUS` |
    | I4 | **contigüidad:** `tiers[i].maxValueMxnCents === tiers[i+1].minValueMxnCents` ∀ `i < n-1` (sin huecos **ni** solapes) | `422 GRADING_TIERS_NOT_CONTIGUOUS` (body: los pares `(i, i+1)` infractores) |
    | I5 | **último escalón abierto:** `tiers[n-1].maxValueMxnCents === null` y **ninguna otra** fila `null` | `422 GRADING_TIERS_NOT_OPEN_ENDED` |
    | I6 | `minUpsidePct` número en `[0, 1000]`; `freshnessDays` int en `[1, 365]` | `422 VALIDATION_ERROR` |
    | I7 | `grades` / `highlightGrades` ⊆ `{"10","9"}`, no vacíos, sin duplicados, y **`highlightGrades` ⊆ `grades`** | `422 VALIDATION_ERROR` |
    | **I8** *(v1.50.2)* | `manualFreshnessDays` **`null`** o int en `[1, 3650]`; `minSampleCount` int en `[1, 100]`; `sourceStat` ∈ `{median, average, smart}`; `ingestMaxCardsPerRun` int en `[1, 5000]` | `422 VALIDATION_ERROR` |
    | **I8-bis** *(v1.50.3, NO es validación: es OBSERVABILIDAD)* | `manualFreshnessDays === null` **se acepta** (sigue siendo un valor legal) pero **DEBE emitir `warn`** al izarse la config: desactiva el **criterio 109** para la vía manual, y una afirmación comercial no puede dejar de caducar **en silencio**. Misma doctrina que «la vitrina no puede vaciarse en silencio» | — *(no bloquea; `warn` obligatorio)* |
    | **I9** *(v1.50.2)* | `maxRawMultiple` número **> 1** y ≤ `1000`. **El `> 1` NO es cosmético:** con `≤ 1` la cota superior chocaría con la inferior (`psa10 > salePriceCents`) y **ninguna** carta podría destacarse jamás — vitrina vacía permanente y sin explicación | `422 VALIDATION_ERROR` |
  - **`costMxnCents ≥ 1`, JAMÁS 0** — misma guardia L1 de dinero que ya aplica `OverrideDto` (`@Min(1)`). Un costo de
    gradeo subestimado es **exactamente** lo que haría que el comprador pierda dinero (§O.4).
  - Res `200`: mismo shape que el `GET`. **Auditado** (`AuditLog action=pricing.graded_estimates.update`,
    `before`/`after`). **Sin redeploy.** **Recalcula el conjunto destacado al vuelo** (el gate se evalúa por request, no
    hay materialización) ⇒ subir `minUpsidePct` o encarecer un escalón **vacía la vitrina y quita los badges**, **sin
    tocar ningún precio de venta** (criterio 104).
  - **Fail-closed on-read — `AUSENTE ≠ INVÁLIDA`** *(regla refinada 2026-08-23, P1 del techlead)*: el lector distingue
    **tres** estados por clave. **Válida** ⇒ se usa. **Ausente** (nunca escrita, estado del primer deploy antes de
    M-42) ⇒ `grading_cost_tiers` apaga el destacado; las demás caen a su **seed**. **Presente pero INVÁLIDA** (corrupta,
    fuera de rango, o incumple I1–I9 por una edición fuera de banda) ⇒ **nada se destaca**, para **cualquiera** de las
    claves — un valor corrupto es evidencia de que la intención del admin se perdió, y caer al seed sería **más
    permisivo que esa intención, en silencio** (un `minUpsidePct` de 200 degradado a 30, o una frescura de 7 degradada a
    30). Si la clave inválida es `freshnessDays`, `manualFreshnessDays` o `grades` —que también gobiernan la **ficha**—
    apaga **también** la ficha. **Jamás** se cae a un default de código para el **costo**, en ningún estado. Toda clave
    presente-e-inválida se **loguea con `warn`** (la vitrina no puede vaciarse en silencio) y el `preview` la reporta
    como `FEATURE_OFF`. Detalle normativo y tabla completa en ARCHITECTURE §4.38(d).
- `GET /api/v1/admin/pricing/graded-estimates/preview` — **(NUEVO, diagnóstico de CURADURÍA, `super_admin`,
  read-only)** responde **«¿por qué esta carta no está destacada?»**. Es el **único** lugar donde los insumos del gate
  se exponen: al **admin**, jamás al cliente. Pensado para el flujo real de fase 1 (el humano **cura a mano** sus
  cartas gancho, §O.6) y para que QA verifique el gate sin leer la BD.
  Query: `?cardId=` (**requerido**).
  Res `200`: `{ cardId, enabled: boolean, config: GradedEstimateConfigDTO, groups: GradedEstimatePreviewDTO[] }` —
  una entrada **por grupo raw publicado** de esa carta (la misma `K` de `GroupedListingDTO`), con `psa10MxnCents`,
  `psa9MxnCents`, `capturedDate`, `stale`, el **escalón aplicado**, el **umbral**, la **ganancia neta sobre PSA 9**,
  `eligible` y un `reason` accionable cuando `eligible=false`
  (`FEATURE_OFF | NOT_RAW | NOT_PUBLISHED | NO_PSA10 | NO_PSA9 | STALE | NO_COST_TIER | BELOW_MIN_UPSIDE`
  **+ v1.50.2: `SLAB_PUBLISHED | NOT_ABOVE_RAW | ABOVE_MAX_MULTIPLE | GRADE_ORDER_INVERTED`**).
  - **v1.50.2 — dos campos nuevos** en `GradedEstimatePreviewDTO`: `maxAllowedPsa10MxnCents` (la cota superior efectiva
    = `salePriceCents × maxRawMultiple`, para que el operador vea **contra qué** se comparó) y `publishedSlabGrades`
    (los grados de esa carta con slab **publicado** — INV-D).
  - **Los cuatro `reason` nuevos, y qué error ataja cada uno** (ARCHITECTURE §4.38k.2 — **son complementarios, no
    redundantes; leer antes de relajar cualquiera**):
    | `reason` | Se dispara cuando | Qué error real ataja |
    |---|---|---|
    | `SLAB_PUBLISHED` | hay slab publicado de ese grado | INV-D: esa fila **es dinero**, no un estimado |
    | `NOT_ABOVE_RAW` | `psa10 <= salePriceCents` | **EL ERROR DE UNIDADES (USD donde van MXN).** Un PSA 10 de USD 60 guardado como MX$60 queda ~19× **BAJO**, no alto, así que el múltiplo máximo **no lo ve**: lo caza esta cota inferior |
    | `ABOVE_MAX_MULTIPLE` | `psa10 > salePriceCents × maxRawMultiple` | el **cero de más** / typo al alza |
    | `GRADE_ORDER_INVERTED` | `psa10 < psa9` | las dos filas se capturaron **cruzadas** |
  - **La FICHA no aplica los tres últimos** (solo la rejilla). Una carta con estimado incoherente **sigue mostrándolo
    en su ficha** y **no se promueve**: ocultarlo también ahí convertiría un dato visible-y-corregible en una
    desaparición silenciosa. §4.38(k.3).
  - **Money-safe:** todo monto no resoluble es **`null`**, nunca `0`. **No escribe nada** y **no toca dinero** (sin
    `MoneyOutGuard`); no aparece en ninguna superficie pública.
  - `groups: []` = la carta no tiene ningún grupo raw publicado (no es un error).
  - Err `400 VALIDATION_ERROR` (sin `cardId`), `403`, `404 NOT_FOUND` (carta inexistente).
- `GET /api/v1/admin/pricing/graded-estimates/review` — **(NUEVO v1.50.3 — LISTA DE REVISIÓN, `super_admin`,
  read-only, paginado)**. **Es el criterio 111(e)**, que hasta ahora no tenía implementación ni estaba declarado fuera
  de alcance. Enumera las cartas cuya cifra **falla la coherencia de magnitud** — las que, por decisión de
  ARCHITECTURE §4.38(k.3), **seguimos mostrando en la ficha** y **no** promocionamos. **Es la contrapartida de esa
  decisión:** si se muestra la cifra rara, alguien tiene que enterarse. Detalle normativo en ARCHITECTURE §4.38(n).
  > **Por qué es un recurso nuevo y no `preview` sin `cardId`.** `preview` responde «¿por qué **esta** carta no está
  > destacada?» y exige `cardId`: **solo contesta si ya sospechabas**. Esto responde «¿de qué cartas debo
  > sospechar?», que es la pregunta que nadie podía hacer. Mismo cálculo, misma función pura, mismos `reason` — lo que
  > cambia es la dirección de la consulta.

  Query: `?reason=&page=&pageSize=` — **todos opcionales**.
  - **`reason?`** (repetible o CSV). **Default = los TRES `reason` de coherencia**: `NOT_ABOVE_RAW`,
    `ABOVE_MAX_MULTIPLE`, `GRADE_ORDER_INVERTED` (= criterio 111(b)(c)(d)).
    **Valores extra admitidos, fuera del default:**
    - **`SLAB_PUBLISHED`** (INV-D) — accionable y es el conjunto expuesto al riesgo de §4.38(l.3), pero **no es un
      dato erróneo**.
    - **`STALE`** *(**NUEVO v1.50.3-c**, PI-D6)* — la cifra **existe y caducó**. **Corrige un `400` que era un error
      de diseño mío:** `STALE` no es «ausencia de dato» como `NO_PSA10` (nunca hubo nada) sino **un dato que alguien
      puso o ingestó y que expiró**, y es la categoría que la propia §4.38(m) prometía poder enumerar. Sin esto, una
      cifra caducada **desaparece de las tres superficies en silencio, sigue en la BD, y el dueño no tiene forma de
      encontrarla** para refrescarla o retirarla. **Es el caso que mejor encaja en el propósito de esta lista.**
    Ambos **fuera del default** por el mismo motivo: incluirlos **ahogaría la señal de coherencia** en la lista que
    existe para que esa señal se vea.
    - **⚠️ v1.50.3-e — el filtro se evalúa sobre `reasons`, NO sobre `reason`:** una fila entra si
      `reasons ∩ {reasons pedidos} ≠ ∅`. **Corrige un agujero medido en la red de coherencia:** con **un solo grado**
      (raw $460 + PSA 10 $230, sin PSA 9) la evaluación cortaba en `NO_PSA9` y **`NOT_ABOVE_RAW` nunca se
      comprobaba** ⇒ `total: 0`. Y ese es el peor sitio donde faltaba: el error **USD-como-MXN** es más probable en la
      **primera captura** (un solo grado), y como sin PSA 9 la carta **nunca se promociona**, la cifra errónea **no
      llega a la rejilla pero SÍ se muestra en la ficha** —que no aplica magnitud— ⇒ **visible al comprador e
      inencontrable para el operador**. Con `reasons`, esa carta aparece bajo `?reason=NOT_ABOVE_RAW`.
    Cualquier otro `reason` (`NO_PSA10`, `NO_PSA9`, `NO_COST_TIER`, `BELOW_MIN_UPSIDE`, `NOT_RAW`, `NOT_PUBLISHED`,
    `FEATURE_OFF`) ⇒ **`400 VALIDATION_ERROR`**: son **ausencia** de dato o el gate comercial haciendo su trabajo, y
    una lista que los incluyera tendría miles de filas normales y cero valor operativo.
  - **`page` / `pageSize`:** default `pageSize` **25**, máx **100**. Paginación inválida ⇒ `400 VALIDATION_ERROR`.
  - **Orden determinista** (paginación estable): **`reason` PRIMARIO MATCHEADO** asc → **`capturedDate` asc (`null`
    al final)** → `cardId` asc → `representativeInventoryItemId` asc. El «primario matcheado» = el primer elemento de
    `reasons` que esté en el conjunto pedido (orden canónico) — no `reasons[0]` a secas, que podría ser un motivo que
    el operador **no** pidió. *(v1.50.3-c intercaló `capturedDate`: con `?reason=STALE` **lo más vencido va
    primero**. Sigue siendo total y estable.)*

  Res `200`:
  ```
  { data: GradedEstimateReviewItemDTO[], page, pageSize, total,
    enabled: boolean,        // estado del dial M10 graded_estimates_enabled — ver abajo
    scannedCards: number,    // tamaño del conjunto motor efectivamente evaluado
    truncated: boolean }     // true si el conjunto motor superó GRADED_REVIEW_MAX_SCAN
  ```
  `GradedEstimateReviewItemDTO` = **`GradedEstimatePreviewDTO` + identidad de la carta** (`cardId`, `cardName`,
  `setName`, `number`) para que la lista sea legible sin un fetch por fila. **Mismo tipo de contenido, mismos campos de
  diagnóstico** (`psa10MxnCents`, `psa9MxnCents`, `capturedDate`, `maxAllowedPsa10MxnCents`, `publishedSlabGrades`,
  `reason`) — no se inventa un DTO paralelo.
  - **⚠️ v1.50.3-c — `isManual: boolean` se AÑADE a `GradedEstimatePreviewDTO`** (y por herencia al de `review`).
    Nace de `STALE`: las dos clases de fila caducada exigen **remedios opuestos** —una **manual** rancia es *la
    afirmación del dueño que expiró* ⇒ **recapturar o borrar**; una **automática** rancia es *el feed que dejó de
    cubrir esa carta* ⇒ **mirar el ingest, no la carta**— y `reason: STALE` a secas no las distingue.
    **No viola la indistinguibilidad de fases (ARCHITECTURE §4.38g):** esa garantía es sobre las superficies
    **públicas**, y `source`/`isManualOverride` ya estaban disponibles para el admin. Se emite **`isManual` y no
    `source`** a propósito: contesta la pregunta operativa («¿esta cifra la puse yo?») sin publicar la identidad del
    proveedor. **Admin-only; ningún DTO público cambia.**
  - **⚠️ `enabled: false` NO vacía esta lista, a propósito.** El endpoint evalúa la coherencia **aunque la feature
    esté apagada**, y **`FEATURE_OFF` nunca se emite aquí**. Razón: el dial arranca en `off` precisamente para poder
    **limpiar los datos antes** de encender la afirmación comercial; una lista que solo funciona con la feature
    encendida obliga a **publicar las cifras malas para poder descubrirlas**. El campo `enabled` viaja para que el
    front pueda avisar «hay cifras marcadas, pero ahora mismo no se está publicando nada». *(Divergencia deliberada
    con `preview`, que sí corta en `FEATURE_OFF`.)*
  - **⚠️ `truncated: true` DEBE pintarse.** El backend acota el barrido con `GRADED_REVIEW_MAX_SCAN` (constante de
    código, **5 000** cartas con fila de estimado). **Prohibido truncar en silencio:** una lista de revisión
    incompleta presentada como completa es peor que no tenerla — produce la falsa confianza de «no hay nada que
    revisar».
  - **Coste:** número de queries **constante** (config + `distinct cardId` con fila `graded:PSA:*` + batch de
    estimados + batch de precios raw publicados + batch de slabs publicados). **Jamás una query por carta ni por
    grupo.** El conjunto motor son **solo las cartas que tienen fila de estimado**, no el catálogo.
  - **Money-safe:** todo monto no resoluble es **`null`**, nunca `0`. **No escribe nada, no corrige, no descarta y no
    silencia** (sin `MoneyOutGuard`). El operador actúa con las herramientas que ya existen
    (`POST /admin/pricing/override` con `intent:"graded_estimate"`, o **borrando el dato** con el `DELETE` de abajo).
    *(Un «marcar como revisada»
    exigiría estado persistido ⇒ tabla nueva ⇒ DDL: **fuera de alcance de v1.50.3**, declarado para que no se cuele
    por la puerta de atrás.)*
  - **`data: []`** = no hay ninguna cifra incoherente. **No es un error** y **no es un estado a celebrar en la UI con
    un placeholder**: se pinta como lista vacía, igual que cualquier back-office.
  - **⚠️ Config CORRUPTA ⇒ `409 GRADED_CONFIG_INVALID`, no un resultado dudoso.** Aplicación de `AUSENTE ≠ INVÁLIDA`
    (arriba): el dial `off` es una **decisión** y esta lista lo tolera; una clave **presente pero inválida** es
    **intención perdida**. Si la coherencia depende de una clave corrupta (hoy `maxRawMultiple`), el endpoint
    responde `409` **nombrando la clave** en lugar de evaluar con un umbral basura o caer al seed. Una lista de
    revisión calculada contra un umbral corrupto es **peor que no tener lista**.
  - **No es público, ni lo será** (expone insumos del gate, SEC-A1). Err `400 VALIDATION_ERROR` (`reason` no admitido
    o paginación inválida), `403`, **`409 GRADED_CONFIG_INVALID`**.
- `DELETE /api/v1/admin/pricing/graded-estimates/:cardId/:gradeValue` — **(NUEVO v1.50.3-d, `super_admin`,
  AUDITADO)** retira el estimado de esa carta y ese grado. **Cierra un hueco de contrato:** este documento y
  ARCHITECTURE §4.27f-2 venían afirmando —desde v1.46— que un override manual *«solo lo revoca otro override o la
  limpieza/borrado explícito por `super_admin`»*, **y ese borrado no existía**: el back-office solo podía **pisar** una
  cifra, nunca **quitarla**. `PROJECT.md` §O.7 pide explícitamente que el dueño pueda *«corregirla con override **o
  descartarla**»*. Detalle normativo en ARCHITECTURE §4.38(q).
  - **`:gradeValue`** = `"10"` | `"9"` (no el `gradeKey` crudo). **Debe estar en `grades`** de la config; si no ⇒
    `400 VALIDATION_ERROR`. Una ruta destructiva no acepta claves arbitrarias: solo los grados que la feature gobierna.
  - **Borra TODAS las filas de la clave canónica** `(cardId, 'graded', buildGradeKey(gradeValue), 'normal',
    cardProductId=null)` **sea cual sea su `capturedDate`**, en **una transacción**. **No se borra «solo la
    vigente»:** la unique incluye `capturedDate`, así que eso haría **aflorar una fila más vieja** y la cifra
    **reaparecería sola** en la ficha — una resurrección silenciosa, peor que no haber borrado.
    - **⚠️ v1.50.3-f (M-43) — y SOLO las de `refKind="graded_estimate"`.** Con la naturaleza en la fila, «todas las de
      la clave» podría llevarse una fila **`market`**, que es **dinero de una pieza real** — exactamente el radio de
      explosión que este mismo endpoint se negó a abrir para `raw`/`sealed`. `deletedCount` cuenta **solo** las
      borradas; si la clave únicamente tenía filas `market` ⇒ **`404`** (no hay estimado que retirar), y el operador
      ve en `/review` que esa cifra es `refKind:"market"` y que no se toca por esta vía. ARCHITECTURE §4.38(l.4.5).
  - Res `200`: `{ cardId, gradeValue, deletedCount: number }`. **Auditado**
    (`AuditLog action=pricing.graded_estimate.delete`, **`before` = las filas borradas** con sus valores y fechas,
    `after: null`). Ese `before` es **la única forma de deshacer** un borrado equivocado (recapturar lo que había).
  - **⚠️ `409 GRADED_ESTIMATE_SLAB_PUBLISHED` si existe un slab publicado de ese grado** — **la misma guarda INV-D que
    la escritura** (`POST /admin/pricing/override`, §4.38l.1). Por INV-D, con slab publicado esa fila **ya no es un
    estimado: es la referencia de mercado real de una pieza física**, y borrarla **le quitaría el sustento de precio a
    un slab que se está vendiendo** (⇒ `PRICE_PENDING` ⇒ despublicado). **Corolario que conviene no deducir al revés:
    este `DELETE` NO es un remedio para INV-D inverso** (§4.38l.3) — ahí el slab ya está publicado, así que dispara
    `409`; el remedio correcto sigue siendo **repreciar con `intent:"market"`**. *(v1.50.3-f: INV-D inverso lo cierra
    **M-43** con `refKind`, no este endpoint; el `409` y este corolario **no cambian**.)*
  - **`404 NOT_FOUND` si no había nada que borrar** — **no** un `200` silencioso. Mismo criterio que el `PUT` con body
    vacío ⇒ `422`: responder éxito cuando no pasó nada le haría creer al operador que **limpió algo que no limpió**.
  - **Funciona con `gradedEstimatesEnabled=off`** (mismo motivo que `/review`: hay que poder limpiar **antes** de
    encender).
  - **NO** borra filas `raw` ni `sealed`, **no** despublica inventario, **no** encola `PendingPriceEntry` (la ausencia
    de estimado no es un «precio pendiente») y **no** toca `listPriceCents`.
  - Err `400 VALIDATION_ERROR`, `403`, `404 NOT_FOUND`, `409 GRADED_ESTIMATE_SLAB_PUBLISHED`.
  - **Frontend:** esta lista necesita superficie en **M2**, junto al editor de diales del gancho. **Sin UI el criterio
    111(e) NO se cumple** — «aparece en la lista de revisión» es una afirmación sobre lo que el dueño **ve**.

### M3 — Ventas / órdenes (`vault_operator` lectura; `super_admin` reembolso)
- `GET /api/v1/admin/orders` — query `?status=&userId=&q=&from=&to=&minCents=&maxCents=&guest=&needsManual=&page=&pageSize=`
  - **v1.25-buylist-orders-pagination (§M3, TODOS aditivos y opcionales — omitidos = comportamiento de HOY):** lo que HOY YA soporta (`status`, `userId`, `from`, `to`, `guest`, `needsManual`, `page`, `pageSize`, orden `createdAt desc`, respuesta `{ data, page, pageSize, total }`) **no cambia**. Se añade, en **paridad con `GET /admin/buylist`** (mismos nombres):
    - **`q?: string` (búsqueda server-side — HOY NO existe buscador de texto en M3):** contains **case-insensitive**, OR entre campos, sobre **folio** (`Order.orderNumber`), **correo de invitado** (`Order.guestEmail`) e **identidad del comprador con cuenta** (`Order.userId` exacto **y** `User.name` / `User.email` vía la relación `Order.user`, para pedidos no-invitado). Cubre los dos tipos de comprador (invitado sin `User` ⇒ `guestEmail`; con cuenta ⇒ nombre/correo/UUID) de forma coherente con el `q` de buylist. Trim; vacío/whitespace = ausente; máx **200** chars (más largo → `400 VALIDATION_ERROR`). `M3View` hoy sólo muestra la columna `userId` sin filtro; este `q` es su buscador server-side.
    - **`minCents?` / `maxCents?` (rango de MONTO, enteros ≥ 0):** aplican sobre **`totalCents`** — el **total canónico** de la orden en el modelo `Order` (`Int` no-nullable; `subtotalCents + processingFeeCents + ivaCents + envío`), el mismo que ya muestra la columna «total» de `M3View`. `gte minCents`, `lte maxCents`. No negativo / no entero / `maxCents < minCents` → `400 VALIDATION_ERROR`.
    - **`from?` / `to?`:** ya existían (rango `gte`/`lte` sobre `createdAt`); se listan aquí sólo por completitud de paridad con buylist. **Borde de día (v1.25.1, §Convenciones):** un valor **date-only** (`YYYY-MM-DD`) se ancla al borde del día en UTC — `from` = `00:00:00.000Z`, `to` = fin de día **INCLUSIVO** `23:59:59.999Z` — así `to` **incluye** las órdenes cerradas ese mismo día (buscar una orden por fecha en M3); un datetime ISO completo se usa tal cual.
    - **`pageSize`:** default **20 SIN CAMBIOS** (misma decisión que §M5 — no romper consumidores actuales); el front pide **`pageSize=25`**. Máx **100**. Paginación inválida → `400 VALIDATION_ERROR`. Orden **`createdAt desc`** (recientes primero) ya vigente.
    - **Seguridad (documentada; guard del backend):** listado tras rol `vault_operator`/`super_admin`. `q` y los rangos **sólo REDUCEN** el conjunto ya autorizado (sin IDOR/enumeración cruzada nueva; sin cambiar shape ni proyección por rol). `guestEmail` es dato de contacto operativo ya expuesto por rol (mismo criterio que `AdminSellerRef.email`), por eso `q` puede buscarlo; **no** se busca sobre datos de pago (PAN/últimos-4 viven en `paymentMethodLast4`, fuera del alcance de `q`).
  - **`needsManual?=true|false` (v1.21.2, NUEVO, aditivo):** filtra por `Order.chargebackNeedsManual`. Es la **cola
    de "contracargos por resolver"** que alimenta el desenlace humano de `chargeback-inventory` (abajo). Sin este
    filtro no hay forma de que el operador **descubra** que hay piezas congeladas — hoy solo se sabrían llamando a
    la API a mano. Mismo guard, misma proyección y misma paginación que sin filtro. **Dueño de la UI: WS «Admin y
    auditoría»** (ver ARCHITECTURE §4.21c-bis › «Requisito pendiente»).
- `GET /api/v1/admin/orders/:id` — detalle con desglose + línea de Stripe + CFDI. Incluye además **dos banderas operativas de back-office** (solo en este detalle admin, **no** en `OrderSummaryDTO` ni en el detalle del cliente): `chargebackNeedsManual: boolean` (un contracargo llegó cuando la carta **ya se había enviado**, hay que pelear la disputa con la guía; ver §9) y `disputeOutcome: "won" | "lost" | null` (resultado del cierre de la disputa Stripe). El enum `OrderStatus` **no cambia**: `won → settled`, `lost → chargeback`; estas banderas dan el matiz que el enum no expresa.
- **v1.21-guest-checkout — pedidos de invitado en M3:** un pedido de invitado se ve **igual** que uno con cuenta
  (PROJECT pregunta abierta v1.5-6: no se crea "usuario fantasma"). El listado y el detalle ganan, **aditivo**:
  `isGuestOrder: boolean` (= `guestEmail != null`), `guestEmail?: string` (contacto operativo de back-office, ya
  protegido por rol — **no** se enmascara, mismo criterio que `AdminSellerRef.email` de §M5), `orderNumber: string`,
  `fulfillmentMode: FulfillmentMode`, `shippingFeeCents: number`, `claimedAt?: string` y
  `shippingAddressSnapshot?: object` (solo `direct_ship`). `userId` **puede venir `null`** — el front de M3 debe
  tolerarlo y mostrar la etiqueta "invitado". Filtro nuevo opcional `?guest=true|false`.
  **Compensación de una disputa de invitado (PROJECT §J / criterio 56b):** se ejecuta como **reembolso aquí**
  (no hay bóveda ni saldo donde abonar una recompra); la evidencia llegó por correo a soporte citando el
  `orderNumber`. *(Supuesto del PO, pregunta abierta v1.5-4.)*
- **`POST /api/v1/admin/orders/:id/chargeback-inventory` (v1.21.2, NUEVO)** — **`vault_operator+`**, **auditado**,
  **NO es money-out** (no mueve dinero: solo resuelve dónde está una carta física). Desenlace **humano** de una
  pieza **congelada** por un contracargo con envío vivo (§4-G.6 / ARCHITECTURE §4.21c-bis). Sin este endpoint una
  pieza congelada se queda congelada para siempre.
  Req: `{ outcome: "recuperada" | "no_recuperada" | "reexpedir", note: string }` (`note` **obligatoria**, 3–500
  chars: es el registro de lo que el operador vio en el estante).
  | `outcome` | Efecto | Precondición |
  |---|---|---|
  | `recuperada` | Cada pieza congelada `picking\|shipped → listed` (o `in_stock` si su precio no resuelve), `ownerType=platform`, + `InventoryMovement reason='chargeback_return'`. Vuelve a la venta **con respaldo físico** | hay ≥1 pieza congelada |
  | `no_recuperada` | **Sin** movimiento de inventario; las piezas se quedan donde están (`shipped`/`delivered`, terminal de venta). La pérdida se refleja en la orden `chargeback` para M7. **No** se marcan `lost`/`damaged` (no fue merma de almacén: ensuciaría los reportes de pérdida) | — |
  | `reexpedir` | Crea un `ShipmentRequest` **nuevo** con la misma forma que el del settle (`orderId`, `userId=null`, `status='picking'`, montos en `0`, `addressSnapshot` de `Order.shippingAddressSnapshot`); las piezas siguen en `picking` | **solo** si `Order.status='settled'` y `disputeOutcome='won'` (ganamos la disputa) y hay pieza congelada |
  Los tres desenlaces dejan **`chargebackNeedsManual=false`** y un `AuditLog`
  (`action: 'order.chargeback_inventory'`, con `outcome` y `note` en `after`).
  Res `200`: `{ orderId, outcome, inventoryItemIds: string[], shipmentId?: string, chargebackNeedsManual: false }`.
  Err: `404 NOT_FOUND`; `400 VALIDATION_ERROR` (`note` ausente/corta, `outcome` inválido, o la orden no es
  `direct_ship`); **`409 CONFLICT`** si el `outcome` no aplica al estado actual — `reexpedir` con la orden todavía
  en `chargeback`, o **cualquier** `outcome` sobre una orden con `chargebackNeedsManual=false` (ya resuelta). Esto
  último **es** la regla de idempotencia: repetir un `outcome` ya aplicado devuelve `409` y **no** duplica
  movimientos de inventario ni envíos.
  > **`409` y no `422` (ratificado en v1.21.2; ARCHITECTURE §4.21c-bis decía `422` por errata y ya está corregido):**
  > el cuerpo `{outcome, note}` está **bien formado y es válido** —no hay nada que el cliente pueda corregir en la
  > entrada—; el obstáculo es **el estado del recurso**, que es la definición de `409`. Consistente con la
  > convención del proyecto (`409` = conflicto de estado: `ITEM_UNAVAILABLE`, `ITEM_IN_ANOTHER_SHIPMENT`,
  > `ALREADY_AUTHENTICATED`; `422` = rechazo de la entrada: `PRICE_PENDING`, `ADDRESS_NOT_MX`,
  > `VAULT_REQUIRES_ACCOUNT`) y con el `409` que este mismo endpoint ya usa para "orden ya resuelta".
  > **UI OBLIGATORIA (requisito pendiente, dueño: WS «Admin y auditoría»):** este endpoint crea un estado que
  > **solo un humano cierra**, y hoy **no hay pantalla** que lo exponga (`chargebackNeedsManual` no se consume en el
  > front). Sin la cola visible + el formulario de desenlace, la pieza congelada **se queda congelada** y el
  > inventario se degrada en silencio. Ver ARCHITECTURE §4.21c-bis › «Requisito pendiente».
- `POST /api/v1/admin/orders/:id/refund` — **`super_admin`** — Req `{ reason }` + `Idempotency-Key` → reembolso Stripe, Order `→refunded`. Err `403 MONEY_OUT_FORBIDDEN` para operador. **Reembolso EXCEPCIONAL** (política VENTAS FINALES): no hay reembolso voluntario. La excepción legítima es un **error de la plataforma** (p. ej. cobro doble, inventario fantasma), que **siempre** se reembolsa. **NO** re-agrega el item al inventario. (La política de negocio completa vive en `PROJECT.md`.)

### M4 — Retiros / envíos (`vault_operator+`)
> **v1.21-guest-checkout — la cola de M4 pasa a tener dos tipos de envío.** Cada fila/detalle gana, **aditivo**:
> `kind: "vault_withdrawal" | "guest_direct_ship"` (**v1.21.2 — derivación normativa:** `orderId == null` ⇒
> `vault_withdrawal`; si `orderId != null`, el valor se resuelve **leyendo `Order.fulfillmentMode`** de la orden
> vinculada, **no** asumiendo `direct_ship` por el mero hecho de tener `orderId`. `fulfillmentMode` es el **único
> discriminador canónico** de ruta de fulfillment; un modo no soportado **lanza y se loguea**, nunca cae por default
> en la rama de envío directo — ver ARCHITECTURE §4.21d), `orderId?`,
> `orderNumber?`, `guestEmail?` y `recipientName?` (del snapshot). `userId` **puede venir `null`** (envío directo de
> invitado); el filtro `?userId=` sigue funcionando y simplemente no devuelve envíos de invitado. Filtro nuevo
> opcional `?kind=`. **La máquina de estados, el picking list y la captura de guía son IDÉNTICOS** para ambos tipos
> — el operador trabaja igual; lo único que cambia es la **transición terminal** (abajo). El envío directo **nace en
> `picking`** (ya pagado dentro de la orden), así que **nunca** aparece en `solicitado`.
- `GET /api/v1/admin/shipments` — cola. `?status=&userId=&page=`
  - **`userId?` (v1.7-admin-users, NUEVO):** filtra por `ShipmentRequest.userId` (simetría con `GET /admin/orders`). Alimenta la ficha 360° del usuario. Paginado; mismo guard y misma proyección que sin filtro.
- `GET /api/v1/admin/shipments/:id`
- `GET /api/v1/admin/shipments/picking-list` — **lista de picking ordenada por ubicación** (`?date=` opcional) → items con `folio` + `location.label`.
- `PATCH /api/v1/admin/shipments/:id/status` — Req `{ to: ShipmentStatus }` (transiciones `solicitado→picking→guia→enviado→entregado`).
  - **v1.21 — RAMIFICACIÓN OBLIGATORIA por tipo de envío (`orderId == null`?):**
    - **Retiro de bóveda (`orderId == null`)** → comportamiento v1.17 **sin cambio alguno**: los pasos
      `solicitado→enviado` no tocan el item, y `entregado` hace `in_custody → withdrawn` (+ movimiento `withdrawal`).
    - **Envío directo de invitado (`orderId != null` **y** `Order.fulfillmentMode='direct_ship'` — v1.21.2: se
      **resuelve leyendo el modo**, no se asume por tener `orderId`)** → **dos** transiciones del item, ambas por `status`
      (el item es `ownerType='platform'` todo el tiempo): al pasar a **`enviado`** ⇒ `picking → shipped`
      (+ `InventoryMovement`); al pasar a **`entregado`** ⇒ `shipped → delivered` (+ `InventoryMovement`).
      **`delivered` es la terminal de una venta con envío directo; NUNCA `withdrawn`** (`withdrawn` significa
      "salió de la bóveda de un cliente", y este pedido jamás estuvo en bóveda). `deliveredAt` ancla la ventana de
      **7 días** de disputa que la vista pública muestra al invitado (§4-G.3). Ver ARCHITECTURE §4.21c.
  - **v1.17 — efecto sobre el inventario al llegar a `entregado`:** al transicionar el envío a **`entregado`**, cada `InventoryItem` de sus `ShipmentItem` pasa **`in_custody → withdrawn`** (única escritura persistente del ciclo de envío; los pasos `solicitado→enviado` **no** tocan el item). Se registra un `InventoryMovement` `reason='withdrawal'`. Efecto observable: el item **sale de "Mi Bóveda"** (`GET /vault/holdings` excluye `withdrawn`) y **deja de contar** en el portafolio. El item conserva `ownerType=customer, ownerUserId, ownershipStatus=settled` (registro histórico de titularidad; solo cambia `status`). Es la contraparte de la señal de contracargo del §9 (que ya usaba el join `ShipmentItem`+envío `enviado/entregado` para saber si la carta salió físicamente).
- `POST /api/v1/admin/shipments/:id/tracking` — Req `{ carrier, trackingNumber, shippingCostCents? }` → avanza a `guia`.
  - **`shippingCostCents?` (v1.4-finance, NUEVO):** costo real que **la plataforma paga a la paquetería** por este envío (MXN centavos). **Distinto** de `ShipmentRequest.shippingFeeCents` (ingreso cobrado al cliente). **Opcional** (si se omite, no se modifica; el valor persistido arranca en `0` por default de columna, M-16) y **editable** re-invocando este endpoint (idempotente sobre carrier/tracking; no regresa el estado si ya está en `guia`/posterior). **Validación:** entero **≥ 0** (`422 VALIDATION_ERROR` si negativo o no entero). Alimenta el P&L de M7 (se resta, acotado por `pickingAt`). Queda en `AuditLog` (`action: shipment.tracking`, con `carrier`/`trackingNumber`/`shippingCostCents` en `after`).
  - Nota: `shippingCostCents` es un dato **interno de costo**; **no** se expone al cliente (`GET /shipments/:id` del comprador NO lo incluye).

### M5 — Buylist (`vault_operator` hasta verificación; `super_admin` pago SPEI)
- `GET /api/v1/admin/buylist` — cola `?status=&userId=&q=&from=&to=&minCents=&maxCents=&page=&pageSize=`
  - **`userId?` (v1.7-admin-users, NUEVO):** filtra por `SellRequest.userId` (simetría con `GET /admin/orders`). Alimenta la ficha 360° del usuario. Paginado; mismo guard y misma proyección PII por rol (la CLABE sigue enmascarada; en claro solo por `reveal-clabe`).
  - **Orden (v1.18-buylist-rejects, NORMA):** **`createdAt` desc** (solicitud más reciente primero). El código previo ordenaba `asc`; backend lo alinea en este stream. Cada fila ya expone `createdAt`.
  - **v1.25-buylist-orders-pagination (§M5, TODOS aditivos y opcionales — omitidos = comportamiento de HOY):** el front deja de traer la lista completa y filtrar en memoria; pide server-side la pestaña «Cerradas» paginada + filtrada. Respuesta sin cambios: `{ data, page, pageSize, total }` (mismo `AdminBuylistDTO[]`).
    - **`status` — pasa a aceptar LISTA CSV (aditivo, la opción más simple):** `status=pagada,rechazada,abandonada` filtra por **cualquiera** de esos estados (`SellRequestStatus IN (...)`). Así la pestaña «Cerradas» (que agrupa `pagada|rechazada|abandonada`) se pide en UNA llamada server-side. **Compat total:** un solo valor (`status=verificacion`) se comporta **idéntico a hoy** (es el caso `IN` de un elemento); **omitir `status` = SIN filtro de estado = HOY.** Cada token debe ser un `SellRequestStatus` válido; token desconocido → `400 VALIDATION_ERROR` (`details.invalidStatus`). Se descartó un parámetro/alias nuevo (`closed=true`): CSV es aditivo sobre un parámetro que ya existe y no añade vocabulario.
    - **`q?: string` (búsqueda server-side, sustituye el buscador client-side):** contains **case-insensitive** sobre **folio** (`SellRequest.id`) y **vendedor** (`User.name`, `User.email` vía el join que ya existe para `seller`). Semántica OR entre campos (la fila hace match si `q` aparece en cualquiera). Trim; `q` vacío/whitespace = **ausente** (sin filtro). Máx **200** chars (más largo → `400 VALIDATION_ERROR`). Sustituye 1:1 el filtro de `M5View` (`id | userId | seller.name | seller.email`); `userId` como identificador exacto sigue disponible por el parámetro `userId=`.
    - **`from?` / `to?` (rango de fecha, ISO-8601):** sobre `createdAt`, **`gte`/`lte`** — **misma semántica que `GET /admin/orders`**. **Borde de día (v1.25.1, §Convenciones):** un valor **date-only** (`YYYY-MM-DD`) se ancla al borde del día en UTC — `from` = `00:00:00.000Z`, `to` = fin de día **INCLUSIVO** `23:59:59.999Z` — así `to` **incluye** las solicitudes cerradas ese mismo día (caso de uso del PO en la pestaña «Cerradas»); un datetime ISO completo se usa tal cual. Fecha no parseable → `400 VALIDATION_ERROR`.
    - **`minCents?` / `maxCents?` (rango de MONTO, enteros ≥ 0):** aplican sobre **`quotedTotalCents`** — `gte minCents`, `lte maxCents`. **Por qué `quotedTotalCents` y NO `approvedTotalCents`:** `quotedTotalCents` es `Int @default(0)` — **siempre existe** para toda solicitud (snapshot histórico de la cotización), mientras que `approvedTotalCents` es **nullable** y sólo se puebla tras aprobar/ajustar; filtrar por él **excluiría** justo las solicitudes `rechazada`/`abandonada` (sin aprobado) que dominan la pestaña «Cerradas», rompiendo el caso de uso del PO. `quotedTotalCents` también es estable (el rechazo por-ítem NO lo recalcula — BL-1). **No** se ofrece filtro por `approvedTotalCents` en esta versión (si el PO lo pide luego, sería un par de params separados, aditivo). No negativo / no entero / `maxCents < minCents` → `400 VALIDATION_ERROR`.
    - **`pageSize`:** default **20 SIN CAMBIOS** (subirlo cambiaría el tamaño de respuesta de consumidores actuales = ruptura silenciosa); el front pide **`pageSize=25`** (sugerencia del PO). Máx **100** sin cambios. Paginación inválida → `400 VALIDATION_ERROR`.
    - **Seguridad (documentada; el guard es del backend):** el listado ya está tras rol `vault_operator`/`super_admin`. `q`/`from`/`to`/`minCents`/`maxCents` **sólo REDUCEN** el conjunto que el rol ya puede ver — no hay IDOR ni enumeración cruzada nueva (no saltan el guard, no cambian el shape ni la proyección PII). `q` **NO** busca sobre CLABE/RFC/INE (datos cifrados/enmascarados): evita convertir el buscador en un oráculo de enumeración sobre PII sensible. La CLABE sigue enmascarada; en claro sólo por `reveal-clabe`.
  - **`seller` (v1.18-buylist-rejects, NUEVO):** cada fila gana **`seller: AdminSellerRef = { id, name, email }`** (join a `User`; `seller.id === userId`). `userId` se **conserva** (compat). La UI de M5 muestra **nombre + correo** como identidad primaria y relega el UUID a tooltip/detalle. **PII:** back-office protegido por rol (`vault_operator`/`super_admin`); el **correo del vendedor es dato de contacto operativo — NO es la CLABE** y por tanto **no** requiere enmascarado ni reveal auditado. El régimen de la CLABE **no cambia**.
- `GET /api/v1/admin/buylist/:id` — detalle con items y estados. La CLABE del vendedor se expone **enmascarada** como `clabeMasked` (`****1234`); **nunca** el snapshot cifrado ni la CLABE en claro. Para pagar, el súper-admin usa `reveal-clabe` (ver abajo).
  - **`seller` (v1.18-buylist-rejects, NUEVO):** el detalle gana el mismo **`seller: AdminSellerRef`** que el listado. Los `items` (`SellItemDTO`, §11) incluyen los campos de rechazo (`rejectionReason`, `rejectedAt`, `returnDeadlineAt`, `abandonDeadlineAt`) cuando aplique.
- `GET /api/v1/admin/buylist/:id/reveal-clabe` — **`super_admin`** — **money-out, auditado**. Descifra y devuelve la **CLABE completa (18 dígitos)** para que el súper-admin la **copie a su banca al ejecutar el SPEI**. Es el **ÚNICO** punto del contrato que devuelve la CLABE en claro; cada llamada queda registrada en `AuditLog` (`action: buylist.reveal_clabe`, quién/cuándo/qué solicitud). Si el `clabeSnapshot` de la solicitud falta, **cae a la CLABE de KYC** del usuario.
  Res `200`: `{ sellRequestId, clabe }` (`clabe` = 18 dígitos en claro). Err `403 MONEY_OUT_FORBIDDEN` (operador/cliente), `404 NOT_FOUND`, `422 CLABE_UNAVAILABLE` (sin snapshot ni CLABE de KYC).
- `POST /api/v1/admin/buylist/:id/receive` — marca recepción física → `recibida`.
- `POST /api/v1/admin/buylist/:id/verify` — inicia/registra verificación → `verificacion`.
- `PATCH /api/v1/admin/buylist/items/:itemId/decision` — **cherry-pick** — Req `{ decision: "approve" | "adjust" | "reject", approvedPriceCents?, reason? }` → actualiza `SellItemStatus`. `adjust` fija `adjustmentSentAt` (dispara plazo de 7 días).
  > **v1.18-buylist-rejects — semántica COMPLETA de `decision:"reject"`:**
  > - **`reason: string` — OBLIGATORIO con `reject`** (3–500 chars; falta/vacío → `400 VALIDATION_ERROR`). Motivo del
  >   rechazo (típicamente "no es NM: …", PROJECT §H). Se persiste en `SellRequestItem.rejectionReason`, va al
  >   `AuditLog` (`buylist.item.reject`, en `after`) y es el motivo que recibe el vendedor por correo. Para
  >   `approve`/`adjust` se **ignora** (no se persiste).
  > - **Efectos:** `itemStatus → rechazada`; fija **`rejectedAt = now()`** (ancla única de plazos); pone
  >   **`approvedPriceCents = null`** y recalcula `approvedTotalCents` (`recomputeApprovedTotal`). **INVARIANTE
  >   (norma):** un ítem `rechazada` **jamás** suma en `SellRequest.approvedTotalCents` — el rechazo lo SACA del total
  >   de la orden aunque antes hubiera sido aprobado/ajustado (cierra la secuencia approve→reject con monto fantasma;
  >   desviación BL-1, ARCHITECTURE §9). `quotedTotalCents` no se toca (snapshot histórico).
  > - **Plazos (derivados, server-side):** `returnDeadlineAt = rejectedAt + 7d` (gestionar devolución **a costo del
  >   usuario**) y `abandonDeadlineAt = rejectedAt + 30d` (abandono). NO son columnas; se computan al proyectar
  >   (mismas constantes 7d/30d que `buylist-sweep`). No hay transición automática del ÍTEM al vencer (informativo;
  >   el sweep a nivel SOLICITUD no cambia).
  > - **Idempotencia:** `reject` sobre un ítem ya `rechazada` = **no-op** (200 con estado actual; no re-fija
  >   `rejectedAt`, no re-envía correo).
  > - **Auto-transición de la SOLICITUD (v1.24-buylist-request-reject — cierra P-4):** como **efecto de `reject`, TRAS el
  >   recompute** de `approvedTotalCents`, se re-evalúa `SellRequest.status`: si **TODOS** los ítems de la solicitud
  >   quedan `itemStatus="rechazada"` (no queda NINGÚN ítem en estado no-rechazado), la solicitud transiciona a
  >   `status="rechazada"` sellando **`closedAt = now()`** (terminal, patrón SEC-D2). **Guard:** **no pisa estados
  >   terminales** (`pagada`/`rechazada`/`abandonada`) — si ya es terminal, no-op silencioso. **`convertida_inventario`
  >   NO cuenta como rechazado:** un ítem convertido a inventario es un desenlace no-rechazado, así que si conviven ítems
  >   `convertida_inventario` y `rechazada` la solicitud **NO** se auto-rechaza. **Regla exacta:** se auto-rechaza **sólo
  >   si TODO ítem** de la solicitud tiene `itemStatus="rechazada"` (∅ ítems no-rechazados). Antes de este fix el
  >   back-office rechazaba el único ítem y la solicitud se quedaba atorada en `verificacion` (P-4). El cierre a nivel
  >   solicitud **NO toca montos** (BL-1 ya lo garantiza vía el recompute) **ni envía correos** (el correo por-ítem ya
  >   salió). Idempotente por construcción (un `reject` no-op no re-dispara; una solicitud ya `rechazada` no se re-sella).
  > - **Correo al vendedor (best-effort, POST-commit):** al transicionar a `rechazada` se envía correo al dueño de la
  >   solicitud (`User.email`, idioma por `User.locale` ES/EN) con: **qué carta** (nombre, set, número), **acabado**,
  >   **motivo** (`reason`) y **opciones con plazos**: devolución antes de `returnDeadlineAt` (a costo del usuario,
  >   coordinada con el **buzón de soporte resuelto por configuración** —`SUPPORT_EMAIL`, en cascada a
  >   `DISPUTE_EVIDENCE_CONTACT`; p. ej. `soporte@tcghunt.mx`, §0) o abandono en `abandonDeadlineAt`. **PROHIBIDO** en el correo: CLABE (ni
  >   enmascarada), montos/estado de OTROS ítems, datos de terceros. **El fallo del envío NO revierte la decisión ni
  >   falla el request** (se loggea; sin reintento en MVP — deuda registrada). Mecanismo: `buylist` inyecta el puerto
  >   global `MAIL_PORT` con plantilla local al módulo (ARCHITECTURE §4.18; el módulo `mail` NO se toca).
- **`GET /api/v1/admin/buylist/rejected-items` (v1.18-buylist-rejects, NUEVO)** — `vault_operator`/`super_admin` — pestaña «Rechazadas» de M5: listado paginado **transversal** (todas las solicitudes) de ítems `itemStatus="rechazada"`.
  Query: `?userId=&page=&pageSize=` (`userId?` filtra por vendedor, simetría F1; `pageSize` ≤ 100).
  Res `200`: `{ data: RejectedSellItemDTO[], page, pageSize, total }` (§11) — cada fila trae `seller`, `card`, `finish`, `quotedPriceCents`, `reason`, `rejectedAt`, `returnDeadlineAt`, `abandonDeadlineAt` y `sellRequestId` (deep-link al detalle). **Orden:** `rejectedAt` **desc** (legacy sin `rejectedAt` al final). La fase (en ventana de devolución / en ventana de abandono / abandonada) la **deriva el front** comparando `now` contra las dos fechas — no se persiste ni se expone como campo.
  Err: `400 VALIDATION_ERROR` (paginación inválida), `403`.
- `POST /api/v1/admin/buylist/items/:itemId/convert-to-inventory` — **un clic** → crea `InventoryItem` (`acquisitionType=buylist`, **`finish` heredado del `SellRequestItem.finish`**, v1.6-finish), item `→convertida_inventario`.
  > **v1.18-buylist-rejects — NORMA para ítems RECHAZADOS:** un ítem `rechazada` **NUNCA es convertible** a
  > inventario — **ni siquiera tras vencer** `returnDeadlineAt`/`abandonDeadlineAt`. Base: PROJECT criterio 16 — el
  > rechazo es por no-NM y "una carta **no-NM abandonada NO entra al inventario vendible**" (la carta queda retenida
  > físicamente hasta su devolución o abandono, pero jamás se vuelve vendible). La guardia existente (**solo**
  > `itemStatus="aprobada"` convierte → `422 ITEM_NOT_APPROVED` con `details.itemStatus`) **es la norma**; el caso "NM
  > abandonada pasa a inventario" aplica a ítems **aprobados** cuya solicitud se abandonó (clic del admin sobre el ítem
  > `aprobada`; deuda BE-3 para automatizarlo), nunca a `rechazada`. Reintento sobre ítem ya convertido sigue siendo
  > idempotente (`alreadyConverted:true`).
- **`POST /api/v1/admin/buylist/:id/reject` (v1.24-buylist-request-reject, NUEVO)** — `vault_operator`/`super_admin` (mismo guard que el resto de §M5 hasta verificación; **NO** es dinero saliente → sin `MoneyOutGuard`), **auditado** (`action: buylist.reject`). Botón «Rechazar solicitud» de M5: **cierre EXPLÍCITO** de una solicitud a estado terminal `rechazada`. Cubre el caso operativo que la auto-transición no alcanza: solicitudes **ya atoradas** cuyo(s) ítem(es) fueron rechazados **antes** del fix P-4 (o rechazadas por otra vía sin sellar la solicitud).
  Req: `{ reason?: string }` — `reason` **opcional** (0–500 chars), motivo interno del cierre a nivel solicitud; **NO PII**, va al `AuditLog` (`after`), no se expone al cliente ni al correo (no hay correo en este flujo). Body vacío `{}` es válido.
  > **Semántica SEGURA y mínima (norma):**
  > - **Guard de precondición:** cierra **sólo si TODOS** los ítems de la solicitud ya están `itemStatus="rechazada"`. Si queda **algún** ítem no-rechazado (`aprobada`, `ajustada`, `convertida_inventario`, `verificacion`, etc.) → **`422 REQUEST_HAS_NON_REJECTED_ITEMS`** (`details.nonRejectedItemStatuses: SellItemStatus[]`). El botón **no** rechaza ítems en cascada: el rechazo por-ítem es cherry-pick (`PATCH /admin/buylist/items/:itemId/decision`, `decision:"reject"`), y esa ruta ya dispara la auto-transición.
  > - **Efecto ÚNICO:** `SellRequest.status → rechazada` + **`closedAt = now()`** (terminal, SEC-D2). **NO mueve dinero, NO reevalúa montos por ítem** (`approvedTotalCents`/`quotedTotalCents` intactos; BL-1 ya sacó los montos de los ítems rechazados), **NO manda correos** (los correos por-ítem ya salieron al rechazar cada carta).
  > - **Idempotencia:** si la solicitud ya está `rechazada` → **`200` con el estado actual** (no re-sella `closedAt`, no re-audita como cambio). Sobre otro estado terminal (`pagada`/`abandonada`) → **`422 REQUEST_HAS_NON_REJECTED_ITEMS`** no aplica; se rechaza el cierre con `409 CONFLICT` (`details.status`) por invariante «no pisar terminal» (una solicitud `pagada` jamás se reescribe a `rechazada`).
  Res `200`: la `SellRequest` actualizada (mismo shape que `GET /admin/buylist/:id`: `status="rechazada"`, `closedAt` sellado, `seller`, `items` con sus campos de rechazo).
  Err: `403 FORBIDDEN` (cliente), `404 NOT_FOUND` (solicitud inexistente), `422 REQUEST_HAS_NON_REJECTED_ITEMS` (queda ítem vivo), `409 CONFLICT` (solicitud en otro estado terminal `pagada`/`abandonada`).
- `POST /api/v1/admin/buylist/:id/pay-spei` — **`super_admin`** — Req `{ speiReference }` + `Idempotency-Key` → registra pago manual, request `→pagada`. Err `403 MONEY_OUT_FORBIDDEN`. Precondición: `aprobada` + verificada (pago **tras** recepción/verificación).

### M6 — Usuarios / KYC (`super_admin`; `vault_operator` lectura limitada)
> **Estado v1.3: YA EXISTE en backend** (`AdminUsersController` + `AdminService.listUsers/getUser/updateUserKyc/updateUserStatus`). No requiere backend nuevo; falta **consumo de frontend** (M6 es `ModuleTodo` en UI). Shapes confirmados contra el código: el **listado** es paginado `{ data, page, pageSize, total }` con `data: { id, email, name, role, status, createdAt }[]` y filtros `q` (email/name) + `status`; la **ficha 360°** (`GET /admin/users/:id`) incluye `kycProfile` (CLABE/RFC **enmascarados** incluso para `super_admin`; `ineOnFile: boolean`), `billingProfile` (RFC enmascarado; `null` para `vault_operator`), `addresses`, `orders` (últimas 20), `sellRequests` (20), `disputes` (20) y `ownedItems` (bóveda). El `vault_operator` recibe **proyección reducida** (sin RFC/INE/billing).
- `GET /api/v1/admin/users` — `?q=&status=&page=`
- `GET /api/v1/admin/users/:id` — **ficha 360°** (compras, bóveda, buylist, disputas, KYC). La CLABE y el RFC se devuelven **enmascarados también para `super_admin`** (`clabeMasked` = `****1234`, `rfcMasked` = parcial); la CLABE en claro solo por `reveal-clabe`. Para `vault_operator` se mantiene la proyección reducida de SEC-A4 (sin CLABE/RFC/INE keys ni billing profile; `ineOnFile` booleano).
  > **F1 (v1.7):** la ficha `getUser` **no se engorda**. El historial completo se arma por **reuso** de los listados admin ya paginados con `?userId=` (envíos §M4, buylist §M5, disputas §M8, órdenes §M3 — todos con `?userId=`) + el nuevo `GET /admin/users/:id/audit` (abajo). `getUser` sigue trayendo solo las últimas 20 de orders/sellRequests/disputes + bóveda como resumen.
  > **BE-10 (v1.8-ronda-c):** la bóveda resumen (`ownedItems: AdminUserOwnedItemRef[]`) gana **`finish: Finish`** y **`referenceValue: PriceInfo`** por ítem, para que la pestaña "Bóveda" muestre acabado y valor (antes solo carta + folio + titularidad). El backend puebla `referenceValue` **reusando la misma valuación por-acabado** del `HoldingDTO` del cliente (`getReference(cardId, productType, gradeKey, finish)`, §3); los items sin precio del día llevan `referenceValue.status="pending"` (no se excluyen — es vista 360°, no un total de portafolio). Es un **enriquecimiento de proyección** (sin migración); ver `AdminUserOwnedItemRef` en §11.
- `PATCH /api/v1/admin/users/:id/kyc` — **`super_admin`** — Req `{ kycStatus, capPerRequestCents?, capPerMonthCents? }`.
- `PATCH /api/v1/admin/users/:id/status` — **`super_admin`** — Req `{ status: "active" | "blocked" }`.

#### Alta de usuario por rol desde admin (v1.7-admin-users — NUEVO backend)
> Hoy no existe alta de usuarios en back-office: los clientes se **auto-registran** como `customer` y el staff
> (`vault_operator`/`super_admin`) se crea por **seed**. Este endpoint permite al súper-admin crear cuentas de
> **cualquier rol** desde M6. **No** captura KYC/CLABE/INE (esos son datos self-service del propio usuario).
- `POST /api/v1/admin/users` — **`super_admin`**, **auditado** (`action: user.create`). **NO es dinero saliente** (sin `MoneyOutGuard`).
  Req:
  ```json
  { "email": "string (IsEmail; se lowercasea)", "name": "string (required)",
    "role": "customer | vault_operator | super_admin",
    "password": "string? (>= 8; si se omite, el backend autogenera una temporal de alta entropía)",
    "phone": "string?", "locale": "es | en? (default es)" }
  ```
  - `email`: se **lowercasea** antes de persistir/validar unicidad (mismo trato que `/auth/register`).
  - `name`: **requerido** (columna `User.name` es NOT NULL).
  - `role`: `@IsIn(customer | vault_operator | super_admin)`. Crear `vault_operator`/`super_admin` es alta de staff.
  - `password?`: si se **provee**, aplica la política de `/auth/register` (`MinLength 8`); si se **omite**, el backend
    **autogenera** una contraseña temporal de **alta entropía** (patrón `randomBytes(18).base64url` del reset M-15) y
    la devuelve **una sola vez** en `tempPassword`. El admin la comparte por su propio canal (paridad con
    `POST /admin/users/:id/reset-password`; **no** se envía correo).
  Res `201`:
  ```json
  { "user": { "id": "…", "email": "…", "name": "…", "role": "vault_operator",
              "locale": "es", "status": "active", "emailVerified": true,
              "authProvider": "local", "createdAt": "…" },
    "tempPassword": "string?",  // SOLO si se autogeneró (no viene si el admin envió password)
    "mustChangePassword": true } // true SOLO cuando la contraseña fue autogenerada
  ```
  - `user`: **shape público** (sin `passwordHash`), superset del `publicUser` de auth.
  - **Decisiones (defaults):**
    - **`emailVerified`**: staff (`vault_operator`/`super_admin`) nace **`true`** (como el seed); el `customer`
      creado por admin **también** nace **`true`** (el admin da fe de la identidad; **no** se dispara correo de
      verificación). `authProvider='local'`.
    - **`mustChangePassword`**: **`true`** cuando la contraseña es **autogenerada** (fuerza el cambio en el próximo
      login, patrón M-15). **`false`** cuando el admin **provee** una password explícita.
  - Errores: `409 EMAIL_TAKEN` (unicidad de email, P2002), `422 VALIDATION_ERROR` (rol/email inválidos o password
    débil), `403 FORBIDDEN` (rol distinto de `super_admin`).
  - **Seguridad:** solo `super_admin` puede crear cuentas — crear un `super_admin` es **escalada de privilegios**, y
    el control es precisamente **super_admin-only + auditoría** (`user.create` con `actorUserId`/`entityId`/`role`
    en `after`; la **contraseña temporal NUNCA** se registra en `AuditLog` ni en logs, como en `user.reset_password`).

#### Actividad / auditoría por usuario (v1.7-admin-users — NUEVO backend)
> Complementa la ficha 360° para servicio al cliente: la traza de acciones **sobre** el usuario (y opcionalmente
> **del** usuario) desde `AuditLog`, paginada, sin filtrar PII sensible.
- `GET /api/v1/admin/users/:id/audit` — **`super_admin`** (completo) **y `vault_operator`** (proyección reducida). Paginado.
  Query: `?scope=target|actor|both&page=&pageSize=`
  - `scope` (default **`target`**):
    - `target`: `entityType='User' AND entityId=:id` — acciones **sobre** el usuario (`user.create`, `user.kyc.update`,
      `user.status.update`, `user.reset_password`, `user.delete`, `auth.email_verification_sent`, `auth.google_link`, …).
    - `actor`: `actorUserId=:id` — acciones **realizadas por** el usuario.
    - `both`: OR de ambas.
  Res `200`: `{ data: UserAuditEntryDTO[], page, pageSize, total }` (`orderBy createdAt desc`).
  - **Proyección expuesta** (`UserAuditEntryDTO`): `id, actorUserId, actorRole, action, entityType, entityId, createdAt`,
    y **`ip` SOLO para `super_admin`**.
  - **NUNCA se exponen `before`/`after`** (pueden contener PII/estado sensible; misma regla que ARCHITECTURE §3.2 —
    "PII/secretos nunca en before/after", y el DTO no los devuelve para evitar filtrado incluso de los que sí traen datos).
  - **Roles / proyección:** `super_admin` → proyección completa (incluye `ip`). `vault_operator` → **reducida** (mismos
    campos **sin `ip`**; el `ip` es dato investigativo/seguridad reservado al súper-admin).
  - Err: `403 FORBIDDEN` (rol < `vault_operator`), `404 NOT_FOUND` (usuario inexistente).

#### Reset de contraseña por admin — SIN correo (v1.3.1 — NUEVO backend)
> La plataforma **no tiene email transaccional** en el MVP. El súper-admin restablece la contraseña desde M6 y
> **entrega la credencial temporal al usuario por su propio canal** (verbal/whatsapp/etc.). La contraseña
> temporal **solo se devuelve en la respuesta de esta llamada** (nunca se re-consulta ni se loguea).
- `POST /api/v1/admin/users/:id/reset-password` — **`super_admin`**, **auditado**.
  Req: `{}` (sin body). El backend **genera una contraseña temporal segura** (aleatoria, alta entropía), la
  **hashea con argon2** (mismo mecanismo que `/auth/register`) y la persiste en `User.passwordHash`. Devuelve la
  contraseña temporal **en claro una única vez** para que el admin la comparta.
  - **Invalida sesiones previas:** rota el secreto/versión de refresh del usuario para **revocar los refresh
    tokens vigentes** (el usuario debe re-loguearse con la temporal). Si el repo aún no versiona refresh tokens,
    queda como nota de implementación (BE); ver ARCHITECTURE §4.7bis.
  - **Forzar cambio en próximo login (opcional):** marca `User.mustChangePassword=true` si el patrón del repo lo
    soporta; el front, tras loguear, redirige a "cambiar contraseña". Si no se implementa el flag, la temporal es
    una contraseña válida normal (nota BE, no bloquea).
  - Efecto colateral: una cuenta **solo-Google** (`passwordHash=null`) queda con contraseña utilizable (habilita
    login local además del de Google).
  Res `200`: `{ userId, tempPassword: string, mustChangePassword: boolean }`
  - **Seguridad:** solo `super_admin` (`403 FORBIDDEN` para otros); la contraseña **no** se registra en
    `AuditLog` ni en logs — el `AuditLog` guarda solo `action=user.reset_password` + `actorUserId` + `entityId`
    (quién reseteó a quién y cuándo), **nunca** el valor. No es dinero saliente (no requiere `MoneyOutGuard`).
  Err: `403 FORBIDDEN`, `404 NOT_FOUND`, `422 USER_DELETED` (no se resetea una cuenta ya soft-deleted).

#### Eliminar usuario — híbrido hard/soft (v1.3.1 — NUEVO backend)
> Cumple integridad contable/legal: si el usuario tiene historial económico, **no** se borra; se **anonimiza** y
> se deshabilita. Si no lo tiene, se borra en duro. Respeta el enmascarado de PII existente (§3.4).
- `DELETE /api/v1/admin/users/:id` — **`super_admin`**, **auditado**.
  **Determinación "¿tiene transacciones?"** (cualquiera verdadera ⇒ **soft**): existe al menos un registro
  relacionado en `Order`, `SellRequest`, `ShipmentRequest`, `Dispute`, o `InventoryItem` con
  `ownerUserId = :id` (bóveda, cualquier titularidad). `Address`/`BillingProfile`/`KycProfile`/`PortfolioSnapshot`
  por sí solos **no** cuentan como historial económico (se borran/anonimizan en ambos modos).
  - **HARD delete** (sin historial económico): borra el `User` y sus dependientes por cascada
    (`KycProfile`/`BillingProfile`/`Address`/`PortfolioSnapshot` — `onDelete: Cascade`). Purga también las
    imágenes de INE del object storage (reutiliza el job/rutina de purga de INE, §3.4d).
  - **SOFT delete** (con historial económico): **no** borra filas económicas. Marca la cuenta como eliminada y
    **anonimiza la PII**:
    - `status="deleted"` (nuevo valor de `UserStatus`), `deletedAt=now()`, `anonymizedAt=now()`.
    - `email` → placeholder único no reversible (ej. `deleted+<uuid>@anon.invalid`), `name` → `"Usuario eliminado"`,
      `phone`/`avatarUrl`/`googleId` → null, `passwordHash` → null (no puede iniciar sesión), refresh tokens revocados.
    - PII sensible: `KycProfile` y `BillingProfile` → borra `clabeEnc`/`clabeHmac`/`rfcEnc`/`legalName` y purga
      imágenes de INE (`ineFrontKey`/`ineBackKey` → null + borrado en storage); conserva solo metadatos no-PII
      necesarios para conciliación. `Address` → borrada o reducida a datos no identificatorios si algún envío la referencia por snapshot.
    - **Se conservan** `Order`/`SellRequest`/`ShipmentRequest`/`Dispute` y los `InventoryItem` (bóveda) por
      integridad contable/auditoría; su `userId`/`ownerUserId` sigue apuntando al `User` anonimizado (no se
      reasigna). Los snapshots económicos (`billingSnapshot`, `clabeSnapshot`) **no** se alteran retroactivamente
      salvo que política legal lo exija (nota para seguridad/legal).
  - **Login bloqueado:** `POST /auth/login` y `POST /auth/google` rechazan una cuenta `status="deleted"` con
    `403 USER_BLOCKED` (mismo code que bloqueado; no revela el motivo).
  Res `200`: `{ userId, mode: "hard" | "soft" }`
  - **Seguridad/idempotencia:** solo `super_admin` (`403 FORBIDDEN`). No es dinero saliente, pero **sí** toca PII;
    **auditado** (`AuditLog action=user.delete`, con `mode`, `actorUserId`, `entityId`; **sin** volcar PII en
    `before`/`after` — solo IDs/flags). Re-`DELETE` sobre una cuenta ya soft-deleted → `200 { mode: "soft" }` (no-op idempotente).
  Err: `403 FORBIDDEN`, `404 NOT_FOUND`, `409 CANNOT_DELETE_SELF` (un súper-admin no se borra a sí mismo).

### M7 — Finanzas (`super_admin`)
> **Estado v1.3: YA EXISTE en backend** (`AdminFinanceController` + `AdminService.pnl/inventoryValue/custodyValue/ivaReport/exportCsv`). No requiere backend nuevo. **Consumo de frontend: YA EXISTE** — `admin/m7/M7View.tsx` (montado vía `admin/m7/page.tsx`) llama a los endpoints reales (`getPnl`, etc.) y renderiza el desglose del P&L; **no** es un `ModuleTodo` stub. El P&L de PROJECT §M7 (criterio 21) está cubierto por el DTO de `pnl` + `inventory-value` + `custody-value` + `iva`.
- `GET /api/v1/admin/finance/pnl` — `?from=&to=` → `{ incomeCents, shippingRevenueCents, cogsCents, stripeFeesCents, shippingCostCents, profitCents }` (ingresos + **ingreso de envío** − costo de lo vendido − comisiones Stripe − **costo de envío** = ganancia).
  - **Fórmula (v1.4-finance):** `profitCents = incomeCents + shippingRevenueCents − cogsCents − stripeFeesCents − shippingCostCents`.
  - **CAMBIO DE SHAPE (v1.4-finance):** la clave `shippingCents` se **renombra** a `shippingRevenueCents` (ingreso de envío) y se **añade** `shippingCostCents` (costo de envío). Es un **breaking change** con consumidor real: `admin/m7/M7View.tsx` consume este endpoint (`getPnl`) y renderiza el desglose, así que el rename rompió esa vista (línea de envío en `$NaN`) hasta que se alineó al shape de 6 claves. No hubo periodo de compatibilidad porque **productor (backend) y consumidor (frontend M7) se actualizaron en la misma entrega**, no porque falten consumidores. El shape de 6 claves de arriba es la fuente de verdad.
  - Nota de implementación (para el front): `incomeCents` = suma de `Order.subtotalCents` de órdenes `settled` en el rango (por `settledAt`); `shippingRevenueCents` = `ShipmentRequest.shippingFeeCents` (ingreso) de envíos liquidados en el rango (por `pickingAt`); `shippingCostCents` = `ShipmentRequest.shippingCostCents` (costo pagado al carrier) de **esos mismos** envíos (mismo filtro `pickingAt`, mismo conjunto `status ∈ {picking, guia, enviado, entregado}`, para que ingreso y costo del envío caigan en el **mismo** periodo); `stripeFeesCents` = `processingFeeCents` de órdenes **y** envíos; `cogsCents` = `acquisitionCostCents` de los items vendidos. Los envíos sin `shippingCostCents` capturado suman `0` (default de columna), no rompen el cálculo.
- `GET /api/v1/admin/finance/inventory-value` → `{ atReferenceCents, atCostCents, pendingPriceCount }`.
  - **v1.28 (P-24, ADITIVO):** gana **`breakdown: { raw: InventoryValueBucketDTO, sealed: InventoryValueBucketDTO,
    graded: InventoryValueBucketDTO }`** con `InventoryValueBucketDTO = { atReferenceCents, atCostCents,
    pieceCount, pendingPriceCount }`. Misma base de valuación actual por pieza (referencia del acabado; sellado
    por `sealedMarketRef`; graded por su `PriceReference` de grado — típicamente manual, §M2); piezas sin precio
    se excluyen del `atReferenceCents` y cuentan en `pendingPriceCount` (nunca 0 inventado). **Los campos
    top-level NO cambian** (= Σ del breakdown; el `inventoryValueCents` del dashboard sigue siendo espejo del
    top-level). Consumidor nuevo: tarjetas de resumen de M1 (solo `super_admin` — el endpoint no cambia de guard;
    el front las omite para `vault_operator`). El CSV `report=inventory` gana columnas espejo
    (`raw_atReferenceCents,…` — aditivo al final de la cabecera).
- `GET /api/v1/admin/finance/custody-value` → `{ totalCustodyValueCents }` (valor en custodia de clientes).
- `GET /api/v1/admin/finance/iva` — `?from=&to=` → `{ ivaCollectedCents, byOrder: [{ orderId: string, ivaCents: number, settledAt: string, status: string }, ...] }` (para conciliación/CFDI). El identificador de orden en cada item se llama **`orderId`** (no `id`).
- `GET /api/v1/admin/finance/export.csv` — `?report=pnl|iva|inventory&from=&to=` → CSV. **El CSV de `pnl` espeja el shape del response (v1.4-finance):** cabecera `report,incomeCents,shippingRevenueCents,cogsCents,stripeFeesCents,shippingCostCents,profitCents` (la columna `shippingCents` se renombra a `shippingRevenueCents` y se añade `shippingCostCents`).

### M8 — Disputas (`vault_operator+`; recompra `super_admin`)
- `GET /api/v1/admin/disputes` — cola `?status=&userId=&page=`
  - **`userId?` (v1.7-admin-users, NUEVO):** filtra por `Dispute.userId` (simetría con `GET /admin/orders`). Alimenta la ficha 360° del usuario. Paginado; mismo guard y misma proyección que sin filtro.
- `GET /api/v1/admin/disputes/:id` — detalle: `{ item, order, description, type, deadlineAt, evidenceContact: string }` (mismo campo y misma norma que §7: **resuelto server-side desde configuración**, valor no fijado por el contrato). **Sin comparador de fotos de ingreso** (v1.2): la evidencia del cliente llega **por correo a soporte**, fuera del sistema. Para gradeadas el detalle expone `gradingCompany + gradeValue + certNumber` (verificable en la graduadora); la imagen del item es la de catálogo.
- `POST /api/v1/admin/disputes/:id/resolve` — Req `{ resolution: "repurchase" | "reject", note }`. `repurchase` = **`super_admin`** (dinero saliente) → **compensación por disputa: recompra al precio pagado** (crea el pago de recompra), dispute `→resuelta_recompra`. Política VENTAS FINALES: el **cliente conserva la carta** y la carta **NO** regresa al inventario (no se re-agrega item, no se crea `InventoryMovement`). `reject` → `rechazada`.

### M9 — Reportes (`super_admin`)
> **Estado v1.3: YA EXISTE en backend** (`AdminReportsController` + `AdminService.launchMetrics/exportCsv`). No requiere backend nuevo; falta **consumo de frontend** (M9 es `ModuleTodo` en UI).
- `GET /api/v1/admin/reports/launch-metrics` — `?from=&to=` → métricas de lanzamiento vs metas N/X/Y/Z. Shape real: `{ users, salesSettled, buylistPaid, withdrawalsNoDispute, goals: { N, X, Y, Z } | null }`. Cuando **no hay metas fijadas**, `goals` debe ser **`null`** (el objeto completo), **no** un objeto con campos nulos como `{ N: null, X: null, Y: null, Z: null }`. Solo cuando el humano fija las metas, `goals` pasa a ser el objeto `{ N, X, Y, Z }`. Cada métrica respeta el rango por su fecha de realización (alta de usuario / `settledAt` / `paidAt` / `deliveredAt`).
- `GET /api/v1/admin/reports/export.csv` — `?report=pnl|iva|inventory&from=&to=` → CSV (comparte el `exportCsv` de M7; `report` default `pnl`).
- `GET /api/v1/admin/reports/pricing-brackets` — **(NUEVO v2.0, P-48)** instrumentación de la curva: agrega las ventas
  y compras **consumadas** por eje × `MarketBracket` (escala **FIJA**, §Enums) para contestar «**¿qué tan rápido rota
  cada bracket y con qué margen?**» — el dato que faltaba para **calibrar la curva con realidad en vez de con
  supuestos** (§N.8, criterio 95). **Shape completo, query params y semántica: documentados junto al editor en §M2**
  («Curva de precio por VALOR DE MERCADO»), para que la lectura y la escritura de la curva vivan juntas.
  `report=pricing_brackets` se añade también a `export.csv`. **v2.0 recolecta; NO calibra** (§N.10).

### M10 — Config (diales) y bitácora (`super_admin`)
> **Estado v1.3: YA EXISTE en backend** (`SettingsController`: `GET/PUT /admin/settings`, `GET /admin/audit-log`). No requiere backend nuevo; falta **consumo de frontend** (M10 es `ModuleTodo` en UI). **La edición de diales es `PUT /admin/settings` con body parcial** (solo las keys a cambiar) — **no** existe ni se añade `PATCH/PUT /admin/settings/:key`; el front edita enviando el subconjunto de keys modificadas. Cada `PUT` queda en `AuditLog` (`action: settings.update`, con `before`/`after`).
- `GET /api/v1/admin/settings` → todos los diales `{ shippingFeeCents, aportacionPct, ivaPct, salesMarkupPct, stripeFeePct, stripeFeeFixedCents, buylistCapPerRequestCents, buylistCapPerMonthCents, ineThresholdCents, repoCapPerCardCents, fxBufferPct, fxManualOverrideRate?, pricingProviderRaw, pricingProviderGraded, pricingProviderSealed, priceProvider, sealedPriceSource, sealedValueTrend, sealedRestockAlerts, catalogSyncFromDate }`. **v1.40 (Enmienda A, P-37): `stripeFeeIvaPct` se RETIRA de este DTO.** Ya no se expone en `GET` ni se acepta en `PUT` (una key `stripeFeeIvaPct` en el body de `PUT` cae en `422 VALIDATION_ERROR` como cualquier key desconocida). El IVA que Stripe MX cobra sobre su comisión **se deriva de `ivaPct`** (`ivaPct/100`) dentro del gross-up (fuente única del IVA; ver ARCHITECTURE §5.1). La clave de BD `stripe_fee_iva_pct` queda **deprecada e inerte** (no se lee); no hay migración. **Frontend M10: se elimina el dial `stripeFeeIvaPct` de la UI de settings.** `catalogSyncFromDate` (string `yyyy/MM/dd`, default **`"2024/01/01"`**) = frontera por defecto del sync de catálogo M2 (ver `POST /admin/catalog/sync`); editable sin redeploy. **Es una `ConfigSetting` de primera clase** (ARCHITECTURE §3.6), por lo que se expone aquí como los demás diales. Nota: `ine_retention_days` **no** se expone en este DTO (dial interno de retención/legal, fuera de la lista `ConfigSetting`). **v1.13-sales-pricing:** `salesMarkupPct` (markup GLOBAL de venta) queda **DEPRECADO** — la ruta de venta ya no lo lee (la reemplaza la tabla por rareza `SALES_PRICE_RULES`, §M2 › "Precio de VENTA por RAREZA"). Se conserva en el DTO como **palanca de rollback** (decisión abierta v1.13-3); su retiro es follow-up. Las tablas de venta/buylist por rareza **no** se editan por este `PUT /admin/settings` sino por sus endpoints dedicados de M2. **v1.14-price-ingest / reconciliado v1.48:** `priceProvider` (`price_provider`, enum **`tcgcsv_singles | pokemonpricetracker | pokemontcg_io`**, valor vigente **`tcgcsv_singles`** desde P-47/v1.44) selecciona el **proveedor de la ingesta masiva de precios** (WS-A, ARCHITECTURE §4.15/§4.35); editable sin redeploy → palanca de **rollback money-safe** del proveedor. Validado contra el enum del backend (**`PRICE_PROVIDER_VALUES = ['pokemontcg_io','pokemonpricetracker','tcgcsv_singles']`**); `422 VALIDATION_ERROR` si es otro valor. **Semántica de los tres valores (P-47/v1.44, ARCHITECTURE §4.35):** `tcgcsv_singles` = **provider PRIMARIO** del precio **por-acabado** diario (reprecia desde TCGCSV, FX Banxico, respeta `isManualOverride`, no escribe estructura); `pokemontcg_io` = **legacy/rollback money-safe** (fuente previa, congelable sin escritura de estructura); `pokemonpricetracker` (PPT bulk) = **fallback**. **Nota histórica:** el seed original v1.14 era `pokemontcg_io` con flip previsto a `pokemonpricetracker` (decisión abierta v1.14-1/v1.14-4); ese flip quedó **superado** por el switch a `tcgcsv_singles` (P-47/v1.44), hoy el provider primario del barrido. **v1.19-sealed-tcgcsv:** `sealedPriceSource` (`sealed_price_source`, enum `SealedPriceSource = tcgcsv | off`, **seed `off`** fail-closed) enciende/apaga la **ingesta de la referencia de mercado del SELLADO** vía TCGCSV (job `sealed-price-ingest`, §M10-ops; ARCHITECTURE §4.19e). Con `off` el job es no-op; los `PriceReference` ya escritos permanecen (informativos e inertes). Editable sin redeploy; validado contra el enum (`422 VALIDATION_ERROR`). El flip a `tcgcsv` se hace tras validar el esquema real en staging (1ª corrida manual con `groupId`; runbook devops). **v1.23-sealed-sales: `sealedPriceSource=tcgcsv` deja de ser solo informativo — es el prerequisito para que el sellado se auto-precie** (`mercado × spread`) **con la fuente AUTOMÁTICA de mercado (ingest TCGCSV)**; con `off`, la ingesta automática no aporta mercado, pero el sellado **sigue vendible con un override manual** — el override de VENTA por pieza (`InventoryItem.listPriceCents`) **o** el **override manual de MERCADO** (`PriceReference isManualOverride=true`, «FIJAR PRECIO»), ambos **NO gateados por el dial** (v1.43/IMP-C; ARCHITECTURE §4.23a). El dial `off` es fail-closed **solo para la fuente automática**, no para una decisión manual explícita. **v1.23 — cuatro diales nuevos** (feature flags seed `off` los dos últimos): `sealedValueTrend` (`sealed_value_trend`, `on|off`, seed **off**) y `sealedRestockAlerts` (`sealed_restock_alerts`, `on|off`, seed **off**) gobiernan los endpoints feature-flagged de §2-S (con `off` → `404 FEATURE_DISABLED`). Los **spreads** del sellado (`sealed_spread_pct_by_subtype`, `sealed_spread_fallback_pct`) **NO** se exponen en este DTO ni se editan por `PUT /admin/settings`: se editan por los endpoints M2 dedicados `GET/PUT /admin/pricing/sealed-spreads` (como las reglas de venta/buylist por rareza). Ver ARCHITECTURE §4.23c/§4.23h.
- **v2.0 (P-48) — `salesMarkupPct` queda RETIRADO de la ruta de venta, sin sustituto en este DTO.** El precio de venta
  sale de la **curva** (`pricing_curve`, §M2), no de un markup global ni de una tabla por rareza. El dial puede
  conservarse en el DTO como palanca inerte durante la transición, pero **nada lo lee** — la palanca de rollback real
  es revertir el deploy (§ARCH 4.36.9d). **Los diales de la curva (piso, bin, puntos, escalera) NO se editan por
  `PUT /admin/settings`**: viven en su endpoint dedicado `PUT /admin/pricing/curve` (como los spreads del sellado),
  porque su validación es **cruzada y atómica** (§M2).
- **v1.50-graded-estimate — un dial nuevo:** `gradedEstimatesEnabled` (`graded_estimates_enabled`, enum `on | off`,
  **seed `off` fail-closed**) es el **interruptor maestro del «gancho de grading»** (§O, ARCHITECTURE §4.38). Con `off`
  el backend **ni siquiera evalúa nada**: `GET /catalog/cards*` no emite `gradingHighlight` ni `gradedEstimates`, y
  `?gradingHighlight=true` devuelve `{ data: [], total: 0 }`. Se expone en el `GET` y se edita por este `PUT` (mismo
  patrón que `sealedValueTrend`/`sealedRestockAlerts`); validado contra el enum (`422 VALIDATION_ERROR`).
  **⚠ Encenderlo en producción NO es una decisión de devops:** publica una **afirmación comercial** cuyo **disclaimer
  (§O.5) todavía espera el visto bueno del humano** (pregunta abierta v2.0 #1, legal-comercial). El seed `off` permite
  construir, testear y desplegar sin exponerla, y da a QA el on/off que exige el **criterio 108** (verificar que
  encender/apagar la feature **no cambia ningún precio de venta, valuación de portafolio, cotización de buylist ni
  P&L**). **El resto de la config del gancho —escalones de costo, `minUpsidePct`, frescura, grados— NO se edita aquí:**
  vive en los endpoints M2 dedicados `GET/PUT /admin/pricing/graded-estimates` (como los spreads del sellado).
- **v1.50.2 — un SEGUNDO dial de M10:** `gradedEstimateIngestEnabled` (`graded_estimate_ingest_enabled`, enum
  `on | off`, **seed `off` fail-closed**) gobierna la **fase 2** (ingest automático PPT, ARCHITECTURE §4.38h). Mismo
  patrón y misma validación que el anterior.
  **Son DOS diales y no uno a propósito:** `gradedEstimatesEnabled` gobierna la **exhibición** (¿el comprador ve la
  cifra? — decisión **legal/comercial**), `gradedEstimateIngestEnabled` gobierna la **obtención** (¿gastamos créditos
  del proveedor y escribimos filas? — decisión de **coste** y de calidad de dato). Colapsarlos obligaría a elegir entre
  «no puedo probar el ingest sin publicar» y «no puedo publicar sin encender el gasto». Con dos, el operador puede
  **rodar el ingest en observación con la vitrina apagada**, que es la secuencia de encendido que pide §4.38(h).
- `PUT /api/v1/admin/settings` — Req parcial con las keys a actualizar; **sin redeploy**. Registra `AuditLog`. Err `422 VALIDATION_ERROR`.
- `GET /api/v1/admin/audit-log` — **bitácora global** `?actorUserId=&action=&entityType=&from=&to=&page=` → `{ data: AuditLogDTO[] }`.

#### <a id="M10-ops"></a>Ops — disparo manual de jobs internos (`admin/jobs/*`, `super_admin`, auditado)
> **Superficie interna de operaciones** (no consumida por clientes): permite al súper-admin **disparar a mano** los
> jobs que normalmente corren por **cron** (mantenimiento, cumplimiento, snapshots de valor, refresco de precios),
> p. ej. para re-correr un job que falló o forzar un refresco fuera de ventana. **Todos** los endpoints de esta
> familia comparten el mismo contrato:
> - **Método/forma:** `POST /api/v1/admin/jobs/<job-name>` con body **vacío** `{}` (sin parámetros de cliente; el
>   efecto del job está fijado server-side). **Únicas excepciones:** `price-ingest` (v1.14) admite `setId?` y
>   `sealed-price-ingest` (v1.19) admite `groupId?` — ambos opcionales y pensados para la **verificación de esquema**
>   de la 1ª corrida acotada; ver sus entradas abajo.
> - **Rol:** `super_admin` (hereda `@Roles(Role.super_admin)` del controller). Err `403 FORBIDDEN` para otros.
> - **Auditado:** cada disparo queda en `AuditLog` (`action: job.trigger`, con el `job` en `after` + `actorUserId`).
> - **Single-flight:** si el job ya está corriendo, la llamada **no** encola un segundo pase; devuelve el estado del
>   pase en curso (`enqueued: false`). Es **idempotente** ante doble clic.
> - **Res `202`:** `{ job: string, enqueued: boolean, jobId?: string }` (`enqueued=false` si ya había uno en curso).
>
> **Jobs disparables** (nombre = el mismo del scheduler; ver ARCHITECTURE §5, §4.13c y §4.15):
> - **`price-ingest`** *(v1.14-price-ingest, WS-A — NUEVO, el pricing PRIMARIO):* dispara la **ingesta masiva de precios**
>   vía el proveedor de paga seleccionado por el dial `priceProvider` (§M10). Encola un **fan-out BullMQ de un job por
>   set** (`price-ingest-set`) que hace **upsert idempotente** de `PriceReference` por `(cardId, 'raw', 'raw:NM', finish,
>   hoy)` ~~y refresca `Card.availableFinishes` desde el proveedor~~ *(⛔ derogado por v1.22/§4.22a: `price-ingest`
>   NO escribe `availableFinishes`; escribe su columna interna `pricedFinishesSnapshot`, que desde **v1.27/P-13**
>   además YA NO compone la lista blanca — solo confirma/observa, ver ARCHITECTURE §4.25a)*. **Reanudable** (cola en
>   Redis), aísla fallos por set, respeta `isManualOverride`. **Excepción a la forma de la familia:** acepta **`setId?`**
>   opcional en el body (`POST /admin/jobs/price-ingest { "setId": "sv8" }`) para ingestar **un solo set** — pensado para
>   **verificar el esquema del proveedor** en la 1ª corrida (v1.14-1) sin barrer todo el catálogo; omitirlo ingesta
>   **todo** el catálogo. **v1.27 (P-12):** con `setId` el barrido es del set **COMPLETO** (bypass del scope <2020 de
>   `ppt-sync-scope`) y es la **2ª mitad del flujo recomendado por set** de §M2: `catalog/sync {setId, force:true}` +
>   `jobs/price-ingest {setId}` (la UI de M2 lo encadena por fila). Res `202`:
>   `{ job: "price-ingest", enqueued: boolean, jobId?: string }` (o `{ ..., scope: "set", setId }` si se pasó `setId`).
>   **Toca dinero** (mueve precios de referencia) → sujeto a triple veredicto. Reemplaza a `catalog-price-sync` en el rol
>   de pricing (abajo).
>   **v1.44 (P-47, ARCHITECTURE §4.35):** el **provider PRIMARIO de singles del barrido pasa a `tcgcsv_singles`** —
>   reprecia **por-acabado** desde TCGCSV (`PriceReference` con `source='tcgcsv_singles'`, por `cardProductId`; §4.27e/f),
>   FX Banxico aplicado, respeta `isManualOverride`, **NO** escribe estructura (la composición sigue gateada a
>   import/`--force`, §4.27d). **PPT (LIST) queda fallback-only por PRECEDENCIA DE LECTURA** *(aclarado v1.45, §4.35(f))*:
>   en el barrido corre **UN solo provider (`tcgcsv_singles`); PPT bulk NO corre**. Donde no hay fila `tcgcsv_singles`
>   fresca, al **resolver** la referencia (`sourceRank`/`isBetterRef`) gana la mejor fila existente — que puede ser un
>   **residuo** PPT/pokemontcg.io previo al switch (congelado, no reescrito por el barrido). **`POKEMONPRICETRACKER_FETCH_PRINTINGS`
>   se APAGA** (dial de devops). Sin cambio de forma del endpoint (mismo `202`; el provider lo selecciona el dial
>   `PRICE_PROVIDER`). Money-safe: acabado sin precio en ninguna fuente ⇒ `PRICE_PENDING`/«—», jamás el de otro acabado;
>   set nunca resuelto ⇒ lo cubre el `--force` por set, no una escritura PPT en vivo.
> - **`sealed-price-ingest`** *(v1.19-sealed-tcgcsv — NUEVO):* dispara la ingesta de la **referencia de mercado del
>   SELLADO** vía TCGCSV (ARCHITECTURE §4.19d): grupos distintos de los items sellados **mapeados** → precios por grupo
>   → USD→MXN con FX+colchón → upsert idempotente de `PriceReference` `(cardId ancla, 'sealed',
>   'sealed:tcg:<productId>', 'normal', hoy)` con `source='tcgcsv'`. **Secuencial y AWAITED** (sin fan-out; volumen
>   minúsculo), single-flight, respeta `isManualOverride`. **Gateado por el dial `sealedPriceSource`** (§M10): con
>   `off` responde `202 { job, enqueued: false, reason: "SEALED_PRICE_SOURCE_OFF" }` y no ingiere nada (fail-closed).
>   **Excepción a la forma de la familia:** acepta **`groupId?`** entero opcional (`POST /admin/jobs/sealed-price-ingest
>   { "groupId": 23821 }`) para ingestar **un solo grupo** — verificación del esquema real en staging antes del flip del
>   dial (fixtures en dev; runbook devops). Res `202`: `{ job: "sealed-price-ingest", enqueued: boolean, jobId?: string }`
>   (o `{ ..., scope: "group", groupId }` si se pasó `groupId`). Escribe `PriceReference` → auditado y cubierto por el
>   gate de seguridad como el resto de la familia. **v1.23-sealed-sales:** este `sealedMarketRef` deja de ser solo
>   informativo — es la **base del precio de venta del sellado** (`mercado × spread`, ARCHITECTURE §4.23b); por eso su
>   corrida es prerequisito para auto-preciar el sellado (con el dial `sealedPriceSource=tcgcsv`).
> - **`catalog-price-sync`** *(v1.12.1, tarea 1.3 — **DEPRECADO en su rol de pricing por WS-A**):* dispara el **re-sync
>   completo del catálogo** (`force:true`) ~~que **repuebla `PriceReference` por `(card, finish)`** reusando
>   `tcgplayer.prices` (FX del día)~~ *(⛔ v1.27: ese re-poblado de precios ya NO ocurre — §4.15g)*. Es el **disparo manual** del refresco 2×/día (06:00 y 18:00 CDMX). **Equivale**
>   a `POST /admin/catalog/sync-all {force:true}` (§M2); ambos conviven (este es el disparador de ops "por job",
>   `sync-all` es el de catálogo). **Toca dinero** (mueve precios de referencia) → sujeto a triple veredicto. **v1.14:**
>   su rol de **pricing** lo asume `price-ingest` (arriba, mucho más barato); se **conserva** solo para **import de
>   metadata de sets nuevos** con `force:false` (no re-baja todo el catálogo para refrescar precios).
> - **`portfolio-snapshot`** — recalcula/escribe el snapshot diario del valor de portafolio (`PortfolioSnapshot`,
>   alimenta `GET /vault/portfolio/history`, §3).
> - **`set-price-sync`** / **`set-value-snapshot`** — refresco de precios y snapshot diario del **valor agregado de
>   set** (`SetValueSnapshot`, alimenta las rutas públicas `*-value-history`, §2 / ARCHITECTURE §4.12c).
> - **`ine-retention`** — barrido de **cumplimiento**: purga/anonimiza imágenes de INE fuera de la ventana de
>   retención (`INE_RETENTION_DAYS`), anclado a `SellRequest.closedAt` (SEC-D2, v1.8-ronda-c).
> - **`fx-refresh`** — fuerza el fetch del tipo de cambio a Banxico (paralelo a `POST /admin/fx/refresh`, §M2).
> - **`sealed-restock-notify`** *(v1.23-sealed-sales — NUEVO, FEATURE-FLAGGED `sealed_restock_alerts`):* detecta productos
>   sellados que volvieron a `status='listed'` y con `off`, es no-op logueado. Con `on`, empareja `SealedRestockSubscription`
>   pendientes (por identidad de producto + condición), envía correo (módulo `mail`) y marca `notifiedAt`. Single-flight;
>   escritura acotada a `SealedRestockSubscription` (no toca dinero). Ver ARCHITECTURE §4.23h.
>
> **Nota:** esta familia es superficie de **ops**, no de producto; el frontend no la consume (no hay `ModuleTodo`).
> Se documenta aquí para que sea parte de la fuente de verdad y quede cubierta por el gate de seguridad (SAST/DAST).

### Dashboard (`vault_operator+`, con campos financieros solo para `super_admin`)
- `GET /api/v1/admin/dashboard` → las **~8 tarjetas**:
```json
{
  "profitPeriodCents": 0, "salesPeriod": { "count": 0, "amountCents": 0 },
  "workQueue": { "shipments": 0, "buylist": 0, "disputes": 0, "pendingPrices": 0 },
  "inventoryValueCents": 0, "custodyValueCents": 0,
  "buylistPeriod": { "count": 0, "amountCents": 0 },
  "dataHealth": { "pendingPriceCount": 0, "lastPriceSyncAt": "…", "lastFxAt": "…" },
  "launchProgress": { "users": 0, "salesSettled": 0, "buylistPaid": 0, "withdrawalsNoDispute": 0 }
}
```
Los campos de dinero (`profit*`, `inventoryValue*`, `custodyValue*`) se omiten/enmascaran para `vault_operator`.

---

## 11. DTOs de administración (referencia)
```ts
OrderSummaryDTO  = { id, userId, status: OrderStatus, totalCents, createdAt, settledAt? }
// v1.3.1: `category` (BuylistCategory) REEMPLAZADO por `rarity` + `appliedRule`. `category` deprecado (puede
// venir null en filas legacy; no lo consuma el front nuevo).
// v1.6-finish: `finish` = acabado snapshot de la cotización/solicitud (default "normal"). Determina la regla
// (appliedRule) y la referencia usadas; se propaga a InventoryItem.finish al convertir.
// v1.18-buylist-rejects: campos de RECHAZO — poblados SOLO si itemStatus="rechazada"; en cualquier otro status van
// null/omitidos. `rejectedAt`/`rejectionReason` se persisten (M-22); `returnDeadlineAt` (= rejectedAt + 7d,
// devolución a costo del usuario) y `abandonDeadlineAt` (= rejectedAt + 30d) se DERIVAN server-side al proyectar
// (no son columnas). Ítems rechazados antes de M-22 (sin rejectedAt): los 4 campos null. Un ítem `rechazada` tiene
// SIEMPRE approvedPriceCents=null (invariante: no suma en approvedTotalCents).
// v1.30: `productId?` (number = TCGplayer productId == CardProduct.tcgplayerProductId) = snapshot del producto
// cotizado cuando la línea es un producto separado (deck_exclusive/promo, §4.29). Ausente ⇒ línea de set_base
// (comportamiento actual). El front lo usa para etiquetar la línea («Deck Exclusive») y para no colapsar dos líneas
// que comparten (cardId, finish) con distinto productId.
// ⚠️ v2.0 (P-48) — INSTRUMENTACIÓN (§N.8, criterio 95). `appliedRule` SE RETIRA (no hay reglas). En su lugar, la
// línea persiste el snapshot de la DECISIÓN DE PRECIO al cotizar/crear la solicitud (misma transacción que congela
// `quotedPriceCents`), con los cinco datos de §N.8: mercado crudo, precio final, qué lo determinó, acabado y bracket:
//   * `marketMxnCents: number | null` = el **mercado CRUDO en centavos** que entró al cálculo. Se persiste SIEMPRE
//     (el bracket es un índice de conveniencia; **el dato real es el monto**). `null` si no hubo mercado.
//   * `priceBasis: PriceBasis` = qué determinó el monto (bounty / override / market / floor / pending).
//   * `marketBracket: MarketBracket | null` = bracket de **ESCALA FIJA** (independiente de la curva, a propósito:
//     si dependiera de los puntos vigentes, la serie histórica dejaría de ser comparable al mover la curva).
//   * `finish` ya existía y cuenta como el quinto dato; `quotedPriceCents` es el precio final.
//   * Un **ajuste** posterior del admin (`approvedPriceCents`) **NO reescribe** `priceBasis`/`marketBracket`: la serie
//     mide **la decisión de la curva**; lo realmente pagado se lee de `approvedPriceCents ?? quotedPriceCents`.
//   * `rarity?` se CONSERVA como snapshot informativo del catálogo — **el monto no depende de ella** (criterio 84).
//   * Las columnas `ruleMode`/`ruleValue`/`ruleSource` de `SellRequestItem` quedan **legacy** en BD (nada nuevo las
//     escribe; retención de filas históricas, igual que `category` en M-14) y **no** se proyectan en este DTO.
SellItemDTO      = { id, card: CardDTO, productType, rawCondition?, finish: Finish, productId?: number,
                     rarity?: string,
                     marketMxnCents?: number | null, priceBasis?: PriceBasis,
                     marketBracket?: MarketBracket | null,
                     quotedPriceCents?, approvedPriceCents?, itemStatus: SellItemStatus, inventoryItemId?,
                     rejectedAt?: string, rejectionReason?: string,
                     returnDeadlineAt?: string, abandonDeadlineAt?: string }
// v2.0 (P-48) — INSTRUMENTACIÓN del eje de VENTA. `OrderItem` gana el mismo quinteto en BD (M-41), capturado al
// CHECKOUT en la misma transacción que congela `unitPriceCents` (que ES el precio final; ya existía).
// EXPOSICIÓN: **solo back-office** — la línea de `GET /admin/orders/:id` (M3) gana estos campos. La línea del
// pedido del CLIENTE (`GET /orders/:orderId`, `items[]`) **NO cambia**: el comprador no necesita saber qué peldaño
// fijó su precio, y §N.7 ya gobierna qué ve en la ficha. Money-safe: es lectura de instrumentación, no de dinero.
AdminOrderItemDTO += { marketMxnCents?: number | null, priceBasis?: PriceBasis,
                       marketBracket?: MarketBracket | null, finish?: Finish }
// v2.0 (P-48) — la entrada de la cola de precio pendiente gana la RAZÓN (M-41). `null` en filas históricas.
PendingPriceEntryDTO += { reason?: PendingPriceReason | null }
// v1.18-buylist-rejects: identidad del vendedor en M5 (GET /admin/buylist, /admin/buylist/:id, rejected-items).
// PII: correo = dato de contacto operativo de back-office (roles vault_operator/super_admin); NO es la CLABE →
// sin enmascarado ni reveal auditado. seller.id === SellRequest.userId (que se conserva por compat).
AdminSellerRef   = { id: string, name: string, email: string }
// v1.18-buylist-rejects: fila de GET /admin/buylist/rejected-items (pestaña «Rechazadas», transversal a
// solicitudes). `reason` = rejectionReason. Deadlines derivadas como en SellItemDTO. La "fase" (devolución /
// abandono) la deriva el front de now vs las fechas; no se expone como campo.
RejectedSellItemDTO = { id, sellRequestId, seller: AdminSellerRef, card: CardDTO, productType: ProductType,
                        finish: Finish, quotedPriceCents?: number, reason: string | null,
                        rejectedAt: string | null, returnDeadlineAt: string | null,
                        abandonDeadlineAt: string | null }
// v1.8-ronda-c: `finish` añadido a la clave de la cola. `normal` y `holofoil` de la misma carta sin precio son
// entradas SEPARADAS; resolver el override de un acabado NO cierra las de los demás. Modelo Prisma real (M-19).
// v1.30 (§4.29, M-32 aditiva): `cardProductId?` (number = TCGplayer productId) entra a la clave lógica cuando la
// entrada nace de un producto separado (deck_exclusive/promo): dos entradas con el mismo (cardId, finish) y distinto
// cardProductId son SEPARADAS — resolver el precio del set_base NO cierra la del Deck Exclusive (money-safe). `null`
// (ausente) = entrada de set_base, comportamiento actual.
// v1.42 (BLOQ-2b, M-40 aditiva): identidad de sellado. Para productType='sealed' la entrada gana `sealedProductId?`
//   (FK → SealedProduct) que ENTRA A LA CLAVE LÓGICA (misma mecánica que finish/cardProductId): dos pendientes con
//   igual (cardId, gradeKey, finish) y distinto sealedProductId son SEPARADAS — resolver el override de un ETB NO cierra
//   el del blíster (money-safe; antes colapsaban bajo el gradeKey legacy 'sealed'). Con identidad P-38 cada presentación
//   tiene su SealedProduct ⇒ su tcgplayerProductId ⇒ su gradeKey 'sealed:tcg:<productId>'. `sealedProductName?` = nombre
//   RESUELTO (cascada §4.34a) para que M2 muestre «ETB …», no «sealed» ambiguo; `sealedSubtype?` idem. Los 3 campos
//   presentes SOLO en sellado (null/ausentes en raw/graded). Residual money-safe: sellado legacy sin sealedProductId
//   (backfill P-38 no ligó) puede colapsar bajo 'sealed' hasta curarse en M2 — sigue pendiente, JAMÁS 0.
// v2.0 (P-48): `reason` = por qué entró (M-41). `no_market` la cura sola el siguiente barrido; `premium_at_floor`
// (guardarraíl §4.36.5) necesita que el DUEÑO mire — es el que hace TRIABLE la cola. `null` en filas históricas.
PendingPriceEntry= { id, cardId, productType, gradeKey, finish: Finish, cardProductId?: number,
                     sealedProductId?: string | null, sealedProductName?: string, sealedSubtype?: SealedSubtype | null,
                     context, reason?: PendingPriceReason | null, status: "open"|"resolved", createdAt }
// v2.1.7 — GET /admin/pricing/card/:cardId (`super_admin`). Una fila por `PriceReference` capturada, `capturedDate`
// desc. NORMADA tras B-1: antes el contrato decía «historial por fecha/fuente» sin fijar campos, y backend/frontend
// coincidían por acuerdo TÁCITO (ambos lo marcaron como SUPUESTO en su código; ver §M2).
//   * `capturedDate` = `YYYY-MM-DD` (día de captura, NO instante — igual que `PriceInfo.capturedDate`). El ISO
//     completo insinuaría una precisión que el dato no tiene.
//   * ⚠️ `source` es **`PriceSource`** (el enum), NO `string`. El acuerdo tácito ya tenía una GRIETA: backend lo
//     tipaba `string` y frontend `PriceSource`. Con `string`, un valor fuera del enum compila en backend y **rompe
//     el render** del front sin que nada avise. **Manda el enum**; si aparece una fuente nueva, se añade a
//     `PriceSource` en este contrato — que es el punto de tener un enum.
//   * `isManualOverride` SÍ va aquí (superficie `super_admin` de auditoría, donde la procedencia ES el dato; y NO es
//     redundante con `source` per-fila — ver §M2). Contrasta con `PriceInfo`, de donde se RETIRÓ (v2.1.6).
//   * v1.50.3-f (M-43): `refKind` = **NATURALEZA** de la fila, ORTOGONAL a `source` (procedencia) y a
//     `isManualOverride`. `"market"` = puede resolver dinero; `"graded_estimate"` = **jamás** resuelve dinero
//     (§4.38l.4). En una superficie de auditoría es el dato que explica por qué una fila con número no está priciando
//     nada. **Aditivo**: las filas previas a M-43 son `"market"` por default de columna.
PriceHistoryEntryDTO = { capturedDate: string, source: PriceSource, gradeKey: string,
                         productType: ProductType, priceMxnCents: number, isManualOverride: boolean,
                         refKind: "market" | "graded_estimate" }
// v2.1 (P-48): conteo por motivo del encabezado de la cola (DESIGN_SYSTEM §21.7c: «12 SIN MERCADO · 3 PREMIUM EN EL
// PISO»). Viaja en el CUERPO de GET /admin/pricing/pending, junto a `data`.
//   * Se calculan sobre la cola COMPLETA: IGNORAN `?reason=` y la paginación. Si respetaran `reason`, el encabezado
//     describiría el subconjunto filtrado y NO la cola — el número mentiría justo cuando el dueño filtra para triar.
//   * RESPETAN `?context=`, porque `context` no filtra dentro de la cola: elige QUÉ cola es (VENTA=inventory vs
//     COMPRA=buylist, §4.24c). Ignorarlo sumaría pendientes de compra al encabezado de venta (mismo defecto, otro eje).
//   * Cuentan SOLO `status="open"` (es una bandeja de trabajo; lo `resolved` ya no es trabajo).
//   * `unknown` = entradas con `reason=null` (filas anteriores a M-41). Está para que se cumpla el invariante
//     `no_market + premium_at_floor + unknown === nº de entradas open de esa cola`: sin ella, una cola con filas
//     históricas no cuadraría con la lista y parecería un bug del backend.
//   * LOS DOS NÚMEROS JUNTOS SON UN DIAGNÓSTICO (por eso van en la misma respuesta, del mismo instante): contra la
//     línea base ≈3/333 (ARCHITECTURE §4.36.9c-3) — `premium_at_floor` sube con `no_market` PLANO ⇒ hay dato y está
//     bajo el piso ⇒ PISO MAL CALIBRADO; suben LOS DOS ⇒ FEED DE MERCADO DEGRADADO (ingest/proveedor), no la curva.
PendingPriceCountsDTO = { no_market: number, premium_at_floor: number, unknown: number }
// v1.8-ronda-c (BE-10): resumen de un item en la bóveda del usuario para la ficha 360° admin (GET /admin/users/:id).
// `referenceValue` reusa el MISMO PriceInfo por-acabado que HoldingDTO (§3); items sin precio → status="pending".
// Es una PROYECCIÓN (no tabla): no migra. Antes traía solo { inventoryItemId, folio, card, ownershipStatus }.
AdminUserOwnedItemRef = { inventoryItemId, folio, card: CardDTO, productType: ProductType, finish: Finish,
                         ownershipStatus: OwnershipStatus, referenceValue: PriceInfo }

// ===================================================================================================
// v2.1.9-b (S49-M1-R / S49-M2) — LAS FORMAS QUE FALTABAN: ficha 360° de M6 y órdenes de M3.
// Ambas devolvían FILAS/RELACIONES CRUDAS de Prisma con PII dentro. Se declaran aquí, y con ellas las
// formas de CADA RELACIÓN ANIDADA — que es donde vivía el hueco (ver la QUINTA PATA en §M2).
// ===================================================================================================

// D10 — `AddressDTO` estaba REFERENCIADA en §5 y NUNCA DEFINIDA (deuda declarada en v2.1.8). Aquí queda.
// El DUEÑO es implícito por la ruta (`/users/me/addresses` o la ficha de M6) ⇒ NO lleva `userId`: repetirlo
// solo crea una segunda fuente de la misma verdad.
AddressDTO = { id: string, line1: string, line2?: string, neighborhood?: string, city: string,
               state: string, postalCode: string, country: "MX", phone: string,
               isDefault: boolean, createdAt: string }

// ---------- M3 — órdenes en back-office (`vault_operator+`) ----------
// LISTADO. Es `OrderSummaryDTO` + los campos de invitado que §M3 ya declaraba como aditivos. Lo que NO
// lleva y por qué (esto es el hallazgo S49-M2: «el listado repartía por la ventana lo que la puerta cierra»):
//   ⛔ `billingSnapshot`  — la fila `BillingProfile` ENTERA (rfcEnc, razonSocial, regimenFiscal, usoCfdi,
//      postalCode, email). Es PII fiscal, y `getUser` YA la oculta al operador citando SEC-A4. La decisión
//      estaba tomada DOS veces (detalle + getUser) y el listado la ignoraba.
//   ⛔ `shippingAddressSnapshot` — domicilio completo. En un LISTADO es cosecha masiva de PII (mismo
//      argumento que la rejilla de §2 en D2: N filas por request, paginada). Va en el DETALLE, donde hace falta.
//   ⛔ `stripePaymentIntentId` / `stripeChargeId` / `paymentMethodBrand` / `paymentMethodLast4` — identificadores
//      de cobro; nada en una lista los usa. Van en el detalle.
//   ⛔ `locale`, `refundedAt`, `ivaRatePct`, `subtotalCents`, `processingFeeCents`, `ivaCents` — el desglose es
//      del detalle; la lista muestra el TOTAL (que es sobre el que ya filtra `minCents`/`maxCents`).
//   ✅ `guestEmail` SÍ va: es contacto operativo ya autorizado por rol (mismo criterio que `AdminSellerRef.email`)
//      y es uno de los campos sobre los que busca `?q=`. Quitarlo rompería el buscador de M3.
AdminOrderSummaryDTO = { id: string, userId: string | null, orderNumber: string | null,
                         status: OrderStatus, totalCents: number,
                         fulfillmentMode: FulfillmentMode, shippingFeeCents: number,
                         isGuestOrder: boolean, guestEmail?: string, claimedAt?: string,
                         chargebackNeedsManual: boolean,
                         createdAt: string, settledAt?: string }
AdminOrderListResponse = { data: AdminOrderSummaryDTO[], page: number, pageSize: number, total: number }
// DETALLE. Ya proyectaba (por eso NO estaba filtrando) — se DECLARA para que no pueda volver a divergir del
// listado: la divergencia silenciosa entre dos rutas de la misma entidad es la forma que tomó S49-M2.
AdminOrderDetailDTO = { id: string, userId: string | null, orderNumber: string | null,
                        status: OrderStatus, breakdown: BreakdownDTO, items: AdminOrderItemDTO[],
                        cfdiStatus: CfdiStatus, invoiceRequested: boolean,
                        stripePaymentIntentId: string | null,
                        fulfillmentMode: FulfillmentMode, shippingFeeCents: number,
                        shippingAddressSnapshot?: object,   // solo `direct_ship`
                        paymentMethodBrand?: string, paymentMethodLast4?: string,
                        chargebackNeedsManual: boolean, disputeOutcome: "won" | "lost" | null,
                        isGuestOrder: boolean, guestEmail?: string, claimedAt?: string,
                        billing?: AdminOrderBillingDTO,     // ⚠️ SOLO `super_admin` — ver abajo
                        createdAt: string, settledAt?: string }
// ⚠️ `billing` es la PROYECCIÓN del `billingSnapshot`, NO el snapshot. Diferencias que importan:
//   * `rfcMasked`, NUNCA `rfcEnc`. El blob cifrado no le sirve a nadie que lo lea: es ilegible Y es fuga.
//     El RFC va enmascarado incluso para `super_admin`, igual que en `getUser`/`kycProfile` (§3.4).
//   * SOLO `super_admin` (SEC-A4: el operador no ve datos fiscales — `getUser` ya lo decide así).
//   * OPCIONAL y ADITIVO: el detalle HOY no emite nada de esto, y no emitirlo sigue siendo conforme. Se declara
//     para que el CFDI manual (PROJECT §B) tenga una forma legítima a la que ir, en vez de que alguien
//     «resuelva» la necesidad devolviendo el blob crudo. **Lo prohibido es el snapshot sin proyectar.**
AdminOrderBillingDTO = { rfcMasked: string, razonSocial: string, regimenFiscal: string,
                         usoCfdi: string, postalCode: string, email: string }

// ---------- M6 — ficha 360° (`GET /admin/users/:id`) ----------
// ⚠️ LA FORMA INCLUYE LAS RELACIONES. El fallo S49-M1-R no fue olvidar un campo de la RAÍZ: fue que
// `sellRequests[]`, `orders[]`, `disputes[]`, `addresses` y `billingProfile` entran por `include:` y NADIE
// declaró qué forma tienen DENTRO de esta respuesta. Dato que lo prueba: de las seis relaciones, la ÚNICA con
// forma declarada (`ownedItems` → `AdminUserOwnedItemRef`, v1.8-ronda-c) es la ÚNICA que no filtraba. No es
// casualidad — es la regla.
// RAÍZ. ⛔ Fuera: `passwordHash`, `tokenVersion` (contador de revocación de sesión: interno, sin uso admin),
// `googleId` (identificador externo, sin uso admin). **Son tres de los cuatro que v2.1.8 ya había juzgado
// impublicables en `PATCH /admin/users/:id/status`** — el arreglo se aplicó a esa ruta y la hermana siguió
// devolviendo el mismo payload, porque el filtro de aquí es una LISTA NEGRA de un solo elemento.
// `anonymizedAt` SÍ va, pero solo a `super_admin`: en «cambiar estado» era ruido; en una ficha 360° la pregunta
// «¿esta cuenta está anonimizada?» es legítima. *(Misma doctrina que `isManualOverride` en v2.1.7: la pregunta
// no es «¿este campo es sensible?» sino «¿es sensible PARA QUIEN LEE ESTA RUTA?».)*
AdminUserDetailDTO = {            // ← `super_admin`
  id: string, email: string, name: string, phone?: string, locale: Locale, role: Role,
  status: UserStatus, emailVerified: boolean, authProvider: AuthProvider, avatarUrl?: string,
  mustChangePassword: boolean, deletedAt?: string, anonymizedAt?: string,
  createdAt: string, updatedAt: string,
  kycProfile: AdminKycProfileDTO | null,
  billingProfile: AdminBillingProfileDTO | null,
  addresses: AddressDTO[],
  orders: AdminOrderSummaryDTO[],            // últimas 20 (F1: el historial completo es §M3 con ?userId=)
  sellRequests: AdminSellRequestSummaryDTO[],// últimas 20 (historial completo: §M5 con ?userId=)
  disputes: AdminDisputeSummaryDTO[],        // últimas 20 (historial completo: §M8 con ?userId=)
  ownedItems: AdminUserOwnedItemRef[] }
// ⚠️ EL ROL ES PARTE DE LA FORMA — DOS DTOs, no uno con opcionales. Si la diferencia fuera «campos opcionales»,
// omitir el recorte NO sería error de compilación y ningún test lo vería: es EXACTAMENTE B-1 con otro campo.
// Misma decisión y misma razón que `GroupedListingSummaryDTO` en D2.
AdminUserDetailOperatorDTO = {    // ← `vault_operator` (SEC-A4: rol de menor confianza; sin PII fiscal/bancaria)
  id: string, email: string, name: string, phone?: string, locale: Locale, role: Role,
  status: UserStatus, emailVerified: boolean, deletedAt?: string,
  createdAt: string, updatedAt: string,
  kycProfile: AdminKycProfileOperatorDTO | null,
  billingProfile: null,                      // SIEMPRE null (no «omitido»): el front pinta «sin acceso», no «sin datos»
  addresses: AddressDTO[],
  orders: AdminOrderSummaryDTO[],
  sellRequests: AdminSellRequestSummaryDTO[],
  disputes: AdminDisputeSummaryDTO[],
  ownedItems: AdminUserOwnedItemRef[] }
// KYC — la CLABE y el RFC viajan SIEMPRE ENMASCARADOS, también para `super_admin` (§3.4). La CLABE en claro solo
// por `GET /admin/buylist/:id/reveal-clabe` (money-out, auditado). ⛔ NUNCA: `clabeEnc`, `rfcEnc` (blobs cifrados)
// ni `clabeHmac` (blind index — es una clave de CORRELACIÓN entre cuentas; publicarla permite empatar titulares
// sin descifrar nada).
AdminKycProfileDTO = { id: string, userId: string, legalName?: string, kycStatus: KycStatus,
                       clabeMasked?: string, rfcMasked?: string, ineOnFile: boolean,
                       ineFrontKey?: string, ineBackKey?: string,   // solo super_admin: sirven el presigned GET
                       capPerRequestCents?: number, capPerMonthCents?: number,
                       verifiedBy?: string, verifiedAt?: string, createdAt: string, updatedAt: string }
AdminKycProfileOperatorDTO = { id: string, userId: string, legalName?: string, kycStatus: KycStatus,
                               clabeMasked?: string, ineOnFile: boolean,
                               capPerRequestCents?: number, capPerMonthCents?: number,
                               verifiedAt?: string }
AdminBillingProfileDTO = { id: string, userId: string, rfcMasked: string, razonSocial: string,
                           regimenFiscal: string, usoCfdi: string, postalCode: string, email: string,
                           createdAt: string, updatedAt: string }
// Buylist anidado. ⛔ `clabeSnapshotEnc` NO SALE A NADIE, en ninguna ruta y con ningún rol — ÉSA es la fuga
// S49-M1-R. No es «enmascararlo»: el snapshot cifrado no tiene lectura legítima fuera del pago SPEI, que ya
// tiene su endpoint dedicado, auditado y money-out. ⛔ `closedAt` tampoco (campo INTERNO de cumplimiento que
// ancla la retención de INE, §3.2). `speiReference`/`paidBy` = hechos de EJECUCIÓN DE PAGO ⇒ solo `super_admin`
// (SEC-A4: el operador no toca dinero que sale).
AdminSellRequestSummaryDTO = { id: string, userId: string, status: SellRequestStatus,
                               quotedTotalCents: number, approvedTotalCents?: number,
                               ineRequired: boolean, ineProvided: boolean,
                               speiReference?: string, paidBy?: string, paidAt?: string,  // ← solo super_admin
                               createdAt: string, receivedAt?: string, verifiedAt?: string,
                               approvedAt?: string, adjustmentSentAt?: string, deadlineAt?: string }
// Disputas anidadas. ⛔ `description` y `resolution` son TEXTO LIBRE escrito por cliente y admin: pueden contener
// cualquier cosa (datos de contacto, del pedido, de terceros) y un RESUMEN no los necesita. Viven en el detalle
// de §M8. ⛔ `resolvedBy` (actor) → la traza de quién hizo qué es `GET /admin/users/:id/audit`.
AdminDisputeSummaryDTO = { id: string, userId: string, inventoryItemId: string, orderItemId?: string,
                           type: string, status: DisputeStatus, deadlineAt: string,
                           createdAt: string, resolvedAt?: string }

AuditLogDTO      = { id, actorUserId, actorRole: Role, action, entityType, entityId, createdAt }
// v1.7-admin-users: entrada de auditoría por usuario (GET /admin/users/:id/audit). Superset de AuditLogDTO:
// `ip?` SOLO se puebla para super_admin (vault_operator lo recibe omitido). NUNCA incluye before/after.
UserAuditEntryDTO= { id, actorUserId, actorRole: Role, action, entityType, entityId, createdAt, ip?: string }
// v1.7-admin-users: respuesta de POST /admin/users. `user` = shape público (sin passwordHash).
AdminCreatedUserDTO = { user: { id, email, name, role: Role, locale: Locale, status: UserStatus,
                               emailVerified: boolean, authProvider: AuthProvider, createdAt: string },
                        tempPassword?: string, mustChangePassword: boolean }
```

---

## 12. Notas de coherencia con PROJECT.md
- **PRECIO PURO POR VALOR DE MERCADO (v2.0, P-48, PROJECT §N LOCKED) — la nota que manda sobre las de abajo.** El
  precio de **cartas sueltas** (raw **y** gradeadas) depende **solo del valor de mercado**:
  `venta = redondeo↑(max(piso, mercado × markup(mercado)))` · `compra = max(bin, mercado × pct(mercado))`, ambas
  **interpoladas** (nunca escalonadas), con **piso y bin ÚNICOS y globales** y **tabla de puntos de longitud variable
  editable en M2** (`GET/PUT /admin/pricing/curve`). **La rareza y el acabado salen del PRICING**: la rareza entra a
  la **VALIDACIÓN** (guardarraíl: premium en el piso no se publica, premium en el bin no se cotiza) y el acabado
  sigue siendo **identidad de variante** y **elige de qué variante se lee el mercado**. **Sin dato de mercado ⇒
  PRECIO PENDIENTE** (el piso NO gana). El **SELLADO no cambia** (spread por presentación). `priceBasis`
  (`market|floor|override|bounty|pending`) es la señal server-side que gobierna la **regla de visibilidad** del
  «Valor de mercado» (solo ficha de carta y de sellado). El **override manual es ABSOLUTO**; el **bounty se revalida**
  al crear, cotizar y publicar. Cada venta y cada compra quedan **instrumentadas** (mercado crudo + precio final +
  `priceBasis` + acabado + `marketBracket` de **escala fija**). Ver ARCHITECTURE §4.36 y §M2.
- Precios de catálogo/ficha **sin IVA**. Se distingue **valor de referencia** (mercado, `referenceValue`) del **precio de venta** (`salePriceCents`). ~~**v1.13-sales-pricing:** el `salePriceCents` se resuelve por la **regla de venta de la rareza+acabado** del item (`SALES_PRICE_RULES`)~~ ⛔ **SUPERSEDED v2.0:** el `salePriceCents` se resuelve por la **CURVA** (o por `listPriceCents` / `sellOverrideCents`, que siguen ganando como override manual). IVA 16% y fee de procesamiento se agregan **en checkout** (`BreakdownDTO`).
- **Gancho de grading (v1.50 + fusión v1.50.2, PROJECT §O v2.0 + reducción de alcance del humano 2026-08-23):** sobre
  una carta **raw publicada** se muestra **cuánto valdría gradeada**, como **estimado informativo con disclaimer** —
  **nunca** precio de venta, oferta, promesa de grado ni compromiso de recompra. **Dos campos, dos DTOs, dos reglas:**
  `GroupedListingDetailResponse.gradedEstimates?` (ficha, nivel carta, **PSA 10 + PSA 9**, **sin gate de ROI**) y
  **`GroupedListingSummaryDTO.gradingHighlight?`** (rejilla de Compra + vitrina del home, nivel grupo, **gateado** por
  el gate de ROI sobre PSA 9 con la tabla de escalones de §O.2.1 **y** por el **gate de confianza** de v1.50.2).
  **Presencia ⇔ elegibilidad**; sin dato, con dato rancio o sin gate ⇒ el campo **se omite** y no se renderiza nada
  (ni $0, ni `—`, ni «pendiente»). La fuente es
  `PriceReference (cardId, 'graded', 'graded:PSA:10'|'graded:PSA:9', 'normal')` — la **misma** fila que ya alimenta
  M1 › Gradeadas; **no requiere pieza física** (FK a `Card`) y **no requiere migración de esquema**.
  Fase 1 **manual-first** vía `POST /admin/pricing/override`; **fase 2 (ingest PPT) DESBLOQUEADA en v1.50.2** con un
  parser auto-confirmante, e **indistinguible para el cliente** porque `source` no se emite. Las filas PSA son
  **informativas** —no fijan `listPriceCents`, no publican inventario, no entran en `availableFinishes`, no encolan
  pendientes y no tocan portafolio/buylist/P&L—, **salvo cuando existe un slab publicado de ese grado: ahí esa fila SÍ
  es dinero** (es la referencia de mercado real de esa pieza), y por eso `POST /admin/pricing/override` exige `intent`
  y devuelve **`409 GRADED_ESTIMATE_SLAB_PUBLISHED`** (INV-D). Diales en M2 (`graded-estimates`, **12 claves**) +
  **dos** interruptores en M10 (`gradedEstimatesEnabled` para la exhibición y `gradedEstimateIngestEnabled` para la
  obtención, ambos **seed `off`**; el primero hasta que el humano apruebe el disclaimer §O.5).
  **v1.50.3:** tres seeds del gate de confianza corregidos para alinear con `PROJECT.md` (`manualFreshnessDays` 30,
  `minSampleCount` 5, `maxRawMultiple` 100) y **un endpoint nuevo de back-office**,
  `GET /admin/pricing/graded-estimates/review` (la **lista de revisión** del criterio 111(e)). **⚠ Para
  product-owner:** §O.3 describe todavía un **bloque comparativo con upside, multiplicador y escalón visible** que el
  humano **retiró**; `PROJECT.md` debe actualizarse para que mande sobre el contrato (regla de conflicto).
  Ver ARCHITECTURE §4.38.
- **Fee de procesamiento = gross-up** de la comisión Stripe (para recibir íntegro subtotal+IVA); **sin IVA de producto sobre el fee** (el fee no vuelve a gravar la venta). Internamente el gross-up **sí** cubre el IVA que Stripe MX cobra sobre su comisión (**v1.40: derivado de `ivaPct/100`**, fuente única del IVA). IVA de producto grava subtotal (compra) y tarifa de envío (retiro).
- **CFDI sin PAC en MVP**: factura por correo (`POST /orders/:id/request-invoice`); IVA cobrado registrado en M7. Timbrado real = fase 2.
- **FX automático (Banxico) + colchón + override manual** (M10); job diario `fx-refresh`.
- **Envío se cobra por Stripe ANTES** de crear la solicitud; avanza a picking solo tras `payment_intent.succeeded`.
- Carta "precio pendiente" → `sellable=false`, compra bloqueada con `PRICE_PENDING`; escalada al dueño vía `PendingPriceEntry`. **v1.8-ronda-c:** la cola es **por acabado** (`PendingPriceEntry.finish`); el override (`POST /admin/pricing/override` con `finish?`) resuelve solo el pendiente de ese acabado. **v2.0 (P-48):** la cola gana **`reason`** (`no_market | premium_at_floor`) y **dos entradas nuevas** — (a) **sin dato de mercado** (el piso/bin **NO** gana) y (b) el **guardarraíl** (rareza premium en el piso o en el bin). La **salida** es simétrica: cuando el siguiente barrido escribe una `PriceReference` real y el precio vuelve a resolver con `priceBasis="market"`, la entrada se cierra **sola** en la siguiente resolución.
- **Ronda C (v1.8):** (a) **BE-10** — `AdminUserOwnedItemRef` (bóveda de la ficha 360° admin) trae `finish` + `referenceValue: PriceInfo`, reusando la valuación por-acabado del `HoldingDTO`; enriquecer el ref (no endpoint nuevo). (b) **SEC-D2** — `SellRequest.closedAt` (interno, no en DTOs de cliente) ancla la retención de INE al cierre real (`pagada`/`rechazada`/`abandonada`). Migración **M-19** (dos columnas; BE-10 no migra). SEC-A1 intacto.
- Retiro solo sobre `settled` (`ITEM_NOT_SETTLED`); direcciones solo MX (`ADDRESS_NOT_MX`).
- Buylist: ~~cotización por **regla por rareza oficial** (v1.3.1 — `fixed` MX$ / `pct` % de la referencia + fallback %)~~ ⛔ **SUPERSEDED v2.0 (P-48):** cotización por la **CURVA DE COMPRA** `max(bin, mercado × pct(mercado))` — **no depende de la rareza ni del acabado**; el acabado solo elige **de qué variante** se lee el mercado. Topes e INE (`BUYLIST_LIMIT_EXCEEDED`, `INE_REQUIRED`) **sin cambio**, pago SPEI **solo súper-admin** tras recepción/verificación. El monto se **deriva server-side** (SEC-A1) del mercado real de la variante, **jamás** del DTO; editor en M2 (`GET/PUT /admin/pricing/curve`).
- **Alta de usuarios por rol + historial 360° (v1.7-admin-users):** `POST /admin/users` (super_admin-only, auditado `user.create`, NO money-out) crea cuentas de cualquier rol sin KYC/CLABE/INE; `emailVerified=true` para staff y para el customer creado por admin; `mustChangePassword=true` solo si la contraseña es autogenerada (devuelta una vez en `tempPassword`, nunca en `AuditLog`). Crear `super_admin` = escalada de privilegios, controlada por super_admin-only + auditoría. El historial 360° se arma por **reuso**: `?userId=` en `GET /admin/{orders,buylist,shipments,disputes}` (paginados, misma proyección PII por rol) + `GET /admin/users/:id/audit` (AuditLog por `scope=target|actor|both`, expone action/actorRole/entityType/entityId/createdAt + `ip` solo super_admin, **nunca** before/after; `vault_operator` reducido sin `ip`). Sin migración (reusa `User`/`AuditLog`). Ver ARCHITECTURE §4.7bis.
- **Acabado / versión de carta (v1.6-finish):** `Finish = normal | reverse_holo | holofoil | first_edition_holofoil`, modelado en **toda la cadena** (Compra, cotizador, inventario/bóveda, portafolio). `CardDTO.availableFinishes` (derivado de `tcgplayer.prices`), `finish` en `ListingDTO`/`HoldingDTO`/`SellItemDTO` y en req de quote/requests/alta M1. El `finish` se **valida contra `availableFinishes`** (SEC-A1); acabado no disponible → `422 FINISH_NOT_AVAILABLE`. ~~El acabado selecciona la regla (reverse holo → `"Reverse Holo"`; holofoil/1st ed → rareza base si ya es holo, si no `"Holo"`; normal → rareza base)~~ ⛔ **SUPERSEDED v2.0 (P-48): el acabado YA NO tiene regla de precio propia** (`finishRules` se retira). **Lo único que pierde es eso**: el acabado **SIGUE** siendo la **identidad de la variante** (inventario, overrides, bounties, `availableFinishes`, ficha, bóveda, filtros y captura en el cotizador) y **sigue determinando de qué variante se lee el mercado** que alimenta la curva. `PriceReference` lleva `finish` en su clave; el provider guarda precio por acabado. **1 fila por `Card`** (no cambia). Migración **M-18** (aditiva, default seguro `normal`/`[normal]`) → **RE-SYNC** del catálogo tras desplegar. Ver ARCHITECTURE §3.7 y §4.36.10.
- Contracargo (webhook `charge.dispute.created`) es **consciente del estado físico**: revierte el item a inventario de plataforma **solo si sigue en bóveda**; si ya se envió/entregó **no** re-agrega y marca `chargebackNeedsManual` (ver §9). Cierre de disputa: ganamos→`settled` (`disputeOutcome=won`), perdemos→`chargeback` (`disputeOutcome=lost`).
- **VENTAS FINALES** (política del humano, ver `PROJECT.md`): no hay reembolso voluntario. Excepciones: (a) **error de la plataforma** (cobro doble/inventario fantasma) → **siempre** se reembolsa (§M3); (b) **disputa de condición** raw dañada/equivocada → el súper-admin compensa con **recompra al precio pagado**, el cliente **conserva la carta** y **no** vuelve al inventario (§M8). En ningún caso de reembolso/recompra el item se re-agrega al inventario.
- Los montos exactos de los diales (envío 17500, IVA 16, markup de venta, tarifa Stripe, tope 300000/1000000, aportación 70%) provienen de `ConfigSetting` (M10), no hardcode; los valores aquí son defaults.
- **Master set en todas partes (v1.20):** un solo contrato de "contenido por set y acabado" con `scope`
  (`platform` | `user_vault`) sirve M1, la vista admin de la bóveda de un cliente y "Mi bóveda" del cliente. La
  **completitud cuenta variantes (carta+acabado)**, con universo = `Card.availableFinishes`. `buyable` (variante
  faltante → pieza `listed` más barata) SOLO en la vista del propio cliente. Ajustes de inventario con motivo
  obligatorio (`AdjustmentReason`) + `InventoryAdjustment`/`InventoryMovement(adjustment)`/`AuditLog`; **sin venta
  directa desde el binder** (toda venta va por órdenes). Migración M-24. Ver ARCHITECTURE §4.20.
- **Guest checkout (v1.21):** comprar **no exige cuenta**; el invitado solo hace **envío directo**
  (`fulfillmentMode='direct_ship'`, dirección en snapshot, envío cobrado en el **mismo PaymentIntent**) y la
  **bóveda sigue exigiendo cuenta** (`422 VAULT_REQUIRES_ACCOUNT` = **upsell**, no error). Su item **nunca** entra a
  bóveda: `ownerType='platform'` todo el ciclo, con `status: reserved → picking → shipped → delivered` (estrena los
  tres valores que v1.17 dejó sin uso; **sin enum nuevo**). Seguimiento por **token opaco** de 256 bits con **solo
  el SHA-256 en BD** (`OrderAccessToken`, multi-uso, revocable, TTL 90d, rotación al reenviar) y `GuestOrderTrackingDTO`
  de **datos mínimos** (sin dirección completa, sin correo/teléfono, sin ids internos, sin acciones). **Reclamo
  explícito** con **prueba de titularidad = correo verificado**, una sola vez, revocando los tokens. El camino de
  invitado **nunca consulta `User` por correo** (anti-enumeración, criterio 56). Migración **M-25**; ningún endpoint
  previo cambia de forma ni de rol. Ver §4-G y ARCHITECTURE §4.21.
- **P&L y guest checkout (v1.21) — evitar el doble conteo del envío:** el ingreso de envío de un pedido de invitado
  vive en **`Order.shippingFeeCents`** (cobrado dentro del PI de la orden), y su `ShipmentRequest` de fulfillment
  lleva `shippingFeeCents = 0` **a propósito**. Por tanto `GET /admin/finance/pnl` debe calcular
  `shippingRevenueCents = Σ ShipmentRequest.shippingFeeCents (envíos liquidados, por pickingAt) + Σ Order.shippingFeeCents
  (órdenes settled del periodo)`, y `incomeCents` de una orden `direct_ship` **excluye** su envío (ya contado en
  `shippingRevenueCents`). El **costo** (`ShipmentRequest.shippingCostCents`) se captura igual en M4 para ambos
  tipos, así que el lado del costo no cambia. *(Cambio en M7 = módulo `admin`, otro work stream: el contrato fija la
  norma; el orquestador enruta la implementación.)*
- **Sellado / producto cerrado (v1.23-sealed-sales):** el sellado pasa de precio-manual-único a **precio derivado**
  `override (InventoryItem.listPriceCents) > mercado TCGCSV × spread(subtype) > mercado × spread(global) > PRICE_PENDING`
  (money-safe: sin precio no se publica). Los **spreads** viven en `ConfigSetting` (editor M2 `sealed-spreads`); el
  **mercado** es el `sealedMarketRef` de §4.19. **v1.43 (IMP-C):** el dial `sealedPriceSource=tcgcsv` es prerequisito solo
  para el **mercado de FUENTE AUTOMÁTICA** (ingest TCGCSV, `source='tcgcsv'`); un **override manual de mercado**
  (`isManualOverride=true`, «FIJAR PRECIO») **SOBREVIVE al dial `off`** y también resuelve el precio por `mercado × spread`.
  El dial gatea el ingest automático, nunca un override manual. Superficie propia:
  grid agregado público con «N disponibles» (§2-S), pestaña «Sellado» en la bóveda del cliente y en la vista admin
  (`GET /vault/sealed`, `GET /admin/vaults/:userId/sealed`), y dos endpoints **feature-flagged** (tendencia, restock).
  **Solo VENTA** (sin buylist de sellado; call-out mailto en la ventana). Nueva condición `SealedCondition` visible al
  comprador. Reuso total del checkout/guest-checkout (`fulfillmentMode vault|direct_ship`). Migración **M-28**. **⚠️
  Supersede** «sellado = precio manual» (PROJECT 3e / Coherencia v1.1 abajo) y §4.19a «TCGCSV solo informativa» —
  **product-owner reconcilia `PROJECT.md`** (ARCHITECTURE §10 SUP-1). Ver §2-S/§3/§M1/§M2/§M10 y ARCHITECTURE §4.23.
- **P&L separa ingreso vs costo de envío (v1.4-finance):** el envío entra al P&L por dos lados — **ingreso** (`ShipmentRequest.shippingFeeCents`, `shippingRevenueCents` en el response) y **costo** (`ShipmentRequest.shippingCostCents`, capturado en M4 al asignar guía, M-16). Fórmula: `profitCents = incomeCents + shippingRevenueCents − cogsCents − stripeFeesCents − shippingCostCents`. Ambos se acotan al periodo por `pickingAt`. `shippingCostCents` es un **costo interno**: no se expone al cliente. `GET /admin/finance/pnl` renombra `shippingCents`→`shippingRevenueCents` (M7 sin consumidores de frontend aún); el CSV espeja el shape.

**Coherencia v1.1 (2026-08-14):**
- **Raw solo NM:** `RawCondition=NM` (único valor); el filtro `condition` para raw solo admite `NM`. Labels legibles ("Casi nueva (Near Mint)" / "Near Mint") viven en i18n del **front**, no en la API. Migración: ARCHITECTURE §11 (M-1).
- **Compra = inventario publicado con precio:** `GET /catalog/cards` **excluye** pendientes/sin precio (el comprador nunca ve "precio pendiente"). Facetas dinámicas en `GET /catalog/facets`: `rarities` distinct de `Card.rarity` espejando pokemontcg.io (lista abierta), `sets` con `year` derivado, filtros por set/rareza/tipo/precio. La **ruta se mantiene** `/catalog/cards` (rótulo "Compra" en el front). **v1.38-grouped-listings (P-30):** el listado de singles pasa a **publicación ÚNICA agrupada** por `(cardId, productType, gradeKey, finish)` con `stockCount` (`GroupedListingDTO`), vivo mientras `stockCount≥1` / agotado (ausente) en 0; agregación en lectura, sin schema. Ver ARCHITECTURE §4.9a.
- **Sellado como línea de venta:** `productType=sealed`, `sealedSubtype?`, sin grade/rareza. Disputa de sellado = caja dañada/equivocada (evidencia por correo a soporte; ver Coherencia v1.2). **v1.19-sealed-tcgcsv:** referencia de mercado del sellado vía TCGCSV (`source=tcgcsv`, mapeo curado M-23, dial `sealedPriceSource` seed `off`). **⚠️ SUPERSEDIDO por v1.23-sealed-sales:** «precio manual MXN obligatorio para publicar» y «TCGCSV solo informativa» ya **no** rigen — el sellado se auto-precia por `mercado × spread` (override de respaldo), su condición `SealedCondition` es visible al comprador y su valor de mercado se expone. Ver la nota v1.23 arriba y ARCHITECTURE §4.23 (product-owner reconcilia PROJECT.md, SUP-1).
- **Login Google:** `POST /auth/google` (mismo shape que `/login`); verificación server-side del ID token; `role` server-side (nunca del token); account-linking por email verificado; **no exime KYC**. Campos nuevos en `User` (migración M-3..M-7). Env `GOOGLE_CLIENT_ID` / `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.
- **Gráfica de portafolio:** `GET /vault/portfolio/history?range=...` sobre `PortfolioSnapshot` (modelo nuevo, migración M-8), escrito por job diario (BE-5). Backfill indicativo opcional marcado `estimated`.
- **Sync de catálogo M2:** `GET /admin/catalog/remote-sets`, `POST /admin/catalog/sync`, `POST /admin/catalog/backfill` (`super_admin`, auditado). Guardarraíl `setId` `^[a-z0-9]+(-[a-z0-9]+)*$`, host fijo (anti-SSRF), `Card.rarity` String libre.
- **AcquisitionPricer:** rarezas modernas → `ex_plus` (40% de referencia) si hay market price; solo lo sin dato de mercado escala a `precio_pendiente` (lado adquisición/admin). Condición siempre NM.
- **Verificación de correo + recuperación (v1.5-auth-email):** verificar **no** bloquea login; bloquea acciones
  sensibles (`POST /checkout/session`, `POST /shipments`, `POST /buylist/requests`) con `403 EMAIL_NOT_VERIFIED`
  (`EmailVerifiedGuard`). Nuevos `POST /auth/verify-email/resend|verify-email|forgot-password|reset-password`;
  `forgot-password` siempre `200` (anti-enumeración); reset self-service **y** admin incrementan `tokenVersion`.
  Tokens `AuthToken` (hash en BD, un solo uso; 24h/1h) — migración **M-17**. Correo vía Resend (env `RESEND_API_KEY`,
  `MAIL_FROM`); links al frontend con `?token=`. `emailVerified` ahora en el `user` de `register|login|google`.

**Coherencia v1.2 / v1.2.1 (2026-08-14):**
- **Sin fotos de producto/inventario:** la imagen mostrada es la **de catálogo** de pokemontcg.io (`CardDTO.imageSmallUrl`/`imageLargeUrl`). `ListingDTO` **ya no** tiene `frontPhotoUrl`/`backPhotoUrl`; el alta de inventario **ya no** recibe `frontPhotoKey`/`backPhotoKey`/`extraPhotoKeys`. Migración ARCHITECTURE §11 (M-13).
- **Gradeadas por certificado:** `InventoryItem`/alta captura **`certNumber`** (string), **requerido para publicar** una gradeada; `ListingDTO` y detalles exponen `gradingCompany + gradeValue + certNumber`. Sin validación automática contra la graduadora. Migración M-12.
- **Uploads solo `kyc_ine`:** `POST /uploads/presign` rechaza cualquier `purpose` distinto de `kyc_ine` (`422 VALIDATION_ERROR`); `inventory_photo`/`dispute_claim` eliminados. Bucket INE **privado + cifrado + retención** (`INE_RETENTION_DAYS`), set `S3_*` conservado.
- **Disputa por correo:** `POST /disputes` sin `claimPhotoUploadKeys`; evidencia por correo a soporte (`evidenceContact`), sin comparador de fotos en §M8. Se conserva `type` (`condition_raw | condition_sealed`) y VENTAS FINALES; resolución por grado/`certNumber` (gradeadas) o estándar NM (raw).
- **INE (KYC) intacto:** almacenamiento del INE en R2 cifrado con retención, `reveal-clabe`, CLABE/RFC cifrados y enmascarados — **sin cambios** respecto a v1.1.

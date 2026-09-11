# PENDIENTES — TCG HUNT

> **Cómo se usa (regla O-5):** un pendiente **afirma su fecha de medición o no afirma nada**. Antes de enrutar
> trabajo a partir de uno, **se re-mide** (el comando o `fichero:línea` de la columna «Comprobación» es por dónde
> empezar). Lo cerrado se mueve a `HISTORIAL.md`; los hechos del negocio viven en `HECHOS.md`.
> Última limpieza: **2026-09-11 ~08:30 UTC** (orquestador, sesión 2, tras fusionar Stream A + andamiaje de CI a `main`). Cuerpos de los ítems: **verbatim**, sin reescribir.

## Índice de abiertos (re-medido 2026-09-11 ~03:20 UTC sobre `17ce9a9`; **actualizado 2026-09-11 ~08:30 UTC tras fusionar Stream A + andamiaje de CI a `main`**; «—» = el cuerpo no lo dice)

> Sesión 2, 2026-09-11: se re-midió **cada fila** contra el árbol (O-5). Punteros a línea corregidos donde envejecieron.
> Cerrado en código en esta re-medición: **P-46** (fix `47c97c1`, dentro de `c13f417`; falta solo la verificación en producción, ver fila).
> Frentes abiertos por esta sesión el 2026-09-11: **«Andamiaje de CI»** (devops) y **Stream A** (ux-ui + arquitecto → backend + frontend), en `claude/tcg-hunt-orchestration-2`.

| ID | Qué | Dueño | Medido el | Comprobación (por dónde empezar) |
|---|---|---|---|---|
| **Stream A** | La cuenta del cliente — **PUBLICADO en `production` el 2026-09-11 18:25 UTC** (`c8bee65`, merge `--no-ff` de `main`; autorizado por el dueño). Medido por el orquestador el 2026-09-11 ~19:00 UTC: el run `34633179107` «Deploy (staging -> prod)» terminó **success**, con `dast-release` verde sobre ese mismo SHA (autoprueba del canario + escaneo del stack efímero, sin bloqueantes); el resto de los trabajos se **saltó a propósito** (`secrets-gate` ⇒ `ready=false`: no hay secrets de CD, publican las integraciones nativas Vercel/Railway). **NO MEDIDO**: que el sitio vivo sirva estas pantallas — desde este contenedor la política de red rechaza `www.tcghunt.mx` y la API de Railway (`CONNECT tunnel failed, 403`); lo cierra el dueño abriendo `/es/account` y `/es/admin/account`, o habilitando esos hosts en la política del entorno. Antes fue: **FUSIONADO en `main` el 2026-09-11** (merge de `claude/tcg-hunt-orchestration-2`, 79 commits; QA + techlead aprobados; cuerpos de P-57/P-73/P-75/P-55 en `HISTORIAL.md`). **Pendiente de RELEASE**: fase de seguridad (pentester + seguridad) sobre `main`; conteo `SELECT count(*) FROM "User" WHERE "mustChangePassword"` en producción antes de publicar el guard (checklist `ARCHITECTURE.md` §4.47.10.4); guard + endpoint en el mismo deploy | orquestador → pentester → seguridad → devops | 2026-09-11 | `git log origin/main --oneline -3`; `docs/ARCHITECTURE.md` §4.47.10.4 |
| **Stream B** | Lo que se rompe con el dinero — **EN CONSTRUCCIÓN (sesión 2, 2026-09-11)**: contrato v1.68 + ARCHITECTURE §4.48 commiteados (`d9bd43f`); backend B1 (reserva con dueño, M-53), B2 (invariante S en buylist, guarda de disputas) y frontend (M5/checkout/pedidos) en paralelo; **P-68 (FX) serializado tras D-GT-1** (D-SB-3). Dinero ⇒ triple veredicto. Decisiones vetables del dueño en §4.48.10 (caducidad 60 min de la orden de bóveda; sin FX rige la última cifra persistida) | arquitecto → backend + frontend | 2026-09-11 | `docs/ARCHITECTURE.md:22290-22600`; `git log d9bd43f..HEAD -- backend/src/modules/orders backend/src/modules/buylist` |
| **P-78** | ✅ **Diseño (§34, `5a606f3`) y contrato (v1.69 + ARCHITECTURE §4.49, `4e97de2`) CERRADOS el 2026-09-11**; falta construir (backend BK-1..6 + frontend FE-1..4) y la revisión de **seguridad** (PII). **Medición del orquestador 2026-09-11 ~19:15 UTC que zanja la contradicción entre los dos documentos**: el diseño afirmaba que conservar `ResponseContentDisposition: 'attachment'` impide pintar la INE en un `<img>` y pedía un endpoint proxy; el contrato afirmaba lo contrario. Medí con Chromium real (`scratchpad/orq-disposition/probe.js`, **3/3 tiradas**): con la cabecera puesta, la imagen **sí se decodifica en un `<img>`** (`naturalWidth` = ancho real, igual que el control sin cabecera), y la **navegación directa a esa misma URL sí dispara descarga** (`Download is starting`). O sea: **gana el contrato** — se conserva `attachment`, **no hace falta proxy**, y S-B3 sigue protegiendo lo único que protegía (que el objeto no se abra como documento de primer nivel). La página de la prueba era `about:blank` y la imagen venía de otro origen, así que el caso cruzado de producción queda cubierto. **Corrección pendiente de redacción**: §34 (ux-ui) debe retirar la premisa A1 y su recomendación de proxy; §M6-K.2 (arquitecto) debe dejar de decir «el objeto nunca se renderiza inline» — sí se renderiza en `<img>`, lo que no puede es navegarse. **Decisión del orquestador sobre lo que escaló el arquitecto**: el `422 BUYLIST_LIMIT_EXCEEDED (per_month)` que aún emite `capCents`/`wouldBeCents` al vendedor **se serializa a la revisión siguiente**, no entra en v1.69 — esa superficie de error es de Stream B y QA la está midiendo contra v1.68.1; tocarla ahora invalidaría su medición. Antes fue: 🔴 **La verificación de identidad NO CIERRA por ningún lado** (hallazgo del dueño, 2026-09-11, sobre la release publicada `c8bee65`). Medido: las imágenes de INE **se guardan** (`KycProfile.ineFrontKey/ineBackKey`) pero **nadie puede abrirlas** — la proyección de admin las excluye a propósito y solo deriva `ineOnFile` (`admin.service.ts:40-45,67-68,197`); **no existe ninguna ruta de lectura** (`uploads.controller.ts` solo tiene `POST /uploads/presign`), aunque la capacidad está escrita y sin usar (`uploads.service.ts:154` `presignGet`, 300 s); las llaves **nunca llegan al navegador** (grep en `frontend/src`: solo el cliente al subir). Consecuencia: el panel deja marcar «verificado» sin haber visto nada, y el cliente ve «Pendiente» **sin ninguna acción** cuando ya subió todo (`KycSection.tsx:68` solo ofrece subir si `!ineOnFile`). Además los **topes** se le muestran al cliente (`account.kyc.capPerRequest/capPerMonth`) y el umbral viaja en `INE_REQUIRED`. **Decisiones del dueño ya tomadas** (`HECHOS.md`): solo super_admin ve las imágenes; rechazo **con motivo** que llega al cliente; **quitar los topes** de la vista del cliente (pantalla y error); la vista de revisión muestra la INE **junto al nombre y direcciones** para cotejar contra el destino de envío. **PII ⇒ pasa por arquitecto y por seguridad**; registro de quién miró cada documento. | arquitecto + ux-ui → backend + frontend → seguridad | 2026-09-11 | `backend/src/modules/uploads/uploads.service.ts:154`; `backend/src/modules/admin/admin.service.ts:40-45`; `frontend/src/components/domain/account/KycSection.tsx:68` |
| **P-79** | 🔴 **El sellado: tres defectos distintos que el dueño vive como uno** (reporte con captura 2026-09-11 sobre `c8bee65`; **medido por el orquestador el 2026-09-11 ~19:30 UTC**, fichero:línea verificados a mano, no relayados). **(c) Lo que él VE — la cola de M1 no sabe pintar sellado.** `frontend/src/app/[locale]/(admin)/admin/m1/PendingPublishQueue.tsx:139-141` imprime siempre `setName · number · finish`; **`grep -c productType` en ese fichero = 0**: no hay rama de sellado. Y aunque la hubiera, **el DTO no trae con qué pintarlo** (`frontend/src/types/contract.ts:2581-2599` y la proyección `backend/src/modules/inventory/inventory.service.ts:1803-1821` no llevan `sealedProductName`). El `Weedle · 1` y el `Spinarak · 1` **no son su producto convertido en carta**: son la **carta ancla** del set, que el sellado usa solo para satisfacer una columna obligatoria y que el propio código declara «deja de ser identidad» (`inventory.service.ts:820-829`, `resolveAnchorCardId`, menor `numberPrefix/numberSort`). En la base el `productType: 'sealed'` y el `sealedProductId` **están intactos** — se pierde solo en la pantalla. La cola de **M2 sí ramifica bien** (`m2/sections/PendingQueueSection.tsx:35`): a M1 nunca se le hizo ese trabajo. Dueños: **arquitecto** (el DTO necesita `sealedProductName` ⇒ cambio de contrato, regla 9) → **backend** (proyección) + **frontend** (rama de sellado). **(d) Por qué poner precios en M2 NO SIRVE — la llave divergente del alta por LOTE.** El alta **single** escala el pendiente con `sealedMarketGradeKey(tcgplayerProductId)` = `sealed:tcg:<id>` (`inventory.service.ts:586-590`), pero el alta **por lote** —que es la que dispara `SealedAddFlow` y por tanto **la que usa la app publicada**— pasa `r.gradeKey` tal cual (`inventory.service.ts:1144-1155`), y `gradeKey` para sellado es **la constante `'sealed'`** (`backend/src/modules/pricing/pricing.types.ts:682-684`). La publicación, en cambio, lee por `sealedMarketGradeKeyForItem(item)` = `sealed:tcg:<id>` (`inventory.service.ts:1557`). **Se escribe en una llave y se lee de otra**, así que el precio fijado en M2 es ilegible para la publicación y la pieza vuelve a la cola: el bucle exacto que él describe. Las dos llaves existen a propósito (`'sealed'` es la del override manual, §4.19d); el defecto es que el camino de lote escala el **pendiente de mercado** bajo la llave del **override manual**. Agravante: con `tcgplayerProductId` nulo, `:1557` ni siquiera consulta referencia (`gk ? … : undefined`) ⇒ ilegible por construcción. **Es dinero y no está escrito en ningún pendiente previo.** Dueño: **backend**. **(b) El MX$1,300.00 repetido: la promesa se cumple, el diseño lo empuja.** Medido: **ningún** camino copia `acquisitionCostCents` a `listPriceCents` (40 hits, todos COGS/valuación); el único write en alta es `inventory.service.ts:1067` (`dto.listPriceCents ?? null`) y el alta por lote no lo manda. Pero **publicar un sellado EXIGE precio manual**: `frontend/src/app/[locale]/(admin)/admin/m1/ItemDetailModal.tsx:64-66` (`sealedNeedsPrice`) bloquea si no hay `listPriceCents`. O sea: el producto **obliga al operador a inventar el número** que la cola promete no capturar. Lo más probable es que el 1,300 lo tecleara él, empujado por (d). **NO MEDIDO**: el `listPriceCents` real de INV-001944/945, que exige consulta a la base de producción. **(a) El precio de mercado no jala al capturar** = **P-69, re-medido hoy y VIGENTE sin tocar**: `sealedPriceSource` sigue con **0 consumos** en `frontend/src` (el único hit es un comentario, `SealedAddFlow.tsx:167`), y el paso 1 sigue keyeándose en `product.marketRef` sin gatear (`SealedProductPicker.tsx:217`) mientras el paso 2 usa el autoritativo (`SealedAddFlow.tsx:172`). Escalón previo: **P-46** (set sin grupo TCGCSV ⇒ sellado sin `tcgplayerProductId` ⇒ sin mercado) — **Chaos Rising, uno de los dos sets de su captura, está nombrado literalmente en esa fila**, y P-46 sigue **sin verificar en producción**. **Cobertura: NO EXISTE, y por eso pasó inadvertido.** `backend/test/inventory.sealed-product-alta.spec.ts:146-152` sólo prueba `aportacion_en_especie`; los casos con `'compra'` (`:327`) son rechazos. `inventory.pending-publish.spec.ts:34,66` usa sólo `productType: 'raw'`. `PendingPublishQueue.test.tsx` idem. Playwright no da de alta ningún sellado. Y la asimetría de (d) es invisible porque `inventory.sealed-product-alta.spec.ts:196` fija la llave correcta **sobre `createItem` (single)**, no sobre el lote que usa la app. **Dinero ⇒ triple veredicto.** Orden propuesto: (d) primero —es el que rompe el ciclo—, luego (c), luego (a)/P-69. No se enruta hasta que Stream B fusione: (c) y (d) tocan `inventory` y el contrato, zonas que ahora mismo no están libres. | backend (d) · arquitecto → backend + frontend (c) · frontend + backend (a) | **2026-09-11 ~19:30 UTC (orquestador, verificado a mano)** | `inventory.service.ts:1144-1155` vs `:586-590` vs `:1557`; `pricing.types.ts:682-684`; `PendingPublishQueue.tsx:139-141` (`grep -c productType` = 0); `ItemDetailModal.tsx:64-66` |
| **P-80** | ⚠️ **Stripe vive DENTRO de la transacción del checkout y retiene su conexión toda la latencia del proveedor** — mecanismo **medido, real y reproducible** por backend el 2026-09-11 (`cae1fc1`, contra Postgres real con el pool de CI, doble de Stripe con retardo inyectable, N=6 sustituciones concurrentes de clientes distintos): con 2 s de latencia **6/6 en 201, 0 timeouts, 3/3 tiradas**; con 12 s, **5/6 en 201 y 1/6 en `500` «Timed out fetching a new connection from the connection pool (timeout: 10, limit: 5)», 3/3 tiradas**. A la escala que pidió QA **no se manifiesta**, y la propiedad de dinero aguanta en los dos casos (cero piezas con dos órdenes `pending`). **Acotado, no eliminado**: el SDK de Stripe traía `timeout` por defecto de **80 s**, **2,6× el `timeout: 30_000` de la transacción** — o sea que el proveedor decidía cuánto duraba nuestra transacción. Backend lo fijó en **8 s**, así que el peor caso (1 intento + 2 reintentos) son 24 s y la transacción siempre gana al SDK. Pero con 24 s de conexión retenida, **un N suficientemente alto sigue agotando el pool**. **Sacar la cancelación de Stripe fuera de la transacción es cambio de diseño y NO lo toca backend** (regla 9): «cancelar antes de crear» es justo lo que impide que dos intentos de pago cobren la misma pieza (`ARCHITECTURE.md` §4.48.2). **Dinero ⇒ triple veredicto.** | **arquitecto** (decide el diseño) → backend | 2026-09-11 (medido por backend, mecanismo verificado con proporciones) | `backend/test/integration/stripe-in-tx-pool.e2e-spec.ts`; `backend/src/modules/payments/stripe.service.ts` (`TIMEOUT_MS`); `docs/ARCHITECTURE.md` §4.48.2 |
| **DO-D2** | ⚠️ **La comprobación de cierre de DO-D2 no se puede cumplir mientras falten los cinco secrets de CD** (medido por devops el 2026-09-11 sobre el run `34633179107`): los jobs `promote-production-*` nunca llegan a evaluar `blocking=false` porque `secrets-gate` emite `ready=false` y todo lo demás cuelga por `needs`. No es un fallo nuevo — los deploys reales van por las integraciones nativas — pero **exige una decisión del dueño**: activar el CD por Actions cargando `RAILWAY_TOKEN`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` y `PROD_BASE_URL`, **o** declarar que esos jobs sobran y retirarlos. **No es una petición al dueño todavía** (O-6): se le plantea cuando haya que cerrar DO-D2, no antes. | HUMANO (decide) · devops (ejecuta) | 2026-09-11 | `docs/TECH_DEBT.md` DO-D2; `docs/DEVOPS_NOTES.md` §57.4 |
| **P-81** | ⚠️ **§M5-S tiene una tercera rama que el contrato no nombra** (desviación **preexistente**, hecha legible por backend el 2026-09-11, no introducida por Stream B). El contrato dice «terminal ∨ `closedAt ≠ null` ⇒ `CONFLICT`; **en otro caso** ⇒ `INVALID_TRANSITION`». La rama de la **carrera** (dos operadores tocan el mismo paso a la vez) cae en «otro caso» por la letra, pero el código responde `CONFLICT` desde v1.68. Backend solo añadió `details.reason: 'CONCURRENT_UPDATE'` y un aviso al registro para que deje de mentir; **zanjarla es del contrato**: o pasa a `INVALID_TRANSITION`, o se declara `CONFLICT` con su `reason` escrito. | **arquitecto** | 2026-09-11 (medido por backend; desviación verificada contra el contrato) | `backend/src/modules/buylist/buylist.service.ts` (`throwStepRejected`); `docs/API_CONTRACT.md` §M5-S |
| **RSV-L1** | ⚠️ **La rama legada `reservedByOrderId IS NULL` sigue en TRES sitios** (`reservation.ts:39-44`, `payments.service.ts:642-650`, `guest-checkout.service.ts:435-445`), medido con `grep` el 2026-09-11. Deuda registrada, **no bloqueante**. Su cierre tiene **dos mitades y las dos hacen falta**: que la cuenta `SELECT count(*) … WHERE reservedByOrderId IS NULL` sea **0 en producción** (hoy **NO MEDIDA** — es del cierre de release, necesita ventana) **y** que los tres sitios se retiren. Retirarlos antes de que la cuenta sea 0 rompería reservas vivas. | backend (retira) · orquestador/humano (mide la cuenta) | 2026-09-11 (árbol medido; producción NO MEDIDA) | `docs/TECH_DEBT.md` RSV-L1 |
| **Stream C** | El disco (P-53) | backend | 2026-09-11 | ídem |
| H1 | Protección de ramas `main`/`production` (required checks `ci-ok`/`sast-ok`/`e2e-ok`; ruleset JSON en `docs/DEVOPS_NOTES.md` §56.8). Consecuencia: un push directo solo pasa si el SHA ya tiene los 3 checks verdes — **DECISIÓN DEL DUEÑO** | HUMANO (decide) · devops (activa) | 2026-09-11 | `GET /repos/…/rulesets` → `[]` (medido) |
| DO-D4 | `dast-release` en `report_only: true` hasta que **seguridad** lo suba a bloqueante; caduca el **2026-10-06** (job `dast-report-only-expiry` pone rojo CI) | seguridad (decide) · devops | 2026-09-11 | `grep -c 'report_only: true' .github/workflows/deploy.yml` |
| Deuda gates 2026-09-11 | Fichas nuevas con comprobación de cierre: backend BE-82..87, frontend GA-D1..D7, devops DO-D1..D10 (incl. DO-D2/DO-D3: se cierran con el primer push real a `production`) | rol dueño de cada ficha | 2026-09-11 | `docs/TECH_DEBT.md` bloques «… · 2026-09-11 · gates …» |
| Arquitecto (post-A) | Peticiones abiertas del stream: `orderNumber` en `OrderSummaryDTO`/`OrderDetailDTO` (hoy la columna PEDIDO muestra UUID contra backend real); `customer {id,name,email}` en fila de M4; BE-82 (`details.field` en «ausente» requiere `exceptionFactory`); preguntas §4.47.9 al dueño (allowlist de `PATCH /users/me`, edición de nombre por admin, correos del buylist con nombre derivado) | arquitecto → backend/frontend | 2026-09-11 | `docs/FRONTEND_NOTES.md` §68.4; `docs/ARCHITECTURE.md` §4.47.9 |
| P-IVA-INCL | Precio con IVA incluido, sin línea aparte. **DEPLOY 2 SÍ está especificado** en contrato (§M10-IVA.6, `docs/API_CONTRACT.md:17107-17121`); falta implementarlo y la decisión de «cómo se muestra» | product-owner → arquitecto → frontend+backend | 2026-09-11 | `AmountBreakdown.tsx:82`, `orders.service.ts:592` (`IVA_EXCLUSIVE`); cero escritores de `IVA_INCLUSIVE` en producción |
| P-BL | Stream buylist v1.59/v1.60: **1 de 7 cerrado** (`legalName`, `admin.service.ts:47,55-68`). §M5-D abierto (las 4 estructuras siguen); §M5-A **desalineado**: backend emite `scope: per_request`/`per_request_offer` (`buylist.service.ts:1585,3587`) y el frontend ya los retiró (`error-audience.ts:42`); §M5-I, boundary, BL-42, D50 abiertos | backend (arquitecto para D50) | 2026-09-11 | `grep -n BUYLIST_CAP_PER_REQUEST_CENTS backend/src/modules/settings/settings.constants.ts` → `:77,289,949,1058`; `HISTORIAL.md:110-166` |
| P-53 | Disco: `PriceReference` una fila/producto/día; `evidenceDate` **ni se escribe ni se lee** (9/9 hits son el DTO de un proveedor) | backend | 2026-09-11 | `backend/src/modules/catalog/card-product-resolver.service.ts:201,218-233`; `schema.prisma:967` |
| P-56 | Wishlist (money-critical) — cero rastro en el árbol | arquitecto → backend+frontend | 2026-09-11 | `grep -rni wishlist backend/src frontend/src docs` → 0; falta alcance (product-owner) |
| P-58 | «Marcar recibida»: el botón vive **solo en `cotizada`** (el paso equivocado, `M5View.tsx:991`), no «en cualquier estado»; el servidor sí acepta desde cualquier estado vivo (`buylist.service.ts:5492` → `liveRequestWhere()` `:5654`) | frontend (mitad 1) · arquitecto → backend | 2026-09-11 | `buylist.service.ts:5492,5654`; `M5View.tsx:991-1001` |
| P-59 | La reserva no conoce a su dueño: `where` sin eje de usuario/sesión; invitado ni escribe titularidad | arquitecto → backend | 2026-09-11 | `orders.service.ts:431,436`; `guest-checkout.service.ts:141`; TTL `guest-checkout.constants.ts:43` |
| P-60 | Entregabilidad: falta DMARC | **HUMANO** (DNS) | — | registro DMARC en el DNS de `tcghunt.mx` |
| P-61 | Catálogo de Vender se ve chico: carrito lateral fijo de 360 px en escritorio; drawer solo móvil | ux-ui → frontend | 2026-09-11 | `BuylistView.tsx:323,350-352,386-387` |
| P-65 | Fotos 5–10 s: los cuatro eslabones siguen en serie; cuál pesa NO MEDIBLE sin levantar la app | frontend; arquitecto si toca API | 2026-09-11 | `(storefront)/page.tsx:1`; `(storefront)/_home/FeaturedCarousel.tsx:708`; `CardImage.tsx:72-78` |
| P-66 | Panel de admin: **8 de 9 puntos abiertos** (B2 requiere navegador); ni el copy «beta cerrada» aprobado por el dueño se corrigió (`es.json:2539`) | ux-ui → frontend | 2026-09-11 | cuerpo del ítem; `git diff --stat 9ff373f..HEAD -- "(admin)"` = solo M10 y M2 |
| P-67 | Inventario de datos para analytics — no existe doc ni sección | arquitecto/backend → product-owner | 2026-09-11 | `ls docs/`; `grep -rni analytics docs/ PROJECT.md` → 0 |
| P-68 | FX: modo por defecto = centinela `legacy`; lo decide `fx_manual_override_rate`; fallback duro 18 | devops (consulta) · backend | 2026-09-11 | `fx-mode.ts:285-293` (antes `:157`), `:56,380`; `fx.service.ts:153-154,340` (antes `:85`); la SQL vive solo en el cuerpo |
| P-69 | Precio de mercado se pierde entre paso 1 y 2 al subir sellado; `sealedPriceSource` viaja y nadie lo consume | backend/frontend | 2026-09-11 | `SealedAddFlow.tsx:172`; `sealed-product.service.ts:65` (antes `:63`); `grep sealedPriceSource SealedAddFlow.tsx` → 0 |
| P-70 | Decks Meta — **bloqueante CAMBIÓ**: `pricing-iva-v2.1` ya tiene cuerpo (= `PROJECT.md` §Q / D54, `:5708-5714`); encadenado a P-IVA-INCL DEPLOY 2 publicado | product-owner → … | 2026-09-11 | `docs/specs/DECKS_META_V1.md:14`; `money.ts:379` (antes `:374`); `API_CONTRACT.md:17109` |
| P-71 | Código corto del set: `ptcgoCode` se guarda y **nadie lo lee** (cero en `frontend/src` y en el contrato) | backend (ingesta) + frontend | 2026-09-11 | `schema.prisma:510` (antes `:497`); `catalog-sync.service.ts:1294,1304` (antes `:918`) |
| P-72 | «SIN PRECIO RESOLUBLE» dice dos cosas: el DTO de la cola no lleva `pendingReason` (`contract.ts:2396-2414`); copy único `es.json:1232` | frontend + arquitecto | 2026-09-11 | `pricing.service.ts:877`; `pricing-curve.ts:566-574`; `inventory.service.ts:359-360` |
| P-46 | Sincronizar sellado «0 presentaciones»: **CERRADO EN CÓDIGO** (`47c97c1`, dentro de `c13f417`: match tolerante al prefijo, `sealed-product.service.ts:777-798`). **Falta verificar en producción** (sync de Pitch Black / Chaos Rising) y el follow-up de frontend (guiar al linker cuando da 0). Singles siguen sin el arreglo (`card-product-resolver.service.ts:225-238`) | HUMANO/orquestador (verificar) · frontend (follow-up) | 2026-09-11 | correr la sync en producción y contar presentaciones |
| Razón social | Footer imprime «TCG HUNT · tcghunt.mx · © 2026» sin placeholder (`layout.tsx:58-65`, `footer.ts:13-18`); falta el dato del dueño | **HUMANO** | 2026-09-11 | `es.json:11` / `en.json:11` |
| Seguridad · release A | **Veredicto 2026-09-11 sobre `abecf73`: APROBADO CON CONDICIONES para modo prueba; dinero real BLOQUEADO** por: **C6** (devops + humano: en ventana autorizada, 6 logins a prod con `X-Forwarded-For` rotatorio ⇒ 429 al 6.º, 6/6, y anotar cabeceras reales tras el edge de Railway), **C7** (backend: throttle por identidad — login/google/register por email, change-password por userId — y test que fije `trust proxy=1`), **C2-bis** (devops: retirar `report_only: true` de `dast-release` ≤ 2026-09-25), **P-GL-2** (devops: exención de gitleaks por valor, no por ruta `docs/*.md`/`security/*`), **P-SEED-1** (backend: `assertSeedTarget` rechaza `?host=`/`options` de libpq), **S-NAT-1** (devops: `secrets.env` a 0600), **P-REDIR-1** (frontend: `safeNext` rechaza `\`/`%5C`). Rutas de backend ocupadas por Stream B: enrutar C7/P-SEED-1 al cerrar B | devops · backend · frontend · humano (C6) | 2026-09-11 | `docs/SECURITY_NOTES.md` bloque superior; `docs/PENTEST_NOTES.md` bloque superior |
| Seguridad C3 | Condición C3 del veredicto (humano/QA: `gh run view 34538020057 --log \| grep -m1 "Smoke (real) specs:"` con `checkout`, `guest-checkout`, `shipments`). **C1, C2 (parte medible), C4 y C5 cerradas en `main` el 2026-09-11** (ver `HISTORIAL.md` → «FUSIONADO … Stream A + andamiaje de CI»); C2 residual **cerrado el 2026-09-11** (medido por el orquestador): el primer push a `production` (`c8bee65`) disparó el `dast-release` real y salió **verde** — run `34633179107`, trabajos «Autoprueba del candado (canario vulnerable)» y «DAST contra el stack efímero», ambos `success`; queda solo DO-D3 | humano (C3) · devops (DO-D2) | 2026-09-11 | `docs/SECURITY_NOTES.md:237-249`; `docs/TECH_DEBT.md` DO-D2 |
---

# SIGUIENTE RELEASE — «LA CUENTA DEL CLIENTE» (aprobado por el humano, 2026-09-10)

### Añadidos 2026-09-11 02:35 UTC (durante la publicación de `c9ba265`)

- **P-IVA-INCL · Precio con IVA incluido, sin línea aparte (`IVA_INCLUSIVE`).** Decisión del dueño 2026-09-11:
  «ponlo como pendiente». Hoy el cliente ve «MXN sin IVA» en catálogo y una línea «IVA 16%» en checkout
  (`frontend/src/components/ui/AmountBreakdown.tsx:82`, `frontend/messages/es.json:315`); M-50 ya deja cada
  pedido marcado con su convención (`orders.service.ts:586`, `guest-checkout.service.ts:163`). Falta: el
  DEPLOY 2 de M-50 (contrato §M10-IVA) — decisión de product-owner/arquitecto sobre cómo se muestra, y
  frontend+backend. **Dinero ⇒ triple veredicto.** No medido: qué dice el contrato hoy sobre DEPLOY 2.

> Arranca **en cuanto se publique el release actual**. Tres work streams **disjuntos** por el mapa de
> módulos de `CLAUDE.md`, así que corren **en paralelo** sin pisarse. Una sesión = un stream = una rama.

## 🥇 Stream A — «La cuenta del cliente» (el principal)
> ✅ **FUSIONADO en `main` el 2026-09-11** (sesión 2; QA + techlead aprobados; 79 commits). Lo de abajo se conserva verbatim como alcance del stream. Falta el **release**: fase de seguridad + checklist de despliegue (`ARCHITECTURE.md` §4.47.10.4).
**Módulos:** backend `auth`, `users`, `settings`, `mail` · frontend `(auth)` y perfil.
**Rama sugerida:** `claude/cuenta-del-cliente`

| Pendiente | Qué le pasa hoy al cliente |
|---|---|
| **P-57(a)** | **No existe pantalla de perfil.** No puede ver ni cambiar correo, direcciones, facturación ni estado de verificación. ⭐ **El servidor YA lo expone todo** (`GET`/`PATCH /users/me`, direcciones, facturación, KYC): **falta solo la pantalla.** |
| **P-57(b)** | ⭐⭐ **Cada compra de invitado no reclamada en el momento se queda FUERA DE LA BÓVEDA PARA SIEMPRE.** El mecanismo existe entero y bien hecho; `GET /orders/claimable` **no lo consume nadie**. Ubicación decidida con el humano: aviso **en la bóveda** y en pedidos. |
| **P-73** | Entrar con Google **inventa un nombre** que nadie puede corregir, y los envíos salen **sin destinatario**. |
| **P-75** | Se le dice *«debes cambiar tu contraseña»* **y no hay dónde hacerlo**. El ciclo no cierra. |
| **P-55** | Arma el carrito de venta, inicia sesión, **y lo pierde**. |

**Por qué juntos y por qué primero:** son cinco síntomas de **una sola ausencia** —no hay «mi cuenta»—, y
P-57(b) cuesta bóvedas todos los días. La bóveda es la propuesta de valor.

## 🥈 Stream B — «Lo que se rompe con el dinero»
**Módulos:** backend `orders`, `shipments` · frontend `(storefront)` pedidos.
**Rama sugerida:** `claude/ordenes-pacto`

| Pendiente | Qué |
|---|---|
| **P-58** | 🔴 «Marcar recibida» se ofrece desde **cualquier estado** — se salta el pacto con el vendedor. |
| **P-59** | La reserva propia **bloquea el reintento del mismo cliente**. |

## 🥉 Stream C — «El disco»
**Módulos:** backend `pricing` · devops.
**Rama sugerida:** `claude/disco-pricing`

**P-53** — 28,559 filas/día (~13 MB/día) que en su mayoría **no cambian nada**. La cura está
identificada y no se ha implementado: la columna **`evidenceDate`** existe en el esquema y **nadie la
escribe ni la lee** — es el sitio para distinguir «el precio no cambió» de «el proveedor no respondió».
⚠️ Antes de tocar, re-medir: `sealed-catalog.service.ts:334` (gráfica por ventana) y
`hasRecentIngest()` (`price-ingest.service.ts:344`) **sí dependen** de que haya filas de hoy.

---

## ⛔ Lo que NO entra, y por qué

- **P-70 · Decks Meta.** Funcionalidad nueva y grande. **Su propio spec exige correr sola**, sin nada que
  toque `money.ts` ni el contrato. Mezclarla con arreglos hace que un problema en cualquiera detenga a
  los dos. **Va sola, después.** ⚠️ Y arrastra un bloqueante ya verificado: el spec cita
  `pricing-iva-v2.1`, que **no existe en este repo** — hay que preguntarle al humano qué es antes de
  arrancar.
- **P-60 · DMARC.** No es un release: son **diez minutos del humano** en el panel de su dominio. Sin eso
  los correos siguen cayendo en spam.
- **`D-GT-1` / `§M2-GT`** (el grupo TCGCSV de un set): techlead lo dejó fuera del release actual **en
  primera posición del siguiente**, serializado. **Cruza dos streams y toca dinero** ⇒ el orquestador lo
  serializa **antes** de que A, B o C toquen `catalog`/`pricing`/`inventory`, y va con triple veredicto.

## Zonas compartidas — serializar, no paralelizar
`backend/src/common/`, `backend/src/config/`, `backend/prisma/` (schema), `frontend/src/components/`,
`frontend/src/lib/`, `frontend/src/hooks/`, `docs/API_CONTRACT.md`. **Un solo stream a la vez**, y todo
cambio de contrato o de schema pasa por el arquitecto primero (regla 9).
⚠️ Aviso concreto: **A y B comparten `frontend/src/lib/verdict.ts` y `components/ui/VerdictNotice.tsx`**
si alguno toca avisos de resultado. Y **A toca `shipments` en P-73** (el destinatario), que es módulo de
**B** ⇒ **serializar ese punto**: lo hace A, y B no entra a `shipments` hasta que aterrice.

---

## Abiertos — cuerpos (verbatim)

### Infraestructura · Disco de la base de datos (2026-09-01)

#### P-53 · 💾 El disco de Postgres se llena por el ritmo de escritura del historial de precios — MITIGADO, falta la cura
- **Detectado por el humano:** alerta de Railway «High Volume Usage — postgres-volume is at 77% capacity».
- **✅ Mitigación aplicada (humano, 2026-09-01):** volumen ampliado. **El reloj de saturación se detuvo.**
  Queda pendiente anotar el tamaño nuevo y rehacer la proyección con él.
- **Medición real en producción (solo lectura, consola de Railway):**
  | Dato | Valor |
  |---|---|
  | Disco usado / disponible | 317 MB de 434 MB (75%) |
  | `pgdata/base` (datos) | 171 MB |
  | `pgdata/pg_wal` (bitácora) | **145 MB — 46% de lo ocupado** |
  | Base de datos completa | 148 MB |
  | `PriceReference` | **101 MB — 68% de la base** |
  | Filas de `PriceReference` | 222,614 (2026-08-17 → 2026-09-01, 16 días) ⇒ ~476 B/fila |
- **Causa raíz (confirmada por consulta, NO por hipótesis):** el **ingest de singles de TCGCSV** escribe
  **una fila por producto por día**, se muevan o no los precios. El 2026-08-28 el ritmo saltó de **2,062 a
  ~28,570 filas/día (×14)** y lleva 5 días sostenido — es el nuevo estado estable, no un pico.
  Desglose del día 2026-09-01: `tcgcsv_singles/raw:NM/market` **28,559** · `pokemonpricetracker/graded:PSA:10`
  12 · `graded:PSA:9` 6.
  ⚠ **Corrección registrada:** el orquestador atribuyó primero el salto al pipeline PSA. **Era falso** —
  el PSA aporta 18 filas de 28,577. La causa es el ingest de singles.
- **Proyección que motivó la ampliación:** ~13 MB/día contra 107 MB libres ⇒ saturación ≈ **2026-09-09**.
  Con el disco lleno Postgres **deja de aceptar escrituras** (sin pedidos, sin altas, sin capturas de
  inventario) y compactar la tabla exige espacio libre ≈ su propio tamaño (101 MB): esperar cerraba la
  puerta al arreglo, no solo al servicio.
- **⚠ Una política de retención por antigüedad NO resuelve esto.** El historial completo son 16 días: hoy
  «conservar 90 días» no borraría ni una fila. El problema es el **ritmo diario**, no la basura vieja.
  (El orquestador propuso retención antes de medir; queda anotado para no repetir el camino.)
- **Lo que sí queda por hacer:**
  - **(devops) Acotar el WAL.** 145 MB de bitácora con **cero replication slots** (verificado: la consulta a
    `pg_replication_slots` devolvió 0 filas ⇒ no hay fuga). Es Postgres con los valores de fábrica,
    dimensionados para un disco mucho mayor. Bajar `max_wal_size` recupera del orden de **100 MB**. Requiere
    reinicio de Postgres ⇒ **con respaldo y ventana**, no en caliente.
  - **(arquitecto → backend) Escribir menos por día.** Palanca de fondo: hoy se guarda una fila diaria por
    carta **aunque el precio no se haya movido**, y la mayoría no se mueve. Escribir solo ante cambio recorta
    el volumen de forma drástica.
    🔴 **Money-critical:** toca qué tan **fresco** se considera un precio (`capturedDate`/`evidenceDate`,
    `stale()`) y roza la regla «no se fabrican puntos» de las series del portafolio y de los sets. Mal hecho,
    una carta se queda con precio viejo **sin que nada avise**. Pasa por el **arquitecto** (regla 9) y exige
    **triple veredicto (QA + techlead + seguridad)** antes de producción.
  - **(devops) Vigilancia.** Hoy nos enteramos por la alerta de Railway al 77%. Falta un aviso propio del
    crecimiento del disco y del ritmo de filas/día, para no volver a descubrirlo a 8 días del tope.
- **Consultas de diagnóstico (solo lectura) para repetir la medición:** tamaño por tabla vía
  `pg_total_relation_size`; `du -sh /var/lib/postgresql/data/pgdata/*`; `pg_replication_slots`;
  `SELECT "capturedDate", count(*) FROM "PriceReference" GROUP BY 1 ORDER BY 1 DESC`.


### Encontrado por el humano en producción (2026-09-08, tras publicar el ciclo de compra)

#### P-56 · ⭐ WISHLIST del cliente — «dime qué buscas y te la consigo» — pedido por el humano
- **La idea:** el cliente arma una **lista de deseos** con las cartas que anda buscando. La plataforma
  le hace saber que **podría conseguírsela a cierto porcentaje por encima del mercado**.
- **Por qué es más que una lista:** hoy solo sabes qué te compran de lo que YA tienes. La wishlist te
  dice **qué te comprarían si lo tuvieras** — es tu demanda insatisfecha, medida, y hoy es invisible.
- **⚠️ Conecta con los bounties, y ése es el valor real.** El bounty es *«pago X por esta carta»*
  (oferta); la wishlist es *«alguien la quiere»* (demanda). **Una alimenta a la otra**: N clientes
  buscando la misma variante es exactamente la señal para levantar un bounty. Diseñar las dos sin
  mirarse sería construir dos mitades de lo mismo.
- **🔴 Money-critical, y no es obvio:** *«te la consigo a X% sobre mercado»* es **un compromiso de
  precio con el cliente**. Hay que decidir si es vinculante, cuánto dura, qué pasa si el mercado se
  mueve entre la promesa y la entrega, y cómo se cruza con la escalera de redondeo y el tope de
  compra. Pasa por **arquitecto** (regla 9) y exige **triple veredicto**.
- **Preguntas para el humano, sin asumir:** ¿el porcentaje es un dial global, por rareza, o por
  carta? ¿la promesa caduca? ¿se avisa al cliente cuando la conseguimos, y con qué plazo para que
  responda? ¿la wishlist es privada o alimenta un ranking público («las más buscadas»)?
- **Rol dueño:** arquitecto (diseño) → backend + frontend. **Sin empezar hasta que el humano cierre
  el alcance.**

#### P-58 · 🔴 «Marcar recibida» se ofrece desde CUALQUIER estado — se salta el pacto
- **Encontrado por el humano** mirando la pantalla; **seguridad lo había visto por el código** en su
  pase y lo dejó anotado. Dos caminos independientes, mismo hallazgo.
- **Medido:** la guarda de `receive` (`buylist.service.ts:5488`) es `liveRequestWhere()` — solo exige
  que la solicitud no esté cerrada, **no que esté en el paso correcto**. Y la interfaz ofrece el
  botón desde el paso 1.
- **Por qué importa, y no es cosmético:** desde **«Cotizada»** marcar recibida salta al paso 5 **sin
  que exista precio pactado ni aceptación del vendedor** — acabas con las cartas de alguien sin
  acuerdo. Desde **«Ofertada»** es peor: **le cierra la ventana al vendedor**, que ya no puede
  aceptar ni declinar.

- **⚠️⚠️ ANTES DE TOCAR LA GUARDA — LEER ESTO (medido 2026-09-08, y contradice la cura obvia).**
  La guarda **NO está floja por descuido: está por EXCLUSIÓN a propósito**, y el porqué está escrito
  en el bloque de documentación de `receive`. Los hechos que dejó quien la escribió:
  - **La mesa dispara los verbos EN CADENA.** En el incidente que originó la guarda, `receive` y
    `verify` se ejecutaron seguidos tras `confirm-shipment`, y **la bitácora real muestra
    `receive`→`verify` con 20 ms de diferencia**. No es un caso teórico: es cómo se trabaja.
  - Su regla, textual: *«Una guarda que rompe el trabajo legítimo del día siguiente no es más segura:
    es la que alguien acaba desactivando.»* Misma dirección que el **criterio 129** (estados vivos
    por complemento): olvidarse falla hacia el lado seguro.
  - El segundo término, `closedAt: null`, **no es redundante** aunque lo parezca: ya hubo en la base
    filas con `closedAt` sellado y estado no-terminal, y sobre ésas el término de estado por sí solo
    dejaba pasar la transición. *Una guarda no puede apoyarse en el invariante que el bug rompió.*
  ⇒ **Apretar a «solo desde el estado X» sin más inventaría una máquina de estados que la mesa no
  usa, y rompería la operación real.** Quien lo intente sin leer ese bloque va a romper algo que hoy
  funciona y a creer que lo arregló.

- **Cómo se cierra bien, en dos mitades separables:**
  1. **La barata y sin riesgo (hacer ya):** que **la interfaz no ofrezca el botón donde no toca**.
     Eso quita el 100% del camino accidental —que es como lo encontró el humano— **sin tocar la
     guarda del servidor**. Rol: **frontend**.
  2. **La de fondo (decisión, no parche):** ¿desde qué estados es legítimo `receive`? Lo decide el
     **arquitecto**, y con las dos evidencias delante: el agujero del pacto **y** el encadenamiento
     de 20 ms de la mesa. Si de ahí sale una guarda más apretada, la escribe **backend**.
- **Rol dueño:** frontend (mitad 1, ya) · arquitecto → backend (mitad 2, con la evidencia de arriba).

#### P-59 · 🛑 La reserva propia bloquea el reintento del mismo cliente
- **Encontrado por el humano:** se le congeló el pago, reintentó, y **la carta ya no estaba** —
  la había reservado su propio intento fallido.
- **Medido:** el inventario se reserva **60 minutos** (`GUEST_ORDER_RESERVATION_TTL_MIN`) y un
  barrido cada 15 minutos libera lo no pagado. **No se pierde nada** — pero el cliente espera hasta
  una hora por un pago que se le cayó, y ve «no disponible» sin explicación.
- **Lo correcto:** que el mismo cliente/sesión **recupere su propia reserva** al reintentar, en vez
  de chocar contra ella. **Rol dueño:** arquitecto → backend.

#### P-60 · ✉️ Entregabilidad del correo: falta DMARC y el dominio es nuevo
- **Medido:** el correo de la oferta **se mandó y se entregó** (Resend: `Delivered`) — y **cayó en
  spam** en Hotmail. No es defecto de código: es reputación. `tcghunt.mx` tiene 17 días y **dos
  correos en 15 días**; SPF y DKIM verificados, **DMARC ausente**.
- **⚠️ Por qué urge más de lo que parece:** el correo de **verificación de cuenta** es la puerta de
  entrada — sin verificar, el sistema **bloquea comprar y vender**. Si ese correo cae en spam, el
  usuario nuevo se va y **nadie se entera**.
- **Acción (humano/devops):** registro TXT `_dmarc` con `v=DMARC1; p=none; rua=mailto:…` (modo
  observación, sin riesgo); marcar los correos como «no es spam»; el volumen hace el resto.

#### P-61 · 🖼️ El catálogo de Vender se ve chico — carrito a pop-up
- **Propuesta del humano:** mover el carrito a un pop-up y usar ese espacio para mostrar las cartas
  más grandes, como en el inventario de admin.
- **⚠️ Restricción que el diseño debe respetar:** ese panel carga hoy **dos cosas que no pueden
  esconderse**: la llamada a **iniciar sesión** (es donde el vendedor descubre que necesita cuenta) y
  el mensaje de que **la guía la ponemos nosotros y no paga nada de su bolsillo** (responde la duda
  que frena al vendedor primerizo). Hay que **reubicarlas**, no solo mover el carrito.
- **Rol dueño:** ux-ui → frontend.


#### P-65 · 🖼️ Las fotos tardan 5–10 s en aparecer — reportado por el humano
- **Medido en el código (no supuesto): no es una causa, son cuatro eslabones EN SERIE.**
  1. **La home y el catálogo son pantallas de cliente** (`'use client'` + TanStack Query en
     `frontend/src/app/[locale]/(storefront)/page.tsx`). Antes de que exista siquiera la *dirección*
     de la primera foto hay que: bajar el HTML → bajar y arrancar el JavaScript → preguntar al
     backend → recibir respuesta. **La foto empieza a bajarse en el cuarto viaje, no en el primero.**
  2. **La teja líder del carrusel pide la imagen HD** (`FeaturedCarousel.tsx:708`,
     `imageLargeUrl` → `_hires.png` de pokemontcg.io: cientos de KB, frente a las ~40–60 KB de la
     chica). Es justo la imagen que decide cuándo el visitante siente que «ya cargó la página».
  3. **Las fotos no pasan por nosotros.** Todas se piden directo a `images.pokemontcg.io` con `<img>`
     plano (`components/ui/CardImage.tsx`): ni las redimensionamos, ni las convertimos a formato
     moderno, ni las guardamos en caché propia. Cada visitante paga el viaje al servidor del
     proveedor, con su latencia y el peso original.
     - ⚠️ **CORRECCIÓN (2026-09-08, mía).** Aquí decía que *«el único sitio del front que usa el
       optimizador de Next es el logo de expansión (`SetPlate.tsx`)»*. **Es falso.** Lo deduje de que
       un `grep` de `next/image` devolvía ese fichero — y **la coincidencia era un COMENTARIO** que
       dice literalmente *«sin next/image»*. **No hay una sola línea de `next/image` en el frontend**:
       todas las imágenes son `<img>` crudo (Nivel B, `ARCHITECTURE §4.41.7`). Propagué el error a un
       encargo de seguridad y ahí hizo ver un riesgo más pequeño de lo que era; lo cazó el agente al
       verificar en vez de ejecutar. **La lección: un `grep` dice dónde aparece un texto, no qué hace
       el código.**
  4. Las demás van en `lazy` y eso **está bien** — no es ahí donde se van los segundos.
- **Lo que NO pude medir desde aquí, y decide cuál es la cura:** este contenedor tiene bloqueada la
  salida a internet (`tcghunt.mx` e `images.pokemontcg.io` devuelven 403 en el proxy), así que **no
  sé cuál de los cuatro eslabones se lleva los segundos**. La distinción no es un detalle: si el que
  tarda es el backend (Railway despertando, o la consulta de catálogo), optimizar imágenes **no
  arregla nada**.
  - **Dato que el humano da en un minuto:** F12 → pestaña **Red** → recargar → decir (a) cuánto tarda
    la llamada al backend y (b) cuánto tarda la primera foto. Con eso se sabe qué atacar.
- **Palancas, de más barata a más cara** (todas reales, ninguna aplicada):
  - **(a)** usar la imagen chica también en la teja líder — una línea, ahorra cientos de KB en la
    imagen que marca el tiempo percibido;
  - **(b)** servir las fotos por el optimizador de Next/Vercel (redimensiona + WebP + caché en el
    borde) — cambio acotado en `CardImage`. ⚠️ consume cuota de Vercel, **que ya está al 75%**;
  - **(c)** pintar la primera pantalla en el servidor, para que la foto empiece a bajar en el primer
    viaje y no en el cuarto — cambio grande: es rediseñar cómo carga la home;
  - **(d)** copiar las fotos a almacenamiento propio (R2) y servirlas desde ahí — quita la
    dependencia del tercero; es un proyecto aparte.
- **Cruce:** (b) y (d) tocan `remotePatterns` de `frontend/next.config.mjs`, hoy abierto a
  `hostname: '**'` (cualquier host) — mismo terreno que la deuda **M47-R1**.
- **Rol dueño:** frontend para (a) y (b); arquitecto si se va a (c) o (d).
  **Antes de tocar nada: la medición del navegador.**

#### P-66 · 🧟 Dar una vuelta al panel de administración — ✅ DIAGNOSTICADO (ux-review, 2026-09-08) · **VEREDICTO: RECHAZADO**
- **Pedido del humano:** *«siento que tenemos varios zombies ahí que no nos ayudan, o temas de navegabilidad»*.
- **Cómo se midió:** bundle de producción con mocks recompilado sobre `9ff373f`, recorrido en Chromium a
  **1280×800 y 390×844**, como `super_admin` y como `vault_operator`. Lo no medido va marcado como tal.

##### 🔴 Bloqueantes
- **B1 · M5 (Buylist) enseña TODO lo que existe, no lo que toca ahora.** **Diez pestañas en dos barras
  apiladas** (4 «colas del ciclo» + 6 de estado) y dos jerarquías en la misma pantalla. En «Verificando»,
  una solicitud de 3 cartas pinta **14 botones**; con 4 solicitudes es una pared, y **«Pagar por SPEI»
  —dinero— queda al fondo**. La única pista de qué toca ahora va en 11 px. Y la lista de solicitudes
  empieza a **≈660 px en escritorio y ≈880 px en móvil** (bajo el pliegue): esto es, literalmente, lo que
  el humano llamó *«súper escondidas»*. **Rol:** ux-ui → frontend.
  - ⚠️ **P-58 confirmado y precisado:** «Marcar recibida» **no es una fuga** — está cableado a `status ===
    'cotizada'` **a propósito**, o sea exactamente al paso donde no debería estar.
- **B2 · Tres pantallas DESBORDAN en 390 px** (medido, `scrollWidth − innerWidth`): **M5 +419 px**
  (la página se renderiza a 809 px: hay que hacer scroll lateral para llegar a «AUTORIZAR Y MANDAR»),
  **M1 +89 px**, **M2 +35 px**. Las tres se saltan `DataTable`, que **sí** colapsa a tarjetas. *(Bounties
  ya no desborda: 0 px, verificado.)* **Rol:** frontend. ⚠️ **Si el humano no usa el teléfono, baja a
  importante** — es la pregunta 1 de abajo.
- **B3 · Las pantallas de dinero hablan en identificadores, no en personas.** M3 y M4 pintan `u-777`,
  `u-778` como «usuario»: para saber a quién le vendió hay que ir a M6 con el id en la cabeza. M10 pinta
  `u-admin`/`SUPER_ADMIN`/`settings.update`; M6 pinta `CUSTOMER`/`VAULT_OPERATOR`. **§9.2 del sistema de
  diseño dice «nunca se pinta el enum crudo».** ⭐ **M5 ya lo resolvió** (nombre + correo + enlace a la
  ficha): la cura existe en el mismo panel. **Rol:** frontend; arquitecto+backend si M3 necesita el DTO.

##### 🟠 Importantes
- **I1 · Zombies confirmados** *(no se retira nada sin producto y sin el humano)*: **M9 Reportes** — de sus
  tres secciones, **dos son las mismas de M7** (mismo rango de fechas, **los mismos tres botones de
  exportar, misma función**); lo único propio son 4 tarjetas cuyo subtítulo dice *«Avance de la beta
  cerrada frente a las metas N/X/Y/Z»* (álgebra en pantalla, y «beta cerrada» estando en producción).
  Y la **tarjeta «Progreso de lanzamiento» del dashboard está INERTE POR CONSTRUCCIÓN**: pinta «Meta
  pendiente» **sin condición**, y su DTO ni siquiera tiene metas ⇒ con los mismos datos, M9 dice 42 % y el
  dashboard dice «Meta pendiente». **Los mismos cuatro contadores aparecen en tres sitios.**
  **Rol:** product-owner decide → ux-ui redacta → frontend cablea.
- **I2 · La navegación rotula por código, y el código no sirve para nada.** Los códigos **no llevan orden**
  (M1, Bóvedas, M4, M5, M8 / M2 / M3, M7, M9 / M6, M10) y **tres destinos no tienen código**: no ordenan ni
  identifican, solo **desplazan el nombre 5 caracteres a la derecha en 12 filas**. El rótulo del menú y el
  título de la página **difieren en 6 de 12**. Las solicitudes de venta se llaman **«Buylist»** en el menú
  y **«Solicitudes de venta»** en M6 — *el humano las buscó por su nombre y no las encontró*. La etiqueta
  «SÚPER» sale en **7 de 12 filas** también para el súper-admin, que es el único que la ve.
  **Rol:** ux-ui → frontend.
- **I3 · M2 es UNA página de 7.986 px, 11 secciones y 61 botones**, con una barra pegajosa
  («GUARDAR CURVA») fija al pie **desde el primer scroll**: quien está en «Tipo de cambio» ve un botón que
  no le corresponde. **Rol:** ux-ui / frontend.
- **I4 · M8 le habla al dueño como si fuera el cliente** («Envía **tu** evidencia por correo… citando **tu**
  número de orden») y **no tiene estado vacío**: con cero disputas queda en blanco. **Rol:** frontend.
- **I5 · El sistema de diseño afirma seis cosas que el panel NO cumple** — buscador global en el topbar
  (no existe), barra inferior en móvil (no existe), la lista de grupos de §7.15 (desactualizada), tarjetas
  del dashboard clicables + semáforo + barras (no existen), colapso a tarjetas en `<md` (falso fuera de
  `DataTable`), y **objetivos táctiles ≥44 px** (medido en el topbar: 15×25, 111×17, 101×16).
  **Misma clase que los ocho tachones de D52: o se implementan o ux-ui las retira.**
- **I6 · M3 muestra su única acción como lo más llamativo:** «REEMBOLSAR» en bermellón sólido —dinero que
  sale— sin detalle de orden, sin enlace al envío ni al comprador.

##### ✅ Lo que está bien y NO se toca
Foco de teclado visible · M1 cumple §16.1 · **Bóvedas de clientes y Bounties son las dos pantallas más
limpias del panel** · **M4 tiene estado vacío y acciones acotadas por estado — es el patrón que le falta a
M5** · los enlaces de «Cola de trabajo» del dashboard sí llevan a su módulo.

##### ❓ No medido, y hace falta
Volumen real de datos (colas con decenas de filas cambian la lectura de M5 y M3), si las metas de M9 están
fijadas **en producción**, y **el uso real de cada destino**. Hay 12 preguntas cortas para el humano en el
reporte; las cuatro que más cambian el trabajo: **¿entra desde el teléfono?** (decide si B2 bloquea),
**¿fijó las metas N/X/Y/Z?** (decide si M9 es zombie), **¿entra alguien más al panel?** (decide el trato de
roles) y **¿cómo le llama a M5?**.


##### ✅ Respuestas del humano (2026-09-08) — reordenan el trabajo
| Pregunta | Respuesta | Qué cambia |
|---|---|---|
| ¿Entra desde el teléfono? | **No, solo computadora** | ⬇️ **B2 (las tres pantallas que desbordan en 390 px) BAJA a deuda registrada.** No se gasta tiempo ahí ahora. Se anota con su medición para el día que use el móvil o entre un operador que sí |
| ¿Las metas `N/X/Y/Z`? | **No existen — y quiere una pestaña de analytics de verdad, pero primero saber qué datos hay** | ➡️ **M9 NO se retira: es la semilla.** Nace **P-67** (inventario de datos). Sí se corrige ya el «beta cerrada» |
| ¿Alguien más en el panel? | **Todavía no, pero pronto** | Se optimiza para él primero, **sin cerrarle la puerta al operador**. La etiqueta «SÚPER» en 7 de 12 filas **no se quita**: pronto informará |
| ¿Qué usó la última semana? | **M3 · Ventas** y **M10 · Config** (⛔ **no** M8, **no** M9) | ⬆️ **B3 sube**: M3 es de uso real y le enseña `u-777` en vez del comprador. ⬆️ M10 (el ensayo de ingeniería dentro del formulario). ⬇️ **M8 baja** — no lo usó, y lo más probable es que sea porque **no ha habido disputas**, no porque sobre: es una pantalla que espera, no un zombie |

##### 🎯 Orden de trabajo resultante
1. **B1 · M5 en computadora** — la pantalla que más usa, diez pestañas y catorce botones por solicitud.
2. **B3 · M3 y M10** — identificadores en vez de personas, en pantallas de uso diario.
3. **P-67** — el inventario de datos, que desbloquea la pestaña de analytics.
4. **I2 · los rótulos del menú** — barato y se nota todos los días.
5. **I1 (dashboard)** — la tarjeta de progreso inerte: se quita o se conecta.
6. ⬇️ **B2 (móvil)**, **I4 (M8)** — deuda registrada, con su medición, para cuando toque.

#### P-67 · 📊 Inventario de datos para analytics — «¿qué podemos medir hoy?» — pedido por el humano
- **Lo que dijo, literal (2026-09-08):** *«SÍ me interesa generar una tab de analytics y reportes, sin
  embargo creo falta saber bien qué datos están disponibles para ver si hay que crear track de algo y
  elegir de lo que hay.»*
- **La pregunta es la correcta y va PRIMERO.** Diseñar un tablero antes de saber qué se puede medir es
  cómo nacieron las metas `N/X/Y/Z`: un marco de reporte sin datos detrás que lleva meses enseñando
  «Meta sin fijar». **No se diseña ninguna pantalla hasta que este inventario exista.**
- **Qué hay que producir** — un documento que el humano pueda leer y elegir, no una lista de tablas:
  1. **Lo que YA se guarda y se puede reportar hoy**, en lenguaje de negocio (qué se vendió, a quién, a
     qué precio, con qué margen, cuánto se pagó en compras, qué inventario hay y cuánto vale, KYC,
     disputas, retiros). Con **la granularidad real** (¿por día? ¿por pieza? ¿por set?) y **desde cuándo
     hay historia** — un dato que empieza el mes pasado no sirve para una tendencia anual.
  2. **Lo que se guarda pero NO es reportable todavía** y qué faltaría para que lo fuera.
  3. **Lo que NO se guarda y habría que empezar a registrar** (el «crear track de algo» que él nombra),
     con el costo de empezar a hacerlo y **desde cuándo tendría historia** — porque lo que se empieza a
     registrar hoy no tiene pasado.
  4. ⚠️ **Las trampas conocidas**, que ya nos mordieron: el P&L del tablero suma un campo a secas
     mientras el control antilavado usa una cascada con respaldo; y `PriceReference` escribe ~28.559
     filas/día (P-53) — cualquier reporte histórico de precios se apoya en esa tabla.
- **Cómo se hace, y en qué orden:** un pase de **lectura** (arquitecto o backend, sin escribir código)
  que produzca el inventario → el **humano elige** qué quiere ver → **product-owner** aterriza el
  alcance → recién entonces arquitecto/ux-ui/frontend.
- **Cruce con P-66:** de las tres secciones de **M9 Reportes**, dos son **idénticas a M7**; lo único
  propio son las tarjetas de `N/X/Y/Z`. ⇒ **M9 no se retira todavía: es la semilla de este trabajo.**
  Lo que sí se corrige ya es que hable de «beta cerrada» estando en producción.
- **Rol dueño:** arquitecto/backend (inventario, solo lectura) → product-owner → ux-ui → frontend.

#### P-68 · 💱 Una consulta de UNA fila antes de publicar el interruptor del tipo de cambio (I-1)
- **El escenario, en lenguaje de dinero:** existe un estado en el que **publicar el interruptor de FX,
  sin que nadie apriete nada, movería los precios ~5 %** (de 19.00 a 18.00, el fallback duro). Es
  exactamente el movimiento que el acuse de confirmación existe para impedir — y ahí ocurriría sin un
  solo clic. QA lo clasificó como **«no aceptable sin decisión explícita del humano»**.
- **Qué lo dispara, verificado en el código** (`backend/src/common/fx-mode.ts:157` y
  `backend/src/modules/pricing/fx.service.ts:85`), no supuesto:
  1. Al desplegar, la fila `fx_rate_mode` todavía no existe (o vale el centinela `"legacy"`), así que
     `resolveFxMode()` **infiere** el modo en lugar de leerlo. Esa inferencia corre **una sola vez por
     entorno** y deja de correr en cuanto un humano toca el interruptor.
  2. La inferencia mira **un solo valor**: el ajuste `fx_manual_override_rate`.
     - Si **tiene número** ⇒ resuelve `manual` ⇒ rige ese número. **Nada se mueve.** ✅
     - Si está **vacío/nulo** ⇒ resuelve `auto` ⇒ rige la última fila `FxRate` de origen **`banxico`**,
       y si no hay ninguna, el **fallback duro de 18**. ⚠️ Ahí está el −5 %.
- ⚠️ **Corrección a lo que dije antes:** dije que «el 19.0000 puesto» protege producción. Es cierto
  **solo si ese 19.0000 vive en el ajuste `fx_manual_override_rate`**. La pantalla de admin escribe
  las dos cosas a la vez (`setManual()` guarda el ajuste **y** una fila `FxRate` de origen `manual`),
  así que si el número se puso por la pantalla, está protegido. Pero **la fila `FxRate` manual NO rige
  nunca** (I-FX5, es solo traza forense): si ese 19.0000 llegó por un script o una migración vieja y
  el ajuste quedó vacío, la protección **no existe**. No es una cosa que se pueda razonar desde el
  código: **depende de un valor que solo está en la base de producción.**
- **La cura, y ya está escrita: UNA consulta de solo lectura que emite su propio veredicto.**
  Se corre en **cada entorno** (staging y producción) antes de promover. No modifica nada.

  ```sql
  SELECT
    COALESCE((SELECT "valueJson" #>> '{}' FROM "ConfigSetting" WHERE key = 'fx_rate_mode'), '(no existe)') AS modo_guardado,
    COALESCE((SELECT "valueJson" #>> '{}' FROM "ConfigSetting" WHERE key = 'fx_manual_override_rate'), '(vacio)') AS tasa_manual,
    (SELECT count(*) FROM "FxRate" WHERE source = 'banxico') AS filas_banxico,
    CASE
      WHEN (SELECT "valueJson" #>> '{}' FROM "ConfigSetting" WHERE key = 'fx_rate_mode') IN ('auto','manual')
        THEN 'SEGURO — el modo esta puesto explicitamente, publicar no lo cambia'
      WHEN (SELECT "valueJson" FROM "ConfigSetting" WHERE key = 'fx_manual_override_rate') IS NOT NULL
       AND (SELECT "valueJson" FROM "ConfigSetting" WHERE key = 'fx_manual_override_rate') <> 'null'::jsonb
        THEN 'SEGURO — hay tasa manual guardada: al publicar resuelve a MANUAL y rige ese numero'
      ELSE 'PELIGRO — sin modo y sin tasa manual: al publicar resuelve a AUTOMATICO'
    END AS veredicto;
  ```

- ⭐ **La consulta SE PUEDE PONER EN ROJO — verificado por el orquestador (2026-09-09), no supuesto.**
  Se probó contra una base desechable en los tres estados, porque una consulta que solo sabe decir
  «seguro» no sirve de nada, igual que un candado que no puede ponerse rojo:
  | Estado sembrado | Veredicto que emitió |
  |---|---|
  | `fx_rate_mode = 'auto'` | ✅ SEGURO — el modo está puesto explícitamente |
  | sin fila de modo, **con** `19.0` guardado | ✅ SEGURO — resuelve a MANUAL y rige ese número |
  | sin fila de modo y **sin** tasa manual | 🔴 **PELIGRO** — resuelve a AUTOMÁTICO |
- **Qué hacer con cada resultado:** `SEGURO` ⇒ se publica sin riesgo. `PELIGRO` ⇒ **no se publica**
  hasta fijar el modo a mano (o guardar la tasa manual), y entonces se vuelve a correr.
- **Rol dueño:** devops (la consulta previa al deploy) · backend (la tercera fixture FX-6 que cubre el
  estado) · arquitecto (declarar el riesgo residual si se decide publicar sin la consulta).
- **Estado:** ⛔ **BLOQUEA el merge del interruptor de FX** hasta que el humano decida.


#### P-70 · 🃏 Stream `decks-meta-v1` — el spec del humano, en espera de arrancar
- **Entregado por el humano el 2026-09-09**, con instrucción explícita: *«después de que publiques quiero
  que empieces con esto»*. Guardado **verbatim** en `docs/specs/DECKS_META_V1.md`; nadie lo edita.
- **Qué es:** una sección «Decks Meta» que traiga los 10 decks del meta de Limitless TCG, con precio en
  pesos, disponibilidad real por carta y un botón «Agregar las disponibles», más descuento de bundle
  (5 % con 60/60, 3 % con las *core* completas), job semanal, correo «Qué cambió» y reporte de faltantes.
- **Cómo arranca, según el propio spec:** sesión 1 es **solo diseño, sin código de producto** — modelo de
  datos, las dos preguntas bloqueantes de arquitectura, el diseño del job, y el diff propuesto de
  `API_CONTRACT.md`, todo para **revisión del arquitecto**. Por el paso 0 de `CLAUDE.md`, antes va
  **product-owner** aterrizándolo a `PROJECT.md`.
- 🔴 **BLOQUEANTE QUE HAY QUE RESOLVER ANTES, y no es del spec: `pricing-iva-v2.1` NO EXISTE en este
  repo.** Lo verifiqué: cero ocurrencias de ese nombre en `docs/` y en `PROJECT.md`. Y lo que sí verifiqué
  del estado real: `backend/src/common/money.ts:374` calcula `iva = round(subtotal × ivaPct/100)` — o sea
  que **hoy el motor devuelve base y apila el IVA después**, que es exactamente el estado que el spec dice
  que hay que resolver antes de publicar la sección (*«si el motor sigue devolviendo base con IVA apilado
  después, el descuento y el total del bundle salen mal»*). ⇒ **Hay que preguntarle al humano** si
  `pricing-iva-v2.1` es trabajo de otro contexto, si es un stream por abrir aquí, o si lo que existe bajo
  otro nombre (P-37, contrato v1.40) ya lo cubre. **No se asume.**
- ⚠️ **Su propia regla de exclusión:** *«corre solo; no se abre en paralelo con `pricing-iva-v2.1` ni con
  ningún stream que toque `money.ts` o el contrato»*. El stream de FX que se acaba de cerrar tocaba las
  dos cosas, así que **esperar al merge era correcto** — ya está hecho.
- **Zonas compartidas que va a tocar:** catálogo, carrito/checkout (la línea de descuento),
  `API_CONTRACT.md`, `prisma/schema`, jobs programados y correo transaccional. Por la regla de oro, **solo
  un stream a la vez** puede tocarlas.

#### P-72 · 💸 «SIN PRECIO RESOLUBLE» dice DOS cosas opuestas con la misma frase — ✅ DIAGNOSTICADO (2026-09-10)
- **Reportado por el humano** con captura, y luego el dato que lo desatascó: *«me sale con precio de mercado
  en inventario»*.
- **Veredicto: NO es que el inventario mienta.** Las dos pantallas leen **la misma tabla, con la misma clave
  por-acabado, con los mismos predicados** — las dos llaman a `PricingService.getReferencesBatch`
  (`pricing.service.ts:877`), sin ningún fallback entre acabados: `finish` entra al `where` (`:892`) y a la
  clave del `Map` (`:884`). **Un holofoil sin fila NUNCA hereda la del normal.**
- ⭐ **La causa, con nombre: el guardarraíl `premium_at_floor`.** Verificado en
  `backend/src/common/pricing-curve.ts:566`. Su comentario dice literal: *«Una carta de rareza canónica
  premium que aterriza en el PISO NO se publica ni se cotiza: **su dato de mercado está mal (ausente,
  aplanado o absurdo)**»*. Las dos piezas son `ex` premium; el piso es **MX$25.00** (`pricing-curve.ts:111`,
  `floorCents: 2500`, dial editable). ⇒ **Tienen mercado, es implausiblemente bajo, y el sistema lo retiene
  a propósito.**
- 🔬 **La prueba que cierra el caso sin mirar la base:** el alta de `aportacion_en_especie`
  (`inventory.service.ts:739-755`) **exige referencia con el `finish` REAL de la pieza** y lanza 422
  `PRICE_PENDING` si falta — la pieza **no se crea**. ⇒ **Si INV-001201 y INV-001202 existen, el 9 de
  septiembre había mercado para su clave exacta.** No pudieron nacer de otro modo. Y las `PriceReference`
  **no caducan**.
- ✅ **Los siete a MX$25.00: es el piso, y NO disimulan nada.** Mi hipótesis queda **refutada por código**:
  una carta **sin** mercado **no puede** salir al piso — `pricing-curve.ts:476` la manda a `pending`, e
  `inventory.service.ts:1615` lo dice con todas las letras (*«el PISO NO gana — decisión LOCKED»*). ⇒ Los
  siete **sí tienen mercado**, solo que ≲ MX$15.62. Son bulk (Dustox, Charmander, Charmeleon, Spidops), y
  están en la cola por **UBICACIÓN**, no por precio. **Nueve piezas, un fenómeno, dos desenlaces por rareza:
  los siete se publican porque no son premium; las dos no porque sí lo son.**
- 🔴 **EL DEFECTO REAL, y es de pantalla:** `PendingPublishRowDTO` **no lleva la razón**
  (`inventory.service.ts:1805-1822`: hay `priceBasis`, `missing`, `pendingPriceEntryId`… y ninguna `reason`).
  ⇒ La cola de M1 **no distingue «no hay mercado» de «hay mercado y lo estoy reteniendo»**, y las dice con
  la misma frase. **Por eso el humano y yo leímos lo mismo de dos hechos opuestos.** La razón **sí** existe
  y **sí** se persiste (`:1516`), y **M2 sí la pinta** (`PendingQueueSection.tsx:116-126`), igual que el
  binder con su marcador `·!` (`VariantPriceConsole.tsx:120`). **Solo M1 la pierde.**
- 🔴 **Y la asimetría que más me preocupa, que no estaba anotada:** el guardarraíl vive **solo en el eje de
  venta/compra** (`decideSalePrice`). **El alta NO pasa por él** ⇒ `inventory.service.ts:761` **ya usó ese
  mismo número sospechoso para valuar la aportación**. **El eje de venta se negó a publicar con ese dato, y
  el eje de costo ya lo había aceptado.**
- ✅ **Acción disponible hoy, y sigue siendo la correcta — pero por otra razón que la que dije:** el sync
  TCGCSV `tcgcsv_singles` de **JOURNEY TOGETHER** (per-acabado, gana por precedencia,
  `pricing.service.ts:904`). **No porque falte el precio: porque el que hay es malo.**
##### ⭐ Por qué «corrí el sync y no pasó nada» (diagnosticado 2026-09-10)
- 🔴 **No hay UN sync: hay CUATRO acciones en M2, y el botón obvio NO ESCRIBE NINGÚN PRECIO.**
  Verificado por el orquestador en `catalog-sync.service.ts:784`:
  ```ts
  if (firstImport || opts.force === true) { await this.runCardProductResolver(...); }
  ```
  **«Re-sincronizar»** (el botón de la fila) manda `sync` **sin `force`** (`useCatalogSync.ts:139`). JOURNEY
  TOGETHER ya está importado ⇒ **el resolver ni se invoca, no se escribe una sola `PriceReference`** — y el
  banner responde *«Sync encolado: 1 set(s)»*, **que parece éxito**.
  | Botón | ¿Escribe precio per-acabado? |
  |---|---|
  | **«Re-sincronizar»** (fila) | ⛔ **NO escribe ningún precio** |
  | **«Variantes + precios»** (fila) | ✅ **SÍ, siempre** — `catalog-sync.service.ts:330`, `void force` |
  | «Actualizar precios ahora» | ⚠️ solo si el dial lo permite |
  | «Sync completo» (menú «…») | ✅ fase 1; fase 2 depende del dial |
- 🔴 **Causa #2, independiente y también viva: el barrido diario NO puede tocar un holofoil hoy.** El
  proveedor lo elige el dial `price_provider`, y el seed es **`pokemontcg_io`** (`settings.constants.ts:307`).
  Ponerlo en `tcgcsv_singles` es **la Parte 4 de `P-47`, «(después, devops)», que sigue SIN MARCAR COMO
  HECHA**. Con PPT y la Parte 1 ya en producción, **solo se escribe la impresión primaria** ⇒ para la clave
  holofoil no se escribe fila nueva y la vieja sobrevive. **Un sync que corre, reporta bien, y
  estructuralmente no puede tocar ese acabado.**
- **Refutada la hipótesis de que el sync respeta la fila vieja:** los dos escritores son **upsert
  incondicional** (`card-product-resolver.service.ts:197`, `pricing.service.ts:2186`). El **único** freno es
  un **override manual**, que además gana en la lectura para siempre. ⇒ **Si alguien puso un override
  manual bajo en esas claves, ningún sync lo moverá jamás.** No se puede descartar leyendo.
- **Refutado el cruce con `P-46`:** sellado y singles resuelven el grupo TCGCSV por **caminos distintos**
  (`sealed-product.service.ts:777` vs `card-product-resolver.service.ts:209`), así que el bug del prefijo de
  P-46 **no alcanza a singles**.
- ✅ **LA ACCIÓN QUE SÍ CIERRA EL CASO, sin depender de ninguna incógnita:**
  **M2 → «Cola de precio pendiente» → pestaña «Venta (inventario)» → las dos filas → «Fijar precio» →
  teclear el MERCADO real en pesos → «Guardar precio».** Escribe una referencia **manual**, cuyo tier es
  **absoluto y durable** (`pricing.service.ts:361`), **ningún sync futuro la pisa**, y el endpoint
  **re-dispara la publicación** al guardar. ⚠️ Se teclea **el mercado, no el precio de venta**; para salir
  del piso tiene que ser **> MX$15.62**.
- ⛔ **Lo que NO va a poder hacer, y hay que decírselo antes:** en el binder, el campo **«Fijar mercado»
  solo aparece cuando NO hay mercado** (`VariantPriceConsole.tsx:431`, `marketRefCents != null`). **Estas dos
  SÍ tienen** ⇒ verá el número y su fecha, **sin campo para corregirlo**. El único sitio es el modal de M2.
- 🔬 **El dato que decide qué hipótesis queda viva, y solo se ve en pantalla: LA FECHA del mercado.**
  M1 → binder → teja del **holofoil** → cajón → «Precios» → renglón «Mercado» (monto · fecha).
  **Fecha ≠ día del sync** ⇒ el sync no escribió esa clave. **Fecha = día del sync y monto sigue bajo** ⇒
  TCGCSV reporta ese número y **solo el override manual lo arregla**.
- ⚠️ **Trampa de pantalla que hay que avisarle:** tras «Variantes + precios», si el set **no resuelve su
  grupo**, el banner sale **VERDE** con **todo en cero** — el estado «parcial» solo se activa con
  `!tcgcsvReachable || pending > 0` (`CatalogSyncSection.tsx:282`). **Que lea los NÚMEROS, no el color.**
- 🔴 **Y lo que ninguna pantalla enseña, que es justo lo que falta: la FUENTE de la fila vigente.** El
  historial por fecha/fuente existe (`GET /admin/pricing/card/:cardId`) y hasta hay cliente en
  `lib/api.ts:3859`, pero **ningún componente lo consume**. ⇒ Desde la interfaz **no se distingue** «la
  escribió tcgcsv hoy» de «es un residuo aplanado de PPT de agosto» ni de «es un override manual».

- **Rol dueño:** **frontend + arquitecto** (que la cola de M1 lleve la razón) · **arquitecto** (si el
  guardarraíl debe cubrir el eje de costo) · **backend** (P-47 parte 3, que cura el dato de origen).

##### Hallazgos de paso del mismo diagnóstico, sin pendiente propio
- 🔴 **La forma (A) que yo temía SÍ EXISTE, en otra familia de piezas.** `loadPublishPricingCtx:1406` solo
  usa `getReferencesBatch`, que **excluye** las filas de `promo`/`deck_exclusive` (`BASE_CARD_REF_WHERE`,
  `pricing.service.ts:150`). Existe la hermana que sí las lee (`getReferencesByCardProductBatch`, `:937`) y
  **nadie la llama desde publicación**, mientras el binder **sí** las pinta (`MasterSetBinder.tsx:346`).
  ⇒ Para una **promo o deck-exclusive**, el binder enseña mercado y la publicación dice «sin precio
  resoluble». **No aplica a estas dos**, pero es real.
- 🔴 **El alta de aportación acepta un mercado de `0`.** `getReference` marca `status:'priced'` para
  cualquier fila (`pricing.service.ts:782`, sin filtro `> 0`) y el candado solo comprueba `!= null`
  (`:741`) ⇒ `computeAportacionCostCents(0, pct) = 0`. El resto del sistema **sí** trata `<= 0` como
  pendiente. Una aportación puede quedar **valuada en MX$0**.

#### P-71 · 🔤 Mostrar el código corto del set junto a las imágenes — pedido por el humano
- **Lo que dijo, literal (2026-09-09):** *«quiero que en los sets cuando estamos viendo las imagenes
  pongamos el codigo chico que viene en las cartas perfect order POR, pitch plack PF etc»*.
- **Qué es:** la sigla corta impresa en la propia carta (**POR**, **PF**, …), que es como los jugadores
  y las listas de deck identifican el set. No es el nombre largo del set: es el código que aparece en el
  cartón y el que se teclea al buscar.
- ⭐ **NOTICIA BUENA, verificada en el código: el dato YA EXISTE y YA SE ESTÁ GUARDANDO.**
  - Columna `CardSet.ptcgoCode String?` — `backend/prisma/schema.prisma:497`.
  - La **puebla sola** el barrido de catálogo desde pokemontcg.io:
    `backend/src/modules/catalog/catalog-sync.service.ts:918` y `:928`, leyendo
    `pokemontcg-io.client.ts:20`.
  - ⇒ **No hay que capturar nada a mano, ni migrar, ni pedirle el dato a un proveedor nuevo.**
- 🔴 **Lo que falta, y es todo lo que falta: NADIE LO LEE.** Grep sobre `backend/src/`: las únicas tres
  ocurrencias son las de la escritura. **No viaja en ningún DTO** y no aparece en
  `frontend/src/types/contract.ts`. El dato está en la base y muere ahí.
- **Trabajo real:** publicarlo en el DTO del set/carta (**arquitecto**, porque es cambio de contrato —
  regla 9), emitirlo (**backend**) y pintarlo (**frontend** + **ux-ui** para dónde y con qué jerarquía).
  Es de los pendientes más baratos de la lista **si el contrato lo permite**.
- ⚠️ **Lo que hay que medir antes de prometerlo:** cuántos sets tienen `ptcgoCode` **no nulo** en
  producción. La columna es opcional y el proveedor no siempre lo trae — sobre todo en sets viejos o en
  promocionales. **Si falta, se omite; NUNCA se inventa una sigla ni se pone un guion que parezca un
  código.** Es la misma regla que ya aplicamos al precio: sin dato, no se finge.
- **Cruce con P-70 (`decks-meta-v1`):** ese stream resuelve las cartas de una lista **por set code +
  número**, y su propio spec lo dice. ⇒ este pendiente y aquél **usan el mismo dato**, así que conviene
  que el mismo pase decida cómo se publica, en vez de exponerlo dos veces con dos formas distintas.
- **Estado:** anotado, sin diagnosticar más allá de lo verificado arriba. Sin rol dueño asignado hasta
  que el arquitecto diga cómo entra al contrato.

#### P-69 · 📦 El precio de mercado se pierde entre el paso 1 y el paso 2 al subir sellado — reportado por el humano
- **Lo que dijo, literal (2026-09-09):** *«subiendo producto sellado me aparece el precio de mercado, en la
  siguiente pagina dice que no tiene el precio y no puedo ponerle como aportacion»*. Con captura.
- **El síntoma, con el dato de la captura:** en el diálogo «Agregar producto sellado», **paso 1 de 2 ·
  ELIGE PRODUCTO**, con el set *Phantasmal Flames (2025)*, la tarjeta seleccionada
  («Phantasmal Flames Elite Trainer Box») muestra **`MX$2,981.67 MERCADO`**. En el **paso 2**, ese
  **mismo** producto aparece **sin precio**, y por eso **no se puede registrar como «aportación»**.
- ⚠️ **Lo que hace esto distinto de «falta un precio»:** el paso 1 **sí sabe** distinguir los dos casos, y
  lo hace bien — la cabecera dice *«25 presentaciones · 23 con precio · 2 pendientes de precio»* y otra
  tarjeta muestra **`SIN PRECIO DE MERCADO`** en rojo. Así que no es que el catálogo no tenga el dato:
  **es que los dos pasos no coinciden sobre el mismo producto.** Uno de los dos miente.
- **Por qué importa y no es cosmético:** bloquea **meter inventario**, que es la operación diaria del
  negocio. Y si el que miente resultara ser el **paso 1**, sería peor que el síntoma reportado — el dueño
  estaría viendo un número en el que confía para decidir cuánto paga.
- **Hipótesis a descartar CON CÓDIGO, ninguna confirmada todavía:** (a) dos fuentes distintas — el paso 1
  pinta un campo del listado y el paso 2 lo vuelve a pedir por otra ruta; (b) el acabado/variante — el
  precio del paso 1 cuelga de una variante y el paso 2 pregunta por otra (⚠️ regla dura del proyecto:
  **nunca se copia el precio de un acabado a otro**); (c) se pierde el identificador entre pasos;
  (d) semántica de omisión — el paso 2 lee «ausente» como «sin precio» cuando significa «no pedido»;
  (e) una condición extra del paso 2 (frescura, moneda, fila de referencia de hoy).
- **Segunda pregunta abierta:** ¿el bloqueo de «aportación» sin precio es **regla de negocio deliberada**
  (no se aporta lo que no está valuado) o efecto colateral? Si es deliberada, la regla está bien y el bug
  es solo que el precio se pierde.
- **Estado:** ✅ **DIAGNOSTICADO (2026-09-09). El que miente es el PASO 1.**
- **La causa, medida en código:** son **dos campos distintos que viajan en la MISMA respuesta del MISMO
  endpoint** — no se pierde ningún id, no se re-pide nada, no hay acabado de por medio.
  - **Paso 1** pinta `SealedProductDTO.marketRef` (`SealedProductPicker.tsx:216-217`): lectura **viva/caché
    de TCGCSV**, **sin gatear** por el dial y **sin respaldo en una fila `PriceReference`**.
  - **Paso 2** pinta `SealedProductDTO.effectiveMarketCents` (`SealedAddFlow.tsx:172`): el mercado
    **autoritativo**, ya pasado por `gateSealedMarketCents` (`pricing.service.ts:1763-1780`) con el dial
    `sealedPriceSource`.
  - ⇒ **El paso 2 dice la verdad: es lo que el backend aceptaría. El paso 1 enseña un número que el
    backend rechazaría** — inerte a efectos de dinero: no valúa la aportación, no publica, no fija venta.
- ⚠️ **Y es una regresión conocida a medio aplicar:** este es el mismo «dead-end de IMP-1» que se corrigió
  en v1.41 (`BACKEND_NOTES.md:14867-14884`, `FRONTEND_NOTES.md:8121-8145`, con test de regresión en
  `SealedAddFlow.test.tsx:221-257`). **Ese arreglo se aplicó al paso 2 y NO al paso 1.** La teja del picker
  se quedó en la semántica vieja — y `DESIGN_SYSTEM.md:3212-3213` todavía la respalda así, o sea que la
  especificación también quedó desalineada con la doctrina.
- **El bloqueo de «aportación» NO es el bug — es regla deliberada y correcta.** «Aportación» es
  `acquisitionType:'aportacion_en_especie'` con `pct:100`: el dueño no paga la pieza y el sistema le
  acredita un costo **valuado contra la referencia de mercado**. Sin referencia no hay número con el que
  acreditarla, y `inventory.service.ts:729-761` responde `422 PRICE_PENDING` en vez de valuar en $0. Eso es
  la doctrina money-safe funcionando. **El bug es que el paso 1 promete un valor que el backend no
  reconoce, y el operador llega al paso 2 sin entender por qué se le cerró la puerta.**
- **Agravante medido:** `SealedProductListResponse.sealedPriceSource` **ya llega al frontend**
  (`sealed-product.service.ts:63`, `:246`) y **el flujo no lo usa en ninguna parte**. El dato para
  explicarle al operador «la fuente automática está apagada, estos números son informativos» ya está en la
  respuesta, sin consumir.
- **El arreglo — rol dueño principal: `frontend`.**
  1. `SealedProductPicker.tsx:216-217`: la teja se keyea en `product.effectiveMarketCents`, igual que el
     paso 2. Con eso los dos pasos coinciden **por construcción** y desaparece el número que engaña.
  2. Si se quiere conservar el informativo, que sea **explícitamente secundario** (otra etiqueta, no
     «MERCADO»), nunca el número principal de la teja. ⛔ Y jamás $0: sin valor va «—» o «pendiente».
  3. `SealedProductPicker.tsx:219-226`: el `aria-label` arrastra el mismo error para lectores de pantalla.
  4. Consumir `sealedPriceSource === 'off'` para un aviso honesto **en el paso 1**.
- **Secundario, `backend` (no es la causa de esta captura, pero cierra la misma familia):** unificar el
  ancla del ingest con la del listado/alta (`sealed-price-ingest.service.ts:134-147` vs
  `sealed-product.service.ts:260` e `inventory.service.ts:822`). Es la deuda **D-2** de
  `TECH_DEBT.md:4519`, y es el **único** camino por el que el paso 2 diría «sin precio» con el dial
  encendido y precio ya ingerido. Y `pricedCount` (`sealed-product.service.ts:417-418`) cuenta hoy la
  fuente **sin gatear**: o cuenta gateado, o se renombra.
- **Lo que NO se pudo medir desde el código y hay que mirar en la instalación:** el valor real del dial
  `sealedPriceSource` (`GET /admin/settings`), si el job `sealed-price-ingest` ha corrido, y si esa ETB
  tiene fila `PriceReference` bajo el ancla del set. La hipótesis que explica la captura entera sin
  residuos es **dial en `off`** (el seed es `'off'`, `settings.constants.ts:294`), pero **es inferencia,
  no medición**.
- ⚠️ **Encender el dial NO cierra este pendiente:** aunque se prenda, el paso 1 seguiría mintiendo en
  cualquier producto sin fila. El arreglo de frontend hace falta igual.
- **Work stream:** inventario y vault — **distinto** del stream de FX que está en curso, así que no compite
  por las mismas rutas.

### Encontrado en pruebas post-publicación (2026-08-23)


#### P-46 · Sincronizar sellado devuelve «0 presentaciones»: el set no resuelve grupo TCGCSV (prod)
- **Reportado por el humano:** al Sincronizar sellado de **Pitch Black (2026)** (y Chaos Rising) sale «0
  presentaciones». **El botón SÍ funciona** — la sync corre.
- **Causa raíz (logs prod 2026-08-23):** `sealed-products/sync: set Pitch Black ... **sin grupo resoluble
  (ni curado ni name-match)** → nada que sincronizar (money-safe: no se adivina)`. El set no está vinculado
  a su **grupo de TCGCSV** (`tcgcsvGroupId`): ni curado a mano ni por name-match. Sin grupo no hay
  presentaciones que bajar. (Egress a tcgcsv.com OK — no hubo 502/UPSTREAM.)
- **Causa confirmada (name-match backend):** `matchScore` en `sealed-product.service.ts:777` usa
  `normalizeSetName` sobre el nombre directo, pero TCGCSV nombra los grupos con **prefijo de código**
  («SV08: Pitch Black» → `sv08pitchblack`) vs el catálogo local («Pitch Black» → `pitchblack`) → no empatan
  → 0.5 < umbral 0.9 → no auto-resuelve. Ya existe `setNameCandidates` (ppt-set-mapper:145) que quita ese
  prefijo, pero `matchScore` no la usa. **Afecta a CUALQUIER set con prefijo en TCGCSV** (no solo Pitch Black).
- **Fix (EN CURSO, backend):** `matchScore` tolerante al prefijo (reusa `setNameCandidates`) para que los
  matches legítimos suban a ≥0.9 y auto-resuelvan; **conserva** la salvaguarda «≥0.9 Y único en el tope →
  si empate, null (no adivina)». Con tests. Money-safe.
- **Workaround inmediato (humano, super_admin):** M1 → Sellado → «Agregar producto sellado» → elegir set →
  enlace «Curar/vincular grupo» (`SealedGroupLinker`) → elegir el candidato de TCGCSV (aparece con confianza
  media) → «Vincular» → re-sync automático baja las presentaciones.
- **Follow-up (frontend, no bloqueante):** UX del modal cuando la sync da 0 por «sin grupo resoluble» —
  guiar explícitamente al linker en vez de solo mostrar «0 presentaciones».


### Pendiente del humano · Razón social para el footer — ⚠️ LA NOTA ANTERIOR ERA FALSA (corregida 2026-09-08)
- **Lo que decía esta nota:** «el footer de producción aún dice [RAZÓN SOCIAL PENDIENTE]». **Medido: es
  falso.** El footer **ya omite la línea** y nunca ha enseñado el placeholder.
- **Por qué:** `resolveLegalEntity` (`frontend/src/app/[locale]/(storefront)/footer.ts`) devuelve `null`
  ante vacío, espacios o cualquier valor **entre corchetes** — y el valor real es `[Razón social
  pendiente]` / `[Legal entity pending]`. Hay tres tests que lo fijan
  (`footerLegalEntity.test.ts`). El footer publica «TCG HUNT · tcghunt.mx · © {año}», sin nada colgando.
- **Lo único que sigue pendiente**, y es dato del humano, no código: **cuál es la razón social**. El día
  que la dé, se pone en `common.footer.legalEntity` **sin corchetes** y aparece sola, sin desplegar código
  nuevo. *(El humano pidió el 2026-09-08 que «no salga de momento» — ya se cumple por construcción.)*
- ⚠️ **Lección:** esta nota afirmaba un estado de producción que nadie había medido, y llevaba semanas
  mandando a alguien a arreglar algo que ya estaba bien. Misma clase que los ocho tachones de D52.

---


## Nuevas ideas (aún NO en construcción — falta aterrizar con el humano)

### Idea · «Hunter Pulls» — mini-foro de pulls de la comunidad
- **Idea del humano (2026-08-22):** un **mini-foro** muy sencillo donde la gente pueda **subir qué pull
  hizo con nosotros** (posts con foto/descripción) y otros puedan **comentar**. Todo muy simple.
- **Requisito duro:** solo participan **usuarios registrados con nosotros** (postear y comentar exige
  cuenta). Encaja con el lenguaje de marca «cacería» (TCG HUNT 🎯).
- **Por aterrizar con product-owner:** alcance mínimo (post = imagen + texto corto + carta/set
  opcional; comentarios planos; sin votos/hilos anidados al inicio); moderación (¿quién aprueba?,
  reporte de abuso); qué se puede subir (¿ligado a una compra/pedido real con nosotros o libre?);
  privacidad/derechos de imagen; anti-spam básico.
- **Roles:** product-owner (aterriza) → arquitecto (modelo posts/comentarios + moderación + storage de
  imágenes) → backend + frontend + ux-ui. Nuevo módulo (community/social).

### Idea · Vender «meta decks» completos (bundles ready-to-play) — investigación hecha, falta aterrizar
- **Idea del humano:** apartado «Compra tu deck» — publicar los decks meta del mes como bundle completo,
  armados con nuestras cartas sueltas.
- **✅ Investigación hecha (2026-08-22):** meta Estándar post-rotación (Dragapult ex/Dusknoir el #1;
  Clefairy Box campeón NAIC; Slowking, Mega Lucario, Gholdengo; budget Crustle / Team Rocket's Mewtwo).
  Al jugador competitivo NO le importa la variante (juega la más barata legal; evitar reverse combadas).
  Pricing: suma de singles propios + premium 8–15% transparente, nunca con descuento; incluir energías
  básicas. Hueco de mercado claro en MX. Modelar como kit/BOM sobre `inventory` con stock verificado.
- **⚠ Timing:** lanzar DESPUÉS de Worlds 2026 (28–30 ago), con el meta post-Worlds.
- **Preguntas de producto:** ¿deck solo si el inventario surte la lista completa o parcial? ¿precio =
  suma de singles con ajuste o fijo por arquetipo? ¿energías/fundas incluidas?
- **Roles:** product-owner aterriza con el humano → arquitecto/backend/frontend cuando esté definido.

---


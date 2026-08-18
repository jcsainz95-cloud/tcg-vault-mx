# API_CONTRACT.md — Marketplace TCG con Bóveda (Pokémon, México)

> Propiedad: **arquitecto**. **Fuente de verdad** de la interfaz backend↔frontend.
> Manda `PROJECT.md` sobre este contrato, y este contrato sobre el código.
> Versión de API: **v1**. Prefijo: `/api/v1`. Formato: **REST/JSON**. Fecha: 2026-08-18 (rev v1.21-guest-checkout).
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
>   existente del catálogo, poblado por el price-ingest v1.14 / bootstrap de `tcgplayer.prices`; filas históricas →
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
>   `pokemonpricetracker | pokemontcg_io`) — selecciona el proveedor de ingest **sin redeploy** (palanca de rollback
>   money-safe). Seed recomendado `pokemontcg_io` (sin cambio de fuente al desplegar; flip a `pokemonpricetracker` tras
>   verificar el esquema en runtime). Editable por `PUT /admin/settings` parcial; auditado (`settings.update`).
> - **FX / colchón (#13):** `PUT /api/v1/admin/fx` gana **`rate?` opcional** — si se omite `rate`, actualiza **solo** el
>   colchón (`bufferPct`) y **NO** pinnea el override manual de tasa (hoy exige ambos y congela la tasa auto de Banxico).
>   **Alternativa recomendada sin cambio de contrato de FX:** guardar el colchón por `PUT /admin/settings { fxBufferPct }`
>   (parcial, ya soportado). Nota de UI para M2 (frontend). El colchón **aplica en cada ingest** (USD→MXN con FX+buffer).
> - **`CardDTO.availableFinishes` (mismo shape, nueva FUENTE):** pasa a **derivarse del proveedor** de paga en el ingest
>   (que trae las variantes reales del mercado), reemplazando la derivación frágil de `tcgplayer.prices`. Sin cambio de
>   forma; sigue siendo la lista blanca SEC-A1 del `finish` (`422 FINISH_NOT_AVAILABLE`).
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
> - **Env nuevas:** `RESEND_API_KEY` (secreto, requerida en no-local), `MAIL_FROM` (default `no-reply@tcgvaultmx.com`).
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
- **i18n:** el contrato NO devuelve texto traducido. Devuelve **enums** y **`errorCode`**; el frontend traduce (ES/EN). Datos de catálogo en inglés por diseño.
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
- **Códigos nuevos del guest checkout (v1.21 — detalle en §4-G):** `422 VAULT_REQUIRES_ACCOUNT` (el invitado eligió destino bóveda; **es un upsell, no un error de UI** — `details.upsell=true`), `409 ALREADY_AUTHENTICATED` (se llamó un endpoint `/checkout/guest/*` con una sesión válida), `404 INVALID_TOKEN` y `410 TOKEN_EXPIRED` / `410 TOKEN_REVOKED` (enlace de seguimiento), `409 ORDER_ALREADY_CLAIMED` (pedido ya vinculado a una cuenta), `403 CLAIM_EMAIL_MISMATCH` (el correo verificado de la sesión no es el del pedido), `422 GUEST_ORDER_TOO_OLD` (reenvío de enlace sobre un pedido fuera del tope de edad).
- **Acceso `public` vs `guest` (v1.21):** `public` sigue significando **sin token** (decorador `@Public()` del backend, respetado por `JwtAuthGuard`). Los endpoints de invitado son `public` **por construcción** y además **rechazan** una sesión válida (`409 ALREADY_AUTHENTICATED`): un usuario con cuenta compra por `/checkout/session`, un invitado por `/checkout/guest/session`. **No hay endpoint que sirva a los dos.** Simétricamente, ningún endpoint `customer` acepta un token de seguimiento como credencial: el `OrderAccessToken` **no** es una sesión, no otorga rol y solo lee **un** pedido.
- **Idempotencia:** endpoints de pago aceptan header `Idempotency-Key`.
- **PII sensible (CLABE / RFC / INE):** por **defecto se devuelven ENMASCARADOS** en **todas** las respuestas (cliente y back-office, incluido `super_admin`). Formato: CLABE → `****1234` (últimos 4 dígitos), RFC → parcial (ej. `XAX**********`). La **CLABE en claro (18 dígitos) SOLO** se obtiene por el endpoint dedicado `GET /admin/buylist/:id/reveal-clabe` (`super_admin`, money-out, **auditado**). Estos campos viven **cifrados en reposo** (ver ARCHITECTURE §3.4); el contrato nunca expone RFC/CLABE/INE en claro fuera del reveal.

### Enums (fuente de verdad)
```
Role                = customer | vault_operator | super_admin
Locale              = es | en
ProductType         = graded | sealed | raw
RawCondition        = NM                                 // v1.1: ÚNICO valor (se eliminan LP|MP|HP|DMG). Migración.
Finish              = normal | reverse_holo | holofoil | first_edition_holofoil // v1.6-finish: acabado/versión de carta (mapeo de tcgplayer.prices, ARCHITECTURE §3.7). graded/sealed = normal.
SealedSubtype       = box | etb | bundle | tin | blister // v1.1: subtipo opcional del sellado
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
BuylistRuleMode     = fixed | pct                       // v1.3.1: naturaleza de la regla de precio por rareza (fixed = MX$ centavos; pct = % de la referencia)
SalesRuleMode       = fixed | pct                       // v1.13-sales-pricing: regla de precio de VENTA por rareza (fixed = piso MX$ centavos; pct = % ARRIBA de mercado). Misma FORMA que BuylistRuleMode, semántica de pct DISTINTA.
BuylistCategory     = comun | reverse_holo | ex_plus    // DEPRECADO v1.3.1: reemplazado por la tabla de regla por rareza (BuylistRuleMode). Retención legacy; nada nuevo lo usa.
DisputeStatus       = abierta | en_revision | resuelta_recompra | rechazada
PriceSource         = pokemontcg_io | pokemonpricetracker | poketrace | manual | tcgcsv // v1.19: tcgcsv = referencia de SELLADO (M-23)
SealedPriceSource   = tcgcsv | off                       // v1.19: valores del dial sealedPriceSource (§M10). NO es enum de BD; seed "off" (fail-closed)
KycStatus           = none | pending | verified | rejected
UserStatus          = active | blocked | deleted        // v1.3.1: `deleted` = cuenta soft-deleted/anonimizada (no puede iniciar sesión). `PATCH .../status` sigue aceptando solo active|blocked; `deleted` lo fija DELETE /admin/users/:id.
AcquisitionType     = aportacion_en_especie | buylist | compra
CfdiStatus          = registrado | no_aplica          // MVP sin PAC; "emitido" reservado para fase 2
PriceSource         = pokemontcg_io | pokemonpricetracker | poketrace | manual | tcgcsv   // fuentes de precio (tcgcsv = sellado, v1.19)
FxSource            = banxico | manual                // fuente del tipo de cambio (separado de PriceSource)
MasterSetScope      = platform | user_vault           // v1.20: alcance de la vista master set (inventario de plataforma vs bóveda de UN usuario)
AdjustmentReason    = encontrada | perdida | danada | error_captura // v1.20: motivo OBLIGATORIO del ajuste de inventario por levantamiento físico (M1)
FulfillmentMode     = vault | direct_ship            // v1.21: destino del pedido. vault = entra a la bóveda del comprador (requiere cuenta, comportamiento actual, DEFAULT). direct_ship = envío directo a domicilio, envío cobrado en el MISMO PaymentIntent (ÚNICO modo del invitado). Enum de BD (Order.fulfillmentMode).
GuestOrderPublicStatus = pendiente_pago | pagado | preparando | guia | enviado | entregado | cancelado | reembolsado | en_revision
                    // v1.21: estado PÚBLICO derivado (NO es columna) que ve el invitado en la vista de seguimiento.
                    // Se deriva de Order.status + ShipmentRequest.status; tabla de mapeo normativa en §4-G.5.
```

### DTOs base (compartidos)
```ts
Money        = { amountCents: number, currency: "MXN" }
// PriceInfo describe el VALOR DE REFERENCIA (valor de mercado), no el precio de venta.
PriceInfo    = { status: "priced" | "pending", referenceMxnCents?: number, source?: PriceSource, capturedDate?: string }
// v1.6-finish: availableFinishes = acabados en que existe la carta. SIGUE siendo 1 CardDTO por carta
// (externalId único); availableFinishes es un array en el MISMO objeto. Filas históricas / sin sincronizar →
// ["normal"]. Es la lista blanca contra la que el backend valida `finish` (SEC-A1, 422 FINISH_NOT_AVAILABLE).
// v1.14-price-ingest: la FUENTE de availableFinishes pasa a ser el PROVEEDOR de paga (que trae las variantes
// reales del mercado) durante el price-ingest (ARCHITECTURE §4.15e), reemplazando la derivación de
// tcgplayer.prices. MISMO shape; catalog-sync solo deja un bootstrap seguro que el ingest sobre-escribe.
CardDTO      = { id, externalId, name, number, rarity, supertype, subtypes: string[],
                 setId, setName, imageSmallUrl, imageLargeUrl, availableFinishes: Finish[] }
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
ListingDTO   = { inventoryItemId, card: CardDTO, productType, rawCondition?, sealedSubtype?, finish: Finish,
                 gradingCompany?, gradeValue?, certNumber?,
                 referenceValue: PriceInfo, salePriceCents?: number, sellable: boolean }
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
// v1.3.1: regla de precio de buylist para una rareza. value = centavos MXN si mode=fixed; porcentaje [0,100] si mode=pct.
BuylistRule       = { mode: BuylistRuleMode, value: number }
// appliedRule = la regla que se resolvió para la carta; ruleSource="rule" (fila explícita) o "fallback" (BUYLIST_PRICE_FALLBACK_PCT).
BuylistRuleApplied = { mode: BuylistRuleMode, value: number, source: "rule" | "fallback" }
// v1.13-sales-pricing: regla de precio de VENTA por rareza. Misma FORMA que BuylistRule; value = centavos MXN
// (piso) si mode=fixed; % de MARKUP ARRIBA de mercado si mode=pct → salePrice = round(ref × (1 + value/100)).
// (¡OJO! en buylist pct = % de la referencia; en venta pct = % arriba de mercado. No confundir.)
SalesRule         = { mode: SalesRuleMode, value: number }
SalesRuleApplied  = { mode: SalesRuleMode, value: number, source: "rule" | "fallback" }
// v1.15-buylist-batch-clabe: cotización en LOTE (POST /buylist/quote/batch). READ-ONLY. SIN `qty` — el modelo es
// UNA línea por carta física (ARCHITECTURE §4.16b). Espeja EXACTAMENTE los campos del quote por-carta (PublicQuoteDto).
BuylistQuoteItemDTO = { cardId: string, productType: ProductType, rawCondition?: RawCondition, finish?: Finish }
// Payload de éxito por ítem = MISMO shape que la respuesta de POST /buylist/quote por-carta (BuylistQuoteResponse).
BuylistQuotePayload = { rarity: string | null, finish: Finish, appliedRule: BuylistRuleApplied,
                        quote: { status: "cotizada" | "precio_pendiente", quotedPriceCents: number | null, currency: "MXN" },
                        referencePrice: { status: "priced" | "pending", priceMxnCents?: number },
                        paymentNotice: "PAY_AFTER_RECEIPT" }
// Resultado por ítem: ok:true trae la cotización; ok:false trae el error de ESE ítem (NO tumba el lote → HTTP 200).
// `index` = posición 0-based en el request `items[]` (llave de correlación robusta ante cardId+finish repetidos).
BuylistBatchQuoteResultDTO =
    | ({ index: number, cardId: string, ok: true } & BuylistQuotePayload)
    | { index: number, cardId: string, ok: false, error: { code: "NOT_FOUND" | "FINISH_NOT_AVAILABLE", message: string } }
BuylistBatchQuoteResponse = { results: BuylistBatchQuoteResultDTO[] }
// ===== v1.16-master-set: Master Set + inventario a escala (§M1) =====
// Fila del índice de sets (GET /admin/inventory/master-sets). Agregación SOLO de inventario de PLATAFORMA
// (back-office). `catalogCardCount` = nº de Card del catálogo con ese setId (puede EXCEDER printedTotal por
// secret/hyper rares > printedTotal). `distinctCardsOwned` = cartas DISTINTAS del set con ≥1 pieza on-hand.
// `completionPct` = distinctCardsOwned / catalogCardCount × 100 (denominador = catálogo real, no printedTotal;
// null si catalogCardCount=0). `totalPieces` = conteo de InventoryItem on-hand del set. "on-hand" = ownerType
// 'platform' AND status NOT IN (withdrawn, shipped, delivered, lost, damaged). Ver ARCHITECTURE §4.17a (decisión abierta WS-E-1/2).
MasterSetSummaryDTO = { setId: string, name: string, series?: string, releaseDate?: string, year?: number,
                        printedTotal?: number, catalogCardCount: number, distinctCardsOwned: number,
                        completionPct: number | null, totalPieces: number }
MasterSetIndexResponse = { data: MasterSetSummaryDTO[], page: number, pageSize: number, total: number }
// Celda del binder (GET /admin/inventory/master-sets/:setId). Una por Card del catálogo del set. `number` es el
// Card.number crudo (String, p. ej. "4", "SV107", "TG12"); `numberSort` es la CLAVE NUMÉRICA derivada server-side
// para el orden natural estable (el front conserva/re-ordena por ella tras filtrar). `countsByFinish` = piezas
// on-hand por acabado (solo acabados con ≥1 pieza); `totalCount` = suma. Celda con `totalCount=0` = hueco de
// inventario (carta que aún no tenemos).
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
MasterSetCardCellDTO = { cardId: string, number: string, numberSort: number, name: string, rarity?: string,
                         imageSmallUrl?: string, availableFinishes: Finish[],
                         countsByFinish: { finish: Finish, count: number }[], totalCount: number, isSecretRare: boolean }
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
// catálogo; fuente: price-ingest v1.14 / bootstrap tcgplayer.prices; filas históricas/sin datos → ["normal"]).
// `variants` trae EXACTAMENTE una entrada por acabado de availableFinishes (orden del enum Finish).
// `covered` = ≥1 pieza en el scope para ese (cardId, finish). `buyable` SOLO scope cliente y SOLO cuando
// covered=false: la pieza `listed` de plataforma MÁS BARATA de ese (cardId, finish) (cualquier productType), o null.
// NOTA compat: `countsByFinish` (v1.16) se CONSERVA y puede traer acabados FUERA del universo (drift de catálogo:
// pieza capturada con un finish que availableFinishes ya no declara); esas piezas se ven pero NO cuentan en
// expected/covered (los contadores X/Y cuentan variantes del universo).
MasterSetVariantDTO = { finish: Finish, count: number, covered: boolean,
                        buyable?: { inventoryItemId: string, salePriceCents: number } | null }
// EXTENSIONES v1.20 (ADITIVAS — los campos v1.16 no cambian; notación `+=` = campos que se AÑADEN al DTO):
// Índice: catalogVariantCount = Σ |availableFinishes| de las cartas del set; distinctVariantsOwned = variantes del
// universo con ≥1 pieza en el scope; variantCompletionPct = distinctVariantsOwned / catalogVariantCount × 100
// (null si catalogVariantCount=0). Los contadores de UI "X/Y" usan ESTOS campos (variantes), no los de carta.
// En scope user_vault, `distinctCardsOwned`/`totalPieces`/`completionPct` se reinterpretan sobre la bóveda del usuario.
MasterSetSummaryDTO  += { catalogVariantCount: number, distinctVariantsOwned: number,
                          variantCompletionPct: number | null }
MasterSetCardCellDTO += { expectedVariantCount: number, coveredVariantCount: number,
                          variants: MasterSetVariantDTO[] }
MasterSetIndexResponse  += { scope: MasterSetScope, owner?: VaultOwnerRefDTO }
MasterSetBinderResponse += { scope: MasterSetScope, owner?: VaultOwnerRefDTO }
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
BatchInventoryItemInput = { cardId: string, productType: ProductType, rawCondition?: RawCondition, finish?: Finish,
                            sealedSubtype?: SealedSubtype, gradingCompany?: GradingCompany, gradeValue?: string,
                            certNumber?: string, locationId?: string, acquisitionType: AcquisitionType,
                            acquisitionPct?: number, listPriceCents?: number, qty?: number }
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
BulkPublishLineInput = { inventoryItemId: string, listPriceCents?: number }
BulkPublishRequest = { batchKey?: string, items: BulkPublishLineInput[] }   // cap items = 200
BulkPublishLineResult =
    | { index: number, inventoryItemId: string, ok: true, status: "listed", salePriceCents: number, priceSource: "manual" | "derived" }
    | { index: number, inventoryItemId: string, ok: false, error: { code: string, message: string } }
BulkPublishResponse = { summary: { requested: number, published: number, failedLines: number }, results: BulkPublishLineResult[] }
// Desglose del checkout. base = subtotal + iva se recibe íntegro; el fee es gross-up de la comisión Stripe.
// "SIN IVA" = el fee NO agrega una línea de IVA de PRODUCTO (no se vuelve a gravar la venta). Internamente
// el gross-up SÍ cubre el IVA que Stripe MX cobra sobre SU comisión (dial stripe_fee_iva_pct, ver ARCHITECTURE §5.1).
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
- `sort`: `price_asc | price_desc | newest` (opcional).
Res `200`: `{ data: ListingDTO[], page, pageSize, total }`. Todos los `ListingDTO` devueltos tienen `sellable=true` y `salePriceCents != null`.

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
- `sets`: `{ id, name, releaseDate, year }` con `year` **derivado** de `releaseDate`; solo sets con inventario publicado; **ordenados por año desc**.
- `productTypes` / `sealedSubtypes`: subconjuntos presentes en el inventario publicado.
- `finishes` (v1.6-finish): `distinct` de `InventoryItem.finish` sobre el inventario publicado (subconjunto de `Finish`), para el filtro de acabado.

### GET /api/v1/catalog/cards/:cardId — `public`
Res `200`: `{ card: CardDTO, listings: ListingDTO[] }` (instancias físicas publicadas de la misma carta; solo `sellable=true` con precio).

### GET /api/v1/catalog/listings/:inventoryItemId — `public`
Res `200`: `ListingDTO`. Err `404` (incluye el caso de un item no publicado / sin precio: no es visible en Compra).

### GET /api/v1/catalog/sets — `public`
Res `200`: `{ data: [{ id, name, series, releaseDate, year }] }` (datos en inglés; `year` derivado de `releaseDate`, v1.1). Devuelve los sets con inventario publicado, ordenados por año desc.

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

**Nota de precio pendiente (v1.1):** un item en "precio pendiente" (`referenceValue.status="pending"` y sin `salePriceCents` por override) **NO aparece en Compra** (`GET /catalog/cards` lo excluye) — el comprador nunca lo ve. El estado "precio pendiente" vive solo en adquisición/buylist/back-office (M2/M5). Si por carrera un item deja de ser vendible entre listar y comprar, el checkout lo bloquea con `422 PRICE_PENDING` / `409 ITEM_UNAVAILABLE`. El `salePriceCents` visible al cliente es el precio de venta (referencia × (1+markup) u override); `referenceValue` es el valor de mercado informativo.

**Sellado (v1.1):** los listings `productType=sealed` llevan `sealedSubtype?` y **precio manual del admin en MXN** (sin `rawCondition`/grade/rareza). Como Compra solo lista lo que tiene precio, el admin **fija el precio antes de publicar**; sin precio, el sellado no aparece.

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
  "portfolio": { "totalValueMxnCents": 543200, "pendingPriceCount": 2, "currency": "MXN" }
}
```
El valor del portafolio se calcula contra el **valor de referencia** (no el precio de venta). Las cartas `referenceValue.status="pending"` se **excluyen** del total y se reportan en `pendingPriceCount` (no rompen el cálculo).
- **`finish` (v1.6-finish):** cada holding trae su **acabado** (Normal/Reverse Holo/Holofoil/1st Ed. Holo). El `referenceValue` es el de **ese acabado** (`PriceReference` con `finish`); la valuación del portafolio usa el precio del acabado específico, no un precio único por carta. "Mi bóveda" muestra el acabado y permite ordenar por set y por valor.
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
- **Completitud por variante:** cada celda expone `variants[]` (universo = `Card.availableFinishes`) con `covered`
  por acabado; los contadores «X/Y» del front cuentan **variantes** (`coveredVariantCount`/`expectedVariantCount` y
  los agregados del set), no cartas.
- **`buyable` (SOLO esta vista):** cada variante **faltante** (`covered=false`) trae
  `buyable: { inventoryItemId, salePriceCents } | null` — la pieza **`listed` más barata** de plataforma para ese
  `(cardId, finish)` (resoluble a ficha vía `GET /catalog/listings/:inventoryItemId` y comprable por el checkout
  normal §4). `null` si no hay inventario publicado. **No** hay compra dentro del binder: el CTA lleva al flujo de
  Compra/checkout existente (el binder no crea órdenes).
Err `401`, `404 NOT_FOUND` (set inexistente).

---

## 4. Compra, checkout y órdenes (Stripe)

### POST /api/v1/checkout/quote — `customer`
Calcula el desglose sin cobrar (para mostrar líneas en el checkout).
Req: `{ inventoryItemIds: string[] }`
Res `200`: `{ items: OrderItemPreview[], breakdown: BreakdownDTO }`
Err: `422 PRICE_PENDING` (algún item sin precio), `409 ITEM_UNAVAILABLE` (ya vendido/reservado).

### POST /api/v1/checkout/session — `customer`
Reserva los items (`status=reserved`), crea la `Order` en `pending` y el `PaymentIntent` de Stripe.
Req: `{ inventoryItemIds: string[], billingProfileId?: string }` + header `Idempotency-Key`.
El `billingProfileId` es **opcional**: en el MVP la factura es por correo (CFDI sin PAC), por lo que **no se exige billing profile para comprar**.
Res `201`:
```json
{ "orderId": "…", "breakdown": { "…": "BreakdownDTO" },
  "stripe": { "paymentIntentId": "pi_…", "clientSecret": "…" } }
```
Err: `422 PRICE_PENDING`, `409 ITEM_UNAVAILABLE`, **`403 EMAIL_NOT_VERIFIED`** (v1.5 — `emailVerified=false`; comprar es acción sensible). (No aplica `BILLING_PROFILE_REQUIRED` en el MVP: el billing profile no es obligatorio.)
> **v1.5:** `POST /checkout/session` está bloqueado por `EmailVerifiedGuard` (crear orden = acción sensible). El
> `POST /checkout/quote` (read-only) **no** se bloquea, para que la UI muestre precios con el banner "verifica tu correo".
Notas: `breakdown` incluye **IVA 16% desglosado** (sobre el subtotal de cartas) y **línea de fee de procesamiento por gross-up** (para que la plataforma reciba íntegro `subtotal+IVA` tras la comisión Stripe; el fee **no** lleva IVA **de producto**). El gross-up sí cubre el IVA que Stripe MX cobra sobre su comisión (dial `stripe_fee_iva_pct`, default 0.16). `totalCents = subtotalCents + ivaCents + processingFeeCents` (ver ARCHITECTURE §5.1).

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

## 5. Retiros / envíos (comprador)

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
Req: `{ cardId: string, productType: ProductType, rawCondition?: RawCondition, finish?: Finish }`
- **`finish` (v1.6-finish, opcional, default `normal`):** debe pertenecer a `Card.availableFinishes`; si no →
  `422 FINISH_NOT_AVAILABLE`. El front lo puebla del `CardDTO.availableFinishes` de la carta elegida.
Res `200`:
```json
{ "rarity": "Common", "finish": "reverse_holo",
  "appliedRule": { "mode": "fixed", "value": 150, "source": "rule" },
  "quote": { "status": "cotizada", "quotedPriceCents": 150, "currency": "MXN" },
  "referencePrice": { "status": "priced", "priceMxnCents": 12500 },
  "paymentNotice": "PAY_AFTER_RECEIPT" }
```
**Resolución del monto (server-side, ARCHITECTURE §4.2 / §4.2.1):** el backend toma la **rareza oficial real** de la
carta (`Card.rarity`) **y el acabado validado** (`finish` ∈ `availableFinishes`), **nunca del cliente** (SEC-A1).
El **acabado selecciona la regla** (cadena de candidatos de `ruleKey`, primero con regla explícita gana; la
**rareza real va siempre primera**):
- **`reverse_holo`** → `"Reverse Holo"`.
- **`holofoil` / `first_edition_holofoil`**:
  - **Rareza PREMIUM** (chase / alto valor — `isPremiumRarity`, ver abajo) → `[rarity]` **únicamente**: su regla
    explícita o, si no existe, el **fallback pct** (% de mercado). **Nunca** `"Holo"` ni ningún bin **fijo** de bulk.
  - **No premium** → rareza base **si ya es holo** (`rarity` contiene "holo") → `[rarity, "Holo"]`; si no →
    `["Holo"]` (Common/Uncommon = % del market holofoil).
- **`normal`** → la **rareza base** (`Card.rarity`).

**`isPremiumRarity` (parte del contrato de pricing, Fase 0.1 / gate de dinero).** Una rareza es **premium** si, en
minúsculas, casa alguno de estos patrones (substrings/tokens; cierra el bug por el que chase-only-holofoil como
`ex`/Full Art/Illustration Rare cotizaban al bin fijo barato): `illustration`, `ultra rare`, `double rare`,
`secret`, `rainbow`, `hyper`, `full art`, `alt(ernate) art`, `special`, `amazing`, `radiant`, `shiny`,
`trainer gallery`, `character`, `gold`, `prism`, y los tokens sueltos `v | vmax | vstar | vunion | ex | gx`. **NO
premium** (bulk legítimo): Common, Uncommon, Rare (no-holo), Rare Holo (plano), Reverse Holo. Definición canónica y
tabla de patrones en **ARCHITECTURE §4.2.1**. **Garantía de dinero:** una rareza premium **jamás** resuelve a una
regla **fija** de bulk (ni a `"Holo"`); cae a su propia regla o al fallback pct (% de mercado).

Con la regla resuelta se aplica `BUYLIST_PRICE_RULES`:
- `mode="fixed"` → `quotedPriceCents = value` (centavos). **No** depende de la referencia → siempre `cotizada`.
- `mode="pct"`  → `quotedPriceCents = round(referenciaDelAcabado × value/100)`, donde `referenciaDelAcabado` es la
  `PriceReference` **de ESE acabado** (`tcgplayer.prices[finish].market`). Si **falta** →
  `{ "quote": { "status": "precio_pendiente", "quotedPriceCents": null } }` (escala a cola al crear la solicitud).
- **regla no configurada** (ninguno de los candidatos existe) → `BUYLIST_PRICE_FALLBACK_PCT` (default 40) como
  `pct`; `appliedRule.source="fallback"`. No bloquea la cotización (solo `precio_pendiente` si además falta la
  referencia del acabado).

La condición de compra es **siempre NM** (§ARCHITECTURE 3.5); `rawCondition` solo puede ser `NM`. El seed reproduce
el comportamiento anterior y el mapeo por acabado (ej.: **Common Reverse Holo = fixed $1.50**; Common Normal = fixed
$0.50; **Illustration Rare / ex en holofoil = 40% del market holofoil** — nunca el bin fijo de bulk, gate premium;
resto = 40% del market del acabado). El "precio pendiente" es de adquisición/back-office; **nunca** se muestra al
comprador. Ver la tabla de ejemplos en ARCHITECTURE §4.2.1.

### POST /api/v1/buylist/quote/batch — `public`  (v1.15 — NUEVO · cotización en LOTE · READ-ONLY)
Cotiza **N cartas en 1 request** (colapsa el fan-out del cotizador: hoy el grid dispara ~`pageSize` llamadas a
`POST /buylist/quote`). **No** crea solicitud, **no** mueve dinero, **no** persiste y **no** escala a
`PendingPriceEntry` (misma doctrina read-only que el quote por-carta desde v1.12; crítico por ser endpoint anónimo).
Cada ítem se resuelve **igual** que `POST /buylist/quote` (misma función de precio: rareza+acabado server-side, **gate
premium**, `BUYLIST_PRICE_RULES` + fallback, referencia por acabado, FX ya bakeada en `PriceReference`). SEC-A1
intacto.
Req: `{ items: BuylistQuoteItemDTO[] }` donde `BuylistQuoteItemDTO = { cardId, productType, rawCondition?, finish? }`
(mismos campos que el quote por-carta; **sin `qty`** — el modelo es una línea por carta física, ARCHITECTURE §4.16b).
- **Límites:** `items` **no vacío**; **máx `50`** ítems por request (`BUYLIST_QUOTE_BATCH_MAX`). Vacío o sobre-cap →
  `400 VALIDATION_ERROR`. Cuenta como **1** request contra el throttle público.
- **`finish?`** (default `normal`): se valida por-ítem contra `Card.availableFinishes`; si no pertenece, **ese ítem**
  sale `ok:false` con `error.code="FINISH_NOT_AVAILABLE"` (no tumba el lote).
Res `200` (`BuylistBatchQuoteResponse`): **errores por-ítem** — una carta inválida NO afecta a las demás; el HTTP
global es `200`. `index` = posición 0-based en `items[]` (llave de correlación); `cardId` se ecoa.
```json
{
  "results": [
    { "index": 0, "cardId": "card_abc", "ok": true,
      "rarity": "Common", "finish": "reverse_holo",
      "appliedRule": { "mode": "fixed", "value": 150, "source": "rule" },
      "quote": { "status": "cotizada", "quotedPriceCents": 150, "currency": "MXN" },
      "referencePrice": { "status": "priced", "priceMxnCents": 12500 },
      "paymentNotice": "PAY_AFTER_RECEIPT" },
    { "index": 1, "cardId": "card_zap", "ok": true,
      "rarity": "Illustration Rare", "finish": "holofoil",
      "appliedRule": { "mode": "pct", "value": 40, "source": "fallback" },
      "quote": { "status": "precio_pendiente", "quotedPriceCents": null, "currency": "MXN" },
      "referencePrice": { "status": "pending" },
      "paymentNotice": "PAY_AFTER_RECEIPT" },
    { "index": 2, "cardId": "card_bad", "ok": false,
      "error": { "code": "FINISH_NOT_AVAILABLE", "message": "Finish 'holofoil' is not available for this card" } }
  ]
}
```
- **`ok:true`** → mismo payload que `POST /buylist/quote` (`rarity`, `finish`, `appliedRule`, `quote`,
  `referencePrice`, `paymentNotice`). `quote.status="precio_pendiente"` cuando la regla es `pct` y falta la referencia
  del acabado (igual que por-carta; el "precio pendiente" es de adquisición/back-office, **nunca** se muestra como
  precio al comprador — aquí es un vendedor cotizando).
- **`ok:false`** → `error.code ∈ { NOT_FOUND (carta inexistente), FINISH_NOT_AVAILABLE (acabado fuera de
  availableFinishes) }`, con `message` EN de fallback. Son los mismos códigos que el endpoint por-carta devolvería
  como `404`/`422`, aquí **por-ítem**.
Err (nivel request, no por-ítem): `400 VALIDATION_ERROR` (items vacío / > 50 / ítem malformado), `429 RATE_LIMITED`.
Nota: el batch es **anónimo/público** como el quote por-carta; la creación de la solicitud (con topes/KYC/CLABE)
sigue siendo el paso autenticado `POST /buylist/requests`.

### POST /api/v1/buylist/requests — `customer`
Crea la solicitud; valida topes/KYC.
Req: `{ items: [{ cardId, productType, rawCondition?, finish? }], clabe?: string, ineUploadKeys?: { front, back } }`
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
> **v1.3.1:** `items` **ya no** incluye `category` (SEC-A1: el backend deriva la regla server-side de
> `Card.rarity`; un `category` del cliente se ignora si se envía). Cada item cotizado snapshotea la regla
> aplicada (rarity/ruleMode/ruleValue/ruleSource) y se refleja en `SellItemDTO`.
> **v1.6-finish:** cada item lleva `finish?` (default `normal`, validado ∈ `card.availableFinishes`); se
> **snapshotea** en `SellRequestItem.finish` y se propaga al `InventoryItem` al convertir (M5). El monto se deriva
> por `(rarity, finish)` server-side.
Res `201`: `{ sellRequestId, status: "cotizada", quotedTotalCents, ineRequired: boolean, items: SellItemDTO[] }` (**no** incluye la CLABE, ni enmascarada ni en claro).
Err:
- **`403 EMAIL_NOT_VERIFIED`** (v1.5 — vender es acción sensible; el cotizador público `POST /buylist/quote` y `POST /buylist/quote/batch` **no** se bloquean)
- **`422 FINISH_NOT_AVAILABLE`** (v1.6 — algún `finish` no está en `Card.availableFinishes` de su carta)
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

> **Evidencia por correo (v1.2):** la disputa **ya no acepta evidencia por archivo** en la app (se elimina el
> propósito de upload `dispute_claim`). El cliente **envía la evidencia por correo al buzón de soporte**
> (**soporte@tcgvaultmx.com** — *CONFIRMADO por el humano* 2026-08-16; dominio unificado `tcgvaultmx.com`). Este correo es un **dato
> de contacto** que el front muestra en el flujo de disputa y en términos/FAQ; **no** es un endpoint. Ya **no
> existe comparador de fotos de ingreso** en el back-office.

### POST /api/v1/disputes — `customer`
El `type` de la disputa se **deriva server-side** del `productType` del `inventoryItemId` (el cliente **no** lo envía):
- `productType=raw` → `type="condition_raw"`. Resolución por el **estándar/política de condición NM** propio (no por foto).
- `productType=sealed` → `type="condition_sealed"`. Aplica a caja **dañada/equivocada** (sin "condición NM"). Ver ARCHITECTURE §3.6.
- `productType=graded` → **no aplica**: `422 NOT_RAW`.
Req: `{ inventoryItemId: string, description: string }`  (**sin** `claimPhotoUploadKeys`; la evidencia va por correo a soporte).
Res `201`: `{ disputeId, status: "abierta", type: "condition_raw" | "condition_sealed", deadlineAt, evidenceContact: "soporte@tcgvaultmx.com" }`
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
- `payment_intent.payment_failed` → Order `pending→failed`; libera reserva de items (`reserved→listed`).
- `payment_intent.canceled` → libera la reserva de compra (Order `→failed`, items `reserved→listed`) **o** cancela un envío aún en `solicitado` (`ShipmentRequest →cancelado`, libera sus items). Idempotente/no-op si ya está en estado terminal.
- `charge.refunded` → **distingue parcial vs total** comparando `amount_refunded` con `amount`:
  - **Total** (`amount_refunded == amount`) → Order `→refunded`.
  - **Parcial** (`amount_refunded < amount`) → **no** cambia `OrderStatus` (queda para conciliación fina en M7).
  - En ambos casos **NO** re-agrega el item al inventario (VENTAS FINALES: la carta ya es del cliente; el reembolso es excepcional, ver §M3).
- `charge.dispute.created` (contracargo) → Order `→chargeback`. **Consciente del estado físico** de la carta:
  - Si la carta **sigue en bóveda** (no hay `ShipmentItem` con envío `enviado`/`entregado`) → revierte a inventario de plataforma (`ownerType=platform`, `ownershipStatus=null`, `status=listed`), movimiento `chargeback_return`.
  - Si la carta **ya se envió/entregó** → **NO** re-agrega al inventario; marca `Order.chargebackNeedsManual=true` (hay que pelear la disputa con la evidencia de la guía). Sin movimiento de inventario.
- `charge.dispute.closed` / `charge.dispute.funds_reinstated` (cierre de disputa) →
  - **Ganamos** (`funds_reinstated`, o `closed` con `status=won`) → Order `→settled`; `Order.disputeOutcome="won"`. Si la carta se había revertido a inventario, **se queda en inventario** de plataforma (no vuelve al cliente).
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
  Req: `{ cardId, productType, rawCondition?, finish?, sealedSubtype?, gradingCompany?, gradeValue?, certNumber?, locationId, acquisitionType, acquisitionPct?, listPriceCents?, sourceSellRequestItemId? }`
  - **Sin fotos propias (v1.2):** el alta **ya no recibe** `frontPhotoKey`/`backPhotoKey`/`extraPhotoKeys`; la imagen del item es la **imagen de catálogo remota** de la `Card` (pokemontcg.io). No se sube ninguna foto de producto/inventario.
  - **`finish` (v1.6-finish, opcional, default `normal`):** acabado de la copia física; se **valida contra `Card.availableFinishes`** (→ `422 FINISH_NOT_AVAILABLE` si no pertenece). Determina la referencia con que se valúa el item (Compra/portafolio). Para `graded`/`sealed` es `normal` (el acabado no aplica). En la **conversión desde buylist** (`convert-to-inventory`, M5) el `finish` se **hereda** del `SellRequestItem.finish` (no se recaptura).
  - `productType=raw` → `rawCondition` solo `NM` (v1.1). `productType=sealed` → `sealedSubtype?` (opcional), **sin** `rawCondition`/grade/rareza/cert; `listPriceCents` (precio manual MXN) es **obligatorio para publicar** el sellado. `productType=graded` → `gradingCompany` + `gradeValue` + **`certNumber` (nº de certificado PSA/CGC, string) — REQUERIDO para publicar una gradeada** (v1.2). Sin validación automática contra la graduadora (fuera de alcance); es un dato capturado a mano.
  Para `aportacion_en_especie`: el costo se calcula = **referencia del día × pct** (default 70, editable). El item nace `ownerType=platform`.
  Res `201`: `{ id, folio: "INV-000123", status: "in_stock", acquisitionCostCents }`
  Err `422 PRICE_PENDING` (si aportación en especie y no hay referencia → cola de precio pendiente), `422 VALIDATION_ERROR` (p. ej. `sealed` con `rawCondition`, `raw` con `rawCondition != NM`, o **`graded` sin `certNumber`**).
- `GET /api/v1/admin/inventory/items` — query `?status=&cardId=&ownerType=&locationId=&zone=&q=&page=`
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
- `GET /api/v1/admin/inventory/master-sets/:setId` — **(NUEVO)** binder del set: una celda por carta del catálogo.
  `:setId` = id LOCAL del `CardSet` (no `externalId`). Res `200` (`MasterSetBinderResponse`): `{ set, printedTotal,
  catalogCardCount, cells: MasterSetCardCellDTO[] }`, `cells` en **ORDEN NATURAL por número** (ver nota).
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
    - `listed` → **no-op idempotente** (`ok:true`; no re-cobra, no duplica, no cambia precio salvo override explícito).
    - **cualquier otro** status (`reserved | in_custody | picking | shipped | delivered | lost | damaged | withdrawn`)
      → línea falla **`422 ITEM_NOT_PUBLISHABLE`** y **NO** se publica. **Guardarraíl anti double-sell:** una pieza
      reservada/vendida/en-custodia/enviada **no** puede regresar a `listed`.
  - Precio por línea: `listPriceCents` presente → **override manual**; ausente → **precio de venta
    derivado** de las reglas por rareza+acabado (§M2 sales-rules, SEC-A1) reusando `computeSalePriceForItem`. Una pieza
    cuyo precio **no se resuelve** (`pct` sin market) → línea falla `PRICE_PENDING` y **NO** se publica (regla "solo se
    lista lo que tiene precio"). Sellado sin `listPriceCents` y sin override → `PRICE_PENDING`; graded sin `certNumber`
    → `VALIDATION_ERROR`.
  - **Errores por-línea** (item no encontrado `404`/`NOT_FOUND`, no `ownerType=platform`, status no publicable
    `ITEM_NOT_PUBLISHABLE`, precio pendiente `PRICE_PENDING`) no tumban las demás → HTTP **200**. Re-publicar una pieza
    ya `listed` es **no-op idempotente** (`ok:true`). Reusa `getReferencesBatch` (1 lote de referencias) e iza
    `SALES_PRICE_RULES`+fallback **una vez** por request (pago mínimo de **BE-25**).
  - Res `200` (`BulkPublishResponse`): `{ summary, results }`. Auditado (`AuditLog action=inventory.bulk_publish`).

#### Master set en todas partes (v1.20-master-set-everywhere) — `vault_operator+`
> El binder deja de ser exclusivo del inventario de plataforma: el **mismo contrato** sirve (i) M1 interno,
> (ii) la bóveda de cualquier cliente vista por admin y (iii) "Mi bóveda" del cliente (§3). Ver ARCHITECTURE §4.20.

- `GET /api/v1/admin/inventory/master-sets` y `GET .../master-sets/:setId` — **(EXTENDIDOS, no duplicados)** los
  endpoints v1.16 ganan los campos v1.20: `scope:"platform"` en la respuesta, contadores por **variante**
  (`catalogVariantCount`/`distinctVariantsOwned`/`variantCompletionPct` en el índice;
  `variants[]`/`expectedVariantCount`/`coveredVariantCount` por celda). `owner` ausente y `buyable` **omitido**
  (solo existe en la vista (iii) del cliente). Query, orden natural, reglas on-hand y errores: **sin cambios v1.16**.
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

### M2 — Catálogo y precios (`super_admin`)
> **Estado v1.3: YA EXISTE en backend** (`PricingController`, `FxController`, `AdminCatalogController`). No requiere backend nuevo para el flujo M2 existente (sync de precios de bóveda, override, FX, rareza→categoría, sync de catálogo por fecha/backfill); falta **consumo de frontend** (M2 es `ModuleTodo` en UI). Lo **único NUEVO** de backend en M2 es `POST /admin/catalog/sync-all` (abajo), para la Opción 1 del cotizador.
- `POST /api/v1/admin/pricing/sync` — dispara/encola el sync diario (solo bóveda). Req `{ scope?: "all_vault" | "cardIds" , cardIds?: [] }` → `{ jobId, queued: number }`.
- `GET /api/v1/admin/pricing/pending` — cola de precio pendiente. `{ data: PendingPriceEntry[] }`.
  - **v1.8-ronda-c:** cada `PendingPriceEntry` trae **`finish`** — dos acabados de la misma carta sin precio son **entradas separadas** (antes colapsaban en una).
- `POST /api/v1/admin/pricing/override` — override manual (respaldo siempre disponible).
  Req: `{ cardId, productType, gradeKey, priceMxnCents, finish? }` → crea `PriceReference` `source=manual` **para ese acabado**, resuelve **solo** el `PendingPriceEntry` de ese `(cardId, productType, gradeKey, finish)`.
  - **`finish?` (v1.8-ronda-c, opcional, default `normal`):** `normal | reverse_holo | holofoil | first_edition_holofoil`. Fija/actualiza la `PriceReference` del acabado indicado y resuelve el pendiente de **ese** acabado; el pendiente de otros acabados de la misma carta **permanece abierto**. Omitirlo mantiene el comportamiento previo (`normal`). No debilita SEC-A1 (es un precio de referencia del admin, no un monto de cliente).
- `GET /api/v1/admin/pricing/card/:cardId` — historial de precios por fecha/fuente.
- FX: `GET /api/v1/admin/fx` → `{ rate, bufferPct, source: FxSource, effectiveDate }` (automático diario desde **Banxico SIE** + colchón). `PUT /api/v1/admin/fx` — Req `{ rate?, bufferPct? }` → fija **override manual** (`source=manual`, prioridad sobre el automático del día). `POST /api/v1/admin/fx/refresh` — fuerza el fetch a Banxico.
  - **`rate?` opcional (v1.14-price-ingest, #13):** si se **omite** `rate`, la llamada actualiza **solo** el colchón (`bufferPct`) y **NO** pinnea el override manual de tasa (`fx_manual_override_rate`) → la tasa **automática de Banxico sigue activa**. Antes exigía ambos, así que subir solo el colchón congelaba la tasa sin querer. El colchón **aplica en cada ingest de precios** (USD→MXN con FX+buffer, ARCHITECTURE §4.15f). **Vía recomendada sin cambiar este endpoint:** editar el colchón por `PUT /admin/settings { fxBufferPct }` (parcial, ya soportado). **Nota para frontend (M2):** exponer un guardado del colchón independiente del `rate`.
#### Precio de buylist por RAREZA (v1.3.1 — NUEVO backend; editor M2)
> Reemplaza `rarity-map`. Una fila por rareza oficial con regla **`fixed` (MX$ centavos)** o **`pct` (% de la
> referencia)** + un **fallback %** para rarezas sin regla. Toda edición se **audita** (M10). Ver ARCHITECTURE §4.2.

- `GET /api/v1/admin/pricing/rarities` — **(NUEVO)** lista las **rarezas distintas del catálogo sincronizado**
  (`distinct Card.rarity`) **unidas** a las reglas configuradas, para poblar el editor. Devuelve tanto rarezas
  con regla explícita como rarezas del catálogo aún sin regla (que muestran el fallback).
  Res `200`:
  ```json
  { "fallbackPct": 40,
    "rarities": [
      { "rarity": "Common",           "cardCount": 1234, "rule": { "mode": "fixed", "value": 50  }, "source": "rule" },
      { "rarity": "Illustration Rare", "cardCount": 87,   "rule": { "mode": "pct",   "value": 40  }, "source": "fallback" }
    ] }
  ```
  - `cardCount` = nº de cartas del catálogo con esa rareza. `source="rule"` si hay fila explícita en
    `BUYLIST_PRICE_RULES`; `source="fallback"` si la rareza existe en el catálogo pero aún no tiene regla (muestra
    `{ mode:"pct", value: fallbackPct }`). Ordenado por `cardCount` desc (rarezas más frecuentes primero).
- `GET /api/v1/admin/pricing/buylist-rules` — **(NUEVO)** lee la tabla cruda + fallback.
  Res `200`: `{ rules: { [rarity: string]: BuylistRule }, fallbackPct: number }`
  (ej. `{ "rules": { "Common": { "mode":"fixed","value":50 }, "Reverse Holo": { "mode":"fixed","value":150 } }, "fallbackPct": 40 }`).
- `PUT /api/v1/admin/pricing/buylist-rules` — **(NUEVO)** reemplaza la tabla y/o el fallback.
  Req: `{ rules: { [rarity: string]: BuylistRule }, fallbackPct?: number }`
  - **Validación:** `mode ∈ {fixed, pct}`; si `fixed` → `value` **entero ≥ 0** (centavos); si `pct` → `value`
    **número en `[0, 100]`**; `fallbackPct` **número en `[0, 100]`**. `rules` debe ser objeto (no array).
  - Res `200`: mismo shape que el `GET`. **Auditado** (`AuditLog action=pricing.buylist_rules.update`, con
    `before`/`after`). **Surte efecto sin redeploy** (criterio 12b). Err `422 VALIDATION_ERROR` (modo/valor/rango inválidos).
- **DEPRECADOS (v1.3.1):** `GET/PUT /api/v1/admin/pricing/rarity-map` — la cotización ya **no** los usa; se
  conservan como no-op/legacy hasta su retiro. El editor nuevo consume `rarities` + `buylist-rules`.

#### Precio de VENTA por RAREZA (v1.13-sales-pricing — NUEVO backend; editor M2)
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
  Req: `{ setId?: string, fromReleaseDate?: string }`.
  - `setId` (opcional) → importa ese set puntual. **Debe cumplir `^[a-z0-9]+(-[a-z0-9]+)*$`** (anti-inyección en `q=set.id:`); si no, `422 VALIDATION_ERROR`.
  - sin `setId` → importa sets con `releaseDate >= fromReleaseDate`. **Default `fromReleaseDate` = dial `catalog_sync_from_date` (`"2024/01/01"`)**, editable sin redeploy vía `GET/PUT /admin/settings` (`catalogSyncFromDate`, §M10). Formato `yyyy/MM/dd`.
  Res `202`: `{ jobId, setsQueued: number, mode: "single" | "from_date" }`.
- `POST /api/v1/admin/catalog/backfill` — importa el **siguiente lote de sets más antiguos aún no importados** (colecciones previas a la frontera). Repetible.
  Req: `{ batchSize?: number = 10, untilYear?: number }`.
  Res `200`: `{ imported: [{ id, name, releaseDate, cardCount }], newBoundary: string, remaining: number }`. `newBoundary` = `releaseDate` del set más antiguo ya importado tras el lote; `remaining` = sets aún sin importar. Se repite hasta `remaining=0` (o hasta `untilYear`).
- `POST /api/v1/admin/catalog/sync-all` — **(v1.3, NUEVO)** importa **TODO el catálogo** (todos los sets remotos, sin frontera de fecha) — soporte de la **Opción 1** del cotizador (poder cotizar cualquier carta). **Truly-async**: encola los sets en la cola BullMQ y **retorna de inmediato** (no importa en el request, a diferencia del `sync` from-date actual — ver Desviación DEV-1 en ARCHITECTURE §9). **Admin-only** (`super_admin`).
  Req: `{ force?: boolean = false }` (sin otros campos; ignora `catalog_sync_from_date`).
    - **`force` (v1.6-finish, opcional, default `false`, admin-only):** controla si se reprocesan los sets **ya importados**.
      - `false` (default): **comportamiento actual** — se **saltan** los sets ya importados; solo se encolan los sets remotos aún no presentes.
      - `true`: **no filtra** por sets ya importados — se encolan **TODOS** los sets (incluidos los ya importados) para **repoblar** `Card.availableFinishes` y los precios por acabado tras la **migración M-18** (v1.6-finish). Usar tras el deploy que requiere RE-SYNC (ver Changelog v1.6-finish, criterio 24).
    - **Retrocompatible:** omitir `force` (o enviar `false`) preserva el contrato y la semántica previos; ningún consumidor existente se rompe. El campo es aditivo y opcional.
  Res `202`: `{ jobId: string, setsQueued: number, remaining: number }` (`setsQueued` = sets encolados en esta llamada; `remaining` = sets remotos aún no importados tras encolar; con `force=true`, `remaining` puede ser `0` aunque se hayan encolado todos los sets). Idempotente: los sets ya importados se re-upsertean sin duplicar. Auditado (`action: catalog.sync_all`, con `force` registrado en el detalle).
  > **Alternativa sin endpoint nuevo:** el mismo resultado se logra con `POST /admin/catalog/sync` pasando un `fromReleaseDate` muy antiguo (p. ej. `"1998/01/01"`) **más** `POST /admin/catalog/backfill` repetido hasta `remaining=0`. `sync-all` existe para hacerlo explícito y **seguro contra timeouts** en catálogos grandes. Backend decide si `sync-all` es un wrapper que encola lo mismo que `backfill` en lote completo.
  > **Uso en Fase 1 (v1.12-catalog-pricing, ARCHITECTURE §4.13):** este endpoint **cubre 1.3 y 1.4 sin variantes nuevas** — (1.4, frontend) botón **"Importar sets nuevos"** en M2 = `sync-all {force:false}` (solo sets no importados) + polling `sync-status` + refrescar `remote-sets`; (1.3, disparo manual del refresco de precios) = `sync-all {force:true}` (re-sync completo que repuebla `PriceReference` por acabado). El job automático `catalog-price-sync` 2×/día ejecuta internamente la misma lógica de `force:true`.
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

### M3 — Ventas / órdenes (`vault_operator` lectura; `super_admin` reembolso)
- `GET /api/v1/admin/orders` — query `?status=&userId=&from=&to=&page=`
- `GET /api/v1/admin/orders/:id` — detalle con desglose + línea de Stripe + CFDI. Incluye además **dos banderas operativas de back-office** (solo en este detalle admin, **no** en `OrderSummaryDTO` ni en el detalle del cliente): `chargebackNeedsManual: boolean` (un contracargo llegó cuando la carta **ya se había enviado**, hay que pelear la disputa con la guía; ver §9) y `disputeOutcome: "won" | "lost" | null` (resultado del cierre de la disputa Stripe). El enum `OrderStatus` **no cambia**: `won → settled`, `lost → chargeback`; estas banderas dan el matiz que el enum no expresa.
- `POST /api/v1/admin/orders/:id/refund` — **`super_admin`** — Req `{ reason }` + `Idempotency-Key` → reembolso Stripe, Order `→refunded`. Err `403 MONEY_OUT_FORBIDDEN` para operador. **Reembolso EXCEPCIONAL** (política VENTAS FINALES): no hay reembolso voluntario. La excepción legítima es un **error de la plataforma** (p. ej. cobro doble, inventario fantasma), que **siempre** se reembolsa. **NO** re-agrega el item al inventario. (La política de negocio completa vive en `PROJECT.md`.)

### M4 — Retiros / envíos (`vault_operator+`)
- `GET /api/v1/admin/shipments` — cola. `?status=&userId=&page=`
  - **`userId?` (v1.7-admin-users, NUEVO):** filtra por `ShipmentRequest.userId` (simetría con `GET /admin/orders`). Alimenta la ficha 360° del usuario. Paginado; mismo guard y misma proyección que sin filtro.
- `GET /api/v1/admin/shipments/:id`
- `GET /api/v1/admin/shipments/picking-list` — **lista de picking ordenada por ubicación** (`?date=` opcional) → items con `folio` + `location.label`.
- `PATCH /api/v1/admin/shipments/:id/status` — Req `{ to: ShipmentStatus }` (transiciones `solicitado→picking→guia→enviado→entregado`).
  - **v1.17 — efecto sobre el inventario al llegar a `entregado`:** al transicionar el envío a **`entregado`**, cada `InventoryItem` de sus `ShipmentItem` pasa **`in_custody → withdrawn`** (única escritura persistente del ciclo de envío; los pasos `solicitado→enviado` **no** tocan el item). Se registra un `InventoryMovement` `reason='withdrawal'`. Efecto observable: el item **sale de "Mi Bóveda"** (`GET /vault/holdings` excluye `withdrawn`) y **deja de contar** en el portafolio. El item conserva `ownerType=customer, ownerUserId, ownershipStatus=settled` (registro histórico de titularidad; solo cambia `status`). Es la contraparte de la señal de contracargo del §9 (que ya usaba el join `ShipmentItem`+envío `enviado/entregado` para saber si la carta salió físicamente).
- `POST /api/v1/admin/shipments/:id/tracking` — Req `{ carrier, trackingNumber, shippingCostCents? }` → avanza a `guia`.
  - **`shippingCostCents?` (v1.4-finance, NUEVO):** costo real que **la plataforma paga a la paquetería** por este envío (MXN centavos). **Distinto** de `ShipmentRequest.shippingFeeCents` (ingreso cobrado al cliente). **Opcional** (si se omite, no se modifica; el valor persistido arranca en `0` por default de columna, M-16) y **editable** re-invocando este endpoint (idempotente sobre carrier/tracking; no regresa el estado si ya está en `guia`/posterior). **Validación:** entero **≥ 0** (`422 VALIDATION_ERROR` si negativo o no entero). Alimenta el P&L de M7 (se resta, acotado por `pickingAt`). Queda en `AuditLog` (`action: shipment.tracking`, con `carrier`/`trackingNumber`/`shippingCostCents` en `after`).
  - Nota: `shippingCostCents` es un dato **interno de costo**; **no** se expone al cliente (`GET /shipments/:id` del comprador NO lo incluye).

### M5 — Buylist (`vault_operator` hasta verificación; `super_admin` pago SPEI)
- `GET /api/v1/admin/buylist` — cola `?status=&userId=&page=`
  - **`userId?` (v1.7-admin-users, NUEVO):** filtra por `SellRequest.userId` (simetría con `GET /admin/orders`). Alimenta la ficha 360° del usuario. Paginado; mismo guard y misma proyección PII por rol (la CLABE sigue enmascarada; en claro solo por `reveal-clabe`).
  - **Orden (v1.18-buylist-rejects, NORMA):** **`createdAt` desc** (solicitud más reciente primero). El código previo ordenaba `asc`; backend lo alinea en este stream. Cada fila ya expone `createdAt`.
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
  > - **Correo al vendedor (best-effort, POST-commit):** al transicionar a `rechazada` se envía correo al dueño de la
  >   solicitud (`User.email`, idioma por `User.locale` ES/EN) con: **qué carta** (nombre, set, número), **acabado**,
  >   **motivo** (`reason`) y **opciones con plazos**: devolución antes de `returnDeadlineAt` (a costo del usuario,
  >   coordinada con soporte@tcgvaultmx.com) o abandono en `abandonDeadlineAt`. **PROHIBIDO** en el correo: CLABE (ni
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
- `GET /api/v1/admin/finance/custody-value` → `{ totalCustodyValueCents }` (valor en custodia de clientes).
- `GET /api/v1/admin/finance/iva` — `?from=&to=` → `{ ivaCollectedCents, byOrder: [{ orderId: string, ivaCents: number, settledAt: string, status: string }, ...] }` (para conciliación/CFDI). El identificador de orden en cada item se llama **`orderId`** (no `id`).
- `GET /api/v1/admin/finance/export.csv` — `?report=pnl|iva|inventory&from=&to=` → CSV. **El CSV de `pnl` espeja el shape del response (v1.4-finance):** cabecera `report,incomeCents,shippingRevenueCents,cogsCents,stripeFeesCents,shippingCostCents,profitCents` (la columna `shippingCents` se renombra a `shippingRevenueCents` y se añade `shippingCostCents`).

### M8 — Disputas (`vault_operator+`; recompra `super_admin`)
- `GET /api/v1/admin/disputes` — cola `?status=&userId=&page=`
  - **`userId?` (v1.7-admin-users, NUEVO):** filtra por `Dispute.userId` (simetría con `GET /admin/orders`). Alimenta la ficha 360° del usuario. Paginado; mismo guard y misma proyección que sin filtro.
- `GET /api/v1/admin/disputes/:id` — detalle: `{ item, order, description, type, deadlineAt, evidenceContact: "soporte@tcgvaultmx.com" }`. **Sin comparador de fotos de ingreso** (v1.2): la evidencia del cliente llega **por correo a soporte**, fuera del sistema. Para gradeadas el detalle expone `gradingCompany + gradeValue + certNumber` (verificable en la graduadora); la imagen del item es la de catálogo.
- `POST /api/v1/admin/disputes/:id/resolve` — Req `{ resolution: "repurchase" | "reject", note }`. `repurchase` = **`super_admin`** (dinero saliente) → **compensación por disputa: recompra al precio pagado** (crea el pago de recompra), dispute `→resuelta_recompra`. Política VENTAS FINALES: el **cliente conserva la carta** y la carta **NO** regresa al inventario (no se re-agrega item, no se crea `InventoryMovement`). `reject` → `rechazada`.

### M9 — Reportes (`super_admin`)
> **Estado v1.3: YA EXISTE en backend** (`AdminReportsController` + `AdminService.launchMetrics/exportCsv`). No requiere backend nuevo; falta **consumo de frontend** (M9 es `ModuleTodo` en UI).
- `GET /api/v1/admin/reports/launch-metrics` — `?from=&to=` → métricas de lanzamiento vs metas N/X/Y/Z. Shape real: `{ users, salesSettled, buylistPaid, withdrawalsNoDispute, goals: { N, X, Y, Z } | null }`. Cuando **no hay metas fijadas**, `goals` debe ser **`null`** (el objeto completo), **no** un objeto con campos nulos como `{ N: null, X: null, Y: null, Z: null }`. Solo cuando el humano fija las metas, `goals` pasa a ser el objeto `{ N, X, Y, Z }`. Cada métrica respeta el rango por su fecha de realización (alta de usuario / `settledAt` / `paidAt` / `deliveredAt`).
- `GET /api/v1/admin/reports/export.csv` — `?report=pnl|iva|inventory&from=&to=` → CSV (comparte el `exportCsv` de M7; `report` default `pnl`).

### M10 — Config (diales) y bitácora (`super_admin`)
> **Estado v1.3: YA EXISTE en backend** (`SettingsController`: `GET/PUT /admin/settings`, `GET /admin/audit-log`). No requiere backend nuevo; falta **consumo de frontend** (M10 es `ModuleTodo` en UI). **La edición de diales es `PUT /admin/settings` con body parcial** (solo las keys a cambiar) — **no** existe ni se añade `PATCH/PUT /admin/settings/:key`; el front edita enviando el subconjunto de keys modificadas. Cada `PUT` queda en `AuditLog` (`action: settings.update`, con `before`/`after`).
- `GET /api/v1/admin/settings` → todos los diales `{ shippingFeeCents, aportacionPct, ivaPct, salesMarkupPct, stripeFeePct, stripeFeeFixedCents, stripeFeeIvaPct, buylistCapPerRequestCents, buylistCapPerMonthCents, ineThresholdCents, repoCapPerCardCents, fxBufferPct, fxManualOverrideRate?, pricingProviderRaw, pricingProviderGraded, pricingProviderSealed, priceProvider, sealedPriceSource, catalogSyncFromDate }`. `stripeFeeIvaPct` (fracción `[0,1)`, default **0.16**) = IVA que Stripe MX cobra **sobre su comisión**; entra en el gross-up del fee (ver ARCHITECTURE §5.1). `catalogSyncFromDate` (string `yyyy/MM/dd`, default **`"2024/01/01"`**) = frontera por defecto del sync de catálogo M2 (ver `POST /admin/catalog/sync`); editable sin redeploy. **Es una `ConfigSetting` de primera clase** (ARCHITECTURE §3.6), por lo que se expone aquí como los demás diales. Nota: `ine_retention_days` **no** se expone en este DTO (dial interno de retención/legal, fuera de la lista `ConfigSetting`). **v1.13-sales-pricing:** `salesMarkupPct` (markup GLOBAL de venta) queda **DEPRECADO** — la ruta de venta ya no lo lee (la reemplaza la tabla por rareza `SALES_PRICE_RULES`, §M2 › "Precio de VENTA por RAREZA"). Se conserva en el DTO como **palanca de rollback** (decisión abierta v1.13-3); su retiro es follow-up. Las tablas de venta/buylist por rareza **no** se editan por este `PUT /admin/settings` sino por sus endpoints dedicados de M2. **v1.14-price-ingest:** `priceProvider` (`price_provider`, enum `pokemonpricetracker | pokemontcg_io`, seed recomendado **`pokemontcg_io`**) selecciona el **proveedor de la ingesta masiva de precios** (WS-A, ARCHITECTURE §4.15); editable sin redeploy → palanca de **rollback** del proveedor de paga. Validado contra el enum; `422 VALIDATION_ERROR` si es otro valor. El flip a `pokemonpricetracker` se hace tras verificar el esquema del proveedor en la 1ª corrida (ARCHITECTURE decisión abierta v1.14-1/v1.14-4). **v1.19-sealed-tcgcsv:** `sealedPriceSource` (`sealed_price_source`, enum `SealedPriceSource = tcgcsv | off`, **seed `off`** fail-closed) enciende/apaga la **ingesta de la referencia de mercado del SELLADO** vía TCGCSV (job `sealed-price-ingest`, §M10-ops; ARCHITECTURE §4.19e). Con `off` el job es no-op; los `PriceReference` ya escritos permanecen (informativos e inertes). Editable sin redeploy; validado contra el enum (`422 VALIDATION_ERROR`). El flip a `tcgcsv` se hace tras validar el esquema real en staging (1ª corrida manual con `groupId`; runbook devops). NO afecta el precio de venta del sellado (siempre manual, PROJECT 3e).
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
>   hoy)` y refresca `Card.availableFinishes` desde el proveedor. **Reanudable** (cola en Redis), aísla fallos por set,
>   respeta `isManualOverride`. **Excepción a la forma de la familia:** acepta **`setId?`** opcional en el body (`POST
>   /admin/jobs/price-ingest { "setId": "sv8" }`) para ingestar **un solo set** — pensado para **verificar el esquema del
>   proveedor** en la 1ª corrida (v1.14-1) sin barrer todo el catálogo; omitirlo ingesta **todo** el catálogo. Res `202`:
>   `{ job: "price-ingest", enqueued: boolean, jobId?: string }` (o `{ ..., scope: "set", setId }` si se pasó `setId`).
>   **Toca dinero** (mueve precios de referencia) → sujeto a triple veredicto. Reemplaza a `catalog-price-sync` en el rol
>   de pricing (abajo).
> - **`sealed-price-ingest`** *(v1.19-sealed-tcgcsv — NUEVO):* dispara la ingesta de la **referencia de mercado del
>   SELLADO** vía TCGCSV (ARCHITECTURE §4.19d): grupos distintos de los items sellados **mapeados** → precios por grupo
>   → USD→MXN con FX+colchón → upsert idempotente de `PriceReference` `(cardId ancla, 'sealed',
>   'sealed:tcg:<productId>', 'normal', hoy)` con `source='tcgcsv'`. **Secuencial y AWAITED** (sin fan-out; volumen
>   minúsculo), single-flight, respeta `isManualOverride`. **Gateado por el dial `sealedPriceSource`** (§M10): con
>   `off` responde `202 { job, enqueued: false, reason: "SEALED_PRICE_SOURCE_OFF" }` y no ingiere nada (fail-closed).
>   **Excepción a la forma de la familia:** acepta **`groupId?`** entero opcional (`POST /admin/jobs/sealed-price-ingest
>   { "groupId": 23821 }`) para ingestar **un solo grupo** — verificación del esquema real en staging antes del flip del
>   dial (fixtures en dev; runbook devops). Res `202`: `{ job: "sealed-price-ingest", enqueued: boolean, jobId?: string }`
>   (o `{ ..., scope: "group", groupId }` si se pasó `groupId`). Es **referencia informativa** (no fija precio de venta
>   ni pago), pero escribe `PriceReference` → auditado y cubierto por el gate de seguridad como el resto de la familia.
> - **`catalog-price-sync`** *(v1.12.1, tarea 1.3 — **DEPRECADO en su rol de pricing por WS-A**):* dispara el **re-sync
>   completo del catálogo** (`force:true`) que **repuebla `PriceReference` por `(card, finish)`** reusando
>   `tcgplayer.prices` (FX del día). Es el **disparo manual** del refresco 2×/día (06:00 y 18:00 CDMX). **Equivale**
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
SellItemDTO      = { id, card: CardDTO, productType, rawCondition?, finish: Finish,
                     rarity?: string, appliedRule?: BuylistRuleApplied,
                     quotedPriceCents?, approvedPriceCents?, itemStatus: SellItemStatus, inventoryItemId?,
                     rejectedAt?: string, rejectionReason?: string,
                     returnDeadlineAt?: string, abandonDeadlineAt?: string }
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
PendingPriceEntry= { id, cardId, productType, gradeKey, finish: Finish, context, status: "open"|"resolved", createdAt }
// v1.8-ronda-c (BE-10): resumen de un item en la bóveda del usuario para la ficha 360° admin (GET /admin/users/:id).
// `referenceValue` reusa el MISMO PriceInfo por-acabado que HoldingDTO (§3); items sin precio → status="pending".
// Es una PROYECCIÓN (no tabla): no migra. Antes traía solo { inventoryItemId, folio, card, ownershipStatus }.
AdminUserOwnedItemRef = { inventoryItemId, folio, card: CardDTO, productType: ProductType, finish: Finish,
                         ownershipStatus: OwnershipStatus, referenceValue: PriceInfo }
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
- Precios de catálogo/ficha **sin IVA**. Se distingue **valor de referencia** (mercado, `referenceValue`) del **precio de venta** (`salePriceCents`). **v1.13-sales-pricing:** el `salePriceCents` se resuelve por la **regla de venta de la rareza+acabado** del item (`SALES_PRICE_RULES`: `fixed` piso MX$, o `pct` = referencia × (1 + value/100) = markup arriba de mercado) u **override manual** (`listPriceCents`); reemplaza el markup global `salesMarkupPct` (deprecado). IVA 16% y fee de procesamiento se agregan **en checkout** (`BreakdownDTO`).
- **Fee de procesamiento = gross-up** de la comisión Stripe (para recibir íntegro subtotal+IVA); **sin IVA de producto sobre el fee** (el fee no vuelve a gravar la venta). Internamente el gross-up **sí** cubre el IVA que Stripe MX cobra sobre su comisión (dial `stripe_fee_iva_pct`, default 0.16). IVA de producto grava subtotal (compra) y tarifa de envío (retiro).
- **CFDI sin PAC en MVP**: factura por correo (`POST /orders/:id/request-invoice`); IVA cobrado registrado en M7. Timbrado real = fase 2.
- **FX automático (Banxico) + colchón + override manual** (M10); job diario `fx-refresh`.
- **Envío se cobra por Stripe ANTES** de crear la solicitud; avanza a picking solo tras `payment_intent.succeeded`.
- Carta "precio pendiente" → `sellable=false`, compra bloqueada con `PRICE_PENDING`; escalada al dueño vía `PendingPriceEntry`. **v1.8-ronda-c:** la cola es **por acabado** (`PendingPriceEntry.finish`); el override (`POST /admin/pricing/override` con `finish?`) resuelve solo el pendiente de ese acabado.
- **Ronda C (v1.8):** (a) **BE-10** — `AdminUserOwnedItemRef` (bóveda de la ficha 360° admin) trae `finish` + `referenceValue: PriceInfo`, reusando la valuación por-acabado del `HoldingDTO`; enriquecer el ref (no endpoint nuevo). (b) **SEC-D2** — `SellRequest.closedAt` (interno, no en DTOs de cliente) ancla la retención de INE al cierre real (`pagada`/`rechazada`/`abandonada`). Migración **M-19** (dos columnas; BE-10 no migra). SEC-A1 intacto.
- Retiro solo sobre `settled` (`ITEM_NOT_SETTLED`); direcciones solo MX (`ADDRESS_NOT_MX`).
- Buylist: cotización por **regla por rareza oficial** (v1.3.1 — `fixed` MX$ / `pct` % de la referencia + fallback %; reemplaza común/reverse/EX+), topes y INE (`BUYLIST_LIMIT_EXCEEDED`, `INE_REQUIRED`), pago SPEI **solo súper-admin** tras recepción/verificación. La regla se **deriva server-side** de `Card.rarity` (SEC-A1); editor en M2 (`buylist-rules`/`rarities`).
- **Alta de usuarios por rol + historial 360° (v1.7-admin-users):** `POST /admin/users` (super_admin-only, auditado `user.create`, NO money-out) crea cuentas de cualquier rol sin KYC/CLABE/INE; `emailVerified=true` para staff y para el customer creado por admin; `mustChangePassword=true` solo si la contraseña es autogenerada (devuelta una vez en `tempPassword`, nunca en `AuditLog`). Crear `super_admin` = escalada de privilegios, controlada por super_admin-only + auditoría. El historial 360° se arma por **reuso**: `?userId=` en `GET /admin/{orders,buylist,shipments,disputes}` (paginados, misma proyección PII por rol) + `GET /admin/users/:id/audit` (AuditLog por `scope=target|actor|both`, expone action/actorRole/entityType/entityId/createdAt + `ip` solo super_admin, **nunca** before/after; `vault_operator` reducido sin `ip`). Sin migración (reusa `User`/`AuditLog`). Ver ARCHITECTURE §4.7bis.
- **Acabado / versión de carta (v1.6-finish):** `Finish = normal | reverse_holo | holofoil | first_edition_holofoil`, modelado en **toda la cadena** (Compra, cotizador, inventario/bóveda, portafolio). `CardDTO.availableFinishes` (derivado de `tcgplayer.prices`), `finish` en `ListingDTO`/`HoldingDTO`/`SellItemDTO` y en req de quote/requests/alta M1. El monto se **deriva server-side** de `(Card.rarity, finish)` **validado contra `availableFinishes`** (SEC-A1); acabado no disponible → `422 FINISH_NOT_AVAILABLE`. La cotización es por acabado: el acabado selecciona la regla (reverse holo → `"Reverse Holo"`; holofoil / 1st ed → rareza base si ya es holo, si no `"Holo"`; normal → rareza base) y, para `pct`, usa el market de **ese** acabado. `PriceReference` lleva `finish` en su clave; el provider guarda precio por acabado. **1 fila por `Card`** (no cambia). Migración **M-18** (aditiva, default seguro `normal`/`[normal]`) → **RE-SYNC** del catálogo tras desplegar. Ver ARCHITECTURE §3.7 y §4.2.1.
- Contracargo (webhook `charge.dispute.created`) es **consciente del estado físico**: revierte el item a inventario de plataforma **solo si sigue en bóveda**; si ya se envió/entregó **no** re-agrega y marca `chargebackNeedsManual` (ver §9). Cierre de disputa: ganamos→`settled` (`disputeOutcome=won`), perdemos→`chargeback` (`disputeOutcome=lost`).
- **VENTAS FINALES** (política del humano, ver `PROJECT.md`): no hay reembolso voluntario. Excepciones: (a) **error de la plataforma** (cobro doble/inventario fantasma) → **siempre** se reembolsa (§M3); (b) **disputa de condición** raw dañada/equivocada → el súper-admin compensa con **recompra al precio pagado**, el cliente **conserva la carta** y **no** vuelve al inventario (§M8). En ningún caso de reembolso/recompra el item se re-agrega al inventario.
- Los montos exactos de los diales (envío 17500, IVA 16, markup de venta, tarifa Stripe, tope 300000/1000000, aportación 70%) provienen de `ConfigSetting` (M10), no hardcode; los valores aquí son defaults.
- **Master set en todas partes (v1.20):** un solo contrato de "contenido por set y acabado" con `scope`
  (`platform` | `user_vault`) sirve M1, la vista admin de la bóveda de un cliente y "Mi bóveda" del cliente. La
  **completitud cuenta variantes (carta+acabado)**, con universo = `Card.availableFinishes`. `buyable` (variante
  faltante → pieza `listed` más barata) SOLO en la vista del propio cliente. Ajustes de inventario con motivo
  obligatorio (`AdjustmentReason`) + `InventoryAdjustment`/`InventoryMovement(adjustment)`/`AuditLog`; **sin venta
  directa desde el binder** (toda venta va por órdenes). Migración M-24. Ver ARCHITECTURE §4.20.
- **P&L separa ingreso vs costo de envío (v1.4-finance):** el envío entra al P&L por dos lados — **ingreso** (`ShipmentRequest.shippingFeeCents`, `shippingRevenueCents` en el response) y **costo** (`ShipmentRequest.shippingCostCents`, capturado en M4 al asignar guía, M-16). Fórmula: `profitCents = incomeCents + shippingRevenueCents − cogsCents − stripeFeesCents − shippingCostCents`. Ambos se acotan al periodo por `pickingAt`. `shippingCostCents` es un **costo interno**: no se expone al cliente. `GET /admin/finance/pnl` renombra `shippingCents`→`shippingRevenueCents` (M7 sin consumidores de frontend aún); el CSV espeja el shape.

**Coherencia v1.1 (2026-08-14):**
- **Raw solo NM:** `RawCondition=NM` (único valor); el filtro `condition` para raw solo admite `NM`. Labels legibles ("Casi nueva (Near Mint)" / "Near Mint") viven en i18n del **front**, no en la API. Migración: ARCHITECTURE §11 (M-1).
- **Compra = inventario publicado con precio:** `GET /catalog/cards` **excluye** pendientes/sin precio (el comprador nunca ve "precio pendiente"). Facetas dinámicas en `GET /catalog/facets`: `rarities` distinct de `Card.rarity` espejando pokemontcg.io (lista abierta), `sets` con `year` derivado, filtros por set/rareza/tipo/precio. La **ruta se mantiene** `/catalog/cards` (rótulo "Compra" en el front).
- **Sellado como línea de venta:** `productType=sealed`, `sealedSubtype?`, **precio manual MXN obligatorio para publicar**, sin condición/grade/rareza. Disputa de sellado = caja dañada/equivocada (evidencia por correo a soporte; ver Coherencia v1.2). **v1.19-sealed-tcgcsv:** existe además una **referencia de mercado informativa** del sellado (TCGCSV, `source=tcgcsv`, solo back-office M1/M2, mapeo curado M-23, dial `sealedPriceSource` seed `off`) que **NO** altera esta regla: el precio de venta del sellado sigue siendo manual (PROJECT 3e); ver §M1/§M2/§M10 y ARCHITECTURE §4.19.
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

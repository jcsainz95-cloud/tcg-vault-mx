# ARCHITECTURE.md — Marketplace TCG con Bóveda (Pokémon, México)

> Propiedad: **arquitecto**. Fuente de verdad de decisiones técnicas y modelo de datos.
> Manda `PROJECT.md` sobre este documento, y este documento sobre el código.
> Estado: v1.21.2-chargeback-fulfillment (MVP, plataforma en producción). Fecha: 2026-08-18. Branch: `stream/ordenes-guest-checkout`.
>
> **Changelog v1.21.2-chargeback-fulfillment (2026-08-18) — Cierre del hallazgo BLOQUEANTE del techlead (T1) + D6 y
> D4. El hueco era de la NORMA, no de la implementación: §4.21c describía el reverso del contracargo solo en
> términos del `InventoryItem` y no decía nada del `ShipmentRequest`.** Ver **§4.21c-bis** (nueva), §4.21d, §4.21h,
> §11 (**M-25b**) y API_CONTRACT §9/§M3/§M4.
> - **T1 — double-sell físico (bloqueante).** Un contracargo sobre un pedido `direct_ship` con el envío en
>   `picking`/`guia` re-listaba la pieza **mientras el envío seguía en la cola de picking** ⇒ la misma pieza única
>   podía venderse a un segundo comprador mientras el operador la metía en la caja. **Norma nueva: el contracargo
>   NUNCA re-lista automáticamente una pieza con envío vivo.** Envío no terminal ⇒ `ShipmentRequest → cancelado` en
>   la misma transacción (sale de `pickingList()`) + item **congelado** en `picking` (fuera de venta) +
>   `chargebackNeedsManual=true`; el desenlace lo confirma un humano
>   (`POST /admin/orders/:id/chargeback-inventory`: `recuperada | no_recuperada | reexpedir`). Se eleva a invariante:
>   **una pieza con `ShipmentItem` en un envío no terminal jamás puede estar en `{listed, in_stock}`**. Ganar la
>   disputa **no** re-expide solo. **Sin enums ni columnas nuevas** (reusa `ShipmentStatus.cancelado`).
> - **D6 — el `CHECK` que faltaba pasa a NORMATIVO (M-25b):**
>   `InventoryItem CHECK (ownerType <> 'customer' OR ownerUserId IS NOT NULL)`. Era el único de los cinco
>   invariantes sin implementar, y es justo el que §4-G.0-1 llama «lo que hace segura la nulabilidad de
>   `Order.userId`». Tabla de otro stream ⇒ el orquestador serializa.
> - **D4 — un solo discriminador canónico:** `ShipmentRequest.orderId` responde **solo** "¿de dónde viene el
>   envío?"; **todo comportamiento** (terminal del item, `kind` del DTO) se decide por **`Order.fulfillmentMode`**,
>   con `switch` **exhaustivo y ruidoso** (un modo no soportado **lanza**, nunca cae en `direct_ship`).
> - **§4.21h — el test «contracargo antes/después de enviar» ya estaba pedido y no se escribió**; ahora es condición
>   de aprobación, desglosado en 8 casos (incluido el de regresión del double-sell).
>
> **Changelog v1.21.1-guest-checkout-fixes (2026-08-18) — Correcciones post-implementación (regla 9). SIN migración
> adicional; M-25 no cambia.** Ver **§4.21e-bis** (nueva), §4.21c y §3.2 (`OrderAccessToken`).
> - **Las dos vidas del token (lo importante).** La v1.21 pedía enviar por correo "el mismo" token del checkout:
>   **irrealizable** (solo hay hash en BD ⇒ el claro es irrecuperable — que es la propiedad T5 que queríamos).
>   Norma: **checkout = 120 min**, **correo = 90 días**; el **settle no rota** (rotar mataría la confirmación
>   post-3DS), **reenvío y soporte sí**. El solapamiento de dos puertas sin contraseña baja de **90 días a ≤2 h**.
>   Sin columna nueva: las dos emisiones se distinguen solo por `expiresAt`.
> - **`details.reason` de la revocación se deriva** (`CLAIMED` | `ROTATED`); se elimina `SUPPORT` — el forense vive
>   en `AuditLog`, no en el cuerpo de la respuesta.
> - **`InventoryMovement.reason` del ciclo de invitado:** `settle` (reserved→picking) y `sale` (→shipped,
>   →delivered); **`withdrawal` prohibido** (es de bóveda). Sin valores nuevos en el enum.
> - Conteo de códigos de error: **8**, no 7 (API_CONTRACT §0 manda).
>
> **Changelog v1.21-guest-checkout (2026-08-18) — WS «Órdenes y dinero»: COMPRAR SIN CUENTA (PROJECT §J, §J.1,
> criterios 45–56b).** Ver **§4.21** (spec completa: ruta de fulfillment, ciclo de vida de los items, modelo de
> amenazas del enlace), §3.3 (pointer), §7, §11 (**M-25**) y API_CONTRACT §4-G.
> - **El hallazgo que da forma al diseño:** hoy **no existe** la elección "envío vs bóveda". Comprar **siempre**
>   deposita en la bóveda (`createSession` pone `ownerType='customer'` + `ownerUserId`; el webhook lo pasa a
>   `in_custody/settled`) y el **envío es un flujo posterior COBRADO APARTE** (`ShipmentsService` exige
>   `ownerUserId === userId`, `settled`, `in_custody` y una `Address` **guardada del usuario**, y crea su **propio**
>   PaymentIntent). Por eso «envío directo para invitados» **no es aflojar el auth: es una ruta de fulfillment
>   NUEVA** — `Order.fulfillmentMode = vault | direct_ship`, dirección **capturada en línea** (snapshot en la orden,
>   el invitado no tiene `Address`) y **envío cobrado en el MISMO PaymentIntent** (el invitado no puede pagar un
>   segundo PI desde una bóveda que no tiene).
> - **Ciclo de vida del item sin bóveda:** en `direct_ship` el item **jamás** pasa a `ownerType='customer'`
>   (no hay `ownerUserId` que poner, y ponerlo `null` rompería la bóveda de todos). Conserva
>   `platform/null/null` y su ciclo lo lleva `status`: `reserved → picking → shipped → delivered`, estrenando los
>   tres valores de `InventoryStatus` que v1.17 dejó **sin uso por diseño**. **Sin enum nuevo.** Se eleva a
>   invariante escrito: **`ownerType='customer'` ⇒ `ownerUserId NOT NULL`**.
> - **`ShipmentRequest` con dos naturalezas:** `userId` nullable + `orderId?` como **discriminador**. El envío
>   directo lo **crea el servidor** al liquidar (nace en `picking`, sin PI propio, con montos en `0` para que el
>   P&L no cuente el envío dos veces: el ingreso vive en `Order.shippingFeeCents`). M4 lo opera igual salvo la
>   **transición terminal** (`delivered`, no `withdrawn`).
> - **Token de seguimiento = opaco + hash en BD, NO JWT** (`OrderAccessToken`): 32 bytes `base64url`, solo el
>   SHA-256 persistido, **multi-uso** (`revokedAt`, no `usedAt`), TTL 90d, rotación al reenviar, tope de edad 365d.
>   Es el patrón de `AuthToken` (§3.2) con la única diferencia semántica de "revocable pero no consumible".
> - **Anti-enumeración como propiedad del código, no del copy:** el camino de invitado **nunca** consulta `User`
>   por correo; el reenvío exige `(email + orderNumber)` y responde `202` siempre; el reclamo exige **correo
>   verificado** (prueba de titularidad) y es **explícito**, nunca silencioso. El modelo soporta las **tres**
>   políticas posibles del hueco abierto del PO **sin migración**.
> - **Migración M-25** (`Order.userId` nullable + 9 columnas, `ShipmentRequest` +2, enum `FulfillmentMode`, modelo
>   `OrderAccessToken`): **`backend/prisma/` es zona compartida**, el orquestador la serializa.
>
> **Changelog v1.20-master-set-everywhere (2026-08-17) — WS «Inventario y vault»: Master set en TODAS partes.**
> La vista Master Set (v1.16, §4.17, solo M1) se generaliza a un **read model único parametrizado por scope**
> (`platform` | `user_vault`) que sirve tres vistas con el **mismo shape**: (i) M1 interno (endpoints existentes,
> DTOs extendidos), (ii) admin viendo la bóveda de cualquier cliente (`GET /admin/vaults/:userId/master-sets[...]`,
> `vault_operator+`) y (iii) el cliente viendo su propia bóveda (`GET /vault/master-sets[...]`, `customer`).
> **Completitud por VARIANTE (carta+acabado)** con universo = `Card.availableFinishes` (campo ya existente, §4.15e).
> Nuevos además: `GET /admin/vaults` (lista de clientes con bóveda, valuación reusada del portafolio),
> **`buyable`** en el binder del cliente (variante faltante → pieza `listed` más barata), y
> **`POST /admin/inventory/adjustments`** (levantamiento físico con motivo obligatorio, `InventoryAdjustment` +
> `InventoryMovement(adjustment)` + `AuditLog`; **sin venta directa desde el binder**). Migración **M-24**.
> Decisión de frontend: **promover** los componentes de master set de `(admin)/admin/m1/master-set/` a
> `frontend/src/components/master-set/` (zona compartida, reservada por este stream). Nuevo **§4.20**.
>
> **Changelog v1.19-sealed-tcgcsv (2026-08-17) — WS «Catálogo y precios»: fuente de REFERENCIA de mercado para producto
> SELLADO vía TCGCSV (tcgcsv.com — espejo diario estático de precios de TCGplayer, JSON, sin API key, cubre ETB/booster
> box/bundle/tin/blister). Aditivo, no-breaking, TODO admin-only (la superficie pública NO cambia). ⚠️ **UNA migración
> (M-23, §11):** enum `PriceSource += tcgcsv` + 2 columnas nullable en `InventoryItem` (`tcgplayerProductId`,
> `tcgplayerGroupId`) + índice — **prisma = zona compartida**, el orquestador serializa. Ver **§4.19** (spec completa),
> §3.6 (actualizado) y API_CONTRACT v1.19 (§0 enums, §M1, §M2, §M10, §M10-ops).**
> - **PROJECT 3e MANDA — la precedencia no cambia:** el sellado se sigue vendiendo con **precio manual del admin en MXN**
>   (`listPriceCents`, obligatorio para publicar). El precio TCGCSV es **valor de referencia informativo** (sugerencia en
>   back-office M1/M2 al fijar el precio); NO auto-publica, NO fija `listPriceCents`, NO alimenta `PendingPriceEntry`,
>   NO cambia el costo de aportación del sellado y NO se expone en la ficha pública en esta versión (preguntas abiertas
>   v1.19-1/2).
> - **Adapter `TcgcsvSealedBulkProvider`** (nuevo, `modules/pricing/providers/`), SEPARADO del bulk de cartas: nueva
>   interfaz `SealedBulkPriceProvider` keyeada por `tcgplayerProductId` (no hay Card remota que resolver). Host FIJO
>   `https://tcgcsv.com` anti-SSRF, categoría Pokémon = 3 (constante), `groupId` entero validado, sin API key.
>   Money-safe: `subTypeName≠'Normal'` / market inválido → se OMITE; fallo parcial → NUNCA borra precios previos (stale).
> - **Mapeo curado (M-23):** el sellado no tiene entidad de catálogo propia (es `InventoryItem` anclado a una `Card`);
>   el mapeo vive en el item (`tcgplayerProductId`+`tcgplayerGroupId`, curación manual del admin en M2 con cola derivada
>   de NO-mapeados + explorador proxy de grupos/productos TCGCSV + `applyToSiblings`). Sin fuzzy-matching automático.
> - **Persistencia SIN migrar `PriceReference`:** upsert idempotente con `productType='sealed'`,
>   **`gradeKey='sealed:tcg:<productId>'`** (nuevo esquema; desambigua 2 productos sellados anclados a la misma Card),
>   `finish='normal'`, `source='tcgcsv'`, USD→MXN con `FxService` + colchón (FX 1 vez por corrida). `buildGradeKey`
>   (`'sealed'`) NO cambia (lo siguen usando override manual y costo de aportación).
> - **Job propio `sealed-price-ingest`** (1×/día tras la actualización TCGCSV ~20:00 UTC; secuencial AWAITED, sin fan-out
>   — volumen minúsculo; single-flight; disparo manual `POST /admin/jobs/sealed-price-ingest { groupId? }`).
> - **Dial fail-closed `sealed_price_source` (`tcgcsv | off`, seed `off`):** nada se ingiere hasta validar en staging y
>   flipear (patrón `PRICE_PROVIDER` §4.15h). Rollback = volver a `off`.
> - **Dev con red bloqueada → FIXTURES:** el adapter se desarrolla/testea contra JSON reales de muestra en
>   `backend/test/fixtures/tcgcsv/`; la validación real es la 1ª corrida manual en staging (runbook = devops).
>
> **Changelog v1.18-buylist-rejects (2026-08-17) — WS «Catálogo y precios»: M5 operable — identidad del vendedor,
> orden del listado, semántica completa del ítem RECHAZADO (plazos 7d/30d + correo al vendedor) y orden normativo de
> `GET /buylist/sets`. PROJECT §H / criterios 15–16.** Aditivo, no-breaking. ⚠️ **UNA migración (M-22, §11):** 2
> columnas nullable en `SellRequestItem` (`rejectedAt`, `rejectionReason`) — **prisma = zona compartida**, el
> orquestador serializa. Ver **§4.18** (spec completa), §9 (BL-1) y API_CONTRACT v1.18 (§6, §M5, §11).
> - **Rechazo de ítem:** `reason` obligatorio en `decision:"reject"`; `rejectedAt` = ancla ÚNICA de plazos;
>   `returnDeadlineAt` (+7d, devolución a costo del usuario) y `abandonDeadlineAt` (+30d) **DERIVADOS** al proyectar
>   (no columnas; mismas constantes que `buylist-sweep`). Invariante de dinero: ítem `rechazada` ⇒
>   `approvedPriceCents=null` y fuera de `approvedTotalCents` (cierra BL-1: approve→reject dejaba monto fantasma).
>   `rechazada` **NUNCA** convertible a inventario (guardia `ITEM_NOT_APPROVED` = norma; PROJECT criterio 16).
> - **Correo de rechazo (§4.18):** enviado desde `buylist` inyectando el puerto global **`MAIL_PORT`** con plantilla
>   LOCAL al módulo (ES/EN por `User.locale`, mismo layout/escape que `mail.templates.ts`). El módulo `mail` es de
>   OTRO stream y NO se toca (deuda aceptada: la plantilla vive fuera de `mail/` hasta que «Cuentas y acceso» la
>   absorba). **Best-effort** (fallo ⇒ log, nunca revierte la decisión); sin CLABE ni datos de otros ítems.
> - **M5:** `seller: { id, name, email }` en listado/detalle (correo = contacto operativo, NO CLABE ⇒ sin reveal);
>   listado por `createdAt` **desc**; nuevo `GET /admin/buylist/rejected-items` (pestaña «Rechazadas», transversal).
> - **`GET /buylist/sets`:** norma `releaseDate` desc (fecha completa) → desempate `name` asc → sin `releaseDate` al
>   final.
> - **Coordinación de streams:** `backend/src/jobs/` se asigna al stream que toca sus jobs (nota en §2).
>
> **Changelog v1.17.1-withdrawal-eligibility (2026-08-17) — Cierre de invariante read/write del RETIRO (triple verdicto
> WS-H: techlead + seguridad SEC-H1 + qa). SOLO documentación.** La transición terminal deja el item `status='withdrawn'`
> pero conserva `ownershipStatus='settled'` (histórico); el criterio de creación de retiro (`classifyItems`) exigía
> `settled` pero **no excluía** `withdrawn`, permitiendo re-enviar/re-cobrar un item ya entregado por llamada directa.
> Se **norma en §3.3** que `withdrawn` es **TERMINAL para retiros** (no re-elegible) y que la fuente de verdad de
> elegibilidad **excluye** `withdrawn` y exige `status='in_custody'`: `ownerType='customer' AND ownerUserId=usuario AND
> ownershipStatus='settled' AND status='in_custody' AND sin envío activo` — **mismo** criterio que el flag de lectura
> `HoldingDTO.withdrawable`. Error normado **`422 ITEM_NOT_IN_CUSTODY`**. Ver **§3.3** y API_CONTRACT v1.17.1 (§0, §3, §5).
>
> **Changelog v1.17-withdrawal-lifecycle (2026-08-17) — Cierre del ciclo de RETIRO en la bóveda (Opción 1 del humano).**
> Cierra el hueco WD-1 (§9): el `InventoryItem` nunca se movía durante el envío, así que la carta seguía en "Mi Bóveda"
> como liquidada con RETIRAR activo de por vida y sin rastreo para el cliente. Se norma: (1) al pagar, la carta se queda
> en la bóveda marcada **EN RETIRO** con RETIRAR deshabilitado; (2) retiro **rastreable** por etapa; (3) en `entregado`
> la carta **sale** de la bóveda (`in_custody → withdrawn`). **Fuente de verdad canónica = join
> `InventoryItem→ShipmentItem→ShipmentRequest`** (no espejo de estado en el item; única escritura persistente =
> transición terminal a `withdrawn`). **Aditivo, SIN migración** (reusa `InventoryStatus.withdrawn` y la máquina
> `ShipmentStatus`). SEC-A1 intacto. Ver **§3.3** (ciclo de vida del item en retiro), §3.2 (InventoryItem.status), §9
> (WD-1) y API_CONTRACT v1.17 (§3 HoldingDTO, §5 rastreo del cliente, §9 webhooks, §M4).
>
> **Changelog v1.15-buylist-batch-clabe (2026-08-17) — WS-C: cotizador de buylist (Fable) contra el backend REAL
> (Fase 3b).** El cotizador rediseñado del frontend usa hoy **mocks/atajos** que NO funcionan contra el backend real:
> (a) cotiza N cartas con **N requests** (fan-out FE-12) porque `POST /buylist/quote` es **por-carta**; (b) el atajo
> "usar mi CLABE ****1234" es **mock-only** porque `CreateRequestDto` **exige** `clabe` en claro y el cliente solo tiene
> `clabeMasked` (`buylist.dto.ts:51`, flag mock `useClabeOnFile` en `api.ts:542-550`); (c) el front no sabía de forma
> limpia si el INE ya está en archivo. Se cierra el hueco de contrato. **Aditivo, SIN migración de esquema** (reusa
> `KycProfile.clabeEnc`/`ineFrontKey`/`ineBackKey`, `SellRequest.clabeSnapshotEnc`, la función pura
> `quoteAcquisitionForFinish` y `PriceReference`). **TOCA DINERO/PII** (buylist = pago SPEI + CLABE + INE) → **triple
> veredicto**. SEC-A1 intacto (montos server-side por `(Card.rarity, finish)`; el cliente nunca fija precio ni CLABE de
> terceros). Nuevo **§4.16**.
> - **C.1 — `clabe` OPCIONAL + fallback server-side (backend, PII, §4.16a).** `POST /buylist/requests`: `clabe` pasa a
>   **opcional**. Si el request **no** trae `clabe`, `createRequest` **resuelve la CLABE del propio usuario** desde
>   `kyc.clabeEnc` (desencriptada con `PiiCryptoService`, **igual que el fallback de `revealClabe`**,
>   `buylist.service.ts:453-457`). **Autorización:** la CLABE de fallback es **siempre** la del `userId` autenticado
>   (`kyc = findUnique({ where:{ userId } })`), **jamás** la de otro usuario. Si **no** viene `clabe` **ni** hay una en
>   archivo → **`422 CLABE_REQUIRED`** (nuevo, claro y accionable). La CLABE resuelta (venga del request o del fallback)
>   se **snapshotea cifrada** en `SellRequest.clabeSnapshotEnc`, **nunca se loguea** y **nunca se devuelve** en la
>   respuesta; su único punto de exposición en claro sigue siendo `GET /admin/buylist/:id/reveal-clabe` (super_admin,
>   money-out, auditado). Cuando `clabe` **sí** viene, el comportamiento actual **no cambia** (valida formato →
>   `422 CLABE_INVALID`; match a nombre propio por blind-index → `422 CLABE_NOT_OWN_NAME`; persiste en KYC).
> - **C.2 — Batch quote `POST /buylist/quote/batch` (backend, §4.16b) — mata el fan-out FE-12.** Endpoint **NUEVO,
>   público, READ-ONLY** que cotiza **N cartas en 1 request**. **No** crea solicitud, **no** mueve dinero, **no**
>   persiste y **no** escala a `PendingPriceEntry` (misma doctrina read-only que `POST /buylist/quote` desde v1.12,
>   crítica por ser endpoint anónimo). Reusa **exactamente** la lógica del cotizador por-carta (`publicQuote` →
>   `quoteAcquisitionForFinish`, gate premium §4.2.1, `getReference` por acabado, FX ya bakeada en `PriceReference`),
>   cargando `buylistRules()` **una vez** por request. **Errores por-ítem**: una carta inválida (`NOT_FOUND` /
>   `FINISH_NOT_AVAILABLE`) **no tumba** las demás — cada ítem devuelve `ok:true` con su cotización u `ok:false` con su
>   `error`; el HTTP global es `200`. **Cap** de ítems por request (**`BUYLIST_QUOTE_BATCH_MAX = 50`**, constante de
>   servidor); vacío o sobre-cap → `400 VALIDATION_ERROR`. **Decisión de naming (endpoint NUEVO, no overload):** se
>   **conserva** `POST /buylist/quote` (por-carta) intacto y se añade `/batch` — **aditivo y no-breaking** (estilo del
>   contrato). Alternativa considerada y descartada: sobrecargar `POST /buylist/quote` con `items[]` (breaking para el
>   consumidor por-carta actual). Ver decisión abierta WS-C-1 en §10.
> - **C.3 — INE/CLABE en archivo expuestos al front (backend menor + frontend, §4.16c).** `GET /users/me/kyc` **ya**
>   devuelve **`ineOnFile: boolean`** (`users.service.ts:139`) — el front lo usa para **ocultar los uploaders de INE**
>   cuando ya está (y omitir `ineUploadKeys`; `createRequest` ya trata el INE en archivo como provisto,
>   `buylist.service.ts:209-211`). Se **añade `clabeOnFile: boolean`** (derivado de `Boolean(kyc.clabeEnc)`) para dar al
>   front un booleano **limpio y simétrico** a `ineOnFile` con el que habilitar el atajo "usar mi CLABE ****1234" (=
>   omitir `clabe` en `POST /buylist/requests`); `clabeMasked` se mantiene para el label. Sin PII nueva (la CLABE sigue
>   enmascarada).
> - **Contrato:** `API_CONTRACT.md` (Changelog v1.15-buylist-batch-clabe): `POST /buylist/quote/batch` (nuevo, §6);
>   `POST /buylist/requests` con `clabe?` opcional + fallback + `422 CLABE_REQUIRED` (§6); `GET /users/me/kyc` gana
>   `clabeOnFile` (§1); DTOs `BuylistQuoteItemDTO` / `BuylistBatchQuoteResultDTO` / `BuylistBatchQuoteResponse`. Sin
>   migración.
>
> **Changelog v1.16.1-master-set-reconcile (2026-08-17) — Reconciliación de docs §4.17 (Master Set) con el
> comportamiento YA implementado por backend y señalado por qa/seguridad. SOLO documentación; sin cambio de
> comportamiento, sin migración, sin endpoints nuevos.**
> - **§4.17b — `bulk-publish`: status de origen publicable + `ITEM_NOT_PUBLISHABLE`.** Se documenta el conjunto
>   permitido `{in_stock, listed}` (`in_stock`→publica; `listed`→no-op idempotente; **cualquier otro**→`422
>   ITEM_NOT_PUBLISHABLE`). Cierra un **double-sell** (una pieza `reserved`/vendida/en-custodia/enviada no puede volver
>   a `listed`) señalado por seguridad.
> - **§4.17a — `numberSort`: fórmula corregida.** La ilustrativa previa (`regexp_replace(number,'\D','','g')::int`)
>   ponía `TG12`→12 entre las numéricas, contradiciendo "promos (TG/GG/SV) al final". Se corrige a: numéricos puros por
>   entero primero, promos alfabéticos al final agrupados por prefijo (el backend ya lo hace así).
> - **§4.17a / §9 — `isSecretRare`: afinado a heurística de display.** La forma amplia `numberSort > printedTotal`
>   marcaba TODOS los promos como secret rare (deuda **BE-36**, §9). Se afina: secret rare **real** = numeración
>   principal (número puramente numérico) con entero > `printedTotal`; promos/subsets alfabéticos NO cuentan.
>   Decisión de producto (default propuesto, marcado). BE-36 enrutado a backend (no bloqueante, cosmético).
> - **Contrato:** `API_CONTRACT.md` Changelog v1.16.1 (§0 `422 ITEM_NOT_PUBLISHABLE`; DTO `MasterSetCardCellDTO`/
>   `BulkPublishLineInput`; §M1 binder + bulk-publish; §5 nota de enhancement opcional de `GET /shipments`).
>
> **Changelog v1.16-master-set (2026-08-17) — WS-E: Master Set + inventario a escala (M1, #4/#11/#12).**
> El inventario admin no escala (alta 1×1, tabla plana, sin agregado). Se añade una **vista Master Set** (binder por
> set: cada carta × cada acabado, cuadrícula por número, con cantidad on-hand por carta/acabado) + **escritura por
> lote** (carrito de captura + publicación masiva). **El modelo por-pieza NO cambia** (1 `InventoryItem` por pieza —
> la custodia por-pieza lo exige); todo lo nuevo es **agregación de lectura** + **lote de escritura**. **Aditivo.**
> Migración **M-21** (índice de agregación + `InventoryBatch`). NO toca dinero saliente; la publicación deriva el
> **precio de venta server-side** (reusa reglas de venta §4.14, SEC-A1). Nuevo **§4.17**.
> - **Lectura agregada (§4.17a):** `GET /admin/inventory/master-sets` (índice con completitud/piezas por set) y
>   `GET /admin/inventory/master-sets/:setId` (binder con `countsByFinish` por carta, **orden natural** de `Card.number`
>   String). **Query fija, sin N+1** (patrón `set-value.service.ts`: groupBy + raw aggregate por set/carta).
> - **Escritura por lote (§4.17b):** `POST /admin/inventory/items/batch` (alta N líneas, **errores por-línea**,
>   idempotencia `batchKey`, folios consecutivos `nextFolios(n)`) y `POST /admin/inventory/items/bulk-publish`
>   (publicar N piezas con precio derivado/manual, errores por-línea).
> - **Deuda pagada:** `PricingService.getReferencesBatch` (cierra RB-8/BE-4/D3) y pago **mínimo de BE-25** (izar
>   `SALES_PRICE_RULES`+fallback + batch de referencias en `fetchSellable`/bulk-publish). Índice `@@index([cardId,
>   finish, status])` (M-21). **Fase 2:** virtualización del binder, CSV, tabla `InventoryStockSummary` materializada.
>
> **Changelog v1.14-price-ingest (2026-08-17) — WS-A: ingesta MASIVA de precios vía proveedor de PAGA
> (PokemonPriceTracker), pluggable, que REEMPLAZA el barrido por-carta frágil.** Decisión del plan (WS-A): el pricing del
> catálogo deja de depender del re-sync completo de pokemontcg.io corrido **fire-and-forget en memoria**
> (`catalog-sync.service.ts` `syncAll`→`runSyncAll`, DEV-4) —que **muere al reiniciar el proceso** y tarda horas por
> rate-limits, dejando el catálogo con "precio pendiente" masivo, todo en acabado `normal` y la gráfica del hero vacía— y
> pasa a un **job de ingest masivo por SET, idempotente y reanudable** que consume un **endpoint bulk** del proveedor de
> paga. **Aditivo, SIN migración de esquema** (reusa `PriceReference` con `finish` en su clave desde M-18, el enum
> `PriceSource.pokemonpricetracker` **ya existente**, y `Card.availableFinishes`). Nuevo **§4.15**. **Toca dinero → triple
> veredicto.** Datos confirmados del proveedor: endpoint `POST /api/v1/cards/bulk-price` (varias cartas por request;
> acepta `set`, `limit`), auth `Authorization: Bearer <POKEMONPRICETRACKER_API_KEY>` (key **ya en Railway**, NUNCA en el
> repo), respuesta con `market` (+historial/eBay/PSA). El **esquema EXACTO (campo de acabado/variante, precio, moneda)
> se verifica en la 1ª corrida del backend en Railway** (desde dev el dominio está bloqueado por egress) → el ingest
> mapea **defensivamente** (valida y **omite** entradas mal formadas; money-safe).
> - **A.1 — Interfaz `BulkPriceProvider` pluggable (backend, §4.15b).** NUEVA interfaz de ingest masivo,
>   `fetchPricesForSet(set)` → filas normalizadas `{ externalId?, setExternalId?, number?, finish, marketCents,
>   currency }` por **carta+acabado**. Distinta del `PricingProvider` per-carta ya existente (§4.1), que se **conserva**
>   para el refresco per-carta de bóveda y los stubs graded/sealed. Implementaciones: `PokemonPriceTrackerBulkProvider`
>   (source `pokemonpricetracker`, PRIMARIO — bulk endpoint) y `PokemonTcgIoBulkProvider` (source `pokemontcg_io`,
>   LEGACY/alterno — envuelve el `getCardsBySet` existente y extrae `tcgplayer.prices` por acabado). El **adapter** hace
>   el mapeo defensivo del payload crudo; la interfaz solo expone filas ya validadas.
> - **A.2 — Job `price-ingest` (parent) + `price-ingest-set` (child por set) (backend + devops, §4.15c).** Reemplaza el
>   barrido frágil por un **fan-out BullMQ por set**: el parent lista `CardSet` locales y encola un child por set; cada
>   child descarga UN set (pocas requests), agrupa por carta y hace **upsert idempotente** de `PriceReference`
>   `(cardId, 'raw', 'raw:NM', finish, capturedDate=hoy)`. **Robusto:** un set que falla NO tumba el resto (job aparte,
>   retry/backoff de BullMQ), **reanudable** ante reinicio (cola persistida en Redis, no memoria del proceso).
>   **1–2×/día** (devops). Sin Redis (local/CI) el disparo manual corre secuencial **awaited** (nunca fire-and-forget).
> - **A.3 — Variantes #8 (backend, §4.15e).** `Card.availableFinishes` pasa a **derivarse del proveedor** (que trae las
>   variantes reales del mercado) durante el ingest, reemplazando la derivación frágil de `tcgplayer.prices`. Autoridad:
>   si el proveedor reporta ≥1 acabado con market válido para la carta → `availableFinishes = {esos acabados}`; si no
>   reporta nada → se **respeta** el valor existente (nunca se clobbea a `[normal]`). Sigue siendo la lista blanca SEC-A1.
> - **A.4 — FX + colchón #13 (backend + frontend, §4.15f).** El ingest carga `FxService.getCurrent()` **una vez por
>   corrida** y convierte USD→MXN con `usdToMxnCents(market, rate, bufferPct)` → el **colchón (#13) aplica en cada
>   ingest**. Precios en **MXN** se guardan sin conversión (sin colchón). Fix de UI (#13): M2 debe poder **guardar solo
>   el colchón** sin fijar `rate` (hoy `PUT /admin/fx` exige ambos y pinnea un override manual de tasa) → nota para
>   frontend + ajuste menor de contrato (`rate?` opcional).
> - **A.5 — Aligerar `catalog-sync` (backend, §4.15g).** `catalog-sync` vuelve a ser **solo metadata del catálogo**
>   (nombres/imágenes/sets/números/rareza + import de sets nuevos): se **quita** `persistMarketReferences` de
>   `upsertCards` (y las deps `PricingService`/`FxService` que v1.12 le añadió). El pricing lo hace **solo** `price-ingest`.
>   El job `catalog-price-sync` (v1.12, `force:true` = re-sync completo para refrescar precios) queda **DEPRECADO** en su
>   rol de pricing (lo cubre `price-ingest`, mucho más barato: bulk por set vs re-bajar todas las cartas).
> - **A.6 — Config/env/contrato (§4.15h).** Nuevo dial `PRICE_PROVIDER` (`price_provider`, ConfigSetting editable sin
>   redeploy en M2/M10, valores `pokemonpricetracker | pokemontcg_io`) — palanca de selección/rollback del proveedor de
>   ingest. `POKEMONPRICETRACKER_API_KEY` (env, ya en Railway) pasa a ser **requisito operativo en prod** cuando el dial
>   apunta al proveedor de paga. Disparo manual `POST /admin/jobs/price-ingest` (super_admin, auditado, single-flight;
>   `setId?` opcional para verificación de esquema en la 1ª corrida). Ver `API_CONTRACT.md` (Changelog v1.14-price-ingest).
>
> **Changelog v1.13-sales-pricing (2026-08-17) — FASE 2 del epic de precios: precio de VENTA por RAREZA, editable
> en admin (análogo al de COMPRA/buylist).** Decisión del humano (fija): el precio de VENTA se asigna **por rareza**,
> dinámico/bulk, con variables editables en admin como el de compra. Ejemplo del humano: **Common $5, Uncommon $10,
> holo/reverse $10 FIJOS; rarezas más altas = % ARRIBA de mercado.** Hoy la venta usa un **markup GLOBAL único**
> (`SALES_MARKUP_PCT`, default 15) aplicado en `pricing.service.computeSalePrice` y consumido por
> `catalog.service.toListingDTO` (listado) y `orders.service.salePriceOf` (checkout). Fase 2 lo reemplaza por una
> **tabla de regla por rareza** simétrica a la de buylist (v1.3.1). **Aditivo, SIN migración de esquema** (solo dos
> `ConfigSetting` nuevos + una función pura + swap de 2 call-sites + endpoints M2 + editor front). Nuevo **§4.14**.
> Toca dinero → triple veredicto.
> - **2.1 — Dos `SettingKey` nuevos (backend, §4.14a):** `SALES_PRICE_RULES` (`sales_price_rules`, mapa
>   `{ [rarity|ruleKey]: { mode:'fixed'|'pct', value } }`) y `SALES_PRICE_FALLBACK_PCT` (`sales_price_fallback_pct`).
>   **Seed** (reproduce el ejemplo del humano): `Common fixed 500¢`, `Uncommon fixed 1000¢`, `Holo fixed 1000¢`,
>   `Reverse Holo fixed 1000¢`; **fallback = 15** (% ARRIBA de mercado). Validadores nuevos `validateSalesRules` /
>   `validateSalesFallbackPct`: `fixed`→entero ≥ 0 (centavos); `pct`→número en **`[0, SALES_PCT_MAX]`** (propuesta
>   `SALES_PCT_MAX = 1000`, ver §4.14a y decisión abierta v1.13-2). **`SALES_MARKUP_PCT` queda DEPRECADO** (ya no lo
>   lee la ruta de venta; se conserva el dial como palanca de rollback, ver §4.14d y decisión abierta v1.13-3).
> - **2.2 — Función pura `computeSalePriceForRarity` (backend, `money.ts`, §4.14b):** misma mecánica que
>   `quoteAcquisitionForFinish` (reusa `ruleKeyCandidates`, **con el gate premium de Fase 0 intacto**): `fixed` →
>   centavos directos (piso, no depende de mercado → siempre precia); `pct` → **markup ARRIBA de mercado**
>   `round(referencia × (1 + value/100))`. **Semántica DISTINTA a la de compra:** en buylist `pct` = *% de la
>   referencia* (`ref × value/100`); en venta `pct` = *% ARRIBA de mercado* (`ref × (1 + value/100)`). Si `pct` y
>   falta referencia → `pending` (no vendible, "precio pendiente"), igual que hoy; las reglas `fixed` **siempre**
>   precian (mejora: una común/bulk sin market ahora tiene piso de venta).
> - **2.3 — Endpoints M2 nuevos (backend, §4.14c):** `GET/PUT /admin/pricing/sales-rules` y
>   `GET /admin/pricing/sales-rarities`, **clones exactos** del patrón buylist (`buylist-rules`/`rarities`),
>   auditados. Tipos front `SalesRule`, `SalesRuleApplied`, `SalesRulesDTO`, `SalesRaritiesResponse`.
> - **2.4 — Aplicación (backend, §4.14d):** `catalog.service.toListingDTO` (:107) y `orders.service.salePriceOf`
>   (:33) dejan de llamar `computeSalePrice(ref)` (markup global) y pasan a `computeSalePriceForRarity(card.rarity,
>   item.finish, ref, rules, fallbackPct)`. **SEC-A1:** rareza server-side de `Card.rarity` y finish de
>   `InventoryItem.finish` (BD), nunca del DTO del cliente. `listPriceCents` (override manual) **sigue ganando**; el
>   precio se congela en `OrderItem.unitPriceCents` al checkout (snapshot ⇒ **sin migración**).
> - **2.5 — Editor M2 (frontend, §4.14e):** nueva sección "Reglas de precio de VENTA por rareza" en **`M2View`**
>   (clon de la sección de reglas de buylist), NO en `BuylistView`. Consume `getSalesRarities`/`getSalesRules`/
>   `updateSalesRules` (nuevas en `api.ts`) + copys nuevos en `messages/*`.
> - **Contrato:** `API_CONTRACT.md` (Changelog v1.13-sales-pricing): §M2 gana `sales-rules`/`sales-rarities`; DTOs
>   `SalesRule*`. Sin migración.
>
> **Changelog v1.12-catalog-pricing (2026-08-17) — FASE 1 del epic de precios: preciar TODO el catálogo +
> refresco 2×/día + import de sets nuevos.** Decisión del humano (fija): (1) preciar SIEMPRE todo el catálogo
> (aunque la carta no esté en bóveda/inventario), (2) auto-actualización **2×/día** (job programado), (3) función
> para mapear/importar **sets nuevos**. **Aditivo, SIN migración de esquema** (reusa `PriceReference`, que ya lleva
> `finish` en su clave desde M-18). Nuevo **§4.13**. Toca dinero → triple veredicto.
> - **1.1 — Poblar `PriceReference` para todo el catálogo (backend, §4.13a).** El `catalog-sync` **ya descarga**
>   `tcgplayer.prices` por carta para derivar `availableFinishes` (`catalog-sync.service.ts` `upsertCards`); ese
>   MISMO dato ahora **puebla `PriceReference`** por `(card, finish)` **sin llamadas extra**. Por cada acabado con
>   `prices[llave].market > 0` se hace **upsert idempotente** de una fila `(cardId, 'raw', 'raw:NM', finish,
>   capturedDate=hoy)` con conversión USD→MXN (FX Banxico + colchón), `source=pokemontcg_io`. **Una fila por día por
>   acabado.** **No** clobbea overrides manuales (`isManualOverride=true` → skip). Cartas **sin market → NO se crea
>   referencia y NO se escala a `PendingPriceEntry`** (`escalate=false`, mismo criterio que `set-price-sync` §4.12a:
>   no inundar la cola con decenas de miles de cartas). Cambia la doctrina "solo se precia la bóveda" → **"se precia
>   todo el catálogo durante el sync"**; el `price-sync` de bóveda se conserva para frescura entre syncs.
> - **1.2 — `publicQuote` vuelve a READ-ONLY; cierra/supersede BE-16 (backend, §4.13b).** Con el catálogo ya
>   priceado (1.1), el cotizador público **lee** `getReference` y casi siempre encuentra precio. Se **elimina** la
>   llamada a `escalatePending` desde `publicQuote` (endpoint público/anónimo que escribía) → **no** puebla la cola
>   ni consume trabajo del dueño desde un endpoint anónimo. **No se pricea on-demand** desde el quote (superficie de
>   abuso + redundante con el job). La escalada a `PendingPriceEntry` queda **solo** en el flujo autenticado
>   `POST /buylist/requests` (`createRequest`, sin cambio). Cierra **BE-16** (y el punto abierto v1.3-1).
> - **1.3 — Job programado 2×/día (backend + devops, §4.13c).** Nuevo job `catalog-price-sync` que **importa sets
>   nuevos** y **refresca precios de todo el catálogo**. Como pokemontcg.io **no** tiene endpoint bulk de
>   solo-precios (el `market` viaja embebido en la carta), **refrescar precios = re-sync del catálogo**: reusa
>   `syncAll({force:true})` (reprocesa todos los sets remotos → repuebla cartas + `PriceReference` por acabado con el
>   FX del día). Secuencial, respeta el backoff 429 del cliente; single-flight (`syncAllStatus.running`). Horarios
>   **06:00 y 18:00 CDMX** (= 12:00 y 00:00 UTC), configurables; scheduling = **dueño devops**.
> - **1.4 — "Importar sets nuevos" en M2 (frontend, §4.13d).** **NO requiere endpoint nuevo:** reusa
>   `POST /admin/catalog/sync-all` (`force:false` → solo sets no importados) + `GET /admin/catalog/sync-status`
>   (progreso) + `GET /admin/catalog/remote-sets` (refresca la lista). Cambio **solo de frontend**.
> - **Contrato:** `API_CONTRACT.md` (Changelog v1.12-catalog-pricing): `POST /buylist/quote` pasa a **read-only**
>   (mismo shape; ya no escribe); 1.4 sin endpoint nuevo. Sin migración.
>
> **Changelog v1.11-premium-gate (2026-08-17) — Gate PREMIUM en el resolver de reglas rareza/acabado (fix de dinero,
> Fase 0 del epic de precios).** Documenta lo YA implementado por backend (`backend/src/common/money.ts`, commit
> `ebb4dee`). **Sin migración, sin cambio de esquema; solo semántica del resolver `ruleKeyCandidates` (§4.2.1).**
> SEC-A1 intacto (el monto se sigue derivando server-side de `(Card.rarity, finish)` validado).
> - **Bug de dinero cerrado:** las cartas chase modernas (ex, Full Art, Illustration/Ultra/Double Rare,
>   V/VMAX/VSTAR/GX…) **solo existen en holofoil** pero su string de rareza **no** contiene "holo". Antes, en
>   `holofoil`/`first_edition_holofoil` una rareza no-holo saltaba a `['Holo']`; con una regla `"Holo"` fija barata de
>   bulk, esas chase de miles de pesos cotizaban al bin fijo (**"$1.50 cotizada"**). Bug estructural.
> - **`isPremiumRarity(rarity)` (NUEVO, contrato de pricing):** clasificador case-insensitive por substrings/tokens
>   (Illustration/Ultra/Double Rare, Secret/Rainbow/Hyper/Gold, Full/Alt Art, Amazing/Radiant/Shiny/Trainer Gallery/
>   Character/Prism, y tokens sueltos `v/vmax/vstar/ex/gx`). Lista canónica de patrones en §4.2.1.
> - **`ruleKeyCandidates` (holofoil / 1st-ed holo):** si la rareza es **PREMIUM** → candidatos `[rarity]` **únicamente**
>   (su regla explícita o el fallback pct = % de mercado); **nunca** `"Holo"` ni bin fijo de bulk. Si **no** es premium
>   → se conserva la semántica previa (`isHoloRarity ? [rarity,'Holo'] : ['Holo']`). La rareza real va **siempre**
>   primera. `reverse_holo`/`normal` sin cambio.
> - **Punto abierto RESUELTO (Common/Uncommon en holofoil):** se **mantiene** el diseño actual ("% del market
>   holofoil" vía `['Holo']`), **sin cambio de código** — el caso es marginal (una común casi nunca tiene llave
>   `holofoil`; `422 FINISH_NOT_AVAILABLE` lo bloquea) y, cuando ocurre, el % de market es la valuación correcta.
>   **No implica tarea de backend.** Detalle y justificación en §4.2.1 ("Decisión 2026-08-17").
> - **Contrato:** `API_CONTRACT.md §6` (`POST /buylist/quote`) actualizado con el gate premium.
>
> **Changelog v1.9-set-chart (2026-08-16)** — **Gráfica PÚBLICA del valor de un set en el tiempo (hero de la
> home, datos REALES, captura diaria)**. Objetivo de producto: un visitante **anónimo** (sin sesión) ve en el
> hero una gráfica estilo acciones del **valor de mercado agregado de un set destacado**, para atraer tráfico.
> Hoy la home solo muestra el vistazo del portafolio PERSONAL (`PortfolioGlance`), visible **solo con sesión**;
> un anónimo no ve ninguna gráfica. **Todo aditivo**, una sola migración nueva **M-20** (modelo nuevo, sin
> backfill). **SEC-A1 intacto** (el valor se deriva SIEMPRE server-side de `PriceReference` real, nunca del
> cliente). El endpoint es PÚBLICO pero **no expone PII** — solo valor agregado de mercado.
> - **Realidad de datos:** pokemontcg.io (`tcgplayer.prices.<acabado>.market`, USD → MXN vía Banxico) solo da
>   el precio **de HOY**, sin historial. Por eso la serie del set **se siembra con el valor de hoy y crece con
>   captura diaria** (mismo patrón que `PortfolioSnapshot`) — **no** hay histórico que bajar ni se fabrican
>   puntos: si un día no hubo snapshot, el punto **no** existe.
> - **Modelo nuevo `SetValueSnapshot` (MIGRACIÓN M-20, aditiva, sin backfill):** serie diaria por set, análoga
>   a `PortfolioSnapshot` pero agregando por `setId` en vez de por `userId`. Escrita por un job diario. Ver §3.2.
> - **Regla de valor (server-side, SEC-A1):** `totalValueMxnCents` del set en una fecha = SUM sobre las cartas
>   del set de la `PriceReference` vigente más reciente por carta, tomando acabado **`normal`**, `productType`
>   **`raw`** (`gradeKey='raw:NM'`), campo `priceMxnCents`. Las cartas **sin** precio ese día se **excluyen** del
>   total pero se cuentan en `pricedCardCount` (vs `totalCardCount`). Es "valor de las cartas priceadas del
>   set", NO promesa de valor de set completo. Ver §4.12.
> - **Endpoints PÚBLICOS nuevos (`@Public()`):** `GET /catalog/featured-set/value-history` (el "set destacado"
>   de la home, para que el front NO hardcodee un id) y el genérico `GET /catalog/sets/:id/value-history`. DTO
>   nuevo `SetValuePointDTO` (misma línea que `PortfolioPointDTO`). Ver `API_CONTRACT.md §2`.
> - **Set destacado:** configurable por env **`HOME_FEATURED_SET_ID`** (id nativo pokemontcg.io de un set SV
>   reciente), con fallback determinista. Mecanismo en §4.12.
> - **Jobs nuevos (BullMQ diarios):** (a) `set-price-sync` — precia TODAS las cartas del set destacado desde
>   pokemontcg.io (brecha NUEVA: el `price-sync` actual solo precia bóveda; ver §4.12 y DEV-3 en §9); (b)
>   `set-value-snapshot` — agrega y hace upsert de `SetValueSnapshot` del día. Crons alineados con los
>   existentes (`fx-refresh 0 6`, `price-sync 15 6`, `portfolio-snapshot 0 7`). Ver §5.
>
> **Changelog v1.8-ronda-c (2026-08-16)** — **Tres deudas de Ronda C que requieren cambio de contrato**
> (BE-10, PendingPriceEntry+finish, SEC-D2). **Todo aditivo**, una sola migración nueva **M-19** (dos columnas +
> una proyección que NO migra). Ninguna toca dinero (SEC-A1 intacto).
> - **BE-10 — enriquecer `AdminUserOwnedItemRef` con `finish` + `referenceValue` (proyección, NO migra):** la
>   pestaña "Bóveda" de la ficha 360° (`GET /admin/users/:id`, M6) devolvía por ítem solo
>   `{ inventoryItemId, folio, card, ownershipStatus }` (sin acabado ni valor). Se añaden **`finish: Finish`** y
>   **`referenceValue: PriceInfo`** (mismo shape que `HoldingDTO` de la bóveda del cliente §3, para **reusar** la
>   valuación por-acabado existente `getReference(cardId, productType, gradeKey, finish)`). **Decisión: enriquecer
>   el ref** (no añadir `GET /admin/users/:id/holdings` paginado) — la bóveda por usuario es acotada y `getUser`
>   ya trae `ownedItems`; enriquecerlo reusa `PricingService.getReference` sin endpoint nuevo. El endpoint
>   paginado queda documentado como **evolución futura** si una bóveda por usuario creciera demasiado. Ver §4.7ter.
> - **PendingPriceEntry + `finish` (MIGRACIÓN M-19):** la cola de precio pendiente se llevaba por
>   `(cardId, productType, gradeKey)` **sin `finish`** → distintos acabados de una carta colapsaban en **UNA**
>   entrada y resolver el override de `normal` cerraba el pendiente aunque `holofoil` siguiera sin precio.
>   `PendingPriceEntry` gana **`finish Finish @default(normal)`**; `escalatePending`/`manualOverride` incorporan
>   `finish` a la llave de deduplicación/resolución (`getReference` ya era por-acabado, no se rompe). Ver §3.2,
>   §4.2. **Nota de dimensionamiento:** resultó **algo mayor de lo previsto** — `PendingPriceEntry` **SÍ es un
>   modelo Prisma real** (el picker previo no lo halló, pero existe: `schema.prisma` `model PendingPriceEntry`),
>   así que requiere columna en M-19 **y** corrige un bug de corrección real (`manualOverride` resolvía TODOS los
>   acabados; `syncCardPrice` no pasaba `finish` a `escalatePending`). Sigue contenido: 1 columna + 2 llaves de
>   query + 1 param propagado + DTO.
> - **SEC-D2 — `SellRequest.closedAt` (MIGRACIÓN M-19):** la retención de INE aproximaba la fecha de cierre por
>   `max(paidAt,approvedAt,verifiedAt,receivedAt,createdAt)` (para `rechazada`/`abandonada` caía en `createdAt`).
>   Se añade **`closedAt DateTime?`**, seteado a `now()` cuando la solicitud llega a estado **terminal**
>   (`pagada`/`rechazada`/`abandonada`). El job `ine-retention` usa `closedAt` para anclar la ventana al cierre
>   real (con **fallback** a la aproximación previa para filas legacy sin `closedAt`). Ver §3.2, §3.4(d).
>
> **Changelog v1.7-admin-users (2026-08-16)** — **Alta de usuarios por rol desde admin (E1) + historial 360° por
> usuario (F1)** (M6, back-office). Ambas **aditivas** y **sin migración** (reusan `User`, `AuditLog` y los listados
> admin ya paginados). Ver detalle en §4.7bis (c) / §4.7ter y `API_CONTRACT.md` (Changelog v1.7-admin-users, §M6).
> - **E1 — `POST /admin/users`** (`super_admin` only, auditado `user.create`, **NO** `MoneyOutGuard`): crea cuentas
>   de cualquier rol (`customer|vault_operator|super_admin`) sin KYC/CLABE/INE. `email` se lowercasea (patrón
>   register); `name` required; `password?` (si se omite, autogen temporal de alta entropía reusando la rutina del
>   reset M-15, devuelta **una vez** en `tempPassword`, argon2, `mustChangePassword=true`; si se provee,
>   `mustChangePassword=false`). `emailVerified=true` para **todo** rol creado por admin (staff como el seed; customer
>   porque el admin da fe) — **no** se envía correo. `P2002 → 409 EMAIL_TAKEN`. **Escalada de privilegios** (crear
>   super_admin) controlada por super_admin-only + auditoría; la contraseña **nunca** entra al `AuditLog`.
> - **F1 — Historial 360° por REUSO (no engorda `getUser`):**
>   - `?userId=` opcional añadido a `GET /admin/{buylist,shipments,disputes}` (simetría con `GET /admin/orders`),
>     filtrando por la FK `userId`; mismo guard y misma proyección PII por rol.
>   - `GET /admin/users/:id/audit` (paginado): `AuditLog` por `scope=target|actor|both` (default `target` =
>     `entityType='User' AND entityId=:id`). Expone `action/actorRole/actorUserId/entityType/entityId/createdAt` +
>     `ip` **solo** super_admin; **nunca** `before`/`after`. `vault_operator` → proyección reducida sin `ip`.
>
> **Changelog v1.6-finish (2026-08-16)** — **Acabado / versión de carta (finish) en TODA la cadena**
> (PROJECT.md §I / v1.4, criterios 37–44). Hoy el modelo NO distingue acabados: **1 fila `Card` con un solo
> `rarity`**, sin `finish`, y los precios por acabado de `tcgplayer.prices` (`normal`/`reverseHolofoil`/
> `holofoil`/`1stEditionHolofoil`) **se descartan** al importar. Se modela el **acabado (finish)** como
> dimensión de primera clase en catálogo, precio, cotización, inventario/bóveda y valuación de portafolio:
> - **Enum nuevo `Finish = normal | reverse_holo | holofoil | first_edition_holofoil`** (valores canónicos;
>   derivados de las llaves de `tcgplayer.prices`, ver mapeo en §3.7).
> - **Modelo (MIGRACIÓN M-18, aditiva, default seguro):**
>   - `Card.availableFinishes Finish[] @default([normal])` — acabados en que existe esa carta, derivados de las
>     llaves de `tcgplayer.prices` al importar. **Sigue siendo 1 fila por `externalId`** (el `@unique` NO se
>     toca; `availableFinishes` es un array en la MISMA fila). Filas históricas → `[normal]` hasta el re-sync.
>   - `PriceReference.finish Finish @default(normal)` **añadido a la clave** (`@@unique` gana `finish`), para que
>     `normal` y `reverse_holo` tengan **referencia de precio distinta**. El provider guarda el precio **POR
>     acabado** (ya no "el primer market disponible").
>   - `InventoryItem.finish Finish @default(normal)` — qué acabado es la copia física; afecta valuación de
>     portafolio y catálogo "Compra".
>   - `SellRequestItem.finish Finish @default(normal)` — snapshot del acabado aplicado en la cotización/solicitud.
> - **§4.2 (AcquisitionPricer) extendido:** la cotización es **por acabado**. El finish resuelve (a) **qué regla**
>   de `BUYLIST_PRICE_RULES` aplica (reverse holo → `"Reverse Holo"`; holofoil / 1st ed holo → regla de la
>   **rareza base si ya es holo**, si no `"Holo"`; normal → **rareza base**) y (b) **qué referencia** usa el `pct`
>   (el market del acabado). Ver el resolver determinista en §4.2.
> - **§4.1 (PricingProvider):** `fetchPrice`/`getReference`/`syncCardPrice` ganan `finish`; el provider mapea
>   `finish → llave de tcgplayer.prices` y lee **ese** `market` (deja de tomar el primero disponible).
> - **SEC-A1 INTACTO:** el monto se **deriva server-side** de `(Card.rarity, finish)` **validado contra
>   `Card.availableFinishes`** — nunca de un precio/categoría/monto del cliente. Un acabado **no disponible** para
>   la carta se **bloquea** (`422 FINISH_NOT_AVAILABLE`): el cliente no puede cotizar/vender un acabado inexistente
>   para pagar de más.
> - **Contrato:** `CardDTO` (+`availableFinishes`), `ListingDTO`/`HoldingDTO`/`SellItemDTO` (+`finish`),
>   `POST /buylist/quote` y `POST /buylist/requests` (+`finish`), facetas de Compra (+`finishes`) y filtro
>   `finish`. Ver `API_CONTRACT.md` (Changelog v1.6-finish).
> - **Nota de despliegue:** **requiere RE-SYNC del catálogo** tras migrar para poblar `availableFinishes` y las
>   `PriceReference` por acabado (los datos ya importados no traen finish hasta el re-sync; el default seguro
>   `normal`/`[normal]` mantiene todo operable mientras tanto). El re-sync es idempotente (v1.3.1).
> - **Fuera de alcance de este cambio (bundle v1.4 aparte):** el **origen del inventario**
>   (`owner_contribution` vs `client_purchase`) y el **alta de inventario por set** son otro ítem de PROJECT
>   §I/M1; NO se modelan en este contrato de finish (se enrutan por separado al arquitecto).
>
> **Changelog v1.5-auth-email (2026-08-16)** — **Verificación de correo + recuperación de contraseña
> self-service por email** (proveedor **Resend**). Decisiones de producto ya cerradas por el humano:
> - **La verificación NO bloquea el login** — bloquea **acciones sensibles**. Un usuario con `emailVerified=false`
>   **puede iniciar sesión y navegar**, pero un guard server-side (**autoridad**, no solo UI) rechaza
>   **comprar** (`POST /checkout/session`), **retirar/enviar** (`POST /shipments`) y **vender**
>   (`POST /buylist/requests`) con **`403 EMAIL_NOT_VERIFIED`**. Cuentas Google entran con `emailVerified=true`
>   (no afectadas). Nuevo `EmailVerifiedGuard` + decorador `@RequireEmailVerified()` (§4.11, §7).
> - **Recuperación: AMBOS flujos.** (a) **Self-service** nuevo: `POST /auth/forgot-password` (siempre `200`,
>   anti-enumeración) → email con link → `POST /auth/reset-password`. (b) Se **conserva** el reset por admin
>   existente (`POST /admin/users/:id/reset-password`, §4.7bis). Ambos **incrementan `User.tokenVersion`**
>   (revocan sesiones, patrón existente).
> - **Modelo de tokens (nuevo `AuthToken`, MIGRACIÓN M-17):** tabla de tokens de **un solo uso**, `type`
>   (`email_verification | password_reset`), `userId`, **hash** del token (SHA-256; **nunca** el token en claro
>   en BD — el claro viaja solo por correo), `expiresAt`, `usedAt`. Expiraciones: verificación **24h**, reset
>   **1h**. Ver §3.2 (AuthToken) y §4.11.
> - **Abstracción de correo (nuevo módulo `mail`):** puerto `MailPort` (token DI `MAIL_PORT`) + adaptador
>   `ResendMailAdapter` (prod) y `NoopMailAdapter` (local/CI/tests sin key: loguea el email y el link).
>   `MailService` construye las plantillas (verificación / recuperación), bilingües por `User.locale`.
> - **Endpoints nuevos (auth):** `POST /auth/verify-email/resend`, `POST /auth/verify-email`,
>   `POST /auth/forgot-password`, `POST /auth/reset-password`. El registro email/password **emite** el token de
>   verificación y envía el correo. El objeto `user` de `/auth/register|login|google` ahora incluye
>   `emailVerified` (ya expuesto en `/users/me`). Ver `API_CONTRACT §1`.
> - **Env nuevas:** `RESEND_API_KEY` (secreto, **requerida en no-local** — staging+prod), `MAIL_FROM`
>   (default `no-reply@tcgvaultmx.com`). En LOCAL_ENVS sin key → `NoopMailAdapter` (degrada con aviso). Ver §8.
> - **Migración M-17** (§11). Jobs: `auth-token-sweep` (limpia tokens expirados).
>
> **Changelog v1.4-finance (2026-08-16)** — **Costo real de paquetería en el P&L** (PROJECT.md requisito #3,
> §M7 / criterio 21). Hoy el P&L trata el envío **solo como ingreso** (`shippingFeeCents` = lo que el cliente
> nos paga) y **nunca** resta el **costo real que la plataforma paga a la paquetería**, sobreestimando la
> ganancia. Se corrige:
> - **Modelo:** `ShipmentRequest` gana **`shippingCostCents` `Int @default(0)`** = costo real MXN (centavos)
>   que la plataforma paga al carrier por ese envío. Aditivo, default 0 para filas históricas/no capturadas.
>   **Migración M-16** (§11). NO se toca `shippingFeeCents` (sigue siendo el **ingreso** cobrado al cliente).
> - **Captura (M4):** el operador captura `shippingCostCents` (opcional, editable) al **asignar carrier/guía**
>   en `POST /admin/shipments/:id/tracking` (el DTO gana el campo; entero ≥ 0). Ver `API_CONTRACT §M4`.
> - **P&L (M7):** la fórmula separa **ingreso** vs **costo** de envío:
>   `profitCents = incomeCents + shippingRevenueCents − cogsCents − stripeFeesCents − shippingCostCents`.
>   La clave `shippingCents` (ingreso) se **renombra** a `shippingRevenueCents` y se **añade** `shippingCostCents`
>   (decisión de naming: `shippingRevenueCents` elimina la ambigüedad de dos claves de envío; ver §12 y
>   `API_CONTRACT §M7`). Es un **breaking change**: M7 **sí** tiene consumidor de frontend real y montado
>   (`admin/m7/M7View.tsx`, que llama a `getPnl` y renderiza el desglose del P&L), por lo que el rename se aplicó
>   actualizando **productor y consumidor en la misma entrega** (sin periodo de compatibilidad porque el front
>   migró al shape de 6 claves al mismo tiempo). El costo se acota al periodo por **`pickingAt`** (mismo criterio
>   que el ingreso), para que costo e ingreso del mismo envío caigan en el mismo periodo. El CSV export espeja el
>   nuevo shape.
>
> **Changelog v1.3.1 (2026-08-16)** — **Precio de buylist por RAREZA OFICIAL** (PROJECT.md §E.1, criterios
> 12/12b/12c/18). Reemplaza el esquema de **3 categorías hardcodeadas** (`RARITY_MAP` + `BuylistCategory`
> `comun|reverse_holo|ex_plus`) por una **tabla de regla por rareza**, editable en **M2** sin redeploy:
> - **Nuevos `SettingKey`:** `BUYLIST_PRICE_RULES` (`buylist_price_rules`, mapa `{ [rarity]: { mode:
>   'fixed'|'pct', value } }`) y `BUYLIST_PRICE_FALLBACK_PCT` (`buylist_price_fallback_pct`, default **40**).
>   `RARITY_MAP` (`rarity_map`) queda **DEPRECADO** (ya no lo lee la cotización). Ver §3.2 (ConfigSetting) y §4.2.
> - **§4.2 reescrito:** `AcquisitionPricer` resuelve el monto por **regla de rareza** (fixed → monto fijo;
>   pct → % de la referencia; sin regla → `BUYLIST_PRICE_FALLBACK_PCT`). Se mantiene la derivación
>   **server-side** desde `Card.rarity` real (guardarraíl SEC-A1 intacto).
> - **Modelo:** `SellRequestItem` deja de depender de `category` (BuylistCategory) y snapshotea la **regla
>   aplicada** (`rarity`, `ruleMode`, `ruleValue`, `ruleSource`). Enum nuevo `BuylistRuleMode = fixed | pct`.
>   **Migración M-14** (backend). `BuylistCategory` y `category` quedan deprecados (retención legacy).
> - **Endpoints M2 nuevos (backend):** `GET/PUT /admin/pricing/buylist-rules` y `GET /admin/pricing/rarities`
>   (rarezas distintas del catálogo unidas a las reglas). `GET/PUT /admin/pricing/rarity-map` **deprecados**.
> - **Contrato buylist:** `POST /buylist/quote` y `SellItemDTO` exponen `rarity` + `appliedRule` en vez de
>   `category`; `POST /buylist/requests` ya **no** recibe `category` del cliente. Ver `API_CONTRACT.md §6, §M2`.
> - **Seed (preserva negocio):** Common **$0.50** fixed, Uncommon **$0.50** fixed, Reverse Holo **$1.50** fixed,
>   fallback **40%**; todo lo demás cae al fallback (40% de la referencia). Alcance: **solo buylist** (la
>   aportación en especie sigue en 70%, dial aparte).
>
> **Changelog v1.3 (2026-08-16)** — Cotizador **Opción 1** (buylist sobre todo el catálogo) y confirmación del
> estado del back-office:
> - **Nuevo §4.10:** cotizador que cotiza **cualquier** carta de la tabla `Card` — endpoints nuevos de backend
>   `GET /buylist/cards` + `GET /buylist/sets` (búsqueda pública sobre todo el catálogo) y
>   `POST /admin/catalog/sync-all` (importar todo el catálogo, truly-async). Ver `API_CONTRACT.md §6 y §M2`.
> - **§9 Desviaciones:** DEV-1 (el `POST /admin/catalog/sync` from-date importa **síncrono** en el request →
>   riesgo de timeout para catálogo completo; enrutado a backend) y DEV-2 (jobId cosmético).
> - **§10 Preguntas abiertas v1.3:** pricing on-demand del cotizador y rate-limit de la búsqueda pública.
> - **Confirmado (sin cambio de contrato):** M2/M6/M7/M9/M10 ya están implementados en backend. Sobre el consumo
>   de frontend: **M7 YA se consume en UI** (`admin/m7/M7View.tsx`, montado, llama a `getPnl` y renderiza el
>   P&L); M2/M6/M9/M10 siguen pendientes de consumir (`ModuleTodo` stubs de UI). La edición de diales M10 es
>   `PUT /admin/settings` (body parcial), no per-key.
>
> **Changelog v1.2 / v1.2.1 (2026-08-14)** — simplificación aprobada (`PROJECT.md` › "Simplificación v1.2" y
> "Corrección v1.2.1"):
> - **Sin fotos de producto/inventario:** el producto no lleva fotos propias; la imagen es la **de catálogo
>   remota** de pokemontcg.io. Se **relajan** los campos de foto de `InventoryItem`
>   (`frontPhotoKey`/`backPhotoKey`/`extraPhotoKeys` → opcionales/eliminados) y se **elimina** la foto como
>   evidencia canónica de disputa. **Migración** M-13.
> - **Gradeadas por certificado:** `InventoryItem` captura **`certNumber`** (String, nº de certificado
>   PSA/CGC), **requerido para publicar** una gradeada; el slab (verificable en la graduadora) es la garantía.
>   Sin validación automática contra la graduadora. **Migración** M-12.
> - **Uploads/presign acotado a `kyc_ine`:** único propósito válido; `inventory_photo`/`dispute_claim`
>   eliminados. El módulo `uploads` sirve solo el INE.
> - **Disputa por correo:** la evidencia de disputa de condición se envía **por correo a soporte** (dato de
>   contacto); ya no hay upload de evidencia ni comparador de fotos. Se conserva `Dispute.type`
>   (`condition_raw | condition_sealed`) y VENTAS FINALES.
> - **INE (KYC) intacto:** almacenamiento del INE en R2 (cifrado + retención `INE_RETENTION_DAYS`), `S3_*`,
>   PII/cifrado/`reveal-clabe` **sin cambios** (v1.2.1 revierte solo la parte del INE respecto a la v1.2).
>
> **Changelog v1.1 (2026-08-14)** — incorpora las 8 decisiones del `PROJECT.md` › "Actualización 2026-08-14":
> raw solo NM (con **migración**), sección "Compra" = inventario publicado con precio + facetas dinámicas,
> sync de catálogo M2 (pokemontcg.io) con backfill, sellado como línea de venta con precio manual MXN,
> gráfica de tendencia del portafolio (`PortfolioSnapshot`, **migración**), login con Google (campos en
> `User`, **migración**) y AcquisitionPricer con rarezas modernas. Ver §11 "Migraciones requeridas (v1.1)".

## 0. Alcance técnico (MVP vs Fase 2)

**Dentro del MVP:** storefront + ficha con **imagen de catálogo remota** (sin fotos propias) y precio de referencia, checkout Stripe (IVA 16% desglosado + fee de procesamiento trasladado), bóveda/portafolio con titularidad `pending→settled`, retiros/envíos nacionales manuales, buylist con cotizador público + pipeline manual + **INE cifrado en R2 con retención** (`kyc_ine`, único uso de object storage), back-office M1–M10, i18n ES/EN, disputas de condición (raw/sellado) con **evidencia por correo a soporte**. Gradeadas identificadas por **empresa + grado + `certNumber`**.

**Fuera del MVP (diseñar para no cerrarles la puerta):** C2C/consignación, wallet de saldo, order-book, guías/SPEI automáticos, grading propio, app nativa, cobro de custodia, internacional, PriceCharting, plan de pago de pricing.

Puntos donde el diseño deja la puerta abierta a fase 2:
- `InventoryItem.ownerType` (`platform|customer`) permite introducir `consignor` (C2C) sin migración estructural.
- `PricingProvider` es una interfaz; subir a plan de pago = una implementación nueva + un dial en M10.
- El dinero se maneja **por transacción**; NO existe entidad `Wallet`/`Balance`. Introducirla en fase 2 no rompe nada previo.

---

## 1. Stack elegido y justificación

| Capa | Elección | Justificación |
|---|---|---|
| Lenguaje | **TypeScript** (back y front) | Un solo lenguaje, tipos de DTO compartibles entre backend y frontend, reduce fricción del equipo pequeño. |
| Backend | **NestJS** (Node 20 LTS) | Modularidad y DI encajan con módulos M1–M10 y con la interfaz `PricingProvider`; guards nativos para autorización por rol/acción; ecosistema maduro para Stripe, colas y cron. |
| ORM / migraciones | **Prisma** | Esquema declarativo, migraciones versionadas, tipos generados. Ideal para un modelo relacional con muchas FKs. |
| Base de datos | **PostgreSQL 16** | Modelo fuertemente relacional (items, órdenes, precios, auditoría), constraints e índices, `JSONB` para snapshots (CFDI, direcciones) y `AuditLog`. Recomendado en PROJECT. |
| Cache / colas / rate-limit | **Redis + BullMQ** | Jobs diarios (sync de precios, FX), barridos de plazos de buylist/disputas, y **rate-limiting** para respetar el free tier de las APIs (100/día, 250/día). |
| Auth | **JWT** (access corto + refresh), hashing **argon2** | Sin dependencia de proveedor externo para el MVP; roles y KYC viven en `User`. Guards por rol y por acción. |
| Object storage (SOLO INE de KYC) | **Object storage S3-compatible** (Cloudflare R2 o AWS S3 en prod; **MinIO** en local) vía **URLs prefirmadas**, **bucket privado + cifrado + retención** | **v1.2:** único uso = **imagen del INE del buylist** (`kyc_ine`). No hay fotos de producto/inventario (imagen de catálogo remota) ni de disputa (evidencia por correo). Presign PUT para subir, presign GET de vida corta para leer en back-office; retención por `INE_RETENTION_DAYS` (§3.4). |
| Frontend | **Next.js 14 (App Router) + React + TypeScript** | Storefront con SEO (server components para catálogo/ficha), y mismo framework para el panel admin responsive. **Sin captura de fotos de producto** (v1.2); la única subida es la imagen del INE en el flujo de KYC del buylist. |
| Data fetching (front) | **TanStack Query** | Cache cliente, estados de carga/error consistentes con el contrato. |
| Estilos | **Tailwind CSS** + componentes del **DESIGN_SYSTEM** (propiedad de ux-ui) | La estructura visual/tokens los define ux-ui; el arquitecto no fija el sistema de diseño. |
| i18n | **next-intl** (frontend) | Toda la UI ES/EN, default ES. El backend NO traduce (ver §6). |
| Pagos | **Stripe** (Checkout/PaymentIntents + Webhooks) | Requisito de PROJECT. |
| Jobs/cron | **BullMQ repeatable jobs** (Redis) | Sync diario de precios (solo bóveda), refresco de FX, plazos de buylist/disputa. |

### Monorepo
Un solo repositorio con dos apps: `backend/` y `frontend/`. Sin herramienta de monorepo pesada en el MVP (nada de Nx/Turbo obligatorio); devops decide si añade `pnpm workspaces`. Los tipos del contrato se comparten copiando/generando DTOs en `frontend/src/types` desde `API_CONTRACT.md` (fuente de verdad).

---

## 2. Estructura de carpetas (alto nivel)

> Respeta la propiedad de archivos de `CLAUDE.md`: backend escribe en `backend/`, frontend en `frontend/`, devops en configs/CI. El arquitecto solo describe la estructura.

### backend/ (NestJS)
```
backend/
  src/
    main.ts
    app.module.ts
    common/            # guards (roles, money-out), decorators, filtros de error, interceptores, error-codes
    config/            # carga de env (typed); NO contiene los diales de negocio (esos viven en DB, ver settings)
    modules/
      auth/            # registro, login, refresh, JWT, guards de rol/acción
      users/           # perfil, direcciones (MX), billing/CFDI, KYC (CLABE/INE/límites)  -> M6
      catalog/         # Card/CardSet, ingesta desde pokemontcg.io (datos en inglés)
      pricing/         # PricingProvider (interfaz + impls), PricingService, FxService, cola precio-pendiente -> M2
      inventory/       # InventoryItem, folios, VaultLocation, InventoryMovement -> M1
      orders/          # checkout, breakdown (subtotal/fee/IVA), Order/OrderItem -> M3
      payments/        # cliente Stripe + manejo de webhooks (settled/refund/chargeback)
      vault/           # portafolio del cliente (holdings + valor)  -> C
      shipments/       # retiros/envíos nacionales, picking, guía manual -> M4
      buylist/         # AcquisitionPricer, cotizador público, SellRequest pipeline -> M5/E
      disputes/        # disputas de condición (raw/sellado), evidencia por correo a soporte, recompra -> M8
      admin/           # dashboard (8 tarjetas), finanzas/P&L (M7), reportes (M9)
      settings/        # diales M10 (persistidos en DB, editables sin deploy)
      audit/           # AuditLog global (M10)
      uploads/         # presign de object storage SOLO para el INE del buylist (kyc_ine); bucket privado
      mail/            # puerto MailPort + adaptadores (ResendMailAdapter / NoopMailAdapter) + MailService (plantillas) -> §4.11
    jobs/              # BullMQ: price-sync diario, fx-refresh, buylist-sweep (7d/30d), dispute-deadline, auth-token-sweep (tokens expirados)
    prisma/            # schema.prisma + migraciones
  test/
```

> **Coordinación de work streams — `backend/src/jobs/` (v1.18-buylist-rejects):** la carpeta `jobs/` NO es zona
> compartida fija: **queda asignada al stream que toca sus jobs correspondientes** (un job pertenece al dominio del
> módulo que sirve). En el ciclo actual, el stream **«Catálogo y precios»** toca `scheduler.service.ts` /
> `price-ingest*` (auditoría de precios en curso) y `buylist-sweep.service.ts` si el rechazo lo requiere. Si dos
> streams necesitan el MISMO archivo de `jobs/` (típicamente `scheduler.service.ts`), el orquestador **serializa** ese
> cambio como con cualquier zona compartida.

### frontend/ (Next.js App Router)
```
frontend/
  src/
    app/
      [locale]/                 # es | en (default es)
        (storefront)/           # catálogo, ficha, carrito, checkout, mi-bóveda, retiros, buylist
        (admin)/                # back-office M1–M10 + dashboard (responsive; sin captura de fotos de producto, v1.2)
        (auth)/                 # login/registro
    components/                 # implementa el DESIGN_SYSTEM (ux-ui define tokens/componentes)
      master-set/               # v1.20: binder/índice de master set PROMOVIDOS desde (admin)/admin/m1/master-set/
                                #   (compartidos por M1, admin-bóveda-cliente y "Mi bóveda"; ver §4.20f)
    lib/                        # api client, stripe.js, query client
    i18n/                       # config next-intl + messages/es.json, messages/en.json (copys de UI)
    hooks/
    types/                      # DTOs espejo del API_CONTRACT (fuente de verdad = docs)
  public/
```

Documentos por rol (propiedad en `CLAUDE.md`): `docs/BACKEND_NOTES.md`, `docs/FRONTEND_NOTES.md`, `docs/DEVOPS_NOTES.md`, `docs/DESIGN_SYSTEM.md`, `docs/TECH_DEBT.md`.

---

## 3. Modelo de datos

Convención de dinero: **todos los montos son enteros en centavos (`*Cents`) de MXN**, salvo `PriceReference.priceUsdCents` (origen USD, informativo). No se usa float para dinero. **No existe entidad de saldo/wallet.** Timestamps en UTC.

### 3.1 Diagrama textual de relaciones (resumen)
```
User 1───* Address
User 1───1 KycProfile           (CLABE/INE/límites)
User 1───1 BillingProfile       (CFDI)
User 0/1─* Order 1───* OrderItem *───1 InventoryItem      (v1.21: userId NULLABLE = pedido de invitado)
User 0/1─* ShipmentRequest 1───* ShipmentItem *───1 InventoryItem   (v1.21: userId NULLABLE = envío directo)
Order 1───* OrderAccessToken        (v1.21: enlace de seguimiento del invitado; solo el SHA-256 en BD)
Order 0/1─* ShipmentRequest         (v1.21: orderId poblado = envío directo que fulfilla ese pedido)
User 1───* SellRequest 1───* SellRequestItem 0/1─1 InventoryItem  (al convertir)
User 1───* Dispute *───1 InventoryItem

Card 1───* InventoryItem
Card 1───* PriceReference
Card *───1 CardSet

InventoryItem *───1 VaultLocation
InventoryItem 1───* InventoryMovement
InventoryItem ownerType: platform | customer  (ownerUserId cuando customer)

User 1───* PortfolioSnapshot        (serie diaria de valor de portafolio; gráfica de tendencia)
User 1───* AuthToken               (verificación de correo / reset de contraseña; un solo uso, hash en BD)

ConfigSetting (diales M10, key/value)     AuditLog (global)     FxRate (diario)
PendingPriceEntry (cola de precio pendiente)
```

### 3.2 Entidades

#### User (+ rol)  — **MIGRACIÓN v1.1 (campos de auth Google)**, **v1.3.1 (M6: soft-delete + reset admin)**
- `id` (uuid), `email` (único), `passwordHash` (**nullable** — null para cuentas creadas solo con Google), `role` (`customer | vault_operator | super_admin`), `name`, `phone?`, `locale` (`es|en`, default `es`), `status` (`active | blocked | deleted`), `createdAt`, `updatedAt`.
- **Gestión de cuenta (v1.3.1, MIGRACIÓN M-15):** `deletedAt` (`DateTime?`), `anonymizedAt` (`DateTime?`),
  `mustChangePassword` (`Boolean @default(false)` — lo activa el reset admin; opcional de consumir por el front),
  y `tokenVersion` (`Int @default(0)` — se **incrementa** en reset/soft-delete para **revocar refresh tokens**
  vigentes; el JWT lleva el `tokenVersion` y el guard rechaza los que no coinciden). El valor `deleted` de
  `UserStatus` marca cuenta soft-deleted/anonimizada; `POST /auth/login` y `/auth/google` la rechazan con
  `403 USER_BLOCKED` (no revela el motivo).
- **Auth provider (nuevo):** `authProvider` (enum `local | google`, default `local`), `googleId` (`String? @unique` — `sub` del ID token de Google), `emailVerified` (`Boolean @default(false)`), `avatarUrl` (`String?`).
- **Verificación de correo como AUTORIDAD (v1.5-auth-email):** `emailVerified` **NO** bloquea el login pero
  **sí** las acciones sensibles (compra/retiro/venta) vía `EmailVerifiedGuard` (§4.11, §7). Se puebla en
  `req.user` desde el `JwtAuthGuard` (que ya consulta la BD por `status`/`tokenVersion`; añade `emailVerified` al
  `select`). Google → `emailVerified=true` (no afectado). Relación nueva `User 1───* AuthToken`.
- El comprador es siempre `customer`. `vault_operator` y `super_admin` son cuentas de back-office.
- **Reglas de auth Google (ver §4.7):**
  - `passwordHash` es null hasta que el usuario fije contraseña; `POST /auth/login` (email/contraseña) **rechaza** cuentas sin `passwordHash` con `401 INVALID_CREDENTIALS` (no revela que es cuenta Google).
  - **Account-linking por email verificado:** si un `POST /auth/google` trae un email que ya existe como cuenta `local`, se enlaza (`googleId` se setea, `authProvider` permanece o pasa a coexistir) **solo si el token trae `email_verified=true`**. Si el email no está verificado en el token → `403 GOOGLE_EMAIL_UNVERIFIED`, no se enlaza.
  - **El `role` se asigna SIEMPRE server-side** (default `customer`); NUNCA se lee del ID token. Ningún claim del token puede elevar privilegios.
  - Login Google **no exime KYC**: la buylist sigue exigiendo CLABE/INE a nombre del usuario (M6) independientemente del provider.

#### KycProfile (M6)
- `id`, `userId` (único), `legalName`, `rfc?`, `clabe?` (18 dígitos, a nombre del propio usuario), `ineFrontKey?`, `ineBackKey?`, `kycStatus` (`none | pending | verified | rejected`), `capPerRequestCentsOverride?`, `capPerMonthCentsOverride?` (si null, usa diales de M10), `verifiedBy?`, `verifiedAt?`.
- Regla de negocio: pago SPEI solo a una `clabe` **a nombre del propio usuario**; INE requerido cuando la cotización/acumulado supera el tope configurado.

#### BillingProfile (CFDI)
- `id`, `userId` (único), `rfc`, `razonSocial`, `regimenFiscal`, `usoCfdi`, `postalCode`, `email`. Se toma **snapshot** dentro de `Order` al pagar.

#### Address
- `id`, `userId`, `line1`, `line2?`, `neighborhood?`, `city`, `state`, `postalCode`, `country` (**fijo `MX`; se rechaza cualquier otro**), `phone`, `isDefault`. Usado en retiros; snapshot en `ShipmentRequest`.

#### CardSet (catálogo, datos en inglés)
- `id`, `externalId` (pokemontcg.io), `name` (EN), `series?`, `releaseDate?`, `printedTotal?`, `ptcgoCode?`.

#### Card (catálogo, datos en inglés, no se traduce)
- `id`, `externalId` (pokemontcg.io id), `setId` (FK CardSet), `name` (EN), `number`, `rarity`, `supertype`, `subtypes` (JSONB), `imageSmallUrl`, `imageLargeUrl`, `tcgplayerId?`, `createdAt`.
- **`availableFinishes Finish[] @default([normal])` (v1.6-finish, MIGRACIÓN M-18):** acabados en que existe esta carta, **derivados de las llaves de `tcgplayer.prices`** al importar (ver mapeo §3.7). **Sigue siendo 1 fila por `externalId`** — el `@unique` de `externalId` NO cambia; `availableFinishes` es un array en la MISMA fila (no se crea una fila por acabado). Default seguro `[normal]` para filas históricas hasta el re-sync. Es la **lista blanca** contra la que el backend valida cualquier `finish` recibido (SEC-A1, §4.2).
- Índices: `(setId)`, `(name)`, `(rarity)`, `externalId` único.

#### VaultLocation (M1 — ubicación jerárquica CAJA/FILA/SLOT)
- `id`, `zone` (`platform_stock | customer_custody` — **separación física de custodia de clientes**), `box` (CAJA), `row` (FILA), `slot` (SLOT), `label` (derivado, ej. `C03-F02-S15`), `isActive`.
- Unicidad: `(zone, box, row, slot)`.

#### InventoryItem (instancia física — pieza única)
Núcleo del sistema. Una fila = una carta/producto físico.
- `id`, `folio` (**legible, único, `INV-000123`**, ver §5), `cardId` (FK), `productType` (`graded | sealed | raw`).
- Condición/grado (según tipo):
  - raw → `rawCondition` (**enum `RawCondition = NM` — ÚNICO valor; MIGRACIÓN v1.1**, estándar propio, ver §3.5). Se **eliminan** `LP | MP | HP | DMG` del enum. Greenfield: no hay filas que hacer backfill; la migración solo redefine el enum/constraint.
  - graded → `gradingCompany` (`PSA | CGC`), `gradeValue` (ej. `10`, `9.5`), **`certNumber` (`String` — nº de certificado PSA/CGC; MIGRACIÓN v1.2 M-12). REQUERIDO para publicar una gradeada.** El slab (empresa+grado+cert, verificable en la web de la graduadora) es la garantía de condición; **sin validación automática** contra la graduadora (fuera de alcance). `certNumber` es null para raw/sealed.
  - sealed → **sin condición ni rareza ni grade ni cert** (ver §3.6). **Precio manual MXN obligatorio para publicar.**
  - `sealedSubtype?` (enum opcional `box | etb | bundle | tin | blister`, solo para `productType=sealed`; nullable en el resto).
- **Imagen (v1.2): sin fotos propias.** El item **no** almacena fotos propias; la imagen mostrada (ficha/Compra/bóveda/back-office) es la **imagen de catálogo remota** de la `Card` (`imageSmallUrl`/`imageLargeUrl` de pokemontcg.io). Los campos `frontPhotoKey`/`backPhotoKey`/`extraPhotoKeys` quedan **eliminados/opcionales sin uso** (MIGRACIÓN v1.2 M-13); ya **no** son evidencia de disputa (la evidencia va por correo a soporte, ver §3.6 y §Dispute).
- Ubicación: `locationId` (FK VaultLocation).
- Propiedad y titularidad:
  - `ownerType` (`platform | customer`), `ownerUserId?` (cuando `customer`).
  - `ownershipStatus?` (`pending | settled`, solo cuando `ownerType=customer`; ver §3.3).
- Estado operativo: `status` (`in_stock | listed | reserved | in_custody | picking | shipped | delivered | lost | damaged | withdrawn`).
  - **v1.17 — uso en el flujo de retiro:** durante un envío activo el item **permanece `in_custody`** (la etapa se deriva del join a `ShipmentRequest`, ver §3.3); al llegar el envío a **`entregado`** el item pasa a **`withdrawn`** (terminal: sale de la bóveda, no se lista ni cuenta en el portafolio). Los valores **`picking | shipped | delivered` quedan sin uso por diseño** en el ciclo de envío (no se espejan en el item; la fuente de verdad de la etapa es la `ShipmentRequest`). `withdrawn` es la **única** escritura del ciclo de retiro.
- Precio de venta: `listPriceCents?` (MXN sin IVA; **= `round(referenciaMxn × (1 + salesMarkupPct/100))`** con `salesMarkupPct` dial M10, o override manual directo; si null y sin `PriceReference` → **"precio pendiente"**, no vendible). El **valor de referencia** (valor de mercado mostrado) es el de `PriceReference`, distinto del precio de venta.
- Costo y adquisición: `acquisitionType` (`aportacion_en_especie | buylist | compra`), `acquisitionCostCents`, `acquisitionPct?` (ej. 70 para aportación en especie), `sourceSellRequestItemId?`.
- **`finish Finish @default(normal)` (v1.6-finish, MIGRACIÓN M-18):** qué **acabado** es la copia física (Normal / Reverse Holo / Holofoil / 1st Edition Holo). Se captura al alta (M1) y debe pertenecer a `card.availableFinishes`. **Afecta la valuación** (se valúa contra la `PriceReference` de ESE acabado, §4.1) y el **catálogo "Compra"** (se lista/filtra por acabado, §4.9). Filas históricas → `normal`. Para `graded`/`sealed` el finish es siempre `normal` (el acabado solo aplica a raw/singles; ver §3.7).
- `createdAt`, `updatedAt`.
- Índices: `folio` único, `(cardId)`, `(status)`, `(ownerUserId)`, `(locationId)`.

#### InventoryMovement (M1 — historial)
- `id`, `itemId`, `fromLocationId?`, `toLocationId?`, `fromStatus?`, `toStatus?`, `reason` (`alta | move | sale | settle | chargeback_return | withdrawal | lost | damaged | buylist_convert`), `actorUserId`, `note?`, `createdAt`.

#### PriceReference (M2 — precio por carta/tipo/**acabado**/fecha/fuente/FX)
- `id`, `cardId`, `productType`, `gradeKey` (string normalizada: `raw:NM`, `graded:PSA:10`, `sealed`), **`finish Finish @default(normal)` (v1.6-finish, MIGRACIÓN M-18)**, `source` (`pokemontcg_io | pokemonpricetracker | poketrace | manual`), `priceUsdCents?`, `fxRate?` (decimal), `fxBufferPct?`, `priceMxnCents`, `capturedDate` (date), `isManualOverride` (bool), `createdAt`.
- **Unicidad (v1.6-finish):** `@@unique([cardId, productType, gradeKey, finish, capturedDate])` — **`finish` se añade a la clave**. Así `normal` y `reverse_holo` de la misma carta tienen **referencia de precio distinta** (una fila por día **por acabado**). El provider guarda el precio **POR acabado** (`tcgplayer.prices[finish].market`), no "el primer market disponible".
- **`gradeKey` NO cambia de semántica:** sigue describiendo condición/grado (`raw:NM`, `graded:PSA:10`, `sealed`); el `finish` es **ortogonal** y vive en su propia columna (más limpio y consulteable que codificarlo en el string). `buildGradeKey` se mantiene igual; el `finish` viaja como **parámetro explícito** por `getReference(cardId, productType, gradeKey, finish)` / `syncCardPrice(...)` (§4.1). Para `graded`/`sealed`, `finish=normal` siempre (sin cambio de comportamiento; el default lo cubre).
- **Cache diario** = una fila por día por `(carta, tipo, gradeKey, acabado)`.
- **Precio pendiente** = no hay fila vigente con `priceMxnCents` para ESE acabado y no hay override → genera `PendingPriceEntry`.

#### PendingPriceEntry (cola de precio pendiente — escalado al dueño)
- `id`, `cardId`, `productType`, `gradeKey`, **`finish Finish @default(normal)` (v1.8-ronda-c, MIGRACIÓN M-19)**, `context` (`catalog | portfolio | buylist | inventory`), `refId?` (item/sellRequestItem que lo originó), `status` (`open | resolved`), `resolvedPriceRefId?`, `createdAt`, `resolvedAt?`.
- **`finish` en la llave de la cola (v1.8-ronda-c):** la cola se dedupe/resuelve por `(cardId, productType, gradeKey, finish, status='open')`. Antes era **sin `finish`**, así que los acabados de una carta colapsaban en **UNA** entrada y resolver el override de `normal` cerraba la de `holofoil`. Ahora cada acabado tiene su **propia** entrada pendiente, alineado con `PriceReference` (que ya lleva `finish` en su clave) y con `getReference(...finish)` (§4.1, sin cambio). No hay índice único de BD sobre la cola (la deduplicación es por `findFirst` en `escalatePending`); M-19 solo **añade la columna** `finish`. Ver §4.2 (resolución de override por acabado).
- Regla transversal: una carta sin precio **nunca se descarta**; entra aquí y se escala al súper-admin.

#### FxRate (M2/M10 — USD→MXN con colchón)
- `id`, `base` (`USD`), `quote` (`MXN`), `rate` (decimal), `bufferPct` (dial M10), `effectiveDate` (date), `source` (**enum `FxSource = banxico | manual`**, dedicado y **separado de `PriceSource`**), `createdAt`.
- Automático: job diario `fx-refresh` obtiene el `rate` de **Banxico (SIE)**, aplica el colchón y escribe `source=banxico`. **Override manual** (dial M10) escribe `source=manual` y **tiene prioridad** sobre el automático del mismo día; también es el fallback si el fetch falla.
- El precio MXN mostrado = `priceUsd × rate × (1 + bufferPct/100)`.

#### Order (M3 — venta de cartas)
- `id`, `userId`, `status` (`pending | settled | failed | refunded | chargeback`).
- Desglose (todo en centavos MXN): `subtotalCents` (suma de líneas sin IVA), `processingFeeCents` (**fee de Stripe trasladado al comprador**, línea visible), `ivaCents` (**16% desglosado**), `totalCents` (= subtotal + fee + IVA).
- `ivaRatePct` (snapshot del dial, default 16), `stripePaymentIntentId?`, `stripeChargeId?`, `billingSnapshot` (JSONB, datos CFDI al momento), `cfdiStatus` (`registrado | no_aplica` en MVP — sin PAC; `emitido` reservado para fase 2), `invoiceRequested` (bool, default false — el cliente pide factura por correo), `createdAt`, `settledAt?`, `refundedAt?`.
- **Banderas operativas de disputa/contracargo** (escalares, NO cambian el enum `OrderStatus`): `chargebackNeedsManual` (bool, default false — el contracargo llegó cuando la carta **ya se había enviado/entregado**; requiere pelear la disputa con la guía, sin re-agregar inventario) y `disputeOutcome?` (`won | lost | null` — resultado del cierre de la disputa Stripe: `won→settled`, `lost→chargeback`). Se **exponen solo** en el detalle admin de orden del contrato (`GET /admin/orders/:id`), no en `OrderSummaryDTO` ni en el detalle del cliente.
- Índices: `(userId)`, `(status)`, `stripePaymentIntentId` único.
- **Guest checkout (v1.21, MIGRACIÓN M-25):** `userId` pasa a **nullable** (un pedido de invitado no tiene `User`) y
  se añaden: `guestEmail?` (normalizado, indexado; `!= null` ⇔ el pedido **nació** de invitado, inmutable),
  `fulfillmentMode` (`vault | direct_ship`, **default `vault`** = comportamiento actual), `shippingAddressSnapshot?`
  (JSONB — el invitado no tiene `Address`), `shippingFeeCents` (`@default(0)`, envío cobrado **dentro** de esta
  orden y **única** fuente de ese ingreso para el P&L), `orderNumber?` (`@unique`, `TCG-000123`, secuencia
  `order_number_seq`), `claimedAt?`, `locale?`, `paymentMethodBrand?`/`paymentMethodLast4?` (marca + 4 últimos del
  `charge`; **nunca** PAN/BIN/titular). Relaciones nuevas: `accessTokens OrderAccessToken[]`,
  `shipmentRequests ShipmentRequest[]`. Invariantes y `CHECK` recomendados en §11 (M-25); diseño en §4.21.

#### OrderItem
- `id`, `orderId`, `inventoryItemId`, `cardSnapshot` (JSONB: nombre/set/número/tipo/condición-grado), `unitPriceCents` (sin IVA, congelado al checkout).

#### ShipmentRequest (M4 — retiro/envío nacional)
- `id`, `userId`, `addressSnapshot` (JSONB, MX), `status` (`solicitado | picking | guia | enviado | entregado | cancelado`).
- **Ingreso** por envío: `shippingFeeCents` (dial M10, default 17500) = **lo que el cliente nos paga** por el envío (línea de cobro Stripe). `stripePaymentIntentId?` (el envío se cobra al comprador **antes** de generar la solicitud).
- **Costo** de envío (v1.4-finance, **MIGRACIÓN M-16**): `shippingCostCents` (`Int @default(0)`) = **lo que la plataforma paga a la paquetería** por ese envío (MXN centavos). **Distinto de `shippingFeeCents`** (ingreso ≠ costo). Se **captura en M4 al asignar carrier/guía** (`POST /admin/shipments/:id/tracking`), es **opcional** (default 0 mientras no se conoce) y **editable** después re-invocando el mismo endpoint; validación de aplicación **entero ≥ 0**. Alimenta el P&L de M7 (se resta), acotado por `pickingAt` (§ P&L M7). Filas históricas/sin captura ⇒ 0 (no rompen el P&L).
- Logística manual: `carrier?`, `trackingNumber?`, `requestedAt`, `pickingAt?`, `shippedAt?`, `deliveredAt?`.
- Restricción: solo se incluyen items `settled` (ver validación en §3.3).
- **Guest checkout (v1.21, MIGRACIÓN M-25):** `userId` pasa a **nullable** y se añade **`orderId?`** (FK a `Order`,
  indexado) como **discriminador de naturaleza**: `orderId == null` ⇒ **retiro de bóveda** (todo lo de arriba, sin
  cambios); `orderId != null` ⇒ **envío directo** que fulfilla un pedido de invitado, creado **por el servidor** al
  liquidar el pago, nacido en `picking`, con `stripePaymentIntentId = null` y **montos en `0`** (el envío ya se
  cobró en la orden — evita el doble conteo en el P&L). La restricción de "solo items `settled`" **no aplica** al
  envío directo: sus items nunca estuvieron en bóveda (§4.21c). Invariante de aplicación: **a lo más un envío
  activo por orden** (no se pone `@unique` para no cerrar la re-expedición por pérdida).

#### ShipmentItem
- `id`, `shipmentRequestId`, `inventoryItemId`.

#### OrderAccessToken (enlace de seguimiento del invitado) — **MIGRACIÓN M-25 (modelo nuevo, v1.21-guest-checkout)**
- `id`, `orderId` (+FK `onDelete: Cascade`), `tokenHash` (**SHA-256 hex `@unique`** del claro; el claro son 32 bytes
  aleatorios `base64url` que viajan **solo por correo** y en la respuesta del checkout a quien creó el pedido),
  `expiresAt`, `revokedAt?`, `lastUsedAt?`, `useCount` (`@default(0)`), `requestIp?`, `createdAt`.
  Índices: `(orderId)`, `(expiresAt)`.
- **Mismo patrón que `AuthToken`** (§3.2/§4.11) con **una** diferencia semántica: es **multi-uso** — `usedAt`
  (consumible) se sustituye por `revokedAt` (revocable). Por eso **no** se reusa `AuthToken`: su `userId` es
  obligatorio (un invitado no lo tiene) y su `consume()` marca uso único.
- Reglas (v1.21.1, §4.21e-bis): **dos vidas según origen** — token de **checkout** (respuesta de
  `POST /checkout/guest/session`) **120 min**, token de **seguimiento** (correo/reenvío/soporte) **90 días**; se
  distinguen **solo por `expiresAt`** (no hay columna `type`/`purpose`/`reason`). **Rotan** (revocando todos los
  vivos del pedido) el **reenvío** y el **reenvío de soporte**; el **settle NO rota** (dejaría sin acceso la
  confirmación post-3DS en curso). El **reclamo revoca todo**. No se emiten tokens para pedidos con más de
  **365 días**. El motivo de revocación que ve el cliente se **deriva** (`CLAIMED` si `Order.claimedAt != null`,
  si no `ROTATED`); el detalle de quién rotó vive en `AuditLog`.
- **No es una credencial de sesión**: no otorga rol, no se acepta en `Authorization` y solo habilita la lectura de
  **un** pedido con datos mínimos. Modelo de amenazas completo en §4.21e.

#### SellRequest (M5/E — buylist)
- `id`, `userId`, `status` (`cotizada | recibida | verificacion | aprobada | pagada | rechazada | abandonada`).
- Totales: `quotedTotalCents`, `approvedTotalCents?`.
- KYC/pago: `clabeSnapshot`, `ineRequired` (bool), `ineProvided` (bool), `speiReference?`, `paidBy?` (**solo súper-admin**), `paidAt?`.
- Plazos: `createdAt`, `receivedAt?`, `verifiedAt?`, `approvedAt?`, `adjustmentSentAt?` (para plazo 7d de rechazo), `deadlineAt?` (30d → inventario).
- **`closedAt DateTime?` (v1.8-ronda-c / SEC-D2, MIGRACIÓN M-19):** timestamp del **cierre real** de la solicitud. Se **setea a `now()` exactamente cuando la solicitud entra a un estado TERMINAL** (`pagada`, `rechazada` o `abandonada`) — es decir, en la misma transacción que fija ese `status`: `pay-spei` (`→pagada`), el rechazo/`decision reject` que deja la solicitud sin items vivos (`→rechazada`) y el barrido de plazos `buylist-sweep` (`→abandonada`, 30d). **Inmutable** una vez seteado (no se reabre). Ancla la ventana de retención de INE al cierre real en vez de la aproximación `max(paidAt,approvedAt,verifiedAt,receivedAt,createdAt)` (que para `rechazada`/`abandonada` caía en `createdAt`). Filas legacy cerradas antes de M-19 → `closedAt=null` y el job cae al cálculo aproximado (§3.4 d). Campo **interno de cumplimiento**; no se expone en DTOs de cliente.
- Regla: **pago SPEI tras recepción y verificación**, decidido carta por carta (cherry-pick).

#### SellRequestItem
- `id`, `sellRequestId`, `cardId`, `productType`, `rawCondition?`, `quotedPriceCents?` (null si precio pendiente), `approvedPriceCents?`, `itemStatus` (`cotizada | precio_pendiente | recibida | verificacion | aprobada | ajustada | rechazada | pagada | convertida_inventario`), `inventoryItemId?` (al convertir).
- **`finish Finish @default(normal)` (v1.6-finish, MIGRACIÓN M-18):** **snapshot del acabado** aplicado en la cotización/solicitud (validado contra `card.availableFinishes` al crear). Determina la regla y la referencia usadas (§4.2). Al **convertir a inventario** (M5), el `finish` se **propaga** al `InventoryItem.finish`.
- **Regla de precio aplicada (v1.3.1 — snapshot para auditoría, reemplaza `category`):**
  - `rarity?` (String — snapshot de `Card.rarity` al cotizar; taxonomía abierta pokemontcg.io).
  - `ruleMode?` (**enum `BuylistRuleMode = fixed | pct`** — modo de la regla aplicada).
  - `ruleValue?` (Int — centavos si `fixed`, porcentaje si `pct`).
  - `ruleSource?` (`rule | fallback` — si vino de una fila explícita de `BUYLIST_PRICE_RULES` o del fallback).
- **`category` (DEPRECADO, MIGRACIÓN M-14):** la columna `category` (BuylistCategory) queda **nullable/legacy**;
  la cotización v1.3.1 ya **no** la lee ni la escribe (se conserva solo por retención de filas históricas). El
  enum `BuylistCategory` permanece en el schema por compatibilidad, marcado deprecado; nada nuevo lo usa.
- **v1.2: sin `photoKeys`** — el buylist no sube fotos de la carta (no hay upload salvo `kyc_ine`); la verificación NM se hace contra la carta física recibida y la imagen de catálogo. El campo `photoKeys` queda eliminado/sin uso (M-13).

#### Dispute (M8 — condición raw/sellado)
- `id`, `userId`, `inventoryItemId` (o vía `orderItemId`), `type` (`condition_raw | condition_sealed`), `status` (`abierta | en_revision | resuelta_recompra | rechazada`).
- **Evidencia por correo (v1.2):** la evidencia se envía **por correo al buzón de soporte** (dato de contacto, no se sube a la app). El `Dispute` **ya no** guarda `ingressPhotoKeys`/`claimPhotoKeys` (eliminados, M-13); guarda solo `description`. Resolución: **gradeadas** por grado + `certNumber` (verificable en la graduadora); **raw NM** por el estándar/política de condición propio.
- Remedio: `resolution?`, `repurchaseOrderId?` (**recompra al precio pagado**), `deadlineAt` (**7 días desde entrega**), `createdAt`, `resolvedAt?`, `resolvedBy?`.
- **Política VENTAS FINALES:** la recompra es una **compensación**; el **cliente conserva la carta** y la carta **NO** regresa al inventario (sin `InventoryMovement`, sin re-listar). Solo se registra el pago de recompra (money-out, súper-admin, auditado).

#### ConfigSetting (M10 — diales editables sin deploy)
- `key` (PK, ej. `shipping_fee_cents`, `aportacion_pct`, `iva_pct`, `sales_markup_pct`, `stripe_fee_pct`, `stripe_fee_fixed_cents`, `stripe_fee_iva_pct`, `buylist_cap_per_request_cents`, `buylist_cap_per_month_cents`, `ine_threshold_cents`, `repo_cap_per_card_cents`, `fx_buffer_pct`, `fx_manual_override_rate`, `pricing_provider_raw`, `pricing_provider_graded`, `pricing_provider_sealed`, **`catalog_sync_from_date`** (default `"2024/01/01"`, frontera por defecto del sync de catálogo), **`buylist_price_rules`** y **`buylist_price_fallback_pct`** (v1.3.1, tabla de precio de buylist por rareza)), `valueJson` (JSONB, tipado por key), `updatedBy`, `updatedAt`.
- Defaults iniciales: envío 17500, aportación 70, IVA 16, **markup de venta configurable (`sales_markup_pct`)**, **tarifa Stripe MX para el gross-up: `stripe_fee_pct`, `stripe_fee_fixed_cents` y `stripe_fee_iva_pct` (IVA sobre la comisión de Stripe, fracción `[0,1)`, default 0.16)**, tope solicitud 300000, tope mes 1000000, INE = tope solicitud, colchón FX configurable + override manual, providers según tabla de PROJECT.
- **Buylist por rareza (v1.3.1):**
  - `buylist_price_rules` (JSONB) = `{ [rarity]: { mode: 'fixed'|'pct', value } }`. Seed: `{ "Common": {fixed,50}, "Uncommon": {fixed,50}, "Reverse Holo": {fixed,150} }`. **Validador:** objeto (no array); cada entrada `{ mode, value }` con `mode ∈ {fixed,pct}`; si `fixed` → `value` **entero ≥ 0** (centavos); si `pct` → `value` **número en `[0,100]`**. Rechaza modos/valores fuera de rango (`422 VALIDATION_ERROR`).
  - `buylist_price_fallback_pct` (número) = **40** por defecto. **Validador:** número en `[0,100]`.
  - **NO** se exponen en el DTO de settings de M10 (`GET/PUT /admin/settings`); se editan por endpoints dedicados de M2 (`GET/PUT /admin/pricing/buylist-rules`, ver `API_CONTRACT §M2`). Toda edición se **audita** (`AuditLog action=pricing.buylist_rules.update`).
- **`rarity_map` (DEPRECADO v1.3.1):** el dial `rarity_map` (`RARITY_MAP`) y sus endpoints `GET/PUT /admin/pricing/rarity-map` quedan **deprecados**; la cotización ya no los lee. Se conservan como no-op/legacy hasta su retiro; no se siembran en despliegues nuevos.

#### AuditLog (M10 — bitácora global)
- `id`, `actorUserId`, `actorRole`, `action` (string, ej. `order.refund`, `sellrequest.pay_spei`, `settings.update`, `inventory.mark_damaged`, `catalog.sync`, `catalog.backfill`, `auth.google_link`, `pricing.buylist_rules.update`, `user.create`, `user.reset_password`, `user.delete`), `entityType`, `entityId`, `before?` (JSONB), `after?` (JSONB), `ip?`, `createdAt`.
- **PII/secretos NUNCA en `before`/`after`:** acciones sobre credenciales/PII (`user.create`, `user.reset_password`, `user.delete`) registran solo IDs/flags/`mode`/`role`, **nunca** la contraseña temporal ni la PII anonimizada.
- **Consulta por usuario (v1.7-admin-users):** `GET /admin/users/:id/audit` lee esta tabla por `entityType='User' AND entityId=:id` (`scope=target`) y/o `actorUserId=:id` (`scope=actor`); su proyección **omite `before`/`after`** y solo incluye `ip` para `super_admin` (§4.7ter).
- **Toda acción de back-office se registra**, en especial los intentos bloqueados de dinero saliente por operador (queda registrado y bloqueado) y las **operaciones de sync de catálogo** (`catalog.remote_sets`, `catalog.sync`, `catalog.backfill`; ver §4.8, auditadas).

#### PortfolioSnapshot (gráfica de tendencia del portafolio) — **MIGRACIÓN v1.1 (modelo nuevo)**
Serie temporal por usuario que alimenta la gráfica estilo acciones de "Mi bóveda" (rangos 5d/15d/1m/3m/6m/1a/YTD/Máx).
- `id`, `userId` (FK User), `asOfDate` (`@db.Date` — un punto por día natural), `totalValueMxnCents` (valor del portafolio a **referencia** ese día, misma lógica que `VaultService.holdings()`), `costBasisMxnCents?` (base de costo agregada del usuario, opcional/nullable), `pendingPriceCount` (cartas sin precio ese día, excluidas del total), `createdAt`.
- **Unicidad:** `@@unique([userId, asOfDate])` (idempotente: re-correr el job del día hace upsert, no duplica).
- **Índice:** `@@index([userId, asOfDate])` para consultas por rango.
- **Escritura:** job diario `portfolio-snapshot` (BullMQ, ver §5 y BE-5) tras el `price-sync`; reutiliza `VaultService.holdings()` para no divergir del valor mostrado en vivo. Solo snapshotea usuarios con holdings.
- **Backfill indicativo (opcional, marcado estimado):** si se desea sembrar histórico previo a la puesta en marcha del job, se puede generar una serie **estimada** aplicando los `PriceReference` disponibles por fecha a los holdings actuales del usuario. Estos puntos se marcan `estimated=true` en la respuesta (`PortfolioPointDTO.estimated?`) y **no** se persisten como verdad si contradicen un snapshot real; es indicativo, no autoritativo. Es una tarea opcional de BE, no bloquea el MVP.

#### SetValueSnapshot (gráfica PÚBLICA del valor de un set) — **MIGRACIÓN M-20 (modelo nuevo, v1.9-set-chart)**
Serie temporal **por set** que alimenta la gráfica PÚBLICA del hero de la home (visitantes anónimos, estilo
acciones, mismos rangos 5d/15d/1m/3m/6m/1a/YTD/Máx). Es el **análogo de `PortfolioSnapshot` pero agregando por
`setId`** en vez de por `userId`. Como pokemontcg.io solo da precio de HOY (sin historial), la serie **se
siembra con el valor de hoy y crece con captura diaria** (no hay histórico que bajar; no se fabrican puntos).
Forma EXACTA del modelo (backend lo traduce a Prisma en `schema.prisma`):
- `id` (uuid), `setId` (FK a `CardSet`, `onDelete: Cascade`), `asOfDate` (`@db.Date` — un punto por día natural).
- `totalValueMxnCents` (`Int`) — valor agregado MXN (centavos) del set ese día (regla de valor en §4.12).
- `pricedCardCount` (`Int`) — cuántas cartas del set **tenían precio** ese día (las que entran al total).
- `totalCardCount` (`Int`) — cuántas cartas tiene el set en total (`Card` con ese `setId`). Invariante
  `pricedCardCount <= totalCardCount`. La razón `pricedCardCount/totalCardCount` es la **cobertura** de datos y
  se expone en el punto para que el front pueda advertir "valor parcial del set".
- `createdAt`, `updatedAt` (`@updatedAt`).
- **Unicidad:** `@@unique([setId, asOfDate])` (idempotente: re-correr el job del día hace **upsert**, no duplica).
- **Índice:** `@@index([setId, asOfDate])` para consultas por rango.
- **Relación nueva en `CardSet`:** `snapshots SetValueSnapshot[]` (lado inverso de la FK).
- **Escritura:** job diario `set-value-snapshot` (BullMQ, §5) tras `set-price-sync`. Ver la regla de valor y el
  manejo de cartas sin precio en §4.12. **SEC-A1:** `totalValueMxnCents` se deriva SIEMPRE de `PriceReference`
  real; nunca de input del cliente.
- **Sin backfill:** M-20 solo crea la tabla; la serie arranca vacía y se puebla desde el primer día que corra el
  job (mismo criterio "no se inventan datos" que `PortfolioSnapshot`). Un backfill estimado NO aplica aquí
  porque no existen `PriceReference` de fechas previas para las cartas del set fuera de bóveda.

#### AuthToken (verificación de correo / reset de contraseña) — **MIGRACIÓN M-17 (modelo nuevo, v1.5-auth-email)**
Token de **un solo uso** para los flujos self-service por correo. **Nunca** guarda el token en claro: el claro
(alta entropía) viaja solo por email; en BD vive su **hash**.
- `id` (uuid), `userId` (FK User, `onDelete: Cascade`), `type` (enum `AuthTokenType = email_verification | password_reset`),
  `tokenHash` (`String @unique` — **SHA-256** del token en claro), `expiresAt` (`DateTime`), `usedAt` (`DateTime?` —
  se setea al consumir; `null` = vigente), `requestIp` (`String?`, auditoría), `createdAt`.
- **Índices:** `@@unique([tokenHash])` (lookup por hash del token presentado), `@@index([userId, type])`
  (invalidar/consultar los del usuario), `@@index([expiresAt])` (barrido `auth-token-sweep`).
- **Hashing:** el token en claro es **32 bytes aleatorios** (`crypto.randomBytes`, base64url ≈ 256 bits de
  entropía) → basta **SHA-256** (rápido): NO se usa argon2 porque no hay riesgo de fuerza bruta con esa entropía
  (a diferencia de una contraseña). *(Endurecimiento opcional: HMAC-SHA256 con una llave de servidor dedicada,
  patrón `clabeHmac`; se documenta como opción, no requerido para el MVP.)*
- **Expiraciones (dial/const):** `email_verification` **24h**, `password_reset` **1h**. Configurables como
  constantes de servicio (o dial futuro); no son `ConfigSetting` en el MVP.
- **Un solo uso + rotación:** consumir setea `usedAt`. Al **emitir** un token nuevo de un `type` para un usuario,
  se **invalidan** (marcan `usedAt`/borran) los tokens vigentes previos de ese `type` → solo el último link vale.
- **Validación al consumir (atómica):** `tokenHash` existe **y** `usedAt IS NULL` **y** `expiresAt > now()`;
  cualquier fallo → `422 *_TOKEN_INVALID` (no se distingue inexistente/expirado/usado, para no filtrar señal).
- **Escritura/lectura:** `AuthService` (verificación/forgot/reset). Barrido housekeeping: job `auth-token-sweep`
  (borra `expiresAt < now()`), no crítico.

### 3.3 Ciclo de titularidad `pending → settled` (regla transversal)

```
Compra Stripe (PaymentIntent creado)
  → OrderItem.inventoryItem: ownerType=customer, ownerUserId=comprador,
    ownershipStatus=pending, status=in_custody     (Order.status=pending)

webhook payment_intent.succeeded
  → ownershipStatus=settled                         (Order.status=settled, settledAt)

webhook charge.dispute.created (contracargo, CONSCIENTE DEL ESTADO FÍSICO)
  → Order.status=chargeback en ambos casos, y:
    (a) carta AÚN en bóveda (sin ShipmentItem enviado/entregado):
        revierte a inventario de plataforma:
        ownerType=platform, ownerUserId=null, ownershipStatus=null,
        status=listed (o in_stock), movimiento reason=chargeback_return
    (b) carta YA enviada/entregada:
        NO se re-agrega al inventario; Order.chargebackNeedsManual=true
        (pelear la disputa con la evidencia de la guía); sin movimiento

webhook charge.dispute.closed / charge.dispute.funds_reinstated (cierre)
  → ganamos: Order.status=settled, disputeOutcome=won
    (la carta revertida en (a) se QUEDA en inventario de plataforma)
  → perdemos: Order.status=chargeback (terminal), disputeOutcome=lost

webhook payment_intent.canceled
  → libera la reserva de compra (Order=failed, item reserved→listed)
    o cancela un envío en 'solicitado' (ShipmentRequest=cancelado, libera items)

Retiro  (criterio único de elegibilidad = classifyItems, v1.17.1)
  → un item entra a ShipmentItem SOLO si cumple TODAS:
    ownerType=customer AND ownerUserId=usuario AND ownershipStatus=settled
    AND status=in_custody AND sin envío activo.
    Rechazos: pending ⇒ 422 ITEM_NOT_SETTLED; con envío activo ⇒ 409 ITEM_IN_ANOTHER_SHIPMENT;
    withdrawn / no-in_custody ⇒ 422 ITEM_NOT_IN_CUSTODY.
    La elegibilidad EXCLUYE status=withdrawn (item ya entregado, terminal): NO basta ownershipStatus=settled.
```

#### Ciclo de vida del item durante el RETIRO/envío (v1.17 — Opción 1)

**Fuente de verdad canónica (UNA, declarada para evitar ambigüedad):** el **estado/etapa del retiro** de un
item se **deriva del join** `InventoryItem → ShipmentItem → ShipmentRequest.status`. Hay a lo más **un envío
activo por item** (lo garantiza `409 ITEM_IN_ANOTHER_SHIPMENT`: `shipmentItem.findFirst` sobre envíos
`status NOT IN (cancelado, entregado)` al crear la solicitud). El `InventoryItem.status` **NO se espeja por
etapa**: sigue `in_custody` durante `solicitado → picking → guia → enviado`. Los valores
`InventoryStatus.picking | shipped | delivered` **quedan sin uso por diseño** (no se escriben en el flujo de
envío). La **única** escritura persistente del ciclo es la **transición terminal** en `entregado`.

```
ShipmentRequest solicitado  (creado, PaymentIntent creado, pago pendiente)
  → item SIN cambio (in_custody). shipmentItem existe ⇒ item bloqueado (ITEM_IN_ANOTHER_SHIPMENT).
    HoldingDTO: shipmentState='solicitado', withdrawable=false, activeShipmentId set.

webhook payment_intent.succeeded  (envío pagado)
  → ShipmentRequest solicitado→picking (payments.service; SIN tocar el item).
    HoldingDTO: shipmentState='picking'.

PATCH /admin/shipments/:id/status  y  POST .../tracking   (máquina M4)
  → picking → guia → enviado : item SIN cambio (in_custody). shipmentState se deriva del join.

PATCH /admin/shipments/:id/status → entregado   (TRANSICIÓN TERMINAL)
  → por cada ShipmentItem: InventoryItem in_custody → withdrawn
    (+ InventoryMovement reason='withdrawal'). Conserva ownerType=customer,
    ownerUserId, ownershipStatus=settled (histórico); solo cambia status.
  → Efecto: el item SALE de la bóveda (GET /vault/holdings excluye status='withdrawn')
    y deja de contar en el portafolio / snapshot diario.

webhook payment_intent.canceled  (envío 'solicitado' nunca pagado)
  → ShipmentRequest → cancelado ⇒ el item deja de tener envío activo (shipmentState=null,
    withdrawable vuelve a true). El item nunca cambió de status.
```

Coherencia con el contracargo (§ webhook `charge.dispute.created`, abajo): ese handler ya usa el **mismo join**
(`ShipmentItem` con envío `enviado`/`entregado`) para decidir si la carta "salió físicamente". Con v1.17, tras
`entregado` el item además es `withdrawn`; el handler sigue siendo correcto (busca por `ShipmentItem`, no por
`item.status`) y **no** re-agrega al inventario una carta ya entregada.

**`withdrawn` es TERMINAL para retiros (v1.17.1 — invariante read/write).** Una vez que el item llega a
`status='withdrawn'` (transición terminal en `entregado`), **NO es re-elegible** para un nuevo `POST /shipments`,
aunque conserve `ownershipStatus='settled'` (histórico). La **fuente de verdad de elegibilidad** (`classifyItems`,
misma que el flag de lectura `HoldingDTO.withdrawable`) **excluye** `status='withdrawn'` y exige `status='in_custody'`:
`ownerType='customer' AND ownerUserId=usuario AND ownershipStatus='settled' AND status='in_custody' AND sin envío
activo`. Un intento de retirar un item `withdrawn` (o cualquier `status != 'in_custody'`) por llamada directa a la API
se rechaza con **`422 ITEM_NOT_IN_CUSTODY`** (API_CONTRACT §5). Esto cierra la divergencia detectada en el triple
verdicto de WS-H (SEC-H1): la escritura de creación de retiro y la lectura `withdrawable` comparten **exactamente** el
mismo criterio, evitando el re-envío/re-cobro de un item ya entregado.

Separación física: los items en `ownerType=customer` viven en `VaultLocation.zone=customer_custody`; el stock de la plataforma en `zone=platform_stock`. El movimiento entre zonas queda en `InventoryMovement`.

> **v1.21-guest-checkout — este ciclo describe la ruta `fulfillmentMode='vault'` (la de siempre) y NO cambia.** Un
> pedido de **invitado** (`fulfillmentMode='direct_ship'`) **no tiene titularidad**: el item conserva
> `ownerType='platform', ownerUserId=null, ownershipStatus=null` durante todo el ciclo y este lo lleva `status`
> (`reserved → picking → shipped → delivered`), estrenando los tres valores que el bloque de arriba declara "sin uso
> por diseño". **Invariante que se eleva a norma con esta versión: `ownerType='customer'` ⇒ `ownerUserId NOT NULL`**
> (es lo que hace segura la nulabilidad de `Order.userId`). Ciclo completo y reversos en **§4.21c**.

### 3.4 Protección de PII (cifrado en reposo, blind index, enmascarado, retención)

La PII sensible del proyecto es **CLABE, RFC e imágenes de INE**. Se protege en cuatro capas independientes y acumulativas. Ninguna capa reemplaza a otra: el cifrado protege el dato en la BD, el blind index permite buscar sin descifrar, el enmascarado protege el dato en las respuestas, y la retención limita cuánto tiempo existe la copia más sensible. Las llaves y diales (`PII_ENCRYPTION_KEY`, `PII_HMAC_KEY`, `INE_RETENTION_DAYS`) se declaran en **§8** (ver allí; no se repiten valores aquí).

Columnas afectadas (nombres `*Enc` / `*Hmac`, coherentes con lo implementado por backend):

| Entidad | Campo lógico | Columna cifrada | Columna blind index |
|---|---|---|---|
| `KycProfile` | CLABE | `clabeEnc` | `clabeHmac` |
| `KycProfile` | RFC | `rfcEnc` | — |
| `SellRequest` | CLABE snapshot | `clabeSnapshotEnc` | — |
| `BillingProfile` | RFC | `rfcEnc` | — |

Estas columnas sustituyen a los campos en claro `clabe` / `rfc` / `clabeSnapshot` que aparecen descritos en §3.2 (§3.4 es la descripción normativa de su almacenamiento real: en la BD nunca hay CLABE/RFC en claro).

#### a) Cifrado en reposo — AES-256-GCM

- Algoritmo **AES-256-GCM** (cifrado autenticado: confidencialidad + integridad vía tag).
- **Formato de columna:** `v1:iv:tag:ciphertext`, donde `iv`, `tag` y `ciphertext` van en **base64** y `v1` es el prefijo de versión de esquema (permite rotar algoritmo/llave sin ambigüedad y migrar filas viejas). El **IV es aleatorio por operación de cifrado** (12 bytes recomendados para GCM); nunca se reutiliza.
- **Llave:** `PII_ENCRYPTION_KEY` (32 bytes en base64). En local puede venir de `.env`; en **prod proviene de KMS / secret manager** (nunca en repo ni en imagen). El prefijo `v1` habilita rotación de llave por versión.
- **Dónde:** cifrar/descifrar ocurre **en la capa de servicio** (p. ej. un `PiiCryptoService` inyectable usado por `users`/`buylist`), no en el controlador ni en el cliente Prisma directo. Prisma persiste el string `v1:...` tal cual; la BD no conoce la llave.
- Firmas de referencia (pseudocódigo, no implementación):
  ```ts
  interface PiiCryptoService {
    encrypt(plaintext: string): string;            // -> "v1:iv:tag:ciphertext" (base64)
    decrypt(payload: string): string;              // valida tag GCM; lanza si fue manipulado
  }
  ```

#### b) Blind index — HMAC-SHA256 (`KycProfile.clabeHmac`)

- Problema que resuelve: la regla **"CLABE a nombre propio"** (`CLABE_NOT_OWN_NAME`) y la detección de la misma CLABE reusada requieren **igualar CLABEs sin descifrarlas**. El GCM con IV aleatorio es **no determinista** (dos cifrados de la misma CLABE dan distinto ciphertext), así que no sirve para buscar/igualar.
- Solución: `clabeHmac` = **HMAC-SHA256(clabe_normalizada, PII_HMAC_KEY)**, determinista, guardado junto al `clabeEnc`. El match se hace comparando HMACs.
- **Llave separada** `PII_HMAC_KEY` (distinta de `PII_ENCRYPTION_KEY`): así, comprometer una no habilita descifrar ni recomputar el índice de la otra; además el HMAC con llave evita ataques de diccionario sobre el espacio pequeño de CLABEs (10^18 pero enumerable).
- **Comparación en tiempo constante** (`crypto.timingSafeEqual`) para no filtrar coincidencias por temporización.
- Normalización previa (quitar espacios, validar 18 dígitos) antes del HMAC, para que la comparación sea estable.
- Firma de referencia:
  ```ts
  clabeBlindIndex(clabe: string): string;          // HMAC-SHA256 hex/base64, determinista
  ```

#### c) Enmascarado por defecto en todas las respuestas

- **Por defecto, toda respuesta enmascara PII**, en cliente y back-office, **incluido `super_admin`**. Coherente con el contrato (§preámbulo y endpoints `me/kyc`, `me/billing-profile`, `admin/buylist/:id`, `admin/users/:id`).
- Formato: **CLABE → `****1234`** (solo últimos 4 dígitos, campo `clabeMasked`); **RFC → parcial** (ej. `XAX**********`, campo `rfcMasked`). El servicio expone helpers `maskClabe()` / `maskRfc()` y los DTO **nunca** contienen el campo en claro ni el blob `*Enc`/`*Hmac`.
- **Única excepción:** `GET /admin/buylist/:id/reveal-clabe` — devuelve la **CLABE de 18 dígitos en claro**. Requisitos acumulativos:
  - rol **`super_admin`**,
  - **`MoneyOutGuard`** (misma puerta que pagos SPEI / reembolsos / recompra),
  - **auditado** en `AuditLog` (`action: buylist.reveal_clabe`, quién/cuándo/qué `SellRequest`),
  - **fallback:** si `SellRequest.clabeSnapshotEnc` falta, descifra la CLABE desde `KycProfile.clabeEnc` del usuario dueño.
- Este endpoint es el **único** punto de todo el sistema que devuelve CLABE en claro; su propósito es que el súper-admin la copie a su banca al ejecutar el SPEI manual.

#### d) Retención de imágenes de INE

- Las imágenes de INE (`KycProfile.ineFrontKey`, `ineBackKey`) son la PII de mayor sensibilidad y **no se necesitan indefinidamente** tras verificar KYC. Se purgan por **retención con dial**.
- **Dial** `INE_RETENTION_DAYS` (declarado en §8): antigüedad máxima de las imágenes de INE en el bucket.
- **Primera capa — job invocable** (BullMQ, en la familia de `jobs/`): recorre los `KycProfile` cuyas imágenes superan `INE_RETENTION_DAYS` desde su carga/verificación, **borra los objetos** (`ineFrontKey`/`ineBackKey`) del object storage, **limpia las columnas de key** (a `null`) y **audita** la purga (`action: kyc.ine_purged`, `AuditLog`). Es **invocable** (bajo demanda por súper-admin además de programado), idempotente y seguro de re-ejecutar.
- **Anclaje al cierre real (v1.8-ronda-c / SEC-D2):** la ventana de retención se cuenta desde el **cierre de la última `SellRequest`** del usuario (una vez sin solicitudes abiertas). El job usa **`SellRequest.closedAt`** (seteado al llegar a `pagada`/`rechazada`/`abandonada`, §3.2) como fecha de cierre — más preciso que la aproximación previa `max(paidAt,approvedAt,verifiedAt,receivedAt,createdAt)`, que para `rechazada`/`abandonada` caía en `createdAt` y **acortaba** la ventana. **Fallback:** si `closedAt` es `null` (filas cerradas antes de M-19), el job cae a la aproximación anterior — sin backfill obligatorio. La lógica: `closureDate = req.closedAt ?? max(paidAt, approvedAt, verifiedAt, receivedAt, createdAt)`.
- **Segunda capa — lifecycle del bucket:** regla de expiración en el object storage sobre el prefijo de INE, como red de seguridad si el job no corriera (defensa en profundidad; devops la configura).
- **Qué se conserva:** los **metadatos de KYC** (`kycStatus`, `verifiedBy`, `verifiedAt`, límites) permanecen — no se borra el perfil ni el historial de verificación; **solo se purgan las imágenes**. Tras la purga, el contrato sigue exponiendo `ineOnFile: boolean` (que pasará a `false`).

Notas de coherencia:
- El contrato (`API_CONTRACT.md`) **nunca** expone `*Enc`/`*Hmac` ni CLABE/RFC en claro fuera de `reveal-clabe`; §3.4 es el respaldo de esa promesa.
- La proyección reducida de `vault_operator` (sin CLABE/RFC/INE) opera **antes** del enmascarado: a ese rol no le llega ni el campo enmascarado sensible cuando el contrato así lo indica.

### 3.5 Estándar de condición del raw = solo Near Mint (NM)

- El raw se opera **únicamente en NM** en TODO el marketplace (Compra, inventario, filtros, buylist). El enum `RawCondition` queda reducido a `NM` (ver §3.2 InventoryItem y §11 Migraciones).
- **Nomenclatura legible (i18n del front, NO en la API):** el código `NM` es el único valor que viaja por el contrato. Los **labels/descripciones legibles viven en `frontend/src/i18n/messages/{es,en}.json`** (propiedad de frontend/ux-ui), no en el backend. Texto canónico de referencia que el front debe reflejar:
  - **ES:** `NM` = **"Casi nueva (Near Mint)"** — *"Como nueva; a lo mucho imperfecciones mínimas. Bordes limpios y superficie sin rayones notorios."*
  - **EN:** `NM` = **"Near Mint"** (espeja el texto ES).
- **Política de compra NM-only (buylist):** "Solo compramos cartas en Near Mint (NM); si al recibir/verificar no está en NM, no se compra." Copy visible en cotizador, guía de envío y términos (front). Carta recibida no-NM → `rechazada` (no se paga) → devolución 7 días a costo del usuario, abandono a 30 días; **una carta abandonada no-NM NO entra al inventario vendible** (se segrega/descarta). No existe grado distinto de NM que registrar; el "no-NM" es un resultado de verificación que **rechaza** el item, no un valor de `rawCondition`.

### 3.6 Sellado como línea de venta (productType=sealed)

- El sellado es una **línea de venta de primera clase** en Compra, distinta de raw/graded.
- **Sin `rawCondition`, sin `gradingCompany`/`gradeValue`, sin rareza** (no aplica taxonomía de carta individual). Puede referenciar un `Card`/`CardSet` para nombre/imagen del producto, pero no lleva condición ni rareza.
- **Precio SIEMPRE manual del admin en MXN**: no hay fuente automática en el MVP (pokemontcg.io no cubre sellado; PriceCharting = fase 2). El `listPriceCents` se fija a mano (override manual) y es **obligatorio para publicar**: sin precio, el sellado queda como "precio pendiente" y **no aparece en Compra** (regla general — el comprador nunca ve precio pendiente).
- `sealedSubtype?` (`box | etb | bundle | tin | blister`) opcional; alimenta el filtro de tipo de producto en Compra (subfaceta informativa).
- **Referencia de mercado del sellado (v1.19-sealed-tcgcsv, §4.19):** existe una fuente automática de **valor de
  referencia** para sellado — **TCGCSV** (espejo diario de precios de TCGplayer) — pero es **estrictamente informativa**
  (sugerencia para el admin en M1/M2 al fijar `listPriceCents`). **NO altera esta sección:** el precio de VENTA del
  sellado sigue siendo manual en MXN y obligatorio para publicar; la ficha pública no muestra la referencia TCGCSV en
  esta versión. El mapeo item↔producto TCGplayer es curación manual (`InventoryItem.tcgplayerProductId`, M-23).
- **Disputa de sellado (v1.2):** aplica a caja **dañada/equivocada** (no hay "condición NM" que comparar). **La evidencia se envía por correo a soporte** (no hay foto de ingreso ni comparador; ver §Dispute). El flujo reutiliza `Dispute` con `type=condition_sealed`.

---

### 3.7 Acabado / versión de carta (`Finish`) — v1.6-finish

Una misma `Card` puede existir en varios **acabados** (versiones de impresión). El acabado es una **dimensión de
primera clase** del precio, la cotización, el inventario y la valuación. **NO** rompe "1 fila por `Card`": los
acabados disponibles viven en `Card.availableFinishes` (array en la misma fila), y cada `InventoryItem`/
`SellRequestItem`/`PriceReference` referencia **un** acabado concreto.

**Enum canónico:** `Finish = normal | reverse_holo | holofoil | first_edition_holofoil`.

**Mapeo `tcgplayer.prices` (llave remota) → `Finish` (decisión del humano, PROJECT §I):**

| Llave `tcgplayer.prices` | `Finish` | Nota |
|---|---|---|
| `normal` | `normal` | |
| `reverseHolofoil` | `reverse_holo` | |
| `holofoil` | `holofoil` | |
| `1stEditionHolofoil` | `first_edition_holofoil` | |
| `1stEditionNormal` | *(no mapeada en el MVP)* | Se ignora al derivar `availableFinishes`. Ver pregunta abierta v1.4-1. |
| `unlimitedHolofoil` / `unlimited` | *(no mapeada en el MVP)* | Idem. |

- **Derivación de `availableFinishes`:** al importar (`upsertCards`, §4.8), se recorren las **llaves presentes**
  de `card.tcgplayer.prices`, se mapean con la tabla anterior (descartando las no mapeadas) y el conjunto único
  resultante se guarda en `Card.availableFinishes`. Si `tcgplayer.prices` está ausente/vacío → `[normal]`
  (default seguro). El `client` de pokemontcg.io **deja de descartar** `tcgplayer.prices` (§4.8).
- **Alcance por tipo de producto:** el acabado aplica a **raw/singles**. Para `graded`/`sealed` el `finish` es
  siempre `normal` (el slab/sellado no distingue acabado a efectos de precio); el default lo cubre y no cambia el
  comportamiento actual.
- **Validación (SEC-A1):** cualquier `finish` recibido del cliente (cotizador, alta de inventario) se **valida
  contra `card.availableFinishes`**; si no pertenece → `422 FINISH_NOT_AVAILABLE`. El monto/precio **nunca** se
  toma del cliente: se deriva server-side de `(Card.rarity, finish)` (§4.2).
- **Filas históricas / default:** `Card.availableFinishes=[normal]`, `InventoryItem.finish=normal`,
  `SellRequestItem.finish=normal`, `PriceReference.finish=normal`. El **re-sync** repuebla los reales.

## 4. Módulos y límites

### 4.1 PricingProvider (intercambiable)
Interfaz (pseudocódigo, en `modules/pricing`):
```ts
interface PricingProvider {
  readonly source: PriceSource;               // pokemontcg_io | pokemonpricetracker | poketrace | manual
  supports(productType: ProductType): boolean;
  // v1.6-finish: `finish` añadido al input. Devuelve precio USD (o MXN) del acabado pedido, o null.
  fetchPrice(input: { card: Card; productType: ProductType; gradeKey: string; finish: Finish }): Promise<PriceQuote | null>;
}
```
Implementaciones MVP:
- `PokemonTcgIoProvider` → raw/singles (TCGPlayer "Market Price" vía pokemontcg.io).
- `PokemonPriceTrackerProvider` / `PokeTraceProvider` → graded y sealed (free tier).
- `ManualOverrideProvider` → override del admin (siempre disponible como respaldo).

**v1.6-finish — precio POR acabado:** `PokemonTcgIoProvider.fetchPrice` mapea `finish → llave de
`tcgplayer.prices` (inverso de la tabla §3.7: `normal→normal`, `reverse_holo→reverseHolofoil`,
`holofoil→holofoil`, `first_edition_holofoil→1stEditionHolofoil`) y lee **ese** `prices[llave].market`
(antes tomaba el **primer** market disponible, mezclando acabados). Si esa llave no existe → `null` →
"precio pendiente" para ese acabado. Los providers de `graded`/`sealed` ignoran `finish` (siempre `normal`).

`PricingService` orquesta:
1. Elige provider según `productType` leyendo el dial de M10 (`pricing_provider_*`).
2. **Solo pricea cartas en bóveda** (no el catálogo completo) y con **cache diario** (revisa `PriceReference` del día **para ese acabado** antes de llamar la API). **`getReference(cardId, productType, gradeKey, finish)`** y **`syncCardPrice(card, productType, gradeKey, finish, context, refId?)`** ganan `finish`; el upsert/lookup usa la clave compuesta con `finish` (§3.2 PriceReference). `buildGradeKey` NO cambia (el finish es parámetro aparte).
3. Aplica **FX + colchón** (`FxService`) para obtener `priceMxnCents`.
4. Si el provider devuelve `null` y no hay override → crea `PendingPriceEntry` **por acabado** y expone el estado **"precio pendiente"** (no vendible; escalado al dueño).
5. Respeta rate-limit del free tier vía cola BullMQ.

**v1.8-ronda-c — cola de precio pendiente POR ACABADO:** `PendingPriceEntry` gana `finish` (§3.2, M-19) y las dos rutinas de la cola lo incorporan a la llave:
- **`escalatePending(cardId, productType, gradeKey, finish, context, refId?)`** dedupe por `(cardId, productType, gradeKey, finish, status='open')`. **Corrección de implementación (BE):** hoy `syncCardPrice` invoca `escalatePending` **sin** pasar `finish` (bug: colapsa acabados) — con M-19 debe **propagar** el `finish` del `syncCardPrice`.
- **`manualOverride(cardId, productType, gradeKey, priceMxnCents, finish='normal')`** ya crea la `PriceReference` del acabado correcto (clave con `finish`), pero su `updateMany` que **resuelve** pendientes filtraba `{cardId, productType, gradeKey, status:'open'}` **sin `finish`** → cerraba TODOS los acabados. Con M-19 el `updateMany` **añade `finish`**, resolviendo **solo** el pendiente de ese acabado (el de `holofoil` sigue abierto hasta que se le fije precio). `getReference(...finish)` no cambia (ya era por-acabado); no se rompe SEC-A1 (los montos siguen derivándose server-side de `(Card.rarity, finish)`).

### 4.2 AcquisitionPricer (buylist) — tabla de precio por RAREZA OFICIAL (v1.3.1)

> **Reemplaza** el esquema de 3 categorías (`RARITY_MAP` + `BuylistCategory`). El monto a pagar por el buylist
> se resuelve con una **regla por rareza oficial de Pokémon** (la de `Card.rarity`, tal cual pokemontcg.io),
> editable desde **M2** sin redeploy. PROJECT.md §E.1, criterios 12/12b/12c/18.

**Modelo de config (diales M2, persistidos en `ConfigSetting`):**
- `BUYLIST_PRICE_RULES` (`buylist_price_rules`): mapa **`{ [rarity: string]: BuylistRule }`** donde
  `BuylistRule = { mode: 'fixed' | 'pct', value: number }`.
  - `mode='fixed'` → `value` = **monto MX$ en centavos** (entero ≥ 0). **No requiere** referencia de mercado → siempre cotiza.
  - `mode='pct'`  → `value` = **porcentaje** (número en `[0, 100]`) del **precio de referencia** del día.
- `BUYLIST_PRICE_FALLBACK_PCT` (`buylist_price_fallback_pct`): **porcentaje** (default **40**) que se aplica a
  cualquier rareza **sin regla explícita** (rareza nueva tras un sync, o no configurada). Es un `pct` implícito.

**Función pura (pseudocódigo — reemplaza a `quoteAcquisition(category, ref)`):**
```ts
type BuylistRuleMode = 'fixed' | 'pct';
interface BuylistRule { mode: BuylistRuleMode; value: number; }   // value = cents si fixed, % si pct

function quoteAcquisition(
  rarity: string | null,
  referenceMxnCents: number | null,
  rules: Record<string, BuylistRule>,       // BUYLIST_PRICE_RULES
  fallbackPct: number,                       // BUYLIST_PRICE_FALLBACK_PCT (default 40)
): { quotedPriceCents: number|null; status: 'cotizada'|'precio_pendiente';
     appliedRule: BuylistRule; ruleSource: 'rule'|'fallback'; } {
  // 1) Busca regla por la RAREZA OFICIAL real (exact match sobre Card.rarity).
  const explicit = rarity != null ? rules[rarity] : undefined;
  const rule: BuylistRule = explicit ?? { mode: 'pct', value: fallbackPct };  // sin regla → fallback %
  const ruleSource = explicit ? 'rule' : 'fallback';

  // 2) FIXED: monto fijo en centavos; nunca depende de la referencia → siempre 'cotizada'.
  if (rule.mode === 'fixed') {
    return { quotedPriceCents: rule.value, status: 'cotizada', appliedRule: rule, ruleSource };
  }
  // 3) PCT: % de la referencia; si falta referencia → 'precio_pendiente' (escala al dueño, nunca se descarta).
  if (referenceMxnCents == null) {
    return { quotedPriceCents: null, status: 'precio_pendiente', appliedRule: rule, ruleSource };
  }
  return { quotedPriceCents: Math.round(referenceMxnCents * rule.value / 100),
           status: 'cotizada', appliedRule: rule, ruleSource };
}
```

**SEC-A1 (guardarraíl intacto):** la `rarity` que determina el monto se **deriva server-side de la carta real**
(`Card.rarity` por `cardId`), **nunca** del DTO del cliente. Un DTO malicioso no puede elegir regla ni inflar el
monto; el cliente ya **no envía** `category` (removida del contrato). La **condición de compra es siempre NM**
(§3.5); no hay grados que discriminen la tarifa.

**Fallback = % default (decisión del humano, PROJECT §E.1 / pregunta abierta 2 resuelta):** una rareza sin regla
**no** deja la carta en "precio pendiente" por sí sola; se cotiza con `BUYLIST_PRICE_FALLBACK_PCT`. Solo cae en
**"precio pendiente"** si la regla efectiva es `pct` **y** falta la referencia de mercado (`referenceMxnCents ==
null`). Las reglas `fixed` **nunca** quedan pendientes (no dependen de la referencia). El "precio pendiente" es un
estado de adquisición/back-office (`SellItemStatus=precio_pendiente`, escala al dueño vía `PendingPriceEntry`) y
**nunca** se muestra al comprador (regla de Compra, §4.9).

**Seed inicial (preserva el negocio vigente; editable por el dueño en M2):**
```jsonc
// BUYLIST_PRICE_RULES
{
  "Common":       { "mode": "fixed", "value": 50  },   // MX$0.50
  "Uncommon":     { "mode": "fixed", "value": 50  },   // MX$0.50
  "Reverse Holo": { "mode": "fixed", "value": 150 }    // MX$1.50
}
// BUYLIST_PRICE_FALLBACK_PCT = 40
```
Todo lo demás (Rare Holo, EX/GX/V/VMAX/VSTAR, Ultra Rare, Illustration Rare, Special Illustration Rare, Full Art,
Alternate Art, Trainer Gallery, Character Rare, Radiant, Hyper/Secret/Rainbow, etc.) **cae al fallback = 40% de la
referencia**, reproduciendo el resultado del antiguo `ex_plus`. **Granularidad por rareza (pregunta abierta 3
resuelta):** cada fila tiene su propio `value`, así que el dueño puede fijar un % distinto por rareza (ej.
Illustration Rare 45%, Secret Rare 35%) sin tocar código; el default es 40% para todas las de porcentaje.

**NOTA para PO/humano (rareza `Rare` no-holo):** el `RARITY_MAP` legacy mapeaba `Rare` (no-holo) → `comun`
($0.50 fijo). El seed v1.3.1, siguiendo la instrucción "todo lo demás = 40%", **no** siembra `Rare` como fixed,
así que por defecto `Rare` cae al fallback 40%. Si el negocio quiere conservar $0.50 fijo para `Rare`, el dueño
añade una fila `"Rare": { mode: "fixed", value: 50 }` en M2 (cambio de dato, sin deploy). Cambio deliberado y
reversible desde el editor.

**Alcance = solo buylist (pregunta abierta 4 resuelta):** esta tabla afecta **únicamente** la cotización de
compra al usuario (buylist). El **costo de aportación en especie** del inventario propio sigue usando su dial
propio (`aportacion_pct`, default 70%); no se toca.

#### 4.2.1 Cotización POR ACABADO (v1.6-finish)

La cotización es **por acabado**. El `finish` seleccionado (validado contra `card.availableFinishes`, SEC-A1)
determina **dos cosas de forma determinista y server-side**: (a) **qué regla** de `BUYLIST_PRICE_RULES` aplica y
(b) **qué referencia de mercado** usa el `pct` (la `PriceReference` de ESE acabado, §4.1). El mapeo (decisión del
humano, PROJECT §I) se implementa como una **cadena de candidatos de `ruleKey`** — gana el **primero con regla
explícita**; si ninguno existe → `BUYLIST_PRICE_FALLBACK_PCT`:

```ts
type Finish = 'normal' | 'reverse_holo' | 'holofoil' | 'first_edition_holofoil';

// Una rareza "ya es holo" si su string (pokemontcg.io) contiene "holo" (case-insensitive):
// "Rare Holo", "Rare Holo EX/GX/V/VMAX/VSTAR"… (NO "Ultra Rare"/"Illustration Rare", que caen al fallback igual).
function isHoloRarity(rarity: string | null): boolean {
  return rarity != null && rarity.toLowerCase().includes('holo');
}

// Fase 0.1 (fix bug de dinero) — clasificador de rareza PREMIUM (chase / alto valor). Case-insensitive,
// por substrings/tokens representativos (la taxonomía de pokemontcg.io es abierta). Ver definición
// canónica y lista de patrones abajo ("Contrato de pricing: isPremiumRarity"). Una rareza premium NUNCA
// puede resolver a un bin fijo barato de bulk (la clave sintética "Holo" ni ninguna regla `fixed` de bulk):
// solo su PROPIA regla explícita o el fallback pct (% de mercado). Se prefiere sobre-incluir (una carta
// barata clasificada premium solo pasa a "% de mercado", inocuo) que sub-incluir (una chase tratada como
// bulk = pérdida de dinero).
function isPremiumRarity(rarity: string | null): boolean {
  if (rarity == null) return false;
  const s = rarity.toLowerCase();
  return PREMIUM_RARITY_PATTERNS.some((re) => re.test(s));  // patrones abajo
}

// Candidatos de ruleKey EN ORDEN DE PRIORIDAD (primero con regla explícita en BUYLIST_PRICE_RULES gana).
// Fase 0.1: la RAREZA REAL va SIEMPRE primero; para holofoil/1st-ed una rareza PREMIUM NO incluye "Holo".
function ruleKeyCandidates(rarity: string | null, finish: Finish): string[] {
  switch (finish) {
    case 'reverse_holo':            return ['Reverse Holo'];                                  // siempre la regla "Reverse Holo"
    case 'holofoil':
    case 'first_edition_holofoil':
      // GATE PREMIUM: una rareza chase (ex/full art/Illustration/Ultra/Double Rare, V/VMAX/VSTAR/GX…) NUNCA
      // cae al bin fijo barato de bulk. Solo su propia regla explícita o el fallback pct (% de mercado).
      if (isPremiumRarity(rarity)) return [rarity!];                                          // premium → SOLO su regla; NUNCA "Holo"
      return isHoloRarity(rarity) ? [rarity!, 'Holo'] : ['Holo'];                             // no-premium: holo de bulk → rareza real, luego "Holo"; Common/Uncommon → "Holo"
    case 'normal':                  return rarity != null ? [rarity] : [];                     // regla de la rareza base
    default:                        return [];
  }
}

// referenceMxnCentsForFinish = PriceReference.priceMxnCents del ACABADO cotizado (getReference(..., finish)).
function quoteAcquisitionForFinish(
  rarity: string | null, finish: Finish,
  referenceMxnCentsForFinish: number | null,
  rules: Record<string, BuylistRule>, fallbackPct: number,
) {
  const candidates = ruleKeyCandidates(rarity, finish);
  const hitKey = candidates.find((k) => rules[k] != null);
  const rule = hitKey ? rules[hitKey] : { mode: 'pct', value: fallbackPct };
  const ruleSource: 'rule' | 'fallback' = hitKey ? 'rule' : 'fallback';
  // De aquí en adelante idéntico a quoteAcquisition (§4.2): fixed → value (siempre 'cotizada');
  // pct → round(referenceMxnCentsForFinish × value/100), o 'precio_pendiente' si la referencia del acabado falta.
  return applyRule(rule, ruleSource, referenceMxnCentsForFinish);
}
```

**Contrato de pricing: `isPremiumRarity` (Fase 0.1, 2026-08-17) — parte de la fuente de verdad.** El gate premium
es **parte del contrato de pricing** (no un detalle de implementación): define qué rarezas jamás pueden cotizar al
bin fijo barato de bulk. Se evalúa case-insensitive sobre `Card.rarity` con esta **lista canónica de patrones**
(substrings/tokens; `\b` = límite de token):

| Patrón | Cubre |
|---|---|
| `illustration` | Illustration Rare, Special Illustration Rare |
| `ultra\s*rare` | Ultra Rare (full art) |
| `double\s*rare` | Double Rare (= ex, era Scarlet & Violet) |
| `secret` | Rare Secret / Secret Rare |
| `rainbow` | Rainbow Rare |
| `hyper` | Hyper Rare |
| `full\s*art` | Full Art |
| `alt(ernate)?\s*art` | Alternate Art / Alt Art |
| `special` | Special Illustration Rare, etc. |
| `amazing` | Amazing Rare |
| `radiant` | Radiant |
| `shiny` | Rare Shiny / Shiny Ultra Rare |
| `trainer\s*gallery` | Trainer Gallery |
| `character` | Character Rare / Super Rare |
| `gold` | Gold (secret) Rare |
| `prism` | Prism Star |
| `\b(v\|vmax\|vstar\|vunion\|v-union\|ex\|gx)\b` | V-series y EX/GX como tokens sueltos (p. ej. "Rare Holo VMAX") |

**NO premium (bulk legítimo, excluidas a propósito):** Common, Uncommon, Rare (no-holo), Rare Holo (plano),
Reverse Holo. Criterio de diseño: **sobre-incluir es inocuo** (una carta barata mal clasificada como premium solo
pasa a "% de mercado"), **sub-incluir cuesta dinero** (una chase tratada como bulk cotiza al bin fijo barato). Si un
sync trae una rareza chase nueva no cubierta, cae al **fallback pct** por ser rareza sin regla explícita — nunca al
bin fijo.

**Por qué el gate premium (fix del bug de dinero, Fase 0.1):** las cartas chase modernas (ex, Full Art, Illustration
Rare, V/VMAX/VSTAR…) **solo existen en holofoil**, pero su string de rareza **no** contiene "holo". Antes, el
candidato para holofoil de una rareza no-holo era `['Holo']`; con una regla `"Holo"` fija barata de bulk (la que el
admin puede sembrar), esas chase de miles de pesos cotizaban al bin fijo (**"$1.50 cotizada"**) — bug estructural de
dinero. El gate cierra esa vía: **una rareza premium en holofoil/1st-ed solo resuelve a su propia regla explícita o
al fallback pct (% de mercado)**, jamás a `"Holo"` ni a ningún `fixed` de bulk. La rareza real va **siempre primero**
en los candidatos.

**Por qué la guarda `isHoloRarity` (no-premium) en Holofoil:** para rarezas **no-premium**, sin la guarda un
**Common en Holofoil** resolvería a la regla `"Common"` (fixed $0.50 bulk) por ser el primer candidato —
**incorrecto**: una copia holofoil vale un % de su market. Con la guarda, para rarezas NO-holo y NO-premium
(Common/Uncommon/Rare no-holo) el Holofoil salta directo a `"Holo"` (no sembrada por defecto → **fallback 40%** del
market **holofoil**), y solo una rareza **ya holo** (p. ej. "Rare Holo" plano) con regla explícita usa su propia
regla. Para rarezas holo de bulk sin regla explícita, ambos candidatos caen al fallback 40% (mismo resultado).

**Resultado con el seed vigente (defaults):**

| `Card.rarity` | `finish` | ¿premium? | ruleKey resuelto | Regla | Monto |
|---|---|---|---|---|---|
| Common | `normal` | no | `Common` | fixed 50 | **$0.50** |
| Common | `reverse_holo` | no | `Reverse Holo` | fixed 150 | **$1.50** |
| Common | `holofoil` | no | `Holo` (no sembrada) → fallback | pct 40 | **40% del market holofoil** |
| Illustration Rare | `normal` | sí | `Illustration Rare` (no sembrada) → fallback | pct 40 | **40% del market normal** |
| Illustration Rare | `holofoil` | **sí** | `Illustration Rare` (no sembrada) → fallback — **nunca `"Holo"`** | pct 40 | **40% del market holofoil** |
| Rare Holo ex | `holofoil` | **sí** | `Rare Holo ex` (no sembrada) → fallback — **nunca `"Holo"`** | pct 40 | **40% del market holofoil** |
| Rare Holo | `holofoil` | no | `Rare Holo`→`Holo` (ninguna sembrada) → fallback | pct 40 | **40% del market holofoil** |
| cualquiera | `first_edition_holofoil` | igual que `holofoil` | — | — | **% del market `1stEditionHolofoil`** |

> **Blindaje del gate (antes vs. ahora):** si el admin sembrara `"Holo"` como `fixed` barato (bin de bulk), **antes**
> una `Illustration Rare`/`ex` en holofoil habría cotizado a ese fijo (bug); **ahora** el gate premium la mantiene en
> su propia regla o el fallback pct, así que **nunca** cae al bin de bulk aunque exista una regla `"Holo"` fija.

**Decisión (2026-08-17): Common/Uncommon en `holofoil` = SE MANTIENE "% del market holofoil" (opción a, sin cambio
de código).** Punto abierto que dejó backend en Fase 0: la regla verbal del humano fue *"solo Common/Uncommon son
precio FIJO de bulk"*, pero el diseño ACTUAL (esta §4.2.1, con tests) cotiza **Common/Uncommon en holofoil** como
**% del market holofoil** vía el candidato `['Holo']` (no como su `fixed` de bulk). Backend **preservó** el diseño
actual para no romper el contrato por su cuenta y escaló la decisión al arquitecto. **Se resuelve mantener el diseño
actual (a).** Justificación:
> - **El caso es marginal por construcción.** `Card.availableFinishes` se **deriva de las llaves de
>   `tcgplayer.prices`**; una Common/Uncommon casi nunca tiene la llave `holofoil` (imprimen en `normal` y
>   `reverseHolofoil`). El guardarraíl **SEC-A1 / `422 FINISH_NOT_AVAILABLE`** bloquea cotizar `holofoil` para una
>   carta que no lo tiene, así que en la práctica el par (Common, holofoil) casi no ocurre.
> - **Cuando SÍ ocurre, "% del market holofoil" es la valuación correcta, no un bug.** Una copia genuinamente
>   holofoil de una común tiene market propio (> $0.50) y vale un % de ese market; llevarla al `fixed` $0.50 de bulk
>   la **sub-cotizaría**. La regla verbal "$0.50 fijo" se pensó para la común **de bulk** (normal/reverse), no para
>   una impresión holofoil atípica. El precio se sigue derivando server-side del market real (SEC-A1 intacto).
> - **La alternativa (b)** — mover Common/Uncommon holofoil a `fixed` de bulk — implicaría **tarea de backend**
>   (nuevo candidato/lógica) y riesgo de sub-cotizar el caso raro, sin beneficio de negocio. **No se pide.**
>
> **Consecuencia:** no hay cambio de código ni de contrato por este punto; **Fase 0 queda cerrable** en lo que
> respecta al arquitecto. Si el humano insistiera en `fixed` de bulk también para el holofoil de comunes, sería un
> requisito nuevo de PROJECT.md que se enrutaría a backend vía el flujo normal (arquitecto → contrato → backend).

**Claves sintéticas vs rareza real:** `"Reverse Holo"` y `"Holo"` son **ruleKeys sintéticos** del acabado (no son
`Card.rarity`); conviven en `BUYLIST_PRICE_RULES` con las rarezas reales. `"Reverse Holo"` viene **sembrado**
(fixed $1.50); `"Holo"` **no** (→ fallback 40%), pero el dueño puede añadirlo en M2 sin deploy. Esto **cierra la
brecha** del v1.3.1, donde `"Reverse Holo"` solo aplicaba si `Card.rarity` era literalmente esa cadena (raro); ahora
aplica cuando el **acabado** es reverse holo, que es el caso típico ("esta común la traigo en reverse").

**"Precio pendiente" por acabado (criterio 43):** una carta con regla efectiva `pct` cuyo **acabado no tiene
referencia** (`getReference(..., finish)` = null) cae en `precio_pendiente` (escala al dueño), igual que hoy; las
reglas `fixed` siempre cotizan. `SellRequestItem` snapshotea `finish` + la regla aplicada.

**1st Edition (decisión):** `first_edition_holofoil` mapea a la **misma regla** que `holofoil` (acabado
equivalente), usando el **market de la llave `1stEditionHolofoil`**. Sin regla propia "1st Edition" en el MVP
(pregunta abierta v1.4-2, default asumido); si el dueño la quisiera, se añade un ruleKey dedicado en M2.

### 4.3 Integración Stripe (payments)
- Checkout crea `PaymentIntent` (o Checkout Session) con líneas: subtotal, **fee de procesamiento trasladado**, **IVA 16%**. El total cobrado incluye ambas.
- Webhooks (endpoint único, firma verificada con `STRIPE_WEBHOOK_SECRET`). Detalle de estados en §3.3 y en `API_CONTRACT.md §9`:
  - `payment_intent.succeeded` → `Order.status=settled`, `ownershipStatus=settled` (o liquida el envío).
  - `payment_intent.payment_failed` / `payment_intent.canceled` → libera la reserva de compra o cancela el envío en `solicitado`.
  - `charge.refunded` → **total** ⇒ `Order.status=refunded`; **parcial** ⇒ no cambia el estado (conciliación M7). En ningún caso re-agrega el item (VENTAS FINALES).
  - `charge.dispute.created` → `Order.status=chargeback`, **consciente del estado físico**: revierte el item **solo si sigue en bóveda**; si ya se envió/entregó marca `chargebackNeedsManual` sin re-agregar.
  - `charge.dispute.closed` / `charge.dispute.funds_reinstated` → cierre: ganamos ⇒ `settled` (`disputeOutcome=won`), perdemos ⇒ `chargeback` (`disputeOutcome=lost`).
- Idempotencia por `event.id` (tabla `ProcessedStripeEvent`) para no reprocesar; el evento se marca procesado **solo tras éxito** del handler (si falla, se re-lanza y Stripe reintenta).
- El **fee trasladado** se calcula con gross-up para que la plataforma reciba neto ≈ subtotal+IVA (fórmula exacta: ver Preguntas para el humano).

### 4.4 Back-office M1–M10
Mapa módulo→endpoint en `API_CONTRACT.md §admin`. Autorización por rol/acción (§7).

### 4.5 i18n
Ver §6. El backend expone **enums y `errorCode`s**, no textos traducidos.

### 4.6 Generación de folios y ubicaciones
- Folio: secuencia Postgres `inventory_folio_seq` → formato `INV-` + zero-pad 6 (`INV-000123`). Se asigna al crear el `InventoryItem` en transacción para evitar colisiones.
- Ubicación: `VaultLocation` con `(zone, box, row, slot)` único; `label` derivado para picking legible.

### 4.7 Login con Google (OAuth / ID token)
- Endpoint `POST /api/v1/auth/google` recibe `{ idToken }` (Google Identity Services, flujo del front con `NEXT_PUBLIC_GOOGLE_CLIENT_ID`).
- **Verificación server-side obligatoria** del ID token antes de emitir JWT propios (usar `google-auth-library` o verificación JWKS equivalente). Se validan:
  - **firma** contra las llaves públicas de Google (JWKS),
  - `aud` == `GOOGLE_CLIENT_ID` (env backend),
  - `iss` ∈ `{ accounts.google.com, https://accounts.google.com }`,
  - `exp` no expirado,
  - `email_verified == true` (si no, `403 GOOGLE_EMAIL_UNVERIFIED`).
- Del token verificado se toman `sub` (→ `googleId`), `email`, `name`, `picture` (→ `avatarUrl`). **Nunca** se toma `role` ni ningún privilegio del token.
- Flujo: buscar por `googleId`; si no, por `email` verificado (account-linking, §3.2); si no existe, **crear** `User` (`authProvider=google`, `role=customer`, `emailVerified=true`, `passwordHash=null`).
- Respuesta: **mismo shape que `/auth/login`** → `{ user, accessToken, refreshToken }`. A partir de ahí la sesión es idéntica a la de email/contraseña (mismos JWT, mismos guards).
- El linking se audita (`AuditLog action=auth.google_link`). Env: `GOOGLE_CLIENT_ID` (backend), `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (front) — ver §8.

### 4.7bis Gestión de usuarios por admin (M6, `super_admin`) — reset de contraseña sin correo + borrado híbrido (v1.3.1)

Dos capacidades de M6, ambas **solo `super_admin`** y **auditadas** (M10); ninguna es dinero saliente (no
requieren `MoneyOutGuard`), pero **sí** tocan credenciales/PII, así que su registro en `AuditLog` guarda **solo
IDs/flags, nunca el secreto ni la PII**.

**a) Reset de contraseña iniciado por admin (SIN email transaccional).** `POST /admin/users/:id/reset-password`.
El MVP no manda correos, así que el admin **genera** una contraseña temporal y **se la entrega al usuario por su
propio canal**. Implementación:
- Genera un secreto de **alta entropía** (p. ej. ≥ 16 chars aleatorios de un alfabeto seguro / `crypto`), lo
  **hashea con argon2** (misma rutina que `/auth/register`) y lo guarda en `passwordHash`.
- **Devuelve `tempPassword` en claro UNA sola vez** en la respuesta; **nunca** se persiste en claro, no se
  re-consulta, no se loguea, no entra al `AuditLog` (solo `action=user.reset_password`, actor y target).
- **Revoca sesiones vivas** incrementando `User.tokenVersion` (los refresh/access con versión previa dejan de ser
  válidos). Setea `mustChangePassword=true` (opcional de consumir por el front: tras el primer login, forzar
  "cambiar contraseña"). Si el repo aún **no** versiona tokens, backend implementa `tokenVersion` en este cambio
  (parte de M-15) o lo registra como deuda menor en `TECH_DEBT.md`.
- Habilita login local incluso en cuentas solo-Google (`passwordHash` pasa de null a hash).

**b) Borrado de usuario híbrido hard/soft.** `DELETE /admin/users/:id`. Decide el modo según **si el usuario tiene
historial económico**:
- **Predicado "tiene transacciones"** = existe ≥ 1 fila en `Order` **o** `SellRequest` **o** `ShipmentRequest`
  **o** `Dispute` **o** `InventoryItem(ownerUserId=:id)`. Las relaciones no económicas
  (`Address`/`BillingProfile`/`KycProfile`/`PortfolioSnapshot`) no cuentan (se borran/anonimizan en ambos modos).
- **HARD** (predicado falso): `DELETE` real del `User`; los dependientes con `onDelete: Cascade`
  (`KycProfile`/`BillingProfile`/`Address`/`PortfolioSnapshot`) caen por cascada. Se purga la **imagen de INE**
  del object storage (reusa la rutina de purga §3.4d) antes/junto al borrado.
- **SOFT** (predicado verdadero): conserva las filas económicas por integridad contable/legal y auditoría; marca
  `status=deleted`, `deletedAt`, `anonymizedAt`, revoca tokens (`tokenVersion++`), `passwordHash=null`. **Anonimiza
  PII**: `email`→placeholder único (`deleted+<uuid>@anon.invalid`), `name`→`"Usuario eliminado"`,
  `phone`/`avatarUrl`/`googleId`→null; en `KycProfile`/`BillingProfile` borra `clabeEnc`/`clabeHmac`/`rfcEnc`/
  `legalName` y purga INE; conserva solo metadatos no-PII. Los snapshots económicos históricos
  (`billingSnapshot`, `clabeSnapshotEnc`) no se reescriben salvo mandato legal (bandera para seguridad/legal).
- **Idempotente** (re-`DELETE` sobre soft-deleted = no-op `mode:"soft"`); `409 CANNOT_DELETE_SELF` si el actor es
  el propio usuario. Auditado (`action=user.delete`, con `mode`).

**Enum:** `UserStatus` gana el valor **`deleted`** (M-15). `PATCH /admin/users/:id/status` sigue aceptando solo
`active|blocked`; a `deleted` se llega **únicamente** por el `DELETE` (soft). El guard de auth y ambos endpoints de
login tratan `deleted` como no-autenticable (`403 USER_BLOCKED`).

**c) Alta de usuario por rol (v1.7-admin-users).** `POST /admin/users` — **solo `super_admin`**, **auditado**
(`action=user.create`), **NO money-out**. Cubre el hueco de que hoy no hay alta en back-office (customer se
auto-registra; staff por seed). Implementación (`AdminService.createUser`, patrón de `AdminUsersController`):
- **Validación DTO:** `email` (IsEmail, se **lowercasea** antes de crear/validar unicidad, como `auth.service.ts`
  register), `name` (**required**, `User.name` NOT NULL), `role` (`@IsIn(customer|vault_operator|super_admin)`),
  `password?` (`MinLength 8` si viene), `phone?`, `locale?` (`es|en`, default `es`). **Sin** KYC/CLABE/INE (datos
  self-service; no se crea `KycProfile`/`BillingProfile`).
- **Contraseña:** si el DTO trae `password`, se **hashea con argon2** (misma rutina que register) y
  `mustChangePassword=false`. Si **no** trae `password`, se **autogenera** una temporal de **alta entropía** reusando
  la rutina del reset M-15 (`randomBytes(18).toString('base64url')`), se hashea con argon2, `mustChangePassword=true`,
  y el claro se devuelve **una única vez** en `tempPassword` (**nunca** persistido en claro, **nunca** en `AuditLog`).
- **`emailVerified`:** nace **`true`** para **cualquier** rol creado por admin (staff como el seed; el customer creado
  por admin porque el admin da fe de la identidad). **No** se emite `AuthToken` de verificación ni se envía correo
  (paridad con el reset admin, que tampoco manda correo). `authProvider='local'`.
- **Colisión de email:** `P2002` (unique de `email`) → **`409 EMAIL_TAKEN`** (mismo mapeo que register).
- **Respuesta:** shape público (`publicUser` extendido con `status`/`authProvider`/`createdAt`) + `tempPassword?` +
  `mustChangePassword`. Sin `passwordHash`.
- **Escalada de privilegios:** crear un `super_admin` eleva privilegios; el **control autoritativo** es
  super_admin-only (el guard rechaza `vault_operator` con `403 FORBIDDEN`) **+ auditoría** (`user.create` con actor,
  `entityId`=nuevo usuario, y `role` creado en `after`; **sin** volcar la contraseña, coherente con §3.2 "PII/secretos
  nunca en before/after"). Se permite en el MVP porque ese doble control es suficiente (no se restringe el enum).

### 4.7ter Historial 360° por usuario (M6, v1.7-admin-users) — reuso de listados + auditoría

Enfoque **REUSO**: no se engorda `AdminService.getUser` (que sigue devolviendo las últimas 20 de
orders/sellRequests/disputes + bóveda como resumen). El historial **completo** se sirve por listados ya paginados
y una nueva traza de auditoría.

**c) Bóveda del usuario — `ownedItems` enriquecido (v1.8-ronda-c / BE-10).** La proyección `AdminUserOwnedItemRef`
que devuelve `getUser().ownedItems` gana **`finish: Finish`** y **`referenceValue: PriceInfo`** (mismo shape que el
`HoldingDTO` del cliente, §3). El backend puebla `referenceValue` **reusando** `PricingService.getReference(item.cardId,
item.productType, buildGradeKey(item), item.finish)` — la **misma valuación por-acabado** que ya alimenta la bóveda del
cliente; no se recalcula nada nuevo. Los items sin precio del día se devuelven con `referenceValue.status="pending"`
(no se excluyen: esta es una vista 360° de back-office, no un total de portafolio). **Decisión (enriquecer el ref, NO
endpoint nuevo):** se enriquece `ownedItems` en lugar de añadir `GET /admin/users/:id/holdings` paginado porque (1) la
bóveda por usuario es **acotada** (las cartas en custodia de UN usuario), (2) `getUser` **ya** incluye `ownedItems`, así
que solo se añaden dos campos por item reusando `getReference`, y (3) evita un endpoint y un consumidor de frontend
nuevos. **Coste:** N llamadas a `getReference` (una por item de la bóveda del usuario); para bóvedas grandes conviene
un `Promise.all` / lectura batch de `PriceReference` del día. **Evolución futura (no ahora):** si una bóveda por usuario
creciera lo suficiente para volver pesado el `getUser`, se migraría a `GET /admin/users/:id/holdings` paginado que
reuse `VaultService.holdings()`; queda documentado como puerta abierta, sin implementarse en Ronda C.

**a) `?userId=` en los listados admin.** `GET /admin/buylist`, `GET /admin/shipments` y `GET /admin/disputes`
ganan una query **opcional** `userId` (simetría con `GET /admin/orders`, que ya lo tiene desde M3). Cada uno filtra
por su FK directa (`SellRequest.userId` / `ShipmentRequest.userId` / `Dispute.userId`) añadiendo `where.userId` en
`adminList`. **No cambia** el guard (`vault_operator+`) ni la proyección PII por rol (p. ej. la CLABE del buylist
sigue enmascarada en el list; en claro solo por `reveal-clabe`). Paginado estándar `{ data, page, pageSize, total }`.

**b) `GET /admin/users/:id/audit` (nuevo).** Traza de `AuditLog` de/ sobre el usuario, paginada. Reusa el patrón de
consulta del M10 audit-log (`settings.controller`), acotado:
- **`scope`** (default `target`): `target` → `where { entityType:'User', entityId:id }` (acciones **sobre** el
  usuario); `actor` → `where { actorUserId:id }` (acciones **del** usuario); `both` → `where { OR: [...] }`.
- **Proyección expuesta:** `id, actorUserId, actorRole, action, entityType, entityId, createdAt` y **`ip` solo para
  `super_admin`** (el `select` añade `ip` condicionalmente por rol). **`before`/`after` NUNCA** se seleccionan (evita
  filtrar PII/estado, incluso de las acciones que sí los pueblan).
- **Roles:** clase `AdminUsersController` es `vault_operator+`, así que ambos acceden; **`vault_operator` recibe la
  proyección reducida sin `ip`** (dato investigativo reservado al súper-admin). `404 NOT_FOUND` si el usuario no
  existe. Sin migración (solo lectura de `AuditLog`).

### 4.8 Sync de catálogo desde pokemontcg.io (M2) — `super_admin`, auditado
Ingesta de **datos de catálogo** (Card/CardSet, en inglés, no se traduce). Alimenta las facetas de Compra (§4.9). Endpoints en `API_CONTRACT.md §M2`. Servicio `CatalogSyncService` en `modules/catalog`.
- **`GET /admin/catalog/remote-sets`**: consulta `/v2/sets` de pokemontcg.io; devuelve `[{ id, name, series, releaseDate, printedTotal, imported, cardCount }]` ordenado por `releaseDate` desc. `imported` = si ya existe el `CardSet` local (join por `externalId`); `cardCount` = cartas locales del set.
- **`POST /admin/catalog/sync`** body `{ setId?, fromReleaseDate? }`: importa/actualiza cartas.
  - `setId` presente → importa ese set puntual (query `q=set.id:<setId>`).
  - sin `setId` → importa todos los sets con `releaseDate >= fromReleaseDate`; **default `fromReleaseDate` = dial `catalog_sync_from_date` = `2024/01/01`** (formato pokemontcg.io `yyyy/MM/dd`).
- **`POST /admin/catalog/backfill`** body `{ batchSize?=10, untilYear? }`: importa el **siguiente lote de sets más antiguos aún no importados** (colecciones anteriores a la frontera actual), en orden `releaseDate` **asc** desde los más antiguos disponibles hacia la frontera, tomando `batchSize` sets. Se detiene si alcanza `untilYear`. Respuesta `{ imported: [{ id, name, releaseDate, cardCount }], newBoundary, remaining }` (`newBoundary` = releaseDate del set más antiguo ya importado tras el lote; `remaining` = sets aún sin importar). **Repetible** hasta `remaining=0`.
- **Guardarraíles de seguridad (anti-inyección / anti-SSRF):**
  - Validar `setId` contra `^[a-z0-9]+(-[a-z0-9]+)*$` **antes** de interpolarlo en `q=set.id:<setId>` (previene inyección en el query param de la API remota). Rechazo `422 VALIDATION_ERROR` si no cumple.
  - **Host fijo** (base URL de pokemontcg.io hardcodeada/env, sin parte controlable por el usuario) → sin SSRF; el cliente HTTP no acepta URLs arbitrarias.
  - `fromReleaseDate` validado como fecha `yyyy/MM/dd`.
  - Autenticación con `POKEMONTCG_IO_API_KEY`; rate-limit vía la misma cola BullMQ.
- **Rarezas:** `Card.rarity` permanece **`String` libre** (captura cualquier rareza tal cual la entrega pokemontcg.io — taxonomía **abierta**, NO enum cerrado). Esto garantiza capturar rarezas modernas presentes y futuras sin migración.
- **Acabados (v1.6-finish):** el `client` de pokemontcg.io **deja de descartar** `tcgplayer.prices` — su tipo gana `prices?: Record<string, { market?: number }>`. En `upsertCards`, se derivan las **llaves presentes** de `card.tcgplayer.prices`, se **mapean a `Finish`** (tabla §3.7, descartando las no mapeadas) y el conjunto único se persiste en **`Card.availableFinishes`**. Ausente/vacío → `[normal]`. El **sync de precios** (M2) crea `PriceReference` **por cada acabado** disponible (`prices[llave].market`), no solo el primero (§4.1). **Este cambio requiere RE-SYNC** para poblar acabados/precios de las cartas ya importadas (§11 M-18).
- **Año del set:** se persiste `CardSet.releaseDate`; el **año** para los filtros de Compra se **deriva** de `releaseDate` (no se guarda columna redundante; ver `year` en §4.9).
- Todas las operaciones de sync son de `super_admin` y quedan en `AuditLog`.

### 4.9 Sección "Compra" (storefront) = inventario publicado con precio + facetas dinámicas
**Decisión de ruta:** se **mantiene la ruta `GET /api/v1/catalog/cards`** (no se renombra a `/shop` ni `/compra`) para no romper el contrato ya acordado; **cambia el semántico** y se documenta que "catalog" en el path es un tecnicismo interno — la superficie de producto se llama **"Compra"** (rótulo de UI, i18n del front). Renombrar la ruta añadiría churn de contrato sin beneficio funcional; el rótulo visible ya lo controla el front. *(Si en el futuro se decide alinear la ruta, sería un cambio de contrato vía arquitecto.)*
- **Regla dura:** `GET /catalog/cards` devuelve **SOLO inventario publicado CON precio de venta fijado** (`status=listed`, `sellable=true`, `salePriceCents != null`). **Excluye** items `pending`/sin precio/"precio pendiente". El comprador **nunca** ve "precio pendiente". (Esto **ajusta** la nota v1 que permitía mostrar pendientes no comprables: en v1.1 **no se listan**.)
- **Facetas dinámicas** (`GET /catalog/facets`, ver contrato) calculadas **sobre el inventario publicado** (no sobre el catálogo entero):
  - **`rarities`**: `distinct` de `Card.rarity` sobre el inventario publicado, **espejando los valores de pokemontcg.io tal cual** (taxonomía abierta, lista NO cerrada; el front no asume un conjunto fijo).
  - **`sets`**: `{ id, name, releaseDate, year }` (con `year` derivado de `CardSet.releaseDate`), solo los sets con inventario publicado, ordenados por **año desc**.
  - **`productTypes`**: subconjunto de `raw | graded | sealed` presente en el inventario publicado.
  - **`finishes` (v1.6-finish)**: `distinct` de `InventoryItem.finish` sobre el inventario publicado (subconjunto de `Finish`), para el filtro de acabado.
  - **rangos de precio** (min/max de `salePriceCents`) para el slider de precio.
- **Filtros** del listado: `setId`, `rarity`, `productType` (raw NM | graded | sealed), **`finish` (v1.6-finish)**, rango de precio, y `condition` (para raw solo hay `NM`).
- **Valuación por acabado (v1.6-finish):** `referenceValue`/`salePriceCents` de cada `ListingDTO` se calculan contra la `PriceReference` del **`InventoryItem.finish`** (no un precio único por carta). Dos copias de la misma carta con acabado distinto se listan como **entradas separadas** con su propio precio.

### 4.10 Cotizador buylist sobre TODO el catálogo (Opción 1) — v1.3

Decisión del humano (**Opción 1**): el cotizador público debe poder cotizar **cualquier** carta de la tabla
`Card` (todo el catálogo importado), no solo lo comprable en "Compra" (bóveda). Esto se resuelve en **dos
piezas**, ambas **backend nuevo** (ver `API_CONTRACT.md §6` y §M2):

1. **Búsqueda pública sobre toda la tabla `Card`** — `GET /buylist/cards` (+ `GET /buylist/sets` para el
   dropdown de set). Se ubican bajo `/buylist/*` **a propósito**, separadas de `/catalog/*` (que está acotado
   a inventario publicado con precio, §4.9). El servicio consulta `Card`/`CardSet` directamente (filtros
   `setId`, `q` sobre nombre/número, `rarity` libre), paginado, **sin** tocar `InventoryItem` ni precio. El
   resultado (`CardDTO`) da el `cardId` que consume `POST /buylist/quote`. Servicio sugerido: método nuevo en
   `CatalogService` (p. ej. `searchCatalog(...)`/`listCatalogSets()`) o un `BuylistCatalogService` en
   `modules/buylist`; el arquitecto no fija la ubicación exacta, sí la interfaz del contrato.
2. **Sync de TODO el catálogo** — `POST /admin/catalog/sync-all` (super_admin, auditado, **truly-async**).
   Para que el cotizador tenga cartas que buscar hay que poblar todo el catálogo (no solo 2024+). El
   `CatalogSyncService` actual **ya** puede importar todo (`sync` con `fromReleaseDate` antiguo, o `backfill`
   repetido hasta `remaining=0`); `sync-all` es un wrapper explícito que **encola** todos los sets remotos en
   la cola BullMQ y retorna de inmediato, evitando el timeout del `sync` from-date síncrono (ver DEV-1, §9).

**Pricing del cotizador para cartas fuera de bóveda:** el `PricingService` solo pricea cartas **en bóveda**
(§4.1). Una carta `ex_plus` recién buscada en el catálogo (que no tenemos) **no** tendrá `PriceReference`, por
lo que su cotización sale `precio_pendiente` y escala a la cola del dueño al crear la solicitud (PROJECT
criterio 13, `AcquisitionPricer` §4.2). Las tarifas planas (`comun`=50, `reverse_holo`=150) **no** dependen
de referencia y se cotizan siempre. Esto es **coherente** con las reglas ya cerradas; si el humano quiere que
el cotizador **pricee on-demand** una `ex_plus` del catálogo completo (fetch puntual al `PricingProvider` en
el momento de cotizar, respetando rate-limit), es una **decisión de alcance** — ver **Pregunta abierta v1.3-1**
(§10). No se asume: el MVP mantiene el comportamiento `precio_pendiente`.

### 4.11 Verificación de correo + recuperación de contraseña self-service (v1.5-auth-email)

Decisiones de producto **cerradas por el humano**: la verificación **bloquea acciones sensibles, no el login**;
recuperación con **ambos** flujos (self-service por email **+** reset por admin existente). Proveedor de envío:
**Resend** (`no-reply@tcgvaultmx.com`).

#### a) Abstracción de correo — módulo `mail`
Desacopla el dominio de Resend (mockeable en tests, intercambiable de proveedor):
```ts
// Puerto (token DI: MAIL_PORT). Bajo nivel: enviar un correo ya renderizado.
interface MailPort {
  send(msg: { to: string; subject: string; html: string; text: string }): Promise<{ id?: string }>;
}
// Adaptadores:
//  - ResendMailAdapter   -> POST https://api.resend.com/emails con RESEND_API_KEY, from = MAIL_FROM.
//  - NoopMailAdapter     -> NO envía; loguea `to/subject` y (en no-prod) el LINK con el token en claro,
//                           para dev/CI/tests sin key. Se selecciona cuando falta RESEND_API_KEY en LOCAL_ENVS.
// Servicio de dominio (plantillas + i18n por User.locale):
class MailService {
  sendEmailVerification(user: User, link: string): Promise<void>;  // asunto+cuerpo con link
  sendPasswordReset(user: User, link: string): Promise<void>;
}
```
- **Selección del adaptador (provider factory en `MailModule`):** si hay `RESEND_API_KEY` → `ResendMailAdapter`;
  si no y el entorno es LOCAL_ENVS → `NoopMailAdapter` (degradación con aviso en log). En **no-local** la key es
  **requerida** (§8), así que ahí siempre es el adaptador real (nunca se cae silenciosamente a Noop en prod).
- **Plantillas** (bilingües ES/EN por `User.locale`, mismas convenciones i18n del §6 — el texto vive en el
  backend porque el correo se envía server-side, a diferencia de la UI):
  - **Verificación:** asunto "Verifica tu correo / Verify your email"; cuerpo con botón/enlace a
    `${APP_BASE_URL}/<locale>/verify-email?token=<claro>`; caduca en 24h.
  - **Recuperación:** asunto "Restablece tu contraseña / Reset your password"; cuerpo con enlace a
    `${APP_BASE_URL}/<locale>/reset-password?token=<claro>`; caduca en 1h; nota "si no lo solicitaste, ignóralo".
- **El link apunta al FRONTEND.** El backend construye la URL con `APP_BASE_URL` (ya existe en env, es la base del
  front usada por CORS) + prefijo de `locale`. El **nombre del query param es contrato: `token`**; la **ruta**
  exacta la posee el frontend (grupo `(auth)/`), pero se fija aquí el patrón `/<locale>/verify-email` y
  `/<locale>/reset-password` para alinear productor/consumidor. El front lee `token` y llama al endpoint POST.

#### b) Emisión y consumo de tokens (ver modelo `AuthToken`, §3.2)
- **Registro email/password** (`POST /auth/register`): tras crear el `User` (`emailVerified=false`), emite un
  `AuthToken(type=email_verification, 24h)` y envía el correo. La respuesta **no cambia de forma** salvo que el
  objeto `user` ahora incluye `emailVerified` (siempre `false` recién registrado). El fallo de envío de correo
  **no** debe abortar el registro (se registra el error; el usuario puede pedir reenvío).
- **Reenvío** (`POST /auth/verify-email/resend`): **autenticado** (`customer+`), usa el email de `req.user`
  (sin body) → **sin riesgo de enumeración** (hay que estar logueado, y el login está permitido sin verificar).
  Si ya está verificado → `200` no-op. Rota tokens previos. Rate-limit estricto (§d).
- **Verificar** (`POST /auth/verify-email`): **público** (el link se abre desde el correo, quizá sin sesión).
  Consume el token atómicamente → `User.emailVerified=true`, `usedAt=now()`. **No** toca `tokenVersion` (verificar
  no revoca sesiones). Idempotencia sugerida: si el `User` del token ya está verificado, responder `200` aunque el
  token ya esté usado (evita error por doble clic).
- **Olvidé contraseña** (`POST /auth/forgot-password`): **público**, `{ email }`. **SIEMPRE responde `200`**
  (anti-enumeración): si el email existe, emite `AuthToken(type=password_reset, 1h)` y envía el correo; si no
  existe, no hace nada pero responde igual. Rota tokens de reset previos. Para cuentas solo-Google (sin
  `passwordHash`) el reset **fija** una contraseña (habilita login local, igual que el reset admin, §4.7bis).
- **Restablecer** (`POST /auth/reset-password`): **público**, `{ token, password }`. Consume el token
  (`password_reset`, vigente, no usado); setea `passwordHash` (argon2, misma rutina que register), **incrementa
  `User.tokenVersion`** (revoca sesiones vivas — patrón existente), marca `usedAt`, limpia `mustChangePassword` si
  estaba. **Efecto:** clic exitoso en el link prueba control del inbox → también setea `emailVerified=true`
  *(decisión a confirmar, §10)*. No devuelve tokens: el usuario **re-inicia sesión** con la nueva contraseña.

#### c) Gating de acciones sensibles — `EmailVerifiedGuard` (AUTORIDAD server-side)
Nuevo guard + decorador `@RequireEmailVerified()` (en `common/`), análogo a `@MoneyOut()`/`@Roles()`. Corre
**después** de `JwtAuthGuard` (que puebla `req.user.emailVerified` desde BD). Si `emailVerified=false` → lanza
**`403 EMAIL_NOT_VERIFIED`** (el front muestra banner "verifica tu correo"). Google → `true`, no afectado.
- **Operaciones bloqueadas (mutaciones sensibles):**
  - **Comprar:** `POST /api/v1/checkout/session` (crear orden + PaymentIntent). *(El `POST /checkout/quote`
    read-only queda **abierto** para que la UI muestre precios con el banner.)*
  - **Retirar/enviar (money-out del usuario):** `POST /api/v1/shipments`. *(El `POST /shipments/quote` queda
    abierto.)*
  - **Vender (buylist):** `POST /api/v1/buylist/requests` (crear `SellRequest`). *(El `POST /buylist/quote`
    público queda abierto — es el cotizador anónimo.)*
- **No afecta** al money-out de back-office (`@MoneyOut()`, super_admin): esos son staff. Las cuentas de staff
  (`vault_operator`/`super_admin`) deben sembrarse `emailVerified=true` para no auto-bloquearse *(nota a devops)*.
- **Cómo lo sabe el front:** `GET /users/me` ya expone `emailVerified`; además el objeto `user` de
  `/auth/register|login|google` lo incluye ahora. El front decide banner/CTA a partir de ese flag; el bloqueo
  real lo hace **siempre** el guard (la UI es solo cosmética).

#### d) Anti-abuso / anti-enumeración
- **Rate-limit por endpoint** (`@Throttle`, patrón `AuthController` existente): `forgot-password` **3/hora/IP**
  (+ tope por email en servicio, p. ej. ≤ 3 tokens/hora/email); `verify-email/resend` **3/hora/usuario** (+ IP);
  `verify-email` y `reset-password` (consumo) **10/min/IP** (defensa aunque el token sea de alta entropía).
- **Respuestas genéricas:** `forgot-password` siempre `200`; el consumo de token no distingue
  inexistente/expirado/usado (un único `*_TOKEN_INVALID`).
- **Auditoría** (`AuditLog`, sin volcar el token): `auth.email_verification_sent`, `auth.email_verified`,
  `auth.password_reset_requested`, `auth.password_reset_completed`.

### 4.12 Gráfica PÚBLICA del valor de un set (hero de la home) — v1.9-set-chart

Superficie de producto: un visitante **anónimo** ve en el hero de la home una gráfica estilo acciones del
**valor de mercado agregado de un set destacado**, con datos REALES y captura diaria. Reusa el patrón de la
gráfica de portafolio (`PortfolioSnapshot` + `/vault/portfolio/history`), pero **por set** y **público**.
Servicio sugerido: `SetValueService` en `modules/catalog` (lee `SetValueSnapshot`; el fetch externo lo hace el
job vía el `PricingProvider` existente).

**(a) Regla de valor (server-side, SEC-A1 — la fuente de verdad del monto).**
`SetValueSnapshot.totalValueMxnCents` de un set en una fecha `d` se calcula así, **100% server-side desde
`PriceReference` real** (nunca de input del cliente):
```
para cada Card c con c.setId = set:
    ref = PriceReference vigente más reciente de (c.id, productType='raw', gradeKey='raw:NM', finish='normal')
          con capturedDate <= d           // "vigente" = el precio más fresco a esa fecha
    si ref existe            → suma ref.priceMxnCents  y  pricedCardCount += 1
    si ref no existe (o null)→ la carta se EXCLUYE del total (no se inventa precio)
totalValueMxnCents = SUM(ref.priceMxnCents de las cartas con precio)
pricedCardCount    = # cartas del set con ref
totalCardCount     = # cartas del set (Card con ese setId, priceadas o no)
```
- **Acabado/productType fijos y explícitos:** se toma **`finish='normal'`**, **`productType='raw'`**,
  **`gradeKey='raw:NM'`**, campo **`priceMxnCents`**. Se elige `normal` (no reverse/holo) porque es el acabado
  presente en (casi) toda carta y da la línea base más comparable del set; el resto de acabados de una misma
  carta **no** se suman (se contaría de más). El origen es TCGPlayer `market` vía pokemontcg.io convertido a MXN
  por el FX de Banxico del día (misma cadena que ya usa `PricingService`).
- **Cartas sin precio ese día:** se **excluyen** del total (no se fabrica un valor), pero se **cuentan** en la
  brecha `pricedCardCount` vs `totalCardCount`. Así el valor es honesto ("valor de las **cartas priceadas** del
  set", NO promesa de set completo) y el front puede mostrar la cobertura. Esto es coherente con la regla
  transversal de PROJECT (una carta sin precio nunca se descarta ni se inventa; aquí simplemente no aporta al
  agregado del día).
- **No genera `PendingPriceEntry`:** esta agregación es **de mercado/marketing**, no de bóveda ni de una carta
  que debamos vender; una carta del set sin precio no se escala al dueño por este flujo (se seguirá escalando por
  los flujos existentes de bóveda/buylist si aplica). Evita inundar la cola con todo el catálogo del set.

**(b) Selección del "set destacado".** Mecanismo determinista con override por env y fallback en cascada:
1. **`HOME_FEATURED_SET_ID`** (env; id **nativo de pokemontcg.io** de un set SV reciente, ej. formato `sv8`). Si
   está seteado y existe un `CardSet` local con ese `externalId` → **ese** es el set destacado. **El id concreto
   lo fija devops/backend en el entorno**; el arquitecto define solo el mecanismo. Default recomendado: un set
   Scarlet & Violet reciente y líquido.
2. **Fallback 1 — mayor valor:** si el env no está o no resuelve a un set local, se elige el set con mayor
   `totalValueMxnCents` en su **último `SetValueSnapshot`** (el set "más valioso" con datos ya capturados).
3. **Fallback 2 — más reciente:** si aún no hay ningún snapshot (arranque en frío, primer día), se elige el
   `CardSet` con `releaseDate` más reciente (desc), para tener siempre un set que mostrar.
4. Si no hay ningún `CardSet` en absoluto → el endpoint responde `set: null, points: []` (ver contrato); el hero
   degrada con elegancia, sin error.
La resolución del set destacado la centraliza `SetValueService.resolveFeaturedSet()` y la usan **tanto** el
endpoint público **como** el job `set-price-sync` (para preciar el mismo set que se grafica). El `set-price-sync`
debe preciar el set destacado resuelto por *este* mecanismo, de modo que env y gráfica no diverjan.

**(c) Jobs (BullMQ diarios; los implementa backend — aquí solo se describen).**
- **`set-price-sync`** — precia **TODAS** las cartas del set destacado desde pokemontcg.io (acabado `normal`,
  `raw`), escribiendo `PriceReference` del día por carta (reusa `PricingService.syncCardPrice` / el
  `PokemonTcgIoProvider`). **Brecha NUEVA a cubrir:** el `price-sync` actual solo recorre cartas **en bóveda**
  (`InventoryItem`); este job **no** filtra por inventario — recorre `Card WHERE setId = <featured>` sin tocar
  `InventoryItem`, acotado a ese `setId` (un set ~150–250 cartas, cabe en el rate-limit del free tier con la cola
  existente). Se documenta como **DEV-3** en §9. Respeta el mismo cache diario (no re-llama si ya hay
  `PriceReference` del día para esa carta/acabado).
- **`set-value-snapshot`** — tras `set-price-sync`, agrega según la regla (a) y hace **upsert** de
  `SetValueSnapshot` del día (`@@unique[setId, asOfDate]`). Idempotente. Solo escribe el set destacado en el MVP
  (el modelo soporta N sets; se puede extender sin cambio de schema).
- **Crons (alineados con los existentes `fx-refresh 0 6`, `price-sync 15 6`, `portfolio-snapshot 0 7`):**
  `set-price-sync` **después** de `fx-refresh` (necesita el FX del día) — sugerido **`30 6`**; `set-value-snapshot`
  **después** de `set-price-sync` — sugerido **`15 7`**. Los horarios finos los ajusta devops/backend; el orden
  (FX → precio del set → snapshot del set) es la restricción dura.

**(d) Seguridad/coherencia.**
- **Endpoint PÚBLICO sin PII:** solo expone valor agregado de mercado del set (nombre, serie, fecha de
  lanzamiento del set — datos de catálogo públicos de pokemontcg.io — y la serie de valores). **No** expone
  usuarios, bóveda, inventario, costos ni nada sensible. `@Public()` como el resto de `/catalog/*`.
- **Fetch externo a host FIJO:** el `set-price-sync` usa el mismo cliente de pokemontcg.io con **host fijo** y
  guardarraíl de `setId` (`^[a-z0-9]+(-[a-z0-9]+)*$`) ya existente (§4.8) → sin SSRF ni inyección en el query.
- **SEC-A1 intacto:** el valor es siempre derivado de `PriceReference`; el `range` del query solo filtra fechas,
  nunca influye en el monto.
- **Sin datos fabricados:** si un día no corrió el job, ese día **no** tiene punto (el front interpola
  visualmente si quiere, pero la API no inventa el punto). Si el set no tiene ninguna carta priceada aún,
  `points: []` y `change` en `flat`.
- **Rate-limit del endpoint público:** al ser anónimo y en el hero (alto tráfico), se cachea la respuesta
  (lectura de `SetValueSnapshot`, que cambia 1x/día) — se sugiere `Cache-Control` corto + rate-limit por IP
  (devops/backend afinan). No hay riesgo de dinero ni de PII, pero conviene proteger de scraping abusivo.

### 4.13 Fase 1 del epic de precios — preciar TODO el catálogo + refresco 2×/día + sets nuevos (v1.12-catalog-pricing)

Decisión del humano (fija): (1) **preciar SIEMPRE todo el catálogo** (aunque la carta no esté en bóveda/
inventario), (2) **auto-actualización 2×/día** (job programado), (3) **importar/mapear sets nuevos**. Toca dinero
→ triple veredicto. **Aditivo, sin migración de esquema** (reusa `PriceReference`, con `finish` ya en su clave
desde M-18). Los cuatro sub-ítems son independientes y paralelizables, salvo que 1.2 y 1.3 se apoyan en 1.1.

**(a) 1.1 — Poblar `PriceReference` durante el `catalog-sync` (reusando `tcgplayer.prices` ya descargado).**
- **Insight base:** `CatalogSyncService.upsertCards` (`backend/src/modules/catalog/catalog-sync.service.ts`) **YA**
  recibe `c.tcgplayer.prices` y deriva `availableFinishes` (`deriveAvailableFinishes`). **El precio de mercado por
  acabado (`prices[llave].market`) está en el MISMO payload** → poblar `PriceReference` **NO cuesta llamadas extra**.
- **Qué se escribe:** por cada `finish` derivado con `prices[FINISH_TO_TCG_KEY[finish]].market > 0`, un **upsert**
  de `PriceReference` con:
  - clave `(cardId, productType='raw', gradeKey='raw:NM', finish, capturedDate=hoy)` (la unicidad existente),
  - `priceUsdCents = round(market×100)`, `priceMxnCents = usdToMxnCents(priceUsdCents, fx.rate, fx.bufferPct)`,
    `source='pokemontcg_io'`, `isManualOverride=false`.
  El **FX se lee UNA vez por corrida** (`FxService.getCurrent()`) y se reusa para todas las cartas (no por-carta).
- **Idempotencia (una fila por día por acabado):** upsert sobre la clave única. Re-correr el mismo día **actualiza**
  `priceMxnCents` (último market), no duplica; la segunda corrida del día (18:00) refina el precio de hoy.
- **No pisar overrides del admin:** si la fila de hoy existe con `isManualOverride=true` → **skip** (el override
  manual manda; §4.1). Solo se upsertea cuando no hay override del día.
- **Cartas sin market → NO se crea referencia y NO se escala a `PendingPriceEntry`.** Se usa `escalate=false` (mismo
  criterio que `set-price-sync`, §4.12a): escalar decenas de miles de cartas del catálogo a la cola del dueño sería
  ruido inútil. Una carta sin market simplemente **no tiene referencia** hasta que (i) el admin la fija a mano, o
  (ii) entra a un contexto real (bóveda/buylist) donde los flujos existentes SÍ escalan (`escalate=true`). Así se
  respeta la regla transversal de PROJECT (nunca se descarta) **en los contextos donde importa**, sin inundar la cola
  con el catálogo entero.
- **productType/gradeKey = `raw`/`raw:NM`:** coincide EXACTAMENTE con lo que lee `publicQuote` (raw NM) y con
  `SET_VALUE_RULE` (§4.12). Se prician **todos los acabados** (normal, reverse_holo, holofoil, 1st-ed holo), no solo
  `normal` — esto habilita el cotizador por-acabado (§4.2.1) y la valuación de portafolio por-acabado (§4.1) sobre
  TODO el catálogo. (Graded/sealed **no** se prician aquí: pokemontcg.io no da esos datos; siguen manual/su propio
  provider.)
- **Cambio de doctrina documentado:** las notas históricas "solo se pricea la bóveda" (§4.1, §5) se **matizan**: el
  **catálogo completo** se precia **durante el `catalog-sync`** (reusando datos ya descargados); el `price-sync`
  diario de **bóveda** se conserva para refrescar los items en custodia entre syncs de catálogo.
- **Firma sugerida (backend decide ubicación exacta):** método nuevo en `PricingService`, p. ej.
  `persistMarketReference(cardId, finish, marketUsdCents, fx): Promise<void>` (upsert idempotente + guarda override),
  invocado desde `upsertCards` con el `fx` pre-cargado. `CatalogSyncService` gana la dependencia `PricingService`
  (hoy inyecta solo `prisma`/`client`/`settings`).
- **Efecto colateral positivo:** `computeSetValue`/`set-value-snapshot` (§4.12) ahora tienen `PriceReference`
  `normal` de **cualquier** set (no solo el destacado). `set-price-sync` queda **en gran medida subsumido** por 1.1;
  se conserva como está (inocuo, mantiene fresco el set del hero entre syncs). Ver DEV-3 (§9): 1.1 lo cubre.

**(b) 1.2 — Cotización on-demand de raras: `publicQuote` READ-ONLY (supersede BE-16).**
- **Problema (BE-16):** `publicQuote` (`buylist.service.ts` ~:81-83) llamaba `escalatePending` cuando el acabado
  cotizaba `precio_pendiente` — un endpoint **público/anónimo que ESCRIBE** en la cola de trabajo del dueño; un
  anónimo podía inflar la cola enumerando cartas.
- **Diseño seguro (elegido):** con 1.1 el catálogo ya está priceado, así que el `getReference` del quote casi
  siempre devuelve precio. Se **ELIMINA** la llamada a `escalatePending` de `publicQuote` → **vuelve a ser
  read-only** (como fue antes de la deuda de Fase 0.2). Si el acabado sigue `precio_pendiente` (carta sin market), el
  quote **lo reporta** sin escribir nada.
- **NO se pricea on-demand desde el quote.** Se descarta el fetch puntual al `PricingProvider` en el quote público
  porque: (i) es **anónimo** → superficie de abuso (enumerar cartas quema la cuota del free tier y puede spamear la
  cola), (ii) **redundante** con el job 2×/día + el catalog-sync (el catálogo ya está priceado), (iii) el cache
  diario ya existe. La frescura la da el **job** (1.3), no el request del visitante.
- **La escalada queda SOLO en el flujo autenticado:** `POST /buylist/requests` (`createRequest`) **sigue** llamando
  `escalatePending` (el vendedor se compromete a vender → es legítimo escalar al dueño). Sin cambio ahí.
- **Cierra BE-16** (y resuelve el punto abierto v1.3-1: default = **no** on-demand, ahora confirmado por el diseño
  de Fase 1). Es una edición mínima de backend (quitar ~3 líneas del quote).

**(c) 1.3 — Job programado 2×/día: refresco de precios + import de sets nuevos.**
- **Mecanismo de jobs actual:** BullMQ repeatable jobs cableados en `backend/src/jobs/scheduler.service.ts`
  (activados si hay `REDIS_URL`; si no, deshabilitados y disparables a mano). Crons en **UTC**. NO hay una cola
  BullMQ por-set para el catálogo (el `sync-all` corre secuencial en memoria del proceso — DEV-1).
- **Job nuevo `catalog-price-sync`** (en `backend/src/jobs/`), que en una corrida hace:
  1. **Refresco de precios de TODO el catálogo = re-sync completo.** pokemontcg.io **no** expone un endpoint bulk de
     solo-precios: el `market` viaja **embebido** en cada carta. Por tanto refrescar precios ⇒ **re-fetch de las
     cartas** (paginado por set). Se reusa `CatalogSyncService` con la semántica **`force:true`** (reprocesa TODOS
     los sets remotos → `upsertCards` repuebla cartas + `availableFinishes` + `PriceReference` por acabado con el FX
     del día, vía 1.1). **Importa sets nuevos de forma natural** (procesa todos los sets remotos, incluidos los que
     aún no existían localmente) → 1.3 cubre el import de sets nuevos **sin paso aparte**.
  - El job **espera a completar** (es un worker de fondo, sin timeout HTTP). Reusa `runSyncAll(allRemoteSets)`;
    **single-flight** por `syncAllStatus.running` (no se solapan dos barridos). El progreso ya es observable por
    `GET /admin/catalog/sync-status` (§M2).
- **Escala / rate-limit / pacing:**
  - Catálogo ≈ 160+ sets, ~15–25k cartas; paginado a 250/página ⇒ ~**algunos cientos** de requests a pokemontcg.io
    por corrida (1 `/sets` + Σ páginas por set). Con `POKEMONTCG_IO_API_KEY` la cuota es holgada (~20k req/día);
    **sin key** el free tier es mucho menor y **puede toparse** → **la API key es requisito operativo** (riesgo, ver
    §8/§10). 2×/día ⇒ ~cientos × 2, dentro del presupuesto con key.
  - El cliente (`PokemonTcgIoClient`) ya reintenta con **backoff exponencial** ante 429/5xx y respeta `Retry-After`.
    El barrido es **secuencial** (una página a la vez) → no revienta el rate-limit. Se puede añadir un **pacing**
    opcional (sleep corto entre requests) como dial devops.
  - **Idempotencia:** cartas por `upsert(externalId)`; `PriceReference` por `upsert(clave día/acabado)`. Re-correr
    (o el 2º pase del día) es seguro.
  - **In-process vs cola:** para el MVP el barrido corre **secuencial in-process** dentro del worker BullMQ
    (aceptable: background, idempotente, reanudable re-corriendo). Límite DEV-1: si el proceso reinicia a media
    corrida, la siguiente corrida (o `sync-all` manual) reanuda. **Objetivo futuro (más robusto):** encolar **un job
    BullMQ por set** (retry/persistencia de progreso por set). Backend decide; no bloquea Fase 1.
- **Horarios (dueño devops):** **06:00 y 18:00 CDMX**. CDMX = America/Mexico_City = **UTC−6** (sin DST) ⇒ crons UTC
  **`0 12 * * *`** y **`0 0 * * *`**. Configurables por env (p. ej. `CATALOG_PRICE_SYNC_CRON_AM/PM`). **Orden con
  FX:** la conversión USD→MXN necesita un FX fresco; `FxService.getCurrent()` **degrada al último `FxRate`
  disponible**, así que el orden es **suave**, pero se recomienda un `fx-refresh` poco antes de cada corrida (el
  `fx-refresh 0 6 UTC` existente cubre la corrida de las 06:00 CDMX/12:00 UTC; devops añade uno antes de la de las
  18:00 CDMX/00:00 UTC si quiere FX del mismo día).
- **Disparo manual:** el mismo refresco es invocable hoy con `POST /admin/catalog/sync-all` `{force:true}`
  (super_admin, auditado); no se requiere endpoint nuevo. (Opcional: un `POST /admin/jobs/catalog-price-sync` para
  simetría con otros jobs; backend/devops deciden.)

**(d) 1.4 — Botón "importar sets nuevos" en M2 (manual, además del job).**
- **NO requiere endpoint nuevo.** El flujo se arma con endpoints existentes:
  1. `POST /admin/catalog/sync-all` con **`force:false`** → importa **solo los sets NO importados** (sets nuevos que
     fueron saliendo), truly-async (202).
  2. `GET /admin/catalog/sync-status` → **polling** del progreso (`running/done/total/finishedAt`).
  3. `GET /admin/catalog/remote-sets` → **refresca** la lista remota + estado `imported/cardCount` al terminar.
- Es un cambio **solo de frontend** (M2). Como los sets nuevos entran por `upsertCards`, **también quedan priceados**
  (1.1) en la misma pasada. (Opcional, mismo M2: un botón "Refrescar precios del catálogo" que llame `sync-all`
  `{force:true}`, alias manual del job 1.3.)

---

### 4.14 Fase 2 del epic de precios — precio de VENTA por RAREZA, editable en admin (v1.13-sales-pricing)

> **Reemplaza** el **markup GLOBAL único** de venta (`SALES_MARKUP_PCT`, default 15) por una **tabla de regla por
> rareza** editable en **M2** sin redeploy, **simétrica** a la de buylist (§4.2 / §4.2.1). Decisión del humano (fija):
> el precio de venta se asigna **por rareza**, con reglas **`fixed` (piso en MX$)** o **`pct` (% ARRIBA de mercado)**.
> Ejemplo del humano: **Common $5, Uncommon $10, holo/reverse $10 fijos; rarezas más altas = % arriba de mercado.**
> **Aditivo, SIN migración de esquema** (el precio de venta ya se congela en `OrderItem.unitPriceCents` al checkout).
> Toca dinero → triple veredicto.

#### (a) 2.1 — Modelo de config (diales M2, `ConfigSetting`)

Dos `SettingKey` nuevos (`backend/src/modules/settings/settings.constants.ts`), **espejo** de
`BUYLIST_PRICE_RULES`/`BUYLIST_PRICE_FALLBACK_PCT`:

- `SALES_PRICE_RULES` (`sales_price_rules`): mapa **`{ [rarity|ruleKey: string]: SalesRule }`** con
  `SalesRule = { mode: 'fixed' | 'pct', value: number }` (misma **forma** que `BuylistRule`, semántica de `pct`
  **distinta**, ver (b)).
  - `mode='fixed'` → `value` = **piso de venta MX$ en centavos** (entero ≥ 0). **No depende del mercado** → siempre precia.
  - `mode='pct'` → `value` = **porcentaje de markup ARRIBA de mercado** (número en `[0, SALES_PCT_MAX]`).
- `SALES_PRICE_FALLBACK_PCT` (`sales_price_fallback_pct`): **markup %** (default **15**) que se aplica a cualquier
  rareza **sin regla explícita**. Es un `pct` implícito.

**Seed inicial (reproduce el ejemplo del humano; editable en M2):**
```jsonc
// SALES_PRICE_RULES  (value = centavos si fixed)
{
  "Common":       { "mode": "fixed", "value": 500  },   // MX$5
  "Uncommon":     { "mode": "fixed", "value": 1000 },   // MX$10
  "Holo":         { "mode": "fixed", "value": 1000 },   // MX$10  (clave sintética del finish holofoil, §4.2.1)
  "Reverse Holo": { "mode": "fixed", "value": 1000 }    // MX$10  (clave del finish reverse_holo)
}
// SALES_PRICE_FALLBACK_PCT = 15
```
Todo lo demás (Rare Holo, EX/GX/V/VMAX/VSTAR, Ultra/Illustration/Special Illustration/Double Rare, Full/Alt Art,
Secret/Rainbow/Hyper, Trainer Gallery, Character, Radiant…) **cae al fallback = market × (1 + 15/100)**.

**Justificación del default 15%:** iguala **exactamente** el `SALES_MARKUP_PCT` vigente (default 15), así que la
migración **preserva el precio de venta actual** para toda rareza que caiga al fallback (venta = market × 1.15,
idéntico a hoy). Solo cambia deliberadamente el **piso de bulk** (Common/Uncommon/Holo/Reverse pasan a piso fijo
$5/$10/$10/$10, que hoy no existe). El % exacto de venta para raras queda como **decisión abierta v1.13-1** (el 15%
es "preservar negocio"; el humano puede subirlo por rareza sin tocar código).

**Validadores nuevos** (`settings.constants.ts`, junto a `validateBuylistRules`):
```ts
const SALES_PCT_MAX = 1000;  // propuesta: 0..1000% de markup (hasta 11× market). Ver decisión abierta v1.13-2.
function isValidSalesRule(v): boolean {   // fixed → entero ≥ 0 (cents); pct → número en [0, SALES_PCT_MAX]
  if (v?.mode === 'fixed') return isInt(v.value) && v.value >= 0;
  if (v?.mode === 'pct')   return isNum(v.value) && v.value >= 0 && v.value <= SALES_PCT_MAX;
  return false;
}
function validateSalesRules(v): string | null;      // objeto-mapa, cada entrada isValidSalesRule
function validateSalesFallbackPct(v): string | null;// número en [0, SALES_PCT_MAX]
```
**Rango del validador (por qué difiere de buylist):** el `pct` de buylist topa en **`[0,100]`** porque comprar a
>100% de mercado no tiene sentido. En venta `pct` es *markup ARRIBA de mercado*, que **sí** puede superar 100% (una
chase se puede listar a 2×–3× market). Se propone tope **`SALES_PCT_MAX = 1000`** (evita typos catastróficos —p. ej.
`100000`— sin limitar el markup real). Es más restrictivo que el `SALES_MARKUP_PCT` legacy (que era `>= 0` sin tope);
si el humano quiere paridad exacta con lo legacy, dejar sin tope superior. Ver **decisión abierta v1.13-2**.

Registro en `SETTING_VALIDATORS` y `SETTING_DEFAULTS`. **NO** se exponen en `SETTING_DTO_MAP` (se editan por los
endpoints M2 dedicados, como las reglas de buylist, no por `PUT /admin/settings`).

#### (b) 2.2 — Función pura `computeSalePriceForRarity` (`backend/src/common/money.ts`)

Análoga a `quoteAcquisitionForFinish` (§4.2.1), **reusa `ruleKeyCandidates(rarity, finish)`** — por tanto hereda el
**gate premium de Fase 0** (una rareza chase en `holofoil`/`1st-ed holo` **nunca** cae al piso fijo `"Holo"` de bulk:
resuelve por su propia regla o el fallback pct = markup sobre market). Pseudocódigo:

```ts
export type SalesRuleMode = 'fixed' | 'pct';           // = BuylistRuleMode (misma forma)
export interface SalesRule { mode: SalesRuleMode; value: number; }  // value = cents si fixed, % markup si pct
export interface SalePriceResult {
  salePriceCents: number | null;
  status: 'priced' | 'pending';
  appliedRule: SalesRule;
  ruleSource: 'rule' | 'fallback';
}

export function computeSalePriceForRarity(
  rarity: string | null,
  finish: Finish,
  referenceMxnCents: number | null,        // PriceReference.priceMxnCents del ACABADO cotizado (getReference(...,finish))
  rules: Record<string, SalesRule>,        // SALES_PRICE_RULES
  fallbackPct: number,                     // SALES_PRICE_FALLBACK_PCT (default 15)
): SalePriceResult {
  const candidates = ruleKeyCandidates(rarity, finish);          // REUSA §4.2.1 (gate premium)
  const hitKey = candidates.find((k) => rules[k] != null);
  const rule: SalesRule = hitKey ? rules[hitKey] : { mode: 'pct', value: fallbackPct };
  const ruleSource = hitKey ? 'rule' : 'fallback';

  if (rule.mode === 'fixed') {
    // PISO fijo en centavos; NO depende de la referencia → siempre 'priced'.
    return { salePriceCents: rule.value, status: 'priced', appliedRule: rule, ruleSource };
  }
  // pct = MARKUP ARRIBA DE MERCADO: sale = round(market × (1 + value/100)).  ← DISTINTO de buylist.
  if (referenceMxnCents == null) {
    return { salePriceCents: null, status: 'pending', appliedRule: rule, ruleSource };
  }
  return { salePriceCents: Math.round(referenceMxnCents * (1 + rule.value / 100)),
           status: 'priced', appliedRule: rule, ruleSource };
}
```

**Contraste de semántica de `pct` (crítico, no confundir):**
| Contexto | `pct` significa | Fórmula |
|---|---|---|
| Buylist / compra (§4.2) | **% de** la referencia (lo que pagamos) | `round(ref × value/100)` |
| Venta (§4.14, esta sección) | **% ARRIBA de** mercado (markup de venta) | `round(ref × (1 + value/100))` |

Un mismo `value=40` da **40% del market** comprando y **140% del market** vendiendo. La forma del dato (`{mode,value}`)
es idéntica; **la matemática del `pct` es la única diferencia** entre `applyRule` (buylist) y este resolver.

#### (c) 2.3 — Endpoints M2 (backend) — clones del patrón buylist

En `pricing.controller.ts`, **clonar 1:1** los tres endpoints de buylist (§4.2, `pricing.controller.ts:128-207`):
- `GET /admin/pricing/sales-rules` → `{ rules: Record<string, SalesRule>, fallbackPct }` (lee crudo).
- `PUT /admin/pricing/sales-rules` → reemplaza tabla y/o fallback; valida con `validateSalesRules`/
  `validateSalesFallbackPct` → `422 VALIDATION_ERROR`; **auditado** (`action=pricing.sales_rules.update`, before/after);
  surte efecto sin redeploy.
- `GET /admin/pricing/sales-rarities` → `{ fallbackPct, rarities: [{ rarity, cardCount, rule, source }] }`
  (rarezas distintas del catálogo `groupBy Card.rarity` unidas a las reglas; las sin regla muestran el fallback).
  Ordenado por `cardCount` desc.

`super_admin` (mismo guard que `buylist-rules`; es pricing/dinero). Ver shapes en `API_CONTRACT.md §M2`.

#### (d) 2.4 — Aplicación: reemplazar el markup global

Nuevo método en `PricingService` (`pricing.service.ts`), reemplaza/complementa `computeSalePrice(ref)` (`:330-334`):
```ts
async computeSalePriceForItem(item: { rarity, finish } , referenceMxnCents): Promise<SalePriceResult> {
  const rules = await this.settings.getRaw(SALES_PRICE_RULES) ?? {};
  const fallbackPct = await this.settings.getNumber(SALES_PRICE_FALLBACK_PCT);
  return computeSalePriceForRarity(item.rarity, item.finish, referenceMxnCents, rules, fallbackPct);
}
```
Se cambian **exactamente 2 call-sites** (los únicos que llaman `computeSalePrice` en producción):
- `catalog.service.toListingDTO` (`:103-108`): si no hay `listPriceCents` manual, calcular `salePriceCents` con el
  resolver por rareza (rareza `item.card.rarity`, acabado `item.finish`). Con reglas `fixed` una carta bulk sin
  market ahora **sí** obtiene `salePriceCents` (piso) ⇒ puede ser `sellable` (mejora deliberada). Con `pct` sin market
  → `pending`, no vendible (igual que hoy).
- `orders.service.salePriceOf` (`:23-34`): idem; si `pct` y no hay referencia → `PRICE_PENDING` (se conserva); si
  `fixed`, devuelve el piso aunque no haya market.

**SEC-A1 (guardarraíl intacto):** la `rarity` sale de `Card.rarity` (BD) y el `finish` de `InventoryItem.finish` (BD),
**nunca** del DTO del cliente (el DTO de checkout solo envía IDs de item; ver `docs/SECURITY_NOTES.md` SEC-D2 y
`docs/PENTEST_NOTES.md`). El **override manual** `InventoryItem.listPriceCents` **sigue teniendo prioridad**
(precio directo sin regla). El precio se **congela** en `OrderItem.unitPriceCents` al checkout → **no hace falta
snapshot de regla nuevo ni migración** (a diferencia de buylist, cuyo payout diferido sí exige snapshot en
`SellRequestItem`).

**`SALES_MARKUP_PCT` (legacy):** **DEPRECADO** en la ruta de venta (ya no lo lee `computeSalePrice`). Se **conserva**
el dial (`settings.constants.ts`, `SETTING_DTO_MAP.salesMarkupPct`, M10 UI) como **palanca de rollback** durante un
release; su retiro definitivo (y el de la pura `computeSalePriceCents`) es follow-up. **Decisión abierta v1.13-3:**
retirar ya vs. conservar. Backend debe verificar que **no queden otros callers** de `computeSalePrice` (hoy solo
los 2 de arriba).

#### (e) 2.5 — Editor M2 (frontend) — clon de la sección de reglas de buylist

Nueva sección "**Reglas de precio de VENTA por rareza**" dentro de **`frontend/src/app/[locale]/(admin)/admin/m2/M2View.tsx`**
(el mismo archivo que ya aloja el editor de reglas de buylist), **no** en `BuylistView`. Fila por rareza
(`rarity → mode (fixed/pct) + value`) + campo de fallback, idéntico UX al editor de buylist. Requiere:
- `frontend/src/lib/api.ts`: `getSalesRarities()`, `getSalesRules()`, `updateSalesRules(input)` (clones de
  `getBuylistRarities`/`getBuylistRules`/`updateBuylistRules`, `api.ts:1382-1406`).
- `frontend/src/types/contract.ts`: `SalesRule`, `SalesRuleMode`, `SalesRuleApplied`, `SalesRulesDTO`,
  `SalesRaritiesResponse` (espejo de los `Buylist*`).
- `frontend/messages/{es,en}.json`: copys de la sección (etiquetas fixed/pct, ayuda "% ARRIBA de mercado").
- **Copy de UX (importante):** el editor debe dejar claro que en venta `pct` = **markup arriba de mercado** (no "% de
  la referencia" como en buylist), para no confundir al dueño. Redacción final → ux-ui/DESIGN_SYSTEM si aplica.

> **Coordinación con Fable (frontend):** Fable trabaja en `BuylistView`, `messages` y `api.ts` en paralelo. El editor
> de venta vive en **`M2View`** (archivo distinto de `BuylistView`) pero **también toca `api.ts` y `messages`**
> (adiciones, no ediciones de líneas existentes). El orquestador debe **secuenciar** el trabajo de esos dos archivos
> compartidos entre Fable y el frontend de Fase 2 para evitar conflictos de merge; no son colisiones de diseño, solo
> de archivo. `M2View`, `contract.ts` y los docs no chocan.

---

### 4.15 WS-A — Ingesta MASIVA de precios vía proveedor de PAGA (PokemonPriceTracker), pluggable (v1.14-price-ingest)

> **Reemplaza** el barrido por-carta frágil (re-sync completo de pokemontcg.io fire-and-forget en memoria, DEV-4) por un
> **job de ingest masivo por SET** que consume el **endpoint bulk** del proveedor de paga. Objetivo: catálogo con
> precios/variantes **completos y frescos**, sin "precio pendiente" masivo, con todos los acabados y la gráfica del hero
> con datos. **Toca dinero → triple veredicto.** **Aditivo, SIN migración de esquema.**

#### (a) Problema y doctrina

Hoy `PriceReference` se puebla durante el `catalog-sync` reusando `tcgplayer.prices` (v1.12, §4.13a); el refresco
2×/día (`catalog-price-sync`) lo hace vía **re-sync completo** (`syncAll({force:true})`). Ese barrido corre
**fire-and-forget en memoria del proceso** (`catalog-sync.service.ts` `syncAll` hace `void this.runSyncAll(batch)` y su
progreso vive en `syncAllStatus`, no persistido): **muere al reiniciar el proceso** (redeploys de Railway, crash, OOM),
**tarda horas** (~160 sets, ~15–25k cartas, cientos de requests secuenciales con backoff 429) y deja el catálogo con
**precios/variantes incompletos** → "precio pendiente" masivo, todo en acabado `normal` (los sets no alcanzados
conservan `availableFinishes=[normal]` y sin `PriceReference` de acabados no-`normal`) y la gráfica pública del hero vacía.

**Doctrina WS-A:** el **pricing del catálogo** lo hace un **proveedor de paga con descarga masiva** (bulk), enchufable
tras una interfaz, corrido por un job **por set, idempotente y reanudable** apoyado en BullMQ (cola persistida en Redis),
NO por un barrido per-carta detached de la memoria del proceso. La **metadata del catálogo** (nombres/imágenes/sets/
números/rareza + import de sets nuevos) sigue viniendo de pokemontcg.io (`catalog-sync`), que se **aligera** a solo eso.

> **Separación clave (independiente):** la **robustez del job** (fan-out BullMQ por set, awaited, reanudable) y la
> **elección de proveedor** (dial `PRICE_PROVIDER`) son ortogonales. Incluso con el proveedor `pokemontcg_io` (legacy)
> el nuevo job ya es robusto; el proveedor de paga aporta además **variantes completas** y **menos requests** (bulk por
> set). Esto permite un rollout money-safe: primero el job robusto, luego el flip del dial al proveedor de paga tras
> verificar el esquema en runtime.

#### (b) Interfaz `BulkPriceProvider` pluggable (backend, `modules/pricing`)

Interfaz **nueva** de ingest masivo, **distinta** del `PricingProvider` per-carta de §4.1 (que se **conserva** para el
refresco per-carta de bóveda `price-sync` y los stubs graded/sealed). Se nombra `BulkPriceProvider` (es la
«`PriceProvider`» pluggable del plan WS-A) para **no colisionar** con el `PricingProvider` ya existente.

```ts
// Fila NORMALIZADA por carta+acabado que devuelve el provider (el adapter ya la validó/omitió si venía mal formada).
interface BulkPriceRow {
  externalId?: string | null;     // id pokemontcg.io de la carta (mapeo PRIMARIO → Card.externalId, @unique)
  setExternalId?: string | null;  // mapeo FALLBACK: (set + number) → Card
  number?: string | null;
  finish: Finish;                 // YA mapeado a nuestro enum canónico (normal|reverse_holo|holofoil|first_edition_holofoil)
  marketCents: number;            // entero de centavos, > 0 (validado por el adapter)
  currency: 'USD' | 'MXN';        // moneda de ORIGEN del market (defensivo; se verifica en runtime, §h)
}
interface BulkPriceResult {
  rows: BulkPriceRow[];           // filas VÁLIDAS por (carta, acabado)
  fetchedRaw: number;             // entradas crudas recibidas del proveedor (observabilidad)
  skipped: number;                // entradas OMITIDAS por el mapeo defensivo (money-safe)
}
interface BulkPriceProvider {
  readonly source: PriceSource;   // 'pokemonpricetracker' | 'pokemontcg_io'
  /** Precios de un set completo en POCAS requests (bulk). El adapter valida y OMITE
   *  entradas mal formadas ANTES de devolver (nunca NaN/negativo/cero/acabado desconocido). */
  fetchPricesForSet(input: { set: CardSet }): Promise<BulkPriceResult>;
}
```

Implementaciones MVP:
- **`PokemonPriceTrackerBulkProvider`** (source `pokemonpricetracker`, **PRIMARIO**): llama `POST
  https://www.pokemonpricetracker.com/api/v1/cards/bulk-price` (host FIJO, anti-SSRF, patrón `PokemonTcgIoClient`) con
  `Authorization: Bearer ${POKEMONPRICETRACKER_API_KEY}` y body/params `{ set: <CardSet.externalId>, limit }`; pagina si
  el set excede `limit`. **El adapter** mapea el payload crudo → `BulkPriceRow[]` **defensivamente** (§d). Sin key o con
  key inválida → devuelve `{ rows: [], ... }` + log (no revienta; el ingest simplemente no escribe ese set — precios
  quedan **stale**, que es seguro, en vez de borrarse).
- **`PokemonTcgIoBulkProvider`** (source `pokemontcg_io`, **LEGACY/alterno**): envuelve el `PokemonTcgIoClient.getCardsBySet`
  existente (paginado) y extrae `prices[FINISH_TO_TCG_KEY[finish]].market` por acabado (misma lógica que hoy, pero
  detrás de la interfaz bulk). Permite `PRICE_PROVIDER=pokemontcg_io` como **rollback** sin la key de paga.

Selección: `PriceIngestService.providerFor()` lee el **dial `PRICE_PROVIDER`** (§h) y elige la implementación cuyo
`source` coincide. Nuevo plan de pago del proveedor = otra implementación + flip de dial, sin tocar el resto (§0).

#### (c) Job `price-ingest` (parent) + `price-ingest-set` (child por set) — robusto, idempotente, reanudable

Nuevo `PriceIngestService` (en `modules/pricing`) + jobs en `backend/src/jobs/`:

- **`price-ingest` (parent):** lista los `CardSet` **locales** (la metadata ya existe; NO se consulta `/sets` remoto para
  esto) y **encola un child `price-ingest-set` por set** en la cola BullMQ. Devuelve de inmediato (encola, no procesa).
- **`price-ingest-set` (child, `{ setId }`):** carga el `CardSet`, llama `provider.fetchPricesForSet({ set })`, **agrupa
  las filas por `cardId` resuelto** (§d) y por cada carta:
  1. **Precio (por acabado):** por cada `BulkPriceRow` de la carta, `priceMxnCents = row.currency==='MXN' ? row.marketCents
     : usdToMxnCents(row.marketCents, fx.rate, fx.bufferPct)`; **upsert idempotente** de `PriceReference`
     `(cardId, productType='raw', gradeKey='raw:NM', finish, capturedDate=hoy)` con `source='pokemonpricetracker'` (o
     `'pokemontcg_io'` en legacy), `priceUsdCents = currency==='USD' ? row.marketCents : null`. **Respeta
     `isManualOverride`** (si la fila de hoy es override del admin → **skip**, §4.1). Reusa/generaliza
     `PricingService.persistMarketReference` (hoy hardcodea `source='pokemontcg_io'` y asume USD; se extiende para aceptar
     `source` y moneda — ver A.5/§g).
  2. **Variantes:** refresca `Card.availableFinishes` desde el proveedor (§e).
- **Robustez (el corazón de WS-A):**
  - **Por set, no per-carta:** una descarga bulk por set (pocas requests) en vez de N fetches per-carta.
  - **Aislamiento de fallos:** cada set es su **propio** job BullMQ → un set que falla (429 persistente, payload roto)
    **no tumba** el resto; BullMQ reintenta ese job con backoff.
  - **Reanudable:** la cola vive en **Redis** (persistida), no en memoria del proceso. Un reinicio a media corrida deja
    los child jobs pendientes en la cola → se retoman solos (a diferencia del `syncAllStatus` en memoria de DEV-4).
  - **Idempotente:** upsert sobre la clave única `(cardId, productType, gradeKey, finish, capturedDate)` — re-correr el
    mismo día **actualiza** el precio (último market), no duplica; la 2ª corrida del día refina el precio de hoy.
  - **Single-flight del parent:** el disparo manual/cron no encola un 2º barrido si ya hay uno en curso (patrón
    `syncAllStatus.running`, o mejor: `jobId` determinista del día + `deduplication` de BullMQ). Backend decide el
    mecanismo exacto.
  - **FX una vez por corrida:** el `fx = FxService.getCurrent()` se carga una vez y se pasa a los child jobs (snapshot),
    no por-carta (paridad con `catalog-sync`, §4.13a).
- **Sin Redis (local/CI/manual):** si no hay `REDIS_URL`, el disparo manual (`POST /admin/jobs/price-ingest`) corre el
  ingest **secuencial y AWAITED** dentro del handler/worker (recorre sets uno a uno). **Nunca** fire-and-forget: aunque
  no haya fan-out por set, el trabajo se espera (a diferencia del `void runSyncAll` actual). Aceptable para dev/ops;
  en prod el scheduler con Redis da el fan-out robusto.
- **Pacing / rate-limit:** el bulk por set reduce ~100× el nº de requests frente al per-carta; aun así, secuencial entre
  sets + backoff del cliente HTTP. Cuota/coste del proveedor de paga = riesgo devops (§h, decisión abierta v1.14-2).

#### (d) Mapeo carta↔proveedor + mapeo DEFENSIVO (money-safe)

El **esquema exacto** del payload (campo de acabado/variante, de precio y de moneda) **se verifica en la 1ª corrida en
Railway** (desde dev el dominio está bloqueado por egress). Por eso **todo** el mapeo vive en el **adapter**, que:

- **Resuelve la carta local** (para no crear referencias huérfanas):
  1. **Primario:** `row.externalId` (id pokemontcg.io de la carta, ej. `sv8-123`) → `Card.externalId` (`@unique`, indexado).
  2. **Fallback:** `(row.setExternalId, row.number)` → `Card` (`where { set: { externalId }, number }`). *(Nota perf:
     no hay índice compuesto `(setId, number)`; el fallback es best-effort. Un índice sería una mejora **opcional** —
     migración aparte, no requerida por WS-A.)*
  3. Sin resolución → **omite** la fila + cuenta en `skipped` + log (no escribe nada).
- **Valida cada entrada (money-safe):** `market` numérico **> 0** (descarta `0`/negativo/`NaN`/ausente); acabado/variante
  mapeable a `Finish` por una tabla **conservadora** (mirror de `TCG_KEY_TO_FINISH` + los alias del proveedor que se
  confirmen en runtime); **variante desconocida → OMITE** (no se atribuye un precio holo a `normal` — eso sería un error
  de dinero). Moneda: si el payload la indica, se respeta; si es **ambigua/ausente**, se asume **USD** (el proveedor es
  de mercado US — TCGPlayer/eBay/PSA) y **se marca como supuesto a validar en la 1ª corrida** (decisión abierta v1.14-1;
  crítico: si en realidad fuera MXN, convertir USD→MXN inflaría ~18× → por eso el flip del dial al proveedor de paga
  **se gatea** con la verificación de esquema, §h).
- **Nunca** deriva el precio del cliente ni de un DTO — SEC-A1 intacto: la fuente es el proveedor server-side; `finish` se
  usa como **dimensión de la clave** de `PriceReference`, no como monto.

#### (e) Variantes (#8) — `Card.availableFinishes` derivado del PROVEEDOR

Reemplaza la derivación frágil de `tcgplayer.prices` (que en el barrido roto dejaba casi todo en `[normal]`). En el
`price-ingest-set`, tras agrupar las filas por carta:
- `providerFinishes` = conjunto de `finish` **distintos** de la carta con `marketCents > 0`.
- Si `providerFinishes` **no vacío** → `Card.availableFinishes = providerFinishes` (**autoridad**: el proveedor trae las
  variantes reales del mercado; #8). **Reemplaza** el set previo.
- Si `providerFinishes` **vacío** (carta no está en el proveedor, o sin filas válidas) → **se respeta** el valor existente
  (bootstrap de `catalog-sync`, §g); **nunca** se clobbea a `[normal]` ni a vacío (el schema exige ≥1; default `[normal]`).
- `availableFinishes` sigue siendo la **lista blanca SEC-A1** contra la que el buylist valida el `finish` del cliente
  (`422 FINISH_NOT_AVAILABLE`, §4.2.1). Consecuencia money-safe: si el proveedor **omite** un acabado que sí existe, el
  vendedor no podrá cotizarlo (falla **conservadora**: bloquea, no sobre-paga). Documentado.
- La derivación de `availableFinishes` usa las **variantes reportadas** por el proveedor, con independencia de si ese día
  se escribió la `PriceReference` (p. ej. si había override manual el precio no se pisa, pero el acabado sí cuenta como
  disponible).

#### (f) FX + colchón (#13) — aplica en cada ingest; y fix de UI

- **Aplica en cada ingest:** el ingest carga `FxService.getCurrent()` **una vez por corrida** (snapshot `{ rate,
  bufferPct }`) y aplica `usdToMxnCents(market, rate, bufferPct)` a cada fila **USD** → el **colchón (#13) entra en cada
  corrida**, por diseño (paridad con §4.13a). Filas en **MXN** → sin conversión ni colchón (el colchón es un cushion del
  riesgo FX USD→MXN; si el proveedor ya da MXN no hay FX que amortiguar).
- **Fix de UI (#13) — guardar SOLO el colchón sin fijar la tasa:** hoy `PUT /admin/fx` exige `{ rate, bufferPct }` y
  `FxService.setManual` **pinnea** `fx_manual_override_rate` (congela la tasa auto de Banxico). El dueño que solo quiere
  subir el colchón (3%→5%) termina fijando una tasa manual sin querer. **Solución recomendada (mínima, money-safe):** el
  colchón es un **dial de primera clase** (`fx_buffer_pct`) y `PUT /admin/settings` ya admite **body parcial** → M2 guarda
  el colchón **solo** con `PUT /admin/settings { fxBufferPct }` (**sin** tocar `/admin/fx`, sin pinnear tasa). **Nota
  para frontend** (M2). **Ajuste de correctness (backend, menor):** hoy `FxService.getCurrent()` en la rama auto-Banxico
  devuelve el `bufferPct` de la **fila `FxRate`** (escrito por el último `fx-refresh`), no el del dial, así que un cambio
  de colchón solo surte efecto tras el siguiente `fx-refresh`. Para que aplique **de inmediato** en el próximo ingest,
  `getCurrent()` debería preferir el `bufferPct` del **dial** en todas las ramas. Enrutado a **backend** (correctness).
  **Alternativa** (si el equipo prefiere mantener el colchón bajo el editor FX): hacer `rate?` **opcional** en `PUT
  /admin/fx` → si se omite `rate`, actualiza solo el colchón y **no** pinnea `fx_manual_override_rate` (ver contrato
  §M2). Recomendación: la vía del dial `fxBufferPct` (sin cambio de contrato de FX).

#### (g) Scheduling + aligerar `catalog-sync`

- **Scheduling (devops):** `price-ingest` **1–2×/día** vía el `SchedulerService` BullMQ existente (crons UTC configurables
  por env, p. ej. `PRICE_INGEST_CRON_1`/`_2`). El slot 2×/día que hoy ocupa `catalog-price-sync` (v1.12) se **repunta** a
  `price-ingest` para el **pricing**; se **conserva** un sync de **metadata** de catálogo (import de sets nuevos) en
  cadencia propia (p. ej. `sync-all {force:false}` diario o semanal — solo sets no importados, barato). Orden con FX:
  como el ingest necesita FX fresco, `fx-refresh` debe correr **antes** de cada `price-ingest` (`FxService.getCurrent()`
  degrada al último `FxRate` si falta, así que el orden es **suave** pero recomendado). Horarios exactos = **devops**
  (decisión abierta v1.14-3).
- **Aligerar `catalog-sync` (backend, A.5):** `catalog-sync` vuelve a **solo metadata**:
  - Se **quita** la llamada `persistMarketReferences` de `upsertCards` (y las deps `PricingService`/`FxService` que v1.12
    inyectó a `CatalogSyncService`). `catalog-sync` deja de escribir `PriceReference`.
  - `deriveAvailableFinishes(tcgplayer.prices)` se **conserva** como **bootstrap** (default seguro para un set recién
    importado, antes de su primer `price-ingest`); `price-ingest` lo **sobre-escribe** con las variantes del proveedor
    (§e). *(Alternativa: quitarlo también y dejar `[normal]` hasta el primer ingest; se prefiere conservarlo para que un
    set nuevo sea usable de inmediato. Decisión menor, backend.)*
  - `persistMarketReference` (en `PricingService`) se **generaliza**: hoy hardcodea `source='pokemontcg_io'` y asume USD;
    pasa a aceptar `source: PriceSource` y `currency` (o un `priceMxnCents` ya convertido) para servir al ingest de paga.
  - **`catalog-price-sync` (v1.12) queda DEPRECADO en su rol de pricing** (su `force:true` re-bajaba todo el catálogo solo
    para refrescar precios; ahora lo hace `price-ingest`, mucho más barato). Su función de **import de sets nuevos** se
    mantiene con `force:false`. `set-price-sync` (v1.9) queda **más** subsumido aún (el ingest precia todo el catálogo,
    incluido el set del hero); se conserva inocuo, retiro opcional en fase 2.

#### (h) Config / env / contrato

- **Env (secreto):** `POKEMONPRICETRACKER_API_KEY` — **ya aprovisionada en Railway** (NUNCA en el repo; el código solo
  lee `process.env`). Pasa a ser **requisito operativo en prod** cuando `PRICE_PROVIDER=pokemonpricetracker`. Recomendación
  devops: añadirla a la lista *required* de `env.validation.ts` en no-local **solo** si el dial apunta al proveedor de
  paga (o dejarla opcional y que el ingest degrade a "no escribe / precios stale" con alerta en `dataHealth`). Money-safe:
  si el proveedor de paga está seleccionado pero la key falta/está inválida, **no** se borran precios (se dejan stale) y se
  loguea/alerta; **no** hay fallback silencioso a otra fuente (evita mezclar fuentes sin querer). Ver decisión abierta v1.14-2.
- **Dial `PRICE_PROVIDER` (`price_provider`, ConfigSetting):** selecciona el `BulkPriceProvider` de ingest. Valores
  `pokemonpricetracker | pokemontcg_io`. Editable **sin redeploy** (M2/M10) → palanca de **rollback** money-safe. **Seed
  recomendado (rollout money-safe): `pokemontcg_io`** (no cambia el comportamiento de fuente al desplegar; el job ya es
  robusto) y **devops flip a `pokemonpricetracker`** tras verificar el esquema en la **1ª corrida manual** (`POST
  /admin/jobs/price-ingest` con `setId?` de un set conocido → inspeccionar `PriceReference`/logs). Alternativa: sembrar
  `pokemonpricetracker` desde el arranque (la key ya está) asumiendo la verificación previa. Decisión abierta v1.14-4.
- **Disparo manual:** `POST /api/v1/admin/jobs/price-ingest` (super_admin, auditado, single-flight; familia §M10-ops).
  Acepta `setId?` **opcional** (excepción justificada al body-vacío de la familia): un solo set para **verificar el
  esquema** en la 1ª corrida sin barrer el catálogo entero. Ver `API_CONTRACT.md §M10-ops`.
- **Contrato:** `POST /admin/jobs/price-ingest` (nuevo, §M10-ops); dial `priceProvider` en el DTO de `/admin/settings`
  (§M10); nota de que `CardDTO.availableFinishes` pasa a **derivarse del proveedor** (mismo shape); `PUT /admin/fx` gana
  `rate?` opcional (#13, alternativa). Sin migración de esquema.
- **Sin migración:** WS-A reusa `PriceReference` (finish en la clave, M-18), `PriceSource.pokemonpricetracker` (ya en el
  enum) y `Card.availableFinishes`. El dial `PRICE_PROVIDER` es una fila de `ConfigSetting` (dato, no esquema).

---

### 4.16 WS-C — Cotizador de buylist (Fable) contra el backend real (v1.15-buylist-batch-clabe)

> **Objetivo:** que el cotizador rediseñado del frontend funcione contra el backend real sin los mocks/atajos
> actuales. Tres piezas: (a) **CLABE opcional** con fallback server-side (PII), (b) **batch quote** (mata el
> fan-out FE-12), (c) **flags de KYC en archivo** para que el front oculte lo que ya está. **Aditivo, SIN
> migración.** TOCA DINERO/PII → triple veredicto. SEC-A1 intacto.

#### 4.16a — CLABE opcional + fallback server-side (PII)

**Problema.** `CreateRequestDto.clabe` es **obligatoria** (`backend/src/modules/buylist/dto/buylist.dto.ts:51`,
`@IsString() clabe!: string`). El cliente solo posee `clabeMasked` (`GET /users/me/kyc` nunca devuelve la CLABE en
claro), así que el atajo "usar mi CLABE en archivo" del cotizador **no puede** rearmar los 18 dígitos y hoy es
**mock-only** (`frontend/src/lib/api.ts:542-550`, flag `useClabeOnFile` que **no** viaja al backend real).

**Decisión.** `clabe` pasa a **opcional** en `POST /buylist/requests`. El backend resuelve la CLABE efectiva así
(pseudocódigo — lo implementa **backend**):

```ts
// createRequest(userId, items, clabe?, ineUploadKeys?)
const kyc = await prisma.kycProfile.findUnique({ where: { userId } }); // SIEMPRE del userId autenticado
let effectiveClabe: string;
if (clabe) {
  if (!isValidClabe(clabe)) throw CLABE_INVALID;                       // formato 18 dígitos (sin cambio)
  // match a nombre propio contra la CLABE en archivo (blind index HMAC, sin descifrar) — sin cambio:
  if (kyc?.clabeHmac && !blindIndexEquals(kyc.clabeHmac, clabeBlindIndex(clabe))) throw CLABE_NOT_OWN_NAME;
  effectiveClabe = clabe;
} else {
  // FALLBACK server-side: la CLABE del PROPIO usuario, misma fuente que revealClabe (buylist.service.ts:453-457)
  effectiveClabe = pii.decryptOptional(kyc?.clabeEnc) ?? null;
  if (!effectiveClabe) throw CLABE_REQUIRED;                           // 422 nuevo: ni en request ni en archivo
}
const clabeEnc = pii.encrypt(effectiveClabe);                         // se SNAPSHOTEA cifrada en la solicitud
// ... resto del flujo (topes, INE, persistencia, clabeSnapshotEnc = clabeEnc) sin cambio
```

**Garantías (obligatorias, verifica seguridad):**
- **Autorización estricta.** El fallback lee `kyc` **por `userId` de la sesión**; es imposible resolver la CLABE de
  otro usuario. El endpoint es `customer`-scoped y el `EmailVerifiedGuard` ya aplica.
- **PII nunca en claro fuera del reveal.** `effectiveClabe` **no se loguea** (ni en `AuditLog`, ni en logs de app) y
  **no se devuelve** en la respuesta (`{ sellRequestId, status, quotedTotalCents, ineRequired, items }` no contiene
  CLABE). Se guarda **solo cifrada** (`clabeSnapshotEnc` + `KycProfile.clabeEnc`). El único punto de exposición en
  claro sigue siendo `GET /admin/buylist/:id/reveal-clabe` (super_admin, money-out, auditado, §3.4).
- **Snapshot en el momento de la solicitud.** Se snapshotea la CLABE **resuelta** en `clabeSnapshotEnc` para que el
  pago SPEI use la CLABE vigente al crear la solicitud aunque el usuario cambie luego su KYC. `revealClabe` ya prioriza
  el snapshot y cae a `kyc.clabeEnc` (sin cambio), por lo que **no requiere tocarse**.
- **Sin debilitar controles.** Cuando `clabe` **sí** viaja, el path actual (formato + nombre propio + persistencia) es
  idéntico. El fallback **no** puede inyectar una CLABE de tercero ni saltarse el match (es, por definición, la propia).

#### 4.16b — Batch quote (`POST /buylist/quote/batch`) — mata el fan-out FE-12

**Problema (FE-12, TECH_DEBT).** `POST /buylist/quote` es **por-carta**; el grid del cotizador monta un `useQuery`
**por resultado visible** → una búsqueda dispara ~`pageSize` (≤20) quotes en ráfaga, y el bulk "agregar al carrito" es
`Promise.all` **all-or-nothing** (un fallo aislado bloquea el lote). El disparador registrado para saldarlo es
"**cuando exista el endpoint batch quote (Fase 3b)**".

**Decisión.** Endpoint **NUEVO** `POST /buylist/quote/batch` (`public`, **READ-ONLY**), que cotiza **N cartas en 1
request** con **errores por-ítem**. Es un **`map` de `publicQuote` sobre `items[]`** compartiendo `buylistRules()`
(un solo read de config) — **misma matemática y mismos guardarraíles** que el cotizador por-carta:

- **Reuso de pricing.** Cada ítem: `assertFinishAvailable(card, finish)` → `getReference(cardId, productType,
  gradeKey, finish)` → `quoteAcquisitionForFinish(card.rarity, finish, ref, rules, fallbackPct)`. Idéntico a
  `buylist.service.ts:57-102`. Incluye el **gate premium** (§4.2.1), reglas por rareza (`BUYLIST_PRICE_RULES`),
  fallback pct, `precio_pendiente` cuando `pct` y falta referencia del acabado. La FX ya está bakeada en
  `PriceReference` (MXN), así que la coherencia con el resto del sistema es automática.
- **READ-ONLY estricto.** No crea `SellRequest`, no mueve dinero, no persiste y **no** llama `escalatePending`
  (endpoint anónimo; escalar desde aquí sería superficie de abuso — misma razón que llevó a `publicQuote` a read-only
  en v1.12). La escalada a `PendingPriceEntry` sigue **solo** en `POST /buylist/requests` (autenticado).
- **Errores por-ítem.** Una carta inválida **no** tumba el lote: cada resultado es `ok:true` (con la cotización) u
  `ok:false` (con `error.code` = `NOT_FOUND` | `FINISH_NOT_AVAILABLE`, los mismos que el endpoint por-carta
  devolvería como 404/422). **HTTP global = 200.** Correlación por **`index`** (posición 0-based en `items`) + eco de
  `cardId` (un mismo `cardId`+`finish` puede repetirse; el `index` es la llave robusta).
- **Cap.** `BUYLIST_QUOTE_BATCH_MAX = 50` ítems por request (constante de servidor; cubre `pageSize` 20 del grid con
  holgura sin ser vector de abuso). `items` vacío o por encima del cap → `400 VALIDATION_ERROR` (via
  `@ArrayNotEmpty` + `@ArrayMaxSize(50)`). Cuenta como **1** request contra el throttle público (colapsa el fan-out;
  **reduce** presión sobre el límite 300/min citado en FE-12).
- **SEC-A1.** Rareza y acabado se derivan **server-side** de `Card.rarity` y del `finish` validado contra
  `Card.availableFinishes`; el cliente nunca envía precio/monto/regla.

**Modelo de cotización = una línea por carta física (SIN `qty`).** El modelo actual (`PublicQuoteDto`,
`SellRequestItem`) es **one-line-per-card**; no existe multiplicador de cantidad. El batch **espeja** los campos del
cotizador por-carta (`cardId`, `productType`, `rawCondition?`, `finish?`) y **no** introduce `qty` (sería un cambio de
producto, no una traducción del modelo actual). Ver decisión abierta **WS-C-2** en §10.

#### 4.16c — INE/CLABE en archivo expuestos al front

- **`ineOnFile` ya existe** (`users.service.ts:139` = `Boolean(kyc.ineFrontKey && kyc.ineBackKey)`; contrato §1). El
  front lo consume para **ocultar los uploaders de INE** cuando ya está en archivo y **omitir** `ineUploadKeys` en
  `POST /buylist/requests`. El backend ya trata el INE en archivo como "provisto" para el umbral AML
  (`buylist.service.ts:209-211`), así que ocultar los uploaders es seguro: la solicitud sobre el tope no se rechaza por
  `INE_REQUIRED` si el INE ya está.
- **`clabeOnFile: boolean` (NUEVO, aditivo)** = `Boolean(kyc.clabeEnc)`, para dar al front un booleano **limpio y
  simétrico** a `ineOnFile`. Habilita el atajo "usar mi CLABE ****1234" (= **omitir** `clabe`, resuelto por 4.16a) sin
  que el front tenga que inferirlo de la presencia de `clabeMasked`. `clabeMasked` se conserva para pintar el label.
  Sin PII nueva.

#### Reparto de trabajo

- **Backend:** (1) `CreateRequestDto.clabe` → `@IsOptional() clabe?: string` y la resolución/fallback de 4.16a con el
  nuevo `422 CLABE_REQUIRED`; asegurar que la CLABE resuelta **no** se loguea y se snapshotea cifrada. (2) Nuevo
  controlador/servicio `POST /buylist/quote/batch` (public, read-only) que mapea `publicQuote` con `@ArrayNotEmpty` +
  `@ArrayMaxSize(50)` y agrega errores por-ítem. (3) `getKyc` añade `clabeOnFile`. Tests: fallback usa solo la CLABE
  propia; `CLABE_REQUIRED` cuando no hay ninguna; batch con 1 carta inválida devuelve 200 + error por-ítem; batch
  respeta el cap; equivalencia numérica batch vs por-carta.
- **Frontend:** (1) sustituir el fan-out por-resultado y el `Promise.all` all-or-nothing por **1** llamada a
  `/buylist/quote/batch` por página, con render **parcial-tolerante** (mostrar lo cotizado, marcar lo fallido por
  `error.code`). (2) Retirar el flag mock `useClabeOnFile`: si `clabeOnFile` → ofrecer "usar mi CLABE ****1234" y
  **omitir** `clabe` en `POST /buylist/requests`; si no → pedir CLABE. (3) Ocultar uploaders de INE cuando `ineOnFile`.
  (Extracción de hooks/subcomponentes de `BuylistView` = FE-13, oportunista.)
- **Devops/QA/seguridad:** triple veredicto (toca dinero/PII). E2E: cotizar un lote, crear solicitud con CLABE en
  archivo (sin reteclear) y con INE en archivo (sin resubir); pentest del fallback (no fugar/loguear CLABE; no resolver
  la de otro usuario).

### 4.17 WS-E — Master Set + inventario a escala (M1) (v1.16-master-set)

**Problema.** M1 no escala: el alta es 1×1 (`M1View` abre un modal, elige carta, crea una pieza) y la lectura es una
tabla plana paginada de piezas (`GET /admin/inventory/items`). Para inventariar una colección real (miles de cartas,
cada set con ~150–400 cartas × varios acabados) el dueño necesita (a) ver **de un vistazo** qué tiene y qué falta por
set y acabado, y (b) **dar de alta y publicar por lote**. **Invariante que NO cambia:** sigue habiendo **1
`InventoryItem` por pieza física** (la custodia por-pieza, folios, ubicación y movimientos lo exigen). WS-E es
**agregación de lectura** + **lote de escritura** encima del mismo modelo.

**#### 4.17a Lectura agregada (binder).**
- **Índice de sets** (`GET /admin/inventory/master-sets`): resumen por set. Consulta **fija, sin N+1** siguiendo el
  patrón de `set-value.service.ts:computeSetValue` (2–3 queries en lote, agregación en memoria):
  1. página de `CardSet` (con `q`/`sort`/paginación);
  2. `Card.groupBy({ by:[setId], _count })` → `catalogCardCount` por set;
  3. **una** agregación cruzada `InventoryItem ⋈ Card` para los `setId` de la página (raw SQL:
     `SELECT c."setId", COUNT(*) pieces, COUNT(DISTINCT ii."cardId") distinctCards FROM "InventoryItem" ii JOIN "Card"
     c ON c.id=ii."cardId" WHERE ii."ownerType"='platform' AND ii.status NOT IN (…) AND c."setId" = ANY($ids) GROUP BY
     c."setId"`). Es 1 query por página, no por set.
  `completionPct = distinctCardsOwned / catalogCardCount × 100` (denominador = **catálogo real**, no `printedTotal`,
  para no dar >100% con secret rares; se expone también `printedTotal` para que el front muestre "X / printedTotal" si
  quiere). Ver decisiones abiertas **WS-E-1/2**.
- **Binder del set** (`GET /admin/inventory/master-sets/:setId`): una `MasterSetCardCellDTO` por `Card` del set.
  Consulta fija: (1) `Card WHERE setId`; (2) **una** agregación `groupBy [cardId, finish]` (o raw) de piezas on-hand
  → `countsByFinish`. Sirve el índice **M-21** `@@index([cardId, finish, status])`.
- **Orden natural (obligatorio) — v1.16.1 CORREGIDO.** `Card.number` es **String**; el orden lexicográfico rompe
  ("10"<"2"; promos `TG12`). El requisito es: **numéricos puros por valor entero primero, promos/subsets alfabéticos
  (TG/GG/SV) al final agrupados por prefijo**. La fórmula ilustrativa previa
  (`NULLIF(regexp_replace(number,'\D','','g'),'')::int`) era **incorrecta**: convertía `TG12`→`12` e intercalaba el
  promo entre las numéricas (contradice "promos al final"). El backend implementó el correcto — el entero solo se
  parsea cuando `number ~ '^[0-9]+$'`:
  `ORDER BY (number ~ '^[0-9]+$') DESC, CASE WHEN number ~ '^[0-9]+$' THEN number::int END NULLS LAST,
  regexp_replace(number,'[0-9]','','g'), NULLIF(regexp_replace(number,'\D','','g'),'')::int, number`.
  `numberSort` (DTO) = el entero para numéricas; sentinela que empuja al final para promos.
- **`isSecretRare` — heurística SOLO de display (v1.16.1 afinado).** `true` **solo** para cartas de la numeración
  **principal** (número puramente numérico) cuyo entero **> `printedTotal`** (secret/hyper rare real); promos/subsets
  con prefijo alfabético (TG/GG/SV) → `false` (subset aparte); `printedTotal` nulo → `false`. **Decisión de producto
  (default propuesto):** el subset se distingue por prefijo alfabético, no cuenta como secret rare. La forma amplia
  previa (`numberSort > printedTotal` sin más) marcaba TODOS los promos → **deuda BE-36** (§9). El front hace
  **filtros locales** (rareza/acabado/faltantes/secret) sobre la respuesta completa (no paginada; un set es acotado —
  virtualización = fase 2).

**#### 4.17b Escritura por lote.**
- **Alta por lote** (`POST /admin/inventory/items/batch`): reusa la lógica de `inventory.service.ts:create` por línea,
  dentro de una iteración **tolerante a fallos** (una línea que lanza `BusinessException` se captura y se reporta como
  `ok:false` sin abortar el lote → commit parcial). **`qty`** expande a N filas (bulk raw/sellado; graded=1). Los
  folios del lote se reservan **consecutivos** con el nuevo `PrismaService.nextFolios(n)` (una llamada
  `SELECT nextval(...) FROM generate_series(1,n)` en vez de N round-trips). **Idempotencia + auditoría por lote:** el
  `batchKey` se persiste en el nuevo modelo `InventoryBatch` (M-21) junto con el resultado; un replay devuelve el
  resultado guardado (`idempotentReplay:true`) sin re-crear. `InventoryBatch` **es** el registro de auditoría del lote.
- **Publicación por lote** (`POST /admin/inventory/items/bulk-publish`): por pieza, `status→listed` + precio
  **derivado** de las reglas de venta por rareza+acabado (§4.14, `computeSalePriceForItem`, SEC-A1) o **manual**
  (`listPriceCents`). Una pieza cuyo precio no se resuelve (`pct` sin market) → `PRICE_PENDING`, **no** se publica
  (regla "solo se lista lo que tiene precio", §4.9). Errores por-línea; re-publicar = no-op idempotente.
  - **Status de origen publicable (v1.16.1, guardarraíl anti double-sell).** SOLO `{in_stock, listed}` son publicables:
    `in_stock` → publica (`→listed`); `listed` → **no-op idempotente**; **cualquier otro** status (`reserved |
    in_custody | picking | shipped | delivered | lost | damaged | withdrawn`) → **`422 ITEM_NOT_PUBLISHABLE`** por-línea,
    **no** se publica. Esto cierra el double-sell señalado por seguridad: una pieza **reservada/vendida/en-custodia/
    enviada** no puede regresar a `listed`. `ITEM_NOT_PUBLISHABLE` es **distinto** de `PRICE_PENDING` (precio no resuelto).

**#### 4.17c Deuda pagada (parte del alcance de WS-E).**
- **`PricingService.getReferencesBatch(items)`** (cierra **RB-8/BE-4/D3**): resuelve la "referencia vigente = más
  reciente por acabado" para N ítems en **1** query (`WHERE (cardId,productType,gradeKey,finish) IN …`, orden
  `capturedDate desc`, primera por clave). Lo usan `bulk-publish` y el binder, y queda disponible para `holdings`/
  `ownedItemRefs`/`inventoryValue` (misma dirección que la deuda diferida).
- **BE-25 (pago mínimo):** `fetchSellable` y `bulk-publish` **izan** `SALES_PRICE_RULES`+fallback **una vez por
  request** (en vez de 2 lecturas de settings sin cache por ítem) y usan `getReferencesBatch`. Cierra el N+1 de
  settings en la ruta de venta; el resto de BE-25 (memoización global de `SettingsService`) queda como deuda menor.

**#### 4.17d Reuso.** El binder (grid por número + acabados disponibles con `countsByFinish`) es la **misma superficie**
que ya usa el picker de catálogo del cotizador (`GET /buylist/cards`) y la de Compra: back-office la usa para
**inventariar**; el cotizador/Compra, para **elegir carta+acabado**. El front puede compartir el componente de
cuadrícula (celda = carta+acabados); solo cambia la acción (agregar-al-carrito vs cotizar vs comprar).

#### Reparto de trabajo
- **Backend (M1):** (1) `GET /admin/inventory/master-sets` + `/:setId` con las agregaciones fijas (raw SQL/groupBy,
  sin N+1) y el orden natural de `number`. (2) `POST /admin/inventory/items/batch` (iteración tolerante a fallos,
  `qty`, idempotencia `InventoryBatch`, auditoría). (3) `POST /admin/inventory/items/bulk-publish` (derivación de
  precio server-side, errores por-línea). (4) `PrismaService.nextFolios(n)`. (5) `PricingService.getReferencesBatch`
  + pago mínimo de BE-25. (6) Migración M-21 (índice + `InventoryBatch`). Tests: agregados coinciden con conteos
  reales; orden natural ("10">"2", `TG12` al final); batch con 1 línea inválida devuelve 200 + resto creado; replay de
  `batchKey` no duplica; bulk-publish con `pct` sin market → `PRICE_PENDING` sin publicar; sin N+1 (conteo de queries).
- **Frontend (M1):** (1) **índice Master Set** (grid de sets con completitud/piezas, ordenable). (2) **binder** del set
  (cuadrícula por número; celda con imagen, número, `countsByFinish`, badges de acabado; resaltar huecos y secret
  rares; **filtros locales** rareza/acabado/faltantes). (3) **carrito de captura** (#12): acumular líneas → 1 POST
  `/batch` → render **parcial-tolerante** (folios creados / errores por-línea). (4) **publicación masiva**: seleccionar
  N piezas → `/bulk-publish` con precio derivado/manual → resultados por-línea. Reusa el componente de cuadrícula del
  picker existente.
- **Devops/QA:** doble veredicto (no toca dinero saliente; la publicación deriva precio server-side). E2E: inventariar
  un set por el binder (alta por lote de varias cartas/acabados), ver el conteo agregado actualizarse, publicar en
  lote, y confirmar que el replay del carrito no duplica.

---

### 4.18 WS «Catálogo y precios» — M5 operable: rechazo de ítem con plazos + correo al vendedor (v1.18-buylist-rejects)

> Norma la parte del ciclo de buylist que faltaba tras la decisión `reject` (PROJECT §H / criterios 15–16): hoy el
> rechazo solo cambia `itemStatus` — sin motivo, sin fechas, sin notificación al vendedor y con un hueco de dinero
> (BL-1, §9). API_CONTRACT v1.18 (§M5) tiene los shapes; aquí van las decisiones de diseño.

**a) Ancla única de plazos = `rejectedAt` (persistido, M-22).** `SellRequestItem` no tiene NINGÚN timestamp propio
(ni `updatedAt`); `adjustmentSentAt` vive en la solicitud y solo aplica al flujo `adjust`; y `AuditLog` no es fuente
válida para lógica de plazos (cross-módulo, sin índice útil, semántica de bitácora). Por eso `rejectedAt` (y el
`rejectionReason` que exige el correo y la pestaña «Rechazadas») son columnas **imprescindibles** — las ÚNICAS de esta
versión. Los plazos **NO se persisten**: `returnDeadlineAt = rejectedAt + 7d` y `abandonDeadlineAt = rejectedAt + 30d`
se derivan al proyectar, con constantes de servidor de la **misma familia 7d/30d** que `buylist-sweep.service.ts`
(coherencia: el sweep ancla el 7d del AJUSTE en `adjustmentSentAt` y el 30d de abandono de solicitud en `createdAt`;
el ítem RECHAZADO ancla ambos en `rejectedAt` = momento en que se decide y se notifica). **Sin transición automática
del ítem al vencer**: las fechas son informativas para back-office y vendedor; el sweep a nivel solicitud no cambia, y
la retención física post-abandono se administra manualmente (la carta jamás se vuelve vendible — guardia
`ITEM_NOT_APPROVED`).

**b) Invariante de dinero (cierra BL-1).** `reject` ⇒ `approvedPriceCents = null` **antes** de
`recomputeApprovedTotal`. Defensa en profundidad recomendada a backend: que el aggregate del recompute además excluya
`itemStatus='rechazada'` (así el invariante sobrevive a escrituras futuras que olviden anular el monto). Observable
normado: `approvedTotalCents` NUNCA incluye ítems rechazados; `quotedTotalCents` no se recalcula.

**c) Correo de rechazo — mecanismo (decisión de diseño).** El módulo `mail` pertenece al stream «Cuentas y acceso» y
**NO se toca**. `buylist` inyecta el **puerto público `MAIL_PORT`** (interfaz genérica `send({to, subject, html,
text})`; el `MailModule` ya es `@Global` y exporta el token) y renderiza con **plantilla LOCAL al módulo buylist**
(p. ej. `backend/src/modules/buylist/buylist-mail.templates.ts`), bilingüe **ES/EN por `User.locale`** y con el
**mismo layout/branding y disciplina de escape HTML (S15-B1)** que `mail.templates.ts`. Firma sugerida:
`sellItemRejectedTemplate({ cardName, setName, cardNumber, finish, reason, returnDeadlineAt, abandonDeadlineAt },
name, locale) → MailMessage`. **Deuda aceptada:** la plantilla (y el helper de layout duplicado) vive fuera de `mail/`
hasta que el stream «Cuentas y acceso» la absorba en `MailService` — backend la registra en `docs/TECH_DEBT.md`.
- **Best-effort:** el envío corre **después** del commit de la decisión; su fallo se loggea (`logger.error`) y **no**
  revierte ni falla el request. Sin cola de reintentos en MVP (parte de la misma deuda).
- **Disparo:** SOLO en la transición a `rechazada` (re-`reject` idempotente ⇒ no re-envía).
- **Minimización de datos:** el correo lleva carta (nombre/set/número), acabado, `reason` y los dos plazos con el
  canal de coordinación (soporte@tcgvaultmx.com). **Prohibido:** CLABE (ni enmascarada), montos o estado de OTROS
  ítems de la solicitud, cualquier dato de terceros.

**d) Identidad del vendedor en M5 (PII).** `seller: { id, name, email }` en `GET /admin/buylist`,
`GET /admin/buylist/:id` y `rejected-items`. El correo del vendedor es **dato de contacto operativo** de un
back-office ya restringido por rol (`vault_operator`/`super_admin`) — **no** es secreto financiero como la CLABE, así
que **no** requiere enmascarado, reveal dedicado ni auditoría por lectura (explícito para que nadie lo "endurezca" por
analogía con `reveal-clabe`, ni lo relaje: la CLABE conserva su régimen íntegro).

**e) Pestaña «Rechazadas».** Endpoint dedicado `GET /admin/buylist/rejected-items` (ítem-céntrico, transversal a
solicitudes) en vez de forzar al front a paginar solicitudes y filtrar ítems. Orden `rejectedAt desc` (legacy `null`
al final); la fase (ventana de devolución / de abandono / abandonada) se deriva en el front comparando `now` con las
dos fechas. Índice recomendado `@@index([itemStatus])` (parte de M-22) para no barrer la tabla.

---

### 4.19 WS «Catálogo y precios» — Referencia de mercado del SELLADO vía TCGCSV (v1.19-sealed-tcgcsv)

> **Objetivo:** darle al admin un **valor de referencia de mercado** para el producto sellado (ETB, booster box,
> bundle, tin, blister) usando **TCGCSV** (tcgcsv.com): espejo **diario** (~20:00 UTC), **estático** (JSON servido como
> archivos), **gratuito y sin API key** de los precios de TCGplayer, que **sí cubre sellado** (pokemontcg.io no).
> **Toca precios (dinero informativo) → triple veredicto.** Aditivo; **UNA migración (M-23, §11)**.

#### (a) Doctrina y PRECEDENCIA (PROJECT decisión 3e manda — el modelo de venta del sellado NO cambia)

- El precio TCGCSV es **VALOR DE REFERENCIA informativo/sugerencia**, nunca precio de venta. Sigue intacto:
  el sellado se **vende** con `listPriceCents` **manual del admin en MXN, obligatorio para publicar** (PROJECT 3e,
  criterio 3e, §3.6, y la regla de M1/bulk-publish "sellado sin `listPriceCents` → `PRICE_PENDING`").
- **Lo que la referencia TCGCSV NO hace (norma explícita):**
  1. **NO auto-publica** ni fija/actualiza `listPriceCents` (ni siquiera como default del formulario — el admin
     teclea; el front puede MOSTRAR la sugerencia al lado).
  2. **NO encola `PendingPriceEntry`**: un sellado sin mapeo/sin precio TCGCSV simplemente no tiene referencia
     (`sealedMarketRef=null`); esa cola sigue reservada a los bloqueos reales de publicación/valuación.
  3. **NO cambia el costo de aportación en especie** del sellado: sigue el flujo actual (`getReference` con
     `gradeKey='sealed'` = override manual del admin, o escalación). Usar TCGCSV como base del costo = decisión del
     humano (pregunta abierta v1.19-2), porque mueve dinero (P&L).
  4. **NO se expone en la superficie pública** (ficha de Compra) en esta versión: criterio 2 de PROJECT define la
     fuente del sellado como "precio manual del admin"; mostrar un "valor de mercado" público del sellado tocaría
     PROJECT (pregunta abierta v1.19-1). Exposición v1.19 = **solo back-office** (M1 detalle/listado, M2 curación).
- **Dónde se ve:** M1 (`GET /admin/inventory/items[/:id]`) expone `sealedMarketRef: PriceInfo` (source `tcgcsv`) +
  el mapeo; M2 tiene la curación. Contrato en API_CONTRACT v1.19.

#### (b) Adapter `TcgcsvSealedBulkProvider` — nueva interfaz, SEPARADA del bulk de cartas

**Decisión de interfaz:** NO se reusa `BulkPriceProvider` (§4.15b). Aquella interfaz es por **carta+acabado** con
resolución `Card` (externalId / set+number) — nada de eso aplica al sellado, que se keyea por **`tcgplayerProductId`**
y no tiene carta remota que resolver. Forzarla obligaría a campos sin sentido (finish, externalId). Interfaz nueva en
`pricing.types.ts` (pseudocódigo normativo; nombres exactos los decide backend manteniendo la semántica):

```ts
interface SealedPriceRow {
  tcgplayerProductId: number;  // productId de TCGplayer/TCGCSV (clave del mapeo M-23)
  marketCents: number;         // entero > 0 (validado por el adapter); marketPrice, o midPrice si market falta (ver d)
  usedFallbackMid: boolean;    // observabilidad: true si el precio salió de midPrice
  currency: 'USD';             // TCGCSV publica SIEMPRE USD (precios TCGplayer)
}
interface SealedBulkPriceResult { rows: SealedPriceRow[]; fetchedRaw: number; skipped: number; }

interface SealedBulkPriceProvider {
  readonly source: PriceSource;  // 'tcgcsv' (M-23)
  listGroups(): Promise<TcgcsvGroupRef[]>;                          // curación M2: { groupId, name, abbreviation?, publishedOn? }
  listSealedProducts(groupId: number): Promise<TcgcsvProductRef[]>; // curación M2: { productId, name, cleanName?, imageUrl? }
  fetchSealedPricesForGroup(groupId: number): Promise<SealedBulkPriceResult>; // ingest
}
```

Implementación **`TcgcsvSealedBulkProvider`** en `backend/src/modules/pricing/providers/tcgcsv-sealed.provider.ts`:

- **Endpoints estáticos, host FIJO `https://tcgcsv.com`** (anti-SSRF, mismo patrón `PokemonTcgIoClient`):
  `/tcgplayer/3/groups`, `/tcgplayer/3/{groupId}/products`, `/tcgplayer/3/{groupId}/prices`. La **categoría Pokémon
  = 3 es CONSTANTE de servidor** (no configurable, no viene del cliente). Todo `{groupId}` interpolado en un path se
  **valida como entero positivo** server-side ANTES (nunca un string del cliente al path). **Sin API key** (no hay
  secreto nuevo). Timeout corto + sin seguir redirects fuera del host + `Accept: application/json`.
- **Filtro "sellado" en `/products` (heurística conservadora, a confirmar con fixtures/1ª corrida):** un product **sin**
  `extendedData` de carta individual (sin entradas `Number`/`Rarity`) se considera **sellado**; los que las traen son
  singles y se descartan del explorador de curación. Si la heurística falla para algún producto, la curación es manual
  de todos modos (el admin ve nombre y decide) — la heurística solo limpia la lista, no decide dinero.
- **Money-safe (misma doctrina que §4.15d):**
  - `subTypeName !== 'Normal'` → se **OMITE** la fila + cuenta en `skipped` (el sellado se pricia solo en su sub-tipo
    base; nunca se atribuye el precio de un sub-tipo raro al producto).
  - `marketPrice` (o su fallback `midPrice`) ausente / `NaN` / `<= 0` → se **OMITE**.
  - Fallo de red/parse a media corrida → devuelve lo acumulado + log; **NUNCA se borran precios previos** (quedan
    stale, que es seguro — paridad con el legacy `PokemonTcgIoBulkProvider`).
  - `lowPrice`/`highPrice` **no se persisten** (solo observabilidad/logs; un rango de mercado en DTO = fase 2).

#### (c) Mapeo producto sellado ↔ catálogo (curación manual del admin, M-23)

No existe entidad "producto sellado de catálogo": hoy el sellado es `InventoryItem(productType='sealed')` **anclado a
una `Card`** (para nombre/imagen, §3.6) + `sealedSubtype`. Se decide **NO introducir** una entidad nueva de catálogo
sellado en el MVP (sería una tercera taxonomía con sync propio); el mapeo vive **en el item**:

- **M-23 (§11):** `InventoryItem.tcgplayerProductId Int?` + `InventoryItem.tcgplayerGroupId Int?` (se fijan **juntos**;
  ambos `null` = no mapeado; solo aplican a `productType='sealed'` — regla de aplicación, no constraint de BD) +
  `@@index([tcgplayerProductId])`. El `groupId` se persiste porque el endpoint de precios de TCGCSV es **por grupo**.
- **Flujo de curación (M2, `super_admin`):**
  1. **Cola de pendientes de mapeo = consulta DERIVADA** (`productType='sealed' AND tcgplayerProductId IS NULL`),
     expuesta en `GET /admin/pricing/sealed/unmapped` — **no** requiere tabla/estado nuevo, no puede desincronizarse.
  2. El admin explora TCGCSV vía **proxy read-only server-side**: `GET /admin/pricing/sealed/tcgcsv/groups` y
     `GET /admin/pricing/sealed/tcgcsv/groups/:groupId/products` (filtrados a sellado, con `?q=` por nombre). El
     proxy existe porque el navegador no debe hablar con tcgcsv.com (CORS/consistencia/anti-SSRF centralizado).
  3. Asigna con `PUT /admin/pricing/sealed/items/:itemId/mapping` (`tcgplayerProductId`+`tcgplayerGroupId`;
     `tcgplayerProductId:null` desmapea). **`applyToSiblings?:boolean`** copia el mapeo a los demás sealed **sin
     mapeo** con el mismo `(cardId, sealedSubtype)` (las copias físicas del mismo producto). **Auditado.**
- **Sin matching automático por nombre en v1.19:** el fuzzy name-matching (nuestro `Card.name`/set vs `cleanName`
  TCGCSV) es error-prone y esto alimenta una referencia de dinero; la curación es humana. Un asistente de sugerencias
  (no auto-commit) = pregunta abierta v1.19-3.
- Los endpoints de curación funcionan **aunque el dial esté `off`** (curar no ingiere precios); solo el explorador
  llama a tcgcsv.com (read-only).

#### (d) Ingest → `PriceReference` (SIN migrar `PriceReference`) + conversión MXN

**Job propio `sealed-price-ingest`** (`backend/src/jobs/sealed-price-ingest.service.ts` + `SealedPriceIngestService`
en `modules/pricing`), **separado** de `price-ingest` (§4.15): otra interfaz (product-keyed), otro dial, otro dominio
de fallo — un TCGCSV caído no toca el pricing de singles y viceversa. `backend/src/jobs/` pertenece a este stream
mientras toque sus jobs (nota §2 / v1.18).

- **Cadencia:** **1×/día**, tras la actualización de TCGCSV (~20:00 UTC) y tras `fx-refresh` (orden **suave**, igual
  que §4.15g: `getCurrent()` degrada al último `FxRate`). Sugerido **21:30 UTC**; cron por env
  (`SEALED_PRICE_INGEST_CRON`), horario exacto = **devops**. **Single-flight** (patrón de la familia de jobs).
- **Forma de ejecución:** **secuencial y AWAITED dentro del job** — SIN fan-out BullMQ por grupo. Justificación: el
  alcance es minúsculo (solo los **grupos distintos de los items mapeados**, no todo TCGCSV; decenas de requests como
  mucho), así que el fan-out de §4.15c sería sobre-ingeniería. Si el volumen creciera, se promueve al patrón parent/child
  sin cambiar contrato.
- **Algoritmo normativo:**
  1. Lee el dial `SEALED_PRICE_SOURCE`; si `off` → **no-op logueado** (fail-closed, ver e).
  2. `SELECT DISTINCT tcgplayerGroupId` de los `InventoryItem` sealed mapeados.
  3. Carga **FX UNA vez por corrida** (`FxService.getCurrent()` → snapshot `{rate, bufferPct}`, paridad §4.15f).
  4. Por grupo: `fetchSealedPricesForGroup(groupId)` → filtra a los `tcgplayerProductId` mapeados de ese grupo.
  5. Por cada par **distinto** `(anchorCardId, tcgplayerProductId)` presente entre los items mapeados (el
     `anchorCardId` es el `cardId` del item): `priceMxnCents = usdToMxnCents(marketCents, rate, bufferPct)` (TCGCSV
     es **siempre USD** → el colchón #13 aplica en cada corrida) y **upsert idempotente** de `PriceReference` con
     clave `(cardId=anchorCardId, productType='sealed', gradeKey='sealed:tcg:<productId>', finish='normal',
     capturedDate=hoy)`, `source='tcgcsv'`, `priceUsdCents=marketCents`, `fxRate`, `fxBufferPct`.
     **Respeta `isManualOverride`** de la fila del día (paridad con `persistMarketReference`; backend reusa/parametriza
     ese método o crea uno hermano con la MISMA doctrina — no clobbear override, no escalar pendientes).
- **`gradeKey` del sellado de MERCADO = `sealed:tcg:<tcgplayerProductId>`** (helper nuevo `sealedMarketGradeKey()` en
  `pricing.types.ts`). Motivo: el legacy `buildGradeKey → 'sealed'` colisionaría en el unique cuando **dos productos
  sellados distintos** (ETB y booster box del mismo set) están anclados a la **misma** `Card`. `buildGradeKey` **NO
  cambia**: `'sealed'` sigue siendo el gradeKey del **override manual** y del costo de aportación (flujos intactos).
- **`finish` siempre `'normal'`** (las filas con `subTypeName≠'Normal'` ya se omitieron en el adapter).
- **Fallback `marketPrice → midPrice`** (con flag `usedFallbackMid`, contado/logueado): aceptable **solo aquí** porque
  esta referencia es informativa (no fija venta ni pago). Para raw/singles ese fallback **sigue prohibido**.
- **Lectura (`sealedMarketRef`):** para un item mapeado =
  `getReference(item.cardId, 'sealed', sealedMarketGradeKey(item.tcgplayerProductId), 'normal')` (misma regla "más
  reciente sin filtro de fecha" que el resto de valuaciones). Sin mapeo → `null`. En listados M1, batch vía
  `getReferencesBatch` (BE-25) para no reintroducir N+1.
- **Verificado: `PriceReference` soporta sellado SIN migración** — `productType='sealed'` ya existe en el enum,
  `gradeKey` es `String` libre, `finish` tiene default `normal` y el unique
  `(cardId, productType, gradeKey, finish, capturedDate)` aloja el nuevo esquema de gradeKey. Lo único de esquema es
  **M-23** (enum `PriceSource.tcgcsv` + 2 columnas + índice en `InventoryItem`), §11.

#### (e) Dial fail-closed `SEALED_PRICE_SOURCE` (`sealed_price_source`)

- `ConfigSetting` nueva: valores **`tcgcsv | off`**, **seed `off`** — al desplegar NO se ingiere nada (fail-closed)
  hasta que devops valide el esquema real en staging (1ª corrida manual, ver f) y **flipee el dial** (mismo patrón de
  rollout money-safe que `PRICE_PROVIDER`, §4.15h). Editable **sin redeploy** (M10); validada contra el enum
  (`422 VALIDATION_ERROR`). **Rollback = `off`**: los `PriceReference` ya escritos permanecen (informativos e inertes;
  no alimentan venta ni publicación).
- El job y el disparo manual **cortocircuitan** con `off` (`enqueued:false`/no-op logueado); la **curación de mapeos
  NO depende del dial** (mapear no mueve precios).
- **Coordinación de streams:** añadir la key a `settings.constants.ts` toca el módulo `settings` (stream «Cuentas y
  acceso») — cambio mínimo/mecánico (constante + default + validador), el **orquestador lo serializa** (precedente:
  `price_provider` en WS-A).

#### (f) Desarrollo contra FIXTURES (red de dev bloqueada) + validación en staging

- **Norma:** el adapter se desarrolla y testea **exclusivamente contra fixtures** — JSON **reales de muestra**
  (payloads verbatim de tcgcsv.com de un grupo moderno, p. ej. Surging Sparks) en **`backend/test/fixtures/tcgcsv/`**:
  `groups.json`, `products-<groupId>.json`, `prices-<groupId>.json`. Los unit tests del adapter (filtro sellado,
  omisiones money-safe, fallback mid, mapeo a `SealedPriceRow`) corren **solo** sobre fixtures; **ni dev ni CI llaman
  a tcgcsv.com** (el egress está bloqueado en dev y el test no debe depender de red).
- **Validación real = staging:** 1ª corrida manual `POST /admin/jobs/sealed-price-ingest { groupId }` con un grupo
  conocido → inspeccionar `PriceReference`/logs (¿coinciden los campos reales con las fixtures? ¿USD? ¿subTypeName?)
  → **entonces** flip del dial a `tcgcsv`. El **runbook** de esa validación es de **devops** (`DEVOPS_NOTES.md`);
  si el esquema real difiere de las fixtures, el hallazgo vuelve a backend (ajustar adapter + fixtures).

#### (g) Contrato (resumen — todo aditivo y admin-only; la superficie pública NO cambia)

Ver API_CONTRACT v1.19: enums (`PriceSource += tcgcsv`; `SealedPriceSource = tcgcsv | off`); §M1 (campos read-only
`tcgplayerProductId`/`tcgplayerGroupId`/`sealedMarketRef` en items sellados); §M2 (subsección TCGCSV:
`unmapped` / `tcgcsv/groups` / `tcgcsv/groups/:groupId/products` / `PUT .../items/:itemId/mapping`); §M10
(`sealedPriceSource`); §M10-ops (job `sealed-price-ingest` con `groupId?`). Ningún endpoint público ni DTO de
cliente cambia (ficha de Compra, holdings, buylist: intactos).

---

### 4.20 WS «Inventario y vault» — Master set en todas partes (v1.20-master-set-everywhere)

**Objetivo.** El binder Master Set (§4.17) demostró ser la superficie correcta para "ver un set de un vistazo".
v1.20 lo convierte en el **read model único de "contenido agrupado por set y por acabado"**, parametrizado por
**scope**, para tres consumidores: M1 (inventario de plataforma), soporte/operación (bóveda de un cliente vista por
admin) y el propio cliente ("Mi bóveda" como colección). Un solo servicio, un solo shape; cambia el **filtro de
agregación** y las **omisiones por permiso**. Contrato: `API_CONTRACT.md` Changelog v1.20 (§0/§DTOs/§3/§M1).

**#### 4.20a Read model por scope (backend: `MasterSetService`).**
- `MasterSetService.index()/binder()` ganan un parámetro de scope:
  `type MasterSetQueryScope = { kind: 'platform' } | { kind: 'user_vault', userId: string }`.
  El scope SOLO cambia el `WHERE` de la agregación de `InventoryItem`:
  - `platform` → `ownerType='platform' AND status NOT IN NOT_ON_HAND` (regla v1.16 intacta).
  - `user_vault` → `ownerType='customer' AND ownerUserId=:userId AND status NOT IN NOT_ON_HAND` (piezas del usuario
    **en bóveda**; ambas titularidades `pending|settled` — es su colección, la titularidad afecta retiro, no vista).
  Todo lo demás (queries fijas sin N+1, orden natural, `isSecretRare`, `numberSort`) se **reusa sin duplicar**.
- **Controllers:** `MasterSetController` (M1, existente) + nuevos `AdminVaultsController`
  (`/admin/vaults`, `vault_operator+`, módulo `vault`) y rutas `GET /vault/master-sets[...]` en `VaultController`
  (`customer`, siempre `userId = el autenticado` — **jamás** un userId del request en la vista (iii)).
- **Índice en scope `user_vault`:** solo sets con ≥1 pieza del usuario (el catálogo completo como índice es ruido
  para un cliente); el binder de **cualquier** set sigue accesible por `:setId` (los huecos son sus faltantes).
- **Omisiones por scope (regla dura de DTO):** el shape compartido nunca lleva ubicación física, costos, folios ni
  ownerUserId de terceros; `owner` solo en `user_vault` (con `email` solo en la vista admin); `buyable` solo en la
  vista (iii). Las acciones de escritura (batch/bulk-publish/adjustments) son **solo** rutas `/admin` de scope
  plataforma — el binder de cliente y el de la vista admin de bóveda son **lectura pura**.

**#### 4.20b Completitud por VARIANTE (carta+acabado).**
- **Casilla = variante = `(Card, finish)`** con `finish ∈ Card.availableFinishes`. Una carta en `normal` y
  `reverse_holo` son **2 casillas**; los contadores «X/Y» cuentan **variantes**, no cartas.
- **Universo esperado — regla explícita:** el catálogo **SÍ declara** los acabados esperados por carta:
  **`Card.availableFinishes`** (M-18), hoy poblado por el price-ingest v1.14 (variantes reales del proveedor,
  §4.15e) con bootstrap desde `tcgplayer.prices` y default histórico `["normal"]`. **No se inventa una regla
  derivada nueva**: es el mismo campo que ya funge de lista blanca SEC-A1 del `finish` en quote/alta. Si el ingest
  amplía `availableFinishes`, el denominador de completitud crece (correcto: aparecieron variantes de mercado).
- **Drift:** una pieza cuyo `finish` ya no esté en `availableFinishes` se muestra en `countsByFinish` (es una pieza
  real) pero **no** cuenta en expected/covered — evita `covered > expected` y deja visible la inconsistencia.
- **Nota (comportamiento v1.16 conservado):** la cobertura cuenta piezas de **cualquier** `productType` del
  `(cardId, finish)` (graded/sealed mapean a `finish=normal` por §3.7). Cambiarlo a "solo raw" sería decisión de
  producto (pregunta abierta WS-IV-1, §10).
- **Costo de cómputo:** los campos nuevos salen de las MISMAS agregaciones v1.16 (`groupBy [cardId, finish]`) +
  `availableFinishes` ya presente en la query de cartas; el índice suma una agregación de `Σ|availableFinishes|`
  por set (raw SQL sobre `Card`). Sigue O(1) queries por request.

**#### 4.20c Lista de clientes con bóveda (`GET /admin/vaults`).**
Agregación por usuario (`ownerType='customer'`, status en bóveda) → `pieceCount` + valuación de la página con
**la misma base del portafolio** (§3, `PriceReference` vigente por acabado, vía `getReferencesBatch` — §4.17c):
piezas sin precio se excluyen del total y se cuentan en `pendingPriceCount`. Identificación mínima
(`name`/`email`, misma exposición que el listado M6 para `vault_operator`); **nunca** PII sensible. Orden
`value_desc | pieces_desc | name_asc`, paginado. Cada fila enlaza a la vista (ii) (`/admin/vaults/:userId/master-sets`).

**#### 4.20d Faltantes comprables (`buyable`, solo vista (iii)).**
Para las variantes `covered=false` del binder del cliente, **una** query adicional resuelve por `(cardId, finish)`
la pieza de plataforma `status='listed'` con **menor precio de venta** (mismo criterio de precio de la ficha §4.9:
`listPriceCents` override o derivado por reglas de venta §4.14 — el binder expone el `salePriceCents` ya resuelto;
si el precio no resuelve, esa pieza no es buyable). El CTA del front lleva a la ficha
(`GET /catalog/listings/:inventoryItemId`) y al **checkout normal** — el binder **no** crea órdenes ni reservas.
`buyable` se **omite** en los scopes admin (allí el binder es operación, no compra).

**#### 4.20e Ajuste de inventario por levantamiento físico (M1).**
- **Flujo:** el operador abre la celda del binder M1, compara sistema vs físico y registra el ajuste
  (`POST /admin/inventory/adjustments`) con **motivo obligatorio** `AdjustmentReason =
  encontrada | perdida | danada | error_captura`:
  - `encontrada` → crea pieza(s) nuevas reusando la lógica de alta (`inventory.service.create` /
    `BatchInventoryItemInput`; `acquisitionType` default `aportacion_en_especie`, con su `PRICE_PENDING` normal).
  - `perdida | danada` → `status → lost | damaged` (conecta con reposición/merma M7 + tope M10, igual que `mark`).
  - `error_captura` → `status → withdrawn`: sale del on-hand **sin** semántica de pérdida (no dispara reposición ni
    infla mermas); el motivo real queda tipado en `InventoryAdjustment.reason`. **Decisión:** se reusa `withdrawn`
    en vez de añadir un `InventoryStatus` nuevo — el enum de status es zona compartida transversal (Compra, M4,
    bulk-publish, contracargo) y un valor nuevo obligaría a revisar todos esos switches; la distinción
    "error de captura vs retiro" vive en `InventoryAdjustment`/`AuditLog`, que es donde se reporta.
  - **Guardarraíles:** solo piezas `ownerType=platform` con status ∈ `{in_stock, listed}` son ajustables
    (`422 ITEM_NOT_ADJUSTABLE` en el resto — una pieza `reserved`/vendida/en custodia/enviada se resuelve por su
    flujo dueño: M3/M4/`mark` de custodia). **NO hay venta directa manual desde el binder**: el ajuste no puede
    reservar/vender; toda salida de venta va por órdenes (checkout Stripe/M3). No es money-out.
- **Registro triple (auditoría con usuario y timestamp):** (1) fila `InventoryAdjustment` (M-24: motivo tipado,
  from/to status, actor, note — consultable para reportes de merma/levantamiento M7/M9); (2) `InventoryMovement`
  con el nuevo `MovementReason.adjustment` (el historial de la pieza distingue ajuste de operador vs mark normal);
  (3) `AuditLog action=inventory.adjustment` (bitácora global M10). `mark` existente queda para el flujo no-binder
  (incl. custodia de clientes); el ajuste es el camino normado del levantamiento físico.
- **Schema (decisión, migración M-24 — ver §11):** enum `AdjustmentReason`, valor nuevo
  `MovementReason.adjustment`, y modelo `InventoryAdjustment` (tabla propia y NO solo `AuditLog`, porque el motivo
  debe ser **tipado y consultable** para reportes, mientras `AuditLog` es texto/JSON de bitácora). Aditiva, sin backfill.
- **Aclaración v1.20.1-adjustments-clarify (respuesta plural + idempotencia; contrato §M1):** dos ambigüedades
  enrutadas por techlead/QA tras los gates del stream (BACKEND_NOTES §45.4, deuda BE-47):
  - `InventoryAdjustmentResponse.adjustmentIds: string[]` **sustituye** al singular `adjustmentId`: con
    `encontrada` y `qty>1` M-24 crea **una fila por pieza** y el singular obligaba a devolver solo la primera.
    Ahora se devuelven todas, alineadas 1:1 con `inventoryItemIds`/`folios`. **Sustitución limpia, sin campo
    deprecated** (sin clientes externos; el frontend propio no navega por ese id).
  - `batchKey?` opcional **solo en el camino `encontrada`** con la **misma** semántica de idempotencia que el alta
    por lote: reusa el mecanismo `InventoryBatch` (M-21, **sin migración nueva**); replay → respuesta original con
    `idempotentReplay: true` (cierra BE-47: el doble submit ya no duplica piezas). Los otros motivos no lo
    necesitan: operan un id concreto y su replay cae en `422 ITEM_NOT_ADJUSTABLE` (idempotencia natural).

**#### 4.20f Frontend — promoción del binder a componentes compartidos.**
Los componentes de master set viven hoy en `frontend/src/app/[locale]/(admin)/admin/m1/master-set/`
(`MasterSetIndex.tsx`, `MasterSetBinder.tsx`, `MasterSetPanel.tsx`, `CellDrawer.tsx`, `PerLineErrors.tsx`,
`capture.ts`). Con tres consumidores (M1, admin-bóveda-cliente, Mi bóveda) **se promueven a
`frontend/src/components/master-set/`** (zona compartida — **reservada por este work stream** mientras dura la
promoción; ningún otro stream la toca en paralelo). Reglas:
- El componente se parametriza por **scope/capacidades vía props** (`scope`, `readOnly`, `showBuyable`,
  `onAddToCapture?`, `onAdjust?`): las acciones de captura/publicación/ajuste solo se montan en M1; el CTA de
  compra (`buyable`) solo en la vista del cliente. El componente **no** decide permisos: renderiza lo que el DTO
  trae (el backend ya omitió campos por scope — defensa en el dato, no en el if del front).
- Lo específico de M1 (carrito de captura, `capture.ts`, `PerLineErrors`) puede quedarse bajo `(admin)/admin/m1/`
  si solo M1 lo usa; lo que se comparte (índice, binder, celda, drawer de variantes) se mueve. Los imports de
  `M1View` se actualizan a la nueva ruta (trabajo de **frontend**, no del arquitecto).

#### Reparto de trabajo (v1.20)
- **Backend:** (1) parametrizar `MasterSetService` por scope + campos de variante; (2) `GET /vault/master-sets[...]`
  (customer) y `GET /admin/vaults[...]` (vault_operator+); (3) `buyable` (query de mínimos por `(cardId, finish)`);
  (4) `POST /admin/inventory/adjustments` + migración M-24; (5) tests: mismos shapes en 3 scopes, omisiones por
  scope (nunca ubicación/costo/folio; `buyable` solo (iii)), contadores de variantes vs cartas, drift de
  `availableFinishes`, `ITEM_NOT_ADJUSTABLE`, `error_captura` no dispara reposición, no-venta-desde-binder.
- **Frontend:** (1) promover componentes a `components/master-set/` (§4.20f); (2) "Mi bóveda" gana la pestaña/vista
  master set con X/Y por variantes y CTA de faltantes comprables; (3) vista admin `/admin/vaults` (lista + binder de
  cliente, read-only); (4) drawer de ajuste en la celda M1 (motivo obligatorio, nota).
- **QA/techlead:** doble veredicto por stream (no toca dinero saliente); E2E: cliente ve su set con variantes
  cubiertas/faltantes y compra un faltante vía checkout; admin lista bóvedas y abre el binder de un cliente;
  ajuste `perdida`/`encontrada`/`error_captura` deja `InventoryAdjustment` + movement + audit.

---

### 4.21 WS «Órdenes y dinero» — Guest checkout: comprar sin cuenta (v1.21-guest-checkout)

> **PROJECT §J / §J.1 / criterios 45–56b.** Contrato completo (endpoints, DTOs, diff de esquema campo por campo) en
> **API_CONTRACT §4-G**. Aquí vive el **por qué**: la ruta de fulfillment nueva, el ciclo de vida de los items y el
> modelo de amenazas del enlace tokenizado.

#### (a) El problema real: hoy no existe «envío vs bóveda»

Lo que parece "quitar el login del checkout" es en realidad **construir una segunda ruta de fulfillment**. Estado
verificado del código antes de esta versión:

| Pieza | Comportamiento actual | Por qué bloquea al invitado |
|---|---|---|
| `OrdersService.createSession` | Reserva cada `InventoryItem` con `status='reserved'`, **`ownerType='customer'`, `ownerUserId=userId`**, `ownershipStatus='pending'` | Necesita un `User`. Un invitado no lo tiene, y `ownerUserId=null` con `ownerType='customer'` rompería la definición de bóveda (holdings, portafolio, snapshots, master set por usuario). |
| `PaymentsService.onPaymentSucceeded` | Pasa el item a **`status='in_custody'`, `ownershipStatus='settled'`** | Deposita en bóveda. Para un invitado no hay bóveda donde depositar. |
| `ShipmentsService.create` | Exige `ownerUserId === userId`, `ownershipStatus='settled'`, `status='in_custody'`, una **`Address` guardada del usuario**, y crea **su propio PaymentIntent** con `shippingFeeCents` | Triple bloqueo: sin usuario, sin bóveda y sin dirección guardada. Y el invitado **no puede pagar un segundo PI**: no tiene desde dónde iniciarlo. |
| `Order.userId` / `ShipmentRequest.userId` | `String` **NOT NULL** con FK a `User` | El cambio de esquema es **inevitable**; este stream es su caso legítimo. |

De ahí las tres decisiones estructurales: **(1)** un modo de fulfillment explícito en la orden, **(2)** dirección
**capturada en línea** como *snapshot* (no una fila `Address`), **(3)** el envío se cobra **dentro del mismo
`PaymentIntent`** de la orden. No es una optimización: es la única forma de que el invitado pague una sola vez.

#### (b) Ruta de fulfillment `direct_ship` (nueva) vs `vault` (la de siempre)

```
                       ┌──────────────── fulfillmentMode ────────────────┐
                       │                                                 │
             vault (DEFAULT, requiere cuenta)              direct_ship (invitado, v1.5)
                       │                                                 │
 POST /checkout/session (customer)                 POST /checkout/guest/session (public)
   items → ownerType=customer, ownerUserId,          items → SIGUEN ownerType=platform,
           ownershipStatus=pending, reserved                 ownerUserId=null, reserved
   PI = cartas + IVA + fee                           PI = cartas + ENVÍO + IVA + fee   ← una sola vez
                       │                                                 │
 webhook succeeded                                  webhook succeeded
   items → in_custody / settled  (BÓVEDA)             items → picking (siguen de plataforma)
                       │                              + se CREA ShipmentRequest(orderId, userId=null,
                       │                                status='picking', montos 0)
                       │                              + correo con enlace tokenizado (best-effort)
                       │                                                 │
 POST /shipments (customer, SEGUNDO PI)             (no aplica: ya está pagado y encolado)
   ShipmentRequest(userId, addressId guardado)
                       │                                                 │
 M4: picking→guia→enviado→entregado                 M4: picking→guia→enviado→entregado (MISMA cola)
   entregado ⇒ item in_custody → withdrawn            enviado   ⇒ item picking → shipped
                                                      entregado ⇒ item shipped → delivered
```

**Por qué el envío del `ShipmentRequest` de invitado va en `0`:** el P&L de M7 suma `ShipmentRequest.shippingFeeCents`
de los envíos liquidados. Si el envío directo repitiera ahí la tarifa ya cobrada en la orden, **el ingreso se
contaría dos veces**. El ingreso vive en `Order.shippingFeeCents` (única fuente) y el envío de fulfillment queda en
`0`; el **costo** real del carrier (`shippingCostCents`) se sigue capturando en M4 igual para los dos tipos, así que
el lado del costo no cambia. La fórmula corregida de M7 está normada en API_CONTRACT §12.

#### (c) Ciclo de vida de los items en un pedido de invitado

**Decisión de fondo: la titularidad del invitado NO se modela.** Un invitado no tiene bóveda, no tiene portafolio y
no tiene retiros; modelarle una "titularidad" obligaría a `ownerType='customer'` con `ownerUserId=null`, y ese par
es exactamente lo que rompería todas las consultas de bóveda existentes (holdings, `PortfolioSnapshot`, master set
`scope=user_vault`, ficha 360°, `classifyItems`). Se elige lo contrario: **el item sigue siendo de la plataforma
hasta que sale por la puerta**, y todo el ciclo lo expresa `status`.

```
listed | in_stock
   │  POST /checkout/guest/session
   ▼
reserved        ownerType=platform · ownerUserId=null · ownershipStatus=null
   │  payment_intent.succeeded  (Order settled)
   ▼
picking         vendida y en preparación (aún físicamente en el almacén)
   │  M4: PATCH .../status → enviado
   ▼
shipped         salió físicamente
   │  M4: PATCH .../status → entregado   (deliveredAt ancla la ventana de disputa de 7 días)
   ▼
delivered       TERMINAL de una venta con envío directo   (NO `withdrawn`)

Reversos:
  payment_failed | canceled  → reserved → listed              (Order failed; nada que revertir de titularidad)
  chargeback                 → ver §4.21c-bis (NO basta mirar el item: hay que mirar el ENVÍO)
```

#### (c-bis) Contracargo de un pedido `direct_ship` — el envío manda (T1, corrección normativa v1.21.2)

**El hueco (real, verificado en código).** La v1.21 describió el reverso del contracargo **solo en términos del
`InventoryItem`** y no dijo nada del `ShipmentRequest`. Backend implementó lo que decía la norma, y el resultado es
un **double-sell físico**:

1. `settleDirectShipOrder` crea el envío en **`picking`**.
2. `onChargeDispute` decide "¿ya salió?" buscando un `ShipmentItem` cuyo envío esté en `enviado|entregado`. Un envío
   en **`picking`** o **`guia` NO coincide** ⇒ cae en la rama "sigue en bóveda".
3. Esa rama pone el item en `listed` / `platform` ⇒ **vuelve a ser comprable**.
4. El `ShipmentRequest` **no se toca** ⇒ sigue en `picking` ⇒ **`pickingList()` lo sigue mostrando al operador**.

Resultado: la **misma pieza única** puede venderse a un segundo comprador **mientras el operador la está metiendo en
la caja del contracargo**. `ITEM_IN_ANOTHER_SHIPMENT` (SEC-H2) no protege aquí: solo cubre `POST /shipments`, no el
checkout. En la ruta de bóveda esto era inocuo (una orden liquidada no tenía envío colgando); en `direct_ship`
**siempre lo tiene por construcción**, así que es un daño colateral directo de la ruta de fulfillment que introdujo
este stream.

**El invariante que se violaba (y que ahora es norma explícita):**
> **Una pieza con un `ShipmentItem` en un envío NO terminal jamás puede estar en `{listed, in_stock}`.**
> Ninguna automatización puede devolver a la venta una pieza cuya ubicación física está comprometida con una
> operación de fulfillment viva.

**Norma: el contracargo NUNCA re-lista automáticamente una pieza con envío vivo. La congela y la escala a un
humano.** Tabla normativa por estado del envío en el momento de `charge.dispute.created`:

| Envío del pedido | `ShipmentRequest` | `InventoryItem` | `chargebackNeedsManual` |
|---|---|---|---|
| **No existe** (orden `pending`, item `reserved`) o **`cancelado`** | — | `reserved → listed`, `ownerType=platform` (+ movimiento `chargeback_return`) | `false` — cerrado automáticamente, la pieza nunca salió del estante |
| **`solicitado` \| `picking` \| `guia`** (NO terminal) | **→ `cancelado`**, en la **MISMA transacción** (sale de `pickingList()` de inmediato: ese query filtra `status:'picking'`) | **CONGELADO**: se queda en `picking`. **NO** se re-lista, **NO** cambia `ownerType`. Fuera de venta por construcción (`picking ∉ {listed, in_stock}`) | **`true`** — lo resuelve un humano (abajo) |
| **`enviado` \| `entregado`** | sin cambio (histórico) | sin cambio (`shipped` / `delivered`) | **`true`** (comportamiento v1.21, sin regresión) |

**Por qué congelar en vez de auto-cancelar-y-re-listar** (que era la otra opción obvia para el caso `picking`):
- Re-listar es una **acción automática que vuelve a vender**. Dispararla a partir de un evento que significa
  "algo salió mal con el dinero", y encima mientras hay una caja abierta en la mesa del operador, es precisamente
  la clase de automatismo que produce pérdidas reales (vender dos veces, enviar al defraudador y tener que
  compensar al segundo comprador).
- **Un contracargo no es prueba de nada todavía**: podemos ganar la disputa (`funds_reinstated`), y entonces la
  venta era legítima y la carta tenía que salir. Liberarla al inventario al primer aviso presume el peor caso y
  destruye la posibilidad de completar el envío.
- **`guia` no es lo mismo que `picking`**, y esa diferencia es justo la que una regla automática no puede resolver:
  con etiqueta generada el paquete suele estar **armado y esperando al mensajero**. La única fuente de verdad sobre
  dónde está físicamente la carta es **el operador mirando el estante**. Por eso el desenlace es una **confirmación
  humana**, no una heurística de estados.
- Se prefiere **una sola regla** ("envío vivo ⇒ congelar") a una regla partida por estado: en dinero e inventario,
  la uniformidad vale más que ahorrarle un clic al operador en un evento tan raro como un contracargo.
- **Reusa `ShipmentStatus.cancelado`** (ya existe y ya significa "envío que no se va a ejecutar"): **cero valores
  de enum nuevos, cero migración**.

**Desenlace humano — `POST /api/v1/admin/orders/:id/chargeback-inventory`** (`vault_operator+`, auditado; contrato
en API_CONTRACT §M3). Es la pieza que faltaba: sin ella una pieza congelada se queda congelada para siempre.
Tres desenlaces, todos con `note` obligatoria y todos dejando `chargebackNeedsManual=false`:
- **`recuperada`** — el operador confirma que tiene la carta ⇒ `picking|shipped → listed` (o `in_stock` si su precio
  no resuelve), `ownerType=platform`, movimiento **`chargeback_return`**. Vuelve a la venta **con respaldo físico**.
- **`no_recuperada`** — la carta ya no está (salió, o se entregó al defraudador) ⇒ **sin** movimiento de inventario;
  el item se queda donde está (`shipped`/`delivered`, terminal de venta). La pérdida queda reflejada en la orden
  `chargeback` para M7. **No** se marca `lost`/`damaged`: no fue merma de almacén y ensuciaría los reportes de
  pérdida (mismo cuidado que llevó a usar `delivered` en vez de `withdrawn`).
- **`reexpedir`** — solo válido si **ganamos la disputa** (la orden volvió a `settled` por
  `charge.dispute.closed`/`funds_reinstated`) y la pieza sigue congelada ⇒ se crea un `ShipmentRequest` **nuevo**
  con la misma forma que el del settle (`orderId`, `userId=null`, `status='picking'`, montos en `0`,
  `addressSnapshot` de `Order.shippingAddressSnapshot`) y el item sigue en `picking`. Cierra el agujero silencioso
  de "ganamos la disputa pero el envío ya estaba cancelado". Cualquier otro estado ⇒ `422`.

**Cierre de la disputa (`charge.dispute.closed` / `funds_reinstated`) — precisión v1.21.2:** ganar **NO** re-expide
automáticamente. La orden vuelve a `settled` (`disputeOutcome='won'`) y **`chargebackNeedsManual` se mantiene en
`true`** para que el caso siga visible en la cola de M3 hasta que un humano confirme si la carta sigue ahí y pulse
`reexpedir`. Automatizar la re-expedición volvería a presuponer una realidad física que nadie ha comprobado.

**Motivos de `InventoryMovement` (v1.21.1, normativo — sin valores nuevos en `MovementReason`):** `settle` para
`reserved → picking` (mismo evento y misma causa que `reserved → in_custody` de la ruta de bóveda; lo que cambia es
el destino, no el motivo) y **`sale`** para `picking → shipped` y `shipped → delivered` (salida física y cierre de
la venta). **`withdrawal` queda prohibido** en esta ruta: significa "retiro de la bóveda de un cliente" y ensuciaría
los reportes de custodia, exactamente el mismo cuidado que llevó a usar `delivered` en vez de `withdrawn`. Las dos
filas `sale` se distinguen por `fromStatus`/`toStatus`, así que no hace falta un motivo "entregado". La liberación
de reserva por pago fallido **no** registra movimiento, igual que hoy en la ruta con cuenta (sin asimetría nueva).

Tres consecuencias que se declaran de forma explícita para que nadie las "arregle" después:
1. **No hace falta ningún valor nuevo en `InventoryStatus`.** `picking | shipped | delivered` estaban **sin uso por
   diseño** desde v1.17 (el retiro de bóveda no los escribe; §3.3) y sus nombres describen exactamente estos tres
   momentos. Reusarlos evita tocar un enum transversal — mismo criterio con el que v1.20 hizo que `error_captura`
   reusara `withdrawn`.
2. **`delivered` ≠ `withdrawn`.** `withdrawn` significa "salió de la bóveda de un cliente". Un pedido de invitado
   nunca estuvo en bóveda, así que usar `withdrawn` mentiría en los reportes de custodia. M4 **ramifica** por
   `ShipmentRequest.orderId != null`.
3. **Los guardarraíles anti double-sell ya cubren los tres estados nuevos** sin tocarlos: el checkout exige
   `{listed, in_stock}`, `bulk-publish` devuelve `ITEM_NOT_PUBLISHABLE` fuera de `{in_stock, listed}` y el ajuste
   de M1 devuelve `ITEM_NOT_ADJUSTABLE` fuera de `{in_stock, listed}`. **Cero cambios en módulos de otros streams.**

**Efecto conocido y aceptado en los conteos de M1:** una pieza `reserved`/`picking` de un pedido de invitado sigue
siendo `ownerType='platform'` y por tanto cuenta como *on-hand* en el master set de plataforma hasta pasar a
`shipped`. Es coherente con el criterio físico de ese contador (la carta está en el almacén) y con que `reserved`
ya contaba; **no** se cambia la regla *on-hand* de §4.17/§4.20 (es de otro work stream).

#### (d) `ShipmentRequest` con dos naturalezas — por qué no se creó un modelo nuevo

Se evaluó crear un `GuestShipment` separado. Se descarta: duplicaría la cola de M4, la lista de picking, la captura
de guía, la máquina de estados y los reportes, para representar **la misma operación física** (meter cartas en una
caja y darle una guía). La diferencia real es de **origen y de cobro**, no de operación. Por eso:
`ShipmentRequest.userId` nullable + `orderId?` como **vínculo** (`orderId == null` ⇔ retiro de bóveda), y M4 opera
una sola cola. La única bifurcación de comportamiento está en la transición terminal (§c).

**Discriminador canónico — corrección normativa v1.21.2 (D4).** La implementación quedó con **dos** discriminadores
para el mismo concepto: `payments` decide por `Order.fulfillmentMode === 'direct_ship'` y `shipments` por
`ShipmentRequest.orderId != null`. Hoy coinciden, pero **no preguntan lo mismo**, y con un tercer modo con envío
(p. ej. `pickup_in_store`) el segundo lo clasificaría como envío directo **en silencio** — el peor tipo de fallo.
Norma:

1. **`ShipmentRequest.orderId` responde SOLO a "¿de dónde viene este envío?"**: `null` ⇒ **retiro de bóveda**;
   poblado ⇒ **fulfillment de una orden**. Ese uso es exhaustivo y correcto para separar las dos colas.
2. **El COMPORTAMIENTO (transiciones terminales del item, `kind` del DTO, cualquier rama futura) se decide SIEMPRE
   por `Order.fulfillmentMode`**, resuelto con un join a la orden vinculada. `fulfillmentMode` es el **único
   discriminador canónico de ruta de fulfillment** de todo el sistema.
3. Ese `switch` debe ser **exhaustivo y ruidoso**: un `fulfillmentMode` no soportado por M4 **lanza y se loguea**
   (`500`/alerta), **nunca** cae por default en la rama `direct_ship`. Un modo nuevo debe **romper visiblemente** en
   el punto exacto donde falta decidir su terminal, no comportarse como otro modo.
4. `vault` con `orderId != null` es una **combinación imposible** por invariante (un pedido a bóveda no genera
   `ShipmentRequest` de fulfillment; su retiro nace del cliente y va sin `orderId`): si aparece, es corrupción de
   datos y debe tratarse como el caso (3), no "arreglarse" silenciosamente.

#### (e) Modelo de amenazas del enlace tokenizado

El enlace **sustituye a una contraseña**: quien lo tiene, ve el pedido. El diseño ataca cada vector por separado.

| # | Amenaza | Mitigación | Residual |
|---|---|---|---|
| T1 | **Adivinar/enumerar tokens** | 256 bits de entropía (`randomBytes(32)`), lookup por `SHA-256 @unique` (no hay comparación parcial ni prefijos), rate limit 20/min por IP | Nulo en la práctica (2^256). |
| T2 | **Enumerar pedidos por id o número** | El token es la **única** llave; la vista pública **no expone el uuid** del pedido y **no existe** endpoint público de búsqueda por número/correo (criterio 52). El `orderNumber` es secuencial pero **no da acceso** (solo sirve, junto al correo, para pedir un reenvío que va al correo del pedido) | Un tercero puede estimar el volumen de ventas a partir de un `orderNumber` que le muestren. Aceptado. |
| T3 | **Oráculo "¿este correo compró aquí?"** | El reenvío exige `(email + orderNumber)` juntos, responde **`202` siempre** y envía **solo** a `Order.guestEmail`. El checkout **nunca** consulta `User` por correo. `GET /orders/claimable` solo habla del correo **verificado** de quien pregunta | Ninguno conocido. |
| T4 | **Fuga del token por `Referer` / logs / historial** | Token en el **body de un POST**, no en la ruta; página `noindex` + `Referrer-Policy: no-referrer`; el front borra el token de la URL (`history.replaceState`); prohibido loguear bodies de `/orders/guest/*` | El token pasa por el correo y por la URL inicial. Inevitable en un enlace por correo (mismo modelo que un reset de contraseña). |
| T5 | **Fuga por dump/backup de BD** | En BD solo vive el **SHA-256**. Un dump **no** produce enlaces utilizables. *(Esta es la razón principal para NO usar un JWT: un JWT robado del correo es igual de malo, pero además la fuga del **secreto de firma** permitiría fabricar tokens para pedidos arbitrarios.)* | Ninguno. |
| T6 | **Reenvío del correo a un tercero / dispositivo compartido** | `GuestOrderTrackingDTO` de **datos mínimos** (§4-G.3): sin dirección completa, sin correo/teléfono, sin PAN, **sin ninguna acción**. El daño máximo es *ver* qué compró alguien | Aceptado explícitamente por PROJECT §J. |
| T7 | **Token vivo para siempre** | TTL 90 días, **rotación** al reenviar (solo el último vale), **revocación** al reclamar y por soporte, y tope de edad de la orden (365 días) para emitir nuevos | Ventana de 90 días. Revisable por el humano. |
| T7b | **Puertas duplicadas por pedido** (v1.21.1) | El claro del token es irrecuperable (solo hay hash), así que el correo del settle lleva **otro** token y durante un rato **coexisten dos**. Se acota haciendo el token de **checkout de vida corta (120 min)** frente al de **correo (90 días)**: pasadas 2 h queda **una sola** puerta duradera. El settle **no rota** (rotar mataría la confirmación post-3DS en curso); reenvío y soporte **sí** rotan y revocan **todos** los vivos | Solapamiento de ≤2 h. La alternativa descartada —dos tokens de 90 días— **duplicaba la exposición durante tres meses** sin beneficio. Ver §4.21e-bis. |
| T8 | **Escalada del token a acciones** | El token **no** es credencial: no se acepta en `Authorization`, no crea sesión, no otorga rol y solo lo leen los endpoints `/orders/guest/*`. Ninguna mutación acepta token | Ninguno. |
| T9 | **DoS de inventario con pedidos no pagados** | Rate limit 5/hora por IP, tope de 20 líneas por pedido, y **job de barrido** `guest-order-sweep` que libera reservas de órdenes `pending` con más de `GUEST_ORDER_RESERVATION_TTL_MIN` (60 min) y cancela su PI | Ventana de 60 min de inventario retenido por un atacante. El barrido **también** beneficia a los pedidos con cuenta (hoy dependen solo de que Stripe cancele el PI). |
| T10 | **Fraude con tarjeta sin historial de usuario** | Fuera del alcance técnico: se cubre con el flujo de contracargo existente (§9 API_CONTRACT). PROJECT deja abierto si el humano quiere un **tope de monto por pedido de invitado** (pregunta v1.5-5) | Exposición comercial conocida; hoy **no** hay tope. |

#### (e-bis) Las dos vidas del token — corrección normativa v1.21.1

La v1.21 pedía algo **irrealizable**: "el mismo token del checkout se envía por correo al liquidar". Con **solo el
SHA-256 en BD**, el claro **no se puede recuperar** en el webhook — y esa imposibilidad es justamente la propiedad
de seguridad que se buscaba (T5). Rotar en el settle tampoco era opción: mataría el token que el navegador está
usando en la confirmación tras el 3DS.

**Norma:** dos emisiones, misma tabla, **sin columna nueva** (se distinguen solo por `expiresAt`):
- **Token de checkout** — lo devuelve `POST /checkout/guest/session` al comprador, **TTL 120 min**
  (`GUEST_CHECKOUT_TOKEN_TTL_MIN`). Existe para una sola cosa: sobrevivir al redirect de Stripe y pintar la
  confirmación/seguimiento inmediato. **Nunca** se envía por correo.
- **Token de seguimiento** — lo emiten el settle, el reenvío y soporte; **TTL 90 días**; **solo** viaja por correo.

Reglas de rotación (asimétricas a propósito): **el settle NO rota** (excepción acotada, justificada por la UX
post-3DS y segura porque la puerta que no revoca se apaga sola en 2 h); **el reenvío y el reenvío de soporte SÍ
rotan**, revocando *todos* los tokens vivos del pedido; **el reclamo revoca todo**. Resultado: el estado estable de
un pedido es **una única puerta sin contraseña**, con una ventana de solapamiento de como mucho dos horas el día de
la compra. Si el correo falla, el comprador tiene 2 h de acceso y después el reenvío con `(email + orderNumber)`
—datos que la confirmación le mostró—, así que no queda sin salida.

**Motivo de revocación (`details.reason`) — se DERIVA, no se persiste.** `order.claimedAt != null` ⇒ `CLAIMED`; en
otro caso ⇒ `ROTATED`. Se **elimina** el valor `SUPPORT` de la v1.21: era inderivable sin una columna de motivo, y
no se añade una columna para cambiar un texto de UX. **La trazabilidad no se pierde**: el reenvío de soporte deja
`AuditLog` (`order.tracking_link.reissue`, con actor y timestamp) y el self-service no, así que el forense
distingue perfectamente quién rotó. Lo que no distingue es el **cuerpo de la respuesta**, que es copy, no auditoría.

**Por qué opaco y no JWT (decisión, no preferencia):** (i) **revocable** borrando/marcando una fila — un JWT solo
se revoca con lista negra, que es exactamente la tabla que el opaco ya es; (ii) **no filtra claims** (un JWT lleva
`orderId` y fechas legibles por cualquiera que lo intercepte); (iii) **no depende de la rotación de un secreto**
(rotar el secreto invalidaría *todos* los enlaces vivos); (iv) **precedente probado en casa** (`AuthToken`,
§3.2/§4.11) con el mismo `hashAuthToken`/`randomBytes(32)`. La **única** diferencia semántica que hay que codificar
es que este token es **multi-uso**: `usedAt` (consumo) se sustituye por `revokedAt` (revocación) y `useCount`/
`lastUsedAt` (telemetría). No se reusa el modelo `AuthToken` porque su `userId` es obligatorio y su semántica de
un-solo-uso está cableada en `consume()`.

#### (f) Reclamo: la prueba de titularidad, dicha en voz alta

**¿Basta con verificar el correo? Sí, y además es obligatorio.** Verificar el buzón es *exactamente* la misma
prueba con la que el invitado recibió su enlace de seguimiento: si alguien controla ese buzón, ya podía ver el
pedido. No se está bajando el listón, se está igualando. Consecuencias:
- El reclamo **exige `emailVerified=true`** (`403 EMAIL_NOT_VERIFIED`, guard existente). Sin ese requisito,
  registrarse con el correo de un tercero bastaría para quedarse su pedido — el agujero clásico de esta feature.
- El **token NO es prueba alternativa**: se descarta permitir "reclamar con el enlace desde una cuenta con otro
  correo", porque dejaría que quien intercepte el enlace se apropie del pedido y **bloquee** al comprador legítimo
  (el reclamo es de una sola vez). El token sirve para *leer*, nunca para *apropiarse*.
- **Vinculación explícita, nunca silenciosa** (decisión del orquestador sobre el hueco abierto del PO): nadie debe
  poder inyectar pedidos al historial de un tercero escribiendo su correo en un checkout.
- **El modelo aguanta las tres políticas sin migración**, que era el requisito: el pedido guarda `guestEmail` y la
  vinculación es un `UPDATE` posterior sobre `userId`+`claimedAt`. Cambiar a *auto-vínculo al pagar* = poblar esos
  dos campos en el settle; cambiar a *exigir login* = un check en el checkout. **El punto de decisión queda acotado
  a un solo lugar** y la política es **revisable por el humano**.
- **Efectos acotados (criterio 54):** el reclamo **solo** escribe `userId`, `claimedAt`, revoca los tokens y
  audita. No mueve items a la bóveda, no cambia `fulfillmentMode`, ni precios, ni políticas, ni el estado del
  pedido. Un pedido ya entregado se reclama igual y queda como pedido cerrado en el historial.
- **Una sola vez (criterio 55):** `UPDATE ... WHERE id=:id AND userId IS NULL AND guestEmail=:correoVerificado`
  con `count===1` como ganador. Es el mismo patrón de reserva atómica que ya usa `createSession`; no hace falta
  bloqueo ni transacción serializable.

**Disputa de un invitado (criterio 56b) — decisión de NO modelar:** se descarta volver `Dispute.userId` nullable en
esta versión. El invitado abre su disputa **por correo a soporte** citando su `orderNumber` (que es exactamente lo
que PROJECT §J describe), el súper-admin evalúa y, si procede, ejecuta **reembolso en M3** — endpoint que ya existe,
ya es money-out, ya es `super_admin` y ya queda auditado. Coste: en v1.5 una disputa de invitado **no deja fila
`Dispute`**, así que no aparece en la cola de M8 ni en las métricas de disputas. **Deuda propuesta (para que el
techlead decida si la registra y a quién la enruta): `Dispute.userId` nullable + `orderId` para dar trazabilidad a
las disputas de invitado en M8.** No es bloqueante del DoD de este stream.

#### (g) Correo: `orders` usa el puerto, no toca el módulo `mail`

`MailModule` es `@Global()` y **exporta `MAIL_PORT`** (`MailPort.send({to,subject,html,text})`), de modo que
`orders` puede renderizar su **plantilla local** (`backend/src/modules/orders/mail/guest-order.templates.ts`, ES/EN
por `Order.locale`) y enviarla **sin modificar `mail` por dentro** — exactamente el patrón que `buylist` estrenó en
v1.18 (§4.18) y que PROJECT declara fuera de alcance ("cambios internos al módulo `mail`"). `MailService` conserva
sus dos métodos actuales; **no se le añade nada**.

Envío **best-effort post-commit**: su fallo se loguea y **no** revierte el pago ni hace fallar el webhook (un 5xx
haría que Stripe reintentara un settle ya aplicado). La red de seguridad ante un fallo de correo es triple: el
`trackingToken` ya devuelto por `POST /checkout/guest/session`, el reenvío self-service y el reenvío de soporte.
Contenido **prohibido** en el correo: cualquier dato de otro pedido, la dirección completa, datos de pago más allá
de la terminación, y **nunca** un enlace a acciones (cancelar/reembolsar).

#### (h) Reparto de trabajo (v1.21)

- **Backend:** (1) migración **M-25** + secuencia `order_number_seq` y backfill; (2)
  `computeDirectShipBreakdown` en `common/money.ts` (aditivo) y 7 códigos en `common/error-codes.ts`;
  (3) `GuestCheckoutService` en `modules/orders` (quote/session, `@Public()`, throttle, sin consultar `User`);
  (4) `OrderAccessTokenService` (emitir/rotar/validar/revocar, espejo de `AuthTokenService` pero multi-uso);
  (5) rama `direct_ship` en `payments.service` (settle → `picking` + crear `ShipmentRequest` idempotente +
  `paymentMethodBrand/last4` + correo post-commit); (6) ramificación de la terminal en M4; (7) claim
  (`/orders/claimable`, `/orders/claim`) con guard de `emailVerified` y update condicional; (8) endpoint admin de
  reenvío + `AuditLog`; (9) job `guest-order-sweep`; (10) plantilla de correo local; (11) **tests**: DTO público sin
  ningún campo prohibido, token inválido/expirado/revocado/de otro pedido, reclamo doble, reclamo con correo no
  verificado, `GET /shipments` no devuelve envíos `userId=null`, contracargo antes/después de enviar, idempotencia
  del webhook, no doble conteo del envío.
  - **v1.21.2 — tests EXIGIDOS de contracargo (§4.21c-bis). El caso «contracargo antes/después de enviar» ya estaba
    pedido aquí y NO se escribió; sin él T1 pasó los gates. Ahora es condición de aprobación**, uno por fila de la
    tabla normativa: (i) contracargo con envío en **`picking`** ⇒ envío a `cancelado`, item **sigue** en `picking`
    (**assert explícito de que NO queda en `listed`/`in_stock`**), `chargebackNeedsManual=true`; (ii) ídem con envío
    en **`guia`**; (iii) contracargo con envío **`enviado`** ⇒ nada de inventario, flag `true`; (iv) contracargo
    **sin envío** (orden `pending`) ⇒ `reserved → listed` y flag `false`; (v) **test de regresión del double-sell**:
    tras (i), `POST /checkout/quote|session` sobre esa pieza devuelve **`409 ITEM_UNAVAILABLE`** y
    `GET /admin/shipments/picking-list` **no la incluye**; (vi) los tres desenlaces de
    `POST /admin/orders/:id/chargeback-inventory`, incluido `reexpedir` **rechazado con `422`** mientras la orden
    siga en `chargeback`; (vii) `charge.dispute.closed` con `won` **no** re-expide solo y **mantiene** el flag en
    `true`. Además: (viii) invariante D4 — un `ShipmentRequest` con `orderId` cuya orden tenga un
    `fulfillmentMode` no soportado **lanza**, no cae en la rama `direct_ship`.
- **Frontend:** checkout de invitado (3 vías sin perder carrito), doble captura de correo, upsell de bóveda a partir
  de `422 VAULT_REQUIRES_ACCOUNT`, página `/[locale]/pedido` (token del query → body, `replaceState`, `noindex`),
  pantalla de enlace expirado con reenvío, confirmación con oferta de cuenta, y banner "tienes N pedidos por
  reclamar" tras verificar el correo.
- **QA:** los flujos de PROJECT §J.1 tal cual, incluidos los negativos (correo inválido, dirección no-MX, token
  manipulado/expirado, token de un pedido que no abre otro, pedido ya reclamado).
- **Seguridad (fase de release):** el `GuestOrderTrackingDTO` y el oráculo del reenvío son los dos objetivos
  prioritarios del pentester.

---

## 5. Decisiones transversales

- **Dinero sin balance:** no hay wallet ni saldo; cada movimiento de dinero es una transacción Stripe (ventas/reembolsos) o un pago SPEI manual (buylist). Ninguna vista de usuario muestra saldo.
- **Montos:** enteros en centavos MXN; IVA siempre desglosado y persistido en `Order.ivaCents` para M7/CFDI.
- **P&L (M7) — ingreso y costo de envío son cosas distintas (v1.4-finance):** el envío aporta al P&L por **dos** lados: un **ingreso** (`ShipmentRequest.shippingFeeCents`, lo que el cliente paga) y un **costo** (`ShipmentRequest.shippingCostCents`, lo que la plataforma paga a la paquetería, M-16). El P&L los suma/resta por separado: `profitCents = incomeCents + shippingRevenueCents − cogsCents − stripeFeesCents − shippingCostCents`. Ambos importes de un mismo envío se acotan al periodo por **`pickingAt`** (envíos liquidados: `status ∈ {picking, guia, enviado, entregado}`), garantizando que ingreso y costo del envío caigan en el mismo periodo. Antes de v1.4-finance el P&L solo contaba el ingreso, sobreestimando la ganancia. Response/CSV en `API_CONTRACT §M7` (`shippingCents`→`shippingRevenueCents` + nuevo `shippingCostCents`).

### 5.1 Cálculo del checkout (precio de venta, IVA y fee gross-up)
Orden de compra de cartas:
```
salePriceCents(item) = item.listPriceCents  // = round(referenciaMxn × (1 + salesMarkupPct/100)), o override manual
subtotalCents        = Σ salePriceCents(item)
ivaCents             = round(subtotalCents × ivaPct/100)                 // ivaPct default 16
baseCents            = subtotalCents + ivaCents                          // lo que la plataforma debe recibir íntegro
// Gross-up de la comisión Stripe MX (pct + fija), INCLUYENDO el IVA que Stripe cobra SOBRE su comisión:
totalCents           = ceil( (baseCents + (1 + stripeFeeIvaPct)·stripeFixedCents) / (1 − (1 + stripeFeeIvaPct)·stripePct) )
processingFeeCents   = totalCents − baseCents                            // línea visible, SIN IVA de PRODUCTO adicional
```
Retiro/envío (mismo gross-up, IVA de producto sobre el envío):
```
baseCents          = shippingFeeCents + round(shippingFeeCents × ivaPct/100)
totalCents         = ceil( (baseCents + (1 + stripeFeeIvaPct)·stripeFixedCents) / (1 − (1 + stripeFeeIvaPct)·stripePct) )
processingFeeCents = totalCents − baseCents
```
`stripePct`, `stripeFixedCents` y `stripeFeeIvaPct` son diales de M10 (tarifa MX vigente de Stripe; `stripe_fee_iva_pct` default **0.16**). La comisión efectiva de Stripe es `(1+stripeFeeIvaPct)·(pct·total + fija)` porque Stripe MX **grava su propia comisión con IVA**; el gross-up despeja `total` para que, tras esa comisión con IVA, la plataforma reciba `baseCents` íntegro. El `processingFeeCents` es lo que la plataforma cede a Stripe (comisión + su IVA), trasladado al comprador. **Aclaración:** "el fee no lleva IVA" se refiere al **IVA de PRODUCTO** — el fee no agrega una línea de IVA de venta; el IVA de la *comisión de Stripe* sí está contemplado dentro del gross-up (cierre del hallazgo C1 de la revisión de Stripe).
- **Seguridad/roles:** 3 roles. Autorización por **acción**, no solo por ruta (§7). Guard `MoneyOutGuard` exige `super_admin` para pagos SPEI y reembolsos; todo intento (permitido o bloqueado) se audita.
- **Imágenes (v1.2):** el producto **no lleva fotos propias**; se muestra la **imagen de catálogo remota** de pokemontcg.io (`Card.imageSmallUrl`/`imageLargeUrl`). La **única** subida del sistema es la **imagen del INE** del buylist (`kyc_ine`), a object storage **privado** con presigned PUT/GET y **retención** (§3.4). No hay fotos de producto/inventario ni de evidencia de disputa (la evidencia de disputa llega por correo a soporte).
- **Sync de precios/FX (jobs BullMQ):**
  - `price-sync` diario: recorre solo cartas **en bóveda**, respeta rate-limit del free tier, escribe `PriceReference` del día, genera `PendingPriceEntry` para faltantes. **v1.12-catalog-pricing:** el catálogo **completo** ya se precia aparte durante el `catalog-sync` (§4.13a, `escalate=false`); este job de bóveda se conserva para refrescar los items en custodia **entre** syncs de catálogo (y sí escala pendientes, porque son cartas que sí necesitamos preciar).
  - `fx-refresh` diario: obtiene USD→MXN de **Banxico (SIE)**, aplica el colchón (`fx_buffer_pct`) y escribe `FxRate` (`source=banxico`); si falla o hay override manual (M10), usa `source=manual` como fallback/prioridad.
  - `buylist-sweep`: 7 días sin respuesta a ajuste → `rechazada`; 30 días de abandono → `convertida a inventario`.
  - `dispute-deadline`: cierra ventana de recompra a 7 días desde entrega.
  - `portfolio-snapshot` diario (tras `price-sync`): por cada usuario con holdings, calcula el valor del portafolio con `VaultService.holdings()` (a **referencia**, excluyendo pendientes) y **upsert** de `PortfolioSnapshot` del día (`@@unique[userId,asOfDate]`). Alimenta la gráfica de tendencia (§3 PortfolioSnapshot, `GET /vault/portfolio/history`). **Depende de cablear el scheduler (BE-5).**
  - `set-price-sync` diario (v1.9-set-chart, tras `fx-refresh`; cron sugerido `30 6`): precia **TODAS** las cartas del **set destacado** (§4.12b) desde pokemontcg.io (acabado `normal`, `raw`), escribiendo `PriceReference` del día por carta. **No filtra por bóveda** (brecha nueva DEV-3, §9): recorre `Card WHERE setId=<featured>` sin tocar `InventoryItem`. Respeta cache diario y rate-limit del free tier.
  - `set-value-snapshot` diario (v1.9-set-chart, tras `set-price-sync`; cron sugerido `15 7`): agrega el valor del set destacado según la regla §4.12a y hace **upsert** de `SetValueSnapshot` del día (`@@unique[setId,asOfDate]`). Alimenta la gráfica pública del hero (§3 SetValueSnapshot, `GET /catalog/featured-set/value-history`). Orden duro: FX → precio del set → snapshot del set.
  - `catalog-price-sync` **2×/día** (v1.12-catalog-pricing, §4.13c; crons sugeridos `0 12` y `0 0` UTC = **06:00 y 18:00 CDMX**, dueño devops): **importa sets nuevos** y **refresca precios de TODO el catálogo**. Como pokemontcg.io no tiene bulk de solo-precios, refrescar precios ⇒ **re-sync completo** (`syncAll({force:true})`): `upsertCards` repuebla cartas + `PriceReference` por acabado (1.1) con el FX del día. Secuencial (respeta backoff 429 del cliente), single-flight (`syncAllStatus.running`), idempotente (upsert). Requiere `POKEMONTCG_IO_API_KEY` para la cuota (§8). **Nuevo respecto al `price-sync` de bóveda:** este SÍ precia el catálogo completo (no filtra por `InventoryItem`).
- **Validaciones duras:** dirección de envío/retiro **debe ser MX** (rechazo si no); retiro solo sobre `settled`; carta "precio pendiente" **no comprable**; topes de buylist (por solicitud/mes) e INE sobre tope.

---

## 6. i18n (convención)

- **UI 100% bilingüe ES/EN, default ES**, toggle a EN. Los copys viven en `frontend/src/i18n/messages/{es,en}.json` (propiedad de frontend/ux-ui).
- **El contrato de datos NO se traduce.** El backend responde con:
  - **enums** estables (ej. `status: "settled"`), que el frontend mapea a texto localizado.
  - **`errorCode`** por error (ej. `PRICE_PENDING`, `ITEM_NOT_SETTLED`, `ADDRESS_NOT_MX`, `BUYLIST_LIMIT_EXCEEDED`), que el frontend traduce.
  - **datos de catálogo en inglés** (nombres/sets de pokemontcg.io) — se muestran tal cual por diseño, en ambos idiomas de UI.
- `User.locale` guarda la preferencia; el frontend también respeta el toggle de sesión.

---

## 7. Seguridad, roles y autorización por acción

| Acción | customer | vault_operator | super_admin |
|---|---|---|---|
| Storefront/compra/bóveda/retiro/buylist (como cliente) | ✅ | — | — |
| **Acciones sensibles con `emailVerified=false`** (comprar / retirar / vender) | ❌ **403 `EMAIL_NOT_VERIFIED`** (`EmailVerifiedGuard`, §4.11) | n/a | n/a |
| M1 Inventario (alta, mover, fotos, pérdida/daño) | — | ✅ | ✅ |
| M2 Precios (sync, override, FX, tabla rareza) | — | — | ✅ |
| M3 Órdenes ver | — | ✅ (solo lectura) | ✅ |
| **M3 Reembolso (dinero saliente)** | — | ❌ (bloqueado + auditado) | ✅ |
| M4 Retiros/envíos (picking, guía, estados) | — | ✅ | ✅ |
| M5 Buylist hasta **verificación** (recibir, verificar, decidir/ajustar) | — | ✅ | ✅ |
| **M5 Pago SPEI (dinero saliente)** | — | ❌ (bloqueado + auditado) | ✅ |
| M6 Usuarios/KYC | — | ver limitado | ✅ |
| M7 Finanzas/P&L | — | ❌ | ✅ |
| M8 Disputas (revisión) | — | ✅ | ✅ |
| **M8 Recompra (dinero saliente)** | — | ❌ | ✅ |
| M9 Reportes | — | ❌ | ✅ |
| M10 Config/diales | — | ❌ | ✅ |
| M10 Bitácora (lectura) | — | ❌ | ✅ |

Regla de oro: **el dinero que sale solo lo toca el súper-admin**; todo queda en bitácora.

**Invitado (sin cuenta) — v1.21-guest-checkout.** No es un `Role` (no hay fila `User`, no hay JWT, no hay rol que
escalar): es la **ausencia** de sesión, y su superficie es una lista cerrada de endpoints `@Public()`
(`POST /checkout/guest/quote|session`, `POST /orders/guest/track|resend-link`). Autorización por acción:

| Acción | Invitado |
|---|---|
| Navegar Compra / ver ficha y precios | ✅ (ya era público) |
| **Comprar con envío directo a domicilio MX** | ✅ (`direct_ship`, envío en el mismo PaymentIntent) |
| **Guardar en bóveda** | ❌ `422 VAULT_REQUIRES_ACCOUNT` → **upsell de registro**, nunca un error |
| Ver **su** pedido por enlace tokenizado | ✅ solo lectura, datos mínimos, **un** pedido |
| Listar/buscar pedidos, ver otro pedido | ❌ no existe endpoint (criterio 52) |
| Cualquier mutación sobre el pedido (cancelar, cambiar dirección, reembolso, factura) | ❌ ninguna acción disponible con token |
| Vender (buylist), portafolio, direcciones guardadas, back-office | ❌ exigen cuenta |
| Abrir disputa por API | ❌ — se atiende **por correo a soporte** citando el `orderNumber` (§4.21f) |
| Reclamar su pedido | ✅ solo tras **crear cuenta y verificar el correo** (`403 EMAIL_NOT_VERIFIED` si no) |

Dos reglas que cierran el cruce entre mundos: un endpoint `/checkout/guest/*` con **sesión válida** responde
`409 ALREADY_AUTHENTICATED`, y el `OrderAccessToken` **nunca** se acepta como credencial de sesión (no otorga rol,
no lo lee ningún guard, no abre ningún endpoint `customer`).

---

## 8. Riesgos técnicos y notas para devops

Variables de entorno necesarias (sin valores; devops las gestiona):
- `DATABASE_URL`, `REDIS_URL`
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
- `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`
- `POKEMONTCG_IO_API_KEY`, `POKEMONPRICETRACKER_API_KEY`, `POKETRACE_API_KEY`
- Object storage (**SOLO INE de KYC**, v1.2): `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL`. **El set `S3_*` se conserva**, ahora justificado únicamente por `kyc_ine` (bucket **privado** + cifrado + retención `INE_RETENTION_DAYS`). No se usa para fotos de producto/inventario ni de disputa. (`S3_PUBLIC_BASE_URL` no aplica al INE, que es privado; se lee vía presign GET.)
- **PII / INE (KYC):** `PII_ENCRYPTION_KEY` (32 bytes base64, AES-256-GCM), `PII_HMAC_KEY` (blind index de CLABE, llave **separada**), `INE_RETENTION_DAYS` (antigüedad máxima de las imágenes de INE en el bucket, default **180**; ver §3.4). En prod las llaves provienen de KMS/secret manager, nunca del repo. Estas variables **se conservan intactas** (v1.2.1: INE almacenado con cifrado + retención).
- FX (automático desde Banxico SIE): `BANXICO_SIE_TOKEN` (token de la API SIE); modo override manual vía dial M10 sin token
- **Set destacado del hero (v1.9-set-chart):** `HOME_FEATURED_SET_ID` (**opcional**; id **nativo de pokemontcg.io** del `CardSet` a graficar en la home, ej. `sv8`). Si no se define o no resuelve a un `CardSet` local, aplica el fallback en cascada de §4.12b (mayor valor en el último snapshot → set más reciente por `releaseDate`). **El valor concreto lo fija devops/backend** por entorno; el arquitecto define solo el mecanismo. No es secreto. Reusa `POKEMONTCG_IO_API_KEY` para el `set-price-sync`.
- **Auth Google:** `GOOGLE_CLIENT_ID` (backend, para validar `aud` del ID token) y `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (frontend, Google Identity Services). Sin `client_secret` en el MVP (flujo de ID token, no code-exchange).
- **Correo (v1.5-auth-email, Resend):** `RESEND_API_KEY` (secreto) y `MAIL_FROM` (default `no-reply@tcgvaultmx.com`).
  - **Política (sigue el patrón `env.validation.ts` local/no-local):** `RESEND_API_KEY` se añade a la lista
    `required` → **obligatoria en NO-local (staging + prod)**; en LOCAL_ENVS (`development`/`test`/`local` o sin
    `NODE_ENV`) puede faltar y el sistema **degrada** a `NoopMailAdapter` (loguea el correo/link, no envía) para
    no romper dev/CI/tests sin key. `MAIL_FROM` es opcional con default en código (no bloquea el arranque).
  - **Justificación:** la verificación **gatea dinero** (comprar/vender/retirar); si el correo degradara en prod,
    los usuarios locales nunca podrían verificar → quedarían bloqueados. Por eso en no-local (incl. **staging**,
    que debe probar el flujo real E2E) la key es dura. *(Decisión a confirmar por el humano: exigir key también en
    staging; ver §10.)*
  - **Dominio remitente:** `tcgvaultmx.com` requiere SPF/DKIM/DMARC verificados en Resend (nota devops). El correo
    de soporte de disputas es `soporte@tcgvaultmx.com` — **mismo dominio canónico** que el remitente; ver §10 v1.5-2
    (**CERRADA** 2026-08-16: dominio unificado, ya no hay inconsistencia).
- `APP_BASE_URL`, `DEFAULT_LOCALE=es` (`APP_BASE_URL` = base del frontend; también se usa para construir los
  links de verificación/reset del correo, §4.11).

Riesgos técnicos:
- **Rate-limit free tier** (100/día, 250/día): mitigado priciando solo bóveda + cache diario + cola; si crece la bóveda, puede requerir plan de pago (dial permite el cambio).
- **Idempotencia de webhooks** Stripe: obligatoria para no duplicar `settled`/reversos.
- **Consistencia de titularidad**: transiciones `pending→settled` y reversión por contracargo deben ser transaccionales con `InventoryMovement`.
- **CFDI/PAC**: el MVP **registra** datos e IVA cobrado y ofrece **solicitud de factura por correo** (sin PAC); el timbrado real (PAC) es **fase 2** (bandera fiscal de PROJECT).
- **Concurrencia de venta**: un `InventoryItem` es pieza única; el checkout debe **reservar** (`status=reserved`) para evitar doble compra.

---

## 9. Desviaciones detectadas

> El arquitecto **no corrige código** (CLAUDE.md): documenta la desviación y la enruta al **rol dueño**
> (backend). Estado del código revisado el **2026-08-16** (plataforma ya en producción; back-office M1–M10 con
> backend en su mayoría implementado; **M7 ya tiene UI consumidora real** —`admin/m7/M7View.tsx`—, el resto de
> módulos sigue con UI en `ModuleTodo` pendiente de consumir).

- **BL-1 (backend, v1.18-buylist-rejects) — monto FANTASMA en `approvedTotalCents` tras approve→reject.** Estado
  detectado (`buylist.service.ts`, `itemDecision` L651 / `recomputeApprovedTotal` L707): la rama `reject` solo fija
  `itemStatus='rechazada'` sin anular `approvedPriceCents`, y el recompute suma TODO `approvedPriceCents != null`
  **sin filtrar por status**. Un ítem aprobado (o ajustado) y luego rechazado deja su monto dentro de
  `SellRequest.approvedTotalCents` — infla el total que lee el pago SPEI/P&L (dinero saliente; contradice la
  intención RB-6/SEC-D3). En el primer `reject` (sin monto previo) no se manifiesta. **Norma v1.18 (API_CONTRACT
  §M5):** `reject` ⇒ `approvedPriceCents=null` + recompute; recomendado además excluir `itemStatus='rechazada'` en el
  aggregate (defensa en profundidad, §4.18b). **Acción (backend, este stream):** aplicar ambas y cubrir con test la
  secuencia approve→reject. Adicional menor detectado: `adminList` ordena `createdAt asc` — el contrato v1.18 norma
  **desc** (mismo dueño, mismo stream).
- **WD-1 (backend, v1.17) — el `InventoryItem` NUNCA se movía en el ciclo de RETIRO (bóveda "fantasma").** Estado
  detectado: al pagar un retiro, `payments.service` solo avanzaba `ShipmentRequest solicitado→picking` y el
  `InventoryItem` quedaba `ownerType=customer, ownershipStatus=settled, status=in_custody` **para siempre** —incluso
  tras `entregado`—; `vault.service.holdings` filtraba solo por `ownerType/ownerUserId` sin excluir ni marcar items en
  retiro, así que la carta seguía en "Mi Bóveda" como LIQUIDADA con **RETIRAR activo** de por vida, y el cliente no
  tenía rastreo por carta. El enum `InventoryStatus` ya incluía `picking|shipped|delivered|withdrawn` pero **ningún
  código los escribía**. **Decisión de producto (humano) = Opción 1**, normada en API_CONTRACT v1.17 y §3.3 de este
  doc. **Acción (backend):** (1) `vault.service.holdings` — excluir `status='withdrawn'` y **derivar** `shipmentState`
  / `activeShipmentId` / `withdrawable` del join `ShipmentItem→ShipmentRequest` (sin espejar el estado en el item); (2)
  `shipments.service.updateStatus` — al pasar a `entregado`, transicionar los `InventoryItem` `in_custody→withdrawn` +
  `InventoryMovement reason='withdrawal'` (en transacción); (3) `shipments.service.listMine/getMine` — enriquecer
  `items[]` con `folio` + `card` + `finish`; (4) `portfolio-snapshot` — aplicar la misma exclusión de `withdrawn`. **Sin
  migración** (reusa enums existentes). SEC-A1 intacto (no toca montos). **Fuente de verdad = join** (no espejo en el
  item), declarada en §3.3.
- **DEV-1 (backend) — `POST /admin/catalog/sync` importa de forma SÍNCRONA en el request.** El contrato
  declara `202 { jobId, setsQueued, mode }` (semántica async/encolada), pero `CatalogSyncService.sync()`
  recorre e importa **todos** los sets `>= fromReleaseDate` **dentro del handler HTTP** (await inline por set y
  por página de cartas). Para un sync acotado a 2024+ es tolerable, pero para un **sync de todo el catálogo**
  (Opción 1, cientos de sets / decenas de miles de cartas) **provoca timeout** del request y no respeta la
  cola/rate-limit prometidos. **Acción (backend):** implementar el nuevo `POST /admin/catalog/sync-all`
  encolando en BullMQ (truly-async) y, deseablemente, alinear `sync` from-date al mismo patrón encolado. El
  `backfill` repetible **sí** es seguro (importa por lotes) y es el camino recomendado mientras `sync-all` no
  encole de verdad. Registrar en `docs/TECH_DEBT.md` si se difiere.
- **DEV-2 (informativo, no bloqueante) — `jobId` cosmético en sync/backfill.** Los métodos devuelven
  `jobId: \`catalog-sync-${Date.now()}\`` sin un job real detrás (la importación ya ocurrió síncrona). Es
  coherente con DEV-1: al encolar de verdad, el `jobId` debe ser el de la cola. Sin impacto de contrato para
  el front (trata el `jobId` como opaco).
- **DEV-3 (backend, v1.9-set-chart) — el `price-sync` actual solo precia BÓVEDA; falta preciar el set destacado
  completo.** La gráfica pública del set (§4.12) requiere `PriceReference` de **todas** las cartas del set
  destacado, pero el `price-sync` existente recorre únicamente cartas con `InventoryItem` en bóveda (para que el
  free tier alcance). **Brecha nueva:** se necesita el job `set-price-sync` que recorra `Card WHERE
  setId=<featured>` **sin** filtro de `InventoryItem`, acotado a ese único set (~150–250 cartas, tolerable con la
  cola/rate-limit existentes). **Acción (backend):** implementar `set-price-sync` + `set-value-snapshot` (§4.12c)
  reusando `PricingService`/`PokemonTcgIoProvider` y el cache diario. No cambia el `price-sync` de bóveda (queda
  intacto); es un job **adicional** acotado. Registrar en `docs/TECH_DEBT.md` si se difiere el cableado del
  scheduler (mismo estado que BE-5 para `portfolio-snapshot`).

- **DEV-3 — SUBSUMIDO por Fase 1 (v1.12-catalog-pricing).** La brecha "el `price-sync` solo precia bóveda" queda
  cubierta por 1.1 (§4.13a): el `catalog-sync` precia TODO el catálogo (acabado `normal` incluido) → `computeSetValue`
  ya tiene datos de cualquier set, no solo del destacado. `set-price-sync` se conserva (inocuo) pero es en gran medida
  redundante; su retiro es opcional (fase 2), no bloquea nada.
- **BE-16 — RESUELTO por Fase 1 (v1.12-catalog-pricing, §4.13b).** El cotizador público `publicQuote` deja de
  escribir en la cola (`escalatePending` eliminado del endpoint anónimo) y vuelve a ser read-only; el priming del
  catálogo (1.1) hace que el read casi siempre encuentre precio. **Acción (backend):** quitar la llamada a
  `escalatePending` de `buylist.service.ts` `publicQuote` (~:81-83); dejar la escalada solo en `createRequest`.
- **DEV-4 (backend/devops, v1.12-catalog-pricing) — el barrido `catalog-price-sync` corre in-process (memoria).**
  El refresco 2×/día reusa `runSyncAll` secuencial in-process (misma limitación DEV-1): si el proceso reinicia a
  media corrida, la siguiente corrida (o `sync-all` manual) reanuda. Aceptable interino (idempotente/reanudable);
  el objetivo robusto es encolar **un job BullMQ por set** (retry/persistencia de progreso). Registrar en
  `docs/TECH_DEBT.md` si se difiere. **Nota de escala:** `PriceReference` crece ~1 fila/día por (carta, acabado) del
  catálogo (~30–40k filas/día); considerar retención/particionado de la serie temporal en fase 2 (no bloquea el MVP).
  - **DIRIGIDO por WS-A (v1.14-price-ingest, §4.15).** El "objetivo robusto (un job BullMQ por set)" es exactamente el
    diseño del nuevo `price-ingest`/`price-ingest-set` (§4.15c): fan-out por set con cola persistida en Redis,
    aislamiento de fallos, reintentos y reanudabilidad. Al desplegar WS-A, el `catalog-price-sync` `force:true`
    (barrido fire-and-forget que motivó DEV-4) queda **deprecado en su rol de pricing** y se conserva solo para import de
    metadata de sets nuevos (`force:false`). **Acción (backend):** implementar `price-ingest` (§4.15c) y aligerar
    `catalog-sync` a metadata (§4.15g); (devops) repuntar el slot 2×/día al `price-ingest`.
- **DEV-5 (backend, v1.14-price-ingest) — `catalog-sync` escribe PRECIOS (rol que WS-A le retira).** `upsertCards`
  (`catalog-sync.service.ts`) llama `persistMarketReferences` y deriva `availableFinishes` de `tcgplayer.prices`
  (v1.12). WS-A mueve el **pricing y las variantes** al `price-ingest` (proveedor de paga, §4.15e/g): `catalog-sync`
  debe **quitar** `persistMarketReferences` (y las deps `PricingService`/`FxService`) y quedar en **solo metadata**;
  `deriveAvailableFinishes` se conserva como **bootstrap** (default seguro para sets recién importados) que el ingest
  sobre-escribe. `PricingService.persistMarketReference` se **generaliza** (aceptar `source`/moneda, hoy hardcodea
  `pokemontcg_io`+USD). No es un bug en producción hoy (funciona), pero **contradice la doctrina WS-A** de "catalog-sync
  = solo metadata" → se documenta y enruta a **backend**.

- **BE-25 — DIRIGIDO (parcial) por WS-E (v1.16-master-set, §4.17c).** El N+1 de settings en `fetchSellable`
  (`SALES_PRICE_RULES`+fallback leídos sin cache por ítem) se paga **mínimamente** dentro de WS-E: izar esas dos
  lecturas **una vez por request** + usar el nuevo `getReferencesBatch` en `fetchSellable`/`bulk-publish`. El resto de
  BE-25 (memoización global de `SettingsService`, familia BE-4/D3) sigue como deuda menor en `docs/TECH_DEBT.md`.
  **RB-8** (regla de valuación duplicada) se **cierra** al extraer `PricingService.getReferencesBatch` (§4.17c).
  **Acción (backend):** aplicar dentro de la entrega de WS-E; anotar el remanente en `docs/TECH_DEBT.md`.

- **BE-36 (backend, v1.16.1) — `isSecretRare` del binder marca TODOS los promos como secret rare.** La forma amplia
  `isSecretRare = numberSort > printedTotal` (§4.17a original) marca como secret rare **cualquier** carta empujada al
  final del orden, incluidos los promos/subsets con prefijo alfabético (TG/GG/SV), que **no** son secret rares sino un
  subset aparte. El contrato (v1.16.1) **afina** la definición como **heurística de display**: `true` **solo** para
  numeración principal (número puramente numérico) con entero `> printedTotal`; promos/subsets alfabéticos → `false`;
  `printedTotal` nulo → `false`. **Es solo un flag de presentación** (no afecta dinero, custodia ni completitud —
  `completionPct` usa `catalogCardCount`, WS-E-1). **Acción (backend):** alinear el cómputo de `isSecretRare` a la
  definición afinada (gate `number ~ '^[0-9]+$'` + `printedTotal` no nulo); registrar en `docs/TECH_DEBT.md` si se
  difiere (no bloqueante — es cosmético). Decisión de producto (default propuesto): subset por prefijo alfabético no
  cuenta como secret rare.

Fuera de estos puntos, el código revisado (M2, M6, M7, M9, M10, buylist, catalog, pricing) **concuerda** con
este documento y con `API_CONTRACT.md`.

---

## 10. Decisiones resueltas (antes "Preguntas para el humano")

### Preguntas abiertas (v1.21-guest-checkout — WS «Órdenes y dinero»)

> Ninguna bloquea el desarrollo: **todas tienen un supuesto implementado** y el modelo está diseñado para que
> cambiar la respuesta sea un ajuste acotado, **sin migración**.

- **v1.21-1 — Correo del invitado que YA tiene cuenta (la que PROJECT deja abierta, v1.5-1).** Implementado:
  **no se revela**, la compra procede como invitado y el pedido queda **sin vincular** hasta el **reclamo explícito**
  del titular con correo **verificado**. Es la única de las tres opciones que **no** reintroduce enumeración de
  usuarios ni permite ensuciar el historial de un tercero. **Punto de decisión acotado (§4.21f):** el modelo guarda
  `guestEmail` en el pedido y la vinculación es un `UPDATE` posterior de `userId`+`claimedAt`, así que pasar a
  *auto-vínculo al pagar* = poblar esos dos campos en el settle, y a *exigir login* = un check en el checkout.
  **Decisión del orquestador; revisable por el humano.**
- **v1.21-2 — Vigencia del enlace (PROJECT v1.5-2).** Implementado: **90 días** desde cada emisión, con **tope de
  edad de la orden de 365 días** para emitir nuevos (si no, el reenvío mantendría la puerta abierta para siempre).
  Cambiar a 30 días o a "X días tras entregado" es cambiar una constante.
- **v1.21-3 — Reenvío self-service (PROJECT v1.5-3).** Implementado: **sí**, con respuesta `202` neutra siempre,
  3/hora por IP, 5/día por pedido, y exigiendo `(email + orderNumber)` juntos cuando no se presenta un token.
  Existe además el reenvío **de soporte** (endpoint admin auditado). Si el humano prefiere "solo soporte", se
  desactiva el endpoint público sin tocar nada más.
- **v1.21-4 — `orderNumber` secuencial y legible.** Se elige `TCG-000123` con secuencia Postgres (patrón `folio`)
  porque los criterios 45/49/53/56b lo exigen para correos, soporte y disputas. **Filtra el volumen de ventas** a
  quien vea un número. La alternativa (número aleatorio no correlativo) es igual de barata si al humano le importa
  esa señal. **No da acceso a nada por sí solo.**
- **v1.21-5 — Tope comercial por pedido de invitado (PROJECT v1.5-5).** Hoy **no hay tope de monto** (solo el
  técnico de **20 líneas** por pedido, anti-abuso). Si el humano quiere limitar exposición a contracargos, entra
  como constante/dial sin cambio de contrato.
- **v1.21-6 — Disputa de invitado sin fila `Dispute` (§4.21f).** Implementado: correo a soporte + **reembolso en
  M3**. Coste: no aparece en la cola de M8 ni en métricas de disputas. **Deuda propuesta** (que el techlead enrute
  si la considera): `Dispute.userId` nullable + `orderId`.
- **v1.21-7 — Retención de datos del invitado no reclamado (PROJECT v1.5-7, sin supuesto).** El pedido guarda
  correo, teléfono y dirección de una persona **sin cuenta**, en claro (mismo régimen que `User.email`; el cifrado
  en reposo de §3.4 está reservado a CLABE/RFC/INE). **Depende de la postura legal**, no de la técnica: cuando el
  humano fije el plazo, la implementación natural es un job que **anonimiza el snapshot y el `guestEmail`** de
  pedidos entregados hace más de N días, **conservando** los montos e IVA para M7. Se deja anotado porque afecta
  también a "solicitud de borrado" (bandera de privacidad de PROJECT).
- **v1.21-8 — Idioma del correo (PROJECT v1.5-8).** Implementado: `Order.locale` capturado en el checkout, default
  `es`.

### Preguntas abiertas (v1.20-master-set-everywhere — WS «Inventario y vault»)
> No bloquean el diseño (defaults propuestos y **normados en el contrato**); se listan para veto/ajuste del humano.
- **WS-IV-1 — ¿Qué `productType` cubre una casilla?** Default (conserva v1.16): **cualquier** pieza del
  `(cardId, finish)` cubre la variante (graded/sealed mapean a `finish=normal`, §3.7). Alternativa de producto:
  solo `raw` cuenta para el master set (una gradeada no "llena" la casilla de la carta raw). Cambiarlo es un filtro
  más en la agregación, sin cambio de shape.
- **WS-IV-2 — `buyable` = pieza `listed` más barata del `(cardId, finish)`, cualquier `productType`.** ¿Se
  restringe a `raw` (coherente con WS-IV-1) o se deja abierto (el cliente ve la opción más barata y decide en la
  ficha)? Default: abierto.
- **WS-IV-3 — `encontrada` con costo por aportación (default `aportacion_en_especie`, 70%).** ¿Correcto que una
  pieza hallada en el levantamiento se cargue como aportación en especie del dueño (afecta P&L/base de costo), o
  debe pedirse `acquisitionType` explícito siempre? Default: `aportacion_en_especie` si se omite.
- **WS-IV-4 — Índice de cliente solo con sets con ≥1 pieza.** ¿Se desea un toggle "ver todos los sets del
  catálogo" en el índice (iii)? Hoy el binder de cualquier set ya es accesible por `:setId`; el índice filtrado
  evita listar cientos de sets vacíos. Default: solo con piezas.

### Preguntas abiertas (v1.19-sealed-tcgcsv — referencia de mercado del sellado vía TCGCSV)
> No bloquean el diseño (defaults conservadores que preservan PROJECT 3e tal cual). Las dos primeras tocan PROJECT.md
> (fuente de precio del sellado / dinero), así que el arquitecto **no** las asume (CLAUDE.md — regla de conflicto).
- **v1.19-1 — ¿Mostrar la referencia TCGCSV en la ficha PÚBLICA del sellado?** PROJECT (criterio 2/3e) define la fuente
  del sellado como "precio manual del admin"; hoy la ficha pública del sellado no muestra "valor de mercado" aparte.
  Default v1.19: **NO** (la referencia es solo back-office). Si el humano quiere mostrarla como "valor de mercado" del
  sellado (paridad con singles), es un cambio de PROJECT + contrato público (versión futura).
- **v1.19-2 — ¿Costo de aportación en especie del sellado contra la referencia TCGCSV?** Hoy el costo del sellado
  aportado usa la referencia manual (`gradeKey='sealed'`) o escala. Usar TCGCSV automatizaría "referencia del día × %"
  (PROJECT §G) también para sellado, pero **mueve dinero (P&L)** → default v1.19: **NO cambia**; decisión del humano.
- **v1.19-3 — ¿Sugerencias asistidas de mapeo?** La curación v1.19 es 100% manual (explorador + asignación). Un
  asistente de sugerencia por similitud de nombre/set (sin auto-commit; el admin siempre confirma) es un nice-to-have
  de fase 2. Default: manual puro.
- **v1.19-4 — ¿Quién cura el mapeo?** Default: **`super_admin`** (es configuración de pricing, dominio M2). Alternativa:
  permitir a `vault_operator` mapear durante el alta M1 (no toca dinero directamente; la referencia es informativa).
  Confirmar si se relaja.

### Preguntas abiertas (v1.16-master-set — WS-E: Master Set + inventario a escala)
> No bloquean el diseño (defaults propuestos por el arquitecto). **Dos tocan una ambigüedad de PROJECT.md** (WS-E-1/2):
> PROJECT §F/M1 pide "vista Master Set… cantidad por carta/acabado / completitud" pero **no define** contra qué se mide
> la completitud ni qué inventario cuenta. El arquitecto **no asume** la regla de negocio (CLAUDE.md); propone default y
> lo señala al humano.
- **WS-E-1 — Denominador de la completitud.** `completionPct` = cartas distintas que tenemos / **total del set**. Pero
  "total del set" es ambiguo: `printedTotal` (nominal, sin secret/hyper rares) **o** `catalogCardCount` (todas las
  cartas del catálogo del set, incluidas las > printedTotal). Default propuesto: **`catalogCardCount`** (nunca da >100%;
  el `printedTotal` se expone aparte para el label "X / printedTotal"). ¿Confirma, o la completitud debe medirse contra
  `printedTotal` (y las secret rares cuentan como "extra")?
- **WS-E-2 — Qué inventario cuenta como "on-hand".** Default propuesto: `ownerType='platform'` **y** `status NOT IN
  (withdrawn, shipped, delivered, lost, damaged)` (lo que físicamente tenemos en bóveda de plataforma). ¿Se incluye
  también la custodia de clientes (`customer_custody`) en el Master Set, o el binder es **solo** stock de plataforma
  (recomendado, es back-office de inventario propio)? ¿`reserved`/`in_custody` cuentan como on-hand? Confirmar.
- **WS-E-3 — `qty` en el alta por lote.** Propuesta: `qty` (default 1) expande a N piezas para **bulk raw/sellado**;
  `graded` fuerza 1 (cada slab es único por `certNumber`). Es un atajo de captura, **no** cambia el modelo por-pieza (se
  crean N `InventoryItem` reales). ¿Se desea `qty`, o el carrito manda siempre 1 línea = 1 pieza (más explícito)?
- **WS-E-4 — Cap del lote (200) e idempotencia.** Cap propuesto **200** líneas/lote (constante de servidor) e
  idempotencia con `InventoryBatch` (nuevo modelo, M-21) que además **es** la auditoría del lote. Alternativa: cap como
  dial M10; idempotencia solo por header sin persistir (más frágil). Default: constante + `InventoryBatch`. Confirmar.
- **WS-E-5 — `numberSort` para números no-numéricos.** `Card.number` incluye promos/subsets (`TG12`, `GG01`, `SV107`).
  Propuesta: ordenar por parte numérica ascendente, con los no-numéricos-puros **al final** agrupados por prefijo. Es un
  orden de presentación (no de negocio); si el dueño quiere otro criterio (p. ej. subsets `TG` intercalados), se ajusta.

### Preguntas abiertas (v1.15-buylist-batch-clabe — WS-C: cotizador de Fable contra el backend real)
> No bloquean el diseño (defaults propuestos por el arquitecto); se listan para que el orquestador/humano vete o ajuste.
- **WS-C-1 — Naming del batch quote.** Propuesta: endpoint **NUEVO** `POST /buylist/quote/batch` conservando el
  por-carta `POST /buylist/quote` (aditivo, no-breaking). El pedido original nombraba `POST /buylist/quote` con
  `items[]` (overload). El arquitecto **elige el endpoint nuevo** para no romper el consumidor por-carta y por claridad
  de errores por-ítem. Si se prefiere el overload exacto (breaking, con el frontend migrado en la misma entrega), el
  orquestador lo indica.
- **WS-C-2 — ¿`qty` en el cotizador?** El modelo actual es **una línea por carta física** (sin `qty`). El batch espeja
  ese modelo (sin `qty`). Si el humano quiere cotizar/vender **N copias idénticas en una sola línea**, es un cambio de
  producto (afecta `SellRequestItem`, conversión a inventario 1-a-1 y topes AML) — **no se asume**. ¿Se desea `qty`?
- **WS-C-3 — Cap del batch (`BUYLIST_QUOTE_BATCH_MAX = 50`).** Constante de servidor propuesta (cubre el `pageSize` 20
  del grid con holgura). ¿Debe ser un dial M10 configurable en vez de constante? Default: constante (menos superficie).
- **WS-C-4 — Código `422 CLABE_REQUIRED`.** Nuevo código para "ni en request ni en archivo". Alternativa: reusar
  `422 CLABE_INVALID`. Propuesta: **código propio** (`CLABE_REQUIRED`) para que el front distinga "falta CLABE" de
  "CLABE malformada" y enrute a capturar/registrar CLABE. Confirmar el código.

### Preguntas abiertas (v1.14-price-ingest — WS-A: ingesta masiva vía proveedor de paga)
> No bloquean el arranque del **diseño**: backend puede construir la interfaz `BulkPriceProvider`, el job
> `price-ingest`/`price-ingest-set` y aligerar `catalog-sync` con los defaults propuestos. **Varias requieren
> verificación en RUNTIME (1ª corrida en Railway)** — el arquitecto **no asume** el esquema del proveedor (CLAUDE.md).
> **Toca dinero → validar antes de confiar el pricing al proveedor de paga.**
- **v1.14-1 (RUNTIME, crítica) — esquema exacto de `POST /cards/bulk-price`.** Campo de **acabado/variante**, de
  **precio** (`market`) y de **moneda** (¿USD o MXN?; ¿nombre del campo?). Default de diseño: `market` en **USD**,
  variante mapeada por tabla conservadora; **variante desconocida → OMITE**; moneda ausente → **asume USD** (proveedor de
  mercado US). **Se confirma en la 1ª corrida** (`POST /admin/jobs/price-ingest` con `setId?` conocido → inspeccionar
  `PriceReference`). Riesgo money: si en realidad fuera MXN, la conversión USD→MXN inflaría ~18× → **gate** antes del flip.
- **v1.14-2 (devops/negocio) — cuota/coste del plan del proveedor de paga.** ¿Límite de requests/día o de cartas del
  plan contratado? El bulk por set reduce ~100× las requests vs per-carta, pero un refresco 1–2×/día del catálogo
  completo (~160 sets) son ~cientos de requests/día. Confirmar plan/cuota y si `POKEMONPRICETRACKER_API_KEY` debe ser
  *required* en prod (recomendado cuando `PRICE_PROVIDER=pokemonpricetracker`).
- **v1.14-3 (devops) — cadencia y horarios del `price-ingest` (1–2×/día).** Default propuesto: **2×/día** alineado con
  el `fx-refresh` (FX fresco antes de convertir). ¿Confirmar horas? ¿1×/día basta para el negocio? Scheduling = **devops**.
- **v1.14-4 (rollout, money-safe) — seed del dial `PRICE_PROVIDER`.** Default recomendado: **`pokemontcg_io`** al
  desplegar (sin cambio de fuente; el job ya es robusto) y **flip a `pokemonpricetracker`** tras verificar v1.14-1.
  Alternativa: sembrar `pokemonpricetracker` desde el arranque (la key ya está en Railway). Confirmar la secuencia.
- **v1.14-5 (alcance) — ¿el proveedor de paga precia también GRADEADAS (PSA) en WS-A?** La respuesta bulk trae eBay/**PSA**.
  WS-A se acota a **raw market + variantes** (`raw:NM`, el barrido que hoy se cae). Preciar gradeadas (`graded:PSA:<grade>`)
  con el mismo proveedor es una **extensión natural** (misma respuesta bulk) pero **fuera del core de WS-A**; queda como
  puerta abierta (§0). Confirmar si se quiere en esta entrega o después.
- **v1.14-6 (correctness FX, #13) — vía del colchón-solo.** Default recomendado: guardar el colchón por `PUT
  /admin/settings { fxBufferPct }` (parcial, ya soportado) + hacer que `FxService.getCurrent()` prefiera el `bufferPct`
  del **dial** en todas las ramas (para que aplique de inmediato). Alternativa: `rate?` opcional en `PUT /admin/fx`.
  Confirmar cuál adopta el equipo (ambas son money-safe; la primera no cambia el contrato de FX).

### Preguntas abiertas (v1.13-sales-pricing — Fase 2 del epic de precios)
> No bloquean el arranque: backend puede implementar 2.1–2.4 y frontend 2.5 con los defaults propuestos (que
> **preservan el precio de venta actual** para las rarezas de fallback). El arquitecto **no asume** reglas de negocio
> (CLAUDE.md). **Requieren confirmación del humano:**
- **v1.13-1 — % exacto de venta para raras (fallback y por rareza).** Default propuesto: **`SALES_PRICE_FALLBACK_PCT =
  15`** (= `SALES_MARKUP_PCT` legacy ⇒ venta = market × 1.15, preserva el negocio actual). El humano puede querer un %
  distinto (más agresivo para chase) y/o **valores por rareza** (ej. Illustration Rare 25%, Secret Rare 40%). ¿Confirma
  15% de fallback? ¿Quiere sembrar %s por rareza desde el arranque, o los ajusta luego en M2 sin deploy?
- **v1.13-2 — Rango del validador de `pct` de venta.** El `pct` de venta es **markup arriba de mercado** (puede >100%,
  a diferencia de buylist que topa en 100%). Default propuesto: **`SALES_PCT_MAX = 1000`** (0..1000% = hasta 11×
  market; ancla un tope anti-typo). Alternativas: **sin tope superior** (paridad con el `SALES_MARKUP_PCT` legacy que
  era `>= 0`) o un tope más bajo (p. ej. 300%). Confirmar el tope.
- **v1.13-3 — ¿Retirar `SALES_MARKUP_PCT` ya, o conservarlo deprecado?** Default propuesto: **conservar el dial
  deprecado** un release (palanca de rollback; la ruta de venta ya no lo lee) y retirarlo (junto con la pura
  `computeSalePriceCents` y el campo M10 `salesMarkupPct`) en un follow-up. Alternativa: **retirarlo en esta entrega**
  (quitar del `SETTING_DTO_MAP`/M10View). Confirmar. *(Si se retira, el frontend de M10 pierde el campo — coordinar.)*
- **v1.13-4 — Piso `fixed` sin market habilita venta de bulk.** Con reglas `fixed`, una carta bulk **sin** referencia
  de mercado ahora obtiene `salePriceCents` (piso $5/$10) y puede volverse `sellable`. Es coherente con el ejemplo del
  humano (pisos de bulk), pero **cambia** qué inventario es publicable respecto a hoy (hoy sin market = no vendible).
  Default propuesto: **permitirlo** (es el objetivo del piso). Confirmar que el dueño lo quiere así (o si prefiere que
  el piso solo aplique cuando el item está `listed` explícitamente por el admin).

### Preguntas abiertas (v1.12-catalog-pricing — Fase 1 del epic de precios)
> No bloquean el arranque: backend puede implementar 1.1/1.2 y el job 1.3 con los defaults propuestos; frontend
> puede hacer 1.4 ya. El arquitecto **no asume** reglas de negocio (CLAUDE.md). **Requieren confirmación del humano:**
- **v1.12-1 — Horarios exactos del refresco 2×/día.** Default propuesto: **06:00 y 18:00 CDMX** (= crons UTC
  `0 12 * * *` y `0 0 * * *`; CDMX = UTC−6 sin DST). ¿Confirmar esas horas, o prefiere otras (p. ej. madrugada para
  menor carga)? Scheduling = dueño **devops**.
- **v1.12-2 — ¿El refresco 2×/día re-fetchea TODO el catálogo, o algo incremental?** Default propuesto: **re-sync
  completo** (`sync-all force:true`) — es simple, el precio viaja embebido en la carta y con API key la cuota alcanza
  (~cientos de req × 2/día). Alternativa (más ligera, más compleja): refrescar solo sets recientes / escalonar sets
  entre corridas / refrescar por prioridad (bóveda + sets destacados primero). Confirmar si basta el full o se quiere
  incremental.
- **v1.12-3 — On-demand en el cotizador público: ¿sí o no?** Default propuesto (y recomendado): **NO** — `publicQuote`
  read-only, la frescura la da el job + catalog-sync (1.1/1.2). Esto **cierra BE-16** y el punto v1.3-1. Confirmar
  (si el humano quiere on-demand para un set recién salido aún no sincronizado, se acotaría al flujo **autenticado**
  `createRequest`, nunca al quote anónimo).
- **v1.12-4 (operativo, devops) — API key / plan de pokemontcg.io.** El refresco 2×/día del catálogo completo
  **requiere `POKEMONTCG_IO_API_KEY`** para la cuota (~20k req/día); sin key el free tier puede toparse. Confirmar que
  la key está aprovisionada en staging/prod. El plan de pago **no** es necesario para Fase 1 (el `PricingProvider`
  intercambiable permite subir después sin tocar el resto).

### Preguntas abiertas (v1.3 — Cotizador Opción 1)
> No bloquean el arranque del trabajo (backend puede implementar `GET /buylist/cards`, `GET /buylist/sets` y
> `POST /admin/catalog/sync-all` ya). El arquitecto **no asume** reglas de negocio (CLAUDE.md).
- **v1.3-1 — ¿pricing on-demand del cotizador para `ex_plus` fuera de bóveda?** Hoy una carta `ex_plus` del
  catálogo completo sin `PriceReference` sale `precio_pendiente` (coherente con PROJECT criterio 13). ¿El
  humano quiere que el cotizador dispare un **fetch puntual** al `PricingProvider` en el momento de cotizar
  (mejor UX, pero consume cuota del free tier fuera de la bóveda y puede tentar abuso del endpoint público)?
  **Default propuesto (MVP):** **no** priciar on-demand; mantener `precio_pendiente` + escalado al dueño.
  **RESUELTO por Fase 1 (v1.12-catalog-pricing, §4.13a/b):** el catálogo completo se precia durante el `catalog-sync`
  (1.1), así que el quote ya encuentra precio sin fetch on-demand; además `publicQuote` pasa a read-only (1.2). Se
  confirma el default "no on-demand". Ver pregunta v1.12-3.
- **v1.3-2 — Búsqueda pública sobre todo el catálogo: ¿rate-limit / anti-scraping?** `GET /buylist/cards` es
  público y consulta la tabla `Card` completa. Recomendación técnica (no de negocio): aplicar rate-limit por
  IP y `pageSize` acotado (≤100). Confirmar si se quiere además exigir sesión (`customer`) para reducir
  scraping del catálogo. **Default propuesto:** público con rate-limit; sin sesión obligatoria.

### Preguntas abiertas (v1.5-auth-email — verificación de correo + recuperación)
> No bloquean el arranque: backend puede implementar el módulo `mail`, el modelo `AuthToken` (M-17), los
> endpoints y el `EmailVerifiedGuard` con los defaults propuestos. El arquitecto **no asume** reglas de negocio.
- **v1.5-1 — ¿Exigir `RESEND_API_KEY` en staging (además de prod)?** Default propuesto: **sí** (staging es
  no-local → key dura, para probar el flujo real E2E; degradación Noop solo en LOCAL_ENVS). Confirmar.
- **v1.5-2 — Dominio remitente vs soporte. (CERRADA 2026-08-16)** El humano confirmó el dominio canónico único
  `tcgvaultmx.com`: `MAIL_FROM` = `no-reply@**tcgvaultmx.com**` y soporte de disputas = `soporte@**tcgvaultmx.com**`
  (**mismo dominio**, ya no hay inconsistencia). Pendiente operativo (no de arquitectura): verificar SPF/DKIM/DMARC
  en Resend para `tcgvaultmx.com` (nota devops).
- **v1.5-3 — ¿El reset exitoso marca `emailVerified=true`?** Default propuesto: **sí** (clic en el link de reset
  prueba control del inbox). Si el humano prefiere separar ambos conceptos, se deja `emailVerified` intacto en el
  reset. Confirmar.
- **v1.5-4 — Reenvío de verificación: ¿autenticado (recomendado) o público por email?** Default propuesto:
  **autenticado** (`customer+`, usa `req.user`) → cero enumeración. Alternativa (público `{ email }` + siempre
  `200`) añade superficie de abuso; no se adopta salvo que el humano lo pida.
- **v1.5-5 — ¿Gating adicional?** Hoy se bloquean solo las **mutaciones** de comprar/retirar/vender. ¿El humano
  quiere bloquear también algo más (p. ej. guardar CLABE/INE en KYC, o `request-invoice`)? Default: **no** — solo
  las tres acciones listadas; el resto queda navegable con banner. Confirmar si se amplía.
- **v1.5-6 — Cuentas de staff.** `vault_operator`/`super_admin` deben sembrarse `emailVerified=true` (no reciben
  correo de verificación al no registrarse por el flujo público). Nota para devops/seed; confirmar que el seed lo hace.

### Decisiones ya resueltas
Las 6 ambigüedades quedaron resueltas por el humano (2026-08-13) y se integran como decisiones firmes en este documento y en el contrato. Se conservan aquí como registro.

1. **Precio de venta = referencia del día + MARKUP configurable (dial M10).** El **valor de mercado** que se muestra es la **referencia** (`priceMxnCents` de `PriceReference`). El **precio de venta** es `round(referenciaMxn × (1 + salesMarkupPct/100))`. `salesMarkupPct` es un dial de M10 (`sales_markup_pct`). Se persiste como `InventoryItem.listPriceCents` al listar (o se calcula al vuelo si null) y se congela en `OrderItem.unitPriceCents` al checkout. En los DTOs se distingue `referenceValue` (valor de mercado) de `salePrice` (precio de venta). El override manual de precio puede fijar directamente el `listPriceCents` sin aplicar markup. **Actualización v1.13-sales-pricing (Fase 2, §4.14):** el **markup GLOBAL único** (`salesMarkupPct`) se **reemplaza** por una **tabla de regla por rareza** (`SALES_PRICE_RULES` + `SALES_PRICE_FALLBACK_PCT`): venta = piso `fixed` (MX$) o `market × (1 + pct/100)` (pct = markup ARRIBA de mercado). El markup global queda **deprecado** (palanca de rollback). El resto de esta decisión (referencia vs venta, congelar en `OrderItem.unitPriceCents`, override manual) **no cambia**.
2. **Fee de procesamiento Stripe = GROSS-UP.** El fee trasladado se calcula para que, tras la comisión de Stripe (tarifa MX **más el IVA que Stripe cobra sobre su comisión**), la plataforma reciba **íntegro** `subtotal + IVA`. Fórmula vigente (ver §5.1, refinada por el hallazgo C1): `total = (base + (1+stripeFeeIvaPct)·fija) / (1 − (1+stripeFeeIvaPct)·pct)`, `fee = total − base`, donde `base = subtotal + IVA`. Se persiste en `Order.processingFeeCents` y es una línea visible del `BreakdownDTO`. El fee **no** lleva IVA de **producto** adicional.
3. **IVA 16% sobre `subtotal + envío`.** El IVA grava el subtotal de cartas **y** la tarifa de envío (servicio gravado). El **fee de procesamiento va tal cual (sin IVA)**. Default a validar con contador. En compras de carrito el `ivaCents = round((subtotal) × ivaPct/100)`; en retiros `ivaCents = round(shippingFee × ivaPct/100)`.
4. **CFDI sin PAC en el MVP.** No se integra PAC ni se timbra en el MVP. El flujo de factura es **manual por correo**: la UI muestra la instrucción de que, para pedir factura, el cliente envíe un correo con sus datos fiscales. El sistema guarda el **IVA cobrado por orden** (M7) y un flag `invoiceRequested` (opcional) por orden. **Timbrado real = fase 2.** `CfdiStatus` se reduce a `registrado | no_aplica` en MVP (`emitido` queda reservado para fase 2).
5. **FX USD→MXN automático (Banxico) + colchón + override manual.** Job diario `fx-refresh` obtiene el tipo de cambio de una fuente tipo **Banxico** (SIE), aplica el **colchón** (`fx_buffer_pct`, dial M10) y escribe `FxRate` (`source=banxico`). Si el fetch falla o el admin fija un override, se usa `FxRate` con `source=manual` (dial M10) como fallback; el override tiene prioridad sobre el valor automático del mismo día.
6. **Cobro del envío por Stripe ANTES de generar la solicitud de retiro.** El retiro cobra la tarifa fija (+ IVA) vía `PaymentIntent` de Stripe; la `ShipmentRequest` se crea en `solicitado` con el `PaymentIntent` asociado y solo se procesa (picking) una vez liquidado (webhook `payment_intent.succeeded`). No hay wallet.

---

## 11. Migraciones requeridas (v1.1 + v1.2/v1.2.1 + v1.3.1 — 2026-08-16)

Cambios de esquema Prisma que backend debe migrar. Proyecto **greenfield sin backfill de datos** (aún no hay filas productivas); las migraciones solo redefinen esquema.

### v1.21-guest-checkout (nueva — WS «Órdenes y dinero»: comprar sin cuenta)

⚠️ **`backend/prisma/` es ZONA COMPARTIDA:** el orquestador serializa **M-25** frente a cualquier otro stream. Es la
migración **menos aditiva** de las recientes: incluye **dos `DROP NOT NULL`** (`Order.userId`,
`ShipmentRequest.userId`). Aun así es **compatible hacia atrás**: ninguna fila existente cambia de valor, los
defaults (`vault`, `0`) reproducen el comportamiento actual bit a bit, y los índices `@@index([userId])` **se
conservan** (un B-tree de Postgres indexa `NULL` y las consultas `where userId = X` lo siguen usando igual). Diff
campo por campo, con nota de compatibilidad por columna, en **API_CONTRACT §4-G.10**.

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-25 | `enum FulfillmentMode` | **Enum nuevo** (`vault \| direct_ship`) | Create enum | Destino del pedido. `vault` = comportamiento actual. |
| M-25 | `Order.userId` | `String` → **`String?`** (relación a opcional) | **Alter column (DROP NOT NULL)** | Un pedido de invitado no tiene `User`. **No relaja ninguna autorización**: la puerta sigue siendo `order.userId !== :sessionUser`, y `null` nunca iguala a un uuid. El **compilador** de TypeScript señalará cada punto que asumía no-nulo: backend debe resolverlos con decisión explícita, no con `!`. |
| M-25 | `Order.guestEmail String?` | **Columna nueva** (nullable) + `@@index([guestEmail])` | Add column + index | Correo del invitado, normalizado (trim+lowercase) por la aplicación. `guestEmail != null` ⇔ el pedido **nació** de invitado (inmutable, sobrevive al reclamo). |
| M-25 | `Order.fulfillmentMode` | **Columna nueva** `FulfillmentMode` **`@default(vault)`** | Add column | El default preserva el comportamiento existente sin backfill. |
| M-25 | `Order.shippingAddressSnapshot Json?` | **Columna nueva** (nullable) | Add column | Dirección capturada en línea (el invitado no tiene `Address`). Mismo criterio de *snapshot* que `ShipmentRequest.addressSnapshot`. |
| M-25 | `Order.shippingFeeCents Int @default(0)` | **Columna nueva** | Add column | Envío cobrado **dentro** de la orden. `0` en pedidos a bóveda ⇒ el P&L histórico no cambia. **Única** fuente del ingreso de envío de un pedido de invitado (§4.21b). |
| M-25 | `Order.orderNumber String? @unique` | **Columna nueva** + **secuencia** `order_number_seq` + **backfill** | Add column + create sequence + data | Número legible `TCG-000123` (criterios 45/49/53/56b). Mismo patrón que `inventory_folio_seq`/`PrismaService.nextFolio`. Nullable solo para permitir el backfill; la aplicación lo escribe siempre. Greenfield ⇒ backfill trivial por `createdAt`. |
| M-25 | `Order.claimedAt DateTime?` | **Columna nueva** (nullable) | Add column | Momento del reclamo. Con `guestEmail != null`: `null` ⇒ reclamable. |
| M-25 | `Order.locale Locale?` | **Columna nueva** (nullable) | Add column | Idioma del correo del invitado (no hay `User.locale`). Resolución `order.locale ?? user.locale ?? 'es'`. |
| M-25 | `Order.paymentMethodBrand String?`, `Order.paymentMethodLast4 String?` | **2 columnas nuevas** (nullable) | Add column | Capturadas del `charge` al liquidar. **Solo** marca + 4 últimos dígitos (permitido por PCI-DSS); jamás PAN/BIN/titular. Alimentan la vista pública. |
| M-25 | `ShipmentRequest.userId` | `String` → **`String?`** | **Alter column (DROP NOT NULL)** | `null` **solo** en el envío directo creado por el servidor. Riesgo #1 de la migración: `GET /shipments[...]` debe filtrar por `userId = :sessionUser` de forma **positiva** (caso negativo obligatorio de QA). |
| M-25 | `ShipmentRequest.orderId String?` + FK a `Order` + `@@index([orderId])` | **Columna + índice nuevos** | Add column + FK + index | **Discriminador**: `null` ⇒ retiro de bóveda (todo lo existente); poblado ⇒ envío directo que fulfilla ese pedido. **No `@unique`** (deja abierta la re-expedición sin migrar); invariante de aplicación: a lo más un envío **activo** por orden. |
| M-25 | `OrderAccessToken` | **Modelo nuevo** (`id` uuid `@id`, `orderId` + FK `onDelete: Cascade`, `tokenHash String @unique`, `expiresAt DateTime`, `revokedAt DateTime?`, `lastUsedAt DateTime?`, `useCount Int @default(0)`, `requestIp String?`, `createdAt`; `@@index([orderId])`, `@@index([expiresAt])`) | Create table | Enlace de seguimiento. **Solo** el SHA-256 del claro. **Multi-uso**: `revokedAt` (revocable) en vez de `usedAt` (consumible) — es la única diferencia semántica con `AuthToken`, y la razón de no reusar ese modelo (su `userId` es obligatorio y su `consume()` es de un solo uso). |

> **`CHECK` en SQL crudo dentro de la migración** (Prisma no los expresa; son baratos y atrapan bugs de
> aplicación): `userId IS NOT NULL OR guestEmail IS NOT NULL`; `guestEmail IS NOT NULL ⇒ fulfillmentMode='direct_ship'`;
> `fulfillmentMode='direct_ship' ⇒ shippingAddressSnapshot IS NOT NULL`; `claimedAt IS NOT NULL ⇒ userId IS NOT NULL`.

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| **M-25b** | `InventoryItem` — `CHECK (ownerType <> 'customer' OR ownerUserId IS NOT NULL)` | **Constraint nuevo** (SQL crudo) | Add check constraint | **v1.21.2 (D6) — pasa de "recomendado" a NORMATIVO.** Es el invariante que §4-G.0-1 declara literalmente «lo que hace segura la nulabilidad de `Order.userId`», y era el **único** de los cinco que no se implementó. Sin él, un bug futuro que escriba `ownerType='customer'` con `ownerUserId=null` produce una pieza en el limbo: no sale en la bóveda de nadie (todas las consultas filtran por `ownerUserId`), no es vendible (`ownerType≠platform`) y no es ajustable en M1 — una carta desaparecida en silencio. Es una **tabla de otro work stream**: el orquestador serializa. **Precondición de despliegue:** `SELECT count(*) FROM "InventoryItem" WHERE "ownerType"='customer' AND "ownerUserId" IS NULL` debe dar **0** (debe darlo: hoy nada escribe esa combinación); si no, se corrige el dato **antes** de añadir el constraint. |
> **Enums:** ninguno más — `InventoryStatus` **NO** crece (`picking|shipped|delivered` ya existen sin uso, §4.21c) y
> `ShipmentStatus` tampoco. **Config/diales:** **ninguno** — los cinco parámetros del guest checkout son
> **constantes de servidor** (`GUEST_TRACKING_TTL_DAYS=90`, `GUEST_TRACKING_MAX_AGE_DAYS=365`,
> `GUEST_RESEND_MAX_PER_DAY=5`, `GUEST_MAX_ITEMS=20`, `GUEST_ORDER_RESERVATION_TTL_MIN=60`), mismo precedente que
> las ventanas 7d/30d del buylist (v1.18); promoverlas a M10 después es no-breaking. La tarifa de envío reusa el
> dial existente `SHIPPING_FEE_CENTS`. **Sin variables de entorno nuevas** (el enlace se arma con `APP_BASE_URL`).

### v1.20-master-set-everywhere (nueva — WS «Inventario y vault»: master set en todas partes)

**Aditiva, una sola migración `M-24`** (ajustes de inventario). Las tres vistas por scope, los campos de variante y
`GET /admin/vaults` son **solo código** (reusan `InventoryItem`, `Card.availableFinishes`, `PriceReference`,
el índice M-21 y `getReferencesBatch`) — **sin** cambio de esquema. **Sin backfill.**

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-24 | `enum AdjustmentReason` | **Enum nuevo** (`encontrada \| perdida \| danada \| error_captura`) | Create enum | Motivo OBLIGATORIO del ajuste por levantamiento físico (§4.20e). |
| M-24 | `enum MovementReason` | **Valor nuevo** `adjustment` | Alter enum (aditivo) | El historial de la pieza distingue un ajuste de operador (`adjustment`) de un `mark` normal (`lost`/`damaged`) o un retiro (`withdrawal`). Aditivo; nada existente cambia. |
| M-24 | `InventoryAdjustment` | **Modelo nuevo** (`id` uuid `@id`, `inventoryItemId String` + FK a `InventoryItem`, `reason AdjustmentReason`, `fromStatus InventoryStatus?`, `toStatus InventoryStatus`, `actorUserId String?` sin FK dura (patrón `AuditLog`), `note String?`, `createdAt`; `@@index([inventoryItemId])`, `@@index([reason])`, `@@index([createdAt])`) | Create table | Registro **tipado y consultable** del levantamiento (reportes de merma M7/M9); complementa —no reemplaza— `InventoryMovement` y `AuditLog` (§4.20e). Para `encontrada` con `qty>1` se crea **una fila por pieza creada**. |

> **NO se añade** valor nuevo a `InventoryStatus`: `error_captura` reusa `withdrawn` (decisión §4.20e — el enum de
> status es zona transversal; la distinción vive en `InventoryAdjustment.reason`). **Config/diales:** ninguno.

### v1.19-sealed-tcgcsv (nueva — WS «Catálogo y precios»: referencia de mercado del sellado vía TCGCSV)

⚠️ **`backend/prisma/` es ZONA COMPARTIDA:** el orquestador serializa esta migración frente a cualquier otro stream que
toque el schema. Es **aditiva y nullable** (sin backfill: los items sellados existentes quedan sin mapeo hasta que el
admin los cure). **`PriceReference` NO se toca** (soporta sellado tal cual: `productType='sealed'` ya en el enum,
`gradeKey` String libre — nuevo esquema `sealed:tcg:<productId>` —, `finish` default `normal`, unique existente). Ver
§4.19c/d.

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-23 | `enum PriceSource` **+= `tcgcsv`** | Valor de enum nuevo | Alter enum (add value) | Fuente de la referencia de sellado en `PriceReference.source` (y en `PriceInfo.source` del contrato). En Postgres, `ALTER TYPE ... ADD VALUE` — aditivo, sin reescritura de filas. |
| M-23 | `InventoryItem.tcgplayerProductId Int?` | **Columna nueva** (nullable) | Add column | Mapeo curado item sellado ↔ `productId` de TCGplayer/TCGCSV. Solo aplica a `productType='sealed'` (regla de aplicación, no constraint de BD). `null` = no mapeado (cola derivada de curación, §4.19c). |
| M-23 | `InventoryItem.tcgplayerGroupId Int?` | **Columna nueva** (nullable) | Add column | Grupo TCGCSV del producto (el endpoint de precios es **por grupo**). Se fija **junto** con `tcgplayerProductId`; ambos `null` o ambos poblados (invariante de aplicación). |
| M-23 | `InventoryItem` `@@index([tcgplayerProductId])` | **Índice nuevo** | Create index | Sirve la cola de no-mapeados (`sealed AND productId IS NULL`) y el `DISTINCT tcgplayerGroupId` del ingest sin barrer la tabla. |

> **Enum de contrato adicional:** `SealedPriceSource = tcgcsv | off` (valores del dial; NO es enum de BD — el dial es
> una `ConfigSetting` string validada). **Config/diales:** `sealed_price_source` (seed **`off`**, fail-closed §4.19e),
> sembrada por el seed de settings (dato, no esquema). **Sin backfill** de mapeos: la curación es manual post-deploy.

### v1.18-buylist-rejects (nueva — WS «Catálogo y precios»: rechazo de ítem de buylist)

⚠️ **`backend/prisma/` es ZONA COMPARTIDA:** el orquestador serializa esta migración frente a cualquier otro stream
que toque el schema. Es **aditiva y nullable** (sin backfill: los ítems rechazados pre-M-22 quedan con `rejectedAt`/
`rejectionReason` `null` y las proyecciones exponen los campos de rechazo en `null` — normado en API_CONTRACT §11).
Los plazos (`returnDeadlineAt`/`abandonDeadlineAt`) **NO son columnas** (derivados de `rejectedAt` + constantes
7d/30d, §4.18a).

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-22 | `SellRequestItem.rejectedAt DateTime?` | **Columna nueva** (nullable) | Add column | Timestamp de la decisión `reject` (= notificación al vendedor). **Ancla ÚNICA** de los plazos 7d (devolución a costo del usuario) y 30d (abandono). Imprescindible: el modelo no tiene ningún timestamp propio y `AuditLog` no es fuente válida de plazos (§4.18a). |
| M-22 | `SellRequestItem.rejectionReason String?` | **Columna nueva** (nullable) | Add column | Motivo del rechazo (obligatorio en el request con `decision:"reject"`, 3–500 chars). Alimenta el correo al vendedor, la pestaña «Rechazadas» y el detalle del propio cliente. |
| M-22 | `SellRequestItem` `@@index([itemStatus])` | **Índice nuevo** (recomendado) | Create index | Sirve `GET /admin/buylist/rejected-items` (filtro transversal por `itemStatus='rechazada'`) sin barrer la tabla. No bloqueante a volumen MVP, pero entra con la misma migración. |

> **Enum:** ninguno nuevo (`SellItemStatus.rechazada` ya existe; sin estados nuevos de ítem). **Config/diales:**
> ninguno; las ventanas 7/30 días son **constantes de servidor** compartidas con la familia `buylist-sweep`.

### v1.16-master-set (nueva — WS-E: Master Set + inventario a escala)

**Aditiva, una sola migración `M-21`.** Un índice compuesto (acelera las agregaciones del binder) + un modelo nuevo
(`InventoryBatch`) de idempotencia/auditoría del alta por lote. **Sin backfill.** No crea enums ni diales. **NO cambia
el modelo por-pieza** (`InventoryItem` sigue 1 fila por pieza). El resto de WS-E (§4.17) es **código**: agregaciones
raw/`groupBy`, orden natural de `number`, `PrismaService.nextFolios(n)`, `PricingService.getReferencesBatch`, pago
mínimo de BE-25, y los 4 endpoints M1.

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-21 | `InventoryItem` `@@index([cardId, finish, status])` | **Nuevo** índice compuesto | Create index | Sirve la agregación `countsByFinish` del binder (`GROUP BY cardId, finish` filtrando `status` on-hand) y el conteo por set. Complementa los `@@index([cardId])`/`@@index([status])` existentes (no los reemplaza). |
| M-21 | `InventoryBatch` | **Modelo nuevo** (`id`=`batchKey` `@id`, `actorUserId String?`, `kind String` (`create`\|`publish`), `requested Int`, `createdItems Int`, `failedLines Int`, `resultJson Json`, `createdAt`) | Create table | Idempotencia + auditoría del alta por lote: un replay del mismo `batchKey` devuelve `resultJson` sin re-crear. Es el registro de auditoría del lote (complementa `AuditLog`). Sin FK dura a `User` (auditoría, patrón `AuditLog`). |

> **Enum:** ninguno nuevo. **Config/diales:** ninguno en DB; el cap del lote (200) y `BUYLIST_QUOTE_BATCH_MAX`-style son
> **constantes de servidor** (decisión abierta WS-E-4 sobre si alguno debe ser dial M10).

### v1.14-price-ingest (nueva — WS-A: ingesta masiva vía proveedor de paga) — **SIN migración de esquema**

**No hay migración.** WS-A (§4.15) es 100% aditiva sobre modelos existentes: reusa `PriceReference` (con `finish` en su
clave desde M-18), el enum `PriceSource.pokemonpricetracker` (**ya presente**) y `Card.availableFinishes` (M-18). Los
cambios son de **código** (nueva interfaz `BulkPriceProvider` + adapters, `PriceIngestService`, jobs `price-ingest`/
`price-ingest-set`, generalizar `PricingService.persistMarketReference`, aligerar `catalog-sync` a metadata) y de **jobs/
scheduler** (devops repunta el slot 2×/día). El único dato nuevo es el dial `PRICE_PROVIDER` (`price_provider`), una fila
de `ConfigSetting` sembrada por el seed de settings (no de esquema). **Nota de escala (heredada de DEV-4):** el ingest
sigue creciendo `PriceReference` ~1 fila/día por (carta, acabado); la retención/particionado de la serie queda para
fase 2. **Nota de rollout money-safe:** primero desplegar el job robusto con `PRICE_PROVIDER=pokemontcg_io`, verificar el
esquema del proveedor de paga en la 1ª corrida (v1.14-1) y luego flip del dial (v1.14-4).

### v1.13-sales-pricing (nueva — Fase 2 del epic de precios) — **SIN migración de esquema**

**No hay migración.** Fase 2 (§4.14) es 100% aditiva: dos `ConfigSetting` nuevos (`sales_price_rules`,
`sales_price_fallback_pct`, sembrados por el seed de settings), una función pura en `money.ts`, endpoints M2 y editor
front. El precio de venta ya se **congela** en `OrderItem.unitPriceCents` al checkout, así que **no** se requiere
columna de snapshot (a diferencia de buylist M-14). `SALES_MARKUP_PCT` queda deprecado sin borrar (decisión abierta
v1.13-3). Backend siembra los dos nuevos settings vía el seed/migración de datos de `ConfigSetting` (no de esquema).

### v1.12-catalog-pricing (nueva — Fase 1 del epic de precios) — **SIN migración de esquema**

**No hay migración.** Fase 1 (§4.13) es 100% aditiva sobre modelos existentes: reusa `PriceReference` (que ya lleva
`finish` en su clave desde M-18) y `CardSet`/`Card`. Los cambios son de **lógica** (nueva escritura de
`PriceReference` en `upsertCards`, quitar `escalatePending` de `publicQuote`) y de **jobs/scheduler** (nuevo
`catalog-price-sync`, cableado por devops). No crea enums, tablas ni diales. **Nota de escala (no bloqueante):**
`PriceReference` pasa a crecer ~1 fila/día por (carta, acabado) del catálogo (~30–40k filas/día); considerar
retención/particionado de la serie en fase 2 (DEV-4, §9).

### v1.9-set-chart (nueva — gráfica pública del valor de un set)

**Aditiva, una sola migración `M-20`.** Un modelo nuevo (`SetValueSnapshot`) + una relación inversa en `CardSet`.
**Sin backfill:** la tabla arranca vacía y se puebla desde el primer día que corran los jobs (§4.12c). No toca
dinero (SEC-A1 intacto: el valor se deriva de `PriceReference`). No crea enums ni diales.

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-20 | `SetValueSnapshot` | **Modelo nuevo** (`id`, `setId` FK→`CardSet` `onDelete:Cascade`, `asOfDate @db.Date`, `totalValueMxnCents Int`, `pricedCardCount Int`, `totalCardCount Int`, `createdAt`, `updatedAt`, `@@unique([setId, asOfDate])`, `@@index([setId, asOfDate])`) | Create table | Serie diaria del valor de mercado agregado por set (gráfica pública del hero). Escrito por jobs `set-price-sync` + `set-value-snapshot`. Idempotente por día (upsert). Ver §3.2, §4.12. |
| M-20 | `CardSet.snapshots` | **Nuevo** lado inverso `SetValueSnapshot[]` | Relación (sin columna en `CardSet`) | Solo relación Prisma; no añade columna física a `CardSet`. |

> **Enum:** ninguno nuevo (no usa `Finish`; toma siempre `normal` como filtro en la query de valor). **Config/diales:** ninguno en DB; el set destacado se controla por **env `HOME_FEATURED_SET_ID`** (§4.12b, §8), no por `ConfigSetting`.

### v1.8-ronda-c (nueva — BE-10 + PendingPriceEntry.finish + SEC-D2)

**Aditiva, una sola migración `M-19`.** Dos columnas nuevas con default/nullable seguro; **BE-10 NO migra** (es
una proyección de respuesta, no una tabla). Sin backfill obligatorio (los defaults/fallbacks cubren filas legacy).

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-19 | `PendingPriceEntry.finish` | **Nuevo** `Finish @default(normal)` | Add column (default) | La cola de precio pendiente se dedupe/resuelve por acabado. Antes `(cardId, productType, gradeKey)` colapsaba acabados en una entrada; resolver `normal` cerraba `holofoil`. No hay índice único de BD en la cola (dedupe por `findFirst`), así que **solo** se añade la columna; `escalatePending`/`manualOverride` incorporan `finish` a sus `where`. Reusa el enum `Finish` de M-18. Filas legacy → `normal`. Ver §3.2, §4.2. |
| M-19 | `SellRequest.closedAt` | **Nuevo** `DateTime?` (nullable) | Add column (nullable) | SEC-D2: fecha de cierre real, seteada al entrar a estado terminal (`pagada`/`rechazada`/`abandonada`). El job `ine-retention` la usa para anclar la ventana de retención de INE (fallback a `max(...)` para filas legacy con `closedAt=null`). Campo interno de cumplimiento; no se expone en DTOs de cliente. Ver §3.2, §3.4(d). |
| M-19 | `AdminUserOwnedItemRef` (BE-10) | **NO migra** — proyección de `GET /admin/users/:id` | — | Se enriquece la **respuesta** (`+finish`, `+referenceValue: PriceInfo`) reusando `getReference` por-acabado. Sin cambio de esquema. Ver §4.7ter(c) y `API_CONTRACT §M6/§11`. |

> **Enum:** M-19 **reutiliza** `Finish` (creado en M-18); no crea enums ni tablas nuevas. **Config/diales:** ninguno.

### v1.6-finish (nueva — acabado / versión de carta)

**Aditiva.** Toda columna nueva trae **default seguro** (`normal` / `[normal]`), así que las filas ya
existentes quedan operables sin backfill manual. **Requiere RE-SYNC del catálogo tras desplegar** para poblar
`availableFinishes` y las `PriceReference` por acabado reales (los datos ya importados no traen finish hasta el
re-sync; hasta entonces todo se comporta como `normal`). El re-sync es idempotente (v1.3.1).

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-18 | Enum **`Finish = normal \| reverse_holo \| holofoil \| first_edition_holofoil`** | **Add enum** | Valores canónicos (§3.7). Cerrado a estos 4 por decisión del humano (mapeo de llaves de `tcgplayer.prices`); `1stEditionNormal`/`unlimited*` no se mapean en el MVP (pregunta abierta v1.4-1). |
| M-18 | `Card.availableFinishes` | **Nuevo** `Finish[] @default([normal])` | Add column (default) | Acabados en que existe la carta, derivados de `tcgplayer.prices` al importar. **NO** toca el `@unique` de `externalId` (sigue 1 fila por carta). Filas históricas → `[normal]`; re-sync repuebla. |
| M-18 | `PriceReference.finish` + `@@unique` | **Nuevo** `Finish @default(normal)`; unicidad pasa de `(cardId, productType, gradeKey, capturedDate)` a **`(cardId, productType, gradeKey, finish, capturedDate)`** | Add column (default) + alter unique | `finish` entra a la clave para que cada acabado tenga referencia propia. Filas existentes → `finish=normal` (siguen únicas bajo la nueva clave). `gradeKey` sin cambio de semántica. |
| M-18 | `InventoryItem.finish` | **Nuevo** `Finish @default(normal)` | Add column (default) | Acabado de la copia física; afecta valuación y "Compra". Se captura en M1; `graded`/`sealed` = `normal`. |
| M-18 | `SellRequestItem.finish` | **Nuevo** `Finish @default(normal)` | Add column (default) | Snapshot del acabado cotizado/solicitado; se propaga a `InventoryItem.finish` al convertir. |

> **Diales/config:** M-18 **no** requiere columnas de `ConfigSetting`. Reutiliza `BUYLIST_PRICE_RULES` /
> `BUYLIST_PRICE_FALLBACK_PCT` (v1.3.1); las claves sintéticas `"Reverse Holo"` (ya sembrada) y `"Holo"`
> (opcional, la añade el dueño en M2) son entradas de esa misma tabla. Ver §4.2.1.

### v1.5-auth-email (nueva — verificación de correo + recuperación self-service)

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-17 | **`AuthToken`** (modelo nuevo) + enum **`AuthTokenType = email_verification | password_reset`** | **Create table** + **add enum** | Create table / add enum | `AuthToken`: `id` (uuid), `userId` (FK `User`, `onDelete: Cascade`), `type` (`AuthTokenType`), `tokenHash` (`String @unique`, SHA-256 del token en claro — **nunca** el claro), `expiresAt` (`DateTime`), `usedAt` (`DateTime?`), `requestIp` (`String?`), `createdAt`. Índices `@@unique([tokenHash])`, `@@index([userId, type])`, `@@index([expiresAt])`. Un solo uso; expira 24h (verificación) / 1h (reset). Ver §3.2, §4.11. `User` gana la relación `authTokens AuthToken[]`. Greenfield: sin backfill. **No** cambia `User.emailVerified` (ya existe, M-6) ni `tokenVersion` (ya existe, M-15). |

### v1.4-finance (nueva — costo real de paquetería en el P&L)

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-16 | `ShipmentRequest.shippingCostCents` | **Nuevo** `Int @default(0)` (costo real MXN que la plataforma paga al carrier) | Add column (con default 0) | Aditivo; **NO** toca `shippingFeeCents` (ingreso). Se captura en M4 al asignar carrier/guía (`POST /admin/shipments/:id/tracking`), opcional y editable, validación de app **entero ≥ 0**. El `@default(0)` cubre filas históricas/sin captura para no romper el P&L (§M7). Greenfield: sin backfill. |

### v1.3.1 (nuevas — precio de buylist por rareza)

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-14 | `SellRequestItem`: `rarity` `String?`, `ruleMode` `BuylistRuleMode?`, `ruleValue` `Int?`, `ruleSource` `String?`; enum nuevo **`BuylistRuleMode = fixed | pct`** | **Añadir** columnas + enum; **deprecar** `SellRequestItem.category` (pasa a **nullable**, ya no se escribe) | Add column / add enum / alter column nullable | Snapshot de la regla aplicada por rareza (§3.2, §4.2). `BuylistCategory` se conserva en el schema por retención legacy pero queda deprecado; nada nuevo lo usa. Greenfield: sin backfill. Los diales `buylist_price_rules` / `buylist_price_fallback_pct` son `ConfigSetting` (no requieren columna dedicada). |
| M-15 | `User`: `deletedAt` `DateTime?`, `anonymizedAt` `DateTime?`, `mustChangePassword` `Boolean @default(false)`, `tokenVersion` `Int @default(0)`; enum **`UserStatus`** gana valor **`deleted`** | **Añadir** columnas + valor de enum | Add column / alter enum | Gestión de usuarios M6 (§4.7bis): reset de contraseña por admin (revoca tokens vía `tokenVersion`, opcional `mustChangePassword`) y borrado híbrido hard/soft (soft ⇒ `status=deleted` + anonimización PII). El JWT debe incluir `tokenVersion` y el guard rechazar versiones desactualizadas. Greenfield: sin backfill. |

### v1.2 / v1.2.1 (nuevas)

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-12 | `InventoryItem.certNumber` | **Nuevo** `String?` (nº de certificado PSA/CGC) | Add column | Solo para `productType=graded`; **requerido a nivel de aplicación para publicar** una gradeada (validación de servicio, no NOT NULL en BD porque raw/sealed lo dejan null). Sin validación automática contra la graduadora. |
| M-13 | `InventoryItem.frontPhotoKey` / `backPhotoKey` / `extraPhotoKeys`; `SellRequestItem.photoKeys`; `Dispute.ingressPhotoKeys` / `claimPhotoKeys` | **Eliminar** (producto sin fotos propias; disputa por correo) | Drop column | Greenfield: sin datos que migrar. La imagen del producto pasa a ser siempre la de catálogo remota. Si backend prefiere conservarlas nullable-sin-uso en v1, se documenta como deuda menor en `TECH_DEBT.md`; la decisión de arquitectura es **eliminarlas**. |
| M-10 (rev) | `Dispute.type` | Se **conserva** `condition_raw | condition_sealed` (v1.1 M-10). Sin cambio adicional en v1.2. | — | La distinción raw/sellado sigue; lo que cambia es que la evidencia va **por correo**, no por foto. |

> **INE (KYC) — SIN migración (v1.2.1):** `KycProfile.ineFrontKey`/`ineBackKey`, cifrado PII (`*Enc`/`*Hmac`),
> retención `INE_RETENTION_DAYS` y `reveal-clabe` **permanecen intactos** (§3.4). La v1.2.1 no toca el esquema
> de INE/CLABE respecto a v1.1.

### v1.1 (previas)

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-1 | `RawCondition` (enum) | `NM \| LP \| MP \| HP \| DMG` → **`NM`** (único valor) | Redefinir enum Postgres | Greenfield: sin filas que backfillear. Si en el futuro hubiera filas ≠ NM, requeriría estrategia de mapeo; hoy no aplica. |
| M-2 | `InventoryItem.sealedSubtype` | **Nuevo** enum opcional `box\|etb\|bundle\|tin\|blister`, nullable | Add column | Solo para `productType=sealed`. |
| M-3 | `User.passwordHash` | pasa a **nullable** | Alter column | Null para cuentas solo-Google. |
| M-4 | `User.authProvider` | **Nuevo** enum `local\|google` default `local` | Add column + enum | |
| M-5 | `User.googleId` | **Nuevo** `String? @unique` | Add column + unique index | |
| M-6 | `User.emailVerified` | **Nuevo** `Boolean @default(false)` | Add column | |
| M-7 | `User.avatarUrl` | **Nuevo** `String?` | Add column | |
| M-8 | `PortfolioSnapshot` | **Modelo nuevo** (`userId, asOfDate @db.Date, totalValueMxnCents, costBasisMxnCents?, pendingPriceCount`, `@@unique([userId, asOfDate])`, `@@index([userId, asOfDate])`) | Create table | Escrito por job `portfolio-snapshot` (BE-5). |
| M-9 | `ConfigSetting` seed | **Nuevo dial** `catalog_sync_from_date` = `"2024/01/01"` | Seed/insert | Default de `POST /admin/catalog/sync`. |
| M-10 | `Dispute.type` | Generalizar más allá de `condition_raw` para admitir **disputa de sellado** (caja dañada/equivocada) | Alter enum (add value, p. ej. `condition_sealed`) | La evidencia canónica del sellado es la foto de la caja al ingreso. |
| M-11 | `Card.rarity` | **Sin cambio** — permanece `String` libre (taxonomía abierta pokemontcg.io) | — | Se documenta explícitamente para que no se convierta en enum. |

Ninguna otra tabla cambia. Los índices existentes se conservan.

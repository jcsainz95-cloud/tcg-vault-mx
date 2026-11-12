# API_CONTRACT_PROVEEDORES.md — anexo de API_CONTRACT.md (portal de proveedores, §PROV)

Convenciones de `API_CONTRACT.md` §0 (`/api/v1`, centavos MXN enteros, errores `{error:{code,message,details}}`, paginación `{data,page,pageSize,total}`, `Idempotency-Key` en POST de dinero). ESTADO: **F1 completo (sentido A)**; sentido B y F3+ propuestos.
Nombres de ruta F1 ya fijados con backend: no renombrar.

## 0. Reglas transversales
- **Rol** `supplier` se añade a `enum Role` (migración aditiva). Auth/JWT idénticos al resto (`Authorization: Bearer`).
- **Login**: el mismo `POST /auth/login` `{email,password}` ⇒ respuesta de siempre con `user.role:"supplier"` (+ `user.supplierName`, `mustChangePassword`). Front redirige `supplier` a `/proveedores` (admin/staff nunca). Refresh/logout/forgot-password funcionan igual; sin Google ni registro; cambio de contraseña por `/supplier/me/password`.
- **Contraseña**: `mustChangePassword:true` (cuenta recién reseteada) ⇒ el login responde igual con sesión restringida y el front lleva a `/proveedores/cambiar-contrasena`; mientras tanto solo se permite `POST /supplier/me/password`. **`POST /supplier/me/password`** · supplier `{currentPassword, newPassword}` ⇒ 204, limpia `mustChangePassword`, invalida otros refresh tokens; errores 401 `INVALID_CREDENTIALS`, 400 `WEAK_PASSWORD`. `/auth/change-password` sigue siendo de `customer`/staff (a `supplier` le da 403). `forgot-password`/`reset-password` (por correo) sí aplican al proveedor activo; a uno suspendido no le envían correo y el token no sirve.
- **Panel general de usuarios** (`/admin/users*`, reset de contraseña, listados): EXCLUYE `role=supplier` (no aparecen; por id ⇒ 404). Proveedores solo se gestionan en `/admin/suppliers`.
- **Suspensión** (`status=suspended`): se rechazan con 403 `SUPPLIER_SUSPENDED` el login, `refresh`, `accept-invite`, `reset-password`, Google (el rol `supplier` no admite Google: 403) y `GET /supplier/me`; al suspender se invalidan sus refresh tokens, sus invitaciones abiertas y sus ofertas `open`. Reactivar no revive invitaciones: se reinvita.
- **Rutas `@Public`** (p. ej. `/catalog/*`, `/buylist/*`) responden al supplier como a un anónimo: no 403. **Prohibido al rol `supplier`** (403 `FORBIDDEN_ROLE`, default-deny) en rutas que exigen sesión: todo lo que no sea `/supplier/*`, `/auth/login|refresh|logout|forgot-password|reset-password`. En particular catálogo con sesión (`/catalog/cards`), carrito, checkout, pedidos, bóveda, wishlist, buylist, `/users/*`, `/admin/*`.
- **Aislamiento**: `supplierId` sale del token; ajeno o inexistente ⇒ 404 `NOT_FOUND` (nunca 403, no revela existencia). El proveedor nunca recibe `pctBps`, `marketCents`, mercado, otras tiendas ni clientes.
- **Carta embebida** (`card`, igual en todos los GET): `{cardId, name, nameEs|null, number, setId, setName, imageUrl|null, rarity|null, finish}`. `imageUrl` = la del catálogo (pokemontcg.io); null ⇒ placeholder.
- **Estados de carta** (`condition`, lo que declara la tienda): `NM|LP|MP|HP|DMG`. Inventario hoy solo admite NM (`RawCondition`): lo que se verifica como `ok` entra como NM.

## 1. Alta, sesión y perfil
- POST `/admin/suppliers/invite` · admin — `{businessName, email, phone?}` ⇒ 201 `{supplier:{id,businessName,email,status:"invited"}, inviteExpiresAt}`. Correo con enlace `/proveedores/activar?token=…` (token aleatorio, solo se guarda hash, un uso, 72 h). Reinvitar mismo correo antes de activar: rota token (200). Errores: 409 `EMAIL_TAKEN` (correo de otro usuario), 400 `VALIDATION_ERROR`.
- POST `/auth/supplier/accept-invite` · público, throttle — `{token, password}` (política de contraseña del sitio) ⇒ 200 `{user:{…role:"supplier"}, accessToken, refreshToken}` (queda con sesión; `status` pasa a `active`). Errores: 400 `INVITE_INVALID` (no existe/usado), 410 `INVITE_EXPIRED`, 400 `WEAK_PASSWORD`.
- POST `/supplier/me/password` · supplier — ver §0 «Contraseña».
- GET `/supplier/me` · supplier — `{id, businessName, email, phone|null, status}`.
- GET `/admin/suppliers` · staff — `?q&status=invited|active|suspended&page` ⇒ `{data:[{id,businessName,email,phone,status,createdAt,activatedAt|null,openOffers:int}],…}`.
- PATCH `/admin/suppliers/:id` · admin — `{status?: "active"|"suspended", businessName?, phone?, resetPassword?: true}` ⇒ el proveedor. `resetPassword` envía enlace nuevo (misma mecánica de token 72 h). Errores: 404, 409 `INVALID_STATE` (p. ej. activar uno `invited`: se activa solo al aceptar).

## 2. Solicitudes (dueño)
- **Buscador de carta (B2):** `GET /catalog/cards` NO sirve (solo cartas con stock≥1). Se usa **`GET /buylist/cards?q=&setId=&rarity=&page=&pageSize=`** (público, ya existente, `catalog.searchAllCards`): busca en TODA la tabla `Card` por nombre o número (contiene, sin mayúsculas), orden normativo, paginado `{data,page,pageSize,total}`. El formulario usa de cada fila: `id` (=`cardId`), `name`, `number`, `setId`, set (nombre), `rarity`, imagen. No se crea endpoint nuevo. Los acabados válidos y el mercado salen de **GET `/admin/supply-requests/market-check?cardId=&finish=`** · staff (NUEVO) ⇒ `{cardId,finish,marketCents:int|null,hasMarket:bool,capCents:int|null,defaultPctBps:7000,suggestedUnitCents:int|null}`. `hasMarket:false` ⇒ el formulario exige `fixedUnitCents`.
- POST `/admin/supply-requests` · admin — `{cardId, finish, minCondition:"NM"|…, qty:int≥1, pctBps?:1..10000 (omitido ⇒ defaultPctBps), fixedUnitCents?:int, expiresAt? (default +14 d)}`. Con mercado: precio = `pctBps` × mercado, redondeo al peso hacia abajo; `fixedUnitCents` opcional lo reemplaza. Sin mercado: `fixedUnitCents` obligatorio y `pctBps` se ignora. ⇒ 201 solicitud (ver abajo). Errores: 404 `CARD_NOT_FOUND`, 400 `FINISH_NOT_AVAILABLE`, 422 `ABOVE_MARKET_CAP` (precio efectivo > mercado), 422 `FIXED_PRICE_REQUIRED` (sin mercado y sin `fixedUnitCents`), 400 `VALIDATION_ERROR`.
- PATCH `/admin/supply-requests/:id` · admin — `{status?:"closed", qtyWanted?:int, pctBps?, fixedUnitCents?, expiresAt?}` (al menos uno). Cerrar: ofertas `open|countered` pasan a `expired` (el proveedor las ve «solicitud cerrada»); acuerdos ya hechos no cambian. `qtyWanted` ≥ `qtyReserved`. Cambiar precio no toca acuerdos ni ofertas ya aceptadas; ofertas abiertas al precio viejo se recalculan al responder. Solicitud `filled`, `closed` o `expired` ⇒ cualquier PATCH da 409 `INVALID_STATE` (confirmado; para más cantidad se crea otra). Errores: 404, 409 `INVALID_STATE`, 422 `QTY_BELOW_RESERVED`, 422 `ABOVE_MARKET_CAP`, 422 `NO_MARKET` (cambiar `pctBps` sin mercado).
- GET `/admin/supply-requests` · staff — `?status=open|filled|closed|expired&q&page` ⇒ `data:[SupplyRequestAdmin]`; GET `/admin/supply-requests/:id` ⇒ lo mismo + `offers:[SupplyOfferAdmin]` (mejor oferta primero).
- **SupplyRequestAdmin** `{id, card, minCondition, qtyWanted, qtyReserved, qtyReceived, qtyOpen, pctBps|null, unitCents, fixedPrice:bool, marketCents|null, capCents|null, aboveCap:bool, status, source:"manual"|"suggested", expiresAt, createdAt, offersCount, bestOfferUnitCents|null}`. `aboveCap:true` cuando el mercado bajó y `unitCents` > mercado hoy: la UI muestra aviso rojo y el servidor rechaza aceptar ofertas hasta bajar el precio (422 `ABOVE_MARKET_CAP`).

## 3. Ofertas
- GET `/supplier/requests` · supplier — `?q&page` solo `open` con `qtyOpen>0` y no vencidas ⇒ `data:[{id, card, minCondition, qtyOpen, unitCents, expiresAt, myOfferStatus|null}]` (**solo pesos por pieza**; sin %, sin mercado). GET `/supplier/requests/:id` ⇒ el mismo objeto. 404 si cerrada/vencida y sin oferta suya.
- POST `/supplier/requests/:id/offers` · supplier · Idempotency-Key — `{qty:int≥1, condition, unitCents?}`. Omitido o igual a `unitCents` de la solicitud ⇒ oferta a precio fijo (se acepta sola solo si `supply_auto_accept` encendido; si no, queda `open`). Distinto ⇒ contraoferta (F3: en F1 `unitCents` distinto ⇒ 422 `COUNTER_NOT_ENABLED`). ⇒ 201 `SupplyOfferSupplier`. Errores: 404, 409 `REQUEST_NOT_OPEN`, 410 `REQUEST_EXPIRED`, 409 `ALREADY_OFFERED` (una oferta abierta por solicitud y tienda), 422 `QTY_EXCEEDS_OPEN` (`details.qtyOpen`), 422 `CONDITION_BELOW_MIN`, 409 `COVERED` (ya se cubrió).
- GET `/supplier/offers` · supplier — `?status&page` ⇒ `data:[SupplyOfferSupplier]`; GET `/supplier/offers/:id` ⇒ + `events:[{at,actor:"supplier"|"owner",action,unitCents,qty}]`.
- **SupplyOfferSupplier** `{id, requestId, card, qty, condition, unitCents, totalCents, status:"open"|"countered"|"accepted"|"rejected"|"withdrawn"|"expired", counterUnitCents|null, expiresAt, purchaseId|null, createdAt}`.
- POST `/supplier/offers/:id/respond` · supplier — `{action:"withdraw"}` en F1 (`accept|counter` sobre contraoferta del dueño: F3). Errores: 404, 409 `INVALID_STATE` (ya aceptada/cerrada), 410 `OFFER_EXPIRED`.
- GET `/admin/supply-offers?status&requestId&supplierId&page` · staff ⇒ `data:[SupplyOfferAdmin]`.
- **SupplyOfferAdmin** `{id, requestId, supplier:{id,businessName}, card, qty, condition, unitCents, totalCents, pctOfMarketBps|null, marketCents|null, aboveCap:bool, status, expiresAt, createdAt, isBest:bool}`.
- POST `/admin/supply-offers/:id/respond` · admin — F1: `{action:"accept"|"reject"}`; F3 añade `counter` con `unitCents|pctBps`. TOPE DURO: precio efectivo > 100 % del mercado ⇒ 422 `ABOVE_MARKET_CAP` para todos los roles, sin bandera de excepción; sin mercado solo vale `fixedUnitCents` de la solicitud (contraoferta ⇒ 422 `NO_MARKET`). Aceptar: transacción que reserva cantidad ⇒ 200 `{offer, purchase:SupplyPurchase}`. Errores: 404, 409 `INVALID_STATE`, 410 `OFFER_EXPIRED`, 409 `COVERED` (`details.qtyOpen`), 422 `ABOVE_MARKET_CAP`, 422 `NO_MARKET`.

## 4. Acuerdos, recogida, revisión y pago
- **SupplyPurchase** (admin) `{id, offerId, supplier:{id,businessName}, card, qty, agreedUnitCents, totalCents, status:"agreed"|"collected"|"verified"|"paid"|"cancelled", pickupDueAt, units:[{n,condition,result:"pending"|"ok"|"adjusted"|"returned",adjustBps|null,unitPayableCents|null,note|null}], payableCents|null, method|null, reference|null, paidAt|null, createdAt}`. Versión proveedor (`GET /supplier/purchases[/:id]`) idéntica sin `units.adjustBps`, con `units.result` y `unitPayableCents`: solo pesos, solo lectura.
- GET `/admin/supply-purchases?status&supplierId&page` · staff; GET `/admin/supply-purchases/:id` · staff.
- POST `/admin/supply-purchases/:id/receive` · staff · Idempotency-Key — `{units:[{n:int, condition:"NM"|"LP"|"MP"|"HP"|"DMG", note?}]}` (una fila por pieza entregada; `units.length` ≤ `qty`; faltantes ⇒ quedan sin fila y no se pagan). Solo registra lo observado; no mueve dinero ni inventario. ⇒ 200 purchase (`status:"collected"`, `units[].result:"pending"`). Errores: 404, 409 `INVALID_STATE` (solo desde `agreed`), 422 `UNITS_EXCEED_QTY`, 410 `PURCHASE_EXPIRED` (pasó `pickupDueAt` y el job ya canceló).
- POST `/admin/supply-purchases/:id/verify` · staff · Idempotency-Key — `{units:[{n, result:"ok"|"adjusted"|"returned", adjustBps?:1..9999, note?}]}` debe cubrir todas las piezas recibidas. Servidor: `ok` ⇒ paga `agreedUnitCents` y la pieza entra a inventario como NM con costo; `adjusted` (solo si recibida NM con detalle menor; `adjustBps` obligatorio, nunca sube) ⇒ paga `floor(agreed × adjustBps/10000)` y entra como NM con ese costo; `returned` (LP o peor, o el dueño no la quiere) ⇒ no se paga ni entra, se devuelve a la tienda. Si todas las piezas son `returned` o no llegó ninguna ⇒ `payableCents=0`, status `cancelled` con `reason:"all_returned"|"none_received"`: sin pago ni inventario, se libera `qtyReserved` (la solicitud vuelve a `open` si no vencía) y `/pay` da 422 `NOTHING_TO_PAY`. **`payableCents` = suma calculada por el servidor** (el cliente no lo envía). ⇒ 200 purchase (`status:"verified"`, `payableCents`, `units[].unitPayableCents`, `inventoryItemIds:[…]`). Reparte `qtyReceived` de la solicitud. Errores: 404, 409 `INVALID_STATE` (solo desde `collected`), 422 `UNITS_MISMATCH`, 422 `ADJUST_REQUIRED`, 422 `OK_NOT_NM` (pieza recibida LP+ no puede ser `ok`).
- POST `/admin/supply-purchases/:id/pay` · admin 💰 · Idempotency-Key — `{method:"cash"|"transfer", reference?:string≤80}` ⇒ 200 purchase (`status:"paid"`, `paidAt`). Mismo key o ya pagado con mismo método ⇒ 200 igual (idempotente); otro método ⇒ 409. Errores: 404, 409 `INVALID_STATE` (solo desde `verified`), 409 `ALREADY_PAID_DIFFERENT`, 422 `NOTHING_TO_PAY`.

## 5. Sugeridas y ajustes
- GET `/admin/supply-suggestions` · staff ⇒ `data:[{id, card, finish, suggestedQty, pctBps:7000, unitCents, marketCents, reason:"rotation", createdAt}]`; POST `/admin/supply-suggestions/:id/publish` · admin `{qty?, pctBps?}` ⇒ SupplyRequestAdmin (mismos errores que crear). Job `supply-suggest` diario las genera siempre como borrador; con `autoPublish` encendido se publican solas con `weeklyBudgetCents`.
- GET/PATCH `/admin/supply-settings` · admin — `{autoPublish:false, autoAccept:false, defaultPctBps:7000, weeklyBudgetCents}`. Interruptores APAGADOS al arrancar.

## 6. Jobs (sin endpoint)
`supply-expiry` (horario, idempotente): vence solicitudes (14 d), ofertas sin respuesta (72 h), cancela acuerdos sin recoger (7 d) y libera `qtyReserved`. `supply-digest` (diario 09:00 CDMX): resumen a proveedores y dueño.

## 7. Tabla de errores por endpoint (códigos nuevos; el resto: 400 `VALIDATION_ERROR`, 401, 403 `FORBIDDEN_ROLE`, 429)
| Endpoint | Códigos |
|---|---|
| invite | 409 EMAIL_TAKEN |
| accept-invite | 400 INVITE_INVALID, 410 INVITE_EXPIRED, 400 WEAK_PASSWORD |
| login supplier | 403 SUPPLIER_SUSPENDED, 401 de siempre |
| PATCH supplier | 404 NOT_FOUND, 409 INVALID_STATE |
| POST request | 404 CARD_NOT_FOUND, 400 FINISH_NOT_AVAILABLE, 422 ABOVE_MARKET_CAP, 422 FIXED_PRICE_REQUIRED |
| PATCH request | 404, 409 INVALID_STATE, 422 QTY_BELOW_RESERVED / ABOVE_MARKET_CAP / NO_MARKET |
| POST offer | 404, 409 REQUEST_NOT_OPEN / ALREADY_OFFERED / COVERED, 410 REQUEST_EXPIRED, 422 QTY_EXCEEDS_OPEN / CONDITION_BELOW_MIN / COUNTER_NOT_ENABLED |
| supplier respond | 404, 409 INVALID_STATE, 410 OFFER_EXPIRED |
| admin respond | 404, 409 INVALID_STATE / COVERED, 410 OFFER_EXPIRED, 422 ABOVE_MARKET_CAP / NO_MARKET |
| receive | 404, 409 INVALID_STATE, 410 PURCHASE_EXPIRED, 422 UNITS_EXCEED_QTY |
| verify | 404, 409 INVALID_STATE, 422 UNITS_MISMATCH / ADJUST_REQUIRED / OK_NOT_NM |
| pay | 404, 409 INVALID_STATE (no está en `verified`) / ALREADY_PAID_DIFFERENT (ya pagado con otro método o referencia; es el 409 del doble pago, mismo método+key ⇒ 200 idempotente), 422 NOTHING_TO_PAY |
| password | 401 INVALID_CREDENTIALS, 400 WEAK_PASSWORD |
| cualquier ruta supplier | 403 SUPPLIER_SUSPENDED |
Todos los `GET /supplier/*` de un recurso ajeno ⇒ 404 `NOT_FOUND`.

## 8. Tienda privada de mayoreo (sentido B, F2; PROPUESTO)
- GET `/supplier/shop` · supplier — listings activos con `unitCents` (su precio), `minQty` (sellado: 1 case), stock asignado
- POST `/supplier/shop/orders` · supplier · Idempotency-Key — `{items:[{listingId,qty}], delivery: pickup|owner_delivery}`; reserva stock en la misma transacción; plazo de pago 72 h
- GET `/supplier/shop/orders` · GET `/supplier/shop/orders/:id` · supplier — solo los suyos
- POST `/supplier/shop/orders/:id/cancel` · supplier — solo antes de pagado
- GET `/supplier/notifications` · POST `/supplier/notifications/read` · supplier — campana
- POST/PATCH `/admin/wholesale/listings` · admin — `{productRef, wholesaleCents, minQty, qtyAllocated, urgent?}`; asigna stock fuera del público
- PUT `/admin/wholesale/listings/:id/prices/:supplierId` · admin — precio especial por tienda
- GET `/admin/wholesale/orders` · staff; POST `/admin/wholesale/orders/:id/mark-paid` · admin 💰 (idempotente); POST `/admin/wholesale/orders/:id/deliver` · admin (baja inventario)

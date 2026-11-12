# API_CONTRACT_PROVEEDORES.md — anexo de API_CONTRACT.md (portal de proveedores, §PROV)

Convenciones de `API_CONTRACT.md` §0 (prefijo `/api/v1`, centavos enteros, `Idempotency-Key` en POST de dinero). ESTADO: PROPUESTO (no construido).
Aislamiento: en rutas `/supplier/*` el `supplierId` sale SIEMPRE del token, nunca de la ruta ni del cuerpo; ajeno ⇒ 404. El rol `supplier` recibe 403 en cualquier ruta que no sea `/supplier/*` y `/auth/*`.

## Proveedor (rol `supplier`)
- POST `/auth/supplier/accept-invite` · público con token de invitación (fija contraseña; no hay registro abierto)
- GET `/supplier/requests` · supplier — solicitudes abiertas: carta, acabado, estado mínimo, cantidad restante, `unitCents` que se le paga (sin % ni mercado), vence
- GET `/supplier/requests/:id` · supplier
- POST `/supplier/requests/:id/offers` · supplier — `{qty, condition, unitCents?}` (omitido ⇒ precio de la solicitud; distinto ⇒ contraoferta)
- GET `/supplier/offers` · supplier — solo las suyas
- GET `/supplier/offers/:id` · supplier — con historial de negociación
- POST `/supplier/offers/:id/respond` · supplier — `{action: accept|counter|withdraw, unitCents?}` sobre contraoferta del dueño
- GET `/supplier/purchases` · supplier — acuerdos, recogida, pago (solo lectura)

## Dueño / staff
- POST `/admin/suppliers/invite` · admin — `{businessName, email}` ⇒ correo con enlace de un solo uso (72 h)
- GET `/admin/suppliers` · staff; PATCH `/admin/suppliers/:id` · admin (activar/suspender, reset de contraseña)
- POST `/admin/supply-requests` · admin — `{cardId, finish, minCondition, qty, pctBps, expiresAt?}`; PATCH `/:id` (ajustar % o cantidad, cerrar)
- GET `/admin/supply-requests` · staff (incluye ofertas por solicitud, mejor oferta resaltada)
- POST `/admin/supply-offers/:id/respond` · admin — `{action: accept|reject|counter, unitCents? | pctBps?}`; aceptar sobre 100 % del mercado exige `confirmAboveMarket:true`
- POST `/admin/supply-purchases/:id/receive` · staff — registra recogida en persona y estado real por carta
- POST `/admin/supply-purchases/:id/verify` · staff — confirma estado, calcula `payableCents`, crea `InventoryItem`
- POST `/admin/supply-purchases/:id/pay` · admin 💰 — `{method: cash|transfer, reference?}`, idempotente; solo tras `verify`
- GET `/admin/supply-purchases` · staff
- GET `/admin/supply-suggestions` · staff — lista «qué comprar» convertida en borradores de solicitud (HECHOS.md:57)

## Tienda privada de mayoreo (sentido B)
- GET `/supplier/shop` · supplier — listings activos con `unitCents` (su precio), `minQty`, stock asignado
- POST `/supplier/shop/orders` · supplier · Idempotency-Key — `{items:[{listingId,qty}], delivery: pickup|owner_delivery}`; reserva stock en la misma transacción; plazo de pago 72 h
- GET `/supplier/shop/orders` · GET `/supplier/shop/orders/:id` · supplier — solo los suyos
- POST `/supplier/shop/orders/:id/cancel` · supplier — solo antes de pagado
- GET `/supplier/notifications` · POST `/supplier/notifications/read` · supplier — campana en su cuenta
- POST/PATCH `/admin/wholesale/listings` · admin — `{productRef, wholesaleCents, minQty, qtyAllocated, urgent?}`; asigna stock fuera del público
- PUT `/admin/wholesale/listings/:id/prices/:supplierId` · admin — precio especial por tienda
- GET `/admin/wholesale/orders` · staff; POST `/admin/wholesale/orders/:id/mark-paid` · admin 💰 (idempotente) ; POST `/admin/wholesale/orders/:id/deliver` · admin (baja inventario)

## Jobs (sin endpoint)
`supply-expiry` (cada hora): vence solicitudes, ofertas sin respuesta y acuerdos sin recoger, y libera cantidad. `supply-digest` (diario 09:00 CDMX): resumen a proveedores y al dueño.

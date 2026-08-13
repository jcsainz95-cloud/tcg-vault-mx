# API_CONTRACT.md — Marketplace TCG con Bóveda (Pokémon, México)

> Propiedad: **arquitecto**. **Fuente de verdad** de la interfaz backend↔frontend.
> Manda `PROJECT.md` sobre este contrato, y este contrato sobre el código.
> Versión de API: **v1**. Prefijo: `/api/v1`. Formato: **REST/JSON**. Fecha: 2026-08-13.

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
- **Idempotencia:** endpoints de pago aceptan header `Idempotency-Key`.
- **PII sensible (CLABE / RFC / INE):** por **defecto se devuelven ENMASCARADOS** en **todas** las respuestas (cliente y back-office, incluido `super_admin`). Formato: CLABE → `****1234` (últimos 4 dígitos), RFC → parcial (ej. `XAX**********`). La **CLABE en claro (18 dígitos) SOLO** se obtiene por el endpoint dedicado `GET /admin/buylist/:id/reveal-clabe` (`super_admin`, money-out, **auditado**). Estos campos viven **cifrados en reposo** (ver ARCHITECTURE §3.4); el contrato nunca expone RFC/CLABE/INE en claro fuera del reveal.

### Enums (fuente de verdad)
```
Role                = customer | vault_operator | super_admin
Locale              = es | en
ProductType         = graded | sealed | raw
RawCondition        = NM | LP | MP | HP | DMG
GradingCompany      = PSA | CGC
OwnerType           = platform | customer
OwnershipStatus     = pending | settled
InventoryStatus     = in_stock | listed | reserved | in_custody | picking | shipped | delivered | lost | damaged | withdrawn
VaultZone           = platform_stock | customer_custody
OrderStatus         = pending | settled | failed | refunded | chargeback
ShipmentStatus      = solicitado | picking | guia | enviado | entregado | cancelado
SellRequestStatus   = cotizada | recibida | verificacion | aprobada | pagada | rechazada | abandonada
SellItemStatus      = cotizada | precio_pendiente | recibida | verificacion | aprobada | ajustada | rechazada | pagada | convertida_inventario
BuylistCategory     = comun | reverse_holo | ex_plus
DisputeStatus       = abierta | en_revision | resuelta_recompra | rechazada
PriceSource         = pokemontcg_io | pokemonpricetracker | poketrace | manual
KycStatus           = none | pending | verified | rejected
AcquisitionType     = aportacion_en_especie | buylist | compra
CfdiStatus          = registrado | no_aplica          // MVP sin PAC; "emitido" reservado para fase 2
PriceSource         = pokemontcg_io | pokemonpricetracker | poketrace | manual   // fuentes de precio de carta
FxSource            = banxico | manual                // fuente del tipo de cambio (separado de PriceSource)
```

### DTOs base (compartidos)
```ts
Money        = { amountCents: number, currency: "MXN" }
// PriceInfo describe el VALOR DE REFERENCIA (valor de mercado), no el precio de venta.
PriceInfo    = { status: "priced" | "pending", referenceMxnCents?: number, source?: PriceSource, capturedDate?: string }
CardDTO      = { id, externalId, name, number, rarity, supertype, subtypes: string[],
                 setId, setName, imageSmallUrl, imageLargeUrl }
// referenceValue = valor de mercado (referencia). salePriceCents = precio de venta = referencia × (1+markup) u override.
ListingDTO   = { inventoryItemId, card: CardDTO, productType, rawCondition?, gradingCompany?, gradeValue?,
                 referenceValue: PriceInfo, salePriceCents?: number, sellable: boolean,
                 frontPhotoUrl?, backPhotoUrl? }
// Desglose del checkout. base = subtotal + iva se recibe íntegro; el fee es gross-up de la comisión Stripe (SIN IVA).
// ivaCents grava subtotal (compras) o envío (retiros). totalCents = subtotal + ivaCents + processingFeeCents.
BreakdownDTO = { subtotalCents, ivaCents, ivaRatePct, processingFeeCents, totalCents, currency: "MXN" }
```

---

## 1. Auth y usuarios

### POST /api/v1/auth/register — `public`
Req: `{ email, password, name, phone, locale? }`
Res `201`: `{ user: { id, email, name, role, locale }, accessToken, refreshToken }`
Err: `409 EMAIL_TAKEN`, `400 VALIDATION_ERROR`.

### POST /api/v1/auth/login — `public`
Req: `{ email, password }` → Res `200`: `{ user, accessToken, refreshToken }`. Err: `401 INVALID_CREDENTIALS`, `403 USER_BLOCKED`.

### POST /api/v1/auth/refresh — `public` (con refresh token)
Req: `{ refreshToken }` → Res `200`: `{ accessToken, refreshToken }`. Err: `401`.

### POST /api/v1/auth/logout — `customer+`
Res `204`.

### GET /api/v1/users/me — `customer+`
Res `200`: `{ id, email, name, phone, role, locale, kycStatus, status }`.

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
- `GET /api/v1/users/me/kyc` — `customer` → `{ kycStatus, clabeMasked?, ineOnFile: boolean, capPerRequestCents, capPerMonthCents, monthUsedCents }`. La CLABE se devuelve **enmascarada** (`clabeMasked` = `****1234`); nunca en claro por este endpoint.
- `PUT /api/v1/users/me/kyc` — `customer` — Req: `{ clabe?, ineFrontUploadKey?, ineBackUploadKey? }` (keys de presign). La CLABE se recibe en claro (18 dígitos), se **cifra en reposo** y debe ser **a nombre del propio usuario** (declarado). Err `422 CLABE_INVALID`.

---

## 2. Catálogo y precios

### GET /api/v1/catalog/cards — `public`
Storefront: lista **listings vendibles** (items en bóveda de la plataforma). Solo cartas con precio o marcadas claramente; las "precio pendiente" pueden mostrarse pero **no comprables**.
Query: `?q=&setId=&rarity=&productType=&condition=&minPriceCents=&maxPriceCents=&page=&pageSize=&sort=`
Res `200`: `{ data: ListingDTO[], page, pageSize, total }`.

### GET /api/v1/catalog/cards/:cardId — `public`
Res `200`: `{ card: CardDTO, listings: ListingDTO[] }` (varias instancias físicas de la misma carta con distinta condición/grado/precio).

### GET /api/v1/catalog/listings/:inventoryItemId — `public`
Res `200`: `ListingDTO`. Err `404`.

### GET /api/v1/catalog/sets — `public`
Res `200`: `{ data: [{ id, name, series, releaseDate }] }` (datos en inglés).

**Nota de precio pendiente:** un `ListingDTO` con `referenceValue.status="pending"` (y sin `salePriceCents` por override) tiene `sellable=false`. Intentar comprarlo devuelve `422 PRICE_PENDING`. El `salePriceCents` visible al cliente es el precio de venta (referencia × (1+markup) u override); `referenceValue` es el valor de mercado informativo.

---

## 3. Bóveda y portafolio (comprador)

### GET /api/v1/vault/holdings — `customer`
Res `200`:
```json
{
  "data": [{
    "inventoryItemId": "…", "folio": "INV-000123", "card": { "…": "CardDTO" },
    "productType": "raw", "rawCondition": "NM",
    "ownershipStatus": "settled", "status": "in_custody",
    "referenceValue": { "status": "priced", "referenceMxnCents": 12500, "capturedDate": "2026-08-13" }
  }],
  "portfolio": { "totalValueMxnCents": 543200, "pendingPriceCount": 2, "currency": "MXN" }
}
```
El valor del portafolio se calcula contra el **valor de referencia** (no el precio de venta). Las cartas `referenceValue.status="pending"` se **excluyen** del total y se reportan en `pendingPriceCount` (no rompen el cálculo).

### GET /api/v1/vault/holdings/:inventoryItemId — `customer`
Res `200`: holding detallado (incluye fotos de ingreso, movimientos visibles al dueño). Err `403` si no es del usuario.

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
Err: `422 PRICE_PENDING`, `409 ITEM_UNAVAILABLE`. (No aplica `BILLING_PROFILE_REQUIRED` en el MVP: el billing profile no es obligatorio.)
Notas: `breakdown` incluye **IVA 16% desglosado** (sobre el subtotal de cartas) y **línea de fee de procesamiento por gross-up** (para que la plataforma reciba íntegro `subtotal+IVA` tras la comisión Stripe; el fee **no** lleva IVA). `totalCents = subtotalCents + ivaCents + processingFeeCents` (ver ARCHITECTURE §5.1).

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
Cobra la tarifa (envío + IVA + fee gross-up) por **Stripe ANTES** de crear la solicitud; solo items `settled`. La `ShipmentRequest` nace en `solicitado` con el `PaymentIntent` asociado y **solo avanza a `picking` una vez liquidado** (webhook `payment_intent.succeeded`). No hay wallet.
Req: `{ inventoryItemIds: string[], addressId: string }` + `Idempotency-Key`
Res `201`: `{ shipmentId, status: "solicitado", breakdown: { "…": "BreakdownDTO" }, stripe: { paymentIntentId, clientSecret } }`
Err: `422 ITEM_NOT_SETTLED` (incluye algún item `pending`), `422 ADDRESS_NOT_MX`, `409 ITEM_IN_ANOTHER_SHIPMENT`.

### GET /api/v1/shipments — `customer` → lista propia.
### GET /api/v1/shipments/:id — `customer` → detalle con `status`, `trackingNumber?`, `carrier?`, items.

---

## 6. Buylist (cotizador público + solicitudes)

### POST /api/v1/buylist/quote — `public`
Cotizador público (stateless). Muestra el mensaje de "pago tras recepción y verificación" (copy en frontend).
Req: `{ cardId: string, productType: ProductType, rawCondition?: RawCondition }`
Res `200`:
```json
{ "category": "ex_plus", "quote": { "status": "cotizada", "quotedPriceCents": 5000, "currency": "MXN" },
  "referencePrice": { "status": "priced", "priceMxnCents": 12500 },
  "paymentNotice": "PAY_AFTER_RECEIPT" }
```
Si es EX+ y no hay precio de referencia: `{ "quote": { "status": "precio_pendiente", "quotedPriceCents": null } }` (no se cotiza automáticamente; entra a cola al crear solicitud). Reglas: común `50`, reverse holo `150`, EX+ `= round(referencia × 0.40)`.

### POST /api/v1/buylist/requests — `customer`
Crea la solicitud; valida topes/KYC.
Req: `{ items: [{ cardId, productType, rawCondition?, category }], clabe: string, ineUploadKeys?: { front, back } }`
Res `201`: `{ sellRequestId, status: "cotizada", quotedTotalCents, ineRequired: boolean, items: SellItemDTO[] }`
Err:
- `422 BUYLIST_LIMIT_EXCEEDED` (details: `{ scope: "per_request" | "per_month", capCents, wouldBeCents }`)
- `422 INE_REQUIRED` (supera el tope configurado y no hay INE)
- `422 CLABE_NOT_OWN_NAME` (declaración/validación de CLABE a nombre propio)

### GET /api/v1/buylist/requests — `customer` → lista propia.
### GET /api/v1/buylist/requests/:id — `customer` → detalle con estados por item, ajustes propuestos, plazos.

### POST /api/v1/buylist/requests/:id/respond — `customer`
Responde a un ajuste del admin (aceptar/rechazar el ajuste). Req: `{ decision: "accept" | "decline" }`. Plazo: 7 días sin respuesta → `rechazada` (job).

---

## 7. Disputas de condición (raw)

### POST /api/v1/disputes — `customer`
Req: `{ inventoryItemId: string, description: string, claimPhotoUploadKeys: string[] }`
Res `201`: `{ disputeId, status: "abierta", deadlineAt }`
Err: `422 DISPUTE_WINDOW_CLOSED` (fuera de 7 días desde entrega), `422 NOT_RAW`, `403`.

### GET /api/v1/disputes — `customer` → lista propia.
### GET /api/v1/disputes/:id — `customer` → estado + resolución.

---

## 8. Uploads (fotos)

### POST /api/v1/uploads/presign — `customer+` (según contexto)
Req: `{ purpose: "kyc_ine" | "dispute_claim" | "inventory_photo", contentType: string }`
Res `200`: `{ uploadKey, uploadUrl, method: "PUT", headers: {}, expiresAt }`
El cliente hace `PUT` directo al object storage; luego envía `uploadKey` al endpoint correspondiente. Captura móvil vía navegador.

---

## 9. Webhooks Stripe

### POST /api/v1/webhooks/stripe — `public` (firma verificada)
Header: `Stripe-Signature` (validado con `STRIPE_WEBHOOK_SECRET`). Idempotente por `event.id`.
Eventos manejados:
- `payment_intent.succeeded` → Order `pending→settled`; items `ownershipStatus pending→settled`. (También liquida el pago de un envío.)
- `payment_intent.payment_failed` → Order `pending→failed`; libera reserva de items (`reserved→listed`).
- `charge.refunded` → Order `→refunded` (originado por reembolso de súper-admin en M3).
- `charge.dispute.created` → Order `→chargeback`; item revierte a inventario de plataforma (`ownerType=platform`, `ownershipStatus=null`, `status=listed`), movimiento `chargeback_return`.

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
  Req: `{ cardId, productType, rawCondition?, gradingCompany?, gradeValue?, locationId, frontPhotoKey, backPhotoKey, extraPhotoKeys?, acquisitionType, acquisitionPct?, sourceSellRequestItemId? }`
  Para `aportacion_en_especie`: el costo se calcula = **referencia del día × pct** (default 70, editable). El item nace `ownerType=platform`.
  Res `201`: `{ id, folio: "INV-000123", status: "in_stock", acquisitionCostCents }`
  Err `422 PRICE_PENDING` (si aportación en especie y no hay referencia → cola de precio pendiente).
- `GET /api/v1/admin/inventory/items` — query `?status=&cardId=&ownerType=&locationId=&zone=&q=&page=`
- `GET /api/v1/admin/inventory/items/:id` — detalle + historial de movimientos.
- `PATCH /api/v1/admin/inventory/items/:id` — editar (fotos, grado, listPrice manual, etc.).
- `POST /api/v1/admin/inventory/items/:id/move` — Req `{ toLocationId, note? }` → registra `InventoryMovement`.
- `POST /api/v1/admin/inventory/items/:id/mark` — Req `{ mark: "lost" | "damaged", note }` → `status` y movimiento; disponible para reposición (M7/tope M10).
- Ubicaciones: `GET /api/v1/admin/locations`, `POST /api/v1/admin/locations` (`{ zone, box, row, slot }`).

### M2 — Catálogo y precios (`super_admin`)
- `POST /api/v1/admin/pricing/sync` — dispara/encola el sync diario (solo bóveda). Req `{ scope?: "all_vault" | "cardIds" , cardIds?: [] }` → `{ jobId, queued: number }`.
- `GET /api/v1/admin/pricing/pending` — cola de precio pendiente. `{ data: PendingPriceEntry[] }`.
- `POST /api/v1/admin/pricing/override` — override manual (respaldo siempre disponible).
  Req: `{ cardId, productType, gradeKey, priceMxnCents }` → crea `PriceReference` `source=manual`, resuelve `PendingPriceEntry`.
- `GET /api/v1/admin/pricing/card/:cardId` — historial de precios por fecha/fuente.
- FX: `GET /api/v1/admin/fx` → `{ rate, bufferPct, source: FxSource, effectiveDate }` (automático diario desde **Banxico SIE** + colchón). `PUT /api/v1/admin/fx` — Req `{ rate, bufferPct }` → fija **override manual** (`source=manual`, prioridad sobre el automático del día). `POST /api/v1/admin/fx/refresh` — fuerza el fetch a Banxico.
- Tabla rareza→categoría: `GET /api/v1/admin/pricing/rarity-map`, `PUT /api/v1/admin/pricing/rarity-map` — Req `{ entries: [{ rarity, category }] }`.

### M3 — Ventas / órdenes (`vault_operator` lectura; `super_admin` reembolso)
- `GET /api/v1/admin/orders` — query `?status=&userId=&from=&to=&page=`
- `GET /api/v1/admin/orders/:id` — detalle con desglose + línea de Stripe + CFDI.
- `POST /api/v1/admin/orders/:id/refund` — **`super_admin`** — Req `{ reason }` + `Idempotency-Key` → reembolso Stripe, Order `→refunded`. Err `403 MONEY_OUT_FORBIDDEN` para operador.

### M4 — Retiros / envíos (`vault_operator+`)
- `GET /api/v1/admin/shipments` — cola. `?status=&page=`
- `GET /api/v1/admin/shipments/:id`
- `GET /api/v1/admin/shipments/picking-list` — **lista de picking ordenada por ubicación** (`?date=` opcional) → items con `folio` + `location.label`.
- `PATCH /api/v1/admin/shipments/:id/status` — Req `{ to: ShipmentStatus }` (transiciones `solicitado→picking→guia→enviado→entregado`).
- `POST /api/v1/admin/shipments/:id/tracking` — Req `{ carrier, trackingNumber }` → avanza a `guia`.

### M5 — Buylist (`vault_operator` hasta verificación; `super_admin` pago SPEI)
- `GET /api/v1/admin/buylist` — cola `?status=&page=`
- `GET /api/v1/admin/buylist/:id` — detalle con items y estados. La CLABE del vendedor se expone **enmascarada** como `clabeMasked` (`****1234`); **nunca** el snapshot cifrado ni la CLABE en claro. Para pagar, el súper-admin usa `reveal-clabe` (ver abajo).
- `GET /api/v1/admin/buylist/:id/reveal-clabe` — **`super_admin`** — **money-out, auditado**. Descifra y devuelve la **CLABE completa (18 dígitos)** para que el súper-admin la **copie a su banca al ejecutar el SPEI**. Es el **ÚNICO** punto del contrato que devuelve la CLABE en claro; cada llamada queda registrada en `AuditLog` (`action: buylist.reveal_clabe`, quién/cuándo/qué solicitud). Si el `clabeSnapshot` de la solicitud falta, **cae a la CLABE de KYC** del usuario.
  Res `200`: `{ sellRequestId, clabe }` (`clabe` = 18 dígitos en claro). Err `403 MONEY_OUT_FORBIDDEN` (operador/cliente), `404 NOT_FOUND`, `422 CLABE_UNAVAILABLE` (sin snapshot ni CLABE de KYC).
- `POST /api/v1/admin/buylist/:id/receive` — marca recepción física → `recibida`.
- `POST /api/v1/admin/buylist/:id/verify` — inicia/registra verificación → `verificacion`.
- `PATCH /api/v1/admin/buylist/items/:itemId/decision` — **cherry-pick** — Req `{ decision: "approve" | "adjust" | "reject", approvedPriceCents? }` → actualiza `SellItemStatus`. `adjust` fija `adjustmentSentAt` (dispara plazo de 7 días).
- `POST /api/v1/admin/buylist/items/:itemId/convert-to-inventory` — **un clic** → crea `InventoryItem` (`acquisitionType=buylist`), item `→convertida_inventario`.
- `POST /api/v1/admin/buylist/:id/pay-spei` — **`super_admin`** — Req `{ speiReference }` + `Idempotency-Key` → registra pago manual, request `→pagada`. Err `403 MONEY_OUT_FORBIDDEN`. Precondición: `aprobada` + verificada (pago **tras** recepción/verificación).

### M6 — Usuarios / KYC (`super_admin`; `vault_operator` lectura limitada)
- `GET /api/v1/admin/users` — `?q=&status=&page=`
- `GET /api/v1/admin/users/:id` — **ficha 360°** (compras, bóveda, buylist, disputas, KYC). La CLABE y el RFC se devuelven **enmascarados también para `super_admin`** (`clabeMasked` = `****1234`, `rfcMasked` = parcial); la CLABE en claro solo por `reveal-clabe`. Para `vault_operator` se mantiene la proyección reducida de SEC-A4 (sin CLABE/RFC/INE keys ni billing profile; `ineOnFile` booleano).
- `PATCH /api/v1/admin/users/:id/kyc` — **`super_admin`** — Req `{ kycStatus, capPerRequestCents?, capPerMonthCents? }`.
- `PATCH /api/v1/admin/users/:id/status` — **`super_admin`** — Req `{ status: "active" | "blocked" }`.

### M7 — Finanzas (`super_admin`)
- `GET /api/v1/admin/finance/pnl` — `?from=&to=` → `{ incomeCents, shippingCents, cogsCents, stripeFeesCents, profitCents }` (ingresos + envío − costo de lo vendido − comisiones Stripe = ganancia).
- `GET /api/v1/admin/finance/inventory-value` → `{ atReferenceCents, atCostCents, pendingPriceCount }`.
- `GET /api/v1/admin/finance/custody-value` → `{ totalCustodyValueCents }` (valor en custodia de clientes).
- `GET /api/v1/admin/finance/iva` — `?from=&to=` → `{ ivaCollectedCents, byOrder: [...] }` (para conciliación/CFDI).
- `GET /api/v1/admin/finance/export.csv` — `?report=pnl|iva|inventory&from=&to=` → CSV.

### M8 — Disputas (`vault_operator+`; recompra `super_admin`)
- `GET /api/v1/admin/disputes` — cola `?status=&page=`
- `GET /api/v1/admin/disputes/:id` — **comparador de fotos**: `{ ingressPhotoUrls, claimPhotoUrls, item, order }`.
- `POST /api/v1/admin/disputes/:id/resolve` — Req `{ resolution: "repurchase" | "reject", note }`. `repurchase` = **`super_admin`** (dinero saliente) → recompra al precio pagado (crea reembolso/pago), dispute `→resuelta_recompra`; item revierte a inventario. `reject` → `rechazada`.

### M9 — Reportes (`super_admin`)
- `GET /api/v1/admin/reports/launch-metrics` — `?from=&to=` → métricas de lanzamiento (usuarios activos, ventas settled, buylist pagadas, retiros sin disputa) vs metas N/X/Y/Z (cuando el humano las fije).
- `GET /api/v1/admin/reports/export.csv` — `?report=&from=&to=`.

### M10 — Config (diales) y bitácora (`super_admin`)
- `GET /api/v1/admin/settings` → todos los diales `{ shippingFeeCents, aportacionPct, ivaPct, salesMarkupPct, stripeFeePct, stripeFeeFixedCents, buylistCapPerRequestCents, buylistCapPerMonthCents, ineThresholdCents, repoCapPerCardCents, fxBufferPct, fxManualOverrideRate?, pricingProviderRaw, pricingProviderGraded, pricingProviderSealed }`.
- `PUT /api/v1/admin/settings` — Req parcial con las keys a actualizar; **sin redeploy**. Registra `AuditLog`. Err `422 VALIDATION_ERROR`.
- `GET /api/v1/admin/audit-log` — **bitácora global** `?actorUserId=&action=&entityType=&from=&to=&page=` → `{ data: AuditLogDTO[] }`.

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
SellItemDTO      = { id, card: CardDTO, productType, rawCondition?, category: BuylistCategory,
                     quotedPriceCents?, approvedPriceCents?, itemStatus: SellItemStatus, inventoryItemId? }
PendingPriceEntry= { id, cardId, productType, gradeKey, context, status: "open"|"resolved", createdAt }
AuditLogDTO      = { id, actorUserId, actorRole: Role, action, entityType, entityId, createdAt }
```

---

## 12. Notas de coherencia con PROJECT.md
- Precios de catálogo/ficha **sin IVA**. Se distingue **valor de referencia** (mercado, `referenceValue`) del **precio de venta** (`salePriceCents` = referencia × (1+`salesMarkupPct`) u override). IVA 16% y fee de procesamiento se agregan **en checkout** (`BreakdownDTO`).
- **Fee de procesamiento = gross-up** de la comisión Stripe (para recibir íntegro subtotal+IVA); **sin IVA sobre el fee**. IVA grava subtotal (compra) y tarifa de envío (retiro).
- **CFDI sin PAC en MVP**: factura por correo (`POST /orders/:id/request-invoice`); IVA cobrado registrado en M7. Timbrado real = fase 2.
- **FX automático (Banxico) + colchón + override manual** (M10); job diario `fx-refresh`.
- **Envío se cobra por Stripe ANTES** de crear la solicitud; avanza a picking solo tras `payment_intent.succeeded`.
- Carta "precio pendiente" → `sellable=false`, compra bloqueada con `PRICE_PENDING`; escalada al dueño vía `PendingPriceEntry`.
- Retiro solo sobre `settled` (`ITEM_NOT_SETTLED`); direcciones solo MX (`ADDRESS_NOT_MX`).
- Buylist: cotización por regla (común/reverse/EX+), topes y INE (`BUYLIST_LIMIT_EXCEEDED`, `INE_REQUIRED`), pago SPEI **solo súper-admin** tras recepción/verificación.
- Contracargo revierte item a inventario de plataforma (webhook `charge.dispute.created`).
- Los montos exactos de los diales (envío 17500, IVA 16, markup de venta, tarifa Stripe, tope 300000/1000000, aportación 70%) provienen de `ConfigSetting` (M10), no hardcode; los valores aquí son defaults.
```

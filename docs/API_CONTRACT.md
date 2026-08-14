# API_CONTRACT.md — Marketplace TCG con Bóveda (Pokémon, México)

> Propiedad: **arquitecto**. **Fuente de verdad** de la interfaz backend↔frontend.
> Manda `PROJECT.md` sobre este contrato, y este contrato sobre el código.
> Versión de API: **v1**. Prefijo: `/api/v1`. Formato: **REST/JSON**. Fecha: 2026-08-14 (rev v1.1).
>
> **Changelog v1.1 (2026-08-14):** `RawCondition` reducido a `NM` (migración); `GET /catalog/cards`
> devuelve solo inventario **publicado con precio** (nunca "precio pendiente" al comprador) + nuevo
> `GET /catalog/facets` (facetas dinámicas) y `GET /catalog/sets` con `year`; sellado como línea de venta
> (`sealedSubtype`, precio manual MXN); `POST /auth/google`; `GET /vault/portfolio/history`; endpoints admin
> de **sync de catálogo** (M2); AcquisitionPricer con rarezas modernas. Ver ARCHITECTURE §11 (migraciones).

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
RawCondition        = NM                                 // v1.1: ÚNICO valor (se eliminan LP|MP|HP|DMG). Migración.
SealedSubtype       = box | etb | bundle | tin | blister // v1.1: subtipo opcional del sellado
AuthProvider        = local | google                     // v1.1: proveedor de autenticación del User
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
// rawCondition solo aplica a productType=raw y su ÚNICO valor es "NM". El LABEL legible de NM
// ("Casi nueva (Near Mint)" / "Near Mint" + descripción) vive en i18n del FRONT, NO en la API.
// sealedSubtype solo aplica a productType=sealed (opcional). El sellado NO lleva rawCondition/grade/rareza.
ListingDTO   = { inventoryItemId, card: CardDTO, productType, rawCondition?, sealedSubtype?,
                 gradingCompany?, gradeValue?,
                 referenceValue: PriceInfo, salePriceCents?: number, sellable: boolean,
                 frontPhotoUrl?, backPhotoUrl? }
// Punto de la serie de tendencia del portafolio (gráfica estilo acciones). estimated? = punto de backfill indicativo.
PortfolioPointDTO = { date: string, valueMxnCents: number, costBasisMxnCents?: number, estimated?: boolean }
// Desglose del checkout. base = subtotal + iva se recibe íntegro; el fee es gross-up de la comisión Stripe.
// "SIN IVA" = el fee NO agrega una línea de IVA de PRODUCTO (no se vuelve a gravar la venta). Internamente
// el gross-up SÍ cubre el IVA que Stripe MX cobra sobre SU comisión (dial stripe_fee_iva_pct, ver ARCHITECTURE §5.1).
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
Nota: una cuenta creada solo con Google tiene `passwordHash=null`; este endpoint la rechaza con `401 INVALID_CREDENTIALS` (no revela que es cuenta Google) hasta que el usuario fije contraseña.

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
- `GET /api/v1/users/me/kyc` — `customer` → `{ kycStatus, clabeMasked?, ineOnFile: boolean, capPerRequestCents, capPerMonthCents, monthUsedCents }`. La CLABE se devuelve **enmascarada** (`clabeMasked` = `****1234`); nunca en claro por este endpoint.
- `PUT /api/v1/users/me/kyc` — `customer` — Req: `{ clabe?, ineFrontUploadKey?, ineBackUploadKey? }` (keys de presign). La CLABE se recibe en claro (18 dígitos), se **cifra en reposo** y debe ser **a nombre del propio usuario** (declarado). Err `422 CLABE_INVALID`.

---

## 2. Catálogo y precios

### GET /api/v1/catalog/cards — `public`  (sección "Compra")
Storefront **"Compra"**: lista **SOLO inventario publicado CON precio de venta fijado** (`status=listed`, `sellable=true`, `salePriceCents != null`). **Excluye** items `pending`/sin precio/"precio pendiente" — el comprador **nunca** ve "precio pendiente".
> **Cambio semántico v1.1:** en v1 podían mostrarse pendientes no comprables; en **v1.1 NO se listan**. La ruta **se mantiene** `/catalog/cards` (el rótulo de UI "Compra" lo controla el front); no se renombra para no romper el contrato (decisión en ARCHITECTURE §4.9).
Query: `?q=&setId=&rarity=&productType=&condition=&minPriceCents=&maxPriceCents=&sealedSubtype=&page=&pageSize=&sort=`
- `rarity`: valor **tal cual pokemontcg.io** (taxonomía abierta; usar los valores de `GET /catalog/facets`).
- `productType`: `raw | graded | sealed`. `condition`: para raw solo `NM`.
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
  "price": { "minCents": 5000, "maxCents": 4500000, "currency": "MXN" }
}
```
- `rarities`: `distinct` de `Card.rarity` sobre inventario publicado, **espejando pokemontcg.io tal cual** (lista **NO** cerrada).
- `sets`: `{ id, name, releaseDate, year }` con `year` **derivado** de `releaseDate`; solo sets con inventario publicado; **ordenados por año desc**.
- `productTypes` / `sealedSubtypes`: subconjuntos presentes en el inventario publicado.

### GET /api/v1/catalog/cards/:cardId — `public`
Res `200`: `{ card: CardDTO, listings: ListingDTO[] }` (instancias físicas publicadas de la misma carta; solo `sellable=true` con precio).

### GET /api/v1/catalog/listings/:inventoryItemId — `public`
Res `200`: `ListingDTO`. Err `404` (incluye el caso de un item no publicado / sin precio: no es visible en Compra).

### GET /api/v1/catalog/sets — `public`
Res `200`: `{ data: [{ id, name, series, releaseDate, year }] }` (datos en inglés; `year` derivado de `releaseDate`, v1.1). Devuelve los sets con inventario publicado, ordenados por año desc.

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
Reglas: común `50`, reverse holo `150`, **EX o superior** `= round(referencia × 0.40)`. La condición de compra es **siempre NM** (§ARCHITECTURE 3.5); `rawCondition` en el request solo puede ser `NM`.
**Rarezas modernas (v1.1):** cualquier rareza **por encima de común/reverse-holo** cae en `ex_plus` (Illustration Rare, Special Illustration Rare, Art Rare, Full Art, Alternate Art, Trainer Gallery, Character Rare, Radiant, EX/GX/V/VMAX/VSTAR, Secret/Rainbow, etc.). La derivación rareza→categoría usa la tabla `pricing/rarity-map`; **default `ex_plus`** para rarezas no listadas como común/reverse.
**Cuándo queda pendiente:** una `ex_plus` **se cotiza sola si HAY market price**; solo escala a `precio_pendiente` la que **realmente no tiene dato de mercado** (`{ "quote": { "status": "precio_pendiente", "quotedPriceCents": null } }`, entra a cola al crear la solicitud). Las tarifas planas (común/reverse) nunca dependen del market price y nunca quedan pendientes. El "precio pendiente" es de adquisición/back-office; **nunca** se muestra al comprador.

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
- `payment_intent.succeeded` → Order `pending→settled`; items `ownershipStatus pending→settled`. (También liquida el pago de un envío: `ShipmentRequest solicitado→picking`.)
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
  Req: `{ cardId, productType, rawCondition?, sealedSubtype?, gradingCompany?, gradeValue?, locationId, frontPhotoKey, backPhotoKey, extraPhotoKeys?, acquisitionType, acquisitionPct?, listPriceCents?, sourceSellRequestItemId? }`
  - `productType=raw` → `rawCondition` solo `NM` (v1.1). `productType=sealed` → `sealedSubtype?` (opcional), **sin** `rawCondition`/grade/rareza; `listPriceCents` (precio manual MXN) es **obligatorio para publicar** el sellado. `productType=graded` → `gradingCompany`+`gradeValue`.
  Para `aportacion_en_especie`: el costo se calcula = **referencia del día × pct** (default 70, editable). El item nace `ownerType=platform`.
  Res `201`: `{ id, folio: "INV-000123", status: "in_stock", acquisitionCostCents }`
  Err `422 PRICE_PENDING` (si aportación en especie y no hay referencia → cola de precio pendiente), `422 VALIDATION_ERROR` (p. ej. `sealed` con `rawCondition`, o `raw` con `rawCondition != NM`).
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

#### Sync de catálogo desde pokemontcg.io (`super_admin`, auditado) — v1.1
Ingesta de datos de catálogo (Card/CardSet en inglés). Ver ARCHITECTURE §4.8. Todas quedan en `AuditLog`.
- `GET /api/v1/admin/catalog/remote-sets` — consulta `/v2/sets` remoto.
  Res `200`: `{ data: [{ id, name, series, releaseDate, printedTotal, imported: boolean, cardCount: number }] }` ordenado por `releaseDate` **desc**. `imported` = si el `CardSet` ya existe local; `cardCount` = cartas locales del set.
- `POST /api/v1/admin/catalog/sync` — importa/actualiza cartas.
  Req: `{ setId?: string, fromReleaseDate?: string }`.
  - `setId` (opcional) → importa ese set puntual. **Debe cumplir `^[a-z0-9]+(-[a-z0-9]+)*$`** (anti-inyección en `q=set.id:`); si no, `422 VALIDATION_ERROR`.
  - sin `setId` → importa sets con `releaseDate >= fromReleaseDate`. **Default `fromReleaseDate` = dial `catalog_sync_from_date` (`"2024/01/01"`)**. Formato `yyyy/MM/dd`.
  Res `202`: `{ jobId, setsQueued: number, mode: "single" | "from_date" }`.
- `POST /api/v1/admin/catalog/backfill` — importa el **siguiente lote de sets más antiguos aún no importados** (colecciones previas a la frontera). Repetible.
  Req: `{ batchSize?: number = 10, untilYear?: number }`.
  Res `200`: `{ imported: [{ id, name, releaseDate, cardCount }], newBoundary: string, remaining: number }`. `newBoundary` = `releaseDate` del set más antiguo ya importado tras el lote; `remaining` = sets aún sin importar. Se repite hasta `remaining=0` (o hasta `untilYear`).
Notas de seguridad: **host fijo** de pokemontcg.io (sin SSRF); `POKEMONTCG_IO_API_KEY`; rate-limit vía cola BullMQ; `Card.rarity` se persiste como **String libre** (taxonomía abierta, captura rarezas modernas).

### M3 — Ventas / órdenes (`vault_operator` lectura; `super_admin` reembolso)
- `GET /api/v1/admin/orders` — query `?status=&userId=&from=&to=&page=`
- `GET /api/v1/admin/orders/:id` — detalle con desglose + línea de Stripe + CFDI. Incluye además **dos banderas operativas de back-office** (solo en este detalle admin, **no** en `OrderSummaryDTO` ni en el detalle del cliente): `chargebackNeedsManual: boolean` (un contracargo llegó cuando la carta **ya se había enviado**, hay que pelear la disputa con la guía; ver §9) y `disputeOutcome: "won" | "lost" | null` (resultado del cierre de la disputa Stripe). El enum `OrderStatus` **no cambia**: `won → settled`, `lost → chargeback`; estas banderas dan el matiz que el enum no expresa.
- `POST /api/v1/admin/orders/:id/refund` — **`super_admin`** — Req `{ reason }` + `Idempotency-Key` → reembolso Stripe, Order `→refunded`. Err `403 MONEY_OUT_FORBIDDEN` para operador. **Reembolso EXCEPCIONAL** (política VENTAS FINALES): no hay reembolso voluntario. La excepción legítima es un **error de la plataforma** (p. ej. cobro doble, inventario fantasma), que **siempre** se reembolsa. **NO** re-agrega el item al inventario. (La política de negocio completa vive en `PROJECT.md`.)

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
- `POST /api/v1/admin/disputes/:id/resolve` — Req `{ resolution: "repurchase" | "reject", note }`. `repurchase` = **`super_admin`** (dinero saliente) → **compensación por disputa: recompra al precio pagado** (crea el pago de recompra), dispute `→resuelta_recompra`. Política VENTAS FINALES: el **cliente conserva la carta** y la carta **NO** regresa al inventario (no se re-agrega item, no se crea `InventoryMovement`). `reject` → `rechazada`.

### M9 — Reportes (`super_admin`)
- `GET /api/v1/admin/reports/launch-metrics` — `?from=&to=` → métricas de lanzamiento (usuarios activos, ventas settled, buylist pagadas, retiros sin disputa) vs metas N/X/Y/Z (cuando el humano las fije).
- `GET /api/v1/admin/reports/export.csv` — `?report=&from=&to=`.

### M10 — Config (diales) y bitácora (`super_admin`)
- `GET /api/v1/admin/settings` → todos los diales `{ shippingFeeCents, aportacionPct, ivaPct, salesMarkupPct, stripeFeePct, stripeFeeFixedCents, stripeFeeIvaPct, buylistCapPerRequestCents, buylistCapPerMonthCents, ineThresholdCents, repoCapPerCardCents, fxBufferPct, fxManualOverrideRate?, pricingProviderRaw, pricingProviderGraded, pricingProviderSealed }`. `stripeFeeIvaPct` (fracción `[0,1)`, default **0.16**) = IVA que Stripe MX cobra **sobre su comisión**; entra en el gross-up del fee (ver ARCHITECTURE §5.1).
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
- **Fee de procesamiento = gross-up** de la comisión Stripe (para recibir íntegro subtotal+IVA); **sin IVA de producto sobre el fee** (el fee no vuelve a gravar la venta). Internamente el gross-up **sí** cubre el IVA que Stripe MX cobra sobre su comisión (dial `stripe_fee_iva_pct`, default 0.16). IVA de producto grava subtotal (compra) y tarifa de envío (retiro).
- **CFDI sin PAC en MVP**: factura por correo (`POST /orders/:id/request-invoice`); IVA cobrado registrado en M7. Timbrado real = fase 2.
- **FX automático (Banxico) + colchón + override manual** (M10); job diario `fx-refresh`.
- **Envío se cobra por Stripe ANTES** de crear la solicitud; avanza a picking solo tras `payment_intent.succeeded`.
- Carta "precio pendiente" → `sellable=false`, compra bloqueada con `PRICE_PENDING`; escalada al dueño vía `PendingPriceEntry`.
- Retiro solo sobre `settled` (`ITEM_NOT_SETTLED`); direcciones solo MX (`ADDRESS_NOT_MX`).
- Buylist: cotización por regla (común/reverse/EX+), topes y INE (`BUYLIST_LIMIT_EXCEEDED`, `INE_REQUIRED`), pago SPEI **solo súper-admin** tras recepción/verificación.
- Contracargo (webhook `charge.dispute.created`) es **consciente del estado físico**: revierte el item a inventario de plataforma **solo si sigue en bóveda**; si ya se envió/entregó **no** re-agrega y marca `chargebackNeedsManual` (ver §9). Cierre de disputa: ganamos→`settled` (`disputeOutcome=won`), perdemos→`chargeback` (`disputeOutcome=lost`).
- **VENTAS FINALES** (política del humano, ver `PROJECT.md`): no hay reembolso voluntario. Excepciones: (a) **error de la plataforma** (cobro doble/inventario fantasma) → **siempre** se reembolsa (§M3); (b) **disputa de condición** raw dañada/equivocada → el súper-admin compensa con **recompra al precio pagado**, el cliente **conserva la carta** y **no** vuelve al inventario (§M8). En ningún caso de reembolso/recompra el item se re-agrega al inventario.
- Los montos exactos de los diales (envío 17500, IVA 16, markup de venta, tarifa Stripe, tope 300000/1000000, aportación 70%) provienen de `ConfigSetting` (M10), no hardcode; los valores aquí son defaults.

**Coherencia v1.1 (2026-08-14):**
- **Raw solo NM:** `RawCondition=NM` (único valor); el filtro `condition` para raw solo admite `NM`. Labels legibles ("Casi nueva (Near Mint)" / "Near Mint") viven en i18n del **front**, no en la API. Migración: ARCHITECTURE §11 (M-1).
- **Compra = inventario publicado con precio:** `GET /catalog/cards` **excluye** pendientes/sin precio (el comprador nunca ve "precio pendiente"). Facetas dinámicas en `GET /catalog/facets`: `rarities` distinct de `Card.rarity` espejando pokemontcg.io (lista abierta), `sets` con `year` derivado, filtros por set/rareza/tipo/precio. La **ruta se mantiene** `/catalog/cards` (rótulo "Compra" en el front).
- **Sellado como línea de venta:** `productType=sealed`, `sealedSubtype?`, **precio manual MXN obligatorio para publicar**, sin condición/grade/rareza. Disputa de sellado = foto de la caja sellada al ingreso.
- **Login Google:** `POST /auth/google` (mismo shape que `/login`); verificación server-side del ID token; `role` server-side (nunca del token); account-linking por email verificado; **no exime KYC**. Campos nuevos en `User` (migración M-3..M-7). Env `GOOGLE_CLIENT_ID` / `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.
- **Gráfica de portafolio:** `GET /vault/portfolio/history?range=...` sobre `PortfolioSnapshot` (modelo nuevo, migración M-8), escrito por job diario (BE-5). Backfill indicativo opcional marcado `estimated`.
- **Sync de catálogo M2:** `GET /admin/catalog/remote-sets`, `POST /admin/catalog/sync`, `POST /admin/catalog/backfill` (`super_admin`, auditado). Guardarraíl `setId` `^[a-z0-9]+(-[a-z0-9]+)*$`, host fijo (anti-SSRF), `Card.rarity` String libre.
- **AcquisitionPricer:** rarezas modernas → `ex_plus` (40% de referencia) si hay market price; solo lo sin dato de mercado escala a `precio_pendiente` (lado adquisición/admin). Condición siempre NM.
```

# API_CONTRACT.md — Marketplace TCG con Bóveda (Pokémon, México)

> Propiedad: **arquitecto**. **Fuente de verdad** de la interfaz backend↔frontend.
> Manda `PROJECT.md` sobre este contrato, y este contrato sobre el código.
> Versión de API: **v1**. Prefijo: `/api/v1`. Formato: **REST/JSON**. Fecha: 2026-08-14 (rev v1.2.1).
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
BuylistRuleMode     = fixed | pct                       // v1.3.1: naturaleza de la regla de precio por rareza (fixed = MX$ centavos; pct = % de la referencia)
BuylistCategory     = comun | reverse_holo | ex_plus    // DEPRECADO v1.3.1: reemplazado por la tabla de regla por rareza (BuylistRuleMode). Retención legacy; nada nuevo lo usa.
DisputeStatus       = abierta | en_revision | resuelta_recompra | rechazada
PriceSource         = pokemontcg_io | pokemonpricetracker | poketrace | manual
KycStatus           = none | pending | verified | rejected
UserStatus          = active | blocked | deleted        // v1.3.1: `deleted` = cuenta soft-deleted/anonimizada (no puede iniciar sesión). `PATCH .../status` sigue aceptando solo active|blocked; `deleted` lo fija DELETE /admin/users/:id.
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
// IMAGEN (v1.2): el producto NO lleva fotos propias. La imagen mostrada en ficha/Compra/bóveda/back-office
// es SIEMPRE la imagen de catálogo remota de pokemontcg.io (CardDTO.imageSmallUrl / imageLargeUrl).
// No existen frontPhotoUrl/backPhotoUrl en ListingDTO ni en ningún DTO de producto.
// GRADEADAS (v1.2): graded expone gradingCompany + gradeValue + certNumber (nº de certificado PSA/CGC,
// verificable en la web de la graduadora). certNumber es null para raw/sealed.
ListingDTO   = { inventoryItemId, card: CardDTO, productType, rawCondition?, sealedSubtype?,
                 gradingCompany?, gradeValue?, certNumber?,
                 referenceValue: PriceInfo, salePriceCents?: number, sellable: boolean }
// Punto de la serie de tendencia del portafolio (gráfica estilo acciones). estimated? = punto de backfill indicativo.
PortfolioPointDTO = { date: string, valueMxnCents: number, costBasisMxnCents?: number, estimated?: boolean }
// v1.3.1: regla de precio de buylist para una rareza. value = centavos MXN si mode=fixed; porcentaje [0,100] si mode=pct.
BuylistRule       = { mode: BuylistRuleMode, value: number }
// appliedRule = la regla que se resolvió para la carta; ruleSource="rule" (fila explícita) o "fallback" (BUYLIST_PRICE_FALLBACK_PCT).
BuylistRuleApplied = { mode: BuylistRuleMode, value: number, source: "rule" | "fallback" }
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
  imageLargeUrl` — cumple id/nombre/set/rareza/imagen/número). **No** hay `sellable`/`salePriceCents` (no es
  Compra); no hay precio en este DTO.
Err: `400 VALIDATION_ERROR` (paginación inválida).
Nota: para **cotizar** una carta encontrada, el front llama `POST /buylist/quote` con su `cardId`. Si la carta
es `ex_plus` y **no tiene precio de referencia** (típico en cartas fuera de bóveda), la cotización sale
`precio_pendiente` y escala a la cola del dueño al crear la solicitud (§13, criterio 13). Ver **Pregunta
abierta 1** (pricing on-demand del cotizador) en ARCHITECTURE §10.

#### GET /api/v1/buylist/sets — `public`  (v1.3)
Sets que tienen **cartas importadas** (para poblar el dropdown de set del cotizador). A diferencia de
`GET /catalog/sets` (solo sets con inventario publicado), aquí aparecen **todos** los sets del catálogo.
Res `200`: `{ data: [{ id, name, series, releaseDate, year }] }` (datos en inglés; `year` derivado de
`releaseDate`; ordenados por año **desc**).

### POST /api/v1/buylist/quote — `public`  (v1.3.1: por RAREZA)
Cotizador público (stateless). Muestra el mensaje de "pago tras recepción y verificación" (copy en frontend).
Req: `{ cardId: string, productType: ProductType, rawCondition?: RawCondition }`
Res `200`:
```json
{ "rarity": "Illustration Rare",
  "appliedRule": { "mode": "pct", "value": 40, "source": "fallback" },
  "quote": { "status": "cotizada", "quotedPriceCents": 5000, "currency": "MXN" },
  "referencePrice": { "status": "priced", "priceMxnCents": 12500 },
  "paymentNotice": "PAY_AFTER_RECEIPT" }
```
**Resolución del monto (server-side, ARCHITECTURE §4.2):** el backend toma la **rareza oficial real** de la carta
(`Card.rarity` por `cardId`, **nunca del cliente** — SEC-A1), busca su regla en `BUYLIST_PRICE_RULES`:
- `mode="fixed"` → `quotedPriceCents = value` (centavos). **No** depende de la referencia → siempre `cotizada`.
- `mode="pct"`  → `quotedPriceCents = round(referencia × value/100)`. Si **falta referencia** →
  `{ "quote": { "status": "precio_pendiente", "quotedPriceCents": null } }` (escala a cola al crear la solicitud).
- **rareza sin regla** (nueva/no configurada) → aplica `BUYLIST_PRICE_FALLBACK_PCT` (default 40) como `pct`;
  `appliedRule.source="fallback"`. No bloquea la cotización (solo cae en `precio_pendiente` si además falta referencia).

La condición de compra es **siempre NM** (§ARCHITECTURE 3.5); `rawCondition` en el request solo puede ser `NM`.
El seed reproduce el comportamiento anterior: Common/Uncommon `fixed 50`, Reverse Holo `fixed 150`, resto `40%`
de la referencia (criterio 12). El "precio pendiente" es de adquisición/back-office; **nunca** se muestra al comprador.

### POST /api/v1/buylist/requests — `customer`
Crea la solicitud; valida topes/KYC.
Req: `{ items: [{ cardId, productType, rawCondition? }], clabe: string, ineUploadKeys?: { front, back } }`
> **v1.3.1:** `items` **ya no** incluye `category` (SEC-A1: el backend deriva la regla server-side de
> `Card.rarity`; un `category` del cliente se ignora si se envía). Cada item cotizado snapshotea la regla
> aplicada (rarity/ruleMode/ruleValue/ruleSource) y se refleja en `SellItemDTO`.
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

## 7. Disputas de condición (raw y sellado)

Disputa de **condición** sobre un item **entregado** (ventana de 7 días desde la entrega). Cubre tanto **raw** como **sellado**; el tipo se conserva (`condition_raw | condition_sealed`, ver ARCHITECTURE §3.6 y §11 M-10). El **graded no** tiene disputa de condición.

> **Evidencia por correo (v1.2):** la disputa **ya no acepta evidencia por archivo** en la app (se elimina el
> propósito de upload `dispute_claim`). El cliente **envía la evidencia por correo al buzón de soporte**
> (**soporte@tcgvault.mx** — *SUPUESTO por confirmar por el humano*, ver PROJECT.md). Este correo es un **dato
> de contacto** que el front muestra en el flujo de disputa y en términos/FAQ; **no** es un endpoint. Ya **no
> existe comparador de fotos de ingreso** en el back-office.

### POST /api/v1/disputes — `customer`
El `type` de la disputa se **deriva server-side** del `productType` del `inventoryItemId` (el cliente **no** lo envía):
- `productType=raw` → `type="condition_raw"`. Resolución por el **estándar/política de condición NM** propio (no por foto).
- `productType=sealed` → `type="condition_sealed"`. Aplica a caja **dañada/equivocada** (sin "condición NM"). Ver ARCHITECTURE §3.6.
- `productType=graded` → **no aplica**: `422 NOT_RAW`.
Req: `{ inventoryItemId: string, description: string }`  (**sin** `claimPhotoUploadKeys`; la evidencia va por correo a soporte).
Res `201`: `{ disputeId, status: "abierta", type: "condition_raw" | "condition_sealed", deadlineAt, evidenceContact: "soporte@tcgvault.mx" }`
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
  Req: `{ cardId, productType, rawCondition?, sealedSubtype?, gradingCompany?, gradeValue?, certNumber?, locationId, acquisitionType, acquisitionPct?, listPriceCents?, sourceSellRequestItemId? }`
  - **Sin fotos propias (v1.2):** el alta **ya no recibe** `frontPhotoKey`/`backPhotoKey`/`extraPhotoKeys`; la imagen del item es la **imagen de catálogo remota** de la `Card` (pokemontcg.io). No se sube ninguna foto de producto/inventario.
  - `productType=raw` → `rawCondition` solo `NM` (v1.1). `productType=sealed` → `sealedSubtype?` (opcional), **sin** `rawCondition`/grade/rareza/cert; `listPriceCents` (precio manual MXN) es **obligatorio para publicar** el sellado. `productType=graded` → `gradingCompany` + `gradeValue` + **`certNumber` (nº de certificado PSA/CGC, string) — REQUERIDO para publicar una gradeada** (v1.2). Sin validación automática contra la graduadora (fuera de alcance); es un dato capturado a mano.
  Para `aportacion_en_especie`: el costo se calcula = **referencia del día × pct** (default 70, editable). El item nace `ownerType=platform`.
  Res `201`: `{ id, folio: "INV-000123", status: "in_stock", acquisitionCostCents }`
  Err `422 PRICE_PENDING` (si aportación en especie y no hay referencia → cola de precio pendiente), `422 VALIDATION_ERROR` (p. ej. `sealed` con `rawCondition`, `raw` con `rawCondition != NM`, o **`graded` sin `certNumber`**).
- `GET /api/v1/admin/inventory/items` — query `?status=&cardId=&ownerType=&locationId=&zone=&q=&page=`
- `GET /api/v1/admin/inventory/items/:id` — detalle + historial de movimientos.
- `PATCH /api/v1/admin/inventory/items/:id` — editar (grado, `certNumber`, `sealedSubtype`, `listPriceCents` manual, ubicación, etc.). **No** hay campos de foto de producto (v1.2).
- `POST /api/v1/admin/inventory/items/:id/move` — Req `{ toLocationId, note? }` → registra `InventoryMovement`.
- `POST /api/v1/admin/inventory/items/:id/mark` — Req `{ mark: "lost" | "damaged", note }` → `status` y movimiento; disponible para reposición (M7/tope M10).
- Ubicaciones: `GET /api/v1/admin/locations`, `POST /api/v1/admin/locations` (`{ zone, box, row, slot }`).

### M2 — Catálogo y precios (`super_admin`)
> **Estado v1.3: YA EXISTE en backend** (`PricingController`, `FxController`, `AdminCatalogController`). No requiere backend nuevo para el flujo M2 existente (sync de precios de bóveda, override, FX, rareza→categoría, sync de catálogo por fecha/backfill); falta **consumo de frontend** (M2 es `ModuleTodo` en UI). Lo **único NUEVO** de backend en M2 es `POST /admin/catalog/sync-all` (abajo), para la Opción 1 del cotizador.
- `POST /api/v1/admin/pricing/sync` — dispara/encola el sync diario (solo bóveda). Req `{ scope?: "all_vault" | "cardIds" , cardIds?: [] }` → `{ jobId, queued: number }`.
- `GET /api/v1/admin/pricing/pending` — cola de precio pendiente. `{ data: PendingPriceEntry[] }`.
- `POST /api/v1/admin/pricing/override` — override manual (respaldo siempre disponible).
  Req: `{ cardId, productType, gradeKey, priceMxnCents }` → crea `PriceReference` `source=manual`, resuelve `PendingPriceEntry`.
- `GET /api/v1/admin/pricing/card/:cardId` — historial de precios por fecha/fuente.
- FX: `GET /api/v1/admin/fx` → `{ rate, bufferPct, source: FxSource, effectiveDate }` (automático diario desde **Banxico SIE** + colchón). `PUT /api/v1/admin/fx` — Req `{ rate, bufferPct }` → fija **override manual** (`source=manual`, prioridad sobre el automático del día). `POST /api/v1/admin/fx/refresh` — fuerza el fetch a Banxico.
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
- `POST /api/v1/admin/catalog/sync-all` — **(v1.3, NUEVO)** importa **TODO el catálogo** (todos los sets remotos, sin frontera de fecha) — soporte de la **Opción 1** del cotizador (poder cotizar cualquier carta). **Truly-async**: encola los sets en la cola BullMQ y **retorna de inmediato** (no importa en el request, a diferencia del `sync` from-date actual — ver Desviación DEV-1 en ARCHITECTURE §9).
  Req: `{ }` (sin body; ignora `catalog_sync_from_date`).
  Res `202`: `{ jobId: string, setsQueued: number, remaining: number }` (`setsQueued` = sets encolados en esta llamada; `remaining` = sets remotos aún no importados tras encolar). Idempotente: los sets ya importados se re-upsertean sin duplicar. Auditado (`action: catalog.sync_all`).
  > **Alternativa sin endpoint nuevo:** el mismo resultado se logra con `POST /admin/catalog/sync` pasando un `fromReleaseDate` muy antiguo (p. ej. `"1998/01/01"`) **más** `POST /admin/catalog/backfill` repetido hasta `remaining=0`. `sync-all` existe para hacerlo explícito y **seguro contra timeouts** en catálogos grandes. Backend decide si `sync-all` es un wrapper que encola lo mismo que `backfill` en lote completo.
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
- `POST /api/v1/admin/shipments/:id/tracking` — Req `{ carrier, trackingNumber, shippingCostCents? }` → avanza a `guia`.
  - **`shippingCostCents?` (v1.4-finance, NUEVO):** costo real que **la plataforma paga a la paquetería** por este envío (MXN centavos). **Distinto** de `ShipmentRequest.shippingFeeCents` (ingreso cobrado al cliente). **Opcional** (si se omite, no se modifica; el valor persistido arranca en `0` por default de columna, M-16) y **editable** re-invocando este endpoint (idempotente sobre carrier/tracking; no regresa el estado si ya está en `guia`/posterior). **Validación:** entero **≥ 0** (`422 VALIDATION_ERROR` si negativo o no entero). Alimenta el P&L de M7 (se resta, acotado por `pickingAt`). Queda en `AuditLog` (`action: shipment.tracking`, con `carrier`/`trackingNumber`/`shippingCostCents` en `after`).
  - Nota: `shippingCostCents` es un dato **interno de costo**; **no** se expone al cliente (`GET /shipments/:id` del comprador NO lo incluye).

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
> **Estado v1.3: YA EXISTE en backend** (`AdminUsersController` + `AdminService.listUsers/getUser/updateUserKyc/updateUserStatus`). No requiere backend nuevo; falta **consumo de frontend** (M6 es `ModuleTodo` en UI). Shapes confirmados contra el código: el **listado** es paginado `{ data, page, pageSize, total }` con `data: { id, email, name, role, status, createdAt }[]` y filtros `q` (email/name) + `status`; la **ficha 360°** (`GET /admin/users/:id`) incluye `kycProfile` (CLABE/RFC **enmascarados** incluso para `super_admin`; `ineOnFile: boolean`), `billingProfile` (RFC enmascarado; `null` para `vault_operator`), `addresses`, `orders` (últimas 20), `sellRequests` (20), `disputes` (20) y `ownedItems` (bóveda). El `vault_operator` recibe **proyección reducida** (sin RFC/INE/billing).
- `GET /api/v1/admin/users` — `?q=&status=&page=`
- `GET /api/v1/admin/users/:id` — **ficha 360°** (compras, bóveda, buylist, disputas, KYC). La CLABE y el RFC se devuelven **enmascarados también para `super_admin`** (`clabeMasked` = `****1234`, `rfcMasked` = parcial); la CLABE en claro solo por `reveal-clabe`. Para `vault_operator` se mantiene la proyección reducida de SEC-A4 (sin CLABE/RFC/INE keys ni billing profile; `ineOnFile` booleano).
- `PATCH /api/v1/admin/users/:id/kyc` — **`super_admin`** — Req `{ kycStatus, capPerRequestCents?, capPerMonthCents? }`.
- `PATCH /api/v1/admin/users/:id/status` — **`super_admin`** — Req `{ status: "active" | "blocked" }`.

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
- `GET /api/v1/admin/disputes` — cola `?status=&page=`
- `GET /api/v1/admin/disputes/:id` — detalle: `{ item, order, description, type, deadlineAt, evidenceContact: "soporte@tcgvault.mx" }`. **Sin comparador de fotos de ingreso** (v1.2): la evidencia del cliente llega **por correo a soporte**, fuera del sistema. Para gradeadas el detalle expone `gradingCompany + gradeValue + certNumber` (verificable en la graduadora); la imagen del item es la de catálogo.
- `POST /api/v1/admin/disputes/:id/resolve` — Req `{ resolution: "repurchase" | "reject", note }`. `repurchase` = **`super_admin`** (dinero saliente) → **compensación por disputa: recompra al precio pagado** (crea el pago de recompra), dispute `→resuelta_recompra`. Política VENTAS FINALES: el **cliente conserva la carta** y la carta **NO** regresa al inventario (no se re-agrega item, no se crea `InventoryMovement`). `reject` → `rechazada`.

### M9 — Reportes (`super_admin`)
> **Estado v1.3: YA EXISTE en backend** (`AdminReportsController` + `AdminService.launchMetrics/exportCsv`). No requiere backend nuevo; falta **consumo de frontend** (M9 es `ModuleTodo` en UI).
- `GET /api/v1/admin/reports/launch-metrics` — `?from=&to=` → métricas de lanzamiento vs metas N/X/Y/Z. Shape real: `{ users, salesSettled, buylistPaid, withdrawalsNoDispute, goals: { N, X, Y, Z } | null }`. Cuando **no hay metas fijadas**, `goals` debe ser **`null`** (el objeto completo), **no** un objeto con campos nulos como `{ N: null, X: null, Y: null, Z: null }`. Solo cuando el humano fija las metas, `goals` pasa a ser el objeto `{ N, X, Y, Z }`. Cada métrica respeta el rango por su fecha de realización (alta de usuario / `settledAt` / `paidAt` / `deliveredAt`).
- `GET /api/v1/admin/reports/export.csv` — `?report=pnl|iva|inventory&from=&to=` → CSV (comparte el `exportCsv` de M7; `report` default `pnl`).

### M10 — Config (diales) y bitácora (`super_admin`)
> **Estado v1.3: YA EXISTE en backend** (`SettingsController`: `GET/PUT /admin/settings`, `GET /admin/audit-log`). No requiere backend nuevo; falta **consumo de frontend** (M10 es `ModuleTodo` en UI). **La edición de diales es `PUT /admin/settings` con body parcial** (solo las keys a cambiar) — **no** existe ni se añade `PATCH/PUT /admin/settings/:key`; el front edita enviando el subconjunto de keys modificadas. Cada `PUT` queda en `AuditLog` (`action: settings.update`, con `before`/`after`).
- `GET /api/v1/admin/settings` → todos los diales `{ shippingFeeCents, aportacionPct, ivaPct, salesMarkupPct, stripeFeePct, stripeFeeFixedCents, stripeFeeIvaPct, buylistCapPerRequestCents, buylistCapPerMonthCents, ineThresholdCents, repoCapPerCardCents, fxBufferPct, fxManualOverrideRate?, pricingProviderRaw, pricingProviderGraded, pricingProviderSealed, catalogSyncFromDate }`. `stripeFeeIvaPct` (fracción `[0,1)`, default **0.16**) = IVA que Stripe MX cobra **sobre su comisión**; entra en el gross-up del fee (ver ARCHITECTURE §5.1). `catalogSyncFromDate` (string `yyyy/MM/dd`, default **`"2024/01/01"`**) = frontera por defecto del sync de catálogo M2 (ver `POST /admin/catalog/sync`); editable sin redeploy. **Es una `ConfigSetting` de primera clase** (ARCHITECTURE §3.6), por lo que se expone aquí como los demás diales. Nota: `ine_retention_days` **no** se expone en este DTO (dial interno de retención/legal, fuera de la lista `ConfigSetting`).
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
// v1.3.1: `category` (BuylistCategory) REEMPLAZADO por `rarity` + `appliedRule`. `category` deprecado (puede
// venir null en filas legacy; no lo consuma el front nuevo).
SellItemDTO      = { id, card: CardDTO, productType, rawCondition?,
                     rarity?: string, appliedRule?: BuylistRuleApplied,
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
- Buylist: cotización por **regla por rareza oficial** (v1.3.1 — `fixed` MX$ / `pct` % de la referencia + fallback %; reemplaza común/reverse/EX+), topes y INE (`BUYLIST_LIMIT_EXCEEDED`, `INE_REQUIRED`), pago SPEI **solo súper-admin** tras recepción/verificación. La regla se **deriva server-side** de `Card.rarity` (SEC-A1); editor en M2 (`buylist-rules`/`rarities`).
- Contracargo (webhook `charge.dispute.created`) es **consciente del estado físico**: revierte el item a inventario de plataforma **solo si sigue en bóveda**; si ya se envió/entregó **no** re-agrega y marca `chargebackNeedsManual` (ver §9). Cierre de disputa: ganamos→`settled` (`disputeOutcome=won`), perdemos→`chargeback` (`disputeOutcome=lost`).
- **VENTAS FINALES** (política del humano, ver `PROJECT.md`): no hay reembolso voluntario. Excepciones: (a) **error de la plataforma** (cobro doble/inventario fantasma) → **siempre** se reembolsa (§M3); (b) **disputa de condición** raw dañada/equivocada → el súper-admin compensa con **recompra al precio pagado**, el cliente **conserva la carta** y **no** vuelve al inventario (§M8). En ningún caso de reembolso/recompra el item se re-agrega al inventario.
- Los montos exactos de los diales (envío 17500, IVA 16, markup de venta, tarifa Stripe, tope 300000/1000000, aportación 70%) provienen de `ConfigSetting` (M10), no hardcode; los valores aquí son defaults.
- **P&L separa ingreso vs costo de envío (v1.4-finance):** el envío entra al P&L por dos lados — **ingreso** (`ShipmentRequest.shippingFeeCents`, `shippingRevenueCents` en el response) y **costo** (`ShipmentRequest.shippingCostCents`, capturado en M4 al asignar guía, M-16). Fórmula: `profitCents = incomeCents + shippingRevenueCents − cogsCents − stripeFeesCents − shippingCostCents`. Ambos se acotan al periodo por `pickingAt`. `shippingCostCents` es un **costo interno**: no se expone al cliente. `GET /admin/finance/pnl` renombra `shippingCents`→`shippingRevenueCents` (M7 sin consumidores de frontend aún); el CSV espeja el shape.

**Coherencia v1.1 (2026-08-14):**
- **Raw solo NM:** `RawCondition=NM` (único valor); el filtro `condition` para raw solo admite `NM`. Labels legibles ("Casi nueva (Near Mint)" / "Near Mint") viven en i18n del **front**, no en la API. Migración: ARCHITECTURE §11 (M-1).
- **Compra = inventario publicado con precio:** `GET /catalog/cards` **excluye** pendientes/sin precio (el comprador nunca ve "precio pendiente"). Facetas dinámicas en `GET /catalog/facets`: `rarities` distinct de `Card.rarity` espejando pokemontcg.io (lista abierta), `sets` con `year` derivado, filtros por set/rareza/tipo/precio. La **ruta se mantiene** `/catalog/cards` (rótulo "Compra" en el front).
- **Sellado como línea de venta:** `productType=sealed`, `sealedSubtype?`, **precio manual MXN obligatorio para publicar**, sin condición/grade/rareza. Disputa de sellado = caja dañada/equivocada (evidencia por correo a soporte; ver Coherencia v1.2).
- **Login Google:** `POST /auth/google` (mismo shape que `/login`); verificación server-side del ID token; `role` server-side (nunca del token); account-linking por email verificado; **no exime KYC**. Campos nuevos en `User` (migración M-3..M-7). Env `GOOGLE_CLIENT_ID` / `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.
- **Gráfica de portafolio:** `GET /vault/portfolio/history?range=...` sobre `PortfolioSnapshot` (modelo nuevo, migración M-8), escrito por job diario (BE-5). Backfill indicativo opcional marcado `estimated`.
- **Sync de catálogo M2:** `GET /admin/catalog/remote-sets`, `POST /admin/catalog/sync`, `POST /admin/catalog/backfill` (`super_admin`, auditado). Guardarraíl `setId` `^[a-z0-9]+(-[a-z0-9]+)*$`, host fijo (anti-SSRF), `Card.rarity` String libre.
- **AcquisitionPricer:** rarezas modernas → `ex_plus` (40% de referencia) si hay market price; solo lo sin dato de mercado escala a `precio_pendiente` (lado adquisición/admin). Condición siempre NM.

**Coherencia v1.2 / v1.2.1 (2026-08-14):**
- **Sin fotos de producto/inventario:** la imagen mostrada es la **de catálogo** de pokemontcg.io (`CardDTO.imageSmallUrl`/`imageLargeUrl`). `ListingDTO` **ya no** tiene `frontPhotoUrl`/`backPhotoUrl`; el alta de inventario **ya no** recibe `frontPhotoKey`/`backPhotoKey`/`extraPhotoKeys`. Migración ARCHITECTURE §11 (M-13).
- **Gradeadas por certificado:** `InventoryItem`/alta captura **`certNumber`** (string), **requerido para publicar** una gradeada; `ListingDTO` y detalles exponen `gradingCompany + gradeValue + certNumber`. Sin validación automática contra la graduadora. Migración M-12.
- **Uploads solo `kyc_ine`:** `POST /uploads/presign` rechaza cualquier `purpose` distinto de `kyc_ine` (`422 VALIDATION_ERROR`); `inventory_photo`/`dispute_claim` eliminados. Bucket INE **privado + cifrado + retención** (`INE_RETENTION_DAYS`), set `S3_*` conservado.
- **Disputa por correo:** `POST /disputes` sin `claimPhotoUploadKeys`; evidencia por correo a soporte (`evidenceContact`), sin comparador de fotos en §M8. Se conserva `type` (`condition_raw | condition_sealed`) y VENTAS FINALES; resolución por grado/`certNumber` (gradeadas) o estándar NM (raw).
- **INE (KYC) intacto:** almacenamiento del INE en R2 cifrado con retención, `reveal-clabe`, CLABE/RFC cifrados y enmascarados — **sin cambios** respecto a v1.1.

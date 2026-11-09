# API_CONTRACT.md — TCG HUNT · API v1

> **Estado vigente.** Índice generado del código el 2026-11-06 (`backend/src/modules/**/*.controller.ts`; 349 endpoints).
> La versión normativa anterior (v1.117.3: DTOs, enums y reglas) está en `docs/archive/API_CONTRACT.md`: **`grep -n`
> del endpoint ahí** antes de cambiarlo; los candados de paridad leen esa copia. Propiedad: **arquitecto**.
> Manda `PROJECT.md` sobre este contrato y este contrato sobre el código.

## 0. Convenciones
- **Base**: `/api/v1`, REST/JSON. Fechas ISO-8601 UTC.
- **Auth**: `Authorization: Bearer <access>`. `JwtAuthGuard` es global: todo endpoint exige sesión salvo `@Public()`.
  Refresh en `POST /auth/refresh` (cookie httpOnly o body). Tres JWT distintos por forma y llave (access sin `typ`;
  refresh `typ:"refresh"`; device `typ:"device"`). Contraseña temporal ⇒ solo se permite cambiarla.
- **Roles** (columna «Rol»): `público` = sin token · `cuenta` = cualquier usuario autenticado · `customer` · `staff` =
  `vault_operator` o `super_admin` · `admin` = solo `super_admin`. 💰 = `@MoneyOut` (saca dinero; candado extra).
  Permisos finos (`@RequirePermission`) o correo verificado (`@RequireEmailVerified`): ver el controlador.
- **Dinero**: enteros en **centavos MXN** (`*Cents`), `currency: "MXN"`. El cliente nunca calcula precios.
- **Paginación**: `?page=1&pageSize=20` ⇒ `{ data: [...], page, pageSize, total }`. Filtros de lista admin: `q`, `from`, `to`, `minCents`, `maxCents`.
- **Filtros de enum en query**: vacío ⇒ no filtra; token válido ⇒ filtra; otro valor ⇒ `400 VALIDATION_ERROR` con
  `details.field` y `details.allowed`. Nunca llega crudo a Prisma.
- **Errores**: `{ "error": { "code": "…", "message": "…", "details": {} } }`. Códigos en `backend/src/common/error-codes.ts`.
  Fallo transitorio de BD ⇒ `503 BUSY_TRY_AGAIN` (reintentable). Throttle ⇒ `429`.
- **Webhooks Stripe**: `POST /webhooks/stripe` (público, firma obligatoria, idempotente por id de evento; eventos
  suscritos en `security/stripe-webhook-events.txt`).
- **Enums**: fuente de verdad `backend/prisma/schema.prisma` + `backend/src/common/enum-values.ts`.
- **DTOs**: en `backend/src/modules/<módulo>/dto/` (class-validator). Request/response resumidos en el nombre de la ruta;
  el detalle normativo de cada uno está en el archivo.

## 1. Endpoints por módulo

### accessories
- GET `/accessories` · público
- GET `/accessories/suggestions` · público
- GET `/accessories/:id` · público
- GET `/accessories/:id/photo/:version/:variant` · público
- GET `/admin/accessories` · staff
- GET `/admin/accessories/:id` · staff
- POST `/admin/accessories` · staff
- PATCH `/admin/accessories/:id` · staff
- POST `/admin/accessories/:id/activate` · admin
- POST `/admin/accessories/:id/deactivate` · admin
- DELETE `/admin/accessories/:id` · admin
- POST `/admin/accessories/:id/photo` · staff
- POST `/admin/accessories/:id/stock` · staff
- GET `/admin/accessories/:id/stock-movements` · staff

### admin
- GET `/admin/shipping/packages` · staff
- PUT `/admin/shipping/packages` · admin
- GET `/admin/shipping/catalogs` · admin
- GET `/admin/shipping/catalogs/consignment-notes` · admin
- GET `/admin/shipping/balance` · admin
- GET `/admin/users` · staff
- GET `/admin/users/:id` · staff
- GET `/admin/users/:id/audit` · staff
- PATCH `/admin/users/:id/kyc` · admin
- GET `/admin/users/:id/kyc/ine-links` · admin
- PATCH `/admin/users/:id/status` · admin
- DELETE `/admin/users/:id` · admin
- GET `/admin/finance/shrinkage` · admin
- GET `/admin/finance/pnl` · admin
- GET `/admin/finance/inventory-value` · admin
- GET `/admin/finance/custody-value` · admin
- GET `/admin/finance/iva` · admin
- GET `/admin/finance/export.csv` · admin
- GET `/admin/reports/sales` · admin
- GET `/admin/reports/sales/export.csv` · admin
- GET `/admin/reports/sales/today` · admin
- GET `/admin/reports/launch-metrics` · admin
- GET `/admin/reports/pricing-brackets` · admin
- GET `/admin/reports/export.csv` · admin
- GET `/admin/dashboard` · staff

### auth
- POST `/auth/register` · público
- POST `/auth/register/email-only` · público
- POST `/auth/account-setup` · público
- POST `/auth/set-password` · customer
- POST `/auth/login` · público
- POST `/auth/google` · público
- POST `/auth/refresh` · público
- POST `/auth/logout` · cuenta
- POST `/auth/change-password` · cuenta
- POST `/auth/verify-email/resend` · cuenta
- POST `/auth/verify-email` · público
- POST `/auth/forgot-password` · público
- POST `/auth/reset-password` · público

### buylist
- GET `/admin/buylist` · staff
- GET `/admin/buylist/rejected-items` · staff
- GET `/admin/buylist/offers/pending-authorization` · staff
- GET `/admin/buylist/live-sellers` · staff
- GET `/admin/buylist/pending-shipment-confirmation` · staff
- GET `/admin/buylist/guides/pending-cancellation` · staff
- GET `/admin/buylist/:id` · staff
- GET `/admin/buylist/:id/decision-table` · staff
- GET `/admin/buylist/:id/reveal-clabe` · admin 💰
- POST `/admin/buylist/:id/offer` · staff
- PATCH `/admin/buylist/:id/pickup-address` · staff
- POST `/admin/buylist/:id/decline-accepted` · staff
- POST `/admin/buylist/:id/receive` · staff
- POST `/admin/buylist/:id/verify` · staff
- POST `/admin/buylist/:id/reject-items` · staff
- PATCH `/admin/buylist/items/:itemId/decision` · staff
- GET `/buylist/cards` · público
- GET `/buylist/sets` · público
- POST `/buylist/quote` · público
- POST `/buylist/quote/batch` · público
- GET `/buylist/bounties` · público
- GET `/buylist/quote-policy` · público
- POST `/buylist/requests` · cuenta
- GET `/buylist/requests` · cuenta
- GET `/buylist/requests/:id` · cuenta
- PATCH `/buylist/requests/:id/pickup-address` · cuenta
- POST `/buylist/requests/:id/respond` · cuenta
- POST `/buylist/requests/:id/offer-response` · cuenta
- POST `/buylist/requests/:id/declare-shipped` · cuenta

### card-show
- GET `/admin/card-show/leads` · admin
- GET `/admin/card-show/players` · admin
- POST `/admin/card-show/leads/:id/release` · admin
- POST `/admin/card-show/reopen-sending` · admin
- GET `/admin/card-show/leads/export.csv` · admin
- GET `/admin/card-show/players/export.csv` · admin
- GET `/card-show/form-token` · público
- GET `/card-show/tournament/count` · público
- POST `/card-show/leads` · público
- POST `/card-show/players` · público
- POST `/card-show/confirm` · público
- POST `/card-show/cancel` · público
- POST `/card-show/unsubscribe` · público
- POST `/card-show/unsubscribe-oneclick` · público
- POST `/card-show/webhooks/resend` · público
- GET `/card-show/ir/:destino` · público
- POST `/card-show/click` · público

### catalog
- GET `/admin/catalog/remote-sets` · admin
- GET `/admin/catalog/sync-status` · admin
- POST `/admin/catalog/unify-rarities` · admin
- POST `/admin/catalog/sync` · admin — respuesta incluye `shadowed: string[]` (ids de sets omitidos por sombra `tcgcsv:`)
- POST `/admin/catalog/refresh-variants` · admin
- GET `/admin/catalog/refresh-variants-status` · admin
- POST `/admin/catalog/refresh-variants-all` · admin
- POST `/admin/catalog/sync-all` · admin
- POST `/admin/catalog/backfill` · admin
- GET `/admin/catalog/tcgcsv-groups` · admin — SOLO los grupos de la lista explícita `TCGCSV_IMPORTABLE_GROUPS` (hoy 24451): `[{groupId,name,publishedOn:string|null,imported,productCount:int|null,cardCount}]`; `productCount` = productos con número en TCGCSV (null si no responde), `cardCount` = cartas locales; orden `publishedOn` desc, nulos al final; solo `super_admin`
- POST `/admin/catalog/import-tcgcsv-set` · solo `super_admin` — `{groupId:int}` ⇒ `{setId,created,updated,stamped,noPrice,skipped:[{productId,name,reason}]}`, `reason` ∈ `no_number|number_mismatch|unknown_stamp|empty_name|no_base|ambiguous_base|product_already_linked|field_too_long`; errores 400, 404 `TCGCSV_GROUP_UNKNOWN` (fuera de la lista), 409 `TCGCSV_GROUP_COVERED` (pokemontcg.io ya publica el set), 409 `TCGCSV_IMPORT_IN_PROGRESS` (mismo grupo en curso; sin espera), 502 `UPSTREAM_ERROR` (TCGCSV caído o respuesta > 5 MB), 503 `POKEMONTCG_UNAVAILABLE` (0 filas; ver QA-PRM-FLAKY/EMPTY), 503 `TCGCSV_IMPORT_FAILED` (rollback total); todo-o-nada e idempotente; `AuditLog catalog.tcgcsv_import`
- GET `/catalog/featured` · público
- GET `/catalog/cards` · cuenta
- GET `/catalog/facets` · cuenta
- GET `/catalog/sitemap` · público
- GET `/catalog/sealed` · cuenta
- GET `/catalog/sealed/:inventoryItemId` · público
- GET `/catalog/sealed/:inventoryItemId/value-history` · público
- GET `/catalog/cards/:cardId` · público
- GET `/catalog/listings/:inventoryItemId` · público
- GET `/catalog/sets` · público
- GET `/catalog/featured-set/value-history` · público
- GET `/catalog/sets/:id/value-history` · público
- GET `/admin/pricing/graded-estimates/budget` · admin
- GET `/admin/pricing/graded-estimates` · admin
- PUT `/admin/pricing/graded-estimates` · admin
- GET `/admin/pricing/graded-estimates/preview` · admin
- GET `/admin/pricing/graded-estimates/review` · admin
- DELETE `/admin/pricing/graded-estimates/:cardId/:gradeValue` · admin

### decks-meta
- GET `/admin/decks-meta` · staff
- GET `/admin/decks-meta/preview` · staff
- GET `/admin/decks-meta/unmatched` · staff
- POST `/admin/decks-meta` · staff
- GET `/admin/decks-meta/dial` · staff
- PUT `/admin/decks-meta/dial` · admin
- PUT `/admin/decks-meta/:id` · staff
- GET `/decks-meta` · público
- GET `/decks-meta/:slug` · público
- POST `/decks-meta/paste` · público

### discounts
- GET `/admin/discount-codes` · admin
- POST `/admin/discount-codes` · admin
- POST `/admin/discount-codes/preview` · admin
- GET `/admin/discount-codes/:id` · admin
- PATCH `/admin/discount-codes/:id` · admin
- POST `/admin/discount-codes/:id/pause` · admin
- POST `/admin/discount-codes/:id/resume` · admin
- DELETE `/admin/discount-codes/:id` · admin
- GET `/admin/discount-codes/:id/report` · admin
- GET `/admin/discount-codes/:id/report.csv` · admin
- GET `/admin/discount-codes/:id/audit` · admin
- POST `/admin/discount-code-batches` · admin
- GET `/admin/discount-code-batches` · admin
- GET `/admin/discount-code-batches/:id` · admin
- PATCH `/admin/discount-code-batches/:id` · admin
- POST `/admin/discount-code-batches/:id/pause` · admin
- POST `/admin/discount-code-batches/:id/resume` · admin
- GET `/admin/discount-code-batches/:id/codes.csv` · admin
- GET `/admin/discount-code-batches/:id/report` · admin
- GET `/admin/discount-code-batches/:id/report.csv` · admin
- GET `/admin/discount-code-batches/:id/audit` · admin

### disputes
- POST `/disputes` · cuenta
- GET `/disputes` · cuenta
- GET `/disputes/:id` · cuenta
- GET `/admin/disputes` · staff
- GET `/admin/disputes/:id` · staff

### health
- GET `/health` · público
- POST `/telemetry/csp` · público
- POST `/telemetry/client-error` · público

### inventory
- GET `/admin/inventory/master-sets` · staff
- GET `/admin/inventory/master-sets/:setId` · staff
- GET `/admin/inventory/sealed-sets` · staff
- GET `/admin/inventory/sealed-sets/:setId` · staff
- GET `/admin/inventory/graded` · staff
- GET `/admin/inventory/sealed-catalog` · staff
- GET `/admin/inventory/sealed-products` · staff
- POST `/admin/inventory/sealed-products/sync` · admin
- GET `/admin/inventory/sealed-products/sync/candidates` · admin
- POST `/admin/inventory/sealed-sets/:setId/groups` · admin
- GET `/admin/inventory/sealed-price-sheet` · staff
- PUT `/admin/inventory/sealed-products/:sealedProductId/sale-price` · admin
- GET `/admin/inventory/sealed-price-status` · staff
- PUT `/admin/inventory/sealed-sets/:setId/set-main-group` · admin
- DELETE `/admin/inventory/sealed-sets/:setId/groups/:groupId` · admin
- POST `/admin/inventory/items/batch` · staff
- POST `/admin/inventory/items/bulk-publish` · staff
- POST `/admin/inventory/publish-all` · staff
- POST `/admin/inventory/adjustments` · staff
- POST `/admin/inventory/items/bulk-remove` · staff
- GET `/admin/inventory/export.xlsx` · staff
- POST `/admin/inventory/items` · staff
- GET `/admin/inventory/items` · staff
- GET `/admin/inventory/pending-publish` · staff
- GET `/admin/inventory/cards/:cardId/versions` · staff
- POST `/admin/inventory/stamped-candidates/:tcgplayerProductId/attach` · staff
- GET `/admin/inventory/items/:id` · staff
- PATCH `/admin/inventory/items/:id` · staff
- POST `/admin/inventory/items/:id/move` · staff
- POST `/admin/inventory/items/:id/mark` · staff
- GET `/admin/locations` · staff
- POST `/admin/locations` · staff

### marketing
- GET `/admin/marketing/annotations` · cuenta
- POST `/admin/marketing/annotations` · cuenta
- PATCH `/admin/marketing/annotations/:id` · cuenta
- DELETE `/admin/marketing/annotations/:id` · cuenta
- GET `/admin/marketing/tokens` · admin
- POST `/admin/marketing/tokens` · admin
- POST `/admin/marketing/tokens/:id/revoke` · admin
- GET `/admin/marketing/aggregates` · cuenta
- GET `/admin/marketing/panel` · cuenta
- GET `/admin/marketing/periods` · cuenta
- GET `/admin/marketing/export` · cuenta
- GET `/admin/marketing/export/todo` · cuenta
- GET `/admin/marketing/weekly-excel` · cuenta

### measurement
- POST `/admin/measurement/meta-test-event` · admin
- POST `/measurement/banner-response` · público

### orders
- GET `/admin/orders` · staff
- GET `/admin/orders/:id` · staff
- POST `/admin/orders/:id/tracking-link` · staff
- POST `/admin/orders/:id/chargeback-inventory` · staff
- POST `/admin/orders/:id/refund` · staff 💰
- POST `/admin/orders/:id/items/:orderItemId/refund-delivered` · staff 💰
- POST `/admin/orders/:id/accessory-lines/:lineId/refund-delivered` · staff 💰
- POST `/admin/orders/:id/shipped-refund-reason` · staff 💰
- POST `/admin/orders/:id/reclaim-vault` · admin
- POST `/checkout/guest/quote` · público
- GET `/checkout/shipping-rule` · público
- POST `/checkout/guest/session` · público
- POST `/orders/guest/track` · público
- POST `/orders/guest/resend-link` · público
- POST `/checkout/quote` · cuenta
- POST `/checkout/session` · cuenta
- GET `/orders` · cuenta
- GET `/orders/claimable` · cuenta
- POST `/orders/claim` · cuenta
- GET `/orders/:orderId` · cuenta
- POST `/orders/:orderId/request-invoice` · cuenta
- GET `/support/contact` · público

### payments
- GET `/admin/manual-refunds/withdrawal-delivered/preview` · operador+
- POST `/admin/manual-refunds/withdrawal-delivered` · operador+
- GET `/admin/manual-refunds` · operador+
- GET `/admin/manual-refunds/:id` · operador+
- GET `/admin/manual-refunds/:id/reveal-clabe` · operador+
- POST `/admin/manual-refunds/:id/paid` · operador+
- POST `/admin/manual-refunds/:id/cancel` · operador+
- POST `/admin/manual-refunds/:id/reissue` · operador+
- POST `/admin/refunds/:id/to-manual` · staff 💰
- POST `/admin/refunds/:id/retry` · staff
- GET `/admin/refunds/operator-summary` · admin
- GET `/admin/refunds` · admin
- POST `/webhooks/stripe` · público

### pricing
- GET `/admin/pricing/bounties` · admin
- POST `/admin/pricing/sync` · admin
- GET `/admin/pricing/sync-status` · admin
- GET `/admin/pricing/pending` · admin
- GET `/admin/pricing/review-queue` · admin
- POST `/admin/pricing/review-queue/:id/resolve` · admin
- PUT `/admin/pricing/variant-controls/:cardId/:finish` · admin
- DELETE `/admin/pricing/variant-controls/:cardId/:finish/bounty` · admin
- GET `/admin/pricing/card/:cardId` · admin
- GET `/admin/pricing/curve` · admin
- PUT `/admin/pricing/curve` · admin
- POST `/admin/pricing/curve/preview` · admin
- GET `/admin/pricing/rarities` · admin
- GET `/admin/pricing/sealed-spreads` · admin
- PUT `/admin/pricing/sealed-spreads` · admin
- GET `/admin/fx` · admin
- PUT `/admin/fx` · admin
- PUT `/admin/fx/mode` · admin
- GET `/admin/pricing/sealed/unmapped` · admin
- GET `/admin/pricing/sealed/tcgcsv/groups` · admin
- GET `/admin/pricing/sealed/tcgcsv/groups/:groupId/products` · admin
- PUT `/admin/pricing/sealed/items/:itemId/mapping` · admin

### settings
- GET `/admin/settings` · staff
- PUT `/admin/settings` · staff
- GET `/admin/settings/iva-transfer` · staff
- GET `/admin/settings/iva-transfer/preview` · staff
- PUT `/admin/settings/iva-transfer` · staff
- GET `/admin/audit-log` · staff

### shipments
- GET `/admin/shipments` · staff
- GET `/admin/shipments/picking-list/summary` · staff
- GET `/admin/shipments/picking-list` · staff
- GET `/admin/shipments/departure` · staff
- POST `/admin/shipments/departed` · staff
- POST `/admin/shipments/:id/refresh-tracking` · staff
- GET `/admin/shipments/:id/label.pdf` · staff
- GET `/admin/shipments/:id` · staff
- PATCH `/admin/shipments/:id/prep-items/:shipmentItemId` · staff
- PATCH `/admin/shipments/:id/prep-accessory-lines/:lineId` · staff
- POST `/admin/shipments/:id/prepared` · staff
- DELETE `/admin/shipments/:id/prepared` · staff
- PUT `/admin/shipments/:id/address` · staff
- POST `/admin/shipments/:id/quote` · staff
- GET `/admin/shipments/:id/quote` · staff
- POST `/admin/shipments/:id/label` · staff
- POST `/admin/shipments/:id/label/cancel` · staff
- POST `/admin/shipments/:id/label/release` · admin 💰
- PATCH `/admin/shipments/:id/status` · staff
- POST `/admin/shipments/:id/tracking` · staff
- POST `/admin/buylist/:id/inbound-shipment` · staff
- GET `/buylist/requests/:id/label.pdf` · cuenta
- POST `/shipments/quote` · cuenta
- POST `/shipments` · cuenta
- GET `/shipments` · cuenta
- GET `/shipments/:id` · cuenta

### shipping-provider
- GET `/geo/postal-codes/:cp` · público

### spend-alerts
- GET `/admin/spend-alerts` · staff
- GET `/admin/spend-alerts/summary` · staff
- GET `/admin/spend-alerts/:id` · staff
- POST `/admin/spend-alerts/seen` · staff

### uploads
- POST `/uploads/presign` · cuenta

### users
- PATCH `/users/me/email` · customer
- GET `/me/pendings` · cuenta
- GET `/users/me` · cuenta
- POST `/users/me/lock-notice/dismiss` · cuenta
- PATCH `/users/me` · cuenta
- GET `/users/me/addresses` · cuenta
- POST `/users/me/addresses` · cuenta
- PATCH `/users/me/addresses/:id` · cuenta
- DELETE `/users/me/addresses/:id` · cuenta
- GET `/users/me/billing-profile` · cuenta
- PUT `/users/me/billing-profile` · cuenta
- GET `/users/me/kyc` · cuenta
- PUT `/users/me/kyc` · cuenta

### vault
- GET `/admin/replacement-cases` · staff
- GET `/admin/replacement-cases/:id` · staff
- GET `/admin/replacement-cases/:id/refund-preview` · admin
- POST `/admin/replacement-cases/:id/replace` · staff
- POST `/admin/replacement-cases/:id/refund` · staff 💰
- POST `/admin/replacement-cases/:id/void` · staff 💰
- GET `/admin/vaults` · GET `/admin/vaults/:userId/master-sets` · GET `/admin/vaults/:userId/master-sets/:setId` · GET `/admin/vaults/:userId/sealed` · GET `/admin/vaults/:userId/physical-inventory` — todos staff
- PATCH `/admin/vault-placements/:placementId/prep-items/:placementItemId` · POST `/admin/vault-placements/:placementId/prepared` · DELETE `/admin/vault-placements/:placementId/prepared` · POST `/admin/vault-placements/:placementId/confirm` — todos staff
- GET `/vault/holdings` · GET `/vault/portfolio/history` · GET `/vault/master-sets` · GET `/vault/master-sets/:setId` · GET `/vault/sealed` · GET `/vault/holdings/:inventoryItemId` — todos cuenta

### wishlist
- GET `/wishlist` · GET `/wishlist/preview` · POST `/wishlist` · PATCH `/wishlist/:id` · DELETE `/wishlist/:id` · PUT `/wishlist/alerts` — todos cuenta
- POST `/wishlist/mail-actions` · público
- GET `/admin/reports/wishlist-demand` · GET `/admin/reports/wishlist-demand/export.csv` — admin
- **Siempre activa (HECHOS 2026-11-08; ARCHITECTURE §5.14).** Desaparecen: la clave `wishlistEnabled` de `GET/PUT /admin/settings` (PUT con ella ⇒ 422, clave desconocida), el `404 FEATURE_DISABLED` de las seis rutas de cuenta y el campo `wishlistEnabled` de `GET /catalog/cards/:cardId` (eliminado, no fijo `true`). Quedan `401`, `403` (staff sin correo), `404 NOT_FOUND` por `:id` ajeno y `400`. Los demás diales no cambian. Pruebas (mutar ⇒ rojo): WSH-ON-1 `GET /wishlist` con cuenta ⇒ 200 sin ningún dial; WSH-ON-2 ficha sin `wishlistEnabled`; WSH-ON-3 settings sin la clave y PUT ⇒ 422; WSH-ON-4 `wishlist-notify` envía respetando el tope diario; WSH-ON-5 la migración deja intactas `WishlistItem`/`WishlistNotice`. F1 Mi cuenta sin 404 en consola; F2 ficha con bloque sin leer campo del servidor; F3 M10 sin interruptor.

## 2. Reglas vigentes: alta rápida y cajón del binder (UX-ALTA-LIGA, opción A + A2; HECHOS 2026-11-05)
- **Acabado del alta:** al elegir «De liga», `POST /admin/inventory/items/batch` (campos opcionales `language`, `cardProductId`) lleva el `finish` de la versión de liga, nunca el de la casilla. Un solo acabado de liga ⇒ implícito; varios ⇒ el staff elige, sin preselección ni envío hasta elegir. Idioma aplica a toda carta raw; Versión solo si hay liga. Candado: IDS-F11 (a)–(c) (mutar: `finish` de la casilla en el POST); IDS-B32 (backend).
- **Cajón (piezas):** dos lecturas de `GET /admin/inventory/items`, tope 100: (1) la casilla (`cardId`+`finish`); (2) `stamped=true` sin `finish`, sin los acabados que ya son casilla. Idioma/Liga solo en cliente; «Piezas (n)» fijo y «Mostrando n de N». Casilla > 100 piezas ⇒ filtros en servidor (O-24). Candado: IDS-F11 (e).
- **Compra sugerida por versión (P-ARQ-IDS-3 cerrada, HECHOS 2026-11-06):** «Pagamos por pieza» abre con un SUGERIDO editable según la versión elegida; sin migración ni endpoint nuevo. **Fuente:** `GET /admin/inventory/cards/:cardId/versions` añade a cada combo `buySuggestedCents: number | null` (centavos MXN), calculado SOLO en backend. **Regla** (`B(R)` = curva de compra vigente, `pricing.buy.effectiveCents`, sobre la referencia de mercado `R` de `versionReferences`): `(en, sin liga)` = `B(R_en)` (con override manual/bounty de la carta; el resto usa la curva PURA: dueño 2026-11-06 «A) Del precio normal») · `(en, liga P)` = `B(R_P)` · `(es, sin liga)` = `scaleByPct(B(R_en), spanish_market_pct)` · `(es, liga P)` = `scaleByPct(B(R_P), spanish_market_pct)`. Orden fijo: curva y luego porcentaje (inglesa $60.00 ⇒ español $45.00 con pct 75). **Redondeo:** `scaleByPct` (`common/card-version.ts:255`, mitad hacia arriba); `pct` de `PricingService.loadSpanishMarketPct` (admin, 1–200, default 75). **`null`** (sin error) si no hay referencia (`R` sin precio/pending), la curva no da compra o `pct` es inválido; graduada o sellado ⇒ `null` en versiones ≠ (en, sin liga). **Escritura:** `items/batch` sin cambio; `acquisitionCostCents` = lo que el staff acepte; el sugerido no se guarda solo.
- **Pruebas de la compra sugerida (mutación ⇒ rojo):** IDS-B33 compra 6000 ⇒ es 4500; B34 pct 50 ⇒ 3000; B35 liga ⇒ `B(R_P)`; B36 sin referencia ⇒ `null`; B37 es+liga = `scaleByPct(B(R_P), pct)`. IDS-F12: el campo se prellena con `buySuggestedCents`, se re-prellena al cambiar de versión, `null` ⇒ vacío, y el POST envía lo que muestra.
- **P-PROMOS (ARCHITECTURE §5.12) / P-PROMOS-VIEJAS (§5.13):** `StampType` suma `event_promo`; `GroupedListingDetailResponse.pricePending:boolean`; `sync`/`refresh-variants` suman `promoSkipped?` y `pendingCards?`; sin endpoint nuevo. Pruebas PROMO-B1…B8, PEND-1, FLAKY-1/2, EMPTY-1, PV-B1…B9, PV-F1/F2 (mutar ⇒ rojo): detalle en `docs/specs/P_PROMOS.md`.
- **TL-A2-5 (decidido):** `removableCount` cuenta SIN filtros de Idioma/Liga (`bulk-remove` opera sobre toda la casilla). Prueba: 1 ES + 2 EN con filtro «Español» ⇒ 3 y la baja deja la casilla en 0.

## 3. D9 — comisión de plataforma dentro del precio (HECHOS:201; PENDIENTE DEL DUEÑO; no construir hasta decidir y publicar §DYN)
Sin rutas nuevas. Cambia el significado de campos existentes; detalle y opciones A/B en `docs/specs/D9_COMISION.md`.
- **Precio:** `displayPriceCents` (catálogo, ficha, carrito, JSON-LD/feeds) = precio ya con comisión, fijado por `ListingPrice` una vez al día. El cliente nunca calcula. Redondeo: **PENDIENTE (P2)**.
- **`POST /checkout/quote`, `/checkout/guest/quote`, `/checkout/session`, `/checkout/guest/session`, `GET /orders/:orderId`:** filas nuevas `totalCents = subtotalCents + shippingFeeCents` (sin gross-up); `processingFeeCents` deja de ser un renglón de cliente (no se expone; valor interno **PENDIENTE (P3)**). Pedidos previos conservan su desglose y su marca de convención (patrón IVA-3, `NOT NULL` sin `DEFAULT`; forma en `schema.prisma` **PENDIENTE (P3)**, la define el arquitecto).
- **`GET /checkout/shipping-rule`:** el umbral `freeFromCents` se compara con el subtotal exhibido (con comisión) — **PENDIENTE (P6)**. `POST /shipments/quote` y `POST /shipments` (envío de retiro): monto exhibido vs comisión absorbida — **PENDIENTE (P5)**.
- **Reembolsos:** carta = `P` pagado (sin `itemFeeShareCents` en filas nuevas); Stripe no devuelve su comisión. Concurrencia/idempotencia: total congelado en la sesión (`frozen-breakdown`); cambio de dial no altera sesiones abiertas.
- **Pruebas (mutar ⇒ rojo):** D9-1 `total = ΣP + envío` al centavo; D9-2 quote y session dan igual total; D9-3 pedido previo se reembolsa como antes; D9-4 ninguna cadena de UI/correo con «comisión de plataforma»; D9-5 feed/JSON-LD = `P`.

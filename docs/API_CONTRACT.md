# API_CONTRACT.md — TCG HUNT · API v1

> **Estado vigente.** Índice compacto **generado del código** el 2026-11-06 (`@Controller`/`@Get…`/`@Roles`/`@Public`
> de `backend/src/modules/**/*.controller.ts`; 349 endpoints). La versión normativa anterior (46 211 líneas, v1.117.3, con
> DTOs, enums y reglas por sección §0…§CTA) está congelada en `docs/archive/API_CONTRACT.md`: **buscar ahí con `grep -n`
> el bloque del endpoint** antes de cambiarlo. Los candados de paridad de mocks/enums leen esa copia (ver `docs/STATUS.md`).
> Propiedad: **arquitecto**. Manda `PROJECT.md` sobre este contrato y este contrato sobre el código.

## 0. Convenciones
- **Base**: `/api/v1`, REST/JSON. Fechas ISO-8601 UTC.
- **Auth**: `Authorization: Bearer <access>`. `JwtAuthGuard` es global: todo endpoint exige sesión salvo `@Public()`.
  Refresh en `POST /auth/refresh` (cookie httpOnly o body). Tres JWT distintos por forma y llave (access sin `typ`;
  refresh `typ:"refresh"`; device `typ:"device"`). Contraseña temporal ⇒ solo se permite cambiarla.
- **Roles** (columna «Rol»): `público` = sin token · `cuenta` = cualquier usuario autenticado · `customer` · `staff` =
  `vault_operator` o `super_admin` · `admin` = solo `super_admin`. 💰 = `@MoneyOut` (saca dinero; candado extra).
  Algunos endpoints suman permisos finos (`@RequirePermission`) o correo verificado (`@RequireEmailVerified`): ver el controlador.
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
- POST `/admin/catalog/sync` · admin
- POST `/admin/catalog/refresh-variants` · admin
- GET `/admin/catalog/refresh-variants-status` · admin
- POST `/admin/catalog/refresh-variants-all` · admin
- POST `/admin/catalog/sync-all` · admin
- POST `/admin/catalog/backfill` · admin
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
- GET `/admin/vaults` · staff
- GET `/admin/vaults/:userId/master-sets` · staff
- GET `/admin/vaults/:userId/master-sets/:setId` · staff
- GET `/admin/vaults/:userId/sealed` · staff
- GET `/admin/vaults/:userId/physical-inventory` · staff
- PATCH `/admin/vault-placements/:placementId/prep-items/:placementItemId` · staff
- POST `/admin/vault-placements/:placementId/prepared` · staff
- DELETE `/admin/vault-placements/:placementId/prepared` · staff
- POST `/admin/vault-placements/:placementId/confirm` · staff
- GET `/vault/holdings` · cuenta
- GET `/vault/portfolio/history` · cuenta
- GET `/vault/master-sets` · cuenta
- GET `/vault/master-sets/:setId` · cuenta
- GET `/vault/sealed` · cuenta
- GET `/vault/holdings/:inventoryItemId` · cuenta

### wishlist
- GET `/wishlist` · cuenta
- GET `/wishlist/preview` · cuenta
- POST `/wishlist` · cuenta
- PATCH `/wishlist/:id` · cuenta
- DELETE `/wishlist/:id` · cuenta
- PUT `/wishlist/alerts` · cuenta
- POST `/wishlist/mail-actions` · público
- GET `/admin/reports/wishlist-demand` · admin
- GET `/admin/reports/wishlist-demand/export.csv` · admin

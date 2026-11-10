# API_CONTRACT.md — TCG HUNT · API v1
> **Estado vigente.** Índice del código (2026-11-06, 349 endpoints). Versión normativa anterior (DTOs, enums, reglas) en
> `docs/archive/API_CONTRACT.md`: `grep -n` del endpoint ahí antes de cambiarlo (los candados de paridad leen esa copia). Manda `PROJECT.md` > este contrato > el código.
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
- **Webhooks Stripe**: `POST /webhooks/stripe` (público, firma obligatoria, idempotente por id de evento; eventos suscritos en `security/stripe-webhook-events.txt`).
- **Enums/DTOs**: `backend/prisma/schema.prisma`, `backend/src/common/enum-values.ts` y `backend/src/modules/<módulo>/dto/`.
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
- GET `/admin/finance/pnl` · admin · +`stripeFeeEstimatedOrders`, `stripeFeeEstimatedCents`, `feeIncludedSince` (solo-JSON; D9 §8.1)
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
- GET `/catalog/sitemap` · `/catalog/merchant-feed` (§GSHOP, spec `GOOGLE_SHOPPING_E_INDEXACION`) · público
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
- **§MKT-V2** (`docs/specs/MKT_PANEL_V2.md`): `pantalla` pasa a `r|a|b|c|d|e|f|g|h` (`r` = Resumen: `r1` cifras, `r2` avisos, `r3` diario solo exact/sesión; `c9`, `e2`; detalle spec §1). `r2` suma AV7 (§GSHOP).
- POST `/marketing/search-miss` · público · `{term≤80, kind:'card'|'sealed'}` ⇒ `204`; `413` si cuerpo >1 KB; `429` por throttle; sin eco, sin identificador (c6).
- Sin endpoint para el correo del lunes (job interno `marketing-weekly-digest`, idempotente por semana).

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
- **Siempre activa (HECHOS 2026-11-08; ARCHITECTURE §5.14).** Desaparecen: `wishlistEnabled` de `GET/PUT /admin/settings` (PUT con ella ⇒ 422), el `404 FEATURE_DISABLED` de las seis rutas de cuenta y `wishlistEnabled` de `GET /catalog/cards/:cardId`. Quedan `401`, `403` (staff sin correo), `404` por `:id` ajeno y `400`. Pruebas WSH-ON-1…5 (sin dial ⇒ 200; ficha y settings sin la clave; `wishlist-notify` con tope diario; migración no toca `WishlistItem`/`WishlistNotice`), F1…F3.

## 2. Reglas vigentes: alta rápida y cajón del binder (UX-ALTA-LIGA, opción A + A2; HECHOS 2026-11-05)
- **Acabado del alta y cajón:** `items/batch` suma `language?`, `cardProductId?` y lleva el `finish` de la liga elegida, nunca el de la casilla; el cajón lee `GET /admin/inventory/items` (tope 100). Regla y candados IDS-F11/B32: `docs/specs/IDS_COMPRA_SUGERIDA.md`.
- **Compra sugerida por versión (HECHOS 2026-11-06):** `GET /admin/inventory/cards/:cardId/versions` suma por combo `buySuggestedCents: number | null` (centavos, solo backend; el sugerido no se guarda solo). Regla, redondeo, `null` y pruebas IDS-B33…B37/F12: `docs/specs/IDS_COMPRA_SUGERIDA.md`.
- **P-PROMOS (ARCH §5.12/§5.13):** `StampType` suma `event_promo`; `GroupedListingDetailResponse.pricePending:boolean`; `sync`/`refresh-variants` suman `promoSkipped?`, `pendingCards?`. Pruebas y detalle: `docs/specs/P_PROMOS.md`.
- **TL-A2-5 (decidido):** `removableCount` cuenta SIN filtros de Idioma/Liga (`bulk-remove` opera sobre toda la casilla). Prueba: 1 ES + 2 EN con filtro «Español» ⇒ 3 y la baja deja la casilla en 0.

## 3. D9 — comisión de plataforma dentro del precio (HECHOS:201 y :272 «A en todo»; DECIDIDO; se construye tras publicar §DYN)
Sin rutas nuevas. `displayPriceCents` = `P = ceilPeso(M/(1−pct×(1+IVA)))` por unidad (carta 10000 → 10500); filas nuevas `totalCents = subtotalCents + shippingFeeCents`, `processingFeeCents = 0`, `feeConvention = FEE_INCLUDED` (`OrderDTO` la expone; `NOT NULL` sin default, filas viejas `FEE_ON_TOP`); `freeFromCents` se compara con el subtotal exhibido; retiro de bóveda = monto del dial sin gross-up. Esquema, textos es/en, criterios C1–C12 y pruebas D9-1…5: `docs/specs/D9_COMISION.md`.

## 4. PSA-ACABADO — estimado «si se gradea» por acabado (HECHOS 2026-11-09; dinero; `docs/specs/PSA_ACABADO.md`)
Sin rutas nuevas; aditivo salvo lo marcado:
- `GradedEstimateDTO` suma `finish: Finish`; acabado sin estimado ⇒ sin entrada (nunca la de otro).
- `GET /admin/pricing/graded-estimates/review`: cifras y tope ×raw del `finish` de la fila; `reason` suma `NO_RAW`, `LEGACY_MANUAL`; resumen suma `noFinishSplit:int`.
- **Cambio rompiente:** `POST /admin/pricing/override` con `intent:'graded_estimate'` exige `finish` (sin él ⇒ 400 `VALIDATION_ERROR`, `details.field='finish'`); `DELETE …/graded-estimates/:cardId/:gradeValue` exige query `finish` (igual 400; C-EQ-1: clase SELECTOR, dominio `Finish`) y borra solo ese acabado.
- Barrido graded: resultado de carta nuevo `no_finish_split` (proveedor sin separación y carta de 2+ acabados ⇒ sin estimado). Esquema: `PriceReference.estimateFinishScoped` (ver ARCHITECTURE §5.15). Pruebas PSA-B1…B10, F1…F3.

## 5. PROMOS-MASTERSET — descarga automática (HECHOS 2026-11-09; `docs/specs/PROMOS_MASTERSET.md`)
Sin rutas nuevas. `POST /admin/catalog/sync-all` (ambos botones) incluye siempre las 6 promos de `PTCG_PROMO_GROUPS` (sin corte de fecha; ya importadas se re-sincronizan) y los grupos TCGCSV (semilla `TCGCSV_IMPORTABLE_GROUPS` + descubiertos, §6; HTTP: solo `super_admin`, si no `skipped_needs_super_admin`; el job usa actor de sistema). `202` y `sync-status.summary` suman `promos:{sets:[{setId,status}],tcgcsv:[{groupId,status,created,updated,errorCode?}]}`. pokemontcg.io sin respuesta ⇒ ni promos ni TCGCSV (fail-closed). Pruebas PMS-B1…B10, F1/F2. Apartado «Promos de la colección» (decidido; liga INFERIDA, AUTO): las respuestas de Master Set (tienda, `/vault/master-sets/:setId`, `/admin/vaults/:userId/master-sets/:setId`, M1) suman `collectionPromos?:{items:MasterSetCardCellDTO[],owned,total}` aditivo (sellos siempre; Black Star solo `high` y con compuerta automática abierta; «x de y» propio, aprobado 2026-11-09; sin sesión solo `total`; celda de sello suma `cardProductId`,`stampType`,`stampLabel?`; `promos.gate:{open,n,k,f,expansions}`); `completedCount/totalCount/valor` no cambian. Detalle y pruebas B11…B17 en la spec §4–5.

## 6. AUTO — catálogo, promos, PSA y cuarentena sin dueño (HECHOS 2026-11-09; `docs/specs/AUTO_CATALOGO.md`)
Sin rutas nuevas. **ADITIVO:** `sync-status` suma `lastSuccessAt`, `lastTrigger`, `attempt`; `sync-all`/`summary.promos` suma `links` y `promos.discovery`; `promos.tcgcsv[]` suma `source:'seed'|'discovered'` y `status:'quarantined'`; `graded-estimates/review` suma `quarantined` y `quarantinedCount`; esquema `PromoCollectionLink` (ARCHITECTURE §5.17). **CAMBIO (sin ruta):** job con backoff; `syncAll` actor `user|system`; estimado PSA que falle cota dura ⇒ cuarentena; grupos TCGCSV elegibles aceptados (dudoso ⇒ `quarantined`; desconocido ⇒ 404 `TCGCSV_GROUP_UNKNOWN`). Detalle y pruebas AUTO-A…F: `docs/specs/AUTO_CATALOGO.md` («Contrato por endpoint»).

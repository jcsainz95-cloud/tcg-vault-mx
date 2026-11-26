# ARCHITECTURE.md — TCG HUNT

> **Estado vigente** (medido 2026-11-06). Versión anterior congelada en `docs/archive/ARCHITECTURE.md` (`grep -n "§4.NN"` cuando un comentario cite una sección). Endpoints: `docs/API_CONTRACT.md`; negocio: `PROJECT.md`.

## 1. Stack (medido 2026-11-06)
| Capa | Elección |
|---|---|
| Lenguaje | TypeScript en back y front; un solo repo con `backend/` y `frontend/` (sin Nx/Turbo) |
| Backend | NestJS 10 · Node 24 (imagen `node:24-alpine`) · prefijo `/api/v1` |
| ORM / BD | Prisma 5 · PostgreSQL 16 · 86 modelos, 98 enums, 83 migraciones |
| Colas / jobs / rate-limit | Redis 7 + BullMQ (repeatable jobs) · `@nestjs/throttler` |
| Auth | JWT access corto + refresh (cookie httpOnly o body) + device token; argon2; Google (`google-auth-library`) |
| Frontend | Next.js 15.5 (App Router) · React 18 · TanStack Query · next-intl 4 (ES por defecto, EN) · Tailwind · recharts · motion |
| Pagos | Stripe (PaymentIntents + webhooks firmados, idempotentes por `ProcessedStripeEvent`) |
| Envíos | Skydropx (`shipping-provider`), FedEx por CP + contenido del carrito (§5.21), captura manual de respaldo |
| Correo | Resend (adaptador `MailPort`; Noop fuera de producción) |
| Archivos | Cloudflare R2 (S3, URLs prefirmadas) solo para INE de KYC y fotos de accesorios; local: `scripts/s3-local` |
| Precios | Proveedores enchufables en `pricing/providers/`: PokemonPriceTracker v2, TCGCSV (singles y sellado), TCGdex, pokemontcg.io; FX Banxico |
| Catálogo | pokemontcg.io (datos en inglés) |
| Hosting | Frontend en **Vercel**, backend + Postgres + Redis en **Railway** (`railway.json`, healthcheck `/api/v1/health`, 1 réplica). Solo `production` despliega |

## 2. Estructura de carpetas
```
backend/src/
  main.ts, app.module.ts      # guards globales en orden: AppThrottler → JwtAuth → PasswordChangeRequired → Roles (+ EmailVerified, MoneyOut)
  common/                     # guards, decorators (@Public, @Roles, @MoneyOut, @RequireEmailVerified…), filtros de error,
                              # money.ts, pricing-curve.ts, robust-market.ts, enum-filter.ts (§0-Q), serializable-retry.ts, crypto/ (PII)
  config/                     # env.validation.ts (falla el arranque si falta/choca un secreto), master-set-groups.ts
  modules/                    # 27 módulos (ver §3)
  jobs/                       # scheduler + barridos: price-sync, price-ingest, sealed-price-ingest, set-price-sync, fx-refresh,
                              # buylist-sweep, order-reservation-sweep, auth-token-sweep, ine-retention, portfolio/set snapshots
backend/prisma/               # schema.prisma + migrations/ (zona compartida: un stream a la vez, pasa por arquitecto)
backend/test/                 # unitarias jest + integration/ (*.e2e-spec.ts contra Postgres real)
frontend/src/
  app/[locale]/(storefront)/  # portada, catalog, compra, sellado, accesorios, checkout, orders, vault, buylist, lista-de-deseos, decks-meta, guías, legales
  app/[locale]/(admin)/admin/ # m1 Inventario · m2 Catálogo y precios · m3 Ventas · m4 Pedidos por preparar · m5 Solicitudes de venta ·
                              # m6 Usuarios · m7 Finanzas · m8 (disputas, retirado) · m9 Reportes · m10 Configuración · m11 Sellado ·
                              # m12 Meta Battle Decks · refunds, manual-refunds, spend-alerts, codes, marketing, card-show, vaults, accessories
  app/[locale]/(auth)/        # login, registro, verificación, recuperación, termina tu cuenta
  components/                 # ui/ (Button, Input, Modal, DataTable, PriceTag, AmountBreakdown, StatusBadge…), domain/, layout/, master-set/, seo/
  lib/                        # api.ts (cliente HTTP monolítico, ~397 KB — deuda DT-API), api-client.ts, mock/, measurement/, seo, cart, money
  i18n/ + ../messages/{es,en}.json  # textos; paridad vigilada por i18n-parity.test.ts
  middleware.ts               # locale + rutas protegidas
scripts/  security/  .github/workflows/   # devops: stack local, candados de CI, SAST/DAST
```

## 3. Módulos backend y work streams
| Stream | Módulos (`backend/src/modules/`) |
|---|---|
| Catálogo y precios | `catalog`, `pricing`, `buylist`, `decks-meta`, `wishlist` |
| Órdenes y dinero 💰 | `orders`, `payments`, `shipments`, `shipping-provider`, `disputes`, `discounts`, `accessories`, `spend-alerts` |
| Inventario y bóveda 💰 | `inventory`, `vault`, `uploads` |
| Cuentas y acceso | `auth`, `users`, `settings`, `mail` |
| Admin, auditoría y marketing | `admin`, `audit`, `health`, `sales-analytics`, `marketing`, `measurement`, `card-show`, `demand` (§DEMANDA F1+F2: huecos de catálogo por búsquedas sin resultado; job `demand-match` diario 04:30 UTC, idempotente, 3 intentos con backoff exponencial; cuarentena/expiración solas, 0 intervención del dueño) |
Zonas compartidas (un stream a la vez): `backend/src/common/`, `backend/src/config/`, `backend/prisma/`,
`frontend/src/components/`, `frontend/src/lib/`, `frontend/src/hooks/`, `docs/API_CONTRACT.md`.

## 4. Esquema de BD (resumen por dominio; fuente: `backend/prisma/schema.prisma`)
- **Cuentas**: `User` (rol, `tokenVersion`, `mustChangePassword`, staff sin correo), `KycProfile` (INE/CLABE/RFC cifrados),
  `KycUploadGrant`, `BillingProfile`, `Address`, `PostalCode` (SEPOMEX), `AuthToken`, `UserPermission`.
- **Catálogo**: `CardSet`, `Card`, `CardProduct` (carta+acabado+idioma/sello), `SealedSetGroup`, `SealedProduct`, `StampedProductCandidate`.
- **Precios**: `PriceReference`, `VariantPriceOverride`, `PendingPriceEntry`, `PriceReviewCase`, `FxRate`, `ListingPrice`/`ListingPriceRun`
  (precio del día), `FeaturedSelection*`, `GradedEstimate*Scan`, `PortfolioSnapshot`, `SetValueSnapshot`.
- **Inventario/bóveda**: `InventoryItem` (folio `INV-000123`, titularidad `pending/settled`), `InventoryMovement`, `InventoryAdjustment`,
  `InventoryBatch` (Master Set por lote), `VaultLocation`, `VaultPlacement(Item)`.
- **Órdenes y dinero**: `Order`, `OrderItem`, `OrderAccessToken` (invitado), `OrderAccessoryLine`, `OrderEnergyBundleComponent`,
  `PaymentRefund`, `ManualRefund` (SPEI), `ReplacementCase` («Por reponer»), `ProcessedStripeEvent`, `Discount*`.
- **Envíos**: `ShipmentRequest`, `ShipmentItem`, `ShipmentQuote`, `ShipmentPaidLabel`, `ShipmentLabelAttempt`, `ShipmentCarrierEvent`,
  `ShipmentCostAdjustment`, `ShipmentAddressRevision`, `ShipmentAccessoryLine`, `ShippingPackage`, `ShippingZoneRate`, `ShippingQuoteLog`, `Spend*`.
- **Buylist**: `SellRequest`, `SellRequestItem`, `BuylistQuoteDailyCount`, `Dispute` (histórico; ya no se abren).
- **Otros**: `Accessory*`, `Wishlist*`, `SealedRestockSubscription`, `MetaDeck*`, `Marketing*`, `Measurement*`, `CardShow*`,
  `ConfigSetting` (diales M10), `AuditLog`. **Demanda (m112)**: `SearchDemandDaily` (carta×día, personas), `SearchDemandSeen` (dedupe carta×día×h), `DemandTermMatch` (término→cartas, re-evalúa a 30 d, máx. 5). Dueño: `modules/demand/`; excepción aceptada (patrón AL2-5): `marketing-search-miss.service.ts` hoy escribe `SearchDemandSeen`/`SearchDemandDaily` por SQL crudo (INSERT y purgas): viola la propiedad; backend debe moverlo a un servicio de `demand/` (decidido 2026-11-20, no se acepta como excepción).

## 5. Decisiones activas
1. **Dinero**: enteros en centavos MXN (`*Cents`), `currency = "MXN"`; aritmética solo en `common/money.ts` y servicios;
   el frontend **nunca multiplica** precios (candado `frontend-never-multiplies.test.ts`).
2. **Concurrencia de dinero**: transacciones `Serializable` con reintento (`serializable-retry.ts`, `503 BUSY_TRY_AGAIN`),
   escrituras condicionadas (`updateMany` con estado leído) y candados por clave; idempotencia en webhooks y conversión a inventario.
3. **Precio**: curva única por valor de mercado (`pricing-curve.ts`), mercado robusto multi-fuente (`robust-market.ts`),
   precio del día precalculado (`ListingPrice`), IVA dentro con dial de traslación. D9 (decidido 2026-11-09, `docs/specs/D9_COMISION.md`): la comisión de cobro va DENTRO de `ListingPrice`; marca `FeeConvention` (NOT NULL sin default) en `Order`/`ShipmentRequest`.
4. **Autorización**: `JwtAuthGuard` global (todo es privado salvo `@Public()`), `@Roles` por clase/método, `@MoneyOut` para
   salidas de dinero, `@RequireEmailVerified`, permisos finos en `UserPermission`; staff vs `super_admin` (dueño, `isOwner`).
5. **Filtros de enum en query (§0-Q)**: o filtra o `400 VALIDATION_ERROR` con `details.field/allowed`; nunca llega crudo a Prisma.
6. **Errores**: sobre `{ "error": { "code", "message", "details" } }`; códigos en `common/error-codes.ts`.
7. **PII**: cifrado AES-GCM (`crypto/pii-crypto.service.ts`, llaves `PII_*`), enmascarado en respuestas, reveal auditado; retención de INE por job.
8. **Diales de negocio** en `ConfigSetting` (M10), no en env. Env solo para secretos/infra (`env.validation.ts`, `.env.example`).
9. **i18n**: el backend devuelve códigos; el frontend traduce (next-intl). Marca en `common.brand.name`.
10. **Mocks de frontend** (`lib/mock/`) espejan el contrato; pruebas de paridad los vigilan.
11. **Despliegue**: Vercel + Railway publican al recibir push a `production`; migraciones con `scripts/db-migrate.sh`.
12. **Cartas de origen TCGCSV (P-PROMOS opción C; 1 migración aditiva: `StampType.event_promo`)**. Marca = prefijo `tcgcsv:` en `externalId` (set, carta); un `CardProduct set_base` por carta; helper `isTcgcsvOrigin`. Semilla `TCGCSV_IMPORTABLE_GROUPS` + grupos descubiertos (§5.17). Guardia fail-closed contra la lista viva de pokemontcg.io (503/409); tx con advisory lock, idempotente; sin precio ⇒ `PRICE_PENDING`. Detalle: `docs/specs/ARQ_PROMOS_VIEJAS.md`.
13. **Promos viejas de pokemontcg.io (P-PROMOS-VIEJAS; extiende §5.12; SIN migración).** Tabla fija `PTCG_PROMO_GROUPS` (`promo-set-groups.ts`: svp→22872, swshp→2545, smp→1861, xyp→1451, bwp→1407, dpp→1421) con precedencia tabla > `pptSetId` > nombre; `PromoSetProductsService` (todo-o-nada por set, `upsert` por `tcgplayerProductId`, `promoNumberKey`, unión `set_base`/`stamped`, re-sync en una tx, `stale_in_use`); un sello nunca hereda el precio de la plana. Ver `docs/specs/ARQ_PROMOS_VIEJAS.md`.
14. **Lista de deseos siempre activa (HECHOS 2026-11-08; sin cambio de esquema).** Sin `WISHLIST_ENABLED`; `…_wsh_always_on` borra su clave de `ConfigSetting`.
15. **Estimado PSA por acabado (HECHOS 2026-11-09; sustituye §4.38a; `docs/specs/PSA_ACABADO.md`).** La clave de `PriceReference` ya incluye `finish` (`schema.prisma:1432`): el escritor graded deja de fijar `normal` y escribe el acabado real. Migración aditiva `PriceReference.estimateFinishScoped BOOLEAN NOT NULL DEFAULT false` (el escritor nuevo la fija `true` en create y update) y `GradedCardScanOutcome` suma `no_finish_split`. Filas viejas automáticas se borran en la tx que escribe las nuevas; manuales valen solo para el acabado principal; un helper junto a `MONEY_REF_WHERE` filtra lecturas. Proveedor sin separación (`finishScope='card_level'`) ⇒ solo cartas de acabado único. Tope ×raw y gancho de grading usan el raw del MISMO acabado.
16. **Promos en la actualización del catálogo (2026-11-09; `docs/specs/PROMOS_MASTERSET.md`).** `selectSyncAllCandidates` trata siempre como candidatos los ids de `PTCG_PROMO_GROUPS` (sin corte de fecha, re-sync aunque `force=false`, solo si están en la lista viva de pokemontcg.io); tras el recorrido, `sync-all` llama `TcgcsvSetImportService` por cada grupo de `TCGCSV_IMPORTABLE_GROUPS` (misma guardia fail-closed y lock; fallo por grupo no aborta; `super_admin` requerido). Apartado «Promos de la colección» bajo el Master Set (propio «x de y»; fuera de conteo, % y `SetValueSnapshot`): sellos por su carta lisa sin datos nuevos; Black Star/ETB por la inferencia de §5.17 (sin tabla manual).
17. **AUTO — nada depende del dueño (HECHOS 2026-11-09; `docs/specs/AUTO_CATALOGO.md`).** (A) Job `catalog-metadata-sync` (01:00 UTC, `scheduler.service.ts`) con backoff (6 intentos); `syncAll` con actor `user|system` (`system` audita `actorUserId=null`, no alcanzable por HTTP). (F) `TcgcsvGroupDiscoveryService.evaluate(groupId)` (puro) decide elegible/cuarentena/ignorado; máx. 2 nuevos por corrida. (B) Migración aditiva `PromoCollectionLink` (caché recalculada al final de `syncAll`; solo confianza `high` se publica). (C) Barrido PSA dentro de `price-ingest`. (D) Cuarentena: helper único al leer las cotas duras (§5.15); sin estado guardado.
18. **Panel de Marketing v2 (HECHOS 2026-11-09; `docs/specs/MKT_PANEL_V2.md`).** Pantalla `r` en el mismo `screen()` con `privacy` obligatorio; `r3` (diario) solo con `'exact'`. Migración aditiva `m99`: `SearchNoResultDaily` (c6) y `MarketingWeeklyDigest` (PK `weekStart`, idempotencia del correo del lunes, job con `ownerRecipients`). Tráfico propio: prefijo en `internal-traffic.ts` (copia en front), bandera `tcg_int`, filtro `notExpression` en `ga4Report`. Avisos puros en `marketing-alerts.ts`. 19. **Portal de proveedores (HECHOS 2026-11-12; `docs/DECISIONES.md` §PROV).** Módulo `supplier-portal`, tablas propias (`Supplier*`/`Supply*`), rol `supplier` default-deny; no reutiliza `SellRequest`. 20. **Entregado en persona (HECHOS 2026-11-18; `docs/DECISIONES.md` §PERSONA).** Método propio `ShipmentsService.deliverInPerson` (⛔ no se abre `TRANSITIONS`). Migración aditiva: `ShipmentLabelSource` suma `in_person`; CHECK `shipment_delivered_notice_skydropx_only` recreado. Retiro: `withdrawn` en `enviado` (§RETIRO-SALIDA). 21. **Envío por CP (HECHOS 2026-11-19; `docs/DECISIONES.md` §ENV3).** `POST /checkout/shipping-quote` deriva el perfil del carrito en servidor; caché Redis 6 h; timeout Skydropx 6 s, disyuntor y respaldo `ShippingZoneRate` por prefijo de CP; `quoteId` HMAC 30 min congela el cobro en `Order.shippingQuoteSnapshot`. Migración aditiva; diales `ship_*`; reversa `ship_v3_enabled=off`. 22. **Reportes CEO (HECHOS 2026-11-22/23; `docs/DECISIONES.md` §REPORTES-CEO; `API_CONTRACT_REPORTES.md`).** Lectura al abrir, sin jobs; periodo en hora de México (`common/report-period.ts`); P&L por línea = `pnlBuckets` + reparto por pedido con mayor residuo; gastos fijos: `FixedCostConcept`/`FixedCostAmount` solo-inserción (migración aditiva F3); `Order` sin cambios. 23. **Origen de visita (`DECISIONES.md` §ORIGEN-VISITA).** sessionStorage en front; saneador en back; columnas `visit*` aditivas en `Order`/`SellRequest`.

## 6. Seguridad (arquitectura)
JWT con forma y llave por tipo (access sin `typ`, refresh `typ:refresh`, device HKDF); `JWT_ACCESS_SECRET ≠ JWT_REFRESH_SECRET` o no arranca. Helmet + CSP (hoy `report-only`). Throttle global y por actor (login, cotizador). Presign solo de prefijos permitidos y bucket privado. `$queryRawUnsafe`: 2 usos, ambos constantes o parametrizados (`prisma/prisma.service.ts`, folios; medido 2026-11-06). Repo público: secretos solo en Railway/Vercel/GitHub.

## 7. Riesgos técnicos vigentes
Ver `docs/STATUS.md` (deuda y hallazgos abiertos). Los más estructurales: `frontend/src/lib/api.ts` monolítico; ~35 candados de paridad leen la copia congelada `docs/archive/` (el contrato vivo ya no los alimenta); 1 réplica en Railway (throttle en memoria).

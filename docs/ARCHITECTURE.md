# ARCHITECTURE.md — TCG HUNT

> **Estado vigente.** Destilado el 2026-11-06 midiendo el código (`package.json`, `schema.prisma`, controladores,
> `app.module.ts`). La versión anterior (37 106 líneas, §0…§16 con todos los diseños por release) está congelada en
> `docs/archive/ARCHITECTURE.md`: buscar ahí con `grep -n "§4.NN"` cuando un comentario del código cite una sección.
> Propiedad: **arquitecto**. Endpoints en `docs/API_CONTRACT.md`; negocio en `PROJECT.md`.

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
| Envíos | Skydropx (`shipping-provider`) con captura manual de respaldo |
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
| Admin, auditoría y marketing | `admin`, `audit`, `health`, `sales-analytics`, `marketing`, `measurement`, `card-show` |
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
  `ShipmentCostAdjustment`, `ShipmentAddressRevision`, `ShipmentAccessoryLine`, `ShippingPackage`, `Spend*`.
- **Buylist**: `SellRequest`, `SellRequestItem`, `BuylistQuoteDailyCount`, `Dispute` (histórico; ya no se abren).
- **Otros**: `Accessory*`, `Wishlist*`, `SealedRestockSubscription`, `MetaDeck*`, `Marketing*`, `Measurement*`, `CardShow*`,
  `ConfigSetting` (diales M10 en BD, sin deploy), `AuditLog`.

## 5. Decisiones activas
1. **Dinero**: enteros en centavos MXN (`*Cents`), `currency = "MXN"`; aritmética solo en `common/money.ts` y servicios;
   el frontend **nunca multiplica** precios (candado `frontend-never-multiplies.test.ts`).
2. **Concurrencia de dinero**: transacciones `Serializable` con reintento (`serializable-retry.ts`, `503 BUSY_TRY_AGAIN`),
   escrituras condicionadas (`updateMany` con estado leído) y candados por clave; idempotencia en webhooks y conversión a inventario.
3. **Precio**: curva única por valor de mercado (`pricing-curve.ts`), mercado robusto multi-fuente (`robust-market.ts`),
   precio del día precalculado (`ListingPrice`), IVA dentro con dial de traslación. D9 (pendiente, `docs/specs/D9_COMISION.md`): la comisión de cobro irá DENTRO de `ListingPrice`.
4. **Autorización**: `JwtAuthGuard` global (todo es privado salvo `@Public()`), `@Roles` por clase/método, `@MoneyOut` para
   salidas de dinero, `@RequireEmailVerified`, permisos finos en `UserPermission`; staff vs `super_admin` (dueño, `isOwner`).
5. **Filtros de enum en query (§0-Q)**: o filtra o `400 VALIDATION_ERROR` con `details.field/allowed`; nunca llega crudo a Prisma.
6. **Errores**: sobre `{ "error": { "code", "message", "details" } }`; códigos en `common/error-codes.ts`.
7. **PII**: cifrado AES-GCM (`crypto/pii-crypto.service.ts`, llaves `PII_*`), enmascarado en respuestas, reveal auditado; retención de INE por job.
8. **Diales de negocio** en `ConfigSetting` (M10), no en env. Env solo para secretos/infra (`env.validation.ts`, `.env.example`).
9. **i18n**: el backend devuelve códigos; el frontend traduce (next-intl). Marca en `common.brand.name`.
10. **Mocks de frontend** (`lib/mock/`) espejan el contrato; pruebas de paridad los vigilan.
11. **Despliegue**: Vercel + Railway publican al recibir push a `production`; migraciones con `scripts/db-migrate.sh`.
12. **Cartas de origen TCGCSV (P-PROMOS opción C; 1 migración aditiva: `StampType.event_promo`)**. Marca = prefijo en `externalId` (sin columna `source`): `CardSet.externalId = "tcgcsv:<groupId>"` (+ `tcgcsvGroupId` y `pptSetId = "<groupId>"`), `Card.externalId = "tcgcsv:<productId>"` y `Card.tcgplayerId = "<productId>"`, un `CardProduct` `set_base` por carta (`tcgplayerProductId` @unique = productId, `sourceGroupId`); helper único `isTcgcsvOrigin(externalId)`, ningún `startsWith` suelto. **Parseo** (`parseTcgcsvCardName`, puro; sello de lista cerrada ⇒ `stampType`+`stampLabel`, producto aparte fuera del binder; solo `(30th Celebration)` queda en `Card.name`; otro ⇒ `unknown_stamp`): detalle en `docs/specs/P_PROMOS.md`. **Sin base plana:** el producto con sello se promueve a CARTA PROPIA (`Card` + `CardProduct set_base`, sello en `name`: «Miraidon (Pitch Black Stamped)» #082) y su [Staff] cuelga de ella; `no_base` solo si no hay carta a la que colgar (~0); `ambiguous_base` ⇒ reportado, nada se crea. Topes (PRM-3: 5 MB, 2000 productos, longitudes) e imagen: spec. **Disparo:** admin, por grupo. Lista explícita `TCGCSV_IMPORTABLE_GROUPS = [{groupId:24451, ptcgSetIds:['mep']}]`; fuera de la lista ⇒ 404 `TCGCSV_GROUP_UNKNOWN`. **Guardia fail-closed:** antes de escribir se lee la lista VIVA de sets de pokemontcg.io (≤3 reintentos, ≤10 s en total; caché 24 h del último resultado bueno); 200 con `data` ausente/vacío = sin respuesta; sin respuesta y sin caché ⇒ 503 `POKEMONTCG_UNAVAILABLE`, 0 filas; si algún `ptcgSetIds` o nombre igual ya existe allí ⇒ 409 `TCGCSV_GROUP_COVERED`. **Atomicidad (PRM-1/2):** la red se baja ANTES de la transacción; `prisma.$transaction(tx=>…, {maxWait:5000, timeout:60000})` con `pg_try_advisory_xact_lock(hashtext('tcgcsv-import'), groupId)` primero: sin lock ⇒ 409 `TCGCSV_IMPORT_IN_PROGRESS`; error o timeout ⇒ rollback (503 `TCGCSV_IMPORT_FAILED`). Idempotente (`upsert` por externalId/productId); productId ya ligado a otra carta ⇒ omitido. **Sombra:** detección por SET: `sync`/`sync-all`/`upsertCards` de un set en `ptcgSetIds` mientras exista el local `tcgcsv:<groupId>` NO crean ni mueven nada (`warn` + `AuditLog catalog.tcgcsv_shadowed`, informado en la respuesta); `sync-all` nunca recorre `tcgcsv:`. Sin precio ⇒ `PRICE_PENDING` (sale-decision.service.ts:477). Migración `ALTER TYPE "StampType" ADD VALUE 'event_promo'` (aditiva). Rollback: borrar filas `tcgcsv:` sin piezas/pedidos (FK Restrict).
13. **Promos viejas de pokemontcg.io (P-PROMOS-VIEJAS; extiende §5.12; SIN migración).** Tabla fija `PTCG_PROMO_GROUPS` (`promo-set-groups.ts`: svp→22872, swshp→2545, smp→1861, xyp→1451, bwp→1407, dpp→1421) con precedencia tabla > `pptSetId` > nombre; `PromoSetProductsService` (todo-o-nada por set, `upsert` por `tcgplayerProductId`, `promoNumberKey`, unión `set_base`/`stamped`, re-sync en una tx, `stale_in_use`); un sello nunca hereda el precio de la plana. Detalle completo: `docs/specs/ARQ_PROMOS_VIEJAS.md`.
14. **Lista de deseos siempre activa (HECHOS 2026-11-08; sin cambio de esquema).** Se elimina `WISHLIST_ENABLED` (constante, default, validador, DTO), el `FEATURE_DISABLED` de `WishlistService` y el no-op de `WishlistNotifyService`. Migración `…_wsh_always_on`: `DELETE FROM "ConfigSetting" WHERE key='wishlist_enabled'` (idempotente, solo configuración; M-74 no se edita). Reversa: basta revertir el código (clave ausente ⇒ default `off`). `wishlist-notify` corre siempre; sin listas previas no hay correos.
15. **Estimado PSA por acabado (HECHOS 2026-11-09; sustituye §4.38a; `docs/specs/PSA_ACABADO.md`).** La clave de `PriceReference` ya incluye `finish` (`schema.prisma:1432`): el escritor graded deja de fijar `normal` y escribe el acabado real. Migración aditiva `PriceReference.estimateFinishScoped BOOLEAN NOT NULL DEFAULT false` (el escritor nuevo la fija `true` en create y update) y `GradedCardScanOutcome` suma `no_finish_split`. Filas viejas: automáticas no se leen y se borran en la misma tx que escribe las nuevas; manuales valen solo para el acabado principal. Un helper único junto a `MONEY_REF_WHERE` filtra las lecturas. Proveedor sin separación (`finishScope='card_level'`, valor por omisión hasta medir) ⇒ solo cartas de acabado único; el resto «sin estimado». Tope ×raw y gancho de grading usan el raw del MISMO acabado. Reversa: revertir código; filas nuevas inertes.
16. **Promos en la actualización del catálogo (HECHOS 2026-11-09; sin esquema; `docs/specs/PROMOS_MASTERSET.md`).** `selectSyncAllCandidates` trata siempre como candidatos los ids de `PTCG_PROMO_GROUPS` (sin corte de fecha, re-sync aunque `force=false`, solo si están en la lista viva de pokemontcg.io); tras el recorrido, `sync-all` llama `TcgcsvSetImportService` por cada grupo de `TCGCSV_IMPORTABLE_GROUPS` (misma guardia fail-closed y lock; fallo por grupo no aborta; `super_admin` requerido). Apartado «Promos de la colección» bajo el Master Set (vista con su propio «x de y»; no entra en conteo, % ni `SetValueSnapshot`): sellos por su carta lisa sin datos nuevos; Black Star/ETB por la inferencia de §5.17 (sin tabla manual).
17. **AUTO — nada depende del dueño (HECHOS 2026-11-09; `docs/specs/AUTO_CATALOGO.md`).** (A) Job `catalog-metadata-sync` (01:00 UTC, ya existe en `scheduler.service.ts`) aguarda el barrido y reintenta con backoff exponencial (6 intentos); `syncAll` recibe actor `user|system`; el paso TCGCSV con `system` corre solo sobre `TCGCSV_IMPORTABLE_GROUPS` y audita con `actorUserId=null` (`metadata.actor='system'`); el actor `system` no es alcanzable por HTTP. (B) Migración aditiva `PromoCollectionLink{promoCardId @unique, expansionSetId, confidence high|low, evidence Json, computedAt}`: caché derivada, recalculada al final de cada `syncAll` bajo `pg_try_advisory_xact_lock('promo-link')`; señal 1 = misma carta (nombre+HP+ataques, exacto), señal 2 = ventana de `productId` (hipótesis NO MEDIDA, nunca da `high` sola); solo `high` se publica. (C) El barrido PSA va dentro de `price-ingest` (un vuelo, tope diario de créditos); el selector prioriza cartas sin fila `estimateFinishScoped`. (D) Cuarentena: helper único que evalúa al leer las cotas duras sobre estimados automáticos (junto al predicado de §5.15); sin estado guardado, re-chequeo = siguiente ingesta.
## 6. Seguridad (arquitectura)
JWT con forma y llave por tipo (access sin `typ`, refresh `typ:refresh`, device HKDF); `JWT_ACCESS_SECRET ≠ JWT_REFRESH_SECRET` o no arranca. Helmet + CSP (hoy `report-only`). Throttle global y por actor (login, cotizador). Presign solo de prefijos permitidos y bucket privado. `$queryRawUnsafe`: 2 usos, ambos constantes o parametrizados (`prisma/prisma.service.ts`, folios; medido 2026-11-06). Repo público: secretos solo en Railway/Vercel/GitHub.

## 7. Riesgos técnicos vigentes
Ver `docs/STATUS.md` (deuda y hallazgos abiertos). Los más estructurales: `frontend/src/lib/api.ts` monolítico; ~35 candados de paridad leen la copia congelada `docs/archive/` (el contrato vivo ya no los alimenta); 1 réplica en Railway (throttle en memoria).

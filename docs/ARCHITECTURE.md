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
   precio del día precalculado (`ListingPrice`), IVA dentro con dial de traslación.
4. **Autorización**: `JwtAuthGuard` global (todo es privado salvo `@Public()`), `@Roles` por clase/método, `@MoneyOut` para
   salidas de dinero, `@RequireEmailVerified`, permisos finos en `UserPermission`; staff vs `super_admin` (dueño, `isOwner`).
5. **Filtros de enum en query (§0-Q)**: o filtra o `400 VALIDATION_ERROR` con `details.field/allowed`; nunca llega crudo a Prisma.
6. **Errores**: sobre `{ "error": { "code", "message", "details" } }`; códigos en `common/error-codes.ts`.
7. **PII**: cifrado AES-GCM (`crypto/pii-crypto.service.ts`, llaves `PII_*`), enmascarado en respuestas, reveal auditado; retención de INE por job.
8. **Diales de negocio** en `ConfigSetting` (M10), no en env. Env solo para secretos/infra (`env.validation.ts`, `.env.example`).
9. **i18n**: el backend devuelve códigos; el frontend traduce (next-intl). Marca en `common.brand.name`.
10. **Mocks de frontend** (`lib/mock/`) espejan el contrato; pruebas de paridad los vigilan.
11. **Despliegue**: Vercel + Railway publican al recibir push a `production`; migraciones con `scripts/db-migrate.sh`.
12. **Cartas de origen TCGCSV (P-PROMOS opción C; sin migración)**. Marca = prefijo en `externalId` (no hay columna `source`; pokemontcg.io nunca usa `:`): `CardSet.externalId = "tcgcsv:<groupId>"` (+ `tcgcsvGroupId` y `pptSetId = "<groupId>"`), `Card.externalId = "tcgcsv:<productId>"` y `Card.tcgplayerId = "<productId>"`, un `CardProduct` `set_base` por carta (`tcgplayerProductId` @unique = productId, `sourceGroupId`); helper único `isTcgcsvOrigin(externalId)`, ningún `startsWith` suelto. **Parseo** (`parseTcgcsvCardName`, puro): número = `ExtendedData.Number` (antes de `/`); si falta, 1-3 dígitos(+letra) finales del nombre; discrepancia ⇒ se omite y reporta; sin `Number` ⇒ se omite siempre (`no_number`, incluye sellado). Sello = sufijo `[…]` o `(…)` ⇒ `stampType` (Staff→staff, Prerelease→prerelease, Winner/Championship/Campeonato→championship) y `stampLabel` = texto crudo (producto aparte, fuera del binder). ÚNICO paréntesis que se conserva en `Card.name`: `(30th Celebration)` (constante `KEEP_PARENS`, comparación sin mayúsculas). Cualquier otro `(…)`/`[…]` no listado (Pitch Black Stamped, Pokemon Center Exclusive…) ⇒ omitido, `unknown_stamp`, nunca carta normal ni `other`. `no_base`/`ambiguous_base` (p. ej. los 5 [Staff] 017/082/083/084/085) ⇒ reportados, no se crea nada. Topes (PRM-3): respuesta upstream ≤ 5 MB y ≤ 2000 productos (si no ⇒ 502 `UPSTREAM_ERROR`); `name` ≤ 200, `number` ≤ 16, `rarity`/`stampLabel` ≤ 64 (si no ⇒ fila omitida `field_too_long`); rareza = `ExtendedData.Rarity`. Ej.: «Pikachu ex 107 (30th Celebration)» ⇒ name «Pikachu ex (30th Celebration)», #107; «Paradise Resort 092 [Staff]» ⇒ `CardProduct stamped` staff colgado de la base «Paradise Resort» #092 del MISMO set solo si es única (como `baseMatchKey` de liga); si no, omitido y reportado. **Imagen:** del `imageUrl` de TCGCSV `_200w` → `_in_1000x1000` (large), small = `_200w` solo para miniaturas de lista; binder y ficha leen large (ya no `_200w`) (misma regla que sellado; 200 OK medido solo en sellado, en cartas NO MEDIDO). **Disparo:** admin, por grupo. Lista explícita `TCGCSV_IMPORTABLE_GROUPS = [{groupId:24451, ptcgSetIds:['mep']}]` (id de pokemontcg.io NO MEDIDO: backend lo verifica contra `/sets`); `groupId` fuera de la lista ⇒ 404 `TCGCSV_GROUP_UNKNOWN`. Se retira `matchTcgcsvGroupByName` (33/176 sets reales no casan). **Guardia fail-closed:** antes de escribir se lee la lista VIVA de sets de pokemontcg.io (no los sets locales); sin respuesta/timeout ⇒ 503 `POKEMONTCG_UNAVAILABLE`, 0 filas; si algún `ptcgSetIds` (o nombre normalizado igual al del grupo) ya existe allí ⇒ 409 `TCGCSV_GROUP_COVERED`. **Atomicidad (PRM-1/2):** todo lo que viene de red (productos y precios) se baja ANTES de abrir la transacción; luego `prisma.$transaction(tx=>…, {maxWait:5000, timeout:60000})` con `pg_try_advisory_xact_lock(hashtext('tcgcsv-import'), groupId)` como primera sentencia: si no lo obtiene ⇒ 409 `TCGCSV_IMPORT_IN_PROGRESS` inmediato (sin esperar, 1 sola conexión por petición, nunca 2); todas las escrituras van por `tx` (set, cartas, productos, AuditLog); cualquier error o timeout ⇒ rollback total (503 `TCGCSV_IMPORT_FAILED`). Idempotente: `upsert` por externalId/productId; productId ya ligado a otra carta ⇒ omitido y reportado. **Reconciliación/sombra (sin depender de URL):** la detección es por SET, no por carta: `sync`/`sync-all`/`upsertCards` de un set cuyo id esté en `ptcgSetIds` mientras exista el set local `tcgcsv:<groupId>` NO crean ni mueven nada: se omite ese set, `warn` + `AuditLog catalog.tcgcsv_shadowed` y se informa en la respuesta del sync; `sync-all` nunca recorre `tcgcsv:`. Fusión = decisión del arquitecto. Pruebas con mutación (cada una roja al quitar la regla): pokemontcg.io caído ⇒ 503 y 0 filas; grupo 22872/24722 ⇒ 404; sync de `mep` con set local ⇒ 0 cartas nuevas + aviso; `$transaction` quitada o muerte a mitad ⇒ 0 filas; N=30 simultáneos con pool 5 ⇒ 1×200, 29×409, 0×500; paréntesis desconocido ⇒ `unknown_stamp`. Precio/acabados por `tcgplayerProductId` con proveedor TCGCSV y reconciliador vigentes; sin precio ⇒ `PRICE_PENDING` (sale-decision.service.ts:477). Rollback: sin migración; borrar filas `tcgcsv:` sin piezas/pedidos (FK Restrict las protege).

## 6. Seguridad (arquitectura)
JWT con forma y llave por tipo (access sin `typ`, refresh `typ:refresh`, device HKDF); `JWT_ACCESS_SECRET ≠ JWT_REFRESH_SECRET` o no arranca. Helmet + CSP (hoy `report-only`). Throttle global y por actor (login, cotizador). Presign solo de prefijos permitidos y bucket privado. `$queryRawUnsafe`: 2 usos, ambos constantes o parametrizados (`prisma/prisma.service.ts`, folios; medido 2026-11-06). Repo público: secretos solo en Railway/Vercel/GitHub.

## 7. Riesgos técnicos vigentes
Ver `docs/STATUS.md` (deuda y hallazgos abiertos). Los más estructurales: `frontend/src/lib/api.ts` monolítico; ~35 candados de paridad leen la copia congelada `docs/archive/` (el contrato vivo ya no los alimenta); 1 réplica en Railway (throttle en memoria).

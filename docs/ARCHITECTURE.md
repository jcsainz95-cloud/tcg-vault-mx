# ARCHITECTURE.md — Marketplace TCG con Bóveda (Pokémon, México)

> Propiedad: **arquitecto**. Fuente de verdad de decisiones técnicas y modelo de datos.
> Manda `PROJECT.md` sobre este documento, y este documento sobre el código.
> Estado: v1.3 (MVP, plataforma en producción). Fecha: 2026-08-16. Branch: `claude/tcg-cards-marketplace-oijthj`.
>
> **Changelog v1.5-auth-email (2026-08-16)** — **Verificación de correo + recuperación de contraseña
> self-service por email** (proveedor **Resend**). Decisiones de producto ya cerradas por el humano:
> - **La verificación NO bloquea el login** — bloquea **acciones sensibles**. Un usuario con `emailVerified=false`
>   **puede iniciar sesión y navegar**, pero un guard server-side (**autoridad**, no solo UI) rechaza
>   **comprar** (`POST /checkout/session`), **retirar/enviar** (`POST /shipments`) y **vender**
>   (`POST /buylist/requests`) con **`403 EMAIL_NOT_VERIFIED`**. Cuentas Google entran con `emailVerified=true`
>   (no afectadas). Nuevo `EmailVerifiedGuard` + decorador `@RequireEmailVerified()` (§4.11, §7).
> - **Recuperación: AMBOS flujos.** (a) **Self-service** nuevo: `POST /auth/forgot-password` (siempre `200`,
>   anti-enumeración) → email con link → `POST /auth/reset-password`. (b) Se **conserva** el reset por admin
>   existente (`POST /admin/users/:id/reset-password`, §4.7bis). Ambos **incrementan `User.tokenVersion`**
>   (revocan sesiones, patrón existente).
> - **Modelo de tokens (nuevo `AuthToken`, MIGRACIÓN M-17):** tabla de tokens de **un solo uso**, `type`
>   (`email_verification | password_reset`), `userId`, **hash** del token (SHA-256; **nunca** el token en claro
>   en BD — el claro viaja solo por correo), `expiresAt`, `usedAt`. Expiraciones: verificación **24h**, reset
>   **1h**. Ver §3.2 (AuthToken) y §4.11.
> - **Abstracción de correo (nuevo módulo `mail`):** puerto `MailPort` (token DI `MAIL_PORT`) + adaptador
>   `ResendMailAdapter` (prod) y `NoopMailAdapter` (local/CI/tests sin key: loguea el email y el link).
>   `MailService` construye las plantillas (verificación / recuperación), bilingües por `User.locale`.
> - **Endpoints nuevos (auth):** `POST /auth/verify-email/resend`, `POST /auth/verify-email`,
>   `POST /auth/forgot-password`, `POST /auth/reset-password`. El registro email/password **emite** el token de
>   verificación y envía el correo. El objeto `user` de `/auth/register|login|google` ahora incluye
>   `emailVerified` (ya expuesto en `/users/me`). Ver `API_CONTRACT §1`.
> - **Env nuevas:** `RESEND_API_KEY` (secreto, **requerida en no-local** — staging+prod), `MAIL_FROM`
>   (default `no-reply@tcgvaultmx.com`). En LOCAL_ENVS sin key → `NoopMailAdapter` (degrada con aviso). Ver §8.
> - **Migración M-17** (§11). Jobs: `auth-token-sweep` (limpia tokens expirados).
>
> **Changelog v1.4-finance (2026-08-16)** — **Costo real de paquetería en el P&L** (PROJECT.md requisito #3,
> §M7 / criterio 21). Hoy el P&L trata el envío **solo como ingreso** (`shippingFeeCents` = lo que el cliente
> nos paga) y **nunca** resta el **costo real que la plataforma paga a la paquetería**, sobreestimando la
> ganancia. Se corrige:
> - **Modelo:** `ShipmentRequest` gana **`shippingCostCents` `Int @default(0)`** = costo real MXN (centavos)
>   que la plataforma paga al carrier por ese envío. Aditivo, default 0 para filas históricas/no capturadas.
>   **Migración M-16** (§11). NO se toca `shippingFeeCents` (sigue siendo el **ingreso** cobrado al cliente).
> - **Captura (M4):** el operador captura `shippingCostCents` (opcional, editable) al **asignar carrier/guía**
>   en `POST /admin/shipments/:id/tracking` (el DTO gana el campo; entero ≥ 0). Ver `API_CONTRACT §M4`.
> - **P&L (M7):** la fórmula separa **ingreso** vs **costo** de envío:
>   `profitCents = incomeCents + shippingRevenueCents − cogsCents − stripeFeesCents − shippingCostCents`.
>   La clave `shippingCents` (ingreso) se **renombra** a `shippingRevenueCents` y se **añade** `shippingCostCents`
>   (decisión de naming: `shippingRevenueCents` elimina la ambigüedad de dos claves de envío; ver §12 y
>   `API_CONTRACT §M7`). Es un **breaking change**: M7 **sí** tiene consumidor de frontend real y montado
>   (`admin/m7/M7View.tsx`, que llama a `getPnl` y renderiza el desglose del P&L), por lo que el rename se aplicó
>   actualizando **productor y consumidor en la misma entrega** (sin periodo de compatibilidad porque el front
>   migró al shape de 6 claves al mismo tiempo). El costo se acota al periodo por **`pickingAt`** (mismo criterio
>   que el ingreso), para que costo e ingreso del mismo envío caigan en el mismo periodo. El CSV export espeja el
>   nuevo shape.
>
> **Changelog v1.3.1 (2026-08-16)** — **Precio de buylist por RAREZA OFICIAL** (PROJECT.md §E.1, criterios
> 12/12b/12c/18). Reemplaza el esquema de **3 categorías hardcodeadas** (`RARITY_MAP` + `BuylistCategory`
> `comun|reverse_holo|ex_plus`) por una **tabla de regla por rareza**, editable en **M2** sin redeploy:
> - **Nuevos `SettingKey`:** `BUYLIST_PRICE_RULES` (`buylist_price_rules`, mapa `{ [rarity]: { mode:
>   'fixed'|'pct', value } }`) y `BUYLIST_PRICE_FALLBACK_PCT` (`buylist_price_fallback_pct`, default **40**).
>   `RARITY_MAP` (`rarity_map`) queda **DEPRECADO** (ya no lo lee la cotización). Ver §3.2 (ConfigSetting) y §4.2.
> - **§4.2 reescrito:** `AcquisitionPricer` resuelve el monto por **regla de rareza** (fixed → monto fijo;
>   pct → % de la referencia; sin regla → `BUYLIST_PRICE_FALLBACK_PCT`). Se mantiene la derivación
>   **server-side** desde `Card.rarity` real (guardarraíl SEC-A1 intacto).
> - **Modelo:** `SellRequestItem` deja de depender de `category` (BuylistCategory) y snapshotea la **regla
>   aplicada** (`rarity`, `ruleMode`, `ruleValue`, `ruleSource`). Enum nuevo `BuylistRuleMode = fixed | pct`.
>   **Migración M-14** (backend). `BuylistCategory` y `category` quedan deprecados (retención legacy).
> - **Endpoints M2 nuevos (backend):** `GET/PUT /admin/pricing/buylist-rules` y `GET /admin/pricing/rarities`
>   (rarezas distintas del catálogo unidas a las reglas). `GET/PUT /admin/pricing/rarity-map` **deprecados**.
> - **Contrato buylist:** `POST /buylist/quote` y `SellItemDTO` exponen `rarity` + `appliedRule` en vez de
>   `category`; `POST /buylist/requests` ya **no** recibe `category` del cliente. Ver `API_CONTRACT.md §6, §M2`.
> - **Seed (preserva negocio):** Common **$0.50** fixed, Uncommon **$0.50** fixed, Reverse Holo **$1.50** fixed,
>   fallback **40%**; todo lo demás cae al fallback (40% de la referencia). Alcance: **solo buylist** (la
>   aportación en especie sigue en 70%, dial aparte).
>
> **Changelog v1.3 (2026-08-16)** — Cotizador **Opción 1** (buylist sobre todo el catálogo) y confirmación del
> estado del back-office:
> - **Nuevo §4.10:** cotizador que cotiza **cualquier** carta de la tabla `Card` — endpoints nuevos de backend
>   `GET /buylist/cards` + `GET /buylist/sets` (búsqueda pública sobre todo el catálogo) y
>   `POST /admin/catalog/sync-all` (importar todo el catálogo, truly-async). Ver `API_CONTRACT.md §6 y §M2`.
> - **§9 Desviaciones:** DEV-1 (el `POST /admin/catalog/sync` from-date importa **síncrono** en el request →
>   riesgo de timeout para catálogo completo; enrutado a backend) y DEV-2 (jobId cosmético).
> - **§10 Preguntas abiertas v1.3:** pricing on-demand del cotizador y rate-limit de la búsqueda pública.
> - **Confirmado (sin cambio de contrato):** M2/M6/M7/M9/M10 ya están implementados en backend. Sobre el consumo
>   de frontend: **M7 YA se consume en UI** (`admin/m7/M7View.tsx`, montado, llama a `getPnl` y renderiza el
>   P&L); M2/M6/M9/M10 siguen pendientes de consumir (`ModuleTodo` stubs de UI). La edición de diales M10 es
>   `PUT /admin/settings` (body parcial), no per-key.
>
> **Changelog v1.2 / v1.2.1 (2026-08-14)** — simplificación aprobada (`PROJECT.md` › "Simplificación v1.2" y
> "Corrección v1.2.1"):
> - **Sin fotos de producto/inventario:** el producto no lleva fotos propias; la imagen es la **de catálogo
>   remota** de pokemontcg.io. Se **relajan** los campos de foto de `InventoryItem`
>   (`frontPhotoKey`/`backPhotoKey`/`extraPhotoKeys` → opcionales/eliminados) y se **elimina** la foto como
>   evidencia canónica de disputa. **Migración** M-13.
> - **Gradeadas por certificado:** `InventoryItem` captura **`certNumber`** (String, nº de certificado
>   PSA/CGC), **requerido para publicar** una gradeada; el slab (verificable en la graduadora) es la garantía.
>   Sin validación automática contra la graduadora. **Migración** M-12.
> - **Uploads/presign acotado a `kyc_ine`:** único propósito válido; `inventory_photo`/`dispute_claim`
>   eliminados. El módulo `uploads` sirve solo el INE.
> - **Disputa por correo:** la evidencia de disputa de condición se envía **por correo a soporte** (dato de
>   contacto); ya no hay upload de evidencia ni comparador de fotos. Se conserva `Dispute.type`
>   (`condition_raw | condition_sealed`) y VENTAS FINALES.
> - **INE (KYC) intacto:** almacenamiento del INE en R2 (cifrado + retención `INE_RETENTION_DAYS`), `S3_*`,
>   PII/cifrado/`reveal-clabe` **sin cambios** (v1.2.1 revierte solo la parte del INE respecto a la v1.2).
>
> **Changelog v1.1 (2026-08-14)** — incorpora las 8 decisiones del `PROJECT.md` › "Actualización 2026-08-14":
> raw solo NM (con **migración**), sección "Compra" = inventario publicado con precio + facetas dinámicas,
> sync de catálogo M2 (pokemontcg.io) con backfill, sellado como línea de venta con precio manual MXN,
> gráfica de tendencia del portafolio (`PortfolioSnapshot`, **migración**), login con Google (campos en
> `User`, **migración**) y AcquisitionPricer con rarezas modernas. Ver §11 "Migraciones requeridas (v1.1)".

## 0. Alcance técnico (MVP vs Fase 2)

**Dentro del MVP:** storefront + ficha con **imagen de catálogo remota** (sin fotos propias) y precio de referencia, checkout Stripe (IVA 16% desglosado + fee de procesamiento trasladado), bóveda/portafolio con titularidad `pending→settled`, retiros/envíos nacionales manuales, buylist con cotizador público + pipeline manual + **INE cifrado en R2 con retención** (`kyc_ine`, único uso de object storage), back-office M1–M10, i18n ES/EN, disputas de condición (raw/sellado) con **evidencia por correo a soporte**. Gradeadas identificadas por **empresa + grado + `certNumber`**.

**Fuera del MVP (diseñar para no cerrarles la puerta):** C2C/consignación, wallet de saldo, order-book, guías/SPEI automáticos, grading propio, app nativa, cobro de custodia, internacional, PriceCharting, plan de pago de pricing.

Puntos donde el diseño deja la puerta abierta a fase 2:
- `InventoryItem.ownerType` (`platform|customer`) permite introducir `consignor` (C2C) sin migración estructural.
- `PricingProvider` es una interfaz; subir a plan de pago = una implementación nueva + un dial en M10.
- El dinero se maneja **por transacción**; NO existe entidad `Wallet`/`Balance`. Introducirla en fase 2 no rompe nada previo.

---

## 1. Stack elegido y justificación

| Capa | Elección | Justificación |
|---|---|---|
| Lenguaje | **TypeScript** (back y front) | Un solo lenguaje, tipos de DTO compartibles entre backend y frontend, reduce fricción del equipo pequeño. |
| Backend | **NestJS** (Node 20 LTS) | Modularidad y DI encajan con módulos M1–M10 y con la interfaz `PricingProvider`; guards nativos para autorización por rol/acción; ecosistema maduro para Stripe, colas y cron. |
| ORM / migraciones | **Prisma** | Esquema declarativo, migraciones versionadas, tipos generados. Ideal para un modelo relacional con muchas FKs. |
| Base de datos | **PostgreSQL 16** | Modelo fuertemente relacional (items, órdenes, precios, auditoría), constraints e índices, `JSONB` para snapshots (CFDI, direcciones) y `AuditLog`. Recomendado en PROJECT. |
| Cache / colas / rate-limit | **Redis + BullMQ** | Jobs diarios (sync de precios, FX), barridos de plazos de buylist/disputas, y **rate-limiting** para respetar el free tier de las APIs (100/día, 250/día). |
| Auth | **JWT** (access corto + refresh), hashing **argon2** | Sin dependencia de proveedor externo para el MVP; roles y KYC viven en `User`. Guards por rol y por acción. |
| Object storage (SOLO INE de KYC) | **Object storage S3-compatible** (Cloudflare R2 o AWS S3 en prod; **MinIO** en local) vía **URLs prefirmadas**, **bucket privado + cifrado + retención** | **v1.2:** único uso = **imagen del INE del buylist** (`kyc_ine`). No hay fotos de producto/inventario (imagen de catálogo remota) ni de disputa (evidencia por correo). Presign PUT para subir, presign GET de vida corta para leer en back-office; retención por `INE_RETENTION_DAYS` (§3.4). |
| Frontend | **Next.js 14 (App Router) + React + TypeScript** | Storefront con SEO (server components para catálogo/ficha), y mismo framework para el panel admin responsive. **Sin captura de fotos de producto** (v1.2); la única subida es la imagen del INE en el flujo de KYC del buylist. |
| Data fetching (front) | **TanStack Query** | Cache cliente, estados de carga/error consistentes con el contrato. |
| Estilos | **Tailwind CSS** + componentes del **DESIGN_SYSTEM** (propiedad de ux-ui) | La estructura visual/tokens los define ux-ui; el arquitecto no fija el sistema de diseño. |
| i18n | **next-intl** (frontend) | Toda la UI ES/EN, default ES. El backend NO traduce (ver §6). |
| Pagos | **Stripe** (Checkout/PaymentIntents + Webhooks) | Requisito de PROJECT. |
| Jobs/cron | **BullMQ repeatable jobs** (Redis) | Sync diario de precios (solo bóveda), refresco de FX, plazos de buylist/disputa. |

### Monorepo
Un solo repositorio con dos apps: `backend/` y `frontend/`. Sin herramienta de monorepo pesada en el MVP (nada de Nx/Turbo obligatorio); devops decide si añade `pnpm workspaces`. Los tipos del contrato se comparten copiando/generando DTOs en `frontend/src/types` desde `API_CONTRACT.md` (fuente de verdad).

---

## 2. Estructura de carpetas (alto nivel)

> Respeta la propiedad de archivos de `CLAUDE.md`: backend escribe en `backend/`, frontend en `frontend/`, devops en configs/CI. El arquitecto solo describe la estructura.

### backend/ (NestJS)
```
backend/
  src/
    main.ts
    app.module.ts
    common/            # guards (roles, money-out), decorators, filtros de error, interceptores, error-codes
    config/            # carga de env (typed); NO contiene los diales de negocio (esos viven en DB, ver settings)
    modules/
      auth/            # registro, login, refresh, JWT, guards de rol/acción
      users/           # perfil, direcciones (MX), billing/CFDI, KYC (CLABE/INE/límites)  -> M6
      catalog/         # Card/CardSet, ingesta desde pokemontcg.io (datos en inglés)
      pricing/         # PricingProvider (interfaz + impls), PricingService, FxService, cola precio-pendiente -> M2
      inventory/       # InventoryItem, folios, VaultLocation, InventoryMovement -> M1
      orders/          # checkout, breakdown (subtotal/fee/IVA), Order/OrderItem -> M3
      payments/        # cliente Stripe + manejo de webhooks (settled/refund/chargeback)
      vault/           # portafolio del cliente (holdings + valor)  -> C
      shipments/       # retiros/envíos nacionales, picking, guía manual -> M4
      buylist/         # AcquisitionPricer, cotizador público, SellRequest pipeline -> M5/E
      disputes/        # disputas de condición (raw/sellado), evidencia por correo a soporte, recompra -> M8
      admin/           # dashboard (8 tarjetas), finanzas/P&L (M7), reportes (M9)
      settings/        # diales M10 (persistidos en DB, editables sin deploy)
      audit/           # AuditLog global (M10)
      uploads/         # presign de object storage SOLO para el INE del buylist (kyc_ine); bucket privado
      mail/            # puerto MailPort + adaptadores (ResendMailAdapter / NoopMailAdapter) + MailService (plantillas) -> §4.11
    jobs/              # BullMQ: price-sync diario, fx-refresh, buylist-sweep (7d/30d), dispute-deadline, auth-token-sweep (tokens expirados)
    prisma/            # schema.prisma + migraciones
  test/
```

### frontend/ (Next.js App Router)
```
frontend/
  src/
    app/
      [locale]/                 # es | en (default es)
        (storefront)/           # catálogo, ficha, carrito, checkout, mi-bóveda, retiros, buylist
        (admin)/                # back-office M1–M10 + dashboard (responsive; sin captura de fotos de producto, v1.2)
        (auth)/                 # login/registro
    components/                 # implementa el DESIGN_SYSTEM (ux-ui define tokens/componentes)
    lib/                        # api client, stripe.js, query client
    i18n/                       # config next-intl + messages/es.json, messages/en.json (copys de UI)
    hooks/
    types/                      # DTOs espejo del API_CONTRACT (fuente de verdad = docs)
  public/
```

Documentos por rol (propiedad en `CLAUDE.md`): `docs/BACKEND_NOTES.md`, `docs/FRONTEND_NOTES.md`, `docs/DEVOPS_NOTES.md`, `docs/DESIGN_SYSTEM.md`, `docs/TECH_DEBT.md`.

---

## 3. Modelo de datos

Convención de dinero: **todos los montos son enteros en centavos (`*Cents`) de MXN**, salvo `PriceReference.priceUsdCents` (origen USD, informativo). No se usa float para dinero. **No existe entidad de saldo/wallet.** Timestamps en UTC.

### 3.1 Diagrama textual de relaciones (resumen)
```
User 1───* Address
User 1───1 KycProfile           (CLABE/INE/límites)
User 1───1 BillingProfile       (CFDI)
User 1───* Order 1───* OrderItem *───1 InventoryItem
User 1───* ShipmentRequest 1───* ShipmentItem *───1 InventoryItem
User 1───* SellRequest 1───* SellRequestItem 0/1─1 InventoryItem  (al convertir)
User 1───* Dispute *───1 InventoryItem

Card 1───* InventoryItem
Card 1───* PriceReference
Card *───1 CardSet

InventoryItem *───1 VaultLocation
InventoryItem 1───* InventoryMovement
InventoryItem ownerType: platform | customer  (ownerUserId cuando customer)

User 1───* PortfolioSnapshot        (serie diaria de valor de portafolio; gráfica de tendencia)
User 1───* AuthToken               (verificación de correo / reset de contraseña; un solo uso, hash en BD)

ConfigSetting (diales M10, key/value)     AuditLog (global)     FxRate (diario)
PendingPriceEntry (cola de precio pendiente)
```

### 3.2 Entidades

#### User (+ rol)  — **MIGRACIÓN v1.1 (campos de auth Google)**, **v1.3.1 (M6: soft-delete + reset admin)**
- `id` (uuid), `email` (único), `passwordHash` (**nullable** — null para cuentas creadas solo con Google), `role` (`customer | vault_operator | super_admin`), `name`, `phone?`, `locale` (`es|en`, default `es`), `status` (`active | blocked | deleted`), `createdAt`, `updatedAt`.
- **Gestión de cuenta (v1.3.1, MIGRACIÓN M-15):** `deletedAt` (`DateTime?`), `anonymizedAt` (`DateTime?`),
  `mustChangePassword` (`Boolean @default(false)` — lo activa el reset admin; opcional de consumir por el front),
  y `tokenVersion` (`Int @default(0)` — se **incrementa** en reset/soft-delete para **revocar refresh tokens**
  vigentes; el JWT lleva el `tokenVersion` y el guard rechaza los que no coinciden). El valor `deleted` de
  `UserStatus` marca cuenta soft-deleted/anonimizada; `POST /auth/login` y `/auth/google` la rechazan con
  `403 USER_BLOCKED` (no revela el motivo).
- **Auth provider (nuevo):** `authProvider` (enum `local | google`, default `local`), `googleId` (`String? @unique` — `sub` del ID token de Google), `emailVerified` (`Boolean @default(false)`), `avatarUrl` (`String?`).
- **Verificación de correo como AUTORIDAD (v1.5-auth-email):** `emailVerified` **NO** bloquea el login pero
  **sí** las acciones sensibles (compra/retiro/venta) vía `EmailVerifiedGuard` (§4.11, §7). Se puebla en
  `req.user` desde el `JwtAuthGuard` (que ya consulta la BD por `status`/`tokenVersion`; añade `emailVerified` al
  `select`). Google → `emailVerified=true` (no afectado). Relación nueva `User 1───* AuthToken`.
- El comprador es siempre `customer`. `vault_operator` y `super_admin` son cuentas de back-office.
- **Reglas de auth Google (ver §4.7):**
  - `passwordHash` es null hasta que el usuario fije contraseña; `POST /auth/login` (email/contraseña) **rechaza** cuentas sin `passwordHash` con `401 INVALID_CREDENTIALS` (no revela que es cuenta Google).
  - **Account-linking por email verificado:** si un `POST /auth/google` trae un email que ya existe como cuenta `local`, se enlaza (`googleId` se setea, `authProvider` permanece o pasa a coexistir) **solo si el token trae `email_verified=true`**. Si el email no está verificado en el token → `403 GOOGLE_EMAIL_UNVERIFIED`, no se enlaza.
  - **El `role` se asigna SIEMPRE server-side** (default `customer`); NUNCA se lee del ID token. Ningún claim del token puede elevar privilegios.
  - Login Google **no exime KYC**: la buylist sigue exigiendo CLABE/INE a nombre del usuario (M6) independientemente del provider.

#### KycProfile (M6)
- `id`, `userId` (único), `legalName`, `rfc?`, `clabe?` (18 dígitos, a nombre del propio usuario), `ineFrontKey?`, `ineBackKey?`, `kycStatus` (`none | pending | verified | rejected`), `capPerRequestCentsOverride?`, `capPerMonthCentsOverride?` (si null, usa diales de M10), `verifiedBy?`, `verifiedAt?`.
- Regla de negocio: pago SPEI solo a una `clabe` **a nombre del propio usuario**; INE requerido cuando la cotización/acumulado supera el tope configurado.

#### BillingProfile (CFDI)
- `id`, `userId` (único), `rfc`, `razonSocial`, `regimenFiscal`, `usoCfdi`, `postalCode`, `email`. Se toma **snapshot** dentro de `Order` al pagar.

#### Address
- `id`, `userId`, `line1`, `line2?`, `neighborhood?`, `city`, `state`, `postalCode`, `country` (**fijo `MX`; se rechaza cualquier otro**), `phone`, `isDefault`. Usado en retiros; snapshot en `ShipmentRequest`.

#### CardSet (catálogo, datos en inglés)
- `id`, `externalId` (pokemontcg.io), `name` (EN), `series?`, `releaseDate?`, `printedTotal?`, `ptcgoCode?`.

#### Card (catálogo, datos en inglés, no se traduce)
- `id`, `externalId` (pokemontcg.io id), `setId` (FK CardSet), `name` (EN), `number`, `rarity`, `supertype`, `subtypes` (JSONB), `imageSmallUrl`, `imageLargeUrl`, `tcgplayerId?`, `createdAt`.
- Índices: `(setId)`, `(name)`, `(rarity)`, `externalId` único.

#### VaultLocation (M1 — ubicación jerárquica CAJA/FILA/SLOT)
- `id`, `zone` (`platform_stock | customer_custody` — **separación física de custodia de clientes**), `box` (CAJA), `row` (FILA), `slot` (SLOT), `label` (derivado, ej. `C03-F02-S15`), `isActive`.
- Unicidad: `(zone, box, row, slot)`.

#### InventoryItem (instancia física — pieza única)
Núcleo del sistema. Una fila = una carta/producto físico.
- `id`, `folio` (**legible, único, `INV-000123`**, ver §5), `cardId` (FK), `productType` (`graded | sealed | raw`).
- Condición/grado (según tipo):
  - raw → `rawCondition` (**enum `RawCondition = NM` — ÚNICO valor; MIGRACIÓN v1.1**, estándar propio, ver §3.5). Se **eliminan** `LP | MP | HP | DMG` del enum. Greenfield: no hay filas que hacer backfill; la migración solo redefine el enum/constraint.
  - graded → `gradingCompany` (`PSA | CGC`), `gradeValue` (ej. `10`, `9.5`), **`certNumber` (`String` — nº de certificado PSA/CGC; MIGRACIÓN v1.2 M-12). REQUERIDO para publicar una gradeada.** El slab (empresa+grado+cert, verificable en la web de la graduadora) es la garantía de condición; **sin validación automática** contra la graduadora (fuera de alcance). `certNumber` es null para raw/sealed.
  - sealed → **sin condición ni rareza ni grade ni cert** (ver §3.6). **Precio manual MXN obligatorio para publicar.**
  - `sealedSubtype?` (enum opcional `box | etb | bundle | tin | blister`, solo para `productType=sealed`; nullable en el resto).
- **Imagen (v1.2): sin fotos propias.** El item **no** almacena fotos propias; la imagen mostrada (ficha/Compra/bóveda/back-office) es la **imagen de catálogo remota** de la `Card` (`imageSmallUrl`/`imageLargeUrl` de pokemontcg.io). Los campos `frontPhotoKey`/`backPhotoKey`/`extraPhotoKeys` quedan **eliminados/opcionales sin uso** (MIGRACIÓN v1.2 M-13); ya **no** son evidencia de disputa (la evidencia va por correo a soporte, ver §3.6 y §Dispute).
- Ubicación: `locationId` (FK VaultLocation).
- Propiedad y titularidad:
  - `ownerType` (`platform | customer`), `ownerUserId?` (cuando `customer`).
  - `ownershipStatus?` (`pending | settled`, solo cuando `ownerType=customer`; ver §3.3).
- Estado operativo: `status` (`in_stock | listed | reserved | in_custody | picking | shipped | delivered | lost | damaged | withdrawn`).
- Precio de venta: `listPriceCents?` (MXN sin IVA; **= `round(referenciaMxn × (1 + salesMarkupPct/100))`** con `salesMarkupPct` dial M10, o override manual directo; si null y sin `PriceReference` → **"precio pendiente"**, no vendible). El **valor de referencia** (valor de mercado mostrado) es el de `PriceReference`, distinto del precio de venta.
- Costo y adquisición: `acquisitionType` (`aportacion_en_especie | buylist | compra`), `acquisitionCostCents`, `acquisitionPct?` (ej. 70 para aportación en especie), `sourceSellRequestItemId?`.
- `createdAt`, `updatedAt`.
- Índices: `folio` único, `(cardId)`, `(status)`, `(ownerUserId)`, `(locationId)`.

#### InventoryMovement (M1 — historial)
- `id`, `itemId`, `fromLocationId?`, `toLocationId?`, `fromStatus?`, `toStatus?`, `reason` (`alta | move | sale | settle | chargeback_return | withdrawal | lost | damaged | buylist_convert`), `actorUserId`, `note?`, `createdAt`.

#### PriceReference (M2 — precio por carta/tipo/fecha/fuente/FX)
- `id`, `cardId`, `productType`, `gradeKey` (string normalizada: `raw:NM`, `graded:PSA:10`, `sealed`), `source` (`pokemontcg_io | pokemonpricetracker | poketrace | manual`), `priceUsdCents?`, `fxRate?` (decimal), `fxBufferPct?`, `priceMxnCents`, `capturedDate` (date), `isManualOverride` (bool), `createdAt`.
- Unicidad: `(cardId, productType, gradeKey, capturedDate)`. **Cache diario** = una fila por día por combinación.
- **Precio pendiente** = no hay fila vigente con `priceMxnCents` y no hay override → genera `PendingPriceEntry`.

#### PendingPriceEntry (cola de precio pendiente — escalado al dueño)
- `id`, `cardId`, `productType`, `gradeKey`, `context` (`catalog | portfolio | buylist | inventory`), `refId?` (item/sellRequestItem que lo originó), `status` (`open | resolved`), `resolvedPriceRefId?`, `createdAt`, `resolvedAt?`.
- Regla transversal: una carta sin precio **nunca se descarta**; entra aquí y se escala al súper-admin.

#### FxRate (M2/M10 — USD→MXN con colchón)
- `id`, `base` (`USD`), `quote` (`MXN`), `rate` (decimal), `bufferPct` (dial M10), `effectiveDate` (date), `source` (**enum `FxSource = banxico | manual`**, dedicado y **separado de `PriceSource`**), `createdAt`.
- Automático: job diario `fx-refresh` obtiene el `rate` de **Banxico (SIE)**, aplica el colchón y escribe `source=banxico`. **Override manual** (dial M10) escribe `source=manual` y **tiene prioridad** sobre el automático del mismo día; también es el fallback si el fetch falla.
- El precio MXN mostrado = `priceUsd × rate × (1 + bufferPct/100)`.

#### Order (M3 — venta de cartas)
- `id`, `userId`, `status` (`pending | settled | failed | refunded | chargeback`).
- Desglose (todo en centavos MXN): `subtotalCents` (suma de líneas sin IVA), `processingFeeCents` (**fee de Stripe trasladado al comprador**, línea visible), `ivaCents` (**16% desglosado**), `totalCents` (= subtotal + fee + IVA).
- `ivaRatePct` (snapshot del dial, default 16), `stripePaymentIntentId?`, `stripeChargeId?`, `billingSnapshot` (JSONB, datos CFDI al momento), `cfdiStatus` (`registrado | no_aplica` en MVP — sin PAC; `emitido` reservado para fase 2), `invoiceRequested` (bool, default false — el cliente pide factura por correo), `createdAt`, `settledAt?`, `refundedAt?`.
- **Banderas operativas de disputa/contracargo** (escalares, NO cambian el enum `OrderStatus`): `chargebackNeedsManual` (bool, default false — el contracargo llegó cuando la carta **ya se había enviado/entregado**; requiere pelear la disputa con la guía, sin re-agregar inventario) y `disputeOutcome?` (`won | lost | null` — resultado del cierre de la disputa Stripe: `won→settled`, `lost→chargeback`). Se **exponen solo** en el detalle admin de orden del contrato (`GET /admin/orders/:id`), no en `OrderSummaryDTO` ni en el detalle del cliente.
- Índices: `(userId)`, `(status)`, `stripePaymentIntentId` único.

#### OrderItem
- `id`, `orderId`, `inventoryItemId`, `cardSnapshot` (JSONB: nombre/set/número/tipo/condición-grado), `unitPriceCents` (sin IVA, congelado al checkout).

#### ShipmentRequest (M4 — retiro/envío nacional)
- `id`, `userId`, `addressSnapshot` (JSONB, MX), `status` (`solicitado | picking | guia | enviado | entregado | cancelado`).
- **Ingreso** por envío: `shippingFeeCents` (dial M10, default 17500) = **lo que el cliente nos paga** por el envío (línea de cobro Stripe). `stripePaymentIntentId?` (el envío se cobra al comprador **antes** de generar la solicitud).
- **Costo** de envío (v1.4-finance, **MIGRACIÓN M-16**): `shippingCostCents` (`Int @default(0)`) = **lo que la plataforma paga a la paquetería** por ese envío (MXN centavos). **Distinto de `shippingFeeCents`** (ingreso ≠ costo). Se **captura en M4 al asignar carrier/guía** (`POST /admin/shipments/:id/tracking`), es **opcional** (default 0 mientras no se conoce) y **editable** después re-invocando el mismo endpoint; validación de aplicación **entero ≥ 0**. Alimenta el P&L de M7 (se resta), acotado por `pickingAt` (§ P&L M7). Filas históricas/sin captura ⇒ 0 (no rompen el P&L).
- Logística manual: `carrier?`, `trackingNumber?`, `requestedAt`, `pickingAt?`, `shippedAt?`, `deliveredAt?`.
- Restricción: solo se incluyen items `settled` (ver validación en §3.3).

#### ShipmentItem
- `id`, `shipmentRequestId`, `inventoryItemId`.

#### SellRequest (M5/E — buylist)
- `id`, `userId`, `status` (`cotizada | recibida | verificacion | aprobada | pagada | rechazada | abandonada`).
- Totales: `quotedTotalCents`, `approvedTotalCents?`.
- KYC/pago: `clabeSnapshot`, `ineRequired` (bool), `ineProvided` (bool), `speiReference?`, `paidBy?` (**solo súper-admin**), `paidAt?`.
- Plazos: `createdAt`, `receivedAt?`, `verifiedAt?`, `approvedAt?`, `adjustmentSentAt?` (para plazo 7d de rechazo), `deadlineAt?` (30d → inventario).
- Regla: **pago SPEI tras recepción y verificación**, decidido carta por carta (cherry-pick).

#### SellRequestItem
- `id`, `sellRequestId`, `cardId`, `productType`, `rawCondition?`, `quotedPriceCents?` (null si precio pendiente), `approvedPriceCents?`, `itemStatus` (`cotizada | precio_pendiente | recibida | verificacion | aprobada | ajustada | rechazada | pagada | convertida_inventario`), `inventoryItemId?` (al convertir).
- **Regla de precio aplicada (v1.3.1 — snapshot para auditoría, reemplaza `category`):**
  - `rarity?` (String — snapshot de `Card.rarity` al cotizar; taxonomía abierta pokemontcg.io).
  - `ruleMode?` (**enum `BuylistRuleMode = fixed | pct`** — modo de la regla aplicada).
  - `ruleValue?` (Int — centavos si `fixed`, porcentaje si `pct`).
  - `ruleSource?` (`rule | fallback` — si vino de una fila explícita de `BUYLIST_PRICE_RULES` o del fallback).
- **`category` (DEPRECADO, MIGRACIÓN M-14):** la columna `category` (BuylistCategory) queda **nullable/legacy**;
  la cotización v1.3.1 ya **no** la lee ni la escribe (se conserva solo por retención de filas históricas). El
  enum `BuylistCategory` permanece en el schema por compatibilidad, marcado deprecado; nada nuevo lo usa.
- **v1.2: sin `photoKeys`** — el buylist no sube fotos de la carta (no hay upload salvo `kyc_ine`); la verificación NM se hace contra la carta física recibida y la imagen de catálogo. El campo `photoKeys` queda eliminado/sin uso (M-13).

#### Dispute (M8 — condición raw/sellado)
- `id`, `userId`, `inventoryItemId` (o vía `orderItemId`), `type` (`condition_raw | condition_sealed`), `status` (`abierta | en_revision | resuelta_recompra | rechazada`).
- **Evidencia por correo (v1.2):** la evidencia se envía **por correo al buzón de soporte** (dato de contacto, no se sube a la app). El `Dispute` **ya no** guarda `ingressPhotoKeys`/`claimPhotoKeys` (eliminados, M-13); guarda solo `description`. Resolución: **gradeadas** por grado + `certNumber` (verificable en la graduadora); **raw NM** por el estándar/política de condición propio.
- Remedio: `resolution?`, `repurchaseOrderId?` (**recompra al precio pagado**), `deadlineAt` (**7 días desde entrega**), `createdAt`, `resolvedAt?`, `resolvedBy?`.
- **Política VENTAS FINALES:** la recompra es una **compensación**; el **cliente conserva la carta** y la carta **NO** regresa al inventario (sin `InventoryMovement`, sin re-listar). Solo se registra el pago de recompra (money-out, súper-admin, auditado).

#### ConfigSetting (M10 — diales editables sin deploy)
- `key` (PK, ej. `shipping_fee_cents`, `aportacion_pct`, `iva_pct`, `sales_markup_pct`, `stripe_fee_pct`, `stripe_fee_fixed_cents`, `stripe_fee_iva_pct`, `buylist_cap_per_request_cents`, `buylist_cap_per_month_cents`, `ine_threshold_cents`, `repo_cap_per_card_cents`, `fx_buffer_pct`, `fx_manual_override_rate`, `pricing_provider_raw`, `pricing_provider_graded`, `pricing_provider_sealed`, **`catalog_sync_from_date`** (default `"2024/01/01"`, frontera por defecto del sync de catálogo), **`buylist_price_rules`** y **`buylist_price_fallback_pct`** (v1.3.1, tabla de precio de buylist por rareza)), `valueJson` (JSONB, tipado por key), `updatedBy`, `updatedAt`.
- Defaults iniciales: envío 17500, aportación 70, IVA 16, **markup de venta configurable (`sales_markup_pct`)**, **tarifa Stripe MX para el gross-up: `stripe_fee_pct`, `stripe_fee_fixed_cents` y `stripe_fee_iva_pct` (IVA sobre la comisión de Stripe, fracción `[0,1)`, default 0.16)**, tope solicitud 300000, tope mes 1000000, INE = tope solicitud, colchón FX configurable + override manual, providers según tabla de PROJECT.
- **Buylist por rareza (v1.3.1):**
  - `buylist_price_rules` (JSONB) = `{ [rarity]: { mode: 'fixed'|'pct', value } }`. Seed: `{ "Common": {fixed,50}, "Uncommon": {fixed,50}, "Reverse Holo": {fixed,150} }`. **Validador:** objeto (no array); cada entrada `{ mode, value }` con `mode ∈ {fixed,pct}`; si `fixed` → `value` **entero ≥ 0** (centavos); si `pct` → `value` **número en `[0,100]`**. Rechaza modos/valores fuera de rango (`422 VALIDATION_ERROR`).
  - `buylist_price_fallback_pct` (número) = **40** por defecto. **Validador:** número en `[0,100]`.
  - **NO** se exponen en el DTO de settings de M10 (`GET/PUT /admin/settings`); se editan por endpoints dedicados de M2 (`GET/PUT /admin/pricing/buylist-rules`, ver `API_CONTRACT §M2`). Toda edición se **audita** (`AuditLog action=pricing.buylist_rules.update`).
- **`rarity_map` (DEPRECADO v1.3.1):** el dial `rarity_map` (`RARITY_MAP`) y sus endpoints `GET/PUT /admin/pricing/rarity-map` quedan **deprecados**; la cotización ya no los lee. Se conservan como no-op/legacy hasta su retiro; no se siembran en despliegues nuevos.

#### AuditLog (M10 — bitácora global)
- `id`, `actorUserId`, `actorRole`, `action` (string, ej. `order.refund`, `sellrequest.pay_spei`, `settings.update`, `inventory.mark_damaged`, `catalog.sync`, `catalog.backfill`, `auth.google_link`, `pricing.buylist_rules.update`, `user.reset_password`, `user.delete`), `entityType`, `entityId`, `before?` (JSONB), `after?` (JSONB), `ip?`, `createdAt`.
- **PII/secretos NUNCA en `before`/`after`:** acciones sobre credenciales/PII (`user.reset_password`, `user.delete`) registran solo IDs/flags/`mode`, **nunca** la contraseña temporal ni la PII anonimizada.
- **Toda acción de back-office se registra**, en especial los intentos bloqueados de dinero saliente por operador (queda registrado y bloqueado) y las **operaciones de sync de catálogo** (`catalog.remote_sets`, `catalog.sync`, `catalog.backfill`; ver §4.8, auditadas).

#### PortfolioSnapshot (gráfica de tendencia del portafolio) — **MIGRACIÓN v1.1 (modelo nuevo)**
Serie temporal por usuario que alimenta la gráfica estilo acciones de "Mi bóveda" (rangos 5d/15d/1m/3m/6m/1a/YTD/Máx).
- `id`, `userId` (FK User), `asOfDate` (`@db.Date` — un punto por día natural), `totalValueMxnCents` (valor del portafolio a **referencia** ese día, misma lógica que `VaultService.holdings()`), `costBasisMxnCents?` (base de costo agregada del usuario, opcional/nullable), `pendingPriceCount` (cartas sin precio ese día, excluidas del total), `createdAt`.
- **Unicidad:** `@@unique([userId, asOfDate])` (idempotente: re-correr el job del día hace upsert, no duplica).
- **Índice:** `@@index([userId, asOfDate])` para consultas por rango.
- **Escritura:** job diario `portfolio-snapshot` (BullMQ, ver §5 y BE-5) tras el `price-sync`; reutiliza `VaultService.holdings()` para no divergir del valor mostrado en vivo. Solo snapshotea usuarios con holdings.
- **Backfill indicativo (opcional, marcado estimado):** si se desea sembrar histórico previo a la puesta en marcha del job, se puede generar una serie **estimada** aplicando los `PriceReference` disponibles por fecha a los holdings actuales del usuario. Estos puntos se marcan `estimated=true` en la respuesta (`PortfolioPointDTO.estimated?`) y **no** se persisten como verdad si contradicen un snapshot real; es indicativo, no autoritativo. Es una tarea opcional de BE, no bloquea el MVP.

#### AuthToken (verificación de correo / reset de contraseña) — **MIGRACIÓN M-17 (modelo nuevo, v1.5-auth-email)**
Token de **un solo uso** para los flujos self-service por correo. **Nunca** guarda el token en claro: el claro
(alta entropía) viaja solo por email; en BD vive su **hash**.
- `id` (uuid), `userId` (FK User, `onDelete: Cascade`), `type` (enum `AuthTokenType = email_verification | password_reset`),
  `tokenHash` (`String @unique` — **SHA-256** del token en claro), `expiresAt` (`DateTime`), `usedAt` (`DateTime?` —
  se setea al consumir; `null` = vigente), `requestIp` (`String?`, auditoría), `createdAt`.
- **Índices:** `@@unique([tokenHash])` (lookup por hash del token presentado), `@@index([userId, type])`
  (invalidar/consultar los del usuario), `@@index([expiresAt])` (barrido `auth-token-sweep`).
- **Hashing:** el token en claro es **32 bytes aleatorios** (`crypto.randomBytes`, base64url ≈ 256 bits de
  entropía) → basta **SHA-256** (rápido): NO se usa argon2 porque no hay riesgo de fuerza bruta con esa entropía
  (a diferencia de una contraseña). *(Endurecimiento opcional: HMAC-SHA256 con una llave de servidor dedicada,
  patrón `clabeHmac`; se documenta como opción, no requerido para el MVP.)*
- **Expiraciones (dial/const):** `email_verification` **24h**, `password_reset` **1h**. Configurables como
  constantes de servicio (o dial futuro); no son `ConfigSetting` en el MVP.
- **Un solo uso + rotación:** consumir setea `usedAt`. Al **emitir** un token nuevo de un `type` para un usuario,
  se **invalidan** (marcan `usedAt`/borran) los tokens vigentes previos de ese `type` → solo el último link vale.
- **Validación al consumir (atómica):** `tokenHash` existe **y** `usedAt IS NULL` **y** `expiresAt > now()`;
  cualquier fallo → `422 *_TOKEN_INVALID` (no se distingue inexistente/expirado/usado, para no filtrar señal).
- **Escritura/lectura:** `AuthService` (verificación/forgot/reset). Barrido housekeeping: job `auth-token-sweep`
  (borra `expiresAt < now()`), no crítico.

### 3.3 Ciclo de titularidad `pending → settled` (regla transversal)

```
Compra Stripe (PaymentIntent creado)
  → OrderItem.inventoryItem: ownerType=customer, ownerUserId=comprador,
    ownershipStatus=pending, status=in_custody     (Order.status=pending)

webhook payment_intent.succeeded
  → ownershipStatus=settled                         (Order.status=settled, settledAt)

webhook charge.dispute.created (contracargo, CONSCIENTE DEL ESTADO FÍSICO)
  → Order.status=chargeback en ambos casos, y:
    (a) carta AÚN en bóveda (sin ShipmentItem enviado/entregado):
        revierte a inventario de plataforma:
        ownerType=platform, ownerUserId=null, ownershipStatus=null,
        status=listed (o in_stock), movimiento reason=chargeback_return
    (b) carta YA enviada/entregada:
        NO se re-agrega al inventario; Order.chargebackNeedsManual=true
        (pelear la disputa con la evidencia de la guía); sin movimiento

webhook charge.dispute.closed / charge.dispute.funds_reinstated (cierre)
  → ganamos: Order.status=settled, disputeOutcome=won
    (la carta revertida en (a) se QUEDA en inventario de plataforma)
  → perdemos: Order.status=chargeback (terminal), disputeOutcome=lost

webhook payment_intent.canceled
  → libera la reserva de compra (Order=failed, item reserved→listed)
    o cancela un envío en 'solicitado' (ShipmentRequest=cancelado, libera items)

Retiro
  → solo items con ownershipStatus=settled pueden entrar a ShipmentItem.
    Un item pending es rechazado por la validación de creación de ShipmentRequest.
```

Separación física: los items en `ownerType=customer` viven en `VaultLocation.zone=customer_custody`; el stock de la plataforma en `zone=platform_stock`. El movimiento entre zonas queda en `InventoryMovement`.

### 3.4 Protección de PII (cifrado en reposo, blind index, enmascarado, retención)

La PII sensible del proyecto es **CLABE, RFC e imágenes de INE**. Se protege en cuatro capas independientes y acumulativas. Ninguna capa reemplaza a otra: el cifrado protege el dato en la BD, el blind index permite buscar sin descifrar, el enmascarado protege el dato en las respuestas, y la retención limita cuánto tiempo existe la copia más sensible. Las llaves y diales (`PII_ENCRYPTION_KEY`, `PII_HMAC_KEY`, `INE_RETENTION_DAYS`) se declaran en **§8** (ver allí; no se repiten valores aquí).

Columnas afectadas (nombres `*Enc` / `*Hmac`, coherentes con lo implementado por backend):

| Entidad | Campo lógico | Columna cifrada | Columna blind index |
|---|---|---|---|
| `KycProfile` | CLABE | `clabeEnc` | `clabeHmac` |
| `KycProfile` | RFC | `rfcEnc` | — |
| `SellRequest` | CLABE snapshot | `clabeSnapshotEnc` | — |
| `BillingProfile` | RFC | `rfcEnc` | — |

Estas columnas sustituyen a los campos en claro `clabe` / `rfc` / `clabeSnapshot` que aparecen descritos en §3.2 (§3.4 es la descripción normativa de su almacenamiento real: en la BD nunca hay CLABE/RFC en claro).

#### a) Cifrado en reposo — AES-256-GCM

- Algoritmo **AES-256-GCM** (cifrado autenticado: confidencialidad + integridad vía tag).
- **Formato de columna:** `v1:iv:tag:ciphertext`, donde `iv`, `tag` y `ciphertext` van en **base64** y `v1` es el prefijo de versión de esquema (permite rotar algoritmo/llave sin ambigüedad y migrar filas viejas). El **IV es aleatorio por operación de cifrado** (12 bytes recomendados para GCM); nunca se reutiliza.
- **Llave:** `PII_ENCRYPTION_KEY` (32 bytes en base64). En local puede venir de `.env`; en **prod proviene de KMS / secret manager** (nunca en repo ni en imagen). El prefijo `v1` habilita rotación de llave por versión.
- **Dónde:** cifrar/descifrar ocurre **en la capa de servicio** (p. ej. un `PiiCryptoService` inyectable usado por `users`/`buylist`), no en el controlador ni en el cliente Prisma directo. Prisma persiste el string `v1:...` tal cual; la BD no conoce la llave.
- Firmas de referencia (pseudocódigo, no implementación):
  ```ts
  interface PiiCryptoService {
    encrypt(plaintext: string): string;            // -> "v1:iv:tag:ciphertext" (base64)
    decrypt(payload: string): string;              // valida tag GCM; lanza si fue manipulado
  }
  ```

#### b) Blind index — HMAC-SHA256 (`KycProfile.clabeHmac`)

- Problema que resuelve: la regla **"CLABE a nombre propio"** (`CLABE_NOT_OWN_NAME`) y la detección de la misma CLABE reusada requieren **igualar CLABEs sin descifrarlas**. El GCM con IV aleatorio es **no determinista** (dos cifrados de la misma CLABE dan distinto ciphertext), así que no sirve para buscar/igualar.
- Solución: `clabeHmac` = **HMAC-SHA256(clabe_normalizada, PII_HMAC_KEY)**, determinista, guardado junto al `clabeEnc`. El match se hace comparando HMACs.
- **Llave separada** `PII_HMAC_KEY` (distinta de `PII_ENCRYPTION_KEY`): así, comprometer una no habilita descifrar ni recomputar el índice de la otra; además el HMAC con llave evita ataques de diccionario sobre el espacio pequeño de CLABEs (10^18 pero enumerable).
- **Comparación en tiempo constante** (`crypto.timingSafeEqual`) para no filtrar coincidencias por temporización.
- Normalización previa (quitar espacios, validar 18 dígitos) antes del HMAC, para que la comparación sea estable.
- Firma de referencia:
  ```ts
  clabeBlindIndex(clabe: string): string;          // HMAC-SHA256 hex/base64, determinista
  ```

#### c) Enmascarado por defecto en todas las respuestas

- **Por defecto, toda respuesta enmascara PII**, en cliente y back-office, **incluido `super_admin`**. Coherente con el contrato (§preámbulo y endpoints `me/kyc`, `me/billing-profile`, `admin/buylist/:id`, `admin/users/:id`).
- Formato: **CLABE → `****1234`** (solo últimos 4 dígitos, campo `clabeMasked`); **RFC → parcial** (ej. `XAX**********`, campo `rfcMasked`). El servicio expone helpers `maskClabe()` / `maskRfc()` y los DTO **nunca** contienen el campo en claro ni el blob `*Enc`/`*Hmac`.
- **Única excepción:** `GET /admin/buylist/:id/reveal-clabe` — devuelve la **CLABE de 18 dígitos en claro**. Requisitos acumulativos:
  - rol **`super_admin`**,
  - **`MoneyOutGuard`** (misma puerta que pagos SPEI / reembolsos / recompra),
  - **auditado** en `AuditLog` (`action: buylist.reveal_clabe`, quién/cuándo/qué `SellRequest`),
  - **fallback:** si `SellRequest.clabeSnapshotEnc` falta, descifra la CLABE desde `KycProfile.clabeEnc` del usuario dueño.
- Este endpoint es el **único** punto de todo el sistema que devuelve CLABE en claro; su propósito es que el súper-admin la copie a su banca al ejecutar el SPEI manual.

#### d) Retención de imágenes de INE

- Las imágenes de INE (`KycProfile.ineFrontKey`, `ineBackKey`) son la PII de mayor sensibilidad y **no se necesitan indefinidamente** tras verificar KYC. Se purgan por **retención con dial**.
- **Dial** `INE_RETENTION_DAYS` (declarado en §8): antigüedad máxima de las imágenes de INE en el bucket.
- **Primera capa — job invocable** (BullMQ, en la familia de `jobs/`): recorre los `KycProfile` cuyas imágenes superan `INE_RETENTION_DAYS` desde su carga/verificación, **borra los objetos** (`ineFrontKey`/`ineBackKey`) del object storage, **limpia las columnas de key** (a `null`) y **audita** la purga (`action: kyc.ine_purged`, `AuditLog`). Es **invocable** (bajo demanda por súper-admin además de programado), idempotente y seguro de re-ejecutar.
- **Segunda capa — lifecycle del bucket:** regla de expiración en el object storage sobre el prefijo de INE, como red de seguridad si el job no corriera (defensa en profundidad; devops la configura).
- **Qué se conserva:** los **metadatos de KYC** (`kycStatus`, `verifiedBy`, `verifiedAt`, límites) permanecen — no se borra el perfil ni el historial de verificación; **solo se purgan las imágenes**. Tras la purga, el contrato sigue exponiendo `ineOnFile: boolean` (que pasará a `false`).

Notas de coherencia:
- El contrato (`API_CONTRACT.md`) **nunca** expone `*Enc`/`*Hmac` ni CLABE/RFC en claro fuera de `reveal-clabe`; §3.4 es el respaldo de esa promesa.
- La proyección reducida de `vault_operator` (sin CLABE/RFC/INE) opera **antes** del enmascarado: a ese rol no le llega ni el campo enmascarado sensible cuando el contrato así lo indica.

### 3.5 Estándar de condición del raw = solo Near Mint (NM)

- El raw se opera **únicamente en NM** en TODO el marketplace (Compra, inventario, filtros, buylist). El enum `RawCondition` queda reducido a `NM` (ver §3.2 InventoryItem y §11 Migraciones).
- **Nomenclatura legible (i18n del front, NO en la API):** el código `NM` es el único valor que viaja por el contrato. Los **labels/descripciones legibles viven en `frontend/src/i18n/messages/{es,en}.json`** (propiedad de frontend/ux-ui), no en el backend. Texto canónico de referencia que el front debe reflejar:
  - **ES:** `NM` = **"Casi nueva (Near Mint)"** — *"Como nueva; a lo mucho imperfecciones mínimas. Bordes limpios y superficie sin rayones notorios."*
  - **EN:** `NM` = **"Near Mint"** (espeja el texto ES).
- **Política de compra NM-only (buylist):** "Solo compramos cartas en Near Mint (NM); si al recibir/verificar no está en NM, no se compra." Copy visible en cotizador, guía de envío y términos (front). Carta recibida no-NM → `rechazada` (no se paga) → devolución 7 días a costo del usuario, abandono a 30 días; **una carta abandonada no-NM NO entra al inventario vendible** (se segrega/descarta). No existe grado distinto de NM que registrar; el "no-NM" es un resultado de verificación que **rechaza** el item, no un valor de `rawCondition`.

### 3.6 Sellado como línea de venta (productType=sealed)

- El sellado es una **línea de venta de primera clase** en Compra, distinta de raw/graded.
- **Sin `rawCondition`, sin `gradingCompany`/`gradeValue`, sin rareza** (no aplica taxonomía de carta individual). Puede referenciar un `Card`/`CardSet` para nombre/imagen del producto, pero no lleva condición ni rareza.
- **Precio SIEMPRE manual del admin en MXN**: no hay fuente automática en el MVP (pokemontcg.io no cubre sellado; PriceCharting = fase 2). El `listPriceCents` se fija a mano (override manual) y es **obligatorio para publicar**: sin precio, el sellado queda como "precio pendiente" y **no aparece en Compra** (regla general — el comprador nunca ve precio pendiente).
- `sealedSubtype?` (`box | etb | bundle | tin | blister`) opcional; alimenta el filtro de tipo de producto en Compra (subfaceta informativa).
- **Disputa de sellado (v1.2):** aplica a caja **dañada/equivocada** (no hay "condición NM" que comparar). **La evidencia se envía por correo a soporte** (no hay foto de ingreso ni comparador; ver §Dispute). El flujo reutiliza `Dispute` con `type=condition_sealed`.

---

## 4. Módulos y límites

### 4.1 PricingProvider (intercambiable)
Interfaz (pseudocódigo, en `modules/pricing`):
```ts
interface PricingProvider {
  readonly source: PriceSource;               // pokemontcg_io | pokemonpricetracker | poketrace | manual
  supports(productType: ProductType): boolean;
  // Devuelve precio USD (o MXN si la fuente ya da MXN) o null si la fuente no tiene precio.
  fetchPrice(input: { card: Card; productType: ProductType; gradeKey: string }): Promise<PriceQuote | null>;
}
```
Implementaciones MVP:
- `PokemonTcgIoProvider` → raw/singles (TCGPlayer "Market Price" vía pokemontcg.io).
- `PokemonPriceTrackerProvider` / `PokeTraceProvider` → graded y sealed (free tier).
- `ManualOverrideProvider` → override del admin (siempre disponible como respaldo).

`PricingService` orquesta:
1. Elige provider según `productType` leyendo el dial de M10 (`pricing_provider_*`).
2. **Solo pricea cartas en bóveda** (no el catálogo completo) y con **cache diario** (revisa `PriceReference` del día antes de llamar la API).
3. Aplica **FX + colchón** (`FxService`) para obtener `priceMxnCents`.
4. Si el provider devuelve `null` y no hay override → crea `PendingPriceEntry` y expone el estado **"precio pendiente"** (no vendible; escalado al dueño).
5. Respeta rate-limit del free tier vía cola BullMQ.

### 4.2 AcquisitionPricer (buylist) — tabla de precio por RAREZA OFICIAL (v1.3.1)

> **Reemplaza** el esquema de 3 categorías (`RARITY_MAP` + `BuylistCategory`). El monto a pagar por el buylist
> se resuelve con una **regla por rareza oficial de Pokémon** (la de `Card.rarity`, tal cual pokemontcg.io),
> editable desde **M2** sin redeploy. PROJECT.md §E.1, criterios 12/12b/12c/18.

**Modelo de config (diales M2, persistidos en `ConfigSetting`):**
- `BUYLIST_PRICE_RULES` (`buylist_price_rules`): mapa **`{ [rarity: string]: BuylistRule }`** donde
  `BuylistRule = { mode: 'fixed' | 'pct', value: number }`.
  - `mode='fixed'` → `value` = **monto MX$ en centavos** (entero ≥ 0). **No requiere** referencia de mercado → siempre cotiza.
  - `mode='pct'`  → `value` = **porcentaje** (número en `[0, 100]`) del **precio de referencia** del día.
- `BUYLIST_PRICE_FALLBACK_PCT` (`buylist_price_fallback_pct`): **porcentaje** (default **40**) que se aplica a
  cualquier rareza **sin regla explícita** (rareza nueva tras un sync, o no configurada). Es un `pct` implícito.

**Función pura (pseudocódigo — reemplaza a `quoteAcquisition(category, ref)`):**
```ts
type BuylistRuleMode = 'fixed' | 'pct';
interface BuylistRule { mode: BuylistRuleMode; value: number; }   // value = cents si fixed, % si pct

function quoteAcquisition(
  rarity: string | null,
  referenceMxnCents: number | null,
  rules: Record<string, BuylistRule>,       // BUYLIST_PRICE_RULES
  fallbackPct: number,                       // BUYLIST_PRICE_FALLBACK_PCT (default 40)
): { quotedPriceCents: number|null; status: 'cotizada'|'precio_pendiente';
     appliedRule: BuylistRule; ruleSource: 'rule'|'fallback'; } {
  // 1) Busca regla por la RAREZA OFICIAL real (exact match sobre Card.rarity).
  const explicit = rarity != null ? rules[rarity] : undefined;
  const rule: BuylistRule = explicit ?? { mode: 'pct', value: fallbackPct };  // sin regla → fallback %
  const ruleSource = explicit ? 'rule' : 'fallback';

  // 2) FIXED: monto fijo en centavos; nunca depende de la referencia → siempre 'cotizada'.
  if (rule.mode === 'fixed') {
    return { quotedPriceCents: rule.value, status: 'cotizada', appliedRule: rule, ruleSource };
  }
  // 3) PCT: % de la referencia; si falta referencia → 'precio_pendiente' (escala al dueño, nunca se descarta).
  if (referenceMxnCents == null) {
    return { quotedPriceCents: null, status: 'precio_pendiente', appliedRule: rule, ruleSource };
  }
  return { quotedPriceCents: Math.round(referenceMxnCents * rule.value / 100),
           status: 'cotizada', appliedRule: rule, ruleSource };
}
```

**SEC-A1 (guardarraíl intacto):** la `rarity` que determina el monto se **deriva server-side de la carta real**
(`Card.rarity` por `cardId`), **nunca** del DTO del cliente. Un DTO malicioso no puede elegir regla ni inflar el
monto; el cliente ya **no envía** `category` (removida del contrato). La **condición de compra es siempre NM**
(§3.5); no hay grados que discriminen la tarifa.

**Fallback = % default (decisión del humano, PROJECT §E.1 / pregunta abierta 2 resuelta):** una rareza sin regla
**no** deja la carta en "precio pendiente" por sí sola; se cotiza con `BUYLIST_PRICE_FALLBACK_PCT`. Solo cae en
**"precio pendiente"** si la regla efectiva es `pct` **y** falta la referencia de mercado (`referenceMxnCents ==
null`). Las reglas `fixed` **nunca** quedan pendientes (no dependen de la referencia). El "precio pendiente" es un
estado de adquisición/back-office (`SellItemStatus=precio_pendiente`, escala al dueño vía `PendingPriceEntry`) y
**nunca** se muestra al comprador (regla de Compra, §4.9).

**Seed inicial (preserva el negocio vigente; editable por el dueño en M2):**
```jsonc
// BUYLIST_PRICE_RULES
{
  "Common":       { "mode": "fixed", "value": 50  },   // MX$0.50
  "Uncommon":     { "mode": "fixed", "value": 50  },   // MX$0.50
  "Reverse Holo": { "mode": "fixed", "value": 150 }    // MX$1.50
}
// BUYLIST_PRICE_FALLBACK_PCT = 40
```
Todo lo demás (Rare Holo, EX/GX/V/VMAX/VSTAR, Ultra Rare, Illustration Rare, Special Illustration Rare, Full Art,
Alternate Art, Trainer Gallery, Character Rare, Radiant, Hyper/Secret/Rainbow, etc.) **cae al fallback = 40% de la
referencia**, reproduciendo el resultado del antiguo `ex_plus`. **Granularidad por rareza (pregunta abierta 3
resuelta):** cada fila tiene su propio `value`, así que el dueño puede fijar un % distinto por rareza (ej.
Illustration Rare 45%, Secret Rare 35%) sin tocar código; el default es 40% para todas las de porcentaje.

**NOTA para PO/humano (rareza `Rare` no-holo):** el `RARITY_MAP` legacy mapeaba `Rare` (no-holo) → `comun`
($0.50 fijo). El seed v1.3.1, siguiendo la instrucción "todo lo demás = 40%", **no** siembra `Rare` como fixed,
así que por defecto `Rare` cae al fallback 40%. Si el negocio quiere conservar $0.50 fijo para `Rare`, el dueño
añade una fila `"Rare": { mode: "fixed", value: 50 }` en M2 (cambio de dato, sin deploy). Cambio deliberado y
reversible desde el editor.

**Alcance = solo buylist (pregunta abierta 4 resuelta):** esta tabla afecta **únicamente** la cotización de
compra al usuario (buylist). El **costo de aportación en especie** del inventario propio sigue usando su dial
propio (`aportacion_pct`, default 70%); no se toca.

### 4.3 Integración Stripe (payments)
- Checkout crea `PaymentIntent` (o Checkout Session) con líneas: subtotal, **fee de procesamiento trasladado**, **IVA 16%**. El total cobrado incluye ambas.
- Webhooks (endpoint único, firma verificada con `STRIPE_WEBHOOK_SECRET`). Detalle de estados en §3.3 y en `API_CONTRACT.md §9`:
  - `payment_intent.succeeded` → `Order.status=settled`, `ownershipStatus=settled` (o liquida el envío).
  - `payment_intent.payment_failed` / `payment_intent.canceled` → libera la reserva de compra o cancela el envío en `solicitado`.
  - `charge.refunded` → **total** ⇒ `Order.status=refunded`; **parcial** ⇒ no cambia el estado (conciliación M7). En ningún caso re-agrega el item (VENTAS FINALES).
  - `charge.dispute.created` → `Order.status=chargeback`, **consciente del estado físico**: revierte el item **solo si sigue en bóveda**; si ya se envió/entregó marca `chargebackNeedsManual` sin re-agregar.
  - `charge.dispute.closed` / `charge.dispute.funds_reinstated` → cierre: ganamos ⇒ `settled` (`disputeOutcome=won`), perdemos ⇒ `chargeback` (`disputeOutcome=lost`).
- Idempotencia por `event.id` (tabla `ProcessedStripeEvent`) para no reprocesar; el evento se marca procesado **solo tras éxito** del handler (si falla, se re-lanza y Stripe reintenta).
- El **fee trasladado** se calcula con gross-up para que la plataforma reciba neto ≈ subtotal+IVA (fórmula exacta: ver Preguntas para el humano).

### 4.4 Back-office M1–M10
Mapa módulo→endpoint en `API_CONTRACT.md §admin`. Autorización por rol/acción (§7).

### 4.5 i18n
Ver §6. El backend expone **enums y `errorCode`s**, no textos traducidos.

### 4.6 Generación de folios y ubicaciones
- Folio: secuencia Postgres `inventory_folio_seq` → formato `INV-` + zero-pad 6 (`INV-000123`). Se asigna al crear el `InventoryItem` en transacción para evitar colisiones.
- Ubicación: `VaultLocation` con `(zone, box, row, slot)` único; `label` derivado para picking legible.

### 4.7 Login con Google (OAuth / ID token)
- Endpoint `POST /api/v1/auth/google` recibe `{ idToken }` (Google Identity Services, flujo del front con `NEXT_PUBLIC_GOOGLE_CLIENT_ID`).
- **Verificación server-side obligatoria** del ID token antes de emitir JWT propios (usar `google-auth-library` o verificación JWKS equivalente). Se validan:
  - **firma** contra las llaves públicas de Google (JWKS),
  - `aud` == `GOOGLE_CLIENT_ID` (env backend),
  - `iss` ∈ `{ accounts.google.com, https://accounts.google.com }`,
  - `exp` no expirado,
  - `email_verified == true` (si no, `403 GOOGLE_EMAIL_UNVERIFIED`).
- Del token verificado se toman `sub` (→ `googleId`), `email`, `name`, `picture` (→ `avatarUrl`). **Nunca** se toma `role` ni ningún privilegio del token.
- Flujo: buscar por `googleId`; si no, por `email` verificado (account-linking, §3.2); si no existe, **crear** `User` (`authProvider=google`, `role=customer`, `emailVerified=true`, `passwordHash=null`).
- Respuesta: **mismo shape que `/auth/login`** → `{ user, accessToken, refreshToken }`. A partir de ahí la sesión es idéntica a la de email/contraseña (mismos JWT, mismos guards).
- El linking se audita (`AuditLog action=auth.google_link`). Env: `GOOGLE_CLIENT_ID` (backend), `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (front) — ver §8.

### 4.7bis Gestión de usuarios por admin (M6, `super_admin`) — reset de contraseña sin correo + borrado híbrido (v1.3.1)

Dos capacidades de M6, ambas **solo `super_admin`** y **auditadas** (M10); ninguna es dinero saliente (no
requieren `MoneyOutGuard`), pero **sí** tocan credenciales/PII, así que su registro en `AuditLog` guarda **solo
IDs/flags, nunca el secreto ni la PII**.

**a) Reset de contraseña iniciado por admin (SIN email transaccional).** `POST /admin/users/:id/reset-password`.
El MVP no manda correos, así que el admin **genera** una contraseña temporal y **se la entrega al usuario por su
propio canal**. Implementación:
- Genera un secreto de **alta entropía** (p. ej. ≥ 16 chars aleatorios de un alfabeto seguro / `crypto`), lo
  **hashea con argon2** (misma rutina que `/auth/register`) y lo guarda en `passwordHash`.
- **Devuelve `tempPassword` en claro UNA sola vez** en la respuesta; **nunca** se persiste en claro, no se
  re-consulta, no se loguea, no entra al `AuditLog` (solo `action=user.reset_password`, actor y target).
- **Revoca sesiones vivas** incrementando `User.tokenVersion` (los refresh/access con versión previa dejan de ser
  válidos). Setea `mustChangePassword=true` (opcional de consumir por el front: tras el primer login, forzar
  "cambiar contraseña"). Si el repo aún **no** versiona tokens, backend implementa `tokenVersion` en este cambio
  (parte de M-15) o lo registra como deuda menor en `TECH_DEBT.md`.
- Habilita login local incluso en cuentas solo-Google (`passwordHash` pasa de null a hash).

**b) Borrado de usuario híbrido hard/soft.** `DELETE /admin/users/:id`. Decide el modo según **si el usuario tiene
historial económico**:
- **Predicado "tiene transacciones"** = existe ≥ 1 fila en `Order` **o** `SellRequest` **o** `ShipmentRequest`
  **o** `Dispute` **o** `InventoryItem(ownerUserId=:id)`. Las relaciones no económicas
  (`Address`/`BillingProfile`/`KycProfile`/`PortfolioSnapshot`) no cuentan (se borran/anonimizan en ambos modos).
- **HARD** (predicado falso): `DELETE` real del `User`; los dependientes con `onDelete: Cascade`
  (`KycProfile`/`BillingProfile`/`Address`/`PortfolioSnapshot`) caen por cascada. Se purga la **imagen de INE**
  del object storage (reusa la rutina de purga §3.4d) antes/junto al borrado.
- **SOFT** (predicado verdadero): conserva las filas económicas por integridad contable/legal y auditoría; marca
  `status=deleted`, `deletedAt`, `anonymizedAt`, revoca tokens (`tokenVersion++`), `passwordHash=null`. **Anonimiza
  PII**: `email`→placeholder único (`deleted+<uuid>@anon.invalid`), `name`→`"Usuario eliminado"`,
  `phone`/`avatarUrl`/`googleId`→null; en `KycProfile`/`BillingProfile` borra `clabeEnc`/`clabeHmac`/`rfcEnc`/
  `legalName` y purga INE; conserva solo metadatos no-PII. Los snapshots económicos históricos
  (`billingSnapshot`, `clabeSnapshotEnc`) no se reescriben salvo mandato legal (bandera para seguridad/legal).
- **Idempotente** (re-`DELETE` sobre soft-deleted = no-op `mode:"soft"`); `409 CANNOT_DELETE_SELF` si el actor es
  el propio usuario. Auditado (`action=user.delete`, con `mode`).

**Enum:** `UserStatus` gana el valor **`deleted`** (M-15). `PATCH /admin/users/:id/status` sigue aceptando solo
`active|blocked`; a `deleted` se llega **únicamente** por el `DELETE` (soft). El guard de auth y ambos endpoints de
login tratan `deleted` como no-autenticable (`403 USER_BLOCKED`).

### 4.8 Sync de catálogo desde pokemontcg.io (M2) — `super_admin`, auditado
Ingesta de **datos de catálogo** (Card/CardSet, en inglés, no se traduce). Alimenta las facetas de Compra (§4.9). Endpoints en `API_CONTRACT.md §M2`. Servicio `CatalogSyncService` en `modules/catalog`.
- **`GET /admin/catalog/remote-sets`**: consulta `/v2/sets` de pokemontcg.io; devuelve `[{ id, name, series, releaseDate, printedTotal, imported, cardCount }]` ordenado por `releaseDate` desc. `imported` = si ya existe el `CardSet` local (join por `externalId`); `cardCount` = cartas locales del set.
- **`POST /admin/catalog/sync`** body `{ setId?, fromReleaseDate? }`: importa/actualiza cartas.
  - `setId` presente → importa ese set puntual (query `q=set.id:<setId>`).
  - sin `setId` → importa todos los sets con `releaseDate >= fromReleaseDate`; **default `fromReleaseDate` = dial `catalog_sync_from_date` = `2024/01/01`** (formato pokemontcg.io `yyyy/MM/dd`).
- **`POST /admin/catalog/backfill`** body `{ batchSize?=10, untilYear? }`: importa el **siguiente lote de sets más antiguos aún no importados** (colecciones anteriores a la frontera actual), en orden `releaseDate` **asc** desde los más antiguos disponibles hacia la frontera, tomando `batchSize` sets. Se detiene si alcanza `untilYear`. Respuesta `{ imported: [{ id, name, releaseDate, cardCount }], newBoundary, remaining }` (`newBoundary` = releaseDate del set más antiguo ya importado tras el lote; `remaining` = sets aún sin importar). **Repetible** hasta `remaining=0`.
- **Guardarraíles de seguridad (anti-inyección / anti-SSRF):**
  - Validar `setId` contra `^[a-z0-9]+(-[a-z0-9]+)*$` **antes** de interpolarlo en `q=set.id:<setId>` (previene inyección en el query param de la API remota). Rechazo `422 VALIDATION_ERROR` si no cumple.
  - **Host fijo** (base URL de pokemontcg.io hardcodeada/env, sin parte controlable por el usuario) → sin SSRF; el cliente HTTP no acepta URLs arbitrarias.
  - `fromReleaseDate` validado como fecha `yyyy/MM/dd`.
  - Autenticación con `POKEMONTCG_IO_API_KEY`; rate-limit vía la misma cola BullMQ.
- **Rarezas:** `Card.rarity` permanece **`String` libre** (captura cualquier rareza tal cual la entrega pokemontcg.io — taxonomía **abierta**, NO enum cerrado). Esto garantiza capturar rarezas modernas presentes y futuras sin migración.
- **Año del set:** se persiste `CardSet.releaseDate`; el **año** para los filtros de Compra se **deriva** de `releaseDate` (no se guarda columna redundante; ver `year` en §4.9).
- Todas las operaciones de sync son de `super_admin` y quedan en `AuditLog`.

### 4.9 Sección "Compra" (storefront) = inventario publicado con precio + facetas dinámicas
**Decisión de ruta:** se **mantiene la ruta `GET /api/v1/catalog/cards`** (no se renombra a `/shop` ni `/compra`) para no romper el contrato ya acordado; **cambia el semántico** y se documenta que "catalog" en el path es un tecnicismo interno — la superficie de producto se llama **"Compra"** (rótulo de UI, i18n del front). Renombrar la ruta añadiría churn de contrato sin beneficio funcional; el rótulo visible ya lo controla el front. *(Si en el futuro se decide alinear la ruta, sería un cambio de contrato vía arquitecto.)*
- **Regla dura:** `GET /catalog/cards` devuelve **SOLO inventario publicado CON precio de venta fijado** (`status=listed`, `sellable=true`, `salePriceCents != null`). **Excluye** items `pending`/sin precio/"precio pendiente". El comprador **nunca** ve "precio pendiente". (Esto **ajusta** la nota v1 que permitía mostrar pendientes no comprables: en v1.1 **no se listan**.)
- **Facetas dinámicas** (`GET /catalog/facets`, ver contrato) calculadas **sobre el inventario publicado** (no sobre el catálogo entero):
  - **`rarities`**: `distinct` de `Card.rarity` sobre el inventario publicado, **espejando los valores de pokemontcg.io tal cual** (taxonomía abierta, lista NO cerrada; el front no asume un conjunto fijo).
  - **`sets`**: `{ id, name, releaseDate, year }` (con `year` derivado de `CardSet.releaseDate`), solo los sets con inventario publicado, ordenados por **año desc**.
  - **`productTypes`**: subconjunto de `raw | graded | sealed` presente en el inventario publicado.
  - **rangos de precio** (min/max de `salePriceCents`) para el slider de precio.
- **Filtros** del listado: `setId`, `rarity`, `productType` (raw NM | graded | sealed), rango de precio, y `condition` (para raw solo hay `NM`).

### 4.10 Cotizador buylist sobre TODO el catálogo (Opción 1) — v1.3

Decisión del humano (**Opción 1**): el cotizador público debe poder cotizar **cualquier** carta de la tabla
`Card` (todo el catálogo importado), no solo lo comprable en "Compra" (bóveda). Esto se resuelve en **dos
piezas**, ambas **backend nuevo** (ver `API_CONTRACT.md §6` y §M2):

1. **Búsqueda pública sobre toda la tabla `Card`** — `GET /buylist/cards` (+ `GET /buylist/sets` para el
   dropdown de set). Se ubican bajo `/buylist/*` **a propósito**, separadas de `/catalog/*` (que está acotado
   a inventario publicado con precio, §4.9). El servicio consulta `Card`/`CardSet` directamente (filtros
   `setId`, `q` sobre nombre/número, `rarity` libre), paginado, **sin** tocar `InventoryItem` ni precio. El
   resultado (`CardDTO`) da el `cardId` que consume `POST /buylist/quote`. Servicio sugerido: método nuevo en
   `CatalogService` (p. ej. `searchCatalog(...)`/`listCatalogSets()`) o un `BuylistCatalogService` en
   `modules/buylist`; el arquitecto no fija la ubicación exacta, sí la interfaz del contrato.
2. **Sync de TODO el catálogo** — `POST /admin/catalog/sync-all` (super_admin, auditado, **truly-async**).
   Para que el cotizador tenga cartas que buscar hay que poblar todo el catálogo (no solo 2024+). El
   `CatalogSyncService` actual **ya** puede importar todo (`sync` con `fromReleaseDate` antiguo, o `backfill`
   repetido hasta `remaining=0`); `sync-all` es un wrapper explícito que **encola** todos los sets remotos en
   la cola BullMQ y retorna de inmediato, evitando el timeout del `sync` from-date síncrono (ver DEV-1, §9).

**Pricing del cotizador para cartas fuera de bóveda:** el `PricingService` solo pricea cartas **en bóveda**
(§4.1). Una carta `ex_plus` recién buscada en el catálogo (que no tenemos) **no** tendrá `PriceReference`, por
lo que su cotización sale `precio_pendiente` y escala a la cola del dueño al crear la solicitud (PROJECT
criterio 13, `AcquisitionPricer` §4.2). Las tarifas planas (`comun`=50, `reverse_holo`=150) **no** dependen
de referencia y se cotizan siempre. Esto es **coherente** con las reglas ya cerradas; si el humano quiere que
el cotizador **pricee on-demand** una `ex_plus` del catálogo completo (fetch puntual al `PricingProvider` en
el momento de cotizar, respetando rate-limit), es una **decisión de alcance** — ver **Pregunta abierta v1.3-1**
(§10). No se asume: el MVP mantiene el comportamiento `precio_pendiente`.

### 4.11 Verificación de correo + recuperación de contraseña self-service (v1.5-auth-email)

Decisiones de producto **cerradas por el humano**: la verificación **bloquea acciones sensibles, no el login**;
recuperación con **ambos** flujos (self-service por email **+** reset por admin existente). Proveedor de envío:
**Resend** (`no-reply@tcgvaultmx.com`).

#### a) Abstracción de correo — módulo `mail`
Desacopla el dominio de Resend (mockeable en tests, intercambiable de proveedor):
```ts
// Puerto (token DI: MAIL_PORT). Bajo nivel: enviar un correo ya renderizado.
interface MailPort {
  send(msg: { to: string; subject: string; html: string; text: string }): Promise<{ id?: string }>;
}
// Adaptadores:
//  - ResendMailAdapter   -> POST https://api.resend.com/emails con RESEND_API_KEY, from = MAIL_FROM.
//  - NoopMailAdapter     -> NO envía; loguea `to/subject` y (en no-prod) el LINK con el token en claro,
//                           para dev/CI/tests sin key. Se selecciona cuando falta RESEND_API_KEY en LOCAL_ENVS.
// Servicio de dominio (plantillas + i18n por User.locale):
class MailService {
  sendEmailVerification(user: User, link: string): Promise<void>;  // asunto+cuerpo con link
  sendPasswordReset(user: User, link: string): Promise<void>;
}
```
- **Selección del adaptador (provider factory en `MailModule`):** si hay `RESEND_API_KEY` → `ResendMailAdapter`;
  si no y el entorno es LOCAL_ENVS → `NoopMailAdapter` (degradación con aviso en log). En **no-local** la key es
  **requerida** (§8), así que ahí siempre es el adaptador real (nunca se cae silenciosamente a Noop en prod).
- **Plantillas** (bilingües ES/EN por `User.locale`, mismas convenciones i18n del §6 — el texto vive en el
  backend porque el correo se envía server-side, a diferencia de la UI):
  - **Verificación:** asunto "Verifica tu correo / Verify your email"; cuerpo con botón/enlace a
    `${APP_BASE_URL}/<locale>/verify-email?token=<claro>`; caduca en 24h.
  - **Recuperación:** asunto "Restablece tu contraseña / Reset your password"; cuerpo con enlace a
    `${APP_BASE_URL}/<locale>/reset-password?token=<claro>`; caduca en 1h; nota "si no lo solicitaste, ignóralo".
- **El link apunta al FRONTEND.** El backend construye la URL con `APP_BASE_URL` (ya existe en env, es la base del
  front usada por CORS) + prefijo de `locale`. El **nombre del query param es contrato: `token`**; la **ruta**
  exacta la posee el frontend (grupo `(auth)/`), pero se fija aquí el patrón `/<locale>/verify-email` y
  `/<locale>/reset-password` para alinear productor/consumidor. El front lee `token` y llama al endpoint POST.

#### b) Emisión y consumo de tokens (ver modelo `AuthToken`, §3.2)
- **Registro email/password** (`POST /auth/register`): tras crear el `User` (`emailVerified=false`), emite un
  `AuthToken(type=email_verification, 24h)` y envía el correo. La respuesta **no cambia de forma** salvo que el
  objeto `user` ahora incluye `emailVerified` (siempre `false` recién registrado). El fallo de envío de correo
  **no** debe abortar el registro (se registra el error; el usuario puede pedir reenvío).
- **Reenvío** (`POST /auth/verify-email/resend`): **autenticado** (`customer+`), usa el email de `req.user`
  (sin body) → **sin riesgo de enumeración** (hay que estar logueado, y el login está permitido sin verificar).
  Si ya está verificado → `200` no-op. Rota tokens previos. Rate-limit estricto (§d).
- **Verificar** (`POST /auth/verify-email`): **público** (el link se abre desde el correo, quizá sin sesión).
  Consume el token atómicamente → `User.emailVerified=true`, `usedAt=now()`. **No** toca `tokenVersion` (verificar
  no revoca sesiones). Idempotencia sugerida: si el `User` del token ya está verificado, responder `200` aunque el
  token ya esté usado (evita error por doble clic).
- **Olvidé contraseña** (`POST /auth/forgot-password`): **público**, `{ email }`. **SIEMPRE responde `200`**
  (anti-enumeración): si el email existe, emite `AuthToken(type=password_reset, 1h)` y envía el correo; si no
  existe, no hace nada pero responde igual. Rota tokens de reset previos. Para cuentas solo-Google (sin
  `passwordHash`) el reset **fija** una contraseña (habilita login local, igual que el reset admin, §4.7bis).
- **Restablecer** (`POST /auth/reset-password`): **público**, `{ token, password }`. Consume el token
  (`password_reset`, vigente, no usado); setea `passwordHash` (argon2, misma rutina que register), **incrementa
  `User.tokenVersion`** (revoca sesiones vivas — patrón existente), marca `usedAt`, limpia `mustChangePassword` si
  estaba. **Efecto:** clic exitoso en el link prueba control del inbox → también setea `emailVerified=true`
  *(decisión a confirmar, §10)*. No devuelve tokens: el usuario **re-inicia sesión** con la nueva contraseña.

#### c) Gating de acciones sensibles — `EmailVerifiedGuard` (AUTORIDAD server-side)
Nuevo guard + decorador `@RequireEmailVerified()` (en `common/`), análogo a `@MoneyOut()`/`@Roles()`. Corre
**después** de `JwtAuthGuard` (que puebla `req.user.emailVerified` desde BD). Si `emailVerified=false` → lanza
**`403 EMAIL_NOT_VERIFIED`** (el front muestra banner "verifica tu correo"). Google → `true`, no afectado.
- **Operaciones bloqueadas (mutaciones sensibles):**
  - **Comprar:** `POST /api/v1/checkout/session` (crear orden + PaymentIntent). *(El `POST /checkout/quote`
    read-only queda **abierto** para que la UI muestre precios con el banner.)*
  - **Retirar/enviar (money-out del usuario):** `POST /api/v1/shipments`. *(El `POST /shipments/quote` queda
    abierto.)*
  - **Vender (buylist):** `POST /api/v1/buylist/requests` (crear `SellRequest`). *(El `POST /buylist/quote`
    público queda abierto — es el cotizador anónimo.)*
- **No afecta** al money-out de back-office (`@MoneyOut()`, super_admin): esos son staff. Las cuentas de staff
  (`vault_operator`/`super_admin`) deben sembrarse `emailVerified=true` para no auto-bloquearse *(nota a devops)*.
- **Cómo lo sabe el front:** `GET /users/me` ya expone `emailVerified`; además el objeto `user` de
  `/auth/register|login|google` lo incluye ahora. El front decide banner/CTA a partir de ese flag; el bloqueo
  real lo hace **siempre** el guard (la UI es solo cosmética).

#### d) Anti-abuso / anti-enumeración
- **Rate-limit por endpoint** (`@Throttle`, patrón `AuthController` existente): `forgot-password` **3/hora/IP**
  (+ tope por email en servicio, p. ej. ≤ 3 tokens/hora/email); `verify-email/resend` **3/hora/usuario** (+ IP);
  `verify-email` y `reset-password` (consumo) **10/min/IP** (defensa aunque el token sea de alta entropía).
- **Respuestas genéricas:** `forgot-password` siempre `200`; el consumo de token no distingue
  inexistente/expirado/usado (un único `*_TOKEN_INVALID`).
- **Auditoría** (`AuditLog`, sin volcar el token): `auth.email_verification_sent`, `auth.email_verified`,
  `auth.password_reset_requested`, `auth.password_reset_completed`.

---

## 5. Decisiones transversales

- **Dinero sin balance:** no hay wallet ni saldo; cada movimiento de dinero es una transacción Stripe (ventas/reembolsos) o un pago SPEI manual (buylist). Ninguna vista de usuario muestra saldo.
- **Montos:** enteros en centavos MXN; IVA siempre desglosado y persistido en `Order.ivaCents` para M7/CFDI.
- **P&L (M7) — ingreso y costo de envío son cosas distintas (v1.4-finance):** el envío aporta al P&L por **dos** lados: un **ingreso** (`ShipmentRequest.shippingFeeCents`, lo que el cliente paga) y un **costo** (`ShipmentRequest.shippingCostCents`, lo que la plataforma paga a la paquetería, M-16). El P&L los suma/resta por separado: `profitCents = incomeCents + shippingRevenueCents − cogsCents − stripeFeesCents − shippingCostCents`. Ambos importes de un mismo envío se acotan al periodo por **`pickingAt`** (envíos liquidados: `status ∈ {picking, guia, enviado, entregado}`), garantizando que ingreso y costo del envío caigan en el mismo periodo. Antes de v1.4-finance el P&L solo contaba el ingreso, sobreestimando la ganancia. Response/CSV en `API_CONTRACT §M7` (`shippingCents`→`shippingRevenueCents` + nuevo `shippingCostCents`).

### 5.1 Cálculo del checkout (precio de venta, IVA y fee gross-up)
Orden de compra de cartas:
```
salePriceCents(item) = item.listPriceCents  // = round(referenciaMxn × (1 + salesMarkupPct/100)), o override manual
subtotalCents        = Σ salePriceCents(item)
ivaCents             = round(subtotalCents × ivaPct/100)                 // ivaPct default 16
baseCents            = subtotalCents + ivaCents                          // lo que la plataforma debe recibir íntegro
// Gross-up de la comisión Stripe MX (pct + fija), INCLUYENDO el IVA que Stripe cobra SOBRE su comisión:
totalCents           = ceil( (baseCents + (1 + stripeFeeIvaPct)·stripeFixedCents) / (1 − (1 + stripeFeeIvaPct)·stripePct) )
processingFeeCents   = totalCents − baseCents                            // línea visible, SIN IVA de PRODUCTO adicional
```
Retiro/envío (mismo gross-up, IVA de producto sobre el envío):
```
baseCents          = shippingFeeCents + round(shippingFeeCents × ivaPct/100)
totalCents         = ceil( (baseCents + (1 + stripeFeeIvaPct)·stripeFixedCents) / (1 − (1 + stripeFeeIvaPct)·stripePct) )
processingFeeCents = totalCents − baseCents
```
`stripePct`, `stripeFixedCents` y `stripeFeeIvaPct` son diales de M10 (tarifa MX vigente de Stripe; `stripe_fee_iva_pct` default **0.16**). La comisión efectiva de Stripe es `(1+stripeFeeIvaPct)·(pct·total + fija)` porque Stripe MX **grava su propia comisión con IVA**; el gross-up despeja `total` para que, tras esa comisión con IVA, la plataforma reciba `baseCents` íntegro. El `processingFeeCents` es lo que la plataforma cede a Stripe (comisión + su IVA), trasladado al comprador. **Aclaración:** "el fee no lleva IVA" se refiere al **IVA de PRODUCTO** — el fee no agrega una línea de IVA de venta; el IVA de la *comisión de Stripe* sí está contemplado dentro del gross-up (cierre del hallazgo C1 de la revisión de Stripe).
- **Seguridad/roles:** 3 roles. Autorización por **acción**, no solo por ruta (§7). Guard `MoneyOutGuard` exige `super_admin` para pagos SPEI y reembolsos; todo intento (permitido o bloqueado) se audita.
- **Imágenes (v1.2):** el producto **no lleva fotos propias**; se muestra la **imagen de catálogo remota** de pokemontcg.io (`Card.imageSmallUrl`/`imageLargeUrl`). La **única** subida del sistema es la **imagen del INE** del buylist (`kyc_ine`), a object storage **privado** con presigned PUT/GET y **retención** (§3.4). No hay fotos de producto/inventario ni de evidencia de disputa (la evidencia de disputa llega por correo a soporte).
- **Sync de precios/FX (jobs BullMQ):**
  - `price-sync` diario: recorre solo cartas **en bóveda**, respeta rate-limit del free tier, escribe `PriceReference` del día, genera `PendingPriceEntry` para faltantes.
  - `fx-refresh` diario: obtiene USD→MXN de **Banxico (SIE)**, aplica el colchón (`fx_buffer_pct`) y escribe `FxRate` (`source=banxico`); si falla o hay override manual (M10), usa `source=manual` como fallback/prioridad.
  - `buylist-sweep`: 7 días sin respuesta a ajuste → `rechazada`; 30 días de abandono → `convertida a inventario`.
  - `dispute-deadline`: cierra ventana de recompra a 7 días desde entrega.
  - `portfolio-snapshot` diario (tras `price-sync`): por cada usuario con holdings, calcula el valor del portafolio con `VaultService.holdings()` (a **referencia**, excluyendo pendientes) y **upsert** de `PortfolioSnapshot` del día (`@@unique[userId,asOfDate]`). Alimenta la gráfica de tendencia (§3 PortfolioSnapshot, `GET /vault/portfolio/history`). **Depende de cablear el scheduler (BE-5).**
- **Validaciones duras:** dirección de envío/retiro **debe ser MX** (rechazo si no); retiro solo sobre `settled`; carta "precio pendiente" **no comprable**; topes de buylist (por solicitud/mes) e INE sobre tope.

---

## 6. i18n (convención)

- **UI 100% bilingüe ES/EN, default ES**, toggle a EN. Los copys viven en `frontend/src/i18n/messages/{es,en}.json` (propiedad de frontend/ux-ui).
- **El contrato de datos NO se traduce.** El backend responde con:
  - **enums** estables (ej. `status: "settled"`), que el frontend mapea a texto localizado.
  - **`errorCode`** por error (ej. `PRICE_PENDING`, `ITEM_NOT_SETTLED`, `ADDRESS_NOT_MX`, `BUYLIST_LIMIT_EXCEEDED`), que el frontend traduce.
  - **datos de catálogo en inglés** (nombres/sets de pokemontcg.io) — se muestran tal cual por diseño, en ambos idiomas de UI.
- `User.locale` guarda la preferencia; el frontend también respeta el toggle de sesión.

---

## 7. Seguridad, roles y autorización por acción

| Acción | customer | vault_operator | super_admin |
|---|---|---|---|
| Storefront/compra/bóveda/retiro/buylist (como cliente) | ✅ | — | — |
| **Acciones sensibles con `emailVerified=false`** (comprar / retirar / vender) | ❌ **403 `EMAIL_NOT_VERIFIED`** (`EmailVerifiedGuard`, §4.11) | n/a | n/a |
| M1 Inventario (alta, mover, fotos, pérdida/daño) | — | ✅ | ✅ |
| M2 Precios (sync, override, FX, tabla rareza) | — | — | ✅ |
| M3 Órdenes ver | — | ✅ (solo lectura) | ✅ |
| **M3 Reembolso (dinero saliente)** | — | ❌ (bloqueado + auditado) | ✅ |
| M4 Retiros/envíos (picking, guía, estados) | — | ✅ | ✅ |
| M5 Buylist hasta **verificación** (recibir, verificar, decidir/ajustar) | — | ✅ | ✅ |
| **M5 Pago SPEI (dinero saliente)** | — | ❌ (bloqueado + auditado) | ✅ |
| M6 Usuarios/KYC | — | ver limitado | ✅ |
| M7 Finanzas/P&L | — | ❌ | ✅ |
| M8 Disputas (revisión) | — | ✅ | ✅ |
| **M8 Recompra (dinero saliente)** | — | ❌ | ✅ |
| M9 Reportes | — | ❌ | ✅ |
| M10 Config/diales | — | ❌ | ✅ |
| M10 Bitácora (lectura) | — | ❌ | ✅ |

Regla de oro: **el dinero que sale solo lo toca el súper-admin**; todo queda en bitácora.

---

## 8. Riesgos técnicos y notas para devops

Variables de entorno necesarias (sin valores; devops las gestiona):
- `DATABASE_URL`, `REDIS_URL`
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
- `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`
- `POKEMONTCG_IO_API_KEY`, `POKEMONPRICETRACKER_API_KEY`, `POKETRACE_API_KEY`
- Object storage (**SOLO INE de KYC**, v1.2): `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL`. **El set `S3_*` se conserva**, ahora justificado únicamente por `kyc_ine` (bucket **privado** + cifrado + retención `INE_RETENTION_DAYS`). No se usa para fotos de producto/inventario ni de disputa. (`S3_PUBLIC_BASE_URL` no aplica al INE, que es privado; se lee vía presign GET.)
- **PII / INE (KYC):** `PII_ENCRYPTION_KEY` (32 bytes base64, AES-256-GCM), `PII_HMAC_KEY` (blind index de CLABE, llave **separada**), `INE_RETENTION_DAYS` (antigüedad máxima de las imágenes de INE en el bucket, default **180**; ver §3.4). En prod las llaves provienen de KMS/secret manager, nunca del repo. Estas variables **se conservan intactas** (v1.2.1: INE almacenado con cifrado + retención).
- FX (automático desde Banxico SIE): `BANXICO_SIE_TOKEN` (token de la API SIE); modo override manual vía dial M10 sin token
- **Auth Google:** `GOOGLE_CLIENT_ID` (backend, para validar `aud` del ID token) y `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (frontend, Google Identity Services). Sin `client_secret` en el MVP (flujo de ID token, no code-exchange).
- **Correo (v1.5-auth-email, Resend):** `RESEND_API_KEY` (secreto) y `MAIL_FROM` (default `no-reply@tcgvaultmx.com`).
  - **Política (sigue el patrón `env.validation.ts` local/no-local):** `RESEND_API_KEY` se añade a la lista
    `required` → **obligatoria en NO-local (staging + prod)**; en LOCAL_ENVS (`development`/`test`/`local` o sin
    `NODE_ENV`) puede faltar y el sistema **degrada** a `NoopMailAdapter` (loguea el correo/link, no envía) para
    no romper dev/CI/tests sin key. `MAIL_FROM` es opcional con default en código (no bloquea el arranque).
  - **Justificación:** la verificación **gatea dinero** (comprar/vender/retirar); si el correo degradara en prod,
    los usuarios locales nunca podrían verificar → quedarían bloqueados. Por eso en no-local (incl. **staging**,
    que debe probar el flujo real E2E) la key es dura. *(Decisión a confirmar por el humano: exigir key también en
    staging; ver §10.)*
  - **Dominio remitente:** `tcgvaultmx.com` requiere SPF/DKIM/DMARC verificados en Resend (nota devops). El correo
    de soporte de disputas es `soporte@tcgvaultmx.com` — **mismo dominio canónico** que el remitente; ver §10 v1.5-2
    (**CERRADA** 2026-08-16: dominio unificado, ya no hay inconsistencia).
- `APP_BASE_URL`, `DEFAULT_LOCALE=es` (`APP_BASE_URL` = base del frontend; también se usa para construir los
  links de verificación/reset del correo, §4.11).

Riesgos técnicos:
- **Rate-limit free tier** (100/día, 250/día): mitigado priciando solo bóveda + cache diario + cola; si crece la bóveda, puede requerir plan de pago (dial permite el cambio).
- **Idempotencia de webhooks** Stripe: obligatoria para no duplicar `settled`/reversos.
- **Consistencia de titularidad**: transiciones `pending→settled` y reversión por contracargo deben ser transaccionales con `InventoryMovement`.
- **CFDI/PAC**: el MVP **registra** datos e IVA cobrado y ofrece **solicitud de factura por correo** (sin PAC); el timbrado real (PAC) es **fase 2** (bandera fiscal de PROJECT).
- **Concurrencia de venta**: un `InventoryItem` es pieza única; el checkout debe **reservar** (`status=reserved`) para evitar doble compra.

---

## 9. Desviaciones detectadas

> El arquitecto **no corrige código** (CLAUDE.md): documenta la desviación y la enruta al **rol dueño**
> (backend). Estado del código revisado el **2026-08-16** (plataforma ya en producción; back-office M1–M10 con
> backend en su mayoría implementado; **M7 ya tiene UI consumidora real** —`admin/m7/M7View.tsx`—, el resto de
> módulos sigue con UI en `ModuleTodo` pendiente de consumir).

- **DEV-1 (backend) — `POST /admin/catalog/sync` importa de forma SÍNCRONA en el request.** El contrato
  declara `202 { jobId, setsQueued, mode }` (semántica async/encolada), pero `CatalogSyncService.sync()`
  recorre e importa **todos** los sets `>= fromReleaseDate` **dentro del handler HTTP** (await inline por set y
  por página de cartas). Para un sync acotado a 2024+ es tolerable, pero para un **sync de todo el catálogo**
  (Opción 1, cientos de sets / decenas de miles de cartas) **provoca timeout** del request y no respeta la
  cola/rate-limit prometidos. **Acción (backend):** implementar el nuevo `POST /admin/catalog/sync-all`
  encolando en BullMQ (truly-async) y, deseablemente, alinear `sync` from-date al mismo patrón encolado. El
  `backfill` repetible **sí** es seguro (importa por lotes) y es el camino recomendado mientras `sync-all` no
  encole de verdad. Registrar en `docs/TECH_DEBT.md` si se difiere.
- **DEV-2 (informativo, no bloqueante) — `jobId` cosmético en sync/backfill.** Los métodos devuelven
  `jobId: \`catalog-sync-${Date.now()}\`` sin un job real detrás (la importación ya ocurrió síncrona). Es
  coherente con DEV-1: al encolar de verdad, el `jobId` debe ser el de la cola. Sin impacto de contrato para
  el front (trata el `jobId` como opaco).

Fuera de estos puntos, el código revisado (M2, M6, M7, M9, M10, buylist, catalog, pricing) **concuerda** con
este documento y con `API_CONTRACT.md`.

---

## 10. Decisiones resueltas (antes "Preguntas para el humano")

### Preguntas abiertas (v1.3 — Cotizador Opción 1)
> No bloquean el arranque del trabajo (backend puede implementar `GET /buylist/cards`, `GET /buylist/sets` y
> `POST /admin/catalog/sync-all` ya). El arquitecto **no asume** reglas de negocio (CLAUDE.md).
- **v1.3-1 — ¿pricing on-demand del cotizador para `ex_plus` fuera de bóveda?** Hoy una carta `ex_plus` del
  catálogo completo sin `PriceReference` sale `precio_pendiente` (coherente con PROJECT criterio 13). ¿El
  humano quiere que el cotizador dispare un **fetch puntual** al `PricingProvider` en el momento de cotizar
  (mejor UX, pero consume cuota del free tier fuera de la bóveda y puede tentar abuso del endpoint público)?
  **Default propuesto (MVP):** **no** priciar on-demand; mantener `precio_pendiente` + escalado al dueño.
  Requiere confirmación para cerrarse.
- **v1.3-2 — Búsqueda pública sobre todo el catálogo: ¿rate-limit / anti-scraping?** `GET /buylist/cards` es
  público y consulta la tabla `Card` completa. Recomendación técnica (no de negocio): aplicar rate-limit por
  IP y `pageSize` acotado (≤100). Confirmar si se quiere además exigir sesión (`customer`) para reducir
  scraping del catálogo. **Default propuesto:** público con rate-limit; sin sesión obligatoria.

### Preguntas abiertas (v1.5-auth-email — verificación de correo + recuperación)
> No bloquean el arranque: backend puede implementar el módulo `mail`, el modelo `AuthToken` (M-17), los
> endpoints y el `EmailVerifiedGuard` con los defaults propuestos. El arquitecto **no asume** reglas de negocio.
- **v1.5-1 — ¿Exigir `RESEND_API_KEY` en staging (además de prod)?** Default propuesto: **sí** (staging es
  no-local → key dura, para probar el flujo real E2E; degradación Noop solo en LOCAL_ENVS). Confirmar.
- **v1.5-2 — Dominio remitente vs soporte. (CERRADA 2026-08-16)** El humano confirmó el dominio canónico único
  `tcgvaultmx.com`: `MAIL_FROM` = `no-reply@**tcgvaultmx.com**` y soporte de disputas = `soporte@**tcgvaultmx.com**`
  (**mismo dominio**, ya no hay inconsistencia). Pendiente operativo (no de arquitectura): verificar SPF/DKIM/DMARC
  en Resend para `tcgvaultmx.com` (nota devops).
- **v1.5-3 — ¿El reset exitoso marca `emailVerified=true`?** Default propuesto: **sí** (clic en el link de reset
  prueba control del inbox). Si el humano prefiere separar ambos conceptos, se deja `emailVerified` intacto en el
  reset. Confirmar.
- **v1.5-4 — Reenvío de verificación: ¿autenticado (recomendado) o público por email?** Default propuesto:
  **autenticado** (`customer+`, usa `req.user`) → cero enumeración. Alternativa (público `{ email }` + siempre
  `200`) añade superficie de abuso; no se adopta salvo que el humano lo pida.
- **v1.5-5 — ¿Gating adicional?** Hoy se bloquean solo las **mutaciones** de comprar/retirar/vender. ¿El humano
  quiere bloquear también algo más (p. ej. guardar CLABE/INE en KYC, o `request-invoice`)? Default: **no** — solo
  las tres acciones listadas; el resto queda navegable con banner. Confirmar si se amplía.
- **v1.5-6 — Cuentas de staff.** `vault_operator`/`super_admin` deben sembrarse `emailVerified=true` (no reciben
  correo de verificación al no registrarse por el flujo público). Nota para devops/seed; confirmar que el seed lo hace.

### Decisiones ya resueltas
Las 6 ambigüedades quedaron resueltas por el humano (2026-08-13) y se integran como decisiones firmes en este documento y en el contrato. Se conservan aquí como registro.

1. **Precio de venta = referencia del día + MARKUP configurable (dial M10).** El **valor de mercado** que se muestra es la **referencia** (`priceMxnCents` de `PriceReference`). El **precio de venta** es `round(referenciaMxn × (1 + salesMarkupPct/100))`. `salesMarkupPct` es un dial de M10 (`sales_markup_pct`). Se persiste como `InventoryItem.listPriceCents` al listar (o se calcula al vuelo si null) y se congela en `OrderItem.unitPriceCents` al checkout. En los DTOs se distingue `referenceValue` (valor de mercado) de `salePrice` (precio de venta). El override manual de precio puede fijar directamente el `listPriceCents` sin aplicar markup.
2. **Fee de procesamiento Stripe = GROSS-UP.** El fee trasladado se calcula para que, tras la comisión de Stripe (tarifa MX **más el IVA que Stripe cobra sobre su comisión**), la plataforma reciba **íntegro** `subtotal + IVA`. Fórmula vigente (ver §5.1, refinada por el hallazgo C1): `total = (base + (1+stripeFeeIvaPct)·fija) / (1 − (1+stripeFeeIvaPct)·pct)`, `fee = total − base`, donde `base = subtotal + IVA`. Se persiste en `Order.processingFeeCents` y es una línea visible del `BreakdownDTO`. El fee **no** lleva IVA de **producto** adicional.
3. **IVA 16% sobre `subtotal + envío`.** El IVA grava el subtotal de cartas **y** la tarifa de envío (servicio gravado). El **fee de procesamiento va tal cual (sin IVA)**. Default a validar con contador. En compras de carrito el `ivaCents = round((subtotal) × ivaPct/100)`; en retiros `ivaCents = round(shippingFee × ivaPct/100)`.
4. **CFDI sin PAC en el MVP.** No se integra PAC ni se timbra en el MVP. El flujo de factura es **manual por correo**: la UI muestra la instrucción de que, para pedir factura, el cliente envíe un correo con sus datos fiscales. El sistema guarda el **IVA cobrado por orden** (M7) y un flag `invoiceRequested` (opcional) por orden. **Timbrado real = fase 2.** `CfdiStatus` se reduce a `registrado | no_aplica` en MVP (`emitido` queda reservado para fase 2).
5. **FX USD→MXN automático (Banxico) + colchón + override manual.** Job diario `fx-refresh` obtiene el tipo de cambio de una fuente tipo **Banxico** (SIE), aplica el **colchón** (`fx_buffer_pct`, dial M10) y escribe `FxRate` (`source=banxico`). Si el fetch falla o el admin fija un override, se usa `FxRate` con `source=manual` (dial M10) como fallback; el override tiene prioridad sobre el valor automático del mismo día.
6. **Cobro del envío por Stripe ANTES de generar la solicitud de retiro.** El retiro cobra la tarifa fija (+ IVA) vía `PaymentIntent` de Stripe; la `ShipmentRequest` se crea en `solicitado` con el `PaymentIntent` asociado y solo se procesa (picking) una vez liquidado (webhook `payment_intent.succeeded`). No hay wallet.

---

## 11. Migraciones requeridas (v1.1 + v1.2/v1.2.1 + v1.3.1 — 2026-08-16)

Cambios de esquema Prisma que backend debe migrar. Proyecto **greenfield sin backfill de datos** (aún no hay filas productivas); las migraciones solo redefinen esquema.

### v1.5-auth-email (nueva — verificación de correo + recuperación self-service)

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-17 | **`AuthToken`** (modelo nuevo) + enum **`AuthTokenType = email_verification | password_reset`** | **Create table** + **add enum** | Create table / add enum | `AuthToken`: `id` (uuid), `userId` (FK `User`, `onDelete: Cascade`), `type` (`AuthTokenType`), `tokenHash` (`String @unique`, SHA-256 del token en claro — **nunca** el claro), `expiresAt` (`DateTime`), `usedAt` (`DateTime?`), `requestIp` (`String?`), `createdAt`. Índices `@@unique([tokenHash])`, `@@index([userId, type])`, `@@index([expiresAt])`. Un solo uso; expira 24h (verificación) / 1h (reset). Ver §3.2, §4.11. `User` gana la relación `authTokens AuthToken[]`. Greenfield: sin backfill. **No** cambia `User.emailVerified` (ya existe, M-6) ni `tokenVersion` (ya existe, M-15). |

### v1.4-finance (nueva — costo real de paquetería en el P&L)

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-16 | `ShipmentRequest.shippingCostCents` | **Nuevo** `Int @default(0)` (costo real MXN que la plataforma paga al carrier) | Add column (con default 0) | Aditivo; **NO** toca `shippingFeeCents` (ingreso). Se captura en M4 al asignar carrier/guía (`POST /admin/shipments/:id/tracking`), opcional y editable, validación de app **entero ≥ 0**. El `@default(0)` cubre filas históricas/sin captura para no romper el P&L (§M7). Greenfield: sin backfill. |

### v1.3.1 (nuevas — precio de buylist por rareza)

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-14 | `SellRequestItem`: `rarity` `String?`, `ruleMode` `BuylistRuleMode?`, `ruleValue` `Int?`, `ruleSource` `String?`; enum nuevo **`BuylistRuleMode = fixed | pct`** | **Añadir** columnas + enum; **deprecar** `SellRequestItem.category` (pasa a **nullable**, ya no se escribe) | Add column / add enum / alter column nullable | Snapshot de la regla aplicada por rareza (§3.2, §4.2). `BuylistCategory` se conserva en el schema por retención legacy pero queda deprecado; nada nuevo lo usa. Greenfield: sin backfill. Los diales `buylist_price_rules` / `buylist_price_fallback_pct` son `ConfigSetting` (no requieren columna dedicada). |
| M-15 | `User`: `deletedAt` `DateTime?`, `anonymizedAt` `DateTime?`, `mustChangePassword` `Boolean @default(false)`, `tokenVersion` `Int @default(0)`; enum **`UserStatus`** gana valor **`deleted`** | **Añadir** columnas + valor de enum | Add column / alter enum | Gestión de usuarios M6 (§4.7bis): reset de contraseña por admin (revoca tokens vía `tokenVersion`, opcional `mustChangePassword`) y borrado híbrido hard/soft (soft ⇒ `status=deleted` + anonimización PII). El JWT debe incluir `tokenVersion` y el guard rechazar versiones desactualizadas. Greenfield: sin backfill. |

### v1.2 / v1.2.1 (nuevas)

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-12 | `InventoryItem.certNumber` | **Nuevo** `String?` (nº de certificado PSA/CGC) | Add column | Solo para `productType=graded`; **requerido a nivel de aplicación para publicar** una gradeada (validación de servicio, no NOT NULL en BD porque raw/sealed lo dejan null). Sin validación automática contra la graduadora. |
| M-13 | `InventoryItem.frontPhotoKey` / `backPhotoKey` / `extraPhotoKeys`; `SellRequestItem.photoKeys`; `Dispute.ingressPhotoKeys` / `claimPhotoKeys` | **Eliminar** (producto sin fotos propias; disputa por correo) | Drop column | Greenfield: sin datos que migrar. La imagen del producto pasa a ser siempre la de catálogo remota. Si backend prefiere conservarlas nullable-sin-uso en v1, se documenta como deuda menor en `TECH_DEBT.md`; la decisión de arquitectura es **eliminarlas**. |
| M-10 (rev) | `Dispute.type` | Se **conserva** `condition_raw | condition_sealed` (v1.1 M-10). Sin cambio adicional en v1.2. | — | La distinción raw/sellado sigue; lo que cambia es que la evidencia va **por correo**, no por foto. |

> **INE (KYC) — SIN migración (v1.2.1):** `KycProfile.ineFrontKey`/`ineBackKey`, cifrado PII (`*Enc`/`*Hmac`),
> retención `INE_RETENTION_DAYS` y `reveal-clabe` **permanecen intactos** (§3.4). La v1.2.1 no toca el esquema
> de INE/CLABE respecto a v1.1.

### v1.1 (previas)

| # | Modelo / campo | Cambio | Tipo migración | Nota |
|---|---|---|---|---|
| M-1 | `RawCondition` (enum) | `NM \| LP \| MP \| HP \| DMG` → **`NM`** (único valor) | Redefinir enum Postgres | Greenfield: sin filas que backfillear. Si en el futuro hubiera filas ≠ NM, requeriría estrategia de mapeo; hoy no aplica. |
| M-2 | `InventoryItem.sealedSubtype` | **Nuevo** enum opcional `box\|etb\|bundle\|tin\|blister`, nullable | Add column | Solo para `productType=sealed`. |
| M-3 | `User.passwordHash` | pasa a **nullable** | Alter column | Null para cuentas solo-Google. |
| M-4 | `User.authProvider` | **Nuevo** enum `local\|google` default `local` | Add column + enum | |
| M-5 | `User.googleId` | **Nuevo** `String? @unique` | Add column + unique index | |
| M-6 | `User.emailVerified` | **Nuevo** `Boolean @default(false)` | Add column | |
| M-7 | `User.avatarUrl` | **Nuevo** `String?` | Add column | |
| M-8 | `PortfolioSnapshot` | **Modelo nuevo** (`userId, asOfDate @db.Date, totalValueMxnCents, costBasisMxnCents?, pendingPriceCount`, `@@unique([userId, asOfDate])`, `@@index([userId, asOfDate])`) | Create table | Escrito por job `portfolio-snapshot` (BE-5). |
| M-9 | `ConfigSetting` seed | **Nuevo dial** `catalog_sync_from_date` = `"2024/01/01"` | Seed/insert | Default de `POST /admin/catalog/sync`. |
| M-10 | `Dispute.type` | Generalizar más allá de `condition_raw` para admitir **disputa de sellado** (caja dañada/equivocada) | Alter enum (add value, p. ej. `condition_sealed`) | La evidencia canónica del sellado es la foto de la caja al ingreso. |
| M-11 | `Card.rarity` | **Sin cambio** — permanece `String` libre (taxonomía abierta pokemontcg.io) | — | Se documenta explícitamente para que no se convierta en enum. |

Ninguna otra tabla cambia. Los índices existentes se conservan.

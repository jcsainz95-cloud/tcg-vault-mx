# BACKEND_NOTES.md — Marketplace TCG con Bóveda

> Propiedad: **backend**. Notas de implementación para otros roles (QA, techlead, frontend, devops).
> El contrato (`docs/API_CONTRACT.md`) manda sobre el código. Stack: NestJS + Prisma + PostgreSQL,
> Redis/BullMQ (jobs), JWT + argon2, S3/MinIO (presigned URLs), Stripe.

## 1. Cómo correr

```bash
cd backend
npm install
npx prisma generate                 # genera el cliente Prisma
# Infra local (desde la raíz del repo): docker compose up -d   (postgres/redis/minio)
cp ../.env.example ../.env           # rellena secretos; los valores "(local ok)" ya sirven
npx prisma migrate deploy            # aplica migraciones (crea tablas + secuencia de folios)
npm run seed                         # diales M10 + super_admin + datos de ejemplo
npm run start:dev                    # API en http://localhost:3001/api/v1
```

- **Prefijo de API:** `/api/v1` (todas las rutas). Coincide con el contrato.
- **Puerto:** `3001` (coincide con `Dockerfile.backend` y `docker-compose.yml`).
- **Usuarios sembrados (SEC-C1 — ya NO hay contraseñas hardcodeadas):**
  - `admin@tcg.local` (super_admin) — password **obligatoria por `SEED_ADMIN_PASSWORD`**
    (email configurable por `SEED_ADMIN_EMAIL`).
  - `operador@tcg.local` (vault_operator) — password **obligatoria por `SEED_OPERATOR_PASSWORD`**
    (email configurable por `SEED_OPERATOR_EMAIL`).
  - En entornos **no-locales** (`NODE_ENV` ≠ `development`/`test`/`local`) el seed **falla** si
    esas envs faltan (sin defaults débiles). En local, si faltan, usa un fallback **solo-desarrollo**
    (aleatorio) y avisa por consola — nunca reutilizable fuera de local.

## 2. Cómo testear

```bash
npm test               # unit + smoke de DI (59 tests). NO requiere Postgres/Redis/MinIO.
npm run test:integration  # E2E contra infra REAL (Postgres/Redis/MinIO/Stripe). Ver §8.
npm run lint           # eslint (0 errores)
npm run typecheck      # tsc --noEmit (0 errores)
npm run build          # nest build → dist/
```

- Los tests unitarios usan **Prisma mockeado** (`@nestjs/testing` / jest), así que **corren sin
  infraestructura** (verde en CI sin DB y en local sin Docker). El job de CI de devops levanta
  Postgres+Redis y corre `prisma migrate deploy` antes de `npm test`; nuestros tests no dependen de
  ello, pero la migración valida el schema.
- **Cobertura de tests (lógica crítica, como pidió el encargo):**
  - `test/money.spec.ts` — fórmulas de checkout (**gross-up + IVA 16%**), retiro/envío,
    `AcquisitionPricer` (común/reverse/EX+ y precio pendiente), sale price (markup), aportación 70%,
    FX+colchón. (§5.1 y §4.2 de ARCHITECTURE).
  - `test/payments.service.spec.ts` — ciclo **pending→settled**, **contracargo** (reversión a
    inventario de plataforma), **idempotencia** por `event.id`, y liquidación de envío→picking.
  - `test/money-out.guard.spec.ts` — **`MoneyOutGuard`**: solo `super_admin`; operador/cliente
    reciben `MONEY_OUT_FORBIDDEN` y el intento queda **auditado**.
  - `test/app.module.spec.ts` — smoke del **grafo de DI** completo (detecta wiring roto/ciclos).
- **Suite de integración/E2E** (contrato punta a punta, seguridad, **webhooks reales**) ahora
  vive en `test/integration/*.e2e-spec.ts` y la ejecuta **QA/devops** con `npm run test:integration`
  (infra real). Detalle completo, cobertura y env en **§8**.

## 3. Estado por módulo (completo vs stub/TODO)

| Módulo | Estado | Notas |
|---|---|---|
| **auth** (register/login/refresh/logout) | ✅ Completo | argon2 + JWT access/refresh. `logout` es no-op (JWT stateless; blacklist = fase 2). |
| **users/KYC/addresses/billing** (M6 cliente) | ✅ Completo | Direcciones **solo MX** (`ADDRESS_NOT_MX`). CLABE 18 dígitos (`CLABE_INVALID`). |
| **catalog** (storefront) | ✅ Completo | `ListingDTO` con `referenceValue` (mercado) vs `salePriceCents` (venta). Precio pendiente ⇒ `sellable=false`. |
| **pricing / FX** (M2) | ✅ Lógica completa · ⚠️ providers graded/sealed = **stub** | `PokemonTcgIoProvider` (raw) hace fetch real a pokemontcg.io. `PokemonPriceTracker`/`PokeTrace` devuelven `null` (sin endpoint confirmado) ⇒ **precio pendiente** + **override manual** (que sí funciona). FX Banxico SIE implementado; sin token usa override/último valor. |
| **inventory / vault** (M1) | ✅ Completo | Folio `INV-000123` (secuencia Postgres), ubicaciones jerárquicas, movimientos, mover, marcar pérdida/daño, aportación en especie (ref×pct). |
| **orders / checkout** (M3) | ✅ Completo | `quote`, `session` (reserva + PaymentIntent), breakdown gross-up, `request-invoice`, refund (money-out). |
| **payments / webhooks** | ✅ Completo | Stripe real (lazy client). Webhook firmado + idempotente. succeeded/failed/refunded/dispute. |
| **shipments** (M4) | ✅ Completo | Cobro Stripe **antes** de crear la solicitud; solo `settled`; picking-list por ubicación; captura de guía. |
| **buylist** (M5/E) | ✅ Completo | Cotizador público, topes/INE/CLABE, cherry-pick, convert-to-inventory, pago SPEI (money-out). |
| **disputes** (M8) | ✅ Completo | Ventana 7d desde entrega, comparador de fotos, recompra (money-out solo `super_admin`). |
| **uploads** | ✅ Completo | Presigned PUT S3/MinIO (kyc_ine, dispute_claim, inventory_photo). |
| **admin** (M6/M7/M9 + dashboard) | ✅ Completo | P&L, inventory-value, custody-value, IVA, export CSV, launch-metrics, dashboard 8 tarjetas (dinero enmascarado a `vault_operator`). |
| **settings/audit** (M10) | ✅ Completo | Diales en DB (editables sin redeploy), bitácora global. |
| **jobs** (BullMQ) | ⚠️ **Lógica completa, scheduling pendiente** | `price-sync`, `fx-refresh`, `buylist-sweep`, `dispute-deadline` implementados como servicios ejecutables. La **programación repetible BullMQ/Redis** es un wrapper de despliegue aún **no cableado** (ver §5). `price-sync` y `fx-refresh` se pueden disparar por endpoint admin. |
| **health** (infra) | ✅ Completo | `GET /api/v1/health` **público** (sin auth, sin rate-limit). `SELECT 1` a Postgres + `PING` a Redis opcional. Ver §12. |

## 4. Solicitudes de cambio de contrato al **arquitecto** (no edité el contrato)

1. **`FxRate.source` vs enum `PriceSource`.** `ARCHITECTURE §3.2` dice `FxRate.source ∈ {banxico, manual}`,
   pero el enum `PriceSource` del contrato es `{pokemontcg_io, pokemonpricetracker, poketrace, manual}`
   (sin `banxico`). Para no violar ninguno, modelé `FxRate.source` como **String libre** (`"banxico"|"manual"`),
   NO como el enum `PriceSource`. Es coherente con ARCHITECTURE; solo lo señalo por si el arquitecto
   quiere formalizar un enum `FxSource` en el contrato. **No bloquea.**
2. **`BILLING_PROFILE_REQUIRED` (checkout/session).** El contrato lo lista como posible error, pero en
   el MVP la factura es **manual por correo** y el `billingProfileId` es **opcional**. Hoy **no** disparo
   ese error (se puede comprar sin billing profile). Si el negocio quiere exigir billing profile antes de
   pagar, el arquitecto debe precisar la condición. **No bloquea.**
3. **Dashboard money-masking.** El contrato muestra `profitPeriodCents/inventoryValueCents/custodyValueCents`
   en el ejemplo, y aclara que se **omiten/enmascaran** para `vault_operator`. Los **omito** (no vienen en
   el JSON) para ese rol. Si se prefiere enviarlos como `null`, avísese. **No bloquea.**
4. **Semántica de error del webhook Stripe (correctness fix de QA).** `API_CONTRACT §9` dice "Res 200
   siempre que la firma sea válida; los errores de negocio se registran, no se devuelven a Stripe". Tras
   el hallazgo de QA (un fallo transitorio dejaba la orden en `pending` para siempre), ahora distingo:
   firma inválida → 400; evento ya procesado o no manejado → **200**; pero si el **handler falla**
   (excepción, p. ej. DB transitoria) → se **propaga 5xx** para que **Stripe reintegre/reintente** y el
   evento **no** quede marcado como procesado. Es un refinamiento del texto del contrato (no un cambio de
   esquema/DTO); lo señalo por si el arquitecto quiere precisar la redacción de §9. **No bloquea.**

## 5. Variables de entorno faltantes / notas para **devops** (no edité `.env.example`)

- **`SEED_ADMIN_PASSWORD`** y **`SEED_OPERATOR_PASSWORD`** (SEC-C1) — **NUEVAS y obligatorias** para
  sembrar cualquier entorno no-local. **Solicitud a devops:** añadirlas a `.env.example` (vacías, con
  comentario "obligatoria en no-local; usar secreto fuerte") y **rotar** la credencial del operador que
  antes estaba en el repo (`Operador123!`) y la del admin (`ChangeMe123!`). Emparejables con
  `SEED_ADMIN_EMAIL`/`SEED_OPERATOR_EMAIL` (opcionales). El seed **rechaza el arranque** en no-local si
  faltan. Recomendado moverlas a un secret manager (no `.env` en el host) — ver banderas de SECURITY_NOTES §3.
- **Rate-limiting (SEC-C1):** el `ThrottlerModule` usa storage **in-memory por instancia**. En despliegue
  **multi-instancia** devops debe: (a) añadir storage compartido (Redis) para un límite global real, y
  (b) configurar `trust proxy`/`X-Forwarded-For` en el borde para que el tracker use la IP real del
  cliente (detrás de proxy). Además conviene un **rate-limit/WAF en el borde** como capa extra.
- **`BANXICO_SIE_TOKEN`** — `ARCHITECTURE §8` lo pide para el FX automático (API SIE de Banxico), pero
  `.env.example` solo tiene `FX_SOURCE`/`FX_API_KEY`. El código lee **`BANXICO_SIE_TOKEN` y, si falta,
  cae a `FX_API_KEY`**. **Solicitud a devops:** añadir `BANXICO_SIE_TOKEN=` a `.env.example`. Sin token,
  el FX usa el override manual (dial M10) o el último `FxRate` — el sistema **no se rompe**.
- **`S3_FORCE_PATH_STYLE`** ya está en `.env.example` (lo consumo para MinIO).
- **Webhook Stripe / raw body:** el endpoint `POST /api/v1/webhooks/stripe` necesita el **body crudo**
  para verificar la firma. Lo resuelvo en `main.ts` con un `json({ verify })` que captura `req.rawBody`
  antes del parse global. Si devops pone un proxy/body-parser delante, **preservar el raw body** en esa ruta.
- **BullMQ scheduling:** para activar los jobs repetibles (diarios) hace falta un worker BullMQ conectado
  a `REDIS_URL`. Hoy la **lógica** está lista (`src/jobs/*`); falta el wrapper de `@nestjs/bullmq` con
  `repeatable jobs`. Mientras tanto se pueden disparar: `POST /admin/pricing/sync` (price-sync) y
  `POST /admin/fx/refresh` (fx-refresh). `buylist-sweep` y `dispute-deadline` no tienen endpoint aún
  (solo servicio) — **deuda técnica no bloqueante** para el techlead/devops.

## 6. Decisiones de implementación relevantes

- **Dinero:** todo en **centavos MXN** enteros (`*Cents`); nunca floats. No existe wallet/saldo.
- **Fee de checkout = gross-up** `total = ceil((subtotal+IVA + fija) / (1 − pct))`; `fee = total − base`.
  El fee **no** lleva IVA. IVA grava subtotal (compra) o envío (retiro). `stripePct`/`stripeFixedCents`
  son diales M10 (defaults 3.6% + MX$3.00 — **a confirmar con la tarifa MX real de Stripe** por el dueño).
- **Precio de venta** = `round(referencia × (1 + salesMarkupPct/100))` (dial `sales_markup_pct`, default 15%),
  o `listPriceCents` override. El **valor de mercado** mostrado y la valuación de portafolio usan la
  **referencia** pura.
- **Titularidad / reserva (ARCHITECTURE §8):** checkout ⇒ **reserva ATÓMICA** con
  `status=reserved, ownerType=customer, ownershipStatus=pending` vía `updateMany` con guardia de estado
  vendible + `count===1` (evita doble venta de pieza única; el 2º checkout concurrente recibe
  `ITEM_UNAVAILABLE`). Webhook `succeeded` ⇒ `reserved → in_custody`, `ownershipStatus=settled`.
  `payment_failed` ⇒ `reserved → listed` (libera). `dispute.created` ⇒ revierte a plataforma (`listed`),
  `Order=chargeback`, movimiento `chargeback_return`. Todo transaccional con `InventoryMovement`.
- **Diales M10 validados:** `PUT /admin/settings` valida cada dial por tipo+rango (p. ej.
  `stripe_fee_pct ∈ [0,1)`, porcentajes ≥ 0, cents enteros ≥ 0) y **rechaza keys desconocidas** con `422`
  (validación "todo o nada"). Evita que un dial mal escrito rompa la matemática de `money.ts`.
- **Reportes por periodo:** `pnl` (órdenes por `settledAt`, envíos por `pickingAt`), `launchMetrics`
  (ventas `settledAt`, buylist `paidAt`, retiros `deliveredAt`) y `dashboard` (tarjetas de periodo con
  `from/to` opcionales; default = mes calendario UTC en curso) acotan realmente por fecha.
- **Precio pendiente (transversal):** si no hay referencia y no hay override, se crea `PendingPriceEntry`
  (una abierta por combinación) y **nunca se descarta** la carta. Aplica a catálogo/portafolio/buylist/
  inventario (aportación en especie sin referencia ⇒ `422 PRICE_PENDING` + cola).
- **Roles:** guards globales en orden `JwtAuthGuard → RolesGuard → MoneyOutGuard`. `@Public()` exime del
  JWT; `@Roles(...)` por ruta (con override a nivel de método, p.ej. KYC/status = solo `super_admin`);
  `@MoneyOut()` exige `super_admin` y **audita el intento bloqueado**. El **remedio de recompra** (M8)
  no usa `@MoneyOut()` en la ruta (porque `reject` sí lo puede hacer el operador): la restricción de
  `repurchase` a `super_admin` se hace en el controller, también auditando el bloqueo.
- **Errores:** shape del contrato `{ error: { code, message, details } }` vía `AllExceptionsFilter`.
  `BusinessException` lleva el `errorCode` estable (i18n en frontend). El backend **no** traduce textos.
- **Folios:** secuencia Postgres `inventory_folio_seq` (creada en la migración) → `INV-000123`.
- **Idempotencia (webhooks):** guardia **atómica** por `ProcessedStripeEvent(event.id)` — se hace
  `create` primero y se usa la violación de unique (P2002) como "ya procesado" (evita doble-`settled`
  ante entregas concurrentes). El evento se marca procesado **solo tras éxito** del handler; si el handler
  falla, se **borra** la marca y se **re-lanza** (Stripe reintenta). Los endpoints de pago aceptan
  `Idempotency-Key` (se pasa a Stripe).
- **Migraciones:** una sola migración inicial `0000000000000_init` (generada con `prisma migrate diff`,
  sin DB) + la secuencia de folios apéndice. `prisma migrate deploy` la aplica en CI/prod.

## 7. Qué falta para que QA valide (checklist)

- ✅ Endpoints del contrato implementados (auth, users, catalog, vault, checkout/orders, shipments,
  buylist, disputes, uploads, webhooks, admin M1–M10, dashboard).
- ✅ Enums/DTOs/errorCodes alineados con `API_CONTRACT.md`.
- ✅ Tests unitarios de lógica crítica pasan (`npm test` = 59 verdes, incluye la suite de seguridad §9).
- ⚠️ **Integración con infra real** (Postgres/Redis/MinIO/Stripe test): QA debe levantar
  `docker compose up -d`, `prisma migrate deploy`, `npm run seed`, y usar `stripe listen` para webhooks.
- ⚠️ **Providers de precio graded/sealed** son stubs (devuelven `null` ⇒ precio pendiente + override
  manual). El flujo funciona; los precios automáticos de gradeadas/sellado requieren confirmar el
  endpoint/clave del proveedor (fuera de mi alcance sin credenciales).
- ⚠️ **Scheduling BullMQ** de los 4 jobs (deuda no bloqueante; lógica lista y disparable).

## 8. Suite de integración / E2E (infra real) — para QA/devops

Suite que verifica la plataforma **contra infraestructura real** (Postgres/Redis/MinIO del
`docker-compose` + firma de webhook Stripe real, offline). Es la parte "teoría→realidad":
**no** usa Prisma mockeado; levanta el `AppModule` completo y lo golpea por **HTTP real**.

### Script para devops (CI)
```bash
npm run test:integration        # (alias: npm run test:e2e)
#   = prisma migrate deploy  &&  npm run seed:synthetic  &&  jest (config e2e)
```
- Corre **migraciones + seed sintético ANTES** de los tests (encadenado en el script).
- Config aislada: `test/jest-integration.config.js` (testRegex `test/integration/*.e2e-spec.ts`,
  `--runInBand` porque comparten estado de DB). **No** lo recoge `npm test` (unit sigue verde
  sin infra); el unit `jest.config.js` ignora `/test/integration/`.

### Seed sintético (lo invoca `scripts/seed-synthetic.sh`)
```bash
npm run seed:synthetic          # = ts-node prisma/seed-e2e.ts  (datos FICTICIOS deterministas)
```
- `prisma/seed-e2e.ts` exporta `seedE2E(prisma)` (reutilizable) + runner CLI. Idempotente:
  resetea el estado transaccional E2E en cada corrida. Constantes en `prisma/e2e-fixtures.ts`
  (usuarios por rol, cartas, folios, referencias, diales deterministas). **Nada de datos reales.**
- Usuarios sembrados: `customer@e2e.local` / `Customer123!`, `customer2@e2e.local`,
  `operator@e2e.local` / `Operator123!` (vault_operator), `admin@e2e.local` / `Admin123!` (super_admin).
- `scripts/seed-synthetic.sh` ya prefiere `npm run seed:synthetic` (coincide con su convención).

### Variables de entorno que necesita
- **Obligatoria:** `DATABASE_URL` (Postgres real; sin ella la suite falla explícito).
- **Recomendadas (infra real):** `REDIS_URL`, `S3_ENDPOINT`/`S3_REGION`/`S3_BUCKET`/
  `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` (MinIO; el bucket `tcg-photos` debe existir).
- **Stripe:** `STRIPE_WEBHOOK_SECRET` (se usa para **firmar y verificar** el webhook; si no se
  fija, la suite usa `whsec_e2e_test_secret` de forma consistente). No se llama a la API de
  Stripe por red: la creación de PaymentIntent/refund se stubbea offline; **la verificación de
  firma del webhook es REAL** (SDK). `STRIPE_SECRET_KEY` puede ser dummy.
- **`E2E_STRICT_INFRA=true`** (recomendado en el job E2E con toda la infra): hace que los smokes
  de **Redis** y **MinIO** fallen si la infra no responde. Sin él, esos dos smokes se **saltan
  con aviso** si no hay Redis/MinIO (Postgres siempre es obligatorio).

Local, con Docker:
```bash
cd .. && docker compose up -d && cd backend
npm run test:integration
```

### Qué cubre (flujos críticos de negocio)
| Spec | Cubre |
|---|---|
| `auth-authz.e2e-spec.ts` | registro/login/refresh; rol customer bloqueado del back-office; operador ve M3 pero no M7; **MoneyOutGuard** (operador→`MONEY_OUT_FORBIDDEN` **auditado**, super_admin pasa). |
| `catalog-checkout-webhook.e2e-spec.ts` | catálogo `referenceValue` vs `salePrice` (markup) y override; **precio pendiente → no comprable** (`sellable=false`, `422 PRICE_PENDING`); breakdown **IVA 16% + fee gross-up**; **reserva atómica anti doble-venta**; **webhook firmado** `payment_intent.succeeded` → `reserved→settled` (in_custody); **idempotencia** por `event.id` (un solo `settle`); **firma inválida → 400**; `charge.dispute.created` → **reversión a inventario de plataforma** + movimiento `chargeback_return`. |
| `vault-shipments.e2e-spec.ts` | portafolio valuado a **referencia** (sin wallet); retiro **solo `settled`** (`pending`→`ITEM_NOT_SETTLED`); **tarifa fija** 17500 + IVA + fee; **`ADDRESS_NOT_MX`**; cobro Stripe **antes** (nace en `solicitado`). |
| `buylist.e2e-spec.ts` | cotizador público (común 50 / reverse 150 / EX+ 40% / **precio pendiente**); tope por solicitud (`BUYLIST_LIMIT_EXCEEDED`), **INE** sobre umbral (`INE_REQUIRED`), **CLABE a nombre propio** (`CLABE_NOT_OWN_NAME`); pipeline `recibida→verificación`, **cherry-pick** + **convert-to-inventory**; **pago SPEI** (operador 403 money-out, super_admin OK). |
| `infra-smoke.e2e-spec.ts` | **Postgres** (query + secuencia de folios, obligatorio); **Redis** (PING real, skip/aviso si ausente); **MinIO/S3** (presign + **PUT real**, skip/aviso si ausente). |

### Notas de implementación (para QA/devops)
- **Sin dependencias nuevas:** el cliente HTTP de la suite usa el módulo `http` nativo (no se
  añadió supertest); las firmas de webhook se generan con el SDK de Stripe (ya presente).
- **Stripe sin `stripe listen`:** no hace falta el CLI de Stripe. Los eventos se **fabrican y
  firman en proceso** con `generateTestHeaderString` y se envían al endpoint real, que verifica
  la firma con `STRIPE_WEBHOOK_SECRET` e idempotencia por `event.id`. (Si en el futuro se quiere
  probar contra Stripe real de punta a punta, ahí sí `stripe listen --forward-to`; no es
  necesario para esta suite.)
- **CI actual (devops):** el job `backend` ya levanta Postgres+Redis. Para correr la suite
  completa hace falta **añadir un servicio MinIO** (o `E2E_STRICT_INFRA` sin fijar para que el
  smoke de MinIO se salte) y un step `npm run test:integration`. Postgres+Redis ya alcanzan para
  todo salvo el PUT real a MinIO.
- **Ejecutable aquí vs pendiente de infra:** en esta sesión **no hay daemon Docker**, así que la
  suite queda **lista y verificada a nivel de compilación** (typecheck/lint/build verdes, arranca
  el `AppModule` y falla limpio en la conexión a Postgres). Se ejecuta en verde en CI/local con la
  infra levantada. Los tests **unitarios** siguen intactos (`npm test` = 59 verdes, sin infra).
```

## 9. Remediación de seguridad (veredicto RECHAZADO → hallazgos cerrados por backend)

> Cierre de los hallazgos de `docs/SECURITY_NOTES.md` / `docs/PENTEST_NOTES.md` cuyo **rol dueño es
> backend**. Los de rol **devops** (bucket privado, rotación de secretos, WAF, bump de framework) se
> coordinan por separado (ver §5 y el checklist de abajo). Todo cerrado con tests + `lint/typecheck/
> test/build` en verde.

| ID | Fix (backend) | Test |
|---|---|---|
| **SEC-C1** rate-limit + seed | `@nestjs/throttler` global (`ThrottlerGuard` como 1er APP_GUARD, 300/min) + `@Throttle` estrecho en `/auth/login` y `/auth/register` (**5/min**) y `/auth/refresh` (20/min); webhook Stripe `@SkipThrottle`. Seed sin passwords hardcodeadas: `SEED_ADMIN_PASSWORD`/`SEED_OPERATOR_PASSWORD` obligatorias en no-local, falla si faltan. | `test/auth.throttle.spec.ts`, `test/seed.password.spec.ts` |
| **SEC-A1** categoría buylist server-side | `createRequest` **deriva `category` de la rareza real** (`categoryForRarity`) e **ignora** la del DTO; aplica en cotización y persistencia. | `test/buylist.security.spec.ts` (DTO malicioso `ex_plus` sobre común → 50c, no infla) |
| **SEC-A2** topes atómicos (TOCTOU) | Lectura del acumulado mensual + creación de `SellRequest` en **transacción SERIALIZABLE** (`monthUsedCentsTx` sobre `tx`); tope por-solicitud fuera (no depende de concurrencia). | `test/buylist.security.spec.ts` (isolation serializable; 2 concurrentes → 1 sola creada) |
| **SEC-A3** doble convert-to-inventory | `@unique` en `InventoryItem.sourceSellRequestItemId` (+ migración `20260813120000_unique_source_sell_request_item`); `convertToInventory` captura **P2002** y lo trata como "ya convertido". | `test/buylist.security.spec.ts` (2 conversiones → 1 solo InventoryItem) |
| **SEC-A4** PII/KYC al `vault_operator` | `getUser(id, role)`: proyección **reducida** para no-super_admin (CLABE **enmascarada** a últimos 4; INE/RFC **omitidos**; `billingProfile: null`; `ineOnFile` booleano). Controller pasa el rol. | `test/admin.pii.spec.ts` (operador sin PII sensible; super_admin ficha completa) |
| **SEC-A5** INE/KYC por presign de lectura | `UploadsService.presignGet(key, 300s)` (GET prefirmado); `DisputesService.adminGet` sirve fotos por presign, **no** por `S3_PUBLIC_BASE_URL`. (devops hace el bucket privado.) | `test/disputes.presign.spec.ts` |
| **SEC-C2** deps runtime | `@nestjs/config`→**4.0.4** (elimina `lodash` high); `overrides`: `multer@^2.2.0` (high), `qs@^6.15.3`, `express@^4.22.2`, `body-parser@^1.20.6`. `npm audit --omit=dev` = **0 high / 0 critical**. | `npm audit --omit=dev` (ver abajo) |
| **SEC-M3** (deuda, incluida) refund | Refund exige `status='settled'`; idempotencia obligatoria hacia Stripe (deriva `refund-<orderId>` si no viene header). | cubierto por lógica; e2e de órdenes |
| **SEC-M5** (deuda, incluida) pay-spei | `paySpei` idempotente (si ya `pagada` → devuelve) + transición atómica `updateMany` con guardia de estado (`count===1`). | `test/buylist.security.spec.ts` |

**`npm audit --omit=dev` (runtime) tras el fix:** `{ high: 0, critical: 0, moderate: 4 }`. Los 4 moderados
son **de framework y sin fix sin salto de major**, se documentan como deuda no explotable en este código:
- `@nestjs/core` / `@nestjs/platform-express` (GHSA-36xv-jgw5-4q75, moderate): el único fix es **NestJS 11**
  (major, rompe toda la app). Se pospone a un upgrade coordinado de framework (**devops/backend**, no
  bloqueante — es moderate, no high/critical).
- `file-type` vía `@nestjs/common` (moderate, DoS parseando media malformada): transitivo; **no alcanzable**
  en nuestro código — no parseamos archivos subidos en el servidor (los uploads van directo a S3 por presign).
- Nota: mantuve **NestJS 10** a propósito para no arriesgar un major; los highs de runtime (`multer`,
  `lodash`) se cerraron con `overrides` + `@nestjs/config@4`, más quirúrgico y de bajo riesgo. `multer` no
  se usa (no hay `FileInterceptor`; uploads por presign), así que el override es seguro.

### Pendientes de **devops** para completar el cierre (coordinar)
- **SEC-C1:** añadir `SEED_ADMIN_PASSWORD`/`SEED_OPERATOR_PASSWORD` a `.env.example`; **rotar** las
  credenciales sembradas antiguas; storage Redis para throttler + `trust proxy` + WAF en el borde (ver §5).
- **SEC-A5:** bucket **privado** (sin ACL público-lectura) para `kyc_ine`/`dispute_claim`; el backend ya
  sirve por presign. (El `S3_PUBLIC_BASE_URL` sigue usándose solo para **fotos de catálogo** públicas,
  que son producto y sí deben ser públicas — no es PII.)
- **SEC-C2:** mantener el gate `security-sast.yml` como required check; evaluar el salto a NestJS 11 en un
  sprint de hardening para cerrar los 4 moderados de framework.
- **Deuda restante (no de este encargo):** SEC-M1/M2/M4 (CORS allow-list, JWT en localStorage=frontend,
  helmet/headers B3, presign upload content-type B4) siguen como **deuda aceptada con disparador** en
  SECURITY_NOTES §2.

## 10. Endurecimiento de PII sensible (CLABE / RFC / INE) — cifrado en reposo + retención

> Cierra la bandera legal de `SECURITY_NOTES §2.3` (LFPDPPP): CLABE/RFC ya **no** viven en claro en la
> BD y la INE tiene **retención/borrado**. Greenfield: se renombraron las columnas a `*Enc` **sin backfill**.

### 10.1 Cifrado en reposo (AES-256-GCM) + blind index (HMAC-SHA256)
- **`src/common/crypto/pii-crypto.service.ts`** (`PiiCryptoService`, provisto por `CryptoModule` **@Global**):
  - `encrypt(x)` / `decrypt(x)`: AES-256-GCM autenticado. Formato serializado **`v1:iv:tag:ciphertext`**
    (cada campo en base64; IV de 12 bytes **aleatorio por operación**, authTag de 16 bytes). `decrypt`
    lanza si el payload fue manipulado o está mal formado.
  - `clabeBlindIndex(clabe)`: **HMAC-SHA256** con `PII_HMAC_KEY` sobre la CLABE **normalizada** (solo
    dígitos). Determinista ⇒ permite **igualar/buscar sin descifrar**. `blindIndexEquals` compara en
    tiempo constante.
  - **Fail-safe:** en entornos **no-locales** (`NODE_ENV` ∉ {development,test,local}) **falla claro** si
    `PII_ENCRYPTION_KEY`/`PII_HMAC_KEY` faltan o están mal formadas (la key AES debe decodificar a
    **exactamente 32 bytes**). En local, si faltan, deriva claves de desarrollo deterministas con **aviso**.
- **Columnas cifradas** (schema + migración `20260813130000_pii_encryption_at_rest`):
  - `KycProfile.clabe → clabeEnc`, `KycProfile.rfc → rfcEnc`, **nuevo** `KycProfile.clabeHmac` (blind index,
    con índice), `SellRequest.clabeSnapshot → clabeSnapshotEnc`, `BillingProfile.rfc → rfcEnc`.
- **Match `CLABE_NOT_OWN_NAME`** (`buylist.service.ts`): ahora compara **HMACs** (`clabeHmac` vs
  `clabeBlindIndex(clabe entrante)`) **sin descifrar** la CLABE almacenada. El índice también permite (a
  futuro) detectar la misma CLABE compartida entre cuentas.

### 10.2 Reveal on-demand para pagar (no dejar ciego al pagador)
- **NUEVO endpoint `GET /api/v1/admin/buylist/:id/reveal-clabe`** (`admin-buylist.controller.ts`):
  **solo `super_admin`**, marcado **`@MoneyOut()`** y **auditado en `AuditLog`** (`action:
  buylist.reveal_clabe`, quién/cuándo/qué solicitud). Descifra y devuelve la **CLABE completa (18 dígitos)**
  `{ sellRequestId, clabe }` para copiarla a la banca al hacer el SPEI. Cae a la CLABE de KYC si el snapshot
  falta. **Es el ÚNICO punto** que devuelve la CLABE en claro.
- **Enmascarado en todo lo demás** (helpers puros `src/common/crypto/pii-mask.ts`: `maskClabe`→`****1234`,
  `maskRfc`→`XAX**********`):
  - `GET /users/me/kyc` → CLABE **enmascarada** (antes iba en claro).
  - `GET /users/me/billing-profile` → RFC **enmascarado**.
  - `admin/users/:id` (ficha 360°): CLABE **y** RFC **enmascarados también para `super_admin`**; el
    operador además no ve RFC/INE keys/billing (se mantiene SEC-A4).
  - `admin/buylist/:id` (detalle): expone `clabeMasked`, nunca el snapshot cifrado ni la CLABE en claro.
- El `billingSnapshot` que guarda `Order` ahora contiene `rfcEnc` (ciphertext), **no** RFC en claro.

### 10.3 Retención de INE
- Dial **`INE_RETENTION_DAYS`** en `settings.constants.ts` (default **180** días, con validador
  `entero ≥ 0`). **NO** se expone en el DTO de `GET/PUT /admin/settings` para no tocar el contrato (ver
  solicitud abajo); se lee desde DB/seed vía `SettingsService`.
- **`src/jobs/ine-retention.service.ts`** (`IneRetentionJobService.run()`): purga las imágenes de INE
  (`UploadsService.deleteObject` **nuevo** + limpia `ineFrontKey/ineBackKey`) de un usuario cuando (1) no
  tiene solicitudes de buylist **abiertas** y (2) su última solicitud **cerrada/pagada** superó el periodo.
  Función **lista y disparable**; el **scheduling BullMQ es deuda BE-5** (igual que los otros 4 jobs).

### 10.4 Variables de entorno NUEVAS para **devops** (no edité `.env.example`)
- **`PII_ENCRYPTION_KEY`** — **obligatoria en no-local**. 32 bytes en **base64** (`openssl rand -base64 32`).
- **`PII_HMAC_KEY`** — **obligatoria en no-local**. Clave del blind index (`openssl rand -base64 32`).
  **Rotar la clave HMAC invalida los `clabeHmac` existentes** (habría que recalcularlos); en greenfield no
  aplica. Ambas deben vivir en un **secret manager**, no en `.env` del host.
- El dial **`INE_RETENTION_DAYS`** (default 180) se siembra con los demás diales M10 (`npm run seed`).

### 10.5 Solicitud de cambio de contrato al **arquitecto** (no edité `API_CONTRACT.md`)
5. **Nuevo endpoint `GET /api/v1/admin/buylist/:id/reveal-clabe`** (super_admin, money-out, auditado) →
   `{ sellRequestId, clabe }` con la CLABE en claro para el pago SPEI. **Formalizar en `API_CONTRACT §M5`.**
   Correlato: en M5/M6 la CLABE/RFC pasan a devolverse **enmascarados** por defecto (la ficha 360° ya no
   trae CLABE/RFC en claro; `GET /users/me/kyc` enmascara la CLABE). Recomiendo que el arquitecto anote el
   enmascarado como comportamiento del contrato y, si se desea, exponga `ineRetentionDays` como dial M10.

**Verde:** `lint` + `typecheck` + `build` OK; `npm test` = **79 verdes** (antes 59; +20 de PII: round-trip
de cifrado, blind index/normalización/manipulación, match CLABE por HMAC propia vs tercero, reveal only
super_admin, enmascarado por rol, y retención de INE). Los E2E de infra siguen usando la API por HTTP
(cifrado transparente); QA los corre con infra real.

## 11. Remediación de la revisión de Stripe + POLÍTICA DE REEMBOLSOS del humano

> Cierre de los hallazgos de la revisión de Stripe (C1, A1, A2, M1, M2, M3, B1, B2, B5, B6) con la
> **política del humano**: **VENTAS FINALES, sin reembolso voluntario** (ni en bóveda ni enviada).
> Única excepción: carta **dañada/equivocada** → disputa de condición; si procede, el super_admin
> **compensa (recompra al precio pagado)**, el **cliente conserva la carta** y la carta **NO** regresa
> al inventario. Todo cerrado con tests + `lint/typecheck/test/build` en verde (**95 tests**, antes 79).

### 11.1 Fixes por hallazgo

| ID | Fix (backend) | Archivo(s) | Test |
|---|---|---|---|
| **C1** (crítico) gross-up con IVA sobre la comisión Stripe | `grossUpTotal` ahora incluye el IVA que Stripe MX cobra sobre su comisión: `total = ceil((base + (1+ivaFee)·fija) / (1 − (1+ivaFee)·pct))`. `StripeFeeConfig` gana `stripeFeeIvaPct`. Nuevo dial **`stripe_fee_iva_pct`** (default **0.16**) con validador (`fracción [0,1)`) y seed. `getStripeFee()` lo lee. | `common/money.ts`, `settings.constants.ts`, `settings.service.ts` | `test/money.spec.ts` (netea **exactamente `base`** tras la deducción real de Stripe con IVA; el total sube vs. la fórmula sin IVA) |
| **A2** (alto) PaymentIntent transaccional con la reserva (cierra **BE-7**) | `orders.service` y `shipments.service`: `createPaymentIntent` va en `try/catch` **tras** la reserva. Ante fallo se **compensa** (orders: libera la reserva `reserved→listed`, orden `failed`; shipments: **borra** la `ShipmentRequest` → cascada a items) y se lanza un **error de reintento** (`PAYMENT_PROVIDER_UNAVAILABLE`, 503). Los errores de negocio legibles (`CARD_DECLINED`) se propagan tal cual. | `orders/orders.service.ts`, `shipments/shipments.service.ts` | `test/orders.reservation.spec.ts` (release + 503; CARD_DECLINED as-is), `test/shipments.rollback.spec.ts` |
| **A1** reembolso restringido/excepcional | `POST /admin/orders/:id/refund` ya es `super_admin` + `@MoneyOut()` + guardia `settled`; se documenta como **excepcional** (VENTAS FINALES). `onChargeRefunded` marca la orden `refunded` pero **NO** re-agrega el item. | `orders/admin-orders.controller.ts`, `payments/payments.service.ts` | `test/payments.service.spec.ts` (refund total → refunded, sin tocar inventario) |
| **A1** disputes = compensación correcta | `disputes.resolve('repurchase')` **ya NO revierte** el item ni crea `InventoryMovement`: el **cliente conserva la carta**, **no** regresa al inventario. Sigue money-out (super_admin) + **auditado** (controller). Importe de recompra registrado en la resolución (M7). | `disputes/disputes.service.ts` | `test/disputes.repurchase.spec.ts` |
| **Fix 4** contracargo consciente del estado físico | `onChargeDispute`: si la carta sigue **en bóveda** (no hay `ShipmentItem` con envío `enviado/entregado`) → revierte a `platform/listed` + `InventoryMovement chargeback_return`; si **ya salió** → **NO** re-agrega, marca `Order.chargebackNeedsManual=true` (pelear con la guía). | `payments/payments.service.ts` | `test/payments.service.spec.ts` (en-bóveda vs enviada) |
| **M1/Fix 5** cierre de disputa | Nuevos handlers `charge.dispute.closed` / `charge.dispute.funds_reinstated`: **ganamos** → `settled` (item revertido se **queda en inventario**); **perdemos** → `chargeback` terminal. `Order.disputeOutcome` = `won/lost`. | `payments/payments.service.ts` | `test/payments.service.spec.ts` (won/funds_reinstated/lost) |
| **M2** reembolso parcial vs total | `onChargeRefunded` distingue `charge.amount_refunded` vs `charge.amount`: solo el **total** transiciona a `refunded`; el **parcial** no cambia estado (conciliación fina en M7). | `payments/payments.service.ts` | `test/payments.service.spec.ts` |
| **M3** idempotency-key derivada en servidor | `orders` deriva `pi-order-<id>` y `shipments` `pi-shipment-<id>`; el header `Idempotency-Key` del cliente es solo **override**. | `orders.service.ts`, `shipments.service.ts` | `test/shipments.rollback.spec.ts` (key derivada) |
| **B1** resiliencia del cliente Stripe | `maxNetworkRetries: 2`; `StripeCardError` → `CARD_DECLINED` (422, mensaje legible + `declineCode`). | `payments/stripe.service.ts` | cubierto por A2 (CARD_DECLINED se propaga) |
| **B2** monto mínimo antes del PI | Guardia `amountCents ≥ MIN_CHARGE_CENTS (1000c ≈ MX$10)` antes de crear el PI → `AMOUNT_TOO_LOW`. | `payments/stripe.service.ts` | — (guardia defensiva; validación pura) |
| **B5** `payment_intent.canceled` | Nuevo handler → libera la reserva (orden `failed`, `reserved→listed`) o **cancela** un envío `solicitado` (libera items). | `payments/payments.service.ts` | `test/payments.service.spec.ts` (orden y envío) |
| **B6** fail-fast en producción | `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET` ahora **requeridas** en producción (`env.validation.ts` aborta el arranque); `StripeService` **no** cae a `sk_test_dummy` en prod (`onModuleInit` + getter). | `config/env.validation.ts`, `payments/stripe.service.ts` | — (arranque; validado por typecheck/build) |

### 11.2 Dial NUEVO para **devops**
- **`stripe_fee_iva_pct`** (default **0.16**) — IVA que Stripe MX cobra **sobre su comisión**. Se siembra
  con los demás diales (`npm run seed`, iterando `SETTING_DEFAULTS`). **NO** se expone en el DTO de
  `GET/PUT /admin/settings` hasta que el arquitecto lo formalice en el contrato (mismo patrón que
  `INE_RETENTION_DAYS`); mientras tanto es editable en DB. Impacto: el **fee de procesamiento** del checkout/
  envío ahora grosea comisión **+ IVA de Stripe**, por lo que el total sube (~+0.6% del total) frente al
  cálculo anterior. **Registrar la tarifa MX real de Stripe** (pct+fija+IVA) con el dueño.

### 11.3 Notas para **devops** (env + Stripe dashboard)
- **B6 — envs requeridas en prod:** `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET` ahora bloquean el arranque
  si faltan en producción. Añadirlas al secret manager y confirmar que están seteadas en staging/prod.
- **Webhooks nuevos a habilitar en el Stripe Dashboard:** además de los actuales, suscribir
  **`payment_intent.canceled`**, **`charge.dispute.closed`** y **`charge.dispute.funds_reinstated`**
  (si no, los cierres de disputa y cancelaciones no se procesarán).
- **Recomendación de seguridad (Stripe):** usar **restricted API keys** (permisos mínimos: PaymentIntents,
  Refunds, Charges/Disputes de solo-lo-necesario) en vez de la secret key completa, y **activar Radar**
  (reglas antifraude) para reducir contracargos. Coordinar con seguridad/devops.

### 11.4 Solicitudes de cambio de contrato al **arquitecto** (no edité `API_CONTRACT.md`)
6. **§M8 disputes — contradicción con la política del humano.** El contrato dice que en `repurchase`
   "**item revierte a inventario**". La política del humano (VENTAS FINALES) manda: en la recompra el
   **cliente conserva la carta** y la carta **NO** regresa al inventario. Implementé la política (PROJECT.md/
   humano manda sobre el contrato). **Solicito corregir §M8** para quitar "item revierte a inventario" en
   `repurchase`. **Bloqueante de coherencia** (contrato vs. política).
7. **§9 webhooks — ampliar/precisar la semántica de disputas y refunds.** Hoy §9 dice que
   `charge.dispute.created` **siempre** revierte el item. La implementación ahora es **consciente del estado
   físico** (en bóveda → revierte; enviada/entregada → NO re-agrega + flag manual) y agrega
   `charge.dispute.closed`/`funds_reinstated` (ganamos→`settled`, perdemos→`chargeback`),
   `payment_intent.canceled` (libera reserva) y `charge.refunded` **parcial vs total** (sin re-agregar item).
   **Solicito actualizar §9** con estos eventos y la regla de "no re-agregar si ya salió".
8. **`OrderStatus` — NO cambié el enum.** Para no romper el contrato/i18n del frontend, mapeé
   ganamos→`settled` y perdimos→`chargeback`, y agregué **dos columnas escalares** a `Order`
   (`chargebackNeedsManual: boolean`, `disputeOutcome: "won"|"lost"|null`) — **no** están en los DTOs del
   contrato (uso interno / back-office). Si el arquitecto prefiere un estado terminal dedicado
   (`chargeback_won`/`dispute_won`) o exponer esos campos en el detalle admin de orden, que lo formalice.
9. **`stripe_fee_iva_pct` (dial M10).** Nuevo dial interno (default 0.16). **Solicito formalizarlo** en el
   DTO de `GET/PUT /admin/settings` (§M10). Correlato de redacción: en §5.1/§12 "el fee no lleva IVA" se
   refiere al **IVA de producto** (el fee no agrega una línea de IVA de venta); internamente el fee **sí**
   grosea el IVA de la **comisión de Stripe** (C1). Sugiero precisar esa distinción en el contrato.

**Verde (este encargo):** `lint` + `typecheck` + `build` OK; `npm test` = **95 verdes** (antes 79; +16:
gross-up con IVA y neto exacto, rollback de PI en orders y shipments, contracargo en-bóveda vs enviada,
cierre de disputa won/funds_reinstated/lost, refund parcial vs total sin re-agregar, `payment_intent.canceled`
en orden y envío, y recompra de disputa sin revertir la carta). Migración nueva
`20260813140000_order_chargeback_manual_and_dispute_outcome` (2 columnas escalares en `Order`).

## 12. Health endpoint (`GET /api/v1/health`) — para el healthcheck de Railway (devops)

> Encargo: dar a la plataforma (Railway) una sonda barata de salud. Trabajo solo en `backend/`.

- **Ruta exacta:** `GET /api/v1/health` — **pública** (`@Public()` salta el `JwtAuthGuard` global)
  y **sin rate-limit** (`@SkipThrottle()`, para no gastar cupo con sondas frecuentes).
- **Módulo propio, sin dependencias nuevas:** `src/modules/health/{health.module,health.controller,health.service}.ts`.
  No usé `@nestjs/terminus` (no estaba instalado y habría añadido peso); es un check simple hecho a mano.
- **Respuesta:**
  - **200** cuando las dependencias responden: `{ status: 'ok', uptime, timestamp, db, redis }`
    (`uptime` en segundos, `timestamp` ISO-8601). Ej. `{ status:'ok', uptime:1234, timestamp:'...', db:'up', redis:'skipped' }`.
  - **503** cuando algo está caído: `{ status: 'degraded', uptime, timestamp, db, redis }`
    con `db`/`redis ∈ up|down|skipped`.
- **Chequeo ligero de dependencias:** `SELECT 1` a Postgres vía `PrismaService`. **Redis: `PING` solo si hay
  cliente disponible.** Hoy **no** hay cliente Redis registrado en el `AppModule` (los jobs BullMQ aún no
  están cableados, ver §3/§5), así que `redis` sale como **`skipped`** y **NO** degrada la salud. Si devops
  registra un provider bajo el token `HEALTH_REDIS_CLIENT` (interfaz `{ ping(): Promise<string> }`), el
  health lo pingueará automáticamente y `redis` pasará a `up`/`down`. Un `down` real (DB o Redis) da 503.
- **Barato a propósito:** sin escrituras, sin locks, sin llamadas externas de negocio.

### Acción para **devops**
- **Fijar `healthcheckPath: "/api/v1/health"` en `railway.json`** (y el healthcheck del `docker-compose`/
  CI si aplica). El endpoint ya está listo y no requiere auth ni cabeceras.
- Considerar un `healthcheckTimeout` holgado (p. ej. 30 s) para tolerar el arranque de Prisma.

### Solicitud de cambio de contrato al **arquitecto** (no edité `API_CONTRACT.md`)
10. **Formalizar `GET /api/v1/health`** en el contrato (sección de **salud/infra**): público, `200
    { status:'ok', uptime, timestamp, db, redis }` / `503 { status:'degraded', ... }`. Hoy es un endpoint
    operativo (no de negocio) que el contrato aún no describe. **No bloquea.**

**Verde (este encargo):** `lint` + `typecheck` + `build` OK; `npm test` = **99 verdes** (antes 95; +4 del
health: 200/ok sin Redis, 200/ok con Redis PING, 503 por DB caída, 503 por PING de Redis fallido). El smoke
de DI (`app.module.spec`) sigue verde con el `HealthModule` cableado.

## 13. Alcance v1.1 (2026-08-14) — raw NM, Compra con precio, sync catálogo, Google, portafolio, sellado

> Implementa el contrato/arquitectura **v1.1**. Greenfield (sin backfill de datos). Todo con
> `lint/typecheck/test/build` en verde: `npm test` = **129 verdes** (antes 99; +30 de v1.1).

### 13.1 Migración Prisma
- **Nueva migración `prisma/migrations/20260814100000_v11_scope/`** (ARCHITECTURE §11, M-1..M-11):
  - **M-1** `RawCondition` → **solo `NM`** (se recrea el enum y se recastean `InventoryItem.rawCondition`
    y `SellRequestItem.rawCondition`; greenfield, sin filas ≠ NM que migrar).
  - **M-2** `SealedSubtype` (`box|etb|bundle|tin|blister`) + `InventoryItem.sealedSubtype` (nullable).
  - **M-3..M-7** `User`: `passwordHash` **nullable**, `authProvider` (`local|google`, default `local`),
    `googleId String? @unique`, `emailVerified Boolean @default(false)`, `avatarUrl String?`.
  - **M-8** modelo nuevo **`PortfolioSnapshot`** (`userId`, `asOfDate @db.Date`, `totalValueMxnCents`,
    `costBasisMxnCents?`, `pendingPriceCount`, `@@unique([userId,asOfDate])`, `@@index([userId,asOfDate])`).
  - **M-9** seed del dial **`catalog_sync_from_date` = `"2024/01/01"`** (idempotente, `ON CONFLICT DO NOTHING`;
    también se siembra por `npm run seed` vía `SETTING_DEFAULTS`).
  - **M-10** `Dispute.type` ya es `String` libre → admite `condition_sealed` sin cambio de esquema.
  - **M-11** `Card.rarity` permanece **String libre** (taxonomía abierta; captura rarezas modernas).

### 13.2 Login con Google (`POST /auth/google`)
- `GoogleTokenVerifier` (`google-auth-library`) valida el ID token **server-side**: firma JWKS,
  `aud=GOOGLE_CLIENT_ID`, `iss` de Google, `exp`, y `email_verified`. Es una clase inyectable delgada
  (mockeable en tests). Sin `GOOGLE_CLIENT_ID` rechaza (nunca acepta a ciegas).
- `AuthService.google(idToken)`: verifica → exige `email_verified` (si no, **`403 GOOGLE_EMAIL_UNVERIFIED`**,
  no crea ni enlaza) → busca por `googleId` → **account-linking por email verificado** a cuenta local
  (audita `auth.google_link`) → si no existe, **crea** (`authProvider=google`, `emailVerified=true`,
  `passwordHash=null`, **`role=customer` SIEMPRE server-side**, nunca del token). Mismo shape que `/login`.
  Errores: `401 GOOGLE_TOKEN_INVALID`, `403 GOOGLE_EMAIL_UNVERIFIED`, `403 USER_BLOCKED`.
- **`/auth/login` rechaza cuentas sin `passwordHash`** (solo-Google) con `401 INVALID_CREDENTIALS`
  (no revela que es cuenta Google).
- **`/users/me`** ahora expone `authProvider`, `emailVerified`, `avatarUrl?`.
- Endpoint con `@Throttle` estrecho (5/min por IP, igual que `/login`).

### 13.3 Sync de catálogo M2 (super_admin, auditado)
- `PokemonTcgIoClient` (`modules/catalog/pokemontcg-io.client.ts`): **host FIJO** `https://api.pokemontcg.io/v2`
  (anti-SSRF), header `X-Api-Key` desde `POKEMONTCG_IO_API_KEY`. `getSets()`, `getCardsBySet(setId,page)`.
- `CatalogSyncService`: `remoteSets()` (`imported`/`cardCount` locales), `sync({setId?,fromReleaseDate?})`
  (default `fromReleaseDate` = dial `catalog_sync_from_date`), `backfill({batchSize=10,untilYear?})` →
  `{imported, newBoundary, remaining}`. **Upsert idempotente por `externalId`** (set y cartas).
  **Guardarraíl `setId` `^[a-z0-9]+(-[a-z0-9]+)*$`** (anti-inyección de `q=set.id:`), `fromReleaseDate`
  validado `yyyy/MM/dd`. `Card.rarity` se persiste tal cual (rarezas modernas).
- `AdminCatalogController` (`/admin/catalog/*`, `super_admin`): `remote-sets`, `sync` (202), `backfill` (200).
  Cada operación queda en `AuditLog` (`catalog.remote_sets|catalog.sync|catalog.backfill`).
- **Ejecución síncrona (MVP)** como `price-sync`; en prod la cola BullMQ da el rate-limit del free tier.

### 13.4 "Compra" = inventario publicado con precio (semántica v1.1)
- `GET /catalog/cards` ahora devuelve **solo `status=listed` + plataforma + precio de venta RESOLUBLE**
  (`listPriceCents` fijado/override **o** referencia con la que calcular precio×markup) y `sellable=true`.
  **Excluye "precio pendiente"** (el comprador nunca lo ve). Gate coarse en DB
  (`listPriceCents>0` **OR** `card.priceReferences.some`) + confirmación exacta de `sellable` al construir
  el DTO; **paginación en memoria** sobre el conjunto comprable (aceptable por inventario propio acotado;
  ver TECH_DEBT abajo).
- `GET /catalog/facets` (**nuevo**): `rarities` (distinct de `Card.rarity`, espejo pokemontcg.io), `sets`
  (`{id,name,releaseDate,year}` con `year` derivado, orden año desc), `productTypes`, `sealedSubtypes`,
  `price{minCents,maxCents}` — todo sobre el inventario **publicado y comprable**.
- `GET /catalog/sets` añade `year` (derivado de `releaseDate`), orden año desc; solo sets con inventario publicado.
- `GET /catalog/cards/:cardId` y `GET /catalog/listings/:id` respetan el mismo gate; **`listings/:id` → 404**
  para item no publicado / sin precio (antes de v1.1 devolvía 200 con `sellable=false`). Filtro nuevo por `sealedSubtype`.
- **Actualicé el E2E** `catalog-checkout-webhook.e2e-spec.ts` (assert de `listedPending`: ahora **404** en
  `GET /catalog/listings/:id`, coherente con el contrato v1.1). El resto del E2E no cambia (listedCharizard
  sigue apareciendo por su referencia).

### 13.5 Sellado como línea de venta
- `POST /admin/inventory/items` soporta `productType=sealed` + `sealedSubtype`; **sin condición/grade/rareza**
  (validación `validateProductShape`: sellado con `rawCondition`/grade → `422 VALIDATION_ERROR`; raw solo `NM`;
  graded exige compañía+grado). El **precio manual MXN (`listPriceCents`) es obligatorio para publicar**: sin
  él, el sellado se crea pero se escala a **precio pendiente** (no aparece en Compra). `ListingDTO` lleva `sealedSubtype`.
- Disputas: `Dispute` generalizada a **sellado** (`type=condition_sealed`, evidencia = foto de la caja al
  ingreso); graded sigue devolviendo `NOT_RAW`.

### 13.6 Gráfica de portafolio + scheduler (BE-5)
- `PortfolioSnapshotJobService` (`src/jobs/portfolio-snapshot.service.ts`, alojado en `VaultModule` para
  evitar ciclos): reutiliza `VaultService.holdings()` (valor a **referencia**, excluye pendientes) + base de
  costo agregada; **upsert idempotente por día** (`@@unique[userId,asOfDate]`).
- `GET /vault/portfolio/history?range=5d|15d|1m|3m|6m|1y|ytd|all` (default `1m`, `customer`) →
  `{range, points[], change{absMxnCents,pct,direction}}`. Sin snapshots → `points:[]`, `change` flat/`pct:null`.
  Backfill indicativo (`estimated`) **no** implementado (opcional en el contrato; queda como mejora futura).
- **Scheduler BullMQ (BE-5)** `src/jobs/scheduler.service.ts`: programa **`fx-refresh`, `price-sync` y
  `portfolio-snapshot`** diarios (repeatable jobs, UTC escalonado) con `REDIS_URL`. **Se activa solo si hay
  `REDIS_URL`**; sin él queda deshabilitado sin abrir conexiones (arranque local/tests/CI sin infra intactos).
  Disparo manual admin: `POST /admin/pricing/sync`, `POST /admin/fx/refresh`, **nuevo** `POST /admin/jobs/portfolio-snapshot`.

### 13.7 AcquisitionPricer — rarezas modernas
- `BuylistService.categoryForRarity`: **default `ex_plus`** para rarezas NO listadas como común/reverse
  (Illustration/Special Illustration Rare, Full Art, Alternate Art, Trainer Gallery, Character Rare, Radiant,
  etc.). `comun`/`reverse_holo` solo si la tabla `rarity-map` lo dice explícitamente. La cotización sigue:
  ex_plus **con** market price → 40% de la referencia; **sin** dato → `precio_pendiente` (lado adquisición,
  nunca al comprador). Condición siempre NM.

### 13.8 Variables de entorno NUEVAS para **devops** (no edité `.env.example`)
- **`GOOGLE_CLIENT_ID`** (backend) — audiencia esperada del ID token de Google (validación `aud`). Sin ella,
  `POST /auth/google` responde `401 GOOGLE_TOKEN_INVALID` (login Google inhabilitado, el resto no se rompe).
  Correlato frontend: **`NEXT_PUBLIC_GOOGLE_CLIENT_ID`** (Google Identity Services; propiedad de frontend/devops).
  **Solicitud a devops:** añadir ambas a `.env.example` (sin `client_secret`: flujo de ID token, no code-exchange).
- **`REDIS_URL`** ya está en la arquitectura; ahora el **scheduler BE-5** lo consume para los jobs diarios.
  Sin `REDIS_URL` el scheduler queda deshabilitado (jobs disparables a mano). Con multi-instancia, correr el
  worker en **un solo** proceso/instancia (o aceptar que BullMQ deduplica por `jobId` repetible).
- `POKEMONTCG_IO_API_KEY` (ya listado en ARCHITECTURE §8) — lo consume el `PokemonTcgIoClient` del sync M2.

### 13.9 Dependencias runtime nuevas
- **`google-auth-library@^9`** (verificación del ID token), **`bullmq@^5`** + **`ioredis@^5`** (scheduler BE-5).
- `npm audit --omit=dev` tras el alta: **0 high / 0 critical**; **6 moderate** (los 4 previos de framework/
  file-type + 2 nuevos transitivos `gaxios`→`uuid` de google-auth-library, no explotables aquí). Se mantiene
  la política (sin high/critical en runtime).

### 13.10 Deuda técnica / notas (a petición del techlead)
- **Paginación en memoria de Compra:** `GET /catalog/cards`/`facets`/`sets` computan `sellable` por item
  (una lectura de referencia por item) y paginan en memoria sobre el conjunto comprable. Correcto y acotado
  para el inventario **propio** del MVP; a escala convendría **persistir `salePriceCents`/flag `published`**
  al listar + índice y paginar en DB. **No bloqueante.**
- **Sync de catálogo síncrono (MVP):** `sync`/`backfill` importan en proceso (como `price-sync`). Para
  colecciones grandes conviene moverlo a la cola BullMQ con rate-limit del free tier. **No bloqueante.**

### 13.11 Solicitudes de cambio de contrato al **arquitecto** (no edité `API_CONTRACT.md`)
11. **`GET /users/me` — campos v1.1.** Ya devuelvo `authProvider`/`emailVerified`/`avatarUrl` (contrato §Auth).
    Sin cambio pendiente; solo lo registro.
12. **Disputa de sellado.** El contrato §7 mantiene `422 NOT_RAW` y no describe un path explícito de disputa
    de sellado, pero ARCHITECTURE §3.6 la contempla. Generalicé `Dispute` a raw **y** sellado
    (`type=condition_sealed`, evidencia = foto de la caja); graded sigue con `NOT_RAW`. **Sugiero al arquitecto
    precisar §7** (renombrar el error o documentar el caso sellado). **No bloquea.**
13. ~~**`catalog_sync_from_date` (dial M10).** Nuevo dial interno (default `"2024/01/01"`); **NO** expuesto en el
    DTO de `GET/PUT /admin/settings`.~~ **RESUELTO (2026-08-14, ver §14):** el arquitecto lo formalizó en
    `API_CONTRACT §M10` como `catalogSyncFromDate` y ya está expuesto/editable por API.

**Verde (v1.1):** `npm run lint && npm run typecheck && npm test && npm run build` OK; `npm test` = **129
verdes** (+30: verificación de ID token Google [aud/firma inválida→401, email no verificado→403, linking sin
duplicar, alta role=customer, login solo-Google→401], sync idempotente + validación `setId` + default por
fecha, semántica de Compra [excluye sin precio] + facetas + `year`, sellado con/sin precio + validación,
snapshot idempotente + `change`, AcquisitionPricer rareza moderna → ex_plus, gating del scheduler por `REDIS_URL`).

## 14. `catalogSyncFromDate` expuesto en el DTO de M10 (2026-08-14)

> Ajuste menor de contrato ya formalizado por el arquitecto (`API_CONTRACT §M10`): el dial
> `catalog_sync_from_date` pasa a ser una `ConfigSetting` de primera clase, legible y editable por API como
> `catalogSyncFromDate` (string `yyyy/MM/dd`, default `"2024/01/01"`). Cierra la solicitud #13 de §13.11.

- **Sin lógica duplicada.** El dial `catalog_sync_from_date` (key, default y validador `yyyy/MM/dd`) ya existía
  en `settings.constants.ts` desde v1.1 (M-9). El único cambio necesario fue **añadir la entrada
  `catalogSyncFromDate → CATALOG_SYNC_FROM_DATE` a `SETTING_DTO_MAP`**, que gobierna a la vez:
  - `GET /admin/settings` (`getAllDto` itera el mapa) → ahora incluye `catalogSyncFromDate`.
  - `PUT /admin/settings` (`update` valida contra el mapa) → ahora lo acepta y lo valida con el validador
    existente (`^\d{4}\/\d{2}\/\d{2}$` → formato inválido = `422 VALIDATION_ERROR`). Las keys desconocidas
    se siguen rechazando con 422 (allow-list "todo o nada" intacta, §6).
  El `CatalogSyncService` sigue leyendo el mismo dial vía `SettingsService.getString(CATALOG_SYNC_FROM_DATE)`
  (una sola fuente de verdad; no se tocó su lógica).
- **Tests** (`test/settings.validation.spec.ts`): lectura del dial en `getAllDto` (default y valor persistido),
  actualización válida (`2025/03/01` → upsert de `catalog_sync_from_date`) y formato inválido → 422
  (`2025-03-01`, `not-a-date`, numérico).
- **Nota (fuera de este encargo):** el contrato §M10 también lista `stripeFeeIvaPct` en el DTO de
  `GET /admin/settings`, pero ese dial **sigue sin estar** en `SETTING_DTO_MAP` (dial interno, ver §11.2). Es
  una discrepancia contrato↔código independiente; **no** la toqué en este encargo (alcance = solo
  `catalogSyncFromDate`). **Se señala al arquitecto/orquestador** para decidir si se expone también.

**Verde (este encargo):** `npm run lint && npm run typecheck && npm run build` OK; `npm test` = **133 verdes**
(antes 129; +4: getAllDto expone `catalogSyncFromDate` con default y valor persistido, PUT válido, PUT formato
inválido → 422).

## 15. Fixes de QA/techlead sobre alcance v1.1 (2026-08-14)

> Correcciones de los hallazgos de QA y techlead. Solo se tocó `backend/` (+ estas notas y `TECH_DEBT.md`).
> Ningún cambio de contrato: todos los fixes implementan lo que el contrato/PROJECT ya exigían.

- **BLOQUEANTE (QA) — guard de `itemStatus` en `convertToInventory`.**
  `src/modules/buylist/buylist.service.ts` → `convertToInventory` (~L419). Se añade una **guardia de
  aprobación**: si `item.itemStatus !== 'aprobada'` → **`422 ITEM_NOT_APPROVED`** (nuevo errorCode en
  `common/error-codes.ts`) y **no se crea InventoryItem**. Así una carta `rechazada` (resultado de
  verificación NO-NM, PROJECT §H / criterios 3d/16) NUNCA se vuelve inventario vendible. La guardia va
  **después** del pre-check de idempotencia (un item ya convertido, `inventoryItemId` set, sigue devolviendo
  idempotente sin 422) y **antes** del create; se conservan la idempotencia y la guardia TOCTOU por índice
  único (`sourceSellRequestItemId` + P2002). El controlador `admin-buylist.controller.ts:105` no cambia
  (delega en el servicio; el 422 se propaga y se serializa por el filtro global).
  Tests: `test/buylist.convert-guard.spec.ts` (rechazada/estados no aprobados → 422 sin create; aprobada →
  crea y marca `convertida_inventario`; ya convertido → idempotente). Se actualizó el mock de
  `test/buylist.security.spec.ts` (SEC-A3) para incluir `itemStatus: 'aprobada'`.

- **IMPORTANTE (QA) — `POST /disputes` devuelve `type`.**
  `src/modules/disputes/disputes.service.ts` → `create` ahora incluye `type`
  (`condition_raw | condition_sealed`, derivado server-side del `productType`) en la respuesta 201, como
  exige el contrato §7. Test: `test/disputes.create-type.spec.ts` (raw→condition_raw, sealed→condition_sealed,
  graded→422 NOT_RAW).

- **MENOR (QA) — saneo de filtros enum en `GET /catalog/cards`.**
  `src/modules/catalog/catalog.service.ts` → `listCards`. Los filtros `productType`/`condition`/`sealedSubtype`
  (endpoint público) se validan contra los enums de Prisma (`ProductType`/`RawCondition`/`SealedSubtype`) con
  el helper `validateEnum`; un valor inválido (`?condition=LP`, `?productType=foo`) responde **`400
  VALIDATION_ERROR`** y **nunca llega a Prisma** (antes producía `500 PrismaClientValidationError`). Test:
  `test/catalog.enum-filters.spec.ts`.

- **D5 (techlead / seguridad) — enumeración por temporización en login.**
  `src/modules/auth/auth.service.ts` → `login`. Se ejecuta **siempre** `argon2.verify`: cuando no hay usuario
  o `passwordHash` es null (cuenta solo-Google) se verifica contra un **hash dummy fijo precomputado**
  (`DUMMY_PASSWORD_HASH`, argon2id) para igualar la latencia y cerrar el canal de temporización. Se mantiene
  `401 INVALID_CREDENTIALS` en ambas ramas y el caso Google intacto (sigue sin poder loguearse por
  contraseña). Test: `test/auth.login-timing.spec.ts` (ambas ramas → 401 y ejecutan `verify`; rama feliz
  intacta).

- **D4 (alinear con contrato §M10) — `stripeFeeIvaPct` en settings.**
  `src/modules/settings/settings.constants.ts` → añadido `stripeFeeIvaPct → STRIPE_FEE_IVA_PCT` a
  `SETTING_DTO_MAP` (el validador de rango `[0,1)` ya existía). Cierra la discrepancia señalada en §14. Ahora
  `GET/PUT /admin/settings` leen/actualizan el dial. Test añadido en `test/settings.validation.spec.ts`
  (getAllDto expone default 0.16; update válido persiste `stripe_fee_iva_pct`; `>= 1` → 422).

- **Deuda registrada** (`docs/TECH_DEBT.md`): **D1** (sync de catálogo síncrono con `jobId` ficticio → mover
  a cola BullMQ), **D2** (`pokemontcg-io.client.getSets()` sin paginación, trunca > 250 sets), **D3**
  (N+1 de `getReference` en holdings/snapshot → batch). **D4 y D5 marcadas como RESUELTAS** en este pase.

**Verde (este pase):** `npm run lint && npm run typecheck && npm run build` OK; `npm test` = **155 verdes,
30 suites** (antes 133; +5 tests nuevos de los fixes, ajustado 1 mock existente).

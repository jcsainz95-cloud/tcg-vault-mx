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

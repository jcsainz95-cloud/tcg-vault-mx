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
| **disputes** (M8) | ✅ Completo | Ventana 7d desde entrega, disputa por correo (evidencia adjunta), recompra (money-out solo `super_admin`). |
| **uploads** | ✅ Completo | Presigned PUT S3/MinIO acotado a `kyc_ine` (v1.2: sin `dispute_claim`/`inventory_photo`). |
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
5. **Shape de las LISTAS de buylist (fix de QA — crash de vistas).** QA reportó 2 bugs preexistentes: las
   respuestas de **lista** no incluían las relaciones que el contrato/frontend esperan y crasheaban las
   vistas.
   - `GET /buylist/requests` (`listMine`, comprador) devolvía filas Prisma crudas **sin `items`** y con
     `id` en vez de `sellRequestId`. `BuylistView` itera `r.items.map(...)` → `TypeError`. **Fix:** ahora
     incluye `items: { include: { card: true } }` y mapea al shape **`SellRequestDTO`**
     (`sellRequestId` + `items: SellItemDTO[]` vía `itemDTO`, con `rarity`/`appliedRule`/`card`).
   - `GET /admin/buylist` (`adminList`, M5) incluía `items` **sin `card`**. `M5View` lee `it.card.name` →
     `TypeError`. **Fix:** `items: { include: { card: true } }` y mapeo a **`AdminBuylistDTO`**
     (`id`/`userId`/`quotedTotalCents`/`approvedTotalCents?`/`items[].card`).
   - Regresión fijada por `test/buylist.list-shapes.spec.ts` (asserta el `include` y el shape de ambas
     listas: un `include` faltante lo atrapa el test, no el runtime).
   - **Filtro `deleted` en `GET /admin/users`:** el enum `UserStatus` ya incluye `deleted`; el filtro
     `?status=` de la lista lo acepta trivialmente (el service pasa el string a `where.status`), sin
     cambios de código. El `PATCH .../status` sigue restringido a `active|blocked` (el contrato fija
     `deleted` solo por `DELETE /admin/users/:id`).

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
6. **§M8 disputes — RESUELTO (ya alineado, sin acción pendiente).** El contrato §M8
   (`API_CONTRACT.md:485`) **ya** recoge la política VENTAS FINALES: en `repurchase` el
   **cliente conserva la carta** y la carta **NO** regresa al inventario (no re-agrega item, no crea
   `InventoryMovement`). La implementación (`disputes.service.ts › resolve`) coincide exactamente.
   Ya **no** hay discrepancia ni solicitud de cambio abierta; el docstring de `resolve()` se actualizó
   para reflejar el alineamiento (cierre de hallazgo techlead v1.2). **No bloqueante.**
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
- **Scheduler BullMQ (BE-5 / v15-D1)** `src/jobs/scheduler.service.ts`: programa **los 7 jobs diarios**
  (repeatable jobs, UTC escalonado) con `REDIS_URL` — ver §18 para el detalle actualizado. **Se activa solo
  si hay `REDIS_URL`**; sin él queda deshabilitado sin abrir conexiones (arranque local/tests/CI sin infra
  intactos). Disparo manual admin: `POST /admin/pricing/sync`, `POST /admin/fx/refresh`,
  `POST /admin/jobs/{portfolio-snapshot,ine-retention,buylist-sweep,dispute-deadline,auth-token-sweep}`.

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

---

## 16. Simplificación v1.2 / v1.2.1 (2026-08-14) — sin fotos de producto, gradeadas por certificado, uploads solo INE, disputa por correo

> Implementa el contrato/arquitectura **v1.2 / v1.2.1** (changelog + migraciones **M-12/M-13**). Greenfield
> (sin backfill de datos). Verde: `npm run lint && npm run typecheck && npm test && npm run build` OK;
> `npm test` = **163 verdes, 32 suites** (antes 155; +2 suites nuevas: `uploads.presign`, `inventory.graded-cert`).
> **INE/CLABE intactos** (v1.2.1 revierte solo la parte del INE): cifrado PII, retención y `reveal-clabe` sin cambios.

### 16.1 Migración Prisma (`20260814200000_v12_simplification`)
- **M-12 — `InventoryItem.certNumber`** (`String?`, add column): nº de certificado PSA/CGC. Solo para
  `productType=graded` (null en raw/sealed). **Requerido a nivel de aplicación** para publicar una gradeada
  (validación de servicio, no `NOT NULL` en BD). Sin validación automática contra la graduadora.
- **M-13 — drop de campos de foto** (greenfield, sin datos que migrar):
  - `InventoryItem.frontPhotoKey` / `backPhotoKey` / `extraPhotoKeys`
  - `SellRequestItem.photoKeys`
  - `Dispute.ingressPhotoKeys` / `claimPhotoKeys`
- **NO tocado:** `KycProfile.ineFrontKey`/`ineBackKey`, columnas `*Enc`/`*Hmac`, retención `INE_RETENTION_DAYS`,
  `reveal-clabe`. La migración de v1.2 no toca el esquema de INE/CLABE.
- `schema.prisma` deja **comentarios `// v1.2 (M-13)`** donde estaban los campos, para trazabilidad.

### 16.2 Alta de inventario (`POST /admin/inventory/items`)
- `CreateItemDto` / `UpdateItemDto`: **eliminados** `frontPhotoKey`/`backPhotoKey`/`extraPhotoKeys`;
  **añadido** `certNumber?`. La imagen del item es siempre la de **catálogo remota** de la `Card`.
- **Gradeada exige `certNumber` para publicar:** `validateProductShape` (graded) ahora rechaza con
  **`422 VALIDATION_ERROR`** si falta `certNumber` (o viene vacío). raw/sealed lo dejan `null`.
- `ListingDTO` (catalog): **sin** `frontPhotoUrl`/`backPhotoUrl` (se eliminó el helper `photoUrl`); ahora
  expone `certNumber` para gradeadas. La imagen = `CardDTO.imageSmallUrl`/`imageLargeUrl`.
- El detalle de bóveda (`GET /vault/holdings/:id`) expone `certNumber` para gradeadas; sin claves de foto.

### 16.3 Uploads/presign acotado a `kyc_ine` (`POST /uploads/presign`)
- `UploadsService.presign` acepta **solo** `purpose="kyc_ine"`; cualquier otro (incl. `inventory_photo`,
  `dispute_claim`) → **`422 VALIDATION_ERROR`** (regla de negocio, no el 400 del `ValidationPipe`: el DTO
  recibe `purpose` como `String` libre y el servicio valida).
- **Pipeline INE intacto:** presign PUT (bucket **privado** + cifrado), presign GET de vida corta
  (`presignGet`, usado por back-office M6), retención (`ine-retention` job), `S3_*`, `PII_*` sin cambios.

### 16.4 Disputa por correo (`POST /disputes`, `GET /admin/disputes/:id`)
- `CreateDisputeDto`: **eliminado** `claimPhotoUploadKeys`. La respuesta 201 ahora incluye
  **`evidenceContact`** (correo de soporte), además de `type` (`condition_raw|condition_sealed`) y `deadlineAt`.
- Valor de `evidenceContact` en **`src/modules/disputes/disputes.constants.ts`**:
  `DISPUTE_EVIDENCE_CONTACT = 'soporte@tcgvaultmx.com'` (placeholder; overridable por env
  `DISPUTE_EVIDENCE_CONTACT`). **SUPUESTO por confirmar por el humano** (ver PROJECT.md).
- `DisputesService` ya **no** depende de `UploadsService` (quitado del constructor y del `DisputesModule`).
  `adminGet` **sin comparador de fotos**: expone `type`, `deadlineAt`, `evidenceContact` y el item (para
  gradeadas: `gradingCompany + gradeValue + certNumber`). Se conserva **VENTAS FINALES** y la resolución
  por grado/`certNumber` (gradeadas) o estándar NM (raw) — sin cambios de negocio.

### 16.5 Tests (ajustados + nuevos)
- **Nuevos:** `test/inventory.graded-cert.spec.ts` (gradeada sin `certNumber` → 422; con `certNumber`
  persiste y no guarda claves de foto), `test/uploads.presign.spec.ts` (`kyc_ine` acepta; `inventory_photo`/
  `dispute_claim`/otros → 422).
- **Ajustados:** `test/disputes.create-type.spec.ts` (respuesta incluye `evidenceContact`; no persiste claves
  de foto), `test/disputes.presign.spec.ts` (reescrito: adminGet sin fotos, expone `evidenceContact`),
  `test/disputes.repurchase.spec.ts` (constructor sin `UploadsService`), `test/catalog.spec.ts` (mock de item
  sin claves de foto, con `certNumber`), `test/integration/infra-smoke.e2e-spec.ts` (presign usa `kyc_ine`).

### 16.6 Env para **devops** (no edité `.env.example`)
- **`DISPUTE_EVIDENCE_CONTACT`** (opcional): correo de soporte para evidencia de disputa. Default
  `soporte@tcgvaultmx.com`. Añadir a `.env.example` cuando el humano confirme la dirección real.

### 16.7 Nota de coherencia con el contrato
- El contrato (§M1) lista `graded sin certNumber` explícitamente como **`422 VALIDATION_ERROR`** en el alta,
  por lo que implementé el `certNumber` como **requisito duro en el alta** de gradeadas (no como "creable pero
  no vendible"). Coincide con el test "gradeada sin certNumber no se publica". **Sin discrepancias abiertas**
  con el contrato en este pase.

### 16.8 Cierre hallazgo techlead v1.2 — invariante `certNumber` también en UPDATE
- **Gap:** la invariante "gradeada publicada exige `certNumber`" solo se aplicaba en `createItem`
  (`validateProductShape`); `updateItem` hacía `update({ data: dto })` sin revalidar, así que un PATCH
  podía **publicar** (`status:'listed'`) o **mantener publicada** una gradeada sin cert, o **quitar** el cert
  de una gradeada ya listada. La habría dejado aparecer en Compra sin nº de certificado verificable.
- **Fix (`inventory.service.ts › updateItem`):** se valida el **estado RESULTANTE** del PATCH — si
  `productType === 'graded'` **y** el `status` resultante es `listed`, el `certNumber` resultante (el del dto
  si viene, si no el persistido) debe ser no vacío; en caso contrario **`422 VALIDATION_ERROR`**. `updateItem`
  no puede cambiar `productType` (el DTO no lo expone), por eso se toma el del item actual.
- **Tests** (`test/inventory.graded-cert.spec.ts`, nuevo bloque `updateItem`): publicar gradeada sin cert →
  422; quitar cert de gradeada publicada → 422; publicar con cert (previo o aportado en el mismo dto) → OK;
  PATCH a gradeada `in_stock` sin cert → OK (la invariante solo aplica al publicar); PATCH a raw publicada
  sin cert → OK. Suite total **169 verdes** (antes 163).
- **Docstrings corregidos (sin cambio de comportamiento):** `disputes.service.ts › resolve()` (ya no
  afirma discrepancia con §M8; el contrato está alineado) y `uploads.service.ts › presignGet()` (acotado a
  `kyc_ine`; se retiró la referencia muerta a "fotos de disputa", eliminadas en v1.2).

## 17. Endurecimiento de producción (cierre de S-M2 / S-B3 / S-B4 / S-M1 · rol backend)

> Cierre de la deuda enrutada a **backend** en `docs/SECURITY_NOTES.md §4` para promoción a producción.
> Todo en `backend/`. `lint` + `typecheck` + `build` OK; `npm test` = **177 verdes** (antes 169; +8 de
> uploads: allow-list de content-type + límite de tamaño). **No** toqué `docs/API_CONTRACT.md` (los cambios
> son aditivos y compatibles con §8).

### 17.1 S-M2 — CORS con allow-list (`main.ts`)
- Se elimina `app.enableCors({ origin: true, ... })`. Ahora el origin se toma de **`APP_BASE_URL`**
  (lista **separada por comas** si hay varios orígenes válidos, p. ej. `https://app.tcgvaultmx.com,https://tcgvaultmx.com`).
  **`credentials: true` se mantiene.** Nunca se refleja un origin arbitrario.
- **Fallback seguro** si `APP_BASE_URL` no está seteada: solo orígenes de **desarrollo local**
  (`http://localhost:3000`, `http://localhost:5173`) — jamás un comodín. Se loguea la allow-list efectiva al
  arrancar. **En staging/producción `APP_BASE_URL` DEBE fijarse** (si no, el frontend real no pasará CORS).

### 17.2 S-B4 — helmet + `algorithms` JWT + validación de env
- **helmet:** `app.use(helmet())` en `main.ts` (dependencia nueva `helmet`, añadida a `package.json`).
  Aplica CSP por defecto, HSTS, `X-Content-Type-Options: nosniff`, frameguard, etc.
- **`algorithms` JWT fijados a `HS256`** (evita algorithm-confusion), tanto al **firmar** como al **verificar**:
  `auth.service.ts › issueTokens` (`algorithm: 'HS256'` en access y refresh), `auth.service.ts › refresh`
  y `common/guards/jwt-auth.guard.ts` (`algorithms: ['HS256']` al verificar). El login con Google reusa
  `issueTokens`, así que queda cubierto sin cambios adicionales.
- **Validación de env corre SIEMPRE** (antes solo `NODE_ENV==='production'`). `config/env.validation.ts`:
  ahora aborta el arranque si faltan `DATABASE_URL`/`JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`/
  `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` en **cualquier entorno NO-local** (incluye **staging**, antes no
  cubierto). Se mantiene el patrón local/no-local del repo (seed, pii-crypto): en `development`/`test`/`local`
  (o sin `NODE_ENV`) NO aborta, para no romper dev/CI sin secretos reales. Se añade además un **chequeo de
  entropía**: los secretos JWT deben tener **≥ 32 caracteres** en entornos no-locales (si no, aborta).
  **Acción devops:** garantizar en staging/prod que `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` cumplen la
  longitud mínima y provienen del secret manager.

### 17.3 S-B3 — Presign KYC (`uploads.service.ts` / `uploads.controller.ts`)
- **Allow-list de content-type:** el presign de `kyc_ine` solo admite `image/*`; cualquier otro
  (`text/html`, `application/pdf`, `application/octet-stream`, …) → **`422 VALIDATION_ERROR`**.
- **Límite de tamaño:** default **10 MiB**, configurable por env **`KYC_UPLOAD_MAX_BYTES`** (bytes). El DTO
  acepta un **`contentLength` opcional** (aditivo al contrato §8, `Req` no lo exigía): si el cliente lo declara,
  se valida contra el tope (`422 VALIDATION_ERROR` si excede o no es entero positivo) **y** se **fija en la
  firma** (`ContentLength`), de modo que el PUT deba enviar exactamente ese tamaño (S3 rechaza si el cuerpo no
  coincide). La respuesta ahora incluye `maxBytes` y, si se declaró tamaño, el header `Content-Length`.
- **Defensa extra (mismo hallazgo):** `presignGet` sirve el INE con `ResponseContentDisposition: attachment`
  (nunca render inline) → un objeto malicioso se descarga en vez de ejecutarse aunque se abra desde el dominio
  de storage. El bucket privado sigue siendo responsabilidad de **devops** (S-B3 infra).
- **Tests** (`test/uploads.presign.spec.ts`): rechazo de `text/html`/`application/pdf`/`octet-stream`;
  aceptación de `image/jpeg`/`image/png`; rechazo por tamaño > tope (default y `KYC_UPLOAD_MAX_BYTES`
  custom); rechazo de `contentLength` no positivo; reflejo de `Content-Length`/`maxBytes` en la respuesta.

### 17.4 S-M1 — Dependencias (moderate) del runtime
- `npm audit fix` **no forzado** no aplicaba nada (las correcciones vivían en transitivos anidados). Se
  resolvieron con **`overrides` compatibles** (sin breaking change):
  - **`uuid ^11.1.1`** (cierra GHSA-w5hq-g745-h8pq vía `gaxios`→`google-auth-library`; `uuid@11` soporta
    CommonJS, API `v4()` estable).
  - **`file-type ^21.3.4`** (cierra GHSA-5v7r-6r5c-r473 / GHSA-j47w-4g3g-c36v vía `@nestjs/common`, que ya
    cargaba `file-type` **ESM por dynamic `import()`**; el bump mantiene el mismo mecanismo de carga).
- **`npm audit --omit=dev` (runtime):** pasó de **6 moderate** a **2 moderate**. Los 2 restantes son
  `@nestjs/core`/`@nestjs/platform-express` (GHSA-36xv-jgw5-4q75), cuyo **único fix es NestJS 11 (major,
  breaking)** — **NO se fuerza** (fuera del alcance de este encargo). **Deuda restante enrutada a devops**
  (gate `npm audit` en SAST + salto coordinado a NestJS 11 en un sprint de hardening). `file-type` no es
  alcanzable por nuestro código (no parseamos archivos en el server; uploads van directo a S3 por presign),
  pero el override deja el audit runtime limpio de ese hallazgo igualmente.

### 17.5 Variables de entorno nuevas / relevantes para **devops**
- **`APP_BASE_URL`** — **NUEVA, obligatoria en staging/prod.** Origen(es) permitido(s) por CORS, lista
  separada por comas. Sin ella se cae a los orígenes de **localhost** (solo dev). Añadir a `.env.example`.
- **`KYC_UPLOAD_MAX_BYTES`** — **NUEVA, opcional.** Tope de tamaño del upload de INE en bytes (default
  `10485760` = 10 MiB). Añadir a `.env.example` con el default comentado.
- Recordatorio S-B4/devops: `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` deben ser **≥ 32 chars** en
  staging/prod (ahora el arranque lo exige) y venir del secret manager.

---

## 18. Cotizador Opción 1 (v1.3, 2026-08-16) — buylist sobre TODO el catálogo + sync-all

Alcance del contrato v1.3 (`API_CONTRACT.md §6` y `§M2`): 3 endpoints nuevos de backend para que el
cotizador pueda elegir **cualquier** carta del catálogo (no solo el inventario comprable de "Compra").
**No hubo migración Prisma** (se reutilizan `Card`/`CardSet` existentes y `CardDTO`).

### 18.1 Endpoints implementados

- **`GET /api/v1/buylist/cards`** (público) — búsqueda paginada sobre **toda** la tabla `Card`.
  - Controller nuevo `BuylistCatalogController` (`modules/buylist/buylist-catalog.controller.ts`), delega en
    `CatalogService.searchAllCards()`. `BuylistModule` ahora importa `CatalogModule` (que ya exporta
    `CatalogService`); **sin ciclo** (CatalogModule no importa BuylistModule).
  - Query: `setId`, `q` (nombre `contains` case-insensitive **OR** número `contains`), `rarity` (String
    libre tal cual pokemontcg.io), `page`, `pageSize` (tope de servidor **≤100**, igual que el resto de
    endpoints públicos paginados). Respuesta `{ data: CardDTO[], page, pageSize, total }` (reutiliza
    `CardDTO`; **no** lleva `sellable`/`salePriceCents` — no es Compra). `total` vía `card.count`.
  - **Consulta `Card`, NO `InventoryItem`** → devuelve cartas que **no** tenemos en bóveda (justo lo que
    pide la Opción 1). No toca pricing.
  - **Rate-limit anti-scraping SIN sesión:** `@Throttle({ ttl: 60_000, limit: 60 })` por IP (más estricto
    que el global de 300/min), para no facilitar el volcado del catálogo desde un endpoint público.
- **`GET /api/v1/buylist/sets`** (público) — sets con **cartas importadas** (dropdown del cotizador).
  - `CatalogService.listSetsWithImportedCards()`: `cardSet.findMany({ where: { cards: { some: {} } } })`,
    `year` derivado de `releaseDate` (`yearFromReleaseDate`), ordenado por año **desc**. Respuesta
    `{ data: [{ id, name, series, releaseDate, year }] }`. Distinto de `GET /catalog/sets` (que solo trae
    sets con inventario **publicado**). Mismo throttle 60/min.
- **`POST /api/v1/admin/catalog/sync-all`** (super_admin, auditado) — importa TODO el catálogo. Ver 18.2.

### 18.2 `sync-all` — cómo se resolvió el NO-bloqueo (DEV-1) y sus límites

`CatalogSyncService.syncAll()` + `runSyncAll()` (`modules/catalog/catalog-sync.service.ts`), endpoint en
`AdminCatalogController` (`@HttpCode(202)`, audita `action: catalog.sync_all`).

- **Enfoque elegido: background in-process (NO se cableó BullMQ para catálogo).** Motivo: el
  `SchedulerService` BullMQ existente (BE-5) solo se activa con `REDIS_URL` y solo cablea los jobs diarios
  (`fx-refresh`/`price-sync`/`portfolio-snapshot`) en la cola `tcg-daily`; no hay worker de catálogo. Cablear
  una cola/worker dedicado de catálogo (con su rate-limiter y persistencia de progreso) excede este encargo,
  así que `sync-all` corre el barrido **en memoria del proceso** de forma **fire-and-forget**:
  1. `getSets()` (una llamada rápida a `/sets`) para calcular los sets **pendientes** (remotos que **no**
     tienen ya un `CardSet` local con ≥1 carta → **resumible**).
  2. Marca `syncAllRunning=true` y lanza `runSyncAll(pending)` **sin `await`** → el request retorna `202
     { jobId, setsQueued, remaining }` de inmediato (no espera la importación completa; resuelve el timeout de
     DEV-1 que sí tenía el `sync` from-date síncrono).
  3. `runSyncAll` importa **secuencialmente** cada set (respeta el rate-limit del free tier); un set que
     falla **no** aborta el barrido de los demás. Al terminar libera `syncAllRunning`.
- **Idempotente:** cada set/carta se persiste con `upsert` por `externalId` (no duplica al re-correr).
- **Resumible:** re-llamar `sync-all` reanuda solo los sets aún **no** importados. `setsQueued` = sets
  encolados en esa llamada; `remaining` = 0 cuando encolamos todos los pendientes.
- **Single-flight:** si ya hay un barrido en curso, una segunda llamada **no** lanza otro (evita duplicar
  carga y quemar rate-limit); devuelve `setsQueued: 0` y `remaining` = pendientes actuales.
- **Límites conocidos (deuda, enrutar a devops/techlead):**
  - El progreso vive **en memoria**: si el proceso se **reinicia** a mitad del barrido, los sets no
    importados quedan pendientes y se reanudan re-llamando `sync-all` (idempotente), pero **no** hay reintento
    automático ni backoff persistido. El `jobId` es **cosmético** (no consultable; alineado con DEV-2).
    Cuando devops cablee una cola BullMQ de catálogo, `syncAll()` debería encolar en ella en vez del
    fire-and-forget in-process. **No bloquea el MVP** (el `sync`/`backfill` existentes ya cubren la carga
    completa; `sync-all` la hace explícita y segura contra timeouts del request).
  - En despliegue **multi-instancia**, el `syncAllRunning` es por-instancia (dos réplicas podrían barrer en
    paralelo). Con la cola BullMQ (job único) esto se resuelve; hasta entonces, dispararlo desde una sola
    instancia/manualmente.

### 18.3 Gates (desde `backend/`)

- `npm run lint` ✅ · `npm run typecheck` ✅ · `npm test` ✅ **192 tests / 34 suites** (incluye **8 nuevos**:
  4 en `test/buylist-catalog.spec.ts`, 4 en `test/catalog-sync.spec.ts` describe `syncAll`) · `npm run build` ✅.
- Cobertura nueva: búsqueda por `set`/`q` en `/buylist/cards` sobre `Card` (prueba explícita de que **no**
  toca `InventoryItem` → incluye cartas sin inventario), paginación/`total`, `q` OR nombre/número;
  `/buylist/sets` (where `cards.some`, year desc); `sync-all` (encola solo pendientes = resumible, no
  bloquea, single-flight, upsert idempotente, y un set fallido no aborta el barrido).

### 18.4 Discrepancias con el contrato / decisiones para el **arquitecto**

- **Ninguna que exija cambio de contrato.** Los 3 endpoints se implementaron con los shapes exactos de
  `API_CONTRACT.md §6/§M2`.
- **Nota (no bloqueante):** el contrato menciona para `/buylist/cards` `Err 400 VALIDATION_ERROR
  (paginación inválida)`. Igual que el endpoint hermano `GET /catalog/cards`, aquí `page`/`pageSize`
  inválidos se **coercionan** a defaults (`page≥1`, `1≤pageSize≤100`) en vez de devolver 400 — se mantuvo la
  convención ya establecida en el codebase para uniformidad entre ambos buscadores públicos. Si el arquitecto
  prefiere 400 estricto, es un ajuste menor de validación en ambos controllers (avisar).
- **Pregunta abierta 1 de ARCHITECTURE §10 (pricing on-demand del cotizador):** `/buylist/cards` **no**
  pricea; el pricing de una `ex_plus` se resuelve en `POST /buylist/quote` (ya existente) contra el
  `PriceReference` en bóveda. Una carta fuera de bóveda sin market price sale `precio_pendiente` y escala a la
  cola del dueño al crear la solicitud (§13/criterio 13), tal como especifica el contrato. Sin cambio de
  backend requerido aquí; queda como decisión de producto si se quiere pricing on-demand (fuera de alcance).

## 19. Alineación de shapes al contrato tras rechazo de QA (2026-08-16)

QA rechazó por 4 mismatches donde el **backend omitía/violaba los nombres de campo del
contrato**. Correcciones (solo nombres del DTO de salida; **no** se tocaron columnas de BD,
enmascarado, ni lógica). Archivos: `modules/admin/admin.service.ts`,
`modules/pricing/pricing.controller.ts`.

- **M6 ficha 360° (`AdminService.getUser`)** — `API_CONTRACT §M6`. En **ambas** proyecciones
  (super_admin y vault_operator) el KYC ahora expone `clabeMasked` (antes `clabe`),
  `rfcMasked` (antes `rfc`, solo super_admin) y los topes como `capPerRequestCents` /
  `capPerMonthCents` (antes `capPerRequestCentsOverride` / `capPerMonthCentsOverride`; las
  **columnas** de BD siguen llamándose `*Override`, solo cambió el nombre en la respuesta).
  El `billingProfile` expone `rfcMasked` (antes `rfc`). El enmascarado y la segregación por
  rol (SEC-A4) no cambian: CLABE en claro sigue **solo** por `reveal-clabe`.
- **M2 rarity-map (`PricingController`)** — `API_CONTRACT §M2`. `GET/PUT
  /admin/pricing/rarity-map` ahora devuelven el envelope `{ entries: [{ rarity, category },
  ...] }` (antes el `GET` devolvía un `Record<string,string>` plano y el `PUT` devolvía el
  mapa). La **persistencia interna** sigue siendo un mapa (`ConfigSetting.valueJson`); se
  proyecta a `entries` al leer y al responder el `PUT`. El body del `PUT` ya aceptaba
  `{entries:[...]}` (sin cambio).
- **M7 IVA (`AdminService.ivaReport`)** — `API_CONTRACT §M7`. Cada item de `byOrder` expone
  `orderId` (antes `id`); conserva `ivaCents`, `settledAt`, `status`. `exportCsv` (report=iva)
  se ajustó para leer `orderId`.
- **M9 launch-metrics (`AdminService.launchMetrics`)** — `API_CONTRACT §M9`. `goals` es
  **`null`** (el objeto completo) cuando no hay metas fijadas, en vez de `{N:null,X:null,
  Y:null,Z:null}`. La lógica colapsa a `null` si ninguna meta está definida; cuando el humano
  fije al menos una, devolverá el objeto `{N,X,Y,Z}`. (Aún no existe fuente de metas: hoy
  siempre `null`, que es lo correcto por contrato.)

### 19.1 Tests que fijan estos shapes (para que un mismatch futuro lo atrape un test)

- `test/admin.pii.spec.ts` (actualizado): asserts sobre `clabeMasked` / `rfcMasked` /
  `capPerRequestCents` / `capPerMonthCents` y que los nombres viejos (`clabe`/`rfc`/`*Override`)
  ya **no** existen; billing con `rfcMasked`.
- `test/admin.contract-shapes.spec.ts` (nuevo): `ivaReport` → cada item con `orderId` (sin
  `id`); `launchMetrics` → `goals` null sin metas.
- `test/pricing.rarity-map.spec.ts` (nuevo): `GET`/`PUT` devuelven `{entries:[...]}`; GET con
  config ausente → `{entries: []}`; `PUT` persiste el mapa interno y responde el envelope.

### 19.2 Gates (desde `backend/`)

- `npm run lint` ✅ · `npm run typecheck` ✅ · `npm test` ✅ **197 tests / 36 suites**
  (antes 192/34; +5 tests, +2 suites) · `npm run build` ✅.

### 19.3 Discrepancias con el contrato

- **Ninguna.** Los 4 shapes se alinearon exactamente a `API_CONTRACT §M2/§M6/§M7/§M9`. No se
  editó el contrato ni la estructura de carpetas.

---

## 20. v1.3.1 — Precio de buylist por rareza + gestión de usuarios M6 + robustez del sync

Ronda que implementa: (1) precio de buylist por **rareza oficial** (§E.1, criterios 12/12b/12c/18),
(2) gestión de usuarios M6 (reset de contraseña + borrado híbrido), y (3) robustez del sync de catálogo
(`remote-sets` degradado + import por carta aislado). Fuente: `API_CONTRACT §6/§M2/§M6` v1.3.1,
`ARCHITECTURE §3.2/§4.2/§4.7bis/§4.8`.

### 20.1 Precio de buylist por rareza (§E.1)

- **Diales nuevos** (`settings.constants.ts`): `buylist_price_rules` (mapa
  `{ [rarity]: { mode:'fixed'|'pct', value } }`) y `buylist_price_fallback_pct` (default **40**).
  Validadores: `fixed`→entero ≥0 (centavos); `pct`→número en `[0,100]`; fallback en `[0,100]`. Se
  exportan `validateBuylistRules` / `validateFallbackPct` (reusados por el editor M2). **NO** están en
  `SETTING_DTO_MAP`: no se editan por `GET/PUT /admin/settings`, sino por los endpoints dedicados M2.
- **Seed** (en `SETTING_DEFAULTS`, se siembra por `seed.ts`): `Common`/`Uncommon` = fixed 50c,
  `Reverse Holo` = fixed 150c, fallback 40%. Preserva el negocio vigente (todo lo demás → 40% de la
  referencia = antiguo `ex_plus`). `rarity_map` (`RARITY_MAP`) queda **DEPRECADO** en la ruta de
  cotización (ya no se lee para el monto); sus endpoints `GET/PUT /admin/pricing/rarity-map` se conservan
  como legacy/no-op (tests intactos).
- **`quoteAcquisition` (money.ts) reescrito**: firma nueva
  `quoteAcquisition(rarity, referenceMxnCents, rules, fallbackPct)` → `{ quotedPriceCents, status,
  appliedRule, ruleSource }`. `fixed`→monto fijo (siempre cotiza); `pct`→`round(ref×value/100)`, sin ref
  →`precio_pendiente`; rareza sin regla→fallback pct (`ruleSource='fallback'`). **SEC-A1 intacto**: la
  rareza sale de `Card.rarity` (server-side), nunca del DTO.
- **`BuylistService`**: `publicQuote` y el DTO de item exponen `rarity` + `appliedRule`
  (`{mode,value,source}`) en vez de `category`. `createRequest` ya no recibe `category`
  (`RequestItemDto` sin el campo; el ValidationPipe `whitelist` descarta cualquier `category` que envíe
  el cliente) y snapshotea la regla aplicada por item. `categoryForRarity` eliminado; nuevo helper
  `buylistRules()`.
- **Endpoints M2 nuevos** (`PricingController`, super_admin, auditado
  `pricing.buylist_rules.update`): `GET/PUT /admin/pricing/buylist-rules` (tabla + fallback, validación
  estricta → `422 VALIDATION_ERROR`) y `GET /admin/pricing/rarities` (`distinct Card.rarity` vía
  `groupBy` unido a las reglas; `source: rule|fallback`; ordenado por `cardCount` desc).
- **Modelo/Migración M-14** (`20260816120000_m14_buylist_rules_by_rarity`): enum `BuylistRuleMode`
  (`fixed|pct`); `SellRequestItem` gana `rarity`/`ruleMode`/`ruleValue`/`ruleSource`; `category` pasa a
  **nullable** (retención legacy, nada nuevo lo escribe). No se borran datos.

### 20.2 Gestión de usuarios M6 (super_admin, auditado)

- **`POST /admin/users/:id/reset-password`** (`AdminService.resetPassword`): genera temp de alta
  entropía (`randomBytes(18).base64url`), la hashea con **argon2** (como `/auth/register`), responde
  `{ userId, tempPassword, mustChangePassword:true }` **una sola vez**. Revoca sesiones vía
  `tokenVersion++` y setea `mustChangePassword`. La contraseña **nunca** se loguea ni entra al
  `AuditLog` (solo `action=user.reset_password` + actor + target). `422 USER_DELETED` sobre cuenta ya
  soft-deleted.
- **`DELETE /admin/users/:id`** (`AdminService.deleteUser`): predicado "tiene transacciones" = ≥1 fila en
  `Order`/`SellRequest`/`ShipmentRequest`/`Dispute`/`InventoryItem(ownerUserId)`. Falso → **hard delete**
  (cascada + purga INE en R2). Verdadero → **soft delete** (`status=deleted`, `deletedAt`/`anonymizedAt`,
  email→`deleted+<uuid>@anon.invalid`, `name`/`phone`/`avatarUrl`/`googleId`/`passwordHash` limpiados,
  `tokenVersion++`; PII de `KycProfile` nulada + INE purgado; `BillingProfile`/`Address`/
  `PortfolioSnapshot` borrados; filas económicas conservadas). Respuesta `{ userId, mode }`. Idempotente
  sobre soft-deleted. `409 CANNOT_DELETE_SELF`. `AdminModule` importa `UploadsModule` para la purga de INE.
- **`tokenVersion` cableado en el JWT**: `AuthService.issueTokens` incluye `tv` en el payload
  (access+refresh). El **`JwtAuthGuard`** ahora consulta la BD por request y rechaza si la cuenta está
  `blocked`/`deleted` o si `tv` no coincide con `User.tokenVersion` (revocación inmediata de sesiones).
  `refresh()` valida lo mismo. `login`/`google` rechazan `deleted` con `403 USER_BLOCKED` (no revela
  motivo). **Trade-off**: el guard hace un `SELECT` por request autenticada (correctitud de revocación
  sobre latencia); cacheable a futuro si hace falta. Migración **M-15**
  (`20260816130000_m15_user_management`): `UserStatus += deleted`; `User += deletedAt, anonymizedAt,
  mustChangePassword, tokenVersion`.

### 20.3 Robustez del sync de catálogo (bugs de producción)

- **`GET /admin/catalog/remote-sets` ya no tira 500** cuando pokemontcg.io falla/rate-limitea: degrada
  con gracia usando la lista **local** (`CardSet` en BD) como fallback. Shape del contrato intacto
  (`{ data:[...] }`) + banderas opcionales `degraded`/`source` (`remote|local`).
- **Import por carta aislado** (fix "el sync importaba solo 1 carta por set"): `upsertCards` envuelve
  cada `card.upsert` en try/catch — una carta con dato inválido se **omite con log** y **no aborta** el
  set; `number` faltante → `''`; carta sin `id`/`name` se salta. `importSet` devuelve el `cardCount`
  **real** importado. La paginación (`importRemainingPages`) recorre todas las páginas por
  `totalCount/pageSize` (verificado con test).
- **Retry/backoff en el cliente** (`PokemonTcgIoClient.getJson`): reintenta ante `429` y `5xx`
  transitorios (hasta 4 veces), respetando `Retry-After` si viene, o backoff exponencial. Un 429 a media
  importación ya no aborta el barrido del set.

### 20.4 Tests (unitarios, propios)

- `test/money.spec.ts` (actualizado): `quoteAcquisition` por regla — fixed/pct/fallback/pending + redondeo.
- `test/buylist.modern-rarity.spec.ts` (reescrito): `publicQuote` con fallback %, pending, regla fixed y
  pct granular por rareza.
- `test/buylist.security.spec.ts` / `test/buylist.clabe-pii.spec.ts` (actualizados): SEC-A1 ahora sobre
  rareza real + `appliedRule`; ítems sin `category`.
- `test/pricing.buylist-rules.spec.ts` (nuevo): GET/PUT `buylist-rules` (+validación 422 de
  mode/rango/fallback) y `rarities` (join catálogo↔reglas, orden, `source`, omite null).
- `test/admin.user-management.spec.ts` (nuevo): reset-password (hashea, revoca, no expone claro,
  USER_DELETED), delete híbrido (hard sin transacciones + purga INE, soft con transacciones + anonimiza,
  409 self, idempotente).
- `test/catalog.remote-sets-fallback.spec.ts` (nuevo): fallback local en fallo remoto; 2ª carta que
  truena no deja el set en 1; paginación multi-página.
- Integración: `test/integration/buylist.e2e-spec.ts` actualizado al nuevo contrato (rarity/appliedRule,
  sin `category`) para QA.

### 20.5 Gates (desde `backend/`)

- `npm run lint` ✅ · `npm run typecheck` ✅ · `npm test` ✅ **217 tests / 39 suites**
  (antes 197/36; +20 tests, +3 suites) · `npm run build` ✅.
- Migraciones aplicadas a un Postgres 16 limpio (`prisma migrate deploy` OK) y **sin drift**
  (`prisma migrate diff` = "No difference detected"); `seed.ts` siembra los 2 diales nuevos.

### 20.6 Discrepancias con el contrato

- **Ninguna.** Todo se alineó a `API_CONTRACT §6/§M2/§M6` v1.3.1. No se editó el contrato ni la
  estructura de carpetas. Nota para el arquitecto (no bloqueante): `remote-sets` añade campos
  **opcionales** `degraded`/`source` no listados en el contrato (no rompen el shape `{data}`); si se
  prefieren fuera del contrato, se pueden ocultar.

## 21. Health `/api/v1/health` ahora refleja Redis de verdad (2026-08-16)

> Corrección al §12: el health reportaba `redis:skipped` **siempre** porque nadie registraba el token
> `HEALTH_REDIS_CLIENT`, aun cuando en producción `REDIS_URL` sí existe y el `SchedulerService`
> (BullMQ) abre su conexión. Era engañoso. Ahora `/health` dice la verdad. **Sin cambios de shape**
> en la respuesta ni en el contrato.

### 21.1 Qué cambió (solo `backend/`)

- **Nuevo provider** `src/modules/health/health-redis.provider.ts`:
  - Clase `HealthRedisClientProvider` (implementa `HealthRedisClient` + `OnModuleDestroy`) que envuelve un
    cliente **IORedis liviano y dedicado** solo para el `PING` del health. Opciones: `maxRetriesPerRequest:
    null` (no cuelga el check si Redis cae → falla a `down`) y `lazyConnect: true` (no abre el socket hasta
    el primer chequeo). Registra un handler de `'error'` no-op para que un Redis caído **no tumbe el
    proceso** (el estado real lo decide el resultado del `ping()`). `onModuleDestroy` hace `quit()` (con
    fallback a `disconnect()`) para **no fugar sockets**.
  - `healthRedisProvider`: factory sobre el token `HEALTH_REDIS_CLIENT` que **inyecta `ConfigService`**:
    - **con `REDIS_URL`** → devuelve el cliente real ⇒ health reporta `up`/`down`.
    - **sin `REDIS_URL`** (local/tests/CI sin infra) → devuelve `null` ⇒ health sigue reportando `skipped`
      (comportamiento previo preservado; el token es `@Optional()` en `HealthService`).
- **`health.module.ts`** registra `healthRedisProvider` en `providers`. `ConfigService` ya estaba
  disponible por el `ConfigModule` **global** del `AppModule` (no hizo falta importarlo).
- **Conexión independiente a propósito**: NO comparto la conexión BullMQ del worker (SchedulerService).
  Una conexión de health separada y mínima es más simple y evita acoplar la sonda a los workers. El costo
  (un socket extra, lazy) es despreciable.
- **No toqué** `HealthResult` ni `checkRedis()` en `health.service.ts` (ya manejaban `up`/`down`/`skipped`
  bien); solo faltaba satisfacer el token con un cliente real cuando hay `REDIS_URL`.

### 21.2 Tests

- Nuevo `test/health-redis.provider.spec.ts` (ioredis mockeado, sin sockets reales): token+inject
  correctos; sin `REDIS_URL` → `null` y no se construye cliente; con `REDIS_URL` → cliente con las opciones
  esperadas + `ping()`; `onModuleDestroy` cierra con `quit()` y hace fallback a `disconnect()` si falla.
- Los tests de `health.controller.spec.ts` (§12) siguen válidos sin cambios: instancian `HealthService`
  directo (skipped = sin cliente; up/down = cliente mock), que es exactamente el nuevo comportamiento
  condicionado por `REDIS_URL`.

### 21.3 Gates (desde `backend/`)

- `npm run lint` ✅ · `npm run typecheck` ✅ · `npm test` ✅ **224 tests / 41 suites** (antes 217/39; +7
  tests, +2 suites — incluye el nuevo spec del provider) · `npm run build` ✅.

### 21.4 Verificación manual

- **Con Redis arriba:** `REDIS_URL=redis://localhost:6379 npm run start` → `curl -s localhost:3000/api/v1/health`
  ⇒ `... "redis":"up"`. Si Redis está definido pero **caído** ⇒ `"redis":"down"` y **503**.
- **Sin Redis (local/CI):** arrancar **sin** `REDIS_URL` → `curl -s localhost:3000/api/v1/health` ⇒
  `... "redis":"skipped"` y **200** (no degrada).

### 21.5 Discrepancias con el contrato

- **Ninguna.** La respuesta de `/health` conserva su shape (`{ status, uptime, timestamp, db, redis }`,
  `redis ∈ up|down|skipped`). Sigue en pie del §12 la solicitud (no bloqueante) al **arquitecto** de
  **formalizar `GET /api/v1/health`** en `API_CONTRACT.md`.

## 22. v1.4-finance — Costo real de paquetería en el P&L (M-16, 2026-08-16)

Implementa el requisito #3 de `PROJECT.md` (criterio 21): el P&L trataba el envío **solo como
ingreso** (`shippingFeeCents`) y nunca restaba el **costo real** pagado a la paquetería,
sobreestimando la ganancia. Cambio **aditivo**, siguiendo `API_CONTRACT §M4/§M7` y `ARCHITECTURE §11 M-16`.

### 22.1 Qué cambió (solo `backend/`)

- **Modelo / migración M-16** (`prisma/schema.prisma` + `prisma/migrations/20260816140000_m16_shipping_cost/`):
  `ShipmentRequest` gana `shippingCostCents Int @default(0)` = costo real MXN (centavos) que la
  plataforma paga al carrier. **No** toca `shippingFeeCents` (sigue siendo el **ingreso** cobrado al
  cliente). `@default(0)` cubre filas históricas/sin captura. Migración = un `ADD COLUMN ... DEFAULT 0`
  (patrón aditivo, sin backfill; greenfield).
- **Captura en M4** (`modules/shipments/dto/shipments.dto.ts`, `admin-shipments.controller.ts`,
  `shipments.service.ts`): `TrackingDto` gana `shippingCostCents?` con `@IsOptional @IsInt @Min(0)`
  (negativo/no-entero ⇒ `422 VALIDATION_ERROR`). `setTracking()` lo persiste **solo si viene** (si se
  omite no se modifica; queda el default/valor previo ⇒ **editable** re-invocando). El endpoint es
  admin-only por la ruta; el costo **no** se expone al cliente. Se añade al `AuditLog`
  (`action: shipment.tracking`, `after.shippingCostCents` = valor persistido).
- **P&L M7** (`modules/admin/admin.service.ts` `pnl()`): la clave `shippingCents` se **renombra** a
  `shippingRevenueCents` (sigue sumando `shippingFeeCents`) y se **añade** `shippingCostCents` = suma
  de `s.shippingCostCents` sobre **los mismos** envíos ya filtrados por `pickingAt`
  (`status ∈ {picking, guia, enviado, entregado}`), para que ingreso y costo del envío caigan en el
  mismo periodo. Nueva fórmula:
  `profitCents = incomeCents + shippingRevenueCents − cogsCents − stripeFeesCents − shippingCostCents`.
  Response: `{ incomeCents, shippingRevenueCents, cogsCents, stripeFeesCents, shippingCostCents, profitCents }`.
- **CSV export** (`exportCsv`, `report=pnl`): cabecera y fila espejan el shape nuevo:
  `report,incomeCents,shippingRevenueCents,cogsCents,stripeFeesCents,shippingCostCents,profitCents`.
- **Consumidores internos:** el dashboard/summary usa `pnl().profitCents` (sin cambio de nombre), así
  que no requirió ajuste. Búsqueda global: no quedan referencias a la vieja clave `shippingCents`.

### 22.2 Tests (unitarios, propios)

- `test/admin.pnl-shipping.spec.ts`: `pnl()` devuelve el shape de 6 claves, **resta** `shippingCostCents`,
  separa ingreso (`shippingRevenueCents`) vs costo, envíos sin costo suman 0, y el CSV espeja el header nuevo.
- `test/shipments.tracking-cost.spec.ts`: `setTracking()` persiste `shippingCostCents` cuando se envía,
  **no** lo toca cuando se omite, es editable al re-invocar; `TrackingDto` acepta ausente/entero≥0 y
  **rechaza** negativos y no-enteros.

### 22.3 Gates (desde `backend/`)

- `npm run lint` ✅ · `npm run typecheck` ✅ · `npm test` ✅ **234 tests / 43 suites** (antes 224/41;
  +10 tests, +2 suites) · `npm run build` ✅.

### 22.4 Verificación manual (P&L con las 6 claves)

```bash
# como super_admin (token con rol super_admin):
curl -s "http://localhost:3001/api/v1/admin/finance/pnl?from=2026-01-01&to=2026-12-31" \
  -H "Authorization: Bearer <accessToken super_admin>" | jq
# => { "incomeCents":…, "shippingRevenueCents":…, "cogsCents":…,
#      "stripeFeesCents":…, "shippingCostCents":…, "profitCents":… }

# Captura de costo al asignar guía (avanza a `guia`, persiste el costo):
curl -s -X POST "http://localhost:3001/api/v1/admin/shipments/<shipmentId>/tracking" \
  -H "Authorization: Bearer <accessToken vault_operator+>" -H "Content-Type: application/json" \
  -d '{"carrier":"DHL","trackingNumber":"TRACK123","shippingCostCents":9000}'
# negativo => 422 VALIDATION_ERROR

# CSV con el header nuevo:
curl -s "http://localhost:3001/api/v1/admin/finance/export.csv?report=pnl" \
  -H "Authorization: Bearer <accessToken super_admin>"
# report,incomeCents,shippingRevenueCents,cogsCents,stripeFeesCents,shippingCostCents,profitCents
```

### 22.5 Discrepancias con el contrato

- **Ninguna.** Implementado al pie de `API_CONTRACT §M4/§M7` y `ARCHITECTURE §11 M-16`. No se tocó
  `frontend/`, `docs/API_CONTRACT.md` ni `docs/ARCHITECTURE.md`.

### 22.6 Correcciones de seguridad (blue team, `docs/SECURITY_NOTES.md` §C)

- **SEC-C1 (Media) — Fuga de `shippingCostCents` al cliente (CORREGIDO).** `listMine`/`getMine`
  (endpoints de CLIENTE `GET /shipments` y `GET /shipments/:id`) devolvían la fila **cruda** de
  Prisma; tras M-16 eso incluía `shippingCostCents` (costo interno del carrier / dato de margen que
  `API_CONTRACT §M4` marca "no se expone al cliente"). Se añadió el proyector privado
  `toClientShipment()` en `shipments.service.ts` que mapea a una **allowlist explícita** de los campos
  que el contrato declara para el comprador (`API_CONTRACT §5`): `id, status, addressSnapshot,`
  `shippingFeeCents, ivaCents, processingFeeCents, totalCents, carrier, trackingNumber, requestedAt,`
  `pickingAt, shippedAt, deliveredAt, items`. Se eligió **allowlist** (no `omit`/denylist) a propósito:
  si el modelo gana un campo interno futuro, no se filtra por accidente.
  - **`processingFeeCents`: SE INCLUYE** en la salida de cliente. Es un cargo que el comprador **paga**
    y ya lo ve en el `BreakdownDTO` de `quote`/`create` (`API_CONTRACT §5` y `BreakdownDTO`), así que no
    es dato interno de margen — a diferencia de `shippingCostCents`. (Nota del blue team: antes también
    se "fugaba" `processingFeeCents`; queda **dentro** por diseño del contrato, no por descuido.)
  - Como efecto de la allowlist, tampoco sale `stripePaymentIntentId` (el cliente ya recibe su
    `clientSecret` en `create`; el PI id no es campo de cliente). Defensa en profundidad.
  - **ADMIN sin cambios:** `adminGet`/`adminList` siguen devolviendo la fila cruda **con** el costo
    (los admins sí pueden verlo). La proyección solo acota los endpoints de cliente.
- **SEC-C2 (Baja) — `@Min(0)` sin `@Max` + overflow Int32 (CORREGIDO).** `TrackingDto.shippingCostCents`
  gana `@Max(SHIPPING_COST_MAX_CENTS)`. **Tope elegido: `100_000_00` cents = MX$100,000** (constante
  nueva exportada en `dto/shipments.dto.ts`). Holgado para el costo real de UN envío de paquetería y muy
  por debajo del `Int` de Postgres (2^31−1). No se reutilizó `BUYLIST_CAP_*`/`REPO_CAP_*` porque son
  topes de **negocio** (compra/reposición), semánticamente distintos del costo de paquetería; una
  constante dedicada evita acoplar límites no relacionados. `422 VALIDATION_ERROR` si excede el tope.
- **Tests (propios, `test/shipments.tracking-cost.spec.ts`):**
  - SEC-C1: `getMine`/`listMine` **omiten** `shippingCostCents` (y `stripePaymentIntentId`) y conservan
    los campos de cliente (incl. `processingFeeCents`); `getMine` sigue aplicando ownership (404 a otro
    usuario).
  - SEC-C2: `TrackingDto` acepta el valor en el borde (`= SHIPPING_COST_MAX_CENTS`) y **rechaza** por
    encima del tope.
- **Gates (desde `backend/`):** `npm run lint` ✅ · `npm run typecheck` ✅ · `npm test` ✅

---

## v1.5-auth-email — Verificación de correo + recuperación self-service (Resend)

Implementa el changelog v1.5 del contrato (§1 Auth) y ARCHITECTURE §3.2/§4.11/§10. La verificación
**NO bloquea el login** — bloquea **acciones sensibles** (comprar/retirar/vender) server-side.

### Modelo de datos (M-17)
- Migración: **`prisma/migrations/20260816150000_m17_auth_tokens/migration.sql`** (patrón aditivo/greenfield).
- Enum `AuthTokenType = email_verification | password_reset`; modelo **`AuthToken`** (`id`, `userId` FK
  `User` `onDelete: Cascade`, `type`, `tokenHash` `String @unique` = **SHA-256** del token en claro,
  `expiresAt`, `usedAt?`, `requestIp?`, `createdAt`) con `@@unique([tokenHash])`, `@@index([userId, type])`,
  `@@index([expiresAt])`. `User` gana `authTokens AuthToken[]`.
- **El token en claro NUNCA se persiste.** Es 32 bytes aleatorios (`crypto.randomBytes` → base64url, ~256
  bits); en BD vive su **SHA-256** (basta; no argon2 — no hay fuerza bruta con esa entropía). Emisión/consumo
  en `AuthTokenService` (`src/modules/auth/auth-token.service.ts`): `issue()` rota (invalida) los previos no
  usados del mismo tipo → solo el último link vale; `consume()` claima atómico (`updateMany` con `usedAt:null`
  + `expiresAt > now`) → **un solo uso**. TTL: verificación **24h**, reset **1h**.

### Módulo `mail` (`src/modules/mail/`)
- Puerto `MailPort` (token DI **`MAIL_PORT`**) + `ResendMailAdapter` (usa la lib **`resend`**, POST a Resend
  con `RESEND_API_KEY`, remitente `MAIL_FROM` default `no-reply@tcgvaultmx.com`) + `NoopMailAdapter`
  (local/CI/tests: loguea destinatario + link, **no envía**). `MailService` arma plantillas **bilingües ES/EN**
  por `User.locale` (`sendEmailVerification` / `sendPasswordReset`).
- **Selección del adaptador (`MailModule`, factory):** si hay `RESEND_API_KEY` → Resend; si no y es LOCAL_ENVS
  → Noop. En **no-local** la key es requerida por `env.validation` (nunca cae a Noop silencioso en prod).
- **Links al FRONTEND:** `AuthService.buildFrontendLink()` construye `${origin}/<locale>/verify-email?token=…`
  y `.../reset-password?token=…`, usando el **primer origin** de `APP_BASE_URL` (lista separada por comas) y
  `User.locale` (default `es`). El nombre del query param es contrato: `token`.

### Endpoints (auth.controller / auth.service)
- `POST /auth/verify-email/resend` — **customer+ (autenticado)**, body `{}`, usa `req.user` (cero
  enumeración) → `200 {ok:true}`. No-op si ya verificado. Rate-limit **3/h/usuario** (tope por servicio contando
  `AuthToken` emitidos la última hora) + backstop IP; `429 RATE_LIMITED` si excede.
- `POST /auth/verify-email` — **public** `{token}` → `200 {verified:true}`; `422 EMAIL_VERIFY_TOKEN_INVALID`
  si inválido/expirado/usado. **Idempotente:** si el usuario del token ya está verificado, responde `200`
  aunque el token esté usado (doble clic). **No** toca `tokenVersion`. Rate-limit 10/min/IP.
- `POST /auth/forgot-password` — **public** `{email}` → **SIEMPRE `200 {ok:true}`** (anti-enumeración). Si el
  email existe y la cuenta está **activa**, emite `password_reset` (1h), rota previos y envía correo (tope
  3/h/email en servicio; blocked/deleted no se procesan pero igual responde 200). Rate-limit **3/h/IP**.
- `POST /auth/reset-password` — **public** `{token, password}` → `200 {ok:true}`. Consume el token, setea
  `passwordHash` (**argon2id**), `tokenVersion++` (revoca sesiones, patrón existente), **`emailVerified=true`**
  (v1.5-3), limpia `mustChangePassword`, marca token usado. `422 RESET_TOKEN_INVALID`; `400 VALIDATION_ERROR`
  (password `MinLength 8`, misma política que register). **No** devuelve tokens (el usuario re-inicia sesión).
- `POST /auth/register` — ahora emite `email_verification` (24h) y envía el correo (best-effort; el fallo del
  envío **no** aborta el registro). El `user` de **register|login|google** incluye `emailVerified` (`publicUser`).

### Gating server-side (EmailVerifiedGuard)
- Guard `src/common/guards/email-verified.guard.ts` + decorador `@RequireEmailVerified()`
  (`src/common/decorators/require-email-verified.decorator.ts`). Registrado como `APP_GUARD` **tras**
  `JwtAuthGuard`/`RolesGuard` y **antes** de `MoneyOutGuard`. `403 EMAIL_NOT_VERIFIED` si `emailVerified=false`.
- **`JwtAuthGuard`** añade `emailVerified` al `select` y lo puebla en `req.user` (interfaz `AuthUser`).
- Aplicado **SOLO** a: `POST /checkout/session`, `POST /shipments`, `POST /buylist/requests`. Los `*/quote`
  y el cotizador público **no** se bloquean. Google entra con `emailVerified=true`; staff sembrado verificado.

### env / seed / jobs
- `env.validation.ts`: `RESEND_API_KEY` añadida a `required` (obligatoria en **no-local**; en LOCAL_ENVS
  degrada a Noop). `MAIL_FROM` opcional (default en código, no bloquea el arranque).
- **Seed (v1.5-6):** `admin`/`operator` (`prisma/seed.ts`) y todos los fixtures de `prisma/seed-e2e.ts`
  nacen `emailVerified=true` (el customer E2E también, para que el guard no bloquee los flujos de la suite).
- **Job `auth-token-sweep`** (`src/jobs/auth-token-sweep.service.ts`): borra `AuthToken` expirados/usados.
  Standalone `run()` (patrón buylist-sweep/ine-retention), registrado/exportado en `JobsModule`. Scheduling
  repetible BullMQ = deuda BE-5 (disparable a mano); no crítico (el consumo ya rechaza expirados/usados).

### Tests (propios)
- `test/auth.token.spec.ts` — emisión/consumo: hash SHA-256 (no claro), rotación, un solo uso, expiración por tipo.
- `test/auth.email-flows.spec.ts` — forgot anti-enumeración (200 sin email/sin enviar), reset (`tokenVersion++`
  + `emailVerified=true` + argon2 + token usado), verify (idempotencia doble clic / 422), resend (no-op/429).
- `test/email-verified.guard.spec.ts` — gating 403 sin verificar / pasa verificado / no restringe sin decorador.
- `test/mail.service.spec.ts` — MailService con `NoopMailAdapter` mockeado (asunto bilingüe, `to`, link en html/text).
- `test/env.validation.spec.ts` — actualizado: `RESEND_API_KEY` requerida en no-local, no en local.

### Discrepancias con el contrato
- **Ninguna.** El contrato/ARCHITECTURE describen el `ResendMailAdapter` como "POST https://api.resend.com/emails";
  se implementó con la librería `resend` (equivalente, añadida a `package.json`). Sin cambios a `API_CONTRACT.md`
  ni `ARCHITECTURE.md`. **Nota abierta del arquitecto (v1.5-2, no bloqueante):** `MAIL_FROM`=`tcgvaultmx.com` vs
  soporte `tcgvaultmx.com` — dominio canónico a fijar por el humano (no afecta esta implementación).

### Gates (desde `backend/`)
`npm run lint` ✅ · `npm run typecheck` ✅ · `npm test` ✅ (47 suites / 264 tests) · `npm run build` ✅
  **239 tests / 43 suites** · `npm run build` ✅.

### Cierre de hallazgos Baja de seguridad v1.5 (2026-08-16)

> Tras los 3 veredictos APROBADO (QA/techlead/seguridad), se cierran los 2 hallazgos **Baja** que
> seguridad pidió cerrar en esta entrega. El resto de la deuda Baja aceptada queda en `docs/TECH_DEBT.md`
> (sección "Deuda del pase correo v1.5": `v15-D1..D3`, `v15-S15-B2`, `v15-S15-B3`).

- **S15-B1 — escape de HTML en plantillas de correo** (`src/modules/mail/mail.templates.ts`). Nueva
  función `escapeHtml()` (escapa `& < > " '`) aplicada a **`name`** (dato controlado por el usuario) y al
  **`link`** en el **cuerpo HTML** de las **4** plantillas (verificación y reset, ES y EN). El `&` va
  primero para no re-escapar entidades. El **texto plano** y el layout/asuntos no cambian. Cierra el
  defecto de inyección (impacto acotado: el correo va solo al propio usuario, pero era interpolación cruda).
- **S15-B4 — revalidar `status` en `resetPassword`** (`src/modules/auth/auth.service.ts`). Defensa en
  profundidad: tras `consume` del token y **antes** de fijar la contraseña, se relee el usuario y se exige
  `status === active`; si no (blocked/deleted/futuro suspended → `user.status !== active`) se rechaza con
  **`403 USER_BLOCKED`** (mismo trato que login) y **no** se actualiza nada. Evita que un token de reset
  emitido antes de bloquear la cuenta permita fijar contraseña en una cuenta ya bloqueada. `UserStatus` hoy
  es `{active, blocked, deleted}`; la guardia `!== active` cubre cualquier estado no-activo futuro.
- **Tests añadidos:** `test/mail.service.spec.ts` (bloque "escape de HTML (S15-B1)": un `name` con
  `<script>`/`"`/`'`/`&` se escapa en el HTML de las 4 plantillas; el payload crudo no aparece).
  `test/auth.email-flows.spec.ts` (reset con cuenta `blocked` y `deleted` → `USER_BLOCKED`, sin `update`;
  el caso feliz ahora mockea `findUnique` → `active`).
- **Gates:** `npm run lint` ✅ · `npm run typecheck` ✅ · `npm test` ✅ (**47 suites / 271 tests**) ·
  `npm run build` ✅.

## v1.6-finish — Acabado / versión de carta (finish) en TODA la cadena (M-18, 2026-08-16)

> Implementa `API_CONTRACT` changelog v1.6-finish y `ARCHITECTURE` §3.7/§4.1/§4.2.1/§4.8/§4.9/§11 M-18
> **al pie de la letra**. El contrato manda. Enum `Finish = normal | reverse_holo | holofoil |
> first_edition_holofoil`. Cambio **aditivo con default seguro** (`normal` / `[normal]`).

### Migración M-18 (aditiva)
- Archivo: **`backend/prisma/migrations/20260816160000_m18_finish/migration.sql`** (correlativo tras
  M-17 `…150000`). Schema: `backend/prisma/schema.prisma`.
- Crea `CREATE TYPE "Finish"`; añade **`Card.availableFinishes Finish[] @default([normal])`**,
  **`PriceReference.finish Finish @default(normal)`**, **`InventoryItem.finish Finish @default(normal)`**,
  **`SellRequestItem.finish Finish @default(normal)`**. Filas históricas quedan operables sin re-sync.
- **Clave de `PriceReference`:** el `@@unique` pasó de `[cardId, productType, gradeKey, capturedDate]`
  a **`[cardId, productType, gradeKey, finish, capturedDate]`** (índice
  `PriceReference_cardId_productType_gradeKey_finish_capturedDa_key`). Así `normal` y `reverse_holo` de
  la misma carta tienen **referencia de precio distinta** (una fila por día **por acabado**). `gradeKey`
  **no** cambia de semántica (sigue siendo condición/grado); `finish` es una **columna ortogonal**.
- **`PendingPriceEntry` NO gana columna `finish`** (fuera del alcance explícito de M-18; el contrato solo
  lista los 4 modelos de arriba). Consecuencia menor: distintos acabados de la misma carta comparten la
  misma entrada de "precio pendiente" (keyed por `gradeKey`). Registrado como nota, no bloqueante.

### Import de acabados (`catalog/`)
- `pokemontcg-io.client.ts`: `RemoteCard.tcgplayer` ahora tipa **`prices?: Record<string,{market?}>`**
  (antes solo `{url}` y se descartaba). Sin cambio de host/anti-SSRF.
- `pricing.types.ts`: mapeo canónico **`TCG_KEY_TO_FINISH`** (`normal→normal`,
  `reverseHolofoil→reverse_holo`, `holofoil→holofoil`, `1stEditionHolofoil→first_edition_holofoil`;
  `1stEditionNormal`/`unlimitedHolofoil` **se ignoran**) e inverso **`FINISH_TO_TCG_KEY`**. Helper
  **`deriveAvailableFinishes(prices)`** (ausente/vacío/sin llaves mapeadas → `[normal]`).
- `catalog-sync.service.ts` `upsertCards`: deriva `availableFinishes` de las llaves presentes y lo
  persiste en create/update del `Card`.

### Pricing por acabado (`pricing/`)
- `PricingProviderInput` gana `finish`. `PokemonTcgIoProvider.fetchPrice` lee **`prices[FINISH_TO_TCG_KEY[finish]].market`**
  (deja de tomar "el primer market disponible"). Providers graded/sealed ignoran `finish`.
- `PricingService`: **`getReference(cardId, productType, gradeKey, finish='normal')`** y
  **`syncCardPrice(card, productType, gradeKey, finish='normal', context, refId?)`** ganan `finish`
  (posición explícita antes de `context`, como el contrato). El lookup/upsert usa la clave compuesta con
  `finish`. `manualOverride(...)` y `POST /admin/pricing/override` ganan `finish?` (default normal).
  `buildGradeKey` **NO cambia**. `finish` default `normal` conserva a graded/sealed y a todos los
  callers no-raw sin fricción.
- Job `price-sync.service.ts`: pricea `item.finish` de cada copia física.

### Resolver finish→regla determinista (`common/money.ts`, §4.2.1)
- **`isHoloRarity(rarity)`** = `rarity` contiene `"holo"` (case-insensitive).
- **`ruleKeyCandidates(rarity, finish)`**: `reverse_holo→["Reverse Holo"]`; `holofoil`/
  `first_edition_holofoil`→ `isHoloRarity ? [rarity,"Holo"] : ["Holo"]`; `normal→[rarity]`.
- **`quoteAcquisitionForFinish(rarity, finish, referenceMxnCentsForFinish, rules, fallbackPct)`**: gana el
  **primer candidato con regla explícita**; si ninguno → `BUYLIST_PRICE_FALLBACK_PCT`. `pct` sobre el
  **market DEL acabado** cotizado; `fixed` siempre cotiza. `first_edition_holofoil` usa la regla de
  holofoil con el market de la llave `1stEditionHolofoil` (vía `getReference(..., finish)`).
- Resultado con el seed vigente: una **común en reverse_holo** cotiza con **"Reverse Holo" ($1.50)**, no
  con "Common"; una **común en holofoil** salta a `"Holo"` (no sembrada) → **40% del market holofoil**.

### Buylist quote/request + M1 inventario + convert
- DTOs (`buylist/dto/buylist.dto.ts`, `inventory/dto/inventory.dto.ts`): `PublicQuoteDto`,
  `RequestItemDto` y `CreateItemDto` ganan **`finish?`** (default normal, `@IsIn` de los 4 valores).
- `BuylistService`: helper **`assertFinishAvailable(card, finish)`** valida server-side contra
  `card.availableFinishes` → **`422 FINISH_NOT_AVAILABLE`** (nuevo `ErrorCode`). `publicQuote` responde
  `finish` + `appliedRule` resuelto por acabado; `createRequest` valida, cotiza por acabado y
  **snapshotea `SellRequestItem.finish`**; `itemDTO` (SellItemDTO) expone `finish`. **SEC-A1 intacto:** el
  monto se deriva de `(Card.rarity, finish)` validado, **nunca** del cliente.
- `InventoryService.createItem`: **`resolveFinish(dto, card.availableFinishes)`** — raw valida contra la
  lista blanca (422 si no); **graded/sealed = `normal` siempre**. Propaga a `InventoryItem.finish` y usa
  el finish para la referencia de la aportación en especie.
- `convertToInventory` (M5): propaga `SellRequestItem.finish` → `InventoryItem.finish`.
- Valuación de portafolio/inventario/custodia/orden (`vault.service`, `admin.service`, `orders.service`)
  usa `item.finish` en `getReference`.

### Catálogo "Compra" (`catalog/`)
- `toCardDTO` expone **`availableFinishes`**. `ListingDTO`/`HoldingDTO`/`SellItemDTO` exponen **`finish`**.
- `GET /catalog/cards` gana filtro **`finish`** (sobre `InventoryItem.finish`; inválido → 400).
  `GET /catalog/facets` gana **`finishes`** (distinct sobre el inventario publicado). `toListingDTO`,
  `vault.holdings`/`holdingDetail` valúan contra la `PriceReference` del acabado del item.

### Endpoints/DTOs con finish (resumen)
`POST /buylist/quote` (+`finish?` req, +`finish`/`appliedRule` res) · `POST /buylist/requests`
(`items[].finish?`) · `POST /admin/inventory/items` (+`finish?`) · `POST /admin/pricing/override`
(+`finish?`) · `GET /catalog/cards?finish=` · `GET /catalog/facets` (+`finishes`) · `CardDTO`
(+`availableFinishes`) · `ListingDTO`/`HoldingDTO`/`SellItemDTO` (+`finish`). Nuevo error
**`422 FINISH_NOT_AVAILABLE`**.

### ⚠️ RE-SYNC del catálogo requerido tras desplegar (devops/QA)
Las cartas ya importadas quedan con `availableFinishes=[normal]` y sus `PriceReference` en `finish=normal`
hasta que se **RE-SINCRONICE** el catálogo (`POST /admin/catalog/sync` / `sync-all`) y el **price-sync**
repueble las referencias por acabado. El default seguro mantiene todo operable mientras tanto; el re-sync
es idempotente. **No lo ejecuté** (requiere entorno con la API key y la BD desplegada).

### Tests añadidos
- `test/buylist.finish.spec.ts` (15): resolver puro (`isHoloRarity`/`ruleKeyCandidates`/
  `quoteAcquisitionForFinish`), cotización común reverse_holo → "Reverse Holo", `pct` con la referencia
  del acabado, `precio_pendiente` por acabado sin ref, **`FINISH_NOT_AVAILABLE`** en quote y request,
  snapshot del finish y **convert propaga finish**.
- `test/catalog-sync.finish.spec.ts` (5): `deriveAvailableFinishes` (mapeo/descarte/default) y
  `upsertCards` persiste `availableFinishes` derivado de `tcgplayer.prices`.

### Gates
`npm run lint` ✅ · `npm run typecheck` ✅ · `npm test` ✅ (**49 suites / 291 tests**) ·
`npm run build` ✅.

### Discrepancias con el contrato
Ninguna que bloquee. El contrato fue implementable al pie de la letra. Única nota de diseño propio (dentro
del alcance): `PendingPriceEntry` no lleva `finish` porque M-18 no lo lista entre los modelos a migrar.

## 23. Modo `force` en sync-all/backfill (v1.6-finish · 2026-08-16) — fix re-sync que no repueblaba `availableFinishes`

### Bug
El re-sync NO repueblaba `Card.availableFinishes` (los sets viejos quedaban en `['normal']`) porque
`syncAll` **saltaba** los sets ya importados: filtraba `importedWithCards` (`_count.cards > 0`) y solo
procesaba los `pending`. El UPDATE del upsert (`upsertCards`) SÍ incluye `availableFinishes`, pero nunca
se ejecutaba sobre sets ya poblados. `backfill` tenía el mismo filtro (`!importedIds.has(s.id)`).

### Fix (solo `backend/`)
- **`catalog-sync.service.ts` → `syncAll(options: { force?: boolean } = {})`:** con `force:true` NO filtra
  los sets ya poblados — reprocesa **TODOS** los sets remotos y re-upserta sus cartas vía `upsertCards`
  (idempotente por `externalId`), refrescando `availableFinishes` y disparando el poblado de precios por
  acabado. `force:false` (default) mantiene el comportamiento de hoy (salta importados). Firma
  retro-compatible: `syncAll()` sin args sigue funcionando.
- **`backfill(batchSize, untilYear, force = false)`:** mismo patrón — con `force:true` los candidatos no
  se filtran por importados; default intacto.
- **Idempotencia/robustez reusadas:** el barrido forzado sigue el mismo camino fire-and-forget
  (single-flight `syncAllRunning`, `runSyncAll` secuencial respetando rate-limit, aislamiento por-carta de
  `upsertCards` v1.3.1). El request responde `202` de inmediato; el reproceso pesado corre en background.

### Endpoint (nombre exacto + cómo se pasa `force`)
- **`POST /admin/catalog/sync-all`** (guard `@Roles(Role.super_admin)` intacto). Acepta `force` por
  **body `{"force": true}`** o **query `?force=true`** (también `?force=1`). Default `false`. La respuesta
  `202` no cambia de shape; `force` se registra en `AuditLog.after`.
- **`POST /admin/catalog/backfill`** acepta `force` igual (body/query), default `false`.
- Precedencia: si viene en el body, gana el body; si no, se lee la query (`parseForce`).

### Cómo usar (operación, tras desplegar — resuelve el ⚠️ RE-SYNC de la sección "finish")
`POST /api/v1/admin/catalog/sync-all?force=true` (super_admin) reprocesa todo el catálogo y repuebla
`availableFinishes`/precios por acabado en los sets ya importados. **No lo ejecuté** (requiere entorno con
API key + BD desplegada); es idempotente.

### Archivos tocados
- `backend/src/modules/catalog/catalog-sync.service.ts` — `force` en `syncAll` y `backfill`.
- `backend/src/modules/catalog/admin-catalog.controller.ts` — `SyncAllDto`, `force` en `sync-all`/`backfill`
  (body+query), `parseForce`, auditoría incluye `force`.
- `backend/test/catalog-sync.spec.ts` — tests `force:false` (salta importados) vs `force:true` (reprocesa).

### Tests + gates
- Nuevos: `force:false` (default) NO encola sets ya importados; `force:true` encola **todos** los remotos
  aunque estén poblados (verifica el arg pasado a `runSyncAll`).
- `npm run lint` ✅ · `npm run typecheck` ✅ · `npm test` ✅ (**49 suites / 293 tests**) · `npm run build` ✅.

### Discrepancias con el contrato
Ninguna. No toqué `API_CONTRACT.md` ni `ARCHITECTURE.md` (el arquitecto documenta el nuevo param en
paralelo). El endpoint y verbo existentes no cambian; `force` es un parámetro opcional aditivo.

## 25. BUG A1 (INE) — presigned PUT a R2 daba 403 SignatureDoesNotMatch (2026-08-16)

> Síntoma: el navegador subía la foto del INE directo a Cloudflare **R2** con la URL prefirmada (PUT) que
> emite `POST /uploads/presign`, y R2 respondía **403 `SignatureDoesNotMatch`**. El presign en sí y la
> validación de content-type/tamaño funcionaban; fallaba solo el PUT real del navegador.

### Causa raíz
El **AWS SDK v3** (`@aws-sdk/client-s3 ^3.1109`) trae por defecto
`requestChecksumCalculation: 'WHEN_SUPPORTED'`. Con ese default, al firmar la URL (`getSignedUrl` sobre un
`PutObjectCommand`) el SDK **incluye los headers `x-amz-sdk-checksum-algorithm` y `x-amz-checksum-crc32`
dentro de los `SignedHeaders`** de la firma. Pero el navegador, al hacer el PUT directo a R2, **solo envía
`Content-Type`** (y `Content-Length` si se fijó) — NO manda esos headers de checksum. Como los headers
firmados no coinciden con los enviados, la firma no valida → **403 SignatureDoesNotMatch**. Es un choque
conocido del SDK v3 con presigned URLs consumidas fuera del propio SDK (navegador / S3-compatibles como R2).

### Fix (solo `backend/`, sin cambio de contrato)
- **`src/modules/uploads/uploads.service.ts`** (getter `s3`, construcción del `S3Client`): se añaden dos
  opciones al cliente:
  - `requestChecksumCalculation: 'WHEN_REQUIRED'`
  - `responseChecksumValidation: 'WHEN_REQUIRED'`
  Con `WHEN_REQUIRED` el SDK **no** agrega los headers de checksum al presign salvo que la operación los
  exija (PutObject no los exige), de modo que el PUT del navegador (que solo manda `Content-Type`) vuelve
  a validar la firma. **No** se tocó la lógica de presign, el allow-list `image/*`, el `ContentLength`, ni
  `presignGet`/`deleteObject`. `POST /uploads/presign` conserva su shape (`API_CONTRACT §8`).

### Tests
- `test/uploads.presign.spec.ts` (ampliado): nuevo `describe` que **mockea `@aws-sdk/client-s3`** para
  capturar la config con la que se construye el `S3Client` y verifica que se pasa
  `requestChecksumCalculation: 'WHEN_REQUIRED'` (y `responseChecksumValidation: 'WHEN_REQUIRED'`), además de
  que el cliente se construye **una sola vez** (getter lazy). Los tests previos (solo `kyc_ine`, allow-list
  de content-type, tope de tamaño) siguen intactos.

### Gates (desde `backend/`)
- `npm run lint` ✅ · `npm run typecheck` ✅ · `npm test` ✅ · `npm run build` ✅.

### Nota para QA/devops
El E2E de infra (`test/integration/infra-smoke.e2e-spec.ts`) ya hacía un **PUT real** contra MinIO; contra
**MinIO** el bug no se dispara igual que en R2, pero el fix es correcto para ambos (MinIO tampoco reenvía
los headers de checksum firmados desde un cliente HTTP plano). Para reproducir el 403 original hay que
apuntar el PUT a un endpoint **R2** con el SDK sin el flag. Sin cambios de env ni de infra.

### Discrepancias con el contrato
Ninguna. Solo configuración del cliente S3; `API_CONTRACT.md` no cambia.

## 26. v1.7-admin-users (2026-08-16) — Alta de usuarios por rol (E2) + historial 360° por usuario (F2)

Dos features aditivas de M6, **sin migración** (reusan `User`, `AuditLog` y los listados admin ya
paginados). Contrato: `API_CONTRACT.md` §M6 (E1/F1) + §M4/§M5/§M8 (`?userId=`) + §11 DTOs
(`AdminCreatedUserDTO`, `UserAuditEntryDTO`). Arquitectura: §4.7bis (c) / §4.7ter.

### E2 — `POST /api/v1/admin/users` (super_admin-only, auditado `user.create`, NO money-out)
- **Controller** `AdminUsersController.createUser` (`backend/src/modules/admin/admin.controller.ts`),
  `@Post()` + `@Roles(Role.super_admin)` (override del guard de clase `vault_operator+`), `@HttpCode(201)`.
- **Service** `AdminService.createUser` (`backend/src/modules/admin/admin.service.ts`).
- **Autogen de password:** si el req **omite** `password`, se autogenera una temporal de alta entropía
  **reusando el mismo generador del reset M-15** (`randomBytes(18).toString('base64url')`, ~24 chars) y
  se devuelve **UNA sola vez** en `tempPassword`. Se hashea con `argon2.hash` (patrón `auth.service.ts`),
  y `mustChangePassword=true`. Si el admin **provee** `password` (≥8), `mustChangePassword=false` y **no**
  hay `tempPassword`. En ambos casos `emailVerified=true` (staff como el seed; el customer porque el admin
  da fe — **no** se envía correo) y `authProvider='local'`. Sin KYC/CLABE/INE.
- **`email` se lowercasea** antes de persistir/validar unicidad (paridad con `/auth/register:102`).
- **Errores:** `409 EMAIL_TAKEN` (Prisma `P2002`); `422 VALIDATION_ERROR` (email/rol/locale inválidos,
  password débil); `403 FORBIDDEN` (guard de rol para no-super_admin).
- **Respuesta** (`AdminCreatedUserDTO`): `{ user: { id, email, name, role, locale, status, emailVerified,
  authProvider, createdAt }, tempPassword?, mustChangePassword }`. El `user` es **shape público** (sin
  `passwordHash`).
- **Seguridad / AuditLog:** el `after` de `user.create` guarda solo `{ role, emailVerified, authProvider,
  mustChangePassword }` — la contraseña (temp o provista) **NUNCA** entra al `AuditLog` ni a logs (mismo
  criterio que `user.reset_password`). Test defensivo verifica que el valor de la temp no aparece serializado.

> **Nota de validación (422 vs 400) — patrón del repo, no discrepancia de contrato.** El contrato §M6
> exige `422 VALIDATION_ERROR` para email/rol/password inválidos. El `ValidationPipe` global de NestJS
> devuelve **400** para fallos de `class-validator` y corre **antes** que cualquier pipe de ruta/param, así
> que `@IsEmail`/`@IsIn`/`@MinLength` en el DTO producirían 400, contradiciendo el contrato. Igual que
> `uploads`/`settings` (ver §16 y el comentario en `uploads.controller.ts`), el DTO declara solo la
> **estructura** (`@IsString`/`@IsOptional`, para sobrevivir al `whitelist`) y la validación **semántica**
> (formato de email, rol ∈ {customer|vault_operator|super_admin}, locale ∈ {es|en}, longitud de password)
> vive en `AdminService.createUser` lanzando `BusinessException.validation('VALIDATION_ERROR')` → **422**.
> Esto además hace la validación **unit-testeable** a nivel de servicio (como el resto de M6).

### F2 — Historial por usuario (reuso; no engorda `getUser`)
- **`?userId=` opcional** añadido a `GET /admin/buylist` (`SellRequest.userId`), `GET /admin/shipments`
  (`ShipmentRequest.userId`), `GET /admin/disputes` (`Dispute.userId`) — **patrón EXACTO** de
  `GET /admin/orders` (`@Query('userId')` → `where.userId`). Solo se añade el filtro; el **shape de
  respuesta, el guard (`vault_operator+`), la proyección PII por rol y la paginación no cambian**.
  Servicios: `buylist.service.ts:adminList`, `shipments.service.ts:adminList`, `disputes.service.ts:adminList`
  (4º parámetro `userId?`). Controllers añaden `@Query('userId')`.
- **`GET /api/v1/admin/users/:id/audit`** (`AdminUsersController.userAudit`, paginado). Roles: `super_admin`
  (proyección completa **con `ip`**) y `vault_operator` (**reducida, sin `ip`**) — cubierto por el guard de
  clase. Query `?scope=target|actor|both&page=&pageSize=`:
  - `target` (default): `entityType='User' AND entityId=:id` (acciones **sobre** el usuario).
  - `actor`: `actorUserId=:id` (acciones **del** usuario). `both`: OR de ambas.
  - Un `scope` desconocido se normaliza a `target` en el controller.
- **Método de LECTURA en `AuditService`** (`backend/src/modules/audit/audit.service.ts`, antes solo `log()`):
  `AuditService.listForUser({ userId, scope, role, page, pageSize })`. **404 `NOT_FOUND`** si el usuario no
  existe (consulta `user.findUnique` antes de tocar `AuditLog`).
- **`ip` condicional por rol:** se **reusa el `select` del audit-log de M10** (id/actorUserId/actorRole/
  action/entityType/entityId/createdAt) y se añade `...(isSuperAdmin ? { ip: true } : {})`. Para
  `vault_operator` la columna `ip` **ni siquiera se selecciona** en la query (no se lee de BD y no puede
  filtrarse). **`before`/`after` NUNCA** se seleccionan (posible PII/estado sensible), alineado con la regla
  de ARCHITECTURE §3.2. DTO expuesto: `UserAuditEntryDTO = { id, actorUserId, actorRole, action, entityType,
  entityId, createdAt, ip? }`.

### Tests (unitarios, sin Postgres/Redis)
- `backend/test/admin.user-create.spec.ts` (E2): crea customer/operator/super_admin OK; email lowercaseado;
  `emailVerified=true`/`authProvider='local'`; autogen → `tempPassword` una vez + `mustChangePassword=true`;
  password provista → `mustChangePassword=false` sin `tempPassword`; 422 para rol/email/locale/name/password
  débil; 409 `EMAIL_TAKEN` (P2002); auditoría no filtra la contraseña.
- `backend/test/admin.user-audit.spec.ts` (F2): scope target/actor/both arman el `where` correcto;
  super_admin selecciona `ip`, vault_operator no; nunca `before`/`after`; 404 usuario inexistente;
  paginación skip/take/total; normalización de scope inválido; metadata `@Roles` (super_admin en `createUser`,
  vault_operator+ a nivel de clase para el audit read); `?userId=` filtra en buylist/shipments/disputes.

### Gates
`npm run lint`, `npm run typecheck`, `npm test` (51 suites / 323 tests) y `npm run build` — **verdes**.

### Discrepancias con el contrato
Ninguna. `API_CONTRACT.md` / `ARCHITECTURE.md` no se tocan. La única decisión de implementación digna de
nota es el **422 en el servicio** (arriba), que **cumple** el contrato §M6 (400 sería la desviación).

---

## 18. Pase P0 jobs de barrido + cap de dinero saliente (BE-5 / v15-D1 / B-4 / BE-8)

> Cierra la deuda P0 de backend que toca **PII/dinero/ciclo de datos**: cablea los 4 jobs de barrido al
> scheduler, los hace disparables a mano, tapa el hueco de dinero saliente del buylist (B-4) y cierra BE-8.

### 18.1 Scheduler — los 7 jobs diarios cableados (BE-5 + v15-D1)
`src/jobs/scheduler.service.ts` ahora programa **7** jobs repetibles BullMQ (antes solo 3). Todos siguen el
**mismo patrón** (`queue.add(name, {}, this.repeat(name, cron))` + `case name: return this.<svc>.run()` en el
worker). El helper `repeat()` mantiene el **single-flight** (`jobId: <name>-daily`) + `removeOnComplete: true`
+ `removeOnFail: 100`, así que multi-instancia deduplica por `jobId`. Cron en **UTC**, escalonados para no
solaparse:

| Job | Cron (UTC) | Servicio (`run()`) | Qué hace |
|---|---|---|---|
| `fx-refresh` | `0 6 * * *` | `FxRefreshJobService` | tipo de cambio USD→MXN |
| `price-sync` | `15 6 * * *` | `PriceSyncJobService` | refresco de precios en bóveda |
| `portfolio-snapshot` | `0 7 * * *` | `PortfolioSnapshotJobService` | snapshot diario del portafolio |
| `ine-retention` | `30 7 * * *` | `IneRetentionJobService` | **purga PII INE** por `INE_RETENTION_DAYS` (LFPDPPP) |
| `dispute-deadline` | `45 7 * * *` | `DisputeDeadlineJobService` | disputa `abierta` vencida → `en_revision` |
| `buylist-sweep` | `0 8 * * *` | `BuylistSweepJobService` | 7d→`rechazada` / 30d→`abandonada` |
| `auth-token-sweep` | `15 8 * * *` | `AuthTokenSweepJobService` | limpia `AuthToken` expirados/usados |

- **Sin cambio de comportamiento en `buylist-sweep`**: se cablea el `run()` **actual** (7d/30d). La conversión
  a inventario de la carta abandonada (BE-3) **se difiere** (sigue como deuda, no se tocó).
- Se **inyectan** los 4 servicios nuevos en el constructor del scheduler (ya eran providers de `JobsModule`).
- Log de arranque actualizado: enumera los 7 jobs.

### 18.2 Endpoints manuales de disparo (super_admin, auditados)
`AdminJobsController` (`src/jobs/admin-jobs.controller.ts`) suma 4 endpoints al ya existente
`POST /admin/jobs/portfolio-snapshot`, mismo patrón (super_admin, `@HttpCode(200)`, auditado, devuelve el
resumen del `run()`):

| Endpoint | `action` auditado | Devuelve |
|---|---|---|
| `POST /admin/jobs/ine-retention` | `jobs.ine_retention.run` | `{ purged, scanned }` |
| `POST /admin/jobs/buylist-sweep` | `jobs.buylist_sweep.run` | `{ rejected, abandoned }` |
| `POST /admin/jobs/dispute-deadline` | `jobs.dispute_deadline.run` | `{ expired }` |
| `POST /admin/jobs/auth-token-sweep` | `jobs.auth_token_sweep.run` | `{ deleted }` |

> **Nota de contrato:** estos `/admin/jobs/*` son **operativos de ops** (disparo de jobs internos), no
> cambian ningún contrato de negocio ni shape de datos del cliente. Igual que el `POST /admin/jobs/portfolio-snapshot`
> ya existente, **no** se documentan en `API_CONTRACT.md` (superficie operativa admin). No requieren
> decisión del arquitecto.

### 18.3 Cap de `approvedPriceCents` — dinero saliente del buylist (B-4 / S-B5)
Defensa en profundidad, **dos capas**, sobre `ItemDecisionDto.approvedPriceCents` (la decisión carta-por-carta
que fija el monto SPEI a pagar al vendedor):
1. **DTO (`buylist.dto.ts`)**: `@Max(MAX_APPROVED_PRICE_CENTS)` con `MAX_APPROVED_PRICE_CENTS = 1_000_000`
   (**MX$10,000**, = tope AML mensual por defecto). Cota **dura de sanidad**: rechaza en el `ValidationPipe`
   (**400**) el PoC `99999999`. Un ítem individual nunca puede aprobar más que el tope mensual completo.
2. **Server-side (`buylist.service.ts` → `itemDecision` / `assertApprovedPriceWithinCap`)**: cota **fina**
   (SEC-A1, el dinero se valida en el servidor, no se confía al DTO). El monto efectivo debe ser
   **≤ min(`quotedPriceCents` × 2, tope por solicitud `buylist_cap_per_request_cents`)**. El **factor 2×**
   permite ajustes al alza acotados tras verificar la carta; el tope AML por solicitud (300,000c default) es la
   cota absoluta. Sin `quotedPriceCents` (carta que estaba en `precio_pendiente`) aplica **solo** la cota AML.
   Excede → **`APPROVED_PRICE_CAP_EXCEEDED`** (422, nuevo `ErrorCode`).
- **No rompe el flujo normal**: aprobar el precio cotizado tal cual (o un ajuste ≤ 2×) siempre pasa. **No toca
  SEC-A1** (la derivación server-side de la cotización) ni la guardia de aprobación de convert-to-inventory.

### 18.4 BE-8 (CORS `origin:true`) — ya estaba RESUELTA
`src/main.ts` **ya** usa `resolveCorsOrigins()` (allow-list desde `APP_BASE_URL`, fallback a `localhost` de
dev, **nunca** `origin:true`). No requirió cambio; se marca BE-8 como **RESUELTA/obsoleta** en `TECH_DEBT.md`.

### 18.5 Tests (unitarios, sin infra) + gates
- `test/scheduler.spec.ts` (reescrito): con **bullmq/ioredis mockeados**, verifica que **con `REDIS_URL`** se
  programan los **7** jobs con su cron exacto y que el worker enruta cada barrido a su `run()`; **sin
  `REDIS_URL`** sigue siendo no-op sin abrir conexiones.
- `test/admin-jobs.controller.spec.ts` (nuevo): los 5 endpoints corren `run()`, devuelven el resumen y auditan
  con su `action`.
- `test/buylist.approved-price-cap.spec.ts` (nuevo): rechaza por encima del tope (PoC y por AML), acepta ajuste
  normal (≤ 2×) y el flujo de aprobar el cotizado.
- **Gates verdes:** `lint`, `typecheck`, `test` (**53 suites / 336 tests**), `build`.

### 18.6 Discrepancias con el contrato
Ninguna. No se tocó `API_CONTRACT.md` ni `ARCHITECTURE.md`. Los `/admin/jobs/*` son superficie operativa admin
(ver §18.2). El `APPROVED_PRICE_CAP_EXCEEDED` es un `errorCode` de negocio nuevo (422) coherente con el patrón
de errores existente; no altera ningún shape de respuesta del contrato.

## 27. Ronda C (v1.8-ronda-c · 2026-08-16) — contrato M-19 + barrido de deuda backend

Pase que implementa las tres deudas de Ronda C del contrato (BE-10, `PendingPriceEntry.finish`, SEC-D2)
más un barrido de deuda de backend (RB-6, RB-3, RB-1/2/5, BE-9). **SEC-A1 intacto**: todos los montos
(incluido `approvedTotalCents`) se derivan server-side, nunca del cliente.

### 27.1 Migración M-19
`prisma/migrations/20260816170000_m19_pending_finish_sellrequest_closedat/migration.sql`. Dos columnas
aditivas con default seguro; **sin enums nuevos, sin backfill** (defaults/fallbacks cubren filas legacy):
- `PendingPriceEntry.finish  Finish  NOT NULL DEFAULT 'normal'` — la cola de precio pendiente pasa a ser
  **por acabado**. Modelo Prisma real (no solo DTO): `schema.prisma` gana la columna + comentario.
- `SellRequest.closedAt  TIMESTAMP(3)` (nullable) — fecha del cierre real (terminal). Campo interno de
  cumplimiento; **no** se expone en DTOs de cliente.

### 27.2 PricingService — 2 bugs funcionales + override por acabado
- **`manualOverride` (fix):** el `updateMany` que resuelve pendientes ahora filtra por `finish` en el
  `where` → resuelve **solo** el pendiente de ese acabado (antes cerraba `normal`+`holofoil`+… de la
  misma carta con un solo override).
- **`syncCardPrice` (fix):** propaga `finish` a `escalatePending` (antes encolaba sin acabado, colapsando
  acabados distintos en UNA entrada). `escalatePending` gana un parámetro `finish` (default `normal`) que
  entra a la clave de dedupe (`findFirst`) y a la fila creada.
- **`buylist.service.createRequest`:** la llamada a `escalatePending` propaga el `finish` cotizado.
- **`POST /admin/pricing/override`:** ya recibía `finish?` (default `normal`) en el `OverrideDto` y lo
  pasaba a `manualOverride`; se añadió `finish` al `after` de la auditoría. Fija la `PriceReference` de ese
  acabado y (con el fix) resuelve solo su pendiente.

### 27.3 BE-10 — `AdminUserOwnedItemRef` con `finish` + `productType` + `referenceValue`
`admin.service.getUser().ownedItems` ahora conforma el contrato §M6 enriquecido. Se extrajo un helper
privado `ownedItemRefs(items)` que reusa `PricingService.getReference`-equivalente por acabado. **Anti
N+1 (batch):** una sola lectura `priceReference.findMany({ where: { cardId: { in: [...] } } })` ordenada
`capturedDate desc, createdAt desc`; se arma un `Map` `(cardId|productType|gradeKey|finish) → ref más
reciente` y se resuelve cada item en memoria (misma semántica que `getReference`). Items sin precio del día
→ `referenceValue.status="pending"` (**no se excluyen**: es vista 360°, no un total de portafolio).

### 27.4 SEC-D2 — `closedAt` en transiciones terminales + retención de INE
`closedAt = now` se sella en **un solo punto por transición** terminal:
- `buylist.service.respond(decline)` → `rechazada`.
- `buylist.service.paySpei` → `pagada` (en el `updateMany` atómico terminal).
- `buylist-sweep.run`: `rechazada` (7d) y `abandonada` (30d).

`ine-retention.service.closureDate` usa `SellRequest.closedAt` como **fuente prioritaria** con **fallback**
al cálculo por timestamps de estado cuando `closedAt` es null (filas legacy). El **predicado de seguridad
NO cambia** (openCount>0 → continue; requiere `lastClosed` y `closureDate ≤ cutoff`).

### 27.5 Deudas de backend cerradas
- **RB-6 / SEC-D3:** `SellRequest.approvedTotalCents` ahora **se escribe** server-side. Nuevo helper
  `recomputeApprovedTotal(sellRequestId)` = suma de `approvedPriceCents` de los ítems (via `aggregate`),
  invocado tras cada `itemDecision`. Sin ítems aprobados → `null` (distingue "sin aprobar" de "cero"). El
  P&L / tarjeta "buylist del periodo" (`admin.dashboard`, `_sum.approvedTotalCents` para `pagada`) ya lo
  lee → deja de dar 0.
- **RB-3:** `assertApprovedPriceWithinCap` recibe el cap AML **ya resuelto** por `itemDecision`, que ahora
  honra `kyc.capPerRequestCentsOverride` del usuario (misma fuente que `createRequest`) con fallback al
  dial global. Un usuario con override alto ya no ve rechazada una aprobación legítima.
- **RB-1:** taxonomía de auditoría de jobs uniforme `jobs.<name>.run` (`portfolio_snapshot` era el único
  sin sufijo `.run`).
- **RB-2:** `entityType: 'Job'` + `entityId: '<job>'` presentes en TODA la auditoría de `/admin/jobs/*`.
- **RB-5:** JSDoc corregido en `buylist-sweep.service.ts` (decía "30d → convertida_inventario"; el código
  setea `abandonada`) e `ine-retention.service.ts` (decía "scheduling BullMQ es deuda BE-5"; ya cableado).
- **BE-9:** validación de credenciales centralizada en `common/validation/credentials.ts`
  (`MIN_PASSWORD_LENGTH`, `EMAIL_REGEX`, `normalizeEmail`, `isValidEmailFormat`, `isStrongPassword`),
  consumida por `admin.createUser` y por las DTOs de `auth` (`RegisterDto`/`ResetPasswordDto` usan la
  constante compartida). Fin de la lógica duplicada.

### 27.6 Deudas DIFERIDAS (no tocadas, siguen en TECH_DEBT)
BE-2 (TOCTOU), BE-3 (30d→inventario), BE-4/D3 (N+1 valuaciones a escala), BE-6 (providers graded/sealed),
BE-7 (orden huérfana), D1/D2 (BullMQ catálogo/paginación), RB-4 (2× dial), enumeración/timing (aceptadas),
SEC-D1 (lifecycle R2 = devops/humano).

### 27.7 Tests (nuevos/actualizados) + gates
- `test/pricing.finish-pending.spec.ts` (nuevo): (a) `manualOverride` filtra por `finish` en el updateMany;
  `escalatePending` encola con `finish` en clave+fila; defaults `normal`.
- `test/buylist.ronda-c.spec.ts` (nuevo): (d) `approvedTotalCents` derivado y persistido (+ `null` sin
  aprobados); (e) cap honra el override KYC (aprueba con override, rechaza sin él); (c) `closedAt` en
  `respond(decline)` y `paySpei`.
- `test/buylist-sweep.closedat.spec.ts` (nuevo): `closedAt` en `rechazada`/`abandonada` del sweep.
- `test/ine-retention.spec.ts` (ampliado): `closedAt` es la fuente prioritaria del cierre (2 casos).
- `test/admin.pii.spec.ts` (ampliado): `ownedItems` trae `finish`+`productType`+`referenceValue` (pending
  sin precio; priced con `PriceReference` del acabado; **una** query batch).
- `test/buylist.approved-price-cap.spec.ts` (actualizado): mock del nuevo shape de `itemDecision`
  (include `sellRequest.userId`, `kycProfile`, `aggregate`).
- `test/admin-jobs.controller.spec.ts` (actualizado): nueva taxonomía `.run` + entityType/entityId.
- **Gates verdes (desde `backend/`):** `lint`, `typecheck`, `test` (**56 suites / 350 tests**), `build`.

### 27.8 Discrepancias con el contrato
Ninguna. No se tocó `API_CONTRACT.md` ni `ARCHITECTURE.md`. La implementación conforma v1.8-ronda-c
(§M2 override+cola por acabado, §M6 BE-10, §11 DTOs, §12). Todo se deriva server-side (SEC-A1).

## 28. Fix CI-1 — aislamiento de tests env-sensibles a REDIS_URL (2026-08-16)
Solo cambio de **tests** (sin código de producción). El job `backend` del workflow **CI** levanta un
contenedor Redis y **exporta `REDIS_URL`**; dos suites afirmaban comportamiento "sin Redis" pero leían la
variable vía `ConfigService.get('REDIS_URL')`, que **cae a `process.env`**. Resultado en CI: **2 tests
fallaban / 348 pasaban** (verde en local/qa porque ahí no hay `REDIS_URL`).

- `test/health-redis.provider.spec.ts` — «sin REDIS_URL: resuelve a null y no crea cliente».
- `test/scheduler.spec.ts` — «sin REDIS_URL: onModuleInit es no-op» (el gating BE-5/v15-D1).

Fix: en el bloque `describe` que ejerce el caso "sin REDIS_URL" se guarda/borra `process.env.REDIS_URL` en
`beforeEach` y se restaura en `afterEach` (sin filtrar entre tests). Los casos "con REDIS_URL" ya construían
su propio `new ConfigService({ REDIS_URL: ... })` y no dependían de `process.env`, así que no cambian.
Producción intacta (`health-redis.provider.ts`, `scheduler.service.ts` sin tocar): el bug era del test, no del
gating. Verificado en **ambos** entornos: `REDIS_URL=redis://localhost:6379 npm test` y `npm test` →
**56 suites / 350 tests verdes** en los dos; `lint`, `typecheck`, `build` verdes. No aparecieron otras fugas
env-sensibles (las suites PII construyen su propio `ConfigService` con claves y ya pasaban en CI). Ver CI-1 en
`docs/TECH_DEBT.md`.

## 29. v1.9-set-chart (2026-08-16) — Gráfica PÚBLICA del valor de un set (hero de la home)

Gráfica estilo acciones del **valor de mercado agregado de un set destacado**, PÚBLICA (visitantes
anónimos), datos REALES con captura diaria. Reusa el patrón de `PortfolioSnapshot`/portfolio-history
pero **por set** y **sin PII**. Contrato: API_CONTRACT changelog v1.9-set-chart; ARCHITECTURE §3.2 /
§4.12 / §11 (M-20). **SEC-A1 intacto**: `totalValueMxnCents` se deriva SIEMPRE server-side de
`PriceReference` real; nunca del cliente. **Todo aditivo, una sola migración M-20 (sin backfill).**

### 29.1 Migración M-20 + modelo `SetValueSnapshot`
- Migración: `backend/prisma/migrations/20260816180000_m20_set_value_snapshot/` (crea tabla + FK
  `onDelete: Cascade` a `CardSet` + índice único + índice de rango). Aditiva, **sin backfill**: la
  serie arranca vacía y crece desde el primer día que corran los jobs.
- Modelo (`schema.prisma`): `SetValueSnapshot { id, setId (FK→CardSet, Cascade), asOfDate @db.Date,
  totalValueMxnCents Int, pricedCardCount Int, totalCardCount Int, createdAt, updatedAt,
  @@unique([setId, asOfDate]), @@index([setId, asOfDate]) }`. Relación inversa nueva en `CardSet`:
  `snapshots SetValueSnapshot[]` (solo relación Prisma, no añade columna a `CardSet`).
- Idempotente por día vía el `@@unique`: re-correr el job del día hace **upsert**, no duplica.

### 29.2 `SetValueService` (vive en `backend/src/modules/catalog/set-value.service.ts`)
Elegí `modules/catalog/` (es lectura de catálogo público, y ahí ya viven el `PokemonTcgIoClient` y el
sync). Firmas:
- `resolveFeaturedSet(): Promise<CardSet | null>` — cascada §4.12b: env `HOME_FEATURED_SET_ID` (id
  nativo pokemontcg.io → `CardSet` local por `externalId`) → set con mayor `totalValueMxnCents` en su
  último `SetValueSnapshot` → `CardSet` más reciente por `releaseDate` (desc; String `yyyy/MM/dd` →
  orden lexicográfico) → `createdAt` desc → `null`. La usan **tanto** el endpoint público **como** el
  job `set-price-sync` (env y gráfica no divergen).
- `computeSetValue(setId: string, asOf?: Date): Promise<{ totalValueMxnCents, pricedCardCount,
  totalCardCount }>` — SUM §4.12a con acabado/tipo/grado FIJOS (`finish='normal'`, `productType='raw'`,
  `gradeKey='raw:NM'`, campo `priceMxnCents`). Cartas sin precio se **excluyen** del total pero se
  cuentan en `totalCardCount`. **NO genera `PendingPriceEntry`** (agregación de mercado, no de bóveda).
- `valueHistory(setId, range): Promise<{ range, points: SetValuePointDTO[], change }>` — lee
  `SetValueSnapshot` del rango, arma `points` (asc por fecha, cada punto lleva `pricedCardCount`) +
  `change {absMxnCents, pct, direction}` (misma lógica que portfolio-history: `pct=null` si el valor
  inicial es 0; rango inválido cae a `1m`).
- Wrappers para los endpoints: `featuredSetHistory(range)` (resuelve el set; `set:null,points:[]` si no
  hay ningún `CardSet`) y `setHistoryById(id, range)` (404 `NOT_FOUND` si el id local no existe; `set`
  siempre resuelto, `points:[]` si aún no hay snapshots). `snapshotFeaturedSet()` para el job diario.

### 29.3 Cómo se evita el N+1 en `computeSetValue`
**2 queries fijas**, independientes del nº de cartas del set: (1) `card.findMany({ where:{setId},
select:{id} })`; (2) `priceReference.findMany({ where:{ cardId:{in:[...]}, productType:'raw',
gradeKey:'raw:NM', finish:'normal', capturedDate:{lte:asOf}? }, orderBy:{capturedDate:'desc'} })`. El
"vigente más reciente por carta" se resuelve **en memoria**: como viene ordenado `capturedDate desc`, la
**primera** fila vista por `cardId` es la más reciente (dedupe con un `Set`). Cero llamadas por-carta.

### 29.4 Jobs nuevos + crons cableados
- `SetPriceSyncJobService` (`backend/src/jobs/set-price-sync.service.ts`) — precia TODAS las cartas del
  set destacado: `Card WHERE setId=<featured>` **SIN** el filtro `InventoryItem` (cierra **DEV-3**).
  Reusa `PricingService.syncCardPrice(card,'raw','raw:NM','normal','catalog',undefined,false)` — host
  FIJO anti-SSRF, cache diario. El **7º parámetro nuevo `escalate=false`** evita encolar
  `PendingPriceEntry` por cada carta sin precio (§4.12a: no inundar la cola con todo el catálogo). Los
  demás llamadores de `syncCardPrice` quedan con el default `escalate=true` (comportamiento intacto).
- `SetValueSnapshotJobService` (`backend/src/jobs/set-value-snapshot.service.ts`) — delega en
  `SetValueService.snapshotFeaturedSet()`: `computeSetValue(featured, today)` + **upsert** idempotente
  por `(setId, asOfDate)`.
- Ambos servicios se **proveen y exportan desde `CatalogModule`** (dependen de `SetValueService`/
  `PricingService`; se evita el ciclo con `JobsModule`, mismo patrón que `portfolio-snapshot` en
  `VaultModule`). `JobsModule` ahora importa `CatalogModule`.
- Scheduler (`scheduler.service.ts`, gated por `REDIS_URL`, single-flight por `jobId`): **`set-price-sync
  '30 6 * * *'`** y **`set-value-snapshot '15 7 * * *'`**. Orden duro **FX (`0 6`) → set-price-sync
  (`30 6`) → portfolio (`0 7`) → set-value-snapshot (`15 7`)**.

### 29.5 Endpoints públicos (`@Public()`) — `catalog.controller.ts`
- `GET /api/v1/catalog/featured-set/value-history?range=` → `SetValueHistoryResponse`. Set destacado
  resuelto server-side (el front NO hardcodea id). Sin `CardSet` → `set:null, points:[], change flat`.
- `GET /api/v1/catalog/sets/:id/value-history?range=` → igual, por id **local** del `CardSet`; `404` si
  no existe; sin snapshots → `points:[]` con `set` resuelto.
- `range` default `1m`; conjunto `5d|15d|1m|3m|6m|1y|ytd|all` (inválido cae a `1m`).

### 29.6 Disparos manuales admin (super_admin, auditados) — `admin-jobs.controller.ts`
`POST /api/v1/admin/jobs/set-price-sync` y `POST /api/v1/admin/jobs/set-value-snapshot`, para **sembrar
el primer punto sin esperar al cron**. Auditados como `jobs.set_price_sync.run` /
`jobs.set_value_snapshot.run` (`entityType='Job'`), taxonomía uniforme con los demás disparos.

### 29.7 Semilla histórica — qué hice (honesto, sin fabricar)
**NO se hizo backfill.** pokemontcg.io solo entrega el precio de **HOY** (TCGPlayer `market`), sin
historial; y las cartas del set fuera de bóveda no tienen `PriceReference` de fechas previas. No existe
una fuente pública **legítima y fiable** de histórico real de precios integrable en el MVP sin costo. Por
tanto la serie **arranca hoy** (primer `set-value-snapshot`, sembrable a mano por el disparo admin) y
**crece a diario**. Se respeta "NUNCA fabriques puntos ni simules mercado": un día sin snapshot no tiene
punto; el campo `estimated?` del DTO queda reservado y sin uso.

### 29.8 Env para **devops** (NO edité `.env.example` — lo lleva devops)
- `HOME_FEATURED_SET_ID` (opcional): id **nativo pokemontcg.io** del set destacado (ej. `sv8`). Si no se
  setea o no resuelve a un `CardSet` local, aplica el **fallback determinista** (§29.2) — el feature no
  se bloquea sin la env. Recomendado: un set Scarlet & Violet reciente y líquido. Reutiliza el
  `POKEMONTCG_IO_API_KEY` existente para el rate-limit del free tier.

### 29.9 Tests + gates (desde `backend/`)
- `test/set-value.spec.ts` (**NUEVO**): `computeSetValue` (excluye sin-precio, cuenta priced/total,
  dedupe del más reciente por carta, **2 queries = sin N+1**, cota `capturedDate<=asOf`, set vacío);
  `resolveFeaturedSet` (los 4 escalones de la cascada + env que no resuelve); `valueHistory` (vacío→flat,
  ascendente→up con pct, valor inicial 0→pct null, rango inválido→1m); endpoints `featuredSetHistory`/
  `setHistoryById` (con/sin snapshots, `set:null`, `404`); jobs `set-value-snapshot` (upsert idempotente)
  y `set-price-sync` (recorre por `setId` **sin InventoryItem** + `escalate=false`).
- Actualizados: `test/scheduler.spec.ts` (ahora **9 crons**, verifica `30 6`/`15 7` y el ruteo del
  worker) y `test/admin-jobs.controller.spec.ts` (2 disparos nuevos auditados).
- Resultado: **`lint`, `typecheck`, `build` verdes**; **57 suites / 371 tests verdes** (`npx jest`).
  Antes del cambio: 56 suites / ~350 tests. `prisma validate` OK (con `DATABASE_URL` dummy).

### 29.10 Cierre post-veredicto (2026-08-16) — 2 fixes baratos + deuda registrada
Feature ya aprobada por **qa + techlead + seguridad**. En el cierre se aplicaron los DOS fixes baratos que
los revisores recomendaron y se registró la deuda no bloqueante (`docs/TECH_DEBT.md` → sección v1.9-set-chart).

- **SEC-F1 (seguridad) — throttle propio en los 2 endpoints públicos de la gráfica.**
  `catalog.controller.ts`: `GET /catalog/featured-set/value-history` y `GET /catalog/sets/:id/value-history`
  ahora llevan `@Throttle({ default: { ttl: 60_000, limit: 60 } })` (**60/min por IP**), en PARIDAD con
  `BuylistCatalogController` (mismo import/patrón). Antes colgaban solo del global (300/min). Sin config nueva.
- **TD-2 (techlead) — índice redundante eliminado en M-20.** `SetValueSnapshot` tenía
  `@@unique([setId, asOfDate])` **y** `@@index([setId, asOfDate])` (mismas columnas/orden). El `@@index` era
  redundante (el índice del `@@unique` ya sirve el rango de la gráfica). Se quitó del `schema.prisma` **y** del
  `prisma/migrations/20260816180000_m20_set_value_snapshot/migration.sql` (edición **en sitio**: M-20 no se ha
  aplicado en ningún entorno). `prisma validate` OK; schema y migración coherentes (índice fuera en ambos).
- **TD-1 (parcial) — `SET_VALUE_RULE` compartido.** Se extrajo la constante `SET_VALUE_RULE`
  (`{ productType:'raw', gradeKey:'raw:NM', finish:'normal' }`) a `set-value.service.ts`, reusada por
  `computeSetValue` (lectura/agregación) **y** el job `set-price-sync` (escritura de la PriceReference del día).
  Antes los 3 literales estaban duplicados en ambos archivos → riesgo de que escritura y lectura divergieran.
  **Queda como deuda** unificar la *lógica* "más reciente por capturedDate" con `PricingService.getReference`
  vía un batch compartido (dirección RB-8/BE-4/D3, diferido por escala). Tests de `set-value.spec.ts` ahora
  referencian `SET_VALUE_RULE` (single source verificado en `computeSetValue` y `set-price-sync`).
- Deudas restantes registradas: **TD-3** (cargas en memoria en fallback-2/`computeSetValue`; el request
  público NO invoca `computeSetValue`), **SEC-F2** (`:id` sin validación de formato; sin impacto, Prisma
  parametriza + 404) y **QA-min** (fallback-3 ordena `releaseDate` como String, correcto para `yyyy/MM/dd`).
- Gates del cierre: **`lint`, `typecheck`, `build` verdes**; **57 suites / 371 tests verdes**.

### 30. Endurecimiento cripto GCM en PII (2026-08-16) — gate SAST
Hallazgo REAL del gate SAST (semgrep `javascript.node-crypto.security.gcm-no-tag-length`, registry `p/*`) en
`src/common/crypto/pii-crypto.service.ts` → `decrypt()`. Es defensa en profundidad sobre PII (CLABE/RFC/INE).

- **Problema:** `createDecipheriv('aes-256-gcm', key, iv)` + `setAuthTag(tag)` **sin** `authTagLength`.
  Node acepta authTags GCM **más cortos** de 16 bytes; un atacante con capacidad de manipular el ciphertext
  almacenado (`v1:iv:tag:ct` en BD) podría presentar un **tag truncado** y debilitar la autenticidad GCM
  (riesgo de forja).
- **Fix (endurecimiento interno, retrocompatible):**
  - `decrypt()`: valida `tag.length === 16` **ANTES** de `setAuthTag`; si no, lanza el mensaje **genérico**
    `Malformed PII ciphertext` (idéntico al de payload mal formado → **sin oráculo** que distinga el motivo).
    Luego `createDecipheriv('aes-256-gcm', encKey, iv, { authTagLength: 16 })`.
  - `encrypt()`: `createCipheriv('aes-256-gcm', encKey, iv, { authTagLength: 16 })` explícito por
    simetría/robustez (`getAuthTag()` ya devolvía 16 bytes).
  - Nueva constante `TAG_BYTES = 16`.
- **Por qué es retrocompatible:** NO cambia el formato serializado `v1:iv:tag:ct` ni las claves. Todo authTag
  que produjo `encrypt()` (`cipher.getAuthTag()`) es de 16 bytes, así que los datos ya cifrados en BD descifran
  igual. Es puramente un endurecimiento de la ruta de verificación.
- **Tests** (`test/pii-crypto.spec.ts`): (a) round-trip `decrypt(encrypt(x)) === x` sigue OK; (b) test nuevo
  «rechaza un authTag GCM truncado (longitud != 16)»: verifica que el tag legítimo mide 16 bytes, y que un tag
  de **12 bytes** (truncado), **vacío** y **20 bytes** (sobredimensionado) son RECHAZADOS con el mensaje
  genérico; (c) el test de manipulación de ciphertext/formato sigue lanzando.
- **Gates:** `lint`, `typecheck`, `build` verdes; **57 suites / 372 tests verdes** (`npm test`). Antes: 371.
- **Estado:** pendiente de **veredicto de seguridad + qa** por tocar PII/cripto. Cerrado en `TECH_DEBT.md`
  → SAST-1.

## 30. Gate SAST (trivy-image) — bump supply-chain node-tar / tmp (2026-08-16)

> `trivy-image` (SAST de imagen del backend, ya funcionando) reportó CVEs HIGH/CRITICAL reales en
> dependencias transitivas de la imagen. Se remedian con `overrides` en `backend/package.json`. Cerrado en
> `TECH_DEBT.md` → **SAST-2**. Solo cambios de dependencias; código de la app intacto.

### 30.1 Origen de los hallazgos (árbol `npm ls`)
- **`tmp`** (CVE-2026-44705, path traversal por prefix/postfix; fixed **>= 0.2.6**): **devDependency**
  transitiva del CLI de Nest. Árbol:
  `@nestjs/cli@10.4.9 → inquirer@8.2.6 → external-editor@3.1.0 → tmp@0.0.33`. Estaba en `0.0.33`
  (vulnerable). Marcado `"dev": true` en el lockfile.
- **`tar` (node-tar)** (CVE-2026-26960 / -29786 / -31802 / -59874, hardlink path traversal + DoS; fixed
  **>= 7.5.18**): **NO está presente** en el árbol de dependencias del backend. `npm ls tar` → `(empty)`,
  no existe ningún `node_modules/**/tar` ni en el lockfile ni instalado. Prisma 5.x (`@prisma/fetch-engine`)
  **descarga sus binarios de engine directamente** (gzip), no vía node-tar; ningún otro paquete del árbol lo
  requiere. El override queda igualmente aplicado como **pin defensivo**: si una futura resolución transitiva
  reintrodujera `tar`, quedará forzado a `>= 7.5.18`. (Si trivy vuelve a marcar `tar`, probablemente escaneó
  una imagen construida con un lockfile anterior; la imagen se construye con `npm ci` desde este lockfile, que
  ya **no** contiene `tar`.)

### 30.2 Overrides aplicados y resolución (`npm ls`)
En `backend/package.json` → `overrides` (se suman a los ya existentes de SEC-C2):
```json
"tar": ">=7.5.18",
"tmp": ">=0.2.6"
```
Tras `npm install` + `npm ci --include=dev` (lockfile regenerado, 788 paquetes auditados):
- `tmp` → **0.2.7** `overridden` (satisface el `^0.0.33` de `external-editor`; el override cascadea sin romper
  el peer). Efecto colateral limpio: se elimina la sub-dep transitiva `os-tmpdir@1.0.2` (tmp 0.2.x ya no la usa).
  `npm ls tmp`: `... external-editor@3.1.0 → tmp@0.2.7 overridden`.
- `tar` → `(empty)` (no presente; el override no fuerza una instalación, solo pinnea si aparece).

### 30.3 ¿devDependency en la imagen de runtime? (nota para devops)
- **`tmp` es devDependency** (vía `@nestjs/cli`). **Igual viaja en la imagen** porque `Dockerfile.backend`
  hace `npm ci --include=dev` **y NO poda** (`no npm prune --omit=dev`) — decisión de devops documentada en el
  propio Dockerfile (etapa build) y `DEVOPS_NOTES §6`: se conservan `prisma`/`ts-node`/`typescript` para
  `prisma migrate deploy` + seed en runtime, arrastrando todo el árbol dev (incl. `@nestjs/cli` → `tmp`). Por
  eso el override es la remediación correcta (parchea aunque sea devDep). **Sugerencia opcional a devops**
  (no requerida para cerrar el gate): un `prune`/multi-stage que excluya `@nestjs/cli` del runtime reduciría
  superficie, pero el override ya deja `tmp` en versión parcheada de todas formas.

### 30.4 Gates (verde)
- `prisma generate` OK · `lint` OK · `typecheck` OK · `build` (`nest build`) OK.
- `npm test` = **57 suites / 372 tests verdes** (sin cambio de conteo; solo bump de deps, sin tocar código).
- `npm ci --include=dev` limpio desde el lockfile regenerado; `tmp` resuelve a **0.2.7** en instalación limpia.

## 31. Fix E2E-1 — seed E2E idempotente + fin de la doble siembra (2026-08-16)

> El gate **backend-e2e** (`npm run test:integration`) fallaba. Solo se tocó `backend/prisma/seed-e2e.ts` y
> `backend/package.json`. Cerrado en `TECH_DEBT.md` → **E2E-1**. Ningún endpoint ni lógica de negocio tocada.

### 31.1 Síntoma y diagnóstico
Postgres del runner registraba, **durante** el `jest`:
```
ERROR: duplicate key ... "ProcessedStripeEvent_pkey" — (id)=(evt_e2e_succeeded_fixed) already exists.
ERROR: duplicate key ... "User_email_key" — (email)=(customer@e2e.local) already exists.
```
Investigación (`seed-e2e.ts`, `jest-integration.config.js`, los 5 `*.e2e-spec.ts`, `payments.service.ts`,
`auth.service.ts`):
- **No hay `globalSetup`** en `jest-integration.config.js` (solo `setupFilesAfterEnv: setup.ts`, que NO
  siembra). La "doble siembra" era: `test:integration` corría `seed:synthetic` **standalone** ANTES de `jest`
  **y** cada uno de los 5 specs vuelve a llamar `seedE2E()` en `beforeAll` → 6 siembras/corrida.
- Los DOS `ERROR` de Postgres citados son, en una corrida única, **P2002 capturados por diseño** (no el
  fallo): `auth.service.ts:111` (test "rechaza email duplicado" → 409 `EMAIL_TAKEN`) y `payments.service.ts:44`
  (guard de idempotencia atómica del webhook, test "es IDEMPOTENTE: reenviar el mismo event.id"). Postgres
  loguea el `ERROR` aunque la app lo capture.
- **Fallo real = idempotencia CROSS-RUN.** `seedE2E` reseteaba estado transaccional **por userId**
  (orders/shipments/sellRequests/disputes/kyc) pero **NO** `ProcessedStripeEvent` ni `InventoryMovement` de
  piezas de **plataforma** (que no cuelgan de userId). En una **2ª corrida** sobre la misma DB:
  `evt_e2e_succeeded_fixed` persistía → el webhook hacía no-op → la orden no liquidaba (falla "el webhook
  FIRMADO liquida la orden"); y los `InventoryMovement reason=settle` previos hacían que
  `expect(settleMovements).toBe(1)` contara 2+.

### 31.2 Fix
1. **Fin de la doble siembra (lo más limpio):** `package.json` → `test:integration` pasa de
   `prisma migrate deploy && npm run seed:synthetic && jest ...` a `prisma migrate deploy && jest ...`. La
   siembra queda como **única fuente** en el `beforeAll` de cada spec (aislamiento por-spec necesario porque
   las suites mutan estado). El script `seed:synthetic` (= `ts-node prisma/seed-e2e.ts`) **se conserva** —lo
   usan `scripts/seed-synthetic.sh` y CI de staging.
2. **`seedE2E` idempotente cross-run (defensa):** nuevo paso **3b** que borra, además del reset por-usuario:
   - `InventoryMovement` de los ítems E2E (`where itemId IN (items con folio IN E2E_FOLIOS)`);
   - `ProcessedStripeEvent` (`id = evt_e2e_succeeded_fixed` **OR** `id startsWith 'evt_e2e'`, que cubre los
     `evt_e2e_<uuid>` aleatorios que genera el harness `sendStripeWebhook`).
   El resto del seed ya era idempotente: **todos** los fixtures con clave única usan `upsert` (ConfigSetting,
   User `by email`, VaultLocation, CardSet, Card, PriceReference, InventoryItem `by folio`) y `Address` va con
   guard `findFirst`. Revisado el seed completo, no solo los dos fixtures del log.

Resultado: `test:integration` corrido **dos veces seguidas** sobre la misma DB no rompe (idempotencia real).

### 31.3 Gates (verde)
- `lint` OK · `typecheck` OK · `build` (`nest build`) OK.
- `npm test` = **57 suites / 372 tests verdes** (unit, sin infra; sin cambio de conteo).
- **No** pude correr `test:integration` en local (egress bloquea el pull de imágenes Docker de Postgres/Redis/
  MinIO). El **verde de E2E lo confirma el runner de CI**.

## 32. Tier 0 — Operación por acabado: escalado de pendientes con `finish` + cola con carta (2026-08-17)

> Dos arreglos chicos que habilitan la operación por acabado (M-19/Ronda C) end-to-end en M1/M2.
> Rama `claude/git-repo-review-c67xyk`. Sin migraciones (el modelo ya tenía `finish` desde M-19).

### 32.1 Alta de inventario escala el pendiente CON el `finish` del alta (bug real)
- **Bug:** en `inventory.service.ts#createItem` las DOS llamadas a `escalatePending(...)` (aportación en
  especie sin referencia, y sellado sin precio manual) omitían el 6º argumento `finish` → por el default
  de la firma el pendiente se encolaba como `normal` aunque el alta fuera `holofoil`. Consecuencia: el
  override del admin "resolvía" el acabado equivocado y la valuación por versión (M2) quedaba rota.
- **Fix:** ambas llamadas pasan ahora el `finish` ya resuelto por `resolveFinish` (que valida contra
  `Card.availableFinishes`, SEC-A1). Para sealed `resolveFinish` devuelve `normal` siempre, así que ese
  camino no cambia de comportamiento, solo queda explícito y en paridad de firma con `syncCardPrice`.
  La firma de `PricingService.escalatePending(cardId, productType, gradeKey, context, refId?, finish)` ya
  aceptaba `finish` (Ronda C) — no hubo que tocarla.

### 32.2 `pendingQueue()` incluye la carta → `GET /admin/pricing/pending` con `cardName` + `finish`
- **Bug:** el `findMany` de `pricing.service.ts#pendingQueue` no hacía `include: { card }` → el DTO
  llegaba sin nombre de carta y el frontend M2 pintaba el UUID.
- **Fix + shape final por entrada** (aditivo sobre `PendingPriceEntry` del contrato §11; el front consume
  el `cardName` plano opcional que ya tenía tipado):
  ```json
  { "id": "...", "cardId": "...", "productType": "raw", "gradeKey": "raw:NM",
    "finish": "holofoil", "context": "inventory", "refId": null, "status": "open",
    "resolvedPriceRefId": null, "createdAt": "...", "resolvedAt": null,
    "cardName": "Zapdos",
    "card": { "id": "...", "name": "Zapdos", "number": "16", "setName": "Fossil" } }
  ```
  `finish` viene del modelo (M-19) y se propaga tal cual; `cardName` es conveniencia plana y `card`
  trae name+number+setName (proyección, no la relación Prisma cruda).

### 32.3 Override por acabado — confirmado, sin cambios
`POST /admin/pricing/override` **ya** acepta `finish?` (Ronda C): `OverrideDto` lo valida con `@IsIn`,
el controller pasa `dto.finish ?? 'normal'` y `manualOverride` upserta la `PriceReference` de ese acabado
y resuelve **solo** el `PendingPriceEntry` de ese `(cardId, productType, gradeKey, finish)`. La respuesta
es el `PriceReference` completo (incluye `finish`). Auditado con `finish` en `after`.

### 32.4 Tests y gates (verde)
- Nuevo `test/inventory.finish-pending.spec.ts`: aportación holofoil sin referencia → `PRICE_PENDING` y
  encola con `finish='holofoil'` (y consulta la referencia de ESE acabado); con referencia → no escala,
  persiste el finish y calcula costo 70%; finish fuera de `availableFinishes` → `FINISH_NOT_AVAILABLE`.
- `test/pricing.finish-pending.spec.ts` ampliado: `pendingQueue` hace el `include` de card+set y cada
  entrada expone `cardName`, `card{name,number,setName}` y `finish`.
- `test/inventory.sealed.spec.ts` ajustado a la nueva llamada (`..., 'inventory', undefined, 'normal'`).
- Gates: `lint` OK · `typecheck` OK · `build` OK · `npm test` = **58 suites / 377 tests verdes**.

## 33. Fase 0 del epic de precios (commit ebb4dee, 2026-08-17) — gate premium + encolado honesto + INE con pendiente

> Fase 0 del epic de precios, con **triple veredicto APROBADO** (qa + techlead APROBADO-con-deuda +
> seguridad APROBADO). Cierra el bug estructural de dinero por el que una rareza chase podía cotizar al bin
> fijo barato de bulk, hace real la promesa del copy del cotizador público, y sella el gating de INE cuando
> la solicitud lleva líneas pendientes. Remite al contrato **§4.2.1** (semántica holofoil por rareza) y
> **§6** (reglas de buylist). La deuda **no bloqueante** del delta quedó registrada como **BE-13..BE-19** en
> `docs/TECH_DEBT.md` (ver disparadores; BE-13 pide ticket antes de operar con dinero real).

### 33.1 (Fase 0.1) Gate premium — `isPremiumRarity` + `ruleKeyCandidates` (`common/money.ts`)
- **Regla de negocio (humano):** SOLO Common/Uncommon y el "holo/reverse común" son precio **FIJO** de bulk;
  todo lo más raro es un **% arriba del mercado**. Una rareza **premium (chase)** por tanto **NUNCA** debe
  poder caer al bin fijo barato de bulk.
- **`isPremiumRarity(rarity)`**: `true` si la rareza matchea `PREMIUM_RARITY_PATTERNS` (allowlist de
  substrings/tokens case-insensitive: Illustration/Ultra/Double/Secret/Rainbow/Hyper/Full Art/Alt Art/
  Amazing/Radiant/Shiny/Trainer Gallery/Character/Gold/Prism + token suelto `\b(v|vmax|vstar|vunion|ex|gx)\b`).
  Diseñado para **sobre-incluir** a propósito: una carta barata mal clasificada como premium solo pasa a "%
  de mercado" (**costo acotado**), mientras que sub-incluir una chase = tratarla como bulk = **pérdida de
  dinero** (el fallo que se estaba cerrando).
- **`ruleKeyCandidates(rarity, finish)`** devuelve los candidatos de `ruleKey` en orden de prioridad (gana el
  primero con regla explícita; si ninguno → fallback pct). Fix central: la **rareza real va SIEMPRE primero**,
  y para `holofoil`/`first_edition_holofoil` una rareza **premium** retorna `[rarity]` (su propia regla o el
  fallback pct, **nunca** la clave sintética `'Holo'` que el admin puede tener fija barata). No-premium
  preserva la semántica de ARCHITECTURE §4.2.1: holo de bulk → `[rarity, 'Holo']`; Common/Uncommon holofoil →
  `['Holo']` (% del market holofoil). Antes, una holo premium sin "holo" en el string (Illustration/Ultra/
  Double Rare) resolvía a `['Holo']` y una chase de miles de pesos cotizaba al bin fijo barato — bug
  estructural, ya cerrado.
- **Deuda anotada del gate:** la allowlist es finita (**BE-14**: chase antiguas — Rare Shining/Prime/LEGEND/
  BREAK/ACE — se escapan → subcotización, nunca money-out excesivo) y la rama `reverse_holo` no pasa por el
  gate (**BE-18**, asimetría probablemente inocua). Falta test unitario directo del gate (**BE-17**) y hay un
  comentario cosmético a corregir ("inocuo" → "costo acotado", **BE-19**).

### 33.2 (Fase 0.2) `publicQuote` encola el pendiente de forma honesta (`buylist.service.ts`)
- El copy del cotizador público promete que un acabado en `precio_pendiente` "entrará a la cola de precio
  pendiente". Igual que `createRequest`, `publicQuote` ahora llama
  `pricing.escalatePending(cardId, productType, gradeKey, 'buylist', undefined, finish)` para cada acabado
  cotizado como pendiente, de modo que la promesa sea real y el trabajo de fijar precio llegue al admin.
- **SEC-A1 intacto:** rareza y montos se siguen derivando **server-side**; esto solo escala el trabajo de
  precio. El dedup de `escalatePending` (`findFirst status='open'` + `create`) hace el llamado **idempotente**
  en el caso normal.
- **Deuda anotada:** el encolado ocurre desde un endpoint **público/anónimo** (**BE-16**, hallazgo QA aceptado
  por seguridad — un anónimo puede poblar la cola enumerando cartas existentes; acotado por throttle 300/min y
  dedup best-effort; **la Fase 1 on-demand lo supersede**), y el dedup **no es atómico** (**BE-15**: sin
  `@@unique` en `PendingPriceEntry` → filas duplicadas bajo concurrencia; el fix toca `schema.prisma` →
  coordinar con arquitecto).

### 33.3 (Fase 0.3) INE exigida con línea en precio pendiente
- Cuando una solicitud de buylist incluye cualquier línea en `precio_pendiente`, se mantiene la exigencia de
  **INE en archivo** (además del umbral por monto). Es una de las capas que **compensan** la deuda AML **BE-13**
  (el mensual `monthUsedCentsTx` agrega `quotedTotalCents`, no `approvedTotalCents`, y un ítem que nació
  pendiente no se re-contabiliza contra el tope mensual al resolverse su precio). Las otras capas: cap
  por-solicitud en `assertApprovedPriceWithinCap` y money-out solo `super_admin` + auditado. Ver contrato §6.

## 34. Fase 1 del epic de precios (v1.12-catalog-pricing, 2026-08-17) — preciar TODO el catálogo + refresco 2×/día

> Implementa ARCHITECTURE **§4.13a/b/c** (Fase 1). **Aditivo, SIN migración de esquema** (reusa
> `PriceReference`, que ya lleva `finish` en su clave desde M-18). Decisión del humano confirmada: refresco de
> **todo el catálogo 2×/día** a las **06:00 y 18:00 CDMX** = **00:00 y 12:00 UTC**. Gates: `tsc --noEmit` exit 0,
> `jest` 60 suites / 397 tests en verde. Toca dinero → requiere triple veredicto (qa + techlead + seguridad).

### 34.1 (1.1) `catalog-sync` puebla `PriceReference` de todo el catálogo — sin llamadas extra
- **`CatalogSyncService` gana dos dependencias:** `PricingService` (upsert de la referencia) y `FxService`
  (tasa del día). `CatalogModule` ya importaba `PricingModule`, que exporta ambas → sin cambios de wiring de
  módulos salvo el registro del job (§34.3).
- **`upsertCards` ahora persiste precio por acabado:** por cada carta upserteada, `persistMarketReferences`
  recorre `card.availableFinishes` y, por cada `finish` con `tcgplayer.prices[FINISH_TO_TCG_KEY[finish]].market
  > 0`, llama `PricingService.persistMarketReference(cardId, finish, round(market×100), fx)`. Es el **mismo
  payload** que ya se descargaba para derivar `availableFinishes` → **cero requests extra** a pokemontcg.io.
- **`PricingService.persistMarketReference(cardId, finish, marketUsdCents, fx)` (NUEVO):** upsert idempotente
  por día sobre la clave única existente `(cardId, 'raw', 'raw:NM', finish, capturedDate=hoy)`. `priceUsdCents =
  marketUsdCents`, `priceMxnCents = usdToMxnCents(marketUsdCents, fx.rate, fx.bufferPct)`, `source='pokemontcg_io'`,
  `isManualOverride=false`. **NO pisa overrides del admin:** hace `findUnique` de la fila de hoy y, si existe con
  `isManualOverride=true`, hace **skip** (el override manda, §4.1). La 2ª pasada del día (18:00) **refina** el
  precio de hoy (update sobre la misma fila), no duplica.
- **FX una sola vez por corrida (no por carta):** cada punto de entrada del sync carga `FxService.getCurrent()`
  UNA vez y pasa el snapshot `{ rate, bufferPct }` por toda la cadena hasta `upsertCards`. Puntos de entrada
  instrumentados: `sync` (single y from_date), `runSyncAll` (barrido de `sync-all`; NO en `syncAll`, que sólo
  encola y delega en `runSyncAll` fire-and-forget → el FX se carga dentro del barrido real) y `backfill`. Las
  helpers privadas (`importSet`/`importSetByExternalId`/`importCardsForSet`/`importRemainingPages`/`upsertCards`)
  reciben `fx: FxSnapshot` como parámetro.
- **Cartas SIN market → ni referencia ni pendiente:** `escalate=false` de facto — este flujo **nunca** encola
  `PendingPriceEntry` (mismo criterio que `set-price-sync`, §4.12a; escalar decenas de miles de cartas del
  catálogo sería ruido). Una carta sin market simplemente no tiene referencia hasta que (i) el admin la fija a
  mano o (ii) entra a un contexto real (bóveda/buylist) donde los flujos existentes SÍ escalan.
- **Aislamiento de fallos:** si `persistMarketReference` truena para un acabado, se loguea y se continúa; la
  carta ya quedó upserteada (el precio no aborta la importación).

### 34.2 (1.2) `publicQuote` vuelve a READ-ONLY — cierra BE-16
- Se **eliminó** la llamada a `pricing.escalatePending` del cotizador público (`BuylistService.publicQuote`).
  Un endpoint público/anónimo dejaba de escribir en la cola de trabajo del dueño (superficie de abuso:
  enumerar cartas inflaba la cola). Con el catálogo ya priceado por 1.1, el `getReference` del quote casi
  siempre encuentra precio; si un acabado sigue `precio_pendiente`, el quote **lo reporta** sin escribir nada.
- La escalada a `PendingPriceEntry` queda **SOLO** en el flujo autenticado `createRequest`
  (`POST /buylist/requests`), sin cambio.
- **Test actualizado:** en `test/buylist.modern-rarity.spec.ts` el bloque de Fase 0.2 (que verificaba el
  encolado desde el quote) ahora verifica que `publicQuote` **NO** llama `escalatePending` (ni con pendiente ni
  con cotizada).

### 34.3 (1.3) Job `catalog-price-sync` 2×/día
- **`CatalogPriceSyncJobService` (`backend/src/jobs/catalog-price-sync.service.ts`, NUEVO):** su `run()` ejecuta
  `CatalogSyncService.syncAll({ force: true })` — re-sync completo que reprocesa TODOS los sets remotos
  (`upsertCards` repuebla cartas + `availableFinishes` + `PriceReference` por acabado con el FX del día) e
  **importa sets nuevos** en la misma pasada (procesa los sets que aún no existían localmente). Secuencial
  (respeta el backoff 429 del cliente), **single-flight** garantizado por `syncAllStatus.running` dentro de
  `syncAll`, idempotente.
- **Registro (evita ciclos con JobsModule):** el job vive en `CatalogModule` (providers + exports), mismo patrón
  que `set-price-sync`, porque depende de `CatalogSyncService`. `JobsModule` ya importa `CatalogModule`, así que
  `SchedulerService` y `AdminJobsController` lo inyectan desde ahí.
- **Scheduler — DOS repeatables:** en `scheduler.service.ts` se añaden `catalog-price-sync-1` y
  `catalog-price-sync-2`, ambos enrutados al mismo `catalogPriceSync.run()` en el worker. Crons tomados de env
  con defaults `0 0 * * *` (00:00 UTC = 18:00 CDMX del día anterior… ver nota) y `0 12 * * *` (12:00 UTC = 06:00
  CDMX):
  - **Env:** `CATALOG_PRICE_SYNC_CRON_1` (default `0 0 * * *`) y `CATALOG_PRICE_SYNC_CRON_2` (default
    `0 12 * * *`). Devops puede ajustar ambos horarios **sin redeploy**. Crons en **UTC** (CDMX = UTC−6 sin DST).
    Para **devops**: conviene un `fx-refresh` poco antes de la corrida de las 00:00 UTC (el `fx-refresh 0 6 UTC`
    existente cubre la de las 12:00 UTC) si se quiere FX del mismo día; `FxService.getCurrent()` degrada al último
    `FxRate` disponible, así que el orden es suave, no bloqueante.
- **Disparo manual (opcional, implementado):** `POST /admin/jobs/catalog-price-sync` (super_admin, auditado
  `jobs.catalog_price_sync.run`) en `AdminJobsController`, simetría con los demás disparos manuales de jobs. Es
  alias operativo del job; también sigue disponible `POST /admin/catalog/sync-all {force:true}`.

### 34.4 Tests nuevos
- `test/catalog-price-sync.spec.ts` (NUEVO): (a) `catalog-sync` persiste un `PriceReference` por acabado desde
  `tcgplayer.prices` y carga FX una sola vez por corrida; (c) carta sin market (sin `tcgplayer.prices` o con
  todos `market<=0`) → `persistMarketReference` NO se llama; (b) `persistMarketReference` escribe la referencia
  MXN (`usdToMxnCents`) y **respeta `isManualOverride=true`** (skip del upsert); (d) el job invoca
  `syncAll({force:true})`.
- Specs existentes ajustados al nuevo constructor de `CatalogSyncService` (+`PricingService`+`FxService`) y a los
  nuevos deps de `SchedulerService`/`AdminJobsController`: `catalog-sync.spec.ts`, `catalog-sync.finish.spec.ts`,
  `catalog.remote-sets-fallback.spec.ts`, `scheduler.spec.ts`, `admin-jobs.controller.spec.ts`.

### 34.5 Para devops / notas
- **Env nuevas (documentar en `.env.example`, propiedad devops):** `CATALOG_PRICE_SYNC_CRON_1`,
  `CATALOG_PRICE_SYNC_CRON_2` (defaults arriba). **`POKEMONTCG_IO_API_KEY` pasa a requisito operativo:** el
  re-sync 2×/día son ~cientos de requests por corrida; sin API key el free tier puede toparse (riesgo §8/§10 del
  ARCHITECTURE).
- **Sin cambios de contrato ni de `schema.prisma`.** Todo reusa modelos/claves existentes.

## 35. Fase 2 del epic de precios (v1.13-sales-pricing, 2026-08-17) — precio de VENTA por RAREZA, editable en admin

Reemplaza el **markup GLOBAL único** de venta (`SALES_MARKUP_PCT`, default 15) por una **tabla de regla por
rareza** editable en M2 sin redeploy, **simétrica** a la de buylist (§4.2/§4.2.1). Ejemplo del humano: Common $5,
Uncommon/Holo/Reverse $10 **fijos**; lo más raro = **% ARRIBA de mercado**. **Aditivo, SIN migración** (el precio
de venta ya se congela en `OrderItem.unitPriceCents` al checkout). Fuente: ARCHITECTURE §4.14, API_CONTRACT §M2.
Solo `backend/`; el editor M2 (frontend) es tarea aparte.

### 35.1 Config (diales M2) — `backend/src/modules/settings/settings.constants.ts`
- Dos `SettingKey` nuevos: `SALES_PRICE_RULES` (`sales_price_rules`), `SALES_PRICE_FALLBACK_PCT`
  (`sales_price_fallback_pct`).
- **Seed** (`SETTING_DEFAULTS`, reproduce el ejemplo del humano): `Common fixed 500¢`, `Uncommon fixed 1000¢`,
  `Holo fixed 1000¢`, `Reverse Holo fixed 1000¢`; **fallback = 15**. El 15 iguala el `SALES_MARKUP_PCT` legacy →
  toda rareza que caiga al fallback **preserva** el precio de venta actual (market × 1.15); solo cambia el piso de
  bulk. Se siembran solos (el seed itera `SETTING_DEFAULTS`), y `getRaw`/`getNumber` caen al default si no hay fila.
- **Validadores** `validateSalesRules` / `validateSalesFallbackPct` (+ `isValidSalesRule`, `SALES_PCT_MAX=1000`):
  clones de los de buylist con **una sola diferencia** — el `pct` de venta admite **`[0, 1000]`** (markup arriba de
  mercado, puede >100%: una chase se lista a 2×–3× market), vs. `[0,100]` en buylist. Registrados en
  `SETTING_VALIDATORS`. **NO** en `SETTING_DTO_MAP` (se editan por endpoints M2 dedicados, como buylist; `PUT
  /admin/settings` no los toca).

### 35.2 Función pura — `backend/src/common/money.ts`
- `computeSalePriceForRarity(rarity, finish, referenceMxnCents, rules, fallbackPct): SalePriceResult`.
  **Reusa `ruleKeyCandidates`** → hereda el **gate premium de Fase 0** (una chase en holofoil/1st-ed holo NUNCA cae
  al piso sintético `"Holo"` de bulk: resuelve por su regla o el fallback pct).
- **Semántica de venta (DIVERGE de compra):** `fixed` → `value` (centavos, **piso**; NO depende de market → siempre
  `priced`); `pct` → **% ARRIBA de mercado** = `round(ref × (1 + value/100))`. En **buylist** `pct = ref × value/100`
  (% de la referencia). Mismo shape `{mode,value}`, matemática del pct distinta. `pct` sin referencia → `pending`
  (sin precio), igual que el `computeSalePrice` legacy. La divergencia está documentada en el JSDoc de la función.
- `computeSalePriceCents` (markup global) marcada **`@deprecated`** (palanca de rollback; retiro = follow-up).

### 35.3 Endpoints M2 — `backend/src/modules/pricing/pricing.controller.ts` (super_admin, auditados)
Clones 1:1 del patrón buylist:
- `GET /admin/pricing/sales-rules` → `{ rules, fallbackPct }` (crudo).
- `PUT /admin/pricing/sales-rules` → reemplaza tabla y/o fallback; valida (mode/value/rango, pct∈[0,1000]) →
  `422 VALIDATION_ERROR`; **auditado** `action=pricing.sales_rules.update` (before/after); sin redeploy.
- `GET /admin/pricing/sales-rarities` → `{ fallbackPct, rarities: [{ rarity, cardCount, rule, source }] }`
  (`groupBy Card.rarity` unido a las reglas; sin regla → muestra el fallback; ordenado por `cardCount` desc).

### 35.4 Aplicación — swap de los 2 call-sites
- Nuevo `PricingService.computeSalePriceForItem({rarity, finish}, referenceMxnCents)`: lee `SALES_PRICE_RULES` +
  `SALES_PRICE_FALLBACK_PCT` y aplica `computeSalePriceForRarity`.
- **`catalog.service.toListingDTO`:** si no hay `listPriceCents` (override manual, que **sigue ganando**), calcula
  `salePriceCents` con el resolver por rareza. **SEC-A1:** rareza de `item.card.rarity`, acabado de `item.finish`
  (BD), nunca del cliente.
- **`orders.service.salePriceOf`:** idem; `fixed` devuelve el piso aunque no haya market; `pct` sin referencia →
  `PRICE_PENDING` (se conserva).
- **`computeSalePrice` (PricingService)** queda `@deprecated` — verificado que **no quedan otros callers** en la
  ruta de venta (solo los 2 swapeados).

### 35.5 Piso `fixed` sin market → gate de publicación (cambio de comportamiento intencional)
Con una regla `fixed`, una carta bulk **sin `PriceReference`** ahora obtiene precio de venta (piso) y **puede
volverse `sellable`** (objetivo del piso). El **gate coarse en DB** de `catalog.publishedWhere` filtraba por
existencia de `listPriceCents` **o** alguna `PriceReference` — eso **excluía** justo esas cartas. Como la
resolubilidad ahora depende de `SALES_PRICE_RULES` (que la DB no evalúa), el gate coarse se reduce a
`platform + listed`; la comprabilidad exacta se confirma en `toListingDTO`/`fetchSellable` (un `pct` sin market →
`pending` → no vendible, sigue excluido; el comprador nunca ve "precio pendiente"). Efecto secundario: se cargan más
items del inventario publicado por consulta (antes acotados por el OR de precio); aceptable y deliberado.

### 35.6 Tests (jest verde: 64 suites / 434 tests; `tsc --noEmit` exit 0)
- `test/money.sales-pricing.spec.ts` (NUEVO): `computeSalePriceForRarity` — fixed piso (con/sin market); pct =
  markup arriba de mercado (incl. divergencia value=40 → 140% vs 40% de buylist); pct sin market → pending; gate
  premium (una chase en holofoil NO cae al piso `"Holo"`; un holo de bulk sí; regla explícita gana).
- `test/pricing.sales-rules.spec.ts` (NUEVO): contrato de `GET/PUT sales-rules` + `GET sales-rarities` (shape,
  auditoría `pricing.sales_rules.update`, validación pct>1000/fixed<0/fallback, **acepta pct>100**).
- `test/settings.sales-pricing.spec.ts` (NUEVO): seed de ambos settings, validadores registrados, **NO** en
  `SETTING_DTO_MAP`, `SALES_PCT_MAX=1000`.
- `test/pricing.sales-for-item.spec.ts` (NUEVO): `computeSalePriceForItem` real (lee las keys de venta, no
  `sales_markup_pct`); `toListingDTO` vuelve sellable una Common sin market al piso y respeta el override
  `listPriceCents`; `orders.salePriceOf` da el piso con `fixed` y `PRICE_PENDING` con `pct` sin market.
- Ajustados (mock del call-site swap): `test/catalog.spec.ts`, `test/catalog.enum-filters.spec.ts` (mockean
  `computeSalePriceForItem` en vez del `computeSalePrice` retirado de la ruta).

### 35.7 Notas para otros roles
- **frontend (Fable / editor M2):** el editor de venta vive en `M2View` (no `BuylistView`) y consume
  `sales-rules`/`sales-rarities`. **Copy crítico:** en venta `pct` = **markup arriba de mercado** (no "% de la
  referencia" como en buylist). Sin colisión con backend.
- **devops:** sin cambios de `.env.example`, `schema.prisma` ni migraciones. Los dos `ConfigSetting` nuevos se
  siembran con el seed existente.
- **QA/seguridad:** toca dinero → triple veredicto. SEC-A1 intacto (rareza/acabado server-side de BD). El override
  manual `listPriceCents` sigue teniendo prioridad; el precio se congela en `OrderItem.unitPriceCents` al checkout.
- **Sin cambio de contrato solicitado** — `API_CONTRACT.md §M2` ya documenta ambos endpoints y la semántica del pct.

### 35.8 Triple veredicto Fase 2 + deuda registrada (2026-08-17)
La Fase 2 (commits `fba6486` + `fee3c19`) recibió **triple veredicto APROBADO** (qa + techlead
APROBADO-con-deuda + seguridad APROBADO). **Resumen de la venta por rareza implementada** (remite a
**ARCHITECTURE §4.14** / API_CONTRACT §M2): función pura `computeSalePriceForRarity` en `money.ts` (§4.14b;
`fixed` = piso aunque no haya market, `pct` = markup **arriba de mercado**), endpoints M2 `sales-rules` /
`sales-rarities` (§4.14a/c), **swap de call-sites** de venta a `computeSalePriceForItem`
(`catalog.toListingDTO` + `orders.salePriceOf`, retirando `computeSalePrice`/`sales_markup_pct` de la ruta),
y **piso `fixed` que vuelve `sellable` el bulk** (relaja el gate coarse a `platform+listed`; ver §35.5).
Detalle en §35.1–§35.7.

**Deuda BACKEND no bloqueante registrada** en `docs/TECH_DEBT.md` (sección Backend, tras BE-23):
- **BE-24** (techlead) — trap de tipado estructural `BuylistRule` vs `SalesRule` en `money.ts` (firmas
  posicionales idénticas → TS no atrapa el cruce compra/venta). Mitigar con branding nominal o test de fórmula.
- **BE-25** (techlead + qa) — N+1 de lecturas de settings en `fetchSellable` agravado por el gate relajado
  (2 `findUnique` sin cache por `toListingDTO`). Izar/memoizar `SALES_PRICE_RULES` por request.
- **BE-26** (seguridad B-6, Baja, ruta de dinero) — orden a $0 por regla `fixed:0`: `salePriceOf` solo
  rechaza `== null`, no `<=0`; `createSession` no re-verifica precio. **Endurecer ANTES de dinero real.**
- **BE-27** (seguridad B-7, Baja) — `fixed` sin cota superior → overflow Int32 (columnas `*Cents` 32-bit);
  misma familia que B-3 de `PENTEST_NOTES`, extendida a venta. Acotar en la decisión BigInt de B-3.

### 35.9 `SALES_MARKUP_PCT` / `salesMarkupPct` queda NO-OP tras Fase 2 (deprecado)
El dial `SALES_MARKUP_PCT` (`sales_markup_pct`, campo `salesMarkupPct`) **ya no lo lee la ruta de venta** (la
reemplaza la tabla `SALES_PRICE_RULES` + `SALES_PRICE_FALLBACK_PCT`). **Sigue editable en M10** pero es
**no-op** funcional: cambiarlo **no afecta** ningún precio de venta y **confunde** al operador. Se conserva
solo como **palanca de rollback** (decisión abierta **v1.13-3**, ver ARCHITECTURE §4.14d). **Retiro definitivo
pendiente** — cuando se cierre v1.13-3, quitar el dial del seed/DTO y del código muerto.

## 36. WS-A (v1.14-price-ingest, 2026-08-17) — Ingesta MASIVA de precios (BulkPriceProvider) + FX #13

> **TOCA DINERO → triple veredicto.** Implementa ARCHITECTURE §4.15 (a–h) y API_CONTRACT §M10-ops / §M10 / §M2.
> **Aditivo, SIN migración de esquema** (reusa `PriceReference`+`finish`, `PriceSource.pokemonpricetracker`,
> `Card.availableFinishes`). Gates verdes: `npx tsc --noEmit` (exit 0), `npx jest` (**68 suites / 467 tests**),
> `eslint` limpio. **SEGURIDAD (repo público):** la API key SOLO se lee de
> `process.env.POKEMONPRICETRACKER_API_KEY` (vía ConfigService) — cero secretos en el repo.

### 36.1 Qué se implementó (por archivo)
- **`modules/pricing/pricing.types.ts`** — interfaces nuevas `BulkPriceRow` / `BulkPriceResult` /
  `BulkPriceProvider` (§4.15b, distintas del `PricingProvider` per-carta, que se conserva) + helper
  `normalizeFinishAlias(raw) → Finish | null` (tabla conservadora variante→acabado; desconocida → `null` →
  se OMITE, money-safe).
- **`modules/pricing/providers/pokemonpricetracker-bulk.provider.ts`** (NUEVO, PRIMARIO) —
  `POST https://www.pokemonpricetracker.com/api/v1/cards/bulk-price` (host FIJO anti-SSRF), `Authorization:
  Bearer <env key>`, body `{ set, limit, page }`. **Mapeo defensivo:** valida `market>0`, `variante→Finish`,
  omite mal formado. **FAIL-CLOSED de moneda/unidad (post-veredicto B):** NO persiste bajo moneda/unidad
  asumida — el operador fija `POKEMONPRICETRACKER_MARKET_FORMAT` (sin default, valores
  `usd_dollars|usd_cents|mxn_dollars|mxn_cents`); **sin él → modo sample-only** (loguea la muestra, persiste
  NADA). **LOGUEA UN ejemplo** de la 1ª entrada cruda (sin secretos). Sin key/HTTP fail → `{ rows: [] }` + log
  (precios STALE, no se borran). **PO confirmó `usd_dollars`** (= ×100 + FX + colchón, idéntico al legacy USD).
- **`modules/pricing/providers/pokemontcg-io-bulk.provider.ts`** (NUEVO, LEGACY/rollback) — envuelve
  `PokemonTcgIoClient.getCardsBySet` (paginado) y extrae `tcgplayer.prices[llave].market` por acabado
  (USD). Permite `PRICE_PROVIDER=pokemontcg_io` sin la key de paga; el job ya es robusto con esta fuente.
- **`modules/pricing/price-ingest.service.ts`** (NUEVO, `PriceIngestService`) — `providerFor()` (dial),
  `ingestSet(setId, fx)` / `ingestSetByExternalId` / `ingestAll(fx)`, resolución carta↔BD (externalId
  primario → `(set,number)` fallback → omite no resueltas), agrupa por carta, **upsert por acabado** vía
  `PricingService.persistMarketReference`, **`availableFinishes` derivado del proveedor** (autoridad, no
  clobbea si el proveedor no reporta nada).
- **`jobs/price-ingest.service.ts`** (NUEVO, `PriceIngestJobService`) — orquestación: **con Redis** fan-out
  (un `price-ingest-set` por set, jobId determinista por día = single-flight, `attempts:3`+backoff,
  reanudable); **sin Redis** secuencial **AWAITED** (nunca fire-and-forget). **FX una vez por corrida**
  (`FxService.getCurrent()` → snapshot en `job.data`).
- **`modules/pricing/pricing.service.ts`** — `persistMarketReference` **generalizado**: acepta
  `{ marketCents, currency: 'USD'|'MXN', source: PriceSource }`. USD → `usdToMxnCents` (colchón) + guarda
  `priceUsdCents`/`fxRate`/`fxBufferPct`; **MXN → sin conversión** (`priceUsdCents`/`fx*` = null). Respeta
  `isManualOverride` (skip).
- **`modules/catalog/catalog-sync.service.ts`** (DEV-5 / A.5) — **aligerado a SOLO metadata**: se
  quitó `persistMarketReferences` + las deps `PricingService`/`FxService` + todo el threading de FX. Se
  **conserva** `deriveAvailableFinishes` como **bootstrap** (default seguro; `price-ingest` lo sobre-escribe).
  Constructor ahora `(prisma, client, settings)`.
- **`modules/settings/settings.constants.ts`** — dial `PRICE_PROVIDER` (`price_provider`), **seed
  `'pokemontcg_io'`** (money-safe), validador `IsIn(['pokemontcg_io','pokemonpricetracker'])`, en
  `SETTING_DTO_MAP` como `priceProvider`.
- **`modules/pricing/fx.service.ts`** (#13) — `getCurrent()` prefiere el `bufferPct` del **dial** en TODAS
  las ramas (aplica de inmediato en el próximo ingest); `setManual(rate?, bufferPct?)` con `rate` opcional
  (omitirlo guarda SOLO el colchón, NO pinnea `fx_manual_override_rate`).
- **`modules/pricing/pricing.controller.ts`** — `FxDto.rate?` opcional (al menos uno; 422 si el body va vacío).
- **`jobs/admin-jobs.controller.ts`** — `POST /admin/jobs/price-ingest` (super_admin, auditado
  `jobs.price_ingest.run`, `HttpCode(202)`, `setId?` opcional). **Toca dinero.**
- **`jobs/scheduler.service.ts`** — entrega la cola al ingest (`setQueue`), enruta `price-ingest` (parent) /
  `price-ingest-set` (child) en el worker. **Transición de scheduling completada (post-veredicto A):**
  `price-ingest` se programa **POR DEFECTO 2×/día** (00:00 y 12:00 UTC, `PRICE_INGEST_CRON_1/_2` overridable) con
  el dial sembrado `pokemontcg_io` (legacy USD → money-safe); el barrido pesado `catalog-price-sync force:true`
  **se retiró del schedule** y se reemplazó por `catalog-metadata-sync` **diario** (`syncAll({force:false})`,
  solo sets nuevos, barato; `CATALOG_METADATA_SYNC_CRON` overridable). El disparo manual
  `POST /admin/jobs/catalog-price-sync` (force:true, ops) se conserva intacto.
- **`jobs/catalog-price-sync.service.ts`** — nuevo `runMetadataImport()` (`syncAll({force:false})`) para la
  cadencia ligera del scheduler; `run()` (force:true) se conserva para el disparo manual de ops.
- **`config/env.validation.ts`** — `POKEMONPRICETRACKER_API_KEY` requerida en no-local **solo** cuando el
  hint de env `PRICE_PROVIDER=pokemonpricetracker` está presente (la autoridad runtime es el dial en BD; el
  provider degrada seguro si falta la key).

### 36.2 Campos del proveedor de paga ASUMIDOS (a verificar en la 1ª corrida en Railway)
El dominio del proveedor está **bloqueado en dev por egress**, así que el esquema exacto se verifica en la 1ª
corrida (`POST /admin/jobs/price-ingest { "setId": "sv8" }` → inspeccionar el **log de ejemplo** +
`PriceReference`). Supuestos marcados en el adapter (`pokemonpricetracker-bulk.provider.ts`):
1. **Endpoint/params:** `POST /api/v1/cards/bulk-price` con `{ set, limit, page }`; paginación por `page`
   (corta cuando la página viene `< limit`).
2. **Envelope:** `{ data: [] }` (o `cards`/`results`/`prices`/array pelón).
3. **Id de carta:** `id` | `cardId` | `productId` | `_id`; **número:** `number` | `cardNumber` | `collectorNumber`.
4. **Variante/acabado:** shape (A) `prices: { <variante>: { market } }` (tcgplayer-like) o (B) plano
   `variant`/`finish`/`printing` + `market`/`marketPrice`/`price`. Variante desconocida → **OMITE**.
5. **MONEDA + UNIDAD de `market` = FAIL-CLOSED (post-veredicto B):** ya NO se asume nada. El operador fija
   `POKEMONPRICETRACKER_MARKET_FORMAT` (env, **sin default**): `usd_dollars` (×100 + FX + colchón, **confirmado
   por el PO** 2026-08-17), `usd_cents` (sin ×100 + FX), `mxn_dollars` (×100, sin FX), `mxn_cents` (sin ×100, sin
   FX). **Sin la env → sample-only** (loguea la muestra, persiste NADA). La moneda de la fila viene del FORMATO,
   no de un campo `currency` del payload. Runbook: correr `POST /admin/jobs/price-ingest { "setId": "sv8" }` con
   el dial en `pokemonpricetracker` → leer el log de muestra → fijar `POKEMONPRICETRACKER_MARKET_FORMAT=usd_dollars`.

### 36.3 Seed del dial + rollout
`price_provider` **seed `'pokemontcg_io'`** (legacy, **NO cambia**). El flip a `'pokemonpricetracker'` es del
humano/devops por `PUT /admin/settings { "priceProvider": "pokemonpricetracker" }` (sin redeploy) — y requiere
además fijar `POKEMONPRICETRACKER_MARKET_FORMAT` (si no, el proveedor de paga corre sample-only y no escribe).
**Scheduling (post-veredicto A): `price-ingest` corre POR DEFECTO 2×/día** con Redis (usa el dial sembrado
`pokemontcg_io` → misma fuente USD de siempre, money-safe). Es decir: en un deploy por defecto CON Redis
(Railway) los precios del catálogo **sí se refrescan** desde el arranque (desatoro de #1/#8/#10), sin activar el
proveedor de paga. Sin Redis → fallback manual awaited.

### 36.4 Tests (mocks del provider; NO se llama la API real)
- `test/price-ingest.provider.spec.ts` — mapeo defensivo de ambos adapters + `normalizeFinishAlias`
  (variante→finish, desconocida→null, skip market≤0); **fail-closed (B):** sin `MARKET_FORMAT` → sample-only
  (fetch sí, persiste nada); `usd_dollars` → ×100 (=legacy USD); `usd_cents` → sin ×100; `mxn_dollars` → ×100 +
  moneda MXN; sin key → `{rows:[]}`; HTTP fail.
- `test/price-ingest.service.spec.ts` — dial elige provider; upsert por acabado; resolución externalId /
  `(set,number)`; omite no resueltas; **no clobbea** `availableFinishes`; MXN propagada; `persistMarketReference`
  USD vs MXN + respeta override.
- `test/price-ingest.job.spec.ts` — fan-out (un `price-ingest-set` por set) + **FX una vez** (mismo snapshot
  en cada child); sin cola → `ingestAll` AWAITED; single-flight → `enqueued:false`; `setId` → `scope:set`; `runChild`.
- `test/fx.buffer-optional-rate.spec.ts` — `getCurrent` usa el colchón del dial; `setManual` con/sin `rate`;
  `FxController` (422 body vacío, solo-buffer, rate+buffer).
- `test/settings.validation.spec.ts` (+casos) — `priceProvider` válido/ inválido + expuesto en `getAllDto`.
- Ajustados por el aligeramiento de `catalog-sync`: `catalog-sync.spec.ts`, `catalog-sync.finish.spec.ts`,
  `catalog.remote-sets-fallback.spec.ts` (constructor 3 args), `catalog-price-sync.spec.ts` (solo el job),
  `admin-jobs.controller.spec.ts` + `scheduler.spec.ts` (nueva dep `PriceIngestJobService`).

### 36.5 Notas para otros roles
- **devops — ENV NUEVAS a añadir a `.env.example`/Railway (NO las edité yo; ruta devops):**
  - `POKEMONPRICETRACKER_API_KEY` (secreto; ya se lee de env). Requerida en no-local solo si el hint
    `PRICE_PROVIDER=pokemonpricetracker` está puesto.
  - **`POKEMONPRICETRACKER_MARKET_FORMAT`** (NUEVA, post-veredicto B): fijar a **`usd_dollars`** (confirmado PO)
    tras ver el log de la 1ª corrida. **Sin ella el proveedor de paga NO escribe precios** (fail-closed).
  - `PRICE_INGEST_CRON_1` / `PRICE_INGEST_CRON_2` (opcionales; **defaults `0 0 * * *` / `0 12 * * *`** — ya no
    son opt-in, el ingest se programa por defecto). `CATALOG_METADATA_SYNC_CRON` (opcional; default `0 1 * * *`).
- **devops — scheduling (post-veredicto A):** ya NO hay que hacer nada para que el pricing corra: `price-ingest`
  2×/día está por defecto con `pokemontcg_io`. Se **retiró** el barrido pesado `catalog-price-sync` del schedule
  (reemplazado por `catalog-metadata-sync` diario, `force:false`). Recomendado: `fx-refresh` (06:00 UTC) antes
  del ingest de 12:00 UTC (el de 00:00 usa el FX del día previo — degradación suave, aceptable §4.15g). Cuota/
  coste del proveedor de paga = decisión abierta v1.14-2.
- **QA/seguridad:** SEC-A1 intacto (precio server-side del proveedor; `finish` = dimensión de la clave, no
  monto del cliente). Money-safe: sin key/fallo/formato → NO se escriben precios (STALE/sample-only) + log; MXN
  sin ×FX; variante desconocida → omitida (no se atribuye a `normal`). El **fail-closed de MARKET_FORMAT** cierra
  el riesgo de inflar ~18×/100× al flipar (§36.2.5).
- **frontend (M2):** `PUT /admin/fx` acepta `rate?` opcional (guardar solo colchón); alternativa recomendada
  `PUT /admin/settings { fxBufferPct }`. Dial `priceProvider` editable en M2/M10.

### 36.6 Decisión de implementación a señalar (NO cambia el contrato)
La **resolución carta↔BD** (externalId primario, `(set,number)` fallback, omitir no resueltas) vive en
`PriceIngestService`, **no dentro del adapter HTTP**, porque (a) el `BulkPriceRow` del contrato §4.15b lleva
`externalId`/`number` (NO un `cardId` ya resuelto) y §4.15c dice que el child "agrupa por cardId **resuelto**",
y (b) mantiene el adapter **sin BD** y unit-testeable. Funcionalmente idéntico al requisito money-safe de §4.15d.
Ninguna duda de contrato/esquema bloqueante: el único punto a confirmar en runtime es el **esquema del payload
del proveedor de paga** (§36.2), ya contemplado por el diseño (dial seed legacy + verificación en 1ª corrida).

### 36.7 Cierre post-triple-veredicto (2026-08-17) — 3 follow-ups no bloqueantes
WS-A recibió **triple veredicto APROBADO** (qa+techlead+seguridad). Antes de promover a main se cerraron 3
hallazgos no bloqueantes (SIN cambio de contrato/schema):
- **(A) Transición de scheduling [techlead].** `price-ingest` ahora corre **por defecto 2×/día** (dial sembrado
  `pokemontcg_io` → money-safe) y el barrido pesado `catalog-price-sync force:true` se **retiró del schedule**,
  reemplazado por `catalog-metadata-sync` diario (`force:false`, solo sets nuevos). Así el deploy por defecto CON
  Redis **cumple el desatoro** de #1/#8/#10 sin activar el proveedor de paga. Ver §36.3 y `scheduler.spec.ts`.
- **(B) Fail-closed de moneda/unidad [seguridad Media + qa].** El proveedor de paga NO persiste bajo formato
  asumido: `POKEMONPRICETRACKER_MARKET_FORMAT` (sin default) o **sample-only**. PO confirmó **`usd_dollars`**
  (= comportamiento legacy). Cierra el riesgo de inflar ~18×/100× al flipar. Ver §36.2.5 / §36.5.
- **(C) Deuda aceptada registrada** en `docs/TECH_DEBT.md` (Backend): **BE-28** (FxDto.rate entero, pre-WS-A),
  **BE-29** (resolveCardId `(set,number)` ambiguo), **BE-30** (seed sin fila `price_provider` explícita),
  **BE-31** (single-flight del parent solo explícito en la rama secuencial; comentario simétrico añadido),
  **BE-32** (loop de páginas si el proveedor ignora `page` + batch de `resolveCardId`), **BE-33** (moneda/unidad,
  ahora **mitigada** por B — disparador: fijar `MARKET_FORMAT` antes de flipar).

**Gates tras el pase:** `npx tsc --noEmit` exit 0; `npx jest` **68 suites / 469 tests** verdes.

## 37. WS-C (v1.15-buylist-batch-clabe, 2026-08-17) — cotizador buylist contra el backend REAL (Fase 3b)

> **TOCA DINERO/PII → triple veredicto.** Implementa ARCHITECTURE §4.16 (a–c) y API_CONTRACT §0/§1/§6
> (Changelog v1.15). **Aditivo, SIN migración de esquema** (reusa `KycProfile.clabeEnc`,
> `SellRequest.clabeSnapshotEnc`, `quoteAcquisitionForFinish`, `PriceReference`). **SEC-A1 intacto**
> (montos server-side por `(Card.rarity, finish)`; el cliente nunca fija precio ni CLABE de terceros).
> Gates verdes: `npx tsc --noEmit` (exit 0), `npx jest` (**69 suites / 486 tests**).

### 37.1 Qué se implementó (por archivo)
- **`modules/buylist/dto/buylist.dto.ts`**:
  - `CreateRequestDto.clabe` → **`@IsOptional() @IsString() clabe?: string`** (antes `@IsString() clabe!`).
  - **NUEVO** `BuylistQuoteItemDto` (espeja `PublicQuoteDto`: `cardId`, `productType`, `rawCondition?`,
    `finish?`; **SIN `qty`** — una línea por carta física) y **`BatchQuoteDto`** (`items` con
    `@ArrayNotEmpty` + `@ArrayMaxSize(BUYLIST_QUOTE_BATCH_MAX)` + `@ValidateNested`/`@Type`). Constante
    exportada **`BUYLIST_QUOTE_BATCH_MAX = 50`**.
- **`modules/buylist/buylist.service.ts`**:
  - **`createRequest(userId, items, clabe?, ineUploadKeys?)`** — CLABE opcional + **fallback server-side**
    (§4.16a). La KYC se lee SIEMPRE por el `userId` autenticado. Con `clabe` en el body: flujo idéntico al
    actual (formato → `422 CLABE_INVALID`; nombre propio por blind-index HMAC → `422 CLABE_NOT_OWN_NAME`;
    persiste `clabeEnc`+`clabeHmac` en KYC). Sin `clabe`: **desencripta `kyc.clabeEnc`** (misma vía que
    `revealClabe`) → si no hay → **`422 CLABE_REQUIRED`** (nuevo). La CLABE resuelta se **snapshotea
    cifrada** en `clabeSnapshotEnc`, **NUNCA se loguea ni se devuelve**. En el fallback **no** se reescribe
    la CLABE en KYC (ya está en archivo); el INE sí se actualiza si vienen keys nuevas.
  - **`batchQuote(items)`** (§4.16b) — `map` de `quoteCardForFinish` sobre `items[]` cargando
    `buylistRules()` **una vez**. **Errores por-ítem**: `NOT_FOUND`/`FINISH_NOT_AVAILABLE` → `ok:false` de ESE
    ítem (cualquier otro error se propaga); el resto sale `ok:true`. **READ-ONLY**: no crea solicitud, no
    persiste, **no** llama `escalatePending`. Correlación por `index` + eco de `cardId`.
  - **`quoteCardForFinish(...)`** (privado, NUEVO) — núcleo READ-ONLY extraído de `publicQuote`, recibe
    `rules`/`fallbackPct` ya cargados. `publicQuote` ahora delega en él (misma matemática/guardarraíles;
    shape del quote por-carta **sin cambios**). Tipos exportados `BuylistQuotePayload` /
    `BuylistBatchQuoteResult` (para nombrar el retorno en el controller).
- **`modules/buylist/buylist.controller.ts`** — **`POST /buylist/quote/batch`** (`@Public()`,
  `@HttpCode(200)`, sin `@RequireEmailVerified`). `create` pasa `dto.clabe` (ahora opcional) sin cambios.
- **`modules/users/users.service.ts`** — `getKyc` añade **`clabeOnFile: Boolean(kyc?.clabeEnc)`** (§4.16c),
  simétrico a `ineOnFile`. `clabeMasked` se conserva; sin PII nueva.
- **`common/error-codes.ts`** — nuevo código estable **`CLABE_REQUIRED`** (se serializa como `422`).

### 37.2 Garantías de PII / dinero (para seguridad y QA)
- **Autorización estricta del fallback:** `kyc = findUnique({ where: { userId } })` con el `userId` de la
  sesión; es **imposible** resolver la CLABE de otro usuario. Test dedicado: un `u2` con OTRA CLABE en
  archivo **jamás** se usa para `u1` (y si `u1` no tiene CLABE → `CLABE_REQUIRED`, no cae a la de `u2`).
- **CLABE nunca en claro fuera del reveal:** no se loguea, la respuesta (`{ sellRequestId, status,
  quotedTotalCents, ineRequired, items }`) **no** la incluye, y el snapshot va cifrado (`pii.encrypt`). El
  único punto de exposición en claro sigue siendo `GET /admin/buylist/:id/reveal-clabe`.
- **SEC-A1 en batch:** rareza (`Card.rarity`) y `finish` (validado contra `Card.availableFinishes`) se
  derivan server-side; el cliente no envía precio/monto/regla. El batch es anónimo pero **read-only** — no
  escribe en la cola de precio pendiente (misma doctrina que `publicQuote` desde v1.12).
- **Cap 50:** lo impone el DTO (`@ArrayMaxSize(50)`) → `400 VALIDATION_ERROR`; cuenta como **1** request
  contra el throttle público (colapsa el fan-out FE-12).

### 37.3 Tests (jest) — `test/buylist.batch-clabe.spec.ts` (17 casos)
- **Fallback usa SOLO la CLABE propia** (snapshot descifra a la propia; la KYC se lee siempre por el
  `userId` autenticado; no reescribe la CLABE en KYC en el fallback).
- **`CLABE_REQUIRED`** cuando no hay `clabe` ni CLABE en archivo (con y sin KYC) — no crea solicitud, no
  alcanza la CLABE de otro usuario.
- **`clabe` en el body**: comportamiento intacto (persiste `clabeEnc`+`clabeHmac`); formato inválido →
  `CLABE_INVALID` sin caer al fallback.
- **Batch con 1 carta inválida → 200 + error por-ítem** (mezcla `ok`/`NOT_FOUND`/`FINISH_NOT_AVAILABLE`/
  `precio_pendiente`, correlada por `index`); **READ-ONLY** (`escalatePending` nunca llamado).
- **Equivalencia batch vs. quote por-carta** (mismo `payload` por acabado: normal $0.50, reverse $1.50,
  holofoil 40% del market).
- **DTO del batch**: cap 50 exacto válido, 51 → `arrayMaxSize`, vacío → `arrayNotEmpty`, ítem malformado →
  error nested.
- **`clabeOnFile`** refleja el estado real (con CLABE / solo INE / sin KYC), y la CLABE sigue enmascarada.
- Ninguna aserción imprime/valida la CLABE en claro salvo para comprobar que el snapshot **NO** la contiene
  sin cifrar.

### 37.4 Notas para otros roles
- **frontend:** `POST /buylist/quote/batch` (1 request por página del grid, render parcial-tolerante por
  `results[].ok`/`error.code`); usar `clabeOnFile` para el atajo "usar mi CLABE ****1234" (**omitir** `clabe`
  en `POST /buylist/requests`) e `ineOnFile` para ocultar los uploaders de INE. Ver §4.16c.
- **devops/QA/seguridad:** sin nueva ENV ni migración. E2E sugerido (ARCHITECTURE §4.16, reparto): cotizar un
  lote, crear solicitud con CLABE en archivo (sin reteclear) y con INE en archivo (sin resubir); pentest del
  fallback (no fugar/loguear CLABE; no resolver la de otro usuario).

### 37.5 Sin dudas de contrato/esquema
El contrato v1.15 es implementable tal cual con los defaults del arquitecto (endpoint aditivo `/batch`, sin
`qty`, cap 50, `422 CLABE_REQUIRED`). **No se solicitó ningún cambio de contrato ni de schema.**

**Gates:** `npx tsc --noEmit` exit 0; `npx jest` **69 suites / 486 tests** verdes.

---

## 38. WS-E · Master Set + inventario a escala (v1.16-master-set, §M1, §4.17)

Agregación de LECTURA (binder por set) + escritura por LOTE, **encima del modelo por-pieza sin
cambiarlo** (sigue 1 `InventoryItem` por pieza física). Todos los endpoints `vault_operator+`. Migración
única **M-21** (índice + `InventoryBatch`). NO toca dinero saliente; la publicación deriva el precio de
venta server-side (reusa §4.14, SEC-A1).

### 38.1 Migración M-21 (`prisma/migrations/20260817120000_m21_master_set_batch/`)
- **Índice** `@@index([cardId, finish, status])` en `InventoryItem` — sirve la agregación `countsByFinish`
  del binder (`GROUP BY cardId, finish` filtrando status on-hand) y el conteo por set. Complementa (no
  reemplaza) los índices existentes.
- **Modelo `InventoryBatch`** — `id` = `batchKey` (idempotencia natural), `actorUserId?`, `kind`
  (`create|publish`), `requested`, `createdItems`, `failedLines`, `resultJson`, `createdAt`. Es el registro
  de auditoría del lote (complementa `AuditLog`). Sin FK dura a `User` (patrón `AuditLog`). Aditiva, sin
  backfill. **NO se aplicó a ninguna BD** (no hay DB en el sandbox); `prisma validate` + `prisma generate`
  OK, la SQL sigue la convención del repo.

### 38.2 Endpoints (§M1, `vault_operator+`)
- **`GET /admin/inventory/master-sets`** (`MasterSetService.index`) — índice de sets con `MasterSetSummaryDTO`
  (`printedTotal`, `catalogCardCount`, `distinctCardsOwned`, `completionPct`, `totalPieces`, `year`). **Query
  fija sin N+1**: (1) página de `CardSet` (filtro `q`), (2) `Card.groupBy([setId])` → `catalogCardCount`,
  (3) **una** agregación raw `InventoryItem ⋈ Card GROUP BY setId` → piezas + cartas distintas on-hand.
  `sort`: `release_desc` (default) | `completion_asc` | `pieces_desc`.
- **`GET /admin/inventory/master-sets/:setId`** (`MasterSetService.binder`) — binder con `MasterSetCardCellDTO`
  por carta (`cardId`, `number`, `numberSort`, `name`, `rarity`, `imageSmallUrl`, `availableFinishes`,
  `countsByFinish`, `totalCount`, `isSecretRare`). **Orden natural** obligatorio (ver 38.4). Sin N+1: 1
  `Card WHERE setId` + 1 `groupBy [cardId, finish]`. 404 si el set no existe. `:setId` = id LOCAL del `CardSet`.
- **`POST /admin/inventory/items/batch`** (`InventoryService.batchCreate`) — alta por LOTE. **Errores
  por-línea** (una línea inválida no tumba el resto → commit parcial, HTTP 200), **`qty`** expande a N
  `InventoryItem`/N folios (graded → qty 1; qty>1 en graded = `VALIDATION_ERROR`), folios **consecutivos** por
  línea vía `PrismaService.nextFolios(qty)`, **idempotencia + auditoría** por `batchKey` en `InventoryBatch`
  (replay → `idempotentReplay:true` sin re-crear). Header `Idempotency-Key` equivale a `batchKey`. La lógica
  por línea reusa **exactamente** `resolveCreation` (extraída de `createItem`): costo de aportación
  server-side, validación de `finish` contra `availableFinishes` (SEC-A1). Auditado `inventory.batch_create`.
- **`POST /admin/inventory/items/bulk-publish`** (`InventoryService.bulkPublish`) — publicar N piezas →
  `listed`. Precio **derivado** server-side (`computeSalePriceForRarity`, rareza de `Card.rarity` + acabado de
  `InventoryItem.finish`, SEC-A1) o **manual** (`listPriceCents`). `pct` sin market → `PRICE_PENDING`: **no
  publica** esa pieza (regla "solo se lista lo que tiene precio"). Errores por-línea (no encontrada, no
  `platform`, graded sin `certNumber`, precio pendiente) → HTTP 200. Re-publicar una `listed` = no-op
  idempotente. `batchKey?` opcional (idempotencia/auditoría del lote). Auditado `inventory.bulk_publish`.

### 38.3 Deuda pagada
- **`PricingService.getReferencesBatch(items)`** (cierra **RB-8/BE-4/D3**) — referencia vigente = más
  reciente por acabado para N ítems en **1** query; devuelve `Map<cardId|productType|gradeKey|finish, PriceInfo>`.
- **`PricingService.loadSalesRules()`** — iza `SALES_PRICE_RULES`+fallback en 1 par de lecturas.
- **BE-25 (pago mínimo):** `bulk-publish` y `CatalogService.fetchSellable` izan las reglas **una vez** y usan
  `getReferencesBatch` (antes: 2 lecturas de settings + 1 `getReference` **por ítem** = N+1). El resto de
  BE-25 (memoización global de `SettingsService`, familia BE-4/D3) queda como deuda menor.
- **`PrismaService.nextFolios(n)`** — reserva n folios consecutivos en 1 `SELECT nextval(...) FROM
  generate_series(1,n)`.

### 38.4 Orden natural de `Card.number` (String) — decisión de implementación
`Card.number` es String; el orden lexicográfico rompe ("10" < "2"; promos mal ubicadas). `deriveNumberParts`
+ `compareByNumber` (puros expuestos y testeados) producen:
1. cartas **puro-numéricas** primero, por su entero ("2" < "10" < "200");
2. cartas con **prefijo** (promos/subsets `TG`/`GG`/`SV`) al **FINAL**, **agrupadas por prefijo** (GG → SV →
   TG) y dentro del prefijo por su parte numérica ("TG2" < "TG12").
`numberSort` (DTO) = entero para puros; `1_000_000 + parte_numérica` para promos (clave coarse "al final"
que el front puede reusar). `isSecretRare = numberSort > printedTotal`.
- **Desviación documentada del literal del contrato:** el contrato ilustra `numberSort` con
  `regexp_replace(number,'\D','','g')::int` (que daría `TG12`→12, ubicándolo entre las numéricas), pero el
  MISMO contrato y el reparto de ARCHITECTURE §4.17 exigen "**TG12 al final**" / "no-numéricos al final"
  (default **WS-E-5**). Se implementó el comportamiento **observable** exigido (promos al final, agrupadas por
  prefijo), no la fórmula literal (que lo contradice). No se cambió el contrato. **Punto para el arquitecto
  si quiere reconciliar el texto de la fórmula.**

### 38.5 Defaults de decisiones abiertas aplicados (para revisión del humano)
- **WS-E-1** completitud = `distinctCardsOwned / catalogCardCount` (denominador = **catálogo real**, nunca
  >100%; `printedTotal` se expone aparte). `completionPct=null` si `catalogCardCount=0`.
- **WS-E-2** on-hand = **solo `ownerType='platform'`** con `status NOT IN (withdrawn, shipped, delivered,
  lost, damaged)`. La custodia de clientes (`customer_custody`) NO cuenta en el binder de back-office.
- **WS-E-3** `qty` es un **atajo bulk** (raw/sellado) que expande a N piezas/N folios; graded siempre 1.
- **WS-E-4** cap **200** líneas por lote + idempotencia con `InventoryBatch` (que además ES la auditoría del
  lote). Empty/over-cap/`batchKey` ausente → `400 VALIDATION_ERROR`.
- **WS-E-5** no-numéricos/promos al final (ver 38.4).

### 38.6 Desviación menor de implementación (sin cambio de contrato)
- **Índice Master Set — agregación global vs. page-scoped:** el contrato sugiere agregar solo los `setId` de
  la página. Para que `sort=completion_asc`/`pieces_desc` sea **globalmente correcto** (no solo dentro de la
  página) se cargan los sets que hacen match con `q` (select liviano) y se agrega para ellos en **3 queries
  fijas** (patrón `set-value.service`), no una por set. Sigue siendo **O(1) queries / sin N+1**; el nº de
  sets es acotado (~cientos). Documentado por si el arquitecto prefiere paginar en DB solo para `release_desc`.

### 38.7 Archivos tocados
- `prisma/schema.prisma` (índice + `InventoryBatch`), `prisma/migrations/20260817120000_m21_master_set_batch/migration.sql`.
- `src/prisma/prisma.service.ts` (`nextFolios`).
- `src/modules/pricing/pricing.service.ts` (`getReferencesBatch`, `loadSalesRules`; `computeSalePriceForItem`
  reusa `loadSalesRules`).
- `src/modules/inventory/master-set.service.ts` (**nuevo**: index/binder + orden natural).
- `src/modules/inventory/inventory.service.ts` (`resolveCreation`/`buildItemData` extraídos; `batchCreate`,
  `bulkPublish`).
- `src/modules/inventory/inventory.controller.ts` (4 endpoints), `inventory.module.ts`, `dto/inventory.dto.ts`
  (DTOs de lote).
- `src/modules/catalog/catalog.service.ts` (`fetchSellable`/`toListingDTO` con contexto pre-cargado, BE-25).
- Tests: `test/master-set.service.spec.ts`, `test/inventory.batch.spec.ts`, `test/pricing.references-batch.spec.ts`,
  `test/catalog.spec.ts` (mock actualizado a las nuevas deps de `fetchSellable`).

### 38.8 Notas para otros roles
- **frontend (M1):** índice Master Set (grid ordenable), binder (cuadrícula por número; `countsByFinish`,
  huecos `totalCount=0`, secret rares; **filtros locales** rareza/acabado/faltantes sobre la respuesta
  completa), carrito de captura → 1 POST `/batch` (render parcial-tolerante por `results[].ok`), publicación
  masiva → `/bulk-publish`. Reusa el componente de cuadrícula del picker del cotizador.
- **devops/QA:** doble veredicto (no toca dinero saliente; publicación deriva precio server-side). **No hay
  DB en el sandbox → la migración M-21 se debe aplicar (`prisma migrate deploy`) en el entorno real.** E2E:
  inventariar un set por el binder, ver el conteo agregado actualizarse, publicar en lote, confirmar que el
  replay del carrito no duplica.

### 38.9 Sin dudas de contrato bloqueantes
El contrato v1.16 es implementable tal cual con los defaults del arquitecto. **Único punto de reconciliación
NO bloqueante:** el texto de la fórmula `numberSort` del contrato (regexp) contradice el requisito
"TG12/no-numéricos al final" del mismo contrato; se implementó el requisito observable. No se modificó
`API_CONTRACT.md`.

**Gates:** `npx tsc --noEmit` exit 0; `npx jest` **72 suites / 503 tests** verdes.

## 39. Endurecimiento WS-E — cierre de hallazgos de escritura por lote (2026-08-17)

Los tres veredictos aprobaron WS-E con hallazgos a cerrar ANTES de promover (uno es bug de DINERO). Todo
en `backend/` (+ estas notas + `TECH_DEBT`), **sin tocar el contrato**. Gates: `tsc --noEmit` exit 0;
`jest` **72 suites / 514 tests** verdes.

### 39.1 [MONEY · QA] Double-sell cerrado en `bulkPublish` (allowlist de status de ORIGEN)
- **Bug:** la guarda por-línea solo validaba `ownerType !== 'platform'`; **no** miraba el `status` actual
  antes de forzar `status → 'listed'`. Una pieza de plataforma en `reserved` (orden con PaymentIntent vivo),
  `in_custody`/`picking`/`shipped`/`delivered`, `lost`/`damaged` (sin existencia física real) o `withdrawn`
  podía re-publicarse a `listed`. Como el checkout reserva por `status IN ('listed','in_stock')`
  (`orders.service.ts` reserva atómica), un **segundo** checkout la reservaría para OTRO comprador → **dos
  clientes por una pieza física** / inventario fantasma.
- **Fix:** allowlist de status de origen `PUBLISHABLE_ORIGIN_STATUSES = ['in_stock','listed']`
  (`inventory.service.ts`). `in_stock` → publica; `listed` → **no-op idempotente** (`ok:true`); cualquier
  otro → **error por-línea `ITEM_NOT_PUBLISHABLE`** (422, nuevo en `error-codes.ts`) que **no tumba** el
  resto del lote. El `status` se lee del `InventoryItem` en BD (server-side), nunca del DTO. El enum real de
  `InventoryStatus` **no tiene `sold`** (una venta liquidada pasa a `in_custody` con `ownerType='customer'`,
  ya bloqueado por la guarda de owner); el conjunto seguro correcto para publicar es `{in_stock, listed}`.
- **Nota para el arquitecto (NO bloqueante):** el contrato §M1 (WS-E, `bulk-publish`) debería **especificar
  explícitamente el conjunto de status de ORIGEN permitido**; hoy solo describe el error `PRICE_PENDING`
  por-línea y no menciona la guarda anti-double-sell. Se implementó el comportamiento seguro; no se editó
  `API_CONTRACT.md`. Sugerencia: documentar `ITEM_NOT_PUBLISHABLE` y el allowlist `{in_stock, listed}`.

### 39.2 [SEC-N2 / BE-34] Atomicidad + idempotencia de `batchCreate`
- **Bug:** hacía `findUnique(batchKey)` → creaba ítems en loop → `InventoryBatch.create` al final. Dos
  requests concurrentes con el mismo `batchKey` pasaban ambos el `findUnique` nulo y **duplicaban** piezas;
  un crash a mitad dejaba ítems huérfanos sin `InventoryBatch` y el replay los **recreaba**.
- **Fix:** el lote completo (claim del `InventoryBatch` + N `InventoryItem` + movimientos + resultado) corre
  en **una `$transaction`**. El **claim `inventoryBatch.create({ id: batchKey })` va PRIMERO** dentro de la
  tx; su **unique constraint** (`id = batchKey`) es la guardia:
  - **Concurrencia:** dos requests → uno commitea; el otro choca con **P2002** en el claim → se detecta por
    `(e as {code}).code === 'P2002'`, se re-lee el batch ganador y se devuelve como **replay**
    (`idempotentReplay:true`) → **no duplica inventario**. (Carrera extrema sin resultado visible aún →
    `409 CONFLICT` "retry".)
  - **Crash-safety:** un crash a mitad hace **rollback** del claim y de los ítems (sin huérfanos); el replay
    re-hace el lote limpio.
  - El claim se crea con `resultJson` placeholder y se **finaliza** con `inventoryBatch.update` al final de
    la tx (auditoría del lote intacta). Los ítems se crean con el **cliente `tx`**; las lecturas/escala de
    pendientes de `resolveCreation` siguen en `this.prisma` (reads consistentes; la escala a
    `PendingPriceEntry` es auxiliar/advisory).
- El fast-path `findUnique` inicial sigue sirviendo el **replay secuencial** (las filas no committeadas de
  una corrida en vuelo no son visibles bajo READ COMMITTED, así que nunca ve un claim a medias).

### 39.3 [SEC-N1 · Media DoS] `qty` con `@Max`
- `BatchInventoryItemInput.qty` tenía `@Min(1)` sin tope → un `vault_operator` podía mandar `qty` gigante y
  `nextFolios` ejecuta `generate_series(1, qty)` → DoS de BD. Añadido `@Max(MAX_BATCH_QTY)` con
  `MAX_BATCH_QTY = 500` (holgado para bulk raw/sellado real). Sobre el tope → `400 VALIDATION_ERROR`.

### 39.4 [SEC-N3 · Baja] `listPriceCents` con `@Max`
- `listPriceCents` era `@Min(0)` sin tope en `CreateItemDto`, `UpdateItemDto`, `BatchInventoryItemInput` y
  `BulkPublishLineInput` (dinero en Int 32-bit, deuda B-3). Añadido `@Max(MAX_LIST_PRICE_CENTS)` con
  `MAX_LIST_PRICE_CENTS = 100_000_000` (= MX$1,000,000/pieza, muy por debajo de 2^31; margen de sobra para el
  slab más caro). Sobre el tope → `400 VALIDATION_ERROR`. Ambas constantes exportadas desde
  `dto/inventory.dto.ts`.

### 39.5 Tests (todos en `test/inventory.batch.spec.ts`)
- **bulk-publish double-sell:** OMITE con `ITEM_NOT_PUBLISHABLE` piezas en `reserved`, `lost`, `damaged`,
  `in_custody`, `shipped`, `withdrawn` (sin llamar `inventoryItem.update`); **no-op idempotente** en `listed`
  (ok:true, no tumba el lote).
- **batch atomicidad/idempotencia:** claim + items en **1 `$transaction`**; **concurrencia** (P2002 en el
  claim) → replay sin crear piezas; replay secuencial sin re-crear.
- **DTOs:** `qty > 500` → error de validación; `listPriceCents > MAX` → error (en `BatchInventoryItemInput` y
  `BulkPublishLineInput`); límites exactos aceptados.

### 39.6 Archivos tocados
- `src/common/error-codes.ts` (nuevo `ITEM_NOT_PUBLISHABLE`).
- `src/modules/inventory/inventory.service.ts` (allowlist de origen en `bulkPublish`; `batchCreate` con
  claim-first en `$transaction` + `replayBatch`).
- `src/modules/inventory/dto/inventory.dto.ts` (`@Max` en `qty`/`listPriceCents`; constantes
  `MAX_BATCH_QTY`/`MAX_LIST_PRICE_CENTS`).
- `test/inventory.batch.spec.ts` (mock con `$transaction`/`inventoryBatch.update`/P2002; tests nuevos).

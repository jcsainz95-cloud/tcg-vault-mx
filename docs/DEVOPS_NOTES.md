# DEVOPS_NOTES.md — Marketplace TCG con Bóveda (Pokémon, México)

> Propiedad: **devops**. Cómo levantar el entorno local, correr CI y desplegar/rollback.
> Coherente con `docs/ARCHITECTURE.md` (§1 stack, §8 variables) y `PROJECT.md`.
> Estado: **fase de cierre**. Código presente en `backend/` y `frontend/`; **QA aprobó** y
> **techlead aprobó** (doble veredicto). Único ítem del DoD legítimamente **pendiente**: el
> **deploy real**, bloqueado por falta de credenciales de producción (ver §11). Runbook listo.
>
> **Actualización 2026-08-17 (v1.14 — WS-A CERRADO: ingest de precios con proveedor de paga):** WS-A
> recibió **triple veredicto** (qa+techlead+seguridad) y backend cerró 3 follow-ups; estado ya reflejado
> aquí. (1) El job **`price-ingest`** (ingest masivo por set vía **PokemonPriceTracker**, pluggable por el
> dial `PRICE_PROVIDER`) se programa **POR DEFECTO 2×/día** con el dial sembrado `pokemontcg_io` (legacy
> USD, money-safe): con Redis (Railway) los precios se refrescan **desde el arranque** sin config manual.
> (2) El barrido pesado `catalog-price-sync` (force:true) se **retiró del schedule** (ahora MANUAL/ops-only)
> y lo reemplaza `catalog-metadata-sync` **diario** (`force:false`, solo sets nuevos); además `catalog-sync`
> tras WS-A **ya no escribe `PriceReference` ni convierte FX** (§18.1 corregido). (3) Candado money-safe
> **`POKEMONPRICETRACKER_MARKET_FORMAT`** (env, sin default): sin él el proveedor de paga corre **sample-only**
> (no persiste precios); el PO confirmó **`usd_dollars`**, a fijar **tras leer el log de muestra** (§19.5).
> Ver **§18** (metadata/manual), **§19** (ingest, horarios, orden `fx-refresh → price-ingest`, flip runbook con
> `MARKET_FORMAT`, rollback por dial) y el bloque de precios/scheduling de `.env.example`. El **scheduler** y
> `env.validation.ts` los cabla **backend** (devops no toca `backend/`).

---

## 0. Estado actual (cierre)

- **Código presente**: `backend/` (NestJS + Prisma) y `frontend/` (Next.js 14) existen, compilan y
  pasan `lint + typecheck + test + build` con los scripts que espera el CI.
- **Doble veredicto**: QA (funciona) y techlead (bien hecho) **aprobados**. Los 3 ítems de gate de
  go-live del techlead (reserva de checkout atómica, validación de diales M10, acotado por periodo de
  reportes) están **corregidos con tests** (ver `docs/BACKEND_NOTES.md` §6 y `docs/TECH_DEBT.md`).
- **Deuda no bloqueante**: registrada y aceptada en `docs/TECH_DEBT.md` (Backend BE-1…BE-8, Frontend
  FE-1…FE-6). Ninguna bloquea el cierre; cada una tiene dueño y disparador.
- **Infraestructura validada (estático, sin daemon Docker en esta sesión)**:
  - `docker compose config` → OK (interpolación y perfiles válidos).
  - `bash -n` de los 6 scripts → OK.
  - Los 5 workflows (incl. `deploy.yml`) y `docker-compose.yml` parsean como YAML válido; `railway.json`
    parsea como JSON válido.
  - `.env.example` cubre **todas** las env que el código lee (ver §4 y verificación en §10).
- **CD ejecutable:** `deploy.yml` ya tiene los pasos **reales** de Vercel + Railway (no plantilla). Se
  añadió `railway.json` (build backend con `Dockerfile.backend`). Se corrigieron dos bugs latentes de
  build en `Dockerfile.backend` (`npm ci --include=dev` + no podar devDeps, necesarios para
  `nest build` / `prisma migrate deploy` / seed) y uno en `Dockerfile.frontend` (`mkdir -p public`). Ver §6.
- **Deploy real**: **NO ejecutado**. Requiere credenciales prod y las plataformas provisionadas
  (ver runbook §11). Sin los GitHub Secrets de deploy, `deploy.yml` **falla en `preflight`** con la lista
  exacta (no despliega a medias). Esto es lo único que falta del DoD y es esperado en esta sesión.

## 1. Stack (resumen, ver ARCHITECTURE §1)

| Capa | Tecnología | Puerto local |
|---|---|---|
| Backend | NestJS + Prisma (Node 20 LTS) | 3001 (`/api/v1`) |
| Frontend | Next.js 14 App Router (Node 20 LTS) | 3000 |
| Base de datos | PostgreSQL 16 | 5432 |
| Cache/colas/rate-limit | Redis 7 + BullMQ | 6379 |
| Object storage (SOLO INE `kyc_ine`) | MinIO local / R2·S3 prod | 9000 (API), 9001 (consola) |
| Pagos | Stripe (webhooks a `/api/v1/webhooks/stripe`) | — |

---

## 2. Requisitos

- **Docker** + **Docker Compose v2** (`docker compose version`).
- **Node 20 LTS** + npm (para correr backend/frontend fuera de Docker en dev).
- Opcional: **Stripe CLI** (`stripe`) para reenviar webhooks a local.

## 3. Levantar el entorno local (paso a paso)

```bash
# 1) Entrar al repo
cd Dev-team

# 2) Crear tu .env desde la plantilla (y rellenar claves reales — ver §4)
cp .env.example .env

# 3) Levantar infraestructura (Postgres + Redis + MinIO + bucket)
./scripts/dev-up.sh
#    equivale a: docker compose up -d

# 4) Migrar y sembrar la base
./scripts/db-migrate.sh        # prisma migrate deploy (crea tablas + secuencia de folios)
./scripts/seed.sh              # diales M10, super_admin, ubicaciones/datos base

# 5) Arrancar las apps en modo dev
cd backend  && npm install && npx prisma generate && npm run start:dev   # http://localhost:3001/api/v1
cd frontend && npm install && npm run dev                                 # http://localhost:3000
```

Alternativa todo-en-Docker:

```bash
./scripts/dev-up.sh --apps     # docker compose --profile apps up -d  (construye Dockerfile.backend/.frontend)
```

Servicios y accesos tras `dev-up`:

- Postgres: `localhost:5432` (credenciales de `.env`).
- Redis: `localhost:6379`.
- MinIO API: `http://localhost:9000` · Consola: `http://localhost:9001`
  (login con `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`). El bucket `tcg-photos`
  se crea solo (init container `createbuckets`). **SEC-A5: es PRIVADO** — su
  único contenido en v1.2 es el prefijo `kyc_ine/` (INE del buylist), que **no**
  tiene lectura anónima; se sirve por presigned GET del backend. Ya **no** hay
  prefijos `inventory_photo/` (catálogo público) ni `dispute_claim/`. Ver §15.
- **SEC-M4:** los puertos de datos (Postgres 5432, Redis 6379, MinIO 9000/9001) se
  publican **solo en `127.0.0.1`**, nunca en `0.0.0.0`/LAN. El backend del perfil
  `apps` los alcanza por la red de compose (hosts `postgres`/`redis`/`minio`), no
  por el puerto de host.

Usuarios sembrados (por `seed.sh` → `backend` seed): super_admin (`SEED_ADMIN_EMAIL`
/`SEED_ADMIN_PASSWORD`) y vault_operator (`SEED_OPERATOR_EMAIL`/`SEED_OPERATOR_PASSWORD`).
**SEC-C1: define contraseñas fuertes en `.env` ANTES del seed** (`openssl rand -base64 24`).
Si van vacías, el backend aún cae a defaults débiles (`ChangeMe123!` / `Operador123!`
hardcodeada) — es un fix pendiente de **rol backend**; hasta entonces **rota ambas
credenciales tras el primer login**. Nunca arranques un entorno accesible con defaults.

Apagar:

```bash
./scripts/dev-down.sh          # conserva datos (volúmenes)
./scripts/dev-down.sh --wipe   # BORRA datos (reset total)
```

### Frontend contra backend real vs mocks

El cliente Next.js usa **fixtures mock por default** si `NEXT_PUBLIC_USE_MOCKS` NO es `"false"`
(ver `docs/FRONTEND_NOTES.md` y deuda FE-1). Para pegarle al backend real pon
`NEXT_PUBLIC_USE_MOCKS=false` (ya es el valor de `.env.example`). En imágenes Docker esta variable se
**hornea en build-time** (es `NEXT_PUBLIC_*`): el `Dockerfile.frontend` la recibe como `ARG` y el
compose la pasa como build arg (default `false`).

### Webhooks de Stripe en local

El backend expone `POST /api/v1/webhooks/stripe` (firma verificada, body crudo). Para probar en local:

```bash
stripe login
stripe listen --forward-to localhost:3001/api/v1/webhooks/stripe
# Copia el whsec_… que imprime a STRIPE_WEBHOOK_SECRET en tu .env y reinicia el backend.
```

> Nota (de backend): si delante del backend se pone un proxy/body-parser, **preservar el raw body**
> en la ruta del webhook o la verificación de firma fallará.

---

## 4. Variables de entorno (qué debe rellenar el humano)

Todas viven en `.env` (copia de `.env.example`, **nunca** se comitea). Con los valores por defecto de
`.env.example` la **infraestructura local** arranca sin tocar nada. Requieren **credenciales reales**
antes de usar esas funciones:

| Variable(s) | Para qué | Quién la provee |
|---|---|---|
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Firmar JWT (auth). **Obligatorias en prod** (el backend aborta si faltan con `NODE_ENV=production`). | Generar: `openssl rand -hex 48` (distintas entre sí) |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | Pagos y webhooks | Dashboard de Stripe (test/live) |
| `POKEMONTCG_IO_API_KEY` | Precios raw/singles (fetch real), **import diario de metadata** (`catalog-metadata-sync`, §18) **y fuente del `price-ingest` 2×/día cuando `PRICE_PROVIDER=pokemontcg_io`** (el dial **sembrado por defecto**; cientos de req/corrida). **Obligatorio en prod** (ver §18/§19). | dev.pokemontcg.io (free; con key ~20k req/día) |
| `CATALOG_METADATA_SYNC_CRON` (opcional) | Cron **en UTC** del import **diario de metadata** del catálogo (`catalog-metadata-sync` = `syncAll force:false`: solo sets/cartas **nuevas**, **NO** escribe precios ni FX). Default `0 1 * * *` (01:00 UTC = 19:00 CDMX). **v1.14 (WS-A):** reemplaza en el schedule al barrido pesado `catalog-price-sync` (force:true), ahora **MANUAL/ops-only**. Los viejos `CATALOG_PRICE_SYNC_CRON_1/_2` quedan **deprecados** (el scheduler ya no los lee). Requiere `REDIS_URL`. Ver §18. | Sin acción salvo querer otro horario (ajuste sin redeploy en Railway) |
| `PRICE_INGEST_CRON_1`, `PRICE_INGEST_CRON_2` (opcional) | Crons **en UTC** del **ingest masivo de precios** `price-ingest` (WS-A, §19), el **pricing primario** del catálogo. Defaults `0 0 * * *` (18:00 CDMX) y `0 12 * * *` (06:00 CDMX) → **06:00 y 18:00 CDMX**. **WS-A cierre: DEFAULT-ON 2×/día** (ya cableado en `scheduler.service.ts`; **ya no opt-in**) con el dial sembrado `pokemontcg_io`. Requieren `REDIS_URL`. Ver §19. | Sin acción salvo querer otro horario (ajuste sin redeploy en Railway) |
| `SEALED_PRICE_INGEST_CRON` (opcional) | Cron **en UTC** del ingest **diario de referencia del SELLADO** `sealed-price-ingest` (v1.19, tcgcsv.com; §21). Default `30 21 * * *` (21:30 UTC = 15:30 CDMX), tras el refresh diario de TCGCSV (~20:00 UTC) y tras `fx-refresh`. **El encendido real es el dial M10 `sealed_price_source`** (`tcgcsv \| off`, seed `off` fail-closed) — la env solo mueve el horario. Requiere `REDIS_URL`. | Sin acción salvo querer otro horario (ajuste sin redeploy en Railway) |
| `POKEMONPRICETRACKER_API_KEY` | **Proveedor de PAGA del ingest masivo `price-ingest` (WS-A, §19)** — bulk `POST /cards/bulk-price`, auth Bearer. **Requisito operativo en prod** cuando `PRICE_PROVIDER=pokemonpricetracker` (con **cuota del plan de paga**). Rol residual: stub graded/sealed per-carta (BE-6). **Valor en Railway, NUNCA en el repo.** | PokemonPriceTracker (**plan de paga**; key **ya en Railway**) |
| `POKEMONPRICETRACKER_MARKET_FORMAT` (**money-safe, sin default**) | Moneda + unidad del campo `market` del proveedor de paga: `usd_dollars` / `usd_cents` / `mxn_dollars` / `mxn_cents`. **Candado fail-closed:** sin ella, con `PRICE_PROVIDER=pokemonpricetracker` el ingest corre **sample-only** (fetch + log de muestra, **no persiste** ningún precio). El **PO confirmó `usd_dollars`** — fijarla **solo tras leer el log de muestra** de una corrida `{setId}` (§19.5). Con `pokemontcg_io` (legacy) no aplica. **Valor en Railway, no en el repo.** | devops, tras verificar el log de la 1ª corrida (§19.5) |
| `POKETRACE_API_KEY` | Respaldo per-carta gradeadas/sellado | PokeTrace (free tier) — **provider stub, ver BE-6** |
| `S3_*` (endpoint/bucket/keys/force-path-style) | **Object storage SOLO para la INE del buylist (`kyc_ine/`)**, cifrada + presigned PUT/GET. Local=MinIO (ya puesto); prod=R2/S3. v1.2.1: sin `S3_PUBLIC_BASE_URL` (no hay prefijo público) ni fotos de inventario/disputa. Nombres reales que consume el código: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`. | Cloudflare R2 o AWS S3 |
| `KYC_UPLOAD_MAX_BYTES` (opcional) | Tope en bytes del upload presignado de la INE (`kyc_ine`); se fija en la firma (`ContentLength`). Sin valor → backend usa **10 MiB** (10485760). | Sin acción salvo querer otro tope |
| `GOOGLE_CLIENT_ID` (backend `[RW]`) + `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (Vercel `[VC]`) | Login con Google (v1.2). **Mismo** OAuth 2.0 Client ID en ambas: backend valida `aud` del ID token; frontend lo usa en el botón. Sin `GOOGLE_CLIENT_ID` el backend rechaza el login con Google (email/password sigue OK). | Google Cloud Console > Credentials > OAuth client ID (Web) |
| `DISPUTE_EVIDENCE_CONTACT` (backend `[RW]`) | Correo que el backend devuelve como `evidenceContact` para que el cliente envíe evidencia de disputa **por email** (v1.2: ya no se sube al bucket). Placeholder, override sin redeploy; default `soporte@tcgvaultmx.com`. | Correo de soporte del negocio |
| `PII_ENCRYPTION_KEY`, `PII_HMAC_KEY` | Endurecimiento PII: cifrado AES-256 en reposo de CLABE/RFC + HMAC del blind index de CLABE (match sin descifrar). **Distintas entre sí**. Vacías OK en local (greenfield); **OBLIGATORIAS en no-local** (backend aborta si faltan). | Generar: `openssl rand -base64 32` (una por cada una); en prod, **KMS/secret manager** |
| `INE_RETENTION_DAYS` | Días de retención de la INE del KYC (`kyc_ine/`). El backend borra; el bucket expira como capa extra. Igual al dial M10 (fuente de verdad). | Valor **legal/fiscal** — **fijado en 180 días** por decisión de negocio, alineado con el dial M10 del backend |
| `FX_SOURCE=banxico`, `BANXICO_SIE_TOKEN` | Tipo de cambio USD→MXN automático (Banxico SIE) + colchón + override manual (M10). El backend lee `BANXICO_SIE_TOKEN` y, si falta, cae a `FX_API_KEY`, y si tampoco, a override manual / último FxRate. | Token SIE de Banxico (gratis en el portal SIE) |
| `DATABASE_URL`, `REDIS_URL`, `POSTGRES_*`, `MINIO_ROOT_*` | Infra. **`REDIS_URL` = requisito de los jobs BullMQ** (sin él el scheduler no programa `price-ingest`/`fx-refresh`/barridos; §19.2). | Ya listos en `.env.example` (local); en prod Railway inyecta `DATABASE_URL`/`REDIS_URL` (add-ons) |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_OPERATOR_EMAIL`, `SEED_OPERATOR_PASSWORD` | Credenciales de las cuentas sembradas (super_admin + vault_operator). **SEC-C1: sin default débil**, generar fuertes (`openssl rand -base64 24`) | Definir en prod ANTES del seed y rotar tras primer login |
| `NEXT_PUBLIC_*` | Config del frontend expuesta al browser (incluye `NEXT_PUBLIC_USE_MOCKS=false`) | Solo claves **públicas** |

> Los **diales de negocio** (tarifa MX$175, IVA 16%, topes MX$3,000/10,000, aportación 70%, markup de
> venta, tarifa Stripe MX del gross-up, `PricingProvider` por tipo, **`PRICE_PROVIDER`/`price_provider`**
> — proveedor del ingest masivo WS-A, `pokemonpricetracker | pokemontcg_io`, **se flipea por el panel M10,
> no por env/Railway**; seed money-safe `pokemontcg_io`, ver §19) **no son env**: viven en la tabla
> `ConfigSetting` (M10), editables sin redeploy. Los siembra `seed.sh`.

---

## 5. CI (`.github/workflows/ci.yml`)

Se dispara en **push** y **pull_request**. Jobs:

1. **detect** — mira si `backend/package.json` y `frontend/package.json` existen y activa los jobs
   correspondientes. Hoy **ambos existen**, así que ambos jobs corren.
2. **backend** — Node 20; levanta **Postgres 16** y **Redis 7** (servicios de CI); corre
   `prisma generate` + `migrate deploy` (valida el schema) y luego `lint → typecheck → test → build`.
   Los tests unitarios usan Prisma mockeado (no requieren la DB), pero la migración valida el esquema.
3. **frontend** — Node 20; `lint → typecheck → test → build` con `NEXT_PUBLIC_*` dummy.
4. **ci-ok** — gate final; falla solo si un job que corrió terminó en `failure`. **Úsalo como
   *required status check*** en la protección de la rama de release.

**MinIO en CI:** no se levanta. Los tests que tocan S3 mockean el cliente (backend usa Prisma/servicios
mockeados en unit; los e2e con infra real son de QA con `docker compose up -d`).

### Correr CI localmente (equivalente)

```bash
cd backend  && npm ci && npx prisma generate && npm run lint && npm run typecheck && npm test && npm run build
cd frontend && npm ci && npm run lint && npm run typecheck && npm test && npm run build
```

---

## 5.1 E2E: modo MOCK (rápido) vs modo REAL (gate) — arreglo del Paso 5

> **Actualización 2026-08-17 (devops):** se separó el E2E en dos caminos porque el
> "verde" que veía QA corría **contra mocks**, lo que dejó pasar flujos reales rotos.

### El problema (por qué "QA verde" no bastaba)

La suite Playbook (`frontend/e2e/*.spec.ts`) se ejecutaba con el **webServer del
`playwright.config.ts`**, que levanta Next con **`NEXT_PUBLIC_USE_MOCKS=true`** (fixtures
en memoria; `frontend/src/lib/config.ts` → `useMocks = env !== 'false'`). Con eso la UI se
prueba contra **datos simulados**, no contra los endpoints reales del backend. Resultado:
stubs de **comprar/retirar** convivieron con "QA verde" hasta que se cablearon los endpoints.
"Verde" significaba "la UI pinta bien con fixtures", no "el sistema funciona de punta a punta".

### La solución (dos caminos, propósitos distintos)

| Camino | Workflow | Cómo corre | Cuándo | Qué garantiza |
|---|---|---|---|---|
| **MOCK** (rápido) | `.github/workflows/e2e.yml` → job `frontend-e2e` | `playwright.config` levanta Next con `NEXT_PUBLIC_USE_MOCKS=true` (sin docker). Chromium instalado en el job (`playwright install --with-deps chromium`). | cada push/PR | Feedback rápido de UI/regresión contra **fixtures**. No prueba endpoints reales. |
| **REAL** (gate) | `.github/workflows/e2e-real.yml` | `docker-compose.staging.yml --profile apps` (Postgres 16 + Redis 7 + MinIO + backend NestJS + frontend con **`NEXT_PUBLIC_USE_MOCKS=false`**) + `migrate deploy` (arranque) + `seed:synthetic` + Playwright **smoke** contra `E2E_BASE_URL` real | **nightly** (08:00 UTC) · **manual** · **gate previo a prod** (invocado por `deploy.yml` vía `workflow_call`) | "Verde de verdad": los flujos críticos pegan a **endpoints reales**. |

**Smoke de flujos críticos (PROJECT.md)** que corre el modo REAL (parametrizable con el input
`smoke_specs`; default los 3 archivos):
- **comprar → orden**: `frontend/e2e/checkout.spec.ts`
- **retirar → envío**: `frontend/e2e/shipments.spec.ts`
- **vender/buylist → solicitud**: `frontend/e2e/buylist.spec.ts`

**Navegador (política vigente desde 2026-08-17 — ver §22.2):** ambos jobs corren en
`ubuntu-latest` (runner **estándar** de GitHub) e instalan el navegador en el propio job con
`npx playwright install --with-deps chromium`, **después** del `npm ci` del frontend. Se
retiraron `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` / `PLAYWRIGHT_BROWSERS_PATH` /
`PLAYWRIGHT_CHROMIUM_PATH` y el paso *Guard navegador*: apuntaban a `/opt/pw-browsers`, una
ruta que **solo existe en el runner-harness local**, y hacían fallar los dos workflows en CI.

### Cómo correr cada uno localmente

```bash
# --- MOCK (rápido, sin backend) ---
cd frontend && npm ci
npx playwright install --with-deps chromium   # una vez por máquina/runner
npm run test:e2e
#   (sin E2E_BASE_URL => el config levanta Next con NEXT_PUBLIC_USE_MOCKS=true)
#   Si trabajas en el runner-harness con Chromium ya preinstalado, puedes saltarte
#   el install y exportar PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers.

# --- REAL (stack completo, endpoints reales) ---
# 1) Levantar el stack real de staging (frontend horneado con mocks=false):
docker compose -f docker-compose.staging.yml --profile apps up -d --build
# 2) Esperar salud del backend y sembrar datos sintéticos.
#    OJO: la imagen de backend YA NO trae npm (§22.3) => el seed se invoca por bin:
curl -sf http://localhost:3011/api/v1/health
docker compose -f docker-compose.staging.yml exec -T backend \
  sh -c 'export PATH=/app/node_modules/.bin:$PATH; ts-node prisma/seed-e2e.ts'
# 3) Correr el smoke contra el frontend REAL (3010):
cd frontend && npm ci
npx playwright install --with-deps chromium
E2E_BASE_URL=http://localhost:3010 \
  npm run test:e2e -- checkout.spec.ts shipments.spec.ts buylist.spec.ts
# 4) Apagar:
docker compose -f docker-compose.staging.yml --profile apps down -v
```

### Cableado al gate de despliegue (DoD CLAUDE.md §10)

`deploy.yml` ahora exige, para promover a **producción**, los tres gates de seguridad+E2E:
- **SAST** en cada PR (`security-sast.yml`, branch protection antes del merge).
- **DAST** contra staging (`dast-staging`, ZAP baseline + nuclei; bloquea por críticos/altos).
- **E2E REAL** (`e2e-real.yml`, invocado como `uses: ./.github/workflows/e2e-real.yml` con
  `secrets: inherit`): los jobs `promote-production-*` añaden `needs: [dast-staging, e2e-real]`
  y la condición `needs.e2e-real.result == 'success'`. Sin E2E real verde, **no hay promoción**.

Refuerzo recomendado (branch protection de `main`): marcar como *required status checks*
`ci-ok`, `sast-ok`, `e2e-ok` (mock) y el job del **E2E real** (nightly/pre-deploy).

### Qué queda PENDIENTE de validar en CI (no verificable en este sandbox)

En este entorno **no hay stack levantable** (sin daemon Docker/Postgres/Redis fiables) y el
dominio prod está bloqueado por egress, así que **el E2E real NO se pudo CORRER aquí**. Lo que
**sí** se validó offline:
- YAML de `e2e-real.yml`, `e2e.yml` y `deploy.yml` parsean OK (`yaml.safe_load`).
- `playwright.config.ts` parsea y `npx playwright test --list` enumera **17 tests** en los 3
  specs de smoke (checkout/shipments/buylist) usando el Chromium preinstalado.
- `/opt/pw-browsers/chromium` existía en el sandbox donde se validó (navegador preinstalado del
  harness). **Ya no se depende de esa ruta en CI**: desde 2026-08-17 los workflows instalan
  Chromium con `npx playwright install --with-deps chromium` (§22.2).

Pendiente de la **primera corrida en CI/staging** (runner-harness con navegadores preinstalados):
1. Que el stack real de `docker-compose.staging.yml --profile apps` **arranque** y el backend
   pase health (build de imágenes + `migrate deploy`).
2. Que `seed:synthetic` del backend cargue el dataset que esperan los specs.
3. **Riesgo conocido (finding → rol frontend):** algunos specs de smoke están **acoplados a
   mocks** — siembran sesión por `localStorage` (`seedVerifiedCustomer`), simulan el pago
   ("pago simulado") y afirman **montos exactos de fixture** (p. ej. `MX$19,400.00`, `MX$0.50`).
   Contra el backend real esas aserciones pueden **fallar**. Volver el smoke **agnóstico de
   entorno** (o etiquetar un subconjunto `@real`) es trabajo del **rol frontend**; devops solo
   ejecuta la suite (CLAUDE.md: los specs los escriben frontend/backend). El input `smoke_specs`
   permite acotar el gate al subconjunto que ya sea real-safe mientras frontend adapta el resto.
4. ~~Requisito de runner: navegadores preinstalados en `/opt/pw-browsers`.~~ **RESUELTO
   2026-08-17 (§22.2):** `e2e.yml` y `e2e-real.yml` corren en `ubuntu-latest` stock e instalan
   Chromium con `npx playwright install --with-deps chromium` tras el `npm ci` del frontend.
   Ya no hay requisito de runner-harness ni *Guard navegador*.

### Deuda devops relacionada — throttler distribuido (store Redis)

El rate-limit de NestJS (`@Throttle`) usa hoy **store en memoria** (por instancia). El E2E real
corre **una sola** instancia de backend, así que el smoke **no** ejercita el rate-limit
multi-instancia. En **prod con >1 réplica** el límite se aplicaría por-instancia (efectivo = N×
el nominal) hasta migrar el throttler a un **store compartido en Redis** (`REDIS_URL` ya está
disponible). Es deuda de **rol backend** (config del `ThrottlerModule`), registrada en
`docs/TECH_DEBT.md` (v15-D3 / §5 throttler→Redis); relevante al gate porque el DAST/E2E de un
único nodo **no** la detectaría. Disparador: subir a `numReplicas > 1` en `railway.json`.

---

## 6. Deploy — estrategia propuesta (aún NO ejecutado)

> El deploy real requiere credenciales prod y plataforma provisionada. Sigue el **runbook §11**.

### Topología objetivo (MVP) — CONFIRMADA

> **Estado: CONFIRMADA** (acordada con el humano/arquitecto). Frontend→**Vercel**;
> backend + **PostgreSQL 16** + **Redis 7**→**Railway**; INE del buylist (`kyc_ine/`)→**Cloudflare R2**.
> Antes decía "propuesta"; ya no. Cualquier alta de un servicio de infra NO previsto
> sigue requiriendo propuesta al arquitecto (límite de rol devops).

| Componente | Plataforma CONFIRMADA | Notas |
|---|---|---|
| Frontend (Next.js) | **Vercel** | SSR/ISR nativo, dominios + HTTPS automáticos. |
| Backend (NestJS API) | **Railway** | Usa `Dockerfile.backend`; corre `prisma migrate deploy` al arrancar. |
| Worker BullMQ (jobs) | **Railway** (mismo servicio o worker aparte) | Scheduling de jobs = **deuda BE-5** (lógica lista, falta cablear repeatable jobs a `REDIS_URL`). |
| PostgreSQL 16 | **Railway Postgres** | Backups automáticos + point-in-time. |
| Redis 7 | **Railway Redis** | Persistencia AOF para colas. |
| Object storage | **Cloudflare R2** | Bucket **privado**, **solo** prefijo `kyc_ine/` (INE del buylist); presigned PUT/GET. Sin CDN público (v1.2.1). CORS al dominio del front. |
| Stripe | Cuenta prod (claves `live`) | Webhook prod → `https://api.tudominio.com/api/v1/webhooks/stripe`. |

> Además de prod, hay un **entorno de STAGING** permanente (mismas plataformas, proyecto/
> environment separado) que se despliega en cada release y sirve de blanco para E2E en vivo y
> DAST. Ver §13 (staging) y §14 (runbook de seguridad).

### CD — `.github/workflows/deploy.yml` (EJECUTABLE, concreto Vercel + Railway)

`.github/workflows/deploy.yml` ya **no** es plantilla: tiene los pasos **reales** de Vercel y Railway.
Cadena de jobs:

1. `ci-ok` — gate. Se dispara vía **`workflow_run`** cuando el workflow **CI** termina en la rama de
   release (`main`); exige `conclusion == success`. También admite `workflow_dispatch` (disparo manual
   para el primer deploy / promoción puntual).
2. `preflight` — verifica que existan **todos** los GitHub Secrets de deploy. Si falta alguno, **falla
   con la lista exacta** (`::error::Faltan GitHub Secrets de deploy: ...`) y **no despliega a medias**.
3. `deploy-staging-backend` — `railway up --service backend --environment staging`. El contenedor corre
   `prisma migrate deploy` al arrancar (CMD de `Dockerfile.backend`, ver §6.1).
4. `deploy-staging-frontend` — `vercel pull/build/deploy` (env **preview** = staging).
5. `dast-staging` — ZAP baseline + nuclei contra `STAGING_BASE_URL`. **Gate**: si hay críticos/altos,
   `exit 1` y **no** promueve.
5b. `e2e-real` — invoca `./.github/workflows/e2e-real.yml` (`workflow_call`, `secrets: inherit`): levanta
   el stack real (mocks=false) y corre el **smoke** de flujos críticos contra endpoints reales. **Gate**:
   si el E2E real no pasa, **no** promueve (ver §5.1). Requiere runner-harness con Chromium preinstalado.
6. `promote-production-backend` / `promote-production-frontend` — solo si **el DAST pasó Y el E2E real
   pasó** (`needs: [dast-staging, e2e-real]` + `needs.e2e-real.result == 'success'`); protegidos por el
   GitHub **Environment `production`** (required reviewers). Backend a Railway (prod), frontend a Vercel
   `--prod`. Recordatorio de **snapshot de DB** antes de promover.

**Rama de release:** `main` (recomendada). Para que `workflow_run` dispare el deploy, `deploy.yml` (y
`ci.yml`) deben estar en la **rama por defecto** del repo. Si mantienes la rama de trabajo
`claude/tcg-cards-marketplace-oijthj` como release, cambia `branches: [main]` del trigger `workflow_run`
por esa rama y define esa rama como default. Refuerza además con **branch protection**: `ci-ok`,
`sast-ok` y las suites E2E como *required status checks*.

**Qué falta para que despliegue de verdad:** solo cargar los **secrets** (§11.C) y provisionar las
plataformas (§11). Sin los secrets, `preflight` **falla** (comportamiento deseado, no un skip silencioso).

#### 6.1 Config de plataforma (archivos de deploy, propiedad devops)

- **`railway.json`** (raíz): `builder: DOCKERFILE`, `dockerfilePath: Dockerfile.backend`, `numReplicas: 1`,
  restart `ON_FAILURE`. **No** fija `startCommand` (se usa el `CMD` del Dockerfile como única fuente:
  `npx prisma migrate deploy && node dist/main.js`). Fija `healthcheckPath: /api/v1/health` y
  `healthcheckTimeout: 300` (holgado, por el arranque de Prisma/`migrate deploy` antes de que la API
  escuche): el backend **ya expone** `GET /api/v1/health` público (200 ok / 503 degraded, con `SELECT 1`
  a Postgres) — ver §6.3. El **worker BullMQ** corre en el **mismo servicio** que la API
  en el MVP (deuda BE-5: falta cablear los repeatable jobs a `REDIS_URL`); si crece la carga, se separa a
  un servicio `worker` con el mismo Dockerfile y otro `startCommand` — decisión futura.
- **Vercel — sin `vercel.json`:** el proyecto de Vercel se configura con **Root Directory = `frontend`**
  (dashboard, [HUMANO]) y **framework Next.js autodetectado**. No se crea `vercel.json` porque, con Root
  Directory en `frontend/`, Vercel solo leería `frontend/vercel.json`, y esa carpeta es **propiedad del rol
  frontend** (devops no escribe ahí, CLAUDE.md). La config (build/env) vive en el proyecto de Vercel y el
  workflow la trae con `vercel pull`. Las `NEXT_PUBLIC_*` (incluida `NEXT_PUBLIC_USE_MOCKS=false`) se
  definen en Vercel > Environment Variables (Preview=staging, Production=prod).

#### 6.2 Ajustes hechos a los Dockerfiles para estas plataformas

- **`Dockerfile.backend`:**
  - `deps` ahora hace **`npm ci --include=dev`**: el stage `base` fija `NODE_ENV=production`, lo que haría
    a `npm ci` **omitir devDependencies**; sin ellas `nest build` (y `prisma`/`ts-node`) fallarían. Con
    `--include=dev` el build compila y quedan disponibles las herramientas de migración/seed.
  - **Se quitó `npm prune --omit=dev`**: el arranque corre `prisma migrate deploy` y el seed usa
    `ts-node prisma/seed.ts`; `prisma`, `ts-node` y `typescript` son **devDependencies** (propiedad de
    backend, no se tocan). Podarlas rompería migración y seed en runtime. Trade-off: imagen mayor, aceptado
    para el MVP.
  - **La etapa `runtime` copia `src/` + `tsconfig.json`** (además de `dist/`, `node_modules`, `package.json`,
    `prisma/`). El seed de una sola vez corre `ts-node prisma/seed.ts`, que importa de `../src/...` (p. ej.
    `src/modules/settings/settings.constants`). Sin la fuente + la config TS, ts-node falla en Railway con
    `TS2307: Cannot find module '../src/...'`. Se incluyen la fuente y `tsconfig.json` en la imagen final,
    coherente con conservar las dev deps para el seed. **Deuda aceptada MVP** (imagen mayor + fuente en prod);
    alternativa futura: compilar el seed a `dist/` y usar imagen prod-only sin dev deps ni `src/`.
  - El backend lee `process.env.PORT` (Railway lo inyecta); `EXPOSE 3001` es informativo (Railway usa `PORT`).
- **`Dockerfile.frontend`:** se añadió `RUN mkdir -p public` (hoy `frontend/` no tiene `public/`, opcional
  en Next.js) para que el `COPY /app/public` del runtime no rompa el build de docker-compose local/staging.
  **Vercel NO usa este Dockerfile** (construye Next nativo); es solo para el stack local/staging.

#### 6.3 Health endpoint (resuelto)

- **Health endpoint:** el backend **ya expone** `GET /api/v1/health` público y ligero (200 ok / 503
  degraded, con `SELECT 1` a Postgres). Cableado en `railway.json` vía `healthcheckPath: /api/v1/health`
  con `healthcheckTimeout: 300` para no marcar el deploy como fallido durante `prisma migrate deploy` en
  el arranque. Railway ahora hace healthcheck HTTP real (no solo chequeo de arranque/puerto).

---

## 7. Rollback

| Escenario | Acción |
|---|---|
| **Deploy de app roto** | Revertir a la release anterior desde el dashboard de la plataforma (Vercel/Railway guardan deploys previos → "Redeploy"/"Rollback" a la versión buena). |
| **Vía Git** | `git revert <sha>` del merge problemático y push → CD redespliega la versión sana. Evitar `reset --hard` en ramas compartidas. |
| **Migración de DB mala** | Restaurar desde **backup**/point-in-time del proveedor. Prisma no auto-revierte: preparar migración correctiva o `prisma migrate resolve`. **Tomar snapshot ANTES de cada `migrate deploy` en prod.** |
| **Config/dial equivocado (M10)** | No requiere deploy: corregir el dial en el back-office (editable sin redeploy) — queda en `AuditLog`. |
| **Secreto filtrado** | Rotar la clave en el proveedor (Stripe/APIs/JWT), actualizar el secret manager, redeploy. Rotar JWT secrets invalida sesiones (los usuarios re-login). |

Regla de oro del rollback: **datos primero** (snapshot antes de migrar), luego código.

---

## 8. Monitoreo y logging (base propuesta)

- **Logging estructurado JSON** en el backend (NestJS Logger o `pino`), con `requestId` y `errorCode`
  (los mismos códigos del contrato). Sin PII ni secretos en logs.
- **Auditoría de negocio**: `AuditLog` (M10) cubre quién/qué/cuándo de acciones sensibles (dinero
  saliente, config, intentos bloqueados de operador). No sustituye al logging técnico.
- **Alertas básicas**: alerting de la plataforma sobre fallos de deploy y 5xx; alarma sobre fallos de los
  jobs `price-ingest` (ingest masivo WS-A, §19), `price-sync`/`fx-refresh` y `catalog-price-sync`, sobre
  `skipped` anómalo del ingest (posible cambio de esquema del proveedor) y sobre acercarse al rate-limit /
  **cuota del proveedor** (free tier 100/250/día; **plan de paga de PokemonPriceTracker** en el ingest).
- **Healthchecks**: en prod, Railway hace probe a `GET /api/v1/health` (`healthcheckPath` en `railway.json`,
  `healthcheckTimeout: 300`); el endpoint devuelve 200 ok / 503 degraded con `SELECT 1` a Postgres. La infra
  local ya define healthchecks de Postgres/Redis/MinIO.
- **CORS de producción**: **RESUELTO** (SEC-M2, en `backend/src/main.ts`). El backend ya arma una
  **allow-list** de orígenes desde `APP_BASE_URL` (lista separada por comas si hay varios) y **nunca**
  refleja un origin arbitrario (`origin: true`). **Acción devops:** fijar `APP_BASE_URL` en Railway al
  dominio del front (p. ej. `https://app.tudominio.com`); ese valor es a la vez la allow-list de CORS y
  la base de links del backend. Si el front vive en más de un dominio, sepáralos por comas.

---

## 9. Mapa de archivos de infraestructura (propiedad devops)

| Archivo | Rol |
|---|---|
| `docker-compose.yml` | Infra local: Postgres, Redis, MinIO (+ perfil `apps` para backend/frontend). |
| `Dockerfile.backend` | Imagen NestJS (multi-stage, Node 20, `prisma migrate deploy` al arrancar). |
| `Dockerfile.frontend` | Imagen Next.js (multi-stage, output standalone; `NEXT_PUBLIC_*` como build args). |
| `.dockerignore` | Contexto de build limpio; evita filtrar `.env`. |
| `.gitignore` | Higiene de secretos y artefactos. |
| `.env.example` | Todas las variables documentadas (sin valores reales). |
| `.github/workflows/ci.yml` | CI: lint + typecheck + test + build (backend/frontend) + gate `ci-ok`. |
| `.github/workflows/security-sast.yml` | SAST en cada PR/push: semgrep + gitleaks + npm audit + trivy (gate high/critical). |
| `.github/workflows/e2e.yml` | E2E **rápido (PR)**: `test:integration` (backend, DB/Redis reales) + `test:e2e` frontend en **modo MOCK** (webServer del config, `NEXT_PUBLIC_USE_MOCKS=true`, Chromium preinstalado). Ver §5.1. |
| `.github/workflows/e2e-real.yml` | E2E **modo REAL** (gate): stack completo `docker-compose.staging.yml` (mocks=false) + `migrate deploy` + `seed:synthetic` + **smoke** de flujos críticos (comprar/retirar/buylist) contra endpoints reales. Nightly + `workflow_call` desde `deploy.yml`. Ver §5.1. |
| `.github/workflows/deploy.yml` | CD **ejecutable**: CI-gate → deploy staging (Railway+Vercel) → DAST → promoción a prod bloqueada por críticos y por Environment `production`. |
| `railway.json` | Config de build/deploy del backend en Railway (Dockerfile.backend, 1 réplica, restart ON_FAILURE). |
| `.github/workflows/security-scheduled.yml` | Cron semanal: DAST completo (ZAP full + nuclei) contra staging. |
| `docker-compose.staging.yml` | Entorno staging aislado (datos sintéticos) espejo del stack. |
| `security/` | Config/infra de seguridad: semgrep, gitleaks, trivy, ZAP, nuclei + wrappers (ver `security/README.md`). |
| `scripts/dev-up.sh` / `dev-down.sh` | Levantar/apagar entorno local. |
| `scripts/db-migrate.sh` / `seed.sh` | Migraciones y seed (delegan en los scripts npm de backend). |
| `scripts/seed-synthetic.sh` | Seed sintético de staging (delega en backend; nunca datos reales). |

> Los Dockerfiles viven en la **raíz** (no dentro de `backend/`/`frontend/`) para respetar la propiedad
> de archivos de `CLAUDE.md`: devops no escribe en esas carpetas.

---

## 10. Verificación del DoD (hecha por devops en el cierre)

Resultado de la verificación estática ejecutable en esta sesión (sin daemon Docker ni credenciales prod):

| DoD (CLAUDE.md) | Estado | Evidencia |
|---|---|---|
| (a) Criterios de aceptación de PROJECT.md cumplidos | **Cumplido** (con salvedades no bloqueantes) | 34 criterios verificados por QA; backend/frontend implementan las verticales. Salvedades registradas como deuda: providers graded/sealed stub → override manual cubre (BE-6); `buylist-sweep` 30d no auto-convierte (BE-3, criterio 16 parcial, mitigado por conversión en 1 clic); UI admin M2/M6/M7/M9/M10 en placeholder (FE-3). QA y techlead las aceptaron como no bloqueantes. |
| (b) Doble veredicto QA + techlead | **Cumplido** | QA APROBADO; techlead APROBADO con los 3 ítems de gate ya corregidos (BACKEND_NOTES §6, TECH_DEBT nota Backend). |
| (c) docs al día | **Cumplido** | `ARCHITECTURE.md`, `API_CONTRACT.md`, `DESIGN_SYSTEM.md`, `BACKEND_NOTES.md`, `FRONTEND_NOTES.md`, `TECH_DEBT.md` presentes y coherentes con lo implementado (fecha 2026-08-13, branch `claude/tcg-cards-marketplace-oijthj`). |
| (d) Deploy + rollback documentados | **Cumplido (documentado)** · deploy **no ejecutado** | Deploy §6 + runbook §11; rollback §7. El deploy real queda pendiente de credenciales (§11). |
| (e) Sin deuda bloqueante; la no bloqueante registrada | **Cumplido** | `docs/TECH_DEBT.md` con BE-1…BE-8 y FE-1…FE-6, cada una con dueño/impacto/disparador; ninguna bloqueante. |

Validaciones estáticas corridas (reales):

- `docker compose config` → **OK** (perfiles e interpolación válidos). Daemon Docker **no disponible** en
  la sesión → no se pudo hacer `up`/build de imágenes.
- `bash -n` sobre `scripts/*.sh` → **OK** (5/5).
- YAML de `ci.yml` y `docker-compose.yml` → **OK**.
- Cobertura de `.env.example`: **todas** las env que el código lee están presentes. Verificado que el
  backend consume `DATABASE_URL`, `JWT_*`, `STRIPE_*`, `POKEMONTCG_IO_API_KEY`,
  `POKEMONPRICETRACKER_API_KEY`, `POKETRACE_API_KEY`, `S3_*`, `BANXICO_SIE_TOKEN` (fallback `FX_API_KEY`),
  `SEED_ADMIN_*`; el frontend consume `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`,
  `NEXT_PUBLIC_DEFAULT_LOCALE`, `NEXT_PUBLIC_USE_MOCKS`. `REDIS_URL` está provista para cuando se cablee
  el scheduling BullMQ (BE-5).
- Ajustes de infra hechos en el cierre (dentro de rutas devops): pase de `BANXICO_SIE_TOKEN`,
  `SEED_ADMIN_*` y `NEXT_PUBLIC_USE_MOCKS` en `docker-compose.yml`; `ARG NEXT_PUBLIC_USE_MOCKS` en
  `Dockerfile.frontend`; alineación del bloque FX de `.env.example` con la decisión Banxico.

---

## 11. Runbook de go-live (paso a paso, Vercel + Railway + Cloudflare R2)

> Ejecutar **en orden**. `[HUMANO]` = lo hace la persona (crear cuentas, cargar secrets, DNS);
> `[AUTO]` = lo hace el pipeline `deploy.yml`; `[DEVOPS]` = comando puntual de operación. Tras
> completar A–E, el deploy es **mecánico**: push a `main` → CI verde → `deploy.yml` despliega staging,
> corre DAST, y (con aprobación del Environment `production`) promueve a prod.

### 11.A — Crear proyectos en las plataformas — [HUMANO]

**Vercel (frontend):**
- [ ] Crear proyecto en Vercel conectando el repo de GitHub.
- [ ] **Settings > General > Root Directory = `frontend`** (crítico: la app Next vive en `frontend/`).
      Framework: **Next.js** (autodetectado). Node.js Version: **20.x**.
- [ ] `vercel link` en local (o desde el dashboard) para obtener **`VERCEL_ORG_ID`** y
      **`VERCEL_PROJECT_ID`** (quedan en `frontend/.vercel/project.json`; ese archivo NO se comitea).
- [ ] Crear un **`VERCEL_TOKEN`** en Account Settings > Tokens.

**Railway (backend + datos):**
- [ ] Crear un **proyecto** en Railway conectando el repo.
- [ ] Añadir el servicio **`backend`** (nombre EXACTO — lo usa `deploy.yml`). Railway detecta
      `railway.json` → build con **`Dockerfile.backend`**.
- [ ] Añadir el **add-on PostgreSQL 16** (New > Database > PostgreSQL) y el **add-on Redis 7**
      (New > Database > Redis). Railway expone `DATABASE_URL` y `REDIS_URL`.
- [ ] En el servicio `backend` > Variables, **referenciar** esas conexiones:
      `DATABASE_URL=${{ Postgres.DATABASE_URL }}` y `REDIS_URL=${{ Redis.REDIS_URL }}`
      (referencias de Railway; no copies el valor a mano).
- [ ] Crear un **`RAILWAY_TOKEN`** de **proyecto** (Project Settings > Tokens) para el CI.
- [ ] Crear un **environment `staging`** además de `production` en el proyecto Railway (Settings >
      Environments) — `deploy.yml` usa `--environment staging` y `--environment production`.

### 11.B — Cloudflare R2 (SOLO INE del buylist, `kyc_ine/`) — [HUMANO]

> **v1.2.1:** el bucket R2 **se mantiene** pero su **único uso** es custodiar la INE del KYC del
> buylist (prefijo `kyc_ine/`), cifrada y con retención. **Ya no** se configuran prefijos
> `inventory_photo/` (no hay catálogo público) ni `dispute_claim/` (la evidencia de disputa va por
> correo, ver `DISPUTE_EVIDENCE_CONTACT`). No hace falta CDN público ni `S3_PUBLIC_BASE_URL`.

- [ ] Crear un **bucket R2 PRIVADO** (sin acceso público). El prefijo `kyc_ine/` (INE/PII, SEC-A5)
      se sirve **solo por presigned GET** desde el backend; el bucket **no** es público.
- [ ] Crear un **API Token de R2** (Account > R2 > Manage API Tokens) con permiso Object Read & Write
      sobre el bucket. Anota: `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, y el **endpoint S3**
      `https://<accountid>.r2.cloudflarestorage.com` (`S3_ENDPOINT`), `S3_REGION=auto`,
      `S3_BUCKET=<tu-bucket>`, `S3_FORCE_PATH_STYLE=false`. **No** hay `S3_PUBLIC_BASE_URL` en v1.2.1.
- [ ] **[HUMANO — PENDIENTE con dominio real] CORS del bucket** (R2 > bucket > Settings > CORS Policy)
      — **se conserva** para `kyc_ine/`: allow-list **solo** los orígenes reales del front, métodos
      **PUT** y **GET** (presigned upload/download del INE desde el navegador). Nunca `"*"`. Pega este
      JSON **tal cual** en Cloudflare:
      ```json
      [{ "AllowedOrigins": ["https://www.tcgvaultmx.com","https://tcgvaultmx.com"],
         "AllowedMethods": ["PUT","GET"],
         "AllowedHeaders": ["content-type"],
         "MaxAgeSeconds": 3600 }]
      ```
      > **Troubleshooting — la subida del INE falla con "no se pueden cargar":** verificar
      > (a) que el **CORS del bucket** tenga el **origen real** del front (los dos de arriba; el PUT
      > presignado va del navegador directo a R2, así que el origen debe estar allow-listeado), y
      > (b) que el **backend** construya el `S3Client` con `requestChecksumCalculation: WHEN_REQUIRED`
      > (fix de backend en paralelo — no lo toca devops; si falta, R2 rechaza el PUT presignado).
- [ ] **Lifecycle rule** de retención — **se conserva** — sobre el prefijo `kyc_ine/` =
      `INE_RETENTION_DAYS` (180). Es una **capa extra**; el borrado principal lo hace el backend (§15.6).
- [ ] **NO configurar** prefijos `inventory_photo/` ni `dispute_claim/`, ni CDN/bucket público de
      catálogo (eliminados en v1.2.1). El bucket queda íntegramente privado con solo `kyc_ine/`.

### 11.C — Dominios / DNS — [HUMANO]

- [ ] `app.tudominio.com` → **Vercel** (añadir dominio en el proyecto Vercel; sigue el CNAME/registro que
      indica). TLS automático.
- [ ] `api.tudominio.com` → **Railway** (servicio backend > Settings > Networking > Custom Domain; añade
      el CNAME que indica). TLS automático.
- [ ] Fijar en consecuencia: `APP_BASE_URL=https://app.tudominio.com` (Railway) y
      `NEXT_PUBLIC_API_BASE_URL=https://api.tudominio.com/api/v1` (Vercel).

### 11.D — Cargar secrets (lista EXACTA, por plataforma) — [HUMANO]

> Genera los secretos con: JWT `openssl rand -hex 48` (dos distintos); PII `openssl rand -base64 32`
> (dos distintos entre sí); SEED `openssl rand -base64 24`.

**[GH] GitHub Secrets** (Settings > Secrets and variables > Actions) — solo para el pipeline:
- [ ] `RAILWAY_TOKEN` (token de proyecto Railway)
- [ ] `VERCEL_TOKEN`
- [ ] `VERCEL_ORG_ID`
- [ ] `VERCEL_PROJECT_ID`
- [ ] `STAGING_BASE_URL` (p. ej. `https://staging.tudominio.com` — objetivo del DAST)
- [ ] `PROD_BASE_URL` (p. ej. `https://app.tudominio.com`)
- [ ] *(opcional)* `STRIPE_TEST_*` si corres E2E/DAST con Stripe test en CI.

> Si falta cualquiera de los 6 primeros, el job **`preflight` de `deploy.yml` FALLA** con la lista exacta
> y **no despliega**. Es el comportamiento deseado (no un skip silencioso).

**[RW] Railway → servicio `backend` → Variables** (runtime del backend):
- [ ] `NODE_ENV=production`, `APP_BASE_URL`, `DEFAULT_LOCALE=es`
- [ ] `DATABASE_URL=${{ Postgres.DATABASE_URL }}`, `REDIS_URL=${{ Redis.REDIS_URL }}` (referencias Railway)
- [ ] `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (distintos), `JWT_ACCESS_TTL=15m`, `JWT_REFRESH_TTL=30d`
- [ ] `PII_ENCRYPTION_KEY`, `PII_HMAC_KEY` (distintos entre sí; **obligatorios** en no-local o el backend aborta)
- [ ] `STRIPE_SECRET_KEY` (**sk_live_…**), `STRIPE_PUBLISHABLE_KEY` (**pk_live_…**), `STRIPE_WEBHOOK_SECRET`
      (**whsec_…**, se rellena en 11.G tras crear el webhook)
- [ ] `GOOGLE_CLIENT_ID` (login con Google; **mismo** OAuth Client ID que `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
      del front — [VC]. Sin él, el backend rechaza el login con Google)
- [ ] `DISPUTE_EVIDENCE_CONTACT` (correo de contacto de evidencia de disputa; default `soporte@tcgvaultmx.com`)
- [ ] `POKEMONTCG_IO_API_KEY` (metadata del catálogo + ingest legacy/rollback `PRICE_PROVIDER=pokemontcg_io`);
      `POKEMONPRICETRACKER_API_KEY` (**proveedor de PAGA del ingest masivo WS-A** — requisito operativo cuando el
      dial `PRICE_PROVIDER=pokemonpricetracker`; **ya aprovisionada en Railway**, con cuota del plan de paga;
      §19); `POKETRACE_API_KEY` (opcional, stub graded/sealed BE-6)
- [ ] *(opcional)* `PRICE_INGEST_CRON_1`/`_2` (horario del ingest masivo, **UTC**; default `0 0 * * *` y
      `0 12 * * *` = 18:00 y 06:00 CDMX; §19.3). El dial `PRICE_PROVIDER` **NO va aquí** — es un dial de M10
      (ConfigSetting), se flipea por el panel, no por env (§19.5)
- [ ] `S3_ENDPOINT`, `S3_REGION=auto`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`,
      `S3_FORCE_PATH_STYLE=false`, `INE_RETENTION_DAYS=180`  (bucket **solo** `kyc_ine/`; sin `S3_PUBLIC_BASE_URL`)
- [ ] *(opcional)* `KYC_UPLOAD_MAX_BYTES` (tope en bytes del upload de INE; sin valor, el backend usa 10 MiB)
- [ ] `FX_SOURCE=banxico`, `BANXICO_SIE_TOKEN` (SIE de Banxico, gratis; sin él, FX cae a override manual)
- [ ] `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_OPERATOR_EMAIL`, `SEED_OPERATOR_PASSWORD` (fuertes)
- [ ] *(los diales `stripe_fee_*`, markup, envío MX$175, topes, etc. NO son env — viven en M10/ConfigSetting)*

> Repite el bloque [RW] en el **environment `staging`** de Railway, pero con **Stripe en modo TEST**
> (`sk_test_`/`pk_test_`) y secretos propios de staging (nunca los de prod).

**[VC] Vercel → proyecto frontend → Environment Variables** (Production y Preview=staging), solo públicas:
- [ ] `NEXT_PUBLIC_API_BASE_URL` (= `https://api.tudominio.com/api/v1` en prod)
- [ ] `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (**pk_live_…** en prod; pk_test_ en Preview)
- [ ] `NEXT_PUBLIC_DEFAULT_LOCALE=es`
- [ ] `NEXT_PUBLIC_USE_MOCKS=false`  ← **imprescindible** para pegarle al backend real.
- [ ] `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (login con Google; **idéntico** al `GOOGLE_CLIENT_ID` del backend [RW]).

### 11.E — Proteger el Environment `production` — [HUMANO]

- [ ] GitHub > Settings > Environments > **`production`** > **Required reviewers** (tú). Así la promoción a
      prod de `deploy.yml` espera tu aprobación manual aunque el DAST pase.
- [ ] Branch protection de `main`: required status checks `ci-ok`, `sast-ok` y las suites E2E.

### 11.F — Primer deploy y migraciones + seed

- [ ] **[AUTO/DEVOPS]** Disparar el primer deploy: push a `main` (dispara CI → `deploy.yml`) **o** manual
      con `workflow_dispatch`. El backend, al arrancar en Railway, corre **`prisma migrate deploy`**
      (crea tablas + `inventory_folio_seq`). Es idempotente en cada arranque.
- [ ] **[DEVOPS] Seed inicial — UNA sola vez** por entorno (diales M10 + super_admin + vault_operator +
      ubicaciones base). Desde el proyecto Railway:
      ```bash
      railway run --service backend --environment production npm run seed
      ```
      (equivale a `ts-node prisma/seed.ts`; la imagen conserva `ts-node` — ver §6.2). **No** re-seedear en
      cada deploy. Tras el seed, **rota** las credenciales sembradas al primer login (SEC-C1).
- [ ] **[HUMANO]** Ajustar los diales en M10 (markup de venta, tarifa Stripe MX del gross-up, tope de
      reposición por carta) desde el back-office.
- [ ] **Regla de oro:** toma **snapshot** de la DB de prod (Railway > Postgres > Backups) **antes** de cada
      `migrate deploy` futuro que traiga un cambio de esquema.

### 11.G — Webhook de Stripe en producción — [HUMANO]

- [ ] Stripe Dashboard (live) > Developers > Webhooks > **Add endpoint**:
      `https://api.tudominio.com/api/v1/webhooks/stripe`.
- [ ] Habilitar eventos: `payment_intent.succeeded`, `payment_intent.payment_failed`,
      `payment_intent.canceled`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`,
      `charge.dispute.funds_reinstated`.
- [ ] Copiar el **`whsec_…`** a `STRIPE_WEBHOOK_SECRET` en Railway (11.D [RW]) y **redeploy** del backend.
      (El backend preserva el raw body en esa ruta — ver §3; no pongas un proxy que lo altere.)

### 11.H — Endurecimiento previo a público (cambios de código → **rol backend**, no devops)
- [x] **BE-8** (RESUELTO): CORS ya restringido a `APP_BASE_URL` (allow-list en `main.ts`, SEC-M2). Acción
      devops: fijar `APP_BASE_URL` al dominio del front en Railway (ver §Monitoreo/CORS).
- [ ] **BE-5**: cablear el scheduling BullMQ de los 4 jobs (price-sync, fx-refresh, buylist-sweep,
      dispute-deadline) a `REDIS_URL`, para que las tareas diarias y los plazos 7d/30d corran solos.
      Mientras tanto: `POST /admin/pricing/sync` y `POST /admin/fx/refresh` disparan a mano; `buylist-sweep`
      y `dispute-deadline` no tienen endpoint aún.
- [ ] **BE-7**: compensar reserva si Stripe falla tras commitear (evitar items `reserved` huérfanos).

### 11.I — Verificación post-deploy — [DEVOPS]
- [ ] Healthcheck de la API responde: `GET /api/v1/health` devuelve 200 (o 503 si degraded). Cableado en
      `railway.json` (`healthcheckPath` + `healthcheckTimeout: 300`) — ver §6.3. En Railway, el servicio
      debe quedar en estado *Active/healthy*.
- [ ] Un flujo de compra en modo test (Stripe test keys en staging) → carta entra a bóveda
      `pending → settled` vía webhook `payment_intent.succeeded`.
- [ ] Subida de una **INE** de prueba (`kyc_ine/`) vía presigned PUT al bucket, y su lectura por presigned GET.
- [ ] Un `charge.dispute.created` de Stripe CLI es **consciente del estado físico** de la carta:
      - Caso en-bóveda: el item sigue en custodia → revierte a inventario de plataforma (`platform/listed`).
      - Caso enviada/entregada: el item ya salió → **no** re-agrega al inventario y marca `chargebackNeedsManual`
        para revisión manual.

### 11.J — Banderas legales/fiscales — [HUMANO] (no bloquean infra; sí operar con público real)
- [ ] Legal de custodia/depositario y contrato de custodia. Fiscal buylist/SPEI. CFDI manual por correo
      (timbrado PAC = fase 2). ToS de las APIs de precio. Ver `PROJECT.md` › Riesgos.

### 11.K — Metas de lanzamiento — [HUMANO]
- [ ] Fijar N/X/Y/Z (usuarios, ventas settled, buylist pagadas, retiros sin disputa) al abrir la beta
      cerrada. No bloquean el deploy técnico.

### 11.L — Rollback (por plataforma + datos)

| Escenario | Acción |
|---|---|
| **Frontend roto (Vercel)** | Vercel > Deployments > deploy anterior bueno > **Promote to Production** (o **Rollback**). Instantáneo. |
| **Backend roto (Railway)** | Railway > servicio `backend` > Deployments > deploy previo > **Redeploy/Rollback**. |
| **Vía Git** | `git revert <sha>` del merge malo + push a `main` → CI + `deploy.yml` redespliegan la versión sana. |
| **Migración de DB mala** | **Restaurar** desde el backup/point-in-time de Railway Postgres (por eso el snapshot **antes** de migrar, 11.F). Prisma no auto-revierte: preparar migración correctiva o `prisma migrate resolve`. |
| **Dial M10 equivocado** | Corregir el dial en el back-office (sin redeploy); queda en `AuditLog`. |
| **Secreto filtrado** | Rotar en el proveedor + actualizar en Railway/Vercel/GitHub + redeploy (ver §15.2). |

> Orden de oro: **datos primero** (snapshot antes de migrar), luego código. Detalle general en §7.

---

## 12. Estado de cierre y por qué NO se declara "desplegado"

- **DoD**: 4 de 5 ítems **cumplidos**; el 5º ("devops desplegó") está **documentado y listo como runbook**
  pero **no ejecutado** por ausencia de daemon Docker y credenciales de producción en esta sesión.
- **Tag/release**: **no se crea** un tag de versión desplegada porque **no hay deploy**. Sería
  deshonesto etiquetar una release "en producción" que no existe. El código está listo para tag en cuanto
  se ejecute el runbook §11 con credenciales reales (sugerencia de versión: `v1.0.0-mvp`).
- **Conclusión honesta**: el proyecto está **"listo para desplegar en cuanto haya credenciales"**. No hay
  bloqueo técnico de infraestructura del lado de devops; el bloqueo es de **credenciales/entorno del
  humano** (checklist §11.A–C) más el endurecimiento de código en §11.E que corresponde al rol backend.

---

## 13. Entorno de STAGING (datos sintéticos)

Staging es un **espejo aislado** del stack para correr E2E en vivo y DAST **sin tocar prod ni datos
reales de clientes**. Está definido en `docker-compose.staging.yml` (mismas plataformas en el staging
real: Vercel + Railway + R2, en un environment/proyecto separado).

**Aislamiento** respecto al `docker-compose.yml` local:

- Project name `tcg-staging` (red y contenedores separados) y volúmenes propios (`*_staging`).
- Base de datos **separada** (`tcg_staging`) y bucket/Redis propios.
- Puertos desplazados para convivir con el stack local: Postgres `5433`, Redis `6380`, MinIO `9010/9011`,
  backend `3011`, frontend `3010` (configurables con `STAGING_*_PORT` en `.env`).
- Backend en `NODE_ENV=production` (validaciones estrictas) pero con **Stripe en modo TEST** siempre.

**Datos sintéticos** — `scripts/seed-synthetic.sh`:

- Delega en el seed sintético del backend (`npm run seed:synthetic`, o `SEED_MODE=synthetic`).
  Genera usuarios/cartas/órdenes/buylist **ficticios y deterministas** para E2E repetibles.
- Tiene una **salvaguarda**: aborta si `DATABASE_URL` no parece staging/local, para **nunca** correr
  contra producción. Regla de oro: **en staging jamás van datos reales de clientes**.

```bash
# Levantar staging con apps + sembrar datos sintéticos (local, requiere Docker):
docker compose -f docker-compose.staging.yml --profile apps up -d --build
./scripts/seed-synthetic.sh
# Frontend de staging: http://localhost:3010   ·   API: http://localhost:3011/api/v1
docker compose -f docker-compose.staging.yml down -v   # apaga y borra datos de staging
```

> **Pendiente de backend/frontend para el harness E2E** (nombres de script asumidos por el CI):
> backend debe exponer `npm run test:integration` y `npm run seed:synthetic`; frontend debe exponer
> `npm run test:e2e` (contra `E2E_BASE_URL`). Sin esos scripts, `e2e.yml` **falla a propósito** con un
> mensaje claro (es un gate real, no un skip silencioso).

---

## 14. Runbook de seguridad (SAST / DAST / E2E) y prueba puntual contra prod

Modelo acordado con el humano: **staging siempre + prod puntual autorizado**, **automatización completa**.
El tooling (config/infra) vive en `security/` (propiedad devops). La **metodología de ataque** vive en
`docs/PENTEST_NOTES.md` (rol **pentester**) y el **veredicto** en `docs/SECURITY_NOTES.md` (rol
**seguridad**). Devops solo provee el andamiaje y los gates.

### 14.1 Qué corre y dónde

| Workflow | Disparo | Qué hace | Bloquea |
|---|---|---|---|
| `security-sast.yml` | cada PR/push | semgrep + gitleaks + npm audit + trivy (fs+image) | sí, en high/critical. **ACTIVO ya.** |
| `e2e.yml` | cada PR/push | boota Postgres/Redis/MinIO + `test:integration` (backend) y `test:e2e` (frontend) | sí, si falla una suite. **Activo cuando existan los scripts.** |
| `deploy.yml` | **solo `workflow_dispatch`** (manual). El `workflow_run` de CI quedó **comentado**; ver §16.4 | `secrets-gate` → deploy staging (Railway+Vercel) → DAST (ZAP baseline + nuclei) → promoción a prod | promoción a prod **bloqueada** si hay críticos + Environment `production`. **CD redundante** (los deploys van por integraciones nativas); si faltan secrets, se **salta limpio** (no falla). Reactivación en §16.4. |
| `security-scheduled.yml` | cron semanal (lun 06:00 UTC) | ZAP full + nuclei contra staging | reporta/alarma; no bloquea. **Plantilla (pendiente `STAGING_BASE_URL`).** |

Todos los escáneres están parametrizados por `TARGET_URL` y tienen **guardia anti-producción**
(`ALLOW_PROD_DAST=1` requerido, ver §14.3). Ejecutables local con los scripts de `security/scripts/`
(ver `security/README.md`).

### 14.2 Cómo se levanta staging con datos sintéticos (ver §13)

`docker compose -f docker-compose.staging.yml --profile apps up -d --build` + `./scripts/seed-synthetic.sh`.
En el staging desplegado (Railway/Vercel), el seed sintético lo corre el pipeline tras el deploy.

### 14.3 Procedimiento de prueba puntual AUTORIZADA contra producción

El DAST/pentest contra prod es **excepcional** y **nunca** automático (no hay cron contra prod). Requisitos
que devops exige antes de levantar la guardia `ALLOW_PROD_DAST=1`:

1. **Autorización por escrito** del dueño del negocio (súper-admin): alcance, fecha y firma. Se adjunta o
   referencia en `docs/SECURITY_NOTES.md`. Sin ella, no se corre.
2. **Ventana acordada** (fecha/hora, duración) fuera de horas pico; avisar a operación.
3. **Alcance/scope explícito**: dominios/rutas incluidos y **excluidos** (p. ej. no tocar el webhook de
   Stripe live ni endpoints de dinero saliente con payloads destructivos). Nada fuera del scope.
4. **Rate-limit** conservador (`NUCLEI_RATE_LIMIT`, `FFUF_RATE`, `-m` de ZAP) para no degradar el servicio.
5. **Aviso al proveedor si aplica**: Vercel/Railway/Cloudflare pueden requerir notificación previa de
   pruebas de seguridad; revisar sus políticas antes de escanear infra gestionada.
6. **Datos**: preferir cuentas de prueba; **no** exfiltrar ni alterar datos reales de clientes. Las
   herramientas intrusivas (`sqlmap`, `ffuf`, ZAP full) van con `--risk`/`--level` bajos salvo acuerdo.
7. **Rollback / plan de aborto**: si el escaneo degrada el servicio, detener (`Ctrl-C`/cancelar job) y, si
   hubo cambios, restaurar desde snapshot (ver §7). Tomar snapshot de la DB **antes** de la ventana.
8. **Registro**: guardar reportes (`security/reports/`, git-ignorados) y resumir hallazgos en
   `docs/SECURITY_NOTES.md`; los críticos vuelven al rol dueño del código (backend/frontend) vía el flujo
   normal (nunca los corrige devops).

Solo dentro de esa ventana y cumplidos 1–7 se corre, p. ej.:

```bash
ALLOW_PROD_DAST=1 TARGET_URL=https://app.tudominio.com ./security/scripts/dast-zap-baseline.sh
```

Fuera de la ventana: `ALLOW_PROD_DAST=0` (o sin definir). Los scripts abortan solos si detectan que
`TARGET_URL` parece prod sin la bandera.

### 14.4 Qué falta para activar los gates de deploy/DAST

- `security-sast.yml` y (con los scripts de backend/frontend) `e2e.yml`: **ya activos**, sin secrets.
- `deploy.yml`: **CD redundante** (los deploys reales van por integraciones nativas Vercel/Railway).
  Desde 2026-08-16 corre **solo a mano** (`workflow_dispatch`) y el job `secrets-gate` lo **salta
  limpiamente** si faltan los GitHub Secrets, en vez de romper en `preflight` (ver **§16.4**). Para
  reactivarlo como CD por Actions: cargar los 6 secrets (`RAILWAY_TOKEN`, `VERCEL_TOKEN`,
  `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `STAGING_BASE_URL`, `PROD_BASE_URL`), proteger el Environment
  `production` con *required reviewers* (§11.D–E) y, opcional, descomentar el `workflow_run` del `on:`.
- `security-scheduled.yml`: cargar `STAGING_BASE_URL` para el DAST full semanal.

---

## 15. Remediación de seguridad (hallazgos de `docs/SECURITY_NOTES.md`)

Cambios de infraestructura hechos por devops para los hallazgos que le tocan. Los de código
(backend/frontend) siguen abiertos con su rol dueño y se listan al final como dependencias.

### 15.1 SEC-A5 — Object storage privado (INE/KYC/PII)

- **Prod (R2/S3):** bucket **privado**, sin lectura pública anónima (Block Public Access / sin política
  pública). En v1.2 su único contenido es el prefijo `kyc_ine/`, servido **solo por presigned GET de
  vida corta** por el backend. Ya **no** existe `S3_PUBLIC_BASE_URL` ni prefijo público
  `inventory_photo/`, ni evidencia de disputa en bucket (`dispute_claim/` eliminado; la evidencia va por
  correo `DISPUTE_EVIDENCE_CONTACT`).
- **CORS del bucket:** allow-list solo los orígenes reales del front (`APP_BASE_URL`), métodos
  **PUT** y **GET**. Nunca `AllowedOrigins: ["*"]`. Política R2/S3 lista para pegar en Cloudflare:

  ```json
  [{ "AllowedOrigins": ["https://www.tcgvaultmx.com","https://tcgvaultmx.com"],
     "AllowedMethods": ["PUT","GET"],
     "AllowedHeaders": ["content-type"],
     "MaxAgeSeconds": 3600 }]
  ```

- **Local/staging (MinIO):** `createbuckets` deja el bucket **100% privado** (`mc anonymous set none`).
  v1.2.1: **ya no** se publica el prefijo de catálogo (`inventory_photo`) — no hay `mc anonymous set
  download`. Una corrida vieja con lectura pública queda reprivatizada al re-levantar. Efecto: en local,
  la INE (`kyc_ine/`) nunca carga por URL pública — es lo correcto; carga cuando backend sirva por
  presigned GET.

### 15.2 SEC-C1 — Secretos y credenciales sembradas

- `.env.example`: **sin defaults débiles** para credenciales administrativas. `SEED_ADMIN_PASSWORD`,
  `SEED_OPERATOR_PASSWORD` (nueva) y `SEED_OPERATOR_EMAIL` (nueva) van vacías con la marca
  *"OBLIGATORIO, generar fuerte"*. Ambos compose pasan las 4 variables al backend.
- **Pendiente de backend:** eliminar los fallbacks débiles del seed (`ChangeMe123!` del admin y la
  `Operador123!` **hardcodeada** del operador) y leer `SEED_OPERATOR_PASSWORD` como obligatoria. Hasta
  entonces la mitigación devops es: definir las env fuertes + **rotar tras el primer login**.

**Rotación de secretos (runbook):**
1. **JWT (`JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`):** generar nuevos (`openssl rand -hex 48`),
   cargar en el secret manager de la plataforma, redeploy backend. **Efecto:** invalida todas las
   sesiones → los usuarios re-login. Rotar los dos juntos.
2. **Credenciales sembradas (admin/operador):** cambiar la contraseña desde el panel; si se filtró la
   del operador del repo, cambiarla **ya** (era `Operador123!`). No re-seedear en prod con defaults.
3. **Stripe / APIs de precio / Banxico:** rotar la clave en el proveedor, actualizar el secret manager,
   redeploy. Para Stripe, recrear el webhook y actualizar `STRIPE_WEBHOOK_SECRET`.
4. **Object storage (`S3_*`):** rotar el par de llaves en R2/S3, actualizar el secret manager, redeploy.
5. **Postgres/Redis:** rotar credenciales del proveedor gestionado; actualizar `DATABASE_URL`/`REDIS_URL`.
6. **PII (`PII_ENCRYPTION_KEY`/`PII_HMAC_KEY`):** ver §15.6 — implica **re-cifrar** los datos (y recalcular
   el blind index si rota la HMAC). En greenfield sin datos es trivial (basta cargar las nuevas y redeploy).
7. **Regla:** los secretos viven en el secret manager de la plataforma, **nunca** en el repo ni en un
   `.env` versionado. `gitleaks` (en `security-sast.yml`) vigila fugas en cada push.

**Rate-limit / WAF en el borde (mitiga SEC-C1 fuerza bruta de login):**
- El lockout/throttle de `/auth/login` y `/auth/register` es **backend** (`@nestjs/throttler`, abierto).
- **En el borde (recomendado, complementario):** activar el WAF/rate-limit del proveedor —
  **Cloudflare** delante de Vercel/Railway (Rate Limiting Rules sobre las rutas de auth + reglas
  OWASP del WAF managed), o el rate-limit nativo de Railway. Objetivo: acotar intentos por IP a las
  rutas de login/registro y money-out antes de que lleguen al backend.

### 15.3 SEC-M4 — Compose sin defaults inseguros expuestos

- Puertos de datos (Postgres/Redis/MinIO API+consola) publicados **solo en `127.0.0.1`** en
  `docker-compose.yml` y `docker-compose.staging.yml`. No se exponen a `0.0.0.0`/LAN.
- Credenciales por **variable de entorno** (los defaults inline son de **dev local** explícito y ahora
  solo alcanzables desde localhost). En prod los valores vienen del secret manager (no de estos defaults).

### 15.4 SEC-C2 — Gate SAST que bloquea el bump de dependencias

- `security-sast.yml` **ya falla en high/critical** vía `npm audit` (runtime, `--omit=dev`),
  `trivy fs` y `trivy image` (HIGH/CRITICAL, `exit-code: 1`). **Confirmado.** Cubre el bump de
  `next`/`next-intl`/`postcss` (frontend) y `express`/`multer`/`qs` (backend) — cuando el rol
  backend/frontend suba versiones, el pipeline lo verifica.
- **Endurecido:** añadido un paso **informativo no bloqueante** que audita también `devDependencies`
  (criticals de tooling tipo `vitest`) para dejar el hallazgo visible en el log del PR sin frenar el
  pipeline (deuda de supply-chain de tooling, aceptada).
- **Required check:** `sast-ok` (de `security-sast.yml`) debe estar como *required status check* en la
  protección de la rama de release, junto con `ci-ok`.

### 15.5 Hallazgos que NO son de devops (dependencias abiertas)

Estos siguen abiertos con su rol dueño (devops no toca código de app):
- **backend:** SEC-C1 (throttler + operador por env), SEC-A1/A2/A3 (buylist/conversión atómicas),
  SEC-A4 (proyección PII para `vault_operator`), **SEC-A5 parte app** (servir la INE `kyc_ine/` por
  presigned GET; v1.2.1 ya no usa `S3_PUBLIC_BASE_URL`), SEC-C2 (bump de deps), y deuda SEC-M1/M3/M5/B1..B4.
- **frontend:** SEC-M2 (token fuera de `localStorage`) + SEC-C2 (bump `next`/`next-intl`/`postcss`).

> Mientras SEC-A5 (parte backend) no esté, la INE (`kyc_ine/`) **no se sirve** en local (el bucket
> ya es privado); esto es intencional y correcto. El deploy a prod no debe activar lectura pública del
> bucket para "arreglar" la visualización: la solución es el presigned GET del backend.

### 15.6 Endurecimiento de PII — cifrado (CLABE/RFC) + retención de INE

Apoyo de infraestructura al endurecimiento de PII que implementa **backend** (el cifrado, el blind
index y el job de borrado por retención son código de `backend/`; devops solo aporta las llaves, su
gestión y la capa extra de retención en el bucket).

**Llaves (`.env.example`, ambos compose → backend):**

| Llave | Uso | Reglas |
|---|---|---|
| `PII_ENCRYPTION_KEY` | AES-256 para cifrar CLABE/RFC en reposo (BD) | `openssl rand -base64 32`; **OBLIGATORIA en no-local** (backend aborta si falta); en prod por **KMS/secret manager** |
| `PII_HMAC_KEY` | HMAC del **blind index** de CLABE (match/dedup sin descifrar) | `openssl rand -base64 32`; **DISTINTA** de `PII_ENCRYPTION_KEY`; **OBLIGATORIA en no-local**; KMS en prod |

- **Local (`docker-compose.yml`):** ambas se pasan al backend **vacías por default** (`:-`) — válido en
  greenfield sin datos. Si backend endurece la validación también en dev, genera las dos y ponlas en `.env`.
- **Staging (`docker-compose.staging.yml`):** staging corre en `NODE_ENV=production` (validación estricta),
  así que son **obligatorias**; en local caen a dummies **distintas entre sí** (`STAGING_PII_ENCRYPTION_KEY`
  / `STAGING_PII_HMAC_KEY`), y en el staging real las inyecta el secret manager. Nunca valores de prod.
- **Prod:** viven **solo** en el KMS/secret manager de la plataforma (Railway secrets / KMS). Nunca en el
  repo ni en un `.env` versionado; `gitleaks` (SAST) vigila fugas.

**Gestión por KMS / secret manager (prod):**
- Cargar `PII_ENCRYPTION_KEY` y `PII_HMAC_KEY` como secrets del servicio backend (no build args: son de
  runtime, del lado servidor, nunca `NEXT_PUBLIC_*`). Idealmente respaldadas por un KMS (envelope
  encryption) o, como mínimo, el secret store cifrado del proveedor con acceso restringido y auditado.
- Deben estar presentes **antes** del primer arranque del backend en no-local (si no, aborta por diseño).

**Rotación de las llaves de PII (runbook):**
> Rotar una llave de PII **no** es como rotar un JWT: los datos ya cifrados/indexados dependen de la llave
> vieja. Hay que **re-cifrar** (y, si rota la HMAC, **recalcular el blind index**) fila por fila.
1. **Greenfield (sin datos reales de PII) — caso actual:** trivial. Generar la(s) nueva(s) llave(s),
   cargarlas en el secret manager, **redeploy**. Como no hay CLABE/RFC almacenados, no hay nada que
   re-cifrar. Es el escenario de este MVP hasta que entren clientes reales.
2. **Con datos en prod:**
   a. Generar la nueva llave y cargarla en el secret manager **junto a la vieja** (el backend necesita
      soportar leer-con-vieja / escribir-con-nueva; esto es capacidad de **backend** — coordínalo con ese rol).
   b. Correr una **migración de re-cifrado** (job de backend) que descifra con la llave vieja y re-cifra
      con la nueva; si rota `PII_HMAC_KEY`, recalcula el blind index de cada CLABE.
   c. **Tomar snapshot de la BD antes** (regla de oro del rollback §7).
   d. Cuando 100% de filas estén migradas, **retirar la llave vieja** del secret manager y redeploy.
- **Separación de dominios:** rotar `PII_ENCRYPTION_KEY` y `PII_HMAC_KEY` de forma **independiente**;
  mantenerlas **distintas** siempre (misma llave para cifrado y HMAC anula la protección del blind index).

**Retención de INE — lifecycle del bucket (capa extra, `INE_RETENTION_DAYS`):**
El borrado efectivo de las INE (`kyc_ine/`) lo hace el **backend** (job de retención). Como **segunda
capa** (defensa en profundidad, por si ese job falla), el bucket tiene una **regla de expiración** sobre
el prefijo `kyc_ine/` alineada con `INE_RETENTION_DAYS`:
- **Local/staging (MinIO):** el init container `createbuckets` fija la regla con
  `mc ilm rule add --expire-days ${INE_RETENTION_DAYS} --prefix 'kyc_ine/' <alias>/<bucket>` (con fallback
  a la sintaxis vieja `mc ilm add --expiry-days`; si la imagen de `mc` no soporta ILM, imprime un aviso y
  no rompe el arranque — el borrado del backend sigue siendo la vía principal).
- **Prod (Cloudflare R2 / AWS S3):** configurar una **Lifecycle rule** equivalente en el proveedor,
  prefijo `kyc_ine/`, expiración = `INE_RETENTION_DAYS` días. Ejemplo S3:

  ```json
  { "Rules": [{
      "ID": "expire-kyc-ine",
      "Filter": { "Prefix": "kyc_ine/" },
      "Status": "Enabled",
      "Expiration": { "Days": 180 }
  }] }
  ```

  (En R2, la regla equivalente de Object lifecycle por prefijo `kyc_ine/`.)
- **Fuente de verdad:** si la retención es un **dial de M10** (ConfigSetting) del lado backend, mantén
  `INE_RETENTION_DAYS` y la regla del bucket **con el mismo número** que el dial. El valor concreto quedó
  **fijado en 180 días** por decisión de negocio (legal/fiscal), **alineado con el dial M10 del backend**
  (fuente de verdad del borrado; ver PROJECT.md › Riesgos). El lifecycle del bucket es un **respaldo**, no
  sustituye ni al borrado del backend ni al requisito legal de conservación mínima.

---

## 16. Saneamiento de los workflows de CI/gates (2026-08-16)

> Contexto: los workflows de Actions (CI, Security SAST, E2E, deploy) llevaban en **rojo**
> toda la historia del repo. Los deploys reales van por integraciones **nativas** Vercel/Railway,
> pero los gates del DoD (SAST/E2E/CD) no estaban protegiendo nada. Se saneó el **rojo espurio**
> dejando los gates **funcionando de verdad** (no anulados). Nada de esto toca `backend/` ni
> `frontend/`; los hallazgos de código se enrutan al rol dueño (abajo).
>
> **Limitación del entorno de esta sesión:** el sandbox **bloquea el pull de imágenes Docker**
> (403 de política de egress en el CDN de Docker Hub) y la **registry de semgrep** (`semgrep.dev`,
> 403). Por eso NO se pudo reproducir localmente ni los jobs dockerizados de E2E ni las reglas
> `p/*` de semgrep. Sí se reprodujo semgrep con las **reglas locales** vía `pip install semgrep`
> en un venv. Lo no reproducible queda marcado como **verificar en runner CI**.

### 16.1 SAST · Trivy — versión de acción inexistente (ARREGLADO)

- **Causa:** `security-sast.yml` fijaba `aquasecurity/trivy-action@0.24.0` en 3 sitios (`trivy-fs`,
  `trivy-image` ×2). Ese **tag no existe**: los tags de la acción llevan prefijo **`v`**
  (`v0.24.0`, …). El runner fallaba con `Unable to resolve action ... unable to find version 0.24.0`.
- **Fix:** pin a **`aquasecurity/trivy-action@v0.33.1`** en las 3 referencias. Elegido por ser un
  release **estable con parche** cuyo esquema de inputs (`scan-type`, `scan-ref`, `image-ref`,
  `severity`, `exit-code`, `ignore-unfixed`, `format`) se **verificó compatible** (existe en
  `git ls-remote --tags`; inputs confirmados en su `action.yaml`). El gate sigue **fallando en
  HIGH/CRITICAL** (`exit-code: "1"`), sin cambios de rigor.

### 16.2 SAST · Semgrep — config inválida + FP + gate mal calibrado (ARREGLADO)

Tres problemas, todos en archivos **propiedad devops** (`security/semgrep.yml`, `security-sast.yml`):

1. **Config inválida (rompía TODO el job, no eran "hallazgos"):** `security/semgrep.yml` tenía
   **dos errores de schema** que hacían abortar semgrep (`RuleParseError`, exit 7/8) antes de
   escanear nada — de ahí el rojo permanente:
   - Regla `stripe-webhook-verify-signature`: colgaba un `pattern-not-inside` de un
     `pattern-either` (este solo admite patrones **positivos**). Corregido a un `patterns:` (AND).
   - Regla `react-dangerously-set-innerhtml`: `languages: [tsx, typescript]` — **`tsx` no es un id
     de lenguaje válido** en semgrep actual (el parser `typescript` ya cubre `.tsx`/JSX). Corregido
     a `languages: [typescript]`.
   Tras el fix, la config **parsea limpia** (5 reglas, 0 errores de config; verificado local).
2. **Falso positivo ERROR (high) — el único hallazgo de severidad alta de las reglas locales):**
   la regla `stripe-webhook-verify-signature` marcaba `backend/src/modules/payments/stripe.service.ts:121`
   —que es **precisamente** la función que verifica la firma (`this.stripe.webhooks.constructEvent(...)`)—.
   La heurística vieja ("constructEvent fuera de try/catch") confundía **manejo de error** con
   **control de seguridad**: la firma **sí** se verifica ahí. **Fix (devops, en la propia regla):**
   ahora exige que `constructEvent` se llame con sus **3 argumentos** (payload crudo, firma y
   secret) y **excluye** esa forma correcta con un `pattern-not`; solo dispara ante un uso inseguro
   (p. ej. 2 args, sin secret). Verificado con muestras ok/bad: 0 FP sobre el código real.
3. **Gate mal calibrado:** el job usaba `--error` **a secas**, que rompe ante **cualquier** hallazgo
   (incluidas 26 WARNING de heurísticas medias locales: recordatorios `money-out-requires-guard`,
   `no-secret-in-logs`), **contradiciendo** la propia cabecera del workflow ("GATE: FALLA en
   high/critical"). **Fix:** el job ahora corre en **dos pasos** (patrón del job `npm-audit`):
   - (1) **informe completo** (todas las severidades) → **SARIF** a la pestaña Security, **no bloquea**;
   - (2) **GATE** con `--severity=ERROR --error` → **bloquea solo en high/critical**.
   Las WARNING quedan como **visibilidad** (SARIF), no rompen el pipeline.
- **Estado tras el fix (reglas locales):** 0 hallazgos **ERROR**, 26 **WARNING** (visibilidad).
  Ningún high/critical real de las reglas locales.
- **Pendiente / verificar en runner CI:** las reglas `p/*` de la registry no se pudieron correr
  localmente (egress bloquea `semgrep.dev`). Si en CI alguna regla `p/*` de **severidad ERROR**
  dispara sobre código real, el gate lo **bloqueará correctamente** (no es espurio) y el hallazgo se
  **enruta al rol dueño** (backend/frontend) con archivo:línea — devops no corrige código de app.
- **Las 26 WARNING** (visibilidad) son heurísticas ruidosas de reglas locales (p. ej. `money-out`
  marca controladores admin aunque tengan guard, `no-secret-in-logs` marca logs con variables cuyo
  nombre "suena" a secreto). Si el rol **seguridad** quiere convertir alguna en gate real, se afina la
  regla; hoy son informativas por diseño.

### 16.3 E2E — harness (config arreglada; app pendiente de dueño)

`e2e.yml` corre `backend-e2e` (Postgres/Redis/MinIO como *services* + `npm run test:integration`) y
`frontend-e2e` (levanta `docker-compose.staging.yml --profile apps` + Playwright).

- **Arreglado (config/infra, propiedad devops):** el *service* `minio` (imagen `bitnami/minio`, minideb
  **sin `curl`**) tenía un `--health-cmd "curl .../minio/health/live"` que **nunca pasa dentro del
  contenedor** → el service queda *unhealthy* y **GitHub aborta el job** antes de correr un test. Se
  **quitó ese healthcheck** y la readiness de MinIO se comprueba **desde el runner** (que sí tiene
  `curl`) en un paso nuevo "Esperar a que MinIO responda". Postgres/Redis conservan su healthcheck
  (sus imágenes traen `pg_isready`/`redis-cli`).
- **Revisado y OK (no era bug):** `backend-e2e` corre `migrate deploy` + `seed:synthetic` de forma
  **redundante** (una vez en pasos explícitos y otra dentro de `test:integration`), pero el seed
  (`backend/prisma/seed-e2e.ts`) es **idempotente** (`upsert`) y `migrate deploy` también → no rompe;
  solo cuesta unos segundos. Se deja así para no tocar la lógica del script del rol backend.
- **NO reproducible localmente:** el sandbox **no puede pull-ear imágenes** (egress 403), así que no se
  pudo levantar Postgres/Redis/MinIO ni construir el stack de staging. La corrección del healthcheck es
  de **alta confianza** (patrón conocido de fallo de `bitnami/minio` como *service* con healthcheck de
  `curl`), pero el **verde final del harness debe confirmarse en el runner CI**.
- **Pendiente de rol dueño (si el harness sigue rojo tras el fix de infra) — no lo toca devops:**
  - **backend:** si la suite `backend/test/integration/*.e2e-spec.ts` falla por lógica de app, es del
    rol **backend** (coordina con el arreglo en curso del aislamiento `REDIS_URL` del job **CI·backend**
    en `ci.yml`, que lleva otro agente).
  - **frontend:** `frontend-e2e` depende de que el backend de staging **arranque en `NODE_ENV=production`**
    (valida PII/JWT estrictos; los dummies del compose deben satisfacer la validación) y de que el runner
    de Playwright lea `E2E_BASE_URL` (config de `frontend/`, propiedad del rol frontend). Ambos son de
    **frontend/backend**, no de devops.
- **Peso de `frontend-e2e`:** construye **dos imágenes** + stack completo en **cada push/PR** — es el job
  más pesado y el más propenso a rojo/flaky en el runner estándar. **Recomendación devops** (no aplicada
  para no alterar la semántica de *required check* del gate): moverlo a un runner mayor o ejecutarlo en su
  propio momento (p. ej. solo en PR a `main` + `workflow_dispatch`) en vez de en cada push a cada rama.
  **No** se añadió `paths-ignore` porque, siendo E2E un *required status check*, un PR de solo-docs
  quedaría **bloqueado** (un required check que nunca corre queda *pending*). Queda como decisión de
  equipo documentada.

### 16.4 deploy.yml — CD redundante que fallaba por secrets (GUARDADO, sin secrets)

- **Causa:** `deploy.yml` se disparaba con `workflow_run` de **CI** en `main` y su job `preflight`
  **fallaba a propósito** en cada push porque no existen los 6 GitHub Secrets de deploy
  (`RAILWAY_TOKEN`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `STAGING_BASE_URL`,
  `PROD_BASE_URL`). Como los deploys reales van por **integraciones nativas** Vercel/Railway, este CD
  por Actions es **redundante** y solo ensuciaba el pipeline.
- **Fix (sin secrets, sin hardcodear nada):**
  1. **Se quitó el trigger `workflow_run`** → el workflow **ya no corre automáticamente** (deja de
     ensuciar cada push). Queda solo `workflow_dispatch` (manual). El bloque `workflow_run` se dejó
     **comentado** en el `on:` para poder reactivarlo.
  2. **Nuevo job `secrets-gate`** que detecta si los 6 secrets están presentes y expone `ready`.
     `ci-ok` (y toda la cadena de deploy) tiene `if: needs.secrets-gate.outputs.ready == 'true'`.
     Si faltan, los jobs de deploy quedan **skipped (neutral, NO failure)** con un `::notice::` claro,
     en vez de romper en `preflight`. `preflight` se conserva como doble verificación para cuando SÍ
     estén cargados.
- **Cómo REACTIVAR el CD por GitHub Actions** (si algún día se quiere en vez de las integraciones
  nativas): (a) cargar los **6 GitHub Secrets** (ver §11.D `[GH]`); con eso `secrets-gate` deja pasar
  el pipeline y `preflight` valida como antes. (b) *Opcional*, para CD en cada release, **descomentar**
  el bloque `workflow_run` del `on:` de `deploy.yml`. (c) proteger el Environment `production` con
  *required reviewers* (§11.E).

### 16.6 Segunda ronda — rojo que persistió tras §16 (2026-08-16, commit base 83907bc → fc4ea4c)

> Tras §16 quedaron **tres** jobs rojos por config/tooling (no por hallazgos reales). Diagnóstico y
> fix con `actionlint` (validación de sintaxis de Actions) + inspección del `action.yml`/`install.sh`
> de las acciones + la API de Docker Hub. El sandbox **bloquea el pull de imágenes Docker**,
> `api.pokemontcg.io` y el **blob de logs de Actions** (`*.blob.core.windows.net`, 403 de política de
> egress), así que el *cuerpo* del log del step no se pudo descargar; se trabajó con el **desglose de
> steps** de la API de jobs (qué step exacto falló) + lectura de config.

**(A) SAST · Trivy — el binario no se instalaba (rate-limit del instalador) — ARREGLADO.**
- **Causa exacta:** `aquasecurity/trivy-action@v0.33.1` delega la instalación en `setup-trivy`
  (`aquasecurity/setup-trivy@e6c2c5e`, ≈v0.2.4), que ejecuta `contrib/install.sh` (godownloader). Ese
  script resuelve el tag con una llamada **sin autenticar** a
  `https://github.com/aquasecurity/trivy/releases/v0.65.0` (`Accept: application/json`) y **no lee ningún
  token** (verificado leyendo `install.sh`: su `github_release()`/`tag_to_version()` no añaden cabecera de
  auth). En las IPs compartidas de los runners se topa con el **rate-limit del endpoint web de GitHub** →
  "found version" y luego `exit 1`. El input `token-setup-trivy` (que por defecto ya es `github.token`)
  solo autentica el **checkout del repo** de trivy, **no** la descarga del binario, así que pasar un token
  a la acción **no** lo arregla.
- **Fix (robusto, gate intacto):** se instala Trivy desde el **repo apt OFICIAL de Aqua**
  (`aquasecurity.github.io/trivy-repo`, servido por GitHub Pages/CDN, **sin rate-limit de API**) en un paso
  previo de `trivy-fs` y `trivy-image`, y se pasa **`skip-setup-trivy: "true"`** a cada uso de la acción
  (verificado en su `action.yaml`: el input existe y su paso "Install Trivy" queda condicionado a
  `skip-setup-trivy == 'false'`). Además se define a nivel de job `TRIVY_GITHUB_TOKEN`/`GITHUB_TOKEN =
  ${{ secrets.GITHUB_TOKEN }}` para que el **pull de la DB** de trivy (GHCR/GitHub) tampoco se limite. El
  gate **no se relaja**: sigue `severity: HIGH,CRITICAL` + `exit-code: "1"`.

**(B) deploy.yml — `startup_failure` (0 jobs, workflow inválido) — ARREGLADO.**
- **Causa exacta (de `actionlint`):** tres jobs usaban `environment.url: ${{ secrets.STAGING_BASE_URL }}`
  / `${{ secrets.PROD_BASE_URL }}` (líneas 169, 278, 307). **`environment.url` NO admite el contexto
  `secrets`** (solo `env`/`github`/`inputs`/`needs`/`vars`/…). GitHub **rechaza el workflow al arrancar**
  → run en `failure` con **0 jobs** (`startup_failure`). `actionlint` lo señala con
  *"context 'secrets' is not allowed here"*.
- **Fix:** se **quitó el `url:`** de esos tres `environment:` (es un enlace cosmético del deploy; el
  objetivo real de `STAGING_BASE_URL` es el job `dast-staging`). El `name:` del environment —que es lo que
  da la protección de *required reviewers* de `production`— se conserva. `actionlint` ahora pasa **limpio**
  (exit 0) en los 5 workflows.

**(C) E2E — `backend-e2e` (config, ARREGLADO) y `frontend-e2e` (seed, ENRUTADO).**
- **`backend-e2e` — ARREGLADO (config/infra):** el step **"Initialize containers"** fallaba porque el
  *service* `minio` usaba **`bitnami/minio:latest`**, y Bitnami **vació su namespace en Docker Hub**
  (migración a "Bitnami Secure Images", ago-2025): `hub.docker.com/v2/repositories/bitnami/minio` devuelve
  **0 tags** hoy → el pull falla y GitHub aborta el job antes de correr un test. **Fix:** apuntar a
  **`bitnamilegacy/minio:latest`** (misma imagen exacta, a donde Bitnami la movió; conserva
  `MINIO_DEFAULT_BUCKETS` y el auto-arranque). No se usa `minio/minio` oficial porque como *service* de
  Actions exige un `command` (`server /data`) que los service containers no permiten pasar.
- **`frontend-e2e` — ENRUTADO (probable fallo de arranque/seed del backend, no config):** el desglose de
  steps muestra que el stack **levantó** (`docker compose up -d --build` OK) y el fallo es el step
  **"Seed sintético en staging"** (`docker compose exec -T backend npm run seed:synthetic`). El *cuerpo*
  del log está egress-bloqueado (blob de Actions, 403), así que **no** tengo el mensaje exacto del seed.
  Dos mejoras de **harness** (sí de devops, en `e2e.yml`) para que el error real **aflore y se enrute**
  bien, en vez de quedar enmascarado:
  1. El paso **"Esperar a que el backend responda"** ya **no** solo hace `break`: ahora **falla duro**
     en timeout (~5 min) con `::error::` y vuelca `docker compose logs backend`. Antes, un backend que no
     arrancaba pasaba como "success" y el error afloraba, opaco, en el seed.
  2. En el seed se **quitó el fallback `|| ./scripts/seed-synthetic.sh`**: ese script corría en el
     **runner** (donde el backend **no** tiene `npm ci` ni `DATABASE_URL`), así que **siempre** fracasaba
     y **enmascaraba** el error real del contenedor. Ahora el seed corre solo **dentro del contenedor** y
     su error sale tal cual (y el paso "Logs del stack si algo falló" lo vuelca).
  - **A quién le toca:** si tras el fix de infra `frontend-e2e` sigue rojo, el fallo real es **de app**:
    o el **backend** no arranca en `NODE_ENV=production`/su `seed:synthetic` erra (rol **backend**), o los
    tests Playwright fallan por lógica de UI (rol **frontend**). **Devops no corrige código de app.** El
    log del contenedor (visible en CI en el paso "Logs del stack…") tiene el mensaje exacto para el dueño.

### 16.7 Tercera ronda — `trivy-image` por `node-tar` de npm base + estado E2E (2026-08-16)

> Tras §16.6 el único job de SAST que seguía en **failure** era **`trivy-image`**, por CVEs de
> **`node-tar`**. Los jobs E2E (`backend-e2e`, `frontend-e2e`) siguen rojos por los **tests**, no por
> config. Restricción de la sesión: **no** se puede correr Trivy localmente (el egress bloquea el pull
> de la DB de vulnerabilidades y el `docker pull` de la base), ni leer el cuerpo del log de Actions
> (blob `*.blob.core.windows.net` → 403), ni `api.pokemontcg.io`. Se trabaja con diagnóstico documental;
> el **runner CI** confirma en verde.

**(A) SAST · Trivy image — `node-tar` (CVE-2026-26960 / -29786 / -31802 / -59874) — ARREGLADO con ignore justificado.**
- **Causa exacta:** Trivy reporta `node-tar` HIGH/CRITICAL (fixed `>= 7.5.18`) en la imagen del backend.
  Por eliminación: **NO** es dependencia de la app — backend confirmó **`npm ls tar` VACÍO** en `backend/`
  (y `tmp`, la otra vía, ya se parcheó). El `node-tar` que ve Trivy es el que viene **empaquetado dentro
  de `npm`** en la imagen base `node:20(-alpine)`, en
  `/usr/local/lib/node_modules/npm/node_modules/tar`. Ese tar **solo lo usa `npm`** para instalar paquetes
  durante el build (`npm ci`); **en runtime** la app corre `node dist/main.js` y nunca invoca el tar
  interno de npm → la superficie de esos CVE (parseo de `.tar` malicioso) **no es alcanzable** con datos
  de la app en producción.
- **Enfoque elegido — Opción B (ignore justificado), NO Opción A. Por qué:**
  - **Opción A** (`RUN npm install -g npm@latest` en `Dockerfile.backend` para reemplazar el `node-tar`
    de npm) **no se aplicó**: (1) son CVE de **ene-2026**, muy recientes → es improbable que el npm más
    nuevo ya empaquete `node-tar >= 7.5.18`, y **no puedo verificarlo** sin red en esta sesión; (2)
    `npm@latest` es un **objetivo móvil** (build no reproducible) y no dispongo de un número de versión de
    npm *comprobado* cuyo tar esté parcheado para **pinnearlo** correctamente; (3) tocar la etapa base
    añade riesgo de build que **no puedo probar** localmente. En resumen: A **no es verificable ni
    determinista** aquí → habría dejado el gate en incertidumbre.
  - **Opción B** es **determinista y auditable**: se ignoran **exactamente esos 4 CVE IDs**, y solo esos,
    en `security/.trivyignore`, con la justificación (a)/(b)/(c)/(d) escrita en el propio archivo.
- **Contenido del ignore (`security/.trivyignore`), CVE IDs exactos:**
  ```
  CVE-2026-26960
  CVE-2026-29786
  CVE-2026-31802
  CVE-2026-59874
  ```
  Justificación embebida: (a) no es dep de la app (`npm ls tar` vacío); (b) es el `node-tar` interno de
  `npm` en la imagen base; (c) build-time only, no alcanzable en runtime; (d) sin fix aplicable por
  nosotros (no declaramos el paquete) — se limpiará al subir de imagen base cuando Node reempaquete un npm
  con tar `>= 7.5.18`. **Regla escrita:** si algún día `tar` entra como dep REAL de la app (`npm ls tar`
  deja de estar vacío), el ignore **debe retirarse**.
- **El gate NO se relaja:** como esos IDs son **exclusivos de node-tar**, ignorarlos **no** oculta ningún
  otro paquete. Cualquier **otro** HIGH/CRITICAL de una dep real de la app (o de la capa OS) **sigue
  fallando** el gate (`severity: HIGH,CRITICAL` + `exit-code: "1"` intactos). Se **prohíbe** añadir a este
  archivo CVEs de dependencias reales de la app.
- **Cableado:** `trivyignores: security/.trivyignore` en los 3 pasos de la acción (`trivy-fs` +
  `trivy-image` ×2) de `security-sast.yml`. Los wrappers locales (`trivy-fs.sh`, `trivy-image.sh`) pasan
  `--ignorefile security/.trivyignore` para que **local == CI**. **`actionlint` v1.7.12 → exit 0** en
  `security-sast.yml`; `bash -n` OK en ambos wrappers.

**(B) E2E — `backend-e2e` y `frontend-e2e` siguen rojos por TESTS — SOLO DIAGNÓSTICO, ENRUTADO (no es de devops).**
- El fix de infra previo (imagen `minio` → `bitnamilegacy/minio`, §16.6(C)) es correcto: **`minio` ya
  arranca**. Lo que falla ahora está en los **tests**, no en la config del harness.
- **Devops NO puede reproducir ni diagnosticar la causa en esta sesión:** el egress bloquea el `docker
  pull`, `api.pokemontcg.io` **y** el blob de logs de Actions (403) → **no** se puede leer el mensaje
  exacto del fallo desde aquí. **No se inventa la causa.**
- **El detalle exacto del fallo E2E SOLO es visible:** (1) abriendo el **run en la UI de GitHub Actions**
  (lo hace el **humano**), o (2) **corriendo el stack localmente** (`docker compose -f
  docker-compose.staging.yml --profile apps up -d --build` + revisar `docker compose logs backend` y la
  salida de Playwright).
- **Enrutado a los dueños del código (no a devops):**
  - **`backend-e2e`** → **rol backend**: si `backend/test/integration/*.e2e-spec.ts` falla por lógica de
    app, o el backend no arranca en `NODE_ENV=production`, o `seed:synthetic` yerra.
  - **`frontend-e2e`** → **rol backend** (arranque/seed en `NODE_ENV=production`) y/o **rol frontend**
    (tests Playwright / `E2E_BASE_URL`). El paso "Logs del stack si algo falló" de `e2e.yml` vuelca el log
    del contenedor con el mensaje exacto para el dueño.

### 16.5 Resumen de archivos tocados en este saneamiento (todos rutas devops)

| Archivo | Cambio |
|---|---|
| `.github/workflows/security-sast.yml` | **§16.1** Trivy `@0.24.0`→`@v0.33.1` (×3); job `semgrep` a 2 pasos. **§16.6(A)** instalar Trivy por apt oficial + `skip-setup-trivy: "true"` (×3) + `TRIVY_GITHUB_TOKEN`/`GITHUB_TOKEN` a nivel de job en `trivy-fs`/`trivy-image` (fix rate-limit del instalador). **§16.7(A)** `trivyignores: security/.trivyignore` en los 3 pasos de la acción (node-tar de npm base). |
| `security/.trivyignore` | **§16.7(A)** NUEVO. Ignore justificado de los 4 CVE de `node-tar` (CVE-2026-26960/-29786/-31802/-59874) — build-time only, no dep de la app. El gate sigue fallando en cualquier otro HIGH/CRITICAL. |
| `security/scripts/trivy-fs.sh`, `security/scripts/trivy-image.sh` | **§16.7(A)** `--ignorefile security/.trivyignore` para que el escaneo local coincida con CI. |
| `security/semgrep.yml` | **§16.2** Fix 2 errores de schema + refino de `stripe-webhook-verify-signature` (elimina FP). |
| `.github/workflows/e2e.yml` | **§16.3** `minio` *service*: quitado healthcheck `curl` interno + readiness desde el runner. **§16.6(C)** imagen `bitnami/minio`→`bitnamilegacy/minio` (namespace vaciado); "esperar backend" ahora falla duro en timeout + logs; seed sin fallback-en-runner (corre in-container). |
| `.github/workflows/deploy.yml` | **§16.4** trigger solo `workflow_dispatch` + `secrets-gate`. **§16.6(B)** quitado `environment.url: ${{ secrets.* }}` (×3) que causaba `startup_failure`. |
| `docs/DEVOPS_NOTES.md` | Esta §16 (incl. §16.6). |

> **Nota de propiedad:** no se modificó `ci.yml`, ni `backend/`, ni `frontend/`, ni
> `docs/BACKEND_NOTES.md`, ni `docs/TECH_DEBT.md`. Validación con **actionlint v1.7.12**: los 5
> workflows pasan **exit 0**. Lo no reproducible en el sandbox (pull de imágenes, DAST, log-blob de
> Actions) queda marcado **verificar en runner CI**.

---

## 17. Runbook — encender la gráfica pública del "set destacado" (v1.9-set-chart)

> Contexto: hay una **gráfica pública** en la home con el valor de mercado agregado de un **set
> destacado**, alimentada por dos jobs diarios que **backend** implementa y cablea en
> `scheduler.service.ts` (devops NO toca `backend/`). Ver `docs/ARCHITECTURE.md` §4.12 / §5 / §8 / §9 y
> `docs/API_CONTRACT.md` v1.9-set-chart. Devops solo aporta la env `HOME_FEATURED_SET_ID` (`.env.example`)
> y este runbook operativo. Todo el flujo usa **datos reales** de pokemontcg.io — la serie **no** se
> fabrica: crece **1 punto/día** a partir del primer snapshot.

### 17.1 Mecanismo del "set destacado" (env + fallbacks) — cómo lo resuelve el backend

El backend (`SetValueService.resolveFeaturedSet()`) elige el set a graficar en **cascada determinista**:

1. **`HOME_FEATURED_SET_ID`** (env; **id NATIVO de pokemontcg.io**, p. ej. `sv8pt5`): si está seteado y
   existe un `CardSet` local con ese `externalId`, **ese** es el set destacado.
2. **Fallback 1 — mayor valor:** si el env no está o no resuelve, se elige el set con mayor
   `totalValueMxnCents` en su último `SetValueSnapshot`.
3. **Fallback 2 — más reciente:** si aún no hay ningún snapshot (arranque en frío), se elige el `CardSet`
   con `releaseDate` más reciente.
4. **Sin sets:** el endpoint responde `set: null, points: []` y el hero **degrada con elegancia** (sin error).

**Anti-SSRF:** el `set-price-sync` usa el cliente de pokemontcg.io con **host FIJO** y valida el `setId`
contra `^[a-z0-9]+(-[a-z0-9]+)*$`. Por eso `HOME_FEATURED_SET_ID` es **solo el id** (nunca una URL): un id
con caracteres fuera de ese patrón se rechaza y no puede redirigir el fetch a otro host.

### 17.2 Set destacado por defecto (valor de ejemplo en `.env.example`)

`HOME_FEATURED_SET_ID=sv8pt5` → **"Prismatic Evolutions"** (serie Scarlet & Violet, `releaseDate`
2025-01-17). Elegido por ser un set SV reciente, muy líquido y de **alto valor/interés** (Eevee/eeveelutions),
ideal para un hero. Alternativa igualmente válida: `sv8` = **"Surging Sparks"** (2024-11-08). Ambos son
**ids nativos de pokemontcg.io**; el operador puede fijar cualquier otro id nativo que quiera destacar.

> **Verificación del id contra pokemontcg.io:** en **esta sesión** la verificación en vivo **no** fue
> posible — el proxy de egress de la sesión **deniega** `api.pokemontcg.io` (CONNECT → **403** de política);
> no se puede rutear alrededor. El id `sv8pt5` (y `sv8`) se toma del **esquema de ids público y estable** de
> pokemontcg.io (series SV: `sv1`…`sv8`, con sets especiales `sv3pt5`=151, `sv4pt5`=Paldean Fates,
> `sv6pt5`=Shrouded Fables, `sv8pt5`=Prismatic Evolutions). **Confirmación operativa [HUMANO/DEVOPS]:** al
> ejecutar el Paso 1 con la `POKEMONTCG_IO_API_KEY` real, `GET /admin/catalog/remote-sets` lista los sets
> remotos con su `id`/`name`/`releaseDate`; verifica ahí que `sv8pt5` aparece antes de fijarlo (o elige otro
> id de esa lista). Si el id no existiera, `POST /admin/catalog/sync {setId}` no importaría cartas y la
> gráfica caería a los fallbacks §17.1.

### 17.3 Encendido en producción — pasos (en orden)

> Precondición: backend desplegado con los 2 jobs implementados y cableados en `scheduler.service.ts`
> (BE, no devops), `REDIS_URL` presente en Railway (para que corran los crons), y — **recomendado** —
> `POKEMONTCG_IO_API_KEY` cargada en Railway (ver §17.4). Los endpoints admin son **`super_admin`**.

**Paso 1 — [DEVOPS/HUMANO] Sincronizar el set elegido al catálogo local.**
Importa todas las cartas del set (id **nativo** pokemontcg.io) para que el job pueda preciarlas:
```
POST /api/v1/admin/catalog/sync
{ "setId": "sv8pt5" }        # super_admin; 202 { jobId, setsQueued, mode:"single" }
```
Espera a que la cola termine (el set entra como `imported` en `GET /admin/catalog/remote-sets`).

**Paso 2 — [HUMANO] Fijar `HOME_FEATURED_SET_ID` en Railway (servicio `backend`) = el MISMO id nativo.**
Railway > servicio `backend` > Variables: `HOME_FEATURED_SET_ID=sv8pt5`. Debe ser **idéntico** al `setId`
del Paso 1, para que el endpoint público y el `set-price-sync` grafiquen/precien el **mismo** set. Redeploy
del backend para que tome la variable.

**Paso 3 — [DEVOPS] Sembrar el primer punto de la serie (una vez).** Dispara los 2 jobs a mano, **en orden**
(precio del set → snapshot del día):
```
POST /api/v1/admin/jobs/set-price-sync       # super_admin — precia TODAS las cartas del set destacado
POST /api/v1/admin/jobs/set-value-snapshot   # super_admin — agrega y hace upsert del SetValueSnapshot de hoy
```
> Endpoints de disparo manual provistos por **backend** (mismo patrón que `POST /admin/pricing/sync`). El
> **orden es una restricción dura**: `set-value-snapshot` agrega lo que `set-price-sync` acaba de preciar.
> Ambos son **idempotentes** por día (`@@unique[setId, asOfDate]`): re-ejecutarlos no duplica.

**Paso 4 — [DEVOPS] Verificar la gráfica.** El endpoint público debe resolver el set y ≥1 punto:
```
GET /api/v1/catalog/featured-set/value-history        # public — sin auth
# Esperado: { set: { … "Prismatic Evolutions" … }, points: [ { asOfDate, totalValueMxnCents, … } ], … }
```
Si `set` resuelve pero `points: []`, revisa que el Paso 3 corrió en orden y que el set tiene cartas priceadas
(Paso 1 completó). Si `set: null`, `HOME_FEATURED_SET_ID` no resolvió a un `CardSet` local → repite Paso 1/2.

### 17.4 Operación continua (a partir del Paso 4)

- **Los 2 crons diarios ya corren solos** con `REDIS_URL` presente (los cablea backend en
  `scheduler.service.ts`): `set-price-sync` tras `fx-refresh` (cron sugerido `30 6`) y `set-value-snapshot`
  tras `set-price-sync` (sugerido `15 7`). Orden duro: **FX → precio del set → snapshot del set**. No hay que
  volver a disparar nada a mano; el Paso 3 es solo la **siembra** del primer día.
- **La serie crece 1 punto/día** con **datos reales**. Si un día un job no corrió, ese día **no** tiene punto
  (la API no inventa el punto; ver ARCHITECTURE §4.12d "Sin datos fabricados").
- **`POKEMONTCG_IO_API_KEY` (RECOMENDADO en Railway):** `set-price-sync` precia el **set completo**
  (~150-250 cartas) desde pokemontcg.io en cada corrida. **Con** API key el free tier autenticado absorbe el
  set holgadamente; **sin** ella el límite sin autenticar es más estricto y el preciado puede
  estrangularse/tardar. Cárgala en el servicio `backend` (ya listada en el bloque `[RW]` de `.env.example` y
  en el runbook §11.D). El **host** pokemontcg.io es fijo (anti-SSRF, §17.1).
- **Cambiar de set destacado más adelante:** repetir Paso 1 (sync del nuevo id) → actualizar
  `HOME_FEATURED_SET_ID` en Railway (Paso 2, redeploy) → sembrar con Paso 3. El set anterior conserva sus
  snapshots (el modelo soporta N sets); solo deja de ser el que resuelve el endpoint del hero.

### 17.5 Rollback / recuperación de la gráfica

| Escenario | Acción |
|---|---|
| **Set destacado mal elegido / id equivocado** | Corregir `HOME_FEATURED_SET_ID` en Railway al id correcto (previo `POST /admin/catalog/sync {setId}` de ese set) + redeploy. No requiere tocar código ni la BD. Mientras se corrige, el endpoint cae a los **fallbacks** (§17.1) y el hero sigue mostrando algo. |
| **La gráfica sale vacía (`points: []`)** | Re-disparar el Paso 3 **en orden** (`set-price-sync` → `set-value-snapshot`). Verificar que el set tiene cartas priceadas (Paso 1 completó) y `POKEMONTCG_IO_API_KEY` cargada. |
| **`set: null` en el endpoint** | El env no resolvió a un `CardSet` local: re-sincronizar el set (Paso 1) y confirmar que `HOME_FEATURED_SET_ID` = id nativo importado. |
| **Snapshot de un día con valor anómalo** | No se borra desde infra (es dato de negocio, propiedad backend). El upsert idempotente lo corrige si se re-corre `set-value-snapshot` el mismo día; un día ya cerrado se corrige por el rol backend, no por devops. |

> Estos jobs **no** mueven dinero ni tocan PII: la gráfica es 100% valor de mercado agregado del set
> (derivado server-side de `PriceReference`; SEC-A1 intacto). Un fallo de la gráfica **no** bloquea checkout,
> bóveda ni buylist — degrada aislado.

---

## 18. Job `catalog-metadata-sync` (+ `catalog-price-sync` manual/ops) — import de metadata del catálogo

> **WS-A (cierre 2026-08-17) — CAMBIO DE ROL.** Tras WS-A este job **YA NO precia el catálogo** ni escribe
> `PriceReference`, y **ya no corre 2×/día por cron**. El refresco de precios lo asume **`price-ingest`**
> (ingest masivo por set, **§19**), mucho más barato y robusto. `catalog-sync` quedó **aligerado a SOLO
> metadata** (backend retiró `persistMarketReferences` + las deps `PricingService`/`FxService`): ni escribe
> precios ni convierte FX. Estado actual:
> - **Agendado:** `catalog-metadata-sync` **diario** (`syncAll {force:false}`) — importa solo sets/cartas
>   **nuevas**; cron por env `CATALOG_METADATA_SYNC_CRON` (default `0 1 * * *` = 19:00 CDMX).
> - **Manual/ops-only:** `catalog-price-sync` (`syncAll {force:true}`, re-import **completo** de metadata) por
>   `POST /api/v1/admin/jobs/catalog-price-sync`. **Ya no** se agenda; los viejos `CATALOG_PRICE_SYNC_CRON_1/_2`
>   quedan **deprecados** (el scheduler ya no los lee — grep en `backend/src` = 0 usos).
>
> Contexto: la operación la implementa **backend** en `backend/src/jobs/catalog-price-sync.service.ts`
> (`runMetadataImport()` agendado + `run()` manual) + su cableado en `scheduler.service.ts` (devops **no**
> toca `backend/`). Devops aporta las env de scheduling (`.env.example`), su cableado en Railway y este
> runbook. La `POKEMONTCG_IO_API_KEY` ya está aprovisionada.

### 18.1 Qué hace

> **CORRECCIÓN WS-A (nota antes stale):** este job **YA NO** "repuebla `PriceReference` por acabado con el
> FX del día". Tras el aligeramiento de WS-A, `catalog-sync` **NO escribe precios ni convierte FX** — eso es
> ahora trabajo de `price-ingest` (§19). Aquí solo se importa **metadata**.

- **Agendado — `catalog-metadata-sync`** = `CatalogSyncService.syncAll({ force:false })`: importa **solo los
  sets/cartas NUEVAS** (salta los sets ya poblados) — metadata (sets, cartas, imágenes) y un
  `availableFinishes` **bootstrap** (default seguro que `price-ingest` sobre-escribe con lo real). **NO** toca
  `PriceReference` ni FX. Barato (solo lo nuevo) → cadencia diaria.
- **Manual/ops-only — `catalog-price-sync`** = `syncAll({ force:true })`: **re-import completo** de la
  metadata de **todos** los sets remotos (no solo los nuevos). Útil tras cargar la API key o para forzar un
  re-import puntual. También es **solo metadata** (no escribe precios). Se dispara con
  `POST /admin/jobs/catalog-price-sync` (§18.5). **Ya no se agenda por cron.**
- Ambas variantes son **secuenciales** (respetan el backoff 429 del cliente de pokemontcg.io),
  **single-flight** (dos corridas no se solapan: si hay una en curso, la nueva retorna `setsQueued:0`) e
  **idempotentes** (upsert por `externalId`). Reintentar no duplica.
- El worker sólo corre si hay **`REDIS_URL`** (BullMQ). Sin Redis, el scheduler queda deshabilitado con un
  warning y el import **sólo** es disparable a mano (§18.5).

### 18.2 Horario y cómo cambiarlo (env, sin redeploy de código)

Una BullMQ repeatable (`catalog-metadata-sync`), con cron **en UTC** por env:

| Env | Default | UTC | CDMX | Job |
|---|---|---|---|---|
| `CATALOG_METADATA_SYNC_CRON` | `0 1 * * *` | 01:00 UTC | **19:00 CDMX** | import diario de metadata (`force:false`, solo sets nuevos) |

- **CDMX = UTC−6, fijo (sin horario de verano):** `01:00 UTC = 19:00 CDMX` (del día anterior). El import es
  barato (solo sets/cartas nuevas), así que la hora exacta no es crítica; cualquier hora diaria sirve.
- **Cambiar horario en prod:** editar `CATALOG_METADATA_SYNC_CRON` en **Railway → servicio `backend` →
  Variables** y redeploy. Es config de env, no cambio de código. Mantén siempre el cron en **UTC**.
- **NO** pongas la env a cadena **vacía**: el código usa `?? default`, que sólo cubre variable **ausente**;
  `""` NO cae al default → produce un patrón de cron **inválido**. Para apagar el job ver rollback (§18.7).
- **`CATALOG_PRICE_SYNC_CRON_1/_2` (deprecados):** el scheduler WS-A **ya no los lee** (grep en `backend/src`
  = 0 usos); se retiraron de `.env.example`. Fijarlos no tiene efecto. El pricing agendado es
  `PRICE_INGEST_CRON_*` (§19); el metadata agendado es `CATALOG_METADATA_SYNC_CRON`.

### 18.3 Requisitos operativos (obligatorios en prod)

- **`REDIS_URL`** — BullMQ. Ya inyectado por Railway (`${{ Redis.REDIS_URL }}`, ver §11.D). Sin él, ni
  este ni ningún otro cron corre.
- **`POKEMONTCG_IO_API_KEY`** — el import consulta pokemontcg.io. El `catalog-metadata-sync` **diario** solo
  trae **sets/cartas nuevas** (barato); el `catalog-price-sync` **manual** (`force:true`) sí re-recorre todos
  los sets (cientos de requests) y conviene correrlo con la key cargada. Con API key el free tier autenticado
  da **~20 000 req/día**, holgado; sin key el límite sin autenticar es más estricto (HTTP 429). Cárgala en
  Railway → `backend` (ya listada en `[RW]`, §11.D).

### 18.4 Orden FX → precios (ya NO aplica a este job)

Tras WS-A, `catalog-sync` **no convierte FX ni escribe precios**, así que el orden `fx-refresh → …` **ya no
le aplica**. Ese requisito operativo se trasladó al job que sí precia, **`price-ingest`** — ver **§19.4**
(`fx-refresh` a las 00:00 CDMX **antes** de las corridas del ingest de 06:00 y 18:00 CDMX).

### 18.5 Disparo manual

```
POST /api/v1/admin/jobs/catalog-price-sync      # super_admin; 200 { jobId, setsQueued, remaining }
```

- Rol **`super_admin`** (guard `@Roles`), **auditado** en `AuditLog` (`action: jobs.catalog_price_sync.run`).
- Ejecuta `run()` = **`syncAll force:true`** (re-import **completo** de metadata, single-flight): si ya hay
  una corrida en curso, retorna `setsQueued:0` sin lanzar otra. **Es el disparo manual/ops-only** (ya no
  agendado; el cron diario corre la variante ligera `runMetadataImport()` = `force:false`). Útil para forzar
  un re-import fuera de horario o tras cargar la API key. **No escribe precios** (solo metadata).

### 18.6 Monitoreo

- **Duración de la corrida:** el `catalog-metadata-sync` diario es barato (solo sets nuevos); el
  `catalog-price-sync` manual (`force:true`) recorre todo el catálogo secuencialmente — vigila el
  `jobId`/tiempo entre inicio y fin en los logs del backend. El single-flight evita solapes.
- **Rate-limit 429 de pokemontcg.io:** alarma sobre 429 repetidos en los logs del backend. Un 429 sostenido
  indica que falta/está mal la `POKEMONTCG_IO_API_KEY` o que se excede la cuota (~20k/día). El cliente hace
  backoff, pero un 429 persistente alarga o degrada el import.
- **`PriceReference` — ya NO lo alimenta este job:** tras WS-A `catalog-sync` **no escribe precios**, así que
  el crecimiento de `PriceReference` (y su retención/poda) es responsabilidad de **`price-ingest`** — ver
  **§19.8**. *(Nota histórica: antes de WS-A este job insertaba ~30–40k filas/día; ya no.)*
- **Fallo del job:** el worker BullMQ registra `Job <nombre> falló: <msg>`. Cablear la alerta de plataforma
  sobre 5xx/errores del worker (mismo canal que las alertas de `price-ingest`/`price-sync`/`fx-refresh`, §8).

### 18.7 Rollback / deshabilitar

| Escenario | Acción |
|---|---|
| **Apagar el import agendado sin tocar código (recomendado)** | Poner `CATALOG_METADATA_SYNC_CRON` en un cron **válido que nunca dispare**, p. ej. `0 0 31 2 *` (31 de febrero = nunca), en Railway → `backend` → Variables, y redeploy. El scheduler sigue sano; el import no vuelve a correr. **NO** uses cadena vacía (produce patrón inválido, §18.2). |
| **Pausa temporal (stopgap)** | Quitar la repeatable de Redis (`queue.removeRepeatable`/borrar la key de BullMQ vía `redis-cli`). **Se re-crea en el próximo arranque** del backend (el scheduler la vuelve a añadir en `onModuleInit`), así que es sólo un parche hasta el siguiente deploy/restart — para algo permanente usa el cron-nunca de arriba. |
| **Corrida en curso problemática** | Es idempotente y single-flight: se puede dejar terminar. Para que no vuelva a lanzarse, aplica el cron-nunca. No hay riesgo de dinero/PII (solo importa metadata de catálogo; **no** escribe precios). |
| **Apagar TODOS los jobs** | Quitar `REDIS_URL` deshabilita el scheduler completo (demasiado amplio; afecta fx/price-ingest/snapshots/barridos). Preferir el cron-nunca por-job. |

**Enrutado a backend (cambios de código, NO devops):**
1. **Robustez del `?? default`:** hoy `CATALOG_METADATA_SYNC_CRON=""` (vacío) NO cae al default y genera un
   patrón inválido. Sería más robusto tratar cadena vacía/espacios como "usar default" (o "deshabilitado"
   explícito). Mitigación devops mientras tanto: documentado en `.env.example` y §18.2 (no usar vacío).
2. **`fx-refresh` no configurable por env** (`0 6 * * *` hardcodeado) y 1×/día — relevante para `price-ingest`
   (§19.4), no para este job (que ya no precia).

---

## 19. Job `price-ingest` — ingest MASIVO de precios vía proveedor de PAGA (WS-A, v1.14)

> Contexto: WS-A reemplaza el barrido por-carta frágil (`catalog-price-sync` `force:true`, re-sync completo
> **fire-and-forget en memoria** — §18) por un **ingest masivo por SET** que consume el **endpoint bulk** del
> proveedor de paga **PokemonPriceTracker**. El job lo implementa **backend** (`PriceIngestService` + jobs
> `price-ingest`/`price-ingest-set` + cableado en `scheduler.service.ts` + `env.validation.ts` + seed del
> dial); **devops** aporta el scheduling (`.env.example`), su cableado en Railway y este runbook. Ver
> `docs/ARCHITECTURE.md §4.15` y `docs/API_CONTRACT.md` (§M10-ops). **Toca dinero → triple veredicto.**
> **Aditivo, SIN migración de esquema** (reusa `PriceReference`, `PriceSource.pokemonpricetracker`, `Card.availableFinishes`).

### 19.1 Qué hace

- **`price-ingest` (parent):** lista los `CardSet` **locales** y encola un child `price-ingest-set` **por set**
  en la cola BullMQ. Devuelve de inmediato (encola, no procesa).
- **`price-ingest-set` (child, `{ setId }`):** baja los precios de **un set** en **pocas requests** (bulk),
  agrupa por carta y hace **upsert idempotente** de `PriceReference` por
  `(cardId, 'raw', 'raw:NM', finish, capturedDate=hoy)`, convirtiendo **USD→MXN** con el FX del día (colchón
  #13). Refresca `Card.availableFinishes` desde el proveedor. **Respeta `isManualOverride`** (si hay override
  del admin, no lo pisa).
- **Robusto / idempotente / reanudable** (el corazón de WS-A): un set que falla (429, payload roto) **no
  tumba** el resto (es su propio job BullMQ con retry/backoff); la cola vive en **Redis** (persistida) → un
  reinicio a media corrida retoma los child jobs pendientes; re-correr el mismo día **actualiza** el precio,
  no duplica.
- **Proveedor pluggable por el dial `PRICE_PROVIDER`:** `pokemonpricetracker` (PAGA, bulk, PRIMARIO) o
  `pokemontcg_io` (legacy/rollback). El job es robusto con **ambos**; el de paga aporta variantes completas y
  ~100× menos requests (bulk por set).
- **Reemplaza** el rol de pricing de `catalog-price-sync` (§18). El catálogo (metadata / import de sets
  nuevos) sigue en `catalog-sync {force:false}`, en cadencia propia y barata.

### 19.2 Requisitos operativos (obligatorios en prod)

- **`REDIS_URL`** — BullMQ. Ya inyectado por Railway (`${{ Redis.REDIS_URL }}`). Sin él, el scheduler **no
  programa** el cron (queda deshabilitado con warning) y `price-ingest` solo es disparable a mano (corre
  **secuencial AWAITED**, nunca fire-and-forget). La cola persistida en Redis es lo que hace el job
  **reanudable**.
- **`POKEMONPRICETRACKER_API_KEY`** — **ya aprovisionada en Railway** (NUNCA en el repo; el código solo lee
  `process.env`). Pasa a ser **requisito operativo** cuando `PRICE_PROVIDER=pokemonpricetracker`: debe tener
  **cuota del PLAN DE PAGA** (el ingest baja el catálogo por set, 1–2×/día). **Money-safe:** si la key
  falta/está inválida con el proveedor de paga seleccionado, el ingest **NO borra** precios (los deja
  **stale**, que es seguro) y **alerta**; **no** hay fallback silencioso a otra fuente. Si
  `PRICE_PROVIDER=pokemontcg_io`, el requisito es `POKEMONTCG_IO_API_KEY`.
- **`POKEMONPRICETRACKER_MARKET_FORMAT`** (money-safe, **sin default**) — moneda + unidad del `market` del
  proveedor de paga (`usd_dollars`/`usd_cents`/`mxn_dollars`/`mxn_cents`). **Requisito para que el proveedor
  de paga ESCRIBA:** sin ella, con `PRICE_PROVIDER=pokemonpricetracker` el ingest corre **sample-only** (hace
  el fetch, loguea una muestra, **no persiste** ningún precio). El PO confirmó **`usd_dollars`**; fíjala
  **solo tras leer el log de muestra** de una corrida `{setId}` (runbook §19.5). Con `pokemontcg_io` (legacy)
  **no aplica** (esa fuente ya es USD conocido).
- **Dial `PRICE_PROVIDER`** — ConfigSetting (M10), **no env**. Ver §19.5.

### 19.3 Horarios y cómo cambiarlos (env, sin redeploy de código)

Dos BullMQ repeatables, cron **en UTC** por env (documentados en `.env.example`):

| Env | Default | UTC | CDMX | Corrida |
|---|---|---|---|---|
| `PRICE_INGEST_CRON_1` | `0 0 * * *` | 00:00 UTC | **18:00 CDMX** | tarde |
| `PRICE_INGEST_CRON_2` | `0 12 * * *` | 12:00 UTC | **06:00 CDMX** | mañana |

- **CDMX = UTC−6, fijo (sin horario de verano).** `06:00 CDMX = 12:00 UTC`, `18:00 CDMX = 00:00 UTC`. Juntos
  disparan a las **06:00 y 18:00 CDMX** (el mismo slot 2×/día que ocupaba `catalog-price-sync`, ahora
  repuntado al pricing por `price-ingest`).
- **Cambiar horario en prod:** editar `PRICE_INGEST_CRON_1/_2` en **Railway → servicio `backend` →
  Variables** + redeploy. Es config de env, no cambio de código. Siempre en **UTC**.
- **NO** uses cadena **vacía** para apagar (el `?? default` solo cubre variable **ausente**; `""` genera un
  cron inválido). Para apagar sin tocar código, ver §19.7 (cron-nunca).
- **Nombres de env (wiring HECHO):** backend cableó el scheduler para leer **`PRICE_INGEST_CRON_1/_2`** (no
  reusó el slot `CATALOG_PRICE_SYNC_CRON_*`, ahora deprecado) y programa `price-ingest` **por defecto 2×/día**
  con el dial sembrado `pokemontcg_io`. Resuelto — ya no es una solicitud abierta.

### 19.4 Orden `fx-refresh → price-ingest` (requisito operativo)

El ingest convierte USD→MXN con el **FX del día**; el FX debe estar fresco **antes** de cada corrida.

- `fx-refresh` corre a **`0 6 * * *` = 06:00 UTC = 00:00 CDMX** (Banxico SIE + colchón; cron **hardcodeado**
  en backend, no configurable por env).
- Secuencia diaria (hora CDMX): `fx-refresh` **00:00** → `price-ingest` mañana **06:00** → `price-ingest`
  tarde **18:00**. **Ambas** corridas del ingest caen **después** del `fx-refresh` del día. ✅
- `FxService.getCurrent()` **degrada** al último `FxRate` conocido si el `fx-refresh` no corrió, así que el
  orden es **suave** pero recomendado. Regla para quien edite los crons: mantener `price-ingest` **después**
  de las 00:00 CDMX (después del `fx-refresh`). Cualquier hora diurna CDMX cumple.

### 19.5 Flip a `pokemonpricetracker` — runbook money-safe con `POKEMONPRICETRACKER_MARKET_FORMAT` (CRÍTICO)

Dos palancas gobiernan el proveedor de paga y **AMBAS** son necesarias para que escriba precios:
- **Dial `PRICE_PROVIDER`** (`price_provider`, ConfigSetting M10, **no env**): selecciona el proveedor. Seed
  **`pokemontcg_io`** (money-safe); se flipea a `pokemonpricetracker` **desde el panel M10** (sin redeploy).
- **Env `POKEMONPRICETRACKER_MARKET_FORMAT`** (Railway, **sin default**): moneda + unidad del `market`.
  **Candado fail-closed** — sin ella el proveedor de paga corre en **sample-only** (fetch + log de muestra,
  **persiste NADA**). Es lo que hace seguro el flip: aunque flipees el dial, el proveedor **no escribe** hasta
  fijar el formato.

**Por qué se GATEA (riesgo de dinero):** el esquema/moneda del payload se confirma **en runtime** (desde dev
el dominio del proveedor está bloqueado por egress). El adapter **ya no asume** la moneda: si el `market`
viniera en **MXN** y se fijara `usd_dollars`, la conversión USD→MXN lo **inflaría ~18×** (200 MXN → ~3,600
MXN). Por eso el formato se fija **leyendo el log de muestra**, no a ciegas.

**Runbook de verificación (en ORDEN — no te saltes el paso 5):**

1. **Precondición:** `POKEMONPRICETRACKER_API_KEY` en Railway (ya está) y `POKEMONPRICETRACKER_MARKET_FORMAT`
   **VACÍA** (aún sin fijar). Backend desplegado con WS-A (`price-ingest` cableado + log de ejemplo).
2. **Flip del dial (seguro por el candado):** en el panel **M10** poner `PRICE_PROVIDER=pokemonpricetracker`
   (sin redeploy). Como `MARKET_FORMAT` está vacía, el proveedor de paga entra en **sample-only** → NO escribe.
3. **Corrida de UN set** (blast radius contenido; en sample-only aún no persiste):
   `POST /api/v1/admin/jobs/price-ingest { "setId": "sv8" }`.
4. **LEER el log de muestra** que deja backend (payload crudo de la 1ª entrada + `finish` detectado +
   `market`). Determinar la **moneda y unidad reales**. El PO confirmó **USD en dólares**; chequeo de cordura:
   una carta de ~$10 USD debería quedar, ya con FX, en **~180–220 MXN** (no ~3,600). Elegir el valor de
   `MARKET_FORMAT`: `usd_dollars` (lo esperado), `usd_cents`, `mxn_dollars` o `mxn_cents`.
5. **FIJAR `POKEMONPRICETRACKER_MARKET_FORMAT=usd_dollars`** (valor confirmado por el PO) en **Railway →
   `backend` → Variables** + redeploy. **Este es el paso OBLIGATORIO que "arma" al proveedor de paga:** hasta
   aquí no escribió nada. Sin esta env, el ingest de paga nunca persiste (sample-only permanente).
6. **Re-correr UN set y verificar la escritura:** `POST /admin/jobs/price-ingest { "setId": "sv8" }` → ahora sí
   **persiste** `PriceReference`. Confirmar en las filas: precios en rango sano (~180–220 MXN para ~$10 USD),
   acabados mapeados (no todo `normal`), cobertura (cartas resueltas, `market` > 0, `skipped` bajo).
7. **Rollout completo:** si todo cuadra, correr el ingest **completo** `POST /admin/jobs/price-ingest` (sin
   `setId`) o dejar que el cron 2×/día lo haga. Proveedor de paga en vivo.
   - **Si el log mostró MXN** u otra unidad: fija el `MARKET_FORMAT` correcto (`mxn_dollars`/`mxn_cents`/…),
     re-corre el set y re-verifica — **no** hay que tocar código (el formato es un dial de env). Si el payload
     no encaja en ninguno de los 4 formatos, **rollback por dial** a `pokemontcg_io` (§19.7) + enrutar a backend.

> **Regla de oro:** flipear el **dial** solo (sin `MARKET_FORMAT`) es intencionalmente **inerte** en cuanto a
> escritura — es la red de seguridad si alguien flipea sin seguir el runbook. **Rollback** money-safe: volver
> a `pokemontcg_io` por el panel (sin redeploy) — §19.7.

### 19.6 Disparo manual

```
POST /api/v1/admin/jobs/price-ingest                       # super_admin; 202 { job:"price-ingest", enqueued, jobId? }
POST /api/v1/admin/jobs/price-ingest { "setId": "sv8" }    # un solo set (verificación); 202 { ..., scope:"set", setId }
```

- Rol **`super_admin`**, **auditado** en `AuditLog`, **single-flight** (no encola un 2º barrido si hay uno en
  curso). **Toca dinero** (mueve precios de referencia).
- `setId?` **opcional** — pensado para la **verificación de esquema** de §19.5 (un set, sin barrer todo).
  Omitirlo ingesta **todo** el catálogo. Equivale a la corrida programada 1–2×/día.
- Sin `REDIS_URL`, corre **secuencial AWAITED** en el handler (dev/ops); con Redis, fan-out por set.

### 19.7 Rollback

| Escenario | Acción |
|---|---|
| **Proveedor de paga con esquema/moneda malo, o coste/cuota fuera de control** | **Flipear el dial `PRICE_PROVIDER` a `pokemontcg_io`** desde el panel **M10** — **sin redeploy**, efecto inmediato en la próxima corrida (y en cualquier disparo manual). Es la palanca de rollback money-safe. Los precios ya escritos por el de paga se **sobre-escriben** en la siguiente corrida legacy (upsert idempotente del día). |
| **Key de paga inválida/vencida** | Money-safe por diseño: el ingest **no borra** precios (los deja stale) y alerta. Rotar la key en Railway o flipear el dial a `pokemontcg_io` mientras se resuelve. |
| **Apagar el ingest sin tocar código** | Poner `PRICE_INGEST_CRON_1/_2` en un cron **válido que nunca dispare** (p. ej. `0 0 31 2 *` = 31 feb) en Railway + redeploy. **NO** cadena vacía (§19.3). El disparo manual sigue disponible. |
| **Corrida problemática en curso** | Es idempotente y single-flight; se puede dejar terminar. Para que no vuelva a lanzarse, aplica el cron-nunca o flipea el dial. |
| **Precios inflados ~18× ya publicados** (formato de moneda mal elegido) | **Corregir `POKEMONPRICETRACKER_MARKET_FORMAT`** al valor real (p. ej. `mxn_dollars` si el proveedor daba MXN) + redeploy, **o** flip a `pokemontcg_io` mientras tanto; re-correr `price-ingest` (idempotente, corrige el día). Si tocó el precio de venta visible, considerar override manual del admin en las cartas críticas mientras se recorre. **No requiere cambio de código** (el formato es env). |

> Orden de oro: el rollback del **proveedor** es un **flip de dial** (dato, sin deploy); el del **schedule**
> es el cron-nunca (env, con redeploy). Ninguno toca código de app.

### 19.8 Monitoreo

- **Duración / avance:** el fan-out por set encola N child jobs; vigila la cola BullMQ y los logs
  (`price-ingest`/`price-ingest-set`). Alarma si una corrida no termina antes de la siguiente.
- **`skipped` alto:** el adapter cuenta entradas OMITIDAS (carta no resuelta, `market` ≤ 0, acabado
  desconocido). Un `skipped` anómalo indica un **cambio de esquema** del proveedor → revisar (§19.5).
- **Rate-limit / cuota del proveedor de paga:** alarma sobre 429/402 del proveedor. El bulk por set reduce
  ~100× las requests vs per-carta, pero vigila el **coste/cuota del plan** (riesgo devops, v1.14-2).
- **Precios stale:** si el ingest no escribió un set (key inválida, 429 persistente), los precios quedan del
  día previo. Alarma sobre sets sin `PriceReference` fresca del día (salud de datos / `dataHealth`).
- **Crecimiento de `PriceReference`:** cada corrida inserta filas por día×acabado. Como en §18.6, vigilar el
  tamaño de la tabla; la poda/retención es deuda a coordinar con backend (dueño del esquema).

### 19.9 Runbook — encender la gráfica del home tras un ingest (#10)

La gráfica pública del "set destacado" (§17) se alimenta de `SetValueSnapshot`, que agrega el valor de
mercado del set desde `PriceReference`. **Tras un `price-ingest` exitoso**, el set destacado queda
**preciado** (el ingest precia **todo** el catálogo, incluido el set del hero — subsume a `set-price-sync`,
§4.15g), así que el snapshot diario del set tiene datos frescos que agregar:

1. Corre (o deja correr por cron) `price-ingest` con el proveedor ya verificado (§19.5). Al terminar, el set
   del hero tiene `PriceReference` de hoy.
2. El job **`set-value-snapshot`** (cron diario tras el pricing del set, §17.4) hace **upsert** del
   `SetValueSnapshot` del día → **la serie crece 1 punto/día** con datos reales.
3. **Siembra del 1er punto** (una vez), si aún no hay serie: `POST /admin/jobs/set-value-snapshot` tras el
   ingest (ver §17.3 Paso 3–4). Verifica `GET /catalog/featured-set/value-history` (≥1 punto).

> El ingest **no** fabrica puntos: la gráfica acumula **1 punto/día** a partir del primer snapshot posterior a
> un ingest con precios frescos. Cross-ref §17 (mecanismo del set destacado, fallbacks y rollback de la gráfica).

### 19.10 Solicitudes a BACKEND (cambios de código — NO los toca devops)

> **TODAS RESUELTAS (WS-A cierre 2026-08-17).** Backend cableó los 5 puntos de abajo (ver `BACKEND_NOTES §36`):
> scheduler con `PRICE_INGEST_CRON_1/_2` **DEFAULT-ON 2×/día**, `catalog-sync` aligerado a metadata
> (`force:false`, ya no escribe `PriceReference`), `env.validation` con `POKEMONPRICETRACKER_API_KEY` requerida
> solo si el hint `PRICE_PROVIDER=pokemonpricetracker`, seed del dial `pokemontcg_io`, log de muestra en la 1ª
> corrida, y el candado **`POKEMONPRICETRACKER_MARKET_FORMAT`** (fail-closed / sample-only). Se conservan abajo
> como registro histórico de lo pedido.

Enrutadas en su momento al rol **backend** (dueño de `backend/src/**`); WS-A las especifica en `ARCHITECTURE §4.15`:

1. **Scheduler:** cablear `price-ingest` 1–2×/día en `scheduler.service.ts`, leyendo `PRICE_INGEST_CRON_1/_2`
   (UTC) — **o** reusar el slot `CATALOG_PRICE_SYNC_CRON_*` repuntándolo del pricing al ingest (definir cuál;
   §4.15g). Aligerar `catalog-sync` a **metadata/`force:false`** (deja de escribir `PriceReference`).
2. **`env.validation.ts`:** decidir la política de `POKEMONPRICETRACKER_API_KEY` en no-local — **required**
   solo si `PRICE_PROVIDER=pokemonpricetracker`, **o** opcional con degradación a "no escribe / stale +
   alerta". Money-safe: nunca fallback silencioso a otra fuente (§4.15h).
3. **Seed del dial:** sembrar `PRICE_PROVIDER=pokemontcg_io` (money-safe) en `ConfigSetting`.
4. **Log de ejemplo (1ª corrida):** que `price-ingest-set` **logee un ejemplo** del payload crudo del
   proveedor + `finish`/`currency` detectados + `marketCents` + `priceMxnCents`, para la verificación
   USD-vs-MXN de §19.5. **Sin este log, la verificación de moneda es a ciegas** — es un requisito para poder
   flipear el dial con seguridad.
5. **Adapter defensivo + endpoint manual** (`POST /admin/jobs/price-ingest` con `setId?`) — ya en el contrato
   (§M10-ops).

> Estas son **dependencias de código**; devops solo provee el scheduling (env), Railway y este runbook. Un
> fallo de build/deploy por un bug de estos se **reporta a backend**, no se corrige aquí.

---

## 20. Fix Redis IPv6 en Railway (auditoría de precios 2026-08-17) — checklist operativo post-deploy

> **Contexto (resumen; el detalle vive en `BACKEND_NOTES §43` — no se duplica aquí):** el scheduler BullMQ
> no conectaba al Redis de Railway. El private networking (`redis.railway.internal`) resuelve **solo IPv6**
> y ioredis usa `family: 4` por default → lookup fallido, reintento infinito **en silencio**, crons muertos
> y catálogo entero en «Precio pendiente». Backend lo arregló en `backend/src/jobs/redis-connection.util.ts`
> (default **`family: 0`** dual-stack; override por env `REDIS_FAMILY` o `?family=` en la URL) + boot no
> bloqueante + listeners de error/ready + **catch-up al arranque** (`price-ingest` inmediato si no hay
> ingesta reciente). La parte devops es este checklist + la doc de `REDIS_FAMILY` en `.env.example`.

### 20.1 Checklist ANTES del deploy (variables en Railway)

1. **`REDIS_URL` en el SERVICIO `backend`** (Railway → servicio `backend` → Variables), no solo en el
   add-on Redis: debe existir como variable del servicio con la referencia **`${{ Redis.REDIS_URL }}`**.
   Una `REDIS_URL` que solo vive en el add-on NO llega al runtime del backend, y sin ella el scheduler ni
   siquiera intenta programar crons (§19.2). El síntoma histórico (catálogo sin precios) es 100%
   consistente con un scheduler sin conexión Redis viable (BACKEND_NOTES §43.6.1).
2. **`POKEMONTCG_IO_API_KEY` presente** en el servicio `backend` (BACKEND_NOTES §43.6.3): el dial sembrado
   es `pokemontcg_io`, y sin key el free tier (~30 req/min) ralentiza el ingest y multiplica los 429
   (parciales visibles en logs; no borra precios, pero deja huecos).
3. **`REDIS_FAMILY`: NO hace falta fijarla.** El default `0` (dual-stack) del código ya cubre el hostname
   interno IPv6-only de Railway. Solo existe como override (`0|4|6`) para casos de DNS anómalo — ver el
   bloque Redis de `.env.example`. Equivalente sin env: `REDIS_URL=...?family=0`.

### 20.2 Checklist DESPUÉS del deploy (verificación en logs/health)

Runbook completo en **BACKEND_NOTES §43.5**; lo mínimo a verificar:

1. **Logs de arranque** (Railway → servicio `backend` → Deploy logs), en orden:
   - `Scheduler: conexión Redis lista (BullMQ operativo).`
   - `Scheduler activo (BullMQ): …`
   - Una de las dos líneas de **catch-up**: `price-ingest catch-up: SIN ingesta de precios reciente →
     encolado price-ingest inmediato (jobId=…)` (primer arranque tras el fix) o
     `price-ingest catch-up: hay ingesta reciente…` (arranques posteriores).
   - **Señal de fallo:** `Scheduler: error de conexión Redis…` repetido cada ~60s → la URL/red sigue mal;
     re-verificar §20.1.1 y capturar el log de arranque completo para **backend** (§43.6.4).
2. **Health:** `GET /api/v1/health` → componente Redis en **`up`**. Tras el fix el health usa el mismo
   `family` que el scheduler, así que ya es una señal fiable (antes podía dar `down` con Redis sano).
3. **Progreso del ingest:** líneas `price-ingest: encolados N sets (fan-out BullMQ).` y por set
   `price-ingest-set(<setId>, pokemontcg_io): X cartas, Y refs, …` + `Job price-ingest-set (id=…) completado.`
4. **Opcional — disparo manual** para no esperar al cron/catch-up:
   `POST /api/v1/admin/jobs/price-ingest` (super_admin, 202; con `{"setId": "…"}` un solo set — §19.6).

### 20.3 Recordatorio `numReplicas: 1` (railway.json)

`railway.json` fija **`numReplicas: 1`** y debe seguir así mientras el worker BullMQ corra **in-process**
en el mismo servicio que la API: con **N réplicas habría N schedulers** registrando los mismos repeatables
y corriendo crons/catch-up por duplicado (N ingests simultáneos, N `fx-refresh`, etc. — idempotentes pero
desperdicio de cuota de API y carga). Antes de subir réplicas hay que separar el worker a un servicio
propio (decisión futura, §6.1) y además migrar el throttler a store Redis (deuda backend, §5.1). Para este
fix **no se cambió nada** en `railway.json`: healthcheck (`/api/v1/health`, timeout 300s), restart policy y
réplicas ya eran correctos; el bug era de código (family del DNS), no de config de plataforma.

---

## 21. Job `sealed-price-ingest` — referencia de mercado del SELLADO vía TCGCSV (v1.19)

> **El runbook técnico normativo vive en `BACKEND_NOTES §44.3` (y el diseño en ARCHITECTURE §4.19);
> aquí va la vista OPERATIVA de devops, sin duplicar el detalle.** El precio TCGCSV es **solo
> referencia informativa** (`sealedMarketRef` en el admin M1): no publica, no fija `listPriceCents`,
> no toca dinero. Por eso el rollback es trivial (dial `off`).

### 21.1 Piezas operativas

- **Job:** `sealed-price-ingest`, 1×/día, secuencial y awaited (sin fan-out). Cron por env
  **`SEALED_PRICE_INGEST_CRON`** (default `30 21 * * *` = 21:30 UTC, tras el refresh diario de
  tcgcsv.com ~20:00 UTC y tras `fx-refresh`; ver bloque en `.env.example` y fila en §4).
- **Interruptor real:** el dial M10 **`sealed_price_source`** (ConfigSetting, `tcgcsv | off`, seed
  **`off`** = fail-closed). Con `off`, el job es un **no-op logueado** aunque el cron dispare
  (`enqueued:false, reason:SEALED_PRICE_SOURCE_OFF`). La env **solo** ajusta horario; el flip es por
  panel/API M10, igual que `price_provider` (§19.5).
- **Disparo manual:** `POST /api/v1/admin/jobs/sealed-price-ingest` (super_admin, 202, auditado);
  body opcional `{"groupId": <int>}` para una corrida **acotada a un grupo** TCGplayer.
- **Requisitos:** `REDIS_URL` para el cron (sin Redis solo queda el disparo manual, §19.2). Sin API
  key: tcgcsv.com es público.

### 21.2 Encendido en STAGING (antes de cualquier flip en prod)

Pasos (detalle completo en BACKEND_NOTES §44.3; ahí está el porqué de cada uno):

1. Deploy del release v1.19 + `prisma migrate deploy` (migración **M-23**: enum `tcgcsv` + columnas
   `tcgplayerProductId`/`tcgplayerGroupId`).
2. Verificar el dial: `GET /api/v1/admin/settings` → `sealedPriceSource=off` (seed).
3. Mapear 1–2 items sellados reales vía M2: `GET /admin/pricing/sealed/tcgcsv/groups` →
   `.../groups/:groupId/products` → `PUT /admin/pricing/sealed/items/:itemId/mapping`.
4. **Flipear el dial a `tcgcsv` EN STAGING** (staging no es prod: inocuo) y lanzar la corrida
   acotada: `POST /api/v1/admin/jobs/sealed-price-ingest {"groupId": <grupo mapeado>}`.
5. **Logs esperados** (backend): línea resumen del ingest con `grupos`/`referencias` y los contadores
   `fetchedRaw/skipped/usedFallbackMid/unmatched`; al final `Job sealed-price-ingest (id=…)
   completado.` (heartbeat del worker, §19.8). Señales de problema: `502 UPSTREAM_ERROR` en el
   explorador M2 (tcgcsv caído/bloqueado) o `unmatched` alto (mapeos rotos).
6. **Verificación en datos:** `PriceReference` con `source=tcgcsv`, `gradeKey=sealed:tcg:<pid>`,
   USD→MXN coherente con el FX del día + colchón; y en el admin **M1** el item sellado mapeado
   muestra `sealedMarketRef` poblado (deja de ser `null`).
7. **Validación de esquema (crítica):** los tests corren contra fixtures (el egress de dev bloquea
   tcgcsv.com — ver 21.4), así que esta corrida en staging es la PRIMERA contra el payload real. Si
   el esquema difiere de las fixtures → **hallazgo a backend** (adapter + fixtures); si cuadra →
   flip del dial en prod.

### 21.3 Rollback

**Dial `sealed_price_source=off`** (panel/API M10, sin redeploy). El job vuelve a no-op fail-closed;
los `PriceReference` ya escritos permanecen **inertes** (referencia informativa; nada público los
consume). No hay que tocar env ni cron. Para desmapear un item puntual: `PUT .../mapping` con `null`.

### 21.4 Nota de RED / egress (tcgcsv.com)

- El **entorno de dev/sandbox BLOQUEA tcgcsv.com** (proxy 403): por eso los tests usan fixtures y la
  validación real es obligatoria en staging (21.2.7). No intentes "probar el fetch" en local/dev.
- **Staging y prod deben permitir HTTPS saliente a `tcgcsv.com`** (host **FIJO** en el adapter,
  anti-SSRF; sin API key). En Railway el egress es abierto por defecto — no hay acción; si algún día
  se restringe egress por allowlist, añadir `tcgcsv.com` junto a `api.pokemontcg.io`,
  `www.banxico.org.mx` (SIE) y el dominio del proveedor de paga.


---

## 22. Desbloqueo de los gates rojos del release PR #3 (`main` → `production`, 2026-08-17)

> **Contexto:** el PR de release #3 (mergeado en `production`, commit `9940adc`) quedó con tres
> checks en rojo que bloquean el "Wait for CI" del deploy en Railway: `gitleaks`, `frontend-e2e`
> (y su gemelo del E2E real) y `trivy-image`. Los tres eran fallos de **infraestructura de CI**,
> no de código de aplicación: se arreglan en zona devops y no hubo que tocar `backend/` ni
> `frontend/`. Rama del arreglo: `claude/fix-ci-gates-release`.

### 22.1 `gitleaks` — faltaba `GITHUB_TOKEN`

**Síntoma (log real):**

```
##[error]🛑 GITHUB_TOKEN is now required to scan pull requests. You can use the automatically created token as shown in the README.
```

**Causa raíz:** `gitleaks/gitleaks-action@v2` exige `GITHUB_TOKEN` para escanear PRs (lo usa para
resolver los commits del PR y, si procede, comentar). El step de `security-sast.yml` solo pasaba
`GITLEAKS_CONFIG`. El input va por **`env:`**, no por `with:` (así lo documenta el README de la
acción).

**Cambio (`.github/workflows/security-sast.yml`, job `gitleaks`):**
- `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` en el bloque `env:` del step.
- `permissions:` **a nivel de job** (no del workflow, para no ampliar el scope de los demás):
  `contents: read` + `pull-requests: read`.
- `GITLEAKS_ENABLE_COMMENTS: "false"`: publicar comentarios en el PR exigiría
  `pull-requests: write` y no queremos ese permiso en un job de secretos. El gate **no se relaja**:
  si hay leaks el job falla igual y el detalle queda en el log y en el artifact SARIF.

**Deuda anotada (no bloqueante):** `gitleaks-action@v2` corre sobre Node 20, que GitHub retira de
los runners el **2026-09-16**. Antes de esa fecha hay que subir a `@v3` (mismos inputs/env; requiere
runner ≥ 2.327.1). No se subió en este arreglo para no mezclar un cambio de mayor con el desbloqueo
del release. Está anotado como comentario en el propio workflow.

### 22.2 `frontend-e2e` / `e2e-real` — Chromium inexistente en `ubuntu-latest`

**Síntoma (log real):**

```
##[error]No existe /opt/pw-browsers/chromium.
##[error]Este job usa el Chromium preinstalado del runner-harness (/opt/pw-browsers) y NO ejecuta 'playwright install'.
```

**Causa raíz:** los dos workflows E2E asumían un **runner-harness** con los navegadores de Playwright
preinstalados en `/opt/pw-browsers`, pero los jobs corren en `ubuntu-latest` (runner **estándar** de
GitHub), donde esa ruta **no existe** — solo existe dentro del entorno de Claude Code. El "Guard
navegador" hacía exactamente lo que decía su mensaje: abortar. Es decir, el job **nunca** pudo pasar
en CI con esa política.

**Cambio (approach estándar de Playwright en Actions):**
- `.github/workflows/e2e.yml` (job `frontend-e2e`): se eliminaron
  `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`, `PLAYWRIGHT_BROWSERS_PATH`, `PLAYWRIGHT_CHROMIUM_PATH` y el
  step *Guard navegador*. Se añadió `npx playwright install --with-deps chromium`
  (`working-directory: frontend`) **después** del `npm ci` del frontend — el orden importa: el CLI
  `playwright` vive en `frontend/node_modules`, antes del `npm ci` `npx` no lo encuentra.
- `.github/workflows/e2e-real.yml` (job `e2e-real`): mismas env vars y mismo guard eliminados; el
  `playwright install` va justo después del `npm ci` del frontend (que está al final del job) y
  antes del step *Playwright smoke*.
- Se reescribieron las cabeceras de ambos workflows y §5.1 de este documento, que documentaban la
  política vieja ("Chromium PREINSTALADO", "NO se ejecuta playwright install", "REQUISITO DE
  RUNNER"). Dejarlas habría sido documentación que miente sobre el pipeline.
- **Detalle que casi se escapa (y que habría dejado el job igual de rojo):**
  `frontend/playwright.config.ts` (rol **frontend**) fija
  `launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium'`.
  Con solo instalar el navegador, Playwright habría seguido intentando lanzar la ruta del harness.
  Por eso el step, tras instalar, **resuelve la ruta real con la API oficial**
  (`require('@playwright/test').chromium.executablePath()`), comprueba que el binario existe y es
  ejecutable (ese check sustituye al viejo *Guard navegador*, ahora sí con sentido en CI) y la
  exporta a `$GITHUB_ENV` como `PLAYWRIGHT_CHROMIUM_PATH` para los steps siguientes.
  **Hallazgo → rol frontend (no bloqueante):** el default hardcodeado `/opt/pw-browsers/chromium`
  del config solo tiene sentido en el runner-harness; lo natural sería dejar que Playwright resuelva
  el navegador por defecto y usar `executablePath` **solo** si la env está definida. Mientras el
  config siga así, estos workflows deben exportar la variable.
- **No** se añadió cache de navegadores (`actions/cache`): con `--with-deps` haría falta igual la
  instalación de libs de sistema y el ahorro no compensa el riesgo de cache stale. Si el tiempo de
  job molesta, es una optimización posterior.
- **Observación NO tocada (decisión consciente):** `e2e-real.yml` invoca el smoke con
  `E2E_BASE_URL` pero **sin** `E2E_REAL=1`, mientras que el `playwright.config.ts` documenta
  `E2E_BASE_URL=... E2E_REAL=1 npm run test:e2e` como forma de correr en real (filtra a los tests
  tagueados `@real`). No se cambió en este arreglo para no alterar qué tests corren en el gate de
  promoción a prod dentro de un fix de desbloqueo; queda como decisión para la próxima corrida real
  (si los specs mock-only de esos archivos fallan contra el backend real, la respuesta es añadir
  `E2E_REAL: "1"` al step del smoke).

### 22.3 `trivy-image` — **no era node-tar de la app: era el npm de la imagen base**

**La premisa inicial ("bumpear node-tar") era equivocada.** Verificado:
- `npm ls tar` **vacío** en `backend/` y en `frontend/`; ni `backend/package-lock.json` ni
  `frontend/package-lock.json` tienen una sola entrada de `tar`.
- Por eso el `"tar": ">=7.5.18"` de `overrides` en `backend/package.json` era **inefectivo**: no
  existe ningún `tar` en el árbol de dependencias que sobreescribir.

**Causa raíz real:** el reporte que rompía el gate era la sección **Node.js (node-pkg)** — *Total 16
(HIGH 15, CRITICAL 1)* — y **todos** los paths eran
`usr/local/lib/node_modules/npm/node_modules/...`: las dependencias internas del **npm empaquetado
dentro de la imagen base `node:20-alpine`** (`tar` 6.2.1 con CVE-2026-59873 CRITICAL y
CVE-2026-23745/23950/24842 HIGH, `brace-expansion` 2.0.1, `cross-spawn` 7.0.3, `minimatch`,
`picomatch`, `sigstore`…). Eso **no se puede arreglar desde package.json**: no lo declaramos
nosotros, llega con la imagen oficial de Node.

**Arreglo (elimina la vulnerabilidad, no la ignora): npm fuera de la etapa `runtime`.**
El runtime de producción no necesita npm; borrarlo hace desaparecer toda esa superficie y además
adelgaza la imagen.

- **`Dockerfile.frontend`** (etapa `runtime`): `RUN rm -rf /usr/local/lib/node_modules/npm
  /usr/local/bin/npm /usr/local/bin/npx` (en `/usr/local/bin`, `npm` y `npx` son symlinks a esa
  carpeta). El arranque es `node server.js` (output standalone de Next): no usa npm ni npx.
- **`Dockerfile.backend`** (etapa `runtime`): mismo `rm -rf`, **y cambio obligado del `CMD`**. El
  CMD anterior era `sh -c "npx prisma migrate deploy && node dist/main.js"`: sin npx **habría roto
  el arranque en Railway**. Ahora:

  ```dockerfile
  CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node dist/main.js"]
  ```

  `build/index.js` es el entrypoint real del CLI (verificado: `prisma@5.x` declara
  `"bin": {"prisma": "build/index.js"}`; `node_modules/.bin/prisma` es un symlink a ese archivo, y
  `node build/index.js --version` responde correctamente). El paquete `prisma` viaja en la imagen
  porque esta etapa conserva `node_modules` completo con devDeps a propósito (ver NOTA de la etapa
  build y §6).
- **Guards de build (ambos Dockerfiles):** tras el `rm -rf`, un `if` falla el build si `npm` sigue
  presente; en el backend, además, un `test -f node_modules/prisma/build/index.js`. Si una imagen
  base futura mueve esas rutas, o un bump de Prisma cambia su bin, el **build** falla con mensaje
  claro en vez de publicar una imagen vulnerable o crash-loopear al arrancar en Railway.
- **`security/.trivyignore`:** se **retiraron** los 4 CVE de node-tar (CVE-2026-26960/-29786/-31802/
  -59874) — ya no hay npm en el runtime que los traiga. El archivo queda **sin excepciones activas**
  (solo la justificación histórica) y se sigue pasando a los jobs para que cualquier excepción futura
  viva en un único sitio auditable. **No se añadió ningún CVE nuevo.**
- **Comentarios de `security-sast.yml`** (`trivy-fs`, `trivy-image` backend y frontend) actualizados:
  ya no justifican nada por node-tar.

**Efecto colateral que hubo que arreglar:** `e2e-real.yml` sembraba con
`docker compose exec -T backend npm run seed:synthetic --if-present` — **npm ya no existe en ese
contenedor**. Ahora el step lee el script `seed:synthetic` del `package.json` del contenedor
(`node -e`, misma fuente de verdad, sin hardcodear la ruta del seed, que es del rol backend) y lo
ejecuta con `node_modules/.bin` en el `PATH`. Semántica idéntica, incluido el "si no existe, se
salta" del `--if-present`. Los scripts de host (`scripts/seed.sh`, `scripts/seed-synthetic.sh`,
`scripts/db-migrate.sh`) **no** se ven afectados: corren en el host (que sí tiene npm/npx), no dentro
de la imagen.

### 22.4 Qué se verificó y qué NO (honestidad de la verificación)

**Verificado en este entorno:**
- YAML de `e2e.yml`, `e2e-real.yml`, `security-sast.yml` (+ `ci.yml`, `deploy.yml`) parsea con
  `yaml.safe_load`.
- Todos los bloques `run:` de los tres workflows tocados pasan `bash -n`.
- Lógica de extracción del seed (`node -e` + `sh -c` con PATH) probada localmente con el
  `backend/package.json` real: devuelve `ts-node prisma/seed-e2e.ts`, y con el script ausente emite
  el warning y sale 0.
- Entrypoint del CLI de Prisma: instalación limpia de `prisma@^5.20.0` →
  `bin.prisma = "build/index.js"`, `node node_modules/prisma/build/index.js --version` OK.

**NO verificado (bloqueo de entorno, no del arreglo):** **no se pudo construir ni escanear las
imágenes**. El daemon Docker arranca, pero el pull de `node:20-alpine` muere porque la política de
egress del sandbox bloquea el CDN de blobs de Docker Hub:

```
403 CONNECT production.cloudfront.docker.com:443
ERROR: failed to solve: node:20-alpine: ... Forbidden
```

Por tanto **queda pendiente de la primera corrida en CI**: (a) que el build de ambas imágenes pase
con el `rm -rf` de npm y los guards, (b) que `trivy image` ya no reporte HIGH/CRITICAL, y (c) que el
backend arranque con el nuevo `CMD` (migrate deploy + `node dist/main.js`). Si el gate siguiera rojo
por CVEs que **no** vengan de `usr/local/lib/node_modules/npm/...`, son CVEs reales: se tratan (bump
de imagen base o de dependencia), **no** se añaden al `.trivyignore`.

### 22.5 Rollback de este cambio

Todo el arreglo es de infraestructura y reversible con `git revert` del commit en
`claude/fix-ci-gates-release`. Riesgo a vigilar en el **primer deploy** tras el merge: el arranque
del backend depende ahora de `node node_modules/prisma/build/index.js migrate deploy`. Si en Railway
apareciera `Cannot find module '/app/node_modules/prisma/build/index.js'`, el rollback inmediato es
volver al `CMD` con `npx` **y** revertir el `rm -rf` de npm en `Dockerfile.backend` (ambos a la vez:
el `npx` no funciona sin npm). El guard `test -f` del build debería impedir que ese caso llegue a
producción.

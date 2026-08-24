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
>
> **⇒ Actualización 2026-08-24 (P-48 / v2.0 — «precio puro por valor de mercado»): EL RUNBOOK
> OPERATIVO VIGENTE ES §29.** Tres veredictos **aprobados** (QA · techlead con deuda · seguridad
> **0 críticos / 0 altos**) y **tres decisiones del dueño** ya reflejadas ahí:
> **(1)** **P-47 primero, P-48 después** — la fuente del precio se estabiliza **antes** de cambiar la
> matemática que se le aplica (§29.3, con criterio de corte explícito).
> **(2)** El cut-over va **POR SETS**, empezando por uno chico, leyendo `summary.listedNowPending` y los
> `counts` de la cola entre set y set (§29.4b/§29.4c).
> **(3)** La **brecha de E2E contra mocks** se cierra **antes** de desplegar, por la **ruta NATIVA sin
> Docker** de **§29.10** (`scripts/stack-native.sh` + subset `@real`). **La ejecuta QA.**
> **Estado del DoD y qué falta exactamente: §29.11.** §27 queda como **registro histórico**.
>
> **Actualización 2026-08-23 (D-4 — cierre techlead, regla 10):** el release
> `fix/variant-composition-regression` @ `9b6a81b` trae **cambios de DATOS** que `migrate deploy` NO cubre
> solo (reshape de tiers **P-34 T2=25%** + cura del sellado **M-39/M-40**). La **secuencia exacta
> post-deploy**, su idempotencia, qué hacer si falla y el **rollback** quedan en **§27**, y el orquestador
> idempotente **`scripts/post-deploy.sh`** los corre en orden y **PARA ante «ACCIÓN REQUERIDA»** del reshape
> money-crítico. Ver **§27**.

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
>
> ### ⚠️ Actualización 2026-08-24 — **si no tienes demonio de Docker, ve a §29.10.**
> Los comandos `docker compose` de esta sección **siguen siendo la ruta canónica en CI** y no
> cambian. Pero en la **máquina de trabajo del equipo NO hay demonio de Docker**
> (`/var/run/docker.sock` no existe), así que aquí **no arrancan**. La alternativa **soportada
> y verificada** es la **ruta NATIVA** de **§29.10** (`scripts/stack-native.sh`): mismo Postgres,
> mismo Redis, mismo backend Nest completo, frontend con `NEXT_PUBLIC_USE_MOCKS=false`, y el
> subset **`@real`** de Playwright contra `E2E_BASE_URL`. **No leas esta sección como si fuera el
> único camino:** fue justamente ese callejón sin salida el que dejó la verificación real sin correr.

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

1. `ci-ok` — gate. **HOY SOLO `workflow_dispatch` (disparo manual).** El trigger `workflow_run` que
   dispararía el CD al terminar **CI** en `main` está **COMENTADO** en el archivo (ver la cabecera de
   `deploy.yml`): sigue comentado a la espera de que se carguen los 6 secrets de deploy, porque sin
   ellos `preflight` falla. Mientras siga así, **NADA de esta cadena corre automáticamente**.

   > ⚠️ **Discrepancia detectada el 2026-08-18 y corregida aquí.** Esta sección afirmaba que el CD se
   > disparaba solo vía `workflow_run`. No era cierto, y la diferencia importa: significa que
   > `promote-production-frontend` (el `vercel deploy --prod`) **nunca se ha ejecutado**, y que los
   > gates de **DAST contra staging** y **E2E real** —descritos abajo como bloqueantes para promover a
   > producción— **nunca han corrido como parte de un deploy**. Todo lo que hay hoy en producción
   > (backend y frontend) llegó por las **integraciones de Git propias de Railway y Vercel**, que
   > despliegan al hacer push a su rama configurada, saltándose por completo esta cadena.
   >
   > Para cerrar el hueco hay que: (a) cargar los 6 secrets, (b) descomentar `workflow_run`, y
   > (c) decidir si Railway/Vercel siguen desplegando por su cuenta o se les quita el auto-deploy para
   > que la única vía sea el pipeline. Hacer las dos cosas a la vez provoca deploys duplicados.
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
      > **P-21 (rebrand `tcghunt.mx`):** este JSON quedó SUPERSEDIDO — la versión vigente (con los
      > orígenes nuevos + viejos) está en **§25.5**; usar esa a partir del rebrand.
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

  > **P-21 (rebrand `tcghunt.mx`):** JSON supersedido — la versión vigente con los orígenes
  > nuevos + viejos está en **§25.5**.

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

### 22.6 Tercera capa de `trivy-image`: OpenSSL de la capa OS (`apk upgrade`)

Cerrados los CVE de npm (§22.3) y los 2 HIGH de dependencias reales del backend (`glob` 10.4.5 →
10.5.0 / CVE-2025-64756, `picomatch` 4.0.1 → 4.0.5 / CVE-2026-33671, que arregló el rol **backend**
en `backend/package.json` con overrides acotados por rango), el gate SIGUIÓ rojo con un hallazgo de
naturaleza distinta:

```
tcg-frontend:scan (alpine 3.23.4)
libcrypto3  CVE-2026-45447  HIGH  3.5.6-r0 → 3.5.7-r0
libssl3     CVE-2026-45447  HIGH  3.5.6-r0 → 3.5.7-r0
openssl: Heap Use-After-Free in PKCS7_verify()
```

**Por qué solo el frontend:** la base del backend hace `apk add ... openssl`, que resuelve contra el
índice ACTUAL del repo de Alpine y de paso arrastraba `libcrypto3`/`libssl3` al día. La del frontend
no instala openssl, así que conservaba las libs congeladas en el tag `node:20-alpine`. O sea: que el
backend pasara era un **efecto colateral**, no una garantía.

**Arreglo (no un ignore):** `apk upgrade --no-cache` en la etapa `base` de AMBOS Dockerfiles, antes
del `apk add`. Cierra el CVE en el frontend, iguala la política en los dos, y cubre futuros CVE de la
capa OS sin depender de que el tag de Node se reconstruya. Se revisa al subir de imagen base.

**Lección para la próxima vez:** los hallazgos de `trivy-image` venían en TRES capas y cada una tapaba
a la siguiente — npm de la imagen base → devDependencies reales de la app → paquetes del sistema. Un
"arreglé el CVE" tras la primera capa habría sido falso. Conviene volver a correr el gate después de
cada capa hasta que salga limpio de verdad.

### 22.7 Robustez de los pasos de instalación en CI (cuelgues de `apt`)

**Síntoma.** En una sola noche, cuatro jobs se quedaron colgados en `apt-get`: `trivy-fs` (×2),
`trivy-image` y el `playwright install --with-deps` de `frontend-e2e`. Hasta **25 minutos** parados en
un paso que en un runner sano tarda entre 30 y 90 s — sin log, sin fallo, solo `in_progress` indefinido.
Hubo que cancelar y relanzar a mano cada vez.

**Por qué importa más de lo que parece.** Railway espera al **check suite COMPLETO** antes de
desplegar. Un job colgado bloquea el deploy sin dar ninguna señal accionable, y en el dashboard es
indistinguible de un job que todavía corre. La causa raíz no es el mirror de apt (que va a seguir
fallando de vez en cuando): era que estos pasos **no tenían ni timeout ni reintentos**, así que un
fallo transitorio se convertía en un cuelgue permanente.

**Arreglo, en dos iteraciones — la primera estaba mal y conviene que quede escrito:**

1. **Intento 1 (insuficiente):** `timeout` por comando + 3 reintentos + `timeout-minutes`. Acotaba el
   cuelgue, pero los reintentos **no servían**: `timeout` mata `apt-get` a mitad de la descarga y el
   proceso huérfano CONSERVA `/var/lib/dpkg/lock-frontend`, así que los intentos 2 y 3 morían al
   instante con `Could not get lock ... It is held by process N`. Reintentaba contra un lock que el
   propio timeout dejaba tomado.
2. **Intento 2 (el bueno):** `liberar_apt()` antes de cada reintento — mata `apt-get`/`dpkg` por
   **nombre exacto** (`pkill -x`, deliberadamente NO `-f`, para no arriesgarse a matar el propio shell
   del step), espera con `fuser` a que `lock-frontend` quede libre (máx. 60 s) y repara estado parcial
   con `dpkg --configure -a`. Además se subieron los márgenes, porque el fallo real **no era un cuelgue
   sino lentitud**: el log muestra `apt` tardando ~2 min en bajar un solo paquete de fuentes, de 21 MB
   totales. Playwright: 420 s por intento. `apt-get` de Trivy: 240/300 s.

**El gate NO se relaja.** Si tras 3 intentos no hay Trivy o no hay Chromium, el step FALLA (`exit 1`).
Nunca se continúa sin escanear ni sin navegador. `timeout-minutes` (20 en SAST, 25 en E2E) es un tope
duro frente al default de 6 h de Actions.

**Criterio para reintentar un job en el futuro.** Relanzar es legítimo SOLO cuando el job murió o se
colgó **antes** de ejecutar la verificación (setup del entorno, instalación de herramientas, checkout).
Si el escaneo o los tests llegaron a correr y fallaron, eso es un hallazgo real y se diagnostica — no
se relanza. Los cuatro reintentos de esta noche caen todos en el primer caso, y en ninguno se cambió
el commit entre intentos.

---

## 23. Encendido del proveedor de PAGA (cartas) y del sellado TCGCSV — intento de ejecución 2026-08-18

> **Estado honesto: NO EJECUTADO desde la sesión de devops.** Ninguna de las dos palancas se movió:
> `POKEMONPRICETRACKER_MARKET_FORMAT` sigue **sin fijar** en Railway, el dial `price_provider` sigue en
> `pokemontcg_io` y `sealed_price_source` sigue en `off`. Esta sección documenta **por qué** (bloqueo de
> acceso, no de conocimiento), **qué sí se verificó** y deja el **guion exacto** para que lo corra quien
> tenga las credenciales. Cross-ref: §19.5 (runbook original del flip), §19.7 (rollback), §21 (sellado).

### 23.1 Por qué no se pudo ejecutar (bloqueos verificados, no supuestos)

| Bloqueo | Evidencia |
|---|---|
| **Sin acceso a Railway** | No hay `railway` CLI ni `RAILWAY_TOKEN` en el entorno de la sesión (`which railway` → nada; `env` sin variables de Railway). Fijar `POKEMONPRICETRACKER_MARKET_FORMAT` y `SEALED_PRICE_INGEST_CRON` es **dashboard de Railway**, no repo. |
| **Sin credenciales `super_admin`** | Los diales (`PUT /admin/settings`) y los disparos (`POST /admin/jobs/*`) exigen bearer de `super_admin`. La sesión no tiene ni token ni el `NEXT_PUBLIC_API_BASE_URL` real del backend en prod (en el repo solo hay placeholders `api.tudominio.com`). |
| **Egress bloqueado hacia la app** | El proxy de la sesión rechaza el CONNECT a producción: `403 … "host":"www.tcgvaultmx.com:443"` (`$HTTPS_PROXY/__agentproxy/status` → `recentRelayFailures`). Aun con token, **no se puede llamar a prod desde aquí**. La red de la sesión solo abre registries + GitHub. |

> Consecuencia: los pasos 2–6 de la Tarea A y todo §21 los ejecuta **el humano** (o una sesión con
> credenciales). Abajo va el guion copiable, con los criterios de go/no-go y qué traer de vuelta.

### 23.2 Lo que SÍ se verificó desde aquí (precondición de código)

- **El código de WS-A está en las dos ramas relevantes:** `main` @`915210d` y `production` @`5422bae`
  contienen `backend/src/jobs/price-ingest.service.ts`, `backend/src/modules/pricing/price-ingest.service.ts`,
  el provider de paga con el **candado** `POKEMONPRICETRACKER_MARKET_FORMAT` (fail-closed → `sample-only`,
  `pokemonpricetracker-bulk.provider.ts:84,112`), el sellado TCGCSV (`tcgcsv-sealed.provider.ts`,
  `sealed-price-ingest.service.ts`) y la migración **M-23** (`20260817140000_m23_sealed_tcgcsv`).
- **Railway auto-despliega desde `main`** (HANDOFF §3) y `deploy.yml` **no** corre solo (§16.4): el deploy
  real es la integración nativa de Railway, no GitHub Actions.
- ✅ **CONFIRMADO en runtime 2026-08-18 06:24 UTC** (deploy logs de Railway aportados por el PO, servicio
  `tcg-vault-mx-production.up.railway.app`, deploy `Active`): el backend en producción **SÍ tiene WS-A y
  v1.19**. Evidencia directa: rutas `Mapped {/api/v1/admin/jobs/price-ingest, POST}` y
  `Mapped {/api/v1/admin/jobs/sealed-price-ingest, POST}`; `Scheduler: conexión Redis lista (BullMQ
  operativo).`; `Scheduler activo (BullMQ): … + price-ingest 2×/día (00:00 y 12:00 UTC, dial
  pokemontcg_io) + sealed-price-ingest diario (21:30 UTC, dial sealed_price_source, seed off) +
  catalog-metadata-sync diario`; y `price-ingest catch-up: hay ingesta reciente (hoy/ayer); no se encola.`
  **El scheduler está vivo, los dos crons están registrados y los dos diales están en su seed.** La
  precondición del §23.2 queda cumplida: se puede proceder con §23.4 y §23.5.
- ⚠️ **Detalle sin resolver (menor):** Railway reporta el commit **`9cb1534a`**, que **no existe** en el
  repo (`git cat-file` y la API de GitHub → `422 No commit found`); probablemente una rama borrada tras
  merge. No bloquea: las rutas y la línea del scheduler prueban que el binario desplegado incluye WS-A +
  v1.19. Si se quiere trazabilidad exacta, re-desplegar desde `main` deja el commit identificable.
- **NO verificable desde aquí (lo primero que debe mirar el humano):** que el **último deploy de Railway
  haya quedado verde y esté sirviendo ese commit**. Tras el día de CI/deploy con problemas (§22), esto no
  se puede asumir. Verificación mínima, en este orden:
  1. Railway → servicio `backend` → **Deployments**: el último `Success` y su commit = `915210d` (o posterior).
  2. `GET /api/v1/health` → `200`, componente **Redis `up`** (§20.2).
  3. Deploy logs con `Scheduler: conexión Redis lista (BullMQ operativo).` + `Scheduler activo (BullMQ): …`
     y una línea de **catch-up** de `price-ingest` (§20.2.1). **Si el scheduler no está vivo, ningún cron
     corre y nada de lo de abajo se programa solo** — se puede seguir, pero todo queda a disparo manual.
  Si el backend en prod es viejo (sin `price-ingest` cableado), **PARAR**: no es un problema de config, es
  un deploy pendiente → se reporta y se re-despliega antes de tocar diales.

### 23.3 Corrección a §19.5 y §21 — dónde vive REALMENTE cada dial (hallazgo de esta sesión)

Los runbooks decían "panel M10". Verificado contra el código del front, **no es exacto**:

| Palanca | Dónde está de verdad | Nota |
|---|---|---|
| `priceProvider` (dial del ingest masivo) | **Admin M2**, sección "proveedor de la ingesta masiva" (`M2View.tsx:197-213`, `updatePriceProvider`) | **NO** está en M10: `M10View.tsx` `DIALS[]` no lo lista. Lo que M10 sí tiene es `pricingProviderRaw/Graded/Sealed`, que es **otro** dial (referencia por-carta), fácil de confundir. |
| Disparo `price-ingest` **completo** | Admin M2, botón junto al selector (`triggerPriceIngest()`) | Dispara **sin `setId`** → barre TODO el catálogo. |
| Disparo `price-ingest` de **UN set** (`{setId}`) | **Solo API** (`POST /admin/jobs/price-ingest {"setId":"…"}`) | El front no expone el `setId` → la corrida de blast-radius contenido de §19.5 **exige curl**. |
| `sealedPriceSource` (dial del sellado) | **Sin UI en ningún módulo** (`grep sealedPriceSource frontend/src` → 0 hits) | Tarea B es **100% por API**. |
| Curación de mapeo sellado (`/admin/pricing/sealed/*`) | **Sin UI** (`M2View.tsx` no consume esos endpoints) | Sin mapeos, el ingest de sellado **no escribe nada** (§23.5). |

> **Hallazgo enrutado a `frontend`** (dueño de `frontend/`; devops no lo toca): faltan en el admin (a) el
> dial `sealedPriceSource`, (b) el explorador/curación TCGCSV de sellado (`unmapped` → `groups` →
> `products` → `PUT mapping`) y (c) el `setId` opcional en el disparo de `price-ingest`. El contrato ya
> los define (`API_CONTRACT` §M2 sealed-tcgcsv y §M10/§M10-ops) y `api.ts` ya tiene `updatePriceProvider`.
> Mientras tanto, ambas tareas se operan por API con token `super_admin`.

### 23.4 Guion Tarea A — flip a `pokemonpricetracker` (variante aprobada por el PO)

> **Desviación respecto de §19.5, decidida por el PO:** el formato se fija **`usd_dollars` de entrada**,
> **sin** el paso intermedio de leer el log de muestra (§19.5 pasos 2-4). Queda escrito que es una
> decisión del PO, no un olvido del runbook. El riesgo que cubría ese paso (payload en MXN → precios
> **~18× inflados**) se traslada al **chequeo de salida del paso 4 de abajo**, que es OBLIGATORIO y
> tiene acción correctiva definida. El ingest es idempotente por día, así que un error del formato se
> corrige re-corriendo el set con el formato bueno.

Prerrequisitos: haber pasado §23.2 (deploy nuevo + Redis/scheduler vivos) y tener `BASE` (base URL del
backend en prod, `…/api/v1`) y `TOKEN` (bearer de `super_admin`).

1. **Railway → servicio `backend` → Variables:** confirmar `POKEMONPRICETRACKER_API_KEY` presente y
   añadir **`POKEMONPRICETRACKER_MARKET_FORMAT=usd_dollars`**. Railway redespliega solo al cambiar
   variables; si no, redeploy manual. **Esperar a que el deploy quede `Success` antes de seguir** (la env
   se lee en runtime: sin el nuevo deploy el proveedor sigue en `sample-only`).
2. **Flip del dial** (sin redeploy) — en el admin **M2** (no M10), o por API:
   ```bash
   curl -sS -X PUT "$BASE/admin/settings" -H "Authorization: Bearer $TOKEN" \
        -H 'Content-Type: application/json' -d '{"priceProvider":"pokemonpricetracker"}' | jq .
   # verificar:
   curl -sS "$BASE/admin/settings" -H "Authorization: Bearer $TOKEN" | jq '.priceProvider'
   ```
3. **Corrida de UN set** (blast radius contenido; usar el set que el PO está probando — el `setId` real se
   saca de `GET $BASE/catalog/sets`, es el id del proveedor de catálogo, p. ej. `sv8`):
   ```bash
   curl -sS -X POST "$BASE/admin/jobs/price-ingest" -H "Authorization: Bearer $TOKEN" \
        -H 'Content-Type: application/json' -d '{"setId":"sv8"}' | jq .     # 202 {scope:"set", …}
   ```
4. **Verificar la salida ANTES del rollout** (esto no es un gate de aprobación, es leer el resultado):
   - **Rango sano:** una carta de **~$10 USD** debe quedar en **~180–220 MXN** ya con FX+colchón.
     Se ve en la ficha pública de la carta (deja de decir "Precio pendiente") o en el admin M2.
   - **Acabados mapeados:** que no todo quede en `normal` (debe haber `reverse_holo`/`holofoil` donde aplique).
   - **Cobertura:** `GET $BASE/admin/dashboard` → `dataHealth.pendingPriceCount` debe **bajar** y
     `lastPriceSyncAt` ser de hoy; en logs, `price-ingest-set(<setId>, pokemonpricetracker): X cartas,
     Y refs, …` con `skipped` bajo.
   - 🚨 **Si los precios salen ~18× inflados (una carta de $10 USD en ~3,600 MXN):** el payload venía en
     **MXN**. Corregir `POKEMONPRICETRACKER_MARKET_FORMAT=mxn_dollars` en Railway (+ redeploy), re-correr
     el mismo set (paso 3) y re-verificar. **Avisar al PO del hallazgo** — es exactamente el caso que el
     paso del log de muestra cubría. No requiere cambio de código.
   - Si no cuadra con **ninguno** de los 4 formatos (`usd_dollars`/`usd_cents`/`mxn_dollars`/`mxn_cents`):
     **rollback por dial** a `pokemontcg_io` (§19.7) y enrutar a **backend**.
5. **Rollout completo** (solo si el paso 4 cuadró):
   ```bash
   curl -sS -X POST "$BASE/admin/jobs/price-ingest" -H "Authorization: Bearer $TOKEN" | jq .
   ```
   o dejar que lo hagan los crons 2×/día (`PRICE_INGEST_CRON_1/_2`, 06:00 y 18:00 CDMX, §19.3).
6. **Después:** si se quiere la gráfica del home con datos frescos, `POST /admin/jobs/set-value-snapshot`
   una vez tras el ingest (§19.9).

**Rollback money-safe (cualquier momento):** dial `priceProvider` → `pokemontcg_io` desde M2/API, **sin
redeploy** (§19.7). No se tocan `BUYLIST_PRICE_RULES` ni `BUYLIST_PRICE_FALLBACK_PCT`: este trabajo cambia
**solo el proveedor de la referencia de mercado**, nunca la regla que se le aplica encima.

### 23.5 Guion Tarea B — encender el sellado por TCGCSV (§21)

**Lo que hay que entender antes:** el cron **no basta**. El job recorre `InventoryItem` con
`productType='sealed'` **y mapeo TCGplayer no nulo** (`sealed-price-ingest.service.ts:60`). **Sin mapeos
curados, el ingest corre y escribe cero referencias** — no es un fallo, es que no hay a qué apuntar. Y la
curación **no tiene UI** (§23.3), así que hoy es por API.

1. **Railway → `backend` → Variables:** `SEALED_PRICE_INGEST_CRON` — el default del código ya es
   `30 21 * * *` (21:30 UTC = 15:30 CDMX, después del refresh diario de tcgcsv.com y del `fx-refresh`).
   **Solo hay que fijarla si se quiere otro horario**; ponerla vacía es peor que no ponerla (§19.3).
2. **Curar 1–2 mapeos** (mínimo para probar):
   ```bash
   curl -sS "$BASE/admin/pricing/sealed/unmapped" -H "Authorization: Bearer $TOKEN" | jq '.data[] | {inventoryItemId, folio, sealedSubtype}'
   curl -sS "$BASE/admin/pricing/sealed/tcgcsv/groups?q=surging" -H "Authorization: Bearer $TOKEN" | jq '.data'
   curl -sS "$BASE/admin/pricing/sealed/tcgcsv/groups/<GROUP_ID>/products?q=elite" -H "Authorization: Bearer $TOKEN" | jq '.data'
   curl -sS -X PUT "$BASE/admin/pricing/sealed/items/<ITEM_ID>/mapping" -H "Authorization: Bearer $TOKEN" \
        -H 'Content-Type: application/json' \
        -d '{"tcgplayerProductId":<PID>,"tcgplayerGroupId":<GROUP_ID>,"applyToSiblings":true}' | jq .
   ```
   (`applyToSiblings:true` copia el mapeo a las otras copias físicas del mismo producto sin mapeo.)
3. **Flip del dial** (fail-closed `off` → `tcgcsv`; sin UI, por API):
   ```bash
   curl -sS -X PUT "$BASE/admin/settings" -H "Authorization: Bearer $TOKEN" \
        -H 'Content-Type: application/json' -d '{"sealedPriceSource":"tcgcsv"}' | jq '.sealedPriceSource'
   ```
4. **Corrida acotada a un grupo** y verificación:
   ```bash
   curl -sS -X POST "$BASE/admin/jobs/sealed-price-ingest" -H "Authorization: Bearer $TOKEN" \
        -H 'Content-Type: application/json' -d '{"groupId":<GROUP_ID>}' | jq .
   ```
   - Logs: resumen con `grupos`/`referencias` + contadores `fetchedRaw/skipped/usedFallbackMid/unmatched`.
   - Datos: en el admin **M1** el item sellado mapeado muestra **`sealedMarketRef` poblado** (deja de ser
     `null`), coherente con el FX del día.
   - Señales de problema: `502 UPSTREAM_ERROR` (tcgcsv caído o egress bloqueado) o `unmatched` alto
     (mapeos apuntando a productIds que no existen en ese grupo).
   - **Esta es la primera corrida contra el payload real** (los tests usan fixtures porque dev bloquea
     tcgcsv.com, §21.4). Si el esquema difiere → **hallazgo a backend**, no se parchea aquí.
5. **Rollback:** dial `sealedPriceSource` → `off` (sin redeploy). Las filas ya escritas quedan inertes:
   son referencia informativa, nadie las consume para publicar ni valuar (§21.3).

**Independencia de los dos adapters — verificada en código, uno no pisa al otro:**

| | Cartas sueltas (Tarea A) | Sellado (Tarea B) |
|---|---|---|
| Dial | `price_provider` (`pokemonpricetracker`) | `sealed_price_source` (`tcgcsv`) |
| Job / cron | `price-ingest` (+`-set`), `PRICE_INGEST_CRON_1/_2` | `sealed-price-ingest`, `SEALED_PRICE_INGEST_CRON` |
| `PriceReference.source` | `pokemonpricetracker` (`pokemonpricetracker-bulk.provider.ts:61`) | `tcgcsv` (`tcgcsv-sealed.provider.ts:74`) |
| Filas que toca | `productType` raw, por `(cardId, finish)` | `productType='sealed'` **con mapeo** (`sealed-price-ingest.service.ts:60,107`) |

Escriben en la misma tabla pero **nunca en la misma fila** (clave única distinta por `productType`/`gradeKey`),
y cada uno tiene su propio dial de apagado. Encender o apagar uno no afecta al otro.

### 23.6 Qué falta del lado del humano (checklist accionable)

- [ ] **Confirmar el deploy de prod** (§23.2): último deploy `Success` en Railway con commit ≥ `915210d`,
      `/api/v1/health` con Redis `up`, y las líneas de scheduler + catch-up en logs. **Si esto falla, parar.**
- [ ] **Traer de vuelta**, si se quiere que devops continúe: (a) base URL real del backend en prod,
      (b) confirmación de que existe la env `POKEMONPRICETRACKER_API_KEY`, (c) las 3 líneas de log del
      arranque del scheduler, (d) el `setId` exacto del set "Pitch Black" que el PO está probando.
- [ ] **Ejecutar §23.4** (Railway var + flip en M2 + corrida de un set + verificación de rango) y
      **§23.5** (mapeos + dial + corrida por grupo).
- [ ] **Reportar el resultado del chequeo de rango** del paso 4 de §23.4 — es el único punto donde el
      atajo aprobado por el PO (fijar `usd_dollars` sin leer la muestra) se paga o se cobra.
- [ ] **Frontend** (otro rol): exponer en el admin el dial `sealedPriceSource`, la curación TCGCSV del
      sellado y el `setId` del disparo de `price-ingest` (§23.3).

### 23.7 Hallazgo 2026-08-18 — pokemontcg.io está caído (500/502) y por eso el catálogo sigue sin precios

Los deploy logs del 18/08 (06:30–06:32 UTC) muestran el job `set-price-sync` recorriendo el set destacado
carta por carta contra pokemontcg.io y recibiendo **HTTP 500/502 en prácticamente todas**:

```
WARN [PokemonTcgIoProvider] pokemontcg.io me5-2  -> HTTP 502
WARN [PokemonTcgIoProvider] pokemontcg.io me5-3  -> HTTP 500
…  (≈100 líneas, todo el set)
LOG  [SetPriceSyncJobService] set-price-sync: set 7b1e3f3b-…-51031b2c1db1 → 0/120 cartas con precio del día.
```

**Lectura operativa — esto cambia la urgencia del flip:**

1. **El fix de Redis (§20) funcionó.** El scheduler corre, los crons disparan y los jobs completan
   (`Job set-price-sync (…) completado.`). El catálogo sin precios **ya no es culpa del scheduler**.
2. **La causa viva es el proveedor:** con el dial en `pokemontcg_io`, la fuente **está devolviendo 5xx** →
   `0/120` cartas preciadas. Ningún ajuste de devops arregla eso: es un upstream de terceros caído o
   rate-limiteando con 5xx. **Flipear a PokemonPriceTracker (§23.4) no es solo el plan del PO: hoy es la
   única vía que puede poblar precios.**
3. **Money-safe intacto:** el ingest **no borra** precios al fallar (los deja stale) y `set-price-sync` no
   escala pendientes. El daño es cobertura cero, no precios malos.

**Hallazgo colateral — `set-price-sync` NO se apaga con el flip (enrutado a `backend`):**

El dial `price_provider` gobierna **solo** el ingest masivo (`price-ingest`). El job `set-price-sync`
(cron `30 6 * * *`, `scheduler.service.ts:158`) va por otra ruta: `PricingService.syncCardPrice` →
`providerFor()` → dial **`pricing_provider_raw`** (M10), cuyo seed es `pokemontcg_io`
(`settings.constants.ts:76`). Y **no hay alternativa**: el `PokemonPriceTrackerProvider` **por-carta** es
un **STUB** que siempre devuelve `null` y además **solo declara `supports('graded'|'sealed')`**
(`graded-sealed.providers.ts:19-31`) — la integración real de paga vive únicamente en el adapter **bulk**.
Consecuencias:

- Poner `pricingProviderRaw=pokemonpricetracker` en M10 **empeoraría** la situación (ningún provider
  matchea `raw` → todo pendiente, sin siquiera intentar). **NO tocar ese dial.**
- Tras el flip de §23.4, `set-price-sync` **seguirá** golpeando pokemontcg.io a las 06:30 UTC y llenando
  los logs de WARN. Es **ruido inocuo** (no borra ni corrompe), pero es trabajo desperdiciado: según
  ARCHITECTURE §4.15g, `price-ingest` **subsume** a `set-price-sync` (el ingest precia todo el catálogo,
  incluido el set del hero).
- **Solicitud a `backend`** (es código de `backend/src/jobs/scheduler.service.ts`, no config de devops):
  retirar `set-price-sync` del schedule —o repuntarlo a leer las `PriceReference` ya ingestadas— una vez
  que el flip esté verificado. Devops no lo toca (regla de propiedad de archivos). Mientras tanto no
  bloquea nada.

### 23.8 Estado de las variables en Railway (verificado 2026-08-18) y la trampa de `PRICE_PROVIDER` como env

Captura de **Railway → `backend` → Variables** (31 service variables) aportada por el PO:

- ✅ **`POKEMONPRICETRACKER_MARKET_FORMAT=usd_dollars`** — el candado money-safe ya está **abierto**. El
  paso 1 de §23.4 está HECHO (queda confirmar que el deploy posterior al cambio terminó `Success`: la env
  se lee en runtime).
- ✅ `POKEMONPRICETRACKER_API_KEY` presente. 🚨 **Se expuso en claro en la captura → ROTAR** en el portal
  del proveedor y actualizar el valor en Railway. El valor NO se transcribe aquí ni en ningún archivo del
  repo (§15.2). Rotarla no afecta al runbook: es la misma variable, otro valor.
- ⚠️ **`PRICE_PROVIDER` existe como variable de Railway — y NO flipea el proveedor.** Es un punto de
  confusión real, así que queda escrito: esa env es **solo un HINT de arranque** para `env.validation.ts:48`
  (si vale `pokemonpricetracker`, el backend exige `POKEMONPRICETRACKER_API_KEY` al boot y falla rápido si
  falta). **La autoridad en runtime es el ConfigSetting `price_provider`**, que el ingest lee en cada
  corrida (`price-ingest.service.ts:56`, `settings.getString(SettingKey.PRICE_PROVIDER)`). Ningún código
  lee `process.env.PRICE_PROVIDER` para elegir proveedor (grep exhaustivo: 0 hits fuera de la validación).
  → **Poner `PRICE_PROVIDER=pokemonpricetracker` en Railway deja el sistema con el candado abierto pero el
  proveedor todavía en `pokemontcg_io`** (es decir, ingiriendo de la fuente que hoy devuelve 5xx, §23.7).
  El flip de verdad es el paso 2 de §23.4: admin **M2** o `PUT /admin/settings {"priceProvider":…}`.

> Ambigüedad de nombres a tener presente: `PRICE_PROVIDER` (env, hint de boot) ≠ dial `price_provider`
> (ConfigSetting, autoridad) ≠ `pricing_provider_raw/graded/sealed` (M10, ruta por-carta, §23.7). Tres
> cosas distintas con nombres casi idénticos; solo la segunda decide de dónde salen los precios del ingest.

### 23.9 Causa probable de "0 refs": el adapter llama al endpoint bulk con un cuerpo que ese endpoint no acepta

**Síntoma (PO, 18/08):** con el dial ya en `pokemonpricetracker` y `MARKET_FORMAT=usd_dollars`, el cotizador
sigue mostrando **"Precio pendiente"** en las cartas cuya regla de rareza es `pct` (las de regla `fixed`
muestran su piso y **enmascaran** el problema — `money.ts:206-208`). El PO verificó que el proveedor **sí
tiene precios** para ese set. Es decir: el dinero está pagado, los datos existen, y no llegan a la BD.

**Hallazgo (devops, verificado contra la documentación pública del proveedor — el egress de la sesión
bloquea el dominio, así que la fuente son las páginas de doc/API-reference indexadas, NO una corrida real):**

| | Lo que hace el adapter (`pokemonpricetracker-bulk.provider.ts:140-147`) | Lo que documenta el proveedor |
|---|---|---|
| Endpoint | `POST /api/v1/cards/bulk-price` | `POST …/cards/bulk-price` **existe**, pero su cuerpo es `{ cardIds: ["base1-4", …], includeHistory }` — una **lista explícita de ids**, no un filtro |
| Cuerpo enviado | `{ set: <CardSet.externalId>, limit: 250, page: N }` | ese endpoint **no documenta** `set`/`limit`/`page` |
| "Todas las cartas de un set" | — | `GET /api/prices?setId=<ids,coma>&limit=1000` → `{ data: [...], pagination: { total, page, limit } }` |
| Campos de precio | busca `market`/`marketPrice`/`price` | `marketPrice`, `lowPrice`, + `setId`, `cardNumber`, `rarity`, `printing`, `lastPriceUpdate` |

Los tres `SUPUESTO (verificar 1ª corrida)` que el propio adapter dejó escritos (líneas 65, 146, 157) son
exactamente los que fallan. Con un cuerpo que el endpoint no reconoce, `fetchPage` recibe un `!res.ok` →
`throw HTTP <code>` → lo captura el `catch` money-safe → **devuelve 0 filas sin borrar nada** → cero
`PriceReference` → todo lo `pct` queda pendiente. El síntoma encaja al 100%.

**Confirmación en una línea de log** (Railway, filtro `PokemonPriceTracker`):
`PokemonPriceTracker bulk: set <id> falló: HTTP 400/404 … Se devuelven 0 filas`. Si en cambio apareciera
la línea `ejemplo de entrada cruda`, el request sí pasó y el problema sería de mapeo, no de endpoint.

**ENRUTADO A `backend`** (dueño de `backend/src/modules/pricing/providers/**`; devops no toca código de app,
regla de propiedad de archivos). Alcance del cambio, acotado:

1. `fetchPage`: cambiar a **`GET /api/prices?setId=<externalId>&limit=<N>&page=<n>`** con el mismo
   `Authorization: Bearer`, y paginar por `pagination.total/page/limit` en vez de por "página incompleta".
   Alternativa equivalente: seguir con `bulk-price` pero enviando `cardIds` construidos desde las `Card`
   locales del set (más requests y más frágil; preferible la primera).
2. `extractEntries` **ya sirve** (`{ data: [] }` está contemplado). `mapEntry` shape (B) **ya lee**
   `marketPrice` y `printing`/`variant` → probablemente no requiere cambios.
3. `resolveCardId` (`price-ingest.service.ts:193`) resuelve por `externalId` y cae a `(set, number)`:
   verificar contra el `cardNumber` real del proveedor (formato `"104"` vs `"104/159"`).
4. Confirmar la unidad de `marketPrice` (dólares) contra el log de muestra: si es dólares, el
   `MARKET_FORMAT=usd_dollars` ya fijado es correcto y no hay que tocar Railway.
5. Verificar el tope real de `limit` (la doc de marketing menciona 100 por request en el bulk y 1000 en
   `/api/prices`) y ajustar `pageLimit`/`maxPages`.

> Nota de honestidad: esto es **causa probable, no verificada en runtime**. La confirmación barata es la
> línea de log de arriba; la definitiva, una corrida tras el fix. Ninguna palanca de devops (dial, env,
> cron) puede arreglarlo: el request sale mal formado desde el código.

---

## 24. Force re-sync de catálogo/acabados — dato stale de `availableFinishes` (2026-08-19, stream `claude/pulido-precios-display`)

> **Runbook operativo (no de código).** Documenta cómo forzar el re-procesado del catálogo para repoblar
> acabados (`availableFinishes` / `catalogFinishes`) cuando una carta aparece con acabados incompletos
> (p. ej. solo "Normal", sin Reverse Holo). **No es un bug** — es dato heredado que requiere un re-sync
> **forzado**. Verificado contra el código en esta sesión. Cross-ref: N-15, §18 (metadata/manual sync),
> §19 (ingest de precios PPT).

### 24.1 Por qué pasa (contexto N-15)

El PO reporta cartas (p. ej. **Tropius**) que aparecen **solo con "Normal"** y **sin Reverse Holo**.
Diagnóstico **confirmado**:

- **NO es bug de código.** El mapeo `reverseHolofoil → reverse_holo` y la ingesta de su precio son
  **correctos**.
- La causa es **dato stale**: cartas/sets **importados antes** del trabajo de acabados conservan el
  default legacy **`availableFinishes=[normal]`** hasta que se corre un **re-sync FORZADO**.
- La columna **`catalogFinishes`** (proveniente de pokemontcg.io) **solo se recomputa al forzar**.
- **"Actualizar precios"** (price ingest PPT, §19) **NO repuebla acabados de catálogo** — es **otra
  operación** distinta; refresca `PriceReference`, no `availableFinishes`.

### 24.2 Cómo forzar el re-sync (dos vías, ambas ya existentes)

**Vía 1 — UI admin (recomendada para el PO):**

- Panel **M2** → botón **"Re-sincronizar todo (forzar)"** ("Re-sync everything (force)" en EN).
- Pide **confirmación** (operación **pesada**): reprocesa **TODO** el catálogo, incluidos sets **ya
  importados**, y repuebla `availableFinishes` / precios por acabado.
- Corre en **segundo plano**; el progreso se ve en la **barra de estado de catálogo**
  (`GET /admin/catalog/sync-status`).
- **Diferénciala** de:
  - **"Importar sets nuevos"** → `force:false`, operación **ligera** (solo sets nuevos, §18).
  - **"Actualizar precios"** → ingest PPT (§19), **no toca acabados**.

**Vía 2 — API directa:**

- `POST /admin/catalog/sync-all` con body `{ "force": true }` (o query `?force=true`).
- **Auth admin** requerida.
- Progreso: `GET /admin/catalog/sync-status`.

### 24.3 Notas operativas

- **Idempotente y money-safe:** repuebla `availableFinishes` (whitelist **SEC-A1**) desde pokemontcg.io;
  **no borra dinero** ni `PriceReference` existentes.
- **Relación con N-15:** la supresión de la casilla `'normal'` espuria (`displayFinishes`, §4.22a-6) es
  **DISPLAY-only** y **NO sustituye** a este force-sync. El Reverse Holo **real** de las normales aparece
  **solo tras repoblar acabados** con datos frescos de PPT (o si ya estaban frescos).
- **Ejecución:** el **PO corre el force-sync por su lado** (UI M2, vía 1) **tras el merge del stream**
  `claude/pulido-precios-display`. Devops no puede dispararlo desde la sesión (sin credenciales admin ni
  egress a prod, cf. §23.1).

---

## 25. P-21 — Rebrand a `tcghunt.mx`: infra, redirects 301 y runbook del switch (2026-08-21)

> **Contexto:** el humano YA compró `tcghunt.mx` (PENDIENTES P-21). Hoy producción sirve en
> `tcgvaultmx.com` (frontend en **Vercel**, canónico `www.tcgvaultmx.com`; apex redirige a `www`;
> DNS en **Cloudflare, DNS only/nube gris** — HANDOFF §3). El backend vive en **Railway** con su
> **propio dominio** `tcg-vault-mx-production.up.railway.app` (§23.2) — el rebrand **no** lo toca.
> **Todo lo de esta sección es ADITIVO**: nada de lo pre-configurable rompe el entorno actual;
> el switch real (paso 25.6-B) lo ejecuta el humano en una ventana, con rollback definido.
> El **nombre interno NO cambia** (repo/servicios siguen `tcg-vault-mx`, DESIGN_SYSTEM §17.4).

### 25.1 Inventario — dónde vivía el dominio viejo en rutas de infra (grep `tcgvaultmx`, 2026-08-21)

| Dónde (archivo:línea al día del grep) | Qué es | Acción |
|---|---|---|
| `.env.example` — `APP_BASE_URL` (comentario, ~l.73), `DISPUTE_EVIDENCE_CONTACT` (~l.193), `TARGET_URL` DAST (~l.511) | Comentarios/placeholder con dominio viejo; faltaba documentar `RESEND_API_KEY`/`MAIL_FROM` | **ACTUALIZADO hoy**: lista objetivo de `APP_BASE_URL` con `tcghunt.mx`, bloque nuevo de correo Resend/`MAIL_FROM`, notas P-21 en disputa y DAST |
| `security/scripts/dast-zap-baseline.sh:26`, `dast-zap-full.sh:23`, `dast-nuclei.sh:22`, `dast-extra.sh:29` | Guardia anti-prod: solo reconocía el placeholder `tudominio.com` — **ninguno de los dos dominios reales disparaba la guardia** | **ACTUALIZADO hoy**: la guardia reconoce `tcgvaultmx.com` **y** `tcghunt.mx` como producción (verificado: exit 2 sin `ALLOW_PROD_DAST=1`; `staging.*` pasa) |
| `security/README.md:100` (Guardia anti-producción) | Documentación de la guardia | **ACTUALIZADO hoy**: lista los dominios reales |
| `.github/workflows/*` (ci, e2e, e2e-real, deploy, security-*) | **CERO referencias hardcodeadas** al dominio: los targets van por secrets `STAGING_BASE_URL`/`PROD_BASE_URL` | Sin cambio de archivo; el día del switch se actualiza el **GitHub Secret** `PROD_BASE_URL` (§25.6-B) |
| `docker-compose.yml:183`, `docker-compose.staging.yml:176` | Comentario: default backend `soporte@tcgvaultmx.com` | Sin cambio: sigue siendo verdad hasta que **backend** cambie su default (P-21); entonces devops actualiza el comentario |
| `docs/DEVOPS_NOTES.md` §4 (~l.167), §11.B (~l.580, ~l.865), §11.D (~l.630), §23.1 (~l.2093) | Runbooks históricos con el dominio viejo | Se conservan como histórico; esta §25 es la fuente de verdad del rebrand |
| Dashboards (no repo): Railway `APP_BASE_URL`, `MAIL_FROM`, `DISPUTE_EVIDENCE_CONTACT`; R2 CORS del bucket `tcg-kyc-ine`; Google OAuth origins; Resend dominio; Cloudflare Email Routing; GH Secret `PROD_BASE_URL`; Stripe branding | Valores vivos con el dominio/buzones viejos (HANDOFF §3) | Runbook §25.6 (pre-switch aditivo + ventana) |
| **Fuera de rutas devops** (inventario informativo, NO lo toca devops): `backend/src/modules/mail/mail.module.ts` (default `no-reply@tcgvaultmx.com`), `disputes.constants.ts`, `buylist-mail.templates.ts`, `guest-checkout.constants.ts` (buzones hardcodeados), `frontend/messages/{es,en}.json` y componentes con `contacto@/soporte@/facturacion@tcgvaultmx.com` | Marca/buzones en código | **Handoff P-21 a backend y frontend** (ya en alcance de PENDIENTES P-21 y DESIGN_SYSTEM §17.4) |

### 25.2 Redirects 301 — dónde se implementan (decisión)

El dominio viejo y el nuevo apuntan **al mismo proyecto de Vercel**; los 301 se hacen en Vercel.
Hay dos mecanismos válidos — **usar UNO, no ambos a la vez** (para poder razonar el rollback):

1. **Dashboard de Vercel (recomendado para la ventana del switch):** Proyecto → Settings → Domains →
   en `tcgvaultmx.com` y `www.tcgvaultmx.com` elegir **"Redirect to"** → `www.tcghunt.mx` con **status 301**.
   Preserva path y query string. Ventajas: sin deploy, reversible al instante (quitar el redirect),
   independiente del código. Desventaja: no queda versionado en el repo.
2. **`frontend/vercel.json` (versionado):** el Root Directory del proyecto Vercel es `frontend/`
   (§11.A), así que el archivo de config vive en **`frontend/vercel.json`** → es **ruta del rol
   frontend**, devops NO lo escribe. Contenido exacto en §25.7 (handoff). OJO: en cuanto ese archivo
   se mergee y despliegue, el 301 queda ACTIVO — se mergea **en la ventana del switch**, no antes.

**Mapa de redirects (convención actual www-canónico, HANDOFF §3):**

| Origen | Destino | Código |
|---|---|---|
| `tcgvaultmx.com/*` (path+query) | `https://www.tcghunt.mx/*` | 301 |
| `www.tcgvaultmx.com/*` (path+query) | `https://www.tcghunt.mx/*` | 301 |
| `tcghunt.mx/*` (apex nuevo) | `https://www.tcghunt.mx/*` | redirect apex→primario de Vercel (permanente; se configura al marcar `www.tcghunt.mx` como **primary**, igual que hoy con el viejo) |

Requisito para que el 301 del viejo funcione: los dominios viejos **siguen asignados** al proyecto
Vercel y su DNS **sigue apuntando** a Vercel. No se apagan: se conservan **≥ 12 meses** (SEO,
enlaces en correos ya enviados). `tcg-vault-mx.vercel.app` se deja como está (dominio técnico).

### 25.3 Stripe — qué cambia y qué NO (verificado en repo, honesto)

- **Webhook: NO cambia.** El endpoint es `POST /api/v1/webhooks/stripe` (raw body preservado en
  `backend/src/main.ts:35`; controller `backend/src/modules/payments/webhooks.controller.ts`) y lo
  sirve el **backend en Railway con su propio dominio** (`tcg-vault-mx-production.up.railway.app`,
  confirmado en runtime §23.2). En el repo/HANDOFF **no hay** ningún `api.tcgvaultmx.com` (el DNS del
  viejo solo tiene `www` + apex → Vercel, HANDOFF §3): el webhook **no** está detrás del dominio web
  y el rebrand no lo toca. **[HUMANO — verificación de 1 minuto]:** Stripe Dashboard → Developers →
  Webhooks → confirmar que el host del endpoint es `…up.railway.app`. Si (contra lo que dice el repo)
  fuera un dominio custom bajo `tcgvaultmx.com`, habría que crear endpoint nuevo + rotar
  `STRIPE_WEBHOOK_SECRET` en Railway — reportarlo antes del switch.
- **`return_url` del checkout: cambia solo.** El backend lo arma con el **primer origen** de
  `APP_BASE_URL`; al reordenar la lista el día del switch (§25.6-B) los retornos de Stripe caen en
  `www.tcghunt.mx` sin tocar Stripe.
- **Branding del dashboard (no verificable desde el repo):** nombre público del negocio, statement
  descriptor y URL en recibos pueden decir "TCG VAULT MX" → **[HUMANO]** revisarlos en Stripe →
  Settings → Business/Branding durante la ventana. No bloquea nada técnico.

### 25.4 DNS del dominio nuevo — registros a crear **[HUMANO]**

Recomendación: gestionar la zona de `tcghunt.mx` en **Cloudflare** como el dominio viejo
(consistencia + **Email Routing** para los buzones + registros de Resend en el mismo panel).
Todos los registros hacia Vercel en modo **DNS only (nube gris)** — igual que hoy (HANDOFF §3).

| Registro | Nombre | Valor | Para |
|---|---|---|---|
| A | `tcghunt.mx` (apex) | `76.76.21.21` *(usar el valor EXACTO que muestre Vercel al añadir el dominio)* | Vercel |
| CNAME | `www` | `cname.vercel-dns.com` *(ídem: copiar lo que indique Vercel)* | Vercel |
| TXT + CNAMEs | los que indique **Resend** al añadir `tcghunt.mx` | SPF/DKIM | remitente `no-reply@tcghunt.mx` |
| MX/TXT | los que configura **Cloudflare Email Routing** al activarlo | recepción | buzones `soporte@`, `contacto@`, `facturacion@tcghunt.mx` → reenvío al Gmail (como hoy, HANDOFF §3) |

**Certificados: automáticos.** Vercel emite y renueva TLS (Let's Encrypt) al validar el dominio;
no hay nada que comprar ni cargar. Única condición: el registro en Cloudflare debe quedar **DNS
only** (con proxy naranja la validación/renovación de Vercel se rompe — misma regla que ya se
aplica al dominio viejo). Railway no cambia de dominio → su TLS tampoco.

### 25.5 Variables por plataforma — nombres REALES y valores objetivo

**Railway → servicio `backend` → environment `production`** (HANDOFF §3 para los valores de hoy):

| Var (nombre real) | Hoy | Pre-switch (aditivo, seguro YA) | Día del switch |
|---|---|---|---|
| `APP_BASE_URL` | `https://tcg-vault-mx.vercel.app,https://www.tcgvaultmx.com,https://tcgvaultmx.com` | **añadir al FINAL** `,https://www.tcghunt.mx,https://tcghunt.mx` (CORS acepta el dominio nuevo; los links siguen saliendo con el viejo porque el 1º no cambió) | reordenar: `https://www.tcghunt.mx,https://tcghunt.mx,https://www.tcgvaultmx.com,https://tcgvaultmx.com,https://tcg-vault-mx.vercel.app` |
| `MAIL_FROM` | sin fijar (default de código `no-reply@tcgvaultmx.com`) | NO tocar | `TCG HUNT <no-reply@tcghunt.mx>` — **SOLO si Resend ya muestra `tcghunt.mx` Verified** |
| `DISPUTE_EVIDENCE_CONTACT` | `soporte@tcgvaultmx.com` | NO tocar | `soporte@tcghunt.mx` — **SOLO si el buzón nuevo ya recibe** (probar con un correo real) |

> Guardar variables en Railway redeploya el backend (aceptable: arranque idempotente, §11.F).
> No existe `FRONTEND_URL` ni `CORS_ORIGIN` en este backend: **la variable real es `APP_BASE_URL`**
> (lista separada por comas; allow-list CORS en `main.ts` + el 1º origen arma links de correos y
> `return_url` — verificado en `backend/src/main.ts` y `auth.service.ts`).

**Vercel → proyecto frontend:** `NEXT_PUBLIC_API_BASE_URL` **NO cambia** (apunta al dominio Railway
del backend, ajeno al rebrand); el resto de `NEXT_PUBLIC_*` tampoco referencia el dominio web. Si el
stream frontend de P-21 introduce una var de sitio (p. ej. para metadata/OG absolutas), recordar que
`NEXT_PUBLIC_*` **se hornea en build** → cargarla en Vercel exige **redeploy** (HANDOFF §3).

**GitHub Secrets:** `PROD_BASE_URL` → `https://www.tcghunt.mx` (día del switch; lo usa `deploy.yml`
si se reactiva el CD por Actions, §16.4). `STAGING_BASE_URL` sin cambio (staging no tiene dominio).

**Cloudflare R2 — CORS del bucket `tcg-kyc-ine`** (presigned PUT/GET del INE van del navegador a R2:
el origen del front DEBE estar allow-listeado, §11.B). JSON completo pre-switch (aditivo, pegar tal
cual; conserva los viejos mientras viva el redirect):

```json
[{ "AllowedOrigins": ["https://www.tcghunt.mx","https://tcghunt.mx",
                      "https://www.tcgvaultmx.com","https://tcgvaultmx.com"],
   "AllowedMethods": ["PUT","GET"],
   "AllowedHeaders": ["content-type"],
   "MaxAgeSeconds": 3600 }]
```

**Google OAuth (login con Google):** Google Cloud Console → el OAuth Client ID de
`GOOGLE_CLIENT_ID`/`NEXT_PUBLIC_GOOGLE_CLIENT_ID` → **Authorized JavaScript origins**: añadir
`https://www.tcghunt.mx` y `https://tcghunt.mx` (conservar los viejos). El Client ID no cambia.

### 25.6 Runbook de la ventana de cambio

**A) PRE-SWITCH — se puede hacer DESDE YA, nada visible cambia** *(todo aditivo)*:

1. **[HUMANO]** Crear la zona DNS de `tcghunt.mx` (Cloudflare recomendado) + registros §25.4.
2. **[HUMANO] Razón social del footer — ANTES de apuntar el dominio.** Hoy el footer sale con
   placeholder (`footer.legalEntity` = `[Razón social pendiente]` / `[Legal entity pending]` en
   `frontend/messages/{es,en}.json`). Entregar la razón social real al rol **frontend** (el archivo
   es suyo) y verificar que el cambio está mergeado y desplegado en prod **antes del paso 3**: al
   añadir el dominio en Vercel, la app queda visible en `tcghunt.mx` tal como esté — no debe
   estrenarse el dominio con un placeholder legal en el footer.
3. **[HUMANO]** Vercel → Domains: añadir `tcghunt.mx` y `www.tcghunt.mx`; marcar `www.tcghunt.mx`
   como **primary** (apex redirige a www, misma convención que hoy). Esperar cert **Valid**.
   *Efecto:* la app actual (marca vieja) ya responde también en el dominio nuevo — aceptable
   pre-lanzamiento; si molesta, este paso puede moverse al inicio de la ventana B.
4. **[HUMANO]** Railway: `APP_BASE_URL` con los dominios nuevos **al final** (§25.5) — sin esto, el
   frontend servido en `tcghunt.mx` fallaría por CORS al llamar al backend.
5. **[HUMANO]** R2: pegar el JSON de CORS de §25.5.
6. **[HUMANO]** Google OAuth: añadir los origins nuevos.
7. **[HUMANO]** Resend: añadir `tcghunt.mx` y verificar SPF/DKIM (NO cambiar `MAIL_FROM` aún).
8. **[HUMANO]** Cloudflare Email Routing en `tcghunt.mx`: `soporte@`, `contacto@`, `facturacion@`
   → reenvío al Gmail; mandar un correo de prueba REAL a cada uno y confirmar que llega (esta
   prueba es la precondición del paso B.2 —`DISPUTE_EVIDENCE_CONTACT`— y del paso B.3 —buzones
   en el frontend).
9. **[ORQUESTADOR/ROLES]** Mergear los streams de código del rebrand (frontend marca/metadata +
   backend correos) con sus gates (QA+techlead; seguridad por release) — prerequisito del switch.
   **EXCEPCIONES (se mergean/deployan EN la ventana B, no antes):** `frontend/vercel.json` (§25.7,
   activa el 301 al deployarse) y el cambio de buzones `@tcghunt.mx` en el i18n del frontend
   (`frontend/messages/{es,en}.json`: `contacto@`, `soporte@`, `facturacion@` — paso B.3), para
   que el frontend no muestre buzones nuevos mientras el backend siga respondiendo los viejos.

**B) VENTANA DEL SWITCH — en este orden** *(30–60 min, con el humano en los dashboards)*:

1. Smoke previo en `https://www.tcghunt.mx`: home con marca TCG HUNT, login (email y Google),
   una compra Stripe en test si hay staging — si algo falla, ABORTAR (nada se ha roto aún).
2. Railway: **reordenar** `APP_BASE_URL` (nuevo primero) + fijar `MAIL_FROM` y
   `DISPUTE_EVIDENCE_CONTACT` (solo con sus precondiciones de §25.5 cumplidas). Esperar redeploy
   *Active* y `GET /api/v1/health` = 200.
3. **Merge+deploy del frontend con los buzones `@tcghunt.mx` en i18n** (`frontend/messages/
   {es,en}.json`: `contacto@`, `soporte@`, `facturacion@` — rol frontend; carve-out de A.9).
   **Precondición:** los buzones nuevos ya reciben — Email Routing activo y probado con correo
   real (paso A.8). Se ejecuta **inmediatamente después del paso 2** para minimizar el desfase
   backend/frontend.
   **Ventana de desfase ACEPTADA (declarada):** entre el redeploy de Railway (paso 2) y que el
   deploy de Vercel de este paso quede *Ready* hay un lapso — objetivo ≤ 15 min, presupuesto
   máximo 60 min (la duración de la ventana B) — en el que el backend ya responde/envía
   `soporte@tcghunt.mx` mientras el frontend aún muestra `@tcgvaultmx.com`. Se acepta porque
   **ambos juegos de buzones reciben a la vez**: los nuevos quedaron probados en A.8 y los viejos
   siguen enrutando ≥ 12 meses (§25.2) — ningún correo de usuario se pierde, gane quien gane la
   carrera. Si el deploy de Vercel falla, aplicar el rollback C (restaurar `MAIL_FROM`/
   `DISPUTE_EVIDENCE_CONTACT` en Railway) para volver a un estado coherente en minutos.
4. Activar los **301**: mecanismo 1 (dashboard) **o** mergear/deployar `frontend/vercel.json`
   (§25.7) — uno solo.
5. GitHub Secret `PROD_BASE_URL=https://www.tcghunt.mx`.
6. **Verificación** (desde cualquier máquina con egress):
   ```bash
   curl -sI "https://www.tcgvaultmx.com/es/comprar?foo=1" | grep -i -e '^HTTP' -e '^location'
   # esperado: HTTP/2 301  +  location: https://www.tcghunt.mx/es/comprar?foo=1  (path+query intactos)
   curl -sI "https://tcgvaultmx.com/en/vender"            # → 301 a https://www.tcghunt.mx/en/vender
   curl -sI "https://tcghunt.mx/"                          # → redirect permanente a https://www.tcghunt.mx/
   curl -sI "https://www.tcghunt.mx/" | head -1            # → HTTP/2 200
   ```
   Y funcional: login Google en el dominio nuevo; subir una INE de prueba (CORS R2); compra test →
   `return_url` cae en `www.tcghunt.mx`; llega el correo de verificación **desde
   `no-reply@tcghunt.mx`** (y no va a spam: SPF/DKIM verdes en Resend). Coherencia de buzones
   (cierra el desfase del paso 3): el frontend ya muestra `@tcghunt.mx` (footer, aviso CFDI,
   términos) y el flujo de disputa devuelve `soporte@tcghunt.mx` — mismo buzón en ambos lados.
7. Post-switch (no bloquea): Search Console — alta de `tcghunt.mx` + herramienta **Cambio de
   dirección** desde la propiedad vieja; re-emitir sitemap (rol frontend si es archivo).

**C) ROLLBACK** *(cada paso es independiente y reversible)*:

- Vercel: quitar el "Redirect to" de los dominios viejos (o revert del commit de `vercel.json` +
  redeploy) → el dominio viejo vuelve a servir la app al instante.
- Railway: restaurar el orden viejo de `APP_BASE_URL`; borrar `MAIL_FROM` (cae al default de código)
  y devolver `DISPUTE_EVIDENCE_CONTACT=soporte@tcgvaultmx.com`.
- Buzones del frontend (paso B.3): revert del commit de i18n + redeploy en Vercel (rol frontend).
  Si el rollback es solo del lado backend/Railway, puede aceptarse dejar el frontend con
  `@tcghunt.mx` temporalmente: esos buzones ya reciben (A.8), aplica la misma lógica de la
  ventana de desfase declarada en B.3.
- GitHub Secret `PROD_BASE_URL` al valor anterior.
- DNS: **nada que revertir** (el dominio viejo nunca dejó de apuntar a Vercel; el nuevo puede
  quedarse configurado sin daño).
- Lo aditivo de pre-switch (CORS R2, OAuth origins, Resend, buzones) puede quedarse: no rompe nada.

### 25.7 Handoff EXACTO a FRONTEND — `frontend/vercel.json` (devops NO lo escribe)

Crear **`frontend/vercel.json`** (el Root Directory del proyecto Vercel es `frontend/`, §11.A) con
exactamente esto:

```json
{
  "redirects": [
    {
      "source": "/:path*",
      "has": [{ "type": "host", "value": "tcgvaultmx.com" }],
      "destination": "https://www.tcghunt.mx/:path*",
      "statusCode": 301
    },
    {
      "source": "/:path*",
      "has": [{ "type": "host", "value": "www.tcgvaultmx.com" }],
      "destination": "https://www.tcghunt.mx/:path*",
      "statusCode": 301
    }
  ]
}
```

Notas para frontend (importantes):
- **`statusCode: 301` y NO `permanent: true`** — `permanent: true` emite **308**, y P-21 pide 301.
- La **query string se preserva sola** (Vercel la reenvía si el destino no define la suya); el path
  lo preserva `/:path*` (matchea también la raíz `/`).
- El filtro `has: host` hace que las reglas **solo** apliquen al dominio viejo: mergear este archivo
  **activa el 301 en producción en cuanto se despliegue** → coordinar el merge con la ventana
  §25.6-B (no mergear antes), y NO usarlo a la vez que el redirect del dashboard (§25.2).
- `next.config.mjs` no se toca para esto (los redirects de Next no ven el `Host` de dominios
  Vercel-level tan limpio como `vercel.json`, y este archivo mantiene la config de plataforma junta).

### 25.8 Fuera de alcance devops (enrutado a sus roles — P-21)

- **backend:** default `DEFAULT_MAIL_FROM`, buzones hardcodeados (`disputes.constants.ts`,
  `buylist-mail.templates.ts`, `guest-checkout.constants.ts`), plantillas de correo con la marca.
- **frontend:** `frontend/vercel.json` (§25.7), i18n `messages/{es,en}.json`
  (`contacto@/soporte@/facturacion@`), marca/metadata/OG, `SUPPORT_CONTACT_FALLBACK`,
  `SEALED_BUYLIST_EMAIL`.
- **ux-ui:** ya entregado (DESIGN_SYSTEM §17).
- **humano:** todos los pasos `[HUMANO]` de §25.4–§25.6 (DNS, Vercel, Railway, R2, OAuth, Resend,
  Email Routing, Stripe branding, Search Console) — nadie más tiene acceso a esos dashboards
  (cf. §23.1: la sesión no tiene tokens ni egress a prod).

---

## 26. Promoción a prod del stream de composición de variantes (M-31 v1.29 + M-32 v1.30) — 2026-08-22

> **Rama:** `fix/variant-composition-regression` @ `31a893b` (ya en `origin`). **Autorización del dueño:**
> desplegar a PROD para validar **UN set (Pitch Black / ME05)** antes del re-sync completo. QA + techlead
> aprobados; los 3 MAYOR del techlead cerrados en `31a893b`.
>
> **VEREDICTO DE ESTA SESIÓN devops: NO SE DESPLEGÓ — PÁRATE controlado.** El pipeline está preparado y
> todas las precondiciones *verificables desde aquí* pasan, pero **el egress a prod está bloqueado por
> política** (proxy responde `403 CONNECT` a `tcg-vault-mx-production.up.railway.app` y `www.tcgvaultmx.com`,
> confirmado en `$HTTPS_PROXY/__agentproxy/status` → `recentRelayFailures`). Por tanto **no puedo (a)
> confirmar que la Postgres de prod es ≥15 en vivo ni (b) verificar salud post-deploy**. El runbook de
> CLAUDE.md/este stream exige parar sin desplegar si no se puede verificar salud → se entrega el push y la
> verificación al humano/orquestador, que sí tiene los dashboards. GitHub **sí** es alcanzable (el merge y el
> push son ejecutables; lo que no es verificable es el resultado del deploy).

### 26.1 Estado de ramas (verificado con git)

| Rama | Commit | Nota |
|---|---|---|
| `origin/main` | `3b9d16f` | Base actual de prod (Railway/Vercel auto-deploy desde `main`, ver §26.3). |
| `fix/variant-composition-regression` | `31a893b` | `origin/main` + 5 commits (M-31, M-32, fix 3-MAYOR, 2 docs de arquitectura). |
| `origin/production` | `b33db22` | Rama-registro de releases (merges `main → production`); su contenido ⊆ `fix`. |
| `main` **local** | `e52425e` | **STALE** — no usar. Está detrás de `origin/main`; se descarta a favor de `origin/main`. |

- **El merge `fix → main` es un FAST-FORWARD LIMPIO:** `origin/main` (`3b9d16f`) es **ancestro directo** de
  `fix` (`git rev-list origin/main..fix` = 5; `fix..origin/main` = 0). **No hay conflictos, no se descarta
  trabajo ajeno.** Los 5 commits que aporta `fix` son exactamente: `9dfa2cb`+`505e6ac` (docs de contrato
  v1.29/v1.30), `421967f` (M-31), `774293e` (M-32), `31a893b` (cierre 3 MAYOR). Todo el trabajo de otros
  streams (§4.25e, Stream C, rebrand P-21) **ya está** dentro de `fix` porque `fix` se ramificó de la punta
  de `origin/main`.
- **NO se ejecutó el merge ni el push desde esta sesión** (push = deploy no verificable). Local `main` se
  dejó intacto.

### 26.2 Precondiciones de seguridad del cambio — verificadas

- **Migraciones aditivas + backfill (verificado leyendo el SQL):**
  - **M-31** `20260822120000_m31_card_products_rarity_canonical` — `CREATE TYPE`, `CREATE TABLE CardProduct`,
    columnas nullable nuevas (`Card.rarityCanonical`, `PriceReference.cardProductId`), enum value nuevo, y
    **BACKFILL** (`UPDATE Card SET rarityCanonical=rarity`; `INSERT CardProduct` desde `tcgplayerId` +
    `structuralFinishes`/`availableFinishes`). **No dropea columnas de datos** (las viejas quedan muertas,
    conservadas para reversibilidad). Efecto: al aplicarse, cada carta **conserva su composición actual**;
    el fantasma solo se corrige en el set que se re-sincronice.
  - **M-32** `20260822130000_m32_sell_item_card_product_id` — aditiva (`SellRequestItem.cardProductId`,
    `PendingPriceEntry.cardProductId`).
- **⚠️ REQUISITO DURO Postgres ≥ 15:** M-31 crea el índice único `PriceReference_variant_capturedDate_key`
  con **`NULLS NOT DISTINCT`** (feature de **PG15+**). Docs de infra dicen Railway Postgres **16** (§1,
  HANDOFF §3) → cumpliría, **pero no pude consultarlo en vivo** (egress bloqueado). **El humano DEBE
  confirmar PG≥15 antes del push.** Si fuese <15, `migrate deploy` falla en M-31 (ver §26.4, falla
  atómica y segura).
- **Orden migración-antes-de-servir: GARANTIZADO por el `CMD` del `Dockerfile.backend`:**
  `CMD ["sh","-c","node node_modules/prisma/build/index.js migrate deploy && node dist/main.js"]`.
  Prisma corre **`migrate deploy` a completitud ANTES** de que Nest escuche. El código nuevo (que lee
  `CardProduct`/`rarityCanonical`) **nunca** sirve antes de que M-31/M-32 existan. No hace falta paso manual.
  `healthcheckTimeout: 300` en `railway.json` da holgura para el `migrate deploy` del arranque.

### 26.3 Flujo REAL de promoción a prod (confírmalo antes de pushear)

- **Mecanismo vigente según docs (HANDOFF §3, §23.2):** **Railway (backend) y Vercel (frontend)
  auto-despliegan desde `main`** vía sus integraciones de Git nativas. `Dockerfile.backend` corre
  `prisma migrate deploy` en el arranque. **El CD de GitHub Actions (`deploy.yml`) NO corre solo** (§16.4,
  solo `workflow_dispatch`) y es redundante.
- **⚠️ DISCREPANCIA a resolver por el humano:** existe la rama `origin/production` con commits
  `release: … main → production`. La premisa de esta tarea era "PR `main`→`production` dispara el deploy",
  pero las notas del repo dicen que **el disparador es `main`**. **Antes de pushear, el humano DEBE
  confirmar en los dashboards de Railway y Vercel cuál es la *Production/Deploy Branch* que observan hoy**
  (Railway: servicio `backend` → Settings → Source/Branch; Vercel: Project → Settings → Git → Production
  Branch). Pushear a la rama equivocada o a las dos a la vez causa deploy nulo o **deploy duplicado**.
- **Pasos del deploy (a ejecutar por el humano/orquestador con visibilidad de prod):**
  1. `git fetch origin && git checkout main && git reset --hard origin/main` (parte de la punta remota, no
     del `main` local stale).
  2. `git merge --ff-only origin/fix/variant-composition-regression` → debe ser fast-forward (si no lo es,
     PARAR: alguien movió `main`; re-evaluar).
  3. **Snapshot/PITR de la Postgres de prod ANTES de pushear** (regla de oro §7: datos primero).
  4. `git push origin main` **(esto dispara el deploy)** — o merge a `production` si ése resultó ser el
     branch observado (§26.3, discrepancia).
  5. Verificar salud (§26.5) **antes** de disparar el sync por-set.

### 26.4 Rollback (la migración es aditiva → rollback = redeploy del commit anterior)

| Escenario | Acción |
|---|---|
| **App nueva rota / regresión** | Railway (servicio `backend` → Deployments → **Redeploy** el deploy de `3b9d16f`) y Vercel (Deployments → **Promote to Production** el build previo). Alternativa Git: `git revert` del merge y push. |
| **Datos** | **No se requiere restaurar DB para revertir el código.** M-31/M-32 son **aditivas**: sus columnas/tablas (`CardProduct`, `rarityCanonical`, `*.cardProductId`) quedan y son inertes para el resolver viejo (las columnas legacy `structuralFinishes`/`catalogFinishes`/`pricedFinishesSnapshot` se conservaron a propósito para reversibilidad — ver cabecera de la M-31). Solo se restaura del snapshot (§26.3 paso 3) si hubiera corrupción de datos, no por un rollback de código. |
| **PG < 15 (falla de migración)** | `migrate deploy` falla en M-31 **dentro de su transacción** (Prisma envuelve cada migración) → **rollback atómico de M-31**, el contenedor sale ≠0, Railway reintenta (`ON_FAILURE`, max 10) y **mantiene activo el deploy anterior** (`3b9d16f`). Prod sigue sirviendo el código viejo. Corregir: subir Postgres a ≥15 o aplicar el fallback de índice normal (BACKEND_NOTES M-31, es cambio de **rol backend**). |

### 26.5 Verificación de salud post-deploy (a ejecutar por quien tenga egress a prod)

1. `GET https://tcg-vault-mx-production.up.railway.app/api/v1/health` → `200`, componente Redis `up`.
2. Railway → `backend` → Deployments: último **Success** en el commit `31a893b` (o el sha que reporte).
3. **Migración aplicada** (en la consola de Postgres de Railway):
   - `SELECT COUNT(*) FROM "CardProduct";` → > 0 (backfill corrió).
   - `SELECT 1 FROM information_schema.columns WHERE table_name='Card' AND column_name='rarityCanonical';` → 1 fila.
   - `SELECT indexname FROM pg_indexes WHERE indexname='PriceReference_variant_capturedDate_key';` → 1 fila.
   - `SELECT migration_name FROM "_prisma_migrations" WHERE migration_name IN ('20260822120000_m31_card_products_rarity_canonical','20260822130000_m32_sell_item_card_product_id') AND finished_at IS NOT NULL;` → 2 filas.
4. Frontend sirve: `GET https://www.tcgvaultmx.com` → `200`.

### 26.6 REQUEST EXACTO del sync forzado de UN set (Pitch Black / ME05) — NO correr `sync-all`

> **NO usar `POST /admin/catalog/sync-all {force:true}`** (ése re-sincroniza TODO el catálogo). Para un solo
> set se usa `POST /admin/catalog/sync` con `{ setId, force:true }` (verificado en
> `backend/src/modules/catalog/admin-catalog.controller.ts:70` → `catalog-sync.service.ts:109` `sync()`).

- **Método / URL:** `POST https://tcg-vault-mx-production.up.railway.app/api/v1/admin/catalog/sync`
- **Auth:** JWT de **`super_admin`** en `Authorization: Bearer <accessToken>`. Obtenerlo con
  `POST /api/v1/auth/login` `{ "email": "<SEED_ADMIN_EMAIL>", "password": "<SEED_ADMIN_PASSWORD>" }` →
  campo `accessToken` de la respuesta.
- **Headers:** `Content-Type: application/json` + el `Authorization` de arriba.
- **Body:** `{ "setId": "<externalId-pokemontcg.io-de-Pitch-Black>", "force": true }` → responde **202**;
  progreso en `GET /api/v1/admin/catalog/sync-status`.

**⚠️ El `setId` que espera el endpoint NO es `24688`.** El código valida `setId` con
`SET_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/` y lo interpola en `q=set.id:<setId>` contra **pokemontcg.io**
(`catalog-sync.service.ts`). Es el **`externalId` de pokemontcg.io** del set (string en minúsculas), NO el
uuid interno ni el numérico de TCGplayer. **`24688` es el `pptSetId`** (`CardSet.pptSetId`), que el resolver
TCGCSV usa **internamente** como `groupId` (`card-product-resolver.service.ts:199-202`: si `pptSetId` es
entero, `groupId = pptSetId`). Es decir: das el `externalId` al endpoint, y el resolver por dentro usa
`24688` para leer la composición exacta desde TCGCSV.

**Cómo obtener el `externalId` real de Pitch Black / ME05** (elige una; requiere prod):
- **Vía BD (más directa):** en la Postgres de Railway →
  `SELECT "externalId","name","ptcgoCode","pptSetId" FROM "CardSet" WHERE "pptSetId"='24688' OR "ptcgoCode"='ME05' OR "name" ILIKE '%pitch black%';`
  → usa el valor de la columna `externalId` como `setId`.
- **Vía API:** `GET /api/v1/admin/catalog/remote-sets` (super_admin) lista los sets remotos de pokemontcg.io
  (`id` + `name`); localiza el de Pitch Black y usa su `id`.

> **Precondición del sync por-set:** este endpoint primero trae las cartas del set desde **pokemontcg.io**
> por `externalId`; si Pitch Black/ME05 aún **no existe en pokemontcg.io**, el `sync` por `externalId` no
> importará cartas y el resolver TCGCSV no correrá por esta vía (hallazgo a validar con backend/PO). En ese
> caso el set debe existir en la BD con su `pptSetId=24688` y el re-populado de composición se dispara por el
> resolver — coordinar con **backend** antes de asumir que este request basta. El re-sync es **idempotente y
> money-safe** (§24.3): repuebla composición/precios de SINGLES, no borra `PriceReference` ni dinero.

### 26.7 Resumen del handoff (qué falta y de quién es)

- **[HUMANO/orquestador con dashboards]** Confirmar branch observado (§26.3), confirmar **PG≥15**, snapshot
  de DB, `git push` del FF `fix→main` (o a `production`), verificar salud (§26.5), y disparar el request
  por-set (§26.6). Todo esto es lo único pendiente; el pipeline y el orden de migración ya están listos y
  son seguros.
- **[backend]** Solo si (a) PG<15 en prod (fallback de índice de la M-31) o (b) el set ME05 no está en
  pokemontcg.io y el sync por `externalId` no dispara el resolver: es decisión/código de backend, no de devops.

---

## 27. Runbook de release — SECUENCIA POST-DEPLOY money-crítica (M-39/M-40 + reshape P-34) — 2026-08-23

> ### ⛔ AVISO 2026-08-24 — el **PASO 3 de esta sección ya NO EXISTE**. Ver **§29**.
> El **backfill P-34 (reshape de tiers)** se **retiró del pipeline**: la etapa **E8 de P-48/v2.0** borró
> `backend/prisma/backfill-p34-tiered-pricing.ts` junto con toda la superficie de tiers, y
> `scripts/post-deploy.sh` ya **no** lo invoca (su llamada rompía el post-deploy entero por
> `set -euo pipefail`). **No se reemplazó por otro script**: las cinco claves que migraba
> (`sales_price_rules`, `sales_price_fallback_pct`, `buylist_price_rules`,
> `buylist_price_fallback_pct`, `pricing_tier_map`) **ya no las lee nadie**; sus filas quedan
> huérfanas e **inertes** en `ConfigSetting` a propósito (§4.36.9b: rollback barato + diagnóstico).
> **Esta sección se conserva como REGISTRO HISTÓRICO** del release 2026-08-23 (M-39/M-40 siguen
> vigentes y ya están en `origin/main`/`origin/production`). **El runbook operativo vigente es §29.**
>
> **Rama:** `fix/variant-composition-regression` @ `9b6a81b`. **Origen:** el techlead marcó **D-4** — el
> script money-crítico de **reshape de tiers (P-34 T2=25%)** **no estaba en el runbook de deploy** y la
> **regla 10** de `CLAUDE.md` exige cerrarlo ANTES de prod. Esta sección cablea la **secuencia exacta
> post-deploy** para que nadie la olvide, y su rollback.
>
> **Por qué NO basta `migrate deploy`:** este release trae **cambios de DATOS** que las migraciones NO
> cubren solas. Son **scripts idempotentes post-migración** (reshape de reglas de precio + cura del
> sellado). Sin el paso 3, la decisión money **T2 Rare/Holo = 25%** de P-34 queda **silenciosamente inerte
> en prod** (el compat on-read cae al fallback 40%). Orden y money-safety: ver abajo.
>
> **Orquestador:** `scripts/post-deploy.sh` (idempotente) ejecuta los pasos automatizables EN ORDEN y
> **PARA** si el paso 3 imprime «ACCIÓN REQUERIDA». Es la forma recomendada de correr esto.

### 27.1 Cuándo corre y con qué se ejecuta

- **Cuándo:** **DESPUÉS** de que el contenedor de backend arrancó y aplicó `prisma migrate deploy` (el
  `CMD` del `Dockerfile.backend` lo garantiza antes de servir — §26.2), y **ANTES** de anunciar que P-34
  está vigente / abrir el release. Salud primero (§27.5), luego la secuencia.
- **Con qué:** patrón §11.F — el env de Railway se inyecta y la DB de prod se alcanza por red. Desde la
  **raíz del repo** (con `cd backend && npm ci` hecho: se necesita `ts-node` + `@prisma/client` locales):
  ```bash
  railway run --service backend --environment production bash scripts/post-deploy.sh
  ```
  O directamente contra una DB objetivo: `DATABASE_URL='postgres://…' bash scripts/post-deploy.sh`.
- **Idempotente:** seguro correrlo varias veces. Money-safe: los scripts **nunca** escriben $0 ni regla
  vacía; ante divergencia **no tocan dinero** y escalan.

### 27.2 La secuencia EXACTA (comando · idempotencia · si falla)

| # | Paso | Comando exacto | Idempotencia | Si falla / qué hacer |
|---|---|---|---|---|
| 1 | **Migraciones** M-39 (`SealedProduct`) + M-40 (`PendingPriceEntry.sealedProductId`, FK nullable `onDelete SET NULL`). Ambas **aditivas**. | `npx prisma migrate deploy` (ya corre al arrancar el contenedor; el orquestador la re-verifica salvo `SKIP_MIGRATE=1`) | No-op si ya aplicaron (`_prisma_migrations`). | Falla atómica dentro de su tx → Railway mantiene el deploy anterior. Rollback = redeploy del commit previo (§27.4). |
| 2 | **Backfill M-39** — cura el **ETB→Tropius** (deriva `SealedProduct` de items ya mapeados y liga `sealedProductId`). | `npx ts-node prisma/backfill-m39-sealed-product.ts` | `upsert` + solo liga items sin FK ⇒ 2ª corrida no duplica. | Reimprime reconciliación de sellados **SIN MAPEO** (quedan `null`, no bloquea). Si el script sale ≠0, revisar log y re-correr; no es destructivo. |
| ~~3~~ | ⛔ **RETIRADO 2026-08-24 (P-48/E8) — el script YA NO EXISTE, no lo busques ni lo re-crees (§29.2).** ~~Backfill P-34 — RESHAPE de tiers (T2=25%). MONEY-CRÍTICO.~~ Migra las reglas legacy plano/dos-ejes al shape tiered canónico. | `npx ts-node prisma/backfill-p34-tiered-pricing.ts` | Ve `tierRules` ⇒ NO-OP. Nunca escribe $0. | **Si imprime «⚠ ACCIÓN REQUERIDA»** (una tabla de M2 fue editada a mano y DIVERGE del default): **NO la toca (money-safe)** → **PARAR y escalar al humano/arquitecto** para definir el mapeo rareza→tier a mano. **El release NO se anuncia** hasta cerrarlo. `post-deploy.sh` **para solo** ante ese texto. |
| 4 | **unify-rarities** — pendiente **cosmético** de P-34 (re-deriva `Card.rarityCanonical`). Es endpoint HTTP, no script de DB. | `curl -X POST "$ADMIN_BASE_URL/admin/catalog/unify-rarities" -H "Authorization: Bearer <super_admin_JWT>" -H "Content-Type: application/json"` | Idempotente (2ª corrida = 0 updates). | Cosmético: **NO bloquea**. Reintentar a mano cuando se tenga JWT. El orquestador lo dispara solo si se le pasan `ADMIN_BASE_URL` + `ADMIN_JWT`. |
| 5 | **Nota de saneo legacy (deuda D-3)** — filas pendientes de sellado duplicadas/huérfanas (`gradeKey='sealed'` sin `sealedProductId`) de altas previas al fix. | *(barrido puntual, registrado en `TECH_DEBT`/`BACKEND_NOTES`)* | — | **Deuda de rol BACKEND, NO devops. NO bloquea el deploy.** Solo se observa en la cola de precio pendiente de M2 y se enruta a backend. |
| 6 | **Sincronizar sellado por set** — «Sincronizar» trae presentaciones de sellado desde **tcgcsv.com** (egress real; en local/CI daba **403**). | Back-office M2 «Sincronizar» por set, o el endpoint por-set con super_admin (ver §26.6). | Idempotente / money-safe (repuebla presentaciones y precio; no borra `PriceReference`). | Requiere egress a tcgcsv.com. Si da 403/timeout, es red/egress: reintentar desde un entorno con salida a Internet; no altera dinero existente. |

**Regla de oro de esta secuencia:** el paso 3 es la razón de ser de D-4. Correrlo tras `migrate deploy` y
**ANTES del anuncio**; si escala a «ACCIÓN REQUERIDA», el release espera. Los pasos 4–6 no bloquean el
deploy técnico pero sí completan el release (4 y 6 son manuales/egress; 5 es deuda de backend).

### 27.3 Precondiciones de seguridad del cambio (verificadas leyendo el SQL)

- **M-39** `20260823120000_m39_sealed_product`: **ADITIVA y reversible** — dos tablas nuevas
  (`SealedProduct`, `SealedSetGroup`), enum nuevo `SealedGroupKind`, dos valores apendados a `SealedSubtype`
  (`ADD VALUE IF NOT EXISTS`), y una columna FK **nullable** (`InventoryItem.sealedProductId`). **Sin `DROP`,
  sin backfill destructivo.** El backfill de datos vive APARTE (paso 2) porque `ALTER TYPE ADD VALUE` no se
  puede USAR en su propia tx y la derivación necesita la heurística `inferSealedSubtype`.
- **M-40** `20260823130000_m40_pending_sealed_product`: **ADITIVA** — `PendingPriceEntry.sealedProductId`
  (FK **nullable**, índice, FK **`onDelete: SET NULL`**). Sin `DROP`, sin backfill obligatorio. Un pendiente
  de sellado sin `sealedProductId` queda `null` y **sigue el comportamiento previo: SIEMPRE pendiente, JAMÁS
  $0** (money-safe).
- **Orden migración-antes-de-servir:** garantizado por el `CMD` de `Dockerfile.backend`
  (`… migrate deploy && node dist/main.js`). El código nuevo nunca sirve antes de que M-39/M-40 existan.
- **Money-safety del reshape P-34:** el script sólo reemplaza tablas que coinciden **byte-a-byte** con los
  defaults «pristine» sembrados en su día (nunca editadas a mano). Si una diverge, **no la toca** y escala.

### 27.4 Rollback (migraciones aditivas ⇒ rollback = redeploy del commit anterior)

| Escenario | Acción |
|---|---|
| **App nueva rota / regresión** | Railway (`backend` → Deployments → **Redeploy** el deploy previo bueno) y Vercel (Deployments → **Promote to Production** el build previo). Alternativa Git: `git revert` del merge + push. |
| **Datos (código)** | **No se restaura la DB para revertir el código.** M-39/M-40 son **aditivas**: sus tablas/columnas (`SealedProduct`, `SealedSetGroup`, `*.sealedProductId`) quedan **inertes** para el código viejo. Solo se restaura del snapshot si hubiera **corrupción de datos**, no por un rollback de código. |
| **Reshape P-34 aplicado y se quiere revertir el dinero** | Los backfills son **idempotentes y NO destructivos**, pero el paso 3 **reescribe** `buylist_price_rules` / `sale_price_rules` al shape tiered. Para volver al valor exacto previo: **restaurar esas dos filas de `ConfigSetting` desde el snapshot pre-deploy** (por eso el snapshot del paso 3 de §27.5). El compat on-read lee ambos shapes, así que el código viejo tolera el shape tiered si sólo se revierte código. |
| **Backfill M-39 a revertir** | No destructivo (solo crea `SealedProduct` y liga FKs nullable). Revertir código deja esas filas inertes; no requiere acción de datos. |
| **Migración falla al aplicar** | Prisma envuelve cada migración en su tx → **rollback atómico**; el contenedor sale ≠0, Railway reintiene y **mantiene activo el deploy anterior**. Prod sigue sirviendo el código viejo. |

> Orden de oro (§7): **datos primero** (snapshot antes de migrar y antes del paso 3), luego código.

### 27.5 Orden operativo end-to-end (lo que ejecuta el humano/orquestador con egress a prod)

1. **Snapshot / PITR** de la Postgres de prod (Railway → Postgres → Backups → *Create backup*). **Cubre las
   dos filas de `ConfigSetting` que toca el paso 3** (única vía de rollback fino del dinero — §27.4).
2. Deploy del backend (Railway auto-deploy desde `main`, o §26.3): al arrancar corre `migrate deploy`
   (M-39 + M-40).
3. **Verificar salud** (§27.6) antes de tocar datos.
4. Correr la secuencia post-deploy:
   `railway run --service backend --environment production bash scripts/post-deploy.sh`
   — **si para en «ACCIÓN REQUERIDA» (paso 3): escalar al humano/arquitecto y NO anunciar** el release.
5. Paso 6 (sync de sellado por set) desde un entorno con egress a tcgcsv.com.
6. Anunciar el release / crear el tag sólo cuando 1–5 estén verdes.

### 27.6 Verificación post-deploy (a ejecutar por quien tenga egress a prod)

1. `GET /api/v1/health` → `200` (componente Redis `up`). En Railway el servicio queda *Active/healthy*.
2. **Migraciones aplicadas** (consola de Postgres de Railway):
   ```sql
   SELECT migration_name FROM "_prisma_migrations"
   WHERE migration_name IN ('20260823120000_m39_sealed_product','20260823130000_m40_pending_sealed_product')
     AND finished_at IS NOT NULL;               -- → 2 filas
   SELECT 1 FROM information_schema.columns
   WHERE table_name='PendingPriceEntry' AND column_name='sealedProductId';  -- → 1 fila
   SELECT COUNT(*) FROM "SealedProduct";        -- → ≥ 0 (backfill M-39 corrió; >0 si había sellado mapeado)
   ```
3. **Reshape P-34 aplicado** (money-check): en M2, la regla efectiva de COMPRA para **Rare / Rare Holo**
   debe ser **25% (pct)**, no el fallback 40%. El propio reporte del paso 3 imprime el ANTES→DESPUÉS por
   rareza; confirmar que aparece `Rare: 40% → 25%  ← CAMBIA` (o que ya estaba en 25% = idempotente).
   Verificación por DB:
   ```sql
   SELECT key, "valueJson" FROM "ConfigSetting"
   WHERE key IN ('buylist_price_rules','sale_price_rules','pricing_tier_map');  -- shape tiered (tierRules)
   ```
4. Frontend sirve: `GET https://<dominio-front>` → `200`.

### 27.7 Cableado en CI/orquestador — qué se añadió (cierre de D-4)

- **`scripts/post-deploy.sh`** (nuevo, propiedad devops): orquestador **idempotente** que corre los pasos 1–3
  en orden, **captura la salida del paso 3 y PARA con exit ≠0 si aparece «ACCIÓN REQUERIDA»** (money-safe),
  dispara el paso 4 (unify-rarities) por HTTP si se le pasan `ADMIN_BASE_URL`/`ADMIN_JWT` (si no, imprime la
  instrucción manual), e imprime las notas de los pasos 5 y 6. `set -euo pipefail`; ofusca el password del
  DSN al loguear.
- **`docs/DEVOPS_NOTES.md` §27** (este bloque): secuencia exacta, cuándo, idempotencia, qué hacer si falla y
  **rollback documentado** (DoD).
- **No se toca `deploy.yml`:** los backfills de DATOS **no** se cablean como job automático de CD porque el
  paso 3 puede requerir **decisión humana** (dinero) y se corre **contra la DB de prod** tras verificar salud.
  Automatizarlo a ciegas violaría la money-safety y la regla 10. El orquestador humano lo dispara con
  `railway run` (patrón §11.F) siguiendo §27.5.

> **Límites (devops):** esta sección y `scripts/post-deploy.sh` NO modifican `backend/`, `frontend/` ni el
> contrato. El paso 5 (saneo legacy D-3) es de **rol backend**; si el paso 3 escala a «ACCIÓN REQUERIDA», el
> mapeo rareza→tier a mano lo decide **humano/arquitecto**, no devops.

---

## 29. Cut-over de **v2.0 — precio puro por valor de mercado** (P-48, M-41) — 2026-08-24

> **Rama:** `claude/card-pricing-rules-2e537m` (etapas **E0–E9**, de `586f736` a `HEAD`).
> **Fuente normativa:** `ARCHITECTURE.md` **§4.36** (spec) y **§4.36.9** (migración + cut-over).
>
> ### ✅ ESTADO: **TRES VEREDICTOS APROBADOS. Runbook LISTO. Deploy NO EJECUTADO.**
> | Gate | Estado |
> |---|---|
> | **QA** | ✅ aprobado — con una **brecha declarada** (los 80/80 de Playwright corrieron contra **mocks**). Se cierra por §29.10 **antes** del deploy. |
> | **techlead** | ✅ aprobado **con deuda** (no bloqueante, registrada en `docs/TECH_DEBT.md`). |
> | **seguridad** | ✅ **APROBADO — 0 críticos, 0 altos** (`docs/SECURITY_NOTES.md`, pase P-48; los medios/bajos S48-M1/M2 y P48-B1 se cerraron después en `6322ee3`, `a2d238e`, `1771a47`). |
>
> **Por qué sigue sin desplegarse, y no es un olvido:** faltan **dos insumos que solo aporta el dueño** —
> el **snapshot/PITR de la Postgres de producción** (paso 0, la red de seguridad del release) y la
> **ventana** en que se ejecuta. Devops no tiene egress a prod ni acceso a los dashboards; ese límite es
> el mismo de §26/§28 y no se disimula aquí. Lo que sí está listo es todo lo demás: pipeline sano,
> secuencia, verificación, rollback y el orden entre releases.
>
> **Numeración:** esta sección es **§29 y no §28** a propósito: `origin/main` ya tiene un
> **§28** (runbook de activación del dial `tcgcsv_singles`, P-47). Numerarla §29 evita el choque
> de encabezados cuando este stream mergee a `main`.
>
> **Cambios de esta revisión (2026-08-24, tras las tres decisiones del dueño):** §29.3 pasa de
> *recomendación* a **orden normativo** (P-47 primero, P-48 después, con criterio de corte explícito);
> §29.4 se parte en **29.4a deploy / 29.4b cut-over POR SETS / 29.4c lectura entre set y set**; y se añade
> **§29.10** (ruta NATIVA sin Docker para cerrar la brecha de E2E) y **§29.11** (verificación del DoD).

### 29.1 Resumen para el operador: qué cambia en INFRA (y qué NO)

| Dimensión | v2.0 (P-48) |
|---|---|
| **Variables de entorno** | **NINGUNA nueva.** La curva es **DATO** (setting `pricing_curve` en `ConfigSetting`), no configuración de entorno: se edita en M2 sin redeploy. Si algún día un cambio de pricing pide un env nuevo, es señal de diseño equivocado → **reportar al arquitecto, no agregarlo**. |
| **Migración** | **M-41** `20260824120000_m41_pricing_curve_instrumentation` — **ADITIVA PURA**: 3 enums + 8 columnas **nullable** + 1 índice. **Sin `DROP`, sin backfill, sin migración de dinero.** Segura con la app corriendo. |
| **Migración de dinero** | **NO EXISTE.** El precio de venta **no está persistido**: se resuelve **en lectura** (§4.26b). No hay filas de precio que reescribir. |
| **«Repriciar el catálogo»** | Es **RE-RESOLVER**, no un `UPDATE` masivo → `POST /admin/inventory/publish-all` (§29.4b), **por sets**. |
| **Settings viejos** | Las **cinco** claves retiradas quedan **huérfanas e INERTES**, **sin `DELETE`**: `sales_price_rules`, `sales_price_fallback_pct`, `buylist_price_rules`, `buylist_price_fallback_pct`, `pricing_tier_map`. **NO LAS BORRES** (§29.8). |
| **Seed** | **No se necesita** para el cut-over. Si la fila `pricing_curve` no existe, `SettingsService.get()` devuelve el **default de §N.2** (`SETTING_DEFAULTS`) — exactamente lo que el seed escribiría. La fila se materializa sola con el primer `PUT /admin/pricing/curve`. Correr `prisma/seed.ts` completo contra prod **no** es parte de este runbook (siembra usuarios/cartas demo). |
| **Sellado** | **Fuera de la curva** (§4.36.10): conserva íntegro su spread por presentación y su dial `sealed_spread_fallback_pct`. Verificable: **el precio de un sellado antes y después es idéntico**. |
| **Docker / compose / CI** | **Sin cambios.** Mismo `Dockerfile.backend` (su `CMD` corre `migrate deploy` antes de servir), mismos workflows, mismos gates SAST/DAST/E2E. |

### 29.2 Bloqueo resuelto — `post-deploy.sh` invocaba un script **borrado**

**Síntoma:** `scripts/post-deploy.sh` línea 87 hacía
`npx ts-node prisma/backfill-p34-tiered-pricing.ts`, y ese archivo **ya no existe**: la etapa **E8** lo
borró como parte del retiro sin residuos de la superficie de tiers. Con `set -euo pipefail`, el
post-deploy **entero** abortaba ahí → **release imposible de completar**.

**Arreglo (no sustitución):** el paso se **retiró del pipeline**. No hay nada que poner en su lugar:

- Ese backfill era el de **P-34/M-38** (reshape rareza→tier) y **ya cumplió su función**.
- Migraba justo las claves que v2.0 **dejó de leer**. Aunque no hubiera corrido, hoy sería un **no-op de
  comportamiento**: ningún camino de código lee esas cinco claves (verificado por grep en `backend/src/`
  y `backend/prisma/`; solo quedan comentarios de retiro explícitos).
- Con él se fue su **parada controlada** por «ACCIÓN REQUERIDA» (la ambigüedad rareza→tier de una tabla
  editada a mano). Ya no aplica: **no hay tablas de reglas** que colapsar — hay **una curva**.

**Además, en el mismo pase:**

- `post-deploy.sh` se renumeró (1 migraciones · 2 backfill M-39 · 3 unify-rarities · 4 **cut-over
  publish-all** · 5 **diagnóstico de la cola** · 6 nota D-3 · 7 sync de sellado) y su cabecera describe
  el estado real del release.
- **Verificado `bash -n scripts/post-deploy.sh` → OK** (y de nuevo tras los cambios de §29.4b).
- **Barrido de referencias muertas** en territorio devops (`scripts/`, `.github/workflows/`, `security/`,
  `docker-compose*.yml`, `Dockerfile.*`, `railway.json`, `.env.example`): **sin residuos** de
  `backfill-p34`, `tiered-pricing`, `pricing/tiers`, `tier-map`, `buylist-rules`, `sales-rules`,
  `sales-rarities` ni de las cinco claves retiradas. La **única** referencia viva estaba en la línea 87.
- **Fuera de mi territorio** (queda para su rol): `PENDIENTES.md` (líneas ~53-55) todavía lista
  `ts-node prisma/backfill-p34-tiered-pricing.ts` como paso 3 del «Al publicar». Es del **orquestador**;
  `docs/BACKEND_NOTES.md` §del backfill P-34 es de **backend**. Ninguna de las dos rompe el deploy
  (son documentación), pero conviene alinearlas para no reintroducir el paso muerto.

---

### 29.3 ORDEN ENTRE RELEASES — **P-47 PRIMERO, P-48 DESPUÉS** (decisión del dueño, NORMATIVA)

> **Esto ya no es una recomendación de devops: es el orden acordado.** Devops lo propuso, el dueño lo
> aceptó. Ejecutar los dos en la misma ventana **queda descartado**.

#### 29.3-1 Por qué, en una línea que conviene no olvidar

**P-47 cambia la FUENTE del precio de mercado** (flip del dial `price_provider` → `tcgcsv_singles`,
precio por-acabado diario desde TCGCSV, §28). **P-48 cambia la MATEMÁTICA que se aplica a esa fuente**
(la curva: `venta = redondeo↑(max(piso, mercado × markup(mercado)))`).

Y el detalle que obliga al orden, no solo lo aconseja: **P-48 pone el 100 % del peso sobre el dato de
mercado.** Con la curva no hay reglas por rareza ni por acabado que amortigüen un dato malo — si el
mercado dice una cifra, esa cifra decide el precio, y si no dice nada la pieza se retiene. Por eso **el
dato tiene que ser confiable ANTES de que la curva empiece a decidir precios**.

Si se encienden juntos y un precio se mueve raro, **no hay forma de separar si fue la fuente o la
matemática**: las dos variables cambiaron a la vez y no queda una lectura limpia contra la cual comparar.
Serializados, cada movimiento tiene un solo sospechoso.

#### 29.3-2 Secuencia

| Fase | Qué se hace | Runbook |
|---|---|---|
| **1** | **P-47**: merge/deploy + flip del dial a `tcgcsv_singles` + primer barrido | **§28** (ya en `origin/main`) |
| **2** | **VERIFICACIÓN de P-47** contra cartas conocidas — abajo | §29.3-3 |
| **3** | **CORTE**: ¿P-47 está estable? — criterio explícito abajo | §29.3-4 |
| **4** | **P-48**: merge/deploy de esta rama + cut-over **por sets** | §29.4a/§29.4b |

**Entre la fase 1 y la 4 tiene que haber al menos un ciclo COMPLETO del `price-ingest`.** El job corre
**2×/día (00:00 y 12:00 UTC)**; un barrido forzado (`POST /admin/jobs/price-ingest`) sirve para adelantar
sets concretos, pero el criterio de corte se toma sobre una corrida **programada** que haya pasado por el
catálogo en scope, no sobre un `--force` puntual. Un `--force` prueba que la ruta funciona; no prueba que
el barrido diario cubre el catálogo.

#### 29.3-3 Qué se verifica ENTRE uno y otro (contra cartas conocidas)

La verificación de §28.4e sigue siendo la base. Lo que se añade aquí es **el ancla contra cartas que el
dueño conoce de memoria**, que es lo único que detecta un dato *plausible pero equivocado* —un feed puede
devolver cifras perfectamente bien formadas y aun así estar mal mapeado:

1. **Elegir 8–10 cartas cuyo precio real el dueño sepa de memoria**, repartidas a propósito:
   - **al menos 2 de valor alto** (una chase moderna) — el tramo donde la curva aplica el markup más bajo
     y un error de fuente se traduce en pesos de inmediato;
   - **al menos 2 baratas** (bulk) — el tramo donde la curva topa contra el **piso**;
   - **al menos 2 con reverse holo y holofoil de la misma carta** — es exactamente lo que P-47 aporta
     (precio distinto por acabado) y lo que el proveedor viejo aplanaba.
2. **Comparar el mercado del día contra lo que el dueño espera**, por acabado:
   ```sql
   SELECT c.name, pr."finish", pr."priceMxnCents", pr."source", pr."capturedDate", pr."isManualOverride"
   FROM "PriceReference" pr
   JOIN "Card" c ON c.id = pr."cardId"
   WHERE c.name IN ('<carta 1>', '<carta 2>', '…')
     AND pr."capturedDate" = CURRENT_DATE
   ORDER BY c.name, pr."finish";
   ```
   **Éxito** = para una misma carta, `normal` / `reverse_holo` / `holofoil` dan cifras **distintas**, con
   `source='tcgcsv_singles'` y `capturedDate` de **hoy**, y los montos **caen donde el dueño espera**
   (no se busca el centavo exacto: se busca que no haya un orden de magnitud de diferencia ni un acabado
   pegado al de otro).
3. **Cobertura, no solo puntería.** Una fuente puede acertar en las 10 cartas del muestreo y aun así
   dejar medio catálogo sin dato — y bajo la curva, **sin dato = pieza retenida**:
   ```sql
   -- % de variantes en inventario de plataforma CON mercado de hoy
   SELECT round(100.0 * count(pr.id) FILTER (WHERE pr.id IS NOT NULL) / NULLIF(count(*), 0), 1) AS pct_con_mercado,
          count(*) AS variantes
   FROM (SELECT DISTINCT i."cardId", i."finish", i."productType"
         FROM "InventoryItem" i
         WHERE i."ownerType" = 'platform' AND i.status IN ('in_stock','listed')) v
   LEFT JOIN "PriceReference" pr
     ON pr."cardId" = v."cardId" AND pr."finish" = v."finish"
    AND pr."productType" = v."productType" AND pr."capturedDate" = CURRENT_DATE;
   ```
4. **Los overrides manuales siguen ganando** (P47-2, durable cross-day). Ya se verifica en §28.4e-2; se
   repite aquí porque bajo la curva el override es **absoluto** (§N.6) y conviene saber que sobrevivió al
   cambio de fuente **antes** de que la curva entre en juego.

#### 29.3-4 CRITERIO DE CORTE — «P-47 está estable, procede P-48»

Se procede con P-48 cuando **los cinco** se cumplen. Si falta uno, **no se procede**; y lo que falla se
enruta a su rol (fuente/ingest ⇒ **backend**; egress/dial/env ⇒ **devops**; dato de negocio ⇒ **dueño**).

| # | Condición | Cómo se comprueba |
|---|---|---|
| 1 | **≥ 2 corridas programadas** de `price-ingest` con `tcgcsv_singles` **sin fallo de barrido** | `GET /admin/pricing/sync-status` + logs; sin `403`/timeouts recurrentes contra `tcgcsv.com` |
| 2 | **`capturedDate` de HOY** para la mayoría del inventario de plataforma | la consulta de cobertura de §29.3-3-3 |
| 3 | **Cobertura ≥ 95 %** de variantes en inventario con mercado del día | misma consulta. **Este es el número que más importa para P-48**: bajo la curva, la variante sin dato **no se publica** — una cobertura del 80 % significa que **1 de cada 5 piezas se retiene** en el cut-over, y eso se leería como «la curva rompió el catálogo» cuando en realidad fue la fuente |
| 4 | **Precio distinto por acabado** en las cartas de muestreo, y **coherente** con lo que el dueño espera | §29.3-3-1/2 |
| 5 | **Sin sorpresas en la cola** durante ≥ 24 h con P-47 solo | `GET /admin/pricing/pending` → `counts`. `no_market` **estable o a la baja**. Si `no_market` está **subiendo** con P-47 solo, la fuente todavía se está asentando: **esperar**. Encender la curva sobre un `no_market` en ascenso garantiza no poder distinguir después qué causó qué |

> **La condición 5 es la que hace que el orden sirva de algo.** Es la lectura de la cola **antes** de que
> la curva exista, es decir, **la línea base**. Sin ella, el `counts` posterior al cut-over no se compara
> contra nada y la regla de diagnóstico de §29.4c se queda sin denominador. **Anota los dos números
> (`no_market` y `premium_at_floor`) en el momento del corte** — son el «antes» del release.
>
> **Ojo:** con P-47 solo, `premium_at_floor` **debería ser 0** — esa razón la introduce el guardarraíl de
> P-48 y antes del cut-over no existe. Si apareciera con valor > 0, es que ya hay código de v2.0
> desplegado y el orden se rompió: **parar**.

---

### 29.4 Secuencia de cut-over (§4.36.9c) — **con los tres veredictos ya dados**

Orquestada por `scripts/post-deploy.sh` (idempotente). Patrón §11.F para el env de prod.

#### 29.4a Deploy y salud (pasos 0–4)

| # | Paso | Comando / dónde | Bloquea | Notas |
|---|---|---|---|---|
| **−1** | **P-47 estable** (§29.3-4) | los 5 criterios de corte | **SÍ** | Prerrequisito de orden. No se salta. |
| **−0.5** | **E2E contra el stack real** (§29.10) | lo corre **QA** | **SÍ** | Cierra la brecha declarada por QA. El «verde» de mocks no autoriza un deploy que toca dinero. |
| 0 | **Snapshot / PITR de la Postgres de prod** | Railway → Postgres → Backups → *Create backup* | **SÍ** | Orden de oro (§7): **datos primero, código después**. Aquí no hay dinero que migrar, pero el snapshot es la red para cualquier sorpresa. **Lo aporta el dueño; devops no tiene acceso.** |
| 1 | **Merge a `main` + deploy** (Railway backend + Vercel frontend) | `deploy.yml` (auto desde `main`) o §26.3 | **SÍ** | Al arrancar, el contenedor aplica **M-41**. El frontend v2.0 (editor de curva) y el backend deben ir **juntos**: el editor de tiers ya no existe. |
| 2 | **Salud** | `GET /api/v1/health` → 200 (Redis `up`) | **SÍ** | No se toca dato hasta que la app esté sana. |
| 3 | **Verificar M-41 aplicada** | SQL de §29.6 | **SÍ** | 1 fila en `_prisma_migrations` + columnas/enums presentes. |
| 4 | **(Opcional) Fijar la curva** | M2 → editor de curva, o `PUT /admin/pricing/curve` | No | Si no se toca, rige el **default de §N.2** (idéntico al seed). El `POST /admin/pricing/curve/preview` permite **dry-run** antes de guardar. |

> **Entre el paso 1 y el 5 el catálogo YA está bajo la curva.** El precio de venta se resuelve **en
> lectura** (§4.26b): lo que estaba publicado adopta la curva **con el deploy**, sin que nadie corra nada.
> El `publish-all` **no es** lo que aplica la curva — es lo que **re-evalúa** cada pieza para publicar la
> que ahora resuelve y **retener** (escalar a la cola) la que no. Por eso el cut-over por sets es una
> operación de **observación y control**, no de aplicación.

#### 29.4b CUT-OVER **POR SETS** (paso 5) — decisión del dueño

> **No se repricia el catálogo completo de una sola vez.** La secuencia es: **repriciar UN set → revisar
> la cola de pendientes y unos cuantos precios → seguir con el siguiente**. `publish-all` acepta
> `setId`/`productType` justamente para esto.

**Por qué por sets, ahora que la cola ya no se vacía sola.** Con v2.1.1 una pieza `listed` que deja de
resolver precio **se escala a la cola y SIGUE `listed`** (escalar no le cambia el status). Eso convierte
el cut-over en algo **verificable de verdad**: hay un número —`summary.listedNowPending`— que dice *«de lo
que ya estaba a la venta, cuánto quedó retenido»*, y ese número **solo es interpretable en lotes chicos**.
Sobre el catálogo entero, un `listedNowPending` de 40 no dice si el problema está en un set concreto o
repartido; sobre un set de 30 piezas, sí.

##### Cómo se dispara

```bash
# Un set, desde el orquestador post-deploy (la batchKey se deriva del set — ver la trampa de abajo):
RUN_PUBLISH_ALL=1 \
PUBLISH_ALL_SET_ID='<uuid interno de CardSet>' \
ADMIN_BASE_URL='https://<API_BASE>/api/v1' ADMIN_JWT='<JWT super_admin>' \
  bash scripts/post-deploy.sh

# O a mano:
curl -X POST "$ADMIN_BASE_URL/admin/inventory/publish-all" \
     -H "Authorization: Bearer $ADMIN_JWT" -H "Content-Type: application/json" \
     -d '{"batchKey":"p48-cutover-<setId>","setId":"<uuid interno de CardSet>"}'
```

##### ⚠️ Dos trampas verificadas en el código — leerlas antes del primer set

1. **`setId` es el `CardSet.id` INTERNO (uuid), NO el `externalId`.**
   `InventoryService.publishAll` resuelve `cardSet.findUnique({ where: { id: req.setId } })`, y el DTO
   (`PublishAllRequestDto`) solo valida `@IsString()`. Mandar `sv8pt5` o `cel25` da
   **`400 VALIDATION_ERROR`**. Es **asimétrico con `POST /admin/jobs/price-ingest`**, que sí acepta
   externalId o id interno (§28.4d) — no lo asumas por analogía. Cómo obtener el uuid:
   ```sql
   SELECT id, "externalId", name, "releaseDate" FROM "CardSet"
   WHERE "externalId" = 'sv8pt5';        -- o:  WHERE name ILIKE '%prismatic%'
   ```
   *(Paridad `externalId` en `publish-all` sería una mejora razonable; es **decisión del arquitecto** y
   cambio de **backend**, no de devops. Queda anotado, no ejecutado.)*

2. **La idempotencia por `batchKey` se evalúa ANTES de mirar los filtros.** El fast-path del
   `InventoryBatch` consulta la clave y, si existe, **devuelve el `resultJson` guardado** con
   `idempotentReplay:true` sin llegar a la selección. Consecuencia directa sobre el cut-over por sets:
   **reusar la misma `batchKey` con otro `setId` NO repricia el set nuevo** — devuelve el resumen del set
   **anterior**, y el operador lee un «ya está» que es **falso**. Por eso `post-deploy.sh` deriva la clave
   del set (`p48-cutover-<setId>`) y avisa en voz alta si detecta un replay. Si fijas
   `PUBLISH_ALL_BATCH_KEY` a mano, **que sea distinta por set**.

##### Qué set escoger primero — **recomendación, no imposición**

El objetivo del primer set no es repriciar mucho: es **calibrar la lectura** con el mínimo dinero
expuesto. Criterios, en orden de importancia:

| Criterio | Por qué |
|---|---|
| **Pocas piezas publicadas** (~10–40) | `listedNowPending` tiene que ser un número que se pueda **mirar pieza por pieza**. Si el primer set retiene 3, se abren 3 fichas y se entiende qué pasó. Con 300 no se entiende nada. |
| **Mercado bien cubierto** (≥ 95 % de sus variantes con `PriceReference` de hoy) | Es lo que separa las dos causas. Si el set entra con cobertura pobre, `no_market` se dispara **por la fuente**, no por la curva, y la primera lectura del release queda contaminada. |
| **Con rarezas premium publicadas** (≥ 3 piezas) | Sin premium, el guardarraíl `premium_at_floor` **nunca se dispara** y el set no prueba la mitad del cambio. Un set de puro bulk sale «perfecto» sin haber ejercitado nada. |
| **Precios repartidos** (barato / medio / caro) | La curva **interpola** entre puntos de quiebre. Un set de un solo bracket verifica un solo tramo. |
| **Un solo set-id** (no multi-parte) | Los master sets de §L (Celebrations `cel25`+`cel25c`, Shiny Vault `swsh45sv`, `sma`) viven como **dos** set-ids: el filtro `setId` toma **una sola parte** y el binder mostraría el set **repriciado a medias**. Confunde la lectura sin ganar nada. |
| **Que NO sea el set destacado del home** (`HOME_FEATURED_SET_ID`, hoy `sv8pt5` Prismatic Evolutions) | Es el hero de la portada: máximo radio de exposición. Mal candidato para el primer intento. |
| **Que NO sea el set que se esté validando en P-47** (p. ej. Pitch Black / ME05, §26.6) | Su cobertura de mercado es **justo la variable bajo prueba** en la fase anterior. Usarlo confunde fuente con matemática — exactamente lo que §29.3 evita. |
| **Que NO sea sellado** (`productType=sealed`) | El sellado está **fuera de la curva** (§4.36.10): repriciarlo no prueba nada de P-48. `post-deploy.sh` avisa si se pide. |

**Consulta para rankear candidatos** (correr en prod, solo lectura):

```sql
WITH inv AS (
  SELECT i.id, i."cardId", i.finish, i."productType", i.status, c."setId", c.rarity
  FROM "InventoryItem" i
  JOIN "Card" c ON c.id = i."cardId"
  WHERE i."ownerType" = 'platform'
    AND i.status IN ('in_stock','listed')
    AND i."productType" <> 'sealed'          -- el sellado no entra a la curva
), cov AS (
  SELECT inv.*, (pr.id IS NOT NULL) AS con_mercado
  FROM inv
  LEFT JOIN "PriceReference" pr
    ON pr."cardId" = inv."cardId" AND pr.finish = inv.finish
   AND pr."productType" = inv."productType" AND pr."capturedDate" = CURRENT_DATE
)
SELECT s.id                AS set_uuid,          -- ← ESTE es el valor de PUBLISH_ALL_SET_ID
       s."externalId", s.name, s."releaseDate",
       count(*)                                          AS piezas,
       count(*) FILTER (WHERE status = 'listed')         AS publicadas,
       round(100.0 * count(*) FILTER (WHERE con_mercado) / count(*), 1) AS pct_mercado_hoy,
       count(*) FILTER (WHERE rarity IS NOT NULL AND rarity NOT IN
         ('Common','Uncommon','Rare','Rare Holo','Reverse Holo','Promo'))  AS piezas_premium_aprox
FROM cov JOIN "CardSet" s ON s.id = cov."setId"
GROUP BY s.id, s."externalId", s.name, s."releaseDate"
HAVING count(*) FILTER (WHERE status = 'listed') BETWEEN 10 AND 40
ORDER BY (round(100.0 * count(*) FILTER (WHERE con_mercado) / count(*), 1)) DESC,
         count(*) FILTER (WHERE status = 'listed') ASC;
```

> `piezas_premium_aprox` es una **aproximación operativa**: excluye las seis canónicas NO premium del
> catálogo (`backend/src/common/rarity-catalog.ts`). La **autoridad** es `isPremiumCanonicalRarity()`, que
> además resuelve alias y patrones; para una lectura exacta por rareza, `GET /admin/pricing/rarities`.
> Si la consulta y esta guía se contradicen, **manda la consulta**: describe el inventario real de prod,
> que devops no puede ver desde aquí.

**Recomendación concreta:** el **primer candidato de esa lista** (mayor cobertura, menos piezas
publicadas) que además traiga **≥ 3 premium**. Si el ranking deja arriba un set con 0 premium, tómalo
igual como **primer set** —es el más barato de equivocarse— pero **no des el guardarraíl por verificado**:
elige como **segundo** uno con premium, y hasta entonces no lo declares probado.
Y si `HAVING` devuelve vacío (ningún set entre 10 y 40 publicadas), afloja el rango antes que abandonar la
secuencia por sets: **un set grande revisado sigue siendo mejor que el catálogo entero sin revisar**.

#### 29.4c Lectura ENTRE set y set — los tres números que decide el dueño

Después de **cada** set, antes de disparar el siguiente. `post-deploy.sh` imprime los tres.

**① `summary.listedNowPending`** — *de lo que ya estaba a la venta, cuánto quedó retenido.*

Es el número que contesta la pregunta del dueño, y **no se deduce de ningún otro**: `pendingPrice` mezcla
lo que **nunca** estuvo publicado, y `alreadyListed` **cambió de significado** en v2.1.1 (pasó de «no la
toqué» a «la re-verifiqué y está **sana**»). Va **fuera** de la partición
`selected = published + alreadyListed + pendingPrice + failed`.

| Lectura | Qué significa | Qué se hace |
|---|---|---|
| `listedNowPending = 0` | Nada de lo que se vendía dejó de venderse. | Seguir con el siguiente set. |
| **Unas pocas** (1–3 en un set chico) | Piezas que la matemática vieja publicaba **mal** y la curva retiene. **Es el cambio funcionando, no un fallo.** | Abrir esas fichas en M2 y confirmar una por una que el precio viejo era el equivocado. Recién ahí, seguir. |
| **Muchas** (una fracción visible del set) | La curva está reteniendo inventario sano. | **PARAR.** No repriciar el siguiente set. Ir a ②/③ para saber si es piso o feed. |

> Estas piezas **siguen `listed`** pero están **fuera de Compra** y **no cuentan en `stockCount`** — no hay
> exposición abierta ni dinero en riesgo, pero **tampoco se venden**. La retención es visible en la cola,
> que es exactamente la diferencia contra el bug original: antes esto pasaba **en silencio**.

**② y ③ `counts` de la cola por razón** — `GET /admin/pricing/pending` → `{ no_market, premium_at_floor, unknown }`.

Los `counts` **ignoran `?reason=` y la paginación** y **respetan `?context=`**: describen **la cola**, no
la página que estés viendo. (Derivarlos de la página cargada mentiría justo cuando el dueño filtra para
triar.)

> ### REGLA DE DIAGNÓSTICO (`ARCHITECTURE §4.36.5c`) — los dos conteos SOLO se leen JUNTOS
>
> | Patrón | Diagnóstico | Acción |
> |---|---|---|
> | **`premium_at_floor` SUBE** y **`no_market` PLANO** | **PISO MAL CALIBRADO.** Hay dato de mercado (por eso `no_market` no se mueve), pero la curva aterriza cartas premium en el piso ⇒ el piso está por debajo de lo que esas cartas valen. | **Se corrige en el EDITOR de la curva (M2)**: subir el piso, `POST /admin/pricing/curve/preview` para ver el efecto **en pesos** antes de guardar, `PUT` y **repriciar el mismo set con otra `batchKey`**. |
> | **SUBEN LOS DOS** | **FEED DEGRADADO.** Falta dato de mercado en volumen; las premium que sí lo tienen caen al piso por arrastre. | **NO TOCAR EL PISO.** Un piso inflado para tapar un feed caído **empeora el precio cuando el feed se recupere** — y ese precio malo ya no se nota, porque el síntoma desapareció. Se arregla el **ingest** (rol **backend**) y se repricia después. |
>
> **Línea base esperada: `premium_at_floor` ≈ 3 de cada 333 cartas** (§4.36.9c-3) — algo así como **0,9 %**.
> Muy por encima **no es un guardarraíl ruidoso**: es una de las dos causas de arriba.

**Si el PRIMER set se sale de la línea base:**

1. **PARAR.** No repriciar el siguiente set. Cada set adicional añade ruido a un diagnóstico que todavía
   no está hecho.
2. **Clasificar** con la tabla de arriba, comparando contra la línea base que se anotó en el corte de
   P-47 (§29.3-4-5). Sin ese «antes», los `counts` no se comparan contra nada.
3. **Enrutar** — **no lo arregla devops**:
   - **piso mal calibrado ⇒ el DUEÑO**, en el editor de la curva (M2). Es un dial de negocio, sin deploy.
   - **feed degradado ⇒ BACKEND** (ingest/proveedor). Puede implicar volver a `pokemontcg_io` (§28.6):
     ojo, **eso es rollback de P-47, no de P-48** — y confirma que serializar fue lo correcto, porque
     revertir la fuente **sin** tocar la matemática es una operación limpia.
   - **la curva en sí está mal especificada ⇒ ARQUITECTO** (§4.36).
4. **No se anuncia el release.** Un set repriciado con la cola fuera de rango no es un cut-over parcial
   exitoso: es un diagnóstico pendiente.
5. **Repetir el set** tras el arreglo, **con otra `batchKey`** (misma clave = replay, §29.4b-2).

**Además de los tres números, mirar unos cuantos PRECIOS** (es lo que el dueño pidió y ningún contador
sustituye): abrir 5–10 fichas del set en Compra y confirmar que el precio publicado tiene sentido — sobre
todo en los **extremos** (la más barata y la más cara), que son los tramos donde la curva y el piso se
encuentran. El bug original (**MX$1.31 / MX$3.71** con un supuesto piso de **MX$15**) se veía a simple
vista en una ficha; no hacía falta un reporte.

#### 29.4d Cierre (pasos 6–8)

| # | Paso | Comando / dónde | Bloquea | Notas |
|---|---|---|---|---|
| 6 | **Revisión de OVERRIDES heredados** | M2, binder por variante (§29.5) | No (pero es **del dueño**) | Tarea humana, no automatizable. |
| 7 | **Instrumentación viva** | `GET /admin/reports/pricing-brackets?axis=sale\|buy` | No | Tras la primera venta y la primera compra deben existir los cinco campos y agregar por bracket. |
| 8 | **Anunciar / taggear** | tag de release | — | Solo con **todos los sets** repriciados, la cola dentro de la línea base y §29.10 en verde. |

### 29.5 Overrides heredados — **tarea del dueño, no del script** (§4.36.9c-5)

Los overrides manuales (`InventoryItem.listPriceCents`, `VariantPriceOverride.sellOverrideCents` /
`buyOverrideCents`) **se conservan intactos**: §N.6 los declara **absolutos**. Pero algunos pudieron
fijarse creyendo la etiqueta falsa «Piso (MX$)» del editor viejo — **la causa raíz de P-48**. Con la
curva, ese override **sigue ganando** y puede quedar por debajo de lo que la curva cobraría/pagaría hoy.

**El código no puede distinguir un override deliberado de uno mal informado**, y adivinar sería
exactamente el error que este cambio corrige. **Norma: no se tocan automáticamente.** La comparación ya
es visible sin endpoint nuevo: el binder expone `pricing.buy/sell.suggestedCents` (curva) junto a
`overrideCents`. **Ningún script de devops modifica overrides** — ni este ni ninguno.

> **Nota para el cut-over por sets:** una pieza con override **no aparece** en `listedNowPending` (su
> precio resuelve, por el override). Es decir, **el recorrido por sets no revela los overrides mal
> informados**: son un barrido aparte, del dueño, y no bloquean el release.

### 29.6 Verificación post-deploy (SQL + HTTP)

```sql
-- 1) M-41 aplicada
SELECT migration_name FROM "_prisma_migrations"
WHERE migration_name = '20260824120000_m41_pricing_curve_instrumentation'
  AND finished_at IS NOT NULL;                      -- → 1 fila

-- 2) Instrumentación presente (venta y compra)
SELECT table_name, column_name FROM information_schema.columns
WHERE (table_name = 'OrderItem'      AND column_name IN ('marketMxnCents','priceBasis','marketBracket','finish'))
   OR (table_name = 'SellRequestItem' AND column_name IN ('marketMxnCents','priceBasis','marketBracket'))
   OR (table_name = 'PendingPriceEntry' AND column_name = 'reason');   -- → 8 filas

-- 3) Enums nuevos
SELECT unnest(enum_range(NULL::"MarketBracket"));   -- → lt_3 … gte_300 (escala FIJA)
SELECT unnest(enum_range(NULL::"PriceBasis"));      -- → market, floor, override, bounty, pending

-- 4) La curva (0 filas = corriendo con el default de §N.2, es VÁLIDO)
SELECT key, "updatedBy" FROM "ConfigSetting" WHERE key = 'pricing_curve';

-- 5) Las cinco INERTES deben SEGUIR AHÍ (NO se borran — §29.8)
SELECT key FROM "ConfigSetting" WHERE key IN
  ('sales_price_rules','sales_price_fallback_pct','buylist_price_rules',
   'buylist_price_fallback_pct','pricing_tier_map');

-- 6) Sellado INTACTO (§4.36.10: fuera de la curva). Anota el precio de 2-3 sellados ANTES
--    del deploy y compáralo DESPUÉS: debe ser IDÉNTICO (criterio 85).
SELECT i.folio, i."sealedProductName", i."listPriceCents"
FROM "InventoryItem" i WHERE i."productType" = 'sealed' AND i.status = 'listed' LIMIT 5;
```

**HTTP (super_admin):**

```bash
curl -sS "$ADMIN_BASE_URL/admin/pricing/curve"           -H "Authorization: Bearer $ADMIN_JWT"
curl -sS "$ADMIN_BASE_URL/admin/pricing/pending"         -H "Authorization: Bearer $ADMIN_JWT"   # counts por razón
curl -sS "$ADMIN_BASE_URL/admin/reports/pricing-brackets?axis=sale" -H "Authorization: Bearer $ADMIN_JWT"
```

**Señal de alarma en logs:** `[MONEY] El setting pricing_curve es INVÁLIDO en BD` significa que alguien
editó la fila a mano y quedó corrupta: el backend **no apaga el catálogo** (cae al seed de §N.2 —
«siempre hay curva»), pero **el precio publicado no es el configurado**. Se arregla con
`PUT /admin/pricing/curve`. **Alerta pendiente sobre ese patrón en el log drain** (§8) — es la deuda
**S48-I4** de `SECURITY_NOTES §5`, dueño **devops**, disparador «con el primer alerting real».

### 29.7 Rollback

**Rollback = redeploy del commit anterior. No se restaura la DB para revertir código.**

| Escenario | Acción |
|---|---|
| **App v2.0 rota / precios inesperados** | Railway (`backend` → Deployments → **Redeploy** del deploy previo bueno) y Vercel (**Promote to Production** del build previo). Alternativa Git: `git revert` del merge + push. **Backend y frontend se revierten JUNTOS** (el M2 v2.0 habla con endpoints que el backend viejo no tiene, y viceversa). |
| **¿Y las columnas de M-41?** | **Aditiva ⇒ no estorba.** Para el código viejo, las 8 columnas nullable y el índice son **inertes**; sigue insertando `null` en ellas. **No se revierte la migración** (no hace falta y `migrate resolve --rolled-back` sobre una aditiva solo genera ruido). |
| **¿Y la matemática?** | El resolver viejo **vuelve solo**: sigue en la imagen anterior y sus cinco settings **siguen en BD, íntegros** (por eso **no se borran**). Rollback barato **exactamente** por esa decisión. |
| **¿Y la fila `pricing_curve`?** | Inerte para el código viejo (nadie la lee). Se deja; si se vuelve a v2.0, la configuración del dueño sigue ahí. |
| **¿Y lo que publicó el cut-over?** | Esas piezas quedan `listed` y, bajo el código viejo, **vuelven a precio con la matemática vieja** (la de P-48, la del bug). No hay corrupción de datos, pero **es la consecuencia real de revertir**: si se revierte, se revierte el precio de todo, no solo de lo nuevo. Despublicar pieza por pieza es manual (M2) y solo se hace si el dueño lo pide. |
| **Rollback a MITAD del cut-over por sets** | **No hay estado partido que reparar.** Los sets ya repriciados no quedan «a medio migrar»: el precio se resuelve **en lectura**, así que al revertir el código **todos** los sets —repriciados o no— vuelven a la matemática vieja a la vez. Las entradas de cola creadas por el guardarraíl quedan **abiertas e inertes** (el código viejo no las lee) y se cierran solas al volver a v2.0 y re-resolver. Los `InventoryBatch` de las `batchKey` usadas **se conservan**: si se vuelve a v2.0, hay que usar **claves nuevas** para repriciar de verdad (§29.4b-2). |
| **Rollback SOLO de la fuente (P-47)** | Flip inverso del dial: `PUT /admin/settings` `{"price_provider":"pokemontcg_io"}` (§28.6). **Sin redeploy y sin migración.** Que esto sea una palanca independiente de la curva es **el beneficio operativo de haber serializado** (§29.3). |
| **Migración falla al aplicar** | Prisma envuelve cada migración en su tx → **rollback atómico**; el contenedor sale ≠0, Railway **mantiene activo el deploy anterior**. Prod sigue sirviendo el código viejo. |
| **Corrupción de datos (no rollback de código)** | Única razón para restaurar el snapshot del paso 0. |

**No se requiere ventana de riesgo** (§4.36.9d / §N.9): no hay dinero vivo en tránsito que la migración
toque. Aun así, el cut-over se hace **fuera de hora pico** por el volumen del `publish-all`.

### 29.8 Anti-checklist — lo que **NO** se hace en este release

1. **NO borrar** las cinco claves inertes (`sales_price_rules`, `sales_price_fallback_pct`,
   `buylist_price_rules`, `buylist_price_fallback_pct`, `pricing_tier_map`). Borrar configuración en el
   mismo paso que cambia la matemática **mata el diagnóstico y el rollback barato** (§4.36.9b, mismo
   precedente que `rarity_map` en v1.32). La limpieza es un **follow-up** posterior, con su propia
   migración y su propia decisión. **Ojo al parecido:** `sealed_spread_fallback_pct` **NO** es una de
   ellas — el sellado sigue vivo y fuera de la curva.
2. **NO hacer `UPDATE` masivo de precios.** No hay precio de venta persistido que actualizar.
3. **NO tocar** `InventoryItem.listPriceCents` ni `VariantPriceOverride.*` (§29.5).
4. **NO agregar variables de entorno.** La curva es dato. Si algo parece necesitar env nuevo →
   **reportar al arquitecto**.
5. **NO correr `prisma/seed.ts` completo contra prod** (siembra demo). El default de la curva ya aplica
   por lectura.
6. **NO re-crear** `backfill-p34-tiered-pricing.ts` ni ningún equivalente.
7. **NO encender P-47 y P-48 en la misma ventana** (§29.3). Decisión del dueño, no preferencia de devops.
8. **NO repriciar el catálogo completo de una pasada** salvo que el recorrido por sets ya haya cerrado y
   solo quede el remanente (§29.4b).
9. **NO reusar la misma `batchKey` entre sets** — devuelve el resumen del set anterior y el set nuevo no
   se repricia (§29.4b-2).
10. **NO subir el piso para acallar la cola sin haber mirado `no_market`** (§29.4c). Si el feed está
    degradado, el piso inflado **empeora el precio cuando el feed vuelva**, y ya sin síntoma que lo delate.
11. **NO desplegar con el «verde» de mocks como única evidencia de E2E** (§29.10).

### 29.9 M-41: contenido y serialización de migraciones

**Contenido** (`backend/prisma/migrations/20260824120000_m41_pricing_curve_instrumentation/`):

1. `CREATE TYPE "PriceBasis"` (`market`, `floor`, `override`, `bounty`, `pending`).
2. `CREATE TYPE "MarketBracket"` (`lt_3`, `r3_10`, `r10_25`, `r25_80`, `r80_300`, `gte_300`) — **escala
   fija**: cambiarla parte la serie histórica.
3. `CREATE TYPE "PendingPriceReason"` (`no_market`, `premium_at_floor`).
4. `OrderItem` += `marketMxnCents`, `priceBasis`, `marketBracket`, `finish` (todas nullable).
5. `SellRequestItem` += `marketMxnCents`, `priceBasis`, `marketBracket` (nullable).
6. `PendingPriceEntry` += `reason` (nullable) + índice `PendingPriceEntry_reason_idx`.

**Sin `DROP`, sin `UPDATE`, sin backfill.** Las filas históricas quedan en `null` a propósito (`null` =
«anterior a M-41»); `reason` **no** entra a la clave de dedupe de la cola, así que filas viejas y nuevas
conviven sin duplicar.

**¿Hay que serializar M-41 contra otras migraciones pendientes? — Verificado con git: NO hay conflicto.**

| Ref | Última migración | Nota |
|---|---|---|
| `origin/main` (`d9c8c91`) | `20260823130000_m40_pending_sealed_product` | M-39/M-40 ya mergeadas; trae P-47/§28. |
| `origin/production` (`c255692`) | `20260823130000_m40_pending_sealed_product` | Rama-registro de releases. |
| `origin/claude/card-pricing-rules-2e537m` (esta) | **`20260824120000_m41_…`** | **Única migración por delante de `main`.** |
| Resto de ramas remotas | ≤ M-40 | Ninguna otra rama abierta añade migraciones. |

- **M-41 es la única migración pendiente del repo.** No hay colisión de timestamp ni orden ambiguo:
  Prisma aplica por nombre (lexicográfico) y `20260824120000` > `20260823130000`.
- La **serialización** que pide `ARCHITECTURE §4.36.9a` es la de **zona compartida** (`backend/prisma/`,
  regla de work streams): **este stream es el único que la toca** en la ventana actual. Mientras M-41 no
  esté en `main`, **ningún otro stream debe crear migraciones**; si lo hace, el orquestador serializa
  (M-41 primero, y la otra se re-fecha por encima).
- **P-47 no añade migración** (§28.1), así que el orden P-47→P-48 de §29.3 **no** condiciona el orden de
  migraciones: son dos ejes independientes. El merge de esta rama sobre `main` **incorpora** P-47 (que ya
  está allí) y no lo revierte.
- **`migrate deploy` corre solo:** el `CMD` de `Dockerfile.backend`
  (`prisma migrate deploy && node dist/main.js`) garantiza **migración antes de servir**. El código v2.0
  nunca sirve sin las columnas de M-41. `healthcheckTimeout: 300` en `railway.json` da holgura.

---

### 29.10 E2E: cerrar la brecha de los MOCKS — **ruta NATIVA soportada** (sin Docker)

> **Hallazgo de QA, aceptado:** los **80/80 de Playwright corrieron contra MOCKS.** Sin `E2E_BASE_URL`,
> `frontend/playwright.config.ts:65-73` levanta `npm run dev` con **`NEXT_PUBLIC_USE_MOCKS=true`**. Ese
> verde demuestra **«la UI es consistente con sus propias simulaciones»**, **no** «frontend y backend
> concuerdan». Para un release que **cambia la matemática del dinero en los dos ejes**, no alcanza.
>
> **Reparto:** **devops CABLEA el camino** (esta sección + `scripts/stack-native.sh`); **QA lo EJECUTA y
> emite el veredicto** (`CLAUDE.md`: las suites las escriben frontend/backend, QA las corre).

#### 29.10-1 Por qué la ruta documentada en §5.1 no basta hoy

`e2e-real.yml` y `docker-compose.staging.yml` **siguen siendo la ruta canónica en CI** y no cambian.
Pero **en el entorno de trabajo del equipo NO hay demonio de Docker** (`/var/run/docker.sock` no
existe), así que `docker compose -f docker-compose.staging.yml up` **no arranca**. Documentar solo esa
ruta equivale a no documentar ninguna: es la razón por la que la verificación real se venía saltando y el
verde de mocks pasaba por suficiente.

#### 29.10-2 La ruta NATIVA — verificada, no supuesta

Tres agentes la recorrieron en este entorno:

| Quién | Qué levantó | Resultado |
|---|---|---|
| **QA** | `pg_ctlcluster 16 main start` + `redis-server --daemonize yes` + `prisma migrate deploy` | **126/127** de integración |
| **pentester** | stack **Nest completo** con `ts-node src/main.ts` en `localhost:3099` | todos los guards y pipes **activos** (no un arnés recortado) |
| **devops** | `scripts/stack-native.sh` (une las dos + el frontend) | Stack COMPLETO arriba: `GET :3099/api/v1/health` → **200** (`db:up`, `redis:up`), M-41 aplicada, `GET :3000/es/compra` → **200**. Y **el cableado frontend→backend verificado, no supuesto**: los chunks servidos (`app/[locale]/(storefront)/compra/page.js`, `layout.js`) llevan **`localhost:3099`** horneado ⇒ `NEXT_PUBLIC_API_BASE_URL` se inyectó y `NEXT_PUBLIC_USE_MOCKS=false` está en efecto |

```bash
# 1) Stack real nativo (Postgres + Redis + migraciones + backend :3099 + frontend :3000 con mocks=false)
./scripts/stack-native.sh up

# variantes
./scripts/stack-native.sh up --infra   # solo PG + Redis + migrate  → para `npm run test:integration`
./scripts/stack-native.sh up --seed    # + npm run seed:synthetic (datos E2E deterministas)
./scripts/stack-native.sh status
./scripts/stack-native.sh down         # apaga apps; PG/Redis siguen (datos intactos)
./scripts/stack-native.sh down --all   # + para PG y Redis
```

#### 29.10-3 El subset `@real` de Playwright — **ya está cableado en `frontend/`**

Verificado en `frontend/playwright.config.ts`: **no hace falta tocar nada del frontend.**

- **`E2E_BASE_URL` presente ⇒ `webServer: undefined`** — Playwright **NO** levanta su server de mocks.
  Ésa es, literalmente, la línea que cierra la brecha.
- **`E2E_REAL=1` ⇒ `grep: /@real/`** — corre **solo** los specs diseñados para el backend real
  (autentican de verdad vía `utils/auth.loginAs`, descubren datos del seed y asertan **estructura**, no
  montos de fixture). Hoy: `checkout` · `shipments` · `buylist` · `guest-checkout` · `vault` ·
  `master-set` · `pricing-curve`.

```bash
cd frontend
# SMOKE de dinero contra el stack vivo (el subset @real):
E2E_BASE_URL=http://localhost:3000 E2E_REAL=1 npm run test:e2e

# SUITE COMPLETA contra el stack vivo (la corrida que de verdad contesta
# «¿frontend y backend concuerdan?»): E2E_BASE_URL sin E2E_REAL ⇒ sin grep.
E2E_BASE_URL=http://localhost:3000 npm run test:e2e
```

> **Al correr la suite completa contra el stack real, espera rojos en specs mock-only** (copy/i18n y
> casos que asertan montos de fixture). **No son bugs del stack**: hay que clasificarlos antes de
> reportarlos. Si un spec mock-only estorba de forma recurrente, la **decisión de taguearlo** es de
> **frontend**, no de devops.
>
> **Chromium:** el config apunta a `/opt/pw-browsers/chromium`. Si no existe:
> `npx playwright install --with-deps chromium` (o `PLAYWRIGHT_CHROMIUM_PATH=…`).

#### 29.10-4 Qué NO cubre la ruta nativa (dicho, no disimulado)

| Hueco | Consecuencia | Mitigación |
|---|---|---|
| **Sin MinIO/R2** | La subida del **INE del buylist** (sobre el tope AML) no se ejercita. | Ruta Docker en CI, o levantar MinIO aparte. **Fuera del delta de P-48** (`uploads` no se tocó). |
| **Corre `ts-node` sobre el fuente, no la imagen de `Dockerfile.backend`** | Prueba el **código**, no el **artefacto** de producción. | El gate del artefacto sigue siendo **`e2e-real.yml` en CI**, que sí construye y usa la imagen. La ruta nativa **complementa**, no sustituye. |
| **Sin egress** | `pokemontcg.io` / `tcgcsv.com` → **403**. El catch-up de `price-ingest` lo registra al arrancar. | **Esperado y money-safe**: deja precios **STALE**, no borra ni escribe $0. Sembrar `PriceReference` con el seed sintético para los flujos que necesiten mercado. |
| **Sin Stripe real** | El webhook firmado no viaja. | Ya cubierto por la suite de **integración** del backend (webhook firmado) — es la que corrió 126/127. |

#### 29.10-5 CI: sin cambios, y por qué

`e2e-real.yml` (nightly + `workflow_call` desde `deploy.yml`, con `needs` sobre la promoción a prod) y
`e2e.yml` (mock, cada PR) **quedan como están**. La ruta nativa es para **la máquina del equipo**, donde
Docker no existe; en CI sí existe y la ruta canónica es la buena. Añadir un job nativo duplicaría el gate
sin añadir garantía.

---

### 29.11 Verificación del **DoD** (`CLAUDE.md`) — responsabilidad de devops

| # | Ítem del DoD | Estado | Evidencia / qué falta |
|---|---|---|---|
| 1 | **Criterios de aceptación de `PROJECT.md`** cumplidos | ⚠️ **cumplidos salvo verificación E2E real** | QA los verificó con la suite de **integración** (126/127) y con Playwright **en mocks**. Los criterios **79–96** (§N, v2.0) tocan dinero: la evidencia de punta a punta contra el stack vivo se cierra con **§29.10**. **Responsable: QA** (devops ya dejó el camino). |
| 2 | **QA aprobó** + **techlead aprobó** | ✅ | QA aprobado con brecha declarada (→ ítem 1). Techlead **aprobado con deuda**, registrada y no bloqueante. |
| 3 | **Fase de seguridad aprobada**, sin críticos/altos abiertos, aceptados registrados | ✅ | `docs/PENTEST_NOTES.md` (red team, `6657196`) + `docs/SECURITY_NOTES.md` (blue team, `2469e6a`): **0 críticos, 0 altos**. Los medios/bajos **S48-M1**, **S48-M2**, **P48-B1** y **AML-1** se **cerraron** después (`6322ee3`, `a2d238e`, `1771a47`, `d38aacf`, `5bd1975`). La deuda aceptada queda en **`SECURITY_NOTES §5`** con dueño y disparador. |
| 4 | **`docs/` al día** (incl. `PENTEST_NOTES` y `SECURITY_NOTES`) | ✅ | `ARCHITECTURE §4.36` · `API_CONTRACT` v2.0→**v2.1.6** · `DESIGN_SYSTEM §21` · `BACKEND_NOTES` · `FRONTEND_NOTES` · `PENTEST_NOTES` · `SECURITY_NOTES` · **este §29**. |
| 5 | **devops desplegó** + despliegue **y rollback** documentados | ⏸️ **runbook COMPLETO; deploy NO ejecutado** | Despliegue: §29.3 (orden) + §29.4a/b/c/d. Rollback: **§29.7**, incluida la fila nueva «rollback a mitad del cut-over por sets» y el rollback independiente de P-47. **Bloqueado por dos insumos del dueño: el snapshot/PITR de la Postgres de prod (paso 0) y la ventana.** Devops no tiene egress a prod ni acceso a los dashboards. |
| 6 | **Gate de seguridad (SAST por PR + DAST staging) y harness E2E cableados en CI** | ✅ | SAST: `security-sast.yml` (semgrep + gitleaks) en **cada push y PR** (`branches: ["**"]`). DAST: job `dast-staging` de `deploy.yml` (ZAP baseline `fail_action:true` + nuclei), **`needs` de la promoción a prod**. E2E: job `e2e-real` (`uses: ./.github/workflows/e2e-real.yml`). **Los dos son `needs` de `promote-production-backend`/`-frontend`** (verificado sobre el YAML: `needs: [dast-staging, e2e-real]`), así que **bloquean** la promoción; no son informativos. |
| 7 | **Sin deuda técnica bloqueante**; la no bloqueante registrada | ✅ **sin deuda bloqueante de infraestructura** | La de código está en `docs/TECH_DEBT.md` (techlead) y la de seguridad en `SECURITY_NOTES §5`. **Deuda devops abierta, toda no bloqueante:** **S48-I3** (`ADMIN_JWT` de post-deploy: emitir **efímero**, revocarlo al terminar el release — disparador: **antes del primer deploy con dinero real**), **S48-I4** (alerta de log drain sobre `[MONEY] pricing_curve INVÁLIDO`, §29.6), **S48-I2** (`json({ limit })` explícito), y el carryover **throttler in-memory** (multi-instancia multiplica el límite por N réplicas). |

#### VEREDICTO DE DoD — **NO SE CIERRA TODAVÍA. Faltan 2 ítems, ninguno de contenido.**

**Lo que falta, con su dueño:**

1. **[QA] Correr la suite E2E contra el stack REAL** (§29.10) y emitir veredicto sobre esa corrida.
   El camino está cableado y verificado; falta ejecutarlo. Es el ítem 1 del DoD y **la única brecha
   sustantiva** — mientras siga abierta, «QA aprobó» descansa sobre mocks para la capa de UI.
2. **[DUEÑO] Aportar el snapshot/PITR de la Postgres de producción y fijar la ventana** (§29.4a, paso 0).
   Sin él no se ejecuta el paso 1. Devops no puede aportarlo: no hay egress a prod desde aquí.

**Lo que NO falta:** los tres veredictos existen, `docs/` está al día, los gates de CI están cableados,
no hay deuda bloqueante y el runbook cubre despliegue **y** rollback.

**Cuando esos dos ítems se cierren**, la secuencia es: **P-47 estable (§29.3-4) → deploy P-48 (§29.4a) →
cut-over por sets (§29.4b/c) → tag de release**. Nada más queda por decidir.

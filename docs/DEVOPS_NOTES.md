# DEVOPS_NOTES.md — Marketplace TCG con Bóveda (Pokémon, México)

> Propiedad: **devops**. Cómo levantar el entorno local, correr CI y desplegar/rollback.
> Coherente con `docs/ARCHITECTURE.md` (§1 stack, §8 variables) y `PROJECT.md`.
> Estado: **fase de cierre**. Código presente en `backend/` y `frontend/`; **QA aprobó** y
> **techlead aprobó** (doble veredicto). Único ítem del DoD legítimamente **pendiente**: el
> **deploy real**, bloqueado por falta de credenciales de producción (ver §11). Runbook listo.

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
| `POKEMONTCG_IO_API_KEY` | Precios raw/singles (fetch real) | dev.pokemontcg.io (free) |
| `POKEMONPRICETRACKER_API_KEY` | Precios gradeadas/sellado | PokemonPriceTracker (free tier) — **provider stub, ver BE-6** |
| `POKETRACE_API_KEY` | Respaldo gradeadas/sellado | PokeTrace (free tier) — **provider stub, ver BE-6** |
| `S3_*` (endpoint/bucket/keys/force-path-style) | **Object storage SOLO para la INE del buylist (`kyc_ine/`)**, cifrada + presigned PUT/GET. Local=MinIO (ya puesto); prod=R2/S3. v1.2.1: sin `S3_PUBLIC_BASE_URL` (no hay prefijo público) ni fotos de inventario/disputa. Nombres reales que consume el código: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`. | Cloudflare R2 o AWS S3 |
| `KYC_UPLOAD_MAX_BYTES` (opcional) | Tope en bytes del upload presignado de la INE (`kyc_ine`); se fija en la firma (`ContentLength`). Sin valor → backend usa **10 MiB** (10485760). | Sin acción salvo querer otro tope |
| `GOOGLE_CLIENT_ID` (backend `[RW]`) + `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (Vercel `[VC]`) | Login con Google (v1.2). **Mismo** OAuth 2.0 Client ID en ambas: backend valida `aud` del ID token; frontend lo usa en el botón. Sin `GOOGLE_CLIENT_ID` el backend rechaza el login con Google (email/password sigue OK). | Google Cloud Console > Credentials > OAuth client ID (Web) |
| `DISPUTE_EVIDENCE_CONTACT` (backend `[RW]`) | Correo que el backend devuelve como `evidenceContact` para que el cliente envíe evidencia de disputa **por email** (v1.2: ya no se sube al bucket). Placeholder, override sin redeploy; default `soporte@tcgvaultmx.com`. | Correo de soporte del negocio |
| `PII_ENCRYPTION_KEY`, `PII_HMAC_KEY` | Endurecimiento PII: cifrado AES-256 en reposo de CLABE/RFC + HMAC del blind index de CLABE (match sin descifrar). **Distintas entre sí**. Vacías OK en local (greenfield); **OBLIGATORIAS en no-local** (backend aborta si faltan). | Generar: `openssl rand -base64 32` (una por cada una); en prod, **KMS/secret manager** |
| `INE_RETENTION_DAYS` | Días de retención de la INE del KYC (`kyc_ine/`). El backend borra; el bucket expira como capa extra. Igual al dial M10 (fuente de verdad). | Valor **legal/fiscal** — **fijado en 180 días** por decisión de negocio, alineado con el dial M10 del backend |
| `FX_SOURCE=banxico`, `BANXICO_SIE_TOKEN` | Tipo de cambio USD→MXN automático (Banxico SIE) + colchón + override manual (M10). El backend lee `BANXICO_SIE_TOKEN` y, si falta, cae a `FX_API_KEY`, y si tampoco, a override manual / último FxRate. | Token SIE de Banxico (gratis en el portal SIE) |
| `DATABASE_URL`, `REDIS_URL`, `POSTGRES_*`, `MINIO_ROOT_*` | Infra | Ya listos en `.env.example` (local); en prod = credenciales del proveedor |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_OPERATOR_EMAIL`, `SEED_OPERATOR_PASSWORD` | Credenciales de las cuentas sembradas (super_admin + vault_operator). **SEC-C1: sin default débil**, generar fuertes (`openssl rand -base64 24`) | Definir en prod ANTES del seed y rotar tras primer login |
| `NEXT_PUBLIC_*` | Config del frontend expuesta al browser (incluye `NEXT_PUBLIC_USE_MOCKS=false`) | Solo claves **públicas** |

> Los **diales de negocio** (tarifa MX$175, IVA 16%, topes MX$3,000/10,000, aportación 70%, markup de
> venta, tarifa Stripe MX del gross-up, `PricingProvider` por tipo) **no son env**: viven en la tabla
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
6. `promote-production-backend` / `promote-production-frontend` — solo si el DAST pasó; protegidos por el
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
- **Alertas básicas**: alerting de la plataforma sobre fallos de deploy y 5xx; alarma sobre fallos del
  job diario `price-sync`/`fx-refresh` y sobre acercarse al rate-limit del free tier (100/día, 250/día).
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
| `.github/workflows/e2e.yml` | E2E en vivo: boota el stack y corre `test:integration` (backend) + `test:e2e` (frontend). |
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
- [ ] `POKEMONTCG_IO_API_KEY`; `POKEMONPRICETRACKER_API_KEY` / `POKETRACE_API_KEY` (opcionales — hoy stub
      BE-6, se cubre con override manual del admin)
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

### 16.5 Resumen de archivos tocados en este saneamiento (todos rutas devops)

| Archivo | Cambio |
|---|---|
| `.github/workflows/security-sast.yml` | Trivy `@0.24.0`→`@v0.33.1` (×3); job `semgrep` a 2 pasos (informe SARIF no-bloqueante + gate `--severity=ERROR`). |
| `security/semgrep.yml` | Fix 2 errores de schema (`pattern-either`/`pattern-not-inside`, lenguaje `tsx`) + refino de `stripe-webhook-verify-signature` para eliminar el FP. |
| `.github/workflows/e2e.yml` | `minio` *service*: quitado healthcheck `curl` interno; añadido paso de readiness desde el runner. |
| `.github/workflows/deploy.yml` | Trigger a solo `workflow_dispatch` (`workflow_run` comentado); nuevo job `secrets-gate` que salta el CD si faltan secrets. |
| `docs/DEVOPS_NOTES.md` | Esta §16. |

> **Nota de propiedad:** no se modificó `ci.yml` (el arreglo del aislamiento `REDIS_URL` del job
> CI·backend lo lleva el rol **backend** en paralelo), ni `backend/`, ni `frontend/`, ni
> `docs/BACKEND_NOTES.md`, ni `docs/TECH_DEBT.md`.

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


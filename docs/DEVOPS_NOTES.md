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
  - `bash -n` de los 5 scripts → OK.
  - `ci.yml` y `docker-compose.yml` parsean como YAML válido.
  - `.env.example` cubre **todas** las env que el código lee (ver §4 y verificación en §10).
- **Deploy real**: **NO ejecutado**. Requiere credenciales prod y una plataforma provisionada
  (ver runbook §11). Esto es lo único que falta del DoD y es esperado en esta sesión.

## 1. Stack (resumen, ver ARCHITECTURE §1)

| Capa | Tecnología | Puerto local |
|---|---|---|
| Backend | NestJS + Prisma (Node 20 LTS) | 3001 (`/api/v1`) |
| Frontend | Next.js 14 App Router (Node 20 LTS) | 3000 |
| Base de datos | PostgreSQL 16 | 5432 |
| Cache/colas/rate-limit | Redis 7 + BullMQ | 6379 |
| Object storage (fotos) | MinIO local / R2·S3 prod | 9000 (API), 9001 (consola) |
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
  se crea solo (init container `createbuckets`). **SEC-A5: es PRIVADO** — los
  prefijos `kyc_ine/` y `dispute_claim/` NO tienen lectura anónima; solo
  `inventory_photo/` (catálogo público) queda con lectura anónima en local. Ver §15.
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
| `S3_*` (endpoint/bucket/keys/public-url/force-path-style) | Fotos. Local=MinIO (ya puesto); prod=R2/S3 | Cloudflare R2 o AWS S3 |
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
> backend + **PostgreSQL 16** + **Redis 7**→**Railway**; fotos→**Cloudflare R2**.
> Antes decía "propuesta"; ya no. Cualquier alta de un servicio de infra NO previsto
> sigue requiriendo propuesta al arquitecto (límite de rol devops).

| Componente | Plataforma CONFIRMADA | Notas |
|---|---|---|
| Frontend (Next.js) | **Vercel** | SSR/ISR nativo, dominios + HTTPS automáticos. |
| Backend (NestJS API) | **Railway** | Usa `Dockerfile.backend`; corre `prisma migrate deploy` al arrancar. |
| Worker BullMQ (jobs) | **Railway** (mismo servicio o worker aparte) | Scheduling de jobs = **deuda BE-5** (lógica lista, falta cablear repeatable jobs a `REDIS_URL`). |
| PostgreSQL 16 | **Railway Postgres** | Backups automáticos + point-in-time. |
| Redis 7 | **Railway Redis** | Persistencia AOF para colas. |
| Object storage | **Cloudflare R2** | Bucket privado + CDN; presigned PUT desde el navegador. CORS al dominio del front. |
| Stripe | Cuenta prod (claves `live`) | Webhook prod → `https://api.tudominio.com/api/v1/webhooks/stripe`. |

> Además de prod, hay un **entorno de STAGING** permanente (mismas plataformas, proyecto/
> environment separado) que se despliega en cada release y sirve de blanco para E2E en vivo y
> DAST. Ver §13 (staging) y §14 (runbook de seguridad).

### CD (plantilla ya presente; se activa con secrets)

`.github/workflows/deploy.yml` **ya existe como plantilla**: deploy a **staging**, **DAST** contra la
URL de staging y **promoción a producción bloqueada si hay hallazgos críticos**. Hoy está en **modo
plantilla** (los pasos reales de Vercel/Railway están comentados y un job `preflight` verifica que
existan los `secrets`; sin ellos el workflow no despliega y avisa). No se dispara solo en push todavía
(solo `workflow_dispatch`) para no fallar en cada commit apuntando a plataformas inexistentes. Para
activarlo: cargar los secrets (`RAILWAY_TOKEN`, `VERCEL_TOKEN`, `STAGING_BASE_URL`, `PROD_BASE_URL`,
`STRIPE_TEST_*`), descomentar el trigger `push` a la rama de release y los pasos de deploy, y proteger
el Environment `production` con *required reviewers*. Detalle en §14 (runbook de seguridad) y §11 (go-live).

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
- **Healthchecks**: en prod, probe a `GET /api/v1/health` (si backend lo expone) o a un endpoint público
  ligero. La infra local ya define healthchecks de Postgres/Redis/MinIO.
- **CORS de producción**: hoy el backend usa `origin: true` (deuda **BE-8**). **Antes del primer deploy
  público**, backend debe restringir `origin` a `APP_BASE_URL`/dominio del front (leído de env). Es
  cambio en `backend/` → corresponde al **rol backend**, no a devops.

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
| `.github/workflows/deploy.yml` | Plantilla CD: deploy staging → DAST → promoción a prod bloqueada por críticos. |
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

## 11. Runbook de go-live (checklist accionable para el humano)

> Ejecutar en orden. Marca cada casilla. Lo que NO puede hacer devops sin ti está indicado como
> **[HUMANO]**. Tras completar credenciales, el deploy es mecánico siguiendo §6.

**A. Cuentas y credenciales** — [HUMANO]
- [ ] Cuenta de la plataforma de hosting (propuesta: **Vercel** front + **Railway** backend/DB/Redis) y
      confirmar la topología con el **arquitecto** (o pedir alternativa).
- [ ] **Stripe live**: `STRIPE_SECRET_KEY` (sk_live_…), `STRIPE_PUBLISHABLE_KEY` (pk_live_…) y, tras
      crear el endpoint de webhook prod, `STRIPE_WEBHOOK_SECRET` (whsec_…). Confirmar la **tarifa MX real
      de Stripe** para cargar los diales `stripe_fee_pct`/`stripe_fee_fixed_cents` (M10) del gross-up.
- [ ] **APIs de precio**: `POKEMONTCG_IO_API_KEY` (raw/singles, fetch real). `POKEMONPRICETRACKER_API_KEY`
      y `POKETRACE_API_KEY` (gradeadas/sellado): opcionales para el go-live porque hoy son **stub**
      (BE-6); mientras tanto esas cartas se prician con **override manual** del admin.
- [ ] **`BANXICO_SIE_TOKEN`** (portal SIE de Banxico, gratis) para el FX automático USD→MXN. Sin token,
      el FX usa override manual (dial M10). `FX_SOURCE=banxico`.
- [ ] **JWT secrets** nuevos y únicos de prod: `openssl rand -hex 48` para `JWT_ACCESS_SECRET` y otro
      distinto para `JWT_REFRESH_SECRET`.
- [ ] **Object storage R2/S3 (SEC-A5)**: crear bucket **PRIVADO** — sin lectura pública anónima,
      **Block Public Access** activado (S3) / sin política pública (R2). Obtener `S3_ENDPOINT`,
      `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. `S3_FORCE_PATH_STYLE=false`
      en R2/S3 (true solo MinIO). Los prefijos `kyc_ine/` y `dispute_claim/` (INE/PII) se sirven
      **solo por presigned GET** (lo implementa backend); no deben quedar detrás de una base pública.
      `S3_PUBLIC_BASE_URL` (CDN) expone **únicamente** el prefijo público `inventory_photo/`.
      **CORS del bucket:** allow-list **solo** el dominio del frontend (`APP_BASE_URL`), métodos
      **PUT** (subida presignada) y **GET** (descarga presignada); nunca `AllowedOrigins: ["*"]`.
- [ ] **SEED_ADMIN_* / SEED_OPERATOR_*** fuertes (super_admin + vault_operator) — SEC-C1,
      `openssl rand -base64 24` por cada una. Rótalas tras el primer login.

**B. Dominios y red** — [HUMANO]
- [ ] Dominio del negocio; DNS: `app.tudominio.com` → frontend, `api.tudominio.com` → backend.
      HTTPS/TLS automático en Vercel/Railway.
- [ ] `APP_BASE_URL=https://app.tudominio.com` y `NEXT_PUBLIC_API_BASE_URL=https://api.tudominio.com/api/v1`.

**C. Cargar variables** — [HUMANO, con guía devops]
- [ ] Cargar todas las keys de §4 en el **secret manager** de la plataforma (nunca en el repo).
      `NEXT_PUBLIC_*` se hornean en build del frontend (incluye `NEXT_PUBLIC_USE_MOCKS=false`).

**D. Provisionar y desplegar** — devops ejecuta una vez que A–C estén listos
- [ ] Provisionar Postgres 16, Redis 7 y bucket.
- [ ] Deploy backend (`Dockerfile.backend`): al arrancar corre `prisma migrate deploy` (crea tablas +
      `inventory_folio_seq`). Tomar **snapshot** de la DB antes de cualquier migración futura.
- [ ] `./scripts/seed.sh` **una vez**: diales M10 + super_admin + ubicaciones base. Ajustar los diales
      (markup de venta, tarifa Stripe MX, tope de reposición por carta) desde M10.
- [ ] Deploy frontend (Vercel o `Dockerfile.frontend`) con `NEXT_PUBLIC_USE_MOCKS=false`.
- [ ] Crear el **webhook de Stripe prod** → `https://api.tudominio.com/api/v1/webhooks/stripe`; copiar el
      `whsec_…` a `STRIPE_WEBHOOK_SECRET` y redeploy backend.

**E. Endurecimiento previo a público** (cambios de código → **rol backend**, no devops)
- [ ] **BE-8**: restringir CORS a `APP_BASE_URL` (hoy `origin: true`).
- [ ] **BE-5**: cablear el scheduling BullMQ de los 4 jobs (price-sync, fx-refresh, buylist-sweep,
      dispute-deadline) a `REDIS_URL`, para que las tareas diarias y los plazos 7d/30d corran solos.
      Mientras tanto: `POST /admin/pricing/sync` y `POST /admin/fx/refresh` disparan a mano; `buylist-sweep`
      y `dispute-deadline` no tienen endpoint aún.
- [ ] **BE-7**: compensar reserva si Stripe falla tras commitear (evitar items `reserved` huérfanos).

**F. Verificación post-deploy** — devops
- [ ] Healthcheck de la API responde.
- [ ] Un flujo de compra en modo test (Stripe test keys en staging) → carta entra a bóveda
      `pending → settled` vía webhook `payment_intent.succeeded`.
- [ ] Subida de una foto de prueba vía presigned PUT al bucket.
- [ ] Un `charge.dispute.created` de Stripe CLI revierte el item a inventario de plataforma.

**G. Banderas legales/fiscales** — [HUMANO] (no bloquean infra; sí operar con público real)
- [ ] Legal de custodia/depositario y contrato de custodia. Fiscal buylist/SPEI. CFDI manual por correo
      (timbrado PAC = fase 2). ToS de las APIs de precio. Ver `PROJECT.md` › Riesgos.

**H. Metas de lanzamiento** — [HUMANO]
- [ ] Fijar N/X/Y/Z (usuarios, ventas settled, buylist pagadas, retiros sin disputa) al abrir la beta
      cerrada. No bloquean el deploy técnico.

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
| `deploy.yml` | push a release (hoy manual) | deploy staging → DAST (ZAP baseline + nuclei) → promoción a prod | promoción a prod **bloqueada** si hay críticos. **Plantilla (pendiente secrets).** |
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
- `deploy.yml` / `security-scheduled.yml`: cargar `RAILWAY_TOKEN`, `VERCEL_TOKEN`, `STAGING_BASE_URL`,
  `PROD_BASE_URL`, `STRIPE_TEST_*` como GitHub Secrets; descomentar los pasos de deploy y el trigger
  `push` a la rama de release; proteger el Environment `production` con *required reviewers*.

---

## 15. Remediación de seguridad (hallazgos de `docs/SECURITY_NOTES.md`)

Cambios de infraestructura hechos por devops para los hallazgos que le tocan. Los de código
(backend/frontend) siguen abiertos con su rol dueño y se listan al final como dependencias.

### 15.1 SEC-A5 — Object storage privado (INE/KYC/PII)

- **Prod (R2/S3):** bucket **privado**, sin lectura pública anónima (Block Public Access / sin política
  pública). Los prefijos sensibles `kyc_ine/` y `dispute_claim/` se sirven **solo por presigned GET de
  vida corta** (implementación = **rol backend**, aún abierto: `disputes.service.ts`/`catalog.service.ts`
  usan `S3_PUBLIC_BASE_URL`). `S3_PUBLIC_BASE_URL`/CDN expone **únicamente** `inventory_photo/`.
- **CORS del bucket:** allow-list solo `APP_BASE_URL` (dominio del front), métodos **PUT** y **GET**.
  Nunca `AllowedOrigins: ["*"]`. Ejemplo de política R2/S3:

  ```json
  [{ "AllowedOrigins": ["https://app.tudominio.com"],
     "AllowedMethods": ["PUT", "GET"],
     "AllowedHeaders": ["content-type"],
     "MaxAgeSeconds": 3000 }]
  ```

- **Local/staging (MinIO):** `createbuckets` deja el bucket **privado** (`mc anonymous set none`) y solo
  publica el prefijo de catálogo (`mc anonymous set download .../inventory_photo`). Una corrida vieja con
  lectura pública total queda reprivatizada al re-levantar. Efecto: en local, las fotos de KYC/disputa ya
  **no** cargan por URL pública — es lo correcto; cargarán cuando backend sirva por presigned GET.

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
6. **Regla:** los secretos viven en el secret manager de la plataforma, **nunca** en el repo ni en un
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
  SEC-A4 (proyección PII para `vault_operator`), **SEC-A5 parte app** (servir INE/disputa por presigned
  GET, no por `S3_PUBLIC_BASE_URL`), SEC-C2 (bump de deps), y deuda SEC-M1/M3/M5/B1..B4.
- **frontend:** SEC-M2 (token fuera de `localStorage`) + SEC-C2 (bump `next`/`next-intl`/`postcss`).

> Mientras SEC-A5 (parte backend) no esté, las fotos de KYC/disputa **no se sirven** en local (el bucket
> ya es privado); esto es intencional y correcto. El deploy a prod no debe activar lectura pública del
> bucket para "arreglar" la visualización: la solución es el presigned GET del backend.


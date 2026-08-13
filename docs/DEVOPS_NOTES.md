# DEVOPS_NOTES.md — Marketplace TCG con Bóveda (Pokémon, México)

> Propiedad: **devops**. Cómo levantar el entorno local, correr CI y desplegar/rollback.
> Coherente con `docs/ARCHITECTURE.md` (§1 stack, §8 variables) y `PROJECT.md`.
> Estado: **base de infraestructura lista**. Deploy real **pendiente** hasta doble
> veredicto (QA + techlead) según `CLAUDE.md`.

---

## 0. Estado actual (greenfield)

- Aún **no existe código** en `backend/` ni `frontend/` (lo crean esos roles).
- Toda la infraestructura de arriba (compose, Dockerfiles, CI, scripts, envs) está
  **preparada y validada** para activarse sin cambios en cuanto exista el código.
- Los Dockerfiles y el perfil `apps` de compose **fallarán a propósito** mientras las
  carpetas de app estén vacías; es esperado. La infraestructura (Postgres/Redis/MinIO)
  funciona ya de forma independiente.

## 1. Stack (resumen, ver ARCHITECTURE §1)

| Capa | Tecnología | Puerto local |
|---|---|---|
| Backend | NestJS + Prisma (Node 20 LTS) | 3001 |
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
# 1) Clonar y entrar al repo
cd Dev-team

# 2) Crear tu .env desde la plantilla (y rellenar claves reales — ver §4)
cp .env.example .env

# 3) Levantar infraestructura (Postgres + Redis + MinIO + bucket)
./scripts/dev-up.sh
#    equivale a: docker compose up -d

# 4) (cuando exista backend/) migrar y sembrar la base
./scripts/db-migrate.sh        # prisma migrate dev
./scripts/seed.sh              # diales M10, super_admin, ubicaciones base

# 5) (cuando exista el código) arrancar las apps en modo dev
cd backend  && npm install && npm run start:dev   # http://localhost:3001
cd frontend && npm install && npm run dev          # http://localhost:3000
```

Alternativa todo-en-Docker (cuando exista el código):

```bash
./scripts/dev-up.sh --apps     # docker compose --profile apps up -d
```

Servicios y accesos tras `dev-up`:

- Postgres: `localhost:5432` (credenciales de `.env`).
- Redis: `localhost:6379`.
- MinIO API: `http://localhost:9000` · Consola: `http://localhost:9001`
  (login con `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`). El bucket `tcg-photos`
  se crea solo (init container `createbuckets`) con lectura pública para servir fotos.

Apagar:

```bash
./scripts/dev-down.sh          # conserva datos (volúmenes)
./scripts/dev-down.sh --wipe   # BORRA datos (reset total)
```

### Webhooks de Stripe en local

El backend expone `POST /api/v1/webhooks/stripe` (firma verificada). Para probar en local:

```bash
stripe login
stripe listen --forward-to localhost:3001/api/v1/webhooks/stripe
# Copia el whsec_… que imprime a STRIPE_WEBHOOK_SECRET en tu .env y reinicia el backend.
```

---

## 4. Variables de entorno (qué debe rellenar el humano)

Todas viven en `.env` (copia de `.env.example`, **nunca** se comitea). Con los
valores por defecto de `.env.example`, la **infraestructura local** arranca sin
tocar nada. Requieren **credenciales reales** antes de usar esas funciones:

| Variable(s) | Para qué | Quién la provee |
|---|---|---|
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Firmar JWT (auth) | Generar: `openssl rand -hex 48` |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` | Pagos y webhooks | Dashboard de Stripe (test/prod) |
| `POKEMONTCG_IO_API_KEY` | Precios raw/singles | dev.pokemontcg.io (free) |
| `POKEMONPRICETRACKER_API_KEY` | Precios gradeadas/sellado | PokemonPriceTracker (free tier) |
| `POKETRACE_API_KEY` | Respaldo gradeadas/sellado | PokeTrace (free tier) |
| `S3_*` (endpoint/bucket/keys/public-url) | Fotos. Local=MinIO (ya puesto); prod=R2/S3 | Cloudflare R2 o AWS S3 |
| `FX_SOURCE`, `FX_API_KEY` | Tipo de cambio USD→MXN (default `manual`) | Solo si se automatiza (ver ARCH Preg. 5) |
| `DATABASE_URL`, `REDIS_URL`, `POSTGRES_*`, `MINIO_ROOT_*` | Infra local | Ya listos en `.env.example` |
| `NEXT_PUBLIC_*` | Config del frontend expuesta al browser | Solo claves **públicas** |

> Los **diales de negocio** (tarifa MX$175, IVA 16%, topes MX$3,000/10,000,
> aportación 70%, `PricingProvider` por tipo) **no son env**: viven en la tabla
> `ConfigSetting` (M10), editables sin redeploy. Los siembra `seed.sh`.

---

## 5. CI (`.github/workflows/ci.yml`)

Se dispara en **push** y **pull_request**. Jobs:

1. **detect** — mira si `backend/package.json` y `frontend/package.json` existen y
   activa los jobs correspondientes (tolerante al estado greenfield).
2. **backend** — Node 20; levanta servicios **Postgres 16** y **Redis 7** (para
   tests de integración); corre `prisma generate` + `migrate deploy` (si hay schema)
   y luego `lint → typecheck → test → build` (cada uno con `--if-present`).
3. **frontend** — Node 20; `lint → typecheck → test → build` con `NEXT_PUBLIC_*` dummy.
4. **ci-ok** — gate final; verde también cuando los jobs se saltan (greenfield).
   Úsalo como *required status check* en la protección de rama.

**Convención de scripts npm** que backend/frontend deben exponer para que CI los
ejecute: `lint`, `typecheck`, `test`, `build`. Si falta alguno, se salta con aviso.

**MinIO en CI:** no se levanta. Los tests que tocan S3 deben mockear el cliente o
usar un endpoint tipo LocalStack; documentarlo en `docs/BACKEND_NOTES.md`.

### Correr CI localmente (equivalente)

```bash
# Backend
cd backend && npm ci && npm run lint && npm run typecheck && npm test && npm run build
# Frontend
cd frontend && npm ci && npm run lint && npm run typecheck && npm test && npm run build
# Con infra de apoyo levantada (./scripts/dev-up.sh) para tests de integración.
```

Opcional: `act` (nektos/act) para ejecutar el workflow de GitHub Actions en local.

---

## 6. Deploy — estrategia propuesta (aún NO ejecutado)

> El deploy real se hace **solo** cuando QA y techlead aprueban (doble veredicto,
> ver `CLAUDE.md` › DoD). Esta sección deja la estrategia lista.

### Topología objetivo (MVP)

| Componente | Plataforma propuesta | Notas |
|---|---|---|
| Frontend (Next.js) | **Vercel** | SSR/ISR nativo, dominios + HTTPS automáticos. Alt: Railway. |
| Backend (NestJS + jobs BullMQ) | **Railway** (o Fly.io / VPS con Docker) | 1 servicio web (API) + worker de BullMQ; usa `Dockerfile.backend`. |
| PostgreSQL 16 | **Railway Postgres** / Neon / RDS | Backups automáticos activados. |
| Redis 7 | **Railway Redis** / Upstash | Persistencia AOF para colas. |
| Object storage | **Cloudflare R2** (o AWS S3) | Bucket privado + CDN; presigned PUT desde el navegador. CORS para el dominio del front. |
| Stripe | Cuenta prod (claves `live`) | Webhook prod → `https://api.tudominio.com/api/v1/webhooks/stripe`. |

> Cualquier cambio de esta topología o alta de un servicio nuevo se **propone
> primero al arquitecto** (límite de rol devops).

### Pasos de deploy (cuando toque)

1. **Provisionar** Postgres, Redis y bucket R2/S3 en la plataforma; anotar credenciales.
2. **Cargar variables de entorno** de producción (mismas keys de `.env.example`, con
   valores prod: claves `live` de Stripe, JWT secrets nuevos, `S3_*` de R2/S3,
   `APP_BASE_URL` = dominio real). Nunca en el repo: en el secret manager de la plataforma.
3. **Migraciones:** el arranque del contenedor backend corre `prisma migrate deploy`
   (ver `Dockerfile.backend`). Alternativa: job de release `./scripts/db-migrate.sh deploy`.
4. **Seed inicial de diales** (M10) y usuario `super_admin`: `./scripts/seed.sh` una vez.
5. **Dominios + HTTPS:** apuntar DNS; Vercel/Railway emiten TLS automático. Front en
   `app.tudominio.com`, API en `api.tudominio.com`.
6. **Webhook de Stripe** de producción apuntando a la API; guardar el `whsec_…` prod.
7. **CORS del bucket** R2/S3 permitiendo el dominio del frontend (presigned PUT).
8. **Verificación post-deploy:** healthcheck de la API, un flujo de compra en modo test,
   subida de una foto de prueba, y un `payment_intent.succeeded` de Stripe CLI.

### CD (cuando el proyecto tenga veredicto)

Ampliar `.github/workflows/` con un `deploy.yml` disparado en push a la rama de release,
**dependiente de que `CI` pase**, usando los tokens de Vercel/Railway como GitHub Secrets.
Se añade en la fase de cierre, no ahora.

---

## 7. Rollback

| Escenario | Acción |
|---|---|
| **Deploy de app roto** | Revertir a la release anterior desde el dashboard de la plataforma (Vercel/Railway guardan deploys previos → "Redeploy"/"Rollback" a la versión buena). |
| **Vía Git** | `git revert <sha>` del merge problemático y push → CD redespliega la versión sana. Evitar `reset --hard` en ramas compartidas. |
| **Migración de DB mala** | Restaurar desde **backup** del proveedor (point-in-time si está disponible). Prisma no auto-revierte: preparar migración correctiva o `migrate resolve`. **Tomar snapshot antes de cada `migrate deploy` en prod.** |
| **Config/dial equivocado (M10)** | No requiere deploy: corregir el dial en el back-office (editable sin redeploy) — queda en `AuditLog`. |
| **Secreto filtrado** | Rotar la clave en el proveedor (Stripe/APIs/JWT), actualizar el secret manager, redeploy. |

Regla de oro del rollback: **datos primero** (snapshot antes de migrar), luego código.

---

## 8. Monitoreo y logging (base propuesta)

- **Logging estructurado JSON** en el backend (NestJS Logger o `pino`), con `requestId`
  y `errorCode` (los mismos códigos del contrato). Sin PII ni secretos en logs.
- **Auditoría de negocio**: `AuditLog` (M10) ya cubre quién/qué/cuándo de acciones
  sensibles (dinero saliente, config). No sustituye al logging técnico.
- **Alertas básicas**: usar el alerting de la plataforma (Railway/Vercel) sobre fallos
  de deploy y errores 5xx; alarma sobre fallos del job diario `price-sync`/`fx-refresh`
  y sobre acercarse al rate-limit del free tier (100/día, 250/día).
- **Healthchecks**: la infra local ya define healthchecks; en prod exponer
  `GET /api/v1/health` (lo añade backend) para el probe de la plataforma.

---

## 9. Mapa de archivos de infraestructura (propiedad devops)

| Archivo | Rol |
|---|---|
| `docker-compose.yml` | Infra local: Postgres, Redis, MinIO (+ perfil `apps`). |
| `Dockerfile.backend` | Imagen NestJS (multi-stage, Node 20, `migrate deploy` al arrancar). |
| `Dockerfile.frontend` | Imagen Next.js (multi-stage, output standalone). |
| `.dockerignore` | Contexto de build limpio; evita filtrar `.env`. |
| `.gitignore` | Higiene de secretos y artefactos. |
| `.env.example` | Todas las variables documentadas (sin valores reales). |
| `.github/workflows/ci.yml` | CI: lint + typecheck + test + build (backend/frontend). |
| `scripts/dev-up.sh` / `dev-down.sh` | Levantar/apagar entorno local. |
| `scripts/db-migrate.sh` / `seed.sh` | Migraciones y seed (placeholders tolerantes). |

> Los Dockerfiles viven en la **raíz** (no dentro de `backend/`/`frontend/`) para
> respetar la propiedad de archivos de `CLAUDE.md`: devops no escribe en esas carpetas.

---

## 10. Pendientes / bloqueos para deploy real

- [ ] Que exista código en `backend/` y `frontend/` con scripts `lint/typecheck/test/build`.
- [ ] **Doble veredicto** QA + techlead (DoD de `CLAUDE.md`).
- [ ] El humano provee credenciales prod: **Stripe live**, keys de las 3 APIs de precio,
      bucket **R2/S3**, secrets JWT nuevos, y define **FX_SOURCE** (manual vs automático).
- [ ] Elegir/confirmar plataformas (propuesta: Vercel + Railway + R2) — validar con arquitecto.
- [ ] Dominios y DNS a nombre del negocio.
- [ ] Banderas de `PROJECT.md` no técnicas (legal custodia, fiscal CFDI/PAC) — no bloquean
      infra, pero sí operar con público real.

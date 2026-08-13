# SECURITY_NOTES.md — Ingeniería de seguridad (blue team)

> **Rol:** consolidación defensiva + veredicto. Insumo principal: `docs/PENTEST_NOTES.md` (red team).
> **Método:** validación estática cruzando cada hallazgo del pentester contra el código
> (`backend/`, `frontend/`), config devops (`docker-compose.yml`, `.env.example`, `.github/workflows/`,
> `security/`) y `npm audit` re-ejecutado en esta sesión. **No hay target vivo** → los vectores que
> requieren instancia se marcan **[pendiente de target]**.
> **Regla:** solo se escribe este archivo; no se corrige código. Cada hallazgo indica el **rol dueño**.
> **La vara sube por el negocio:** custodia de bienes de valor + dinero saliente + PII sensible
> (INE / CLABE / RFC). Esto reclasifica dos hallazgos "Media" del pentester a **Alta**.
> Fecha: 2026-08-13.

---

## 0. Resultado de la validación (qué confirmé, descarté o reclasifiqué)

Revisé los 16 hallazgos + 3 positivos del pentester. **Todos se confirman en código.** Ajustes:

| ID pentester | Veredicto blue team | Cambio |
|---|---|---|
| C-1, C-2 | **Confirmado** | Se mantienen Críticos |
| A-1, A-2, A-3 | **Confirmado** | Se mantienen Altos |
| M-1 (PII a `vault_operator`) | **Confirmado + RECLASIFICADO → Alta** | Exposición determinista de CLABE/RFC/INE a rol de menor confianza en negocio de PII |
| M-2 (INE por URL pública) | **Confirmado + RECLASIFICADO → Alta** | Documentos de identidad oficiales no pueden servirse con modelo de "URL pública" |
| M-3, M-4, M-5, M-6, M-7 | **Confirmado** | Se mantienen Medias (deuda con disparador) |
| B-1…B-4 | **Confirmado** | Se mantienen Bajas |
| I-1, I-2, I-3 | **Confirmado (positivos)** | Defensas reales; no se duplican |

**Evidencia nueva de mi sesión:**
- `npm audit --omit=dev` (solo runtime, no dev): **frontend** = 1 crítica (`next-intl` prototype pollution + open redirect) + 1 high (`postcss`) + cadena `next`; **backend** = 3 high (`multer`/`express`/`qs` DoS). Confirma que C-2 **impacta producción**, no solo tooling.
- `grep` de dependencias: **no existe `@nestjs/throttler` ni `helmet`** en `backend/package.json` (confirma C-1 y B-3).
- `backend/prisma/seed.ts:45` — password del `vault_operator` **hardcodeado `Operador123!` sin override por env** (peor que la del admin, que sí lee `SEED_ADMIN_PASSWORD`). `.env.example:61` deja `SEED_ADMIN_PASSWORD=` vacío.
- `backend/src/main.ts:26` — `enableCors({ origin: true, credentials: true })` confirmado.
- `backend/src/modules/admin/admin.service.ts:39-55` — `getUser` incluye `kycProfile`, `billingProfile`, `addresses`; solo remueve `passwordHash`. Controller `admin.controller.ts:22` = `@Roles(vault_operator, super_admin)`. Confirma M-1.
- `schema.prisma:338` — `sourceSellRequestItemId String?` **sin `@unique`**. Confirma A-3.

**Nota positiva de postura (devops):** ya existe un gate SAST (`.github/workflows/security-sast.yml`) que corre semgrep + gitleaks + `npm audit` + trivy y **FALLA en high/critical**, más DAST programado (`security-scheduled.yml`, plantilla hasta tener staging). Esto es maduro y significa que **C-2 ya bloquearía el pipeline de release** hoy. Buen cimiento; no sustituye el bump de dependencias.

---

## 1. Hallazgos priorizados por severidad

### CRÍTICA

#### SEC-C1 · Toma de cuenta admin: login sin rate-limit + credenciales sembradas conocidas
- **Ubicación:** `auth.controller.ts:17-22` (`POST /api/v1/auth/login` `@Public()`, sin throttling); `seed.ts:45` (`vault_operator` = `Operador123!` sin env); `seed.ts:25` + `.env.example:61` (`SEED_ADMIN_PASSWORD` vacío → `ChangeMe123!`); `package.json` sin `@nestjs/throttler`.
- **Evidencia:** login determinista con `operador@tcg.local` / `Operador123!` (credencial en el repo). Sin lockout ni backoff, fuerza bruta contra `super_admin` sin fricción.
- **Impacto:** con `super_admin` se controla dinero saliente (reembolso/SPEI/recompra), diales (IVA/markup/topes) y toda la PII. Es el camino más corto "a la BD" completa.
- **Rol dueño:** **backend** (operador con password por env obligatoria + `@nestjs/throttler` con lockout en `/auth/login` y `/auth/register`); **devops** (forzar `SEED_ADMIN_PASSWORD` no vacío, rotar la del operador, rate-limit/WAF en el borde).

#### SEC-C2 · Dependencias vulnerables en runtime (frontend crítica + backend highs)
- **Ubicación:** `frontend/package.json`, `backend/package.json`.
- **Evidencia (`npm audit --omit=dev`, esta sesión):** frontend **crítica** `next-intl` (prototype pollution vía claves de catálogo de traducción + open redirect) + high `postcss` + cadena `next`; backend **3 high** `multer`/`express`/`qs` (DoS). Los críticos de tooling (`vitest`) son dev-only (menor riesgo operativo, sigue siendo supply-chain).
- **Impacto:** DoS de frontend/backend en producción; superficie de prototype pollution en runtime.
- **Rol dueño:** **devops** (bump priorizado `next`/`next-intl`/`postcss` y `@nestjs/platform-express`/`multer`; re-correr `npm audit`; mantener el gate de `security-sast.yml` como required check en release).

### ALTA

#### SEC-A1 · Buylist: la categoría (monto a pagar) la declara el usuario, no se deriva de la rareza
- **Ubicación:** `buylist.service.ts:98` usa `it.category` del DTO en `quoteAcquisition`; `categoryForRarity()` (:53) existe pero **solo se usa en `publicQuote` (:31)**, no en `createRequest`.
- **Evidencia [verificado en código]:** `POST /api/v1/buylist/requests` con `category:"ex_plus"` sobre una común de alta referencia → cotización = `round(ref × 0.40)` en vez de `MX$0.50`; infla `quotedTotalCents` y el pago que la plataforma se obliga.
- **Impacto:** manipulación al alza del pago (dinero saliente). Mitigado **parcial** por cherry-pick del admin; si aprueba en bloque confiando en la cotización, es pérdida directa.
- **Rol dueño:** **backend** (derivar `category` server-side desde la rareza real; ignorar el valor del cliente).

#### SEC-A2 · Buylist: bypass de topes mensual/por-solicitud por race condition (TOCTOU)
- **Ubicación:** `buylist.service.ts:122-136` — valida `capPerRequest` y `monthUsedCents` (`users.service.ts` aggregate) y **luego** crea `SellRequest` **sin transacción ni lock**.
- **Evidencia [verificado en código; disparo pendiente de target]:** N solicitudes concurrentes cerca del tope leen el mismo `monthUsed`, todas pasan y se crean → el acumulado real supera `BUYLIST_CAP_PER_MONTH_CENTS`.
- **Impacto:** evade límites AML/anti-lavado y de exposición de caja mensual y `capPerRequest`.
- **Rol dueño:** **backend** (validación + creación en una transacción serializable, o contador mensual con `SELECT ... FOR UPDATE`/upsert atómico).

#### SEC-A3 · convert-to-inventory: doble conversión por carrera (sin unique constraint)
- **Ubicación:** `buylist.service.ts:329-369` verifica `item.inventoryItemId` null y **después** crea `InventoryItem`; `schema.prisma:338` `sourceSellRequestItemId` **no es `@unique`**.
- **Evidencia [verificado en código; disparo pendiente de target]:** dos conversiones concurrentes crean dos `InventoryItem` con el mismo `acquisitionCostCents` (folios distintos).
- **Impacto:** inventario fantasma duplicado y doble costo contabilizado; corrompe P&L y valor de inventario.
- **Rol dueño:** **backend** (`@unique` en `sourceSellRequestItemId` + `updateMany` con guardia de estado dentro de la transacción, patrón `count===1` como en checkout — ver SEC-I1).

#### SEC-A4 · [Reclasificado de M-1] `vault_operator` lee CLABE/RFC/INE de cualquier usuario
- **Ubicación:** `admin.controller.ts:22` (`@Roles(vault_operator, super_admin)`) + `admin.service.ts:39-55` (`getUser` retorna `kycProfile` con `clabe`/`ineFrontKey`/`ineBackKey`, `billingProfile` con RFC, `addresses`, órdenes, disputas; solo quita `passwordHash`).
- **Evidencia [verificado en código]:** token `vault_operator` → `GET /api/v1/admin/users/<id>` devuelve datos bancarios e identidad de toda la base.
- **Justificación del ascenso a Alta:** PROJECT define al operador como **rol de menor confianza sin acceso a finanzas/config**; en un negocio de custodia con INE/CLABE esto es una fuga de PII bancaria/identidad explotable con el rol operador (que además tiene credencial conocida — SEC-C1). Segregación de funciones rota.
- **Rol dueño:** **backend** (proyección reducida para `vault_operator`; KYC/CLABE/RFC/INE y financieros **solo `super_admin`**).

#### SEC-A5 · [Reclasificado de M-2] Fotos de INE/KYC y disputa servidas por URL pública del bucket
- **Ubicación:** `disputes.service.ts:14-17` `photoUrl()` = `${S3_PUBLIC_BASE_URL}/${key}`; keys de INE en `KycProfile.ineFrontKey/ineBackKey`; `docker-compose.yml:151` y `.env.example` documentan `S3_PUBLIC_BASE_URL` como base pública.
- **Evidencia [pendiente de target]:** si el bucket tiene ACL de lectura pública, cualquiera con la key (aparece en respuestas admin y en la DB) descarga la INE. Keys UUID (no enumerables), pero el modelo "URL pública" es inadecuado para identidad oficial.
- **Justificación del ascenso a Alta:** documentos de identidad oficial (INE) bajo custodia legal; el patrón de URL pública no es aceptable para PII regulada aunque las keys sean UUID.
- **Rol dueño:** **devops** (bucket **privado**, sin ACL público-lectura para `kyc_ine`/`dispute_claim`); **backend** (servir descargas por **URL prefirmada de lectura de vida corta**, no por base pública). Disparador combinado con SEC-B4 (presign de subida sin restricción).

### MEDIA (deuda con disparador — ver §2)

- **SEC-M1 · CORS refleja cualquier origin con credenciales** — `main.ts:26` `origin:true, credentials:true`. Hoy limitado (tokens en `localStorage`, no cookies), pero mala práctica y se vuelve grave si se migra a cookies. **Rol:** backend (allow-list desde config).
- **SEC-M2 · JWT en `localStorage`** — `frontend/src/lib/api-client.ts:18-29`. Cualquier XSS (o dep frontend comprometida, SEC-C2) exfiltra el token; con `super_admin`, control total. **Rol:** frontend (cookies `httpOnly`+`SameSite` o aislamiento + CSP estricta).
- **SEC-M3 · `refund` no valida estado previo** — `admin-orders.controller.ts:72-81`: solo exige `stripePaymentIntentId`, no `status='settled'`; idempotency-key opcional. Contenido por `MoneyOutGuard` (solo `super_admin`) y por Stripe. **Rol:** backend (exigir `settled` + idempotencia obligatoria).
- **SEC-M4 · Postgres/MinIO con puertos publicados y credenciales default** — `docker-compose.yml:38-39,79-81` publican `5432`/`9000`/`9001`; defaults `tcg_local_dev_password`/`minioadmin_local_dev`. Es la plantilla local; **prohibido** en prod. **Rol:** devops (no publicar puertos de datos, secretos únicos por entorno, negar arranque con defaults en prod).
- **SEC-M5 · `pay-spei` sin idempotencia y con carrera de estado** — `admin-buylist.controller.ts:101-119` ignora `idempotency-key`; `buylist.service.ts:375-388` lee estado y actualiza a `pagada` sin lock. Doble asiento de pago posible. Requiere `super_admin`. **Rol:** backend (transacción con guardia `aprobada→pagada` atómica + idempotencia).

### BAJA

- **SEC-B1 · JWT sin `algorithms` fijados** — `auth.module.ts:7`, guard/service verifican sin `algorithms:['HS256']`. No explotable con secreto simétrico + `jsonwebtoken 9.0.2` (confusión de alg no aplica). Defensa en profundidad. **Rol:** backend.
- **SEC-B2 · Validación de env solo en `production`** — `env.validation.ts:8` exige secretos solo si `NODE_ENV==='production'`; staging arranca sin secretos fuertes. **Rol:** backend/devops.
- **SEC-B3 · Sin `helmet`/cabeceras de seguridad** — `main.ts` sin HSTS/CSP/X-Content-Type-Options/X-Frame-Options. **Rol:** backend (+ devops en reverse proxy).
- **SEC-B4 · Presign de subida sin restringir content-type ni tamaño** — `uploads.service.ts:34-46` acepta cualquier `contentType`, deriva extensión del input, sin límite de tamaño. `contentType:"text/html"` → subir HTML; combinado con SEC-A5 (bucket público inline) = XSS almacenado. **Rol:** backend (allow-list `image/*`, `Content-Length` máximo, `Content-Disposition: attachment`).

### Defensas verificadas (positivas — no requieren acción)
- **SEC-I1 · Reserva de checkout atómica:** `orders.service.ts:119-150` `updateMany` guardado por estado + `reserved.count!==1` en `$transaction`; `Order.stripePaymentIntentId` `@unique`. **Sin doble-venta.**
- **SEC-I2 · Webhook Stripe:** firma con `constructEvent` + idempotencia atómica por `ProcessedStripeEvent` (`@unique`, P2002 como guardia, borra la marca si el handler falla → Stripe reintenta). Replay/doble-proceso mitigados. *Observación devops:* que `STRIPE_WEBHOOK_SECRET` no arranque vacío en prod (falla cerrada, pero mejor validar).
- **SEC-I3 · IDOR/authz por objeto + money-out:** todos los `getMine`/detail verifican `ownerUserId/userId` (vault, órdenes, buylist, disputas, direcciones); `MoneyOutGuard` exige `super_admin` y **audita** intentos bloqueados; `updateMe` con DTO whitelisted (sin escalada por mass-assignment). **Sin inyección SQL** (único `$queryRawUnsafe` es constante).

---

## 2. Deuda de seguridad aceptada (no bloqueante) — con disparador

Aceptable **para desarrollo/beta cerrada**, NO para operar con dinero/público real.

| ID | Deuda | Impacto residual hoy | Disparador para abordarla |
|---|---|---|---|
| SEC-M1 | CORS `origin:true` | Bajo (tokens en localStorage, no cookies) | **Antes de exponer a público** o **antes de migrar a cookies de sesión** (lo que ocurra primero) |
| SEC-M2 | JWT en localStorage | Depende de que no haya XSS | Junto con endurecer CSP; **antes de dinero real** |
| SEC-M3 | `refund` sin guardia de estado | Bajo (MoneyOut super_admin + Stripe corta sobre-reembolso) | **Antes de operar reembolsos con dinero real** |
| SEC-M4 | Compose con defaults/puertos | Nulo en local; alto si se usa tal cual en prod | **Antes del primer deploy** a cualquier entorno accesible |
| SEC-M5 | `pay-spei` sin idempotencia | Bajo (SPEI manual, super_admin) | **Antes de operar pagos SPEI con dinero real** |
| SEC-B1..B4 | Hardening (alg JWT, env, helmet, presign) | Bajo | B3/B4 **antes de exponer uploads/panel a público**; B1/B2 en el próximo sprint de hardening |

> Registrar el pendiente de código en `docs/TECH_DEBT.md` (a petición del techlead) por el rol dueño.

---

## 3. Banderas para el humano

1. **Pentest de tercero + programa de bug bounty ANTES de operar con dinero real.** El análisis fue estático y sin target vivo; los vectores dinámicos (fuerza bruta de login, CORS, DoS de dependencias, race conditions de topes/conversión/SPEI) están **[pendiente de target]** y deben verificarse contra staging. En un negocio que mueve dinero + custodia + PII, la revisión externa es requisito, no opcional.
2. **Activar el DAST real:** `security-scheduled.yml` es plantilla hasta que exista `STAGING_BASE_URL`. Levantar staging autorizado y disparar ZAP/nuclei + reproducir los PoC concurrentes.
3. **Legal/PII (México):** custodia implica figura de **depositario** y contrato de custodia (ya en riesgos de PROJECT). Además, INE/CLABE/RFC caen bajo **LFPDPPP**: definir **cifrado en reposo de CLABE**, **enmascaramiento** en UI admin, política de **retención/borrado** de INE, y aviso de privacidad. Hoy CLABE se guarda en claro (`KycProfile.clabe`) y la INE se sirve por URL pública (SEC-A5).
4. **Segregación de funciones:** confirmar con el negocio que `vault_operator` NO debe ver datos bancarios/identidad (base de SEC-A4). El diseño de PROJECT lo dice; el código no lo respeta.
5. **Secret management en prod:** mover secretos a un secret manager (no `.env` en el host); rotar la credencial del operador sembrada en el repo.

---

## 4. Plan de remediación por rol (para enrutar los fixes)

**backend** (dueño del código de app):
- SEC-C1: password del operador por env obligatoria; `@nestjs/throttler` + lockout en `/auth/login` y `/auth/register`.
- SEC-A1: derivar `category` server-side desde la rareza en `createRequest`.
- SEC-A2: cap check + creación en transacción atómica/serializable.
- SEC-A3: `@unique` en `sourceSellRequestItemId` + `updateMany` guardado en la transacción.
- SEC-A4: proyección reducida para `vault_operator`; KYC/finanzas solo `super_admin`.
- SEC-A5 (parte app): servir INE/disputa por presign de lectura corto, no por base pública.
- Deuda: SEC-M1, SEC-M3, SEC-M5, SEC-B1..B4.

**frontend:**
- SEC-M2: sacar el token de `localStorage` (cookie `httpOnly`+`SameSite` o aislamiento) + CSP estricta.

**devops:**
- SEC-C1: forzar `SEED_ADMIN_PASSWORD`, rotar credencial operador, rate-limit/WAF en el borde.
- SEC-C2: bump `next`/`next-intl`/`postcss` y `@nestjs/platform-express`/`multer`; mantener gate `security-sast.yml` como required check.
- SEC-A5 (infra): bucket privado sin ACL público-lectura para `kyc_ine`/`dispute_claim`.
- SEC-M4: no publicar puertos de datos; secretos únicos por entorno; negar arranque con defaults en prod.
- SEC-I2: validar `STRIPE_WEBHOOK_SECRET` no vacío en prod.
- Deuda: SEC-B2/B3 en el borde.

---

## 5. VEREDICTO

### RECHAZADO

Hay **hallazgos críticos y altos abiertos** (SEC-C1, SEC-C2, SEC-A1, SEC-A2, SEC-A3, SEC-A4, SEC-A5).
Regla: se rechaza con cualquier crítico/alto abierto. Además, el negocio (dinero + custodia + PII INE/CLABE) sube la vara.

**Mínimo necesario para APROBAR** (cerrar todo lo Crítico y Alto):
1. **SEC-C1** — password del operador por env + rate-limit/lockout en login (backend) + rotación/forzado de secretos (devops).
2. **SEC-C2** — bump de dependencias runtime (frontend crítica + backend highs) y `npm audit` limpio de high/critical (devops).
3. **SEC-A1** — categoría de buylist derivada server-side (backend).
4. **SEC-A2** — validación de topes atómica (backend).
5. **SEC-A3** — `@unique` + guardia transaccional en convert-to-inventory (backend).
6. **SEC-A4** — proyección reducida de PII para `vault_operator` (backend).
7. **SEC-A5** — bucket privado + presign de lectura para INE/disputa (devops + backend).

Las Medias/Bajas quedan como **deuda aceptada con disparador** (§2), condicionada a que **ninguna llegue a producción con dinero/público real sin cerrarse** y a que el **pentest de tercero** (§3) se ejecute antes de operar con dinero real.

**Re-evaluación:** al cerrar los 7 puntos, el rol dueño lo reporta; seguridad re-verifica (incluyendo disparo dinámico contra staging) y actualiza este veredicto.

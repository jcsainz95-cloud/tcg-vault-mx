# SECURITY_NOTES.md — Seguridad (blue team) · consolidación y veredicto

> **Rol:** seguridad (blue team). Reviso la defensa, **valido/consolido** los hallazgos del
> `pentester` (`docs/PENTEST_NOTES.md`) contra el código y emito el **VEREDICTO**. No corrijo
> código: cada hallazgo se enruta al **rol dueño**.
> **Alcance de esta revisión (rev v1.3):** **re-verificación del endurecimiento de producción**
> que estaba enrutado como deuda (S-M1, S-M2, S-B3, S-B4). Backend implementó: CORS allow-list,
> `helmet`, `algorithms` JWT fijados al firmar y verificar, validación de env **siempre**, y
> allow-list de content-type + límite de tamaño en el presign `kyc_ine`. Verifico que **cierran**
> los hallazgos y que **no introdujeron regresión** en los guardarraíles de dinero/PII.
> **Modo:** revisión **estática** de código + `npm audit` + ejecución de `test/uploads.presign.spec.ts`.
> Sin stack vivo (R2/Railway aún sin configurar) → vectores que exigen instancia = **[PoC pendiente
> de target — DAST]**; verificados por lectura/tests = **[Verificado en código]**.
> **Fecha:** 2026-08-15 (rev **v1.3**, endurecimiento de producción). Blanco autorizado: staging/local.

---

## 0. Resumen ejecutivo (rev v1.3)

El **endurecimiento de producción** que quedó enrutado como deuda en la rev v1.2.1 fue
implementado por **backend** y **cierra** los hallazgos abiertos de transporte/auth/uploads.
Todo verificado en código y con tests corriendo:

- **S-M2 (CORS) — CERRADO.** `main.ts` ya **NO** usa `origin: true`. `resolveCorsOrigins()`
  construye una **allow-list** desde `APP_BASE_URL` (lista separada por comas) con
  `credentials: true`. **Fallback fail-closed**: si falta `APP_BASE_URL`, solo devuelve orígenes
  de dev local (`http://localhost:3000`, `http://localhost:5173`) — **jamás un comodín**.
- **S-B4 (helmet / algorithms / env) — CERRADO.** `helmet()` aplicado en `main.ts:29`.
  JWT con `algorithm:'HS256'` al **firmar** (`auth.service.ts:47,54`) y `algorithms:['HS256']` al
  **verificar** (`jwt-auth.guard.ts:37`, `auth.service.ts:183`) → algorithm-confusion cerrado en
  defensa en profundidad. `env.validation.ts` valida **siempre** (no solo en prod) para todo
  entorno no-local, con **chequeo de entropía** (≥32 chars) de los secretos JWT.
- **S-B3 (presign) — CERRADO (con residuo Bajo aceptado).** `uploads.service.ts` fuerza
  allow-list `image/*` (rechaza HTML/PDF/octet-stream con 422) **siempre**, y aplica límite de
  tamaño (`KYC_UPLOAD_MAX_BYTES`, default 10 MiB) fijándolo en la firma (`ContentLength`) cuando el
  cliente lo declara; `presignGet` sirve el INE con `Content-Disposition: attachment`. 12/12 tests
  de `test/uploads.presign.spec.ts` **pasan**. Residuo Bajo: el tope de tamaño solo se **fija en la
  firma si el cliente envía `contentLength`** (ver S-B3 abajo).
- **S-M1 (deps runtime) — MITIGADO.** `npm audit --omit=dev` en `backend/` pasó de **6 moderate a
  2 moderate** (0 high / 0 critical). Las cadenas `gaxios→uuid` (buffer bounds) y `file-type` (DoS
  parser) **se resolvieron**. Las 2 restantes son el **mismo** aviso de `@nestjs/core`
  (**CVE-2026-35515, SSE injection, moderate**) que **no es alcanzable** en este código (ver S-M1).

**No hay hallazgos Críticos ni Altos abiertos.** Guardarraíles de dinero/PII **sin regresión**
(verificados en §2). El resto de la deuda (S-B1, S-B2) sigue **aceptada con disparador** (§5).

**VEREDICTO (revisión de código estático): APROBADO.** La **fase dinámica (DAST/pentester contra
staging)** queda **pendiente y NO aprobada a ciegas** porque R2/Railway aún no están configurados
(§6). No se promueve a producción sin ella.

| Severidad | # | IDs / estado |
|---|---|---|
| Crítica | 0 | — |
| Alta | 0 | — |
| Media | 1 | S-M1 (**mitigado 6→2 moderate**; residuo no-alcanzable, aceptado) |
| Baja | 3 | S-B1 (aceptada), S-B2 (aceptada), S-B3 (**cerrado**, residuo Bajo aceptado) |
| Cerrados esta rev | 3 | **S-M2 (CORS)**, **S-B4 (helmet/algorithms/env)**, **S-B3 (presign)** |

---

## 1. Endurecimiento de producción — verificación por hallazgo (rev v1.3)

### S-M2 — CORS restringido a allow-list — **CERRADO · [Verificado en código]**
- `backend/src/main.ts:15-23` (`resolveCorsOrigins`) + `:47-50` — `app.enableCors({ origin:
  corsOrigins, credentials: true })`. **Ya no existe `origin: true`.**
- **Fallback evaluado (requisito del encargo):** sin `APP_BASE_URL`, devuelve **solo**
  `['http://localhost:3000','http://localhost:5173']`. **No abre a `*`** ni refleja el `Origin` del
  request → **fail-closed**. En staging/prod `APP_BASE_URL` debe fijarse; si se omitiera por error,
  el efecto es que CORS **bloquea** al frontend legítimo (rompe, no expone). Comportamiento seguro.
- **Nota de robustez (no bloqueante):** `env.validation.ts` **no** exige `APP_BASE_URL` en no-local;
  una omisión en staging degrada silenciosamente a orígenes localhost. Recomendación menor para
  **devops/backend**: añadir `APP_BASE_URL` a las env requeridas no-locales o loguear WARN explícito
  (ya se loguea la allow-list resultante en `:50`). No es hueco de seguridad.

### S-B4 — helmet + algorithms JWT + validación de env — **CERRADO · [Verificado en código]**
- **helmet:** `main.ts:29` `app.use(helmet())` (CSP default, HSTS, noSniff, frameguard, etc.).
- **algorithms fijados (algorithm-confusion):**
  - Firma: `auth.service.ts:47` (access) y `:54` (refresh) → `algorithm: 'HS256'`.
  - Verificación: `jwt-auth.guard.ts:37` y `auth.service.ts:183` (refresh) → `algorithms: ['HS256']`.
  - Efecto: `alg:none` y confusión RS↔HS quedan cerradas de forma explícita (antes dependía del
    comportamiento de la lib; ahora es defensa en profundidad afirmativa).
- **Validación de env SIEMPRE:** `env.validation.ts` cableada en `app.module.ts:31`
  (`ConfigModule.forRoot({ validate: validateEnv })`). Corre en **todo** arranque; en cualquier
  entorno **no-local** (incluye staging) exige `DATABASE_URL`, `JWT_ACCESS_SECRET`,
  `JWT_REFRESH_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` y **rechaza secretos JWT
  débiles** (<32 chars). En local no aborta (para no romper dev/CI sin secretos reales) — patrón
  consistente con seed/pii-crypto. Correcto.

### S-B3 — Presign `kyc_ine`: allow-list de content-type + tamaño — **CERRADO (residuo Bajo aceptado) · [Verificado en código + tests]**
- **Allow-list de content-type — efectiva y SIEMPRE:** `uploads.service.ts:67-74` normaliza a
  minúsculas y exige prefijo `image/`; rechaza `text/html`, `application/pdf`,
  `application/octet-stream` con **422 VALIDATION_ERROR**. **No se puede subir contenido arbitrario
  (HTML/binario) al bucket.** La extensión de la key se deriva del tipo ya validado (`:98`).
- **Límite de tamaño — efectivo cuando el cliente declara `contentLength`:** `:79-95` valida
  `0 < contentLength ≤ maxBytes` (default 10 MiB, dial `KYC_UPLOAD_MAX_BYTES`) y **fija
  `ContentLength` en la firma** (`:104`) → S3/MinIO rechaza el PUT si el cuerpo no coincide
  exactamente. El tope no depende solo de la buena fe del cliente **para ese caso**.
- **Servir sin ejecución:** `presignGet` (`:126-135`) fuerza `ResponseContentDisposition:
  'attachment'` → aunque un objeto fuera HTML, no se renderiza inline; y sale por GET prefirmado de
  vida corta (300 s) desde bucket **privado**.
- **Tests:** `test/uploads.presign.spec.ts` — **12/12 PASS** (ejecutado esta sesión): acepta
  `kyc_ine`+`image/*`, rechaza `inventory_photo`/`dispute_claim`/otros, rechaza no-imagen, valida
  tope por defecto y `KYC_UPLOAD_MAX_BYTES`, rechaza `contentLength` no positivo.
- **Residuo Bajo (aceptado, §5):** el tope de tamaño **solo se fija en la firma si el cliente envía
  `contentLength`** (campo opcional en el DTO). Si el cliente lo **omite**, la firma no lleva
  `ContentLength` y podría subir un archivo grande (abuso de almacenamiento) — el **content-type
  sigue restringido a `image/*`**, así que no hay subida de HTML/binario ni XSS. Impacto: abuso de
  storage, no ejecución. Cierre sugerido junto con la config de bucket en prod: exigir
  `contentLength` obligatorio o aplicar límite del lado de infra (policy de bucket). **Rol dueño:**
  **backend** (hacer `contentLength` obligatorio) + **devops** (límite/bucket privado en R2).

### S-M1 — Dependencias runtime backend — **MITIGADO (6→2 moderate) · residuo no-alcanzable, aceptado · [Verificado]**
- `npm audit --omit=dev` esta sesión: **2 moderate, 0 high, 0 critical** (antes 6 moderate). Las
  cadenas `gaxios→uuid` (buffer bounds, tocaba el login Google) y `file-type` (DoS parser) **ya no
  aparecen** → resueltas.
- **Las 2 restantes son el mismo aviso:** `@nestjs/core`/`@nestjs/platform-express` →
  **GHSA-36xv-jgw5-4q75 / CVE-2026-35515** (SSE injection, **moderate**, CVSS 6.3). Precondición de
  explotación: la app debe **usar SSE** y mapear datos influenciados por el usuario a los campos
  `type`/`id` de un `MessageEvent`. **`git grep` de `@Sse|SseStream|MessageEvent|text/event-stream`
  en `backend/src` → sin coincidencias.** El backend **no expone SSE** → el aviso **no es
  alcanzable** en este código.
- **Fix disponible solo con breaking change** (`@nestjs/core@11.2.1`, salto 10→11); instalado hoy:
  **10.4.22**. Dado que **no es alcanzable**, se **acepta** como deuda no bloqueante con disparador:
  bumpear a NestJS 11 (o al parche 11.1.18+) en la próxima ventana de mantenimiento, y **antes** de
  introducir cualquier endpoint SSE.
- **Severidad efectiva:** Baja (aviso Media no alcanzable). **Rol dueño:** **devops** (bump NestJS
  11 + gate `npm audit` en CI/SAST). Frontend: `critical`/`high` **solo en devDependencies**
  (`vitest`/`vite`), no van al bundle prod — sin cambio.

---

## 2. Guardarraíles previos — SIN regresión (re-verificado en código, v1.3)

El endurecimiento tocó `main.ts`, `auth.service.ts`, `jwt-auth.guard.ts`, `env.validation.ts` y
`uploads/*`; **no** tocó pagos, órdenes, buylist ni PII. Re-chequeados:

| Guardarraíl | Evidencia | Estado |
|---|---|---|
| **Reserva atómica anti doble-venta** | `orders.service.ts` — `updateMany` guardado por estado vendible + `count!==1 → ITEM_UNAVAILABLE` en `$transaction`. | OK |
| **Webhook Stripe: firma** | `stripe.service.ts` — `constructEvent(payload, sig, STRIPE_WEBHOOK_SECRET)`; raw body preservado en `main.ts:35-39` (intacto tras añadir helmet). | OK |
| **Webhook Stripe: idempotencia** | `payments.service.ts` — `ProcessedStripeEvent` guardia atómica (P2002 no-op); si el handler falla borra la marca y re-lanza. | OK |
| **Money-out solo super_admin** | `money-out.guard.ts` — rol != `super_admin` → `403 MONEY_OUT_FORBIDDEN` + audita. reveal-clabe/pay-spei/refund/recompra. | OK |
| **PII cifrada/enmascarada** | `schema.prisma` `*Enc`/`*Hmac`; enmascarado por defecto incl. `super_admin`; `reveal-clabe` único CLABE en claro (money-out + auditado); `vault_operator` proyección reducida. | OK |
| **Retención INE** | `jobs/ine-retention.service.ts` — purga objeto + limpia `ineFrontKey/ineBackKey` pasado `INE_RETENTION_DAYS`. | OK |
| **Login Google server-side** | `google-token-verifier` + `auth.service.ts` — firma/aud/iss/exp + `email_verified`; `role` siempre server-side. Firma JWT con `algorithm:'HS256'`. | OK |
| **Enum. por temporización login** | `auth.service.ts:95-101` — `argon2.verify` siempre contra `DUMMY_PASSWORD_HASH`; throttle 5/min. | OK |
| **Sync catálogo anti-inyección/SSRF** | `catalog-sync.service.ts` `SET_ID_PATTERN`; host fijo + `encodeURIComponent`. | OK |
| **Portfolio/holdings sin IDOR** | `userId` desde JWT (`@CurrentUser`), nunca de parámetro. | OK |
| **Presign solo kyc_ine** | `uploads.service.ts:57-62` — cualquier otro `purpose` → 422; controlador `@Roles(customer,vault_operator,super_admin)`. | OK |

---

## 3. Estado de todos los hallazgos (histórico consolidado)

| ID | Tema | Rev anterior | **Estado v1.3** | Rol dueño |
|---|---|---|---|---|
| S-M1 | Deps runtime backend | Media abierta (6 moderate) | **Mitigado** (2 moderate; residuo SSE no-alcanzable, **aceptado**) | devops |
| S-M2 | CORS `origin:true` + credentials | Media abierta | **CERRADO** (allow-list `APP_BASE_URL`, fallback fail-closed) | backend ✔ |
| S-B1 | Linking Google a cuentas back-office | Baja aceptada | **Aceptada** (sin cambio; disparador §5) | backend |
| S-B2 | Dinero en `Int` 32-bit | Baja aceptada | **Aceptada** (sin cambio; disparador §5) | arquitecto/backend |
| S-B3 | Presign sin allow-list tipo/tamaño | Baja abierta (reducida) | **CERRADO** (allow-list `image/*` + tope; residuo Bajo aceptado) | backend ✔ |
| S-B4 | helmet / algorithms / env prod-only | Baja abierta | **CERRADO** (helmet + HS256 fijo + env siempre + entropía) | backend ✔ |

---

## 4. Mínimo para aprobar producción (dinero/PII reales)

La parte **estática** de código ya **no bloquea** (0 críticos/altos; S-M2/S-B3/S-B4 cerrados). Para
la **promoción a producción** faltan, ahora, elementos de **infra y fase dinámica**:

1. **Fase dinámica (DAST) contra staging** — **PENDIENTE, obligatoria.** No ejecutable hoy (R2/
   Railway sin configurar). Debe correr CORS cross-origin real, abuso de presign con bucket real,
   concurrencia de checkout/buylist, y el escaneo ZAP/nuclei. **[devops habilita staging → pentester
   ejecuta DAST].**
2. **S-M1 (deps)** — bump NestJS a 11.1.18+/11.2.x + gate `npm audit` en CI **[devops]**. No
   alcanzable hoy, pero cerrarlo antes de exponer o de añadir SSE.
3. **S-B3 (residuo)** — `contentLength` obligatorio en el presign **[backend]** + **bucket INE
   privado en R2** con límite de tamaño a nivel de policy **[devops]**.
4. **Config env de staging/prod** — `APP_BASE_URL`, secretos fuertes (≥32) desde secret manager,
   `S3_*` reales; confirmar que ningún secreto aparece en logs **[devops]**.

S-B1 y S-B2 quedan como **deuda aceptada con disparador** (§5).

---

## 5. Deuda de seguridad aceptada (no bloqueante, con disparador)

| ID | Deuda | Impacto | Disparador |
|---|---|---|---|
| S-M1 | `@nestjs/core` CVE-2026-35515 (SSE injection) sin parchar (fix = major 10→11) | Ninguno hoy (backend no usa SSE) | Antes de introducir cualquier endpoint SSE, o en la próxima ventana de mantenimiento de deps. |
| S-B1 | Linking Google a cuentas back-office | Traslada seguridad de cuentas privilegiadas a Google | Antes de alta de cualquier back-office con email @gmail, o al habilitar más operadores. |
| S-B2 | Dinero en `Int` 32-bit | Overflow de integridad en agregados > ~MX$21.47M | Antes de que portafolios/P&L/custody agregados se acerquen a MX$21M, o antes de operar a escala. |
| S-B3 (residuo) | Tope de tamaño del presign solo se fija si el cliente envía `contentLength` | Abuso de almacenamiento (no ejecución: content-type ya restringido a `image/*`) | Cerrar junto con bucket INE privado en R2: `contentLength` obligatorio + límite de policy. |

---

## 6. Banderas para el humano (antes de operar con dinero real)

- **DAST/pentest dinámico contra staging — PENDIENTE Y OBLIGATORIO.** Esta rev es **estática/caja
  blanca**. Los vectores **[PoC pendiente de target — DAST]** (CORS cross-origin real, abuso de
  presign contra bucket real, concurrencia de checkout/buylist, DoS por deps) **no** se pudieron
  validar porque **R2/Railway aún no están configurados**. No se aprueba a ciegas: en cuanto haya
  staging autorizado, **devops habilita el entorno y pentester ejecuta el DAST** (ZAP/nuclei +
  scripts de concurrencia) antes de la promoción a producción.
- **Pentest de tercero + programa de bug bounty** antes del go-live con dinero real.
- **KMS / secret manager en producción**: `PII_ENCRYPTION_KEY`, `PII_HMAC_KEY`, `JWT_*`, `STRIPE_*`
  y `S3_*` del bucket de INE desde un secret manager (no `.env` ni imagen); rotación; sin secretos
  en logs/errores. `env.validation.ts` ya rechaza el arranque no-local sin secretos y secretos JWT
  débiles, pero la **provisión** del secret manager es de devops.
- **Validaciones legales de custodia/PII (INE/CLABE)**: figura de depositario, contrato de custodia,
  seguro del inventario, base legal de tratamiento del **INE almacenado**, retención
  `INE_RETENTION_DAYS`, acceso y borrado al vencer, y CLABE cifrada. Confirmar con contador/abogado.
- **Correo de evidencia de disputa** (`DISPUTE_EVIDENCE_CONTACT`, default `soporte@tcgvault.mx`) es
  **placeholder por confirmar por el humano**; debe apuntar a un buzón real monitoreado.
- **Cierre de infra (devops)**: bucket INE **privado** + lifecycle de retención + límite de tamaño;
  retirar el prefijo público muerto `inventory_photo/` del compose (config muerta, no hueco);
  `APP_BASE_URL` y secretos fuertes en staging/prod.

---

## 7. VEREDICTO

**Revisión de código estático: APROBADO.**

El **endurecimiento de producción** implementado por backend **cierra** los hallazgos que estaban
abiertos:
- **S-M2 (CORS): CERRADO** — allow-list desde `APP_BASE_URL`, `credentials:true`, **sin `origin:true`**
  y **fallback fail-closed** (nunca `*`).
- **S-B4 (helmet/algorithms/env): CERRADO** — `helmet()`, `HS256` fijado al **firmar y verificar**,
  validación de env **siempre** con chequeo de entropía de secretos JWT.
- **S-B3 (presign kyc_ine): CERRADO** — allow-list `image/*` (siempre) + límite de tamaño +
  `Content-Disposition: attachment`; **12/12 tests pasan**. Queda un **residuo Bajo aceptado** (tope
  de tamaño solo se fija si el cliente declara `contentLength`; content-type ya bloquea no-imagen).
- **S-M1 (deps): MITIGADO** — `npm audit --omit=dev` **6→2 moderate**; las 2 restantes son la SSE
  injection de `@nestjs/core` **no alcanzable** (backend sin SSE), **aceptada** con disparador.

**0 Críticos / 0 Altos abiertos** → no procede RECHAZO. Lo abierto es **1 Media mitigada/aceptada
(S-M1)** y **deuda Baja aceptada (S-B1, S-B2, residuo S-B3)**, nada bloqueante para la parte
estática ni para staging.

**PENDIENTE (no aprobado a ciegas): fase dinámica (DAST/pentester contra staging)** — bloqueada
hoy porque **R2/Railway no están configurados**. Es **requisito previo a producción**: devops
habilita staging y pentester ejecuta el DAST; recién entonces se re-emite veredicto para el
gate de promoción a prod.

**Enrutamiento restante:** **devops** → S-M1 (bump NestJS 11 + gate `npm audit`), habilitar staging
para DAST, bucket INE privado + límite de tamaño, `APP_BASE_URL`/secret manager; **backend** →
residuo S-B3 (`contentLength` obligatorio), (opc.) S-B1; **arquitecto/backend** → S-B2 (`BigInt`).
Nada vuelve a backend como bloqueante: los tres hallazgos que le tocaban (S-M2, S-B3, S-B4) están
**cerrados y verificados**.

---

# ANEXO rev v1.4 (2026-08-16) — Bloque nuevo: cotizador público + sync-all + admin M2/M6/M7/M9/M10

> **Alcance:** 3 endpoints backend nuevos (`GET /buylist/cards`, `GET /buylist/sets`,
> `POST /admin/catalog/sync-all`) + vistas admin de frontend (M2/M6/M7/M9/M10 y cotizador).
> **Modo:** revisión **estática** de código + `npm audit --omit=dev` + lectura de tests
> (`test/buylist-catalog.spec.ts`). Sin stack vivo → DAST sigue **pendiente** (§6).

## A.0 Resumen del bloque

El bloque nuevo llegó **endurecido**. Los tres endpoints backend tienen authz/throttle/auditoría
correctos y **no filtran datos sensibles**; las vistas admin son **defensa en profundidad** sobre un
backend que sigue siendo la autoridad. **0 Críticos / 0 Altos.** No hay hallazgos nuevos que
bloqueen. `npm audit` **sin cambios** (2 moderate, mismo aviso SSE no alcanzable).

## A.1 `GET /buylist/cards` y `GET /buylist/sets` (públicos) — **OK · [Verificado en código + tests]**
- **Anti-scraping:** `buylist-catalog.controller.ts:21,41` — `@Throttle({ ttl:60s, limit:60 })`,
  más estricto que el global de 300/min. `@Public()` (sin sesión, por diseño del cotizador).
- **Sin fuga de datos sensibles:** `searchAllCards`/`listSetsWithImportedCards`
  (`catalog.service.ts:241-293`) proyectan **solo catálogo público** vía `toCardDTO` (id,
  externalId, name, number, rarity, supertype, subtypes, setId/Name, imágenes) y set
  (id/name/series/releaseDate/year). **No** tocan `InventoryItem`, precios internos, costo, ni PII
  (test `buylist-catalog.spec.ts` afirma `inventoryItem.findMany` **no** se llama y que el DTO
  **no** trae `sellable`/`salePriceCents`). CardDTO ya era superficie pública en "Compra".
- **Validación de query / DoS:** `pageSize` acotado a `Math.min(100, …)` y `page` a `Math.max(1,…)`
  con `parseInt` tolerante (`controller.ts:34-36`). `setId`/`rarity`/`q` entran como filtros
  **parametrizados** de Prisma (`where.setId`, `where.rarity`, `contains … mode:'insensitive'`) →
  **sin SQLi**. Residuo trivial: `q` sin longitud máxima (ILIKE `%q%`); impacto nulo dado el tope de
  página + throttle. No es hallazgo.

## A.2 `POST /admin/catalog/sync-all` — **OK · [Verificado en código]**
- **Authz:** `AdminCatalogController` es `@Roles(Role.super_admin)` a nivel de clase; sin `@Public`,
  así que `JwtAuthGuard`→`RolesGuard` (globales, `app.module.ts:60-62`) exigen sesión y rol
  super_admin (rol tomado del JWT, nunca del cuerpo). `RolesGuard` niega con 403 FORBIDDEN.
- **Auditoría:** `admin-catalog.controller.ts:64-72` registra `catalog.sync_all` con `actorUserId`,
  `actorRole` y `{jobId,setsQueued,remaining}`.
- **Anti-abuso (single-flight):** `catalog-sync.service.ts:118,150-160` — flag `syncAllRunning`
  evita barridos paralelos; retorna 202 de inmediato (fire-and-forget). Upsert idempotente por
  `externalId` → re-llamar reanuda sin duplicar.
- **Sin SSRF/inyección:** el barrido itera sets **remotos** (`s.id` de pokemontcg.io, no del
  usuario); `getCardsBySet` usa `encodeURIComponent(\`set.id:${setId}\`)` + **host fijo**
  `https://api.pokemontcg.io/v2` (`pokemontcg-io.client.ts:47,72`). `sync-all` no acepta ningún
  parámetro del cliente. `sync`/`backfill` conservan `SET_ID_PATTERN`/`DATE_PATTERN`.
- **Nota multi-instancia (no bloqueante):** `syncAllRunning` y el throttler son **in-memory por
  proceso**. En despliegue multi-instancia, el single-flight y el rate-limit solo protegen por
  instancia (dos réplicas podrían disparar un barrido cada una). Los upserts idempotentes evitan
  corrupción; solo se duplica carga hacia pokemontcg.io. **Rol dueño: devops** (store compartido
  Redis para throttler + coordinación de jobs al escalar; ya anotado en `app.module.ts:34-35`).

## A.3 M6 Usuarios (frontend) — enmascarado PII + guardas — **OK · [Verificado en código]**
- **PII enmascarada:** `M6View.tsx:231-233` renderiza **solo** `currentKyc.clabeMasked` /
  `rfcMasked` (y `ineOnFile` booleano). El tipo `contract.ts:544-556` **no** define CLABE/RFC en
  claro → el frontend no tiene forma de exponer PII completa; el backend enmascara por defecto incl.
  super_admin (verificado §2, sin regresión). No hay INE keys ni datos KYC crudos en el DTO.
- **Guarda de rol:** `m6/page.tsx` envuelve `M6View` en `SuperAdminOnly`. La vista (y sus `useQuery`)
  **solo monta** si `isSuperAdmin` → no hay fetch prematuro de la ficha 360°.
- **Observación (no seguridad, para frontend/product):** el contrato permite a `vault_operator` ver
  M6 con **proyección reducida** (backend `AdminUsersController` = `@Roles(vault_operator,
  super_admin)`), pero la UI lo **bloquea por completo** con `SuperAdminOnly`. Es **más estricto**
  que el backend (safe: nunca expone de más), pero divergencia funcional respecto al contrato §M6.
  No es hueco de seguridad; se anota para que frontend/product decidan si operador debe ver la
  proyección reducida en UI.

## A.4 M7 Finanzas / M9 Reportes / M10 Config (frontend) — solo super_admin — **OK**
- `m7|m9|m10/page.tsx` envuelven la vista en `SuperAdminOnly`; la vista (con sus `useQuery`) solo
  monta para super_admin → sin fetch de finanzas/config para roles no autorizados. Backend autoridad:
  `AdminFinanceController`/`AdminReportsController` = `@Roles(super_admin)`
  (`admin.controller.ts:97,137`). `SuperAdminOnly` es **defensa de UI** (comentario propio lo
  reconoce), no sustituye al backend.
- **Export CSV (M7/M9):** `admin.service.exportCsv` (`admin.service.ts:233-246`) emite **solo
  valores numéricos (cents), IDs (CUID) y enums de estado** — **sin campos de texto libre
  controlados por el usuario** (no nombres de carta/usuario) → **sin vector de CSV formula
  injection**. Endpoints super_admin. `Content-Disposition: attachment`. OK.

## A.5 `npm audit --omit=dev` (backend) — **SIN CAMBIO**
- Esta sesión (2026-08-16): **2 moderate, 0 high, 0 critical** — el mismo aviso `@nestjs/core` /
  `@nestjs/platform-express` (GHSA-36xv-jgw5-4q75 / CVE-2026-35515, SSE injection). `git grep`
  de `@Sse|SseStream|MessageEvent|text/event-stream` en `backend/src` → **0 coincidencias**: el
  backend **no expone SSE**, aviso **no alcanzable**. Estado idéntico a v1.3 (S-M1, aceptado con
  disparador). El bloque nuevo **no** agregó dependencias con avisos.

## A.6 VEREDICTO del bloque nuevo

**Revisión de código estático (bloque cotizador + sync-all + admin M2/M6/M7/M9/M10): APROBADO.**
- 0 Críticos / 0 Altos. Endpoints públicos con throttle propio y **sin fuga** de inventario/precio/
  PII; `sync-all` super_admin + auditado + single-flight + sin SSRF; vistas admin gatadas
  (defensa en profundidad) con backend como autoridad; PII sigue enmascarada; `npm audit` sin cambio.
- **No hay hallazgos nuevos bloqueantes.** Deuda previa **sin cambio** (S-M1 aceptada; S-B1/S-B2 y
  residuo S-B3 aceptados con disparador, §5). Nota multi-instancia (A.2) → **devops** al escalar.
- **PENDIENTE, no aprobado a ciegas:** la **fase dinámica (DAST/pentester contra staging)** sigue
  bloqueada por infra (R2/Railway sin configurar). Requisito previo a producción (§6). En cuanto haya
  staging, ejecutar CORS cross-origin real, abuso de throttle del cotizador (scraping),
  concurrencia de `sync-all` multi-instancia y ZAP/nuclei.

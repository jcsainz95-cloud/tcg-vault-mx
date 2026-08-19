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

---

# ANEXO rev v1.5 (2026-08-16) — Bloque v1.3.1: reset-password admin, borrado híbrido, revocación de sesiones, precio por rareza, M2 buylist-rules/rarities

> **Alcance:** superficies nuevas del bloque v1.3.1: `POST /admin/users/:id/reset-password`,
> `DELETE /admin/users/:id` (hard/soft), revocación por `tokenVersion` en `JwtAuthGuard` + auth,
> precio de buylist por **rareza** (`common/money.ts` `quoteAcquisition` + `buylist.service.ts`),
> y los endpoints M2 `PUT/GET /admin/pricing/buylist-rules` y `GET /admin/pricing/rarities`.
> **Modo:** revisión **estática** de código + `npm audit --omit=dev`. Sin stack vivo → DAST sigue
> **pendiente** (§6). Blanco autorizado: staging/local.

## B.0 Resumen del bloque
Bloque **endurecido**. Los cinco focos del encargo se verificaron **OK en código**; **0 Críticos /
0 Altos**. `npm audit --omit=dev` **sin cambio** (2 moderate, mismo aviso SSE `@nestjs/core` **no
alcanzable** — 0 coincidencias de `@Sse|MessageEvent|text/event-stream` en `backend/src`). No hay
hallazgos nuevos bloqueantes. Deuda previa sin cambio (S-M1 aceptada; S-B1/S-B2/residuo S-B3
aceptados, §5).

## B.1 Reset de contraseña admin — **OK · [Verificado en código]**
- **AuthZ:** `admin.controller.ts:99-113` `@Roles(super_admin)` a nivel de método (además del
  `@Roles(vault_operator, super_admin)` de clase → el método restringe a super_admin). `RolesGuard`
  global es la autoridad.
- **Temp password nunca persistida en claro ni logueada:** `admin.service.ts:171-190` genera
  `randomBytes(18).toString('base64url')` (144 bits de entropía), la **hashea con argon2** y persiste
  **solo el hash**. `git grep tempPassword` → únicamente generación/hash/retorno; **no** aparece en
  logger, AuditLog ni respuesta persistida. La **única exposición** es el cuerpo de la respuesta HTTP
  (una vez). El AuditLog (`controller.ts:104-111`) registra `user.reset_password` con actor+target,
  **sin** before/after → la contraseña **no** entra a la bitácora.
- **Revocación de sesiones:** `tokenVersion: { increment: 1 }` (`:186`) invalida access/refresh
  previos (ver B.3). `mustChangePassword: true` fuerza cambio en el próximo login.
- **Cuenta borrada:** rechaza reset sobre `status==='deleted'` con `USER_DELETED` (`:174-176`).

## B.2 Borrado híbrido hard/soft — **OK · [Verificado en código]** (1 residuo Bajo + 1 bandera legal)
- **CANNOT_DELETE_SELF:** `admin.service.ts:214-216` → `409` si `id===actorUserId`. **Antes** de
  cualquier lectura/escritura. Idempotente sobre cuentas ya `deleted` (`:224-226`).
- **Purga de INE en R2 en AMBOS modos:** `purgeIne` (`:238`) corre antes de decidir hard/soft →
  el dato de máxima sensibilidad se elimina siempre.
- **Hard (sin transacción):** solo cuando NO hay filas económicas (`orders+sellRequests+shipments+
  disputes+ownedItems === 0`, `:228-235`) → `user.delete` con cascada (KYC/Billing/Address/Snapshot).
- **Soft (transacción):** anonimización **efectiva** de PII directa — `kycProfile` pone a `null`
  `clabeEnc/clabeHmac/rfcEnc/legalName/ineFrontKey/ineBackKey` (`:249-259`); `billingProfile`,
  `address` y `portfolioSnapshot` se **eliminan** (`:263-265`); `user` reescribe
  `email=deleted+<uuid>@anon.invalid`, `name='Usuario eliminado'`, `phone/avatarUrl/googleId/
  passwordHash=null` y `tokenVersion++` (`:266-281`). No quedan restos de PII **directa** en las
  tablas de perfil. Auditado con `{mode}` únicamente (`controller.ts:123-130`), sin volcar PII.
- **Bandera legal (no bloqueante, para el humano):** por diseño (PROJECT "conserva filas económicas
  por integridad legal") las filas retenidas conservan **snapshots** que pueden contener PII:
  `Order.billingSnapshot` (JSON del perfil fiscal — `rfcEnc` cifrado, pero nombre/razón social y
  domicilio fiscal pueden ir en claro dentro del JSON) y `SellRequest.clabeSnapshotEnc` (CLABE
  **cifrada**). El `userId` se conserva (seudonimización). **No es defecto de código** — es la
  retención económica documentada — pero el **derecho de supresión (LFPDPPP)** no alcanza a esos
  snapshots. Debe confirmarse con abogado/contador la base legal y el plazo de retención (se suma a
  la bandera de PII de §6). **Rol dueño (si se decide minimizar):** backend/arquitecto.
- **Residuo Bajo (aceptado):** en **hard delete**, `purgeIne` traga el error de R2 (lo loguea,
  `:199-201`) y continúa con `user.delete`; si el borrado del objeto R2 falla, la fila y las
  `ineFrontKey/ineBackKey` se pierden por cascada → **objeto INE huérfano** en el bucket con las
  keys perdidas (el job de retención ya no lo alcanza). Impacto: dato cifrado huérfano, no expuesto
  (bucket privado). **Disparador:** cerrar con lifecycle/retención a nivel de bucket en R2
  **[devops]**; opcional, reordenar para exigir purga R2 antes del delete **[backend]**.

## B.3 Revocación de sesiones (`tokenVersion`) — **OK · [Verificado en código]**
- **Guard:** `jwt-auth.guard.ts:52-63` — tras verificar la firma (HS256 fijo, `:45`), consulta
  `User.status` + `tokenVersion` y rechaza con `401` si `!user || status∈{blocked,deleted} ||
  payload.tv !== user.tokenVersion`. Un reset/soft-delete (que hacen `tokenVersion++`) invalida
  **todos** los access tokens vivos de inmediato.
- **Refresh:** `auth.service.ts:190-199` aplica la **misma** guardia (status + `tv`) → un refresh
  con versión previa ya no renueva.
- **Login / Google:** `login` (`:111-113`) y `google` (`:139-141`, `:176-178`) rechazan
  `blocked`/`deleted` con `USER_BLOCKED` (mismo code, sin revelar motivo). El account-linking de
  Google también corta en cuentas `blocked/deleted` antes de enlazar. Los tokens nuevos embeben el
  `tv` vigente (`issueTokens`, `:46`).
- **Nota (no seguridad):** el guard añade **un `findUnique` por request autenticado**. Correcto para
  revocación inmediata; a escala, considerar cache corto. No es hueco.

## B.4 Precio de buylist por rareza (SEC-A1) — **OK · [Verificado en código]**
- **Derivación server-side:** `money.ts:66-89` `quoteAcquisition(rarity, ref, rules, fallbackPct)`
  resuelve la regla por **exact match sobre `Card.rarity`**; `buylist.service.ts:116,122,131` toma
  `card.rarity` de la carta real (`prisma.card.findUnique`), **no** del DTO. El cliente ya **no**
  envía `category` (`:17` comentario + DTO). Un DTO malicioso **no puede inflar** `quotedTotalCents`.
- **fixed** no depende de referencia (siempre cotiza); **pct** sin referencia → `precio_pendiente`
  + escala al dueño (`:123-124`) — no se descarta ni se paga de más. Regla aplicada snapshotea
  `rarity/ruleMode/ruleValue/ruleSource` para auditoría.

## B.5 Endpoints M2 buylist-rules / rarities — **OK · [Verificado en código]**
- **AuthZ:** `PricingController` (`pricing.controller.ts:50-51`) `@Roles(super_admin)` a nivel de
  clase → `buylist-rules` (GET/PUT), `rarities`, `rarity-map` heredan super_admin.
- **Validadores:** `PUT buylist-rules` (`:144-176`) llama `validateBuylistRules` +
  `validateFallbackPct` (`settings.constants.ts:100-124`): `fixed → entero ≥ 0` (centavos),
  `pct → número en [0,100]`, `fallbackPct → [0,100]`; error → `422 VALIDATION_ERROR`. No se pueden
  meter reglas absurdas (negativos, pct>100, mode inválido).
- **Auditoría:** registra `pricing.buylist_rules.update` con **before/after** (`:168-174`). Surte
  efecto sin redeploy (persistido en `ConfigSetting`). `rarities` (`:183-203`) solo lee catálogo
  (`groupBy rarity`) + reglas; sin fuga de datos sensibles.

## B.6 `npm audit --omit=dev` (backend) — **SIN CAMBIO**
- Esta sesión (2026-08-16): **2 moderate, 0 high, 0 critical** — mismo aviso `@nestjs/core` /
  `@nestjs/platform-express` (GHSA-36xv-jgw5-4q75 / CVE-2026-35515, SSE injection). `git grep` de
  `@Sse|SseStream|MessageEvent|text/event-stream` en `backend/src` → **0 coincidencias** → **no
  alcanzable**. Idéntico a v1.3/v1.4 (S-M1, aceptado con disparador; fix = major NestJS 10→11).

## B.7 VEREDICTO del bloque v1.3.1

**VEREDICTO seguridad (revisión estática): APROBADO.**
- **0 Críticos / 0 Altos.** Reset-password (super_admin, argon2, temp password nunca
  logueada/persistida en claro/auditada, `tokenVersion++`), borrado híbrido (CANNOT_DELETE_SELF,
  INE purgado en ambos modos, anonimización efectiva de PII directa, auditado), revocación por
  `tokenVersion` (guard + login/google/refresh rechazan viejos/`deleted`/`blocked`), precio por
  rareza server-side (SEC-A1 intacto) y endpoints M2 (super_admin + auditados + validadores
  pct[0,100]/fixed≥0) están **correctos**.
- **Deuda/banderas no bloqueantes:** bandera legal sobre PII en snapshots económicos retenidos
  (`Order.billingSnapshot` / `SellRequest.clabeSnapshotEnc`) frente al derecho de supresión — a
  validar con abogado; residuo Bajo del INE huérfano en hard delete si falla la purga R2 (cerrar con
  lifecycle de bucket, devops). S-M1/S-B1/S-B2/residuo S-B3 sin cambio (§5).
- **PENDIENTE, no aprobado a ciegas:** la **fase dinámica (DAST/pentester contra staging)** sigue
  bloqueada por infra (R2/Railway sin configurar). Requisito previo a producción (§6): abuso de
  reset/delete concurrente, revocación de sesión en caliente, y ZAP/nuclei.

---

# C. Revisión v1.4-finance — Costo real de paquetería en el P&L (M-16)

> **Fecha:** 2026-08-16. **Modo:** revisión estática de código + lectura de migración M-16
> (working tree, SIN commitear). **Alcance:** `shipments.dto.ts`, `shipments.service.ts`,
> `admin-shipments.controller.ts`, `admin.service.ts` (`pnl()`/`exportCsv()`), `schema.prisma` +
> migración `20260816140000_m16_shipping_cost`, y el frontend M4 (`M4View.tsx`, `api.ts`,
> `contract.ts`). Blanco autorizado: código y staging/local.

## C.0 Resumen — 0 Críticos / 0 Altos; 1 Media (fuga de margen), 2 Bajas aceptadas

| Severidad | # | ID |
|---|---|---|
| Crítica | 0 | — |
| Alta | 0 | — |
| Media | 1 | **SEC-C1** (fuga de `shippingCostCents` a endpoints de cliente) |
| Baja | 2 | SEC-C2 (sin `@Max` / overflow Int32), SEC-C3 (SoD: `vault_operator` escribe insumo del P&L) |

## C.1 Autorización — CORRECTA (verificado en código)
- `POST /admin/shipments/:id/tracking` → `AdminShipmentsController` con
  `@Roles(vault_operator, super_admin)` a nivel de clase (`admin-shipments.controller.ts:13`).
  Un `customer` NO alcanza la captura de `shippingCostCents`. Consistente con el modelo M4.
- `GET /admin/finance/pnl` → `@Roles(super_admin)` a nivel de clase
  (`admin/*.controller.ts:136-137`). El P&L es **solo super_admin**. `GET /admin/reports`
  (exportCsv) también `@Roles(super_admin)` (`:176-177`). Correcto.
- El campo NO es "dinero saliente": es un registro contable de costo ya pagado al carrier
  fuera de banda, no un movimiento de fondos. Que NO pase por `MoneyOutGuard` es correcto.

## C.2 Integridad financiera — CORRECTA en el eje de entrada
- `shippingCostCents` SOLO se escribe vía el endpoint admin (`setTracking`,
  `shipments.service.ts:262-274`). Un cliente NO puede inyectarlo: el `ValidationPipe` global
  (`main.ts:43`, `whitelist:true`) descarta campos no declarados en los DTO de cliente
  (`CreateShipmentDto`/`ShipmentQuoteDto` no incluyen el campo). No hay vía de manipulación del
  P&L por el cliente.
- Validación `@IsOptional @IsInt @Min(0)` (`shipments.dto.ts:24`): bloquea negativos (no se puede
  inflar `profitCents` con un costo negativo) y no-enteros. `pnl()` **resta**
  `shippingCostCents` (`admin.service.ts:325`); un negativo habría inflado la ganancia — el `@Min(0)`
  lo cierra. Correcto.
- Idempotencia/editabilidad: si se re-captura tracking omitiendo el costo, `setTracking` NO toca la
  columna (spread condicional `:273`) y la auditoría registra `res.shippingCostCents` (valor
  **persistido real**, no el DTO) → el log refleja el estado verdadero. Correcto.

## C.3 Auditoría — CORRECTA
- `admin-shipments.controller.ts:73-84` registra `actorUserId`, `actorRole`, `action`
  (`shipment.tracking`), `entityId` y `after.shippingCostCents` = valor persistido. Quién + qué +
  (timestamp del AuditLog) quedan trazados. Bien.

## C.4 Mass assignment / migración — SIN vector
- `whitelist:true` en el pipe global neutraliza mass-assignment de entrada.
- Migración M-16: `ADD COLUMN "shippingCostCents" INTEGER NOT NULL DEFAULT 0` — aditiva,
  `@default(0)` cubre filas históricas sin backfill; no abre vector.

## SEC-C1 (Media) — Fuga de `shippingCostCents` (dato de margen) a endpoints de CLIENTE
- **Vector:** Exposición de dato interno de negocio (margen) a usuario autenticado no-admin.
- **Ubicación:** `shipments.service.ts:158-165` (`listMine` → `GET /shipments`) y `:167-174`
  (`getMine` → `GET /shipments/:id`) devuelven la **fila Prisma cruda** de `ShipmentRequest`, que
  tras M-16 incluye `shippingCostCents`. **No hay `ClassSerializerInterceptor` ni `@Exclude` en el
  código** (grep = 0) ni `select`/proyección → la respuesta JSON al cliente **incluye el costo real
  que la plataforma paga al carrier**. El cliente ya ve `shippingFeeCents` (lo que paga), de modo que
  puede **derivar el margen de envío de la plataforma** para sus propios envíos.
- **Contradice el contrato:** el propio DTO/migración/`contract.ts` declaran el campo "**Interno
  (no se expone al cliente)**" (`shipments.dto.ts:22`, `contract.ts` `ShipmentTrackingRequest`). El
  frontend no lo pinta, pero la API sí lo entrega (visible en Network/llamada directa).
- **Alcance/impacto:** limitado a los **propios** envíos del cliente (`getMine`/`listMine` filtran por
  `userId`; sin harvest masivo, sin PII, sin escalada, sin fraude de fondos). Solo aparece en envíos
  con costo ya capturado (default 0). Nota: `processingFeeCents` (fee Stripe) **ya se fuga por el
  mismo mecanismo** — M-16 suma a esa superficie un campo declarado explícitamente interno.
- **Severidad:** **Media** (info disclosure de dato de margen; no bloqueante por política, pero
  incumple una garantía explícita del contrato → debe cerrarse antes de operar con clientes reales).
- **Rol dueño:** **backend** — proyectar la salida de `listMine`/`getMine` con `select` explícito que
  excluya `shippingCostCents` (idealmente también `processingFeeCents`) o introducir un
  `ClassSerializerInterceptor` + DTO de respuesta con `@Exclude`. (No lo corrige seguridad.)

## SEC-C2 (Baja, aceptada con disparador) — `@Min(0)` sin `@Max` + `Int32` de 32 bits
- **Ubicación:** `shipments.dto.ts:24` (`@Min(0)` sin `@Max`) + `schema.prisma:525`
  (`shippingCostCents Int`). Un `vault_operator` puede capturar un valor absurdo por error;
  valores hasta ~MX$21.47M/envío distorsionan el P&L en silencio, y > 2^31 desbordan el `Int` de
  Postgres (error de escritura). Insumo de **rol confiable** + **auditado** → riesgo Bajo.
- **Rol dueño:** **backend** (cota superior razonable por envío). Se enlaza con el hallazgo del
  pentester **B-2** (evaluar `BigInt` para agregados de dinero) — mismo dueño/decisión.

## SEC-C3 (Baja, aceptada) — Segregación de funciones: `vault_operator` escribe insumo del P&L
- `vault_operator` puede fijar `shippingCostCents`, que alimenta el P&L (solo-lectura de
  `super_admin`). Puede reducir la ganancia reportada inflando el costo. Mitigado: cada captura es
  **auditada** (quién/cuándo/valor) y el P&L lo revisa `super_admin`. Consistente con el modelo M4
  (el operador ya es dueño de envíos/guías). Residuo Bajo aceptado; decisión de producto si se desea
  SoD más estricta. **Rol dueño:** backend/producto (opcional).

## C.5 VEREDICTO v1.4-finance: **APROBADO**
- **0 Críticos / 0 Altos abiertos** → aprobable por política (`CLAUDE.md` §7). Autorización,
  integridad de entrada, auditoría y anti-mass-assignment del cambio son **correctas**.
- **Condición de cierre (no bloqueante por severidad, pero exigible antes de GA con clientes
  reales):** cerrar **SEC-C1** (dejar `shippingCostCents` fuera de las respuestas de cliente) para
  honrar la garantía del contrato "no se expone al cliente". Ruteado a **backend**.
- **Deuda aceptada:** SEC-C2 (cota `@Max`/`BigInt`, junto a B-2) y SEC-C3 (SoD) con disparador.
- **Bandera para el humano:** verificar que ningún tablero/exportación de cliente ni logs de acceso
  reflejen el margen expuesto por SEC-C1 mientras no se proyecte la salida.

---

## C.6 RE-VERIFICACIÓN (2026-08-16) — SEC-C1 y SEC-C2 tras corrección de backend (working tree, sin commitear)

> **Modo:** revisión estática + ejecución de `test/shipments.tracking-cost.spec.ts` (**12/12 PASS**).
> **Alcance:** `shipments.service.ts` (`toClientShipment`/`listMine`/`getMine`/`adminList`/`adminGet`),
> `dto/shipments.dto.ts` (`@Max`), cruce con `API_CONTRACT §5` y `§M4`.

### SEC-C1 — Fuga de `shippingCostCents` a endpoints de CLIENTE — **CERRADO** ✔ · [Verificado en código + tests]
- **Proyector allowlist:** `shipments.service.ts:166-185` `toClientShipment()` construye el objeto de
  salida con una **allowlist explícita** de 14 campos declarados para el comprador (id, status,
  addressSnapshot, shippingFeeCents, ivaCents, processingFeeCents, totalCents, carrier, trackingNumber,
  requestedAt, pickingAt, shippedAt, deliveredAt, items). **No es denylist/omit**: un campo interno
  futuro del modelo NO se filtra por accidente. Robusto.
- **`shippingCostCents` fuera:** NO está en la allowlist → la salida de cliente ya **no** incluye el
  costo interno del carrier. Test `getMine`/`listMine` afirman `not.toHaveProperty('shippingCostCents')`.
- **`stripePaymentIntentId` también fuera:** confirmado — la allowlist lo excluye (antes se fugaba por la
  fila cruda); test afirma `not.toHaveProperty('stripePaymentIntentId')`. Reduce superficie adicional. Bien.
- **`processingFeeCents` DENTRO — decisión correcta por contrato §5:** `API_CONTRACT.md:153-154,311,340`
  define `BreakdownDTO = { subtotalCents, ivaCents, ivaRatePct, processingFeeCents, totalCents, currency }`
  y el comprador **ya lo ve** en el breakdown de `quote`/`create` (es un **cargo que el comprador paga**
  vía gross-up, no margen interno). Mantenerlo en la proyección de envío es **consistente**, no una fuga.
  Confirmado correcto.
- **Aplicado a ambos endpoints de cliente:** `listMine` (`GET /shipments`, `:193` → `rows.map(toClientShipment)`)
  y `getMine` (`GET /shipments/:id`, `:202`). Cubierto.
- **ADMIN sin romper:** `adminList` (`:207-221`) y `adminGet` (`:223-230`) devuelven la **fila cruda**
  (con `shippingCostCents`); `AdminShipmentsController` es `@Roles(vault_operator, super_admin)`. La
  funcionalidad admin (P&L/costos) se conserva. El `POST /:id/tracking` sigue auditando `res.shippingCostCents`.
- **Sin vector nuevo:** `getMine` mantiene el chequeo de ownership **antes** de proyectar
  (`:201` `if (!shipment || shipment.userId !== userId) throw notFound()`); el proyector no altera authz.
  Test "getMine still enforces ownership (404 for another user)" lo cubre. `listMine` filtra por `userId`.
  Ningún otro endpoint de cliente reintroduce el campo.

### SEC-C2 — Tope `@Max` / overflow Int32 — **CERRADO** ✔ · [Verificado en código + tests]
- **Cota aplicada:** `dto/shipments.dto.ts:7,30` — `SHIPPING_COST_MAX_CENTS = 100_000_00` (MX$100,000 en
  cents) con `@IsOptional() @IsInt() @Min(0) @Max(SHIPPING_COST_MAX_CENTS)`. El tope (10,000,000) está
  **muy por debajo** del máximo de Int32/Postgres (2,147,483,647) → sin overflow y sin distorsión silenciosa
  del P&L por captura absurda. Holgado para el costo real de un envío.
- **Test de frontera:** cubre boundary (acepta `SHIPPING_COST_MAX_CENTS`, rechaza `+1`), además de
  negativos y no-enteros. `test/shipments.tracking-cost.spec.ts` — **12/12 PASS** (ejecutado esta sesión).
- **Enrutamiento previo (S-B2/B-2 `BigInt`):** sigue como **deuda aceptada** para agregados de dinero a
  escala (§5). El `@Max` cierra el vector por-envío de SEC-C2; no sustituye la decisión de `BigInt` para
  agregados, que es de arquitecto/backend.

### Estado y veredicto de la re-verificación
| ID | Sev. original | Estado v1.4-finance | Estado tras corrección |
|---|---|---|---|
| SEC-C1 | Media (info disclosure de margen) | Abierto (condición de cierre pre-GA) | **CERRADO** ✔ (allowlist `toClientShipment`) |
| SEC-C2 | Baja (aceptada c/disparador) | Aceptada | **CERRADO** ✔ (`@Max` + tests) |

**VEREDICTO v1.4-finance (re-emitido): APROBADO — se mantiene.**
- **0 Críticos / 0 Altos.** SEC-C1 (única Media del bloque) y SEC-C2 quedan **cerrados y verificados en
  código + tests**; la corrección **no introdujo vector nuevo** (ownership intacto, admin no roto, allowlist
  robusta ante campos futuros, `stripePaymentIntentId` también protegido).
- **Nada vuelve a backend como bloqueante** por este bloque. Queda solo **SEC-C3** (SoD: `vault_operator`
  captura el costo) como **deuda Baja aceptada** con disparador (auditado + P&L revisado por super_admin) —
  decisión de producto, no bloqueante.
- **Sin cambio** en las banderas globales: la **fase dinámica (DAST contra staging)** sigue pendiente y es
  requisito previo a producción (§6); pentest de tercero + validación legal de custodia/PII antes del
  go-live con dinero real.

---

## rev v1.5-auth-email (2026-08-16) — Verificación de correo + recuperación self-service

> **Rol:** seguridad (blue team). **Alcance de esta revisión:** feature de correo v1.5 en el **working
> tree, SIN COMMITEAR** — verificación de email + recuperación de contraseña por token (Resend). Archivos:
> `auth-token.service.ts`, `auth.service.ts`, `auth.controller.ts`, `dto/auth.dto.ts`, `modules/mail/*`,
> `guards/email-verified.guard.ts`, `guards/jwt-auth.guard.ts`, `schema.prisma` (AuthToken), migración M-17,
> `config/env.validation.ts` y pantallas de auth del frontend.
> **Modo:** revisión **estática** de código (sin stack vivo). Vectores que exigen instancia = **[PoC
> pendiente de target — DAST]**; verificados por lectura = **[Verificado en código]**.
> **Nota:** `docs/PENTEST_NOTES.md` es del pase v1.1 y **no cubre** la feature v1.5 (posterior). Esta sección
> es revisión blue-team propia de la superficie nueva; no duplica hallazgos del pentester.

### 0. Resumen ejecutivo

La feature v1.5 **llega bien construida** y con los controles correctos en su núcleo. Confirmados **[Verificado
en código]**:
- **Tokens:** el claro es **32 bytes CSPRNG** (`crypto.randomBytes(32).toString('base64url')`, **no**
  `Math.random`); en BD vive **solo el SHA-256** (`hashAuthToken`), nunca el claro; el token viaja **solo por
  correo** (no en respuestas API ni en logs de app). Consumo **atómico de un solo uso**: `consume()` hace
  `updateMany({ where: { tokenHash, type, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } })`
  y exige `count>0` **antes** de resolver el `userId` → cierra la carrera de doble-uso (dos requests con el
  mismo token: solo una obtiene `count=1`). **TTL correctos y server-side:** verif 24h / reset 1h
  (`AUTH_TOKEN_TTL_MS`), validados por `expiresAt > now` en el propio `updateMany`. **Rotación:** al emitir
  (`issue()`) se invalidan los previos no usados del mismo tipo (`updateMany usedAt=now`) → solo el último
  link vale.
- **Gating server-side REAL y no evadible:** `EmailVerifiedGuard` es `APP_GUARD` global, corre **después** de
  `JwtAuthGuard` (que puebla `req.user.emailVerified` **leyéndolo fresco de BD** en cada request) y **antes**
  de `MoneyOutGuard` (orden declarado en `app.module.ts:63-67`). `@RequireEmailVerified()` está aplicado en
  los **exactos 3 endpoints** del contrato: `POST checkout/session` (`orders.controller.ts:22`),
  `POST shipments` (`shipments.controller.ts:21`) y `POST buylist/requests` (`buylist.controller.ts:24`). Los
  `*/quote` read-only **no** se bloquean (correcto). Un `customer` sin verificar **no** puede crear
  orden/envío/sell-request por llamada directa a la API → `403 EMAIL_NOT_VERIFIED`. **No hay bypass por UI.**
- **Anti-enumeración:** `forgot-password` responde **SIEMPRE 200** (`{ ok: true }` incondicional en
  `auth.service.ts:217`); `verify-email/resend` es **autenticado y sin body** (usa `req.user`, cero
  enumeración). Login mantiene la mitigación de timing con `DUMMY_PASSWORD_HASH`. El frontend
  (`ForgotPasswordView.tsx`) muestra **mensaje genérico** siempre y solo distingue `429`.
- **Reset de contraseña:** **misma política** que registro (`ResetPasswordDto.password @MinLength(8)`);
  `tokenVersion: { increment: 1 }` → **revoca sesiones vivas** (verificado en `jwt-auth.guard.ts:61` y
  `refresh` :361: rechazan `tv` previo); `emailVerified=true` tras reset (el clic prueba control del inbox,
  decisión de producto documentada). **No** devuelve tokens: el usuario re-inicia sesión. Consumo atómico.
- **Adaptador Resend:** API key **desde env** (`RESEND_API_KEY`, `mail.module.ts:24`), **no hardcodeada** y
  **no logueada** (solo se loguea `error.name/message`). El **link se ancla a `APP_BASE_URL`**
  (`buildFrontendLink`, server-side config) — **no** al `Host`/header de la request → **sin host-header
  injection** en el link. El token se `encodeURIComponent`. `env.validation` exige `RESEND_API_KEY` en
  no-local (Noop solo en dev/CI).
- **Rate-limiting:** `forgot-password` 3/h/IP (`@Throttle` ctrl) **+ tope 3/h/email** en servicio
  (`countIssuedLastHour`, cuenta por `createdAt` — no evadible por rotación de token); `resend` 3/h/usuario
  (servicio) + 10/h/IP backstop; `verify-email`/`reset-password` 10/min/IP (token de 256 bits → no
  fuerza-brutable). Defensa suficiente contra spam de correos y abuso.

**Hallazgos nuevos:** **0 Críticos / 0 Altos.** Un solo defecto de código real (inyección en plantilla HTML,
**Baja**) y tres endurecimientos de defensa-en-profundidad (**Baja**). Nada bloqueante para la feature v1.5.

| Severidad | # (v1.5) | IDs |
|---|---|---|
| Crítica | 0 | — |
| Alta | 0 | — |
| Media | 0 | — |
| Baja | 4 | S15-B1 … S15-B4 |
| Info/positivo | — | ver §0 |

### 1. Hallazgos priorizados

#### S15-B1 (Baja) — Inyección HTML en el cuerpo del correo: `name` del usuario sin escapar · [Verificado en código]
- **Ubicación:** `backend/src/modules/mail/mail.templates.ts:41,43,51,53,65,67,75,77` — el `name` del usuario
  se interpola **sin escapar** en el HTML (`<p>Hola ${name}:</p>` / `Hi ${name},`) y en el `text`. El `name`
  viene de `RegisterDto.name` (`@IsString() @MinLength(1)`, **sin sanitización**).
- **Evidencia/PoC:** registrar con `name = '<img src=x onerror=alert(1)>'` (o markup arbitrario) inyecta ese
  HTML en el cuerpo del correo de verificación/reset. **Impacto acotado:** el correo se envía **solo a la
  propia dirección del usuario** (`user.email`), por lo que es esencialmente self-injection, y los clientes de
  correo modernos neutralizan `<script>`/`onerror`. No obstante es un defecto de inyección real (el brief lo
  pide explícito) y habilita HTML/estilos/enlaces arbitrarios en un correo con la marca **TCG Vault MX**
  (potencial abuso de reputación / plantilla de phishing con dominio propio si el `name` se reusara en correos
  a terceros a futuro). El `link` **sí** es seguro (server-built + `encodeURIComponent`).
- **Rol dueño:** **backend** (escapar HTML de `name` —y de cualquier dato de usuario— antes de interpolarlo en
  la plantilla; p. ej. un `escapeHtml()` en `mail.templates.ts`, o validar `name` con allow-list en el DTO).

#### S15-B2 (Baja) — Enumeración por temporización en `forgot-password` · [Verificado en código]
- **Ubicación:** `backend/src/modules/auth/auth.service.ts:195-218`.
- **Evidencia:** con email **inexistente** el método retorna casi inmediato; con email **existente y activo**
  ejecuta escrituras en BD (`issue`) y **`await` del envío por Resend** (llamada de red) antes de responder.
  Aunque la respuesta HTTP es idéntica (200), la **latencia** difiere de forma medible → canal de
  enumeración. **Mitigantes:** rate-limit 3/h/IP (solo ~3 muestras/hora por IP) y que el registro **ya**
  filtra existencia vía `409 EMAIL_TAKEN` (canal preexistente, aceptado). Riesgo residual bajo.
- **Rol dueño:** **backend** (opcional, defensa-en-profundidad: mover el envío a un flujo asíncrono/desacoplado
  del request, o normalizar el tiempo de respuesta, para que exista/no-exista tarden igual).

#### S15-B3 (Baja) — Token en la URL: posible fuga por Referer/historial · [Verificado en código]
- **Ubicación:** links `${APP_BASE_URL}/<locale>/verify-email|reset-password?token=<claro>`
  (`auth.service.ts:71`); pantallas `VerifyEmailView.tsx` / `ResetPasswordView.tsx` reciben el token del query.
- **Evidencia:** el token en claro viaja en el query string (inevitable: el link debe ser clicable desde el
  correo), pero puede quedar en historial del navegador, logs de servidor/proxy y en cabeceras `Referer` hacia
  recursos de terceros que cargue la página. **Mitigantes fuertes:** un solo uso + TTL corto (reset 1h) +
  rotación reducen la ventana. Práctica estándar de la industria; residual bajo.
- **Rol dueño:** **frontend** (defensa-en-profundidad: `history.replaceState` para retirar `?token=` de la URL
  tras consumirlo, y/o `Referrer-Policy: no-referrer` en estas rutas).

#### S15-B4 (Baja) — `reset-password` no revalida el estado de la cuenta al consumir · [Verificado en código]
- **Ubicación:** `backend/src/modules/auth/auth.service.ts:225-251` (`resetPassword`).
- **Evidencia:** `forgot-password` solo emite token a cuentas `active` (:198), pero `resetPassword` **no**
  recomprueba `status` al consumir. Un token emitido mientras la cuenta estaba `active` y usado **después** de
  pasar a `blocked`/`deleted` re-fijaría `passwordHash` y `emailVerified=true`. **No es escalable a acceso:**
  `login`/`refresh`/`jwt-auth.guard` siguen rechazando `blocked`/`deleted` por estado, así que **no** se
  reactiva la cuenta ni se obtiene sesión. Impacto: escritura de estado inútil sobre una cuenta inhabilitada.
  Residual muy bajo.
- **Rol dueño:** **backend** (recomprobar `status === active` dentro de `resetPassword` antes de aplicar el
  cambio; simetría con `forgotPassword`).

### 2. Deuda de seguridad aceptada (no bloqueante, con disparador)
- **S15-B2/B3/B4** se aceptan como **deuda Baja** con los disparadores indicados (defensa-en-profundidad).
  **Disparador de revisión:** antes del go-live con dinero real y/o en el pase **DAST** contra staging (medir
  timing de `forgot-password`, revisar fuga de token por Referer en el borde).
- **S15-B1** (inyección HTML en plantilla) **se recomienda cerrar antes de GA**: es un fix de una línea
  (escape) y elimina una clase de inyección; se enruta a **backend** pero no bloquea el veredicto por su
  impacto acotado (self-targeting).
- **`register` sigue revelando existencia vía `409 EMAIL_TAKEN`** — canal de enumeración clásico ya aceptado
  en pases previos (Info). Sin cambio.
- **Pendientes de infra ajenos a v1.5** (siguen abiertos, de pases previos): **PENTEST M-1** dependencias
  vulnerables (Media, **devops** — incluye la cadena de red de Resend/gaxios a revisar en el próximo
  `npm audit`) y la deuda **BigInt** de agregados de dinero (arquitecto/backend). No pertenecen a esta feature.

### 3. Banderas para el humano
- **Pentest de tercero + bug bounty antes de operar con dinero real**: se mantiene la bandera global. La
  recuperación de contraseña y el gating de dinero son superficie crítica; conviene validación externa antes
  del go-live transaccional.
- **Fase dinámica (DAST contra staging) pendiente**: confirmar timing de anti-enumeración, rate-limits reales
  (por IP tras el proxy/borde — verificar que el `trust proxy`/IP real llega bien al `ThrottlerGuard`) y la no
  fuga de tokens por logs de borde. Requisito previo a prod.
- **Entregabilidad/seguridad de correo (SPF/DKIM/DMARC de `tcgvaultmx.com`)**: es **devops**; si el correo de
  verificación no llega, los usuarios quedan sin poder desbloquear compra/venta/retiro (impacto de negocio, no
  de confidencialidad). Confirmar dominio verificado en Resend.
- **Validaciones legales de custodia/PII (INE/CLABE)**: sin cambios; siguen vigentes de pases previos.

### 4. VEREDICTO — feature v1.5-auth-email: **APROBADO**
- **0 Críticos / 0 Altos / 0 Medios** en la superficie nueva v1.5. Los controles de núcleo (tokens
  hash-only/CSPRNG/atómicos/rotados, gating server-side no evadible, anti-enumeración, rate-limiting, revocación
  de sesiones por `tokenVersion`, key/link sin fuga ni host-injection) están **correctamente implementados y
  verificados en código**.
- **Condición de aprobación cumplida:** el criterio de RECHAZO es "hay hallazgos críticos o altos abiertos" —
  **no los hay**. Las 4 Bajas (S15-B1..B4) se aceptan como deuda con disparador y se enrutan a su rol dueño
  (**backend** S15-B1/B2/B4, **frontend** S15-B3); **ninguna** bloquea.
- **Recomendación no bloqueante:** cerrar **S15-B1** (escape HTML del `name`) en esta misma entrega por ser
  trivial. El resto puede abordarse en el endurecimiento previo a GA / pase DAST.
- **Mínimo para mantener la aprobación:** que no se introduzcan cambios que debiliten el consumo atómico del
  token, el gating server-side o el anti-enumeración de `forgot-password`.

---

# rev v1.6-pentest-consolidacion (2026-08-16) — Consolidación del pase gray-box del pentester (PENTEST_NOTES v1.5)

> **Rol:** seguridad (blue team). **Insumo:** `docs/PENTEST_NOTES.md` **pase v1.5** (red team, gray-box
> estático; 0 Críticas / 0 Altas / 1 Media / 5 Bajas / 6 Info). **Trabajo de esta rev:** validar cada
> hallazgo del pentester contra el código, **reconciliar** con mis IDs previos (no duplicar), confirmar que
> no hay críticos/altos abiertos y emitir **VEREDICTO**.
> **Modo:** revisión **estática** de código + `npm audit --omit=dev` + `git grep` (ejecutados esta sesión).
> Sin stack vivo (Docker/Postgres/Redis no levantables; egress al dominio real denegado por política) →
> vectores dinámicos = **[pendiente de DAST contra staging]**, NO son fallos. Blanco autorizado: código +
> staging/local.

## D.0 Resumen — concuerdo con el pentester: 0 Críticas / 0 Altas abiertas

Validé los 6 hallazgos del pentester en el código. **Todos confirmados en su ubicación** (ninguno es falso
positivo), y **todas** las severidades del pentester son correctas. **Cuatro de los seis ya estaban en mi
registro** con otro ID → los reconcilio, no los duplico. Uno es **nuevo** para mi registro (B-4). Además,
detecto que un hallazgo mío previo (**S15-B4**) fue **corregido** por backend desde la última rev.

| Pentest | Sev. | Mi ID (reconciliado) | Validación en código | Estado | Rol dueño |
|---|---|---|---|---|---|
| **M-1** | Media | **= S-M1** | `npm audit --omit=dev` = 2 moderate (mismo aviso `@nestjs/core` GHSA-36xv-jgw5-4q75); `git grep @Sse\|MessageEvent\|text/event-stream` en `src` = **0** | **Aceptada** (no alcanzable: sin SSE) | devops |
| **B-1** | Baja | **= S15-B2** | `auth.service.ts:198-204`: `await mail.sendPasswordReset` **solo** si existe+`active` | **Aceptada** | backend |
| **B-2** | Baja | **= S-B1** | `auth.service.ts:309-331`: linking por email verificado a cualquier cuenta local; `role` **nunca** del token (`:340` fija `customer` solo en altas) | **Aceptada** | backend |
| **B-3** | Baja | **= S-B2 / SEC-C2** | `schema.prisma:393` `listPriceCents Int?` sin cota; múltiples `*Cents Int` | **Aceptada** | arquitecto (+backend) |
| **B-4** | Baja | **NUEVO = S-B5** | `buylist.dto.ts:42` `@Min(0)` **sin `@Max`**; `buylist.service.ts:428` sin cota vs `quotedPriceCents`/AML | **Aceptada** | backend |
| **B-5** | Baja | **= S15-B3** | `auth.service.ts:71` `buildFrontendLink` arma `?token=<claro>` | **Aceptada** | frontend |

## D.1 Validación por hallazgo (confirmo/ajusto severidad)

### M-1 (Media) — `@nestjs/core` moderate — **CONFIRMADO · severidad efectiva Baja (no alcanzable) · Aceptada**
- **Reconcilia con mi S-M1** (rev v1.3, §5). `npm audit --omit=dev` esta sesión: **2 moderate, 0 high, 0
  critical** — ambos son el mismo aviso `@nestjs/core`/`@nestjs/platform-express` (GHSA-36xv-jgw5-4q75 /
  CVE-2026-35515, **SSE injection**). Fix = `@nestjs/core@11.2.1`, **breaking** (hoy `^10.4`).
- **¿Explotable en nuestra superficie o teórico?** **Teórico/no alcanzable.** La precondición es exponer
  **SSE** y mapear entrada de usuario a `type`/`id` de un `MessageEvent`. `git grep -E
  "@Sse|SseStream|MessageEvent|text/event-stream"` en `backend/src` → **0 coincidencias**. El backend **no
  expone SSE** → el aviso no es alcanzable en este código.
- **Decisión (según el encargo):** **se acepta con disparador**, no se agenda bump ciego. Coincido con el
  pentester: el salto mayor 10→11 tiene riesgo de regresión que no se justifica por un aviso inalcanzable.
  **Disparador:** bump a NestJS 11.1.18+/11.2.x **antes** de introducir cualquier endpoint SSE, o en la
  próxima ventana de mantenimiento de deps con regresión de la suite. **Rol dueño: devops** (bump + gate
  `npm audit` en CI/SAST, ya previsto).

### B-1 (Baja) — Oráculo de timing en `forgot-password` — **CONFIRMADO · = S15-B2 · Aceptada**
- **Reconcilia con mi S15-B2** (rev v1.5-auth-email, §1). **No lo duplico.** Confirmado en
  `auth.service.ts:195-218`: ruta **asimétrica** — email inexistente → un solo `findUnique` y `return`;
  email existente+`active` → `countIssuedLastHour` + `tokens.issue` + **`await mail.sendPasswordReset`
  (round-trip a Resend)** + `audit.log`. La respuesta es **siempre 200** (`:217`, correcto), pero la
  **latencia** delata existencia.
- **Severidad correcta (Baja).** **Impacto reducido:** `register` ya enumera por `409 EMAIL_TAKEN`
  (`:111-113`) — canal directo preexistente y aceptado; el timing solo confirma lo que register ya expone.
- **Rol dueño: backend** (envío fire-and-forget/cola para igualar latencia, o retardo constante).
- **Nota DAST:** medir la asimetría de latencia real requiere target vivo → §D.4.

### B-2 (Baja) — Google-linking alcanza cuentas privilegiadas — **CONFIRMADO · = S-B1 · Aceptada**
- **Reconcilia con mi S-B1** (§3/§5). **No lo duplico.** Confirmado en `auth.service.ts:308-331`: el linking
  enlaza el `googleId` a **cualquier** cuenta local con el mismo email **verificado**, **sin excluir
  back-office** (`super_admin`/`vault_operator`).
- **Evaluación del riesgo real (según el encargo):**
  - **¿El role se re-deriva server-side?** **Sí.** El `role` **nunca** se lee del token de Google; se
    conserva el de BD y `:340` fija `customer` **solo** en altas nuevas. **No hay escalada de privilegios**
    por el token: un atacante no puede convertirse en admin vía Google.
  - **¿Un atacante con el Google del email de un admin podría tomar la cuenta?** **Solo si** (a) existe una
    cuenta back-office cuyo email es una cuenta Google **y** (b) el atacante controla esa cuenta Google (con
    `email_verified=true`). En ese caso obtendría tokens con el rol de BD de esa cuenta **sin** conocer su
    contraseña argon2. Es decir: **traslada** la seguridad de la cuenta privilegiada a la seguridad de su
    cuenta Google (phishing OAuth / falta de MFA). El linking exige `email_verified=true` y corta en
    `blocked`/`deleted` (`:312-314`), lo que acota el vector.
- **Severidad correcta (Baja)**, condicionada a que un back-office use email @gmail. **Rol dueño: backend**
  (restringir login/linking Google a `role=customer`, o exigir MFA en back-office; documentar si se permite).

### B-3 (Baja) — Dinero en `Int` 32-bit — **CONFIRMADO · = S-B2 / SEC-C2 · Aceptada para MVP**
- **Reconcilia con mi S-B2** (§5) y **SEC-C2** (bloque C, ya cerrado el vector *por-envío* con `@Max`, no la
  decisión de agregados). **No lo duplico.** Confirmado: `schema.prisma:393` `listPriceCents Int?` **sin
  `@Max` en el DTO**; múltiples `*Cents Int` en órdenes/inventario/agregados (máx 2^31-1 ≈ **MX$21.47M**).
- **¿Aceptable para MVP con topes actuales o se agenda?** **Aceptable para MVP.** Los flujos de entrada de
  usuario están acotados muy por debajo del límite: buylist **MX$3,000/solicitud** y **MX$10,000/mes** (topes
  AML de M10), envío capado a **MX$100,000** (SEC-C2 `@Max`). El riesgo es en **agregados** de P&L /
  portafolio / custody que sumen > ~MX$21.47M — no explotable por atacante externo, pero rompería features de
  dinero con datos legítimos grandes. **No bloquea el MVP;** se **agenda** la migración a `BigInt`.
- **Rol dueño: arquitecto** (decisión `BigInt` para agregados = cambio de schema/contrato) **+ backend**
  (cota `@Max` razonable en `listPriceCents`, análoga al `@Max` ya aplicado en `shippingCostCents`).
- **Disparador:** antes de que cualquier agregado (portafolio/P&L/custody) se acerque a MX$21M, o antes de
  operar a escala.

### B-4 (Baja) — `approvedPriceCents` sin cota, fijable por `vault_operator` — **CONFIRMADO · NUEVO = S-B5 · Aceptada**
- **Nuevo en mi registro** (asigno **S-B5**). Confirmado en dos puntos:
  - `buylist/dto/buylist.dto.ts:42` — `@IsOptional() @IsInt() @Min(0) approvedPriceCents?` **sin `@Max`** y
    **sin** validación contra `quotedPriceCents` ni contra el tope AML.
  - `buylist.service.ts:417-441` (`itemDecision`) — `data.approvedPriceCents = approvedPriceCents ??
    item.quotedPriceCents ?? 0`, sin cota. El endpoint `PATCH /admin/buylist/items/:itemId/decision`
    (`admin-buylist.controller.ts:87-103`) hereda `@Roles(vault_operator, super_admin)` de la clase (`:15`)
    y **no** es `@MoneyOut` → un **`vault_operator`** puede aprobar un monto arbitrario.
- **Mitigaciones existentes (verificadas):**
  - El **desembolso** `POST /admin/buylist/:id/pay-spei` **es `@MoneyOut()`** (`:122-123`) → **solo
    `super_admin`** vía `MoneyOutGuard`. El operador **no saca dinero**.
  - La decisión **queda auditada**: `admin-buylist.controller.ts:94-101` registra `buylist.item.<decision>`
    con `actorUserId`/`actorRole` y `after.approvedPriceCents`.
- **Análisis:** No es fraude de fondos por sí solo (segregación de funciones: el `super_admin` es quien paga),
  pero el monto que el super_admin termina pagando lo pudo **inflar** el operador, y no hay tope automático
  que lo frene si el pago se ejecuta sin re-verificar. Requiere **colusión o descuido** del super_admin.
  Es una brecha de **defensa en profundidad** en un flujo de dinero. **Severidad correcta: Baja.**
- **Rol dueño: backend** (cota superior en `approvedPriceCents`, p. ej. `≤ quotedPriceCents × factor`, o
  re-chequear el tope AML al aprobar/pagar; SoD reforzada).

### B-5 (Baja) — Token en query-string — **CONFIRMADO · = S15-B3 · Aceptada**
- **Reconcilia con mi S15-B3** (rev v1.5, §1). **No lo duplico.** Confirmado en `auth.service.ts:63-72`
  (`buildFrontendLink`): arma `${origin}/${locale}/(verify-email|reset-password)?token=<claro>`. El token en
  claro viaja como **query param** (inevitable para ser clicable desde el correo).
- **Severidad correcta (Baja).** **Mitigantes fuertes verificados:** un-solo-uso atómico (`consume()`
  `updateMany` con guardia `usedAt:null`), TTL corto (reset 1h), rotación de previos → un token filtrado por
  Referer/historial **ya no sirve** tras consumirse. Práctica estándar; riesgo residual bajo.
- **Rol dueño: frontend** (`history.replaceState` para retirar `?token=` tras consumir + `Referrer-Policy:
  no-referrer` en las rutas de auth). El backend ya acepta el token por body/POST; el link es lo que expone.
- **Nota DAST:** confirmar fuga real por `Referer` requiere frontend en vivo → §D.4.

## D.2 Cierre detectado desde mi última rev — S15-B4 (reset-password revalida estado) — **CERRADO** ✔
- En la rev v1.5 dejé **S15-B4** abierto (Baja): `resetPassword` no recomprobaba `status` al consumir el
  token. **Backend lo corrigió:** `auth.service.ts:237-240` ahora hace `findUnique` y **rechaza con
  `USER_BLOCKED`** si `!user || status !== active` **antes** de fijar `passwordHash`. Simetría con
  `forgotPassword` (que solo emite a `active`) y con `login`. **Verificado en código.** El pentester no lo
  reporta (correcto: ya no es hallazgo). Lo registro como cierre.

## D.3 Contraste con las defensas positivas del pentester (I-1…I-6) — concuerdo
Revisé de forma independiente los positivos que el pentester marca [Verificado en código] y **concuerdo** con
todos, consistente con mi §2 y anexos previos: tokens de correo CSPRNG/SHA-256/un-solo-uso atómico/rotados
(I-1, mi rev v1.5 §0); `EmailVerifiedGuard` server-side no evadible en los 3 endpoints de dinero (I-2, mi rev
v1.5 §0); montos derivados server-side en checkout y buylist —SEC-A1— con reserva atómica anti doble-venta
(I-3, mi §2 y B.4); webhook Stripe firma + idempotencia atómica + "procesado solo tras éxito" (I-4, mi §2);
money-out solo super_admin + IDOR/BOLA scoped por JWT + PII cifrada/enmascarada (I-5, mi §2); sin inyección
SQL / mass-assignment / secretos hardcodeados (I-6, mi §2 y A.4). **Sin regresión.**

## D.4 Pendiente de DAST en vivo (NO es fallo — agendar contra staging autorizado)
Coincido con la lista del pentester (PENTEST_NOTES §"Pendiente de DAST"). No ejecutable hoy (sin Docker/
Postgres/Redis; egress al dominio real denegado). Cuando exista **staging autorizado**, devops habilita y
pentester ejecuta (ZAP baseline/full + nuclei + scripts propios):
1. **Concurrencia real:** doble-checkout de pieza única (reserva atómica), doble `convert-to-inventory`
   (índice único P2002), bypass del tope mensual de buylist (`$transaction` Serializable). Guardias en código;
   falta probar la carrera real.
2. **Webhook Stripe con firmas reales:** replay del mismo `event.id`, firma inválida, eventos forjados de
   refund/dispute; confirmar idempotencia y "procesado solo tras éxito".
3. **Rate-limit efectivo** en `/auth/login`, `/auth/forgot-password`, `/auth/reset-password` y cotizador;
   validar el `ThrottlerGuard` in-memory y su **debilidad en multi-instancia sin Redis** (store compartido).
4. **B-1 timing:** medir la asimetría de latencia de `forgot-password` entre emails existentes/inexistentes.
5. **B-5 Referer:** cargar `verify-email`/`reset-password` y observar fuga del token por `Referer`/historial.
6. **CORS** cross-origin real contra la allow-list; **abuso de presign** (subir objeto que exceda el tope /
   content-type no imagen y confirmar rechazo de S3/MinIO).

## D.5 Deuda de seguridad aceptada (no bloqueante) — consolidada tras este pase

| ID (seguridad) | = Pentest | Deuda | Impacto | Disparador | Rol dueño |
|---|---|---|---|---|---|
| S-M1 | M-1 | `@nestjs/core` SSE injection sin parchar (fix = major 10→11) | Ninguno hoy (sin SSE) | Antes de cualquier endpoint SSE, o próxima ventana de deps | devops |
| S-B1 | B-2 | Google-linking alcanza back-office | Traslada seguridad de cuentas privilegiadas a Google | Antes de alta de back-office con email @gmail; o exigir MFA back-office | backend |
| S-B2 | B-3 | Dinero en `Int` 32-bit (agregados) | Overflow de integridad > ~MX$21.47M | Antes de que agregados se acerquen a MX$21M / operar a escala | arquitecto (+backend) |
| S-B5 | B-4 | `approvedPriceCents` sin `@Max`/cota AML, fijable por operador | Monto inflado que el super_admin podría pagar sin re-check (SoD/DiD) | Cerrar antes de GA con buylist a volumen; cota + re-check AML al pagar | backend |
| S15-B2 | B-1 | Timing en `forgot-password` | Enumeración por canal lateral (ya expuesta por `409` de register) | Endurecimiento previo a GA / pase DAST | backend |
| S15-B3 | B-5 | Token en query-string | Fuga potencial por Referer/historial (mitigada por single-use+TTL) | Endurecimiento previo a GA / pase DAST | frontend |
| SEC-C3 | — | SoD: `vault_operator` escribe insumo del P&L (`shippingCostCents`) | Costo inflado reduce ganancia reportada (auditado) | Decisión de producto | backend/producto |

Cerrados/mitigados vigentes (no reabren): S-M2 (CORS), S-B4 (helmet/HS256/env), S-B3 (presign, residuo Bajo
aceptado), SEC-C1 (fuga de margen), SEC-C2 (`@Max` shipping), **S15-B4 (reset revalida estado)** ✔,
S15-B1 (escape HTML de `name` en plantilla — recomendado cerrar; no bloqueante).

## D.6 Banderas para el humano (antes de operar con dinero real)
- **Fase dinámica (DAST/pentester contra staging) — PENDIENTE Y OBLIGATORIA, no aprobada a ciegas.** Todo
  este pase (pentester + esta consolidación) es **caja gris estática**; los vectores §D.4 exigen staging
  (R2/Railway aún sin configurar). Requisito previo a la promoción a producción.
- **Pentest de tercero + programa de bug bounty** antes del go-live con dinero real (superficie de pagos,
  money-out y recuperación de contraseña).
- **KMS/secret manager en producción** para `JWT_*`, `STRIPE_*`, `PII_*` y `S3_*`; rotación; sin secretos en
  logs/errores. `env.validation.ts` ya rechaza arranque no-local sin secretos y con secretos JWT débiles; la
  **provisión** del secret manager es de devops.
- **Validaciones legales de custodia/PII (INE/CLABE):** figura de depositario, contrato de custodia, base
  legal del INE almacenado, retención `INE_RETENTION_DAYS`, derecho de supresión frente a PII en snapshots
  económicos retenidos (`Order.billingSnapshot`/`SellRequest.clabeSnapshotEnc`). Confirmar con abogado/contador.
- **MFA para back-office** si alguna cuenta privilegiada usa email Google (cierra el riesgo real de B-2/S-B1).

## D.7 VEREDICTO — consolidación del pase pentest v1.5

**VEREDICTO seguridad (revisión estática de código): APROBADO.**

- **Concuerdo con el conteo del pentester: 0 Críticas / 0 Altas abiertas.** Validé los 6 hallazgos en el
  código: **todos reales** (ningún falso positivo), **todas las severidades correctas**. El criterio de
  RECHAZO (`CLAUDE.md` §7: hay críticos/altos abiertos) **no se cumple** → **no procede RECHAZO**.
- **Lo abierto es 1 Media no alcanzable (M-1/S-M1, sin SSE) + 5 Bajas**, todas **aceptadas con disparador y
  rol dueño** (§D.5). Cuatro ya estaban en mi registro (reconciliadas, no duplicadas); una es nueva (B-4 →
  **S-B5**). Además **S15-B4 quedó CERRADO** por backend desde la última rev.
- **Ruteo por rol dueño:**
  - **devops** → M-1 (bump NestJS 11 + gate `npm audit`), habilitar staging para DAST, bucket INE privado +
    límite de policy, store Redis para throttler multi-instancia, `APP_BASE_URL`/secret manager.
  - **backend** → B-1/S15-B2 (timing forgot-password), B-2/S-B1 (política linking Google/MFA back-office),
    B-4/S-B5 (cota `approvedPriceCents` + re-check AML), B-3 parcial (`@Max` en `listPriceCents`),
    S15-B1 (escape HTML del `name`, recomendado).
  - **arquitecto** → B-3/S-B2 (decisión `BigInt` para agregados de dinero — cambio de schema/contrato).
  - **frontend** → B-5/S15-B3 (limpiar token de la URL + `Referrer-Policy` en páginas de auth).
- **DoD de seguridad:** **APROBABLE** en la parte estática (sin críticos/altos; bajas/media aceptadas y
  registradas). **Condición previa a producción (no bloquea el DoD estático, sí la promoción a prod):**
  ejecutar la **fase dinámica (DAST) contra staging** (§D.4) — hoy imposible por falta de infra, **no** por
  un hallazgo. En cuanto haya staging autorizado se re-emite veredicto para el gate de promoción a prod.
- **Mínimo para mantener la aprobación:** no debilitar los guardarraíles verificados (reserva atómica,
  idempotencia/firma del webhook, money-out solo super_admin, gating `EmailVerifiedGuard` server-side,
  consumo atómico de tokens, PII cifrada/enmascarada, derivación server-side de montos SEC-A1).

---

## E. Revisión AppSec — feature de acabado / *finish* v1.6-finish (M-18) — SIN COMMITEAR

> **Rol:** seguridad (blue team). **Alcance:** feature de acabado/finish en el working tree (aún sin
> commitear; `git status` = M-18 + ~40 archivos). **Foco:** integridad financiera **SEC-A1** — que el
> acabado no abra un vector para pagar de más/menos en cotización, compra, buylist o valuación.
> **Modo:** revisión **estática de código** (sin stack vivo; Docker/Postgres ausentes, igual que el
> pentester). Verificados por lectura = **[Verificado en código]**; dinámicos = **[pendiente DAST]**.
> **Fecha:** 2026-08-16 (rev **v1.6-finish**). Blanco autorizado: código + staging/local.
> **Nota:** el pase v1.5 del pentester **no** cubre esta feature (su foco fue correo M-17); esta sección
> es la consolidación blue-team de la superficie nueva de finish. No duplica los hallazgos B-1…B-5/M-1.

### E.0 Resumen ejecutivo

**SEC-A1 se mantiene INTACTO con el acabado.** El monto de cotización/compra/valuación se deriva
**siempre server-side** de `(Card.rarity, finish)` — la rareza de la BD (`Card.rarity` vía `findUnique`) y
el `finish` **validado** contra `Card.availableFinishes` — nunca de un precio/categoría/monto del cliente.
El enum `Finish` (Prisma + `@IsIn` en los DTOs) acota los valores a los **4 canónicos**; la `availableFinishes`
por carta es la **lista blanca**; un acabado fuera de ella se **bloquea 422 FINISH_NOT_AVAILABLE** en los
**tres** puntos de entrada (quote, request, alta de inventario). **Sin nueva superficie de inyección/SSRF** en
el import (host fijo, `setId` regex, `encodeURIComponent`, derivación de acabados solo desde llaves conocidas).

**No hay hallazgos Críticos ni Altos en esta feature.** Lo abierto es **defensa en profundidad / consistencia**
(2 Bajas, ligadas a la ya conocida S-B5/B-4). El resto son defensas verificadas (positivas).

| Severidad (feature finish) | # |
|---|---|
| Crítica | 0 |
| Alta | 0 |
| Media | 0 |
| Baja | 2 (S16-B1, S16-B2) |
| Info/positivo | 5 (S16-I1…I5) |

### E.1 Defensas verificadas (positivo) — SEC-A1 con acabado

**S16-I1. Derivación server-side del monto por (rareza, acabado) — [Verificado en código].**
- Cotizador: `buylist.service.ts:58-95` (`publicQuote`) → `quoteAcquisitionForFinish(card.rarity, f, ref, rules, fallbackPct)` (`money.ts:155-167`). La `rarity` sale de `card` (`findUnique`, :64); el `finish` se valida (:67); la referencia del `pct` es la del **acabado** (`getReference(cardId, productType, gradeKey, f)`, :71). El DTO **nunca** aporta precio/monto/regla.
- Solicitud: `buylist.service.ts:152-179` — misma derivación por item; `quotedTotalCents` se **acumula server-side** (:166), imposible de inflar desde el DTO. La regla aplicada se **snapshotea** (rarity/ruleMode/ruleValue/ruleSource/finish, :167-178) para auditoría.
- Resolver determinista: `ruleKeyCandidates` (`money.ts:114-126`) mapea `finish→ruleKey` sin entrada del cliente; `reverse_holo→["Reverse Holo"]`, `holofoil/1st→isHoloRarity?[rarity,"Holo"]:["Holo"]`, `normal→[rarity]`.

**S16-I2. `FINISH_NOT_AVAILABLE` validado server-side en las 3 rutas, no evadible por API directa — [Verificado en código].**
- Quote: `assertFinishAvailable(card, finish)` (`buylist.service.ts:44-55`, llamado en :67).
- Request: mismo guard por item (`buylist.service.ts:156`).
- Alta de inventario M1: `resolveFinish(dto, card.availableFinishes)` (`inventory.service.ts:110-122`, llamado en :39).
- La validación vive en el **servicio** (no en el front) → una llamada directa a la API no la evade. Un acabado inexistente/arbitrario cae en **422**, **no** en el fallback (el fallback solo aplica a un acabado *válido y disponible* sin regla explícita, resolviéndose a `BUYLIST_PRICE_FALLBACK_PCT`). Bloquea los tres vectores del brief: (a) forzar fallback/regla arbitraria, (b) reclamar un acabado con market más alto, (c) evadir por API directa.

**S16-I3. Enum acotado a los 4 valores canónicos — [Verificado en código].**
- Prisma `enum Finish { normal reverse_holo holofoil first_edition_holofoil }` (`schema.prisma:58-63`); columnas `Card.availableFinishes Finish[] @default([normal])` (:356), `InventoryItem.finish` (:412), `PriceReference.finish` (:463), `SellRequestItem.finish` (:628).
- DTOs: `@IsIn(FINISHES)` en `PublicQuoteDto`/`RequestItemDto` (`buylist.dto.ts:15,23,31`), `CreateItemDto.finish` (`inventory.dto.ts:24`), `OverrideDto.finish` (`pricing.controller.ts`). `ValidationPipe({whitelist:true})` (`main.ts:43`) descarta cualquier campo extra (p. ej. un `price`/`category`/`amountCents` malicioso) → **sin mass-assignment**.
- **Default seguro para filas históricas:** sin re-sync, `availableFinishes = [normal]` (default de schema + guard `?? ['normal']` en `assertFinishAvailable`/`resolveFinish`/`toCardDTO`) → hasta el re-sync **solo `normal` es cotizable/dable de alta**; el resto → 422. No hay degradación insegura.

**S16-I4. Snapshot y propagación de acabado consistentes; no mutable entre cotización y aprobación — [Verificado en código].**
- `SellRequestItem.finish` se fija en `createRequest` (validado, :156-172) y se **propaga** intacto a `InventoryItem.finish` al convertir (`convertToInventory`, `buylist.service.ts:525`), bajo la misma guardia de aprobación (`itemStatus==='aprobada'`, :505) e índice único `sourceSellRequestItemId` (anti doble-conversión, :514-560).
- `itemDecision` (:461-486) **no** toca `finish` → el acabado no se puede cambiar tras cotizar para alterar el precio. Checkout (`orders.service.salePriceOf`) usa `item.finish` de la **BD** + `inventoryItemIds` del DTO: el comprador **no** puede manipular el acabado para pagar menos.
- Valuación (portafolio/custody/inventario/P&L) usa `item.finish` de la BD en todos los consumidores: `vault.service.ts:157,161`, `admin.service.ts:347,366`, `orders.service.ts:28`, `price-sync.service.ts:50`.

**S16-I5. Import/sync sin inyección/SSRF nueva — [Verificado en código].**
- `deriveAvailableFinishes` (`pricing.types.ts:31-41`) solo mapea las **4 llaves conocidas** de `tcgplayer.prices` (`TCG_KEY_TO_FINISH`) e **ignora** las demás; ausente/vacío → `[normal]`. El provider lee `prices[FINISH_TO_TCG_KEY[finish]].market` (llave del acabado pedido), con guarda `typeof market==='number' && >0` (`pokemontcg-io.provider.ts:45-49`).
- Host **fijo** `https://api.pokemontcg.io/v2` (no configurable, anti-SSRF), `setId` validado con `SET_ID_PATTERN` antes de interpolar y `encodeURIComponent(`set.id:${setId}`)` (`pokemontcg-io.client.ts:48-49,97-101`; `catalog-sync.service.ts:11,82`). Dato externo de pokemontcg.io tratado como no confiable: `rarity` es String libre parametrizado por Prisma (sin `$queryRaw`), carta inválida se **omite** sin abortar el barrido (:281-319).

### E.2 Hallazgos (Bajas — defensa en profundidad / consistencia)

**S16-B1. La ruta de buylist (quote/request) no fuerza `finish=normal` para `graded`/`sealed` (inconsistencia con el alta y el contrato).**
- **Vector:** consistencia de regla de negocio en flujo de dinero (no explotable a pago).
- **Ubicación:** `buylist.service.ts:67,156` — `assertFinishAvailable` valida el `finish` contra `availableFinishes` **sin importar** `productType`. En cambio el alta de inventario **sí** fuerza `normal` para no-raw (`inventory.service.ts:111`, `resolveFinish`), y el contrato dice "graded/sealed → finish=normal" (API_CONTRACT §DTOs, ARCHITECTURE §3.7).
- **Análisis:** un `POST /buylist/quote|requests` con `productType=graded|sealed` y `finish=reverse_holo|holofoil` (si la carta lo tiene en `availableFinishes`) seleccionaría la regla de ese acabado (p. ej. "Reverse Holo" fijo). **No rompe SEC-A1** (sigue derivado server-side) ni produce sobrepago real: el buylist es **NM-only** y el desembolso (`pay-spei`) ocurre **solo tras recepción física + verificación** por `super_admin` (money-out, auditado), que confirma el acabado físico. Peor caso: un **estimado** espurio que el operador rechaza en verificación.
- **PoC [Verificado en código; sin impacto de pago]:** cotizar graded/sealed con finish no-normal disponible → estimado por regla del acabado; no hay ruta automática a SPEI sin verificación física.
- **Impacto:** Bajo (consistencia; el pago está físicamente verificado y server-derivado).
- **Rol dueño:** **backend** (forzar `finish='normal'` para `productType!=='raw'` en `publicQuote`/`createRequest`, espejando `resolveFinish`).

**S16-B2. El precio aprobado no se re-deriva contra el acabado físicamente verificado (extiende B-4/S-B5).**
- **Vector:** segregación de funciones / integridad del monto a pagar en buylist (defensa en profundidad).
- **Ubicación:** `buylist.service.ts:470-472` — `itemDecision('approve')` fija `approvedPriceCents = approvedPriceCents ?? item.quotedPriceCents ?? 0`. El `quotedPriceCents` se computó del acabado **declarado por el vendedor** en la cotización; al aprobar **no** se re-deriva `quoteAcquisitionForFinish` contra el acabado **físicamente verificado**, ni hay cota (esto es exactamente el eje de **B-4 / S-B5**, ahora con la dimensión de acabado).
- **Análisis / mitigación existente:** cherry-pick manual carta por carta, NM-only, `pay-spei` **solo `super_admin`** (`@MoneyOut`, auditado). El operador debe cotejar acabado físico vs declarado antes de aprobar; hoy es control **manual**, no de código.
- **Impacto:** Bajo (SoD + auditoría + verificación física mitigan; requiere descuido/colusión). Consolida con **S-B5**: la cota/re-check de `approvedPriceCents` debería **re-derivar por el acabado verificado**.
- **Rol dueño:** **backend** (al aprobar/pagar: re-derivar el monto por el acabado verificado y/o acotar `approvedPriceCents ≤ quotedPriceCents×factor`, y re-chequear el tope AML — unifíquese con S-B5).

### E.3 Deuda de seguridad aceptada (feature finish) — no bloqueante

| ID | Deuda | Impacto | Disparador | Rol dueño |
|---|---|---|---|---|
| S16-B1 | Buylist no fuerza `normal` en graded/sealed | Consistencia; sin sobrepago (verificación física) | Antes de GA del buylist; alinear con `resolveFinish` | backend |
| S16-B2 | Aprobado no re-derivado por acabado verificado | SoD/DiD; mitigado por money-out + verificación manual | Cerrar junto con S-B5 (cota + re-check AML al aprobar/pagar) | backend |

### E.4 Banderas para el humano (específicas de la feature)
- **Re-sync obligatorio del catálogo tras desplegar M-18** (API_CONTRACT changelog v1.6-finish): hasta poblarse `availableFinishes` + precios por acabado, las cartas históricas quedan en `[normal]` (comportamiento seguro, pero cotización limitada a normal). Confirmar que el re-sync corre en la ventana de deploy.
- Reafirmo las banderas D.6 vigentes (pentest de tercero + bug bounty antes de dinero real; validaciones legales de custodia/PII INE/CLABE). La feature de finish **no** altera la superficie de PII/money-out.

### E.5 VEREDICTO — feature de acabado / finish v1.6-finish

**VEREDICTO seguridad (revisión estática): APROBADO.**

- **0 Críticas / 0 Altas** en la feature de finish. **SEC-A1 intacto**: monto siempre derivado server-side de `(Card.rarity, finish)` validado contra `Card.availableFinishes`; DTOs solo aceptan `finish` (enum de 4 valores), sin precios; `ValidationPipe(whitelist)` descarta extras; enum Prisma + lista blanca acotan los valores; `FINISH_NOT_AVAILABLE` server-side en quote/request/alta, no evadible por API directa; snapshot de acabado consistente y propagado sin mutación entre cotización y aprobación; import sin inyección/SSRF nueva.
- **Lo abierto son 2 Bajas** (S16-B1 consistencia; S16-B2 = eje de B-4/S-B5 con dimensión de acabado), **aceptadas con disparador y rol dueño** (backend). El criterio de RECHAZO de `CLAUDE.md` §7 (críticos/altos abiertos) **no se cumple** → **no procede RECHAZO**.
- **Mínimo para mantener la aprobación:** no debilitar los guardarraíles verificados en S16-I1…I5 (derivación server-side por rareza+acabado, validación `availableFinishes`, snapshot/propagación de `finish`, host fijo + `setId` regex del import). Al cerrar **S-B5** (cota/re-check de `approvedPriceCents`), **incluir la re-derivación por el acabado físicamente verificado** (S16-B2).
- **Condición previa a producción (no bloquea el DoD estático):** ejecutar la **fase dinámica (DAST) contra staging** para los vectores de concurrencia/pago ya listados en §D.4 (doble-conversión, reserva atómica, tope mensual) — ahora también **carrera de conversión con `finish`** — más el **re-sync M-18** confirmado en el deploy.

---

## Revisión v1.7-admin-users (E: alta de usuarios por rol · F: historial/auditoría por usuario)

> **Rol:** seguridad (blue team). **Alcance:** features **v1.7-admin-users** en el working tree **SIN commitear**
> (`git status`: `admin.controller.ts`, `admin.service.ts`, `audit.service.ts`, controllers/services de
> buylist/shipments/disputes con `?userId=`, DTOs, `M6View.tsx`, `lib/api.ts` + specs nuevos). Sensibles:
> creación de cuentas, asignación de rol, lectura de auditoría/PII.
> **Modo:** revisión **estática** de código (sin stack vivo: sin Docker/Postgres, igual que el pentester).
> Verificados por lectura = **[Verificado en código]**; los dinámicos = **[pendiente de DAST]**.
> **Insumo:** `docs/PENTEST_NOTES.md` (pase v1.5) — el pentester **no** cubrió esta feature (es posterior a su
> pase); esta sección es revisión **propia** del blue team sobre el delta v1.7. **Fecha:** 2026-08-16.

### V17.1 Foco 1 — Escalada de privilegios (POST /admin/users) — [Verificado en código] SIN hallazgo

- **super_admin-only efectivo, no evadible.** `AdminUsersController` tiene `@Roles(vault_operator, super_admin)`
  a nivel clase, pero `createUser` lleva `@Roles(super_admin)` a nivel método (`admin.controller.ts:66`). El
  `RolesGuard` resuelve con `reflector.getAllAndOverride(ROLES_KEY, [getHandler(), getClass()])`
  (`roles.guard.ts:17-20`): **el método gana sobre la clase** → el POST exige `super_admin`. Orden de guards
  global correcto: `JwtAuthGuard → RolesGuard → EmailVerifiedGuard → MoneyOutGuard` (`app.module.ts:63-67`),
  con `req.user.role` poblado desde BD. Un `vault_operator` → **403 FORBIDDEN** (no puede crear usuarios ni
  auto-promoverse). No es money-out (correcto: no toca dinero saliente).
- **`role` desde enum validado, no manipulable.** El rol se valida en el servicio contra la lista blanca
  `[customer, vault_operator, super_admin]` (`admin.service.ts:79-83`), **no** se lee de token ni de otra
  fuente; valor fuera de la lista → **422 VALIDATION_ERROR**.
- **Creación de `super_admin` auditada.** El controller registra `action:'user.create'`, `entityType:'User'`,
  `entityId=res.user.id`, con `after` **solo metadatos no sensibles** (`role, emailVerified, authProvider,
  mustChangePassword`) — **sin password** (`admin.controller.ts:72-85`).
- **Sin regresión en el registro público.** El diff **no toca** `auth.service.ts`; `register`/`google` siguen
  forzando `role:customer` (confirmado por pentester I-6). No hay ruta de auto-alta a rol privilegiado.

### V17.2 Foco 2 — Manejo de credenciales — [Verificado en código] SIN hallazgo

- **argon2 + CSPRNG.** Password provista o autogenerada se hashea con `argon2.hash` (`admin.service.ts:114`).
  La autogeneración usa `randomBytes(18).toString('base64url')` (**CSPRNG**, no `Math.random`;
  `admin.service.ts:104`), mismo generador que el reset M-15.
- **`tempPassword` una sola vez, nunca persistida en claro ni auditada.** Se devuelve en la respuesta **solo si
  se autogeneró** (`...(autogenerated ? { tempPassword } : {})`, `:154`); si el admin la provee, **no** se
  devuelve. El `after` del `user.create` **no** contiene password/hash; `reset-password` audita solo el hecho
  (actor/target/acción), sin la temporal (`admin.controller.ts:176-184`). El shape público de `user` **excluye
  `passwordHash`** (`:142-152`).
- **Frontend:** `M6View.tsx` mantiene la temporal **solo en memoria**, la muestra una vez y ofrece copiar al
  portapapeles; **sin** `console.log` ni `localStorage`. (El mock de `lib/api.ts:createAdminUser` usa
  `Math.random` para simular la temporal, pero es **rama mock de test**, nunca la ruta real — ver V17.7/Info.)

### V17.3 Foco 3 — Fuga de PII en auditoría (GET /admin/users/:id/audit) — [Verificado en código] SIN hallazgo

- **`before`/`after` NUNCA se exponen.** `audit.service.ts:listForUser` usa un `select` explícito
  (`id, actorUserId, actorRole, action, entityType, entityId, createdAt`) que **no** incluye `before`/`after`
  (`audit.service.ts:96-105`). Estos campos pueden traer PII/estado y quedan fuera de la proyección.
- **`ip` condicionado a `super_admin`.** El `ip` solo se agrega al `select` cuando `role===super_admin`
  (`...(isSuperAdmin ? { ip: true } : {})`, `:104`); el `vault_operator` **ni lo selecciona de BD** (no viaja).
- **404 si el usuario no existe** (`:79-80`); `scope` normalizado a `target|actor|both` en el controller con
  default `target` (`admin.controller.ts:108-112`); paginación acotada (`pageSize ≤ 100`).

### V17.4 Foco 4 — IDOR / filtros `?userId=` (buylist/shipments/disputes) — [Verificado en código] SIN hallazgo

- Los 4 endpoints de listado admin (`/admin/buylist`, `/admin/shipments`, `/admin/disputes`, y `/admin/orders`
  reusado por el front) mantienen `@Roles(vault_operator, super_admin)` a nivel clase. El `?userId=` **solo
  agrega una cláusula `where.userId`** al listado ya paginado (`buylist.service.ts`, `shipments.service.ts`,
  `disputes.service.ts`, ramas `if (userId) where.userId = userId`). **No** hay bypass de guard: un no-admin
  no alcanza estos endpoints (RolesGuard → 403). Un `vault_operator` **ya** podía listar todo sin el filtro →
  el filtro **no amplía** su superficie (solo acota). No es IDOR.
- **Proyección PII por rol intacta:** el cambio es puramente un filtro `where`; **no** modifica el `select`/DTO
  de esos listados (buylist/disputes/shipments) → la proyección PII previa (pentester I-5) se mantiene.

### V17.5 Foco 5 — Whitelist / mass-assignment — [Verificado en código] SIN hallazgo

- `CreateAdminUserDto` declara **solo** `email, name, role, password?, phone?, locale?` (`admin.controller.ts:27-34`).
  `ValidationPipe({whitelist:true})` global **descarta** cualquier campo extra del body (`status`,
  `emailVerified`, `tokenVersion`, `mustChangePassword`, `googleId`, `authProvider`…). Defensa redundante: el
  servicio `createUser` **solo lee** los 6 campos permitidos (firma tipada), así que aunque el whitelist fallara,
  los campos sensibles **no** se leen del body.
- **El server fija los campos de confianza:** `emailVerified:true`, `authProvider:'local'`, `status` (default de
  columna) y `mustChangePassword` (derivado de `autogenerated`) los pone el servicio, **no** el cliente
  (`admin.service.ts:118-131`).

### V17.6 Foco 6 — Enumeración (409 EMAIL_TAKEN) — Info / aceptable

- `createUser` mapea `P2002` a **409 EMAIL_TAKEN** (`admin.service.ts:134-136`), revelando existencia de email.
  **Aceptable:** endpoint **admin-only** (`super_admin`), es back-office; el operador legítimamente necesita
  saber si el email ya existe. Consistente con el canal de enumeración ya existente en `register`
  (pentester B-1). **Sin acción bloqueante.**

### V17.7 Hallazgos priorizados de esta feature

| ID | Sev | Descripción | Ubicación | Rol dueño |
|---|---|---|---|---|
| V17-I1 | Info | 409 EMAIL_TAKEN enumera email en endpoint admin-only (aceptable en back-office) | `admin.service.ts:134-136` | — (aceptado) |
| V17-I2 | Info | Password provista por admin sin `@Max`/política de complejidad (solo `MinLength 8`, paridad con `register`); `mustChangePassword=false` cuando el admin la provee (por diseño) | `admin.service.ts:106-112` | backend (opcional) |
| V17-I3 | Info | Mock del front (`createAdminUser`) genera la temporal con `Math.random` — **solo rama mock/test**, jamás la ruta real (backend usa CSPRNG). Sin impacto en producción | `frontend/src/lib/api.ts:createAdminUser` | frontend (higiene) |
| V17-Obs | Obs | `getUser` (pre-existente, **fuera del delta v1.7**) hace `...safe` y expone al back-office campos como `googleId`/`tokenVersion`/`mustChangePassword`. No introducido por esta feature; se anota para depuración futura de la ficha | `admin.service.ts:203,240` | backend (deuda menor, no v1.7) |

**No hay hallazgos Críticos ni Altos ni Medios ni Bajos nuevos en el delta v1.7-admin-users.** Los ítems son
Info/observación aceptados con disparador.

### V17.8 Banderas para el humano

- **Reafirmo** las banderas vigentes: pentest de **tercero** + **bug bounty** antes de operar con **dinero real**;
  validaciones **legales** de custodia y **PII (INE/CLABE)**. La feature v1.7 **no** altera la superficie de
  money-out ni de INE/CLABE (crea cuentas sin KYC; el KYC sigue su flujo aparte).
- **Poder de `super_admin`:** el alta permite crear otros `super_admin` (por diseño). Queda **auditado**
  (`user.create`), pero se recomienda al humano **revisar periódicamente** el `AuditLog` de `user.create`/
  `user.delete`/`user.reset_password` y considerar **MFA** para cuentas de back-office (se cruza con pentester
  B-2: linking Google alcanza cuentas privilegiadas).
- **DAST pendiente en staging** (no ejecutable aquí, sin stack vivo): confirmar 403 real de `vault_operator`
  contra `POST /admin/users`, `PATCH .../kyc|status`, `DELETE`, `reset-password`; y que `GET .../audit` no
  devuelve `ip` para `vault_operator` ni `before/after` para ningún rol.

### V17.9 VEREDICTO — v1.7-admin-users

**VEREDICTO seguridad (revisión estática): APROBADO.**

- **0 Críticas / 0 Altas / 0 Medias / 0 Bajas** en el delta v1.7-admin-users. Los 6 focos de seguridad quedan
  **[Verificado en código]**: (1) escalada de privilegios cerrada (super_admin-only efectivo por override de
  `@Roles` + guard global, rol desde enum validado, alta de super_admin auditada, sin regresión del registro
  público→customer); (2) credenciales argon2 + CSPRNG, `tempPassword` una-vez y **fuera** del AuditLog;
  (3) auditoría por usuario sin `before/after` y con `ip` solo para super_admin; (4) `?userId=` sin IDOR ni
  bypass de guard, proyección PII intacta; (5) sin mass-assignment (whitelist + campos de confianza server-side);
  (6) enumeración admin-only aceptable.
- El criterio de RECHAZO de `CLAUDE.md` §7 (críticos/altos abiertos) **no se cumple** → **no procede RECHAZO**.
- **Mínimo para mantener la aprobación:** no debilitar los guardarraíles verificados (override `@Roles(super_admin)`
  en `createUser`; `after` de auditoría sin password; `select` de `listForUser` sin `before/after` y `ip`
  condicional; whitelist del DTO). **Antes de GA con dinero real**, ejecutar la fase **DAST** de V17.8 contra
  staging autorizado.

---

## V18 — Revisión LIGERA rediseño 5a (rama `claude/rediseno-5a-pantallas`, 2026-08-16)

**Alcance:** solo-frontend, 51 archivos (49 en `frontend/` + 2 docs), delta `main...HEAD`
(+2696 / -2191). Cambios de **capa de presentación**: tokens de color/tipografía, `tailwind.config.ts`,
`globals.css`, componentes `ui/` y `domain/`, shells/headers. **No** añade endpoints, **no** toca auth,
datos, dinero ni el contrato de API. Objetivo: confirmar que no hay superficie de seguridad nueva.

### V18.1 Verificaciones (todas [Verificado en código])
1. **XSS / inyección de markup:** `grep` sobre `frontend/src/` → **0** ocurrencias de
   `dangerouslySetInnerHTML`, `eval(`, `new Function`, `innerHTML`, `<script>`. El delta no introduce
   ninguna. Todo texto dinámico se renderiza como hijo JSX (auto-escapado por React).
2. **Fuentes / recursos remotos y CSP:** las tipografías migran a **`next/font/google`** (`Archivo`,
   `JetBrains_Mono`, `Zen_Old_Mincho`) en `frontend/src/app/[locale]/layout.tsx`. `next/font` **auto-hospeda**
   los archivos en build-time y los sirve desde el propio origen (variables `--font-serif/-sans/-mono`); **no**
   hay fetch en runtime a `fonts.googleapis.com`/`gstatic`/CDN externo → **no evade la CSP**. `grep` de
   `fonts.googleapis|gstatic|cdn.|http://` en `frontend/src/` → **0** matches.
3. **Exposición de datos nuevos en cliente:** sin cambios en `lib/` (`git diff --name-only` no lista
   `frontend/src/lib/*` → `useCart` **intacto**). `AuthForm.tsx` y `GoogleSignInButton.tsx` son cambios
   **visuales**: sin nuevos `token/secret/client_id/fetch/window/localStorage/process.env`. No se filtran
   tokens/PII/secretos que antes no estuvieran.
4. **Carrito en header (`StorefrontHeader`) / `ListingSpec`:** el header solo importa el `useCart` existente
   y pinta el `count` (número). `ListingSpec` construye `line = parts.join(' · ')` desde **claves i18n** +
   datos de carta (`grade`, `certNumber`, `rawCondition`) y los usa como texto JSX y en `title`/`aria-label`;
   React escapa tanto hijos como valores de atributo → **sin inyección vía nombre/condición de carta**.
5. **`localStorage`:** las únicas apariciones en el delta son (a) la **eliminación** de `ThemeToggle`
   (tema único claro) y (b) el patrón ya existente de `useCart` (líneas de carrito locales, sin credenciales).
   No hay almacenamiento nuevo de datos sensibles.

### V18.2 VEREDICTO — rediseño 5a
**Rev rediseño 5a — sin superficie de seguridad nueva. APROBADO para el registro.**
- **0 Críticas / 0 Altas / 0 Medias / 0 Bajas** en el delta 5a. Es capa de presentación pura: sin endpoints,
  sin auth/datos/dinero/contrato, sin recursos remotos no confiables, sin nuevas rutas de XSS.
- El criterio de RECHAZO de `CLAUDE.md` §7 (críticos/altos abiertos) **no se cumple** → **no procede RECHAZO**.
- **Mínimo para mantener la aprobación:** conservar `next/font` self-hosted (no reintroducir `<link>` a CDN de
  fuentes que requiera relajar la CSP) y no pasar datos de carta por `dangerouslySetInnerHTML`. El veredicto
  de seguridad global del proyecto sigue gobernado por las secciones previas (auth/dinero/PII), inalteradas por 5a.

---

## rev v1.6 — Ronda B deuda backend (2026-08-16): scheduler + jobs manuales + tope `approvedPriceCents`

**VEREDICTO: APROBADO** (revisión estática) — 0 Críticos / 0 Altos / 0 Medios.

- **B-4 / S-B5 (tope `approvedPriceCents`) → CERRADO.** Doble capa: DTO `@Max(MAX_APPROVED_PRICE_CENTS=1_000_000)` (rechaza el PoC `99999999` con 400) + server-side `assertApprovedPriceWithinCap = min(quotedPriceCents×2, buylist_cap_per_request_cents)` en `itemDecision` (approve/adjust) → `422 APPROVED_PRICE_CAP_EXCEEDED`. Desembolso SPEI sigue `@MoneyOut` super_admin + auditado, usa el monto capado como base de costo. Un `vault_operator` ya no aprueba montos arbitrarios.
- **ine-retention (borrado de PII):** predicado seguro — no purga con solicitudes abiertas (`openCount>0 → skip`); solo tras `INE_RETENTION_DAYS` desde el cierre; borra objeto R2 + nulifica keys BD; corre diario + disparo manual super_admin.
- **`/admin/jobs/*`:** super_admin-only (guards globales) + auditados; el operador no dispara borrado de PII ni sweeps; sin dinero saliente.
- **Sweeps:** solo mutan estados no-monetarios; no liberan dinero ni saltan el gating de aprobación a inventario (una `abandonada` deja ítems en `cotizada`, y `convertToInventory` exige `aprobada`).

**Hallazgos no bloqueantes:**
- **SEC-D1 (Baja, con disparador):** INE huérfano en el bucket si `deleteObject` de R2 falla (las keys se nulifican igual). Cerrar con lifecycle/retención a nivel de bucket R2 [devops]; opcional reordenar para purgar R2 antes de nulificar [backend]. Mismo patrón que B.2.
- **SEC-D2 (Baja):** `closureDate` aproxima el cierre por `max(paidAt,approvedAt,verifiedAt,receivedAt,createdAt)`; para `rechazada`/`abandonada` cae en `createdAt` → puede purgar algo antes que "N días desde el cierre real". Minimización de datos (a favor), no incidente. Precisión: añadir `closedAt` explícito [backend/arquitecto].
- **SEC-D3 (Info, no seguridad):** `SellRequest.approvedTotalCents` se LEE en P&L/dashboard pero NUNCA se escribe → la tarjeta "buylist del periodo" suma 0/null. Bug de reporte financiero [backend]: poblar `approvedTotalCents` al aprobar/pagar o derivarlo de `SellRequestItem.approvedPriceCents`.

**Pendiente heredado (no bloquea DoD estático):** fase DAST contra staging (concurrencia real de sweeps/decision/pay-spei; scheduler multi-instancia con Redis compartido). Confirmar con legal el plazo/anclaje de retención de INE (LFPDPPP).

---

## rev v1.8-ronda-c — Enriquecimiento M-19 + cierre de vectores de dinero/PII iniciados en Ronda B (2026-08-16)

> **Alcance:** contrato `v1.8-ronda-c` (commit `857f10b`, aditivo) + backend/frontend **sin commitear
> en el working tree**. Focos del encargo: SEC-A1 (`approvedTotalCents` RB-6 + `referenceValue`),
> dinero saliente (cap `approvedPriceCents` + override RB-3), retención INE (`closedAt` → SEC-D2),
> `POST /admin/pricing/override` con `finish`, auditoría RB-1/RB-2, superficie del contrato
> (`finish`/`referenceValue`/`productType`/`closedAt`).
> **Modo:** revisión **estática** de código + migración M-19 + ejecución de la batería Ronda C
> (`buylist.ronda-c`, `buylist.approved-price-cap`, `ine-retention`, `pricing.finish-pending`,
> `buylist-sweep.closedat`, `admin-jobs.controller`) → **28/28 PASS**. Sin stack vivo → DAST sigue
> pendiente (§6). El insumo del pentester (`PENTEST_NOTES.md`, pase v1.5) no cubre M-19; este anexo
> lo complementa con verificación directa del delta.

### RC.0 Resumen — 0 Críticos / 0 Altos / 0 Medios; 1 Baja informativa; cierra SEC-D2 y SEC-D3

| Severidad | # | ID |
|---|---|---|
| Crítica | 0 | — |
| Alta | 0 | — |
| Media | 0 | — |
| Baja | 1 | **SEC-E1** (edge case pre-existente de selección de `lastClosed`; no introducido por Ronda C) |
| Cerrados esta rev | 2 | **SEC-D2** (retención anclada a `closedAt`), **SEC-D3** (`approvedTotalCents` server-side) |

### RC.1 SEC-A1 — montos server-side (RB-6 + `referenceValue`) — **OK · [Verificado en código + tests]**
- **`approvedTotalCents` (RB-6): derivado, nunca del cliente.** Solo lo escribe
  `BuylistService.recomputeApprovedTotal` (`buylist.service.ts:564-579`) como **SUMA** de
  `SellRequestItem.approvedPriceCents` (`aggregate _sum`), invocado tras **cada** `itemDecision`
  (`:557`). Si ningún ítem tiene monto aprobado → `null` (distingue "sin aprobar" de "aprobado en
  cero"). `grep approvedTotalCents backend/src` → escritura **únicamente** ahí; el resto son lecturas
  (P&L `admin.service.ts:679,703`, DTO de respuesta `buylist.service.ts:410`). **Ningún DTO de
  cliente lo acepta**; `ValidationPipe({whitelist:true})` descartaría un intento de inyectarlo.
- **`referenceValue` en `AdminUserOwnedItemRef` (BE-10): de `PriceReference`, no de input.**
  `admin.service.ts:306-326` hace **lectura batch** `prisma.priceReference.findMany({ where:{cardId:{in:…}} })`
  y mapea por clave `(cardId|productType|gradeKey|finish)` a un `PriceInfo` (`priced`/`pending`).
  El valor es la referencia de mercado del **acabado específico** del ítem; no proviene del cuerpo de
  la petición ni es PII. La proyección es del propio usuario objetivo de la ficha 360°.

### RC.2 Dinero saliente — cap `approvedPriceCents` + override AML (RB-3) — **OK · [Verificado]**
- **Cap vigente (Ronda B, sin regresión):** DTO `@Max(MAX_APPROVED_PRICE_CENTS)` (`buylist.dto.ts:63`)
  + server-side `assertApprovedPriceWithinCap = min(quotedPriceCents×2, amlCap)` en approve/adjust
  (`buylist.service.ts:537-546`). Excedente → `422 APPROVED_PRICE_CAP_EXCEEDED`.
- **RB-3 (override honrado): AMPLÍA solo dentro de límites que fija el super_admin.** `itemDecision`
  resuelve `amlCap = kyc.capPerRequestCentsOverride ?? dial global` (`:527-532`), misma fuente que
  `createRequest` (`:184-187`). **El override lo setea SOLO el super_admin** vía
  `PATCH /admin/users/:id/kyc` (`admin.controller.ts:122-123`, `@Roles(super_admin)` a nivel de método,
  auditado `user.kyc.update`). Un `vault_operator` **no puede** modificarlo (ve M6 en proyección
  reducida, sin escritura de KYC) → **no puede elevar su propio techo de aprobación ni evadir el tope
  AML**; queda acotado a lo que el super_admin autorizó, y sigue sujeto a la cota relativa
  `quoted×2`. El **desembolso** SPEI (`pay-spei`) permanece `@MoneyOut` super_admin + auditado.
- **Residuo (no nuevo):** el override no tiene `@Max` (`admin.controller.ts:13`, solo `@Min(0)`) → un
  super_admin podría fijar un tope por-solicitud arbitrariamente alto; para ítems en `precio_pendiente`
  (sin `quotedPriceCents`) el cap efectivo colapsa a ese override. Actor confiable + auditado +
  desembolso super_admin ⇒ **Bajo**, ya cubierto por la deuda **S-B2/B-4** (Int32/cotas de dinero).
  Sin cambio de severidad.

### RC.3 Retención INE (LFPDPPP) — `closedAt` → **cierra SEC-D2 · [Verificado en código + tests]**
- **El predicado de seguridad NO cambia** (`ine-retention.service.ts:44-79`): `openCount>0 → continue`
  (INE aún necesaria); exige `lastClosed`; `closureDate(lastClosed) > cutoff → continue`. Solo entonces
  purga objeto R2 + nulifica `ineFrontKey/ineBackKey`.
- **El cambio ANCLA el corte al cierre REAL, no lo adelanta.** `closureDate` (`:87-100`) devuelve
  `req.closedAt` si existe; `closedAt` se sella **solo** en transiciones **terminales** server-side
  (`pagada`/`rechazada`/`abandonada`: `buylist.service.ts:367,681`, `buylist-sweep.service.ts:32,46`).
  Para `rechazada`/`abandonada`, el fallback anterior (`max(paidAt,approvedAt,verifiedAt,receivedAt,
  createdAt)`) subestimaba el cierre (caía en `createdAt`) → purgaba **antes**; `closedAt` es la fecha
  real de rechazo/abandono, **posterior** → el cambio **retrasa** el borrado hacia el cierre efectivo
  (más conservador, mejor cumplimiento). **No adelanta el borrado en ningún caso.**
- **Fallback legacy seguro:** filas previas a M-19 (`closedAt=null`) caen al cálculo por timestamps de
  estado — comportamiento idéntico al anterior, sin borrar de más. Migración M-19 = columna nullable,
  sin backfill. Test `ine-retention.spec.ts` cubre ambos caminos (28/28 PASS).
- **SEC-D2 (que yo había levantado en rev v1.6): CERRADO.**

### RC.4 `POST /admin/pricing/override` con `finish` — **OK · [Verificado en código]**
- **Sigue super_admin-only y auditado:** `PricingController` `@Roles(super_admin)` a nivel de clase
  (`pricing.controller.ts:54`); audita `pricing.override` / `entityType:PriceReference`, ahora con
  `finish` en `after` (`:86-92`).
- **`finish` validado contra enum cerrado:** DTO `@IsIn(['normal','reverse_holo','holofoil',
  'first_edition_holofoil'])` + tipo `Finish` (`:26-27`). **No** acepta acabado arbitrario (evita crear
  filas `PriceReference`/pendientes con un `finish` fuera de dominio). Default `normal` si se omite.
- **Resolver un pendiente por acabado NO abre bypass — lo CIERRA.** `manualOverride`
  (`pricing.service.ts:216-221`) ahora incluye `finish` en el `updateMany.where` que marca
  `resolved`. Antes el `where` omitía `finish`: un override de `normal` cerraba **también** el
  pendiente de `holofoil` de la misma carta → un acabado podía quedar "resuelto" con la referencia de
  **otro** acabado. El fix segrega la cola por acabado (`escalatePending` propaga `finish` a la clave
  de dedupe y a la fila creada, `:164-189`; `buylist.service.ts:164` y `pricing.service.ts:124`). Es un
  **endurecimiento** de la integridad de precios, no un vector nuevo. Test `pricing.finish-pending.spec.ts`
  PASS.

### RC.5 Auditoría (RB-1/RB-2) — **OK · [Verificado en código]**
- **Taxonomía uniforme:** `jobs.portfolio_snapshot` → `jobs.portfolio_snapshot.run`
  (`admin-jobs.controller.ts:38`), alineado con el resto de jobs `jobs.<name>.run`.
- **`entityType`/`entityId` en TODA la auditoría de jobs** (`Job`/`<nombre-job>`, `:39-40,55-56,70-71,
  85-86,100-101`) → paridad con los disparos M2. Los `/admin/jobs/*` siguen super_admin-only (guards
  globales) + auditados.
- **Decisiones de dinero auditadas:** `itemDecision` audita `after.approvedPriceCents`
  (`admin-buylist.controller.ts:102`); `pricing.override` incluye `finish`; `pay-spei`/`refund`/
  `reveal-clabe` siguen `@MoneyOut` + auditados (sin regresión, §2).

### RC.6 Superficie del contrato — sin fuga de PII ni datos ajenos — **OK · [Verificado]**
- **`closedAt` es interno:** no aparece en ningún DTO de cliente ni en `contract.ts`; solo se escribe
  server-side y lo lee `ine-retention`. Confirmado por grep (`schema.prisma:619` + escrituras server).
- **`AdminUserOwnedItemRef` (finish/referenceValue/productType):** vive en la ficha 360° admin
  (`AdminUsersController` `@Roles(vault_operator,super_admin)`); expone la referencia de mercado del
  acabado del ítem **del propio usuario objetivo**, no de terceros, y **no** añade CLABE/RFC/INE. La
  proyección PII reducida para `vault_operator` sigue intacta (§2, sin regresión). `finish`/`productType`
  ya eran superficie pública ("Compra"). Sin exposición nueva de PII.
- **`PendingPriceEntry.finish`:** cola interna de back-office (super_admin M2), no cliente.

### SEC-E1 (Baja, informativa) — selección de `lastClosed` por `createdAt`, no por cierre más reciente
- **Ubicación:** `ine-retention.service.ts:56-58` — `findFirst({ …status∈CLOSED, orderBy:{createdAt:'desc'} })`.
- **Observación:** ancla la retención a la solicitud cerrada **creada** más recientemente; si un usuario
  tuvo una solicitud creada antes pero cerrada después (p. ej. una `pagada` de verificación larga junto a
  una `rechazada` rápida posterior por `createdAt`), el ancla podría caer en un `closedAt` anterior al de
  la solicitud realmente cerrada al último → purga algo **antes** del cierre efectivo de esa otra.
- **No es introducido por Ronda C:** la selección `orderBy createdAt desc` es **pre-existente**; Ronda C
  solo mejoró `closureDate`. Sentido de riesgo = minimización de datos anticipada (a favor de privacidad),
  no exposición; impacto AML = perder evidencia unos días antes en un caso multi-solicitud poco común.
- **Severidad:** **Baja / informativa**. **Rol dueño:** **backend** — anclar a
  `max(closedAt)` sobre las solicitudes cerradas (u `orderBy closedAt desc`) en vez de `createdAt`.
  No bloqueante; se registra junto a la bandera legal de retención (§6).

### RC.7 VEREDICTO — rev v1.8-ronda-c

**VEREDICTO seguridad (revisión estática + tests): APROBADO.**

- **0 Críticos / 0 Altos / 0 Medios.** SEC-A1 intacto y **reforzado**: `approvedTotalCents` (RB-6) y
  `referenceValue` (BE-10) se derivan/leen server-side, nunca del cliente. El cap de dinero saliente
  sigue vigente y RB-3 honra el override **solo** dentro de límites que fija el super_admin (un
  `vault_operator` no evade el tope AML). La retención de INE **no borra antes de tiempo** — `closedAt`
  ancla al cierre real y **retrasa** (no adelanta) el borrado; el fallback legacy preserva el
  comportamiento previo. `POST /admin/pricing/override` sigue super_admin-only + auditado, `finish` con
  enum cerrado, y la cola por-acabado **cierra** un vector de precio cruzado (endurecimiento). Auditoría
  RB-1/RB-2 uniforme. Contrato aditivo sin fuga de PII ni datos ajenos; `closedAt` interno confirmado.
  Migración M-19 aditiva/nullable, sin backfill. **28/28 tests Ronda C PASS.**
- **Cierra dos hallazgos que blue team había abierto en rev v1.6:** **SEC-D2** (retención imprecisa) y
  **SEC-D3** (`approvedTotalCents` nunca escrito).
- **Deuda/banderas sin cambio:** S-M1 (SSE no alcanzable), S-B1 (linking Google back-office), S-B2/B-4
  (Int32/cotas de dinero, incl. override sin `@Max`), residuo S-B3 (`contentLength`), SEC-D1 (INE
  huérfano si falla R2), bandera legal de PII en snapshots económicos y de retención LFPDPPP. Nuevo:
  **SEC-E1** (Baja informativa, backend), no bloqueante.

**¿Puede ir a main?** **SÍ.** No hay hallazgos **Críticos ni Altos** abiertos en Ronda C → no procede
RECHAZO (`CLAUDE.md` §7). Basta la revisión de código para el merge a `main`.

**Condición para operar con DINERO REAL (no para el merge):** la **fase dinámica (DAST/pentester contra
staging)** sigue **PENDIENTE Y OBLIGATORIA** antes de producción con dinero/PII reales (heredada, §6; hoy
bloqueada por infra: R2/Railway sin configurar, sin stack local levantable). Debe cubrir concurrencia real
de `itemDecision`/`recomputeApprovedTotal`/`pay-spei`, el job de retención bajo carga, y ZAP/nuclei. En
este entorno no hay staging atacable; queda en backlog del humano pre-dinero-real. La revisión estática de
Ronda C **no** la sustituye pero **no** la bloquea para el merge.

---

# ANEXO rev v1.9-set-chart (2026-08-16) — Gráfica pública de valor de set (M-20, commit f3926ed)

> **Rol:** seguridad (blue team). Reviso la superficie nueva de `v1.9-set-chart` (ya commiteada,
> `f3926ed`): endpoint **público** nuevo, **fetch externo** a pokemontcg.io, **jobs desatendidos** y
> **agregación de precios**. Consolido con el pentester (`PENTEST_NOTES.md` v1.5: 0 crít/0 alto; el
> bloque nuevo no altera su conteo) y emito veredicto. **Modo:** revisión **estática** de código
> (`set-value.service.ts`, `catalog.controller.ts`, `set-price-sync.service.ts`,
> `set-value-snapshot.service.ts`, `admin-jobs.controller.ts`, `scheduler.service.ts`,
> `pricing.service.ts`, `pokemontcg-io.provider.ts`, `schema.prisma`, migración M-20). Egress a
> pokemontcg.io **bloqueado** en esta sesión → sin DAST en vivo. Blanco autorizado: staging/local.

## SC.0 Resumen — 0 Críticos / 0 Altos / 0 Medios

El bloque llegó **endurecido y aditivo**. No hay dinero saliente ni PII nuevos. Los dos endpoints
públicos exponen **solo valor agregado de mercado** de un set (dato de catálogo ya público), sin tocar
inventario, costo, holdings ni PII. El fetch externo usa **host FIJO** no influenciable por el cliente.
La agregación (SEC-A1) se deriva **siempre** de `PriceReference` real; nada viene del cuerpo del cliente.
Los jobs son idempotentes, gated por `REDIS_URL`, sin efecto sobre dinero/PII/bóveda. Los disparos admin
son **super_admin + auditados**. **Un (1) hallazgo Bajo nuevo** (throttle) + **una (1) nota informativa**,
ninguno bloqueante.

| Severidad | # | ID |
|---|---|---|
| Crítica | 0 | — |
| Alta | 0 | — |
| Media | 0 | — |
| Baja | 1 | **SEC-F1** (endpoints públicos de la gráfica sin `@Throttle` propio) |
| Info | 1 | SEC-F2 (`:id` sin validación de formato — sin impacto real) |

## SC.1 Endpoint público — **OK · [Verificado en código]**
- `GET /catalog/featured-set/value-history` y `GET /catalog/sets/:id/value-history` son `@Public()`
  (`catalog.controller.ts:73-84`). **Sin PII ni datos internos:** la respuesta es
  `SetValueHistoryResponse` = `SetRefDTO` (id LOCAL del CardSet, name, series, releaseDate — todo ya
  público vía `GET /catalog/sets`) + `points[]` (`date`, `valueMxnCents`, `pricedCardCount`) + `change`
  (`set-value.service.ts:12-39,187-207`). **No** toca `InventoryItem`, costo, `listPriceCents`, holdings,
  usuarios ni PII. Es **valor agregado de mercado del set** (SUM de referencias públicas TCGPlayer), no el
  valor de nuestro inventario ni del portafolio de ningún usuario.
- **`:id` (endpoint por set):** `setHistoryById` hace `prisma.cardSet.findUnique({ where:{ id } })`
  (`:232-236`) → **parametrizado por Prisma (sin SQLi)**; no existente → `BusinessException.notFound()`
  = **404 correcto**. El `id` **no** arma ninguna URL externa ni query cruda. Ver SEC-F2 por la ausencia
  de validación de formato (sin impacto).
- **Enumeración:** un `:id` válido solo confirma la existencia de un `CardSet`, que **ya es enumerable**
  por el público vía `GET /catalog/sets`. No revela inventario, tenencia ni precio interno → **sin
  superficie nueva de valor para un atacante**.

## SC.2 Fetch externo (SSRF) — **OK · [Verificado en código]**
- `set-price-sync` precia el set **carta por carta** vía `PricingService.syncCardPrice` →
  `PokemonTcgIoProvider.fetchPrice`, que arma la URL con **host FIJO**
  `https://api.pokemontcg.io/v2/cards/${externalId}` (`pokemontcg-io.provider.ts`). El host **no** es
  configurable por request; `externalId` proviene del **registro `Card` de la BD**, no de input del
  cliente. **Ningún input de cliente** llega a la URL: los endpoints públicos solo LEEN la BD
  (`SetValueSnapshot`/`PriceReference`), no disparan fetch.
- `HOME_FEATURED_SET_ID` es un **id de catálogo** (externalId pokemontcg.io) que se resuelve a un
  `CardSet` local por `findUnique({ where:{ externalId } })` (`set-value.service.ts:82-88`); **no** es una
  URL ni se concatena a una. Si no resuelve → warn + fallback determinista (no rompe, no sale a red
  arbitraria).
- Consistente con el guardarraíl ya verificado del sync de catálogo (`SET_ID_PATTERN` + host fijo +
  `encodeURIComponent`, §2 tabla). **Sin SSRF nuevo.**

## SC.3 SEC-A1 (integridad de precios) — **OK · [Verificado en código]**
- `computeSetValue(setId, asOf)` (`set-value.service.ts:134-169`) suma **`PriceReference.priceMxnCents`
  real** filtrado por `productType='raw'`, `gradeKey='raw:NM'`, `finish='normal'` y toma la vigente más
  reciente por carta. **No acepta montos del cliente** (sus únicos parámetros son `setId` interno y una
  fecha). Cartas sin precio se **excluyen** del total (no se inventa) y solo se **cuentan** en
  `totalCardCount` → **sin fabricación de datos**.
- **Sin backfill inventado:** migración M-20 es `CREATE TABLE` puro, **sin** seed/backfill; la serie
  arranca hoy y crece con el snapshot diario (`set-value-snapshot.service.ts`). Confirmado en el SQL.
- El snapshot público (`SetValueSnapshot.totalValueMxnCents`) lo escribe **solo** el job server-side
  (`snapshotFeaturedSet`, `:240-263`); no hay endpoint que permita al cliente fijar/inflar el valor.

## SC.4 `escalate=false` — **OK · [Verificado en código]**
- El flag es un parámetro de `syncCardPrice` (`pricing.service.ts:103,133-135`) cuyo **único efecto** es
  **no** crear `PendingPriceEntry` cuando una carta del set no tiene precio. **No** toca money-out,
  reserva de venta, tope AML, buylist ni SEC-A1. Los flujos de bóveda/buylist conservan el default
  `escalate=true` (nunca se descarta una carta). Correcto: es anti-inundación de la cola de pendientes
  al preciar un set completo de marketing, no un bypass de control de dinero.

## SC.5 Jobs desatendidos — **OK · [Verificado en código]**
- **Idempotencia:** `set-price-sync` usa el cache diario de `syncCardPrice` (findUnique por clave
  compuesta con `capturedDate=today` → no re-escribe) ; `set-value-snapshot` hace **UPSERT** por
  `@@unique([setId, asOfDate])` (`set-value.service.ts:253-257`). Re-correr un día no duplica ni corrompe
  otras series (el where siempre acota `setId`+`asOfDate`).
- **Gated `REDIS_URL`:** el scheduler no programa nada sin Redis (`scheduler.service.ts:49-57`); orden duro
  FX → `set-price-sync` (30 6) → `portfolio-snapshot` → `set-value-snapshot` (15 7). Sin efectos sobre
  dinero/PII/bóveda: solo leen `Card`/`PriceReference` y escriben `PriceReference`/`SetValueSnapshot`.
- **Nota multi-instancia (heredada, no bloqueante):** sin single-flight distribuido, dos réplicas podrían
  preciar el set en paralelo; los upserts idempotentes evitan corrupción, solo se duplica carga hacia
  pokemontcg.io. Ya anotado para **devops** (Redis compartido) en A.2/§6.

## SC.6 Disparos admin — **OK · [Verificado en código]**
- `POST /admin/jobs/set-price-sync` y `/set-value-snapshot` viven en `AdminJobsController`
  `@Roles(Role.super_admin)` a nivel de clase (`admin-jobs.controller.ts:21-23`), sin `@Public`, bajo los
  guards globales `JwtAuthGuard`→`RolesGuard` (`app.module.ts:64-65`) → sesión + rol tomado del JWT (nunca
  del cuerpo); un no-super_admin → 403. **Auditados:** ambos registran `jobs.set_price_sync.run` /
  `jobs.set_value_snapshot.run` con `actorUserId`, `actorRole`, `entityType/entityId` y `after`
  (`:112-142`). Correcto.

## SC.7 Superficie / fuga de existencia-valor — dictamen **Bajo/aceptable**
- El público expone el **valor de mercado agregado de un set Pokémon** (dato derivable de fuentes
  públicas de precios: es información de mercado, no propia). No revela cuántas cartas del set tenemos, ni
  su valor en nuestro inventario, ni holdings de usuarios. **Riesgo de inteligencia competitiva: bajo y
  aceptable** — es, por diseño, un "gancho de mercado" público (hero de la home). Se dictamina **aceptado**.

## SEC-F1 (Baja) — Endpoints públicos de la gráfica sin `@Throttle` propio
- **Vector:** anti-scraping / abuso de lectura no autenticada.
- **Ubicación:** `catalog.controller.ts:73-84` — `featured-set/value-history` y `sets/:id/value-history`
  son `@Public()` y **solo** cubiertos por el `ThrottlerGuard` global (300/min), a diferencia del
  cotizador (`buylist-catalog.controller.ts`) que fija `@Throttle({ttl:60,limit:60})`. El resto de
  `CatalogController` (cards/facets/sets) tampoco lo tiene, así que es consistente con lo ya aprobado.
- **Impacto:** bajo — el dato es agregado, público y de bajo costo (2 queries, sin N+1, sin fetch externo
  en la ruta de lectura). El riesgo es scraping/DoS ligero, mitigado parcialmente por el throttle global.
- **Rol dueño:** **backend** (añadir `@Throttle` por-endpoint acorde al resto de superficie pública, si se
  quiere paridad con el cotizador). **No bloqueante.**

## SEC-F2 (Info) — `:id` sin validación de formato en `sets/:id/value-history`
- `@Param('id')` entra sin `@IsCuid`/regex; se usa **solo** como `where:{ id }` en `findUnique` de Prisma
  (parametrizado). Un id no-CUID simplemente da 404. **Sin SQLi, sin enumeración nueva** (sets ya
  públicos). Se anota como defensa en profundidad menor; **no es hallazgo** ni requiere acción.

## SC.8 VEREDICTO — rev v1.9-set-chart

**VEREDICTO seguridad (revisión estática): APROBADO.**

- **0 Críticos / 0 Altos / 0 Medios.** Endpoint público sin PII ni datos internos (solo valor agregado de
  mercado + ref de set ya público), 404 correcto y `:id` parametrizado; fetch externo con **host FIJO** no
  influenciable por el cliente (sin SSRF nuevo); **SEC-A1 intacto** (valor siempre derivado server-side de
  `PriceReference` real, sin backfill fabricado); `escalate=false` sin bypass de dinero/pendientes; jobs
  idempotentes, gated `REDIS_URL`, sin efecto sobre dinero/PII/bóveda; disparos admin **super_admin +
  auditados**; migración M-20 aditiva sin backfill.
- **Deuda nueva no bloqueante:** **SEC-F1** (Baja, backend: `@Throttle` propio en la gráfica pública) +
  **SEC-F2** (Info, sin acción). Deuda/banderas previas **sin cambio** (S-M1 SSE no alcanzable; S-B1
  linking Google; S-B2/B-4 Int32/cotas de dinero; residuo S-B3; SEC-D1 INE huérfano; bandera legal PII en
  snapshots económicos; nota multi-instancia de jobs → devops).

**¿Puede ir a main?** **SÍ.** No hay hallazgos **Críticos ni Altos** abiertos en v1.9-set-chart → no
procede RECHAZO (`CLAUDE.md` §7). La revisión **estática basta para el merge a `main`**: el cambio es
aditivo, sin dinero saliente ni PII nuevos, sin superficie que exija DAST en vivo específico (no hay fetch
disparado por el cliente ni entrada que arme la URL externa). El egress bloqueado a pokemontcg.io en esta
sesión **no** impide dictaminar, porque el fetch es server-side con host fijo y ya está cubierto por los
guardarraíles estáticos verificados.

**Condición para DINERO REAL (no para el merge):** se mantiene la **fase dinámica (DAST contra staging)**
como **PENDIENTE Y OBLIGATORIA** antes de producción (heredada, §6). Para este bloque en concreto, cuando
haya staging, conviene validar: throttle/scraping de la gráfica pública (SEC-F1) y el rate-limit del
`set-price-sync` contra pokemontcg.io en multi-instancia. Nada de eso bloquea el merge a `main`.

---

## SC.9 VEREDICTO — SAST-1 (endurecimiento cripto GCM en PII) · commit `8f21f50`

> **Rev:** v1.10-sast-gcm. **Fecha:** 2026-08-16. **Rama:** `claude/git-repo-review-c67xyk`.
> **Alcance:** verificación del fix del hallazgo REAL que destapó el gate SAST (semgrep
> `javascript.node-crypto.security.gcm-no-tag-length`) en `backend/src/common/crypto/pii-crypto.service.ts`.
> **Insumo:** `PENTEST_NOTES.md` §PII + `TECH_DEBT.md` SAST-1. **Modo:** revisión estática + reproducción
> del vector con `node:crypto` + ejecución de `test/pii-crypto.spec.ts` (10/10 verde). Endurecimiento puro
> de defensa en profundidad sobre PII (CLABE/RFC/INE); **sin dinero saliente** en el cambio.

**VEREDICTO seguridad: APROBADO.** 0 Críticos / 0 Altos / 0 Medios abiertos. Puede ir a `main`.

Verificación punto por punto (lo pedido):

1. **Cierra el vector real — SÍ.** Reproduje en `node:crypto` que el path viejo
   (`createDecipheriv('aes-256-gcm', key, iv)` **sin** `authTagLength`) **acepta y descifra** un authTag
   truncado a 12 bytes (OpenSSL permite tags GCM más cortos → autenticidad debilitada, riesgo de forja
   sobre el ciphertext `v1:iv:tag:ct` almacenado en BD). El código nuevo (`decrypt`, `:129-131`) valida
   `tag.length !== 16` **antes** de `setAuthTag` y lanza, de modo que un tag ≠ 16B **jamás** llega al
   verificador. Para el caso legítimo la verificación GCM **queda intacta**: el tag de 16B se pasa a
   `setAuthTag` y `decipher.final()` sigue lanzando ante ciphertext/tag manipulados (test "detecta
   manipulación del authTag" sigue verde). Vector **cerrado**.

2. **Retrocompatibilidad — SÍ, sin ruptura de datos.** Reproduje: dato cifrado por el path **viejo**
   (sin `authTagLength`) produce un tag de **16 bytes** vía `getAuthTag()`, y descifra **idéntico** con el
   path **nuevo** (`authTagLength: 16`). Motivo: `getAuthTag()` de AES-256-GCM **siempre** devolvió 16B,
   así que todo registro existente ya cumple `tag.length === 16` y pasa el guard. El formato serializado
   (`v1:iv:tag:ct`, base64 por campo), el `VERSION`, el IV de 12B y las claves **no cambian**. Cero
   migración de datos requerida.

3. **Sin oráculo / side-channel — OK (residuo Bajo, no explotable).** El mensaje `'Malformed PII
   ciphertext'` es **idéntico** para tag-mal-formado (longitud ≠ 16) y para payload-mal-formado
   (`parts.length !== 4` / versión), así que no distingue el motivo al atacante. Timing: el guard de
   longitud lanza **antes** de trabajo cripto, luego un tag de longitud incorrecta responde algo más
   rápido que un tag de 16B-pero-incorrecto — pero esa diferencia **solo revela la longitud del tag que
   el propio atacante envió** (dato que ya controla); **no filtra** nada del secreto ni del tag correcto.
   La comparación real del tag GCM la hace OpenSSL en tiempo constante. Side-channel **no explotable**;
   dictamen **Bajo, aceptado sin acción**.

4. **Sin regresión — confirmado.** El formato serializado y las claves no cambian. El **blind index**
   (`blindIndex`/`clabeBlindIndex`, HMAC-SHA256) y `blindIndexEquals` (`timingSafeEqual`) **no se tocan**
   (diff limitado a `encrypt`/`decrypt` + constante `TAG_BYTES`). Tests de blind index (determinismo,
   normalización, comparación en tiempo constante, dependencia de clave) **verdes**. Guardarraíles de
   dinero/PII previos (enmascaramiento por defecto, `reveal-clabe` money-out+auditado, INE huérfano)
   **sin cambio** — el commit no toca controllers ni superficie de red.

5. **¿Suficiente? — SÍ.** El fix resuelve la causa raíz de la regla semgrep (fija `authTagLength: 16` en
   ambos `createCipheriv`/`createDecipheriv`) y **añade** el guard de longitud como cinturón-y-tirantes.
   No queda nada abierto del hallazgo. Nota menor (defensa en profundidad, **no bloqueante, sin owner de
   acción**): la robustez sigue dependiendo de que el authTag no se corrompa en BD; la integridad GCM ya
   lo cubre y el guard de longitud lo refuerza — no se requiere endurecimiento adicional.

**Estado del hallazgo:** **SAST-1 — CERRADO/RESUELTO.** Se retira de deuda abierta; queda como registro
histórico en `TECH_DEBT.md`. Reproducción y tests: `backend/test/pii-crypto.spec.ts` (10/10),
verificación del vector legacy vs. nuevo con `node:crypto` en esta sesión.

**¿Puede ir a `main`?** **SÍ.** No hay Críticos/Altos abiertos (`CLAUDE.md` §7). Cambio retrocompatible,
sin dinero saliente ni PII nueva expuesta, solo endurecimiento interno. La **fase dinámica (DAST contra
staging)** heredada sigue **pendiente y obligatoria antes de operar con dinero real** (§6) — no bloquea
este merge. El veredicto **QA** sobre este commit (toca PII/cripto) sigue su curso en paralelo; este
dictamen cubre **solo** la dimensión de seguridad.

---

# D. Revisión v1.11-ola1-wiring — Wiring del panel de admin (dinero + PII)

> **Rev:** v1.11-ola1-wiring. **Fecha:** 2026-08-17. **Rama:** `claude/git-repo-review-c67xyk`.
> **Alcance:** commits `751d637` (backend Tier 0: `escalatePending(finish)` + `pendingQueue`
> con `include card+set`) y `e8591d3` (frontend: wire M5 buylist end-to-end, M3 refund, M8
> disputas, M4 envíos admin, M1 picker; `api.ts` + `contract.ts` + i18n). Superficie sensible:
> **dinero saliente** (pay-SPEI, refund, decisión de buylist con cap, recompra de disputa) y
> **PII** (revelar CLABE en claro).
> **Insumo:** `PENTEST_NOTES.md` v1.5 (I-3 SEC-A1, I-5 money-out/PII) + este código.
> **Modo:** revisión **estática** de código (frontend `M5View.tsx`, `QueryState.tsx`, `api.ts`,
> `api-client.ts`; backend `admin-buylist.controller.ts`, `buylist.service.ts`, `buylist.dto.ts`,
> `pricing.service/controller.ts`, `all-exceptions.filter.ts`, `money-out.guard.ts`). Sin stack
> vivo → DAST sigue **pendiente** (§6). Es **wiring de UI** sobre endpoints ya endurecidos; **no
> hay nueva lógica de dinero**.

## D.0 Resumen — 0 Críticos / 0 Altos / 0 Medios. APROBADO, puede ir a `main`

| Severidad | # | ID |
|---|---|---|
| Crítica | 0 | — |
| Alta | 0 | — |
| Media | 0 | — |
| Baja | 0 nuevos (1 nota de higiene, no hallazgo) | — |

Los seis focos del encargo se verificaron **OK en código**. El wiring respeta la regla de oro:
**el backend es la autoridad**; el cliente solo dispara endpoints y no deriva ni impone montos ni
autorización. La **revisión estática BASTA** para este bloque: no introduce lógica de dinero nueva
ni superficie de red nueva (todos los endpoints ya existían y estaban endurecidos/auditados); solo
cablea UI → API. Los vectores dinámicos (concurrencia real de pay-SPEI/refund, idempotencia con
llamadas reales) ya estaban en la lista **[pendiente de DAST]** y no cambian con este commit.

## D.1 SEC-A1 / dinero server-side — **OK · [Verificado en código]**
- **Buylist decisión (`adjust`/`approve`):** el frontend manda `approvedPriceCents`
  (`M5View.tsx:373-378`, `pesosToCents` → **centavos enteros** vía `Math.round(n*100)`, `:30-36`),
  pero el **cap lo impone el backend**: `ItemDecisionDto` valida `@Min(0) @Max(1_000_000)`
  (`buylist.dto.ts:63`, primera línea, rechazo 400 al PoC `99999999`) **y**
  `BuylistService.assertApprovedPriceWithinCap` (`buylist.service.ts:493-510`) aplica la cota fina
  server-side: `min(quotedPriceCents × 2, capAML)` — con `capAML` = `kyc.capPerRequestCentsOverride`
  o dial global (`:530-532`) — y lanza **422 `APPROVED_PRICE_CAP_EXCEEDED`** (`:504-508`). El
  cliente **no** puede saltarse el cap: aunque mande un monto arbitrario, el server lo rechaza. El
  modal muestra ese error real **dentro** del modal (`M5View.tsx:115`, `setAdjustError`). Confirmado.
- **pay-SPEI:** el body es **solo** `{ speiReference }` (`api.ts` `paySpeiBuylist`), sin monto — el
  server paga `approvedTotalCents` derivado de la suma de `approvedPriceCents` aprobados
  (`buylist.service.ts:564-575`). **Refund:** body **solo** `{ reason }`
  (`api.ts` `refundOrder`), sin monto — el server reembolsa contra el cargo Stripe original.
  **Recompra de disputa:** body `{ resolution, note }` (`resolveDispute`), sin monto. Ningún flujo
  de dinero saliente acepta un importe arbitrario del cliente. Confirmado.

## D.2 Revelar CLABE (PII) — **OK · [Verificado en código]**
- **Bajo demanda + efímero:** `revealBuylistClabe` es una **mutation** (no query) precisamente para
  que la CLABE en claro **NO** entre al cache de react-query (`M5View.tsx:146-154`, comentario
  explícito). Se guarda **solo** en estado local de la vista `revealed` (`:60`), nunca en estado
  global/localStorage/query-cache. Se descarta al **ocultar** (`setRevealed(null)`, `:315`) y —
  higiene— **al registrar el pago SPEI** (`:166`). No hay `console.log`/logger de la CLABE en el
  frontend. Confirmado.
- **Endpoint super_admin + auditado server-side:** `GET /admin/buylist/:id/reveal-clabe` con
  `@Roles(Role.super_admin) @MoneyOut()` (`admin-buylist.controller.ts:48-50`) y `audit.log`
  `buylist.reveal_clabe` con actor/rol/entidad (`:52-60`). Es el ÚNICO endpoint que devuelve CLABE
  en claro; el resto enmascara (verificado sin regresión en §2). El `disabled={!isSuperAdmin}` del
  botón (`M5View.tsx:322`) es **cosmético**; la autoridad es el guard server-side. Confirmado.

## D.3 Doble cobro / doble reembolso — **OK · [Verificado en código]**
- **Idempotency-Key estable:** pay-SPEI envía `Idempotency-Key: pay-spei-${id}` (`api.ts`
  `paySpeiBuylist`) y refund `Idempotency-Key: refund-${orderId}` (`api.ts` `refundOrder`). La clave
  es **estable por solicitud/orden**: un reintento del mismo pago/refund reusa la misma clave → el
  backend no duplica el asiento. Correcto (la eficacia real de la deduplicación bajo concurrencia se
  valida en DAST, ya listado §6, sin cambio). Nota: la clave es determinística por recurso, que es
  el diseño correcto para "un pago por solicitud" (no un UUID por click). Confirmado.

## D.4 Autorización — **OK · [Verificado en código]**
- Los guards son **server-side y globales**: `MoneyOutGuard` (`money-out.guard.ts:32-44`, rol ≠
  `super_admin` → **403 `MONEY_OUT_FORBIDDEN`** auditado) sobre `reveal-clabe`/`pay-spei`/`refund`/
  recompra; `@Roles` en controllers (`AdminBuylistController` = `vault_operator+`, con
  `reveal-clabe`/`pay-spei` estrechados a `super_admin`). El wiring **no puede** saltarlos: el
  cliente ocultar/deshabilitar botones (`isSuperAdmin`, `canPay`, `M5View.tsx:194-195,322,333`) es
  **cosmético**, no un control de seguridad — una llamada directa a la API la corta el guard. El
  código lo reconoce explícitamente (comentarios en M5View y en `SuperAdminOnly`, §A.4). **No se
  asume seguridad en el cliente.** Confirmado.

## D.5 Fuga en errores (`useErrorMessage`) — **OK · [Verificado en código]**
- `useErrorMessage` (`QueryState.tsx:23-32`) traduce `errorCode` del contrato a copy i18n; si no hay
  copy, cae al **`ApiClientError.message` real del backend** (para no ocultar topes AML al operador).
  **Dictamen: seguro.** El filtro global (`all-exceptions.filter.ts`) **nunca** devuelve stack ni
  detalle interno en `message`: (a) `BusinessException` → mensaje curado del dominio
  (`:25-31`); (b) `HttpException` → mensaje de la lib / validación class-validator (`:34-47`);
  (c) **cualquier excepción no controlada → `500` con `message: 'Internal server error'` genérico y
  el stack se loguea SOLO server-side** (`:50-53`). Por tanto lo máximo que `useErrorMessage` puede
  pintar es un mensaje de negocio controlado (p. ej. "Approved price exceeds the allowed cap"),
  nunca stack/PII/IDs internos de infraestructura. Confirmado.
  - **Nota (no hallazgo, defensa en profundidad):** el filtro copia `details` = objeto crudo de la
    `HttpException` al cuerpo (`:45`); `useErrorMessage` **no** lo renderiza (solo `message`), así que
    no hay fuga por la UI. Si en el futuro se pintara `details`, revisar que no arrastre datos. Sin
    acción para este bloque.

## D.6 Backend Tier 0 (`751d637`) — **OK · [Verificado en código]**
- **`pendingQueue` con `include card+set`:** el endpoint `GET /admin/pricing/pending` es
  `@Controller('admin/pricing') @Roles(Role.super_admin)` (`pricing.controller.ts:53-54,72-74`) —
  **solo super_admin**. El `include` expone `card{id,name,number,setName}` + `cardName`
  (`pricing.service.ts:pendingQueue`), que es **catálogo público** (ya es superficie pública en
  "Compra"); **no** añade PII, precios internos, costo de adquisición ni datos de otros usuarios.
  El `map` proyecta explícitamente solo esos 4 campos de card (no derrama la fila `Card` completa).
  No expone nada que no deba en un endpoint admin. Confirmado.
- **`escalatePending(...finish)`:** propagar el `finish` resuelto a la cola es una corrección de
  **exactitud funcional** (M-19: cola por acabado), **sin efecto de seguridad** — no toca authz,
  dinero saliente ni PII. Confirmado.

## D.7 VEREDICTO — v1.11-ola1-wiring: **APROBADO**
- **0 Críticos / 0 Altos / 0 Medios abiertos** → aprobable por política (`CLAUDE.md` §7). SEC-A1
  intacto (montos derivados/validados server-side; cap 2×/AML impuesto por el backend, no por el
  cliente); CLABE revelada bajo demanda, efímera, sin persistencia/log/cache y con endpoint
  super_admin+money-out+auditado; idempotencia estable en pay-SPEI/refund; autorización 100%
  server-side (UI cosmética); `useErrorMessage` no filtra detalle interno (500 genérico + stack solo
  en log); `pendingQueue` (super_admin) solo expone catálogo público.
- **¿Basta la revisión estática?** **SÍ** para este bloque: es wiring UI→API sin lógica de dinero
  nueva ni endpoints nuevos; toda la superficie de red ya estaba endurecida y auditada. Los vectores
  dinámicos (concurrencia/idempotencia con tráfico real) ya estaban en la lista **[pendiente de
  DAST]** (§6) y **no** los altera este commit.
- **Sin hallazgos que enrutar.** Deuda previa sin cambio (S-M1 aceptada; S-B1/S-B2/residuo S-B3 y
  banderas legales de PII, §5-§6). La **fase dinámica (DAST contra staging)** heredada sigue
  **pendiente y obligatoria antes de operar con dinero real** (§6) — no bloquea este merge.
- **¿Puede ir a `main`?** **SÍ.**

---

# E. Revisión Ola 2 — Gestión de inventario M1 (commit `a72f6e6`) · rama `claude/git-repo-review-c67xyk`

> **Alcance:** wiring de UI a la gestión de inventario M1 del operador — tabla con filtros +
> paginación, detalle por pieza con historial, publicar/retirar de venta (`listPriceCents` manual),
> mover, marcar perdida/dañada, y gestor de ubicaciones. Toca **dinero** (precio de venta al
> publicar) y **estado de bienes en custodia** (perdida/dañada → responsabilidad/reposición).
> **Modo:** revisión **estática** de código (diff `a72f6e6` + endpoints backend ya existentes).
> El commit es **frontend-only** (12 archivos: `frontend/` + `docs/FRONTEND_NOTES.md` + `docs/TECH_DEBT.md`);
> **no toca `backend/`** — los endpoints M1 ya existían y estaban endurecidos.
> **Fecha:** 2026-08-17. Blanco autorizado: staging/local.

## E.0 Resumen — **0 Críticos / 0 Altos / 0 Medios / 0 Bajos nuevos**

El commit es **wiring puro UI→endpoints M1 ya endurecidos**. No introduce endpoints nuevos, ni
lógica de dinero saliente, ni superficie de red nueva. Todos los guards de rol son **server-side y
globales**; la UI es cosmética. **SEC-A1 intacto.** Sin regresión en dinero/PII.

## E.1 SEC-A1 / precio de venta (`listPriceCents`) — **OK · [Verificado en código]**
- **Es entrada MANUAL legítima del operador**, no una derivación que el server deba calcular. El
  operador captura el precio en **pesos** y el cliente lo convierte a centavos con `Math.round(Number(price)*100)`
  (`ItemDetailModal.tsx:61`); se envía como `listPriceCents` en `PATCH /admin/inventory/items/:id`.
  Es el **precio de venta** (override manual) — exactamente lo que PROJECT.md §A/§B autoriza al
  admin a fijar (sellado con precio manual; markup sobre referencia). El comentario del código lo
  reconoce: *"precio de venta MANUAL (override), no una derivación en cliente (SEC-A1)"* (`:57-59`).
- **La valuación de REFERENCIA sigue server-side.** El cliente **nunca** envía ni puede manipular
  `referenceValue`: lo recibe del server (display-only, `PriceTag mode="reference"`, `:169-176`) y
  el backend lo deriva vía `PricingService.getReference(...)` (`inventory.service.ts:48`). El DTO de
  entrada (`UpdateItemDto`) solo acepta `status/listPriceCents/certNumber/gradeValue/sealedSubtype`
  (`inventory.dto.ts:42-49`) — **no** hay campo de referencia/costo manipulable por el cliente.
- **Invariantes validadas en el backend, no en el cliente:**
  - Sellado exige `listPriceCents` para publicar — el cliente lo pre-bloquea (`sealedNeedsPrice`,
    `:64-65`, botón `disabled`) pero es **cosmético**; el gate real está en el servicio (escalado a
    "precio pendiente" si falta, `inventory.service.ts:72-83`).
  - Gradeada publicada exige `certNumber` no vacío — revalidado en el **UPDATE** (no solo en alta):
    `updateItem` recomputa el estado resultante y lanza `422 VALIDATION_ERROR` si queda `listed` sin
    cert (`inventory.service.ts:240-252`). Un `PATCH` no puede publicar una gradeada sin certificado.
  - `@Min(0)` en `listPriceCents` (`inventory.dto.ts:47`) vía `ValidationPipe({whitelist:true})`.
- **Residuo (sin cambio, ya registrado):** `listPriceCents` sin `@Max` — es el pentest **B-3**
  (dinero en `Int` 32-bit + cota superior), ya en §5 como **Baja aceptada** enrutada a
  arquitecto/backend. Entrada confiable (super_admin/operador), no explotable por externo; este
  commit **no** lo agrava. **Sin acción para este bloque.**

## E.2 Marcar perdida/dañada — **OK · [Verificado en código]**
- **Endpoint admin + auditado server-side.** `POST /admin/inventory/items/:id/mark` cuelga de
  `InventoryController` con `@Roles(Role.vault_operator, Role.super_admin)` a nivel de clase
  (`inventory.controller.ts:18-19`) → enforced por el `RolesGuard` **global**
  (`app.module.ts:65`, `APP_GUARD`). El controlador **audita siempre**: `audit.log` con
  `action: inventory.mark_${dto.mark}`, actor, rol, entidad y `after:{note}` (`:109-117`).
- **Nota obligatoria a nivel de DTO.** `MarkItemDto.note` es `@IsString()` **sin** `@IsOptional`
  (`inventory.dto.ts:56-59`) → una llamada directa sin nota es **422**. El cliente además
  deshabilita el botón con `markNote.trim() === ''` (`ItemDetailModal.tsx:325`), pero eso es
  **redundante/cosmético**: la obligatoriedad la impone el backend. La nota queda registrada en el
  `InventoryMovement` (`reason: lost|damaged`, `note`, `actorUserId`, `inventory.service.ts:279-288`)
  **y** en el audit-log.
- **Nota de negocio (no hallazgo):** marcar perdida/dañada dispara la **responsabilidad de reposición**
  (PROJECT.md §H, tope por carta configurable en M10). El `mark` en sí **no** ejecuta dinero saliente
  (no hay reembolso/pago aquí); la reposición/compensación es un flujo aparte (M3/M8) ya restringido a
  `super_admin` por `MoneyOutGuard`. Correcto que un `vault_operator` pueda marcar el estado físico
  pero **no** sacar dinero.

## E.3 Autorización de las 6 acciones — **OK · [Verificado en código]**
- Las 6 (list tabla / detalle / publicar-retirar / mover / marcar / ubicaciones) cuelgan del mismo
  `InventoryController` con `@Roles(vault_operator, super_admin)` de clase — **todas** protegidas
  server-side por la cadena de guards globales `JwtAuthGuard → RolesGuard → EmailVerifiedGuard →
  MoneyOutGuard` (`app.module.ts:63-67`). El `RolesGuard` corta con `403 FORBIDDEN` si el rol no
  está en la lista (`roles.guard.ts:25-27`).
- **El cliente no asume seguridad:** el gating de la UI (`canPublish`/`canUnlist`/`canOperate` por
  estado del item, `ItemDetailModal.tsx:122-124`; botones `disabled`) es **conveniencia visual**, no
  control de acceso. Una llamada directa a cualquiera de los 6 endpoints la corta el guard. Consistente
  con el patrón ya dictaminado en §A.4/§D.4 (botones cosméticos, autoridad server-side).

## E.4 Fuga de datos — **OK · [Verificado en código]**
- **Detalle admin-only, sin PII de cliente de más.** `GET /admin/inventory/items/:id`
  (`getItem`, `inventory.service.ts:219-230`) incluye `card{+set}`, `location` y `movements`. El
  `InventoryItem` de bóveda es `ownerType: 'platform'` y el `include` **no** trae relación de
  usuario/cliente, CLABE, INE ni RFC. El historial (`InventoryMovementDTO`) expone `actorUserId`
  (id de **staff** que ejecutó el movimiento, no un cliente) + `note` (texto del operador) +
  ubicaciones/estados — **sin PII de comprador**. La UI tampoco pinta `actorUserId`
  (`ItemDetailModal.tsx:340-367`). Endpoint tras `@Roles(vault_operator, super_admin)`.
- **`useErrorMessage` no filtra internos.** Sin cambio respecto a §D.5: traduce `errorCode`; si no
  hay copy, cae al `message` **curado** del backend; el `all-exceptions.filter` devuelve `500`
  genérico para excepciones no controladas (stack solo en log server-side). Lo máximo que puede
  pintar es un error de negocio (`PRICE_PENDING`, `FINISH_NOT_AVAILABLE`, `VALIDATION_ERROR`), nunca
  stack/PII. Confirmado.

## E.5 ¿Lógica de dinero o superficie de riesgo nueva? — **NO**
- El único dinero es `listPriceCents` (override manual, §E.1) — ya existía como campo y flujo. **No**
  hay endpoints nuevos, **no** hay dinero saliente, **no** hay `$queryRaw`, **no** hay nuevos campos
  de entrada sensibles (los DTOs `Update/Move/Mark/CreateLocation` están acotados por `IsIn/IsString/@Min`).
  El refactor de `paginate<T>`/`mockJobId`/`mockTempPassword` toca **solo ramas mock** (deuda techlead
  Ola 1) — sin efecto en producción. Las nuevas queries de filtro usan **Prisma parametrizado**
  (`listItems`, `inventory.service.ts:199-216`), con `pageSize` **capado a 100** server-side
  (`inventory.controller.ts:59`) → sin abuso de paginación.

## E.6 VEREDICTO — Ola 2 M1 (`a72f6e6`): **APROBADO**
- **0 Críticos / 0 Altos / 0 Medios / 0 Bajos nuevos** → aprobable por política (`CLAUDE.md` §7 y DoD).
- **SEC-A1 intacto:** `listPriceCents` es override manual legítimo del operador; la **referencia** de
  mercado se deriva/valida **server-side** y el cliente no puede manipularla. Invariantes
  (sellado exige precio, gradeada publicada exige cert) impuestas por el backend.
- **Perdida/dañada:** endpoint `vault_operator+`, **auditado**, nota **obligatoria** en DTO; el estado
  físico lo mueve el operador pero el dinero saliente sigue vetado (`MoneyOutGuard` → `super_admin`).
- **Autorización 100% server-side** en las 6 acciones (guards globales); UI cosmética. Sin fuga de
  PII en el detalle; `useErrorMessage` sin regresión.
- **¿Basta la revisión estática?** **SÍ** para este bloque: es wiring UI→endpoints M1 preexistentes y
  endurecidos, sin lógica de dinero nueva ni superficie de red nueva. Los vectores dinámicos
  (concurrencia, idempotencia, rate-limit con tráfico real) ya están en la lista **[pendiente de DAST]**
  (§6) y **no** los altera este commit.
- **Deuda previa sin cambio:** B-3/S-B3 (`listPriceCents` sin `@Max`, dinero en `Int` 32-bit) sigue
  **aceptada con disparador** enrutada a arquitecto/backend; **no** bloquea este merge. Banderas
  legales de custodia/PII (§6) siguen abiertas para el humano, sin cambio.
- **¿Puede ir a `main`?** **SÍ.**

---

# F. Revisión Fase 0 — Epic de precios / cierre del bypass del umbral INE (commit `ebb4dee`) · rama `claude/git-repo-review-c67xyk`

> **Alcance:** Fase 0 del epic de precios. Foco de seguridad: (0.3) cierre del **bypass del umbral
> INE / topes AML** vía líneas `precio_pendiente`; (0.1) **gate premium** del clasificador de rareza
> que corrige la **subcotización** de chase sin abrir money-out; y verificación de que **SEC-A1**
> (montos derivados/validados server-side) sigue intacto, incluida la **regresión positiva B-4**
> (cap de aprobación).
> **Modo:** revisión **estática** de código (buylist/pricing/money) cruzada con `docs/PENTEST_NOTES.md`.
> Sin stack vivo (R2/Railway sin configurar) → los vectores de concurrencia siguen **[pendiente de
> DAST]** (§6). **Fecha:** 2026-08-17. Blanco autorizado: staging/local.

## F.0 Resumen — **0 Críticos / 0 Altos**; 1 Media + 2 Bajas abiertas (no bloqueantes, con disparador)

| Severidad | # | ID / tema |
|---|---|---|
| Crítica | 0 | — |
| Alta | 0 | — |
| Media | 1 | **F-1** — contabilidad AML mensual no re-cuenta ítems que fueron `precio_pendiente` |
| Baja | 2 | **F-2** — allowlist `isPremiumRarity` finita (chase antiguas subcotizan); **F-3** — dedup de `escalatePending` no atómico |

## F.1 Bypass del umbral INE — **CERRADO · [Verificado en código]**
- **El hueco (pentest):** un ítem `precio_pendiente` suma **0** a `quotedTotalCents`, que es la base
  del tope por-solicitud, el tope mensual y el **umbral INE**. Un cliente podía enviar una carta CARA
  **sin referencia** → sumaba $0 → no se le exigía INE ni topaba contra los caps AML.
- **El cierre:** `buylist.service.ts:221-227` — `hasPendingLine = itemsData.some(i => i.itemStatus
  === 'precio_pendiente')` y `ineRequired = quotedTotalCents >= ineThreshold || hasPendingLine`. Si
  hay **≥1 línea pendiente**, se **EXIGE INE** (`INE_REQUIRED`, 422) por decisión conservadora: la
  incertidumbre del monto se trata como potencialmente por encima del umbral. **Solo endurece**; no
  debilita ningún control existente. Confirmado en código.

## F.2 Gate premium (Fase 0.1) — corrige subcotización SIN abrir money-out — **OK · [Verificado en código]**
- `common/money.ts:149` `isPremiumRarity(rarity)` + `:177-184`: una rareza **premium/chase** SIEMPRE
  cotiza por **su propia regla** (o fallback pct) y **NUNCA** cae al bin "Holo" ni a un plano de menor
  valor. Corrige el **bug de dinero** por el que una holo premium sin "holo" en el string resolvía a
  una referencia más barata (**subcotización** = la plataforma pagaba de menos, o el precio de venta
  quedaba bajo). El fix mueve el precio **hacia arriba** para el chase — **no** abre un vector de
  dinero saliente: la cotización sigue siendo **entrada al server** derivada de `Card.rarity` real, no
  del DTO (**SEC-A1 intacto**, §F.3). Sin impacto de authz ni de desembolso.

## F.3 SEC-A1 y regresión positiva B-4 — **INTACTOS · [Verificado en código]**
- **SEC-A1:** los montos se derivan de la **rareza real** de la carta (`prisma.card` server-side),
  no del cliente; el DTO no transporta `category`/precio manipulable. Sin cambio respecto a §B.4.
- **B-4 → MITIGADO (regresión positiva):** `assertApprovedPriceWithinCap`
  (`buylist.service.ts:510`, invocado en approve/adjust `:556,562`) topa la aprobación a
  **min(quotedPriceCents × 2, capAML)** → `422 APPROVED_PRICE_CAP_EXCEEDED`. Un `vault_operator` no
  puede aprobar montos arbitrarios; el desembolso SPEI sigue `@MoneyOut` **super_admin + auditado** y
  usa el monto **capado** como base de costo. Ya registrado como cerrado (S-B5, §1247); se re-confirma
  intacto tras la Fase 0.

## F-1 (Media, abierta con disparador) — Contabilidad AML mensual no re-cuenta lo que fue `precio_pendiente`
- **Ubicación:** `buylist.service.ts:294-307` (`monthUsedCentsTx`).
- **Descripción:** el acumulado mensual agrega `_sum: { quotedTotalCents }` de las `SellRequest` del
  mes. Un ítem que entró como `precio_pendiente` aportó **0** al `quotedTotalCents` **persistido** de
  su solicitud; cuando luego se **resuelve/aprueba** con un `approvedTotalCents` > 0, ese monto real
  **no** vuelve a sumarse al acumulado mensual (el agregado sigue leyendo `quotedTotalCents`, no
  `approvedTotalCents`). Un cliente que reparta cartas caras como pendientes puede, en teoría, **quedar
  por debajo del tope mensual AML medido** aunque el dinero efectivamente desembolsado lo supere.
- **Por qué NO es bloqueante (compensado, defensa en capas):** (1) **INE-con-pendiente** ya exige
  identificación ante cualquier línea pendiente (§F.1) → no hay anonimato; (2) el **cap por-solicitud**
  (`BUYLIST_LIMIT_EXCEEDED`, `:201-207`) sigue acotando cada solicitud; (3) **money-out** de la
  recompra está tras `@MoneyOut` **super_admin + auditado** (revisión humana del desembolso). El
  faltante es de **medición contable AML**, no un money-out sin control.
- **Rol dueño:** **backend** — que el acumulado mensual cuente el **monto efectivo** (usar
  `approvedTotalCents` cuando exista, o re-imputar al resolver el pendiente). **Disparador: abrir
  ticket a backend ANTES de operar con dinero real / volumen que dispare reportes AML/PLD.**

## F-2 (Baja, abierta con disparador) — Allowlist `isPremiumRarity` finita → chase antiguas subcotizan
- **Ubicación:** `common/money.ts:149` (`isPremiumRarity`).
- **Descripción:** la allowlist premium cubre el set moderno (V/VMAX/VSTAR/EX/GX/Illustration/Ultra/
  Double Rare, etc.) pero **no** rarezas chase **antiguas** (Shining, Prime, LEGEND, BREAK, ACE
  SPEC...). Esas caen al camino no-premium y pueden **subcotizar** (referencia más baja de la debida).
- **Impacto:** **subcotización** (la plataforma paga/vende de menos) — **no** hay money-out inflado ni
  fuga; es pérdida de exactitud de precio, no un hueco de dinero saliente. Se prefiere sobre-incluir.
- **Rol dueño:** **backend/arquitecto** — extender la allowlist (o mover a catálogo de rarezas
  configurable). **Disparador:** al incorporar inventario/buylist de sets vintage relevantes.

## F-3 (Baja, abierta con disparador) — Dedup de `escalatePending` no atómico → duplicados bajo concurrencia
- **Ubicación:** `pricing.service.ts:189-195` — `findFirst({... status:'open'})` **y luego**
  `create(...)`, sin `@@unique` en `PendingPriceEntry` (`schema.prisma`).
- **Descripción:** patrón **read-then-write** sin unicidad a nivel de BD: dos escalaciones concurrentes
  del mismo `(cardId, productType, gradeKey, finish)` pueden ambas ver "no open" y crear **dos**
  entradas pendientes duplicadas.
- **Impacto:** ruido en la cola de precios pendientes (el operador resuelve dos veces la misma carta);
  **sin** efecto de dinero saliente, authz ni PII. Solo higiene de datos.
- **Rol dueño:** **backend** (+ **arquitecto** por el schema) — añadir `@@unique` parcial sobre
  `(cardId, productType, gradeKey, finish)` para `status='open'` (o upsert idempotente). **Disparador:**
  antes de exponer el buylist a concurrencia real / múltiples réplicas.

## F.4 Banderas para el humano (Fase 0)
- **Compliance/legal AML-PLD:** validar la **política AML** implementada — (a) exigir **INE ante
  cualquier línea pendiente** (§F.1) y (b) la **contabilidad mensual actual** (§F-1, que hoy mide sobre
  `quotedTotalCents`). Confirmar con compliance que el umbral, los topes y la medición efectiva
  cumplen la normativa de PLD antes de operar con dinero real.
- **DAST de concurrencia de buylist — PENDIENTE (heredado, obligatorio antes de prod):** mantener en la
  cola de DAST los vectores de **carrera de `escalatePending`** (F-3) y **carrera del cap mensual**
  (`monthUsedCentsTx` bajo tráfico concurrente, ya cubierto por el aislamiento SERIALIZABLE en código
  pero sin validación dinámica). Ejecutar en cuanto haya **staging autorizado** (§6).

## F.5 VEREDICTO — Fase 0 (epic de precios, `ebb4dee`): **APROBADO** (2026-08-17)
- **0 Críticos / 0 Altos abiertos** → aprobable por política (`CLAUDE.md` §7 y DoD).
- **Bypass del umbral INE CERRADO** (`ineRequired = quotedTotalCents >= umbral || hayLíneaPendiente`,
  `buylist.service.ts:221-227`). **SEC-A1 intacto**; el **gate premium (0.1)** corrige la
  subcotización de chase **sin** abrir money-out. **Regresión positiva:** **B-4 mitigado** por
  `assertApprovedPriceWithinCap` (aprobación topada a **min(quoted × 2, capAML)**).
- **Abiertos NO bloqueantes (con disparador):** **F-1 (Media)** contabilidad AML mensual sobre
  `quotedTotalCents` en vez del monto efectivo — compensado por INE-con-pendiente + cap por-solicitud +
  money-out super_admin auditado; **abrir ticket a backend ANTES de operar con dinero real / volumen
  AML**. **F-2 (Baja)** allowlist premium finita (subcotización de chase antiguas), dueño
  backend/arquitecto. **F-3 (Baja)** dedup de `escalatePending` no atómico (duplicados bajo
  concurrencia), dueño backend + arquitecto (schema).
- **Deuda previa sin cambio:** S-M1 aceptada; S-B1/S-B2/residuo S-B3 y banderas legales de custodia/PII
  (§5-§6) siguen abiertas para el humano. La **fase dinámica (DAST contra staging)** heredada sigue
  **pendiente y obligatoria antes de operar con dinero real** (§6) — no bloquea esta Fase 0.
- **¿Puede ir a `main`?** **SÍ.**

---

# G. Revisión Fase 1 — catálogo priceado + job 2×/día (commit `a6a79df`) · rama `claude/git-repo-review-c67xyk`

> **Alcance:** Fase 1 del epic de precios (diseño v1.12-catalog-pricing). Focos de seguridad:
> (1.1) priceado de **TODO el catálogo** durante `catalog-sync` (`PricingService.persistMarketReference`
> + `catalog-sync.service.persistMarketReferences`); (1.2) **`publicQuote` de vuelta a READ-ONLY**
> (cierra **BE-16**: el endpoint anónimo ya no escribe en la cola de trabajo); (1.3) **job
> `catalog-price-sync` 2×/día** (BullMQ repeatable, `syncAll force:true`) + disparo manual
> `POST /admin/jobs/catalog-price-sync`. Verifico authz/auditoría, integridad de dinero (FX/market/
> override), manejo de la API key y anti-abuso.
> **Modo:** revisión **estática** de código cruzada con `docs/PENTEST_NOTES.md`. Sin stack vivo
> (R2/Railway sin configurar) → concurrencia sigue **[pendiente de DAST]** (§6).
> **Fecha:** 2026-08-17. Blanco autorizado: staging/local.

## G.0 Resumen — **0 Críticos / 0 Altos**; 2 Bajas abiertas (no bloqueantes, con disparador)

| Severidad | # | ID / tema |
|---|---|---|
| Crítica | 0 | — |
| Alta | 0 | — |
| Media | 0 | — |
| Baja | 2 | **G-1** — TOCTOU en `persistMarketReference` (guard `isManualOverride` no atómico); **G-2** — `catalog-price-sync` sin `@Throttle` propio (single-flight mitiga) |

## G.1 Cierres / positivos verificados — **[Verificado en código]**
- **BE-16 CERRADO — `publicQuote` read-only.** `buylist.service.ts:58-102`: el cotizador público
  **elimina** la escalada a `PendingPriceEntry` que la Fase 0 había agregado; si el acabado sigue
  `precio_pendiente`, el quote lo **reporta sin escribir nada** (`:76-82`). Un endpoint público/
  anónimo **ya no escribe** en la cola de trabajo del dueño → se cierra la superficie de abuso
  (enumerar cartas inflaba la cola). La escalada queda **solo** en el flujo autenticado
  `createRequest` (`:170-172`, `POST /buylist/requests`), sin cambio. **SEC-A1 intacto**: rareza +
  acabado se derivan server-side de `Card.rarity`/acabados reales, no del DTO (`:66-75`).
- **`POST /admin/jobs/catalog-price-sync` — authz + auditoría + single-flight.**
  `admin-jobs.controller.ts:22-23` `@Roles(Role.super_admin)` a **nivel de clase** (sin `@Public`;
  `JwtAuthGuard`→`RolesGuard` globales son la autoridad, rol del JWT nunca del body). El endpoint
  (`:148-161`) audita `jobs.catalog_price_sync.run` con `actorUserId`/`actorRole`/`entityType:'Job'`/
  `entityId`. **Anti-loop / single-flight:** `catalog-price-sync.service.ts:31` invoca
  `syncAll({force:true})`, protegido por `catalog-sync.service.ts:234` (`if
  (this.syncAllStatus.running)` → retorna sin solapar). Idempotente por `externalId` / clave día-
  acabado.
- **Integridad de dinero — sin vector de manipulación por el cliente.**
  - `persistMarketReference` (`pricing.service.ts:210-256`) **respeta el override manual**: lee la
    fila del día y si `existing?.isManualOverride` hace **skip** (`:228-230`) → el override del admin
    (§4.1) nunca es pisado por el flujo automático (salvo la carrera de G-1, abajo).
  - **FX legítimo:** el `market` (USD) proviene **solo** de `tcgplayer.prices` ya descargado de
    pokemontcg.io (`catalog-sync.service.ts:416-428`), **sin input de usuario**; la conversión
    USD→MXN usa el snapshot de `FxService` (Banxico) cargado **una vez por corrida** más el colchón,
    o el override del admin — **nunca** un valor del request.
  - **Descarta `market <= 0`:** `catalog-sync.service.ts:424-425` (`if (market == null || market <=
    0) continue`) → una carta/acabado sin market **no** crea referencia ni escala pendiente (no
    inunda la cola, no siembra precios en 0). Montos en **centavos enteros** (`Math.round(market*100)`,
    `:426`).
- **API key fuera de logs.** `pokemontcg-io.client.ts:56-58` toma `POKEMONTCG_IO_API_KEY` de
  `ConfigService` y la envía **solo** en el header `X-Api-Key`; los `logger.warn` (`:79-80`) registran
  únicamente path + status HTTP, **nunca** la clave. **Backoff 429 respetado:** `:73-80` reintenta
  ante 429/5xx honrando `Retry-After` (o backoff exponencial) → no aborta el sync ni martillea la API.

## G-1 (Baja, abierta con disparador) — TOCTOU en `persistMarketReference` (guard `isManualOverride` no atómico)
- **Ubicación:** `pricing.service.ts:228-231` — `findUnique(where:key)` **y luego**
  `upsert(...)`, con el guard `if (existing?.isManualOverride) return;` **entre** ambas operaciones
  (patrón read-then-write, no atómico).
- **Descripción:** si un **override manual** del admin sobre el mismo `(cardId,'raw','raw:NM',finish,
  hoy)` ocurre concurrentemente con una corrida de `catalog-sync`, el sync pudo leer la fila
  **antes** del override (`isManualOverride=false` o inexistente) y luego el `upsert` la reescribe con
  `source:'pokemontcg_io'` + `isManualOverride:false` (`:247-254`), **pisando** el override del día.
- **Impacto:** un precio de referencia manual del admin podría quedar sobrescrito por el market
  automático **solo bajo carrera del mismo día**. Es **integridad de precio de referencia** (afecta
  cotización), no un money-out sin control: el desembolso SPEI sigue tras `@MoneyOut` super_admin +
  auditado, y la aprobación está topada por `assertApprovedPriceWithinCap` (B-4). Ventana estrecha
  (override manual y corrida de sync en paralelo el mismo día). **Baja.**
- **Rol dueño:** **backend** — cerrar con escritura atómica que preserve el override, p. ej.
  `updateMany({ where:{ ...key, isManualOverride:false }, data:{...} })` (o upsert condicionado), de
  modo que la fila con `isManualOverride=true` nunca sea alcanzada por el update. **Registrado como
  BE-22.** **Disparador:** antes de operar con dinero real / concurrencia real (múltiples réplicas o
  admin editando mientras corre el job 2×/día).

## G-2 (Baja/Info, abierta con disparador) — `POST /admin/jobs/catalog-price-sync` sin `@Throttle` propio
- **Ubicación:** `admin-jobs.controller.ts:148-161` (endpoint) — sin decorador `@Throttle` propio; se
  apoya en el throttler global.
- **Descripción:** cada disparo lanza un re-sync completo (`syncAll force:true`) que hace un `getSets`
  contra pokemontcg.io y reprocesa todo el catálogo. Sin un `@Throttle` específico, un super_admin
  podría dispararlo repetidamente. **Mitigado** por el **single-flight** (`syncAllStatus.running` →
  las llamadas solapadas retornan sin trabajar) y por ser un endpoint **super_admin + auditado**, así
  que el riesgo es de **carga hacia pokemontcg.io / consumo de rate-limit**, no de authz ni de dinero.
- **Impacto:** Bajo/Info — presión sobre la API externa y el rate-limit; sin efecto de authz, PII ni
  money-out. El backoff 429 del cliente amortigua.
- **Rol dueño:** **devops/backend** — añadir `@Throttle` propio (o cooldown) al disparo manual y, al
  escalar a multi-instancia, mover single-flight/throttler a store compartido (Redis) para coordinar
  entre réplicas. **Registrado como BE-23.** **Disparador:** al exponer el panel admin a operación
  real / despliegue multi-réplica.

## G.3 Banderas para el humano (Fase 1)
- **Pentest de tercero + programa de bug bounty ANTES de operar con dinero real** (heredado,
  obligatorio). Sigue vigente para todo el epic de precios.
- **DAST contra staging — PENDIENTE, obligatorio antes de prod.** Sumar a la cola de DAST los
  vectores de esta fase: **concurrencia del single-flight / re-sync del catálogo** (dos réplicas
  disparando `syncAll` en paralelo; carrera de G-1 override-vs-sync el mismo día) y el **webhook de
  Stripe** (firma/idempotencia bajo carga). Ejecutar en cuanto haya staging autorizado (§6).
- **Licencia / contrato de datos de la fuente de precios.** Validar la **base legal/comercial** de
  usar `market` de **pokemontcg.io / TCGplayer** como **precio de referencia** para una operación de
  **custodia comercial** (compra/venta con dinero real): términos de uso, atribución y si el uso
  comercial de esos precios está permitido. Confirmar con legal antes del go-live.

## G.4 VEREDICTO — Fase 1 (catálogo priceado + job 2×/día, `a6a79df`): **APROBADO** (2026-08-17)
- **0 Críticos / 0 Altos abiertos** → aprobable por política (`CLAUDE.md` §7 y DoD).
- **Positivos verificados:** `publicQuote` **read-only** (BE-16 CERRADO; escalada solo en
  `createRequest` autenticado); `POST /admin/jobs/catalog-price-sync` **super_admin + auditado +
  single-flight**; **integridad de dinero** (`persistMarketReference` respeta `isManualOverride`; FX
  de Banxico/override, nunca del request; market solo de pokemontcg.io sin input de usuario; descarta
  `market<=0`; centavos enteros); **API key** por header desde config, fuera de logs; **backoff 429**
  respetado.
- **Abiertos NO bloqueantes (con disparador):** **G-1 (Baja)** TOCTOU en `persistMarketReference`
  (`pricing.service.ts:228-231`) → override manual concurrente del mismo día podría ser pisado;
  mitigación `updateMany WHERE isManualOverride=false`; dueño **backend** (**BE-22**). **G-2
  (Baja/Info)** `catalog-price-sync` sin `@Throttle` propio (single-flight mitiga); dueño
  **devops/backend** (**BE-23**).
- **Deuda previa sin cambio:** S-M1 aceptada; S-B1/S-B2/residuo S-B3 y las banderas legales de
  custodia/PII (§5-§6) siguen abiertas para el humano. La **fase dinámica (DAST contra staging)**
  heredada sigue **pendiente y obligatoria antes de operar con dinero real** (§6) — no bloquea esta
  Fase 1.
- **¿Puede ir a `main`?** **SÍ.**

---

# H. Revisión Fase 3a — rediseño del cotizador buylist (commit `10d5205`) · frontend

> **Alcance:** Fase 3a del rediseño del cotizador buylist (frontend). Focos de seguridad:
> (H.1) el front solo **muestra** estimados/totales y **no** envía montos/rareza del cliente en
> `createRequest` (SEC-A1 desde la superficie de UI); (H.2) el atajo CLABE "Usar mi ****1234"
> (aislamiento del flag + descarte en `api.ts`); (H.3) gating P-11 intacto (la UI comunica, el
> backend decide). Cruzado con `docs/PENTEST_NOTES.md`.
> **Modo:** revisión **estática** de código (frontend). Sin stack vivo → concurrencia/DAST sigue
> **[pendiente de DAST]** (§6).
> **Fecha:** 2026-08-17. Blanco autorizado: staging/local.

## H.0 Resumen — **0 Críticos / 0 Altos**; 1 Baja + 1 Info (no bloqueantes, con disparador)

| Severidad | # | ID / tema |
|---|---|---|
| Crítica | 0 | — |
| Alta | 0 | — |
| Media | 0 | — |
| Baja | 1 | **H-1** — fan-out del auto-quote (~`pageSize` POST /buylist/quote por búsqueda) |
| Info | 1 | **H-2** — todo depende del flag build-time `NEXT_PUBLIC_USE_MOCKS` |

## H.1 Positivos verificados — **[Verificado en código]**
- **SEC-A1 intacto en la superficie de UI.** El front **solo muestra** estimados/totales derivados;
  `createRequest` **NO** envía montos ni rareza del cliente — el backend deriva todo server-side de
  `Card.rarity`/acabados reales (consistente con §B.4/§F.3/§G.1). Un DTO manipulado desde el cliente
  no puede inflar el total; el cotizador es informativo y el backend sigue siendo la autoridad de
  precio.
- **Atajo CLABE "Usar mi ****1234" — doblemente aislado.** `clabeShortcutAvailable = !!clabeMasked
  && config.useMocks`: el atajo **solo** aparece en modo mocks. En modo real, el flag
  `useClabeOnFile` se **descarta en `api.ts`** antes de salir a la red → contra el backend real se
  **exige la CLABE de 18 dígitos**, sin bypass del flujo KYC/AML. No hay vía por la que el atajo de
  UI evite la captura/verificación de CLABE real.
- **Gating P-11 intacto.** La UI **comunica** el estado (habilitado/deshabilitado) pero **el backend
  decide**; la vista no es la autoridad de autorización. Defensa en profundidad correcta (patrón
  consistente con las vistas admin gatadas de §A.3/§A.4).

## H-1 (Baja, abierta con disparador) — Fan-out del auto-quote por resultado
- **Descripción:** el auto-quote dispara ~`pageSize` `POST /buylist/quote` por búsqueda (una por
  resultado de la página). **Mitigado** por cache/dedupe + throttle (300/min): las llamadas repetidas
  se sirven de cache y el throttler global acota el ritmo. El riesgo es de **carga/eficiencia** de
  red, no de authz, PII ni money-out.
- **Impacto:** Bajo — amplificación de peticiones al endpoint de quote; sin efecto de seguridad de
  dinero/datos. El endpoint de quote es de solo-lectura (no escribe en la cola de trabajo tras el
  cierre de BE-16, §G.1).
- **Rol dueño:** **frontend/arquitecto** — se **cierra con el batch quote de Fase 3b** (una sola
  llamada por página). **Disparador:** al implementar Fase 3b / antes de exponer el cotizador a
  tráfico real.

## H-2 (Info, abierta con disparador) — Todo depende del flag build-time `NEXT_PUBLIC_USE_MOCKS`
- **Descripción:** el aislamiento del atajo CLABE y del modo mocks depende del flag **build-time**
  `NEXT_PUBLIC_USE_MOCKS`. Si se compilara el bundle de producción con el flag mal puesto, la UI
  entraría en modo mocks. **Mitigación de defensa en profundidad:** aunque el flag fallara, `api.ts`
  descarta `useClabeOnFile` en el path real y el backend exige la CLABE de 18 dígitos → no hay bypass
  KYC/AML por sí solo; el impacto sería de comportamiento de UI, no de money-out.
- **Rol dueño:** **devops** — **verificar `NEXT_PUBLIC_USE_MOCKS=false` en el gate de build de prod**
  (checar en el pipeline de CI/SAST antes de promover el bundle). **Disparador:** en cada build de
  producción.

## H.3 Carryover (heredado, fuera de alcance de esta fase)
- **B-5 (token en query-string) sigue ABIERTO.** Dueño **frontend**. No es parte del rediseño del
  cotizador de Fase 3a; se mantiene en seguimiento hasta que frontend lo cierre. No bloquea esta fase.

## H.4 VEREDICTO — Fase 3a (rediseño del cotizador buylist, `10d5205`): **APROBADO** (2026-08-17)
- **0 Críticos / 0 Altos abiertos** → aprobable por política (`CLAUDE.md` §7 y DoD).
- **Positivos verificados:** **SEC-A1** en la UI (el front solo muestra estimados/totales;
  `createRequest` no envía montos/rareza del cliente); **atajo CLABE doblemente aislado**
  (`clabeShortcutAvailable = !!clabeMasked && config.useMocks`; `useClabeOnFile` descartado en
  `api.ts` en modo real; backend exige CLABE de 18 dígitos, sin bypass KYC/AML); **gating P-11
  intacto** (UI comunica, backend decide).
- **Abiertos NO bloqueantes (con disparador):** **H-1 (Baja)** fan-out del auto-quote
  (~`pageSize` POST /buylist/quote por búsqueda; mitigado por cache/dedupe + throttle 300/min), dueño
  **frontend/arquitecto**, **se cierra con el batch quote de Fase 3b**; **H-2 (Info)** dependencia del
  flag build-time `NEXT_PUBLIC_USE_MOCKS`, dueño **devops** (verificar `=false` en el gate de prod).
- **Carryover:** **B-5** (token en query-string) sigue abierto, dueño **frontend**, fuera de alcance.
- **Deuda previa sin cambio:** S-M1 aceptada; S-B1/S-B2/residuo S-B3 y banderas legales de
  custodia/PII (§5-§6) siguen abiertas para el humano. La **fase dinámica (DAST contra staging)**
  heredada sigue **pendiente y obligatoria antes de operar con dinero real** (§6) — no bloquea Fase 3a.
- **¿Puede ir a `main`?** **SÍ.**

---

# I. Revisión Fase 2 — precio de venta por rareza (commits `fba6486` + `fee3c19`) · backend + frontend

> **Alcance:** Fase 2 del epic de precios — **precio de venta** derivado por **rareza** (`Card.rarity`)
> + **acabado** (`InventoryItem.finish`) server-side, endpoints admin `sales-rules`/`sales-rarities`,
> validador de reglas, `publishedWhere` relajado y reserva atómica anti doble-venta. Cruzado con
> `docs/PENTEST_NOTES.md`.
> **Modo:** revisión **estática** de código. Sin stack vivo → concurrencia de checkout sigue
> **[pendiente de DAST]** (§6).
> **Fecha:** 2026-08-17. Blanco autorizado: staging/local.

## I.0 Resumen — **0 Críticos / 0 Altos**; 2 Bajas abiertas (no bloqueantes, con disparador)

| Severidad | # | ID / tema |
|---|---|---|
| Crítica | 0 | — |
| Alta | 0 | — |
| Media | 0 | — |
| Baja | 2 | **I-1 / B-6** — orden a $0 por `fixed:0` (`salePriceOf` no rechaza `<=0`); **I-2 / B-7** — `fixed` sin cota superior → overflow Int32 |

## I.1 Positivos verificados — **[Verificado en código]**
- **SEC-A1 en el precio de venta.** El precio de venta se **deriva server-side** de `Card.rarity` +
  `InventoryItem.finish`; el **comprador no influye** en el monto. El checkout solo transporta
  `inventoryItemIds` → un DTO manipulado no puede fijar/rebajar el precio. Consistente con la
  derivación server-side de las fases previas (SEC-A1).
- **Endpoints `sales-rules` / `sales-rarities` — super_admin + auditados.** La escritura de reglas de
  precio de venta está restringida a **super_admin** y **auditada** (mismo patrón que M2 buylist-rules
  de §B.5). El comprador nunca alcanza estos endpoints.
- **Validador robusto.** El validador **rechaza NaN / Infinity / negativos** → no se pueden sembrar
  reglas absurdas que rompan el cálculo del precio de venta.
- **`publishedWhere` relajado NO expone custodia de clientes.** El relajamiento mantiene
  **`ownerType:'platform'` intacto** → solo se publica/vende inventario **de la plataforma**; el
  inventario en **custodia de clientes** no se expone a la venta pública. Sin fuga de custodia.
- **Reserva atómica anti doble-venta — intacta.** El guardarraíl de reserva atómica (`updateMany`
  guardado por estado vendible + `count!==1 → ITEM_UNAVAILABLE` en `$transaction`, §2) **sigue
  intacto** tras el cambio de precio por rareza. Sin regresión de doble-venta.

## I-1 / B-6 (Baja, abierta con disparador) — Orden a $0 por regla `fixed:0`
- **Descripción:** `salePriceOf` **no rechaza** precios `<= 0`. Una regla de venta con `fixed:0`
  (sembrada por super_admin, por error) produciría un precio de venta de **$0** → orden a $0. El
  insumo proviene de un **rol confiable** (super_admin) y **auditado**, y el validador ya bloquea
  negativos, pero **no** el cero.
- **Impacto:** Bajo — venta a $0 solo si un super_admin fija `fixed:0`; sin fuga de PII ni money-out
  descontrolado, pero pérdida directa de inventario/valor si ocurre. Es endurecimiento de integridad
  financiera.
- **Rol dueño:** **backend** — recomendación: **`fixed >= 1`** en el validador **+ rechazar `<= 0`**
  en `salePriceOf`. **Endurecer ANTES de operar con dinero real.** (Coincide con **B-6** del
  pentest.)

## I-2 / B-7 (Baja, abierta con disparador) — `fixed` sin cota superior → overflow Int32
- **Descripción:** el campo `fixed` de las reglas de venta **no tiene cota superior**; un valor
  suficientemente grande desborda el `Int` de 32 bits de Postgres al calcular/persistir el precio.
  Extiende **B-3** del pentest (dinero en `Int` 32-bit / falta de `@Max`) al nuevo campo de reglas de
  venta.
- **Impacto:** Bajo — insumo de **rol confiable** (super_admin) + **auditado**; distorsión/overflow
  del precio de venta, no un money-out saliente sin control.
- **Rol dueño:** **backend** — cota superior razonable (`@Max`) en `fixed`; se enlaza con **B-3/S-B2**
  (evaluar `BigInt` para agregados de dinero) — mismo dueño/decisión. **Endurecer antes de dinero
  real.**

## I.2 VEREDICTO — Fase 2 (precio de venta por rareza, `fba6486` + `fee3c19`): **APROBADO** (2026-08-17)
- **0 Críticos / 0 Altos abiertos** → aprobable por política (`CLAUDE.md` §7 y DoD).
- **Positivos verificados:** **SEC-A1** (precio de venta derivado server-side de `Card.rarity` +
  `InventoryItem.finish`; el comprador no influye; checkout solo lleva `inventoryItemIds`); endpoints
  `sales-rules`/`sales-rarities` **super_admin + auditados**; validador **rechaza NaN/Infinity/
  negativos**; `publishedWhere` relajado **NO** expone custodia de clientes (`ownerType:'platform'`
  intacto); **reserva atómica anti doble-venta intacta**.
- **Abiertos NO bloqueantes (con disparador):** **I-1 / B-6 (Baja)** orden a $0 por `fixed:0`
  (`salePriceOf` no rechaza `<=0`; recomendación `fixed>=1` + rechazar `<=0`), dueño **backend**,
  **endurecer antes de dinero real**; **I-2 / B-7 (Baja)** `fixed` sin cota superior → overflow Int32
  (extiende B-3), dueño **backend**.
- **Deuda previa sin cambio:** S-M1 aceptada; S-B1/S-B2/residuo S-B3 y banderas legales de
  custodia/PII (§5-§6) siguen abiertas para el humano. La **fase dinámica (DAST contra staging)**
  heredada sigue **pendiente y obligatoria antes de operar con dinero real** (§6) — no bloquea Fase 2.

## I.3 Banderas para el humano (Fases 3a + 2)
- **DAST / pentest de tercero PENDIENTE antes de dinero real** (heredado, obligatorio): en particular
  **concurrencia de checkout** (reserva atómica bajo carga), **webhook de Stripe** (firma/idempotencia)
  y **rate-limit del cotizador** (fan-out H-1 / abuso del auto-quote). Ejecutar en cuanto haya staging
  autorizado (§6).
- **Decidir B-6 / B-7 como endurecimiento previo a producción:** rechazar precio de venta `<= 0`
  (`fixed >= 1`) y fijar cota superior a `fixed` (junto con la decisión `BigInt` de B-3/S-B2). Dueño
  **backend**; endurecer antes de operar con dinero real.
- **¿Puede ir a `main`?** **SÍ** (ambas fases: 3a y 2).

---

# ANEXO rev v1.6 (2026-08-19) — Work stream «Sellado / Venta de producto cerrado»

> **Rama:** `claude/sellado-producto-cerrado` (HEAD actual). **Modo:** revisión **estática** de
> código (blue team) + consolidación del pase **PENTEST §"Pase v1.6"** (red team). Sin stack vivo
> (Docker/Postgres/Redis ausentes) → vectores que exigen runtime = **[PoC pendiente de DAST]**;
> confirmados por lectura = **[Verificado en código]**. **Foco del PO:** ruta de dinero/autoprecio
> del sellado + puerta pública del restock por correo. Superficie nueva: `catalog/*` (sellado),
> `pricing.*`, `common/money.ts`, `vault.service.ts`, `admin-vaults.*`, migración M-28,
> `settings.constants.ts`.

## S.0 Resumen ejecutivo del stream

La **ruta de dinero/autoprecio del sellado se validó SÓLIDA** y sin regresión. El precio de venta se
resuelve por un **único** camino server-side (`PricingService.resolveSealedSalePrice` =
`gateSealedMarketCents` + pura `computeSealedSalePrice`), **compartido** por grid, ficha, catálogo,
Compra (`orders.salePriceOf`), bulk-publish y valuación de bóveda ⇒ **precio mostrado == precio
cobrado**. El DTO del cliente **nunca** aporta precio; `listPriceCents`/`sealedSubtype`/`ref` salen de
BD y los spreads de `ConfigSetting`. El **gate money-safe fail-closed está intacto**: seed
`sealed_price_source='off'` (`sourceOn = value==='tcgcsv'` ⇒ mercado **inerte**; sin override>0 ⇒
`PRICE_PENDING`, no se publica), `override<=0` se ignora (nunca se vende gratis/bajo mercado),
spreads capados `[0,1000]`, `listPriceCents @Max 100_000_000`, y `GET/PUT /admin/pricing/sealed-spreads`
= `@Roles(super_admin)` **auditado before/after** (no editables por `PUT /admin/settings`). **0
Críticas / 0 Altas.**

El riesgo real del stream vive en la **puerta pública del restock** (S-1: sin consentimiento/dedup/
`@@unique` → email-bomb diferido + bloat de BD) y en el **grid público sin cota de paginación en BD**
(S-2: DoS anónimo). Ambos hoy **atenuados** (S-1 tras flag `sealed_restock_alerts=off`; S-2 vivo pero
con throttle global por IP). **Consolido los 5 hallazgos del pentester; todos se confirman en código;
ajusto S-4 a Info y elevo S-7 (userId inerte) a Baja** porque debilita el control anti-abuso de S-1.

| Severidad final (blue team) | # | IDs |
|---|---|---|
| Crítica | 0 | — |
| Alta | 0 | — |
| Media | 2 | S-1 (condicionada al flag), S-2 |
| Baja | 3 | S-3, S-5, **S-7 (elevado desde Info)** |
| Info/positivo | 3 | **S-4 (bajado desde Baja)**, S-6, S-8 |

## S.1 Tabla consolidada — hallazgos del stream (validados vs. código)

| ID | Hallazgo | Sev. pentester | **Sev. final** | Estado | Rol dueño | Evidencia [Verificado en código] |
|---|---|---|---|---|---|---|
| **S-1** | Restock público: correo sin opt-in/consentimiento + sin dedup + sin `@@unique` → email-bomb diferido + bloat | Media (→Alta con flag on) | **Media** hoy / **Alta al encender el flag** | **REMEDIAR-ANTES-DE-FLAG** (bloqueante para encender `sealed_restock_alerts`) | **backend** + **arquitecto** (`@@unique`) + **devops** (mantener flag off) | `sealed-catalog.service.ts:269-331` acepta `email` arbitrario (solo regex), `create` sin buscar previa; migración M-28 `SealedRestockSubscription` sin `@@unique` (solo 3 índices no-únicos); `sealed-restock-notify.service.ts:87-101` envía **1 correo por fila** pendiente |
| **S-2** | `GET /catalog/sealed` (público) sin `take`/`skip` en BD: carga toda la tabla sellada+joins en memoria por request → DoS | Media | **Media** | **REMEDIAR** (no bloqueante por severidad; cerrar antes de GA/escala) | **backend** | `sealed-catalog.service.ts:47-52` `findMany` sin `take`; `listSealed:168-171` pagina con `.slice()` en memoria; `catalog.controller.ts:72-73` `@Public` **sin `@Throttle` propio** (sus hermanos `value-history`/`featured-set` sí llevan 60/min) |
| **S-3** | Correo restock: `productName` interpolado en HTML sin `escapeHtml` | Baja | **Baja** | Aceptada (remediar con S-1) | **backend** | `sealed-restock-notify.service.ts:113` `<strong>${productName}</strong>` sin escapar; `productName = card.name` (fuente catálogo/import, no input directo del atacante) |
| **S-4** | `value-history` sin filtro `ownerType`/`status` → serie de mercado de cualquier pieza sellada por id | Baja | **Info** (bajada) | Aceptada | **backend** | `sealed-catalog.service.ts:223-224` `findFirst({id, productType:'sealed'})` sin `status/ownerType` (vs. `sealedDetail:178-182` que sí). Datos = **precio de mercado TCGCSV público** (no PII, no precio de venta, no dueño) + endpoint **feature-flagged off** ⇒ bajada a Info |
| **S-5** | Restock: oráculo de temporización residual pese a 202 neutro | Baja | **Baja** | Aceptada | **backend** | `sealed-catalog.service.ts:299-330` ruta asimétrica (anclar Card real ⇒ `findFirst`+`findUnique`+`create`); existencia de sellado ya es en gran parte pública vía grid/ficha |
| **S-7** | `@CurrentUser('id')` inerte en ruta `@Public` → suscripciones siempre `userId=null` | Info | **Baja** (elevada) | Aceptada (remediar con S-1) | **backend** | `catalog.controller.ts:114` inyecta `userId?` pero `JwtAuthGuard` hace `return true` en `@Public` sin poblar `req.user` ⇒ `userId` siempre `undefined`. **Elevado a Baja**: impide un rate-limit/ownership por-usuario y por tanto **refuerza S-1** (toda suscripción queda anónima) |
| **S-6** | Feature-flags gateados server-side; micro-leak `FEATURE_DISABLED` vs 404 genérico | Info | **Info** | Aceptada | backend (opc.) | `sealed-catalog.service.ts:220,279` verifican el dial ANTES de tocar datos ⇒ **no bypassable**. Micro-fuga cosmética |
| **S-8** | Positivo — integridad de precio del sellado + authz sin regresión | Info+ | **Info+** | Confirmado | — | Resolver único server-side + gate fail-closed + spreads capados/auditados + IDOR scoped (ver S.2) |

## S.2 Ruta de dinero / autoprecio del sellado — VERIFICADA sin regresión (blue team)

- **Resolver único server-side (SEC-A1):** `pricing.service.ts:223-236` `resolveSealedSalePrice` =
  `gateSealedMarketCents(ref, sourceOn)` (`:206-210`) + pura `computeSealedSalePrice`
  (`money.ts:339-363`). Precedencia `override>0 > mercado×spread(subtype) > mercado×spread(global) >
  PRICE_PENDING`. El **mismo cuerpo** lo usan grid (`sealed-catalog.service.ts:72`), ficha, catálogo,
  **checkout** (`orders.service.ts:54-61`), bulk-publish y valuación de bóveda ⇒ **no hay discrepancia
  mostrado-vs-cobrado**. El cliente solo manda **ids**; ningún precio del DTO entra al cálculo.
- **Gate money-safe fail-closed INTACTO:** seed `sealed_price_source='off'`
  (`settings.constants.ts:100`); `sourceOn = value==='tcgcsv'` (`pricing.service.ts:172`) ⇒ con `off`
  el mercado TCGCSV queda **inerte** y el sellado solo se vende con **override>0**; sin override y sin
  mercado ⇒ `PRICE_PENDING` (no se publica). `override<=0` se trata como ausente
  (`money.ts:346-349`) ⇒ nunca se vende gratis ni bajo mercado por captura degenerada.
- **Diales capados y segregados:** `listPriceCents @Min(0) @Max(100_000_000)` en los 5 DTOs de alta/
  publicación (`inventory.dto.ts:61,70,113,131,167`); spreads `[0, 1000]` + subtype allow-listed
  (`settings.constants.ts:243-271`); `GET/PUT /admin/pricing/sealed-spreads` = `@Roles(super_admin)`
  con auditoría **before/after** (`pricing.controller.ts:78,344-386`); los spreads **NO** son editables
  por `PUT /admin/settings` (fuera de `SETTING_DTO_MAP`).
- **Sin doble-venta:** reserva atómica de checkout con `updateMany` guardado por estado vendible +
  `count===1` (patrón previo, sin regresión).
- **AuthZ/IDOR del sellado:** `GET /vault/sealed` scoped por `@CurrentUser('id')`;
  `GET /admin/vaults/:userId/sealed` = `@Roles(vault_operator, super_admin)` con proyección **sin
  CLABE/RFC/INE** (`admin-vaults.service.ts`). Sin lectura cruzada cliente-a-cliente. El sellado **no**
  introdujo superficie de money-out.

## S.3 Condiciones de gate (qué bloquea, qué se acepta con registro)

**BLOQUEANTE para encender `sealed_restock_alerts` (S-1) — antes del flip del dial DEBE cerrarse
TODO lo siguiente:**
1. **Titularidad/consentimiento del correo** — exigir **double opt-in** (token de confirmación, como
   el módulo de correo M-17) **o** restringir `email` al de la **sesión autenticada** (no aceptar
   email arbitrario de terceros). **[backend]**
2. **`@@unique(email, tcgplayerProductId, cardId, sealedSubtype, sealedCondition)`** en
   `SealedRestockSubscription` + **dedup** antes del `create` (idempotencia). **[arquitecto** (schema)
   **+ backend]**
3. **Cap de correos por víctima/producto** en el job de notificación (colapsar N filas a 1 envío) y
   escapar HTML del `productName` (**S-3**). **[backend]**
4. **Ligar la suscripción a un usuario** cuando haya sesión — corregir **S-7** (`@CurrentUser('id')`
   inerte en ruta `@Public`) para habilitar rate-limit/ownership por-usuario. **[backend]**
5. **devops:** mantener `sealed_restock_alerts=off` (y `sealed_value_trend=off`) hasta que backend/
   arquitecto confirmen 1-4; el flip queda gated por esta nota.

**ACEPTADO CON REGISTRO (no bloquea el cierre del stream):**
- **S-2 (DoS de paginación)** — **abierto y vivo** (el grid es público aunque el autoprecio esté off).
  No bloquea por severidad (Media, 0 Crit/Alta), pero **backend debe** paginar en BD (`take`/`skip` o
  cota dura + caché corta) y añadir `@Throttle` por IP al endpoint, **en paridad con sus hermanos**,
  **antes de GA/operar a escala**. Atenuante actual: throttler global por IP (in-memory/por instancia,
  débil en multi-instancia sin Redis — ver carryover devops).
- **S-3, S-4, S-5, S-6, S-7** — deuda de bajo riesgo con disparador (S-3/S-7 se cierran junto con S-1).
- **Carryover de dependencias:** `@nestjs/core`/`@nestjs/platform-express` **2 moderate**
  (GHSA-36xv-jgw5-4q75 / CVE-2026-35515, SSE injection) — **no específico del stream**, **no
  alcanzable** (backend sin SSE; `git grep @Sse|MessageEvent|text/event-stream` = 0). Sigue aceptado
  con disparador (bump a NestJS 11 en ventana de mantenimiento). **[devops]** No se infla: sin cambio
  respecto a rev v1.3-v1.5.

## S.4 Banderas para el humano (sellado)

- **No encender `sealed_restock_alerts` en producción** hasta cerrar S-1 (1-4 de §S.3). Es la única
  condición que **escala a Alta** si se ignora: convierte la plataforma en amplificador de spam a
  terceros usando su **reputación de envío** (riesgo de blacklist del dominio) + bloat de BD no acotado.
- **Antes de operar con dinero real** (transversal, ya en §6): **pentest de tercero + bug bounty**;
  **DAST contra staging** para los vectores [PoC pendiente de DAST] del stream — carga real de S-2,
  amplificación de S-1 con flag on, y timing de S-5.
- **Legal/PII:** sin superficie nueva de PII en el sellado (grid/ficha/valuación no exponen datos de
  dueño; admin-vaults sin CLABE/RFC/INE). El correo de restock guarda `email` de terceros **sin
  consentimiento verificado** ⇒ cerrar S-1 también por higiene de datos personales antes de operar.

## S.5 DoD de seguridad (CLAUDE.md) — verificación

- **Sin hallazgos Críticos/Altos abiertos:** **CUMPLE.** 0 Crit / 0 Alta en el stream (y en el
  histórico consolidado). S-1 es Media hoy (fail-closed por flag off); su escalada a Alta es
  **condicional y prevenida** por el gate de §S.3 (flag off + remediación previa al flip).
- **Aceptados registrados en este documento:** S-2 (remediar antes de GA), S-3/S-4/S-5/S-6/S-7
  (deuda con disparador), carryover `@nestjs/core` (aceptado, no alcanzable). Registrados arriba.

## S.6 Ruteo por rol dueño (stream Sellado)
- **backend:** S-1 (opt-in/dedup/cap), S-2 (paginar en BD + `@Throttle`), S-3 (escapar HTML), S-4
  (alinear `where` con `sealedDetail`), S-5 (igualar ruta de trabajo), S-7 (userId inerte).
- **arquitecto:** S-1 (`@@unique` en `SealedRestockSubscription` — cambio de schema/migración).
- **devops:** mantener `sealed_restock_alerts=off` y `sealed_value_trend=off` hasta cerrar S-1;
  carryover `@nestjs/core` (bump NestJS 11 + gate `npm audit` en CI); Redis para throttler multi-instancia.

## S.7 VEREDICTO del stream «Sellado»

**VEREDICTO seguridad (revisión estática, blue team): APROBADO-CON-CONDICIONES.**

- **0 Críticos / 0 Altos abiertos** ⇒ **no procede RECHAZO** (CLAUDE.md DoD). El stream **puede
  cerrar/mergear** con los aceptados registrados en este documento.
- La **ruta de dinero/autoprecio del sellado** está **verificada sin regresión**: resolver único
  server-side, gate money-safe fail-closed (`sealed_price_source='off'`), sin inyección de precio por
  el cliente, spreads capados/auditados/segregados (super_admin), sin doble-venta y sin IDOR nuevo.
- **CONDICIÓN VINCULANTE (S-1):** `sealed_restock_alerts` **DEBE permanecer `off`** en prod; encender
  el flag **sin** cerrar antes double opt-in/ownership + `@@unique`+dedup + cap de correos + S-7
  (§S.3, puntos 1-4) **reabre este veredicto como RECHAZO** (S-1 escala a Alta). devops no flipea el
  dial sin visto bueno de backend/arquitecto.
- **CONDICIÓN DE CIERRE PRE-GA (S-2):** no bloquea el merge por severidad, pero backend **debe**
  paginar en BD + `@Throttle` el grid público **antes de GA/escala**.
- **Deuda aceptada con disparador:** S-3/S-4/S-5/S-6/S-7 y carryover `@nestjs/core` (no alcanzable).
- **PENDIENTE (no aprobado a ciegas):** **DAST contra staging** para los vectores runtime del stream
  (carga real S-2, amplificación S-1 con flag on, timing S-5), en línea con el gate de promoción a prod.

---

# ANEXO 2026-08-19 — Stream `pulido-precios-display` (FX al vuelo + N-15 displayFinishes)

> **Rol:** seguridad (blue team). **Rama:** `claude/pulido-precios-display`. **Insumo:** `docs/PENTEST_NOTES.md`
> (ronda del stream: 0 Críticos / 0 Altos; 2 Bajos FX-B1/FX-B2, dueño backend). **Modo:** revisión estática
> de código + ejecución de los tests de seguridad (`fx-override`, `settings.validation`, `fx.buffer`). Sin
> stack vivo (Docker/Postgres/Redis ausentes) → vectores runtime = **[PoC pendiente de DAST en staging]**.
> **Blanco autorizado:** staging/local. **Foco pedido:** verificar con lente de seguridad el fix `b3270b3`
> de backend (FX-B1/FX-B2) y confirmar que N-15 `displayFinishes` no introduce vector de dinero.

## D.0 Resumen del stream

El stream de pulido tocó **dinero** en dos frentes: (1) FX "al vuelo" en el cotizador READ-ONLY (el
pentester ya verificó que órdenes/buylist congelan snapshot; solo el cotizador usa FX viva) y (2) N-15
`displayFinishes` (supresión display-only del acabado espurio). El pentester no halló Críticos ni Altos;
reportó **2 Bajos** (super_admin-only) en el dial `fx_manual_override_rate`. **Backend ya aplicó el fix en
`b3270b3`.** Verifico ese fix y confirmo los positivos. **0 Críticos / 0 Altos abiertos en el stream.**

| Severidad | # | IDs |
|---|---|---|
| Crítica | 0 | — |
| Alta | 0 | — |
| Baja | 2 | **FX-B1**, **FX-B2** — ambos **RESUELTOS en `b3270b3`** (verificado en código + tests) |
| Info/positivo | 4 | I-D1 … I-D4 |

## D.1 FX-B1 (cota superior del override) — **RESUELTO en `b3270b3` · [Verificado en código + tests]**
- **Hallazgo (pentester):** `fx_manual_override_rate` sin cota superior → un override absurdo (p.ej. `1e9`)
  inflaba la valuación USD y podía desbordar la columna `Int priceMxnCents` (~2.1e9) en el job `price-ingest`
  (excepción Prisma = DoS de la ingesta). Explotable **solo** por `super_admin`, por eso Bajo.
- **Fix verificado:** `backend/src/modules/settings/settings.constants.ts:280` — nueva
  `MAX_FX_MANUAL_OVERRIDE_RATE = 1000`; `:289-293` helper `validateFxManualOverrideRate` acepta `null` o
  número **finito** en `(0, 1000]` (rechaza `0`, negativos, `NaN`, `Infinity` y todo lo `> 1000`).
- **(b) La cota 1000 evita el overflow:** el peor caso legítimo de valuación queda muy por debajo de `2^31`
  (tipo de cambio real MXN/USD ~15-25; 1000 deja ~40-65x de holgura pero acota el desbordamiento). El vector
  del pentester (`1e9`) queda cerrado: `validateFxManualOverrideRate(1e9)` → error, no persiste. Mismo patrón
  que `SALES_PCT_MAX` / `SEALED_SPREAD_PCT_MAX`, ya aprobados.
- **Tests:** `fx-override-validation.spec.ts` — **12/12 PASS** (ejecutado esta sesión): acepta el techo,
  rechaza `techo+1` y `1e9`, rechaza `0`/negativos/`NaN`/`Infinity`, el mensaje nombra el rango.

## D.2 FX-B2 (validación asimétrica en dos puertas) — **RESUELTO en `b3270b3` · [Verificado en código + tests]**
- **Hallazgo (pentester):** el mismo dial se validaba distinto en `/admin/fx` (`@IsInt @Min(1)`) vs
  `/admin/settings` (`>0`, sin techo) → superficie inconsistente; una puerta más permisiva que la otra.
- **(a) Ambas puertas aplican AHORA el mismo rango `(0, 1000]`:**
  - `PUT /admin/settings` → `SettingsService.update` (`settings.service.ts:73`) corre `SETTING_VALIDATORS`;
    `settings.constants.ts:320` cablea `[FX_MANUAL_OVERRIDE_RATE] = validateFxManualOverrideRate` (el test
    `expect(gate).toBe(validateFxManualOverrideRate)` lo afirma por identidad de referencia).
  - `PUT /admin/fx` → `FxController.setManual` (`pricing.controller.ts:432-435`) llama el **mismo** helper
    `validateFxManualOverrideRate(dto.rate)` antes de escribir; `FxDto.rate` pasó a `@IsOptional @IsNumber`
    (`:46`) — el rango [min, MAX] lo impone el helper compartido, no el decorador. La puerta ya **no** queda
    más permisiva (antes `@Min(1)` sin techo; ahora rechaza `>1000` y admite fraccional válido).
- **Defensa en profundidad (bonus):** `FxController.setManual` → `FxService.setManual` → `settings.update`,
  que **re-valida** `fxManualOverrideRate` con el mismo `SETTING_VALIDATORS`. Aunque se saltara el check del
  controller, la escritura del override pasa por el validador una segunda vez. Doble candado en la ruta `/admin/fx`.
- **(c) Sin regresión money-safe:** override normal (`18`, `18.5`, `20.123456`) y `null` (borra el override)
  siguen aceptándose (tests `acepta un tipo de cambio realista y fraccional`, `acepta null`); `bufferPct`
  solo (sin pinnear la tasa) sigue funcionando (`acepta solo bufferPct sin pinnear la tasa`). Fraccional es
  correcto porque `FxRate.rate` es `Decimal(12,6)`.
- **(d) Sin otras puertas de escritura del dial sin el helper:** `git grep` de
  `fxManualOverrideRate|FX_MANUAL_OVERRIDE_RATE|fx_manual_override_rate` → los **únicos** escritores son
  `SettingsService.update` (vía SETTING_VALIDATORS) y `FxService.setManual` (invocado solo por
  `FxController.setManual`, ya validado). Ambos controllers son `@Roles(super_admin)`
  (`pricing.controller.ts:411` FxController, `:84` PricingController) + auditados (`fx.override`).
- **Tests:** cubierto por los 12 de `fx-override-validation.spec.ts` (incluye los 3 casos de `/admin/fx` que
  afirman "rechaza sobre el techo SIN escribir" con `setManualSpy not toHaveBeenCalled`).

## D.3 Positivos verificados (confirmo los del pentester)
- **I-D1 — Degradación segura ante fallo FX:** `fx.service.ts:89-122` `refreshFromBanxico` en fallo/`!ok`/
  tasa `<=0`/`NaN` cae a `getCurrent()` (override o último `FxRate`), y el fallback duro (`:58`) es una tasa
  conservadora (18) — nunca 0/NaN. `getCurrent` solo toma el override si `Number(override) > 0` (`:37`). Un
  fallo de FX **no** rompe el pricing ni fuerza market≤0.
- **I-D2 — Sin movimiento retroactivo:** órdenes/buylist congelan snapshot; solo el **cotizador READ-ONLY**
  usa FX viva (verificado por el pentester; sin superficie de escritura de dinero desde el cotizador).
- **I-D3 — N-15 `displayFinishes` NO es vector de dinero · [Verificado en código]:** `computeDisplayFinishes`
  (`common/card-order.ts:100-103`) es **display-only**, garantiza `displayFinishes ⊆ availableFinishes`,
  orden canónico y **nunca vacío** (salvaguarda → `availableFinishes`). La whitelist **SEC-A1** sigue siendo
  `Card.availableFinishes`: `buylist.service.ts:82-92` (`assertFinishAvailable`) valida el `finish` pedido
  contra `card.availableFinishes` (NO contra `displayFinishes`) → fuera de la lista `422 FINISH_NOT_AVAILABLE`;
  el mismo patrón en `inventory.service.ts:177` y money-derivación server-side. Suprimir un acabado del
  render **no** lo saca de la whitelist de cotización ni permite cotizar un acabado no priceado como si lo
  fuera. La completitud X/Y del master-set sigue contando sobre `availableFinishes` (universo intacto).
- **I-D4 — AuthZ super_admin efectiva + auditoría:** `FxController`/`PricingController` = `@Roles(super_admin)`;
  toda escritura del dial FX / spreads queda en `AuditLog` (`fx.override`, before/after en spreads). Un
  `vault_operator`/`customer` → 403. Consistente con "el dinero/config solo lo toca super_admin".

## D.4 Pendiente de DAST (heredado del pentester, no ejecutable aquí)
Sin stack levantable (Docker/Postgres/Redis ausentes). Agendar contra staging autorizado, en línea con el
gate de promoción a prod (SAST por PR + DAST staging):
1. **FX al vuelo bajo carga:** confirmar que el cotizador READ-ONLY con FX viva no expone inconsistencia de
   precio mostrado vs. cobrado (el cobro usa snapshot congelado; el cotizador es informativo).
2. **Overflow real de `price-ingest`:** con la cota 1000 ya no debería alcanzarse `2^31`; validar en un run
   real que un override en el techo (1000) no desborda ningún agregado `Int` (enlaza con la deuda S-B2/`Int`
   32-bit de agregados — **arquitecto**, `BigInt`).
3. **Carryover de deuda del proyecto (sin cambio):** `@nestjs/core` GHSA-36xv-jgw5-4q75 (SSE injection, **no
   alcanzable**, backend sin SSE) — devops, bump NestJS 11; S-B2 (`Int` 32-bit agregados) — arquitecto.

## D.5 Deuda de seguridad aceptada / banderas (sin cambio respecto a revs previas)
- **Aceptada con disparador:** S-M1 (`@nestjs/core` no alcanzable), S-B1 (linking Google a back-office),
  S-B2 (`Int` 32-bit en agregados de dinero), residuo S-B3 (`contentLength` del presign). Ver §5.
- **Banderas para el humano (§6, vigentes):** DAST/pentest de tercero + bug bounty **antes de operar con
  dinero real**; KMS/secret manager en prod; validaciones legales de custodia/PII (INE/CLABE, retención
  LFPDPPP). El fix de este stream no altera estas banderas.

## D.6 VEREDICTO — stream `pulido-precios-display`

**APROBADO** (revisión de código estático + tests).

- **0 Críticos / 0 Altos abiertos.** Los **2 Bajos** del pentester (FX-B1, FX-B2, super_admin-only) están
  **RESUELTOS en `b3270b3`** y verificados: (a) ambas puertas (`/admin/settings` y `/admin/fx`) rechazan el
  valor absurdo con el **mismo** rango `(0, 1000]` vía `validateFxManualOverrideRate`; (b) la cota 1000 cierra
  el overflow de `Int priceMxnCents`; (c) sin regresión money-safe (override `18`/`20.5` y `null`=borrar
  siguen OK, `bufferPct`-solo OK); (d) no quedan otras puertas de escritura del dial sin el helper. Tests:
  `fx-override-validation.spec.ts` **12/12 PASS**; regresión `settings.validation` + `fx.buffer` **26/26 PASS**.
- **N-15 `displayFinishes` NO introduce vector de dinero:** es supresión display-only; la whitelist SEC-A1
  sigue siendo `availableFinishes` y el monto se deriva server-side.
- **Cumple el DoD de seguridad del stream:** sin hallazgos críticos/altos abiertos; los Bajos quedan
  registrados como resueltos. **No hay bloqueadores de merge.**
- **PENDIENTE (no aprobado a ciegas), no bloqueante del stream:** la **fase dinámica (DAST contra staging)**
  sigue condicionada a que devops habilite el entorno (R2/Railway); es requisito del gate de promoción a
  **producción**, no del merge del stream. Deuda previa del proyecto sin cambio (S-M1/S-B1/S-B2).

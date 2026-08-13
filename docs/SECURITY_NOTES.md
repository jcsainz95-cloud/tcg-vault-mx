# SECURITY_NOTES.md — Ingeniería de seguridad (blue team)

> **Rol:** consolidación defensiva + veredicto. Insumo principal: `docs/PENTEST_NOTES.md` (red team).
> **Método:** validación estática cruzando cada hallazgo contra el código (`backend/`, `frontend/`),
> config devops (`docker-compose.yml`, `.env.example`, `.github/workflows/`, `security/`) y `npm audit`.
> **Regla:** solo se escribe este archivo; no se corrige código. Cada hallazgo indica el **rol dueño**.
> **La vara sube por el negocio:** custodia de bienes de valor + dinero saliente + PII sensible
> (INE / CLABE / RFC).
> Fecha ronda 1 (RECHAZO): 2026-08-13. Fecha ronda 2 (RE-VERIFICACIÓN bloqueantes): 2026-08-13.
> Fecha ronda 3 (RE-VERIFICACIÓN endurecimiento PII): 2026-08-13.

---

## 0. RE-VERIFICACIÓN tras la ronda de fixes (ronda 2)

En la ronda 1 **RECHACÉ** con 7 bloqueantes (2 Críticos, 5 Altos: SEC-C1, C2, A1, A2, A3, A4, A5).
Los roles aplicaron fixes (commits `e504466` backend, `cb1eb2b` frontend, `9a47f16` devops).
Re-verifiqué cada uno **en el código, no por confianza**. Resultado:

| ID | Estado | Evidencia verificada |
|---|---|---|
| **SEC-C1** | **CERRADO** | `@nestjs/throttler` en deps; `ThrottlerModule` global 300/min + `ThrottlerGuard` como primer `APP_GUARD` (`app.module.ts:34,56`); `@Throttle` login/register 5/min y refresh 20/min (`auth.controller.ts:12,22,31`); seed sin passwords hardcodeadas, exige `SEED_ADMIN_PASSWORD`/`SEED_OPERATOR_PASSWORD` y **falla** en no-local (`seed.ts:24-38,53,70`). Fuerza bruta: remediado en código; **re-test en vivo pendiente de staging**. |
| **SEC-C2** | **CERRADO** | `npm audit --omit=dev`: **frontend = 0 vulnerabilidades**; **backend = 0 high/critical, 4 moderate** (todas de framework: `@nestjs/core`, `@nestjs/platform-express`, `file-type` x2 vía `@nestjs/common`). Los críticos/high runtime que motivaron el rechazo ya no aparecen. Las 4 moderate quedan como **deuda de framework** (ver §2). |
| **SEC-A1** | **CERRADO** | `buylist.service.ts:99` deriva `category = await this.categoryForRarity(card.rarity)` dentro de `createRequest`; el `it.category` del DTO ya **no** alimenta `quoteAcquisition` (:104). Un DTO malicioso `ex_plus` sobre una común no infla el pago. |
| **SEC-A2** | **CERRADO (código)** | `buylist.service.ts:171-195` — lectura de `monthUsed` (`monthUsedCentsTx`, :211-224) y creación del `SellRequest` en un `$transaction` con `isolationLevel: Serializable`. Dos solicitudes concurrentes cerca del tope entran en conflicto de serialización. Carrera: **re-test en vivo pendiente de staging** (DAST). |
| **SEC-A3** | **CERRADO** | `schema.prisma:341` `sourceSellRequestItemId String? @unique`; migración `20260813120000_unique_source_sell_request_item/migration.sql:9` crea el índice único; `buylist.service.ts:381-423` crea el `InventoryItem` en `$transaction` y captura **P2002** resolviendo como "ya convertido". Garantiza UN solo InventoryItem. Carrera: **re-test en vivo pendiente de staging**. |
| **SEC-A4** | **CERRADO** | `admin.service.ts:54-95` `getUser(id, role)` — para no-`super_admin` (operador) devuelve CLABE **enmascarada** (`maskClabe`), `ineOnFile:boolean` en vez de las keys de INE, RFC omitido y `billingProfile:null`. El controller pasa el rol real (`admin.controller.ts:45-47`). Segregación de funciones restaurada. Se mantiene íntegro tras el endurecimiento de PII (ronda 3). |
| **SEC-A5** | **CERRADO** | App: `disputes.service.ts:21-23` sirve INE/disputa por `uploads.presignGet` (GET prefirmado 300s, `uploads.service.ts:55-59`), no por `S3_PUBLIC_BASE_URL`. Infra: `docker-compose.yml:115-117` `createbuckets` deja el bucket privado (`mc anonymous set none`) y publica **solo** `inventory_photo/`; documentado en `DEVOPS_NOTES.md:493-508`. |

**Extras corregidos de paso (deuda media resuelta, no exigida para aprobar):**
- **SEC-M3** (refund sin guardia de estado) → `admin-orders.controller.ts:79-88`: exige `status === 'settled'` + idempotency-key obligatoria. **CERRADO.**
- **SEC-M5** (`pay-spei` sin idempotencia/carrera) → `buylist.service.ts:435-459`: cortocircuito idempotente + `updateMany` guardado por estado (`count===1`). **CERRADO.**

**Conclusión ronda 2:** los 7 bloqueantes (C1, C2, A1, A2, A3, A4, A5) quedan **CERRADOS**.

---

## 0.b RE-VERIFICACIÓN del endurecimiento de PII (ronda 3 — esta sesión)

En la ronda 2 dejé como **bandera para el humano abierta** (§2.3 anterior): **CLABE almacenada en claro**
en `KycProfile.clabe` y **retención/borrado de INE sin implementar**. Backend implementó el cifrado en
reposo + blind index + reveal auditado + job de retención (commits **`fbb66e1`** backend, **`2c6aa8d`**
contrato, **`c137c83`** devops). Re-verifiqué **en el código y con las specs**, no por confianza:

| Control | Estado | Evidencia verificada |
|---|---|---|
| **Cifrado AES-256-GCM en reposo** | **RESUELTO** | `common/crypto/pii-crypto.service.ts:101-126`: `encrypt/decrypt` AES-256-GCM, formato serializado `v1:iv:tag:ciphertext` (base64 por campo), **IV aleatorio de 12 bytes por operación** (`randomBytes`, :102) y **authTag de 16 bytes** verificado en `decrypt` (rechaza texto manipulado/mal formado, :117-124). Columnas cifradas: `schema.prisma:213` `rfcEnc`, :214 `clabeEnc`, :514 `SellRequest.clabeSnapshotEnc`, :236 `BillingProfile.rfcEnc`. Ya **no** existe columna `clabe`/`rfc` en claro. |
| **Blind index HMAC (match sin descifrar)** | **RESUELTO** | `pii-crypto.service.ts:139-146`: `blindIndex`/`clabeBlindIndex` = HMAC-SHA256 con clave dedicada `PII_HMAC_KEY` sobre el valor **normalizado a solo dígitos**. Comparación en **tiempo constante** `blindIndexEquals` (:149-155, `timingSafeEqual` con guardia de longitud). Uso real: `buylist.service.ts:80-81` compara `kyc.clabeHmac` contra el HMAC entrante sin descifrar; persiste `clabeHmac` (:161,168); `schema.prisma:217,228` columna `clabeHmac` + `@@index([clabeHmac])`. |
| **Reveal on-demand (CLABE en claro solo al pagar)** | **RESUELTO** | `admin-buylist.controller.ts:46-58` `GET :id/reveal-clabe` con `@Roles(super_admin)` + `@MoneyOut()` + **AuditLog** `action:'buylist.reveal_clabe'` (actor, rol, entidad, id). Servicio `buylist.service.ts:330-342` descifra el snapshot (o `kyc.clabeEnc` de respaldo) y es el **único** punto que devuelve CLABE en claro. Enmascarada en el resto: `buylist.adminGet:320-321` (elimina `clabeSnapshotEnc`, devuelve `clabeMasked`), `admin.service.getUser:69,80-81,89` (CLABE/RFC enmascarados incluso para super_admin). **SEC-A4 intacto**: operador sin RFC/INE (`admin.service.ts:95+`). |
| **Retención de INE (borrado por antigüedad)** | **RESUELTO** | `jobs/ine-retention.service.ts:31-79`: `run()` purga `ineFrontKey`/`ineBackKey` (objeto del bucket + limpia keys) solo si el usuario **no** tiene solicitudes abiertas (:42-48) y su última solicitud cerrada superó `INE_RETENTION_DAYS` (:32-58). Dial `settings.constants.ts:25,101` (validador `int >= 0`). 2ª capa (devops): lifecycle del bucket sobre `kyc_ine/` (`docker-compose.yml:117-118`, `DEVOPS_NOTES.md:619-642`). **Nota:** el scheduling repetible (BullMQ) queda como deuda BE-5 documentada; `run()` es invocable a mano/CLI/endpoint. |
| **Llaves desde env, obligatorias en no-local** | **RESUELTO** | `pii-crypto.service.ts:48-98`: `PII_ENCRYPTION_KEY` (32 bytes base64, valida longitud exacta) y `PII_HMAC_KEY` (>= 32 bytes). En NODE_ENV no-local **FALLA claro** si faltan/mal formadas (:65-70, :88-93); en local deriva clave dev determinista **con warning** (:71-74, :94-97). KMS en prod = bandera de humano (§2). |

**Specs ejecutadas esta sesión** (`cd backend && npx jest pii-crypto buylist.clabe-pii ine-retention`):
**3 suites, 20 tests, todos PASS** (`test/pii-crypto.spec.ts`, `test/buylist.clabe-pii.spec.ts`,
`test/ine-retention.spec.ts`). El warning de clave dev local aparece como se espera en el arranque de test.

**Conclusión ronda 3:** la bandera de **CLABE en claro / INE sin retención pasa de ABIERTA → RESUELTA.**
No abre ningún hallazgo Crítico/Alto nuevo. Queda **una** decisión legal pendiente del humano: el **valor**
de `INE_RETENTION_DAYS` (ver §2, bandera nueva) — hoy **inconsistente** entre backend (seed 180 días) y
devops (env/lifecycle 1825 días).

---

## 1. Deuda de seguridad que permanece (no bloqueante) — con disparador

Aceptable **para desarrollo / beta cerrada**, NO para operar con dinero/público real sin cerrarse.

| ID | Deuda | Ubicación | Impacto residual hoy | Disparador |
|---|---|---|---|---|
| **SEC-M1** | CORS refleja cualquier origin con credenciales | `main.ts:26` `origin:true, credentials:true` | Bajo (tokens en `localStorage`, no cookies) | **Antes de exponer a público** o **antes de migrar a cookies de sesión** |
| **SEC-M2** | JWT en `localStorage` | `frontend/src/lib/api-client.ts` | Depende de que no haya XSS | Junto con CSP estricta; **antes de dinero real** |
| **SEC-M4** | Compose con credenciales default | `docker-compose.yml` defaults `tcg_local_dev_password`/`minioadmin_local_dev` | **Mitigado**: puertos de datos ya atados a `127.0.0.1` (`docker-compose.yml:38`, `DEVOPS_NOTES.md:543`) | Secretos únicos por entorno + negar arranque con defaults **antes del primer deploy accesible** |
| **SEC-B1** | JWT sin `algorithms:['HS256']` fijados | `auth.module.ts` / guard | Bajo (secreto simétrico + `jsonwebtoken 9.0.2`: no explotable) | Próximo sprint de hardening |
| **SEC-B2** | Validación de env solo en `production` | `env.validation.ts:8` | Bajo (staging puede arrancar sin secretos fuertes) | Sprint de hardening / antes de staging permanente |
| **SEC-B3** | Sin `helmet`/cabeceras de seguridad | `main.ts` (sin HSTS/CSP/X-Frame-Options) | Bajo | **Antes de exponer panel/uploads a público** (o resolver en reverse proxy) |
| **SEC-B4** | Presign de subida sin allow-list de content-type/tamaño | `uploads.service.ts:34-47` (acepta cualquier `contentType`, sin límite) | Bajo tras SEC-A5 (bucket privado, `Content-Disposition` no inline en prefijos sensibles) | **Antes de exponer uploads a público** |
| **SEC-B5** | Scheduling repetible del job de retención de INE pendiente (BullMQ) | `jobs/ine-retention.service.ts` (deuda BE-5) | Bajo (`run()` es invocable manual/CLI; lifecycle del bucket cubre como 2ª capa) | Antes de operar con volumen real de KYC; cablear cron/BullMQ + monitor de la corrida |
| **Deps framework** | 4 moderate backend | `@nestjs/core` (injection), `@nestjs/platform-express`, `file-type` x2 (DoS parser/zip-bomb) vía `@nestjs/common` | Bajo/Moderado (requiere upgrade mayor de NestJS a 11.1.29, breaking) | Planear bump de NestJS en sprint de mantenimiento; el gate `security-sast.yml` sigue cubriendo el piso |

> Registrar el pendiente de código en `docs/TECH_DEBT.md` (a petición del techlead) por el rol dueño.

**Positivas ya verificadas (se mantienen, sin acción):** reserva de checkout atómica (`orders.service.ts`),
webhook Stripe con firma + idempotencia atómica (`payments.service.ts`), IDOR por objeto cerrado y
`MoneyOutGuard` (`super_admin` + auditoría) en todo dinero saliente, **PII (CLABE/RFC) cifrada en reposo +
blind index + reveal auditado + retención de INE** (ronda 3, §0.b). Ver PENTEST_NOTES I-1/I-2/I-3.

---

## 2. Banderas para el humano

1. **Pentest de tercero + programa de bug bounty ANTES de operar con dinero real.** Esta re-verificación
   sigue siendo **estática**. Los vectores dinámicos (fuerza bruta de login, carreras de tope mensual y
   convert-to-inventory, CORS) están **remediados en código pero sin confirmación en vivo**: deben
   dispararse contra staging autorizado antes de mover dinero real. En un negocio con dinero + custodia +
   PII, la revisión externa es requisito, no opcional.
2. **Activar el DAST real contra staging:** `security-scheduled.yml` es plantilla hasta que exista
   `STAGING_BASE_URL`. Levantar staging y disparar ZAP/nuclei + reproducir los PoC concurrentes de A2/A3 y
   el brute-force de C1 (verificar 429 del throttler; **nota:** el storage del throttler es in-memory por
   instancia — en multi-instancia devops debe cablear Redis + `trust proxy`, ya anotado en el código).
3. **KMS en producción para las llaves de PII.** El cifrado AES-256-GCM y el HMAC ya toman `PII_ENCRYPTION_KEY`
   / `PII_HMAC_KEY` desde env y **fallan claro** si faltan en no-local (`pii-crypto.service.ts:65-93`). En
   prod estas llaves deben vivir en un **KMS/secret manager** (no `.env` en host), con **rotación** y política
   de re-cifrado (el formato versionado `v1:` ya deja lugar para migrar a `v2`). Confirmar con devops el
   provisioning en el secret manager de prod.
4. **CONFIRMAR el valor legal de `INE_RETENTION_DAYS` (decisión del humano — inconsistencia activa).** Hoy
   los dos lados NO coinciden: **backend siembra 180 días** (`settings.constants.ts:47`, doc `BACKEND_NOTES.md:331,344`)
   y **devops usa 1825 días** (≈ 5 años) en env/lifecycle (`.env.example:151`, `docker-compose.yml:167`,
   `docker-compose.staging.yml:151`, `DEVOPS_NOTES.md:141,635`). El **dial en BD (settings) es la fuente de
   verdad del borrado por el backend**; el lifecycle del bucket es 2ª capa y debe fijarse **con el mismo
   número**. Legal/fiscal/contador debe definir el valor único (LFPDPPP: minimización + retención justificada)
   y luego alinear **ambos** lados. Hasta entonces la INE podría purgarse antes (180d) de lo que el bucket
   expira (1825d), o viceversa. **No es bloqueante de seguridad** (el mecanismo funciona), pero sí una
   decisión de negocio/legal pendiente.
5. **Legal/PII (México):** custodia implica figura de **depositario** y contrato de custodia. INE/CLABE/RFC
   caen bajo **LFPDPPP**: el cifrado en reposo + enmascarado + reveal auditado + retención ya están
   implementados (§0.b); falta el **aviso de privacidad** y la validación jurídica de la política de
   retención antes de operar.
6. **Segregación de funciones:** confirmada en código (SEC-A4, se mantiene tras el endurecimiento de PII).
   Validar con el negocio que la política "vault_operator NO ve datos bancarios/identidad" es la deseada.
7. **Secret management en prod:** mover secretos a un secret manager (no `.env` en host); confirmar que
   `SEED_ADMIN_PASSWORD`/`SEED_OPERATOR_PASSWORD` fuertes se inyectan en cada deploy (el seed ya **falla**
   sin ellos en no-local, buen fail-safe).

---

## 3. VEREDICTO

### APROBADO

Los **7 bloqueantes** de la ronda 1 (SEC-C1, C2, A1, A2, A3, A4, A5) quedan **CERRADOS**. La única
**bandera de humano abierta** que quedaba con carga de seguridad — **CLABE en claro / INE sin retención** —
pasa a **RESUELTA** en esta ronda 3, verificada en código y con **20 tests de PII en verde**
(`pii-crypto`, `buylist.clabe-pii`, `ine-retention`). **No hay hallazgos Críticos ni Altos abiertos.**

`npm audit --omit=dev`: **frontend 0 vulnerabilidades; backend 0 high/critical** (4 moderate de framework
como deuda aceptada). El gate `security-sast.yml` sigue fallando en high/critical como red de seguridad.

**Condiciones de la aprobación (no bloqueantes, pero exigibles antes de dinero/público real):**
1. Ejecutar el **DAST contra staging** para confirmar en vivo C1 (throttling/lockout), A2 y A3 (carreras).
2. Cerrar la deuda §1 según sus disparadores (CORS, localStorage/CSP, helmet, presign content-type,
   defaults de compose, scheduling BullMQ de retención, bump de NestJS) **antes** de exponer a público o
   mover dinero real.
3. **Pentest de tercero + bug bounty** (§2.1), **KMS + rotación de llaves de PII en prod** (§2.3),
   **DAST en staging** (§2.2) y **definir/alinear `INE_RETENTION_DAYS`** (§2.4, decisión legal, hoy
   inconsistente 180 vs 1825) antes de operar con dinero real.

**Estado:** apto para avanzar a staging y pruebas dinámicas. La PII sensible (CLABE/RFC/INE) queda
**cifrada en reposo, enmascarada por defecto, revelada solo por super_admin auditado, y con retención de
INE**. La aprobación para **producción con dinero real** queda condicionada a las 3 condiciones anteriores.

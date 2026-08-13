# SECURITY_NOTES.md — Ingeniería de seguridad (blue team)

> **Rol:** consolidación defensiva + veredicto. Insumo principal: `docs/PENTEST_NOTES.md` (red team).
> **Método:** validación estática cruzando cada hallazgo contra el código (`backend/`, `frontend/`),
> config devops (`docker-compose.yml`, `.env.example`, `.github/workflows/`, `security/`) y `npm audit`.
> **Regla:** solo se escribe este archivo; no se corrige código. Cada hallazgo indica el **rol dueño**.
> **La vara sube por el negocio:** custodia de bienes de valor + dinero saliente + PII sensible
> (INE / CLABE / RFC).
> Fecha ronda 1 (RECHAZO): 2026-08-13. Fecha ronda 2 (RE-VERIFICACIÓN): 2026-08-13.

---

## 0. RE-VERIFICACIÓN tras la ronda de fixes (esta sesión)

En la ronda 1 **RECHACÉ** con 7 bloqueantes (2 Críticos, 5 Altos: SEC-C1, C2, A1, A2, A3, A4, A5).
Los roles aplicaron fixes (commits `e504466` backend, `cb1eb2b` frontend, `9a47f16` devops).
Re-verifiqué cada uno **en el código, no por confianza**. Resultado:

| ID | Estado | Evidencia verificada |
|---|---|---|
| **SEC-C1** | **CERRADO** | `@nestjs/throttler` en deps; `ThrottlerModule` global 300/min + `ThrottlerGuard` como primer `APP_GUARD` (`app.module.ts:34,56`); `@Throttle` login/register 5/min y refresh 20/min (`auth.controller.ts:12,22,31`); seed sin passwords hardcodeadas, exige `SEED_ADMIN_PASSWORD`/`SEED_OPERATOR_PASSWORD` y **falla** en no-local (`seed.ts:24-38,53,70`). Fuerza bruta: remediado en código; **re-test en vivo pendiente de staging**. |
| **SEC-C2** | **CERRADO** | `npm audit --omit=dev` (esta sesión): **frontend = 0 vulnerabilidades**; **backend = 0 high/critical, 4 moderate** (todas de framework: `@nestjs/core`, `@nestjs/platform-express`, `file-type` x2 vía `@nestjs/common`). Los críticos/high runtime que motivaron el rechazo ya no aparecen. Las 4 moderate quedan como **deuda de framework** (ver §2). |
| **SEC-A1** | **CERRADO** | `buylist.service.ts:99` deriva `category = await this.categoryForRarity(card.rarity)` dentro de `createRequest`; el `it.category` del DTO ya **no** alimenta `quoteAcquisition` (:104). Un DTO malicioso `ex_plus` sobre una común no infla el pago. |
| **SEC-A2** | **CERRADO (código)** | `buylist.service.ts:171-195` — lectura de `monthUsed` (`monthUsedCentsTx`, :211-224) y creación del `SellRequest` en un `$transaction` con `isolationLevel: Serializable`. Dos solicitudes concurrentes cerca del tope entran en conflicto de serialización. Carrera: **re-test en vivo pendiente de staging** (DAST). |
| **SEC-A3** | **CERRADO** | `schema.prisma:341` `sourceSellRequestItemId String? @unique`; migración `20260813120000_unique_source_sell_request_item/migration.sql:9` crea el índice único; `buylist.service.ts:381-423` crea el `InventoryItem` en `$transaction` y captura **P2002** resolviendo como "ya convertido". Garantiza UN solo InventoryItem. Carrera: **re-test en vivo pendiente de staging**. |
| **SEC-A4** | **CERRADO** | `admin.service.ts:54-92` `getUser(id, role)` — para no-`super_admin` (operador) devuelve CLABE **enmascarada** (`maskClabe`, :12-17), `ineOnFile:boolean` en vez de las keys de INE, y `billingProfile:null` (RFC oculto). El controller pasa el rol real (`admin.controller.ts:45-47`). Segregación de funciones restaurada. |
| **SEC-A5** | **CERRADO** | App: `disputes.service.ts:21-23` sirve INE/disputa por `uploads.presignGet` (GET prefirmado 300s, `uploads.service.ts:55-59`), no por `S3_PUBLIC_BASE_URL`. Infra: `docker-compose.yml:115-117` `createbuckets` deja el bucket privado (`mc anonymous set none`) y publica **solo** `inventory_photo/`; documentado en `DEVOPS_NOTES.md:493-508` (prod R2/S3 con Block Public Access, prefijos `kyc_ine/`/`dispute_claim/` solo por presigned GET). |

**Extras corregidos de paso (deuda media resuelta, no exigida para aprobar):**
- **SEC-M3** (refund sin guardia de estado) → `admin-orders.controller.ts:79-88`: exige `status === 'settled'` + idempotency-key obligatoria (derivada si falta). **CERRADO.**
- **SEC-M5** (`pay-spei` sin idempotencia/carrera) → `buylist.service.ts:435-459`: cortocircuito idempotente si ya `pagada` + `updateMany` guardado por estado (patrón `count===1`). **CERRADO.**

**Conclusión de la re-verificación:** **los 7 bloqueantes (C1, C2, A1, A2, A3, A4, A5) quedan CERRADOS.**
No quedan hallazgos **Críticos ni Altos abiertos**. Los ítems de carrera (A2, A3) y fuerza bruta (C1)
están correctos en código; su confirmación 100% requiere disparo dinámico contra staging.

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
| **Deps framework** | 4 moderate backend | `@nestjs/core` (injection), `@nestjs/platform-express`, `file-type` x2 (DoS parser/zip-bomb) vía `@nestjs/common` | Bajo/Moderado (requiere upgrade mayor de NestJS a 11.1.29, breaking) | Planear bump de NestJS en sprint de mantenimiento; el gate `security-sast.yml` (falla en high/critical) sigue cubriendo el piso |

> Registrar el pendiente de código en `docs/TECH_DEBT.md` (a petición del techlead) por el rol dueño.

**Positivas ya verificadas (se mantienen, sin acción):** reserva de checkout atómica (`orders.service.ts`),
webhook Stripe con firma + idempotencia atómica (`payments.service.ts`), IDOR por objeto cerrado y
`MoneyOutGuard` (`super_admin` + auditoría) en todo dinero saliente. Ver PENTEST_NOTES I-1/I-2/I-3.

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
3. **Legal/PII (México):** custodia implica figura de **depositario** y contrato de custodia. INE/CLABE/RFC
   caen bajo **LFPDPPP**: aunque la INE ya se sirve por presigned GET y la CLABE se **enmascara** en la
   ficha del operador, la CLABE **sigue almacenada en claro** en `KycProfile.clabe`. Definir **cifrado en
   reposo de CLABE**, política de **retención/borrado** de INE y aviso de privacidad antes de operar.
4. **Segregación de funciones:** confirmada en código (SEC-A4). Validar con el negocio que la política
   "vault_operator NO ve datos bancarios/identidad" es la deseada (el código ya la aplica).
5. **Secret management en prod:** mover secretos a un secret manager (no `.env` en host); confirmar que
   `SEED_ADMIN_PASSWORD`/`SEED_OPERATOR_PASSWORD` fuertes se inyectan en cada deploy (el seed ya **falla**
   sin ellos en no-local, buen fail-safe).

---

## 3. VEREDICTO

### APROBADO

Los **7 bloqueantes** de la ronda 1 (SEC-C1, C2, A1, A2, A3, A4, A5) quedan **CERRADOS**, verificados en
código en esta sesión. **No hay hallazgos Críticos ni Altos abiertos.** Además se cerraron de paso dos
deudas Medias (SEC-M3, SEC-M5).

`npm audit --omit=dev`: **frontend 0 vulnerabilidades; backend 0 high/critical** (4 moderate de framework
como deuda aceptada). El gate `security-sast.yml` sigue fallando en high/critical como red de seguridad.

**Condiciones de la aprobación (no bloqueantes, pero exigibles antes de dinero/público real):**
1. Ejecutar el **DAST contra staging** para confirmar en vivo C1 (throttling/lockout), A2 y A3 (carreras).
2. Cerrar la deuda §1 según sus disparadores (CORS, localStorage/CSP, helmet, presign content-type,
   defaults de compose, bump de NestJS) **antes** de exponer a público o mover dinero real.
3. **Pentest de tercero + bug bounty** y **validaciones legales de custodia/PII (cifrado de CLABE en
   reposo, retención de INE)** antes de operar con dinero real (§2).

**Estado:** apto para avanzar a staging y pruebas dinámicas. La aprobación para **producción con dinero
real** queda condicionada a las 3 condiciones anteriores.

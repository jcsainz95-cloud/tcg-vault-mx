# SECURITY_NOTES.md — Seguridad (blue team) · consolidación y veredicto

> **Rol:** seguridad (blue team). Reviso la defensa, **valido/consolido** los hallazgos del
> `pentester` (`docs/PENTEST_NOTES.md`) contra el código y emito el **VEREDICTO**. No corrijo
> código: cada hallazgo se enruta al **rol dueño**.
> **Alcance:** v1.1 (login Google, sync de catálogo, Compra/facetas, portfolio history/snapshot,
> convert-to-inventory, sellado con precio manual) + re-chequeo de guardarraíles de v1.0.
> **Modo:** revisión estática de código + `npm audit`. Sin stack vivo → los vectores que exigen
> instancia se marcan **[PoC pendiente de target]**; los verificados por lectura, **[Verificado en código]**.
> **Fecha:** 2026-08-14 (rev v1.1). Blanco autorizado: staging/local.

---

## 0. Resumen ejecutivo

Confirmo la lectura del pentester: **las superficies nuevas de v1.1 llegaron endurecidas** y
**no hay hallazgos Críticos ni Altos abiertos**. Validé en código los 6 hallazgos del red team
(M-1, M-2, B-1..B-4) y los 8 positivos (I-1..I-8); **ninguno cambia de banda de severidad**. Los
guardarraíles de dinero/PII **no presentan regresión**: reserva atómica de checkout, firma +
idempotencia atómica del webhook Stripe, `MoneyOutGuard` (solo `super_admin`), y PII cifrada/
enmascarada con `reveal-clabe` como único punto de CLABE en claro (money-out + auditado).

Lo abierto es **Media/Baja**, de infraestructura y defensa en profundidad. **VEREDICTO: APROBADO
para staging**, condicionado a cerrar **M-2 (CORS)** y **B-3 (presign allow-list)** antes de la
promoción a producción con dinero/PII reales (ver §4 y §5).

| Severidad | # | IDs |
|---|---|---|
| Crítica | 0 | — |
| Alta | 0 | — |
| Media | 2 | S-M1 (=M-1), S-M2 (=M-2) |
| Baja | 4 | S-B1..S-B4 (=B-1..B-4) |
| Info/positivo (verificado) | 8 | I-1..I-8 |

---

## 1. Hallazgos priorizados

### MEDIA

#### S-M1 — Dependencias vulnerables en runtime backend (cadena `google-auth-library`→gaxios→uuid + `@nestjs/*`→file-type)
- **Confirmado.** `npm audit --omit=dev` (corrido en esta sesión, 2026-08-14) reporta **6 moderate, 0 high, 0 critical** en backend:
  - `uuid <11.1.1` (moderate, *missing buffer bounds check*) arrastrado por `gaxios 6.4.0–6.7.1`, que entra como dependencia directa de **`google-auth-library`** (nueva en v1.1, superficie del login Google).
  - `@nestjs/common` → depende de versión vulnerable de **`file-type`** (moderate, DoS por parser).
  - Fix disponible vía `npm audit fix` (no `--force`).
- **Frontend:** el `critical` (`vitest`) y `high` (`vite`) son **solo devDependencies** (tooling de test/build, no van al bundle de producción de Next.js). Riesgo acotado a la máquina de CI/dev, no al sitio en prod. **Falso positivo como riesgo de producción** — correcto marcarlo aparte.
- **Evidencia:** salida `npm audit --omit=dev` en `backend/`; `gaxios`/`uuid`/`@nestjs/common`+`file-type` listados.
- **Severidad final:** Media (runtime moderate, sin high/critical desplegado).
- **Rol dueño:** **devops** (bump puntual + gate `npm audit` en el SAST del pipeline; priorizar runtime backend sobre tooling frontend).

#### S-M2 — CORS refleja cualquier origin con credenciales (regresión no cerrada de v1.0)
- **Confirmado [Verificado en código].** `backend/src/main.ts:26` → `app.enableCors({ origin: true, credentials: true })`. Refleja el `Origin` del atacante y habilita `Access-Control-Allow-Credentials: true`. No hay allow-list de dominios de storefront/admin.
- **Análisis de explotabilidad:** hoy los tokens viven en `localStorage` y viajan como `Authorization: Bearer` (no cookies), por lo que un `fetch(..., {credentials:'include'})` cross-origin **no** arrastra el token de la víctima → la exfiltración directa está limitada. Por eso **Media, no Alta**. Pero la política es insegura para una API de dinero/PII y **se vuelve Alta** en cuanto exista un flujo con cookie (el contrato §0 menciona un posible refresh por cookie httpOnly).
- **Severidad final:** Media. **Disparador de escalada a Alta:** cualquier auth/refresh basado en cookie.
- **Rol dueño:** **backend** (allow-list de orígenes desde config: dominios de staging y prod; sin `origin:true` en prod).

### BAJA

#### S-B1 — Login Google ensancha la superficie de auth de cuentas privilegiadas
- **Confirmado [Verificado en código].** `backend/src/modules/auth/auth.service.ts:116-173` (`google()`). El account-linking (`:128-149`) enlaza el ID token de Google a **cualquier** cuenta local con el mismo email verificado **sin excluir `super_admin`/`vault_operator`**. El `role` se conserva de la BD (correcto: nunca del token, `:159` `Role.customer` solo en altas nuevas).
- **No es escalada** — el `role` es server-side y el linking exige `email_verified=true`. El riesgo real: si una cuenta de back-office usa email @gmail, su seguridad pasa a depender **también** de la seguridad de esa cuenta Google (phishing OAuth, 2FA), no solo del argon2.
- **Severidad final:** Baja (condicionada a que un back-office use email Google).
- **Rol dueño:** **backend** (decisión de negocio: restringir linking/login Google a `role=customer`, o exigir MFA en back-office). **Deuda aceptable con disparador** — ver §5.

#### S-B2 — Columnas de dinero en `Int` de 32 bits (overflow > ~MX$21.47M)
- **Confirmado [Verificado en código].** `backend/prisma/schema.prisma`: montos `*Cents` son `Int` (máx 2,147,483,647 c ≈ **MX$21,474,836.47**). Relevantes: `PortfolioSnapshot.totalValueMxnCents:641` y `costBasisMxnCents:642`, `InventoryItem.listPriceCents:363`, agregados de orden (`subtotalCents:458`, `totalCents:461`) y `SellRequest.*Cents`.
- **Riesgo:** un portafolio agregado, P&L o custody-value que supere ~MX$21.47M desborda el `Int` de Postgres → error de escritura o valor inconsistente. `listPriceCents` del sellado usa `@Min(0)` **sin `@Max`**: un `super_admin` (input confiable) podría fijar un precio > 2^31 y romper integridad. No explotable por atacante externo, pero rompe features de dinero con datos legítimos grandes.
- **Severidad final:** Baja (integridad, no explotable externamente).
- **Rol dueño:** **arquitecto** (decisión de tipo `BigInt` para agregados de dinero — cambio de schema/contrato) + **backend** (implementación + cota `@Max` en `listPriceCents`). **Deuda aceptable con disparador** — ver §5.

#### S-B3 — Presign de subida sin allow-list de content-type ni límite de tamaño
- **Confirmado [Verificado en código].** `backend/src/modules/uploads/uploads.controller.ts:10` → `contentType` es `@IsString()` sin `@IsIn` de imágenes; `uploads.service.ts:41` deriva la extensión del `contentType` del cliente (`contentType.split('/')[1] ?? 'bin'`) sin allow-list `image/*` ni `Content-Length` máximo.
- **Mitigación parcial verificada:** `uploads.service.ts:60-64` (`presignGet`, SEC-A5) sirve documentos sensibles vía GET prefirmado de vida corta y el diseño exige **bucket privado** (devops). Eso **corta el vector de XSS almacenado servido públicamente** siempre que devops mantenga el bucket sin lectura pública. Sin ese cierre de infra, un `POST /uploads/presign {contentType:"text/html"}` permitiría subir HTML arbitrario al bucket.
- **Severidad final:** Baja (mitigada por bucket privado; queda el abuso de almacenamiento y el riesgo si el bucket se expone).
- **Rol dueño:** **backend** (allow-list `image/*`, tamaño máximo, `Content-Disposition: attachment`) + **devops** (confirmar bucket privado / lifecycle).

#### S-B4 — Endurecimientos de auth/transport (defensa en profundidad)
- **Confirmado [Verificado en código]:**
  - `jwt-auth.guard.ts:34-36` y `auth.service.ts:44-54,177` — `verifyAsync`/`signAsync` **sin fijar `algorithms:['HS256']`**. Con `jsonwebtoken` y secreto simétrico, `alg:none` y la confusión RS↔HS **no son explotables** (la lib deriva el algoritmo por tipo de clave); queda como defensa en profundidad.
  - `config/env.validation.ts:16` — valida `JWT_*`/`DATABASE_URL`/Stripe **solo si `NODE_ENV==='production'`**; en staging arranca sin exigir secretos fuertes. **Sin chequeo de entropía mínima** del secreto JWT (un secreto débil permitiría forjar tokens `super_admin`).
  - `main.ts` — **sin `helmet()`** ni cabeceras de seguridad (HSTS, X-Content-Type-Options, X-Frame-Options). Confirmado: `helmet` no está en código ni en `package.json`.
- **Severidad final:** Baja aislada; en conjunto reducen margen ante mala configuración.
- **Rol dueño:** **backend** (fijar `algorithms`, validar/entropía del secreto también en staging, `helmet`) + **devops** (cabeceras en el borde/proxy, longitud mínima de secretos, secret manager en prod).

---

## 2. Guardarraíles previos — SIN regresión (verificado en código)

| Guardarraíl | Evidencia | Estado |
|---|---|---|
| **Reserva atómica anti doble-venta** | `orders.service.ts:119-150` — `updateMany` guardado por estado vendible + `count!==1 → ITEM_UNAVAILABLE` dentro de `$transaction`. Idempotency-key de PI derivada en servidor (`:152-154`). | OK |
| **Webhook Stripe: firma** | `stripe.service.ts:118-121` — `webhooks.constructEvent(payload, signature, STRIPE_WEBHOOK_SECRET)`; raw body preservado en `main.ts:14-18`. | OK |
| **Webhook Stripe: idempotencia** | `payments.service.ts:38-89` — `create` de `ProcessedStripeEvent` como guardia atómica (P2002 → no-op); si el handler falla, **borra la marca y re-lanza** (Stripe reintenta; nunca marca procesado sin éxito). | OK |
| **Money-out solo super_admin** | `money-out.guard.ts:32-46` — rol != `super_admin` → `403 MONEY_OUT_FORBIDDEN` y **audita** el intento bloqueado (`money_out.blocked`). Aplicado a reveal-clabe/pay-spei/refund/recompra. | OK |
| **PII cifrada/enmascarada** | `schema.prisma` `*Enc`/`*Hmac`; enmascarado por defecto incluso para `super_admin`; `reveal-clabe` = único CLABE en claro (money-out + auditado); `vault_operator` con proyección reducida. | OK (según ARQ §3.4 + I-8 del pentest) |
| **Login Google server-side** | `google-token-verifier` + `auth.service.ts:116-173` — verifica firma/aud/iss/exp + `email_verified`; `role` siempre server-side. | OK |
| **Sync catálogo anti-inyección/SSRF** | `catalog-sync.service.ts:10,53` `SET_ID_PATTERN`; `pokemontcg-io.client.ts:47` host fijo `https://api.pokemontcg.io/v2`; `:72` `encodeURIComponent`. | OK |
| **Portfolio history/snapshot sin IDOR** | `userId` desde JWT (`@CurrentUser`), nunca de parámetro; disparo de snapshot `@Roles(super_admin)`. | OK (I-5) |
| **convert-to-inventory guard + anti-carrera** | `ITEM_NOT_APPROVED` + índice único `sourceSellRequestItemId` (P2002). | OK (I-6) |
| **Tope mensual buylist atómico** | `$transaction` `Serializable`; categoría derivada server-side (`categoryForRarity`). | OK (I-7) |

---

## 3. Deuda de seguridad aceptada (no bloqueante, con disparador)

| ID | Deuda | Impacto | Disparador para abordarla |
|---|---|---|---|
| S-B1 | Linking Google a cuentas back-office | Traslada seguridad de cuentas privilegiadas a Google | **Antes de alta de cualquier back-office con email @gmail**, o al habilitar más operadores. Alternativa: restringir login Google a `customer` ya. |
| S-B2 | Dinero en `Int` 32-bit | Overflow de integridad en agregados > ~MX$21.47M | **Antes de que portafolios/P&L/custody agregados puedan acercarse a MX$21M**, o antes de operar con dinero real a escala. Migrar a `BigInt` vía arquitecto. |
| S-B3 (parte infra) | Bucket público serviría contenido subido | XSS almacenado si el bucket es de lectura pública | Se acepta **solo** si devops confirma bucket privado + presign de lectura. Si no, sube a Media. |
| S-B4 | `algorithms` no fijado, validación env solo prod, sin helmet | Defensa en profundidad reducida | **Antes de exponer staging a Internet** (validar secretos + helmet); fijar `algorithms` en el próximo toque de auth. |

---

## 4. Mínimo para aprobar producción (dinero/PII reales)

No hay Críticos/Altos → **no bloquea staging**. Para la **promoción a producción** exijo cerrar:
1. **S-M2 (CORS)** — allow-list de orígenes; sin `origin:true`. **[backend]** — obligatorio si se añade cualquier cookie de auth.
2. **S-B3 (presign)** — allow-list `image/*` + tamaño máx **[backend]** y confirmación de **bucket privado** **[devops]**.
3. **S-M1 (deps)** — `npm audit fix` del runtime backend + gate `npm audit` en CI **[devops]**.
4. **S-B4 (transport)** — `helmet` + validación de secretos/entropía también en staging **[backend/devops]**.

S-B1 y S-B2 quedan como **deuda aceptada con disparador** (§3); no bloquean, pero deben resolverse antes de operar con público real a escala.

---

## 5. Banderas para el humano (antes de operar con dinero real)

- **Pentest de tercero + programa de bug bounty** antes del go-live con dinero real: esta revisión es **estática y de caja blanca interna**; los vectores marcados **[PoC pendiente de target]** (CORS cross-origin, DoS por dependencias, abuso de presign, concurrencia de checkout/buylist) requieren validación **dinámica** contra staging (ZAP/nuclei + scripts de concurrencia).
- **KMS / secret manager en producción**: `PII_ENCRYPTION_KEY`, `PII_HMAC_KEY`, `JWT_*`, `STRIPE_*` deben provenir de un secret manager (no `.env` ni imagen). Confirmar rotación y que ningún secreto aparezca en logs/errores.
- **Validaciones legales de custodia/PII** (ya en PROJECT §Riesgos): figura de depositario, contrato de custodia, seguro del inventario, y cumplimiento del manejo de INE/CLABE/RFC (retención `INE_RETENTION_DAYS`, minimización). Requisito legal, no técnico, pero **previo a operar con bienes/dinero de terceros**.
- **Cierre de M-2/M-6 de v1.0 (infra, devops)**: fotos por URL pública y puertos de datos expuestos en compose — pendientes de confirmar en la revisión de infra con target vivo (el pentester no pudo re-instrumentarlos sin stack).

---

## 6. VEREDICTO

**APROBADO para staging.** **0 Críticos / 0 Altos abiertos**; los hallazgos abiertos son 2 Medias y
4 Bajas, ninguno bloqueante por la regla de la DoD (RECHAZO solo con crítico/alto abierto).

**Condicionado para producción:** cerrar **S-M2 (CORS)**, **S-B3 (presign + bucket privado)**,
**S-M1 (deps runtime)** y **S-B4 (helmet/secretos)** antes de la promoción a prod con dinero/PII
reales, y disparar **pentest de tercero + bug bounty + KMS** (§5). S-B1 y S-B2 quedan como deuda
aceptada con disparador (§3).

Enrutamiento: **backend** → S-M2, S-B3(app), S-B4(app), (opc.) S-B1; **arquitecto** → S-B2 (tipo
`BigInt`); **devops** → S-M1, S-B3(infra), S-B4(borde/secretos), cierre M-2/M-6 de infra v1.0.

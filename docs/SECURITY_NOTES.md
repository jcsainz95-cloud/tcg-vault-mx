# SECURITY_NOTES.md — Seguridad (blue team) · consolidación y veredicto

> **Rol:** seguridad (blue team). Reviso la defensa, **valido/consolido** los hallazgos del
> `pentester` (`docs/PENTEST_NOTES.md`) contra el código y emito el **VEREDICTO**. No corrijo
> código: cada hallazgo se enruta al **rol dueño**.
> **Alcance de esta revisión:** **re-verificación de la simplificación v1.2 / v1.2.1** (backend +
> frontend commiteados) sobre la base ya aprobada de v1.1. Foco: que la simplificación **no abrió
> huecos** y que **redujo** la superficie de PII/uploads. Se re-chequean sin regresión los
> guardarraíles previos y la deuda abierta (S-M1, S-M2, S-B1..S-B4).
> **Modo:** revisión estática de código + `npm audit`. Sin stack vivo → vectores que exigen
> instancia = **[PoC pendiente de target]**; verificados por lectura = **[Verificado en código]**.
> **Fecha:** 2026-08-14 (rev **v1.2.1**). Blanco autorizado: staging/local.

---

## 0. Resumen ejecutivo

La **simplificación v1.2/v1.2.1 no abrió huecos** y **redujo la superficie de PII y de uploads**:
- El presign de object storage quedó **acotado a `kyc_ine`** (INE del buylist). Los propósitos
  `inventory_photo` y `dispute_claim` **fueron eliminados** del código, no solo deprecados: el
  servicio rechaza cualquier otro `purpose` con `422 VALIDATION_ERROR` y el tipo se estrechó a
  `UploadPurpose = 'kyc_ine'`. **Ya no existe ninguna ruta que acepte otros `purpose`.**
- Se **dropearon** las columnas de foto de producto y de evidencia de disputa (migración
  `20260814200000_v12_simplification`, M-13). El drop **no rompió** `reveal-clabe`, ni el
  cifrado/enmascarado de PII, ni la auditoría, ni la retención del INE.
- La disputa de condición ya **no admite subida de archivos** (evidencia por correo a soporte):
  menos superficie de upload y de almacenamiento de PII.
- **INE/CLABE intactos** (sin regresión): `KycProfile.ineFrontKey/ineBackKey`, `clabeEnc`,
  `clabeHmac`, `rfcEnc`; bucket privado, presign GET corto, retención `INE_RETENTION_DAYS`.

**Efecto neto en severidad:** el vector de **XSS almacenado servido públicamente** que motivaba
parte de **S-B3** desaparece — la única ruta pública que lo habilitaba (`inventory_photo`) ya no
existe; el único upload que queda (`kyc_ine`) va a un **prefijo privado**. **S-B3 baja de alcance**
(queda solo el residuo de allow-list de content-type/tamaño sobre el INE). **No hay hallazgos
Críticos ni Altos abiertos.** Los guardarraíles de dinero/PII y la deuda previa (S-M1, S-M2,
S-B1, S-B2, S-B4) **siguen sin cambio** — no se re-abren.

**VEREDICTO: APROBADO para staging** (0 críticos / 0 altos). Condiciones para producción sin cambio
respecto a la rev v1.1 (§4), con **S-B3 reducido**.

| Severidad | # | IDs |
|---|---|---|
| Crítica | 0 | — |
| Alta | 0 | — |
| Media | 2 | S-M1 (=M-1), S-M2 (=M-2) |
| Baja | 4 | S-B1, S-B2, **S-B3 (reducido)**, S-B4 |
| Info/positivo (verificado) | 8 | I-1..I-8 |

---

## 1. Re-verificación de la simplificación v1.2 / v1.2.1 (esta revisión)

### V-1 — Presign acotado a `kyc_ine` — **[Verificado en código] · sin regresión, superficie reducida**
- `backend/src/modules/uploads/uploads.service.ts:15` → `type UploadPurpose = 'kyc_ine'`;
  `:44-49` rechaza todo `purpose !== 'kyc_ine'` con `422 VALIDATION_ERROR` (regla de negocio, no el
  400 del `ValidationPipe`). `uploads.controller.ts` expone un único `POST /uploads/presign`
  protegido por `@Roles(customer, vault_operator, super_admin)`; no hay otra ruta de upload.
- **Verificado que no queda ruta que acepte otros `purpose`:** `git grep` de `inventory_photo` /
  `dispute_claim` en `backend/src` solo aparece en comentarios/tests que confirman su rechazo
  (`test/uploads.presign.spec.ts` valida `422` para `inventory_photo`, `dispute_claim` y otros).
- **INE sin regresión:** presign PUT vive 900 s; `presignGet` (SEC-A5) sirve el INE por GET
  prefirmado de vida corta (300 s) desde bucket **privado**; retención vía
  `jobs/ine-retention.service.ts` (`INE_RETENTION_DAYS`, default 180) que borra el objeto
  (`uploads.deleteObject`) y limpia `ineFrontKey/ineBackKey`. CLABE cifrada + blind index.
- **Resultado:** superficie de upload **reducida** (de 3 propósitos a 1) y el propósito restante
  apunta a prefijo privado. Guardarraíl del INE **intacto**.

### V-2 — Drop de columnas de foto (M-13) — **[Verificado en código] · sin ruptura**
- Migración `backend/prisma/migrations/20260814200000_v12_simplification/migration.sql`: `DROP
  COLUMN` de `InventoryItem.frontPhotoKey/backPhotoKey/extraPhotoKeys`, `SellRequestItem.photoKeys`,
  `Dispute.ingressPhotoKeys/claimPhotoKeys`. Greenfield: sin datos que migrar.
- **No rompió `reveal-clabe`:** `admin-buylist.controller.ts:46-59` conserva `@Roles(super_admin)` +
  `@MoneyOut()` + `audit.log('buylist.reveal_clabe')`; `buylist.service.ts:340` sin cambio.
- **No rompió cifrado/enmascarado PII ni auditoría:** `schema.prisma:227-249` (`KycProfile`)
  mantiene `rfcEnc/clabeEnc/clabeHmac/ineFrontKey/ineBackKey` y el índice `clabeHmac`;
  `admin.service.ts` mantiene proyección reducida (INE keys solo para servir por presigned GET,
  RFC enmascarado). **INE/CLABE intactos.**
- La misma migración añade `InventoryItem.certNumber` (M-12) — ver V-4.

### V-3 — Disputa por correo — **[Verificado en código] · menos superficie, sin fuga**
- `disputes.controller.ts` sin `claimPhotoUploadKeys`; `disputes.service.ts:20-68` crea la disputa
  **sin subida de archivos** y valida ownership (`item.ownerUserId !== userId → FORBIDDEN`).
- `evidenceContact` = `DISPUTE_EVIDENCE_CONTACT` (`disputes.constants.ts`): correo de soporte
  **estático/placeholder configurable por env** (`DISPUTE_EVIDENCE_CONTACT`, default
  `soporte@tcgvault.mx`). **No filtra datos sensibles** (no depende de PII del usuario ni del
  request). Detalle admin (`adminGet`) expone `gradingCompany/gradeValue/certNumber` (no PII).
- **Resultado:** eliminado el upload de evidencia → menos superficie de almacenamiento de PII.

### V-4 — `certNumber` — **[Verificado en código] · dato no sensible, validación correcta**
- `schema.prisma:357` `certNumber String?` (nullable; solo `graded`). `inventory.dto.ts:26,39`
  `@IsOptional() @IsString()`; `inventory.service.ts:74` fuerza `null` para raw/sealed y `:130-133`
  **exige `certNumber` no vacío para publicar una gradeada** (regla de app; sin validación
  automática contra la graduadora — aceptable, es un identificador verificable externamente).
- **No es PII** (número de certificado público verificable en PSA/CGC). Sin riesgo de exposición.

### V-5 — Sin regresión en guardarraíles previos — **[Verificado en código]**
Re-chequeados tras la simplificación; todos OK (detalle en §2):
auth Google server-side, catálogo-sync anti-inyección/SSRF, reserva atómica de checkout, webhook
Stripe (firma + idempotencia atómica), `MoneyOutGuard` (solo `super_admin` + auditoría). La
simplificación **no tocó** estos módulos.

### V-6 — Observación de limpieza (devops, no bloqueante)
- `docker-compose.yml` / `docker-compose.staging.yml` aún publican el prefijo `inventory_photo/`
  con lectura anónima (`mc anonymous set download .../inventory_photo`). Con `inventory_photo`
  eliminado como propósito de upload, **ya no existe ruta de escritura a ese prefijo** → es
  **config muerta**, no un hueco (no hay objetos que servir ahí). Recomendación de **limpieza**
  para devops: retirar la publicación del prefijo `inventory_photo/` para no dejar un prefijo
  público sin uso. **No bloqueante.** **Rol dueño:** devops.

---

## 2. Guardarraíles previos — SIN regresión (re-verificado en código, v1.2.1)

| Guardarraíl | Evidencia | Estado |
|---|---|---|
| **Reserva atómica anti doble-venta** | `orders.service.ts` — `updateMany` guardado por estado vendible + `count!==1 → ITEM_UNAVAILABLE` dentro de `$transaction`; idempotency-key de PI server-side. | OK |
| **Webhook Stripe: firma** | `stripe.service.ts` — `webhooks.constructEvent(payload, signature, STRIPE_WEBHOOK_SECRET)`; raw body preservado en `main.ts:14-18`. | OK |
| **Webhook Stripe: idempotencia** | `payments.service.ts:38-89` — `ProcessedStripeEvent` como guardia atómica (P2002 → no-op); si el handler falla, borra la marca y re-lanza (Stripe reintenta). | OK |
| **Money-out solo super_admin** | `money-out.guard.ts` — rol != `super_admin` → `403 MONEY_OUT_FORBIDDEN` + audita el intento. Aplicado a reveal-clabe/pay-spei/refund/recompra. | OK |
| **PII cifrada/enmascarada** | `schema.prisma` `*Enc`/`*Hmac`; enmascarado por defecto incl. `super_admin`; `reveal-clabe` = único CLABE en claro (money-out + auditado); `vault_operator` con proyección reducida. | OK |
| **Retención INE** | `jobs/ine-retention.service.ts` — purga objeto (`deleteObject`) + limpia `ineFrontKey/ineBackKey` pasado `INE_RETENTION_DAYS`. | OK (intacto en v1.2.1) |
| **Login Google server-side** | `google-token-verifier` + `auth.service.ts` — firma/aud/iss/exp + `email_verified`; `role` siempre server-side. | OK |
| **Sync catálogo anti-inyección/SSRF** | `catalog-sync.service.ts` `SET_ID_PATTERN`; `pokemontcg-io.client.ts` host fijo + `encodeURIComponent`. | OK |
| **Portfolio/holdings sin IDOR** | `userId` desde JWT (`@CurrentUser`), nunca de parámetro; snapshot `@Roles(super_admin)`. | OK |
| **convert-to-inventory guard + anti-carrera** | `ITEM_NOT_APPROVED` + índice único `sourceSellRequestItemId` (P2002). | OK |
| **Tope mensual buylist atómico** | `$transaction` `Serializable`; categoría derivada server-side. | OK |

---

## 3. Hallazgos abiertos (heredados, SIN cambio salvo S-B3 reducido)

### MEDIA

#### S-M1 — Dependencias vulnerables en runtime backend
- **Confirmado (re-corrido 2026-08-14):** `npm audit --omit=dev` en `backend/` → **6 moderate, 0
  high, 0 critical**. Cadena `google-auth-library`→`gaxios 6.4.0–6.7.1`→`uuid <11.1.1` (moderate,
  buffer bounds) + `@nestjs/common`→`file-type` (moderate, DoS parser). Fix vía `npm audit fix`
  (sin `--force`). Frontend: `critical`/`high` **solo devDependencies** (no van al bundle prod).
- **Severidad:** Media. **Rol dueño:** **devops** (bump runtime + gate `npm audit` en SAST).
- **Sin cambio en v1.2** (la simplificación no alteró dependencias con avisos).

#### S-M2 — CORS refleja cualquier origin con credenciales
- **Confirmado [Verificado en código]:** `backend/src/main.ts:26` → `app.enableCors({ origin: true,
  credentials: true })`. Sin allow-list de dominios. Explotabilidad hoy limitada (tokens en
  `localStorage`/`Authorization: Bearer`, no cookies). **Escala a Alta** si aparece cualquier
  auth/refresh por cookie.
- **Severidad:** Media. **Rol dueño:** **backend** (allow-list de orígenes desde config).
- **Sin cambio en v1.2.**

### BAJA

#### S-B1 — Login Google ensancha la superficie de auth de cuentas privilegiadas
- Sin cambio. Linking enlaza ID token de Google a cualquier cuenta local con el mismo email
  verificado sin excluir `super_admin`/`vault_operator`; `role` server-side (no es escalada).
- **Severidad:** Baja (deuda aceptada con disparador §5). **Rol dueño:** **backend**.

#### S-B2 — Columnas de dinero en `Int` de 32 bits (overflow > ~MX$21.47M)
- Sin cambio. Montos `*Cents` en `Int`; `listPriceCents` con `@Min(0)` sin `@Max`.
- **Severidad:** Baja (integridad, no explotable externamente). **Rol dueño:** **arquitecto**
  (tipo `BigInt`) + **backend** (cota `@Max`). Deuda aceptada §5.

#### S-B3 — Presign sin allow-list de content-type/tamaño — **REDUCIDO en v1.2**
- **Antes (v1.1):** el presign aceptaba `inventory_photo` (prefijo **público**) con `contentType`
  libre → un `POST /uploads/presign {purpose:"inventory_photo",contentType:"text/html"}` permitía
  subir HTML al bucket público → **XSS almacenado**.
- **Ahora (v1.2.1):** `inventory_photo`/`dispute_claim` **eliminados**; el único upload es
  `kyc_ine` a un **prefijo privado** (sin lectura anónima). **El vector de XSS almacenado servido
  públicamente desaparece.** Queda un **residuo Bajo**: el presign PUT del INE aún **no fija
  allow-list `image/*` ni `Content-Length` máximo** (`uploads.service.ts:52` deriva la extensión de
  `contentType.split('/')[1]`), y `presignGet` no fuerza `Content-Disposition: attachment`. Impacto
  residual: abuso de almacenamiento y un XSS solo servible desde el **dominio de storage privado**
  (no el de la app), tras autenticación y solo sobre la propia key.
- **Severidad:** Baja (reducida; ya no toca prefijo público). **Rol dueño:** **backend** (allow-list
  `image/*` + tamaño máx + `Content-Disposition: attachment` en la ruta `kyc_ine`) + **devops**
  (mantener bucket privado; retirar publicación del prefijo `inventory_photo/` sin uso — ver V-6).

#### S-B4 — Endurecimientos de auth/transport (defensa en profundidad)
- Sin cambio. `main.ts` **sin `helmet()`**; `verifyAsync/signAsync` sin fijar `algorithms:['HS256']`
  (no explotable con secreto simétrico, defensa en profundidad); `env.validation.ts` valida
  `JWT_*`/Stripe solo si `NODE_ENV==='production'`, sin chequeo de entropía del secreto.
- **Severidad:** Baja. **Rol dueño:** **backend** (helmet, `algorithms`, validar secreto en staging)
  + **devops** (cabeceras en el borde, longitud mínima de secretos, secret manager en prod).

---

## 4. Mínimo para aprobar producción (dinero/PII reales)

No hay Críticos/Altos → **no bloquea staging**. Para la **promoción a producción** exijo cerrar:
1. **S-M2 (CORS)** — allow-list de orígenes; sin `origin:true`. **[backend]** — obligatorio si se
   añade cualquier cookie de auth.
2. **S-B3 (residuo)** — allow-list `image/*` + tamaño máx + `Content-Disposition: attachment` en la
   ruta `kyc_ine` **[backend]** + confirmación de **bucket INE privado** y retiro del prefijo
   público muerto `inventory_photo/` **[devops]**.
3. **S-M1 (deps)** — `npm audit fix` del runtime backend + gate `npm audit` en CI **[devops]**.
4. **S-B4 (transport)** — `helmet` + validación de secretos/entropía también en staging
   **[backend/devops]**.

S-B1 y S-B2 quedan como **deuda aceptada con disparador** (§5); no bloquean, pero deben resolverse
antes de operar con público real a escala.

---

## 5. Deuda de seguridad aceptada (no bloqueante, con disparador)

| ID | Deuda | Impacto | Disparador |
|---|---|---|---|
| S-B1 | Linking Google a cuentas back-office | Traslada seguridad de cuentas privilegiadas a Google | Antes de alta de cualquier back-office con email @gmail, o al habilitar más operadores. |
| S-B2 | Dinero en `Int` 32-bit | Overflow de integridad en agregados > ~MX$21.47M | Antes de que portafolios/P&L/custody agregados se acerquen a MX$21M, o antes de operar a escala. |
| S-B3 (residuo) | Presign `kyc_ine` sin allow-list de tipo/tamaño | Abuso de almacenamiento; XSS solo servible desde dominio de storage privado | Se acepta **solo** si devops confirma bucket INE privado. Cerrar junto con la promoción a prod. |
| S-B4 | `algorithms` no fijado, validación env solo prod, sin helmet | Defensa en profundidad reducida | Antes de exponer staging a Internet (helmet + secretos); fijar `algorithms` en el próximo toque de auth. |

---

## 6. Banderas para el humano (antes de operar con dinero real)

- **Pentest de tercero + programa de bug bounty** antes del go-live con dinero real: esta revisión
  es **estática y de caja blanca interna**. Los vectores **[PoC pendiente de target]** (CORS
  cross-origin, DoS por dependencias, abuso de presign, concurrencia de checkout/buylist) requieren
  validación **dinámica** contra staging (ZAP/nuclei + scripts de concurrencia).
- **KMS / secret manager en producción**: `PII_ENCRYPTION_KEY`, `PII_HMAC_KEY`, `JWT_*`, `STRIPE_*`
  y las credenciales `S3_*` del bucket de INE deben provenir de un secret manager (no `.env` ni
  imagen). Confirmar rotación y que ningún secreto aparezca en logs/errores.
- **Validaciones legales de custodia/PII (INE/CLABE)**: figura de depositario, contrato de custodia,
  seguro del inventario, y cumplimiento del manejo del **INE almacenado** (base legal de tratamiento,
  periodo de retención `INE_RETENTION_DAYS`, acceso y borrado al vencer) y de la CLABE cifrada.
  La v1.2.1 **restauró el almacenamiento del INE** (soporte AML del SPEI a particulares): confirmar
  con contador/abogado la retención y las obligaciones de protección de datos personales.
- **Correo de evidencia de disputa** (`DISPUTE_EVIDENCE_CONTACT`, default `soporte@tcgvault.mx`) es
  **placeholder por confirmar por el humano**; debe apuntar a un buzón real monitoreado antes de
  operar disputas.
- **Cierre de infra (devops)**: bucket INE privado + lifecycle de retención, y retiro del prefijo
  público `inventory_photo/` sin uso; puertos de datos del compose — pendientes de confirmar en la
  revisión de infra con target vivo.

---

## 7. VEREDICTO

**APROBADO para staging.** La simplificación **v1.2 / v1.2.1 no abrió huecos** y **redujo la
superficie de PII y de uploads**: presign acotado a `kyc_ine`, columnas de foto de producto y de
evidencia de disputa **eliminadas** (M-13), disputa sin subida de archivos, e **INE/CLABE intactos**
(cifrado, enmascarado, retención y `reveal-clabe` money-out/auditado sin regresión). El vector de
XSS almacenado público que motivaba parte de **S-B3 desaparece** (solo queda un residuo Bajo sobre
la ruta privada del INE).

**0 Críticos / 0 Altos abiertos** → no procede RECHAZO (la regla de la DoD RECHAZA solo con
crítico/alto abierto). Lo abierto son **2 Medias (S-M1, S-M2)** y **4 Bajas (S-B1, S-B2, S-B3
reducido, S-B4)**, ninguna bloqueante para staging.

**Condicionado para producción** (dinero/PII reales): cerrar **S-M2 (CORS)**, **S-B3 (residuo
presign + bucket INE privado)**, **S-M1 (deps runtime)** y **S-B4 (helmet/secretos)** (§4), y
disparar **pentest de tercero + bug bounty + KMS** (§6). S-B1 y S-B2 quedan como deuda aceptada con
disparador (§5).

Enrutamiento: **backend** → S-M2, S-B3(app), S-B4(app), (opc.) S-B1; **arquitecto** → S-B2 (tipo
`BigInt`); **devops** → S-M1, S-B3(infra/bucket + retiro de prefijo público muerto), S-B4(borde/
secretos).

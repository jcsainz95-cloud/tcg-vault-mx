# SECURITY_NOTES.md — Seguridad (blue team) · estado vigente

> **Estado vigente (2026-11-04).** Último veredicto: **§CTA «cuenta con solo el correo»** (rama `claude/cuenta-correo`), **APROBADO sin
> condiciones sobre `153f7c40` y, en delta (CTA.5), sobre `2f136542`**: Críticas 0 · Altas 0 · Medias 0. PT-CTA-1/2/3/4/8/9 cerradas; PT-CTA-5 (Baja), PT-CTA-6/7 (Info) y
> SEC-CTA-I1/I2 (Info) aceptadas en el registro B. Siguen vigentes §IDS `52481453` y release 1103 `87e7e83f` (APROBADO los dos).
> Abiertas en el registro A, sin re-medir hoy: Medias **SEC-CHK-1** (depende de la configuración del dueño), **CL-1**, **P-RL-1**, **BL-42**, entre otras.
> ⚠ **Antes de pegar `SEPOMEX_DATABASE_URL`, cumplir la lista §V.3**, que exige *Required reviewers* (PT-CHK-7). Mal configurada, SEC-CHK-1 pasa a Crítica. ⚠ No encender `sealed_restock_alerts` sin doble opt-in (PEN-CNV-2, bandera C.2).

---

# VEREDICTO BLUE TEAM — §CTA «cuenta con solo el correo» · SHA **`153f7c40`** · 2026-11-04 · seguridad

> ## ✅ **APROBADO** sobre `153f7c40`, sin condiciones
> Ningún hallazgo crítico, alto ni medio queda abierto. Lo abierto es deuda aceptada con disparador (registro B) y una medición de
> despliegue que no es de seguridad (CTA.4). Sin condiciones ⇒ no hacen falta caducidad ni candado. La punta `cce790cf` solo añade
> `docs/` (TECH_DEBT y PENTEST_NOTES): el veredicto vale para ella.

## CTA.1 Procedencia
- **[MEDIDO]** Copia `git archive 153f7c40` del árbol **entero**, `npm ci` de `backend/`, base `tcg_sec153` y rol propios (Postgres 16.15
  local), Redis propio en :6493; sin stack HTTP ni navegador. Base, rol, Redis y copia borrados al terminar; logs en
  `scratchpad/sec-cta-153f/logs/`. Load 4–5 (4 CPU, QA en paralelo); ningún rojo es un *timeout*.
  - `cta-v1173.e2e-spec.ts` (Postgres real): **34/34**. Unitarias `test/auth*`, `test/lock-keys*`, `test/cta*`: **18 suites, 244/244**.
  - **M1** (enlace de Google sin la relectura del correo, `if (!cur) return null`): **1 roja** («el correo de la cuenta cambia antes
    del candado ⇒ NO se enlaza»), **2/2 corridas (N=2)**. **M2** (`change-password` con `where: {id}` incondicional): **6 rojas** (reset,
    verify+newPassword, account-setup, logout, hash a mano, bloqueo), N=1, determinista. Restaurado con `cmp` contra `git show` ⇒ **34/34**.
- **[REPORTADO por el pentester]** (`PENTEST_NOTES`, re-test sobre `153f7c40`): carrera PT-CTA-9 **0/30** por vía en −300…+150 ms,
  ablación 30/30, restaurado 0/30; reset del admin 0/30; PT-CTA-1 0/10. **No lo re-medí en vivo.**
- **[REPORTADO por backend]** integración completa 183/184 (la roja, `pdb-limpieza`, es permiso del rol de BD). **No la medí.**
- **NO MEDIDO:** Google real (falta un ID token), Stripe, el edge de Railway (XFF/IPv6), Resend, la versión de Postgres en Railway.

## CTA.2 Cruce de hallazgos — estado sobre `153f7c40`
| ID | Sev final | Estado | Evidencia | Dueño |
|---|---|---|---|---|
| **PT-CTA-9** | **Media** (no sube a Alta) | **Cerrada.** `change-password` escribe con `updateMany` condicionado a `passwordHash`+`tokenVersion`+`status` leídos; 0 filas ⇒ 401 sin par (`auth.service.ts:756-769`). La misma clase en el reset del admin (`admin.service.ts` `where {status≠deleted, isOwner:false}` + relectura del P2025) y en Google (relee la fila dentro del candado, `auth.service.ts:884-907`) | Mía: M2 6 rojas y M1 1 roja (2/2). Pentester: 0/30 en vivo | backend |
| PT-CTA-1 (Alta) / PT-CTA-2 / -3 / -4 / -8 | — | **Cerradas** en `36f93c98`; PT-CTA-1 sin regresión (0/10, pentester) | Leí el candado (`account-gate.ts`), la atadura (`boundTokenWhere`) y M-97 | — |
| PT-CTA-5 | Baja | **Aceptada** (registro B) | Ver CTA.3 | backend |
| PT-CTA-6 | Info | **Aceptada, absorbida en P-RL-1** (registro A, Media, devops) | Ver CTA.3 | devops |
| PT-CTA-7 | Info | **Aceptada** (decisión D-CTA-2) | Ver CTA.3 | backend / dueño |
| TL-CTA-18 (techlead) | Info | **Sin impacto de seguridad** ⇒ SEC-CTA-I2 | Ver CTA.3 | backend |

**Por qué PT-CTA-9 queda en Media y no sube a Alta:** hace falta que la víctima actúe (pulsar su enlace o pedir un reset) y que el
atacante tenga una llamada en vuelo en una ventana de ~0,4 s que no ve venir; cada intento cambia la contraseña y deja
`auth.password_changed`. PT-CTA-6 habría abaratado la cobertura de la ventana, pero ya no hay ventana que cubrir: no cambia el veredicto.

**Revisión propia, sin hallazgo nuevo de severidad:** toda escritura de credencial o correo y toda emisión o canje de `AuthToken` pasan
por `withAccountGate` (lo cobra CTA-B19); `consume` exige `emailHash` del correo leído dentro; el envío va a `issued.to`, sin releer;
los SQL crudos nuevos son plantillas parametrizadas; `EmailVerifiedGuard` trata cualquier metadato distinto de `'present'` como
`'verified'` (falla cerrado) y solo `checkout/session` usa `'present'`; los logs del alta y del envío registran `errorKind` y el id,
nunca el enlace ni el correo; el frontend quita el token de la URL antes de cualquier petición, con `Referrer-Policy: no-referrer` en
las tres páginas, y el canje es un formulario `POST`. Sin cambios de dependencias; los cambios de workflows son CI de §IDS y el
endurecimiento `f12a9d34`, sin secretos nuevos.

## CTA.3 Decisiones sobre lo no cerrado
- **Google, sin medir en vivo: no bloquea.** El código relee dentro del candado; la integración lo fija con un verificador de prueba y
  M1 la pone roja 2/2. Falta la prueba de punta a punta con un token real. **Disparador:** el primer entorno autorizado con
  `GOOGLE_CLIENT_ID` de prueba ⇒ el pentester repite la carrera (N ≥ 30).
- **PT-CTA-5 (Baja): aceptada.** No añade un oráculo nuevo. El alta ya revela la existencia por diseño (`409 EMAIL_TAKEN`, criterio 56)
  con más volumen (`signup` 5/min y 30/día por IP) que `forgot-password` (10/h por IP), y con certeza en vez de AUC ~0,67.
  **Disparador:** que el alta deje de revelar la existencia, o un pico de `forgot-password` hacia correos distintos desde pocas IPs ⇒
  cola fuera del proceso.
- **PT-CTA-6 (Info): no es nuevo, es P-RL-1.** Los topes **por cuenta** (3 correos/h y C7) no dependen de la IP. Los topes por IP de §CTA
  sí, como todos. Añado a la ronda C6 de P-RL-1 una IPv6 de cliente (un /64 = 2⁶⁴ cubos). Dueño: devops.
- **PT-CTA-7 (Info): aceptada** (D-CTA-2). Pagar a tu bóveda sin buzón probado no entrega nada ajeno; retirar, vender y reclamar siguen
  exigiendo `verified`. **Disparador:** publicar un código solo-bóveda con `maxUsesPerCustomer`, o apartados repetidos sin pago desde
  cuentas email-only.
- **TL-CTA-18 ⇒ SEC-CTA-I2 (Info).** El 500 falla cerrado: el `create` no escribe, la tx del enlace ya devolvió `null`, no hay sesión y el
  cuerpo es el genérico (`all-exceptions.filter.ts:82-84`). Solo se dispara si en la misma ventana una cuenta se va del correo y otra lo
  toma. **Para el arreglo (backend):** si se repite el paso 2, la cuenta encontrada tiene que pasar por la **misma** rama `wasUnverified`
  (revocar, borrar el hash, anular tokens, 5-bis). Enlazar la identidad de Google a una cuenta sin verificar sin esa rama sería tomar
  la cuenta de otro.
- **SEC-CTA-I1 (Info, mía).** Quien espera turno en `pg_advisory_xact_lock` retiene una conexión del pool hasta `maxWait` 15 s +
  `timeout` 20 s (`account-gate.ts:28`). Muchas peticiones a la misma cuenta ocupan el pool. Cada turno dura milisegundos: argon2 va
  fuera, salvo `verify-email` en modo `password`, y ahí C7 corta a los 5 intentos. **Disparador:** `P2024` o timeouts del pool en logs,
  o más de una instancia del backend.

## CTA.4 M-97 y Postgres ≥ 11 (`sha256()`): **no bloquea y no es condición de seguridad**
- Inferido, no medido: `production` ya aplicó m31/m66/m73 (`gen_random_uuid()` sin `pgcrypto` ⇒ Postgres ≥ 13). Aunque fuera < 11, M-97
  falla **cerrada** (una migración transaccional; Node no arranca si `migrate deploy` falla, `Dockerfile.backend:140`): disponibilidad, no
  seguridad. Mide devops (`SHOW server_version` en Railway) antes de fusionar a `production`. Texto íntegro: `git show 2f136542:docs/SECURITY_NOTES.md`.

## CTA.5 Delta `153f7c40` → **`2f136542`**: ✅ **APROBADO, sin condiciones** (backend sin cambios: `git diff --stat 153f7c40 2f136542 -- backend` vacío)
- **Buzón falso de CI (devops `748f5436`).** Medido: `resend` 4.8.0 (tarball del registro) hace `fetch(`${process.env.RESEND_BASE_URL || defaultBaseUrl}…`)`; el buzón no escribe cabeceras (la llave efímera no sale) y el log vive en `$RUNNER_TEMP`, fuera del `upload-artifact` (`e2e-real.yml:786-796`); ningún paso hace `cat` del log (solo `grep -c`); `e2e-real.yml` no corre en `pull_request` (solo cron/manual/`workflow_call`). Candado verde y canario **8/8** (míos). Residual **SEC-CTA-I3 (Info, frontend)**: si falla una aserción de `cuenta-correo.spec.ts` que compara el token (`:164`, `:239`, `:259`, `:280`), Playwright imprime la URL/token en el log público (reporter `github`) y en `report.json` (artefacto `test-results-cta`). No explotable: token de un solo uso, cuenta sintética de un stack efímero destruido con `down -v` al final del job e inalcanzable desde fuera del runner. Disparador: que `e2e-real` apunte alguna vez a un entorno persistente ⇒ enmascarar el token en esas aserciones.
- **¿Basta el candado?** Para el repo, sí (R1–R3 cubren compose, `.env.example`, workflows y `backend/src`). No ve Railway, y el riesgo de Railway **no lo crea este commit**: el SDK lee esa variable desde que se adoptó Resend. Quien puede escribir variables en Railway ya controla `RESEND_API_KEY` y el despliegue: es error de configuración, no ataque. **SEC-CTA-I4 (Baja, backend, recomendado, no condición):** al arrancar con `NODE_ENV=production`, negarse si `RESEND_BASE_URL` existe y su host no es `host.docker.internal` (el único valor de `e2e-real`, que también corre en production), y registrar el host efectivo en la línea `Correo: ResendMailAdapter (from=…)` de `mail.module.ts:42`. Disparador: el próximo cambio en `mail/` o en la configuración de despliegue de Railway. Bandera para el dueño en C.8.
- **«Olvidé» (frontend `439e0545`, `useForgotPassword.ts`).** No es oráculo: el controlador responde `{ok:true}` antes de buscar la cuenta (`auth.service.ts:593-596`; el trabajo corre tras `setImmediate` y su error se traga con la clase, `:620-626`), así que un 5xx o un fallo de red no dependen de que el correo exista. Que un 4xx distinto de 429 diga «enviado» es correcto: el 400 depende del formato del correo, que el atacante ya conoce, nunca de la cuenta. En `PasswordPage` (usuario con sesión, su propio correo) un 4xx pasa de «error» a «enviado»: es UX, no seguridad.

---

# VEREDICTO BLUE TEAM — §IDS «Español y versiones de liga» · SHA **`52481453`** · 2026-11-03 · **APROBADO** sin condiciones (compactado)
- Ningún crítico, alto ni medio. Cerradas: BE-IDS-PT-9 (mutación 3/3), PT-IDS-1 (mutación 3/3), PT-IDS-2/3/6/7/8. PT-IDS-4/5 aceptadas
  (D-IDS-W). SEC-IDS-1…4 en el registro B; las banderas, en C.8. Texto íntegro (IDS.1–IDS.4): `git show cfd96f56:docs/SECURITY_NOTES.md`.

---
## V.3 Precondición SEC-CHK-1: lista para el botón de CP (veredicto `7107ff8a`, sigue vigente)
1. El secreto va **solo** en *Settings → Environments → `catalogo-cp` → Environment secrets*. Comprobación: *Repository secrets* **no** lista `SEPOMEX_DATABASE_URL`.
2. «Deployment branches and tags» = **Selected branches and tags**, con una regla `production` de tipo *Branch*. ⛔ No «No restriction».
3. **Obligatorio** (desde `7107ff8a`, PT-CHK-7): **Required reviewers** = el dueño.
4. Si se activó la red pública del Postgres para esto, desactivarla al terminar. Si ya estaba activa: NO MEDIDO.
5. Borrar el secreto al terminar. Si (1) o (2) estuvieron mal en algún momento, **rotar la contraseña** de Postgres.
6. El dueño confirma en su panel si Stripe **Link** está activo. El texto de la fila Stripe se ajusta en la revisión legal.

Candado sugerido a devops (no exigido): un paso en `ci.yml`, sin entorno, que falle si `secrets.SEPOMEX_DATABASE_URL` no está vacío.

---

# Veredictos recientes, compactados el 2026-11-03
- **`87e7e83f` · 2026-11-03: APROBADO** (release 1103: clasificador GA4/SC sin fuga con 36 entradas hostiles; N1 no cambia lo que llega a `POST /checkout/guest/session`; SEC-R1103-I1/I2 en el registro B). Texto íntegro (§R.1–R.4): `git show ca57f7e2:docs/SECURITY_NOTES.md`.
- **`7107ff8a` · 2026-11-02: APROBADO** (checkout-friccion, re-veredicto; 1.ª vuelta `f2e1de9c` también APROBADO). PT-CHK-1 reabrió SEC-CHK-4 y quedó cerrada en código; PT-CHK-2/3 cerradas; el residual y SEC-CHK-6 están en el registro B. §V.1–V.2: `git show 52481453:docs/SECURITY_NOTES.md` y `git show 9fcf1d20:docs/SECURITY_NOTES.md`; §V.3 sigue arriba.
- **`43d9eb10` · 2026-11-01: APROBADO** (Marketing conversión 2). PEN-CNV-1 rebajada a Info y aceptada (registro B); PEN-CNV-2 = REL7-P3, precondición para encender `sealed_restock_alerts`; ablaciones M-1…M-4 cazadas; semgrep 0. Texto íntegro: `git show f2e1de9c:docs/SECURITY_NOTES.md`.
- **`e066b0b5` · 2026-10-31: APROBADO** (Marketing / SSR SEO Ola 2, solo frontend). M-1…M-6 cazadas; PEN-MKT-1 rebajada a Info; PEN-MKT-2 = SEC-MKT2-B1. Hallazgos SEC-MKT2-* en el registro B. Texto íntegro: `git show fe2fee57:docs/SECURITY_NOTES.md`.
- **`d5f0b38c` · 2026-10-31: APROBADO** (§DYN portada dinámica + PR #107). M-A…M-D cazadas; PEN-DYN-2 cerrada; residual PEN-DYN-1 + SEC-DYN-M1 aceptados con `image-optimizer-cost-reading-expiry` (devops, 2026-12-01). Hallazgos SEC-DYN-* en el registro B. Texto íntegro: `git show dd84a5be:docs/SECURITY_NOTES.md`.
- **`5aeda006` · 2026-10-29: APROBADO** (velocidad de la portada, solo frontend). Mutaciones M1–M3 cazadas. Sus hallazgos SEC-DYN3-B1/I1/I2 siguen en el registro B. Texto íntegro: `git show d5f0b38c:docs/SECURITY_NOTES.md`.
- **SEC-MED-1 · `1b777967` · 2026-10-27: CERRADA.** **`2f5a59c0` · 2026-10-26: APROBADO** (códigos de descuento). Texto: `git show 5aeda006:docs/SECURITY_NOTES.md`.

---

# Registro vigente — lo abierto y lo aceptado que sigue en pie (consolidado el 2026-10-26)

> Cada fila dice **qué veredicto la midió por última vez**. Si no la re-medí hoy, lo dice. El detalle está en
> `git show 60250e90:docs/SECURITY_NOTES.md` (busca el ID); lo del veredicto `60250e90` en `git show 2f5a59c0:docs/SECURITY_NOTES.md`.

## A. Abierto (no lo introduce este release; pesa porque la tienda ya cobra en real)
`HECHOS.md:16`, 2026-10-16: «LA TIENDA YA ESTÁ EN VIVO EN MODO REAL DE STRIPE», afirmado por el dueño y NO medido por el orquestador.

| ID | Sev | Qué | Dueño | Última medición | Cierre |
|---|---|---|---|---|---|
| **P-RL-1** | **Media** (era Alta antes de C7) | El tope por IP se puede esquivar rotando `X-Forwarded-For` si el edge de Railway pasa el valor del cliente. El tope **por cuenta** (C7: 5 intentos, y luego 429) sí protege el login (pentester, `c62621e6`). Queda la evasión del tope por IP en endpoints públicos: scraping (BMK-1) y DoS de la ruta de cobro (SB-B3). Clasifico Media, como en `c62621e6` §6. El pase `8e1b34d7` copió «Alta» de antes de C7 | devops | 2026-10-10: ronda con XFF rotatorio, 6×401 sin 429; **falta la ronda de control** (`HECHOS.md:168`) | C6 completo (§85.4 de `DEVOPS_NOTES`), con proporción N/N, en ventana autorizada por el dueño; desde `153f7c40` incluye una IPv6 de cliente (un /64 = 2⁶⁴ cubos) y absorbe PT-CTA-6 |
| **SEC-CHK-1** | **Media** (pasa a **Crítica** si se configura mal) | El secreto del botón de CP está protegido solo si es secreto de **entorno** `catalogo-cp` con regla de rama `production`; ajuste manual, no medible (§V.2) | devops + dueño | `f2e1de9c` (2026-11-02) | Lista §V.3 cumplida y el secreto borrado tras la carga; o el candado de `ci.yml` sugerido |
| **CL-1** / SEC-HDR-2 / CSP-RO | **Media** | CSP en `report-only`; **2026-11-02: el nonce de Next no llega a producción** (`DEVOPS_NOTES §107.5`, clasificado en el veredicto `f2e1de9c` §3.5) (**[MEDIDO 2026-10-26]** `frontend/src/security/csp.ts:37`; `HECHOS.md` sigue sin fila de aceptación). Con la sesión en `localStorage`, un XSS daría una sesión de súper-admin de hasta 7 días. No se conoce ningún XSS (`grep dangerouslySetInnerHTML` = 0 en el pase `8e1b34d7`) | frontend + devops | `8e1b34d7`, 2026-10-10 (vuelta a report-only a propósito); **`d5f0b38c` 2026-10-31**: sigue `report-only` (`csp.ts:37`), nonce cerrado con mutación, sin fila en `HECHOS.md`; **`e066b0b5` 2026-10-31**: sin el escape del JSON-LD, 20 diálogos/10 cargas que `enforce` habría bloqueado (M-1) | CSP en `enforce` según §14.3 de `DEVOPS_NOTES` + `check-csp-zap-parity.sh` rc 0. **O** el dueño lo acepta por escrito en `HECHOS.md` (hoy no hay esa fila: lo busqué) |
| **CL-3** | Media | Evidencias «antes de `sk_live_`»: C6, DAST `full` sellado sobre el sha de producción, C3 = 0, simulacro de restauración con las claves `PII_*` fuera de Railway | devops + dueño | `c62621e6` (2026-10-05); después **NO MEDIDO** | Los cuatro resultados en `DEVOPS_NOTES §85`, con fecha y sha |
| LIVE5-STRIPE | Media | La lógica de reembolso SPEI (`chargeState`, `to-manual`) solo se probó contra un doble de Stripe | backend + pentester | `8e1b34d7` | Pasada en Stripe modo prueba (CS-1…CS-6) |
| **BL-42** (caminos 1 y 3) | **Media** | INE sin ancla de purga ⇒ retención indefinida | backend + dueño | `c62621e6` | ⚠️ La primera solicitud ARCO, o la regla 7 encendida |
| S-M4P-A | Media | `RolesGuard` falla ABIERTO y el endpoint PII-denso de `admin-shipments` no tiene candado de regresión | backend | `5e6f2ee` (2026-09-22); después **NO MEDIDO** | El primero de: tocar ese controlador, darle el módulo al modelo barato, o el próximo release (**ya vencido**: lo re-enruto) |

**Cerrado desde la última consolidación (medido hoy):** CL-2 / P-GL-2 (`security/gitleaks.toml:193-230`: sin exención por ruta de `docs/`,
con canario). C-SEC-1/C-SEC-2/SEC-CS-C del Card Show: **anuladas**, porque se retiró el escaneo de patrocinador (`93a8f213`; el dueño dijo que no hay
nombre confidencial, `docs/specs/CARDSHOW_LANDING_ESTADO.md:146`). `scripts/check-ci-ok.sh --static` ⇒ rc 0 (29 jobs en `needs`).
C-SEC-3: los secretos del Card Show están documentados (`DEVOPS_NOTES.md:11-12`) y fallan cerrados en runtime; que estén cargados en Railway: **NO MEDIDO**.
MKT-TL2, SEC-MKT-1/2/3, CS-RT-1, C7, CL-2: cerrados. **SEC-MED-1: cerrada el 2026-10-27 sobre `1b777967`** (re-verificación arriba).

## B. Deuda de seguridad aceptada (no bloquea) — impacto y disparador
| ID | Sev | Impacto aceptado | Disparador | Dueño |
|---|---|---|---|---|
| REL7-P1 / PRE-P3 / RL-DEP-1 | Media/Info | `@nestjs/core` GHSA-36xv (SSE); `@Sse` = 0. **Aceptado por el dueño** (`HECHOS.md:165`, 2026-10-10) | El primer `@Sse`, que el audit suba a alta, o Nest 11+ | devops |
| PRE-P4 / SEC-B62-2 | Info | Avisos altos o críticos solo en tooling de build o dev | La próxima actualización de dependencias | devops |
| SEC-MKT-4 (X2) | Info | Un insider con su propio pedido y un UTM inventado despeja el MX$ de otro en b1/b2 | El primer analista que no sea el dueño, o MX$ de b1-b3 en el export de `TIENDA_PANEL_TOKEN` | arquitecto → backend |
| MKT-INFO-1/2/3 | Info | XSS sin 2.ª barrera (= CL-1); un delegado `marketing_read` podría borrar anotaciones; el throttler multiplica por N con N instancias | CL-1; la primera ruta que conceda `marketing_read`; más de 1 instancia | frontend/devops; arquitecto; backend |
| SEC-CS90-1 | Baja | El contador del torneo sin *single-flight* | Más de 1 000 inscripciones, o p95 > 100 ms | backend |
| CS-RT-2/3/4/5 | Baja/Info | gmail↔googlemail; `/ir` y `/click` sin throttle propio; DNS de MX; timing teórico | Ver ficha (bombing por alias, crecimiento de `CardShowClick`) | backend |
| SEC-CS-E | Baja | El «To» interno con PII sale de la env `INTERNAL_RECIPIENTS` | Un segundo destinatario interno | backend/devops |
| Aviso del embed de Maps | Baja | El aviso de privacidad no menciona Google Maps | Antes de CSP `enforce`, o una revisión legal | product-owner + arquitecto |
| PNL-6 / PNL-7 | Baja | `/admin/finance` sin `no-store`; `Content-Disposition` con `report` sin sanear | El próximo stream en `modules/admin`, o un endpoint financiero fuera de `super_admin`+Bearer (ahí pasan a bloqueantes) | backend |
| SD-4 | Baja | El export `.xlsx` rotula el sellado con la carta ancla | La decisión del arquitecto sobre el rótulo | arquitecto → backend |
| LZ2-S1/S2/S3, LZ-S4 | Baja | Salida del ensayo B con PII; G-9 declarativa; pedidos previos al rastro | Antes de pegar salidas en el chat; cualquier retraso de B más allá de `sk_live_` | backend + dueño |
| SU-S2…S5 | Baja | Error de tecleo en el precio; pieza duplicada por reintento; host en `stderr`; re-publicar una retirada | El primer caso real; trabajo en idempotencia; script en CI; la decisión «retirada» | frontend/backend/arquitecto |
| AN-5 | Baja | `GET /admin/reports/sales*` sin acotar en memoria | >10 000 pedidos o >50 000 `OrderItem` en 366 días; un 5xx o p95 > 3 s; un segundo `super_admin` | backend |
| A-BSD-1, I-BSD-1 | Baja/Info | `label.pdf` con throttle por IP; domicilio retenido en `pickupAddressSnapshot` | Un 429 legítimo, >1 instancia, o `sk_live_` (**ya ocurrió: re-enruto a backend**); la política de retención | backend |
| RL-INFO-2 | Info | Sin tope monetario para `super_admin` (reembolsos a la tarjeta de origen) | Un segundo `super_admin`, 30 días con dinero real (**vence ~2026-11-15**, si el en vivo empezó el 2026-10-16) o un incidente ⇒ 2FA + re-autenticación | dueño, backend |
| RL-INFO-5, RL-SEC-2 | Info/Baja | 403/404 deja saber si un UUID existe; `@railway/cli@latest` y `vercel@latest` sin fijar | Tocar `getOrder`; **antes** de cargar `RAILWAY_TOKEN`/`VERCEL_TOKEN` | backend; devops |
| STF-P1, STF-S1, R69-1 | Baja | El handle del staff queda en `AuditLog`; un `super_admin` puede tomar la cuenta de otro; `reason` sin tope | ARCO de un ex-empleado; un segundo `super_admin` humano; el próximo cambio en `orders/dto` | backend / arquitecto |
| SEC-DIN-1/2, SSL-R1 | Baja | Mercado de otra caja en el export; alias que esquiva el guardarraíl; piezas atrapadas en `reserved` | El próximo llamador de COMPRA; el primer reembolso desde el panel de Stripe | backend (+ arquitecto) |
| S-M4P-B, M4P-1/2/5, S-M4P-C | Baja/Info | PII en la caché de disco del operador; fila corrupta tumba la cola; amplificación; ficha de dependencias | Ver ficha (equipo compartido, nuevo escritor de `fulfillmentMode`, paginar) | backend / devops |
| SEC-SHIP-B1…B14, M7 | Baja | `speiReference` no única; importes congelados solo por convención; tope por operador; reclamo y retiro (ver ficha) | El primer SPEI real (**B1: ya aplica con dinero real; re-enruto**); un segundo operador; el primer reembolso real de bóveda | arquitecto → backend |
| SEC-SDX-6…13, SDX-D-6/7/8/12/18/19, SDX-I-2/5 | Baja | Skydropx: carga cruda sin redactar ni retención; redacción por lista negra; orden de eventos; `delivered` irreversible | Ver ficha (el primer mes en producción para SDX-6, la primera disputa «no me llegó») | arquitecto → backend / devops |
| SEC-C7-RT/RDEG/OPT/SCRIPT, SEC-HDR-3 | Baja/Info | `refresh()` sin `typ`; candado que reaparece al volver Redis; `@Optional()`; el script no levanta C7; cookie `NEXT_LOCALE` | El siguiente pase de `auth`; un `warn` de `LoginAttemptStore`; usar el script en producción | backend |
| SEC-VLT-DL, VLT-2/3 | Baja | Interbloqueo recuperable del contracargo de bóveda; decisión del dueño; escritura de `User.role` | Un `40P01` en producción; cualquier escritura de `User.role` | backend |
| D-FX-1/2/3, PRE-P1, PRE-P2 | Baja | Borrar `fx_rate_mode` re-arma lo legacy; override sin `@Max`; fetch de Banxico sin `redirect:'error'` | Acceso auditado a la BD; ampliar el rol; el próximo toque de `fx.service.ts` | backend + devops |
| DSC-2, DSC-12 (pentest `c421de13`) | Info | Tope por cliente esquivable con otro correo o `+alias` (§DSC.5(a)); el tiempo del camino inválido está mitigado con `NIL_CODE_ID` | Un abuso medido de un código con tope por cliente | backend |
| SEC-DSC-QA7 | Baja | La clave `email:` del quote de invitado: bloquear 15 min los códigos de un correo ajeno y saber si ya usó un código (veredicto `2f5a59c0` §2) | Código con tope por cliente publicado en redes; queja «no me deja usar mi código»; >3 bloqueos `email:` al día; P-RL-1 confirmado | backend (arquitecto decide) |
| SEC-DSC-I1, SEC-DSC-I2, SEC-MTE-1 | Info | Candado de DSC-1 solo en la integración; M-92 editada en su sitio (staging o local); `fetch` a Meta sin `redirect:'error'` | La integración fuera de CI o `discounts` en `backend-lite`; un aviso de `migrate deploy` en staging; el próximo toque de `measurement-http.ts` | backend; devops; backend |
| SEC-MED-1-R1 | Info | Una llamada a `fbq` en cola antes de que baje `fbevents.js` sale con la URL del momento en que se procesa (ventana de cientos de ms; no reproducido) | El catálogo escribe `q` en la URL, o tester-e2e ve un beacon de Meta con `q` | frontend |
| **PEN-DYN-1 residual + SEC-DYN-M1** | Media | `/_next/image` sin tope de orígenes (scrydex 200 a cualquier id) ni de claves (fragmento `#`); solo coste. Aceptado por el arquitecto (`ARCHITECTURE.md:31005`), validado aquí (veredicto `d5f0b38c` §4) | Candado `image-optimizer-cost-reading-expiry` (devops, **2026-12-01**); alerta de gasto; lectura > 1 000/día ⇒ interruptor u opción (b) | devops; frontend; arquitecto |
| SEC-DYN-B1/B2/B3, SEC-DYN-I1, PEN-DYN-I1/I3 | Baja/Info | Limpieza borra una rama recién creada; turno PSA con 1 conexión hasta 60 min; `uses:` sin sha; avisos moderados no alcanzables; `public` en 400; userinfo ⇒ 500. Veredicto `d5f0b38c` §5 | Ver ficha (antes del primer `confirmar=true`; `P2024` en checkout; PRE-P4) | devops; backend; frontend |
| SEC-DYN3-B1, SEC-DYN3-I1/I2 | Baja/Info | Build de Vercel con mocks horneados sin `throw`; fuentes de `lib/mock` copiadas al standalone (no se sirven); CSV sin `no-store` (= PNL-6). Veredicto `5aeda006` §4 | El próximo toque de `next.config.mjs` o del entorno de Vercel; `lib/mock` con algo no público; los de PNL-6 | frontend + devops; frontend; backend |
| SEC-MKT2-B1 (= PEN-MKT-2) | Baja | Catálogo de servidor: el cubo del throttler compartido por la IP del frontend y sockets sin abortar con el backend lento (veredicto `e066b0b5` §3) | 429 desde IPs de Vercel; Search Console sin productos; subir `CATALOG_SSR_BUDGET_MS`; próximo toque de `catalog-ssr.ts` | frontend; backend + devops |
| SEC-MKT2-I1/I2/I3, PEN-MKT-1 | Info | CSP del 308 sin candado; ids sin codificar en la ruta del backend; procedencia ciega a ediciones sin `.git`; `Host`/`XFH` en Vercel NO MEDIDO (veredicto `e066b0b5` §4) | Próximo toque de `middleware.ts` / `api.ts` / `verify:head`; primer *preview* | frontend; frontend; devops; devops |
| **TL-CHK-10** | Baja | Secreto `SEPOMEX_DATABASE_URL` = dueño de la BD, no un rol mínimo sobre `"PostalCode"` (veredicto `f2e1de9c` §4); vale solo con la lista §V.3 | El secreto se queda en GitHub; el botón pasa a uso periódico; otro workflow pide un secreto de la BD | devops |
| **PT-CHK-1 residual** (R.4) + **SEC-CHK-6** | Baja | Un atacante que **paga** un pedido real con el correo de la víctima mete su dirección, no predeterminada, en la libreta de ella si la víctima vincula; muerde solo con la libreta sin predeterminada, y `listAddresses` no tiene `orderBy` (§V.1, en `git show 87e7e83f:docs/SECURITY_NOTES.md`) | Reclamo automático; el checkout deja de mostrar la dirección antes de pagar; primer «llegó a otro domicilio»; próximo toque de `listAddresses`/`AddressManager` | arquitecto → backend + frontend |
| PT-CHK-4 | Info | a6 «Pagos iniciados» inflable por un anónimo (§V.1, en `git show 87e7e83f:docs/SECURITY_NOTES.md`) | El dueño decide con a6; un salto anómalo | backend / dueño |
| TL-CHK-8, SEC-CHK-2, SEC-CHK-3 | Baja/Info | Acciones del botón de CP fijadas por etiqueta; fila Stripe del aviso inexacta tras el prellenado; dependencias corren con el secreto (veredicto `f2e1de9c` §2) | Ficha TL-CHK-8; la revisión legal del aviso; nada | devops; dueño → frontend |
| PEN-CNV-1 | Info | `GET /catalog/sealed/:id` responde 200 agotada para piezas en bóveda, vendidas, retiradas o de intake, con la identidad del **producto** (no dueño, estado ni precio). La identidad de una pieza de cliente es la de su URL cuando estuvo publicada (veredicto `43d9eb10` §3). Para el intake nunca publicado, el UUID solo lo tiene el staff. Ya existía con `sealed_value_trend=on` en `value-history` | El primer producto «secreto hasta el anuncio» en inventario antes de anunciarse, o el primer enlace del admin a la ficha pública ⇒ 404 si `firstListedAt` es nulo en la rama agotada | backend (arquitecto: una línea en §MKT.A.1) |
| LOW-1 (pentest, histórico) | Baja | Refresh token sin uso único: un refresh usado da 200 otra vez (stateless). Sin re-medir | El siguiente pase de `auth` (junto a SEC-C7-RT) | backend |
| BMK-1 | Info | El cotizador anónimo deja leer el mercado en lote | C6 sale mal, o un mercado propio | backend |
| REL7-P3 (R7-C2) = **PEN-CNV-2**, SEG-R7-1 (R7-C3) | Baja | «Avísame» de sellados con correo ajeno sin doble opt-in (re-medido en vivo en el veredicto `43d9eb10` §4: el tope por IP se esquiva con XFF rotatorio = P-RL-1; riesgo = correo masivo no solicitado desde el dominio de pedidos); huecos menores del aviso de la lista de deseos | **Precondición dura para encender `sealed_restock_alerts`** (doble opt-in de invitado + validador del dial que rechace `on` sin él); una queja; >5 suscripciones a un correo al día; **`sk_live_` ya ocurrió ⇒ re-enruto a backend**; encender `wishlist_enabled` | backend; dueño |
| SB-B2/SEC-SB-3, SB-B4/REL-D, SB-B5, P-SEED-1, P-NAME-1/D-10, P-REDIR-1, P-BILL-DoS/D-9, D-2…D-7, D-11/PII-D | Baja/Info | 500 por serialización; deps moderadas; flood de firmas inválidas; `assertSeedTarget`; nombres sin escapar; `safeNext`; rotación de `PII_ENCRYPTION_KEY`; diales sin re-validar (ver SEC-ENV-3); throttler en memoria | Ver ficha. **D-6** (el DAST no escanea producción) ya está en su disparador «antes de dinero real» | backend / devops |
| SEC-R1103-I1, SEC-R1103-I2 | Info | Rama `http=` del clasificador de marketing sin prueba (la mutación sobrevive; hoy no es explotable); `new Function` en una E2E (= TL-R1103-6) (veredicto `87e7e83f` §R.4) | Próximo toque de `marketing-source-error.ts` o cierre de TL-R1103-5 ⇒ caso `{response:{status:'403\nX'}}` ⇒ `otro` y la mutación sale roja; cierre de TL-R1103-6 | backend; frontend |
| **PT-CTA-5**, PT-CTA-7, SEC-CTA-I1, SEC-CTA-I2, SEC-CTA-I3, SEC-CTA-I4 | Baja/Info (I3/I4: ver CTA.5) | §CTA (veredicto `153f7c40` CTA.3): la petición que sigue a `forgot-password` deja ver si el correo existe (AUC ~0,67; el alta ya lo revela con `409`); pagar a la bóveda sin buzón probado (D-CTA-2); la espera en el candado de la cuenta retiene una conexión del pool; Google con el correo movido y tomado en la ventana ⇒ 500 que falla cerrado (= TL-CTA-18) | El alta deja de revelar la existencia o un pico de `forgot-password`; un código solo-bóveda con `maxUsesPerCustomer` o apartados sin pago desde cuentas email-only; `P2024` en logs o más de 1 instancia; el arreglo de TL-CTA-18, que debe pasar por la rama `wasUnverified` | backend; backend / dueño |
| Google de punta a punta (clase PT-CTA-9) | Info | Cerrado en código y en integración (M1 2/2); sin medir con un token real de Google (veredicto `153f7c40` CTA.3) | El primer entorno autorizado con `GOOGLE_CLIENT_ID` de prueba ⇒ el pentester repite la carrera con N ≥ 30 | pentester |
| SEC-IDS-1…4 | Info/Baja | §IDS (veredicto `52481453`, texto en `cfd96f56`): llave K del sellado sin el producto del mapeo; restar Σ entre dos runs del botón despeja la Q de un cliente; `sslmode=require` sin verificar el certificado; M-95c abortada bloquea despliegues hasta `migrate resolve` | Falla o no llega una corrida `manual_price`, o remapeo masivo; el run no se borra o hay un segundo run; Railway publica una CA ⇒ `verify-full`; Q1d > 0 al fusionar | backend; devops / dueño; devops; devops |
| SEC-OPS-1 | Baja (operativa, recurrente) | Un gate puede medir un binario que no es el sha auditado (le pasó dos veces). Lo vigilan `scripts/assert-serving-head.sh` y `scripts/check-provenance-gate.sh`, que citan «§9»: ese texto está en git (`git show 60250e90:docs/SECURITY_NOTES.md`) | Cualquier rojo de procedencia ⇒ se para y se mide sobre una copia con el sha verificado | devops |
| URL firmada de INE (120 s), residuo pre-M-55, candado C14 solo en integración, `forbidNonWhitelisted:false`, motivo verbatim, `NoopMailAdapter` | Baja/Info | Ver ficha (`da6a237`, `8f8c35c`) | Subir el TTL; un endpoint de dinero nuevo que confíe en el DTO; Noop en un entorno real | backend / devops |

## C. Banderas para el humano (el dueño)
1. **Ya cobras en real con la CSP en modo aviso (CL-1) y sin la ronda de control de C6 (P-RL-1).** Ninguna de las dos es nueva, pero el
   veredicto «listo-real» (`c62621e6`) las ponía **antes** de `sk_live_` y pedía, si cobrabas antes, que lo aceptaras por escrito en `HECHOS.md`.
   Esa fila no existe. O se cierran (frontend/devops), o lo aceptas tú y queda escrito.
   Medido el 2026-10-31 (`e066b0b5`, M-1): si un nombre de carta llegara con código, hoy solo lo para el escape del JSON-LD. Con la CSP
   en `enforce` habría una segunda barrera.
2. **No enciendas «Avísame cuando vuelva»** del sellado (ajuste `sealed_restock_alerts`) hasta que backend entregue la confirmación por correo
   (REL7-P3/PEN-CNV-2). Hoy cualquiera puede apuntar correos ajenos y la tienda les escribiría desde el mismo dominio que tus correos de pedidos.
   Si ya lo tienes encendido, apágalo: no lo he medido en producción.
3. Varios disparadores de deuda decían «antes de `sk_live_`» y **ya se cumplieron**: A-BSD-1, SEC-SHIP-B1 (SPEI duplicado), el doble
   opt-in de REL7-P3 y D-6. Hay que re-enrutarlos (backend/arquitecto/devops). No los introduce este release.
4. **Medición:** SEC-MED-1 quedó cerrada (2026-10-27) y la encendiste ese día (`HECHOS.md:195`). Si no lo hiciste ya, en la consola
   de GA4 tienes que apagar **entera** la «medición mejorada», junto con los demás pasos de §MKT.H.10. Si queda encendida, Google lee
   lo que buscó el visitante y el código no lo puede impedir. Te lo pedirá el orquestador con pasos de pantalla.
5. **RL-INFO-2:** el plazo de «30 días con dinero real» vence hacia el **2026-11-15**, contado desde el 2026-10-16 que declaraste en
   `HECHOS.md:16` (NO MEDIDO). Después tocan 2FA y re-autenticación para el súper-admin.
6. Siguen vigentes: pentest de un tercero + bug bounty (lo aceptaste para empezar, `HECHOS.md:71`; recomiendo contratarlo dentro de los
   primeros 30 días); revisión legal del aviso de privacidad provisional, de la custodia y de INE/CLABE (BL-42); y antes de encender la
   medición, revisión legal de GA4/Meta y decidir si un analista externo verá b1/b2 (SEC-MKT-4).

7. **Antes de fusionar §DYN:** activa la **alerta de gasto** de Vercel (Pro). Es parte de la aceptación del residual del optimizador de imágenes y no hay candado que la vigile: tienes que hacerla tú (`DEVOPS_NOTES` §106.4 paso 5). Si salta, el interruptor está listo (`NEXT_PUBLIC_IMAGE_OPTIMIZER_KILL_SWITCH=on` y volver a desplegar).
8. **§IDS** (de `52481453`): corre el botón **una vez** y **borra el run** en cuanto copies las cifras (SEC-IDS-2); **Q1d tiene que dar 0** antes de fusionar (SEC-IDS-4). **§CTA** (`2f136542`, CTA.5): antes de publicar, en Railway abre el proyecto, elige el entorno **production** arriba, entra al servicio del **backend** y abre la pestaña **Variables**: en la lista **no debe existir** ninguna variable llamada `RESEND_BASE_URL` (si está, bórrala con los tres puntos de su fila y deja que vuelva a desplegar). Haz lo mismo en el servicio del **frontend**. Solo mirar; no hace falta copiar ningún valor.
---

# Índice de veredictos anteriores

Los más recientes, del más nuevo al más viejo: `60250e90` (2026-10-25, Envío v2 regla A / buylist·solicitud / b5-b6; texto en
`git show 2f5a59c0:docs/SECURITY_NOTES.md`), `803c4298` (2026-10-23, MKT-TL2 R3b/R4), `af37ea5` (2026-10-21, Card Show M-90),
`e77b9612` (2026-10-19, Panel de Marketing / Medición Fase 2 apagada), `e454262` (2026-10-16, P&L), `c62621e6` (2026-10-05, «listo-real»).
Texto íntegro de los 81 anteriores: `git show 60250e90:docs/SECURITY_NOTES.md`; su tabla índice por fecha y sha: `git show 2f5a59c0:docs/SECURITY_NOTES.md`.

_Changelog:_ 2026-11-04 · delta §CTA `2f136542` APROBADO (buzón falso de CI sin fuga útil, SEC-CTA-I3/I4; «olvidé» sin oráculo; CTA.4 compactado). · 2026-11-04 · veredicto §CTA `153f7c40` APROBADO (PT-CTA-9 cerrada, Media; PT-CTA-5/7, SEC-CTA-I1/I2 y Google sin medir en vivo aceptados en B; PT-CTA-6 absorbida en P-RL-1; M-97 no bloquea; §IDS y release 1103 compactados). · 2026-11-03 · veredicto §IDS `52481453` APROBADO (BE-IDS-PT-9 y PT-IDS-1/2/3/6/7/8 cerradas; PT-IDS-4/5 aceptadas; SEC-IDS-1…4 aceptadas; checkout compactado a §V.3). · 2026-11-03 · veredicto `87e7e83f` APROBADO (release 1103: clase del error de GA4/SC sin fuga con 36 entradas hostiles; N1 no cambia lo que llega a `POST /checkout/guest/session`; SEC-R1103-I1/I2 Info; §V.1 de `7107ff8a` compactado). · 2026-11-02 · re-veredicto `7107ff8a` APROBADO (PT-CHK-1 reabre SEC-CHK-4 y se cierra en código; PT-CHK-2/3 cerradas; residual Baja + SEC-CHK-6 aceptados; §5.1(3) obligatorio; compactado con `f2e1de9c` a §V.1–V.3, texto íntegro en `9fcf1d20`). · 2026-11-02 · veredicto `f2e1de9c` APROBADO (checkout-friccion: botón de CP, reclamo → libreta, prellenado/Stripe; TL-CHK-10 aceptada; SEC-CHK-1 abierta; `43d9eb10` compactado). · 2026-11-01 · veredicto `43d9eb10` APROBADO (Marketing conversión 2; PEN-CNV-1 rebajada a Info y aceptada; PEN-CNV-2 = REL7-P3; `e066b0b5` compactado). · 2026-10-31 · veredicto `e066b0b5` APROBADO (Marketing/SSR SEO Ola 2; PEN-MKT-1 rebajada a Info, PEN-MKT-2 = SEC-MKT2-B1; §DYN compactado). · 2026-10-25 · veredicto `60250e90` APROBADO; compactado de 17 004 líneas a estado vigente + registro + índice. · 2026-10-26 · veredicto `2f5a59c0` APROBADO (DSC-1 cerrada; SEC-MED-1 abierta al encender). · 2026-10-27 · re-verificación `1b777967`: SEC-MED-1 cerrada. · 2026-10-29 · veredicto `5aeda006` APROBADO (velocidad de la portada, solo frontend); compactados los dos anteriores. · 2026-10-31 · veredicto `d5f0b38c` APROBADO (§DYN portada dinámica; PEN-DYN-2 cerrada; residual de PEN-DYN-1 + SEC-DYN-M1 aceptados con candado).

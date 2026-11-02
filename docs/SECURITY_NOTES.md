# SECURITY_NOTES.md — Seguridad (blue team) · estado vigente

> **Estado vigente (2026-11-02).** Último veredicto: **APROBADO** sobre **`7107ff8a`** (rama `claude/checkout-friccion`,
> re-veredicto tras el pase del pentester sobre `f2e1de9c`; delta del arreglo `f2e1de9c..7107ff8a`, errata v1.116.1).
> **SEC-CHK-4 reabierta como PT-CHK-1 (Media) y cerrada en código** sobre `7107ff8a`. PT-CHK-2/3 (Bajas) cerradas en código.
> Riesgo residual de PT-CHK-1 aceptado como **Baja** (§V.1), con una Baja nueva, **SEC-CHK-6** (libreta sin predeterminada ⇒ autoselección por orden indefinido).
> Críticas 0 · Altas 0 · Medias 2 abiertas (SEC-CHK-1 depende de la configuración del dueño; CL-1 heredada).
> ⚠ **Antes de pegar `SEPOMEX_DATABASE_URL`, cumplir la lista §V.3**, que desde este veredicto exige *Required reviewers* (PT-CHK-7). Mal configurado, SEC-CHK-1 pasa a Crítica.
> Siguen en el registro **P-RL-1**, **CL-1** y **BL-42**. ⚠ No encender `sealed_restock_alerts` sin doble opt-in (PEN-CNV-2, bandera C.2).

---

# RE-VEREDICTO BLUE TEAM — «Checkout con menos captura», arreglo de PT-CHK-1/2/3 · SHA **`7107ff8a`** · 2026-11-02 · seguridad

> ## ✅ **APROBADO** sobre `7107ff8a`, sin condiciones
> Sigue en pie todo lo del veredicto `f2e1de9c` (resumido en §V.2), incluida la **precondición SEC-CHK-1** (§V.3). El texto
> íntegro de los dos veredictos está en `git show 9fcf1d20:docs/SECURITY_NOTES.md`, §R.1–R.6 y §1–§5.

## V.1 Arreglo de PT-CHK-1/2/3, delta `f2e1de9c..7107ff8a`
- **Procedencia.** Medí sobre una copia `git archive 7107ff8a` del árbol entero, que ya borré. No levanté el stack. El PoC en vivo
  (CLM-A13) lo mide QA. El informe del pentester está en `PENTEST_NOTES.md` (`bd054c7a`).
- **PT-CHK-1, Media ⇒ reabre SEC-CHK-4 (Info en `f2e1de9c`, mal clasificado: revisé la lectura de la libreta ajena, no la
  escritura). Cerrado en código con tres defensas independientes:**
  - `listClaimable` solo lista pedidos cobrados (`settledAt ≠ null`, `order-claim.service.ts:61`);
  - `saveAddresses` se salta `status !== 'settled'` y lo registra como `reason=unsettled`, sin domicilio (`:152-155`);
  - `createAddressFromClaim` pone siempre `isDefault=false` (`users.service.ts:367`).
- **Otras vías, revisadas:**
  - el reclamo exige `Authorization: Bearer`, así que no hay CSRF (`jwt-auth.guard.ts:36`);
  - `settled` solo llega por el webhook de Stripe;
  - el cobro mínimo es MX$10 (`stripe.service.ts:65`) y un descuento no lo lleva a 0 (`TOTAL_BELOW_MINIMUM`).
- **Mutaciones medidas por mí** (N=1 cada una, deterministas porque las unitarias usan dobles). Línea base: 95/95 en
  `order-claim.address`, `guest-claim` y `users.me-and-addresses`. Las tres restauradas, `cmp` idéntico.
  | Mutación | Rojas |
  |---|---|
  | Quitar el salto de pedidos no cobrados | 5 |
  | `isDefault` = libreta vacía | 2 |
  | `listClaimable` sin el filtro | 1 |
- **Medido por otros:** el PoC baja de 10/10 a 0/10 según backend, con N=10. **Si QA no obtiene 0/10 en CLM-A13, PT-CHK-1 se reabre.**
- **PT-CHK-2/3, Bajas: cerradas en código.**
  - `createAddress` y `updateAddress` pasan por `withAddressBookLock` (`users.service.ts:327-332`), con el mismo candado
    consultivo y parametrizado que el reclamo.
  - Los demás escritores de `Address` son `deleteAddress` y el borrado ARCO. Ninguno puede dejar dos predeterminadas.
  - La mutación del candado no la medí: backend reporta 10/10 corridas rojas con N=20 rondas (`BACKEND_NOTES.md:6`).
  - TL-CHK-3 cerrada.
- **Riesgo residual, aceptado como Baja** (coincide con ARCHITECTURE §9 `D-CLM-55`).
  - El atacante **paga** un pedido real con el correo de la víctima.
  - Si la víctima vincula, la dirección del atacante entra en su libreta como no predeterminada.
  - Solo muerde si la libreta no tiene predeterminada: `AddressManager.tsx:166` elige `find(isDefault) ?? addresses[0]`.
  - Es Baja por cuatro motivos:
    - el atacante paga MX$10 o más, más el envío, con una tarjeta que deja rastro;
    - el correo del cobro llega a la víctima (por código, NO MEDIDO en vivo);
    - la víctima tiene que vincular un pedido pagado que no reconoce, y el aviso le dice que se guarda la dirección;
    - el checkout muestra la dirección antes de pagar.
  - Disparador: el reclamo se vuelve automático, el checkout deja de mostrar la dirección, o llega el primer «llegó a otro domicilio».
- **SEC-CHK-6, Baja nueva** (arquitecto → backend + frontend).
  - `listAddresses` (`users.service.ts:273`) no tiene `orderBy`.
  - Sin predeterminada, la autoselección queda al orden físico de Postgres, y eso amplifica el residual.
  - Arreglo: `orderBy isDefault desc, createdAt asc`, o no autoseleccionar cuando no hay predeterminada.
  - Disparador: el próximo toque de `listAddresses` o `AddressManager`, o la primera queja.
- **Resto del pentester:**
  - PT-CHK-4, Info, aceptado: un anónimo puede inflar a6 «Pagos iniciados».
  - PT-CHK-5/8, Info: equivalen a SEC-CHK-5.
  - PT-CHK-6, Info: deuda TL-CHK-1. Las plantillas de correo no pintan `line1` (por `grep`); Skydropx y el PDF, NO MEDIDO.
  - **PT-CHK-7: acepto la recomendación.** Un agente con token de escritura puede lanzar `gh workflow run … --ref production`. Por eso §V.3 (3) pasa a obligatorio.
  - TL-CHK-12 no tiene impacto de seguridad: escribe de menos.

## V.2 Veredicto `f2e1de9c` (botón de CP, reclamo → libreta, prellenado/Stripe, medición), vigente salvo SEC-CHK-4
| ID | Sev | Qué | Dueño |
|---|---|---|---|
| **SEC-CHK-1** | **Media** (**Crítica** si se configura mal) | `SEPOMEX_DATABASE_URL` es el dueño completo de la BD de producción. Solo lo protegen dos ajustes manuales que el proxy no deja medir (403): secreto **de entorno** y entorno `catalogo-cp` limitado a `production` | devops (runbook), dueño |
| **CL-1** (heredada) | Media | Ningún `<script>` de Next lleva nonce en producción (`DEVOPS_NOTES §107.5`), así que no hay CSP efectiva. Hipótesis NO MEDIDA: la caché de Vercel. Los reportes bloqueados por CORP son Info: el POST llega con 204. El tope de 60/min de reportes es Baja | frontend, backend, dueño |
| TL-CHK-8 | Baja | `checkout@v5` y `setup-node@v5` fijadas por etiqueta en el job que lleva el secreto | devops |
| SEC-CHK-2 | Baja | Fila Stripe del aviso (`privacidad.es.ts:196`): dice «datos que tú capturas», pero ahora la tienda pasa correo y nombre al modal. Si **Link** está activo (NO MEDIDO), el correo prellenado puede disparar su código | dueño/PO → frontend |
| TL-CHK-10 | Baja, **aceptada** | El secreto no es un rol con `GRANT` solo sobre `"PostalCode"`. Se acepta porque el código está fijado en `production` con sha256, el secreto vive minutos y quien cambia el código ya tiene la credencial. **Vale solo con §V.3 cumplido.** Disparador: el secreto se queda, el uso pasa a periódico, u otro workflow pide un secreto de la BD | devops |
| SEC-CHK-3 / SEC-CHK-5 | Info | «Ejecutar» corre ts-node y Prisma con el secreto, con la misma confianza que el backend. La medición no lleva PII y a6 son totales sin celdas | — |

- **Lo medido entonces:**
  - candado `check-cargar-cp-workflow.sh`: VERDE, canario 20/20;
  - máscara: 0 apariciones de la contraseña en el log;
  - el reclamo no tiene IDOR (ablaciones de C2 y C6 cazadas);
  - el prellenado no deja PII en la URL ni en el storage.
- **Caché de npm:** no es vector, porque `npm ci` verifica la integridad.
- **Sin medir:** si `production` está protegida en GitHub contra pushes de agentes. Lo cierra `gh api …/branches/production/protection`.

## V.3 Banderas para el humano de este stream (van en la solicitud de fusión, junto a `DEVOPS_NOTES §107.2`)
1. El secreto va **solo** en *Settings → Environments → `catalogo-cp` → Environment secrets*. Comprobación: *Repository secrets* **no** lista `SEPOMEX_DATABASE_URL`.
2. «Deployment branches and tags» = **Selected branches and tags**, con una regla `production` de tipo *Branch*. ⛔ No «No restriction».
3. **Obligatorio** (desde `7107ff8a`, PT-CHK-7): **Required reviewers** = el dueño.
4. Si se activó la red pública del Postgres para esto, desactivarla al terminar. Si ya estaba activa: NO MEDIDO.
5. Borrar el secreto al terminar. Si (1) o (2) estuvieron mal en algún momento, **rotar la contraseña** de Postgres.
6. El dueño confirma en su panel si Stripe **Link** está activo. El texto de la fila Stripe se ajusta en la revisión legal.

Candado sugerido a devops (no exigido): un paso en `ci.yml`, sin entorno, que falle si `secrets.SEPOMEX_DATABASE_URL` no está vacío.

— SEGURIDAD (blue team / AppSec), 2026-11-02 · sha **`7107ff8a`** · **APROBADO**

---

# Veredictos recientes, compactados el 2026-11-02
- **`f2e1de9c` · 2026-11-02: APROBADO** (checkout-friccion, 1.ª vuelta). Lo vigente está en §V.2–V.3. Texto íntegro: `git show 9fcf1d20:docs/SECURITY_NOTES.md`.
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
| **P-RL-1** | **Media** (era Alta antes de C7) | El tope por IP se puede esquivar rotando `X-Forwarded-For` si el edge de Railway pasa el valor del cliente. El tope **por cuenta** (C7: 5 intentos, y luego 429) sí protege el login (pentester, `c62621e6`). Queda la evasión del tope por IP en endpoints públicos: scraping (BMK-1) y DoS de la ruta de cobro (SB-B3). Clasifico Media, como en `c62621e6` §6. El pase `8e1b34d7` copió «Alta» de antes de C7 | devops | 2026-10-10: ronda con XFF rotatorio, 6×401 sin 429; **falta la ronda de control** (`HECHOS.md:168`) | C6 completo (§85.4 de `DEVOPS_NOTES`), con proporción N/N, en ventana autorizada por el dueño |
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
| **PT-CHK-1 residual** (R.4) + **SEC-CHK-6** | Baja | Un atacante que **paga** un pedido real con el correo de la víctima mete su dirección, no predeterminada, en la libreta de ella si la víctima vincula; muerde solo con la libreta sin predeterminada, y `listAddresses` no tiene `orderBy` (§V.1) | Reclamo automático; el checkout deja de mostrar la dirección antes de pagar; primer «llegó a otro domicilio»; próximo toque de `listAddresses`/`AddressManager` | arquitecto → backend + frontend |
| PT-CHK-4 | Info | a6 «Pagos iniciados» inflable por un anónimo (§V.1) | El dueño decide con a6; un salto anómalo | backend / dueño |
| TL-CHK-8, SEC-CHK-2, SEC-CHK-3 | Baja/Info | Acciones del botón de CP fijadas por etiqueta; fila Stripe del aviso inexacta tras el prellenado; dependencias corren con el secreto (veredicto `f2e1de9c` §2) | Ficha TL-CHK-8; la revisión legal del aviso; nada | devops; dueño → frontend |
| PEN-CNV-1 | Info | `GET /catalog/sealed/:id` responde 200 agotada para piezas en bóveda, vendidas, retiradas o de intake, con la identidad del **producto** (no dueño, estado ni precio). La identidad de una pieza de cliente es la de su URL cuando estuvo publicada (veredicto `43d9eb10` §3). Para el intake nunca publicado, el UUID solo lo tiene el staff. Ya existía con `sealed_value_trend=on` en `value-history` | El primer producto «secreto hasta el anuncio» en inventario antes de anunciarse, o el primer enlace del admin a la ficha pública ⇒ 404 si `firstListedAt` es nulo en la rama agotada | backend (arquitecto: una línea en §MKT.A.1) |
| LOW-1 (pentest, histórico) | Baja | Refresh token sin uso único: un refresh usado da 200 otra vez (stateless). Sin re-medir | El siguiente pase de `auth` (junto a SEC-C7-RT) | backend |
| BMK-1 | Info | El cotizador anónimo deja leer el mercado en lote | C6 sale mal, o un mercado propio | backend |
| REL7-P3 (R7-C2) = **PEN-CNV-2**, SEG-R7-1 (R7-C3) | Baja | «Avísame» de sellados con correo ajeno sin doble opt-in (re-medido en vivo en el veredicto `43d9eb10` §4: el tope por IP se esquiva con XFF rotatorio = P-RL-1; riesgo = correo masivo no solicitado desde el dominio de pedidos); huecos menores del aviso de la lista de deseos | **Precondición dura para encender `sealed_restock_alerts`** (doble opt-in de invitado + validador del dial que rechace `on` sin él); una queja; >5 suscripciones a un correo al día; **`sk_live_` ya ocurrió ⇒ re-enruto a backend**; encender `wishlist_enabled` | backend; dueño |
| SB-B2/SEC-SB-3, SB-B4/REL-D, SB-B5, P-SEED-1, P-NAME-1/D-10, P-REDIR-1, P-BILL-DoS/D-9, D-2…D-7, D-11/PII-D | Baja/Info | 500 por serialización; deps moderadas; flood de firmas inválidas; `assertSeedTarget`; nombres sin escapar; `safeNext`; rotación de `PII_ENCRYPTION_KEY`; diales sin re-validar (ver SEC-ENV-3); throttler en memoria | Ver ficha. **D-6** (el DAST no escanea producción) ya está en su disparador «antes de dinero real» | backend / devops |
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
---

# Índice de veredictos anteriores

Los más recientes, del más nuevo al más viejo: `60250e90` (2026-10-25, Envío v2 regla A / buylist·solicitud / b5-b6; texto en
`git show 2f5a59c0:docs/SECURITY_NOTES.md`), `803c4298` (2026-10-23, MKT-TL2 R3b/R4), `af37ea5` (2026-10-21, Card Show M-90),
`e77b9612` (2026-10-19, Panel de Marketing / Medición Fase 2 apagada), `e454262` (2026-10-16, P&L), `c62621e6` (2026-10-05, «listo-real»).
Texto íntegro de los 81 anteriores: `git show 60250e90:docs/SECURITY_NOTES.md`; su tabla índice por fecha y sha: `git show 2f5a59c0:docs/SECURITY_NOTES.md`.

_Changelog:_ 2026-11-02 · re-veredicto `7107ff8a` APROBADO (PT-CHK-1 reabre SEC-CHK-4 y se cierra en código; PT-CHK-2/3 cerradas; residual Baja + SEC-CHK-6 aceptados; §5.1(3) obligatorio; compactado con `f2e1de9c` a §V.1–V.3, texto íntegro en `9fcf1d20`). · 2026-11-02 · veredicto `f2e1de9c` APROBADO (checkout-friccion: botón de CP, reclamo → libreta, prellenado/Stripe; TL-CHK-10 aceptada; SEC-CHK-1 abierta; `43d9eb10` compactado). · 2026-11-01 · veredicto `43d9eb10` APROBADO (Marketing conversión 2; PEN-CNV-1 rebajada a Info y aceptada; PEN-CNV-2 = REL7-P3; `e066b0b5` compactado). · 2026-10-31 · veredicto `e066b0b5` APROBADO (Marketing/SSR SEO Ola 2; PEN-MKT-1 rebajada a Info, PEN-MKT-2 = SEC-MKT2-B1; §DYN compactado). · 2026-10-25 · veredicto `60250e90` APROBADO; compactado de 17 004 líneas a estado vigente + registro + índice. · 2026-10-26 · veredicto `2f5a59c0` APROBADO (DSC-1 cerrada; SEC-MED-1 abierta al encender). · 2026-10-27 · re-verificación `1b777967`: SEC-MED-1 cerrada. · 2026-10-29 · veredicto `5aeda006` APROBADO (velocidad de la portada, solo frontend); compactados los dos anteriores. · 2026-10-31 · veredicto `d5f0b38c` APROBADO (§DYN portada dinámica; PEN-DYN-2 cerrada; residual de PEN-DYN-1 + SEC-DYN-M1 aceptados con candado).

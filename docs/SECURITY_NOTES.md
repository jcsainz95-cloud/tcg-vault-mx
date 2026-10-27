# SECURITY_NOTES.md — Seguridad (blue team) · estado vigente

> **Estado vigente (2026-10-27).** Último veredicto de release: **APROBADO** sobre **`2f5a59c0f1bf063e47e104b084e02036ac381456`**
> (2026-10-26, «Códigos de descuento · evento de prueba de Meta · aviso con la medición»). Críticas 0 · Altas 0.
> **Re-verificación puntual 2026-10-27 sobre `1b77796776e329df5b5a4c635dae889d006a630b`: SEC-MED-1 CERRADA** (arreglo `d897fd48`),
> medida con la medición encendida, con gtag.js y fbevents.js **reales** en el navegador y mutaciones que las pruebas cazan.
> **Encender la medición:** por seguridad del código ya no lo frena nada. Faltan los pasos de consola del dueño de §MKT.H.10
> (medición mejorada de GA4 apagada entera, etc.) y la pasada de tester-e2e con red real (PENDIENTES «MEDIR-ENCENDER» (3) y (5)).
> Lo heredado sigue en «Registro vigente»: **P-RL-1**, **CL-1** (CSP en `report-only`, sin aceptación escrita del dueño), **BL-42**.

---

# RE-VERIFICACIÓN SEC-MED-1 · SHA **`1b77796776e329df5b5a4c635dae889d006a630b`** · 2026-10-27 · seguridad

> ## VEREDICTO: ✅ **SEC-MED-1 CERRADA** sobre `1b777967`. Nada de seguridad del código bloquea encender.
> Ninguna llamada a GA4 ni a Meta lleva `q` (ni `Q`, `%71`, `#…` ni otra clave fuera de `MEASUREMENT_QUERY_ALLOWLIST`), tampoco tras
> navegar en cliente. El backend (CAPI y evento de prueba) arma `event_source_url` sin ninguna entrada del usuario.

**Procedencia.** `git archive 1b777967` del árbol entero a una copia en el scratchpad (`d897fd48` es ancestro). Instalé `npm ci` en
`frontend/` de la copia y enlacé `node_modules` de backend. Bundle de mocks con `NEXT_PUBLIC_MEASUREMENT_MODE=on` (IDs de prueba
`G-E2ETEST1` / `1234567890123`), servido en `:3017`. Load entre 2 y 13 con 4 CPU; ningún rojo de los que cuento es por timeout. Logs en
`scratchpad/sec-med1-logs/`; la copia está borrada. **Nada salió a Google ni a Meta con datos:** solo dejé pasar la descarga de
`gtag.js`/`fbevents.js`. Los beacons (`/g/collect`, `facebook.com/tr`) los intercepté con 204 y los registré.

| # | Medición (base `1b777967`) | Resultado |
|---|---|---|
| 1 | Vitest `lib/measurement` + `components/consent` + `security` (entorno por defecto) | **216/216** |
| 2 | E2E de la casa `measurement-on.spec.ts` «SEC-MED-1» (vendors stub), `--repeat-each 3` | **9/9 verdes** (3 pruebas × N=3) |
| 3 | **Sonda mía con vendors REALES** (`zz-secmed1-realvendor.spec.ts`, solo en la copia), N=3. **S1:** aterrizar en `/es/catalog?q=…&Q=…&%71=…&utm_source=ig#…` ⇒ aceptar ⇒ `router.push` a una ficha ⇒ `router.push` a `/es/catalog?Q=…&%71=…` ⇒ salir. **S2 (390 px):** ficha limpia ⇒ agregar ⇒ otra ficha por cliente ⇒ `/es/catalog?q=…` + buscar + agregar ⇒ ficha `?%71=…&utm_source=ig` + agregar ⇒ salir | **6/6 verdes**. En cada corrida hubo 4-5 beacons de GA4 y 1-3 de Meta; en ninguno aparece el término, `q=`, `Q=` ni `%71` en `dl`/`dr`/`rl`/`ep.*`/el cuerpo. Meta solo disparó en URL limpia: 0 beacons en `?q=` o `?%71=` |
| 4 | 37 casos de codificación contra `sanitizeMeasurementUrl`/`isPixelSafeUrl`: `%71`, `Q`, `%51`, `q%00`, `;q=`, `q` sin valor, `q[]`, clave repetida, `#` vacío, `%26q%3D` dentro de un utm, `UTM_SOURCE`, `+` | **37/37** (GA4 los quita; el píxel no actúa) |
| 5 | Backend `test/measurement.bodies` + `measurement.meta-test-event` | **22/22**. `eventSourceUrl` = origen de `APP_BASE_URL` + ruta constante (`/checkout`, `/buylist`, `/`), sin query (`measurement-bodies.ts:186`) |

**Datos de conducta del vendor real** (S1/S2, N=3): `user_engagement` sale con el `page_location` del `config` (saneado, de la carga),
no con `location.href`. `fbevents.js` con `autoConfig:false` + `disablePushState` + `init` no manda nada por su cuenta: con M2, el píxel
cargado sobre `?q=` no emitió ningún beacon en S1 (N=2). El término de búsqueda del catálogo **no** se escribe en la URL (`CatalogView`
no hace `replace` con `q`). `?q=` solo entra por enlaces.

**Mutaciones** (en la copia, restauradas y comprobadas con `diff` contra `git show 1b777967:…` = vacío):

| Mutación | Unidad | E2E stub (N=2) | Sonda con vendors reales (N=2) |
|---|---|---|---|
| **M1** `sanitizeMeasurementUrl` devuelve `url.href` (sin filtro) | **14 rojas**/216 | **4/6 rojas**: (a) 2/2 y (b′) 2/2; (b) 2/2 verde, como debe ser, porque su URL nunca lleva `q` | **4/4 rojas**: `dl=…/es/catalog?q=xqzleak&Q=XqzLeak&%71=xqzleak&utm_source=ig#xqzleak` |
| **M2** `isPixelSafeUrl` ⇒ `true` siempre | **8 rojas**/216 | **4/6 rojas**: (a) 2/2 y (b′) 2/2 | **S2 2/2 rojas**: `facebook.com/tr ViewContent`/`AddToCart` con `dl=…/c-pikachu?%71=xqzleak…`; S1 2/2 verde (ver arriba) |

**Lo que queda (no bloquea):**
- **SEC-MED-1-R1 · Info · aceptada.** Una llamada a `fbq` hecha con la URL limpia **antes** de que baje `fbevents.js` se procesa al
  bajar, con el `location.href` de ese momento. Para que salga `q`, el visitante tendría que pasar a un `?q=` por enlace en ese
  instante (cientos de ms). No lo reproduje. Disparador: que el catálogo empiece a escribir `q` en la URL, o un beacon de Meta con
  `q` en la pasada de tester-e2e. Dueño: frontend.
- **Fuera del código, NO MEDIDO por mí:** que la «medición mejorada» de GA4 esté apagada en la consola (§MKT.H.10). Si queda
  encendida, su «búsqueda en el sitio» lee `q` de la URL por su cuenta y este arreglo no la para. Lo cierra el paso (3) de MEDIR-ENCENDER
  con fecha en `HECHOS.md`, más la pasada (5) de tester-e2e con red real contra el ID de verdad.
- En `HEAD` del árbol vivo (`0e782cd6`, descendiente) `ENCENDER_BLOCKERS` y `BACKEND_ENCENDER_BLOCKERS` están vacíos (lo leí con
  `git show`). El cierre de MKT-F2-3 no es de este pase y no lo medí. El delta `1b777967..0e782cd6` no toca `lib/measurement` ni
  `components/consent` (`git diff --stat`).

---

# VEREDICTO BLUE TEAM — **Release «Códigos de descuento / evento de prueba de Meta / aviso con la medición»** · SHA **`2f5a59c0f1bf063e47e104b084e02036ac381456`** · 2026-10-26 · seguridad

> ## VEREDICTO: ✅ **APROBADO** sobre `2f5a59c0`, sin condiciones (con la medición APAGADA)
> **0 críticas · 0 altas · 1 media nueva que solo aplica al encender (SEC-MED-1) · 1 baja aceptada (SEC-DSC-QA7) · 3 info.**
> El pase del pentester sobre `c421de13` (0/0/0, 1 baja, 2 info) queda consolidado. **DSC-1 está CERRADA en `2f5a59c0`.**
> El endpoint `POST /admin/measurement/meta-test-event` **pasa** la revisión que pide ARCHITECTURE §14.11.
> La puerta de encendido muerde. Lo que promete el aviso **se cumple en el servidor**, pero **no del todo en el navegador** (SEC-MED-1).

## Procedencia y detalle (§1–§4) — compactado el 2026-10-27
Copia entera de `2f5a59c0`; `npx jest test/discounts test/measurement` ⇒ 17/17 suites, 268/268; DSC-1 medida con prueba propia y
mutaciones M1–M7. §1 consolidó el pentest `c421de13`; §2 revisó códigos de descuento (SEC-DSC-QA7); §3 el endpoint de prueba de Meta
(PASA, M3–M6 lo muerden); §4 el aviso frente al código (abrió SEC-MED-1, **cerrada el 2026-10-27**, ver arriba). Texto íntegro:
`git show 1b777967:docs/SECURITY_NOTES.md`.

## 5. Hallazgos de este pase

| ID | Sev | Qué | Ubicación | Dueño | Disparador / cierre |
|---|---|---|---|---|---|
| ~~SEC-MED-1~~ | Media (al encender) — **CERRADA 2026-10-27** (`1b777967`) | URL sin sanear hacia GA4/Meta | `utm.ts`, `loader.ts`, `track.ts` | frontend | Cerrada: re-verificación arriba |
| SEC-DSC-QA7 | Baja (aceptada) | La clave `email:` del quote permite bloquear 15 min los códigos de un correo ajeno y saber si ya usó un código | `guest-checkout.service.ts:324-329` | backend (arquitecto decide) | Sección 2 |
| SEC-DSC-I1 | Info | El candado de DSC-1 vive solo en la integración (M1, M2 y M7 no los ve ninguna prueba pura) | `test/integration/discounts.e2e-spec.ts:583,911` | backend | Si la integración deja de correr en CI, o si `discounts.service.ts` pasa a `backend-lite` ⇒ una prueba pura como la mía |
| SEC-DSC-I2 | Info | M-92 editada en su sitio: suma de control distinta en una BD que ya la aplicó (staging o local) | `20261109120000_m92_discount_codes/migration.sql` | devops | El primer `migrate deploy` en staging que avise de modificación ⇒ recrear esa BD; producción no la tiene |
| SEC-MTE-1 | Info | `fetch` hacia Meta con `redirect:'follow'`: un 307/308 de Graph reenviaría el cuerpo con el token. Host fijo de Meta ⇒ teórico (clase PRE-P2) | `measurement-http.ts` | backend | El próximo toque del fichero |

## 6. VEREDICTO
### ✅ **APROBADO** sobre `2f5a59c0f1bf063e47e104b084e02036ac381456`, sin condiciones, para publicar **con la medición apagada**
- En el alcance (delta `c421de13..2f5a59c0` más el pase del pentester): **0 críticas y 0 altas**. La única Media (SEC-MED-1) solo existe al
  encender, y encender está bloqueado por dos puertas (build y backend) que leí y, en backend, medí.
- **DSC-1 cerrada**, según la decisión del dueño: medida con mi prueba. El candado del repo está en la integración (SEC-DSC-I1).
- El endpoint de Meta pasa la revisión de §14.11, con 4 mutaciones que lo muerden (M3–M6).
- **Encender la medición NO queda aprobado.** Mínimo: SEC-MED-1 cerrada (o al menos su entrada en `ENCENDER_BLOCKERS`), MKT-F2-3 cerrada
  por el evento de prueba, y el repaso de consola de §14.11 (GA4 sin Signals y sin medición mejorada; píxel sin coincidencia avanzada ni
  autoconfiguración). Ese repaso lo hace el dueño con su pantalla, y yo reviso la evidencia.

— SEGURIDAD (blue team / AppSec), 2026-10-26 · sha **`2f5a59c0f1bf063e47e104b084e02036ac381456`** · **APROBADO**

---

# Registro vigente — lo abierto y lo aceptado que sigue en pie (consolidado el 2026-10-26)

> Cada fila dice **qué veredicto la midió por última vez**. Si no la re-medí hoy, lo dice. El detalle está en
> `git show 60250e90:docs/SECURITY_NOTES.md` (busca el ID); lo del veredicto `60250e90` en `git show 2f5a59c0:docs/SECURITY_NOTES.md`.

## A. Abierto (no lo introduce este release; pesa porque la tienda ya cobra en real)
`HECHOS.md:16`, 2026-10-16: «LA TIENDA YA ESTÁ EN VIVO EN MODO REAL DE STRIPE», afirmado por el dueño y NO medido por el orquestador.

| ID | Sev | Qué | Dueño | Última medición | Cierre |
|---|---|---|---|---|---|
| **P-RL-1** | **Media** (era Alta antes de C7) | El tope por IP se puede esquivar rotando `X-Forwarded-For` si el edge de Railway pasa el valor del cliente. El tope **por cuenta** (C7: 5 intentos, y luego 429) sí protege el login (pentester, `c62621e6`). Queda la evasión del tope por IP en endpoints públicos: scraping (BMK-1) y DoS de la ruta de cobro (SB-B3). Clasifico Media, como en `c62621e6` §6. El pase `8e1b34d7` copió «Alta» de antes de C7 | devops | 2026-10-10: ronda con XFF rotatorio, 6×401 sin 429; **falta la ronda de control** (`HECHOS.md:168`) | C6 completo (§85.4 de `DEVOPS_NOTES`), con proporción N/N, en ventana autorizada por el dueño |
| **CL-1** / SEC-HDR-2 / CSP-RO | **Media** | CSP en `report-only` (**[MEDIDO 2026-10-26]** `frontend/src/security/csp.ts:37`; `HECHOS.md` sigue sin fila de aceptación). Con la sesión en `localStorage`, un XSS daría una sesión de súper-admin de hasta 7 días. No se conoce ningún XSS (`grep dangerouslySetInnerHTML` = 0 en el pase `8e1b34d7`) | frontend + devops | `8e1b34d7`, 2026-10-10 (vuelta a report-only a propósito) | CSP en `enforce` según §14.3 de `DEVOPS_NOTES` + `check-csp-zap-parity.sh` rc 0. **O** el dueño lo acepta por escrito en `HECHOS.md` (hoy no hay esa fila: lo busqué) |
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
| BMK-1 | Info | El cotizador anónimo deja leer el mercado en lote | C6 sale mal, o un mercado propio | backend |
| REL7-P3 (R7-C2), SEG-R7-1 (R7-C3) | Baja | «Avísame» de sellados con correo ajeno; huecos menores del aviso de la lista de deseos | Una queja, >5 suscripciones a un correo al día, **o `sk_live_` (ya ocurrió ⇒ doble opt-in: re-enruto a backend)**; encender `wishlist_enabled` | backend; dueño |
| SB-B2/SEC-SB-3, SB-B4/REL-D, SB-B5, P-SEED-1, P-NAME-1/D-10, P-REDIR-1, P-BILL-DoS/D-9, D-2…D-7, D-11/PII-D | Baja/Info | 500 por serialización; deps moderadas; flood de firmas inválidas; `assertSeedTarget`; nombres sin escapar; `safeNext`; rotación de `PII_ENCRYPTION_KEY`; diales sin re-validar (ver SEC-ENV-3); throttler en memoria | Ver ficha. **D-6** (el DAST no escanea producción) ya está en su disparador «antes de dinero real» | backend / devops |
| SEC-OPS-1 | Baja (operativa, recurrente) | Un gate puede medir un binario que no es el sha auditado (le pasó dos veces). Lo vigilan `scripts/assert-serving-head.sh` y `scripts/check-provenance-gate.sh`, que citan «§9»: ese texto está en git (`git show 60250e90:docs/SECURITY_NOTES.md`) | Cualquier rojo de procedencia ⇒ se para y se mide sobre una copia con el sha verificado | devops |
| URL firmada de INE (120 s), residuo pre-M-55, candado C14 solo en integración, `forbidNonWhitelisted:false`, motivo verbatim, `NoopMailAdapter` | Baja/Info | Ver ficha (`da6a237`, `8f8c35c`) | Subir el TTL; un endpoint de dinero nuevo que confíe en el DTO; Noop en un entorno real | backend / devops |

## C. Banderas para el humano (el dueño)
1. **Ya cobras en real con la CSP en modo aviso (CL-1) y sin la ronda de control de C6 (P-RL-1).** Ninguna de las dos es nueva, pero el
   veredicto «listo-real» (`c62621e6`) las ponía **antes** de `sk_live_` y pedía, si cobrabas antes, que lo aceptaras por escrito en `HECHOS.md`.
   Esa fila no existe. O se cierran (frontend/devops), o lo aceptas tú y queda escrito.
2. Varios disparadores de deuda decían «antes de `sk_live_`» y **ya se cumplieron**: A-BSD-1, SEC-SHIP-B1 (SPEI duplicado), el doble
   opt-in de REL7-P3 y D-6. Hay que re-enrutarlos (backend/arquitecto/devops). No los introduce este release.
3. **Medición:** el aviso está aprobado y publicado apagado, y SEC-MED-1 quedó cerrada (2026-10-27). Antes de encender, en la consola
   de GA4 tienes que apagar **entera** la «medición mejorada», junto con los demás pasos de §MKT.H.10. Si queda encendida, Google lee
   lo que buscó el visitante y el código no lo puede impedir. Te lo pedirá el orquestador con pasos de pantalla.
4. **RL-INFO-2:** el plazo de «30 días con dinero real» vence hacia el **2026-11-15**, contado desde el 2026-10-16 que declaraste en
   `HECHOS.md:16` (NO MEDIDO). Después tocan 2FA y re-autenticación para el súper-admin.
5. Siguen vigentes: pentest de un tercero + bug bounty (lo aceptaste para empezar, `HECHOS.md:71`; recomiendo contratarlo dentro de los
   primeros 30 días); revisión legal del aviso de privacidad provisional, de la custodia y de INE/CLABE (BL-42); y antes de encender la
   medición, revisión legal de GA4/Meta y decidir si un analista externo verá b1/b2 (SEC-MKT-4).

---

# Índice de veredictos anteriores

Los más recientes, del más nuevo al más viejo: `60250e90` (2026-10-25, Envío v2 regla A / buylist·solicitud / b5-b6; texto en
`git show 2f5a59c0:docs/SECURITY_NOTES.md`), `803c4298` (2026-10-23, MKT-TL2 R3b/R4), `af37ea5` (2026-10-21, Card Show M-90),
`e77b9612` (2026-10-19, Panel de Marketing / Medición Fase 2 apagada), `e454262` (2026-10-16, P&L), `c62621e6` (2026-10-05, «listo-real»).
Texto íntegro de los 81 anteriores: `git show 60250e90:docs/SECURITY_NOTES.md`; su tabla índice por fecha y sha: `git show 2f5a59c0:docs/SECURITY_NOTES.md`.

_Changelog:_ 2026-10-25 · veredicto `60250e90` APROBADO; compactado de 17 004 líneas a estado vigente + registro + índice. · 2026-10-26 · veredicto `2f5a59c0` APROBADO (DSC-1 cerrada; SEC-MED-1 abierta al encender). · 2026-10-27 · re-verificación `1b777967`: SEC-MED-1 cerrada.

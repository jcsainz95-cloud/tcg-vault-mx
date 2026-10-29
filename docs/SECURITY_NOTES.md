# SECURITY_NOTES.md — Seguridad (blue team) · estado vigente

> **Estado vigente (2026-10-29).** Último veredicto: **APROBADO** sobre **`5aeda0060e2b87e323579088d211409f9f95d46d`** (2026-10-29,
> «velocidad de la portada», solo frontend, rama `claude/portada-velocidad-release`). Críticas 0 · Altas 0 · 1 baja preexistente
> (SEC-DYN3-B1) · 2 info. Antes: APROBADO `2f5a59c0` (2026-10-26) y SEC-MED-1 cerrada sobre `1b777967` (2026-10-27).
> Siguen heredados en «Registro vigente»: **P-RL-1**, **CL-1** (CSP en `report-only`, sin aceptación escrita del dueño), **BL-42**.

---

# VEREDICTO BLUE TEAM — Release «velocidad de la portada» · SHA **`5aeda0060e2b87e323579088d211409f9f95d46d`** · 2026-10-29 · seguridad

> ## VEREDICTO: ✅ **APROBADO** sobre `5aeda006`, sin condiciones
> **0 críticas · 0 altas · 0 medias · 1 baja preexistente que este paquete no introduce (SEC-DYN3-B1) · 2 info.**
> Ninguno de los cuatro cambios abre superficie: el servidor no cambia, no hay dependencias nuevas y la cabecera CSP es idéntica.
> **Pentester: no hace falta para este delta** (argumentos en §6). El orquestador decide.

## 1. Alcance y procedencia
- **Qué entra** `[MEDIDO]`: `production` (`79c53ca2`, ancestro de `5aeda006`: `git merge-base --is-ancestor` rc 0) más el paquete §DYN.3.
  `git diff origin/production 5aeda006` está **vacío** en `backend/`, y fuera de `docs/`, `frontend/` y `*.md` también: no cambian
  `scripts/`, `security/`, `.github/`, `Dockerfile*` ni `vercel.json`. `frontend/package-lock.json` es idéntico, así que no hay
  dependencias nuevas y `npm audit` no puede cambiar. `package.json` solo suma el `postbuild`.
- **Dónde medí**: `git archive 5aeda006` del árbol entero en mi scratchpad (`…/scratchpad/sec-5aeda006`) con `npm ci` propio.
  Para comparar, `git archive 79c53ca2` en una copia aparte. Las dos se compilaron con `npm run build` de producción
  (`NEXT_PUBLIC_USE_MOCKS` sin definir, API `https://api.sec-probe.invalid`) y se sirvieron con `node .next/standalone/server.js`
  en `127.0.0.1:3291` y `:3292`. No medí contra Vercel: **NO MEDIDO**. Carga entre 2 y 9 con 4 CPU; ningún resultado depende de
  tiempos. Copias borradas al terminar; logs en `…/scratchpad/sec-5aeda006-logs/`.
- **Vitest** `[MEDIDO]` (pruebas del paquete y `src/security`): `api-client`, `api.export-csv`, `home-bundle`, `mock-boundary`,
  `layout.messages`, `AdminMessagesProvider`, `MasterSet.storefront-messages`, `src/security` ⇒ **9/9 ficheros, 83/83**.

## 2. Lo que pidió el encargo
**(1) `Content-Type` solo con cuerpo (`frontend/src/lib/api-client.ts:356-367`) — no abre CSRF.**
- `[código]` El backend no autentica por cookie. No hay `cookie-parser` ni lectura de `req.cookies` en `backend/src` (grep revisado
  match por match: las 4 menciones de «cookie» son comentarios de Card Show y marketing). `JwtAuthGuard` lee **solo**
  `req.headers['authorization']` con el prefijo `Bearer ` (`common/guards/jwt-auth.guard.ts:35-44`). El refresh viaja en el **cuerpo
  JSON** (`auth.controller.ts:61-64`, `RefreshDto.refreshToken`), no en una cookie. Con `credentials:true` (`cors.ts:32`) no se manda
  nada, porque no hay cookie de sesión. Las dos rutas de Next (`card-show-cdmx.ics`, `llms.txt`) son GET sin sesión. No hay
  server actions.
- **Qué peticiones se vuelven «simples»**: solo las **anónimas sin cuerpo**. Toda petición con sesión lleva `Authorization`, que no
  está en la lista segura de CORS, así que sigue con preflight. Lo decisivo: el CSRF depende de lo que **el servidor** acepta, no de
  lo que manda nuestro cliente. Un sitio atacante ya podía mandar un POST simple antes de este cambio, y el servidor sigue exigiendo
  Bearer en todo lo que no es `@Public()`. `[código]` Ningún middleware del backend usaba `Content-Type` como defensa: grep de
  `content-type`, `req.is(` y `csrf` en `backend/src` = 0.
- **Mutación M2** `[MEDIDO]`: volví a `...(json ? {'Content-Type':…})` ⇒ `api-client.test.ts` **2 rojas de 14** («GET anónimo sin
  cuerpo» y «POST sin cuerpo»). Restaurada (`diff` contra `git show 5aeda006:` vacío) ⇒ 14/14.

**(2) Mocks fuera del bundle (`next.config.mjs:151-206`) — no hay forma de encenderlos en runtime.**
- `[MEDIDO]` En el build de producción, `useMocks:` aparece **solo como `useMocks:!1`**: 9 veces en `.next/server` y `.next/static`
  y 5 en `.next/standalone/.next/server`. La cadena `NEXT_PUBLIC_USE_MOCKS` no aparece en ningún chunk, así que nadie lee la
  variable en runtime. `mock.refresh.token` (el login falso) = 0 ficheros. El centinela de `lib/mock` = 0 en chunks compilados.
  `postbuild` ⇒ `HOME_BUNDLE_OK (169 chunks)`.
- `[MEDIDO]` Arranqué el standalone con `NEXT_PUBLIC_USE_MOCKS=true` **en runtime**: `/es` y `/es/catalog` dieron 200, sin
  fixtures (0 apariciones de «Surging Sparks» o «Twilight Masquerade») y sin centinela (N=1 por ruta; es apoyo, la prueba fuerte es
  el literal horneado). Antes del cambio, `config.useMocks` ya leía `process.env` en el cliente. Ahora `env:` lo hornea también en
  el servidor, así que el cambio **endurece**.
- `[MEDIDO]` Las 296 guardas de `api.ts` y las 12 de `marketing-api.ts` son reescritura mecánica, sin cambio de polaridad:
  `!config.useMocks` pasó a `!(MOCKS_BUILD && config.useMocks)`. Normalicé el diff y solo quedan el import de `requestText`/`getToken`,
  la constante y FE-15. Con `MOCKS_BUILD=false`, toda función va al camino real.
- Los mocks **no se saltan auth**. Son del lado del cliente: un build con mocks encendidos pinta datos falsos y un login falso,
  pero no llama al API ni recibe datos reales, y el backend sigue autorizando cada llamada. La forma de encenderlos es hornearlos en
  el build (`NEXT_PUBLIC_USE_MOCKS=true` en el entorno de Vercel). Ya podía pasar antes, y nada lo impide en el build: **SEC-DYN3-B1**.
- **Mutación M1 (ablación del alias)** `[MEDIDO]`: `if (false && useMocksBuild() === 'false')` ⇒ `npm run build` **rc 1**, con
  `HOME_BUNDLE_FAIL` y el centinela en 3 chunks, entre ellos `admin/marketing/page-*.js`. Restaurada (`diff` vacío). El build base
  sale verde. Es determinista (build), por eso N=1. Aun sin el alias el build sale con `useMocks:!1`: el alias reduce el tamaño, la
  seguridad no depende de él.

**(3) Traducciones `admin` solo bajo `/admin` — no se usaban para seguridad.** `[código]` `SuperAdminOnly.tsx:13-24` decide con
`useRole().isSuperAdmin`, y el texto solo rellena el `EmptyState`. Los dos `useTranslations('admin.m3.role')` son etiquetas.
`[MEDIDO]` En `es.json.admin` no hay `sk_`/`pk_`, correos, URLs ni JWT. Se manda **menos**: el HTML de `/es` bajó de
**466 665 a 152 571 B** (N=10, estable). Un anónimo que abre `/es/admin` sigue recibiendo los textos de admin (443 KB), igual que
antes en cualquier página. No hay regresión.

**(4) FE-15 · `exportFinanceCsv` → `requestText` (`api-client.ts:315-322`, `api.ts:7245-7249`).** `[código]` Bearer de
`getToken()`. Si da 401, hace refresh compartido y **un** reintento (`allowRefresh=false` en el reintento). Si el refresh falla,
limpia la sesión. El token no viaja en la URL, solo `report/from/to`. El error se arma con `toApiError` desde el cuerpo, sin token.
**Mutación M3** `[MEDIDO]`: `fetchWithSession(path, opts, false, false)` ⇒ `api.export-csv.test.ts` **2/2 rojas**; restaurada ⇒ 2/2.
**Caché:** el CSV sale sin `Cache-Control` del backend (`admin.controller.ts:536-545`, `626-635`) y el `fetch` no pone
`cache:'no-store'`. Pasaba igual antes (el `fetch` propio tampoco lo ponía): es **PNL-6** (aceptada). No hay regresión →
**SEC-DYN3-I2**.

**(5) SAST** `[MEDIDO]`: semgrep **1.177.0**, la versión de `security-sast.yml:50`, con las 9 configs del CI
(`security/semgrep.yml` + `p/default`, `typescript`, `javascript`, `nodejs`, `react`, `owasp-top-ten`, `secrets`, `jwt`) sobre los
34 ficheros añadidos o modificados de `frontend/` ⇒ **0 ERROR** (el gate no se pondría rojo). Hay 4 WARNING
`detect-non-literal-regexp`: `next.config.mjs:114,122` y `mock/accessories.ts:226` ya estaban en `production`, y
`mock-boundary.test.ts:109` es una prueba con identificadores propios. Aviso: 5 reglas de Express dieron timeout sobre `api.ts` y
`fixtures.ts` (código de cliente, no aplican). Grep de secretos en las líneas añadidas (`sk_`, `whsec_`, `AKIA`, JWT, PEM,
`password=`/`secret=` literales) = 0. No corrí gitleaks en local: lo corre el CI en el PR.

## 3. CSP: este paquete no la empeora
`[MEDIDO]` Cabecera `content-security-policy-report-only` con el nonce normalizado: **md5 idéntico** entre `79c53ca2` y
`5aeda006`. `csp.ts` y `middleware` no cambian. Los modos de render no cambian (`/[locale]`, `/admin` y `/catalog` son `●` SSG en
ambos). Scripts en línea servidos en local (N=10 por ruta, sin variación), `production` frente a release:
`/es` **19 → 16**, `/es/catalog` **20 → 19**, `/es/admin` **14 → 16**. En las dos versiones todos llevan nonce **en local**. Los +2
de `/admin` son el payload RSC de `AdminMessagesProvider`, que se mueve ahí: mismo origen y mismo tipo que los que salen de las
otras rutas. La única fuente nueva de JS es el chunk de `recharts` con `next/dynamic`, del mismo origen (`'self'`). **NO MEDIDO**:
cuántas violaciones da en Vercel, donde frontend midió 28 scripts sin nonce (D-DYN-1). Eso lo cierra la medición de DYN-F7 en
producción tras publicar. D-DYN-1 y CL-1 siguen abiertas, sin cambio.

## 4. Hallazgos de este pase
| ID | Sev | Qué | Ubicación | Dueño | Disparador |
|---|---|---|---|---|---|
| SEC-DYN3-B1 | Baja (preexistente) | Nada impide un build de Vercel `production`/`preview` con `NEXT_PUBLIC_USE_MOCKS=true`: serviría fixtures y login mock en cliente (precios falsos; sin acceso a datos reales). `postbuild` se salta con mocks (`check-home-bundle.mjs:81-83`) | `next.config.mjs:170,200` | frontend + devops | El próximo toque de `next.config.mjs` o del entorno de Vercel: un `throw` como el de `MEASUREMENT_NOTICE_REQUIRED` (mocks + `VERCEL_ENV` production/preview) |
| SEC-DYN3-I1 | Info | El standalone copia `src/lib/mock/*.ts` (11 ficheros, porque el trazado sigue el `readdirSync` de `next.config.mjs`). **No se sirven** `[MEDIDO]`: `/src/lib/mock/fixtures.ts` y 4 variantes con `..`/`%2e%2e` ⇒ 404 (o 307 sin extensión, que redirige a la tienda), centinela 0. Son datos falsos y el repo es público | `.next/standalone/src/lib/mock` | frontend | Que `lib/mock` llegue a tener algo no público |
| SEC-DYN3-I2 | Info | El CSV financiero sin `no-store`, en ninguna de las dos capas. Sin cambio respecto a `production` (= PNL-6) | `api-client.ts:315`; `admin.controller.ts:536,626` | backend | Los de PNL-6 |

## 5. Mutaciones de este pase (cada una restaurada; `diff` contra `git show 5aeda006:<fichero>` vacío)
M1 alias apagado ⇒ build rc 1 (centinela en 3 chunks) · M2 `Content-Type` siempre ⇒ 2/14 rojas · M3 CSV sin refresh ⇒ 2/2 rojas.

## 6. ¿Hace falta pentester para esta release?
Recomiendo que **no**, para este delta. Lo decide el orquestador y queda anotado como excepción, porque CLAUDE.md pide la fase
completa «por release». Motivos medidos:
(a) `backend/`, `prisma/`, CI, `security/` y el despliegue no cambian (§1).
(b) No hay dependencias nuevas (lock idéntico).
(c) No hay endpoints, rutas con sesión, PII ni dinero nuevos. El único cambio de flujo con token (FE-15) usa el núcleo de sesión
ya auditado, con mutación.
(d) La CSP es idéntica.
(e) La superficie **baja**: menos JS, menos textos de admin a anónimos, mocks fuera del bundle.
Lo que un red team atacaría (auth, IDOR, dinero, webhook) está byte a byte igual que en `production`, que ya pasó el pentest. El DAST
del CI sigue corriendo en el despliegue. **El pentester sí corre** en la próxima release que toque `backend/`, `next.config.mjs`
en cabeceras o CSP, o el manejo de tokens de `api-client.ts`.

## 7. VEREDICTO
### ✅ **APROBADO** sobre `5aeda0060e2b87e323579088d211409f9f95d46d`, sin condiciones
0 críticas y 0 altas en el alcance. Los cuatro cambios se revisaron en código, se midieron en un build de producción y cada uno
tiene una mutación que su candado caza (M1–M3). SEC-DYN3-B1 es anterior al paquete y queda como deuda con su disparador. Lo
heredado (P-RL-1, CL-1, BL-42…) no cambia con esta release. Sigue en el registro y en las banderas al dueño.

— SEGURIDAD (blue team / AppSec), 2026-10-29 · sha **`5aeda0060e2b87e323579088d211409f9f95d46d`** · **APROBADO**

---

# Veredictos recientes, compactados el 2026-10-29
- **Re-verificación SEC-MED-1 · `1b777967` · 2026-10-27: CERRADA.** Con la medición encendida y gtag.js/fbevents.js reales, ninguna
  llamada a GA4/Meta lleva `q` (mutaciones M1/M2 cazadas). Queda SEC-MED-1-R1 (info, registro B) y el paso de consola de GA4,
  que yo no medí (bandera C.3).
- **`2f5a59c0` · 2026-10-26: APROBADO** (códigos de descuento, evento de prueba de Meta, aviso con la medición apagada). DSC-1 cerrada.
  Sus hallazgos vivos están en el registro B (SEC-DSC-QA7, SEC-DSC-I1/I2, SEC-MTE-1).
Texto íntegro de los dos: `git show 5aeda006:docs/SECURITY_NOTES.md`.

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
| SEC-DYN3-B1, SEC-DYN3-I1/I2 | Baja/Info | Build de Vercel con mocks horneados sin `throw`; fuentes de `lib/mock` copiadas al standalone (no se sirven); CSV sin `no-store` (= PNL-6). Veredicto `5aeda006` §4 | El próximo toque de `next.config.mjs` o del entorno de Vercel; `lib/mock` con algo no público; los de PNL-6 | frontend + devops; frontend; backend |
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

_Changelog:_ 2026-10-25 · veredicto `60250e90` APROBADO; compactado de 17 004 líneas a estado vigente + registro + índice. · 2026-10-26 · veredicto `2f5a59c0` APROBADO (DSC-1 cerrada; SEC-MED-1 abierta al encender). · 2026-10-27 · re-verificación `1b777967`: SEC-MED-1 cerrada. · 2026-10-29 · veredicto `5aeda006` APROBADO (velocidad de la portada, solo frontend); compactados los dos anteriores.

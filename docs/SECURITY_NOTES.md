# SECURITY_NOTES.md — Seguridad (blue team) · estado vigente

> **Estado vigente (2026-10-31).** Último veredicto: **APROBADO** sobre **`e066b0b5173e8ebe90979c3d2140a3fc4ec39be5`** (release
> «Marketing / SSR SEO Ola 2», rama `claude/mkt-conversion`, diff `223a7224..e066b0b5` solo frontend; `dd84a5be` encima solo añade
> `docs/PENTEST_NOTES.md`). Críticas 0 · Altas 0 · Medias 0 nuevas · 1 baja · 4 info. Antes: APROBADO `d5f0b38c` (2026-10-31).
> Siguen heredados en «Registro vigente»: **P-RL-1**, **CL-1** (CSP en `report-only`, **sin** fila de aceptación en `HECHOS.md`; este
> pase midió que hoy el escape del JSON-LD es la **única** barrera ante un nombre de carta hostil) y **BL-42**.

---

# VEREDICTO BLUE TEAM — «Marketing / SSR SEO Ola 2» · SHA **`e066b0b5173e8ebe90979c3d2140a3fc4ec39be5`** · 2026-10-31 · seguridad

> ## VEREDICTO: ✅ **APROBADO** sobre `e066b0b5`, sin condiciones
> 0 críticas · 0 altas. Medí en vivo lo que el pentester dejó en código o NO MEDIDO. El 308 no refleja `Host` ni `X-Forwarded-Host`
> (8 variantes, 10/10 cada una). El JSON-LD y el HTML de servidor no se rompen con nombres hostiles (0 diálogos en 30 cargas de navegador).
> PEN-MKT-2 es real, pero queda acotado por el throttler. Hice seis ablaciones y las seis se pusieron rojas al quitar su control y verdes
> al restaurarlo. Lo abierto es coste o SEO. No toca dinero ni PII.

## 1. Alcance y procedencia
- **Copia** `[MEDIDO]`: `git archive e066b0b5` del árbol entero en `…/scratchpad/sec-mkt/tree`, con `npm ci` propio. El stack es mío:
  `stack-native.sh up --gate --seed` con `STACK_EXPECTED_SHA=e066b0b5…`, backend en :3797, `next build` + `next start` en :3798, s3 en :9797,
  BD `tcg_sec_mkt` (rol propio) y Redis db 13. `verify:head e066b0b5` ⇒ «VERIFICADO» en backend y bundle. El script cerró con «NO APTO PARA
  GATE» solo por las capacidades §39: falta COBRO y SUBIDA, porque no hay claves de Stripe. Ningún vector de este pase usa cobro ni
  subida. Los mutantes se hornearon con `NEXT_DIST_DIR=.next-mut` y se sirvieron en :3799, así que el build auditado no se tocó.
  Carga entre 2,7 y 11,9 con 4 CPU. Repetí las mediciones con tope de tiempo con carga menor de 8 (O-16). ⛔ No toqué Vercel, Railway
  ni `tcghunt.mx`. Copia, BD y Redis db 13 están borrados, y apagué por PID. Logs: `…/scratchpad/sec-mkt/logs/`.
- **Delta** `[MEDIDO]`: 72 ficheros, todos de `frontend/` o `docs/`. `backend/` no cambia desde `d5f0b38c`, que es ancestro
  (`git diff --quiet`). Los lockfiles tampoco cambian.

## 2. Consolidación del pentester (`docs/PENTEST_NOTES.md`, pase `e066b0b5`)
| ID | Sev pentest | Sev blue team | Estado medido en vivo |
|---|---|---|---|
| R1/R2 open redirect y CRLF | — | — | **Confirmado.** `//evil`, `\\evil`, `%2f%2f`, traversal, `?next=//evil` y `%0d%0a` en query y en path. Todos salen en 308 o 404 con `Location` **relativo** al mismo origen. CR/LF queda percent-encoded y no aparece ninguna cabecera inyectada. 10/10 por sonda `[MEDIDO]` `redir-base.txt`, `redir-headers.txt` |
| **PEN-MKT-1** | Baja | **Info (baja)** | **No reproduce en `next start`.** `Host`, `XFH`, XFH en lista, `Forwarded` y `X-Forwarded-Port` dan siempre `Location: /card-show…`, 8 variantes × 10/10. `[código]` El origen sale del servidor (`nextUrl` + `getRelativeURL` en `next/dist/server/lib/router-utils/resolve-routes.js:457`), no de la cabecera. **M-4:** quité la relativización de Next. El host sigue siendo el del servidor (`http://localhost:3799`) y **solo el esquema** sigue a `X-Forwarded-Proto`. **M-5:** construí el destino desde `x-forwarded-host`/`host` ⇒ **10/10 `https://evil.example/card-show`** en 5 variantes, en ROJO. Restaurado ⇒ 10/10 relativo. Vercel edge: **NO MEDIDO**. Lo cerraría un `curl -sI -H 'X-Forwarded-Host: evil.example' <preview>/es/card-show` |
| **PEN-MKT-2** | Baja | **Baja** (→ SEC-MKT2-B1) | **Confirmado con mecanismo más preciso**, ver §3 |
| PEN-MKT-I1 | Info | Info | De acuerdo: el nonce del 308 es inocuo. Lo que sí falta es un candado para la CSP del 308 ⇒ SEC-MKT2-I1 |
| PEN-MKT-I2 | Info | — | Es la raíz de SEC-MKT2-B1(c). La asimetría está medida |
| R4–R10 | — | — | XSS (§3), canonical/hreflang/og desde `SITE_URL`, `llms.txt` (solo `soporte@`), sitemap (27 `<loc>` públicos, 0 de admin/checkout) y robots: confirmados en vivo |
| Heredados | | | PEN-DYN-2 está **CERRADA** desde `d5f0b38c`, que es ancestro y no tiene cambios en backend. El pentester la lista como abierta. MKT-TL2 general sigue como en el registro. LOW-1 no estaba en el registro: la añado a B |

## 3. Mediciones del encargo
**XSS en JSON-LD y HTML de servidor** `[MEDIDO]`. En mi BD, la carta `9f04db17…` se llama
`XSSCARD</script><script>alert(1)</script><img src=x onerror=alert(2)>` + U+2028 + `<!--`, su número es `1</SCRIPT><svg onload=alert(3)>` y su set es
`XSSSET</script ><script>alert(4)</script>`. Probé además `?q=`, `?setId=` y `?rarity=` con cargas parecidas. HTML crudo de 4 URL: 0 cargas
crudas y 0 `<script>` ejecutables. Chromium: 10 cargas × 3 URL ⇒ **0 diálogos**, y el nombre se ve como texto 10/10. **M-1:** sin el
`.replace(/</g,'\\u003c')` de `JsonLd.tsx:11` ⇒ 4 cargas crudas, 3 `<script>alert(n)` y **20 diálogos en 10 cargas** de la ficha, en ROJO. El
catálogo no se ve afectado, porque su JSON-LD solo lleva el breadcrumb i18n. Restaurado ⇒ 0. ⚠ Con la CSP en `enforce` esos `<script>` sin nonce no
habrían corrido. Hoy la CSP está en `report-only` (CL-1) y no lo impide. Lo que vale para el JSON-LD vale para el payload RSC del `initialData`, que Next escapa: 0 cargas crudas.

**Cabeceras** `[MEDIDO]`, en 16 rutas. Las páginas nuevas o tocadas (`/es/catalog`, `?page=2`, la ficha, `/es/sellado`, `/es/decks-meta`, `/es/decks-meta/dragapult-ex`,
`/es/compra`, `/es/privacidad`, `/es/terminos`, `/card-show`) y los dos 308 llevan `X-Frame-Options: DENY`, `frame-ancestors 'none'`, la CSP-RO
con nonce, `nosniff` y `Referrer-Policy`. `sitemap.xml`, `robots.txt` y `llms.txt` no llevan la CSP con nonce porque están fuera del `matcher`
y no son HTML. Lo demás sí lo llevan. HSTS no lo pone Next; lo pone la plataforma, como antes. **M-2:** sin `response.headers.set(header, policy)` en la rama 308
(`middleware.ts:66`) ⇒ los 308 salen **sin** CSP con nonce (0/2 frente a 2/2), en ROJO, y las 5 suites de middleware siguen **61/61 en verde** ⇒ SEC-MKT2-I1.

**Amplificación (PEN-MKT-2 ⇒ SEC-MKT2-B1)** `[MEDIDO]`. Hice 400 peticiones a `/es/catalog?q=<aleatorio>` con concurrencia 8:
- **(a) El throttler acota.** Solo **300/400** llegan con datos al servidor, y el resto sale con el esqueleto. Una segunda ronda dio **0/330**.
  La lista directa al backend responde **429**. **M-6:** con `limit: 300_000` en `app.module.ts:56` ⇒ **400/400** llegan, en ROJO.
  Restaurado ⇒ 300/400.
- **(b) El cubo es del servidor, no del atacante.** Las lecturas de servidor salen todas desde la IP del frontend, así que el atacante
  agota un cubo compartido. Mientras dura la ventana, un filtro legítimo sin caché (`?productType=graded`) sale **0/10** sin datos en
  el servidor. Las claves ya cacheadas (`/es/catalog`, `?page=2`) siguen 10/10, y las fichas también, porque el throttler de Nest lleva
  un cubo por manejador.
- **(c) Sockets colgados.** Con mi backend congelado (`SIGSTOP` por PID) el catálogo responde en ≤1,66 s, pero deja **10 de 10 sockets
  abiertos en 10/10 rondas**, que siguen ahí a los 90 s (5/5). Las fichas, con `withAbortBudget`, dejan **0 en 10/10 rondas**. **M-3:**
  ficha con `withBudget` ⇒ **10 colgados en 10/10 rondas**, en ROJO. Restaurado ⇒ 0.
- **(d) Data Cache.** Cada `q` distinta con éxito añade una entrada de unos 4 KB (311 entradas = 1,3 MB). Los 429 no se cachean. Así el
  crecimiento queda acotado por (a). En Vercel: **NO MEDIDO**.

**Varios** `[MEDIDO]`. `cardId` va sin `encodeURIComponent` (`api.ts:629`, preexistente). Las 5 variantes de traversal (`..%2F..%2Fhealth`, etc.) llegan
como literal y dan `initialData: undefined`, así que no se alcanza otra ruta. El canonical sale doble-codificado (`%252F`) ⇒ SEC-MKT2-I2. **SAST:** semgrep
1.177.0 con las 9 configs de `security-sast.yml` sobre los 63 `.ts/.tsx` del diff ⇒ **0 ERROR**. Hay 8 WARNING, todos en pruebas o e2e: 7 son
`non-literal-regexp` y 1 `incomplete-sanitization`. Hubo 1 timeout de regla (`express-ssrf`, en `api.ts`) y 3 parseos parciales de tests.
**Secretos:** 0 coincidencias en las 3 161 líneas añadidas. `npm audit --omit=dev` del frontend da 0. **Procedencia:** `restart:backend` dijo «verificado
(e066b0b5)» con `app.module.ts` modificado por M-6. En una copia sin `.git` no detecta ediciones del fuente ⇒ SEC-MKT2-I3.

## 4. Hallazgos de este pase
| ID | Sev | Qué | Ubicación | Dueño | Disparador |
|---|---|---|---|---|---|
| SEC-MKT2-B1 (= PEN-MKT-2) | Baja | El catálogo de servidor convierte el `q` libre del atacante en lecturas desde la IP del frontend: (b) agota el cubo compartido y deja sin datos de servidor a los filtros sin caché durante la ventana, y (c) con el backend lento deja sockets abiertos ≥90 s. Remedio: `withAbortBudget` en `loadCatalogPageForSSR` (`getCatalog` ya admite `signal` vía `ServerReadOptions`) y cota de longitud de `q` en `parseUrlFilters` | `catalog-ssr.ts:68-80`, `catalog-url.ts:159-171`, `app.module.ts:56` | frontend (abort y cota); backend + devops (cubo de las lecturas de servidor, IPs de salida de Vercel) | Una lectura de 429 desde IPs de Vercel en Railway, Search Console con fichas o catálogo sin productos, subir `CATALOG_SSR_BUDGET_MS`, o el próximo toque de `catalog-ssr.ts` |
| SEC-MKT2-I1 | Info | La CSP del 308 no tiene candado: M-2 la quita y las suites siguen 61/61. Hoy es inocua (sin cuerpo) | `middleware.ts:66`, `middleware.cardshow.test.ts` | frontend | El próximo toque de `middleware.ts` (añadir `expect(res.headers.get(cspHeaderName(CSP_MODE)))`) |
| SEC-MKT2-I2 | Info | `cardId` e `inventoryItemId` sin codificar en la ruta del backend (no explotable, medido) y canonical `%252F` | `api.ts:629,862`; `catalog/[cardId]/page.tsx` | frontend | El próximo toque de `getCardDetail`/`getSealedGroupDetail` |
| SEC-MKT2-I3 | Info | `restart:backend` y `verify:head` certifican el sha en una copia sin `.git` aunque el fuente esté editado | `scripts/stack-native.sh` | devops | El próximo toque de la verificación de procedencia (SEC-OPS-1): sello de hash del árbol fuente |
| PEN-MKT-1 | Info | Sin reflejo de `Host`/`XFH` en `next start`. En Vercel, NO MEDIDO | `middleware.ts:61-68` | devops | El primer *preview* de esta rama: el `curl` de §2, y anotarlo en `DEVOPS_NOTES` |

## 5. VEREDICTO
### ✅ **APROBADO** sobre `e066b0b5173e8ebe90979c3d2140a3fc4ec39be5`, sin condiciones
Ningún hallazgo crítico ni alto abierto. Seis ablaciones mías: M-1 (escape del JSON-LD, 20 diálogos), M-2 (CSP del 308), M-3 (aborto de las fichas,
10/10 rondas), M-4 y M-5 (origen del 308, 10/10 `evil.example`) y M-6 (throttler, 400/400). Todas rojas al quitar su control y verdes al restaurarlo. La única baja es coste
y SEO, acotada por el throttler y con dueño y disparador. Lo heredado no cambia: CL-1, P-RL-1 y BL-42 siguen en el registro y en las banderas.

— SEGURIDAD (blue team / AppSec), 2026-10-31 · sha **`e066b0b5173e8ebe90979c3d2140a3fc4ec39be5`** · **APROBADO**

---

# Veredictos recientes, compactados el 2026-10-31
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
| **CL-1** / SEC-HDR-2 / CSP-RO | **Media** | CSP en `report-only` (**[MEDIDO 2026-10-26]** `frontend/src/security/csp.ts:37`; `HECHOS.md` sigue sin fila de aceptación). Con la sesión en `localStorage`, un XSS daría una sesión de súper-admin de hasta 7 días. No se conoce ningún XSS (`grep dangerouslySetInnerHTML` = 0 en el pase `8e1b34d7`) | frontend + devops | `8e1b34d7`, 2026-10-10 (vuelta a report-only a propósito); **`d5f0b38c` 2026-10-31**: sigue `report-only` (`csp.ts:37`), nonce cerrado con mutación, sin fila en `HECHOS.md`; **`e066b0b5` 2026-10-31**: sin el escape del JSON-LD, 20 diálogos/10 cargas que `enforce` habría bloqueado (M-1) | CSP en `enforce` según §14.3 de `DEVOPS_NOTES` + `check-csp-zap-parity.sh` rc 0. **O** el dueño lo acepta por escrito en `HECHOS.md` (hoy no hay esa fila: lo busqué) |
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
| LOW-1 (pentest, histórico) | Baja | Refresh token sin uso único: un refresh usado da 200 otra vez (stateless). Sin re-medir | El siguiente pase de `auth` (junto a SEC-C7-RT) | backend |
| BMK-1 | Info | El cotizador anónimo deja leer el mercado en lote | C6 sale mal, o un mercado propio | backend |
| REL7-P3 (R7-C2), SEG-R7-1 (R7-C3) | Baja | «Avísame» de sellados con correo ajeno; huecos menores del aviso de la lista de deseos | Una queja, >5 suscripciones a un correo al día, **o `sk_live_` (ya ocurrió ⇒ doble opt-in: re-enruto a backend)**; encender `wishlist_enabled` | backend; dueño |
| SB-B2/SEC-SB-3, SB-B4/REL-D, SB-B5, P-SEED-1, P-NAME-1/D-10, P-REDIR-1, P-BILL-DoS/D-9, D-2…D-7, D-11/PII-D | Baja/Info | 500 por serialización; deps moderadas; flood de firmas inválidas; `assertSeedTarget`; nombres sin escapar; `safeNext`; rotación de `PII_ENCRYPTION_KEY`; diales sin re-validar (ver SEC-ENV-3); throttler en memoria | Ver ficha. **D-6** (el DAST no escanea producción) ya está en su disparador «antes de dinero real» | backend / devops |
| SEC-OPS-1 | Baja (operativa, recurrente) | Un gate puede medir un binario que no es el sha auditado (le pasó dos veces). Lo vigilan `scripts/assert-serving-head.sh` y `scripts/check-provenance-gate.sh`, que citan «§9»: ese texto está en git (`git show 60250e90:docs/SECURITY_NOTES.md`) | Cualquier rojo de procedencia ⇒ se para y se mide sobre una copia con el sha verificado | devops |
| URL firmada de INE (120 s), residuo pre-M-55, candado C14 solo en integración, `forbidNonWhitelisted:false`, motivo verbatim, `NoopMailAdapter` | Baja/Info | Ver ficha (`da6a237`, `8f8c35c`) | Subir el TTL; un endpoint de dinero nuevo que confíe en el DTO; Noop en un entorno real | backend / devops |

## C. Banderas para el humano (el dueño)
1. **Ya cobras en real con la CSP en modo aviso (CL-1) y sin la ronda de control de C6 (P-RL-1).** Ninguna de las dos es nueva, pero el
   veredicto «listo-real» (`c62621e6`) las ponía **antes** de `sk_live_` y pedía, si cobrabas antes, que lo aceptaras por escrito en `HECHOS.md`.
   Esa fila no existe. O se cierran (frontend/devops), o lo aceptas tú y queda escrito.
   Medido el 2026-10-31 (`e066b0b5`, M-1): si un nombre de carta llegara con código, hoy solo lo para el escape del JSON-LD. Con la CSP
   en `enforce` habría una segunda barrera.
2. Varios disparadores de deuda decían «antes de `sk_live_`» y **ya se cumplieron**: A-BSD-1, SEC-SHIP-B1 (SPEI duplicado), el doble
   opt-in de REL7-P3 y D-6. Hay que re-enrutarlos (backend/arquitecto/devops). No los introduce este release.
3. **Medición:** SEC-MED-1 quedó cerrada (2026-10-27) y la encendiste ese día (`HECHOS.md:195`). Si no lo hiciste ya, en la consola
   de GA4 tienes que apagar **entera** la «medición mejorada», junto con los demás pasos de §MKT.H.10. Si queda encendida, Google lee
   lo que buscó el visitante y el código no lo puede impedir. Te lo pedirá el orquestador con pasos de pantalla.
4. **RL-INFO-2:** el plazo de «30 días con dinero real» vence hacia el **2026-11-15**, contado desde el 2026-10-16 que declaraste en
   `HECHOS.md:16` (NO MEDIDO). Después tocan 2FA y re-autenticación para el súper-admin.
5. Siguen vigentes: pentest de un tercero + bug bounty (lo aceptaste para empezar, `HECHOS.md:71`; recomiendo contratarlo dentro de los
   primeros 30 días); revisión legal del aviso de privacidad provisional, de la custodia y de INE/CLABE (BL-42); y antes de encender la
   medición, revisión legal de GA4/Meta y decidir si un analista externo verá b1/b2 (SEC-MKT-4).

6. **Antes de fusionar §DYN:** activa la **alerta de gasto** de Vercel (Pro). Es parte de la aceptación del residual del optimizador de imágenes y no hay candado que la vigile: tienes que hacerla tú (`DEVOPS_NOTES` §106.4 paso 5). Si salta, el interruptor está listo (`NEXT_PUBLIC_IMAGE_OPTIMIZER_KILL_SWITCH=on` y volver a desplegar).
---

# Índice de veredictos anteriores

Los más recientes, del más nuevo al más viejo: `60250e90` (2026-10-25, Envío v2 regla A / buylist·solicitud / b5-b6; texto en
`git show 2f5a59c0:docs/SECURITY_NOTES.md`), `803c4298` (2026-10-23, MKT-TL2 R3b/R4), `af37ea5` (2026-10-21, Card Show M-90),
`e77b9612` (2026-10-19, Panel de Marketing / Medición Fase 2 apagada), `e454262` (2026-10-16, P&L), `c62621e6` (2026-10-05, «listo-real»).
Texto íntegro de los 81 anteriores: `git show 60250e90:docs/SECURITY_NOTES.md`; su tabla índice por fecha y sha: `git show 2f5a59c0:docs/SECURITY_NOTES.md`.

_Changelog:_ 2026-10-31 · veredicto `e066b0b5` APROBADO (Marketing/SSR SEO Ola 2; PEN-MKT-1 rebajada a Info, PEN-MKT-2 = SEC-MKT2-B1; §DYN compactado). · 2026-10-25 · veredicto `60250e90` APROBADO; compactado de 17 004 líneas a estado vigente + registro + índice. · 2026-10-26 · veredicto `2f5a59c0` APROBADO (DSC-1 cerrada; SEC-MED-1 abierta al encender). · 2026-10-27 · re-verificación `1b777967`: SEC-MED-1 cerrada. · 2026-10-29 · veredicto `5aeda006` APROBADO (velocidad de la portada, solo frontend); compactados los dos anteriores. · 2026-10-31 · veredicto `d5f0b38c` APROBADO (§DYN portada dinámica; PEN-DYN-2 cerrada; residual de PEN-DYN-1 + SEC-DYN-M1 aceptados con candado).

# SECURITY_NOTES.md — Seguridad (blue team) · estado vigente

> **Estado vigente (2026-10-31).** Último veredicto: **APROBADO** sobre **`d5f0b38c968d57c30131ac3e1d9e25c7e3b7c283`** (2026-10-31,
> release §DYN «Portada dinámica» más el paquete de velocidad de la PR #107; rama `claude/portada-dinamica`). Críticas 0 · Altas 0 ·
> 1 media aceptada (residual de PEN-DYN-1 con SEC-DYN-M1, cubierta por el candado `image-optimizer-cost-reading-expiry`) · 3 bajas · 3 info.
> Antes: APROBADO `5aeda006` (2026-10-29). Siguen heredados en «Registro vigente»: **P-RL-1**, **CL-1** (CSP en `report-only`, todavía
> **sin** fila de aceptación del dueño en `HECHOS.md`: la busqué hoy) y **BL-42**.

---

# VEREDICTO BLUE TEAM — Release §DYN «Portada dinámica» · SHA **`d5f0b38c968d57c30131ac3e1d9e25c7e3b7c283`** · 2026-10-31 · seguridad

> ## VEREDICTO: ✅ **APROBADO** sobre `d5f0b38c`, sin condiciones nuevas
> **0 críticas · 0 altas.** El dinero aguanta: lo exhibido es lo cobrado y una fila `pending` no se cobra (dos mutaciones mías, las dos
> cazadas). PEN-DYN-2 queda **cerrada** (carrera 10/10 con el candado y 1/10 y 0/10 sin él). El arreglo de PEN-DYN-1 funciona. Su residual
> queda **aceptado**, ahora con un vector más que encontré yo (SEC-DYN-M1, el fragmento `#`). Los dos son coste, no datos ni dinero de
> clientes. `production` hoy está **más abierto** que esta release, y el candado de la lectura de coste lo cobra.

## 1. Alcance y procedencia
- **Qué entra** `[MEDIDO]`: `git diff origin/production d5f0b38c` = 328 ficheros. `79c53ca2` es ancestro de `d5f0b38c` y `d5f0b38c` es ancestro de `HEAD`. Desde el sha del pentest (`d0b40182`) hay 16 commits sin merge; fuera de docs tocan 53 ficheros. Esos los revisé uno por uno: `orders.service.ts`, `listing-price.service.ts`, `price-ingest.service.ts`, `pricing.controller.ts`, `settings.service.ts`, `catalog.service.ts`, `next.config.mjs`, `image-optimizer-switch.mjs`, el guion PDB, `ci.yml` y el candado nuevo. **Sin cambio desde `d0b40182`** `[MEDIDO]` (`git diff --quiet`): `catalog.controller.ts`, `featured.service.ts`, `modules/admin`, `middleware.ts`, `src/security` y `limpieza-ramas.yml`. Para esos me apoyo en el pase del pentester.
- **Dónde medí**: `git archive d5f0b38c` del árbol entero en `…/scratchpad/sec-dyn-d5f0b38c/tree`, con `npm ci` propio. BD propia `tcg_sec_dyn` (rol `tcgsecdyn`) y Redis db 14. Frontend: `next build` de producción (sin mocks, API `https://api.sec-probe.invalid`), servido con `node .next/standalone/server.js` en `127.0.0.1:3791`. La copia no lleva `.git`: el sha lo garantiza el `git archive`. Carga entre 1,5 y 5,8 con 4 CPU, y ningún resultado depende de tiempos (las carreras usan barrera). **No medí contra Vercel ni Railway**: NO MEDIDO. Logs en `…/scratchpad/sec-dyn-d5f0b38c/logs/`.

## 2. Consolidación del pase del pentester (`d0b40182`) sobre `d5f0b38c`
| ID | Sev pentest | Estado en `d5f0b38c` | Evidencia |
|---|---|---|---|
| PEN-DYN-1 | Media | **Arreglo verificado; el residual se acepta** (ver §4). `?v=1`, `%34`, subrutas, `.jpg`, mayúsculas, `//`, `/medium`, logos y `large/` ⇒ **400**. Se transforman `base1/4_hires.png` y `pokemon/me3-1/large` | `[MEDIDO]` 22 sondas, `logs/next-image-off.txt`; `next.config.mjs:220-242` |
| PEN-DYN-2 | Baja | **CERRADA**. `pg_advisory_xact_lock(64_440_960)` y relectura por `tx` dentro del `$transaction`, en Read Committed (sin `isolationLevel`), así que la relectura tras el candado ve lo confirmado | `[código]` `settings.service.ts:698-706`; `[MEDIDO]` abajo, M-A |
| I1 | Info | Abierto, sin cambio: `@Header('Cache-Control', public…)` también en los 400. Los 4 manejadores son `@Public` y no leen sesión | `[código]` `catalog.controller.ts:28,49-100`, sin cambio desde `d0b40182` |
| I2 | Info | El nonce está cerrado y **ahora sí ablacionado** (M-D). La política sigue en `report-only` = CL-1 | `[MEDIDO]`; `csp.ts:37` |
| I3 | Info | Abierto: `url=https://evil.example@images.pokemontcg.io/…` ⇒ **500** (el host sigue siendo el permitido; no es SSRF) | `[MEDIDO]` |
| I4 | Info | (a)–(c) confirmados en código. (d) y (e) pasan a SEC-DYN-B1 y SEC-DYN-B3 | `[código]` `limpieza-ramas.yml`, `limpieza-ramas.sh:17-25,111,137` |

## 3. Lo que pidió el encargo
**(1) Camino del dinero.**
- `[código]` TL-DYN-1 movió «fila o vivo» a `ListingPriceService.chargeDecisionsFor` (`listing-price.service.ts:482-500`): fila `priced` ⇒ su `P`; `pending` ⇒ `422 PRICE_PENDING`; sin fila ⇒ vivo y `missing_row`. Es una copia literal de la lógica que el pentester midió. `orders.service.ts:372` delega, y el único llamador del checkout es `:338`. El importe del PaymentIntent sale de `order.totalCents` / `breakdown.totalCents` (`orders.service.ts:1104`, `guest-checkout.service.ts:610`), calculado en la misma llamada. `listingPrices` no lleva `@Optional()` (`orders.service.ts:226-229`): si falta, el arranque falla en vez de cobrar en vivo.
- **M-B** `[MEDIDO]`: `if (row && false)` en `chargeDecisionsFor` (el checkout ignora la fila) ⇒ `dyn-listing-price` **ROJO**, «exhibido = cobrado… quote y sesión (cuenta e invitado)», esperado 66 700 y recibido 113 400. Restaurado (`diff` contra `git show d5f0b38c:` vacío) ⇒ 12/12. Así queda medido que la app real cobra por este método, y no por la rama de respaldo de `orders.service.ts:374`.
- **M-C** `[MEDIDO]`: sin el `throw PRICE_PENDING` (la `pending` se cobra en vivo) ⇒ **ROJO** en «fila `pending` ⇒ fuera del catálogo y `PRICE_PENDING` en quote y sesión». Restaurado ⇒ verde. Línea base de las tres suites de dinero (`dyn-listing-price`, `dyn-review-retention`, `dyn-v11144`): **36/36**. La prueba compara el `amountCents` del PaymentIntent con el `totalCents` del breakdown contra el **doble** de Stripe. Contra Stripe real: **NO MEDIDO** (LIVE5-STRIPE).
- **Disparadores** `[código]`: lo nuevo desde el pentest es la poda de `ListingPriceRun` (solo tras un `daily` ok y bajo `LISTING_PRICE_LOCK_KEY`) y el turno PSA, donde `pg_try_advisory_xact_lock(91_130_103)` deja **una** corrida viva y las demás salen con `already_running` sin pedir créditos. No hay puertas nuevas: las 9 puertas de precio y la fusión de disparadores las midió el pentester (1f, 1g) y sus controladores no cambiaron más que en DI (TL-DYN-4: `listingPrices` y `priceReview` pasan a inyección explícita u obligatoria, lo que **endurece**). El turno PSA mantiene una transacción, y por tanto una conexión del pool, hasta 60 min: SEC-DYN-B2.
- Las copias de la llave K pasan al helper `variantKey` (`common/variant-key.ts`), con el mismo formato `a|b|c|d`: no cambia ninguna clave ya guardada en `ListingPrice.variantKey`.

**(2) Endpoints nuevos y roles.** `featured` (`@Public`), `jobs/featured-rotation`, los diales y `graded-estimates/budget` (`super_admin`):
sus controladores no cambian desde `d0b40182` `[MEDIDO]`. Me quedo con la matriz del pentester `[REPORTADO por pentester, 3a: 401/403
y 200 solo para super_admin, alg:none, rol alterado y token vencido]`.
**M-A (PEN-DYN-2)** `[MEDIDO]`, `settings-cross-rules-race.e2e-spec.ts` (barrera, N=10 por regla): línea base **10/10 y 10/10**. Sin
`pg_advisory_xact_lock` y validando con `this.prisma` fuera del `tx`, la regla del buylist se cumple **1/10** y la de Destacadas **0/10**,
en ROJO. Restaurado (`diff` vacío) ⇒ **10/10 y 10/10**.

**(3) Cachés públicas y sesión.** Los cuatro GET públicos con `public, max-age=30` no leen sesión `[código]`, y el pentester midió
cuerpos idénticos byte a byte con 4 identidades. El HTML de `/es` y `/es/catalog` sale `private, no-store`, y solo pone la cookie
`NEXT_LOCALE` `[MEDIDO]`. Sin cambio: I1 sigue siendo info.

**(4) CSP y nonce.** `[MEDIDO]` En `/es` y `/es/catalog`, 20 peticiones con `x-nonce`, `content-security-policy` y `-report-only`
del atacante: **el nonce del atacante no aparece en 20/20**, y los 42 `<script>` de `/es` llevan nonce.
**M-D**: sin `request.headers.set(CSP_REQUEST_HEADER, policy)` (`middleware.ts:47`) y recompilado, el nonce del atacante sale en el cuerpo
**20/20** (ROJO). Restaurado y recompilado ⇒ 0/20. La política sigue en `report-only` (`csp.ts:37`). Es **CL-1, abierta**. ⚠ El
encargo dice «report-only por decisión del dueño», pero `HECHOS.md` no tiene esa fila (grep de `csp`/`report` revisado). Hasta que
exista, CL-1 sigue siendo Media sin aceptar, igual que antes.

**(5) `/_next/image` y el residual** → §4.

**(6) `limpieza-ramas.yml`** `[código]`: solo `workflow_dispatch`, `permissions: {}`, y el job con `contents: write` + `pull-requests: read`.
Borra solo si se cumplen tres cosas: ancestro de `production`, fuera de las protegidas y de las PR abiertas, y `--force-with-lease`
al sha medido. Nunca pierde commits. Lo que queda: (d) una rama recién creada sin commits propios y sin PR **se borra** (SEC-DYN-B1),
y (e) `actions/checkout@v5` es etiqueta móvil con token de escritura (SEC-DYN-B3).

**(7) Guion PDB con G-11** `[MEDIDO]`, `pdb-limpieza.e2e-spec.ts`, bloque §DYN.1: **5/5**. G-11 aborta con la base **idéntica** cuando
otra conexión tiene `91130101` o `91130102`. Los literales del guion coinciden con las constantes, y G-7 no se dispara con la selección
del día pero sí con una `InventoryItem`. Usa `pg_try_…` después del último `LOCK` y antes de la foto: no espera, así que no deja la
foto vieja. `[código]` Todas las escrituras de `ListingPrice` (upsert, borrado de fuera de alcance, poda) van bajo `91_130_102`.

**(8) SAST y dependencias** `[MEDIDO]`. Semgrep **1.177.0** (la versión de `security-sast.yml:50`) con las 9 configs del CI sobre los
200 ficheros `.ts/.tsx/.mjs/.sh/.yml/.sql` añadidos o modificados:
- En `backend/` y `frontend/` (el alcance del gate) hay **0 ERROR**.
- Los 2 ERROR son `secrets-inherit` en `deploy.yml:243,494`: ya estaban en `production`, pasan los secretos `STRIPE_TEST_*` a un flujo interno y quedan fuera del alcance del gate.
- Las 104 WARNING: 94 son `mutable-action-tag` (SEC-DYN-B3). 4 son `no-secret-in-logs`, que revisé una por una: son conteos y claves de diales retirados, sin secretos. 6 son `non-literal-regexp`, de pruebas o ya presentes en `production`.
- Grep de secretos en las líneas añadidas: 0. `IMG_SEED` en `security/secretos-*.sha256` es un renombrado del arnés, no una fuga.
`npm audit --omit=dev`: frontend 0. Backend **0 críticas y 0 altas, 12 moderadas y 4 bajas**. Los lockfiles no cambian frente a
`production`; el aumento sobre las 4 moderadas del pentester viene de avisos publicados después (`qs` con `arrayFormat:'comma'`,
`minimatch` y `deepmerge`). Ninguno es alcanzable `[código]`: `arrayFormat`, `minimatch` y `deepmerge` dan 0 en `backend/src` → SEC-DYN-I1.

## 4. `/_next/image`: valido la aceptación del residual, con un vector más
- **Residual aceptado por el arquitecto** (`ARCHITECTURE.md:31005`): `[MEDIDO]` `images.scrydex.com/pokemon/me3-99999/large` ⇒ **200** WebP. El CDN responde 200 a cualquier id con la forma correcta, así que el número de orígenes no tiene tope.
- **SEC-DYN-M1 (nuevo, Media, frontend):** la premisa «por URL ya está acotado (2 anchos × 1 calidad × sin query)» **no se cumple**. El **fragmento** (`#…`, que el atacante manda codificado en `url=`) entra en la clave de caché y `remotePatterns` no lo mira. `[MEDIDO]` `https://images.pokemontcg.io/base2/1.png#f<n>`: **10/10 `200` y `X-Nextjs-Cache: MISS`**, y la misma cadena repetida da `HIT`. Así, **una sola** imagen válida de **cualquiera** de los dos hosts da transformaciones sin tope. Los alias `/./`, `/x/../`, `:443` y `?` vacío también pasan. Los dos primeros se normalizan (`HIT` en la segunda), y todos son un número finito; el fragmento no. En Vercel el optimizador es suyo, y si su clave incluye el fragmento está **NO MEDIDO**: lo cerrarían dos peticiones a un *preview* mirando `x-vercel-cache`.
- **Por qué no bloquea:** es coste, no datos ni dinero; `production` ya acepta cualquier query, cualquier ruta, y todos los anchos y calidades, así que publicar **reduce** la superficie. Además el interruptor la cierra entera. `[MEDIDO]` Build con `NEXT_PUBLIC_IMAGE_OPTIMIZER_KILL_SWITCH=on`: los dos hosts y la variante con fragmento ⇒ **400** «"url" parameter is not allowed». El valor raro hace fallar el build, y eso lo cubre su candado (`next-image-remote-patterns.test.ts` y 4 ficheros más: **72/72** `[MEDIDO]`).
- **El candado cobra la aceptación** `[MEDIDO]`: `check-image-optimizer-cost-reading-expiry.sh --canary` ⇒ **11/11**. Hoy da rc 0; con `--today 2026-12-01` da **rc 9**. Está en `ci.yml:546` y en `needs` del agregador (`:1137`). Mide el total de transformaciones al día, así que también recoge el abuso por fragmento. Tiene dueño (devops), fecha (2026-12-01) y candado: **la aceptación vale**. ⚠ Solo se pone rojo en el próximo push o PR desde esa fecha (`ci.yml` no tiene `schedule`). Con el ritmo actual del repo es aceptable.
- ⚠ **La alerta de gasto de Vercel** es parte de la aceptación del arquitecto y **no tiene candado**: es un ajuste del dueño en Vercel y en `HECHOS.md` no consta que esté hecha. No la pongo como condición de mi veredicto (no se puede cobrar sola y la release reduce la exposición). Va como **bandera C.6**, para la solicitud de fusión.

## 5. Hallazgos de este pase
| ID | Sev | Qué | Ubicación | Dueño | Disparador |
|---|---|---|---|---|---|
| SEC-DYN-M1 | Media (aceptada con el residual) | El fragmento `#…` multiplica las transformaciones de cualquier imagen permitida. Remedio: rechazar en el middleware un `url=` de `/_next/image` con `#`, `..`, `/./` o puerto explícito, y añadir el caso al candado | `next.config.mjs:220-242`; `middleware` (el `matcher` hoy excluye `_next`) | frontend (decide el arquitecto) | La alerta de gasto, una lectura > 1 000/día (`image-optimizer-cost-reading-expiry`) o el próximo toque de `images` |
| SEC-DYN-B1 | Baja (operativa) | `limpieza-ramas` borra una rama recién creada desde `production` sin commits ni PR (= I4-d; no se pierden commits) | `limpieza-ramas.sh:111` | devops | Antes del primer `confirmar=true` con sesiones vivas: excluir ramas con commit de cabeza de menos de 24 h, o avisar en el resumen |
| SEC-DYN-B2 | Baja | El turno PSA retiene 1 conexión del pool hasta 60 min (`lockTx`). Pool de producción: NO MEDIDO | `price-ingest.service.ts:108-114,1490` | backend + devops | Un `P2024`/timeout de pool en checkout durante una corrida PSA, o un pool ≤ 5 en Railway |
| SEC-DYN-B3 | Baja | 96 `uses:` por etiqueta móvil y 0 por sha (incluidos `gitleaks-action@v3` y `trivy-action@v0.36.0`, de terceros, con token de solo lectura). Va contra «toda dependencia externa va fijada» | `.github/workflows/*` | devops | Antes del primer `confirmar=true` de `limpieza-ramas` (token de escritura) y de cualquier job nuevo con escritura; candado tipo `runner-pin` para `uses:` |
| SEC-DYN-I1 | Info | 12 moderadas y 4 bajas en el backend (`qs`, `minimatch`, `deepmerge`), no alcanzables | `backend/package-lock.json` | devops | Los de PRE-P4 |
| PEN-DYN-I1, I3 | Info | `public` en los 400; userinfo ⇒ 500 | §2 | backend; frontend | El primer manejador público que lea sesión (I1); el próximo toque de `images` (I3) |

## 6. VEREDICTO
### ✅ **APROBADO** sobre `d5f0b38c968d57c30131ac3e1d9e25c7e3b7c283`, sin condiciones nuevas
No hay críticas ni altas abiertas. Cuatro mutaciones, cada una roja y luego verde al restaurar: M-A (PEN-DYN-2, 1/10 y 0/10), M-B
(exhibido ≠ cobrado), M-C (`pending` cobrada) y M-D (nonce, 20/20). La única media es un residual de coste que se acepta: tiene dueño,
fecha y candado medidos (`image-optimizer-cost-reading-expiry`, devops, 2026-12-01) y la release lo deja **mejor** que `production`.
Nada de lo abierto bloquea la publicación. Lo heredado (P-RL-1, CL-1, BL-42…) no cambia; sigue en el registro y en las banderas al dueño.

— SEGURIDAD (blue team / AppSec), 2026-10-31 · sha **`d5f0b38c968d57c30131ac3e1d9e25c7e3b7c283`** · **APROBADO**

---

# Veredictos recientes, compactados el 2026-10-31
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
| **CL-1** / SEC-HDR-2 / CSP-RO | **Media** | CSP en `report-only` (**[MEDIDO 2026-10-26]** `frontend/src/security/csp.ts:37`; `HECHOS.md` sigue sin fila de aceptación). Con la sesión en `localStorage`, un XSS daría una sesión de súper-admin de hasta 7 días. No se conoce ningún XSS (`grep dangerouslySetInnerHTML` = 0 en el pase `8e1b34d7`) | frontend + devops | `8e1b34d7`, 2026-10-10 (vuelta a report-only a propósito); **`d5f0b38c` 2026-10-31**: sigue `report-only` (`csp.ts:37`), nonce cerrado con mutación, sin fila en `HECHOS.md` | CSP en `enforce` según §14.3 de `DEVOPS_NOTES` + `check-csp-zap-parity.sh` rc 0. **O** el dueño lo acepta por escrito en `HECHOS.md` (hoy no hay esa fila: lo busqué) |
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

_Changelog:_ 2026-10-25 · veredicto `60250e90` APROBADO; compactado de 17 004 líneas a estado vigente + registro + índice. · 2026-10-26 · veredicto `2f5a59c0` APROBADO (DSC-1 cerrada; SEC-MED-1 abierta al encender). · 2026-10-27 · re-verificación `1b777967`: SEC-MED-1 cerrada. · 2026-10-29 · veredicto `5aeda006` APROBADO (velocidad de la portada, solo frontend); compactados los dos anteriores. · 2026-10-31 · veredicto `d5f0b38c` APROBADO (§DYN portada dinámica; PEN-DYN-2 cerrada; residual de PEN-DYN-1 + SEC-DYN-M1 aceptados con candado).

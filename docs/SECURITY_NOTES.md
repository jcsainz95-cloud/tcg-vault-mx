# SECURITY_NOTES.md — Seguridad (blue team) · estado vigente

> **Estado vigente (2026-11-01).** Último veredicto: **APROBADO** sobre **`43d9eb1032958660c9e9f740c09986d2e42a4675`** (release
> «Marketing conversión 2», rama `claude/mkt-conversion-2`, diff `fbf1a106..43d9eb10`; `fe2fee57` encima solo añade `docs/PENTEST_NOTES.md`).
> Críticas 0 · Altas 0 · Medias 0 · Bajas 1 (PEN-CNV-2 = REL7-P3, flag apagado) · Info 1 (PEN-CNV-1, aceptada por diseño).
> Antes: APROBADO `e066b0b5` (2026-10-31). Siguen heredados en «Registro vigente»: **P-RL-1**, **CL-1** (CSP `report-only`, sin fila de
> aceptación en `HECHOS.md`) y **BL-42**. ⚠ **No encender `sealed_restock_alerts` («Avísame cuando vuelva») sin doble opt-in** (§4).

---

# VEREDICTO BLUE TEAM — «Marketing conversión 2» · SHA **`43d9eb1032958660c9e9f740c09986d2e42a4675`** · 2026-11-01 · seguridad

> ## VEREDICTO: ✅ **APROBADO** sobre `43d9eb10`, sin condiciones
> 0 críticas · 0 altas. PEN-CNV-1 la rebajo a **Info** y la acepto como diseño de §MKT.A.1: por el modelo de datos, la identidad que
> revela es la del producto con el que esa misma URL estuvo publicada, y los dos filtros alternativos empeoran el oráculo. PEN-CNV-2 es
> real y es **la misma** que REL7-P3. No es alcanzable con el valor por defecto que se publica (flag `off`, la UI no pinta el formulario).
> Pero es precondición dura para encender el flag. Cuatro ablaciones propias: las cuatro rojas sin su control y verdes al restaurarlo.

## 1. Alcance y procedencia
- **Copia** `[MEDIDO]`: `git archive 43d9eb10` del árbol entero en `…/scratchpad/sec-mkt2/tree`, `npm ci` propio del backend. Stack mío:
  `stack-native.sh up --infra --seed` + `up` con `STACK_EXPECTED_SHA=43d9eb10…`, backend en :3897, s3 en :9897, BD `tcg_sec_mkt2` (rol
  propio) y Redis db 12. Solo backend: el frontend no se levantó, porque los vectores de §MKT.A.1 son de API y los gates de QA y
  tester-e2e corrían a la vez (:3300/:3399, sin tocarlos). `verify:head 43d9eb10` ⇒ «VERIFICADO». Carga entre 1,3 y 3,9 con 4 CPU.
  ⛔ No toqué Vercel, Railway ni `tcghunt.mx`. Al cerrar: apagué por PID (8756/8773/8774 backend, 28138 s3), eliminé la BD y el rol
  con `DROP … WITH (FORCE)`, vacié Redis db 12 y borré la copia, `node_modules` y el venv de semgrep. Logs en `…/scratchpad/sec-mkt2/logs/`.
- **Delta** `[MEDIDO]`: 71 ficheros. En backend solo cambia `sealed-catalog.service.ts` (+ su spec de integración). Los lockfiles no cambian.

## 2. Consolidación del pentester (`docs/PENTEST_NOTES.md`, pase `43d9eb10`)
| ID | Sev pentest | Sev blue team | Estado medido |
|---|---|---|---|
| **PEN-CNV-1** (V1a-V1d, V3) | Baja | **Info, aceptada** | Reproducido. Ver §3 |
| **PEN-CNV-2** (V6) | Baja | **Baja** (= REL7-P3, abierta) | Reproducido. Ver §4 |
| V2, V4, V5 | — | — | Coincido (caja blanca). No re-medí `/nosotros`, el canonical ni el consentimiento en vivo, porque no levanté el frontend |
| Heredados | | | Sin cambios en este delta. PEN-DYN-2 sigue cerrada (veredicto `d5f0b38c`) |

## 3. PEN-CNV-1 · ¿es aceptable revelar el producto de una pieza en bóveda a quien tenga su UUID?
**Sí.** Medido en vivo sobre seis piezas sintéticas en mi BD.
- **Matriz** `[MEDIDO]` (`detail-matrix.txt`):
  - Pieza publicada ⇒ 200.
  - Pieza en bóveda de cliente, de un producto con existencia ⇒ 200 con el grupo de **ahora**: el representante es la pieza publicada y la pedida no sale.
  - Pieza en bóveda de un producto sin existencia ⇒ 200 agotada, con nombre e imagen.
  - Pieza de plataforma `in_stock` nunca publicada ⇒ 200 agotada, con nombre.
  - `raw` e inexistente ⇒ 404.
  - Bóveda, `withdrawn` e `in_stock` del mismo producto dan **el mismo cuerpo**, byte a byte, si se enmascara `representativeItemId`: md5 idéntico 3/3 (`cnvb3-*.json`). CNV-B3 se sostiene.
- **¿De dónde sale un UUID de pieza de cliente?** `[MEDIDO]` (`uuid-sweep.txt`, `vault-idor.txt`):
  - Público: 0 apariciones de mis UUID de bóveda o intake en `featured`, `cards`, `sitemap`, `sealed` (rejilla), `sets`, `facets` ni `accessories`. Esos listados solo llevan la pieza publicada.
  - Fichas de piezas no publicadas: `GET /catalog/listings/:id` ⇒ 404.
  - Bóveda: solo el dueño ve sus UUID. `customer2` recibe 0 en `vault/holdings` y `vault/sealed`, y 403 en `vault/holdings/<id ajeno>` (= RL-INFO-5).
  - `[código]` El frontend enlaza `/sellado/<id>` solo con `group.representativeItemId` (`SealedShelf.tsx:60`, `SealedShopView.tsx:239`, `sitemap.ts:63`, `seo.ts:44`). El correo de reposición enlaza la pieza **vendible** más barata (`sealed-restock-notify.service.ts:300`). El admin no enlaza la ficha pública.
- **Por qué la identidad no es un dato nuevo** `[código]`:
  - Toda `InventoryItem` nace `ownerType: 'platform'`: intake (`inventory.service.ts:1435`) y buylist (`buylist.service.ts:8018`).
  - Solo pasa a `customer` por dos caminos: la reserva del checkout, que exige `platform` + `listed|in_stock` (`orders.service.ts:871`), o la reposición de un caso, con identidad **idéntica** a la de la pieza perdida (`replacement-case.service.ts:628-635`).
  - Quien tiene el UUID de una pieza en bóveda es su dueño, el staff, o alguien que lo vio cuando esa URL estaba publicada con **ese mismo producto**.
  - La respuesta no dice dueño, estado ni precio. Antes del cambio, el 404 de una pieza vendida ya decía «ya no está a la venta». Hoy eso se ve en `listings` y en la rejilla, que es pública.
- **Ya existía en otra ruta** `[MEDIDO]`: con `sealed_value_trend=on`, `GET /catalog/sealed/<id-bóveda>/value-history` (sin cambios en este diff) devuelve `name` y `tcgplayerProductId` de cualquier pieza sellada, también de bóveda e intake: 3/3 (`value-history-V2.txt`). El estado de ese flag en producción: **NO MEDIDO** (por defecto `off`).
- **¿Debió §MKT.A.1 limitarse a piezas que alguna vez se publicaron?** No con los filtros propuestos:
  - (a) `ownerType: 'platform'` volvería a dar 404 a las URL indexadas de piezas compradas **para bóveda**, mientras que las compradas con envío directo siguen en `platform`. Esa diferencia entre 404 y 200 es justo el oráculo «compró para bóveda o para envío» que CNV-B3 prohíbe.
  - (b) `firstListedAt` no nulo: la m93 lo **rellenó con `createdAt` en toda fila previa** (`m93_portada_dinamica/migration.sql:44`), así que no distingue «se publicó alguna vez» en las filas anteriores a m93.
  - Solo sería útil, como defensa en profundidad, en el caso que el pentester no cubre: una pieza de **intake nunca publicada** (sin `firstListedAt`) cuyo UUID salga del admin. Ahí revelaría un producto aún no anunciado.
  - **Corrección mínima si se activa el disparador** (backend, sin cambio de contrato de forma): en `sealedDetail`, rama agotada, 404 si `requested.firstListedAt == null`, con una prueba hermana de CNV-B4. Disparador: el primer producto «secreto hasta el anuncio» que entre a inventario antes de su anuncio, o el primer enlace del admin a la ficha pública.
  - El arquitecto **no tiene que cambiar §MKT.A.1** hoy. Si se activa, la fila «inexistente» de la tabla gana «o nunca publicada (desde m93)».

## 4. PEN-CNV-2 · «Avísame» con correo ajeno: no se enciende sin doble opt-in
`[MEDIDO]` (`restock-live.txt`):
- Con flag `off` ⇒ 404.
- Con `on`: cuatro correos de terceros aceptados con `userId` nulo, y 429 a partir de la 6.ª petición por minuto de la misma IP (la del flag `off` cuenta).
- **Con `X-Forwarded-For` rotatorio** ⇒ 5/5 aceptadas sin 429. Local, sin edge: es P-RL-1. Así que el tope por IP **no** es una cota fiable. Quedan dos topes: 5 pendientes por correo, y el envío solo al reponer.
- El riesgo real no es la molestia a una víctima. Es que un atacante apunte miles de correos y, en la primera reposición, la tienda mande correo no solicitado en masa **desde el mismo dominio que los correos de pedidos y pagos**. Eso pone en juego la reputación de entrega.
- Es exactamente **REL7-P3**, que ya está en el registro con su disparador vencido (`sk_live_`).
- No es alcanzable en este release: el valor por defecto es `off` (`settings.constants.ts:548`) y `SealedDetailView.tsx:304` solo pinta el formulario con `restockEnabled`. Por eso no bloquea, y por eso **no** lo pongo como condición del veredicto.
- **Precondición para encender el flag** (backend):
  - Doble opt-in para invitados: la fila nace `unconfirmed` y solo cuenta tras abrir un enlace firmado.
  - Candado: el validador de `sealed_restock_alerts` (`settings.constants.ts:1255`) rechaza `on` mientras no exista la confirmación, con su prueba.
  - Estado del flag en producción: **NO MEDIDO**. Lo cierra el dueño mirando el interruptor en su panel de ajustes.

## 5. Ablaciones propias (una por control; cada una restaurada y comprobada con `cmp`)
| # | Control quitado | Rojo | Restaurado |
|---|---|---|---|
| M-1 | `productType: 'sealed'` en `sealedDetail` (`:530`) | CNV-B4 ✕ (1/5 rojas) | 5/5 |
| M-2 | `ownerType` de la pieza pedida en el DTO agotado (`:392`) | CNV-B3 ✕ (1/5) | 5/5 |
| M-3 | `status: 'listed'` del grupo (`:538`) ⇒ entran al grupo piezas no vendibles | CNV-B2 ✕ (1/5). CNV-B1 no la caza: las piezas vendidas no tienen precio y `loadPricedSealed` las descarta | 5/5 |
| M-4 | Interruptor de `subscribeRestock` (`:658`) | En vivo, con flag `off`: **3/3 en 202** y 3 filas creadas. Unitaria «restock con dial OFF» ✕ (1/14) | En vivo 3/3 en 404 · 14/14 |

`restart:backend` dio «verificado (43d9eb10)» con M-4 en el fuente. Es SEC-MKT2-I3, ya registrado (en una copia sin `.git` no ve ediciones).

## 6. SAST, secretos y dependencias `[MEDIDO]`
- **Semgrep** 1.177.0 con las 9 configs de `security-sast.yml` (1 150 reglas cargadas, 217 aplicables) sobre los 59 `.ts/.tsx` del diff ⇒ **0 hallazgos** de cualquier severidad. Hubo 6 parseos parciales, todos en tests o `mock/fixtures.ts`.
- **Secretos:** 0 coincidencias en las 3 343 líneas añadidas. Busqué claves Stripe, `whsec_`, AWS, JWT, Google y Meta, URL con contraseña, asignaciones `secret|token|password` y correos personales.
- **Dependencias:** `npm audit --omit=dev` del backend da 0 altas y 0 críticas (12 moderadas y 4 bajas, todas conocidas: REL7-P1).

## 7. VEREDICTO
### ✅ **APROBADO** sobre `43d9eb1032958660c9e9f740c09986d2e42a4675`, sin condiciones
- No queda ningún hallazgo crítico ni alto abierto.
- PEN-CNV-1 queda aceptada como Info (diseño de §MKT.A.1), con disparador y corrección mínima en §3.
- PEN-CNV-2 / REL7-P3 sigue abierta como Baja (backend). No es alcanzable con lo que se publica, y es precondición dura para encender `sealed_restock_alerts`.
- Lo heredado no cambia: P-RL-1, CL-1 y BL-42.

— SEGURIDAD (blue team / AppSec), 2026-11-01 · sha **`43d9eb1032958660c9e9f740c09986d2e42a4675`** · **APROBADO**

---

# Veredictos recientes, compactados el 2026-11-01
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

_Changelog:_ 2026-11-01 · veredicto `43d9eb10` APROBADO (Marketing conversión 2; PEN-CNV-1 rebajada a Info y aceptada; PEN-CNV-2 = REL7-P3; `e066b0b5` compactado). · 2026-10-31 · veredicto `e066b0b5` APROBADO (Marketing/SSR SEO Ola 2; PEN-MKT-1 rebajada a Info, PEN-MKT-2 = SEC-MKT2-B1; §DYN compactado). · 2026-10-25 · veredicto `60250e90` APROBADO; compactado de 17 004 líneas a estado vigente + registro + índice. · 2026-10-26 · veredicto `2f5a59c0` APROBADO (DSC-1 cerrada; SEC-MED-1 abierta al encender). · 2026-10-27 · re-verificación `1b777967`: SEC-MED-1 cerrada. · 2026-10-29 · veredicto `5aeda006` APROBADO (velocidad de la portada, solo frontend); compactados los dos anteriores. · 2026-10-31 · veredicto `d5f0b38c` APROBADO (§DYN portada dinámica; PEN-DYN-2 cerrada; residual de PEN-DYN-1 + SEC-DYN-M1 aceptados con candado).

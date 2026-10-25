# SECURITY_NOTES.md — Seguridad (blue team) · estado vigente

> **Estado vigente (2026-10-25).** Último veredicto: **APROBADO** sobre **`60250e90d0f12f375b24a6b9dbc4599854fddb87`**
> (rama `claude/sesiones-pendientes-alcances-cznucn`; release «Envío v2 / buylist·solicitud / medición b5-b6»).
> Críticas 0 · Altas 0 abiertas en el delta. Lo heredado sigue abierto y está en «Registro vigente» (abajo):
> **P-RL-1** (Media, C6 sin cerrar), **CL-1** (CSP en `report-only` con la tienda ya cobrando en real), **BL-42** (INE sin purga).
> Medición Fase 2: **apagada** y sin poder encenderse (MKT-F2-3, MKT-F2-4).
> **Compactado el 2026-10-25** (DOC-SIZE: 17 004 → este fichero). Los 81 veredictos anteriores, íntegros, siguen en git:
> `git show 60250e90:docs/SECURITY_NOTES.md`. Aquí quedan el veredicto vigente, lo que sigue abierto o aceptado y un índice.

---

# VEREDICTO BLUE TEAM — **Release «Envío v2 (regla A) / buylist·solicitud / medición b5-b6»** · SHA **`60250e90d0f12f375b24a6b9dbc4599854fddb87`** · 2026-10-25 · seguridad

> ## VEREDICTO: ✅ **APROBADO** sobre `60250e90`, sin condiciones
> **0 críticas · 0 altas · 0 medias · 0 bajas abiertas en el alcance · 3 info nuevas (aceptadas).**
> El pase del pentester sobre `230b9bd3` (0/0/0, 1 baja) queda consolidado. **Su única baja, el truco del accesorio, está CERRADA en
> `60250e90`.** El dueño eligió la regla A (`HECHOS.md`, fila «Envío gratis desde MX$4,000 para CUALQUIER pedido (opción A)», 2026-10-25), y lo
> comprobé en el código y con una mutación.

## Procedencia (O-9 / O-14)
- **Copia del árbol ENTERO** anclada al sha: `git archive 60250e90 | tar -x` en `scratchpad/seg-rel3/tree/`, con `node_modules` de `backend/`
  por enlace (el árbol vivo estaba en `60250e90` y limpio, lo medí con `git rev-parse HEAD` y `git status`). Sin stack, sin BD, sin navegador
  (QA corría Playwright), sin credenciales y sin tocar producción. Load ≈ 7-8 con 4 CPU. Las pruebas que corrí son deterministas, así que la
  carga no cambia el resultado. **La copia está borrada**; los logs quedan en `scratchpad/seg-rel3/logs/`.
- **Alcance:** el delta `230b9bd3..60250e90` (25 ficheros, 5 de `backend/src`) más el pase del pentester sobre `230b9bd3`. El árbol de
  producción (`bc288024` es el merge de GitHub de `e77e74ee`, sin diff) es ancestro de `230b9bd3`, así que pentester + este pase cubren
  todo lo que entra en la publicación desde lo ya auditado (`803c4298`).
- **[MEDIDO] Suites:** `test/shipping-rule.spec.ts` + `src/modules/orders/be27-aggregate-overflow.spec.ts` ⇒ **2/2 suites, 54/54**.
- **[MEDIDO] Mutaciones** (sobre la copia, restauradas con `.bak`; `diff -r` contra el árbol vivo sale vacío; N=1 cada una porque son
  deterministas):

| Mutación | Qué reintroduce | Resultado |
|---|---|---|
| M1 `free = kind === 'sealed' && S ≥ T` | la regla anterior: el truco del accesorio | **7/54 rojas** |
| M2 `quoteBreakdowns` sin `representableOrThrow` | 500 en vez de 422 en el quote | **1/54 roja** (TL-ENV-4) |
| M3 `direct_ship_cards_fee_cents` sin tope (`≥ 0`) | dial > Int32 | **1/54 roja** (ENV-5) |
| M4 `freeShippingApplied = free` (sin `¬bigBox`) | «gratis» con caja grande cobrada | **1/54 roja** |

- **[MEDIDO]** `scripts/check-secret-defaults.sh` ⇒ rc 0. `grep` de formas de clave (`sk_live_`, `rk_live_`, `whsec_`, `AKIA`, PEM) en el diff ⇒ 0.
  El delta no toca `package*.json` ni lockfiles, así que no corrí `npm audit`: la exposición de dependencias es la del pase `9cc26064` (PRE-P3, PRE-P4).
- **Del orquestador / otros roles, NO medido por mí:** suites de integración `envio-v2.e2e-spec.ts` y `accessories-checkout.e2e-spec.ts` (necesitan BD)
  y las pruebas de frontend (`DirectShipSection.test.tsx`, `shipping-rule.parity.test.ts`). Las leí, pero no las ejecuté.

## 1. Consolidación del pentester (`docs/PENTEST_NOTES.md`, pase `230b9bd3`)

| Vector del red team | Su resultado | Mi lectura en `60250e90` | Estado |
|---|---|---|---|
| Total lo calcula el servidor; el PI cobra `breakdown.totalCents` | PASA | Confirmo: `guest-checkout.service.ts:461` usa `outcome.breakdown.totalCents`; el DTO solo trae identidades | ✅ |
| Umbral sobre `S`, no sobre el total | PASA | Confirmo: `shipping-rule.ts:107` compara `subtotalCents` con `freeFromCents` | ✅ |
| quote ↔ session no vincula dinero | PASA | Confirmo: `session` recalcula clase, `S`, caja y desglose dentro de la tx (`:377-384`) | ✅ |
| Sellado sin precio / precio 0 | PASA | Fuera del delta; sigue igual | ✅ |
| Reembolso con `E = 0` | PASA | Fuera del delta. Ver SEC-ENV-2 (info) | ✅ |
| `GET /checkout/shipping-rule` | PASA | Confirmo: `guest-orders.controller.ts:50-56`, `@Public`, 60/min, `max-age=300`, tres cifras públicas | ✅ |
| Diales solo `super_admin` | PASA (403 NO MEDIDO en vivo) | Confirmo por código: `settings.controller.ts:37-39` `@MoneyOut()` de clase y `MoneyOutGuard` APP_GUARD (`app.module.ts:105`); el guard audita `money_out.blocked` y lanza 403 si `role ≠ super_admin` | ✅ (en vivo: NO MEDIDO) |
| **BAJA · accesorio barato ⇒ envío gratis** | a confirmar por el dueño | **CERRADA.** El dueño decidió la regla A. `directShipFeeOf` (`shipping-rule.ts:106-108`): `free = S ≥ T` sin mirar la clase, y `ruleFee = free ? 0 : (cards_only ? E_cartas : E_sellado)`. Con S ≥ T, añadir un accesorio ya no cambia lo cobrado: era 0 y sigue en 0. Bajo el umbral, añadirlo **sube** el envío de MX$100 a MX$175, nunca lo baja. Lo fija la mutación M1 (7 rojas) | ✅ **cerrada** |
| `/buylist/solicitud` (CLABE/INE), medición, b5/b6 | PASA | El delta no toca esos ficheros (`git diff --stat`); su lectura sigue valiendo | ✅ |

## 2. Revisión del delta, con lente de dinero

**¿Se puede manipular la clase o el umbral desde el cliente? No.**
- El umbral `T` es `direct_ship_free_from_cents`. Se lee de `ConfigSetting` (`guest-checkout.service.ts:232-237`) y solo se escribe por
  `PUT /admin/settings` (`super_admin`, ver arriba). Ningún DTO del checkout lo trae.
- La clase sale de `productType` de las piezas cargadas de la BD y de los renglones o paquetes **aceptados** por el servidor
  (`part.loose`, `part.bundles`; en el quote, `acc.accessoryLines`, `acc.energyBundles`). Un `deckPull` sin paquete no cuenta (TL-ENV-R2).
- Con la regla A, la clase ya **no decide si el envío es gratis**. Solo decide la tarifa bajo el umbral, y lo que el cliente puede hacer
  (añadir un accesorio) la sube. Para que el cliente gane algo, tendría que hacer que un pedido con sellado pareciera `cards_only`, y eso
  depende de `productType` en la BD, no de la petición.
- `S` incluye accesorios (`subtotalCents + part.subtotalCents`, `:379`), como dice el contrato. Inflar `S` con mercancía para cruzar el
  umbral es comprarla: legítimo, y la venta es final.

**¿El envío cobrado coincide con el quote? Sí, cuando el carrito y los diales no cambian entre las dos llamadas.**
- Las tres rutas pasan por la misma función pura: `quoteBreakdowns` (`:836`), `breakdownFor` (`:854`) y la rama con accesorios de `session`
  (`:381`). Las tres usan `directShipFeeOf(kind, S, dials, choice)` y después `computeDirectShipBreakdown`. No hay una segunda fórmula.
- Si el carrito o un dial cambian entre el quote y la sesión, se cobra lo que ve `session`. Ese es el diseño, y en ese caso el
  PaymentIntent se crea con ese mismo total.
- El caso de orden propia congelada lo tiene abierto el techlead como TL-ENV-2: el `breakdown` sale de la orden y el `shippingRule`
  (aviso del umbral) de los diales vivos. Lo cobrado es el congelado, que es también lo que muestra el `breakdown`. Solo el **aviso**
  puede contradecirlo. No es dinero, es coherencia de pantalla: queda en backend con su ficha.
- La pantalla ya no puede decir «envío gratis» si cobra la caja grande: `freeShippingApplied = free && !bigBox` (`shipping-rule.ts:114`),
  y en el DTO solo cuando `kind ≠ null`. Lo fija M4.

**¿Hay desbordamiento? No.**
- Los diales de tarifa ahora usan `validateIntRange(0, MAX_CENTS)` (`settings.constants.ts:1291-1292`; `shipping-dials.ts:137-140`, que exige
  entero, `≥ min` y `≤ max`). El umbral ya era `1..MAX_CENTS`. `MAX_CENTS = 2 147 483 647` (`money.ts:38`) = Int32, la columna `Order.shippingFeeCents`.
- `S + E` puede seguir sin caber en Int32 aunque cada dial quepa. Las tres rutas lo traducen a **422 `AMOUNT_TOO_LARGE`** con la fuente única
  `orders.representableOrThrow`: el quote (`:839`, nuevo), `breakdownFor` (`:860`) y la sesión con accesorios (`:383`). No se recorta (eso sería
  cobrar de menos) y no queda un 500. Lo fijan M2 y M3.
- El contrato lo declara (`API_CONTRACT` v1.109.4 §0 «Errores» y §4-G.1/§4-G.12 v1.109.3), así que código y contrato coinciden.

**M-91** (`prisma/migrations/20261108120000_m91_envio_v2_dials`) no cambia en el delta: viene de `230b9bd3` (`c904ace4`). Lo leí: solo datos,
siembra 10000/17500/400000 (dentro de rango), `ON CONFLICT DO NOTHING` (no pisa un dial escrito antes) y no copia `shipping_fee_cents`. La
reversa está documentada en la cabecera. No es dinero saliente y no toca PII. M-91 todavía **no** está en producción (`c904ace4` no es
ancestro de `origin/production`): entra con esta publicación.

**Frontend (delta):** `DirectShipSection` ya no envía 0 cuando el campo está vacío (TL-ENV-R1): un campo inválido bloquea Guardar y no viaja.
En cualquier caso, el servidor valida. El mock de envío (`lib/mock/shipping-rule.ts`) solo corre con `NEXT_PUBLIC_USE_MOCKS=true`, y el
despliegue hornea `false` (`.github/workflows/deploy.yml:286`). `ShippingFeeHint`, `GuestCheckoutView` y `CheckoutPayBar` solo pintan:
no hay `dangerouslySetInnerHTML` en el delta.

## 3. Hallazgos nuevos (todos Info, aceptados)

| ID | Sev | Qué | Ubicación | Dueño | Disparador |
|---|---|---|---|---|---|
| SEC-ENV-1 | Info | El comentario del umbral dice «0 regalaría todo envío **con sellado**». Con la regla A regala **todo** envío. El validador está bien (`1..MAX_CENTS`); solo el comentario quedó viejo | `settings.constants.ts:1290` | backend | El próximo toque del fichero |
| SEC-ENV-2 | Info | Un pedido que entró con `S ≥ T` (envío 0) no cobra envío después de un reembolso parcial (pieza faltante o dañada), aunque lo que queda baje del umbral. Como mucho son MX$175 por pedido, y el reembolso lo inicia el operador, no el cliente. Es regla de negocio, no un hueco | `money.ts` `orderRemainingRefundComponents` (pentester, vector 1) | product-owner → arquitecto | Que existan devoluciones iniciadas por el cliente, o que la merma por reembolso parcial se vea en el P&L |
| SEC-ENV-3 | Info | `getNumber` no vuelve a validar al leer (clase D-2 / `P-CFG-1`). Un dial `direct_ship_*` mayor que `MAX_CENTS` escrito antes del tope sobreviviría a M-91 (`DO NOTHING`). **Falla cerrado:** quote y sesión dan 422, no cobran. En producción esas claves aún no existen (M-91 no ha corrido), así que hoy no puede pasar | `guest-checkout.service.ts:232-237` | backend | Un nuevo escritor de `ConfigSetting`, o un 422 `AMOUNT_TOO_LARGE` en los registros |

**Lo que no medí (NO MEDIDO):** el 403 en vivo de `PUT /admin/settings` para `vault_operator` (se cierra con sesión de operador ⇒
`PUT {direct_ship_sealed_fee_cents:0}` ⇒ 403 + fila `money_out.blocked`); las suites de integración y de frontend del delta; el comportamiento
contra Stripe real.

## 4. VEREDICTO
### ✅ **APROBADO** sobre `60250e90d0f12f375b24a6b9dbc4599854fddb87`, sin condiciones
- En el alcance (delta `230b9bd3..60250e90` más el pase del pentester): **0 críticas, 0 altas, 0 medias, 0 bajas abiertas**, 3 info aceptadas.
- La baja del pentester está **cerrada** por la regla A: lo comprobé en el código y con la mutación M1.
- El dinero del envío no se puede manipular desde el cliente. Quote y cobro usan la misma función. El desbordamiento da 422, no 500.
- **Mínimo para seguir aprobado:** nada en este alcance. Lo heredado (abajo) no lo introduce este delta. Mi veredicto no pone
  condiciones nuevas, pero tampoco lo cierra: ver «Banderas».

— SEGURIDAD (blue team / AppSec), 2026-10-25 · sha **`60250e90d0f12f375b24a6b9dbc4599854fddb87`** · **APROBADO**

---

# Registro vigente — lo abierto y lo aceptado que sigue en pie (consolidado el 2026-10-25)

> Cada fila dice **qué veredicto la midió por última vez**. Si no la re-medí hoy, lo dice. El detalle está en
> `git show 60250e90:docs/SECURITY_NOTES.md` (busca el ID).

## A. Abierto (no lo introduce este release; pesa porque la tienda ya cobra en real)
`HECHOS.md:16`, 2026-10-16: «LA TIENDA YA ESTÁ EN VIVO EN MODO REAL DE STRIPE», afirmado por el dueño y NO medido por el orquestador.

| ID | Sev | Qué | Dueño | Última medición | Cierre |
|---|---|---|---|---|---|
| **P-RL-1** | **Media** (era Alta antes de C7) | El tope por IP se puede esquivar rotando `X-Forwarded-For` si el edge de Railway pasa el valor del cliente. El tope **por cuenta** (C7: 5 intentos, y luego 429) sí protege el login (pentester, `c62621e6`). Queda la evasión del tope por IP en endpoints públicos: scraping (BMK-1) y DoS de la ruta de cobro (SB-B3). Clasifico Media, como en `c62621e6` §6. El pase `8e1b34d7` copió «Alta» de antes de C7 | devops | 2026-10-10: ronda con XFF rotatorio, 6×401 sin 429; **falta la ronda de control** (`HECHOS.md:168`) | C6 completo (§85.4 de `DEVOPS_NOTES`), con proporción N/N, en ventana autorizada por el dueño |
| **CL-1** / SEC-HDR-2 / CSP-RO | **Media** | CSP en `report-only` (**[MEDIDO hoy]** `frontend/src/security/csp.ts:37`). Con la sesión en `localStorage`, un XSS daría una sesión de súper-admin de hasta 7 días. No se conoce ningún XSS (`grep dangerouslySetInnerHTML` = 0 en el pase `8e1b34d7`) | frontend + devops | `8e1b34d7`, 2026-10-10 (vuelta a report-only a propósito) | CSP en `enforce` según §14.3 de `DEVOPS_NOTES` + `check-csp-zap-parity.sh` rc 0. **O** el dueño lo acepta por escrito en `HECHOS.md` (hoy no hay esa fila: lo busqué) |
| **CL-3** | Media | Evidencias «antes de `sk_live_`»: C6, DAST `full` sellado sobre el sha de producción, C3 = 0, simulacro de restauración con las claves `PII_*` fuera de Railway | devops + dueño | `c62621e6` (2026-10-05); después **NO MEDIDO** | Los cuatro resultados en `DEVOPS_NOTES §85`, con fecha y sha |
| LIVE5-STRIPE | Media | La lógica de reembolso SPEI (`chargeState`, `to-manual`) solo se probó contra un doble de Stripe | backend + pentester | `8e1b34d7` | Pasada en Stripe modo prueba (CS-1…CS-6) |
| **BL-42** (caminos 1 y 3) | **Media** | INE sin ancla de purga ⇒ retención indefinida | backend + dueño | `c62621e6` | ⚠️ La primera solicitud ARCO, o la regla 7 encendida |
| S-M4P-A | Media | `RolesGuard` falla ABIERTO y el endpoint PII-denso de `admin-shipments` no tiene candado de regresión | backend | `5e6f2ee` (2026-09-22); después **NO MEDIDO** | El primero de: tocar ese controlador, darle el módulo al modelo barato, o el próximo release (**ya vencido**: lo re-enruto) |

**Cerrado desde la última consolidación (medido hoy):** CL-2 / P-GL-2 (`security/gitleaks.toml:193-230`: sin exención por ruta de `docs/`,
con canario). C-SEC-1/C-SEC-2/SEC-CS-C del Card Show: **anuladas**, porque se retiró el escaneo de patrocinador (`93a8f213`; el dueño dijo que no hay
nombre confidencial, `docs/specs/CARDSHOW_LANDING_ESTADO.md:146`). `scripts/check-ci-ok.sh --static` ⇒ rc 0 (29 jobs en `needs`).
C-SEC-3: los secretos del Card Show están documentados (`DEVOPS_NOTES.md:11-12`) y fallan cerrados en runtime; que estén cargados en Railway: **NO MEDIDO**.
MKT-TL2, SEC-MKT-1/2/3, CS-RT-1, C7, CL-2: cerrados.

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
3. **RL-INFO-2:** el plazo de «30 días con dinero real» vence hacia el **2026-11-15**, contado desde el 2026-10-16 que declaraste en
   `HECHOS.md:16` (NO MEDIDO). Después tocan 2FA y re-autenticación para el súper-admin.
4. Siguen vigentes: pentest de un tercero + bug bounty (lo aceptaste para empezar, `HECHOS.md:71`; recomiendo contratarlo dentro de los
   primeros 30 días); revisión legal del aviso de privacidad provisional, de la custodia y de INE/CLABE (BL-42); y antes de encender la
   medición, revisión legal de GA4/Meta y decidir si un analista externo verá b1/b2 (SEC-MKT-4).

---

# Índice de veredictos anteriores (texto íntegro: `git show 60250e90:docs/SECURITY_NOTES.md`)

| Fecha | SHA | Pase |
|---|---|---|
| 2026-10-23 | `803c4298` | Re-medición MKT-TL2 (R3b/R4, prueba 3) · MKT-TL9 · SEC-MKT-2/3 · QA-REL-1/2/3 |
| 2026-10-21 | `af37ea5` | Card Show M-90 (Magic 5.º juego · GET /card-show/tournament/count · cupo confirmed+checked_in) |
| 2026-10-19 | `e77b9612` | RELEASE Panel de Marketing · Medición Fase 2 (APAGADA) · SEO/GEO · UTM primer toque · m81–m86 |
| 2026-10-18 | `5049a34` | Delta CSP mapa Card Show (§CARDSHOW) |
| 2026-10-17 | `7cc18db` | Card Show RELEASE M-84..M-89 (§CARDSHOW) |
| 2026-10-17 | `f0c038b` | Card Show landing / captación de PII (§CARDSHOW) |
| 2026-10-16 | `e454262` | «P&L Finanzas» |
| 2026-10-13 | `cb66e1f` | sellado-display (opción A, cierre de clase) |
| 2026-10-07 | `37f7a450` | P-DB-LIMPIEZA v2.1 «también se borra el inventario» |
| 2026-10-06 | `37f7a450` | ~~P-DB-LIMPIEZA v1~~ SUSTITUIDO por el veredicto v2.1 sobre 37f7a450 (arriba) |
| 2026-10-07 | `15dffc9a` | STREAM «Publicar sin ubicación» (§M1-SU, SU.1…SU.9, SU.3-R; ARCHITECTURE §4.65) |
| 2026-10-06 | `c78f8a24` | RELEASE «Analítica de ventas del dueño» (§AN) |
| 2026-10-06 | `64877aad` | RELEASE «Buylist con guía Skydropx de entrada» (BSD) |
| 2026-10-05 | `c62621e6` | RELEASE «listo-real» (antes del paso a COBRO REAL) |
| 2026-10-04 | `0363f7e2` | REVISIÓN DE DISEÑO de la errata v1.80.12.9 (control del gasto §Z y cierres C-14…C-18) (API_CONTRACT §M4-SHIP.1 |
| 2026-10-04 | `2612064e` | REVISIÓN DE DISEÑO de la errata v1.80.12.8 (el folio nuestro), antes de D2c (API_CONTRACT §M4-SHIP.19.28; ARCH |
| 2026-10-04 | `eade24d3` | REVISIÓN DE DISEÑO de las erratas v1.80.12.6 y v1.80.12.7, antes de D2c (API_CONTRACT §M4-SHIP.19.26, §M4-SHIP |
| 2026-10-04 | `ace57032` | REVISIÓN DE DISEÑO del delta Skydropx antes de D2c (fila «🔒 Revisión» de API_CONTRACT §M4-SHIP.19.19.15; v1.80 |
| 2026-10-04 | `b688bb5d` | STF «Usuarios de back-office sin correo» (v1.80.9 + v1.80.9.1, M-63) y pase RETROACTIVO de la PR #69 (precios  |
| 2026-09-29 | `a3cde51` | FRENTE B · PAQUETE DINERO (tope del bounty · SEC-SETTLE-LATE · SSL-R1 · SK-5 · guardarraíl BG · errata v1.80.2 |
| 2026-09-22 | `5e6f2ee` | M4-PREP «Pedidos a preparar» (reproyección de SOLO LECTURA de GET /admin/shipments/picking-list) |
| 2026-09-19 | `—` | NOTA DE RESIDUALES ACEPTADOS — DECKS-META FASE 2 · AUTO-FETCH (fix pass) · rama claude/be-decksmeta-f2 |
| 2026-09-19 | `d77eb699` | DECKS-META FASE 1 · BACKEND (disponibilidad/legalidad + endpoints público+admin) |
| 2026-09-19 | `74d77aa9` | BOUNTIES Q1+Q2 |
| 2026-09-18 | `604f7622` | M11 · CIERRE DE DEUDA DEL SELLADO (SEC-M11-3/-4/-5) |
| 2026-09-18 | `81b9e241` | P-53 CIERRE · ALTO-4 (F4/F5 delegan al lote) · FRESCURA EFECTIVA EN TODA RUTA DE DINERO |
| 2026-09-18 | `b884e827` | GATE PII · DEGRADAR clabeSnapshotEnc EN adminGet (buylist) |
| 2026-09-18 | `12927edd` | H-PERF-1 · PODA DEL HISTÓRICO DE PriceReference (ZONA MONEY) |
| 2026-09-17 | `fafe7461` | M11 · SELLADO (money + admin) |
| 2026-09-14 | `da6a237` | CIERRE DE RELEASE |
| 2026-09-12 | `8f8c35c` | (RE-EMISIÓN) — frente PII / identidad |
| 2026-09-12 | `8aeec21` | frente PII / identidad (P-78 · §M6-K «ver la INE sin perder el rastro») |
| 2026-09-11 | `5d2c62b` | release Stream B «Lo que se rompe con el dinero» |
| 2026-09-11 | `abecf73` | release «Stream A + andamiaje de CI» |
| 2026-09-11 | `d6aca64` | RE-candidato d6aca64 (≡ tip remoto 26b2c58) |
| 2026-09-11 | `0417da1` | RE-candidato 0417da1 |
| 2026-09-10 | `88c48c7` | PASE BLUE TEAM — candidato 88c48c7 |
| 2026-09-08 | `6055f82` | PASE BLUE TEAM — candidato 6055f82 |
| 2026-09-07 | `9c186ff` | PASE BLUE TEAM — candidato 9c186ff |
| 2026-09-07 | `c6b999a` | GATE DE SEGURIDAD |
| 2026-09-06 | `—` | GATE DE SEGURIDAD · doble-pago SPEI (P1) + residual de dinero saliente (BL-35 eje 2) |
| 2026-08-29 | `—` | GATE DE SEGURIDAD · «valor estimado si se gradea» + M-43 (refKind) |
| 2026-08-28 | `—` | GATE DE RELEASE · FUSIÓN curva v2 × tcgcsv_singles (P-47) |
| 2026-08-24 | `—` | RE-VERIFICACIÓN DE CIERRE · v2.1.9 |
| 2026-08-24 | `—` | PASE v2.1.7 / v2.1.8 — GATE DE RELEASE |
| 2026-08-24 | `—` | PASE P-48 / v2.0 — la CURVA de precios |
| 2026-08-23 | `—` | PASES P-38 |
| 2026-08-20 | `—` | PASE v1.6 — money-safety-hardening |
| 2026-08-16 | `—` | ANEXO rev v1.4 |
| 2026-08-16 | `—` | ANEXO rev v1.5 |
| — | `—` | C. Revisión v1.4-finance — Costo real de paquetería en el P&L (M-16) |
| 2026-08-16 | `—` | rev v1.6-pentest-consolidacion |
| 2026-08-16 | `—` | ANEXO rev v1.9-set-chart |
| — | `—` | D. Revisión v1.11-ola1-wiring — Wiring del panel de admin (dinero + PII) |
| — | `a72f6e6` | E. Revisión Ola 2 — Gestión de inventario M1 (commit a72f6e6) · rama claude/git-repo-review-c67xyk |
| — | `ebb4dee` | F. Revisión Fase 0 — Epic de precios / cierre del bypass del umbral INE (commit ebb4dee) · rama claude/git-rep |
| — | `a6a79df` | G. Revisión Fase 1 — catálogo priceado + job 2×/día (commit a6a79df) · rama claude/git-repo-review-c67xyk |
| — | `10d5205` | H. Revisión Fase 3a — rediseño del cotizador buylist (commit 10d5205) · frontend |
| — | `fba6486` | I. Revisión Fase 2 — precio de venta por rareza (commits fba6486 + fee3c19) · backend + frontend |
| 2026-08-19 | `—` | ANEXO rev v1.6 |
| 2026-08-19 | `—` | ANEXO 2026-08-19 — Stream pulido-precios-display (FX al vuelo + N-15 displayFinishes) |
| 2026-08-21 | `—` | PASE Stream C (cotizador v2, P-14+P-16) + buzones i18n — VEREDICTO BLUE TEAM |
| 2026-08-23 | `—` | VEREDICTO DE SEGURIDAD — RELEASE lote inventario/sellado (920260e..29a5e97) |
| 2026-09-08 | `—` | REVISIÓN DE SEGURIDAD FOCALIZADA — delta origin/production..HEAD (f04f2dc..fdec257) |
| 2026-09-09 | `97f3bcf` | PASE BLUE TEAM FOCALIZADO — §M2-F v1.63.1 «el interruptor del tipo de cambio» |
| 2026-09-18 | `1d43a19e` | Revisión de robustez PII — «degradar en vez de 500» |
| 2026-09-28 | `db7d1c2` | Stream bóveda M4-VAULT «Para bóveda» — consolidación VLT-1..4 + hallazgo del techlead |
| 2026-09-28 | `f2981e1` | Stream bóveda M4-VAULT — re-verificación de C1 |
| 2026-09-29 | `8ea245f` | Paquete de seguridad — SEC-RESET-TV + DAST de release bloqueante + C7 |
| 2026-09-29 | `2ef3f50` | Re-medición C7 v1.80.1 — cierre de C-MINT y C-HDR |
| 2026-09-29 | `ff57390` | Revisión de DISEÑO — stream «Preparar envíos» §M4-SHIP v1.80.2 (API_CONTRACT) + ARCHITECTURE §4.57 |
| 2026-09-29 | `0e1faf6` | Re-revisión de DISEÑO — §M4-SHIP v1.80.4 (API_CONTRACT §M4-SHIP.17 + .18) + ARCHITECTURE §4.57 (p) |
| 2026-09-29 | `3498766` | Re-revisión de DISEÑO (blue team) — §M4-SHIP v1.80.5 · rama claude/envio-preparar |
| 2026-09-29 | `62d0c46` | Revisión de DISEÑO (blue team) — §M4-SHIP v1.81 «Envíos con Skydropx» · rama claude/skydropx-envios |
| 2026-09-29 | `59a0c1f` | Veredicto de seguridad sobre el CÓDIGO — stream §M4-SHIP «Preparar envíos» |
| 2026-09-29 | `—` | Release s5 · 7b9c196e — veredicto de seguridad (blue team) |
| 2026-10-02 | `—` | post-release s5 · b370cf9b — veredicto de seguridad (blue team) |
| — | `—` | Release sesión 7 — accesorios + lista de deseos (bc8e3533) |
| 2026-10-08 | `—` | §BMK |
| 2026-10-10 | `—` | Release salida-real · LIVE-5 + TD-4 + CSP report-only · veredicto de seguridad (blue team) |
| 2026-10-11 | `9cc26064` | Pase §PRE «Precios Robustos» — veredicto de seguridad (blue team) |

_Changelog:_ 2026-10-25 · veredicto `60250e90` APROBADO; compactado de 17 004 líneas a estado vigente + registro + índice.

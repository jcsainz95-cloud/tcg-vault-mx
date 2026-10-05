# TRASPASO — Integración de envíos con Skydropx (prompt para la sesión de orquestación)

> **Este fichero es el prompt.** El dueño lo pega tal cual en una sesión nueva sobre este repo. Lo redactó el
> 2026-09-29 la sesión que hizo el levantamiento. **No lleva estado de memoria: lleva rutas y SHAs.** Todo lo
> que afirma se puede comprobar en el fichero y la línea que cita.
>
> ⚠️ **Revisado el 2026-09-29 por la sesión de orquestación en curso: lee §7 antes de ejecutar §4.** Tres
> encargos de §4 ya están hechos o diseñados en ramas vivas, y el orden de §4 cambia (§7.3).

---

Eres el **orquestador** de TCG HUNT (tcghunt.mx). Trabajas para un dueño que **no programa**: háblale en
español llano, de consecuencias de negocio, sin detalle técnico salvo que lo pida. Tu manual es `CLAUDE.md`.
Léelo entero antes de nada, en especial las «Reglas del orquestador» (O-1 a O-15), «Cómo se publica» y
«Reparto de modelos».

Tu encargo: **llevar a desarrollo la integración de envíos con Skydropx** en los dos flujos que sacan un
paquete de la tienda: **compra de invitado con envío directo** y **retiro de bóveda**. El levantamiento está
hecho y el dueño ya tomó las decisiones de producto. Te toca pasarlo por el flujo del equipo:
product-owner → arquitecto → ux-ui / devops → backend + frontend → gates.

## 1 · Primera acción (O-11), antes de decirle nada al dueño

1. `git fetch origin production claude/laughing-meitner-4o54wo && git status && git log --oneline -5`
2. Lee **entero** `HECHOS.md`. Las **seis filas «Envíos con Skydropx»** (2026-09-29) son decisiones del dueño:
   **no se vuelven a preguntar**.
3. Lee el **índice** de `PENDIENTES.md` y la sección «Actualización 2026-09-29 · Skydropx».
4. Lee **entero** `docs/specs/SKYDROPX_LEVANTAMIENTO.md`. **§11 y §12 mandan sobre §2–§9.** Al principio del
   fichero hay un aviso con el porqué.
5. **Rama:** `git checkout -b claude/skydropx-orquestacion origin/production`, y luego
   `git merge --no-ff origin/claude/laughing-meitner-4o54wo`. Esa rama trae production `a2da420` más los docs
   del levantamiento. **Antes de empujar, pon un commit propio encima** (lección P-RAMA-HEAD-PR en
   `PENDIENTES.md`).
6. **⚠️ `main` está atrasado.** Medido el 2026-09-29: `origin/main` = `bb239c0` (2026-09-15) y
   `origin/production` = `a2da420` (2026-09-28), **1277 commits por delante**. Las entregas recientes fueron
   por PR directo a `production`. **Mide sobre `production`, no sobre `main`.**
7. Tu primer mensaje al dueño cita el SHA de tu `HEAD` y el de `origin/production`, y dice en tres líneas qué
   vas a hacer primero.

## 2 · Material (todo en `docs/specs/`, en la rama `claude/laughing-meitner-4o54wo`)

| Fichero | Qué es | Confianza |
|---|---|---|
| `SKYDROPX_LEVANTAMIENTO.md` | El levantamiento. §11.5 = **cómo quedan los flujos F1–F9**; §12 = avisos al cliente; §5 = huecos previos; §8 = contraste con la referencia de la API; §9 = dinero y P&L; §10 = resultados del panel | Código **medido** sobre production `a2da420` (§11.1) |
| `SKYDROPX_API_REFERENCIA.md` | Referencia de la API PRO que compiló el dueño de la doc oficial | Del dueño. **Nadie la contrastó contra la fuente**: la red del contenedor bloquea `*.skydropx.com` |
| `SKYDROPX_PRUEBA_PANEL.md` | Plan de la prueba en el panel (10 destinos, 2 paquetes) | — |
| `SKYDROPX_PRUEBA_PANEL_RESULTADOS.md` | Lo que midió una sesión en el Chrome del dueño, 2026-09-28 23:10–23:34 CST | Medido en panel, cuenta de producción. **Precios distorsionados por una promo** («50 envíos a $50») |

## 3 · Decisiones del dueño (en `HECHOS.md`, 2026-09-29)

1. **Todo paquete va asegurado** (SOS Protección, $25 medidos con el valor por defecto).
2. **Una sola paquetería preferente, con sucursal cerca de su casa (CP 14210): 99minutos.** Respaldo solo donde
   no cubra. **Sin recolección**: él lleva los paquetes.
3. **El operador elige la paquetería dentro de la plataforma**, entre las opciones con sus costos, con la
   preferida **preseleccionada**. No hay compra automática en el alcance inicial (§11.5 F3).
4. **Liga de rastreo solo si Skydropx la da.** Si no, clave de rastreo + paquetería, como hoy. Nunca una URL
   armada por nosotros (§12.3).
5. **Correo de «Entregado» automático** al confirmarse la entrega (reabre el criterio 210).
6. Si el paquete queda **en sucursal**, va un **correo aparte** y el envío **no** pasa a `entregado`.

Y lo que ya estaba vigente: la **tarifa al cliente no cambia** (dial `shipping_fee_cents` = 17500 **neto**, el
cliente paga **MX$203**, `common/money.ts:438-458`). La **tarifa en vivo en el checkout queda fuera** del
alcance.

## 4 · Qué hacer, en este orden

**Paso 0 — Antes de construir, re-mide (O-5).** El levantamiento se midió sobre `a2da420`. Si `production`
avanzó, repite las 16 comprobaciones de §11.1 sobre el nuevo head. Cada una trae su `fichero:línea`.

**Paso 1 — product-owner.** Redacta en `PROJECT.md` el bloque de requisitos «Envíos con Skydropx» a partir de
§11.5, §12 y las decisiones de arriba. Tiene que:
- **reabrir por escrito** `PROJECT.md` §S.2: «Impresión de etiquetas: cero» (`PROJECT.md:6490`) y
  `DESIGN_SYSTEM §35.5`;
- **reescribir el criterio 210** (correos en `entregado`) con el de «Entregado» y el de «en sucursal»;
- declarar el **alcance**: dentro, invitado y retiro de bóveda; fuera, cubeta de bóveda, buylist y tarifa en vivo.

Presenta el borrador al dueño **solo con las preguntas que queden abiertas de verdad**. Revisa antes las
preguntas del levantamiento (§6, §9 y §11.2). La 2, la 4, la 5 y la 14 ya están respondidas en §3 de este traspaso. Commitéalo tú (O-13).

**Paso 2 — arquitecto** (regla 9: contrato y schema). Tiene que resolver:
- **La pregunta que ya estaba abierta:** «¿«preparado» es un estado nuevo o un hito dentro de `picking`?»
  (`PROJECT.md:6772-6775`). Junto con ella: «guía en proceso» (§8.2 R5) y «en sucursal» (§8.3).
- **Qué necesita el schema:**
  - en el envío: id de Skydropx, tarifa elegida y recomendada, liga de la etiqueta, liga de rastreo
    (**nullable**), costo del seguro y quién eligió;
  - una tabla de **ajustes de costo** para los cargos extra (§9, D3);
  - **empaques estándar** (sobre de 1 kg y caja, con código de empaque de Skydropx; §10.1 M2 y M3);
  - ajustes de **origen** (plantilla de Skydropx), **paquetería preferente**, **Carta Porte** y **saldo mínimo**.
- **Dirección:** colonia **obligatoria** y elegida de una lista por CP (§8.2 R1, §10.1 M5), y la libreta
  endurecida al nivel del invitado (§5 H3, §3.3 V1). **Toca `users` y `orders` a la vez, que son dos streams**:
  serialízalo.
- **Rastreo:** webhooks o **consulta periódica**. La firma de los webhooks **no está documentada** (§8.2 R8):
  con lo que hay hoy, empieza por consulta periódica con BullMQ (`jobs/scheduler.service.ts`).
- **Mapeo de estados** de Skydropx a los nuestros: propuesta en §8.3.

**Paso 3 — en paralelo.**
- **ux-ui:**
  - la pantalla «Cotizar envío / elegir opción» (§11.5 F3);
  - la vista «Salida de hoy» (F4);
  - los correos nuevos: «Entregado» y «en sucursal»; el de intento fallido queda a decisión del PO.
- **devops:**
  - variables `SKYDROPX_BASE_URL`, `SKYDROPX_CLIENT_ID` y `SKYDROPX_CLIENT_SECRET` en Railway (sandbox primero);
  - el cuerpo crudo del webhook, si el arquitecto lo elige (`main.ts:48-52` solo lo tiene para Stripe);
  - la política de red de CI y de los contenedores de trabajo para `sb-pro.skydropx.com` y `pro.skydropx.com`.

**Paso 4 — backend + frontend a la vez**, en el stream **«Órdenes y dinero»** (`shipments`, `payments`). Toca
dinero: **modelo fuerte y triple veredicto** (CLAUDE.md «Reparto de modelos»). El cliente de Skydropx vive
**solo** en el servidor:
- el token se guarda en caché 2 h;
- máximo 2 peticiones por segundo;
- se reintenta ante 401 y 429.

**Arreglos previos, pequeños, que pueden ir primero y por separado** (no dependen de Skydropx):
- **E1 / H7:** los enlaces de los correos de envío y de pedido llevan a rutas que **no existen**.
  - Dónde: `backend/src/modules/shipments/mail/shipment-notice.templates.ts:73` y `backend/src/modules/orders/mail/order-notice.templates.ts:107,192`.
  - Al invitado le corresponde su liga `/pedido?token=…`.
  - Dueño: backend.
- **D1:** la pantalla M4 nunca manda `shippingCostIvaCents` (`M4View.tsx:134-139`), así que el P&L subestima la
  ganancia. El DTO ya lo acepta. Dueño: frontend.
- **E2:** `/orders` no muestra la guía. Dueño: frontend, previo aviso al arquitecto si toca el DTO.

**Paso 5 — gates.**
- **qa** (con E2E de los flujos F1–F8) y **techlead**.
- **Fase de seguridad por release:** integración externa nueva, datos personales que salen a un tercero y un
  webhook entrante si se usa.
- Verifica tú: O-9, sobre una copia **entera** del árbol.
- **Publica el dueño**: tú abres el PR a `production` y escribes ahí, en lenguaje llano, qué entra, qué le pasa
  a la base de datos y cómo se revierte.

## 5 · Lo que falta medir (no bloquea el diseño; ajusta detalles)

| # | Qué | Quién | Cómo |
|---|---|---|---|
| T7 | Cobertura y precio de **99minutos** a los 10 destinos | Dueño o una sesión en su Chrome | Panel. Solo cotizar |
| T3 | Confirmar en el mapa las sucursales cercanas a 14210 | Dueño | Direcciones de directorio web, sin confirmar: §11.4 |
| T4 | **Precios sin promoción** | Dueño | Al acabarse los 50 envíos de la promo |
| T1, T2 | Precio del seguro con $2,500 y $10,000; clave SAT para cartas | Dueño | «Completa el envío», **sin crear el envío** |
| T6 | Si el seguro automático de la cuenta aplica a guías hechas por API | Sandbox o api@skydropx.com | — |
| — | **Colección OpenAPI oficial**: webhooks, recolección, forma de la tarifa, `tracking_url_provider`, si el `total` trae el IVA desglosado | Dueño: botón «Copiar URL de la colección» en la doc | Cierra §8.4 y §12.3 |
| — | Si la cuenta de Skydropx manda **sus propios avisos** al cliente (correo o WhatsApp) | Dueño, en el panel | Si están activados habría **correos duplicados**. Propuesta: apagarlos (§12.3.3) |

**Peticiones al dueño que ya están justificadas (O-6):** credenciales de **sandbox** como variables de
entorno, **nunca por chat**, y abrir la red a `sb-pro.skydropx.com` y `pro.skydropx.com`. Justificación: el
2026-09-29, `curl` a los tres hosts de la API respondió **«CONNECT tunnel failed, response 403»**, y WebFetch
dio `EGRESS_BLOCKED` en todos los dominios `*.skydropx.com`.

## 6 · Lo que NO se hace

- No se publica: el botón de `production` es del dueño («Cómo se publica»).
- Ningún secreto en el repo, en el chat ni en los registros: **el repositorio es público**.
- No se generan guías reales ni se gasta saldo en pruebas. Todo en **sandbox**. El saldo de producción medido
  el 2026-09-28 era $965.16.
- No se re-pregunta nada de §3.

## 7 · Revisión por la sesión de orquestación en curso (2026-09-29) — lee esto antes de ejecutar §4

> Lo escribió el orquestador de la sesión `01Wq9Vk9iBAySfKoHBUSS583`, a petición del dueño («dale una revisada
> … que podamos integrarlo de la mejor manera»). Medido contra las **ramas vivas** de esa sesión, que este
> traspaso no conocía. Cada afirmación trae dónde se midió; lo no medido se marca.

### 7.1 Tres encargos de §4 que YA están hechos o diseñados (O-5: no se rehacen)

| Encargo de §4 | Estado medido | Dónde | Lo que queda |
|---|---|---|---|
| **E1 / H7** enlaces rotos en correos | **HECHO** en `claude/arreglos-operador` (commit `16a3170`, en `4ca6c45`), con candado `backend/test/mail-links.frontend-routes.spec.ts`. Registrado ⇒ `orders/:orderId`; retiro ⇒ `shipments/:id`; **invitado ⇒ sin botón** (no lleva la liga con token) | `backend/src/modules/shipments/mail/shipment-notice.templates.ts` fn `shipmentUrl` (leído en `4ca6c45`) | Decisión de producto chica: si el invitado recibe su liga `/pedido?token=…` en el correo (§4 lo propone; el arreglo eligió «sin CTA»). Va al PO del bloque Skydropx, no a un arreglo previo |
| **«¿preparado es estado o hito?»** (§4 paso 2) | **RESUELTO** en el diseño §M4-SHIP: hito dentro de `picking`, sello `preparedAt`/`preparedByUserId` en `ShipmentRequest`; `POST …/tracking` y el paso a `guia` **exigen** «preparado» | `/home/user/tcg-envio/docs/API_CONTRACT.md:15258-15259, 15881` (rama `claude/envio-preparar`, `17193a7` + v1.80.4 pendiente de empujar) | Nada. El botón «Cotizar envío / comprar guía» (§11.5 F3) cuelga de ese hito, tal como §11.3 preveía |
| **E2** `/orders` sin guía | **DISEÑADO, no construido**: §M4-SHIP.16 expone `publicStatus`/`shipment` en `GET /orders/:id` para el registrado | `API_CONTRACT.md:8739` (envio) | Se construye con §M4-SHIP, no aparte |

### 7.2 Lo que choca con el trabajo en curso y cómo se ordena

1. **Misma zona compartida.** Skydropx toca `shipments`, `orders`, `payments` = stream «Órdenes y dinero», el
   **mismo** que §M4-SHIP (palomeo de envíos + reembolsos + «Por reponer»), diseñado hasta v1.80.4 y **aún sin
   construir**. Regla CLAUDE.md: un stream a la vez en esa zona. **Orden:** se construye §M4-SHIP primero;
   Skydropx se diseña en paralelo (solo docs) y se construye encima. Skydropx **depende** de «preparado» (7.1),
   así que el orden no es solo de disciplina: es de dependencia.
2. **Criterio 210 sigue vigente en el diseño §M4-SHIP** («exactamente dos correos y ninguno al entregar»,
   `API_CONTRACT.md:26296-26305` envio; y el encabezado de `shipment-notice.templates.ts`, «NO HAY PLANTILLA DE
   ENTREGADO», con canario `test/avisos.shipments.spec.ts` C-AV-3). La decisión 5 de §3 lo reabre. El PO lo
   reescribe **una sola vez** (Entregado + «en sucursal»), y backend tendrá que invertir el canario C-AV-3, no
   apagarlo.
3. **El levantamiento se contradice a sí mismo** en un punto: §11.5 F5 dice `delivered` ⇒ «**sin correo** (X2)»
   y §12.3.2 dice correo de «Entregado» automático. **Manda §12.3.2** (decisión del dueño, posterior). El PO lo
   deja escrito.
4. **Dirección (colonia obligatoria de lista por CP + libreta endurecida)** toca `users` (stream «Cuentas y
   acceso») y el DTO del checkout de invitado (`orders`). Va como **paso aparte y previo** a la construcción de
   Skydropx, con el arquitecto serializando el contrato. No se mete en el mismo commit que la guía.
5. **D1 (`shippingCostIvaCents` no se manda desde M4)** sigue **abierto**: en `claude/arreglos-operador`
   `grep shippingCostIvaCents frontend/src` solo da `types/contract.ts` y `lib/mock/fixtures.ts` (medido
   2026-09-29). Con Skydropx el costo llega solo (F8), así que el arreglo manual es de **transición**. Es
   chico y de frontend: se enruta al paquete de pantallas de la sesión en curso, no a Skydropx.

### 7.3 Orden de integración propuesto (sustituye al de §4 donde difieran)

| Fase | Qué | Quién | Puede arrancar |
|---|---|---|---|
| **A · Diseño** | PO: bloque «Envíos con Skydropx» en `PROJECT.md` (con 7.1 y 7.2 ya resueltos, solo las preguntas abiertas de verdad). Arquitecto: extiende **§M4-SHIP** con las secciones Skydropx (schema, ajustes, cliente, rastreo por consulta periódica, mapeo §8.3, «guía en proceso», «en sucursal») como versión v1.81 sobre la rama de diseño de envíos, para que sea **un solo modelo** de envío. Seguridad revisa el diseño (tercero externo, PII, secretos) | PO, arquitecto, seguridad | **Ya**, en paralelo con la construcción del lote actual — pero **después** de que seguridad cierre la re-revisión de v1.80.4 (O-14: un diseño no se cambia mientras lo miden) |
| **B · Construir §M4-SHIP** | Palomeo, preparado, reembolsos, «Por reponer», §M4-SHIP.16 | backend + frontend (modelo fuerte), triple veredicto | Cuando seguridad apruebe v1.80.4 |
| **C · Dirección** | Colonia obligatoria de lista por CP; libreta al nivel del invitado | arquitecto (contrato) → backend + frontend | Tras B (zona `users`/`orders`) |
| **D · Skydropx** | Cliente servidor (token 2 h, 2 req/s, reintentos), cotizar/elegir/comprar, etiqueta PDF, rastreo, correos «Entregado» y «en sucursal», «Salida de hoy», costos y cargos extra al P&L, ajustes F9 | backend + frontend + devops; ux-ui antes | Tras A, B y C, con red y sandbox abiertos (7.4) |
| **E · Gates y botón** | QA con E2E F1–F8, techlead, pentester + seguridad; O-9 del orquestador; PR a `production` con qué entra, qué pasa con la BD y cómo se revierte | gates, orquestador, dueño | Tras D |

### 7.4 Peticiones al dueño (O-6), con su medición

| Petición | Medición que la justifica | Cuándo hace falta |
|---|---|---|
| Abrir la red del entorno a `sb-pro.skydropx.com` y `pro.skydropx.com` | §5 (403 en el túnel, 2026-09-29). **Re-medición por esta sesión: en curso** al escribir esto; se anota el resultado en `PENDIENTES.md` al arrancar la fase D | Fase D (no antes) |
| Credenciales de **sandbox** en Railway / secretos de GitHub, nunca por chat | Repo público (`HECHOS.md`) | Fase D |
| URL de la **colección OpenAPI oficial** | §8.4 / §12.3: sin ella no hay webhooks ni `tracking_url_provider` confirmado; el rastreo arranca por consulta periódica | Fase A (mejora el diseño) — no bloquea |
| Apagar los avisos propios de Skydropx al cliente | §12.3.3 (**NO MEDIDO** si están activos) | Antes de la primera guía real |

### 7.5 Comprobación (O-5)

Todo lo de 7.1 y 7.2 se midió el **2026-09-29** sobre `claude/arreglos-operador` `4ca6c45` y
`claude/envio-preparar` `17193a7` (+ v1.80.4 en árbol). Antes de enrutar trabajo desde esta sección, **re-mide**:
`git log --oneline -1` de cada rama y los `grep` citados. Si §M4-SHIP ya está fusionado a `production`, la
fase B está hecha y se salta.

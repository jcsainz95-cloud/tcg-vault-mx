# PENDIENTES — TCG HUNT

---

## 🔴 HANDOFF AL ORQUESTADOR — stream «ciclo de compra a usuarios» (2026-09-07)

**Punto de retome.** Todo lo de abajo se midió, no se recordó. Lo no medido va marcado.

### Estado

| | |
|---|---|
| `main` | **`c132397`** — código verificado **+ sus tres veredictos + la documentación que dice la verdad** |
| Rama `claude/buylist-inventory-workflow-hdnls3` | **fusionada entera** (0 commits por delante). No hay nada colgando. |
| Contrato | **v1.60** · `PROJECT.md` hasta **D51** |
| Suites (medidas por QA) | backend **248 suites / 3.609** unitarios · **17 / 264** integración · typecheck limpio · lint 0 errores + 2 warnings preexistentes en `inventory/` · frontend **113 / 1.166** |
| Producción | **`18f279e`** (release de logos). **NO tiene el ciclo de adquisición**: cero `offerState`/`offerGrossCents`/`pickupAddressSnapshot` en su schema y **sin la migración `m46`**. |

**Los tres veredictos sobre `c6b999a`:** QA **APROBADO** · techlead **APROBADO con deuda** · seguridad **APROBADO** (cero críticos, cero altos). Conteos pre-merge de §M5-A.9 y §M5-R.5: **0, 0, 0, 0** sobre dataset limpio. ⚠️ **Local. Producción no está medida.**

---

### ⚠️⚠️ LA RESTRICCIÓN QUE NO SE PUEDE PERDER

> **`A1` (el rechazo por tope por solicitud al ofertar) es HOY lo único que tapa `BL-43`.**
> **No se puede retirar `A1` sin poner su sustituto EN EL MISMO COMMIT.**

Lo midió seguridad, incluida la vía del override de KYC: `amlCap` en `approve` lee **la misma fuente** que `A1` al ofertar, así que hoy no pueden discrepar y **lo que pasa la emisión pasa la aprobación**. Y **D47 retira exactamente `A1`**. Si se implementa D47 sin `BL-43`, se abre el agujero: una línea cara pasa la oferta vinculante, **el vendedor manda la carta**, y `approve` la rechaza. Sin remedio para el vendedor.

---

### 1 · Ronda siguiente — implementar v1.59/v1.60 (backend)

Todo está **declarado y sin implementar**. Orden sugerido:

1. **`§M5-D`** — fusión de diales (`BUYLIST_CAP_PER_REQUEST_CENTS` se retira de **las cuatro** estructuras de `settings.constants.ts`; sobrevive `INE_THRESHOLD_CENTS`) **+ `BL-43` en el mismo commit** (ver restricción arriba). El override `capPerRequestCentsOverride` **muere con el dial**: habría pasado a ser un umbral de KYC por vendedor, la exención que el criterio 178(e) prohíbe.
2. **`§M5-A` reordenada** — inciso (c): **el que rechaza va antes que el que identifica**. `BUYLIST_LIMIT_EXCEEDED` queda **solo para el mensual**; se retiran del vocabulario `scope:"per_request"` y `"per_request_offer"`.
3. **`§M5-I`** — compuerta del INE en la creación. ⚠️ El predicado **ya existe** (`ineRequired = quotedTotalCents >= ineThreshold || hasPendingLine`); lo que falta es que **sea alcanzable**, que depende de (1).
4. **Boundary atómico** `I3 → I2 → persistencia → create`. Reordenar dos `if` **NO basta**: el `upsert` que escribe las keys del INE commitea **fuera** de la tx que evalúa el mensual, así que el rollback no lo deshace.
5. **`§M5-N`** — `BL-42` caminos 1 y 2.
6. **Retirar `legalName`** de `ADMIN_KYC_SELECT`, del tipo y de las dos proyecciones. Cero migración. Impacto de frontend **cero, medido**.
7. **`D50` necesita DDL** → **vuelve al arquitecto primero (regla 9)**. El instante «cuando se le pide lo que falta» **no está sellado en ninguna columna**. ⛔ **Prohibido aproximarlo con `createdAt`**: aproximarlo *es* el cierre en silencio que §E prohíbe.

---

### 2 · Lo que los tres gates dejaron abierto

**Backend**
- ⚠️ **Corregir la afirmación «se hace INALCANZABLE el estado»** en `assertRequestReceived`. **Es falsa**: hay un **segundo escritor** de `itemStatus:'aprobada'` (`respond`, rama accept, `:2081-2084`) que **no lleva el término**. La puerta del dinero aguanta (`isPayable` falso), el daño sería de mercancía. La frase, además, **prohíbe la guarda que lo cerraría**. Fichar el residual con dueño.
- Marcar **`BL35-D7/D8/D9` como resueltas** (están implementadas y siguen diciendo «pendiente»), y añadir a **`BL35-D6`** su consecuencia de mercancía.
- **Reabrir `BE-1`** con las cinco cosas que pidió el techlead, **antes** de que disputas se vaya a otra rama.
- `BLC-D4`: la cifra caducó (dice 6.154 líneas; hoy **~7.236**) y su disparador se incumplió cuatro veces.
- `D3`: re-redactar el disparador como *«cualquier edición que toque una de las dos escaleras sin tocar la otra»*. Falta test del backstop.
- **M-1 (QA):** `expect([200,201])` laxo en `buylist-cycle.e2e-spec.ts:816`; §M5-C hace el `200` normativo.
- Ningún camino trata **`P2034`/`40001`**: seis transacciones `SERIALIZABLE`, cero reintentos, `500` opaco en un verbo de dinero cuyo remedio correcto es «reintenta».
- La doctrina **§4.39(z)** tiene **un adoptante de ocho candidatos**. El más fuerte sin convertir: `countBountyAcquisitionsTx`, que **escribe**.

**Frontend**
- **`mockIsPayable` se quedó en DOS términos** (`fixtures.ts:1261-1263`) y `receivedAt` **no existe en `frontend/src`**. En modo mock —contra el que corre Playwright— **el botón de pagar aparece habilitado** sin recepción. Su propio docstring predijo esto.
- **I-1 (QA):** el copy de `APPROVED_PRICE_CAP_EXCEEDED` dice «cotizado × 2 o tope AML» y **`BL-40` retiró ese término dentro del ciclo**. Explicación falsa en el error que gobierna cuánto se le paga a un vendedor.
- **I-2 (QA):** `INE_REQUIRED` y `BUYLIST_LIMIT_EXCEEDED` hablan **al vendedor** («necesitas subir **tu** INE») pero ahora se emiten también en la ruta de **admin**, cuyo destinatario no puede subir el INE de otra persona.
- **M-2 (QA):** `REQUEST_NOT_RECEIVED` sin copy ⇒ inglés dentro de la UI en español. Familia de **siete** códigos M5 huérfanos preexistentes.
- La fórmula de `isPayable` en `types/contract.ts:2373` sigue con **dos** términos.
- **`DT-Gd`**: su disparador duro era *«el primer pase de frontend después de que la rama fusione»*. **Ya disparó.**

**Arquitecto**
- **Corrección de seguridad al contrato (§M5-P):** el eje 2-b **NO adelanta** la purga del INE, la **RETRASA** ⇒ el riesgo real es **sobre-retención de PII (LFPDPPP)**, no pérdida de evidencia.
- `BL-44`: el barrido de retención **salta el perfil entero** con `openCount > 0`, así que **una sola solicitud eterna congela la purga de TODAS las identificaciones de esa persona**, incluidas las de solicitudes ya pagadas. `D50` **no lo cierra**.
- `BL-36` residual, `BL-42` camino 3.

**Devops**
- **`purge-synthetic-poc-data.sh` no puede completarse**: **verifica con un predicado más ancho del que borra** (cuenta como «del PoC» actividad de usuarios del fixture) ⇒ se niega y deshace. Misma familia que B-1.
- **Sugerencia de seguridad**: comparar también el **hash de árbol**, no solo el commit, para distinguir *«cambió el commit»* de *«cambió el código»* — un commit de solo-docs pone hoy el gate en rojo sin motivo.
- ⚠️ **Migración fuera de orden**: `m46` está fechada el **1 de septiembre** y producción ya corrió la del **2**. Comprobar **antes** del despliegue, no durante.
- Pendiente de antes: runbook de cut-over (el `SELECT` del censo del paso 6), smoke de MinIO que se auto-salta.
- ⚠️ **`STAGING_API_URL` lo tiene que cargar el humano.** Sin él el gate avisa; **promoviendo a prod, falla**.

**Seguridad**
- **`SEC-B2` [Media]** — `verify` sobre una **oferta viva** deja al vendedor **atrapado**: no puede aceptar ni declinar (`409`), la fila **no caduca**, **ningún verbo la devuelve**, y **su portal le sigue mostrando la cuenta atrás**. Alcanzable por el rol de menor confianza. **Disparador: cerrarlo ANTES de operar con vendedores reales.**
- **`BL-41`** cerrada como **retirada por producto**, no implementada. La aceptación del riesgo pide **cuatro condiciones** (§8 de `SECURITY_NOTES.md`).

---

### 3 · Decisiones que esperan al humano

- **Preguntas 36, 37, 39, 42, 43, 44** del product-owner, todas **con supuesto** y ninguna bloqueante.
- **44 (CEP del SPEI)** — ⚠️ **no verificada por nadie**. Antes de construir nada hay que responder: **¿qué se hace cuando el CEP muestre un nombre distinto, con el dinero ya enviado?** *Un registro que nadie sabe leer no es mejor que no tenerlo.*
- **El umbral del INE (MX$3,000) es un dial editable en M10**, no está clavado. **Su piso probablemente lo fija la ley** (actividades vulnerables) ⇒ consulta legal pendiente, junto con **guardar identificaciones de gente a la que nunca se le compra**.
- **El cotejo real INE↔titular es un paso operativo**: quién lo hace y en qué pantalla. Hoy **no existe en ningún flujo**.

---

### 4 · Otros streams — NO en esta rama

- **`disputes` [Media, «Órdenes y dinero»]** — `resolve()` sin guarda ni idempotencia en las dos ramas; el job de deadline hace **read-then-write** (una disputa resuelta vuelve a la cola y se resuelve dos veces). **No desembolsa** (el importe solo se interpola en texto), y por eso es Media y no Alta: **la mitigación real es la bitácora, no el código**. `BE-1` declara resuelto lo que no existe.
- **Criterio 128(b)** — alta de usuario en back-office sin celular. Va al **arquitecto primero**.
- **M-49** — buylist de graduadas. Proyecto nuevo, arranca en **product-owner**.

---

### 5 · Lo que NO está verificado (decirlo, no asumirlo)

- **Producción no está medida** para ninguno de los conteos pre-merge. *Cero local no es cero.*
- **El workflow E2E real en CI nunca se ha corrido** en esta rama.
- ⚠️ **La suite Playwright NO se puede correr reutilizando servidor** — su configuración lo prohíbe por diseño. Hay que usar `E2E_BASE_URL` + `E2E_REAL=1`. **Quien reporte «E2E verde» habiéndola corrido de la otra forma, midió mocks.**
- Correos reales, barridos con reloj adelantado, subida de INE de punta a punta (sin MinIO) y DAST contra staging: **fuera del alcance del entorno**.

---

### 6 · Método — lo que costó caro esta sesión

**Nueve diagnósticos falsos por medir mal**, tres del orquestador. El patrón fue **siempre el mismo**: concluir desde un `grep` sin abrir el contexto del match.

Y el patrón de fondo, que es el que explica los cuatro agujeros de dinero: **nadie verificaba que el código cumpliera lo que `PROJECT.md` promete**. Aparecieron **cuatro veces** — pago sin recepción, topes sin evaluar al ofertar, la cota que rechazaba lo prometido, y un control entero (el cotejo INE↔CLABE) que estaba escrito en **18 sitios** y no existía en ninguno.

Tres reglas que salieron de ahí y que conviene mantener:
1. **§4.39(ad.2)** — antes de declarar el término de un control, **identificar la FUENTE de cada operando**. Un predicado con un operando que ningún flujo produce **no es un control incompleto: es un control que no existe, escrito en forma de control**.
2. **§4.39(z)** — un tipo que **nombra** la intención no la **impone**. Toda afirmación de «esto ahora falla en compilación» se mide con control **positivo Y negativo** antes de escribirse.
3. **Un gate que no comprueba qué código sirve no es un gate.** Pasó **tres veces** en un día; ahora `./scripts/stack-native.sh verify:head` se niega a mentir.

---

Lista viva de lo que **falta** en el producto. Cuando algo se cierra, se mueve a «Hecho
(referencia)» al final o se borra. Añade nuevos como `P-#`. Última limpieza: **2026-08-22**.

---

## Listo en `main` — esperando «publica»

Doble veredicto por-stream aprobado; mergeado a `main` (`6c5763b`). Se despliega a producción con «publica».

- **Endurecimiento inventario/sellado (2026-08-23, doble veredicto QA+techlead APROBADO + E2E ciclo completo):**
  El gate E2E pre-publicación (stack levantado, 63+ capturas) verificó operativo de punta a punta: comprar
  (settle certificado por suite de integración con webhook Stripe firmado; pago real staging-only), vender
  (buylist con CLABE cifrada), **admin intake→publicar** (venta→SPEI→inventario a costo real→«N+1 en stock»),
  y **subir sellado**→publicar→visible en Compra. Cierres: **BLOQ-1** (el alta por lote perdía el costo de
  compra → P&L; ya persiste), **BLOQ-2/2a/2b** (regresión «Tropius» muerta en M1›Sellado, «Mis piezas» y
  cola M2), **BLOQ-3** (el binder cuenta solo singles; el sellado no infla conteos), **IMP-1** (alta sellado
  sin dead-end vía `effectiveMarketCents` gateado), **IMP-2** (badge en vivo), **IMP-A** (cotizador ya no
  crashea por cantidad absurda), **IMP-B** (M5 deja convertir tras pagar), **IMP-C** (el override manual del
  sellado sobrevive al dial off; bucle roto), **IMP-D** (el **T2=25%** de P-34 entra en vigor vía reshape de
  datos), y la **cola M2 del sellado a 1 sola fila resoluble** por pieza. Contratos **v1.41/v1.42/v1.43**,
  **migración M-40** (`PendingPriceEntry.sealedProductId`, aditiva). Money-safe en todo el recorrido (sin
  precio → pendiente, nunca $0). *(Deuda no bloqueante anotada: D-1 cascada display duplicada, D-2
  `resolveAnchorCardId` duplicado money-adjacent, D-3 saneo de pendientes legacy.)*

- **Deuda saldada (2026-08-23, doble veredicto QA+techlead APROBADO):** backend H-P38-4 (upsert atómico
  del sync sellado), P-34 H5 (`mega`/`blackwhite` premium), P-34 H4 (invariante premium→pct testeado),
  **P-30 H2 cierre completo** (productores y consumidores comparten `variantKey()` + guard de round-trip);
  frontend H-P38-5 (alta sellado sin `cardId` falso), Cotizador H1/H3/H4 (layout CSS, sombreado «En el
  carrito» en teja separada, doc drift). Todo display/UX/refactor, money-safe, sin cambio de contrato.
  *(Deuda aún diferida: MK-D6, FE-2 «desde $X», DEUDA-tiers-3, P-30 H3, P-34 H3, SB-D3 (~6 sitios
  hand-rolled de otros módulos), deps + hardening auth B-1/B-2/B-5, re-seed snapshots, M-1 aceptado.)*

- **P-38** · **Módulo `SealedProduct`** (cura raíz de SB-D5): descarga presentaciones por set (ETB/UPC/
  Booster Bundle/box/blíster), alta = **seleccionar** con identidad real (adiós «Tropius sealed»), sync
  **1 set→N grupos** (absorbe promos/colecciones), precio en vivo + **manual** (vault_operator, auditado),
  soft-delete. **Migración M-39 + backfill** que cura el ETB→Tropius. Cascada de display cableada en
  Compra/Bóveda (H-P38-1). Contrato v1.39.1. *(Deuda no-bloqueante H-P38-2..6 en TECH_DEBT; precio manual
  por vault_operator marcado para fase de seguridad por release.)*
- **P-37** · IVA a **un solo dial**: se retira `STRIPE_FEE_IVA_PCT`; el gross-up de Stripe deriva de
  `IVA_PCT/100` (idéntico al centavo). Contrato v1.40. Money-safe.
- **P-41** · cotizador del home surtía `pageSize:5` (Pitch Black quedaba fuera) → **pageSize 20 + «ver
  más»**; + **orden global por `set.releaseDate desc`** (sets nuevos primero, ya no uuid aleatorio).
- **P-42** · cotizador: **carrito fijo a la derecha** en desktop (sticky) + **sombreado** «En el carrito».
- **P-43** · click en la carta → **pop-up de detalle** con imagen grande (cierra por backdrop + Esc).
- **P-44** · **rareza** visible en tejas de catálogo/cotizador/ficha/binder admin+bóveda.
- **P-39/P-40** · foto HD en el featured/ficha + etiqueta de **acabado**.
- **P-36** · stepper de baja rápida: botones disabled ya no se ven «encendidos» al hover.

**Al publicar (devops/Railway) — runbook en `DEVOPS_NOTES.md §29`, orquestado por `scripts/post-deploy.sh`
(idempotente; el paso 4 es opt-in y PARA si `publish-all` falla, conservando el cuerpo para diagnóstico):**
1. `prisma migrate deploy` → **M-39** (SealedProduct) + **M-40** (`PendingPriceEntry.sealedProductId`) +
   **M-41** (P-48: `pricing_curve`, `priceBasis`, `PendingPriceEntry.reason`, instrumentación), todas aditivas.
2. `ts-node prisma/backfill-m39-sealed-product.ts` — cura ETB→Tropius (idempotente).
3. `unify-rarities` — cosmético del editor M2. **Ya NO es prerrequisito de nada**: el guardarraíl premium
   usa `isPremiumCanonicalRarity()`, que acepta rareza cruda o canónica (verificado por devops).
4. **Cut-over P-48 (`RUN_PUBLISH_ALL=1`, opt-in)** — `publish-all` re-resuelve el precio con la curva.
   NO es migración de dinero: el precio de venta se resuelve en lectura, así que repriciar es re-resolver,
   nunca un `UPDATE` masivo. Idempotente por `batchKey` (default `p48-cutover-v2.0`).
5. **Diagnóstico de la cola por razón** — `no_market` vs `premium_at_floor`. Línea base esperada ≈3 de
   cada 333 (`ARCHITECTURE §4.36.9c-3`). Si `premium_at_floor` sube con `no_market` plano ⇒ piso mal
   calibrado; si suben los dos ⇒ feed degradado y **no** hay que tocar el piso.
6. *(D-3, no bloqueante)* si aparecen filas de sellado huérfanas en la cola M2 de altas previas al fix →
   barrido puntual (deuda backend registrada).
7. Por cada set: «Sincronizar» trae presentaciones (requiere egress real a `tcgcsv.com`).

> **Los cinco settings retirados por P-48 quedan INERTES, sin `DELETE`** (`sales_price_rules`,
> `buylist_price_rules`, `pricing_tier_map`, `sales_price_fallback_pct`, `buylist_price_fallback_pct`).
> Es deliberado: borrar config en el mismo paso que cambia la matemática mata el diagnóstico y el rollback
> barato. Ojo con `sealed_spread_fallback_pct`: **se parece pero NO es una de las cinco** — el sellado sigue
> vivo y fuera de la curva.
>
> **Orden entre releases (decisión del humano, pendiente):** `main` va adelante con **P-47** (flip a
> `tcgcsv_singles`), que cambia la **fuente** del mercado; P-48 cambia la **matemática** que se le aplica.
> Encender ambos en la misma ventana deja indiagnosticable cualquier movimiento de precio. Devops recomienda
> serializar.
> **Antes del deploy:** snapshot/PITR de la Postgres de prod (única vía de rollback fino del dinero del paso 3).
> **Rollback:** migraciones aditivas → redeploy del commit anterior; backfills idempotentes/no destructivos.

---

## Abiertos

### Diseñado y documentado pero SIN CONSTRUIR (2026-09-02)

#### ~~P-54 · 🎨 Logos de expansión en el índice de sets~~ — ✅ HECHO Y EN PRODUCCIÓN (2026-09-08)
- Verificado: `SetPlate.tsx` pinta `logoUrl`, con el caso `null` tratado como normal y permanente (no como carga). El humano lo confirmó en vivo. *(Texto original abajo, conservado por el histórico.)*

<details><summary>original</summary>

#### P-54 · 🎨 Logos de expansión en el índice de sets (en vez de los títulos en texto) — 0% implementado
- **Pedido del humano:** que el índice de sets muestre **el logo de cada expansión**, no su nombre en texto.
- **Lo que SÍ existe (todo documental, ya en `main` y desplegado como docs):**
  - `docs/ARCHITECTURE.md` **§4.39** (v1.52-set-logos) — marcada **NORMATIVO**: persistir `CardSet.logoUrl`
    y `symbolUrl`, migración **M-47 aditiva pura**, sin backfill (se puebla por re-sync), servidas desde el
    mismo host que ya sirve el arte de las cartas ⇒ cero acción de devops.
  - `docs/API_CONTRACT.md` **v1.52** — `logoUrl: string | null` declarado en el DTO de set y en 4 endpoints.
  - `docs/DESIGN_SYSTEM.md` **§24** (v2.8) — la «placa de tinta» `#1A1A18`, con **monograma serif** cuando el
    set no tiene logo (R4: sin logo no hay hueco ni pulso eterno).
- **🔴 Lo que NO existe — nada de código:**
  - `backend/prisma/schema.prisma` **no tiene** `logoUrl` ni `symbolUrl`. La última migración es `m43`;
    **M-47 nunca se creó ni se aplicó**.
  - `grep logoUrl backend/src frontend/src` ⇒ **cero coincidencias**. Ni ingesta, ni DTO, ni componente.
- **⚠ Por qué esto importa más que un pendiente normal:** el contrato **declara un campo que la API no
  devuelve**, y §4.39 está marcada NORMATIVO. Por la regla de conflicto del equipo el contrato manda sobre el
  código, así que hoy cualquiera —humano o agente— que lea `API_CONTRACT v1.52` va a creer que `logoUrl`
  existe. Es exactamente la clase de defecto que esta sesión persiguió todo el tiempo: **una afirmación más
  fuerte que la realidad**. Mientras no se construya, o se construye o el contrato debe decir «declarado, no
  implementado».
- **Trabajo pendiente, por dueño:**
  - **(backend)** migración M-47 (dos columnas nullable en `CardSet`) + persistir `images.logo`/`images.symbol`
    en el sync de metadata + exponer `logoUrl` en los 4 endpoints del contrato v1.52. `symbolUrl` se persiste
    y **no se expone** (§4.39.5).
  - **(frontend)** la retícula de §24: placa de tinta, monograma serif de respaldo, sin pulso cuando no hay logo.
  - **(devops)** nada. §4.39.7 lo deja explícito: mismo host de imágenes, cero superficie nueva.
  - **Poblado:** por **re-sync**, no por backfill — no hay `UPDATE` masivo (§4.39.4).
- **Riesgo de dinero:** ninguno. Es presentación (clase P); M-47 es aditiva pura, sin `DROP`, sin `NOT NULL`.
- **Requisito abierto:** §24.13 nº1 — un dato que ux-ui dejó pedido al arquitecto. **No bloquea**: sin él la
  retícula funciona con monogramas.

### Infraestructura · Disco de la base de datos (2026-09-01)

#### P-53 · 💾 El disco de Postgres se llena por el ritmo de escritura del historial de precios — MITIGADO, falta la cura
- **Detectado por el humano:** alerta de Railway «High Volume Usage — postgres-volume is at 77% capacity».
- **✅ Mitigación aplicada (humano, 2026-09-01):** volumen ampliado. **El reloj de saturación se detuvo.**
  Queda pendiente anotar el tamaño nuevo y rehacer la proyección con él.
- **Medición real en producción (solo lectura, consola de Railway):**
  | Dato | Valor |
  |---|---|
  | Disco usado / disponible | 317 MB de 434 MB (75%) |
  | `pgdata/base` (datos) | 171 MB |
  | `pgdata/pg_wal` (bitácora) | **145 MB — 46% de lo ocupado** |
  | Base de datos completa | 148 MB |
  | `PriceReference` | **101 MB — 68% de la base** |
  | Filas de `PriceReference` | 222,614 (2026-08-17 → 2026-09-01, 16 días) ⇒ ~476 B/fila |
- **Causa raíz (confirmada por consulta, NO por hipótesis):** el **ingest de singles de TCGCSV** escribe
  **una fila por producto por día**, se muevan o no los precios. El 2026-08-28 el ritmo saltó de **2,062 a
  ~28,570 filas/día (×14)** y lleva 5 días sostenido — es el nuevo estado estable, no un pico.
  Desglose del día 2026-09-01: `tcgcsv_singles/raw:NM/market` **28,559** · `pokemonpricetracker/graded:PSA:10`
  12 · `graded:PSA:9` 6.
  ⚠ **Corrección registrada:** el orquestador atribuyó primero el salto al pipeline PSA. **Era falso** —
  el PSA aporta 18 filas de 28,577. La causa es el ingest de singles.
- **Proyección que motivó la ampliación:** ~13 MB/día contra 107 MB libres ⇒ saturación ≈ **2026-09-09**.
  Con el disco lleno Postgres **deja de aceptar escrituras** (sin pedidos, sin altas, sin capturas de
  inventario) y compactar la tabla exige espacio libre ≈ su propio tamaño (101 MB): esperar cerraba la
  puerta al arreglo, no solo al servicio.
- **⚠ Una política de retención por antigüedad NO resuelve esto.** El historial completo son 16 días: hoy
  «conservar 90 días» no borraría ni una fila. El problema es el **ritmo diario**, no la basura vieja.
  (El orquestador propuso retención antes de medir; queda anotado para no repetir el camino.)
- **Lo que sí queda por hacer:**
  - **(devops) Acotar el WAL.** 145 MB de bitácora con **cero replication slots** (verificado: la consulta a
    `pg_replication_slots` devolvió 0 filas ⇒ no hay fuga). Es Postgres con los valores de fábrica,
    dimensionados para un disco mucho mayor. Bajar `max_wal_size` recupera del orden de **100 MB**. Requiere
    reinicio de Postgres ⇒ **con respaldo y ventana**, no en caliente.
  - **(arquitecto → backend) Escribir menos por día.** Palanca de fondo: hoy se guarda una fila diaria por
    carta **aunque el precio no se haya movido**, y la mayoría no se mueve. Escribir solo ante cambio recorta
    el volumen de forma drástica.
    🔴 **Money-critical:** toca qué tan **fresco** se considera un precio (`capturedDate`/`evidenceDate`,
    `stale()`) y roza la regla «no se fabrican puntos» de las series del portafolio y de los sets. Mal hecho,
    una carta se queda con precio viejo **sin que nada avise**. Pasa por el **arquitecto** (regla 9) y exige
    **triple veredicto (QA + techlead + seguridad)** antes de producción.
  - **(devops) Vigilancia.** Hoy nos enteramos por la alerta de Railway al 77%. Falta un aviso propio del
    crecimiento del disco y del ritmo de filas/día, para no volver a descubrirlo a 8 días del tope.
- **Consultas de diagnóstico (solo lectura) para repetir la medición:** tamaño por tabla vía
  `pg_total_relation_size`; `du -sh /var/lib/postgresql/data/pgdata/*`; `pg_replication_slots`;
  `SELECT "capturedDate", count(*) FROM "PriceReference" GROUP BY 1 ORDER BY 1 DESC`.

### Encontrado por el humano en producción (2026-09-08, tras publicar el ciclo de compra)

#### P-56 · ⭐ WISHLIST del cliente — «dime qué buscas y te la consigo» — pedido por el humano
- **La idea:** el cliente arma una **lista de deseos** con las cartas que anda buscando. La plataforma
  le hace saber que **podría conseguírsela a cierto porcentaje por encima del mercado**.
- **Por qué es más que una lista:** hoy solo sabes qué te compran de lo que YA tienes. La wishlist te
  dice **qué te comprarían si lo tuvieras** — es tu demanda insatisfecha, medida, y hoy es invisible.
- **⚠️ Conecta con los bounties, y ése es el valor real.** El bounty es *«pago X por esta carta»*
  (oferta); la wishlist es *«alguien la quiere»* (demanda). **Una alimenta a la otra**: N clientes
  buscando la misma variante es exactamente la señal para levantar un bounty. Diseñar las dos sin
  mirarse sería construir dos mitades de lo mismo.
- **🔴 Money-critical, y no es obvio:** *«te la consigo a X% sobre mercado»* es **un compromiso de
  precio con el cliente**. Hay que decidir si es vinculante, cuánto dura, qué pasa si el mercado se
  mueve entre la promesa y la entrega, y cómo se cruza con la escalera de redondeo y el tope de
  compra. Pasa por **arquitecto** (regla 9) y exige **triple veredicto**.
- **Preguntas para el humano, sin asumir:** ¿el porcentaje es un dial global, por rareza, o por
  carta? ¿la promesa caduca? ¿se avisa al cliente cuando la conseguimos, y con qué plazo para que
  responda? ¿la wishlist es privada o alimenta un ranking público («las más buscadas»)?
- **Rol dueño:** arquitecto (diseño) → backend + frontend. **Sin empezar hasta que el humano cierre
  el alcance.**

#### P-57 · 👤 LA CUENTA DEL CLIENTE — el hueco más grande, y son tres cosas del mismo frente
Encontrado por el humano probando en producción. Las tres se sirven juntas o ninguna funciona bien.

- **(a) No existe pantalla de perfil.** Verificado: no hay ninguna ruta de perfil ni de cuenta. El
  cliente **no puede ver ni cambiar** su correo, sus direcciones, sus datos de facturación ni el
  estado de su verificación. **El servidor YA lo expone todo** (`GET`/`PATCH /users/me`, direcciones,
  facturación, KYC): falta solo la pantalla. ⚠️ Consecuencia medida: `PHONE_REQUIRED` bloquea vender
  y el contrato manda «pedir el dato y reintentar» — **sin perfil no había dónde**, así que una
  cuenta de Google quedaba bloqueada sin salida (paliado con captura inline en el diálogo de venta).
- **(b) Los pedidos de invitado no se pueden reclamar desde la cuenta.** El mecanismo existe entero y
  está bien hecho (prueba de titularidad = correo verificado; el enlace de seguimiento sirve para
  LEER, nunca para APROPIARSE; `GET /orders/claimable` no es un oráculo). Pero **solo se ofrece en la
  confirmación de compra y en el seguimiento público**: si el cliente cierra esa pestaña, **no hay
  pantalla que se lo vuelva a ofrecer**. `GET /orders/claimable` **no lo consume nadie**.
  ⇒ Cada compra de invitado no reclamada en el momento **se queda fuera de la bóveda para siempre**,
  y la bóveda es la propuesta de valor. **Dónde ponerlo (decidido con el humano):** aviso en **la
  bóveda** (es donde se nota la ausencia) **y** en pedidos (los enviados a domicilio nunca pasan por
  la bóveda). Que desaparezca al reclamar y que no aparezca vacío.
- **(c) La navegación está partida en siete.** Hoy el menú tiene catálogo, compra, sellado, vender,
  órdenes, envíos y bóveda — y **las solicitudes de venta no están**: solo se llega por dentro de
  Vender o por el correo. Propuesta del humano, que suscribo: **consolidar** compras + ventas +
  estado de solicitudes en un solo sitio, y **mover los retiros a la bóveda** (un retiro es una
  acción sobre la bóveda). ⚠️ Matiz de nombre: «orden» se lee como *compra*; si ahí van las ventas,
  hacen falta **pestañas explícitas** o un nombre neutro, o el vendedor no las busca ahí.
- **Rol dueño:** ux-ui (rediseño de navegación) → frontend. **Cero backend**: los endpoints existen.

#### P-58 · 🔴 «Marcar recibida» se ofrece desde CUALQUIER estado — se salta el pacto
- **Encontrado por el humano** mirando la pantalla; **seguridad lo había visto por el código** en su
  pase y lo dejó anotado. Dos caminos independientes, mismo hallazgo.
- **Medido:** la guarda de `receive` (`buylist.service.ts:5488`) es `liveRequestWhere()` — solo exige
  que la solicitud no esté cerrada, **no que esté en el paso correcto**. Y la interfaz ofrece el
  botón desde el paso 1.
- **Por qué importa, y no es cosmético:** desde **«Cotizada»** marcar recibida salta al paso 5 **sin
  que exista precio pactado ni aceptación del vendedor** — acabas con las cartas de alguien sin
  acuerdo. Desde **«Ofertada»** es peor: **le cierra la ventana al vendedor**, que ya no puede
  aceptar ni declinar.

- **⚠️⚠️ ANTES DE TOCAR LA GUARDA — LEER ESTO (medido 2026-09-08, y contradice la cura obvia).**
  La guarda **NO está floja por descuido: está por EXCLUSIÓN a propósito**, y el porqué está escrito
  en el bloque de documentación de `receive`. Los hechos que dejó quien la escribió:
  - **La mesa dispara los verbos EN CADENA.** En el incidente que originó la guarda, `receive` y
    `verify` se ejecutaron seguidos tras `confirm-shipment`, y **la bitácora real muestra
    `receive`→`verify` con 20 ms de diferencia**. No es un caso teórico: es cómo se trabaja.
  - Su regla, textual: *«Una guarda que rompe el trabajo legítimo del día siguiente no es más segura:
    es la que alguien acaba desactivando.»* Misma dirección que el **criterio 129** (estados vivos
    por complemento): olvidarse falla hacia el lado seguro.
  - El segundo término, `closedAt: null`, **no es redundante** aunque lo parezca: ya hubo en la base
    filas con `closedAt` sellado y estado no-terminal, y sobre ésas el término de estado por sí solo
    dejaba pasar la transición. *Una guarda no puede apoyarse en el invariante que el bug rompió.*
  ⇒ **Apretar a «solo desde el estado X» sin más inventaría una máquina de estados que la mesa no
  usa, y rompería la operación real.** Quien lo intente sin leer ese bloque va a romper algo que hoy
  funciona y a creer que lo arregló.

- **Cómo se cierra bien, en dos mitades separables:**
  1. **La barata y sin riesgo (hacer ya):** que **la interfaz no ofrezca el botón donde no toca**.
     Eso quita el 100% del camino accidental —que es como lo encontró el humano— **sin tocar la
     guarda del servidor**. Rol: **frontend**.
  2. **La de fondo (decisión, no parche):** ¿desde qué estados es legítimo `receive`? Lo decide el
     **arquitecto**, y con las dos evidencias delante: el agujero del pacto **y** el encadenamiento
     de 20 ms de la mesa. Si de ahí sale una guarda más apretada, la escribe **backend**.
- **Rol dueño:** frontend (mitad 1, ya) · arquitecto → backend (mitad 2, con la evidencia de arriba).

#### P-59 · 🛑 La reserva propia bloquea el reintento del mismo cliente
- **Encontrado por el humano:** se le congeló el pago, reintentó, y **la carta ya no estaba** —
  la había reservado su propio intento fallido.
- **Medido:** el inventario se reserva **60 minutos** (`GUEST_ORDER_RESERVATION_TTL_MIN`) y un
  barrido cada 15 minutos libera lo no pagado. **No se pierde nada** — pero el cliente espera hasta
  una hora por un pago que se le cayó, y ve «no disponible» sin explicación.
- **Lo correcto:** que el mismo cliente/sesión **recupere su propia reserva** al reintentar, en vez
  de chocar contra ella. **Rol dueño:** arquitecto → backend.

#### P-60 · ✉️ Entregabilidad del correo: falta DMARC y el dominio es nuevo
- **Medido:** el correo de la oferta **se mandó y se entregó** (Resend: `Delivered`) — y **cayó en
  spam** en Hotmail. No es defecto de código: es reputación. `tcghunt.mx` tiene 17 días y **dos
  correos en 15 días**; SPF y DKIM verificados, **DMARC ausente**.
- **⚠️ Por qué urge más de lo que parece:** el correo de **verificación de cuenta** es la puerta de
  entrada — sin verificar, el sistema **bloquea comprar y vender**. Si ese correo cae en spam, el
  usuario nuevo se va y **nadie se entera**.
- **Acción (humano/devops):** registro TXT `_dmarc` con `v=DMARC1; p=none; rua=mailto:…` (modo
  observación, sin riesgo); marcar los correos como «no es spam»; el volumen hace el resto.

#### P-61 · 🖼️ El catálogo de Vender se ve chico — carrito a pop-up
- **Propuesta del humano:** mover el carrito a un pop-up y usar ese espacio para mostrar las cartas
  más grandes, como en el inventario de admin.
- **⚠️ Restricción que el diseño debe respetar:** ese panel carga hoy **dos cosas que no pueden
  esconderse**: la llamada a **iniciar sesión** (es donde el vendedor descubre que necesita cuenta) y
  el mensaje de que **la guía la ponemos nosotros y no paga nada de su bolsillo** (responde la duda
  que frena al vendedor primerizo). Hay que **reubicarlas**, no solo mover el carrito.
- **Rol dueño:** ux-ui → frontend.

#### ~~P-62 · 🏷️ Renombrar «Costo de procesamiento»~~ — ✅ HECHO (2026-09-08), y **la recomendación que traía era la EQUIVOCADA**
- **Cerrado.** El checkout dice **«Comisión de plataforma»** · *«Nuestra comisión por operar tu compra en
  TCG HUNT. Ya está incluida en el total que ves aquí.»* La clave se renombró a `checkout.platformFee`.
- ⚠️⚠️ **Lo que esta ficha recomendaba era la opción (b), «Comisión por procesamiento de pago», con el
  argumento de que “quita lo feo sin cambiar lo que dice”. Esa opción está DESCARTADA, y no por
  preferencia:** el humano informó (2026-09-08) que **trasladar al cliente la comisión del procesador es
  ilegal en México**, así que «no cambiar lo que dice» era exactamente lo que NO se podía hacer. Queda
  escrito para que nadie la reabra leyendo la recomendación vieja.
- **Y el problema nunca fue el nombre: era la frase.** El texto viejo declaraba por escrito, en la
  pantalla de pago, que trasladamos ese costo. Se borró entera; la nueva **no afirma nada jurídico y
  tampoco lo niega** — una negación defensiva introduce el tema y sigue siendo una afirmación que habría
  que sostener.
- ⛔ **Lo que NO se tocó, y no se toca:** los rótulos de Stripe del back-office (diales de M10, línea del
  P&L de M7). Ahí Stripe **sí** es un costo nuestro y nombrarlo es lo honesto. **Un barrido con `grep`
  de «Stripe» rompe la contabilidad del panel** — hay un candado que lo caza.
- 🕐 **Pendiente del humano, con disparador DURO:** **no tiene abogado todavía**. Ese texto de cliente
  **debe revisarse con abogado antes de crecer en volumen**. Ni el equipo ni el orquestador escriben
  afirmaciones jurídicas mientras tanto.

#### P-63 · 💱 Falta `BANXICO_SIE_TOKEN` — el tipo de cambio no se actualiza
- **Medido en los logs de producción**, repetido: *«Sin `BANXICO_SIE_TOKEN`: fx-refresh no puede
  consultar; usa override/último valor»*. Los precios de mercado vienen en USD y se convierten a
  MXN: **sin token el tipo de cambio se congela** en el último valor o en el manual.
- No rompe nada hoy, pero **si el peso se mueve, cotizas compra y venta con un tipo viejo**.
- **Rol dueño:** devops (variable de entorno) — el token lo obtiene el humano de Banxico.

</details>

#### ~~P-64 · 📄 `HANDOFF.md` desactualizado~~ — ✅ HECHO Y EN PRODUCCIÓN (2026-09-08)
- devops barrió el fichero entero, no solo las cinco líneas reportadas. Verificado: las dos menciones que quedan del dominio viejo son la nota explícita de que está **RETIRADO**. Y dejó fijado que el nombre interno `tcg-vault-mx` **sí** es correcto — la trampa del siguiente que haga ese grep.

<details><summary>original</summary>

#### P-64 · 📄 `HANDOFF.md` desactualizado — dice un dominio de correo que ya no es
- Afirma que el dominio verificado en Resend es `tcgvaultmx.com`; **el que se usa y está verificado
  es `tcghunt.mx`** (medido en los logs y en Resend). Misma clase que los ocho tachones de D52: un
  documento afirmando un estado que la realidad dejó atrás. **Rol dueño:** devops.

</details>

#### P-65 · 🖼️ Las fotos tardan 5–10 s en aparecer — reportado por el humano
- **Medido en el código (no supuesto): no es una causa, son cuatro eslabones EN SERIE.**
  1. **La home y el catálogo son pantallas de cliente** (`'use client'` + TanStack Query en
     `frontend/src/app/[locale]/(storefront)/page.tsx`). Antes de que exista siquiera la *dirección*
     de la primera foto hay que: bajar el HTML → bajar y arrancar el JavaScript → preguntar al
     backend → recibir respuesta. **La foto empieza a bajarse en el cuarto viaje, no en el primero.**
  2. **La teja líder del carrusel pide la imagen HD** (`FeaturedCarousel.tsx:708`,
     `imageLargeUrl` → `_hires.png` de pokemontcg.io: cientos de KB, frente a las ~40–60 KB de la
     chica). Es justo la imagen que decide cuándo el visitante siente que «ya cargó la página».
  3. **Las fotos no pasan por nosotros.** Todas se piden directo a `images.pokemontcg.io` con `<img>`
     plano (`components/ui/CardImage.tsx`): ni las redimensionamos, ni las convertimos a formato
     moderno, ni las guardamos en caché propia. Cada visitante paga el viaje al servidor del
     proveedor, con su latencia y el peso original.
     - ⚠️ **CORRECCIÓN (2026-09-08, mía).** Aquí decía que *«el único sitio del front que usa el
       optimizador de Next es el logo de expansión (`SetPlate.tsx`)»*. **Es falso.** Lo deduje de que
       un `grep` de `next/image` devolvía ese fichero — y **la coincidencia era un COMENTARIO** que
       dice literalmente *«sin next/image»*. **No hay una sola línea de `next/image` en el frontend**:
       todas las imágenes son `<img>` crudo (Nivel B, `ARCHITECTURE §4.41.7`). Propagué el error a un
       encargo de seguridad y ahí hizo ver un riesgo más pequeño de lo que era; lo cazó el agente al
       verificar en vez de ejecutar. **La lección: un `grep` dice dónde aparece un texto, no qué hace
       el código.**
  4. Las demás van en `lazy` y eso **está bien** — no es ahí donde se van los segundos.
- **Lo que NO pude medir desde aquí, y decide cuál es la cura:** este contenedor tiene bloqueada la
  salida a internet (`tcghunt.mx` e `images.pokemontcg.io` devuelven 403 en el proxy), así que **no
  sé cuál de los cuatro eslabones se lleva los segundos**. La distinción no es un detalle: si el que
  tarda es el backend (Railway despertando, o la consulta de catálogo), optimizar imágenes **no
  arregla nada**.
  - **Dato que el humano da en un minuto:** F12 → pestaña **Red** → recargar → decir (a) cuánto tarda
    la llamada al backend y (b) cuánto tarda la primera foto. Con eso se sabe qué atacar.
- **Palancas, de más barata a más cara** (todas reales, ninguna aplicada):
  - **(a)** usar la imagen chica también en la teja líder — una línea, ahorra cientos de KB en la
    imagen que marca el tiempo percibido;
  - **(b)** servir las fotos por el optimizador de Next/Vercel (redimensiona + WebP + caché en el
    borde) — cambio acotado en `CardImage`. ⚠️ consume cuota de Vercel, **que ya está al 75%**;
  - **(c)** pintar la primera pantalla en el servidor, para que la foto empiece a bajar en el primer
    viaje y no en el cuarto — cambio grande: es rediseñar cómo carga la home;
  - **(d)** copiar las fotos a almacenamiento propio (R2) y servirlas desde ahí — quita la
    dependencia del tercero; es un proyecto aparte.
- **Cruce:** (b) y (d) tocan `remotePatterns` de `frontend/next.config.mjs`, hoy abierto a
  `hostname: '**'` (cualquier host) — mismo terreno que la deuda **M47-R1**.
- **Rol dueño:** frontend para (a) y (b); arquitecto si se va a (c) o (d).
  **Antes de tocar nada: la medición del navegador.**

#### P-66 · 🧟 Dar una vuelta al panel de administración — ✅ DIAGNOSTICADO (ux-review, 2026-09-08) · **VEREDICTO: RECHAZADO**
- **Pedido del humano:** *«siento que tenemos varios zombies ahí que no nos ayudan, o temas de navegabilidad»*.
- **Cómo se midió:** bundle de producción con mocks recompilado sobre `9ff373f`, recorrido en Chromium a
  **1280×800 y 390×844**, como `super_admin` y como `vault_operator`. Lo no medido va marcado como tal.

##### 🔴 Bloqueantes
- **B1 · M5 (Buylist) enseña TODO lo que existe, no lo que toca ahora.** **Diez pestañas en dos barras
  apiladas** (4 «colas del ciclo» + 6 de estado) y dos jerarquías en la misma pantalla. En «Verificando»,
  una solicitud de 3 cartas pinta **14 botones**; con 4 solicitudes es una pared, y **«Pagar por SPEI»
  —dinero— queda al fondo**. La única pista de qué toca ahora va en 11 px. Y la lista de solicitudes
  empieza a **≈660 px en escritorio y ≈880 px en móvil** (bajo el pliegue): esto es, literalmente, lo que
  el humano llamó *«súper escondidas»*. **Rol:** ux-ui → frontend.
  - ⚠️ **P-58 confirmado y precisado:** «Marcar recibida» **no es una fuga** — está cableado a `status ===
    'cotizada'` **a propósito**, o sea exactamente al paso donde no debería estar.
- **B2 · Tres pantallas DESBORDAN en 390 px** (medido, `scrollWidth − innerWidth`): **M5 +419 px**
  (la página se renderiza a 809 px: hay que hacer scroll lateral para llegar a «AUTORIZAR Y MANDAR»),
  **M1 +89 px**, **M2 +35 px**. Las tres se saltan `DataTable`, que **sí** colapsa a tarjetas. *(Bounties
  ya no desborda: 0 px, verificado.)* **Rol:** frontend. ⚠️ **Si el humano no usa el teléfono, baja a
  importante** — es la pregunta 1 de abajo.
- **B3 · Las pantallas de dinero hablan en identificadores, no en personas.** M3 y M4 pintan `u-777`,
  `u-778` como «usuario»: para saber a quién le vendió hay que ir a M6 con el id en la cabeza. M10 pinta
  `u-admin`/`SUPER_ADMIN`/`settings.update`; M6 pinta `CUSTOMER`/`VAULT_OPERATOR`. **§9.2 del sistema de
  diseño dice «nunca se pinta el enum crudo».** ⭐ **M5 ya lo resolvió** (nombre + correo + enlace a la
  ficha): la cura existe en el mismo panel. **Rol:** frontend; arquitecto+backend si M3 necesita el DTO.

##### 🟠 Importantes
- **I1 · Zombies confirmados** *(no se retira nada sin producto y sin el humano)*: **M9 Reportes** — de sus
  tres secciones, **dos son las mismas de M7** (mismo rango de fechas, **los mismos tres botones de
  exportar, misma función**); lo único propio son 4 tarjetas cuyo subtítulo dice *«Avance de la beta
  cerrada frente a las metas N/X/Y/Z»* (álgebra en pantalla, y «beta cerrada» estando en producción).
  Y la **tarjeta «Progreso de lanzamiento» del dashboard está INERTE POR CONSTRUCCIÓN**: pinta «Meta
  pendiente» **sin condición**, y su DTO ni siquiera tiene metas ⇒ con los mismos datos, M9 dice 42 % y el
  dashboard dice «Meta pendiente». **Los mismos cuatro contadores aparecen en tres sitios.**
  **Rol:** product-owner decide → ux-ui redacta → frontend cablea.
- **I2 · La navegación rotula por código, y el código no sirve para nada.** Los códigos **no llevan orden**
  (M1, Bóvedas, M4, M5, M8 / M2 / M3, M7, M9 / M6, M10) y **tres destinos no tienen código**: no ordenan ni
  identifican, solo **desplazan el nombre 5 caracteres a la derecha en 12 filas**. El rótulo del menú y el
  título de la página **difieren en 6 de 12**. Las solicitudes de venta se llaman **«Buylist»** en el menú
  y **«Solicitudes de venta»** en M6 — *el humano las buscó por su nombre y no las encontró*. La etiqueta
  «SÚPER» sale en **7 de 12 filas** también para el súper-admin, que es el único que la ve.
  **Rol:** ux-ui → frontend.
- **I3 · M2 es UNA página de 7.986 px, 11 secciones y 61 botones**, con una barra pegajosa
  («GUARDAR CURVA») fija al pie **desde el primer scroll**: quien está en «Tipo de cambio» ve un botón que
  no le corresponde. **Rol:** ux-ui / frontend.
- **I4 · M8 le habla al dueño como si fuera el cliente** («Envía **tu** evidencia por correo… citando **tu**
  número de orden») y **no tiene estado vacío**: con cero disputas queda en blanco. **Rol:** frontend.
- **I5 · El sistema de diseño afirma seis cosas que el panel NO cumple** — buscador global en el topbar
  (no existe), barra inferior en móvil (no existe), la lista de grupos de §7.15 (desactualizada), tarjetas
  del dashboard clicables + semáforo + barras (no existen), colapso a tarjetas en `<md` (falso fuera de
  `DataTable`), y **objetivos táctiles ≥44 px** (medido en el topbar: 15×25, 111×17, 101×16).
  **Misma clase que los ocho tachones de D52: o se implementan o ux-ui las retira.**
- **I6 · M3 muestra su única acción como lo más llamativo:** «REEMBOLSAR» en bermellón sólido —dinero que
  sale— sin detalle de orden, sin enlace al envío ni al comprador.

##### ✅ Lo que está bien y NO se toca
Foco de teclado visible · M1 cumple §16.1 · **Bóvedas de clientes y Bounties son las dos pantallas más
limpias del panel** · **M4 tiene estado vacío y acciones acotadas por estado — es el patrón que le falta a
M5** · los enlaces de «Cola de trabajo» del dashboard sí llevan a su módulo.

##### ❓ No medido, y hace falta
Volumen real de datos (colas con decenas de filas cambian la lectura de M5 y M3), si las metas de M9 están
fijadas **en producción**, y **el uso real de cada destino**. Hay 12 preguntas cortas para el humano en el
reporte; las cuatro que más cambian el trabajo: **¿entra desde el teléfono?** (decide si B2 bloquea),
**¿fijó las metas N/X/Y/Z?** (decide si M9 es zombie), **¿entra alguien más al panel?** (decide el trato de
roles) y **¿cómo le llama a M5?**.


##### ✅ Respuestas del humano (2026-09-08) — reordenan el trabajo
| Pregunta | Respuesta | Qué cambia |
|---|---|---|
| ¿Entra desde el teléfono? | **No, solo computadora** | ⬇️ **B2 (las tres pantallas que desbordan en 390 px) BAJA a deuda registrada.** No se gasta tiempo ahí ahora. Se anota con su medición para el día que use el móvil o entre un operador que sí |
| ¿Las metas `N/X/Y/Z`? | **No existen — y quiere una pestaña de analytics de verdad, pero primero saber qué datos hay** | ➡️ **M9 NO se retira: es la semilla.** Nace **P-67** (inventario de datos). Sí se corrige ya el «beta cerrada» |
| ¿Alguien más en el panel? | **Todavía no, pero pronto** | Se optimiza para él primero, **sin cerrarle la puerta al operador**. La etiqueta «SÚPER» en 7 de 12 filas **no se quita**: pronto informará |
| ¿Qué usó la última semana? | **M3 · Ventas** y **M10 · Config** (⛔ **no** M8, **no** M9) | ⬆️ **B3 sube**: M3 es de uso real y le enseña `u-777` en vez del comprador. ⬆️ M10 (el ensayo de ingeniería dentro del formulario). ⬇️ **M8 baja** — no lo usó, y lo más probable es que sea porque **no ha habido disputas**, no porque sobre: es una pantalla que espera, no un zombie |

##### 🎯 Orden de trabajo resultante
1. **B1 · M5 en computadora** — la pantalla que más usa, diez pestañas y catorce botones por solicitud.
2. **B3 · M3 y M10** — identificadores en vez de personas, en pantallas de uso diario.
3. **P-67** — el inventario de datos, que desbloquea la pestaña de analytics.
4. **I2 · los rótulos del menú** — barato y se nota todos los días.
5. **I1 (dashboard)** — la tarjeta de progreso inerte: se quita o se conecta.
6. ⬇️ **B2 (móvil)**, **I4 (M8)** — deuda registrada, con su medición, para cuando toque.

#### P-67 · 📊 Inventario de datos para analytics — «¿qué podemos medir hoy?» — pedido por el humano
- **Lo que dijo, literal (2026-09-08):** *«SÍ me interesa generar una tab de analytics y reportes, sin
  embargo creo falta saber bien qué datos están disponibles para ver si hay que crear track de algo y
  elegir de lo que hay.»*
- **La pregunta es la correcta y va PRIMERO.** Diseñar un tablero antes de saber qué se puede medir es
  cómo nacieron las metas `N/X/Y/Z`: un marco de reporte sin datos detrás que lleva meses enseñando
  «Meta sin fijar». **No se diseña ninguna pantalla hasta que este inventario exista.**
- **Qué hay que producir** — un documento que el humano pueda leer y elegir, no una lista de tablas:
  1. **Lo que YA se guarda y se puede reportar hoy**, en lenguaje de negocio (qué se vendió, a quién, a
     qué precio, con qué margen, cuánto se pagó en compras, qué inventario hay y cuánto vale, KYC,
     disputas, retiros). Con **la granularidad real** (¿por día? ¿por pieza? ¿por set?) y **desde cuándo
     hay historia** — un dato que empieza el mes pasado no sirve para una tendencia anual.
  2. **Lo que se guarda pero NO es reportable todavía** y qué faltaría para que lo fuera.
  3. **Lo que NO se guarda y habría que empezar a registrar** (el «crear track de algo» que él nombra),
     con el costo de empezar a hacerlo y **desde cuándo tendría historia** — porque lo que se empieza a
     registrar hoy no tiene pasado.
  4. ⚠️ **Las trampas conocidas**, que ya nos mordieron: el P&L del tablero suma un campo a secas
     mientras el control antilavado usa una cascada con respaldo; y `PriceReference` escribe ~28.559
     filas/día (P-53) — cualquier reporte histórico de precios se apoya en esa tabla.
- **Cómo se hace, y en qué orden:** un pase de **lectura** (arquitecto o backend, sin escribir código)
  que produzca el inventario → el **humano elige** qué quiere ver → **product-owner** aterriza el
  alcance → recién entonces arquitecto/ux-ui/frontend.
- **Cruce con P-66:** de las tres secciones de **M9 Reportes**, dos son **idénticas a M7**; lo único
  propio son las tarjetas de `N/X/Y/Z`. ⇒ **M9 no se retira todavía: es la semilla de este trabajo.**
  Lo que sí se corrige ya es que hable de «beta cerrada» estando en producción.
- **Rol dueño:** arquitecto/backend (inventario, solo lectura) → product-owner → ux-ui → frontend.

#### P-68 · 💱 Una consulta de UNA fila antes de publicar el interruptor del tipo de cambio (I-1)
- **El escenario, en lenguaje de dinero:** existe un estado en el que **publicar el interruptor de FX,
  sin que nadie apriete nada, movería los precios ~5 %** (de 19.00 a 18.00, el fallback duro). Es
  exactamente el movimiento que el acuse de confirmación existe para impedir — y ahí ocurriría sin un
  solo clic. QA lo clasificó como **«no aceptable sin decisión explícita del humano»**.
- **Qué lo dispara, verificado en el código** (`backend/src/common/fx-mode.ts:157` y
  `backend/src/modules/pricing/fx.service.ts:85`), no supuesto:
  1. Al desplegar, la fila `fx_rate_mode` todavía no existe (o vale el centinela `"legacy"`), así que
     `resolveFxMode()` **infiere** el modo en lugar de leerlo. Esa inferencia corre **una sola vez por
     entorno** y deja de correr en cuanto un humano toca el interruptor.
  2. La inferencia mira **un solo valor**: el ajuste `fx_manual_override_rate`.
     - Si **tiene número** ⇒ resuelve `manual` ⇒ rige ese número. **Nada se mueve.** ✅
     - Si está **vacío/nulo** ⇒ resuelve `auto` ⇒ rige la última fila `FxRate` de origen **`banxico`**,
       y si no hay ninguna, el **fallback duro de 18**. ⚠️ Ahí está el −5 %.
- ⚠️ **Corrección a lo que dije antes:** dije que «el 19.0000 puesto» protege producción. Es cierto
  **solo si ese 19.0000 vive en el ajuste `fx_manual_override_rate`**. La pantalla de admin escribe
  las dos cosas a la vez (`setManual()` guarda el ajuste **y** una fila `FxRate` de origen `manual`),
  así que si el número se puso por la pantalla, está protegido. Pero **la fila `FxRate` manual NO rige
  nunca** (I-FX5, es solo traza forense): si ese 19.0000 llegó por un script o una migración vieja y
  el ajuste quedó vacío, la protección **no existe**. No es una cosa que se pueda razonar desde el
  código: **depende de un valor que solo está en la base de producción.**
- **La cura, y ya está escrita: UNA consulta de solo lectura que emite su propio veredicto.**
  Se corre en **cada entorno** (staging y producción) antes de promover. No modifica nada.

  ```sql
  SELECT
    COALESCE((SELECT "valueJson" #>> '{}' FROM "ConfigSetting" WHERE key = 'fx_rate_mode'), '(no existe)') AS modo_guardado,
    COALESCE((SELECT "valueJson" #>> '{}' FROM "ConfigSetting" WHERE key = 'fx_manual_override_rate'), '(vacio)') AS tasa_manual,
    (SELECT count(*) FROM "FxRate" WHERE source = 'banxico') AS filas_banxico,
    CASE
      WHEN (SELECT "valueJson" #>> '{}' FROM "ConfigSetting" WHERE key = 'fx_rate_mode') IN ('auto','manual')
        THEN 'SEGURO — el modo esta puesto explicitamente, publicar no lo cambia'
      WHEN (SELECT "valueJson" FROM "ConfigSetting" WHERE key = 'fx_manual_override_rate') IS NOT NULL
       AND (SELECT "valueJson" FROM "ConfigSetting" WHERE key = 'fx_manual_override_rate') <> 'null'::jsonb
        THEN 'SEGURO — hay tasa manual guardada: al publicar resuelve a MANUAL y rige ese numero'
      ELSE 'PELIGRO — sin modo y sin tasa manual: al publicar resuelve a AUTOMATICO'
    END AS veredicto;
  ```

- ⭐ **La consulta SE PUEDE PONER EN ROJO — verificado por el orquestador (2026-09-09), no supuesto.**
  Se probó contra una base desechable en los tres estados, porque una consulta que solo sabe decir
  «seguro» no sirve de nada, igual que un candado que no puede ponerse rojo:
  | Estado sembrado | Veredicto que emitió |
  |---|---|
  | `fx_rate_mode = 'auto'` | ✅ SEGURO — el modo está puesto explícitamente |
  | sin fila de modo, **con** `19.0` guardado | ✅ SEGURO — resuelve a MANUAL y rige ese número |
  | sin fila de modo y **sin** tasa manual | 🔴 **PELIGRO** — resuelve a AUTOMÁTICO |
- **Qué hacer con cada resultado:** `SEGURO` ⇒ se publica sin riesgo. `PELIGRO` ⇒ **no se publica**
  hasta fijar el modo a mano (o guardar la tasa manual), y entonces se vuelve a correr.
- **Rol dueño:** devops (la consulta previa al deploy) · backend (la tercera fixture FX-6 que cubre el
  estado) · arquitecto (declarar el riesgo residual si se decide publicar sin la consulta).
- **Estado:** ⛔ **BLOQUEA el merge del interruptor de FX** hasta que el humano decida.


#### P-69 · 📦 El precio de mercado se pierde entre el paso 1 y el paso 2 al subir sellado — reportado por el humano
- **Lo que dijo, literal (2026-09-09):** *«subiendo producto sellado me aparece el precio de mercado, en la
  siguiente pagina dice que no tiene el precio y no puedo ponerle como aportacion»*. Con captura.
- **El síntoma, con el dato de la captura:** en el diálogo «Agregar producto sellado», **paso 1 de 2 ·
  ELIGE PRODUCTO**, con el set *Phantasmal Flames (2025)*, la tarjeta seleccionada
  («Phantasmal Flames Elite Trainer Box») muestra **`MX$2,981.67 MERCADO`**. En el **paso 2**, ese
  **mismo** producto aparece **sin precio**, y por eso **no se puede registrar como «aportación»**.
- ⚠️ **Lo que hace esto distinto de «falta un precio»:** el paso 1 **sí sabe** distinguir los dos casos, y
  lo hace bien — la cabecera dice *«25 presentaciones · 23 con precio · 2 pendientes de precio»* y otra
  tarjeta muestra **`SIN PRECIO DE MERCADO`** en rojo. Así que no es que el catálogo no tenga el dato:
  **es que los dos pasos no coinciden sobre el mismo producto.** Uno de los dos miente.
- **Por qué importa y no es cosmético:** bloquea **meter inventario**, que es la operación diaria del
  negocio. Y si el que miente resultara ser el **paso 1**, sería peor que el síntoma reportado — el dueño
  estaría viendo un número en el que confía para decidir cuánto paga.
- **Hipótesis a descartar CON CÓDIGO, ninguna confirmada todavía:** (a) dos fuentes distintas — el paso 1
  pinta un campo del listado y el paso 2 lo vuelve a pedir por otra ruta; (b) el acabado/variante — el
  precio del paso 1 cuelga de una variante y el paso 2 pregunta por otra (⚠️ regla dura del proyecto:
  **nunca se copia el precio de un acabado a otro**); (c) se pierde el identificador entre pasos;
  (d) semántica de omisión — el paso 2 lee «ausente» como «sin precio» cuando significa «no pedido»;
  (e) una condición extra del paso 2 (frescura, moneda, fila de referencia de hoy).
- **Segunda pregunta abierta:** ¿el bloqueo de «aportación» sin precio es **regla de negocio deliberada**
  (no se aporta lo que no está valuado) o efecto colateral? Si es deliberada, la regla está bien y el bug
  es solo que el precio se pierde.
- **Estado:** ✅ **DIAGNOSTICADO (2026-09-09). El que miente es el PASO 1.**
- **La causa, medida en código:** son **dos campos distintos que viajan en la MISMA respuesta del MISMO
  endpoint** — no se pierde ningún id, no se re-pide nada, no hay acabado de por medio.
  - **Paso 1** pinta `SealedProductDTO.marketRef` (`SealedProductPicker.tsx:216-217`): lectura **viva/caché
    de TCGCSV**, **sin gatear** por el dial y **sin respaldo en una fila `PriceReference`**.
  - **Paso 2** pinta `SealedProductDTO.effectiveMarketCents` (`SealedAddFlow.tsx:172`): el mercado
    **autoritativo**, ya pasado por `gateSealedMarketCents` (`pricing.service.ts:1763-1780`) con el dial
    `sealedPriceSource`.
  - ⇒ **El paso 2 dice la verdad: es lo que el backend aceptaría. El paso 1 enseña un número que el
    backend rechazaría** — inerte a efectos de dinero: no valúa la aportación, no publica, no fija venta.
- ⚠️ **Y es una regresión conocida a medio aplicar:** este es el mismo «dead-end de IMP-1» que se corrigió
  en v1.41 (`BACKEND_NOTES.md:14867-14884`, `FRONTEND_NOTES.md:8121-8145`, con test de regresión en
  `SealedAddFlow.test.tsx:221-257`). **Ese arreglo se aplicó al paso 2 y NO al paso 1.** La teja del picker
  se quedó en la semántica vieja — y `DESIGN_SYSTEM.md:3212-3213` todavía la respalda así, o sea que la
  especificación también quedó desalineada con la doctrina.
- **El bloqueo de «aportación» NO es el bug — es regla deliberada y correcta.** «Aportación» es
  `acquisitionType:'aportacion_en_especie'` con `pct:100`: el dueño no paga la pieza y el sistema le
  acredita un costo **valuado contra la referencia de mercado**. Sin referencia no hay número con el que
  acreditarla, y `inventory.service.ts:729-761` responde `422 PRICE_PENDING` en vez de valuar en $0. Eso es
  la doctrina money-safe funcionando. **El bug es que el paso 1 promete un valor que el backend no
  reconoce, y el operador llega al paso 2 sin entender por qué se le cerró la puerta.**
- **Agravante medido:** `SealedProductListResponse.sealedPriceSource` **ya llega al frontend**
  (`sealed-product.service.ts:63`, `:246`) y **el flujo no lo usa en ninguna parte**. El dato para
  explicarle al operador «la fuente automática está apagada, estos números son informativos» ya está en la
  respuesta, sin consumir.
- **El arreglo — rol dueño principal: `frontend`.**
  1. `SealedProductPicker.tsx:216-217`: la teja se keyea en `product.effectiveMarketCents`, igual que el
     paso 2. Con eso los dos pasos coinciden **por construcción** y desaparece el número que engaña.
  2. Si se quiere conservar el informativo, que sea **explícitamente secundario** (otra etiqueta, no
     «MERCADO»), nunca el número principal de la teja. ⛔ Y jamás $0: sin valor va «—» o «pendiente».
  3. `SealedProductPicker.tsx:219-226`: el `aria-label` arrastra el mismo error para lectores de pantalla.
  4. Consumir `sealedPriceSource === 'off'` para un aviso honesto **en el paso 1**.
- **Secundario, `backend` (no es la causa de esta captura, pero cierra la misma familia):** unificar el
  ancla del ingest con la del listado/alta (`sealed-price-ingest.service.ts:134-147` vs
  `sealed-product.service.ts:260` e `inventory.service.ts:822`). Es la deuda **D-2** de
  `TECH_DEBT.md:4519`, y es el **único** camino por el que el paso 2 diría «sin precio» con el dial
  encendido y precio ya ingerido. Y `pricedCount` (`sealed-product.service.ts:417-418`) cuenta hoy la
  fuente **sin gatear**: o cuenta gateado, o se renombra.
- **Lo que NO se pudo medir desde el código y hay que mirar en la instalación:** el valor real del dial
  `sealedPriceSource` (`GET /admin/settings`), si el job `sealed-price-ingest` ha corrido, y si esa ETB
  tiene fila `PriceReference` bajo el ancla del set. La hipótesis que explica la captura entera sin
  residuos es **dial en `off`** (el seed es `'off'`, `settings.constants.ts:294`), pero **es inferencia,
  no medición**.
- ⚠️ **Encender el dial NO cierra este pendiente:** aunque se prenda, el paso 1 seguiría mintiendo en
  cualquier producto sin fila. El arreglo de frontend hace falta igual.
- **Work stream:** inventario y vault — **distinto** del stream de FX que está en curso, así que no compite
  por las mismas rutas.

#### P-55 · 🛒 El carrito de venta NO sobrevive al inicio de sesión — reportado por el humano
- **Síntoma:** el cliente arma su carrito en el cotizador **sin haber iniciado sesión**; al entrar a su
  cuenta para mandar la solicitud, **el carrito se pierde** y tiene que rehacerlo.
- **Por qué importa, y no es cosmético:** el cotizador es la puerta de entrada del vendedor. Rehacer el
  carrito es fricción **justo en el paso donde ya decidió vendernos**, y el abandono ahí se lleva la
  venta entera. Es el mismo patrón que ya se curó del lado de la compra con el checkout de invitado.
- **Estado:** **pendiente, sin diagnosticar.** No se ha medido si el carrito vive en memoria, en
  `localStorage`, o si se pierde por el remonte del árbol tras autenticar.
- **Rol dueño:** frontend (y arquitecto si resulta que hay que persistirlo server-side).
- **Aplazado por decisión del humano**: lo reportó y pidió explícitamente dejarlo anotado.

### Encontrado en pruebas post-publicación (2026-08-23)

#### P-47 · 💰 El mercado se aplana a todos los acabados (normal = reverse holo = holofoil) — EN CURSO
- **Reportado por el humano:** en el binder, Normal/Reverse Holo/Holofoil de la misma carta muestran el
  **mismo MERCADO** (Dartrix 1.14=1.14; Luxray reverse 2.47=holofoil 2.47). El proveedor manda precio
  distinto por acabado; se está aplanando.
- **Causa raíz (money-adjacent):** display y clave `PriceReference` SÍ son por-acabado (sin fallback). El
  aplanamiento ocurre en la **ingesta**: el provider primario `PokemonPriceTrackerBulkProvider` en modo
  `fetchPrintings` (`pokemonpricetracker-bulk.provider.ts:268-295`, `mapEntry` rama forced `:560-564`) lee el
  `market` de **nivel carta** en las 3 pasadas → escribe el mismo precio a normal/reverse_holo/holofoil. La
  API v2 de PPT no varía el market por `?printing=`. Test que enmascara: `fix-ppt.spec.ts:84-109` (hardcodea
  3 markets distintos). Fuente correcta por-acabado = **TCGCSV `tcgcsv_singles`** (per subTypeName), con
  precedencia sobre PPT, pero solo corre en refresh/import, no en el barrido diario.
- **Parte 1 (HECHO, en prod `9c3eb3e`):** PPT ya no copia el market a las 3 impresiones — solo escribe la
  impresión primaria real; los demás acabados quedan pendiente/«—», nunca el precio de otro. Test corregido.
- **Parte 2 (contrato v1.44, arquitecto):** el barrido diario reprecio **por-acabado** desde TCGCSV
  `tcgcsv_singles` (separando estructura import/--force de precio diario); apagar `fetchPrintings` de PPT;
  §4.25a-2 corregida; §4.35 nueva.
- **Parte 3 (EN CURSO, backend):** implementar el provider/job `TcgcsvSinglesBulkPriceProvider` (precio
  por-acabado keyed por `cardProductId`, FX, respeta overrides), registrarlo como primario del barrido, PPT
  LIST fallback. Money-critical → **triple veredicto (QA+techlead+seguridad) antes de desplegar**.
- **Parte 4 (después, devops):** `PRICE_PROVIDER=tcgcsv_singles` + `POKEMONPRICETRACKER_FETCH_PRINTINGS=false`
  + orden del scheduler + runbook `--force` por set nuevo (tras merge de backend, NO en paralelo).
- **Mitigación mientras tanto:** el refresh/sync TCGCSV por set (per-acabado, gana sobre PPT) da los precios
  correctos por acabado ya.


#### P-46 · Sincronizar sellado devuelve «0 presentaciones»: el set no resuelve grupo TCGCSV (prod)
- **Reportado por el humano:** al Sincronizar sellado de **Pitch Black (2026)** (y Chaos Rising) sale «0
  presentaciones». **El botón SÍ funciona** — la sync corre.
- **Causa raíz (logs prod 2026-08-23):** `sealed-products/sync: set Pitch Black ... **sin grupo resoluble
  (ni curado ni name-match)** → nada que sincronizar (money-safe: no se adivina)`. El set no está vinculado
  a su **grupo de TCGCSV** (`tcgcsvGroupId`): ni curado a mano ni por name-match. Sin grupo no hay
  presentaciones que bajar. (Egress a tcgcsv.com OK — no hubo 502/UPSTREAM.)
- **Causa confirmada (name-match backend):** `matchScore` en `sealed-product.service.ts:777` usa
  `normalizeSetName` sobre el nombre directo, pero TCGCSV nombra los grupos con **prefijo de código**
  («SV08: Pitch Black» → `sv08pitchblack`) vs el catálogo local («Pitch Black» → `pitchblack`) → no empatan
  → 0.5 < umbral 0.9 → no auto-resuelve. Ya existe `setNameCandidates` (ppt-set-mapper:145) que quita ese
  prefijo, pero `matchScore` no la usa. **Afecta a CUALQUIER set con prefijo en TCGCSV** (no solo Pitch Black).
- **Fix (EN CURSO, backend):** `matchScore` tolerante al prefijo (reusa `setNameCandidates`) para que los
  matches legítimos suban a ≥0.9 y auto-resuelvan; **conserva** la salvaguarda «≥0.9 Y único en el tope →
  si empate, null (no adivina)». Con tests. Money-safe.
- **Workaround inmediato (humano, super_admin):** M1 → Sellado → «Agregar producto sellado» → elegir set →
  enlace «Curar/vincular grupo» (`SealedGroupLinker`) → elegir el candidato de TCGCSV (aparece con confianza
  media) → «Vincular» → re-sync automático baja las presentaciones.
- **Follow-up (frontend, no bloqueante):** UX del modal cuando la sync da 0 por «sin grupo resoluble» —
  guiar explícitamente al linker en vez de solo mostrar «0 presentaciones».

#### ~~P-45 · Badge «N EN TOTAL» del binder~~ — ✅ HECHO (arreglado en `5cdac57`; el candado se añadió el 2026-09-08)
- **Quinto pendiente desactualizado del día.** Decía «EN CURSO · fix frontend en curso»: **el arreglo ya vivía en el árbol**. Lo que faltaba era el candado, y hacía falta — una fuga que use el total de la carta **solo en el renglón de conteo** dejaba los tres tests viejos en verde.

<details><summary>original</summary>

#### P-45 · Badge «N EN TOTAL» del binder muestra el total de la carta en cada acabado — EN CURSO
- Dar de alta 2 piezas de un acabado (ej. Spinarak NORMAL) pinta «2 EN TOTAL» también en la teja de otro
  acabado con 0 piezas (Reverse Holo). Solo display (el dato es correcto, el otro acabado está en 0). Fix
  frontend en curso: cada teja muestra el conteo de SU acabado. Money-safe.

</details>

### Pendiente del humano · Razón social para el footer — ⚠️ LA NOTA ANTERIOR ERA FALSA (corregida 2026-09-08)
- **Lo que decía esta nota:** «el footer de producción aún dice [RAZÓN SOCIAL PENDIENTE]». **Medido: es
  falso.** El footer **ya omite la línea** y nunca ha enseñado el placeholder.
- **Por qué:** `resolveLegalEntity` (`frontend/src/app/[locale]/(storefront)/footer.ts`) devuelve `null`
  ante vacío, espacios o cualquier valor **entre corchetes** — y el valor real es `[Razón social
  pendiente]` / `[Legal entity pending]`. Hay tres tests que lo fijan
  (`footerLegalEntity.test.ts`). El footer publica «TCG HUNT · tcghunt.mx · © {año}», sin nada colgando.
- **Lo único que sigue pendiente**, y es dato del humano, no código: **cuál es la razón social**. El día
  que la dé, se pone en `common.footer.legalEntity` **sin corchetes** y aparece sola, sin desplegar código
  nuevo. *(El humano pidió el 2026-09-08 que «no salga de momento» — ya se cumple por construcción.)*
- ⚠️ **Lección:** esta nota afirmaba un estado de producción que nadie había medido, y llevaba semanas
  mandando a alguien a arreglar algo que ya estaba bien. Misma clase que los ocho tachones de D52.

---

## Nuevas ideas (aún NO en construcción — falta aterrizar con el humano)

### Idea · «Hunter Pulls» — mini-foro de pulls de la comunidad
- **Idea del humano (2026-08-22):** un **mini-foro** muy sencillo donde la gente pueda **subir qué pull
  hizo con nosotros** (posts con foto/descripción) y otros puedan **comentar**. Todo muy simple.
- **Requisito duro:** solo participan **usuarios registrados con nosotros** (postear y comentar exige
  cuenta). Encaja con el lenguaje de marca «cacería» (TCG HUNT 🎯).
- **Por aterrizar con product-owner:** alcance mínimo (post = imagen + texto corto + carta/set
  opcional; comentarios planos; sin votos/hilos anidados al inicio); moderación (¿quién aprueba?,
  reporte de abuso); qué se puede subir (¿ligado a una compra/pedido real con nosotros o libre?);
  privacidad/derechos de imagen; anti-spam básico.
- **Roles:** product-owner (aterriza) → arquitecto (modelo posts/comentarios + moderación + storage de
  imágenes) → backend + frontend + ux-ui. Nuevo módulo (community/social).

### Idea · Vender «meta decks» completos (bundles ready-to-play) — investigación hecha, falta aterrizar
- **Idea del humano:** apartado «Compra tu deck» — publicar los decks meta del mes como bundle completo,
  armados con nuestras cartas sueltas.
- **✅ Investigación hecha (2026-08-22):** meta Estándar post-rotación (Dragapult ex/Dusknoir el #1;
  Clefairy Box campeón NAIC; Slowking, Mega Lucario, Gholdengo; budget Crustle / Team Rocket's Mewtwo).
  Al jugador competitivo NO le importa la variante (juega la más barata legal; evitar reverse combadas).
  Pricing: suma de singles propios + premium 8–15% transparente, nunca con descuento; incluir energías
  básicas. Hueco de mercado claro en MX. Modelar como kit/BOM sobre `inventory` con stock verificado.
- **⚠ Timing:** lanzar DESPUÉS de Worlds 2026 (28–30 ago), con el meta post-Worlds.
- **Preguntas de producto:** ¿deck solo si el inventario surte la lista completa o parcial? ¿precio =
  suma de singles con ajuste o fijo por arquetipo? ¿energías/fundas incluidas?
- **Roles:** product-owner aterriza con el humano → arquitecto/backend/frontend cuando esté definido.

---

## Retirados / obsoletos

### ~~P-6 · El proveedor de precios de PAGA (PPT) no escribe precios~~ — OBSOLETO (2026-08-22)
- Superado por el rediseño de esta sesión: **TCGCSV es ahora la fuente primaria** de estructura y precio
  por variante (M-31…M-35); PPT quedó como **fallback**. Si algún día se reactiva PPT como primario,
  retomar el diagnóstico original (request `GET /api/prices?setId=…`).

---

## Hecho (referencia breve — todo en producción)

- **P-30** publicación única por carta con stock (`GroupedListingDTO` v1.38, una teja «N disponibles»,
  add-to-cart por pieza, sin migración) + **rediseño makeover 1a** del storefront (nueva capa visual,
  `StockBadge` con «Agotado»/«Queda 1») — publicados a producción (`e258da0`). Deuda H1-H4/FE-2/MK-D1..D9
  en `TECH_DEBT`.
- **P-35** alta dedicada de sellado (imagen de API, M-37), **P-34** pricing por 5 tiers (editor M2,
  invariante premium→pct, T2 a 25%, fix de dinero de las sin-mapear; Uncommon compra $0.50→$1.50), **H9**
  sellado fuera de la vista de singles — publicados a producción (`75ef123`). *(Pendiente devops:
  `unify-rarities` post-deploy, solo cosmético del editor.)*
- **P-28** carritos que no concordaban en Vender, **P-29** baja rápida de inventario (idempotente,
  money-safe), **P-31** export de inventario a Excel, **P-32** valor del set = Σ cartas (muere el
  +157,463%), **P-33** quitar selector de proveedor de respaldo — publicados a producción (`fcb07e1`).
- **Fix de variantes/precios de raíz (esta sesión):** modelo 1 carta ↔ N productos por productId exacto,
  TCGCSV fuente única de estructura+precio por variante, FX Banxico, PPT fallback, catálogo canónico de
  rarezas, «Unificar rarezas», refresh solo-TCGCSV por-set y batch, limpieza del panel admin M2
  (M-31…M-36). Fantasma `normal` muerto por construcción.
- **P-27** · Sets multi-parte combinados (Celebrations = 50) — en producción. *(Menores: P27-D2 el
  cotizador aún no combina; P27-D3 validar y activar los pares Shiny Vault — ver `TECH_DEBT.md`.)*
- **Streams A/B/C**, **P-1–P-5**, **P-11–P-22, P-24, P-25**, **P-21** (rebrand + dominio tcghunt.mx),
  **P-26** (sellado). Todo con doble/triple veredicto y en producción.

## HANDOFF (2026-08-25) — Fusión curva v2 BLOQUEADA por límite de uso
**Estado:** cierre seguro de `claude/card-pricing-rules-2e537m` (curva v2) EN CURSO, detenido por límite de uso de la cuenta (reset Aug 28, 4pm UTC). **NADA desplegado; producción intacta** (`production`=c255692). P-47 por-acabado sigue vivo en prod.
**Plan ya decidido y documentado (no re-analizar):** ARCHITECTURE §4.36 + API_CONTRACT v1.49 «Dos capas de precio». Verificado: conviven POR-ACABADO; M-41 aditiva (no toca PriceReference).
**Regla de fusión:** CONSERVAR provider `tcgcsv_singles` (P-47, capa REFERENCIA) + ADOPTAR curva v2 (capa REGLA). Único conflicto de código: `price-ingest.service.ts` (v2 borra el provider → RECHAZAR ese borrado). Restaurar 6 banderas (§4.36): PRICE_PROVIDER_VALUES, enum PriceSource, seed, registro NestJS del provider, tests, .env.example.
**Resume:** rama `integration/pricing-v2-merge` (creada desde main 6ec0722). `git merge origin/claude/card-pricing-rules-2e537m`, resolver por §4.36, validar (tsc+jest+smoke per-acabado), re-gate (QA/techlead/seguridad del delta post-5bd1975 + fusión), snapshot BD (humano), deploy nativo Railway/Vercel, runbook post-deploy (UPC spreads PUT 18/22, cut-over por sets).
**Trigger activo:** routine "Publicar curva de precios v2" (trig_01Noh8euNXLdK5uRrkTBfYh7) sigue disparando — considerar pausarla hasta el reset.

## DESPLEGADO (2026-08-28) — Motor curva v2 a producción
`production`=96580c6 (main->production). Motor de precios v2 (curva por valor de mercado) CONSERVANDO P-47 por-acabado (tcgcsv_singles). Migración M-41 aditiva. Sin snapshot (decisión del humano, opción C). Gate de release verde: QA (2139 back + 679 front), techlead (APROBADO c/deuda), seguridad (APROBADO-CON-CONDICIONES, 0 crít/0 alto).
**Post-deploy pendiente:** (1) verificar salud + curva; (2) spreads UPC 18/22 vía PUT /admin/pricing/sealed-spreads (si no, venden 25%); (3) cut-over por sets (empezar chico).
**Deuda aceptada (no bloqueante):** S49-M2 media (disparador DURO: cerrar antes del 1er RFC/CLABE/INE real — hoy BD sin PII real); E2E completa contra stack vivo (no re-corrida sobre árbol fusionado; 3 smokes de dinero rojos solo por falta STRIPE key, aceptados); test de wiring singles→reconcile (techlead); bump NestJS 11 (2 moderate deps, devops); S49-B3/candado no-raw-entity/R2/R4 (bajas).

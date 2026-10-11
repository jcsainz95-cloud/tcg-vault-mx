# LIMPIEZA DE LA BASE DE PRODUCCIÓN ANTES DE COBRAR EN REAL — `P-DB-LIMPIEZA`

> **Autor:** arquitecto · **Fecha:** 2026-10-06 · **Rama:** `claude/limpieza-db` (worktree `/home/user/tcg-limpieza`)
> **Estado:** DISEÑO. No hay SQL ejecutable aquí: el guion lo escribe **backend** con este diseño, lo revisan
> **QA + techlead + seguridad** (toca dinero y bitácora) y lo corre **el dueño** en Railway. El orquestador no toca
> producción (CLAUDE.md «Cómo se publica»).
> **Esquema contra el que se diseña:** `production` (incluye M-70 y M-71) **+ M-72** del PR #78
> (`/home/user/tcg-bsdx/backend/prisma/schema.prisma`, rama `claude/buylist-skydropx`). Qué cambia sin M-72: §11.
> **Todas las citas `fichero:línea` de código** son sobre el árbol de `/home/user/tcg-bsdx` (PR #78), medidas el
> 2026-10-06. Lo no medido va marcado **NO MEDIDO**.
>
> ⚠️ **REVISIÓN v2 (2026-10-07) — §14 MANDA SOBRE ESTE TEXTO.** El dueño cambió de decisión: **también se borra el
> inventario** (`HECHOS.md:80`). Quedan **sustituidos** por §14: §1 puntos 2–4, §2.3, la fila `InventoryBatch` y
> `PendingPriceEntry` de §2.2/§2.3, §4 entero (conjunto `T` como plan de restauración, estado destino, movimientos de
> cierre, re-publicación, P-1), §5.3, G-4 y G-6, el paso E de §8, §8.3 en lo de inventario, §9.2/§9.5 y P-1/P-2 de §10.
> Lo demás (§2.1, §2.4–§2.7, §3, §5.1–§5.2, §5.4, §6, §8.4–§8.5, §11) sigue vigente. Las citas de §14 son sobre
> `/home/user/tcg-limpieza` (rama `claude/limpieza-db`, HEAD `c313d73f` según el encargo; el sha **no lo medí yo**).

---

## 0. Qué decidió el dueño y qué se deriva (fuentes)

| Fuente | Qué dice | Consecuencia en este diseño |
|---|---|---|
| `HECHOS.md:79` (2026-10-06) | «conserva los usuarios, solicitudes de venta es todo fake, reiniciar folios. la bitácora igual límpiala» | Usuarios intactos; **todo** `SellRequest` se borra; folios «según defina el arquitecto» (§5); `AuditLog` se borra (§6). |
| `HECHOS.md:79` (b) | «las cartas no tienen folio» | Nada físico lleva `INV-`; el riesgo de `INV-` es solo de llaves en software (§5.3). |
| `HECHOS.md:16` y `:119-122` | Siempre modo prueba de Stripe; «no hay pedidos viejos, la tienda no ha procesado ninguna venta real» | **Todo** `Order`, pago, reembolso, envío, disputa y caso existente es de prueba ⇒ se borra **todo**, no una cohorte. |
| `HECHOS.md:70` (P-4, default sin respuesta) | «cartas en bóvedas de cuentas de prueba vuelven a inventario» | Las piezas en custodia de clientes vuelven a la plataforma (§4). |
| `HECHOS.md:74` | PITR archivando desde `2026-10-05 22:32:25`; respaldo manual existe; **simulacro de restauración (D-3) pendiente** | La reversa es PITR (§8.5); pregunta P-3 (§10). |
| `PENDIENTES.md:33` | Cinccino ex `INV-000892` de `TCG-000018`, marcada dañada y reembolsada: **debe volver a la venta**; `ENV-000003` existe en Skydropx (real, cancelada) | Regla general de §4 la cubre (no es un caso especial); riesgo (a) de folios medido en §5.2. |

---

## 1. Resumen de la decisión

1. **Se borra TODO lo transaccional** (pedidos, pagos, reembolsos, SPEI manuales, casos «Por reponer», colocaciones de
   bóveda, envíos y todo lo de Skydropx, disputas, solicitudes de venta, avisos de gasto, portafolios, bitácora).
2. **Se conserva TODO lo que no es transacción:** usuarios y lo suyo (KYC, facturación, direcciones, tokens), catálogo,
   precios, diales, inventario.
3. **Se re-ajusta el inventario** que tocaron las pruebas: vuelve a ser de la plataforma, sin reserva, `in_stock`
   (falla cerrado), y luego se **re-publica con la regla de precio de la app** (§4.5). Sus movimientos de prueba se borran
   y queda **un** movimiento de cierre por pieza.
4. **Folios:** `TCG-` **reinicia** en `TCG-000001`. `ENV-` e `INV-` **continúan** (§5: medido por qué reiniciarlos
   rompe algo; el dueño delegó la elección, `HECHOS.md:79` (3)).
5. **Ejecución:** un guion SQL con **ensayo en seco que termina en `ROLLBACK`** (mismo formato que
   `backend/prisma/data-repair/20260912_p79d_*`), guardas que **abortan** ante lo inesperado, conteos antes/después;
   el reinicio de `TCG-` va en un **paso aparte posterior al COMMIT** (las secuencias no se deshacen con `ROLLBACK`, §5.4).
6. **Reversa:** restaurar PITR al instante que imprime el propio guion (§8.5).

---

## 2. Tabla por tabla (54 modelos del schema con M-72)

Leyenda: **BORRAR** = todas las filas · **CONSERVAR** = no se toca · **AJUSTAR** = se modifican filas concretas.
FK: lo declarado en el schema; Prisma pone `RESTRICT` por defecto en relaciones obligatorias y `SET NULL` en opcionales
(devops lo midió en `pg_constraint` para `Dispute/Order/SellRequest/ShipmentRequest → User` = RESTRICT y
`InventoryItem.ownerUserId` = SET NULL, `docs/DEVOPS_NOTES.md:7204-7218`). **El censo (§8.1) imprime las FK reales de
`pg_constraint` y el guion se escribe contra esa salida, no contra esta tabla.**

### 2.1 Cuentas y acceso — CONSERVAR

| Tabla | Acción | Por qué / nota |
|---|---|---|
| `User` | CONSERVAR | `HECHOS.md:79` (1). Incluye cuentas de prueba (tester, C6). `tokenVersion`, `isOwner`, `lockNoticeAt` intactos. |
| `KycProfile` | CONSERVAR | Es del usuario. ⚠️ Ver riesgo R-6 (retención de INE sin ancla). |
| `KycUploadGrant` | CONSERVAR | Permisos de subida del usuario. |
| `BillingProfile` | CONSERVAR | Del usuario. |
| `Address` | CONSERVAR | Libreta del usuario. |
| `AuthToken` | CONSERVAR | Tokens de un uso; los barre `auth-token-sweep`. |
| «Sesiones» | — | **No hay tabla de sesiones**: JWT sin estado + `User.tokenVersion` (`schema.prisma:585`). Nada que limpiar. |
| «Carritos» | — | **No hay tabla de carrito** (ningún `model Cart` en el schema; el front persiste en el navegador, `frontend/src/lib/local-store.ts:73`). Un carrito viejo en un navegador apunta a piezas que se conservan; el checkout re-valida (`orders.service.ts:462,898`). |

### 2.2 Catálogo, precios y configuración — CONSERVAR (salvo `VariantPriceOverride`)

| Tabla | Acción | Nota |
|---|---|---|
| `CardSet`, `SealedSetGroup`, `SealedProduct`, `Card`, `CardProduct`, `PostalCode`, `ShippingPackage`, `MetaDeck`, `MetaDeckList`, `MetaDeckCard`, `MetaFetchRun` | CONSERVAR | Catálogo / datos de referencia. |
| `PriceReference`, `FxRate`, `SetValueSnapshot`, `PendingPriceEntry` | CONSERVAR | Mercado y cola de precio: hechos del catálogo, no transacciones. |
| `ConfigSetting` | CONSERVAR | Diales del dueño. |
| `VariantPriceOverride` | **AJUSTAR** | `bountyAcquiredQty` lo sube **solo** el pago de una solicitud de venta con base `bounty` (`buylist.service.ts:8470-8484`), y al llegar al objetivo **apaga** el bounty (`bountyEnabled=false`, `bountyCompletedAt=now()`). Como **todo** el buylist era de prueba, el valor verdadero es 0. ⇒ `bountyAcquiredQty = 0` en toda fila; `bountyCompletedAt = NULL` en las filas con `bountyCompletedAt` no nulo; **`bountyEnabled` no se toca** (un bounty apagado por una prueba queda apagado y el dueño lo re-enciende en un clic: encender limpia el sello, `variant-controls.service.ts:516`). El ensayo **lista** esas filas. Que el estado derivado resultante sea exactamente «apagada» en `bounty-state.ts:34-35`: **NO MEDIDO**, lo comprueba backend en la prueba de §9. |

### 2.3 Inventario — CONSERVAR + AJUSTAR

| Tabla | Acción | Nota |
|---|---|---|
| `VaultLocation` | CONSERVAR | Cajones físicos; quedan vacíos los de clientes de prueba. Lo físico es del dueño (`HECHOS.md:23`). |
| `InventoryItem` | **AJUSTAR** (y BORRAR condicional) | Regla completa en §4. Las piezas nacidas de solicitudes de venta de prueba: pregunta **P-1** (§10). |
| `InventoryMovement` | **AJUSTAR** | Se borran los movimientos causados por pruebas y se inserta uno de cierre por pieza restaurada (§4.4). Los de piezas borradas caen por `CASCADE` (`schema.prisma:1150`). |
| `InventoryAdjustment` | CONSERVAR | Levantamientos físicos reales del dueño. Los de piezas borradas caen por `CASCADE` (`schema.prisma:1171`). |
| `InventoryBatch` | CONSERVAR | Idempotencia de altas/publicaciones reales. |

### 2.4 Pedidos y dinero — BORRAR

| Tabla | Acción | FK que fija el orden |
|---|---|---|
| `ManualRefund` | BORRAR | `→ User, ReplacementCase, ShipmentItem, PaymentRefund, Order` RESTRICT; **auto-FK** `reissuedFromId` RESTRICT (`schema.prisma:2118-2120`) ⇒ se borra por hojas (§7, paso 3). |
| `PaymentRefund` | BORRAR | `→ Order, ShipmentRequest, OrderItem, ShipmentItem, ReplacementCase` RESTRICT (`schema.prisma:1987-2009`). Después de `ManualRefund`. |
| `ReplacementCase` | BORRAR | `→ ShipmentItem, ShipmentRequest, VaultPlacementItem, InventoryItem×2, OrderItem` RESTRICT (`schema.prisma:2038-2061`). Después de `PaymentRefund`. |
| `Dispute` | BORRAR | `→ User, InventoryItem` RESTRICT. Ninguna abierta (`HECHOS.md:65` (3)); las cerradas también son de prueba. |
| `VaultPlacementItem` → `VaultPlacement` | BORRAR | Todo RESTRICT (`schema.prisma:1500-1531`). Items antes que cabeceras. |
| `Order` | BORRAR | Cascada a `OrderItem` (`schema.prisma:1461`) y `OrderAccessToken` (`:2512`). `InventoryItem.reservedByOrderId` es SET NULL (`:1094`), pero el guion la limpia **antes**, explícitamente (§4.3). |
| `OrderItem`, `OrderAccessToken` | BORRAR (cascada) | — |
| `ProcessedStripeEvent` | **CONSERVAR** | Memoria de idempotencia de webhooks de prueba; no se ve en ninguna parte. Un evento de prueba reintentado sobre un pedido ya borrado es un no-op medido (`payments.service.ts:698-701, 810, 1067`: `if (!order) return`). No se gana nada borrándola. |
| Objetos en Stripe (modo prueba) | NO SE TOCAN | Viven en el modo prueba de Stripe, separado del real. Borrarlos (Dashboard → «Delete all test data») es opcional y no afecta a la tienda. |

### 2.5 Envíos y Skydropx — BORRAR

| Tabla | Acción | FK que fija el orden |
|---|---|---|
| `ShipmentCostAdjustment` | BORRAR | `→ ShipmentRequest` RESTRICT (`schema.prisma:1731`). |
| `ShipmentPaidLabel` | BORRAR | `→ ShipmentLabelAttempt` RESTRICT (`:1889`); **sin** FK a `ShipmentRequest` (`:1887`). Antes que los intentos. |
| `ShipmentLabelAttempt` | BORRAR | `→ ShipmentRequest` RESTRICT (`:1859`). |
| `ShipmentRequest` | BORRAR **todas** (retiros, envíos directos y, con M-72, `buylist_inbound`) | Cascada a `ShipmentItem` (`:1957`), `ShipmentQuote` (`:1688`), `ShipmentCarrierEvent` (`:1714`), `ShipmentAddressRevision` (`:1767`). `→ User, Order, SellRequest` RESTRICT (`:1557,1562,1658`). Debe ir **antes** de `Order` y de `SellRequest`. |
| `ShipmentItem`, `ShipmentQuote`, `ShipmentCarrierEvent`, `ShipmentAddressRevision` | BORRAR (cascada) | `ShipmentItem` está referida por `PaymentRefund/ReplacementCase/ManualRefund` (RESTRICT) ⇒ esas van antes. |
| `SpendAlert` | BORRAR | Sin FK. Todos los avisos son de actividad de prueba; un aviso de sistema que siga siendo cierto (p. ej. saldo bajo, `ag7:open`) lo vuelve a crear su job. |
| `SpendDigestRun` | CONSERVAR | Memoria de «ya resumí el día X». Borrarla podría re-disparar resúmenes de días pasados (**NO MEDIDO**); su contenido son conteos, no datos de prueba. |
| `SpendOwnerWatch` | CONSERVAR | Una fila: el dueño observado (`schema.prisma:1948`). Borrarla haría que `spend-watch` vea «cambio de dueño» de `null` → dueño (AG-21) — **NO MEDIDO**, no se arriesga. |
| Guías reales en Skydropx (`ENV-000003`, cancelada) | NO SE TOCAN | Viven en Skydropx. El efecto de borrar nuestras filas sobre la conciliación está medido en §5.2. |

### 2.6 Buylist — BORRAR

| Tabla | Acción | Nota |
|---|---|---|
| `SellRequest` | BORRAR **todas** | `HECHOS.md:79` (2). `→ User` RESTRICT. Con M-72 la referencia `ShipmentRequest.sellRequestId` (RESTRICT) obliga a borrar envíos antes. Incluye `1ad4729a…` (Morpeko). |
| `SellRequestItem` | BORRAR (cascada, `schema.prisma:2297`) | ⚠️ `InventoryItem.sourceSellRequestItemId` **no es FK** (`schema.prisma:1049`, sin `@relation`; también `DEVOPS_NOTES.md:7218-7219`) ⇒ quedaría colgando: pregunta P-1. |

### 2.7 Portafolio y bitácora

| Tabla | Acción | Nota |
|---|---|---|
| `PortfolioSnapshot` | BORRAR | La serie de «Mi bóveda» valúa piezas que solo estaban ahí por pedidos de prueba. El job diario la vuelve a sembrar. Precedente: el borrado de cuenta ya la borra (`admin.service.ts:1669`). |
| `SealedRestockSubscription` | CONSERVAR | Intención del usuario, no transacción. |
| `AuditLog` | BORRAR + 1 fila de rastro | §6. |

**Conteos reales por tabla: NO MEDIDO.** Los da el censo (§8.1), que corre el dueño con el usuario de solo lectura.

---

## 3. Quién lee lo que se borra (para que nada quede colgando)

| Lector | Qué lee | Efecto tras la limpieza |
|---|---|---|
| `ine-retention.service.ts:57-73` | `SellRequest` del usuario para decidir si purgar su INE | **Sin solicitudes ⇒ `continue`** (línea 70): la INE de los vendedores de prueba **ya no se purga nunca** por este job. Riesgo R-6. |
| `label-recovery.service.ts:149-164`, `orphan-reconcile.service.ts:77-81` | ids de Skydropx conocidos (`ShipmentRequest`, `ShipmentPaidLabel`, `AuditLog`) | Tras borrar, las guías reales viejas pasan a «desconocidas». Medido en §5.2: inocuo **solo si `ENV-` no reinicia**. |
| `settings.controller.ts:288-303` | `AuditLog` (historial de cambios de diales) | El historial de quién cambió cada dial se pierde (aceptado por el dueño al pedir limpiar la bitácora). |
| `refund-reports.service.ts:37-43` (merma) | movimientos `toStatus ∈ {lost, damaged}` | Los de prueba (p. ej. Cinccino dañada) se borran ⇒ la merma deja de contar pruebas. Correcto. |
| `full-refund.service.ts:620`, `orders.service.ts:1842` | historial de movimientos de piezas de un pedido | Solo para pedidos existentes; no queda ninguno. |

---

## 4. El inventario: qué vuelve, a qué estado y con qué rastro

### 4.1 El conjunto `T` (piezas tocadas por pruebas)

`T` = piezas referidas por **cualquiera** de: `OrderItem.inventoryItemId`, `ShipmentItem.inventoryItemId`,
`VaultPlacementItem.inventoryItemId`, `ReplacementCase.originalInventoryItemId` / `.replacementInventoryItemId`,
`Dispute.inventoryItemId`, o con `reservedByOrderId IS NOT NULL`. Se materializa en una tabla temporal **al inicio**,
antes de borrar nada (después ya no se podría reconstruir).

### 4.2 Guardas que abortan (`RAISE EXCEPTION`, transacción entera deshecha)

| Guarda | Por qué |
|---|---|
| G-1 · Existe una pieza `ownerType='customer'` **fuera de `T`** | Una pieza de cliente que no vino de un pedido sería algo que el diseño no conoce (¿aportación?). No se adivina. |
| G-2 · Existe una pieza con `status ∈ {reserved, in_custody, picking, shipped, delivered}` **fuera de `T`** | Mismo motivo. |
| G-3 · Existe un movimiento con `reason ∈ {sale, settle, chargeback_return, withdrawal, refund_return, refund_release, replacement}` sobre una pieza **fuera de `T`** | Esos motivos solo los escriben los flujos de pedido/retiro/caso (`payments.service.ts:324,475,503,917,1022`; `shipments.service.ts:1703,1729`; `full-refund.service.ts:487`; `release-unsettled-refund.ts:66`; `replacement-case.service.ts:546,617,655`). Uno fuera de `T` contradice el modelo. |
| G-4 · Alguna pieza de `T` tiene `sourceSellRequestItemId` no nulo y P-1 no está respondida en el guion | No se decide por el dueño. |
| G-5 · Tras los borrados, sobrevive **cualquier** fila de las tablas BORRAR | El guion verifica su propio cierre (mismo criterio que `DEVOPS_NOTES.md:7211-7215`). |
| G-6 · Una pieza restaurada no queda con la forma exacta de §4.3 | Idem. |

Hoy, por el modelo, G-1…G-3 deberían dar 0. **NO MEDIDO**: lo dice el ensayo.

### 4.3 Estado destino de cada pieza de `T`

| Campo | Valor | Fuente / por qué |
|---|---|---|
| `ownerType` | `platform` | `HECHOS.md:70` P-4. |
| `ownerUserId`, `ownershipStatus` | `NULL` | Sin dueño cliente. |
| `reservedByOrderId`, `reservedUntil` | `NULL` | Sin reserva. |
| `status` | **`in_stock`** — salvo la lista de exclusión de P-2 | La app decide `listed` vs `in_stock` **resolviendo el precio** (`orders.service.ts:1880-1899`: «una pieza sin precio NUNCA se publica»). SQL no puede resolver precio ⇒ falla cerrado en `in_stock` y la re-publicación la hace la app (§4.5). El checkout acepta ambos estados (`orders.service.ts:462,898`). |
| `locationId` | Si el cajón actual es `customer_custody` ⇒ el `fromLocationId` del movimiento `move` de colocación más antiguo de la pieza (`vault-placement.service.ts:568-578` lo registra) **si** ese cajón es `platform_stock`; si no, `NULL`. Si el cajón actual ya es `platform_stock`, no se toca. | El ensayo imprime, por pieza, cajón actual → cajón propuesto, para que el dueño mueva la carta física (`HECHOS.md:23`: lo físico es suyo). |
| `listPriceCents`, `finish`, costo, etc. | Sin cambio | No son de la transacción. |

**Cinccino `INV-000892`** (`PENDIENTES.md:33`): está en `T` por su `OrderItem` de `TCG-000018`; hoy `damaged`. La regla la
devuelve a `in_stock` y §4.5 la publica si su precio resuelve. No es caso especial. Que su estado actual sea `damaged`:
**NO MEDIDO** (lo dice el pendiente; lo imprime el ensayo).

**Lista de exclusión (P-2):** piezas de `T` que el dueño diga que **físicamente ya no están** (enviadas de verdad, dañadas
de verdad). Esas quedan `platform` sin reserva pero con `status = 'withdrawn'` (salida sin venta) — o `damaged` si así lo
dice — y **no** se re-publican. Se pasa al guion como variable de psql con la lista de folios; vacía por defecto.

### 4.4 Movimientos

1. **Se borran** los movimientos de piezas de `T` con `reason ∈ {sale, settle, chargeback_return, withdrawal,
   refund_return, refund_release, replacement}` (todos son de pedido/retiro/caso, ver G-3) **y** los de
   `reason ∈ {lost, damaged, move}` con `createdAt ≥ corte(pieza)`, donde `corte(pieza)` = el `createdAt` más antiguo de
   los pedidos/retiros/casos que la tocan. Esos `lost/damaged/move` los escriben la preparación y la colocación
   (`shipment-prep.service.ts:563-575`, `vault-placement.service.ts:568-578, 703-714`, `orders.service.ts:1788-1797`) y
   llevan el número de pedido en `note`.
   ⚠️ Un `lost/damaged/move` **real** hecho desde M1 (`inventory.service.ts:3236, 3282`) sobre una pieza de `T` después de
   su corte también se borraría. El ensayo los lista con su `note` para que se vean; el estado final no cambia por ello.
2. **Se conservan** `alta`, `buylist_convert`, `adjustment` y los `move/lost/damaged` anteriores al corte.
3. **Se inserta UNO por pieza de `T`**: `reason='adjustment'`, `fromStatus` = estado justo antes de la limpieza,
   `toStatus` = estado destino, `fromLocationId/toLocationId` si cambió el cajón, `actorUserId = NULL`,
   `note = 'P-DB-LIMPIEZA <fecha>: pruebas borradas; vuelve a inventario'`. Sin fila `InventoryAdjustment` (no es un
   levantamiento). Ningún lector exige la pareja movimiento↔ajuste en lo medido (§3); que no exista otro: **NO MEDIDO**,
   backend lo confirma con `grep` antes de escribir.

### 4.5 Re-publicación (después del COMMIT, con la app)

Las piezas de `T` que quedaron `in_stock` (menos la exclusión) se publican con **el mismo pipeline por pieza** que ya
usa M1 (`bulkPublish`, `inventory.service.ts:1612, 1718-1757`), que es el que decide si el precio resuelve. Dos vías,
backend elige y documenta en `BACKEND_NOTES`:

- **(preferida)** un comando de un solo uso `limpieza:republicar` (simulacro por defecto, `--apply` para escribir) que
  lee los ids de la fila de rastro de §6.3 y llama a ese pipeline;
- **(sin código nuevo)** el dueño las publica desde M1 «Listas para publicar».

⛔ Nunca `UPDATE … SET status='listed'` en SQL: publicaría piezas sin precio.

### 4.6 Piezas nacidas de solicitudes de venta de prueba

Son `InventoryItem` con `sourceSellRequestItemId` apuntando a una línea que se va a borrar (y `acquisitionType='buylist'`).
Si se conservan, ese campo queda colgando (no es FK) y su costo de adquisición viene de una oferta de prueba. **Pregunta
P-1.** Mecánica de cada respuesta:
- **Borrarlas:** después de borrar `OrderItem/ShipmentItem/VaultPlacementItem/ReplacementCase/Dispute` (RESTRICT hacia la
  pieza); sus movimientos y ajustes caen por cascada.
- **Conservarlas:** `sourceSellRequestItemId = NULL`; costo y tipo de adquisición sin tocar (el dueño corrige el costo
  en M1 si quiere). Si además están en `T`, se restauran como el resto.

---

## 5. Folios

### 5.1 Dónde vive cada folio y dónde es llave (medido)

| Folio | Generador | Dónde se usa como llave | ¿Lo ve el cliente? |
|---|---|---|---|
| `TCG-` (`Order.orderNumber`, `@unique`, `schema.prisma:1374`) | `order_number_seq` (`orders.service.ts:758-759`; secuencia creada en M-25) | Reenvío del enlace del invitado: busca por número **y exige que el correo coincida** (`guest-checkout.service.ts:454-459`); búsqueda del admin (`admin-orders.controller.ts:108`, `shipments.service.ts:776`, `replacement-case.service.ts:440`, `manual-refund.service.ts:339`); correos (`shipment-notice.templates.ts:120,133`). | **Sí** (pedidos, correos). |
| `ENV-` (`ShipmentRequest.folio`, `@unique`, default de BD) | `shipment_folio_seq` vía `shipment_folio_next()` (`migrations/20261008120000_m67_sdx_e_folio/migration.sql:32-40`) | Viaja a Skydropx como `address_to.reference = "Pedido ENV-…-NN"` (`folio-token.ts:16-27`, `label-purchase.service.ts:615,680`). Con él se **adopta** una guía en vuelo (`label-recovery.service.ts:199-279`) y se **atribuye una guía huérfana** (`orphan-reconcile.service.ts:64-121`). | **No** (el correo usa número de pedido o id del envío, `shipment-notice.templates.ts:119-121`; ninguna pantalla de tienda lo pinta, `grep folio` en `(storefront)` solo da `INV-`/`TCG-`). Puede ir impreso en la etiqueta de la paquetería: **NO MEDIDO**. |
| `INV-` (`InventoryItem.folio`, `@unique`, `schema.prisma:1013`) | `inventory_folio_seq` (`prisma.service.ts:15-35`; secuencia en `migrations/0000000000000_init/migration.sql:620`) | Búsqueda en M1 (`inventory.service.ts:2694`), SPEI y casos (`manual-refund.service.ts:340,342`, `replacement-case.service.ts:439`); **export `.xlsx` una fila por folio** (`inventory.controller.ts:558-562`); bóveda del cliente (`VaultView.tsx:428`, `ShipmentsView.tsx:285`). Ubicaciones: `VaultLocation` **no** guarda folio (`schema.prisma:994-1009`). | Sí, en «Mi bóveda». |

### 5.2 Riesgo (a) de `HECHOS.md:79` — medido: reiniciar `ENV-` produce una huérfana falsa con costo

Cadena medida en código:
1. `recentShipments` **no filtra por fecha**: pagina el listado de Skydropx (`skydropx.adapter.ts:454-499`); con pocas
   guías, las viejas (como la de `ENV-000003`) salen en la primera página.
2. `detectLate` toma toda guía del listado **con nuestro folio legible y más vieja que la vida máxima de compra**
   (`orphan-reconcile.service.ts:64-74`), descarta las «conocidas» por id en `ShipmentRequest`/`ShipmentPaidLabel`
   (`:77-84`) — **que la limpieza borra** — y busca el intento por `providerReference` exacto (`:85-88`).
3. Si `ENV-` reinicia, el primer envío real con folio `ENV-000003` y su intento `-01` tiene la **misma** referencia que
   la guía vieja ⇒ la guía vieja se registra como `ShipmentPaidLabel {origin:'orphan', chargedCents = lo esperado del
   intento nuevo}` + `shipment.label_orphan` (`:99-120`) ⇒ `reconcile()` la evalúa (`:128-145`); como está cancelada en
   Skydropx, `keepReason` da movimiento de paquetería ⇒ **AG-9 inmediato al dueño** («guía cobrada sin explicación»).
   Y con `HECHOS.md:72` (huérfanas al P&L como costo de envío), sería un **costo falso** el día que se construya.
4. La adopción en vuelo **no** emparejaría mal (la ventana de fechas lo impide, `label-recovery.service.ts:81-95`), pero
   marcaría el caso como **ambiguo** (`:253-259`) ⇒ sin adopción ni liberación automática para ese envío.

**Decisión: `ENV-` NO se reinicia; la secuencia sigue donde está.** Ningún cliente lo ve (§5.1), así que reiniciarlo no
le da nada al dueño y cuesta la huérfana falsa. Con la secuencia intacta, las guías viejas nunca casan con un intento
nuevo; lo único que queda es una línea `warn orphan_folio_unknown` por guía vieja en cada corrida del job
(`orphan-reconcile.service.ts:89-91`): ruido de log, sin escritura ni aviso. Alternativas descartadas: prefijo nuevo
(cambia el `CHECK shipment_folio_format`, `folio-token.ts:14-17` y el contrato §M4-SHIP.19.28.1 — migración y código
para nada visible); conservar `ShipmentPaidLabel` viejas como «conocidas» (dejaría filas con `shipmentRequestId`
colgando: dos fuentes para un hecho).

### 5.3 `INV-`: NO se reinicia

Las piezas **se conservan** y `folio` es `@unique`: reiniciar la secuencia a 1 hace que el siguiente alta choque con
`INV-000001` existente (P2002) y **rompe el alta de inventario**. La única forma de «reiniciar» sería **renumerar**
todas las piezas reales — miles de filas (7.352 en local, `HECHOS.md:54`; producción **NO MEDIDO**) — y eso descuadra
cualquier `.xlsx` exportado que el dueño tenga (§5.1) sin ganar nada físico (las cartas no llevan folio, `HECHOS.md:79`).
Quedan huecos en la numeración si P-1 borra piezas; es normal (una secuencia no es un conteo).

### 5.4 `TCG-`: se reinicia a `TCG-000001`, en un paso APARTE

- **Por qué es seguro:** tras la limpieza no queda ningún `Order` ⇒ el `@unique` no puede chocar; el reenvío de invitado
  exige número **y** correo (`guest-checkout.service.ts:457-459`), así que un correo de prueba viejo con «TCG-000018» no
  abre el pedido real que reciba ese número.
- ⛔ **Las secuencias no se deshacen con `ROLLBACK`** (comportamiento de Postgres: `nextval`/`setval` no son
  transaccionales). Si el reinicio fuera dentro del guion principal, **el ensayo en seco reiniciaría el contador de
  verdad**. Por eso va en un fichero propio que se corre **solo después del COMMIT**, con guarda: aborta si existe
  cualquier fila en `Order`. Operación: dejar `order_number_seq` para que el siguiente valor sea 1.
- Se corre **antes** del primer pedido real (§8.4), o el primer pedido real se llevaría `TCG-0000xx`.

---

## 6. Bitácora (`AuditLog`)

### 6.1 Respaldo exigido antes
1. **Respaldo manual** en Railway → Postgres → Backups → *Create backup* (procedimiento de `DEVOPS_NOTES.md:3149`),
   tomado **justo antes** de la corrida real. Su nombre/hora se escribe en la variable del guion y queda en el rastro.
2. **PITR** activo (`HECHOS.md:74` (d)): el guion imprime el instante de restauración (§8.5).
La bitácora es evidencia de seguridad: con los dos respaldos, borrarla de la base viva no la destruye — vive en el
respaldo durante su retención (retención exacta de Railway: **NO MEDIDO**).

### 6.2 Qué se borra
**Todas** las filas de `AuditLog` (`HECHOS.md:79` (4)). No tiene FK (`DEVOPS_NOTES.md:7199`). Lectores afectados: §3.

### 6.3 Rastro mínimo que queda (una fila, insertada en la misma transacción, después del borrado)
`AuditLog { actorUserId: NULL, actorRole: NULL, action: 'maintenance.test_data_purge', entityType: 'Database',
entityId: 'P-DB-LIMPIEZA', after: { conteosAntes: {tabla: n}, conteosDespues: {tabla: n}, piezasRestauradas: [ids],
piezasExcluidas: [folios], piezasBuylistBorradas|Conservadas: [folios], respaldoManual: '<nombre y hora>',
puntoPitr: '<timestamptz>', ejecutadoCon: current_user } }`. Sin PII (ids y conteos). Es además la entrada del
comando de re-publicación (§4.5). No existe registro central de nombres de acción que actualizar (`grep` de
`AUDIT_ACTIONS|AuditAction` = 0).

---

## 7. Orden de ejecución (dentro de UNA transacción)

`SET LOCAL lock_timeout='5s'`, `statement_timeout` holgado (p. ej. 120 s). Bloqueo explícito al inicio
(`LOCK TABLE … IN SHARE ROW EXCLUSIVE MODE`) de `Order`, `ShipmentRequest`, `SellRequest`, `InventoryItem`,
`PaymentRefund`, `ManualRefund` para que ningún job ni webhook escriba a la mitad; si no consigue el candado en 5 s,
falla sin tocar nada.

| Paso | Qué | Por qué en este orden |
|---|---|---|
| 0 | Imprimir `current_database()`, `current_user`, `now()` (= **punto PITR**), versión de migraciones (`_prisma_migrations`: ¿está M-72?) | Constancia en pantalla. |
| 1 | **Conteos ANTES** de las ~30 tablas de §2 (en una temporal) | Para el «antes/después». |
| 2 | Materializar `T` (§4.1), el estado actual de cada pieza y su cajón propuesto; correr G-1…G-4; **imprimir**: pedidos (número, total, fecha, `paymentMethodLast4`), envíos (folio, estado, guía, `providerShipmentId`), solicitudes de venta, piezas de `T` (folio, carta, estado → destino, cajón → cajón), piezas de buylist, bounties a ajustar, movimientos a borrar posteriores al corte con su `note` | Todo lo que se va a decidir, visible antes de decidir. |
| 3 | `ManualRefund` por hojas (repetir «borrar las que nadie re-emite» hasta 0) | Auto-FK RESTRICT. |
| 4 | `PaymentRefund` | Refiere a casos, líneas, pedidos, envíos. |
| 5 | `ReplacementCase` | Refiere a líneas de envío, de colocación, piezas, `OrderItem`. |
| 6 | `Dispute` | RESTRICT a pieza y usuario. |
| 7 | `VaultPlacementItem`, luego `VaultPlacement` | RESTRICT a `OrderItem`, pieza, `Order`. |
| 8 | `ShipmentCostAdjustment`, `ShipmentPaidLabel`, `ShipmentLabelAttempt`, luego **todo** `ShipmentRequest` (cascada a líneas, cotizaciones, eventos, revisiones) | Antes de `Order` y `SellRequest` (RESTRICT, incl. M-72). |
| 9 | Restaurar piezas de `T` (§4.3) y limpiar `reservedByOrderId` | Antes de borrar `Order` (la regla necesita los pedidos para el corte de §4.4). |
| 10 | Movimientos: borrar los de prueba e insertar el de cierre (§4.4) | Necesita el corte calculado en 2. |
| 11 | `Order` (cascada `OrderItem`, `OrderAccessToken`) | Ya sin referencias RESTRICT. |
| 12 | Piezas de buylist según P-1 (borrar o desligar) | Tras 4–7 y 11 (RESTRICT hacia la pieza). |
| 13 | `SellRequest` (cascada `SellRequestItem`) | Tras 8 (M-72) y 12. |
| 14 | `SpendAlert`, `PortfolioSnapshot`; ajuste de `VariantPriceOverride` (§2.2) | Sin dependencias. |
| 15 | `AuditLog`: borrar todo; insertar la fila de rastro (§6.3) | Último borrado, para que el rastro tenga los conteos finales. |
| 16 | **Conteos DESPUÉS** + G-5, G-6; imprimir tabla `tabla · antes · después · esperado` | Verificación de cierre dentro de la transacción. |
| 17 | `ROLLBACK;` (ensayo) — el dueño lo cambia a `COMMIT;` para la corrida real | Formato del precedente `20260912_p79d_*`. |

**Idempotencia:** correrlo dos veces debe dar 0 en la segunda (todo ya borrado; `T` vacío ⇒ ningún movimiento de cierre
nuevo). Se exige en la prueba de §9.

---

## 8. Forma de ejecución

### 8.1 Artefactos que escribe backend (en `backend/prisma/data-repair/`, prefijo `2026MMDD_pdblimpieza_`)

| # | Fichero | Qué hace | Con qué usuario |
|---|---|---|---|
| A | `…_1_censo.sql` | **Solo lectura.** Conteos por tabla, FK reales (`pg_constraint` de todas las tablas de §2), G-1…G-4 en modo informe, `last_value` de las tres secuencias, `max(providerReference)` de `ShipmentLabelAttempt`, ¿M-72 aplicada? | `tcg_readonly` |
| B | `…_2_limpieza.sql` | §7 entero. Termina en `ROLLBACK`. Variables de psql arriba: `respaldo_manual` (texto, **obligatoria**: si está vacía, aborta), `fuera_de_venta` (lista de folios, P-2), `buylist_piezas` (`borrar` / `conservar`, P-1; vacía ⇒ G-4 aborta si hay alguna). Encabezado en castellano llano como el precedente. | admin de la base |
| C | `…_3_folio_pedidos.sql` | Solo tras el COMMIT de B. Guarda: aborta si `Order` tiene filas. Deja `order_number_seq` para que el siguiente sea `TCG-000001`. Imprime `last_value` antes/después. | admin |
| D | `…_4_verificacion.sql` | **Solo lectura.** Las comprobaciones de §8.3. | `tcg_readonly` |
| E | comando `limpieza:republicar` (o vía M1) | §4.5. Simulacro por defecto. | app |

⛔ **Credenciales:** ninguna en el repo, en los ficheros ni en el chat. El dueño se conecta con las suyas (Railway →
Postgres → *Connect*), como en P-79(d). Los ficheros no llevan host, usuario ni contraseña.
⛔ No reutilizar `scripts/purge-synthetic-poc-data.sh`: tiene lista blanca **solo local** y rechaza producción a
propósito (`DEVOPS_NOTES.md:7222-7224`).

### 8.2 Guion del dueño (el día de la limpieza)

1. **Antes:** terminan todas las pruebas con tarjeta de prueba (incluidas las ~6 de C6, `HECHOS.md:70`). Nadie más hace
   pedidos de prueba hasta el final.
2. Corre **A** (censo) y lee los conteos. Si G-1…G-4 informan algo, se para y se pregunta.
3. **Respaldo manual** en Railway (§6.1). Anota nombre y hora.
4. Corre **B** tal cual (termina en `ROLLBACK`). Lee las listas: pedidos, envíos, piezas que vuelven y a qué cajón.
5. Si está de acuerdo: escribe el respaldo y las variables arriba, cambia la última línea a `COMMIT;`, vuelve a correr
   **B**. **Copia el «punto PITR» que imprime el paso 0.**
6. Corre **C** (folio de pedidos).
7. Corre **D** (verificación). Todo en «OK».
8. **E**: re-publicar las piezas restauradas.
9. Mueve físicamente las cartas que cambiaron de cajón (lista del paso 4).
10. Solo entonces: cambio a `sk_live_` y primera compra real pequeña (`HECHOS.md:70`) ⇒ debe salir `TCG-000001`.

### 8.3 Verificación posterior (D)

- 0 filas en: `Order`, `OrderItem`, `OrderAccessToken`, `PaymentRefund`, `ManualRefund`, `ReplacementCase`,
  `VaultPlacement`, `VaultPlacementItem`, `ShipmentRequest` (y sus 4 tablas en cascada), `ShipmentCostAdjustment`,
  `ShipmentLabelAttempt`, `ShipmentPaidLabel`, `Dispute`, `SellRequest`, `SellRequestItem`, `SpendAlert`,
  `PortfolioSnapshot`.
- `AuditLog` = exactamente 1 fila, `action='maintenance.test_data_purge'`.
- 0 piezas con `ownerType='customer'`, `reservedByOrderId IS NOT NULL` o `status ∈ {reserved, in_custody, picking,
  shipped, delivered}`.
- 0 movimientos con `reason ∈ {sale, settle, chargeback_return, withdrawal, refund_return, refund_release, replacement}`.
- 0 `InventoryItem.sourceSellRequestItemId` no nulos.
- `User`, `InventoryItem` (menos las de P-1 si se borraron), `Card`, `PriceReference`, `ConfigSetting`: **mismo conteo**
  que el censo A.
- `order_number_seq`: siguiente = 1. `shipment_folio_seq` e `inventory_folio_seq`: **igual** que en el censo A.
- `bountyAcquiredQty` = 0 en todas las filas.

### 8.4 Cuándo correrla respecto de M-72 y del cambio a modo real

- **Con M-72 ya desplegada (lo probable):** M-72 arranca el reloj de 7 días naturales de las solicitudes aceptadas abiertas
  al desplegar (`migration.sql:96`, P-BSD-2). Si pasan ~5 días antes de la limpieza, saldría el aviso AG-23 y luego el
  cierre automático con correo «no continuamos» al vendedor de prueba (p. ej. Morpeko). Inocuo, pero conviene limpiar
  antes de eso.
- **Siempre antes de `sk_live_`** y antes del primer pedido real (§5.4).

### 8.5 Reversa

**Restaurar PITR al instante impreso en el paso 0 de la corrida con `COMMIT`** (es `now()` al inicio de la transacción:
nada de la limpieza es visible antes de su COMMIT, así que ese instante es estrictamente «antes»). Cobertura PITR desde
`2026-10-05 22:32:25` (`HECHOS.md:74` (d)). Respaldo de red: el manual del paso 3. Lo que se pierde al restaurar: todo lo
escrito después de ese instante (en esa ventana solo debería haber la limpieza).
⚠️ **El simulacro de restauración (D-3) no se ha hecho** (`HECHOS.md:74` (a)): cómo restaura Railway exactamente (¿en
sitio o en un volumen nuevo que hay que reconectar?) es **NO MEDIDO**. Pregunta P-3.
El reinicio de `TCG-` (C) corre después de ese instante, así que la misma restauración lo deshace (las secuencias
viven en la base y PITR las devuelve a su valor). Fuera de la base este guion no produce efectos que deshacer.

---

## 9. Pruebas que backend escribe ANTES del guion (la prueba que falla)

Integración contra una base con fixture que tenga **al menos uno** de cada: pedido `vault` liquidado y colocado, pedido
`direct_ship` enviado con guía Skydropx (intento, guía pagada, ajuste de costo, evento), pedido de invitado con token,
retiro con caso «Por reponer» y SPEI re-emitido (cadena `reissuedFromId` de 2), reembolso parcial, disputa cerrada,
solicitud de venta pagada con pieza convertida y bounty completado, solicitud `aceptada` con envío `buylist_inbound`
(M-72), una pieza dañada en preparación (caso Cinccino), una pieza real con movimiento M1 posterior, aviso de gasto,
portafolio. Casos:

1. **Ensayo no escribe:** conteos idénticos tras `ROLLBACK`; **las tres secuencias intactas** (prueba explícita de §5.4).
2. **Corrida aplica:** §8.3 entero en verde.
3. **Idempotencia:** segunda corrida = 0 cambios.
4. **Guardas muerden:** una pieza `customer` sin pedido ⇒ aborta (G-1); un movimiento `settle` fuera de `T` ⇒ aborta (G-3);
   pieza de buylist sin respuesta P-1 ⇒ aborta (G-4); `respaldo_manual` vacío ⇒ aborta.
5. **Fail-closed de precio:** ninguna pieza queda `listed` por SQL.
6. **C con pedidos ⇒ aborta;** sin pedidos ⇒ siguiente `TCG-000001`.
7. **Regresión de §5.2 (la que demuestra la decisión):** con `ENV-` sin reiniciar, una guía vieja con referencia
   `ENV-000003-01` en el falso Skydropx + un intento nuevo ⇒ `detectLate` no escribe nada. Mutación: reiniciar la secuencia
   en la prueba ⇒ aparece la `ShipmentPaidLabel` huérfana. N ≥ 3 corridas (O-3).
8. Con y sin M-72 aplicada (§11).

---

## 10. Preguntas para el dueño (solo las que bloquean)

| # | Pregunta | Recomendación | Si no contesta |
|---|---|---|---|
| **P-1** | Las cartas que entraron a tu inventario desde **solicitudes de venta de prueba**: ¿existen de verdad en tu estante? (El ensayo te las lista con folio y nombre.) | **Si no existen, borrarlas; si existen, conservarlas** (se quita el vínculo a la solicitud; el costo queda como estaba y lo corriges en M1 si quieres). | El guion **no corre** (G-4) si hay alguna. Si el censo da 0, la pregunta desaparece. |
| **P-2** | De las cartas que tocaron los pedidos de prueba, ¿alguna **ya no está físicamente** (se mandó de verdad por paquetería o se dañó de verdad)? (El ensayo te las lista.) | **Todas vuelven a la venta**, incluida Cinccino `INV-000892`, salvo las que nombres; esas quedan fuera de venta. | Todas vuelven a la venta. |
| **P-3** | ¿Hacemos **antes** el simulacro de restauración de Railway (D-3, `HECHOS.md:74` (a))? | **Sí.** La única marcha atrás de esta limpieza **es** esa restauración; hoy nadie la ha probado. | Se corre igual con respaldo manual + PITR, con el riesgo de no saber cómo restaurar el día que haga falta. |

**Para tu información (no bloquea, ya decidido por delegación de `HECHOS.md:79` (3)):** los **números de pedido**
reinician en `TCG-000001`; el folio de **envío** (`ENV-`, que el cliente no ve) y el de **inventario** (`INV-`) siguen
contando. Reiniciar el de envío haría que el sistema confunda la guía real ya cancelada `ENV-000003` con un envío nuevo y
te mande un aviso de «guía cobrada sin explicación»; reiniciar el de inventario obligaría a renumerar todas tus cartas.
Si aun así quieres otra cosa, dilo y se rediseña.

---

## 11. Qué cambia si se corre SIN M-72

- **El guion es el mismo:** borra **todo** `ShipmentRequest` y **todo** `SellRequest` sin nombrar columnas de M-72
  (`kind`, `sellRequestId`, `inboundGuideClockStartedAt`). ⛔ Requisito para backend: **ninguna** sentencia de B nombra
  esas columnas; el censo/verificación pueden desglosar por `kind` **solo** si `information_schema` dice que existe.
- Sin M-72 no hay FK `ShipmentRequest → SellRequest`; el orden de §7 sigue siendo válido (es más estricto de lo necesario).
- Sin M-72 no existen filas `buylist_inbound` ni avisos `buylist_guide_due` (`schema.prisma:1832`); nada que hacer.
- Si M-72 se despliega **después** de la limpieza: su `UPDATE "SellRequest" … inboundGuideClockStartedAt` (`migration.sql:96`)
  toca 0 filas. Ningún conflicto.

---

## 12. Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| R-1 | Borrar de más (algo real que el modelo cree de prueba) | `HECHOS.md:119-122` dice que no hay ventas reales; guardas G-1…G-6; ensayo con listas; respaldo + PITR. |
| R-2 | Un job o webhook escribe a la mitad | `LOCK TABLE` + `lock_timeout=5s` (§7); se corre sin pruebas en curso (§8.2 paso 1). |
| R-3 | El ensayo reinicia un contador | Ningún `nextval/setval` en B; reinicio solo en C tras COMMIT (§5.4); prueba §9.1. |
| R-4 | Huérfana falsa de Skydropx | `ENV-` no se reinicia (§5.2); prueba §9.7. |
| R-5 | Pieza publicada sin precio | Restaurar a `in_stock` y publicar con la app (§4.5); prueba §9.5. |
| R-6 | **INE de vendedores de prueba sin purga automática**: sin `SellRequest`, `ine-retention.service.ts:70` hace `continue` para siempre. | No bloquea la limpieza. Se enruta a **backend + seguridad** como deuda (`TECH_DEBT.md`): anclar la retención también cuando el usuario no tenga solicitudes (p. ej. a `KycProfile.reviewedAt/updatedAt`). Qué INE hay hoy: **NO MEDIDO** (censo A: perfiles con `ineFrontKey` no nulo). |
| R-7 | Restauración PITR nunca probada | P-3. |
| R-8 | Movimientos M1 reales posteriores al corte de una pieza de `T` se borran | Se listan en el ensayo; el estado final es el mismo. Probablemente 0 (**NO MEDIDO**). |
| R-9 | Correos ya enviados a clientes de prueba citan `TCG-0000xx` que se reutilizarán | El reenvío exige correo + número (`guest-checkout.service.ts:457-459`); las cuentas se conservan pero sus pedidos ya no existen ⇒ «pedido no encontrado». Aceptable. |

---

## 13. Medido / NO MEDIDO (resumen)

- **Medido en código (2026-10-06, árbol PR #78):** FK y cascadas del schema; generadores de los tres folios; dónde es llave
  cada folio; cadena de huérfana falsa al reiniciar `ENV-`; lectores de `AuditLog`; escritores de cada motivo de
  movimiento; regla de re-publicación por precio; no-op de webhook sin pedido; retención de INE sin ancla.
- **NO MEDIDO:** todos los conteos de producción; estado actual de `INV-000892`; si `address_to.reference` sale impreso
  en la etiqueta; cómo restaura Railway; retención de los respaldos de Railway; efecto de borrar `SpendDigestRun` /
  `SpendOwnerWatch` (por eso se conservan); estado derivado exacto del bounty tras el ajuste; existencia de otro lector
  que exija `InventoryAdjustment` junto a un movimiento `adjustment`.

---

## 14. REVISIÓN v2 (2026-10-07) — también se borra el inventario

> **Fuente:** `HECHOS.md:80` (2026-10-07, «quiero que borres inventario también»), con los supuestos del orquestador
> comunicados al dueño: **todo** el inventario (plataforma, custodia de bóveda y sellado); se conservan catálogo,
> precios, cajones, usuarios y diales; `INV-` reinicia; P-1 deja de aplicar. Corrección posterior del dueño (2026-10-07,
> relayada por el orquestador): **«deja las fotos de las cartas»** — ver §14.6: no hay fotos de piezas que borrar.
> **Base de esta revisión (medida en `/home/user/tcg-limpieza`, 2026-10-07):** `schema.prisma`, los cuatro guiones
> `backend/prisma/data-repair/20261006_pdblimpieza_{1_censo,2_limpieza,3_folio_pedidos,4_verificacion}.sql`, el comando
> `src/cli/limpieza-republicar.ts` + `src/modules/inventory/limpieza-republicar.ts`, `BACKEND_NOTES.md` §79 (:29868-) y
> `test/integration/pdb-limpieza.e2e-spec.ts`.

### 14.1 Qué cambia en una frase

El guion deja de **restaurar** piezas y pasa a **vaciar** el inventario: desaparecen el plan por pieza, el cajón
propuesto, los movimientos de cierre, P-1, P-2 y la re-publicación. Se añade una guarda de **custodia de clientes**
(§14.4) y el reinicio de `INV-` en el paso aparte de folios (§14.5). Lo transaccional (§2.4–§2.7) no cambia.

### 14.2 Tablas que cambian de acción

| Tabla | v1 | **v2** | Por qué (medido) |
|---|---|---|---|
| `InventoryItem` | AJUSTAR | **BORRAR todas** (plataforma, `customer` y `sealed`) | `HECHOS.md:80`. |
| `InventoryMovement` | AJUSTAR | **BORRAR** (cae por `CASCADE` con la pieza, `schema.prisma:1150`) | Historial de piezas que dejan de existir. |
| `InventoryAdjustment` | CONSERVAR | **BORRAR** (cascada, `schema.prisma:1171`) | Idem. |
| `InventoryBatch` | CONSERVAR | **BORRAR todas** | Sin FK, pero `resultJson` guarda ids y **folios** de las piezas creadas (`schema.prisma:1188-1200`; lo lee el replay idempotente, `inventory.service.ts:1391, 1554, 2390, 3444, 3690`). Con `INV-` reiniciado, un `INV-000001` de ahí nombraría a otra pieza. Tras borrar todo, lo que queda son recibos de altas que ya no existen. |
| `PendingPriceEntry` | CONSERVAR | **BORRAR solo `context ∈ {inventory, portfolio}`**; **conservar** `catalog` y `buylist` | Las filas `inventory` son por **variante**, no por pieza (`refId` siempre `undefined` en ese eje: `inventory.service.ts:927, 1054, 1813`; `price-ingest.service.ts:1043`) y describen «una pieza mía de esta variante no tiene precio». Sin piezas, son ruido en M2: el barrido VQ solo cierra las `reason IS NULL` (`price-sync.service.ts:181-237`), así que las `no_market`/`premium_at_floor` se quedarían abiertas para variantes que nadie tiene. `portfolio`: ningún escritor en `src` (medido: solo aparece en tipos), se borra por coherencia (era el eje de piezas de clientes). `catalog`/`buylist` son huecos de precio del **catálogo** y del cotizador, válidos sin inventario. Al re-subir, el alta vuelve a abrir la fila si hace falta (`escalatePending` deduplica, `pricing.service.ts:2045-2053`). |
| `VaultLocation` | CONSERVAR | **CONSERVAR** (sin cambio) | Cajones físicos. La ocupación **no** es una tabla: es `InventoryItem.locationId` (`schema.prisma:1031-1032`); las colocaciones (`VaultPlacement*`) ya se borraban en v1. Al borrar las piezas, todos los cajones quedan vacíos. |
| `VariantPriceOverride` | AJUSTAR (bounty) | **sin cambio respecto a v1** | `sellOverrideCents`/`buyOverrideCents`/bounty del dueño se conservan; solo `bountyAcquiredQty=0` y `bountyCompletedAt=NULL` como en §2.2. |
| `SealedProduct` | CONSERVAR | **CONSERVAR** (sin cambio) | Incluye el precio del dueño por producto (`ownerDisplayPriceCents`, `schema.prisma:860`) y la imagen (`imageUrl`, `:853`). FK desde la pieza es `SetNull` (`:1086`): borrar piezas no toca el producto. |
| `PortfolioSnapshot` | BORRAR | BORRAR (sin cambio) | Ya estaba. |
| Fotos de piezas | — | **No existen** | §14.6. |

Todo lo demás de §2 queda igual. `SellRequestItem.inventoryItemId` y `InventoryItem.sourceSellRequestItemId` **no son FK**
(`schema.prisma:2341`, `:1049`) y ambas puntas se borran: nada queda colgando y **P-1 desaparece**.

**Lo que el dueño pierde al re-subir (informativo, no bloquea):** por pieza — precio manual (`listPriceCents`), costo y
tipo de adquisición, cajón, acabado, certificado (`schema.prisma:1030-1045`). **Se conserva** lo que es por variante o
por producto: overrides de venta/compra y bounties (`VariantPriceOverride`), precio del sellado por producto
(`SealedProduct.ownerDisplayPriceCents`), referencias de mercado (`PriceReference`) y las imágenes del catálogo.
Recomendación operativa (§14.8 paso 2): **descargar el `.xlsx` de inventario antes** (`GET /admin/inventory/export.xlsx`,
`inventory.controller.ts:557-562`, una fila por pieza) como chuleta para re-subir. ⚠️ Sus folios son los **viejos**.

### 14.3 Orden de borrado (una transacción) y guardas

`LOCK TABLE` de v1 **más** `"InventoryBatch"` y `"PendingPriceEntry"` (el `price-ingest` escribe en la cola leyendo
piezas, `price-ingest.service.ts:1043`; sin el candado podría colar una fila `inventory` a mitad).

| Paso | Qué | FK que lo ordena |
|---|---|---|
| 0–1 | Igual que v1 (dónde estoy, conteos antes, G-8 con la clasificación nueva de §14.2). | — |
| 2 | Guardas G-7, G-1, G-2, G-3, **G-9** (§14.4) y **listas**: pedidos, envíos, solicitudes (como v1); **custodia por dueño** (correo, nombre, nº piezas, nº pedidos); **resumen del inventario que se borra** por `productType × status × ownerType` y total; bounties. ⛔ Sin lista por pieza (miles de filas, `HECHOS.md:54`): resumen. | — |
| 3–8 | `ManualRefund` por hojas → `PaymentRefund` → `ReplacementCase` → `Dispute` → `VaultPlacementItem` → `VaultPlacement` → `Shipment*` → `ShipmentRequest` (igual que v1). | RESTRICT hacia `InventoryItem`: `ReplacementCase` ×2 (`schema.prisma:2046, 2059`), `Dispute` (`:2387`), `VaultPlacementItem` (`:1531`), `ShipmentItem` (`:1959`, cae con `ShipmentRequest`). |
| 9 | `Order` (cascada `OrderItem`, `OrderAccessToken`). | `OrderItem → InventoryItem` es RESTRICT (`:1463`, relación obligatoria sin `onDelete`): **`Order` va antes que las piezas**. `InventoryItem.reservedByOrderId` es `SET NULL` (`:1094`): inocuo. |
| 10 | `SellRequest` (cascada `SellRequestItem`). | Tras 8 (M-72). |
| 11 | **`DELETE FROM "InventoryItem"`** (todas; cascada movimientos y levantamientos). | Ya sin referencias RESTRICT. |
| 12 | `InventoryBatch` (todas); `PendingPriceEntry WHERE context IN ('inventory','portfolio')`. | Sin FK. |
| 13 | `SpendAlert`, `PortfolioSnapshot`, bounties (igual que v1). | — |
| 14 | `AuditLog` (igual que v1) + rastro. | — |
| 15 | Conteos después + **G-5** + comprobación final de variables (`respaldo_manual`, `cuentas_prueba`). | — |
| 16 | `ROLLBACK;` (el dueño lo cambia a `COMMIT;`). | — |

**Desaparecen de B:** `lz_plan`, `lz_mov_borrar`, `lz_buylist`, `lz_excl`; los pasos 9, 10 y 12 de v1 (restaurar,
movimientos de cierre, P-1); las variables ✏️ 2 `fuera_de_venta` y ✏️ 3 `buylist_piezas`; las listas 2.4, 2.5 y 2.7.
`lz_t` (el conjunto `T`) **se queda solo para G-1…G-3** (ya no es plan de nada).

**Guardas — qué pasa con cada una:**

| Guarda | v2 |
|---|---|
| G-1 (pieza `customer` fuera de `T`) | **Se queda.** Una pieza de cliente que no vino de un pedido tiene origen desconocido; borrarla a ciegas es justo lo que no se hace. |
| G-2, G-3 | **Se quedan** (misma razón: el modelo de la base no es el que el diseño conoce ⇒ se para). |
| G-4 (P-1) | **Desaparece** (P-1 no aplica, `HECHOS.md:80`). |
| G-5 | **Cambia el esperado:** `0` en todo el grupo `borrar` (que ahora incluye `InventoryItem`, `InventoryMovement`, `InventoryAdjustment`, `InventoryBatch`); `PendingPriceEntry` = antes − filas `inventory`/`portfolio`; el resto como v1. |
| G-6 (forma de la pieza restaurada) | **Desaparece** (no hay restauración). La sustituye G-5 (`InventoryItem` = 0). |
| G-7 | **Se queda y gana alcance solo:** `InventoryItem` e `InventoryBatch` pasan al grupo `borrar`, así que **tras re-subir inventario una 2.ª corrida de B se niega**. Es exactamente lo que tiene que pasar. |
| G-8 | Se queda; la clasificación de tablas se actualiza con §14.2. |
| **G-9 (nueva)** | Custodia de clientes, §14.4. |
| P-2 / `fuera_de_venta` | **Desaparece.** |
| `respaldo_manual` | Se queda (obligatorio para el COMMIT). |

**Rastro (§6.3):** se quitan `piezasRestauradas`, `piezasExcluidas`, `piezasBuylist*`. Se añaden
`inventarioBorrado: {total, porTipo: {raw, graded, sealed}, custodiaPorUsuario: {<userId>: n}}` (ids, sin correos ni
folios) y `cuentasPrueba: <número de cuentas declaradas>`. `secuencias` se sigue escribiendo (D lo usa para `ENV-`).

### 14.4 Custodia de clientes: guarda G-9

**Por qué es improbable que haya algo real, y por qué igual se guarda.** Una pieza solo pasa a `ownerType='customer'`
por un pedido de bóveda pagado (G-1 lo exige), y **ningún pedido fue real**: siempre modo prueba de Stripe
(`HECHOS.md:16`, `:119-122`). Pero la base **no guarda** si un pago fue de prueba o real (sin `livemode` en el schema ni
en el código: `rg livemode backend` = 0, medido), y **no existe marca de «cuenta de prueba»** en `User`
(`schema.prisma:555-619`). La única fuente de verdad sobre quién es de prueba es el dueño.

**Diseño (recomendado; no hace falta pregunta, es un paso del guion):**
- Variable nueva ✏️ `cuentas_prueba`: correos (o ids de usuario, para cuentas anonimizadas sin correo) separados por coma.
- El ensayo imprime **la lista de custodia por dueño** (correo, nombre, rol, nº de piezas, nº de pedidos).
- **G-9 aborta** si existe **cualquier** pieza `ownerType='customer'` cuyo `ownerUserId` no esté en `cuentas_prueba`
  (incluye `ownerUserId` nulo). Con 0 piezas de cliente pasa con la lista vacía.
- **Errata:** un correo/id de la lista que **no existe** en `User` también aborta (mismo criterio que el folio erróneo de
  P-2 en v1: un error tipográfico no decide borrar nada).
- Igual que `respaldo_manual`, la falta de respuesta se comprueba **al final** (decisión 1 de `BACKEND_NOTES` §79, que
  ratifico), para que el ensayo enseñe la lista antes de pedirla; la discrepancia (pieza de alguien no declarado) aborta
  también al final con la lista de quiénes faltan.
- ⛔ No se infiere «de prueba» por dominio de correo, por rol ni por fecha: sería adivinar.

### 14.5 Folio `INV-`: reinicio

**Dónde se genera (medido):** solo `inventory_folio_seq` (creada en `migrations/0000000000000_init/migration.sql:620`),
vía `PrismaService.nextFolio()` / `nextFolios(n)` (`backend/src/prisma/prisma.service.ts:15-35`). Llamadores:
`inventory.service.ts:775` (alta), `:1441` (lote), `:3468` (encontrada); `buylist.service.ts:7937` (conversión). Ningún
otro sitio fabrica `INV-` (`rg "INV-|nextFolio" backend/src`, el resto de aciertos son nombres de invariantes `INV-D`,
`INV-FX`…).

**Cómo:** `setval('inventory_folio_seq', 1, false)` ⇒ el siguiente `nextval` es 1 ⇒ `INV-000001`. **En el fichero C**
(post-COMMIT), nunca en B: §5.4 sigue mandando (las secuencias no se deshacen con `ROLLBACK`; B no lleva ningún
`setval`/`nextval`).

**Fichero C v2** (`…_3_folios.sql`; el nombre lo elige backend y se ajustan las pruebas):
- `LOCK TABLE "Order", "InventoryItem" IN SHARE ROW EXCLUSIVE MODE`.
- **Cada contador con su propia guarda, independientes:** `TCG-` solo si `Order` está vacía (como v1); `INV-` solo si
  `InventoryItem` está vacía. Si una tabla ya tiene filas, **ese** contador no se toca y lo dice en castellano con la
  **frase común de §14.12** (C y D dicen lo mismo; ⛔ ya no «no pasa nada»); el otro se reinicia igual. Si **ninguno** se puede, aborta
  (mensaje de QA-8 adaptado). Motivo de la independencia: si el dueño re-sube inventario antes de correr C, no debe
  perder el reinicio de `TCG-`, y un `INV-` sin reiniciar es inocuo.
- ⛔ `ENV-` sigue **sin** reiniciarse (§5.2 intacto, medido y con prueba §9.7).
- Imprime `last_value`/`is_called` antes/después y el próximo folio de cada uno.

**Carrera residual:** un alta que tome `nextval` entre la comprobación y el `setval` dejaría una pieza con folio
**adelante** del contador ⇒ `P2002` el día que el contador lo alcance. Mitigación: el candado (bloquea el `INSERT`, no el
`nextval`), la instrucción «C antes de re-subir» y una línea nueva de D (§14.7): **ningún folio por delante de su
contador**, para `INV-` y `TCG-`.

**¿`INV-` es llave en algún sitio externo? (medido)**

| Sitio | ¿Lleva `INV-`? | Riesgo tras reiniciar |
|---|---|---|
| Etiquetas físicas | No: «las cartas no tienen folio» (`HECHOS.md:79` (b)). | Ninguno. |
| Skydropx | **No.** A Skydropx solo viaja `address_to.reference = "Pedido ENV-…-NN"` (`shipping-provider/skydropx.adapter.ts:153-154`). | Ninguno. |
| Stripe | No hallado: en `modules/payments` `folio` solo aparece en DTOs de pantallas de reembolso (`admin-refunds.controller.ts:89-108`, `manual-refund.service.ts:252-342`), no en metadatos. | Ninguno (y esas filas se borran). |
| Correos ya enviados | Medido sin `INV-`: envíos (`shipment-notice.templates.ts:114-121`, `ENV-`/número de pedido), disputas (id de la disputa, `disputes.service.ts:128`), buylist (id de la solicitud). Correos de **pedido** que listen piezas por folio: **NO MEDIDO** (en `modules/orders` no hay plantillas con `folio`). | Bajo: si un correo viejo de prueba cita `INV-000123`, el cliente ya no tiene esa pieza. |
| Export `.xlsx` ya descargado | **Sí**, una fila por folio (`inventory.controller.ts:557-562`). No hay importación que lea folios (`rg import.xlsx|importXlsx` en `inventory` = 0). | **Confusión humana:** tras reiniciar, `INV-000001` del Excel viejo ≠ `INV-000001` nuevo. Mitigación: el guion del dueño lo dice; el Excel viejo se usa como chuleta de cartas, no de folios. |
| Bitácora | Sí (p. ej. `inventory.bulk_remove` guarda `folios`, `inventory.controller.ts:550`). | Se borra entera en B; el CSV opcional y el respaldo de Railway la conservan con folios **viejos**. El rastro v2 no lleva folios (§14.3). |
| «Mi bóveda» del cliente | Sí (`VaultView.tsx:428`, `ShipmentsView.tsx:285`). | Ninguno: las piezas de custodia se borran. |
| `InventoryBatch.resultJson` | Sí. | Se borra (§14.2). |

### 14.6 Fotos: no hay nada que borrar ni que listar en R2

Medido: las piezas **no tienen fotos propias** — M-13 eliminó `frontPhotoKey/backPhotoKey/extraPhotoKeys`
(`schema.prisma:1028-1029`: «la imagen es la de catálogo remota»); tampoco el buylist (`:2342`) ni las disputas
(`:2391`). El único escritor del bucket es `uploads.service.ts` y solo admite `purpose="kyc_ine"` (`:159-167`, llave
`kyc_ine/<fecha>/<uuid>`, `:220`); el único `PutObjectCommand` de `backend/src` está ahí (`:221`). En el front,
`PhotoUploader` solo se usa con `purpose="kyc_ine"` (`KycSection.tsx:229-230`, `BuylistKycForm.tsx:521-527`).
⇒ **Se retira el supuesto «fotos huérfanas en R2»** de `HECHOS.md:80`: no hay listado previo que hacer y el guion no
toca el bucket. Las imágenes viven en el catálogo, que se conserva: `Card.imageSmallUrl/imageLargeUrl`
(`schema.prisma:882-883`) y `SealedProduct.imageUrl` (`:853`).

**`InventoryItem.sealedImageUrl` sí vive en la fila de la pieza** (`schema.prisma:1077`) y se pierde al borrarla. Se
repone sola al re-subir: el alta de sellado con `sealedProductId` la **copia de `SealedProduct.imageUrl`**
(`inventory.service.ts:1081-1100`, «los 4 campos M-37 sueltos se IGNORAN… se sobreescriben desde el SealedProduct»), y
`SealedProduct` se conserva. El alta legada sin `sealedProductId` la toma de la petición, saneada contra la lista de hosts
(`inventory.service.ts:1238-1262`); que el front la mande en ese camino: **NO MEDIDO** (es el camino legado).

(R-6 —INE de vendedores de prueba sin purga— sigue igual: es el único contenido real del bucket y no lo toca esta
limpieza.)

### 14.7 Paso E y verificación D

**Paso E (`limpieza:republicar`): sobra — se RETIRA, no se deja inerte.** Sin piezas restauradas no tiene entrada; el
rastro v2 no trae `piezasRestauradas`, así que inerte saldría con «sin rastro» / código 1 y confundiría al dueño, y
dejaría código de un solo uso sin uso (deuda). Retirar (backend, con `rg` antes de borrar):
`src/cli/limpieza-republicar.ts`, `src/modules/inventory/limpieza-republicar.ts`, el script `limpieza:republicar` de
`package.json:28`, `test/limpieza-republicar.cli.spec.ts`, el bloque «QA-1 · E» y la prueba «E1» de
`pdb-limpieza.e2e-spec.ts`, y el texto del paso E en el encabezado de B. `InventoryService.previewPublication`
(`inventory.service.ts:3040-3046`) y el campo aditivo `detail?` (`inventory-publish.port.ts:111`) se retiran **si**
`limpieza-republicar` es su único consumidor (`previewPublication`: medido 2026-10-07 con `rg` en `backend/`, solo
su definición y `limpieza-republicar.ts:130`; `detail?`: **NO MEDIDO**; backend re-mide ambos antes de borrar). Si alguno ya está en
`production`, se retira igual por el flujo normal. La pregunta abierta de `BACKEND_NOTES` §79.2 («¿`listed` se queda
`listed`?») **queda sin objeto**.

**D v2 (cambios):**
- Pasan al patrón «0 filas **anteriores al rastro**» (como `PortfolioSnapshot`/`SpendAlert`, QA-7), para que D siga
  valiendo tras re-subir: `InventoryItem`, `InventoryMovement`, `InventoryAdjustment`, `InventoryBatch` (todas por
  `createdAt`), y `PendingPriceEntry` con `context IN ('inventory','portfolio')`.
- `PendingPriceEntry` `catalog`/`buylist` y `VaultLocation`, `SealedProduct`, `VariantPriceOverride`: INFO de conteo.
- Se quitan: «mismo conteo que tras la limpieza: InventoryItem» y «contador `inventory_folio_seq` igual que en la
  limpieza».
- Se añaden: «siguiente `INV-` = `INV-000001`, **o** ya hay piezas nuevas y el folio mínimo es `INV-000001`»
  (**sustituida por §14.12**: tres salidas OK/AVISO/FALLA, mínimo numérico, contra el rastro);
  «**ningún folio por delante de su contador**» (`max` numérico de `InventoryItem.folio` ≤ `last_value` de
  `inventory_folio_seq` si `is_called`; ídem `Order.orderNumber` / `order_number_seq`).
- `shipment_folio_seq` igual que en el rastro: **se queda** (leída de la secuencia misma, no de `pg_sequences`: §14.12 MENOR-1).

### 14.8 Guion del dueño v2 (sustituye §8.2)

1. Terminan las pruebas (como v1).
2. **Descarga el Excel de inventario** (M1 → exportar) y guárdalo: es tu lista para volver a subir. Sus folios son los
   viejos.
3. Corre **A** (censo). Si G-1…G-3 dan algo ≠ 0, para y pregunta.
4. Respaldo manual en Railway.
5. Corre **B** tal cual (ROLLBACK). Lee: pedidos, envíos, solicitudes, **custodia por dueño** y el **resumen del
   inventario que se borra**.
6. Escribe ✏️ `respaldo_manual` y ✏️ `cuentas_prueba`; vuelve a correr (ROLLBACK, debe llegar al final); cambia a
   `COMMIT;` y córrelo. Copia el punto PITR.
7. Corre **C** (folios: `TCG-000001` e `INV-000001`) — **antes** de dar de alta nada.
8. Corre **D**: todo OK.
9. Re-sube tu inventario en M1 (la primera pieza debe salir `INV-000001`).
10. `sk_live_` y primera compra (debe salir `TCG-000001`).

### 14.9 Pruebas (§9) — qué cambia y qué es nuevo

**Fixture:** añadir una pieza **sellada** con `sealedProductId` y `sealedImageUrl`, un `SealedProduct` con
`ownerDisplayPriceCents`, filas `InventoryBatch`, `PendingPriceEntry` de los **cuatro** contextos, cajones de las dos
zonas, y piezas de custodia de **dos** clientes (uno se declarará de prueba y otro no). Lo de P-1/P-2/Cinccino-a-venta
deja de ser necesario como caso (se puede quedar en el fixture: se borra igual).

| Prueba existente | v2 |
|---|---|
| §9.1 ensayo ×2 (foto de contenido + tres secuencias idénticas) | **Igual.** Es la que garantiza que B no toca contadores. |
| §9.2 corrida | **Reescribir:** 0 filas en `InventoryItem/Movement/Adjustment/Batch` y en `PendingPriceEntry` `inventory/portfolio`; **foto de contenido idéntica** (no solo conteo) de `Card`, `CardSet`, `SealedProduct` (incl. `imageUrl`, `ownerDisplayPriceCents`), `PriceReference`, `VaultLocation`, `ConfigSetting`, `User`, `PendingPriceEntry` `catalog/buylist`, y `VariantPriceOverride` salvo las dos columnas de bounty. |
| §4.4 movimientos de cierre | **Se borra.** |
| §2.2 bounty, §9.3 idempotencia, CS-1 `\copy`, C-1/QA-9 salida, C-3/G-8, C-4/QA-6 concurrencia, QA-7 | **Igual** (G-8 con la clasificación nueva). |
| §9.5 fail-closed de precio, P-1 ×1, P-2 ×1, G-4 ×2, folio de exclusión, M3 (lista 2.4), QA-1 · E entero, E1 | **Se borran.** |
| G-1, G-2, G-3, respaldo vacío, G-7 | **Igual.** |
| A/D | D sin limpiar ⇒ FALLA; tras B + C ⇒ OK. **Nuevo:** tras B + C + alta de 3 piezas por la **app** (`PrismaService.nextFolios`, no SQL) ⇒ D sigue OK y las piezas son `INV-000001…3`. |
| §9.6 C | Con pedidos ⇒ `TCG-` no se mueve. **Nuevo:** con piezas y sin pedidos ⇒ `TCG-` se reinicia, `INV-` **no** y lo dice; con ambas tablas llenas ⇒ aborta; sin nada ⇒ `TCG-000001` e `INV-000001`, `ENV-` igual. |
| §9.7 ENV- (N = 3 esquemas) y §9.8 sin M-72 | **Igual.** |
| QA-8 | Mensaje adaptado a C v2. |

**Nuevas:**
1. **G-9 muerde:** pieza de custodia de un cliente no declarado ⇒ aborta, base idéntica, el mensaje nombra al cliente.
   Con ambos declarados ⇒ pasa y sus piezas se borran. Correo inexistente en la lista ⇒ aborta (errata). Sin piezas de
   cliente y lista vacía ⇒ pasa.
2. **G-7 tras re-subir:** B (COMMIT) + alta de 1 pieza ⇒ B se niega y no borra la pieza nueva.
3. **D: folio por delante:** se fuerza una pieza `INV-000050` con el contador en 1 ⇒ D da FALLA en esa línea.

**Mutaciones obligatorias** (en copia del árbol **entero**, O-9; proporción con su N, O-3):

| # | Mutación | Debe poner en rojo |
|---|---|---|
| M-v2-1a | B sin el `DELETE FROM "InventoryItem"` | §9.2 (B aborta por G-5). |
| M-v2-1b | **«no se borró el inventario» sin que B lo note:** sin el `DELETE` **y** con `InventoryItem` reclasificada a `conservar` (G-5 de B pasa) | §9.2 por **medición directa** de la prueba (no por la guarda de B) **y** D («0 anteriores al rastro»). Si solo cae por G-5, la prueba no muerde. |
| M-v2-1c | `DELETE` acotado a `ownerType='platform'` (deja la custodia) | §9.2 y D. |
| M-v2-2a | **«se reinició `ENV-`»:** C añade `setval('shipment_folio_seq', 1, false)` | §9.6 («`ENV-` igual») y el control de §9.7 — **N ≥ 3 esquemas**, reportar `k/N`. |
| M-v2-2b | B hace `setval` de `inventory_folio_seq` | §9.1 ×2 (el ensayo movería un contador). |
| M-v2-3 | C reinicia `INV-` sin mirar si hay piezas | §9.6 nuevo «con piezas, `INV-` no se mueve». |
| M-v2-4 | G-9 desactivada | Nueva 1. |
| M-v2-5 | el borrado de la cola incluye `catalog`/`buylist` | §9.2 (foto de `PendingPriceEntry` conservada). |
| M-v2-6 | D sin la línea «folio por delante» | Nueva 3. |

### 14.10 Riesgos nuevos

| # | Riesgo | Mitigación |
|---|---|---|
| R-10 | El dueño pierde por pieza precio manual, costo, cajón y certificado. | Es la decisión (`HECHOS.md:80`); Excel previo (§14.8 paso 2); lo de variante/producto se conserva (§14.2). |
| R-11 | `INV-` viejos en Excel, CSV de bitácora y respaldo nombran otra pieza tras reiniciar. | §14.5 tabla; el guion lo avisa. Ninguna importación lee folios. |
| R-12 | Alta entre la guarda y el `setval` de C ⇒ `P2002` futuro. | Candado + «C antes de re-subir» + D «ningún folio por delante». |
| R-13 | Al re-subir sellado, las suscripciones de reposición pendientes (`SealedRestockSubscription`, se conservan) casarían en masa y, **si** el dial `sealed_restock_alerts` está `on` y se dispara el job (manual), saldrían correos (`sealed-restock-notify.service.ts:20-29, 75-99`). | Informativo. Estado del dial en producción: **NO MEDIDO** (seed `off`). Si está `on`, no disparar el job hasta terminar de re-subir. |
| R-14 | Custodia real borrada. | G-9 (§14.4) + `HECHOS.md:16,119-122`. |

### 14.11 Preguntas para el dueño

**Ninguna bloquea.** P-1 y P-2 desaparecen. Quedan:
- **P-3** (simulacro de restauración antes) — igual que v1, recomendación **sí**; con v2 pesa más: lo borrado ahora
  incluye tu inventario entero y la única marcha atrás es PITR.
- `cuentas_prueba` no es pregunta: el ensayo te enseña quién tiene piezas en custodia y tú escribes la lista.
- Los supuestos de `HECHOS.md:80` («pendientes de que los corrija») se dan por buenos; si el dueño quisiera conservar el
  **sellado** o la **custodia**, cambian §14.2 (borrado acotado por `productType`/`ownerType`), G-9 y C (con piezas
  vivas `INV-` no podría reiniciarse: §5.3 volvería a aplicar).

### 14.12 v2.1 (2026-10-07) — C y D dicen lo mismo del folio `INV-` (QA N-1, MENOR-1, MENOR-3)

Hallazgos de QA sobre `ec808db2` (rama `claude/limpieza-db`). N-1 **medido por QA** (no por mí); MENOR-1 razonado por
QA; MENOR-3 **NO MEDIDO** por QA ni por mí. Los tres van a backend **juntos** (mismos dos ficheros + una spec).

**N-1 · el defecto.** Secuencia: B COMMIT → el dueño sube 2 piezas (`INV-000015/016`) → C exit 0 y dice
`NO se toca: … tus folios siguen desde ahí; no pasa nada` (`…_3_folios.sql:86`) → D dice
`FALLA | contador de inventario … | primera carta INV-000015` y `HAY FALLAS (1)` (`…_4_verificacion.sql:167-171`).
Origen: §14.5 (guardas independientes, «inocuo») contra §14.7 (D exige `INV-000001`). Un paso dice «no pasa nada» y el
siguiente dice «falla» sobre el mismo estado: el dueño no sabe a cuál creer.

**Decisión: cambia D (acepta el caso), y C cambia su frase. C NO pasa a exigir orden.** Motivos:
1. Exigir orden en C (negarse si hay piezas) **pierde el reinicio de `TCG-`**, que es el que importa (el primer pedido
   real); es justo lo que la independencia de §14.5 protege.
2. Tras subir piezas, `INV-` **ya no se puede** reiniciar sin chocar (§5.3); negarse no arregla nada, solo bloquea.
3. Dejar `INV-` sin reiniciar es inocuo (tabla de §14.5, medida: ni etiquetas, ni Skydropx, ni Stripe llevan el folio).
4. Pero el dueño pidió «reiniciar folios» (`HECHOS.md:79`, 2026-10-06, «(3) Folios reinician»), así que **no** es «no
   pasa nada»: es un **AVISO** — se le dice que su petición no se cumplió para `INV-`, por qué, y que no rompe nada.

**Estado nuevo de D: `AVISO`.** Se enseña, **no cuenta como falla** (como `INFO`), pero es distinto de `INFO`: dice que
algo no salió como se pidió. La línea final cuenta fallas sobre `resultado NOT IN ('OK','INFO','AVISO')` y, si hay
avisos, dice `VERIFICACION: TODO OK (con N aviso(s))` (sigue casando `/VERIFICACION: TODO OK/`).

**Frase común (literal, la misma en C y en D; las pruebas la buscan como subcadena):**
`NO se reinició INV-: ya había piezas cuando corriste C`
- C (sustituye `…_3_folios.sql:86`): `NO se reinició INV-: ya había piezas cuando corriste C (N pieza(s), de INV-xxxxxx a
  INV-yyyyyy). Tus folios siguen desde ahí, no desde INV-000001. No rompe nada (ningún folio va en etiquetas, guías ni
  pagos). La próxima vez, este paso va ANTES de subir cartas.` — `xxxxxx/yyyyyy` = mínimo y máximo **numéricos** (ver
  MENOR-3; `…_3_folios.sql:65` hoy usa `max(folio)` de texto).
- D línea 51: resultado `AVISO`, detalle `NO se reinició INV-: ya había piezas cuando corriste C · primera INV-xxxxxx ·
  siguiente INV-zzzzzz · no rompe nada`.

**D línea 51 v2.1 (sustituye `…_4_verificacion.sql:166-171`).** Definiciones: `R` = `rastro.secuencias.inventory_folio_seq`
(el `last_value` en la limpieza, lo escribe B en `…_2_limpieza.sql:420`); `m` = mínimo **numérico** de los folios
`^INV-[0-9]+$` (como ya hace `mayor` en `…_4_verificacion.sql:114`); `P` = siguiente de `inventory_folio_seq`;
`T1` = «siguiente `TCG-` es 1» (la condición de la línea 50, `:163`).

| Caso | Condición | Resultado |
|---|---|---|
| Sin rastro (base sin limpiar) | `count(rastro) <> 1` | `FALLA` (se conserva: la prueba de `pdb-limpieza.e2e-spec.ts:369` lo exige) |
| Reiniciado, sin piezas | sin piezas ∧ `P = 1` | `OK` |
| Reiniciado, piezas subidas | hay piezas ∧ `m ≤ R` | `OK` (cubre MENOR-3: si se borra `INV-000001`, `m = 2 ≤ R`) |
| No reiniciado porque C encontró piezas | hay piezas ∧ `m > R` ∧ `T1` | `AVISO` (frase común) |
| C no se corrió / se negó | cualquier otro caso (p. ej. hay piezas ∧ `m > R` ∧ ¬`T1`; sin piezas ∧ `P ≠ 1`) | `FALLA`, detalle `el contador no se reinició y C no corrió (el de pedidos tampoco está en TCG-000001)` |

Por qué `T1` en el `AVISO`: sin él, «nunca corriste C» saldría como aviso con un motivo falso. `T1` prueba que C sí corrió
(es el único que reinicia `TCG-`, y tras B `Order` está vacía). La línea 52 («ningún folio por delante») **no cambia** y
sigue siendo la que vigila la integridad.

Puntos ciegos aceptados (los digo, no los tapo): (a) si tras reiniciar se suben **más** de `R` piezas y se borran las
primeras `R`, `m > R` y saldría `AVISO` con motivo falso — inofensivo (no es `FALLA` ni oculta una); (b) si `R` = 1 con
`is_called = f` (contador nunca usado) reiniciado y no reiniciado son el mismo estado. En producción `R` es el último folio
dado antes de limpiar: QA vio `INV-000015` como siguiente ⇒ `R = 14` en **su** fixture; el valor real de producción: **NO
MEDIDO** (lo imprime B en el ensayo).

**MENOR-1 · `pg_sequences.last_value` es NULL si la secuencia nunca se leyó** (`…_4_verificacion.sql:106-109` y
`:180-183`; QA lo ubicó «~53», es la comprobación de orden 53). Con `shipment_folio_seq` sin `nextval` nunca, B guarda
`1` (lee `SELECT last_value FROM shipment_folio_seq`, `…_2_limpieza.sql:419`) y D compara contra `NULL` ⇒ `FALLA` falso
`ahora ?`. **Cambio:** D lee `SELECT last_value FROM shipment_folio_seq` (misma fuente que B); se retira el CTE `sec`.
Punto ciego residual: B no guarda `is_called`, así que pasar de «nunca usado» (1, f) a «un `nextval`» (1, t) no se ve;
en producción hay `ENV-` emitidos (`ENV-000003` en Skydropx, `HECHOS.md:79`) ⇒ `is_called = t` probable, **NO MEDIDO** en
la base. No se amplía el rastro de B por esto (tocaría §9.1).

**MENOR-3 · `min(folio)` de texto** (`…_4_verificacion.sql:115` y la comparación `f.menor = 'INV-000001'` de `:168`;
QA lo ubicó «~51»). Se resuelve dentro de la tabla de arriba: `m` numérico y `m ≤ R` en vez de `= 'INV-000001'`. Mismo
cambio en C (`:65`): mínimo y máximo numéricos para la frase. (La rama `TCG-` de `folios`, `:120`, deja de usarse para
`menor`; backend puede quitarla.) Que la app pueda **borrar la fila** de una pieza (y no solo cambiarle el estado), que
es lo que haría real este caso: **NO MEDIDO**; la prueba lo construye por SQL como precondición.

**Pruebas que deben fallar HOY** (en `test/integration/pdb-limpieza.e2e-spec.ts`; deterministas, sin carrera ⇒ una
tirada basta, O-3 no aplica; altas por la **app** con `altaPorApp`, como `:391`):

| # | Pasos | Esperado | Hoy (en `ec808db2`) |
|---|---|---|---|
| T-N1 | B COMMIT → `altaPorApp(e, 2)` → C → D | C exit 0, su línea de inventario contiene la frase común y `INV-` mínimo = `R+1`; TCG reiniciado. D: `AVISO \| contador de inventario…` con la **misma** frase y el **mismo** primer folio que C; `VERIFICACION: TODO OK`; ninguna `FALLA` | Rojo: C dice «no pasa nada» y D `FALLA` (medido por QA) |
| T-N1-ctl | B COMMIT → `altaPorApp(e, 2)` → **sin C** → D | línea 51 `FALLA` (no `AVISO`), línea 50 `FALLA`, `HAY FALLAS` | Verde hoy; es el candado contra un `AVISO` que tape «no corriste C» |
| T-M3 | B COMMIT → C → `altaPorApp(e, 3)` → borrar por SQL la fila `INV-000001` → D | línea 51 `OK`, `TODO OK` | Rojo: `menor = 'INV-000002'` ⇒ `FALLA` (deducido del código, **NO MEDIDO**) |
| T-M1 | **antes de B**: `setval('shipment_folio_seq', 1, false)` y afirmar `is_called = f` (precondición, para que la prueba ejerza el caso) → B COMMIT → C → D | línea 53 `OK`, detalle `ahora 1 · rastro 1` | Rojo: `ahora ?` ⇒ `FALLA` (deducido, **NO MEDIDO**) |

Se mantienen sin cambio: `:363-385` (D sucia ⇒ `FALLA` en «contador de inventario»; B+C ⇒ `TODO OK`), `:387-394`,
`:396-406`, §9.6/§9.7 (incluida la mutación M-v2-2a: con la lectura nueva, `setval` de `ENV-` en C debe seguir poniendo
la línea 53 en `FALLA`).

**Mutaciones** (en copia del árbol entero, O-9; deterministas ⇒ N = 1 por mutación vale, reportar `1/1`):

| # | Mutación | Debe poner en rojo |
|---|---|---|
| M-N1-a | D cuenta `AVISO` como falla | T-N1 |
| M-N1-b | `AVISO` sin la condición `T1` | T-N1-ctl |
| M-N1-c | C vuelve a la frase vieja | T-N1 (subcadena común) |
| M-M3 | D vuelve a `min(folio) = 'INV-000001'` | T-M3 |
| M-M1 | D vuelve a `pg_sequences` | T-M1 |

**Guion (§14.8):** el paso 7 se queda («C **antes** de dar de alta nada»); se añade en el paso 8: «si D dice `AVISO` en el
contador de inventario, es que subiste cartas antes de C: no rompe nada, tus folios no empiezan en INV-000001».
Comentarios de cabecera a ajustar por backend: `…_3_folios.sql:15-16` («no pasa nada») y `…_4_verificacion.sql:36-37`
(«que el folio empiece en INV-000001»).

Sin cambio de `API_CONTRACT.md` ni de `ARCHITECTURE.md` (son guiones SQL de un solo uso, sin endpoint ni schema).

### 14.13 v2.2 (2026-10-08) — la limpieza conoce las 9 tablas de `M-73` y `M-74` (errata v1.88.1⟨release-s7⟩)

> **El problema (medido por el orquestador en CI, run `37733554396`, job `backend-e2e`; no lo medí yo):** con `M-73` y
> `M-74` en la base, `pdb-limpieza.e2e-spec.ts` da 39 rojas porque B se para en **G-8**
> (`…_2_limpieza.sql:171-184`): `Accessory, AccessoryPhoto, AccessoryStockMovement, OrderAccessoryLine,
> OrderEnergyBundleComponent, ShipmentAccessoryLine, WishlistItem, WishlistMail, WishlistNotice` no están clasificadas.
> G-8 hace lo que debe (falla cerrado); lo que falta es la clasificación.
> **Árbol leído:** `/home/user/tcg-release`, rama `claude/release-s7`, HEAD dado por el orquestador `d92d9b82` (⛔ sha NO
> MEDIDO: sin Bash). Citas `schema.prisma:<línea>` y `m73…/migration.sql:<línea>` de ese árbol, 2026-10-08.
> **Relación con lo ya diseñado:** `API_CONTRACT §WSH.11` LZ-W1, LZ-W2, LZ-W4 (a)(b) y LZ-W5 siguen vigentes y se
> escriben **junto** con esto (el B de `a7232d7a` no tiene ninguna: lo medí leyendo `…_2_limpieza.sql:155-169`, sin
> `Wishlist*`). **LZ-W3 y LZ-W4 (c) quedan sustituidas** por LZ-A8 de abajo (decisión del dueño del 2026-10-08).
> **⛔ No toca la corrida de hoy.** El dueño corre hoy en producción el B de `a7232d7a` sobre una base **sin** `M-73`/`M-74`
> (dato del orquestador). Es el orden que `§WSH.11` «Orden de despliegue» ya preveía («la limpieza sin LZ-W1…W3 se corre
> **antes** de desplegar `M-74`»). Este diseño es para el guion versionado **después** de publicar #84, y sobre una base
> **sin** las tablas nuevas tiene que dejar **exactamente** el resultado de `a7232d7a` (LZ-A9, con su prueba).

#### 14.13.1 Clasificación de las 9 tablas

| Tabla | Grupo | Por qué | FK que manda el orden (`schema.prisma` · `migration.sql`) |
|---|---|---|---|
| `OrderAccessoryLine` | **borrar** | Renglón de un pedido: transaccional, como `OrderItem`. | `orderId → Order` **RESTRICT** (`:2850` · `m73:221`) ⇒ se borra **antes** del paso 9. `PaymentRefund.orderAccessoryLineId` RESTRICT (`m73:213`): `PaymentRefund` ya cayó en el paso 4. |
| `OrderEnergyBundleComponent` | **borrar** | Componente del paquete de energías de un renglón. | `lineId → OrderAccessoryLine` **RESTRICT** (`:2885` · `m73:225`) ⇒ **antes** que `OrderAccessoryLine`. |
| `ShipmentAccessoryLine` | **borrar** | Línea de preparación de un envío. | `shipmentRequestId → ShipmentRequest` **RESTRICT** (`:2901` · `m73:229`) ⇒ **antes** del `DELETE` de `ShipmentRequest` (paso 8). → `OrderAccessoryLine` RESTRICT (`m73:231`). `PaymentRefund.shipmentAccessoryLineId` RESTRICT (`m73:215`): paso 4. |
| `AccessoryStockMovement` | **borrar** | Historial de existencias: es **inventario** (igual que `InventoryMovement`). Sus filas de `sale`/`restock`/`settle_recovery` nombran pedidos que se borran (`orderId` sin FK, `:2837`). | `accessoryId → Accessory` RESTRICT (`:2830`): no importa, `Accessory` no se borra. |
| `Accessory` | **ajustar** (como `VariantPriceOverride`) | La **fila** es catálogo: nombre, categoría, medidas, precio, costo, activo, sugerido, foto. Se **conserva** entera. Sus **existencias** son inventario: `stockQty = 0` y `reservedQty = 0`. `reservedQty` **tiene** que ir a 0: es Σ de los renglones apartados (I-AC-2, `API_CONTRACT §AC.0`), y esos renglones se borran; dejarlo haría que el barrido (`accessoryReservedDrift`) viera apartados fantasma y que la tienda vendiera menos de lo que hay. | — |
| `AccessoryPhoto` | **conservar** | La imagen del catálogo, como `SealedProduct.imageUrl` (§14.2). Vive en Postgres (`bytea`, `:2812`): si se borrara, el dueño tendría que volver a subir cada foto. | `→ Accessory` CASCADE (`:2815` · `m73:217`): solo caería si se borrara el accesorio, y no se borra. |
| `WishlistNotice` | **borrar** (LZ-W1) | Sin `DELETE` propio: cae por CASCADE con la pieza en el paso 11 (`:2960`). | — |
| `WishlistItem` | **conservar** (LZ-W1) | Intención del usuario. | — |
| `WishlistMail` | **conservar** (LZ-W1) | Enlace de baja de correos ya enviados y tope diario. | — |

**¿Catálogo o inventario? El razonamiento.** El criterio del dueño (§14, `HECHOS.md:80`) separa **lo que describe un
producto** (catálogo, precios: se queda) de **cuántas piezas tienes** (inventario: se borra). Las cartas ya lo tienen
partido en dos tablas: `SealedProduct` (se queda, con su precio y su imagen) e `InventoryItem` (se borra). Los accesorios
lo tienen en **una sola fila**: `Accessory` lleva las dos cosas. Por eso la fila se **ajusta** y no se clasifica entera:
el producto se queda y el contador de existencias vuelve a 0. Borrar la fila entera sería tratar el catálogo como
inventario: el dueño volvería a capturar nombre, precio, costo, medidas y foto de cada accesorio, y se perderían las
**8 energías que siembra `M-73`** (`m73:415-425`, inactivas, MX$5, existencias 0). La semilla es idempotente por tipo
(`:425`), pero ya corrió: `migrate deploy` no la repite y el paquete de energías del deck se quedaría sin productos.
Conservar las existencias sería tratar el inventario como catálogo, y mezclaría piezas reales con el efecto de ventas de
prueba (cada `sale` de prueba restó piezas). ⇒ **Recomendación: ajustar.** Las 8 energías salen **intactas**: con 0
existencias no las toca ni el `UPDATE` (LZ-A4 lleva `WHERE` y no cambia ni su `updatedAt`).

**Lo que el dueño ve después (informativo):** los accesorios **activos** siguen activos y salen «agotado» en la tienda
hasta que reciba piezas (`accessories.service.ts:68`: la tienda solo vende `stockQty > reservedQty`). El ensayo le lista
las existencias que vuelven a 0 (LZ-A5), para que las vuelva a recibir como hace con las cartas desde su Excel.

#### 14.13.2 Cambios en B (`…_2_limpieza.sql`)

| # | Cambio | Por qué |
|---|---|---|
| LZ-A1 | **Detectar antes del `BEGIN`**, con `\gset` (mismo recurso que `…_1_censo.sql:54-55` y `:66`): `SELECT to_regclass(format('%I','Accessory')) IS NOT NULL AS lz_m73, to_regclass(format('%I','WishlistNotice')) IS NOT NULL AS lz_m74 \gset`. Después del `LOCK TABLE` de siempre (`:109`, **sin cambiarlo**): `\if :lz_m73` `LOCK TABLE "Accessory", "OrderAccessoryLine" IN SHARE ROW EXCLUSIVE MODE;` `\endif` y `\if :lz_m74` `LOCK TABLE "WishlistNotice" IN SHARE ROW EXCLUSIVE MODE;` `\endif`. | El candado no puede ir en un `DO` con `to_regclass`: cualquier consulta antes del `LOCK` toma la foto `REPEATABLE READ` (C-4, `:100-102`). La consulta antes del `BEGIN` corre fuera de la transacción y no toma foto. `Accessory`: la recepción del admin (`admin-accessories.service.ts:362-375`) y el barrido de apartados escriben existencias; sin candado, una recepción a mitad dejaría existencias ≠ 0 tras la limpieza (T-AC7). `WishlistNotice`: con el dial de deseos encendido (LZ-A8 ya no obliga a apagarlo) un job puede insertar avisos a mitad. **Sustituye** la frase de LZ-W3 «no hace falta añadirla al `LOCK TABLE`». Hueco residual aceptado: una migración que cree las tablas **entre** el `\gset` y el `BEGIN` las deja sin candado; G-8 las ve clasificadas y G-5 caza cualquier fila que sobreviva. |
| LZ-A2 | `lz_conteo` (`:155-169`): `borrar` += `OrderAccessoryLine`, `OrderEnergyBundleComponent`, `ShipmentAccessoryLine`, `AccessoryStockMovement`, `WishlistNotice`; `ajustar` += `Accessory`; `conservar` += `AccessoryPhoto`, `WishlistItem`, `WishlistMail`. | G-8 (`:173-184`) no cambia. G-7 (`:230-231`) gana alcance solo: tras la limpieza, recibir piezas de un accesorio crea un `AccessoryStockMovement`, y una 2.ª corrida se niega (T-AC5). Es lo que tiene que pasar. |
| LZ-A3 | **Borrados, cada uno dentro de `\if :lz_m73` … `\endif`, SQL normal (no dinámico):** antes de `'8 ShipmentRequest'` (`:335`): `'8 ShipmentAccessoryLine'`. Antes de `'9 Order'` (`:338`): `'9 OrderEnergyBundleComponent'` y luego `'9 OrderAccessoryLine'`. Después de `'11 InventoryItem'` (`:345`): `'11 AccessoryStockMovement'`. Mismo patrón `WITH x AS (DELETE … RETURNING 1) INSERT INTO lz_cambio …`. | Orden por las FK RESTRICT de la tabla de arriba. ⛔ **La etiqueta empieza por el número de paso y un espacio**: `lz_cambio` se ordena con `split_part(paso,' ',1)::int` (`:440`); una etiqueta `'8a …'` rompe ese cast y aborta la corrida. `\if` y no `DO`+`EXECUTE`: psql salta las líneas sin mandarlas al servidor, así que sin `M-73` el servidor **no recibe** sentencias que nombren tablas inexistentes, y el SQL se lee igual que el resto. |
| LZ-A4 | `'11 Accessory existencias'` (dentro de `\if :lz_m73`): `UPDATE "Accessory" SET "stockQty" = 0, "reservedQty" = 0, "updatedAt" = now() WHERE "stockQty" <> 0 OR "reservedQty" <> 0 RETURNING 1`. **Ninguna** otra columna. Antes de borrar, en el paso 2: `CREATE TEMP TABLE lz_acc` (incondicional y vacía) y, dentro de `\if :lz_m73`, `INSERT INTO lz_acc` con `id, name, category, active, stockQty, reservedQty` de las filas con existencias o apartados ≠ 0. | Las dos columnas en la **misma** sentencia: el CHECK `accessory_stock` (`0 ≤ reservedQty ≤ stockQty`) se cumple con ambos en 0. El `WHERE` hace la idempotencia (T-AC4: la 2.ª corrida no cambia nada ni escribe rastro) y deja intactas las 8 energías sin existencias. |
| LZ-A5 | **Listas del ensayo, solo con `M-73` / `M-74`:** `\if :lz_m73` → `=== 2.7 · ACCESORIOS: existencias que vuelven a 0 (anótalas: las vuelves a recibir en Accesorios) ===` con nombre, categoría, activo, existencias y apartadas, desde `lz_acc`. `\if :lz_m74` → `=== 2.8 · AVISOS ===`: estado de los dos diales (`ConfigSetting."valueJson" #>> '{}'`, clave ausente = `off`), suscripciones de sellado pendientes (armadas y sin armar), número de deseos y de correos de deseos. ⛔ Sin correos de clientes en 2.8: solo números. | El dueño ve antes del `COMMIT` qué existencias se pierden. Sin listas por pieza: hay pocos accesorios (catálogo), no miles. |
| LZ-A6 | **G-5:** LZ-W2 (`esperado = 0` solo si `antes IS NOT NULL`, en `:383`). `esperado = antes` también para `Accessory` (`:384`: `… OR tabla IN ('VariantPriceOverride','Accessory')`). Comprobación nueva, dentro de `\if :lz_m73`, en un `DO` propio después de G-5: si `EXISTS (SELECT 1 FROM "Accessory" WHERE "stockQty" <> 0 OR "reservedQty" <> 0)` ⇒ `RAISE EXCEPTION 'G-5 · Quedaron accesorios con existencias o apartados tras la limpieza: …. Se deshace TODO.'` (con los nombres, máx. 20). | Sin LZ-W2, una tabla `borrar` que no existe da `NULL ≠ 0` y G-5 aborta sobre una base sin `M-73`/`M-74` (rompe LZ-A9). La comprobación de existencias es la que hace que «no se pusieron en 0» no pase en silencio (M-A3). |
| LZ-A7 | **Rastro (`:406-428`):** la clave `accesorios` = `{conExistencias, existencias, apartadas}` (sumas de `lz_acc`; sin nombres) se añade **solo** con `M-73` (p. ej. `… || CASE WHEN to_regclass(format('%I','Accessory')) IS NOT NULL THEN jsonb_build_object('accesorios', …) ELSE '{}'::jsonb END`). **Tabla de conteos final (`:434-437`):** se muestran solo las filas con `antes IS NOT NULL OR despues IS NOT NULL`. | Sobre una base sin las tablas, el rastro y la tabla que ve el dueño quedan **iguales** a los de `a7232d7a` (LZ-A9). `conteosAntes`/`conteosDespues` ya filtran `NULL` (`:409-410`). |
| LZ-A8 | **G-10 v2 (sustituye LZ-W3), solo con `M-74`**, comprobada **al final** con las demás decisiones (`:443-461`; como `respaldo_manual`): **falta decisión** si `sealed_restock_alerts = 'on'` **y** hay `SealedRestockSubscription` con `"notifiedAt" IS NULL AND "armedAt" IS NULL`. Mensaje: `G-10 · El aviso «Avísame cuando vuelva» de sellado está ENCENDIDO y hay N suscripción(es) esperando que su producto se agote. Si borras el inventario así, el aviso las da por agotadas y al re-subir les llega «¡Volvió a existencia!» de productos que nunca se agotaron. Apágalo en Ajustes, corre esto, re-sube el sellado y vuelve a encenderlo.` **`wishlist_enabled` no para nada:** si está en `on`, 2.8 lo dice (LZ-W5: al re-subir, quien tenga la carta en su lista recibe **un** «ya la tenemos»). Implementación: el bloque final no puede llevar `\if` dentro (está entre `$$`); un `DO` previo dentro de `\if :lz_m74` escribe en una temporal `lz_falta` (creada vacía siempre) y el bloque final añade lo que haya. | Ver «Por qué G-10 se queda, pero condicionada», abajo. |
| LZ-A9 | **Sin las tablas nuevas, el mismo resultado que `a7232d7a`.** Ninguna sentencia que **llegue al servidor** nombra una tabla o columna de `M-73`/`M-74` fuera de `\if :lz_m73` / `\if :lz_m74` (igual que §11 con `M-72`). Las listas de `lz_conteo` sí las nombran como texto: `to_regclass` las cuenta como ausentes (`:190`, `:376`). | Lo que pide el encargo (eje «con y sin», como §9.8 y LZ-W4 (b)). |
| LZ-A10 | **Cabecera de B (`:7-17`):** «NO toca» suma «el catálogo de accesorios (nombre, precio, costo, foto, y las 8 energías), pero sus **existencias vuelven a 0**: anótalas de la lista 2.7» y «tu lista de deseos y los correos que ya mandó». `v2.2: 2026-10-08` en la línea de fecha. | Comentarios: no cambian la conducta. |

**Por qué G-10 se queda, pero condicionada (y no se quita ni se vuelve aviso).** La decisión del dueño, literal
(2026-10-08, relayada por el orquestador): «no hay clientes reales podemos no apagar la configuracion». Y el censo A que
corrió el dueño en producción: `SealedRestockSubscription` = 0 filas (dato del orquestador; **no lo medí yo**).
- LZ-W3 paraba **siempre** que un dial estuviera en `on`. Eso contradice la decisión: obligaría a apagar algo que el
  dueño dijo que no hace falta apagar. Así como estaba, **no se escribe**.
- Pero el daño que G-10 evitaba no es «el dial está encendido»: es «**hay clientes esperando** que su producto se agote».
  Solo esas suscripciones (pendientes y sin armar) se arman mal en el hueco entre la limpieza y la re-subida
  (`sealed-restock-notify.service.ts:129`: sin piezas vendibles ⇒ `armedAt`). Las ya armadas no cambian (su producto ya
  estuvo agotado de verdad) y las ya avisadas no se leen (`:97-98`, `notifiedAt: null`).
- La guarda nueva mide **la premisa** del dueño. Con 0 suscripciones (hoy) no para nada y el dial se queda como está:
  eso **es** su decisión. Si algún día la base que se limpia tiene clientes apuntados, la premisa ya no se cumple, y
  pararse a preguntar es lo correcto: un correo «¡Volvió!» falso a un cliente real no se puede retirar.
- **Quitarla** dejaría ese caso sin red. **Volverla aviso** lo dejaría en una línea que el dueño puede no leer, para un
  daño que sale a clientes. Condicionada, cuesta 0 con la base de hoy.
- **Sin `M-74` no se evalúa:** antes de `M-74` el job de sellados es manual (R-13) y `armedAt` no existe. El B de
  `a7232d7a` no tiene G-10 y la corrida de hoy no cambia.
- **Deseos, sin guarda:** con el dial encendido, al re-subir una carta que alguien desea, el «ya la tenemos» es **verdad**
  (la carta está a la venta). No hay correo falso que evitar. La carrera de un aviso que se inserta durante la limpieza la
  cierra el candado de LZ-A1, y si algo se cuela, falla cerrado: FK o serialización, y G-5 (`WishlistNotice` = 0).

#### 14.13.3 Cambios en D (`…_4_verificacion.sql`); A y C no cambian

- `vacias` (`:59-68`): `OrderAccessoryLine`, `OrderEnergyBundleComponent`, `ShipmentAccessoryLine` en un arreglo
  **aparte**, del que solo se emiten las que **existen** (`WHERE to_regclass(format('%I', x)) IS NOT NULL`). Así, sin
  `M-73` D no gana tres líneas.
- «0 filas anteriores a la limpieza» (patrón `jobs`, `:71-99`): `AccessoryStockMovement` por `createdAt` y
  `WishlistNotice` por `detectedAt`, **solo si existen**. Con conteo dinámico (`query_to_xml`, como `:63`), porque el
  `jobs` de hoy nombra las tablas en SQL estático y fallaría sin ellas. Lo posterior es real (recepciones del dueño,
  avisos de cartas re-subidas).
- `info` (`:102-108`): `Accessory`, `AccessoryPhoto`, `WishlistItem`, `WishlistMail`, solo si existen (el `info` de hoy
  no tiene la guarda `to_regclass`: añadirla **solo** a las nuevas).
- **A** (`…_1_censo.sql`) es genérico: cuenta toda tabla (`:58-64`) y lista toda FK (`:72-75`). Sin cambio. **C** no
  toca tablas de `M-73`/`M-74`. Sin cambio.

#### 14.13.4 Guion del dueño (§14.8) y LZ-W5

- **Se retira** el paso de LZ-W5 «apaga los dos avisos antes del 4 / enciéndelos después del 9»: con LZ-A8 solo hace
  falta si B lo pide (G-10), y B dice exactamente qué apagar.
- Paso 2 gana: «La lista 2.7 del ensayo te dice cuántas piezas de cada accesorio tenías: después las vuelves a recibir en
  Accesorios (el producto, su precio y su foto se quedan)».
- El aviso informativo de LZ-W5 (un «ya la tenemos» por carta deseada que re-subas) se queda; ahora lo enseña 2.8.

#### 14.13.5 Pruebas (en `pdb-limpieza.e2e-spec.ts`; deben fallar HOY, salvo los controles)

**Fixture** (`limpieza-fixture.ts`, con `M-73` y `M-74`, que hoy ya aplica `migrateSchema`): un accesorio de fundas
activo con foto, precio y costo, con movimientos `initial +20` y `sale −2` ⇒ `stockQty = 18`; un pedido `direct_ship`
con renglón de accesorio vendido **y** renglón `energy_bundle` con su componente (sobre una energía sembrada que recibió
`+10`); su `ShipmentRequest` con `ShipmentAccessoryLine`; un `PaymentRefund` con `orderAccessoryLineId` (comprueba el
orden contra el paso 4); otro pedido con un renglón `reserved` de 1 ⇒ `reservedQty = 1`. Lista de deseos según LZ-W4 (a).
Las 8 energías de la semilla **tal cual**, salvo la que recibió piezas. **Helpers** (`limpieza-db.ts`): `revertM74` y
`revertM73`, hermanos de `revertM72` (`:185-197`). `revertM73` debe **restaurar** los CHECK de `PaymentRefund` que
`M-73` reemplaza (la reversa comentada de `m73:30-52` es el guion), no solo hacer `DROP`.

| # | Pasos | Esperado |
|---|---|---|
| T-AC1 | Con ambas: B `COMMIT` | 0 filas en `OrderAccessoryLine`, `OrderEnergyBundleComponent`, `ShipmentAccessoryLine`, `AccessoryStockMovement`, `WishlistNotice`. `Accessory`: mismas filas, **contenido idéntico** quitando `stockQty`, `reservedQty`, `updatedAt` (hash, como `partial()`, `:111-118`), y todas con `stockQty = reservedQty = 0`. Las 7 energías sin piezas, idénticas **incluido** `updatedAt`. `AccessoryPhoto` (con los `bytea`), `WishlistItem` y `WishlistMail` idénticas. B + C + D ⇒ `TODO OK`. `EMPTIED` (`:54-59`) gana las 5 tablas `borrar`, `PARTIAL` (`:61`) gana `Accessory` y `KEY_KEPT` (`:63`) gana `Accessory`, `AccessoryPhoto`, `WishlistItem`, `WishlistMail` (deben tener filas en el fixture). |
| T-AC2 | Con ambas: ensayo ×2 | Base idéntica (las 9 tablas incluidas) y las tres secuencias iguales (§9.1). La salida trae 2.7 con el accesorio `18 · 1` y 2.8. |
| T-AC3 | **Sin ambas** (`revertM74` + `revertM73`), en dos esquemas gemelos: el B **congelado de `a7232d7a`** en uno y el B nuevo en el otro, ambos `COMMIT` | Mismo código de salida; `snapshot()` (`limpieza-db.ts:213`) igual tabla por tabla, salvo `AuditLog`: el `after` del rastro es igual quitando `puntoPitr`, y `id`/`createdAt` de la fila pueden cambiar. La salida del ensayo nuevo **no** contiene `2.7`, `2.8` ni `G-10`. A, C y D corren igual. Copia congelada: `backend/test/integration/fixtures/pdblimpieza_2_limpieza.a7232d7a.sql`, con una línea de comentario que diga de qué sha sale (`git show a7232d7a:backend/prisma/data-repair/20261006_pdblimpieza_2_limpieza.sql`). Que el checkout de CI traiga ese sha: NO MEDIDO; por eso es copia y no `git show` en la prueba. |
| T-AC3b | Solo `M-73` (`revertM74`) | B `COMMIT` pasa, borra lo de accesorios, ni 2.8 ni G-10. Prueba que las dos banderas son independientes. |
| T-AC4 | Con ambas: B `COMMIT` ×2 | La 2.ª corrida: todo `lz_cambio` en 0, sin rastro nuevo (§9.3). |
| T-AC5 | Con ambas: B `COMMIT` → C → recepción de 5 piezas de un accesorio **por la app** (el servicio de `admin-accessories.service.ts:362`) → B | La 2.ª B se niega con G-7 nombrando `AccessoryStockMovement`; el accesorio sigue con 5. |
| T-AC6 | Con ambas: B `COMMIT` → C → recepción por la app → D | D `TODO OK`: la línea de `AccessoryStockMovement` «anteriores» da 0, y la de «posteriores (reales)» da 1. |
| T-AC7 | Con ambas: otra conexión abre `UPDATE "Accessory" SET "stockQty" = "stockQty" + 1` sobre una energía con 0 piezas y **no** confirma; B `COMMIT` | B aborta por `lock_timeout` (≤ 5 s + margen) y la base queda idéntica. Carrera ⇒ **N = 3**, reportar `k/3` (O-3). |
| T-W10a | Con ambas: `sealed_restock_alerts = 'on'` + 1 suscripción pendiente sin armar; B `COMMIT` | Falla al final con «Falta tu decisión» y `G-10 · … 1 suscripción(es)`; base idéntica. |
| T-W10b | Con ambas: dial `on` y **0** suscripciones (el caso de producción de hoy) | Pasa. Es la prueba de la decisión del dueño. |
| T-W10c | Con ambas: dial `on`, una suscripción **armada** y otra **ya avisada** | Pasa. |
| T-W10d | Con ambas: `wishlist_enabled = 'on'` con deseos | Pasa; 2.8 dice `on` y el número de deseos. |
| T-W10e | **Sin ambas:** dial `on` + 1 suscripción pendiente | Pasa (conducta de `a7232d7a`; `armedAt` no existe). |

LZ-W4 (a) se cumple con T-AC1. LZ-W4 (b) se cumple con T-AC3. LZ-W4 (c) queda sustituida por T-W10a…e.

#### 14.13.6 Mutaciones (en copia del árbol **entero**, O-9; deterministas ⇒ `1/1`, salvo M-LOCK)

| # | Mutación | Debe poner en rojo |
|---|---|---|
| M-A1 | Sin `'9 OrderAccessoryLine'` | T-AC1 (B aborta por la FK de `Order`) |
| M-A2 | Sin `'8 ShipmentAccessoryLine'` | T-AC1 (FK de `ShipmentRequest`) |
| M-A3a | Sin el `UPDATE` de existencias | T-AC1 (la comprobación de LZ-A6) |
| M-A3b | Sin el `UPDATE` **y** sin la comprobación de LZ-A6 | T-AC1 por **medición directa** de la prueba (`stockQty = 0`), no por la guarda de B. Si solo cae por la guarda, la prueba no muerde |
| M-A4 | `Accessory` a `borrar`, con `DELETE` (y su foto en cascada) | T-AC1 (contenido de `Accessory`, `AccessoryPhoto` y las energías) |
| M-A5 | Un borrado de accesorios **fuera** de `\if :lz_m73` | T-AC3 (`relation does not exist`) |
| M-A6 | `UPDATE` sin su `WHERE` | T-AC4 (la 2.ª corrida escribe rastro) **y** T-AC1 (el `updatedAt` de las energías) |
| M-A7 | Clave `accesorios` del rastro sin condición | T-AC3 |
| M-LZW2 | Sin `antes IS NOT NULL` | T-AC3 |
| M-W10a | G-10 como LZ-W3 (solo el dial) | T-W10b |
| M-W10b | Sin G-10 | T-W10a |
| M-W10c | G-10 contando también las armadas | T-W10c |
| M-W10d | G-10 fuera de `\if :lz_m74` | T-W10e (y T-AC3) |
| M-LOCK | Sin el `LOCK` condicional de `Accessory` | T-AC7: B pasa y, al confirmar la otra conexión, el accesorio queda con 1 pieza sin movimiento. Carrera ⇒ **N = 3**, `k/3` |

#### 14.13.7 Pregunta al dueño (no bloquea; tiene valor por defecto)

**Q-LZ-A1 · Accesorios: ¿la limpieza deja sus existencias en 0?** Ejemplo: tienes «Fundas Dragon Shield negras» a
MX$250, con costo de MX$120 y 20 piezas en tu estante.
- **(a) Por defecto:** el producto, su precio de MX$250, su costo de MX$120, su foto y si está activo **se quedan**. Las
  20 piezas pasan a **0**: la tienda lo muestra «agotado» hasta que las vuelvas a recibir en Accesorios. El ensayo te las
  lista (2.7: «Fundas Dragon Shield negras · 20»). Es lo mismo que haces con las cartas.
- **(b)** Las 20 piezas se quedan. Pide otro diseño: habría que decidir qué hacer con el historial de ventas de prueba que
  explica esas 20.

**Cuánto pesa hoy:** casi nada. En producción las tablas de accesorios no existen hasta que se publique #84. Y si la
limpieza de hoy hace `COMMIT`, cualquier corrida posterior se niega (G-7) en cuanto haya una carta re-subida o una
recepción de accesorios. La pregunta cuenta para staging, para copias locales y para una limpieza que se corriera
después de publicar #84 **sin** haber corrido la de hoy. Sin respuesta: **(a)**.

**G-10 no es pregunta:** sale de la decisión del dueño del 2026-10-08 (arriba).

#### 14.13.8 Ficheros que toca backend

`backend/prisma/data-repair/20261006_pdblimpieza_2_limpieza.sql` (B: LZ-A1…A10, LZ-W1, LZ-W2) ·
`backend/prisma/data-repair/20261006_pdblimpieza_4_verificacion.sql` (D: §14.13.3) ·
`backend/test/integration/pdb-limpieza.e2e-spec.ts` · `backend/test/integration/helpers/limpieza-fixture.ts` ·
`backend/test/integration/helpers/limpieza-db.ts` (`revertM73`, `revertM74`, y que `limpiezaSql` pueda leer la copia
congelada) · **nuevo** `backend/test/integration/fixtures/pdblimpieza_2_limpieza.a7232d7a.sql` · `docs/BACKEND_NOTES.md`
(su sección; número reservado por el orquestador, O-24). **No** cambian: A (`…_1_censo.sql`), C (`…_3_folios.sql`),
`schema.prisma` ni ninguna migración. Sin cambio de ruta, cuerpo ni esquema.

# LIMPIEZA DE LA BASE DE PRODUCCIÓN ANTES DE COBRAR EN REAL — `P-DB-LIMPIEZA`

> **Autor:** arquitecto · **Fecha:** 2026-10-06 · **Rama:** `claude/limpieza-db` (worktree `/home/user/tcg-limpieza`)
> **Estado:** DISEÑO. No hay SQL ejecutable aquí: el guion lo escribe **backend** con este diseño, lo revisan
> **QA + techlead + seguridad** (toca dinero y bitácora) y lo corre **el dueño** en Railway. El orquestador no toca
> producción (CLAUDE.md «Cómo se publica»).
> **Esquema contra el que se diseña:** `production` (incluye M-70 y M-71) **+ M-72** del PR #78
> (`/home/user/tcg-bsdx/backend/prisma/schema.prisma`, rama `claude/buylist-skydropx`). Qué cambia sin M-72: §11.
> **Todas las citas `fichero:línea` de código** son sobre el árbol de `/home/user/tcg-bsdx` (PR #78), medidas el
> 2026-10-06. Lo no medido va marcado **NO MEDIDO**.

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

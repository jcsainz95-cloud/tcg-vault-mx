# Anexo de contrato · §BOVEDA-COBRADA-SIN-PIEZAS

Reglas de negocio: `docs/DECISIONES.md` §BOVEDA-COBRADA-SIN-PIEZAS. Formas verificadas en `backend/src/modules` (a3f81be5). Todo es **aditivo y compatible hacia atrás**. Migración: `20261210120000_boveda_cobrada_sin_piezas` (`OrderItem.fulfillmentFailedAt`, `fulfillmentFailedReason`, `replacedInventoryItemId`; revertible).

## Endpoints

| Método y ruta | Rol | Cambio |
|---|---|---|
| `GET /admin/dashboard` | staff | `workQueue.vaultOrdersWithUnassignedItems` (int) y el mismo campo en la raíz. Cuenta pedidos `settled` de bóveda con alguna línea «requiere atención» o sin pieza del comprador (consulta de la invariante, no columna). |
| `GET /admin/orders` | staff | Query nuevos `fulfillmentMode=vault\|direct_ship` y `mismatch=true\|false` (valor inválido ⇒ `400`). Cada fila suma `unassignedItemCount` (int). `mismatch=true` ⇒ solo pedidos con líneas sin asignar; `false` ⇒ el resto. |
| `GET /admin/orders/:id` | staff | En `items[]`: `fulfillmentState` (`assigned\|replaced\|needs_attention\|unassigned`), `fulfillmentFailedAt` (ISO\|null), `fulfillmentFailedReason` (`no_equivalent_copy\|double_charge\|item_missing`\|null), `replacedInventoryItemId` (id\|null), `folio`, `replacedFolio` (folio de la pieza original). |
| `GET /admin/vaults` | staff | Cada cliente suma `unassignedPaidOrders: [{orderId, orderNumber, missingCount}]` (vacío si no hay). Aparece aunque el cliente no tenga piezas. |
| `GET /admin/vault-orphans` | staff | Resultado de la reparación (`reparadas k`, `para decidir m`, `total N`) y lista por pedido/línea. `amountCents` (entero MXN) es `null` para `vault_operator`; sin PII de terceros. |
| `GET /admin/audit-log` | staff | `before`/`after` solo para `super_admin` y solo en acciones de `AUDIT_DETAIL_ACTIONS` (`settings.controller.ts:34`); para el resto, omitidos. |

## Error nuevo

`409 ORDER_SUPERSEDED` en `POST /checkout/session` cuando la orden dejó de estar vigente entre crear el PI y adjuntarlo (R1a). El PI recién creado se cancela y **nunca** se entrega su `clientSecret`; el front recarga el carrito.

## Clasificación §0-Q punto 4 (C-EQ-1)

| Ruta | Param | Clase | Dominio / notas |
|---|---|---|---|
| `GET /admin/orders` | `fulfillmentMode` | **E** | `Object.values(FulfillmentMode)` = `vault`, `direct_ship`. Vacío ⇒ sin filtro. Otro valor ⇒ `400`. |
| `GET /admin/orders` | `mismatch` | **L** | Lista cerrada `['true','false']` (no es enum de Prisma; booleano en texto). Otro valor ⇒ `400`. |

Ninguno devuelve el valor en eco. Con estas filas backend pasa ambos ejes de `PENDIENTE-ARQUITECTO` a `transcrita` en `enum-query-axes.e2e-spec.ts`.

## Reglas de cómputo (para front y pruebas)

- «Requiere atención» cuenta igual en el contador del tablero, en `mismatch=true` y en la lista de `vault-orphans` (mismo criterio, una sola consulta).
- Aviso al dueño: contador del tablero + la notificación interna existente (AG-25). Sin cambio de schema adicional.

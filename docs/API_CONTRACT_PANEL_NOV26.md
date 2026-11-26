# API_CONTRACT_PANEL_NOV26 — cambios aditivos del panel y la bóveda (2026-11-26)
Fuente: `docs/STATUS.md` sección Backend. Sin cambio de `schema.prisma`. Todos los campos son aditivos (clientes viejos los ignoran). Roles y errores siguen las convenciones de `API_CONTRACT.md`.

| Método y ruta | Rol | Cambio |
|---|---|---|
| `GET /admin/orders/:id` | operador, súper-admin | cada `items[]` suma `finish` (acabado), `setKey` (clave impresa del set; null si el set no la tiene) e `imageUrl` (null si no hay). |
| `PATCH /admin/users/:id/name` | solo súper-admin | Cambia el nombre del cliente. Body `{name}`; devuelve el usuario actualizado. Auditoría de la acción; operador ⇒ 403 `FORBIDDEN`. |
| `GET /admin/vaults/:userId/physical-inventory` | operador, súper-admin | suma `unassignedLines[]` (líneas de pedidos cobrados de bóveda sin pieza asignada; ver `docs/DECISIONES.md` §BOVEDA-COBRADA-SIN-PIEZAS) y `counts.needsAttention` (número de esas líneas más las piezas que piden atención). Sin líneas ⇒ `[]` y `0`. |
| `GET /admin/inventory/by-folio/:folio` | operador, súper-admin | Busca una pieza por folio `INV-<n>`; 200 con la pieza, 404 `NOT_FOUND` si no existe, 422 si el folio no tiene la forma `INV-\d+`. |
| `GET /admin/catalog/sync-status` | operador, súper-admin | suma `searchKeys {withoutKey, total}`: sets sin clave impresa de búsqueda / sets totales (§BUSCADOR-CARTAS §3; objetivo ≥ 95 % con clave). |

Buscador público/interno (`GET /buylist/cards`, `GET /catalog/cards`, sellado, graduadas, bounties, supply): misma forma de respuesta; `q` acepta ahora `INV-<n>` (devuelve la carta de esa pieza) y casa también por número y clave impresa (§BUSCADOR-CARTAS). Límites: `q` ≤ 60 caracteres y 6 palabras; con `q` sin `setId`, `page × pageSize ≤ 1000`.

AUTO: sin acción del dueño; `searchKeys` se mide en el job diario `catalog-metadata-sync`; `unassignedLines` se deriva de pedidos y piezas en cada consulta.

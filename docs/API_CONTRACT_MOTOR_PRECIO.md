# API_CONTRACT_MOTOR_PRECIO · F0 «un solo motor de precios» y F0b «captura de costo» (previas a §PISO-COSTO)

Origen: HECHOS 2026-11-28 (últimas 2 filas §PISO-COSTO; literal del dueño ahí) + respuestas de Fable (citas verificadas por el arquitecto 2026-11-28: `master-set.service.ts:1239,1262` usa `getReferencesBatch`+`decideSalePrice` sin `saleDisplayCentsOf`; `buylist.service.ts:8931` `?? 0`). Fases: **F0 → F0b → F1 freno en `shadow`** (ver `API_CONTRACT_PISO_COSTO.md` §8). Módulos `pricing`, `inventory`, `buylist`, `orders`, `wishlist` = dinero ⇒ gates qa + seguridad-lead por fase. AUTO: nada pide acción al dueño; la captura de costo es atajo opcional, el dato dudoso se cuarentena solo (fuera del promedio).

## F0. Un solo motor de precios
**Regla:** todo precio de VENTA mostrado o cobrado sale de `SaleDecisionService.decide` por UNA de dos puertas: `salesFor` (mostrar) / `chargeDecisionsFor` (cobrar), `listing-price.service.ts:516,:548`. Prohibido llamar `decideSalePrice` o `getReferencesBatch` para fijar un precio de oferta fuera de ellas.
| Consumidor | Hoy | Cambio |
|---|---|---|
| Master set / binder (`inventory/master-set.service.ts:1201-1279`, `resolveBuyables`) | `decideSalePrice(...).priceCents` en vivo, SIN `saleDisplayCentsOf` (`money.ts:662`): muestra precio sin IVA ni comisión (`CellDrawer.tsx:249`; hueco en `contract.ts:3953-3969`) | `salesFor`; mismo precio que catálogo/carrito |
| Admin inventario (`inventory.service.ts:2246,:2306`) publicadas | cálculo vivo propio | `salesFor` |
| Wishlist (`wishlist-market.service.ts:70-81`) | vivo con IVA/comisión (correcto pero aparte) | `decide` en modo `previewLive` (misma fórmula, sin fila) |
| Catálogo, sellado, checkout (`catalog.service.ts:845,938`, `sealed-catalog.service.ts:281`, `orders.service.ts:406`) | ya usan la puerta | sin cambio |
| `price-ingest.service.ts:1324` | solo publicable/pendiente | se queda (no fija precio de oferta) |
Contrato de API: los campos de precio del binder (`salePriceCents` y afines) pasan a ser el precio final de tienda (IVA y comisión incluidos); sin campo nuevo. Con fila stale o ausente, el vivo de `salesFor` cubre (ya existente). Backend verifica **antes de codificar** (hoy NO MEDIDO) si `getReferencesBatch` aplica la retención que sí aplica `referenceOf` (`sale-decision.service.ts:430-437`); si no, se corrige por la misma vía.
**Criterios (f = fixture; N = n):**
- **MP-1** Para ≥ 20 cartas (mezcla de acabados/idiomas/ligas) el precio del binder = catálogo = carrito (centavos), 0 discrepancias. Caso f: mercado que da base $100 ⇒ binder muestra el precio final con IVA y comisión (no $100).
- **MP-2** Admin inventario y wishlist = catálogo en las mismas ≥ 20 cartas, 0 discrepancias; con fila stale (cambio de `iva_pct`) también 0.
- **MP-3** Prueba estática: 0 llamadas a `decideSalePrice`/`getReferencesBatch` fuera de `SaleDecisionService`/`ListingPriceService` y `price-ingest` (lista blanca en un test de arquitectura).
- **MP-4** Con `cost_floor_mode=off` los precios en catálogo/carrito no cambian (regresión): 0 diferencias en N≥200 SKU.
- **MP-5** `pending`/sin mercado en binder ⇒ `null` («—»), nunca 0.
Revertir: es solo cambio de lector; revert del commit restaura. Sin migración.

## F0b. Captura de costo
**Costo obligatorio al alta «compra»** (tipo de adquisición `purchase`): alta normal (`inventory.service.ts:1541`; costo `:979-980`), alta desde master set (`CellDrawer.tsx:327-328`, hoy sin campo) y graduadas (`AddGradedModal.tsx:72`, hoy opcional), y `AddItemModal.tsx:193,241` (hoy sin campo). DTO `inventory.dto.ts:113,:221`: `acquisitionCostCents` requerido (entero ≥ 0) cuando el tipo es compra ⇒ 422 `ACQUISITION_COST_REQUIRED` si falta. **0 explícito sigue permitido** (regalo/promo/aportación; ya separado del «vacío»). Aportación mantiene su cálculo (`settings.constants.ts:481`, neto = referencia×pct).
**Buylist sin precio se rechaza** (`buylist.service.ts:8931`: se quita `?? 0`; patrón ya usado en `:8074-8083`): convertir a inventario una línea sin `agreedPrice/approvedPrice/quotedPrice` ⇒ 422 `BUYLIST_COST_MISSING`, la línea no se convierte y queda en su estado (no «pendiente nuevo»: el aviso ya existe en cola buylist). Idem `supply-purchase.service.ts:137,176-181`: guarda existente se mantiene.
**Costo desconocido (P2 resuelta):** pieza con costo NULL/0 sin marca «regalo» = «costo desconocido»: **fuera del promedio** `C` (def. §1 de PISO_COSTO) y contada en `zeroCostPieces`. Se distingue regalo de hueco con `acquisitionKind`/campo existente de tipo; **backend confirma el nombre real del campo (NO MEDIDO aquí)**; sin campo, 0 explícito = regalo solo en altas nuevas (flag `costExplicit` aditivo, default false en históricos ⇒ histórico en 0 = desconocido).
**Lista «Piezas sin costo» (panel)** — Inventario → pestaña nueva, atajo opcional:
- GET `/admin/inventory/missing-cost?page` (`super_admin`; ver nota de rol abajo) ⇒ `{items:[{itemId, card:{id,name,setName,imageUrl}, finish, language, condition, acquiredAt, source, currentCostCents|null}], total}`. Incluye piezas `ownerType=platform`, `status ∈ {in_stock, listed}`, costo desconocido. Orden: antigüedad.
- PATCH `/admin/inventory/:itemId/cost` · `{costCents, ivaCents?, explicitZero?, idempotencyKey}` ⇒ 200 `{itemId, costCents, netCostCents, previous}`; `costCents` entero ≥ 0; mismo cálculo de neto (`acquisitionCostIvaCents`) que el alta; 404 si no es `platform`; misma `idempotencyKey` ⇒ 1 efecto. `AuditLog` `inventory.cost_set` con antes/después/actor. Encola `cost_change` del SKU (§3 PISO_COSTO). Rol: `super_admin` (mismo que el freno; el dueño es la única cuenta); admin de tienda sin permiso ⇒ 403.
- Sin trabajo manual obligatorio: sin captura, la pieza sigue fuera del promedio y el freno no la evalúa por costo (SKU sin ninguna con costo ⇒ no se evalúa). Insignia con conteo en el menú.
**Criterios:**
- **CB-1** Alta compra sin costo en las 4 entradas (normal, master set, graduada, modal admin) ⇒ 422; con 0 explícito ⇒ 201 y queda como regalo (fuera de «Piezas sin costo»).
- **CB-2** Buylist sin precio al convertir ⇒ 422 `BUYLIST_COST_MISSING`, 0 piezas creadas con costo 0 (f, N≥1 por ruta de conversión: `:8931` y las demás que lo repitan).
- **CB-3** Pieza histórica sin costo/0 aparece en la lista; tras PATCH sale de la lista, entra al promedio y `cost_change` queda encolado (f).
- **CB-4** PATCH idempotente (misma key ⇒ 1 `AuditLog`); no `super_admin` ⇒ 403; pieza de cliente ⇒ 404.
- **CB-5** `zeroCostPieces` del panel = conteo de la lista por SKU (0 discrepancias, N≥10 SKU).
- **CB-6** Nada cambia de precios públicos ni de ventas (regresión MP-4).
Migración: aditiva (flag `costExplicit` si hace falta; sin backfill de costos). Revertir: revert de DTO/endpoint; datos capturados se conservan.

## Medición previa (AUTO, sin dueño)
Reporte read-only al desplegar F0b: cuántas piezas `platform` en existencia están en costo desconocido (hoy **NO MEDIDO**); lo calcula el endpoint `missing-cost.total`.

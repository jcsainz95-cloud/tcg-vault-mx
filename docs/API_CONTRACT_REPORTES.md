# API_CONTRACT_REPORTES.md — §REPORTES-CEO (rediseño de los reportes del back-office)
> Anexo del contrato (patrón `API_CONTRACT_BUYLIST_FLUJO.md`). Reglas y criterios CR-n: `PROJECT.md` §3 «§REPORTES-CEO». Decisiones: `docs/DECISIONES.md` §REPORTES-CEO. Palabras del dueño: `HECHOS.md` (2026-11-22/23). Módulos de dinero ⇒ gates qa + seguridad-lead. Estado: **DISEÑO, nada construido**.

## 1. Medido en el backend (2026-11-23, árbol a56ad901)
| Pregunta | Resultado | Evidencia |
|---|---|---|
| ¿Costo de lo vendido por línea? | **SÍ**: se suma por pieza vendida (`acquisitionCostCents − acquisitionCostIvaCents`) y por renglón de accesorio | `pnl-core.ts:391-394`, `accessoryCogsCents` `:208` |
| ¿Tipo de pieza? | **SÍ**: `InventoryItem.productType` = `sealed`/`raw`/`graded`; accesorios en `OrderAccessoryLine` (`kind` accesorio/paquete de energía) | `schema.prisma:44-48,1193,3205` |
| ¿Ingreso por línea? | **NO hoy**: el ingreso es UNA cifra por pedido (`netRevenueCents(o)` sobre `Order.subtotalCents`). Separable: `OrderItem.unitPriceCents` (ya con descuento) y `OrderAccessoryLine.unitPriceCents`; la base sin IVA por línea exige reparto con residuo (§3) | `pnl-core.ts:382`, `schema.prisma:1780,1799,3213` |
| ¿Comprar inventario es gasto? | **NO, y el P&L ya cumple la regla**: lo comprado entra al costo solo al venderse la pieza (costo congelado en la pieza). El pago SPEI al vendedor no es renglón del P&L; solo la tarifa retenida (+) y la guía de entrada (−) | `pnl-core.ts:391-393,443-458` |
| ¿Reparto de envío y comisión de pago en pedidos mixtos? | **NO**: comisión por pedido (`stripeCostOf(o)`) y envío por `ShipmentRequest`, sin reparto a líneas | `pnl-core.ts:383,407-418` |
| ¿Detalle por pedido de una celda? | **NO**: `pnlBuckets` suma sin conservar ids | `pnl-core.ts:307-468` |
| ¿Comparación con periodo anterior? | P&L M7 **NO**; analítica de ventas **SÍ** (`previousPeriod`, `previousTotals`, `comparison`) | `sales-analytics.dto.ts:48-52` |
| ¿Periodos en hora de México? | **NO en M7/dashboard**: `range()` toma instantes crudos y `resolvePeriod` usa mes UTC. **SÍ en analítica de ventas** (`America/Mexico_City`, semiabierto `[mxDayStart(from), mxDayStart(to+1))`) | `admin.service.ts:481-493,2103-2113`; `sales-period.ts:4-5,89`; `spend-alerts/mx-day.ts:12` |
| ¿Descuentos? | Por unidad `unitDiscountCents` (pieza y accesorio) y `Order.discountCents`; el reparto del descuento de pedido: **NO MEDIDO** | `schema.prisma:1724,1799,3215` |
| ¿Contracargos y merma en el P&L? | **NO**: `chargeback` queda fuera (D-PNL-1); la merma vive aparte en `GET /admin/finance/shrinkage`. Fecha persistida del contracargo: **NO MEDIDO** | `pnl-core.ts:357-359`; `admin.controller.ts:538` |
| ¿Gastos fijos? | **NO**: no hay modelo; EBITDA = margen bruto | `pnl-core.ts:130,181`; grep de `schema.prisma` sin coincidencias |
| ¿Reembolso por línea? | **NO MEDIDO** (`PaymentRefund` tiene `merchandiseCents` y enlace a renglón de accesorio; falta confirmar el de pieza) | `pnl-core.ts:247-282`, `schema.prisma:3233` |
| Roles hoy | `/admin/finance/*` y `/admin/reports/*` = solo `super_admin`; `/admin/dashboard` = staff, con dinero tapado al operador | `admin.controller.ts:529-530,589-590,679-684`, `admin.service.ts:2123` |

## 2. Convenciones de los reportes
- **Periodo único**: `preset` (`today|7d|30d|month|last-month|quarter|year|custom`) o `from`/`to` = `YYYY-MM-DD` (días civiles `America/Mexico_City`, ambos incluidos; internamente semiabierto). Defecto: `month` (mes en curso en México). Máx. 366 días (`400 VALIDATION_ERROR`). Se reutiliza `sales-period.ts` (se mueve a `common/report-period.ts`; el contrato de `/admin/reports/sales` no cambia).
- **Comparación**: toda respuesta de cifras trae `period`, `previousPeriod` (el que ya calcula `sales-period.ts`: misma duración, inmediatamente antes) y, por cifra, `{ cents, previousCents, deltaCents, deltaBps }`. `deltaBps` (puntos base enteros) = `null` si el anterior es 0 («—», nunca 0 %). Los porcentajes se calculan en servidor, enteros (`marginBps`, 1 pt = 100).
- **Aditivo en rutas viejas (F1)**: `/admin/finance/{pnl,iva,export.csv}`, `/admin/reports/{export.csv,launch-metrics}` y `/admin/dashboard` aceptan `from`/`to` también como `YYYY-MM-DD` (⇒ semiabierto de México); con ISO siguen como hoy. Sin `from/to`, el dashboard usa el mes de México (hoy UTC: las cifras del borde del mes cambian a propósito; se declara en la PR).
- **Roles**: todo lo de dinero = `admin` (`super_admin`). `vault_operator` solo ve «Operación» e «Inventario» en unidades (sin costo, ganancia ni valor), como hoy en el dashboard (máscara por rol del servidor, ⛔ nunca del front). Operador sobre ruta admin ⇒ 403 con `user.admin_action_denied`.
- **Sin jobs** (regla AUTO): todo se calcula al abrir (lectura). Sin proveedor externo ⇒ nada que reintentar. Dato dudoso ⇒ contador visible en la misma cifra (`costMissingCount`, `stripeFeeEstimatedOrders`), nunca lista de pendientes. Líneas y sets nuevos: la línea sale de `productType`/`kind`; ninguna tabla a mano.

## 3. F2 — P&L por línea de negocio (todo `GET`, `admin`)
**Línea de una partida**: pieza ⇒ `productType`; renglón de accesorio o paquete de energía ⇒ `accessory`. **Negocio**: `own` (inventario propio) hoy; `marketplace` reservado.
**Reparto de pedidos mixtos** (determinista, suma exacta): comisión de pago, resultado del envío y descuento de pedido se reparten entre las líneas del pedido en proporción a su cobrado (`unitPriceCents × cantidad`), con **mayor residuo** y desempate por `id` de partida; Σ líneas = monto del pedido, al centavo. Base sin IVA por línea = mismo reparto sobre `netRevenueCents(pedido)`.
**Renglones** (centavos; cada línea y `total`): `grossSalesCents` → `discountsCents` → `refundsCents` → `netSalesCents` → `cogsCents` → `grossProfitCents` + `marginBps` → costos de vender `{paymentFeeCents, shippingResultCents, chargebacksCents, shrinkageCents}` → `contributionCents`. Solo `total`: `fixedCostsCents` → `resultCents` (F3; en F2 `fixedCostsCents = null` y el resultado se rotula «antes de gastos fijos»). `shippingResultCents` = envío cobrado neto − costo de guía − ajustes − seguro (+ tarifa retenida − guía de entrada del buylist, que va al `total`, no a una línea de venta). **Invariante** (candado de paridad): `total.contributionCents == profitCents` del P&L plano de hoy, para el mismo periodo, cuando contracargos y merma = 0 (se prueba contra `pnlReport`). Contracargos: por defecto solo informativos (`chargebacksInfo {orders, cents}`, fuera de la suma como hoy) hasta medir su fecha; merma: valor de `finance/shrinkage` por línea de la pieza.
**Informativos (`memo`)**: `iva {collectedCents, refundedCents, netCents}` (misma fuente que `/admin/finance/iva`), `inventoryPurchasesCents` (compras del periodo, fuera de la suma), `marketplace {available:false, gmvCents:null, commissionCents:null}`.

| Ruta | Rol | Respuesta |
|---|---|---|
| `GET /admin/reports/finance/pnl?preset|from&to` | admin | `PnlReport = { period, previousPeriod, own: { sealed, raw, graded, accessory, total: PnlColumn }, marketplace: { available:false }, total: PnlColumn, memo, previous: {own.total, total}, comparison: {total: Record<renglón,Delta>} , costMissingCount, stripeFeeEstimatedOrders }` |
| `GET /admin/reports/finance/pnl/series?…&groupBy=day|week&line=sealed|raw|graded|accessory|all` | admin | `{ buckets: [{ from, to, column: PnlColumn }], total }` — Σ cubos = total (reutiliza `pnlBuckets` con `keyOf` en día MX) |
| `GET /admin/reports/finance/pnl/cell?…&cell=<renglón>&line=…&page&pageSize` | admin | `{ data: [{ orderId, folio, at, line, cents }], page, pageSize, total, sumCents }` — `sumCents` = la celda |
| `GET /admin/reports/finance/pnl/orders/:orderId` | admin | partidas con precio, costo, comisión y envío repartidos: `{ orderId, items: [{ kind:'item'|'accessory', ref, label, line, grossCents, discountCents, cogsCents, paymentFeeCents, shippingResultCents }], totals }` (Σ = lo que esa orden suma a cada celda) |

`PnlColumn = { grossSalesCents, discountsCents, refundsCents, netSalesCents, cogsCents, grossProfitCents, marginBps|null, sellingCosts:{paymentFeeCents, shippingResultCents, chargebacksCents, shrinkageCents}, contributionCents, fixedCostsCents?, resultCents? }`.
**Schema F2**: sin cambios (puede añadir un índice sobre `Order.settledAt` si la medición lo pide: NO MEDIDO). Errores: `400 VALIDATION_ERROR` (periodo, `cell`, `line` fuera de lista), `404 NOT_FOUND`.

## 4. F3 — Gastos fijos (`admin`; auditoría en `AuditLog`)
**Esquema (descrito, no editado)**: `FixedCostConcept { id, name (único sin distinguir mayúsculas), createdAt, createdById }` y `FixedCostAmount { id, conceptId, effectiveMonth (date, primer día del mes MX), monthlyCents (Int ≥ 0), createdAt, createdById, @@unique([conceptId, effectiveMonth]) }`. **Solo se insertan filas** (historia inmutable): cambiar un monto = nueva fila con `effectiveMonth` ≥ la última del concepto (no antes) y ≥ el mes en curso, salvo la PRIMERA fila de un concepto (alta), que puede ser de un mes pasado. Baja = `monthlyCents 0` desde un mes. Monto de un concepto en el mes M = el de su última fila con `effectiveMonth ≤ M` (0 si no hay).
**Prorrateo exacto** (periodos menores a un mes y cortes de mes): el día d (1..N) de un mes de N días cuesta `floor(m·d/N) − floor(m·(d−1)/N)` centavos ⇒ un mes completo suma exactamente `m` y cualquier partición de periodos suma lo mismo. Meses y días en hora de México.
**Lista precargada, importes vacíos** (dueño 2026-11-23: «Tienes una lista de todo lo que usa la plataforma agarralo de ahí»): la migración de F3 inserta, idempotente por nombre, conceptos SIN fila de monto (estado «por capturar»), medidos por grep en `.env.example`, `ARCHITECTURE.md` y `.github/workflows`: Vercel (página), Railway (servidor, Postgres, Redis), Cloudflare R2 (archivos y fotos, `S3_*`), Resend (correos), PokemonPriceTracker y PokeTrace (precios), Sentry (mencionado en docs; sin variable en `.env.example` ⇒ **uso NO MEDIDO**, el dueño lo confirma o lo borra), y los que dijo él: Dominio, Google Workspace, Contabilidad, Claude. **No se precargan** Stripe ni Skydropx (variables por venta/guía, ya contadas) ni los gratuitos (pokemontcg.io, Banxico, GA4/Search Console, inicio de sesión con Google, GitHub en repo público). El dueño captura el importe, borra (archiva) lo que no aplique y agrega más. Modelo: `FixedCostConcept` suma `archivedAt` (borrar = archivar; la historia y los P&L pasados no cambian) y `presetKey` (nulo si lo creó él). **Un concepto sin monto cuenta 0 y el P&L lo dice a la vista:** `fixedCosts { missingCount, configured }` y el rótulo «faltan N gastos fijos por capturar» junto al resultado (N=0 ⇒ sin rótulo); mientras `missingCount > 0` el resultado se rotula «parcial». Los montos se capturan en pesos (centavos enteros); capturar en dólares con conversión es la pregunta Q6 de §8 (default: pesos). Skydropx no es concepto fijo.
| Ruta | Rol | Request → Response |
|---|---|---|
| `GET /admin/fixed-costs` | admin | `{ data: [{ id, name, currentMonthlyCents, history: [{ effectiveMonth, monthlyCents, createdAt, createdById }] }], monthTotalCents }` |
| `POST /admin/fixed-costs` | admin | `{ name, monthlyCents, effectiveMonth? 'YYYY-MM' }` → 201 concepto. Mismo nombre ⇒ 409 `FIXED_COST_NAME_TAKEN` |
| `POST /admin/fixed-costs/:id/amounts` | admin | `{ monthlyCents, effectiveMonth 'YYYY-MM' }` → 201. Mes antes de la última fila o del mes en curso ⇒ 422 `FIXED_COST_MONTH_LOCKED`; mismo mes y mismo monto ⇒ 200 idempotente; mismo mes y otro monto ⇒ 409 `FIXED_COST_MONTH_TAKEN`; monto no entero o < 0 ⇒ 422 `FIXED_COST_AMOUNT_INVALID` |
| `GET /admin/reports/finance/fixed-costs?…` | admin | desglose por concepto del periodo (prorrateado) que alimenta `total.fixedCostsCents` |
`DELETE /admin/fixed-costs/:id` · admin ⇒ archiva (idempotente; `FixedCostConcept.archivedAt`); un archivado deja de contar desde el mes en curso y conserva su historia. `GET` lista también `missingCount` y `archived` (con `?includeArchived=1`).
Concurrencia: transacción `Serializable` con reintento y la única `(conceptId, effectiveMonth)`. Auditoría: `fixed_cost.created`, `fixed_cost.amount_set` y `fixed_cost.archived` con actor, antes y después.

## 5. F4 — Cifras nuevas (`admin`; sin schema; costo = `acquisitionCostCents` neto)
- `GET /admin/reports/inventory/committed-money` — dinero comprometido: ofertas de buylist aceptadas y aún no pagadas (neto SPEI), reembolsos SPEI pendientes y pagos a proveedores por vencer: `{ buylistCents, refundsCents, suppliersCents, totalCents, items:[{kind,ref,cents,dueAt}] }`. Estados exactos: **NO MEDIDO** (backend los mide al arrancar F4). «Caja disponible» y «metas»: **fuera de alcance, pendientes del dueño**.
- `GET /admin/reports/inventory/aging` — inventario en venta por antigüedad (0-30/31-60/61-90/91-180/>180 días desde su alta) por línea, a costo neto y a precio de lista, con `daysOfInventory = valor a costo / (costo de lo vendido de 90 días / 90)` (sin snapshot nuevo). Operador: solo unidades.
- `GET /admin/reports/buylist/profit` — por solicitud pagada cuyas piezas ya se vendieron (`InventoryItem.sourceSellRequestItemId` → `OrderItem`): ingreso neto − costo − guía + tarifa retenida; lo no vendido va aparte como «potencial a precio de lista» (rotulado, fuera de la suma).
- `GET /admin/reports/sales/repeat` — recompra: de los compradores del periodo (cuenta o correo de invitado), cuántos tenían un pedido liquidado anterior (`{buyers, repeatBuyers, repeatBps}` con su N; ventana 90 d).
Todas con `period`/`previousPeriod`/`comparison` de §2.

## 6. F1 — Reordenar (sin cifras nuevas)
Sin endpoints nuevos de cifras; solo el huso de §2. Menú y destino de cada cifra (una sola casa):
| Pantalla | Casa de la cifra | Sale de |
|---|---|---|
| Inicio (antes «Resumen») | solo colas y avisos del día; sin dinero del periodo | tarjetas de ventas/ganancia duplicadas |
| Pedidos (antes «Ventas», m3) | lista y reembolsos | totales del periodo (pasan a Reportes › Ventas) |
| Reportes › Junta de dirección | las 6 cifras-titular, cada una enlaza a su área | — |
| Finanzas | P&L (hoy plano; F2 por línea), IVA, merma | ganancia del dashboard y de m9 |
| Ventas | `/admin/reports/sales` | ventas de dashboard y m7 |
| Compras a vendedores | resumen de buylist (pagado, tarifa retenida, guías) | m9 › Actividad |
| Inventario | valor de inventario y custodia, «Qué reponer» | valor duplicado en dashboard y m7 |
| Operación | colas, envíos, costo de guías | — |
| Marketing | panel `/admin/marketing` existente | — |
Exportaciones CSV: una sola por área (m7 y m9 › Actividad dejan de duplicarlas); `GET /admin/finance/export.csv` y `/admin/reports/export.csv` se conservan.

## 7. Marketplace (reservado, sin modelo ni rutas)
Solo conceptos: `gmvCents` (informativo, fuera de la suma) y `commissionCents` (= ingreso del marketplace); columna `marketplace` con `available:false`. `shippingResultCents` por defecto como renglón propio fuera del ingreso, igual en ambas líneas (**pendiente del dueño**, Q1 de §8). Diseño del marketplace de proveedores: `API_CONTRACT_MARKETPLACE.md` (no construido).

## 9. Criterios de aceptación (CR-n; reglas R1-R5 en `PROJECT.md` §3)
**F1** (sin cifras nuevas): CR-1 menú «Inicio», «Pedidos» (m3) y grupo «Reportes» con Junta de dirección y 6 áreas; CR-2 ninguna cifra en dos pantallas ni CSV duplicado; CR-3 periodo en hora de México (23:59 del último día cae en su mes); CR-4 el operador no ve dinero.
**F2:** CR-5 Σ líneas = Total = ganancia del P&L de hoy, al centavo; CR-6 envío y comisión de pedidos mixtos con suma exacta; CR-7 Δ vs periodo anterior (anterior 0 ⇒ «—»); CR-8 cada celda baja a día/semana y a pedido y suma igual.
**F3:** CR-9 solo súper-admin, auditado; CR-10 cambiar un monto rige desde el mes elegido y no altera periodos pasados; CR-11 prorrateo por día exacto (mes completo = monto); CR-12 lista precargada con los servicios de la plataforma (importe «por capturar», se puede borrar/agregar); sin importe cuenta 0 y el P&L dice «faltan N gastos fijos por capturar».
**F4:** CR-13 dinero comprometido; CR-14 inventario envejecido y días de inventario; CR-15 ganancia de lo comprado a vendedores; CR-16 recompra con su N. Fuera de alcance: caja disponible, metas, modelo del marketplace.

## 8. Preguntas abiertas (default = lo que se construye si no contesta)
Q1 spread de envíos del marketplace: renglón propio «Resultado del envío», fuera del ingreso. Q2 importes de gastos fijos (los captura él en la pantalla). Q3 contracargos: informativos hasta medir fecha. Q4 operador ve «Operación»/«Inventario» en unidades. Q5 «caja disponible» y «metas»: fuera de alcance. Q6 ¿capturar gastos fijos en dólares con conversión? Default: solo pesos.

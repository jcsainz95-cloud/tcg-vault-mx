# D9 — Comisión de plataforma DENTRO del precio de la carta

Decisión: HECHOS.md:201 (2026-10-30) «La comision de plataforma vamos a metela en el precio»; HECHOS.md:272 (2026-11-09) **«A en todo»** (P1–P8). Estado: **DECIDIDO**. Se construye tras el veredicto de qa del lote 093b17b7 y la publicación de §DYN. Cadena: arquitecto (este documento) → ux-ui → backend + frontend → qa + seguridad-lead (zona de dinero).

## 1. Cómo es hoy (medido con grep/lectura, 2026-11-09)
- La «comisión de plataforma» es `processingFeeCents` = gross-up de Stripe sobre `G = S + E`: `total = ceil((G + fijo×(1+IVA)) / (1 − pct×(1+IVA)))` (`backend/src/common/money.ts:1019-1035`, cuerpo `:789-814`). Dials `stripe_fee_pct` 0.036 y `stripe_fee_fixed_cents` 300; IVA de `iva_pct` (`settings.constants.ts:449-451`). Efectivo: 4.176 % + MX$3.48.
- **P&L (medido, antes NO MEDIDO):** `pnl-core.ts:353` el ingreso es `netRevenueCents(o)` sobre `subtotalCents` (sin la comisión); `:354` y `:388` suman `processingFeeCents` a `stripeFeesCents`; `:433` la ganancia resta `stripeFeesCents`. O sea: hoy la comisión que paga el cliente **no entra como ingreso y sí se resta como costo** ⇒ la ganancia histórica sale subestimada ≈ la comisión cobrada. Hallazgo previo a D9; por P3-A los meses viejos NO se reescriben. No hay captura del costo real de Stripe: `stripe.service.ts:260,313` expande `latest_charge` pero no `balance_transaction` (grep `balance_transaction` = 0 usos).
- **Métodos de pago (medido, antes NO MEDIDO):** `stripe.service.ts:193` usa `automatic_payment_methods: { enabled: true }` y no hay lista blanca en código ⇒ los métodos activos los decide el Dashboard de Stripe: **NO MEDIBLE desde el repo** (devops/dueño en el Dashboard). P8-A cubre cualquiera: un solo precio con tarifa de tarjeta; la diferencia de otro método la absorbe la tienda.
- **Feeds de Google/Meta (medido, antes NO MEDIDO):** `grep` de `merchant|g:price|product_feed` en `backend/src` y `frontend/src/app` = solo «merchant» de patrocinadores del Card Show y `sitemap.ts`; **no hay feed de producto en este repo**. El único precio hacia afuera es JSON-LD/og (`frontend/src/lib/seo.ts:60`, `Offer.price`) = precio exhibido. Cualquier feed del repo de marketing queda fuera: se avisa como sugerencia a marketing (precio = `displayPriceCents` nuevo).
- Rótulos de la comisión: `es.json`/`en.json` líneas 490-491, 664-665, 672-674, 709, 5022, 7113, 7195 y reembolsos 2094, 2133, 2681, 2716-2721, 3006 (lista cerrada en §5).
- Envío gratis: `shipping-rule.ts:108` compara `S >= freeFromCents`; se aplica a pedidos con sellado o accesorios (`es.json:5022`). Retiro de bóveda: gross-up propio (`money.ts:846-856`); `ShipmentRequest` tiene su **propio** `stripePaymentIntentId` (`schema.prisma:1831`) ⇒ cada retiro es un cobro aparte con su propio fijo de Stripe. Buylist: SPEI sin gross-up, no cambia.

## 2. Regla vigente (con las respuestas)
1. **P1-A porcentaje plano.** Para cada carta/sellado automático con precio base `M` (el actual con IVA dentro), el precio exhibido es `P = ceilPeso( M / (1 − stripe_fee_pct × (1 + iva_pct)) )`. Con los dials de hoy el divisor es `1 − 0.04176 = 0.95824` (≈ +4.4 %). El fijo (MX$3.48 por cobro) **no** entra al precio: lo absorbe la tienda.
2. **P2-A redondeo al peso hacia arriba**, una vez POR UNIDAD (`ceilPeso(x) = ceil(x/100)×100` en centavos; regla R1): `ΣP` es suma exacta de enteros. `P` lo fija el servidor una vez al día junto con `ListingPrice` (§DYN).
3. **Se cobra el precio que el cliente vio:** `total = ΣP + envío`, sin gross-up encima ni recálculo por pedido. Total congelado en la sesión (`frozen-breakdown.ts`).
4. **P3-A** la venta cuenta completa en el P&L (`incomeCents` = base gravable de `ΣP`, IVA dentro) y el costo real de Stripe aparece solo como gasto.
5. **P4-A** ticket, correo y desglose del cliente: cartas + envío = total; **ninguna mención de comisión** (ni frase al pie).
6. **P5-A** compra a bóveda = igual que domicilio (la carta cuesta `P`); la valuación de bóveda sigue en valor de mercado `M`. Envío del retiro: se muestra y cobra el monto del dial (ej. 10000), sin gross-up; la tienda absorbe la comisión de ese cobro. Con código de envío gratis: MX$0.00 sin cobro (HECHOS:188).
7. **P6-A** envío gratis desde el dial `free_from` (MX$4,000 = 400000) comparado con el subtotal exhibido `S = ΣP` (con comisión; las partidas de precio final del dueño valen lo que escribió).
8. **P7** el % del código se aplica sobre el precio exhibido (redondeo vigente de `discount-pricing.ts`, no cambia). Sin recálculo de comisión.
9. **P8-A** un solo precio con la tarifa de tarjeta para todos los métodos. Accesorios y sellado con **precio final del dueño** no se tocan (no se les suma nada).
10. Reembolso de carta = `P` pagado (sin parte de comisión en filas nuevas); Stripe no devuelve su comisión (costo nuestro, igual que hoy). Pedidos viejos se reembolsan como antes (dos convenciones coexisten).

## 3. Marca de convención — forma exacta en `schema.prisma` (P3 = A)
Patrón IVA-3 (`PriceConvention`, `schema.prisma:246`): `NOT NULL`, **sin `@default`** (un camino de escritura que la olvide revienta, no archiva en silencio). Migración aditiva `m100` (o la siguiente libre; `m99` es de MKT-V2): crea el enum y las columnas nullable, **rellena** TODA fila existente con `FEE_ON_TOP`, y luego `SET NOT NULL` sin default. Reversa: `DROP COLUMN` ×4 y `DROP TYPE` (nada más depende).
```
enum FeeConvention {
  FEE_ON_TOP     // total = subtotal + envío + processingFeeCents (toda fila anterior al deploy)
  FEE_INCLUDED   // total = subtotal + envío; subtotal ya trae la comisión dentro de P; processingFeeCents = 0
}
model Order {            // y model ShipmentRequest, mismas dos columnas
  feeConvention  FeeConvention        // ⛔ NOT NULL ⛔ SIN @default (como priceConvention)
  stripeFeeCents Int?                 // costo REAL de Stripe (balance_transaction.fee); NULL = aún no leído
}
```
- Todo camino que crea `Order`/`ShipmentRequest` escribe `feeConvention: FEE_INCLUDED` (filas nuevas) y `processingFeeCents: 0`. `FEE_ON_TOP` solo existe en filas migradas.
- `stripeFeeCents`: al liquidar, `stripe.service.ts` pasa a `expand: ['latest_charge.balance_transaction']` (líneas 260 y 313) y guarda `balance_transaction.fee`. Si Stripe no lo devuelve ⇒ `NULL` y el P&L usa el estimado del dial `estimateStripeFeeCents(total) = round(round(total×pct) + fijo) × (1+iva)` con la marca «estimado»; nunca 0 silencioso.
- **P&L** (`pnl-core.ts:354,388`): `stripeFeesCents += feeConvention === 'FEE_INCLUDED' ? (stripeFeeCents ?? estimate(totalCents)) : processingFeeCents`. `:353` no cambia (el subtotal ya incluye la comisión). `refundedFeesCents` de filas `FEE_INCLUDED` = 0.
- Reembolso (`itemFeeShareCents`, `money.ts:1072-1075`): para `FEE_INCLUDED` la parte de comisión es 0 y el reembolso de una carta es su `P` prorrateado sin tocar.
- API: `OrderDTO`/`GET /orders/:orderId` exponen `feeConvention`; el cliente nunca muestra `processingFeeCents` (siempre 0 en filas nuevas) ni `stripeFeeCents` (interno, solo P&L).

## 4. Contrato por endpoint
- **Precio:** `displayPriceCents` (catálogo, ficha, carrito, JSON-LD/og, correos) = `P`. El cliente nunca calcula (candado `frontend-never-multiplies`).
- **`POST /checkout/quote`, `/checkout/guest/quote`, `/checkout/session`, `/checkout/guest/session`, `GET /orders/:orderId`:** filas nuevas `totalCents = subtotalCents + shippingFeeCents`; el desglose del cliente no trae renglón de comisión; pedidos previos conservan su desglose.
- **`GET /checkout/shipping-rule`:** `freeFromCents` vs `subtotalCents` exhibido (con comisión). **`POST /shipments/quote`, `POST /shipments`:** monto mostrado = cobrado = dial (sin gross-up).
- **Reembolsos:** §2.10. **Pruebas D9-1…5** (mutar ⇒ rojo): D9-1 `total = ΣP + envío` al centavo; D9-2 quote y session dan igual total; D9-3 pedido previo se reembolsa como antes; D9-4 ninguna cadena de UI/correo contiene «comisión de plataforma»/«platform fee»; D9-5 JSON-LD = `P`.

## 5. Textos que se quitan o cambian (es/en; frontend y ux-ui)
Se borran las claves y su uso; paridad es/en y pruebas de i18n verdes:
- `es.json`/`en.json:490-491` `platformFee`, `platformFeeHint` (renglón del desglose `AmountBreakdown.tsx`): se elimina el renglón para filas `FEE_INCLUDED`; para pedidos viejos (`FEE_ON_TOP`) se conserva el texto histórico (el desglose de un pedido viejo sigue mostrando su comisión).
- `:664-665` `feeHint.cardsOnly`/`sealed`: quedan «+ envío {shipping}, gratis desde {freeFrom}» / «Envío {shipping}, gratis desde {freeFrom}» (EN: «+ shipping {shipping}, free from {freeFrom}» / «Shipping {shipping}, free from {freeFrom}»).
- `:672-674` `bar.includesShipping`/`includesShippingFree`/`includesFee`: «Incluye envío {shipping}» / «Incluye envío gratis»; `includesFee` se elimina (EN: «Includes shipping {shipping}» / «Includes free shipping»).
- `:709` `discount.barVault`: «Descuento −{amount}» (EN: «Discount −{amount}»); se elimina `{fee}`.
- `:5022` `directShipFreeFromCents`: «se compara con el subtotal que ve el cliente, antes del envío» (sin «y de la comisión»).
- `:7113` `priceHelp` y `:7195` `bundlePriceHelp` (admin accesorios/energías): el precio del dueño «es lo que ve y paga el cliente»; se quita «La comisión de plataforma se suma aparte/va aparte» (el precio final del dueño no lleva nada encima).
- Reembolsos (`:2094, 2133, 2681, 2716-2721, 3006`): para filas nuevas «la carta, sin envío» / «se devuelve todo lo cobrado —cartas y envío—»; se conservan las variantes con «su parte de la comisión» solo para pedidos `FEE_ON_TOP` (el texto depende de la marca).
- P&L `:5601` fórmula: «comisiones Stripe» se queda; «comisión de plataforma devuelta» (`:5612` `refundedFees`) se conserva para meses viejos. Nota nueva en Finanzas: «Desde el {fecha} la venta incluye la comisión y Stripe aparece solo como gasto; los meses anteriores no se reescriben.» `{fecha}` se deriva sola, sin captura manual: `MIN(createdAt)` de los `Order` con `feeConvention = FEE_INCLUDED` (en horario de la tienda); si aún no hay ninguno, la nota no se muestra.
- `:5663,5667,5748` (analítica de ventas): quitar «comisión» de «con IVA, comisión y envío» ⇒ «con IVA y envío».
- Correos transaccionales y ticket (`backend/src/**/*.mail*`, plantillas): grep de «comisión»/«processing fee» ⇒ 0 en pedidos nuevos (D9-4).

## 6. Criterios de aceptación (centavos; dials de hoy: pct 0.036, fijo 300, IVA 16 %, envío ejemplo 10000, gratis desde 400000)
| # | Caso | Entrada | Resultado esperado |
|---|---|---|---|
| C1 | Carta | `M = 10000` | `P = ceilPeso(10000/0.95824) = ceilPeso(10436) = 10500` (`displayPriceCents` en catálogo, ficha, carrito, JSON-LD) |
| C2 | Pedido de 1 carta a domicilio | `P = 10500`, envío `10000` | `subtotalCents 10500`, `processingFeeCents 0`, `totalCents 20500`, `feeConvention FEE_INCLUDED`; Stripe cobra 20500; sin renglón de comisión en pantalla, ticket ni correo. Costo Stripe estimado ≈ `round(738+300)×1.16 = 1204` ⇒ P&L: ingreso = base de 10500 (= 9052), gasto Stripe = `stripeFeeCents` (real) o 1204 (estimado) |
| C3 | Pedido de 100000 | 10 cartas de `M=10000` | `ΣP = 105000` (por unidad, no 104358→104400), con envío 10000 `total 115000`; costo Stripe ≈ `round(4140+300)×1.16 = 5150`; la tienda absorbe el fijo (348) |
| C4 | Umbral 400000 | sellado de precio final 389600 + 1 carta `M=10000` | `S = 389600+10500 = 400100 ≥ 400000` ⇒ envío 0. Con `S = 399999` ⇒ cobra envío; con `S = 400000` exacto ⇒ gratis (`>=`) |
| C5 | Código 10 % | carta `P = 10500` | descuento 1050, subtotal 9450; `total = 9450 + envío`; sin recálculo de comisión |
| C6 | Retiro de bóveda | envío dial `10000` | se muestra 10000 y se cobra 10000 (`totalCents 10000`, `processingFeeCents 0`, `FEE_INCLUDED`); con código de envío gratis ⇒ 0 sin cobro. Costo Stripe del retiro ≈ `round(360+300)×1.16 = 766` (variable ≈418 + fijo 348: el retiro es un cobro aparte, `schema.prisma:1831`) |
| C7 | Reembolso carta | pedido C2, se reembolsa la carta | se devuelven `10500` (sin parte de comisión); Stripe no devuelve su costo |
| C8 | Pedido previo | fila `FEE_ON_TOP` migrada | desglose, reembolso y P&L idénticos a antes (D9-3) |
| C9 | Sellado/accesorio con precio final del dueño 25000 | precio escrito 25000 | `P = 25000` (no se le suma nada) |
| C10 | Migración | todas las filas existentes | `feeConvention = FEE_ON_TOP`, 0 filas NULL; crear una fila sin `feeConvention` falla (NOT NULL) |
| C11 | Bóveda valuación | carta `M=10000` en bóveda | valuada 10000 (mercado), no 10500 |
| C12 | Textos | grep de §5 | 0 ocurrencias de «comisión de plataforma»/«platform fee» en pantallas y correos de pedidos nuevos; paridad es/en |

## 7. Riesgos
- Zona de dinero (`orders`, `payments`, `pricing`, P&L, IVA): veredictos de qa y seguridad-lead; ux-ui antes de backend/frontend.
- Retiros: el dueño supuso que «el fijo ya lo paga el pedido»; medido, cada retiro es un cobro aparte, así que la tienda absorbe ≈MX$7.66 por retiro de MX$100 (no ≈4.2). Informativo; la decisión «A» se mantiene.
- El 4.4 % sale de los dials; si Stripe cambia tarifa, `P` sigue siendo lo que se vio hasta el siguiente cálculo diario.
- Dos convenciones coexisten (reembolsos, P&L, textos dependen de la marca); P&L histórico seguirá subestimado (§1).
- IVA: `P` lleva IVA dentro, así que la comisión incluida tributa IVA (consecuencia de P3-A; contador).
- Depende de publicar §DYN (HECHOS:201).

## 8. Decisiones del gate GATE-D9-303aa13f (2026-11-10; cierran D9-1..5 e I1/I2)
Regla AUTO: ningún punto exige acción del dueño.

**8.1 Gasto Stripe «estimado» (I2).** `PnlComponents` NO cambia (congelado AN-B-13; `sumPnl` itera sus claves).
- Aditivo a NIVEL DE PERIODO en la respuesta del P&L (junto, no dentro, de los componentes): `stripeFeeEstimatedOrders: number` (pedidos y retiros) y `stripeFeeEstimatedCents: number` (parte de `stripeFeesCents` que es estimada). Se calculan en el mismo recorrido que `stripeCostOf`, por mes y total. 0 ⇒ sin marca. Ambos campos son «solo-JSON»: no van al CSV, igual que `statement`. También a nivel de respuesta, solo-JSON: `feeIncludedSince` (ISO | null) = MIN de `createdAt` de pedidos `FEE_INCLUDED` en TODA la historia (no del periodo); null ⇒ ninguno. Frontend puede usarlo para avisar que antes de esa fecha la comisión iba aparte (CONFIRMADO).
- Frontend (Finanzas): si `stripeFeeEstimatedOrders > 0`, el renglón «comisiones Stripe» lleva «~» y nota «Incluye N pedidos con costo estimado (MX$X); se corrige solo cuando Stripe lo confirma». Textos es/en, paridad.
- `stripeCostOf` devuelve `{cents, estimated}`. Estimado SOLO si `FEE_INCLUDED` ∧ `stripeFeeCents` NULL ∧ hubo cobro (`paymentIntentId` no nulo ∧ `totalCents > 0`). Sin PaymentIntent o `totalCents = 0` (retiro gratis por código, pedido 100 % descontado) ⇒ gasto 0, ni real ni estimado, ni cuenta en `stripeFeeEstimatedOrders`. `FEE_ON_TOP` no cambia. Prueba: retiro gratis ⇒ gasto 0 (cierra D9-2).

**8.2 Recálculo automático de `ListingPrice` (D9-1/I1).**
- (a) Disparador: clave `ConfigSetting` `listing_price_formula_version` = `{ v: sha1("d9|"+stripe_fee_pct+"|"+iva_pct), doneAt }`. Al arrancar (`OnApplicationBootstrap`) y en el cron diario de precios y cada 10 min mientras difiera: si `v` guardada ≠ `v` actual (cubre el despliegue de D9 y cualquier cambio futuro de los dials) ⇒ recálculo COMPLETO una vez.
- (b) Candado: `pg_try_advisory_lock` (una sola instancia); por lotes; idempotente (upsert por clave de `ListingPrice`); la versión se escribe SOLO al terminar todo el lote. Fallo o caída ⇒ el siguiente tick (10 min) lo retoma; no se pierde nada. **Estado `partial` (CONFIRMADO):** `formulaTick` devuelve `partial` si hubo piezas saltadas por SKIP LOCKED y `failed` si la corrida falló (`listing-price.service.ts`); en ambos casos NO escribe la versión y el tic siguiente repite el lote completo (idempotente). Mientras sea `partial`, rige (c). Solo `done` escribe `doneAt`.
- (c) Mientras difiera: catálogo, ficha, carrito, quote y session NO leen el `displayPriceCents` de la fila vieja; calculan `P` en vivo desde la base `M` de la fila con la fórmula nueva (misma función única de `money.ts`). Un solo helper de lectura lo hace; bandera en memoria con TTL 60 s. Prueba: con versión forzada distinta, quote == P nuevo.
- (d) Crece sin trabajo: la versión deriva de los dials; sets/cartas nuevas entran por el cron diario normal.

**8.3 `captureStripeFee` — ACEPTADO.** Reintento en línea 3 veces (0 s, 2 s, 10 s), sin bloquear ni revertir la liquidación. Conciliación: cron cada 30 min rellena `stripeFeeCents IS NULL` de `Order`/`ShipmentRequest` pagados con PaymentIntent y `totalCents > 0`, de los últimos 30 días, lotes de 100, `retrieve(expand latest_charge.balance_transaction)`; `updateMany ... WHERE stripeFeeCents IS NULL` (idempotente, carrera segura); error de Stripe ⇒ queda NULL y se reintenta; pasados 30 días queda estimado y marcado (8.1). Un `fee` real de 0 se guarda como 0.

**8.4 Validación del dial (D9-3).** (i) `stripe_fee_pct` ∈ [0, 0.10] y condición cruzada `stripe_fee_pct × (1 + iva_pct) ≤ 0.25` (divisor ≥ 0.75; margen ante cero/negativo); se valida al guardar `stripe_fee_pct` Y `iva_pct` (cambiar el IVA no puede romper la condición) ⇒ 422 `VALIDATION_ERROR` (convención medida de `PUT /admin/settings`) con mensaje en lenguaje llano, valor anterior intacto. Con comisión 0 la fórmula no redondea al peso (decisión aceptada de backend); el cruce ×1.25 (≤ 0.25) es defensa en profundidad. (ii) `IvaDials.stripeFeePct` pasa a REQUERIDO (tipo) y la fórmula lanza error tipado si falta, no es finito o el divisor < 0.75 (falla cerrado): el job de precios aborta conservando las filas previas y deja el evento en log/alerta; checkout usa filas guardadas. (iii) La vista previa del dial lo pasa y deja de usar `grossUpTotal` (D9-5). Borrar `_legacyFee` y el parámetro `fee`/`getStripeFee()`.

**8.5 Lista de deseos.** Hecho medido: lo guardado NO son pesos sino un nivel `maxPct` ∈ {5,10,16} sobre el mercado `M` (`wishlist-math.ts:14,42-60`); `fits` compara `P` exhibido con `half(M×(100+p)/100)`. Con `P ≈ M×1.044` el nivel 5 casi no dispara. Por eso «subir los topes guardados» no aplica: no hay peso guardado; la opción B es un cambio de comparación, sin migración. **DECIDIDO: opción A** (dueño, HECHOS 2026-11-10 «Déjalo como está»): la opción A es sobre el AVISO al cliente: `fits` (comparación precio visto ≤ tope) NO cambia. Aparte, el techo de compra y el margen que ve el DUEÑO en el admin (`ceiling`/`marginAtMarket`) SÍ dividen por el divisor de comisión (precisión en la última fila de HECHOS 2026-11-10): la comisión es costo de cobro, no margen; no cambia nada que vea el cliente. Lo siguiente (opción B) queda solo como referencia descartada. Si B: `maxDisplay` ⇒ `ceilPeso(maxDisplay / (1 − stripe_fee_pct×(1+iva_pct)))` solo en `fits` y en el «hasta $X» que ve el cliente; el techo de compra y margen del admin (`ceiling`, `marginAtMarket`) siguen usando el tope SIN comisión (igual que hoy). Si A (vigente): `fits` sin cambio; techo/margen del admin ÷ divisor, como arriba.

**CAMBIO backend:** 8.1 DTO + `stripeCostOf`; 8.2 job/versión/lectura en vivo; 8.3 reintento + cron; 8.4 validaciones, requerido, borrar muertos (D9-5); D9-4 prueba e2e afirma `P == ceilPeso(M/0.95824)` con M conocido (qa+backend); 8.5 según respuesta. **CAMBIO frontend:** nota «~ estimado» en Finanzas (es/en); si B, nada visible salvo el «hasta $X» que llega ya calculado.

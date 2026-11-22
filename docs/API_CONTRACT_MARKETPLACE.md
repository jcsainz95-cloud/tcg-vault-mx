# API_CONTRACT_MARKETPLACE · F1 (§MARKETPLACE-PROV; diseño y diales en `docs/DECISIONES.md`)

Convenciones del contrato principal (centavos MXN enteros, `{data}`/error `{code,message,details}`, idempotencia por `Idempotency-Key`). Roles: `supplier` (aislado por `supplierId` del token; recurso ajeno ⇒ **404**), `staff` (lectura de colas), `admin`/`super_admin` (acciones; dinero y diales: `super_admin`). Gates: qa + seguridad-lead. Sin dinero real hasta validación fiscal y términos (HECHOS 2026-11-22).

## 0. Regla transversal: DESAGREGADO SIEMPRE (dueño, HECHOS 2026-11-22)
Todo DTO, reporte, CSV y vista que toque dinero de una venta, estado de cuenta, lote o resumen lleva el trío `{grossCommissionCents, cardCostCents, netMarginCents}` con `grossCommissionCents − cardCostCents = netMarginCents` (invariante; el servidor lo comprueba al serializar) **y** `supplierNetCents`. Agregados (día, proveedor, lote, mes) suman cada campo por separado. **Ningún endpoint devuelve «un total» sin el desglose.** Prueba de contrato: recorrer todas las rutas de §3-§6 y fallar si falta un campo del trío. `commissionBps` y `effectiveCommissionBps = max(commissionBps, cardCostBps+minNetMarginBps)` se congelan en la venta.

## 1. Decisiones firmes (valores = defaults de diales `MarketplaceSetting`)
Guía la paga el cliente (`shipFeeMode='customer'`). Piso de margen neto `minNetMarginBps=300`. Plazos: `confirmHours=12`, `shipSlaBusinessDays=2`, `claimWindowDays=7`. **Pago quincenal** (`payoutDays=[15,'eom']`, CDMX; reemplaza `payoutCadenceDays`=7): lote SPEI que ejecuta el dueño. Strikes `strikePauseAt=3/strikeHoldAt=5/strikeBanAt=8`, `strikeExpiryDays=180`.

## 2. Oferta directa (F1 manual; F2 automática)
**Qué es.** El dueño ofrece comprar al proveedor, en firme, una pieza que tiene publicada. Si el proveedor acepta, la pieza **sale del marketplace y entra a buylist** (§BUYLIST-FLUJO: envío a la tienda, revisión, pago SPEI). Siempre opcional para el proveedor.
- **Monto:** `offeredCents` = lo que recibe el proveedor (neto, sin descuentos ocultos). Tope duro 100 % del mercado (regla §PROV) ⇒ 422 `OFFER_ABOVE_MARKET_CAP`; mínimo `minPriceCents` de la pieza no aplica. La pantalla del dueño muestra al lado lo que el proveedor ganaría vendiendo a precio de motor (`supplierNetCents` de venta) para que no ofrezca de más sin querer; el proveedor ve **ambas cifras** (oferta vs. neto estimado si vende) con la misma etiqueta.
- **Vigencia:** `offerTtlHours=72`; vence sola (job `market-offers`, horario) ⇒ `expired`, sin falta ni efecto. Una sola oferta `pending` por pieza (índice único parcial); crear otra con una vigente ⇒ 409 `OFFER_PENDING`.
- **Convivencia con la venta:** la pieza **sigue `live`** mientras hay oferta. Si un cliente la compra antes, la oferta pasa a `canceled_sold` y el proveedor recibe aviso «se vendió a precio de tienda» (es buena noticia: sin falta). Aceptar usa la **misma reserva atómica** de la venta (`UPDATE … WHERE status='live'`); si pierde la carrera ⇒ 409 `LISTING_NOT_AVAILABLE` y la oferta queda `canceled_sold`. Aceptada: pieza `offer_accepted` (fuera del catálogo, no comprable).
- **Contraoferta: NO (F1).** Lo más simple: aceptar o rechazar. El proveedor ya controla su precio (`askNetCents`) y el dueño puede mandar una oferta nueva más alta tras `declined`/`expired` (sujeta al enfriamiento). Contraoferta = F3 si hay demanda real.
- **Si acepta:** se crea una `SellRequest` con `source='marketplace_offer'`, 1 línea al precio pactado, el proveedor como vendedor y CLABE de su perfil (con validación del nombre §BUYLIST-FLUJO); guía **de envío a la tienda pagada por nosotros** (no cuesta al proveedor); `offerShipDays=5` días hábiles para enviarla. Revisión, «bajar precio» con aceptación del proveedor, «No llegó», comprobante y pago SPEI son **los de `API_CONTRACT_BUYLIST_FLUJO.md` sin cambios**; la línea aparece en `GET /admin/buylist/queues` como cualquier otra. Sin envío en plazo ⇒ la oferta se cancela sola, la pieza vuelve `live` y cuenta como falta tipo `offer_noship` (1 punto; solo tras aceptar). Revisión rechaza la carta ⇒ regla buylist vigente + pieza vuelve `live` si el dueño no la compra.
- **Confianza (reglas duras, cada una con prueba):** rechazar o ignorar **no genera falta, no baja reputación, no cambia visibilidad ni ranking**; ofertas **no** se usan para presionar precio: `offerCooldownDays=14` tras rechazo/vencimiento (mismo proveedor y pieza) y `offerMaxPerSupplierPerWeek=3`; un solo aviso por oferta (sin recordatorios insistentes); el aviso dice cuánto, hasta cuándo y que es opcional; la oferta nunca cambia la publicación. Oferta vista/retirada por el dueño antes de aceptar ⇒ `canceled_by_admin` con aviso.
- **Oferta automática (F2, «salida garantizada»):** dial `autoOfferDays` (0 = apagada; default 0 al arrancar, propuesto 60); pieza `live` con ese tiempo sin venta ⇒ job crea la oferta con la misma máquina de estados, `kind='auto'`, monto = regla de buylist del §PROV; mismas reglas de confianza. No se construye en F1.
- **AUTO:** disparo del dueño (manual, atajo) o job; vence/cancela sola; el fallo de correo reintenta con la cola de correo existente; dato dudoso ⇒ la oferta no se crea (422 con motivo); crece sin trabajo porque todo cuelga de la pieza y de los diales.

Estados `MarketOffer`: `pending → accepted | declined | expired | canceled_sold | canceled_by_admin`; `accepted → shipped_to_store → (cierra con la SellRequest) | canceled_noship`.
- POST `/admin/marketplace/listings/:id/offers` · admin · `{offeredCents:int}` ⇒ 201 `MarketOfferDTO`; 422 `OFFER_ABOVE_MARKET_CAP`/`OFFER_COOLDOWN`/`OFFER_LIMIT`, 409 `OFFER_PENDING`/`LISTING_NOT_AVAILABLE`. Idempotente por `Idempotency-Key`.
- DELETE `/admin/marketplace/offers/:id` · admin · retira (solo `pending`).
- GET `/admin/marketplace/offers?status=` · staff · lista con proveedor, pieza, monto, vence, `supplierNetIfSoldCents`.
- GET `/supplier/market/offers` · supplier · sus ofertas. POST `/supplier/market/offers/:id/accept` · `{}` ⇒ `{offer, sellRequestId}`; POST `.../decline` · `{}`; ambos idempotentes (reintento ⇒ 200 con el estado final); vencida ⇒ 409 `OFFER_EXPIRED`.
- `MarketOfferDTO`: `{id, listingId, supplierId, offeredCents, kind:'manual'|'auto', status, expiresAt, supplierNetIfSoldCents, grossCommissionCents, cardCostCents, netMarginCents (de la venta alternativa), sellRequestId|null}`.

## 3. Tendencia de precio (admin; también en la ficha del proveedor y de la pieza)
- GET `/admin/marketplace/listings/:id/price-trend?range=3m|1y|all` · staff ⇒ `{data:{series:[{date,mxnCents,source,kind:'market'|'estimate'}],sinceDate,pointCount,coverage:'full'|'partial'|'none',note}}`. Lee `PriceReference` de la carta y el `gradeKey` de la pieza (filtra `refKind` a `market`; el estimado va aparte con `kind:'estimate'`, nunca mezclado). `coverage='none'` ⇒ la pantalla dice «sin historial» (jamás una línea inventada); `sinceDate` se muestra siempre («datos desde …»).
- GET `/admin/marketplace/suppliers/:id/inventory?withTrend=true` · staff ⇒ por pieza: precio de motor, `trend30dBps`, `trend90dBps|null`, mini-serie (≤ 24 puntos). Cálculo de lectura; cero escrituras.
- **Hallazgos medidos y huecos:** ver DECISIONES §MARKETPLACE-PROV «Tendencia». F1 muestra lo que ya existe; F2 añade la captura semanal propia de gradeadas (`MarketPriceSnapshot`) para cubrir huecos.

## 4. Bandeja de tareas del admin: sección «Marketplace» (colas con contador y siguiente acción)
- GET `/admin/marketplace/queues` · staff ⇒ `{data:[{key,count,oldestAt|null,urgentCount,nextAction:{label,href}}]}` (mismo molde que `GET /admin/buylist/queues`, «Colas del ciclo»). Cada cola se lee en vivo (sin tabla propia) y tiene su listado `GET /admin/marketplace/queues/:key` (paginado, `{items,total}`).
| `key` | Qué cuenta | Siguiente acción | Lo resuelve solo el sistema |
|---|---|---|---|
| `listings_review` | publicaciones en cuarentena (`pending_review`) | «Revisar» (aprobar/rechazar con motivo) | aprueba lo claro; cuarentena sin acción a `quarantineDays=7` ⇒ `rejected` con motivo |
| `sales_unconfirmed` | ventas `awaiting_confirm` (urgentes: faltan < 3 h) | «Ver venta» (contactar al proveedor) | a las 12 h cancela, reembolsa, falta |
| `shipments_late` | ventas vencidas el plazo de envío o con rastreo detenido | «Ver venta/rastreo» | cancela y reembolsa; paquetería retrasada no es falta |
| `claims` | reclamos `open` (urgentes: > 48 h) | «Resolver» (única excepción manual) | sin respuesta del proveedor 72 h ⇒ reembolso + falta |
| `offers_pending` | ofertas `pending` + `accepted` sin envío | «Ver oferta» / «Ofertar» | vence a las 72 h; sin envío en 5 días ⇒ cancela |
| `payouts_due` | próximo lote de la quincena (monto con desglose) | «Descargar lote SPEI» → «Marcar pagado» | el lote se genera solo el día de corte; recordatorio si pasan 3 días |
| `strikes` | proveedores con faltas nuevas, en pausa, retención o baja | «Ver proveedor» (fuerza mayor opcional) | calcula y aplica consecuencias por job; nunca bloquea |
Reglas: cola vacía ⇒ `count:0` (la sección muestra «Todo en orden»); el contador de `payouts_due` incluye el trío desglosado; las acciones son atajos: ninguna cola es el único camino (regla AUTO). Aviso opcional por correo diario si hay urgentes (`marketDigestEnabled`, apagado).

## 5. Pagos quincenales
- Job `market-payout-batch` (días 15 y último, 08:00 CDMX; idempotente por `(periodEnd)`) agrupa ventas `releasable` por proveedor ⇒ `SupplierPayout{batchId, supplierId, grossCommissionCents, cardCostCents, netMarginCents, supplierNetCents, holdbackCents, status:'ready'|'paid'|'failed'}`; CLABE en retención de 72 h tras cambio ⇒ queda en el siguiente lote.
- GET `/admin/marketplace/payouts/:batchId` · super_admin · detalle desglosado; GET `.../export.csv` (CLABE completa solo super_admin, auditado, columnas del trío); POST `.../suppliers/:supplierId/mark-paid` · super_admin · `{reference:string}` idempotente (segunda llamada ⇒ 200 con el mismo estado); `expectedNetCents:int` obligatorio como en `pay-spei` (409 `PAYOUT_CHANGED`).
- GET `/supplier/market/statement?from&to` · supplier · movimientos y lotes, **con el trío por venta**.

## 6. Resto de F1 (resumen; formas completas las fija backend en DTOs y el arquitecto las revisa)
- **Alta:** POST `/admin/marketplace/invites` (`{email,businessName,commissionBps}`; 422 `COMMISSION_BELOW_FLOOR`); POST `/supplier/market/invites/:token/accept` (términos + CLABE). Reusa `SupplierInvite` de §PROV con `commissionBps` y versión de términos.
- **Proveedor:** `/supplier/market/listings` (GET/POST/PATCH/DELETE), `/supplier/market/sales` + `POST .../:id/confirm` + `POST .../:id/ship` (guía nuestra, foto del paquete), `/supplier/market/strikes`.
- **Cliente:** `POST /market/sales/:id/claims` (fotos). **Admin:** `POST /admin/marketplace/claims/:id/resolve`, `GET /admin/marketplace/suppliers`, `GET/PATCH /admin/marketplace/settings` (super_admin).

## 7. Fases
**F1:** todo lo de este contrato salvo lo marcado F2: invitación, panel del proveedor, publicación con cuarentena, precio del motor, comisión por proveedor con piso, venta con retención, envío con guía nuestra pagada por el cliente, reclamo, strikes, **oferta directa manual**, **tendencia con la historia existente**, **bandeja «Marketplace»**, desagregado, pago quincenal. **F2:** oferta automática, captura semanal de gradeadas (`MarketPriceSnapshot`), «Enviar a mi bóveda», spread/saldo de guía, tramos de comisión. **F3:** contraoferta, payout automático, verificación del cert, BGS, reportes.

# D9 — Comisión de plataforma DENTRO del precio de la carta

Decisión: HECHOS.md:201 (2026-10-30) «La comision de plataforma vamos a metela en el precio»; 2026-11-09 «lo de comisión de plataforma arréglalo».
Estado: **PENDIENTE DEL DUEÑO** (preguntas P1–P8). Nada de esto se construye hasta responderlas y publicar §DYN.

## 1. Cómo es hoy (medido con grep, 2026-11-09)
- La «comisión de plataforma» es `processingFeeCents` = gross-up de Stripe sobre `G = S + E` (S = Σ precio exhibido de cartas, E = envío):
  `total = ceil((G + fijo×(1+IVA)) / (1 − pct×(1+IVA)))` — `backend/src/common/money.ts:1019-1035`, cuerpo único `money.ts:789-814`.
  Dials: `stripe_fee_pct` 0.036 y `stripe_fee_fixed_cents` 300; el IVA 16 % de la comisión de Stripe sale de `iva_pct`
  (`settings.constants.ts:449-451`). Tasa efectiva 4.176 %, fijo efectivo MX$3.48.
- Se rotula y se muestra en: ficha/sellado `frontend/messages/es.json:664-665` («· comisión de plataforma al pagar»), checkout
  `es.json:672-674` y `:709`, desglose `AmountBreakdown.tsx`, `es.json:490-491`; reembolso parcial = carta + su parte de comisión
  (`itemFeeShareCents`, `money.ts:1072-1075`; `es.json:2089,2128,2676,2711-2716`).
- P&L: `pnl-core.ts:354,388` suma `processingFeeCents` como `stripeFeesCents`; fórmula `es.json:5559` ya resta «comisiones Stripe»
  y «comisión de plataforma devuelta». Si el ingreso hoy excluye la comisión cobrada: **NO MEDIDO** (leer `pnl-core.ts:340-395` antes de construir).
- Envío gratis: `shipping-rule.ts:108` compara `S >= freeFromCents`; `es.json:4980` dice «subtotal que ve el cliente, antes del envío y de la comisión».
- Retiro de bóveda: el desglose de envío también lleva gross-up (`money.ts:846-856`); con código de envío gratis = MX$0.00 sin comisión (HECHOS:188).
- Códigos de descuento: `discount-pricing.ts` descuenta sobre S y luego se recalcula el gross-up.
- Buylist: pago SPEI al vendedor, sin gross-up (`processingFee` no aparece en buylist; los hits de `buylist.service.ts` son guía/envío). No cambia.
- Feeds/JSON-LD: `frontend/src/lib/seo.ts:139` (`priceCurrency: 'MXN'`) usa el precio exhibido de la carta, sin comisión. No hay feed Google/Meta propio en backend: **NO MEDIDO** si marketing genera uno aparte.

## 2. Regla propuesta (no depende de las respuestas)
1. El precio exhibido `P` de cada carta/sellado ya incluye la comisión. Todo lo que el cliente ve (catálogo, ficha, carrito, JSON-LD, feeds, correos) usa el mismo `P`. Sin renglón de comisión.
2. Se calcula en el servidor, **una vez al día** junto con `ListingPrice` (§DYN), redondeado una vez POR UNIDAD (regla R1). `Σ P` es suma exacta de enteros.
3. `total = Σ P + envío` (sin gross-up encima). Se cobra el precio que el cliente vio. Ya no hay recálculo por pedido.
4. Reembolso de carta = lo que el cliente pagó por esa carta (`P`); Stripe no devuelve su comisión (ya es costo nuestro, sin cambio).
5. Pedidos ya cobrados no se reinterpretan: la fila nueva lleva marca de convención (patrón IVA-3: `NOT NULL` sin `DEFAULT`). Forma exacta del cambio en `schema.prisma`: PENDIENTE (depende de P3).
6. Idempotencia/concurrencia: el total se congela en la sesión de checkout (ya ocurre con `frozen-breakdown.ts`); un cambio de dial no altera sesiones abiertas.

## 3. Preguntas al dueño (A/B con pesos; base: tarjeta 3.6 % + MX$3.00, ambos +16 % IVA ⇒ 4.176 % + MX$3.48)

**P1. ¿Cómo meter la comisión al precio? (el fijo de MX$3.48 se cobra por pedido, no por carta)**
- A · Un porcentaje igual en cada carta (≈4.4 %); el fijo lo absorbe la tienda. Carta MX$100 ⇒ MX$104.36. Hoy un pedido de 1 carta de MX$100 se cobra MX$108.00 y no pierdes nada; con A cobras MX$104.36, Stripe te quita ≈MX$7.84 y te quedan ≈MX$96.5: pierdes los MX$3.48 fijos por pedido. Un pedido de MX$1,000 en cartas queda igual que hoy.
- B · Un porcentaje más alto (≈8 %) que cubre también el fijo en pedidos chicos. Carta MX$100 ⇒ MX$108 (igual que hoy). Pedido de MX$1,000: cobras MX$1,080, Stripe ≈MX$48.6: ganas ≈MX$31 extra, y tus precios se ven ≈3.5 % más altos que con A.
- Recomiendo **A**: precios más competitivos, la pérdida en pedidos de una sola carta barata es de unos pesos y se compensa con pedidos grandes. Si tu pedido típico es de 1 carta de menos de MX$150, elige B.

**P2. Redondeo del precio con comisión**
- A · Peso entero hacia arriba: MX$104.36 ⇒ MX$105 (tu ejemplo). Precios limpios; ganas unos centavos extra.
- B · Al centavo: MX$104.36. Exacto, pero precios «feos».
- Recomiendo **A**.

**P3. ¿Cómo se ve en el P&L (Finanzas)?**
- A · La venta cuenta completa (MX$105) y la comisión de Stripe real aparece solo como gasto. Más simple; la ganancia refleja lo real, incluido el fijo que absorbes.
- B · Se aparta la parte estimada de comisión como «ingreso por comisión» para comparar contra el gasto de Stripe. Más detalle, más cálculo, más riesgo de que no cuadre al centavo.
- Recomiendo **A**. Los meses viejos no se reescriben.

**P4. Ticket, correo y desglose del cliente**
- A · Cartas MX$105 + envío = total; nada de comisión. Es tu decisión literal.
- B · Igual, pero una frase fija al pie «El precio incluye costos de procesamiento de pago» (sin monto).
- Recomiendo **A**. Quitaría los textos «comisión de plataforma al pagar» de ficha, sellado (T1a/T1b) y checkout (HECHOS:177,183,185) y «Incluye comisión de plataforma {fee}».

**P5. Compra a bóveda y retiro**
- Compra a bóveda: igual que domicilio (la carta cuesta `P`). La valuación de bóveda sigue siendo valor de mercado (MX$100), no `P`.
- Envío del retiro (dial, ej. MX$100): A · el cliente ve MX$100 y la tienda absorbe la comisión de ese cobro (≈MX$4.2 sobre un envío de MX$100; el fijo ya lo paga el pedido). B · se sube a MX$108 mostrado para cubrirla.
- Con código de envío gratis: MX$0.00, sin cobro (se mantiene HECHOS:188).
- Recomiendo **A** (el monto que escribes en M10 es el que ve el cliente).

**P6. Envío gratis desde MX$4,000**
- A · Se compara con el subtotal que ya ve el cliente (con comisión incluida). Un pedido de MX$3,830 en cartas «de antes» ahora marca ≈MX$4,000 y obtiene envío gratis: el umbral baja en la práctica ≈4.4 % (≈MX$170 menos de compra).
- B · Subes el umbral a MX$4,200 para conservar el equivalente de hoy.
- Recomiendo **A**: el cliente lee «gratis desde MX$4,000» y compara contra lo que ve en pantalla; el costo es de unos pocos pedidos.

**P7. Códigos de descuento** (casi sin impacto; se propone sin preguntar salvo que objetes)
- Propuesta: el % se aplica sobre el precio que ve el cliente. Código 10 % en una carta de MX$105 ⇒ MX$94.50. Hacerlo «sin comisión y volver a sumarla» da prácticamente lo mismo (≈MX$94.5); no vale la complejidad.
- Efecto real: Stripe cobra menos sobre un total menor, así que la comisión incluida sobra o falta por centavos. No se recalcula nada por pedido.

**P8. Tarjeta vs OXXO/SPEI (si la comisión de Stripe es distinta por método)**
- A · Un solo precio con la tarifa de tarjeta para todos los métodos. Se cobra el precio visto.
- B · Precio distinto según método de pago: rompe «se cobra el precio que el cliente vio».
- Recomiendo **A**. NO MEDIDO: qué métodos están activos hoy y su tarifa; si OXXO cuesta más, esa diferencia la absorbe la tienda.
- Aparte (sellado y accesorios con precio final escrito por el dueño): **el precio que escribes ya es final y no se le suma nada** (si quieres incluir comisión, súbelo tú). El sellado automático (mercado + margen) sí incluye comisión.

## 4. Riesgos
- Zona de dinero: `orders`, `payments`, `pricing`, P&L, IVA ⇒ veredictos de qa y seguridad-lead; ux-ui antes de backend/frontend.
- Cambio de `schema.prisma` (marca de convención) y de textos es-/en-: pasa por arquitecto.
- El 4.4 % es hoy una estimación de dials; si Stripe cambia tarifa, el precio del día sigue siendo el que se vio hasta el siguiente cálculo diario.
- Rebanadas de reembolso: el cálculo `itemFeeShareCents` se simplifica, pero pedidos viejos conservan el cálculo previo (dos convenciones coexisten).
- Depende de publicar §DYN (HECHOS:201).

## 5. Contrato por endpoint (movido desde API_CONTRACT §3, 2026-11-09)
- **Precio:** `displayPriceCents` (catálogo, ficha, carrito, JSON-LD/feeds) = precio ya con comisión, fijado por `ListingPrice` una vez al día. El cliente nunca calcula. Redondeo: PENDIENTE (P2).
- **`POST /checkout/quote`, `/checkout/guest/quote`, `/checkout/session`, `/checkout/guest/session`, `GET /orders/:orderId`:** filas nuevas `totalCents = subtotalCents + shippingFeeCents` (sin gross-up); `processingFeeCents` deja de ser renglón de cliente (valor interno PENDIENTE P3). Pedidos previos conservan desglose y marca de convención (patrón IVA-3, `NOT NULL` sin `DEFAULT`; forma en `schema.prisma` PENDIENTE P3, la define el arquitecto).
- **`GET /checkout/shipping-rule`:** `freeFromCents` se compara con el subtotal exhibido (con comisión) — PENDIENTE (P6). `POST /shipments/quote` y `POST /shipments`: monto exhibido vs comisión absorbida — PENDIENTE (P5).
- **Reembolsos:** carta = `P` pagado (sin `itemFeeShareCents` en filas nuevas); Stripe no devuelve su comisión. Total congelado en la sesión (`frozen-breakdown`); cambio de dial no altera sesiones abiertas.
- **Pruebas (mutar ⇒ rojo):** D9-1 `total = ΣP + envío` al centavo; D9-2 quote y session dan igual total; D9-3 pedido previo se reembolsa como antes; D9-4 ninguna cadena de UI/correo con «comisión de plataforma»; D9-5 feed/JSON-LD = `P`.

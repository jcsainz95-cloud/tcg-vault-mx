/**
 * error-codes.ts — Códigos de error estables (i18n en frontend). API_CONTRACT §0.
 * El backend NO devuelve texto traducido: devuelve `errorCode` + un mensaje EN de fallback.
 */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',

  // Auth
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  USER_BLOCKED: 'USER_BLOCKED',
  // v1.3.1: gestión de usuarios por admin (M6).
  USER_DELETED: 'USER_DELETED',
  CANNOT_DELETE_SELF: 'CANNOT_DELETE_SELF',
  // v1.1: login con Google (verificación server-side del ID token).
  GOOGLE_TOKEN_INVALID: 'GOOGLE_TOKEN_INVALID',
  GOOGLE_EMAIL_UNVERIFIED: 'GOOGLE_EMAIL_UNVERIFIED',
  // v1.5: verificación de correo + recuperación self-service (Resend).
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED', // acción sensible con emailVerified=false (guard)
  EMAIL_VERIFY_TOKEN_INVALID: 'EMAIL_VERIFY_TOKEN_INVALID', // token de verificación inválido/expirado/usado
  RESET_TOKEN_INVALID: 'RESET_TOKEN_INVALID', // token de reset inválido/expirado/usado

  // Money-out / roles
  MONEY_OUT_FORBIDDEN: 'MONEY_OUT_FORBIDDEN',

  // Catalog / pricing
  PRICE_PENDING: 'PRICE_PENDING',
  // v1.31 (formalizado; §Convenciones/Errores del contrato): una FUENTE EXTERNA de datos no está
  // disponible o devolvió payload inválido (timeout/red, 401/403/5xx, parse fallido). Aplica a TCGCSV
  // (espejo de precios/estructura de TCGplayer) y a pokemontcg.io (metadata). NO es un 500 crudo: el
  // backend remapea el fallo remoto a 502 con mensaje accionable. Money-safe (todo el fetch ocurre
  // ANTES de escribir). Emisores: familia TCGCSV del sellado (§M2 groups/products), sync/sync-all
  // (pokemontcg.io) y la familia refresh-variants (§M2 — M-34/M-35). En el batch refresh-variants-all
  // NO se propaga como HTTP: se captura por-set y va a summary.failures[].code. 502.
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  // v1.31 (formalizado; refresh-variants M-34): se intentó refrescar variantes/precios de un set que NO
  // existe en BD, o existe pero SIN cartas. La reparación solo-TCGCSV NO importa el set (no llama a
  // pokemontcg.io); mensaje accionable ("impórtalo primero con POST /admin/catalog/sync"). Se usa 409
  // (no 404) a propósito: el front trata 404/405 como "endpoint no desplegado" (isEndpointMissing) y un
  // SET_NOT_IMPORTED real con 404 se confundiría con eso. Lo emite POST /admin/catalog/refresh-variants;
  // en el batch se captura por-set y va a summary.failures[].code. 409.
  SET_NOT_IMPORTED: 'SET_NOT_IMPORTED',
  // v1.6-finish: el `finish` enviado no está en Card.availableFinishes (SEC-A1). 422.
  // Afecta POST /buylist/quote, POST /buylist/requests, POST /admin/inventory/items.
  FINISH_NOT_AVAILABLE: 'FINISH_NOT_AVAILABLE',
  // v1.30 (§4.29c): la LÍNEA de buylist trae un `productId` (CardProduct separado) que NO existe. 422
  // (quote por-carta / requests) o `ok:false` por-ítem (quote/batch). Afecta POST /buylist/quote[/batch]
  // y POST /buylist/requests.
  PRODUCT_NOT_FOUND: 'PRODUCT_NOT_FOUND',
  // v1.30 (§4.29c): el `productId` existe pero NO cuelga del `cardId` de la línea — rechazo validado,
  // NUNCA fusión silenciosa con la carta de set. Mismos endpoints/forma que PRODUCT_NOT_FOUND.
  PRODUCT_CARD_MISMATCH: 'PRODUCT_CARD_MISMATCH',
  // v1.28 (P-18/P-22, §M2 variant-controls): bounty con `enabled:true` sin `priceCents > 0`
  // (efectivo tras el merge con la fila existente). El bounty es SIEMPRE precio explícito,
  // jamás calculado. 422.
  BOUNTY_PRICE_REQUIRED: 'BOUNTY_PRICE_REQUIRED',
  // v1.28 (P-18/P-22): `bounty.priceCents` por DEBAJO del sugerido de compra por regla del
  // momento (cuando el sugerido resuelve; con sugerido pending se ACEPTA — el bounty es el caso
  // donde más se necesita un precio explícito). Si no es más que la regla, no es bounty. 422.
  BOUNTY_BELOW_RULE: 'BOUNTY_BELOW_RULE',
  // v2.0 (P-48, §4.36.3 / API_CONTRACT §Errores) — códigos de la CURVA. Todos son 422, todos se
  // validan AL GUARDAR (no solo en runtime), todos se evalúan sobre el OBJETO COMPLETO y todos
  // indican QUÉ PUNTO lo rompe en `details: { axis, index, marketCents, … }` (criterio 87).
  // Los emiten `PUT /admin/pricing/curve` y —los que impiden calcular— `POST .../curve/preview`.
  CURVE_EMPTY: 'CURVE_EMPTY', // sin puntos no hay curva que interpolar
  DUPLICATE_BREAKPOINT: 'DUPLICATE_BREAKPOINT', // dos puntos en el mismo mercado ⇒ interpolación ambigua
  SALE_BELOW_MARKET: 'SALE_BELOW_MARKET', // algún multiplierBp < 10000: la venta caería bajo el mercado
  SALE_CURVE_NOT_MONOTONIC: 'SALE_CURVE_NOT_MONOTONIC', // más mercado produciría MENOS precio
  // v2.1.4 (V9): simétrico del anterior en el eje de COMPRA — más mercado PAGARÍA menos. V6 ataba la
  // compra solo en RELATIVO (por debajo de la venta), así que el monto absoluto podía bajar. Misma
  // clase que I1, sin la amplificación de la escalera: pierde dinero en silencio.
  BUY_CURVE_NOT_MONOTONIC: 'BUY_CURVE_NOT_MONOTONIC',
  BUY_ABOVE_SALE: 'BUY_ABOVE_SALE', // la compra alcanza o supera la venta en algún punto del dominio
  BIN_ABOVE_FLOOR: 'BIN_ABOVE_FLOOR', // binCents >= floorCents (ambos ejes saturando en su constante)
  ROUNDING_LADDER_INVALID: 'ROUNDING_LADDER_INVALID', // escalera mal formada (o frontera no múltiplo del paso)
  // v1.37 (pricing por tiers, P-34, §4.33d): en PUT /admin/pricing/tier-map o PUT /admin/pricing/tiers,
  // la edición dejaría una rareza `premium:true` (catálogo canónico, §4.28e) resolviendo en un tier cuya
  // regla de COMPRA es `fixed` (con el seed: T0/T1). Guardarraíl money-safe: una chase jamás cotiza al bin
  // fijo barato de bulk, aunque el dueño edite el mapa. Se valida sobre el producto (tiers × mapa) completo,
  // por eso lo emiten AMBOS PUT. `details.offending: [{ rarity, tierId }]`. El eje de VENTA no lo dispara. 422.
  PREMIUM_RARITY_FIXED_TIER: 'PREMIUM_RARITY_FIXED_TIER',
  // v1.37 (pricing por tiers, P-34): en PUT /admin/pricing/tier-map, una key de `assignments` NO es una
  // rareza canónica del catálogo (§4.28c). Money-safe: el mapa solo asigna tiers a rarezas conocidas; una
  // key desconocida se rechaza en vez de crear una entrada muerta. Distinto de VALIDATION_ERROR. 422.
  UNKNOWN_RARITY: 'UNKNOWN_RARITY',
  // v1.50-graded-estimate («gancho de grading», §4.38d / §M2). Invariantes de la tabla de escalones de
  // COSTO de gradeo, validados en CADA `PUT /admin/pricing/graded-estimates` (fail-closed). Son códigos
  // propios —y no un VALIDATION_ERROR genérico— porque el error es ENTRE FILAS y el editor de M2 tiene
  // que poder señalar QUÉ par de escalones no empalma. 422.
  GRADING_TIERS_EMPTY: 'GRADING_TIERS_EMPTY', // I1: array vacío (sin tabla no hay gate; jamás costo 0).
  GRADING_TIERS_NOT_CONTIGUOUS: 'GRADING_TIERS_NOT_CONTIGUOUS', // I3/I4: hueco, solape, desorden o no arranca en 0.
  GRADING_TIERS_NOT_OPEN_ENDED: 'GRADING_TIERS_NOT_OPEN_ENDED', // I5: el ÚLTIMO escalón (y solo él) debe ser abierto.
  // v1.50 (§4.38f / §2): `?sort=grading_showcase` SIN `?gradingHighlight=true`. Fail-closed: si se
  // aceptara, los grupos NO destacados irían a la cola del listado con clave de orden indefinida y la
  // vitrina podría pintarlos al paginar. Mejor un error honesto que una superficie comercial
  // contaminada. 400.
  GRADING_SORT_REQUIRES_FILTER: 'GRADING_SORT_REQUIRES_FILTER',
  // v1.50.2 (INV-D, §4.38l / §M2) — la colisión entre el ESTIMADO y el SLAB REAL publicado. La fila del
  // «valor estimado si se gradea» y la referencia de mercado de una pieza PSA N **publicada** son LA
  // MISMA FILA (`cardId` + `graded` + `gradeKey` + `finish='normal'`), así que un «estimado» tecleado
  // sobre una carta con slab publicado **cambia el precio de venta real de esa pieza**.
  //
  // `intent` es OBLIGATORIO (no opcional-con-default) a propósito: un default a `"market"` sería
  // FAIL-OPEN — el operador que olvida el campo obtendría, en silencio, la ruta que MUEVE DINERO. Se
  // acepta un breaking chico en una ruta `super_admin` a cambio de que la ambigüedad sea imposible de
  // expresar. Misma doctrina que «sin escalón no hay destacado» y «AUSENTE ≠ INVÁLIDA». 422.
  GRADED_INTENT_REQUIRED: 'GRADED_INTENT_REQUIRED',
  // Se intentó fijar un ESTIMADO (`intent:"graded_estimate"`) sobre una carta que YA tiene >= 1 slab
  // publicado de ese grado: esa fila es el precio de mercado REAL de esas piezas. 409 (conflicto de
  // ESTADO, no de forma: el mismo body es válido en cuanto deje de haber slabs publicados).
  GRADED_ESTIMATE_SLAB_PUBLISHED: 'GRADED_ESTIMATE_SLAB_PUBLISHED',
  // v1.50.3-g (M-44, §4.38l.4.10 · SEC-M43-1) — se intentó BAJAR la naturaleza de la fila del DÍA:
  // `intent:"graded_estimate"` sobre una fila que ya existe con `refKind='market'`. Como `refKind` NO
  // está en la `@@unique`, esa escritura **reusa la misma fila**: la reclasifica Y le pisa el monto, o
  // sea que un verbo INFORMATIVO destruye un dato de DINERO. La guarda hermana
  // (`GRADED_ESTIMATE_SLAB_PUBLISHED`) solo ve `platform + listed`, así que no cubre el slab en
  // `in_stock`/`reserved`/`picking`/envío ni el de **custodia de cliente** — el hueco que el blue team
  // reprodujo en vivo (`500000 · market → 1234 · graded_estimate`, pieza real invisible y sin cola).
  //
  // Regla sin sujeto (§4.38l.4.3 regla 2, ampliada): *la naturaleza de una fila solo se SUBE, y solo por
  // acto humano declarado (`intent:"market"`); BAJARLA no es una operación que ofrezca este sistema.*
  // 409 y no 422: el body es sintácticamente impecable — el conflicto es con el ESTADO del recurso, y
  // lo que hay que cambiar es la INTENCIÓN, no el cuerpo.
  GRADED_ESTIMATE_WOULD_DEGRADE_MARKET_REF: 'GRADED_ESTIMATE_WOULD_DEGRADE_MARKET_REF',
  // v1.50.3 (§4.38n.3 / §M2) — `GET /admin/pricing/graded-estimates/review` con una clave de config
  // PRESENTE-pero-INVÁLIDA de la que depende la coherencia (hoy `graded_estimate_max_raw_multiple`).
  //
  // Aplicación de `AUSENTE ≠ INVÁLIDA`: el dial `off` es una **decisión** y esta lista la tolera (evalúa
  // igual, para poder limpiar ANTES de encender); una clave corrupta es **intención perdida**. Una lista
  // de revisión calculada contra un umbral basura es PEOR que no tener lista: marcaría —o dejaría de
  // marcar— cartas por una razón que no es la que el operador cree, y ésta es precisamente la superficie
  // que existe para que el operador CONFÍE en lo que ve. 409 (conflicto de ESTADO: el mismo request es
  // válido en cuanto la clave se corrija).
  GRADED_CONFIG_INVALID: 'GRADED_CONFIG_INVALID',

  // Checkout / orders
  ITEM_UNAVAILABLE: 'ITEM_UNAVAILABLE',
  BILLING_PROFILE_REQUIRED: 'BILLING_PROFILE_REQUIRED',

  // Inventory (M1) — WS-E hardening
  // Una pieza cuyo status de ORIGEN no es seguro para listar (reserved/in_custody/picking/
  // shipped/delivered/lost/damaged/withdrawn) NO puede re-publicarse a `listed`. Guardarraíl
  // anti-double-sell del bulk-publish: solo se listan piezas en {in_stock, listed}. 422.
  ITEM_NOT_PUBLISHABLE: 'ITEM_NOT_PUBLISHABLE',
  // v1.20-master-set-everywhere: POST /admin/inventory/adjustments sobre una pieza NO ajustable.
  // Solo piezas ownerType=platform con status ∈ {in_stock, listed} admiten perdida|danada|
  // error_captura; una reserved/vendida/en-custodia/enviada o ya terminal se resuelve por su
  // flujo dueño (M3/M4/`mark`), no por ajuste. 422.
  ITEM_NOT_ADJUSTABLE: 'ITEM_NOT_ADJUSTABLE',
  // P-29 (baja rápida por cantidad): POST /admin/inventory/items/bulk-remove pidió dar de baja
  // N piezas de un (cardId, finish[, condición]) pero solo hay M < N piezas ajustables
  // (ownerType=platform ∧ status ∈ {in_stock, listed}). No se baja NADA (atómico): «no bajar más
  // de las que hay». `details.available`/`details.requested`. 422. PENDIENTE de formalizar en
  // API_CONTRACT por el arquitecto (patrón de los códigos M1 dedicados de arriba).
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  // v1.39-sealed-product-module (P-38, §4.34d): el `sealedProductId` de una línea de alta de sellado
  // NO existe o está inactivo (soft-deleted). El backend deriva la identidad del sellado desde el
  // `SealedProduct` persistido; un id muerto no puede dar identidad. 422 (por-línea en el lote).
  SEALED_PRODUCT_NOT_FOUND: 'SEALED_PRODUCT_NOT_FOUND',
  // v1.39.1 (P-38, §4.34d): se envió `manualMarketMxnCents` en una línea de alta de sellado cuyo
  // mercado YA está resuelto (live/caché priced). El override manual SOLO llena el HUECO de precio
  // (mercado null): JAMÁS pisa un mercado vivo. Money-safe. NO se dispara por rol (vault_operator+ lo
  // permite, decisión del humano v1.39.1). 422 (por-línea en el lote).
  MANUAL_MARKET_NOT_ALLOWED: 'MANUAL_MARKET_NOT_ALLOWED',

  // Payments / Stripe
  AMOUNT_TOO_LOW: 'AMOUNT_TOO_LOW', // B2: por debajo del mínimo de Stripe MX
  // MS-2 (BE-27): el importe agregado del pedido (totalCents) no es representable en Int32
  // (> MAX_CENTS = 2_147_483_647). Un agregado NO se puede clampar en silencio (recortar = subcobro):
  // se RECHAZA el checkout con 422 en vez de reventar al persistir la Order (excepción Postgres = DoS).
  AMOUNT_TOO_LARGE: 'AMOUNT_TOO_LARGE',
  CARD_DECLINED: 'CARD_DECLINED', // B1: StripeCardError mapeado a error de negocio legible
  PAYMENT_PROVIDER_UNAVAILABLE: 'PAYMENT_PROVIDER_UNAVAILABLE', // A2: fallo del PI → reintento

  // Shipments
  ADDRESS_NOT_MX: 'ADDRESS_NOT_MX',
  ITEM_NOT_SETTLED: 'ITEM_NOT_SETTLED',
  // SEC-H1 (WS-H): un item cuyo `status` no es `in_custody` (p. ej. ya `withdrawn` tras un
  // envío entregado, conservando ownershipStatus='settled') es INELEGIBLE para un nuevo
  // retiro. Criterio de escritura idéntico al flag de lectura `withdrawable` del HoldingDTO
  // (settled && status==='in_custody' && sin envío activo). 422. API_CONTRACT §5.
  ITEM_NOT_IN_CUSTODY: 'ITEM_NOT_IN_CUSTODY',
  ITEM_IN_ANOTHER_SHIPMENT: 'ITEM_IN_ANOTHER_SHIPMENT',

  // Buylist
  BUYLIST_LIMIT_EXCEEDED: 'BUYLIST_LIMIT_EXCEEDED',
  INE_REQUIRED: 'INE_REQUIRED',
  CLABE_NOT_OWN_NAME: 'CLABE_NOT_OWN_NAME',
  CLABE_INVALID: 'CLABE_INVALID',
  // v1.15: POST /buylist/requests sin `clabe` en el body Y sin CLABE en archivo
  // (KycProfile.clabeEnc vacío). Distinto de CLABE_INVALID (formato) y CLABE_NOT_OWN_NAME.
  CLABE_REQUIRED: 'CLABE_REQUIRED',
  // Una carta rechazada en verificación (resultado NO-NM, PROJECT §H) NUNCA puede
  // convertirse en InventoryItem vendible: convert-to-inventory exige itemStatus='aprobada'.
  ITEM_NOT_APPROVED: 'ITEM_NOT_APPROVED',
  // B-4 / S-B5: la decisión carta-por-carta aprobó un `approvedPriceCents` por encima de la
  // cota (≤ quoted × factor y ≤ tope AML por solicitud). Defensa de dinero saliente. 422.
  APPROVED_PRICE_CAP_EXCEEDED: 'APPROVED_PRICE_CAP_EXCEEDED',
  // v1.24-buylist-request-reject: POST /admin/buylist/:id/reject (cierre explícito «Rechazar
  // solicitud») sobre una solicitud que aún tiene ≥1 ítem NO-rechazado (itemStatus != 'rechazada',
  // p. ej. aprobada/ajustada/convertida_inventario/verificacion). El botón NO rechaza ítems en
  // cascada (eso es cherry-pick por-ítem); sólo sella una solicitud ya sin ítems vivos. 422.
  // `details.nonRejectedItemStatuses: SellItemStatus[]` (los status vivos). API_CONTRACT §0/§M5.
  REQUEST_HAS_NON_REJECTED_ITEMS: 'REQUEST_HAS_NON_REJECTED_ITEMS',
  // v1.51 · BL-2 (API_CONTRACT §6, ARCHITECTURE §4.39(b.2)) — POST /buylist/requests/:id/respond
  // (accept|decline) sobre una solicitud SIN ajuste vivo que responder. Precondición:
  // `closedAt IS NULL ∧ adjustmentSentAt IS NOT NULL ∧ status ∈ {verificacion, aprobada}`.
  // Cubre `pagada` (EL DINERO YA SALIÓ), `rechazada`, `abandonada` y el re-`accept` sobre un ajuste
  // ya consumido. NO es idempotente en 200: este verbo mueve dinero y un 200 silencioso en la
  // segunda llamada esconde justo lo que hay que ver. `details.status`. 409.
  NO_LIVE_ADJUSTMENT: 'NO_LIVE_ADJUSTMENT',
  // v1.51 · criterio 150 por lo negativo — el flujo `ajustada` NO existe en el ciclo de OFERTA:
  // `respond` y `itemDecision(adjust)` quedan prohibidos si `offerSentAt IS NOT NULL`.
  // `details.status`. 409.
  // ✅ v1.51.5 (§4.39b.3): **YA SE EMITE en `respond`** — la columna `offerSentAt` existe desde M-46,
  // así que el bloqueo del `TODO` desapareció y se cableó. `itemDecision(adjust)` la emitirá con el
  // pase de `POST /admin/buylist/:id/offer`. Ver docs/BACKEND_NOTES.md.
  ADJUST_NOT_ALLOWED_IN_OFFER_CYCLE: 'ADJUST_NOT_ALLOWED_IN_OFFER_CYCLE',

  // ===================== v1.51 · CICLO DE ADQUISICIÓN — LA OFERTA (§M5 / §4.39h) =====================
  // `POST /admin/buylist/:id/offer` sobre una solicitud que no está `cotizada`, o con una oferta ya
  // preparada/enviada. `details: { status, offerState }`. 409.
  OFFER_NOT_ALLOWED: 'OFFER_NOT_ALLOWED',
  // Sobre una oferta YA ENVIADA. Una oferta enviada NO SE EDITA: se cancela y se emite otra
  // (criterio 145) — el precio ofertado es vinculante desde el correo (D2/D9). `details.status`. 409.
  OFFER_ALREADY_SENT: 'OFFER_ALREADY_SENT',
  // v1.51.3 (D36) — SIN DIRECCIÓN DE ORIGEN NO SE OFERTA. Ofertar es comprometer dinero Y prometer
  // una etiqueta: si el hueco se descubriera al capturar la guía, ya le habríamos escrito al vendedor
  // que le compramos y estaríamos incumpliendo un contrato por un dato que nunca pedimos.
  // ⚠️ PROHIBIDO rellenarla leyendo la libreta viva. `details: { sellRequestId }`. 422.
  PICKUP_ADDRESS_MISSING: 'PICKUP_ADDRESS_MISSING',
  // Las líneas del body no cubren EXACTAMENTE los ítems de la solicitud. Sin esto, una línea olvidada
  // saldría del correo sin que nadie decidiera nada sobre ella.
  // `details: { missingItemIds, unknownItemIds }`. 422.
  OFFER_LINES_MISMATCH: 'OFFER_LINES_MISMATCH',
  // Línea `buy` sin monto resoluble y sin override. **La oferta NO sale a medias**: o se le pone
  // precio a mano (con motivo) o esa línea se marca `skip`. `details.itemIds`. 422.
  OFFER_LINE_NOT_PRICEABLE: 'OFFER_LINE_NOT_PRICEABLE',
  // Override sin motivo (criterio 148a). *Sin motivo no hay override*: es lo que convierte un número
  // a mano en una decisión revisable en vez de una cifra huérfana. `details.itemIds`. 422.
  OVERRIDE_REASON_REQUIRED: 'OVERRIDE_REASON_REQUIRED',
  // v1.51.2 (D34) — PISO DE NETO PARA EMITIR: `offerNetCents < buylistMinimumOfferNetCents`. El
  // umbral es INCLUSIVO (D40): exactamente el piso SÍ se emite. ⚠️ Gobierna la EMISIÓN, JAMÁS el
  // pago (`payoutNetCents` no tiene más piso que el cero).
  // `details: { grossCents, shippingFeeCents, netCents, minimumNetCents, requiredGrossCents,
  // grossShortfallCents }` — el faltante va en BRUTO porque es la palanca del operador. 422.
  // ⚠️ `OFFER_NET_NOT_POSITIVE` (v1.51.1) **NO EXISTE**: su nombre describía la regla vieja.
  OFFER_NET_BELOW_MINIMUM: 'OFFER_NET_BELOW_MINIMUM',
  // `POST …/offer/authorize` sobre algo que no está esperando autorización. DOS candados a propósito
  // (§4.39h): `offerState='pending_authorization' ∧ status='cotizada' ∧ closedAt IS NULL` — el
  // segundo existe para que perder el primero no resucite una solicitud TERMINAL con un correo
  // vinculante. `details: { offerState, status }`. 409.
  OFFER_NOT_PENDING_AUTHORIZATION: 'OFFER_NOT_PENDING_AUTHORIZATION',
  // `POST …/offer/cancel` sin oferta viva, o sobre una solicitud que ya avanzó más allá de
  // `ofertada` (una `aceptada` NO se cancela por esta vía). `details: { status, offerState }`. 409.
  OFFER_NOT_CANCELLABLE: 'OFFER_NOT_CANCELLABLE',
  // `POST /buylist/requests/:id/offer-response` sobre una solicitud que no está `ofertada`.
  // `details.status`. 409.
  OFFER_NOT_PENDING: 'OFFER_NOT_PENDING',
  // El plazo de aceptación (2 días hábiles, congelado al comunicar la oferta) ya venció. Aceptar
  // después NO funciona y NO tiene efecto. `details.offerAcceptDeadlineAt`. 409.
  OFFER_EXPIRED: 'OFFER_EXPIRED',

  // Guest checkout (v1.21) — API_CONTRACT §0 / §4-G. Todos ADITIVOS: ningún código previo cambia.
  // El invitado eligió destino bóveda. NO es un error de UI: es la señal del UPSELL (criterio 48),
  // con `details.upsell=true`. La bóveda exige cuenta por decisión de producto (PROJECT §C/§J). 422.
  VAULT_REQUIRES_ACCOUNT: 'VAULT_REQUIRES_ACCOUNT',
  // Se llamó un endpoint /checkout/guest/* con una SESIÓN VÁLIDA. Un invitado nunca toca un
  // endpoint `customer` y viceversa (invariante §4-G.0-3). 409.
  ALREADY_AUTHENTICATED: 'ALREADY_AUTHENTICATED',
  // Enlace de seguimiento: el hash NO existe (token inventado/manipulado/de un pedido borrado).
  // Mensaje genérico: NO dice si el pedido existe (criterio 52). 404.
  INVALID_TOKEN: 'INVALID_TOKEN',
  // El token existe pero `expiresAt < now`. Mensaje neutro + oferta de reenvío (criterio 53). 410.
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  // El token dejó de valer: el pedido se reclamó, se emitió uno nuevo (rotación) o soporte lo rotó.
  // `details.reason = CLAIMED | ROTATED | SUPPORT`. 410.
  TOKEN_REVOKED: 'TOKEN_REVOKED',
  // Reclamo: el pedido ya está vinculado a una cuenta (una sola vez, criterio 55). 409.
  ORDER_ALREADY_CLAIMED: 'ORDER_ALREADY_CLAIMED',
  // Reclamo: el correo VERIFICADO de la sesión no es el `guestEmail` del pedido. 403.
  CLAIM_EMAIL_MISMATCH: 'CLAIM_EMAIL_MISMATCH',
  // Reenvío de enlace sobre un pedido fuera del tope de edad (GUEST_TRACKING_MAX_AGE_DAYS).
  // SOLO lo devuelve el endpoint ADMIN (§4-G.9b); el reenvío público responde 202 siempre
  // (devolverlo ahí sería un oráculo de existencia). 422.
  GUEST_ORDER_TOO_OLD: 'GUEST_ORDER_TOO_OLD',

  // Disputes
  DISPUTE_WINDOW_CLOSED: 'DISPUTE_WINDOW_CLOSED',
  NOT_RAW: 'NOT_RAW',

  // Sellado / producto cerrado (v1.23-sealed-sales) — endpoints FEATURE-FLAGGED de §2-S.
  // El dial que gobierna el endpoint (`sealed_value_trend` / `sealed_restock_alerts`) está en `off`.
  // Se sirve como 404 (el recurso no existe públicamente hasta encender el flag). API_CONTRACT §2-S.
  FEATURE_DISABLED: 'FEATURE_DISABLED',
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

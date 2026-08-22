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

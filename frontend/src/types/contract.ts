/**
 * Tipos espejo de docs/API_CONTRACT.md (v1). Fuente de verdad = el contrato.
 * NO editar el contrato desde aquí; si falta un campo, se anota como solicitud
 * al arquitecto en docs/FRONTEND_NOTES.md.
 */

// ---- Enums (contrato §0) ----
export type Role = 'customer' | 'vault_operator' | 'super_admin';
export type Locale = 'es' | 'en';
export type ProductType = 'graded' | 'sealed' | 'raw';
// v1.1: RawCondition reducido a NM (único valor; se eliminan LP|MP|HP|DMG).
export type RawCondition = 'NM';
// v1.6-finish: acabado/versión de carta (derivado de las llaves de tcgplayer.prices,
// ARCHITECTURE §3.7). graded/sealed = normal. Es la lista blanca de Card.availableFinishes.
export type Finish = 'normal' | 'reverse_holo' | 'holofoil' | 'first_edition_holofoil';
// v1.1: subtipo opcional del sellado.
export type SealedSubtype = 'box' | 'etb' | 'bundle' | 'tin' | 'blister';
// v1.23-sealed-sales: condición SIMPLE del sellado, visible al comprador. Enum de BD
// (InventoryItem.sealedCondition, default mint). No afecta precio (labels legibles vía i18n).
export type SealedCondition = 'mint' | 'minor_box_damage';
// v1.23-sealed-sales: de dónde salió el precio de venta del sellado (derivado server-side por
// computeSealedSalePrice, NO enum de BD). Se muestra a modo informativo en la ficha.
export type SealedSpreadSource = 'override' | 'subtype_spread' | 'global_spread';
// v1.1: proveedor de autenticación del User.
export type AuthProvider = 'local' | 'google';
export type GradingCompany = 'PSA' | 'CGC';
export type OwnerType = 'platform' | 'customer';
export type OwnershipStatus = 'pending' | 'settled';
export type InventoryStatus =
  | 'in_stock'
  | 'listed'
  | 'reserved'
  | 'in_custody'
  | 'picking'
  | 'shipped'
  | 'delivered'
  | 'lost'
  | 'damaged'
  | 'withdrawn';
export type VaultZone = 'platform_stock' | 'customer_custody';
export type OrderStatus = 'pending' | 'settled' | 'failed' | 'refunded' | 'chargeback';
export type ShipmentStatus =
  | 'solicitado'
  | 'picking'
  | 'guia'
  | 'enviado'
  | 'entregado'
  | 'cancelado';
/**
 * v1.17-withdrawal-lifecycle: subconjunto "activo" de ShipmentStatus expuesto en
 * HoldingDTO.shipmentState (etapa del envío activo de un item en bóveda). `entregado`
 * NUNCA aparece (el item pasa a InventoryStatus.withdrawn y sale de holdings) y
 * `cancelado` libera el item ⇒ shipmentState=null. Ver contrato §3 / Enums.
 */
export type ShipmentActiveStage = 'solicitado' | 'picking' | 'guia' | 'enviado';
export type SellRequestStatus =
  | 'cotizada'
  | 'recibida'
  | 'verificacion'
  | 'aprobada'
  | 'pagada'
  | 'rechazada'
  | 'abandonada';
export type SellItemStatus =
  | 'cotizada'
  | 'precio_pendiente'
  | 'recibida'
  | 'verificacion'
  | 'aprobada'
  | 'ajustada'
  | 'rechazada'
  | 'pagada'
  | 'convertida_inventario';
// DEPRECADO v1.3.1: reemplazado por la tabla de regla por rareza (BuylistRuleMode).
// Se conserva por retención legacy; nada nuevo lo consume.
export type BuylistCategory = 'comun' | 'reverse_holo' | 'ex_plus';
// v1.3.1: naturaleza de la regla de precio de buylist por rareza.
// fixed = monto fijo MX$ (centavos); pct = porcentaje [0,100] de la referencia.
export type BuylistRuleMode = 'fixed' | 'pct';
// v1.13-sales-pricing: regla de precio de VENTA por rareza. Misma FORMA que
// BuylistRuleMode, pero la semántica del pct DIFIERE: fixed = piso MX$ (centavos);
// pct = % de MARKUP ARRIBA de mercado ([0,1000]) → salePrice = round(ref × (1 + value/100)).
export type SalesRuleMode = 'fixed' | 'pct';
export type DisputeStatus = 'abierta' | 'en_revision' | 'resuelta_recompra' | 'rechazada';
// v1.2: tipo de disputa derivado server-side del productType (no lo envía el cliente).
export type DisputeType = 'condition_raw' | 'condition_sealed';
// v1.19: `tcgcsv` = referencia de mercado del SELLADO (TCGCSV, USD→MXN con FX+colchón).
export type PriceSource = 'pokemontcg_io' | 'pokemonpricetracker' | 'poketrace' | 'manual' | 'tcgcsv';
export type KycStatus = 'none' | 'pending' | 'verified' | 'rejected';
export type AcquisitionType = 'aportacion_en_especie' | 'buylist' | 'compra';
export type CfdiStatus = 'registrado' | 'no_aplica';

// ---- DTOs base (contrato §0) ----
export interface Money {
  amountCents: number;
  currency: 'MXN';
}

export interface PriceInfo {
  status: 'priced' | 'pending';
  referenceMxnCents?: number;
  source?: PriceSource;
  capturedDate?: string;
}

export interface CardDTO {
  id: string;
  externalId: string;
  name: string;
  number: string;
  // v1.22-variantes-orden: claves de ORDEN NATURAL persistidas en BD (M-26). El servidor ya entrega
  // `GET /buylist/cards` ordenado por (numberPrefix, numberSort, number, id); el front NUNCA inventa
  // esta clave (antes se usaba el índice del arreglo) y solo re-ordena localmente tras filtrar con
  // el comparador de `@/lib/cardOrder`. Opcionales en el TIPO (no en la norma): mientras el re-sync
  // de M-26 no haya corrido en TODAS las filas, `@/lib/cardOrder` deriva la clave equivalente en
  // cliente con `deriveNumberParts` para no degradar a orden lexicográfico ("10" antes que "2").
  numberSort?: number;
  numberPrefix?: string;
  rarity: string;
  supertype: string;
  subtypes: string[];
  setId: string;
  setName: string;
  imageSmallUrl: string;
  imageLargeUrl: string;
  // v1.6-finish: acabados en que existe la carta (derivados de tcgplayer.prices al importar).
  // Sigue siendo 1 CardDTO por carta; availableFinishes es un array en el MISMO objeto.
  // Filas históricas / sin re-sync → ["normal"]. Lista blanca contra la que el backend valida `finish`.
  availableFinishes: Finish[];
  // v1.22-2-finish-display (N-15): acabados que el FRONT debe PINTAR (⊆ availableFinishes, mismo
  // orden FINISH_ORDER, nunca vacío). Suprime el `normal` ESPURIO de premiums de una sola impresión.
  // NO cambia la validación ni la derivación de monto (siguen sobre availableFinishes). Opcional en
  // el TIPO por resiliencia: si un endpoint aún no lo emite, el front usa `availableFinishes` como
  // fallback (helper `displayFinishesOf` en @/lib/finish). Nunca AÑADE acabados, solo resta.
  displayFinishes?: Finish[];
  // v1.29 (§4.27): productos vendibles SEPARADOS (Deck Exclusives / promo) de esta carta, con su
  // PROPIO precio por acabado. El cotizador (que compone el binder client-side desde
  // `GET /buylist/cards`) los propaga a `MasterSetCardCellDTO.separateProducts`. Ausente/[] = la
  // carta no tiene productos separados (caso común).
  separateProducts?: CardProductDTO[];
}

export interface ListingDTO {
  inventoryItemId: string;
  card: CardDTO;
  productType: ProductType;
  rawCondition?: RawCondition;
  sealedSubtype?: SealedSubtype;
  // v1.6-finish: acabado de ESTA copia física. referenceValue/salePriceCents se calculan
  // contra la PriceReference de ESE acabado. graded/sealed → "normal".
  finish: Finish;
  gradingCompany?: GradingCompany;
  gradeValue?: string;
  // v1.2: nº de certificado PSA/CGC (verificable en la graduadora). null para raw/sealed.
  certNumber?: string;
  // v1.23-sealed-sales: condición del sellado (ADITIVO): presente SOLO en productType='sealed'
  // (mint|minor_box_damage); omitido en raw/graded. Para sellado, referenceValue = valor de
  // mercado TCGCSV y salePriceCents = override o mercado×spread (ARCHITECTURE §4.23b).
  sealedCondition?: SealedCondition;
  referenceValue: PriceInfo;
  salePriceCents?: number;
  sellable: boolean;
}

// v1.1: punto de la serie de tendencia del portafolio (contrato §3, PortfolioPointDTO).
export interface PortfolioPointDTO {
  date: string;
  valueMxnCents: number;
  costBasisMxnCents?: number;
  estimated?: boolean;
}

// v1.1: rango del historial de portafolio (contrato GET /vault/portfolio/history).
export type PortfolioRange = '5d' | '15d' | '1m' | '3m' | '6m' | '1y' | 'ytd' | 'all';

export interface PortfolioHistoryResponse {
  range: PortfolioRange;
  points: PortfolioPointDTO[];
  change: { absMxnCents: number; pct: number | null; direction: 'up' | 'down' | 'flat' };
}

// v1.9-set-chart: gráfica PÚBLICA del valor de mercado agregado de un SET (hero de la home).
// Punto de la serie diaria (misma línea que PortfolioPointDTO). valueMxnCents = SUM de la
// PriceReference (acabado normal/raw) de las cartas PRICEADAS del set ese día; pricedCardCount =
// cuántas cartas entraron al total (las sin precio se excluyen, no se inventan). estimated?
// reservado (la serie no tiene backfill en el MVP).
export interface SetValuePointDTO {
  date: string;
  valueMxnCents: number;
  pricedCardCount: number;
  estimated?: boolean;
}

// v1.9-set-chart: cabecera del set graficado. id = id LOCAL del CardSet (no el externalId).
// Datos de catálogo públicos de pokemontcg.io (en inglés, no se traduce); series/releaseDate opcionales.
export interface SetRefDTO {
  id: string;
  name: string;
  series?: string;
  releaseDate?: string;
}

// v1.9-set-chart: rango de la serie (mismo conjunto que PortfolioRange).
export type SetValueRange = '5d' | '15d' | '1m' | '3m' | '6m' | '1y' | 'ytd' | 'all';

// v1.9-set-chart: respuesta de GET /catalog/featured-set/value-history (y el genérico por-id).
// `set` es null si no hay ningún CardSet para graficar (el hero degrada sin error).
export interface SetValueHistoryResponse {
  set: SetRefDTO | null;
  range: SetValueRange;
  points: SetValuePointDTO[];
  change: { absMxnCents: number; pct: number | null; direction: 'up' | 'down' | 'flat' };
}

export interface BreakdownDTO {
  subtotalCents: number;
  ivaCents: number;
  ivaRatePct: number;
  processingFeeCents: number;
  totalCents: number;
  currency: 'MXN';
  /**
   * v1.21-guest-checkout (ADITIVO, opcional): SOLO presente en un pedido
   * `fulfillmentMode='direct_ship'` (hoy = pedido de invitado, contrato §4-G), donde el
   * envío se cobra en el MISMO PaymentIntent que las cartas. Ausente en compras a bóveda
   * y en retiros (ahí el shape y las fórmulas NO cambian). Con `shippingFeeCents`:
   *   ivaCents = round((subtotalCents + shippingFeeCents) × ivaRatePct/100)
   *   totalCents = subtotalCents + shippingFeeCents + ivaCents + processingFeeCents
   * OJO: es una LÍNEA APARTE; NO se resta del subtotal (asimetría deliberada con §5,
   * donde en un retiro `subtotalCents` ES la tarifa de envío).
   */
  shippingFeeCents?: number;
}

// ---- Auth / usuarios (contrato §1) ----
export interface UserDTO {
  id: string;
  email: string;
  name: string;
  phone?: string;
  role: Role;
  locale: Locale;
  kycStatus?: KycStatus;
  status?: 'active' | 'blocked';
  // v1.1 (contrato GET /users/me): proveedor de auth, verificación de email y avatar.
  authProvider?: AuthProvider;
  emailVerified?: boolean;
  avatarUrl?: string;
  // v1.3.1: lo activa el reset de contraseña por admin (M6). Si viene true tras el
  // login, el front dirige al usuario a cambiar su contraseña (o muestra aviso).
  mustChangePassword?: boolean;
}

export interface AuthResponse {
  user: UserDTO;
  accessToken: string;
  refreshToken: string;
}

// ---- Verificación de correo + recuperación self-service (contrato §1, v1.5) ----
// POST /auth/verify-email {token} → { verified: true } (422 EMAIL_VERIFY_TOKEN_INVALID).
export interface VerifyEmailResponse {
  verified: true;
}
// POST /auth/verify-email/resend (autenticado, {}) → { ok: true } (429 RATE_LIMITED).
export interface ResendVerificationResponse {
  ok: true;
}
// POST /auth/forgot-password {email} → SIEMPRE { ok: true } (anti-enumeración).
export interface ForgotPasswordResponse {
  ok: true;
}
// POST /auth/reset-password {token, password} → { ok: true }
// (422 RESET_TOKEN_INVALID, 400 VALIDATION_ERROR). NO devuelve tokens: el usuario
// re-inicia sesión con la nueva contraseña.
export interface ResetPasswordSelfResponse {
  ok: true;
}

export interface AddressDTO {
  id: string;
  line1: string;
  line2?: string;
  neighborhood?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
  isDefault?: boolean;
}

export interface KycInfoDTO {
  kycStatus: KycStatus;
  // Contrato GET /users/me/kyc devuelve la CLABE ENMASCARADA (`clabeMasked` = `****1234`),
  // nunca en claro por este endpoint.
  clabeMasked?: string;
  // v1.15-buylist-batch-clabe: booleano REAL "hay CLABE cifrada en archivo" (`Boolean(clabeEnc)`),
  // simétrico a `ineOnFile`. El front lo usa para ofrecer el atajo "usar mi CLABE ****1234" (=
  // OMITIR `clabe` en POST /buylist/requests, resuelto server-side). Si es false, se pide la CLABE.
  clabeOnFile: boolean;
  // v1.15: hay imagen de INE (frente+reverso) en archivo. El front oculta los uploaders de INE y
  // omite `ineUploadKeys`; el backend trata el INE en archivo como "provisto" para el umbral AML.
  ineOnFile: boolean;
  capPerRequestCents: number;
  capPerMonthCents: number;
  monthUsedCents: number;
}

// ---- Uploads (contrato §8 — SOLO INE de KYC) ----
// v1.2: el único propósito válido es `kyc_ine` (imagen del INE del buylist).
export type UploadPurpose = 'kyc_ine';

// Respuesta de POST /uploads/presign: el cliente hace `method` (PUT) directo al
// object storage privado con `headers`, y luego asocia `uploadKey` a la KYC/solicitud.
export interface UploadPresignResponse {
  uploadKey: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
  // Tamaño máximo (bytes) que la firma admite; fuente única de verdad de tamaño en
  // cliente (el backend fija el mismo límite en la firma). Opcional por compat.
  maxBytes?: number;
}

// Referencias de subida del INE (keys de presign) para la solicitud de buylist / KYC.
export interface IneUploadKeys {
  front: string;
  back: string;
}

// ---- Catálogo (contrato §2) ----
export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CardSetDTO {
  id: string;
  name: string;
  series?: string;
  releaseDate?: string;
  // v1.1: año derivado de releaseDate (para el filtro "Nombre (2024)").
  year?: number;
  // v1.33-master-set-multipart (P-27, aditivo/opcional): en `GET /catalog/sets` y `GET /buylist/sets`
  // un subset de un master combinado (Classic Collection `cel25c`) se PLIEGA en la fila del principal
  // (Celebrations aparece UNA sola vez) y esa entrada gana `partSetIds` = los set-ids REALES que agrupa
  // (principal + subsets). Presente SOLO en masters combinados; el dropdown filtra por TODAS las partes.
  // Un set normal lo omite (comportamiento previo intacto).
  partSetIds?: string[];
}

// v1.1: facetas dinámicas de "Compra" (contrato GET /catalog/facets).
export interface FacetSetDTO {
  id: string;
  name: string;
  releaseDate?: string;
  year?: number;
}

export interface CatalogFacetsDTO {
  rarities: string[];
  sets: FacetSetDTO[];
  productTypes: ProductType[];
  sealedSubtypes: SealedSubtype[];
  // v1.6-finish: distinct de InventoryItem.finish sobre el inventario publicado (para el filtro de acabado).
  finishes: Finish[];
  price: { minCents: number; maxCents: number; currency: 'MXN' };
}

export interface CardDetailResponse {
  card: CardDTO;
  listings: ListingDTO[];
}

// ---- Bóveda / portafolio (contrato §3) ----
export interface HoldingDTO {
  inventoryItemId: string;
  folio: string;
  card: CardDTO;
  productType: ProductType;
  rawCondition?: RawCondition;
  sealedSubtype?: SealedSubtype;
  // v1.6-finish: acabado del holding; el referenceValue es el de ESE acabado. graded/sealed → "normal".
  finish: Finish;
  gradingCompany?: GradingCompany;
  gradeValue?: string;
  // v1.2: nº de certificado PSA/CGC para gradeadas en bóveda.
  certNumber?: string;
  ownershipStatus: OwnershipStatus;
  status: InventoryStatus;
  referenceValue: PriceInfo;
  // v1.17-withdrawal-lifecycle (contrato §3): etapa del envío ACTIVO del item (derivada del join
  // InventoryItem → ShipmentItem → ShipmentRequest). `null` = sin envío activo. El front pinta el
  // badge "EN RETIRO" cuando `shipmentState !== null`. `entregado` nunca llega aquí (el item ya salió
  // de la bóveda como `withdrawn`).
  shipmentState: ShipmentActiveStage | null;
  // v1.17: id de la ShipmentRequest activa para deep-link al rastreo (GET /shipments/:id); null si no
  // hay envío activo.
  activeShipmentId: string | null;
  // v1.17: flag AUTORITATIVO para habilitar/deshabilitar RETIRAR (fuente única de verdad). `true` solo
  // si `ownershipStatus='settled' && shipmentState=null` (mismo criterio del backend). Evita descubrir
  // el 409/422 al intentar.
  withdrawable: boolean;
}

export interface PortfolioSummary {
  totalValueMxnCents: number;
  pendingPriceCount: number;
  currency: 'MXN';
}

export interface HoldingsResponse {
  data: HoldingDTO[];
  portfolio: PortfolioSummary;
}

// ---- Checkout / órdenes (contrato §4) ----
export interface OrderItemPreview {
  inventoryItemId: string;
  card: CardDTO;
  productType: ProductType;
  rawCondition?: RawCondition;
  unitPriceCents: number;
}

/**
 * v1.21.3-quote-prune — ítem de carrito podado por los DOS endpoints de QUOTE (§4 y
 * §4-G.1). SOLO quote: los endpoints de session NO lo usan (siguen estrictos).
 * `cardName` = nombre de la carta si la pieza aún existe en BD (aunque ya no esté
 * disponible); `null` si el `inventoryItemId` ya no resuelve (pieza borrada). El front
 * lo usa para el aviso «X ya no está disponible y se quitó de tu carrito» y para PODAR
 * el localStorage antes de llamar a session.
 */
export interface UnavailableCartItemDTO {
  inventoryItemId: string;
  cardName: string | null;
}

export interface CheckoutQuoteResponse {
  items: OrderItemPreview[];
  breakdown: BreakdownDTO;
  /** SIEMPRE presente (v1.21.3); `[]` cuando todo el carrito resuelve. */
  unavailableItems: UnavailableCartItemDTO[];
}

export interface CheckoutSessionResponse {
  orderId: string;
  breakdown: BreakdownDTO;
  stripe: { paymentIntentId: string; clientSecret: string };
}

export interface OrderSummaryDTO {
  id: string;
  userId?: string;
  status: OrderStatus;
  totalCents: number;
  createdAt: string;
  settledAt?: string;
}

export interface OrderDetailDTO {
  id: string;
  status: OrderStatus;
  createdAt: string;
  settledAt?: string;
  breakdown: BreakdownDTO;
  items: { inventoryItemId: string; card: CardDTO; unitPriceCents: number }[];
  cfdiStatus: CfdiStatus;
  invoiceRequested: boolean;
  stripePaymentIntentId?: string;
}

// ---- Retiros / envíos (contrato §5) ----
export interface ShipmentQuoteResponse {
  breakdown: BreakdownDTO;
  eligibleItemIds: string[];
  ineligible: { inventoryItemId: string; reason: string }[];
}

export interface ShipmentCreateResponse {
  shipmentId: string;
  status: ShipmentStatus;
  breakdown: BreakdownDTO;
  stripe: { paymentIntentId: string; clientSecret: string };
}

/**
 * Retiro/envío del cliente (contrato §5 · GET /shipments listMine y GET /shipments/:id).
 * v1.17-withdrawal-lifecycle norma y enriquece el shape (== `ClientShipmentDTO` del contrato) para
 * que el cliente rastree qué cartas van en cada retiro y su etapa/guía. Los campos enriquecidos son
 * OPCIONALES para tolerar productores/mocks parciales (p. ej. la respuesta de captura de guía en M4).
 */
export interface ShipmentDTO {
  id: string;
  status: ShipmentStatus;
  trackingNumber?: string;
  carrier?: string;
  createdAt: string;
  // v1.17: dirección MX (snapshot). Forma abierta (line1/city/state/postalCode/…); el front la lee
  // de modo defensivo. Sin PII sensible (es la dirección de envío del propio usuario).
  addressSnapshot?: AddressDTO | Record<string, unknown>;
  // v1.17: total del envío desglosado (tarifa + IVA + fee de procesamiento). No expone `shippingCostCents`
  // (costo interno del carrier).
  shippingFeeCents?: number;
  ivaCents?: number;
  processingFeeCents?: number;
  totalCents?: number;
  // v1.17: timestamps por etapa (para la línea de tiempo del rastreo). `requestedAt` == alta del retiro.
  requestedAt?: string;
  pickingAt?: string;
  shippedAt?: string;
  // WS-F F6: fecha de entrega real (backend `toClientShipment.deliveredAt`). Ancla la ventana de
  // 7 días para abrir una disputa de condición. Presente solo cuando el envío llegó a `entregado`.
  deliveredAt?: string;
  // WS-F F6: `productType` por ítem alimenta el UI-gate de disputa (graded NO aplica → 422 NOT_RAW).
  // v1.17: `finish` por ítem (acabado de la copia física). Opcional: el listado crudo puede omitir
  // `productType`/`finish`/`folio`/`card`; cuando falta, el backend es la autoridad.
  items: {
    inventoryItemId: string;
    folio: string;
    card: CardDTO;
    productType?: ProductType;
    finish?: Finish;
  }[];
}

/**
 * Fila de la COLA ADMIN de envíos (contrato §M4 · GET /admin/shipments — envíos de CLIENTES).
 * El backend devuelve la fila cruda de ShipmentRequest (incluye `requestedAt` en vez de
 * `createdAt` y `userId`); los items del listado NO traen carta/folio (solo ids).
 */
export interface AdminShipmentDTO {
  id: string;
  userId?: string;
  status: ShipmentStatus;
  carrier?: string | null;
  trackingNumber?: string | null;
  requestedAt?: string;
  createdAt?: string;
  shippingFeeCents?: number;
  totalCents?: number;
  /** Costo real pagado a la paquetería (interno, v1.4-finance). */
  shippingCostCents?: number;
  items?: { id?: string; inventoryItemId: string; folio?: string; card?: CardDTO }[];
}

// Fila de la lista de picking (contrato §M4 · GET /admin/shipments/picking-list),
// ordenada por ubicación; `location` = label plano ("C03-F02-S15" | "UNASSIGNED").
export interface PickingListEntryDTO {
  shipmentId: string;
  inventoryItemId: string;
  folio: string;
  location: string;
}

// Captura de guía en M4 (contrato §M4 · POST /admin/shipments/:id/tracking).
// shippingCostCents (v1.4-finance): costo real en centavos MXN que la plataforma
// paga a la paquetería por este envío. Opcional, entero ≥ 0. Interno (no se expone
// al cliente); alimenta el P&L de M7. Distinto de shippingFeeCents (ingreso al cliente).
export interface ShipmentTrackingRequest {
  carrier: string;
  trackingNumber: string;
  shippingCostCents?: number;
}

// ---- Buylist (contrato §6) ----
// v1.3.1: value = centavos MXN si mode=fixed; porcentaje [0,100] si mode=pct.
export interface BuylistRule {
  mode: BuylistRuleMode;
  value: number;
}
// v1.3.1: regla resuelta para la carta al cotizar. source="rule" (fila explícita de
// BUYLIST_PRICE_RULES) o "fallback" (BUYLIST_PRICE_FALLBACK_PCT).
// v1.28 §6: gana "bounty" (bounty activo ganó la oferta) y "override" (buy-override de la
// consola M-30) — aditivo, el front DEBE tolerarlos.
export interface BuylistRuleApplied {
  mode: BuylistRuleMode;
  value: number;
  source: 'rule' | 'fallback' | 'bounty' | 'override';
}

// v1.3.1: POST /buylist/quote — expone `rarity` + `appliedRule` en vez de `category`.
// v1.6-finish: la respuesta ecoa el `finish` resuelto (validado ∈ availableFinishes) y la
// `appliedRule` la selecciona el acabado (reverse holo → "Reverse Holo"; holo/1st ed → base/"Holo";
// normal → rareza base).
export interface BuylistQuoteResponse {
  rarity: string;
  finish: Finish;
  // v1.30 (§4.29): eco del `productId` (TCGplayer) cuando se cotizó un PRODUCTO SEPARADO
  // (deck_exclusive/promo, `separateProducts`). Ausente ⇒ línea de set_base (comportamiento v1.29).
  productId?: number;
  appliedRule: BuylistRuleApplied;
  quote: {
    status: 'cotizada' | 'precio_pendiente';
    quotedPriceCents: number | null;
    currency: 'MXN';
  };
  referencePrice: { status: 'priced' | 'pending'; priceMxnCents?: number };
  paymentNotice: 'PAY_AFTER_RECEIPT';
}

// ---- Cotización en LOTE (contrato §6 · POST /buylist/quote/batch, v1.15) ----
// READ-ONLY. Cotiza N cartas en 1 request (mata el fan-out FE-12). SIN `qty` — el modelo es
// UNA línea por carta física (ARCHITECTURE §4.16b). Mismos campos que el quote por-carta.
export interface BuylistQuoteItemDTO {
  cardId: string;
  productType: ProductType;
  rawCondition?: RawCondition;
  finish?: Finish;
  // v1.30 (§4.29, ADITIVO): el TCGplayer `productId` (== `CardProduct.tcgplayerProductId`, el MISMO
  // que `CardProductDTO.productId` de `separateProducts`) cuando la línea es un PRODUCTO SEPARADO
  // (deck_exclusive/promo). Presente ⇒ la línea es ESE producto (acabado ∈ `CardProduct.finishes`,
  // referencia por ese `cardProductId`, precio PROPIO). Ausente ⇒ set_base por (cardId, finish).
  productId?: number;
}

// Payload de éxito por ítem = MISMO shape que la respuesta de POST /buylist/quote por-carta.
// `rarity` puede ser null (p. ej. sellado sin rareza); el resto espeja BuylistQuoteResponse.
export interface BuylistQuotePayload {
  rarity: string | null;
  finish: Finish;
  // v1.30 (§4.29): eco del `productId` cotizado (snapshot). Ausente ⇒ línea de set_base.
  productId?: number;
  appliedRule: BuylistRuleApplied;
  quote: {
    status: 'cotizada' | 'precio_pendiente';
    quotedPriceCents: number | null;
    currency: 'MXN';
  };
  referencePrice: { status: 'priced' | 'pending'; priceMxnCents?: number };
  paymentNotice: 'PAY_AFTER_RECEIPT';
}

// Resultado por ítem: ok:true trae la cotización; ok:false trae el error de ESE ítem (NO tumba el
// lote → HTTP 200). `index` = posición 0-based en el request items[] (llave de correlación robusta
// ante cardId+finish+productId repetidos); `cardId` se ecoa. Errores por-ítem: NOT_FOUND |
// FINISH_NOT_AVAILABLE | PRODUCT_NOT_FOUND (v1.30: productId inexistente) | PRODUCT_CARD_MISMATCH
// (v1.30: productId no cuelga del cardId → rechazo validado, NUNCA fusión silenciosa con el set_base).
export type BuylistBatchQuoteResultDTO =
  | ({ index: number; cardId: string; ok: true } & BuylistQuotePayload)
  | {
      index: number;
      cardId: string;
      ok: false;
      error: {
        code: 'NOT_FOUND' | 'FINISH_NOT_AVAILABLE' | 'PRODUCT_NOT_FOUND' | 'PRODUCT_CARD_MISMATCH';
        message: string;
      };
    };

export interface BuylistBatchQuoteResponse {
  results: BuylistBatchQuoteResultDTO[];
}

// v1.3.1: `category` (BuylistCategory) REEMPLAZADO por `rarity` + `appliedRule`.
export interface SellItemDTO {
  id: string;
  card: CardDTO;
  productType: ProductType;
  rawCondition?: RawCondition;
  sealedSubtype?: SealedSubtype;
  // v1.6-finish: snapshot del acabado aplicado en la cotización/solicitud. Determina la
  // regla y la referencia usadas; se propaga al InventoryItem al convertir (M5).
  finish: Finish;
  // v1.30 (§4.29): snapshot del TCGplayer `productId` cuando el ítem es un PRODUCTO SEPARADO
  // (deck_exclusive/promo). Se propaga al InventoryItem al convertir (M5, ligado a ESE producto,
  // no al set_base). Ausente/null ⇒ línea de set_base (comportamiento actual, retrocompatible).
  productId?: number;
  rarity?: string;
  appliedRule?: BuylistRuleApplied;
  quotedPriceCents?: number;
  approvedPriceCents?: number;
  itemStatus: SellItemStatus;
  inventoryItemId?: string;
  // v1.18-buylist-rejects (contrato §11): poblados SOLO si itemStatus="rechazada"; en
  // cualquier otro status van null/omitidos. Los plazos se DERIVAN server-side de
  // rejectedAt (+7d devolución a costo del usuario / +30d abandono); legacy → null.
  // INVARIANTE: un ítem `rechazada` tiene approvedPriceCents=null (no suma en el total).
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  returnDeadlineAt?: string | null;
  abandonDeadlineAt?: string | null;
}

export interface SellRequestDTO {
  sellRequestId: string;
  status: SellRequestStatus;
  quotedTotalCents: number;
  ineRequired: boolean;
  items: SellItemDTO[];
  createdAt?: string;
}

// ---- Admin (contrato §10-11) ----
export interface DashboardDTO {
  profitPeriodCents?: number;
  salesPeriod: { count: number; amountCents: number };
  workQueue: { shipments: number; buylist: number; disputes: number; pendingPrices: number };
  inventoryValueCents?: number;
  custodyValueCents?: number;
  buylistPeriod: { count: number; amountCents: number };
  dataHealth: { pendingPriceCount: number; lastPriceSyncAt?: string; lastFxAt?: string };
  launchProgress: {
    users: number;
    salesSettled: number;
    buylistPaid: number;
    withdrawalsNoDispute: number;
  };
}

export interface InventoryItemDTO {
  id: string;
  folio: string;
  card: CardDTO;
  productType: ProductType;
  rawCondition?: RawCondition;
  sealedSubtype?: SealedSubtype;
  // v1.23-sealed-sales: condición del sellado (mint|minor_box_damage); solo productType='sealed'.
  sealedCondition?: SealedCondition;
  // v1.6-finish: acabado de la copia física (M1). graded/sealed → "normal".
  finish?: Finish;
  gradingCompany?: GradingCompany;
  gradeValue?: string;
  // v1.2: nº de certificado PSA/CGC (requerido para publicar una gradeada).
  certNumber?: string;
  status: InventoryStatus;
  ownerType: OwnerType;
  location?: { id: string; label: string; zone: VaultZone };
  referenceValue?: PriceInfo;
  listPriceCents?: number;
  acquisitionType?: AcquisitionType;
  acquisitionCostCents?: number;
}

export interface VaultLocationDTO {
  id: string;
  zone: VaultZone;
  box: string;
  row: string;
  slot: string;
  label: string;
}

// Motivo del movimiento de bóveda (enum MovementReason del backend; ARCHITECTURE/prisma).
// v1.20: `adjustment` = ajuste por levantamiento físico desde el binder M1 (M-24).
export type MovementReason =
  | 'alta'
  | 'move'
  | 'sale'
  | 'settle'
  | 'chargeback_return'
  | 'withdrawal'
  | 'lost'
  | 'damaged'
  | 'buylist_convert'
  | 'adjustment';

// Historial de movimientos de un item (contrato §M1 · GET /admin/inventory/items/:id:
// "detalle + historial de movimientos"). El backend devuelve los InventoryMovement
// ordenados por createdAt desc.
export interface InventoryMovementDTO {
  id: string;
  fromLocationId?: string | null;
  toLocationId?: string | null;
  fromStatus?: InventoryStatus | null;
  toStatus?: InventoryStatus | null;
  reason: MovementReason;
  actorUserId?: string | null;
  note?: string | null;
  createdAt: string;
}

// Detalle por pieza del back-office (GET /admin/inventory/items/:id): el item + movimientos.
export interface AdminInventoryItemDetailDTO extends InventoryItemDTO {
  movements: InventoryMovementDTO[];
}

// ===== v1.16-master-set: Master Set + inventario a escala (§M1) =====
// Índice de sets (GET /admin/inventory/master-sets). Agregación SOLO de inventario de PLATAFORMA.
// `catalogCardCount` = nº de Card del catálogo con ese setId (puede EXCEDER printedTotal por
// secret/hyper rares). `distinctCardsOwned` = cartas DISTINTAS del set con ≥1 pieza on-hand.
// `completionPct` = distinctCardsOwned / catalogCardCount × 100 (null si catalogCardCount=0).
// `totalPieces` = conteo de InventoryItem on-hand del set (on-hand = platform AND status NOT IN
// (withdrawn, shipped, delivered, lost, damaged)).
export interface MasterSetSummaryDTO {
  setId: string;
  name: string;
  series?: string;
  releaseDate?: string;
  year?: number;
  printedTotal?: number;
  catalogCardCount: number;
  distinctCardsOwned: number;
  completionPct: number | null;
  totalPieces: number;
  // ===== v1.20-master-set-everywhere (aditivo): completitud por VARIANTE (carta+acabado) =====
  // catalogVariantCount = Σ |availableFinishes| de las cartas del set (universo de variantes).
  // distinctVariantsOwned = variantes del universo con ≥1 pieza en el scope.
  // variantCompletionPct = distinctVariantsOwned / catalogVariantCount × 100 (null si universo=0).
  // Los contadores de UI «X/Y» usan ESTOS campos (variantes), no los de carta (compat v1.16).
  catalogVariantCount: number;
  distinctVariantsOwned: number;
  variantCompletionPct: number | null;
  // v1.33-master-set-multipart (P-27, §4.31c, aditivo/opcional): en el índice los subset de un grupo
  // se PLIEGAN en la fila del principal (no aparecen como filas propias) y TODOS los agregados
  // (catalogCardCount, catalogVariantCount, distinctCardsOwned, distinctVariantsOwned, totalPieces) se
  // SUMAN sobre las partes; completionPct/variantCompletionPct se recomputan sobre esos totales (→ 50).
  // `partSetIds` = los set-ids REALES plegados (principal + subsets); presente SOLO en masters
  // combinados. Un set normal lo omite. Sirve para que el front marque "combinado" / filtre por partes.
  partSetIds?: string[];
}

// Ordenamiento del índice (contrato §M1). `release_desc` es el default.
export type MasterSetSort = 'release_desc' | 'completion_asc' | 'pieces_desc';

// v1.20: alcance de la vista master set — inventario de PLATAFORMA (M1) vs bóveda de UN usuario.
export type MasterSetScope = 'platform' | 'user_vault';

// v1.20: dueño de la bóveda (solo scope user_vault). `email` SOLO en la vista admin (ii);
// en la vista (iii) del propio cliente se omite.
export interface VaultOwnerRefDTO {
  userId: string;
  name: string;
  email?: string;
}

// v1.20: variante = (carta, acabado) con finish ∈ Card.availableFinishes (universo esperado).
// `covered` = ≥1 pieza en el scope para ese (cardId, finish). `buyable` SOLO scope cliente (iii)
// y SOLO cuando covered=false: la pieza `listed` de plataforma MÁS BARATA de ese (cardId, finish),
// o null si no hay inventario publicado. En scopes admin el campo se OMITE.
export interface MasterSetVariantDTO {
  finish: Finish;
  count: number;
  covered: boolean;
  buyable?: { inventoryItemId: string; salePriceCents: number } | null;
  // SOLO mode="quoter" (frontend, WS-cotizador): NO viaja del backend en ningún endpoint del
  // contrato — el cotizador compone este campo 100% client-side a partir de POST
  // /buylist/quote/batch (mismo shape que BuylistQuoteResponse) para reusar el binder de
  // Master Set como grid de cotización. `covered` en este modo significa "cotización resuelta"
  // (no "en inventario"); null = la combinación (carta, acabado) no cotizó (NOT_FOUND/
  // FINISH_NOT_AVAILABLE — no debería ocurrir si `finish` viene de availableFinishes).
  quote?: {
    status: 'cotizada' | 'precio_pendiente';
    quotedPriceCents: number | null;
    rarity: string | null;
    appliedRule: BuylistRuleApplied;
    referencePrice: { status: 'priced' | 'pending'; priceMxnCents?: number };
  } | null;
  // v1.22-2-finish-display (N-16): espejo de conveniencia = (finish ∈ displayFinishes de la celda).
  // Es la variante que el render PLANO pinta (una tarjeta por variante `displayed===true`). Opcional
  // por resiliencia: si el backend aún no lo emite, el front deriva `finish ∈ displayFinishesOf(cell)`
  // (helper `isVariantDisplayed` en @/lib/finish). Las variantes con `displayed===false` NO se pintan
  // pero SÍ cuentan en los contadores de completitud (expected/coveredVariantCount, sobre availableFinishes).
  displayed?: boolean;
  // v1.27 (P-15, ADITIVO): precio de MERCADO PROPIO de la variante — PriceReference vigente de
  // (cardId, 'raw', 'raw:NM', ESTE finish), FX-recomputada a MXN cents server-side. NO es el
  // precio de venta derivado (ese vive en `buyable.salePriceCents`, solo vista (iii) cliente).
  // `null` = referencia pending/ausente (NUNCA un 0 inventado; el front pinta "—").
  // `undefined` = backend rezagado que aún no emite el campo → fallback TEMPORAL al campo de
  // celda deprecado (retrocompatibilidad durante el deploy; se retira con el campo de celda).
  marketReferenceMxnCents?: number | null;
  // v1.27 (P-15): fecha de captura (ISO) de la PriceReference de ESTA variante — decoración de
  // frescura; presente solo cuando marketReferenceMxnCents != null. El front tolera su ausencia.
  capturedDate?: string | null;
  // v1.28 (P-18, ADITIVO): CONSOLA de precios de la variante (compra/venta: sugerido por regla,
  // override vigente, efectivo resuelto + fuente; bounty P-22). Presente SOLO en scope `platform`
  // (M1) — en `user_vault` y «Mi bóveda» se OMITE SIEMPRE (la estrategia de compra/bounty no se
  // filtra al cliente). `null` en cifras = no resoluble (money-safe, nunca 0 inventado).
  pricing?: VariantPricingDTO;
}

// ===== v1.28 Stream B (P-18/P-22): consola de tres precios por (carta, variante) =====
// `suggestedCents` = lo que da la regla HOY (buylist/sales rules sobre la referencia del acabado);
// `overrideCents` = override manual persistido (VariantPriceOverride, M-30); `effectiveCents` =
// precio RESUELTO con la precedencia normativa (ARCHITECTURE §4.26b); `source` = qué peldaño ganó.
export interface VariantPriceFaceDTO<TSource extends string> {
  suggestedCents: number | null;
  overrideCents: number | null;
  effectiveCents: number | null;
  source: TSource;
}

export type VariantBuySource = 'bounty' | 'override' | 'rule' | 'fallback' | 'pending';
export type VariantSellSource = 'override' | 'rule' | 'fallback' | 'pending';

// Estado del bounty (P-22) para la edición en consola. Viene solo si existe fila M-30.
export interface VariantBountyDTO {
  enabled: boolean;
  priceCents: number | null;
  targetQty: number | null;
  acquiredQty: number;
  completedAt: string | null;
}

export interface VariantPricingDTO {
  buy: VariantPriceFaceDTO<VariantBuySource>;
  sell: VariantPriceFaceDTO<VariantSellSource>;
  bounty?: VariantBountyDTO | null;
}

// PUT /admin/pricing/variant-controls/:cardId/:finish (super_admin, auditado). Campos omitidos NO
// se tocan; `null` explícito LIMPIA (quitar un override regresa la cara a su regla; `bounty:null`
// o `enabled:false` apaga el bounty sin borrar el contador). Errores propios: 422
// BOUNTY_PRICE_REQUIRED (enabled sin priceCents>0), 422 BOUNTY_BELOW_RULE (priceCents < sugerido
// de compra cuando este resuelve), 422 FINISH_NOT_AVAILABLE, 422 VALIDATION_ERROR (sealed /
// bounty en graded / centavos <= 0).
export interface VariantControlsRequest {
  productType?: 'raw' | 'graded';
  gradeKey?: string;
  sellOverrideCents?: number | null;
  buyOverrideCents?: number | null;
  bounty?: { enabled: boolean; priceCents?: number; targetQty?: number | null } | null;
}

export interface VariantControlsResponse {
  cardId: string;
  productType: 'raw' | 'graded';
  gradeKey: string;
  finish: Finish;
  // Estado RESUELTO tras el write — mismo DTO que lee el binder.
  pricing: VariantPricingDTO;
}

export interface MasterSetIndexResponse {
  data: MasterSetSummaryDTO[];
  page: number;
  pageSize: number;
  total: number;
  // v1.20 (aditivo): scope de la agregación + dueño (solo user_vault).
  scope: MasterSetScope;
  owner?: VaultOwnerRefDTO;
}

// Celda del binder (GET /admin/inventory/master-sets/:setId). Una por Card del catálogo del set.
// `number` = Card.number crudo (String, p. ej. "4", "SV107", "TG12"). `numberSort` = CLAVE NUMÉRICA
// derivada SERVER-SIDE para el orden natural estable — el front NO re-ordena por número, confía en el
// orden natural del backend (numéricos por valor entero primero; promos/subsets con prefijo alfabético
// al final).
// v1.22-variantes-orden: `numberSort`/`numberPrefix` son COLUMNAS de `Card` (M-26) y el servidor ya
// ordena por ellas. El front las usa SOLO para re-ordenar localmente tras filtrar, con el comparador
// (numberPrefix asc, numberSort asc, number asc) — ver `@/lib/cardOrder`. `numberSort` solo NO basta
// (`TG12` y `GG12` colisionan en el sentinela), por eso la celda gana `numberPrefix`.
// `countsByFinish` = piezas on-hand por acabado (solo acabados con ≥1 pieza); `totalCount` =
// suma. `totalCount=0` = HUECO de inventario. `isSecretRare` = heurística SOLO de display (número
// puramente numérico cuyo entero > printedTotal); los promos/subsets con prefijo NO son secret rare.
export interface MasterSetCellCountDTO {
  finish: Finish;
  count: number;
}

// ===== v1.29 (ARCHITECTURE §4.27) — «1 carta ↔ N productos» =====
// Un CardProductDTO = UN producto TCGplayer (== un productId) bajo esta carta. Los productos de
// set (kind="set_base") ya alimentan `availableFinishes`/`variants` de la celda; los productos
// kind ∈ {deck_exclusive, promo} se exponen APARTE (`separateProducts`) como productos
// vendibles/cotizables PROPIOS con su PROPIO precio por acabado. `marketReferenceMxnCents` = null
// cuando no hay precio en ninguna fuente ("—", NUNCA 0 inventado — money-safe, P-1).
export type CardProductKind = 'set_base' | 'deck_exclusive' | 'promo' | 'other';
export interface CardProductPriceDTO {
  finish: Finish;
  marketReferenceMxnCents: number | null;
  capturedDate?: string | null;
}
export interface CardProductDTO {
  productId: number;
  kind: CardProductKind;
  name: string;
  finishes: Finish[];
  prices: CardProductPriceDTO[];
}

export interface MasterSetCardCellDTO {
  cardId: string;
  number: string;
  // Opcionales en el TIPO por la misma razón que en CardDTO (ver arriba): `@/lib/cardOrder` deriva
  // la clave equivalente en cliente si el backend todavía no las manda.
  numberSort?: number;
  /** v1.22 (aditivo): "" = número puramente numérico; "TG"/"SV"/"GG"… = promo/subset (va al final). */
  numberPrefix?: string;
  name: string;
  rarity?: string;
  imageSmallUrl?: string;
  availableFinishes: Finish[];
  // v1.22-2-finish-display (N-15/N-16): acabados a PINTAR de esta celda (⊆ availableFinishes, orden
  // FINISH_ORDER, nunca vacío). El render PLANO expande la celda en UNA tarjeta por cada displayFinish
  // (equiv. `variants[].displayed===true`). Opcional por resiliencia: fallback a `availableFinishes`.
  displayFinishes?: Finish[];
  countsByFinish: MasterSetCellCountDTO[];
  totalCount: number;
  isSecretRare: boolean;
  // ===== v1.20 (aditivo): casillas POR ACABADO =====
  // `variants` trae EXACTAMENTE una entrada por acabado de availableFinishes (orden del enum
  // Finish). NOTA compat: countsByFinish (v1.16) se CONSERVA y puede traer acabados FUERA del
  // universo (drift de catálogo); esas piezas se ven pero NO cuentan en expected/covered.
  expectedVariantCount: number;
  coveredVariantCount: number;
  variants: MasterSetVariantDTO[];
  // v1.26 (P-2, §M1): precio de MERCADO de la carta (PriceReference CRUDA del acabado base, ya
  // FX-recomputada a MXN cents server-side). NO es el precio de venta (referencia × markup); es el
  // input de mercado que alimenta las reglas. `null`/ausente = referencia pending o inexistente:
  // el front pinta un affordance "precio pendiente" (un "—" discreto), NUNCA $0 (money-safe, P-1).
  // ⚠️ DEPRECATED v1.27 (P-15): el precio de mercado se movió al nivel VARIANTE
  // (`variants[].marketReferenceMxnCents`). El backend lo conserva UNA versión como espejo de la
  // variante del acabado base (= variants[0].marketReferenceMxnCents) para lectores rezagados;
  // el front NO debe leerlo más salvo como fallback temporal cuando la variante no trae el campo.
  // Se retira en la siguiente rev de contrato.
  marketReferenceMxnCents?: number | null;
  // v1.29 (§4.27): productos vendibles SEPARADOS de esta carta — SOLO los kind ∈
  // {deck_exclusive, promo} (los set_base ya están en `variants`). Ausente/[] cuando la carta no
  // tiene productos separados (el caso común). Cada uno se pinta como SU PROPIO producto con su
  // propio precio por acabado; NO se fusionan en la carta base.
  separateProducts?: CardProductDTO[];
  // ===== v1.33-master-set-multipart (P-27, §4.31, aditivo/opcional) =====
  // A qué parte REAL pertenece esta carta (su `CardSet` local: `cel25` o `cel25c`) y la etiqueta del
  // bloque ("Classic Collection"). Presentes SOLO en un master COMBINADO (cuando el binder trae `parts`);
  // el front agrupa las celdas por `partSetId` y pinta el separador con `partLabel`. En un set normal se
  // OMITEN (la celda es del único set). NO cambian la identidad: `cardId` sigue llaveado a su set real
  // (money-safe). Ver ARCHITECTURE §4.31b.
  partSetId?: string;
  partLabel?: string;
}

// v1.33-master-set-multipart (P-27, §4.31): una PARTE de un master combinado (principal o subset).
// El binder trae una entrada por parte importada, en orden de bloque (principal `isPrimary=true`,
// `order=0`; subsets por su `order`). `label` = etiqueta del separador ("Classic Collection"); en el
// principal `label` = su propio `name`. `catalogCardCount` = nº de Card de ESE set-id (desglose por
// bloque). Presente SOLO en masters combinados (≥2 partes).
export interface SetPartDTO {
  setId: string;
  name: string;
  label?: string;
  isPrimary: boolean;
  order: number;
  catalogCardCount: number;
}

export interface MasterSetBinderResponse {
  set: SetRefDTO;
  printedTotal: number | null;
  catalogCardCount: number;
  cells: MasterSetCardCellDTO[];
  // v1.20 (aditivo): scope de la agregación + dueño (solo user_vault).
  scope: MasterSetScope;
  owner?: VaultOwnerRefDTO;
  // ===== v1.33-master-set-multipart (P-27, §4.31, aditivo/opcional) =====
  // `parts` presente SOLO cuando el set es un master COMBINADO (≥2 partes): una entrada por parte,
  // en orden de bloque. `set` = SetRefDTO del PRINCIPAL (nombre del master = "Celebrations"), y
  // `catalogCardCount`/`printedTotal` = Σ de TODAS las partes (Celebrations = 50). Las celdas llegan
  // con `partSetId`/`partLabel` y en orden de bloque (principal primero, luego cada subset; orden
  // natural DENTRO del bloque). `canonicalSetId` presente SOLO cuando el `:setId` pedido era un SUBSET
  // y se normalizó a su principal (el front actualiza la URL/navegación; evita el binder roto de 25).
  // Un set normal omite ambos. Ver ARCHITECTURE §4.31b.
  parts?: SetPartDTO[];
  canonicalSetId?: string;
}

// ===== v1.28 Stream B (P-19): POST /admin/inventory/publish-all =====
// Publica TODO lo `in_stock` de plataforma (± setId/productType) con selección server-side (sin
// cap) y pipeline por-pieza IDÉNTICO a bulk-publish (precio server-side SEC-A1, precedencia
// listPrice > sellOverride > regla; sellado por H-1). Una pieza sin precio resoluble ESCALA a la
// cola (context='inventory') y NO se publica; `listed` = no-op idempotente. Tolerante por-ítem.
export interface PublishAllRequest {
  batchKey?: string;
  setId?: string;
  productType?: ProductType;
}

export interface PublishAllFailureDTO {
  inventoryItemId: string;
  folio: string;
  error: { code: string; message: string };
  // Deep-link a la cola M2 cuando la línea escaló a pendiente de precio (opcional).
  pendingPriceEntryId?: string;
}

export interface PublishAllResponse {
  batchKey?: string;
  idempotentReplay: boolean;
  summary: {
    selected: number;
    published: number;
    alreadyListed: number;
    pendingPrice: number;
    failed: number;
  };
  // CAPADO a 200 líneas — el remanente se opera por GET /admin/pricing/pending?context=inventory.
  failures: PublishAllFailureDTO[];
}

// ===== v1.28 Stream B (P-25): pestaña «Sellado» POR SET =====
// GET /admin/inventory/sealed-sets — índice: sets con ≥1 pieza sellada de plataforma.
// `marketValueMxnCents` = Σ sealedMarketRef de piezas mapeadas (null si ninguna valuable — nunca
// 0 inventado); las sin mercado cuentan en `unmappedCount`. `unmappedTotal` = global (badge cola).
export interface SealedSetSummaryDTO {
  set: SetRefDTO;
  pieceCount: number;
  listedCount: number;
  unmappedCount: number;
  marketValueMxnCents: number | null;
}

export interface SealedSetsResponse {
  data: SealedSetSummaryDTO[];
  page: number;
  pageSize: number;
  total: number;
  unmappedTotal: number;
}

// GET /admin/inventory/sealed-sets/:setId — grupos del set (identidad §4.23:
// cardId ancla + sealedSubtype + tcgplayerProductId + sealedCondition).
export interface SealedInventoryGroupDTO {
  cardId: string;
  /** Card.name del ancla (nombre del producto). */
  productName: string;
  sealedSubtype: SealedSubtype | null;
  sealedCondition: SealedCondition;
  tcgplayerProductId: number | null;
  mapped: boolean;
  counts: { inStock: number; listed: number; other: number };
  sealedMarketRef?: PriceInfo;
  /** Costo agregado (solo lo pinta el front para super_admin). */
  totalCostCents: number | null;
}

export interface SealedSetDetailResponse {
  set: SetRefDTO;
  groups: SealedInventoryGroupDTO[];
}

// ===== v1.28 Stream B (P-20): pestaña «Gradeadas» =====
// GET /admin/inventory/graded — agregado por (cardId, gradingCompany, gradeValue).
// `marketReferenceMxnCents` = PriceReference de (cardId,'graded','graded:<company>:<grade>',
// 'normal'), típicamente MANUAL (override de mercado M2); `null` honesto si no hay.
export interface GradedInventoryGroupDTO {
  cardId: string;
  card: { name: string; number: string; setName: string; imageSmallUrl?: string };
  gradingCompany: GradingCompany;
  gradeValue: string;
  count: number;
  marketReferenceMxnCents: number | null;
  capturedDate?: string | null;
  totalCostCents: number | null;
}

export interface GradedInventoryResponse {
  data: GradedInventoryGroupDTO[];
  page: number;
  pageSize: number;
  total: number;
}

// ===== v1.28 Stream B (P-22): GET /buylist/bounties (público, read-only) =====
// Bounties ACTIVOS orden bountyPriceCents desc, cap 50 (vitrina, sin paginación).
// `remainingQty` = targetQty − acquiredQty (piso 0; null sin objetivo) — dato motivacional, no
// compromiso contractual de compra (el flujo de venta sigue siendo el normal).
export interface PublicBountyDTO {
  cardId: string;
  name: string;
  number: string;
  setName: string;
  imageSmallUrl?: string;
  rarity?: string;
  finish: Finish;
  bountyPriceCents: number;
  targetQty: number | null;
  remainingQty: number | null;
}

export interface PublicBountiesResponse {
  data: PublicBountyDTO[];
}

// ===== v1.20: lista de clientes con bóveda (GET /admin/vaults, `vault_operator+`) =====
// totalValueMxnCents usa la MISMA base de valuación del portafolio (§3): referencia vigente del
// ACABADO de cada pieza; piezas sin precio se EXCLUYEN del total y se cuentan en pendingPriceCount.
export interface AdminVaultSummaryDTO {
  userId: string;
  name: string;
  email: string;
  pieceCount: number;
  totalValueMxnCents: number;
  pendingPriceCount: number;
}

export type AdminVaultSort = 'value_desc' | 'pieces_desc' | 'name_asc';

export interface AdminVaultListResponse {
  data: AdminVaultSummaryDTO[];
  page: number;
  pageSize: number;
  total: number;
}

// ===== v1.20: ajuste de inventario por levantamiento físico (POST /admin/inventory/adjustments) =====
// Motivo OBLIGATORIO. Modelo POR-PIEZA (sin delta numérico): `encontrada` CREA pieza(s) nuevas
// (reusa BatchInventoryItemInput; acquisitionType default `aportacion_en_especie`; qty default 1,
// graded fuerza 1); los otros tres motivos operan UNA pieza existente y `note` es OBLIGATORIA.
// Estado resultante: encontrada → in_stock · perdida → lost · danada → damaged ·
// error_captura → withdrawn (NUNCA existió físicamente; NO cuenta como pérdida/reposición).
// Solo piezas ownerType=platform con status ∈ {in_stock, listed} son ajustables
// (422 ITEM_NOT_ADJUSTABLE en el resto). NO hay venta directa manual desde el binder.
export type AdjustmentReason = 'encontrada' | 'perdida' | 'danada' | 'error_captura';

// v1.20.1 — `batchKey?` SOLO en la rama `encontrada`: MISMA idempotencia que el alta por lote
// (mismo batchKey → no re-crea piezas ni filas de ajuste; el replay devuelve la respuesta original
// guardada con idempotentReplay:true y 200). El front DEBE enviarlo desde el drawer de ajuste
// (anti doble-submit). Los otros motivos NO lo aceptan (400 VALIDATION_ERROR si viaja): operan una
// pieza existente por id y su replay cae en 422 ITEM_NOT_ADJUSTABLE (idempotencia natural).
export type InventoryAdjustmentRequest =
  | { reason: 'perdida' | 'danada' | 'error_captura'; inventoryItemId: string; note: string }
  | { reason: 'encontrada'; item: BatchInventoryItemInput; note?: string; batchKey?: string };

// v1.20.1 — `adjustmentIds` SUSTITUYE al singular `adjustmentId` (eliminado sin deprecated).
// Con `encontrada` y qty>1 hay N filas InventoryAdjustment (una por pieza): se devuelven TODAS,
// alineadas 1:1 con inventoryItemIds/folios. Con los otros motivos, arrays de longitud 1.
// `idempotentReplay`: true SOLO cuando un batchKey ya procesado repite la respuesta guardada;
// false en todo procesamiento nuevo (y siempre false sin batchKey / en motivos ≠ encontrada).
export interface InventoryAdjustmentResponse {
  adjustmentIds: string[];
  reason: AdjustmentReason;
  inventoryItemIds: string[];
  folios: string[];
  fromStatus: InventoryStatus | null;
  toStatus: InventoryStatus;
  idempotentReplay: boolean;
}

// ===== P-29 «baja rápida» — POST /admin/inventory/items/bulk-remove (backend implementado) =====
// Da de baja N piezas de UNA misma variante (carta + acabado, o carta + sellado) de un golpe, como
// atajo SIMÉTRICO al alta rápida por lote (POST .../items/batch). La operación es ATÓMICA: o baja
// las `quantity` completas o no baja ninguna (422 INSUFFICIENT_STOCK con `{ available, requested }`).
// `reason` es OBLIGATORIO (encontrada NO aplica a una baja). `note` es OBLIGATORIO y no-vacío
// (motivo/nota de texto libre de la baja; sin él ⇒ 400 VALIDATION_ERROR). `batchKey?` (v1.35) da
// idempotencia: mismo batchKey tras un reintento → NO re-baja; el replay devuelve la respuesta
// original guardada con `idempotentReplay:true` (mismo 200). Sin batchKey → idempotentReplay:false.
export type RemoveReason = 'perdida' | 'danada' | 'error_captura';

export interface BulkRemoveInventoryRequest {
  cardId: string;
  finish: Finish;
  quantity: number;
  reason: RemoveReason;
  note: string;
  batchKey?: string;
  productType?: 'raw' | 'sealed';
  rawCondition?: RawCondition;
  sealedCondition?: SealedCondition;
}

export interface BulkRemoveInventoryResponse {
  batchKey?: string;
  idempotentReplay: boolean;
  removed: number;
  requested: number;
  reason: RemoveReason;
  toStatus: InventoryStatus;
  inventoryItemIds: string[];
  folios: string[];
  adjustmentIds: string[];
}

// ----- Alta por LOTE (POST /admin/inventory/items/batch) -----
// Una línea = una intención de alta; `qty` (default 1) es un ATAJO que el backend expande a N
// InventoryItem (N piezas físicas, N folios) para bulk raw/sellado. graded → qty forzado a 1.
// Los demás campos = MISMOS que POST /admin/inventory/items.
export interface BatchInventoryItemInput {
  cardId: string;
  productType: ProductType;
  rawCondition?: RawCondition;
  finish?: Finish;
  sealedSubtype?: SealedSubtype;
  // v1.23-sealed-sales: condición del sellado (default `mint`; solo productType='sealed').
  sealedCondition?: SealedCondition;
  gradingCompany?: GradingCompany;
  gradeValue?: string;
  certNumber?: string;
  // v1.28 (P-19): `locationId` es OPCIONAL en el contrato (una pieza puede nacer sin ubicación).
  locationId?: string;
  acquisitionType: AcquisitionType;
  acquisitionPct?: number;
  // v1.28 (P-19): costo capturado para acquisitionType="compra" — el campo del camino «Comprar»
  // del alta rápida (prellenado con pricing.buy.effectiveCents, editable).
  acquisitionCostCents?: number;
  listPriceCents?: number;
  qty?: number;
}

// cap items = 200. También acepta header `Idempotency-Key` (equivalente a `batchKey`).
export interface BatchCreateInventoryRequest {
  batchKey: string;
  items: BatchInventoryItemInput[];
}

// Resultado por línea: ok:true crea qty piezas (devuelve sus folios); ok:false trae el error de ESA
// línea (NO tumba las demás → HTTP 200). `index` = posición 0-based en items[].
export type BatchInventoryLineResult =
  | {
      index: number;
      ok: true;
      folios: string[];
      inventoryItemIds: string[];
      acquisitionCostCents?: number;
    }
  | { index: number; ok: false; error: { code: string; message: string } };

// `idempotentReplay` = true si el batchKey ya se había procesado (se REPITE el resultado guardado).
export interface BatchCreateInventoryResponse {
  batchKey: string;
  idempotentReplay: boolean;
  summary: { requested: number; createdItems: number; failedLines: number };
  results: BatchInventoryLineResult[];
}

// ----- Publicar por LOTE (POST /admin/inventory/items/bulk-publish) -----
// `listPriceCents` omitido → precio DERIVADO server-side de las reglas de venta por rareza+acabado
// (§4.14, SEC-A1); presente → override manual. Status de origen publicable = { in_stock, listed }:
// in_stock → publica; listed → no-op idempotente; cualquier otro → 422 ITEM_NOT_PUBLISHABLE por-línea.
// Una pieza cuyo precio no se resuelve (pct sin market) → PRICE_PENDING por-línea (no se publica).
export interface BulkPublishLineInput {
  inventoryItemId: string;
  listPriceCents?: number;
}

// cap items = 200.
export interface BulkPublishRequest {
  batchKey?: string;
  items: BulkPublishLineInput[];
  // v1.26 (P-7, §M1): si `true`, ANTES de resolver el precio el backend refresca la PriceReference
  // con un fetch on-demand por carta (sobre inventario UNPUBLISHED `in_stock`) y luego publica.
  // Hereda el gate ④: una variante aún sin precio tras el refresh NO se publica — ESCALA a la cola
  // de precios pendientes (línea `ok:false` code=`PRICE_PENDING`, con `pendingPriceEntryId?`).
  // Opcional; omitirlo (o `false`) = publicación normal, sin refresco (compat: no afecta llamadas previas).
  repriceFresh?: boolean;
}

export type BulkPublishLineResult =
  | {
      index: number;
      inventoryItemId: string;
      ok: true;
      status: 'listed';
      salePriceCents: number;
      priceSource: 'manual' | 'derived';
    }
  | {
      index: number;
      inventoryItemId: string;
      ok: false;
      error: { code: string; message: string };
      // v1.26 (④, §M1): id de la PendingPriceEntry escalada cuando la línea falla `PRICE_PENDING`
      // (variante sin precio resoluble tras el reprice). ADITIVO/opcional — deep-link de UI a M2.
      pendingPriceEntryId?: string;
    };

export interface BulkPublishResponse {
  summary: { requested: number; published: number; failedLines: number };
  results: BulkPublishLineResult[];
}

// v1.18-buylist-rejects (contrato §11): identidad del vendedor en M5. El correo es dato
// de contacto operativo de back-office (roles vault_operator/super_admin) — NO es la
// CLABE: sin enmascarado ni reveal auditado. seller.id === SellRequest.userId (compat).
export interface AdminSellerRef {
  id: string;
  name: string;
  email: string;
}

export interface AdminBuylistDTO {
  id: string;
  userId: string;
  // v1.18-buylist-rejects: identidad legible del vendedor (join a User). Opcional por
  // tolerancia a filas sin join; la UI cae a `userId` cuando falta.
  seller?: AdminSellerRef;
  status: SellRequestStatus;
  quotedTotalCents: number;
  // Total recomputado por el backend EXCLUYENDO ítems rechazados (invariante v1.18).
  // SEC-A1: la UI solo lo muestra, nunca lo calcula.
  approvedTotalCents?: number;
  createdAt: string;
  items: SellItemDTO[];
}

// v1.18-buylist-rejects (contrato §M5/§11): fila de GET /admin/buylist/rejected-items
// (pestaña «Rechazadas», transversal a solicitudes). `reason` = rejectionReason. La
// "fase" (devolución / abandono / vencida) la deriva el FRONT de now vs las fechas.
export interface RejectedSellItemDTO {
  id: string;
  sellRequestId: string;
  seller?: AdminSellerRef;
  card: CardDTO;
  productType: ProductType;
  finish: Finish;
  quotedPriceCents?: number;
  reason: string | null;
  rejectedAt: string | null;
  returnDeadlineAt: string | null;
  abandonDeadlineAt: string | null;
}

export interface AdminOrderDTO extends OrderSummaryDTO {
  breakdown?: BreakdownDTO;
  cfdiStatus?: CfdiStatus;
}

// POST /admin/orders/:id/refund (contrato §M3, super_admin, money-out).
export interface RefundOrderResponse {
  orderId: string;
  status: 'refunded';
  refundId: string;
}

// ---- M5: acciones admin de buylist (contrato §M5) ----
// GET /admin/buylist/:id/reveal-clabe (super_admin, money-out, auditado): ÚNICO punto
// del contrato que devuelve la CLABE en claro. No debe persistirse en estado global.
export interface RevealClabeResponse {
  sellRequestId: string;
  clabe: string;
}

// PATCH /admin/buylist/items/:itemId/decision — cherry-pick por carta.
// v1.18-buylist-rejects: `reason` OBLIGATORIO con reject (3–500 chars; el backend
// responde 400 VALIDATION_ERROR si falta). Para approve/adjust se ignora.
export interface BuylistItemDecisionInput {
  decision: 'approve' | 'adjust' | 'reject';
  approvedPriceCents?: number;
  reason?: string;
}

// POST /admin/buylist/items/:itemId/convert-to-inventory. `alreadyConverted` cuando el
// item ya tenía InventoryItem (idempotencia backend); `folio` solo en la conversión nueva.
export interface ConvertToInventoryResponse {
  inventoryItemId?: string;
  folio?: string;
  alreadyConverted?: boolean;
}

// POST /admin/disputes/:id/resolve (contrato §M8). repurchase = super_admin (money-out).
export interface ResolveDisputeInput {
  resolution: 'repurchase' | 'reject';
  note: string;
}

export interface DisputeDTO {
  id: string;
  status: DisputeStatus;
  // v1.2: tipo derivado server-side (condition_raw | condition_sealed); graded no aplica.
  type?: DisputeType;
  description?: string;
  createdAt: string;
  deadlineAt?: string;
  // v1.2: la evidencia se envía por correo a soporte; el correo viene del contrato (no hardcodear).
  evidenceContact?: string;
  item?: {
    inventoryItemId: string;
    folio: string;
    card: CardDTO;
    // Para gradeadas el detalle admin expone empresa + grado + certNumber (base de resolución).
    productType?: ProductType;
    gradingCompany?: GradingCompany;
    gradeValue?: string;
    certNumber?: string;
  };
}

// ---- Disputas del CLIENTE (contrato §7) ----
// WS-F F6. Forma CLIENTE (distinta del DisputeDTO admin): incluye `deadlineAt` (ventana de 7 días)
// y `evidenceContact` (correo de soporte donde el cliente envía la evidencia, v1.2). El `type` lo
// deriva server-side del productType del ítem (el cliente NO lo envía).
export interface CreateDisputeInput {
  inventoryItemId: string;
  description: string;
}

// Respuesta 201 de POST /disputes. `evidenceContact` alimenta el componente DisputeEvidenceContact.
export interface CreateDisputeResponse {
  disputeId: string;
  status: DisputeStatus;
  type: DisputeType;
  deadlineAt: string;
  evidenceContact: string;
}

// Fila de GET /disputes / GET /disputes/:id (cliente). El listado crudo del backend NO trae
// `evidenceContact` (solo la creación lo devuelve), por eso es opcional aquí.
export interface ClientDisputeDTO {
  id: string;
  inventoryItemId: string;
  type?: DisputeType;
  status: DisputeStatus;
  description?: string;
  deadlineAt?: string;
  evidenceContact?: string;
  resolution?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
}

// ---- M2: Catálogo y precios (contrato §M2) ----
// v1.1: fuente del tipo de cambio, separada de PriceSource.
export type FxSource = 'banxico' | 'manual';

// GET/PUT /admin/fx (+ POST /admin/fx/refresh): tipo de cambio USD→MXN con colchón.
export interface FxDTO {
  rate: number;
  bufferPct: number;
  source: FxSource;
  effectiveDate: string;
}

// v1.14-price-ingest: proveedor de la ingesta MASIVA de precios (dial `price_provider`, §M10).
// Palanca de rollback money-safe que cambia la fuente de precios del ingest SIN redeploy.
export type PriceProvider = 'pokemontcg_io' | 'pokemonpricetracker';

// POST /admin/jobs/price-ingest → 202 (contrato §M10-ops, v1.14-price-ingest): dispara la
// ingesta masiva (fan-out BullMQ un job por set). `enqueued=false` si ya había un pase en
// curso (single-flight). `scope`/`setId` solo vienen cuando se ingesta UN set (verificación
// de esquema del proveedor en la 1ª corrida); omitir `setId` ingesta TODO el catálogo.
export interface PriceIngestResponse {
  job: 'price-ingest';
  enqueued: boolean;
  jobId?: string;
  scope?: 'set';
  setId?: string;
}

// GET /admin/pricing/pending: cola de precio pendiente (contrato §11 PendingPriceEntry).
// v1.8-ronda-c (M-19): la cola es POR ACABADO — cada entrada lleva `finish` y el override
// debe enviarlo para resolver SOLO el pendiente de ese acabado.
/**
 * Contexto/origen de un pendiente de precio (contrato §M2, `pending?context=`). v1.26 (P-6):
 * habilita los dos buckets de M2 — `inventory` = VENTA (fijable por override), `buylist` = COMPRA
 * (READ-ONLY). `catalog`/`portfolio` son otros orígenes históricos.
 */
export type PendingPriceContext = 'catalog' | 'portfolio' | 'buylist' | 'inventory';

export interface PendingPriceEntryDTO {
  id: string;
  cardId: string;
  productType: ProductType;
  gradeKey: string;
  /** Acabado del pendiente (modelo M-19). El override debe reenviar este mismo finish. */
  finish: Finish;
  context: PendingPriceContext;
  status: 'open' | 'resolved';
  createdAt: string;
  // Conveniencia del front: nombre de carta para render. El backend puede omitirlo.
  cardName?: string;
  /** Proyección de la carta (Tier 0 fix backend: card { id, name, number, setName }). */
  card?: { id: string; name: string; number: string; setName: string };
}

// ---- M2: precio de buylist por RAREZA + ACABADO (contrato §M2; v1.29 dos ejes) ----
// v1.29 (§4.28d): las reglas dejan de ser un mapa plano que MEZCLABA rareza y acabado (el parche
// INV-1 del front con keys sintéticas "Holo"/"Reverse Holo"). Pasan a `PriceRuleSet` con DOS ejes
// LIMPIOS: `rarityRules` keyeadas por RAREZA CANÓNICA (de la carta) y `finishRules` keyeadas por el
// enum `Finish` (acabado de la variante: reverse_holo / holofoil / first_edition_holofoil). El
// `normal` NO lleva finish-rule (usa la rareza). Money-safe: rareza sin regla → fallback pct.
// GET/PUT /admin/pricing/buylist-rules → PriceRuleSet.
export interface PriceRuleSet {
  rarityRules: Record<string, BuylistRule>;
  finishRules: Partial<Record<Finish, BuylistRule>>;
  fallbackPct: number;
}
// GET /admin/pricing/rarities → rarezas CANÓNICAS del catálogo (agrupadas por `Card.rarityCanonical`,
// §4.28) unidas a las reglas (para poblar el eje de rareza del editor). Las rarezas sin regla
// explícita muestran source="fallback". `canonical` = key editable; `raw` = una forma cruda
// observada (diagnóstico); `premium` = atributo del catálogo canónico (§4.28e); `mapped=false` =
// rareza `unmapped` aún sin entrada canónica (cae al fallback pct, visible para resolverla).
export interface BuylistRarityRowDTO {
  canonical: string;
  raw?: string;
  premium: boolean;
  mapped: boolean;
  // DEPRECADO v1.29: alias de `canonical` (compat). El editor usa `canonical`.
  rarity: string;
  cardCount: number;
  rule: BuylistRule;
  source: 'rule' | 'fallback';
}
export interface BuylistRaritiesResponse {
  fallbackPct: number;
  rarities: BuylistRarityRowDTO[];
}

// ---- M2: precio de VENTA por RAREZA (contrato §M2, v1.13-sales-pricing) ----
// Misma FORMA que BuylistRule; value = centavos MXN (PISO) si mode=fixed; % de MARKUP
// ARRIBA de mercado ([0,1000]) si mode=pct → salePriceCents = round(ref × (1 + value/100)).
// (¡OJO! en buylist pct = % de la referencia; en venta pct = % arriba de mercado.)
export interface SalesRule {
  mode: SalesRuleMode;
  value: number;
}
// v1.13-sales-pricing: regla de venta resuelta para la carta. source="rule" (fila explícita
// de SALES_PRICE_RULES) o "fallback" (SALES_PRICE_FALLBACK_PCT).
export interface SalesRuleApplied {
  mode: SalesRuleMode;
  value: number;
  source: 'rule' | 'fallback';
}
// GET/PUT /admin/pricing/sales-rules → PriceRuleSet de VENTA (v1.29, dos ejes; análogo a buylist).
export interface SalesPriceRuleSet {
  rarityRules: Record<string, SalesRule>;
  finishRules: Partial<Record<Finish, SalesRule>>;
  fallbackPct: number;
}
// GET /admin/pricing/sales-rarities → rarezas CANÓNICAS del catálogo unidas a las reglas de venta
// (para poblar el eje de rareza del editor). Las rarezas sin regla explícita muestran
// source="fallback". Mismos campos canónicos que BuylistRarityRowDTO (v1.29).
export interface SalesRarityRowDTO {
  canonical: string;
  raw?: string;
  premium: boolean;
  mapped: boolean;
  // DEPRECADO v1.29: alias de `canonical` (compat).
  rarity: string;
  cardCount: number;
  rule: SalesRule;
  source: 'rule' | 'fallback';
}
export interface SalesRaritiesResponse {
  fallbackPct: number;
  rarities: SalesRarityRowDTO[];
}

// ===== v1.23-sealed-sales: sellado / producto cerrado (contrato §2-S, §3, §M1, §M2) =====

// Tarjeta AGREGADA del grid público de sellado (GET /catalog/sealed): agrupa piezas idénticas
// (mismo producto TCGCSV + misma condición) → "N disponibles". `representativeItemId` = la pieza
// disponible MÁS BARATA (add-to-cart / key de la ficha). `imageUrl` = imagen TCGCSV si mapeado, si
// no la de catálogo de la Card. `fromPriceCents` = mínimo salePriceCents del grupo. `referenceValue`
// = valor de mercado TCGCSV (informativo; puede ser pending si el grupo se vende solo por override).
export interface SealedGroupDTO {
  representativeItemId: string;
  card: CardDTO;
  productName: string;
  imageUrl: string | null;
  sealedSubtype: SealedSubtype | null;
  sealedCondition: SealedCondition;
  availableCount: number;
  fromPriceCents: number;
  priceSource: SealedSpreadSource;
  referenceValue: PriceInfo;
  currency: 'MXN';
}
export interface SealedGroupListResponse {
  data: SealedGroupDTO[];
  page: number;
  pageSize: number;
  total: number;
}
// Ficha del sellado (GET /catalog/sealed/:inventoryItemId): el grupo + TODAS las piezas disponibles
// del mismo grupo (cada una un ListingDTO, más baratas primero) para elegir cantidad (carrito
// por-pieza). trendEnabled/restockEnabled reflejan los feature-flags (§M10).
export interface SealedGroupDetailResponse {
  group: SealedGroupDTO;
  listings: ListingDTO[];
  trendEnabled: boolean;
  restockEnabled: boolean;
}
// Grupo de la pestaña "Sellado" de la bóveda (GET /vault/sealed y admin). `count` = piezas del
// usuario en bóveda de ese grupo; `ownership` = desglose por titularidad. `marketValue` = valor de
// mercado ACTUAL por pieza (sealedMarketRef); `totalMarketValueMxnCents` = count × ref (null si
// pending → se excluye del total y cuenta en pendingPriceCount).
export interface VaultSealedGroupDTO {
  card: CardDTO;
  productName: string;
  imageUrl: string | null;
  sealedSubtype: SealedSubtype | null;
  sealedCondition: SealedCondition;
  count: number;
  ownership: { pending: number; settled: number };
  marketValue: PriceInfo;
  totalMarketValueMxnCents: number | null;
}
export interface VaultSealedResponse {
  data: VaultSealedGroupDTO[];
  totalValueMxnCents: number;
  pendingPriceCount: number;
  currency: 'MXN';
  // Solo en la vista admin (GET /admin/vaults/:userId/sealed); omitido en la del propio cliente.
  owner?: VaultOwnerRefDTO;
}
// Spreads de venta del sellado (GET/PUT /admin/pricing/sealed-spreads). `spreadPctBySubtype` =
// markup % ARRIBA de mercado por presentación; `fallbackPct` = spread global de respaldo. Semántica
// de pct = markup sobre mercado (como ventas §4.14). Rango [0, 1000].
export interface SealedSpreadsDTO {
  spreadPctBySubtype: Partial<Record<SealedSubtype, number>>;
  fallbackPct: number;
}

// GET /admin/pricing/card/:cardId — historial de precios por fecha/fuente.
// SUPUESTO de shape: el contrato describe "historial de precios por fecha/fuente"
// sin fijar campos exactos; estos son los mínimos para render (ver FRONTEND_NOTES).
export interface PriceHistoryEntryDTO {
  capturedDate: string;
  source: PriceSource;
  gradeKey: string;
  productType: ProductType;
  priceMxnCents: number;
  isManualOverride: boolean;
}

// POST /admin/catalog/unify-rarities → backfill LOCAL de `Card.rarityCanonical` (§19.5 / BACKEND_NOTES
// §0-ter). Money-safe: NUNCA llama a pokemontcg.io/TCGCSV, no toca precios ni reglas; solo re-normaliza
// la rareza canónica del catálogo para colapsar duplicados/variantes de escritura en el editor de reglas.
// `unmapped` = rarezas crudas sin entrada en el catálogo canónico (el operador ve cuáles añadir).
export interface UnifyRaritiesUnmappedEntry {
  raw: string;
  canonical: string;
  count: number;
}
export interface UnifyRaritiesResponse {
  ok: true;
  cardsProcessed: number;
  cardsUpdated: number;
  distinctCanonical: number;
  unmapped: UnifyRaritiesUnmappedEntry[];
}

// GET /admin/catalog/remote-sets: sets remotos de pokemontcg.io con estado local.
export interface RemoteSetDTO {
  id: string;
  name: string;
  series?: string;
  releaseDate?: string;
  printedTotal?: number;
  imported: boolean;
  cardCount: number;
}

// POST /admin/catalog/sync
export interface CatalogSyncResponse {
  jobId: string;
  setsQueued: number;
  mode: 'single' | 'from_date';
}

// POST /admin/catalog/backfill
export interface CatalogBackfillResponse {
  imported: { id: string; name: string; releaseDate?: string; cardCount: number }[];
  newBoundary: string;
  remaining: number;
}

// POST /admin/catalog/sync-all (v1.3 — puede no existir aún en backend; se usa condicional).
export interface CatalogSyncAllResponse {
  jobId: string;
  setsQueued: number;
  remaining: number;
}

// POST /admin/catalog/refresh-variants — refresca variantes + precios de UN set existente usando
// SOLO TCGCSV (sin pokemontcg.io). No re-importa cartas: opera sobre las cartas ya en BD. Es
// SÍNCRONO y devuelve un resumen del trabajo (no un job encolado), de modo que una caída de
// pokemontcg.io no bloquee arreglar el "fantasma" (variantes/precios faltantes) de un set importado.
// Errores: SET_NOT_IMPORTED (el set no está en BD) · UPSTREAM_ERROR (502, TCGCSV no disponible).
export interface RefreshVariantsResponse {
  ok: boolean;
  setId: string;
  /** cartas del set procesadas (ya presentes en BD; no se importan cartas nuevas). */
  cardsProcessed: number;
  /** productos de carta (variantes/acabados) insertados o actualizados desde TCGCSV. */
  cardProductsUpserted: number;
  /** precios de referencia insertados o actualizados desde TCGCSV. */
  pricesUpserted: number;
  /** productos que quedaron SIN precio (TCGCSV no lo trajo) → siguen en la cola de pendientes. */
  pending: number;
  /** false = TCGCSV no respondió de forma completa durante el refresh (resultado parcial honesto). */
  tcgcsvReachable: boolean;
}

// POST /admin/catalog/refresh-variants-all — BATCH de refresh-variants (SOLO TCGCSV) sobre TODOS los
// sets ya importados. Corre el mismo trabajo que refresh-variants por-set (variantes/acabados +
// precios desde TCGCSV, SIN re-importar cartas y SIN pokemontcg.io) sobre el catálogo completo. Es
// ASÍNCRONO (fire-and-forget): el POST responde 202 y SOLO arranca el barrido. Body { force? }. El
// progreso y el RESUMEN se leen aparte por GET /admin/catalog/refresh-variants-status (poll).
export interface RefreshVariantsAllResponse {
  /** id del job del barrido arrancado. */
  jobId: string;
  /** sets encolados en el barrido (todos los importados). */
  setsQueued: number;
  /** sets que quedan por procesar (típicamente 0 al encolar todo de una). */
  remaining: number;
}

// Un set que falla (p. ej. UPSTREAM_ERROR de TCGCSV) NO tumba a los demás: sale en `failures`.
export interface RefreshVariantsAllFailure {
  /** id del set que falló. */
  setId: string;
  /** código de error del contrato (p. ej. UPSTREAM_ERROR, SET_NOT_IMPORTED). */
  code: string;
  /** mensaje legible del fallo (para pintarlo tal cual). */
  message: string;
}

// Resumen AGREGADO del batch (dentro del status, presente al terminar). Money-safe: `pending` y
// `failures` reflejan honestamente lo que TCGCSV no trajo / los sets que fallaron.
export interface RefreshVariantsSummary {
  /** sets procesados en el batch (todos los importados). */
  setsTotal: number;
  /** sets refrescados con éxito. */
  setsOk: number;
  /** sets que fallaron (detalle en `failures`). */
  setsFailed: number;
  /** productos de carta (variantes/acabados) insertados o actualizados desde TCGCSV (agregado). */
  cardProductsUpserted: number;
  /** precios de referencia insertados o actualizados desde TCGCSV (agregado). */
  pricesUpserted: number;
  /** productos que quedaron SIN precio (TCGCSV no lo trajo) → siguen en la cola de pendientes (agregado). */
  pending: number;
  /** sets que fallaron, con su motivo legible (lista honesta; vacía = todos OK). */
  failures: RefreshVariantsAllFailure[];
}

// GET /admin/catalog/refresh-variants-status — progreso + resumen del batch refresh-variants-all en
// curso (o del último). Endpoint STATUS PROPIO del batch (NO el `sync-status` de sync-all). Se POLLEA
// desde M2 hasta `running=false`; al terminar trae el `summary` agregado. `summary` = null mientras no
// haya terminado ningún batch (o corre uno sin resultado aún).
export interface RefreshVariantsStatusResponse {
  running: boolean;
  jobId: string | null;
  /** sets a procesar en el barrido actual/último. */
  total: number;
  /** sets ya procesados (éxito o fallo) → barra de progreso done/total. */
  done: number;
  startedAt: string | null;
  finishedAt: string | null;
  /** resumen agregado del último barrido terminado (null si aún no hay). */
  summary: RefreshVariantsSummary | null;
}

// GET /admin/catalog/sync-status — progreso del barrido `sync-all` en curso (o del último).
// Estado en memoria del proceso (no persistido); para POLLING desde M2 sin llamar a pokemontcg.io.
export interface CatalogSyncStatusResponse {
  running: boolean;
  jobId: string | null;
  /** sets encolados en el barrido actual/último. */
  total: number;
  /** sets ya procesados (éxito o fallo) → barra de progreso done/total. */
  done: number;
  startedAt: string | null;
  finishedAt: string | null;
}

// GET /admin/pricing/sync-status — progreso del barrido MASIVO de precios (price-ingest) en curso
// (o del último). Estado en memoria del proceso (no persistido); para POLLING desde M2 sin llamar
// al proveedor. Calca CatalogSyncStatusResponse con campos extra del presupuesto diario del
// proveedor de paga (v1.14-price-ingest / N-11).
export interface PriceSyncStatusResponse {
  running: boolean;
  jobId: string | null;
  /** sets a procesar en el barrido actual/último. */
  total: number;
  /** sets ya intentados (éxito o fallo) → barra de progreso done/total. */
  done: number;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
  /** presupuesto diario restante del proveedor de paga (null = sin límite/no aplica). */
  dailyRemaining: number | null;
  /** true = pausado por límite diario del proveedor (429 daily); retoma a las 00:00 UTC. */
  dailyLimited: boolean;
  /** sets pendientes si el barrido se pausó por límite diario. */
  pending: number;
  /** proveedor activo del barrido ('pokemonpricetracker' | 'pokemontcg_io'), o null. */
  provider: string | null;
}

// ---- M6: Usuarios / KYC (contrato §M6) ----
// v1.3.1: `deleted` = cuenta soft-deleted/anonimizada (no puede iniciar sesión).
export type AdminUserStatus = 'active' | 'blocked' | 'deleted';

export interface AdminUserSummaryDTO {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: AdminUserStatus;
  createdAt: string;
}

// POST /admin/users/:id/reset-password → contraseña temporal UNA sola vez (v1.3.1).
export interface ResetPasswordResponse {
  userId: string;
  tempPassword: string;
  mustChangePassword: boolean;
}

// DELETE /admin/users/:id → hard (borrado total) | soft (anonimizado, conserva historial).
export interface DeleteUserResponse {
  userId: string;
  mode: 'hard' | 'soft';
}

// KYC en la ficha 360°: CLABE/RFC ENMASCARADOS incluso para super_admin (contrato §M6/§3.4).
export interface AdminKycProfileDTO {
  kycStatus: KycStatus;
  clabeMasked?: string;
  rfcMasked?: string;
  ineOnFile: boolean;
  capPerRequestCents?: number;
  capPerMonthCents?: number;
  monthUsedCents?: number;
}

export interface AdminBillingProfileDTO {
  rfcMasked?: string;
  razonSocial?: string;
  regimenFiscal?: string;
  usoCfdi?: string;
  postalCode?: string;
  email?: string;
}

export interface AdminUserSellRequestRef {
  id: string;
  status: SellRequestStatus;
  quotedTotalCents: number;
  createdAt: string;
}

export interface AdminUserDisputeRef {
  id: string;
  status: DisputeStatus;
  type?: DisputeType;
  createdAt: string;
}

// v1.8-ronda-c (BE-10): la proyección de la pestaña "Bóveda" de la ficha 360° se enriquece
// con `productType`, `finish` y `referenceValue` (mismo PriceInfo que HoldingDTO §3, valuación
// por-acabado `getReference`). Proyección — NO migra. Ver API_CONTRACT §M6 nota BE-10 y §11.
export interface AdminUserOwnedItemRef {
  inventoryItemId: string;
  folio: string;
  card: CardDTO;
  productType: ProductType;
  // v1.6-finish: acabado de la copia física; el referenceValue es el de ESE acabado. graded/sealed → "normal".
  finish: Finish;
  ownershipStatus: OwnershipStatus;
  // v1.8-ronda-c: valor de referencia (mercado) del acabado; status="pending" si sin precio del día.
  referenceValue: PriceInfo;
}

// GET /admin/users/:id — ficha 360°. billingProfile = null para vault_operator
// (proyección reducida SEC-A4: sin RFC/INE/billing).
export interface AdminUserDetailDTO extends AdminUserSummaryDTO {
  locale?: Locale;
  authProvider?: AuthProvider;
  kycProfile?: AdminKycProfileDTO | null;
  billingProfile?: AdminBillingProfileDTO | null;
  addresses?: AddressDTO[];
  orders?: OrderSummaryDTO[];
  sellRequests?: AdminUserSellRequestRef[];
  disputes?: AdminUserDisputeRef[];
  ownedItems?: AdminUserOwnedItemRef[];
}

// POST /admin/users → alta de usuario por rol desde admin (v1.7-admin-users, super_admin).
// `user` = shape público (sin passwordHash). `tempPassword` SOLO si el backend la autogeneró
// (password omitida); `mustChangePassword=true` SOLO cuando fue autogenerada (patrón reset M-15).
export interface AdminCreatedUserDTO {
  user: {
    id: string;
    email: string;
    name: string;
    role: Role;
    locale: Locale;
    status: AdminUserStatus;
    emailVerified: boolean;
    authProvider: AuthProvider;
    createdAt: string;
  };
  tempPassword?: string;
  mustChangePassword: boolean;
}

// GET /admin/users/:id/audit → traza de AuditLog de/sobre el usuario (v1.7-admin-users).
// Superset de AuditLogDTO: `ip?` SOLO se puebla para super_admin (vault_operator lo recibe
// omitido). NUNCA incluye before/after (posible PII/estado sensible; §M6/ARCHITECTURE §3.2).
export interface UserAuditEntryDTO {
  id: string;
  actorUserId: string;
  actorRole: Role;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  ip?: string;
}

// ---- M10: Config (diales) y bitácora (contrato §M10) ----
export interface SettingsDTO {
  shippingFeeCents: number;
  aportacionPct: number;
  ivaPct: number;
  salesMarkupPct: number;
  stripeFeePct: number;
  stripeFeeFixedCents: number;
  stripeFeeIvaPct: number;
  buylistCapPerRequestCents: number;
  buylistCapPerMonthCents: number;
  ineThresholdCents: number;
  repoCapPerCardCents: number;
  fxBufferPct: number;
  fxManualOverrideRate?: number;
  pricingProviderRaw: string;
  pricingProviderGraded: string;
  pricingProviderSealed: string;
  /**
   * v1.14-price-ingest: proveedor de la ingesta MASIVA de precios (dial `price_provider`,
   * editable sin redeploy). Opcional: el backend lo puede omitir hasta el seed. Ver §M10.
   */
  priceProvider?: PriceProvider;
  catalogSyncFromDate: string;
}

export interface AuditLogDTO {
  id: string;
  actorUserId: string;
  actorRole: Role;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
}

// ---- M7: Finanzas (contrato §M7) ----
// GET /admin/finance/pnl?from=&to= (contrato §M7, v1.4-finance):
// profitCents = incomeCents + shippingRevenueCents − cogsCents − stripeFeesCents − shippingCostCents.
export interface PnlDTO {
  incomeCents: number;
  shippingRevenueCents: number;
  cogsCents: number;
  stripeFeesCents: number;
  shippingCostCents: number;
  profitCents: number;
}

// GET /admin/finance/inventory-value → valor de inventario (a referencia y a costo) + pendientes.
// v1.28 (P-24, ADITIVO): `breakdown { raw, sealed, graded }` con la MISMA base de valuación por
// pieza; piezas sin precio se EXCLUYEN de atReferenceCents y cuentan en pendingPriceCount (nunca
// 0 inventado). Los campos top-level NO cambian (= Σ del breakdown). Opcional en el TIPO por
// resiliencia mientras el backend aterriza la extensión (las tarjetas por tipo se omiten sin él).
export interface InventoryValueBucketDTO {
  atReferenceCents: number;
  atCostCents: number;
  pieceCount: number;
  pendingPriceCount: number;
}

export interface InventoryValueDTO {
  atReferenceCents: number;
  atCostCents: number;
  pendingPriceCount: number;
  breakdown?: {
    raw: InventoryValueBucketDTO;
    sealed: InventoryValueBucketDTO;
    graded: InventoryValueBucketDTO;
  };
}

// GET /admin/finance/custody-value → valor en custodia de clientes.
export interface CustodyValueDTO {
  totalCustodyValueCents: number;
}

// GET /admin/finance/iva?from=&to= → IVA cobrado (para conciliación/CFDI).
// SUPUESTO de shape: el contrato define `byOrder: [...]` sin fijar los campos; se asume
// esta forma mínima para render (ver FRONTEND_NOTES / solicitud al arquitecto).
export interface IvaByOrderEntryDTO {
  orderId: string;
  ivaCents: number;
  settledAt?: string;
}
export interface IvaReportDTO {
  ivaCollectedCents: number;
  byOrder: IvaByOrderEntryDTO[];
}

// ---- M9: Reportes (contrato §M9) ----
// GET /admin/reports/launch-metrics?from=&to= → métricas vs metas N/X/Y/Z.
// `goals` es null hasta que el humano fije las metas (contrato §M9).
export interface LaunchGoalsDTO {
  N: number | null;
  X: number | null;
  Y: number | null;
  Z: number | null;
}
export interface LaunchMetricsDTO {
  users: number;
  salesSettled: number;
  buylistPaid: number;
  withdrawalsNoDispute: number;
  goals: LaunchGoalsDTO | null;
}

// ---- Errores (contrato §0) ----
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// ============================================================================
// Guest checkout — comprar sin cuenta (contrato §4-G, v1.21-guest-checkout)
// ----------------------------------------------------------------------------
// Superficie ADITIVA: ningún tipo anterior cambia de forma. Los cinco invariantes
// de §4-G.0 que atan a este front:
//   1. El invitado NO tiene bóveda (fulfillmentMode siempre 'direct_ship').
//   3. Un invitado nunca toca un endpoint `customer` (y al revés: con sesión, los
//      endpoints /checkout/guest/* responden 409 ALREADY_AUTHENTICATED).
//   5. El ÚNICO token en claro que devuelve la API es el `checkoutToken` de
//      POST /checkout/guest/session (a quien acaba de crear el pedido). No se
//      persiste en localStorage ni se loguea (§4-G.2). v1.21.1: es un token de
//      VIDA CORTA (120 min); el enlace de seguimiento de 90 días llega SOLO por
//      correo y nunca por una respuesta de API (§4-G.7a).
// ============================================================================

export type FulfillmentMode = 'vault' | 'direct_ship';

/** Dirección capturada en línea por el invitado (no hay `Address` sin cuenta). §4-G.1 */
export interface GuestAddressInput {
  line1: string;
  line2?: string;
  neighborhood?: string;
  city: string;
  state: string;
  /** ^\d{5}$ */
  postalCode: string;
  /** literal "MX"; cualquier otro valor → 422 ADDRESS_NOT_MX */
  country: 'MX';
  /** 10 dígitos MX (contacto de paquetería) */
  phone: string;
  /** nombre de quien recibe (el invitado no tiene User.name) */
  recipientName: string;
}

/** POST /checkout/guest/quote — read-only, no reserva inventario. §4-G.1 */
export interface GuestCheckoutQuoteRequest {
  inventoryItemIds: string[];
  shippingAddress?: GuestAddressInput;
}

/** Banderas de aviso; el TEXTO lo pone el front desde i18n (§0 / §4-G.1). */
export interface GuestCheckoutNotices {
  finalSale: boolean;
  invoiceByEmail: boolean;
  termsRequired: boolean;
}

export interface GuestCheckoutQuoteResponse {
  items: { inventoryItemId: string; card: CardDTO; unitPriceCents: number }[];
  fulfillmentMode: FulfillmentMode;
  breakdown: BreakdownDTO;
  /**
   * v1.21.4-dual-breakdown (contrato §4-G.1, N-12): SEGUNDO desglose, SIEMPRE presente en
   * el `200` (incl. carrito 100 % podado, en ceros). Es el resumen del destino BÓVEDA:
   * la bóveda NO se envía ⇒ SIN `shippingFeeCents`, IVA solo sobre el subtotal de cartas y
   * total = gross-up recalculado sobre la base menor. Mismo `subtotalCents` que `breakdown`.
   * Permite al front conmutar el resumen «recibir ⇄ bóveda» al instante SIN refetch. El
   * `breakdown` (direct_ship, con `shippingFeeCents`) NO cambia y es lo que se COBRA.
   */
  vaultBreakdown: BreakdownDTO;
  notices: GuestCheckoutNotices;
  /**
   * SIEMPRE presente (v1.21.3-quote-prune, misma norma que §4). Carrito 100 % no
   * disponible ⇒ `items: []` + breakdown en CEROS (incl. `shippingFeeCents: 0`),
   * nunca error.
   */
  unavailableItems: UnavailableCartItemDTO[];
}

/** POST /checkout/guest/session. §4-G.2 */
export interface GuestCheckoutSessionRequest {
  inventoryItemIds: string[];
  /** OBLIGATORIO. El backend lo normaliza (trim + lowercase). */
  email: string;
  shippingAddress: GuestAddressInput;
  locale?: Locale;
  /** aceptación explícita de ventas finales + aviso de privacidad */
  acceptedTerms: true;
  /** si se envía DEBE ser "direct_ship"; "vault" → 422 VAULT_REQUIRES_ACCOUNT (upsell) */
  fulfillmentMode?: FulfillmentMode;
}

export interface GuestCheckoutSessionResponse {
  orderId: string;
  orderNumber: string;
  breakdown: BreakdownDTO;
  /**
   * v1.21.1 (§4-G.2/§4-G.7a) — antes `trackingToken`. Token de **VIDA CORTA**
   * (`GUEST_CHECKOUT_TOKEN_TTL_MIN` = **120 minutos**), 43 chars base64url, cuyo único
   * propósito es sobrevivir al redirect 3DS y pintar la confirmación + el seguimiento
   * inmediato. **NUNCA se envía por correo**: el enlace duradero (90 días) lo emite el
   * webhook del settle y viaja SOLO por correo. Secreto de URL: no se persiste en
   * `localStorage` ni se loguea.
   */
  checkoutToken: string;
  /** ISO — cuándo se apaga el `checkoutToken` (≈ ahora + 120 min). */
  checkoutTokenExpiresAt: string;
  stripe: { paymentIntentId: string; clientSecret: string };
}

/** Estado público derivado (§4-G.5). El texto legible vive en i18n del front. */
export type GuestOrderPublicStatus =
  | 'pendiente_pago'
  | 'pagado'
  | 'preparando'
  | 'guia'
  | 'enviado'
  | 'entregado'
  | 'cancelado'
  | 'reembolsado'
  | 'en_revision';

export interface GuestTrackingItemDTO {
  name: string;
  setName: string;
  number: string;
  finish: Finish;
  productType: ProductType;
  rawCondition?: RawCondition;
  sealedSubtype?: SealedSubtype;
  gradingCompany?: GradingCompany;
  gradeValue?: string;
  imageSmallUrl?: string;
  unitPriceCents: number;
}

export interface GuestTrackingShippingDTO {
  city: string;
  state: string;
  /** "***45" — SOLO los 2 últimos dígitos del CP (el front ni siquiera lo pinta, §15.6) */
  postalCodeMasked: string;
  /** "Juan P." — nombre + inicial (prohibido pintarlo en la vista pública, §15.6) */
  recipientNameMasked: string;
  carrier?: string;
  trackingNumber?: string;
  shippedAt?: string;
  deliveredAt?: string;
}

/** Marca + últimos 4. NADA más (criterio 51). */
export interface GuestTrackingPaymentDTO {
  brand?: string;
  last4?: string;
}

/**
 * POST /orders/guest/track (§4-G.3) — el token viaja en el BODY, nunca en la ruta.
 * Lista CERRADA de campos: cualquier cosa fuera de este shape está prohibida por
 * contrato (el payload es público; ocultarlo en el front no bastaría).
 */
export interface GuestOrderTrackingDTO {
  orderNumber: string;
  status: GuestOrderPublicStatus;
  placedAt: string;
  paidAt?: string;
  /** "j***@***.com" — el diseño §15.6 NO lo pinta (dato de contacto). */
  emailMasked: string;
  items: GuestTrackingItemDTO[];
  breakdown: BreakdownDTO;
  shipping: GuestTrackingShippingDTO;
  payment?: GuestTrackingPaymentDTO;
  claim: { available: boolean };
  support: { evidenceContact: string; disputeWindowDays: number; disputeDeadlineAt?: string };
  tokenExpiresAt: string;
}

/** POST /orders/guest/resend-link — unión discriminada; `email` SOLO nunca se acepta (§4-G.4). */
export type GuestResendLinkRequest =
  | { token: string }
  | { email: string; orderNumber: string };

/** SIEMPRE el mismo cuerpo (202), exista o no el pedido/correo/token. */
export interface GuestResendLinkResponse {
  status: 'ACCEPTED';
}

/** GET /orders/claimable — `customer` + emailVerified (§4-G.9). */
export interface ClaimableOrderDTO {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  totalCents: number;
  itemCount: number;
  createdAt: string;
  settledAt?: string;
}

/** POST /orders/claim — parcial-tolerante: HTTP 200 con fallos por pedido. */
export interface ClaimOrdersResponse {
  claimed: string[];
  failed: {
    orderId: string;
    code: 'ORDER_ALREADY_CLAIMED' | 'CLAIM_EMAIL_MISMATCH' | 'NOT_FOUND';
  }[];
}

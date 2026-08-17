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
export type PriceSource = 'pokemontcg_io' | 'pokemonpricetracker' | 'poketrace' | 'manual';
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

export interface CheckoutQuoteResponse {
  items: OrderItemPreview[];
  breakdown: BreakdownDTO;
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
export interface BuylistRuleApplied {
  mode: BuylistRuleMode;
  value: number;
  source: 'rule' | 'fallback';
}

// v1.3.1: POST /buylist/quote — expone `rarity` + `appliedRule` en vez de `category`.
// v1.6-finish: la respuesta ecoa el `finish` resuelto (validado ∈ availableFinishes) y la
// `appliedRule` la selecciona el acabado (reverse holo → "Reverse Holo"; holo/1st ed → base/"Holo";
// normal → rareza base).
export interface BuylistQuoteResponse {
  rarity: string;
  finish: Finish;
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
}

// Payload de éxito por ítem = MISMO shape que la respuesta de POST /buylist/quote por-carta.
// `rarity` puede ser null (p. ej. sellado sin rareza); el resto espeja BuylistQuoteResponse.
export interface BuylistQuotePayload {
  rarity: string | null;
  finish: Finish;
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
// ante cardId+finish repetidos); `cardId` se ecoa. Errores por-ítem: NOT_FOUND | FINISH_NOT_AVAILABLE.
export type BuylistBatchQuoteResultDTO =
  | ({ index: number; cardId: string; ok: true } & BuylistQuotePayload)
  | {
      index: number;
      cardId: string;
      ok: false;
      error: { code: 'NOT_FOUND' | 'FINISH_NOT_AVAILABLE'; message: string };
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
  rarity?: string;
  appliedRule?: BuylistRuleApplied;
  quotedPriceCents?: number;
  approvedPriceCents?: number;
  itemStatus: SellItemStatus;
  inventoryItemId?: string;
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
export type MovementReason =
  | 'alta'
  | 'move'
  | 'sale'
  | 'settle'
  | 'chargeback_return'
  | 'withdrawal'
  | 'lost'
  | 'damaged'
  | 'buylist_convert';

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
}

// Ordenamiento del índice (contrato §M1). `release_desc` es el default.
export type MasterSetSort = 'release_desc' | 'completion_asc' | 'pieces_desc';

export interface MasterSetIndexResponse {
  data: MasterSetSummaryDTO[];
  page: number;
  pageSize: number;
  total: number;
}

// Celda del binder (GET /admin/inventory/master-sets/:setId). Una por Card del catálogo del set.
// `number` = Card.number crudo (String, p. ej. "4", "SV107", "TG12"). `numberSort` = CLAVE NUMÉRICA
// derivada SERVER-SIDE para el orden natural estable — el front NO re-ordena por número, confía en el
// orden natural del backend (numéricos por valor entero primero; promos/subsets con prefijo alfabético
// al final). `countsByFinish` = piezas on-hand por acabado (solo acabados con ≥1 pieza); `totalCount` =
// suma. `totalCount=0` = HUECO de inventario. `isSecretRare` = heurística SOLO de display (número
// puramente numérico cuyo entero > printedTotal); los promos/subsets con prefijo NO son secret rare.
export interface MasterSetCellCountDTO {
  finish: Finish;
  count: number;
}

export interface MasterSetCardCellDTO {
  cardId: string;
  number: string;
  numberSort: number;
  name: string;
  rarity?: string;
  imageSmallUrl?: string;
  availableFinishes: Finish[];
  countsByFinish: MasterSetCellCountDTO[];
  totalCount: number;
  isSecretRare: boolean;
}

export interface MasterSetBinderResponse {
  set: SetRefDTO;
  printedTotal: number | null;
  catalogCardCount: number;
  cells: MasterSetCardCellDTO[];
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
  gradingCompany?: GradingCompany;
  gradeValue?: string;
  certNumber?: string;
  locationId?: string;
  acquisitionType: AcquisitionType;
  acquisitionPct?: number;
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
    };

export interface BulkPublishResponse {
  summary: { requested: number; published: number; failedLines: number };
  results: BulkPublishLineResult[];
}

export interface AdminBuylistDTO {
  id: string;
  userId: string;
  status: SellRequestStatus;
  quotedTotalCents: number;
  approvedTotalCents?: number;
  createdAt: string;
  items: SellItemDTO[];
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
export interface BuylistItemDecisionInput {
  decision: 'approve' | 'adjust' | 'reject';
  approvedPriceCents?: number;
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
export interface PendingPriceEntryDTO {
  id: string;
  cardId: string;
  productType: ProductType;
  gradeKey: string;
  /** Acabado del pendiente (modelo M-19). El override debe reenviar este mismo finish. */
  finish: Finish;
  context: 'catalog' | 'portfolio' | 'buylist' | 'inventory';
  status: 'open' | 'resolved';
  createdAt: string;
  // Conveniencia del front: nombre de carta para render. El backend puede omitirlo.
  cardName?: string;
  /** Proyección de la carta (Tier 0 fix backend: card { id, name, number, setName }). */
  card?: { id: string; name: string; number: string; setName: string };
}

// GET/PUT /admin/pricing/rarity-map: tabla rareza→categoría de buylist.
// DEPRECADO v1.3.1: la cotización ya no la usa; reemplazada por buylist-rules.
export interface RarityMapEntryDTO {
  rarity: string;
  category: BuylistCategory;
}

// ---- M2: precio de buylist por RAREZA (contrato §M2, v1.3.1) ----
// GET /admin/pricing/buylist-rules → tabla cruda + fallback.
export interface BuylistRulesDTO {
  rules: Record<string, BuylistRule>;
  fallbackPct: number;
}
// GET /admin/pricing/rarities → rarezas distintas del catálogo unidas a las reglas
// (para poblar el editor). Las rarezas sin regla explícita muestran source="fallback".
export interface BuylistRarityRowDTO {
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
// GET /admin/pricing/sales-rules → tabla cruda + fallback.
export interface SalesRulesDTO {
  rules: Record<string, SalesRule>;
  fallbackPct: number;
}
// GET /admin/pricing/sales-rarities → rarezas distintas del catálogo unidas a las reglas de
// venta (para poblar el editor). Las rarezas sin regla explícita muestran source="fallback".
export interface SalesRarityRowDTO {
  rarity: string;
  cardCount: number;
  rule: SalesRule;
  source: 'rule' | 'fallback';
}
export interface SalesRaritiesResponse {
  fallbackPct: number;
  rarities: SalesRarityRowDTO[];
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

// POST /admin/pricing/sync → dispara/encola el sync diario de bóveda.
export interface PricingSyncResponse {
  jobId: string;
  queued: number;
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
export interface InventoryValueDTO {
  atReferenceCents: number;
  atCostCents: number;
  pendingPriceCount: number;
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

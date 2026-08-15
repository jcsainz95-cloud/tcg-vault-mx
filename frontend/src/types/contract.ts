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
export type BuylistCategory = 'comun' | 'reverse_holo' | 'ex_plus';
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
}

export interface ListingDTO {
  inventoryItemId: string;
  card: CardDTO;
  productType: ProductType;
  rawCondition?: RawCondition;
  sealedSubtype?: SealedSubtype;
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
}

export interface AuthResponse {
  user: UserDTO;
  accessToken: string;
  refreshToken: string;
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
  gradingCompany?: GradingCompany;
  gradeValue?: string;
  // v1.2: nº de certificado PSA/CGC para gradeadas en bóveda.
  certNumber?: string;
  ownershipStatus: OwnershipStatus;
  status: InventoryStatus;
  referenceValue: PriceInfo;
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

export interface ShipmentDTO {
  id: string;
  status: ShipmentStatus;
  trackingNumber?: string;
  carrier?: string;
  createdAt: string;
  items: { inventoryItemId: string; folio: string; card: CardDTO }[];
}

// ---- Buylist (contrato §6) ----
export interface BuylistQuoteResponse {
  category: BuylistCategory;
  quote: {
    status: 'cotizada' | 'precio_pendiente';
    quotedPriceCents: number | null;
    currency: 'MXN';
  };
  referencePrice: { status: 'priced' | 'pending'; priceMxnCents?: number };
  paymentNotice: 'PAY_AFTER_RECEIPT';
}

export interface SellItemDTO {
  id: string;
  card: CardDTO;
  productType: ProductType;
  rawCondition?: RawCondition;
  sealedSubtype?: SealedSubtype;
  category: BuylistCategory;
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

export interface AdminBuylistItemDTO extends SellItemDTO {}

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

// ---- Errores (contrato §0) ----
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

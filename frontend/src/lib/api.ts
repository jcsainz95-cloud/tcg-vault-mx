import { config } from './config';
import { apiRequest, ApiClientError, setToken, setRefreshToken, getToken } from './api-client';
import { setStoredUser, patchStoredUser } from './session';
import * as fx from './mock/fixtures';
import type {
  Paginated,
  ListingDTO,
  CardDetailResponse,
  CardSetDTO,
  CatalogFacetsDTO,
  HoldingsResponse,
  OrderSummaryDTO,
  OrderDetailDTO,
  CheckoutQuoteResponse,
  BuylistQuoteResponse,
  SellRequestDTO,
  ShipmentDTO,
  ShipmentQuoteResponse,
  ShipmentTrackingRequest,
  DashboardDTO,
  InventoryItemDTO,
  AdminInventoryItemDetailDTO,
  VaultLocationDTO,
  VaultZone,
  AdminBuylistDTO,
  AdminOrderDTO,
  AdminShipmentDTO,
  PickingListEntryDTO,
  RefundOrderResponse,
  RevealClabeResponse,
  BuylistItemDecisionInput,
  ConvertToInventoryResponse,
  ResolveDisputeInput,
  SellItemDTO,
  SellItemStatus,
  DisputeDTO,
  ProductType,
  RawCondition,
  SealedSubtype,
  Finish,
  GradingCompany,
  AcquisitionType,
  InventoryStatus,
  BuylistRule,
  BuylistRulesDTO,
  BuylistRaritiesResponse,
  SalesRule,
  SalesRulesDTO,
  SalesRaritiesResponse,
  BreakdownDTO,
  PortfolioRange,
  PortfolioHistoryResponse,
  SetValueRange,
  SetValueHistoryResponse,
  AuthResponse,
  VerifyEmailResponse,
  ResendVerificationResponse,
  ForgotPasswordResponse,
  ResetPasswordSelfResponse,
  Locale,
  UploadPurpose,
  UploadPresignResponse,
  IneUploadKeys,
  KycInfoDTO,
  FxDTO,
  PendingPriceEntryDTO,
  RemoteSetDTO,
  PriceHistoryEntryDTO,
  PricingSyncResponse,
  CatalogSyncResponse,
  CatalogBackfillResponse,
  CatalogSyncAllResponse,
  CatalogSyncStatusResponse,
  AdminUserSummaryDTO,
  AdminUserDetailDTO,
  AdminCreatedUserDTO,
  UserAuditEntryDTO,
  Role,
  ResetPasswordResponse,
  DeleteUserResponse,
  SettingsDTO,
  AuditLogDTO,
  KycStatus,
  CardDTO,
  PnlDTO,
  InventoryValueDTO,
  CustodyValueDTO,
  IvaReportDTO,
  LaunchMetricsDTO,
} from '@/types/contract';

// MOCK: pendiente de contrato/backend real — simula latencia mínima de red.
const delay = <T>(value: T, ms = 120): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

/** Parámetros de paginación comunes de las ramas mock. */
interface PageParams {
  page?: number;
  pageSize?: number;
}

/**
 * Paginación local para las ramas mock (deuda techlead Ola 1 #1: helper ÚNICO en vez de
 * slices duplicados en getAdminShipments/getAdminUsers/searchBuylistCards/getAuditLog).
 */
function paginate<T>(rows: T[], params: PageParams = {}): Paginated<T> {
  const pageSize = params.pageSize ?? 20;
  const page = params.page ?? 1;
  const start = (page - 1) * pageSize;
  return { data: rows.slice(start, start + pageSize), page, pageSize, total: rows.length };
}

// MOCK (deuda techlead Ola 1 #2): generadores compartidos de ids de job y contraseñas
// temporales de las ramas mock (antes duplicados inline en 5 sitios).
function mockJobId(): string {
  return `job-${Math.floor(Math.random() * 9000 + 1000)}`;
}
function mockTempPassword(): string {
  return `Tmp-${Math.random().toString(36).slice(2, 8)}-${Math.random().toString(36).slice(2, 6)}`;
}

// ---------- Catálogo / "Compra" (contrato §2) ----------
export type CatalogSort = 'price_asc' | 'price_desc' | 'newest';

export interface CatalogFilters {
  q?: string;
  setId?: string;
  /** una o varias rarezas crudas (valor tal cual pokemontcg.io); se manda como CSV a la API */
  rarity?: string[];
  productType?: ProductType;
  condition?: RawCondition;
  /** v1.6-finish: filtra por InventoryItem.finish (normal | reverse_holo | holofoil | first_edition_holofoil). */
  finish?: Finish;
  sealedSubtype?: SealedSubtype;
  minPriceCents?: number;
  maxPriceCents?: number;
  sort?: CatalogSort;
  page?: number;
  pageSize?: number;
}

export async function getCatalog(filters: CatalogFilters = {}): Promise<Paginated<ListingDTO>> {
  if (!config.useMocks) {
    const query: Record<string, string | number | undefined> = {
      q: filters.q,
      setId: filters.setId,
      // La API recibe la rareza CRUDA; multi-select se envía como CSV.
      rarity: filters.rarity && filters.rarity.length ? filters.rarity.join(',') : undefined,
      productType: filters.productType,
      condition: filters.condition,
      finish: filters.finish,
      sealedSubtype: filters.sealedSubtype,
      minPriceCents: filters.minPriceCents,
      maxPriceCents: filters.maxPriceCents,
      sort: filters.sort,
      page: filters.page,
      pageSize: filters.pageSize,
    };
    return apiRequest<Paginated<ListingDTO>>('/catalog/cards', { query });
  }
  // Compra sólo lista inventario publicado con precio: los fixtures ya lo garantizan.
  let data = [...fx.mockListings];
  if (filters.q) {
    const q = filters.q.toLowerCase();
    data = data.filter((l) => l.card.name.toLowerCase().includes(q));
  }
  if (filters.setId) data = data.filter((l) => l.card.setId === filters.setId);
  if (filters.rarity && filters.rarity.length) {
    const set = new Set(filters.rarity);
    data = data.filter((l) => set.has(l.card.rarity));
  }
  if (filters.productType) data = data.filter((l) => l.productType === filters.productType);
  if (filters.condition) data = data.filter((l) => l.rawCondition === filters.condition);
  if (filters.finish) data = data.filter((l) => l.finish === filters.finish);
  if (filters.sealedSubtype) data = data.filter((l) => l.sealedSubtype === filters.sealedSubtype);
  if (filters.minPriceCents != null)
    data = data.filter((l) => (l.salePriceCents ?? 0) >= filters.minPriceCents!);
  if (filters.maxPriceCents != null)
    data = data.filter((l) => (l.salePriceCents ?? 0) <= filters.maxPriceCents!);
  if (filters.sort === 'price_asc') data.sort((a, b) => (a.salePriceCents ?? 0) - (b.salePriceCents ?? 0));
  if (filters.sort === 'price_desc') data.sort((a, b) => (b.salePriceCents ?? 0) - (a.salePriceCents ?? 0));
  return delay({ data, page: 1, pageSize: 20, total: data.length });
}

/** Facetas dinámicas de Compra (contrato GET /catalog/facets, v1.1). */
export async function getCatalogFacets(): Promise<CatalogFacetsDTO> {
  if (!config.useMocks) return apiRequest<CatalogFacetsDTO>('/catalog/facets');
  return delay(fx.mockFacets);
}

export async function getSets(): Promise<CardSetDTO[]> {
  if (!config.useMocks) {
    const res = await apiRequest<{ data: CardSetDTO[] }>('/catalog/sets');
    return res.data;
  }
  return delay(fx.mockSets);
}

export async function getListing(inventoryItemId: string): Promise<ListingDTO> {
  if (!config.useMocks) return apiRequest<ListingDTO>(`/catalog/listings/${inventoryItemId}`);
  const found = fx.mockListings.find((l) => l.inventoryItemId === inventoryItemId);
  if (!found) throw new ApiClientError(404, { code: 'NOT_FOUND', message: 'Listing not found' });
  return delay(found);
}

export async function getCardDetail(cardId: string): Promise<CardDetailResponse> {
  if (!config.useMocks) return apiRequest<CardDetailResponse>(`/catalog/cards/${cardId}`);
  const listings = fx.mockListings.filter((l) => l.card.id === cardId);
  const card = listings[0]?.card ?? fx.mockCards.find((c) => c.id === cardId);
  if (!card) throw new ApiClientError(404, { code: 'NOT_FOUND', message: 'Card not found' });
  return delay({ card, listings });
}

// ---------- Bóveda / portafolio ----------
export async function getHoldings(): Promise<HoldingsResponse> {
  if (!config.useMocks) return apiRequest<HoldingsResponse>('/vault/holdings');
  return delay({ data: fx.mockHoldings, portfolio: fx.mockPortfolio });
}

/** Serie de tendencia del portafolio (contrato GET /vault/portfolio/history, v1.1). */
export async function getPortfolioHistory(
  range: PortfolioRange = '1m',
): Promise<PortfolioHistoryResponse> {
  if (!config.useMocks) {
    return apiRequest<PortfolioHistoryResponse>('/vault/portfolio/history', { query: { range } });
  }
  return delay(fx.generatePortfolioHistory(range));
}

/**
 * Serie PÚBLICA del valor de mercado del "set destacado" para el hero de la home
 * (contrato GET /catalog/featured-set/value-history, v1.9-set-chart). El set destacado
 * lo resuelve el backend (env HOME_FEATURED_SET_ID + fallback); el front NO envía ni
 * hardcodea id. `set` puede ser null (no hay CardSet para graficar → el hero degrada).
 */
export async function getFeaturedSetValueHistory(
  range: SetValueRange = '1m',
): Promise<SetValueHistoryResponse> {
  if (!config.useMocks) {
    return apiRequest<SetValueHistoryResponse>('/catalog/featured-set/value-history', {
      query: { range },
    });
  }
  return delay(fx.generateFeaturedSetValueHistory(range));
}

// ---------- Checkout / órdenes ----------
const IVA_PCT = 16; // MOCK: default del dial M10; el backend lo devuelve en BreakdownDTO.
const STRIPE_PCT = 0.036;
const STRIPE_FIXED = 300;

/** Réplica local de la fórmula de gross-up (ARCHITECTURE §5.1) para el mock. */
export function computeBreakdown(subtotalCents: number, ivaBaseCents = subtotalCents): BreakdownDTO {
  const ivaCents = Math.round((ivaBaseCents * IVA_PCT) / 100);
  const baseCents = subtotalCents + ivaCents;
  const totalCents = Math.ceil((baseCents + STRIPE_FIXED) / (1 - STRIPE_PCT));
  const processingFeeCents = totalCents - baseCents;
  return { subtotalCents, ivaCents, ivaRatePct: IVA_PCT, processingFeeCents, totalCents, currency: 'MXN' };
}

export async function getCheckoutQuote(inventoryItemIds: string[]): Promise<CheckoutQuoteResponse> {
  if (!config.useMocks) {
    return apiRequest<CheckoutQuoteResponse>('/checkout/quote', { method: 'POST', body: { inventoryItemIds } });
  }
  const items = inventoryItemIds
    .map((id) => fx.mockListings.find((l) => l.inventoryItemId === id))
    .filter((l): l is ListingDTO => !!l);
  const pending = items.find((l) => !l.sellable);
  if (pending) throw new ApiClientError(422, { code: 'PRICE_PENDING', message: 'Item price pending' });
  const subtotal = items.reduce((s, l) => s + (l.salePriceCents ?? 0), 0);
  return delay({
    items: items.map((l) => ({
      inventoryItemId: l.inventoryItemId,
      card: l.card,
      productType: l.productType,
      rawCondition: l.rawCondition,
      unitPriceCents: l.salePriceCents ?? 0,
    })),
    breakdown: computeBreakdown(subtotal),
  });
}

export async function getOrders(): Promise<Paginated<OrderSummaryDTO>> {
  if (!config.useMocks) return apiRequest<Paginated<OrderSummaryDTO>>('/orders');
  return delay({ data: fx.mockOrders, page: 1, pageSize: 20, total: fx.mockOrders.length });
}

export async function getOrder(orderId: string): Promise<OrderDetailDTO> {
  if (!config.useMocks) return apiRequest<OrderDetailDTO>(`/orders/${orderId}`);
  return delay({ ...fx.mockOrderDetail, id: orderId });
}

// ---------- Retiros / envíos ----------
export async function getShipmentQuote(
  inventoryItemIds: string[],
  addressId: string,
): Promise<ShipmentQuoteResponse> {
  if (!config.useMocks) {
    return apiRequest<ShipmentQuoteResponse>('/shipments/quote', {
      method: 'POST',
      body: { inventoryItemIds, addressId },
    });
  }
  const SHIPPING = 17500; // MOCK: dial M10 default.
  const holdings = inventoryItemIds
    .map((id) => fx.mockHoldings.find((h) => h.inventoryItemId === id))
    .filter(Boolean);
  const eligible = holdings.filter((h) => h!.ownershipStatus === 'settled').map((h) => h!.inventoryItemId);
  const ineligible = holdings
    .filter((h) => h!.ownershipStatus !== 'settled')
    .map((h) => ({ inventoryItemId: h!.inventoryItemId, reason: 'ITEM_NOT_SETTLED' }));
  return delay({ breakdown: computeBreakdown(SHIPPING, SHIPPING), eligibleItemIds: eligible, ineligible });
}

export async function getShipments(): Promise<ShipmentDTO[]> {
  if (!config.useMocks) {
    const res = await apiRequest<{ data: ShipmentDTO[] }>('/shipments');
    return res.data;
  }
  return delay(fx.mockShipments);
}

export interface AdminShipmentsFilters {
  status?: string;
  page?: number;
  pageSize?: number;
}

/**
 * COLA ADMIN de envíos de CLIENTES (contrato §M4 · GET /admin/shipments, `vault_operator+`).
 * Distinta de getShipments() (los envíos del PROPIO usuario). Paginada; filtro `?status=`.
 */
export async function getAdminShipments(
  filters: AdminShipmentsFilters = {},
): Promise<Paginated<AdminShipmentDTO>> {
  if (!config.useMocks) {
    return apiRequest<Paginated<AdminShipmentDTO>>('/admin/shipments', {
      query: { status: filters.status, page: filters.page, pageSize: filters.pageSize },
    });
  }
  let data = [...fx.mockAdminShipments];
  if (filters.status) data = data.filter((s) => s.status === filters.status);
  return delay(paginate(data, filters));
}

/**
 * Lista de picking ordenada por ubicación (contrato §M4 · GET /admin/shipments/picking-list).
 * Solo envíos en `picking`; `?date=` opcional (día de solicitud).
 */
export async function getAdminPickingList(date?: string): Promise<PickingListEntryDTO[]> {
  if (!config.useMocks) {
    const res = await apiRequest<{ data: PickingListEntryDTO[] }>('/admin/shipments/picking-list', {
      query: { date },
    });
    return res.data;
  }
  return delay([...fx.mockPickingList]);
}

/**
 * Captura de guía (M4, `vault_operator+`): asigna carrier + trackingNumber y avanza a `guia`
 * (contrato §M4 · POST /admin/shipments/:id/tracking).
 * `shippingCostCents` (v1.4-finance) es opcional (costo real en centavos MXN que la plataforma
 * paga a la paquetería); se envía solo cuando el operador lo captura. Entero ≥ 0.
 */
export async function saveShipmentTracking(
  shipmentId: string,
  input: ShipmentTrackingRequest,
): Promise<ShipmentDTO> {
  if (!config.useMocks) {
    return apiRequest<ShipmentDTO>(`/admin/shipments/${shipmentId}/tracking`, {
      method: 'POST',
      body: input,
    });
  }
  // MOCK: pendiente de backend real — actualiza el envío en memoria y lo avanza a `guia`.
  // Refleja el cambio también en la cola ADMIN (mockAdminShipments) para la vista M4.
  const adminIdx = fx.mockAdminShipments.findIndex((s) => s.id === shipmentId);
  if (adminIdx >= 0) {
    fx.mockAdminShipments[adminIdx] = {
      ...fx.mockAdminShipments[adminIdx],
      carrier: input.carrier,
      trackingNumber: input.trackingNumber,
      status: 'guia',
    };
  }
  const idx = fx.mockShipments.findIndex((s) => s.id === shipmentId);
  if (idx >= 0) {
    fx.mockShipments[idx] = {
      ...fx.mockShipments[idx],
      carrier: input.carrier,
      trackingNumber: input.trackingNumber,
      status: 'guia',
    };
    return delay(fx.mockShipments[idx]);
  }
  if (adminIdx >= 0) {
    return delay({
      id: shipmentId,
      status: 'guia',
      carrier: input.carrier,
      trackingNumber: input.trackingNumber,
      createdAt: fx.mockAdminShipments[adminIdx].requestedAt ?? new Date().toISOString(),
      items: [],
    });
  }
  throw new ApiClientError(404, { code: 'NOT_FOUND', message: 'Shipment not found' });
}

// ---------- Buylist ----------
// ---------- Cotizador · búsqueda sobre TODO el catálogo (contrato §6, v1.3) ----------
/**
 * Sets con cartas importadas para el dropdown del cotizador (contrato GET /buylist/sets).
 * A diferencia de GET /catalog/sets (solo sets con inventario publicado), aquí aparecen
 * TODOS los sets del catálogo.
 */
export async function listBuylistSets(): Promise<CardSetDTO[]> {
  if (!config.useMocks) {
    const res = await apiRequest<{ data: CardSetDTO[] }>('/buylist/sets');
    return res.data;
  }
  return delay(fx.mockSets);
}

export interface BuylistCardsFilters {
  setId?: string;
  q?: string;
  rarity?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Búsqueda paginada sobre TODA la tabla Card para el picker del cotizador
 * (contrato GET /buylist/cards). NO filtra por inventario ni por precio: una carta
 * fuera de bóveda también se puede vender (condición de compra siempre NM).
 */
export async function searchBuylistCards(
  filters: BuylistCardsFilters = {},
): Promise<Paginated<CardDTO>> {
  if (!config.useMocks) {
    return apiRequest<Paginated<CardDTO>>('/buylist/cards', {
      query: {
        setId: filters.setId,
        q: filters.q,
        rarity: filters.rarity,
        page: filters.page,
        pageSize: filters.pageSize,
      },
    });
  }
  // MOCK: busca sobre todo el catálogo (mockCards), no solo la vitrina de Compra.
  let data = [...fx.mockCards];
  if (filters.setId) data = data.filter((c) => c.setId === filters.setId);
  if (filters.q) {
    const q = filters.q.toLowerCase();
    data = data.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.number ?? '').toLowerCase().includes(q),
    );
  }
  if (filters.rarity) data = data.filter((c) => c.rarity === filters.rarity);
  return delay(paginate(data, filters));
}

export async function getBuylistQuote(input: {
  cardId: string;
  productType: ProductType;
  rawCondition?: RawCondition;
  /** v1.6-finish: acabado a cotizar; default `normal`. Debe pertenecer a card.availableFinishes. */
  finish?: Finish;
}): Promise<BuylistQuoteResponse> {
  if (!config.useMocks) {
    return apiRequest<BuylistQuoteResponse>('/buylist/quote', { method: 'POST', body: input });
  }
  // MOCK v1.3.1/v1.6-finish: el monto se resuelve por REGLA (fixed MX$ / pct % de la referencia
  // + fallback), donde el ACABADO selecciona la regla y la referencia. El backend deriva la
  // rareza + acabado server-side (SEC-A1); aquí lo replicamos para la demo.
  const card = fx.mockCards.find((c) => c.id === input.cardId);
  const rarity = card?.rarity ?? '';
  const finish: Finish = input.finish ?? 'normal';
  const { rule, source } = fx.resolveBuylistRuleForFinish(rarity, finish);
  const appliedRule = { mode: rule.mode, value: rule.value, source };
  // Referencia de mercado por carta+acabado (Zapdos = null → precio pendiente de adquisición).
  const refCents = fx.mockReferenceForFinish(input.cardId, finish);
  if (rule.mode === 'fixed') {
    // Fijo: NO depende de la referencia → siempre cotiza.
    return delay({
      rarity,
      finish,
      appliedRule,
      quote: { status: 'cotizada', quotedPriceCents: rule.value, currency: 'MXN' },
      referencePrice: refCents != null ? { status: 'priced', priceMxnCents: refCents } : { status: 'pending' },
      paymentNotice: 'PAY_AFTER_RECEIPT',
    });
  }
  // Porcentaje: si falta referencia del acabado → precio pendiente.
  if (refCents == null) {
    return delay({
      rarity,
      finish,
      appliedRule,
      quote: { status: 'precio_pendiente', quotedPriceCents: null, currency: 'MXN' },
      referencePrice: { status: 'pending' },
      paymentNotice: 'PAY_AFTER_RECEIPT',
    });
  }
  return delay({
    rarity,
    finish,
    appliedRule,
    quote: { status: 'cotizada', quotedPriceCents: Math.round((refCents * rule.value) / 100), currency: 'MXN' },
    referencePrice: { status: 'priced', priceMxnCents: refCents },
    paymentNotice: 'PAY_AFTER_RECEIPT',
  });
}

export async function getSellRequests(): Promise<SellRequestDTO[]> {
  if (!config.useMocks) {
    const res = await apiRequest<{ data: SellRequestDTO[] }>('/buylist/requests');
    return res.data;
  }
  return delay(fx.mockSellRequests);
}

export interface CreateSellRequestInput {
  // v1.3.1: los items YA NO envían `category`; el backend deriva la regla server-side
  // de Card.rarity (SEC-A1). Un `category` del cliente se ignoraría.
  // v1.6-finish: cada item lleva `finish?` (default normal, validado ∈ card.availableFinishes);
  // se snapshotea en SellRequestItem.finish y se propaga al InventoryItem al convertir (M5).
  items: {
    cardId: string;
    productType: ProductType;
    rawCondition?: RawCondition;
    finish?: Finish;
  }[];
  /**
   * CLABE destino en claro (18 dígitos). El contrato §6 la EXIGE en POST
   * /buylist/requests; solo puede omitirse con `useClabeOnFile` (atajo mock, abajo).
   */
  clabe?: string;
  /**
   * MOCK: pendiente de contrato — "Usar mi CLABE en archivo" sin reteclear. El
   * cliente nunca tiene la CLABE en claro (solo `clabeMasked`), así que este flag
   * solo funciona en modo mock. Solicitud al arquitecto: `clabe?` opcional en
   * POST /buylist/requests con fallback server-side a la CLABE de KYC (mismo
   * fallback que ya hace reveal-clabe). NO se envía al backend real.
   */
  useClabeOnFile?: boolean;
  /** keys de presign del INE (contrato §6 POST /buylist/requests: ineUploadKeys?) */
  ineUploadKeys?: IneUploadKeys;
}

/**
 * Crea la solicitud de venta (contrato POST /buylist/requests). Valida topes/KYC
 * en el backend; puede fallar con 422 INE_REQUIRED / CLABE_NOT_OWN_NAME /
 * BUYLIST_LIMIT_EXCEEDED. Las `ineUploadKeys` provienen del presign `kyc_ine`.
 */
export async function createSellRequest(input: CreateSellRequestInput): Promise<SellRequestDTO> {
  if (!config.useMocks) {
    // `useClabeOnFile` es un flag de cliente (atajo mock): NUNCA viaja al backend real,
    // cuyo contrato exige `clabe` en claro (§6).
    const { useClabeOnFile: _clientOnly, ...body } = input;
    return apiRequest<SellRequestDTO>('/buylist/requests', { method: 'POST', body });
  }
  // MOCK: replica el shape de la respuesta del contrato (SellRequestDTO). El monto se
  // resuelve por la REGLA de la rareza (v1.3.1), igual que el cotizador.
  const items: SellRequestDTO['items'] = input.items.map((it, i) => {
    const card = fx.mockCards.find((c) => c.id === it.cardId) ?? fx.mockCards[0];
    const finish: Finish = it.finish ?? 'normal';
    const ref = fx.mockReferenceForFinish(it.cardId, finish);
    const { rule, source } = fx.resolveBuylistRuleForFinish(card.rarity, finish);
    const quoted =
      rule.mode === 'fixed' ? rule.value : ref != null ? Math.round((ref * rule.value) / 100) : undefined;
    return {
      id: `sri-new-${i}`,
      card,
      productType: it.productType,
      rawCondition: it.rawCondition,
      finish,
      rarity: card.rarity,
      appliedRule: { mode: rule.mode, value: rule.value, source },
      quotedPriceCents: quoted,
      itemStatus: quoted == null ? 'precio_pendiente' : 'cotizada',
    };
  });
  const quotedTotalCents = items.reduce((s, it) => s + (it.quotedPriceCents ?? 0), 0);
  return delay({
    sellRequestId: `sr-${Math.floor(Math.random() * 9000 + 1000)}`,
    status: 'cotizada',
    quotedTotalCents,
    ineRequired: !!input.ineUploadKeys,
    items,
    createdAt: new Date().toISOString(),
  });
}

// ---------- KYC (contrato §1) ----------
export async function getKyc(): Promise<KycInfoDTO> {
  if (!config.useMocks) return apiRequest<KycInfoDTO>('/users/me/kyc');
  return delay(fx.mockKyc);
}

export interface UpdateKycInput {
  clabe?: string;
  ineFrontUploadKey?: string;
  ineBackUploadKey?: string;
}

/** Registra CLABE / keys del INE en el KYC del usuario (contrato PUT /users/me/kyc). */
export async function updateKyc(input: UpdateKycInput): Promise<KycInfoDTO> {
  if (!config.useMocks) {
    return apiRequest<KycInfoDTO>('/users/me/kyc', { method: 'PUT', body: input });
  }
  return delay({
    ...fx.mockKyc,
    clabeMasked: input.clabe ? `****${input.clabe.slice(-4)}` : fx.mockKyc.clabeMasked,
    ineOnFile: !!(input.ineFrontUploadKey && input.ineBackUploadKey) || fx.mockKyc.ineOnFile,
  });
}

// ---------- Uploads (contrato §8 — SOLO INE de KYC / kyc_ine) ----------
/** Límite de tamaño (bytes) del presign de `kyc_ine` en la rama mock (≈10 MB). */
const MOCK_PRESIGN_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Pide un presign para subir la imagen del INE (contrato POST /uploads/presign).
 * El contrato SOLO admite `purpose="kyc_ine"`; cualquier otro devuelve 422.
 * `contentType` debe ser el MIME real de la imagen (el backend endurece a `image/*`).
 * `contentLength` (bytes del archivo) es opcional en el contrato: cuando llega, el
 * backend lo fija en la firma (`ContentLength`) para que R2/S3 rechace cuerpos de
 * otro tamaño (residuo de endurecimiento S-B3, end-to-end).
 */
export async function presignUpload(input: {
  purpose: UploadPurpose;
  contentType: string;
  contentLength?: number;
}): Promise<UploadPresignResponse> {
  if (!config.useMocks) {
    return apiRequest<UploadPresignResponse>('/uploads/presign', { method: 'POST', body: input });
  }
  // MOCK: uploadUrl `mock://` para que uploadToPresignedUrl haga corto-circuito sin red.
  const rand = Math.random().toString(36).slice(2, 10);
  return delay({
    uploadKey: `kyc_ine/${rand}.img`,
    uploadUrl: `mock://storage/kyc_ine/${rand}`,
    method: 'PUT',
    headers: {},
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    maxBytes: MOCK_PRESIGN_MAX_BYTES,
  });
}

/**
 * Sube el archivo directo al object storage privado con el presign (PUT). Envía el
 * `Content-Type` de imagen correcto y NO adjunta el token de sesión (URL firmada).
 * Mapea 413 a un error de tamaño para reflejar el límite del backend.
 */
export async function uploadToPresignedUrl(
  presign: UploadPresignResponse,
  file: File,
): Promise<void> {
  if (config.useMocks && presign.uploadUrl.startsWith('mock://')) {
    await delay(undefined, 200);
    return;
  }
  const res = await fetch(presign.uploadUrl, {
    method: presign.method,
    headers: { 'Content-Type': file.type, ...presign.headers },
    body: file,
  });
  if (!res.ok) {
    const code = res.status === 413 ? 'FILE_TOO_LARGE' : 'UPLOAD_FAILED';
    throw new ApiClientError(res.status, { code, message: 'Upload to storage failed' });
  }
}

// ---------- Auth (contrato §1) ----------
function persistSession(res: AuthResponse): AuthResponse {
  setToken(res.accessToken);
  // WS-B: persistimos también el refresh token (contrato §1 lo devuelve en cada
  // login/register/google/refresh). Sin esto, al vencer el access token (15m) toda
  // request daba 401 y la sesión se caía a media corrida; el interceptor de api-client
  // lo canjea por un TokenPair nuevo (POST /auth/refresh) y reintenta.
  setRefreshToken(res.refreshToken);
  // Además del token, guardamos el usuario para que el header (y demás UI) pueda
  // reflejar la sesión de forma reactiva sin re-consultar al backend.
  setStoredUser(res.user);
  return res;
}

/**
 * Cierra la sesión (contrato POST /auth/logout → 204): invalida el refresh token
 * server-side y limpia la sesión local (token + user). Aunque el backend falle,
 * el cliente queda deslogueado. En modo mock solo limpia el estado local.
 */
export async function logout(): Promise<void> {
  try {
    if (!config.useMocks) await apiRequest<void>('/auth/logout', { method: 'POST' });
  } finally {
    setToken(null);
    // WS-B: limpiar también el refresh token para no dejar una credencial de larga vida
    // (30d) huérfana en localStorage tras cerrar sesión.
    setRefreshToken(null);
    setStoredUser(null);
  }
}

// MOCK: usuario de ejemplo cuando no hay backend (respeta el shape de AuthResponse).
function mockAuthResponse(over: Partial<AuthResponse['user']> = {}): AuthResponse {
  return {
    user: {
      id: 'u-mock',
      email: 'cliente@example.com',
      name: 'Cliente Demo',
      role: 'customer',
      locale: 'es',
      status: 'active',
      authProvider: 'local',
      emailVerified: true,
      ...over,
    },
    accessToken: 'mock.session.token',
    refreshToken: 'mock.refresh.token',
  };
}

export async function login(input: { email: string; password: string }): Promise<AuthResponse> {
  if (!config.useMocks) {
    return persistSession(await apiRequest<AuthResponse>('/auth/login', { method: 'POST', body: input }));
  }
  return delay(persistSession(mockAuthResponse({ email: input.email })), 400);
}

export async function register(input: {
  email: string;
  password: string;
  name: string;
  phone?: string;
  locale?: Locale;
}): Promise<AuthResponse> {
  if (!config.useMocks) {
    return persistSession(await apiRequest<AuthResponse>('/auth/register', { method: 'POST', body: input }));
  }
  return delay(persistSession(mockAuthResponse({ email: input.email, name: input.name })), 400);
}

/**
 * Login/registro con Google (contrato POST /auth/google, v1.1). El front obtiene
 * el `idToken` de Google Identity Services y lo canjea por los JWT propios;
 * la sesión resultante es idéntica a la de email/contraseña.
 */
export async function loginWithGoogle(idToken: string): Promise<AuthResponse> {
  if (!config.useMocks) {
    return persistSession(
      await apiRequest<AuthResponse>('/auth/google', { method: 'POST', body: { idToken } }),
    );
  }
  // MOCK: simula el canje del idToken sin backend (no verifica firma; sólo demo).
  return delay(
    persistSession(
      mockAuthResponse({
        email: 'google.user@gmail.com',
        name: 'Google User',
        authProvider: 'google',
        emailVerified: true,
        avatarUrl: undefined,
      }),
    ),
    500,
  );
}

// ---------- Verificación de correo + recuperación self-service (contrato §1, v1.5) ----------
/**
 * Consume el token del link de verificación (contrato POST /auth/verify-email, `public`).
 * Se abre desde el correo, quizá sin sesión. Éxito → { verified: true } y, si hay sesión
 * local del mismo usuario, marca `emailVerified=true` para quitar el banner sin re-consultar
 * `GET /users/me`. Error → 422 EMAIL_VERIFY_TOKEN_INVALID (inválido/expirado/ya usado).
 */
export async function verifyEmail(token: string): Promise<VerifyEmailResponse> {
  if (!config.useMocks) {
    const res = await apiRequest<VerifyEmailResponse>('/auth/verify-email', {
      method: 'POST',
      body: { token },
    });
    patchStoredUser({ emailVerified: true });
    return res;
  }
  // MOCK: pendiente de backend real. Un token vacío o con "invalid"/"expired" simula el
  // 422 del contrato; cualquier otro token verifica y actualiza la sesión local si existe.
  await delay(undefined, 300);
  if (!token || /invalid|expired|bad/i.test(token)) {
    throw new ApiClientError(422, {
      code: 'EMAIL_VERIFY_TOKEN_INVALID',
      message: 'Verification token invalid or expired',
    });
  }
  patchStoredUser({ emailVerified: true });
  return { verified: true };
}

/**
 * Reenvía el correo de verificación al email de la SESIÓN (contrato
 * POST /auth/verify-email/resend, `customer+`, sin body → cero enumeración).
 * Si el usuario ya está verificado responde no-op { ok: true }. 429 si excede el
 * rate-limit (3/hora por usuario).
 */
export async function resendVerificationEmail(): Promise<ResendVerificationResponse> {
  if (!config.useMocks) {
    return apiRequest<ResendVerificationResponse>('/auth/verify-email/resend', {
      method: 'POST',
      body: {},
    });
  }
  return delay({ ok: true }, 400);
}

/**
 * Solicita el link de restablecimiento (contrato POST /auth/forgot-password, `public`).
 * SIEMPRE responde { ok: true } exista o no el email (anti-enumeración): el front muestra
 * el mismo mensaje genérico sin revelar existencia. 429 si excede el rate-limit.
 */
export async function forgotPassword(email: string): Promise<ForgotPasswordResponse> {
  if (!config.useMocks) {
    return apiRequest<ForgotPasswordResponse>('/auth/forgot-password', {
      method: 'POST',
      body: { email },
    });
  }
  return delay({ ok: true }, 400);
}

/**
 * Consume el token de reset y fija la nueva contraseña (contrato POST /auth/reset-password,
 * `public`). NO devuelve tokens: el backend revoca sesiones (incrementa tokenVersion) y el
 * usuario re-inicia sesión. Error → 422 RESET_TOKEN_INVALID (inválido/expirado/usado) o
 * 400 VALIDATION_ERROR (contraseña débil; MinLength 8, misma política que register).
 */
export async function resetPassword(input: {
  token: string;
  password: string;
}): Promise<ResetPasswordSelfResponse> {
  if (!config.useMocks) {
    return apiRequest<ResetPasswordSelfResponse>('/auth/reset-password', {
      method: 'POST',
      body: input,
    });
  }
  // MOCK: token vacío o con "invalid"/"expired" → 422 del contrato; si no, éxito.
  await delay(undefined, 400);
  if (!input.token || /invalid|expired|bad/i.test(input.token)) {
    throw new ApiClientError(422, {
      code: 'RESET_TOKEN_INVALID',
      message: 'Reset token invalid or expired',
    });
  }
  return { ok: true };
}

// ---------- Admin ----------
export async function getDashboard(): Promise<DashboardDTO> {
  if (!config.useMocks) return apiRequest<DashboardDTO>('/admin/dashboard');
  return delay(fx.mockDashboard);
}

export interface AdminInventoryFilters {
  /** búsqueda por folio (backend: `folio contains q`, case-insensitive). */
  q?: string;
  status?: InventoryStatus;
  zone?: VaultZone;
  locationId?: string;
  cardId?: string;
  ownerType?: 'platform' | 'customer';
  page?: number;
  pageSize?: number;
}

/**
 * Tabla de inventario del back-office (contrato §M1 · GET /admin/inventory/items,
 * query `?status=&cardId=&ownerType=&locationId=&zone=&q=&page=&pageSize=`, `vault_operator+`).
 * Ola 2: ahora manda los filtros + paginación reales (antes iba sin query y quedaba
 * capada a los 20 primeros items).
 */
export async function getAdminInventory(
  filters: AdminInventoryFilters = {},
): Promise<Paginated<InventoryItemDTO>> {
  if (!config.useMocks) {
    return apiRequest<Paginated<InventoryItemDTO>>('/admin/inventory/items', {
      query: {
        q: filters.q,
        status: filters.status,
        zone: filters.zone,
        locationId: filters.locationId,
        cardId: filters.cardId,
        ownerType: filters.ownerType,
        page: filters.page,
        pageSize: filters.pageSize,
      },
    });
  }
  let data = [...fx.mockInventory];
  if (filters.q) {
    const q = filters.q.toLowerCase();
    data = data.filter((i) => i.folio.toLowerCase().includes(q));
  }
  if (filters.status) data = data.filter((i) => i.status === filters.status);
  if (filters.zone) data = data.filter((i) => i.location?.zone === filters.zone);
  if (filters.locationId) data = data.filter((i) => i.location?.id === filters.locationId);
  if (filters.cardId) data = data.filter((i) => i.card.id === filters.cardId);
  if (filters.ownerType) data = data.filter((i) => i.ownerType === filters.ownerType);
  return delay(paginate(data, filters));
}

// MOCK: localiza el item en fixtures o 404 (mismo shape de error del contrato).
function mockFindInventoryItem(id: string): InventoryItemDTO {
  const item = fx.mockInventory.find((i) => i.id === id);
  if (!item) throw new ApiClientError(404, { code: 'NOT_FOUND', message: 'Inventory item not found' });
  return item;
}

/**
 * Detalle por pieza + historial de movimientos (contrato §M1 ·
 * GET /admin/inventory/items/:id, `vault_operator+`).
 */
export async function getAdminInventoryItem(id: string): Promise<AdminInventoryItemDetailDTO> {
  if (!config.useMocks) {
    return apiRequest<AdminInventoryItemDetailDTO>(`/admin/inventory/items/${id}`);
  }
  const item = mockFindInventoryItem(id);
  return delay({ ...item, movements: [...(fx.mockInventoryMovements[id] ?? [])] });
}

export interface UpdateInventoryItemInput {
  /** Publicar (`listed`) / despublicar (`in_stock`). El backend solo acepta esos dos aquí. */
  status?: 'in_stock' | 'listed';
  /** Precio de venta MANUAL en centavos MXN (obligatorio para publicar sellado). */
  listPriceCents?: number;
  certNumber?: string;
  gradeValue?: string;
  sealedSubtype?: SealedSubtype;
}

/**
 * Edición/publicación del item (contrato §M1 · PATCH /admin/inventory/items/:id).
 * Publicar una gradeada sin certNumber devuelve 422 VALIDATION_ERROR (invariante v1.2,
 * revalidada server-side sobre el estado RESULTANTE del PATCH). `listPriceCents` es el
 * precio de venta MANUAL del operador (no se deriva en el cliente — SEC-A1 intacto).
 */
export async function updateInventoryItem(
  id: string,
  input: UpdateInventoryItemInput,
): Promise<InventoryItemDTO> {
  if (!config.useMocks) {
    return apiRequest<InventoryItemDTO>(`/admin/inventory/items/${id}`, {
      method: 'PATCH',
      body: input,
    });
  }
  const item = mockFindInventoryItem(id);
  // MOCK: replica la invariante v1.2 del backend (gradeada publicada exige certNumber).
  const resultingStatus = input.status ?? item.status;
  const resultingCert = input.certNumber !== undefined ? input.certNumber : item.certNumber;
  if (item.productType === 'graded' && resultingStatus === 'listed' && !resultingCert?.trim()) {
    throw new ApiClientError(422, {
      code: 'VALIDATION_ERROR',
      message: 'graded items require certNumber to be published',
    });
  }
  Object.assign(item, {
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.listPriceCents !== undefined ? { listPriceCents: input.listPriceCents } : {}),
    ...(input.certNumber !== undefined ? { certNumber: input.certNumber } : {}),
    ...(input.gradeValue !== undefined ? { gradeValue: input.gradeValue } : {}),
    ...(input.sealedSubtype !== undefined ? { sealedSubtype: input.sealedSubtype } : {}),
  });
  return delay({ ...item });
}

/**
 * Mueve el item a otra ubicación de bóveda (contrato §M1 ·
 * POST /admin/inventory/items/:id/move, req `{ toLocationId, note? }`).
 * Registra un InventoryMovement con reason=move.
 */
export async function moveInventoryItem(
  id: string,
  input: { toLocationId: string; note?: string },
): Promise<InventoryItemDTO> {
  if (!config.useMocks) {
    return apiRequest<InventoryItemDTO>(`/admin/inventory/items/${id}/move`, {
      method: 'POST',
      body: input,
    });
  }
  const item = mockFindInventoryItem(id);
  const to = fx.mockLocations.find((l) => l.id === input.toLocationId);
  if (!to) throw new ApiClientError(404, { code: 'NOT_FOUND', message: 'Location not found' });
  fx.pushMockMovement(id, {
    fromLocationId: item.location?.id,
    toLocationId: to.id,
    fromStatus: item.status,
    toStatus: item.status,
    reason: 'move',
    note: input.note,
  });
  item.location = { id: to.id, label: to.label, zone: to.zone };
  return delay({ ...item });
}

/**
 * Marca el item como perdida/dañada (contrato §M1 ·
 * POST /admin/inventory/items/:id/mark, req `{ mark: "lost"|"damaged", note }` — la nota
 * es OBLIGATORIA). Cambia `status` y registra el movimiento; queda disponible para
 * reposición (M7/tope M10).
 */
export async function markInventoryItem(
  id: string,
  input: { mark: 'lost' | 'damaged'; note: string },
): Promise<InventoryItemDTO> {
  if (!config.useMocks) {
    return apiRequest<InventoryItemDTO>(`/admin/inventory/items/${id}/mark`, {
      method: 'POST',
      body: input,
    });
  }
  const item = mockFindInventoryItem(id);
  const next: InventoryStatus = input.mark === 'lost' ? 'lost' : 'damaged';
  fx.pushMockMovement(id, {
    fromStatus: item.status,
    toStatus: next,
    reason: input.mark,
    note: input.note,
  });
  item.status = next;
  return delay({ ...item });
}

export interface CreateInventoryItemInput {
  /** id del CardDTO del catálogo real elegido en el picker (contrato §M1). */
  cardId: string;
  productType: ProductType;
  rawCondition?: RawCondition;
  /** v1.6-finish: acabado de la copia física; validado server-side ∈ Card.availableFinishes. */
  finish?: Finish;
  sealedSubtype?: SealedSubtype;
  gradingCompany?: GradingCompany;
  gradeValue?: string;
  certNumber?: string;
  locationId?: string;
  acquisitionType: AcquisitionType;
  acquisitionPct?: number;
  listPriceCents?: number;
}

export interface CreateInventoryItemResponse {
  id: string;
  folio: string;
  status: InventoryStatus;
  acquisitionCostCents: number;
}

/**
 * Alta de item de inventario (contrato POST /admin/inventory/items, §M1). El `cardId`
 * proviene del CardDTO del catálogo real (buylist/cards), NO de fixtures. El backend
 * deriva costo/referencia y valida `finish` ∈ Card.availableFinishes (422 FINISH_NOT_AVAILABLE).
 */
export async function createInventoryItem(
  input: CreateInventoryItemInput,
): Promise<CreateInventoryItemResponse> {
  if (!config.useMocks) {
    return apiRequest<CreateInventoryItemResponse>('/admin/inventory/items', {
      method: 'POST',
      body: input,
    });
  }
  // MOCK: pendiente de backend real — devuelve el shape 201 del contrato con folio simulado.
  const seq = String(fx.mockInventory.length + 1).padStart(6, '0');
  return delay({
    id: `inv-new-${seq}`,
    folio: `INV-${seq}`,
    status: 'in_stock',
    acquisitionCostCents: 0,
  });
}

export async function getLocations(): Promise<VaultLocationDTO[]> {
  if (!config.useMocks) {
    const res = await apiRequest<{ data: VaultLocationDTO[] }>('/admin/locations');
    return res.data;
  }
  return delay(fx.mockLocations);
}

export interface CreateLocationInput {
  zone: VaultZone;
  box: string;
  row: string;
  slot: string;
}

/**
 * Alta de ubicación de bóveda (contrato §M1 · POST /admin/locations,
 * req `{ zone, box, row, slot }`, `vault_operator+`). El backend deriva
 * `label = box-row-slot`. Ola 2: sin esto el dropdown de ubicación del alta
 * quedaba vacío en una BD limpia.
 */
export async function createLocation(input: CreateLocationInput): Promise<VaultLocationDTO> {
  if (!config.useMocks) {
    return apiRequest<VaultLocationDTO>('/admin/locations', { method: 'POST', body: input });
  }
  const created: VaultLocationDTO = {
    id: `loc-new-${fx.mockLocations.length + 1}`,
    ...input,
    label: `${input.box}-${input.row}-${input.slot}`,
  };
  fx.mockLocations.push(created);
  return delay(created);
}

export async function getAdminBuylist(): Promise<AdminBuylistDTO[]> {
  if (!config.useMocks) {
    const res = await apiRequest<Paginated<AdminBuylistDTO>>('/admin/buylist');
    return res.data;
  }
  return delay(fx.mockAdminBuylist);
}

// ---- Admin M5 · acciones de buylist (contrato §M5) ----
// MOCK: helpers en memoria para reflejar las transiciones en fixtures.
function mockFindBuylistRequest(id: string): AdminBuylistDTO {
  const req = fx.mockAdminBuylist.find((r) => r.id === id);
  if (!req) throw new ApiClientError(404, { code: 'NOT_FOUND', message: 'Sell request not found' });
  return req;
}
function mockFindBuylistItem(itemId: string): { req: AdminBuylistDTO; item: SellItemDTO } {
  for (const req of fx.mockAdminBuylist) {
    const item = req.items.find((it) => it.id === itemId);
    if (item) return { req, item };
  }
  throw new ApiClientError(404, { code: 'NOT_FOUND', message: 'Sell request item not found' });
}

/** Marca recepción física de la solicitud → `recibida` (contrato POST /admin/buylist/:id/receive). */
export async function receiveBuylistRequest(id: string): Promise<AdminBuylistDTO> {
  if (!config.useMocks) {
    return apiRequest<AdminBuylistDTO>(`/admin/buylist/${id}/receive`, { method: 'POST', body: {} });
  }
  const req = mockFindBuylistRequest(id);
  req.status = 'recibida';
  for (const it of req.items) {
    if (it.itemStatus === 'cotizada' || it.itemStatus === 'precio_pendiente') it.itemStatus = 'recibida';
  }
  return delay({ ...req });
}

/** Inicia/registra la verificación → `verificacion` (contrato POST /admin/buylist/:id/verify). */
export async function verifyBuylistRequest(id: string): Promise<AdminBuylistDTO> {
  if (!config.useMocks) {
    return apiRequest<AdminBuylistDTO>(`/admin/buylist/${id}/verify`, { method: 'POST', body: {} });
  }
  const req = mockFindBuylistRequest(id);
  req.status = 'verificacion';
  for (const it of req.items) if (it.itemStatus === 'recibida') it.itemStatus = 'verificacion';
  return delay({ ...req });
}

/**
 * Cherry-pick por carta (contrato PATCH /admin/buylist/items/:itemId/decision).
 * `adjust` exige `approvedPriceCents`; el backend valida el tope B-4/AML y puede responder
 * 422 APPROVED_PRICE_CAP_EXCEEDED (se muestra el mensaje real al operador).
 */
export async function decideBuylistItem(
  itemId: string,
  input: BuylistItemDecisionInput,
): Promise<SellItemDTO> {
  if (!config.useMocks) {
    return apiRequest<SellItemDTO>(`/admin/buylist/items/${itemId}/decision`, {
      method: 'PATCH',
      body: input,
    });
  }
  const { item } = mockFindBuylistItem(itemId);
  const next: Record<BuylistItemDecisionInput['decision'], SellItemStatus> = {
    approve: 'aprobada',
    adjust: 'ajustada',
    reject: 'rechazada',
  };
  item.itemStatus = next[input.decision];
  if (input.decision !== 'reject') {
    item.approvedPriceCents = input.approvedPriceCents ?? item.quotedPriceCents ?? 0;
  }
  return delay({ ...item });
}

/**
 * Conversión a inventario en un clic (contrato POST /admin/buylist/items/:itemId/convert-to-inventory).
 * Solo un item `aprobada` es convertible (422 ITEM_NOT_APPROVED); idempotente si ya se convirtió.
 */
export async function convertBuylistItemToInventory(
  itemId: string,
): Promise<ConvertToInventoryResponse> {
  if (!config.useMocks) {
    return apiRequest<ConvertToInventoryResponse>(
      `/admin/buylist/items/${itemId}/convert-to-inventory`,
      { method: 'POST', body: {} },
    );
  }
  const { item } = mockFindBuylistItem(itemId);
  if (item.itemStatus === 'convertida_inventario') {
    return delay({ inventoryItemId: item.inventoryItemId, alreadyConverted: true });
  }
  if (item.itemStatus !== 'aprobada') {
    throw new ApiClientError(422, {
      code: 'ITEM_NOT_APPROVED',
      message: 'Only an approved sell item can be converted to sellable inventory',
    });
  }
  const seq = String(fx.mockInventory.length + 20).padStart(6, '0');
  item.itemStatus = 'convertida_inventario';
  item.inventoryItemId = `inv-new-${seq}`;
  return delay({ inventoryItemId: item.inventoryItemId, folio: `INV-${seq}` });
}

/**
 * Reveal ON-DEMAND de la CLABE completa (contrato GET /admin/buylist/:id/reveal-clabe,
 * `super_admin`, money-out, AUDITADO). La CLABE en claro NO debe persistirse en estado
 * global ni cachearse (usar mutation, no query): se muestra solo al pedirla.
 */
export async function revealBuylistClabe(id: string): Promise<RevealClabeResponse> {
  if (!config.useMocks) {
    return apiRequest<RevealClabeResponse>(`/admin/buylist/${id}/reveal-clabe`);
  }
  mockFindBuylistRequest(id);
  return delay({ sellRequestId: id, clabe: '002010077777777771' });
}

/**
 * Registra el pago SPEI manual → `pagada` (contrato POST /admin/buylist/:id/pay-spei,
 * `super_admin`, money-out, Idempotency-Key). Precondición backend: aprobada + verificada.
 */
export async function paySpeiBuylist(id: string, speiReference: string): Promise<AdminBuylistDTO> {
  if (!config.useMocks) {
    return apiRequest<AdminBuylistDTO>(`/admin/buylist/${id}/pay-spei`, {
      method: 'POST',
      body: { speiReference },
      // Clave estable por solicitud: un reintento del mismo pago no duplica el asiento.
      headers: { 'Idempotency-Key': `pay-spei-${id}` },
    });
  }
  const req = mockFindBuylistRequest(id);
  if (req.status !== 'aprobada' && req.status !== 'verificacion') {
    throw new ApiClientError(422, {
      code: 'VALIDATION_ERROR',
      message: 'Payment allowed only after receipt/verification and approval',
    });
  }
  req.status = 'pagada';
  for (const it of req.items) if (it.itemStatus === 'aprobada') it.itemStatus = 'pagada';
  return delay({ ...req });
}

export async function getAdminOrders(): Promise<AdminOrderDTO[]> {
  if (!config.useMocks) {
    const res = await apiRequest<Paginated<AdminOrderDTO>>('/admin/orders');
    return res.data;
  }
  return delay(fx.mockAdminOrders);
}

/**
 * Reembolso EXCEPCIONAL de una orden liquidada (contrato POST /admin/orders/:id/refund,
 * `super_admin`, money-out, Idempotency-Key). Política VENTAS FINALES: solo por error de
 * la plataforma; NO re-agrega el item al inventario. Err 403 MONEY_OUT_FORBIDDEN.
 */
export async function refundOrder(orderId: string, reason: string): Promise<RefundOrderResponse> {
  if (!config.useMocks) {
    return apiRequest<RefundOrderResponse>(`/admin/orders/${orderId}/refund`, {
      method: 'POST',
      body: { reason },
      // Clave estable por orden: reintentos del mismo refund no duplican el movimiento.
      headers: { 'Idempotency-Key': `refund-${orderId}` },
    });
  }
  const order = fx.mockAdminOrders.find((o) => o.id === orderId);
  if (!order) throw new ApiClientError(404, { code: 'NOT_FOUND', message: 'Order not found' });
  if (order.status !== 'settled') {
    throw new ApiClientError(422, {
      code: 'VALIDATION_ERROR',
      message: 'Only a settled order can be refunded',
    });
  }
  order.status = 'refunded';
  return delay({ orderId, status: 'refunded', refundId: `re_mock_${orderId}` });
}

export async function getAdminDisputes(): Promise<DisputeDTO[]> {
  if (!config.useMocks) {
    const res = await apiRequest<Paginated<DisputeDTO>>('/admin/disputes');
    return res.data;
  }
  return delay(fx.mockDisputes);
}

export async function getAdminDispute(id: string): Promise<DisputeDTO> {
  if (!config.useMocks) return apiRequest<DisputeDTO>(`/admin/disputes/${id}`);
  const found = fx.mockDisputes.find((d) => d.id === id) ?? fx.mockDisputes[0];
  return delay(found);
}

/**
 * Resolución de disputa (contrato POST /admin/disputes/:id/resolve). `repurchase` es
 * dinero saliente (recompra al precio pagado, `super_admin`; el cliente conserva la carta
 * y NO se re-agrega al inventario); `reject` la rechaza. `note` es obligatoria (bitácora).
 */
export async function resolveDispute(id: string, input: ResolveDisputeInput): Promise<DisputeDTO> {
  if (!config.useMocks) {
    return apiRequest<DisputeDTO>(`/admin/disputes/${id}/resolve`, { method: 'POST', body: input });
  }
  const dispute = fx.mockDisputes.find((d) => d.id === id);
  if (!dispute) throw new ApiClientError(404, { code: 'NOT_FOUND', message: 'Dispute not found' });
  if (dispute.status === 'resuelta_recompra' || dispute.status === 'rechazada') {
    throw new ApiClientError(409, { code: 'CONFLICT', message: 'Dispute already resolved' });
  }
  dispute.status = input.resolution === 'repurchase' ? 'resuelta_recompra' : 'rechazada';
  return delay({ ...dispute });
}

// ---------- Admin M2 · Catálogo y precios (contrato §M2) ----------
/** Dispara/encola el sync diario de precios de bóveda (contrato POST /admin/pricing/sync). */
export async function syncPricing(input: {
  scope?: 'all_vault' | 'cardIds';
  cardIds?: string[];
} = {}): Promise<PricingSyncResponse> {
  if (!config.useMocks) {
    return apiRequest<PricingSyncResponse>('/admin/pricing/sync', { method: 'POST', body: input });
  }
  return delay({ jobId: mockJobId(), queued: fx.mockListings.length });
}

/** Cola de precio pendiente (contrato GET /admin/pricing/pending). */
export async function getPendingPrices(): Promise<PendingPriceEntryDTO[]> {
  if (!config.useMocks) {
    const res = await apiRequest<{ data: PendingPriceEntryDTO[] }>('/admin/pricing/pending');
    return res.data;
  }
  return delay(fx.mockPendingPrices);
}

export interface PricingOverrideInput {
  cardId: string;
  productType: ProductType;
  gradeKey: string;
  /**
   * v1.6-finish/v1.8: acabado a resolver (default backend `normal`). La cola de pendientes
   * es POR ACABADO: omitirlo resolvería el pendiente de `normal` y dejaría abierto el real.
   */
  finish?: Finish;
  priceMxnCents: number;
}

/** Override manual de precio; resuelve el PendingPriceEntry DE ESE ACABADO (contrato POST /admin/pricing/override). */
export async function overridePrice(input: PricingOverrideInput): Promise<{ ok: true }> {
  if (!config.useMocks) {
    await apiRequest<unknown>('/admin/pricing/override', { method: 'POST', body: input });
    return { ok: true };
  }
  // MOCK: resuelve la entrada pendiente asociada a esa carta/gradeKey/acabado.
  const finish = input.finish ?? 'normal';
  const entry = fx.mockPendingPrices.find(
    (p) => p.cardId === input.cardId && p.gradeKey === input.gradeKey && p.finish === finish,
  );
  if (entry) fx.resolveMockPending(entry.id);
  return delay({ ok: true });
}

/** Historial de precios por fecha/fuente (contrato GET /admin/pricing/card/:cardId). */
export async function getPriceHistory(cardId: string): Promise<PriceHistoryEntryDTO[]> {
  if (!config.useMocks) {
    const res = await apiRequest<{ data: PriceHistoryEntryDTO[] }>(`/admin/pricing/card/${cardId}`);
    return res.data;
  }
  return delay(fx.mockPriceHistory(cardId));
}

/** Tipo de cambio USD→MXN con colchón (contrato GET /admin/fx). */
export async function getFx(): Promise<FxDTO> {
  if (!config.useMocks) return apiRequest<FxDTO>('/admin/fx');
  return delay(fx.mockFx);
}

/** Fija override manual de FX (contrato PUT /admin/fx). */
export async function updateFx(input: { rate: number; bufferPct: number }): Promise<FxDTO> {
  if (!config.useMocks) return apiRequest<FxDTO>('/admin/fx', { method: 'PUT', body: input });
  const next: FxDTO = { rate: input.rate, bufferPct: input.bufferPct, source: 'manual', effectiveDate: new Date().toISOString().slice(0, 10) };
  fx.setMockFx(next);
  return delay(next);
}

/** Fuerza el fetch de FX a Banxico (contrato POST /admin/fx/refresh). */
export async function refreshFx(): Promise<FxDTO> {
  if (!config.useMocks) return apiRequest<FxDTO>('/admin/fx/refresh', { method: 'POST' });
  const next: FxDTO = { ...fx.mockFx, source: 'banxico', effectiveDate: new Date().toISOString().slice(0, 10) };
  fx.setMockFx(next);
  return delay(next);
}

/**
 * Rarezas distintas del catálogo sincronizado UNIDAS a las reglas de buylist, para
 * poblar el editor de precio por rareza (contrato GET /admin/pricing/rarities, v1.3.1).
 * Las rarezas sin regla explícita muestran el fallback (source="fallback").
 */
export async function getBuylistRarities(): Promise<BuylistRaritiesResponse> {
  if (!config.useMocks) return apiRequest<BuylistRaritiesResponse>('/admin/pricing/rarities');
  return delay(fx.mockBuylistRarities());
}

/** Tabla cruda de reglas + fallback (contrato GET /admin/pricing/buylist-rules, v1.3.1). */
export async function getBuylistRules(): Promise<BuylistRulesDTO> {
  if (!config.useMocks) return apiRequest<BuylistRulesDTO>('/admin/pricing/buylist-rules');
  return delay({ rules: fx.mockBuylistRules, fallbackPct: fx.mockBuylistFallbackPct });
}

/**
 * Reemplaza la tabla de reglas y/o el fallback (contrato PUT /admin/pricing/buylist-rules).
 * Validación server-side: mode ∈ {fixed,pct}; fixed → value entero ≥ 0 (centavos);
 * pct/fallback → número en [0,100]. Auditado (M10). Surte efecto sin redeploy.
 */
export async function updateBuylistRules(input: {
  rules: Record<string, BuylistRule>;
  fallbackPct?: number;
}): Promise<BuylistRulesDTO> {
  if (!config.useMocks) {
    return apiRequest<BuylistRulesDTO>('/admin/pricing/buylist-rules', { method: 'PUT', body: input });
  }
  fx.setMockBuylistRules(input.rules, input.fallbackPct);
  return delay({ rules: fx.mockBuylistRules, fallbackPct: fx.mockBuylistFallbackPct });
}

/**
 * Rarezas distintas del catálogo sincronizado UNIDAS a las reglas de VENTA, para poblar el
 * editor de precio de venta por rareza (contrato GET /admin/pricing/sales-rarities,
 * v1.13-sales-pricing). Clon de getBuylistRarities pero para el precio de VENTA. Las rarezas
 * sin regla explícita muestran el fallback (source="fallback").
 */
export async function getSalesRarities(): Promise<SalesRaritiesResponse> {
  if (!config.useMocks) return apiRequest<SalesRaritiesResponse>('/admin/pricing/sales-rarities');
  return delay(fx.mockSalesRarities());
}

/** Tabla cruda de reglas de VENTA + fallback (contrato GET /admin/pricing/sales-rules, v1.13). */
export async function getSalesRules(): Promise<SalesRulesDTO> {
  if (!config.useMocks) return apiRequest<SalesRulesDTO>('/admin/pricing/sales-rules');
  return delay({ rules: fx.mockSalesRules, fallbackPct: fx.mockSalesFallbackPct });
}

/**
 * Reemplaza la tabla de reglas de VENTA y/o el fallback (contrato PUT /admin/pricing/sales-rules).
 * Validación server-side: mode ∈ {fixed,pct}; fixed → value entero ≥ 0 (centavos, PISO);
 * pct/fallback → número en [0,1000] (markup ARRIBA de mercado; puede >100% a diferencia del pct
 * de buylist). Auditado (M10). Surte efecto sin redeploy.
 */
export async function updateSalesRules(input: {
  rules: Record<string, SalesRule>;
  fallbackPct?: number;
}): Promise<SalesRulesDTO> {
  if (!config.useMocks) {
    return apiRequest<SalesRulesDTO>('/admin/pricing/sales-rules', { method: 'PUT', body: input });
  }
  fx.setMockSalesRules(input.rules, input.fallbackPct);
  return delay({ rules: fx.mockSalesRules, fallbackPct: fx.mockSalesFallbackPct });
}

/** Sets remotos de pokemontcg.io con estado local (contrato GET /admin/catalog/remote-sets). */
export async function getRemoteSets(): Promise<RemoteSetDTO[]> {
  if (!config.useMocks) {
    const res = await apiRequest<{ data: RemoteSetDTO[] }>('/admin/catalog/remote-sets');
    return res.data;
  }
  return delay(fx.mockRemoteSets);
}

/** Importa/actualiza cartas de catálogo (contrato POST /admin/catalog/sync). */
export async function syncCatalog(input: {
  setId?: string;
  fromReleaseDate?: string;
} = {}): Promise<CatalogSyncResponse> {
  if (!config.useMocks) {
    return apiRequest<CatalogSyncResponse>('/admin/catalog/sync', { method: 'POST', body: input });
  }
  return delay({
    jobId: mockJobId(),
    setsQueued: input.setId ? 1 : fx.mockRemoteSets.filter((s) => !s.imported).length,
    mode: input.setId ? 'single' : 'from_date',
  });
}

/** Importa el siguiente lote de sets más antiguos aún no importados (contrato POST /admin/catalog/backfill). */
export async function backfillCatalog(input: {
  batchSize?: number;
  untilYear?: number;
} = {}): Promise<CatalogBackfillResponse> {
  if (!config.useMocks) {
    return apiRequest<CatalogBackfillResponse>('/admin/catalog/backfill', { method: 'POST', body: input });
  }
  const pending = fx.mockRemoteSets.filter((s) => !s.imported);
  const batch = pending.slice(0, input.batchSize ?? 10);
  return delay({
    imported: batch.map((s) => ({ id: s.id, name: s.name, releaseDate: s.releaseDate, cardCount: s.printedTotal ?? 0 })),
    newBoundary: batch[batch.length - 1]?.releaseDate ?? '',
    remaining: Math.max(0, pending.length - batch.length),
  });
}

/**
 * Importa TODO el catálogo (contrato POST /admin/catalog/sync-all, v1.3). Puede no
 * existir aún en backend; el front lo usa condicionalmente y trata 404/405 como
 * "no disponible" (fallback al sync por set / backfill).
 *
 * `force` (v1.6-finish, contrato §M2): default `false` mantiene el comportamiento
 * actual (salta sets ya importados). `force=true` reprocesa TODO el catálogo
 * (incluidos los sets ya importados) para repoblar `availableFinishes`/precios por
 * acabado tras la migración M-18. Aditivo y retrocompatible: sin el flag el body
 * va vacío como antes.
 */
export async function syncAllCatalog(
  input: { force?: boolean } = {},
): Promise<CatalogSyncAllResponse> {
  if (!config.useMocks) {
    // Solo se incluye `force` en el body cuando es true (retrocompatible: omitirlo
    // preserva el contrato/semántica previos, contrato §M2 v1.6-finish).
    const body = input.force ? { force: true } : {};
    return apiRequest<CatalogSyncAllResponse>('/admin/catalog/sync-all', { method: 'POST', body });
  }
  // force=true no filtra los sets ya importados: encola TODOS para repoblar.
  const sets = input.force
    ? fx.mockRemoteSets.length
    : fx.mockRemoteSets.filter((s) => !s.imported).length;
  return delay({ jobId: mockJobId(), setsQueued: sets, remaining: 0 });
}

/**
 * Progreso del barrido `sync-all` (contrato GET /admin/catalog/sync-status). Pensado para
 * POLLING desde M2: da done/total en sets y el momento en que termina, sin llamar a
 * pokemontcg.io. Puede no existir aún en backend (v1.11): el llamador trata 404/405 como
 * "no disponible" y simplemente no pinta la barra.
 */
export async function getSyncStatus(): Promise<CatalogSyncStatusResponse> {
  if (!config.useMocks) {
    return apiRequest<CatalogSyncStatusResponse>('/admin/catalog/sync-status');
  }
  // Mock: nunca hay un barrido corriendo (el estado vive en memoria del backend real).
  return delay({ running: false, jobId: null, total: 0, done: 0, startedAt: null, finishedAt: null });
}

// ---------- Admin M6 · Usuarios / KYC (contrato §M6) ----------
export interface AdminUsersFilters {
  q?: string;
  status?: 'active' | 'blocked';
  page?: number;
  pageSize?: number;
}

/** Listado paginado de usuarios con filtros q + status (contrato GET /admin/users). */
export async function getAdminUsers(filters: AdminUsersFilters = {}): Promise<Paginated<AdminUserSummaryDTO>> {
  if (!config.useMocks) {
    return apiRequest<Paginated<AdminUserSummaryDTO>>('/admin/users', {
      query: {
        q: filters.q,
        status: filters.status,
        page: filters.page,
        pageSize: filters.pageSize,
      },
    });
  }
  let data = [...fx.mockAdminUsers];
  if (filters.q) {
    const q = filters.q.toLowerCase();
    data = data.filter((u) => u.email.toLowerCase().includes(q) || u.name.toLowerCase().includes(q));
  }
  if (filters.status) data = data.filter((u) => u.status === filters.status);
  return delay(paginate(data, filters));
}

/** Ficha 360° del usuario (contrato GET /admin/users/:id). CLABE/RFC enmascarados. */
export async function getAdminUser(id: string): Promise<AdminUserDetailDTO> {
  if (!config.useMocks) return apiRequest<AdminUserDetailDTO>(`/admin/users/${id}`);
  return delay(fx.mockAdminUserDetail(id));
}

export interface UpdateUserKycInput {
  kycStatus: KycStatus;
  capPerRequestCents?: number;
  capPerMonthCents?: number;
}

/** Actualiza el KYC del usuario (contrato PATCH /admin/users/:id/kyc, super_admin). */
export async function updateUserKyc(id: string, input: UpdateUserKycInput): Promise<AdminUserDetailDTO> {
  if (!config.useMocks) {
    return apiRequest<AdminUserDetailDTO>(`/admin/users/${id}/kyc`, { method: 'PATCH', body: input });
  }
  const detail = fx.mockAdminUserDetail(id);
  return delay({
    ...detail,
    kycProfile: detail.kycProfile
      ? {
          ...detail.kycProfile,
          kycStatus: input.kycStatus,
          capPerRequestCents: input.capPerRequestCents ?? detail.kycProfile.capPerRequestCents,
          capPerMonthCents: input.capPerMonthCents ?? detail.kycProfile.capPerMonthCents,
        }
      : detail.kycProfile,
  });
}

/** Bloquea/activa la cuenta (contrato PATCH /admin/users/:id/status, super_admin). */
export async function updateUserStatus(
  id: string,
  status: 'active' | 'blocked',
): Promise<AdminUserDetailDTO> {
  if (!config.useMocks) {
    return apiRequest<AdminUserDetailDTO>(`/admin/users/${id}/status`, { method: 'PATCH', body: { status } });
  }
  return delay({ ...fx.mockAdminUserDetail(id), status });
}

/**
 * Restablece la contraseña del usuario (contrato POST /admin/users/:id/reset-password,
 * super_admin, auditado). Devuelve la contraseña temporal EN CLARO una única vez; el
 * front la muestra al admin para compartirla y NO la re-consulta.
 */
export async function resetUserPassword(id: string): Promise<ResetPasswordResponse> {
  if (!config.useMocks) {
    return apiRequest<ResetPasswordResponse>(`/admin/users/${id}/reset-password`, { method: 'POST', body: {} });
  }
  // MOCK: contraseña temporal aleatoria de alta entropía (simulada).
  const tempPassword = mockTempPassword();
  return delay({ userId: id, tempPassword, mustChangePassword: true });
}

/**
 * Elimina el usuario (contrato DELETE /admin/users/:id, super_admin, auditado). El backend
 * decide `hard` (borrado total, sin historial económico) o `soft` (anonimizado, conserva
 * historial). El front muestra el `mode` resultante. 409 CANNOT_DELETE_SELF si es uno mismo.
 */
export async function deleteUser(id: string): Promise<DeleteUserResponse> {
  if (!config.useMocks) {
    return apiRequest<DeleteUserResponse>(`/admin/users/${id}`, { method: 'DELETE' });
  }
  // MOCK: un usuario con historial económico (órdenes/buylist) cae en soft; el resto hard.
  const detail = fx.mockAdminUserDetail(id);
  const hasHistory =
    (detail.orders?.length ?? 0) > 0 ||
    (detail.sellRequests?.length ?? 0) > 0 ||
    (detail.disputes?.length ?? 0) > 0 ||
    (detail.ownedItems?.length ?? 0) > 0;
  return delay({ userId: id, mode: hasHistory ? 'soft' : 'hard' });
}

export interface CreateAdminUserInput {
  email: string;
  name: string;
  role: Role;
  /** Si se omite, el backend autogenera una temporal de alta entropía y la devuelve UNA vez. */
  password?: string;
  phone?: string;
  locale?: Locale;
}

/**
 * Alta de usuario por rol desde back-office (contrato §M6 · POST /admin/users, v1.7-admin-users,
 * super_admin, auditado `user.create`, NO money-out). Si `password` se omite el backend autogenera
 * una temporal y la devuelve UNA sola vez en `tempPassword` (patrón reset M-15). El email se
 * lowercasea server-side. Errores: 409 EMAIL_TAKEN, 422 VALIDATION_ERROR, 403 FORBIDDEN.
 */
export async function createAdminUser(input: CreateAdminUserInput): Promise<AdminCreatedUserDTO> {
  if (!config.useMocks) {
    return apiRequest<AdminCreatedUserDTO>('/admin/users', { method: 'POST', body: input });
  }
  // MOCK: pendiente de backend real — replica el shape 201 del contrato. Autogenera la
  // temporal solo cuando el admin no envía password; simula 409 si el email ya existe.
  const email = input.email.trim().toLowerCase();
  if (fx.mockAdminUsers.some((u) => u.email.toLowerCase() === email)) {
    throw new ApiClientError(409, { code: 'EMAIL_TAKEN', message: 'Email already registered' });
  }
  const autogenerated = !input.password;
  const tempPassword = autogenerated ? mockTempPassword() : undefined;
  const seq = Math.floor(Math.random() * 9000 + 1000);
  return delay({
    user: {
      id: `u-new-${seq}`,
      email,
      name: input.name,
      role: input.role,
      locale: input.locale ?? 'es',
      status: 'active',
      emailVerified: true,
      authProvider: 'local',
      createdAt: new Date().toISOString(),
    },
    tempPassword,
    mustChangePassword: autogenerated,
  });
}

// ---- M6 · Historial 360° por usuario (contrato §M6, v1.7-admin-users) ----
// El historial NO engorda getUser: se arma por REUSO de los listados admin ya paginados
// filtrando por ?userId= (simetría con GET /admin/orders) + GET /admin/users/:id/audit.
export interface UserHistoryParams {
  page?: number;
  pageSize?: number;
}
export type UserAuditScope = 'target' | 'actor' | 'both';

/** Compras del usuario (contrato §M3 · GET /admin/orders?userId=). Paginado. */
export async function getAdminUserOrders(
  userId: string,
  params: UserHistoryParams = {},
): Promise<Paginated<AdminOrderDTO>> {
  if (!config.useMocks) {
    return apiRequest<Paginated<AdminOrderDTO>>('/admin/orders', {
      query: { userId, page: params.page, pageSize: params.pageSize },
    });
  }
  return delay(paginate(fx.mockAdminOrders.filter((o) => o.userId === userId), params));
}

/** Ventas/buylist del usuario (contrato §M5 · GET /admin/buylist?userId=). Paginado. */
export async function getAdminUserBuylist(
  userId: string,
  params: UserHistoryParams = {},
): Promise<Paginated<AdminBuylistDTO>> {
  if (!config.useMocks) {
    return apiRequest<Paginated<AdminBuylistDTO>>('/admin/buylist', {
      query: { userId, page: params.page, pageSize: params.pageSize },
    });
  }
  return delay(paginate(fx.mockAdminBuylist.filter((b) => b.userId === userId), params));
}

/** Envíos del usuario (contrato §M4 · GET /admin/shipments?userId=, NUEVO v1.7). Paginado. */
export async function getAdminUserShipments(
  userId: string,
  params: UserHistoryParams = {},
): Promise<Paginated<ShipmentDTO>> {
  if (!config.useMocks) {
    return apiRequest<Paginated<ShipmentDTO>>('/admin/shipments', {
      query: { userId, page: params.page, pageSize: params.pageSize },
    });
  }
  return delay(paginate(fx.mockUserShipments(userId), params));
}

/** Disputas del usuario (contrato §M8 · GET /admin/disputes?userId=). Paginado. */
export async function getAdminUserDisputes(
  userId: string,
  params: UserHistoryParams = {},
): Promise<Paginated<DisputeDTO>> {
  if (!config.useMocks) {
    return apiRequest<Paginated<DisputeDTO>>('/admin/disputes', {
      query: { userId, page: params.page, pageSize: params.pageSize },
    });
  }
  return delay(paginate(fx.mockUserDisputes(userId), params));
}

/**
 * Actividad / auditoría del usuario (contrato §M6 · GET /admin/users/:id/audit, NUEVO v1.7).
 * `scope` default `target` (acciones SOBRE el usuario). `ip` solo lo puebla el backend para
 * super_admin; el front lo muestra únicamente si viene (respeta la proyección por rol).
 */
export async function getAdminUserAudit(
  userId: string,
  params: { scope?: UserAuditScope } & UserHistoryParams = {},
): Promise<Paginated<UserAuditEntryDTO>> {
  const scope: UserAuditScope = params.scope ?? 'target';
  if (!config.useMocks) {
    return apiRequest<Paginated<UserAuditEntryDTO>>(`/admin/users/${userId}/audit`, {
      query: { scope, page: params.page, pageSize: params.pageSize },
    });
  }
  return delay(paginate(fx.mockUserAudit(userId), params));
}

// ---------- Admin M10 · Config (diales) y bitácora (contrato §M10) ----------
/** Todos los diales (contrato GET /admin/settings). */
export async function getSettings(): Promise<SettingsDTO> {
  if (!config.useMocks) return apiRequest<SettingsDTO>('/admin/settings');
  return delay(fx.mockSettings);
}

/**
 * Edición de diales (contrato PUT /admin/settings). El body es PARCIAL (solo las
 * keys a cambiar); NO existe PATCH /admin/settings/:key.
 */
export async function updateSettings(patch: Partial<SettingsDTO>): Promise<SettingsDTO> {
  if (!config.useMocks) return apiRequest<SettingsDTO>('/admin/settings', { method: 'PUT', body: patch });
  fx.setMockSettings(patch);
  return delay(fx.mockSettings);
}

export interface AuditLogFilters {
  actorUserId?: string;
  action?: string;
  entityType?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

/** Bitácora global paginada (contrato GET /admin/audit-log). */
export async function getAuditLog(filters: AuditLogFilters = {}): Promise<Paginated<AuditLogDTO>> {
  if (!config.useMocks) {
    // El contrato devuelve { data }; se normaliza a Paginated para la UI.
    const res = await apiRequest<{ data: AuditLogDTO[]; page?: number; pageSize?: number; total?: number }>(
      '/admin/audit-log',
      {
        query: {
          actorUserId: filters.actorUserId,
          action: filters.action,
          entityType: filters.entityType,
          from: filters.from,
          to: filters.to,
          page: filters.page,
          pageSize: filters.pageSize,
        },
      },
    );
    return {
      data: res.data,
      page: res.page ?? filters.page ?? 1,
      pageSize: res.pageSize ?? filters.pageSize ?? 20,
      total: res.total ?? res.data.length,
    };
  }
  let data = [...fx.mockAuditLog];
  if (filters.action) data = data.filter((a) => a.action.includes(filters.action!));
  if (filters.actorUserId) data = data.filter((a) => a.actorUserId === filters.actorUserId);
  if (filters.entityType) data = data.filter((a) => a.entityType === filters.entityType);
  return delay(paginate(data, filters));
}

// ---------- Admin M7 · Finanzas (contrato §M7) ----------
export interface FinanceRange {
  from?: string;
  to?: string;
}

/** P&L por rango (contrato GET /admin/finance/pnl). */
export async function getPnl(range: FinanceRange = {}): Promise<PnlDTO> {
  if (!config.useMocks) {
    return apiRequest<PnlDTO>('/admin/finance/pnl', { query: { from: range.from, to: range.to } });
  }
  return delay(fx.mockPnl);
}

/** Valor de inventario a referencia y a costo (contrato GET /admin/finance/inventory-value). */
export async function getInventoryValue(): Promise<InventoryValueDTO> {
  if (!config.useMocks) return apiRequest<InventoryValueDTO>('/admin/finance/inventory-value');
  return delay(fx.mockInventoryValue);
}

/** Valor en custodia de clientes (contrato GET /admin/finance/custody-value). */
export async function getCustodyValue(): Promise<CustodyValueDTO> {
  if (!config.useMocks) return apiRequest<CustodyValueDTO>('/admin/finance/custody-value');
  return delay(fx.mockCustodyValue);
}

/** IVA cobrado por rango, para conciliación/CFDI (contrato GET /admin/finance/iva). */
export async function getIvaReport(range: FinanceRange = {}): Promise<IvaReportDTO> {
  if (!config.useMocks) {
    return apiRequest<IvaReportDTO>('/admin/finance/iva', { query: { from: range.from, to: range.to } });
  }
  return delay(fx.mockIvaReport);
}

export type FinanceCsvReport = 'pnl' | 'iva' | 'inventory';

/**
 * Descarga el CSV de finanzas/reportes (contrato GET /admin/finance/export.csv y
 * GET /admin/reports/export.csv — comparten el mismo `exportCsv`). Devuelve el TEXTO
 * del CSV; el componente lo materializa como archivo (ver lib/download). El fetch real
 * lleva Bearer y lee texto (no JSON), por eso no usa `apiRequest`.
 */
export async function exportFinanceCsv(input: {
  report: FinanceCsvReport;
  from?: string;
  to?: string;
  /** origen del endpoint: M7 (finance, default) o M9 (reports). Mismo CSV. */
  source?: 'finance' | 'reports';
}): Promise<string> {
  const path =
    input.source === 'reports' ? '/admin/reports/export.csv' : '/admin/finance/export.csv';
  if (!config.useMocks) {
    const url = new URL(config.apiBaseUrl + path);
    if (input.report) url.searchParams.set('report', input.report);
    if (input.from) url.searchParams.set('from', input.from);
    if (input.to) url.searchParams.set('to', input.to);
    const token = getToken();
    const res = await fetch(url.toString(), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      throw new ApiClientError(res.status, { code: 'INTERNAL', message: 'CSV export failed' });
    }
    return res.text();
  }
  return delay(fx.mockCsv(input.report));
}

// ---------- Admin M9 · Reportes (contrato §M9) ----------
/** Métricas de lanzamiento vs metas N/X/Y/Z (contrato GET /admin/reports/launch-metrics). */
export async function getLaunchMetrics(range: FinanceRange = {}): Promise<LaunchMetricsDTO> {
  if (!config.useMocks) {
    return apiRequest<LaunchMetricsDTO>('/admin/reports/launch-metrics', {
      query: { from: range.from, to: range.to },
    });
  }
  return delay(fx.mockLaunchMetrics);
}

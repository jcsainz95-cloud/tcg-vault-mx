import { config } from './config';
import { apiRequest, ApiClientError, setToken, getToken } from './api-client';
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
  VaultLocationDTO,
  AdminBuylistDTO,
  AdminOrderDTO,
  DisputeDTO,
  ProductType,
  RawCondition,
  SealedSubtype,
  Finish,
  BuylistRule,
  BuylistRulesDTO,
  BuylistRaritiesResponse,
  BreakdownDTO,
  PortfolioRange,
  PortfolioHistoryResponse,
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
  AdminUserSummaryDTO,
  AdminUserDetailDTO,
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
  const pageSize = filters.pageSize ?? 20;
  const page = filters.page ?? 1;
  const start = (page - 1) * pageSize;
  return delay({ data: data.slice(start, start + pageSize), page, pageSize, total: data.length });
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
  clabe: string;
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
    return apiRequest<SellRequestDTO>('/buylist/requests', { method: 'POST', body: input });
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

export async function getAdminInventory(): Promise<InventoryItemDTO[]> {
  if (!config.useMocks) {
    const res = await apiRequest<Paginated<InventoryItemDTO>>('/admin/inventory/items');
    return res.data;
  }
  return delay(fx.mockInventory);
}

export async function getLocations(): Promise<VaultLocationDTO[]> {
  if (!config.useMocks) {
    const res = await apiRequest<{ data: VaultLocationDTO[] }>('/admin/locations');
    return res.data;
  }
  return delay(fx.mockLocations);
}

export async function getAdminBuylist(): Promise<AdminBuylistDTO[]> {
  if (!config.useMocks) {
    const res = await apiRequest<Paginated<AdminBuylistDTO>>('/admin/buylist');
    return res.data;
  }
  return delay(fx.mockAdminBuylist);
}

export async function getAdminOrders(): Promise<AdminOrderDTO[]> {
  if (!config.useMocks) {
    const res = await apiRequest<Paginated<AdminOrderDTO>>('/admin/orders');
    return res.data;
  }
  return delay(fx.mockAdminOrders);
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

// ---------- Admin M2 · Catálogo y precios (contrato §M2) ----------
/** Dispara/encola el sync diario de precios de bóveda (contrato POST /admin/pricing/sync). */
export async function syncPricing(input: {
  scope?: 'all_vault' | 'cardIds';
  cardIds?: string[];
} = {}): Promise<PricingSyncResponse> {
  if (!config.useMocks) {
    return apiRequest<PricingSyncResponse>('/admin/pricing/sync', { method: 'POST', body: input });
  }
  return delay({ jobId: `job-${Math.floor(Math.random() * 9000 + 1000)}`, queued: fx.mockListings.length });
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
  priceMxnCents: number;
}

/** Override manual de precio; resuelve el PendingPriceEntry (contrato POST /admin/pricing/override). */
export async function overridePrice(input: PricingOverrideInput): Promise<{ ok: true }> {
  if (!config.useMocks) {
    await apiRequest<unknown>('/admin/pricing/override', { method: 'POST', body: input });
    return { ok: true };
  }
  // MOCK: resuelve la entrada pendiente asociada a esa carta/gradeKey.
  const entry = fx.mockPendingPrices.find(
    (p) => p.cardId === input.cardId && p.gradeKey === input.gradeKey,
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
    jobId: `job-${Math.floor(Math.random() * 9000 + 1000)}`,
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
  return delay({ jobId: `job-${Math.floor(Math.random() * 9000 + 1000)}`, setsQueued: sets, remaining: 0 });
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
  const pageSize = filters.pageSize ?? 20;
  const page = filters.page ?? 1;
  const start = (page - 1) * pageSize;
  return delay({ data: data.slice(start, start + pageSize), page, pageSize, total: data.length });
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
  const tempPassword = `Tmp-${Math.random().toString(36).slice(2, 8)}-${Math.random().toString(36).slice(2, 6)}`;
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
  const pageSize = filters.pageSize ?? 20;
  const page = filters.page ?? 1;
  const start = (page - 1) * pageSize;
  return delay({ data: data.slice(start, start + pageSize), page, pageSize, total: data.length });
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

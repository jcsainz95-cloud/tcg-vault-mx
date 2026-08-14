import { config } from './config';
import { apiRequest, ApiClientError, setToken } from './api-client';
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
  DashboardDTO,
  InventoryItemDTO,
  VaultLocationDTO,
  AdminBuylistDTO,
  AdminOrderDTO,
  DisputeDTO,
  ProductType,
  RawCondition,
  SealedSubtype,
  BuylistCategory,
  BreakdownDTO,
  PortfolioRange,
  PortfolioHistoryResponse,
  AuthResponse,
  Locale,
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

// ---------- Buylist ----------
export async function getBuylistQuote(input: {
  cardId: string;
  productType: ProductType;
  rawCondition?: RawCondition;
}): Promise<BuylistQuoteResponse> {
  if (!config.useMocks) {
    return apiRequest<BuylistQuoteResponse>('/buylist/quote', { method: 'POST', body: input });
  }
  const card = fx.mockCards.find((c) => c.id === input.cardId);
  // MOCK: derivación rareza→categoría (backend usa la tabla del dial M2/M10).
  const rarity = (card?.rarity ?? '').toLowerCase();
  const category: BuylistCategory = rarity.includes('reverse')
    ? 'reverse_holo'
    : /holo|rare|ex|illustration|full|art|radiant|ultra/.test(rarity)
      ? 'ex_plus'
      : 'comun';
  // Referencia de mercado por carta (Zapdos = null → precio pendiente de adquisición).
  const refCents = fx.mockReferenceByCardId[input.cardId] ?? undefined;
  if (category === 'comun') {
    return delay({ category, quote: { status: 'cotizada', quotedPriceCents: 50, currency: 'MXN' }, referencePrice: { status: 'priced', priceMxnCents: refCents }, paymentNotice: 'PAY_AFTER_RECEIPT' });
  }
  if (category === 'reverse_holo') {
    return delay({ category, quote: { status: 'cotizada', quotedPriceCents: 150, currency: 'MXN' }, referencePrice: { status: 'priced', priceMxnCents: refCents }, paymentNotice: 'PAY_AFTER_RECEIPT' });
  }
  if (refCents == null) {
    return delay({ category, quote: { status: 'precio_pendiente', quotedPriceCents: null, currency: 'MXN' }, referencePrice: { status: 'pending' }, paymentNotice: 'PAY_AFTER_RECEIPT' });
  }
  return delay({ category, quote: { status: 'cotizada', quotedPriceCents: Math.round(refCents * 0.4), currency: 'MXN' }, referencePrice: { status: 'priced', priceMxnCents: refCents }, paymentNotice: 'PAY_AFTER_RECEIPT' });
}

export async function getSellRequests(): Promise<SellRequestDTO[]> {
  if (!config.useMocks) {
    const res = await apiRequest<{ data: SellRequestDTO[] }>('/buylist/requests');
    return res.data;
  }
  return delay(fx.mockSellRequests);
}

// ---------- Auth (contrato §1) ----------
function persistSession(res: AuthResponse): AuthResponse {
  setToken(res.accessToken);
  return res;
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

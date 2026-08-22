import { config } from './config';
import {
  apiRequest,
  requestBlob,
  type BlobResponse,
  ApiClientError,
  setToken,
  setRefreshToken,
  getToken,
  clearClientSession,
} from './api-client';
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
  CheckoutSessionResponse,
  AddressDTO,
  ShipmentCreateResponse,
  BuylistQuoteResponse,
  BuylistQuoteItemDTO,
  BuylistBatchQuoteResultDTO,
  BuylistBatchQuoteResponse,
  SellRequestDTO,
  ShipmentDTO,
  ShipmentQuoteResponse,
  ShipmentStatus,
  ShipmentTrackingRequest,
  DashboardDTO,
  InventoryItemDTO,
  AdminInventoryItemDetailDTO,
  VaultLocationDTO,
  VaultZone,
  AdminBuylistDTO,
  AdminSellerRef,
  RejectedSellItemDTO,
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
  SellRequestStatus,
  DisputeDTO,
  CreateDisputeInput,
  CreateDisputeResponse,
  ClientDisputeDTO,
  ProductType,
  RawCondition,
  SealedSubtype,
  SealedCondition,
  SealedGroupDTO,
  SealedGroupListResponse,
  SealedGroupDetailResponse,
  VaultSealedResponse,
  SealedSpreadsDTO,
  Finish,
  GradingCompany,
  AcquisitionType,
  InventoryStatus,
  BuylistRule,
  PriceRuleSet,
  BuylistRaritiesResponse,
  SalesRule,
  SalesPriceRuleSet,
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
  PriceIngestResponse,
  PendingPriceEntryDTO,
  PendingPriceContext,
  RemoteSetDTO,
  PriceHistoryEntryDTO,
  CatalogSyncResponse,
  CatalogBackfillResponse,
  CatalogSyncAllResponse,
  RefreshVariantsResponse,
  RefreshVariantsAllResponse,
  RefreshVariantsStatusResponse,
  CatalogSyncStatusResponse,
  PriceSyncStatusResponse,
  UnifyRaritiesResponse,
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
  MasterSetSort,
  MasterSetIndexResponse,
  MasterSetBinderResponse,
  BatchCreateInventoryRequest,
  BatchCreateInventoryResponse,
  BulkPublishRequest,
  BulkPublishResponse,
  AdminVaultSort,
  AdminVaultListResponse,
  InventoryAdjustmentRequest,
  InventoryAdjustmentResponse,
  BulkRemoveInventoryRequest,
  BulkRemoveInventoryResponse,
  // v1.28 Stream B (P-17/18/19/20/22/24/25): inventario M1 operable.
  VariantControlsRequest,
  VariantControlsResponse,
  PublishAllRequest,
  PublishAllResponse,
  SealedSetsResponse,
  SealedSetDetailResponse,
  GradedInventoryResponse,
  PublicBountiesResponse,
  // v1.21-guest-checkout (contrato §4-G) — sección aditiva al final del archivo.
  GuestAddressInput,
  GuestCheckoutQuoteResponse,
  GuestCheckoutSessionRequest,
  GuestCheckoutSessionResponse,
  GuestOrderTrackingDTO,
  GuestResendLinkRequest,
  GuestResendLinkResponse,
  ClaimableOrderDTO,
  ClaimOrdersResponse,
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

/**
 * MOCK: traduce los errores internos de fixtures (que no importan ApiClientError) al
 * error del contrato, para que la UI reciba el MISMO shape con backend real o mock.
 */
function translateFixtureError(e: unknown): unknown {
  if (e instanceof fx.ApiFixtureNotFound) {
    return new ApiClientError(404, { code: 'NOT_FOUND', message: e.message });
  }
  if (e instanceof fx.ApiFixtureError) {
    return new ApiClientError(e.status, { code: e.code, message: e.message, details: e.details });
  }
  return e;
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
  // v1.33 (P-27, §4.31d): el backend pliega el subset de un master combinado en el principal
  // (Celebrations una vez, con `partSetIds`). El mock reproduce ese plegado para el dropdown de Compra.
  return delay(fx.foldSetsForDropdown(fx.mockSets));
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

/**
 * "Mi bóveda como master set" (contrato §3 · GET /vault/master-sets, `customer`,
 * v1.20-master-set-everywhere). Mismo shape que el índice admin con scope="user_vault" y
 * owner = el propio usuario (sin email). Solo sets con ≥1 pieza del usuario.
 */
export async function getVaultMasterSets(
  filters: MasterSetIndexFilters = {},
): Promise<MasterSetIndexResponse> {
  if (!config.useMocks) {
    return apiRequest<MasterSetIndexResponse>('/vault/master-sets', {
      query: { q: filters.q, page: filters.page, pageSize: filters.pageSize, sort: filters.sort },
    });
  }
  return delay(
    fx.mockMasterSetIndex(filters, {
      kind: 'user_vault',
      owner: fx.mockSelfVaultOwner,
      holdings: fx.mockHoldings,
      includeBuyable: true,
    }),
  );
}

/**
 * Binder de MI bóveda (contrato §3 · GET /vault/master-sets/:setId, `customer`, v1.20).
 * Funciona para CUALQUIER set del catálogo (los huecos son los faltantes del usuario).
 * ÚNICA vista con `buyable` por variante faltante (pieza listed más barata o null).
 */
export async function getVaultMasterSetBinder(setId: string): Promise<MasterSetBinderResponse> {
  if (!config.useMocks) {
    return apiRequest<MasterSetBinderResponse>(`/vault/master-sets/${setId}`);
  }
  try {
    return await delay(
      fx.mockMasterSetBinder(setId, {
        kind: 'user_vault',
        owner: fx.mockSelfVaultOwner,
        holdings: fx.mockHoldings,
        includeBuyable: true,
      }),
    );
  } catch (e) {
    throw translateFixtureError(e);
  }
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

// ---------- Sellado / producto cerrado (contrato §2-S, §3, §M2, v1.23-sealed-sales) ----------
export type SealedSort = 'price_asc' | 'price_desc' | 'newest';

export interface SealedFilters {
  setId?: string;
  sealedSubtype?: SealedSubtype;
  condition?: SealedCondition;
  q?: string;
  sort?: SealedSort;
  page?: number;
  pageSize?: number;
}

/**
 * Grid AGREGADO del sellado publicado (contrato GET /catalog/sealed, `public`). Agrupa piezas
 * idénticas (producto TCGCSV + condición) → "N disponibles"; solo grupos con ≥1 pieza vendible.
 * La condición SEPARA grupos (una tarjeta mint, otra minor_box_damage).
 */
export async function getSealedGroups(filters: SealedFilters = {}): Promise<SealedGroupListResponse> {
  if (!config.useMocks) {
    return apiRequest<SealedGroupListResponse>('/catalog/sealed', {
      query: {
        setId: filters.setId,
        sealedSubtype: filters.sealedSubtype,
        condition: filters.condition,
        q: filters.q,
        sort: filters.sort,
        page: filters.page,
        pageSize: filters.pageSize,
      },
    });
  }
  let data = [...fx.mockSealedGroups];
  if (filters.setId) data = data.filter((g) => g.card.setId === filters.setId);
  if (filters.sealedSubtype) data = data.filter((g) => g.sealedSubtype === filters.sealedSubtype);
  if (filters.condition) data = data.filter((g) => g.sealedCondition === filters.condition);
  if (filters.q) {
    const q = filters.q.toLowerCase();
    data = data.filter((g) => g.productName.toLowerCase().includes(q));
  }
  if (filters.sort === 'price_asc') data.sort((a, b) => a.fromPriceCents - b.fromPriceCents);
  if (filters.sort === 'price_desc') data.sort((a, b) => b.fromPriceCents - a.fromPriceCents);
  return delay({ data, page: 1, pageSize: 20, total: data.length });
}

/**
 * Ficha de un producto sellado (contrato GET /catalog/sealed/:inventoryItemId, `public`). Devuelve
 * el grupo + TODAS las piezas disponibles (ListingDTO, más baratas primero) para elegir cantidad, y
 * el estado de los feature-flags (trendEnabled/restockEnabled).
 */
export async function getSealedGroupDetail(
  inventoryItemId: string,
): Promise<SealedGroupDetailResponse> {
  if (!config.useMocks) {
    return apiRequest<SealedGroupDetailResponse>(`/catalog/sealed/${inventoryItemId}`);
  }
  try {
    return await delay(fx.mockSealedGroupDetail(inventoryItemId));
  } catch (e) {
    throw translateFixtureError(e);
  }
}

/**
 * Tendencia de valor de mercado del producto sellado (contrato GET
 * /catalog/sealed/:inventoryItemId/value-history, FEATURE-FLAGGED `sealed_value_trend`). Misma forma
 * que SetValueHistoryResponse. El endpoint responde `404 FEATURE_DISABLED` si el dial está `off` (o
 * `404 NOT_FOUND` si la pieza no está mapeada → sin serie): el front oculta la gráfica limpio.
 */
export async function getSealedValueHistory(
  inventoryItemId: string,
  range: SetValueRange = '1m',
): Promise<SetValueHistoryResponse> {
  if (!config.useMocks) {
    return apiRequest<SetValueHistoryResponse>(
      `/catalog/sealed/${inventoryItemId}/value-history`,
      { query: { range } },
    );
  }
  return delay(fx.generateSealedValueHistory(range));
}

/**
 * «Avísame cuando vuelva» (contrato POST /catalog/sealed/restock-subscriptions, FEATURE-FLAGGED
 * `sealed_restock_alerts`). Respuesta NEUTRA (no revela si el producto existe/está agotado). Con el
 * dial `off` responde `404 FEATURE_DISABLED` y el front oculta el CTA.
 */
export interface RestockSubscriptionInput {
  email: string;
  tcgplayerProductId?: number;
  cardId?: string;
  sealedSubtype?: SealedSubtype;
  sealedCondition: SealedCondition;
}
export async function subscribeSealedRestock(
  input: RestockSubscriptionInput,
): Promise<{ subscribed: true }> {
  if (!config.useMocks) {
    return apiRequest<{ subscribed: true }>('/catalog/sealed/restock-subscriptions', {
      method: 'POST',
      body: input,
    });
  }
  // MOCK: el dial va seed `off` (fail-closed) → el endpoint respondería 404 FEATURE_DISABLED. El
  // mock lo simula para que el front ejercite el camino "flag apagado" sin backend.
  throw new ApiClientError(404, { code: 'FEATURE_DISABLED', message: 'sealed_restock_alerts is off' });
}

/** Pestaña "Sellado" de MI bóveda (contrato GET /vault/sealed, `customer`). */
export async function getVaultSealed(): Promise<VaultSealedResponse> {
  if (!config.useMocks) return apiRequest<VaultSealedResponse>('/vault/sealed');
  return delay(fx.mockVaultSealed);
}

/** Pestaña "Sellado" de la bóveda de UN cliente (contrato GET /admin/vaults/:userId/sealed). */
export async function getAdminVaultSealed(userId: string): Promise<VaultSealedResponse> {
  if (!config.useMocks) return apiRequest<VaultSealedResponse>(`/admin/vaults/${userId}/sealed`);
  return delay(fx.mockAdminVaultSealed(userId));
}

/** Spreads de VENTA del sellado (contrato GET /admin/pricing/sealed-spreads, `super_admin`). */
export async function getSealedSpreads(): Promise<SealedSpreadsDTO> {
  if (!config.useMocks) return apiRequest<SealedSpreadsDTO>('/admin/pricing/sealed-spreads');
  return delay({
    spreadPctBySubtype: { ...fx.mockSealedSpreads.spreadPctBySubtype },
    fallbackPct: fx.mockSealedSpreads.fallbackPct,
  });
}

/**
 * Reemplaza los spreads de venta del sellado y/o el fallback (contrato PUT
 * /admin/pricing/sealed-spreads). Semántica pct = markup ARRIBA de mercado (como ventas §4.14),
 * rango [0,1000]. Auditado. `salePriceCents = round(mercadoTCGCSV × (1 + spread/100))`.
 */
export async function updateSealedSpreads(input: SealedSpreadsDTO): Promise<SealedSpreadsDTO> {
  if (!config.useMocks) {
    return apiRequest<SealedSpreadsDTO>('/admin/pricing/sealed-spreads', {
      method: 'PUT',
      body: input,
    });
  }
  fx.setMockSealedSpreads(input.spreadPctBySubtype, input.fallbackPct);
  return delay({
    spreadPctBySubtype: { ...fx.mockSealedSpreads.spreadPctBySubtype },
    fallbackPct: fx.mockSealedSpreads.fallbackPct,
  });
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

/** Breakdown en CEROS del contrato (v1.21.3): carrito 100 % no disponible ⇒ 200, nunca error. */
function zeroBreakdown(withShipping = false): BreakdownDTO {
  return {
    subtotalCents: 0,
    ivaCents: 0,
    ivaRatePct: IVA_PCT,
    processingFeeCents: 0,
    totalCents: 0,
    currency: 'MXN',
    ...(withShipping ? { shippingFeeCents: 0 } : {}),
  };
}

export async function getCheckoutQuote(inventoryItemIds: string[]): Promise<CheckoutQuoteResponse> {
  if (!config.useMocks) {
    return apiRequest<CheckoutQuoteResponse>('/checkout/quote', { method: 'POST', body: { inventoryItemIds } });
  }
  // MOCK v1.21.3-quote-prune: resolución POR ÍTEM. Un id que no está en los fixtures se
  // trata como pieza borrada (`cardName: null`); los fixtures no modelan el caso
  // «existe pero fuera de {listed, in_stock}» (cardName con nombre) — ese lo ejercita
  // el backend real y las pruebas de vista con el API mockeado.
  const unavailableItems = inventoryItemIds
    .filter((id) => !fx.mockListings.some((l) => l.inventoryItemId === id))
    .map((id) => ({ inventoryItemId: id, cardName: null }));
  const items = inventoryItemIds
    .map((id) => fx.mockListings.find((l) => l.inventoryItemId === id))
    .filter((l): l is ListingDTO => !!l);
  // 422 PRICE_PENDING se evalúa DESPUÉS de la poda (solo ítems válidos), contrato §4.
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
    breakdown: items.length === 0 ? zeroBreakdown() : computeBreakdown(subtotal),
    unavailableItems,
  });
}

/**
 * Genera un Idempotency-Key para los endpoints de pago (contrato §0/§4/§5). Evita crear
 * dos órdenes/envíos si el usuario re-envía por doble clic o reintento de red.
 */
function idempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Crea la sesión de checkout (contrato POST /checkout/session, §4): reserva los items, crea la
 * `Order` en `pending` y el `PaymentIntent` de Stripe. Devuelve `{ orderId, breakdown, stripe:{
 * paymentIntentId, clientSecret } }`. El `clientSecret` alimenta el `StripePaymentModal`; el pago
 * se asienta por webhook (`payment_intent.succeeded`), no por la respuesta a `confirmPayment`.
 *
 * TOCA DINERO. Errores del contrato: `403 EMAIL_NOT_VERIFIED` (correo sin verificar — el front
 * muestra el banner de verificación), `422 PRICE_PENDING`, `409 ITEM_UNAVAILABLE`.
 */
export async function createCheckoutSession(
  inventoryItemIds: string[],
  billingProfileId?: string,
): Promise<CheckoutSessionResponse> {
  if (!config.useMocks) {
    return apiRequest<CheckoutSessionResponse>('/checkout/session', {
      method: 'POST',
      body: { inventoryItemIds, billingProfileId },
      headers: { 'Idempotency-Key': idempotencyKey() },
    });
  }
  // MOCK: reusa el desglose del quote y devuelve un clientSecret simulado (el StripePaymentModal
  // en modo mock no llama a Stripe real). Replica el 422 PRICE_PENDING del contrato.
  const items = inventoryItemIds
    .map((id) => fx.mockListings.find((l) => l.inventoryItemId === id))
    .filter((l): l is ListingDTO => !!l);
  const pending = items.find((l) => !l.sellable);
  if (pending) throw new ApiClientError(422, { code: 'PRICE_PENDING', message: 'Item price pending' });
  const subtotal = items.reduce((s, l) => s + (l.salePriceCents ?? 0), 0);
  const orderId = `ord-${Math.floor(Math.random() * 9000 + 1000)}`;
  return delay({
    orderId,
    breakdown: computeBreakdown(subtotal),
    stripe: { paymentIntentId: `pi_mock_${orderId}`, clientSecret: `pi_mock_${orderId}_secret_mock` },
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

// ---------- Direcciones (contrato §1 — envío, solo MX) ----------
export interface AddressInput {
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

/** Libreta de direcciones del usuario (contrato GET /users/me/addresses → { data }). */
export async function listAddresses(): Promise<AddressDTO[]> {
  if (!config.useMocks) {
    const res = await apiRequest<{ data: AddressDTO[] }>('/users/me/addresses');
    return res.data;
  }
  return delay([...fx.mockAddresses]);
}

/**
 * Alta de dirección (contrato POST /users/me/addresses). El backend valida `country="MX"`
 * (`422 ADDRESS_NOT_MX` en otro caso). Si `isDefault=true`, se marca como predeterminada
 * (y las demás dejan de serlo). Reglas de longitud del contrato: `postalCode≥3`, `phone≥7`.
 */
export async function createAddress(input: AddressInput): Promise<AddressDTO> {
  if (!config.useMocks) {
    return apiRequest<AddressDTO>('/users/me/addresses', { method: 'POST', body: input });
  }
  // MOCK: replica la validación MX-only del backend y el manejo de `isDefault`.
  if (input.country !== 'MX') {
    throw new ApiClientError(422, { code: 'ADDRESS_NOT_MX', message: 'Only MX addresses are allowed' });
  }
  const created: AddressDTO = { id: `addr-new-${fx.mockAddresses.length + 1}`, ...input };
  if (created.isDefault) fx.mockAddresses.forEach((a) => (a.isDefault = false));
  fx.mockAddresses.push(created);
  return delay(created);
}

/** Edita una dirección (contrato PATCH /users/me/addresses/:id). Usado p. ej. para marcar default. */
export async function updateAddress(id: string, input: Partial<AddressInput>): Promise<AddressDTO> {
  if (!config.useMocks) {
    return apiRequest<AddressDTO>(`/users/me/addresses/${id}`, { method: 'PATCH', body: input });
  }
  const idx = fx.mockAddresses.findIndex((a) => a.id === id);
  if (idx < 0) throw new ApiClientError(404, { code: 'NOT_FOUND', message: 'Address not found' });
  if (input.country && input.country !== 'MX') {
    throw new ApiClientError(422, { code: 'ADDRESS_NOT_MX', message: 'Only MX addresses are allowed' });
  }
  if (input.isDefault) fx.mockAddresses.forEach((a) => (a.isDefault = false));
  fx.mockAddresses[idx] = { ...fx.mockAddresses[idx], ...input };
  return delay({ ...fx.mockAddresses[idx] });
}

/** Borra una dirección (contrato DELETE /users/me/addresses/:id). */
export async function deleteAddress(id: string): Promise<void> {
  if (!config.useMocks) {
    await apiRequest<void>(`/users/me/addresses/${id}`, { method: 'DELETE' });
    return;
  }
  const idx = fx.mockAddresses.findIndex((a) => a.id === id);
  if (idx < 0) throw new ApiClientError(404, { code: 'NOT_FOUND', message: 'Address not found' });
  fx.mockAddresses.splice(idx, 1);
  await delay(undefined);
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
 * Detalle de un retiro propio (contrato §5 · GET /shipments/:id, `customer`, v1.17). Mismo
 * `ClientShipmentDTO` que el listado, con `items` enriquecidos (folio/card/finish) y montos. Deep-link
 * desde el badge "EN RETIRO" de la bóveda (`HoldingDTO.activeShipmentId`). Err `404` si no existe o no
 * es del usuario.
 */
export async function getShipment(id: string): Promise<ShipmentDTO> {
  if (!config.useMocks) return apiRequest<ShipmentDTO>(`/shipments/${id}`);
  const found = fx.mockShipments.find((s) => s.id === id);
  if (!found) throw new ApiClientError(404, { code: 'NOT_FOUND', message: 'Shipment not found' });
  return delay(found);
}

/**
 * Crea la solicitud de retiro (contrato POST /shipments, §5): cobra la tarifa (envío + IVA + fee)
 * por Stripe ANTES de crear la `ShipmentRequest`. Devuelve `{ shipmentId, status:'solicitado',
 * breakdown, stripe:{ paymentIntentId, clientSecret } }`; el `clientSecret` alimenta el
 * `StripePaymentModal`. La solicitud solo avanza a `picking` cuando el webhook liquida el pago.
 *
 * TOCA DINERO. Errores del contrato: `403 EMAIL_NOT_VERIFIED`, `422 ITEM_NOT_SETTLED`,
 * `422 ADDRESS_NOT_MX`, `409 ITEM_IN_ANOTHER_SHIPMENT`.
 */
export async function createShipment(
  inventoryItemIds: string[],
  addressId: string,
): Promise<ShipmentCreateResponse> {
  if (!config.useMocks) {
    return apiRequest<ShipmentCreateResponse>('/shipments', {
      method: 'POST',
      body: { inventoryItemIds, addressId },
      headers: { 'Idempotency-Key': idempotencyKey() },
    });
  }
  // MOCK: valida settled + MX (como el backend) y devuelve el shape 201 con clientSecret simulado.
  const address = fx.mockAddresses.find((a) => a.id === addressId);
  if (!address || address.country !== 'MX') {
    throw new ApiClientError(422, { code: 'ADDRESS_NOT_MX', message: 'Only MX addresses are allowed' });
  }
  const holdings = inventoryItemIds
    .map((id) => fx.mockHoldings.find((h) => h.inventoryItemId === id))
    .filter(Boolean);
  if (holdings.some((h) => h!.ownershipStatus !== 'settled')) {
    throw new ApiClientError(422, { code: 'ITEM_NOT_SETTLED', message: 'Only settled items can be shipped' });
  }
  const SHIPPING = 17500; // MOCK: dial M10 default (MX$175).
  const shipmentId = `shp-${Math.floor(Math.random() * 9000 + 1000)}`;
  // Refleja el nuevo envío en "mis envíos" para que reaparezca tras confirmar el pago.
  fx.mockShipments.unshift({
    id: shipmentId,
    status: 'solicitado',
    createdAt: new Date().toISOString(),
    items: holdings.map((h) => ({
      inventoryItemId: h!.inventoryItemId,
      folio: h!.folio,
      card: h!.card,
    })),
  });
  return delay({
    shipmentId,
    status: 'solicitado',
    breakdown: computeBreakdown(SHIPPING, SHIPPING),
    stripe: { paymentIntentId: `pi_mock_${shipmentId}`, clientSecret: `pi_mock_${shipmentId}_secret_mock` },
  });
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

/**
 * Transiciones LEGALES de estado de envío — espejo EXACTO de `ShipmentsService.TRANSITIONS`
 * (backend). Fuente única para (a) validar la legalidad en la rama mock y (b) que M4View
 * ofrezca solo transiciones válidas. `solicitado→picking` es por WEBHOOK y `picking→guia` va por
 * la captura de guía; la UI decide cuáles exponer como botón MANUAL (ver M4View).
 */
export const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> = {
  solicitado: ['picking', 'cancelado'],
  picking: ['guia', 'cancelado'],
  guia: ['enviado', 'cancelado'],
  enviado: ['entregado'],
  entregado: [],
  cancelado: [],
};

/**
 * Cambio de estado MANUAL de un envío (contrato §M4 · PATCH /admin/shipments/:id/status,
 * `vault_operator+`). Body `{ to }`. El backend solo acepta una transición LEGAL de la tabla
 * TRANSITIONS (una ilegal → `409 CONFLICT`). Al éxito, M4 invalida `['admin-shipments']` y
 * `['admin-picking-list']`.
 */
export async function updateAdminShipmentStatus(
  id: string,
  to: ShipmentStatus,
): Promise<AdminShipmentDTO> {
  if (!config.useMocks) {
    return apiRequest<AdminShipmentDTO>(`/admin/shipments/${id}/status`, {
      method: 'PATCH',
      body: { to },
    });
  }
  // MOCK: espeja la tabla TRANSITIONS del backend (transición ilegal → 409 CONFLICT).
  const idx = fx.mockAdminShipments.findIndex((s) => s.id === id);
  if (idx < 0) throw new ApiClientError(404, { code: 'NOT_FOUND', message: 'Shipment not found' });
  const current = fx.mockAdminShipments[idx].status;
  const allowed = SHIPMENT_TRANSITIONS[current] ?? [];
  if (!allowed.includes(to)) {
    throw new ApiClientError(409, {
      code: 'CONFLICT',
      message: `Invalid transition ${current} -> ${to}`,
    });
  }
  fx.mockAdminShipments[idx] = { ...fx.mockAdminShipments[idx], status: to };
  // Espeja el estado también en "mis envíos" (mockShipments) si el mismo id existe ahí.
  const mine = fx.mockShipments.findIndex((s) => s.id === id);
  if (mine >= 0) fx.mockShipments[mine] = { ...fx.mockShipments[mine], status: to };
  return delay({ ...fx.mockAdminShipments[idx] });
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
  // v1.33 (P-27, §4.31d): el subset de un master combinado se pliega en el principal (una entrada
  // combinada única en el dropdown del cotizador); esa entrada trae `partSetIds` para expandir el filtro.
  return delay(fx.foldSetsForDropdown(fx.mockSets));
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
  // v1.33 (P-27, §4.31d): pedir por el principal de un master combinado EXPANDE a `setId IN partSetIds`
  // (Celebrations lista las cartas de cel25 + cel25c); un set normal filtra por su único id.
  if (filters.setId) {
    const ids = new Set(fx.expandSetIdFilter(filters.setId));
    data = data.filter((c) => ids.has(c.setId));
  }
  if (filters.q) {
    const q = filters.q.toLowerCase();
    data = data.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.number ?? '').toLowerCase().includes(q),
    );
  }
  if (filters.rarity) data = data.filter((c) => c.rarity === filters.rarity);
  // v1.29/v1.30 (§4.27/§4.29): GET /buylist/cards ecoa los productos SEPARADOS de la carta en
  // `CardDTO.separateProducts`; el cotizador (fetchQuoterBinder) los propaga a la celda y los
  // cotiza como líneas propias por `productId`. El mock los adjunta desde las fixtures.
  data = data.map((c) => {
    const sep = fx.mockSeparateProductsForCard(c.id);
    return sep ? { ...c, separateProducts: sep } : c;
  });
  return delay(paginate(data, filters));
}

export interface BuylistQuoteInput {
  cardId: string;
  productType: ProductType;
  rawCondition?: RawCondition;
  /** v1.6-finish: acabado a cotizar; default `normal`. Debe pertenecer a card.availableFinishes. */
  finish?: Finish;
  /**
   * v1.30 (§4.29, ADITIVO): TCGplayer `productId` de un PRODUCTO SEPARADO (deck_exclusive/promo,
   * `separateProducts`). Presente ⇒ la línea es ESE producto (acabado ∈ `CardProduct.finishes`,
   * referencia/precio PROPIOS por ese productId). Ausente ⇒ set_base por (cardId, finish).
   */
  productId?: number;
}

/**
 * MOCK v1.3.1/v1.6-finish/v1.30: aplica la REGLA de buylist (fixed MX$ / pct % de la referencia +
 * fallback) sobre una (rareza, acabado, referencia) YA resueltas. El backend deriva rareza+acabado
 * server-side (SEC-A1); aquí lo replicamos para la demo. `productId` (§4.29) se ECOA cuando la línea
 * es un producto separado (deck_exclusive/promo). Money-safe: pct sin referencia ⇒ precio_pendiente
 * (jamás 0). Compartido por el quote por-carta, el batch y la creación de solicitud.
 */
function mockRuleQuote(
  rarity: string,
  finish: Finish,
  refCents: number | null,
  productId?: number,
): BuylistQuoteResponse {
  const { rule, source } = fx.resolveBuylistRuleForFinish(rarity, finish);
  const appliedRule = { mode: rule.mode, value: rule.value, source };
  const referencePrice: BuylistQuoteResponse['referencePrice'] =
    refCents != null ? { status: 'priced', priceMxnCents: refCents } : { status: 'pending' };
  const base = {
    rarity,
    finish,
    ...(productId != null ? { productId } : {}),
    appliedRule,
    paymentNotice: 'PAY_AFTER_RECEIPT' as const,
  };
  if (rule.mode === 'fixed') {
    // Fijo: NO depende de la referencia → siempre cotiza.
    return { ...base, quote: { status: 'cotizada', quotedPriceCents: rule.value, currency: 'MXN' }, referencePrice };
  }
  // Porcentaje: si falta referencia (del acabado o del producto separado) → precio pendiente.
  if (refCents == null) {
    return {
      ...base,
      quote: { status: 'precio_pendiente', quotedPriceCents: null, currency: 'MXN' },
      referencePrice: { status: 'pending' },
    };
  }
  return {
    ...base,
    quote: { status: 'cotizada', quotedPriceCents: Math.round((refCents * rule.value) / 100), currency: 'MXN' },
    referencePrice,
  };
}

/** Códigos de error POR-ÍTEM del contrato (§6/§4.29) que el mock puede emitir. */
type MockQuoteItemError = 'NOT_FOUND' | 'FINISH_NOT_AVAILABLE' | 'PRODUCT_NOT_FOUND' | 'PRODUCT_CARD_MISMATCH';

/**
 * MOCK v1.30 (§4.29): resuelve UN ítem de cotización (carta BASE o PRODUCTO SEPARADO por
 * `productId`) al shape del contrato. Con `productId`: valida el acabado contra
 * `CardProduct.finishes` (default-ea al único acabado si se omite) y lee el precio PROPIO del
 * producto (money-safe: sin referencia ⇒ precio_pendiente, nunca 0); `productId` inexistente ⇒
 * PRODUCT_NOT_FOUND; que NO cuelgue del cardId ⇒ PRODUCT_CARD_MISMATCH (jamás fusión con el
 * set_base). Sin `productId`: comportamiento v1.29 (set_base por (cardId, finish)).
 */
function mockResolveQuoteItem(
  item: { cardId: string; finish?: Finish; productId?: number },
  // El batch valida el acabado base ∈ availableFinishes (SEC-A1, por-ítem); el quote por-carta NO lo
  // hacía (retrocompat de mock) — se preserva ese matiz con este flag. La whitelist del PRODUCTO
  // separado (CardProduct.finishes) SIEMPRE se valida (contrato §4.29, ambos endpoints).
  opts: { validateBaseFinish?: boolean } = {},
): { ok: true; payload: BuylistQuoteResponse } | { ok: false; code: MockQuoteItemError } {
  const card = fx.mockCards.find((c) => c.id === item.cardId);
  if (!card) return { ok: false, code: 'NOT_FOUND' };
  const rarity = card.rarity ?? '';

  if (item.productId != null) {
    const res = fx.resolveSeparateProduct(item.cardId, item.productId);
    if (res.status === 'not_found') return { ok: false, code: 'PRODUCT_NOT_FOUND' };
    if (res.status === 'mismatch') return { ok: false, code: 'PRODUCT_CARD_MISMATCH' };
    const product = res.product;
    // §4.29b: acabado omitido con UN solo acabado ⇒ se default-ea a ese; con >1 es obligatorio.
    const finish: Finish = item.finish ?? (product.finishes.length === 1 ? product.finishes[0] : 'normal');
    if (!product.finishes.includes(finish)) return { ok: false, code: 'FINISH_NOT_AVAILABLE' };
    const refCents = product.prices.find((p) => p.finish === finish)?.marketReferenceMxnCents ?? null;
    return { ok: true, payload: mockRuleQuote(rarity, finish, refCents, item.productId) };
  }

  const finish: Finish = item.finish ?? 'normal';
  if (opts.validateBaseFinish && !card.availableFinishes.includes(finish)) {
    return { ok: false, code: 'FINISH_NOT_AVAILABLE' };
  }
  const refCents = fx.mockReferenceForFinish(item.cardId, finish) ?? null;
  return { ok: true, payload: mockRuleQuote(rarity, finish, refCents) };
}

export async function getBuylistQuote(input: BuylistQuoteInput): Promise<BuylistQuoteResponse> {
  if (!config.useMocks) {
    return apiRequest<BuylistQuoteResponse>('/buylist/quote', { method: 'POST', body: input });
  }
  const res = mockResolveQuoteItem(input);
  if (!res.ok) {
    // Por-carta el error es HTTP (404 NOT_FOUND; 422 el resto, incl. PRODUCT_* de §4.29).
    throw new ApiClientError(res.code === 'NOT_FOUND' ? 404 : 422, { code: res.code, message: res.code });
  }
  return delay(res.payload);
}

/** Cap de ítems por request de POST /buylist/quote/batch (contrato §6 · BUYLIST_QUOTE_BATCH_MAX). */
export const BUYLIST_QUOTE_BATCH_MAX = 50;

/**
 * Cotización en LOTE (contrato §6 · POST /buylist/quote/batch, v1.15, `public`, READ-ONLY). Cotiza
 * N cartas en 1 request (mata el fan-out FE-12: antes N cartas = N POST /buylist/quote). NO crea
 * solicitud, NO mueve dinero, NO persiste. TOLERANTE A ERRORES POR-ÍTEM: una carta inválida sale
 * `ok:false` (NOT_FOUND / FINISH_NOT_AVAILABLE / v1.30 §4.29: PRODUCT_NOT_FOUND / PRODUCT_CARD_MISMATCH)
 * y NO tumba las demás (HTTP global 200). Cap 50 ítems (vacío/sobre-cap → 400 VALIDATION_ERROR).
 * Reusa la misma resolución de monto que el quote por-carta; con `productId` cotiza el producto
 * SEPARADO como línea propia (su acabado/referencia/precio), no el set_base.
 */
export async function batchQuote(items: BuylistQuoteItemDTO[]): Promise<BuylistBatchQuoteResponse> {
  if (!config.useMocks) {
    return apiRequest<BuylistBatchQuoteResponse>('/buylist/quote/batch', {
      method: 'POST',
      body: { items },
    });
  }
  // MOCK: espeja el contrato — cap a nivel request (vacío/>50 → 400) y errores POR-ÍTEM (200 global).
  if (items.length === 0 || items.length > BUYLIST_QUOTE_BATCH_MAX) {
    throw new ApiClientError(400, {
      code: 'VALIDATION_ERROR',
      message: `items must be between 1 and ${BUYLIST_QUOTE_BATCH_MAX}`,
    });
  }
  // Mensajes EN de fallback por código (el front los traduce por `error.code`; SEC-A1).
  const errorMessage: Record<MockQuoteItemError, string> = {
    NOT_FOUND: 'Card not found',
    FINISH_NOT_AVAILABLE: 'Finish is not available for this card',
    PRODUCT_NOT_FOUND: 'Product not found',
    PRODUCT_CARD_MISMATCH: 'Product does not belong to this card',
  };
  const results: BuylistBatchQuoteResultDTO[] = items.map((item, index) => {
    // v1.30 (§4.29): resuelve base O producto separado por-ítem; errores por-ítem NO tumban el lote.
    // El batch SÍ valida el acabado base ∈ availableFinishes (SEC-A1, como antes).
    const res = mockResolveQuoteItem(item, { validateBaseFinish: true });
    if (!res.ok) {
      return { index, cardId: item.cardId, ok: false, error: { code: res.code, message: errorMessage[res.code] } };
    }
    return { index, cardId: item.cardId, ok: true, ...res.payload };
  });
  return delay({ results });
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
    // v1.30 (§4.29): TCGplayer `productId` cuando el ítem es un PRODUCTO SEPARADO
    // (deck_exclusive/promo). Se snapshotea en SellRequestItem.cardProductId server-side.
    productId?: number;
  }[];
  /**
   * CLABE destino en claro (18 dígitos). v1.15: OPCIONAL. Si se OMITE, el backend hace fallback
   * server-side a la CLABE en archivo del PROPIO usuario (`clabeOnFile=true`; mismo fallback que
   * `reveal-clabe`). Sin `clabe` y sin CLABE en archivo → `422 CLABE_REQUIRED`. Con `clabe` presente
   * se valida formato (`422 CLABE_INVALID`) y nombre propio (`422 CLABE_NOT_OWN_NAME`).
   */
  clabe?: string;
  /** keys de presign del INE (contrato §6 POST /buylist/requests: ineUploadKeys?). v1.15: se OMITE
   *  si el INE ya está en archivo (`ineOnFile=true`); el backend usa el de archivo para el umbral AML. */
  ineUploadKeys?: IneUploadKeys;
}

/**
 * Crea la solicitud de venta (contrato POST /buylist/requests). Valida topes/KYC
 * en el backend; puede fallar con 422 INE_REQUIRED / CLABE_NOT_OWN_NAME /
 * BUYLIST_LIMIT_EXCEEDED. Las `ineUploadKeys` provienen del presign `kyc_ine`.
 */
export async function createSellRequest(input: CreateSellRequestInput): Promise<SellRequestDTO> {
  if (!config.useMocks) {
    // v1.15: `clabe` es opcional. Cuando se omite (atajo "usar mi CLABE en archivo"), el body no la
    // lleva y el backend hace el fallback server-side a la CLABE del propio usuario (§6). Sin flags
    // de cliente: el contrato ya soporta el shape directo.
    return apiRequest<SellRequestDTO>('/buylist/requests', { method: 'POST', body: input });
  }
  // MOCK: replica el shape de la respuesta del contrato (SellRequestDTO). El monto se resuelve por
  // la REGLA de la rareza (v1.3.1), igual que el cotizador; v1.30 (§4.29): con `productId` la línea
  // se cotiza contra el PRODUCTO SEPARADO (su acabado/referencia/precio) y se snapshotea el productId.
  const items: SellRequestDTO['items'] = input.items.map((it, i) => {
    const card = fx.mockCards.find((c) => c.id === it.cardId) ?? fx.mockCards[0];
    const res = mockResolveQuoteItem(it);
    const payload = res.ok ? res.payload : null;
    const finish: Finish = payload?.finish ?? it.finish ?? 'normal';
    const quoted = payload?.quote.quotedPriceCents ?? undefined;
    return {
      id: `sri-new-${i}`,
      card,
      productType: it.productType,
      rawCondition: it.rawCondition,
      finish,
      // v1.30 (§4.29): snapshot del productId cuando la línea es un producto separado.
      ...(it.productId != null ? { productId: it.productId } : {}),
      rarity: card.rarity,
      appliedRule: payload?.appliedRule ?? { mode: 'pct', value: 40, source: 'fallback' },
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

/**
 * Responde a un AJUSTE de venta propuesto por el admin (contrato §6 · POST
 * /buylist/requests/:id/respond, `customer`). Body `{ decision }`. `accept` mueve los ítems
 * `ajustada → aprobada` (request → `aprobada`) y limpia el plazo de 7 días; `decline` → `rechazada`.
 * Plazo: 7 días sin respuesta → `rechazada` (job del backend). El front invalida `['sell-requests']`.
 * El backend devuelve la fila `SellRequest` actualizada (sin items); el front solo la usa para saber
 * que tuvo éxito y re-consulta la lista.
 */
export async function respondSellRequest(
  id: string,
  decision: 'accept' | 'decline',
): Promise<{ id: string; status: SellRequestStatus }> {
  if (!config.useMocks) {
    return apiRequest<{ id: string; status: SellRequestStatus }>(
      `/buylist/requests/${id}/respond`,
      { method: 'POST', body: { decision } },
    );
  }
  // MOCK: espeja el efecto del backend sobre la solicitud en memoria (para que el refetch la refleje).
  const req = fx.mockSellRequests.find((r) => r.sellRequestId === id);
  if (!req) throw new ApiClientError(404, { code: 'NOT_FOUND', message: 'Sell request not found' });
  if (decision === 'decline') {
    req.status = 'rechazada';
    req.items = req.items.map((it) =>
      it.itemStatus === 'ajustada' ? { ...it, itemStatus: 'rechazada' } : it,
    );
  } else {
    req.items = req.items.map((it) =>
      it.itemStatus === 'ajustada' ? { ...it, itemStatus: 'aprobada' } : it,
    );
    req.status = 'aprobada';
  }
  return delay({ id: req.sellRequestId, status: req.status });
}

// ---------- Disputas del cliente (contrato §7) ----------
/**
 * Abre una disputa de CONDICIÓN sobre un ítem entregado (contrato §7 · POST /disputes, `customer`).
 * El `type` (condition_raw | condition_sealed) lo deriva el backend del `productType` del ítem (el
 * cliente NO lo envía); graded → `422 NOT_RAW`. Ventana de 7 días desde la entrega → fuera de plazo
 * `422 DISPUTE_WINDOW_CLOSED`; ítem ajeno → `403`. La evidencia va por CORREO a soporte
 * (`evidenceContact`, v1.2 — no hay subida de archivos). Res 201 `CreateDisputeResponse`.
 */
export async function createDispute(input: CreateDisputeInput): Promise<CreateDisputeResponse> {
  if (!config.useMocks) {
    return apiRequest<CreateDisputeResponse>('/disputes', { method: 'POST', body: input });
  }
  // MOCK: espeja las guardas del backend (§7). Localiza el ítem en los envíos del usuario para
  // derivar productType/type y anclar la ventana a la entrega.
  const shipItem = fx.mockShipments
    .flatMap((s) => (s.items ?? []).map((it) => ({ item: it, shipment: s })))
    .find((x) => x.item.inventoryItemId === input.inventoryItemId);
  const productType = shipItem?.item.productType;
  if (productType === 'graded') {
    throw new ApiClientError(422, {
      code: 'NOT_RAW',
      message: 'Disputes apply only to raw/sealed items',
    });
  }
  const deliveredAt = shipItem?.shipment.deliveredAt;
  const now = Date.now();
  const WINDOW_MS = 7 * 24 * 3600 * 1000;
  if (deliveredAt && now > new Date(deliveredAt).getTime() + WINDOW_MS) {
    throw new ApiClientError(422, {
      code: 'DISPUTE_WINDOW_CLOSED',
      message: 'Dispute window (7d) closed',
    });
  }
  const type = productType === 'sealed' ? 'condition_sealed' : 'condition_raw';
  const deadlineAt = new Date(
    (deliveredAt ? new Date(deliveredAt).getTime() : now) + WINDOW_MS,
  ).toISOString();
  const dispute: ClientDisputeDTO = {
    id: `dsp-new-${Math.floor(Math.random() * 9000 + 1000)}`,
    inventoryItemId: input.inventoryItemId,
    type,
    status: 'abierta',
    description: input.description,
    deadlineAt,
    createdAt: new Date().toISOString(),
  };
  // Refleja la nueva disputa en "Mis disputas" (para que el refetch la muestre).
  fx.mockClientDisputes.unshift(dispute);
  return delay({
    disputeId: dispute.id,
    status: 'abierta',
    type,
    deadlineAt,
    evidenceContact: fx.DISPUTE_EVIDENCE_CONTACT,
  });
}

/** Lista de disputas propias del cliente (contrato §7 · GET /disputes → { data }). */
export async function getDisputes(): Promise<ClientDisputeDTO[]> {
  if (!config.useMocks) {
    const res = await apiRequest<{ data: ClientDisputeDTO[] }>('/disputes');
    return res.data;
  }
  return delay([...fx.mockClientDisputes]);
}

/** Detalle de una disputa propia (contrato §7 · GET /disputes/:id). */
export async function getDispute(id: string): Promise<ClientDisputeDTO> {
  if (!config.useMocks) return apiRequest<ClientDisputeDTO>(`/disputes/${id}`);
  const found = fx.mockClientDisputes.find((d) => d.id === id);
  if (!found) throw new ApiClientError(404, { code: 'NOT_FOUND', message: 'Dispute not found' });
  return delay(found);
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
    // v1.15: registrar la CLABE la deja "en archivo" (habilita el atajo en el siguiente flujo).
    clabeOnFile: !!input.clabe || fx.mockKyc.clabeOnFile,
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
    // WS-B: una sola fuente de limpieza de sesión (access token + refresh token + user). Delega en
    // clearClientSession (api-client) para no duplicar los tres removeItem: así no queda huérfana la
    // credencial de larga vida (refresh, 30d) en localStorage y ambos caminos limpian idéntico.
    clearClientSession();
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
  // v1.28 (P-17, ADITIVOS): con cardId+finish sirven el drill-down de copias por variante desde
  // el Master Set; con cardId+productType=sealed|graded, los drill-downs de esas pestañas.
  finish?: Finish;
  productType?: ProductType;
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
        finish: filters.finish,
        productType: filters.productType,
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
  // v1.28 (P-17): filtros del drill-down por variante / pestañas Sellado y Gradeadas.
  if (filters.finish) data = data.filter((i) => (i.finish ?? 'normal') === filters.finish);
  if (filters.productType) data = data.filter((i) => i.productType === filters.productType);
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
  /** v1.23-sealed-sales: condición del sellado (default `mint`; solo productType='sealed'). */
  sealedCondition?: SealedCondition;
  gradingCompany?: GradingCompany;
  gradeValue?: string;
  certNumber?: string;
  locationId?: string;
  acquisitionType: AcquisitionType;
  acquisitionPct?: number;
  // v1.28 (P-19): costo capturado para acquisitionType="compra" (documentado en el contrato).
  acquisitionCostCents?: number;
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

// ============================================================================
// v1.16-master-set (§M1): Master Set + captura/publicación por LOTE.
// ============================================================================

export interface MasterSetIndexFilters {
  q?: string;
  page?: number;
  pageSize?: number;
  sort?: MasterSetSort;
}

/**
 * Índice de sets con resumen agregado para inventariar (contrato §M1 ·
 * GET /admin/inventory/master-sets, `vault_operator+`). SOLO inventario de plataforma.
 */
export async function getMasterSets(
  filters: MasterSetIndexFilters = {},
): Promise<MasterSetIndexResponse> {
  if (!config.useMocks) {
    return apiRequest<MasterSetIndexResponse>('/admin/inventory/master-sets', {
      query: {
        q: filters.q,
        page: filters.page,
        pageSize: filters.pageSize,
        sort: filters.sort,
      },
    });
  }
  return delay(fx.mockMasterSetIndex(filters));
}

/**
 * Binder del set: una celda por carta del catálogo (contrato §M1 ·
 * GET /admin/inventory/master-sets/:setId). `cells` viene en ORDEN NATURAL por número
 * (numéricos por valor entero primero; promos/subsets al final): el front NO re-ordena.
 */
export async function getMasterSetBinder(setId: string): Promise<MasterSetBinderResponse> {
  if (!config.useMocks) {
    return apiRequest<MasterSetBinderResponse>(`/admin/inventory/master-sets/${setId}`);
  }
  try {
    return await delay(fx.mockMasterSetBinder(setId));
  } catch (e) {
    throw translateFixtureError(e);
  }
}

/**
 * Alta por LOTE / carrito de captura (contrato §M1 · POST /admin/inventory/items/batch,
 * `vault_operator+`). Manda `batchKey` en el body Y como header `Idempotency-Key`
 * (equivalentes). Respuesta tolerante por-línea: una línea inválida trae su error y NO
 * tumba las demás (HTTP 200). Un replay del mismo `batchKey` no duplica (idempotentReplay).
 */
export async function batchCreateItems(
  payload: BatchCreateInventoryRequest,
): Promise<BatchCreateInventoryResponse> {
  if (!config.useMocks) {
    return apiRequest<BatchCreateInventoryResponse>('/admin/inventory/items/batch', {
      method: 'POST',
      body: payload,
      headers: { 'Idempotency-Key': payload.batchKey },
    });
  }
  return delay(fx.mockBatchCreate(payload));
}

/**
 * Publicar por LOTE (contrato §M1 · POST /admin/inventory/items/bulk-publish,
 * `vault_operator+`). Varias piezas → `listed` en 1 request. Tolerante por-línea:
 * `ITEM_NOT_PUBLISHABLE` (status de origen no publicable) y `PRICE_PENDING` (sin precio
 * resoluble) son errores POR-LÍNEA que no tumban el resto. Publicar una pieza ya `listed`
 * es no-op idempotente (ok:true). El precio se DERIVA server-side salvo override manual.
 *
 * v1.26 (P-7): `payload.repriceFresh?` (opcional, default `false` = ausente) pide al backend
 * REFRESCAR la PriceReference con un fetch on-demand por carta ANTES de precio+publicar (sobre
 * inventario `in_stock` no publicado). Hereda el gate ④: una variante aún priceless tras el
 * refresh ESCALA a la cola de precios pendientes (línea `ok:false` code `PRICE_PENDING`, con
 * `pendingPriceEntryId?`) y NO se publica. Omitirlo deja el comportamiento previo intacto.
 */
export async function bulkPublishItems(
  payload: BulkPublishRequest,
): Promise<BulkPublishResponse> {
  if (!config.useMocks) {
    return apiRequest<BulkPublishResponse>('/admin/inventory/items/bulk-publish', {
      method: 'POST',
      body: payload,
    });
  }
  return delay(fx.mockBulkPublish(payload));
}

// ============================================================================
// v1.28 Stream B (§M1/§M2/§6): inventario M1 operable — consola de precios,
// publicar-todo, pestañas Sellado/Gradeadas y Top Bounties.
// ============================================================================

/**
 * Consola de precios por (carta, variante[, grado]) (contrato §M2 v1.28 ·
 * PUT /admin/pricing/variant-controls/:cardId/:finish, `super_admin`, auditado).
 * Upsert de VariantPriceOverride (M-30): `sellOverrideCents` PISA el precio publicado del
 * storefront; `buyOverrideCents`/bounty PISAN la oferta del cotizador público. Campos omitidos
 * no se tocan; `null` explícito LIMPIA (la cara vuelve a su regla al instante).
 */
export async function putVariantControls(
  cardId: string,
  finish: Finish,
  req: VariantControlsRequest,
): Promise<VariantControlsResponse> {
  if (!config.useMocks) {
    return apiRequest<VariantControlsResponse>(
      `/admin/pricing/variant-controls/${cardId}/${finish}`,
      { method: 'PUT', body: req },
    );
  }
  // MOCK: replica las validaciones server-side del contrato (422 con código propio).
  const card = fx.mockCards.find((c) => c.id === cardId);
  if (!card) throw new ApiClientError(404, { code: 'NOT_FOUND', message: 'card not found' });
  const productType = req.productType ?? 'raw';
  if (productType === 'raw' && !card.availableFinishes.includes(finish)) {
    throw new ApiClientError(422, {
      code: 'FINISH_NOT_AVAILABLE',
      message: 'finish not in availableFinishes',
    });
  }
  const positiveOrNull = (v: number | null | undefined) => v == null || (Number.isInteger(v) && v > 0);
  if (!positiveOrNull(req.sellOverrideCents) || !positiveOrNull(req.buyOverrideCents)) {
    throw new ApiClientError(422, { code: 'VALIDATION_ERROR', message: 'cents must be > 0' });
  }
  if (req.bounty && req.bounty.enabled) {
    if (productType !== 'raw') {
      throw new ApiClientError(422, { code: 'VALIDATION_ERROR', message: 'bounty is raw-only' });
    }
    if (req.bounty.priceCents == null || req.bounty.priceCents <= 0) {
      throw new ApiClientError(422, {
        code: 'BOUNTY_PRICE_REQUIRED',
        message: 'bounty requires explicit price',
      });
    }
    const suggested = fx.mockSuggestedBuyCents(cardId, finish);
    if (suggested != null && req.bounty.priceCents < suggested) {
      throw new ApiClientError(422, {
        code: 'BOUNTY_BELOW_RULE',
        message: 'bounty price below rule suggestion',
        details: { suggestedCents: suggested },
      });
    }
    if (req.bounty.targetQty != null && req.bounty.targetQty < 1) {
      throw new ApiClientError(422, { code: 'VALIDATION_ERROR', message: 'targetQty must be >= 1' });
    }
  }
  return delay(fx.mockUpsertVariantControls(cardId, finish, req));
}

/**
 * Publicar TODO el inventario (o un filtro) de golpe (contrato §M1 v1.28 ·
 * POST /admin/inventory/publish-all, `vault_operator+`). Selección server-side (sin cap),
 * pipeline por-pieza idéntico a bulk-publish, tolerante por-ítem; `PRICE_PENDING` escala a la
 * cola (context=inventory) y NO publica. Idempotente por `batchKey` (replay = resultado guardado).
 */
export async function publishAllInventory(payload: PublishAllRequest): Promise<PublishAllResponse> {
  if (!config.useMocks) {
    return apiRequest<PublishAllResponse>('/admin/inventory/publish-all', {
      method: 'POST',
      body: payload,
    });
  }
  return delay(fx.mockPublishAll(payload));
}

/**
 * Índice de la pestaña «Sellado» (contrato §M1 v1.28 · GET /admin/inventory/sealed-sets,
 * `vault_operator+`): sets con ≥1 pieza sellada de plataforma + `unmappedTotal` global.
 */
export async function getSealedInventorySets(
  params: { q?: string; page?: number; pageSize?: number } = {},
): Promise<SealedSetsResponse> {
  if (!config.useMocks) {
    return apiRequest<SealedSetsResponse>('/admin/inventory/sealed-sets', {
      query: { q: params.q, page: params.page, pageSize: params.pageSize },
    });
  }
  return delay(fx.mockSealedSets(params));
}

/**
 * Detalle por set de la pestaña «Sellado» (contrato §M1 v1.28 ·
 * GET /admin/inventory/sealed-sets/:setId): grupos por identidad §4.23 con conteos,
 * `sealedMarketRef` y costo agregado.
 */
export async function getSealedInventorySet(setId: string): Promise<SealedSetDetailResponse> {
  if (!config.useMocks) {
    return apiRequest<SealedSetDetailResponse>(`/admin/inventory/sealed-sets/${setId}`);
  }
  try {
    return await delay(fx.mockSealedSetDetail(setId));
  } catch (e) {
    throw translateFixtureError(e);
  }
}

/**
 * Pestaña «Gradeadas» (contrato §M1 v1.28 · GET /admin/inventory/graded, `vault_operator+`):
 * inventario PSA/CGC agregado por (carta, empresa, grado) con valor de mercado por grado
 * (típicamente MANUAL, fijado con POST /admin/pricing/override productType="graded").
 */
export async function getGradedInventory(
  params: { q?: string; page?: number; pageSize?: number } = {},
): Promise<GradedInventoryResponse> {
  if (!config.useMocks) {
    return apiRequest<GradedInventoryResponse>('/admin/inventory/graded', {
      query: { q: params.q, page: params.page, pageSize: params.pageSize },
    });
  }
  return delay(fx.mockGradedInventory(params));
}

/**
 * «Top Bounties» de la página Vender (contrato §6 v1.28 · GET /buylist/bounties, público,
 * READ-ONLY): bounties activos, orden precio desc, cap 50. Errores NO bloquean el flujo de
 * venta (la vitrina se oculta).
 */
export async function getPublicBounties(): Promise<PublicBountiesResponse> {
  if (!config.useMocks) {
    return apiRequest<PublicBountiesResponse>('/buylist/bounties');
  }
  return delay(fx.mockPublicBounties());
}

// ---------- Master set en todas partes (v1.20) · admin vaults + ajustes ----------

export interface AdminVaultFilters {
  q?: string;
  page?: number;
  pageSize?: number;
  sort?: AdminVaultSort;
}

/**
 * Lista de clientes CON bóveda (contrato §M1 v1.20 · GET /admin/vaults, `vault_operator+`).
 * Valuación con la MISMA base del portafolio (§3); sort default `value_desc`.
 */
export async function getAdminVaults(filters: AdminVaultFilters = {}): Promise<AdminVaultListResponse> {
  if (!config.useMocks) {
    return apiRequest<AdminVaultListResponse>('/admin/vaults', {
      query: { q: filters.q, page: filters.page, pageSize: filters.pageSize, sort: filters.sort },
    });
  }
  return delay(fx.mockAdminVaults(filters));
}

/**
 * Vista (ii): índice master set de la bóveda de UN cliente (contrato §M1 v1.20 ·
 * GET /admin/vaults/:userId/master-sets, `vault_operator+`). Mismo shape que el índice M1
 * con scope="user_vault" y owner CON email. Solo sets con ≥1 pieza del cliente.
 */
export async function getAdminVaultMasterSets(
  userId: string,
  filters: MasterSetIndexFilters = {},
): Promise<MasterSetIndexResponse> {
  if (!config.useMocks) {
    return apiRequest<MasterSetIndexResponse>(`/admin/vaults/${userId}/master-sets`, {
      query: { q: filters.q, page: filters.page, pageSize: filters.pageSize, sort: filters.sort },
    });
  }
  try {
    return await delay(
      fx.mockMasterSetIndex(filters, {
        kind: 'user_vault',
        owner: fx.mockVaultOwnerOf(userId),
        holdings: fx.mockVaultHoldingsByUser[userId] ?? [],
      }),
    );
  } catch (e) {
    throw translateFixtureError(e);
  }
}

/**
 * Vista (ii): binder de la bóveda del cliente (contrato §M1 v1.20 ·
 * GET /admin/vaults/:userId/master-sets/:setId). SIN `buyable` y SIN acciones: lectura pura
 * para soporte/operación.
 */
export async function getAdminVaultMasterSetBinder(
  userId: string,
  setId: string,
): Promise<MasterSetBinderResponse> {
  if (!config.useMocks) {
    return apiRequest<MasterSetBinderResponse>(`/admin/vaults/${userId}/master-sets/${setId}`);
  }
  try {
    return await delay(
      fx.mockMasterSetBinder(setId, {
        kind: 'user_vault',
        owner: fx.mockVaultOwnerOf(userId),
        holdings: fx.mockVaultHoldingsByUser[userId] ?? [],
      }),
    );
  } catch (e) {
    throw translateFixtureError(e);
  }
}

/**
 * Ajuste de inventario por levantamiento físico desde la celda del binder M1 (contrato
 * §M1 v1.20.1 · POST /admin/inventory/adjustments, `vault_operator+`, auditado). Motivo
 * OBLIGATORIO (encontrada | perdida | danada | error_captura). Con `encontrada` el caller
 * DEBE mandar `batchKey` (idempotencia: mismo batchKey → replay de la respuesta guardada
 * con `idempotentReplay:true`, sin re-crear piezas); los otros motivos no lo llevan (su
 * replay cae en 422 ITEM_NOT_ADJUSTABLE). Respuesta v1.20.1: `adjustmentIds: string[]`
 * alineado 1:1 con `inventoryItemIds`/`folios` (sin el singular `adjustmentId`). NO hay
 * venta directa manual desde el binder: toda salida de venta pasa por órdenes (checkout/M3).
 */
export async function createInventoryAdjustment(
  payload: InventoryAdjustmentRequest,
): Promise<InventoryAdjustmentResponse> {
  if (!config.useMocks) {
    return apiRequest<InventoryAdjustmentResponse>('/admin/inventory/adjustments', {
      method: 'POST',
      body: payload,
    });
  }
  try {
    return await delay(fx.mockCreateAdjustment(payload));
  } catch (e) {
    throw translateFixtureError(e);
  }
}

/**
 * P-29 «baja rápida»: da de baja N piezas de UNA variante de un golpe (atajo simétrico al alta
 * rápida por lote). Consume `POST /admin/inventory/items/bulk-remove` (backend implementado). La
 * baja es ATÓMICA: o baja las `quantity` completas o ninguna (422 INSUFFICIENT_STOCK con
 * `{ available, requested }`); `reason` (enum) y `note` (texto libre no-vacío) son OBLIGATORIOS.
 * `batchKey?` (v1.35): idempotencia por intento — mismo batchKey tras un reintento → replay de la
 * respuesta guardada (`idempotentReplay:true`), cierra el «encogimiento fantasma». El front además
 * valida contra el conteo visible (barrera de UI).
 */
export async function bulkRemoveInventory(
  payload: BulkRemoveInventoryRequest,
): Promise<BulkRemoveInventoryResponse> {
  if (!config.useMocks) {
    return apiRequest<BulkRemoveInventoryResponse>('/admin/inventory/items/bulk-remove', {
      method: 'POST',
      body: payload,
    });
  }
  try {
    return await delay(fx.mockBulkRemove(payload));
  } catch (e) {
    throw translateFixtureError(e);
  }
}

/**
 * P-31 «Exportar a Excel»: descarga el .xlsx del inventario M1 con el filtro/set actual (si
 * aplica). Consume `GET /admin/inventory/export.xlsx` (backend implementado): binario xlsx con
 * `Content-Disposition: attachment; filename="inventario-YYYY-MM-DD.xlsx"`. Devuelve el Blob + el
 * `filename` sugerido (o null); el caller dispara la descarga usando ese nombre o el suyo propio.
 */
export interface InventoryExportFilters {
  setId?: string;
  status?: InventoryStatus;
  productType?: ProductType;
  finish?: Finish;
  q?: string;
}
export async function exportAdminInventoryXlsx(
  filters: InventoryExportFilters = {},
): Promise<BlobResponse> {
  if (!config.useMocks) {
    return requestBlob('/admin/inventory/export.xlsx', {
      query: {
        setId: filters.setId,
        status: filters.status,
        productType: filters.productType,
        finish: filters.finish,
        q: filters.q,
      },
    });
  }
  // MOCK: genera un Blob con el tipo MIME de xlsx para que el front ejercite la ruta blob →
  // descarga sin backend (el contenido NO es un xlsx válido: es demo). Sin Content-Disposition en
  // el mock ⇒ `filename: null` ⇒ el caller cae a su propio nombre.
  const rows = fx.mockInventory
    .filter((i) => (filters.setId ? i.card.setId === filters.setId : true))
    .filter((i) => (filters.status ? i.status === filters.status : true))
    .filter((i) => (filters.productType ? i.productType === filters.productType : true))
    .map((i) => `${i.folio}\t${i.card.name}\t${i.productType}\t${i.status}`);
  const body = ['folio\tcarta\ttipo\testado', ...rows].join('\n');
  return delay(
    {
      blob: new Blob([body], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      filename: null,
    },
    150,
  );
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

// MOCK: identidad legible del vendedor (AdminSellerRef, v1.18) para las filas de
// fixtures que solo traen userId. En rama real el join lo hace el backend.
const MOCK_SELLERS: Record<string, AdminSellerRef> = {
  'u-777': { id: 'u-777', name: 'Diana Olvera', email: 'diana.olvera@example.mx' },
  'u-778': { id: 'u-778', name: 'Marco Peña', email: 'marco.pena@example.mx' },
  'u-779': { id: 'u-779', name: 'Sofía Lara', email: 'sofia.lara@example.mx' },
};
function mockSellerFor(userId: string): AdminSellerRef {
  return MOCK_SELLERS[userId] ?? { id: userId, name: userId, email: `${userId}@example.mx` };
}

/**
 * Filtros server-side de la cola admin de buylist (contrato §M5 · GET /admin/buylist).
 * v1.25-buylist-orders-pagination: TODOS opcionales y ADITIVOS — omitirlos = comportamiento
 * de HOY. `status` acepta LISTA CSV (p. ej. `pagada,rechazada,abandonada` para la pestaña
 * «Cerradas»); `q` (folio/vendedor) sustituye el buscador client-side; `from`/`to` (createdAt),
 * `minCents`/`maxCents` (sobre `quotedTotalCents`). `pageSize` que pide el front = 25.
 */
export interface AdminBuylistFilters {
  /** v1.25: uno o varios `SellRequestStatus` en CSV (`IN (...)`); un solo valor = como HOY. */
  status?: string;
  userId?: string;
  q?: string;
  from?: string;
  to?: string;
  minCents?: number;
  maxCents?: number;
  page?: number;
  pageSize?: number;
}

/**
 * Cola admin de buylist paginada (contrato §M5 · GET /admin/buylist → `{ data, page, pageSize,
 * total }`). v1.25: acepta el objeto de filtros y lo serializa a query string (los vacíos se
 * omiten en `apiRequest`). Sin args = página 1 con los defaults del server (comportamiento previo,
 * la vista solo consumía `.data`). El server ordena `createdAt desc` (NORMA v1.18); no re-ordenar.
 */
export async function getAdminBuylist(
  filters: AdminBuylistFilters = {},
): Promise<Paginated<AdminBuylistDTO>> {
  if (!config.useMocks) {
    return apiRequest<Paginated<AdminBuylistDTO>>('/admin/buylist', {
      query: {
        status: filters.status,
        userId: filters.userId,
        q: filters.q,
        from: filters.from,
        to: filters.to,
        minCents: filters.minCents,
        maxCents: filters.maxCents,
        page: filters.page,
        pageSize: filters.pageSize,
      },
    });
  }
  // MOCK: espeja los filtros server-side v1.25 en memoria.
  let data = fx.mockAdminBuylist.map((r) => ({ ...r, seller: r.seller ?? mockSellerFor(r.userId) }));
  if (filters.status) {
    const set = new Set(filters.status.split(',').map((s) => s.trim()).filter(Boolean));
    data = data.filter((r) => set.has(r.status));
  }
  if (filters.userId) data = data.filter((r) => r.userId === filters.userId);
  const q = filters.q?.trim().toLowerCase();
  if (q) {
    data = data.filter(
      (r) =>
        r.id.toLowerCase().includes(q) ||
        (r.seller?.name.toLowerCase().includes(q) ?? false) ||
        (r.seller?.email.toLowerCase().includes(q) ?? false),
    );
  }
  // Rango sobre createdAt (comparación por fecha YYYY-MM-DD; el backend real usa gte/lte ISO).
  if (filters.from) data = data.filter((r) => r.createdAt.slice(0, 10) >= filters.from!);
  if (filters.to) data = data.filter((r) => r.createdAt.slice(0, 10) <= filters.to!);
  // Rango sobre quotedTotalCents (contrato v1.25: NO approvedTotalCents — ver §M5).
  if (filters.minCents != null) data = data.filter((r) => r.quotedTotalCents >= filters.minCents!);
  if (filters.maxCents != null) data = data.filter((r) => r.quotedTotalCents <= filters.maxCents!);
  // El ORDEN (`createdAt desc`, NORMA v1.18) lo aplica el server; el mock respeta el orden de los
  // fixtures (no re-ordena) igual que antes de v1.25.
  return delay(paginate(data, filters));
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
 * Cierre EXPLÍCITO de una solicitud a `rechazada` (contrato §M5 · POST /admin/buylist/:id/reject,
 * v1.24-buylist-request-reject). Botón «Rechazar solicitud» de M5: cierra el hueco de estado a
 * nivel solicitud (bug P-4) para las solicitudes ya atoradas en `verificacion` cuyos ítems fueron
 * rechazados antes del fix. Semántica SEGURA y mínima: `reason` es OPCIONAL (0–500, motivo interno
 * al AuditLog, NO PII, sin correo); NO mueve dinero ni reevalúa montos.
 *  - Guard de precondición: cierra SÓLO si TODOS los ítems ya son `rechazada`; si queda algún ítem
 *    vivo → `422 REQUEST_HAS_NON_REJECTED_ITEMS` (`details.nonRejectedItemStatuses`).
 *  - Idempotente: solicitud ya `rechazada` → `200` con el estado actual (no re-sella).
 *  - Otro estado terminal (`pagada`/`abandonada`) → `409 CONFLICT` (no pisa terminal).
 *
 * Retorno (hallazgo QA de P-4): la Res 200 es la SOLICITUD actualizada, «mismo shape que
 * `GET /admin/buylist/:id`» (contrato §M5) — el DETALLE admin con `id`/`userId`/`seller`/`status`/
 * `items` con sus campos de rechazo. En este front ese detalle SE MODELA con `AdminBuylistDTO`
 * (idéntico shape que devuelven `receive`/`verify`/`paySpei` y cada fila de `getAdminBuylist`); NO
 * con el DTO de CLIENTE `SellRequestDTO` (`sellRequestId`/`ineRequired`, sin `seller`), que sería
 * incorrecto para un endpoint de back-office. Por eso el tipo correcto del detalle es `AdminBuylistDTO`.
 */
export async function rejectBuylistRequest(
  id: string,
  input: { reason?: string } = {},
): Promise<AdminBuylistDTO> {
  if (!config.useMocks) {
    return apiRequest<AdminBuylistDTO>(`/admin/buylist/${id}/reject`, {
      method: 'POST',
      body: input.reason && input.reason.trim() !== '' ? { reason: input.reason.trim() } : {},
    });
  }
  const req = mockFindBuylistRequest(id);
  // Idempotencia: ya rechazada → no-op (200 con el estado actual).
  if (req.status === 'rechazada') return delay({ ...req });
  // No pisar otros estados terminales (contrato: 409 CONFLICT).
  if (req.status === 'pagada' || req.status === 'abandonada') {
    throw new ApiClientError(409, {
      code: 'CONFLICT',
      message: 'Sell request is already in a terminal state',
      details: { status: req.status },
    });
  }
  // Guard de precondición: sólo cierra si TODOS los ítems ya están `rechazada`.
  const nonRejected = req.items.filter((it) => it.itemStatus !== 'rechazada');
  if (nonRejected.length > 0) {
    throw new ApiClientError(422, {
      code: 'REQUEST_HAS_NON_REJECTED_ITEMS',
      message: 'The sell request still has non-rejected items',
      details: { nonRejectedItemStatuses: nonRejected.map((it) => it.itemStatus) },
    });
  }
  req.status = 'rechazada';
  return delay({ ...req });
}

/** Plazos del ítem rechazado en la rama MOCK (espeja las constantes 7d/30d del backend). */
const DAY_MS = 24 * 3600 * 1000;
function mockRejectDeadlines(rejectedAtIso: string): {
  returnDeadlineAt: string;
  abandonDeadlineAt: string;
} {
  const t0 = new Date(rejectedAtIso).getTime();
  return {
    returnDeadlineAt: new Date(t0 + 7 * DAY_MS).toISOString(),
    abandonDeadlineAt: new Date(t0 + 30 * DAY_MS).toISOString(),
  };
}

/**
 * Cherry-pick por carta (contrato PATCH /admin/buylist/items/:itemId/decision).
 * `adjust` exige `approvedPriceCents`; el backend valida el tope B-4/AML y puede responder
 * 422 APPROVED_PRICE_CAP_EXCEEDED (se muestra el mensaje real al operador).
 * v1.18-buylist-rejects: `reject` exige `reason` (3–500 chars → 400 VALIDATION_ERROR si
 * falta); fija rejectedAt y anula approvedPriceCents (el backend recomputa el total
 * excluyendo rechazadas — la UI nunca suma dinero, SEC-A1).
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
  if (input.decision === 'reject') {
    // Espeja la validación del backend (400 VALIDATION_ERROR, contrato §M5).
    const reason = input.reason?.trim() ?? '';
    if (reason.length < 3 || reason.length > 500) {
      throw new ApiClientError(400, {
        code: 'VALIDATION_ERROR',
        message: 'reason is required for reject (3-500 chars)',
      });
    }
    const rejectedAt = new Date().toISOString();
    item.itemStatus = 'rechazada';
    item.approvedPriceCents = undefined; // invariante: fuera del total aprobado
    item.rejectionReason = reason;
    item.rejectedAt = rejectedAt;
    const deadlines = mockRejectDeadlines(rejectedAt);
    item.returnDeadlineAt = deadlines.returnDeadlineAt;
    item.abandonDeadlineAt = deadlines.abandonDeadlineAt;
    return delay({ ...item });
  }
  item.itemStatus = next[input.decision];
  item.approvedPriceCents = input.approvedPriceCents ?? item.quotedPriceCents ?? 0;
  return delay({ ...item });
}

/**
 * Pestaña «Rechazadas» de M5 (contrato §M5 · GET /admin/buylist/rejected-items,
 * v1.18-buylist-rejects). Listado paginado TRANSVERSAL (todas las solicitudes) de ítems
 * `itemStatus="rechazada"`, orden `rejectedAt` desc (legacy sin fecha al final); el
 * server deriva los plazos (+7d/+30d) y la UI solo deriva la FASE de now vs las fechas.
 */
export async function getAdminRejectedBuylistItems(
  params: PageParams & { userId?: string } = {},
): Promise<Paginated<RejectedSellItemDTO>> {
  if (!config.useMocks) {
    return apiRequest<Paginated<RejectedSellItemDTO>>('/admin/buylist/rejected-items', {
      query: { page: params.page, pageSize: params.pageSize, userId: params.userId },
    });
  }
  // MOCK: se derivan de los fixtures en memoria (los rechazos hechos en esta sesión
  // aparecen aquí), espejando la proyección RejectedSellItemDTO del backend.
  const rows: RejectedSellItemDTO[] = fx.mockAdminBuylist.flatMap((req) =>
    req.items
      .filter((it) => it.itemStatus === 'rechazada')
      .map((it) => ({
        id: it.id,
        sellRequestId: req.id,
        seller: req.seller ?? mockSellerFor(req.userId),
        card: it.card,
        productType: it.productType,
        finish: it.finish,
        quotedPriceCents: it.quotedPriceCents,
        reason: it.rejectionReason ?? null,
        rejectedAt: it.rejectedAt ?? null,
        returnDeadlineAt: it.returnDeadlineAt ?? null,
        abandonDeadlineAt: it.abandonDeadlineAt ?? null,
      })),
  );
  const filtered = params.userId ? rows.filter((r) => r.seller?.id === params.userId) : rows;
  // Orden del contrato: rejectedAt desc, legacy (null) al final.
  filtered.sort((a, b) => {
    if (!a.rejectedAt) return b.rejectedAt ? 1 : 0;
    if (!b.rejectedAt) return -1;
    return b.rejectedAt.localeCompare(a.rejectedAt);
  });
  return delay(paginate(filtered, params));
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

/**
 * Filtros server-side de la cola admin de órdenes (contrato §M3 · GET /admin/orders).
 * v1.25-buylist-orders-pagination: en paridad con buylist. `q` (folio `orderNumber` /
 * comprador — HOY NO existía buscador en M3), `from`/`to` (createdAt), `minCents`/`maxCents`
 * (sobre `totalCents`, total canónico). `status`, `userId`, `guest`, `needsManual` ya existían.
 * `pageSize` que pide el front = 25.
 */
export interface AdminOrdersFilters {
  status?: string;
  userId?: string;
  q?: string;
  from?: string;
  to?: string;
  minCents?: number;
  maxCents?: number;
  guest?: boolean;
  needsManual?: boolean;
  page?: number;
  pageSize?: number;
}

/**
 * Cola admin de órdenes paginada (contrato §M3 · GET /admin/orders → `{ data, page, pageSize,
 * total }`). v1.25: acepta el objeto de filtros y lo serializa a query string (vacíos omitidos).
 * Sin args = página 1 con defaults del server. Orden `createdAt desc` (recientes primero).
 */
export async function getAdminOrders(
  filters: AdminOrdersFilters = {},
): Promise<Paginated<AdminOrderDTO>> {
  if (!config.useMocks) {
    return apiRequest<Paginated<AdminOrderDTO>>('/admin/orders', {
      query: {
        status: filters.status,
        userId: filters.userId,
        q: filters.q,
        from: filters.from,
        to: filters.to,
        minCents: filters.minCents,
        maxCents: filters.maxCents,
        guest: filters.guest === undefined ? undefined : String(filters.guest),
        needsManual: filters.needsManual === undefined ? undefined : String(filters.needsManual),
        page: filters.page,
        pageSize: filters.pageSize,
      },
    });
  }
  // MOCK: espeja los filtros server-side v1.25 en memoria.
  let data = [...fx.mockAdminOrders];
  if (filters.status) {
    const set = new Set(filters.status.split(',').map((s) => s.trim()).filter(Boolean));
    data = data.filter((o) => set.has(o.status));
  }
  if (filters.userId) data = data.filter((o) => o.userId === filters.userId);
  const q = filters.q?.trim().toLowerCase();
  if (q) {
    // Fidelidad con el backend real (contrato §M3): `q` busca sobre `orderNumber` (parcial),
    // `guestEmail` (parcial), `userId` (EXACTO) y `user.name`/`user.email` (parcial) — NO un
    // `includes` sobre el UUID de usuario, que daba falsos verdes en tests de UI. El fixture usa
    // `id` como folio visible de la orden (análogo de `orderNumber`); los demás campos se leen de
    // forma defensiva por si el fixture/join los aporta.
    data = data.filter((o) => {
      const ord = o as AdminOrderDTO & {
        orderNumber?: string;
        guestEmail?: string | null;
        user?: { name?: string; email?: string } | null;
      };
      return (
        (ord.orderNumber ?? ord.id).toLowerCase().includes(q) ||
        (ord.guestEmail?.toLowerCase().includes(q) ?? false) ||
        ord.userId?.toLowerCase() === q ||
        (ord.user?.name?.toLowerCase().includes(q) ?? false) ||
        (ord.user?.email?.toLowerCase().includes(q) ?? false)
      );
    });
  }
  if (filters.from) data = data.filter((o) => o.createdAt.slice(0, 10) >= filters.from!);
  if (filters.to) data = data.filter((o) => o.createdAt.slice(0, 10) <= filters.to!);
  if (filters.minCents != null) data = data.filter((o) => o.totalCents >= filters.minCents!);
  if (filters.maxCents != null) data = data.filter((o) => o.totalCents <= filters.maxCents!);
  // El ORDEN (`createdAt desc`, recientes primero) lo aplica el server; el mock respeta el orden
  // de los fixtures (no re-ordena).
  return delay(paginate(data, filters));
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
/**
 * Unifica las rarezas canónicas del catálogo (contrato POST /admin/catalog/unify-rarities; §19.5 /
 * BACKEND_NOTES §0-ter). Backfill LOCAL de `Card.rarityCanonical`: money-safe, síncrono e idempotente.
 * NUNCA llama a pokemontcg.io/TCGCSV y NO modifica precios ni reglas — solo colapsa duplicados/variantes
 * de escritura para que el editor de reglas por rareza muestre una fila por rareza real. Devuelve un
 * resumen honesto (cuántas cartas procesó/actualizó, cuántas canónicas distintas quedaron y la lista de
 * rarezas `unmapped` sin entrada en el catálogo canónico, para que el operador sepa cuáles añadir).
 */
export async function unifyRarities(): Promise<UnifyRaritiesResponse> {
  if (!config.useMocks) {
    return apiRequest<UnifyRaritiesResponse>('/admin/catalog/unify-rarities', { method: 'POST' });
  }
  // MOCK: simula una primera pasada que corrige duplicados y deja una rareza cruda sin mapear, para
  // ejercitar el resumen honesto (cartas actualizadas + lista de `unmapped` accionable).
  return delay({
    ok: true,
    cardsProcessed: 12000,
    cardsUpdated: 3400,
    distinctCanonical: 21,
    unmapped: [{ raw: 'Galaxy Foil', canonical: 'Galaxy Foil', count: 40 }],
  });
}

/**
 * Cola de precio pendiente (contrato GET /admin/pricing/pending).
 * v1.26 (P-6, dos buckets): `context?` opcional filtra la cola por origen — `inventory` = VENTA
 * (fijable por override), `buylist` = COMPRA (READ-ONLY). Omitirlo trae todos (retro-compatible).
 */
export async function getPendingPrices(
  context?: PendingPriceContext,
): Promise<PendingPriceEntryDTO[]> {
  if (!config.useMocks) {
    const res = await apiRequest<{ data: PendingPriceEntryDTO[] }>('/admin/pricing/pending', {
      query: { context },
    });
    return res.data;
  }
  return delay(
    context ? fx.mockPendingPrices.filter((p) => p.context === context) : fx.mockPendingPrices,
  );
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
  // v1.28 (P-20): con productType="graded" + gradeKey "graded:<company>:<grade>" es la vía
  // NORMATIVA para fijar el valor de mercado por carta+grado (pestaña Gradeadas de M1).
  if (input.productType === 'graded') {
    const m = input.gradeKey.match(/^graded:([^:]+):(.+)$/);
    if (m) fx.setMockGradedMarketRef(input.cardId, m[1], m[2], input.priceMxnCents);
  }
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

/**
 * Fija override manual de FX (contrato PUT /admin/fx). v1.14-price-ingest (#13): `rate` es
 * OPCIONAL — si se omite, actualiza SOLO el colchón (`bufferPct`) y NO pinnea un override
 * manual de tasa (conserva la tasa vigente de Banxico). Al menos uno de los dos debe venir.
 */
export async function updateFx(input: { rate?: number; bufferPct?: number }): Promise<FxDTO> {
  if (!config.useMocks) return apiRequest<FxDTO>('/admin/fx', { method: 'PUT', body: input });
  // MOCK: si se omite `rate`, conserva la tasa vigente y la fuente (solo cambia el colchón);
  // el override manual (`source=manual`) solo se marca cuando SÍ se fija una tasa.
  const next: FxDTO = {
    rate: input.rate ?? fx.mockFx.rate,
    bufferPct: input.bufferPct ?? fx.mockFx.bufferPct,
    source: input.rate != null ? 'manual' : fx.mockFx.source,
    effectiveDate: new Date().toISOString().slice(0, 10),
  };
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
 * Dispara la ingesta MASIVA de precios (contrato §M10-ops · POST /admin/jobs/price-ingest,
 * `super_admin`, auditado, single-flight, v1.14-price-ingest). Fan-out BullMQ un job por set.
 * `setId?` (ÚNICA excepción al body-vacío de la familia admin/jobs/*) ingesta UN solo set para
 * verificar el esquema del proveedor en la 1ª corrida; omitirlo ingesta TODO el catálogo.
 * Res `202`: `{ job, enqueued, jobId? }` (`enqueued=false` si ya había un pase en curso).
 */
export async function triggerPriceIngest(
  input: { setId?: string } = {},
): Promise<PriceIngestResponse> {
  if (!config.useMocks) {
    const body = input.setId ? { setId: input.setId } : {};
    return apiRequest<PriceIngestResponse>('/admin/jobs/price-ingest', { method: 'POST', body });
  }
  const res: PriceIngestResponse = input.setId
    ? { job: 'price-ingest', enqueued: true, jobId: mockJobId(), scope: 'set', setId: input.setId }
    : { job: 'price-ingest', enqueued: true, jobId: mockJobId() };
  return delay(res);
}

/**
 * P-33: `getPriceProvider`/`updatePriceProvider` (dial del proveedor de respaldo) se retiraron
 * junto con su UI (PriceProviderSection). El setting `priceProvider` sigue existiendo en el
 * backend (SettingsDTO.priceProvider) con PPT fijo como respaldo, sin control desde el frontend.
 */

/**
 * Rarezas distintas del catálogo sincronizado UNIDAS a las reglas de buylist, para
 * poblar el editor de precio por rareza (contrato GET /admin/pricing/rarities, v1.3.1).
 * Las rarezas sin regla explícita muestran el fallback (source="fallback").
 */
export async function getBuylistRarities(): Promise<BuylistRaritiesResponse> {
  if (!config.useMocks) return apiRequest<BuylistRaritiesResponse>('/admin/pricing/rarities');
  return delay(fx.mockBuylistRarities());
}

/**
 * PriceRuleSet de buylist: reglas por RAREZA CANÓNICA + reglas por ACABADO + fallback (contrato
 * GET /admin/pricing/buylist-rules, v1.29 dos ejes). Reemplaza el mapa plano `{ rules, fallbackPct }`
 * (que mezclaba rareza y acabado con keys sintéticas "Holo"/"Reverse Holo" — parche INV-1 retirado).
 */
export async function getBuylistRules(): Promise<PriceRuleSet> {
  if (!config.useMocks) return apiRequest<PriceRuleSet>('/admin/pricing/buylist-rules');
  return delay(fx.getMockBuylistRuleSet());
}

/**
 * Reemplaza el PriceRuleSet de buylist (reglas por rareza + por acabado + fallback) — contrato PUT
 * /admin/pricing/buylist-rules (v1.29). Validación server-side: mode ∈ {fixed,pct}; fixed → value
 * entero ≥ 0 (centavos); pct/fallback → número en [0,100]. Auditado (M10). Surte efecto sin redeploy.
 */
export async function updateBuylistRules(input: {
  rarityRules: Record<string, BuylistRule>;
  finishRules: Partial<Record<Finish, BuylistRule>>;
  fallbackPct?: number;
}): Promise<PriceRuleSet> {
  if (!config.useMocks) {
    return apiRequest<PriceRuleSet>('/admin/pricing/buylist-rules', { method: 'PUT', body: input });
  }
  fx.setMockBuylistRuleSet(input.rarityRules, input.finishRules, input.fallbackPct);
  return delay(fx.getMockBuylistRuleSet());
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

/** PriceRuleSet de VENTA (rareza canónica + acabado + fallback) — contrato GET /admin/pricing/sales-rules (v1.29). */
export async function getSalesRules(): Promise<SalesPriceRuleSet> {
  if (!config.useMocks) return apiRequest<SalesPriceRuleSet>('/admin/pricing/sales-rules');
  return delay(fx.getMockSalesRuleSet());
}

/**
 * Reemplaza el PriceRuleSet de VENTA (reglas por rareza + por acabado + fallback) — contrato PUT
 * /admin/pricing/sales-rules (v1.29). Validación server-side: mode ∈ {fixed,pct}; fixed → value
 * entero ≥ 0 (centavos, PISO); pct/fallback → número en [0,1000] (markup ARRIBA de mercado; puede
 * >100% a diferencia del pct de buylist). Auditado (M10). Surte efecto sin redeploy.
 */
export async function updateSalesRules(input: {
  rarityRules: Record<string, SalesRule>;
  finishRules: Partial<Record<Finish, SalesRule>>;
  fallbackPct?: number;
}): Promise<SalesPriceRuleSet> {
  if (!config.useMocks) {
    return apiRequest<SalesPriceRuleSet>('/admin/pricing/sales-rules', { method: 'PUT', body: input });
  }
  fx.setMockSalesRuleSet(input.rarityRules, input.finishRules, input.fallbackPct);
  return delay(fx.getMockSalesRuleSet());
}

/** Sets remotos de pokemontcg.io con estado local (contrato GET /admin/catalog/remote-sets). */
export async function getRemoteSets(): Promise<RemoteSetDTO[]> {
  if (!config.useMocks) {
    const res = await apiRequest<{ data: RemoteSetDTO[] }>('/admin/catalog/remote-sets');
    return res.data;
  }
  return delay(fx.mockRemoteSets);
}

/**
 * Importa/actualiza cartas de catálogo (contrato POST /admin/catalog/sync).
 * v1.27 (P-12): `force:true` corre además el resolver estructural TCGCSV para cada set procesado
 * (refresca variantes/availableFinishes aunque el set ya esté importado; best-effort, money-safe).
 * ⚠️ Este endpoint NO toca precios (§4.15g): para el «sync completo» de un set se encadena
 * `syncCatalog({ setId, force: true })` + `triggerPriceIngest({ setId })` (acción por fila de M2).
 */
export async function syncCatalog(input: {
  setId?: string;
  fromReleaseDate?: string;
  force?: boolean;
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
 * Refresca variantes + precios de UN set existente usando SOLO TCGCSV, sin pokemontcg.io
 * (contrato POST /admin/catalog/refresh-variants { setId, force? }). NO re-importa cartas: opera
 * sobre las cartas ya en BD. Es SÍNCRONO y devuelve un resumen del trabajo (cartas procesadas,
 * productos/variantes upsertados, precios encolados, pendientes sin precio, alcance de TCGCSV),
 * para poder arreglar el "fantasma" de un set ya importado aunque pokemontcg.io esté caído.
 * Errores del contrato: `SET_NOT_IMPORTED` (el set no está en BD) · `UPSTREAM_ERROR` (502, TCGCSV
 * no disponible). El llamador los muestra legibles (i18n) sin romper la pantalla.
 */
export async function refreshVariants(input: {
  setId: string;
  force?: boolean;
}): Promise<RefreshVariantsResponse> {
  if (!config.useMocks) {
    // `force` solo se manda cuando es true (retrocompatible: body mínimo por defecto).
    const body = input.force ? { setId: input.setId, force: true } : { setId: input.setId };
    return apiRequest<RefreshVariantsResponse>('/admin/catalog/refresh-variants', {
      method: 'POST',
      body,
    });
  }
  // MOCK (shape del contrato): simula un refresh del set con un producto sin precio (pending=1)
  // para ejercitar el reflejo money-safe honesto (no todo queda con precio).
  const set = fx.mockRemoteSets.find((s) => s.id === input.setId);
  const cards = set?.cardCount ?? 0;
  const products = Math.round(cards * 1.4);
  return delay({
    ok: true,
    setId: input.setId,
    cardsProcessed: cards,
    cardProductsUpserted: products,
    pricesUpserted: Math.max(0, products - 1),
    pending: cards > 0 ? 1 : 0,
    tcgcsvReachable: true,
  });
}

/**
 * BATCH de refresh-variants (contrato POST /admin/catalog/refresh-variants-all { force? }): corre el
 * mismo trabajo que `refreshVariants` por-set (repuebla variantes/acabados + precios desde TCGCSV,
 * SIN re-importar cartas y SIN pokemontcg.io) sobre TODOS los sets ya importados. Es ASÍNCRONO
 * (fire-and-forget): responde 202 con `{ jobId, setsQueued, remaining }` y SOLO arranca el barrido.
 * El progreso y el RESUMEN se leen aparte por `getRefreshVariantsStatus` (poll).
 */
export async function refreshVariantsAll(
  input: { force?: boolean } = {},
): Promise<RefreshVariantsAllResponse> {
  if (!config.useMocks) {
    // `force` solo se manda cuando es true (retrocompatible: body mínimo por defecto).
    const body = input.force ? { force: true } : {};
    return apiRequest<RefreshVariantsAllResponse>('/admin/catalog/refresh-variants-all', {
      method: 'POST',
      body,
    });
  }
  // MOCK (modelo async): arranca el barrido en el estado en memoria de fixtures y devuelve el 202.
  return delay(fx.startMockRefreshVariantsAll());
}

/**
 * Progreso + resumen del batch refresh-variants-all (contrato GET /admin/catalog/refresh-variants-status).
 * Endpoint STATUS PROPIO del batch (NO el `sync-status` de sync-all). Se POLLEA desde M2 hasta
 * `running=false`; al terminar trae el `summary` agregado (sets ok/fallidos, productos, precios,
 * pendientes, lista de `failures`). No llama a TCGCSV/pokemontcg.io, así que pollearlo no cuesta.
 */
export async function getRefreshVariantsStatus(): Promise<RefreshVariantsStatusResponse> {
  if (!config.useMocks) {
    return apiRequest<RefreshVariantsStatusResponse>('/admin/catalog/refresh-variants-status');
  }
  // MOCK (modelo async): cada lectura avanza el barrido; al completarlo apaga running y adjunta el
  // summary agregado (con UN set fallido y pending>0 para ejercitar el reflejo money-safe honesto).
  return delay(fx.readMockRefreshVariantsStatus());
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

/**
 * Progreso del barrido MASIVO de precios (contrato GET /admin/pricing/sync-status, `super_admin`,
 * N-11). Calca getSyncStatus (catálogo) para POLLING desde M2: da done/total en sets y el momento en
 * que termina, sin llamar al proveedor. Añade el presupuesto diario del proveedor de paga
 * (`dailyRemaining` / `dailyLimited` / `pending`) para avisar cuando se pausó por límite diario.
 */
export async function getPriceSyncStatus(): Promise<PriceSyncStatusResponse> {
  if (!config.useMocks) {
    return apiRequest<PriceSyncStatusResponse>('/admin/pricing/sync-status');
  }
  // Mock: nunca hay un barrido corriendo (el estado vive en memoria del backend real).
  return delay({
    running: false,
    jobId: null,
    total: 0,
    done: 0,
    startedAt: null,
    finishedAt: null,
    lastError: null,
    dailyRemaining: null,
    dailyLimited: false,
    pending: 0,
    provider: null,
  });
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

// ============================================================================
// Guest checkout — comprar sin cuenta (contrato §4-G, v1.21.1-guest-checkout-fixes)
// ----------------------------------------------------------------------------
// Sección ADITIVA: ninguna función anterior cambia. Reglas del contrato que se
// respetan aquí y que NO deben "mejorarse" desde el front:
//  - Los endpoints /checkout/guest/* y /orders/guest/* son públicos y RECHAZAN una
//    sesión válida (409 ALREADY_AUTHENTICATED): por eso NO se les manda Bearer (el
//    apiRequest solo añade Authorization si hay token; el flujo de invitado se
//    renderiza únicamente sin sesión).
//  - El token de seguimiento viaja en el BODY de un POST, jamás en la URL de la API.
//  - `checkoutToken` (v1.21.1; antes `trackingToken`) es la ÚNICA respuesta con un token
//    en claro (§4-G.0-5): no se persiste en localStorage ni se loguea. Vive 120 MINUTOS y
//    solo sirve para la confirmación post-3DS; el enlace de seguimiento de 90 días lo emite
//    el webhook del settle y llega SOLO por correo (§4-G.7a).
// ============================================================================

/** Tarifa fija de envío (dial SHIPPING_FEE_CENTS, default 17500). MOCK: el valor real viaja en el BreakdownDTO. */
const MOCK_SHIPPING_FEE_CENTS = 17500;

/**
 * MOCK: réplica local de `computeDirectShipBreakdown` (contrato §4-G / ARCHITECTURE §5.1)
 * — el IVA grava cartas + envío y el fee es gross-up sobre esa base.
 */
function computeGuestBreakdown(subtotalCents: number, shippingFeeCents: number): BreakdownDTO {
  const ivaCents = Math.round(((subtotalCents + shippingFeeCents) * IVA_PCT) / 100);
  const baseCents = subtotalCents + shippingFeeCents + ivaCents;
  const totalCents = Math.ceil((baseCents + STRIPE_FIXED) / (1 - STRIPE_PCT));
  const processingFeeCents = totalCents - baseCents;
  return {
    subtotalCents,
    shippingFeeCents,
    ivaCents,
    ivaRatePct: IVA_PCT,
    processingFeeCents,
    totalCents,
    currency: 'MXN',
  };
}

/**
 * Desglose del carrito de invitado (contrato POST /checkout/guest/quote, §4-G.1).
 * Read-only: NO reserva inventario. `shippingAddress` es opcional (la tarifa es fija y
 * nacional); si se envía, el backend valida MX (422 ADDRESS_NOT_MX).
 * Errores: 422 PRICE_PENDING, 409 ITEM_UNAVAILABLE, 422 ADDRESS_NOT_MX,
 * 400 VALIDATION_ERROR (carrito vacío o > 20 items), 409 ALREADY_AUTHENTICATED, 429.
 */
export async function getGuestCheckoutQuote(
  inventoryItemIds: string[],
  shippingAddress?: GuestAddressInput,
): Promise<GuestCheckoutQuoteResponse> {
  if (!config.useMocks) {
    return apiRequest<GuestCheckoutQuoteResponse>('/checkout/guest/quote', {
      method: 'POST',
      body: { inventoryItemIds, shippingAddress },
    });
  }
  // MOCK v1.21.3-quote-prune: MISMA poda por ítem que getCheckoutQuote (§4-G.1 comparte
  // la norma con §4). Carrito 100 % muerto ⇒ breakdown en CEROS con shippingFeeCents: 0.
  const unavailableItems = inventoryItemIds
    .filter((id) => !fx.mockListings.some((l) => l.inventoryItemId === id))
    .map((id) => ({ inventoryItemId: id, cardName: null }));
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
      unitPriceCents: l.salePriceCents ?? 0,
    })),
    fulfillmentMode: 'direct_ship' as const,
    breakdown:
      items.length === 0 ? zeroBreakdown(true) : computeGuestBreakdown(subtotal, MOCK_SHIPPING_FEE_CENTS),
    // v1.21.4-dual-breakdown (§4-G.1, N-12): SEGUNDO desglose para el destino BÓVEDA — solo
    // cartas, SIN envío (IVA solo sobre subtotal, gross-up sobre la base menor). Es EXACTAMENTE
    // computeCartBreakdown, que aquí es `computeBreakdown(subtotal)` (la réplica local que ya
    // existe). El backend real lo computa con el StripeFeeConfig real; el front no lo puede
    // derivar del `breakdown` de envío (fee no invertible), por eso viaja precomputado. Carrito
    // 100 % podado ⇒ ceros SIN `shippingFeeCents`.
    vaultBreakdown: items.length === 0 ? zeroBreakdown() : computeBreakdown(subtotal),
    notices: { finalSale: true, invoiceByEmail: true, termsRequired: true },
    unavailableItems,
  });
}

/**
 * Crea el pedido de invitado (contrato POST /checkout/guest/session, §4-G.2): reserva los
 * items, crea la Order (userId=null, guestEmail, direct_ship) y UN solo PaymentIntent por
 * cartas + envío + IVA + fee. TOCA DINERO.
 *
 * Devuelve `checkoutToken` + `checkoutTokenExpiresAt` (v1.21.1, §4-G.7a): token de VIDA
 * CORTA (120 min) para el `return_url` del 3DS y la confirmación. NO es el enlace de
 * seguimiento —ese lo manda el correo del settle y dura 90 días—, así que el front no debe
 * invitar a guardarlo ni a marcarlo como favorito. Pasadas las 2 h, esa URL cae en la
 * pantalla neutra, desde donde se puede pedir un enlace nuevo (§4-G.4).
 *
 * `fulfillmentMode: "vault"` → **422 VAULT_REQUIRES_ACCOUNT** con `details.upsell=true`:
 * el front lo trata como UPSELL (crear cuenta sin salir del checkout), NUNCA como error.
 * Otros errores: 400 VALIDATION_ERROR, 422 ADDRESS_NOT_MX, 422 PRICE_PENDING,
 * 409 ITEM_UNAVAILABLE, 409 ALREADY_AUTHENTICATED, 429, 503 PAYMENT_PROVIDER_UNAVAILABLE.
 * NO aplica 403 EMAIL_NOT_VERIFIED (no hay cuenta que verificar).
 */
export async function createGuestCheckoutSession(
  input: GuestCheckoutSessionRequest,
): Promise<GuestCheckoutSessionResponse> {
  if (!config.useMocks) {
    return apiRequest<GuestCheckoutSessionResponse>('/checkout/guest/session', {
      method: 'POST',
      body: input,
      headers: { 'Idempotency-Key': idempotencyKey() },
    });
  }
  // MOCK: replica los rechazos del contrato que el front debe saber manejar.
  if (input.fulfillmentMode === 'vault') {
    throw new ApiClientError(422, {
      code: 'VAULT_REQUIRES_ACCOUNT',
      message: 'Vault requires an account',
      details: { upsell: true, reason: 'VAULT_REQUIRES_ACCOUNT' },
    });
  }
  if (input.shippingAddress?.country !== 'MX') {
    throw new ApiClientError(422, { code: 'ADDRESS_NOT_MX', message: 'Address must be in Mexico' });
  }
  const items = input.inventoryItemIds
    .map((id) => fx.mockListings.find((l) => l.inventoryItemId === id))
    .filter((l): l is ListingDTO => !!l);
  const pending = items.find((l) => !l.sellable);
  if (pending) throw new ApiClientError(422, { code: 'PRICE_PENDING', message: 'Item price pending' });
  const subtotal = items.reduce((s, l) => s + (l.salePriceCents ?? 0), 0);
  const orderId = `ord-guest-${Math.floor(Math.random() * 9000 + 1000)}`;
  return delay({
    orderId,
    orderNumber: 'TCG-000123',
    breakdown: computeGuestBreakdown(subtotal, MOCK_SHIPPING_FEE_CENTS),
    // MOCK: en real son 32 bytes base64url; el prefijo `mock-` lo reconoce el track mock.
    checkoutToken: `mock-${orderId}-checkout-token`,
    // MOCK: TTL corto del contrato (GUEST_CHECKOUT_TOKEN_TTL_MIN = 120 min).
    checkoutTokenExpiresAt: new Date(Date.now() + 120 * 60_000).toISOString(),
    stripe: { paymentIntentId: `pi_mock_${orderId}`, clientSecret: `pi_mock_${orderId}_secret_mock` },
  });
}

/**
 * Vista pública de seguimiento (contrato POST /orders/guest/track, §4-G.3). Es un POST a
 * propósito: el token va en el CUERPO para que no aparezca en access logs, `Referer`,
 * historial ni cachés.
 *
 * Errores NEUTROS para la UI: 404 INVALID_TOKEN, 410 TOKEN_EXPIRED, 410 TOKEN_REVOKED,
 * 429 RATE_LIMITED. La pantalla es LA MISMA para todos (criterio 52/53): el front no
 * ramifica el mensaje por código.
 */
export async function trackGuestOrder(token: string): Promise<GuestOrderTrackingDTO> {
  if (!config.useMocks) {
    return apiRequest<GuestOrderTrackingDTO>('/orders/guest/track', { method: 'POST', body: { token } });
  }
  // MOCK determinista (para demo y E2E sin backend):
  //   token con "expired"/"revoked" → 410; token que empieza con "mock" → pedido demo;
  //   cualquier otro → 404 INVALID_TOKEN. El BACKEND es la autoridad real.
  if (token.includes('expired')) {
    throw new ApiClientError(410, { code: 'TOKEN_EXPIRED', message: 'Link expired' });
  }
  if (token.includes('revoked')) {
    throw new ApiClientError(410, {
      code: 'TOKEN_REVOKED',
      message: 'Link revoked',
      details: { reason: 'CLAIMED' },
    });
  }
  if (!token.startsWith('mock')) {
    throw new ApiClientError(404, { code: 'INVALID_TOKEN', message: 'Invalid link' });
  }
  const listings = fx.mockListings.filter((l) => l.sellable).slice(0, 2);
  const subtotal = listings.reduce((s, l) => s + (l.salePriceCents ?? 0), 0);
  const shipped = token.includes('shipped');
  return delay<GuestOrderTrackingDTO>({
    orderNumber: 'TCG-000123',
    status: shipped ? 'enviado' : 'preparando',
    placedAt: '2026-08-16T18:20:00.000Z',
    paidAt: '2026-08-16T18:21:10.000Z',
    emailMasked: 'j***@***.com',
    items: listings.map((l) => ({
      name: l.card.name,
      setName: l.card.setName,
      number: l.card.number,
      finish: l.finish,
      productType: l.productType,
      rawCondition: l.rawCondition,
      sealedSubtype: l.sealedSubtype,
      gradingCompany: l.gradingCompany,
      gradeValue: l.gradeValue,
      imageSmallUrl: l.card.imageSmallUrl,
      unitPriceCents: l.salePriceCents ?? 0,
    })),
    breakdown: computeGuestBreakdown(subtotal, MOCK_SHIPPING_FEE_CENTS),
    shipping: {
      city: 'Guadalajara',
      state: 'Jalisco',
      postalCodeMasked: '***45',
      recipientNameMasked: 'Juan P.',
      carrier: shipped ? 'Estafeta' : undefined,
      trackingNumber: shipped ? '7712 4498 0021' : undefined,
      shippedAt: shipped ? '2026-08-17T15:00:00.000Z' : undefined,
    },
    payment: { brand: 'visa', last4: '4242' },
    claim: { available: true },
    support: { evidenceContact: 'soporte@tcghunt.mx', disputeWindowDays: 7 },
    tokenExpiresAt: '2026-11-14T18:20:00.000Z',
  });
}

/**
 * Reenvía al correo DEL PEDIDO (nunca a otro) un enlace nuevo, rotando los anteriores
 * (contrato POST /orders/guest/resend-link, §4-G.4).
 *
 * Responde SIEMPRE `202 { status: "ACCEPTED" }`, exista o no el pedido/correo/token: es
 * anti-oráculo (criterio 53). El front debe pintar el MISMO mensaje neutro siempre,
 * incluido el 429. `email` a secas nunca se acepta: va junto con `orderNumber`.
 */
export async function resendGuestTrackingLink(
  input: GuestResendLinkRequest,
): Promise<GuestResendLinkResponse> {
  if (!config.useMocks) {
    return apiRequest<GuestResendLinkResponse>('/orders/guest/resend-link', {
      method: 'POST',
      body: input,
    });
  }
  return delay<GuestResendLinkResponse>({ status: 'ACCEPTED' }, 400);
}

/**
 * Pedidos de invitado sin reclamar cuyo `guestEmail` == correo VERIFICADO de la sesión
 * (contrato GET /orders/claimable, §4-G.9). Nunca acepta un correo como parámetro (no es
 * oráculo). Err: 401, 403 EMAIL_NOT_VERIFIED.
 */
export async function getClaimableOrders(): Promise<ClaimableOrderDTO[]> {
  if (!config.useMocks) {
    const res = await apiRequest<{ data: ClaimableOrderDTO[] }>('/orders/claimable');
    return res.data;
  }
  return delay<ClaimableOrderDTO[]>([]);
}

/**
 * Vincula pedidos de invitado a la cuenta en sesión (contrato POST /orders/claim, §4-G.9).
 * Exige `emailVerified` (403 EMAIL_NOT_VERIFIED). Es PARCIAL-TOLERANTE: HTTP 200 con
 * `failed[]` por pedido (`ORDER_ALREADY_CLAIMED` | `CLAIM_EMAIL_MISMATCH` | `NOT_FOUND`).
 * El reclamo NO cambia destino, precio, políticas ni estado del pedido (criterio 54).
 */
export async function claimGuestOrders(orderIds: string[]): Promise<ClaimOrdersResponse> {
  if (!config.useMocks) {
    return apiRequest<ClaimOrdersResponse>('/orders/claim', { method: 'POST', body: { orderIds } });
  }
  return delay<ClaimOrdersResponse>({ claimed: orderIds, failed: [] }, 400);
}

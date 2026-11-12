/**
 * Cliente del portal de proveedores (§PROV F1) — `docs/API_CONTRACT_PROVEEDORES.md`.
 *
 * ⛔ El front nunca calcula dinero: los centavos (`unitCents`, `totalCents`, `payableCents`…) vienen del servidor.
 * ⛔ Las funciones `supplier*` (portal) jamás reciben ni pintan mercado, % ni margen: el contrato no los manda.
 * Mocks: sin backend (`config.useMocks`) las listas vuelven vacías y las mutaciones fallan con aviso (como card-show).
 */
import { apiRequest, setRefreshToken, setToken } from '../api-client';
import { config } from '../config';
import { setStoredUser } from '../session';
import type { AuthResponse, Finish } from '@/types/contract';

export type SupplyCondition = 'NM' | 'LP' | 'MP' | 'HP' | 'DMG';
export const SUPPLY_CONDITIONS: readonly SupplyCondition[] = ['NM', 'LP', 'MP', 'HP', 'DMG'];

/** Caducidades visibles (DECISIONES §PROV defaults A.3): solicitud 14 d, oferta 72 h, acuerdo 7 d. */
export const SUPPLY_TTL = { requestDays: 14, offerHours: 72, purchaseDays: 7 } as const;

export interface SupplyCard {
  cardId: string;
  name: string;
  nameEs: string | null;
  number: string;
  setId: string;
  setName: string;
  imageUrl: string | null;
  rarity: string | null;
  finish: Finish;
}

export interface Paged<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

export type SupplierStatus = 'invited' | 'active' | 'suspended';
export interface SupplierRow {
  id: string;
  businessName: string;
  email: string;
  phone: string | null;
  status: SupplierStatus;
  createdAt: string;
  activatedAt: string | null;
  openOffers: number;
}

export type RequestStatus = 'open' | 'filled' | 'closed' | 'expired';
export interface SupplyRequestAdmin {
  id: string;
  card: SupplyCard;
  minCondition: SupplyCondition;
  qtyWanted: number;
  qtyReserved: number;
  qtyReceived: number;
  qtyOpen: number;
  pctBps: number | null;
  unitCents: number;
  fixedPrice: boolean;
  marketCents: number | null;
  capCents: number | null;
  aboveCap: boolean;
  status: RequestStatus;
  source: 'manual' | 'suggested';
  expiresAt: string;
  createdAt: string;
  offersCount: number;
  bestOfferUnitCents: number | null;
}

export type OfferStatus = 'open' | 'countered' | 'accepted' | 'rejected' | 'withdrawn' | 'expired';
export interface SupplyOfferAdmin {
  id: string;
  requestId: string;
  supplier: { id: string; businessName: string };
  card: SupplyCard;
  qty: number;
  condition: SupplyCondition;
  unitCents: number;
  totalCents: number;
  pctOfMarketBps: number | null;
  marketCents: number | null;
  aboveCap: boolean;
  status: OfferStatus;
  expiresAt: string;
  createdAt: string;
  isBest: boolean;
}

export type PurchaseStatus = 'agreed' | 'collected' | 'verified' | 'paid' | 'cancelled';
export type UnitResult = 'pending' | 'ok' | 'adjusted' | 'returned';
export interface PurchaseUnit {
  n: number;
  condition: SupplyCondition;
  result: UnitResult;
  /** Solo en la versión admin. */
  adjustBps?: number | null;
  unitPayableCents: number | null;
  note: string | null;
}
export interface SupplyPurchase {
  id: string;
  offerId: string;
  supplier?: { id: string; businessName: string };
  card: SupplyCard;
  qty: number;
  agreedUnitCents: number;
  totalCents: number;
  status: PurchaseStatus;
  pickupDueAt: string;
  units: PurchaseUnit[];
  payableCents: number | null;
  method: 'cash' | 'transfer' | null;
  reference: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface MarketCheck {
  cardId: string;
  finish: Finish;
  marketCents: number | null;
  hasMarket: boolean;
  capCents: number | null;
  defaultPctBps: number;
  suggestedUnitCents: number | null;
}

/** Vista del proveedor: SOLO pesos por pieza. */
export interface SupplierRequest {
  id: string;
  card: SupplyCard;
  minCondition: SupplyCondition;
  qtyOpen: number;
  unitCents: number;
  expiresAt: string;
  myOfferStatus: OfferStatus | null;
}
export interface SupplierOffer {
  id: string;
  requestId: string;
  card: SupplyCard;
  qty: number;
  condition: SupplyCondition;
  unitCents: number;
  totalCents: number;
  status: OfferStatus;
  counterUnitCents: number | null;
  expiresAt: string;
  purchaseId: string | null;
  createdAt: string;
}

const EMPTY = <T>(): Paged<T> => ({ data: [], page: 1, pageSize: 20, total: 0 });
const idem = () => ({ 'Idempotency-Key': globalThis.crypto.randomUUID() });
const mockOff = () => {
  throw new Error('SUPPLIER_API_REQUIRES_BACKEND');
};

function paged<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<Paged<T>> {
  if (config.useMocks) return Promise.resolve(EMPTY<T>());
  return apiRequest<Paged<T>>(path, { query });
}

// ───────── Sesión de proveedor ─────────

/** `POST /auth/supplier/accept-invite`: fija contraseña y deja la sesión abierta. */
export async function acceptSupplierInvite(input: { token: string; password: string }): Promise<AuthResponse> {
  if (config.useMocks) return mockOff();
  const res = await apiRequest<AuthResponse>('/auth/supplier/accept-invite', { method: 'POST', body: input });
  setToken(res.accessToken);
  setRefreshToken(res.refreshToken);
  setStoredUser(res.user);
  return res;
}

// ───────── Portal del proveedor ─────────

export const listSupplierRequests = (q?: string, page = 1) => paged<SupplierRequest>('/supplier/requests', { q, page });
export const listSupplierOffers = (status?: OfferStatus, page = 1) => paged<SupplierOffer>('/supplier/offers', { status, page });
export const listSupplierPurchases = (page = 1) => paged<SupplyPurchase>('/supplier/purchases', { page });

/** `unitCents` se OMITE a propósito: en F1 un precio distinto es contraoferta (F3, 422 COUNTER_NOT_ENABLED). */
export function createSupplierOffer(requestId: string, body: { qty: number; condition: SupplyCondition }): Promise<SupplierOffer> {
  if (config.useMocks) return mockOff();
  return apiRequest<SupplierOffer>(`/supplier/requests/${encodeURIComponent(requestId)}/offers`, {
    method: 'POST',
    body,
    headers: idem(),
  });
}

export function withdrawSupplierOffer(offerId: string): Promise<unknown> {
  if (config.useMocks) return mockOff();
  return apiRequest(`/supplier/offers/${encodeURIComponent(offerId)}/respond`, { method: 'POST', body: { action: 'withdraw' } });
}

// ───────── Panel del dueño ─────────

export const listSuppliers = (f: { q?: string; status?: SupplierStatus; page?: number } = {}) => paged<SupplierRow>('/admin/suppliers', f);

export function inviteSupplier(body: { businessName: string; email: string; phone?: string }) {
  if (config.useMocks) return mockOff();
  return apiRequest<{ supplier: { id: string; businessName: string; email: string; status: 'invited' }; inviteExpiresAt: string }>(
    '/admin/suppliers/invite',
    { method: 'POST', body },
  );
}

export function patchSupplier(id: string, body: { status?: 'active' | 'suspended'; resetPassword?: true }) {
  if (config.useMocks) return mockOff();
  return apiRequest<SupplierRow>(`/admin/suppliers/${encodeURIComponent(id)}`, { method: 'PATCH', body });
}

export const listSupplyRequests = (f: { status?: RequestStatus; q?: string; page?: number } = {}) =>
  paged<SupplyRequestAdmin>('/admin/supply-requests', f);

export function getSupplyRequest(id: string): Promise<SupplyRequestAdmin & { offers: SupplyOfferAdmin[] }> {
  if (config.useMocks) return mockOff();
  return apiRequest(`/admin/supply-requests/${encodeURIComponent(id)}`);
}

export function supplyMarketCheck(cardId: string, finish: Finish): Promise<MarketCheck> {
  if (config.useMocks) return mockOff();
  return apiRequest<MarketCheck>('/admin/supply-requests/market-check', { query: { cardId, finish } });
}

export interface CreateSupplyRequestBody {
  cardId: string;
  finish: Finish;
  minCondition: SupplyCondition;
  qty: number;
  pctBps?: number;
  fixedUnitCents?: number;
}

export function createSupplyRequest(body: CreateSupplyRequestBody) {
  if (config.useMocks) return mockOff();
  return apiRequest<SupplyRequestAdmin>('/admin/supply-requests', { method: 'POST', body });
}

export function patchSupplyRequest(
  id: string,
  body: { status?: 'closed'; qtyWanted?: number; pctBps?: number; fixedUnitCents?: number },
) {
  if (config.useMocks) return mockOff();
  return apiRequest<SupplyRequestAdmin>(`/admin/supply-requests/${encodeURIComponent(id)}`, { method: 'PATCH', body });
}

export const listSupplyOffers = (f: { status?: OfferStatus; requestId?: string; page?: number } = {}) =>
  paged<SupplyOfferAdmin>('/admin/supply-offers', f);

export function respondSupplyOffer(id: string, action: 'accept' | 'reject') {
  if (config.useMocks) return mockOff();
  return apiRequest<{ offer: SupplyOfferAdmin; purchase?: SupplyPurchase }>(
    `/admin/supply-offers/${encodeURIComponent(id)}/respond`,
    { method: 'POST', body: { action } },
  );
}

export const listSupplyPurchases = (f: { status?: PurchaseStatus; page?: number } = {}) =>
  paged<SupplyPurchase>('/admin/supply-purchases', f);

export function receiveSupplyPurchase(id: string, units: { n: number; condition: SupplyCondition; note?: string }[]) {
  if (config.useMocks) return mockOff();
  return apiRequest<SupplyPurchase>(`/admin/supply-purchases/${encodeURIComponent(id)}/receive`, {
    method: 'POST',
    body: { units },
    headers: idem(),
  });
}

export function verifySupplyPurchase(
  id: string,
  units: { n: number; result: 'ok' | 'adjusted' | 'returned'; adjustBps?: number; note?: string }[],
) {
  if (config.useMocks) return mockOff();
  return apiRequest<SupplyPurchase>(`/admin/supply-purchases/${encodeURIComponent(id)}/verify`, {
    method: 'POST',
    body: { units },
    headers: idem(),
  });
}

export function paySupplyPurchase(id: string, body: { method: 'cash' | 'transfer'; reference?: string }) {
  if (config.useMocks) return mockOff();
  return apiRequest<SupplyPurchase>(`/admin/supply-purchases/${encodeURIComponent(id)}/pay`, {
    method: 'POST',
    body,
    headers: idem(),
  });
}

/** Búsqueda de carta para crear una solicitud: `GET /catalog/cards?q=` (contrato §2). */
export interface SupplyCardHit {
  cardId: string;
  name: string;
  number: string;
  setName: string;
  imageUrl: string | null;
  finishes: Finish[];
}
export async function searchSupplyCards(q: string): Promise<SupplyCardHit[]> {
  if (config.useMocks || q.trim().length < 2) return [];
  const res = await apiRequest<{ data: { card: { id: string; name: string; number: string; setName?: string; imageSmallUrl?: string | null; availableFinishes?: Finish[] }; finish: Finish }[] }>(
    '/catalog/cards',
    { query: { q: q.trim(), pageSize: 12 } },
  );
  const seen = new Set<string>();
  const out: SupplyCardHit[] = [];
  for (const g of res.data) {
    if (seen.has(g.card.id)) continue;
    seen.add(g.card.id);
    out.push({
      cardId: g.card.id,
      name: g.card.name,
      number: g.card.number,
      setName: g.card.setName ?? '',
      imageUrl: g.card.imageSmallUrl ?? null,
      finishes: g.card.availableFinishes?.length ? g.card.availableFinishes : [g.finish],
    });
  }
  return out;
}

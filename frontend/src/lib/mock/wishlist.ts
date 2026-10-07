/**
 * MOCK §WSH (v1.87⟨wishlist⟩ + errata v1.87.1) — servidor FALSO de la lista de deseos para el modo demo y los E2E de
 * fixtures. Forma = `API_CONTRACT §WSH.4/.6/.8` al pie de la letra; las CIFRAS son las del propio contrato, escritas
 * como tabla (⛔ el simulador no reimplementa `maxDisplay`: si lo hiciera, el front tendría una segunda fuente de la
 * aritmética, aunque fuera de mentira).
 *
 * - Mercado `M = 100000` (MX$1,000.00) para toda variante con precio ⇒ los niveles de WSH-T31:
 *   `with_iva` 105000 / 110000 / 116000 · `without_iva` 121800 / 127600 / 134560.
 * - Sin mercado (`no_market`, criterio 807): `c-zapdos` (todas, como su `mockReferenceByCardId = null`) y
 *   `c-pikachu` en `reverse_holo` (una carta con un acabado con precio y otro sin él, para WSH-F7).
 * - Estado en `localStorage` (sobrevive a navegar entre páginas, que es lo que recorren los E2E):
 *     `tcg.mock.wishlist`        deseos guardados (JSON)
 *     `tcg.mock.wishlistPaused`  '1' ⇒ avisos pausados
 *     `tcg.mock.wishlistOff`     '1' ⇒ dial `wishlist_enabled = off` (rutas con sesión ⇒ 404 FEATURE_DISABLED)
 *     `tcg.mock.wishlistLimit`   entero ⇒ tope por cuenta (por defecto el dial, 20)
 *     `tcg.mock.wishlistUnverified` '1' ⇒ `emailVerified: false`
 * - Enlaces del correo (`POST /wishlist/mail-actions`): el token válido del simulador es `mock-token`.
 */
import { ApiClientError } from '../api-client';
import * as fx from './fixtures';
import type {
  Finish,
  WishlistCreateRequest,
  WishlistDemandParams,
  WishlistDemandResponse,
  WishlistDemandRowDTO,
  WishlistItemDTO,
  WishlistIvaMode,
  WishlistMailActionRequest,
  WishlistMailActionResponse,
  WishlistMaxPct,
  WishlistPreviewResponse,
  WishlistResponse,
} from '@/types/contract';

const STORE_KEY = 'tcg.mock.wishlist';
const PAUSED_KEY = 'tcg.mock.wishlistPaused';
const OFF_KEY = 'tcg.mock.wishlistOff';
const LIMIT_KEY = 'tcg.mock.wishlistLimit';
const UNVERIFIED_KEY = 'tcg.mock.wishlistUnverified';
export const MOCK_WISHLIST_TOKEN = 'mock-token';

/** Las cifras de WSH-T31 (M = 100000, r = 16, t = 100), copiadas del contrato. */
const TIERS: Record<WishlistIvaMode, Record<WishlistMaxPct, number>> = {
  with_iva: { 5: 105000, 10: 110000, 16: 116000 },
  without_iva: { 5: 121800, 10: 127600, 16: 134560 },
};

interface StoredItem {
  id: string;
  cardId: string;
  finish: Finish;
  maxPct: WishlistMaxPct;
  createdAt: string;
  lastNotifiedAt: string | null;
}

let memory: StoredItem[] = [];
let seq = 0;

function ls(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}
function read(): StoredItem[] {
  const s = ls();
  if (!s) return memory;
  try {
    const parsed: unknown = JSON.parse(s.getItem(STORE_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as StoredItem[]) : [];
  } catch {
    return [];
  }
}
function write(items: StoredItem[]): void {
  const s = ls();
  if (!s) memory = items;
  else s.setItem(STORE_KEY, JSON.stringify(items));
}

export function mockWishlistEnabled(): boolean {
  if (ls()?.getItem(OFF_KEY) === '1') return false;
  return fx.mockSettings.wishlistEnabled !== 'off';
}
function ivaMode(): WishlistIvaMode {
  return fx.mockSettings.wishlistMaxIvaMode ?? 'with_iva';
}
function ivaRatePct(): number {
  return fx.mockSettings.ivaPct ?? 16;
}
function limit(): number {
  const raw = Number(ls()?.getItem(LIMIT_KEY));
  if (Number.isInteger(raw) && raw > 0) return raw;
  return fx.mockSettings.wishlistMaxPerAccount ?? 20;
}
function paused(): boolean {
  return ls()?.getItem(PAUSED_KEY) === '1';
}

function guard(): void {
  if (!mockWishlistEnabled()) {
    throw new ApiClientError(404, { code: 'FEATURE_DISABLED', message: 'Wishlist disabled' });
  }
}

function hasMarket(cardId: string, finish: Finish): boolean {
  if (cardId === 'c-zapdos') return false;
  if (cardId === 'c-pikachu' && finish === 'reverse_holo') return false;
  return true;
}

function cardOf(cardId: string) {
  const c = fx.mockCards.find((x) => x.id === cardId);
  if (!c) throw new ApiClientError(404, { code: 'NOT_FOUND', message: 'Card not found' });
  return c;
}

/** Piezas RAW vendibles de esa variante (el simulador lee el mismo fixture que la ficha). */
function sellableOf(cardId: string, finish: Finish): number[] {
  try {
    return fx
      .mockGroupedDetail(cardId)
      .units.filter((u) => u.productType === 'raw' && u.finish === finish && u.sellable && u.displayPriceCents != null)
      .map((u) => u.displayPriceCents as number);
  } catch {
    return [];
  }
}

function toDTO(it: StoredItem): WishlistItemDTO {
  const c = cardOf(it.cardId);
  const priced = hasMarket(it.cardId, it.finish);
  const max = priced ? TIERS[ivaMode()][it.maxPct] : null;
  const prices = sellableOf(it.cardId, it.finish);
  const from = prices.length ? Math.min(...prices) : null;
  return {
    id: it.id,
    card: { id: c.id, name: c.name, setName: c.setName, number: c.number, imageSmallUrl: c.imageSmallUrl ?? null },
    finish: it.finish,
    maxPct: it.maxPct,
    maxToday: max == null ? { status: 'no_market' } : { status: 'priced', maxDisplayCents: max, approximate: true },
    // El SERVIDOR (aquí, su simulador) decide `fits`: `P <= maxDisplay` (WSH.3). El front solo lo pinta.
    availableNow: from == null ? null : { count: prices.length, fromDisplayCents: from, fits: max == null ? null : from <= max },
    lastNotifiedAt: it.lastNotifiedAt,
    createdAt: it.createdAt,
  };
}

export function mockGetWishlist(): WishlistResponse {
  guard();
  const items = [...read()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(toDTO);
  return {
    items,
    count: items.length,
    limit: limit(),
    alertsPaused: paused(),
    emailVerified: ls()?.getItem(UNVERIFIED_KEY) !== '1',
    ivaMode: ivaMode(),
    ivaRatePct: ivaRatePct(),
  };
}

export function mockGetWishlistPreview(cardId: string): WishlistPreviewResponse {
  guard();
  if (!cardId) throw new ApiClientError(400, { code: 'VALIDATION_ERROR', message: 'cardId', details: { field: 'cardId' } });
  const c = cardOf(cardId);
  const mode = ivaMode();
  return {
    cardId,
    ivaMode: mode,
    ivaRatePct: ivaRatePct(),
    finishes: c.availableFinishes.map((finish) => ({
      finish,
      maxToday: hasMarket(cardId, finish)
        ? {
            status: 'priced' as const,
            approximate: true as const,
            tiers: ([5, 10, 16] as const).map((maxPct) => ({ maxPct, maxDisplayCents: TIERS[mode][maxPct] })),
          }
        : { status: 'no_market' as const },
    })),
  };
}

export function mockAddWishlistItem(body: WishlistCreateRequest): WishlistItemDTO {
  guard();
  const c = cardOf(body.cardId);
  if (![5, 10, 16].includes(body.maxPct)) {
    throw new ApiClientError(400, { code: 'VALIDATION_ERROR', message: 'maxPct', details: { field: 'maxPct' } });
  }
  if (!c.availableFinishes.includes(body.finish)) {
    throw new ApiClientError(422, { code: 'FINISH_NOT_AVAILABLE', message: 'finish' });
  }
  const items = read();
  const dup = items.find((i) => i.cardId === body.cardId && i.finish === body.finish);
  if (dup) {
    throw new ApiClientError(409, {
      code: 'WISHLIST_DUPLICATE',
      message: 'duplicate',
      details: { wishlistItemId: dup.id, maxPct: dup.maxPct },
    });
  }
  if (items.length >= limit()) {
    throw new ApiClientError(422, {
      code: 'WISHLIST_LIMIT_REACHED',
      message: 'limit',
      details: { limit: limit(), count: items.length },
    });
  }
  const it: StoredItem = {
    id: `wsh-${Date.now().toString(36)}-${++seq}`,
    cardId: body.cardId,
    finish: body.finish,
    maxPct: body.maxPct,
    createdAt: new Date().toISOString(),
    lastNotifiedAt: null,
  };
  write([...items, it]);
  return toDTO(it);
}

export function mockUpdateWishlistItem(id: string, maxPct: WishlistMaxPct): WishlistItemDTO {
  guard();
  const items = read();
  const it = items.find((i) => i.id === id);
  if (!it) throw new ApiClientError(404, { code: 'NOT_FOUND', message: 'not found' });
  it.maxPct = maxPct;
  write(items);
  return toDTO(it);
}

export function mockRemoveWishlistItem(id: string): void {
  guard();
  const items = read();
  if (!items.some((i) => i.id === id)) throw new ApiClientError(404, { code: 'NOT_FOUND', message: 'not found' });
  write(items.filter((i) => i.id !== id));
}

export function mockSetWishlistAlerts(next: boolean): { alertsPaused: boolean } {
  guard();
  ls()?.setItem(PAUSED_KEY, next ? '1' : '0');
  return { alertsPaused: next };
}

/** ⭐ v1.87.1 (Q-WSH-UX-5): NO depende del dial. */
export function mockWishlistMailAction(body: WishlistMailActionRequest): WishlistMailActionResponse {
  if ((body.action !== 'remove' && body.action !== 'pause') || !body.id || !body.token) {
    throw new ApiClientError(400, { code: 'VALIDATION_ERROR', message: 'invalid' });
  }
  if (body.token !== MOCK_WISHLIST_TOKEN) {
    throw new ApiClientError(404, { code: 'WISHLIST_LINK_INVALID', message: 'invalid link' });
  }
  if (body.action === 'pause') {
    if (paused()) return { result: 'already_done' };
    ls()?.setItem(PAUSED_KEY, '1');
    return { result: 'paused' };
  }
  const items = read();
  if (!items.some((i) => i.id === body.id)) return { result: 'already_done' };
  write(items.filter((i) => i.id !== body.id));
  return { result: 'removed' };
}

// ---- Lista de compra (M9 · `GET /admin/reports/wishlist-demand`) ----
// Filas con las cifras del contrato (WSH.3: 78711 / 82459 / 86957 con M = 100000, m = 15, `cost`; WSH-T35:
// `{-9483, -9.5}` con una cuenta al 5 %). Una fila sin mercado, al final como manda el orden por defecto (820).
const DEMAND_ROWS: WishlistDemandRowDTO[] = [
  {
    cardId: 'c-cel25-7',
    cardName: 'Celebrations #7',
    setName: 'Celebrations',
    number: '7',
    finish: 'holofoil',
    imageSmallUrl: 'https://images.pokemontcg.io/cel25/7.png',
    wantedCount: 3,
    tiers: [
      { maxPct: 16, accounts: 1, maxDisplayCents: 116000, ceilingCents: 86957 },
      { maxPct: 10, accounts: 2, maxDisplayCents: 110000, ceilingCents: 82459 },
    ],
    mainCeilingCents: 86957,
    marketCents: 100000,
    normalPrice: { listCents: 115000, displayCents: 133400 },
    buyersAtNormalPrice: 0,
    marginAtMarket: { cents: 0, pct: 0 },
    buylistTodayCents: 70000,
  },
  {
    cardId: 'c-cel25-12',
    cardName: 'Celebrations #12',
    setName: 'Celebrations',
    number: '12',
    finish: 'holofoil',
    imageSmallUrl: 'https://images.pokemontcg.io/cel25/12.png',
    wantedCount: 1,
    tiers: [{ maxPct: 5, accounts: 1, maxDisplayCents: 105000, ceilingCents: 78711 }],
    mainCeilingCents: 78711,
    marketCents: 100000,
    normalPrice: null,
    buyersAtNormalPrice: null,
    marginAtMarket: { cents: -9483, pct: -9.5 },
    buylistTodayCents: null,
  },
  {
    cardId: 'c-cel25c-3',
    cardName: 'Classic Collection #3',
    setName: 'Classic Collection',
    number: '3',
    finish: 'holofoil',
    imageSmallUrl: null,
    wantedCount: 2,
    tiers: [{ maxPct: 10, accounts: 2, maxDisplayCents: null, ceilingCents: null }],
    mainCeilingCents: null,
    marketCents: null,
    normalPrice: null,
    buyersAtNormalPrice: null,
    marginAtMarket: null,
    buylistTodayCents: null,
  },
];

const SORT_KEY: Record<NonNullable<WishlistDemandParams['sort']>, (r: WishlistDemandRowDTO) => number | null> = {
  wanted: (r) => r.wantedCount,
  ceiling: (r) => r.mainCeilingCents,
  margin: (r) => r.marginAtMarket?.cents ?? null,
  market: (r) => r.marketCents,
  normal: (r) => r.normalPrice?.displayCents ?? null,
  buyers: (r) => r.buyersAtNormalPrice,
  buylist: (r) => r.buylistTodayCents,
};

function demandRows(params: WishlistDemandParams): WishlistDemandRowDTO[] {
  if (!params.sort) return DEMAND_ROWS;
  const key = SORT_KEY[params.sort];
  const sign = params.dir === 'asc' ? 1 : -1;
  // `null` siempre al final, en cualquier dirección (como el orden por defecto, criterio 820).
  return [...DEMAND_ROWS].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (x - y) * sign;
  });
}

/**
 * Cuerpo de `GET /admin/reports/wishlist-demand` SIN el dial de traslación: ese dial solo se nombra en las rutas que
 * el candado del criterio 209 permite (`IvaTransferSection.test.tsx`); `api.ts` lo añade al ensamblar la respuesta.
 */
export interface MockWishlistDemandBody {
  generatedAt: string;
  dials: { ivaMode: WishlistIvaMode; ivaRatePct: number; targetMarginPct: number; marginBasis: 'cost' | 'sale' };
  rows: WishlistDemandResponse['rows'];
  sealed: WishlistDemandResponse['sealed'];
}

export function mockWishlistDemand(params: WishlistDemandParams = {}): MockWishlistDemandBody {
  return {
    generatedAt: new Date().toISOString(),
    dials: {
      ivaMode: ivaMode(),
      ivaRatePct: ivaRatePct(),
      targetMarginPct: fx.mockSettings.wishlistTargetMarginPct ?? 15,
      marginBasis: fx.mockSettings.wishlistMarginBasis ?? 'cost',
    },
    rows: demandRows(params),
    sealed: [
      { productName: 'Surging Sparks Booster Box', sealedSubtype: 'box', sealedCondition: 'mint', waitingCount: 4 },
    ],
  };
}

/** CSV del simulador: mismas filas y orden que el JSON (criterio 822); pesos con 2 decimales. */
export function mockWishlistDemandCsv(params: WishlistDemandParams = {}): string {
  const money = (c: number | null) => (c == null ? '' : (c / 100).toFixed(2));
  const tier = (r: WishlistDemandRowDTO, p: WishlistMaxPct) => r.tiers.find((x) => x.maxPct === p);
  const head = [
    'carta', 'set', 'numero', 'acabado', 'la_buscan',
    'cuentas_16', 'max_16', 'techo_16', 'cuentas_10', 'max_10', 'techo_10', 'cuentas_5', 'max_5', 'techo_5',
    'paga_hasta', 'mercado', 'precio_normal_sin_iva', 'precio_normal_con_iva', 'pagan_precio_normal',
    'margen_a_mercado', 'margen_a_mercado_pct', 'buylist_hoy',
  ];
  const lines = demandRows(params).map((r) =>
    [
      r.cardName, r.setName, r.number, r.finish, r.wantedCount,
      ...([16, 10, 5] as const).flatMap((p) => {
        const t = tier(r, p);
        return [t?.accounts ?? 0, money(t?.maxDisplayCents ?? null), money(t?.ceilingCents ?? null)];
      }),
      money(r.mainCeilingCents), money(r.marketCents), money(r.normalPrice?.listCents ?? null),
      money(r.normalPrice?.displayCents ?? null), r.buyersAtNormalPrice ?? '',
      money(r.marginAtMarket?.cents ?? null), r.marginAtMarket ? r.marginAtMarket.pct.toFixed(1) : '',
      money(r.buylistTodayCents),
    ].join(','),
  );
  return [head.join(','), ...lines].join('\n');
}

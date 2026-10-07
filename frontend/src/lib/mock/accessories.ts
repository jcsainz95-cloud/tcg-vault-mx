/**
 * 💰 §AC — SIMULADOR del servidor de accesorios para el modo mock (demo / Playwright sin backend).
 *
 * Construido contra `API_CONTRACT §AC` (v1.86 + errata v1.86.1), NO contra un backend corriendo (el backend de
 * §AC se construye en paralelo). Como todo simulador (`fixtures.ts`, `api.ts`), produce las cifras que el
 * servidor produciría; ⛔ ninguna pantalla importa de aquí. La suite unitaria NO lo usa: espía `@/lib/api`.
 *
 * Simplificaciones marcadas `// MOCK`: no hay cajas con tarifa (⇒ `shippingBox: null`, envío de hoy, I-AC-5),
 * el `pullToken` es legible (`mock-pull:<slug>:<ids>`; el real va firmado con `domainHmac`), y las existencias
 * viven en memoria de la pestaña.
 */
import type {
  AccessoryCardDTO,
  AccessoryCategory,
  AccessoryDetailDTO,
  AccessoryLineInput,
  AccessoryListResponse,
  AccessoryStockMovementDTO,
  AccessoryStockMovementsResponse,
  AccessoryStockRequest,
  AdminAccessoryCreateRequest,
  AdminAccessoryDTO,
  AdminAccessoryListParams,
  AdminAccessoryListResponse,
  AdminAccessoryWriteFields,
  DeckEnergyBundleDTO,
  DeckMetaDetailResponse,
  DeckPullInput,
  EnergyBundleDTO,
  EnergyType,
  MetaDeckGroupsDTO,
  MetaDeckLineDTO,
  QuoteAccessoryLineDTO,
  UnavailableAccessoryDTO,
  UnavailableBundleDTO,
} from '@/types/contract';
import { ENERGY_TYPES } from '@/types/contract';

/** Error con la forma de `ApiClientError` sin importar `api-client` (evita el ciclo con `api.ts`). */
export class MockAccessoryError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details?: Record<string, unknown>,
  ) {
    super(code);
  }
}

const NOW = '2026-10-07T12:00:00.000Z';
// MOCK: imagen pública de prueba (la real la sirve la API: `/accessories/:id/photo/:version/:variant`).
const IMG = 'https://images.pokemontcg.io/sv1/1_hires.png';
const photoOf = (id: string) => ({ url: `${IMG}?acc=${id}&v=full`, thumbUrl: `${IMG}?acc=${id}&v=thumb` });

const ES_TYPE: Record<EnergyType, string> = {
  grass: 'Planta',
  fire: 'Fuego',
  water: 'Agua',
  lightning: 'Rayo',
  psychic: 'Psíquica',
  fighting: 'Lucha',
  darkness: 'Oscura',
  metal: 'Metálica',
};

function row(over: Partial<AdminAccessoryDTO> & Pick<AdminAccessoryDTO, 'id' | 'name' | 'category'>): AdminAccessoryDTO {
  return {
    description: null,
    energyType: null,
    lengthMm: null,
    widthMm: null,
    heightMm: null,
    weightG: null,
    priceCents: null,
    unitCostCents: null,
    stockQty: 0,
    reservedQty: 0,
    availableQty: 0,
    active: false,
    suggested: false,
    photo: null,
    hasSales: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function seed(): AdminAccessoryDTO[] {
  // Semilla de M-73: 8 energías inactivas, MX$5, sin foto. Para la demo, Fuego y Agua ya publicadas.
  const energies = ENERGY_TYPES.map((t) =>
    row({
      id: `acc-energy-${t}`,
      name: `Energía ${ES_TYPE[t]}`,
      category: 'energy',
      energyType: t,
      priceCents: 500,
      ...(t === 'fire' || t === 'water' || t === 'psychic'
        ? { active: true, photo: photoOf(`acc-energy-${t}`), stockQty: 40, availableQty: 40, unitCostCents: 150 }
        : {}),
    }),
  );
  return [
    row({
      id: 'acc-sleeves',
      name: 'Penny sleeves ×100',
      category: 'sleeves',
      description: 'Cien fundas transparentes.\nPara cartas de tamaño estándar.',
      lengthMm: 95,
      widthMm: 70,
      heightMm: 15,
      weightG: 60,
      priceCents: 8900,
      unitCostCents: 4000,
      stockQty: 20,
      availableQty: 20,
      active: true,
      suggested: true,
      photo: photoOf('acc-sleeves'),
    }),
    row({
      id: 'acc-toploader',
      name: 'Toploaders ×25',
      category: 'toploaders',
      lengthMm: 105,
      widthMm: 80,
      heightMm: 30,
      weightG: 180,
      priceCents: 12000,
      unitCostCents: 6000,
      stockQty: 8,
      availableQty: 8,
      active: true,
      photo: photoOf('acc-toploader'),
    }),
    row({
      id: 'acc-deckbox',
      name: 'Deck box negra',
      category: 'deck_boxes',
      lengthMm: 100,
      widthMm: 75,
      heightMm: 80,
      weightG: 90,
      priceCents: 15000,
      stockQty: 5,
      availableQty: 5,
      active: true,
      photo: photoOf('acc-deckbox'),
    }),
    row({
      id: 'acc-playmat',
      name: 'Playmat Dragapult',
      category: 'playmats',
      lengthMm: 610,
      widthMm: 100,
      heightMm: 100,
      weightG: 500,
      priceCents: 45000,
      stockQty: 0,
      availableQty: 0,
      active: true,
      photo: photoOf('acc-playmat'),
    }),
    ...energies,
  ];
}

let store: AdminAccessoryDTO[] = seed();
let movements: Record<string, AccessoryStockMovementDTO[]> = {};

/** Para pruebas del simulador. */
export function resetMockAccessories() {
  store = seed();
  movements = {};
}

const toCard = (a: AdminAccessoryDTO): AccessoryCardDTO => ({
  id: a.id,
  name: a.name,
  category: a.category,
  energyType: a.energyType,
  priceCents: a.priceCents ?? 0,
  soldOut: a.availableQty <= 0,
  photo: a.photo ?? photoOf(a.id),
});
const isPublic = (a: AdminAccessoryDTO) => a.active && a.priceCents !== null && a.photo !== null;
const CAT_ORDER: AccessoryCategory[] = ['sleeves', 'toploaders', 'binders', 'deck_boxes', 'playmats', 'energy', 'other'];

/** `GET /accessories` — disponibles primero, luego categoría (orden del enum), nombre e id. */
export function mockListAccessories(p: { category?: AccessoryCategory; q?: string; page?: number; pageSize?: number }): AccessoryListResponse {
  const pageSize = p.pageSize ?? 24;
  const page = p.page ?? 1;
  const q = p.q?.trim().toLowerCase();
  const rows = store
    .filter(isPublic)
    .filter((a) => !p.category || a.category === p.category)
    .filter((a) => !q || a.name.toLowerCase().includes(q))
    .sort(
      (a, b) =>
        Number(a.availableQty <= 0) - Number(b.availableQty <= 0) ||
        CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category) ||
        a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
        a.id.localeCompare(b.id),
    );
  return { items: rows.slice((page - 1) * pageSize, page * pageSize).map(toCard), page, pageSize, total: rows.length };
}

export function mockGetAccessory(id: string): AccessoryDetailDTO {
  const a = store.find((x) => x.id === id);
  if (!a || !isPublic(a)) throw new MockAccessoryError(404, 'ACCESSORY_NOT_FOUND');
  return { ...toCard(a), description: a.description, maxQty: Math.min(a.availableQty, 99) };
}

/** `GET /accessories/suggestions` — Sugeridos, luego el resto; ⛔ nunca energías ni agotados. MOCK: sin «más vendidos». */
export function mockSuggestions(exclude: string[], count = 3): AccessoryCardDTO[] {
  const cands = store.filter((a) => isPublic(a) && a.availableQty > 0 && a.category !== 'energy' && !exclude.includes(a.id));
  const byName = (a: AdminAccessoryDTO, b: AdminAccessoryDTO) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  return [...cands.filter((a) => a.suggested).sort(byName), ...cands.filter((a) => !a.suggested).sort(byName)].slice(0, count).map(toCard);
}

// ---------- decks-meta: energías ligadas y paquete (§AC.8) ----------
const MOCK_BUNDLE_PRICE_CENTS = 2000;

function energyTypeOf(rawName: string): EnergyType | null {
  const n = rawName.toLowerCase();
  const hits = ENERGY_TYPES.filter((t) => new RegExp(`\\b${t === 'darkness' ? '(darkness|dark)' : t}\\b`).test(n));
  return hits.length === 1 ? hits[0] : null;
}
const activeOfType = (t: EnergyType) => store.find((a) => a.category === 'energy' && a.energyType === t && isPublic(a));

function decorateLine(line: MetaDeckLineDTO): MetaDeckLineDTO {
  if (line.matchStatus !== 'unmatched_basic_energy') return line;
  const t = energyTypeOf(line.rawName);
  const prod = t ? activeOfType(t) : undefined;
  return {
    ...line,
    basicEnergy:
      t && prod
        ? { energyType: t, accessoryId: prod.id, unitPriceCents: prod.priceCents!, soldOut: prod.availableQty <= 0, photo: prod.photo! }
        : null,
  };
}

export function mockDecorateGroups(groups: MetaDeckGroupsDTO): MetaDeckGroupsDTO {
  return { pokemon: groups.pokemon.map(decorateLine), trainer: groups.trainer.map(decorateLine), energy: groups.energy.map(decorateLine) };
}

export function mockPullToken(slug: string, ids: string[]): string {
  // MOCK: legible a propósito. El real es `base64url(JSON) + "." + domainHmac(...)` y se valida en el servidor.
  return `mock-pull:${slug}:${[...ids].sort().join(',')}`;
}
function parsePull(token: string): { slug: string; ids: string[] } | null {
  const m = /^mock-pull:([^:]+):(.*)$/.exec(token);
  return m ? { slug: m[1], ids: m[2] ? m[2].split(',') : [] } : null;
}

function bundleFor(groups: MetaDeckGroupsDTO): Omit<DeckEnergyBundleDTO, 'pullToken'> {
  const need = new Map<EnergyType, number>();
  for (const l of groups.energy) {
    const t = l.matchStatus === 'unmatched_basic_energy' ? energyTypeOf(l.rawName) : null;
    if (t) need.set(t, (need.get(t) ?? 0) + l.quantity);
  }
  const energies = [...need.entries()].map(([energyType, quantity]) => ({ energyType, quantity, accessoryId: activeOfType(energyType)?.id ?? null }));
  const looseTotalCents = energies.reduce((s, e) => s + e.quantity * (activeOfType(e.energyType)?.priceCents ?? 0), 0);
  let reason: DeckEnergyBundleDTO['reason'] = null;
  if (energies.length === 0) reason = 'no_basic_energy';
  else if (energies.some((e) => (activeOfType(e.energyType)?.availableQty ?? 0) < e.quantity)) reason = 'insufficient_stock';
  else if (looseTotalCents <= MOCK_BUNDLE_PRICE_CENTS) reason = 'not_offered';
  return { offered: reason === null, reason, priceCents: MOCK_BUNDLE_PRICE_CENTS, looseTotalCents, energies };
}

export function mockDecorateDeck(detail: DeckMetaDetailResponse): DeckMetaDetailResponse {
  const groups = mockDecorateGroups(detail.groups);
  const ids = [...groups.pokemon, ...groups.trainer, ...groups.energy].flatMap((l) => l.unitInventoryItemIds);
  return { ...detail, groups, energyBundle: { ...bundleFor(groups), pullToken: mockPullToken(detail.slug, ids) } };
}

// ---------- cotización (§AC.4) ----------
export interface MockAccessoryQuote {
  accessoryLines: QuoteAccessoryLineDTO[];
  energyBundles: EnergyBundleDTO[];
  energyBundleOffers: EnergyBundleDTO[];
  unavailableAccessories: UnavailableAccessoryDTO[];
  unavailableBundles: UnavailableBundleDTO[];
  /** Σ de lo cotizable (I-AC-1, lo que se suma al subtotal de cartas). */
  extraSubtotalCents: number;
}

/**
 * MOCK de la parte de accesorios de `quote`: poda con aviso (`insufficient` cotiza con el disponible) y
 * valida paquetes contra las piezas de la petición (P-EN-4). `decks` resuelve `slug → grupos` del deck.
 */
export function mockQuoteAccessories(
  inventoryItemIds: string[],
  lines: AccessoryLineInput[] = [],
  pulls: DeckPullInput[] = [],
  decks: (slug: string) => DeckMetaDetailResponse | null,
): MockAccessoryQuote {
  const out: MockAccessoryQuote = {
    accessoryLines: [],
    energyBundles: [],
    energyBundleOffers: [],
    unavailableAccessories: [],
    unavailableBundles: [],
    extraSubtotalCents: 0,
  };
  for (const l of lines) {
    const a = store.find((x) => x.id === l.accessoryId);
    if (!a) {
      out.unavailableAccessories.push({ accessoryId: l.accessoryId, name: null, reason: 'not_found' });
      continue;
    }
    if (!isPublic(a)) {
      out.unavailableAccessories.push({ accessoryId: a.id, name: a.name, reason: 'inactive' });
      continue;
    }
    if (a.availableQty <= 0) {
      out.unavailableAccessories.push({ accessoryId: a.id, name: a.name, reason: 'sold_out' });
      continue;
    }
    const qty = Math.min(l.quantity, a.availableQty);
    if (qty < l.quantity) out.unavailableAccessories.push({ accessoryId: a.id, name: a.name, reason: 'insufficient', availableQty: qty });
    const lineTotalCents = qty * a.priceCents!;
    out.extraSubtotalCents += lineTotalCents;
    out.accessoryLines.push({
      accessoryId: a.id,
      name: a.name,
      category: a.category,
      energyType: a.energyType,
      unitPriceCents: a.priceCents!,
      quantity: qty,
      lineTotalCents,
      photo: a.photo!,
    });
  }
  const seen = new Set<string>();
  // v1.86.3 (§AC.19.4): `index` = posición en `deckPulls` de la petición; `withEnergyBundle` = lo que pedía.
  for (const [index, p] of pulls.entries()) {
    const at = { index, withEnergyBundle: p.withEnergyBundle };
    const parsed = parsePull(p.pullToken);
    if (!parsed) {
      out.unavailableBundles.push({ ...at, deckSlug: null, reason: 'invalid_token' });
      continue;
    }
    const detail = decks(parsed.slug);
    if (!detail) {
      out.unavailableBundles.push({ ...at, deckSlug: parsed.slug, reason: 'deck_unpublished' });
      continue;
    }
    if (!parsed.ids.every((id) => inventoryItemIds.includes(id))) {
      out.unavailableBundles.push({ ...at, deckSlug: parsed.slug, reason: 'deck_incomplete' });
      continue;
    }
    if (p.withEnergyBundle && seen.has(parsed.slug)) {
      out.unavailableBundles.push({ ...at, deckSlug: parsed.slug, reason: 'duplicate' });
      continue;
    }
    const b = bundleFor(mockDecorateGroups(detail.groups));
    if (!b.offered) {
      out.unavailableBundles.push({ ...at, deckSlug: parsed.slug, reason: b.reason === 'insufficient_stock' ? 'insufficient_stock' : 'not_offered' });
      continue;
    }
    const dto: EnergyBundleDTO = {
      deckSlug: parsed.slug,
      deckName: detail.name,
      priceCents: b.priceCents,
      looseTotalCents: b.looseTotalCents,
      energies: b.energies.map((e) => ({ energyType: e.energyType, quantity: e.quantity, accessoryId: e.accessoryId!, photo: activeOfType(e.energyType)!.photo! })),
    };
    if (p.withEnergyBundle) {
      seen.add(parsed.slug);
      out.energyBundles.push(dto);
      out.extraSubtotalCents += dto.priceCents;
    } else {
      out.energyBundleOffers.push(dto);
    }
  }
  return out;
}

/** MOCK de las validaciones estrictas de `session` (§AC.4): nunca poda, rechaza. */
export function mockAssertSessionAccessories(lines: AccessoryLineInput[] = []): void {
  for (const l of lines) {
    const a = store.find((x) => x.id === l.accessoryId);
    if (!a || !isPublic(a)) throw new MockAccessoryError(409, 'ACCESSORY_UNAVAILABLE', { accessoryId: l.accessoryId, reason: a ? 'inactive' : 'not_found' });
    if (a.availableQty < l.quantity) throw new MockAccessoryError(409, 'ACCESSORY_INSUFFICIENT_STOCK', { accessoryId: a.id, availableQty: a.availableQty });
  }
}

// ---------- panel (§AC.11) ----------
export function mockAdminList(p: AdminAccessoryListParams): AdminAccessoryListResponse {
  const q = p.q?.trim().toLowerCase();
  const rows = store
    .filter((a) => !p.category || a.category === p.category)
    .filter((a) => !q || a.name.toLowerCase().includes(q))
    .filter((a) => p.active === undefined || a.active === p.active)
    .filter((a) => !p.soldOut || a.availableQty <= 0);
  const page = p.page ?? 1;
  return { items: rows.slice((page - 1) * 24, page * 24).map((a) => ({ ...a })), page, pageSize: 24, total: rows.length };
}
export function mockAdminGet(id: string): AdminAccessoryDTO {
  const a = store.find((x) => x.id === id);
  if (!a) throw new MockAccessoryError(404, 'NOT_FOUND');
  return { ...a };
}
const STAR_FIELDS = ['priceCents', 'unitCostCents', 'suggested', 'active'] as const;
function assertStar(body: object, isSuperAdmin: boolean) {
  const fields = STAR_FIELDS.filter((f) => f in body);
  if (!isSuperAdmin && fields.length) throw new MockAccessoryError(403, 'FORBIDDEN_FIELD', { fields });
}
export function mockAdminCreate(body: AdminAccessoryCreateRequest, isSuperAdmin: boolean): AdminAccessoryDTO {
  assertStar(body, isSuperAdmin);
  const a = row({ id: `acc-${Date.now().toString(36)}`, ...body, active: false } as AdminAccessoryDTO);
  store = [...store, a];
  return { ...a };
}
export function mockAdminPatch(id: string, body: AdminAccessoryWriteFields, isSuperAdmin: boolean): AdminAccessoryDTO {
  assertStar(body, isSuperAdmin);
  const a = mockAdminGet(id);
  if (a.active && body.category && (body.category === 'energy') !== (a.category === 'energy')) throw new MockAccessoryError(409, 'ACCESSORY_ACTIVE');
  const next = { ...a, ...body, updatedAt: new Date().toISOString() };
  store = store.map((x) => (x.id === id ? next : x));
  return next;
}
export function mockActivationMissing(a: AdminAccessoryDTO) {
  const missing: string[] = [];
  if (a.priceCents === null) missing.push('price');
  if (a.photo === null) missing.push('photo');
  if (a.category === 'energy') {
    if (!a.energyType) missing.push('energy_type');
  } else {
    if (a.lengthMm === null || a.widthMm === null || a.heightMm === null) missing.push('dimensions');
    if (a.weightG === null) missing.push('weight');
  }
  return missing;
}
export function mockAdminActivate(id: string, active: boolean): AdminAccessoryDTO {
  const a = mockAdminGet(id);
  if (active) {
    const missing = mockActivationMissing(a);
    if (missing.length) throw new MockAccessoryError(422, 'ACCESSORY_NOT_ACTIVATABLE', { missing });
    const other = a.energyType && store.find((x) => x.id !== id && x.active && x.energyType === a.energyType);
    if (other) throw new MockAccessoryError(409, 'ENERGY_TYPE_TAKEN', { accessoryId: other.id });
  }
  store = store.map((x) => (x.id === id ? { ...x, active, updatedAt: new Date().toISOString() } : x));
  return mockAdminGet(id);
}
export function mockAdminDelete(id: string) {
  const a = mockAdminGet(id);
  if (a.hasSales) throw new MockAccessoryError(409, 'ACCESSORY_HAS_SALES');
  store = store.filter((x) => x.id !== id);
}
export function mockAdminPhoto(id: string, file: File): AdminAccessoryDTO {
  if (file.size > 10 * 1024 * 1024) throw new MockAccessoryError(422, 'PHOTO_INVALID', { reason: 'too_large' });
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new MockAccessoryError(422, 'PHOTO_INVALID', { reason: 'unsupported_type' });
  store = store.map((x) => (x.id === id ? { ...x, photo: photoOf(`${id}-${Date.now()}`) } : x));
  return mockAdminGet(id);
}
export function mockAdminStock(id: string, body: AccessoryStockRequest, actorName: string | null): AdminAccessoryDTO {
  const a = mockAdminGet(id);
  let next = a.stockQty;
  if (body.kind === 'receive') next = a.stockQty + body.quantity;
  else {
    if (body.expectedStockQty !== a.stockQty) throw new MockAccessoryError(409, 'STOCK_CONFLICT', { stockQty: a.stockQty });
    if (body.newStockQty < a.reservedQty) throw new MockAccessoryError(409, 'STOCK_BELOW_RESERVED', { reservedQty: a.reservedQty });
    if (body.newStockQty === a.stockQty || body.reason.trim().length < 3) throw new MockAccessoryError(400, 'VALIDATION_ERROR', { field: 'reason' });
    next = body.newStockQty;
  }
  const mv: AccessoryStockMovementDTO = {
    kind: body.kind,
    delta: next - a.stockQty,
    stockBefore: a.stockQty,
    stockAfter: next,
    reason: body.kind === 'adjust' ? body.reason : body.note ?? null,
    actor: { userId: 'mock-user', name: actorName },
    orderNumber: null,
    createdAt: new Date().toISOString(),
  };
  movements[id] = [mv, ...(movements[id] ?? [])];
  store = store.map((x) => (x.id === id ? { ...x, stockQty: next, availableQty: next - x.reservedQty } : x));
  return mockAdminGet(id);
}
export function mockAdminMovements(id: string, page = 1): AccessoryStockMovementsResponse {
  const all = movements[id] ?? [];
  return { items: all.slice((page - 1) * 20, page * 20), page, pageSize: 20, total: all.length };
}

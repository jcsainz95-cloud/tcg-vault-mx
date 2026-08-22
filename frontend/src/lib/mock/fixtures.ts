/**
 * MOCK: pendiente de backend real.
 * Fixtures que respetan los shapes de docs/API_CONTRACT.md v1.1. Los nombres de
 * cartas y sets están en inglés (datos de catálogo NO se traducen, por diseño).
 *
 * v1.1: raw solo NM (sin LP/MP/HP/DMG), sellado como línea de venta con subtipo +
 * precio manual MXN, sets con año, facetas dinámicas y serie de tendencia de
 * portafolio. La vitrina de "Compra" (GET /catalog/cards) SOLO lista inventario
 * publicado con precio: los ítems "precio pendiente" no viven aquí.
 */
import type {
  CardDTO,
  CardProductDTO,
  CardSetDTO,
  Finish,
  ListingDTO,
  HoldingDTO,
  OrderSummaryDTO,
  OrderDetailDTO,
  SellRequestDTO,
  DashboardDTO,
  InventoryItemDTO,
  InventoryMovementDTO,
  VaultLocationDTO,
  AdminBuylistDTO,
  AdminOrderDTO,
  AdminShipmentDTO,
  PickingListEntryDTO,
  DisputeDTO,
  ClientDisputeDTO,
  ShipmentDTO,
  AddressDTO,
  CatalogFacetsDTO,
  PortfolioHistoryResponse,
  PortfolioPointDTO,
  PortfolioRange,
  SetValueHistoryResponse,
  SetValuePointDTO,
  SetValueRange,
  KycInfoDTO,
  FxDTO,
  PendingPriceEntryDTO,
  BuylistRule,
  BuylistRaritiesResponse,
  PriceRuleSet,
  SalesRule,
  SalesRaritiesResponse,
  SalesPriceRuleSet,
  RemoteSetDTO,
  RefreshVariantsAllResponse,
  RefreshVariantsStatusResponse,
  RefreshVariantsSummary,
  PriceHistoryEntryDTO,
  AdminUserSummaryDTO,
  AdminUserDetailDTO,
  UserAuditEntryDTO,
  SettingsDTO,
  AuditLogDTO,
  PnlDTO,
  InventoryValueDTO,
  CustodyValueDTO,
  IvaReportDTO,
  LaunchMetricsDTO,
  MasterSetSummaryDTO,
  MasterSetSort,
  MasterSetIndexResponse,
  MasterSetCardCellDTO,
  MasterSetCellCountDTO,
  MasterSetBinderResponse,
  SetPartDTO,
  MasterSetVariantDTO,
  VaultOwnerRefDTO,
  AdminVaultSummaryDTO,
  AdminVaultSort,
  AdminVaultListResponse,
  InventoryAdjustmentRequest,
  InventoryAdjustmentResponse,
  BatchCreateInventoryRequest,
  BatchCreateInventoryResponse,
  BatchInventoryLineResult,
  BulkPublishRequest,
  BulkPublishResponse,
  BulkPublishLineResult,
  InventoryStatus,
  SealedSubtype,
  SealedGroupDTO,
  SealedGroupDetailResponse,
  VaultSealedResponse,
  SealedSpreadsDTO,
} from '@/types/contract';

const IMG = 'https://images.pokemontcg.io/base1';
const SV = 'https://images.pokemontcg.io/sv8';

/** Deriva el año (para facetas/filtro de set) desde releaseDate `yyyy/MM/dd` o ISO. */
function yearOf(releaseDate?: string): number | undefined {
  if (!releaseDate) return undefined;
  const m = releaseDate.match(/(\d{4})/);
  return m ? Number(m[1]) : undefined;
}

export const mockSets: CardSetDTO[] = [
  { id: 'sv08', name: 'Surging Sparks', series: 'Scarlet & Violet', releaseDate: '2024/11/08', year: 2024 },
  { id: 'sv06', name: 'Twilight Masquerade', series: 'Scarlet & Violet', releaseDate: '2024/05/24', year: 2024 },
  { id: 'sv1', name: 'Scarlet & Violet', series: 'Scarlet & Violet', releaseDate: '2023/03/31', year: 2023 },
  // v1.33-master-set-multipart (P-27): Celebrations es un master COMBINADO — principal `cel25`
  // (25 cartas) + subset `cel25c` "Classic Collection" (25 cartas) = 50. Ambos se importan como sets
  // REALES (el mapa es solo presentación); la numeración COLISIONA entre partes a propósito (dos "#1",
  // §4.31f) para ejercer el separador por bloque.
  { id: 'cel25', name: 'Celebrations', series: 'Sword & Shield', releaseDate: '2021/10/08', year: 2021 },
  { id: 'cel25c', name: 'Celebrations: Classic Collection', series: 'Sword & Shield', releaseDate: '2021/10/08', year: 2021 },
  { id: 'swsh1', name: 'Sword & Shield', series: 'Sword & Shield', releaseDate: '2020/02/07', year: 2020 },
  { id: 'base1', name: 'Base Set', series: 'Base', releaseDate: '1999/01/09', year: 1999 },
].map((s) => ({ ...s, year: yearOf(s.releaseDate) }));

// ===== v1.33-master-set-multipart (P-27, §4.31a): mapa curado padre→subset (SOLO presentación) =====
// Espeja `backend/src/config/master-set-groups.ts`. NUNCA es fuente de verdad: cada Card/pieza conserva
// su set-id real; el mapa solo alimenta los read models de PRESENTACIÓN (binder/índice/dropdown).
export interface MasterSetGroup {
  primary: string;
  label: string;
  subsets: { setId: string; label: string; order: number }[];
}
export const MASTER_SET_GROUPS: MasterSetGroup[] = [
  {
    primary: 'cel25',
    label: 'Celebrations',
    subsets: [{ setId: 'cel25c', label: 'Classic Collection', order: 1 }],
  },
];

const isImportedSet = (setId: string) => mockSets.some((s) => s.id === setId);

/** Grupo cuyo PRINCIPAL es `setId` (y está importado); undefined si `setId` no es principal de un grupo. */
export function masterGroupOfPrimary(setId: string): MasterSetGroup | undefined {
  return MASTER_SET_GROUPS.find((g) => g.primary === setId);
}
/** Si `setId` es un SUBSET de un grupo, devuelve {group, subset}; undefined si no. */
export function masterGroupOfSubset(setId: string):
  | { group: MasterSetGroup; subset: { setId: string; label: string; order: number } }
  | undefined {
  for (const g of MASTER_SET_GROUPS) {
    const subset = g.subsets.find((s) => s.setId === setId);
    if (subset) return { group: g, subset };
  }
  return undefined;
}
/**
 * Set-ids REALES que agrupa `setId` como master combinado (principal + subsets IMPORTADOS), en orden de
 * bloque. Devuelve undefined cuando `setId` NO es un principal con ≥1 subset importado (set de una sola
 * parte → comportamiento previo intacto). CA-71: si el subset no está importado, no se incluye.
 */
export function masterPartSetIds(setId: string): string[] | undefined {
  const g = masterGroupOfPrimary(setId);
  if (!g) return undefined;
  const importedSubsets = g.subsets.filter((s) => isImportedSet(s.setId));
  if (importedSubsets.length === 0) return undefined;
  return [g.primary, ...importedSubsets.sort((a, b) => a.order - b.order).map((s) => s.setId)];
}
/**
 * Normaliza un `:setId` a su PRINCIPAL cuando es un subset de un grupo cuyo principal está importado
 * (CA-71: si el principal NO está importado, el subset se queda como su propio set). Devuelve el id
 * canónico y si hubo normalización (para exponer `canonicalSetId`).
 */
export function normalizeMasterSetId(setId: string): { canonicalId: string; normalized: boolean } {
  const sub = masterGroupOfSubset(setId);
  if (sub && isImportedSet(sub.group.primary)) {
    return { canonicalId: sub.group.primary, normalized: true };
  }
  return { canonicalId: setId, normalized: false };
}
/** Expansión de `GET /buylist/cards`/`GET /catalog/cards`: `setId IN partSetIds` si es master combinado. */
export function expandSetIdFilter(setId: string): string[] {
  return masterPartSetIds(setId) ?? [setId];
}
/** Etiqueta del bloque de un set-id dentro de un master combinado (principal → su nombre; subset → label). */
function partLabelOf(partSetId: string, group: MasterSetGroup): string {
  if (partSetId === group.primary) return group.label;
  return group.subsets.find((s) => s.setId === partSetId)?.label ?? partSetId;
}

/**
 * v1.33 (P-27, §4.31d): pliega un listado de sets para los dropdowns (`GET /catalog/sets`,
 * `GET /buylist/sets`): un subset de un master combinado se COLAPSA en la fila del principal
 * (Celebrations aparece UNA sola vez) y esa entrada gana `partSetIds`. CA-71: si el principal no está
 * en el listado, el subset se conserva como su propia entrada. Un set normal pasa sin cambio.
 */
export function foldSetsForDropdown(sets: CardSetDTO[]): CardSetDTO[] {
  const present = new Set(sets.map((s) => s.id));
  const droppedSubsets = new Set<string>();
  const partsByPrimary = new Map<string, string[]>();
  for (const g of MASTER_SET_GROUPS) {
    if (!present.has(g.primary)) continue; // CA-71
    const importedSubsets = g.subsets
      .filter((su) => present.has(su.setId))
      .sort((a, b) => a.order - b.order);
    if (importedSubsets.length === 0) continue;
    for (const su of importedSubsets) droppedSubsets.add(su.setId);
    partsByPrimary.set(g.primary, [g.primary, ...importedSubsets.map((s) => s.setId)]);
  }
  return sets
    .filter((s) => !droppedSubsets.has(s.id))
    .map((s) => {
      const partSetIds = partsByPrimary.get(s.id);
      return partSetIds ? { ...s, partSetIds } : s;
    });
}

function card(
  id: string,
  name: string,
  number: string,
  rarity: string,
  setId: string,
  setName: string,
  supertype = 'Pokémon',
  subtypes: string[] = ['Basic'],
  img = IMG,
): CardDTO {
  return {
    id,
    externalId: id,
    name,
    number,
    rarity,
    supertype,
    subtypes,
    setId,
    setName,
    imageSmallUrl: `${img}/${number}.png`,
    imageLargeUrl: `${img}/${number}_hires.png`,
    // v1.6-finish: se sobre-escribe por CARD_FINISHES abajo; default seguro ["normal"].
    availableFinishes: ['normal'],
  };
}

/**
 * v1.6-finish: acabados disponibles por carta (derivados de tcgplayer.prices al importar).
 * `normal` va primero para que el cotizador arranque en Normal por defecto. Las cartas
 * no listadas quedan en ["normal"] (sellado, o filas históricas sin re-sync).
 */
const CARD_FINISHES: Record<string, Finish[]> = {
  'c-charizard': ['normal', 'reverse_holo', 'holofoil'],
  'c-blastoise': ['normal', 'holofoil'],
  'c-pikachu': ['normal', 'reverse_holo'],
  'c-zapdos': ['normal', 'holofoil'],
  'c-eevee': ['normal', 'reverse_holo'],
  'c-machamp': ['normal', 'reverse_holo'],
  'c-pikachu-ir': ['holofoil'],
  'c-latias-sir': ['holofoil'],
  'c-milotic-fa': ['holofoil'],
};

export const mockCards: CardDTO[] = ([
  // Base Set clásicas (raw/graded).
  card('c-charizard', 'Charizard', '4', 'Rare Holo', 'base1', 'Base Set', 'Pokémon', ['Stage 2']),
  card('c-blastoise', 'Blastoise', '2', 'Rare Holo', 'base1', 'Base Set', 'Pokémon', ['Stage 2']),
  card('c-pikachu', 'Pikachu', '58', 'Common', 'base1', 'Base Set'),
  card('c-zapdos', 'Zapdos', '16', 'Rare Holo', 'base1', 'Base Set'),
  card('c-eevee', 'Eevee', '51', 'Reverse Holo', 'base1', 'Base Set'),
  card('c-machamp', 'Machamp', '8', 'Uncommon', 'base1', 'Base Set', 'Pokémon', ['Stage 2']),
  // Rarezas modernas (Scarlet & Violet) para poblar el filtro de rareza agrupado.
  card('c-pikachu-ir', 'Pikachu ex', '238', 'Illustration Rare', 'sv08', 'Surging Sparks', 'Pokémon', ['Basic', 'ex'], SV),
  card('c-latias-sir', 'Latias ex', '242', 'Special Illustration Rare', 'sv08', 'Surging Sparks', 'Pokémon', ['Basic', 'ex'], SV),
  card('c-milotic-fa', 'Milotic ex', '213', 'Ultra Rare', 'sv08', 'Surging Sparks', 'Pokémon', ['Stage 1', 'ex'], SV),
  // Productos sellados (sin rareza ni condición; nombre = producto).
  card('c-sealed-sv08-box', 'Surging Sparks Booster Box', '', '', 'sv08', 'Surging Sparks', 'Sealed', [], SV),
  card('c-sealed-sv06-etb', 'Twilight Masquerade ETB', '', '', 'sv06', 'Twilight Masquerade', 'Sealed', [], SV),
] as CardDTO[]).map((c) => ({ ...c, availableFinishes: CARD_FINISHES[c.id] ?? ['normal'] }))
  // v1.33-master-set-multipart (P-27): 25 cartas por parte de Celebrations (holofoil-only, como el
  // set real). Se generan para que el binder COMBINADO muestre 50 y ejerza la colisión de numeración.
  .concat(celebrationsCards());

/**
 * v1.33-master-set-multipart (P-27): genera las cartas de las DOS partes de Celebrations.
 * Cada parte tiene 25 cartas holofoil numeradas "1".."25" (la numeración COLISIONA entre partes a
 * propósito: dos "#1" que el separador por bloque desambigua, §4.31f). Suman 50 = el master combinado.
 */
function celebrationsCards(): CardDTO[] {
  const CEL = 'https://images.pokemontcg.io/cel25';
  const mk = (setId: string, setName: string, n: number): CardDTO => ({
    id: `c-${setId}-${n}`,
    externalId: `${setId}-${n}`,
    name: `${setName} #${n}`,
    number: String(n),
    rarity: 'Holo Rare',
    supertype: 'Pokémon',
    subtypes: ['Basic'],
    setId,
    setName,
    imageSmallUrl: `${CEL}/${n}.png`,
    imageLargeUrl: `${CEL}/${n}_hires.png`,
    availableFinishes: ['holofoil'],
  });
  return [
    ...Array.from({ length: 25 }, (_, i) => mk('cel25', 'Celebrations', i + 1)),
    ...Array.from({ length: 25 }, (_, i) => mk('cel25c', 'Classic Collection', i + 1)),
  ];
}

const cardById = (id: string) => mockCards.find((c) => c.id === id)!;

/**
 * Valor de referencia de mercado por carta (MXN centavos) para el cotizador de
 * buylist. `null` = sin dato de mercado → cotización "precio pendiente" (lado
 * adquisición; el comprador nunca lo ve). Zapdos queda sin referencia a propósito.
 */
export const mockReferenceByCardId: Record<string, number | null> = {
  'c-charizard': 4850000,
  'c-blastoise': 128000,
  'c-pikachu': 9500,
  'c-zapdos': null,
  'c-eevee': 22000,
  'c-machamp': 45000,
  'c-pikachu-ir': 180000,
  'c-latias-sir': 950000,
  'c-milotic-fa': 210000,
};

/**
 * Vitrina de "Compra": SOLO inventario publicado con precio de venta fijado
 * (sellable=true, salePriceCents != null). Nunca "precio pendiente" (v1.1).
 */
export const mockListings: ListingDTO[] = [
  {
    inventoryItemId: 'inv-1001',
    card: cardById('c-charizard'),
    productType: 'graded',
    finish: 'normal',
    gradingCompany: 'PSA',
    gradeValue: '9',
    // v1.2: gradeada identificada por empresa + grado + certNumber (verificable en la graduadora).
    certNumber: '82749163',
    referenceValue: { status: 'priced', referenceMxnCents: 4850000, source: 'pokemonpricetracker', capturedDate: '2026-08-13' },
    salePriceCents: 5335000,
    sellable: true,
  },
  {
    inventoryItemId: 'inv-1002',
    card: cardById('c-blastoise'),
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'normal',
    referenceValue: { status: 'priced', referenceMxnCents: 128000, source: 'pokemontcg_io', capturedDate: '2026-08-13' },
    salePriceCents: 140800,
    sellable: true,
  },
  {
    inventoryItemId: 'inv-1003',
    card: cardById('c-pikachu'),
    productType: 'raw',
    rawCondition: 'NM',
    // v1.6-finish: la misma carta en distinto acabado = listing separado (aquí Reverse Holo).
    finish: 'reverse_holo',
    referenceValue: { status: 'priced', referenceMxnCents: 9500, source: 'pokemontcg_io', capturedDate: '2026-08-13' },
    salePriceCents: 10450,
    sellable: true,
  },
  {
    inventoryItemId: 'inv-1004',
    card: cardById('c-eevee'),
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'reverse_holo',
    referenceValue: { status: 'priced', referenceMxnCents: 22000, source: 'pokemontcg_io', capturedDate: '2026-08-13' },
    salePriceCents: 24200,
    sellable: true,
  },
  {
    inventoryItemId: 'inv-1005',
    card: cardById('c-pikachu-ir'),
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'holofoil',
    referenceValue: { status: 'priced', referenceMxnCents: 180000, source: 'pokemontcg_io', capturedDate: '2026-08-13' },
    salePriceCents: 198000,
    sellable: true,
  },
  {
    inventoryItemId: 'inv-1006',
    card: cardById('c-latias-sir'),
    productType: 'graded',
    finish: 'normal',
    gradingCompany: 'CGC',
    gradeValue: '9.5',
    certNumber: '01245678',
    referenceValue: { status: 'priced', referenceMxnCents: 950000, source: 'pokemonpricetracker', capturedDate: '2026-08-13' },
    salePriceCents: 1045000,
    sellable: true,
  },
  {
    inventoryItemId: 'inv-1007',
    card: cardById('c-milotic-fa'),
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'holofoil',
    referenceValue: { status: 'priced', referenceMxnCents: 210000, source: 'pokemontcg_io', capturedDate: '2026-08-13' },
    salePriceCents: 231000,
    sellable: true,
  },
  // Sellado: precio manual del admin en MXN, sin rareza/condición (finish siempre normal).
  {
    inventoryItemId: 'inv-1008',
    card: cardById('c-sealed-sv08-box'),
    productType: 'sealed',
    sealedSubtype: 'box',
    finish: 'normal',
    referenceValue: { status: 'priced', referenceMxnCents: 320000, source: 'manual', capturedDate: '2026-08-13' },
    salePriceCents: 320000,
    sellable: true,
  },
  {
    inventoryItemId: 'inv-1009',
    card: cardById('c-sealed-sv06-etb'),
    productType: 'sealed',
    sealedSubtype: 'etb',
    finish: 'normal',
    referenceValue: { status: 'priced', referenceMxnCents: 105000, source: 'manual', capturedDate: '2026-08-12' },
    salePriceCents: 105000,
    sellable: true,
  },
];

/** Facetas dinámicas de Compra (contrato GET /catalog/facets) — sobre lo publicado. */
export const mockFacets: CatalogFacetsDTO = {
  rarities: Array.from(
    new Set(mockListings.map((l) => l.card.rarity).filter((r): r is string => !!r)),
  ),
  sets: mockSets
    .filter((s) => mockListings.some((l) => l.card.setId === s.id))
    .map((s) => ({ id: s.id, name: s.name, releaseDate: s.releaseDate, year: s.year }))
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0)),
  productTypes: Array.from(new Set(mockListings.map((l) => l.productType))),
  sealedSubtypes: Array.from(
    new Set(mockListings.map((l) => l.sealedSubtype).filter((s): s is NonNullable<typeof s> => !!s)),
  ),
  // v1.6-finish: distinct de InventoryItem.finish sobre lo publicado (para el filtro de acabado).
  finishes: Array.from(new Set(mockListings.map((l) => l.finish))),
  price: {
    minCents: Math.min(...mockListings.map((l) => l.salePriceCents ?? 0)),
    maxCents: Math.max(...mockListings.map((l) => l.salePriceCents ?? 0)),
    currency: 'MXN',
  },
};

export const mockHoldings: HoldingDTO[] = [
  {
    inventoryItemId: 'inv-1002',
    folio: 'INV-000102',
    card: cardById('c-blastoise'),
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'reverse_holo',
    ownershipStatus: 'settled',
    status: 'in_custody',
    referenceValue: { status: 'priced', referenceMxnCents: 128000, capturedDate: '2026-08-13' },
    // Settled y sin envío → retirable.
    shipmentState: null,
    activeShipmentId: null,
    withdrawable: true,
  },
  {
    inventoryItemId: 'inv-1006',
    folio: 'INV-000106',
    card: cardById('c-latias-sir'),
    productType: 'graded',
    finish: 'normal',
    gradingCompany: 'CGC',
    gradeValue: '9.5',
    certNumber: '01245678',
    ownershipStatus: 'pending',
    status: 'in_custody',
    referenceValue: { status: 'priced', referenceMxnCents: 950000, capturedDate: '2026-08-13' },
    // Pending → no retirable (aún no liquidada), sin envío activo.
    shipmentState: null,
    activeShipmentId: null,
    withdrawable: false,
  },
  {
    inventoryItemId: 'inv-1008',
    folio: 'INV-000108',
    card: cardById('c-sealed-sv08-box'),
    productType: 'sealed',
    sealedSubtype: 'box',
    finish: 'normal',
    ownershipStatus: 'settled',
    status: 'in_custody',
    referenceValue: { status: 'priced', referenceMxnCents: 320000, capturedDate: '2026-08-13' },
    // v1.17: EN RETIRO — envío activo `enviado` (shp-7001 lo contiene). NO retirable (ya en un envío).
    // El badge "EN RETIRO" hace deep-link a /shipments/shp-7001.
    shipmentState: 'enviado',
    activeShipmentId: 'shp-7001',
    withdrawable: false,
  },
  {
    inventoryItemId: 'inv-1010',
    folio: 'INV-000110',
    card: cardById('c-zapdos'),
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'holofoil',
    ownershipStatus: 'settled',
    status: 'in_custody',
    // Precio pendiente en portafolio: se excluye del total (no rompe el cálculo).
    referenceValue: { status: 'pending' },
    // Settled y sin envío → retirable (aunque su precio esté pendiente).
    shipmentState: null,
    activeShipmentId: null,
    withdrawable: true,
  },
];

export const mockPortfolio = {
  totalValueMxnCents: 543200,
  pendingPriceCount: 1,
  currency: 'MXN' as const,
};

/**
 * Genera una serie de tendencia de portafolio determinista (contrato §3,
 * GET /vault/portfolio/history). Termina en el valor actual del portafolio y
 * crea un histórico suave con leve tendencia + ruido reproducible.
 */
const RANGE_DAYS: Record<PortfolioRange, number> = {
  '5d': 5,
  '15d': 15,
  '1m': 30,
  '3m': 90,
  '6m': 180,
  '1y': 365,
  ytd: 226, // 1 ene 2026 → 14 ago 2026 (aprox, para el mock)
  all: 420,
};

export function generatePortfolioHistory(range: PortfolioRange): PortfolioHistoryResponse {
  const days = RANGE_DAYS[range];
  const end = mockPortfolio.totalValueMxnCents;
  const costBasis = 400000;
  const start = Math.round(end * 0.82); // ~+22% en el rango largo; los cortos se recortan abajo
  const today = new Date('2026-08-14T00:00:00Z');
  const points: PortfolioPointDTO[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - i);
    const progress = days > 1 ? (days - 1 - i) / (days - 1) : 1;
    // ruido determinista via seno; amplitud proporcional al valor.
    const noise = Math.sin((i + range.length) * 1.3) * end * 0.02;
    const value = Math.round(start + (end - start) * progress + noise);
    points.push({
      date: d.toISOString().slice(0, 10),
      valueMxnCents: Math.max(0, value),
      costBasisMxnCents: costBasis,
    });
  }
  // Forzar el último punto al valor actual real del portafolio.
  if (points.length > 0) points[points.length - 1].valueMxnCents = end;

  const first = points[0];
  const last = points[points.length - 1];
  const absMxnCents = last.valueMxnCents - first.valueMxnCents;
  const pct = first.valueMxnCents === 0 ? null : Math.round((absMxnCents / first.valueMxnCents) * 10000) / 100;
  const direction = absMxnCents > 0 ? 'up' : absMxnCents < 0 ? 'down' : 'flat';
  return { range, points, change: { absMxnCents, pct, direction } };
}

/**
 * MOCK v1.9-set-chart: serie PÚBLICA del valor de mercado del "set destacado" para el hero
 * (contrato GET /catalog/featured-set/value-history). El set destacado lo resuelve el backend;
 * aquí devolvemos Surging Sparks como espejo del catálogo. Datos SOBRIOS: valor agregado alto
 * (suma de ~184 cartas priceadas) con una tendencia mensual leve (~+2.7%), NO un rally fabricado.
 * Termina en un valor "de hoy" determinista y crea el histórico con ruido reproducible.
 */
const FEATURED_SET_REF = {
  id: 'sv08',
  name: 'Surging Sparks',
  series: 'Scarlet & Violet',
  releaseDate: '2024/11/08',
} as const;

const SET_RANGE_DAYS: Record<SetValueRange, number> = {
  '5d': 5,
  '15d': 15,
  '1m': 30,
  '3m': 90,
  '6m': 180,
  '1y': 365,
  ytd: 226,
  all: 300, // el set salió nov-2024; la serie real solo crece desde que se sembró el snapshot
};

export function generateFeaturedSetValueHistory(range: SetValueRange): SetValueHistoryResponse {
  const days = SET_RANGE_DAYS[range];
  const end = 131920000; // MX$1,319,200 — suma de las cartas priceadas del set (referencia)
  const start = Math.round(end * 0.973); // ~+2.7% en el rango de 1m (movimiento sobrio)
  const today = new Date('2026-08-14T00:00:00Z');
  const points: SetValuePointDTO[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - i);
    const progress = days > 1 ? (days - 1 - i) / (days - 1) : 1;
    // Ruido determinista via seno; amplitud contenida (~0.4% del valor) para no simular volatilidad.
    const noise = Math.sin((i + range.length) * 1.1) * end * 0.004;
    const value = Math.round(start + (end - start) * progress + noise);
    points.push({
      date: d.toISOString().slice(0, 10),
      valueMxnCents: Math.max(0, value),
      pricedCardCount: 182 + (i % 3 === 0 ? 2 : i % 2 === 0 ? 1 : 0),
    });
  }
  if (points.length > 0) {
    points[points.length - 1].valueMxnCents = end;
    points[points.length - 1].pricedCardCount = 184;
  }
  const first = points[0];
  const last = points[points.length - 1];
  const absMxnCents = last ? last.valueMxnCents - first.valueMxnCents : 0;
  const pct =
    !first || first.valueMxnCents === 0 ? null : Math.round((absMxnCents / first.valueMxnCents) * 10000) / 100;
  const direction = absMxnCents > 0 ? 'up' : absMxnCents < 0 ? 'down' : 'flat';
  return { set: { ...FEATURED_SET_REF }, range, points, change: { absMxnCents, pct, direction } };
}

/**
 * MOCK v1.9-set-chart: serie recién sembrada — hay set pero aún NO hay historial (points: []).
 * El "estado honesto" del hero (§7.18) debe decir "Recopilando historial" en vez de fabricar curva.
 */
export const mockFeaturedSetHistoryEmpty: SetValueHistoryResponse = {
  set: { ...FEATURED_SET_REF },
  range: '1m',
  points: [],
  change: { absMxnCents: 0, pct: null, direction: 'flat' },
};

/**
 * MOCK v1.9-set-chart: no hay ningún CardSet para graficar (set: null). El hero degrada sin
 * error: se omite el bloque de gráfica y el panel anónimo cae a su forma previa.
 */
export const mockFeaturedSetHistoryNull: SetValueHistoryResponse = {
  set: null,
  range: '1m',
  points: [],
  change: { absMxnCents: 0, pct: null, direction: 'flat' },
};

export const mockOrders: OrderSummaryDTO[] = [
  { id: 'ord-9001', status: 'settled', totalCents: 168520, createdAt: '2026-08-10T18:20:00Z', settledAt: '2026-08-10T18:22:00Z' },
  { id: 'ord-9002', status: 'pending', totalCents: 58300, createdAt: '2026-08-13T09:05:00Z' },
];

export const mockOrderDetail: OrderDetailDTO = {
  id: 'ord-9001',
  status: 'settled',
  createdAt: '2026-08-10T18:20:00Z',
  settledAt: '2026-08-10T18:22:00Z',
  breakdown: {
    subtotalCents: 140800,
    ivaCents: 22528,
    ivaRatePct: 16,
    processingFeeCents: 5192,
    totalCents: 168520,
    currency: 'MXN',
  },
  items: [{ inventoryItemId: 'inv-1002', card: cardById('c-blastoise'), unitPriceCents: 140800 }],
  cfdiStatus: 'registrado',
  invoiceRequested: false,
  stripePaymentIntentId: 'pi_mock_123',
};

export const mockSellRequests: SellRequestDTO[] = [
  {
    sellRequestId: 'sr-3001',
    status: 'verificacion',
    quotedTotalCents: 50200,
    ineRequired: false,
    createdAt: '2026-08-12T14:00:00Z',
    items: [
      { id: 'sri-1', card: cardById('c-charizard'), productType: 'raw', rawCondition: 'NM', finish: 'holofoil', rarity: 'Rare Holo', appliedRule: { mode: 'pct', value: 40, source: 'fallback' }, quotedPriceCents: 50000, itemStatus: 'verificacion' },
      { id: 'sri-2', card: cardById('c-pikachu'), productType: 'raw', rawCondition: 'NM', finish: 'normal', rarity: 'Common', appliedRule: { mode: 'fixed', value: 50, source: 'rule' }, quotedPriceCents: 50, itemStatus: 'recibida' },
      { id: 'sri-3', card: cardById('c-eevee'), productType: 'raw', rawCondition: 'NM', finish: 'reverse_holo', rarity: 'Reverse Holo', appliedRule: { mode: 'fixed', value: 150, source: 'rule' }, quotedPriceCents: 150, itemStatus: 'recibida' },
    ],
  },
  // WS-F F5: solicitud con un ítem AJUSTADO (approvedPriceCents < quotedPriceCents) para ejercer el
  // bloque "Responder ajuste" (aceptar/rechazar). `ajustada` es item-level, no request-level.
  {
    sellRequestId: 'sr-3002',
    status: 'verificacion',
    quotedTotalCents: 60000,
    ineRequired: false,
    createdAt: '2026-08-13T14:00:00Z',
    items: [
      { id: 'sri-adj-1', card: cardById('c-charizard'), productType: 'raw', rawCondition: 'NM', finish: 'holofoil', rarity: 'Rare Holo', appliedRule: { mode: 'pct', value: 40, source: 'fallback' }, quotedPriceCents: 60000, approvedPriceCents: 45000, itemStatus: 'ajustada' },
    ],
  },
];

/** KYC del comprador (contrato GET /users/me/kyc). CLABE enmascarada; INE aún no en archivo. */
export const mockKyc: KycInfoDTO = {
  kycStatus: 'none',
  clabeMasked: undefined,
  // v1.15: sin CLABE ni INE en archivo por defecto (el checklist los marca como pendientes).
  clabeOnFile: false,
  ineOnFile: false,
  capPerRequestCents: 300000, // MOCK: dial M10 default (MX$3,000).
  capPerMonthCents: 1000000, // MOCK: dial M10 default (MX$10,000).
  monthUsedCents: 0,
};

/**
 * MOCK: libreta de direcciones del usuario (contrato §1 · GET /users/me/addresses).
 * Mutable en memoria: las ramas mock de createAddress/updateAddress/deleteAddress la modifican
 * para que el gestor de direcciones se comporte como con backend real durante la demo.
 */
export const mockAddresses: AddressDTO[] = [
  {
    id: 'addr-1',
    line1: 'Av. Reforma 222',
    line2: 'Piso 3',
    neighborhood: 'Juárez',
    city: 'Ciudad de México',
    state: 'CDMX',
    postalCode: '06600',
    country: 'MX',
    phone: '5555123456',
    isDefault: true,
  },
];

/** ISO de hace `n` días (para anclar la ventana de disputa a una entrega reciente). */
const daysAgoIso = (n: number): string => new Date(Date.now() - n * 24 * 3600 * 1000).toISOString();

/** Snapshot de dirección MX de ejemplo para los retiros (contrato §5 `addressSnapshot`). */
const mockShipmentAddress = {
  line1: 'Av. Reforma 222',
  line2: 'Piso 3',
  neighborhood: 'Juárez',
  city: 'Ciudad de México',
  state: 'CDMX',
  postalCode: '06600',
  country: 'MX',
} as const;

/**
 * MOCK v1.17: retiros del PROPIO usuario (contrato §5 · GET /shipments listMine / GET /shipments/:id).
 * Enriquecidos con `addressSnapshot`, montos por retiro y `finish` por ítem para la vista de rastreo.
 * shp-7001 (`enviado`) es el envío ACTIVO del holding inv-1002 (deep-link desde el badge "EN RETIRO").
 */
export const mockShipments: ShipmentDTO[] = [
  {
    id: 'shp-7001',
    status: 'enviado',
    carrier: 'Estafeta',
    trackingNumber: '1234567890',
    createdAt: '2026-08-11T10:00:00Z',
    addressSnapshot: mockShipmentAddress,
    shippingFeeCents: 17500,
    ivaCents: 2800,
    processingFeeCents: 1050,
    totalCents: 21350,
    requestedAt: '2026-08-11T10:00:00Z',
    pickingAt: '2026-08-11T15:00:00Z',
    shippedAt: '2026-08-12T09:00:00Z',
    items: [
      {
        inventoryItemId: 'inv-1008',
        folio: 'INV-000108',
        card: cardById('c-sealed-sv08-box'),
        productType: 'sealed',
        finish: 'normal',
      },
    ],
  },
  // WS-F F6: envío ENTREGADO reciente → habilita "Abrir disputa" en el ítem raw elegible; el ítem
  // graded queda fuera (el backend responde 422 NOT_RAW). deliveredAt dinámico (2d) = dentro de la
  // ventana de 7 días para que la demo/tests siempre muestren un ítem elegible.
  {
    id: 'shp-7002',
    status: 'entregado',
    carrier: 'Estafeta',
    trackingNumber: '9988776655',
    createdAt: '2026-08-09T10:00:00Z',
    addressSnapshot: mockShipmentAddress,
    shippingFeeCents: 17500,
    ivaCents: 2800,
    processingFeeCents: 1050,
    totalCents: 21350,
    requestedAt: '2026-08-09T10:00:00Z',
    pickingAt: '2026-08-09T14:00:00Z',
    shippedAt: '2026-08-10T09:00:00Z',
    deliveredAt: daysAgoIso(2),
    items: [
      {
        inventoryItemId: 'inv-1003',
        folio: 'INV-000103',
        card: cardById('c-charizard'),
        productType: 'raw',
        finish: 'holofoil',
      },
      {
        inventoryItemId: 'inv-1006',
        folio: 'INV-000106',
        card: cardById('c-latias-sir'),
        productType: 'graded',
        finish: 'normal',
      },
    ],
  },
];

// ---- Admin ----
/**
 * MOCK: cola ADMIN de envíos de CLIENTES (contrato §M4 · GET /admin/shipments).
 * Distinta de mockShipments (los envíos del PROPIO usuario en "mis envíos").
 */
export const mockAdminShipments: AdminShipmentDTO[] = [
  {
    id: 'shp-7001',
    userId: 'u-777',
    status: 'enviado',
    carrier: 'Estafeta',
    trackingNumber: '1234567890',
    requestedAt: '2026-08-11T10:00:00Z',
    items: [{ inventoryItemId: 'inv-1002' }],
  },
  {
    id: 'shp-7002',
    userId: 'u-778',
    status: 'picking',
    carrier: null,
    trackingNumber: null,
    requestedAt: '2026-08-13T09:30:00Z',
    items: [{ inventoryItemId: 'inv-1001' }, { inventoryItemId: 'inv-1008' }],
  },
  {
    id: 'shp-7003',
    userId: 'u-779',
    status: 'solicitado',
    carrier: null,
    trackingNumber: null,
    requestedAt: '2026-08-14T12:00:00Z',
    items: [{ inventoryItemId: 'inv-1010' }],
  },
];

/** MOCK: lista de picking por ubicación (contrato §M4 · GET /admin/shipments/picking-list). */
export const mockPickingList: PickingListEntryDTO[] = [
  { shipmentId: 'shp-7002', inventoryItemId: 'inv-1001', folio: 'INV-000101', location: 'C03-F02-S15' },
  { shipmentId: 'shp-7002', inventoryItemId: 'inv-1008', folio: 'INV-000108', location: 'C03-F02-S16' },
];

export const mockDashboard: DashboardDTO = {
  profitPeriodCents: 1284000,
  salesPeriod: { count: 42, amountCents: 5620000 },
  workQueue: { shipments: 3, buylist: 5, disputes: 1, pendingPrices: 7 },
  inventoryValueCents: 18500000,
  custodyValueCents: 9200000,
  buylistPeriod: { count: 12, amountCents: 340000 },
  dataHealth: { pendingPriceCount: 7, lastPriceSyncAt: '2026-08-13T06:00:00Z', lastFxAt: '2026-08-13T06:05:00Z' },
  launchProgress: { users: 58, salesSettled: 42, buylistPaid: 9, withdrawalsNoDispute: 15 },
};

export const mockLocations: VaultLocationDTO[] = [
  { id: 'loc-1', zone: 'platform_stock', box: 'C03', row: 'F02', slot: 'S15', label: 'C03-F02-S15' },
  { id: 'loc-2', zone: 'platform_stock', box: 'C03', row: 'F02', slot: 'S16', label: 'C03-F02-S16' },
  { id: 'loc-3', zone: 'customer_custody', box: 'C10', row: 'F01', slot: 'S01', label: 'C10-F01-S01' },
];

export const mockInventory: InventoryItemDTO[] = [
  {
    id: 'inv-1001',
    folio: 'INV-000101',
    card: cardById('c-charizard'),
    productType: 'graded',
    finish: 'normal',
    gradingCompany: 'PSA',
    gradeValue: '9',
    certNumber: '82749163',
    status: 'listed',
    ownerType: 'platform',
    location: { id: 'loc-1', label: 'C03-F02-S15', zone: 'platform_stock' },
    referenceValue: { status: 'priced', referenceMxnCents: 4850000, capturedDate: '2026-08-13' },
    listPriceCents: 5335000,
    acquisitionType: 'aportacion_en_especie',
    acquisitionCostCents: 3395000,
  },
  {
    id: 'inv-1008',
    folio: 'INV-000108',
    card: cardById('c-sealed-sv08-box'),
    productType: 'sealed',
    sealedSubtype: 'box',
    finish: 'normal',
    status: 'listed',
    ownerType: 'platform',
    location: { id: 'loc-2', label: 'C03-F02-S16', zone: 'platform_stock' },
    referenceValue: { status: 'priced', referenceMxnCents: 320000, capturedDate: '2026-08-13' },
    listPriceCents: 320000,
    acquisitionType: 'compra',
  },
  // v1.28 (P-25): pieza sellada SIN mapeo TCGCSV (sv06 ETB) → alimenta el badge "N SIN MAPEO",
  // el `unmappedTotal` de la cola y el caso "SIN PRECIO DE MERCADO" del detalle por set.
  {
    id: 'inv-1009',
    folio: 'INV-000109',
    card: cardById('c-sealed-sv06-etb'),
    productType: 'sealed',
    sealedSubtype: 'etb',
    sealedCondition: 'mint',
    finish: 'normal',
    status: 'in_stock',
    ownerType: 'platform',
    location: { id: 'loc-2', label: 'C03-F02-S16', zone: 'platform_stock' },
    referenceValue: { status: 'pending' },
    acquisitionType: 'compra',
    acquisitionCostCents: 180000,
  },
  {
    id: 'inv-1010',
    folio: 'INV-000110',
    card: cardById('c-zapdos'),
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'holofoil',
    status: 'in_stock',
    ownerType: 'platform',
    location: { id: 'loc-2', label: 'C03-F02-S16', zone: 'platform_stock' },
    // Precio pendiente: no se publica en Compra (regla de confianza).
    referenceValue: { status: 'pending' },
    acquisitionType: 'compra',
  },
  // v1.16-master-set: piezas extra de Charizard (base1) para que el binder muestre
  // conteos por acabado (normal:3 — gradeada inv-1001 listed + inv-2001 in_stock +
  // inv-2003 reserved — y reverse_holo:1) y una pieza en status NO publicable
  // (inv-2003 reserved → ITEM_NOT_PUBLISHABLE en bulk-publish).
  {
    id: 'inv-2001',
    folio: 'INV-000201',
    card: cardById('c-charizard'),
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'normal',
    status: 'in_stock',
    ownerType: 'platform',
    location: { id: 'loc-1', label: 'C03-F02-S15', zone: 'platform_stock' },
    referenceValue: { status: 'priced', referenceMxnCents: 4850000, capturedDate: '2026-08-13' },
    acquisitionType: 'aportacion_en_especie',
    acquisitionCostCents: 3395000,
  },
  {
    id: 'inv-2002',
    folio: 'INV-000202',
    card: cardById('c-charizard'),
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'reverse_holo',
    status: 'in_stock',
    ownerType: 'platform',
    location: { id: 'loc-1', label: 'C03-F02-S15', zone: 'platform_stock' },
    referenceValue: { status: 'priced', referenceMxnCents: 4850000, capturedDate: '2026-08-13' },
    acquisitionType: 'aportacion_en_especie',
    acquisitionCostCents: 3395000,
  },
  {
    id: 'inv-2003',
    folio: 'INV-000203',
    card: cardById('c-charizard'),
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'normal',
    status: 'reserved',
    ownerType: 'platform',
    location: { id: 'loc-1', label: 'C03-F02-S15', zone: 'platform_stock' },
    referenceValue: { status: 'priced', referenceMxnCents: 4850000, capturedDate: '2026-08-13' },
    acquisitionType: 'aportacion_en_especie',
    acquisitionCostCents: 3395000,
  },
];

// Historial de movimientos por item (contrato §M1 · GET /admin/inventory/items/:id).
// Cada item nace con su movimiento de `alta`; move/mark agregan entradas en memoria.
export const mockInventoryMovements: Record<string, InventoryMovementDTO[]> = {
  'inv-1001': [
    {
      id: 'mov-1001-1',
      toLocationId: 'loc-1',
      toStatus: 'in_stock',
      reason: 'alta',
      note: 'aportacion_en_especie',
      createdAt: '2026-08-01T10:00:00Z',
    },
    {
      id: 'mov-1001-2',
      fromStatus: 'in_stock',
      toStatus: 'listed',
      reason: 'move',
      note: 'published',
      createdAt: '2026-08-02T09:00:00Z',
    },
  ],
  'inv-1008': [
    {
      id: 'mov-1008-1',
      toLocationId: 'loc-2',
      toStatus: 'in_stock',
      reason: 'alta',
      note: 'compra',
      createdAt: '2026-08-05T12:00:00Z',
    },
  ],
  'inv-1010': [
    {
      id: 'mov-1010-1',
      toLocationId: 'loc-2',
      toStatus: 'in_stock',
      reason: 'alta',
      note: 'compra',
      createdAt: '2026-08-10T16:30:00Z',
    },
  ],
};

/** Agrega un movimiento en memoria (ramas mock de move/mark) — más reciente primero. */
export function pushMockMovement(itemId: string, movement: Omit<InventoryMovementDTO, 'id' | 'createdAt'>) {
  const list = (mockInventoryMovements[itemId] ??= []);
  list.unshift({
    ...movement,
    id: `mov-${itemId}-${list.length + 1}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
  });
}

// ===================================================================================
// v1.16-master-set (§M1): Master Set + inventario a escala (índice, binder, lote).
// MOCK: pendiente de que el backend esté enchufado; respeta los shapes del contrato
// v1.16.1 y deriva TODO de mockCards + mockInventory para ser consistente y determinista.
// ===================================================================================

// printedTotal (nº impreso de cada set) para completitud + heurística isSecretRare.
const SET_PRINTED_TOTAL: Record<string, number> = {
  base1: 102,
  swsh1: 202,
  sv1: 198,
  sv06: 167,
  sv08: 191,
  // v1.33 (P-27): cada parte de Celebrations imprime 25; el binder COMBINADO reporta Σ = 50.
  cel25: 25,
  cel25c: 25,
};

// Celdas promo/subset SINTÉTICAS por set (prefijo alfabético). Existen SOLO en la vista
// master-set (no en mockCards) para ejercitar el orden natural "promos al final" y la regla
// isSecretRare=false para subsets. Son huecos (0 piezas) salvo que el inventario diga lo contrario.
const MASTER_SET_PROMO_CELLS: Record<string, { cardId: string; number: string; name: string; rarity: string }[]> = {
  sv08: [{ cardId: 'c-sv08-tg12', number: 'TG12', name: 'Rayquaza (Trainer Gallery)', rarity: 'Trainer Gallery' }],
};

// v1.29 (§4.27) — «1 carta ↔ N productos». Productos vendibles SEPARADOS (Deck Exclusives / promo)
// por cardId: NO se fusionan en la carta base, se pintan como su PROPIO producto con su propio
// precio por acabado. Charizard (base1) trae un Deck Exclusive (holofoil, con precio) y un promo
// sin precio (money-safe: marketReferenceMxnCents=null → "—", NUNCA 0 inventado).
const MASTER_SET_SEPARATE_PRODUCTS: Record<string, CardProductDTO[]> = {
  'c-charizard': [
    {
      productId: 90001,
      kind: 'deck_exclusive',
      name: 'Charizard (Deck Exclusive)',
      finishes: ['holofoil'],
      prices: [{ finish: 'holofoil', marketReferenceMxnCents: 512000, capturedDate: '2026-08-13' }],
    },
    {
      productId: 90002,
      kind: 'promo',
      name: 'Charizard (Promo)',
      finishes: ['holofoil'],
      prices: [{ finish: 'holofoil', marketReferenceMxnCents: null }],
    },
  ],
};

/** Productos SEPARADOS (deck_exclusive/promo) de una carta por su cardId (v1.29). */
export function mockSeparateProductsForCard(cardId: string): CardProductDTO[] | undefined {
  return MASTER_SET_SEPARATE_PRODUCTS[cardId];
}

/**
 * v1.30 (§4.29): resuelve un `productId` de TCGplayer contra los productos SEPARADOS del mock.
 * - `ok`: el productId cuelga de ESTA carta → devuelve el CardProduct (para precio/acabado).
 * - `mismatch`: el productId existe pero cuelga de OTRA carta → PRODUCT_CARD_MISMATCH (jamás
 *   fusión silenciosa con el set_base del cardId enviado).
 * - `not_found`: el productId no existe en ningún producto separado → PRODUCT_NOT_FOUND.
 */
export type SeparateProductResolution =
  | { status: 'ok'; product: CardProductDTO }
  | { status: 'mismatch' }
  | { status: 'not_found' };

export function resolveSeparateProduct(cardId: string, productId: number): SeparateProductResolution {
  const onCard = (MASTER_SET_SEPARATE_PRODUCTS[cardId] ?? []).find((p) => p.productId === productId);
  if (onCard) return { status: 'ok', product: onCard };
  const existsElsewhere = Object.values(MASTER_SET_SEPARATE_PRODUCTS).some((list) =>
    list.some((p) => p.productId === productId),
  );
  return existsElsewhere ? { status: 'mismatch' } : { status: 'not_found' };
}

// on-hand = pieza de PLATAFORMA que sigue en bóveda (contrato §M1: status NOT IN
// withdrawn/shipped/delivered/lost/damaged). reserved/in_custody/picking SÍ son on-hand.
const OFF_HAND: InventoryStatus[] = ['withdrawn', 'shipped', 'delivered', 'lost', 'damaged'];
function isOnHand(i: InventoryItemDTO): boolean {
  return i.ownerType === 'platform' && !OFF_HAND.includes(i.status);
}

// Cartas NUMERADAS del catálogo de un set (el binder es una cuadrícula por número; el
// sellado — number '' — se gestiona en la pestaña "Piezas", no en el master set).
function numberedCardsOfSet(setId: string) {
  return mockCards.filter((c) => c.setId === setId && c.number.trim() !== '');
}

// Clave de orden natural (contrato v1.16.1): números puramente numéricos por valor entero
// primero; promos/subsets con prefijo alfabético (TG/GG/SV…) AL FINAL, por prefijo + sufijo.
const PROMO_SENTINEL = 1_000_000;
function isPureNumber(n: string): boolean {
  return /^[0-9]+$/.test(n);
}
function numberSortKey(number: string): number {
  if (isPureNumber(number)) return parseInt(number, 10);
  // Promo: sentinela + sufijo numérico (agrupa por prefijo vía el comparador de abajo).
  const suffix = number.replace(/\D/g, '');
  return PROMO_SENTINEL + (suffix ? parseInt(suffix, 10) : 0);
}
function alphaPrefix(number: string): string {
  return number.replace(/[0-9]/g, '');
}
// Comparador que reproduce el ORDER BY del backend (§M1): numéricas por entero; luego promos
// agrupados por prefijo alfabético y su sufijo numérico. El front NO re-ordena por número:
// el binder confía en este orden. Se aplica una sola vez al construir la respuesta mock.
function compareNatural(a: string, b: string): number {
  const an = isPureNumber(a);
  const bn = isPureNumber(b);
  if (an && bn) return parseInt(a, 10) - parseInt(b, 10);
  if (an !== bn) return an ? -1 : 1; // numéricas antes que promos
  const pa = alphaPrefix(a);
  const pb = alphaPrefix(b);
  if (pa !== pb) return pa < pb ? -1 : 1;
  return numberSortKey(a) - numberSortKey(b);
}

// ===================================================================================
// v1.20-master-set-everywhere: el MISMO shape sirve 3 vistas, cambia el ALCANCE de la
// agregación (scope platform vs user_vault). MOCK: pendiente de backend real.
// ===================================================================================

// Pieza "en el scope": proyección mínima (cardId, finish, setId) para agregar por celda.
interface ScopePiece {
  cardId: string;
  setId: string;
  number: string;
  finish: Finish;
}

// Scope del mock (espeja MasterSetQueryScope de ARCHITECTURE §4.20a). `includeBuyable`
// SOLO en la vista (iii) del propio cliente; `owner` presente solo en user_vault.
export type MockMasterSetScope =
  | { kind: 'platform' }
  | { kind: 'user_vault'; owner: VaultOwnerRefDTO; holdings: HoldingDTO[]; includeBuyable?: boolean };

// Bóveda POR USUARIO para la vista admin (ii). u-777 (Ana) = las mismas piezas que
// mockHoldings ("mi bóveda" del cliente demo); u-778 (Bruno) = bóveda chica.
export const mockVaultHoldingsByUser: Record<string, HoldingDTO[]> = {
  'u-777': mockHoldings,
  'u-778': [
    {
      inventoryItemId: 'inv-3001',
      folio: 'INV-000301',
      card: cardById('c-pikachu'),
      productType: 'raw',
      rawCondition: 'NM',
      finish: 'normal',
      ownershipStatus: 'settled',
      status: 'in_custody',
      referenceValue: { status: 'priced', referenceMxnCents: 9500, capturedDate: '2026-08-13' },
      // v1.17-withdrawal-lifecycle (stream de retiros): settled y sin retiro activo → retirable.
      shipmentState: null,
      activeShipmentId: null,
      withdrawable: true,
    },
  ],
};

/** Dueño de la bóveda en la vista (iii) — el propio usuario, SIN email (contrato §3). */
export const mockSelfVaultOwner: VaultOwnerRefDTO = { userId: 'u-mock', name: 'Cliente Demo' };

// Piezas del scope: plataforma = mockInventory on-hand; user_vault = holdings del usuario
// que siguen "en bóveda" (status NOT IN OFF_HAND; ambas titularidades pending|settled).
function piecesOfScope(scope: MockMasterSetScope): ScopePiece[] {
  if (scope.kind === 'platform') {
    return mockInventory
      .filter(isOnHand)
      .map((i) => ({ cardId: i.card.id, setId: i.card.setId, number: i.card.number, finish: (i.finish ?? 'normal') as Finish }));
  }
  return scope.holdings
    .filter((h) => !OFF_HAND.includes(h.status))
    .map((h) => ({ cardId: h.card.id, setId: h.card.setId, number: h.card.number, finish: (h.finish ?? 'normal') as Finish }));
}

// countsByFinish de una carta en el scope (solo acabados con ≥1 pieza), en orden de acabado.
const FINISH_DISPLAY_ORDER: Finish[] = ['normal', 'reverse_holo', 'holofoil', 'first_edition_holofoil'];
function countsByFinishFor(cardId: string, pieces: ScopePiece[]): { counts: MasterSetCellCountDTO[]; total: number } {
  const byFinish = new Map<Finish, number>();
  for (const p of pieces) {
    if (p.cardId !== cardId) continue;
    byFinish.set(p.finish, (byFinish.get(p.finish) ?? 0) + 1);
  }
  const counts = FINISH_DISPLAY_ORDER.filter((f) => byFinish.has(f)).map((finish) => ({
    finish,
    count: byFinish.get(finish)!,
  }));
  const total = counts.reduce((s, c) => s + c.count, 0);
  return { counts, total };
}

/**
 * `buyable` de una variante FALTANTE (SOLO vista (iii)): la pieza `listed` de plataforma MÁS
 * BARATA de ese (cardId, finish), o null si no hay nada publicado (contrato §3 v1.20).
 */
function cheapestListedFor(cardId: string, finish: Finish): { inventoryItemId: string; salePriceCents: number } | null {
  const candidates = mockListings.filter(
    (l) => l.card.id === cardId && l.finish === finish && l.sellable && l.salePriceCents != null,
  );
  if (candidates.length === 0) return null;
  const best = candidates.reduce((a, b) => ((a.salePriceCents ?? 0) <= (b.salePriceCents ?? 0) ? a : b));
  return { inventoryItemId: best.inventoryItemId, salePriceCents: best.salePriceCents! };
}

/**
 * P-15 (v1.27): referencia de mercado POR VARIANTE (carta+acabado) para el binder mock. El
 * backend guarda UNA PriceReference por acabado; aquí se deriva un precio DISTINTO por acabado
 * a partir de la base por carta (premium de reverse/holo) para que la UI demuestre el fix P-15
 * (Normal ≠ Reverse, nunca el mismo precio pintado en todas las variantes). Cartas sin base
 * (Zapdos) → null en TODOS los acabados = pending honesto ("—").
 */
const MOCK_VARIANT_REF_FACTOR: Record<Finish, number> = {
  normal: 1,
  reverse_holo: 1.25,
  holofoil: 1.6,
  first_edition_holofoil: 2.5,
};
export function mockMarketReferenceForVariant(cardId: string, finish: Finish): number | null {
  const base = mockReferenceByCardId[cardId];
  if (base == null) return null;
  return Math.round(base * (MOCK_VARIANT_REF_FACTOR[finish] ?? 1));
}

// Variantes de una celda: EXACTAMENTE una entrada por acabado de availableFinishes (orden del
// enum Finish). Piezas con finish FUERA del universo (drift) se ven en countsByFinish pero NO
// cuentan en expected/covered. `buyable` SOLO scope cliente y SOLO cuando covered=false.
// P-15 (v1.27): cada variante trae SU marketReferenceMxnCents (+ capturedDate solo con precio).
function variantsForCell(
  cardId: string,
  availableFinishes: Finish[],
  counts: MasterSetCellCountDTO[],
  includeBuyable: boolean,
  includePricing = false,
): MasterSetVariantDTO[] {
  return FINISH_DISPLAY_ORDER.filter((f) => availableFinishes.includes(f)).map((finish) => {
    const count = counts.find((c) => c.finish === finish)?.count ?? 0;
    const covered = count > 0;
    const marketReferenceMxnCents = mockMarketReferenceForVariant(cardId, finish);
    const variant: MasterSetVariantDTO = {
      finish,
      count,
      covered,
      marketReferenceMxnCents,
      // Contrato v1.27: capturedDate presente SOLO cuando hay precio (decoración de frescura).
      ...(marketReferenceMxnCents != null ? { capturedDate: '2026-08-13' } : {}),
      // v1.28 (P-18): consola de precios SOLO en scope platform (jamás en bóvedas de cliente).
      ...(includePricing ? { pricing: mockVariantPricing(cardId, finish) } : {}),
    };
    if (includeBuyable && !covered) variant.buyable = cheapestListedFor(cardId, finish);
    return variant;
  });
}

/**
 * Índice de sets con resumen agregado (GET /admin/inventory/master-sets · scope platform,
 * GET /admin/vaults/:userId/master-sets · GET /vault/master-sets · scope user_vault).
 * v1.20: contadores por VARIANTE (universo = Card.availableFinishes) + scope/owner.
 */
export function mockMasterSetIndex(
  params: {
    q?: string;
    page?: number;
    pageSize?: number;
    sort?: MasterSetSort;
  },
  scope: MockMasterSetScope = { kind: 'platform' },
): MasterSetIndexResponse {
  const pageSize = params.pageSize ?? 20;
  const page = params.page ?? 1;
  const sort: MasterSetSort = params.sort ?? 'release_desc';
  const pieces = piecesOfScope(scope);

  let summaries: MasterSetSummaryDTO[] = mockSets.map((s) => {
    const promo = MASTER_SET_PROMO_CELLS[s.id] ?? [];
    const numbered = numberedCardsOfSet(s.id);
    const catalogCardCount = numbered.length + promo.length;
    // Universo de VARIANTES del set = Σ |availableFinishes| (promos sintéticos = 1 acabado).
    const finishesByCard = new Map<string, Finish[]>(numbered.map((c) => [c.id, c.availableFinishes]));
    for (const p of promo) finishesByCard.set(p.cardId, ['holofoil']);
    const catalogVariantCount = [...finishesByCard.values()].reduce((sum, fs) => sum + fs.length, 0);
    // Cartas y variantes distintas con ≥1 pieza del scope + total de piezas del set.
    const owned = new Set<string>();
    const ownedVariants = new Set<string>();
    let totalPieces = 0;
    for (const p of pieces) {
      if (p.setId !== s.id || p.number.trim() === '') continue;
      owned.add(p.cardId);
      totalPieces += 1;
      // Solo variantes del UNIVERSO cuentan (drift de catálogo queda fuera de covered).
      if ((finishesByCard.get(p.cardId) ?? []).includes(p.finish)) ownedVariants.add(`${p.cardId}:${p.finish}`);
    }
    const distinctCardsOwned = owned.size;
    const distinctVariantsOwned = ownedVariants.size;
    const completionPct =
      catalogCardCount === 0 ? null : Math.round((distinctCardsOwned / catalogCardCount) * 1000) / 10;
    const variantCompletionPct =
      catalogVariantCount === 0 ? null : Math.round((distinctVariantsOwned / catalogVariantCount) * 1000) / 10;
    return {
      setId: s.id,
      name: s.name,
      series: s.series,
      releaseDate: s.releaseDate,
      year: s.year,
      printedTotal: SET_PRINTED_TOTAL[s.id],
      catalogCardCount,
      distinctCardsOwned,
      completionPct,
      totalPieces,
      catalogVariantCount,
      distinctVariantsOwned,
      variantCompletionPct,
    };
  });

  // v1.33 (P-27, §4.31c): PLIEGA los subset en la fila del principal — suma todos los agregados sobre
  // las partes, recomputa completitud (→ 50) y excluye el subset como fila propia. CA-71: si el
  // principal NO está importado, el subset se queda como su propia fila (no se pliega). Se hace ANTES
  // del filtro user_vault/q/sort para que la fila combinada (una sola) fluya por el resto del pipeline.
  const bySetId = new Map(summaries.map((s) => [s.setId, s]));
  for (const g of MASTER_SET_GROUPS) {
    const primary = bySetId.get(g.primary);
    if (!primary) continue; // CA-71: principal no importado → el subset no se pliega.
    const importedSubsets = g.subsets
      .filter((su) => bySetId.has(su.setId))
      .sort((a, b) => a.order - b.order);
    if (importedSubsets.length === 0) continue;
    for (const su of importedSubsets) {
      const sub = bySetId.get(su.setId)!;
      primary.catalogCardCount += sub.catalogCardCount;
      primary.catalogVariantCount += sub.catalogVariantCount;
      primary.distinctCardsOwned += sub.distinctCardsOwned;
      primary.distinctVariantsOwned += sub.distinctVariantsOwned;
      primary.totalPieces += sub.totalPieces;
      if (primary.printedTotal != null && sub.printedTotal != null) {
        primary.printedTotal += sub.printedTotal;
      }
      bySetId.delete(su.setId);
    }
    primary.completionPct =
      primary.catalogCardCount === 0
        ? null
        : Math.round((primary.distinctCardsOwned / primary.catalogCardCount) * 1000) / 10;
    primary.variantCompletionPct =
      primary.catalogVariantCount === 0
        ? null
        : Math.round((primary.distinctVariantsOwned / primary.catalogVariantCount) * 1000) / 10;
    primary.partSetIds = [g.primary, ...importedSubsets.map((s) => s.setId)];
  }
  summaries = summaries.filter((s) => bySetId.has(s.setId));

  // En scope user_vault el índice devuelve SOLO los sets con ≥1 pieza del usuario (contrato §3).
  if (scope.kind === 'user_vault') summaries = summaries.filter((s) => s.totalPieces > 0);

  if (params.q) {
    const q = params.q.toLowerCase();
    summaries = summaries.filter((s) => s.name.toLowerCase().includes(q));
  }
  summaries.sort((a, b) => {
    if (sort === 'completion_asc') return (a.variantCompletionPct ?? 0) - (b.variantCompletionPct ?? 0);
    if (sort === 'pieces_desc') return b.totalPieces - a.totalPieces;
    // release_desc (default): más reciente primero.
    return (b.releaseDate ?? '').localeCompare(a.releaseDate ?? '');
  });

  const total = summaries.length;
  const start = (page - 1) * pageSize;
  return {
    data: summaries.slice(start, start + pageSize),
    page,
    pageSize,
    total,
    scope: scope.kind,
    ...(scope.kind === 'user_vault' ? { owner: scope.owner } : {}),
  };
}

/**
 * Binder del set (GET /admin/inventory/master-sets/:setId y equivalentes por scope).
 * Celdas en ORDEN NATURAL. v1.20: variants[] por acabado (universo = availableFinishes),
 * expected/coveredVariantCount, scope/owner, y buyable SOLO en la vista (iii).
 */
export function mockMasterSetBinder(
  requestedSetId: string,
  scope: MockMasterSetScope = { kind: 'platform' },
): MasterSetBinderResponse {
  // v1.33 (P-27, §4.31b.6): normaliza un subset a su principal (canonicalSetId) antes de resolver.
  const { canonicalId, normalized } = normalizeMasterSetId(requestedSetId);
  const setId = canonicalId;
  const set = mockSets.find((s) => s.id === setId);
  if (!set) {
    throw new ApiFixtureNotFound(`CardSet ${requestedSetId} not found`);
  }
  const pieces = piecesOfScope(scope);
  const includeBuyable = scope.kind === 'user_vault' && scope.includeBuyable === true;

  // v1.33 (P-27, §4.31b.1): resuelve las PARTES. Un master combinado hace fan-in sobre partSetIds
  // (principal + subsets importados); un set normal es una sola parte (comportamiento previo intacto).
  const group = masterGroupOfPrimary(setId);
  const partSetIds = masterPartSetIds(setId); // undefined si es de una sola parte
  const isCombined = partSetIds != null && group != null;
  const orderedPartIds = partSetIds ?? [setId];

  // Construye las celdas de UNA parte (fan-in por su set-id real; cada celda conserva su identidad).
  const cellsForPart = (partSetId: string): MasterSetCardCellDTO[] => {
    const partPrinted = SET_PRINTED_TOTAL[partSetId] ?? null;
    const catalogCells = numberedCardsOfSet(partSetId).map((c) => {
      const { counts, total } = countsByFinishFor(c.id, pieces);
      return {
        cardId: c.id,
        number: c.number,
        name: c.name,
        rarity: c.rarity || undefined,
        imageSmallUrl: c.imageSmallUrl,
        availableFinishes: c.availableFinishes,
        countsByFinish: counts,
        totalCount: total,
      };
    });
    const promoCells = (MASTER_SET_PROMO_CELLS[partSetId] ?? []).map((p) => ({
      cardId: p.cardId,
      number: p.number,
      name: p.name,
      rarity: p.rarity || undefined,
      imageSmallUrl: `${IMG}/${p.number}.png`,
      availableFinishes: ['holofoil'] as Finish[],
      countsByFinish: [] as MasterSetCellCountDTO[],
      totalCount: 0,
    }));
    // Orden natural DENTRO del bloque (el orden de bloques lo da la concatenación por parte).
    return [...catalogCells, ...promoCells]
      .sort((a, b) => compareNatural(a.number, b.number))
      .map((c) => {
        const variants = variantsForCell(
          c.cardId,
          c.availableFinishes,
          c.countsByFinish,
          includeBuyable,
          scope.kind === 'platform',
        );
        return {
          ...c,
          numberSort: numberSortKey(c.number),
          isSecretRare:
            partPrinted != null && isPureNumber(c.number) && parseInt(c.number, 10) > partPrinted,
          expectedVariantCount: variants.length,
          coveredVariantCount: variants.filter((v) => v.covered).length,
          variants,
          ...(MASTER_SET_SEPARATE_PRODUCTS[c.cardId]
            ? { separateProducts: MASTER_SET_SEPARATE_PRODUCTS[c.cardId] }
            : {}),
          marketReferenceMxnCents: variants[0]?.marketReferenceMxnCents ?? null,
          // v1.33 (P-27, §4.31b.4): en un master combinado cada celda se etiqueta con su parte REAL.
          ...(isCombined ? { partSetId, partLabel: partLabelOf(partSetId, group!) } : {}),
        };
      });
  };

  // Bloque del PRINCIPAL primero, luego cada subset en orden de parte (§4.31b.3).
  const cells: MasterSetCardCellDTO[] = orderedPartIds.flatMap(cellsForPart);

  // v1.33 (P-27, §4.31b.5): conteos = Σ de las partes.
  const printedTotal = isCombined
    ? orderedPartIds.reduce<number | null>((sum, id) => {
        const pt = SET_PRINTED_TOTAL[id];
        return sum == null || pt == null ? null : sum + pt;
      }, 0)
    : SET_PRINTED_TOTAL[setId] ?? null;

  // v1.33 (P-27, §DTOs): `parts` solo en masters combinados; una entrada por parte, en orden de bloque.
  const parts: SetPartDTO[] | undefined = isCombined
    ? orderedPartIds.map((id, idx) => ({
        setId: id,
        name: mockSets.find((s) => s.id === id)?.name ?? id,
        label: partLabelOf(id, group!),
        isPrimary: id === group!.primary,
        order: idx,
        catalogCardCount: numberedCardsOfSet(id).length + (MASTER_SET_PROMO_CELLS[id]?.length ?? 0),
      }))
    : undefined;

  return {
    set: { id: set.id, name: set.name, series: set.series, releaseDate: set.releaseDate },
    printedTotal,
    catalogCardCount: cells.length,
    cells,
    scope: scope.kind,
    ...(scope.kind === 'user_vault' ? { owner: scope.owner } : {}),
    ...(parts ? { parts } : {}),
    // canonicalSetId SOLO cuando se pidió por un subset y se normalizó al principal (§4.31b.6).
    ...(normalized ? { canonicalSetId: setId } : {}),
  };
}

/** Owner ref de un usuario para la vista admin (ii) — CON email (contrato §M1 v1.20). */
export function mockVaultOwnerOf(userId: string): VaultOwnerRefDTO {
  const u = mockAdminUsers.find((x) => x.id === userId);
  if (!u || !(userId in mockVaultHoldingsByUser)) {
    throw new ApiFixtureNotFound(`User ${userId} has no vault`);
  }
  return { userId: u.id, name: u.name, email: u.email };
}

/**
 * Lista de clientes CON bóveda (GET /admin/vaults, `vault_operator+`). Valuación con la
 * MISMA base del portafolio (§3): referencia del acabado; pendientes excluidos y contados.
 */
export function mockAdminVaults(params: {
  q?: string;
  page?: number;
  pageSize?: number;
  sort?: AdminVaultSort;
}): AdminVaultListResponse {
  const pageSize = params.pageSize ?? 20;
  const page = params.page ?? 1;
  const sort: AdminVaultSort = params.sort ?? 'value_desc';

  let rows: AdminVaultSummaryDTO[] = Object.entries(mockVaultHoldingsByUser).map(([userId, holdings]) => {
    const user = mockAdminUsers.find((u) => u.id === userId);
    const inVault = holdings.filter((h) => !OFF_HAND.includes(h.status));
    let totalValueMxnCents = 0;
    let pendingPriceCount = 0;
    for (const h of inVault) {
      if (h.referenceValue.referenceMxnCents != null) totalValueMxnCents += h.referenceValue.referenceMxnCents;
      else pendingPriceCount += 1;
    }
    return {
      userId,
      name: user?.name ?? userId,
      email: user?.email ?? '',
      pieceCount: inVault.length,
      totalValueMxnCents,
      pendingPriceCount,
    };
  });

  if (params.q) {
    const q = params.q.toLowerCase();
    rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q));
  }
  rows.sort((a, b) => {
    if (sort === 'pieces_desc') return b.pieceCount - a.pieceCount;
    if (sort === 'name_asc') return a.name.localeCompare(b.name);
    return b.totalValueMxnCents - a.totalValueMxnCents; // value_desc default
  });

  const total = rows.length;
  const start = (page - 1) * pageSize;
  return { data: rows.slice(start, start + pageSize), page, pageSize, total };
}

// Error interno del mock con el shape del contrato (404 NOT_FOUND). Se traduce a
// ApiClientError en api.ts (que sí importa ApiClientError; fixtures no debe importarlo).
export class ApiFixtureNotFound extends Error {}

// Error genérico del mock con status + errorCode del contrato (422 ITEM_NOT_ADJUSTABLE,
// 400 VALIDATION_ERROR…). api.ts lo traduce a ApiClientError.
export class ApiFixtureError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

// v1.20.1 — Idempotencia del ajuste `encontrada`: batchKey → respuesta guardada (MISMO mecanismo
// que el alta por lote / InventoryBatch M-21). Un replay NO re-crea piezas ni filas de ajuste.
const mockAdjustmentStore = new Map<string, InventoryAdjustmentResponse>();

/**
 * Ajuste de inventario por levantamiento físico (POST /admin/inventory/adjustments,
 * `vault_operator+`, auditado). Motivo OBLIGATORIO; modelo POR-PIEZA (contrato §M1 v1.20.1):
 * encontrada → CREA pieza(s) in_stock (con `batchKey?` idempotente: un replay devuelve la
 * respuesta original con idempotentReplay:true, sin re-crear); perdida|danada|error_captura →
 * status de UNA pieza existente (lost | damaged | withdrawn) con note obligatoria y SIN
 * batchKey. Solo piezas platform con status ∈ {in_stock, listed} son ajustables
 * (422 ITEM_NOT_ADJUSTABLE en el resto). Respuesta v1.20.1: `adjustmentIds` (una fila
 * InventoryAdjustment por pieza, alineada 1:1 con inventoryItemIds/folios).
 */
export function mockCreateAdjustment(req: InventoryAdjustmentRequest): InventoryAdjustmentResponse {
  if (req.reason === 'encontrada') {
    // v1.20.1 — replay idempotente por batchKey (mismo mecanismo que el alta por lote):
    // NO re-crea piezas ni filas de ajuste; devuelve la respuesta original guardada.
    if (req.batchKey) {
      const prior = mockAdjustmentStore.get(req.batchKey);
      if (prior) return { ...prior, idempotentReplay: true };
    }
    const item = req.item;
    const card = mockCards.find((c) => c.id === item.cardId);
    if (!card) throw new ApiFixtureError(404, 'NOT_FOUND', 'card not found');
    const finish = (item.finish ?? 'normal') as Finish;
    if (item.productType === 'raw' && !card.availableFinishes.includes(finish)) {
      throw new ApiFixtureError(422, 'FINISH_NOT_AVAILABLE', 'finish not available');
    }
    // acquisitionType default aportacion_en_especie → PRICE_PENDING si no hay referencia (paridad alta).
    const acq = item.acquisitionType ?? 'aportacion_en_especie';
    if (acq === 'aportacion_en_especie' && mockReferenceByCardId[item.cardId] == null) {
      throw new ApiFixtureError(422, 'PRICE_PENDING', 'no reference for aportacion');
    }
    const qty = item.productType === 'graded' ? 1 : item.qty ?? 1;
    const folios: string[] = [];
    const inventoryItemIds: string[] = [];
    const adjustmentIds: string[] = [];
    for (let k = 0; k < qty; k++) {
      const seq = String(mockInventory.length + 400 + k).padStart(6, '0');
      folios.push(`INV-${seq}`);
      inventoryItemIds.push(`inv-adj-${seq}`);
      // Una fila InventoryAdjustment POR PIEZA (M-24), alineada 1:1 con folios (v1.20.1).
      adjustmentIds.push(`adj-${seq}`);
    }
    const res: InventoryAdjustmentResponse = {
      adjustmentIds,
      reason: 'encontrada',
      inventoryItemIds,
      folios,
      fromStatus: null,
      toStatus: 'in_stock',
      idempotentReplay: false,
    };
    if (req.batchKey) mockAdjustmentStore.set(req.batchKey, res);
    return res;
  }

  if (!req.note?.trim()) throw new ApiFixtureError(400, 'VALIDATION_ERROR', 'note is required');
  const piece = mockInventory.find((i) => i.id === req.inventoryItemId);
  if (!piece) throw new ApiFixtureError(404, 'NOT_FOUND', 'inventory item not found');
  if (piece.ownerType !== 'platform' || (piece.status !== 'in_stock' && piece.status !== 'listed')) {
    throw new ApiFixtureError(422, 'ITEM_NOT_ADJUSTABLE', `status ${piece.status} not adjustable`);
  }
  const toStatus: InventoryStatus =
    req.reason === 'perdida' ? 'lost' : req.reason === 'danada' ? 'damaged' : 'withdrawn';
  const fromStatus = piece.status;
  piece.status = toStatus;
  pushMockMovement(piece.id, { fromStatus, toStatus, reason: 'adjustment', note: req.note });
  return {
    // Longitud 1 en motivos ≠ encontrada (una pieza existente → una fila de ajuste).
    adjustmentIds: [`adj-${Math.random().toString(36).slice(2, 8)}`],
    reason: req.reason,
    inventoryItemIds: [piece.id],
    folios: [piece.folio],
    fromStatus,
    toStatus,
    idempotentReplay: false,
  };
}

// Idempotencia de lote: batchKey → resultado guardado (replay sin re-crear, contrato §M1).
const mockBatchStore = new Map<string, BatchCreateInventoryResponse>();

/** Alta por LOTE (POST /admin/inventory/items/batch) — tolerante por-línea. */
export function mockBatchCreate(req: BatchCreateInventoryRequest): BatchCreateInventoryResponse {
  const prior = mockBatchStore.get(req.batchKey);
  if (prior) return { ...prior, idempotentReplay: true };

  let createdItems = 0;
  let failedLines = 0;
  const results: BatchInventoryLineResult[] = req.items.map((line, index) => {
    const card = mockCards.find((c) => c.id === line.cardId);
    // Validaciones por-línea (reflejan el backend; una línea inválida NO tumba las demás).
    if (!card) {
      failedLines += 1;
      return { index, ok: false, error: { code: 'NOT_FOUND', message: 'card not found' } };
    }
    if (line.productType === 'graded' && (line.qty ?? 1) > 1) {
      failedLines += 1;
      return { index, ok: false, error: { code: 'VALIDATION_ERROR', message: 'graded qty must be 1' } };
    }
    if (line.productType === 'graded' && !line.certNumber?.trim()) {
      failedLines += 1;
      return { index, ok: false, error: { code: 'VALIDATION_ERROR', message: 'graded requires certNumber' } };
    }
    if (line.productType === 'sealed' && line.rawCondition) {
      failedLines += 1;
      return { index, ok: false, error: { code: 'VALIDATION_ERROR', message: 'sealed has no condition' } };
    }
    const finish = (line.finish ?? 'normal') as Finish;
    if (line.productType === 'raw' && !card.availableFinishes.includes(finish)) {
      failedLines += 1;
      return { index, ok: false, error: { code: 'FINISH_NOT_AVAILABLE', message: 'finish not available' } };
    }
    // Aportación en especie sin referencia → precio pendiente (cola del dueño).
    if (line.acquisitionType === 'aportacion_en_especie' && mockReferenceByCardId[line.cardId] == null) {
      failedLines += 1;
      return { index, ok: false, error: { code: 'PRICE_PENDING', message: 'no reference for aportacion' } };
    }
    const qty = line.productType === 'graded' ? 1 : line.qty ?? 1;
    const base = mockInventory.length + createdItems + 1;
    const folios: string[] = [];
    const inventoryItemIds: string[] = [];
    for (let k = 0; k < qty; k++) {
      const seq = String(base + k).padStart(6, '0');
      folios.push(`INV-${seq}`);
      inventoryItemIds.push(`inv-batch-${seq}`);
    }
    createdItems += qty;
    return { index, ok: true, folios, inventoryItemIds };
  });

  const res: BatchCreateInventoryResponse = {
    batchKey: req.batchKey,
    idempotentReplay: false,
    summary: { requested: req.items.length, createdItems, failedLines },
    results,
  };
  mockBatchStore.set(req.batchKey, res);
  return res;
}

/** Publicar por LOTE (POST /admin/inventory/items/bulk-publish) — tolerante por-línea. */
export function mockBulkPublish(req: BulkPublishRequest): BulkPublishResponse {
  let published = 0;
  let failedLines = 0;
  const results: BulkPublishLineResult[] = req.items.map((line, index) => {
    const item = mockInventory.find((i) => i.id === line.inventoryItemId);
    if (!item) {
      failedLines += 1;
      return { index, inventoryItemId: line.inventoryItemId, ok: false, error: { code: 'NOT_FOUND', message: 'item not found' } };
    }
    if (item.ownerType !== 'platform') {
      failedLines += 1;
      return { index, inventoryItemId: line.inventoryItemId, ok: false, error: { code: 'ITEM_NOT_PUBLISHABLE', message: 'not platform inventory' } };
    }
    // Status publicable = { in_stock, listed }; cualquier otro → ITEM_NOT_PUBLISHABLE.
    if (item.status !== 'in_stock' && item.status !== 'listed') {
      failedLines += 1;
      return { index, inventoryItemId: line.inventoryItemId, ok: false, error: { code: 'ITEM_NOT_PUBLISHABLE', message: `status ${item.status} not publishable` } };
    }
    // Precio: override manual, o derivado (regla de venta + referencia del acabado).
    let salePriceCents: number | undefined;
    let priceSource: 'manual' | 'derived' = 'derived';
    if (line.listPriceCents != null) {
      salePriceCents = line.listPriceCents;
      priceSource = 'manual';
    } else if (item.productType === 'sealed') {
      // Sellado sin precio manual y sin override → no se resuelve.
      salePriceCents = item.listPriceCents;
    } else {
      const ref = mockReferenceForFinish(item.card.id, (item.finish ?? 'normal') as Finish);
      const { rule } = resolveSalesRule(item.card.rarity || '');
      if (rule.mode === 'fixed') {
        salePriceCents = ref != null ? Math.max(ref, rule.value) : rule.value;
      } else if (ref != null) {
        salePriceCents = Math.round(ref * (1 + rule.value / 100));
      }
    }
    if (salePriceCents == null) {
      failedLines += 1;
      // v1.26 (④): la variante priceless ESCALA a la cola de pendientes; el backend devuelve el id
      // de la PendingPriceEntry escalada (deep-link a M2). El mock lo simula de forma determinista.
      return {
        index,
        inventoryItemId: line.inventoryItemId,
        ok: false,
        error: { code: 'PRICE_PENDING', message: 'price could not be resolved' },
        pendingPriceEntryId: `ppe-${line.inventoryItemId}`,
      };
    }
    // in_stock → publica; listed → no-op idempotente (igual devuelve ok:true).
    const wasListed = item.status === 'listed';
    item.status = 'listed';
    if (priceSource === 'manual') item.listPriceCents = salePriceCents;
    if (!wasListed) published += 1;
    return { index, inventoryItemId: line.inventoryItemId, ok: true, status: 'listed', salePriceCents, priceSource };
  });

  return { summary: { requested: req.items.length, published, failedLines }, results };
}

export const mockAdminBuylist: AdminBuylistDTO[] = [
  {
    id: 'sr-3001',
    userId: 'u-777',
    status: 'verificacion',
    quotedTotalCents: 50200,
    createdAt: '2026-08-12T14:00:00Z',
    items: mockSellRequests[0].items,
  },
  {
    id: 'sr-3002',
    userId: 'u-778',
    status: 'recibida',
    quotedTotalCents: 1200,
    createdAt: '2026-08-13T08:00:00Z',
    items: [
      { id: 'sri-9', card: cardById('c-machamp'), productType: 'raw', rawCondition: 'NM', finish: 'normal', rarity: 'Uncommon', appliedRule: { mode: 'fixed', value: 50, source: 'rule' }, quotedPriceCents: 1200, itemStatus: 'recibida' },
    ],
  },
  // G3: solicitud en etapa `aprobada` (pestaña "Por pagar") — muestra pago SPEI/reveal y
  // convertir a inventario habilitado, sin los botones de aprobar/ajustar/rechazar (etapa previa).
  {
    id: 'sr-3003',
    userId: 'u-779',
    status: 'aprobada',
    quotedTotalCents: 30000,
    approvedTotalCents: 28000,
    createdAt: '2026-08-14T10:00:00Z',
    items: [
      { id: 'sri-appr', card: cardById('c-charizard'), productType: 'raw', rawCondition: 'NM', finish: 'holofoil', rarity: 'Rare Holo', appliedRule: { mode: 'pct', value: 40, source: 'fallback' }, quotedPriceCents: 30000, approvedPriceCents: 28000, itemStatus: 'aprobada' },
    ],
  },
];

export const mockAdminOrders: AdminOrderDTO[] = [
  { id: 'ord-9001', userId: 'u-777', status: 'settled', totalCents: 168520, createdAt: '2026-08-10T18:20:00Z', settledAt: '2026-08-10T18:22:00Z', cfdiStatus: 'registrado' },
  { id: 'ord-9002', userId: 'u-778', status: 'pending', totalCents: 58300, createdAt: '2026-08-13T09:05:00Z' },
  { id: 'ord-9003', userId: 'u-779', status: 'chargeback', totalCents: 231000, createdAt: '2026-08-09T12:00:00Z' },
];

// MOCK: evidenceContact viene de la API (contrato §7/§M8). El correo es el placeholder
// del contrato (soporte@tcgvaultmx.com, por confirmar por el humano); NO se hardcodea en la UI.
const EVIDENCE_CONTACT = 'soporte@tcgvaultmx.com';
/** Correo de soporte que devuelve el backend en el 201 de POST /disputes (contrato §7). */
export const DISPUTE_EVIDENCE_CONTACT = EVIDENCE_CONTACT;

// WS-F F6: disputas del CLIENTE (GET /disputes). Mutable: createDispute (rama mock) le hace unshift.
export const mockClientDisputes: ClientDisputeDTO[] = [
  {
    id: 'dsp-5001',
    inventoryItemId: 'inv-1002',
    type: 'condition_raw',
    status: 'en_revision',
    description: 'Corner wear on the card edge, reported after delivery.',
    deadlineAt: '2026-08-19T16:00:00Z',
    createdAt: '2026-08-12T16:00:00Z',
  },
];

export const mockDisputes: DisputeDTO[] = [
  {
    id: 'dsp-5001',
    status: 'en_revision',
    type: 'condition_raw',
    description: 'Corner wear on the card edge, reported after delivery.',
    createdAt: '2026-08-12T16:00:00Z',
    deadlineAt: '2026-08-19T16:00:00Z',
    // v1.2: la evidencia se envía por correo a soporte (sin comparador de fotos).
    evidenceContact: EVIDENCE_CONTACT,
    item: {
      inventoryItemId: 'inv-1002',
      folio: 'INV-000102',
      card: cardById('c-blastoise'),
      productType: 'raw',
    },
  },
  {
    id: 'dsp-5002',
    status: 'abierta',
    type: 'condition_sealed',
    description: 'Sealed box arrived crushed on one side.',
    createdAt: '2026-08-13T10:00:00Z',
    deadlineAt: '2026-08-20T10:00:00Z',
    evidenceContact: EVIDENCE_CONTACT,
    item: {
      inventoryItemId: 'inv-1008',
      folio: 'INV-000108',
      card: cardById('c-sealed-sv08-box'),
      productType: 'sealed',
    },
  },
];

// ---- M2: Catálogo y precios ----
/** Tipo de cambio USD→MXN con colchón (contrato GET /admin/fx). */
export let mockFx: FxDTO = {
  rate: 18.42,
  bufferPct: 3,
  source: 'banxico',
  effectiveDate: '2026-08-14',
};
export function setMockFx(next: FxDTO) {
  mockFx = next;
}

/** Cola de precio pendiente (contrato GET /admin/pricing/pending). v1.8: POR ACABADO. */
export let mockPendingPrices: PendingPriceEntryDTO[] = [
  {
    id: 'ppe-1',
    cardId: 'c-zapdos',
    productType: 'raw',
    gradeKey: 'raw:NM',
    // El pendiente es del acabado holofoil (inv-1010): el override debe reenviar ESTE finish.
    finish: 'holofoil',
    context: 'inventory',
    status: 'open',
    createdAt: '2026-08-13T06:00:00Z',
    cardName: 'Zapdos',
    card: { id: 'c-zapdos', name: 'Zapdos', number: '16', setName: 'Base Set' },
  },
  {
    id: 'ppe-2',
    cardId: 'c-machamp',
    productType: 'raw',
    gradeKey: 'raw:NM',
    finish: 'normal',
    context: 'buylist',
    status: 'open',
    createdAt: '2026-08-13T09:15:00Z',
    cardName: 'Machamp',
    card: { id: 'c-machamp', name: 'Machamp', number: '8', setName: 'Base Set' },
  },
];
export function resolveMockPending(id: string) {
  mockPendingPrices = mockPendingPrices.filter((p) => p.id !== id);
}

/**
 * Precio de buylist en DOS EJES (v1.29, §4.28d). `rarityRules` keyeadas por RAREZA CANÓNICA;
 * `finishRules` keyeadas por el enum `Finish` (acabado). Seed que preserva el negocio vigente:
 * Common/Uncommon fijo $0.50 (rareza), reverse_holo fijo $1.50 (acabado — antes la key sintética
 * "Reverse Holo"), resto = fallback 40%. `value` = centavos si mode=fixed; % [0,100] si mode=pct.
 * Sustituye el mapa plano `mockBuylistRules` que mezclaba rareza y acabado (parche INV-1 retirado).
 */
export let mockBuylistRarityRules: Record<string, BuylistRule> = {
  Common: { mode: 'fixed', value: 50 },
  Uncommon: { mode: 'fixed', value: 50 },
};
export let mockBuylistFinishRules: Partial<Record<Finish, BuylistRule>> = {
  reverse_holo: { mode: 'fixed', value: 150 },
};
export let mockBuylistFallbackPct = 40;
export function getMockBuylistRuleSet(): PriceRuleSet {
  return {
    rarityRules: mockBuylistRarityRules,
    finishRules: mockBuylistFinishRules,
    fallbackPct: mockBuylistFallbackPct,
  };
}
export function setMockBuylistRuleSet(
  rarityRules: Record<string, BuylistRule>,
  finishRules: Partial<Record<Finish, BuylistRule>>,
  fallbackPct?: number,
) {
  mockBuylistRarityRules = rarityRules;
  mockBuylistFinishRules = finishRules;
  if (fallbackPct != null) mockBuylistFallbackPct = fallbackPct;
}

/** Resuelve la regla de una rareza (eje rareza): fila explícita o fallback (pct por defecto). */
export function resolveBuylistRule(rarity: string): { rule: BuylistRule; source: 'rule' | 'fallback' } {
  const explicit = mockBuylistRarityRules[rarity];
  if (explicit) return { rule: explicit, source: 'rule' };
  return { rule: { mode: 'pct', value: mockBuylistFallbackPct }, source: 'fallback' };
}

/**
 * v1.29 (§4.28d): la resolución cruza DOS EJES con precedencia finish-rule > rarity-rule > fallback:
 * - Acabado ≠ normal con regla de acabado (finishRules[finish]) → gana esa regla.
 * - En cualquier otro caso → regla de RAREZA (o fallback).
 * El backend deriva esto server-side de (Card.rarityCanonical, finish) validado contra
 * availableFinishes (SEC-A1). Reemplaza el viejo mapeo por keys sintéticas "Holo"/"Reverse Holo".
 */
export function resolveBuylistRuleForFinish(
  rarity: string,
  finish: Finish,
): { rule: BuylistRule; source: 'rule' | 'fallback' } {
  if (finish !== 'normal') {
    const fr = mockBuylistFinishRules[finish];
    if (fr) return { rule: fr, source: 'rule' };
  }
  return resolveBuylistRule(rarity);
}

/**
 * v1.6-finish: referencia de mercado por carta+acabado. En el MVP mock usamos la misma
 * referencia base por carta para todos los acabados (el backend guarda una PriceReference
 * por acabado). `null` (Zapdos) sigue sin referencia → precio pendiente.
 */
export function mockReferenceForFinish(cardId: string, _finish: Finish): number | undefined {
  return mockReferenceByCardId[cardId] ?? undefined;
}

/**
 * Rarezas distintas del catálogo (mockCards) UNIDAS a las reglas, ordenadas por
 * cardCount desc (contrato GET /admin/pricing/rarities).
 */
export function mockBuylistRarities(): BuylistRaritiesResponse {
  const counts = new Map<string, number>();
  for (const c of mockCards) {
    if (!c.rarity) continue; // el sellado no lleva rareza
    counts.set(c.rarity, (counts.get(c.rarity) ?? 0) + 1);
  }
  // Incluir también rarezas del EJE RAREZA con regla explícita aunque no estén en el catálogo mock.
  // (Las reglas de ACABADO ya NO se cuelan aquí: viven en su propio eje — parche INV-1 retirado.)
  for (const r of Object.keys(mockBuylistRarityRules)) if (!counts.has(r)) counts.set(r, 0);
  const rarities = [...counts.entries()]
    .map(([rarity, cardCount]) => {
      const { rule, source } = resolveBuylistRule(rarity);
      // v1.29: `canonical` = key editable (mock no canonicaliza → = rarity); `premium` heurístico
      // de mock (todo lo que no es Common/Uncommon); `mapped` siempre true (viene del catálogo).
      const premium = !/^(common|uncommon)$/i.test(rarity);
      return { canonical: rarity, raw: rarity, premium, mapped: true, rarity, cardCount, rule, source };
    })
    .sort((a, b) => b.cardCount - a.cardCount);
  return { fallbackPct: mockBuylistFallbackPct, rarities };
}

/**
 * Precio de VENTA por RAREZA (v1.13-sales-pricing). Seed análogo al de buylist, pero con
 * semántica de VENTA: `fixed` = PISO en centavos MXN; `pct` = % de MARKUP ARRIBA de mercado
 * ([0,1000]) → salePrice = round(ref × (1 + value/100)). Reemplaza el markup global único
 * (salesMarkupPct, DEPRECADO). El fallback default de venta (15%) es menor que el de buylist.
 */
export let mockSalesRarityRules: Record<string, SalesRule> = {
  Common: { mode: 'fixed', value: 500 },
  Uncommon: { mode: 'fixed', value: 1000 },
};
export let mockSalesFinishRules: Partial<Record<Finish, SalesRule>> = {
  reverse_holo: { mode: 'fixed', value: 1000 },
};
export let mockSalesFallbackPct = 15;
export function getMockSalesRuleSet(): SalesPriceRuleSet {
  return {
    rarityRules: mockSalesRarityRules,
    finishRules: mockSalesFinishRules,
    fallbackPct: mockSalesFallbackPct,
  };
}
export function setMockSalesRuleSet(
  rarityRules: Record<string, SalesRule>,
  finishRules: Partial<Record<Finish, SalesRule>>,
  fallbackPct?: number,
) {
  mockSalesRarityRules = rarityRules;
  mockSalesFinishRules = finishRules;
  if (fallbackPct != null) mockSalesFallbackPct = fallbackPct;
}

/** Resuelve la regla de venta de una rareza (eje rareza): fila explícita o fallback (pct por defecto). */
export function resolveSalesRule(rarity: string): { rule: SalesRule; source: 'rule' | 'fallback' } {
  const explicit = mockSalesRarityRules[rarity];
  if (explicit) return { rule: explicit, source: 'rule' };
  return { rule: { mode: 'pct', value: mockSalesFallbackPct }, source: 'fallback' };
}

/**
 * Rarezas CANÓNICAS del catálogo (mockCards) UNIDAS a las reglas de VENTA por rareza, ordenadas por
 * cardCount desc (contrato GET /admin/pricing/sales-rarities, v1.29). Clon del de buylist.
 */
export function mockSalesRarities(): SalesRaritiesResponse {
  const counts = new Map<string, number>();
  for (const c of mockCards) {
    if (!c.rarity) continue; // el sellado no lleva rareza
    counts.set(c.rarity, (counts.get(c.rarity) ?? 0) + 1);
  }
  // Incluir también rarezas del EJE RAREZA con regla explícita aunque no estén en el catálogo mock.
  for (const r of Object.keys(mockSalesRarityRules)) if (!counts.has(r)) counts.set(r, 0);
  const rarities = [...counts.entries()]
    .map(([rarity, cardCount]) => {
      const { rule, source } = resolveSalesRule(rarity);
      const premium = !/^(common|uncommon)$/i.test(rarity);
      return { canonical: rarity, raw: rarity, premium, mapped: true, rarity, cardCount, rule, source };
    })
    .sort((a, b) => b.cardCount - a.cardCount);
  return { fallbackPct: mockSalesFallbackPct, rarities };
}

/** Sets remotos de pokemontcg.io con estado local (contrato GET /admin/catalog/remote-sets). */
export const mockRemoteSets: RemoteSetDTO[] = [
  { id: 'sv08', name: 'Surging Sparks', series: 'Scarlet & Violet', releaseDate: '2024/11/08', printedTotal: 191, imported: true, cardCount: 191 },
  { id: 'sv06', name: 'Twilight Masquerade', series: 'Scarlet & Violet', releaseDate: '2024/05/24', printedTotal: 167, imported: true, cardCount: 167 },
  { id: 'sv05', name: 'Temporal Forces', series: 'Scarlet & Violet', releaseDate: '2024/03/22', printedTotal: 162, imported: false, cardCount: 0 },
  { id: 'sv1', name: 'Scarlet & Violet', series: 'Scarlet & Violet', releaseDate: '2023/03/31', printedTotal: 198, imported: false, cardCount: 0 },
  { id: 'base1', name: 'Base Set', series: 'Base', releaseDate: '1999/01/09', printedTotal: 102, imported: true, cardCount: 102 },
];

// ---- BATCH refresh-variants-all (modelo ASÍNCRONO): estado en memoria del barrido ----
// El POST /admin/catalog/refresh-variants-all (mock) lo arranca; GET /refresh-variants-status lo
// reporta y cada lectura avanza `done` hasta completar, momento en que apaga `running` y adjunta el
// `summary` agregado. Demo money-safe: simula UN set fallido (UPSTREAM_ERROR) y pending>0.
interface MockRefreshVariantsBatch {
  running: boolean;
  jobId: string | null;
  total: number;
  done: number;
  startedAt: string | null;
  finishedAt: string | null;
  summary: RefreshVariantsSummary | null;
}
let mockRefreshVariantsBatch: MockRefreshVariantsBatch = {
  running: false,
  jobId: null,
  total: 0,
  done: 0,
  startedAt: null,
  finishedAt: null,
  summary: null,
};

/** Calcula el resumen agregado del barrido sobre los sets importados (con 1 fallo + pending). */
function computeMockRefreshVariantsSummary(): RefreshVariantsSummary {
  const imported = mockRemoteSets.filter((s) => s.imported);
  const failures =
    imported.length > 0
      ? [
          {
            setId: imported[imported.length - 1].id,
            code: 'UPSTREAM_ERROR',
            message: 'TCGCSV no respondió para este set',
          },
        ]
      : [];
  const okSets = imported.filter((s) => !failures.some((f) => f.setId === s.id));
  const cardProductsUpserted = okSets.reduce((sum, s) => sum + Math.round((s.cardCount ?? 0) * 1.4), 0);
  // Un pendiente por set OK (TCGCSV no siempre trae todos los precios) → resultado parcial honesto.
  const pending = okSets.length;
  return {
    setsTotal: imported.length,
    setsOk: okSets.length,
    setsFailed: failures.length,
    cardProductsUpserted,
    pricesUpserted: Math.max(0, cardProductsUpserted - pending),
    pending,
    failures,
  };
}

/** POST mock: arranca el barrido (202) y devuelve `{ jobId, setsQueued, remaining }`. */
export function startMockRefreshVariantsAll(): RefreshVariantsAllResponse {
  const imported = mockRemoteSets.filter((s) => s.imported);
  const jobId = `refresh-variants-all-${Math.floor(Math.random() * 9000 + 1000)}`;
  mockRefreshVariantsBatch = {
    running: true,
    jobId,
    total: imported.length,
    done: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    summary: null,
  };
  return { jobId, setsQueued: imported.length, remaining: 0 };
}

/** GET mock: avanza el barrido; al completar apaga running y adjunta el summary agregado. */
export function readMockRefreshVariantsStatus(): RefreshVariantsStatusResponse {
  const b = mockRefreshVariantsBatch;
  if (b.running) {
    // Avanza el progreso; cuando alcanza el total, termina y publica el resumen.
    const nextDone = Math.min(b.total, b.done + Math.max(1, Math.ceil(b.total / 3)));
    if (nextDone >= b.total) {
      mockRefreshVariantsBatch = {
        ...b,
        running: false,
        done: b.total,
        finishedAt: new Date().toISOString(),
        summary: computeMockRefreshVariantsSummary(),
      };
    } else {
      mockRefreshVariantsBatch = { ...b, done: nextDone };
    }
  }
  return { ...mockRefreshVariantsBatch };
}

/** Historial de precios por fecha/fuente (contrato GET /admin/pricing/card/:id). SUPUESTO de shape. */
export function mockPriceHistory(cardId: string): PriceHistoryEntryDTO[] {
  const ref = mockReferenceByCardId[cardId] ?? 100000;
  return [
    { capturedDate: '2026-08-13', source: 'pokemontcg_io', gradeKey: 'raw:NM', productType: 'raw', priceMxnCents: ref, isManualOverride: false },
    { capturedDate: '2026-08-12', source: 'pokemontcg_io', gradeKey: 'raw:NM', productType: 'raw', priceMxnCents: Math.round(ref * 0.98), isManualOverride: false },
    { capturedDate: '2026-08-11', source: 'manual', gradeKey: 'raw:NM', productType: 'raw', priceMxnCents: Math.round(ref * 0.95), isManualOverride: true },
  ];
}

// ---- M6: Usuarios / KYC ----
export const mockAdminUsers: AdminUserSummaryDTO[] = [
  { id: 'u-777', email: 'ana@example.com', name: 'Ana López', role: 'customer', status: 'active', createdAt: '2026-08-01T10:00:00Z' },
  { id: 'u-778', email: 'bruno@example.com', name: 'Bruno Díaz', role: 'customer', status: 'active', createdAt: '2026-08-05T14:30:00Z' },
  { id: 'u-779', email: 'caro@example.com', name: 'Caro Ruiz', role: 'customer', status: 'blocked', createdAt: '2026-08-08T09:12:00Z' },
  { id: 'u-op1', email: 'operador@tcgvaultmx.com', name: 'Operador Bóveda', role: 'vault_operator', status: 'active', createdAt: '2026-07-20T08:00:00Z' },
];

export function mockAdminUserDetail(id: string): AdminUserDetailDTO {
  const base = mockAdminUsers.find((u) => u.id === id) ?? mockAdminUsers[0];
  return {
    ...base,
    locale: 'es',
    authProvider: id === 'u-778' ? 'google' : 'local',
    kycProfile: {
      kycStatus: base.status === 'blocked' ? 'rejected' : id === 'u-777' ? 'verified' : 'none',
      clabeMasked: id === 'u-777' ? '****1234' : undefined,
      rfcMasked: id === 'u-777' ? 'XAX**********' : undefined,
      ineOnFile: id === 'u-777',
      capPerRequestCents: 300000,
      capPerMonthCents: 1000000,
      monthUsedCents: id === 'u-777' ? 120000 : 0,
    },
    billingProfile:
      id === 'u-777'
        ? { rfcMasked: 'XAX**********', razonSocial: 'Ana López', regimenFiscal: '626', usoCfdi: 'G03', postalCode: '06700', email: 'ana@example.com' }
        : null,
    addresses:
      id === 'u-777'
        ? [{ id: 'addr-1', line1: 'Av. Reforma 100', city: 'CDMX', state: 'CDMX', postalCode: '06600', country: 'MX', phone: '5555555555', isDefault: true }]
        : [],
    orders: base.id === 'u-777' ? mockOrders : [],
    sellRequests:
      base.id === 'u-777'
        ? [{ id: 'sr-3001', status: 'verificacion', quotedTotalCents: 50200, createdAt: '2026-08-12T14:00:00Z' }]
        : [],
    disputes:
      base.id === 'u-777'
        ? [{ id: 'dsp-5001', status: 'en_revision', type: 'condition_raw', createdAt: '2026-08-12T16:00:00Z' }]
        : [],
    // v1.8-ronda-c (BE-10): la proyección de bóveda trae productType + finish + referenceValue
    // (por-acabado). Se incluyen un item con precio (priced) y otro sin precio del día (pending)
    // para ejercer ambos renders en preview/tests.
    ownedItems:
      base.id === 'u-777'
        ? [
            {
              inventoryItemId: 'inv-1002',
              folio: 'INV-000102',
              card: cardById('c-blastoise'),
              productType: 'raw',
              finish: 'holofoil',
              ownershipStatus: 'settled',
              referenceValue: { status: 'priced', referenceMxnCents: 128000, source: 'pokemontcg_io', capturedDate: '2026-08-13' },
            },
            {
              inventoryItemId: 'inv-1003',
              folio: 'INV-000103',
              card: cardById('c-pikachu'),
              productType: 'raw',
              finish: 'reverse_holo',
              ownershipStatus: 'pending',
              referenceValue: { status: 'pending' },
            },
          ]
        : [],
  };
}

// ---- M6 · Historial 360° por usuario (v1.7-admin-users) ----
// MOCK: pendiente de backend real. Los listados admin se filtran por userId (simetría
// con GET /admin/orders?userId=). Shipments/Disputes de fixtures no llevan userId en su
// DTO (proyección del contrato), así que el mock los asocia por convención a u-777.
export function mockUserShipments(userId: string): ShipmentDTO[] {
  return userId === 'u-777' ? mockShipments : [];
}
export function mockUserDisputes(userId: string): DisputeDTO[] {
  return userId === 'u-777' ? mockDisputes : [];
}

// MOCK: traza de AuditLog de/sobre el usuario (GET /admin/users/:id/audit). El `ip` se
// puebla como lo haría la proyección de super_admin; el DTO NUNCA lleva before/after.
export function mockUserAudit(userId: string): UserAuditEntryDTO[] {
  return [
    { id: `ua-${userId}-1`, actorUserId: 'u-admin', actorRole: 'super_admin', action: 'user.create', entityType: 'User', entityId: userId, createdAt: '2026-08-01T10:00:00Z', ip: '187.190.10.4' },
    { id: `ua-${userId}-2`, actorUserId: 'u-admin', actorRole: 'super_admin', action: 'user.kyc.update', entityType: 'User', entityId: userId, createdAt: '2026-08-10T12:00:00Z', ip: '187.190.10.4' },
    { id: `ua-${userId}-3`, actorUserId: 'u-op1', actorRole: 'vault_operator', action: 'user.status.update', entityType: 'User', entityId: userId, createdAt: '2026-08-11T09:30:00Z', ip: '201.150.22.9' },
    { id: `ua-${userId}-4`, actorUserId: userId, actorRole: 'customer', action: 'auth.email_verification_sent', entityType: 'User', entityId: userId, createdAt: '2026-08-11T09:00:00Z' },
  ];
}

// ---- M10: Config y bitácora ----
export let mockSettings: SettingsDTO = {
  shippingFeeCents: 17500,
  aportacionPct: 70,
  ivaPct: 16,
  salesMarkupPct: 10,
  stripeFeePct: 3.6,
  stripeFeeFixedCents: 300,
  stripeFeeIvaPct: 0.16,
  buylistCapPerRequestCents: 300000,
  buylistCapPerMonthCents: 1000000,
  ineThresholdCents: 300000,
  repoCapPerCardCents: 5000000,
  fxBufferPct: 3,
  fxManualOverrideRate: undefined,
  pricingProviderRaw: 'pokemontcg_io',
  pricingProviderGraded: 'pokemonpricetracker',
  pricingProviderSealed: 'manual',
  // v1.14-price-ingest: proveedor de la ingesta masiva. Seed recomendado por contrato §M10.
  priceProvider: 'pokemontcg_io',
  catalogSyncFromDate: '2024/01/01',
};
export function setMockSettings(patch: Partial<SettingsDTO>) {
  mockSettings = { ...mockSettings, ...patch };
}

export const mockAuditLog: AuditLogDTO[] = [
  { id: 'al-1', actorUserId: 'u-admin', actorRole: 'super_admin', action: 'settings.update', entityType: 'ConfigSetting', entityId: 'shipping_fee_cents', createdAt: '2026-08-14T12:00:00Z' },
  { id: 'al-2', actorUserId: 'u-admin', actorRole: 'super_admin', action: 'order.refund', entityType: 'Order', entityId: 'ord-9003', createdAt: '2026-08-13T18:30:00Z' },
  { id: 'al-3', actorUserId: 'u-admin', actorRole: 'super_admin', action: 'buylist.pay_spei', entityType: 'SellRequest', entityId: 'sr-2990', createdAt: '2026-08-13T11:10:00Z' },
  { id: 'al-4', actorUserId: 'u-op1', actorRole: 'vault_operator', action: 'inventory.mark_damaged', entityType: 'InventoryItem', entityId: 'inv-1050', createdAt: '2026-08-12T15:45:00Z' },
  { id: 'al-5', actorUserId: 'u-admin', actorRole: 'super_admin', action: 'catalog.sync', entityType: 'CardSet', entityId: 'sv05', createdAt: '2026-08-12T09:00:00Z' },
  { id: 'al-6', actorUserId: 'u-admin', actorRole: 'super_admin', action: 'buylist.reveal_clabe', entityType: 'SellRequest', entityId: 'sr-2990', createdAt: '2026-08-11T16:20:00Z' },
];

// ---- M7: Finanzas ----
// P&L (v1.4-finance): incomeCents + shippingRevenueCents − cogsCents − stripeFeesCents − shippingCostCents = profitCents.
export const mockPnl: PnlDTO = {
  incomeCents: 1_250_000,
  shippingRevenueCents: 52_500,
  cogsCents: 640_000,
  stripeFeesCents: 48_300,
  shippingCostCents: 31_800,
  profitCents: 1_250_000 + 52_500 - 640_000 - 48_300 - 31_800,
};

// v1.28 (P-24): breakdown por tipo — campos top-level = Σ del breakdown (invariante del contrato).
export const mockInventoryValue: InventoryValueDTO = {
  atReferenceCents: 8_430_000,
  atCostCents: 5_901_000,
  pendingPriceCount: 3,
  breakdown: {
    raw: { atReferenceCents: 4_850_000, atCostCents: 3_395_000, pieceCount: 3, pendingPriceCount: 2 },
    sealed: { atReferenceCents: 320_000, atCostCents: 256_000, pieceCount: 1, pendingPriceCount: 1 },
    graded: { atReferenceCents: 3_260_000, atCostCents: 2_250_000, pieceCount: 1, pendingPriceCount: 0 },
  },
};

export const mockCustodyValue: CustodyValueDTO = {
  totalCustodyValueCents: 4_120_000,
};

export const mockIvaReport: IvaReportDTO = {
  ivaCollectedCents: 200_000,
  byOrder: [
    { orderId: 'ord-9001', ivaCents: 84_800, settledAt: '2026-08-13T18:30:00Z' },
    { orderId: 'ord-9002', ivaCents: 22_528, settledAt: '2026-08-12T10:05:00Z' },
    { orderId: 'ord-9003', ivaCents: 92_672, settledAt: '2026-08-10T14:40:00Z' },
  ],
};

// ---- M9: Reportes ----
// goals = null hasta que el humano fije las metas N/X/Y/Z (contrato §M9).
export const mockLaunchMetrics: LaunchMetricsDTO = {
  users: 42,
  salesSettled: 17,
  buylistPaid: 9,
  withdrawalsNoDispute: 6,
  goals: { N: 100, X: 50, Y: 25, Z: 20 },
};

/** MOCK: genera un CSV determinista por tipo de reporte (comparte export de M7/M9). */
export function mockCsv(report: 'pnl' | 'iva' | 'inventory'): string {
  if (report === 'iva') {
    const rows = mockIvaReport.byOrder
      .map((o) => `${o.orderId},${o.ivaCents},${o.settledAt ?? ''}`)
      .join('\n');
    return `orderId,ivaCents,settledAt\n${rows}\n`;
  }
  if (report === 'inventory') {
    return `metric,valueCents\natReferenceCents,${mockInventoryValue.atReferenceCents}\natCostCents,${mockInventoryValue.atCostCents}\npendingPriceCount,${mockInventoryValue.pendingPriceCount}\n`;
  }
  return `metric,valueCents\nincomeCents,${mockPnl.incomeCents}\nshippingRevenueCents,${mockPnl.shippingRevenueCents}\ncogsCents,${mockPnl.cogsCents}\nstripeFeesCents,${mockPnl.stripeFeesCents}\nshippingCostCents,${mockPnl.shippingCostCents}\nprofitCents,${mockPnl.profitCents}\n`;
}

// ============================================================================
// v1.23-sealed-sales: sellado / producto cerrado (contrato §2-S, §3, §M1, §M2).
// MOCK: pendiente de backend real. Respeta los shapes SealedGroupDTO / VaultSealedResponse /
// SealedSpreadsDTO del contrato. El grid agrupa piezas idénticas (producto TCGCSV + condición)
// → "N disponibles"; el precio se resuelve server-side (override > mercado×spread > pending).
// ============================================================================

const SEALED_BOX = cardById('c-sealed-sv08-box');
const SEALED_ETB = cardById('c-sealed-sv06-etb');

export const mockSealedGroups: SealedGroupDTO[] = [
  {
    representativeItemId: 'inv-1008',
    card: SEALED_BOX,
    productName: SEALED_BOX.name,
    imageUrl: SEALED_BOX.imageSmallUrl,
    sealedSubtype: 'box',
    sealedCondition: 'mint',
    availableCount: 4,
    fromPriceCents: 320000,
    priceSource: 'subtype_spread',
    referenceValue: { status: 'priced', referenceMxnCents: 305000, source: 'tcgcsv', capturedDate: '2026-08-13' },
    currency: 'MXN',
  },
  {
    representativeItemId: 'inv-1009',
    card: SEALED_ETB,
    productName: SEALED_ETB.name,
    imageUrl: SEALED_ETB.imageSmallUrl,
    sealedSubtype: 'etb',
    sealedCondition: 'mint',
    availableCount: 7,
    fromPriceCents: 105000,
    priceSource: 'subtype_spread',
    referenceValue: { status: 'priced', referenceMxnCents: 98000, source: 'tcgcsv', capturedDate: '2026-08-12' },
    currency: 'MXN',
  },
  {
    // Grupo "Detalle menor en caja" — se vende por override (sin mercado TCGCSV) → referencia pending.
    representativeItemId: 'inv-1020',
    card: SEALED_BOX,
    productName: SEALED_BOX.name,
    imageUrl: SEALED_BOX.imageSmallUrl,
    sealedSubtype: 'box',
    sealedCondition: 'minor_box_damage',
    availableCount: 2,
    fromPriceCents: 298000,
    priceSource: 'override',
    referenceValue: { status: 'pending' },
    currency: 'MXN',
  },
];

/** Construye las N piezas (ListingDTO) de un grupo, más baratas primero (para la ficha). */
function sealedListingsForGroup(group: SealedGroupDTO): ListingDTO[] {
  return Array.from({ length: group.availableCount }).map((_, i) => ({
    inventoryItemId: i === 0 ? group.representativeItemId : `${group.representativeItemId}-p${i + 1}`,
    card: group.card,
    productType: 'sealed' as const,
    sealedSubtype: group.sealedSubtype ?? undefined,
    sealedCondition: group.sealedCondition,
    finish: 'normal' as const,
    referenceValue: group.referenceValue,
    // Precios ascendentes desde fromPriceCents (mock de dispersión de precio dentro del grupo).
    salePriceCents: group.fromPriceCents + i * 500,
    sellable: true,
  }));
}

/** Ficha de un producto sellado por inventoryItemId (representativo del grupo). */
export function mockSealedGroupDetail(inventoryItemId: string): SealedGroupDetailResponse {
  const group =
    mockSealedGroups.find((g) => g.representativeItemId === inventoryItemId) ??
    mockSealedGroups.find((g) => sealedListingsForGroup(g).some((l) => l.inventoryItemId === inventoryItemId));
  if (!group) {
    throw new ApiFixtureNotFound('Sealed product not found');
  }
  return {
    group,
    listings: sealedListingsForGroup(group),
    // Feature-flags (§M10): en el mock la tendencia va ENCENDIDA (hay serie TCGCSV) y el
    // "avísame cuando vuelva" APAGADO (fail-closed, seed `off`) para ejercitar ambos caminos.
    trendEnabled: true,
    restockEnabled: false,
  };
}

/** Pestaña "Sellado" de MI bóveda (GET /vault/sealed). El demo u-777 tiene 1 box en bóveda. */
export const mockVaultSealed: VaultSealedResponse = {
  data: [
    {
      card: SEALED_BOX,
      productName: SEALED_BOX.name,
      imageUrl: SEALED_BOX.imageSmallUrl,
      sealedSubtype: 'box',
      sealedCondition: 'mint',
      count: 1,
      ownership: { pending: 0, settled: 1 },
      marketValue: { status: 'priced', referenceMxnCents: 305000, source: 'tcgcsv', capturedDate: '2026-08-13' },
      totalMarketValueMxnCents: 305000,
    },
    {
      card: SEALED_ETB,
      productName: SEALED_ETB.name,
      imageUrl: SEALED_ETB.imageSmallUrl,
      sealedSubtype: 'etb',
      sealedCondition: 'mint',
      count: 2,
      ownership: { pending: 1, settled: 1 },
      // Sin mercado (no mapeado): se excluye del total y cuenta en pendingPriceCount.
      marketValue: { status: 'pending' },
      totalMarketValueMxnCents: null,
    },
  ],
  totalValueMxnCents: 305000,
  pendingPriceCount: 2,
  currency: 'MXN',
};

/** Vista admin de la bóveda sellada de un cliente (GET /admin/vaults/:userId/sealed). */
export function mockAdminVaultSealed(userId: string): VaultSealedResponse {
  const u = mockAdminUsers.find((x) => x.id === userId);
  const owner: VaultOwnerRefDTO = { userId, name: u?.name ?? userId, email: u?.email };
  if (userId === 'u-777') {
    return { ...mockVaultSealed, owner };
  }
  return { data: [], totalValueMxnCents: 0, pendingPriceCount: 0, currency: 'MXN', owner };
}

/** Spreads de VENTA del sellado por presentación + fallback (GET/PUT /admin/pricing/sealed-spreads). */
export const mockSealedSpreads: SealedSpreadsDTO = {
  spreadPctBySubtype: { box: 12, etb: 15, bundle: 15, tin: 20, blister: 0 },
  fallbackPct: 15,
};

export function setMockSealedSpreads(
  spreadPctBySubtype: Partial<Record<SealedSubtype, number>>,
  fallbackPct: number,
): void {
  mockSealedSpreads.spreadPctBySubtype = { ...spreadPctBySubtype };
  mockSealedSpreads.fallbackPct = fallbackPct;
}

// ============================================================================
// v1.28 Stream B (P-17/P-18/P-19/P-20/P-22/P-24/P-25) — Inventario M1 operable.
// MOCK: pendiente de backend real. Respeta los shapes del contrato v1.28:
// VariantPricingDTO / VariantControls / PublishAll / SealedSets / GradedInventory / Bounties.
// ============================================================================

/** Fila mock de VariantPriceOverride (M-30), clave (cardId|productType|gradeKey|finish). */
export interface MockVariantControlsRow {
  sellOverrideCents: number | null;
  buyOverrideCents: number | null;
  bountyEnabled: boolean;
  bountyPriceCents: number | null;
  bountyTargetQty: number | null;
  bountyAcquiredQty: number;
  bountyCompletedAt: string | null;
}

export const variantControlsKey = (
  cardId: string,
  productType: 'raw' | 'graded',
  gradeKey: string,
  finish: Finish,
) => `${cardId}|${productType}|${gradeKey}|${finish}`;

/** Store en memoria de controles por variante. Seed: un bounty activo (vitrina Top Bounties). */
export const mockVariantControlsStore = new Map<string, MockVariantControlsRow>([
  [
    variantControlsKey('c-pikachu-ir', 'raw', 'raw:NM', 'holofoil'),
    {
      sellOverrideCents: null,
      buyOverrideCents: null,
      bountyEnabled: true,
      bountyPriceCents: 250_000,
      bountyTargetQty: 3,
      bountyAcquiredQty: 1,
      bountyCompletedAt: null,
    },
  ],
  [
    variantControlsKey('c-latias-sir', 'raw', 'raw:NM', 'holofoil'),
    {
      sellOverrideCents: null,
      buyOverrideCents: null,
      bountyEnabled: true,
      bountyPriceCents: 480_000,
      bountyTargetQty: null,
      bountyAcquiredQty: 0,
      bountyCompletedAt: null,
    },
  ],
]);

/** Sugerido de COMPRA por regla (buylist rules sobre la referencia del acabado). */
function suggestedBuyFor(
  cardId: string,
  finish: Finish,
): { cents: number | null; source: 'rule' | 'fallback' } {
  const card = mockCards.find((c) => c.id === cardId);
  if (!card) return { cents: null, source: 'fallback' };
  const { rule, source } = resolveBuylistRuleForFinish(card.rarity || '', finish);
  if (rule.mode === 'fixed') return { cents: rule.value, source };
  const ref = mockMarketReferenceForVariant(cardId, finish);
  return { cents: ref != null ? Math.round((ref * rule.value) / 100) : null, source };
}

/** Sugerido de VENTA por regla (sales rules: fixed=piso; pct=markup sobre mercado). */
function suggestedSellFor(
  cardId: string,
  finish: Finish,
): { cents: number | null; source: 'rule' | 'fallback' } {
  const card = mockCards.find((c) => c.id === cardId);
  if (!card) return { cents: null, source: 'fallback' };
  const { rule, source } = resolveSalesRule(card.rarity || '');
  const ref = mockMarketReferenceForVariant(cardId, finish);
  if (rule.mode === 'fixed') return { cents: ref != null ? Math.max(ref, rule.value) : rule.value, source };
  return { cents: ref != null ? Math.round(ref * (1 + rule.value / 100)) : null, source };
}

/**
 * VariantPricingDTO resuelto con la precedencia normativa (ARCHITECTURE §4.26b):
 * COMPRA bounty > override > regla > pending · VENTA override > regla > pending.
 * `bounty` viene SOLO si existe fila de controles (paridad con el contrato).
 */
export function mockVariantPricing(
  cardId: string,
  finish: Finish,
  productType: 'raw' | 'graded' = 'raw',
  gradeKey = 'raw:NM',
): import('@/types/contract').VariantPricingDTO {
  const row = mockVariantControlsStore.get(variantControlsKey(cardId, productType, gradeKey, finish));
  const buySuggested = suggestedBuyFor(cardId, finish);
  const sellSuggested = suggestedSellFor(cardId, finish);

  const buy: import('@/types/contract').VariantPricingDTO['buy'] = (() => {
    if (row?.bountyEnabled && row.bountyPriceCents != null && row.bountyPriceCents > 0) {
      return {
        suggestedCents: buySuggested.cents,
        overrideCents: row.buyOverrideCents,
        effectiveCents: row.bountyPriceCents,
        source: 'bounty' as const,
      };
    }
    if (row?.buyOverrideCents != null) {
      return {
        suggestedCents: buySuggested.cents,
        overrideCents: row.buyOverrideCents,
        effectiveCents: row.buyOverrideCents,
        source: 'override' as const,
      };
    }
    return {
      suggestedCents: buySuggested.cents,
      overrideCents: null,
      effectiveCents: buySuggested.cents,
      source: buySuggested.cents != null ? buySuggested.source : ('pending' as const),
    };
  })();

  const sell: import('@/types/contract').VariantPricingDTO['sell'] = (() => {
    if (row?.sellOverrideCents != null) {
      return {
        suggestedCents: sellSuggested.cents,
        overrideCents: row.sellOverrideCents,
        effectiveCents: row.sellOverrideCents,
        source: 'override' as const,
      };
    }
    return {
      suggestedCents: sellSuggested.cents,
      overrideCents: null,
      effectiveCents: sellSuggested.cents,
      source: sellSuggested.cents != null ? sellSuggested.source : ('pending' as const),
    };
  })();

  return {
    buy,
    sell,
    ...(row
      ? {
          bounty: {
            enabled: row.bountyEnabled,
            priceCents: row.bountyPriceCents,
            targetQty: row.bountyTargetQty,
            acquiredQty: row.bountyAcquiredQty,
            completedAt: row.bountyCompletedAt,
          },
        }
      : {}),
  };
}

/** Upsert mock de controles (PUT variant-controls) — las validaciones viven en lib/api.ts. */
export function mockUpsertVariantControls(
  cardId: string,
  finish: Finish,
  req: import('@/types/contract').VariantControlsRequest,
): import('@/types/contract').VariantControlsResponse {
  const productType = req.productType ?? 'raw';
  const gradeKey = req.gradeKey ?? (productType === 'graded' ? 'graded:PSA:10' : 'raw:NM');
  const key = variantControlsKey(cardId, productType, gradeKey, finish);
  const row: MockVariantControlsRow = mockVariantControlsStore.get(key) ?? {
    sellOverrideCents: null,
    buyOverrideCents: null,
    bountyEnabled: false,
    bountyPriceCents: null,
    bountyTargetQty: null,
    bountyAcquiredQty: 0,
    bountyCompletedAt: null,
  };
  // Campos omitidos NO se tocan; `null` explícito LIMPIA (contrato v1.28).
  if ('sellOverrideCents' in req) row.sellOverrideCents = req.sellOverrideCents ?? null;
  if ('buyOverrideCents' in req) row.buyOverrideCents = req.buyOverrideCents ?? null;
  if ('bounty' in req) {
    if (req.bounty === null) {
      row.bountyEnabled = false; // apagar NO borra el contador.
    } else if (req.bounty) {
      row.bountyEnabled = req.bounty.enabled;
      if (req.bounty.priceCents !== undefined) row.bountyPriceCents = req.bounty.priceCents;
      if (req.bounty.targetQty !== undefined) row.bountyTargetQty = req.bounty.targetQty;
    }
  }
  mockVariantControlsStore.set(key, row);
  return { cardId, productType, gradeKey, finish, pricing: mockVariantPricing(cardId, finish, productType, gradeKey) };
}

/** Sugerido de compra por regla (expuesto para las validaciones BOUNTY_BELOW_RULE de lib/api.ts). */
export function mockSuggestedBuyCents(cardId: string, finish: Finish): number | null {
  return suggestedBuyFor(cardId, finish).cents;
}

/** GET /buylist/bounties — bounties ACTIVOS, orden precio desc, cap 50 (solo raw NM). */
export function mockPublicBounties(): import('@/types/contract').PublicBountiesResponse {
  const data: import('@/types/contract').PublicBountyDTO[] = [];
  for (const [key, row] of mockVariantControlsStore) {
    if (!row.bountyEnabled || row.bountyPriceCents == null || row.bountyPriceCents <= 0) continue;
    const [cardId, productType, , finish] = key.split('|');
    if (productType !== 'raw') continue;
    const card = mockCards.find((c) => c.id === cardId);
    if (!card) continue;
    const remaining =
      row.bountyTargetQty != null ? Math.max(0, row.bountyTargetQty - row.bountyAcquiredQty) : null;
    data.push({
      cardId: card.id,
      name: card.name,
      number: card.number,
      setName: card.setName,
      imageSmallUrl: card.imageSmallUrl,
      rarity: card.rarity || undefined,
      finish: finish as Finish,
      bountyPriceCents: row.bountyPriceCents,
      targetQty: row.bountyTargetQty,
      remainingQty: remaining,
    });
  }
  data.sort((a, b) => b.bountyPriceCents - a.bountyPriceCents);
  return { data: data.slice(0, 50) };
}

// ---- P-19: publicar todo (POST /admin/inventory/publish-all) ----
const publishAllStore = new Map<string, import('@/types/contract').PublishAllResponse>();

export function mockPublishAll(
  req: import('@/types/contract').PublishAllRequest,
): import('@/types/contract').PublishAllResponse {
  if (req.batchKey) {
    const prior = publishAllStore.get(req.batchKey);
    if (prior) return { ...prior, idempotentReplay: true };
  }
  // Selección server-side: platform + in_stock (± setId / productType).
  const selectedItems = mockInventory.filter(
    (i) =>
      i.ownerType === 'platform' &&
      i.status === 'in_stock' &&
      (!req.setId || i.card.setId === req.setId) &&
      (!req.productType || i.productType === req.productType),
  );
  const alreadyListed = mockInventory.filter(
    (i) =>
      i.ownerType === 'platform' &&
      i.status === 'listed' &&
      (!req.setId || i.card.setId === req.setId) &&
      (!req.productType || i.productType === req.productType),
  ).length;
  let published = 0;
  let pendingPrice = 0;
  let failed = 0;
  const failures: import('@/types/contract').PublishAllFailureDTO[] = [];
  for (const item of selectedItems) {
    // Pipeline por-pieza idéntico a bulk-publish (mock): resuelve precio o escala pendiente.
    const res = mockBulkPublish({ items: [{ inventoryItemId: item.id }] }).results[0];
    if (res.ok) {
      published += 1;
    } else if (res.error.code === 'PRICE_PENDING') {
      pendingPrice += 1;
      if (failures.length < 200) {
        failures.push({
          inventoryItemId: item.id,
          folio: item.folio,
          error: res.error,
          pendingPriceEntryId: res.pendingPriceEntryId,
        });
      }
    } else {
      failed += 1;
      if (failures.length < 200) {
        failures.push({ inventoryItemId: item.id, folio: item.folio, error: res.error });
      }
    }
  }
  const out: import('@/types/contract').PublishAllResponse = {
    batchKey: req.batchKey,
    idempotentReplay: false,
    summary: {
      selected: selectedItems.length + alreadyListed,
      published,
      alreadyListed,
      pendingPrice,
      failed,
    },
    failures,
  };
  if (req.batchKey) publishAllStore.set(req.batchKey, out);
  return out;
}

// ---- P-25: pestaña «Sellado» por set ----
/** Piezas selladas de plataforma agrupadas por set (índice) y por identidad §4.23 (detalle). */
function sealedPlatformPieces(): InventoryItemDTO[] {
  return mockInventory.filter((i) => i.ownerType === 'platform' && i.productType === 'sealed');
}

/** Mapeo TCGCSV mock: cardId ancla → productId (null = no mapeado, cae a la cola). */
const MOCK_SEALED_MAPPING: Record<string, number | null> = {
  'c-sealed-sv08-box': 23966,
  'c-sealed-sv06-etb': null,
};

export function mockSealedSets(params: {
  q?: string;
  page?: number;
  pageSize?: number;
}): import('@/types/contract').SealedSetsResponse {
  const pageSize = params.pageSize ?? 20;
  const page = params.page ?? 1;
  const pieces = sealedPlatformPieces();
  const bySet = new Map<string, InventoryItemDTO[]>();
  for (const p of pieces) {
    const arr = bySet.get(p.card.setId) ?? [];
    arr.push(p);
    bySet.set(p.card.setId, arr);
  }
  let data = [...bySet.entries()].map(([setId, items]) => {
    const set = mockSets.find((s) => s.id === setId);
    const mapped = items.filter((i) => MOCK_SEALED_MAPPING[i.card.id] != null);
    const unmapped = items.length - mapped.length;
    const marketValue = mapped.reduce(
      (sum, i) => sum + (i.referenceValue?.referenceMxnCents ?? 0),
      0,
    );
    return {
      set: { id: setId, name: set?.name ?? setId, series: set?.series, releaseDate: set?.releaseDate },
      pieceCount: items.length,
      listedCount: items.filter((i) => i.status === 'listed').length,
      unmappedCount: unmapped,
      marketValueMxnCents: mapped.length > 0 ? marketValue : null,
    };
  });
  if (params.q) {
    const q = params.q.toLowerCase();
    data = data.filter((s) => s.set.name.toLowerCase().includes(q));
  }
  const unmappedTotal = pieces.filter((i) => MOCK_SEALED_MAPPING[i.card.id] == null).length;
  const total = data.length;
  const start = (page - 1) * pageSize;
  return { data: data.slice(start, start + pageSize), page, pageSize, total, unmappedTotal };
}

export function mockSealedSetDetail(setId: string): import('@/types/contract').SealedSetDetailResponse {
  const set = mockSets.find((s) => s.id === setId);
  if (!set) throw new ApiFixtureNotFound(`CardSet ${setId} not found`);
  const pieces = sealedPlatformPieces().filter((i) => i.card.setId === setId);
  // Identidad de grupo §4.23: (cardId ancla, sealedSubtype, tcgplayerProductId, sealedCondition).
  const byGroup = new Map<string, InventoryItemDTO[]>();
  for (const p of pieces) {
    const key = `${p.card.id}|${p.sealedSubtype ?? ''}|${p.sealedCondition ?? 'mint'}`;
    const arr = byGroup.get(key) ?? [];
    arr.push(p);
    byGroup.set(key, arr);
  }
  const groups = [...byGroup.values()].map((items) => {
    const first = items[0];
    const productId = MOCK_SEALED_MAPPING[first.card.id] ?? null;
    const mapped = productId != null;
    const costs = items
      .map((i) => i.acquisitionCostCents)
      .filter((c): c is number => c != null);
    return {
      cardId: first.card.id,
      productName: first.card.name,
      sealedSubtype: first.sealedSubtype ?? null,
      sealedCondition: first.sealedCondition ?? ('mint' as const),
      tcgplayerProductId: productId,
      mapped,
      counts: {
        inStock: items.filter((i) => i.status === 'in_stock').length,
        listed: items.filter((i) => i.status === 'listed').length,
        other: items.filter((i) => i.status !== 'in_stock' && i.status !== 'listed').length,
      },
      ...(mapped && first.referenceValue ? { sealedMarketRef: first.referenceValue } : {}),
      totalCostCents: costs.length > 0 ? costs.reduce((a, b) => a + b, 0) : null,
    };
  });
  return {
    set: { id: set.id, name: set.name, series: set.series, releaseDate: set.releaseDate },
    groups,
  };
}

// ---- P-20: pestaña «Gradeadas» ----
/** Valor de mercado por carta+grado (PriceReference graded, típicamente MANUAL vía override M2). */
export const mockGradedMarketRefs = new Map<string, { cents: number; capturedDate: string }>([
  ['c-charizard|PSA|9', { cents: 3_260_000, capturedDate: '2026-08-13' }],
]);

export function setMockGradedMarketRef(
  cardId: string,
  company: string,
  grade: string,
  cents: number,
): void {
  mockGradedMarketRefs.set(`${cardId}|${company}|${grade}`, {
    cents,
    capturedDate: new Date().toISOString().slice(0, 10),
  });
}

export function mockGradedInventory(params: {
  q?: string;
  page?: number;
  pageSize?: number;
}): import('@/types/contract').GradedInventoryResponse {
  const pageSize = params.pageSize ?? 20;
  const page = params.page ?? 1;
  const pieces = mockInventory.filter(
    (i) => i.ownerType === 'platform' && i.productType === 'graded',
  );
  const byGroup = new Map<string, InventoryItemDTO[]>();
  for (const p of pieces) {
    const key = `${p.card.id}|${p.gradingCompany ?? ''}|${p.gradeValue ?? ''}`;
    const arr = byGroup.get(key) ?? [];
    arr.push(p);
    byGroup.set(key, arr);
  }
  let data = [...byGroup.values()].map((items) => {
    const first = items[0];
    const refKey = `${first.card.id}|${first.gradingCompany}|${first.gradeValue}`;
    const ref = mockGradedMarketRefs.get(refKey);
    const costs = items.map((i) => i.acquisitionCostCents).filter((c): c is number => c != null);
    return {
      cardId: first.card.id,
      card: {
        name: first.card.name,
        number: first.card.number,
        setName: first.card.setName,
        imageSmallUrl: first.card.imageSmallUrl,
      },
      gradingCompany: first.gradingCompany!,
      gradeValue: first.gradeValue ?? '',
      count: items.length,
      marketReferenceMxnCents: ref?.cents ?? null,
      ...(ref ? { capturedDate: ref.capturedDate } : {}),
      totalCostCents: costs.length > 0 ? costs.reduce((a, b) => a + b, 0) : null,
    };
  });
  if (params.q) {
    const q = params.q.toLowerCase();
    data = data.filter((g) => g.card.name.toLowerCase().includes(q));
  }
  const total = data.length;
  const start = (page - 1) * pageSize;
  return { data: data.slice(start, start + pageSize), page, pageSize, total };
}

/** Tendencia de valor de mercado de un producto sellado (misma forma que SetValueHistoryResponse). */
export function generateSealedValueHistory(range: SetValueRange): SetValueHistoryResponse {
  const base = generateFeaturedSetValueHistory(range);
  // Escala a un rango de "una caja" (~MX$3,050) para que la gráfica se lea como un producto, no un set.
  const scale = 305000 / 131920000;
  return {
    set: { id: 'sealed:tcg:sv08-box', name: SEALED_BOX.name },
    range: base.range,
    points: base.points.map((p) => ({
      date: p.date,
      valueMxnCents: Math.round(p.valueMxnCents * scale),
      pricedCardCount: 1,
    })),
    change: base.change,
  };
}

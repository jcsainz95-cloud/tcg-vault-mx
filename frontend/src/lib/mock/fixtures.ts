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
  CardSetDTO,
  Finish,
  ListingDTO,
  HoldingDTO,
  OrderSummaryDTO,
  OrderDetailDTO,
  SellRequestDTO,
  DashboardDTO,
  InventoryItemDTO,
  VaultLocationDTO,
  AdminBuylistDTO,
  AdminOrderDTO,
  DisputeDTO,
  ShipmentDTO,
  CatalogFacetsDTO,
  PortfolioHistoryResponse,
  PortfolioPointDTO,
  PortfolioRange,
  KycInfoDTO,
  FxDTO,
  PendingPriceEntryDTO,
  RarityMapEntryDTO,
  BuylistRule,
  BuylistRaritiesResponse,
  RemoteSetDTO,
  PriceHistoryEntryDTO,
  AdminUserSummaryDTO,
  AdminUserDetailDTO,
  SettingsDTO,
  AuditLogDTO,
  PnlDTO,
  InventoryValueDTO,
  CustodyValueDTO,
  IvaReportDTO,
  LaunchMetricsDTO,
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
  { id: 'swsh1', name: 'Sword & Shield', series: 'Sword & Shield', releaseDate: '2020/02/07', year: 2020 },
  { id: 'base1', name: 'Base Set', series: 'Base', releaseDate: '1999/01/09', year: 1999 },
].map((s) => ({ ...s, year: yearOf(s.releaseDate) }));

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
] as CardDTO[]).map((c) => ({ ...c, availableFinishes: CARD_FINISHES[c.id] ?? ['normal'] }));

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
];

/** KYC del comprador (contrato GET /users/me/kyc). CLABE enmascarada; INE aún no en archivo. */
export const mockKyc: KycInfoDTO = {
  kycStatus: 'none',
  clabeMasked: undefined,
  ineOnFile: false,
  capPerRequestCents: 300000, // MOCK: dial M10 default (MX$3,000).
  capPerMonthCents: 1000000, // MOCK: dial M10 default (MX$10,000).
  monthUsedCents: 0,
};

export const mockShipments: ShipmentDTO[] = [
  {
    id: 'shp-7001',
    status: 'enviado',
    carrier: 'Estafeta',
    trackingNumber: '1234567890',
    createdAt: '2026-08-11T10:00:00Z',
    items: [{ inventoryItemId: 'inv-1002', folio: 'INV-000102', card: cardById('c-blastoise') }],
  },
];

// ---- Admin ----
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
];

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
];

export const mockAdminOrders: AdminOrderDTO[] = [
  { id: 'ord-9001', userId: 'u-777', status: 'settled', totalCents: 168520, createdAt: '2026-08-10T18:20:00Z', settledAt: '2026-08-10T18:22:00Z', cfdiStatus: 'registrado' },
  { id: 'ord-9002', userId: 'u-778', status: 'pending', totalCents: 58300, createdAt: '2026-08-13T09:05:00Z' },
  { id: 'ord-9003', userId: 'u-779', status: 'chargeback', totalCents: 231000, createdAt: '2026-08-09T12:00:00Z' },
];

// MOCK: evidenceContact viene de la API (contrato §7/§M8). El correo es el placeholder
// del contrato (soporte@tcgvaultmx.com, por confirmar por el humano); NO se hardcodea en la UI.
const EVIDENCE_CONTACT = 'soporte@tcgvaultmx.com';

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

/** Cola de precio pendiente (contrato GET /admin/pricing/pending). */
export let mockPendingPrices: PendingPriceEntryDTO[] = [
  {
    id: 'ppe-1',
    cardId: 'c-zapdos',
    productType: 'raw',
    gradeKey: 'raw:NM',
    context: 'inventory',
    status: 'open',
    createdAt: '2026-08-13T06:00:00Z',
    cardName: 'Zapdos',
  },
  {
    id: 'ppe-2',
    cardId: 'c-machamp',
    productType: 'raw',
    gradeKey: 'raw:NM',
    context: 'buylist',
    status: 'open',
    createdAt: '2026-08-13T09:15:00Z',
    cardName: 'Machamp',
  },
];
export function resolveMockPending(id: string) {
  mockPendingPrices = mockPendingPrices.filter((p) => p.id !== id);
}

/** Tabla rareza→categoría del buylist (DEPRECADO v1.3.1; legacy). */
export let mockRarityMap: RarityMapEntryDTO[] = [
  { rarity: 'Common', category: 'comun' },
  { rarity: 'Uncommon', category: 'comun' },
  { rarity: 'Reverse Holo', category: 'reverse_holo' },
  { rarity: 'Rare Holo', category: 'ex_plus' },
  { rarity: 'Ultra Rare', category: 'ex_plus' },
  { rarity: 'Illustration Rare', category: 'ex_plus' },
  { rarity: 'Special Illustration Rare', category: 'ex_plus' },
];
export function setMockRarityMap(entries: RarityMapEntryDTO[]) {
  mockRarityMap = entries;
}

/**
 * Precio de buylist por RAREZA (v1.3.1). Seed que preserva el comportamiento vigente:
 * Common/Uncommon fijo $0.50, Reverse Holo fijo $1.50, resto = fallback 40% de la
 * referencia. `value` = centavos si mode=fixed; porcentaje [0,100] si mode=pct.
 */
export let mockBuylistRules: Record<string, BuylistRule> = {
  Common: { mode: 'fixed', value: 50 },
  Uncommon: { mode: 'fixed', value: 50 },
  'Reverse Holo': { mode: 'fixed', value: 150 },
};
export let mockBuylistFallbackPct = 40;
export function setMockBuylistRules(rules: Record<string, BuylistRule>, fallbackPct?: number) {
  mockBuylistRules = rules;
  if (fallbackPct != null) mockBuylistFallbackPct = fallbackPct;
}

/** Resuelve la regla de una rareza: fila explícita o fallback (pct por defecto). */
export function resolveBuylistRule(rarity: string): { rule: BuylistRule; source: 'rule' | 'fallback' } {
  const explicit = mockBuylistRules[rarity];
  if (explicit) return { rule: explicit, source: 'rule' };
  return { rule: { mode: 'pct', value: mockBuylistFallbackPct }, source: 'fallback' };
}

/**
 * v1.6-finish: el ACABADO selecciona qué regla de rareza aplica (ARCHITECTURE §4.2.1):
 * - reverse_holo → regla "Reverse Holo".
 * - holofoil / first_edition_holofoil → rareza base si ya es holo (rarity contiene "holo"), si no "Holo".
 * - normal → rareza base.
 * El backend deriva esto server-side de (Card.rarity, finish) validado contra availableFinishes (SEC-A1).
 */
export function resolveBuylistRuleForFinish(
  rarity: string,
  finish: Finish,
): { rule: BuylistRule; source: 'rule' | 'fallback' } {
  let ruleKey = rarity;
  if (finish === 'reverse_holo') ruleKey = 'Reverse Holo';
  else if (finish === 'holofoil' || finish === 'first_edition_holofoil') {
    ruleKey = /holo/i.test(rarity) ? rarity : 'Holo';
  }
  return resolveBuylistRule(ruleKey);
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
  // Incluir también rarezas con regla explícita aunque no estén en el catálogo mock.
  for (const r of Object.keys(mockBuylistRules)) if (!counts.has(r)) counts.set(r, 0);
  const rarities = [...counts.entries()]
    .map(([rarity, cardCount]) => {
      const { rule, source } = resolveBuylistRule(rarity);
      return { rarity, cardCount, rule, source };
    })
    .sort((a, b) => b.cardCount - a.cardCount);
  return { fallbackPct: mockBuylistFallbackPct, rarities };
}

/** Sets remotos de pokemontcg.io con estado local (contrato GET /admin/catalog/remote-sets). */
export const mockRemoteSets: RemoteSetDTO[] = [
  { id: 'sv08', name: 'Surging Sparks', series: 'Scarlet & Violet', releaseDate: '2024/11/08', printedTotal: 191, imported: true, cardCount: 191 },
  { id: 'sv06', name: 'Twilight Masquerade', series: 'Scarlet & Violet', releaseDate: '2024/05/24', printedTotal: 167, imported: true, cardCount: 167 },
  { id: 'sv05', name: 'Temporal Forces', series: 'Scarlet & Violet', releaseDate: '2024/03/22', printedTotal: 162, imported: false, cardCount: 0 },
  { id: 'sv1', name: 'Scarlet & Violet', series: 'Scarlet & Violet', releaseDate: '2023/03/31', printedTotal: 198, imported: false, cardCount: 0 },
  { id: 'base1', name: 'Base Set', series: 'Base', releaseDate: '1999/01/09', printedTotal: 102, imported: true, cardCount: 102 },
];

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
    ownedItems:
      base.id === 'u-777'
        ? [{ inventoryItemId: 'inv-1002', folio: 'INV-000102', card: cardById('c-blastoise'), ownershipStatus: 'settled' }]
        : [],
  };
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

export const mockInventoryValue: InventoryValueDTO = {
  atReferenceCents: 8_430_000,
  atCostCents: 5_901_000,
  pendingPriceCount: 3,
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

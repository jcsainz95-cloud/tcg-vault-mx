/**
 * MOCK: pendiente de backend real.
 * Fixtures que respetan los shapes de docs/API_CONTRACT.md. Los nombres de
 * cartas y sets están en inglés (datos de catálogo NO se traducen, por diseño).
 */
import type {
  CardDTO,
  CardSetDTO,
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
} from '@/types/contract';

const IMG = 'https://images.pokemontcg.io/base1';

export const mockSets: CardSetDTO[] = [
  { id: 'base1', name: 'Base Set', series: 'Base', releaseDate: '1999-01-09' },
  { id: 'swsh1', name: 'Sword & Shield', series: 'Sword & Shield', releaseDate: '2020-02-07' },
  { id: 'sv1', name: 'Scarlet & Violet', series: 'Scarlet & Violet', releaseDate: '2023-03-31' },
];

function card(
  id: string,
  name: string,
  number: string,
  rarity: string,
  setId: string,
  setName: string,
  supertype = 'Pokémon',
  subtypes: string[] = ['Basic'],
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
    imageSmallUrl: `${IMG}/${number}.png`,
    imageLargeUrl: `${IMG}/${number}_hires.png`,
  };
}

export const mockCards: CardDTO[] = [
  card('c-charizard', 'Charizard', '4', 'Rare Holo', 'base1', 'Base Set', 'Pokémon', ['Stage 2']),
  card('c-blastoise', 'Blastoise', '2', 'Rare Holo', 'base1', 'Base Set', 'Pokémon', ['Stage 2']),
  card('c-pikachu', 'Pikachu', '58', 'Common', 'base1', 'Base Set'),
  card('c-zapdos', 'Zapdos', '16', 'Rare Holo', 'base1', 'Base Set'),
  card('c-mewtwo', 'Mewtwo', '10', 'Rare Holo', 'base1', 'Base Set', 'Pokémon', ['Stage 1']),
  card('c-eevee', 'Eevee', '51', 'Common', 'base1', 'Base Set'),
  card('c-gyarados', 'Gyarados', '6', 'Rare Holo', 'base1', 'Base Set', 'Pokémon', ['Stage 1']),
  card('c-machamp', 'Machamp', '8', 'Rare Holo', 'base1', 'Base Set', 'Pokémon', ['Stage 2']),
];

const cardById = (id: string) => mockCards.find((c) => c.id === id)!;

export const mockListings: ListingDTO[] = [
  {
    inventoryItemId: 'inv-1001',
    card: cardById('c-charizard'),
    productType: 'graded',
    gradingCompany: 'PSA',
    gradeValue: '9',
    referenceValue: { status: 'priced', referenceMxnCents: 4850000, source: 'pokemonpricetracker', capturedDate: '2026-08-13' },
    salePriceCents: 5335000,
    sellable: true,
    frontPhotoUrl: `${IMG}/4_hires.png`,
  },
  {
    inventoryItemId: 'inv-1002',
    card: cardById('c-blastoise'),
    productType: 'raw',
    rawCondition: 'NM',
    referenceValue: { status: 'priced', referenceMxnCents: 128000, source: 'pokemontcg_io', capturedDate: '2026-08-13' },
    salePriceCents: 140800,
    sellable: true,
    frontPhotoUrl: `${IMG}/2_hires.png`,
    backPhotoUrl: `${IMG}/2.png`,
  },
  {
    inventoryItemId: 'inv-1003',
    card: cardById('c-pikachu'),
    productType: 'raw',
    rawCondition: 'LP',
    referenceValue: { status: 'priced', referenceMxnCents: 9500, source: 'pokemontcg_io', capturedDate: '2026-08-13' },
    salePriceCents: 10450,
    sellable: true,
    frontPhotoUrl: `${IMG}/58_hires.png`,
  },
  {
    inventoryItemId: 'inv-1004',
    card: cardById('c-zapdos'),
    productType: 'raw',
    rawCondition: 'MP',
    // Precio pendiente: no vendible (regla de confianza, nunca $0).
    referenceValue: { status: 'pending' },
    sellable: false,
    frontPhotoUrl: `${IMG}/16_hires.png`,
  },
  {
    inventoryItemId: 'inv-1005',
    card: cardById('c-mewtwo'),
    productType: 'sealed',
    referenceValue: { status: 'priced', referenceMxnCents: 78000, source: 'poketrace', capturedDate: '2026-08-12' },
    salePriceCents: 85800,
    sellable: true,
    frontPhotoUrl: `${IMG}/10_hires.png`,
  },
  {
    inventoryItemId: 'inv-1006',
    card: cardById('c-gyarados'),
    productType: 'graded',
    gradingCompany: 'CGC',
    gradeValue: '9.5',
    referenceValue: { status: 'priced', referenceMxnCents: 210000, source: 'pokemonpricetracker', capturedDate: '2026-08-13' },
    salePriceCents: 231000,
    sellable: true,
    frontPhotoUrl: `${IMG}/6_hires.png`,
  },
  {
    inventoryItemId: 'inv-1007',
    card: cardById('c-machamp'),
    productType: 'raw',
    rawCondition: 'NM',
    referenceValue: { status: 'priced', referenceMxnCents: 45000, source: 'pokemontcg_io', capturedDate: '2026-08-13' },
    salePriceCents: 49500,
    sellable: true,
    frontPhotoUrl: `${IMG}/8_hires.png`,
  },
  {
    inventoryItemId: 'inv-1008',
    card: cardById('c-eevee'),
    productType: 'raw',
    rawCondition: 'NM',
    referenceValue: { status: 'priced', referenceMxnCents: 22000, source: 'pokemontcg_io', capturedDate: '2026-08-13' },
    salePriceCents: 24200,
    sellable: true,
    frontPhotoUrl: `${IMG}/51_hires.png`,
  },
];

export const mockHoldings: HoldingDTO[] = [
  {
    inventoryItemId: 'inv-1002',
    folio: 'INV-000102',
    card: cardById('c-blastoise'),
    productType: 'raw',
    rawCondition: 'NM',
    ownershipStatus: 'settled',
    status: 'in_custody',
    referenceValue: { status: 'priced', referenceMxnCents: 128000, capturedDate: '2026-08-13' },
    frontPhotoUrl: `${IMG}/2_hires.png`,
  },
  {
    inventoryItemId: 'inv-1006',
    folio: 'INV-000106',
    card: cardById('c-gyarados'),
    productType: 'graded',
    gradingCompany: 'CGC',
    gradeValue: '9.5',
    ownershipStatus: 'pending',
    status: 'in_custody',
    referenceValue: { status: 'priced', referenceMxnCents: 210000, capturedDate: '2026-08-13' },
    frontPhotoUrl: `${IMG}/6_hires.png`,
  },
  {
    inventoryItemId: 'inv-1004',
    folio: 'INV-000104',
    card: cardById('c-zapdos'),
    productType: 'raw',
    rawCondition: 'MP',
    ownershipStatus: 'settled',
    status: 'in_custody',
    referenceValue: { status: 'pending' },
    frontPhotoUrl: `${IMG}/16_hires.png`,
  },
];

export const mockPortfolio = {
  totalValueMxnCents: 338000,
  pendingPriceCount: 1,
  currency: 'MXN' as const,
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
      { id: 'sri-1', card: cardById('c-charizard'), productType: 'raw', rawCondition: 'LP', category: 'ex_plus', quotedPriceCents: 50000, itemStatus: 'verificacion' },
      { id: 'sri-2', card: cardById('c-pikachu'), productType: 'raw', rawCondition: 'NM', category: 'comun', quotedPriceCents: 50, itemStatus: 'recibida' },
      { id: 'sri-3', card: cardById('c-eevee'), productType: 'raw', rawCondition: 'NM', category: 'reverse_holo', quotedPriceCents: 150, itemStatus: 'recibida' },
    ],
  },
];

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
    gradingCompany: 'PSA',
    gradeValue: '9',
    status: 'listed',
    ownerType: 'platform',
    location: { id: 'loc-1', label: 'C03-F02-S15', zone: 'platform_stock' },
    referenceValue: { status: 'priced', referenceMxnCents: 4850000, capturedDate: '2026-08-13' },
    listPriceCents: 5335000,
    acquisitionType: 'aportacion_en_especie',
    acquisitionCostCents: 3395000,
    frontPhotoUrl: `${IMG}/4_hires.png`,
  },
  {
    id: 'inv-1004',
    folio: 'INV-000104',
    card: cardById('c-zapdos'),
    productType: 'raw',
    rawCondition: 'MP',
    status: 'in_stock',
    ownerType: 'platform',
    location: { id: 'loc-2', label: 'C03-F02-S16', zone: 'platform_stock' },
    referenceValue: { status: 'pending' },
    acquisitionType: 'compra',
    frontPhotoUrl: `${IMG}/16_hires.png`,
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
      { id: 'sri-9', card: cardById('c-machamp'), productType: 'raw', rawCondition: 'NM', category: 'ex_plus', quotedPriceCents: 1200, itemStatus: 'recibida' },
    ],
  },
];

export const mockAdminOrders: AdminOrderDTO[] = [
  { id: 'ord-9001', userId: 'u-777', status: 'settled', totalCents: 168520, createdAt: '2026-08-10T18:20:00Z', settledAt: '2026-08-10T18:22:00Z', cfdiStatus: 'registrado' },
  { id: 'ord-9002', userId: 'u-778', status: 'pending', totalCents: 58300, createdAt: '2026-08-13T09:05:00Z' },
  { id: 'ord-9003', userId: 'u-779', status: 'chargeback', totalCents: 231000, createdAt: '2026-08-09T12:00:00Z' },
];

export const mockDisputes: DisputeDTO[] = [
  {
    id: 'dsp-5001',
    status: 'en_revision',
    description: 'Corner wear not shown in ingress photos.',
    createdAt: '2026-08-12T16:00:00Z',
    deadlineAt: '2026-08-19T16:00:00Z',
    ingressPhotoUrls: [`${IMG}/2_hires.png`, `${IMG}/2.png`],
    claimPhotoUrls: [`${IMG}/6_hires.png`],
    item: { inventoryItemId: 'inv-1002', folio: 'INV-000102', card: cardById('c-blastoise') },
  },
];

/**
 * §AC (FRONTEND_NOTES §107) — constructores de DTOs del contrato `API_CONTRACT §AC` (v1.86 + errata
 * v1.86.1) para las pruebas de accesorios. Son FORMAS del contrato, no cifras calculadas: todo importe
 * es un literal de prueba que la pantalla debe pintar tal cual (⛔ la pantalla no suma ni multiplica).
 */
import type {
  AccessoryCardDTO,
  AccessoryDetailDTO,
  AdminAccessoryDTO,
  EnergyBundleDTO,
  GuestCheckoutQuoteResponse,
  QuoteAccessoryLineDTO,
  ShipAccessoryLineDTO,
} from '@/types/contract';

export const photo = (id: string) => ({
  url: `https://api.test/api/v1/accessories/${id}/photo/abcdef0123456789/full`,
  thumbUrl: `https://api.test/api/v1/accessories/${id}/photo/abcdef0123456789/thumb`,
});

export function accCard(over: Partial<AccessoryCardDTO> & Pick<AccessoryCardDTO, 'id' | 'name'>): AccessoryCardDTO {
  return {
    category: 'sleeves',
    energyType: null,
    priceCents: 8900,
    soldOut: false,
    photo: photo(over.id),
    ...over,
  };
}

export function accDetail(
  over: Partial<AccessoryDetailDTO> & Pick<AccessoryDetailDTO, 'id' | 'name'>,
): AccessoryDetailDTO {
  return { ...accCard(over), description: null, maxQty: 5, ...over };
}

export function quoteLine(
  over: Partial<QuoteAccessoryLineDTO> & Pick<QuoteAccessoryLineDTO, 'accessoryId' | 'name'>,
): QuoteAccessoryLineDTO {
  return {
    category: 'sleeves',
    energyType: null,
    unitPriceCents: 8900,
    quantity: 1,
    lineTotalCents: 8900,
    photo: photo(over.accessoryId),
    ...over,
  };
}

export function bundle(over: Partial<EnergyBundleDTO> = {}): EnergyBundleDTO {
  return {
    deckSlug: 'dragapult-ex',
    deckName: 'Dragapult ex',
    priceCents: 2000,
    looseTotalCents: 6000,
    energies: [
      { energyType: 'fire', quantity: 8, accessoryId: 'acc-fire', photo: photo('acc-fire') },
      { energyType: 'water', quantity: 4, accessoryId: 'acc-water', photo: photo('acc-water') },
    ],
    ...over,
  };
}

/** Desglose literal (forma de `BreakdownDTO`); las cifras son de prueba, no se derivan. */
export function breakdownOf(subtotalCents: number, shippingFeeCents: number | undefined, totalCents: number) {
  return {
    subtotalCents,
    ...(shippingFeeCents !== undefined ? { shippingFeeCents } : {}),
    ivaCents: 1228,
    ivaRatePct: 16,
    processingFeeCents: 400,
    totalCents,
    currency: 'MXN' as const,
    priceConvention: 'IVA_INCLUSIVE' as const,
    ivaIncluded: true,
  };
}

/** Una cotización de invitado con lo mínimo de §4-G.1 + las llaves aditivas de §AC.4. */
export function guestQuote(over: Partial<GuestCheckoutQuoteResponse> = {}): GuestCheckoutQuoteResponse {
  return {
    items: [],
    fulfillmentMode: 'direct_ship',
    breakdown: breakdownOf(8900, 17500, 27100),
    vaultBreakdown: breakdownOf(8900, undefined, 9300),
    notices: { finalSale: true, invoiceByEmail: true, termsRequired: true },
    unavailableItems: [],
    accessoryLines: [],
    energyBundles: [],
    energyBundleOffers: [],
    unavailableAccessories: [],
    unavailableBundles: [],
    shippingBox: null,
    vaultExcludesAccessories: false,
    ...over,
  } as GuestCheckoutQuoteResponse;
}

export function adminAcc(over: Partial<AdminAccessoryDTO> & Pick<AdminAccessoryDTO, 'id' | 'name'>): AdminAccessoryDTO {
  return {
    description: null,
    category: 'sleeves',
    energyType: null,
    lengthMm: 90,
    widthMm: 70,
    heightMm: 20,
    weightG: 120,
    priceCents: 8900,
    unitCostCents: 4000,
    stockQty: 20,
    reservedQty: 0,
    availableQty: 20,
    active: false,
    suggested: false,
    photo: photo(over.id),
    hasSales: false,
    createdAt: '2026-10-07T12:00:00.000Z',
    updatedAt: '2026-10-07T12:00:00.000Z',
    ...over,
  };
}

export function shipAccLine(
  over: Partial<ShipAccessoryLineDTO> & Pick<ShipAccessoryLineDTO, 'id' | 'name'>,
): ShipAccessoryLineDTO {
  return {
    kind: 'accessory',
    photo: photo(over.id),
    quantity: 1,
    deckName: null,
    components: [],
    prepStatus: 'pending',
    missingQty: 0,
    missingReason: null,
    settledWithoutStock: false,
    refunded: false,
    refund: { kind: 'refundable', amountByQtyCents: [9300], amountCents: 9300 },
    deckShipmentItemIds: [],
    deckAllMissing: false,
    ...over,
  };
}

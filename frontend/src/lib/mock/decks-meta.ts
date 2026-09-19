/**
 * Fixtures de DECKS META (§13) para el modo MOCK (demo / Playwright / fallback sin backend).
 *
 * ⚠️ La suite UNITARIA no usa esto: espía las funciones de `@/lib/api` directamente (patrón de
 * `CardDetailView.test`). Estas fixtures existen para que el modo mock (config.useMocks) sirva una
 * vista completa —legal, agotada, rotada y no identificada— sin backend, y para el smoke E2E.
 *
 * Construido contra el CONTRATO §13, no contra un backend corriendo (el backend de Fase 1 va en
 * paralelo). Cero dinero derivado en cliente: los precios son cifras planas de fixture.
 */
import type {
  DecksMetaListResponse,
  DeckMetaDetailResponse,
  DeckMetaPasteResponse,
  MetaDeckGroupsDTO,
  MetaDeckLineDTO,
} from '@/types/contract';

const IMG = 'https://images.pokemontcg.io/sv1/1_hires.png';

/** Línea CASADA, LEGAL y disponible (trae piezas para el «de jalón»). */
function legalLine(over: Partial<MetaDeckLineDTO> & Pick<MetaDeckLineDTO, 'rawName' | 'setCode' | 'number' | 'quantity' | 'group'>): MetaDeckLineDTO {
  return {
    matchStatus: 'matched',
    card: { cardId: `card-${over.setCode}-${over.number}`, name: over.rawName, imageUrl: IMG },
    legal: true,
    availableQty: over.quantity,
    unitPriceMxnCents: 61500,
    unitInventoryItemIds: Array.from({ length: over.availableQty ?? over.quantity }, (_, i) => `inv-${over.setCode}-${over.number}-${i}`),
    ...over,
  };
}

/** Grupos de un deck de ejemplo: una de cada estado (legal, agotada, rotada, no identificada). */
function sampleGroups(): MetaDeckGroupsDTO {
  return {
    pokemon: [
      legalLine({ rawName: 'Dragapult ex', setCode: 'TWM', number: '130', quantity: 3, group: 'pokemon' }),
      // AGOTADA: legal pero sin stock (availableQty 0, sin piezas, sin precio).
      legalLine({
        rawName: 'Drakloak',
        setCode: 'TWM',
        number: '129',
        quantity: 2,
        group: 'pokemon',
        availableQty: 0,
        unitPriceMxnCents: null,
        unitInventoryItemIds: [],
      }),
      // ROTADA / no legal: no puede agregarse a jugar (con sustituto legal, Fase 3).
      {
        rawName: 'Comfey',
        setCode: 'LOR',
        number: '79',
        quantity: 1,
        group: 'pokemon',
        matchStatus: 'matched',
        card: { cardId: 'card-LOR-79', name: 'Comfey', imageUrl: IMG },
        legal: false,
        availableQty: 0,
        unitPriceMxnCents: null,
        unitInventoryItemIds: [],
        substitute: {
          cardId: 'card-SVI-99',
          name: 'Comfey',
          setCode: 'SVI',
          number: '99',
          availableQty: 1,
          unitPriceMxnCents: 4200,
          unitInventoryItemIds: ['inv-SVI-99-0'],
        },
      },
    ],
    trainer: [
      legalLine({ rawName: "Boss's Orders", setCode: 'PAL', number: '172', quantity: 2, group: 'trainer' }),
      // NO IDENTIFICADA: no casó por set (sin card, sin precio, sin piezas).
      {
        rawName: 'Iono',
        setCode: 'ZZZ',
        number: '999',
        quantity: 3,
        group: 'trainer',
        matchStatus: 'unmatched_set',
        card: null,
        legal: false,
        availableQty: 0,
        unitPriceMxnCents: null,
        unitInventoryItemIds: [],
      },
    ],
    energy: [
      // Energía básica: siempre legal, se marca (no se inventa pieza).
      {
        rawName: 'Basic Fire Energy',
        setCode: '',
        number: '',
        quantity: 8,
        group: 'energy',
        matchStatus: 'unmatched_basic_energy',
        card: null,
        legal: true,
        availableQty: 0,
        unitPriceMxnCents: null,
        unitInventoryItemIds: [],
      },
    ],
  };
}

export const mockDecksMetaList: DecksMetaListResponse = {
  data: [
    { slug: 'dragapult-ex', name: 'Dragapult ex', rank: 1, sharePct: 12.4, trend: 1, fromPriceMxnCents: 184500, availableCount: 52, totalCount: 60, imageUrl: IMG },
    { slug: 'charizard-ex', name: 'Charizard ex', rank: 2, sharePct: 10.1, trend: -1, fromPriceMxnCents: 210000, availableCount: 48, totalCount: 60, imageUrl: IMG },
    { slug: 'raging-bolt-ex', name: 'Raging Bolt ex', rank: 3, sharePct: 8.7, trend: 0, fromPriceMxnCents: 156000, availableCount: 41, totalCount: 60, imageUrl: IMG },
  ],
  updatedAt: '2026-09-14T12:00:00Z',
  source: 'Datos de Limitless TCG',
};

export function mockDeckMetaDetail(slug: string): DeckMetaDetailResponse {
  const summary = mockDecksMetaList.data.find((d) => d.slug === slug) ?? mockDecksMetaList.data[0];
  return {
    slug: summary.slug,
    name: summary.name,
    rank: summary.rank,
    sharePct: summary.sharePct,
    trend: summary.trend,
    source: 'Datos de Limitless TCG',
    sourceUrl: 'https://limitlesstcg.com/decks',
    sourceTournament: 'Regional Championship',
    legalityVerifiedAt: '2026-09-14T12:00:00Z',
    groups: sampleGroups(),
  };
}

export function mockDeckMetaPaste(text: string): DeckMetaPasteResponse {
  return { groups: sampleGroups() };
}

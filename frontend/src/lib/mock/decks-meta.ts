/**
 * Fixtures de DECKS META (§13) para el modo MOCK (demo / Playwright / fallback sin backend).
 *
 * ⚠️ La suite UNITARIA no usa esto: espía las funciones de `@/lib/api` directamente (patrón de
 * `CardDetailView.test`). Estas fixtures existen para que el modo mock (config.useMocks) sirva una
 * vista completa —disponible, agotada y no identificada— sin backend, y para el smoke E2E.
 *
 * Construido contra el CONTRATO §13, no contra un backend corriendo (el backend de Fase 1 va en
 * paralelo). Cero dinero derivado en cliente: los precios son cifras planas de fixture.
 *
 * SUP-LEG (confía-en-la-fuente): ya NO hay legalidad — la fuente sólo publica decks legales, así que
 * una línea es disponible / no la tenemos / no identificada, nunca «rotada».
 */
import type {
  DecksMetaListResponse,
  DeckMetaDetailResponse,
  DeckMetaPasteResponse,
  DecksMetaPreviewResponse,
  DecksMetaDialDTO,
  DecksMetaDialUpdateRequest,
  MetaDeckGroupsDTO,
  MetaDeckLineDTO,
} from '@/types/contract';

const IMG = 'https://images.pokemontcg.io/sv1/1_hires.png';

/** Línea CASADA y disponible (trae piezas para el «de jalón»). */
function matchedLine(over: Partial<MetaDeckLineDTO> & Pick<MetaDeckLineDTO, 'rawName' | 'setCode' | 'number' | 'quantity' | 'group'>): MetaDeckLineDTO {
  return {
    matchStatus: 'matched',
    card: { cardId: `card-${over.setCode}-${over.number}`, name: over.rawName, imageUrl: IMG },
    availableQty: over.quantity,
    unitPriceMxnCents: 61500,
    unitInventoryItemIds: Array.from({ length: over.availableQty ?? over.quantity }, (_, i) => `inv-${over.setCode}-${over.number}-${i}`),
    ...over,
  };
}

/** Grupos de un deck de ejemplo: una de cada estado (disponible, agotada, no identificada). */
function sampleGroups(): MetaDeckGroupsDTO {
  return {
    pokemon: [
      matchedLine({ rawName: 'Dragapult ex', setCode: 'TWM', number: '130', quantity: 3, group: 'pokemon' }),
      // AGOTADA: casada pero sin stock (availableQty 0, sin piezas, sin precio) ⇒ «No la tenemos».
      matchedLine({
        rawName: 'Drakloak',
        setCode: 'TWM',
        number: '129',
        quantity: 2,
        group: 'pokemon',
        availableQty: 0,
        unitPriceMxnCents: null,
        unitInventoryItemIds: [],
      }),
    ],
    trainer: [
      matchedLine({ rawName: "Boss's Orders", setCode: 'PAL', number: '172', quantity: 2, group: 'trainer' }),
      // NO IDENTIFICADA: no casó por set (sin card, sin precio, sin piezas).
      {
        rawName: 'Iono',
        setCode: 'ZZZ',
        number: '999',
        quantity: 3,
        group: 'trainer',
        matchStatus: 'unmatched_set',
        card: null,
        availableQty: 0,
        unitPriceMxnCents: null,
        unitInventoryItemIds: [],
      },
    ],
    energy: [
      // Energía básica: se marca aparte (no se inventa pieza).
      {
        rawName: 'Basic Fire Energy',
        setCode: '',
        number: '',
        quantity: 8,
        group: 'energy',
        matchStatus: 'unmatched_basic_energy',
        card: null,
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
    groups: sampleGroups(),
  };
}

export function mockDeckMetaPaste(text: string): DeckMetaPasteResponse {
  return { groups: sampleGroups() };
}

/**
 * MOCK del ensayo Fase 2 (`GET /admin/decks-meta/preview`) para demo / smoke E2E sin backend. Un
 * reporte dry-run que PUBLICARÍA: canary en verde, tres decks en banda (~60). El backend real
 * tarda ~30-45s (egress a Limitless); aquí es instantáneo.
 */
export const mockDecksMetaPreview: DecksMetaPreviewResponse = {
  skipped: false,
  mode: 'dryrun',
  report: {
    mode: 'dryrun',
    formatCode: 'H-F',
    formatLabel: 'Standard (H–F)',
    autopublish: false,
    startedAt: '2026-09-19T12:00:00Z',
    finishedAt: '2026-09-19T12:00:38Z',
    urlsFetched: ['home', 'list/abc123', 'list/def456', 'list/ghi789'],
    decks: [
      { archetypeId: 'dragapult-ex', name: 'Dragapult ex', rank: 1, sharePct: 12.4, listId: 'abc123', cardsParsed: 18, sumQuantity: 60, matched: 17, total: 18, matchStatusBreakdown: { matched: 17, unmatched_set: 1 }, inBand: true },
      { archetypeId: 'charizard-ex', name: 'Charizard ex', rank: 2, sharePct: 10.1, listId: 'def456', cardsParsed: 20, sumQuantity: 60, matched: 20, total: 20, matchStatusBreakdown: { matched: 20 }, inBand: true },
      { archetypeId: 'raging-bolt-ex', name: 'Raging Bolt ex', rank: 3, sharePct: 8.7, listId: 'ghi789', cardsParsed: 19, sumQuantity: 60, matched: 18, total: 19, matchStatusBreakdown: { matched: 18, unmatched_set: 1 }, inBand: true },
    ],
    canary: {
      verdict: 'PUBLISH',
      inBandDeckCount: 3,
      reason: null,
      checks: [
        { id: 'C1', ok: true, measured: 3, threshold: 3, label: 'arquetipos en banda (3) ≥ 3' },
        { id: 'C2', ok: true, measured: 0, threshold: 0, label: 'decks fuera de banda (0) = 0' },
        { id: 'C3', ok: true, measured: 0.97, threshold: 0.9, label: 'ratio de match (0.97) ≥ 0.9' },
        { id: 'C4', ok: true, measured: 0.03, threshold: 0.1, label: 'ratio unmatched_set (0.03) ≤ 0.1' },
        { id: 'C5', ok: true, measured: 8, threshold: 3, label: 'home parseable, bloques con listId (8) ≥ 3' },
      ],
    },
    verdict: 'PUBLISH',
    wouldPublish: true,
    applied: false,
    persistedCount: 0,
    publishedSlugs: [],
    supersededListIds: [],
    manualConflicts: ['gardevoir-ex'],
    pausedSkipped: [],
    errors: [],
  },
};

/**
 * MOCK del DIAL (§13 Fase 2) para el modo demo. Seed FAIL-CLOSED (`off` / `autopublish:false`),
 * igual que el backend cuando la key no existe. Estado mutable de módulo para que el editor demo
 * refleje sus propios cambios sin backend.
 */
let mockDial: DecksMetaDialDTO = { autofetch: 'off', autopublish: false };

export function getMockDial(): DecksMetaDialDTO {
  return { ...mockDial };
}

export function setMockDial(patch: DecksMetaDialUpdateRequest): DecksMetaDialDTO {
  mockDial = {
    autofetch: patch.autofetch ?? mockDial.autofetch,
    autopublish: patch.autopublish ?? mockDial.autopublish,
  };
  return { ...mockDial };
}

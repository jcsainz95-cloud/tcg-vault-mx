/**
 * §AUTO-ENLACE fase 1 — datos de mock de `link-repair` y de `sync-status.unlinkedPrice` (con `groupUsed`/`reason`).
 * Los UUID coinciden con los de `getSyncStatus` (mock) y con `localSetId` de `mockRemoteSets`.
 */
import type { LinkRepairResult } from '../api/catalog-link-repair';
import type { UnlinkedPriceReport } from '@/types/contract';
import type { LinkConfirmResult, LinkExceptions } from '../api/catalog-link-exceptions';
import type { FinishReviewItem, FinishReviewPage, FinishReviewResult, ReviewDecision, ReviewFinish } from '../api/catalog-finish-review';
import { ApiClientError } from '../api-client';

export const MOCK_SET_CLASSIC = '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b';
export const MOCK_SET_SV = '8a9b0c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d';
export const MOCK_SET_PROMOS = 'c1000000-0000-4000-8000-000000000001';

export const mockUnlinkedPrice: UnlinkedPriceReport = {
  totalCards: 14,
  sets: [
    { setId: MOCK_SET_CLASSIC, name: '30th Celebration Classic Collection', unlinked: 11, total: 30, collisions: 2, omittedProducts: 5,
      groupUsed: { groupId: 24380, name: 'Classic Collection', via: 'auto' }, reason: 'collisions' },
    { setId: MOCK_SET_SV, name: 'Scarlet & Violet', unlinked: 3, total: 258, collisions: null, omittedProducts: null,
      groupUsed: { groupId: 22873, name: null, via: 'confirmed' }, reason: null },
  ],
  notLinkable: {
    totalCards: 4,
    sets: [{
      setId: MOCK_SET_PROMOS, name: 'Scarlet & Violet Promos', unlinked: 4, reason: 'no_group',
      exceptionReason: 'promo_route', groupUsed: { groupId: 22872, name: null, via: 'promo_table' },
    }],
  },
};

/** Respuesta de `POST /admin/catalog/link-repair`: liga, precia, y `nextAttemptAt` = enfriamiento del botón (+10 min). */
export function mockLinkRepair(setId: string): LinkRepairResult {
  // El set SV simula el límite 429 de la ruta (§7.4): 5 min.
  if (setId === MOCK_SET_SV) throw new ApiClientError(429, { code: 'RATE_LIMITED', message: 'rate', details: { retryAfterSeconds: 300 } });
  const known = setId === MOCK_SET_CLASSIC;
  return {
    linked: known ? 6 : 0,
    priced: known ? 22 : 0,
    groupUsed: { groupId: 24380, name: 'Classic Collection', via: 'auto' },
    reason: known ? null : 'collisions',
    nextAttemptAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    reasons: known ? [] : [{ key: 'collisions', count: null }],
    piecesCorrected: 0,
    piecesExcluded: [],
    ...(known ? { finishNotInProduct: 2 } : {}),
  };
}

/** Fase 4 (§8b): piezas antiguas por confirmar. La primera está bloqueada por venta; la segunda no tiene precio destino. */
let mockReviewItems: FinishReviewItem[] = [
  { inventoryItemId: 'fr-0001', folio: 'TH-000231', cardId: 'c-gym-1', cardName: "Rocket's Snorlax", setName: 'Gym Heroes', number: '12', status: 'listed',
    currentFinish: 'normal', targetFinish: 'first_edition', currentPriceCents: 113100, targetPriceCents: 389700, blockedReason: null },
  { inventoryItemId: 'fr-0002', folio: 'TH-000232', cardId: 'c-gym-2', cardName: "Erika's Gloom", setName: 'Gym Challenge', number: '16', status: 'in_stock',
    currentFinish: 'holofoil', targetFinish: 'first_edition_holofoil', currentPriceCents: 3700, targetPriceCents: null, blockedReason: 'no_target_price' },
  { inventoryItemId: 'fr-0003', folio: 'TH-000233', cardId: 'c-gym-3', cardName: "Lt. Surge's Raichu", setName: 'Gym Heroes', number: '9', status: 'in_stock',
    currentFinish: 'normal', targetFinish: 'first_edition', currentPriceCents: 47300, targetPriceCents: 107600, blockedReason: 'has_sale' },
];
export function mockFinishReview(): FinishReviewPage {
  return { pending: mockReviewItems.length, items: mockReviewItems, nextCursor: null };
}
export function mockFinishDecision(id: string, decision: ReviewDecision, expectedFinish: ReviewFinish): FinishReviewResult {
  const it = mockReviewItems.find((i) => i.inventoryItemId === id);
  if (!it) return { inventoryItemId: id, decision, before: null, after: null, alreadyResolved: true };
  if (it.blockedReason === 'has_sale') throw new ApiClientError(409, { code: 'ITEM_LOCKED', message: 'locked', details: { blockedReason: 'has_sale' } });
  if (decision === 'first_edition' && it.targetPriceCents == null) throw new ApiClientError(409, { code: 'NO_TARGET_PRICE', message: 'no price', details: {} });
  if (it.currentFinish !== expectedFinish) throw new ApiClientError(409, { code: 'STALE', message: 'stale', details: {} });
  mockReviewItems = mockReviewItems.filter((i) => i.inventoryItemId !== id);
  const to = it.targetFinish;
  return {
    inventoryItemId: id, decision, alreadyResolved: false,
    before: { finish: it.currentFinish, unitPriceCents: it.currentPriceCents, listPriceCents: it.currentPriceCents },
    after: decision === 'keep'
      ? { finish: it.currentFinish, unitPriceCents: it.currentPriceCents, listPriceCents: it.currentPriceCents }
      : { finish: to, unitPriceCents: it.targetPriceCents, listPriceCents: it.targetPriceCents },
  };
}

/** Estado del dial en el mock: ENCENDIDO por defecto (dueño 2026-11-27, «La reparación automática prendida»). */
let mockAutoOn = true;
export function mockSetAutoLink(on: boolean): void {
  mockAutoOn = on;
}
export function mockLinkExceptions(): LinkExceptions {
  const now = Date.now();
  return {
    unlinkedCards: 14,
    summary: {
      unlinkedCards: 14, unlinkedSets: 2, repairedYesterday: 87, pricedYesterday: 87,
      lastRunAt: new Date(now - 20 * 3_600_000).toISOString(), nextRunAt: mockAutoOn ? new Date(now + 4 * 3_600_000).toISOString() : null,
      waitingDecision: 0, pendingConfirm: mockReviewItems.length, autoLinkEnabled: mockAutoOn,
    },
    sets: [
      { setId: MOCK_SET_CLASSIC, name: '30th Celebration Classic Collection', unlinked: 11, total: 30, reason: 'name_mismatch',
        groupUsed: { groupId: 24380, name: 'Classic Collection', via: 'auto' }, nextAttemptAt: new Date(now + 4 * 3_600_000).toISOString(),
        lastAttemptAt: new Date(now - 20 * 3_600_000).toISOString(), tries: 2, canConfirm: true,
        candidates: [
          { groupId: 24380, name: 'Classic Collection', publishedOn: '2026-06-12', productCount: 34, score: 0.92 },
          { groupId: 24381, name: 'Classic Collection Promos', publishedOn: '2026-06-12', productCount: 8, score: 0.41 },
        ] },
      { setId: MOCK_SET_SV, name: 'Scarlet & Violet', unlinked: 3, total: 258, reason: 'collisions',
        groupUsed: { groupId: 22873, name: null, via: 'confirmed' }, nextAttemptAt: null, lastAttemptAt: null, tries: 1, canConfirm: true,
        candidates: [{ groupId: 22873, name: 'SV01: Scarlet & Violet Base Set', publishedOn: '2023-03-31', productCount: 400, score: 0.88 }] },
      { setId: MOCK_SET_PROMOS, name: 'Scarlet & Violet Promos', unlinked: 4, total: 120, reason: 'promo_route',
        groupUsed: { groupId: 22872, name: null, via: 'promo_table' }, nextAttemptAt: null, lastAttemptAt: null, tries: 0, canConfirm: false, candidates: [] },
    ],
  };
}

/** Respuesta de `POST …/link-exceptions/:setId/confirm`. El set SV simula 422 GROUP_NOT_FOUND. */
export function mockLinkConfirm(setId: string, groupId: number): LinkConfirmResult {
  if (groupId === 0) throw new ApiClientError(422, { code: 'GROUP_NOT_FOUND', message: 'group', details: {} });
  return { setId, groupUsed: { groupId, name: 'Classic Collection', via: 'confirmed' }, linked: 9, priced: 18, collisions: 0, conflicts: 0 };
}

(globalThis as { __thMockBundle?: string }).__thMockBundle = 'th-mock-bundle-sentinel-5c1e';

/**
 * §AUTO-ENLACE fase 1 — datos de mock de `link-repair` y de `sync-status.unlinkedPrice` (con `groupUsed`/`reason`).
 * Los UUID coinciden con los de `getSyncStatus` (mock) y con `localSetId` de `mockRemoteSets`.
 */
import type { LinkRepairResult } from '../api/catalog-link-repair';
import type { UnlinkedPriceReport } from '@/types/contract';
import type { LinkConfirmResult, LinkExceptions } from '../api/catalog-link-exceptions';
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

/** Estado del dial en el mock: ENCENDIDO por defecto (dueño 2026-11-27, «La reparación automática prendida»). */
export function mockLinkExceptions(): LinkExceptions {
  const now = Date.now();
  return {
    unlinkedCards: 14,
    summary: {
      unlinkedCards: 14, unlinkedSets: 2, repairedYesterday: 87, pricedYesterday: 87,
      lastRunAt: new Date(now - 20 * 3_600_000).toISOString(), nextRunAt: new Date(now + 4 * 3_600_000).toISOString(),
      waitingDecision: 0, autoLinkEnabled: true,
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

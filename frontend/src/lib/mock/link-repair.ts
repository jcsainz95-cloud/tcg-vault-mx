/**
 * §AUTO-ENLACE fase 1 — datos de mock de `link-repair` y de `sync-status.unlinkedPrice` (con `groupUsed`/`reason`).
 * Los UUID coinciden con los de `getSyncStatus` (mock) y con `localSetId` de `mockRemoteSets`.
 */
import type { LinkRepairResult } from '../api/catalog-link-repair';
import type { UnlinkedPriceReport } from '@/types/contract';

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
  };
}

(globalThis as { __thMockBundle?: string }).__thMockBundle = 'th-mock-bundle-sentinel-5c1e';

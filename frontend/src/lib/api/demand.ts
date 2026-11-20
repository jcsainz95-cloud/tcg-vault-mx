/**
 * Cliente de «Demanda sin stock» (§DEMANDA F1) — `docs/API_CONTRACT_DEMANDA.md` §1-2 (solo `super_admin`).
 * ⛔ El front no calcula dinero ni score: todo viene del servidor. Sin conexión con tienda aliada ni señal Google.
 * Mocks (`config.useMocks`): filas de ejemplo del contrato (carta + término).
 */
import { apiRequest, requestBlob, type BlobResponse } from '../api-client';
import { config } from '../config';
import type { Finish } from '@/types/contract';

export const DEMAND_SORTS = ['score', 'wishlist', 'search', 'market'] as const;
export type DemandSort = (typeof DEMAND_SORTS)[number];

export interface DemandSignalDTO {
  kind: 'wishlist' | 'search';
  count: number;
  unit: 'clientes' | 'personas';
  windowDays: number | null;
  days?: number;
}

/** Lista blanca (contrato §1): ningún otro campo, sin datos personales. */
export interface DemandGapRowDTO {
  key: string;
  kind: 'card' | 'term';
  cardId: string | null;
  term: string | null;
  cardName: string;
  setName: string | null;
  finish: Finish | null;
  imageSmallUrl: string | null;
  signals: DemandSignalDTO[];
  score: number;
  marketCents: number | null;
  buylistTodayCents: number | null;
}

export interface DemandGapsResponse {
  generatedAt: string;
  windowDays: number;
  totalRows: number;
  sources: { wishlist: 'ok' | 'error'; search: 'ok' | 'off' | 'error'; matchedAt: string | null };
  rows: DemandGapRowDTO[];
}

export interface DemandGapsParams {
  sort?: DemandSort;
  dir?: 'asc' | 'desc';
  limit?: number;
}

const query = (p: DemandGapsParams) => ({ sort: p.sort, dir: p.dir, limit: p.limit });

function mockResponse(): DemandGapsResponse {
  const now = new Date();
  return {
    generatedAt: now.toISOString(),
    windowDays: 30,
    totalRows: 2,
    sources: { wishlist: 'ok', search: 'ok', matchedAt: now.toISOString() },
    rows: [
      {
        key: 'mock-card-1',
        kind: 'card',
        cardId: 'mock-card-1',
        term: null,
        cardName: 'Charizard ex',
        setName: 'Obsidian Flames',
        finish: 'holofoil',
        imageSmallUrl: null,
        signals: [
          { kind: 'wishlist', count: 4, unit: 'clientes', windowDays: null },
          { kind: 'search', count: 7, unit: 'personas', windowDays: 30, days: 3 },
        ],
        score: 19,
        marketCents: 100000,
        buylistTodayCents: 70000,
      },
      {
        key: 'term:umbreon vmax alt',
        kind: 'term',
        cardId: null,
        term: 'umbreon vmax alt',
        cardName: 'umbreon vmax alt',
        setName: null,
        finish: null,
        imageSmallUrl: null,
        signals: [{ kind: 'search', count: 6, unit: 'personas', windowDays: 30, days: 2 }],
        score: 6,
        marketCents: null,
        buylistTodayCents: null,
      },
    ],
  };
}

/** `GET /admin/reports/demand-gaps` (`super_admin`; otro rol ⇒ `403`). */
export async function getDemandGaps(params: DemandGapsParams = {}): Promise<DemandGapsResponse> {
  if (config.useMocks) return Promise.resolve(mockResponse());
  return apiRequest<DemandGapsResponse>('/admin/reports/demand-gaps', { query: query(params) });
}

/** `GET /admin/reports/demand-gaps/export.csv` — mismo orden, todas las filas (tope 1000). */
export async function exportDemandGapsCsv(params: DemandGapsParams = {}): Promise<BlobResponse> {
  if (config.useMocks) {
    return { blob: new Blob(['tipo,card_id,termino\n'], { type: 'text/csv;charset=utf-8' }), filename: null };
  }
  return requestBlob('/admin/reports/demand-gaps/export.csv', { query: { sort: params.sort, dir: params.dir } });
}

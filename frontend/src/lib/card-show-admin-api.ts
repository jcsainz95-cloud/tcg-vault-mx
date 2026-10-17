/**
 * Cliente del PANEL super_admin del Card Show (API_CONTRACT §CARDSHOW.15, v1.96 M-84).
 *
 * ⛔ A diferencia del cliente público (`card-show-api.ts`, `@Public`), estos endpoints son
 * `super_admin` y viajan CON sesión: se usan `apiRequest`/`requestBlob` de `api-client.ts` (Bearer +
 * refresh). Rutas bajo `/admin/card-show/*`.
 *
 * ⛔ PENDING no aparece (§CARDSHOW.15): el backend excluye por defecto las filas no confirmadas; el
 * frontend ⛔ no las pide ni las reintroduce. Los filtros de `?status=` NUNCA incluyen `pending`.
 *
 * ⚠️ FORMA DE RESPUESTA: §CARDSHOW.15 no fija el envoltorio JSON del listado por escrito; se asume la
 * convención de paginación de §0 (`{ data, total, page, pageSize }`). El parser es DEFENSIVO: acepta
 * también un array pelado. Si backend publica otro envoltorio, se ajusta aquí (una sola función).
 */
import { apiRequest, requestBlob, type BlobResponse } from './api-client';
import { config } from './config';
import type { CardShowGame } from './card-show-api';

export type CardShowLeadType = 'merchant' | 'sponsor' | 'visitor';
/** ⛔ Sin `pending` (§CARDSHOW.15): el panel sólo muestra filas confirmadas. */
export type CardShowLeadStatus = 'new' | 'contacted' | 'closed' | 'discarded';
export type CardShowSignupStatus = 'confirmed' | 'waitlist' | 'cancelled' | 'checked_in';
export type CardShowDay = 'sat' | 'sun';

export interface CardShowLeadRow {
  id: string;
  type: CardShowLeadType;
  name: string;
  email: string;
  phone: string | null;
  gameInterest: CardShowGame | null;
  raffleOptIn: boolean;
  raffleTermsVersion: string | null;
  sellsWhat: string | null;
  status: CardShowLeadStatus;
  createdAt: string;
}

export interface CardShowPlayerRow {
  id: string;
  game: CardShowGame;
  day: CardShowDay;
  playerName: string;
  /** Vacío/null en las filas LIGERA (no-Pokémon): no tienen Player ID (§CARDSHOW.15). */
  playerId: string | null;
  status: CardShowSignupStatus;
  createdAt: string;
}

export interface Page<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface LeadListFilters {
  status?: CardShowLeadStatus;
  type?: CardShowLeadType;
  q?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface PlayerListFilters {
  status?: CardShowSignupStatus;
  day?: CardShowDay;
  game?: CardShowGame;
  q?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

/** Normaliza la respuesta a `Page<T>`: acepta `{ data, total, page, pageSize }` o un array pelado. */
function toPage<T>(raw: unknown, pageHint = 1, pageSizeHint = 25): Page<T> {
  if (Array.isArray(raw)) {
    return { data: raw as T[], total: raw.length, page: pageHint, pageSize: pageSizeHint };
  }
  const o = (raw ?? {}) as Partial<Page<T>>;
  const data = Array.isArray(o.data) ? o.data : [];
  return {
    data,
    total: typeof o.total === 'number' ? o.total : data.length,
    page: typeof o.page === 'number' ? o.page : pageHint,
    pageSize: typeof o.pageSize === 'number' ? o.pageSize : pageSizeHint,
  };
}

function leadQuery(f: LeadListFilters): Record<string, string | number | undefined> {
  return { status: f.status, type: f.type, q: f.q, from: f.from, to: f.to, page: f.page, pageSize: f.pageSize };
}

function playerQuery(f: PlayerListFilters): Record<string, string | number | undefined> {
  return { status: f.status, day: f.day, game: f.game, q: f.q, from: f.from, to: f.to, page: f.page, pageSize: f.pageSize };
}

const EMPTY = <T>(f: { page?: number; pageSize?: number }): Page<T> => ({
  data: [],
  total: 0,
  page: f.page ?? 1,
  pageSize: f.pageSize ?? 25,
});

/** `GET /admin/card-show/leads` (§CARDSHOW.15). ⛔ PENDING excluido por el backend. */
export async function listCardShowLeads(filters: LeadListFilters = {}): Promise<Page<CardShowLeadRow>> {
  if (config.useMocks) return EMPTY<CardShowLeadRow>(filters);
  const raw = await apiRequest<unknown>('/admin/card-show/leads', { query: leadQuery(filters) });
  return toPage<CardShowLeadRow>(raw, filters.page ?? 1, filters.pageSize ?? 25);
}

/** `GET /admin/card-show/players` (§CARDSHOW.15). ⛔ PENDING excluido por el backend. */
export async function listCardShowPlayers(filters: PlayerListFilters = {}): Promise<Page<CardShowPlayerRow>> {
  if (config.useMocks) return EMPTY<CardShowPlayerRow>(filters);
  const raw = await apiRequest<unknown>('/admin/card-show/players', { query: playerQuery(filters) });
  return toPage<CardShowPlayerRow>(raw, filters.page ?? 1, filters.pageSize ?? 25);
}

/** `GET /admin/card-show/leads/export.csv` (§CARDSHOW.15): MISMO dominio/filtros que la lista JSON. */
export async function exportCardShowLeadsCsv(filters: LeadListFilters = {}): Promise<BlobResponse> {
  if (config.useMocks) return { blob: new Blob([''], { type: 'text/csv;charset=utf-8' }), filename: 'card-show-leads.csv' };
  return requestBlob('/admin/card-show/leads/export.csv', { query: leadQuery({ ...filters, page: undefined, pageSize: undefined }) });
}

/** `GET /admin/card-show/players/export.csv` (§CARDSHOW.15): MISMO dominio/filtros que la lista JSON. */
export async function exportCardShowPlayersCsv(filters: PlayerListFilters = {}): Promise<BlobResponse> {
  if (config.useMocks) return { blob: new Blob([''], { type: 'text/csv;charset=utf-8' }), filename: 'card-show-players.csv' };
  return requestBlob('/admin/card-show/players/export.csv', { query: playerQuery({ ...filters, page: undefined, pageSize: undefined }) });
}

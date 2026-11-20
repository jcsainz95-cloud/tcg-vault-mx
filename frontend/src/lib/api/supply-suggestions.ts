/**
 * Sugeridas y ajustes de §PROV-F4 — `docs/API_CONTRACT_PROVEEDORES.md` §5 (PROPUESTO).
 * ⛔ El front no calcula dinero: `unitCents`, `marketCents`, `weekSpentCents` vienen del servidor; el único cambio de
 * unidad es pesos ⇄ centavos del campo de presupuesto (`pesosToCents`). `autoAccept` es de solo lectura (siempre false).
 * Mocks (`config.useMocks`): ajustes por defecto del dueño (HECHOS 2026-11-20: MX$5,000/semana) y lista vacía.
 */
import { apiRequest } from '../api-client';
import { config } from '../config';
import type { Paged, SupplyCard } from './suppliers';

export type SuggestionStatus = 'draft' | 'published' | 'skipped';
export type SuggestionSkipReason = 'no_market' | 'budget' | 'covered';
export type SuggestionReasonKind = 'rotation' | 'metadeck';

export interface SupplySuggestion {
  id: string;
  card: SupplyCard;
  finish: SupplyCard['finish'];
  suggestedQty: number;
  pctBps: number;
  unitCents: number | null;
  marketCents: number | null;
  reasons: { kind: SuggestionReasonKind; ref: string | null }[];
  status: SuggestionStatus;
  skipReason: SuggestionSkipReason | null;
  requestId: string | null;
  createdAt: string;
}

export interface SupplySettings {
  autoPublish: boolean;
  autoAccept: false;
  defaultPctBps: number;
  weeklyBudgetCents: number;
  weekSpentCents: number;
  weekStartsAt: string;
  lastRunAt: string | null;
}

/** Tope del contrato: 0..10 000 000 00 centavos. */
export const MAX_WEEKLY_BUDGET_CENTS = 1_000_000_000;
/** Valor por defecto del dueño (HECHOS 2026-11-20): MX$5,000 por semana. */
export const DEFAULT_WEEKLY_BUDGET_CENTS = 500_000;

const MOCK_SETTINGS: SupplySettings = {
  autoPublish: true,
  autoAccept: false,
  defaultPctBps: 7000,
  weeklyBudgetCents: DEFAULT_WEEKLY_BUDGET_CENTS,
  weekSpentCents: 0,
  weekStartsAt: '2026-11-16T06:00:00Z',
  lastRunAt: null,
};

export function getSupplySettings(): Promise<SupplySettings> {
  if (config.useMocks) return Promise.resolve(MOCK_SETTINGS);
  return apiRequest<SupplySettings>('/admin/supply-settings');
}

export function patchSupplySettings(body: { autoPublish?: boolean; weeklyBudgetCents?: number; defaultPctBps?: number }) {
  if (config.useMocks) return Promise.resolve({ ...MOCK_SETTINGS, ...body });
  return apiRequest<SupplySettings>('/admin/supply-settings', { method: 'PATCH', body });
}

export function listSupplySuggestions(f: { status?: SuggestionStatus; page?: number } = {}): Promise<Paged<SupplySuggestion>> {
  if (config.useMocks) return Promise.resolve({ data: [], page: 1, pageSize: 20, total: 0 });
  return apiRequest<Paged<SupplySuggestion>>('/admin/supply-suggestions', { query: f });
}

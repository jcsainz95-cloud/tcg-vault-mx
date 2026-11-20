/**
 * Sugeridas y ajustes de §PROV-F4 — `docs/API_CONTRACT_PROVEEDORES.md` §5 (PROPUESTO).
 * ⛔ El front no calcula dinero: `unitCents`, `marketCents`, `openExposureCents` vienen del servidor; el único cambio de
 * unidad es pesos ⇄ centavos del campo de presupuesto (`pesosToCents`). `autoAccept` es de solo lectura (siempre false).
 * Mocks (`config.useMocks`): ajustes por defecto del dueño (HECHOS 2026-11-20: MX$5,000/semana) y lista vacía.
 */
import { apiRequest } from '../api-client';
import { config } from '../config';
import type { Paged, SupplyCard, SupplyRequestAdmin } from './suppliers';

export type SuggestionStatus = 'draft' | 'published' | 'skipped';
export type SuggestionSkipReason = 'no_market' | 'budget' | 'covered' | 'market_jump';
/** Contrato §5: `kind` solo `metadeck` (la fuente «rotación» no existe). */
export type SuggestionReasonKind = 'metadeck';

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
  /** Tope de la exposición ABIERTA a la vez (no semanal). */
  openBudgetCents: number;
  /** Lectura: Σ unitCents × cantidad pendiente de solicitudes open (manuales incluidas). */
  openExposureCents: number;
  lastRunAt: string | null;
}

/** Tope del contrato: 0..10 000 000 00 centavos. */
export const MAX_OPEN_BUDGET_CENTS = 1_000_000_000;
/** Valor por defecto del dueño (HECHOS 2026-11-20): MX$5,000 abierto a la vez. */
export const DEFAULT_OPEN_BUDGET_CENTS = 500_000;

const MOCK_SETTINGS: SupplySettings = {
  autoPublish: false,
  autoAccept: false,
  defaultPctBps: 7000,
  openBudgetCents: DEFAULT_OPEN_BUDGET_CENTS,
  openExposureCents: 0,
  lastRunAt: null,
};

export function getSupplySettings(): Promise<SupplySettings> {
  if (config.useMocks) return Promise.resolve(MOCK_SETTINGS);
  return apiRequest<SupplySettings>('/admin/supply-settings');
}

export function patchSupplySettings(body: { autoPublish?: boolean; openBudgetCents?: number; defaultPctBps?: number }) {
  if (config.useMocks) return Promise.resolve({ ...MOCK_SETTINGS, ...body });
  return apiRequest<SupplySettings>('/admin/supply-settings', { method: 'PATCH', body });
}

/** Demo: 60 sugeridas en 3 páginas de 25 (solo para ver el paginador sin backend). */
function mockSuggestions(page: number): Paged<SupplySuggestion> {
  const total = 60;
  const pageSize = 25;
  const names = ['Charizard ex', 'Pikachu ex', 'Gardevoir ex', 'Miraidon ex', 'Iono', 'Arven'];
  const data = Array.from({ length: Math.max(0, Math.min(pageSize, total - (page - 1) * pageSize)) }, (_, k) => {
    const n = (page - 1) * pageSize + k;
    return {
      id: `mock-sug-${n}`,
      card: { cardId: `c${n}`, id: `c${n}`, setId: 'sv3', nameEs: null, name: names[n % names.length], number: String(n + 1), setName: 'Obsidian Flames', imageUrl: null, rarity: 'Double Rare', finish: 'normal' },
      finish: 'normal',
      suggestedQty: 1 + (n % 3),
      pctBps: 7000,
      unitCents: 8000 + n * 150,
      marketCents: 11500 + n * 200,
      reasons: [{ kind: 'metadeck', ref: null }],
      status: n % 7 === 3 ? 'skipped' : 'draft',
      skipReason: n % 7 === 3 ? 'budget' : null,
      requestId: null,
      createdAt: '2026-11-20T11:00:00Z',
    } as unknown as SupplySuggestion;
  });
  return { data, page, pageSize, total };
}

export function listSupplySuggestions(f: { status?: SuggestionStatus; page?: number } = {}): Promise<Paged<SupplySuggestion>> {
  if (config.useMocks) return Promise.resolve(mockSuggestions(f.page ?? 1));
  return apiRequest<Paged<SupplySuggestion>>('/admin/supply-suggestions', { query: f });
}

/** Publica una sugerida (admin). `idemKey` por intento: el reintento con la misma key devuelve el mismo 201. */
export function publishSupplySuggestion(id: string, body: { qty?: number; pctBps?: number }, idemKey: string): Promise<SupplyRequestAdmin> {
  if (config.useMocks) return Promise.reject(new Error('mocks: publish no disponible'));
  return apiRequest<SupplyRequestAdmin>(`/admin/supply-suggestions/${id}/publish`, {
    method: 'POST',
    body,
    headers: { 'Idempotency-Key': idemKey },
  });
}

/** Descarta una sugerida (admin) ⇒ 204. */
export function skipSupplySuggestion(id: string): Promise<void> {
  if (config.useMocks) return Promise.resolve();
  return apiRequest<void>(`/admin/supply-suggestions/${id}/skip`, { method: 'POST' });
}

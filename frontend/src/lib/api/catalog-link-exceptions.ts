/**
 * §AUTO-ENLACE contrato §2 — `GET /admin/catalog/link-exceptions`: lista única de sets con cartas sin ligar,
 * con motivo y grupo de la fuente de precios usado. Solo lectura local. Mapeo defensivo en `readLinkExceptions`.
 */
import { apiRequest } from '../api-client';
import { LINK_SET_REASONS, readGroupUsed, type LinkGroupUsed, type LinkSetReason } from './catalog-link-repair';

export interface LinkCandidate { groupId: number; name: string; publishedOn: string | null; productCount: number | null; score: number | null }
/** Resumen del job (contrato §2 `summary`). Campos tolerantes: `null` = backend aún no lo manda. */
export interface LinkExceptionsSummary {
  unlinkedCards: number;
  unlinkedSets: number | null;
  repairedYesterday: number | null;
  pricedYesterday: number | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  waitingDecision: number | null;
  /** Dial `auto_link_enabled`. `null` = el backend aún no lo informa (no se afirma estado). */
  autoLinkEnabled: boolean | null;
}
export interface LinkExceptionSet {
  setId: string;
  name: string;
  unlinked: number;
  total: number;
  reason: LinkSetReason | null;
  groupUsed: LinkGroupUsed | null;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  tries: number | null;
  /** Mejor primero, máx. 5. */
  candidates: LinkCandidate[];
  canConfirm: boolean;
}
export interface LinkExceptions {
  unlinkedCards: number;
  summary: LinkExceptionsSummary;
  sets: LinkExceptionSet[];
}

/** Motivos sin botón: la fuente no permite ligar. */
export const NO_BUTTON_REASONS: readonly LinkSetReason[] = ['tcgcsv_source', 'not_in_provider'];

interface RawExceptions {
  summary?: Partial<Record<'unlinkedCards' | 'unlinkedSets' | 'repairedYesterday' | 'pricedYesterday' | 'waitingDecision', number>> & {
    lastRunAt?: string | null; nextRunAt?: string | null; autoLinkEnabled?: boolean;
  };
  sets?: Array<{
    setId?: string; name?: string; unlinked?: number; total?: number; reason?: string;
    groupUsed?: { groupId?: number; name?: string; via?: string } | null; nextAttemptAt?: string | null;
    lastAttemptAt?: string | null; tries?: number; canConfirm?: boolean;
    candidates?: Array<{ groupId?: number; name?: string; publishedOn?: string | null; productCount?: number; score?: number }>;
  }>;
}

export function readLinkExceptions(raw: RawExceptions): LinkExceptions {
  const sets = (raw.sets ?? [])
    .filter((s) => typeof s.setId === 'string' && typeof s.name === 'string')
    .map((s) => ({
      setId: s.setId as string,
      name: s.name as string,
      unlinked: Number(s.unlinked) || 0,
      total: Number(s.total) || 0,
      reason: (LINK_SET_REASONS as readonly string[]).includes(s.reason ?? '') ? (s.reason as LinkSetReason) : null,
      groupUsed: readGroupUsed(s.groupUsed),
      nextAttemptAt: s.nextAttemptAt ?? null,
      lastAttemptAt: s.lastAttemptAt ?? null,
      tries: s.tries == null ? null : Number(s.tries) || 0,
      candidates: (s.candidates ?? [])
        .filter((c) => c.groupId != null && Number.isFinite(Number(c.groupId)))
        .slice(0, 5)
        .map((c) => ({
          groupId: Number(c.groupId),
          name: typeof c.name === 'string' && c.name ? c.name : '',
          publishedOn: c.publishedOn ?? null,
          productCount: c.productCount == null ? null : Number(c.productCount) || 0,
          score: c.score == null ? null : Number(c.score) || 0,
        })),
      canConfirm: s.canConfirm === true,
    }));
  const m = raw.summary ?? {};
  const num = (v: unknown): number | null => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  return {
    unlinkedCards: Number(m.unlinkedCards) || 0,
    summary: {
      unlinkedCards: Number(m.unlinkedCards) || 0,
      unlinkedSets: num(m.unlinkedSets),
      repairedYesterday: num(m.repairedYesterday),
      pricedYesterday: num(m.pricedYesterday),
      lastRunAt: m.lastRunAt ?? null,
      nextRunAt: m.nextRunAt ?? null,
      waitingDecision: num(m.waitingDecision),
      autoLinkEnabled: typeof m.autoLinkEnabled === 'boolean' ? m.autoLinkEnabled : null,
    },
    sets,
  };
}

/** El mock lo cablea `api.ts` (único importador de `lib/mock`); `null` = no simular. */
interface ExceptionsMocks {
  list?: () => Promise<LinkExceptions> | null;
  confirm?: (setId: string, groupId: number) => Promise<LinkConfirmResult> | null;
}
let mocks: ExceptionsMocks = {};
export function registerLinkExceptionsMock(m: ExceptionsMocks | null): void {
  mocks = m ?? {};
}

export async function getLinkExceptions(): Promise<LinkExceptions> {
  const mocked = mocks.list?.() ?? null;
  if (mocked) return mocked;
  return readLinkExceptions(await apiRequest<RawExceptions>('/admin/catalog/link-exceptions'));
}

/** POST `/admin/catalog/link-exceptions/:setId/confirm` (contrato §3). Liga y precia el set en la misma llamada. */
export interface LinkConfirmResult {
  setId: string;
  groupUsed: LinkGroupUsed | null;
  linked: number;
  priced: number;
  collisions: number;
  conflicts: number;
}
export async function confirmLinkException(setId: string, groupId: number): Promise<LinkConfirmResult> {
  const mocked = mocks.confirm?.(setId, groupId) ?? null;
  if (mocked) return mocked;
  const raw = await apiRequest<{
    setId?: string; groupUsed?: { groupId?: number; name?: string; via?: string } | null;
    linked?: number; priced?: number; collisions?: number; conflicts?: number;
  }>(`/admin/catalog/link-exceptions/${encodeURIComponent(setId)}/confirm`, { method: 'POST', body: { groupId } });
  return {
    setId: raw.setId ?? setId,
    groupUsed: readGroupUsed(raw.groupUsed),
    linked: Number(raw.linked) || 0,
    priced: Number(raw.priced) || 0,
    collisions: Number(raw.collisions) || 0,
    conflicts: Number(raw.conflicts) || 0,
  };
}

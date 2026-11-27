/**
 * §AUTO-ENLACE contrato §9.4 / §9.6: revisión POR CARTA de un set (`name_mismatch`/`collisions`), corridas del job
 * y reversa de un set. Lectura tolerante; el frontend no calcula ni multiplica precios (muestra `priceCents` del servidor).
 */
import { apiRequest } from '../api-client';

export interface CardCandidate { productId: number; name: string; number: string | null; finishes: string[]; priceCents: number | null }
export interface ReviewCard { cardId: string; name: string; number: string | null; reason: 'name_mismatch' | 'collision' | 'no_source_product'; candidates: CardCandidate[] }
export interface SetCards { setId: string; items: ReviewCard[] }
export interface CardConfirmResult { cardId: string; productId: number; priced: number; alreadyConfirmed: boolean }

export interface RunSample { cardName: string; number: string | null; finish: string; newPriceCents: number | null; previousPriceCents: number | null }
export interface RunSet {
  setId: string; name: string; groupId: number | null; via: string; linked: number; priced: number; held: number; finishesAdded: number; sample: RunSample[];
}
export interface AutoLinkRun { runId: string; at: string; setsTried: number; linked: number; priced: number; held: number; aborted: string | null; sets: RunSet[] }

interface Mocks {
  cards?: (setId: string) => Promise<SetCards> | null;
  confirm?: (setId: string, cardId: string, productId: number) => Promise<CardConfirmResult> | null;
  runs?: () => Promise<AutoLinkRun[]> | null;
  unlink?: (setId: string) => Promise<UnlinkResult> | null;
}
let mocks: Mocks = {};
export function registerLinkReviewMock(m: Mocks | null): void { mocks = m ?? {}; }

const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const numOrNull = (v: unknown): number | null => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export async function getSetCards(setId: string): Promise<SetCards> {
  const mocked = mocks.cards?.(setId) ?? null;
  if (mocked) return mocked;
  const raw = await apiRequest<{ setId?: string; items?: Array<Record<string, unknown>> }>(`/admin/catalog/link-exceptions/${encodeURIComponent(setId)}/cards`);
  const items = (raw.items ?? [])
    .filter((c) => typeof c.cardId === 'string')
    .map((c): ReviewCard => ({
      cardId: c.cardId as string,
      name: str(c.name) ?? '',
      number: str(c.number),
      reason: c.reason === 'collision' ? 'collision' : c.reason === 'no_source_product' ? 'no_source_product' : 'name_mismatch',
      candidates: (Array.isArray(c.candidates) ? (c.candidates as Array<Record<string, unknown>>) : [])
        .filter((p) => numOrNull(p.productId) != null)
        .slice(0, 5)
        .map((p) => ({
          productId: num(p.productId), name: str(p.name) ?? '', number: str(p.number),
          finishes: Array.isArray(p.finishes) ? (p.finishes as unknown[]).filter((f): f is string => typeof f === 'string') : [],
          priceCents: numOrNull(p.priceCents),
        })),
    }));
  return { setId: raw.setId ?? setId, items };
}

export async function confirmCardLink(setId: string, cardId: string, productId: number): Promise<CardConfirmResult> {
  const mocked = mocks.confirm?.(setId, cardId, productId) ?? null;
  if (mocked) return mocked;
  const raw = await apiRequest<Partial<CardConfirmResult>>(
    `/admin/catalog/link-exceptions/${encodeURIComponent(setId)}/cards/${encodeURIComponent(cardId)}/confirm`,
    { method: 'POST', body: { productId } },
  );
  return { cardId: raw.cardId ?? cardId, productId: num(raw.productId ?? productId), priced: num(raw.priced), alreadyConfirmed: raw.alreadyConfirmed === true };
}

export async function getAutoLinkRuns(days = 7): Promise<AutoLinkRun[]> {
  const mocked = mocks.runs?.() ?? null;
  if (mocked) return mocked;
  const raw = await apiRequest<{ runs?: Array<Record<string, unknown>> }>(`/admin/catalog/auto-link-runs?days=${days}`);
  return (raw.runs ?? []).filter((r) => typeof r.runId === 'string').map((r): AutoLinkRun => ({
    runId: r.runId as string, at: str(r.at) ?? '', setsTried: num(r.setsTried), linked: num(r.linked), priced: num(r.priced), held: num(r.held),
    aborted: str(r.aborted) ?? (r.aborted === true ? 'unknown' : null),
    sets: (Array.isArray(r.sets) ? (r.sets as Array<Record<string, unknown>>) : []).map((s): RunSet => ({
      setId: str(s.setId) ?? '', name: str(s.name) ?? '', groupId: numOrNull(s.groupId), via: str(s.via) ?? 'auto',
      linked: num(s.linked), priced: num(s.priced), held: num(s.held), finishesAdded: num(s.finishesAdded),
      sample: (Array.isArray(s.sample) ? (s.sample as Array<Record<string, unknown>>) : []).slice(0, 5).map((x): RunSample => ({
        cardName: str(x.cardName) ?? '', number: str(x.number), finish: str(x.finish) ?? '',
        newPriceCents: numOrNull(x.newPriceCents), previousPriceCents: numOrNull(x.previousPriceCents),
      })),
    })),
  }));
}

/** Lo que devolvió `unlink` (§10.3): cuántos enlaces y precios quitó. */
export interface UnlinkResult { unlinked: number; pricesRemoved: number }
/** `POST …/link-exceptions/:setId/unlink` (§9.6 iv). 404 si backend aún no lo expone; 409 `NOTHING_TO_UNLINK` si no hay nada que quitar. */
export async function unlinkSet(setId: string): Promise<UnlinkResult> {
  const mocked = mocks.unlink?.(setId) ?? null;
  if (mocked) return mocked;
  const raw = await apiRequest<Partial<UnlinkResult>>(`/admin/catalog/link-exceptions/${encodeURIComponent(setId)}/unlink`, { method: 'POST' });
  return { unlinked: num(raw?.unlinked), pricesRemoved: num(raw?.pricesRemoved) };
}

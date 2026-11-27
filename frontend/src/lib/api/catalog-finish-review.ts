/**
 * §AUTO-ENLACE §8b (fase 4) — piezas antiguas por confirmar: `GET /admin/catalog/finish-review` y
 * `POST /admin/catalog/finish-review/:inventoryItemId`. Solo super_admin. Centavos enteros: se muestran tal cual
 * (el frontend nunca calcula precios). Mapeo defensivo; el mock lo cablea `api.ts` (no se importa `lib/mock` aquí).
 */
import { apiRequest } from '../api-client';

export type ReviewBlockedReason = 'has_sale' | 'reserved' | 'in_custody' | 'customer_owned' | 'no_target_price';
export const REVIEW_BLOCKED: readonly ReviewBlockedReason[] = ['has_sale', 'reserved', 'in_custody', 'customer_owned', 'no_target_price'];
export type ReviewFinish = 'normal' | 'holofoil';
export type ReviewTarget = 'first_edition' | 'first_edition_holofoil';

export interface FinishReviewItem {
  inventoryItemId: string;
  folio: string | null;
  cardId: string | null;
  cardName: string;
  setName: string;
  number: string | null;
  status: string | null;
  currentFinish: ReviewFinish;
  targetFinish: ReviewTarget;
  currentPriceCents: number | null;
  targetPriceCents: number | null;
  blockedReason: ReviewBlockedReason | null;
}
export interface FinishReviewPage { pending: number; items: FinishReviewItem[]; nextCursor: string | null }

export type ReviewDecision = 'keep' | 'first_edition';
export interface FinishReviewResult {
  inventoryItemId: string;
  decision: ReviewDecision;
  before: { finish: string; unitPriceCents: number | null; listPriceCents: number | null } | null;
  after: { finish: string; unitPriceCents: number | null; listPriceCents: number | null } | null;
  alreadyResolved: boolean;
}

const cents = (v: unknown): number | null => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));

export function readFinishReview(raw: {
  pending?: number; nextCursor?: string | null; items?: Array<Record<string, unknown>>;
}): FinishReviewPage {
  const items = (raw.items ?? [])
    .filter((i) => typeof i.inventoryItemId === 'string' && (i.currentFinish === 'normal' || i.currentFinish === 'holofoil'))
    .map((i) => ({
      inventoryItemId: i.inventoryItemId as string,
      folio: typeof i.folio === 'string' ? i.folio : null,
      cardId: typeof i.cardId === 'string' ? i.cardId : null,
      cardName: String(i.cardName ?? ''),
      setName: String(i.setName ?? ''),
      number: i.number == null ? null : String(i.number),
      status: typeof i.status === 'string' ? i.status : null,
      currentFinish: i.currentFinish as ReviewFinish,
      targetFinish: (i.targetFinish === 'first_edition_holofoil' ? 'first_edition_holofoil' : 'first_edition') as ReviewTarget,
      currentPriceCents: cents(i.currentPriceCents),
      targetPriceCents: cents(i.targetPriceCents),
      blockedReason: (REVIEW_BLOCKED as readonly unknown[]).includes(i.blockedReason) ? (i.blockedReason as ReviewBlockedReason) : null,
    }));
  return { pending: Number(raw.pending) || 0, items, nextCursor: raw.nextCursor ?? null };
}

interface Mocks {
  list?: (cursor: string | null) => Promise<FinishReviewPage> | null;
  decide?: (id: string, decision: ReviewDecision, expectedFinish: ReviewFinish) => Promise<FinishReviewResult> | null;
}
let mocks: Mocks = {};
export function registerFinishReviewMock(m: Mocks | null): void {
  mocks = m ?? {};
}

export async function getFinishReview(cursor: string | null = null): Promise<FinishReviewPage> {
  const mocked = mocks.list?.(cursor) ?? null;
  if (mocked) return mocked;
  const q = new URLSearchParams({ limit: '50', ...(cursor ? { cursor } : {}) });
  return readFinishReview(await apiRequest(`/admin/catalog/finish-review?${q.toString()}`));
}

export async function decideFinishReview(id: string, decision: ReviewDecision, expectedFinish: ReviewFinish): Promise<FinishReviewResult> {
  const mocked = mocks.decide?.(id, decision, expectedFinish) ?? null;
  if (mocked) return mocked;
  const raw = await apiRequest<Partial<FinishReviewResult>>(`/admin/catalog/finish-review/${encodeURIComponent(id)}`, {
    method: 'POST', body: { decision, expectedFinish },
  });
  return {
    inventoryItemId: raw.inventoryItemId ?? id,
    decision: raw.decision === 'keep' ? 'keep' : decision,
    before: raw.before ?? null,
    after: raw.after ?? null,
    alreadyResolved: raw.alreadyResolved === true,
  };
}

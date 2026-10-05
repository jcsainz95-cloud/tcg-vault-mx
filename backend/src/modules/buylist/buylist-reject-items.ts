import { BuyDecision, SellItemStatus } from '@prisma/client';
import { BusinessException } from '../../common/business.exception';

/**
 * v1.82 · **PNL-4** — piezas puras de `POST /admin/buylist/:id/reject-items` (`API_CONTRACT §PNL.4`).
 * Viven fuera de `buylist.service.ts` para probarse sin BD.
 */

/** §PNL.4: `itemIds` 1–200. */
export const REJECT_ITEMS_MAX = 200;
/** §PNL.4: `reason` 3–500 tras `trim()` — el mismo rango que el `reject` por carta (`ItemDecisionDto`). */
export const REJECT_REASON_MIN = 3;
export const REJECT_REASON_MAX = 500;

export interface RejectItemsBody {
  itemIds: string[];
  reason: string;
}

function bad(field: 'itemIds' | 'reason', rule: string, message: string, extra: Record<string, unknown> = {}): never {
  throw BusinessException.badRequest('VALIDATION_ERROR', message, { field, rule, ...extra });
}

/**
 * Paso 1 de §PNL.4 — **`400` de forma con `details.field`/`details.rule`.** El cuerpo llega crudo
 * (`@Body() body: unknown`): el `ValidationPipe` global no emite `field` (TECH_DEBT BE-82) y el contrato
 * pide `{field:'itemIds', rule:'duplicates'}`. Mismo patrón que `shipped-refund-reason` (cuerpo validado
 * entero por el servidor). Claves de más se ignoran (como haría el `whitelist` global).
 */
export function parseRejectItemsBody(body: unknown): RejectItemsBody {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    bad('itemIds', 'required', 'body must be an object with itemIds and reason');
  }
  const b = body as Record<string, unknown>;
  const ids = b.itemIds;
  if (!Array.isArray(ids)) bad('itemIds', 'type', 'itemIds must be an array of ids');
  if (ids.length < 1 || ids.length > REJECT_ITEMS_MAX) {
    bad('itemIds', 'size', `itemIds must have between 1 and ${REJECT_ITEMS_MAX} ids`, { min: 1, max: REJECT_ITEMS_MAX });
  }
  if (!ids.every((x) => typeof x === 'string' && x.trim().length > 0)) {
    bad('itemIds', 'type', 'every itemId must be a non-empty string');
  }
  const itemIds = ids as string[];
  if (new Set(itemIds).size !== itemIds.length) {
    bad('itemIds', 'duplicates', 'itemIds must not repeat');
  }
  if (typeof b.reason !== 'string') bad('reason', 'type', 'reason must be a string');
  const reason = b.reason.trim();
  if (reason.length < REJECT_REASON_MIN || reason.length > REJECT_REASON_MAX) {
    bad('reason', 'length', `reason must have ${REJECT_REASON_MIN}–${REJECT_REASON_MAX} characters`, {
      min: REJECT_REASON_MIN,
      max: REJECT_REASON_MAX,
    });
  }
  return { itemIds, reason };
}

/**
 * 💰 v1.82.1 · §PNL.10.2 (E-2) — **estados FINALES de la carta: un predicado, un cuerpo.** La carta ya es
 * inventario nuestro (`convertida_inventario`, con su pieza `in_stock`) o ya se le pagó al vendedor (`pagada`).
 * Ninguna decisión por carta la toca (`PATCH …/decision`, los tres verbos ⇒ `409 CONFLICT {reason:'ITEM_FINAL'}`),
 * el `where` del rechazo la excluye siempre (`rejectItemWrite`), y el lote la bloquea (abajo, compuesto de éste).
 * ⚠️ `pagada` como estado de CARTA hoy no lo escribe nadie (§PNL.10.2.1): va por el enum, no por un camino medido.
 */
export const ITEM_FINAL_STATUSES: readonly SellItemStatus[] = ['convertida_inventario', 'pagada'];

/** ¿La carta está en un estado final? (§PNL.10.2) — el único lector de `ITEM_FINAL_STATUSES` fuera de los `where`. */
export function isItemFinal(itemStatus: SellItemStatus): boolean {
  return ITEM_FINAL_STATUSES.includes(itemStatus);
}

/**
 * Estados de la CARTA desde los que el LOTE ya no rechaza — **compuesto** de `ITEM_FINAL_STATUSES` (⛔ dos listas
 * escritas a mano, §PNL.10.2.1):
 * - los finales: el desenlace ya ocurrió (BRJ-5);
 * - `rechazada`: ya está rechazada; re-rechazarla movería `rejectedAt` (el ancla de los plazos de
 *   devolución y abandono) y la volvería a nombrar en un correo. En el lote es `409`, no un no-op (E-4, BRJ-14).
 */
export const REJECT_ITEMS_BLOCKED_STATUSES: readonly SellItemStatus[] = [...ITEM_FINAL_STATUSES, 'rechazada'];

/**
 * El predicado de §PNL.4 paso 4, **un cuerpo**: por qué una carta NO entra al lote.
 * - `not_offered` ⇒ `422 ITEM_NOT_OFFERED` (`offerDecision = 'skip'`: no se rechaza lo que no se compró, §M5-V).
 * - `not_rejectable` ⇒ `409 CONFLICT` (estado de carta en `REJECT_ITEMS_BLOCKED_STATUSES`).
 * El orden de precedencia lo fija el contrato: `404` > `422` > `409`.
 */
export function rejectItemsBlock(item: {
  itemStatus: SellItemStatus;
  offerDecision: BuyDecision | null;
}): 'not_offered' | 'not_rejectable' | null {
  if (item.offerDecision === 'skip') return 'not_offered';
  if (REJECT_ITEMS_BLOCKED_STATUSES.includes(item.itemStatus)) return 'not_rejectable';
  return null;
}

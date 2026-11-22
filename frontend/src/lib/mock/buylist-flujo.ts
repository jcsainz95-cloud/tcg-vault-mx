/**
 * §BUYLIST-FLUJO F2 — servidor FALSO de bajar precio, preview, recoger, «Convertir todas» y portal del vendedor. Espeja los
 * errores y códigos del anexo §3–§6. Solo `api.ts` lo importa (R1 de mock-boundary).
 */
import { ApiClientError } from '../api-client';
import type { RevisePriceInput } from '../api/buylist-flujo';
import * as fx from './fixtures';
import type {
  AdminBuylistDTO,
  BuylistConvertAllResponse,
  BuylistPickupDTO,
  BuylistPickupMethod,
  BuylistRevisePreviewDTO,
  SellItemDTO,
} from '@/types/contract';

const DAY_MS = 86_400_000;
const delay = <T>(value: T, ms = 120): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), ms));

function findAdminItem(itemId: string) {
  for (const req of fx.mockAdminBuylist) {
    const item = req.items.find((it) => it.id === itemId);
    if (item) return { req, item };
  }
  throw new ApiClientError(404, { code: 'NOT_FOUND', message: 'Sell request item not found' });
}

/** Mismas validaciones y errores en `revise-price` y en su `preview` (anexo §3). */
function assertRevisable(itemId: string, revisedPriceCents: number) {
  const { req, item } = findAdminItem(itemId);
  if (req.status !== 'recibida' && req.status !== 'verificacion') {
    throw new ApiClientError(422, { code: 'REQUEST_NOT_RECEIVED', message: 'Request not received yet' });
  }
  if (item.offerDecision !== 'buy' || item.offeredPriceCents == null) {
    throw new ApiClientError(422, { code: 'ITEM_NOT_OFFERED', message: 'Item not offered' });
  }
  if (item.itemStatus === 'aprobada' || item.itemStatus === 'rechazada' || item.revision?.state === 'accepted') {
    throw new ApiClientError(409, { code: 'REVISION_ALREADY_RESOLVED', message: 'Item already resolved' });
  }
  if (!Number.isInteger(revisedPriceCents) || revisedPriceCents <= 0 || revisedPriceCents >= item.offeredPriceCents) {
    throw new ApiClientError(422, { code: 'REVISION_NOT_LOWER', message: 'Revised price must be lower than offered' });
  }
  return { req, item };
}

export async function mockReviseBuylistItemPrice(itemId: string, input: RevisePriceInput): Promise<AdminBuylistDTO> {
  const note = input.note?.trim() ?? '';
  if (input.reasonCode === 'other' && (note.length < 3 || note.length > 500)) {
    throw new ApiClientError(400, { code: 'VALIDATION_ERROR', message: 'note 3-500', details: { field: 'note' } });
  }
  const { req, item } = assertRevisable(itemId, input.revisedPriceCents);
  const now = Date.now();
  item.itemStatus = 'ajustada';
  item.revision = {
    state: 'pending',
    proposedCents: input.revisedPriceCents,
    previousCents: item.offeredPriceCents ?? null,
    reasonCode: input.reasonCode,
    note: note || null,
    proposedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 7 * DAY_MS).toISOString(),
    respondedAt: null,
  };
  return delay(fx.mockAdminBuylistDTO(req));
}

export async function mockPreviewBuylistRevision(itemId: string, revisedPriceCents: number): Promise<BuylistRevisePreviewDTO> {
  const { req, item } = assertRevisable(itemId, revisedPriceCents);
  return delay({
    itemId,
    offeredPriceCents: item.offeredPriceCents as number,
    revisedPriceCents,
    payout: fx.mockProjectedNetCents(req, itemId, revisedPriceCents),
  }, 60);
}

export async function mockMarkBuylistPickupDone(itemId: string): Promise<SellItemDTO> {
  const { item } = findAdminItem(itemId);
  if (item.itemStatus !== 'rechazada' || item.rejectionCode === 'not_received' || !item.pickup) {
    throw new ApiClientError(422, { code: 'ITEM_NOT_PICKUP', message: 'Nothing to pick up' });
  }
  const prev: BuylistPickupDTO = item.pickup;
  item.pickup = { ...prev, doneAt: prev.doneAt ?? new Date().toISOString() };
  return delay({ ...item });
}

export async function mockConvertAllBuylist(requestId: string, locationId?: string): Promise<BuylistConvertAllResponse> {
  const req = fx.mockAdminBuylist.find((r) => r.id === requestId);
  if (!req) throw new ApiClientError(404, { code: 'NOT_FOUND', message: 'Sell request not found' });
  if (locationId && !fx.mockLocations.some((l) => l.id === locationId)) {
    throw new ApiClientError(422, { code: 'LOCATION_NOT_AVAILABLE', message: 'Location not available' });
  }
  const out: BuylistConvertAllResponse = { converted: [], skipped: [], failed: [] };
  for (const it of req.items) {
    if (it.itemStatus === 'convertida_inventario') out.skipped.push({ itemId: it.id, code: 'ALREADY_CONVERTED' });
    else if (it.itemStatus !== 'aprobada') out.skipped.push({ itemId: it.id, code: 'ITEM_NOT_APPROVED' });
    else {
      const seq = String(fx.mockInventory.length + 40 + out.converted.length).padStart(6, '0');
      it.itemStatus = 'convertida_inventario';
      it.inventoryItemId = `inv-new-${seq}`;
      out.converted.push({ itemId: it.id, inventoryItemId: it.inventoryItemId });
    }
  }
  return delay(out);
}

function findCustomerItem(requestId: string, itemId: string) {
  const req = fx.mockSellRequests.find((r) => r.sellRequestId === requestId);
  const item = req?.items.find((it) => it.id === itemId);
  if (!req || !item) throw new ApiClientError(404, { code: 'NOT_FOUND', message: 'Sell request item not found' });
  return { req, item };
}


export async function mockRespondBuylistRevision(
  requestId: string,
  itemId: string,
  decision: 'accept' | 'decline',
): Promise<SellItemDTO> {
  const { item } = findCustomerItem(requestId, itemId);
  const want = decision === 'accept' ? 'accepted' : 'declined';
  if (item.revision && item.revision.state !== 'pending') {
    if (item.revision.state === want) return delay({ ...item });
    throw new ApiClientError(409, { code: 'REVISION_ALREADY_RESOLVED', message: 'Revision already resolved' });
  }
  if (!item.revision) throw new ApiClientError(409, { code: 'REVISION_ALREADY_RESOLVED', message: 'No pending revision' });
  item.revision = { ...item.revision, state: want, respondedAt: new Date().toISOString() };
  if (decision === 'accept') {
    item.approvedPriceCents = item.revision.proposedCents;
    item.itemStatus = 'aprobada';
  } else {
    const t0 = Date.now();
    item.itemStatus = 'rechazada';
    item.rejectionCode = 'revision_declined';
    item.rejectedAt = new Date(t0).toISOString();
    item.pickup = {
      method: null,
      chosenAt: null,
      doneAt: null,
      returnDeadlineAt: new Date(t0 + 7 * DAY_MS).toISOString(),
      abandonDeadlineAt: new Date(t0 + 30 * DAY_MS).toISOString(),
    };
  }
  return delay({ ...item });
}

export async function mockChooseBuylistPickup(
  requestId: string,
  itemId: string,
  method: BuylistPickupMethod,
): Promise<SellItemDTO> {
  const { item } = findCustomerItem(requestId, itemId);
  if (item.itemStatus !== 'rechazada' || item.rejectionCode === 'not_received' || !item.pickup) {
    throw new ApiClientError(422, { code: 'ITEM_NOT_PICKUP', message: 'Nothing to pick up' });
  }
  if (item.pickup.doneAt && item.pickup.method !== method) {
    throw new ApiClientError(409, { code: 'PICKUP_ALREADY_DONE', message: 'Pickup already done' });
  }
  item.pickup = { ...item.pickup, method, chosenAt: item.pickup.chosenAt ?? new Date().toISOString() };
  return delay({ ...item });
}

(globalThis as { __thMockBundle?: string }).__thMockBundle = 'th-mock-bundle-sentinel-5c1e';

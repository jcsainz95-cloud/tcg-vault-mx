/**
 * v1.106 §MKT.H.4 — el arquitecto dejó NO MEDIDO que `OrderItemCardDTO.sealedProductId` viaje de verdad en la respuesta
 * (`orders.service.ts` `cardSnapshot` ⇒ `toOrderItemPreviews`, y la relectura histórica por `readFrozenCardFacts`). Aquí se mide
 * en el cable (JSON serializado), para un sellado ligado y otro sin ligar, y que de ahí sale el `item_id` canónico.
 */
import { OrdersService } from '../src/modules/orders/orders.service';
import { readFrozenCardFacts, resolveOrderItemCard } from '../src/modules/orders/order-item-card';
import { measurementItemOf } from '../src/modules/measurement/measurement-item';

const svc = Object.create(OrdersService.prototype) as OrdersService;
const snapshotOf = (item: unknown) => (svc as unknown as { cardSnapshot: (i: unknown) => Record<string, unknown> }).cardSnapshot(item);
const onWire = <T>(v: T): Record<string, unknown> => JSON.parse(JSON.stringify(v));

const sealed = (sealedProductId: string | null) => ({
  id: 'inv-1',
  cardId: 'sv3-1',
  productType: 'sealed',
  rawCondition: null,
  gradingCompany: null,
  gradeValue: null,
  sealedProductId,
  sealedProductName: 'ETB Obsidian Flames',
  sealedImageUrl: null,
  card: { id: 'sv3-1', name: 'Charmander', number: '1', imageSmallUrl: null, set: { name: 'Obsidian Flames' } },
});

describe('OrderItemCardDTO.sealedProductId en el cable (cotización y GET /orders/:id)', () => {
  it.each([
    ['ligado', 'sp-9', 's_sp-9'],
    ['sin ligar', null, 'sc_sv3-1'],
  ])('sellado %s ⇒ card.sealedProductId = %p en la cotización y en la relectura; item_id %s', (_n, spId, itemId) => {
    const item = sealed(spId);
    const snap = snapshotOf(item);
    // Cotización: `toOrderItemPreviews` (mismo camino que POST /checkout/quote).
    const [preview] = svc.toOrderItemPreviews([item as never], [{ inventoryItemId: 'inv-1', cardSnapshot: snap, unitPriceCents: 100 } as never]);
    const quoteCard = onWire(preview).card as Record<string, unknown>;
    expect('sealedProductId' in quoteCard).toBe(true);
    expect(quoteCard.sealedProductId).toBe(spId);
    // GET /orders/:id: la columna Json releída por la allowlist.
    const stored = JSON.parse(JSON.stringify(snap));
    const historic = onWire(resolveOrderItemCard(readFrozenCardFacts(stored), null));
    expect(historic.sealedProductId).toBe(spId);
    expect(measurementItemOf(readFrozenCardFacts(stored))?.item_id).toBe(itemId);
  });
});

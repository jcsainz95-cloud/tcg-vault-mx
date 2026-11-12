/**
 * §PROV F1 — proyecciones de respuesta. REGLA DE AISLAMIENTO: las vistas de proveedor (`*Supplier`) NO llevan `pctBps`,
 * `marketCents`, `capCents`, otras tiendas, clientes ni `adjustBps`. Un test de fuga lo ata (supply.views.spec.ts).
 */
import { Card, CardSet, Finish, SupplyCondition, SupplyPurchase, SupplyPurchaseUnit, SupplyOffer, SupplyRequest, Supplier } from '@prisma/client';

export type CardWithSet = Card & { set: CardSet };

export function cardView(card: CardWithSet, finish: Finish) {
  return {
    cardId: card.id,
    name: card.name,
    nameEs: null as string | null,
    number: card.number,
    setId: card.setId,
    setName: card.set.name,
    imageUrl: card.imageSmallUrl ?? card.imageLargeUrl ?? null,
    rarity: card.rarity ?? null,
    finish,
  };
}

export function requestSupplierView(
  r: SupplyRequest & { card: CardWithSet },
  unitCents: number,
  myOfferStatus: string | null,
) {
  return {
    id: r.id,
    card: cardView(r.card, r.finish),
    minCondition: r.minCondition as SupplyCondition,
    qtyOpen: Math.max(0, r.qtyWanted - r.qtyReserved),
    unitCents,
    expiresAt: r.expiresAt,
    myOfferStatus,
  };
}

export function requestAdminView(
  r: SupplyRequest & { card: CardWithSet },
  x: { unitCents: number | null; marketCents: number | null; offersCount: number; bestOfferUnitCents: number | null },
) {
  const aboveCap = x.unitCents != null && x.marketCents != null && x.unitCents > x.marketCents;
  return {
    id: r.id,
    card: cardView(r.card, r.finish),
    minCondition: r.minCondition,
    qtyWanted: r.qtyWanted,
    qtyReserved: r.qtyReserved,
    qtyReceived: r.qtyReceived,
    qtyOpen: Math.max(0, r.qtyWanted - r.qtyReserved),
    pctBps: r.pctBps,
    unitCents: x.unitCents,
    fixedPrice: r.fixedCents != null,
    marketCents: x.marketCents,
    capCents: x.marketCents,
    aboveCap,
    status: r.status,
    source: r.source,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
    offersCount: x.offersCount,
    bestOfferUnitCents: x.bestOfferUnitCents,
  };
}

type OfferRow = SupplyOffer & { request: SupplyRequest & { card: CardWithSet }; purchase?: { id: string } | null };

export function offerSupplierView(o: OfferRow) {
  return {
    id: o.id,
    requestId: o.requestId,
    card: cardView(o.request.card, o.request.finish),
    qty: o.qty,
    condition: o.condition,
    unitCents: o.unitCents,
    totalCents: o.unitCents * o.qty,
    status: o.status,
    counterUnitCents: null as number | null,
    expiresAt: o.expiresAt,
    purchaseId: o.purchase?.id ?? null,
    createdAt: o.createdAt,
  };
}

export function offerAdminView(
  o: OfferRow & { supplier: Pick<Supplier, 'id' | 'businessName'> },
  x: { marketCents: number | null; isBest: boolean },
) {
  const pct = x.marketCents != null && x.marketCents > 0 ? Math.round((o.unitCents * 10000) / x.marketCents) : null;
  return {
    id: o.id,
    requestId: o.requestId,
    supplier: { id: o.supplier.id, businessName: o.supplier.businessName },
    card: cardView(o.request.card, o.request.finish),
    qty: o.qty,
    condition: o.condition,
    unitCents: o.unitCents,
    totalCents: o.unitCents * o.qty,
    pctOfMarketBps: pct,
    marketCents: x.marketCents,
    aboveCap: x.marketCents != null && o.unitCents > x.marketCents,
    status: o.status,
    expiresAt: o.expiresAt,
    createdAt: o.createdAt,
    isBest: x.isBest,
  };
}

type PurchaseRow = SupplyPurchase & {
  units: SupplyPurchaseUnit[];
  supplier: Pick<Supplier, 'id' | 'businessName'>;
  inventoryItems?: { id: string }[];
};

export function purchaseView(p: PurchaseRow, card: CardWithSet, audience: 'admin' | 'supplier') {
  const units = [...p.units]
    .sort((a, b) => a.n - b.n)
    .map((u) => ({
      n: u.n,
      condition: u.condition,
      result: u.result,
      ...(audience === 'admin' ? { adjustBps: u.adjustBps } : {}),
      unitPayableCents: u.unitPayableCents,
      note: u.note,
    }));
  return {
    id: p.id,
    offerId: p.offerId,
    ...(audience === 'admin' ? { supplier: { id: p.supplier.id, businessName: p.supplier.businessName } } : {}),
    card: cardView(card, p.finish),
    qty: p.qty,
    agreedUnitCents: p.agreedUnitCents,
    totalCents: p.agreedUnitCents * p.qty,
    status: p.status,
    pickupDueAt: p.pickupDueAt,
    units,
    payableCents: p.payableCents,
    method: p.method,
    reference: p.reference,
    paidAt: p.paidAt,
    createdAt: p.createdAt,
    ...(audience === 'admin' && p.inventoryItems ? { inventoryItemIds: p.inventoryItems.map((i) => i.id) } : {}),
  };
}

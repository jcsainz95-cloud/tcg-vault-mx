import { offerSupplierView, purchaseView, requestSupplierView } from '../src/modules/supply/supply-views';

/** Prueba de FUGA: las vistas de proveedor jamás exponen mercado, %, tope, ajustes internos ni a otras tiendas. */
const FORBIDDEN = ['pctBps', 'marketCents', 'capCents', 'aboveCap', 'fixedPrice', 'adjustBps', 'pctOfMarketBps', 'isBest', 'inventoryItemIds', 'supplier', 'createdById', 'idempotencyKey', 'receiveKey', 'verifyKey'];
const keysDeep = (v: unknown, out: string[] = []): string[] => {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === 'object' && !(v instanceof Date)) for (const [k, x] of Object.entries(v)) { out.push(k); keysDeep(x, out); }
  return out;
};
const now = new Date();
const card: any = { id: 'c1', name: 'Pika', number: '1', setId: 's1', set: { name: 'Set' }, imageSmallUrl: null, imageLargeUrl: null, rarity: 'Rare' };
const req: any = { id: 'r1', cardId: 'c1', card, finish: 'normal', minCondition: 'NM', qtyWanted: 3, qtyReserved: 1, qtyReceived: 0, pctBps: 7000, fixedCents: 5000, status: 'open', source: 'manual', expiresAt: now, createdById: 'u', createdAt: now, updatedAt: now };

describe('§PROV — vistas de proveedor sin fuga', () => {
  it('solicitud', () => {
    const v = requestSupplierView(req, 7000, null);
    expect(keysDeep(v).filter((k) => FORBIDDEN.includes(k))).toEqual([]);
    expect(v.unitCents).toBe(7000);
  });
  it('oferta', () => {
    const v = offerSupplierView({ id: 'o1', requestId: 'r1', request: req, supplierId: 'sx', supplier: { id: 'sx', businessName: 'Otra' }, qty: 1, condition: 'NM', unitCents: 7000, status: 'open', lastActor: 'supplier', expiresAt: now, version: 1, idempotencyKey: 'k', createdAt: now, updatedAt: now, purchase: null } as any);
    expect(keysDeep(v).filter((k) => FORBIDDEN.includes(k))).toEqual([]);
  });
  it('acuerdo (versión proveedor): sin ajustes internos, sin tienda, sin inventario; la del dueño sí los lleva', () => {
    const p: any = {
      id: 'p1', offerId: 'o1', supplierId: 'sx', requestId: 'r1', cardId: 'c1', finish: 'normal', qty: 1, agreedUnitCents: 7000, pickupDueAt: now, status: 'verified',
      cancelReason: null, payableCents: 5000, method: null, reference: null, paidAt: null, createdAt: now, updatedAt: now, idempotencyKey: 'k', receiveKey: 'k', verifyKey: 'k',
      units: [{ id: 'u1', purchaseId: 'p1', n: 1, condition: 'NM', note: null, result: 'adjusted', adjustBps: 7000, unitPayableCents: 5000, inventoryItemId: 'inv' }],
      supplier: { id: 'sx', businessName: 'Otra' }, inventoryItems: [{ id: 'inv' }],
    };
    expect(keysDeep(purchaseView(p, card, 'supplier')).filter((k) => FORBIDDEN.includes(k))).toEqual([]);
    const adminKeys = keysDeep(purchaseView(p, card, 'admin'));
    expect(adminKeys).toEqual(expect.arrayContaining(['adjustBps', 'supplier', 'inventoryItemIds']));
  });
});

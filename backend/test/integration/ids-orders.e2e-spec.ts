/**
 * ids-orders.e2e-spec.ts — 💰 v1.116⟨ids⟩ (API_CONTRACT §IDS.5 «Carrito y checkout», «Pedido») contra Postgres REAL y la app
 * por HTTP. Propiedad: backend.
 *  - IDS-B9 (518, 519, 526): quote y sesión (cuenta e invitado) ⇒ `version` por línea, cobro = suma de las filas, `OrderItem`
 *    congela la versión; fila a `pending` entre quote y sesión ⇒ `422 PRICE_PENDING` con `details.items[].version` y SIN
 *    sesión de Stripe.
 *  - IDS-B19 (parte de pedido): la línea de una pieza Cosmos conserva `cosmos_holo` y su versión aunque la pieza se corrija
 *    después (`GET /orders/:id` lee `OrderItem`).
 * Deterministas (N=1).
 */
import { randomUUID } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { seedE2E } from '../../prisma/seed-e2e';
import { ListingPriceService } from '../../src/modules/pricing/listing-price.service';

jest.setTimeout(120_000);

const ADDRESS = {
  line1: 'Av. Reforma 100',
  line2: 'Depto 3',
  neighborhood: 'Juárez',
  city: 'Ciudad de México',
  state: 'CDMX',
  postalCode: '06600',
  country: 'MX',
  phone: '5512345678',
  recipientName: 'Juan Pérez López',
};

type Line = { inventoryItemId: string; unitPriceCents: number; version: { key: string; language: string; stamp: { productId: number } | null }; finishLabel: string };

describe('E2E — §IDS.5 carrito, checkout y pedido por versión', () => {
  let h: E2EHarness;
  let customer: string;
  let lp: ListingPriceService;
  const run = randomUUID().slice(0, 8);
  const pid = 500_000_000 + Math.floor(Math.random() * 90_000_000);
  let setId: string;
  let cardId: string;
  let cpId: string;
  let shelf: string | null;
  let seq = 0;
  const today = () => new Date(new Date().toISOString().slice(0, 10));

  async function item(data: Record<string, unknown> = {}) {
    seq += 1;
    return h.prisma.inventoryItem.create({
      data: {
        folio: `IDO-${run}-${seq}`,
        cardId,
        productType: 'raw',
        rawCondition: 'NM',
        finish: 'normal',
        ownerType: 'platform',
        status: 'listed',
        acquisitionType: 'compra',
        acquisitionCostCents: 1000,
        firstListedAt: new Date(),
        locationId: shelf,
        ...data,
      },
    });
  }

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    customer = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    lp = h.app.get(ListingPriceService);
    shelf = (await h.prisma.vaultLocation.findFirst({ where: { zone: 'platform_stock', isActive: true } }))?.id ?? null;
    setId = (await h.prisma.cardSet.create({ data: { externalId: `ido-${run}`, name: `Set Pedido ${run}` } })).id;
    cardId = (
      await h.prisma.card.create({
        data: { externalId: `ido-${run}-1`, setId, name: `Carta Pedido ${run}`, number: '144', rarity: 'Common', rarityCanonical: 'Common', availableFinishes: ['normal'] },
      })
    ).id;
    await h.prisma.priceReference.create({
      data: { cardId, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'manual', priceMxnCents: 40_000, capturedDate: today(), isManualOverride: true, refKind: 'market' },
    });
    cpId = (
      await h.prisma.cardProduct.create({
        data: { cardId, tcgplayerProductId: pid, kind: 'stamped', name: `Poffin ${run} (Cosmos Holo)`, finishes: ['holofoil'], stampType: 'prize_pack', stampLabel: 'Cosmos Holo', sourceGroupId: 22880 },
      })
    ).id;
    await h.prisma.priceReference.create({
      data: { cardId, productType: 'raw', gradeKey: 'raw:NM', finish: 'holofoil', source: 'manual', cardProductId: cpId, priceMxnCents: 70_000, capturedDate: today(), isManualOverride: true, refKind: 'market' },
    });
  });

  afterAll(async () => {
    if (h) {
      await lp?.idle();
      const ids = (await h.prisma.inventoryItem.findMany({ where: { cardId }, select: { id: true } })).map((i) => i.id);
      const orderIds = (await h.prisma.orderItem.findMany({ where: { inventoryItemId: { in: ids } }, select: { orderId: true } })).map((o) => o.orderId);
      await h.prisma.inventoryItem.updateMany({ where: { id: { in: ids } }, data: { reservedByOrderId: null } });
      await h.prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
      await h.prisma.order.deleteMany({ where: { id: { in: orderIds } } }).catch(() => undefined);
      await h.prisma.inventoryMovement.deleteMany({ where: { itemId: { in: ids } } });
      await h.prisma.inventoryItem.deleteMany({ where: { id: { in: ids } } }).catch(() => undefined);
      await h.prisma.priceReference.deleteMany({ where: { cardId } });
      await h.prisma.cardProduct.deleteMany({ where: { cardId } });
      await h.prisma.card.deleteMany({ where: { id: cardId } }).catch(() => undefined);
      await h.prisma.cardSet.deleteMany({ where: { id: setId } }).catch(() => undefined);
      await h.close();
    }
  });

  it('IDS-B9: quote y sesión llevan la versión por línea, cobran la suma de las filas y OrderItem la congela; B19: Cosmos se conserva', async () => {
    const en = await item();
    const es = await item({ language: 'es' });
    const cosmos = await item({ language: 'es', cardProductId: pid, finish: 'holofoil' });
    await lp.run('manual_price', [en.id, es.id, cosmos.id]);
    const rows = new Map((await h.prisma.listingPrice.findMany({ where: { inventoryItemId: { in: [en.id, es.id, cosmos.id] } } })).map((r) => [r.inventoryItemId, r]));
    for (const r of rows.values()) expect(r.status).toBe('priced');
    const sum = [en.id, es.id, cosmos.id].reduce((a, id) => a + rows.get(id)!.unitPriceCents!, 0);

    const q = await h.api<{ items: Line[]; breakdown: { subtotalCents: number } }>('POST', '/checkout/quote', {
      token: customer,
      json: { inventoryItemIds: [en.id, es.id, cosmos.id] },
    });
    expect(q.status).toBe(200);
    const byId = new Map(q.body.items.map((l) => [l.inventoryItemId, l]));
    expect(byId.get(en.id)).toMatchObject({ version: { key: 'en', language: 'en', stamp: null }, finishLabel: 'non_holo' });
    expect(byId.get(es.id)).toMatchObject({ version: { key: 'es', language: 'es', stamp: null } });
    expect(byId.get(cosmos.id)).toMatchObject({ version: { key: `es.${pid}`, stamp: { productId: pid } }, finishLabel: 'cosmos_holo' });
    expect(q.body.breakdown.subtotalCents).toBe(sum);

    const s = await h.api<{ orderId: string; breakdown: { subtotalCents: number }; stripe: { paymentIntentId: string } }>('POST', '/checkout/session', {
      token: customer,
      json: { inventoryItemIds: [en.id, es.id, cosmos.id] },
      headers: { 'idempotency-key': `ido-${run}-1` },
    });
    expect(s.status).toBe(201);
    expect(s.body.breakdown.subtotalCents).toBe(sum);
    const ois = new Map((await h.prisma.orderItem.findMany({ where: { orderId: s.body.orderId } })).map((o) => [o.inventoryItemId, o]));
    expect([ois.get(en.id)!.language, ois.get(en.id)!.stampType]).toEqual(['en', null]);
    expect([ois.get(es.id)!.language, ois.get(es.id)!.stampType]).toEqual(['es', null]);
    expect([ois.get(cosmos.id)!.language, ois.get(cosmos.id)!.stampType, ois.get(cosmos.id)!.stampLabel]).toEqual(['es', 'prize_pack', 'Cosmos Holo']);
    expect(ois.get(cosmos.id)!.unitPriceCents).toBe(rows.get(cosmos.id)!.unitPriceCents);

    // B19: la pieza se corrige DESPUÉS (idioma y producto); la línea del pedido no cambia.
    await h.prisma.inventoryItem.update({ where: { id: cosmos.id }, data: { language: 'en' } });
    await h.prisma.cardProduct.update({ where: { id: cpId }, data: { stampLabel: 'Otro' } });
    const o = await h.api<{ items: Line[] }>('GET', `/orders/${s.body.orderId}`, { token: customer });
    expect(o.status).toBe(200);
    const line = o.body.items.find((l) => l.inventoryItemId === cosmos.id)!;
    expect(line).toMatchObject({ version: { key: `es.${pid}`, language: 'es' }, finishLabel: 'cosmos_holo' });
    await h.prisma.cardProduct.update({ where: { id: cpId }, data: { stampLabel: 'Cosmos Holo' } });
  });

  it('IDS-B9 (519): fila a pending entre quote y sesión ⇒ 422 PRICE_PENDING que nombra la versión, sin sesión de Stripe (cuenta e invitado)', async () => {
    const es = await item({ language: 'es' });
    await lp.run('manual_price', [es.id]);
    const q = await h.api('POST', '/checkout/quote', { token: customer, json: { inventoryItemIds: [es.id] } });
    expect(q.status).toBe(200);
    await h.prisma.listingPrice.update({
      where: { inventoryItemId: es.id },
      data: { status: 'pending', unitPriceCents: null, listPriceCents: null, priceBasis: null, marketMxnCents: null, fixedDisplayCents: null },
    });
    const intentsBefore = h.stripe.createdIntents.length;
    const s = await h.api<{ error: { code: string; details: { items: { inventoryItemId: string; version: { key: string } }[] } } }>('POST', '/checkout/session', {
      token: customer,
      json: { inventoryItemIds: [es.id] },
      headers: { 'idempotency-key': `ido-${run}-2` },
    });
    expect(s.status).toBe(422);
    expect(s.body.error.code).toBe('PRICE_PENDING');
    expect(s.body.error.details.items).toEqual([{ inventoryItemId: es.id, version: { key: 'es', language: 'es', stamp: null } }]);
    const g = await h.api<{ error: { code: string; details: { items: { version: { key: string } }[] } } }>('POST', '/checkout/guest/session', {
      json: { inventoryItemIds: [es.id], email: `ido.${run}@example.com`, shippingAddress: ADDRESS, acceptedTerms: true, locale: 'es' },
    });
    expect(g.status).toBe(422);
    expect(g.body.error.details.items[0].version.key).toBe('es');
    expect(h.stripe.createdIntents.length).toBe(intentsBefore);
  });
});

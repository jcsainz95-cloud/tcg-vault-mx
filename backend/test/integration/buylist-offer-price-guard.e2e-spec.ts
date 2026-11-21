/**
 * MESA-1 — guarda de precio visto en `POST /admin/buylist/:id/offer` (docs/API_CONTRACT_BUYLIST_MESA.md).
 * `expectedDerivedCents` opcional por línea: igual ⇒ emite; distinto ⇒ 409 OFFER_PRICE_CHANGED sin efectos;
 * sin el campo ⇒ comportamiento de siempre.
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_CARDS, E2E_USERS } from '../../prisma/e2e-fixtures';

describe('E2E — MESA-1 · guarda de precio visto en offer', () => {
  let h: E2EHarness;
  let customerToken: string;
  let operatorToken: string;
  let charizardId: string;
  let addressId: string;

  async function nuevaSolicitud() {
    const created = await h.api('POST', '/buylist/requests', {
      token: customerToken,
      json: {
        items: [{ cardId: charizardId, productType: 'raw', rawCondition: 'NM' }],
        clabe: '012345678901234567',
        addressId,
      },
    });
    expect(created.status).toBe(201);
    const srId = created.body.sellRequestId as string;
    const item = await h.prisma.sellRequestItem.findFirst({ where: { sellRequestId: srId } });
    const table = await h.api('GET', `/admin/buylist/${srId}/decision-table`, { token: operatorToken });
    expect(table.status).toBe(200);
    const derived = table.body.lines[0].derivedPriceCents as number;
    expect(Number.isInteger(derived)).toBe(true);
    return { srId, itemId: item!.id, derived };
  }
  const offer = (srId: string, line: Record<string, unknown>) =>
    h.api('POST', `/admin/buylist/${srId}/offer`, { token: operatorToken, json: { lines: [line] } });

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    customerToken = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    operatorToken = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    const card = await h.prisma.card.findUnique({ where: { externalId: E2E_CARDS.charizard.externalId } });
    charizardId = card!.id;
    const u = await h.prisma.user.findUnique({ where: { email: E2E_USERS.customer.email } });
    addressId = (await h.prisma.address.findFirst({ where: { userId: u!.id } }))!.id;
  });
  afterAll(async () => {
    await h?.close();
  });

  it('valor igual al vigente ⇒ emite (200) y congela', async () => {
    const { srId, itemId, derived } = await nuevaSolicitud();
    const r = await offer(srId, { itemId, decision: 'buy', expectedDerivedCents: derived });
    expect(r.status).toBe(200);
    const row = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
    expect(row!.offerState).not.toBeNull();
  });

  it('valor distinto ⇒ 409 OFFER_PRICE_CHANGED con detalle y CERO cambios', async () => {
    const { srId, itemId, derived } = await nuevaSolicitud();
    const before = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
    const r = await offer(srId, { itemId, decision: 'buy', expectedDerivedCents: derived + 100 });
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.body)).toContain('OFFER_PRICE_CHANGED');
    const lines = (r.body.details ?? r.body.error?.details).lines;
    expect(lines).toEqual([{ lineId: itemId, expectedCents: derived + 100, currentCents: derived }]);
    const after = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
    expect(after).toEqual(before);
    expect(after!.offerState).toBeNull();
  });

  it('sin el campo ⇒ igual que hoy (200)', async () => {
    const { srId, itemId } = await nuevaSolicitud();
    const r = await offer(srId, { itemId, decision: 'buy' });
    expect(r.status).toBe(200);
  });
});

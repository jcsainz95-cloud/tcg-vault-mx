/**
 * `buylist-flujo-f1.e2e-spec.ts` — §BUYLIST-FLUJO F1 (docs/API_CONTRACT_BUYLIST_FLUJO.md §1-§2). Propiedad: backend.
 *
 * Afirma contra Postgres real y por HTTP (sin mocks de Prisma, sin sembrar el escenario de dinero):
 *  - PARIDAD: el neto que la LECTURA proyecta (`payout.netCents`) == el que `pay-spei` SELLA (`payoutNetCents`), en N solicitudes;
 *  - `expectedNetCents` distinto => 409 PAYOUT_CHANGED y CERO escritura; sin el campo, comportamiento de hoy;
 *  - `reveal-clabe`: `holderName`, y 422 CLABE_MISSING con remedio (antes 404);
 *  - DTOs derivados: `offerNet`, `statusClock`, `tracking`, mesa `readonly` con `offered`, comprobante en `pagada`.
 * Datos ficticios (seed e2e).
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_CARDS, E2E_USERS } from '../../prisma/e2e-fixtures';

const CLABE = '012345678901234567';

describe('E2E — §BUYLIST-FLUJO F1: neto a transferir, 409 sin efectos, CLABE y DTOs derivados', () => {
  let h: E2EHarness;
  let customerToken: string;
  let operatorToken: string;
  let adminToken: string;
  let charizardId: string;
  let addressId: string;
  let customerId: string;

  async function createRequest(n: number): Promise<string> {
    const res = await h.api('POST', '/buylist/requests', {
      token: customerToken,
      json: {
        items: Array.from({ length: n }, () => ({ cardId: charizardId, productType: 'raw' as const, rawCondition: 'NM' as const })),
        clabe: CLABE,
        addressId,
      },
    });
    expect(res.status).toBe(201);
    return (res.body as { sellRequestId: string }).sellRequestId;
  }
  async function detail(srId: string, token = adminToken) {
    const res = await h.api('GET', `/admin/buylist/${srId}`, { token });
    expect(res.status).toBe(200);
    return res.body as any;
  }
  async function offer(srId: string, lines: ('buy' | 'skip')[]) {
    const ids: string[] = (await detail(srId)).items.map((i: any) => i.id);
    const r = await h.api('POST', `/admin/buylist/${srId}/offer`, {
      token: operatorToken,
      json: { lines: ids.map((itemId, i) => ({ itemId, decision: lines[i] })) },
    });
    expect(r.status).toBe(200);
    return ids;
  }
  async function upToStatus(lines: ('buy' | 'skip')[], upTo: 'ofertada' | 'en_transito' | 'verificacion') {
    const srId = await createRequest(lines.length);
    const ids = await offer(srId, lines);
    if (upTo === 'ofertada') return { srId, ids };
    expect((await h.api('POST', `/buylist/requests/${srId}/offer-response`, { token: customerToken, json: { decision: 'accept' } })).status).toBe(200);
    expect((await h.api('POST', `/admin/buylist/${srId}/confirm-shipment`, { token: operatorToken, json: {} })).status).toBe(200);
    if (upTo === 'en_transito') return { srId, ids };
    expect((await h.api('POST', `/admin/buylist/${srId}/receive`, { token: operatorToken })).status).toBe(200);
    expect((await h.api('POST', `/admin/buylist/${srId}/verify`, { token: operatorToken })).status).toBe(200);
    return { srId, ids };
  }
  const decide = (itemId: string, decision: 'approve' | 'reject') =>
    h.api('PATCH', `/admin/buylist/items/${itemId}/decision`, {
      token: operatorToken,
      json: decision === 'approve' ? { decision } : { decision, reason: 'no llega en NM: bordes con whitening' },
    });
  const pay = (srId: string, ref: string, expectedNetCents?: number) =>
    h.api('POST', `/admin/buylist/${srId}/pay-spei`, {
      token: adminToken,
      json: expectedNetCents === undefined ? { speiReference: ref } : { speiReference: ref, expectedNetCents },
    });
  const rowOf = async (srId: string) => {
    const r = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
    return { status: r!.status, payoutNetCents: r!.payoutNetCents, paidAt: r!.paidAt, closedAt: r!.closedAt, speiReference: r!.speiReference, paidBy: r!.paidBy };
  };

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    customerToken = await h.login(E2E_USERS.customer2.email, E2E_USERS.customer2.password);
    operatorToken = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    charizardId = (await h.prisma.card.findUnique({ where: { externalId: E2E_CARDS.charizard.externalId } }))!.id;
    const u = await h.prisma.user.findUnique({ where: { email: E2E_USERS.customer2.email } });
    customerId = u!.id;
    addressId = (await h.prisma.address.findFirst({ where: { userId: customerId } }))!.id;
  });
  afterAll(async () => {
    await h?.close();
  });

  describe('paridad: neto de la LECTURA == neto SELLADO por pay-spei', () => {
    const casos: { nombre: string; lines: ('buy' | 'skip')[]; rechazar: number[] }[] = [
      { nombre: 'una linea buy aprobada', lines: ['buy'], rechazar: [] },
      { nombre: 'buy + skip (cherry-pick)', lines: ['buy', 'skip'], rechazar: [] },
      { nombre: 'dos buy, una rechazada en verificacion', lines: ['buy', 'buy'], rechazar: [1] },
    ];
    for (const c of casos) {
      it(c.nombre, async () => {
        const { srId, ids } = await upToStatus(c.lines, 'verificacion');
        for (let i = 0; i < ids.length; i++) {
          if (c.lines[i] !== 'buy') continue;
          expect((await decide(ids[i], c.rechazar.includes(i) ? 'reject' : 'approve')).status).toBe(200);
        }
        const antes = await detail(srId);
        const p = antes.payout;
        expect(p).not.toBeNull();
        expect(p.isFinal).toBe(true);
        expect(p.clabeOnFile).toBe(true);
        expect(Number.isInteger(p.netCents)).toBe(true);
        expect(p.netCents).toBe(Math.max(0, p.grossCents - p.shippingFeeCents));
        expect(p.grossCents).toBe(antes.approvedTotalCents);
        // ⛔ nunca la CLABE en el DTO (ni en claro ni cifrada).
        expect(JSON.stringify(antes)).not.toContain(CLABE);

        const res = await pay(srId, `SPEI-F1-${c.nombre.length}`, p.netCents);
        expect(res.status).toBe(200);
        const fila = await rowOf(srId);
        expect(fila.payoutNetCents).toBe(p.netCents); // PARIDAD lectura == sellado
        const body = res.body as any;
        // pagada: lo SELLADO + comprobante (referencia, fecha, monto).
        expect(body.payout.netCents).toBe(fila.payoutNetCents);
        expect(body.payoutNetCents).toBe(fila.payoutNetCents);
        expect(body.speiReference).toBe(fila.speiReference);
        expect(body.paidAt).not.toBeNull();
        expect(body.statusClock.since).toBe(new Date(fila.paidAt!).toISOString());
      });
    }
  });

  describe('expectedNetCents — 409 PAYOUT_CHANGED sin efectos', () => {
    it('distinto => 409 con details y CERO escritura; el correcto despues => 200', async () => {
      const { srId, ids } = await upToStatus(['buy'], 'verificacion');
      expect((await decide(ids[0], 'approve')).status).toBe(200);
      const net = (await detail(srId)).payout.netCents as number;
      const antes = await rowOf(srId);
      const res = await pay(srId, 'SPEI-F1-409', net + 100);
      expect(res.status).toBe(409);
      expect((res.body as any).error.code).toBe('PAYOUT_CHANGED');
      expect((res.body as any).error.details).toEqual({ expectedNetCents: net + 100, currentNetCents: net });
      expect(await rowOf(srId)).toEqual(antes);
      expect((await rowOf(srId)).paidAt).toBeNull();
      expect((await rowOf(srId)).payoutNetCents).toBeNull();
      expect((await pay(srId, 'SPEI-F1-409', net)).status).toBe(200);
      expect((await rowOf(srId)).payoutNetCents).toBe(net);
    });

    it('sin el campo = comportamiento de hoy (200); expectedNetCents negativo => 400', async () => {
      const { srId, ids } = await upToStatus(['buy'], 'verificacion');
      expect((await decide(ids[0], 'approve')).status).toBe(200);
      expect((await pay(srId, 'SPEI-F1-NEG', -1)).status).toBe(400);
      expect((await rowOf(srId)).paidAt).toBeNull();
      expect((await pay(srId, 'SPEI-F1-NOFIELD')).status).toBe(200);
    });
  });

  describe('reveal-clabe: holderName y CLABE_MISSING', () => {
    it('holderName = nombre del vendedor; sin CLABE => 422 CLABE_MISSING {remedy} (no 404)', async () => {
      const { srId } = await upToStatus(['buy'], 'ofertada');
      const ok = await h.api('GET', `/admin/buylist/${srId}/reveal-clabe`, { token: adminToken });
      expect(ok.status).toBe(200);
      const b = ok.body as any;
      expect(b.clabe).toBe(CLABE);
      const kyc = await h.prisma.kycProfile.findUnique({ where: { userId: customerId } });
      const user = await h.prisma.user.findUnique({ where: { id: customerId } });
      expect(b.holderName).toBe((kyc?.legalName ?? user!.name).trim());
      expect(b.holderName.length).toBeGreaterThan(0);

      await h.prisma.sellRequest.update({ where: { id: srId }, data: { clabeSnapshotEnc: null } });
      await h.prisma.kycProfile.update({ where: { userId: customerId }, data: { clabeEnc: null } });
      const miss = await h.api('GET', `/admin/buylist/${srId}/reveal-clabe`, { token: adminToken });
      expect(miss.status).toBe(422);
      expect((miss.body as any).error.code).toBe('CLABE_MISSING');
      expect((miss.body as any).error.details).toEqual({ remedy: 'ask_seller_clabe' });
    });
  });

  describe('DTOs derivados F1b/F1c', () => {
    it('cotizada: payout/offerNet/tracking null, statusClock desde createdAt, mesa en edit', async () => {
      const srId = await createRequest(1);
      const d = await detail(srId);
      expect(d.payout).toBeNull();
      expect(d.offerNet).toBeNull();
      expect(d.tracking).toBeNull();
      expect(d.statusClock.waitingDays).toBe(0);
      expect(d.statusClock.overdue).toBe(false);
      const mesa = await h.api('GET', `/admin/buylist/${srId}/decision-table`, { token: operatorToken });
      expect(mesa.status).toBe(200);
      expect((mesa.body as any).mode).toBe('edit');
      expect((mesa.body as any).lines[0].offered).toBeNull();
    });

    it('ofertada: offerNet = congelado, statusClock con plazo, agreedPriceCents = offeredPriceCents, mesa readonly con offered', async () => {
      const { srId } = await upToStatus(['buy', 'skip'], 'ofertada');
      const d = await detail(srId);
      expect(d.offerNet).toEqual({
        grossCents: d.offerGrossCents,
        shippingFeeCents: d.offerShippingFeeCents,
        netCents: d.offerNetCents,
        expiresAt: d.offerAcceptDeadlineAt,
      });
      expect(d.offerNet.netCents).toBe(Math.max(0, d.offerGrossCents - d.offerShippingFeeCents));
      expect(d.statusClock.dueAt).toBe(d.offerAcceptDeadlineAt);
      expect(d.statusClock.since).toBe(d.offerSentAt);
      expect(d.payout).toBeNull();
      const buy = d.items.find((i: any) => i.offerDecision === 'buy');
      const skip = d.items.find((i: any) => i.offerDecision === 'skip');
      expect(buy.agreedPriceCents).toBe(buy.offeredPriceCents);
      expect(skip.agreedPriceCents).toBeNull();
      const mesa = (await h.api('GET', `/admin/buylist/${srId}/decision-table`, { token: operatorToken })).body as any;
      expect(mesa.mode).toBe('readonly');
      expect(mesa.requiresAuthorization).toBe(false);
      const lb = mesa.lines.find((l: any) => l.itemId === buy.id);
      expect(lb.offered.priceCents).toBe(buy.offeredPriceCents);
      expect(Object.keys(lb.offered).sort()).toEqual(['derivedAtOfferCents', 'marketAtOfferCents', 'overrideReason', 'priceCents']);
      expect(mesa.lines.find((l: any) => l.itemId === skip.id).offered).toBeNull();
      // el vendedor NO ve nada de esto.
      const mine = (await h.api('GET', `/buylist/requests/${srId}`, { token: customerToken })).body as any;
      for (const k of ['payout', 'offerNet', 'statusClock', 'tracking']) expect(mine).not.toHaveProperty(k);
    });

    it('en_transito: tracking {carrier,number,url:null,daysInTransit} sin inventar URL', async () => {
      const { srId } = await upToStatus(['buy'], 'en_transito');
      const d = await detail(srId);
      expect(d.status).toBe('en_transito');
      expect(d.tracking).toEqual({ carrier: null, number: null, url: null, daysInTransit: 0 });
      expect(d.statusClock.since).toBe(d.shipmentConfirmedAt);
    });

    it('verificacion con linea sin decidir => payout.isFinal=false', async () => {
      const { srId } = await upToStatus(['buy'], 'verificacion');
      const d = await detail(srId);
      expect(d.payout.isFinal).toBe(false);
      expect(d.pendingDecisionItemCount).toBe(1);
    });
  });
});

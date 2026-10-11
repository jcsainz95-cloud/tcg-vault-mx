/**
 * seed-spei-bucket.e2e-spec.ts — P-REL-3: la cubeta SPEI sembrada (`seedE2E` paso 13, `E2E_SPEI_FIXTURE`). Propiedad:
 * backend. Contra Postgres REAL y la app Nest completa por HTTP.
 *
 * Lo que fija:
 *  1. La siembra deja DOS `ManualRefund` `pending` (`e2e:mr-pay`, `e2e:mr-cancel`) de un cliente propio, con su caso
 *     `refunded` y la pieza original; la identidad del importe cuadra y todos los componentes son > 0.
 *  2. **Idempotencia:** dos siembras seguidas ⇒ el MISMO estado (ids incluidos).
 *  3. **Restauración (N=3 ciclos):** el recorrido que hará el E2E de frontend —el cliente pone su CLABE con
 *     `PUT /users/me/kyc`; el súper-admin revela y PAGA una y CANCELA y RE-EMITE la otra— y una nueva siembra devuelve
 *     exactamente el estado del punto 2 (sin re-emisión colgando, sin CLABE, sellos a `null`).
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_SPEI_FIXTURE, E2E_USERS } from '../../prisma/e2e-fixtures';

const F = E2E_SPEI_FIXTURE;
const KEYS = [F.rows.pay.idempotencyKey, F.rows.cancel.idempotencyKey];
const CYCLES = 3;

describe('P-REL-3 — la cubeta SPEI sembrada (Postgres real)', () => {
  let h: E2EHarness;

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
  });

  afterAll(async () => {
    // Deja la cubeta como la encontró la siguiente suite: sembrada y `pending`. `finally`: si la siembra falla (una
    // regresión del paso 13), la app se cierra igual — sin él, jest no termina y la corrida se cuelga.
    try {
      if (h) await seedE2E(h.prisma);
    } finally {
      await h?.close();
    }
  });

  /** Todo lo que el paso 13 declara, sin `passwordHash` (argon2 sala distinto en cada siembra). */
  async function snapshot() {
    const user = await h.prisma.user.findUniqueOrThrow({
      where: { email: F.customer.email },
      select: { id: true, email: true, name: true, nameSource: true, role: true, phone: true, emailVerified: true, status: true, mustChangePassword: true },
    });
    const mrs = await h.prisma.manualRefund.findMany({ where: { customerUserId: user.id }, orderBy: { idempotencyKey: 'asc' } });
    const cases = await h.prisma.replacementCase.findMany({ where: { customerUserId: user.id }, orderBy: { refundAmountCents: 'asc' } });
    const order = await h.prisma.order.findUniqueOrThrow({ where: { orderNumber: F.order.orderNumber }, include: { items: { orderBy: { unitPriceCents: 'asc' } } } });
    const placement = await h.prisma.vaultPlacement.findUniqueOrThrow({ where: { orderId: order.id }, include: { items: { orderBy: { id: 'asc' } } } });
    // `updatedAt` (@updatedAt) avanza con cada `upsert` aunque el estado declarado sea el mismo: fuera de la comparación.
    const pieces = (await h.prisma.inventoryItem.findMany({ where: { folio: { in: [F.rows.pay.folio, F.rows.cancel.folio] } }, orderBy: { folio: 'asc' } })).map(
      ({ updatedAt: _u, ...rest }) => rest,
    );
    const kyc = await h.prisma.kycProfile.findUnique({ where: { userId: user.id } });
    return JSON.parse(JSON.stringify({ user, mrs, cases, order, placement, pieces, kyc }));
  }

  it('siembra: dos filas `pending` con su caso `refunded`, importes que cuadran y > 0, origen `settled`', async () => {
    const s = await snapshot();
    expect(s.mrs.map((m: any) => m.idempotencyKey)).toEqual([...KEYS].sort());
    for (const m of s.mrs) {
      const want = m.idempotencyKey === F.rows.pay.idempotencyKey ? F.rows.pay : F.rows.cancel;
      expect(m).toMatchObject({
        status: 'pending',
        source: 'case_excess',
        amountCents: want.amountCents,
        merchandiseCents: want.merchandiseCents,
        merchandiseIvaCents: want.merchandiseIvaCents,
        processingFeeCents: want.processingFeeCents,
        compensationCents: want.compensationCents,
        orderId: s.order.id,
        paymentRefundId: null,
        paidAt: null,
        cancelledAt: null,
        reissuedFromId: null,
      });
      expect(m.amountCents).toBe(m.merchandiseCents + m.processingFeeCents + m.compensationCents);
      for (const c of ['amountCents', 'merchandiseCents', 'merchandiseIvaCents', 'processingFeeCents', 'compensationCents']) expect(m[c]).toBeGreaterThan(0);
      const kase = s.cases.find((c: any) => c.id === m.replacementCaseId);
      expect(kase).toMatchObject({ status: 'refunded', source: 'vault_purchase', refundAmountCents: m.amountCents, customerUserId: s.user.id });
    }
    expect(s.order).toMatchObject({ status: 'settled', fulfillmentMode: 'vault', userId: s.user.id });
    expect(s.kyc).toBeNull();
    expect(s.user).toMatchObject({ role: 'customer', emailVerified: true, status: 'active', name: F.customer.name });
  });

  it('idempotencia: dos siembras seguidas ⇒ el MISMO estado (ids incluidos)', async () => {
    const a = await snapshot();
    await seedE2E(h.prisma);
    await seedE2E(h.prisma);
    expect(await snapshot()).toEqual(a);
  });

  it(`restauración: CLABE + revelar/pagar + cancelar/re-emitir por HTTP, y la siembra lo devuelve todo (N=${CYCLES})`, async () => {
    const base = await snapshot();
    const admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    let restored = 0;
    for (let i = 0; i < CYCLES; i += 1) {
      const cli = await h.login(F.customer.email, F.customer.password);
      const clabe = `0021800000000000${String(10 + i)}`;
      expect((await h.api('PUT', '/users/me/kyc', { token: cli, json: { clabe } })).status).toBe(200);

      const list = await h.api('GET', `/admin/manual-refunds?status=pending&q=${encodeURIComponent(F.customer.email)}`, { token: admin });
      expect(list.status).toBe(200);
      const byKey = new Map(base.mrs.map((m: any) => [m.idempotencyKey, m.id]));
      const payId = byKey.get(F.rows.pay.idempotencyKey) as string;
      const cancelId = byKey.get(F.rows.cancel.idempotencyKey) as string;
      expect(list.body.data.map((d: any) => d.id).sort()).toEqual([payId, cancelId].sort());
      const payDto = list.body.data.find((d: any) => d.id === payId);
      expect(payDto).toMatchObject({ status: 'pending', clabeOnFile: true, beneficiaryName: F.customer.name, origin: { orderStatus: 'settled' } });

      const rev = await h.api('GET', `/admin/manual-refunds/${payId}/reveal-clabe`, { token: admin });
      expect(rev.status).toBe(200);
      expect(rev.body.clabe).toBe(clabe);
      const paid = await h.api('POST', `/admin/manual-refunds/${payId}/paid`, {
        token: admin,
        json: { revealToken: rev.body.revealToken, speiReference: `E2ESPEI${i}`, note: 'pagada', confirmRecentClabeChange: true },
      });
      expect(paid.status).toBe(200);
      expect(paid.body).toMatchObject({ status: 'paid', outcome: 'paid' });

      expect((await h.api('POST', `/admin/manual-refunds/${cancelId}/cancel`, { token: admin, json: { note: 'cancelada e2e' } })).status).toBe(200);
      const re = await h.api('POST', `/admin/manual-refunds/${cancelId}/reissue`, { token: admin, json: { note: 'reemitida e2e' } });
      expect(re.status).toBe(200);
      expect(re.body).toMatchObject({ status: 'pending', reissuedFromId: cancelId });

      await seedE2E(h.prisma);
      const after = await snapshot();
      expect(after).toEqual(base);
      restored += 1;
    }
    expect(restored).toBe(CYCLES);
  });
});

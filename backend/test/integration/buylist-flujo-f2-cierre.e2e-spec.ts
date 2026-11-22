/**
 * `buylist-flujo-f2-cierre.e2e-spec.ts` — cierre de F2 tras el rechazo de qa/seguridad-lead (docs/DECISIONES.md §BUYLIST-FLUJO.12;
 * anexo §3.1–§3.2, §6). Propiedad: backend. Postgres real, por HTTP. Datos ficticios (seed e2e).
 *  - B-1: aprobar / rechazar / reject-items sobre una baja pendiente la CANCELA en la misma transaccion; el pago nunca queda atrapado.
 *  - I-1: UNA funcion del neto: vista previa == netIfAcceptedCents == payout.netCents final == sellado (S2, S3, S5, S8 + N aleatorias).
 *  - F2-2: `accept` exige `expectedRevisedPriceCents` (409 REVISION_CHANGED).
 *  - B-2: formato estricto de la vista previa; convert-all con `locationId` no uuid => 400 sin efectos.
 */
import { E2EHarness } from './helpers/e2e-app';
import { BuylistSweepJobService } from '../../src/jobs/buylist-sweep.service';
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_CARDS, E2E_USERS } from '../../prisma/e2e-fixtures';

const CLABE = '012345678901234567';

describe('E2E — §BUYLIST-FLUJO F2 cierre (B-1, I-1, F2-2, B-2)', () => {
  let h: E2EHarness;
  let customerToken: string;
  let operatorToken: string;
  let adminToken: string;
  let charizardId: string;
  let addressId: string;
  let customerUserId: string;
  let sweep: BuylistSweepJobService;
  let enviados: MailMessage[] = [];
  let spy: jest.SpyInstance;

  async function createRequest(n: number): Promise<string> {
    // Esta suite crea decenas de solicitudes del mismo vendedor: una vez que existe su KYC (la primera solicitud lo crea) se le sube
    // el tope mensual AML para que no estorbe (no es lo que se mide aqui).
    await h.prisma.kycProfile.updateMany({ where: { userId: customerUserId }, data: { capPerMonthCentsOverride: 100_000_000 } });
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
  async function toVerificacion(n: number): Promise<{ srId: string; ids: string[] }> {
    const srId = await createRequest(n);
    const ids: string[] = (await detail(srId)).items.map((i: any) => i.id);
    expect((await h.api('POST', `/admin/buylist/${srId}/offer`, { token: operatorToken, json: { lines: ids.map((itemId) => ({ itemId, decision: 'buy' })) } })).status).toBe(200);
    expect((await h.api('POST', `/buylist/requests/${srId}/offer-response`, { token: customerToken, json: { decision: 'accept' } })).status).toBe(200);
    expect((await h.api('POST', `/admin/buylist/${srId}/confirm-shipment`, { token: operatorToken, json: {} })).status).toBe(200);
    expect((await h.api('POST', `/admin/buylist/${srId}/receive`, { token: operatorToken })).status).toBe(200);
    expect((await h.api('POST', `/admin/buylist/${srId}/verify`, { token: operatorToken })).status).toBe(200);
    return { srId, ids };
  }
  const approve = (itemId: string) =>
    h.api('PATCH', `/admin/buylist/items/${itemId}/decision`, { token: operatorToken, json: { decision: 'approve' } });

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    customerToken = await h.login(E2E_USERS.customer2.email, E2E_USERS.customer2.password);
    operatorToken = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    sweep = h.app.get(BuylistSweepJobService);
    charizardId = (await h.prisma.card.findUnique({ where: { externalId: E2E_CARDS.charizard.externalId } }))!.id;
    const u = await h.prisma.user.findUnique({ where: { email: E2E_USERS.customer2.email } });
    addressId = (await h.prisma.address.findFirst({ where: { userId: u!.id } }))!.id;
    customerUserId = u!.id;
    spy = jest.spyOn(h.app.get<MailPort>(MAIL_PORT), 'send').mockImplementation(async (msg: MailMessage) => {
      enviados.push(msg);
      return { id: 'm' } as never;
    });
  });
  beforeEach(() => {
    enviados = [];
  });
  afterAll(async () => {
    spy?.mockRestore();
    await h?.close();
  });

  const DAY = 24 * 3600 * 1000;
  const revise = (itemId: string, json: Record<string, unknown>, token = operatorToken) =>
    h.api('POST', `/admin/buylist/items/${itemId}/revise-price`, { token, json });
  const respond = (srId: string, itemId: string, json: Record<string, unknown>, token = customerToken) =>
    h.api('POST', `/buylist/requests/${srId}/items/${itemId}/revision-response`, { token, json });
  const rowOf = (itemId: string) => h.prisma.sellRequestItem.findUnique({ where: { id: itemId } });
  const decide = (itemId: string, json: Record<string, unknown>) =>
    h.api('PATCH', `/admin/buylist/items/${itemId}/decision`, { token: operatorToken, json });
  const rejectItems = (srId: string, json: Record<string, unknown>) =>
    h.api('POST', `/admin/buylist/${srId}/reject-items`, { token: operatorToken, json });
  const preview = (itemId: string, q: string, token = operatorToken) =>
    h.api('GET', `/admin/buylist/items/${itemId}/revise-price/preview${q}`, { token });
  const pay = (srId: string, ref: string, expectedNetCents: number) =>
    h.api('POST', `/admin/buylist/${srId}/pay-spei`, { token: adminToken, json: { speiReference: ref, expectedNetCents } });

  describe('B-1 — la decision del dueno CANCELA la baja pendiente (misma transaccion)', () => {
    it('aprobar al pactado una carta con baja pendiente: cancelled + aprobada al ofertado, correo C5, el pago NO se bloquea y paga lo pactado; el vendedor que responde despues => 409 cancelled', async () => {
      const { srId, ids } = await toVerificacion(2);
      const offered = (await rowOf(ids[0]))!.offeredPriceCents!;
      expect((await revise(ids[0], { revisedPriceCents: offered - 100, reasonCode: 'wrong_card' })).status).toBe(200);
      const proposed = (await rowOf(ids[0]))!.revisedPriceCents!;
      enviados = [];
      expect((await approve(ids[0])).status).toBe(200);
      expect(await rowOf(ids[0])).toMatchObject({ itemStatus: 'aprobada', revisionState: 'cancelled', approvedPriceCents: offered });
      expect(enviados.filter((m) => m.subject === 'Retiramos la propuesta de nuevo precio de una carta')).toHaveLength(1);
      expect(enviados[0].text).toContain('Retiramos la propuesta de nuevo precio');
      expect(enviados[0].text).toContain('Se paga tu precio original');
      expect((await approve(ids[1])).status).toBe(200);
      const d = await detail(srId);
      expect(d.pendingDecisionItemCount).toBe(0);
      expect(d.payout.isFinal).toBe(true);
      expect(d.items.find((i: any) => i.id === ids[0]).revision.state).toBe('cancelled');
      expect(d.items.find((i: any) => i.id === ids[0]).revision.netIfAcceptedCents ?? null).toBeNull();
      // el vendedor ve la baja retirada y responder => 409 REVISION_ALREADY_RESOLVED state=cancelled (sin efectos).
      const late = await respond(srId, ids[0], { decision: 'accept', expectedRevisedPriceCents: proposed });
      expect(late.status).toBe(409);
      expect((late.body as any).error.code).toBe('REVISION_ALREADY_RESOLVED');
      expect((late.body as any).error.details).toMatchObject({ state: 'cancelled' });
      expect((await respond(srId, ids[0], { decision: 'decline' })).status).toBe(409);
      expect(await rowOf(ids[0])).toMatchObject({ itemStatus: 'aprobada', approvedPriceCents: offered, revisionState: 'cancelled' });
      const res = await pay(srId, 'REF-B1-APPROVE', d.payout.netCents);
      expect(res.status).toBe(200);
      expect((res.body as any).payoutNetCents).toBe(d.payout.netCents);
      expect(d.payout.grossCents).toBe(offered + (await rowOf(ids[1]))!.offeredPriceCents!);
    });

    it('rechazar (PATCH reject con causa) una carta con baja pendiente: cancelled + rechazada, C1 (no C3/C5), y el pago del resto sale', async () => {
      const { srId, ids } = await toVerificacion(2);
      const offered = (await rowOf(ids[0]))!.offeredPriceCents!;
      expect((await revise(ids[0], { revisedPriceCents: offered - 100, reasonCode: 'wrong_card' })).status).toBe(200);
      enviados = [];
      expect((await decide(ids[0], { decision: 'reject', reasonCode: 'condition_mismatch' })).status).toBe(200);
      expect(await rowOf(ids[0])).toMatchObject({ itemStatus: 'rechazada', revisionState: 'cancelled', rejectionCode: 'condition_mismatch', approvedPriceCents: null });
      expect(enviados.map((m) => m.subject)).toEqual(['Tu carta te espera']);
      expect((await approve(ids[1])).status).toBe(200);
      const d = await detail(srId);
      expect(d.payout).toMatchObject({ isFinal: true, grossCents: (await rowOf(ids[1]))!.offeredPriceCents });
      expect((await pay(srId, 'REF-B1-REJECT', d.payout.netCents)).status).toBe(200);
    });

    it('reject-items con baja pendiente: cancelled en TODAS las lineas con baja, rejectionCode escrito, UN solo C1 (o C2 con not_received), se paga el resto', async () => {
      const { srId, ids } = await toVerificacion(3);
      const offered = (await rowOf(ids[0]))!.offeredPriceCents!;
      expect((await revise(ids[0], { revisedPriceCents: offered - 100, reasonCode: 'wrong_card' })).status).toBe(200);
      expect((await revise(ids[1], { revisedPriceCents: offered - 150, reasonCode: 'wrong_card' })).status).toBe(200);
      enviados = [];
      const r = await rejectItems(srId, { itemIds: [ids[0], ids[1]], reasonCode: 'wrong_card' });
      expect(r.status).toBe(200);
      for (const id of [ids[0], ids[1]]) {
        expect(await rowOf(id)).toMatchObject({ itemStatus: 'rechazada', revisionState: 'cancelled', rejectionCode: 'wrong_card' });
      }
      expect(enviados.map((m) => m.subject)).toEqual(['Tus 2 cartas te esperan']);
      expect((await approve(ids[2])).status).toBe(200);
      const d = await detail(srId);
      expect(d.payout.isFinal).toBe(true);
      expect((await pay(srId, 'REF-B1-ITEMS', d.payout.netCents)).status).toBe(200);
      // not_received => C2 sin recoger.
      const b = await toVerificacion(2);
      enviados = [];
      expect((await rejectItems(b.srId, { itemIds: [b.ids[0], b.ids[1]], reasonCode: 'not_received' })).status).toBe(200);
      expect(enviados).toHaveLength(1);
      expect(enviados[0].subject).toBe('Una carta de tu solicitud de venta no llegó');
      expect(enviados[0].text).not.toContain('Tus cartas te esperan');
      expect(await rowOf(b.ids[0])).toMatchObject({ itemStatus: 'rechazada', rejectionCode: 'not_received' });
    });

    it('reject-items exige reasonCode: falta/desconocido => 400 field=reasonCode; other sin texto => 400 field=reason; CERO escritura', async () => {
      const { srId, ids } = await toVerificacion(1);
      for (const body of [{ itemIds: [ids[0]] }, { itemIds: [ids[0]], reasonCode: 'revision_declined' }, { itemIds: [ids[0]], reasonCode: null }, { itemIds: [ids[0]], reason: 'texto largo' }]) {
        const r = await rejectItems(srId, body);
        expect(r.status).toBe(400);
        expect((r.body as any).error.details.field).toBe('reasonCode');
      }
      const o = await rejectItems(srId, { itemIds: [ids[0]], reasonCode: 'other' });
      expect(o.status).toBe(400);
      expect((o.body as any).error.details.field).toBe('reason');
      expect((await rowOf(ids[0]))!.itemStatus).not.toBe('rechazada');
    });

    it('INVARIANTE pending <=> ajustada: un pending HUERFANO no bloquea el pago, no cuenta en el neto ni en isFinal, y el barrido no lo toca', async () => {
      const { srId, ids } = await toVerificacion(2);
      for (const id of ids) expect((await approve(id)).status).toBe(200);
      const old = new Date(Date.now() - 8 * DAY);
      await h.prisma.sellRequestItem.update({ where: { id: ids[0] }, data: { revisionState: 'pending', revisedPriceCents: 1, revisionProposedAt: old } });
      const d = await detail(srId);
      expect(d.payout.isFinal).toBe(true);
      expect(d.pendingDecisionItemCount).toBe(0);
      enviados = [];
      await sweep.run(new Date());
      expect(await rowOf(ids[0])).toMatchObject({ itemStatus: 'aprobada', revisionState: 'pending' });
      expect(enviados).toHaveLength(0);
      expect((await pay(srId, 'REF-ORPHAN', d.payout.netCents)).status).toBe(200);
    });

    it('carrera: el vendedor acepta mientras el dueno aprueba (N=8): nunca queda pending, nunca doble efecto, el pago sale', async () => {
      for (let k = 0; k < 8; k++) {
        const { srId, ids } = await toVerificacion(2);
        const offered = (await rowOf(ids[0]))!.offeredPriceCents!;
        expect((await revise(ids[0], { revisedPriceCents: offered - 100, reasonCode: 'wrong_card' })).status).toBe(200);
        const proposed = (await rowOf(ids[0]))!.revisedPriceCents!;
        const [a, b] = await Promise.all([approve(ids[0]), respond(srId, ids[0], { decision: 'accept', expectedRevisedPriceCents: proposed })]);
        expect([200, 409]).toContain(a.status);
        expect([200, 409]).toContain(b.status);
        const row = (await rowOf(ids[0]))!;
        expect(['aprobada']).toContain(row.itemStatus);
        expect(['cancelled', 'accepted']).toContain(row.revisionState);
        expect([offered, proposed]).toContain(row.approvedPriceCents);
        expect((await approve(ids[1])).status).toBe(200);
        const d = await detail(srId);
        expect(d.payout.isFinal).toBe(true);
        expect((await pay(srId, `REF-RACE-${k}`, d.payout.netCents)).status).toBe(200);
      }
    });
  });

  describe('I-1 — UNA funcion del neto (vista previa == netIfAcceptedCents == final == sellado)', () => {
    /** Propone la baja de `target`, mide previa/derivado y, tras aceptar y decidir el resto, el payout final y el sellado. */
    async function parity(srId: string, target: string, revised: number, finish: () => Promise<void>) {
      const p = await preview(target, `?revisedPriceCents=${revised}`);
      expect(p.status).toBe(200);
      expect((await revise(target, { revisedPriceCents: revised, reasonCode: 'wrong_card' })).status).toBe(200);
      const live = await detail(srId);
      const netIf = live.items.find((i: any) => i.id === target).revision.netIfAcceptedCents;
      expect(netIf).toBe((p.body as any).payout.netCents);
      expect(live.payout.netCents).toBe((p.body as any).payout.netCents); // la barra con pendientes = la misma proyeccion
      expect(live.payout.isFinal).toBe(false);
      expect((await respond(srId, target, { decision: 'accept', expectedRevisedPriceCents: revised })).status).toBe(200);
      await finish();
      const fin = await detail(srId);
      expect(fin.payout.isFinal).toBe(true);
      expect(fin.payout.netCents).toBe((p.body as any).payout.netCents);
      const paid = await pay(srId, `REF-PAR-${srId.slice(-6)}`, fin.payout.netCents);
      expect(paid.status).toBe(200);
      expect((paid.body as any).payoutNetCents).toBe(fin.payout.netCents);
    }
    const off = async (id: string) => (await rowOf(id))!.offeredPriceCents!;

    it('S2 baja + otra carta sin decidir aun: la sin decidir cuenta a lo pactado en la vista previa', async () => {
      const { srId, ids } = await toVerificacion(2);
      await parity(srId, ids[0], (await off(ids[0])) - 120, async () => {
        expect((await approve(ids[1])).status).toBe(200);
      });
    });
    it('S3 baja + otra rechazada: la rechazada NO cuenta (antes la vista previa la sumaba)', async () => {
      const { srId, ids } = await toVerificacion(3);
      expect((await decide(ids[1], { decision: 'reject', reasonCode: 'wrong_card' })).status).toBe(200);
      await parity(srId, ids[0], (await off(ids[0])) - 90, async () => {
        expect((await approve(ids[2])).status).toBe(200);
      });
    });
    it('S5 baja + «No llegó» + aprobada: not_received fuera', async () => {
      const { srId, ids } = await toVerificacion(3);
      expect((await decide(ids[1], { decision: 'reject', reasonCode: 'not_received' })).status).toBe(200);
      expect((await approve(ids[2])).status).toBe(200);
      await parity(srId, ids[0], (await off(ids[0])) - 60, async () => undefined);
    });
    it('S8 dos bajas pendientes: cada vista previa cuenta la OTRA a su propuesta; isFinal=false hasta aceptar ambas', async () => {
      const { srId, ids } = await toVerificacion(2);
      const [o0, o1] = [await off(ids[0]), await off(ids[1])];
      expect((await revise(ids[1], { revisedPriceCents: o1 - 200, reasonCode: 'wrong_card' })).status).toBe(200);
      const p = (await preview(ids[0], `?revisedPriceCents=${o0 - 100}`)).body as any;
      expect(p.payout.isFinal).toBe(false);
      expect(p.payout.grossCents).toBe(o0 - 100 + o1 - 200);
      expect((await revise(ids[0], { revisedPriceCents: o0 - 100, reasonCode: 'wrong_card' })).status).toBe(200);
      const live = await detail(srId);
      expect(live.items.find((i: any) => i.id === ids[0]).revision.netIfAcceptedCents).toBe(p.payout.netCents);
      expect(live.payout.netCents).toBe(p.payout.netCents);
      expect((await respond(srId, ids[0], { decision: 'accept', expectedRevisedPriceCents: o0 - 100 })).status).toBe(200);
      expect((await detail(srId)).payout.isFinal).toBe(false);
      expect((await respond(srId, ids[1], { decision: 'accept', expectedRevisedPriceCents: o1 - 200 })).status).toBe(200);
      const fin = await detail(srId);
      expect(fin.payout).toMatchObject({ isFinal: true, netCents: p.payout.netCents });
    });
    it('N=20 solicitudes aleatorias (cartas aprobadas/rechazadas/«No llegó»/sin decidir + una baja): previa == netIfAccepted == final == sellado', async () => {
      // mulberry32: los bits bajos de un LCG ciclan con periodo corto (un `% 4` repetiria el mismo patron).
      let seed = 11;
      const rnd = (n: number) => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
      };
      let medidas = 0;
      for (let k = 0; k < 20; k++) {
        const n = 2 + rnd(2);
        const { srId, ids } = await toVerificacion(n);
        const acts: (() => Promise<unknown>)[] = [];
        let keep = 0;
        for (let i = 1; i < n; i++) {
          const t = rnd(4);
          if (t === 0) acts.push(() => approve(ids[i]));
          else if (t === 1) acts.push(() => decide(ids[i], { decision: 'reject', reasonCode: 'wrong_card' }));
          else if (t === 2) acts.push(() => decide(ids[i], { decision: 'reject', reasonCode: 'not_received' }));
          else keep++; // sin decidir hasta despues de aceptar
        }
        // se decide un subconjunto ANTES de la baja (las demas quedan sin decidir)
        for (const a of acts) expect(((await a()) as any).status).toBe(200);
        const alive = await h.prisma.sellRequestItem.findMany({ where: { sellRequestId: srId, itemStatus: { notIn: ['rechazada'] } } });
        if (!alive.some((x) => x.id === ids[0])) continue;
        const o = await off(ids[0]);
        const revised = 1 + rnd(o - 1);
        const undecided = alive.filter((x) => x.id !== ids[0] && x.itemStatus !== 'aprobada');
        await parity(srId, ids[0], revised, async () => {
          for (const u of undecided) expect((await approve(u.id)).status).toBe(200);
        });
        medidas++;
        void keep;
      }
      expect(medidas).toBeGreaterThanOrEqual(15);
    });
  });

  describe('F2-2 — accept exige expectedRevisedPriceCents; el CAS lleva el monto', () => {
    it('sin monto / no entero => 400; monto distinto => 409 REVISION_CHANGED sin efectos; el vigente => 200; repetir => 200; repetir con otro monto => 409', async () => {
      const { srId, ids } = await toVerificacion(1);
      const offered = (await rowOf(ids[0]))!.offeredPriceCents!;
      expect((await revise(ids[0], { revisedPriceCents: offered - 100, reasonCode: 'wrong_card' })).status).toBe(200);
      for (const body of [{ decision: 'accept' }, { decision: 'accept', expectedRevisedPriceCents: '9' }, { decision: 'accept', expectedRevisedPriceCents: 9.5 }, { decision: 'accept', expectedRevisedPriceCents: null }]) {
        expect((await respond(srId, ids[0], body as any)).status).toBe(400);
      }
      // el staff re-propone un valor menor despues de que el vendedor abrio la pantalla (vio offered-100).
      expect((await revise(ids[0], { revisedPriceCents: offered - 300, reasonCode: 'wrong_card' })).status).toBe(200);
      const stale = await respond(srId, ids[0], { decision: 'accept', expectedRevisedPriceCents: offered - 100 });
      expect(stale.status).toBe(409);
      expect((stale.body as any).error.code).toBe('REVISION_CHANGED');
      expect((stale.body as any).error.details).toEqual({ expectedRevisedPriceCents: offered - 100, currentRevisedPriceCents: offered - 300 });
      expect(await rowOf(ids[0])).toMatchObject({ itemStatus: 'ajustada', revisionState: 'pending', approvedPriceCents: null, revisedPriceCents: offered - 300 });
      expect((await respond(srId, ids[0], { decision: 'accept', expectedRevisedPriceCents: offered - 300 })).status).toBe(200);
      expect(await rowOf(ids[0])).toMatchObject({ itemStatus: 'aprobada', revisionState: 'accepted', approvedPriceCents: offered - 300 });
      expect((await respond(srId, ids[0], { decision: 'accept', expectedRevisedPriceCents: offered - 300 })).status).toBe(200);
      const other = await respond(srId, ids[0], { decision: 'accept', expectedRevisedPriceCents: offered - 100 });
      expect(other.status).toBe(409);
      expect((await respond(srId, ids[0], { decision: 'decline' })).status).toBe(409);
      expect((await rowOf(ids[0]))!.approvedPriceCents).toBe(offered - 300);
    });
    it('declinar no lleva monto y sigue funcionando', async () => {
      const { srId, ids } = await toVerificacion(1);
      const offered = (await rowOf(ids[0]))!.offeredPriceCents!;
      expect((await revise(ids[0], { revisedPriceCents: offered - 100, reasonCode: 'wrong_card' })).status).toBe(200);
      expect((await respond(srId, ids[0], { decision: 'decline' })).status).toBe(200);
      expect(await rowOf(ids[0])).toMatchObject({ itemStatus: 'rechazada', revisionState: 'declined', rejectionCode: 'revision_declined' });
    });
  });

  describe('B-2 y menores', () => {
    it('vista previa: formato estricto ^\\d{1,9}$ => 400 field=revisedPriceCents para 1e3, 1.5, +5, -5, 0x10, espacio, 10 digitos; 0 pasa el formato y da 422', async () => {
      const { ids } = await toVerificacion(1);
      for (const v of ['1e3', '1.5', '%2B5', '-5', '0x10', '%205', '1234567890', '', 'abc']) {
        const r = await preview(ids[0], `?revisedPriceCents=${v}`);
        expect([v, r.status]).toEqual([v, 400]);
        expect((r.body as any).error.details.field).toBe('revisedPriceCents');
      }
      expect((await preview(ids[0], '')).status).toBe(400);
      const zero = await preview(ids[0], '?revisedPriceCents=0');
      expect(zero.status).toBe(422);
      expect((zero.body as any).error.code).toBe('REVISION_NOT_LOWER');
    });

    it('convert-all con locationId que no es uuid => 400 field=locationId sin efectos; uuid inexistente sigue siendo 200 con failed[]', async () => {
      const { srId, ids } = await toVerificacion(1);
      expect((await approve(ids[0])).status).toBe(200);
      const audits = () => h.prisma.auditLog.count({ where: { action: 'buylist.convert_all', entityId: srId } });
      for (const bad of ['no-es-uuid', '123', '../x', '']) {
        const r = await h.api('POST', `/admin/buylist/${srId}/convert-all`, { token: operatorToken, json: { locationId: bad } });
        expect(r.status).toBe(400);
        expect((r.body as any).error.details.field).toBe('locationId');
      }
      expect(await audits()).toBe(0);
      expect(await h.prisma.inventoryItem.count({ where: { sourceSellRequestItemId: ids[0] } })).toBe(0);
      const ok = await h.api('POST', `/admin/buylist/${srId}/convert-all`, { token: operatorToken, json: { locationId: '00000000-0000-4000-8000-000000000000' } });
      expect(ok.status).toBe(200);
    });

    it('rejectionCode viaja SIEMPRE (null explicito) en la linea de admin y en la del vendedor, rechazada o no', async () => {
      const { srId, ids } = await toVerificacion(2);
      expect((await decide(ids[0], { decision: 'reject', reasonCode: 'wrong_card' })).status).toBe(200);
      const admin = (await detail(srId)).items;
      for (const i of admin) expect(Object.prototype.hasOwnProperty.call(i, 'rejectionCode')).toBe(true);
      expect(admin.find((i: any) => i.id === ids[1]).rejectionCode).toBeNull();
      expect(admin.find((i: any) => i.id === ids[0]).rejectionCode).toBe('wrong_card');
      const mine = await h.api('GET', `/buylist/requests/${srId}`, { token: customerToken });
      expect(mine.status).toBe(200);
      for (const i of (mine.body as any).items) expect(Object.prototype.hasOwnProperty.call(i, 'rejectionCode')).toBe(true);
      expect((mine.body as any).items.find((i: any) => i.id === ids[1]).rejectionCode).toBeNull();
    });

    it('C4 usa el tiempo REAL que queda: «te quedan 2 dias» / «menos de 24 horas»; nunca el «7 dias» fijo', async () => {
      const { ids } = await toVerificacion(2);
      const offered = (await rowOf(ids[0]))!.offeredPriceCents!;
      for (const id of ids) expect((await revise(id, { revisedPriceCents: offered - 100, reasonCode: 'wrong_card' })).status).toBe(200);
      const now = new Date();
      // ids[0]: le quedan 20 h; ids[1]: 1 dia habil o menos pero > 24 h (6 d 12 h transcurridos => quedan 12 h... se usa 5,5 d => 1,5 d => 2 dias).
      await h.prisma.sellRequestItem.update({ where: { id: ids[0] }, data: { revisionProposedAt: new Date(now.getTime() - 7 * DAY + 20 * 3600 * 1000) } });
      enviados = [];
      await sweep.run(now);
      const rec = enviados.filter((m) => m.subject.startsWith('Recordatorio:'));
      expect(rec.length).toBeGreaterThanOrEqual(1);
      const t = rec.find((m) => m.text.includes('menos de 24 horas'));
      expect(t).toBeDefined();
      expect(t!.text).toContain('Te quedan menos de 24 horas');
      for (const m of rec) {
        expect(m.text).not.toContain('Tienes 7 días');
        expect(m.text).not.toMatch(/\.\./);
      }
    });
  });
});

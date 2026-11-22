/**
 * `buylist-flujo-f2.e2e-spec.ts` — §BUYLIST-FLUJO F2 (docs/API_CONTRACT_BUYLIST_FLUJO.md §3-§7). Propiedad: backend.
 * Postgres real, por HTTP, sin mocks de Prisma. Datos ficticios (seed e2e).
 *  - F2a: `convert-all` (exito parcial por linea, reintento seguro, ubicacion invalida, auditoria con conteos);
 *  - F2b: `rejectionCode` y «No llego» (sin plazos de recoger);
 *  - F2c: bajar precio, respuesta del vendedor, barrido a 7 dias, 409 REVISION_PENDING, recoger, costo de adquisicion.
 */
import { E2EHarness } from './helpers/e2e-app';
import { BuylistSweepJobService } from '../../src/jobs/buylist-sweep.service';
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_CARDS, E2E_USERS } from '../../prisma/e2e-fixtures';

const CLABE = '012345678901234567';

describe('E2E — §BUYLIST-FLUJO F2', () => {
  let h: E2EHarness;
  let customerToken: string;
  let operatorToken: string;
  let adminToken: string;
  let charizardId: string;
  let addressId: string;
  let otherCustomerToken: string;
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
    otherCustomerToken = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
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

  describe('F2a — convert-all', () => {
    it('da de alta las aprobadas con ubicacion, salta las no aprobadas, es reintento seguro y audita con conteos', async () => {
      const { srId, ids } = await toVerificacion(3);
      expect((await approve(ids[0])).status).toBe(200);
      expect((await approve(ids[1])).status).toBe(200);
      expect((await h.api('PATCH', `/admin/buylist/items/${ids[2]}/decision`, { token: operatorToken, json: { decision: 'reject', reasonCode: 'condition_mismatch', reason: 'llega con whitening' } })).status).toBe(200);
      const loc = await h.prisma.vaultLocation.create({ data: { zone: 'platform_stock', box: `F2A${Date.now()}`, row: '1', slot: '1', label: 'F2A-1' } });

      const r1 = await h.api('POST', `/admin/buylist/${srId}/convert-all`, { token: operatorToken, json: { locationId: loc.id } });
      expect(r1.status).toBe(200);
      const b1 = r1.body as any;
      expect(b1.converted.map((c: any) => c.itemId).sort()).toEqual([ids[0], ids[1]].sort());
      expect(b1.skipped).toEqual([{ itemId: ids[2], code: 'NOT_APPROVED' }]);
      expect(b1.failed).toEqual([]);
      const inv = await h.prisma.inventoryItem.findMany({ where: { sourceSellRequestItemId: { in: ids } } });
      expect(inv).toHaveLength(2);
      expect(inv.every((i) => i.locationId === loc.id)).toBe(true);

      // reintento: nada nuevo, nada duplicado.
      const r2 = (await h.api('POST', `/admin/buylist/${srId}/convert-all`, { token: operatorToken, json: {} })).body as any;
      expect(r2.converted).toEqual([]);
      expect(r2.skipped.filter((s: any) => s.code === 'ALREADY_CONVERTED').map((s: any) => s.itemId).sort()).toEqual([ids[0], ids[1]].sort());
      expect(await h.prisma.inventoryItem.count({ where: { sourceSellRequestItemId: { in: ids } } })).toBe(2);

      const audit = await h.prisma.auditLog.findFirst({ where: { action: 'buylist.convert_all', entityId: srId }, orderBy: { createdAt: 'asc' } });
      expect(audit?.after).toMatchObject({ locationId: loc.id, converted: 2, skipped: 1, failed: 0 });
    });

    it('ubicacion inexistente => falla cada linea con LOCATION_NOT_AVAILABLE, sin inventario ni 500', async () => {
      const { srId, ids } = await toVerificacion(2);
      for (const id of ids) expect((await approve(id)).status).toBe(200);
      const res = await h.api('POST', `/admin/buylist/${srId}/convert-all`, { token: operatorToken, json: { locationId: '00000000-0000-4000-8000-000000000000' } });
      expect(res.status).toBe(200);
      const b = res.body as any;
      expect(b.converted).toEqual([]);
      expect(b.failed.map((f: any) => f.code)).toEqual(['LOCATION_NOT_AVAILABLE', 'LOCATION_NOT_AVAILABLE']);
      expect(await h.prisma.inventoryItem.count({ where: { sourceSellRequestItemId: { in: ids } } })).toBe(0);
      // sin ubicacion, el mismo reintento si convierte.
      const ok = (await h.api('POST', `/admin/buylist/${srId}/convert-all`, { token: operatorToken, json: {} })).body as any;
      expect(ok.converted).toHaveLength(2);
    });
  });

  describe('F2b — rejectionCode y «No llegó»', () => {
    const reject = (itemId: string, json: Record<string, unknown>) =>
      h.api('PATCH', `/admin/buylist/items/${itemId}/decision`, { token: operatorToken, json: { decision: 'reject', ...json } });
    const setStore = (street1: string | null) =>
      h.prisma.configSetting.upsert({
        where: { key: 'skydropx_origin_snapshot' },
        create: { key: 'skydropx_origin_snapshot', valueJson: street1 ? { name: 'TCG HUNT', street1, postalCode: '14210', areaLevel1: 'Ciudad de México', areaLevel2: 'Tlalpan', areaLevel3: 'Pedregal' } : {} },
        update: { valueJson: street1 ? { name: 'TCG HUNT', street1, postalCode: '14210', areaLevel1: 'Ciudad de México', areaLevel2: 'Tlalpan', areaLevel3: 'Pedregal' } : {} },
      });

    it('reject sin reasonCode => 400 field=reasonCode; causa de sistema o desconocida => 400; other sin texto => 400 field=reason; CERO escritura', async () => {
      const { ids } = await toVerificacion(1);
      enviados = [];
      const r1 = await reject(ids[0], { reason: 'sin causa' });
      expect(r1.status).toBe(400);
      expect((r1.body as any).error.code).toBe('VALIDATION_ERROR');
      expect((r1.body as any).error.details.field).toBe('reasonCode');
      expect((await reject(ids[0], { reasonCode: 'revision_expired' })).status).toBe(400);
      expect((await reject(ids[0], { reasonCode: 'nope' })).status).toBe(400);
      const r4 = await reject(ids[0], { reasonCode: 'other' });
      expect(r4.status).toBe(400);
      expect((r4.body as any).error.details.field).toBe('reason');
      const row = await h.prisma.sellRequestItem.findUnique({ where: { id: ids[0] } });
      expect(row?.itemStatus).not.toBe('rechazada');
      expect(row?.rejectionCode).toBeNull();
      expect(enviados).toHaveLength(0);
    });

    it('not_received: rechazada con codigo, SIN plazos ni cola de recoger, sale del bruto, correo C2 sin promesa de devolucion', async () => {
      const { srId, ids } = await toVerificacion(2);
      enviados = [];
      const antes = await detail(srId);
      expect((await approve(ids[0])).status).toBe(200);
      const res = await reject(ids[1], { reasonCode: 'not_received' });
      expect(res.status).toBe(200);
      expect((res.body as any).rejectionCode).toBe('not_received');
      const d = await detail(srId);
      const it = d.items.find((i: any) => i.id === ids[1]);
      expect(it.itemStatus).toBe('rechazada');
      expect(it.rejectionCode).toBe('not_received');
      expect(it.returnDeadlineAt).toBeNull();
      expect(it.abandonDeadlineAt).toBeNull();
      expect(it.rejectionReason).toBeTruthy();
      // fuera del bruto, el envio se descuenta igual (D25): payout = approvedTotal - envio.
      expect(d.payout.grossCents).toBe(d.approvedTotalCents);
      expect(d.payout.shippingFeeCents).toBe(antes.offerShippingFeeCents ?? 0);
      // no entra a la cola de recoger.
      const cola = (await h.api('GET', '/admin/buylist/rejected-items?pageSize=100', { token: operatorToken })).body as any;
      expect(cola.data.some((r: any) => r.id === ids[1])).toBe(false);
      // correo C2: dice que no llego y que no hay nada que devolver; ni plazos ni «recoger».
      expect(enviados).toHaveLength(1);
      const m = enviados[0];
      expect(m.subject).toBe('Una carta de tu solicitud de venta no llegó');
      expect(m.text).toContain('no venía dentro');
      expect(m.text).toContain('no tenemos nada que devolverte');
      expect(m.text).not.toMatch(/recog|pasar por|abandon|hasta el/i);
    });

    it('not_received sin paquete recibido (cotizada) => 422 REQUEST_NOT_RECEIVED y cero escritura', async () => {
      const srId = await createRequest(1);
      const ids: string[] = (await detail(srId)).items.map((i: any) => i.id);
      // cotizada: el `reject` legacy es llamable sin paquete; `not_received` NO (no hay paquete que revisar).
      enviados = [];
      const r = await reject(ids[0], { reasonCode: 'not_received' });
      expect(r.status).toBe(422);
      expect((r.body as any).error.code).toBe('REQUEST_NOT_RECEIVED');
      expect((await h.prisma.sellRequestItem.findUnique({ where: { id: ids[0] } }))?.rejectionCode).toBeNull();
      expect(enviados).toHaveLength(0);
    });

    it('condition_mismatch / wrong_card / other: guardan el codigo, entran a la cola con plazos y el correo C1 lleva direccion de la tienda y enlace', async () => {
      await setStore('Verapaz 123');
      const { srId, ids } = await toVerificacion(3);
      enviados = [];
      expect((await reject(ids[0], { reasonCode: 'condition_mismatch' })).status).toBe(200);
      expect((await reject(ids[1], { reasonCode: 'wrong_card', reason: 'era un Blastoise' })).status).toBe(200);
      expect((await reject(ids[2], { reasonCode: 'other', reason: 'viene sellada con otro idioma' })).status).toBe(200);
      const d = await detail(srId);
      for (const [i, code] of [[0, 'condition_mismatch'], [1, 'wrong_card'], [2, 'other']] as const) {
        const it = d.items.find((x: any) => x.id === ids[i]);
        expect(it.rejectionCode).toBe(code);
        expect(it.returnDeadlineAt).not.toBeNull();
        expect(it.abandonDeadlineAt).not.toBeNull();
      }
      const cola = (await h.api('GET', '/admin/buylist/rejected-items?pageSize=100', { token: operatorToken })).body as any;
      for (const id of ids) expect(cola.data.some((r: any) => r.id === id)).toBe(true);
      expect(cola.data.find((r: any) => r.id === ids[1]).rejectionCode).toBe('wrong_card');
      expect(enviados).toHaveLength(3);
      const c1 = enviados[0];
      expect(c1.subject).toBe('Tu carta te espera');
      expect(c1.text).toContain('Verapaz 123');
      expect(c1.text).toContain('sin costo');
      expect(c1.text).toContain('a tu cargo');
      expect(c1.text).toContain('condición distinta a la que declaraste');
      expect(enviados[1].text).toContain('era un Blastoise');
      expect(enviados[2].text).toContain('viene sellada con otro idioma');
    });

    it('sin direccion de la tienda el correo dice que la confirmara (nunca la inventa)', async () => {
      await setStore(null);
      const { ids } = await toVerificacion(1);
      enviados = [];
      expect((await reject(ids[0], { reasonCode: 'wrong_card' })).status).toBe(200);
      expect(enviados[0].text).toContain('te confirmaremos la dirección al responder');
      await setStore('Verapaz 123');
    });

    it('re-rechazar es idempotente: 200, sin segundo correo y el codigo original no cambia', async () => {
      const { ids } = await toVerificacion(2);
      enviados = [];
      expect((await reject(ids[0], { reasonCode: 'condition_mismatch' })).status).toBe(200);
      expect(enviados).toHaveLength(1);
      const again = await reject(ids[0], { reasonCode: 'not_received' });
      expect(again.status).toBe(200);
      expect(enviados).toHaveLength(1);
      expect((await h.prisma.sellRequestItem.findUnique({ where: { id: ids[0] } }))?.rejectionCode).toBe('condition_mismatch');
    });

    it('todas rechazadas con not_received: la solicitud se cierra y el correo dice que no hay pago', async () => {
      const { srId, ids } = await toVerificacion(1);
      enviados = [];
      expect((await reject(ids[0], { reasonCode: 'not_received' })).status).toBe(200);
      expect((await detail(srId)).status).toBe('rechazada');
      expect(enviados[0].text).toContain('no hay pago');
    });
  });

  describe('F2c — bajar precio, respuesta del vendedor, barrido, recoger', () => {
    const DAY = 24 * 3600 * 1000;
    const revise = (itemId: string, json: Record<string, unknown>, token = operatorToken) =>
      h.api('POST', `/admin/buylist/items/${itemId}/revise-price`, { token, json });
    const respond = (srId: string, itemId: string, decision: string, token = customerToken) =>
      h.api('POST', `/buylist/requests/${srId}/items/${itemId}/revision-response`, { token, json: { decision } });
    const rowOf = (itemId: string) => h.prisma.sellRequestItem.findUnique({ where: { id: itemId } });
    const itemOf = async (srId: string, itemId: string) => (await detail(srId)).items.find((i: any) => i.id === itemId);
    const pay = (srId: string, ref: string, expectedNetCents: number) =>
      h.api('POST', `/admin/buylist/${srId}/pay-spei`, { token: adminToken, json: { speiReference: ref, expectedNetCents } });

    it('proponer la baja: ajustada/pending, offeredPriceCents intacto, neto «si acepta» del servidor, correo C3; mismo valor = 200 sin correo; otro valor reemplaza y reinicia el reloj', async () => {
      const { srId, ids } = await toVerificacion(2);
      const before = await rowOf(ids[0]);
      const offered = before!.offeredPriceCents!;
      expect(offered).toBeGreaterThan(100);
      enviados = [];
      const r = await revise(ids[0], { revisedPriceCents: offered - 100, reasonCode: 'condition_mismatch' });
      expect(r.status).toBe(200);
      const it = (r.body as any).items.find((i: any) => i.id === ids[0]);
      expect(it.itemStatus).toBe('ajustada');
      expect(it.offeredPriceCents).toBe(offered);
      expect(it.agreedPriceCents).toBe(offered);
      expect(it.revision).toMatchObject({ state: 'pending', proposedCents: offered - 100, previousCents: offered, reasonCode: 'condition_mismatch' });
      expect(new Date(it.revision.expiresAt).getTime() - new Date(it.revision.proposedAt).getTime()).toBe(7 * DAY);
      // paridad del neto: «si acepta» == lo que sera `payout.netCents` cuando acepte (la otra linea aprobada al pactado).
      expect((await approve(ids[1])).status).toBe(200);
      const netIf = (await itemOf(srId, ids[0])).revision.netIfAcceptedCents as number;
      expect(Number.isInteger(netIf)).toBe(true);
      expect((r.body as any).payout?.isFinal ?? false).toBe(false);
      expect((await detail(srId)).pendingDecisionItemCount).toBe(1);
      expect(enviados).toHaveLength(1);
      expect(enviados[0].subject).toBe('Te proponemos un nuevo precio por una carta de tu solicitud');
      expect(enviados[0].text).toContain('Precio que te proponemos');
      expect(enviados[0].text).toContain('nunca pagamos un precio menor sin tu «sí»');
      // mismo valor: sin escritura ni correo.
      const t0 = (await rowOf(ids[0]))!.revisionProposedAt!.getTime();
      expect((await revise(ids[0], { revisedPriceCents: offered - 100, reasonCode: 'condition_mismatch' })).status).toBe(200);
      expect((await rowOf(ids[0]))!.revisionProposedAt!.getTime()).toBe(t0);
      expect(enviados).toHaveLength(1);
      // otro valor: reemplaza, reinicia el reloj, nuevo correo.
      await new Promise((res) => setTimeout(res, 20));
      expect((await revise(ids[0], { revisedPriceCents: offered - 200, reasonCode: 'wrong_card', note: 'era otra' })).status).toBe(200);
      const again = await rowOf(ids[0]);
      expect(again!.revisedPriceCents).toBe(offered - 200);
      expect(again!.revisionProposedAt!.getTime()).toBeGreaterThan(t0);
      expect(again!.offeredPriceCents).toBe(offered);
      expect(enviados).toHaveLength(2);
    });

    it('errores de revise-price: no menor => 422, other sin nota => 400, skip => 422, antes de recibir => 422, ya aprobada => 409; sin escritura', async () => {
      const { srId, ids } = await toVerificacion(2);
      const offered = (await rowOf(ids[0]))!.offeredPriceCents!;
      const untouched = async () => expect((await rowOf(ids[0]))!.revisionState).toBeNull();
      for (const v of [offered, offered + 1, 0, -5]) {
        const r = await revise(ids[0], { revisedPriceCents: v, reasonCode: 'other', note: 'motivo' });
        expect(r.status).toBe(422);
        expect((r.body as any).error.code).toBe('REVISION_NOT_LOWER');
      }
      expect((await revise(ids[0], { revisedPriceCents: 10.5, reasonCode: 'other', note: 'motivo' })).status).toBe(400);
      const noNote = await revise(ids[0], { revisedPriceCents: offered - 1, reasonCode: 'other' });
      expect(noNote.status).toBe(400);
      expect((noNote.body as any).error.details.field).toBe('note');
      expect((await revise(ids[0], { revisedPriceCents: offered - 1, reasonCode: 'revision_expired' })).status).toBe(400);
      expect((await revise(ids[0], { revisedPriceCents: offered - 1, reasonCode: 'wrong_card' }, customerToken)).status).toBe(403);
      await untouched();
      // ya aprobada al pactado: 409.
      expect((await approve(ids[1])).status).toBe(200);
      const done = await revise(ids[1], { revisedPriceCents: 1, reasonCode: 'wrong_card' });
      expect(done.status).toBe(409);
      expect((done.body as any).error.code).toBe('REVISION_ALREADY_RESOLVED');
      expect((await rowOf(ids[1]))!.revisionState).toBeNull();
      // antes de recibir (aceptada): 422 REQUEST_NOT_RECEIVED.
      const sr2 = await createRequest(1);
      const i2: string[] = (await detail(sr2)).items.map((i: any) => i.id);
      expect((await h.api('POST', `/admin/buylist/${sr2}/offer`, { token: operatorToken, json: { lines: [{ itemId: i2[0], decision: 'buy' }] } })).status).toBe(200);
      const early = await revise(i2[0], { revisedPriceCents: 1, reasonCode: 'wrong_card' });
      expect(early.status).toBe(422);
      expect((early.body as any).error.code).toBe('REQUEST_NOT_RECEIVED');
      // linea skip: 422 ITEM_NOT_OFFERED.
      const sr3 = await createRequest(2);
      const i3: string[] = (await detail(sr3)).items.map((i: any) => i.id);
      expect((await h.api('POST', `/admin/buylist/${sr3}/offer`, { token: operatorToken, json: { lines: [{ itemId: i3[0], decision: 'buy' }, { itemId: i3[1], decision: 'skip' }] } })).status).toBe(200);
      expect((await h.api('POST', `/buylist/requests/${sr3}/offer-response`, { token: customerToken, json: { decision: 'accept' } })).status).toBe(200);
      expect((await h.api('POST', `/admin/buylist/${sr3}/confirm-shipment`, { token: operatorToken, json: {} })).status).toBe(200);
      expect((await h.api('POST', `/admin/buylist/${sr3}/receive`, { token: operatorToken })).status).toBe(200);
      expect((await h.api('POST', `/admin/buylist/${sr3}/verify`, { token: operatorToken })).status).toBe(200);
      const sk = await revise(i3[1], { revisedPriceCents: 1, reasonCode: 'wrong_card' });
      expect(sk.status).toBe(422);
      expect((sk.body as any).error.code).toBe('ITEM_NOT_OFFERED');
      expect(srId).toBeTruthy();
    });

    it('pay-spei con baja pendiente => 409 REVISION_PENDING {itemIds} sin efectos; el neto «si acepta» == payout.netCents tras aceptar; se paga y el costo de inventario es lo pactado', async () => {
      const { srId, ids } = await toVerificacion(2);
      const offered = (await rowOf(ids[0]))!.offeredPriceCents!;
      const revised = offered - 150;
      expect((await approve(ids[1])).status).toBe(200);
      expect((await revise(ids[0], { revisedPriceCents: revised, reasonCode: 'condition_mismatch' })).status).toBe(200);
      const netIf = (await itemOf(srId, ids[0])).revision.netIfAcceptedCents as number;
      const blocked = await pay(srId, 'SPEI-F2C-1', 1);
      expect(blocked.status).toBe(409);
      expect((blocked.body as any).error.code).toBe('REVISION_PENDING');
      expect((blocked.body as any).error.details).toEqual({ itemIds: [ids[0]] });
      const fila = await h.prisma.sellRequest.findUnique({ where: { id: srId } });
      expect(fila!.status).not.toBe('pagada');
      expect(fila!.payoutNetCents).toBeNull();

      // el vendedor acepta (la baja cobra efecto solo con su «si»).
      expect((await respond(srId, ids[0], 'accept', otherCustomerToken)).status).toBe(404); // ajeno
      const ok = await respond(srId, ids[0], 'accept');
      expect(ok.status).toBe(200);
      const row = await rowOf(ids[0]);
      expect(row).toMatchObject({ itemStatus: 'aprobada', approvedPriceCents: revised, offeredPriceCents: offered, revisionState: 'accepted' });
      expect((await respond(srId, ids[0], 'accept')).status).toBe(200); // misma decision: 200
      const contrary = await respond(srId, ids[0], 'decline');
      expect(contrary.status).toBe(409);
      expect((contrary.body as any).error.code).toBe('REVISION_ALREADY_RESOLVED');
      const d = await detail(srId);
      expect(d.payout.isFinal).toBe(true);
      expect(d.payout.netCents).toBe(netIf); // PARIDAD: el neto en vivo de la baja == el de la lectura == el que se sella
      expect((await itemOf(srId, ids[0])).agreedPriceCents).toBe(revised);
      expect((await pay(srId, 'SPEI-F2C-1', netIf)).status).toBe(200);
      expect((await h.prisma.sellRequest.findUnique({ where: { id: srId } }))!.payoutNetCents).toBe(netIf);

      // costo de adquisicion = lo pactado (baja aceptada), no lo ofertado.
      const conv = await h.api('POST', `/admin/buylist/items/${ids[0]}/convert-to-inventory`, { token: operatorToken, json: {} });
      expect(conv.status).toBe(200);
      const inv = await h.prisma.inventoryItem.findUnique({ where: { id: (conv.body as any).inventoryItemId } });
      expect(inv!.acquisitionCostCents).toBe(revised);
      const conv2 = await h.api('POST', `/admin/buylist/items/${ids[1]}/convert-to-inventory`, { token: operatorToken, json: {} });
      const inv2 = await h.prisma.inventoryItem.findUnique({ where: { id: (conv2.body as any).inventoryItemId } });
      expect(inv2!.acquisitionCostCents).toBe((await rowOf(ids[1]))!.offeredPriceCents);
    });

    it('el vendedor ve revision SIN reasonCode interno (solo reasonText) y SIN cifras de otras lineas', async () => {
      const { srId, ids } = await toVerificacion(1);
      expect((await revise(ids[0], { revisedPriceCents: 1000, reasonCode: 'other', note: 'viene con una esquina doblada' })).status).toBe(200);
      const mine = (await h.api('GET', `/buylist/requests/${srId}`, { token: customerToken })).body as any;
      const rev = mine.items[0].revision;
      expect(rev).toMatchObject({ state: 'pending', proposedCents: 1000, reasonText: 'viene con una esquina doblada' });
      expect(rev).not.toHaveProperty('reasonCode');
      expect(rev).not.toHaveProperty('netIfAcceptedCents');
      expect(rev).not.toHaveProperty('note');
      expect(JSON.stringify(mine)).not.toContain('revisionNote');
    });

    it('el vendedor RECHAZA la baja: rechazada/revision_declined, sale del bruto, la solicitud se cierra si era la unica, correo C1 con la propuesta y el bloque de recoger', async () => {
      const { srId, ids } = await toVerificacion(1);
      const offered = (await rowOf(ids[0]))!.offeredPriceCents!;
      expect((await revise(ids[0], { revisedPriceCents: offered - 100, reasonCode: 'wrong_card' })).status).toBe(200);
      enviados = [];
      const r = await respond(srId, ids[0], 'decline');
      expect(r.status).toBe(200);
      const row = await rowOf(ids[0]);
      expect(row).toMatchObject({ itemStatus: 'rechazada', rejectionCode: 'revision_declined', revisionState: 'declined', approvedPriceCents: null });
      expect(row!.rejectedAt).not.toBeNull();
      expect((await detail(srId)).status).toBe('rechazada');
      expect(enviados).toHaveLength(1);
      expect(enviados[0].subject).toBe('Tu carta te espera');
      expect(enviados[0].text).toContain('No llegamos a un acuerdo en el precio de');
      expect(enviados[0].text).toContain('sin costo');
      expect((await respond(srId, ids[0], 'decline')).status).toBe(200); // misma decision: idempotente, sin segundo correo
      expect(enviados).toHaveLength(1);
      expect((await respond(srId, ids[0], 'accept')).status).toBe(409);
      const cola = (await h.api('GET', '/admin/buylist/rejected-items?pageSize=100', { token: operatorToken })).body as any;
      expect(cola.data.find((x: any) => x.id === ids[0]).rejectionCode).toBe('revision_declined');
    });

    it('barrido a 7 dias: vence (6d23h NO, 7d si), rechazada/revision_expired, un correo C1 por solicitud, y despues responder => 409; recordatorio C4 una sola vez', async () => {
      const { srId, ids } = await toVerificacion(3);
      const offered = (await rowOf(ids[0]))!.offeredPriceCents!;
      for (const id of ids.slice(0, 2)) expect((await revise(id, { revisedPriceCents: offered - 100, reasonCode: 'condition_mismatch' })).status).toBe(200);
      expect((await approve(ids[2])).status).toBe(200);
      const now = new Date();
      // 6 d 23 h: ni vence ni... (recordatorio si: falta 1 dia habil o menos).
      await h.prisma.sellRequestItem.update({ where: { id: ids[0] }, data: { revisionProposedAt: new Date(now.getTime() - 7 * DAY + 3600 * 1000) } });
      await h.prisma.sellRequestItem.update({ where: { id: ids[1] }, data: { revisionProposedAt: new Date(now.getTime() - 7 * DAY - 1000) } });
      enviados = [];
      const out = await sweep.run(now);
      expect(out.revisionsExpired).toBe(1);
      expect(await rowOf(ids[0])).toMatchObject({ revisionState: 'pending', itemStatus: 'ajustada' });
      expect(await rowOf(ids[1])).toMatchObject({ revisionState: 'expired', itemStatus: 'rechazada', rejectionCode: 'revision_expired', approvedPriceCents: null });
      const c1 = enviados.filter((m) => m.subject === 'Tu carta te espera');
      expect(c1).toHaveLength(1);
      expect(c1[0].text).toContain('No recibimos tu respuesta a la propuesta de');
      expect(c1[0].text).toContain('en 7 días, así que no la compramos');
      // la otra, proxima a vencer: recordatorio C4 UNA vez (la corrida anterior ya lo mando si caia en la ventana).
      const recordatorios = () => enviados.filter((m) => m.subject.startsWith('Recordatorio:'));
      const after1 = recordatorios().length;
      expect((await rowOf(ids[0]))!.revisionReminderSentAt).not.toBeNull();
      await sweep.run(now);
      expect(recordatorios().length).toBe(after1);
      expect(after1).toBe(1);
      // ya vencida a mano: el vendedor no puede aceptarla despues (silencio = no acepta).
      await h.prisma.sellRequestItem.update({ where: { id: ids[0] }, data: { revisionProposedAt: new Date(now.getTime() - 8 * DAY) } });
      const late = await respond(srId, ids[0], 'accept');
      expect(late.status).toBe(409);
      expect((late.body as any).error.code).toBe('REVISION_ALREADY_RESOLVED');
      expect(await rowOf(ids[0])).toMatchObject({ revisionState: 'pending', approvedPriceCents: null });
      // y la expiracion de esa segunda; el barrido nunca paga un precio menor sin «si».
      await sweep.run(now);
      expect((await rowOf(ids[0]))!.revisionState).toBe('expired');
      expect((await rowOf(ids[2]))!.itemStatus).toBe('aprobada');
    });

    it('recoger: el vendedor elige (idempotente, puede cambiar), la cola lo muestra, «Entregada» es opcional e idempotente, y not_received no se recoge', async () => {
      const { srId, ids } = await toVerificacion(3);
      expect((await h.api('PATCH', `/admin/buylist/items/${ids[0]}/decision`, { token: operatorToken, json: { decision: 'reject', reasonCode: 'wrong_card' } })).status).toBe(200);
      expect((await h.api('PATCH', `/admin/buylist/items/${ids[1]}/decision`, { token: operatorToken, json: { decision: 'reject', reasonCode: 'not_received' } })).status).toBe(200);
      const pick = (itemId: string, method: string, token = customerToken) =>
        h.api('POST', `/buylist/requests/${srId}/items/${itemId}/pickup`, { token, json: { method } });
      expect((await pick(ids[0], 'in_person', otherCustomerToken)).status).toBe(404);
      expect((await pick(ids[0], 'courier')).status).toBe(400);
      expect((await pick(ids[1], 'in_person')).status).toBe(422); // no llego: nada que recoger
      expect((await pick(ids[2], 'in_person')).status).toBe(422); // ni siquiera rechazada
      const first = await pick(ids[0], 'in_person');
      expect(first.status).toBe(200);
      const t1 = (await rowOf(ids[0]))!.pickupChosenAt!.getTime();
      expect((await pick(ids[0], 'in_person')).status).toBe(200);
      expect((await rowOf(ids[0]))!.pickupChosenAt!.getTime()).toBe(t1); // mismo metodo: no se mueve
      await new Promise((res) => setTimeout(res, 20));
      expect((await pick(ids[0], 'ship_back')).status).toBe(200);
      expect((await rowOf(ids[0]))).toMatchObject({ pickupMethod: 'ship_back' });
      const mine = ((first.body as any).items as any[]).find((i) => i.id === ids[0]);
      expect(mine.pickup).toMatchObject({ method: 'in_person', doneAt: null });
      const mineNR = ((await h.api('GET', `/buylist/requests/${srId}`, { token: customerToken })).body as any).items.find((i: any) => i.id === ids[1]);
      expect(mineNR.pickup).toBeNull();
      const cola = (await h.api('GET', '/admin/buylist/rejected-items?pageSize=100', { token: operatorToken })).body as any;
      expect(cola.data.find((x: any) => x.id === ids[0]).pickup).toMatchObject({ method: 'ship_back', doneAt: null });
      const d1 = await h.api('POST', `/admin/buylist/items/${ids[0]}/pickup-done`, { token: operatorToken });
      expect(d1.status).toBe(200);
      const doneAt = (await rowOf(ids[0]))!.pickupDoneAt!.getTime();
      expect((await h.api('POST', `/admin/buylist/items/${ids[0]}/pickup-done`, { token: operatorToken })).status).toBe(200);
      expect((await rowOf(ids[0]))!.pickupDoneAt!.getTime()).toBe(doneAt);
      expect((await rowOf(ids[0]))!.pickupDoneBy).not.toBeNull();
      expect((await pick(ids[0], 'in_person')).status).toBe(409); // ya entregada
      expect((await h.api('POST', `/admin/buylist/items/${ids[1]}/pickup-done`, { token: operatorToken })).status).toBe(422);
      expect((await h.api('POST', `/admin/buylist/items/${ids[0]}/pickup-done`, { token: customerToken })).status).toBe(403);
    });
  });
});

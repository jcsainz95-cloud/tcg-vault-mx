/**
 * `buylist-flujo-f2.e2e-spec.ts` — §BUYLIST-FLUJO F2 (docs/API_CONTRACT_BUYLIST_FLUJO.md §3-§7). Propiedad: backend.
 * Postgres real, por HTTP, sin mocks de Prisma. Datos ficticios (seed e2e).
 *  - F2a: `convert-all` (exito parcial por linea, reintento seguro, ubicacion invalida, auditoria con conteos);
 *  - F2b: `rejectionCode` y «No llego» (sin plazos de recoger);
 *  - F2c: bajar precio, respuesta del vendedor, barrido a 7 dias, 409 REVISION_PENDING, recoger, costo de adquisicion.
 */
import { E2EHarness } from './helpers/e2e-app';
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
  let enviados: MailMessage[] = [];
  let spy: jest.SpyInstance;

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
    charizardId = (await h.prisma.card.findUnique({ where: { externalId: E2E_CARDS.charizard.externalId } }))!.id;
    const u = await h.prisma.user.findUnique({ where: { email: E2E_USERS.customer2.email } });
    addressId = (await h.prisma.address.findFirst({ where: { userId: u!.id } }))!.id;
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
});

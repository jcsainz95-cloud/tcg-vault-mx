/**
 * `buylist-flujo-f2.e2e-spec.ts` — §BUYLIST-FLUJO F2 (docs/API_CONTRACT_BUYLIST_FLUJO.md §3-§7). Propiedad: backend.
 * Postgres real, por HTTP, sin mocks de Prisma. Datos ficticios (seed e2e).
 *  - F2a: `convert-all` (exito parcial por linea, reintento seguro, ubicacion invalida, auditoria con conteos);
 *  - F2b: `rejectionCode` y «No llego» (sin plazos de recoger);
 *  - F2c: bajar precio, respuesta del vendedor, barrido a 7 dias, 409 REVISION_PENDING, recoger, costo de adquisicion.
 */
import { E2EHarness } from './helpers/e2e-app';
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
  });
  afterAll(async () => {
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
});

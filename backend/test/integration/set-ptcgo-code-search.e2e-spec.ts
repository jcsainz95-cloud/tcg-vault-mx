/**
 * set-ptcgo-code-search.e2e-spec.ts — Integración contra Postgres REAL. P71-B5 (API_CONTRACT v1.80,
 * ARCHITECTURE §4.57.4).
 *
 * «Buscar set» casa por nombre **o** por `ptcgoCode` («contiene», sin distinguir mayúsculas) en los
 * TRES índices de master set: `GET /admin/inventory/master-sets`, `GET /admin/vaults/:userId/master-sets`
 * y `GET /vault/master-sets`. Va contra el motor y no contra un doble porque el `mode:'insensitive'`
 * sobre una columna NULLABLE es conducta de Postgres (ILIKE sobre NULL ⇒ NULL ⇒ la fila no casa, sin
 * reventar), no del mock (§5.4).
 *
 * Fixture propio (prefijo `P71-`): un set `Twilight Masquerade` con `ptcgoCode:'TWM'` y otro con
 * `ptcgoCode:null`; el `customer` del seed tiene una pieza en cada uno para que los dos aparezcan en
 * los índices de bóveda (scope `user_vault` solo lista sets con ≥1 pieza).
 */
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

const P71_SET_EXTERNAL_IDS = ['p71-twm', 'p71-sin-codigo'];

interface IndexBody {
  data: { setId: string; name: string; ptcgoCode: string | null }[];
  total: number;
}

describe('P71-B5 — «Buscar set» por nombre O código en los tres índices (Postgres real)', () => {
  let h: E2EHarness;
  let adminToken: string;
  let customerToken: string;
  let customerId: string;
  let twmId: string;
  let nullId: string;

  async function cleanup() {
    await h.prisma.inventoryItem.deleteMany({ where: { folio: { startsWith: 'P71-' } } });
    await h.prisma.card.deleteMany({ where: { externalId: { startsWith: 'P71-' } } });
    await h.prisma.cardSet.deleteMany({ where: { externalId: { in: P71_SET_EXTERNAL_IDS } } });
  }

  beforeAll(async () => {
    h = await E2EHarness.create();
    await cleanup();
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    customerToken = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    customerId = (await h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.customer.email } })).id;

    const twm = await h.prisma.cardSet.create({
      data: { externalId: P71_SET_EXTERNAL_IDS[0], name: 'Twilight Masquerade', series: 'P71', releaseDate: '2024/05/24', ptcgoCode: 'TWM' },
    });
    const sinCodigo = await h.prisma.cardSet.create({
      data: { externalId: P71_SET_EXTERNAL_IDS[1], name: 'P71 Sin Codigo', series: 'P71', releaseDate: '2024/01/01', ptcgoCode: null },
    });
    twmId = twm.id;
    nullId = sinCodigo.id;
    const cTwm = await h.prisma.card.create({
      data: { externalId: 'P71-TWM-130', setId: twm.id, name: 'P71 Dragapult', number: '130' },
    });
    const cNull = await h.prisma.card.create({
      data: { externalId: 'P71-NULL-1', setId: sinCodigo.id, name: 'P71 Promo', number: '1' },
    });
    const pieza = (folio: string, cardId: string) => ({
      folio, cardId, productType: 'raw' as const, rawCondition: 'NM' as const, finish: 'normal' as const,
      status: 'in_custody' as const, ownerType: 'customer' as const, ownerUserId: customerId,
      ownershipStatus: 'settled' as const, acquisitionType: 'aportacion_en_especie' as const,
    });
    await h.prisma.inventoryItem.createMany({ data: [pieza('P71-TWM-1', cTwm.id), pieza('P71-NULL-1', cNull.id)] });
  });

  afterAll(async () => {
    if (h) {
      await cleanup();
      await h.close();
    }
  });

  const ENDPOINTS: { label: string; path: () => string; token: () => string }[] = [
    { label: 'GET /admin/inventory/master-sets', path: () => '/admin/inventory/master-sets', token: () => adminToken },
    { label: 'GET /admin/vaults/:userId/master-sets', path: () => `/admin/vaults/${customerId}/master-sets`, token: () => adminToken },
    { label: 'GET /vault/master-sets', path: () => '/vault/master-sets', token: () => customerToken },
  ];

  async function search(ep: (typeof ENDPOINTS)[number], q: string) {
    const res = await h.api<IndexBody>('GET', `${ep.path()}?q=${encodeURIComponent(q)}&pageSize=100`, {
      token: ep.token(),
    });
    expect(res.status).toBe(200);
    return res.body;
  }

  describe.each(ENDPOINTS)('$label', (ep) => {
    it.each(['twm', 'TwM', 'TWM', 'wm'])('?q=%s ⇒ devuelve el set TWM (por CÓDIGO) y no el de código null', async (q) => {
      const body = await search(ep, q);
      const ids = body.data.map((r) => r.setId);
      expect(ids).toContain(twmId);
      expect(ids).not.toContain(nullId);
      expect(body.data.find((r) => r.setId === twmId)!.ptcgoCode).toBe('TWM');
    });

    it.each([' twm', 'twm ', '  TwM  '])('?q=%j (con espacios) ⇒ el servidor recorta y devuelve el set TWM', async (q) => {
      const body = await search(ep, q);
      expect(body.data.map((r) => r.setId)).toContain(twmId);
    });

    it('?q=twilight ⇒ sigue devolviéndolo por NOMBRE (la rama del nombre sigue intacta)', async () => {
      const body = await search(ep, 'twilight');
      expect(body.data.map((r) => r.setId)).toContain(twmId);
    });

    it('?q=sin codigo ⇒ el set de ptcgoCode null casa por nombre y trae `ptcgoCode: null` (clave presente)', async () => {
      const body = await search(ep, 'sin codigo');
      const row = body.data.find((r) => r.setId === nullId)!;
      expect(row).toBeDefined();
      expect(Object.prototype.hasOwnProperty.call(row, 'ptcgoCode')).toBe(true);
      expect(row.ptcgoCode).toBeNull();
    });

    it('?q=zzz ⇒ total 0, sin 500 por la columna null', async () => {
      const body = await search(ep, 'zzz');
      expect(body.total).toBe(0);
      expect(body.data).toEqual([]);
    });
  });
});

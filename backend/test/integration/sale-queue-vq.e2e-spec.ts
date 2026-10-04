/**
 * sale-queue-vq.e2e-spec.ts — **VQ-9** (API_CONTRACT §M2 `M2-VQ`, rev v1.80.8.4). Propiedad: backend;
 * la ejecuta QA.
 *
 * El ciclo completo sobre una cola de VENTA sembrada como la del dueño
 * (`0 SIN MERCADO · 17 PREMIUM EN EL PISO · N SIN MOTIVO`): filas `reason IS NULL` de una pieza de
 * CLIENTE, de una pieza VENDIDA y de una pieza de plataforma vendible sin mercado, más 17
 * `premium_at_floor`. Tras `publish-all` + `price-sync` completo:
 *  - `counts.unknown = 0`;
 *  - `premium_at_floor` sin cambio (esta errata no toca el guardarraíl);
 *  - invariante `no_market + premium_at_floor + unknown === nº de filas open` de VENTA;
 *  - la fila de la pieza vendible pasa a `no_market`; las de cliente y vendida, a `resolved`;
 *  - una segunda corrida es no-op (idempotente).
 *
 * ⚠️ El `price-sync` corre REAL (`PriceSyncJobService.run()` sin `cardIds`) salvo el proveedor por carta:
 * `syncCardPrice` se sustituye por `pending` para no salir a la red (pokemontcg.io) por cada pieza de
 * la BD de pruebas. Lo que se mide aquí es el BARRIDO del final de la corrida completa, no el fetch.
 * `publish-all` va acotado al set del spec (`setId`) para no publicar piezas de otras suites.
 */
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { PriceSyncJobService } from '../../src/jobs/price-sync.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';

const SET_ID = 'e2e-vq9-set';
const card = (slug: string) => `e2e-vq9-${slug}`;
const PREMIUM_ROWS = 17;

interface Counts {
  no_market: number;
  premium_at_floor: number;
  unknown: number;
}

describe('E2E — VQ-9: ciclo completo de la cola de VENTA (publish-all + price-sync completo)', () => {
  let h: E2EHarness;
  let adminToken: string;
  const items: Record<string, string> = {};

  async function cleanup() {
    const cards = await h.prisma.card.findMany({ where: { setId: SET_ID }, select: { id: true } });
    const ids = cards.map((c) => c.id);
    if (ids.length === 0) return;
    const its = await h.prisma.inventoryItem.findMany({
      where: { cardId: { in: ids } },
      select: { id: true },
    });
    await h.prisma.inventoryMovement.deleteMany({
      where: { itemId: { in: its.map((i) => i.id) } },
    });
    await h.prisma.inventoryItem.deleteMany({ where: { cardId: { in: ids } } });
    await h.prisma.pendingPriceEntry.deleteMany({ where: { cardId: { in: ids } } });
    await h.prisma.priceReference.deleteMany({ where: { cardId: { in: ids } } });
    await h.prisma.card.deleteMany({ where: { setId: SET_ID } });
    await h.prisma.cardSet.deleteMany({ where: { id: SET_ID } });
  }

  async function counts(): Promise<Counts> {
    const res = await h.api('GET', '/admin/pricing/pending?context=inventory', {
      token: adminToken,
    });
    expect(res.status).toBe(200);
    return (res.body as { counts: Counts }).counts;
  }

  const openSaleRows = () =>
    h.prisma.pendingPriceEntry.count({ where: { status: 'open', context: 'inventory' } });
  const mine = () =>
    h.prisma.pendingPriceEntry.findMany({
      where: { card: { setId: SET_ID } },
      orderBy: [{ cardId: 'asc' }, { cardProductId: 'asc' }],
      select: { id: true, cardId: true, cardProductId: true, status: true, reason: true },
    });

  async function publishAllAndFullSync() {
    const pub = await h.api('POST', '/admin/inventory/publish-all', {
      token: adminToken,
      json: { setId: SET_ID },
    });
    expect(pub.status).toBe(200);
    const pricing = h.app.get(PricingService);
    const spy = jest.spyOn(pricing, 'syncCardPrice').mockResolvedValue({ status: 'pending' });
    try {
      await h.app.get(PriceSyncJobService).run();
    } finally {
      spy.mockRestore();
    }
  }

  beforeAll(async () => {
    h = await E2EHarness.create();
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    await cleanup();
    await h.prisma.cardSet.create({ data: { id: SET_ID, externalId: SET_ID, name: 'E2E VQ-9' } });
    for (const [slug, n] of [
      ['plat', '1'],
      ['cust', '2'],
      ['sold', '3'],
      ['chase', '4'],
    ] as const) {
      await h.prisma.card.create({
        data: {
          id: card(slug),
          externalId: card(slug),
          setId: SET_ID,
          name: `VQ9 ${slug}`,
          number: n,
          rarity: 'Common',
          rarityCanonical: 'Common',
          availableFinishes: ['normal'],
        },
      });
    }
    const customer = await h.prisma.user.findUniqueOrThrow({
      where: { email: E2E_USERS.customer.email },
    });
    const mk = async (slug: string, folio: string, data: Record<string, unknown>) => {
      const it = await h.prisma.inventoryItem.create({
        data: {
          folio,
          cardId: card(slug),
          productType: 'raw',
          rawCondition: 'NM',
          finish: 'normal',
          acquisitionType: 'compra',
          ...data,
        } as never,
      });
      items[slug] = it.id;
    };
    // Plataforma vendible SIN mercado (no hay PriceReference): publish-all la escala con motivo.
    await mk('plat', 'E2E-VQ9-PLAT', { ownerType: 'platform', status: 'in_stock' });
    // Pieza de CLIENTE en custodia y pieza VENDIDA: el viejo price-sync las metía a VENTA sin motivo.
    await mk('cust', 'E2E-VQ9-CUST', {
      ownerType: 'customer',
      ownerUserId: customer.id,
      status: 'in_custody',
    });
    await mk('sold', 'E2E-VQ9-SOLD', { ownerType: 'platform', status: 'delivered' });

    const base = {
      productType: 'raw' as const,
      gradeKey: 'raw:NM',
      finish: 'normal' as const,
      status: 'open' as const,
    };
    // Las tres filas «sin motivo» (como las escribía price-sync: context inventory, refId = pieza).
    for (const slug of ['plat', 'cust', 'sold']) {
      await h.prisma.pendingPriceEntry.create({
        data: {
          ...base,
          cardId: card(slug),
          context: 'inventory',
          refId: items[slug],
          reason: null,
        },
      });
    }
    // Las 17 «premium en el piso» (claves distintas por cardProductId; sin pieza: nada las cierra).
    for (let i = 1; i <= PREMIUM_ROWS; i++) {
      await h.prisma.pendingPriceEntry.create({
        data: {
          ...base,
          cardId: card('chase'),
          cardProductId: i,
          context: 'inventory',
          reason: 'premium_at_floor',
        },
      });
    }
  });

  afterAll(async () => {
    if (h) await cleanup();
    await h?.close();
  });

  it('antes: la cola sembrada tiene sus 3 «sin motivo» y sus 17 premium (el estado del dueño)', async () => {
    const c = await counts();
    expect(c.unknown).toBeGreaterThanOrEqual(3);
    expect(c.premium_at_floor).toBeGreaterThanOrEqual(PREMIUM_ROWS);
  });

  it('después de publish-all + price-sync completo: unknown = 0, premium sin cambio, invariante, y cada fila en su sitio', async () => {
    const before = await counts();
    await publishAllAndFullSync();
    const after = await counts();

    expect(after.unknown).toBe(0);
    expect(after.premium_at_floor).toBe(before.premium_at_floor);
    expect(after.no_market + after.premium_at_floor + after.unknown).toBe(await openSaleRows());

    const rows = await mine();
    const byCard = (slug: string) => rows.filter((r) => r.cardId === card(slug));
    expect(byCard('plat')).toEqual([
      expect.objectContaining({ status: 'open', reason: 'no_market' }),
    ]);
    expect(byCard('cust')).toEqual([expect.objectContaining({ status: 'resolved', reason: null })]);
    expect(byCard('sold')).toEqual([expect.objectContaining({ status: 'resolved', reason: null })]);
    const chase = byCard('chase');
    expect(chase).toHaveLength(PREMIUM_ROWS);
    expect(chase.every((r) => r.status === 'open' && r.reason === 'premium_at_floor')).toBe(true);
    // La pieza sin precio NO se publicó (sin mercado el piso no gana).
    const plat = await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: items.plat } });
    expect(plat.status).toBe('in_stock');
  });

  it('segunda corrida = no-op (idempotente)', async () => {
    const snap = await mine();
    const c1 = await counts();
    await publishAllAndFullSync();
    expect(await mine()).toEqual(snap);
    expect(await counts()).toEqual(c1);
  });
});

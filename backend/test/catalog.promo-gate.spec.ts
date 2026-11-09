import { PromoCollectionLinkService, PROMO_GATE_KEY, readPromoGate } from '../src/modules/catalog/promo-collection-link.service';

/**
 * Compuerta Black Star AUTOMATICA (AUTO_CATALOGO §B): `recompute` hace el backtest ciego con los sellos tras cada recalculo,
 * persiste `promos.gate` y deja `AuditLog catalog.promo_gate_changed` SOLO cuando `open` cambia. Sin constante manual.
 */
type Row = { tcgplayerProductId: number; kind: string; cardId: string; card: { setId: string; contentKey: string | null } };

/** n sellos repartidos en 2 expansiones (pe/ssp), cada uno con su carta lisa y productId dentro de SU ventana. */
function world(n: number, opts: { breakWindow?: boolean } = {}) {
  const cards: { id: string; setId: string; contentKey: string | null }[] = [];
  const baseProducts: { cardId: string; tcgplayerProductId: number }[] = [];
  const stamped: Row[] = [];
  const sets = ['pe', 'ssp'];
  // ancla de ventana: el producto minimo de cada expansion
  cards.push({ id: 'anchor-pe', setId: 'pe', contentKey: null }, { id: 'anchor-ssp', setId: 'ssp', contentKey: null });
  baseProducts.push({ cardId: 'anchor-pe', tcgplayerProductId: 1000 }, { cardId: 'anchor-ssp', tcgplayerProductId: 2000 });
  for (let i = 0; i < n; i++) {
    const set = sets[i % 2];
    const id = `c${i}`;
    cards.push({ id, setId: set, contentKey: `K${i}` });
    const pid = (set === 'pe' ? 1000 : 2000) + 10 + i;
    stamped.push({ tcgplayerProductId: opts.breakWindow && i === 0 ? 2500 : pid, kind: 'stamped', cardId: id, card: { setId: set, contentKey: `K${i}` } });
    if (opts.breakWindow && i === 0) cards.push({ id: 'dup0', setId: 'ssp', contentKey: 'K0' });
  }
  return { cards, baseProducts, stamped };
}

function harness(w: ReturnType<typeof world>, gateBefore?: { open: boolean }) {
  const store = new Map<string, unknown>();
  if (gateBefore) store.set(PROMO_GATE_KEY, { open: gateBefore.open, n: 0, k: 0, expansions: 0 });
  const audits: unknown[] = [];
  const prisma: any = {
    cardSet: { findMany: jest.fn(async () => [{ id: 'pe', externalId: 'pe' }, { id: 'ssp', externalId: 'ssp' }]) },
    card: { findMany: jest.fn(async () => w.cards) },
    cardProduct: {
      findMany: jest.fn(async (args: { where: { kind: string } }) => (args.where.kind === 'stamped' ? w.stamped : w.baseProducts)),
    },
    configSetting: {
      findUnique: jest.fn(async ({ where: { key } }: { where: { key: string } }) => (store.has(key) ? { key, valueJson: store.get(key) } : null)),
      upsert: jest.fn(async ({ where: { key }, create }: { where: { key: string }; create: { valueJson: unknown } }) => {
        store.set(key, create.valueJson);
        return { key };
      }),
    },
    promoCollectionLink: { findMany: jest.fn(async () => []), deleteMany: jest.fn(), upsert: jest.fn() },
    $queryRaw: jest.fn(async () => [{ ok: true }]),
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  const audit = { log: jest.fn(async (e: unknown) => void audits.push(e)) };
  const svc = new PromoCollectionLinkService(prisma as never, audit as never);
  return { svc, store, audits, prisma };
}

describe('compuerta Black Star automatica (recompute)', () => {
  it('con 30 sellos en 2 expansiones y 0 falsos high ABRE sola, persiste n/k/expansions y audita el cambio una vez', async () => {
    const h = harness(world(30));
    const r = await h.svc.recompute();
    expect(r?.gate).toEqual({ open: true, n: 30, k: 30, expansions: 2 });
    expect(await readPromoGate(h.prisma as never)).toEqual({ open: true, n: 30, k: 30, expansions: 2 });
    expect(h.audits).toEqual([expect.objectContaining({ action: 'catalog.promo_gate_changed', before: { open: false }, after: expect.objectContaining({ open: true }) })]);
    // 2.a corrida: no cambia => NO audita otra vez
    await h.svc.recompute();
    expect(h.audits).toHaveLength(1);
  });

  it('con 29 sellos queda CERRADA y no audita (no hubo cambio)', async () => {
    const h = harness(world(29));
    expect((await h.svc.recompute())?.gate).toMatchObject({ open: false, n: 29 });
    expect(h.audits).toHaveLength(0);
  });

  it('se CIERRA sola si una corrida produce un falso high (y audita el cierre)', async () => {
    const h = harness(world(40, { breakWindow: true }), { open: true });
    const r = await h.svc.recompute();
    expect(r?.gate?.open).toBe(false);
    expect(h.audits).toEqual([expect.objectContaining({ action: 'catalog.promo_gate_changed', before: { open: true }, after: expect.objectContaining({ open: false }) })]);
  });

  it('sin fila persistida la compuerta esta CERRADA (falla cerrado)', async () => {
    const h = harness(world(0));
    expect(await readPromoGate(h.prisma as never)).toEqual({ open: false, n: 0, k: 0, expansions: 0 });
  });

  it('publishableLinkedCardIds: cerrada => []; abierta => solo los `high` de esas expansiones', async () => {
    const h = harness(world(0));
    h.prisma.promoCollectionLink.findMany.mockResolvedValue([{ promoCardId: 'p1' }] as never);
    expect(await h.svc.publishableLinkedCardIds(['pe'])).toEqual([]);
    h.store.set(PROMO_GATE_KEY, { open: true, n: 30, k: 30, expansions: 2 });
    expect(await h.svc.publishableLinkedCardIds(['pe'])).toEqual(['p1']);
    expect(h.prisma.promoCollectionLink.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { expansionSetId: { in: ['pe'] }, confidence: 'high' } }));
  });
});

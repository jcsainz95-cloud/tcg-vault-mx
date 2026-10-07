import { SealedRestockNotifyService } from '../src/modules/catalog/sealed-restock-notify.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { MailPort } from '../src/modules/mail/mail.port';
import { CatalogService } from '../src/modules/catalog/catalog.service';

/**
 * v1.23-sealed-sales (§4.23h(c)) → rev v1.87⟨wishlist⟩ (API_CONTRACT §WSH.7): job `sealed-restock-notify` — feature-flagged
 * (off → no-op), candado consultivo, ARMADO (solo avisa tras ver el producto agotado), ventana `matchedAt`, agrupado POR
 * CORREO (una línea por identidad aunque haya filas duplicadas) y enlace `sellado/{id}` a la pieza vendible más barata.
 * Doble de Prisma (sin infra); el ciclo real lo mide `test/integration/sealed-restock-armed.e2e-spec.ts` (WSH-T25/T26).
 */
const NOW = new Date('2030-01-01T12:00:00.000Z');
const MIN = 60_000;

function build(opts: { flag?: string; pending?: any[]; available?: any[]; prices?: Record<string, number>; locked?: boolean } = {}) {
  const updates: { where: any; data: any }[] = [];
  const prisma: any = {
    sealedRestockSubscription: {
      findMany: jest.fn(async () => opts.pending ?? []),
      updateMany: jest.fn(async (a: any) => {
        updates.push(a);
        return { count: Array.isArray(a.where.id?.in) ? a.where.id.in.length : 1 };
      }),
    },
    inventoryItem: { findMany: jest.fn(async () => opts.available ?? []) },
    $transaction: jest.fn(async (fn: any) => fn({ $queryRaw: jest.fn(async () => [{ locked: opts.locked ?? true }]) })),
  };
  const settings = {
    getString: jest.fn(async () => opts.flag ?? 'off'),
    getRawMany: jest.fn(async () => new Map()),
  } as unknown as SettingsService;
  const mail = { send: jest.fn(async () => ({ id: 'm1' })) } as unknown as MailPort;
  const catalog = {
    sellableByIds: jest.fn(async (ids: string[]) =>
      ids.filter((id) => opts.prices?.[id] != null).map((id) => ({ inventoryItemId: id, displayPriceCents: opts.prices![id] })),
    ),
  } as unknown as CatalogService;
  const svc = new SealedRestockNotifyService(prisma as PrismaService, settings, mail, catalog, { now: () => NOW });
  return { prisma, settings, mail, svc, updates };
}

const sub = (over: any) => ({
  id: 's1',
  email: 'a@b.com',
  tcgplayerProductId: 100,
  cardId: 'c1',
  sealedSubtype: 'box',
  sealedCondition: 'mint',
  armedAt: null,
  matchedAt: null,
  card: { name: 'Box A' },
  ...over,
});
const piece = (over: any) => ({
  id: 'i1',
  tcgplayerProductId: 100,
  cardId: 'c1',
  sealedSubtype: 'box',
  sealedCondition: 'mint',
  sealedProductName: 'Caja A',
  card: { name: 'Box A' },
  ...over,
});
const ready = { armedAt: new Date(NOW.getTime() - 90 * MIN), matchedAt: new Date(NOW.getTime() - 31 * MIN) };

describe('SealedRestockNotifyService (§WSH.7)', () => {
  const saved = process.env.APP_PUBLIC_URL;
  beforeEach(() => {
    process.env.APP_PUBLIC_URL = 'https://tienda.example.test';
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.APP_PUBLIC_URL;
    else process.env.APP_PUBLIC_URL = saved;
  });

  it('dial OFF → no-op (no consulta suscripciones, no envía)', async () => {
    const { svc, prisma, mail } = build({ flag: 'off' });
    expect(await svc.run()).toEqual({ job: 'sealed-restock-notify', enqueued: false, reason: 'SEALED_RESTOCK_ALERTS_OFF' });
    expect(prisma.sealedRestockSubscription.findMany).not.toHaveBeenCalled();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('candado consultivo tomado por otra instancia ⇒ no corre (D-WSH-7)', async () => {
    const { svc, prisma } = build({ flag: 'on', locked: false });
    expect(await svc.run()).toEqual({ job: 'sealed-restock-notify', enqueued: false, reason: 'ALREADY_RUNNING' });
    expect(prisma.sealedRestockSubscription.findMany).not.toHaveBeenCalled();
  });

  it('(c) armado: con existencia NO avisa ni arma; agotado ⇒ arma', async () => {
    const withStock = build({ flag: 'on', pending: [sub({})], available: [piece({})], prices: { i1: 1000 } });
    expect(await withStock.svc.run()).toEqual(expect.objectContaining({ enqueued: true, armed: 0, notified: 0 }));
    expect(withStock.mail.send).not.toHaveBeenCalled();
    const soldOut = build({ flag: 'on', pending: [sub({})], available: [] });
    expect((await soldOut.svc.run()).armed).toBe(1);
    expect(soldOut.updates[0]).toEqual({ where: { id: { in: ['s1'] }, armedAt: null }, data: { armedAt: NOW } });
  });

  it('(d) armada que ve el producto de vuelta ⇒ `matchedAt`, y espera la ventana', async () => {
    const { svc, updates, mail } = build({
      flag: 'on',
      pending: [sub({ armedAt: new Date(NOW.getTime() - 60 * MIN) })],
      available: [piece({})],
      prices: { i1: 1000 },
    });
    await svc.run();
    expect(updates).toContainEqual({ where: { id: { in: ['s1'] }, matchedAt: null }, data: { matchedAt: NOW } });
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('(d)(e) pasada la ventana: UN correo por correo, una línea por identidad, enlace a la pieza vendible más barata', async () => {
    const pending = [sub({ id: 's1', ...ready }), sub({ id: 's2', ...ready }), sub({ id: 's3', email: 'otro@b.com', ...ready })];
    const available = [piece({ id: 'i1' }), piece({ id: 'i2' }), piece({ id: 'i3' })];
    const { svc, mail, updates } = build({ flag: 'on', pending, available, prices: { i1: 3000, i2: 2000 /* i3 sin precio */ } });
    expect(await svc.run()).toEqual(expect.objectContaining({ notified: 3, mails: 2 }));
    const sent = (mail.send as jest.Mock).mock.calls.map((c) => c[0]);
    expect(sent.map((m) => m.to).sort()).toEqual(['a@b.com', 'otro@b.com']);
    const toA = sent.find((m) => m.to === 'a@b.com');
    expect(toA.subject).toBe('¡Volvió! · Back in stock: Caja A');
    expect(toA.html).toContain('https://tienda.example.test/es/sellado/i2');
    expect(updates).toContainEqual({ where: { id: { in: ['s1', 's2'] }, notifiedAt: null }, data: { notifiedAt: NOW } });
  });

  it('el producto volvió a agotarse antes de la ventana ⇒ no sale', async () => {
    const { svc, mail } = build({ flag: 'on', pending: [sub(ready)], available: [] });
    await svc.run();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('S15-B1: el nombre del producto sale ESCAPADO en el HTML y literal en el texto y el asunto', async () => {
    const hostil = 'Box <script>alert(1)</script> "X" & Y';
    const { svc, mail } = build({ flag: 'on', pending: [sub(ready)], available: [piece({ sealedProductName: hostil })], prices: { i1: 1000 } });
    await svc.run();
    const msg = (mail.send as jest.Mock).mock.calls[0][0];
    expect(msg.html).not.toContain('<script>');
    expect(msg.html).toContain('Box &lt;script&gt;alert(1)&lt;/script&gt; &quot;X&quot; &amp; Y');
    expect(msg.text).toContain(hostil);
    expect(msg.subject).toContain(hostil);
  });

  it('sin suscripciones pendientes → notified 0 (no consulta inventario)', async () => {
    const { svc, prisma } = build({ flag: 'on', pending: [] });
    expect((await svc.run()).notified).toBe(0);
    expect(prisma.inventoryItem.findMany).not.toHaveBeenCalled();
  });
});
